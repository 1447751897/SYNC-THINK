import type {
  ProviderCcSwitchCommand,
  ProviderCcSwitchCommandRequest,
  ProviderCcSwitchCommandResponse,
} from '@sync-think/protocol';
import {
  parseImportCcSwitchPayload,
  parsePreviewCcSwitchImportPayload,
} from '../provider-cc-switch-payloads.js';
import { PROVIDER_CC_SWITCH_RUNTIME_IPC_CHANNELS } from '../runtime-bridge-contract.js';

export interface ProviderCcSwitchHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestProviderCcSwitch<K extends ProviderCcSwitchCommand>(
    command: K,
    payload: ProviderCcSwitchCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<ProviderCcSwitchCommandResponse<K>>;
}

export function registerProviderCcSwitchHandlers<Event>(host: ProviderCcSwitchHost<Event>): void {
  host.handle(PROVIDER_CC_SWITCH_RUNTIME_IPC_CHANNELS.preview, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestProviderCcSwitch(
      'provider.previewCcSwitchImport',
      parsePreviewCcSwitchImportPayload(value),
    );
  });

  host.handle(PROVIDER_CC_SWITCH_RUNTIME_IPC_CHANNELS.import, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestProviderCcSwitch(
      'provider.importCcSwitch',
      parseImportCcSwitchPayload(value),
    );
  });
}
