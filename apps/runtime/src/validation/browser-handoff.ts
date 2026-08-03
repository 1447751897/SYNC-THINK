import type {
  CancelBrowserHandoffPayload,
  ContinueBrowserHandoffPayload,
  ListWaitingBrowserHandoffsPayload,
} from '@sync-think/protocol';
import { hasOnlyKeys, isRecord } from './shared.js';

const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 256 && !/\s/.test(value);

export function parseListWaitingBrowserHandoffsPayload(
  value: unknown,
): ListWaitingBrowserHandoffsPayload | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ['workspaceId', 'runId'])) return undefined;
  if (value.workspaceId !== undefined && !validId(value.workspaceId)) return undefined;
  if (value.runId !== undefined && !validId(value.runId)) return undefined;
  return {
    ...(typeof value.workspaceId === 'string'
      ? { workspaceId: value.workspaceId.trim() as ListWaitingBrowserHandoffsPayload['workspaceId'] }
      : {}),
    ...(typeof value.runId === 'string'
      ? { runId: value.runId.trim() as ListWaitingBrowserHandoffsPayload['runId'] }
      : {}),
  };
}

export function parseContinueBrowserHandoffPayload(
  value: unknown,
): ContinueBrowserHandoffPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['handoffId', 'expectedRevision']) ||
    !validId(value.handoffId) ||
    !Number.isSafeInteger(value.expectedRevision) ||
    value.expectedRevision !== 1
  ) {
    return undefined;
  }
  return { handoffId: value.handoffId.trim(), expectedRevision: value.expectedRevision };
}

export function parseCancelBrowserHandoffPayload(
  value: unknown,
): CancelBrowserHandoffPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['handoffId', 'expectedRevision', 'leaseDisposition']) ||
    !validId(value.handoffId) ||
    !Number.isSafeInteger(value.expectedRevision) ||
    value.expectedRevision !== 1 ||
    (value.leaseDisposition !== undefined &&
      value.leaseDisposition !== 'preserve' &&
      value.leaseDisposition !== 'release')
  ) {
    return undefined;
  }
  return {
    handoffId: value.handoffId.trim(),
    expectedRevision: value.expectedRevision,
    ...(value.leaseDisposition ? { leaseDisposition: value.leaseDisposition } : {}),
  };
}
