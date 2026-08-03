import type {
  CancelBrowserHandoffPayload,
  ContinueBrowserHandoffPayload,
  ListWaitingBrowserHandoffsPayload,
} from '@sync-think/protocol';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function validId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= 256 &&
    !/\s/.test(value)
  );
}

export function parseListWaitingBrowserHandoffsPayload(
  value: unknown,
): ListWaitingBrowserHandoffsPayload {
  if (value === undefined || value === null) return {};
  if (!isRecord(value) || !hasOnlyKeys(value, ['workspaceId', 'runId'])) {
    throw new Error('Invalid list-waiting-browser-handoffs payload');
  }
  if (value.workspaceId !== undefined && !validId(value.workspaceId)) {
    throw new Error('Invalid list-waiting-browser-handoffs payload');
  }
  if (value.runId !== undefined && !validId(value.runId)) {
    throw new Error('Invalid list-waiting-browser-handoffs payload');
  }
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
): ContinueBrowserHandoffPayload {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['handoffId', 'expectedRevision']) ||
    !validId(value.handoffId) ||
    !Number.isSafeInteger(value.expectedRevision) ||
    value.expectedRevision !== 1
  ) {
    throw new Error('Invalid continue-browser-handoff payload');
  }
  return { handoffId: value.handoffId.trim(), expectedRevision: value.expectedRevision };
}

export function parseCancelBrowserHandoffPayload(value: unknown): CancelBrowserHandoffPayload {
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
    throw new Error('Invalid cancel-browser-handoff payload');
  }
  return {
    handoffId: value.handoffId.trim(),
    expectedRevision: value.expectedRevision,
    ...(value.leaseDisposition ? { leaseDisposition: value.leaseDisposition } : {}),
  };
}
