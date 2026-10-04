import { REASONING_EFFORT_LEVELS, type ReasoningEffort } from '@sync-think/shared';

export const REASONING_LABELS: Record<ReasoningEffort, string> = {
  auto: '自动',
  off: '关闭',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '最高',
};

/** Show the full product ladder; the selected provider decides which values it supports. */
export const REASONING_OPTIONS = REASONING_EFFORT_LEVELS.map(value => ({
  value,
  title: REASONING_LABELS[value],
}));
