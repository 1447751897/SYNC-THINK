/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileAsDataUrl } from './compose-mention.js';
class Reader {
  static last: Reader;
  result: string | null = null;
  error: Error | null = null;
  onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void;
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  constructor() {
    Reader.last = this;
  }
  readAsDataURL = vi.fn();
  abort = vi.fn(() => this.onabort?.());
}
afterEach(() => vi.unstubAllGlobals());
describe('image FileReader lifecycle', () => {
  it('reports byte progress and releases the abort listener after completion', async () => {
    vi.stubGlobal('FileReader', Reader);
    const controller = new AbortController();
    const progress = vi.fn();
    const result = readFileAsDataUrl(new File(['test'], 'test.png'), {
      signal: controller.signal,
      onProgress: progress,
    });
    Reader.last.onprogress?.({ lengthComputable: true, loaded: 2, total: 4 });
    Reader.last.result = 'data:image/png;base64,AAAA';
    Reader.last.onload?.();
    expect(await result).toBe('data:image/png;base64,AAAA');
    expect(progress).toHaveBeenCalledWith(0.5);
    controller.abort();
    expect(Reader.last.abort).not.toHaveBeenCalled();
  });
  it('rejects an active cancelled read and aborts the reader', async () => {
    vi.stubGlobal('FileReader', Reader);
    const controller = new AbortController();
    const result = readFileAsDataUrl(new File([], 'test.png'), { signal: controller.signal });
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await assertion;
    expect(Reader.last.abort).toHaveBeenCalledOnce();
  });
  it('does not start a read when already cancelled', async () => {
    vi.stubGlobal('FileReader', Reader);
    const controller = new AbortController();
    controller.abort();
    await expect(
      readFileAsDataUrl(new File([], 'test.png'), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(Reader.last.readAsDataURL).not.toHaveBeenCalled();
  });
  it('propagates read failure and ignores unmeasurable progress', async () => {
    vi.stubGlobal('FileReader', Reader);
    const progress = vi.fn();
    const result = readFileAsDataUrl(new File([], 'test.png'), { onProgress: progress });
    Reader.last.onprogress?.({ lengthComputable: false, loaded: 2, total: 0 });
    Reader.last.error = new Error('disk read failed');
    Reader.last.onerror?.();
    await expect(result).rejects.toThrow('disk read failed');
    expect(progress).not.toHaveBeenCalled();
  });
});
