import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectWorkspaceSharedFacts,
  SHARED_FACT_FILENAMES,
  SHARED_FACT_MAX_FILE_BYTES,
} from './shared-facts.js';

function makeWorkspace(files: Record<string, string | Buffer>): string {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-shared-facts-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

describe('collectWorkspaceSharedFacts', () => {
  it('scans CLAUDE.md / MEMORY.md / AGENTS.md and builds one block', () => {
    const dir = makeWorkspace({
      'CLAUDE.md': '# 工作区事实\n\n- 技术栈：TypeScript\n',
      'AGENTS.md': '# Agent 规则\n\n- 先读文档\n',
    });
    try {
      const facts = collectWorkspaceSharedFacts(dir);
      expect(facts.files.map((file) => file.filename)).toEqual(['CLAUDE.md', 'AGENTS.md']);
      expect(facts.block).toContain('## CLAUDE.md');
      expect(facts.block).toContain('技术栈：TypeScript');
      expect(facts.block).toContain('## AGENTS.md');
      expect(facts.skipped).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns an empty block when no fact files exist', () => {
    const dir = makeWorkspace({ 'README.md': 'not a fact file' });
    try {
      const facts = collectWorkspaceSharedFacts(dir);
      expect(facts.files).toEqual([]);
      expect(facts.block).toBe('');
      expect(facts.skipped).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips oversized and binary files and reports them', () => {
    const dir = makeWorkspace({
      'CLAUDE.md': Buffer.alloc(SHARED_FACT_MAX_FILE_BYTES + 1, 0x61),
      'MEMORY.md': Buffer.from([0x00, 0x01, 0x02]), // contains NUL
      'AGENTS.md': 'ok',
    });
    try {
      const facts = collectWorkspaceSharedFacts(dir);
      expect(facts.files.map((file) => file.filename)).toEqual(['AGENTS.md']);
      expect(facts.skipped).toEqual(['CLAUDE.md', 'MEMORY.md']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never throws for a missing directory', () => {
    expect(() => collectWorkspaceSharedFacts(join(tmpdir(), 'does-not-exist-xyz'))).not.toThrow();
    expect(collectWorkspaceSharedFacts(join(tmpdir(), 'does-not-exist-xyz')).block).toBe('');
  });

  it('exposes the scanned filename list for documentation', () => {
    expect(SHARED_FACT_FILENAMES).toEqual(['CLAUDE.md', 'MEMORY.md', 'AGENTS.md']);
  });
});
