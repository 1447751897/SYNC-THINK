import { randomUUID } from 'node:crypto';
import {
  access,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, win32 } from 'node:path';
import type {
  Worker,
  WorkerEvent,
  WorkerJobInput,
  WorkerJobOutput,
  WorkerToken,
} from '../types.js';
import { isPathInside } from '../types.js';
import { DEFAULT_MAX_OUTPUT_BYTES, startRefusal } from '../process-runner.js';

export interface FileAction {
  kind: 'read' | 'write' | 'list' | 'delete' | 'search';
  relative?: string;
  content?: string;
  maxEntries?: number;
  /** search: JS-compatible regex source (no flags). */
  pattern?: string;
  /** search: case-insensitive match. */
  caseInsensitive?: boolean;
  /** search: include only relative paths matching this glob (e.g. "**\/*.ts"). */
  globInclude?: string;
  /** search: exclude relative paths matching this glob (e.g. "**\/*.test.ts"). */
  globExclude?: string;
  /** search: context lines before/after each match (0-5). */
  contextLines?: number;
  /** search: max matches to report (default 50, cap 200). */
  maxResults?: number;
}

export interface FileWorkerInput extends WorkerJobInput {
  action: FileAction;
}

export interface FileWorkerOutput extends WorkerJobOutput {
  content?: string;
  entries?: string[];
  bytes?: number;
}

export interface FileWorker extends Worker<FileWorkerInput> {
  readonly kind: 'file';
}

export class FakeFileWorker implements FileWorker {
  readonly kind = 'file' as const;
  async *exec(input: FileWorkerInput, token: WorkerToken): AsyncIterable<WorkerEvent> {
    if (
      input.action.relative &&
      !isPathInside(`${input.workingDir}/${input.action.relative}`, token.allowedRoot)
    ) {
      yield {
        type: 'failed',
        failureClass: 'permission',
        error: { code: 'security.path_traversal', message: 'relative path escapes allowedRoot' },
      };
      return;
    }
    yield { type: 'stderr', text: `[fake-file] ${input.action.kind} ignored in Phase 0` };
    yield { type: 'completed', output: { ok: false, message: 'file worker fake' } };
  }
}

const MAX_WRITE_BYTES = 1024 * 1024;

// --- content search (search_files) ---
const MAX_SEARCH_FILE_BYTES = 512 * 1024;
const MAX_HITS_PER_FILE = 20;
const DEFAULT_MAX_RESULTS = 50;
const SEARCH_MAX_RESULTS_CAP = 200;
const DEFAULT_CONTEXT_LINES = 0;

/** Directories never searched, whatever glob the model passes. */
const SEARCH_IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.turbo',
  'coverage',
  '.cache',
  '.claude',
  '.tmp',
  '.tmp-dev',
  '.tmp-runtime-phase3',
  '.tmp-runtime-qa',
  '.tmp-test-runtime',
  '.dev-data',
  '.venv',
  'venv',
]);

/** Convert a brace/glob pattern into a path RegExp ('**' crosses segments). */
export function globToRegExp(glob: string): RegExp {
  let pattern = glob.replace(/\\/g, '/').replace(/^\.\//, '');
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          out += '(?:[^/]*/)*';
          i += 3;
        } else {
          out += '.*';
          i += 2;
        }
        continue;
      }
      out += '[^/]*';
      i += 1;
      continue;
    }
    if (ch === '?') {
      out += '[^/]';
      i += 1;
      continue;
    }
    if (ch === '{') {
      const end = pattern.indexOf('}', i);
      if (end > i) {
        const parts = pattern
          .slice(i + 1, end)
          .split(',')
          .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        out += `(?:${parts.join('|')})`;
        i = end + 1;
        continue;
      }
    }
    if (ch === '[') {
      const end = pattern.indexOf(']', i + 1);
      if (end > i) {
        out += pattern.slice(i, end + 1);
        i = end + 1;
        continue;
      }
      out += '\\[';
      i += 1;
      continue;
    }
    if ('\\.+?^${}()|'.includes(ch)) out += `\\${ch}`;
    else out += ch;
    i += 1;
  }
  return new RegExp(`^${out}$`);
}

function looksBinary(buffer: Buffer): boolean {
  const probe = buffer.subarray(0, Math.min(buffer.length, 8 * 1024));
  return probe.includes(0);
}

interface SearchMatchLine {
  line: number;
  text: string;
  matched: boolean;
}

interface SearchFileResult {
  path: string;
  lines: SearchMatchLine[];
  hits: number;
}

/**
 * Recursively search `target` for `pattern`. Safe by construction:
 * never follows symlinks, never escapes allowedRoot (already enforced by
 * resolveFileTarget for the root), ignores SEARCH_IGNORED_DIRS, skips
 * oversized/binary files, and honors glob include/exclude filters.
 */
async function searchTree(
  target: string,
  regex: RegExp,
  options: {
    globInclude?: RegExp;
    globExclude?: RegExp;
    contextLines: number;
    maxResults: number;
    maxOutputChars: number;
    signal?: AbortSignal;
  },
): Promise<{ text: string; truncated: boolean }> {
  const results: SearchFileResult[] = [];
  let totalHits = 0;
  let truncated = false;
  let chars = 0;
  const maxChars = options.maxOutputChars;
  const flush = (): boolean => {
    if (chars >= maxChars) {
      truncated = true;
      return true;
    }
    return false;
  };

  const visit = async (dir: string, relDir: string): Promise<void> => {
    if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    if (flush()) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SEARCH_IGNORED_DIRS.has(entry.name)) continue;
        await visit(`${dir}/${entry.name}`, rel);
        continue;
      }
      if (!entry.isFile()) continue; // symlinks and special files never followed
      if (options.globExclude?.test(rel)) continue;
      if (options.globInclude && !options.globInclude.test(rel)) continue;
      let info;
      try {
        info = await stat(`${dir}/${entry.name}`);
      } catch {
        continue;
      }
      if (!info.isFile() || info.size > MAX_SEARCH_FILE_BYTES || info.size === 0) continue;
      let raw: Buffer;
      try {
        raw = await readFile(`${dir}/${entry.name}`);
      } catch {
        continue;
      }
      if (looksBinary(raw)) continue;
      const text = raw.toString('utf8');
      const lines = text.split('\n');
      const ctx = options.contextLines;
      const fileResult: SearchFileResult = { path: rel, lines: [], hits: 0 };
      for (let idx = 0; idx < lines.length && fileResult.hits < MAX_HITS_PER_FILE; idx += 1) {
        if (!regex.test(lines[idx])) continue;
        regex.lastIndex = 0;
        fileResult.hits += 1;
        totalHits += 1;
        const from = Math.max(0, idx - ctx);
        const to = Math.min(lines.length - 1, idx + ctx);
        // Avoid re-emitting the same context lines twice for adjacent matches.
        const prevLast = fileResult.lines.length > 0 ? fileResult.lines[fileResult.lines.length - 1].line : -1;
        const start = prevLast >= from ? prevLast + 1 : from;
        for (let l = start; l <= to; l += 1) {
          fileResult.lines.push({ line: l, text: lines[l], matched: l === idx });
        }
        if (totalHits >= options.maxResults) {
          if (idx < lines.length - 1 || results.length > 0) truncated = true;
          if (fileResult.hits > 0) results.push(fileResult);
          return;
        }
      }
      if (fileResult.hits > 0) results.push(fileResult);
    }
  };

  await visit(target, '');
  // Render: rg-like "path:line: text" with "-" prefix for context lines.
  const linesOut: string[] = [];
  for (const file of results) {
    if (chars >= maxChars) {
      truncated = true;
      break;
    }
    const header = `${file.path}: ${file.hits} match${file.hits === 1 ? '' : 'es'}`;
    linesOut.push(header);
    chars += header.length + 1;
    for (const m of file.lines) {
      const piece = `${m.matched ? ':' : '-'}${m.line + 1}: ${m.text}`;
      if (chars + piece.length > maxChars) {
        truncated = true;
        break;
      }
      linesOut.push(piece);
      chars += piece.length + 1;
    }
    if (truncated) break;
  }
  if (truncated) linesOut.push('(output truncated)');
  return { text: linesOut.join('\n'), truncated };
}

export class FileSystemWorker implements FileWorker {
  readonly kind = 'file' as const;

  async *exec(input: FileWorkerInput, token: WorkerToken): AsyncIterable<WorkerEvent> {
    try {
      const target = await resolveFileTarget(input, token, input.action.kind === 'write');
      const refusal = startRefusal(token);
      if (refusal) {
        yield failedStart(refusal);
        return;
      }

      if (input.action.kind === 'delete') {
        yield {
          type: 'failed',
          failureClass: 'permission',
          error: {
            code: 'worker.delete-disabled',
            message: 'Irreversible file deletion is not exposed by the built-in file worker',
          },
        };
        return;
      }

      const maxOutputBytes = Math.max(
        1,
        Math.min(token.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES, 1024 * 1024),
      );
      if (input.action.kind === 'read') {
        const info = await stat(target);
        if (!info.isFile()) throw new Error('worker.file-not-regular');
        if (info.size > maxOutputBytes) {
          yield outputLimitFailure();
          return;
        }
        const content = await readFile(target, 'utf8');
        const bytes = Buffer.byteLength(content, 'utf8');
        if (bytes > maxOutputBytes) {
          yield outputLimitFailure();
          return;
        }
        yield { type: 'stdout', text: content };
        yield {
          type: 'completed',
          output: { ok: true, message: 'File read completed', content, bytes },
        };
        return;
      }

      if (input.action.kind === 'list') {
        const maxEntries = Math.max(1, Math.min(input.action.maxEntries ?? 500, 2_000));
        const entries = (await readdir(target, { withFileTypes: true }))
          .sort((left, right) => left.name.localeCompare(right.name))
          .slice(0, maxEntries)
          .map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`);
        if (Buffer.byteLength(JSON.stringify(entries), 'utf8') > maxOutputBytes) {
          yield outputLimitFailure();
          return;
        }
        yield {
          type: 'completed',
          output: { ok: true, message: 'Directory listing completed', entries },
        };
        return;
      }

      if (input.action.kind === 'search') {
        const patternSource =
          typeof input.action.pattern === 'string' && input.action.pattern.trim()
            ? input.action.pattern.trim()
            : '';
        if (!patternSource) {
          yield {
            type: 'failed',
            failureClass: 'acceptance',
            error: { code: 'worker.file-bad-pattern', message: 'search pattern is required' },
          };
          return;
        }
        let regex: RegExp;
        try {
          regex = new RegExp(patternSource, input.action.caseInsensitive === true ? 'i' : '');
        } catch (error) {
          yield {
            type: 'failed',
            failureClass: 'acceptance',
            error: {
              code: 'worker.file-bad-pattern',
              message: `invalid search pattern: ${error instanceof Error ? error.message : 'regex error'}`,
            },
          };
          return;
        }
        const maxResults = Math.max(
          1,
          Math.min(input.action.maxResults ?? DEFAULT_MAX_RESULTS, SEARCH_MAX_RESULTS_CAP),
        );
        const contextLines = Math.max(
          0,
          Math.min(input.action.contextLines ?? DEFAULT_CONTEXT_LINES, 5),
        );
        let globInclude: RegExp | undefined;
        let globExclude: RegExp | undefined;
        try {
          if (typeof input.action.globInclude === 'string' && input.action.globInclude.trim()) {
            globInclude = globToRegExp(input.action.globInclude.trim());
          }
          if (typeof input.action.globExclude === 'string' && input.action.globExclude.trim()) {
            globExclude = globToRegExp(input.action.globExclude.trim());
          }
        } catch (error) {
          yield {
            type: 'failed',
            failureClass: 'acceptance',
            error: {
              code: 'worker.file-bad-glob',
              message: `invalid glob: ${error instanceof Error ? error.message : 'glob error'}`,
            },
          };
          return;
        }
        const { text, truncated } = await searchTree(target, regex, {
          globInclude,
          globExclude,
          contextLines,
          maxResults,
          maxOutputChars: maxOutputBytes,
          signal: token.signal,
        });
        const summary = truncated ? 'Search completed (truncated)' : 'Search completed';
        yield {
          type: 'completed',
          output: {
            ok: true,
            message: summary,
            content: text || '(no matches)',
            truncated,
          },
        };
        return;
      }

      const content = input.action.content;
      if (typeof content !== 'string') throw new Error('worker.file-content-required');
      const bytes = Buffer.byteLength(content, 'utf8');
      if (bytes > MAX_WRITE_BYTES) throw new Error('worker.file-write-too-large');
      await mkdir(dirname(target), { recursive: true });
      const temporary = join(dirname(target), `.${randomUUID()}.sync-think.tmp`);
      try {
        await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', signal: token.signal });
        await rename(temporary, target);
      } finally {
        await rm(temporary, { force: true }).catch(() => undefined);
      }
      yield {
        type: 'completed',
        output: { ok: true, message: 'File write completed', bytes },
      };
    } catch (error) {
      const aborted =
        token.signal?.aborted || (error instanceof Error && error.name === 'AbortError');
      const message = error instanceof Error ? error.message : 'File worker failed';
      const permission = message.startsWith('security.path_traversal');
      yield {
        type: 'failed',
        failureClass: permission ? 'permission' : 'unknown',
        error: {
          code: aborted ? 'worker.aborted' : permission ? 'security.path_traversal' : message,
          message: aborted ? 'File operation was cancelled' : message,
        },
      };
    }
  }
}

async function resolveFileTarget(
  input: FileWorkerInput,
  token: WorkerToken,
  allowMissing: boolean,
): Promise<string> {
  const relative = input.action.relative ?? '.';
  if (isAbsolute(relative) || win32.isAbsolute(relative)) {
    throw new Error('security.path_traversal: absolute paths are not accepted');
  }
  const workingDir = resolve(input.workingDir);
  const allowedRoot = resolve(token.allowedRoot);
  if (!isPathInside(workingDir, allowedRoot)) {
    throw new Error('security.path_traversal: workingDir escapes allowedRoot');
  }
  const target = resolve(workingDir, relative);
  if (!isPathInside(target, allowedRoot)) {
    throw new Error('security.path_traversal: relative path escapes allowedRoot');
  }

  const realRoot = await realpath(allowedRoot);
  let existing = target;
  while (true) {
    try {
      await access(existing);
      break;
    } catch {
      const parent = dirname(existing);
      if (parent === existing) {
        if (allowMissing) break;
        throw new Error('worker.file-not-found');
      }
      existing = parent;
    }
  }
  const realExisting = await realpath(existing);
  if (!isPathInside(realExisting, realRoot)) {
    throw new Error('security.path_traversal: symlink escapes allowedRoot');
  }
  if (!allowMissing && existing !== target) throw new Error('worker.file-not-found');
  return target;
}

function failedStart(reason: 'aborted' | 'fence-rejected'): WorkerEvent {
  return {
    type: 'failed',
    failureClass: 'acceptance',
    error: {
      code: reason === 'aborted' ? 'worker.aborted' : 'worker.fence-rejected',
      message:
        reason === 'aborted' ? 'File operation was cancelled' : 'File execution fence rejected',
    },
  };
}

function outputLimitFailure(): WorkerEvent {
  return {
    type: 'failed',
    failureClass: 'acceptance',
    error: { code: 'worker.output-limit', message: 'File output exceeds the configured limit' },
  };
}
