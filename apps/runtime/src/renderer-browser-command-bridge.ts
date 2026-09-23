import type { ConversationSubmitBrowserResultPayload } from '@sync-think/protocol';
import type { RendererBrowserCommandResult } from './browser/renderer-browser-worker.js';

/** In-memory rendezvous between a Runtime browser request and its Renderer reply. */
export class RendererBrowserCommandBridge {
  private readonly pending = new Map<
    string,
    (result: RendererBrowserCommandResult) => void
  >();

  request(requestId: string, publish: () => void): Promise<RendererBrowserCommandResult> {
    return new Promise<RendererBrowserCommandResult>((resolve) => {
      this.pending.set(requestId, resolve);
      publish();
    });
  }

  settle(payload: ConversationSubmitBrowserResultPayload): boolean {
    const resolve = this.pending.get(payload.requestId);
    if (!resolve) return false;
    this.pending.delete(payload.requestId);
    resolve({
      ok: payload.ok,
      ...(payload.resultJson !== undefined ? { resultJson: payload.resultJson } : {}),
      ...(payload.error !== undefined ? { error: payload.error } : {}),
    });
    return true;
  }

  cancelAll(error: string): number {
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const resolve of pending) resolve({ ok: false, error });
    return pending.length;
  }
}
