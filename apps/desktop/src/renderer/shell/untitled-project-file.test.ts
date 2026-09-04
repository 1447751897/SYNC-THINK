/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import {
  allocateUntitledCanvasPath,
  allocateUntitledDocumentPath,
} from './untitled-project-file.js';

describe('untitled project file paths', () => {
  it('uses notes/未命名文档.md for the first document draft', () => {
    expect(allocateUntitledDocumentPath([])).toBe('notes/未命名文档.md');
  });

  it('increments the document name when that tab is already open', () => {
    expect(allocateUntitledDocumentPath(['notes/未命名文档.md'])).toBe('notes/未命名文档-2.md');
    expect(allocateUntitledDocumentPath(['notes/未命名文档.md', 'notes/未命名文档-2.md'])).toBe(
      'notes/未命名文档-3.md',
    );
  });

  it('uses designs/未命名绘图.excalidraw for the first canvas draft', () => {
    expect(allocateUntitledCanvasPath([])).toBe('designs/未命名绘图.excalidraw');
  });

  it('increments the canvas name when that tab is already open', () => {
    expect(allocateUntitledCanvasPath(['designs/未命名绘图.excalidraw'])).toBe(
      'designs/未命名绘图-2.excalidraw',
    );
  });
});
