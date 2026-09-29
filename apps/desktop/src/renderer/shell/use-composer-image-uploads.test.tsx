/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useComposerImageUploads } from './use-composer-image-uploads.js';
import { readFileAsDataUrl, type ComposeAttachment } from './compose-mention.js';
import { compressImageDataUrl } from './image-compress.js';
vi.mock('./compose-mention.js', async (original) => ({
  ...(await original<object>()),
  readFileAsDataUrl: vi.fn(),
}));
vi.mock('./image-compress.js', () => ({ compressImageDataUrl: vi.fn() }));
const read = vi.mocked(readFileAsDataUrl);
const compress = vi.mocked(compressImageDataUrl);
const file = (name = 'photo.png') => new File(['image'], name, { type: 'image/png' });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function useFixture(scope = 'one', initial: ComposeAttachment[] = [], onError = vi.fn()) {
  const [attachments, setAttachments] = useState(initial);
  return {
    ...useComposerImageUploads({ attachments, setAttachments, scopeKey: scope, onError }),
    attachments,
  };
}
beforeEach(() => {
  read.mockReset();
  compress.mockReset();
  read.mockResolvedValue('data:image/png;base64,raw');
  compress.mockResolvedValue({
    dataUrl: 'data:image/png;base64,AAAA',
    mimeType: 'image/png',
  } as Awaited<ReturnType<typeof compressImageDataUrl>>);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useComposerImageUploads', () => {
  it('retains capacity reservations until ready state is committed', async () => {
    const { result } = renderHook(() => useFixture());
    await act(async () => {
      await result.current.addFiles(Array.from({ length: 8 }, (_, index) => file(index + '.png')));
      await result.current.addFiles([file('too-many.png')]);
    });
    expect(result.current.attachments).toHaveLength(8);
    expect(read).toHaveBeenCalledTimes(8);
  });
  it('stages immediately, uses read progress, and only sends fully prepared images', async () => {
    const reading = deferred<string>();
    read.mockReturnValueOnce(reading.promise);
    const { result } = renderHook(() => useFixture());
    act(() => {
      void result.current.addFiles([file()]);
    });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.attachments).toHaveLength(0);
    expect(result.current.isBusy()).toBe(true);
    act(() => read.mock.calls[0][1]?.onProgress?.(0.5));
    expect(result.current.items[0].progress).toBe(40);
    await act(async () => reading.resolve('data:image/png;base64,raw'));
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.attachments[0].previewUrl).toBe('data:image/png;base64,AAAA');
    expect(result.current.attachments[0].progress).toBeUndefined();
  });
  it('reserves the image cap across rapid batches without dropping file references', async () => {
    const reading = deferred<string>();
    read.mockReturnValue(reading.promise);
    const reference: ComposeAttachment = { path: '/ref.md', name: 'ref.md', kind: 'file' };
    const { result } = renderHook(() => useFixture('one', [reference]));
    act(() => {
      void result.current.addFiles(Array.from({ length: 6 }, (_, i) => file(`${i}.png`)));
      void result.current.addFiles(Array.from({ length: 6 }, (_, i) => file(`next${i}.png`)));
    });
    expect(result.current.items.filter((item) => item.kind === 'image')).toHaveLength(8);
    await act(async () => reading.resolve('data:image/png;base64,raw'));
    await waitFor(() => expect(result.current.attachments).toHaveLength(9));
    expect(result.current.attachments[0]).toEqual(reference);
  });
  it('processes queued files sequentially and keeps their stable identities when ready', async () => {
    const reading = deferred<string>();
    read.mockReturnValueOnce(reading.promise);
    const { result } = renderHook(() => useFixture());
    act(() => {
      void result.current.addFiles([file('one.png'), file('two.png')]);
    });
    const paths = result.current.items.map((item) => item.path);
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => reading.resolve('data:image/png;base64,raw'));
    await waitFor(() => expect(result.current.isBusy()).toBe(false));
    expect(result.current.attachments.map((item) => item.path)).toEqual(paths);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('cancels processing without resurrecting removed attachments', async () => {
    const optimizing = deferred<Awaited<ReturnType<typeof compressImageDataUrl>>>();
    compress.mockReturnValueOnce(optimizing.promise);
    const { result } = renderHook(() => useFixture());
    await act(async () => {
      void result.current.addFiles([file()]);
    });
    const path = result.current.items[0].path;
    act(() => result.current.remove(path));
    await act(async () =>
      optimizing.resolve({
        dataUrl: 'data:image/png;base64,AAAA',
        mimeType: 'image/png',
      } as Awaited<ReturnType<typeof compressImageDataUrl>>),
    );
    expect(result.current.items).toHaveLength(0);
    expect(result.current.attachments).toHaveLength(0);
    expect(result.current.isBusy()).toBe(false);
  });
  it('discards work from a previous conversation and accepts files in the next one', async () => {
    const reading = deferred<string>();
    read.mockReturnValueOnce(reading.promise);
    const { result, rerender } = renderHook(({ scope }) => useFixture(scope), {
      initialProps: { scope: 'one' },
    });
    act(() => {
      void result.current.addFiles([file('old.png')]);
    });
    rerender({ scope: 'two' });
    expect(result.current.items).toHaveLength(0);
    act(() => {
      void result.current.addFiles([file('new.png')]);
    });
    await act(async () => reading.resolve('old'));
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.attachments.map((item) => item.name)).toEqual(['new.png']);
  });
  it('removes a failed placeholder, reports the failure, and continues the queue', async () => {
    read.mockRejectedValueOnce(new Error('failed'));
    const error = vi.fn();
    const { result } = renderHook(() => useFixture('one', [], error));
    await act(async () => {
      await result.current.addFiles([file('bad.png'), file('good.png')]);
    });
    expect(error).toHaveBeenCalledTimes(1);
    expect(result.current.attachments.map((item) => item.name)).toEqual(['good.png']);
    expect(result.current.isBusy()).toBe(false);
  });
  it('revokes local previews on cancellation and unmount', async () => {
    const create = vi.fn().mockReturnValue('blob:preview');
    const revoke = vi.fn();
    class PreviewURL extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    }
    vi.stubGlobal('URL', PreviewURL);
    const reading = deferred<string>();
    read.mockReturnValueOnce(reading.promise);
    const { result, unmount } = renderHook(() => useFixture());
    act(() => {
      void result.current.addFiles([file()]);
    });
    expect(result.current.items[0].previewUrl).toBe('blob:preview');
    unmount();
    expect(revoke).toHaveBeenCalledWith('blob:preview');
    expect(read.mock.calls[0][1]?.signal?.aborted).toBe(true);
    await act(async () => reading.resolve('late'));
    vi.unstubAllGlobals();
  });
});
