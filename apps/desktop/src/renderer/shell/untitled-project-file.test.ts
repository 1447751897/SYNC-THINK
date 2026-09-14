/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';
import {
  allocateUntitledCanvasPath,
  allocateUntitledDocumentPath,
  createUntitledProjectFile,
  UNTITLED_DOCUMENT_CONTENT,
} from './untitled-project-file.js';

describe('untitled project file paths', () => {
  it('uses 未命名文档.md at the workspace root for the first document draft', () => {
    expect(allocateUntitledDocumentPath([])).toBe('未命名文档.md');
  });

  it('increments the document name with a space when that tab is already open', () => {
    expect(allocateUntitledDocumentPath(['未命名文档.md'])).toBe('未命名文档 2.md');
    expect(allocateUntitledDocumentPath(['未命名文档.md', '未命名文档 2.md'])).toBe(
      '未命名文档 3.md',
    );
  });

  it('uses 未命名绘图.excalidraw at the workspace root for the first canvas draft', () => {
    expect(allocateUntitledCanvasPath([])).toBe('未命名绘图.excalidraw');
  });

  it('increments the canvas name with a space when that tab is already open', () => {
    expect(allocateUntitledCanvasPath(['未命名绘图.excalidraw'])).toBe('未命名绘图 2.excalidraw');
  });

  it('writes an empty document to disk and retries a conflicting name', async () => {
    const write = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        conflict: true,
        error: 'exists',
        path: '未命名文档.md',
      })
      .mockResolvedValueOnce({
        ok: true,
        conflict: false,
        error: null,
        path: '未命名文档 2.md',
      });
    await expect(
      createUntitledProjectFile({
        kind: 'document',
        openPaths: [],
        canvasContent: '{}',
        write,
      }),
    ).resolves.toEqual({ path: '未命名文档 2.md' });
    expect(write.mock.calls[0]).toEqual(['未命名文档.md', UNTITLED_DOCUMENT_CONTENT]);
    expect(write.mock.calls[1]).toEqual(['未命名文档 2.md', UNTITLED_DOCUMENT_CONTENT]);
  });
});
