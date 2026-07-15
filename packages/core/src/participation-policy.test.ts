import { describe, expect, it } from 'vitest';
import type { ParticipationMode } from '@sync-think/shared';
import { canTransitionMode } from './participation-policy.js';

describe('participation policy', () => {
  it('allows conversation to enter collaboration', () => {
    expect(canTransitionMode('conversation', 'collaboration')).toBe(true);
  });

  it('rejects collaboration to automatic without an approved plan', () => {
    expect(
      canTransitionMode('collaboration', 'automatic', { approvedPlan: false }),
    ).toBe(false);
  });

  it('allows automatic to return to conversation', () => {
    expect(canTransitionMode('automatic', 'conversation')).toBe(true);
  });

  it.each([
    [false, false, false],
    [true, false, false],
    [false, true, false],
    [true, true, true],
  ])('requires both an approved plan and applicable policy (%s, %s)', (
    approvedPlan,
    applicablePolicy,
    expected,
  ) => {
    expect(
      canTransitionMode('conversation', 'automatic', { approvedPlan, applicablePolicy }),
    ).toBe(expected);
  });

  it('rejects unknown modes before checking an equal transition', () => {
    const unknown = 'unknown-mode' as ParticipationMode;

    expect(canTransitionMode(unknown, unknown)).toBe(false);
    expect(canTransitionMode(unknown, 'conversation')).toBe(false);
    expect(canTransitionMode('conversation', unknown)).toBe(false);
  });
});
