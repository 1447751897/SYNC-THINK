import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProviderCallControl } from './call-control.js';

afterEach(() => vi.useRealTimers());

describe('provider stream watchdog', () => {
  it('allows active requests to run beyond the old two-minute total deadline', async () => {
    vi.useFakeTimers();
    const control = createProviderCallControl(new AbortController().signal);
    try {
      for (let index = 0; index < 4; index++) {
        let complete!: () => void;
        const read = control.waitFor(() => new Promise<void>((resolve) => { complete = resolve; }));
        await vi.advanceTimersByTimeAsync(120_001);
        expect(control.signal.aborted).toBe(false);
        complete();
        await read;
      }
      expect(control.timedOut()).toBe(false);
    } finally { control.cleanup(); }
  });

  it('aborts a pending read only after five minutes without provider data', async () => {
    vi.useFakeTimers();
    const control = createProviderCallControl(new AbortController().signal);
    const read = control.waitFor(() => new Promise<void>(() => undefined));
    const rejected = expect(read).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(299_999);
    expect(control.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(control.timedOut()).toBe(true);
    control.cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps an explicitly configured total deadline independent of stream progress', async () => {
    vi.useFakeTimers();
    const control = createProviderCallControl(new AbortController().signal, 100);
    await control.waitFor(async () => 'first chunk');
    const read = control.waitFor(() => new Promise<void>(() => undefined));
    const rejected = expect(read).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(control.timedOut()).toBe(true);
    control.cleanup();
  });

  it('supports opting out of idle timeouts without losing manual cancellation', async () => {
    vi.useFakeTimers();
    const external = new AbortController();
    const control = createProviderCallControl(external.signal, null, null);
    const read = control.waitFor(() => new Promise<void>(() => undefined));
    const rejected = expect(read).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(control.signal.aborted).toBe(false);
    external.abort();
    await rejected;
    expect(control.timedOut()).toBe(false);
    control.cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not run the idle watchdog while the consumer processes a completed read', async () => {
    vi.useFakeTimers();
    const control = createProviderCallControl(new AbortController().signal);
    await control.waitFor(async () => 'chunk');
    await vi.advanceTimersByTimeAsync(600_000);
    expect(control.signal.aborted).toBe(false);
    control.cleanup();
  });
});
