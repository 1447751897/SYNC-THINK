import { describe, expect, it } from 'vitest';
import { DiscordGateway } from './discord-gateway.js';

describe('DiscordGateway', () => {
  it('rejects proxy protocols that the Discord REST client cannot use', async () => {
    const gateway = new DiscordGateway();

    const result = await gateway.test({
      platform: 'discord',
      enabled: true,
      credentials: { token: 'test-token' },
      settings: { proxyUrl: 'socks5://127.0.0.1:7890' },
    });

    expect(result.overall).toBe('fail');
    expect(result.checks[0]?.detail).toBe('代理地址仅支持 http:// 或 https://。');
  });
});
