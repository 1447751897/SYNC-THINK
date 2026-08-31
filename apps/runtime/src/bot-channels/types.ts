import type {
  BotChannelConnectionState,
  BotChannelPlatform,
  TestBotChannelResponse,
} from '@sync-think/protocol';

export interface NormalizedBotMessage {
  platform: BotChannelPlatform;
  conversationId: string;
  messageId: string;
  text: string;
  senderName?: string;
  conversationType?: string;
}

export type BotChannelMessageHandler = (message: NormalizedBotMessage) => Promise<string>;

export interface BotChannelRuntimeConfig {
  platform: BotChannelPlatform;
  enabled: boolean;
  credentials: Readonly<Record<string, string>>;
  settings: Readonly<Record<string, string>>;
}

export interface BotChannelGatewayStatus {
  platform: BotChannelPlatform;
  state: BotChannelConnectionState;
  lastError?: string;
  lastMessageAt?: string;
}

export interface BotChannelGateway {
  readonly platform: BotChannelPlatform;
  start(config: BotChannelRuntimeConfig, onMessage: BotChannelMessageHandler): Promise<void>;
  stop(): Promise<void>;
  test(config: BotChannelRuntimeConfig): Promise<TestBotChannelResponse>;
  status(): BotChannelGatewayStatus;
}
