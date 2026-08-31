import type { Bot, MessageEvent } from 'qq-official-bot';
import {
  BOT_REPLY_ERROR_PREFIX,
  StatefulBotGateway,
  errorMessage,
  gatewayTestResult,
} from './base-gateway.js';
import type {
  BotChannelGateway,
  BotChannelMessageHandler,
  BotChannelRuntimeConfig,
} from './types.js';

export class QQGateway extends StatefulBotGateway implements BotChannelGateway {
  private bot?: Bot;

  constructor() {
    super('qq');
  }

  async start(config: BotChannelRuntimeConfig, onMessage: BotChannelMessageHandler): Promise<void> {
    await this.stop();
    this.transition('connecting');
    try {
      const bot = await this.createBot(config);
      const receive = (
        event: MessageEvent & {
          id: string;
          raw_message: string;
          user_id: string;
          group_id?: string;
          channel_id?: string;
          guild_id?: string;
          sender?: { user_name?: string };
          message_type?: string;
        },
      ) => {
        const text = event.raw_message.trim();
        const conversationId =
          event.group_id ?? event.channel_id ?? event.guild_id ?? event.user_id;
        if (!text || !conversationId) return;
        this.transition('connected', { messageReceived: true });
        void onMessage({
          platform: 'qq',
          conversationId,
          messageId: event.id,
          text,
          senderName: event.sender?.user_name ?? event.user_id,
          conversationType: event.message_type,
        })
          .then((reply) => event.reply(reply))
          .catch((error) => event.reply(`${BOT_REPLY_ERROR_PREFIX}${errorMessage(error)}`));
      };
      bot.on('message.private', receive);
      bot.on('message.group', receive);
      bot.on('message.guild', receive);
      bot.on('error', (error: Error) => this.transition('error', { error: error.message }));
      this.bot = bot;
      await bot.start();
      this.transition('connected');
    } catch (error) {
      this.transition('error', { error: errorMessage(error) });
      await this.bot?.stop().catch(() => undefined);
      this.bot = undefined;
      throw error;
    }
  }

  async stop(): Promise<void> {
    await this.bot?.stop().catch(() => undefined);
    this.bot = undefined;
    this.transition('disconnected');
  }

  async test(config: BotChannelRuntimeConfig) {
    let bot: Bot | undefined;
    try {
      bot = await this.createBot(config);
      const identity = await bot.getSelfInfo();
      return gatewayTestResult('qq', 'pass', `已连接 ${identity.username}`, {
        username: identity.username,
        displayName: identity.username,
      });
    } catch (error) {
      return gatewayTestResult('qq', 'fail', errorMessage(error));
    } finally {
      await bot?.stop().catch(() => undefined);
    }
  }

  private async createBot(config: BotChannelRuntimeConfig): Promise<Bot> {
    const appid = config.credentials.appId?.trim();
    const secret = config.credentials.appSecret?.trim();
    if (!appid || !secret) throw new Error('请填写 App ID 和 App Secret。');
    const qq = await import('qq-official-bot');
    return new qq.Bot({
      appid,
      secret,
      removeAt: true,
      maxRetry: 10,
      logLevel: 'warn',
      intents: ['GROUP_AND_C2C_EVENT', 'GUILD_MESSAGES', 'DIRECT_MESSAGE'],
      mode: qq.ReceiverMode.WEBSOCKET,
    });
  }
}
