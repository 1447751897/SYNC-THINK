import { describe, expect, it, vi } from 'vitest';
import { PROVIDER_CC_SWITCH_RUNTIME_IPC_CHANNELS } from '../runtime-bridge-contract.js';
import {
  registerProviderCcSwitchHandlers,
  type ProviderCcSwitchHost,
} from './provider-cc-switch-handlers.js';

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
    requestProviderCcSwitch: request as ProviderCcSwitchHost<string>['requestProviderCcSwitch'],
  };
  registerProviderCcSwitchHandlers(host);
  return { handlers, host, order, request };
}

describe('Provider CC Switch IPC boundary', () => {
  it('registers preview and import handlers', () => {
    expect([...fixture().handlers.keys()]).toEqual(
      Object.values(PROVIDER_CC_SWITCH_RUNTIME_IPC_CHANNELS),
    );
  });

  it('forwards preview and import payloads through typed transport', async () => {
    const { handlers, order, request } = fixture();
    await handlers.get(PROVIDER_CC_SWITCH_RUNTIME_IPC_CHANNELS.preview)!('trusted', undefined);
    await handlers.get(PROVIDER_CC_SWITCH_RUNTIME_IPC_CHANNELS.import)!('trusted', {
      sourceIds: ['source-1'],
      dbPath: 'D:/cc-switch.db',
    });
    expect(request).toHaveBeenNthCalledWith(1, 'provider.previewCcSwitchImport', {});
    expect(request).toHaveBeenNthCalledWith(2, 'provider.importCcSwitch', {
      sourceIds: ['source-1'],
      dbPath: 'D:/cc-switch.db',
    });
    expect(order).toEqual([
      'source',
      'connect',
      'request:provider.previewCcSwitchImport',
      'source',
      'connect',
      'request:provider.importCcSwitch',
    ]);
  });

  it('rejects untrusted senders before connection and parsing', async () => {
    const { handlers, host, request } = fixture();
    host.assertSource.mockImplementation(() => {
      throw new Error('untrusted sender');
    });
    await expect(
      handlers.get(PROVIDER_CC_SWITCH_RUNTIME_IPC_CHANNELS.import)!('untrusted', null),
    ).rejects.toThrow('untrusted sender');
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('connects before rejecting an invalid payload', async () => {
    const { handlers, host, order, request } = fixture();
    await expect(
      handlers.get(PROVIDER_CC_SWITCH_RUNTIME_IPC_CHANNELS.import)!('trusted', {}),
    ).rejects.toThrow(/Invalid import-cc-switch payload/);
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get(PROVIDER_CC_SWITCH_RUNTIME_IPC_CHANNELS.preview)!(
        'trusted',
        {},
      ),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get(PROVIDER_CC_SWITCH_RUNTIME_IPC_CHANNELS.import)!('trusted', {
        sourceIds: ['source-1'],
      }),
    ).rejects.toBe(failure);
  });
});
