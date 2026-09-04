/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MarkdownContent } from './MarkdownContent.js';
import { siteFaviconUrl } from './ExternalSourceIcon.js';

const shellCss = readFileSync(resolve(process.cwd(), 'src/renderer/shell/shell.css'), 'utf8');

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MarkdownContent resources', () => {
  it('opens a workspace file with its line location and renders a file icon', () => {
    const onOpenFile = vi.fn();
    const { container } = render(
      <MarkdownContent
        text="[PreferencesSettings.tsx](D:/projects/MYSELF/SYNC-THINK/apps/desktop/src/renderer/shell/PreferencesSettings.tsx:73)"
        projectFolder="D:/projects/MYSELF/SYNC-THINK"
        onOpenFile={onOpenFile}
      />,
    );

    const link = screen.getByRole('button', { name: '打开文件 PreferencesSettings.tsx，第 73 行' });
    expect(link.getAttribute('title')).toBe(
      'D:/projects/MYSELF/SYNC-THINK/apps/desktop/src/renderer/shell/PreferencesSettings.tsx (line 73)',
    );
    expect(link.textContent).toContain('PreferencesSettings.tsx (line 73)');
    fireEvent.click(link);

    expect(onOpenFile).toHaveBeenCalledWith(
      'apps/desktop/src/renderer/shell/PreferencesSettings.tsx',
      { line: 73, column: 1 },
    );
    const icon = container.querySelector('[data-resource-kind="code"] [data-file-type="typescript"]');
    expect(icon?.textContent).toBe('TS');
    expect(icon?.querySelector('svg')).toBeNull();
  });

  it('renders a CSS badge for stylesheet workspace files', () => {
    const { container } = render(
      <MarkdownContent
        text="[shell.css](D:/projects/MYSELF/SYNC-THINK/apps/desktop/src/renderer/shell/shell.css:10)"
        projectFolder="D:/projects/MYSELF/SYNC-THINK"
        onOpenFile={vi.fn()}
      />,
    );

    expect(container.querySelector('[data-file-type="css"]')?.textContent).toBe('CSS');
  });

  it('opens an external link through the controlled desktop bridge', () => {
    const openExternalUrl = vi.fn().mockResolvedValue({ opened: true, error: null });
    Object.defineProperty(window, 'syncThink', {
      configurable: true,
      value: { runtime: { openExternalUrl } },
    });
    const { container } = render(
      <MarkdownContent text="[NewMax 文档](https://example.test/docs)" />,
    );

    const link = screen.getByRole('link', { name: '打开网页 NewMax 文档' });
    expect(link.getAttribute('title')).toBe('https://example.test/docs');
    expect(link.textContent).toContain('NewMax 文档');
    expect(link.textContent).not.toContain('https://example.test/docs');
    fireEvent.click(link);

    expect(openExternalUrl).toHaveBeenCalledWith('https://example.test/docs');
    const resource = container.querySelector('[data-resource-kind="external"]');
    expect(resource?.getAttribute('data-source-host')).toBe('example.test');
    expect(resource?.querySelector('.shell-external-source-icon img')?.getAttribute('src')).toBe(
      siteFaviconUrl('example.test'),
    );
    expect(resource?.querySelector('.shell-external-source-icon svg')).toBeNull();
  });

  it('loads a remote site favicon for an unknown documentation host', () => {
    const { container } = render(
      <MarkdownContent text="[GPT-5.6 模型](https://developers.openai.com/api/docs/models/gpt-5.6)" />,
    );

    const icon = container.querySelector('.shell-external-source-icon img');
    expect(icon?.getAttribute('src')).toBe(siteFaviconUrl('developers.openai.com'));
    expect(container.querySelector('.shell-external-source-icon svg')).toBeNull();
  });

  it('keeps dashed underlines off until a file or web link is hovered', () => {
    expect(shellCss).toMatch(
      /\.shell-md a\.shell-web-link,\s*\.shell-web-link\s*\{[\s\S]*?text-decoration:\s*none;/,
    );
    expect(shellCss).toMatch(
      /\.shell-web-link:hover,\s*\.shell-web-link:focus-visible\s*\{[\s\S]*?text-decoration-style:\s*dashed;/,
    );
    expect(shellCss).toMatch(
      /\.shell-md-resource--file\s*\{[\s\S]*?text-decoration:\s*none;/,
    );
    expect(shellCss).toMatch(
      /\.shell-md-resource--file:hover,\s*\.shell-md-resource--file:focus-visible\s*\{[\s\S]*?text-decoration-style:\s*dashed;/,
    );
  });

  it('centers file-type badges on the same line as the path text', () => {
    expect(shellCss).toMatch(
      /\.shell-md-resource--file\s*\{[\s\S]*?display:\s*inline-flex;[\s\S]*?align-items:\s*center;[\s\S]*?vertical-align:\s*middle;/,
    );
    expect(shellCss).toMatch(
      /\.shell-md-resource \.shell-file-type-icon\s*\{[\s\S]*?vertical-align:\s*middle;/,
    );
  });

  it('uses the matching local connector icon for a known streaming source', () => {
    const { container } = render(
      <MarkdownContent text="来源：[视频](https://www.youtube.com/watch?v=demo)" streaming />,
    );

    const resource = container.querySelector('[data-resource-kind="external"]');
    expect(resource?.getAttribute('data-source-connector')).toBe('youtube');
    expect(resource?.querySelector('.shell-external-source-icon img')).toBeTruthy();
  });

  it('uses the Beautiful UI site icon instead of the generic web globe', () => {
    const { container } = render(
      <MarkdownContent text="来源：[Beautiful UI](https://www.beautifului.dev/)" streaming />,
    );

    const resource = container.querySelector('[data-resource-kind="external"]');
    expect(resource?.getAttribute('data-source-connector')).toBe('beautiful-ui');
    expect(resource?.querySelector('.shell-external-source-icon img')).toBeTruthy();
    expect(resource?.querySelector('.shell-external-source-icon svg')).toBeNull();
  });

  it('does not turn parent-directory traversal into a workspace open action', () => {
    const onOpenFile = vi.fn();
    render(
      <MarkdownContent
        text="[outside](apps/desktop/src/renderer/shell/../.. )"
        projectFolder="D:/projects/MYSELF/SYNC-THINK"
        onOpenFile={onOpenFile}
      />,
    );

    expect(screen.getByRole('link', { name: 'outside' })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(onOpenFile).not.toHaveBeenCalled();
  });
});
