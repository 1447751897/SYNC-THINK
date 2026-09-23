import { describe, expect, it, vi } from 'vitest';
import { WEB_SEARCH_PROVIDER_IDS } from '@sync-think/protocol';
import { WEB_SEARCH_PROVIDER_RUNTIME_IPC_CHANNELS } from '../runtime-bridge-contract.js';
import {
  registerWebSearchProviderHandlers,
  type WebSearchProviderHost,
} from './web-search-provider-handlers.js';

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const request = vi.fn(async (command: string) => {
    order.push(`request:${command}`);
    return { command };
  });
  const host = {
    handle: (channel: string, listener: (event: string, value: unknown) => Promise<unknown>) => {
      handlers.set(channel, listener);
    },
    assertSource: vi.fn(() => order.push('source')),
    ensureConnection: vi.fn(async () => {
      order.push('connect');
    }),
    requestWebSearchProvider: request as WebSearchProviderHost<string>['requestWebSearchProvider'],
  };
  registerWebSearchProviderHandlers(host);
  return { handlers, host, order, request };
}

describe('Web Search Provider IPC boundary', () => {
  it('registers all provider management handlers', () => {
    expect([...fixture().handlers.keys()]).toEqual(
      Object.values(WEB_SEARCH_PROVIDER_RUNTIME_IPC_CHANNELS),
    );
  });

  it('forwards normalized payloads through typed transport', async () => {
    const { handlers, request } = fixture();
    await handlers.get(WEB_SEARCH_PROVIDER_RUNTIME_IPC_CHANNELS.list)!('trusted', undefined);
    await handlers.get(WEB_SEARCH_PROVIDER_RUNTIME_IPC_CHANNELS.save)!('trusted', {
      providerId: 'tavily',
      enabled: true,
      apiKey: ' key ',
    });
    await handlers.get(WEB_SEARCH_PROVIDER_RUNTIME_IPC_CHANNELS.reorder)!('trusted', {
      providerIds: [...WEB_SEARCH_PROVIDER_IDS].reverse(),
    });
    await handlers.get(WEB_SEARCH_PROVIDER_RUNTIME_IPC_CHANNELS.test)!('trusted', {
      providerId: 'brave',
      query: ' test query ',
    });

    expect(request).toHaveBeenNthCalledWith(1, 'webSearch.providers.list', {});
    expect(request).toHaveBeenNthCalledWith(2, 'webSearch.providers.save', {
      providerId: 'tavily',
      enabled: true,
      apiKey: 'key',
    });
    expect(request).toHaveBeenNthCalledWith(3, 'webSearch.providers.reorder', {
      providerIds: [...WEB_SEARCH_PROVIDER_IDS].reverse(),
    });
    expect(request).toHaveBeenNthCalledWith(4, 'webSearch.providers.test', {
      providerId: 'brave',
      query: 'test query',
    });
  });

  it('rejects untrusted senders before connection and parsing', async () => {
    const { handlers, host, request } = fixture();
    host.assertSource.mockImplementation(() => {
      throw new Error('untrusted sender');
    });
    await expect(
      handlers.get(WEB_SEARCH_PROVIDER_RUNTIME_IPC_CHANNELS.save)!('untrusted', null),
    ).rejects.toThrow('untrusted sender');
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    [WEB_SEARCH_PROVIDER_RUNTIME_IPC_CHANNELS.list, { includeDisabled: 'yes' }, /list payload/],
    [WEB_SEARCH_PROVIDER_RUNTIME_IPC_CHANNELS.save, {}, /save payload/],
    [WEB_SEARCH_PROVIDER_RUNTIME_IPC_CHANNELS.reorder, { providerIds: [] }, /reorder payload/],
    [WEB_SEARCH_PROVIDER_RUNTIME_IPC_CHANNELS.test, {}, /test payload/],
  ])('connects before rejecting invalid payload on %s', async (channel, value, message) => {
    const { handlers, host, order, request } = fixture();
    await expect(handlers.get(channel)!('trusted', value)).rejects.toThrow(message);
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get(WEB_SEARCH_PROVIDER_RUNTIME_IPC_CHANNELS.list)!(
        'trusted',
        {},
      ),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get(WEB_SEARCH_PROVIDER_RUNTIME_IPC_CHANNELS.test)!('trusted', {
        providerId: 'tavily',
      }),
    ).rejects.toBe(failure);
  });
});
