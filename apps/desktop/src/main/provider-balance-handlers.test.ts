import { describe, expect, it, vi } from 'vitest';
import { PROVIDER_BALANCE_RUNTIME_IPC_CHANNELS } from '../runtime-bridge-contract.js';
import {
  registerProviderBalanceHandlers,
  type ProviderBalanceHost,
} from './provider-balance-handlers.js';

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const response = { supported: false };
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
    requestProviderBalance: request as ProviderBalanceHost<string>['requestProviderBalance'],
  };
  registerProviderBalanceHandlers(host);
  return { handlers, host, order, request, response };
}

describe('Provider Balance IPC boundary', () => {
  it('registers the balance query', () => {
    expect([...fixture().handlers.keys()]).toEqual(
      Object.values(PROVIDER_BALANCE_RUNTIME_IPC_CHANNELS),
    );
  });

  it('forwards a normalized payload through typed transport', async () => {
    const { handlers, order, request, response } = fixture();
    await expect(
      handlers.get(PROVIDER_BALANCE_RUNTIME_IPC_CHANNELS.query)!('trusted', {
        providerId: ' provider-1 ',
        credentialRefId: 'credential-1',
      }),
    ).resolves.toBe(response);
    expect(request).toHaveBeenCalledWith('provider.balance', {
      providerId: 'provider-1',
      credentialRefId: 'credential-1',
    });
    expect(order).toEqual(['source', 'connect', 'request:provider.balance']);
  });

  it('rejects untrusted senders before connection and parsing', async () => {
    const { handlers, host, request } = fixture();
    host.assertSource.mockImplementation(() => {
      throw new Error('untrusted sender');
    });
    await expect(
      handlers.get(PROVIDER_BALANCE_RUNTIME_IPC_CHANNELS.query)!('untrusted', null),
    ).rejects.toThrow('untrusted sender');
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('connects before rejecting an invalid payload', async () => {
    const { handlers, host, order, request } = fixture();
    await expect(
      handlers.get(PROVIDER_BALANCE_RUNTIME_IPC_CHANNELS.query)!('trusted', {}),
    ).rejects.toThrow(/Invalid provider-balance/);
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get(PROVIDER_BALANCE_RUNTIME_IPC_CHANNELS.query)!('trusted', {
        providerId: 'provider-1',
      }),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get(PROVIDER_BALANCE_RUNTIME_IPC_CHANNELS.query)!('trusted', {
        providerId: 'provider-1',
      }),
    ).rejects.toBe(failure);
  });
});
