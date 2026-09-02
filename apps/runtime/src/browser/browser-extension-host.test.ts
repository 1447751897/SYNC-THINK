import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { BrowserExtensionHost } from './browser-extension-host.js';

function waitForMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolveMessage, rejectMessage) => {
    const onMessage = (data: WebSocket.RawData) => {
      socket.off('error', onError);
      resolveMessage(JSON.parse(Buffer.from(data as Buffer).toString('utf8')) as Record<string, unknown>);
    };
    const onError = (error: Error) => {
      socket.off('message', onMessage);
      rejectMessage(error);
    };
    socket.once('message', onMessage);
    socket.once('error', onError);
  });
}

function waitForClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolveClose) => {
    socket.once('close', (code, reason) =>
      resolveClose({ code, reason: reason.toString('utf8') }),
    );
  });
}

function mockSettings() {
  const values = new Map<string, unknown>();
  return {
    values,
    get(key: string) {
      const value = values.get(key);
      return value === undefined ? undefined : { key, value, updatedAt: new Date().toISOString() };
    },
    set(key: string, value: unknown) {
      values.set(key, value);
      return { key, value, updatedAt: new Date().toISOString() };
    },
  } as never;
}

describe('BrowserExtensionHost', () => {
  it('speaks NewMax pairing, hello, ping and request/response messages', async () => {
    const host = new BrowserExtensionHost({
      appSettingStore: mockSettings(),
      port: 19737,
      extensionDirectory: 'D:/projects/SYNC-THINK/.tmp/browser-extension-host-test',
    });
    await host.start();
    const socket = new WebSocket('ws://127.0.0.1:19737/browser-extension/v1');
    await new Promise<void>((resolveOpen, rejectOpen) => {
      socket.once('open', () => resolveOpen());
      socket.once('error', rejectOpen);
    });

    socket.send(JSON.stringify({ type: 'pairing.request', protocolVersion: 1, extensionVersion: '1.1.4' }));
    const details = await waitForMessage(socket);
    expect(details.type).toBe('pairing.details');
    expect(typeof details.token).toBe('string');

    socket.send(
      JSON.stringify({
        type: 'hello',
        protocolVersion: 1,
        token: details.token,
        extensionVersion: '1.1.4',
      }),
    );
    const ready = await waitForMessage(socket);
    expect(ready).toMatchObject({ type: 'ready', protocolVersion: 1, extensionVersion: '1.1.4' });
    expect(host.status()).toMatchObject({ hostAvailable: true, connected: true, state: 'connected' });

    socket.send(JSON.stringify({ type: 'ping', timestamp: 123 }));
    expect(await waitForMessage(socket)).toEqual({ type: 'pong', timestamp: 123 });

    const request = host.request('tabs.create', { profileId: 'default', url: 'about:blank' });
    const requestMessage = await waitForMessage(socket);
    expect(requestMessage).toMatchObject({ type: 'request', method: 'tabs.create' });
    socket.send(JSON.stringify({ type: 'response', id: requestMessage.id, result: { tabId: '1' } }));
    await expect(request).resolves.toEqual({ tabId: '1' });

    socket.close();
    await host.stop();
  });

  it('rejects invalid token and protocol version with NewMax close codes', async () => {
    const host = new BrowserExtensionHost({ port: 19738, extensionDirectory: 'D:/projects/SYNC-THINK/.tmp/browser-extension-host-test-2' });
    await host.start();
    const invalid = new WebSocket('ws://127.0.0.1:19738/browser-extension/v1');
    await new Promise<void>((resolveOpen, rejectOpen) => {
      invalid.once('open', () => resolveOpen());
      invalid.once('error', rejectOpen);
    });
    invalid.send(JSON.stringify({ type: 'hello', protocolVersion: 1, token: 'bad', extensionVersion: '1.1.4' }));
    await expect(waitForClose(invalid)).resolves.toEqual({ code: 1008, reason: 'Authentication failed' });

    const mismatch = new WebSocket('ws://127.0.0.1:19738/browser-extension/v1');
    await new Promise<void>((resolveOpen, rejectOpen) => {
      mismatch.once('open', () => resolveOpen());
      mismatch.once('error', rejectOpen);
    });
    mismatch.send(JSON.stringify({ type: 'pairing.request', protocolVersion: 99 }));
    await expect(waitForClose(mismatch)).resolves.toEqual({ code: 1002, reason: 'Unsupported protocol version' });
    await host.stop();
  });
});
