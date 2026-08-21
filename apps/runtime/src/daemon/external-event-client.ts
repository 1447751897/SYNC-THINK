import { pipePathPortable } from '@sync-think/protocol';
import type { ExternalEventEnvelope, ExternalEventRecord, ExternalEventState } from '@sync-think/shared';
import type { DispatchClientOptions } from './dispatch-client.js';
import {
  encodeExternalEventComplete,
  encodeExternalEventDispatch,
  encodeExternalEventHeartbeat,
  encodeExternalEventSubmit,
  encodeExternalEventStatusQuery,
  parseExternalEventFrame,
  type ExternalEventCompletePayload,
  type ExternalEventHeartbeatPayload,
  type ExternalEventStatusQueryPayload,
} from './external-event-protocol.js';
import { requestAuthenticatedPipe, sendAuthenticatedPipeFrames } from './authenticated-pipe-client.js';
import { daemonPipePath } from './yield.js';

export interface ExternalEventSubmitResult {
  ok: boolean;
  accepted: boolean;
  eventId?: string;
  created?: boolean;
  state?: ExternalEventState;
  reason?: string;
}

export interface ExternalEventDispatchResult {
  ok: boolean;
  accepted: boolean;
  runId?: string;
  reason?: string;
}

export interface ExternalEventStatusResult {
  ok: boolean;
  event?: ExternalEventRecord;
  reason?: string;
}

function pipeOptions(options: DispatchClientOptions, path: string) {
  return {
    path,
    installId: options.installId,
    helloSecret: options.helloSecret,
    appVersion: options.appVersion,
    handshakeTimeoutMs: options.handshakeTimeoutMs,
    timeoutMs: options.timeoutMs,
  };
}

export async function submitExternalEventToDaemon(
  options: DispatchClientOptions,
  event: ExternalEventEnvelope,
): Promise<ExternalEventSubmitResult> {
  const request = encodeExternalEventSubmit(event);
  const result = await requestAuthenticatedPipe(
    pipeOptions(options, daemonPipePath(options.installId)),
    request,
    (frame) => frame.id === request.id && frame.type === 'external.event.submit',
  );
  if (!result.ok || !result.frame) return { ok: false, accepted: false, reason: result.outcome };
  const payload = result.frame.payload as Record<string, unknown> | undefined;
  if (!payload || typeof payload.accepted !== 'boolean') {
    return { ok: false, accepted: false, reason: 'invalid-response' };
  }
  return {
    ok: true,
    accepted: payload.accepted,
    ...(typeof payload.eventId === 'string' ? { eventId: payload.eventId } : {}),
    ...(typeof payload.created === 'boolean' ? { created: payload.created } : {}),
    ...(typeof payload.state === 'string' ? { state: payload.state as ExternalEventState } : {}),
    ...(typeof payload.reason === 'string' ? { reason: payload.reason } : {}),
  };
}

export async function dispatchExternalEventToRuntime(
  options: DispatchClientOptions,
  record: ExternalEventRecord,
): Promise<ExternalEventDispatchResult> {
  const request = encodeExternalEventDispatch(record);
  const result = await requestAuthenticatedPipe(
    pipeOptions(options, pipePathPortable(options.installId)),
    request,
    (frame) => frame.id === request.id && frame.type === 'external.event.ack',
  );
  if (!result.ok || !result.frame) return { ok: false, accepted: false, reason: result.outcome };
  const parsed = parseExternalEventFrame(result.frame);
  if (!parsed.ok || parsed.frame.type !== 'external.event.ack') {
    return { ok: false, accepted: false, reason: 'invalid-ack' };
  }
  return {
    ok: true,
    accepted: parsed.frame.payload.accepted,
    ...(parsed.frame.payload.runId ? { runId: parsed.frame.payload.runId } : {}),
    ...(parsed.frame.payload.reason ? { reason: parsed.frame.payload.reason } : {}),
  };
}

export async function getExternalEventStatusFromDaemon(
  options: DispatchClientOptions,
  query: ExternalEventStatusQueryPayload,
): Promise<ExternalEventStatusResult> {
  const request = encodeExternalEventStatusQuery(query);
  const result = await requestAuthenticatedPipe(
    pipeOptions(options, daemonPipePath(options.installId)),
    request,
    (frame) => frame.id === request.id && frame.type === 'external.event.status',
  );
  if (!result.ok || !result.frame) return { ok: false, reason: result.outcome };
  const payload = result.frame.payload as Record<string, unknown> | undefined;
  if (!payload || payload.event === undefined) return { ok: true };
  if (!payload.event || typeof payload.event !== 'object' || Array.isArray(payload.event)) {
    return { ok: false, reason: 'invalid-response' };
  }
  return { ok: true, event: payload.event as ExternalEventRecord };
}

export function sendExternalEventHeartbeatToDaemon(
  options: DispatchClientOptions,
  payload: ExternalEventHeartbeatPayload,
): Promise<boolean> {
  return sendAuthenticatedPipeFrames(pipeOptions(options, daemonPipePath(options.installId)), [
    encodeExternalEventHeartbeat(payload),
  ]);
}

export function sendExternalEventCompletionToDaemon(
  options: DispatchClientOptions,
  payload: ExternalEventCompletePayload,
): Promise<boolean> {
  return sendAuthenticatedPipeFrames(pipeOptions(options, daemonPipePath(options.installId)), [
    encodeExternalEventComplete(payload),
  ]);
}
