export { isRecord } from '@sync-think/shared/value-validation';

export const PROVIDER_PROTOCOLS = new Set([
  'openai-responses',
  'openai-chat',
  'openai-images',
  'anthropic-messages',
]);

export function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

export function isBoundedProviderId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
}
