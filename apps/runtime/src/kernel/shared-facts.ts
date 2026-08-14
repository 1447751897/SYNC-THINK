/**
 * Shared facts layer — workspace-level facts every kernel gets injected with
 * (design doc §10.1). Workspace-scoped CLAUDE.md / MEMORY.md / AGENTS.md are
 * scanned and concatenated into a system-prompt block. Team-scoped facts are
 * injected via the existing team prompt block; the storage extension for
 * structured team facts is a later slice.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SHARED_FACT_FILENAMES = ['CLAUDE.md', 'MEMORY.md', 'AGENTS.md'] as const;

/** Per-file cap; larger files are skipped and reported (not truncated mid-prompt). */
export const SHARED_FACT_MAX_FILE_BYTES = 256 * 1024;

export interface SharedFactsCollection {
  files: Array<{ filename: string; content: string }>;
  /** Concatenated markdown block for system-prompt injection. */
  block: string;
  /** Existing files skipped because they were oversized / not clean UTF-8. */
  skipped: string[];
}

function isCleanText(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  // Reject non-UTF-8-looking content: decode and check for the replacement char.
  const text = buffer.toString('utf8');
  return !text.includes('\uFFFD');
}

/** Collect shared facts from `workspaceDir`. Never throws; missing dirs yield an empty block. */
export function collectWorkspaceSharedFacts(workspaceDir: string): SharedFactsCollection {
  const files: Array<{ filename: string; content: string }> = [];
  const skipped: string[] = [];
  for (const filename of SHARED_FACT_FILENAMES) {
    const filePath = join(workspaceDir, filename);
    try {
      if (!existsSync(filePath)) continue;
      const buffer = readFileSync(filePath);
      if (buffer.length > SHARED_FACT_MAX_FILE_BYTES) {
        skipped.push(filename);
        continue;
      }
      if (!isCleanText(buffer)) {
        skipped.push(filename);
        continue;
      }
      const content = buffer.toString('utf8').trim();
      if (!content) continue;
      files.push({ filename, content });
    } catch {
      skipped.push(filename);
    }
  }
  const block = files
    .map(({ filename, content }) => `## ${filename}\n\n${content}`)
    .join('\n\n');
  return { files, block, skipped };
}
