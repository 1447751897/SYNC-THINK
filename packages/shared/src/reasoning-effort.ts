/** Product reasoning levels shared by agent tools and every model/agent editor. */
export const REASONING_EFFORT_LEVELS = [
  'auto',
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORT_LEVELS)[number];

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && REASONING_EFFORT_LEVELS.some(level => level === value);
}
