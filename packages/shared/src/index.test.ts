import { describe, it, expect } from 'vitest';
import { isRetryable, HUMAN_ONLY_ACTIONS, TERMINAL_RUN_STATES, ulid } from './index.js';

describe('shared domain sanity', () => {
  it('classifies retryable transient failures only', () => {
    expect(isRetryable('transient')).toBe(true);
    expect(isRetryable('timeout')).toBe(true);
    expect(isRetryable('rate-limit')).toBe(true);
    expect(isRetryable('auth')).toBe(false);
    expect(isRetryable('acceptance')).toBe(false);
    expect(isRetryable('permission')).toBe(false);
  });

  it('keeps human-only actions list non-empty and stable', () => {
    expect(HUMAN_ONLY_ACTIONS.length).toBeGreaterThan(0);
    expect(HUMAN_ONLY_ACTIONS).toContain('irreversible-deletion');
    expect(HUMAN_ONLY_ACTIONS).toContain('payment-or-purchase');
  });

  it('marks completed/failed/cancelled as terminal', () => {
    expect(TERMINAL_RUN_STATES.has('completed')).toBe(true);
    expect(TERMINAL_RUN_STATES.has('failed')).toBe(true);
    expect(TERMINAL_RUN_STATES.has('cancelled')).toBe(true);
    expect(TERMINAL_RUN_STATES.has('running')).toBe(false);
  });

  it('ulid generates monotonic-ish 26-char ids', () => {
    const a = ulid(1700000000000);
    const b = ulid(1700000000001);
    expect(a.length).toBe(26);
    expect(b.length).toBe(26);
    expect(b > a).toBe(true);
  });
});
