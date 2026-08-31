import type { BotChannelPlatform, TestBotChannelResponse } from '@sync-think/protocol';
import type {
  BotChannelGateway,
  BotChannelGatewayStatus,
  BotChannelMessageHandler,
  BotChannelRuntimeConfig,
} from './types.js';

export class BotChannelGatewayManager {
  private readonly gateways: Map<BotChannelPlatform, BotChannelGateway>;
  private readonly platformLocks = new Map<BotChannelPlatform, Promise<unknown>>();

  constructor(gateways: readonly BotChannelGateway[]) {
    this.gateways = new Map(gateways.map((gateway) => [gateway.platform, gateway]));
  }

  start(config: BotChannelRuntimeConfig, onMessage: BotChannelMessageHandler): Promise<void> {
    return this.withPlatformLock(config.platform, () =>
      this.requireGateway(config.platform).start(config, onMessage),
    );
  }

  stop(platform: BotChannelPlatform): Promise<void> {
    return this.withPlatformLock(platform, () => this.requireGateway(platform).stop());
  }

  test(config: BotChannelRuntimeConfig): Promise<TestBotChannelResponse> {
    return this.withPlatformLock(config.platform, () =>
      this.requireGateway(config.platform).test(config),
    );
  }

  status(platform: BotChannelPlatform): BotChannelGatewayStatus {
    return this.requireGateway(platform).status();
  }

  statusMap(): Record<BotChannelPlatform, BotChannelGatewayStatus> {
    return Object.fromEntries(
      [...this.gateways].map(([platform, gateway]) => [platform, gateway.status()]),
    ) as Record<BotChannelPlatform, BotChannelGatewayStatus>;
  }

  async stopAll(): Promise<void> {
    await Promise.allSettled([...this.gateways].map(([platform]) => this.stop(platform)));
  }

  private requireGateway(platform: BotChannelPlatform): BotChannelGateway {
    const gateway = this.gateways.get(platform);
    if (!gateway) throw new Error(`机器人通道 ${platform} 尚未注册。`);
    return gateway;
  }

  private async withPlatformLock<T>(
    platform: BotChannelPlatform,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.platformLocks.get(platform);
    const current = (async () => {
      if (previous) await previous.catch(() => undefined);
      return operation();
    })();
    this.platformLocks.set(platform, current);
    try {
      return await current;
    } finally {
      if (this.platformLocks.get(platform) === current) this.platformLocks.delete(platform);
    }
  }
}
