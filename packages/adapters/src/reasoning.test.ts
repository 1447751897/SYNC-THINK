import { describe, expect, it } from 'vitest';
import {
  anthropicReasoningBodyFields,
  normalizeReasoningEffort,
  openAiReasoningBodyFields,
  shouldOmitReasoningEffort,
} from './reasoning.js';

describe('reasoning helpers', () => {
  it('normalizes and omits auto/off', () => {
    expect(normalizeReasoningEffort(' High ')).toBe('high');
    expect(shouldOmitReasoningEffort(undefined)).toBe(true);
    expect(shouldOmitReasoningEffort('auto')).toBe(true);
    expect(shouldOmitReasoningEffort('off')).toBe(true);
    expect(shouldOmitReasoningEffort('medium')).toBe(false);
  });

  it('maps OpenAI-compatible body fields', () => {
    expect(openAiReasoningBodyFields('auto')).toEqual({});
    expect(openAiReasoningBodyFields('high')).toEqual({
      reasoning_effort: 'high',
      enable_thinking: true,
    });
  });

  it('maps Anthropic thinking budget by effort', () => {
    expect(anthropicReasoningBodyFields('auto')).toEqual({});
    expect(anthropicReasoningBodyFields('low')).toEqual({
      thinking: { type: 'enabled', budget_tokens: 2048 },
    });
    expect(anthropicReasoningBodyFields('high')).toEqual({
      thinking: { type: 'enabled', budget_tokens: 16384 },
    });
  });
});
