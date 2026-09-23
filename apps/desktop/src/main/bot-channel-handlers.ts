import type {
  BotChannelCommand,
  BotChannelCommandRequest,
  BotChannelCommandResponse,
} from '@sync-think/protocol';
import {
  parseCheckWechatBotQrPayload,
  parseGetBotChannelConfigPayload,
  parseRequestWechatBotQrPayload,
  parseSaveBotChannelConfigPayload,
  parseTestBotChannelPayload,
} from '../bot-channel-payloads.js';

export interface BotChannelHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestBotChannel<K extends BotChannelCommand>(
    command: K,
    payload: BotChannelCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<BotChannelCommandResponse<K>>;
}

export function registerBotChannelHandlers<Event>(host: BotChannelHost<Event>): void {
  host.handle('runtime:bot-channel-get', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBotChannel('bot.channel.get', parseGetBotChannelConfigPayload(value));
  });

  host.handle('runtime:bot-channel-save', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBotChannel('bot.channel.save', parseSaveBotChannelConfigPayload(value));
  });

  host.handle('runtime:bot-channel-test', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBotChannel('bot.channel.test', parseTestBotChannelPayload(value));
  });

  host.handle('runtime:bot-channel-wechat-qr-request', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBotChannel(
      'bot.channel.wechat.qr.request',
      parseRequestWechatBotQrPayload(value),
    );
  });

  host.handle('runtime:bot-channel-wechat-qr-check', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBotChannel(
      'bot.channel.wechat.qr.check',
      parseCheckWechatBotQrPayload(value),
    );
  });
}
