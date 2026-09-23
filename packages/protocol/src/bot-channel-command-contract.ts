import type {
  CheckWechatBotQrPayload,
  CheckWechatBotQrResponse,
  GetBotChannelConfigPayload,
  GetBotChannelConfigResponse,
  RequestWechatBotQrPayload,
  RequestWechatBotQrResponse,
  SaveBotChannelConfigPayload,
  SaveBotChannelConfigResponse,
  TestBotChannelPayload,
  TestBotChannelResponse,
} from './commands.js';

/** Bot channel configuration, connectivity and WeChat login RPCs. */
export interface BotChannelCommandContract {
  'bot.channel.get': {
    request: GetBotChannelConfigPayload;
    response: GetBotChannelConfigResponse;
  };
  'bot.channel.save': {
    request: SaveBotChannelConfigPayload;
    response: SaveBotChannelConfigResponse;
  };
  'bot.channel.test': { request: TestBotChannelPayload; response: TestBotChannelResponse };
  'bot.channel.wechat.qr.request': {
    request: RequestWechatBotQrPayload;
    response: RequestWechatBotQrResponse;
  };
  'bot.channel.wechat.qr.check': {
    request: CheckWechatBotQrPayload;
    response: CheckWechatBotQrResponse;
  };
}

export type BotChannelCommand = keyof BotChannelCommandContract;
export type BotChannelCommandRequest<K extends BotChannelCommand> =
  BotChannelCommandContract[K]['request'];
export type BotChannelCommandResponse<K extends BotChannelCommand> =
  BotChannelCommandContract[K]['response'];
