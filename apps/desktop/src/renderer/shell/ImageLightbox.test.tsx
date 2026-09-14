/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ImageLightbox } from './ImageLightbox.js';

afterEach(() => {
  cleanup();
});

function prepareImage(natural: { width: number; height: number }, viewport = { width: 1000, height: 800 }) {
  const area = screen.getByTestId('image-gallery-scroll-area');
  Object.defineProperty(area, 'clientWidth', { configurable: true, value: viewport.width });
  Object.defineProperty(area, 'clientHeight', { configurable: true, value: viewport.height });
  const image = screen.getByRole('img') as HTMLImageElement;
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: natural.width });
  Object.defineProperty(image, 'naturalHeight', { configurable: true, value: natural.height });
  fireEvent.load(image);
  return image;
}

describe('ImageLightbox', () => {
  it('fits to the window using NewMax padding and never scales a smaller image up', async () => {
    render(
      <ImageLightbox
        open
        images={[{ src: 'sync-think-image://generated/a.png', alt: '预览' }]}
        activeIndex={0}
        onClose={() => undefined}
      />,
    );
    const image = prepareImage({ width: 800, height: 600 });
    await waitFor(() => expect(image.style.width).toBe('800px'));
    expect(screen.getByRole('tab', { name: '适应窗口' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('fits width without exceeding 100%', async () => {
    render(
      <ImageLightbox
        open
        images={[{ src: 'sync-think-image://generated/a.png', alt: '预览' }]}
        activeIndex={0}
        onClose={() => undefined}
      />,
    );
    const image = prepareImage({ width: 2000, height: 1000 });
    fireEvent.click(screen.getByRole('tab', { name: '适应宽度' }));
    await waitFor(() => expect(image.style.width).toBe('904px'));
    expect(screen.getByRole('tab', { name: '适应宽度' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('copies and downloads from the lightbox context menu', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    class TestClipboardItem {
      constructor(public readonly items: Record<string, Blob>) {}
    }
    Object.defineProperty(globalThis, 'ClipboardItem', {
      configurable: true,
      value: TestClipboardItem,
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write },
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
    } as Response);

    render(
      <ImageLightbox
        open
        images={[{ src: 'sync-think-image://generated/a.png', alt: '角色卡' }]}
        activeIndex={0}
        onClose={() => undefined}
      />,
    );
    fireEvent.contextMenu(screen.getByRole('img'), { clientX: 120, clientY: 80 });
    expect(await screen.findByRole('menuitem', { name: '复制图片' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '下载原图' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: '复制图片' }));
    await waitFor(() => expect(write).toHaveBeenCalled());
    fetchMock.mockRestore();
  });
});
