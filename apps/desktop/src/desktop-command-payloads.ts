import type {
  CancelDesktopCommandPayload,
  ContinueDesktopCommandPayload,
  ListWaitingDesktopCommandsPayload,
} from '@sync-think/protocol';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function validId(value: unknown): value is string {
  return (
    typeof value === 'string' && value.trim().length > 0 && value.length <= 256 && !/\s/.test(value)
  );
}

export function parseListWaitingDesktopCommandsPayload(
  value: unknown,
): ListWaitingDesktopCommandsPayload {
  if (value === undefined || value === null) return {};
  if (!isRecord(value) || !hasOnlyKeys(value, ['workspaceId', 'runId'])) {
    throw new Error('Invalid list-waiting-desktop-commands payload');
  }
  if (value.workspaceId !== undefined && !validId(value.workspaceId)) {
    throw new Error('Invalid list-waiting-desktop-commands payload');
  }
  if (value.runId !== undefined && !validId(value.runId)) {
    throw new Error('Invalid list-waiting-desktop-commands payload');
  }
  return {
    ...(typeof value.workspaceId === 'string'
      ? {
          workspaceId: value.workspaceId.trim() as ListWaitingDesktopCommandsPayload['workspaceId'],
        }
      : {}),
    ...(typeof value.runId === 'string'
      ? { runId: value.runId.trim() as ListWaitingDesktopCommandsPayload['runId'] }
      : {}),
  };
}


function validTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function parseDesktopCommandDecisionPayload(
  value: unknown,
  label: string,
): { commandId: string; expectedUpdatedAt: string } {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['commandId', 'expectedUpdatedAt']) ||
    !validId(value.commandId) ||
    !validTimestamp(value.expectedUpdatedAt)
  ) {
    throw new Error(`Invalid ${label} payload`);
  }
  return {
    commandId: value.commandId.trim(),
    expectedUpdatedAt: value.expectedUpdatedAt,
  };
}

export function parseContinueDesktopCommandPayload(
  value: unknown,
): ContinueDesktopCommandPayload {
  return parseDesktopCommandDecisionPayload(value, 'continue-desktop-command');
}

export function parseCancelDesktopCommandPayload(value: unknown): CancelDesktopCommandPayload {
  return parseDesktopCommandDecisionPayload(value, 'cancel-desktop-command');
}
