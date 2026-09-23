import { describe, expect, it, vi } from 'vitest';
import { PROVIDER_MODEL_RUNTIME_IPC_CHANNELS } from '../runtime-bridge-contract.js';
import {
  registerProviderModelHandlers,
  type ProviderModelHost,
} from './provider-model-handlers.js';

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const response = { ok: true };
  const request = vi.fn(async (command: string) => {
    order.push(`request:${command}`);
    return response;
  });
  const host = {
    handle: (channel: string, listener: (event: string, value: unknown) => Promise<unknown>) => {
      handlers.set(channel, listener);
    },
    assertSource: vi.fn(() => order.push('source')),
    ensureConnection: vi.fn(async () => {
      order.push('connect');
    }),
    requestProviderModel: request as ProviderModelHost<string>['requestProviderModel'],
  };
  registerProviderModelHandlers(host);
  return { handlers, host, order, request, response };
}

describe('Provider Model IPC boundary', () => {
  it('registers the four model-management commands', () => {
    expect([...fixture().handlers.keys()]).toEqual(
      Object.values(PROVIDER_MODEL_RUNTIME_IPC_CHANNELS),
    );
  });

  it.each([
    [
      PROVIDER_MODEL_RUNTIME_IPC_CHANNELS.add,
      {
        providerId: 'provider-1',
        protocol: 'openai-chat',
        models: [{ providerModelId: 'manual-model' }],
      },
      'provider.addModels',
      {
        providerId: 'provider-1',
        protocol: 'openai-chat',
        models: [{ providerModelId: 'manual-model' }],
      },
    ],
    [
      PROVIDER_MODEL_RUNTIME_IPC_CHANNELS.setPriorities,
      { providerId: ' provider-1 ', entries: [{ modelId: ' model-1 ' }] },
      'provider.setModelPriorities',
      { providerId: 'provider-1', entries: [{ modelId: 'model-1', credentialRefId: undefined }] },
    ],
    [
      PROVIDER_MODEL_RUNTIME_IPC_CHANNELS.update,
      { providerId: ' provider-1 ', modelId: ' model-1 ', displayName: ' Renamed ' },
      'provider.updateModel',
      {
        providerId: 'provider-1',
        modelId: 'model-1',
        displayName: 'Renamed',
        contextWindow: undefined,
      },
    ],
    [
      PROVIDER_MODEL_RUNTIME_IPC_CHANNELS.remove,
      { providerId: ' provider-1 ', modelId: ' model-1 ' },
      'provider.removeModel',
      { providerId: 'provider-1', modelId: 'model-1' },
    ],
  ])('forwards %s through its typed command', async (channel, value, command, payload) => {
    const { handlers, order, request, response } = fixture();
    await expect(handlers.get(channel)!('trusted', value)).resolves.toBe(response);
    expect(request).toHaveBeenCalledWith(command, payload);
    expect(order).toEqual(['source', 'connect', `request:${command}`]);
  });

  it('rejects untrusted senders before connection and parsing', async () => {
    const { handlers, host, request } = fixture();
    host.assertSource.mockImplementation(() => {
      throw new Error('untrusted sender');
    });
    await expect(
      handlers.get(PROVIDER_MODEL_RUNTIME_IPC_CHANNELS.add)!('untrusted', null),
    ).rejects.toThrow('untrusted sender');
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    [PROVIDER_MODEL_RUNTIME_IPC_CHANNELS.add, {}],
    [PROVIDER_MODEL_RUNTIME_IPC_CHANNELS.setPriorities, { providerId: 'provider-1', entries: [] }],
    [PROVIDER_MODEL_RUNTIME_IPC_CHANNELS.update, { providerId: 'provider-1', modelId: 'model-1' }],
    [PROVIDER_MODEL_RUNTIME_IPC_CHANNELS.remove, { providerId: 'provider-1' }],
  ])('connects before rejecting invalid %s payloads', async (channel, payload) => {
    const { handlers, host, order, request } = fixture();
    await expect(handlers.get(channel)!('trusted', payload)).rejects.toThrow(/Invalid/);
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get(PROVIDER_MODEL_RUNTIME_IPC_CHANNELS.remove)!('trusted', {
        providerId: 'provider-1',
        modelId: 'model-1',
      }),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get(PROVIDER_MODEL_RUNTIME_IPC_CHANNELS.remove)!('trusted', {
        providerId: 'provider-1',
        modelId: 'model-1',
      }),
    ).rejects.toBe(failure);
  });
});
