import { randomBytes } from 'node:crypto';
import { connect, type Socket } from 'node:net';
import {
  DEFAULT_FEATURES,
  PROTOCOL_VERSION,
  computeClientProof,
  computeHmac,
  computeRuntimeProof,
  decodeFrames,
  encodeFrame,
  pipePathPortable,
  verifyHmac,
  type CommandType,
  type ConversationTransientFrame,
  type ConversationTransientSnapshot,
  type ConversationTransientStreamEvent,
  type EventReplayCursor,
  type EventReplayPagePayload,
  type EventStreamEvent,
  type EventStreamStartedPayload,
  type Frame,
  type Hello,
  type HelloChallengePayload,
  type HelloProofPayload,
  type SubscribeConversationTransientStreamResponse,
} from '@sync-think/protocol';
import { ErrorCode, ulid, type Event, type EventCategory } from '@sync-think/shared';
import type { RuntimeConnectFailure } from '../runtime-bridge-contract.js';

export interface RuntimePipeClientOptions {
  installId: string;
  appVersion: string;
  helloSecret?: string;
  requestTimeoutMs?: number;
  reconnectDelayMs?: number;
}

export const USAGE_SUMMARY_REQUEST_TIMEOUT_MS = 300_000;
export const BROWSER_PROFILE_MAINTENANCE_REQUEST_TIMEOUT_MS = 30_000;
export const BROWSER_RECORDING_REQUEST_TIMEOUT_MS = 30_000;
const CONVERSATION_COMPACT_REQUEST_TIMEOUT_MS = 120_000;
/**
 * Replay executes real browser steps (open system browser, navigate, click,
 * fill). Each step can take up to 30s and the browser cold start can take
 * additional time, so the IPC budget must be much larger than the 5s CRUD
 * default.
 */
export const BROWSER_WORKFLOW_REPLAY_REQUEST_TIMEOUT_MS = 300_000;

export function resolveRuntimeRequestTimeoutMs(type: string, defaultTimeoutMs: number): number {
  if (type === 'usage.summary') return USAGE_SUMMARY_REQUEST_TIMEOUT_MS;
  if (type === 'conversation.compact') return CONVERSATION_COMPACT_REQUEST_TIMEOUT_MS;
  if (
    type === 'browser.profile.listSiteSessions' ||
    type === 'browser.profile.clearSiteSession' ||
    type === 'browser.profile.delete'
  ) {
    return BROWSER_PROFILE_MAINTENANCE_REQUEST_TIMEOUT_MS;
  }
  if (type === 'browser.recording.start' || type === 'browser.recording.stop') {
    return BROWSER_RECORDING_REQUEST_TIMEOUT_MS;
  }
  if (
    type === 'browser.workflow.execute' ||
    type === 'browser.workflow.approveAndExecute'
  ) {
    return BROWSER_WORKFLOW_REPLAY_REQUEST_TIMEOUT_MS;
  }
  return defaultTimeoutMs;
}

interface PendingRequest {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface EventSubscription {
  cursor: EventReplayCursor;
  categories?: EventCategory[];
  listener: (event: Event) => void;
  cursorListener?: (cursor: EventReplayCursor) => void;
  streamId: string | null;
  phase: 'catching-up' | 'live';
  highWatermark: { sequence: number; eventId?: string } | null;
  pendingLiveEvents: Event[];
}

function normalizeEventReplayCursor(cursor: number | EventReplayCursor): EventReplayCursor {
  if (typeof cursor === 'number') return { sequence: cursor, eventId: '' };
  return { sequence: cursor.sequence, eventId: cursor.eventId };
}

function compareEventReplayCursors(left: EventReplayCursor, right: EventReplayCursor): number {
  if (left.sequence !== right.sequence) return left.sequence - right.sequence;
  if (left.eventId === right.eventId) return 0;
  return left.eventId < right.eventId ? -1 : 1;
}

function cursorForEvent(event: Event): EventReplayCursor {
  return { sequence: event.sequence, eventId: String(event.id) };
}

interface TransientSubscription {
  threadId: string;
  afterStreamSequence: number;
  listener: (frame: ConversationTransientFrame) => void;
  snapshotListener?: (
    latestStreamSequence: number,
    snapshot: ConversationTransientSnapshot | undefined,
  ) => void;
  streamId: string | null;
  phase: 'catching-up' | 'live';
  pendingLiveFrames: ConversationTransientFrame[];
}

function isConversationTransientSnapshot(value: unknown): value is ConversationTransientSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<ConversationTransientSnapshot>;
  return (
    typeof snapshot.threadId === 'string' &&
    snapshot.threadId.length > 0 &&
    typeof snapshot.runId === 'string' &&
    snapshot.runId.length > 0 &&
    Number.isSafeInteger(snapshot.streamSequence) &&
    (snapshot.streamSequence ?? -1) >= 0 &&
    typeof snapshot.text === 'string' &&
    (snapshot.reasoningText === undefined || typeof snapshot.reasoningText === 'string') &&
    typeof snapshot.updatedAt === 'string'
  );
}

export class RuntimeAuthenticationError extends Error {
  constructor() {
    super('Runtime authentication failed');
    this.name = 'RuntimeAuthenticationError';
  }
}

export class RuntimeProtocolError extends Error {
  constructor() {
    super('Runtime protocol error');
    this.name = 'RuntimeProtocolError';
  }
}

export class RuntimeResponseError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'RuntimeResponseError';
    this.code = code;
  }
}

export class RuntimeTransientError extends Error {
  constructor(message = 'Runtime connection unavailable') {
    super(message);
    this.name = 'RuntimeTransientError';
  }
}

const TRANSIENT_TRANSPORT_ERROR_CODES = new Set([
  'EBUSY',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOENT',
  'EPIPE',
  'ETIMEDOUT',
]);

function isHelloChallengePayload(payload: unknown): payload is HelloChallengePayload {
  if (!payload || typeof payload !== 'object') return false;
  const challenge = payload as Partial<HelloChallengePayload>;
  return (
    challenge.challenge === true &&
    typeof challenge.runtimeNonce === 'string' &&
    challenge.runtimeNonce.length > 0 &&
    typeof challenge.runtimeToken === 'string' &&
    Array.isArray(challenge.agreedFeatures) &&
    challenge.agreedFeatures.every((feature) => typeof feature === 'string')
  );
}

function isHelloAcceptedPayload(payload: unknown): payload is { ok: true } {
  return Boolean(
    payload && typeof payload === 'object' && (payload as { ok?: unknown }).ok === true,
  );
}

function runtimeAuthenticationFailed(): Error {
  return new RuntimeAuthenticationError();
}

function isRetryableConnectionError(error: unknown): boolean {
  return classifyRuntimeConnectError(error).retryable;
}

export function classifyRuntimeConnectError(error: unknown): RuntimeConnectFailure {
  if (error instanceof RuntimeAuthenticationError) {
    return { code: 'runtime.authentication-failed', retryable: false };
  }
  if (error instanceof RuntimeProtocolError) {
    return { code: 'runtime.protocol-error', retryable: false };
  }
  if (
    error instanceof RuntimeTransientError ||
    (error instanceof Error &&
      typeof (error as NodeJS.ErrnoException).code === 'string' &&
      TRANSIENT_TRANSPORT_ERROR_CODES.has((error as NodeJS.ErrnoException).code!))
  ) {
    return { code: 'runtime.unavailable', retryable: true };
  }
  if (error instanceof RuntimeResponseError) {
    if (
      error.code === ErrorCode.PROTOCOL_AUTH_REJECTED ||
      error.code === ErrorCode.PROVIDER_AUTH_FAILED
    ) {
      return { code: 'runtime.authentication-failed', retryable: false };
    }
    if (error.code.startsWith('protocol.')) {
      return { code: 'runtime.protocol-error', retryable: false };
    }
    if (error.code.startsWith('approval.') || error.code.startsWith('security.')) {
      return { code: 'runtime.permission-denied', retryable: false };
    }
    return { code: 'runtime.request-rejected', retryable: false };
  }
  return { code: 'runtime.request-rejected', retryable: false };
}

export class RuntimePipeClient {
  private socket: Socket | null = null;
  private authenticatedSocket: Socket | null = null;
  private connecting: Promise<void> | null = null;
  private pendingBytes: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly subscriptions = new Set<EventSubscription>();
  private readonly streamSubscriptions = new Map<string, EventSubscription>();
  private readonly pendingStreamEvents = new Map<string, Event[]>();
  private readonly transientSubscriptions = new Set<TransientSubscription>();
  private readonly transientStreamSubscriptions = new Map<string, TransientSubscription>();
  private readonly pendingTransientFrames = new Map<string, ConversationTransientFrame[]>();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;

  constructor(private readonly options: RuntimePipeClientOptions) {}

  connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    if (this.socket && !this.socket.destroyed) return Promise.resolve();
    if (this.socket?.destroyed) {
      this.handleDisconnect(this.socket, new RuntimeTransientError('Runtime connection closed'));
    }
    this.clearReconnectTimer();
    let retryable = true;
    this.connecting = this.openConnection()
      .catch((error: unknown) => {
        retryable = isRetryableConnectionError(error);
        throw error;
      })
      .finally(() => {
        this.connecting = null;
        if (!this.socket && retryable && this.hasSubscriptions()) this.scheduleReconnect();
      });
    return this.connecting;
  }

  async request<T = unknown>(
    type: CommandType,
    payload: unknown,
    options?: { timeoutMs?: number },
  ): Promise<T> {
    await this.connect();
    return this.sendRequest(type, payload, options?.timeoutMs) as Promise<T>;
  }

  async subscribeEvents(
    afterCursor: number | EventReplayCursor,
    listener: (event: Event) => void,
    categories?: readonly EventCategory[],
    cursorListener?: (cursor: EventReplayCursor) => void,
  ): Promise<() => Promise<void>> {
    const cursor = normalizeEventReplayCursor(afterCursor);
    const response = await this.request<EventStreamStartedPayload>('runtime.subscribeEvents', {
      afterCursor: cursor.sequence,
      afterEventId: cursor.eventId,
      categories: categories ? [...categories] : undefined,
    });
    const subscription: EventSubscription = {
      cursor,
      categories: categories ? [...categories] : undefined,
      listener,
      cursorListener,
      streamId: response.streamId,
      phase: 'catching-up',
      highWatermark: null,
      pendingLiveEvents: [],
    };
    this.subscriptions.add(subscription);
    this.streamSubscriptions.set(response.streamId, subscription);
    try {
      await this.consumeReplay(subscription, response);
    } catch (error) {
      const transportDisconnected = !this.socket || this.socket.destroyed;
      if (transportDisconnected && isRetryableConnectionError(error)) {
        try {
          await this.connect();
          if (this.subscriptions.has(subscription) && subscription.phase === 'live') {
            return () => this.closeSubscription(subscription);
          }
        } catch (reconnectError) {
          await this.closeSubscription(subscription).catch(() => undefined);
          throw reconnectError;
        }
      }
      await this.closeSubscription(subscription).catch(() => undefined);
      throw error;
    }

    return () => this.closeSubscription(subscription);
  }

  async subscribeConversationTransientStream(
    threadId: string,
    afterStreamSequence: number,
    listener: (frame: ConversationTransientFrame) => void,
    snapshotListener?: (
      latestStreamSequence: number,
      snapshot: ConversationTransientSnapshot | undefined,
    ) => void,
  ): Promise<() => Promise<void>> {
    await this.connect();
    const subscription: TransientSubscription = {
      threadId,
      afterStreamSequence,
      listener,
      snapshotListener,
      streamId: null,
      phase: 'catching-up',
      pendingLiveFrames: [],
    };
    this.transientSubscriptions.add(subscription);
    try {
      await this.openTransientSubscription(subscription);
    } catch (error) {
      const transportDisconnected = !this.socket || this.socket.destroyed;
      if (transportDisconnected && isRetryableConnectionError(error)) {
        try {
          await this.connect();
          if (this.transientSubscriptions.has(subscription) && subscription.phase === 'live') {
            return () => this.closeTransientSubscription(subscription);
          }
        } catch (reconnectError) {
          await this.closeTransientSubscription(subscription).catch(() => undefined);
          throw reconnectError;
        }
      }
      await this.closeTransientSubscription(subscription).catch(() => undefined);
      throw error;
    }
    return () => this.closeTransientSubscription(subscription);
  }

  disconnect(): void {
    const socket = this.socket;
    this.socket = null;
    this.authenticatedSocket = null;
    this.pendingBytes = Buffer.alloc(0);
    this.subscriptions.clear();
    this.streamSubscriptions.clear();
    this.pendingStreamEvents.clear();
    this.transientSubscriptions.clear();
    this.transientStreamSubscriptions.clear();
    this.pendingTransientFrames.clear();
    this.clearReconnectTimer();
    this.rejectPending(new RuntimeTransientError('Runtime connection closed'));
    if (socket && !socket.destroyed) socket.destroy();
  }

  private async openConnection(): Promise<void> {
    const socket = connect(pipePathPortable(this.options.installId));
    this.pendingBytes = Buffer.alloc(0);
    this.socket = socket;
    this.resetSubscriptionStreams();
    socket.setNoDelay(true);
    socket.on('data', (chunk: Buffer) => this.handleData(socket, chunk));
    socket.on('error', (error) => this.handleDisconnect(socket, error));
    socket.on('close', () =>
      this.handleDisconnect(socket, new RuntimeTransientError('Runtime connection closed')),
    );

    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('error', reject);
      });

      const nonce = randomBytes(16).toString('hex');
      const hello: Hello = {
        protocolVersion: PROTOCOL_VERSION,
        appVersion: this.options.appVersion,
        installId: this.options.installId,
        nonce,
        features: [...DEFAULT_FEATURES],
      };
      if (this.options.helloSecret) {
        hello.token = computeHmac(this.options.helloSecret, nonce, this.options.installId);
      }
      await this.performHandshake(hello);
      if (this.socket !== socket) throw new RuntimeTransientError('Runtime connection closed');
      this.authenticatedSocket = socket;
      await this.restoreSubscriptions();
      this.reconnectAttempt = 0;
    } catch (error) {
      if (this.socket === socket) {
        this.socket = null;
        this.pendingBytes = Buffer.alloc(0);
        this.resetSubscriptionStreams();
        this.rejectPending(error instanceof Error ? error : new RuntimeTransientError());
      }
      if (!socket.destroyed) socket.destroy();
      throw error;
    }
  }

  private async performHandshake(hello: Hello): Promise<void> {
    let response: unknown;
    try {
      response = await this.sendRequest('__hello', hello);
    } catch (error) {
      if (error instanceof RuntimeResponseError) throw runtimeAuthenticationFailed();
      throw error;
    }
    const secret = this.options.helloSecret;

    if (!secret) {
      if (!isHelloAcceptedPayload(response)) throw runtimeAuthenticationFailed();
      return;
    }

    if (!isHelloChallengePayload(response)) throw runtimeAuthenticationFailed();
    const expectedRuntimeProof = computeRuntimeProof(
      secret,
      hello.nonce,
      response.runtimeNonce,
      this.options.installId,
    );
    if (!verifyHmac(expectedRuntimeProof, response.runtimeToken)) {
      throw runtimeAuthenticationFailed();
    }

    const proof: HelloProofPayload = {
      installId: this.options.installId,
      clientNonce: hello.nonce,
      runtimeNonce: response.runtimeNonce,
      token: computeClientProof(secret, hello.nonce, response.runtimeNonce, this.options.installId),
    };
    let accepted: unknown;
    try {
      accepted = await this.sendRequest('__hello.proof', proof);
    } catch (error) {
      if (error instanceof RuntimeResponseError) throw runtimeAuthenticationFailed();
      throw error;
    }
    if (!isHelloAcceptedPayload(accepted)) throw runtimeAuthenticationFailed();
  }

  private sendRequest(
    type: string,
    payload: unknown,
    timeoutMsOverride?: number,
  ): Promise<unknown> {
    const socket = this.socket;
    if (!socket || socket.destroyed) {
      return Promise.reject(new RuntimeTransientError('Runtime is not connected'));
    }
    const id = `desktop_${ulid()}`;
    // Compact may call the live model for a structured summary — allow far longer than the
    // default 5s IPC budget used for ordinary CRUD.
    const defaultTimeout = resolveRuntimeRequestTimeoutMs(
      type,
      this.options.requestTimeoutMs ?? 5_000,
    );
    const timeoutMs =
      typeof timeoutMsOverride === 'number' && timeoutMsOverride > 0
        ? timeoutMsOverride
        : defaultTimeout;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new RuntimeTransientError(`Runtime request timed out: ${type}`));
      }, timeoutMs);
      this.pendingRequests.set(id, { resolve, reject, timer });
      socket.write(encodeFrame({ id, kind: 'request', type, payload }));
    });
  }

  private handleData(socket: Socket, chunk: Buffer): void {
    if (this.socket !== socket) return;
    try {
      const decoded = decodeFrames(Buffer.concat([this.pendingBytes, chunk]));
      this.pendingBytes = decoded.remaining;
      for (const frame of decoded.frames) this.handleFrame(frame);
    } catch {
      const error =
        this.authenticatedSocket === socket
          ? new RuntimeProtocolError()
          : runtimeAuthenticationFailed();
      this.handleDisconnect(socket, error);
      if (!socket.destroyed) socket.destroy();
    }
  }

  private handleFrame(frame: Frame): void {
    if (frame.kind === 'event' && frame.type === 'runtime.event') {
      const payload = frame.payload as EventStreamEvent;
      const subscription = this.streamSubscriptions.get(payload.streamId);
      if (!subscription) {
        this.pendingStreamEvents.get(payload.streamId)?.push(payload.event);
        return;
      }
      if (subscription.phase === 'catching-up') {
        subscription.pendingLiveEvents.push(payload.event);
        return;
      }
      try {
        this.deliverEvent(subscription, payload.event);
      } catch {
        console.error('[desktop] runtime event listener failed');
        void this.closeSubscription(subscription).catch(() => undefined);
      }
      return;
    }

    if (frame.kind === 'event' && frame.type === 'conversation.transientFrame') {
      const payload = frame.payload as ConversationTransientStreamEvent;
      const subscription = this.transientStreamSubscriptions.get(payload.streamId);
      if (!subscription) {
        this.pendingTransientFrames.get(payload.streamId)?.push(payload.frame);
        return;
      }
      if (subscription.phase === 'catching-up') {
        subscription.pendingLiveFrames.push(payload.frame);
        return;
      }
      try {
        this.deliverTransientFrame(subscription, payload.frame);
      } catch {
        console.error('[desktop] runtime transient listener failed');
        void this.closeTransientSubscription(subscription).catch(() => undefined);
      }
      return;
    }

    const pending = this.pendingRequests.get(frame.id);
    if (!pending) {
      if (
        frame.kind === 'response' &&
        (frame.type === 'runtime.subscribeEvents' ||
          frame.type === 'conversation.subscribeTransientStream') &&
        !frame.error
      ) {
        const streamId = (
          frame.payload as Partial<
            EventStreamStartedPayload | SubscribeConversationTransientStreamResponse
          >
        ).streamId;
        if (typeof streamId === 'string') {
          const unsubscribe =
            frame.type === 'runtime.subscribeEvents'
              ? this.unsubscribeOrphanStream(streamId)
              : this.unsubscribeOrphanTransientStream(streamId);
          void unsubscribe.catch(() => undefined);
        }
      }
      return;
    }

    if (frame.type === 'runtime.subscribeEvents' && !frame.error) {
      const streamId = (frame.payload as Partial<EventStreamStartedPayload>).streamId;
      if (typeof streamId === 'string') this.pendingStreamEvents.set(streamId, []);
    }
    if (frame.type === 'conversation.subscribeTransientStream' && !frame.error) {
      const streamId = (frame.payload as Partial<SubscribeConversationTransientStreamResponse>)
        .streamId;
      if (typeof streamId === 'string') this.pendingTransientFrames.set(streamId, []);
    }

    this.pendingRequests.delete(frame.id);
    clearTimeout(pending.timer);
    if (frame.error) {
      pending.reject(new RuntimeResponseError(frame.error.code, frame.error.message));
      return;
    }
    pending.resolve(frame.payload);
  }

  private handleDisconnect(socket: Socket, error: Error): void {
    if (this.socket !== socket) return;
    this.socket = null;
    if (this.authenticatedSocket === socket) this.authenticatedSocket = null;
    this.pendingBytes = Buffer.alloc(0);
    this.resetSubscriptionStreams();
    this.rejectPending(error);
    if (!this.connecting && this.hasSubscriptions() && isRetryableConnectionError(error)) {
      this.scheduleReconnect();
    }
  }

  private resetSubscriptionStreams(): void {
    this.streamSubscriptions.clear();
    this.pendingStreamEvents.clear();
    this.transientStreamSubscriptions.clear();
    this.pendingTransientFrames.clear();
    for (const subscription of this.subscriptions) {
      subscription.streamId = null;
      subscription.phase = 'catching-up';
      subscription.highWatermark = null;
      subscription.pendingLiveEvents = [];
    }
    for (const subscription of this.transientSubscriptions) {
      subscription.streamId = null;
      subscription.phase = 'catching-up';
      subscription.pendingLiveFrames = [];
    }
  }

  private async restoreSubscriptions(): Promise<void> {
    for (const subscription of this.subscriptions) {
      const response = (await this.sendRequest('runtime.subscribeEvents', {
        afterCursor: subscription.cursor.sequence,
        afterEventId: subscription.cursor.eventId,
        categories: subscription.categories,
      })) as EventStreamStartedPayload;
      if (!this.subscriptions.has(subscription)) {
        if (typeof response.streamId === 'string') {
          await this.unsubscribeOrphanStream(response.streamId).catch(() => undefined);
        }
        continue;
      }
      subscription.streamId = response.streamId;
      this.streamSubscriptions.set(response.streamId, subscription);
      try {
        await this.consumeReplay(subscription, response);
      } catch (error) {
        const transportDisconnected = !this.socket || this.socket.destroyed;
        if (transportDisconnected && isRetryableConnectionError(error)) throw error;
        console.error('[desktop] runtime event listener failed');
        await this.closeSubscription(subscription).catch(() => undefined);
      }
    }
    for (const subscription of this.transientSubscriptions) {
      try {
        await this.openTransientSubscription(subscription);
      } catch (error) {
        const transportDisconnected = !this.socket || this.socket.destroyed;
        if (transportDisconnected && isRetryableConnectionError(error)) throw error;
        console.error('[desktop] runtime transient listener failed');
        await this.closeTransientSubscription(subscription).catch(() => undefined);
      }
    }
  }

  private async openTransientSubscription(subscription: TransientSubscription): Promise<void> {
    if (!this.transientSubscriptions.has(subscription)) return;
    const response = (await this.sendRequest('conversation.subscribeTransientStream', {
      threadId: subscription.threadId,
      afterStreamSequence: subscription.afterStreamSequence,
    })) as SubscribeConversationTransientStreamResponse;
    if (!this.transientSubscriptions.has(subscription)) {
      if (typeof response.streamId === 'string') {
        await this.unsubscribeOrphanTransientStream(response.streamId).catch(() => undefined);
      }
      return;
    }
    this.commitTransientSubscription(subscription, response);
  }

  private commitTransientSubscription(
    subscription: TransientSubscription,
    response: SubscribeConversationTransientStreamResponse,
  ): void {
    if (
      typeof response.streamId !== 'string' ||
      !response.streamId ||
      response.threadId !== subscription.threadId ||
      !Number.isSafeInteger(response.latestStreamSequence) ||
      response.latestStreamSequence < 0 ||
      typeof response.resetRequired !== 'boolean' ||
      !Array.isArray(response.replayedFrames)
    ) {
      throw new RuntimeProtocolError();
    }
    if (response.snapshot !== undefined && !isConversationTransientSnapshot(response.snapshot)) {
      throw new RuntimeProtocolError();
    }
    subscription.streamId = response.streamId;
    subscription.phase = 'catching-up';
    this.transientStreamSubscriptions.set(response.streamId, subscription);

    if (response.resetRequired) {
      // The replay is explicitly incomplete. Drop it and resume at the Runtime's
      // latest cursor; callers rebuild their draft from the durable message/event
      // fallback, while pending live frames beyond this watermark still apply.
      subscription.afterStreamSequence = response.latestStreamSequence;
      subscription.snapshotListener?.(response.latestStreamSequence, response.snapshot);
    } else {
      for (const transientFrame of response.replayedFrames) {
        this.deliverTransientFrame(subscription, transientFrame);
      }
    }
    if (subscription.afterStreamSequence !== response.latestStreamSequence) {
      throw new RuntimeProtocolError();
    }
    const beforeMapping = this.pendingTransientFrames.get(response.streamId) ?? [];
    this.pendingTransientFrames.delete(response.streamId);
    const liveFrames = [...beforeMapping, ...subscription.pendingLiveFrames].sort(
      (left, right) => left.streamSequence - right.streamSequence,
    );
    subscription.pendingLiveFrames = [];
    subscription.phase = 'live';
    for (const transientFrame of liveFrames)
      this.deliverTransientFrame(subscription, transientFrame);
  }

  private deliverTransientFrame(
    subscription: TransientSubscription,
    transientFrame: ConversationTransientFrame,
  ): void {
    if (
      transientFrame.threadId !== subscription.threadId ||
      !Number.isSafeInteger(transientFrame.streamSequence) ||
      transientFrame.streamSequence < 1
    ) {
      throw new RuntimeProtocolError();
    }
    if (transientFrame.streamSequence <= subscription.afterStreamSequence) return;
    if (transientFrame.streamSequence !== subscription.afterStreamSequence + 1) {
      throw new RuntimeProtocolError();
    }
    subscription.listener(transientFrame);
    subscription.afterStreamSequence = transientFrame.streamSequence;
  }

  private async closeSubscription(subscription: EventSubscription): Promise<void> {
    if (!this.subscriptions.delete(subscription)) return;
    const streamId = subscription.streamId;
    subscription.streamId = null;
    if (streamId) {
      this.streamSubscriptions.delete(streamId);
      this.pendingStreamEvents.delete(streamId);
    }
    subscription.pendingLiveEvents = [];
    if (!this.hasSubscriptions()) this.clearReconnectTimer();
    if (!streamId || !this.socket || this.socket.destroyed) return;
    await this.sendRequest('runtime.unsubscribeEvents', { streamId });
  }

  private async unsubscribeOrphanStream(streamId: string): Promise<void> {
    if (!this.socket || this.socket.destroyed) return;
    await this.sendRequest('runtime.unsubscribeEvents', { streamId });
  }

  private async closeTransientSubscription(subscription: TransientSubscription): Promise<void> {
    if (!this.transientSubscriptions.delete(subscription)) return;
    const streamId = subscription.streamId;
    subscription.streamId = null;
    if (streamId) {
      this.transientStreamSubscriptions.delete(streamId);
      this.pendingTransientFrames.delete(streamId);
    }
    subscription.pendingLiveFrames = [];
    if (!this.hasSubscriptions()) this.clearReconnectTimer();
    if (!streamId || !this.socket || this.socket.destroyed) return;
    await this.sendRequest('conversation.unsubscribeTransientStream', { streamId });
  }

  private async unsubscribeOrphanTransientStream(streamId: string): Promise<void> {
    if (!this.socket || this.socket.destroyed) return;
    await this.sendRequest('conversation.unsubscribeTransientStream', { streamId });
  }

  private hasSubscriptions(): boolean {
    return this.subscriptions.size > 0 || this.transientSubscriptions.size > 0;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.hasSubscriptions()) return;
    const baseDelay = this.options.reconnectDelayMs ?? 250;
    const delay = baseDelay * Math.min(2 ** this.reconnectAttempt, 8);
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch(() => undefined);
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private async consumeReplay(
    subscription: EventSubscription,
    firstPage: EventStreamStartedPayload,
  ): Promise<void> {
    let page: EventReplayPagePayload = firstPage;
    while (true) {
      this.commitReplayPage(subscription, page);
      if (page.replayComplete) {
        this.finishReplay(subscription);
        return;
      }
      if (!subscription.streamId) {
        throw new RuntimeTransientError('Runtime connection closed');
      }
      page = (await this.sendRequest('runtime.continueEventReplay', {
        streamId: subscription.streamId,
        afterCursor: subscription.cursor.sequence,
        afterEventId: subscription.cursor.eventId,
      })) as EventReplayPagePayload;
    }
  }

  private commitReplayPage(subscription: EventSubscription, page: EventReplayPagePayload): void {
    if (
      !Number.isSafeInteger(page.nextCursor) ||
      page.nextCursor < 0 ||
      !Number.isSafeInteger(page.highWatermark) ||
      page.highWatermark < 0 ||
      typeof page.replayComplete !== 'boolean' ||
      !Array.isArray(page.replayedEvents) ||
      (page.nextEventId !== undefined && typeof page.nextEventId !== 'string') ||
      (page.highWatermarkEventId !== undefined && typeof page.highWatermarkEventId !== 'string')
    ) {
      throw new RuntimeProtocolError();
    }
    const nextCursor = this.pageCursor(page);
    const highWatermark = {
      sequence: page.highWatermark,
      eventId:
        typeof page.highWatermarkEventId === 'string'
          ? page.highWatermarkEventId
          : page.replayComplete && page.highWatermark === nextCursor.sequence
            ? nextCursor.eventId
            : undefined,
    };
    if (
      !subscription.streamId ||
      page.streamId !== subscription.streamId ||
      !Number.isSafeInteger(nextCursor.sequence) ||
      nextCursor.sequence < 0 ||
      !Number.isSafeInteger(highWatermark.sequence) ||
      highWatermark.sequence < 0 ||
      typeof page.replayComplete !== 'boolean' ||
      !Array.isArray(page.replayedEvents) ||
      (page.nextEventId !== undefined && typeof page.nextEventId !== 'string') ||
      (page.highWatermarkEventId !== undefined && typeof page.highWatermarkEventId !== 'string') ||
      compareEventReplayCursors(nextCursor, subscription.cursor) < 0 ||
      nextCursor.sequence > highWatermark.sequence ||
      (highWatermark.eventId !== undefined &&
        compareEventReplayCursors(nextCursor, {
          sequence: highWatermark.sequence,
          eventId: highWatermark.eventId,
        }) > 0) ||
      (page.replayComplete &&
        (nextCursor.sequence !== highWatermark.sequence ||
          (highWatermark.eventId !== undefined && nextCursor.eventId !== highWatermark.eventId))) ||
      (!page.replayComplete &&
        nextCursor.sequence === highWatermark.sequence &&
        (highWatermark.eventId === undefined ||
          compareEventReplayCursors(nextCursor, {
            sequence: highWatermark.sequence,
            eventId: highWatermark.eventId,
          }) >= 0))
    ) {
      throw new RuntimeProtocolError();
    }
    if (subscription.highWatermark === null) {
      subscription.highWatermark = highWatermark;
    } else if (
      subscription.highWatermark.sequence !== highWatermark.sequence ||
      (subscription.highWatermark.eventId !== undefined &&
        highWatermark.eventId !== undefined &&
        subscription.highWatermark.eventId !== highWatermark.eventId)
    ) {
      throw new RuntimeProtocolError();
    } else if (
      subscription.highWatermark.eventId === undefined &&
      highWatermark.eventId !== undefined
    ) {
      subscription.highWatermark.eventId = highWatermark.eventId;
    }

    let previousCursor = subscription.cursor;
    for (const event of page.replayedEvents) {
      const eventCursor = cursorForEvent(event);
      if (
        !Number.isSafeInteger(eventCursor.sequence) ||
        eventCursor.sequence < 0 ||
        compareEventReplayCursors(eventCursor, previousCursor) <= 0 ||
        compareEventReplayCursors(eventCursor, nextCursor) > 0
      ) {
        throw new RuntimeProtocolError();
      }
      subscription.listener(event);
      previousCursor = eventCursor;
    }
    subscription.cursor = nextCursor;
    subscription.cursorListener?.({ ...nextCursor });
  }

  private pageCursor(page: EventReplayPagePayload): EventReplayCursor {
    if (typeof page.nextEventId === 'string') {
      return { sequence: page.nextCursor, eventId: page.nextEventId };
    }
    for (let index = page.replayedEvents.length - 1; index >= 0; index--) {
      const event = page.replayedEvents[index];
      if (event && event.sequence === page.nextCursor) return cursorForEvent(event);
    }
    return { sequence: page.nextCursor, eventId: '' };
  }

  private finishReplay(subscription: EventSubscription): void {
    if (
      !subscription.streamId ||
      !subscription.highWatermark ||
      subscription.highWatermark.sequence !== subscription.cursor.sequence ||
      (subscription.highWatermark.eventId !== undefined &&
        subscription.highWatermark.eventId !== subscription.cursor.eventId)
    ) {
      throw new RuntimeProtocolError();
    }
    const beforeMapping = this.pendingStreamEvents.get(subscription.streamId) ?? [];
    this.pendingStreamEvents.delete(subscription.streamId);
    const liveEvents = [...beforeMapping, ...subscription.pendingLiveEvents].sort((left, right) =>
      compareEventReplayCursors(cursorForEvent(left), cursorForEvent(right)),
    );
    subscription.pendingLiveEvents = [];
    subscription.phase = 'live';
    for (const event of liveEvents) this.deliverEvent(subscription, event);
  }

  private deliverEvent(subscription: EventSubscription, event: Event): void {
    const eventCursor = cursorForEvent(event);
    if (compareEventReplayCursors(eventCursor, subscription.cursor) <= 0) return;
    subscription.listener(event);
    subscription.cursor = eventCursor;
    subscription.cursorListener?.({ ...eventCursor });
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}
