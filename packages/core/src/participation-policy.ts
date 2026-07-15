import type { ParticipationMode } from '@sync-think/shared';

export interface ParticipationTransitionContext {
  approvedPlan?: boolean;
  applicablePolicy?: boolean;
}

const PARTICIPATION_MODES = new Set<ParticipationMode>([
  'conversation',
  'collaboration',
  'automatic',
]);

/**
 * Participation modes may move freely except that entering automatic mode
 * requires an already-approved plan and an applicable policy.
 */
export function canTransitionMode(
  current: ParticipationMode,
  next: ParticipationMode,
  context: ParticipationTransitionContext = {},
): boolean {
  if (!PARTICIPATION_MODES.has(current) || !PARTICIPATION_MODES.has(next)) {
    return false;
  }
  if (current === next) return true;
  if (next === 'automatic') {
    return context.approvedPlan === true && context.applicablePolicy === true;
  }
  return true;
}
