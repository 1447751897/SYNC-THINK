import type {
  ProviderDiscoveryCommand,
  ProviderDiscoveryCommandRequest,
  ProviderDiscoveryCommandResponse,
} from '@sync-think/protocol';
import {
  parseConfirmCapabilitiesPayload,
  parseDiscoverModelsPayload,
  parseProbeCapabilitiesPayload,
  parseProbeModelsPayload,
} from '../provider-discovery-payloads.js';
import { PROVIDER_DISCOVERY_RUNTIME_IPC_CHANNELS } from '../runtime-bridge-contract.js';
import { probeModelsPayloadFromClipboard } from './provider-clipboard.js';

export interface ProviderDiscoveryHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  readClipboardText(): string;
  requestProviderDiscovery<K extends ProviderDiscoveryCommand>(
    command: K,
    payload: ProviderDiscoveryCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<ProviderDiscoveryCommandResponse<K>>;
}

export function registerProviderDiscoveryHandlers<Event>(host: ProviderDiscoveryHost<Event>): void {
  host.handle(PROVIDER_DISCOVERY_RUNTIME_IPC_CHANNELS.discoverModels, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestProviderDiscovery(
      'provider.discoverModels',
      parseDiscoverModelsPayload(value),
    );
  });

  host.handle(PROVIDER_DISCOVERY_RUNTIME_IPC_CHANNELS.probeModels, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestProviderDiscovery(
      'provider.probeModels',
      probeModelsPayloadFromClipboard(parseProbeModelsPayload(value), () =>
        host.readClipboardText(),
      ),
    );
  });

  host.handle(PROVIDER_DISCOVERY_RUNTIME_IPC_CHANNELS.probeCapabilities, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestProviderDiscovery(
      'provider.probeCapabilities',
      parseProbeCapabilitiesPayload(value),
    );
  });

  host.handle(PROVIDER_DISCOVERY_RUNTIME_IPC_CHANNELS.confirmCapabilities, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestProviderDiscovery(
      'provider.confirmCapabilities',
      parseConfirmCapabilitiesPayload(value),
    );
  });
}
