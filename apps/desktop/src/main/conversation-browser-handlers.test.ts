import { describe, expect, it, vi } from 'vitest';
import {
  registerConversationBrowserHandlers,
  type ConversationBrowserHost,
} from './conversation-browser-handlers.js';

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const response = { requestId: 'request-1', accepted: true };
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
    requestConversation: request as ConversationBrowserHost<string>['requestConversation'],
  };
  registerConversationBrowserHandlers(host);
  return { handlers, host, order, request, response };
}

describe('conversation browser IPC boundary', () => {
  it('registers and forwards the browser result with the existing ordering', async () => {
    const { handlers, order, request, response } = fixture();
    expect([...handlers.keys()]).toEqual(['runtime:conversation-submit-browser-result']);
    await expect(
      handlers.get('runtime:conversation-submit-browser-result')!('trusted', {
        requestId: 'request-1',
        ok: false,
        error: 'webview closed',
      }),
    ).resolves.toBe(response);
    expect(request).toHaveBeenCalledWith('conversation.submitBrowserResult', {
      requestId: 'request-1',
      ok: false,
      resultJson: undefined,
      error: 'webview closed',
    });
    expect(order).toEqual(['source', 'connect', 'request:conversation.submitBrowserResult']);
  });

  it('rejects untrusted senders before connection and transport', async () => {
    const { handlers, host, request } = fixture();
    host.assertSource.mockImplementation(() => {
      throw new Error('untrusted sender');
    });
    await expect(
      handlers.get('runtime:conversation-submit-browser-result')!('untrusted', {
        requestId: 'request-1',
        ok: true,
      }),
    ).rejects.toThrow('untrusted sender');
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('connects before rejecting oversized renderer content without transport', async () => {
    const { handlers, host, order, request } = fixture();
    await expect(
      handlers.get('runtime:conversation-submit-browser-result')!('trusted', {
        requestId: 'request-1',
        ok: true,
        resultJson: 'x'.repeat(96_001),
      }),
    ).rejects.toThrow('Invalid conversation-submit-browser-result payload');
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get('runtime:conversation-submit-browser-result')!('trusted', {
        requestId: 'request-1',
        ok: true,
      }),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get('runtime:conversation-submit-browser-result')!('trusted', {
        requestId: 'request-1',
        ok: true,
      }),
    ).rejects.toBe(failure);
  });
});
