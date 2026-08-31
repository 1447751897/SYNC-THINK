import { describe, expect, it, vi } from 'vitest';
import { BotChannelConfigStore } from './config-store.js';

function fixture() {
  const values = new Map<string, unknown>();
  const secrets = new Map<string, string>();
  let sequence = 0;
  return {
    values,
    secrets,
    store: new BotChannelConfigStore(
      {
        get: (key) => (values.has(key) ? { value: values.get(key) } : undefined),
        set: (key, value) => void values.set(key, value),
      },
      {
        storeSecret: vi.fn(async (value: string) => {
          const handle = `secret-${++sequence}`;
          secrets.set(handle, value);
          return handle;
        }),
        retrieveSecret: vi.fn(async (handle: string) => secrets.get(handle) ?? ''),
        removeSecret: vi.fn(async (handle: string) => void secrets.delete(handle)),
      },
    ),
  };
}

describe('BotChannelConfigStore', () => {
  it('keeps secrets behind handles and resolves all seven platform shapes', async () => {
    const f = fixture();
    await f.store.commit({
      platform: 'feishu',
      enabled: true,
      appId: 'cli_123',
      appSecret: 'secret-value',
      domain: 'lark',
      renderMode: 'text',
    });

    const raw = f.values.get('bot.channel.feishu');
    expect(JSON.stringify(raw)).not.toContain('secret-value');
    expect(f.store.summary('feishu')).toMatchObject({
      appId: 'cli_123',
      domain: 'lark',
      renderMode: 'text',
      credentialsConfigured: true,
    });
    await expect(f.store.resolve('feishu')).resolves.toEqual({
      platform: 'feishu',
      enabled: true,
      credentials: { appId: 'cli_123', appSecret: 'secret-value' },
      settings: { appId: 'cli_123', domain: 'lark', renderMode: 'text' },
    });
  });

  it.each([
    [
      'wecom',
      { botId: 'wecom-bot', secret: 'wecom-secret' },
      { botId: 'wecom-bot', secret: 'wecom-secret' },
    ],
    [
      'dingtalk',
      { clientId: 'ding-client', clientSecret: 'ding-secret' },
      { clientId: 'ding-client', clientSecret: 'ding-secret' },
    ],
    [
      'qq',
      { appId: 'qq-app', appSecret: 'qq-secret' },
      { appId: 'qq-app', appSecret: 'qq-secret' },
    ],
  ] as const)(
    'resolves %s public IDs together with secure credentials',
    async (platform, input, expected) => {
      const f = fixture();
      await f.store.commit({ platform, enabled: true, ...input });

      await expect(f.store.resolve(platform)).resolves.toMatchObject({
        credentials: expected,
      });
    },
  );

  it('replaces a secret only after the new handle is persisted', async () => {
    const f = fixture();
    await f.store.commit({ platform: 'telegram', enabled: true, token: 'first' });
    const first = [...f.secrets.keys()][0];
    await f.store.commit({ platform: 'telegram', enabled: true, token: 'second' });

    expect(f.secrets.has(first!)).toBe(false);
    await expect(f.store.resolve('telegram')).resolves.toMatchObject({
      credentials: { token: 'second' },
    });
  });

  it('migrates the existing Telegram config without exposing its token', async () => {
    const f = fixture();
    f.secrets.set('legacy-token', '123:abc');
    f.values.set('bot.channel.telegram', {
      enabled: true,
      tokenHandle: 'legacy-token',
      proxyUrl: 'http://127.0.0.1:7890',
      botUsername: 'sync_bot',
    });

    expect(f.store.summary('telegram')).toMatchObject({
      enabled: true,
      credentialsConfigured: true,
      proxyUrl: 'http://127.0.0.1:7890',
      botUsername: 'sync_bot',
    });
    await expect(f.store.resolve('telegram')).resolves.toMatchObject({
      credentials: { token: '123:abc' },
    });
  });

  it('stores WeChat QR credentials and identity without returning the token', async () => {
    const f = fixture();
    await f.store.commitWechatLogin({
      botToken: 'wechat-secret',
      baseUrl: 'https://ilink.example',
      botId: 'bot-id',
      ilinkUserId: 'ilink-user',
    });

    expect(f.store.summary('wechat')).toMatchObject({
      enabled: true,
      credentialsConfigured: true,
      baseUrl: 'https://ilink.example',
      botId: 'bot-id',
    });
    expect(JSON.stringify(f.store.summary('wechat'))).not.toContain('wechat-secret');
    await expect(f.store.resolve('wechat')).resolves.toMatchObject({
      credentials: { botToken: 'wechat-secret' },
      settings: {
        baseUrl: 'https://ilink.example',
        botId: 'bot-id',
        ilinkUserId: 'ilink-user',
      },
    });
  });
});
