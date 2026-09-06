import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  describeWorkspaceVersionControl,
  workspaceHasGitMetadata,
} from './workspace-context.js';

describe('workspace version-control facts', () => {
  it('tells the model not to run git when the bound folder has no repository', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-no-git-'));
    try {
      expect(workspaceHasGitMetadata(dir)).toBe(false);
      expect(describeWorkspaceVersionControl(dir)).toContain('not a git repository');
      expect(describeWorkspaceVersionControl(dir)).toContain('Do not run git commands');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('recognizes a folder that already has .git metadata', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-git-'));
    try {
      mkdirSync(join(dir, '.git'));
      expect(workspaceHasGitMetadata(dir)).toBe(true);
      expect(describeWorkspaceVersionControl(dir)).toContain('is a git repository');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
