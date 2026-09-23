import { describe, expect, it } from 'vitest';
import { isPathWithinRoot } from './node-paths.js';

describe('isPathWithinRoot', () => {
  it('accepts the root and nested paths for Windows and POSIX paths', () => {
    expect(isPathWithinRoot('D:/projects/demo', 'D:/projects/demo')).toBe(true);
    expect(isPathWithinRoot('D:/projects/demo', 'D:/projects/demo/src/file.ts')).toBe(true);
    expect(isPathWithinRoot('/projects/demo', '/projects/demo/src/file.ts')).toBe(true);
  });

  it('rejects parent traversal, sibling prefixes, and different drives', () => {
    expect(isPathWithinRoot('D:/projects/demo', 'D:/projects/demo/../secret')).toBe(false);
    expect(isPathWithinRoot('D:/projects/demo', 'D:/projects/demo-copy/file.ts')).toBe(false);
    expect(isPathWithinRoot('D:/projects/demo', 'C:/projects/demo/file.ts')).toBe(false);
  });

  it('uses Windows case and separator semantics for Windows paths', () => {
    expect(isPathWithinRoot(String.raw`D:\Projects\Demo`, String.raw`d:/projects/demo/src`)).toBe(true);
  });

  it('rejects relative paths and paths from mixed absolute styles', () => {
    expect(isPathWithinRoot('projects/demo', 'projects/demo/file.ts')).toBe(false);
    expect(isPathWithinRoot('D:/projects/demo', '/projects/demo/file.ts')).toBe(false);
  });

  it('does not confuse a legal dot-prefixed child with parent traversal', () => {
    expect(isPathWithinRoot('/projects/demo', '/projects/demo/..cache/file')).toBe(true);
  });
});
