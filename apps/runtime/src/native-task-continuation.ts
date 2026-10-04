import { createHash } from 'node:crypto';

/** Per-task progress, not a cap on productive rounds. Persisted with the run. */
export interface NativeTaskContinuationState {
  rounds: number;
  stagnantRounds: number;
  fingerprints: string[];
  outputTokens?: number;
  fallbackOutputTokens?: number;
  outputIncreaseRejected?: boolean;
  instruction: string;
}
export const NATIVE_CONTINUATION_STAGNANT_LIMIT = 3;

/** Root chats may continue while progressing; assigned workers and explicit goals keep their quotas. */
export function isProgressBoundedNativeTask(input: {
  delegated: boolean;
  explicitlyBudgeted: boolean;
  collaborationScoped: boolean;
  scheduled: boolean;
}): boolean {
  return !input.delegated && !input.explicitlyBudgeted &&
    (input.scheduled || !input.collaborationScoped);
}

export function parseNativeTaskContinuation(
  value: unknown,
): NativeTaskContinuationState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const state = value as NativeTaskContinuationState;
  if (
    !Number.isSafeInteger(state.rounds) ||
    state.rounds < 0 ||
    !Number.isSafeInteger(state.stagnantRounds) ||
    state.stagnantRounds < 0 ||
    !Array.isArray(state.fingerprints) ||
    typeof state.instruction !== 'string'
  )
    return undefined;
  return {
    rounds: state.rounds,
    stagnantRounds: state.stagnantRounds,
    fingerprints: state.fingerprints
      .filter((item) => typeof item === 'string' && /^[a-f0-9]{64}$/.test(item))
      .slice(-128),
    instruction: state.instruction.slice(0, 4000),
    outputIncreaseRejected: state.outputIncreaseRejected === true,
    ...(Number.isSafeInteger(state.fallbackOutputTokens) && Number(state.fallbackOutputTokens) > 0
      ? { fallbackOutputTokens: state.fallbackOutputTokens }
      : {}),
    ...(Number.isSafeInteger(state.outputTokens) && Number(state.outputTokens) > 0
      ? { outputTokens: state.outputTokens }
      : {}),
  };
}

export function decideNativeTaskContinuation(input: {
  previous?: NativeTaskContinuationState;
  reason: 'length' | 'acceptance';
  detail?: string;
  /** New visible output for length; actual tool/evidence facts for acceptance. */
  progress: string;
  currentOutputTokens: number;
  contextWindow: number;
  modelMaxOutputTokens?: number;
}): { state: NativeTaskContinuationState; blocked: boolean; message: string } {
  const previous = input.previous;
  const fingerprints = new Set(previous?.fingerprints ?? []);
  const fingerprint = input.progress.trim()
    ? createHash('sha256').update(input.progress.trim()).digest('hex')
    : undefined;
  const advanced = Boolean(fingerprint && !fingerprints.has(fingerprint));
  if (fingerprint) fingerprints.add(fingerprint);
  const stagnantRounds = advanced ? 0 : (previous?.stagnantRounds ?? 0) + 1;
  const detail =
    input.reason === 'length'
      ? '单轮模型输出达到长度上限，任务尚未完成'
      : '交付验收尚未通过：' + input.detail;
  const message =
    stagnantRounds >= NATIVE_CONTINUATION_STAGNANT_LIMIT
      ? detail +
        '。连续多轮续接没有新增进展，已停止自动空转；已有结果和工具记录已保留，请检查模型、任务约束或权限后继续。'
      : detail + '，保留已有进度并继续执行。';
  const instruction =
    '[宿主任务续接]\n' +
    detail +
    '。这不是新任务，不要重头开始。' +
    '沿用原任务目标、日期范围、工作区、执行权限和冻结的交付要求。' +
    '依据已有工具结果完成剩余工作，优先交付真实产物并验证；不要重复已完成的写入、发送或提交操作。' +
    '单轮长度上限不等于任务完成。遇到缺少权限、登录、用户确认或持续错误时明确报告具体阻塞，不要谎报完成。';
  const outputTokens =
    input.reason === 'length' && !previous?.outputIncreaseRejected
      ? Math.max(
          1,
          Math.min(
            Math.max(input.currentOutputTokens, previous?.outputTokens ?? 0) * 2,
            input.modelMaxOutputTokens ?? 32_768,
            Math.max(1, Math.floor(input.contextWindow / 4)),
          ),
        )
      : previous?.outputTokens;
  return {
    blocked: stagnantRounds >= NATIVE_CONTINUATION_STAGNANT_LIMIT,
    message,
    state: {
      rounds: (previous?.rounds ?? 0) + 1,
      stagnantRounds,
      fingerprints: [...fingerprints].slice(-128),
      instruction,
      outputIncreaseRejected: previous?.outputIncreaseRejected === true,
      fallbackOutputTokens: input.currentOutputTokens,
      ...(outputTokens ? { outputTokens } : {}),
    },
  };
}

/** A gateway may advertise no output metadata yet reject an increased reserve. Retry once at the previously accepted size. */
export function recoverRejectedOutputReserve(
  state: NativeTaskContinuationState | undefined,
  message: string,
): NativeTaskContinuationState | undefined {
  if (
    !state ||
    state.outputIncreaseRejected ||
    !state.fallbackOutputTokens ||
    !state.outputTokens ||
    state.outputTokens <= state.fallbackOutputTokens ||
    !/max[_ -]?(tokens|completion[_ -]?tokens|output[_ -]?tokens)/i.test(message)
  )
    return undefined;
  return { ...state, outputTokens: state.fallbackOutputTokens, outputIncreaseRejected: true };
}
