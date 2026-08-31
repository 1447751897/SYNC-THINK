import type { WSClient, WsFrame, TextMessage } from '@wecom/aibot-node-sdk';
import {
  BOT_REPLY_ERROR_PREFIX,
  StatefulBotGateway,
  errorMessage,
  gatewayTestResult,
  withTimeout,
} from './base-gateway.js';
import type {
  BotChannelGateway,
  BotChannelMessageHandler,
  BotChannelRuntimeConfig,
} from './types.js';

export class WeComGateway extends StatefulBotGateway implements BotChannelGateway {
  private client?: WSClient;

  constructor() {
    super('wecom');
  }

  async start(config: BotChannelRuntimeConfig, onMessage: BotChannelMessageHandler): Promise<void> {
    await this.stop();
    this.transition('connecting');
    try {
      const client = await this.createClient(config);
      client.on('message.text', (frame) => {
        const body = frame.body;
        if (!body) return;
        const conversationId = body.chattype === 'group' ? body.chatid : body.from.userid;
        if (!conversationId || !body.text.content.trim()) return;
        this.transition('connected', { messageReceived: true });
        const streamId = `sync_${body.msgid}`;
        void client.replyStream(frame, streamId, '正在处理…', false).catch(() => undefined);
        void onMessage({
          platform: 'wecom',
          conversationId,
          messageId: body.msgid,
          text: body.text.content.trim(),
          senderName: body.from.userid,
          conversationType: body.chattype,
        })
          .then((reply) => client.replyStream(frame, streamId, reply, true))
          .catch((error) =>
            client.replyStream(
              frame,
              streamId,
              `${BOT_REPLY_ERROR_PREFIX}${errorMessage(error)}`,
              true,
            ),
          );
      });
      client.on('authenticated', () => this.transition('connected'));
      client.on('reconnecting', () => this.transition('connecting'));
      client.on('disconnected', (reason) =>
        this.transition('error', { error: reason || '连接已断开。' }),
      );
      client.on('error', (error) => this.transition('error', { error: error.message }));
      this.client = client;
      await this.connectAndWait(client);
    } catch (error) {
      this.transition('error', { error: errorMessage(error) });
      this.client?.disconnect();
      this.client = undefined;
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.client?.disconnect();
    this.client = undefined;
    this.transition('disconnected');
  }

  async test(config: BotChannelRuntimeConfig) {
    let client: WSClient | undefined;
    try {
      client = await this.createClient(config);
      await this.connectAndWait(client);
      return gatewayTestResult('wecom', 'pass', 'WebSocket 已连接并通过认证。');
    } catch (error) {
      return gatewayTestResult('wecom', 'fail', errorMessage(error));
    } finally {
      client?.disconnect();
    }
  }

  private async createClient(config: BotChannelRuntimeConfig): Promise<WSClient> {
    const botId = config.credentials.botId?.trim();
    const secret = config.credentials.secret?.trim();
    if (!botId || !secret) throw new Error('请填写 Bot ID 和 Secret。');
    const AiBot = (await import('@wecom/aibot-node-sdk')).default;
    return new AiBot.WSClient({ botId, secret, maxReconnectAttempts: -1 });
  }

  private async connectAndWait(client: WSClient): Promise<void> {
    if (client.isConnected) {
      this.transition('connected');
      return;
    }
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        const ready = () => {
          cleanup();
          this.transition('connected');
          resolve();
        };
        const failed = (error: Error) => {
          cleanup();
          reject(error);
        };
        const cleanup = () => {
          client.off('authenticated', ready);
          client.off('error', failed);
        };
        client.once('authenticated', ready);
        client.once('error', failed);
        client.connect();
      }),
      15_000,
      '企业微信连接',
    );
  }
}

export type WeComTextFrame = WsFrame<TextMessage>;
