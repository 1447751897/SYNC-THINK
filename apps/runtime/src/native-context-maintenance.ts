import { createHash } from 'node:crypto';
import {
  foldLongToolOutputsInMessages,
  isStructuredCompactSummary,
  wrapModelCompactSummary,
} from './chat-tools.js';
import type { AdapterEvent, ProviderMessage, ProviderToolSchema } from '@sync-think/adapters';
import {
  estimateProviderMessageTokens,
  estimateTextTokens,
  measureContextRequest,
  type ContextUsageAnchor,
} from './context-token-meter.js';
import { resolveContextBudget, type ContextBudget } from './context-policy.js';

export interface NativeContextRequest {
  systemPrompt: string;
  messages: ProviderMessage[];
  tools?: ProviderToolSchema[];
}
export interface NativeContextCheckpoint {
  bindingKey: string;
  sourceMessageCount: number;
  sourcePrefixFingerprint: string;
  summary: string;
}
export class NativeContextBudgetError extends Error {
  readonly failureClass = 'protocol' as const;
  constructor(
    readonly budget: ContextBudget,
    readonly estimatedUsedTokens: number,
  ) {
    super(
      '上下文输入预算不足：输入 ' +
        estimatedUsedTokens +
        '，可用 ' +
        budget.availableInputTokens +
        '，固定成本 ' +
        budget.fixedInputTokens +
        '，输出预留 ' +
        budget.reservedOutputTokens +
        '。原始记录已保留，请减少加载的工具/附件、调整输出上限或使用更大窗口。',
    );
    this.name = 'NativeContextBudgetError';
  }
}
export async function prepareNativeContextRequest(input: {
  request: NativeContextRequest;
  contextWindow: number;
  reservedOutputTokens?: number;
  modelMaxOutputTokens?: number;
  meterBindingKey?: string;
  usageAnchor?: ContextUsageAnchor;
  safetyMarginTokens?: number;
  bindingKey: string;
  checkpoint?: NativeContextCheckpoint;
  signal?: AbortSignal;
  maintenanceDisabled?: boolean;
  forceCompaction?: boolean;
  summarize: (
    request: NativeContextRequest,
    maxOutputTokens: number,
  ) => Promise<string | undefined>;
}): Promise<{
  request: NativeContextRequest;
  budget: ContextBudget;
  estimatedUsedTokens: number;
  compacted: boolean;
  prunedCount: number;
  checkpoint?: NativeContextCheckpoint;
  warning?: string;
}> {
  const measured = measureContextRequest(
    input.request,
    input.meterBindingKey ?? input.bindingKey,
    input.usageAnchor,
  );
  let budget = resolveContextBudget({ ...input, fixedInputTokens: measured.fixedInputTokens });
  let fixedInputTokens = budget.fixedInputTokens;
  const source = input.request.messages;
  const fingerprint = (count: number) =>
    createHash('sha256')
      .update(input.bindingKey)
      .update(JSON.stringify(source.slice(0, count)))
      .digest('hex');
  const anchoredPrefix = (count: number, summary: string): ProviderMessage[] => {
    const latestUser = source.map((message) => message.role).lastIndexOf('user');
    // If the active request lies inside the compressed prefix (long tool loop),
    // retain its exact raw message independently of the summarized tool span.
    return [
      { role: 'user', content: summary },
      ...(latestUser >= 0 && latestUser < count ? [structuredClone(source[latestUser]!)] : []),
    ];
  };
  let checkpoint: NativeContextCheckpoint | undefined;
  let messages = structuredClone(source);
  const previous = input.checkpoint;
  if (
    previous &&
    previous.bindingKey === input.bindingKey &&
    Number.isSafeInteger(previous.sourceMessageCount) &&
    previous.sourceMessageCount > 0 &&
    previous.sourceMessageCount <= source.length &&
    fingerprint(previous.sourceMessageCount) === previous.sourcePrefixFingerprint
  ) {
    checkpoint = structuredClone(previous);
    messages = [
      ...anchoredPrefix(previous.sourceMessageCount, previous.summary),
      ...messages.slice(previous.sourceMessageCount),
    ];
  }
  const price = (values: readonly ProviderMessage[]) => {
    const current = measureContextRequest(
      { ...input.request, messages: values },
      input.meterBindingKey ?? input.bindingKey,
      input.usageAnchor,
    );
    fixedInputTokens = current.fixedInputTokens;
    budget = resolveContextBudget({ ...input, fixedInputTokens });
    return current.usedTokens;
  };
  let used = price(messages);
  if (
    fixedInputTokens > budget.availableInputTokens ||
    budget.reservedOutputTokens + budget.safetyMarginTokens >= budget.contextWindow
  ) {
    throw new NativeContextBudgetError(budget, used);
  }
  let prunedCount = 0;
  let compacted = false;
  let warning: string | undefined;
  if (
    !input.maintenanceDisabled &&
    (input.forceCompaction || used >= budget.compactTriggerTokens)
  ) {
    const pruned = foldLongToolOutputsInMessages(messages, {
      maxChars: 5120,
      keepRecent: 2,
      preserveBoundedSourcePages: true,
    });
    messages = pruned.messages;
    prunedCount = pruned.foldedCount;
    used = price(messages);
  }
  let forced = input.forceCompaction === true;
  for (
    let attempt = 0;
    !input.maintenanceDisabled && (forced || used >= budget.compactTriggerTokens) && attempt < 2;
    attempt++
  ) {
    forced = false;
    if (input.signal?.aborted) throw input.signal.reason ?? new Error('上下文整理已取消。');
    const start = retainedTailStart(messages, budget.retainedTailTokens);
    if (start <= 0) break;
    const previousCount = checkpoint?.sourceMessageCount ?? 0;
    const prefixSize = checkpoint ? anchoredPrefix(previousCount, checkpoint.summary).length : 0;
    const count = previousCount ? previousCount + start - prefixSize : start;
    if (count <= previousCount) break;
    const expected = fingerprint(count);
    let summary: string | undefined;
    try {
      summary = await input.summarize(
        { ...input.request, messages: structuredClone(messages.slice(0, start)) },
        Math.min(8192, Math.max(256, Math.floor(input.contextWindow * 0.04))),
      );
    } catch (error) {
      if (input.signal?.aborted) throw error;
      warning = '摘要生成失败，原始上下文仍保留。';
      break;
    }
    if (input.signal?.aborted) throw input.signal.reason ?? new Error('上下文整理已取消。');
    if (fingerprint(count) !== expected)
      throw new Error('摘要期间所选消息已变化，原始记录已保留，请重试。');
    const wrapped =
      summary && isStructuredCompactSummary(summary) ? wrapModelCompactSummary(summary) : '';
    if (!wrapped) {
      warning = '摘要保留契约未通过，原始上下文仍保留。';
      break;
    }
    const next: ProviderMessage[] = [...anchoredPrefix(count, wrapped), ...messages.slice(start)];
    const after = price(next);
    if (after >= used * 0.9) {
      warning = '摘要未显著缩小上下文，原始上下文仍保留。';
      break;
    }
    messages = next;
    checkpoint = {
      bindingKey: input.bindingKey,
      sourceMessageCount: count,
      sourcePrefixFingerprint: expected,
      summary: wrapped,
    };
    compacted = true;
    used = after;
  }
  if (used > budget.availableInputTokens) throw new NativeContextBudgetError(budget, used);
  return {
    request: { ...input.request, messages },
    budget,
    estimatedUsedTokens: used,
    compacted,
    prunedCount,
    ...(checkpoint ? { checkpoint } : {}),
    ...(warning ? { warning } : {}),
  };
}

/** Select a recent raw tail without splitting tool-use/result pairs or a recent user turn. */
export function retainedTailStart(
  messages: readonly ProviderMessage[],
  retainTokens: number,
): number {
  let start = messages.length;
  let tokens = 0;
  while (start > 0 && (tokens < retainTokens || start === messages.length)) {
    tokens += estimateProviderMessageTokens(messages[--start]!);
  }
  const pending = new Set<string>();
  const balanced = new Set<number>([0]);
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!;
    if (Array.isArray(message.content)) {
      for (const part of message.content)
        if (part.type === 'tool-call' && part.toolCall) pending.add(part.toolCall.id);
    }
    if (message.role === 'tool' && message.toolCallId) pending.delete(message.toolCallId);
    if (pending.size === 0) balanced.add(index + 1);
  }
  // Protect complete chat turns when there is no tool chain at the cut.
  const first = messages[start];
  if (
    first?.role === 'assistant' &&
    !(Array.isArray(first.content) && first.content.some((part) => part.type === 'tool-call'))
  ) {
    for (let index = start - 1; index >= 0; index--) {
      if (messages[index]?.role === 'user') {
        start = index;
        break;
      }
    }
  }
  while (start > 0 && !balanced.has(start)) start--;
  return start;
}

/** Recover only explicit capacity failures before any user-visible work has escaped. */
export async function* streamWithContextOverflowRecovery(input: {
  request: NativeContextRequest;
  signal?: AbortSignal;
  call: (request: NativeContextRequest) => AsyncIterable<AdapterEvent>;
  recover: (request: NativeContextRequest) => Promise<NativeContextRequest | undefined>;
}): AsyncIterable<AdapterEvent> {
  let request = input.request;
  let visible = false;
  const price = (value: NativeContextRequest) =>
    estimateTextTokens(value.systemPrompt) +
    (value.tools?.length ? estimateTextTokens(JSON.stringify(value.tools)) : 0) +
    value.messages.reduce((sum, message) => sum + estimateProviderMessageTokens(message), 0);
  for (let attempt = 0; attempt < 2; attempt++) {
    let retry: NativeContextRequest | undefined;
    for await (const event of input.call(request)) {
      if (input.signal?.aborted) return;
      if (
        event.type === 'error' &&
        attempt === 0 &&
        !visible &&
        /context_length_exceeded|context_window_exceeded|maximum context length|prompt is too long|input.{0,20}exceeds.{0,30}context|上下文.{0,10}(?:超出|超限)/i.test(
          event.message,
        )
      ) {
        try {
          retry = await input.recover(request);
        } catch {
          /* Preserve the original capacity error. */
        }
        if (input.signal?.aborted) return;
        if (retry && price(retry) < price(request)) break;
        retry = undefined;
      }
      if (
        event.type === 'text-delta' ||
        event.type === 'assistant-message-delta' ||
        event.type === 'reasoning-delta' ||
        event.type === 'tool-call' ||
        event.type === 'hosted-tool-call' ||
        event.type === 'image-ready'
      )
        visible = true;
      yield event;
      if (event.type === 'error' || event.type === 'finished') return;
    }
    if (!retry) return;
    request = retry;
  }
}
