import type {
  CancelRunPayload,
  OrchestrationRunMutationPayload,
  RunGetGraphPayload,
} from '@sync-think/protocol';
import {
  assertRendererSafeOrchestrationPayload,
  boundedText,
  hasOnlyKeys,
  invalid,
  isRecord,
  taskVersion,
} from './orchestration-payload-validation.js';

export function parseConversationRunCancelPayload(value: unknown): CancelRunPayload {
  if (!isRecord(value)) throw new Error('Invalid cancel-run payload');
  if (typeof value.runId !== 'string' || value.runId.length === 0 || value.runId.length > 256) {
    throw new Error('Invalid cancel-run payload');
  }
  return value as unknown as CancelRunPayload;
}

export function parseRunGraphPayload(value: unknown): RunGetGraphPayload {
  assertRendererSafeOrchestrationPayload(value);
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['workspaceId', 'taskId', 'runId']) ||
    !boundedText(value.workspaceId) ||
    !boundedText(value.taskId) ||
    !boundedText(value.runId)
  ) {
    return invalid('run-graph');
  }
  return value as unknown as RunGetGraphPayload;
}

export function parseRunMutationPayload(value: unknown): OrchestrationRunMutationPayload {
  assertRendererSafeOrchestrationPayload(value);
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['workspaceId', 'taskId', 'runId', 'expectedTaskVersion']) ||
    !boundedText(value.workspaceId) ||
    !boundedText(value.taskId) ||
    !boundedText(value.runId) ||
    !taskVersion(value.expectedTaskVersion)
  ) {
    return invalid('run-mutation');
  }
  return value as unknown as OrchestrationRunMutationPayload;
}
