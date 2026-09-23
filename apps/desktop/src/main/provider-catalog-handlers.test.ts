import { describe, expect, it, vi } from 'vitest';
import { PROVIDER_CATALOG_RUNTIME_IPC_CHANNELS } from '../runtime-bridge-contract.js';
import {
  registerProviderCatalogHandlers,
  type ProviderCatalogHost,
} from './provider-catalog-handlers.js';

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
    requestProviderCatalog: request as ProviderCatalogHost<string>['requestProviderCatalog'],
  };
  registerProviderCatalogHandlers(host);
  return { handlers, host, order, request, response };
}

describe('Provider Catalog IPC boundary', () => {
  it('registers the five catalog lifecycle commands', () => {
    expect([...fixture().handlers.keys()]).toEqual(
      Object.values(PROVIDER_CATALOG_RUNTIME_IPC_CHANNELS),
    );
  });

  it.each([
    [PROVIDER_CATALOG_RUNTIME_IPC_CHANNELS.list, {}, 'provider.list', {}],
    [
      PROVIDER_CATALOG_RUNTIME_IPC_CHANNELS.reorder,
      { orderedProviderIds: [' provider-2 ', 'provider-1'] },
      'provider.reorder',
      { orderedProviderIds: ['provider-2', 'provider-1'] },
    ],
    [
      PROVIDER_CATALOG_RUNTIME_IPC_CHANNELS.delete,
      { providerId: ' provider-1 ' },
      'provider.delete',
      { providerId: 'provider-1' },
    ],
  ])('forwards %s through its typed command', async (channel, value, command, payload) => {
    const { handlers, order, request, response } = fixture();
    await expect(handlers.get(channel)!('trusted', value)).resolves.toBe(response);
    expect(request).toHaveBeenCalledWith(command, payload);
    expect(order).toEqual(['source', 'connect', `request:${command}`]);
  });

  it('injects clipboard credentials only for create and rotating update', async () => {
    const created = fixture();
    await created.handlers.get(PROVIDER_CATALOG_RUNTIME_IPC_CHANNELS.create)!('trusted', {
      name: ' Gateway ',
      baseUrl: ' https://api.example/v1 ',
      protocol: 'openai-chat',
    });
    expect(created.host.readClipboardText).toHaveBeenCalledOnce();
    expect(created.request).toHaveBeenCalledWith(
      'provider.create',
      expect.objectContaining({
        name: 'Gateway',
        baseUrl: 'https://api.example/v1',
        apiKey: 'secret-key',
      }),
    );

    const updated = fixture();
    await updated.handlers.get(PROVIDER_CATALOG_RUNTIME_IPC_CHANNELS.update)!('trusted', {
      providerId: 'provider-1',
      credentialLabel: 'rotated',
      rotateCredentialFromClipboard: true,
    });
    expect(updated.host.readClipboardText).toHaveBeenCalledOnce();
    expect(updated.request).toHaveBeenCalledWith(
      'provider.update',
      expect.objectContaining({ providerId: 'provider-1', apiKey: 'secret-key' }),
    );

    const metadataOnly = fixture();
    await metadataOnly.handlers.get(PROVIDER_CATALOG_RUNTIME_IPC_CHANNELS.update)!('trusted', {
      providerId: 'provider-1',
      enabled: false,
    });
    expect(metadataOnly.host.readClipboardText).not.toHaveBeenCalled();
  });

  it('rejects untrusted senders before connection, parsing and clipboard access', async () => {
    const { handlers, host, request } = fixture();
    host.assertSource.mockImplementation(() => {
      throw new Error('untrusted sender');
    });
    await expect(
      handlers.get(PROVIDER_CATALOG_RUNTIME_IPC_CHANNELS.create)!('untrusted', null),
    ).rejects.toThrow('untrusted sender');
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(host.readClipboardText).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    [PROVIDER_CATALOG_RUNTIME_IPC_CHANNELS.create, { name: 'missing fields' }],
    [PROVIDER_CATALOG_RUNTIME_IPC_CHANNELS.update, { providerId: 'provider-1' }],
    [PROVIDER_CATALOG_RUNTIME_IPC_CHANNELS.list, 'invalid'],
    [PROVIDER_CATALOG_RUNTIME_IPC_CHANNELS.reorder, { orderedProviderIds: [] }],
    [PROVIDER_CATALOG_RUNTIME_IPC_CHANNELS.delete, {}],
  ])(
    'connects before rejecting invalid %s payloads without transport',
    async (channel, payload) => {
      const { handlers, host, order, request } = fixture();
      await expect(handlers.get(channel)!('trusted', payload)).rejects.toThrow(/Invalid/);
      expect(host.ensureConnection).toHaveBeenCalledOnce();
      expect(order).toEqual(['source', 'connect']);
      expect(request).not.toHaveBeenCalled();
    },
  );

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get(PROVIDER_CATALOG_RUNTIME_IPC_CHANNELS.list)!('trusted', {}),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get(PROVIDER_CATALOG_RUNTIME_IPC_CHANNELS.delete)!('trusted', {
        providerId: 'provider-1',
      }),
    ).rejects.toBe(failure);
  });
});
