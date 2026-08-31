import { describe, expect, it, vi } from 'vitest';
import { BotChannelGatewayManager } from './gateway-manager.js';
import type { BotChannelGateway, BotChannelRuntimeConfig, NormalizedBotMessage } from './types.js';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function gateway(platform: BotChannelRuntimeConfig['platform']): BotChannelGateway {
  return {
    platform,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    test: vi.fn().mockResolvedValue({
      platform,
      overall: 'pass',
      checks: [{ id: 'connection', label: '连接状态', verdict: 'pass' }],
    }),
    status: vi.fn().mockReturnValue({ platform, state: 'disconnected' }),
  };
}

describe('BotChannelGatewayManager', () => {
  it('serializes lifecycle changes for one platform without blocking another platform', async () => {
    const telegram = gateway('telegram');
    const feishu = gateway('feishu');
    const firstStart = deferred();
    vi.mocked(telegram.start).mockReturnValueOnce(firstStart.promise);
    const manager = new BotChannelGatewayManager([telegram, feishu]);
    const config = (platform: 'telegram' | 'feishu'): BotChannelRuntimeConfig => ({
      platform,
      enabled: true,
      credentials: {},
      settings: {},
    });

    const starting = manager.start(config('telegram'), vi.fn());
    const stopping = manager.stop('telegram');
    await manager.start(config('feishu'), vi.fn());

    expect(feishu.start).toHaveBeenCalledOnce();
    expect(telegram.stop).not.toHaveBeenCalled();
    firstStart.resolve();
    await Promise.all([starting, stopping]);
    expect(telegram.stop).toHaveBeenCalledOnce();
  });

  it('routes normalized messages through the shared handler', async () => {
    const telegram = gateway('telegram');
    const manager = new BotChannelGatewayManager([telegram]);
    const onMessage = vi.fn(async (_message: NormalizedBotMessage) => '完成');
    await manager.start(
      { platform: 'telegram', enabled: true, credentials: {}, settings: {} },
      onMessage,
    );
    const registered = vi.mocked(telegram.start).mock.calls[0]?.[1];
    const incoming: NormalizedBotMessage = {
      platform: 'telegram',
      conversationId: '42',
      messageId: '7',
      text: '检查项目',
    };

    await registered?.(incoming);
    expect(onMessage).toHaveBeenCalledWith(incoming);
  });

  it('stops all gateways independently', async () => {
    const telegram = gateway('telegram');
    const feishu = gateway('feishu');
    vi.mocked(telegram.stop).mockRejectedValueOnce(new Error('network'));
    const manager = new BotChannelGatewayManager([telegram, feishu]);

    await expect(manager.stopAll()).resolves.toBeUndefined();
    expect(telegram.stop).toHaveBeenCalledOnce();
    expect(feishu.stop).toHaveBeenCalledOnce();
  });
});
