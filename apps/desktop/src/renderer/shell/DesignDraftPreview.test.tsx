/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DesignDraftPreview } from './DesignDraftPreview.js';

const executeJavaScript = vi.fn();
const writeText = vi.fn();
const openHtmlInBrowser = vi.fn();
const readProjectFile = vi.fn();
const writeProjectFile = vi.fn();
const createObjectURL = vi.fn();
const revokeObjectURL = vi.fn();
const anchorClick = vi.fn();

beforeEach(() => {
  executeJavaScript.mockResolvedValue(420);
  openHtmlInBrowser.mockResolvedValue({ ok: true, error: null, path: 'D:/temp/design.html' });
  readProjectFile.mockResolvedValue({
    path: 'designs/aurora-dashboard.html',
    content: null,
    error: '文件不存在',
    errorCode: 'file_not_found',
    mtimeMs: null,
    size: null,
  });
  writeProjectFile.mockResolvedValue({
    path: 'designs/aurora-dashboard.html',
    ok: true,
    conflict: false,
    error: null,
    errorCode: null,
    mtimeMs: 42,
    size: 128,
  });
  createObjectURL.mockReturnValue('blob:design-draft');

  Object.defineProperty(HTMLElement.prototype, 'executeJavaScript', {
    configurable: true,
    value: executeJavaScript,
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
  Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
    configurable: true,
    value: anchorClick,
  });
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: {
      runtime: { openHtmlInBrowser, readProjectFile, writeProjectFile },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Reflect.deleteProperty(window, 'syncThink');
  delete (HTMLElement.prototype as HTMLElement & { executeJavaScript?: unknown }).executeJavaScript;
});

describe('DesignDraftPreview', () => {
  const validHtml =
    '<!doctype html><html><head><title>Aurora Dashboard</title></head><body><main>Version one</main></body></html>';

  it('keeps the last valid preview when a later render is empty or malformed', async () => {
    const { rerender } = render(<DesignDraftPreview code={validHtml} projectFolder="D:/work/demo" />);

    const before = screen.getByTestId('html-sandbox').getAttribute('src') ?? '';
    expect(decodeURIComponent(before)).toContain('Version one');

    rerender(<DesignDraftPreview code="   " projectFolder="D:/work/demo" />);

    expect(await screen.findByText(/已保留上一版/)).toBeTruthy();
    const after = screen.getByTestId('html-sandbox').getAttribute('src') ?? '';
    expect(decodeURIComponent(after)).toContain('Version one');
    expect(decodeURIComponent(after)).not.toContain('   ');

    rerender(
      <DesignDraftPreview code="<main><section>unfinished</main>" projectFolder="D:/work/demo" />,
    );
    expect(await screen.findByText(/HTML 标签未正确闭合/)).toBeTruthy();
    expect(decodeURIComponent(screen.getByTestId('html-sandbox').getAttribute('src') ?? '')).toContain(
      'Version one',
    );
  });

  it('keeps design drafts focused on the rendered UI with action controls', async () => {
    render(<DesignDraftPreview code={validHtml} projectFolder="D:/work/demo" />);

    expect(screen.queryByRole('button', { name: '预览' })).toBeNull();
    expect(screen.queryByRole('button', { name: '源码' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '复制' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(validHtml));

    fireEvent.click(screen.getByRole('button', { name: '浏览器打开' }));
    await waitFor(() => expect(openHtmlInBrowser).toHaveBeenCalledWith(validHtml));

    fireEvent.click(screen.getByRole('button', { name: '下载' }));
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(anchorClick).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:design-draft'));

    fireEvent.click(screen.getByRole('button', { name: '保存到项目' }));
    await waitFor(() =>
      expect(writeProjectFile).toHaveBeenCalledWith({
        root: 'D:/work/demo',
        path: 'designs/aurora-dashboard.html',
        content: validHtml,
        expectedMtimeMs: null,
        expectedSize: null,
      }),
    );
    expect(await screen.findByText('已保存到 designs/aurora-dashboard.html')).toBeTruthy();
  });

  it('hands the stable design path to the embedded browser opener', async () => {
    const onOpenInBrowser = vi.fn().mockResolvedValue(undefined);
    render(
      <DesignDraftPreview
        code={validHtml}
        projectFolder="D:/work/demo"
        onOpenInBrowser={onOpenInBrowser}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '浏览器打开' }));
    await waitFor(() =>
      expect(onOpenInBrowser).toHaveBeenCalledWith(validHtml, {
        relativePath: 'designs/aurora-dashboard.html',
        persist: true,
      }),
    );
  });

  it('shows a useful invalid state when no previous valid draft exists', () => {
    render(<DesignDraftPreview code="plain text" projectFolder="D:/work/demo" />);

    expect(screen.getByRole('alert').textContent).toContain('设计稿必须包含 HTML 元素');
    expect(screen.queryByTestId('html-sandbox')).toBeNull();
  });

  it('reports a save conflict without overwriting the project file', async () => {
    readProjectFile.mockResolvedValueOnce({
      path: 'designs/aurora-dashboard.html',
      content: '<main>disk</main>',
      error: null,
      errorCode: null,
      mtimeMs: 23,
      size: 17,
    });
    writeProjectFile.mockResolvedValueOnce({
      path: 'designs/aurora-dashboard.html',
      ok: false,
      conflict: true,
      error: '文件已在磁盘上发生变化',
      errorCode: 'file_conflict',
      mtimeMs: 24,
      size: 18,
    });
    render(<DesignDraftPreview code={validHtml} projectFolder="D:/work/demo" />);

    fireEvent.click(screen.getByRole('button', { name: '保存到项目' }));

    expect(await screen.findByText('目标文件刚刚发生变化，请再次保存')).toBeTruthy();
    expect(writeProjectFile).toHaveBeenCalledWith(
      expect.objectContaining({ expectedMtimeMs: 23, expectedSize: 17 }),
    );
    expect(writeProjectFile).toHaveBeenCalledTimes(1);
  });

  it('uses returned metadata to update an existing design above the read-preview limit', async () => {
    readProjectFile.mockResolvedValueOnce({
      path: 'designs/aurora-dashboard.html',
      content: null,
      error: '文件超过 512KB，暂不支持编辑',
      errorCode: 'file_too_large',
      mtimeMs: 31,
      size: 600_000,
    });
    render(<DesignDraftPreview code={validHtml} projectFolder="D:/work/demo" />);

    fireEvent.click(screen.getByRole('button', { name: '保存到项目' }));

    await waitFor(() =>
      expect(writeProjectFile).toHaveBeenCalledWith(
        expect.objectContaining({ expectedMtimeMs: 31, expectedSize: 600_000 }),
      ),
    );
    expect(await screen.findByText('已保存到 designs/aurora-dashboard.html')).toBeTruthy();
  });

  it('revokes the download URL even when the synthetic click fails', async () => {
    anchorClick.mockImplementationOnce(() => {
      throw new Error('download blocked');
    });
    render(<DesignDraftPreview code={validHtml} projectFolder="D:/work/demo" />);

    fireEvent.click(screen.getByRole('button', { name: '下载' }));

    expect(await screen.findByText('下载失败，请重试')).toBeTruthy();
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:design-draft'));
  });
});
