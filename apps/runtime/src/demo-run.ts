import type { AdapterEvent, ProviderAdapter, ProviderCallRequest } from '@sync-think/adapters';
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
  /** Provider model context window used by snapshot estimation and auto compact. */
  contextWindow?: number;
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
  /** Multimodal images for this turn only (not persisted as durable event blobs). */
  images?: DemoRunImage[];
  packetId?: string;
  proofHash?: string;
  nextAdapterEventIndex: number;
  assistantText: string;
  /** Extended thinking / reasoning channel (never mixed into assistantText). */
  reasoningText: string;
  /** When true, use demoProvider Fake path (no live secret). */
  useFakeProvider: boolean;
}

export interface DemoRunEventProjection {
  category: EventCategory;
  type: string;
  payload: Record<string, unknown>;
  nextRun?: DemoRunState;
  terminal: boolean;
}

export interface CreateDemoRunInput {
  runId: RunId;
  threadId: string;
  userText: string;
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
  projectContextPromptBlocks?: string[];
  contextSources?: ContextSnapshotSource[];
  reasoningEffort?: string;
  networkEnabled?: boolean;
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
    images: extras.images && extras.images.length > 0 ? extras.images : undefined,
    packetId: extras.packetId,
    proofHash: extras.proofHash,
    nextAdapterEventIndex: 0,
    assistantText: '',
    reasoningText: '',
    useFakeProvider: useFake,
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
      adapterEvent.type === 'text-delta'
        ? run.assistantText + adapterEvent.text
        : run.assistantText,
    reasoningText:
      adapterEvent.type === 'reasoning-delta'
        ? run.reasoningText + adapterEvent.text
        : run.reasoningText,
  };
  if (adapterEvent.type === 'usage') {
    return {
      category: 'provider',
      type: 'provider.usage',
      payload: {
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
    projectContextPromptBlocks: stringArray(run.projectContextPromptBlocks, 256),
    contextSources,
    compactSummary: typeof run.compactSummary === 'string' ? run.compactSummary : undefined,
    compactedAt: typeof run.compactedAt === 'string' ? run.compactedAt : undefined,
    reasoningEffort: typeof run.reasoningEffort === 'string' ? run.reasoningEffort : undefined,
    networkEnabled: run.networkEnabled === true ? true : undefined,
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
    packetId: typeof run.packetId === 'string' ? run.packetId : undefined,
    proofHash: typeof run.proofHash === 'string' ? run.proofHash : undefined,
    nextAdapterEventIndex: run.nextAdapterEventIndex,
    assistantText: run.assistantText,
    reasoningText: typeof run.reasoningText === 'string' ? run.reasoningText : '',
    useFakeProvider: run.useFakeProvider !== false && !run.providerId,
  };
}

export type DemoProvider = ProviderAdapter;
