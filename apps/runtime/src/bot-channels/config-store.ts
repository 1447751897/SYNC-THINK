import type {
  BotChannelConfigSummary,
  BotChannelPlatform,
  SaveBotChannelConfigPayload,
  TestBotChannelResponse,
} from '@sync-think/protocol';
import type { BotChannelGatewayStatus, BotChannelRuntimeConfig } from './types.js';

export const BOT_CHANNEL_PLATFORMS = [
  'telegram',
  'feishu',
  'wecom',
  'wechat',
  'discord',
  'dingtalk',
  'qq',
] as const satisfies readonly BotChannelPlatform[];

type SecretName = 'token' | 'appSecret' | 'secret' | 'botToken' | 'clientSecret';

interface PersistedBotChannelConfig {
  enabled: boolean;
  secretHandles: Partial<Record<SecretName, string>>;
  settings: Record<string, string>;
  identity: {
    botUsername?: string;
    botDisplayName?: string;
  };
  lastError?: string;
  updatedAt?: string;
}

interface SettingStoreLike {
  get(key: string): { value: unknown } | undefined;
  set(key: string, value: unknown, now?: string): unknown;
}

interface SecureStoreLike {
  storeSecret(value: string): Promise<string>;
  retrieveSecret(handle: string): Promise<string>;
  removeSecret(handle: string): Promise<unknown>;
}

const SECRET_FIELDS: Record<BotChannelPlatform, readonly SecretName[]> = {
  telegram: ['token'],
  feishu: ['appSecret'],
  wecom: ['secret'],
  wechat: ['botToken'],
  discord: ['token'],
  dingtalk: ['clientSecret'],
  qq: ['appSecret'],
};

const REQUIRED_PUBLIC_FIELDS: Record<BotChannelPlatform, readonly string[]> = {
  telegram: [],
  feishu: ['appId'],
  wecom: ['botId'],
  wechat: [],
  discord: [],
  dingtalk: ['clientId'],
  qq: ['appId'],
};

export class BotChannelConfigStore {
  constructor(
    private readonly settings: SettingStoreLike,
    private readonly secrets: SecureStoreLike,
  ) {}

  read(platform: BotChannelPlatform): PersistedBotChannelConfig {
    const value = this.settings.get(settingKey(platform))?.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyConfig(platform);
    const record = value as Record<string, unknown>;
    const settings = stringRecord(record.settings);
    const secretHandles = stringRecord(record.secretHandles) as Partial<Record<SecretName, string>>;
    const identity = stringRecord(record.identity);

    // Migration from the first Telegram-only implementation.
    if (platform === 'telegram') {
      if (!secretHandles.token && stringValue(record.tokenHandle)) {
        secretHandles.token = stringValue(record.tokenHandle);
      }
      settings.proxyUrl ??= stringValue(record.proxyUrl) ?? '';
      const legacyUsername = stringValue(record.botUsername);
      const legacyDisplayName = stringValue(record.botDisplayName);
      if (!identity.botUsername && legacyUsername) identity.botUsername = legacyUsername;
      if (!identity.botDisplayName && legacyDisplayName) {
        identity.botDisplayName = legacyDisplayName;
      }
    }

    return {
      enabled: record.enabled === true,
      secretHandles,
      settings: { ...defaultSettings(platform), ...settings },
      identity: {
        ...(identity.botUsername ? { botUsername: identity.botUsername } : {}),
        ...(identity.botDisplayName ? { botDisplayName: identity.botDisplayName } : {}),
      },
      ...(stringValue(record.lastError) ? { lastError: stringValue(record.lastError) } : {}),
      ...(stringValue(record.updatedAt) ? { updatedAt: stringValue(record.updatedAt) } : {}),
    };
  }

  summary(platform: BotChannelPlatform, status?: BotChannelGatewayStatus): BotChannelConfigSummary {
    const config = this.read(platform);
    const state = status?.state ?? 'disconnected';
    return {
      platform,
      enabled: config.enabled,
      credentialsConfigured: this.isConfigured(platform, config),
      connected: state === 'connected',
      state,
      ...publicSummarySettings(platform, config.settings),
      ...config.identity,
      ...((status?.lastError ?? config.lastError)
        ? { lastError: status?.lastError ?? config.lastError }
        : {}),
      ...(config.updatedAt ? { updatedAt: config.updatedAt } : {}),
    };
  }

  async resolve(
    platform: BotChannelPlatform,
    replacements: Partial<Record<SecretName, string>> = {},
    settingOverrides: Record<string, string | undefined> = {},
  ): Promise<BotChannelRuntimeConfig> {
    const config = this.read(platform);
    const credentials: Record<string, string> = {};
    for (const field of SECRET_FIELDS[platform]) {
      const replacement = stringValue(replacements[field]);
      if (replacement) {
        credentials[field] = replacement;
        continue;
      }
      const handle = config.secretHandles[field];
      if (handle) {
        const value = stringValue(await this.secrets.retrieveSecret(handle));
        if (value) credentials[field] = value;
      }
    }
    const settings = { ...config.settings };
    for (const [key, value] of Object.entries(settingOverrides)) {
      if (value !== undefined) settings[key] = value.trim();
    }
    for (const field of REQUIRED_PUBLIC_FIELDS[platform]) {
      const value = stringValue(settings[field]);
      if (value) credentials[field] = value;
    }
    return { platform, enabled: config.enabled, credentials, settings };
  }

  async commit(
    payload: SaveBotChannelConfigPayload,
    identity?: Pick<TestBotChannelResponse, 'botUsername' | 'botDisplayName'>,
  ): Promise<PersistedBotChannelConfig> {
    const previous = this.read(payload.platform);
    const replacements = secretReplacements(payload);
    const nextHandles = { ...previous.secretHandles };
    const createdHandles: string[] = [];
    try {
      for (const [field, value] of Object.entries(replacements) as [SecretName, string][]) {
        const handle = await this.secrets.storeSecret(value);
        createdHandles.push(handle);
        nextHandles[field] = handle;
      }
      const next: PersistedBotChannelConfig = {
        enabled: payload.enabled,
        secretHandles: nextHandles,
        settings: { ...previous.settings, ...publicPayloadSettings(payload) },
        identity: {
          ...(identity?.botUsername
            ? { botUsername: identity.botUsername }
            : previous.identity.botUsername
              ? { botUsername: previous.identity.botUsername }
              : {}),
          ...(identity?.botDisplayName
            ? { botDisplayName: identity.botDisplayName }
            : previous.identity.botDisplayName
              ? { botDisplayName: previous.identity.botDisplayName }
              : {}),
        },
        updatedAt: new Date().toISOString(),
      };
      this.settings.set(settingKey(payload.platform), next, next.updatedAt);
      for (const field of Object.keys(replacements) as SecretName[]) {
        const oldHandle = previous.secretHandles[field];
        if (oldHandle && oldHandle !== nextHandles[field]) {
          await this.secrets.removeSecret(oldHandle).catch(() => undefined);
        }
      }
      return next;
    } catch (error) {
      await Promise.all(
        createdHandles.map((handle) => this.secrets.removeSecret(handle).catch(() => undefined)),
      );
      throw error;
    }
  }

  async commitWechatLogin(input: {
    botToken: string;
    baseUrl?: string;
    botId?: string;
    ilinkUserId?: string;
  }): Promise<void> {
    await this.commit({
      platform: 'wechat',
      enabled: true,
      botToken: input.botToken,
      ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
    });
    const saved = this.read('wechat');
    const updated: PersistedBotChannelConfig = {
      ...saved,
      settings: {
        ...saved.settings,
        ...(input.botId ? { botId: input.botId } : {}),
        ...(input.ilinkUserId ? { ilinkUserId: input.ilinkUserId } : {}),
      },
    };
    this.settings.set(settingKey('wechat'), updated, updated.updatedAt);
  }

  isConfigured(platform: BotChannelPlatform, config = this.read(platform)): boolean {
    return (
      SECRET_FIELDS[platform].every((field) => Boolean(config.secretHandles[field])) &&
      REQUIRED_PUBLIC_FIELDS[platform].every((field) => Boolean(config.settings[field]))
    );
  }
}

function settingKey(platform: BotChannelPlatform): string {
  return `bot.channel.${platform}`;
}

function emptyConfig(platform: BotChannelPlatform): PersistedBotChannelConfig {
  return {
    enabled: false,
    secretHandles: {},
    settings: defaultSettings(platform),
    identity: {},
  };
}

function defaultSettings(platform: BotChannelPlatform): Record<string, string> {
  if (platform === 'telegram' || platform === 'discord') return { proxyUrl: '' };
  if (platform === 'feishu') return { domain: 'feishu', renderMode: 'card' };
  if (platform === 'wechat') return { baseUrl: 'https://ilinkai.weixin.qq.com' };
  return {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      const parsed = stringValue(entry);
      return parsed ? [[key, parsed]] : [];
    }),
  );
}

function secretReplacements(
  payload: SaveBotChannelConfigPayload,
): Partial<Record<SecretName, string>> {
  const result: Partial<Record<SecretName, string>> = {};
  for (const field of SECRET_FIELDS[payload.platform]) {
    const value = stringValue(payload[field as keyof SaveBotChannelConfigPayload]);
    if (value) result[field] = value;
  }
  return result;
}

function publicPayloadSettings(payload: SaveBotChannelConfigPayload): Record<string, string> {
  const keys = [
    'proxyUrl',
    'appId',
    'botId',
    'clientId',
    'domain',
    'renderMode',
    'baseUrl',
  ] as const;
  return Object.fromEntries(
    keys.flatMap((key) =>
      key in payload && typeof payload[key] === 'string' ? [[key, payload[key]!.trim()]] : [],
    ),
  );
}

function publicSummarySettings(
  platform: BotChannelPlatform,
  settings: Record<string, string>,
): Partial<BotChannelConfigSummary> {
  switch (platform) {
    case 'telegram':
    case 'discord':
      return { proxyUrl: settings.proxyUrl ?? '' };
    case 'feishu':
      return {
        ...(settings.appId ? { appId: settings.appId } : {}),
        domain: settings.domain === 'lark' ? 'lark' : 'feishu',
        renderMode: settings.renderMode === 'text' ? 'text' : 'card',
      };
    case 'wecom':
      return settings.botId ? { botId: settings.botId } : {};
    case 'wechat':
      return {
        baseUrl: settings.baseUrl ?? 'https://ilinkai.weixin.qq.com',
        ...(settings.botId ? { botId: settings.botId } : {}),
      };
    case 'dingtalk':
      return settings.clientId ? { clientId: settings.clientId } : {};
    case 'qq':
      return settings.appId ? { appId: settings.appId } : {};
  }
}
