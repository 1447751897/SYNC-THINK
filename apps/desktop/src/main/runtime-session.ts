import type {
  CommandType,
  ConversationTransientFrame,
  ConversationTransientSnapshot,
  EventReplayCursor,
} from '@sync-think/protocol';
import type { Event, EventCategory } from '@sync-think/shared';
import { mergeEventHistory } from '../event-history.js';
import type { RuntimeConnectResult, RuntimeHealth } from '../runtime-bridge-contract.js';

const REDACTED = '[REDACTED]';
const SAFE_SECRET_METADATA_KEYS = new Set([
  'hassecret',
  'secretcount',
  'secretlikeevidence',
  'secretsok',
  'tokencount',
  'tokenestimate',
  'tokensin',
  'tokensout',
]);

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (SAFE_SECRET_METADATA_KEYS.has(normalized)) return false;
  return (
    normalized === 'apikey' ||
    normalized.endsWith('apikey') ||
    normalized.includes('authorization') ||
    normalized === 'password' ||
    normalized.endsWith('password') ||
    normalized.includes('secret') ||
    normalized === 'token' ||
    normalized.endsWith('token') ||
    normalized.includes('privatekey') ||
    normalized === 'cookie' ||
    normalized === 'setcookie' ||
    normalized.endsWith('sessioncookie') ||
    normalized === 'credential' ||
    normalized === 'credentials' ||
    normalized === 'credentialvalue' ||
    normalized === 'storehandle'
  );
}

function scrubSecretText(value: string): string {
  return value
    .replace(
      /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)* PRIVATE KEY-----/gi,
      REDACTED,
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, `Bearer ${REDACTED}`)
    .replace(/\bsk-(?:ant-)?[A-Za-z0-9_-]{12,}\b/gi, REDACTED)
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, REDACTED)
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, REDACTED)
    .replace(/\bAKIA[A-Z0-9]{16}\b/g, REDACTED)
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(
      /((?:api[_-]?key|auth[_-]?token|session[_-]?token|id[_-]?token|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|secret[_-]?value|password|secret|cookie)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      `$1${REDACTED}`,
    );
}

function scrubRendererValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return scrubSecretText(value);
  if (Array.isArray(value)) return value.map((item) => scrubRendererValue(item, seen));
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return REDACTED;
  seen.add(value);
  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    sanitized[key] = isSensitiveKey(key) ? REDACTED : scrubRendererValue(nestedValue, seen);
  }
  seen.delete(value);
  return sanitized;
}

export function sanitizeRuntimeEventForRenderer(event: Event): Event {
  return {
    ...event,
    payload: scrubRendererValue(event.payload, new WeakSet()) as Record<string, unknown>,
  };
}

export interface RuntimeSessionClient {
  connect(): Promise<void>;
  subscribeEvents(
    afterCursor: EventReplayCursor,
    listener: (event: Event) => void,
    categories?: readonly EventCategory[],
    cursorListener?: (cursor: EventReplayCursor) => void,
  ): Promise<() => Promise<void>>;
  subscribeConversationTransientStream?(
    threadId: string,
    afterStreamSequence: number,
    listener: (frame: ConversationTransientFrame) => void,
    snapshotListener?: (
      latestStreamSequence: number,
      snapshot: ConversationTransientSnapshot | undefined,
    ) => void,
  ): Promise<() => Promise<void>>;
  request<T = unknown>(type: CommandType, payload: unknown): Promise<T>;
}

export interface RuntimeActivityCursorStore {
  load(): EventReplayCursor;
  save(cursor: EventReplayCursor): void;
}

const EMPTY_ACTIVITY_CURSOR_STORE: RuntimeActivityCursorStore = {
  load: () => ({ sequence: 0, eventId: '' }),
  save: () => undefined,
};

const ACTIVITY_EVENT_CATEGORIES = ['message', 'run'] as const satisfies readonly EventCategory[];
const MAX_ACTIVITY_EVENT_HISTORY = 2_048;

export class RuntimeSession {
  private eventHistory: Event[] = [];
  /** O(1) dedupe for event sequences — avoids O(n) scans on every replay event. */
  private seenEventIds = new Set<string>();
  private runtimeSubscription: Promise<() => Promise<void>> | null = null;
  private readonly transientSubscriptions = new Map<
    string,
    { senderId: number; unsubscribe: () => Promise<void> }
  >();

  constructor(
    private readonly client: RuntimeSessionClient,
    private readonly forwardEvent: (event: Event) => void,
    private readonly activityCursorStore: RuntimeActivityCursorStore = EMPTY_ACTIVITY_CURSOR_STORE,
  ) {}

  /**
   * Fast connect for UI startup:
   * 1) pipe + hello
   * 2) healthcheck
   * 3) return immediately with whatever snapshot is already buffered
   *
   * Full event replay continues in the background. Waiting for complete
   * catch-up here made cold start feel empty for a long time when the DB
   * already had a large event log.
   */
  async connect(): Promise<RuntimeConnectResult> {
    await this.client.connect();
    // Kick off catch-up without blocking the first UI paint / listConversations.
    void this.ensureSubscription().catch((error) => {
      console.warn('[desktop] runtime event subscription failed', error);
      if (this.runtimeSubscription) this.runtimeSubscription = null;
    });
    const health = sanitizeRuntimeHealth(
      await this.client.request<RuntimeHealth>('runtime.healthcheck', {}),
    );
    return { health, snapshot: [...this.eventHistory] };
  }

  private async ensureSubscription(): Promise<void> {
    let subscription = this.runtimeSubscription;
    if (!subscription) {
      const persistedCursor = this.activityCursorStore.load();
      const afterCursor =
        Number.isSafeInteger(persistedCursor.sequence) &&
        persistedCursor.sequence >= 0 &&
        typeof persistedCursor.eventId === 'string'
          ? persistedCursor
          : { sequence: 0, eventId: '' };
      subscription = this.client.subscribeEvents(
        afterCursor,
        (event) => this.recordEvent(event),
        ACTIVITY_EVENT_CATEGORIES,
        (cursor) => this.saveActivityCursor(cursor),
      );
      this.runtimeSubscription = subscription;
    }
    try {
      await subscription;
    } catch (error) {
      if (this.runtimeSubscription === subscription) this.runtimeSubscription = null;
      throw error;
    }
  }

  async subscribeConversationTransientStream(input: {
    senderId: number;
    subscriptionId: string;
    threadId: string;
    afterStreamSequence?: number;
    listener: (frame: ConversationTransientFrame) => void;
    snapshotListener?: (
      latestStreamSequence: number,
      snapshot: ConversationTransientSnapshot | undefined,
    ) => void;
  }): Promise<void> {
    if (!this.client.subscribeConversationTransientStream) {
      throw new Error('Runtime client does not support transient conversation streams');
    }
    await this.unsubscribeConversationTransientStream(input.senderId, input.subscriptionId);
    const key = this.transientSubscriptionKey(input.senderId, input.subscriptionId);
    const unsubscribe = await this.client.subscribeConversationTransientStream(
      input.threadId,
      input.afterStreamSequence ?? 0,
      input.listener,
      input.snapshotListener,
    );
    this.transientSubscriptions.set(key, { senderId: input.senderId, unsubscribe });
  }

  async unsubscribeConversationTransientStream(
    senderId: number,
    subscriptionId: string,
  ): Promise<void> {
    const key = this.transientSubscriptionKey(senderId, subscriptionId);
    const existing = this.transientSubscriptions.get(key);
    if (!existing) return;
    this.transientSubscriptions.delete(key);
    await existing.unsubscribe().catch(() => undefined);
  }

  async unsubscribeConversationTransientStreamsForSender(senderId: number): Promise<void> {
    const matching = [...this.transientSubscriptions.entries()].filter(
      ([, subscription]) => subscription.senderId === senderId,
    );
    for (const [key, subscription] of matching) {
      this.transientSubscriptions.delete(key);
      await subscription.unsubscribe().catch(() => undefined);
    }
  }

  private transientSubscriptionKey(senderId: number, subscriptionId: string): string {
    return `${senderId}:${subscriptionId}`;
  }

  private recordEvent(event: Event): void {
    const eventId = String(event.id);
    if (this.seenEventIds.has(eventId)) return;
    this.seenEventIds.add(eventId);
    const sanitizedEvent = sanitizeRuntimeEventForRenderer(event);
    // Sequential append is the common path during replay; avoid full re-merge.
    const last = this.eventHistory[this.eventHistory.length - 1];
    if (!last || sanitizedEvent.sequence > last.sequence) {
      this.eventHistory.push(sanitizedEvent);
    } else {
      this.eventHistory = mergeEventHistory(this.eventHistory, [sanitizedEvent]);
    }
    if (this.eventHistory.length > MAX_ACTIVITY_EVENT_HISTORY) {
      const removed = this.eventHistory.splice(
        0,
        this.eventHistory.length - MAX_ACTIVITY_EVENT_HISTORY,
      );
      for (const staleEvent of removed) this.seenEventIds.delete(String(staleEvent.id));
    }
    try {
      this.forwardEvent(sanitizedEvent);
    } catch {
      console.warn('[desktop] runtime event forwarding failed');
    }
  }

  private saveActivityCursor(cursor: EventReplayCursor): void {
    if (
      !Number.isSafeInteger(cursor.sequence) ||
      cursor.sequence < 0 ||
      typeof cursor.eventId !== 'string'
    ) {
      return;
    }
    try {
      this.activityCursorStore.save(cursor);
    } catch {
      console.warn('[desktop] runtime activity cursor persistence failed');
    }
  }
}

function sanitizeRuntimeHealth(health: RuntimeHealth): RuntimeHealth {
  if (health.ok) return health;
  return { ok: false, error: { code: health.error.code } };
}
