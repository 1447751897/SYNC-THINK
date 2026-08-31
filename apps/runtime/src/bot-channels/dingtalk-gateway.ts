import type { DWClient } from 'dingtalk-stream';
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

export class DingTalkGateway extends StatefulBotGateway implements BotChannelGateway {
  private client?: DWClient;

  constructor() {
    super('dingtalk');
  }

  async start(config: BotChannelRuntimeConfig, onMessage: BotChannelMessageHandler): Promise<void> {
    await this.stop();
    this.transition('connecting');
    const clientId = config.credentials.clientId?.trim();
    const clientSecret = config.credentials.clientSecret?.trim();
    if (!clientId || !clientSecret) throw new Error('请填写 Client ID 和 Client Secret。');
    try {
      const ding = await import('dingtalk-stream');
      const client = new ding.DWClient({ clientId, clientSecret, keepAlive: true, debug: false });
      client.registerCallbackListener(ding.TOPIC_ROBOT, (downstream) => {
        client.socketCallBackResponse(downstream.headers.messageId, { status: 'SUCCESS' });
        const data = record(JSON.parse(downstream.data));
        const text = stringField(record(data?.text)?.content);
        const conversationId = stringField(data?.conversationId);
        const messageId = stringField(data?.msgId) ?? downstream.headers.messageId;
        const sessionWebhook = stringField(data?.sessionWebhook);
        if (!text || !conversationId || !sessionWebhook) return;
        this.transition('connected', { messageReceived: true });
        void onMessage({
          platform: 'dingtalk',
          conversationId,
          messageId,
          text,
          senderName: stringField(data?.senderNick) ?? stringField(data?.senderStaffId),
          conversationType: stringField(data?.conversationType),
        })
          .then((reply) => this.sendWebhook(sessionWebhook, reply))
          .catch((error) =>
            this.sendWebhook(sessionWebhook, `${BOT_REPLY_ERROR_PREFIX}${errorMessage(error)}`),
          );
      });
      client.on('close', () => this.transition('connecting'));
      client.on('error', (error: Error) => this.transition('error', { error: error.message }));
      this.client = client;
      await client.connect();
      this.transition('connected');
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
    const clientId = config.credentials.clientId?.trim();
    const clientSecret = config.credentials.clientSecret?.trim();
    if (!clientId || !clientSecret) {
      return gatewayTestResult('dingtalk', 'fail', '请填写 Client ID 和 Client Secret。');
    }
    try {
      const response = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appKey: clientId, appSecret: clientSecret }),
      });
      const body = record(await response.json());
      if (!response.ok || !stringField(body?.accessToken)) {
        throw new Error(stringField(body?.message) ?? `HTTP ${response.status}`);
      }
      return gatewayTestResult('dingtalk', 'pass', '应用凭据验证成功。');
    } catch (error) {
      return gatewayTestResult('dingtalk', 'fail', errorMessage(error));
    }
  }

  private async sendWebhook(url: string, text: string): Promise<void> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ msgtype: 'markdown', markdown: { title: 'SYNC-THINK', text } }),
    });
    if (!response.ok) throw new Error(`钉钉回复失败（HTTP ${response.status}）。`);
  }
}
