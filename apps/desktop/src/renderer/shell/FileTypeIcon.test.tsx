/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { FileTypeIcon } from './FileTypeIcon.js';
afterEach(cleanup);
it.each([
  ['package.json', 'json'],
  ['.mcp.json', 'json'],
  ['settings.jsonc', 'json'],
  ['README.md', 'markdown'],
  ['guide.mdx', 'markdown'],
  ['build-shell.mjs', 'javascript'],
  ['module.cjs', 'javascript'],
  ['script.js', 'javascript'],
  ['git-contract.ts', 'typescript'],
  ['types.d.ts', 'typescript'],
  ['main.cts', 'typescript'],
  ['ChatView.tsx', 'react-typescript'],
  ['App.jsx', 'react-javascript'],
  ['D:\\repo\\CONFIG.JSON', 'json'],
  ['unknown.xyz', 'text'],
])('uses the matching file-type icon for %s', (path, kind) => {
  const { container } = render(<FileTypeIcon path={path} />);
  expect(container.firstElementChild?.getAttribute('data-file-type')).toBe(kind);
});
it('uses vector Markdown and React marks and compact JS/TS badges', () => {
  const { container } = render(
    <>
      <FileTypeIcon path="README.md" />
      <FileTypeIcon path="ChatView.tsx" />
      <FileTypeIcon path="main.ts" />
      <FileTypeIcon path="main.js" />
    </>,
  );
  expect(container.querySelector('[data-file-type="markdown"] svg')).toBeTruthy();
  expect(container.querySelector('[data-file-type="react-typescript"] svg')).toBeTruthy();
  expect(container.querySelector('[data-file-type="typescript"]')?.textContent).toBe('TS');
  expect(container.querySelector('[data-file-type="javascript"]')?.textContent).toBe('JS');
});
