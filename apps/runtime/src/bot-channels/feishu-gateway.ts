import type { Client, WSClient } from '@larksuiteoapi/node-sdk';
import {
  BOT_REPLY_ERROR_PREFIX,
  StatefulBotGateway,
  errorMessage,
  gatewayTestResult,
  record,
  stringField,
} from './base-gateway.js';
import type {
  BotChannelGateway,
  BotChannelMessageHandler,
  BotChannelRuntimeConfig,
} from './types.js';

export class FeishuGateway extends StatefulBotGateway implements BotChannelGateway {
  private wsClient?: WSClient;

  constructor() {
    super('feishu');
  }

  async start(config: BotChannelRuntimeConfig, onMessage: BotChannelMessageHandler): Promise<void> {
    await this.stop();
    this.transition('connecting');
    const appId = config.credentials.appId?.trim();
    const appSecret = config.credentials.appSecret?.trim();
    if (!appId || !appSecret) throw new Error('请填写 App ID 和 App Secret。');
    try {
      const lark = await import('@larksuiteoapi/node-sdk');
      const domain = config.settings.domain === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu;
      const client = new lark.Client({ appId, appSecret, domain });
      const dispatcher = new lark.EventDispatcher({}).register({
        'im.message.receive_v1': async (data) => {
          const raw = data as unknown as Record<string, unknown>;
          const message = record(raw.message);
          const sender = record(raw.sender);
          const senderId = record(sender?.sender_id);
          const chatId = stringField(message?.chat_id);
          const messageId = stringField(message?.message_id);
          if (!chatId || !messageId || message?.message_type !== 'text') return;
          const content = record(JSON.parse(stringField(message.content) ?? '{}'));
          const text = stringField(content?.text);
          if (!text) return;
          this.transition('connected', { messageReceived: true });
          void onMessage({
            platform: 'feishu',
            conversationId: chatId,
            messageId,
            text,
            senderName: stringField(senderId?.open_id) ?? stringField(senderId?.user_id),
            conversationType: stringField(message.chat_type),
          })
            .then((reply) => this.sendText(client, chatId, reply, config.settings.renderMode))
            .catch((error) =>
              this.sendText(
                client,
                chatId,
                `${BOT_REPLY_ERROR_PREFIX}${errorMessage(error)}`,
                'text',
              ),
            );
        },
      });
      const wsClient = new lark.WSClient({
        appId,
        appSecret,
        domain,
        autoReconnect: true,
        handshakeTimeoutMs: 15_000,
        onReady: () => this.transition('connected'),
        onError: (error) => this.transition('error', { error: error.message }),
        onReconnecting: () => this.transition('connecting'),
        onReconnected: () => this.transition('connected'),
      });
      this.wsClient = wsClient;
      await wsClient.start({ eventDispatcher: dispatcher });
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
    const appId = config.credentials.appId?.trim();
    const appSecret = config.credentials.appSecret?.trim();
    if (!appId || !appSecret)
      return gatewayTestResult('feishu', 'fail', '请填写 App ID 和 App Secret。');
    try {
      const root =
        config.settings.domain === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn';
      const response = await fetch(`${root}/open-apis/auth/v3/tenant_access_token/internal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      });
      const body = record(await response.json());
      if (!response.ok || body?.code !== 0)
        throw new Error(stringField(body?.msg) ?? `HTTP ${response.status}`);
      return gatewayTestResult('feishu', 'pass', '应用凭据验证成功。');
    } catch (error) {
      return gatewayTestResult('feishu', 'fail', errorMessage(error));
    }
  }

  private async sendText(
    client: Client,
    chatId: string,
    text: string,
    mode = 'card',
  ): Promise<void> {
    const card = mode === 'card';
    await client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: card ? 'interactive' : 'text',
        content: card
          ? JSON.stringify({ elements: [{ tag: 'markdown', content: text }] })
          : JSON.stringify({ text }),
      },
    });
  }

  private async stopResources(): Promise<void> {
    this.wsClient?.close({ force: true });
    this.wsClient = undefined;
  }
}
