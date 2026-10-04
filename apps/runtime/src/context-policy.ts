/** Native policy. External kernels own their own context maintenance. */
export const CONTEXT_COMPACT_THRESHOLD = 0.85;
export const CONTEXT_RETAIN_RATIO = 0.16;
export interface ContextBudget {
  contextWindow: number;
  reservedOutputTokens: number;
  safetyMarginTokens: number;
  fixedInputTokens: number;
  availableInputTokens: number;
  availableHistoryTokens: number;
  compactTriggerTokens: number;
  retainedTailTokens: number;
}
export function resolveContextBudget(input: {
  contextWindow: number;
  reservedOutputTokens?: number;
  modelMaxOutputTokens?: number;
  safetyMarginTokens?: number;
  fixedInputTokens?: number;
}): ContextBudget {
  const w = Math.floor(input.contextWindow);
  if (!Number.isSafeInteger(w) || w <= 0) throw new Error('上下文容量配置无效。');
  const integer = (value: number) => {
    if (!Number.isFinite(value) || value < 0) throw new Error('上下文预留配置无效。');
    return Math.ceil(value);
  };
  const maxOutput =
    input.modelMaxOutputTokens === undefined ? Infinity : integer(input.modelMaxOutputTokens);
  if (maxOutput === 0) throw new Error('模型输出上限配置无效。');
  const o = Math.min(
    maxOutput,
    integer(input.reservedOutputTokens ?? Math.min(8192, Math.max(256, Math.floor(w * 0.06)))),
  );
  const s = integer(
    input.safetyMarginTokens ?? Math.min(8192, Math.max(256, Math.floor(w * 0.03))),
  );
  const f = integer(input.fixedInputTokens ?? 0);
  const availableInputTokens = Math.max(0, w - o - s);
  const availableHistoryTokens = Math.max(0, availableInputTokens - f);
  return {
    contextWindow: w,
    reservedOutputTokens: o,
    safetyMarginTokens: s,
    fixedInputTokens: f,
    availableInputTokens,
    availableHistoryTokens,
    compactTriggerTokens: Math.max(
      0,
      Math.floor(Math.min(w * CONTEXT_COMPACT_THRESHOLD, w - o - s)),
    ),
    retainedTailTokens: Math.min(
      availableHistoryTokens,
      Math.max(0, Math.floor((w - o) * CONTEXT_RETAIN_RATIO)),
    ),
  };
}

/** Provider metadata is optional; malformed/nonpositive suggestions never become a request cap. */
export function parseModelOutputLimit(limitsJson: string | undefined): number | undefined {
  try {
    const value: unknown = limitsJson ? JSON.parse(limitsJson)?.maxOutputTokens : undefined;
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}
