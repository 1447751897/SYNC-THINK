import type {
  BotChannelCheckVerdict,
  BotChannelPlatform,
  TestBotChannelResponse,
} from '@sync-think/protocol';
import type { BotChannelGatewayStatus } from './types.js';

export const BOT_REPLY_ERROR_PREFIX = 'SYNC-THINK 处理失败：';

export function errorMessage(error: unknown, fallback = '连接发生错误。'): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export function textChunks(text: string, limit: number): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const breakAt = Math.max(
      window.lastIndexOf('\n'),
      window.lastIndexOf('。'),
      window.lastIndexOf(' '),
    );
    const length = breakAt > limit * 0.55 ? breakAt + 1 : limit;
    chunks.push(rest.slice(0, length).trimEnd());
    rest = rest.slice(length).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export function gatewayTestResult(
  platform: BotChannelPlatform,
  verdict: BotChannelCheckVerdict,
  detail: string,
  identity?: { username?: string; displayName?: string },
): TestBotChannelResponse {
  return {
    platform,
    connected: verdict === 'pass',
    overall: verdict,
    checks: [{ id: 'connection', label: '连接与鉴权', verdict, detail }],
    ...(identity?.username ? { botUsername: identity.username } : {}),
    ...(identity?.displayName ? { botDisplayName: identity.displayName } : {}),
  };
}

export abstract class StatefulBotGateway {
  protected currentStatus: BotChannelGatewayStatus;

  protected constructor(readonly platform: BotChannelPlatform) {
    this.currentStatus = { platform, state: 'disconnected' };
  }

  status(): BotChannelGatewayStatus {
    return { ...this.currentStatus };
  }

  protected transition(
    state: BotChannelGatewayStatus['state'],
    options: { error?: string; messageReceived?: boolean } = {},
  ): void {
    this.currentStatus = {
      platform: this.platform,
      state,
      ...(options.error ? { lastError: options.error } : {}),
      ...(options.messageReceived
        ? { lastMessageAt: new Date().toISOString() }
        : this.currentStatus.lastMessageAt
          ? { lastMessageAt: this.currentStatus.lastMessageAt }
          : {}),
    };
  }
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}超时。`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
