import type {
  AdapterEvent,
  ProviderAdapter,
  ProviderCallRequest,
  ProviderMessage,
  ProviderToolCall,
} from '@sync-think/adapters';
import type {
  Event,
  EventCategory,
  ModelResolutionSource,
  ProtocolFamily,
  RunId,
  MessageAttachment,
} from '@sync-think/shared';
import { APPLICATION_TOOL_DEFINITIONS } from '@sync-think/protocol';
import { EXECUTION_TOOL_SCHEMAS } from './execution-tools.js';

export interface DemoRunState {
  runId: RunId;
  threadId: string;
  userText: string;
  latestUserMessageId?: string;
  providerContext?: {
    systemPrompt: string;
    messages: ProviderMessage[];
    history: {
      includedEventIds: string[];
      excludedEventIds: string[];
      tokenEstimate: number;
      imageAttachments?: MessageAttachment[];
    };
  };
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
  packetId?: string;
  proofHash?: string;
  nextAdapterEventIndex: number;
  assistantText: string;
  /** Number of completed Provider turns in the in-app application-tool loop. */
  providerTurn: number;
  /** Bounded retry count for the current model and Provider turn. */
  providerRetryAttempt: number;
  /** True only when the exact model advertises tool-calling. */
  applicationToolsEnabled: boolean;
  executionRoot?: string;
  executionToolNames: string[];
  effectiveApprovalMode?: string;
  browserIdentityId?: string;
  pendingApplicationToolCalls: ProviderToolCall[];
  startedApplicationToolCallIds: string[];
  applicationToolResults: Array<{ toolCallId: string; result: string }>;
  /** When true, use demoProvider Fake path (no live secret). */
  useFakeProvider: boolean;
  /** Metadata only. Image bytes are loaded immediately before a Provider call. */
  attachments: MessageAttachment[];
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
  latestUserMessageId?: string;
  providerContext?: DemoRunState['providerContext'];
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
  packetId?: string;
  proofHash?: string;
  useFakeProvider?: boolean;
  providerTurn?: number;
  providerRetryAttempt?: number;
  applicationToolsEnabled?: boolean;
  executionRoot?: string;
  executionToolNames?: readonly string[];
  effectiveApprovalMode?: string;
  browserIdentityId?: string;
  attachments?: readonly MessageAttachment[];
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
    latestUserMessageId: extras.latestUserMessageId,
    providerContext: extras.providerContext,
    modelId,
    providerModelId: extras.providerModelId ?? modelId,
    protocol: extras.protocol ?? 'openai-chat',
    baseUrl: extras.baseUrl ?? 'https://fake.invalid/v1',
    providerId: extras.providerId,
    credentialRefId: extras.credentialRefId,
    credentialResolutionSource: extras.credentialResolutionSource,
    agentVersionId: extras.agentVersionId ?? 'agent-default-conversation',
    resolutionSource: extras.resolutionSource ?? 'agentDefault',
    packetId: extras.packetId,
    proofHash: extras.proofHash,
    nextAdapterEventIndex: 0,
    assistantText: '',
    providerTurn: extras.providerTurn ?? 0,
    providerRetryAttempt: extras.providerRetryAttempt ?? 0,
    applicationToolsEnabled: extras.applicationToolsEnabled ?? false,
    executionRoot: extras.executionRoot,
    executionToolNames: [...(extras.executionToolNames ?? [])],
    effectiveApprovalMode: extras.effectiveApprovalMode,
    browserIdentityId: extras.browserIdentityId,
    pendingApplicationToolCalls: [],
    startedApplicationToolCallIds: [],
    applicationToolResults: [],
    useFakeProvider: useFake,
    attachments: structuredClone([...(extras.attachments ?? [])]),
  };
}

export function createDemoProviderRequest(
  run: DemoRunState,
  apiKey: string = 'fake-provider-no-secret',
  signal: AbortSignal = new AbortController().signal,
  imageParts: readonly import('@sync-think/adapters').ProviderContentPart[] = [],
): ProviderCallRequest {
  const sourceMessages = structuredClone(
    run.providerContext?.messages ?? [{ role: 'user' as const, content: run.userText }],
  );
  const imageByRef = new Map(imageParts.map((part) => [part.imageRef ?? '', part]));
  const messages = sourceMessages.map((message) => {
    if (!Array.isArray(message.content)) return message;
    const content = message.content.flatMap((part) => {
      if (part.type !== 'image' || !part.imageRef) return [part];
      const materialized = imageByRef.get(part.imageRef);
      return materialized ? [structuredClone(materialized)] : [];
    });
    return { ...message, content };
  });
  const latestUser = [...messages].reverse().find((message) => message.role === 'user');
  const referencedImageIds = new Set(
    messages.flatMap((message) =>
      Array.isArray(message.content)
        ? message.content.flatMap((part) =>
            part.type === 'image' && part.imageRef ? [part.imageRef] : [],
          )
        : [],
    ),
  );
  const currentImageParts = imageParts.filter((part) => !referencedImageIds.has(part.imageRef ?? ''));
  if (currentImageParts.length > 0) {
    if (latestUser) {
      const textParts =
        typeof latestUser.content === 'string'
          ? [{ type: 'text' as const, text: latestUser.content }]
          : latestUser.content;
      latestUser.content = [...textParts, ...structuredClone(currentImageParts)];
    }
  }
  return {
    protocol: run.protocol,
    baseUrl: run.baseUrl,
    modelId: run.providerModelId,
    apiKey,
    idempotencyKey: `${run.runId}:application-turn-${run.providerTurn + 1}`,
    signal,
    systemPrompt: run.providerContext?.systemPrompt,
    messages,
    ...(run.applicationToolsEnabled
      ? {
          tools: [
            ...APPLICATION_TOOL_DEFINITIONS.map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
            })),
            ...EXECUTION_TOOL_SCHEMAS.filter((tool) =>
              run.executionToolNames.includes(tool.name),
            ),
          ],
        }
      : {}),
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
    pendingApplicationToolCalls:
      adapterEvent.type === 'tool-call'
        ? [...run.pendingApplicationToolCalls, adapterEvent.toolCall]
        : run.pendingApplicationToolCalls,
  };
  if (adapterEvent.type === 'usage') {
    return {
      category: 'provider',
      type: 'provider.usage',
      payload: {
        tokensIn: adapterEvent.tokensIn,
        tokensOut: adapterEvent.tokensOut,
        adapterEventIndex: run.nextAdapterEventIndex,
        modelId: run.modelId,
        packetId: run.packetId,
        run: nextRun,
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
        run: nextRun,
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
        threadId: run.threadId,
        toolCall: adapterEvent.toolCall,
        agentVersionId: run.agentVersionId,
        modelId: run.modelId,
        adapterEventIndex: run.nextAdapterEventIndex,
        run: nextRun,
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
        run: nextRun,
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
      run: nextRun,
    },
    nextRun,
    terminal: false,
  };
}

export function serializeDemoRuns(runs: ReadonlyMap<string, DemoRunState>): DemoRunState[] {
  return Array.from(runs.values())
    .map((run) => ({ ...run }))
    .sort((left, right) => left.runId.localeCompare(right.runId));
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
    event.type === 'run.paused' ||
    event.type === 'run.blocked'
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
  return {
    runId: run.runId as RunId,
    threadId: run.threadId,
    userText: run.userText,
    latestUserMessageId:
      typeof run.latestUserMessageId === 'string' ? run.latestUserMessageId : undefined,
    providerContext: parseProviderContext(run.providerContext),
    modelId,
    providerModelId: typeof run.providerModelId === 'string' ? run.providerModelId : modelId,
    protocol: (run.protocol as ProtocolFamily) ?? 'openai-chat',
    baseUrl: typeof run.baseUrl === 'string' ? run.baseUrl : 'https://fake.invalid/v1',
    providerId: typeof run.providerId === 'string' ? run.providerId : undefined,
    credentialRefId: typeof run.credentialRefId === 'string' ? run.credentialRefId : undefined,
    agentVersionId:
      typeof run.agentVersionId === 'string' ? run.agentVersionId : 'agent-default-conversation',
    resolutionSource: (run.resolutionSource as ModelResolutionSource) ?? 'agentDefault',
    packetId: typeof run.packetId === 'string' ? run.packetId : undefined,
    proofHash: typeof run.proofHash === 'string' ? run.proofHash : undefined,
    nextAdapterEventIndex: run.nextAdapterEventIndex,
    assistantText: run.assistantText,
    providerTurn:
      Number.isSafeInteger(run.providerTurn) && Number(run.providerTurn) >= 0
        ? Number(run.providerTurn)
        : 0,
    providerRetryAttempt:
      Number.isSafeInteger(run.providerRetryAttempt) && Number(run.providerRetryAttempt) >= 0
        ? Number(run.providerRetryAttempt)
        : 0,
    applicationToolsEnabled: run.applicationToolsEnabled === true,
    executionRoot: typeof run.executionRoot === 'string' ? run.executionRoot : undefined,
    executionToolNames: parseStringArray(run.executionToolNames),
    effectiveApprovalMode:
      typeof run.effectiveApprovalMode === 'string' ? run.effectiveApprovalMode : undefined,
    browserIdentityId:
      typeof run.browserIdentityId === 'string' ? run.browserIdentityId : undefined,
    pendingApplicationToolCalls: parseProviderToolCalls(run.pendingApplicationToolCalls),
    startedApplicationToolCallIds: parseStringArray(run.startedApplicationToolCallIds),
    applicationToolResults: parseApplicationToolResults(run.applicationToolResults),
    useFakeProvider: run.useFakeProvider !== false && !run.providerId,
    attachments: parseMessageAttachments(run.attachments),
  };
}

function parseMessageAttachments(value: unknown): MessageAttachment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Runtime checkpoint contains invalid attachments');
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('Runtime checkpoint contains an invalid attachment');
    }
    const attachment = entry as Partial<MessageAttachment>;
    if (
      typeof attachment.id !== 'string' ||
      (attachment.kind !== 'image' && attachment.kind !== 'file' && attachment.kind !== 'folder') ||
      typeof attachment.name !== 'string' ||
      typeof attachment.mimeType !== 'string' ||
      typeof attachment.size !== 'number' ||
      typeof attachment.managedRef !== 'string' ||
      attachment.readOnly !== true ||
      (attachment.sha256 !== undefined && typeof attachment.sha256 !== 'string')
    ) {
      throw new Error('Runtime checkpoint contains an invalid attachment');
    }
    return structuredClone(attachment as MessageAttachment);
  });
}

const APPLICATION_TOOL_PROTOCOLS = new Set<ProtocolFamily>([
  'openai-chat',
  'openai-responses',
  'anthropic-messages',
]);

export function resolveApplicationToolsEnabled(input: {
  protocol?: ProtocolFamily;
  capabilities?: readonly string[];
  capabilitiesConfirmed?: boolean;
  modelId?: string;
}): boolean {
  if (input.modelId === 'fake-tool-use') return true;
  return (
    input.capabilities?.includes('tool-calling') === true ||
    (input.protocol !== undefined && APPLICATION_TOOL_PROTOCOLS.has(input.protocol))
  );
}

function parseProviderToolCalls(value: unknown): ProviderToolCall[] {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw new Error('Runtime checkpoint contains invalid application tool calls');
  return value.map((entry) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      typeof (entry as ProviderToolCall).id !== 'string' ||
      typeof (entry as ProviderToolCall).name !== 'string' ||
      typeof (entry as ProviderToolCall).argumentsJson !== 'string'
    ) {
      throw new Error('Runtime checkpoint contains an invalid application tool call');
    }
    return { ...(entry as ProviderToolCall) };
  });
}

function parseStringArray(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new Error('Runtime checkpoint contains an invalid string array');
  }
  return [...value];
}

function parseApplicationToolResults(
  value: unknown,
): Array<{ toolCallId: string; result: string }> {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw new Error('Runtime checkpoint contains invalid application tool results');
  return value.map((entry) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      typeof (entry as { toolCallId?: unknown }).toolCallId !== 'string' ||
      typeof (entry as { result?: unknown }).result !== 'string'
    ) {
      throw new Error('Runtime checkpoint contains an invalid application tool result');
    }
    return {
      toolCallId: (entry as { toolCallId: string }).toolCallId,
      result: (entry as { result: string }).result,
    };
  });
}

function parseProviderContext(value: unknown): DemoRunState['providerContext'] | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Runtime checkpoint contains an invalid provider context');
  }
  const context = value as {
    systemPrompt?: unknown;
    messages?: unknown;
    history?: unknown;
  };
  if (typeof context.systemPrompt !== 'string' || !Array.isArray(context.messages)) {
    throw new Error('Runtime checkpoint contains an invalid provider context');
  }
  const messages: ProviderMessage[] = context.messages.map((message) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      throw new Error('Runtime checkpoint contains an invalid provider message');
    }
    const candidate = message as { role?: unknown; content?: unknown; toolCallId?: unknown };
    if (
      (candidate.role !== 'user' &&
        candidate.role !== 'assistant' &&
        candidate.role !== 'tool' &&
        candidate.role !== 'system') ||
      (typeof candidate.content !== 'string' && !isProviderContentParts(candidate.content)) ||
      (candidate.toolCallId !== undefined && typeof candidate.toolCallId !== 'string')
    ) {
      throw new Error('Runtime checkpoint contains an invalid provider message');
    }
    return {
      role: candidate.role,
      content: structuredClone(candidate.content) as ProviderMessage['content'],
      ...(typeof candidate.toolCallId === 'string' ? { toolCallId: candidate.toolCallId } : {}),
    };
  });
  if (!context.history || typeof context.history !== 'object' || Array.isArray(context.history)) {
    throw new Error('Runtime checkpoint contains an invalid provider history');
  }
  const history = context.history as {
    includedEventIds?: unknown;
    excludedEventIds?: unknown;
    tokenEstimate?: unknown;
    imageAttachments?: unknown;
  };
  if (
    !Array.isArray(history.includedEventIds) ||
    !history.includedEventIds.every((id) => typeof id === 'string') ||
    !Array.isArray(history.excludedEventIds) ||
    !history.excludedEventIds.every((id) => typeof id === 'string') ||
    !Number.isFinite(history.tokenEstimate) ||
    (history.tokenEstimate as number) < 0
  ) {
    throw new Error('Runtime checkpoint contains an invalid provider history');
  }
  return {
    systemPrompt: context.systemPrompt,
    messages,
    history: {
      includedEventIds: history.includedEventIds as string[],
      excludedEventIds: history.excludedEventIds as string[],
      tokenEstimate: history.tokenEstimate as number,
      imageAttachments: parseMessageAttachments(history.imageAttachments),
    },
  };
}

function isProviderContentParts(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((part) => {
    if (!part || typeof part !== 'object' || Array.isArray(part)) return false;
    const type = (part as { type?: unknown }).type;
    return type === 'text' || type === 'image' || type === 'tool-call' || type === 'tool-result';
  });
}

export type DemoProvider = ProviderAdapter;
