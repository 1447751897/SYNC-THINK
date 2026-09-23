import { describe, expect, it, vi } from 'vitest';
import { RendererBrowserCommandBridge } from './renderer-browser-command-bridge.js';

describe('renderer browser command bridge', () => {
  it('registers the waiter before publishing and settles it once', async () => {
    const bridge = new RendererBrowserCommandBridge();
    let accepted = false;
    const pending = bridge.request('request-1', () => {
      accepted = bridge.settle({ requestId: 'request-1', ok: true, resultJson: '{"text":"ok"}' });
    });
    await expect(pending).resolves.toEqual({ ok: true, resultJson: '{"text":"ok"}' });
    expect(accepted).toBe(true);
    expect(bridge.settle({ requestId: 'request-1', ok: true })).toBe(false);
  });

  it('forwards renderer failures without manufacturing result fields', async () => {
    const bridge = new RendererBrowserCommandBridge();
    const pending = bridge.request('request-2', vi.fn());
    expect(
      bridge.settle({ requestId: 'request-2', ok: false, error: 'webview closed' }),
    ).toBe(true);
    await expect(pending).resolves.toEqual({ ok: false, error: 'webview closed' });
  });

  it('rejects unknown replies without affecting live requests', async () => {
    const bridge = new RendererBrowserCommandBridge();
    const pending = bridge.request('live', vi.fn());
    expect(bridge.settle({ requestId: 'unknown', ok: true })).toBe(false);
    expect(bridge.settle({ requestId: 'live', ok: true })).toBe(true);
    await expect(pending).resolves.toEqual({ ok: true });
  });

  it('cancels every live request during Runtime shutdown', async () => {
    const bridge = new RendererBrowserCommandBridge();
    const first = bridge.request('first', vi.fn());
    const second = bridge.request('second', vi.fn());
    expect(bridge.cancelAll('Runtime stopped')).toBe(2);
    await expect(first).resolves.toEqual({ ok: false, error: 'Runtime stopped' });
    await expect(second).resolves.toEqual({ ok: false, error: 'Runtime stopped' });
    expect(bridge.settle({ requestId: 'first', ok: true })).toBe(false);
    expect(bridge.cancelAll('again')).toBe(0);
  });
});
