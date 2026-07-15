import { describe, expect, it } from 'vitest';
import {
  assertAllowedWorkspacePath,
  canonicalizeWorkspacePath,
  isPathInsideRoot,
  WorkspacePathError,
} from './path-allowlist.js';

describe('canonicalizeWorkspacePath', () => {
  it('normalizes relative segments and separators on Windows-style absolute paths', () => {
    const result = canonicalizeWorkspacePath('D:\\projects\\demo\\sub\\..\\workspace');
    expect(result).toMatch(/^[A-Za-z]:\\projects\\demo\\workspace$/i);
  });

  it('rejects empty and whitespace-only paths', () => {
    expect(() => canonicalizeWorkspacePath('   ')).toThrow(WorkspacePathError);
  });

  it('rejects relative paths without a root', () => {
    expect(() => canonicalizeWorkspacePath('..\\secrets')).toThrow(WorkspacePathError);
    expect(() => canonicalizeWorkspacePath('relative\\folder')).toThrow(WorkspacePathError);
  });
});

describe('isPathInsideRoot', () => {
  it('accepts the root itself and nested children', () => {
    const root = canonicalizeWorkspacePath('D:\\projects\\demo');
    expect(isPathInsideRoot(root, root)).toBe(true);
    expect(isPathInsideRoot(root, canonicalizeWorkspacePath('D:\\projects\\demo\\tasks'))).toBe(true);
  });

  it('rejects siblings and parent escapes', () => {
    const root = canonicalizeWorkspacePath('D:\\projects\\demo');
    expect(isPathInsideRoot(root, canonicalizeWorkspacePath('D:\\projects\\other'))).toBe(false);
    expect(isPathInsideRoot(root, canonicalizeWorkspacePath('D:\\projects'))).toBe(false);
  });
});

describe('assertAllowedWorkspacePath', () => {
  it('returns the canonical path when allowlist is empty (first-folder onboarding)', () => {
    const path = assertAllowedWorkspacePath('D:\\projects\\new-workspace', []);
    expect(path).toMatch(/^[A-Za-z]:\\projects\\new-workspace$/i);
  });

  it('accepts a path that equals or is nested under an allowlisted root', () => {
    const allowed = [canonicalizeWorkspacePath('D:\\projects')];
    expect(assertAllowedWorkspacePath('D:\\projects\\demo', allowed)).toMatch(
      /^[A-Za-z]:\\projects\\demo$/i,
    );
  });

  it('rejects a path outside every allowlisted root', () => {
    const allowed = [canonicalizeWorkspacePath('D:\\projects')];
    expect(() => assertAllowedWorkspacePath('C:\\Windows\\System32', allowed)).toThrow(
      WorkspacePathError,
    );
  });
});
