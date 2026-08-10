/**
 * @vitest-environment jsdom
 *
 * readAvatarImage must produce a `data:` URL (the shell CSP allows
 * img-src data: but blocks blob:). It reads the file through FileReader and
 * downscales via canvas — jsdom cannot decode images or draw, so Image load
 * is simulated and the canvas element is faked.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readAvatarImage } from './AgentAvatarView.js';

function stubDom() {
  // Fake canvas returned by document.createElement('canvas').
  const canvasObj = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ({ drawImage: vi.fn() })),
    toDataURL: vi.fn(() => 'data:image/webp;base64,ZmFrZQ=='),
  };
  const originalCreate = document.createElement.bind(document);
  const createMock = (tag: string): HTMLElement => {
    if (String(tag).toLowerCase() === 'canvas') {
      return canvasObj as unknown as HTMLElement;
    }
    return originalCreate(tag as keyof HTMLElementTagNameMap);
  };
  vi.spyOn(document, 'createElement').mockImplementation(
    createMock as unknown as typeof document.createElement,
  );

  // Fake Image that "decodes" asynchronously.
  class FakeImage {
    naturalWidth = 200;
    naturalHeight = 100;
    private cb: (() => void) | null = null;
    set src(_value: string) {
      setTimeout(() => this.cb?.(), 0);
    }
    set onload(cb: (() => void) | null) {
      this.cb = cb;
    }
    get onload(): (() => void) | null {
      return this.cb;
    }
    set onerror(_cb: (() => void) | null) {}
    get onerror(): (() => void) | null {
      return null;
    }
  }
  vi.stubGlobal('Image', FakeImage);
  return canvasObj;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('readAvatarImage', () => {
  it('returns a webp data URL for a readable image', async () => {
    const canvasObj = stubDom();
    const file = new File(['fake'], 'avatar.png', { type: 'image/png' });
    const dataUrl = await readAvatarImage(file);
    expect(dataUrl.startsWith('data:image/webp')).toBe(true);
    expect(dataUrl).toContain('ZmFrZQ==');
    expect(canvasObj.getContext).toHaveBeenCalledWith('2d');
  });

  it('rejects with a readable message when the file cannot be read', async () => {
    stubDom();
    // Simulate a FileReader failure (jsdom's real FileReader always succeeds).
    class FailingFileReader {
      result: string | ArrayBuffer | null = null;
      onerror: ((event: ProgressEvent) => void) | null = null;
      onload: ((event: ProgressEvent) => void) | null = null;
      readAsDataURL(): void {
        setTimeout(() => this.onerror?.(new ProgressEvent('error')), 0);
      }
    }
    Object.defineProperty(window, 'FileReader', {
      configurable: true,
      value: FailingFileReader,
    });
    const file = new File(['fake'], 'avatar.png', { type: 'image/png' });
    await expect(readAvatarImage(file)).rejects.toThrow('无法读取该图片文件');
  });
});
