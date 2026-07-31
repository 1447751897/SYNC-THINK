import { execFile } from 'node:child_process';
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import * as path from 'node:path';
import type {
  ProjectContentMatch,
  SearchProjectContentResult,
} from '../workspace-tools-contract.js';

export type { ProjectContentMatch, SearchProjectContentResult } from '../workspace-tools-contract.js';

const DEFAULT_MAX_RESULTS = 200;
const MAX_RESULTS = 500;
const MAX_QUERY_LENGTH = 256;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SCANNED_FILES = 5_000;
const MAX_SCANNED_BYTES = 64 * 1024 * 1024;
const SEARCH_TIMEOUT_MS = 5_000;
const RG_MAX_BUFFER_BYTES = 4 * 1024 * 1024;

const SKIP_DIR_NAMES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.next',
  '.turbo',
  '.cache',
  '.venv',
  'node_modules',
  'coverage',
  'dist',
  'build',
  'out',
  'venv',
  '__pycache__',
  '.data',
]);

const SKIP_DIR_PREFIXES = ['.electron-', '.playwright-', '.sync-think-', '.tmp'];

export interface SearchProjectContentOptions {
  root: string;
  query: string;
  maxResults?: number;
  /** Test/portable override. Defaults to SYNC_THINK_RG_PATH or `rg`. */
  rgCommand?: string;
  signal?: AbortSignal;
}

export class ProjectContentSearchRegistry {
  private readonly controllers = new Map<number, AbortController>();

  begin(senderId: number): AbortController {
    this.controllers.get(senderId)?.abort();
    const controller = new AbortController();
    this.controllers.set(senderId, controller);
    return controller;
  }

  release(senderId: number, controller: AbortController): void {
    if (this.controllers.get(senderId) === controller) this.controllers.delete(senderId);
  }

  abortForSender(senderId: number): void {
    this.controllers.get(senderId)?.abort();
    this.controllers.delete(senderId);
  }

  abortAll(): void {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
  }
}

interface RipgrepMatchRecord {
  type?: unknown;
  data?: {
    path?: { text?: unknown };
    lines?: { text?: unknown };
    line_number?: unknown;
    submatches?: Array<{
      match?: { text?: unknown };
      start?: unknown;
      end?: unknown;
    }>;
  };
}

function normalizedLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_RESULTS;
  return Math.max(1, Math.min(MAX_RESULTS, Math.floor(value!)));
}

function normalizeRelativePath(value: string): string | null {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return null;
  if (normalized.split('/').some((part) => part === '..')) return null;
  return normalized;
}

function byteOffsetToColumn(line: string, byteOffset: number): number {
  const prefix = Buffer.from(line, 'utf8').subarray(0, Math.max(0, byteOffset));
  return [...prefix.toString('utf8')].length + 1;
}

function throwIfSearchAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error('Workspace content search cancelled');
}

export function buildRipgrepArgs(query: string): string[] {
  const names = [...SKIP_DIR_NAMES, ...SKIP_DIR_PREFIXES.map((prefix) => `${prefix}*`)];
  const exclusions = names.flatMap((name) => [
    '--glob',
    `!${name}/**`,
    '--glob',
    `!**/${name}/**`,
  ]);
  return [
    '--json',
    '--fixed-strings',
    '--smart-case',
    '--line-number',
    '--column',
    '--hidden',
    '--no-ignore',
    '--max-filesize',
    '2M',
    ...exclusions,
    '--',
    query,
    '.',
  ];
}

function isSkippedDirectoryName(name: string): boolean {
  return SKIP_DIR_NAMES.has(name) || SKIP_DIR_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export function parseRipgrepJson(output: string, limit = DEFAULT_MAX_RESULTS): ProjectContentMatch[] {
  const maxResults = normalizedLimit(limit);
  const results: ProjectContentMatch[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    let record: RipgrepMatchRecord;
    try {
      record = JSON.parse(rawLine) as RipgrepMatchRecord;
    } catch {
      continue;
    }
    if (record.type !== 'match') continue;
    const relativePath =
      typeof record.data?.path?.text === 'string'
        ? normalizeRelativePath(record.data.path.text)
        : null;
    const lineText =
      typeof record.data?.lines?.text === 'string'
        ? record.data.lines.text.replace(/\r?\n$/, '')
        : '';
    const lineNumber = record.data?.line_number;
    if (!relativePath || typeof lineNumber !== 'number' || lineNumber < 1) continue;
    for (const submatch of record.data?.submatches ?? []) {
      if (results.length >= maxResults) return results;
      if (typeof submatch.start !== 'number' || typeof submatch.match?.text !== 'string') continue;
      results.push({
        path: relativePath,
        line: lineNumber,
        column: byteOffsetToColumn(lineText, submatch.start),
        preview: lineText.slice(0, 500),
        matchText: submatch.match.text.slice(0, 256),
      });
    }
  }
  return results;
}

function runRipgrep(input: {
  root: string;
  query: string;
  command: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<{ available: boolean; output: string; timedOut: boolean; truncated: boolean }> {
  const args = buildRipgrepArgs(input.query);
  return new Promise((resolve, reject) => {
    execFile(
      input.command,
      args,
      {
        cwd: input.root,
        encoding: 'utf8',
        maxBuffer: RG_MAX_BUFFER_BYTES,
        signal: input.signal,
        timeout: Math.max(1, input.timeoutMs),
        windowsHide: true,
      },
      (error, stdout) => {
        if (!error || (typeof error.code === 'number' && error.code === 1)) {
          resolve({ available: true, output: String(stdout), timedOut: false, truncated: false });
          return;
        }
        const code = String(error.code ?? '');
        if (code === 'ABORT_ERR' || error.name === 'AbortError' || input.signal?.aborted) {
          reject(
            input.signal?.reason instanceof Error
              ? input.signal.reason
              : new Error('Workspace content search cancelled'),
          );
          return;
        }
        if (code === '2') {
          const partialOutput = String(stdout);
          if (parseRipgrepJson(partialOutput, 1).length > 0) {
            resolve({ available: true, output: partialOutput, timedOut: false, truncated: true });
          } else {
            resolve({ available: false, output: '', timedOut: false, truncated: true });
          }
          return;
        }
        if (code === 'ENOENT' || code === 'EACCES') {
          resolve({ available: false, output: '', timedOut: false, truncated: false });
          return;
        }
        if (error.killed || code === 'ETIMEDOUT') {
          resolve({ available: true, output: String(stdout), timedOut: true, truncated: true });
          return;
        }
        if (
          code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ||
          error.message.toLowerCase().includes('maxbuffer')
        ) {
          resolve({ available: true, output: String(stdout), timedOut: false, truncated: true });
          return;
        }
        reject(new Error(`Workspace content search failed: ${error.message}`));
      },
    );
  });
}

function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function fallbackSearch(input: {
  root: string;
  query: string;
  maxResults: number;
  deadline: number;
  signal?: AbortSignal;
}): Promise<{ results: ProjectContentMatch[]; truncated: boolean; timedOut: boolean }> {
  const results: ProjectContentMatch[] = [];
  const smartCase = /[A-Z]/.test(input.query);
  const needle = smartCase ? input.query : input.query.toLowerCase();
  let scannedFiles = 0;
  let scannedBytes = 0;
  let truncated = false;
  let timedOut = false;

  const walk = async (absoluteDir: string, relativeDir: string): Promise<void> => {
    if (truncated || timedOut) return;
    throwIfSearchAborted(input.signal);
    if (Date.now() >= input.deadline) {
      timedOut = true;
      return;
    }
    let entries;
    try {
      entries = await readdir(absoluteDir, { withFileTypes: true });
    } catch {
      throwIfSearchAborted(input.signal);
      return;
    }
    throwIfSearchAborted(input.signal);
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (results.length > input.maxResults || scannedFiles >= MAX_SCANNED_FILES) {
        truncated = true;
        return;
      }
      if (Date.now() >= input.deadline) {
        timedOut = true;
        return;
      }
      throwIfSearchAborted(input.signal);
      if (entry.isSymbolicLink()) continue;
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const absolutePath = path.join(absoluteDir, entry.name);
      if (entry.isDirectory()) {
        if (!isSkippedDirectoryName(entry.name)) await walk(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile()) continue;
      let fileStat;
      try {
        fileStat = await lstat(absolutePath);
      } catch {
        throwIfSearchAborted(input.signal);
        continue;
      }
      if (fileStat.isSymbolicLink() || fileStat.size > MAX_FILE_BYTES) continue;
      scannedFiles += 1;
      scannedBytes += fileStat.size;
      if (scannedBytes > MAX_SCANNED_BYTES) {
        truncated = true;
        return;
      }
      let realFile: string;
      try {
        realFile = await realpath(absolutePath);
      } catch {
        throwIfSearchAborted(input.signal);
        continue;
      }
      if (!isPathInside(realFile, input.root)) continue;
      let buffer: Buffer;
      try {
        buffer = await readFile(realFile, { signal: input.signal });
      } catch {
        throwIfSearchAborted(input.signal);
        continue;
      }
      if (buffer.includes(0)) continue;
      const lines = buffer.toString('utf8').split('\n');
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const rawLine = lines[lineIndex]!.replace(/\r$/, '');
        const haystack = smartCase ? rawLine : rawLine.toLowerCase();
        let from = 0;
        while (from <= haystack.length) {
          const index = haystack.indexOf(needle, from);
          if (index < 0) break;
          results.push({
            path: relativePath.replace(/\\/g, '/'),
            line: lineIndex + 1,
            column: [...rawLine.slice(0, index)].length + 1,
            preview: rawLine.slice(0, 500),
            matchText: rawLine.slice(index, index + input.query.length),
          });
          if (results.length > input.maxResults) {
            truncated = true;
            return;
          }
          from = index + Math.max(1, input.query.length);
        }
      }
    }
  };

  await walk(input.root, '');
  return { results: results.slice(0, input.maxResults), truncated, timedOut };
}

export async function searchProjectContent(
  options: SearchProjectContentOptions,
): Promise<SearchProjectContentResult> {
  throwIfSearchAborted(options.signal);
  const query = String(options.query ?? '').trim();
  if (
    !query ||
    query.length > MAX_QUERY_LENGTH ||
    query.includes('\0') ||
    query.includes('\r') ||
    query.includes('\n')
  ) {
    throw new Error('Invalid content search query');
  }
  const root = await realpath(path.resolve(options.root));
  throwIfSearchAborted(options.signal);
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) throw new Error('Invalid content search root');
  const maxResults = normalizedLimit(options.maxResults);
  const deadline = Date.now() + SEARCH_TIMEOUT_MS;
  const rg = await runRipgrep({
    root,
    query,
    command: options.rgCommand?.trim() || process.env.SYNC_THINK_RG_PATH?.trim() || 'rg',
    signal: options.signal,
    timeoutMs: SEARCH_TIMEOUT_MS,
  });
  if (rg.available) {
    const parsed = parseRipgrepJson(rg.output, maxResults + 1);
    return {
      engine: 'rg',
      results: parsed.slice(0, maxResults),
      truncated: rg.truncated || parsed.length > maxResults,
      timedOut: rg.timedOut,
    };
  }
  const fallback = await fallbackSearch({
    root,
    query,
    maxResults,
    deadline,
    signal: options.signal,
  });
  return { engine: 'fallback', ...fallback };
}
