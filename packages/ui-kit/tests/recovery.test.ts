import { describe, expect, it } from 'vitest';
import {
  getRecoveryGuide,
  listKnownLimitations,
  normalizeFailureClass,
} from '../src/diagnostics/recovery.js';

describe('diagnostics recovery catalog (§23.2 #9/#12)', () => {
  it('normalizes aliases and maps guides', () => {
    expect(normalizeFailureClass('RATE_LIMIT')).toBe('rate-limit');
    expect(normalizeFailureClass(undefined)).toBe('unknown');
    const auth = getRecoveryGuide('auth');
    expect(auth.retryable).toBe(false);
    expect(auth.goTo).toBe('providers');
    expect(auth.steps.length).toBeGreaterThan(0);
    const transient = getRecoveryGuide('transient');
    expect(transient.retryable).toBe(true);
  });

  it('lists known limitations including security and M1 exit note', () => {
    const all = listKnownLimitations();
    expect(all.length).toBeGreaterThanOrEqual(4);
    expect(listKnownLimitations('security').some((l) => l.id === 'lim-secrets')).toBe(true);
    expect(all.some((l) => l.id === 'lim-m1-exit')).toBe(true);
  });
});
