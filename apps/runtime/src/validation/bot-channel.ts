import type {
  CheckWechatBotQrPayload,
  GetBotChannelConfigPayload,
  RequestWechatBotQrPayload,
  SaveBotChannelConfigPayload,
  TestBotChannelPayload,
} from '@sync-think/protocol';
import { hasOnlyKeys, isRecord } from './shared.js';

const PLATFORMS = new Set([
  'telegram',
  'feishu',
  'wecom',
  'wechat',
  'discord',
  'dingtalk',
  'qq',
] as const);

type Platform = GetBotChannelConfigPayload['platform'];

function platform(value: unknown): Platform | undefined {
  return typeof value === 'string' && PLATFORMS.has(value as Platform)
    ? (value as Platform)
    : undefined;
}

function optionalText(value: unknown, max: number): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > max) return null;
  return value.trim();
}

export function parseGetBotChannelConfigPayload(
  value: unknown,
): GetBotChannelConfigPayload | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ['platform'])) return undefined;
  const parsedPlatform = platform(value.platform);
  return parsedPlatform ? { platform: parsedPlatform } : undefined;
}

export function parseSaveBotChannelConfigPayload(
  value: unknown,
): SaveBotChannelConfigPayload | undefined {
  if (!isRecord(value)) return undefined;
  const parsedPlatform = platform(value.platform);
  if (
    !parsedPlatform ||
    typeof value.enabled !== 'boolean' ||
    (value.testConnection !== undefined && typeof value.testConnection !== 'boolean')
  ) {
    return undefined;
  }
  const common = {
    platform: parsedPlatform,
    enabled: value.enabled,
    ...(typeof value.testConnection === 'boolean' ? { testConnection: value.testConnection } : {}),
  };
  return parsePlatformFields(value, parsedPlatform, common) as
    SaveBotChannelConfigPayload | undefined;
}

export function parseTestBotChannelPayload(value: unknown): TestBotChannelPayload | undefined {
  if (!isRecord(value)) return undefined;
  const parsedPlatform = platform(value.platform);
  if (!parsedPlatform) return undefined;
  return parsePlatformFields(value, parsedPlatform, {
    platform: parsedPlatform,
  }) as TestBotChannelPayload | undefined;
}

export function parseRequestWechatBotQrPayload(
  value: unknown,
): RequestWechatBotQrPayload | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ['baseUrl'])) return undefined;
  const baseUrl = optionalText(value.baseUrl, 2_048);
  if (baseUrl === null) return undefined;
  return baseUrl === undefined ? {} : { baseUrl };
}

export function parseCheckWechatBotQrPayload(value: unknown): CheckWechatBotQrPayload | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ['qrcode', 'baseUrl'])) return undefined;
  const qrcode = optionalText(value.qrcode, 8_192);
  const baseUrl = optionalText(value.baseUrl, 2_048);
  if (!qrcode || baseUrl === null) return undefined;
  return { qrcode, ...(baseUrl === undefined ? {} : { baseUrl }) };
}

function parseTextFields(
  value: Record<string, unknown>,
  fields: ReadonlyArray<readonly [string, number]>,
): Record<string, string> | undefined {
  const parsed: Record<string, string> = {};
  for (const [key, max] of fields) {
    const text = optionalText(value[key], max);
    if (text === null) return undefined;
    if (text !== undefined) parsed[key] = text;
  }
  return parsed;
}

function parsePlatformFields(
  value: Record<string, unknown>,
  parsedPlatform: Platform,
  common: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const commonKeys = ['platform', ...('enabled' in common ? ['enabled', 'testConnection'] : [])];
  if (parsedPlatform === 'telegram' || parsedPlatform === 'discord') {
    if (!hasOnlyKeys(value, [...commonKeys, 'token', 'proxyUrl'])) return undefined;
    const fields = parseTextFields(value, [
      ['token', 8_192],
      ['proxyUrl', 2_048],
    ]);
    return fields ? { ...common, ...fields } : undefined;
  }
  if (parsedPlatform === 'feishu') {
    if (!hasOnlyKeys(value, [...commonKeys, 'appId', 'appSecret', 'domain', 'renderMode'])) {
      return undefined;
    }
    if (value.domain !== undefined && value.domain !== 'feishu' && value.domain !== 'lark') {
      return undefined;
    }
    if (
      value.renderMode !== undefined &&
      value.renderMode !== 'card' &&
      value.renderMode !== 'text'
    ) {
      return undefined;
    }
    const fields = parseTextFields(value, [
      ['appId', 512],
      ['appSecret', 8_192],
    ]);
    return fields
      ? {
          ...common,
          ...fields,
          ...(value.domain ? { domain: value.domain } : {}),
          ...(value.renderMode ? { renderMode: value.renderMode } : {}),
        }
      : undefined;
  }
  if (parsedPlatform === 'wecom') {
    if (!hasOnlyKeys(value, [...commonKeys, 'botId', 'secret'])) return undefined;
    const fields = parseTextFields(value, [
      ['botId', 512],
      ['secret', 8_192],
    ]);
    return fields ? { ...common, ...fields } : undefined;
  }
  if (parsedPlatform === 'dingtalk') {
    if (!hasOnlyKeys(value, [...commonKeys, 'clientId', 'clientSecret'])) return undefined;
    const fields = parseTextFields(value, [
      ['clientId', 512],
      ['clientSecret', 8_192],
    ]);
    return fields ? { ...common, ...fields } : undefined;
  }
  if (parsedPlatform === 'qq') {
    if (!hasOnlyKeys(value, [...commonKeys, 'appId', 'appSecret'])) return undefined;
    const fields = parseTextFields(value, [
      ['appId', 512],
      ['appSecret', 8_192],
    ]);
    return fields ? { ...common, ...fields } : undefined;
  }
  if (!hasOnlyKeys(value, [...commonKeys, 'botToken', 'baseUrl'])) return undefined;
  const fields = parseTextFields(value, [
    ['botToken', 8_192],
    ['baseUrl', 2_048],
  ]);
  return fields ? { ...common, ...fields } : undefined;
}
