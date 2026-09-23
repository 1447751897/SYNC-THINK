import type {
  BrowserProfileCommand,
  BrowserProfileCommandRequest,
  BrowserProfileCommandResponse,
} from '@sync-think/protocol';
import {
  parseClearBrowserSiteSessionPayload,
  parseCreateBrowserProfilePayload,
  parseDeleteBrowserProfilePayload,
  parseListBrowserProfilesPayload,
  parseListBrowserSiteSessionsPayload,
  parseRenameBrowserProfilePayload,
} from '../browser-profile-payloads.js';

export interface BrowserProfileHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestBrowserProfile<K extends BrowserProfileCommand>(
    command: K,
    payload: BrowserProfileCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<BrowserProfileCommandResponse<K>>;
}

export function registerBrowserProfileHandlers<Event>(host: BrowserProfileHost<Event>): void {
  host.handle('runtime:browser-profile-list', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBrowserProfile(
      'browser.profile.list',
      parseListBrowserProfilesPayload(value),
    );
  });

  host.handle('runtime:browser-profile-create', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBrowserProfile(
      'browser.profile.create',
      parseCreateBrowserProfilePayload(value),
    );
  });

  host.handle('runtime:browser-profile-rename', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBrowserProfile(
      'browser.profile.rename',
      parseRenameBrowserProfilePayload(value),
    );
  });

  host.handle('runtime:browser-profile-delete', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBrowserProfile(
      'browser.profile.delete',
      parseDeleteBrowserProfilePayload(value),
    );
  });

  host.handle('runtime:browser-profile-list-site-sessions', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBrowserProfile(
      'browser.profile.listSiteSessions',
      parseListBrowserSiteSessionsPayload(value),
    );
  });

  host.handle('runtime:browser-profile-clear-site-session', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBrowserProfile(
      'browser.profile.clearSiteSession',
      parseClearBrowserSiteSessionPayload(value),
    );
  });
}
