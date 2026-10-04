import { describe, expect, it } from 'vitest';
import {
  anthropicReasoningBodyFields,
  normalizeReasoningEffort,
  openAiReasoningBodyFields,
  shouldOmitReasoningEffort,
  wireReasoningEffort,
} from './reasoning.js';

describe('reasoning helpers', () => {
  it('normalizes and omits only off/disabled', () => {
    expect(normalizeReasoningEffort(' High ')).toBe('high');
    expect(shouldOmitReasoningEffort(undefined)).toBe(true);
    expect(shouldOmitReasoningEffort('auto')).toBe(false);
    expect(shouldOmitReasoningEffort('off')).toBe(true);
    expect(shouldOmitReasoningEffort('none')).toBe(true);
    expect(shouldOmitReasoningEffort('medium')).toBe(false);
  });

  it('maps OpenAI-compatible body fields', () => {
    // 'auto' is a product decision: send a default effort so thinking models produce a trace.
    expect(openAiReasoningBodyFields('auto')).toEqual({
      reasoning_effort: 'high',
      enable_thinking: true,
    });
    expect(openAiReasoningBodyFields('high')).toEqual({
      reasoning_effort: 'high',
      enable_thinking: true,
    });
    expect(openAiReasoningBodyFields('off')).toEqual({ enable_thinking: false });
    expect(openAiReasoningBodyFields(undefined)).toEqual({});
  });

  it.each(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'])(
    'preserves explicitly selected %s effort on the wire',
    (effort) => {
      expect(wireReasoningEffort(effort)).toBe(effort);
      expect(openAiReasoningBodyFields(` ${effort.toUpperCase()} `)).toEqual({
        reasoning_effort: effort,
        enable_thinking: true,
      });
    },
  );

  it('retains the product default only for automatic effort', () => {
    expect(wireReasoningEffort('auto')).toBe('high');
  });

  it('maps Anthropic thinking budget by effort', () => {
    expect(anthropicReasoningBodyFields('auto')).toEqual({
      thinking: { type: 'enabled', budget_tokens: 8192 },
    });
    expect(anthropicReasoningBodyFields('low')).toEqual({
      thinking: { type: 'enabled', budget_tokens: 2048 },
    });
    expect(anthropicReasoningBodyFields('high')).toEqual({
      thinking: { type: 'enabled', budget_tokens: 16384 },
    });
    expect(anthropicReasoningBodyFields('off')).toEqual({});
  });
});
