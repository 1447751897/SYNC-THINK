/**
 * @vitest-environment jsdom
 *
 * readAvatarImage must produce a `data:` URL (the shell CSP allows
 * img-src data: but blocks blob:). It reads the file through FileReader and
 * downscales via canvas — jsdom cannot decode images or draw, so Image load
 * is simulated and the canvas element is faked.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { AgentAvatarView, readAvatarImage } from './AgentAvatarView.js';

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
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('unseeded agent faces', () => {
  it('uses the same folded workspace face as chat instead of a letter badge', async () => {
    vi.stubGlobal('Path2D', class {});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
      fill: vi.fn(),
      clip: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      stroke: vi.fn(),
      ellipse: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    render(<AgentAvatarView name="测试设计员" avatar="" size={34} />);
    expect(screen.queryByText('测')).toBeNull();
    expect(await screen.findByRole('img', { name: '测试设计员' })).toBeTruthy();
    await waitFor(() => expect(document.querySelector('canvas.agent-workspace-avatar')).toBeTruthy());
  });

  it('keeps an explicitly chosen text avatar as a letter disk', () => {
    render(<AgentAvatarView name="测试设计员" avatar="测" size={34} />);
    expect(screen.getByText('测')).toBeTruthy();
    expect(document.querySelector('canvas.agent-workspace-avatar')).toBeNull();
  });
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
