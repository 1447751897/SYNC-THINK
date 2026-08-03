import type {
  CancelDesktopCommandPayload,
  ContinueDesktopCommandPayload,
  ListWaitingDesktopCommandsPayload,
} from '@sync-think/protocol';
import { hasOnlyKeys, isRecord } from './shared.js';

const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 256 && !/\s/.test(value);

export function parseListWaitingDesktopCommandsPayload(
  value: unknown,
): ListWaitingDesktopCommandsPayload | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ['workspaceId', 'runId'])) return undefined;
  if (value.workspaceId !== undefined && !validId(value.workspaceId)) return undefined;
  if (value.runId !== undefined && !validId(value.runId)) return undefined;
  return {
    ...(typeof value.workspaceId === 'string'
      ? { workspaceId: value.workspaceId.trim() as ListWaitingDesktopCommandsPayload['workspaceId'] }
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
): { commandId: string; expectedUpdatedAt: string } | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ['commandId', 'expectedUpdatedAt'])) {
    return undefined;
  }
  if (!validId(value.commandId) || !validTimestamp(value.expectedUpdatedAt)) return undefined;
  return {
    commandId: value.commandId.trim(),
    expectedUpdatedAt: value.expectedUpdatedAt,
  };
}

export function parseContinueDesktopCommandPayload(
  value: unknown,
): ContinueDesktopCommandPayload | undefined {
  return parseDesktopCommandDecisionPayload(value);
}

export function parseCancelDesktopCommandPayload(
  value: unknown,
): CancelDesktopCommandPayload | undefined {
  return parseDesktopCommandDecisionPayload(value);
}
