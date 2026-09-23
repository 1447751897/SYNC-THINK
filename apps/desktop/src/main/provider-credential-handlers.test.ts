import { describe, expect, it, vi } from 'vitest';
import { PROVIDER_CREDENTIAL_RUNTIME_IPC_CHANNELS } from '../runtime-bridge-contract.js';
import {
  registerProviderCredentialHandlers,
  type ProviderCredentialHost,
} from './provider-credential-handlers.js';

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
    requestProviderCredential:
      request as ProviderCredentialHost<string>['requestProviderCredential'],
  };
  registerProviderCredentialHandlers(host);
  return { handlers, host, order, request, response };
}

describe('Provider Credential IPC boundary', () => {
  it('registers the five credential lifecycle commands', () => {
    expect([...fixture().handlers.keys()]).toEqual(
      Object.values(PROVIDER_CREDENTIAL_RUNTIME_IPC_CHANNELS),
    );
  });

  it.each([
    [
      PROVIDER_CREDENTIAL_RUNTIME_IPC_CHANNELS.remove,
      { providerId: ' provider-1 ', credentialRefId: ' credential-1 ' },
      'provider.removeCredential',
      { providerId: 'provider-1', credentialRefId: 'credential-1' },
    ],
    [
      PROVIDER_CREDENTIAL_RUNTIME_IPC_CHANNELS.clear,
      { providerId: ' provider-1 ' },
      'provider.clearCredentials',
      { providerId: 'provider-1' },
    ],
    [
      PROVIDER_CREDENTIAL_RUNTIME_IPC_CHANNELS.reveal,
      { providerId: ' provider-1 ', credentialRefId: ' credential-1 ' },
      'provider.revealCredential',
      { providerId: 'provider-1', credentialRefId: 'credential-1' },
    ],
  ])('forwards %s through its typed command', async (channel, value, command, payload) => {
    const { handlers, order, request, response } = fixture();
    await expect(handlers.get(channel)!('trusted', value)).resolves.toBe(response);
    expect(request).toHaveBeenCalledWith(command, payload);
    expect(order).toEqual(['source', 'connect', `request:${command}`]);
  });

  it('reads one clipboard secret for add and rotating update', async () => {
    const added = fixture();
    await added.handlers.get(PROVIDER_CREDENTIAL_RUNTIME_IPC_CHANNELS.add)!('trusted', {
      providerId: ' provider-1 ',
      label: ' primary ',
    });
    expect(added.host.readClipboardText).toHaveBeenCalledOnce();
    expect(added.request).toHaveBeenCalledWith('provider.addCredential', {
      providerId: 'provider-1',
      label: 'primary',
      apiKey: 'secret-key',
    });

    const updated = fixture();
    await updated.handlers.get(PROVIDER_CREDENTIAL_RUNTIME_IPC_CHANNELS.update)!('trusted', {
      providerId: 'provider-1',
      credentialRefId: 'credential-1',
      rotateCredentialFromClipboard: true,
    });
    expect(updated.host.readClipboardText).toHaveBeenCalledOnce();
    expect(updated.request).toHaveBeenCalledWith(
      'provider.updateCredential',
      expect.objectContaining({ apiKey: 'secret-key' }),
    );
  });

  it('does not read the clipboard for a label-only update', async () => {
    const { handlers, host, request } = fixture();
    await handlers.get(PROVIDER_CREDENTIAL_RUNTIME_IPC_CHANNELS.update)!('trusted', {
      providerId: 'provider-1',
      credentialRefId: 'credential-1',
      label: 'renamed',
    });
    expect(host.readClipboardText).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith('provider.updateCredential', {
      providerId: 'provider-1',
      credentialRefId: 'credential-1',
      label: 'renamed',
    });
  });

  it('rejects unusable clipboard values without transport', async () => {
    const { handlers, host, request } = fixture();
    host.readClipboardText.mockReturnValue('   ');
    await expect(
      handlers.get(PROVIDER_CREDENTIAL_RUNTIME_IPC_CHANNELS.add)!('trusted', {
        providerId: 'provider-1',
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
      handlers.get(PROVIDER_CREDENTIAL_RUNTIME_IPC_CHANNELS.add)!('untrusted', null),
    ).rejects.toThrow('untrusted sender');
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(host.readClipboardText).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    [PROVIDER_CREDENTIAL_RUNTIME_IPC_CHANNELS.add, {}],
    [PROVIDER_CREDENTIAL_RUNTIME_IPC_CHANNELS.remove, { providerId: 'provider-1' }],
    [PROVIDER_CREDENTIAL_RUNTIME_IPC_CHANNELS.clear, null],
    [PROVIDER_CREDENTIAL_RUNTIME_IPC_CHANNELS.reveal, { providerId: 'provider-1' }],
    [
      PROVIDER_CREDENTIAL_RUNTIME_IPC_CHANNELS.update,
      { providerId: 'provider-1', credentialRefId: 'credential-1' },
    ],
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
      connectionFixture.handlers.get(PROVIDER_CREDENTIAL_RUNTIME_IPC_CHANNELS.clear)!('trusted', {
        providerId: 'provider-1',
      }),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get(PROVIDER_CREDENTIAL_RUNTIME_IPC_CHANNELS.reveal)!('trusted', {
        providerId: 'provider-1',
        credentialRefId: 'credential-1',
      }),
    ).rejects.toBe(failure);
  });
});
