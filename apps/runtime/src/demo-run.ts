import type { AdapterEvent, ProviderAdapter, ProviderCallRequest } from '@sync-think/adapters';
import type {
  Event,
  EventCategory,
  ModelResolutionSource,
  ProtocolFamily,
  RunId,
} from '@sync-think/shared';

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
    systemPrompt?: string;
    reasoningEffort?: string;
  } = {},
): ProviderCallRequest {
  const reasoningEffort = extras.reasoningEffort ?? run.reasoningEffort;
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
    ...(reasoningEffort ? { reasoningEffort } : {}),
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
        adapterEventIndex: run.nextAdapterEventIndex,
        modelId: run.modelId,
        packetId: run.packetId,
        run: nextRun,
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
        reasoningText: nextRun.reasoningText,
        adapterEventIndex: run.nextAdapterEventIndex,
        modelId: run.modelId,
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
        toolCall: adapterEvent.toolCall,
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
