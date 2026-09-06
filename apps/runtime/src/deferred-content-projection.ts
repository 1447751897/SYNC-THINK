import { publicEventPayload, parseDeferredContent } from '@sync-think/shared';
import {
  CONTENT_PREVIEW_LENGTH,
  type ContentPath,
  type ContentReference,
  type DeferredContent,
  type Event,
  type Message,
  type MessageBlock,
  type RunId,
} from '@sync-think/shared';
import type { AssistantTurnSegment, ConversationTransientSnapshot } from '@sync-think/protocol';

const OMITTED = '\n[预览；完整内容按需读取]';
const RESULT_SUMMARY_LENGTH = 1200;
const RESULT_SUMMARY_ENTRIES = 20;
const PREVIEW_PRIORITY_KEYS = [
  'threadId',
  'toolCallId',
  'callId',
  'toolName',
  'name',
  'kernelId',
  'runId',
  'requestId',
  'approvalId',
  'modelId',
  'providerModelId',
  'ok',
  'success',
  'isError',
  'exitCode',
  'result',
  'status',
  'error',
  'errorMessage',
  'count',
  'total',
  'created',
  'isNew',
  'path',
  'filePath',
  'bytes',
  'size',
  'argumentsRef',
  'resultRef',
  'resultEntryCount',
  'output',
  'run',
];

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function shortString(text: string, budget: { remaining: number }): string {
  const length = Math.max(0, Math.min(text.length, budget.remaining));
  budget.remaining -= length;
  if (length === text.length) return text;
  let end = length;
  const previous = text.charCodeAt(end - 1);
  if (previous >= 0xd800 && previous <= 0xdbff) end -= 1;
  return text.slice(0, Math.max(0, end)) + OMITTED;
}

function previewValue(value: unknown, budget: { remaining: number }, depth = 0): unknown {
  if (typeof value === 'string') return shortString(value, budget);
  if (value === null || typeof value !== 'object') {
    budget.remaining -= String(value).length + 1;
    return value;
  }
  if (depth >= 6 || budget.remaining <= 0) return '[详情按需读取]';
  if (Array.isArray(value)) {
    const selected = value.slice(0, 16).map((entry) => previewValue(entry, budget, depth + 1));
    if (value.length > selected.length)
      selected.push(`[另有 ${value.length - selected.length} 项；完整内容按需读取]`);
    return selected;
  }
  const entries = Object.entries(value);
  const fields = value as Record<string, unknown>;
  const preferred = PREVIEW_PRIORITY_KEYS.flatMap((key): Array<[string, unknown]> =>
    Object.prototype.hasOwnProperty.call(fields, key) ? [[key, fields[key]]] : [],
  );
  const preferredKeys = new Set(preferred.map(([key]) => key));
  const scalar = entries.filter(
    ([key, entry]) =>
      !preferredKeys.has(key) &&
      (entry === null ||
        typeof entry === 'boolean' ||
        typeof entry === 'number' ||
        (typeof entry === 'string' && entry.length < 256)),
  );
  const prioritized = [...preferred, ...scalar].slice(0, 32);
  const retained = new Set(prioritized.map(([key]) => key));
  const selected = [
    ...prioritized,
    ...entries.filter(([key]) => !retained.has(key)).slice(0, 32 - retained.size),
  ];
  const projected: Array<[string, unknown]> = [];
  for (const [key, entry] of selected) {
    if (budget.remaining <= 0) break;
    budget.remaining -= Math.min(key.length, 128) + 4;
    projected.push([
      key.length > 128 ? key.slice(0, 128) + '…' : key,
      previewValue(entry, budget, depth + 1),
    ]);
  }
  return Object.fromEntries(projected);
}

export function describeDeferredContent(
  value: unknown,
  reference: ContentReference,
): DeferredContent {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return {
    reference,
    utf8Bytes: Buffer.byteLength(text),
    utf16Length: text.length,
    format: typeof value === 'string' ? 'text' : 'json',
  };
}

function defer(
  value: unknown,
  reference: ContentReference,
): { value: unknown; deferred?: DeferredContent } {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  let structured = value;
  if (typeof value === 'string' && ['{', '['].includes(value.trimStart().charAt(0))) {
    try {
      structured = JSON.parse(value);
    } catch {}
  }
  const entries = record(structured)
    ? [structured.entries, structured.items, structured.files].find(Array.isArray)
    : structured;
  if (
    typeof text !== 'string' ||
    (text.length <= RESULT_SUMMARY_LENGTH &&
      text.split('\n').length <= 30 &&
      !(Array.isArray(entries) && entries.length > RESULT_SUMMARY_ENTRIES))
  )
    return { value };
  const deferred: DeferredContent = {
    reference,
    utf8Bytes: Buffer.byteLength(text),
    utf16Length: text.length,
    format: typeof value === 'string' ? 'text' : 'json',
  };
  if (typeof value !== 'string')
    return { value: previewValue(value, { remaining: CONTENT_PREVIEW_LENGTH }), deferred };
  if (structured !== value)
    return {
      value: JSON.stringify(
        previewValue(structured, { remaining: CONTENT_PREVIEW_LENGTH }),
        null,
        2,
      ),
      deferred,
    };
  return { value: shortString(value, { remaining: CONTENT_PREVIEW_LENGTH }), deferred };
}

export function projectProseText(
  text: string,
  reference: ContentReference,
  existing?: unknown,
  attachOnly = false,
): { text: string; contentRef?: DeferredContent } {
  const retained = parseDeferredContent(existing);
  if (!retained && text.length <= 8192 && text.split('\n').length <= 160) return { text };
  return {
    text: attachOnly ? text : shortString(text, { remaining: 4096 }),
    contentRef: retained ?? describeDeferredContent(text, reference),
  };
}

function projectSegment(
  segment: AssistantTurnSegment,
  reference: (path: ContentPath) => ContentReference,
  attachOnly = false,
): AssistantTurnSegment {
  if (!segment || typeof segment !== 'object') return segment;
  if (
    (segment.kind === 'text' || segment.kind === 'thinking') &&
    typeof segment.text === 'string'
  ) {
    const projected = projectProseText(
      segment.text,
      reference(['text']),
      segment.textRef,
      attachOnly,
    );
    return {
      ...segment,
      text: projected.text,
      ...(projected.contentRef ? { textRef: projected.contentRef } : {}),
    };
  }
  if (segment.kind !== 'tool') return segment;
  const result = { ...segment };
  for (const [field, refField] of [
    ['argumentsJson', 'argumentsRef'],
    ['output', 'outputRef'],
  ] as const) {
    const value = segment[field];
    if (value === undefined) continue;
    const projected = defer(value, reference([field]));
    if (projected.deferred) {
      if (!attachOnly) result[field] = String(projected.value);
      result[refField] = segment[refField] ?? projected.deferred;
    }
  }
  return result;
}

type ToolSegment = Extract<AssistantTurnSegment, { kind: 'tool' }>;
const timelinePreviews = new WeakMap<
  ToolSegment,
  { runId: RunId; id: string; argumentsJson?: string; output?: string; projected: ToolSegment }
>();

export function projectTimelineContent(
  segments: readonly AssistantTurnSegment[],
  runId: RunId,
  attachOnly = false,
): AssistantTurnSegment[] {
  return segments.map((segment) => {
    if (!segment || segment.kind !== 'tool') {
      return projectSegment(
        segment,
        (path) => ({ source: 'timeline', id: segment?.id, runId, path }),
        attachOnly,
      );
    }
    if (attachOnly)
      return projectSegment(
        segment,
        (path) => ({ source: 'timeline', id: segment.id, runId, path }),
        true,
      );
    let cached = timelinePreviews.get(segment);
    if (
      !cached ||
      cached.runId !== runId ||
      cached.id !== segment.id ||
      cached.argumentsJson !== segment.argumentsJson ||
      cached.output !== segment.output
    ) {
      const projected = projectSegment(segment, (path) => ({
        source: 'timeline',
        id: segment.id,
        runId,
        path,
      })) as ToolSegment;
      cached = {
        runId,
        id: segment.id,
        argumentsJson: segment.argumentsJson,
        output: segment.output,
        projected,
      };
      timelinePreviews.set(segment, cached);
    }
    return {
      ...segment,
      argumentsJson: cached.projected.argumentsJson,
      output: cached.projected.output,
      argumentsRef: segment.argumentsRef ?? cached.projected.argumentsRef,
      outputRef: segment.outputRef ?? cached.projected.outputRef,
    };
  });
}

export function projectMessageContent(message: Message): Message {
  const blocks = message.blocks.map((storedBlock, index): MessageBlock => {
    let block = storedBlock;
    const base = ['blocks', index] as ContentPath;
    const reference = (path: ContentPath): ContentReference => ({
      source: 'message',
      id: message.id,
      path: [...base, ...path],
    });
    if (['text', 'code', 'commentary', 'reasoning', 'error'].includes(block.type)) {
      const field =
        block.type === 'reasoning' && typeof block.reasoningText === 'string'
          ? 'reasoningText'
          : 'text';
      const text = block[field];
      if (typeof text === 'string') {
        const retained =
          block.contentRef ?? (record(block.payload) ? block.payload.contentRef : undefined);
        const projected = projectProseText(text, reference([field]), retained);
        if (projected.contentRef)
          block = { ...block, [field]: projected.text, contentRef: projected.contentRef };
      }
    }
    if (block.type === 'tool-result') {
      const value = block.text ?? block.payload;
      if (value === undefined) return block;
      const field = block.text === undefined ? 'payload' : 'text';
      const result = defer(value, reference([field]));
      if (!result.deferred) return block;
      return {
        ...block,
        text:
          typeof result.value === 'string' ? result.value : JSON.stringify(result.value, null, 2),
        payload:
          field === 'payload'
            ? undefined
            : previewValue(block.payload, { remaining: CONTENT_PREVIEW_LENGTH }),
        contentRef: block.contentRef ?? result.deferred,
      };
    }
    if (!record(block.payload)) return block;
    if (block.type === 'tool-call' && typeof block.payload.argumentsJson === 'string') {
      const result = defer(block.payload.argumentsJson, reference(['payload', 'argumentsJson']));
      return result.deferred
        ? {
            ...block,
            payload: {
              ...block.payload,
              argumentsJson: result.value,
              argumentsRef: block.payload.argumentsRef ?? result.deferred,
            },
          }
        : block;
    }
    if (Array.isArray(block.payload.assistantTimeline)) {
      return {
        ...block,
        payload: {
          ...block.payload,
          assistantTimeline: block.payload.assistantTimeline.map((segment, segmentIndex) =>
            projectSegment(segment as AssistantTurnSegment, (path) =>
              reference(['payload', 'assistantTimeline', segmentIndex, ...path]),
            ),
          ),
        },
      };
    }
    return block;
  });
  return { ...message, blocks };
}

export function projectEventContent(event: Event): Event {
  const payload = publicEventPayload(event.payload);
  const primaryResult =
    payload.result !== undefined && payload.result !== null
      ? 'result'
      : payload.output !== undefined && payload.output !== null
        ? 'output'
        : 'error';
  for (const field of ['result', 'output', 'error', 'previousContent'] as const) {
    if (payload[field] === undefined) continue;
    const result = defer(payload[field], { source: 'event', id: event.id, path: [field] });
    if (!result.deferred) continue;
    if (field === 'previousContent') payload.previousContentRef = result.deferred;
    if (field === primaryResult) {
      let full = payload[field];
      if (typeof full === 'string') {
        try {
          full = JSON.parse(full);
        } catch {}
      }
      const entries = record(full)
        ? [full.entries, full.items, full.files].find(Array.isArray)
        : full;
      if (Array.isArray(entries))
        payload.resultEntryCount =
          record(full) && typeof full.count === 'number'
            ? full.count
            : record(full) && typeof full.total === 'number'
              ? full.total
              : entries.length;
      payload.resultRef ??= result.deferred;
    }
    payload[field] = result.value;
  }
  const toolCall = record(payload.toolCall) ? payload.toolCall : undefined;
  const argumentsCandidates: Array<{ value: unknown; path: ContentPath }> = [
    { value: payload.arguments, path: ['arguments'] },
    { value: payload.args, path: ['args'] },
    { value: toolCall?.arguments, path: ['toolCall', 'arguments'] },
    { value: toolCall?.argumentsJson, path: ['toolCall', 'argumentsJson'] },
    { value: payload.argumentsJson, path: ['argumentsJson'] },
  ];
  const preferred =
    argumentsCandidates.find((candidate) => {
      if (candidate.path.at(-1) !== 'argumentsJson') return record(candidate.value);
      if (typeof candidate.value !== 'string') return false;
      try {
        return record(JSON.parse(candidate.value));
      } catch {
        return false;
      }
    }) ?? argumentsCandidates.find((candidate) => candidate.value !== undefined);
  for (const candidate of argumentsCandidates) {
    if (candidate.value === undefined) continue;
    const projected = defer(candidate.value, {
      source: 'event',
      id: event.id,
      path: candidate.path,
    });
    if (!projected.deferred) continue;
    if (candidate.path[0] === 'toolCall')
      payload.toolCall = {
        ...(record(payload.toolCall) ? payload.toolCall : toolCall),
        [String(candidate.path[1])]: projected.value,
      };
    else payload[String(candidate.path[0])] = projected.value;
    if (preferred === candidate) payload.argumentsRef ??= projected.deferred;
  }
  if (Buffer.byteLength(JSON.stringify(payload)) <= 48 * 1024) return { ...event, payload };
  const displayPayloadRef =
    event.displayPayloadRef ??
    describeDeferredContent(publicEventPayload(event.payload), {
      source: 'event-display',
      id: event.id,
      path: ['payload'],
    });
  const boundedPayload = (remaining: number) => {
    const preview = previewValue(payload, { remaining }) as Record<string, unknown>;
    for (const field of ['argumentsRef', 'resultRef']) {
      const reference = parseDeferredContent(payload[field]);
      if (reference) preview[field] = reference;
    }
    return preview;
  };
  let previewBudget = 8192;
  let preview = boundedPayload(previewBudget);
  while (Buffer.byteLength(JSON.stringify(preview)) > 48 * 1024 && previewBudget > 128) {
    previewBudget = Math.floor(previewBudget / 2);
    preview = boundedPayload(previewBudget);
  }
  return { ...event, payload: preview, displayPayloadRef };
}

export function projectTransientProseSnapshot(
  snapshot: ConversationTransientSnapshot,
): ConversationTransientSnapshot {
  if (
    !snapshot.assistantTimeline?.some(
      (segment) => (segment.kind === 'text' || segment.kind === 'thinking') && segment.textRef,
    )
  )
    return snapshot;
  const projected = {
    ...snapshot,
    text: shortString(snapshot.text, { remaining: 4096 }),
    assistantTimeline: projectTimelineContent(snapshot.assistantTimeline, snapshot.runId),
  };
  if (projected.commentaryText)
    projected.commentaryText = shortString(projected.commentaryText, { remaining: 4096 });
  if (projected.reasoningText)
    projected.reasoningText = shortString(projected.reasoningText, { remaining: 4096 });
  delete projected.commentarySegments;
  delete projected.reasoningSegments;
  return projected;
}
