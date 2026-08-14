import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolvePlatformMcpServerEntry } from './platform-mcp-entry.js';

describe('resolvePlatformMcpServerEntry', () => {
  it('resolves the real monorepo entry from Runtime source', () => {
    const entry = resolvePlatformMcpServerEntry(pathToFileURL(resolve('src/runtime.ts')));
    expect(entry).toBe(resolve('../mcp-server/platform-mcp-server.mjs'));
  });

  it('supports source, dist, and packaged Runtime layouts', () => {
    const fixtures = [
      {
        module: 'D:/repo/apps/runtime/src/runtime.ts',
        expected: 'D:/repo/apps/mcp-server/platform-mcp-server.mjs',
      },
      {
        module: 'D:/repo/apps/runtime/dist/runtime.js',
        expected: 'D:/repo/apps/mcp-server/platform-mcp-server.mjs',
      },
      {
        module: 'D:/release/resources/runtime/dist/runtime.js',
        expected: 'D:/release/resources/runtime/mcp-server/platform-mcp-server.mjs',
      },
    ];

    for (const fixture of fixtures) {
      const expected = resolve(fixture.expected);
      expect(
        resolvePlatformMcpServerEntry(pathToFileURL(fixture.module), (path) => path === expected),
      ).toBe(expected);
    }
  });

  it('returns undefined when no supported entry exists', () => {
    expect(
      resolvePlatformMcpServerEntry(pathToFileURL('D:/missing/runtime.js'), () => false),
    ).toBeUndefined();
  });
});
