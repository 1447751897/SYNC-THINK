import { describe, expect, it } from 'vitest';
import {
  parseCheckWechatBotQrPayload,
  parseGetBotChannelConfigPayload,
  parseRequestWechatBotQrPayload,
  parseSaveBotChannelConfigPayload,
  parseTestBotChannelPayload,
} from './bot-channel.js';

describe('bot channel payload validation', () => {
  it.each(['telegram', 'feishu', 'wecom', 'wechat', 'discord', 'dingtalk', 'qq'] as const)(
    'accepts the supported %s platform',
    (platform) => {
      expect(parseGetBotChannelConfigPayload({ platform })).toEqual({ platform });
    },
  );

  it('preserves Feishu public settings and trims replacement credentials', () => {
    expect(
      parseSaveBotChannelConfigPayload({
        platform: 'feishu',
        enabled: true,
        appId: ' cli_app_123 ',
        appSecret: ' secret ',
        domain: 'lark',
        renderMode: 'card',
        testConnection: true,
      }),
    ).toEqual({
      platform: 'feishu',
      enabled: true,
      appId: 'cli_app_123',
      appSecret: 'secret',
      domain: 'lark',
      renderMode: 'card',
      testConnection: true,
    });
  });

  it('accepts each platform credential shape without accepting unrelated fields', () => {
    expect(
      parseTestBotChannelPayload({ platform: 'wecom', botId: 'bot', secret: 'secret' }),
    ).toEqual({ platform: 'wecom', botId: 'bot', secret: 'secret' });
    expect(
      parseTestBotChannelPayload({ platform: 'discord', token: 'token', proxyUrl: '' }),
    ).toEqual({ platform: 'discord', token: 'token', proxyUrl: '' });
    expect(
      parseTestBotChannelPayload({
        platform: 'dingtalk',
        clientId: 'client',
        clientSecret: 'secret',
      }),
    ).toEqual({ platform: 'dingtalk', clientId: 'client', clientSecret: 'secret' });
    expect(
      parseTestBotChannelPayload({ platform: 'qq', appId: 'app', appSecret: 'secret' }),
    ).toEqual({ platform: 'qq', appId: 'app', appSecret: 'secret' });
    expect(
      parseTestBotChannelPayload({ platform: 'wechat', botToken: 'token', baseUrl: 'https://x' }),
    ).toEqual({ platform: 'wechat', botToken: 'token', baseUrl: 'https://x' });
    expect(parseTestBotChannelPayload({ platform: 'qq', token: 'wrong-shape' })).toBeUndefined();
  });

  it('rejects unsupported platforms and unknown keys', () => {
    expect(parseGetBotChannelConfigPayload({ platform: 'slack' })).toBeUndefined();
    expect(
      parseSaveBotChannelConfigPayload({
        platform: 'telegram',
        enabled: true,
        token: '123:secret',
        leaked: true,
      }),
    ).toBeUndefined();
  });

  it('validates the WeChat QR request and polling payloads independently', () => {
    expect(parseRequestWechatBotQrPayload({ baseUrl: ' https://ilink.example ' })).toEqual({
      baseUrl: 'https://ilink.example',
    });
    expect(parseCheckWechatBotQrPayload({ qrcode: ' qr-id ', baseUrl: '' })).toEqual({
      qrcode: 'qr-id',
      baseUrl: '',
    });
    expect(parseCheckWechatBotQrPayload({ qrcode: '' })).toBeUndefined();
    expect(parseRequestWechatBotQrPayload({ token: 'secret' })).toBeUndefined();
  });
});
