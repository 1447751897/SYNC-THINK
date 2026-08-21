import type { Frame } from '@sync-think/protocol';
import type {
  ExternalEventEnvelope,
  ExternalEventRecord,
  ExternalEventTerminalStatus,
  ScheduledTaskTarget,
} from '@sync-think/shared';

const MAX_ID_LENGTH = 512;
const MAX_INSTRUCTION_LENGTH = 100_000;
const MAX_METADATA_BYTES = 64 * 1024;
const MAX_SKILLS = 128;
const SENSITIVE_METADATA_KEY = /^(authorization|proxy-authorization|token|access_token|refresh_token|secret|password|cookie|set-cookie|signature|api[-_]?key)$/i;

export interface ExternalEventDispatchPayload {
  event: ExternalEventEnvelope;
  leaseToken: string;
  leaseExpiresAt: string;
  attemptCount: number;
}

export interface ExternalEventAckPayload {
  eventId: string;
  leaseToken: string;
  accepted: boolean;
  runId?: string;
  reason?: string;
}

export interface ExternalEventHeartbeatPayload {
  eventId: string;
  leaseToken: string;
  runId?: string;
}

export interface ExternalEventCompletePayload {
  eventId: string;
  leaseToken: string;
  status: ExternalEventTerminalStatus;
  runId?: string;
  reason?: string;
}

export type ExternalEventStatusQueryPayload =
  | { eventId: string; dedupeKey?: never }
  | { eventId?: never; dedupeKey: string };

export type ExternalEventFrame =
  | { type: 'external.event.submit'; payload: ExternalEventEnvelope }
  | { type: 'external.event.dispatch'; payload: ExternalEventDispatchPayload }
  | { type: 'external.event.ack'; payload: ExternalEventAckPayload }
  | { type: 'external.event.heartbeat'; payload: ExternalEventHeartbeatPayload }
  | { type: 'external.event.complete'; payload: ExternalEventCompletePayload }
  | { type: 'external.event.status'; payload: ExternalEventStatusQueryPayload };

export type ParseExternalEventFrameResult =
  | { ok: true; frame: ExternalEventFrame }
  | { ok: false; error: string };

function boundedString(value: unknown, max = MAX_ID_LENGTH): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function parseTarget(value: unknown): ScheduledTaskTarget | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.kind === 'model' && boundedString(raw.modelId)) {
    return { kind: 'model', modelId: raw.modelId };
  }
  if (raw.kind === 'agent' && boundedString(raw.agentId)) {
    return { kind: 'agent', agentId: raw.agentId };
  }
  if (raw.kind === 'team' && boundedString(raw.teamId)) {
    return { kind: 'team', teamId: raw.teamId };
  }
  return undefined;
}

function parseMetadata(value: unknown): Record<string, unknown> | undefined | null {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_METADATA_BYTES) return null;
  } catch {
    return null;
  }
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    for (const [key, nested] of Object.entries(current as Record<string, unknown>)) {
      if (SENSITIVE_METADATA_KEY.test(key)) return null;
      stack.push(nested);
    }
  }
  return value as Record<string, unknown>;
}

function parseEnvelope(value: unknown): ExternalEventEnvelope | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (!boundedString(raw.id) || !boundedString(raw.dedupeKey)) return undefined;
  if (!boundedString(raw.instruction, MAX_INSTRUCTION_LENGTH)) return undefined;
  if (!raw.source || typeof raw.source !== 'object' || Array.isArray(raw.source)) return undefined;
  const source = raw.source as Record<string, unknown>;
  if (
    source.kind !== 'webhook' &&
    source.kind !== 'file' &&
    source.kind !== 'git' &&
    source.kind !== 'bot' &&
    source.kind !== 'async'
  ) {
    return undefined;
  }
  if (source.name !== undefined && !boundedString(source.name, 120)) return undefined;
  const target = parseTarget(raw.target);
  if (!target) return undefined;
  if (
    !Array.isArray(raw.skillVersionIds) ||
    raw.skillVersionIds.length > MAX_SKILLS ||
    !raw.skillVersionIds.every((item) => boundedString(item, 256))
  ) {
    return undefined;
  }
  if (raw.workspaceId !== undefined && !boundedString(raw.workspaceId)) return undefined;
  if (raw.conversationKey !== undefined && !boundedString(raw.conversationKey)) return undefined;
  if (raw.title !== undefined && !boundedString(raw.title, 200)) return undefined;
  const metadata = parseMetadata(raw.metadata);
  if (metadata === null) return undefined;
  return {
    id: raw.id,
    dedupeKey: raw.dedupeKey,
    source: {
      kind: source.kind,
      ...(source.name !== undefined ? { name: source.name } : {}),
    },
    instruction: raw.instruction,
    target,
    ...(raw.workspaceId !== undefined ? { workspaceId: raw.workspaceId } : {}),
    skillVersionIds: [...raw.skillVersionIds] as string[],
    ...(raw.conversationKey !== undefined ? { conversationKey: raw.conversationKey } : {}),
    ...(raw.title !== undefined ? { title: raw.title } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function parseLeaseIdentity(value: unknown): { eventId: string; leaseToken: string } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (!boundedString(raw.eventId) || !boundedString(raw.leaseToken)) return undefined;
  return { eventId: raw.eventId, leaseToken: raw.leaseToken };
}

export function encodeExternalEventSubmit(
  event: ExternalEventEnvelope,
): Frame<ExternalEventEnvelope> {
  return {
    id: `external-submit:${event.id}`,
    kind: 'request',
    type: 'external.event.submit',
    payload: event,
  };
}

export function encodeExternalEventDispatch(
  record: ExternalEventRecord,
): Frame<ExternalEventDispatchPayload> {
  if (!record.leaseToken || !record.leaseExpiresAt || record.state !== 'leased') {
    throw new Error('external_event_not_leased');
  }
  const event: ExternalEventEnvelope = {
    id: record.id,
    dedupeKey: record.dedupeKey,
    source: record.source,
    instruction: record.instruction,
    target: record.target,
    ...(record.workspaceId ? { workspaceId: record.workspaceId } : {}),
    skillVersionIds: record.skillVersionIds,
    ...(record.conversationKey ? { conversationKey: record.conversationKey } : {}),
    ...(record.title ? { title: record.title } : {}),
    ...(record.metadata ? { metadata: record.metadata } : {}),
  };
  return {
    id: `external-dispatch:${record.id}:${record.leaseToken}`,
    kind: 'request',
    type: 'external.event.dispatch',
    payload: {
      event,
      leaseToken: record.leaseToken,
      leaseExpiresAt: record.leaseExpiresAt,
      attemptCount: record.attemptCount,
    },
  };
}

export function encodeExternalEventAck(
  payload: ExternalEventAckPayload,
): Frame<ExternalEventAckPayload> {
  return {
    id: `external-ack:${payload.eventId}:${payload.leaseToken}`,
    kind: 'response',
    type: 'external.event.ack',
    payload,
  };
}

export function encodeExternalEventHeartbeat(
  payload: ExternalEventHeartbeatPayload,
): Frame<ExternalEventHeartbeatPayload> {
  return {
    id: `external-heartbeat:${payload.eventId}:${payload.leaseToken}`,
    kind: 'request',
    type: 'external.event.heartbeat',
    payload,
  };
}

export function encodeExternalEventComplete(
  payload: ExternalEventCompletePayload,
): Frame<ExternalEventCompletePayload> {
  return {
    id: `external-complete:${payload.eventId}:${payload.leaseToken}`,
    kind: 'request',
    type: 'external.event.complete',
    payload,
  };
}

export function encodeExternalEventStatusQuery(
  payload: ExternalEventStatusQueryPayload,
): Frame<ExternalEventStatusQueryPayload> {
  const identity = payload.eventId ?? payload.dedupeKey;
  return {
    id: `external-status:${identity}`,
    kind: 'request',
    type: 'external.event.status',
    payload,
  };
}

export function parseExternalEventFrame(frame: Frame): ParseExternalEventFrameResult {
  if (frame.type === 'external.event.submit') {
    const payload = parseEnvelope(frame.payload);
    return payload
      ? { ok: true, frame: { type: frame.type, payload } }
      : { ok: false, error: 'external.event.submit: invalid payload' };
  }
  if (frame.type === 'external.event.dispatch') {
    if (!frame.payload || typeof frame.payload !== 'object' || Array.isArray(frame.payload)) {
      return { ok: false, error: 'external.event.dispatch: invalid payload' };
    }
    const raw = frame.payload as Record<string, unknown>;
    const event = parseEnvelope(raw.event);
    if (
      !event ||
      !boundedString(raw.leaseToken) ||
      !boundedString(raw.leaseExpiresAt) ||
      !Number.isSafeInteger(raw.attemptCount) ||
      Number(raw.attemptCount) < 1
    ) {
      return { ok: false, error: 'external.event.dispatch: invalid payload' };
    }
    return {
      ok: true,
      frame: {
        type: frame.type,
        payload: {
          event,
          leaseToken: raw.leaseToken,
          leaseExpiresAt: raw.leaseExpiresAt,
          attemptCount: Number(raw.attemptCount),
        },
      },
    };
  }
  if (frame.type === 'external.event.ack') {
    const identity = parseLeaseIdentity(frame.payload);
    const raw = frame.payload as Record<string, unknown> | undefined;
    if (
      !identity ||
      typeof raw?.accepted !== 'boolean' ||
      (raw.runId !== undefined && !boundedString(raw.runId)) ||
      (raw.reason !== undefined && typeof raw.reason !== 'string')
    ) {
      return { ok: false, error: 'external.event.ack: invalid payload' };
    }
    return {
      ok: true,
      frame: {
        type: frame.type,
        payload: {
          ...identity,
          accepted: raw.accepted,
          ...(raw.runId !== undefined ? { runId: raw.runId } : {}),
          ...(raw.reason !== undefined ? { reason: raw.reason } : {}),
        },
      },
    };
  }
  if (frame.type === 'external.event.heartbeat') {
    const identity = parseLeaseIdentity(frame.payload);
    const raw = frame.payload as Record<string, unknown> | undefined;
    if (!identity || (raw?.runId !== undefined && !boundedString(raw.runId))) {
      return { ok: false, error: 'external.event.heartbeat: invalid payload' };
    }
    return {
      ok: true,
      frame: {
        type: frame.type,
        payload: {
          ...identity,
          ...(raw?.runId !== undefined ? { runId: raw.runId } : {}),
        },
      },
    };
  }
  if (frame.type === 'external.event.complete') {
    const identity = parseLeaseIdentity(frame.payload);
    const raw = frame.payload as Record<string, unknown> | undefined;
    if (
      !identity ||
      (raw?.status !== 'success' && raw?.status !== 'failed' && raw?.status !== 'cancelled') ||
      (raw.runId !== undefined && !boundedString(raw.runId)) ||
      (raw.reason !== undefined && typeof raw.reason !== 'string')
    ) {
      return { ok: false, error: 'external.event.complete: invalid payload' };
    }
    return {
      ok: true,
      frame: {
        type: frame.type,
        payload: {
          ...identity,
          status: raw.status,
          ...(raw.runId !== undefined ? { runId: raw.runId } : {}),
          ...(raw.reason !== undefined ? { reason: raw.reason } : {}),
        },
      },
    };
  }
  if (frame.type === 'external.event.status') {
    if (!frame.payload || typeof frame.payload !== 'object' || Array.isArray(frame.payload)) {
      return { ok: false, error: 'external.event.status: invalid payload' };
    }
    const raw = frame.payload as Record<string, unknown>;
    const hasEventId = boundedString(raw.eventId);
    const hasDedupeKey = boundedString(raw.dedupeKey);
    if (hasEventId === hasDedupeKey) {
      return { ok: false, error: 'external.event.status: invalid payload' };
    }
    return {
      ok: true,
      frame: {
        type: frame.type,
        payload: hasEventId ? { eventId: raw.eventId as string } : { dedupeKey: raw.dedupeKey as string },
      },
    };
  }
  return { ok: false, error: `unknown external event frame: ${frame.type}` };
}
