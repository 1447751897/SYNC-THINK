import type { Client } from 'discord.js';
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

export class DiscordGateway extends StatefulBotGateway implements BotChannelGateway {
  private client?: Client;
  private proxyAgent?: ProxyAgent;

  constructor() {
    super('discord');
  }

  async start(config: BotChannelRuntimeConfig, onMessage: BotChannelMessageHandler): Promise<void> {
    await this.stop();
    this.transition('connecting');
    const token = config.credentials.token?.trim();
    if (!token) throw new Error('请填写 Bot Token。');
    try {
      const discord = await import('discord.js');
      const proxyAgent = this.createProxyAgent(config.settings.proxyUrl);
      const client = new discord.Client({
        intents: [
          discord.GatewayIntentBits.Guilds,
          discord.GatewayIntentBits.GuildMessages,
          discord.GatewayIntentBits.DirectMessages,
          discord.GatewayIntentBits.MessageContent,
        ],
        partials: [discord.Partials.Channel, discord.Partials.Message],
        ...(proxyAgent ? { rest: { agent: proxyAgent } } : {}),
      });
      client.on(discord.Events.ClientReady, () => this.transition('connected'));
      client.on(discord.Events.ShardReconnecting, () => this.transition('connecting'));
      client.on(discord.Events.Error, (error) =>
        this.transition('error', { error: error.message }),
      );
      client.on(discord.Events.MessageCreate, async (message) => {
        if (message.author.bot || !message.content.trim()) return;
        this.transition('connected', { messageReceived: true });
        await message.channel.sendTyping().catch(() => undefined);
        const typing = setInterval(() => {
          void message.channel.sendTyping().catch(() => undefined);
        }, 7_000);
        typing.unref?.();
        try {
          const reply = await onMessage({
            platform: 'discord',
            conversationId: message.channel.id,
            messageId: message.id,
            text: message.content.trim(),
            senderName: message.author.globalName ?? message.author.username,
            conversationType: message.guildId ? 'guild' : 'direct',
          });
          for (const chunk of textChunks(reply, 1_900)) await message.reply(chunk);
        } catch (error) {
          await message.reply(`${BOT_REPLY_ERROR_PREFIX}${errorMessage(error)}`);
        } finally {
          clearInterval(typing);
        }
      });
      this.client = client;
      await client.login(token);
      this.transition('connected');
    } catch (error) {
      this.transition('error', { error: errorMessage(error) });
      this.client?.destroy();
      this.client = undefined;
      await this.closeProxy();
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.client?.destroy();
    this.client = undefined;
    await this.closeProxy();
    this.transition('disconnected');
  }

  async test(config: BotChannelRuntimeConfig) {
    const token = config.credentials.token?.trim();
    if (!token) return gatewayTestResult('discord', 'fail', '请填写 Bot Token。');
    let proxyAgent: ProxyAgent | undefined;
    try {
      proxyAgent = this.createStandaloneProxyAgent(config.settings.proxyUrl);
      const response = await undiciFetch('https://discord.com/api/v10/users/@me', {
        headers: { authorization: `Bot ${token}` },
        ...(proxyAgent ? { dispatcher: proxyAgent } : {}),
      });
      const body = (await response.json()) as {
        id?: string;
        username?: string;
        global_name?: string;
        message?: string;
      };
      if (!response.ok || !body.id) throw new Error(body.message ?? `HTTP ${response.status}`);
      return gatewayTestResult('discord', 'pass', `已连接 ${body.username ?? body.id}`, {
        username: body.username,
        displayName: body.global_name ?? body.username,
      });
    } catch (error) {
      return gatewayTestResult('discord', 'fail', errorMessage(error));
    } finally {
      if (proxyAgent) await proxyAgent.close().catch(() => undefined);
    }
  }

  private createProxyAgent(proxyUrl: string | undefined): ProxyAgent | undefined {
    const agent = this.createStandaloneProxyAgent(proxyUrl);
    this.proxyAgent = agent;
    return agent;
  }

  private createStandaloneProxyAgent(proxyUrl: string | undefined): ProxyAgent | undefined {
    const value = proxyUrl?.trim();
    if (!value) return undefined;
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('代理地址仅支持 http:// 或 https://。');
    }
    return new ProxyAgent(parsed.toString());
  }

  private async closeProxy(): Promise<void> {
    const agent = this.proxyAgent;
    this.proxyAgent = undefined;
    if (agent) await agent.close().catch(() => undefined);
  }
}
