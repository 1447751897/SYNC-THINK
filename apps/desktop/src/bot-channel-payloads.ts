import type {
  BotChannelPlatform,
  CheckWechatBotQrPayload,
  GetBotChannelConfigPayload,
  RequestWechatBotQrPayload,
  SaveBotChannelConfigPayload,
  TestBotChannelPayload,
} from '@sync-think/protocol';

function parseBotChannelPlatform(value: unknown): BotChannelPlatform {
  if (
    value !== 'telegram' &&
    value !== 'feishu' &&
    value !== 'wecom' &&
    value !== 'wechat' &&
    value !== 'discord' &&
    value !== 'dingtalk' &&
    value !== 'qq'
  ) {
    throw new Error('Invalid bot channel platform');
  }
  return value;
}

export function parseGetBotChannelConfigPayload(value: unknown): GetBotChannelConfigPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid bot-channel-get payload');
  }
  return { platform: parseBotChannelPlatform((value as Record<string, unknown>).platform) };
}

export function parseSaveBotChannelConfigPayload(value: unknown): SaveBotChannelConfigPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid bot-channel-save payload');
  }
  const record = value as Record<string, unknown>;
  if (typeof record.enabled !== 'boolean') throw new Error('Invalid bot-channel-save payload');
  if (record.testConnection !== undefined && typeof record.testConnection !== 'boolean') {
    throw new Error('Invalid bot-channel-save payload');
  }
  const platform = parseBotChannelPlatform(record.platform);
  return parseBotChannelFields(record, platform, {
    platform,
    enabled: record.enabled,
    ...(typeof record.testConnection === 'boolean'
      ? { testConnection: record.testConnection }
      : {}),
  }) as unknown as SaveBotChannelConfigPayload;
}

export function parseTestBotChannelPayload(value: unknown): TestBotChannelPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid bot-channel-test payload');
  }
  const record = value as Record<string, unknown>;
  const platform = parseBotChannelPlatform(record.platform);
  return parseBotChannelFields(record, platform, {
    platform,
  }) as unknown as TestBotChannelPayload;
}

export function parseRequestWechatBotQrPayload(value: unknown): RequestWechatBotQrPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid bot-channel-wechat-qr-request payload');
  }
  const record = value as Record<string, unknown>;
  const baseUrl = optionalBotText(record.baseUrl, 2_048, 'baseUrl');
  return baseUrl === undefined ? {} : { baseUrl };
}

export function parseCheckWechatBotQrPayload(value: unknown): CheckWechatBotQrPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid bot-channel-wechat-qr-check payload');
  }
  const record = value as Record<string, unknown>;
  const qrcode = optionalBotText(record.qrcode, 8_192, 'qrcode');
  const baseUrl = optionalBotText(record.baseUrl, 2_048, 'baseUrl');
  if (!qrcode) throw new Error('Invalid bot-channel-wechat-qr-check payload');
  return { qrcode, ...(baseUrl === undefined ? {} : { baseUrl }) };
}

function parseBotChannelFields(
  record: Record<string, unknown>,
  platform: BotChannelPlatform,
  common: Record<string, unknown>,
): Record<string, unknown> {
  if (platform === 'telegram' || platform === 'discord') {
    return {
      ...common,
      ...optionalSecretField(record, 'token'),
      ...optionalPublicField(record, 'proxyUrl', 2_048),
    };
  }
  if (platform === 'feishu') {
    if (record.domain !== undefined && record.domain !== 'feishu' && record.domain !== 'lark') {
      throw new Error('Invalid bot channel domain');
    }
    if (
      record.renderMode !== undefined &&
      record.renderMode !== 'card' &&
      record.renderMode !== 'text'
    ) {
      throw new Error('Invalid bot channel render mode');
    }
    return {
      ...common,
      ...optionalPublicField(record, 'appId', 512),
      ...optionalSecretField(record, 'appSecret'),
      ...(record.domain ? { domain: record.domain } : {}),
      ...(record.renderMode ? { renderMode: record.renderMode } : {}),
    };
  }
  if (platform === 'wecom') {
    return {
      ...common,
      ...optionalPublicField(record, 'botId', 512),
      ...optionalSecretField(record, 'secret'),
    };
  }
  if (platform === 'dingtalk') {
    return {
      ...common,
      ...optionalPublicField(record, 'clientId', 512),
      ...optionalSecretField(record, 'clientSecret'),
    };
  }
  if (platform === 'qq') {
    return {
      ...common,
      ...optionalPublicField(record, 'appId', 512),
      ...optionalSecretField(record, 'appSecret'),
    };
  }
  return {
    ...common,
    ...optionalSecretField(record, 'botToken'),
    ...optionalPublicField(record, 'baseUrl', 2_048),
  };
}

function optionalBotText(value: unknown, max: number, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > max) {
    throw new Error(`Invalid bot channel ${field}`);
  }
  return value.trim();
}

function optionalSecretField(
  record: Record<string, unknown>,
  field: string,
): Record<string, string> {
  const value = optionalBotText(record[field], 8_192, field);
  return value ? { [field]: value } : {};
}

function optionalPublicField(
  record: Record<string, unknown>,
  field: string,
  max: number,
): Record<string, string> {
  const value = optionalBotText(record[field], max, field);
  return value === undefined ? {} : { [field]: value };
}
