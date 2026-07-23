import { describe, expect, it } from 'vitest';
import {
  filterAndRankProjectFiles,
  scoreProjectPath,
  type ProjectFileEntry,
} from './project-files.js';

function entry(path: string, kind: 'file' | 'dir' = 'file'): ProjectFileEntry {
  const name = path.split('/').pop() ?? path;
  return { path, name, kind };
}

describe('scoreProjectPath', () => {
  it('ranks exact / prefix / contains / path / subsequence', () => {
    // case-insensitive exact file name
    expect(scoreProjectPath('src/App.tsx', 'app.tsx')).toBe(0);
    // 'app' is a prefix of 'app.tsx'
    expect(scoreProjectPath('src/App.tsx', 'app')).toBe(1);
    expect(scoreProjectPath('src/App.tsx', 'src/app')).toBe(3);
    expect(scoreProjectPath('src/App.tsx', 'aptsx')).toBe(4);
    expect(scoreProjectPath('src/App.tsx', 'zzz')).toBe(-1);
    expect(scoreProjectPath('src/App.tsx', '')).toBe(0);
    // contains (not prefix): query mid-name
    expect(scoreProjectPath('src/MyButton.tsx', 'button')).toBe(2);
  });
});

describe('filterAndRankProjectFiles', () => {
  it('filters and prefers file name matches', () => {
    const entries = [
      entry('docs/readme.md'),
      entry('src/App.tsx'),
      entry('src/components', 'dir'),
      entry('src/components/Button.tsx'),
    ];
    const ranked = filterAndRankProjectFiles(entries, 'button', 10);
    expect(ranked.map((e) => e.path)).toEqual(['src/components/Button.tsx']);
  });

  it('returns all (capped) when query empty', () => {
    const entries = [entry('a.ts'), entry('b.ts'), entry('c.ts')];
    expect(filterAndRankProjectFiles(entries, '', 2).map((e) => e.path)).toEqual([
      'a.ts',
      'b.ts',
    ]);
  });
});
