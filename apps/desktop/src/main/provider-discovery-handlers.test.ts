import { describe, expect, it, vi } from 'vitest';
import { PROVIDER_DISCOVERY_RUNTIME_IPC_CHANNELS } from '../runtime-bridge-contract.js';
import {
  registerProviderDiscoveryHandlers,
  type ProviderDiscoveryHost,
} from './provider-discovery-handlers.js';

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
    readClipboardText: vi.fn(() => 'secret-key'),
    requestProviderDiscovery: request as ProviderDiscoveryHost<string>['requestProviderDiscovery'],
  };
  registerProviderDiscoveryHandlers(host);
  return { handlers, host, order, request, response };
}

describe('Provider Discovery IPC boundary', () => {
  it('registers the four discovery and capability commands', () => {
    expect([...fixture().handlers.keys()]).toEqual(
      Object.values(PROVIDER_DISCOVERY_RUNTIME_IPC_CHANNELS),
    );
  });

  it.each([
    [
      PROVIDER_DISCOVERY_RUNTIME_IPC_CHANNELS.discoverModels,
      { providerId: 'provider-1', persist: false },
      'provider.discoverModels',
      { providerId: 'provider-1', credentialRefId: undefined, persist: false },
    ],
    [
      PROVIDER_DISCOVERY_RUNTIME_IPC_CHANNELS.probeCapabilities,
      { providerId: 'provider-1', modelId: 'model-1', visionOnly: true },
      'provider.probeCapabilities',
      { providerId: 'provider-1', modelId: 'model-1', visionOnly: true },
    ],
    [
      PROVIDER_DISCOVERY_RUNTIME_IPC_CHANNELS.confirmCapabilities,
      { modelId: 'model-1', capabilities: ['text', 'vision'], confirmed: true },
      'provider.confirmCapabilities',
      {
        modelId: 'model-1',
        capabilities: ['text', 'vision'],
        confirmed: true,
        visionCapabilityOverride: undefined,
      },
    ],
  ])('forwards %s through its typed command', async (channel, value, command, payload) => {
    const { handlers, order, request, response } = fixture();
    await expect(handlers.get(channel)!('trusted', value)).resolves.toBe(response);
    expect(request).toHaveBeenCalledWith(command, payload);
    expect(order).toEqual(['source', 'connect', `request:${command}`]);
  });

  it('injects one clipboard secret into an ephemeral model probe', async () => {
    const { handlers, host, request } = fixture();
    await handlers.get(PROVIDER_DISCOVERY_RUNTIME_IPC_CHANNELS.probeModels)!('trusted', {
      baseUrl: ' https://api.example/v1 ',
      protocol: 'openai-chat',
    });
    expect(host.readClipboardText).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith('provider.probeModels', {
      baseUrl: 'https://api.example/v1',
      protocol: 'openai-chat',
      apiKey: 'secret-key',
    });
  });

  it('rejects unusable clipboard values without transport', async () => {
    const { handlers, host, request } = fixture();
    host.readClipboardText.mockReturnValue('   ');
    await expect(
      handlers.get(PROVIDER_DISCOVERY_RUNTIME_IPC_CHANNELS.probeModels)!('trusted', {
        baseUrl: 'https://api.example/v1',
        protocol: 'openai-chat',
      }),
    ).rejects.toThrow('Provider credential unavailable');
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects untrusted senders before connection, parsing and clipboard access', async () => {
    const { handlers, host, request } = fixture();
    host.assertSource.mockImplementation(() => {
      throw new Error('untrusted sender');
    });
    await expect(
      handlers.get(PROVIDER_DISCOVERY_RUNTIME_IPC_CHANNELS.probeModels)!('untrusted', null),
    ).rejects.toThrow('untrusted sender');
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(host.readClipboardText).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    [PROVIDER_DISCOVERY_RUNTIME_IPC_CHANNELS.discoverModels, {}],
    [PROVIDER_DISCOVERY_RUNTIME_IPC_CHANNELS.probeModels, {}],
    [PROVIDER_DISCOVERY_RUNTIME_IPC_CHANNELS.probeCapabilities, { providerId: '' }],
    [
      PROVIDER_DISCOVERY_RUNTIME_IPC_CHANNELS.confirmCapabilities,
      { modelId: 'model-1', capabilities: [] },
    ],
  ])('connects before rejecting invalid %s payloads', async (channel, payload) => {
    const { handlers, host, order, request } = fixture();
    await expect(handlers.get(channel)!('trusted', payload)).rejects.toThrow(/Invalid/);
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(host.readClipboardText).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get(PROVIDER_DISCOVERY_RUNTIME_IPC_CHANNELS.discoverModels)!(
        'trusted',
        { providerId: 'provider-1' },
      ),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get(PROVIDER_DISCOVERY_RUNTIME_IPC_CHANNELS.probeCapabilities)!(
        'trusted',
        { providerId: 'provider-1' },
      ),
    ).rejects.toBe(failure);
  });
});
