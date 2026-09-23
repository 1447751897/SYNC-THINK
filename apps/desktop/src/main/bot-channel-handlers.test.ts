import { describe, expect, it, vi } from 'vitest';
import { registerBotChannelHandlers, type BotChannelHost } from './bot-channel-handlers.js';

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const response = { connected: true };
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
    requestBotChannel: request as BotChannelHost<string>['requestBotChannel'],
  };
  registerBotChannelHandlers(host);
  return { handlers, host, order, request, response };
}

describe('Bot Channel IPC boundary', () => {
  it('registers configuration, connectivity and WeChat login commands', () => {
    expect([...fixture().handlers.keys()]).toEqual([
      'runtime:bot-channel-get',
      'runtime:bot-channel-save',
      'runtime:bot-channel-test',
      'runtime:bot-channel-wechat-qr-request',
      'runtime:bot-channel-wechat-qr-check',
    ]);
  });

  it.each([
    ['runtime:bot-channel-get', { platform: 'wecom' }, 'bot.channel.get', { platform: 'wecom' }],
    [
      'runtime:bot-channel-save',
      {
        platform: 'dingtalk',
        enabled: true,
        testConnection: true,
        clientId: ' ding-client ',
        clientSecret: ' ding-secret ',
      },
      'bot.channel.save',
      {
        platform: 'dingtalk',
        enabled: true,
        testConnection: true,
        clientId: 'ding-client',
        clientSecret: 'ding-secret',
      },
    ],
    [
      'runtime:bot-channel-test',
      {
        platform: 'feishu',
        appId: ' app-1 ',
        appSecret: ' secret ',
        domain: 'lark',
        renderMode: 'card',
      },
      'bot.channel.test',
      {
        platform: 'feishu',
        appId: 'app-1',
        appSecret: 'secret',
        domain: 'lark',
        renderMode: 'card',
      },
    ],
    [
      'runtime:bot-channel-wechat-qr-request',
      { baseUrl: ' https://ilinkai.weixin.qq.com ' },
      'bot.channel.wechat.qr.request',
      { baseUrl: 'https://ilinkai.weixin.qq.com' },
    ],
    [
      'runtime:bot-channel-wechat-qr-check',
      { qrcode: ' login-code ', baseUrl: ' https://ilinkai.weixin.qq.com ' },
      'bot.channel.wechat.qr.check',
      { qrcode: 'login-code', baseUrl: 'https://ilinkai.weixin.qq.com' },
    ],
  ])('forwards %s through its typed command', async (channel, value, command, payload) => {
    const { handlers, order, request, response } = fixture();
    await expect(handlers.get(channel)!('trusted', value)).resolves.toBe(response);
    expect(request).toHaveBeenCalledWith(command, payload);
    expect(order).toEqual(['source', 'connect', `request:${command}`]);
  });

  it('rejects untrusted senders before connection, parsing and transport', async () => {
    const { handlers, host, request } = fixture();
    host.assertSource.mockImplementation(() => {
      throw new Error('untrusted sender');
    });
    await expect(handlers.get('runtime:bot-channel-get')!('untrusted', null)).rejects.toThrow(
      'untrusted sender',
    );
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    ['runtime:bot-channel-get', { platform: 'slack' }],
    ['runtime:bot-channel-save', { platform: 'telegram', enabled: 'yes' }],
    ['runtime:bot-channel-test', { platform: 'feishu', domain: 'invalid' }],
    ['runtime:bot-channel-wechat-qr-request', null],
    ['runtime:bot-channel-wechat-qr-check', { qrcode: '' }],
  ])('connects before rejecting invalid %s payloads without transport', async (channel, value) => {
    const { handlers, host, order, request } = fixture();
    await expect(handlers.get(channel)!('trusted', value)).rejects.toThrow(/Invalid/);
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get('runtime:bot-channel-get')!('trusted', {
        platform: 'telegram',
      }),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get('runtime:bot-channel-test')!('trusted', {
        platform: 'telegram',
      }),
    ).rejects.toBe(failure);
  });
});
