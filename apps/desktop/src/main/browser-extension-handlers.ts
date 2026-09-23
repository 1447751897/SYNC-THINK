import type {
  BrowserExtensionCommand,
  BrowserExtensionCommandRequest,
  BrowserExtensionCommandResponse,
} from '@sync-think/protocol';

export interface BrowserExtensionHost<Event> {
  handle(channel: string, listener: (event: Event) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestBrowserExtension<K extends BrowserExtensionCommand>(
    command: K,
    payload: BrowserExtensionCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<BrowserExtensionCommandResponse<K>>;
}

export function registerBrowserExtensionHandlers<Event>(host: BrowserExtensionHost<Event>): void {
  host.handle('runtime:browser-extension-status', async (event) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBrowserExtension('browser.extension.status', {});
  });

  host.handle('runtime:browser-extension-restart', async (event) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBrowserExtension('browser.extension.restart', {});
  });

  host.handle('runtime:browser-extension-reset-pairing', async (event) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBrowserExtension('browser.extension.resetPairing', {});
  });

  host.handle('runtime:browser-extension-open-folder', async (event) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBrowserExtension('browser.extension.openFolder', {});
  });
}
