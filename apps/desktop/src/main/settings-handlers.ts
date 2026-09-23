import type {
  SettingsCommand,
  SettingsCommandRequest,
  SettingsCommandResponse,
} from '@sync-think/protocol';
import { parseGetSettingsPayload, parseSetSettingPayload } from '../provider-payloads.js';

export interface SettingsHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestSettings<K extends SettingsCommand>(
    command: K,
    payload: SettingsCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<SettingsCommandResponse<K>>;
}

export function registerSettingsHandlers<Event>(host: SettingsHost<Event>): void {
  host.handle('runtime:settings-get', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestSettings('settings.get', parseGetSettingsPayload(value));
  });

  host.handle('runtime:settings-set', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestSettings('settings.set', parseSetSettingPayload(value));
  });
}
