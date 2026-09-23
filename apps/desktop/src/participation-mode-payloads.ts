import type { SetParticipationModePayload } from '@sync-think/protocol';
import {
  assertRendererSafeOrchestrationPayload,
  boundedText,
  hasOnlyKeys,
  invalid,
  isRecord,
  taskVersion,
} from './orchestration-payload-validation.js';

const PARTICIPATION_MODES = new Set(['conversation', 'collaboration', 'automatic']);

export function parseModeSetPayload(value: unknown): SetParticipationModePayload {
  assertRendererSafeOrchestrationPayload(value);
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['taskId', 'mode', 'expectedTaskVersion']) ||
    !boundedText(value.taskId) ||
    typeof value.mode !== 'string' ||
    !PARTICIPATION_MODES.has(value.mode) ||
    !taskVersion(value.expectedTaskVersion)
  ) {
    return invalid('mode-set');
  }
  return {
    taskId: value.taskId as SetParticipationModePayload['taskId'],
    mode: value.mode as SetParticipationModePayload['mode'],
    expectedTaskVersion: value.expectedTaskVersion,
  };
}
