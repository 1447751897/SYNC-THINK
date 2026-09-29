import { describe, expect, it } from 'vitest';
import { workspaceResourceFromHref } from './markdown-resource.js';
describe('workspace citation target', () => {
  it.each(['src/main.ts#L23', 'D:/work/src/main.ts:23', 'D:\\work\\src\\main.ts:23'])(
    'keeps line positions for %s',
    (href) => {
      expect(workspaceResourceFromHref(href, 'D:/work')).toMatchObject({
        path: 'src/main.ts',
        location: { line: 23, column: 1 },
      });
    },
  );
  it('keeps line and column and supports encoded Chinese paths', () => {
    expect(workspaceResourceFromHref('src/%E4%BB%A3%E7%A0%81.ts#L7C3', 'D:/work')).toMatchObject({
      path: 'src/代码.ts',
      location: { line: 7, column: 3 },
    });
  });
  it.each([
    '../secret.txt',
    '%2e%2e/secret.txt',
    'D:/outside/secret.txt',
    'https://example.test/a.ts',
    '#L7',
    'javascript:alert(1)',
    'data:text/plain,hello',
    '//server/share.ts',
  ])('rejects non-workspace target %s', (href) => {
    expect(workspaceResourceFromHref(href, 'D:/work')).toBeNull();
  });
  it('treats POSIX paths as case-sensitive', () => {
    expect(workspaceResourceFromHref('/work/OTHER/app.ts', '/work/other')).toBeNull();
  });
});
