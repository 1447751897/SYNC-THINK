import type { ExternalEventEnvelope, ExternalEventRecord } from '@sync-think/shared';
import type { Frame } from '@sync-think/protocol';
import { describe, expect, it } from 'vitest';
import {
  encodeExternalEventAck,
  encodeExternalEventComplete,
  encodeExternalEventDispatch,
  encodeExternalEventHeartbeat,
  encodeExternalEventStatusQuery,
  encodeExternalEventSubmit,
  parseExternalEventFrame,
} from '../src/daemon/external-event-protocol.js';

function envelope(overrides: Partial<ExternalEventEnvelope> = {}): ExternalEventEnvelope {
  return {
    id: 'evt-1',
    dedupeKey: 'github:delivery-123',
    source: { kind: 'git', name: 'github' },
    instruction: '检查 push 并总结风险',
    target: { kind: 'model', modelId: 'model-1' },
    workspaceId: 'workspace-1',
    skillVersionIds: ['skill-1'],
    metadata: { ref: 'refs/heads/main' },
    ...overrides,
  };
}

function leasedRecord(): ExternalEventRecord {
  return {
    ...envelope(),
    state: 'leased',
    attemptCount: 2,
    leaseOwner: 'daemon-1',
    leaseToken: 'lease-1',
    leaseExpiresAt: '2026-08-21T00:01:00.000Z',
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:30.000Z',
  };
}

describe('external event protocol', () => {
  it('round-trips a producer submission through the whitelist parser', () => {
    const encoded = encodeExternalEventSubmit(envelope());
    const parsed = parseExternalEventFrame({
      ...encoded,
      payload: { ...(encoded.payload as object), ignoredFutureField: true },
    });

    expect(parsed).toEqual({
      ok: true,
      frame: { type: 'external.event.submit', payload: envelope() },
    });
  });

  it('dispatches only a currently leased record with its fencing token', () => {
    const parsed = parseExternalEventFrame(encodeExternalEventDispatch(leasedRecord()));
    expect(parsed).toMatchObject({
      ok: true,
      frame: {
        type: 'external.event.dispatch',
        payload: {
          event: { id: 'evt-1', dedupeKey: 'github:delivery-123' },
          leaseToken: 'lease-1',
          leaseExpiresAt: '2026-08-21T00:01:00.000Z',
          attemptCount: 2,
        },
      },
    });
  });

  it('round-trips ack, heartbeat and terminal completion frames', () => {
    const frames = [
      encodeExternalEventAck({
        eventId: 'evt-1',
        leaseToken: 'lease-1',
        accepted: true,
        runId: 'run-1',
      }),
      encodeExternalEventHeartbeat({
        eventId: 'evt-1',
        leaseToken: 'lease-1',
        runId: 'run-1',
      }),
      encodeExternalEventComplete({
        eventId: 'evt-1',
        leaseToken: 'lease-1',
        runId: 'run-1',
        status: 'success',
      }),
    ];

    expect(frames.map((frame) => parseExternalEventFrame(frame))).toEqual(
      frames.map((frame) => ({
        ok: true,
        frame: { type: frame.type, payload: frame.payload },
      })),
    );
  });

  it('encodes and parses a status lookup by event id', () => {
    const frame = encodeExternalEventStatusQuery({ eventId: 'evt-1' });
    expect(parseExternalEventFrame(frame)).toEqual({
      ok: true,
      frame: { type: 'external.event.status', payload: { eventId: 'evt-1' } },
    });
  });

  it('rejects malformed targets, oversized metadata and missing lease tokens', () => {
    const malformed: Frame[] = [
      {
        id: 'bad-target',
        kind: 'request',
        type: 'external.event.submit',
        payload: { ...envelope(), target: { kind: 'unknown' } },
      },
      {
        id: 'large',
        kind: 'request',
        type: 'external.event.submit',
        payload: { ...envelope(), metadata: { value: 'x'.repeat(70_000) } },
      },
      {
        id: 'no-token',
        kind: 'request',
        type: 'external.event.heartbeat',
        payload: { eventId: 'evt-1' },
      },
      {
        id: 'secret-metadata',
        kind: 'request',
        type: 'external.event.submit',
        payload: { ...envelope(), metadata: { nested: { access_token: 'plain-secret' } } },
      },
    ];

    for (const frame of malformed) expect(parseExternalEventFrame(frame).ok).toBe(false);
  });
});
