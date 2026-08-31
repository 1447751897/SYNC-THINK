/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MarkdownContent } from './MarkdownContent.js';

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
    fireEvent.click(link);

    expect(onOpenFile).toHaveBeenCalledWith(
      'apps/desktop/src/renderer/shell/PreferencesSettings.tsx',
      { line: 73, column: 1 },
    );
    expect(container.querySelector('[data-resource-kind="code"] svg')).toBeTruthy();
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
    fireEvent.click(link);

    expect(openExternalUrl).toHaveBeenCalledWith('https://example.test/docs');
    const resource = container.querySelector('[data-resource-kind="external"]');
    expect(resource?.getAttribute('data-source-host')).toBe('example.test');
    expect(resource?.querySelector('.shell-external-source-icon svg')).toBeTruthy();
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
