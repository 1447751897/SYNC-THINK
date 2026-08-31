import type { AdapterEvent, ProviderAdapter, ProviderCallRequest } from '@sync-think/adapters';
import {
  type AssistantTurnSegment,
  type CommentaryTimelineSegment,
  type ReasoningTimelineSegment,
} from '@sync-think/protocol';
import { normalizeAssistantTurnPhases } from '@sync-think/protocol/assistant-turn';
import type { ContextSnapshot, ContextSnapshotSource } from './context-snapshot.js';
import { isRetryable } from '@sync-think/shared';
import type {
  Event,
  EventCategory,
  FailureClass,
  ModelResolutionSource,
  ProtocolFamily,
  RunId,
} from '@sync-think/shared';

export const DEMO_RUN_RECOVERY_MAX_AGE_MS = 5 * 60 * 1_000;

/** Max in-place retries on the same model before the fallback chain takes over. */
export const MODEL_RETRY_MAX = 5;
/** Base delay for the retry backoff (500ms, 1s, 2s, 4s, 8s — capped). */
export const MODEL_RETRY_BASE_DELAY_MS = 500;
export const MODEL_RETRY_MAX_DELAY_MS = 8_000;
export const MAX_COMMENTARY_TIMELINE_SEGMENTS = 128;
export const MAX_COMMENTARY_TIMELINE_CHARS = 120_000;

/**
 * Whether a failed provider call should be retried in place on the same model.
 * Retries only make sense when nothing was emitted yet (a retry after partial
 * output would duplicate text/tool calls) and the failure class is a
 * transient network/timeout/rate-limit issue (auth/protocol errors won't heal
 * by retrying — those go straight to the fallback chain).
 */
export function shouldRetrySameModel(input: {
  failureClass: FailureClass;
  retryCount: number;
  hasOutput: boolean;
}): boolean {
  if (input.hasOutput) return false;
  if (!isRetryable(input.failureClass)) return false;
  return input.retryCount < MODEL_RETRY_MAX;
}

/** Exponential backoff delay for the retry at the given index (capped). */
export function retryDelayForModel(retryCount: number): number {
  return Math.min(
    MODEL_RETRY_MAX_DELAY_MS,
    MODEL_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, retryCount),
  );
}

export function isDemoRunRecoveryExpired(input: {
  lastActivityAt?: string;
  now?: string;
  maxAgeMs?: number;
}): boolean {
  const lastActivityAt = Date.parse(input.lastActivityAt ?? '');
  const now = Date.parse(input.now ?? new Date().toISOString());
  if (!Number.isFinite(lastActivityAt) || !Number.isFinite(now)) return true;
  return now - lastActivityAt > (input.maxAgeMs ?? DEMO_RUN_RECOVERY_MAX_AGE_MS);
}

export interface DemoRunImage {
  name: string;
  mimeType: string;
  /** Temporary Desktop-staged file used by Runtime immediately before provider I/O. */
  stagingPath?: string;
  /** Small-image fallback for non-Desktop callers; Desktop always stages. */
  dataUrl?: string;
}

export interface DemoRunState {
  runId: RunId;
  threadId: string;
  userText: string;
  /**
   * Kernel that executes this run. Absent = native (in-process runtime loop);
   * external kernels (claude-code / codex) run in spawned subprocesses.
   */
  kernelId?: string;
  /** Internal model id (catalog) or provider model id for fake. */
  modelId: string;
  /** Provider-facing model string sent to the API. */
  providerModelId: string;
  protocol: ProtocolFamily;
  baseUrl: string;
  providerId?: string;
  credentialRefId?: string;
  /** Scrubbed §5.4 selection source — never a secret. */
  credentialResolutionSource?: string;
  agentVersionId: string;
  resolutionSource: ModelResolutionSource;
  /**
   * Bound global Agent identity (mutable agent table).
   * Used for persona injection and UI identity — not the legacy agent_version chain.
   */
  globalAgentId?: string;
  globalAgentName?: string;
  /** Persona / system instructions from the bound global Agent. */
  persona?: string;
  /** Bound team (team-track conversations): identity + orchestration prompt. */
  teamId?: string;
  teamName?: string;
  /** Team mission + member roster injected into the system prompt. */
  teamPromptBlock?: string;
  /**
   * Snapshot of the bound global agent's fallback chain at run start.
   * Used on failure instead of re-reading a possibly-mutated legacy agent.
   */
  fallbackModelIds?: string[];
  /** Durable de-duplicated model attempt order across all fallback layers. */
  attemptedModelIds: string[];
  /** Durable Provider-scoped failure count used by the fallback circuit breaker. */
  providerFailureCounts?: Record<string, number>;
  /**
   * In-place retries already spent on the *current* model (0..MODEL_RETRY_MAX).
   * Reset to 0 when a stream successfully produces its first event, when the
   * run rebinds to a fallback model, and never counts across tool-loop turns.
   */
  retryCount?: number;
  /** Skill bodies injected into system prompt for this run. */
  skillPromptBlocks?: string[];
  /** Per-turn request before Context budget/amendment filtering. */
  requestedSkillVersionIds?: string[];
  /** Bound skill version / skill ids for this run (allowlist snapshot). */
  skillVersionIds?: string[];
  /** Integrity metadata used when exact bodies are reloaded after recovery. */
  skillSnapshots?: Array<{ skillVersionId: string; contentFingerprint: string }>;
  /** Bound MCP server ids for this run (allowlist snapshot). */
  mcpServerIds?: string[];
  /** Configured context window after applying a conversation override. */
  contextWindow?: number;
  /** Provider model context window before applying a conversation override. */
  modelContextWindow?: number;
  /** Persisted conversation override used for this run. */
  contextWindowOverride?: number;
  /** True when contextWindow fell back to the 128k default (no model metadata). */
  contextWindowEstimated?: boolean;
  /**
   * Effective window actually honored this run (min of the configured window
   * and a non-overridable kernel native cap). Drives trimming + kernel injection.
   */
  effectiveContextWindow?: number;
  /** Why the effective window differs from the configured value (observability). */
  contextWindowSource?: 'configured' | 'kernel-capped' | 'estimated';
  kernelContextWindowLimit?: number;
  /**
   * Pre-resolved kernel session plan for observability (run.started payload):
   * the create/resume decision and how many host turns were missing from the
   * native session (cross-kernel gap). Native runs never set this.
   */
  kernelSessionPlan?: { mode: 'create' | 'resume'; gapCount: number };
  /** Included project/task/memory blocks selected for the real provider request. */
  projectContextPromptBlocks?: string[];
  /** Context Packet sources with their provider disposition. */
  contextSources?: ContextSnapshotSource[];
  /** Last provider request snapshot; in-memory only and safe for UI projection. */
  contextSnapshot?: ContextSnapshot;
  compactSummary?: string;
  compactedAt?: string;
  /** Compose 推理强度（auto/off/low/medium/high…）；透传到 adapter。 */
  reasoningEffort?: string;
  /** Compose 联网开关：本轮是否暴露 web_search / web_fetch。 */
  networkEnabled?: boolean;
  /** Built-in SYNC-THINK usage-help turn; does not alter conversation mode. */
  helpMode?: boolean;
  /**
   * Planning mode: this run is a read-only analysis run that submits an
   * approvable plan. The host hard-blocks side-effecting tools.
   */
  planningMode?: boolean;
  /** Multimodal images for this turn only (not persisted as durable event blobs). */
  images?: DemoRunImage[];
  /**
   * How attached images reached this run: forwarded to a vision-capable model,
   * replaced by a vision-model description, replaced by Windows OCR text, or
   * failed. Surfaces in run.started and the appendMessage response.
   */
  imagesMode?: 'forwarded' | 'materialized' | 'described' | 'ocr' | 'failed';
  packetId?: string;
  proofHash?: string;
  nextAdapterEventIndex: number;
  /** User-visible final answer (`assistant` message phase = final_answer). */
  assistantText: string;
  /** User-visible work updates (`assistant` message phase = commentary). */
  commentaryText: string;
  /** Bounded commentary fragments interleaved with durable tool boundaries. */
  commentarySegments: CommentaryTimelineSegment[];
  /** Unclassified text from legacy providers that do not expose assistant phases. */
  legacyPendingText: string;
  /**
   * Timeline sequence where the buffered legacy text first arrived. On flush
   * the classified segment is inserted at this position so it keeps its real
   * emission order even when later segments (e.g. compaction status) were
   * appended to the timeline while the text was still buffered.
   */
  legacyPendingTextSeq?: number;
  /** Provider reasoning summary for diagnostics only. */
  reasoningText: string;
  /** Legacy provider reasoning fragments retained only for checkpoint compatibility. */
  reasoningSegments: ReasoningTimelineSegment[];
  /** Exact provider/kernel emission order for the single visible assistant turn. */
  assistantTimeline: AssistantTurnSegment[];
  /**
   * Tool calls executed by an external kernel this run, in event order. Kept so
   * the durable assistant message can carry tool-call / tool-result blocks —
   * cross-kernel gap transcripts then restore the tool names, arguments and
   * results the resumed kernel otherwise never sees.
   */
  kernelToolEvents: KernelToolEventRecord[];
  /**
   * Kernel tools announced (tool.requested) but not yet revealed into the
   * assistant timeline. A claude-code / codex kernel announces the whole batch
   * in one assistant message while it actually executes tools sequentially, so
   * rows are revealed one-by-one on real execution start (the first on
   * announcement, each next one when the previous tool's result arrives).
   */
  pendingKernelToolCalls?: Array<{
    toolCallId: string;
    name: string;
    argumentsJson?: string;
    announcedAt: string;
  }>;
  /** When true, use demoProvider Fake path (no live secret). */
  useFakeProvider: boolean;
}

export interface KernelToolEventRecord {
  kind: 'tool-call' | 'tool-result';
  sequence: number;
  toolId: string;
  name?: string;
  argsJson?: string;
  output?: string;
  failed?: boolean;
}

const MAX_ASSISTANT_TIMELINE_SEGMENTS = 512;

function isAssistantTurnSegment(value: unknown): value is AssistantTurnSegment {
  if (!value || typeof value !== 'object') return false;
  const segment = value as Record<string, unknown>;
  return (
    typeof segment.id === 'string' &&
    typeof segment.sequence === 'number' &&
    (segment.kind === 'thinking' ||
      segment.kind === 'text' ||
      segment.kind === 'tool' ||
      segment.kind === 'status')
  );
}

function closeAssistantTimelineTail(
  timeline: readonly AssistantTurnSegment[],
  occurredAt?: string,
): AssistantTurnSegment[] {
  if (timeline.length === 0) return [];
  const next = timeline.map((segment) => ({ ...segment })) as AssistantTurnSegment[];
  const tail = next.at(-1);
  if (tail?.kind === 'thinking' && tail.status === 'streaming') {
    next[next.length - 1] = {
      ...tail,
      status: 'completed',
      ...(occurredAt ? { completedAt: occurredAt } : {}),
    };
  } else if (tail?.kind === 'text' && tail.status === 'streaming') {
    next[next.length - 1] = {
      ...tail,
      status: 'completed',
      ...(occurredAt ? { completedAt: occurredAt } : {}),
    };
  }
  return next;
}

export function nextAssistantTimelineSequence(timeline: readonly AssistantTurnSegment[]): number {
  return (timeline.at(-1)?.sequence ?? -1) + 1;
}

function boundAssistantTimeline(timeline: AssistantTurnSegment[]): AssistantTurnSegment[] {
  return timeline.length > MAX_ASSISTANT_TIMELINE_SEGMENTS
    ? timeline.slice(-MAX_ASSISTANT_TIMELINE_SEGMENTS)
    : timeline;
}

export function appendAssistantThinkingDelta(
  run: DemoRunState,
  text: string,
  occurredAt: string,
): DemoRunState {
  if (!text) return run;
  const timeline = run.assistantTimeline ?? [];
  const tail = timeline.at(-1);
  if (tail?.kind === 'thinking' && tail.status === 'streaming') {
    return {
      ...run,
      assistantTimeline: [...timeline.slice(0, -1), { ...tail, text: tail.text + text }],
    };
  }
  const closed = closeAssistantTimelineTail(timeline, occurredAt);
  const sequence = nextAssistantTimelineSequence(closed);
  return {
    ...run,
    assistantTimeline: boundAssistantTimeline([
      ...closed,
      {
        id: `think-${run.runId}-${sequence}`,
        sequence,
        kind: 'thinking',
        text,
        status: 'streaming',
        startedAt: occurredAt,
      },
    ]),
  };
}

export function appendAssistantTextDelta(
  run: DemoRunState,
  phase: 'commentary' | 'final_answer',
  text: string,
  occurredAt: string,
  afterSequence?: number,
): DemoRunState {
  if (!text) return run;
  const timeline = run.assistantTimeline ?? [];
  const tail = timeline.at(-1);
  if (
    tail?.kind === 'text' &&
    tail.phase === phase &&
    tail.status === 'streaming' &&
    (afterSequence === undefined || tail.sequence === afterSequence)
  ) {
    return {
      ...run,
      assistantTimeline: [...timeline.slice(0, -1), { ...tail, text: tail.text + text }],
    };
  }
  const closed = closeAssistantTimelineTail(timeline, occurredAt);
  const sequence =
    afterSequence !== undefined ? afterSequence : nextAssistantTimelineSequence(closed);
  // afterSequence 提供时把段插入到该位置（缓冲文本真实到达顺序），
  // 而不是追加到尾部——后续到达的段（如 compaction status）保持在其后。
  const insertIndex =
    afterSequence !== undefined
      ? closed.findIndex((segment) => segment.sequence >= afterSequence)
      : -1;
  const at = insertIndex < 0 ? closed.length : insertIndex;
  const segment: AssistantTurnSegment = {
    id: `text-${run.runId}-${sequence}`,
    sequence,
    kind: 'text',
    phase,
    text,
    status: 'streaming',
    startedAt: occurredAt,
  };
  const inserted = [...closed.slice(0, at), segment, ...closed.slice(at)];
  const next =
    afterSequence !== undefined
      ? inserted.map((item, index) => (item === segment ? item : { ...item, sequence: index }))
      : inserted;
  return {
    ...run,
    assistantTimeline: boundAssistantTimeline(next),
  };
}

export function closeAssistantTimeline(run: DemoRunState, occurredAt: string): DemoRunState {
  return {
    ...run,
    assistantTimeline: closeAssistantTimelineTail(run.assistantTimeline ?? [], occurredAt),
  };
}

export function startAssistantTool(
  run: DemoRunState,
  input: { toolCallId: string; name: string; argumentsJson?: string; occurredAt: string },
): DemoRunState {
  const current = run.assistantTimeline ?? [];
  const existingIndex = current.findIndex(
    (segment) => segment.kind === 'tool' && segment.toolCallId === input.toolCallId,
  );
  if (existingIndex >= 0) {
    const next = current.map((segment) => ({ ...segment })) as AssistantTurnSegment[];
    const existing = next[existingIndex]!;
    if (existing.kind === 'tool') {
      next[existingIndex] = {
        ...existing,
        name: input.name || existing.name,
        ...(input.argumentsJson !== undefined ? { argumentsJson: input.argumentsJson } : {}),
      };
    }
    return { ...run, assistantTimeline: next };
  }
  const timeline = closeAssistantTimelineTail(current, input.occurredAt);
  const sequence = nextAssistantTimelineSequence(timeline);
  const withTool: AssistantTurnSegment[] = [
    ...timeline,
    {
      id: `tool-${run.runId}-${input.toolCallId}`,
      sequence,
      kind: 'tool',
      toolCallId: input.toolCallId,
      name: input.name,
      ...(input.argumentsJson !== undefined ? { argumentsJson: input.argumentsJson } : {}),
      status: 'running',
      startedAt: input.occurredAt,
    },
  ];
  return {
    ...run,
    assistantTimeline: boundAssistantTimeline(normalizeAssistantTurnPhases(withTool)),
  };
}

export function completeAssistantTool(
  run: DemoRunState,
  input: { toolCallId: string; output: string; failed?: boolean; occurredAt: string },
): DemoRunState {
  const timeline = (run.assistantTimeline ?? []).map((segment) => ({
    ...segment,
  })) as AssistantTurnSegment[];
  const index = timeline.findIndex(
    (segment) => segment.kind === 'tool' && segment.toolCallId === input.toolCallId,
  );
  if (index < 0) return run;
  const existing = timeline[index]!;
  if (existing.kind !== 'tool') return run;
  timeline[index] = {
    ...existing,
    output: input.output,
    isError: input.failed === true,
    status: input.failed ? 'failed' : 'completed',
    completedAt: input.occurredAt,
  };
  return { ...run, assistantTimeline: timeline };
}

export function appendAssistantStatus(
  run: DemoRunState,
  input: {
    statusType: Extract<AssistantTurnSegment, { kind: 'status' }>['statusType'];
    label: string;
    detail?: string;
    occurredAt: string;
  },
): DemoRunState {
  const timeline = closeAssistantTimelineTail(run.assistantTimeline ?? [], input.occurredAt);
  const sequence = nextAssistantTimelineSequence(timeline);
  return {
    ...run,
    assistantTimeline: boundAssistantTimeline([
      ...timeline,
      {
        id: `status-${run.runId}-${sequence}`,
        sequence,
        kind: 'status',
        statusType: input.statusType,
        label: input.label,
        ...(input.detail !== undefined ? { detail: input.detail } : {}),
        occurredAt: input.occurredAt,
      },
    ]),
  };
}
export interface DemoRunEventProjection {
  category: EventCategory;
  type: string;
  payload: Record<string, unknown>;
  nextRun?: DemoRunState;
  terminal: boolean;
}

export interface DemoRunEventProjectionMetadata {
  /** Stable for every progressive usage update emitted by one provider request. */
  requestId?: string;
}

export interface CreateDemoRunInput {
  runId: RunId;
  threadId: string;
  userText: string;
  kernelId?: string;
  modelId?: string;
  providerModelId?: string;
  protocol?: ProtocolFamily;
  baseUrl?: string;
  providerId?: string;
  credentialRefId?: string;
  /** Scrubbed §5.4 selection source — never a secret. */
  credentialResolutionSource?: string;
  agentVersionId?: string;
  resolutionSource?: ModelResolutionSource;
  globalAgentId?: string;
  globalAgentName?: string;
  persona?: string;
  teamId?: string;
  teamName?: string;
  teamPromptBlock?: string;
  fallbackModelIds?: string[];
  attemptedModelIds?: string[];
  providerFailureCounts?: Record<string, number>;
  skillPromptBlocks?: string[];
  requestedSkillVersionIds?: string[];
  skillVersionIds?: string[];
  skillSnapshots?: Array<{ skillVersionId: string; contentFingerprint: string }>;
  mcpServerIds?: string[];
  contextWindow?: number;
  modelContextWindow?: number;
  contextWindowOverride?: number;
  /** True when contextWindow fell back to the 128k default (no model metadata). */
  contextWindowEstimated?: boolean;
  projectContextPromptBlocks?: string[];
  contextSources?: ContextSnapshotSource[];
  reasoningEffort?: string;
  networkEnabled?: boolean;
  helpMode?: boolean;
  planningMode?: boolean;
  images?: DemoRunImage[];
  packetId?: string;
  proofHash?: string;
  useFakeProvider?: boolean;
}

export function createDemoRun(
  runId: RunId,
  threadId: string,
  userText: string,
  extras: Omit<CreateDemoRunInput, 'runId' | 'threadId' | 'userText'> = {},
): DemoRunState {
  const useFake = extras.useFakeProvider ?? true;
  const modelId = extras.modelId ?? 'fake-mini';
  return {
    runId,
    threadId,
    userText,
    kernelId: extras.kernelId,
    modelId,
    providerModelId: extras.providerModelId ?? modelId,
    protocol: extras.protocol ?? 'openai-chat',
    baseUrl: extras.baseUrl ?? 'https://fake.invalid/v1',
    providerId: extras.providerId,
    credentialRefId: extras.credentialRefId,
    credentialResolutionSource: extras.credentialResolutionSource,
    agentVersionId: extras.agentVersionId ?? 'agent-default-conversation',
    resolutionSource: extras.resolutionSource ?? 'agentDefault',
    globalAgentId: extras.globalAgentId,
    globalAgentName: extras.globalAgentName,
    persona: extras.persona,
    teamId: extras.teamId,
    teamName: extras.teamName,
    teamPromptBlock: extras.teamPromptBlock,
    fallbackModelIds:
      extras.fallbackModelIds && extras.fallbackModelIds.length > 0
        ? [...extras.fallbackModelIds]
        : undefined,
    attemptedModelIds: Array.from(new Set([...(extras.attemptedModelIds ?? []), modelId])),
    providerFailureCounts: extras.providerFailureCounts
      ? { ...extras.providerFailureCounts }
      : undefined,
    skillPromptBlocks:
      extras.skillPromptBlocks && extras.skillPromptBlocks.length > 0
        ? [...extras.skillPromptBlocks]
        : undefined,
    requestedSkillVersionIds:
      extras.requestedSkillVersionIds === undefined
        ? undefined
        : [...extras.requestedSkillVersionIds],
    skillVersionIds: extras.skillVersionIds === undefined ? undefined : [...extras.skillVersionIds],
    skillSnapshots:
      extras.skillSnapshots === undefined
        ? undefined
        : extras.skillSnapshots.map((snapshot) => ({ ...snapshot })),
    mcpServerIds:
      extras.mcpServerIds && extras.mcpServerIds.length > 0 ? [...extras.mcpServerIds] : undefined,
    contextWindow: extras.contextWindow,
    modelContextWindow: extras.modelContextWindow,
    contextWindowOverride: extras.contextWindowOverride,
    contextWindowEstimated: extras.contextWindowEstimated === true,
    projectContextPromptBlocks:
      extras.projectContextPromptBlocks && extras.projectContextPromptBlocks.length > 0
        ? [...extras.projectContextPromptBlocks]
        : undefined,
    contextSources:
      extras.contextSources && extras.contextSources.length > 0
        ? extras.contextSources.map((source) => ({ ...source }))
        : undefined,
    reasoningEffort: extras.reasoningEffort,
    networkEnabled: extras.networkEnabled === true ? true : undefined,
    helpMode: extras.helpMode === true ? true : undefined,
    planningMode: extras.planningMode === true ? true : undefined,
    images: extras.images && extras.images.length > 0 ? extras.images : undefined,
    packetId: extras.packetId,
    proofHash: extras.proofHash,
    nextAdapterEventIndex: 0,
    assistantText: '',
    commentaryText: '',
    commentarySegments: [],
    legacyPendingText: '',
    reasoningText: '',
    reasoningSegments: [],
    assistantTimeline: [],
    kernelToolEvents: [],
    useFakeProvider: useFake,
  };
}

function boundCommentaryTimeline(
  segments: readonly CommentaryTimelineSegment[],
): CommentaryTimelineSegment[] {
  const bounded = segments
    .slice(-MAX_COMMENTARY_TIMELINE_SEGMENTS)
    .map((segment) => ({ ...segment }));
  let totalChars = bounded.reduce((total, segment) => total + segment.text.length, 0);
  while (bounded.length > 0 && totalChars > MAX_COMMENTARY_TIMELINE_CHARS) {
    const first = bounded[0]!;
    const overflow = totalChars - MAX_COMMENTARY_TIMELINE_CHARS;
    if (first.text.length <= overflow) {
      totalChars -= first.text.length;
      bounded.shift();
      continue;
    }
    first.text = first.text.slice(overflow);
    totalChars -= overflow;
  }
  return bounded;
}

export function appendCommentaryTimelineDelta(
  run: DemoRunState,
  input: {
    textDelta: string;
    occurredAt: string;
    afterSequence?: number;
  },
): DemoRunState {
  if (!input.textDelta) return run;
  const segments = (run.commentarySegments ?? []).map((segment) => ({ ...segment }));
  const last = segments.at(-1);
  if (last && last.completedAt === undefined && last.afterSequence === input.afterSequence) {
    last.text += input.textDelta;
  } else {
    const segmentIndex = segments.length;
    segments.push({
      id: `commentary-${input.afterSequence ?? 'transient'}-${segmentIndex}`,
      text: input.textDelta,
      startedAt: input.occurredAt,
      ...(input.afterSequence !== undefined ? { afterSequence: input.afterSequence } : {}),
    });
  }
  return { ...run, commentarySegments: boundCommentaryTimeline(segments) };
}

export function closeCommentaryTimelineSegment(
  run: DemoRunState,
  completedAt: string,
): DemoRunState {
  const segments = run.commentarySegments ?? [];
  const last = segments.at(-1);
  if (!last || last.completedAt !== undefined) return run;
  return {
    ...run,
    commentarySegments: [
      ...segments.slice(0, -1),
      {
        ...last,
        completedAt,
      },
    ],
  };
}

export function createDemoProviderRequest(
  run: DemoRunState,
  apiKey: string = 'fake-provider-no-secret',
  signal: AbortSignal = new AbortController().signal,
  extras: {
    messages?: ProviderCallRequest['messages'];
    tools?: ProviderCallRequest['tools'];
    toolChoice?: ProviderCallRequest['toolChoice'];
    systemPrompt?: string;
    reasoningEffort?: string;
  } = {},
): ProviderCallRequest {
  const reasoningEffort = extras.reasoningEffort ?? run.reasoningEffort;
  const promptCache = run.providerId
    ? {
        key: `sync-think:${run.providerId}:${run.modelId}:${run.threadId}`,
        retention: '24h' as const,
        strategy: 'automatic' as const,
      }
    : undefined;
  return {
    protocol: run.protocol,
    baseUrl: run.baseUrl,
    modelId: run.providerModelId,
    apiKey,
    idempotencyKey: run.runId,
    signal,
    ...(extras.systemPrompt ? { systemPrompt: extras.systemPrompt } : {}),
    messages: extras.messages ?? [{ role: 'user', content: run.userText }],
    ...(extras.tools && extras.tools.length > 0 ? { tools: [...extras.tools] } : {}),
    ...(extras.toolChoice ? { toolChoice: extras.toolChoice } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(promptCache ? { promptCache } : {}),
    stream: true,
  };
}

export function projectAdapterEvent(
  run: DemoRunState,
  adapterEvent: AdapterEvent,
  metadata: DemoRunEventProjectionMetadata = {},
): DemoRunEventProjection {
  const nextAdapterEventIndex = run.nextAdapterEventIndex + 1;
  if (adapterEvent.type === 'finished') {
    return {
      category: 'run',
      type: 'run.completed',
      payload: {
        threadId: run.threadId,
        reason: adapterEvent.reason,
        assistantText: run.assistantText,
        ...(run.commentaryText ? { commentaryText: run.commentaryText } : {}),
        ...(run.reasoningText ? { reasoningText: run.reasoningText } : {}),
        adapterEventIndex: run.nextAdapterEventIndex,
        idempotencyKey: run.runId,
        modelId: run.modelId,
        providerModelId: run.providerModelId,
        packetId: run.packetId,
      },
      terminal: true,
    };
  }
  if (adapterEvent.type === 'error') {
    return {
      category: 'run',
      type: 'run.failed',
      payload: {
        threadId: run.threadId,
        failureClass: adapterEvent.failureClass,
        // Scrub-safe message for UI; never includes secrets (adapter responsibility).
        errorMessage: adapterEvent.message,
        adapterEventIndex: run.nextAdapterEventIndex,
        idempotencyKey: run.runId,
        modelId: run.modelId,
        providerModelId: run.providerModelId,
        packetId: run.packetId,
      },
      terminal: true,
    };
  }

  const nextRun: DemoRunState = {
    ...run,
    nextAdapterEventIndex,
    assistantText:
      adapterEvent.type === 'text-delta' ||
      (adapterEvent.type === 'assistant-message-delta' && adapterEvent.phase === 'final_answer')
        ? run.assistantText + adapterEvent.text
        : run.assistantText,
    commentaryText:
      adapterEvent.type === 'assistant-message-delta' && adapterEvent.phase === 'commentary'
        ? run.commentaryText + adapterEvent.text
        : run.commentaryText,
    reasoningText:
      adapterEvent.type === 'reasoning-delta'
        ? run.reasoningText + adapterEvent.text
        : run.reasoningText,
  };
  if (
    adapterEvent.type === 'assistant-message-start' ||
    adapterEvent.type === 'assistant-message-end'
  ) {
    return {
      category: 'message',
      type:
        adapterEvent.type === 'assistant-message-start'
          ? 'message.phase_started'
          : 'message.phase_ended',
      payload: {
        threadId: run.threadId,
        phase: adapterEvent.phase,
        ...(adapterEvent.itemId ? { itemId: adapterEvent.itemId } : {}),
        adapterEventIndex: run.nextAdapterEventIndex,
        modelId: run.modelId,
      },
      nextRun,
      terminal: false,
    };
  }
  if (adapterEvent.type === 'usage') {
    return {
      category: 'provider',
      type: 'provider.usage',
      payload: {
        threadId: run.threadId,
        ...(metadata.requestId ? { requestId: metadata.requestId } : {}),
        ...(run.providerId ? { providerId: run.providerId } : {}),
        providerModelId: run.providerModelId,
        purpose: 'normal',
        tokensIn: adapterEvent.tokensIn,
        tokensOut: adapterEvent.tokensOut,
        ...(adapterEvent.cachedTokensHit !== undefined
          ? { cachedTokensHit: adapterEvent.cachedTokensHit }
          : {}),
        ...(adapterEvent.cachedTokensCreated !== undefined
          ? { cachedTokensCreated: adapterEvent.cachedTokensCreated }
          : {}),
        ...(adapterEvent.reasoningTokens !== undefined
          ? { reasoningTokens: adapterEvent.reasoningTokens }
          : {}),
        ...(adapterEvent.totalTokens !== undefined
          ? { totalTokens: adapterEvent.totalTokens }
          : {}),
        adapterEventIndex: run.nextAdapterEventIndex,
        modelId: run.modelId,
        packetId: run.packetId,
      },
      nextRun,
      terminal: false,
    };
  }
  if (adapterEvent.type === 'reasoning-delta') {
    return {
      category: 'message',
      type: 'message.reasoning_delta',
      payload: {
        threadId: run.threadId,
        textDelta: adapterEvent.text,
        adapterEventIndex: run.nextAdapterEventIndex,
        modelId: run.modelId,
      },
      nextRun,
      terminal: false,
    };
  }
  if (adapterEvent.type === 'assistant-message-delta') {
    return {
      category: 'message',
      type: adapterEvent.phase === 'commentary' ? 'message.commentary_delta' : 'message.delta',
      payload: {
        threadId: run.threadId,
        textDelta: adapterEvent.text,
        phase: adapterEvent.phase,
        ...(adapterEvent.itemId ? { itemId: adapterEvent.itemId } : {}),
        adapterEventIndex: run.nextAdapterEventIndex,
        modelId: run.modelId,
      },
      nextRun,
      terminal: false,
    };
  }
  if (adapterEvent.type === 'text-delta') {
    return {
      category: 'message',
      type: 'message.delta',
      payload: {
        threadId: run.threadId,
        textDelta: adapterEvent.text,
        adapterEventIndex: run.nextAdapterEventIndex,
        modelId: run.modelId,
      },
      nextRun,
      terminal: false,
    };
  }
  if (adapterEvent.type === 'tool-call') {
    return {
      category: 'tool',
      type: 'tool.requested',
      payload: {
        toolCall: adapterEvent.toolCall,
        adapterEventIndex: run.nextAdapterEventIndex,
      },
      nextRun,
      terminal: false,
    };
  }
  if (adapterEvent.type === 'tool-result') {
    return {
      category: 'tool',
      type: 'tool.completed',
      payload: {
        toolCallId: adapterEvent.toolCallId,
        result: adapterEvent.result,
        adapterEventIndex: run.nextAdapterEventIndex,
      },
      nextRun,
      terminal: false,
    };
  }
  return {
    category: 'artifact',
    type: 'artifact.created',
    payload: {
      imageRef: adapterEvent.imageRef,
      mimeType: adapterEvent.mimeType,
      adapterEventIndex: run.nextAdapterEventIndex,
    },
    nextRun,
    terminal: false,
  };
}

export function serializeDemoRuns(runs: ReadonlyMap<string, DemoRunState>): DemoRunState[] {
  return Array.from(runs.values())
    .map(serializeDemoRun)
    .sort((left, right) => left.runId.localeCompare(right.runId));
}

/** Durable Run projection: exact references stay; expanded Skill/provider context does not. */
export function serializeDemoRun(run: DemoRunState): DemoRunState {
  const durable = { ...run };
  delete durable.skillPromptBlocks;
  delete durable.contextSnapshot;
  const result = {
    ...durable,
    images: run.images
      ?.filter((image) => Boolean(image.stagingPath))
      .map(({ dataUrl: _dataUrl, ...image }) => image),
    contextSources: run.contextSources?.map((source) => {
      if (source.kind !== 'skill-definition') return { ...source };
      const metadata = { ...source };
      delete metadata.content;
      return metadata;
    }),
  } as DemoRunState & { mcpToolDispatch?: unknown };
  delete result.mcpToolDispatch;
  return result;
}

export function parseDemoRuns(value: unknown): DemoRunState[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Runtime checkpoint contains invalid demoRuns');
  return value.map(parseDemoRun);
}

export function applyDemoRunEvent(runs: Map<string, DemoRunState>, event: Event): void {
  if (!event.runId) return;
  if (
    event.type === 'run.completed' ||
    event.type === 'run.failed' ||
    event.type === 'run.cancelled' ||
    event.type === 'run.paused'
  ) {
    runs.delete(event.runId);
    return;
  }
  const run = event.payload.run;
  if (run !== undefined) runs.set(event.runId, parseDemoRun(run));
}

function parseDemoRun(value: unknown): DemoRunState {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Runtime checkpoint contains an invalid demo run');
  }
  const run = value as Partial<DemoRunState>;
  if (
    typeof run.runId !== 'string' ||
    typeof run.threadId !== 'string' ||
    typeof run.userText !== 'string' ||
    typeof run.modelId !== 'string' ||
    typeof run.nextAdapterEventIndex !== 'number' ||
    typeof run.assistantText !== 'string'
  ) {
    throw new Error('Runtime checkpoint contains an invalid demo run');
  }
  const modelId = run.modelId;
  const stringArray = (input: unknown, max = 64): string[] | undefined => {
    if (input === undefined) return undefined;
    if (
      !Array.isArray(input) ||
      input.length > max ||
      input.some((item) => typeof item !== 'string')
    ) {
      throw new Error('Runtime checkpoint contains an invalid run string array');
    }
    return input.map((item) => String(item));
  };
  const attemptedModelIds = stringArray(run.attemptedModelIds, 256) ?? [];
  if (!attemptedModelIds.includes(modelId)) attemptedModelIds.push(modelId);
  const retryCount = (() => {
    if (
      typeof run.retryCount !== 'number' ||
      !Number.isInteger(run.retryCount) ||
      run.retryCount < 0 ||
      run.retryCount > MODEL_RETRY_MAX
    ) {
      return undefined;
    }
    return run.retryCount;
  })();
  const providerFailureCounts = (() => {
    if (!run.providerFailureCounts || typeof run.providerFailureCounts !== 'object') {
      return undefined;
    }
    const entries = Object.entries(run.providerFailureCounts)
      .filter(
        (entry): entry is [string, number] =>
          entry[0].length > 0 &&
          typeof entry[1] === 'number' &&
          Number.isInteger(entry[1]) &&
          entry[1] > 0,
      )
      .slice(0, 64);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  })();
  const skillSnapshots = (() => {
    if (run.skillSnapshots === undefined) return undefined;
    if (!Array.isArray(run.skillSnapshots) || run.skillSnapshots.length > 8) {
      throw new Error('Runtime checkpoint contains invalid Skill snapshots');
    }
    return run.skillSnapshots.map((value) => {
      if (
        !value ||
        typeof value !== 'object' ||
        typeof value.skillVersionId !== 'string' ||
        typeof value.contentFingerprint !== 'string'
      ) {
        throw new Error('Runtime checkpoint contains an invalid Skill snapshot');
      }
      return {
        skillVersionId: value.skillVersionId,
        contentFingerprint: value.contentFingerprint,
      };
    });
  })();
  const contextSources = (() => {
    if (run.contextSources === undefined) return undefined;
    if (!Array.isArray(run.contextSources) || run.contextSources.length > 256) {
      throw new Error('Runtime checkpoint contains invalid context sources');
    }
    return run.contextSources.map((value) => {
      if (
        !value ||
        typeof value !== 'object' ||
        typeof value.id !== 'string' ||
        typeof value.kind !== 'string' ||
        typeof value.section !== 'string' ||
        (value.disposition !== 'included' && value.disposition !== 'audit-only')
      ) {
        throw new Error('Runtime checkpoint contains an invalid context source');
      }
      return {
        id: value.id,
        kind: value.kind,
        section: value.section,
        disposition: value.disposition,
        ...(value.kind !== 'skill-definition' && typeof value.content === 'string'
          ? { content: value.content }
          : {}),
        ...(typeof value.toolName === 'string' ? { toolName: value.toolName } : {}),
        ...(typeof value.tokens === 'number' && Number.isFinite(value.tokens)
          ? { tokens: value.tokens }
          : {}),
      } as ContextSnapshotSource;
    });
  })();
  return {
    runId: run.runId as RunId,
    threadId: run.threadId,
    userText: run.userText,
    modelId,
    providerModelId: typeof run.providerModelId === 'string' ? run.providerModelId : modelId,
    protocol: (run.protocol as ProtocolFamily) ?? 'openai-chat',
    baseUrl: typeof run.baseUrl === 'string' ? run.baseUrl : 'https://fake.invalid/v1',
    providerId: typeof run.providerId === 'string' ? run.providerId : undefined,
    credentialRefId: typeof run.credentialRefId === 'string' ? run.credentialRefId : undefined,
    agentVersionId:
      typeof run.agentVersionId === 'string' ? run.agentVersionId : 'agent-default-conversation',
    resolutionSource: (run.resolutionSource as ModelResolutionSource) ?? 'agentDefault',
    globalAgentId: typeof run.globalAgentId === 'string' ? run.globalAgentId : undefined,
    globalAgentName: typeof run.globalAgentName === 'string' ? run.globalAgentName : undefined,
    persona: typeof run.persona === 'string' ? run.persona : undefined,
    teamId: typeof run.teamId === 'string' ? run.teamId : undefined,
    teamName: typeof run.teamName === 'string' ? run.teamName : undefined,
    teamPromptBlock: typeof run.teamPromptBlock === 'string' ? run.teamPromptBlock : undefined,
    fallbackModelIds: stringArray(run.fallbackModelIds),
    attemptedModelIds: Array.from(new Set(attemptedModelIds)),
    providerFailureCounts,
    retryCount,
    requestedSkillVersionIds: stringArray(run.requestedSkillVersionIds, 8),
    skillVersionIds: stringArray(run.skillVersionIds, 8),
    skillSnapshots,
    mcpServerIds: stringArray(run.mcpServerIds),
    contextWindow:
      typeof run.contextWindow === 'number' && Number.isFinite(run.contextWindow)
        ? run.contextWindow
        : undefined,
    modelContextWindow:
      typeof run.modelContextWindow === 'number' && Number.isFinite(run.modelContextWindow)
        ? run.modelContextWindow
        : undefined,
    contextWindowOverride:
      typeof run.contextWindowOverride === 'number' && Number.isFinite(run.contextWindowOverride)
        ? run.contextWindowOverride
        : undefined,
    projectContextPromptBlocks: stringArray(run.projectContextPromptBlocks, 256),
    contextSources,
    compactSummary: typeof run.compactSummary === 'string' ? run.compactSummary : undefined,
    compactedAt: typeof run.compactedAt === 'string' ? run.compactedAt : undefined,
    reasoningEffort: typeof run.reasoningEffort === 'string' ? run.reasoningEffort : undefined,
    networkEnabled: run.networkEnabled === true ? true : undefined,
    helpMode: run.helpMode === true ? true : undefined,
    images: Array.isArray(run.images)
      ? run.images
          .filter((img): img is DemoRunImage =>
            Boolean(
              img &&
              typeof img === 'object' &&
              ((typeof (img as DemoRunImage).stagingPath === 'string' &&
                Boolean((img as DemoRunImage).stagingPath)) ||
                (typeof (img as DemoRunImage).dataUrl === 'string' &&
                  (img as DemoRunImage).dataUrl!.startsWith('data:image/'))),
            ),
          )
          .map((img) => ({
            name: typeof img.name === 'string' ? img.name : 'image',
            mimeType: typeof img.mimeType === 'string' ? img.mimeType : 'image/png',
            ...(typeof img.stagingPath === 'string' ? { stagingPath: img.stagingPath } : {}),
            ...(typeof img.dataUrl === 'string' ? { dataUrl: img.dataUrl } : {}),
          }))
      : undefined,
    imagesMode:
      run.imagesMode === 'forwarded' ||
      run.imagesMode === 'materialized' ||
      run.imagesMode === 'described' ||
      run.imagesMode === 'ocr' ||
      run.imagesMode === 'failed'
        ? run.imagesMode
        : undefined,
    packetId: typeof run.packetId === 'string' ? run.packetId : undefined,
    proofHash: typeof run.proofHash === 'string' ? run.proofHash : undefined,
    nextAdapterEventIndex: run.nextAdapterEventIndex,
    assistantText: run.assistantText,
    commentaryText: typeof run.commentaryText === 'string' ? run.commentaryText : '',
    commentarySegments: parseTimelineSegments(
      run.commentarySegments,
      'commentary',
      boundCommentaryTimeline,
    ),
    legacyPendingText: typeof run.legacyPendingText === 'string' ? run.legacyPendingText : '',
    reasoningText: typeof run.reasoningText === 'string' ? run.reasoningText : '',
    reasoningSegments: parseTimelineSegments(run.reasoningSegments, 'reasoning', (segments) =>
      segments.slice(-MAX_COMMENTARY_TIMELINE_SEGMENTS),
    ),
    assistantTimeline: Array.isArray(run.assistantTimeline)
      ? run.assistantTimeline.filter(isAssistantTurnSegment).slice(-512)
      : [],
    // Legacy checkpoints predate kernel tool history; normalize to an empty list.
    kernelToolEvents: Array.isArray(run.kernelToolEvents)
      ? run.kernelToolEvents.filter(
          (entry): entry is KernelToolEventRecord =>
            Boolean(entry) &&
            (entry.kind === 'tool-call' || entry.kind === 'tool-result') &&
            typeof entry.toolId === 'string',
        )
      : [],
    useFakeProvider: run.useFakeProvider !== false && !run.providerId,
  };
}

export type DemoProvider = ProviderAdapter;

function parseTimelineSegments<T extends CommentaryTimelineSegment>(
  value: unknown,
  channel: 'commentary' | 'reasoning',
  bound: (segments: T[]) => T[],
): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`Runtime checkpoint contains invalid ${channel} timeline segments`);
  }
  const segments = value.map((entry) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      typeof entry.id !== 'string' ||
      typeof entry.text !== 'string' ||
      typeof entry.startedAt !== 'string'
    ) {
      throw new Error(`Runtime checkpoint contains an invalid ${channel} timeline segment`);
    }
    const completedAt = typeof entry.completedAt === 'string' ? entry.completedAt : undefined;
    const afterSequence =
      typeof entry.afterSequence === 'number' &&
      Number.isInteger(entry.afterSequence) &&
      entry.afterSequence >= 0
        ? entry.afterSequence
        : undefined;
    return {
      id: entry.id,
      text: entry.text,
      startedAt: entry.startedAt,
      ...(completedAt ? { completedAt } : {}),
      ...(afterSequence !== undefined ? { afterSequence } : {}),
    } as T;
  });
  return bound(segments);
}
