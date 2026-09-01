import { describe, expect, it } from 'vitest';
import {
  coerceReasoningEffort,
  REASONING_OPTIONS,
  reasoningLevelsForModel,
} from './compose-toolbar.js';

describe('reasoningLevelsForModel', () => {
  it('always returns the fixed full ladder including xhigh/max', () => {
    const levels = reasoningLevelsForModel(undefined);
    expect(levels).toEqual([
      'auto',
      'minimal',
      'off',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(REASONING_OPTIONS.map((o) => o.value)).toEqual(levels);
    // Same set regardless of model id (no per-model filtering).
    expect(reasoningLevelsForModel('gpt-4o-mini')).toEqual(levels);
    expect(reasoningLevelsForModel('claude-sonnet-4')).toEqual(levels);
  });
});

describe('coerceReasoningEffort', () => {
  it('keeps allowed values and falls back to auto', () => {
    const allowed = ['auto', 'low', 'medium', 'high'] as const;
    expect(coerceReasoningEffort('high', allowed)).toBe('high');
    expect(coerceReasoningEffort('xhigh', allowed)).toBe('auto');
  });
});
