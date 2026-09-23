import {
  parseDesignGeneratePayload,
  tryParsePromptEnhanceCancelPayload,
  tryParsePromptEnhancePayload,
  type DesignGeneratePayload,
  type PromptEnhanceCancelPayload,
  type PromptEnhancePayload,
} from '@sync-think/protocol';

export function parsePromptEnhancePayload(value: unknown): PromptEnhancePayload {
  const payload = tryParsePromptEnhancePayload(value);
  if (!payload) {
    throw new Error(
      value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        'modelId' in value &&
        value.modelId !== undefined &&
        typeof value.modelId !== 'string'
        ? 'Invalid prompt-enhance model'
        : 'Invalid prompt-enhance payload',
    );
  }
  return payload;
}

export function parsePromptEnhanceCancelPayload(value: unknown): PromptEnhanceCancelPayload {
  const payload = tryParsePromptEnhanceCancelPayload(value);
  if (!payload) {
    throw new Error('Invalid prompt-enhance-cancel payload');
  }
  return payload;
}

export function parseDesignGeneratePayloadForDesktop(value: unknown): DesignGeneratePayload {
  const payload = parseDesignGeneratePayload(value);
  if (!payload) throw new Error('Invalid design-generate payload');
  return payload;
}
