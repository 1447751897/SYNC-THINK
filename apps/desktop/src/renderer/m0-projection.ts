import type { Event } from '@sync-think/shared';
import type { TraceItem } from '@sync-think/ui-kit';
import { mergeEventHistory } from '../event-history.js';

export type StreamState = 'idle' | 'streaming' | 'completed' | 'failed' | 'cancelled' | 'paused';

export interface ConversationImage {
  id: string;
  name: string;
  mimeType?: string;
  storageRef: string;
}

export type SystemMessageTone = 'info' | 'success' | 'warning' | 'error';

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  /** Durable image attachments resolved by the Desktop custom protocol. */
  images?: ConversationImage[];
  /** Extended thinking / reasoning channel (never mixed into text). */
  reasoningText?: string;
  /** Visual tone for system notices (compact success, errors, …). */
  tone?: SystemMessageTone;
  streaming?: boolean;
  runId?: string;
  modelId?: string;
  agentVersionId?: string;
  /** Bound global Agent identity (mutable agent table). */
  globalAgentId?: string;
  globalAgentName?: string;
  occurredAt?: string;
}

export interface StreamStatus {
  state: StreamState;
  runId?: string;
  modelId?: string;
  errorSummary?: string;
  /** Non-fatal observability note (e.g. fallback walk). */
  notice?: string;
}

export interface ManifestSourceView {
  id: string;
  kind: string;
  tokenEstimate?: number;
}

export interface ManifestSummaryView {
  sourceId: string;
  summary: string;
}

export interface ManifestTruncationView {
  sourceId: string;
  reason: string;
  beforeTokens?: number;
  afterTokens?: number;
}

/** User-inspectable Context Manifest projected from context.packet.built (§10.3). */
export interface ManifestView {
  id: string;
  packetId: string;
  proofHash?: string;
  runId?: string;
  modelId?: string;
  providerModelId?: string;
  resolutionSource?: string;
  /** §5.4 credential routing source (ids only, never secrets). */
  credentialResolutionSource?: string;
  credentialRefId?: string;
  agentVersionId?: string;
  agentVersion?: number;
  skillVersionIds?: string[];
  policyId?: string;
  fallbackIndex?: number;
  tokenEstimate?: number;
  includedSourceIds: string[];
  excludedSourceIds: string[];
  included: ManifestSourceView[];
  excluded: ManifestSourceView[];
  summaries: ManifestSummaryView[];
  truncations: ManifestTruncationView[];
  crossTaskRefs: string[];
  evidenceRefsForMemory: string[];
  occurredAt?: string;
}

export interface ConversationProjection {
  messages: ConversationMessage[];
  taskVersion: number;
  stream: StreamStatus;
  trace: TraceItem[];
  /** Inspectable Manifests for every model call in this thread (product §10.3). */
  manifests: ManifestView[];
  /** Most recent Manifest (latest model call). */
  latestManifest?: ManifestView;
  /** @deprecated Prefer `messages`. Kept for gradual migration. */
  userMessages: Array<{ id: string; text: string }>;
  /** @deprecated Prefer `messages` + `stream`. Kept for gradual migration. */
  assistantText: string;
}

/**
 * Projects durable event history into an interleaved conversation for one thread.
 * Multi-turn assistants are retained; in-flight runs show a streaming bubble.
 */
export function projectConversation(
  events: readonly Event[],
  threadId: string,
  taskId?: string,
): ConversationProjection {
  const history = mergeEventHistory([], events);
  const messages: ConversationMessage[] = [];
  let taskVersion = 0;

  // Per-run assistant accumulation for the current thread.
  const runText = new Map<string, string>();
  const runReasoning = new Map<string, string>();
  const runModel = new Map<string, string>();
  const runAgentVersion = new Map<string, string>();
  const runGlobalAgentId = new Map<string, string>();
  const runGlobalAgentName = new Map<string, string>();
  const runTerminal = new Map<string, 'completed' | 'failed' | 'cancelled' | 'paused'>();
  const runOrder: string[] = [];
  /** Maps runId -> message list index of the assistant bubble (if any). */
  const assistantIndexByRun = new Map<string, number>();
  /** Maps runId -> the user message that triggered it (sequence pairing via order). */
  let latestRunId: string | undefined;
  let latestTerminal: StreamState = 'idle';
  let streamError: string | undefined;
  let streamNotice: string | undefined;

  const threadEvents: Event[] = [];

  for (const event of history) {
    const eventThreadId =
      typeof event.payload.threadId === 'string' ? event.payload.threadId : undefined;
    if (eventThreadId !== threadId) continue;
    threadEvents.push(event);

    if (event.type === 'message.appended') {
      if (Number.isInteger(event.payload.taskVersion) && Number(event.payload.taskVersion) >= 0) {
        taskVersion = Number(event.payload.taskVersion);
      }
      if (event.payload.role === 'user' && typeof event.payload.text === 'string') {
        messages.push({
          id:
            typeof event.payload.messageId === 'string'
              ? event.payload.messageId
              : (event.messageId ?? event.id),
          role: 'user',
          text: event.payload.text,
          occurredAt: event.occurredAt,
        });
      } else if (event.payload.role === 'assistant' && typeof event.payload.text === 'string') {
        messages.push({
          id:
            typeof event.payload.messageId === 'string'
              ? event.payload.messageId
              : (event.messageId ?? event.id),
          role: 'assistant',
          text: event.payload.text,
          runId: event.runId,
          occurredAt: event.occurredAt,
        });
      } else if (event.payload.role === 'system' && typeof event.payload.text === 'string') {
        const rawTone =
          typeof event.payload.tone === 'string' ? event.payload.tone : undefined;
        const tone: SystemMessageTone | undefined =
          rawTone === 'info' ||
          rawTone === 'success' ||
          rawTone === 'warning' ||
          rawTone === 'error'
            ? rawTone
            : event.payload.compact === true
              ? 'info'
              : undefined;
        messages.push({
          id:
            typeof event.payload.messageId === 'string'
              ? event.payload.messageId
              : (event.messageId ?? event.id),
          role: 'system',
          text: event.payload.text,
          tone,
          occurredAt: event.occurredAt,
        });
      }
      continue;
    }

    if (event.type === 'message.images-attached') {
      const messageId =
        typeof event.payload.messageId === 'string' ? event.payload.messageId : event.messageId;
      const images = Array.isArray(event.payload.images)
        ? event.payload.images.filter((image): image is ConversationImage =>
            Boolean(
              image &&
              typeof image === 'object' &&
              typeof image.id === 'string' &&
              typeof image.name === 'string' &&
              typeof image.storageRef === 'string',
            ),
          )
        : [];
      if (messageId && images.length > 0) {
        const targetIndex = messages.findIndex((message) => message.id === messageId);
        if (targetIndex >= 0) {
          messages[targetIndex] = { ...messages[targetIndex]!, images };
        }
      }
      continue;
    }

    if (event.type === 'run.started' && event.runId) {
      latestRunId = event.runId;
      runText.set(event.runId, '');
      runReasoning.set(event.runId, '');
      runTerminal.delete(event.runId);
      if (!runOrder.includes(event.runId)) runOrder.push(event.runId);
      if (typeof event.payload.modelId === 'string') {
        runModel.set(event.runId, event.payload.modelId);
      }
      if (typeof event.payload.agentVersionId === 'string') {
        runAgentVersion.set(event.runId, event.payload.agentVersionId);
      }
      if (typeof event.payload.globalAgentId === 'string') {
        runGlobalAgentId.set(event.runId, event.payload.globalAgentId);
      }
      if (typeof event.payload.globalAgentName === 'string') {
        runGlobalAgentName.set(event.runId, event.payload.globalAgentName);
      }
      // Place assistant placeholder after current messages (typically after user turn).
      const index = messages.length;
      messages.push({
        id: `assistant-${event.runId}`,
        role: 'assistant',
        text: '',
        reasoningText: '',
        streaming: true,
        runId: event.runId,
        modelId: runModel.get(event.runId),
        agentVersionId: runAgentVersion.get(event.runId),
        globalAgentId: runGlobalAgentId.get(event.runId),
        globalAgentName: runGlobalAgentName.get(event.runId),
        occurredAt: event.occurredAt,
      });
      assistantIndexByRun.set(event.runId, index);
      latestTerminal = 'streaming';
      streamError = undefined;
      streamNotice = undefined;
      continue;
    }

    if (!event.runId) continue;
    if (!runOrder.includes(event.runId) && !runText.has(event.runId)) {
      // Orphan run events without start: still track for completed text recovery.
      runOrder.push(event.runId);
      runText.set(event.runId, '');
      runReasoning.set(event.runId, '');
    }

    if (event.type === 'message.reasoning_delta' && typeof event.payload.textDelta === 'string') {
      const next =
        typeof event.payload.reasoningText === 'string'
          ? event.payload.reasoningText
          : (runReasoning.get(event.runId) ?? '') + event.payload.textDelta;
      runReasoning.set(event.runId, next);
      const idx = assistantIndexByRun.get(event.runId);
      if (idx !== undefined) {
        messages[idx] = {
          ...messages[idx]!,
          reasoningText: next,
          streaming: !runTerminal.has(event.runId),
        };
      } else {
        const index = messages.length;
        messages.push({
          id: `assistant-${event.runId}`,
          role: 'assistant',
          text: runText.get(event.runId) ?? '',
          reasoningText: next,
          streaming: true,
          runId: event.runId,
          modelId: runModel.get(event.runId),
          agentVersionId: runAgentVersion.get(event.runId),
          globalAgentId: runGlobalAgentId.get(event.runId),
          globalAgentName: runGlobalAgentName.get(event.runId),
          occurredAt: event.occurredAt,
        });
        assistantIndexByRun.set(event.runId, index);
      }
      if (event.runId === latestRunId && !runTerminal.has(event.runId)) {
        latestTerminal = 'streaming';
      }
      continue;
    }

    if (event.type === 'message.delta' && typeof event.payload.textDelta === 'string') {
      const next = (runText.get(event.runId) ?? '') + event.payload.textDelta;
      runText.set(event.runId, next);
      const idx = assistantIndexByRun.get(event.runId);
      if (idx !== undefined) {
        messages[idx] = {
          ...messages[idx]!,
          text: next,
          reasoningText: runReasoning.get(event.runId) ?? messages[idx]!.reasoningText,
          streaming: !runTerminal.has(event.runId),
        };
      } else {
        const index = messages.length;
        messages.push({
          id: `assistant-${event.runId}`,
          role: 'assistant',
          text: next,
          reasoningText: runReasoning.get(event.runId) ?? '',
          streaming: true,
          runId: event.runId,
          modelId: runModel.get(event.runId),
          agentVersionId: runAgentVersion.get(event.runId),
          globalAgentId: runGlobalAgentId.get(event.runId),
          globalAgentName: runGlobalAgentName.get(event.runId),
          occurredAt: event.occurredAt,
        });
        assistantIndexByRun.set(event.runId, index);
      }
      if (event.runId === latestRunId && !runTerminal.has(event.runId)) {
        latestTerminal = 'streaming';
      }
      continue;
    }

    if (event.type === 'run.completed') {
      const finalText =
        typeof event.payload.assistantText === 'string'
          ? event.payload.assistantText
          : (runText.get(event.runId) ?? '');
      const finalReasoning =
        typeof event.payload.reasoningText === 'string'
          ? event.payload.reasoningText
          : (runReasoning.get(event.runId) ?? '');
      runText.set(event.runId, finalText);
      if (finalReasoning) runReasoning.set(event.runId, finalReasoning);
      runTerminal.set(event.runId, 'completed');
      const idx = assistantIndexByRun.get(event.runId);
      if (idx !== undefined) {
        messages[idx] = {
          ...messages[idx]!,
          text: finalText,
          reasoningText: finalReasoning || messages[idx]!.reasoningText,
          streaming: false,
          modelId: runModel.get(event.runId) ?? messages[idx]!.modelId,
          globalAgentId: runGlobalAgentId.get(event.runId) ?? messages[idx]!.globalAgentId,
          globalAgentName: runGlobalAgentName.get(event.runId) ?? messages[idx]!.globalAgentName,
        };
      } else if (finalText) {
        messages.push({
          id: `assistant-${event.runId}`,
          role: 'assistant',
          text: finalText,
          reasoningText: finalReasoning || undefined,
          streaming: false,
          runId: event.runId,
          modelId: runModel.get(event.runId),
          globalAgentId: runGlobalAgentId.get(event.runId),
          globalAgentName: runGlobalAgentName.get(event.runId),
          occurredAt: event.occurredAt,
        });
      }
      if (event.runId === latestRunId) latestTerminal = 'completed';
      continue;
    }

    if (event.type === 'run.failed') {
      const partial = runText.get(event.runId) ?? '';
      runTerminal.set(event.runId, 'failed');
      const failureClass =
        typeof event.payload.failureClass === 'string' ? event.payload.failureClass : 'unknown';
      streamError = `模型调用失败 · ${failureClass}`;
      const idx = assistantIndexByRun.get(event.runId);
      if (idx !== undefined) {
        messages[idx] = {
          ...messages[idx],
          text: partial || messages[idx].text || '（生成中断）',
          streaming: false,
        };
      }
      if (event.runId === latestRunId) latestTerminal = 'failed';
      continue;
    }

    if (event.type === 'run.cancelled') {
      const partial = runText.get(event.runId) ?? '';
      runTerminal.set(event.runId, 'cancelled');
      const idx = assistantIndexByRun.get(event.runId);
      if (idx !== undefined) {
        messages[idx] = {
          ...messages[idx],
          text: partial || '（已取消）',
          streaming: false,
        };
      }
      if (event.runId === latestRunId) latestTerminal = 'cancelled';
      continue;
    }

    if (event.type === 'run.fallback.selected') {
      const toModel =
        typeof event.payload.toModelId === 'string'
          ? event.payload.toModelId
          : typeof event.payload.modelId === 'string'
            ? event.payload.modelId
            : undefined;
      const fromLabel =
        typeof event.payload.fromProviderModelId === 'string'
          ? event.payload.fromProviderModelId
          : typeof event.payload.fromModelId === 'string'
            ? event.payload.fromModelId
            : '上游模型';
      const toLabel =
        typeof event.payload.toProviderModelId === 'string'
          ? event.payload.toProviderModelId
          : (toModel ?? 'fallback');
      const failureClass =
        typeof event.payload.failureClass === 'string' ? event.payload.failureClass : 'unknown';
      if (toModel) {
        runModel.set(event.runId, toModel);
      }
      const idx = assistantIndexByRun.get(event.runId);
      if (idx !== undefined && toModel) {
        messages[idx] = {
          ...messages[idx],
          modelId: toModel,
          streaming: !runTerminal.has(event.runId),
        };
      }
      const notice = `Fallback · ${fromLabel} → ${toLabel} · ${failureClass}`;
      if (event.runId === latestRunId || !latestRunId) {
        streamNotice = notice;
        if (!runTerminal.has(event.runId)) {
          latestTerminal = 'streaming';
        }
      }
      continue;
    }

    if (event.type === 'run.paused') {
      const partial = runText.get(event.runId) ?? '';
      runTerminal.set(event.runId, 'paused');
      const reason = typeof event.payload.reason === 'string' ? event.payload.reason : 'paused';
      const failureClass =
        typeof event.payload.failureClass === 'string' ? event.payload.failureClass : undefined;
      const reasonLabel =
        reason === 'no_fallback_configured'
          ? '无 fallback 配置，已暂停'
          : reason === 'fallback_exhausted'
            ? 'Fallback 链已耗尽，已暂停'
            : `Run 已暂停 · ${reason}`;
      streamError = failureClass ? `${reasonLabel} · ${failureClass}` : reasonLabel;
      const idx = assistantIndexByRun.get(event.runId);
      if (idx !== undefined) {
        messages[idx] = {
          ...messages[idx],
          text: partial || messages[idx].text || '（已暂停，可配置 fallback 后重试）',
          streaming: false,
          modelId: runModel.get(event.runId) ?? messages[idx].modelId,
        };
      }
      if (event.runId === latestRunId) latestTerminal = 'paused';
      continue;
    }
  }

  // Drop empty non-streaming assistant placeholders (edge: started then never delta and not terminal yet keeps streaming).
  const cleaned = messages.filter((message) => {
    if (message.role !== 'assistant') return true;
    if (message.streaming) return true;
    return message.text.trim().length > 0;
  });

  const activeRunId = latestRunId;
  const stream: StreamStatus = {
    state:
      activeRunId && !runTerminal.has(activeRunId)
        ? 'streaming'
        : latestTerminal === 'idle' && cleaned.length === 0
          ? 'idle'
          : latestTerminal === 'idle'
            ? 'idle'
            : latestTerminal,
    runId: activeRunId,
    modelId: activeRunId ? runModel.get(activeRunId) : undefined,
    errorSummary:
      latestTerminal === 'failed' || latestTerminal === 'paused' ? streamError : undefined,
    notice: streamNotice,
  };

  // If latest run is streaming but terminal map empty, force streaming.
  if (activeRunId && !runTerminal.has(activeRunId) && runText.has(activeRunId)) {
    stream.state = 'streaming';
  }
  if (!activeRunId) {
    stream.state = 'idle';
  }

  const userMessages = cleaned
    .filter((message) => message.role === 'user')
    .map((message) => ({ id: message.id, text: message.text }));
  const latestAssistant = [...cleaned].reverse().find((message) => message.role === 'assistant');
  const assistantText = latestAssistant?.text ?? '';

  const traceEvents = selectTraceEvents(history, threadEvents, taskId);
  const manifests = projectManifests(threadEvents);
  return {
    messages: cleaned,
    taskVersion,
    stream,
    trace: projectTrace(traceEvents),
    manifests,
    latestManifest: manifests.length > 0 ? manifests[manifests.length - 1] : undefined,
    userMessages,
    assistantText,
  };
}

/** @deprecated Use projectConversation. */
export function projectM0EventHistory(
  events: readonly Event[],
  threadId: string,
): ConversationProjection {
  return projectConversation(events, threadId);
}

/**
 * Trace selection: prefer the active thread, and always surface provider audit
 * events (they are workspace-global and may not carry threadId).
 */
function selectTraceEvents(
  history: readonly Event[],
  threadEvents: readonly Event[],
  taskId?: string,
): Event[] {
  const selected = new Map<number, Event>();
  for (const event of threadEvents) {
    selected.set(event.sequence, event);
  }
  for (const event of history) {
    const payloadTaskId =
      typeof event.payload.taskId === 'string' ? event.payload.taskId : undefined;
    if (
      event.type === 'provider.created' ||
      event.type === 'provider.models_discovered' ||
      event.type === 'context.packet.built' ||
      (taskId !== undefined && (String(event.taskId ?? '') === taskId || payloadTaskId === taskId))
    ) {
      selected.set(event.sequence, event);
    }
  }
  return [...selected.values()].sort((left, right) => left.sequence - right.sequence);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function asSourceViews(value: unknown): ManifestSourceView[] {
  if (!Array.isArray(value)) return [];
  const out: ManifestSourceView[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.id !== 'string') continue;
    out.push({
      id: rec.id,
      kind: typeof rec.kind === 'string' ? rec.kind : 'unknown',
      tokenEstimate: typeof rec.tokenEstimate === 'number' ? rec.tokenEstimate : undefined,
    });
  }
  return out;
}

function asSummaryViews(value: unknown): ManifestSummaryView[] {
  if (!Array.isArray(value)) return [];
  const out: ManifestSummaryView[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.sourceId !== 'string' || typeof rec.summary !== 'string') continue;
    out.push({ sourceId: rec.sourceId, summary: rec.summary });
  }
  return out;
}

function asTruncationViews(value: unknown): ManifestTruncationView[] {
  if (!Array.isArray(value)) return [];
  const out: ManifestTruncationView[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.sourceId !== 'string') continue;
    out.push({
      sourceId: rec.sourceId,
      reason: typeof rec.reason === 'string' ? rec.reason : 'truncated',
      beforeTokens: typeof rec.beforeTokens === 'number' ? rec.beforeTokens : undefined,
      afterTokens: typeof rec.afterTokens === 'number' ? rec.afterTokens : undefined,
    });
  }
  return out;
}

/**
 * Project durable context.packet.built events into inspectable Manifest records.
 * Thin payloads (ids only) remain inspectable; rich payloads fill source kind/tokens.
 */
function projectManifests(threadEvents: readonly Event[]): ManifestView[] {
  const manifests: ManifestView[] = [];
  for (const event of threadEvents) {
    if (event.type !== 'context.packet.built') continue;
    const payload = event.payload ?? {};
    const packetId =
      typeof payload.packetId === 'string'
        ? payload.packetId
        : typeof payload.id === 'string'
          ? payload.id
          : event.id;
    const includedSourceIds = asStringArray(payload.includedSourceIds);
    const excludedSourceIds = asStringArray(payload.excludedSourceIds);
    let included = asSourceViews(payload.includedSources ?? payload.included);
    let excluded = asSourceViews(payload.excludedSources ?? payload.excluded);

    // Fallback: synthesize source rows from id lists when Runtime emits thin payloads.
    if (included.length === 0 && includedSourceIds.length > 0) {
      included = includedSourceIds.map((id) => ({
        id,
        kind: id.startsWith('msg-')
          ? 'message-excerpt'
          : id === 'agent-instructions'
            ? 'agent-instructions'
            : 'unknown',
      }));
    }
    if (excluded.length === 0 && excludedSourceIds.length > 0) {
      excluded = excludedSourceIds.map((id) => ({ id, kind: 'unknown' }));
    }

    const effectiveIncludedIds =
      includedSourceIds.length > 0 ? includedSourceIds : included.map((s) => s.id);
    const effectiveExcludedIds =
      excludedSourceIds.length > 0 ? excludedSourceIds : excluded.map((s) => s.id);

    manifests.push({
      id: event.id,
      packetId,
      proofHash: typeof payload.proofHash === 'string' ? payload.proofHash : undefined,
      runId: event.runId,
      modelId: typeof payload.modelId === 'string' ? payload.modelId : undefined,
      providerModelId:
        typeof payload.providerModelId === 'string' ? payload.providerModelId : undefined,
      resolutionSource:
        typeof payload.resolutionSource === 'string' ? payload.resolutionSource : undefined,
      credentialResolutionSource:
        typeof payload.credentialResolutionSource === 'string'
          ? payload.credentialResolutionSource
          : undefined,
      credentialRefId:
        typeof payload.credentialRefId === 'string' ? payload.credentialRefId : undefined,
      agentVersionId:
        typeof payload.agentVersionId === 'string' ? payload.agentVersionId : undefined,
      agentVersion: typeof payload.agentVersion === 'number' ? payload.agentVersion : undefined,
      skillVersionIds: asStringArray(payload.skillVersionIds),
      policyId: typeof payload.policyId === 'string' ? payload.policyId : undefined,
      fallbackIndex: typeof payload.fallbackIndex === 'number' ? payload.fallbackIndex : undefined,
      tokenEstimate: typeof payload.tokenEstimate === 'number' ? payload.tokenEstimate : undefined,
      includedSourceIds: effectiveIncludedIds,
      excludedSourceIds: effectiveExcludedIds,
      included,
      excluded,
      summaries: asSummaryViews(payload.summaries),
      truncations: asTruncationViews(payload.truncations),
      crossTaskRefs: asStringArray(payload.crossTaskRefs),
      evidenceRefsForMemory: asStringArray(payload.evidenceRefsForMemory),
      occurredAt: event.occurredAt,
    });
  }
  return manifests;
}

function projectTrace(events: readonly Event[]): TraceItem[] {
  return events.map((event) => ({
    id: event.id,
    category: categorize(event),
    summary: summarize(event),
    time: formatEventTime(event.occurredAt),
    details: projectTraceDetails(event),
  }));
}

function projectTraceDetails(event: Event): TraceItem['details'] {
  const details: Array<{ label: string; value: string }> = [{ label: '事件', value: event.type }];
  if (event.runId) details.push({ label: 'Run', value: String(event.runId) });
  if (event.stepId) details.push({ label: 'Step', value: String(event.stepId) });

  if (event.type === 'review.evidence-recorded') {
    if (typeof event.payload.explanation === 'string' && event.payload.explanation.trim()) {
      details.push({ label: '评审说明', value: event.payload.explanation });
    }
    if (Array.isArray(event.payload.criteria)) {
      for (const criterion of event.payload.criteria) {
        if (!criterion || typeof criterion !== 'object' || Array.isArray(criterion)) continue;
        const record = criterion as Record<string, unknown>;
        const criterionId =
          typeof record.criterionId === 'string' && record.criterionId.trim()
            ? record.criterionId
            : '未命名';
        const verdict = typeof record.verdict === 'string' ? record.verdict : 'unknown';
        const explanation = typeof record.explanation === 'string' ? record.explanation : '';
        details.push({
          label: `标准 ${criterionId}`,
          value: explanation ? `${verdict} · ${explanation}` : verdict,
        });
      }
    }
    if (Array.isArray(event.payload.reviewedArtifactVersionIds)) {
      const versionIds = event.payload.reviewedArtifactVersionIds.filter(
        (value): value is string => typeof value === 'string' && value.trim().length > 0,
      );
      if (versionIds.length > 0) details.push({ label: '产物版本', value: versionIds.join(', ') });
    }
  }

  return details;
}

function categorize(event: Event): TraceItem['category'] {
  if (event.type.startsWith('review.')) return 'review';
  if (event.type === 'step.ready' && event.payload.reason === 'runtime-recovery') {
    return 'recovery';
  }
  if (event.type.startsWith('recovery.') || event.type === 'run.recovered') return 'recovery';
  if (event.type === 'run.cancelled') return 'recovery';
  if (event.type === 'run.failed') return 'recovery';
  if (event.type === 'run.paused') return 'recovery';
  if (event.type === 'run.fallback.selected') return 'model-call';
  if (
    event.type.startsWith('run.') ||
    event.type.startsWith('step.') ||
    event.type.startsWith('plan.')
  )
    return 'run';
  if (event.type === 'message.delta') return 'model-call';
  if (event.type === 'message.appended') return 'context-transfer';
  if (event.type.startsWith('tool.') || event.type.startsWith('mcp.')) return 'tool-action';
  if (event.type === 'context.packet.built') return 'context-transfer';
  if (event.type === 'provider.created' || event.type === 'provider.models_discovered')
    return 'credential-choice';
  if (event.type.startsWith('provider.')) return 'model-call';
  if (event.type.startsWith('approval.')) return 'approval';
  if (event.type.startsWith('artifact.')) return 'artifact';
  return 'context-transfer';
}

function summarize(event: Event): string {
  const modelId = typeof event.payload.modelId === 'string' ? event.payload.modelId : undefined;
  switch (event.type) {
    case 'message.appended': {
      const role = typeof event.payload.role === 'string' ? event.payload.role : 'message';
      if (role === 'user') {
        const text = typeof event.payload.text === 'string' ? event.payload.text : '';
        return text ? `用户消息 · ${truncate(text, 36)}` : '用户消息';
      }
      return `${role} 已写入`;
    }
    case 'run.started': {
      const providerModel =
        typeof event.payload.providerModelId === 'string' ? event.payload.providerModelId : modelId;
      const source =
        typeof event.payload.resolutionSource === 'string'
          ? event.payload.resolutionSource
          : undefined;
      if (providerModel && source) return `Run 启动 · ${providerModel} · ${source}`;
      if (providerModel) return `Run 启动 · ${providerModel}`;
      return 'Run 启动';
    }
    case 'message.delta':
      return '模型输出中…';
    case 'run.completed':
      return 'Run 完成';
    case 'run.recovered': {
      const count =
        typeof event.payload.recoveredStepCount === 'number'
          ? event.payload.recoveredStepCount
          : undefined;
      return count === undefined ? 'Run 已恢复' : `Run 已恢复 · ${count} 个步骤`;
    }
    case 'run.failed': {
      const fc =
        typeof event.payload.failureClass === 'string' ? event.payload.failureClass : 'unknown';
      return `Run 失败 · ${fc}`;
    }
    case 'run.cancelled':
      return 'Run 已取消';
    case 'run.fallback.selected': {
      const fromLabel =
        typeof event.payload.fromProviderModelId === 'string'
          ? event.payload.fromProviderModelId
          : typeof event.payload.fromModelId === 'string'
            ? event.payload.fromModelId
            : '上游';
      const toLabel =
        typeof event.payload.toProviderModelId === 'string'
          ? event.payload.toProviderModelId
          : typeof event.payload.toModelId === 'string'
            ? event.payload.toModelId
            : 'fallback';
      const fc =
        typeof event.payload.failureClass === 'string' ? event.payload.failureClass : undefined;
      return fc
        ? `Fallback 切换 · ${fromLabel} → ${toLabel} · ${fc}`
        : `Fallback 切换 · ${fromLabel} → ${toLabel}`;
    }
    case 'run.paused': {
      const reason = typeof event.payload.reason === 'string' ? event.payload.reason : 'paused';
      const fc =
        typeof event.payload.failureClass === 'string' ? event.payload.failureClass : undefined;
      const reasonLabel =
        reason === 'no_fallback_configured'
          ? '无 fallback 配置'
          : reason === 'fallback_exhausted'
            ? 'Fallback 链耗尽'
            : reason;
      return fc ? `Run 暂停 · ${reasonLabel} · ${fc}` : `Run 暂停 · ${reasonLabel}`;
    }
    case 'provider.usage': {
      const tin = event.payload.tokensIn;
      const tout = event.payload.tokensOut;
      if (typeof tin === 'number' || typeof tout === 'number') {
        return `用量 · in ${tin ?? '—'} / out ${tout ?? '—'}`;
      }
      return '用量上报';
    }
    case 'tool.requested':
      return '工具请求';
    case 'tool.completed':
      return '工具完成';
    case 'provider.created': {
      const name = typeof event.payload.name === 'string' ? event.payload.name : 'Provider';
      const count =
        typeof event.payload.modelCount === 'number' ? event.payload.modelCount : undefined;
      return count !== undefined
        ? `Provider 已添加 · ${name} · ${count} models`
        : `Provider 已添加 · ${name}`;
    }
    case 'provider.models_discovered': {
      const count =
        typeof event.payload.modelCount === 'number' ? event.payload.modelCount : undefined;
      return count !== undefined ? `模型发现 · ${count} models` : '模型发现完成';
    }
    case 'context.packet.built': {
      const model =
        typeof event.payload.providerModelId === 'string'
          ? event.payload.providerModelId
          : typeof event.payload.modelId === 'string'
            ? event.payload.modelId
            : undefined;
      const source =
        typeof event.payload.resolutionSource === 'string'
          ? event.payload.resolutionSource
          : undefined;
      const tokens =
        typeof event.payload.tokenEstimate === 'number' ? event.payload.tokenEstimate : undefined;
      const parts = ['Manifest'];
      if (model) parts.push(model);
      if (source) parts.push(source);
      if (tokens !== undefined) parts.push(`~${tokens} tok`);
      return parts.join(' · ');
    }
    case 'plan.drafted':
    case 'plan.revised':
    case 'plan.approved': {
      const revision =
        typeof event.payload.revision === 'number' ? event.payload.revision : undefined;
      const action =
        event.type === 'plan.approved'
          ? '计划已批准'
          : event.type === 'plan.revised'
            ? '计划已修订'
            : '计划草稿';
      return revision === undefined ? action : `${action} · v${revision}`;
    }
    case 'step.created':
    case 'step.ready':
    case 'step.started':
    case 'step.completed':
    case 'step.failed': {
      const title =
        typeof event.payload.title === 'string'
          ? event.payload.title
          : event.stepId
            ? String(event.stepId)
            : 'Step';
      const state = event.type.slice('step.'.length);
      if (event.type === 'step.ready' && event.payload.reason === 'runtime-recovery') {
        return `Runtime recovery · ${title}`;
      }
      return `Step ${state} · ${title}`;
    }
    case 'artifact.version-created': {
      const name =
        typeof event.payload.artifactName === 'string' ? event.payload.artifactName : '产物';
      const version =
        typeof event.payload.version === 'number' ? ` · v${event.payload.version}` : '';
      return `产物版本已创建 · ${name}${version}`;
    }
    case 'artifact.selected':
      return '产物版本已选定';
    case 'artifact.merge-conflicted':
      return '产物合并冲突 · Run 已暂停';
    case 'approval.enqueued':
      return `审批已入队${
        typeof event.payload.action === 'string' ? ` · ${event.payload.action}` : ''
      }`;
    case 'approval.requested':
      return `Approval requested${
        typeof event.payload.action === 'string' ? ` · ${event.payload.action}` : ''
      }`;
    case 'approval.decided': {
      const decision =
        typeof event.payload.decision === 'string' ? event.payload.decision : 'decided';
      const action = typeof event.payload.action === 'string' ? ` · ${event.payload.action}` : '';
      return `审批 ${decision}${action}`;
    }
    case 'review.accepted':
      return `评审通过${
        typeof event.payload.iteration === 'number' ? ` · 第 ${event.payload.iteration} 轮` : ''
      }`;
    case 'review.rejected':
      return `评审退回${
        typeof event.payload.iteration === 'number' ? ` · 第 ${event.payload.iteration} 轮` : ''
      }`;
    case 'review.evidence-recorded': {
      const verdict =
        typeof event.payload.verdict === 'string' ? event.payload.verdict.toLowerCase() : 'unknown';
      const iteration =
        typeof event.payload.iteration === 'number'
          ? ` · iteration ${event.payload.iteration}`
          : '';
      if (
        verdict === 'accept' ||
        verdict === 'accepted' ||
        verdict === 'pass' ||
        verdict === 'passed'
      ) {
        return `Review passed · ${verdict}${iteration}`;
      }
      if (verdict === 'reject' || verdict === 'rejected' || verdict === 'return') {
        return `Review returned · ${verdict}${iteration}`;
      }
      return `Review evidence · ${verdict}${iteration}`;
    }
    case 'review.limit-reached':
      return '返工次数已达上限 · Run 已暂停';
    default:
      return event.type;
  }
}

function truncate(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

function formatEventTime(occurredAt: string): string | undefined {
  const timestamp = new Date(occurredAt);
  if (Number.isNaN(timestamp.getTime())) return undefined;
  return timestamp.toLocaleTimeString('zh-CN', { hour12: false });
}
