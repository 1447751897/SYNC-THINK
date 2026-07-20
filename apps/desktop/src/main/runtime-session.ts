import type { CommandType } from '@sync-think/protocol';
import type { Event } from '@sync-think/shared';
import { appendEventHistory } from '../event-history.js';
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
  const { run: _runtimeCheckpoint, ...payload } = event.payload;
  return {
    ...event,
    payload: scrubRendererValue(payload, new WeakSet()) as Record<string, unknown>,
  };
}

export interface RuntimeSessionClient {
  connect(): Promise<void>;
  subscribeEvents(
    afterCursor: number,
    listener: (event: Event) => void,
  ): Promise<() => Promise<void>>;
  request<T = unknown>(type: CommandType, payload: unknown): Promise<T>;
}

export class RuntimeSession {
  private eventHistory: Event[] = [];
  private readonly eventSequences = new Set<number>();
  private runtimeSubscription: Promise<() => Promise<void>> | null = null;

  constructor(
    private readonly client: RuntimeSessionClient,
    private readonly forwardEvent: (event: Event) => void,
  ) {}

  async connect(): Promise<RuntimeConnectResult> {
    await this.client.connect();
    await this.ensureSubscription();
    const health = sanitizeRuntimeHealth(
      await this.client.request<RuntimeHealth>('runtime.healthcheck', {}),
    );
    return { health, snapshot: [...this.eventHistory] };
  }

  private async ensureSubscription(): Promise<void> {
    let subscription = this.runtimeSubscription;
    if (!subscription) {
      subscription = this.client.subscribeEvents(0, (event) => this.recordEvent(event));
      this.runtimeSubscription = subscription;
    }
    try {
      await subscription;
    } catch (error) {
      if (this.runtimeSubscription === subscription) this.runtimeSubscription = null;
      throw error;
    }
  }

  private recordEvent(event: Event): void {
    if (this.eventSequences.has(event.sequence)) return;
    const sanitizedEvent = sanitizeRuntimeEventForRenderer(event);
    this.eventSequences.add(event.sequence);
    this.eventHistory = appendEventHistory(this.eventHistory, [sanitizedEvent]);
    try {
      this.forwardEvent(sanitizedEvent);
    } catch {
      console.warn('[desktop] runtime event forwarding failed');
    }
  }
}

function sanitizeRuntimeHealth(health: RuntimeHealth): RuntimeHealth {
  if (health.ok) return health;
  return { ok: false, error: { code: health.error.code } };
}
