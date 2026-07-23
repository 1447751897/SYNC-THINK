// List project-relative files for Compose @-mention picker.
// Pure helpers + Node fs walk with hard caps so the UI stays responsive.
import * as fs from 'node:fs';
import * as path from 'node:path';

const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_MAX_DEPTH = 4;

const SKIP_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.turbo',
  '.cache',
  'coverage',
  '.venv',
  'venv',
  '__pycache__',
  '.idea',
  '.vscode',
]);

export interface ProjectFileEntry {
  /** Path relative to the project root, using forward slashes. */
  path: string;
  name: string;
  kind: 'file' | 'dir';
}

export interface ListProjectFilesOptions {
  root: string;
  query?: string;
  maxEntries?: number;
  maxDepth?: number;
}

export function normalizeProjectRoot(root: string): string {
  return path.resolve(root);
}

/** Score a relative path against a fuzzy query (lower is better; -1 = no match). */
export function scoreProjectPath(relPath: string, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const p = relPath.toLowerCase().replace(/\\/g, '/');
  const name = p.split('/').pop() ?? p;
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.includes(q)) return 2;
  if (p.includes(q)) return 3;
  // Simple subsequence match on the file name.
  let qi = 0;
  for (let i = 0; i < name.length && qi < q.length; i++) {
    if (name[i] === q[qi]) qi++;
  }
  if (qi === q.length) return 4;
  return -1;
}

export function filterAndRankProjectFiles(
  entries: readonly ProjectFileEntry[],
  query: string,
  limit = DEFAULT_MAX_ENTRIES,
): ProjectFileEntry[] {
  const scored = entries
    .map((entry) => ({ entry, score: scoreProjectPath(entry.path, query) }))
    .filter((row) => row.score >= 0)
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      // Prefer shorter paths / files over dirs when scores tie.
      if (a.entry.kind !== b.entry.kind) return a.entry.kind === 'file' ? -1 : 1;
      return a.entry.path.localeCompare(b.entry.path);
    });
  return scored.slice(0, limit).map((row) => row.entry);
}

/**
 * Walk a project folder and collect relative paths.
 * Skips heavy/vendor directories; respects depth and count caps.
 */
export function listProjectFiles(options: ListProjectFilesOptions): ProjectFileEntry[] {
  const root = normalizeProjectRoot(options.root);
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const collected: ProjectFileEntry[] = [];

  function walk(absDir: string, relDir: string, depth: number): void {
    if (collected.length >= maxEntries * 3) return; // gather extra for ranking
    let names: string[];
    try {
      names = fs.readdirSync(absDir);
    } catch {
      return;
    }
    names.sort((a, b) => a.localeCompare(b));
    for (const name of names) {
      if (collected.length >= maxEntries * 3) return;
      if (name === '.' || name === '..') continue;
      if (name.startsWith('.') && name !== '.env' && name !== '.gitignore') {
        // Skip most dotfiles/dirs; keep a few useful ones.
        if (SKIP_DIR_NAMES.has(name)) continue;
        if (!name.includes('.')) continue; // .something dir
      }
      const abs = path.join(absDir, name);
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(abs);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      const rel = (relDir ? `${relDir}/${name}` : name).replace(/\\/g, '/');
      if (stat.isDirectory()) {
        if (SKIP_DIR_NAMES.has(name)) continue;
        collected.push({ path: rel, name, kind: 'dir' });
        if (depth < maxDepth) walk(abs, rel, depth + 1);
      } else if (stat.isFile()) {
        collected.push({ path: rel, name, kind: 'file' });
      }
    }
  }

  try {
    const rootStat = fs.statSync(root);
    if (!rootStat.isDirectory()) return [];
  } catch {
    return [];
  }

  walk(root, '', 0);
  return filterAndRankProjectFiles(collected, options.query ?? '', maxEntries);
}
