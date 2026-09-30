import { describe, expect, it } from 'vitest';
import { readWorkspaceExpansion, writeWorkspaceExpansion } from './sidebar-workspace-expansion.js';
describe('workspace expansion preferences', () => {
  it('round-trips independently expanded workspaces and explicit collapse', () => {
    let raw = '';
    const storage = {
      getItem: () => raw,
      setItem: (_key: string, value: string) => {
        raw = value;
      },
    };
    writeWorkspaceExpansion({ a: true, b: true, c: false }, storage);
    expect(readWorkspaceExpansion(storage)).toEqual({ a: true, b: true, c: false });
  });
  it('ignores malformed and non-boolean values', () => {
    expect(readWorkspaceExpansion({ getItem: () => '{' })).toEqual({});
    expect(readWorkspaceExpansion({ getItem: () => '[]' })).toEqual({});
    expect(
      readWorkspaceExpansion({
        getItem: () => JSON.stringify({ a: true, b: 'false', c: 1, '': false }),
      }),
    ).toEqual({ a: true });
  });
  it('leaves navigation usable when browser storage is unavailable', () => {
    expect(
      readWorkspaceExpansion({
        getItem: () => {
          throw Error('blocked');
        },
      }),
    ).toEqual({});
    expect(() =>
      writeWorkspaceExpansion(
        { a: true },
        {
          setItem: () => {
            throw Error('blocked');
          },
        },
      ),
    ).not.toThrow();
  });
});
