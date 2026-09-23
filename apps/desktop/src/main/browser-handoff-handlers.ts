import type {
  BrowserHandoffCommand,
  BrowserHandoffCommandRequest,
  BrowserHandoffCommandResponse,
} from '@sync-think/protocol';
import {
  parseCancelBrowserHandoffPayload,
  parseContinueBrowserHandoffPayload,
  parseListWaitingBrowserHandoffsPayload,
} from '../browser-handoff-payloads.js';

export interface BrowserHandoffHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestBrowserHandoff<K extends BrowserHandoffCommand>(
    command: K,
    payload: BrowserHandoffCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<BrowserHandoffCommandResponse<K>>;
}

export function registerBrowserHandoffHandlers<Event>(host: BrowserHandoffHost<Event>): void {
  host.handle('runtime:browser-handoff-list-waiting', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBrowserHandoff(
      'browser.handoff.listWaiting',
      parseListWaitingBrowserHandoffsPayload(value),
    );
  });

  host.handle('runtime:browser-handoff-continue', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBrowserHandoff(
      'browser.handoff.continue',
      parseContinueBrowserHandoffPayload(value),
    );
  });

  host.handle('runtime:browser-handoff-cancel', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBrowserHandoff(
      'browser.handoff.cancel',
      parseCancelBrowserHandoffPayload(value),
    );
  });
}
