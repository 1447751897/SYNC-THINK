import type { Bot } from 'grammy';
import type { RunnerHandle } from '@grammyjs/runner';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import {
  BOT_REPLY_ERROR_PREFIX,
  StatefulBotGateway,
  errorMessage,
  gatewayTestResult,
  textChunks,
} from './base-gateway.js';
import type {
  BotChannelGateway,
  BotChannelMessageHandler,
  BotChannelRuntimeConfig,
} from './types.js';

const TELEGRAM_MESSAGE_LIMIT = 4_096;

export class TelegramGateway extends StatefulBotGateway implements BotChannelGateway {
  private runner?: RunnerHandle;
  private proxyAgent?: ProxyAgent;

  constructor() {
    super('telegram');
  }

  async start(config: BotChannelRuntimeConfig, onMessage: BotChannelMessageHandler): Promise<void> {
    await this.stop();
    this.transition('connecting');
    try {
      const bot = await this.createBot(config);
      bot.on('message:text', async (context) => {
        this.transition('connected', { messageReceived: true });
        await context.replyWithChatAction('typing').catch(() => undefined);
        const typing = setInterval(() => {
          void context.replyWithChatAction('typing').catch(() => undefined);
        }, 4_000);
        typing.unref?.();
        try {
          const reply = await onMessage({
            platform: 'telegram',
            conversationId: String(context.chat.id),
            messageId: String(context.message.message_id),
            text: context.message.text.trim(),
            senderName:
              [context.from.first_name, context.from.last_name].filter(Boolean).join(' ').trim() ||
              context.from.username,
            conversationType: context.chat.type,
          });
          for (const chunk of textChunks(reply, TELEGRAM_MESSAGE_LIMIT)) await context.reply(chunk);
        } catch (error) {
          await context.reply(`${BOT_REPLY_ERROR_PREFIX}${errorMessage(error, '执行消息失败。')}`);
        } finally {
          clearInterval(typing);
        }
      });
      bot.catch((error) => {
        this.transition('error', { error: errorMessage(error.error) });
      });
      const { run } = await import('@grammyjs/runner');
      await bot.init();
      this.runner = run(bot, {
        runner: {
          fetch: { timeout: 30, allowed_updates: ['message'] },
          retryInterval: 'exponential',
        },
      });
      this.transition('connected');
    } catch (error) {
      this.transition('error', { error: errorMessage(error) });
      await this.stopResources();
      throw error;
    }
  }

  async stop(): Promise<void> {
    await this.stopResources();
    this.transition('disconnected');
  }

  async test(config: BotChannelRuntimeConfig) {
    try {
      const bot = await this.createBot(config);
      const identity = await bot.api.getMe();
      await this.closeProxy();
      return gatewayTestResult('telegram', 'pass', `已连接 @${identity.username}`, {
        username: identity.username,
        displayName: [identity.first_name, identity.last_name].filter(Boolean).join(' '),
      });
    } catch (error) {
      await this.closeProxy();
      return gatewayTestResult('telegram', 'fail', errorMessage(error));
    }
  }

  private async createBot(config: BotChannelRuntimeConfig): Promise<Bot> {
    const token = config.credentials.token?.trim();
    if (!token) throw new Error('请填写 Bot Token。');
    const { Bot: GrammyBot } = await import('grammy');
    const proxyUrl = config.settings.proxyUrl?.trim();
    if (!proxyUrl) return new GrammyBot(token);
    const parsed = new URL(proxyUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('代理地址仅支持 http:// 或 https://。');
    }
    await this.closeProxy();
    this.proxyAgent = new ProxyAgent(parsed.toString());
    const dispatcher = this.proxyAgent;
    const proxyFetch: typeof fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      undiciFetch(input as string | URL, {
        ...(init as Parameters<typeof undiciFetch>[1]),
        dispatcher,
      }) as unknown as Promise<Response>) as typeof fetch;
    return new GrammyBot(token, { client: { fetch: proxyFetch } });
  }

  private async stopResources(): Promise<void> {
    const runner = this.runner;
    this.runner = undefined;
    if (runner) await runner.stop().catch(() => undefined);
    await this.closeProxy();
  }

  private async closeProxy(): Promise<void> {
    const agent = this.proxyAgent;
    this.proxyAgent = undefined;
    if (agent) await agent.close().catch(() => undefined);
  }
}
