/**
 * 本地 Skill 发现：约定目录 ~/.sync-think/skills 递归扫描 SKILL.md、
 * frontmatter 解析、目录 watch。
 */
import { existsSync, readdirSync, readFileSync, statSync, watch } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';
import type { LocalSkillCandidate } from '@sync-think/protocol';

/** 约定目录：<home>/.sync-think/skills。 */
export function localSkillsDirectory(): string {
  return join(homedir(), '.sync-think', 'skills');
}

const MAX_DEPTH = 4;
const MAX_FILES = 500;
const SKIP_DIRS = new Set(['node_modules', '.git', '.sync-think', 'dist', 'build', '.next']);

function frontmatterOf(content: string): { name?: string; description?: string; summary?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  const meta: Record<string, string> = {};
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const colon = line.indexOf(':');
      if (colon <= 0) continue;
      const key = line.slice(0, colon).trim().toLowerCase();
      const value = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '');
      if (key === 'name' || key === 'description') meta[key] = value;
    }
  }
  const body = match ? content.slice(match[0].length) : content;
  const firstLine = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('#')) ?? '';
  return {
    ...(meta.name ? { name: meta.name } : {}),
    ...(meta.description ? { description: meta.description } : {}),
    ...(firstLine ? { summary: firstLine.slice(0, 120) } : {}),
  };
}

/** 递归扫描目录中的 SKILL.md / skill.md。 */
export function scanLocalSkills(directory: string): LocalSkillCandidate[] {
  const candidates: LocalSkillCandidate[] = [];
  if (!existsSync(directory)) return candidates;
  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH || candidates.length >= MAX_FILES) return;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (candidates.length >= MAX_FILES) return;
      const full = join(dir, name);
      let isDirectory: boolean;
      try {
        isDirectory = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDirectory) {
        if (!SKIP_DIRS.has(name)) walk(full, depth + 1);
        continue;
      }
      if (name.toLowerCase() !== 'skill.md') continue;
      try {
        const content = readFileSync(full, 'utf8');
        const meta = frontmatterOf(content);
        const stat = statSync(full);
        candidates.push({
          path: full,
          folderName: relative(directory, dir).split(sep).pop() ?? dir.split(sep).pop() ?? 'skill',
          ...(meta.name ? { name: meta.name } : {}),
          ...(meta.description ? { description: meta.description } : {}),
          ...(meta.summary ? { summary: meta.summary } : {}),
          imported: false,
          sizeBytes: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        });
      } catch {
        // 单个文件读取失败跳过。
      }
    }
  };
  walk(directory, 0);
  return candidates;
}

export type LocalSkillChangeListener = () => void;

/** watch 约定目录（recursive，变更 debounce 300ms）。返回取消函数。 */
export function watchLocalSkills(directory: string, onChange: LocalSkillChangeListener): () => void {
  if (!existsSync(directory)) return () => undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let watcher: ReturnType<typeof watch> | undefined;
  try {
    watcher = watch(directory, { recursive: true }, () => {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!stopped) onChange();
      }, 300);
    });
  } catch {
    return () => undefined;
  }
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    try {
      watcher?.close();
    } catch {
      // ignore
    }
  };
}
