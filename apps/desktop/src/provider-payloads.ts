import type {
  GetSettingsPayload,
  SetSettingPayload,
  UsageSummaryPayload,
} from '@sync-think/protocol';
import { hasOnlyKeys, isRecord } from './provider-payload-validation.js';

export function parseGetSettingsPayload(value: unknown): GetSettingsPayload {
  if (value === undefined || value === null) return {};
  if (!isRecord(value) || !hasOnlyKeys(value, ['keys'])) {
    throw new Error('Invalid get-settings payload');
  }
  if (
    value.keys !== undefined &&
    (!Array.isArray(value.keys) ||
      value.keys.length > 64 ||
      !value.keys.every(
        (key) => typeof key === 'string' && key.trim().length > 0 && key.length <= 128,
      ))
  ) {
    throw new Error('Invalid get-settings payload');
  }
  return {
    keys: Array.isArray(value.keys) ? value.keys.map((key) => String(key).trim()) : undefined,
  };
}

export function parseSetSettingPayload(value: unknown): SetSettingPayload {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['key', 'value']) ||
    typeof value.key !== 'string' ||
    value.key.trim().length === 0 ||
    value.key.length > 128 ||
    !Object.prototype.hasOwnProperty.call(value, 'value')
  ) {
    throw new Error('Invalid set-setting payload');
  }
  try {
    const encoded = JSON.stringify(value.value ?? null);
    if (encoded.length > 16_384) throw new Error('too large');
  } catch {
    throw new Error('Invalid set-setting payload');
  }
  return { key: value.key.trim(), value: value.value };
}

export function parseUsageSummaryPayload(value: unknown): UsageSummaryPayload {
  if (value === undefined || value === null) return {};
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['sinceDays', 'taskId', 'includeRequests', 'requestLimit'])
  ) {
    throw new Error('Invalid usage-summary payload');
  }
  if (
    value.sinceDays !== undefined &&
    (typeof value.sinceDays !== 'number' ||
      !Number.isFinite(value.sinceDays) ||
      value.sinceDays <= 0 ||
      value.sinceDays > 3650)
  ) {
    throw new Error('Invalid usage-summary payload');
  }
  if (
    value.taskId !== undefined &&
    (typeof value.taskId !== 'string' ||
      value.taskId.length > 256 ||
      value.taskId.trim().length === 0)
  ) {
    throw new Error('Invalid usage-summary payload');
  }
  if (value.includeRequests !== undefined && typeof value.includeRequests !== 'boolean') {
    throw new Error('Invalid usage-summary payload');
  }
  if (
    value.requestLimit !== undefined &&
    (typeof value.requestLimit !== 'number' ||
      !Number.isInteger(value.requestLimit) ||
      value.requestLimit < 1 ||
      value.requestLimit > 1_000)
  ) {
    throw new Error('Invalid usage-summary payload');
  }
  return {
    ...(value.sinceDays !== undefined ? { sinceDays: value.sinceDays as number } : {}),
    ...(typeof value.taskId === 'string' ? { taskId: value.taskId.trim() } : {}),
    ...(typeof value.includeRequests === 'boolean'
      ? { includeRequests: value.includeRequests }
      : {}),
    ...(typeof value.requestLimit === 'number' ? { requestLimit: value.requestLimit } : {}),
  };
}
