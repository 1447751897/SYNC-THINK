import type { ReasoningEffort } from './compose-toolbar.js';

const REASONING_VALUES = new Set<ReasoningEffort>([
  'auto',
  'off',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

export interface ComposerPlanActSetting {
  enabled: boolean;
  planModelId: string | null;
  actModelId: string | null;
  planReasoningEffort: ReasoningEffort | null;
  actReasoningEffort: ReasoningEffort | null;
}

function modelId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function reasoning(value: unknown): ReasoningEffort | null {
  return typeof value === 'string' && REASONING_VALUES.has(value as ReasoningEffort)
    ? (value as ReasoningEffort)
    : null;
}

export function parseComposerPlanActSetting(raw: unknown): ComposerPlanActSetting | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  return {
    enabled: value.enabled === true,
    planModelId: modelId(value.planModelId),
    actModelId: modelId(value.actModelId),
    planReasoningEffort: reasoning(value.planReasoningEffort),
    actReasoningEffort: reasoning(value.actReasoningEffort),
  };
}

export function resolveComposerModelSelection({
  planMode,
  setting,
  currentModelId,
  currentReasoningEffort,
}: {
  planMode: boolean;
  setting: ComposerPlanActSetting | null;
  currentModelId: string;
  currentReasoningEffort: ReasoningEffort;
}): { modelId: string; reasoningEffort: ReasoningEffort; routed: boolean } {
  const routed = Boolean(planMode && setting?.enabled && setting.planModelId);
  return {
    modelId: routed ? setting!.planModelId! : currentModelId,
    reasoningEffort:
      routed && setting?.planReasoningEffort
        ? setting.planReasoningEffort
        : currentReasoningEffort,
    routed,
  };
}
