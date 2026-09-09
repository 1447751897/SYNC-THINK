/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { extractFilePathsFromDrag, isTerminalPathDrag, shellEscapePath } from './path-drop.js';

describe('NewMax terminal path drop', () => {
  it('leaves simple paths unquoted and POSIX-quotes the rest', () => {
    expect(shellEscapePath('src/main.ts')).toBe('src/main.ts');
    expect(shellEscapePath("C:\\Program Files\\app")).toBe(`'C:\\Program Files\\app'`);
  });

  it('treats Files, uri-list, and newmax-file payloads as path drags', () => {
    expect(isTerminalPathDrag({ types: ['Files'], files: [], getData: () => '' } as unknown as DataTransfer)).toBe(
      true,
    );
    expect(
      isTerminalPathDrag({
        types: ['text/plain'],
        files: [],
        getData: () => 'newmax-file:D:/work/a.ts',
      } as unknown as DataTransfer),
    ).toBe(true);
  });

  it('reads newmax-file: before native file entries', () => {
    const paths = extractFilePathsFromDrag({
      dataTransfer: {
        files: [],
        getData: (type: string) => (type === 'text/plain' ? 'newmax-file:D:/work/a.ts' : ''),
      },
    } as unknown as DragEvent);
    expect(paths).toEqual(['D:/work/a.ts']);
  });
});
