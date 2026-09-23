import type { ModelId } from '@sync-think/shared';
import type { PromptEnhanceCancelPayload, PromptEnhancePayload } from './commands.js';

export function tryParsePromptEnhancePayload(value: unknown): PromptEnhancePayload | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const payload = value as Record<string, unknown>;
  if (typeof payload.requestId !== 'string' || typeof payload.text !== 'string') {
    return undefined;
  }
  const requestId = payload.requestId.trim();
  const text = payload.text.trim();
  if (!requestId || requestId.length > 160 || !text || text.length > 100_000) return undefined;
  if (payload.modelId !== undefined && typeof payload.modelId !== 'string') return undefined;
  const modelId = typeof payload.modelId === 'string' ? payload.modelId.trim() : '';
  return {
    requestId,
    text,
    ...(modelId ? { modelId: modelId as ModelId } : {}),
  };
}

export function tryParsePromptEnhanceCancelPayload(
  value: unknown,
): PromptEnhanceCancelPayload | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const payload = value as Record<string, unknown>;
  if (typeof payload.requestId !== 'string') return undefined;
  const requestId = payload.requestId.trim();
  return requestId && requestId.length <= 160 ? { requestId } : undefined;
}
