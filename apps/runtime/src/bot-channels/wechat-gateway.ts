import QRCode from 'qrcode';
import {
  BOT_REPLY_ERROR_PREFIX,
  errorMessage,
  gatewayTestResult,
  record,
  StatefulBotGateway,
  stringField,
  textChunks,
} from './base-gateway.js';
import type {
  BotChannelGateway,
  BotChannelMessageHandler,
  BotChannelRuntimeConfig,
} from './types.js';

const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';
const CHANNEL_VERSION = '1.0.2';
const REPLY_WINDOW_MS = 23 * 60 * 60 * 1_000;

interface WechatContextToken {
  token: string;
  expiresAt: number;
}

export interface WechatQrRequest {
  qrcode: string;
  qrcodeImage: string;
}

export interface WechatQrStatus {
  status: string;
  botToken?: string;
  baseUrl?: string;
  botId?: string;
  ilinkUserId?: string;
}

export class WechatGateway extends StatefulBotGateway implements BotChannelGateway {
  private config?: BotChannelRuntimeConfig;
  private onMessage?: BotChannelMessageHandler;
  private abortController?: AbortController;
  private pollTask?: Promise<void>;
  private cursor = '';
  private ilinkUserId?: string;
  private readonly contextTokens = new Map<string, WechatContextToken>();
  private readonly processedTokens = new Map<string, number>();

  constructor() {
    super('wechat');
  }

  async start(config: BotChannelRuntimeConfig, onMessage: BotChannelMessageHandler): Promise<void> {
    await this.stop();
    this.transition('connecting');
    this.config = config;
    this.onMessage = onMessage;
    this.ilinkUserId = stringField(config.settings.ilinkUserId);
    try {
      await this.verifyConfig(config);
      this.transition('connected');
      const controller = new AbortController();
      this.abortController = controller;
      this.pollTask = this.pollLoop(controller.signal).catch((error) => {
        if (!controller.signal.aborted) this.transition('error', { error: errorMessage(error) });
      });
    } catch (error) {
      this.transition('error', { error: errorMessage(error) });
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.abortController?.abort();
    await this.pollTask?.catch(() => undefined);
    this.abortController = undefined;
    this.pollTask = undefined;
    this.onMessage = undefined;
    this.contextTokens.clear();
    this.processedTokens.clear();
    this.transition('disconnected');
  }

  async test(config: BotChannelRuntimeConfig) {
    try {
      await this.verifyConfig(config);
      return gatewayTestResult('wechat', 'pass', 'iLink 鉴权通过。');
    } catch (error) {
      return gatewayTestResult('wechat', 'fail', errorMessage(error));
    }
  }

  async requestQrLogin(baseUrl = DEFAULT_BASE_URL): Promise<WechatQrRequest> {
    const root = normalizedBaseUrl(baseUrl);
    const response = await fetch(`${root}/ilink/bot/get_bot_qrcode?bot_type=3`);
    if (!response.ok) throw new Error(`获取微信二维码失败（HTTP ${response.status}）。`);
    const payload = record(await response.json());
    if (payload?.ret !== 0) throw new Error(`获取微信二维码失败（ret=${String(payload?.ret)}）。`);
    const qrcode = stringField(payload.qrcode);
    const content = stringField(payload.qrcode_img_content);
    if (!qrcode || !content) throw new Error('微信二维码响应缺少必要字段。');
    return {
      qrcode,
      qrcodeImage: await QRCode.toDataURL(content, { width: 280, margin: 2 }),
    };
  }

  async checkQrStatus(qrcode: string, baseUrl = DEFAULT_BASE_URL): Promise<WechatQrStatus> {
    const root = normalizedBaseUrl(baseUrl);
    const response = await fetch(
      `${root}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
    );
    if (!response.ok) throw new Error(`读取微信扫码状态失败（HTTP ${response.status}）。`);
    const payload = record(await response.json());
    if (!payload) throw new Error('微信扫码状态响应格式错误。');
    const ilinkUserId = stringField(payload.ilink_user_id);
    if (ilinkUserId) this.ilinkUserId = ilinkUserId;
    return {
      status: stringField(payload.status) ?? 'waiting',
      ...(stringField(payload.bot_token) ? { botToken: stringField(payload.bot_token) } : {}),
      ...(stringField(payload.baseurl) ? { baseUrl: stringField(payload.baseurl) } : {}),
      ...(stringField(payload.ilink_bot_id) ? { botId: stringField(payload.ilink_bot_id) } : {}),
      ...(ilinkUserId ? { ilinkUserId } : {}),
    };
  }

  private async verifyConfig(config: BotChannelRuntimeConfig): Promise<void> {
    const response = await this.ilinkFetch(config, '/ilink/bot/getconfig', {
      method: 'POST',
      body: JSON.stringify({
        ...(stringField(config.settings.ilinkUserId)
          ? { ilink_user_id: config.settings.ilinkUserId }
          : {}),
        base_info: { channel_version: CHANNEL_VERSION },
      }),
    });
    if (!response.ok) throw new Error(`iLink 鉴权失败（HTTP ${response.status}）。`);
    const text = await response.text();
    if (!text.trim()) return;
    const payload = record(JSON.parse(text));
    if (payload?.ret !== undefined && payload.ret !== 0) {
      throw new Error(`iLink 鉴权失败（ret=${String(payload.ret)}）。`);
    }
  }

  private async pollLoop(signal: AbortSignal): Promise<void> {
    let failures = 0;
    while (!signal.aborted) {
      const config = this.config;
      if (!config) return;
      try {
        const response = await this.ilinkFetch(config, '/ilink/bot/getupdates', {
          method: 'POST',
          body: JSON.stringify({
            get_updates_buf: this.cursor,
            base_info: { channel_version: CHANNEL_VERSION },
          }),
          signal,
        });
        if (!response.ok) throw new Error(`微信长轮询失败（HTTP ${response.status}）。`);
        const payload = record(await response.json());
        if (payload?.ret !== undefined && payload.ret !== 0) {
          throw new Error(`微信长轮询失败（ret=${String(payload.ret)}）。`);
        }
        this.cursor = stringField(payload?.get_updates_buf) ?? this.cursor;
        const messages = Array.isArray(payload?.msgs) ? payload.msgs : [];
        for (const message of messages) {
          const item = record(message);
          if (item?.message_type === 1 && item.message_state === 2) {
            void this.handleInboundMessage(item).catch(() => undefined);
          }
        }
        failures = 0;
      } catch {
        if (signal.aborted) return;
        failures += 1;
        await abortableDelay(Math.min(30_000, 1_000 * 2 ** (failures - 1)), signal);
      }
    }
  }

  private async handleInboundMessage(message: Record<string, unknown>): Promise<void> {
    const contextToken = stringField(message.context_token);
    const senderId = stringField(message.from_user_id);
    if (!contextToken || !senderId || this.wasProcessed(contextToken)) return;
    const itemList = Array.isArray(message.item_list) ? message.item_list : [];
    const text = itemList
      .map((item) => record(item))
      .filter((item) => item?.type === 1)
      .map((item) => stringField(record(item?.text_item)?.text) ?? '')
      .join('')
      .trim();
    if (!text || !this.onMessage) return;
    this.ilinkUserId ??= stringField(message.to_user_id);
    this.contextTokens.set(senderId, {
      token: contextToken,
      expiresAt: Date.now() + REPLY_WINDOW_MS,
    });
    this.transition('connected', { messageReceived: true });
    await this.sendTyping(senderId, contextToken).catch(() => undefined);
    try {
      const reply = await this.onMessage({
        platform: 'wechat',
        conversationId: senderId,
        messageId: `${Date.now()}-${senderId.slice(0, 8)}`,
        text,
        senderName: senderId.split('@')[0],
        conversationType: 'direct',
      });
      await this.sendText(senderId, reply);
    } catch (error) {
      await this.sendText(senderId, `${BOT_REPLY_ERROR_PREFIX}${errorMessage(error)}`).catch(
        () => undefined,
      );
    }
  }

  private async sendTyping(userId: string, contextToken: string): Promise<void> {
    const config = this.requireConfig();
    if (!this.ilinkUserId) return;
    const configResponse = await this.ilinkFetch(config, '/ilink/bot/getconfig', {
      method: 'POST',
      body: JSON.stringify({
        ilink_user_id: this.ilinkUserId,
        context_token: contextToken,
        base_info: { channel_version: CHANNEL_VERSION },
      }),
    });
    if (!configResponse.ok) return;
    const payload = record(await configResponse.json());
    const typingTicket = stringField(payload?.typing_ticket);
    if (!typingTicket) return;
    await this.ilinkFetch(config, '/ilink/bot/sendtyping', {
      method: 'POST',
      body: JSON.stringify({
        to_user_id: userId,
        context_token: contextToken,
        typing_ticket: typingTicket,
        message_state: 1,
        base_info: { channel_version: CHANNEL_VERSION },
      }),
    });
  }

  private async sendText(userId: string, text: string): Promise<void> {
    const config = this.requireConfig();
    const context = this.contextTokens.get(userId);
    if (!context || Date.now() > context.expiresAt) {
      throw new Error('微信 24 小时回复窗口已结束，请让对方重新发送一条消息。');
    }
    for (const chunk of textChunks(text, 4_000)) {
      const response = await this.ilinkFetch(config, '/ilink/bot/sendmessage', {
        method: 'POST',
        body: JSON.stringify({
          msg: {
            to_user_id: userId,
            client_id: `sync-think-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            message_type: 2,
            message_state: 2,
            context_token: context.token,
            item_list: [{ type: 1, text_item: { text: chunk } }],
          },
          base_info: { channel_version: CHANNEL_VERSION },
        }),
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`微信消息发送失败（HTTP ${response.status}）。`);
      if (body.trim()) {
        const payload = record(JSON.parse(body));
        if (payload?.ret !== undefined && payload.ret !== 0) {
          throw new Error(`微信消息发送失败（ret=${String(payload.ret)}）。`);
        }
      }
    }
  }

  private ilinkFetch(
    config: BotChannelRuntimeConfig,
    path: string,
    init: RequestInit,
  ): Promise<Response> {
    const token = stringField(config.credentials.botToken);
    if (!token) throw new Error('请先完成微信扫码登录或填写 Bot Token。');
    return fetch(`${normalizedBaseUrl(config.settings.baseUrl)}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        AuthorizationType: 'ilink_bot_token',
        Authorization: `Bearer ${token}`,
        ...init.headers,
      },
    });
  }

  private requireConfig(): BotChannelRuntimeConfig {
    if (!this.config) throw new Error('微信机器人尚未启动。');
    return this.config;
  }

  private wasProcessed(token: string): boolean {
    const now = Date.now();
    for (const [key, expiresAt] of this.processedTokens) {
      if (expiresAt <= now) this.processedTokens.delete(key);
    }
    if (this.processedTokens.has(token)) return true;
    this.processedTokens.set(token, now + 5 * 60_000);
    return false;
  }
}

function normalizedBaseUrl(value: string | undefined): string {
  return (stringField(value) ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
}

async function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}
