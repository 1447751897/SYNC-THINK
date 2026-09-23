import type {
  ProviderModelCommand,
  ProviderModelCommandRequest,
  ProviderModelCommandResponse,
} from '@sync-think/protocol';
import {
  parseAddModelsPayload,
  parseRemoveModelPayload,
  parseSetModelPrioritiesPayload,
  parseUpdateModelPayload,
} from '../provider-model-payloads.js';
import { PROVIDER_MODEL_RUNTIME_IPC_CHANNELS } from '../runtime-bridge-contract.js';

export interface ProviderModelHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestProviderModel<K extends ProviderModelCommand>(
    command: K,
    payload: ProviderModelCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<ProviderModelCommandResponse<K>>;
}

export function registerProviderModelHandlers<Event>(host: ProviderModelHost<Event>): void {
  host.handle(PROVIDER_MODEL_RUNTIME_IPC_CHANNELS.add, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestProviderModel('provider.addModels', parseAddModelsPayload(value));
  });

  host.handle(PROVIDER_MODEL_RUNTIME_IPC_CHANNELS.setPriorities, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestProviderModel(
      'provider.setModelPriorities',
      parseSetModelPrioritiesPayload(value),
    );
  });

  host.handle(PROVIDER_MODEL_RUNTIME_IPC_CHANNELS.update, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestProviderModel('provider.updateModel', parseUpdateModelPayload(value));
  });

  host.handle(PROVIDER_MODEL_RUNTIME_IPC_CHANNELS.remove, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestProviderModel('provider.removeModel', parseRemoveModelPayload(value));
  });
}
