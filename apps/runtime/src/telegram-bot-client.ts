const TELEGRAM_API_ROOT = 'https://api.telegram.org';
const TELEGRAM_MESSAGE_LIMIT = 4_096;

export interface TelegramBotIdentity {
  id: number;
  username?: string;
  displayName?: string;
}

export interface TelegramIncomingMessage {
  updateId: number;
  messageId: number;
  chatId: number;
  chatType: string;
  text: string;
  senderName?: string;
}

export interface TelegramUpdateBatch {
  messages: TelegramIncomingMessage[];
  nextOffset?: number;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

interface TelegramUserResult {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TelegramUpdateResult {
  update_id: number;
  message?: {
    message_id?: number;
    text?: string;
    chat?: { id?: number; type?: string };
    from?: TelegramUserResult;
  };
}

type TelegramRequestInit = Omit<RequestInit, 'dispatcher'> & { dispatcher?: unknown };
type TelegramFetch = (input: string, init?: TelegramRequestInit) => Promise<Response>;

function normalizeProxyUrl(value: string | undefined): string | undefined {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  const parsed = new URL(raw);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('代理地址仅支持 http:// 或 https://。');
  }
  return parsed.toString().replace(/\/$/, '');
}

function telegramDisplayName(user: TelegramUserResult): string | undefined {
  const value = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return value || undefined;
}

function telegramSenderName(user: TelegramUserResult | undefined): string | undefined {
  if (!user) return undefined;
  return telegramDisplayName(user) ?? user.username;
}

function splitTelegramText(text: string): string[] {
  const value = text.trim();
  if (!value) return [];
  const chunks: string[] = [];
  let rest = value;
  while (rest.length > TELEGRAM_MESSAGE_LIMIT) {
    const window = rest.slice(0, TELEGRAM_MESSAGE_LIMIT);
    const breakAt = Math.max(
      window.lastIndexOf('\n'),
      window.lastIndexOf('。'),
      window.lastIndexOf(' '),
    );
    const length = breakAt > TELEGRAM_MESSAGE_LIMIT * 0.55 ? breakAt + 1 : TELEGRAM_MESSAGE_LIMIT;
    chunks.push(rest.slice(0, length).trimEnd());
    rest = rest.slice(length).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export class TelegramBotClient {
  private readonly fetchImpl: TelegramFetch;
  private readonly proxyAgents = new Map<string, { close(): Promise<void> | void }>();

  constructor(fetchImpl: TelegramFetch = fetch as unknown as TelegramFetch) {
    this.fetchImpl = fetchImpl;
  }

  async testConnection(
    token: string,
    proxyUrl?: string,
    signal?: AbortSignal,
  ): Promise<TelegramBotIdentity> {
    const user = await this.call<TelegramUserResult>(token, 'getMe', {}, proxyUrl, signal);
    return {
      id: user.id,
      ...(user.username ? { username: user.username } : {}),
      ...(telegramDisplayName(user) ? { displayName: telegramDisplayName(user) } : {}),
    };
  }

  async getUpdates(input: {
    token: string;
    offset?: number;
    proxyUrl?: string;
    signal?: AbortSignal;
  }): Promise<TelegramUpdateBatch> {
    const updates = await this.call<TelegramUpdateResult[]>(
      input.token,
      'getUpdates',
      {
        timeout: 25,
        limit: 50,
        allowed_updates: ['message'],
        ...(input.offset === undefined ? {} : { offset: input.offset }),
      },
      input.proxyUrl,
      input.signal,
    );
    const messages: TelegramIncomingMessage[] = [];
    for (const update of updates) {
      const message = update.message;
      const text = message?.text?.trim();
      const chatId = message?.chat?.id;
      const messageId = message?.message_id;
      if (!text || !Number.isSafeInteger(chatId) || !Number.isSafeInteger(messageId)) continue;
      messages.push({
        updateId: update.update_id,
        messageId: messageId!,
        chatId: chatId!,
        chatType: message?.chat?.type ?? 'unknown',
        text,
        ...(telegramSenderName(message?.from)
          ? { senderName: telegramSenderName(message?.from) }
          : {}),
      });
    }
    const highestUpdateId = updates.reduce(
      (highest, update) => Math.max(highest, update.update_id),
      Number.NEGATIVE_INFINITY,
    );
    return {
      messages,
      ...(Number.isFinite(highestUpdateId) ? { nextOffset: highestUpdateId + 1 } : {}),
    };
  }

  async sendTyping(token: string, chatId: number, proxyUrl?: string): Promise<void> {
    await this.call(token, 'sendChatAction', { chat_id: chatId, action: 'typing' }, proxyUrl);
  }

  async sendMessage(token: string, chatId: number, text: string, proxyUrl?: string): Promise<void> {
    for (const chunk of splitTelegramText(text)) {
      await this.call(token, 'sendMessage', { chat_id: chatId, text: chunk }, proxyUrl);
    }
  }

  async close(): Promise<void> {
    const agents = [...this.proxyAgents.values()];
    this.proxyAgents.clear();
    await Promise.allSettled(agents.map((agent) => Promise.resolve(agent.close())));
  }

  private async call<T = unknown>(
    token: string,
    method: string,
    payload: Record<string, unknown>,
    proxyUrl?: string,
    signal?: AbortSignal,
  ): Promise<T> {
    const normalizedToken = token.trim();
    if (!normalizedToken) throw new Error('Bot Token 不能为空。');
    if (!/^\d+:[A-Za-z0-9_-]+$/.test(normalizedToken)) {
      throw new Error('Bot Token 格式不正确。');
    }
    const dispatcher = await this.proxyDispatcher(proxyUrl);
    const response = await this.fetchImpl(`${TELEGRAM_API_ROOT}/bot${normalizedToken}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
      ...(dispatcher ? { dispatcher } : {}),
    });
    const body = (await response.json()) as TelegramApiResponse<T>;
    if (!response.ok || !body.ok || body.result === undefined) {
      throw new Error(
        body.description?.trim() || `Telegram API 请求失败（HTTP ${response.status}）。`,
      );
    }
    return body.result;
  }

  private async proxyDispatcher(
    proxyUrl: string | undefined,
  ): Promise<{ close(): Promise<void> | void } | undefined> {
    const normalized = normalizeProxyUrl(proxyUrl);
    if (!normalized) return undefined;
    const existing = this.proxyAgents.get(normalized);
    if (existing) return existing;
    const { ProxyAgent } = await import('undici');
    const created = new ProxyAgent(normalized);
    this.proxyAgents.set(normalized, created);
    return created;
  }
}

export const telegramBotInternals = { normalizeProxyUrl, splitTelegramText };
