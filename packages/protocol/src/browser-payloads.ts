import {
  BROWSER_RECORDING_MAX_STEPS,
  BROWSER_RECORDING_MAX_URL_CHARS,
  hasAsciiControlCharacter,
} from '@sync-think/shared';
import { isRecord } from '@sync-think/shared/value-validation';
import type { BrowserRecordingStepInput } from '@sync-think/shared';
import type {
  ApproveExecuteBrowserWorkflowPayload,
  BrowserAutomationTaskStatus,
  ClearBrowserSiteSessionPayload,
  CreateBrowserProfilePayload,
  CreateBrowserWorkflowDraftPayload,
  CreateBrowserWorkflowRevisionDraftPayload,
  DeleteBrowserProfilePayload,
  ExecuteBrowserWorkflowPayload,
  ExecuteBrowserWorkflowDraftPayload,
  GetBrowserRecordingPayload,
  PauseBrowserRecordingPayload,
  ResumeBrowserRecordingPayload,
  GetBrowserWorkflowPayload,
  ListBrowserProfilesPayload,
  ListBrowserRecordingsPayload,
  ListBrowserSiteSessionsPayload,
  ListBrowserWorkflowsPayload,
  RenameBrowserProfilePayload,
  ReviewBrowserWorkflowDraftPayload,
  SaveBrowserWorkflowDraftPayload,
  PublishBrowserWorkflowDraftPayload,
  ImportChatBrowserWorkflowPayload,
  StartBrowserRecordingPayload,
  StopBrowserRecordingPayload,
  SubmitBrowserWorkflowDraftPayload,
  UpdateBrowserWorkflowSchedulePayload,
} from './commands.js';

const EXECUTE_VARIABLE_MAX_NAME_CHARS = 512;
const EXECUTE_VARIABLE_MAX_VALUE_CHARS = 4_000;
const TASK_STATUSES: readonly BrowserAutomationTaskStatus[] = [
  'draft',
  'pending_review',
  'enabled',
  'disabled',
  'failed',
];

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function validId(value: unknown): value is string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return (
    typeof value === 'string' &&
    normalized.length > 0 &&
    normalized.length <= 256 &&
    !/\s/u.test(normalized)
  );
}

function validPositiveInteger(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= max;
}

function validText(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= max &&
    !hasAsciiControlCharacter(value)
  );
}

function validHttpUrl(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > BROWSER_RECORDING_MAX_URL_CHARS ||
    hasAsciiControlCharacter(value)
  ) {
    return false;
  }
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function validVariables(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([name, variable]) =>
        name.trim().length > 0 &&
        name.length <= EXECUTE_VARIABLE_MAX_NAME_CHARS &&
        typeof variable === 'string' &&
        variable.length <= EXECUTE_VARIABLE_MAX_VALUE_CHARS,
    )
  );
}

function copyVariables(
  value: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!value || Object.keys(value).length === 0) return undefined;
  return Object.fromEntries(Object.entries(value));
}

export function tryParseListBrowserProfilesPayload(
  value: unknown,
): ListBrowserProfilesPayload | undefined {
  return isRecord(value) && hasOnlyKeys(value, []) ? {} : undefined;
}

export function tryParseCreateBrowserProfilePayload(
  value: unknown,
): CreateBrowserProfilePayload | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ['name']) || !validText(value.name, 80)) {
    return undefined;
  }
  return { name: value.name.trim() };
}

export function tryParseRenameBrowserProfilePayload(
  value: unknown,
): RenameBrowserProfilePayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['profileId', 'name', 'expectedRevision']) ||
    !validId(value.profileId) ||
    !validText(value.name, 80) ||
    !validPositiveInteger(value.expectedRevision)
  ) {
    return undefined;
  }
  return {
    profileId: value.profileId.trim(),
    name: value.name.trim(),
    expectedRevision: value.expectedRevision,
  };
}

export function tryParseDeleteBrowserProfilePayload(
  value: unknown,
): DeleteBrowserProfilePayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['profileId', 'expectedRevision']) ||
    !validId(value.profileId) ||
    !validPositiveInteger(value.expectedRevision)
  ) {
    return undefined;
  }
  return { profileId: value.profileId.trim(), expectedRevision: value.expectedRevision };
}

export function tryParseListBrowserSiteSessionsPayload(
  value: unknown,
): ListBrowserSiteSessionsPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['profileId', 'refresh']) ||
    !validId(value.profileId) ||
    (value.refresh !== undefined && typeof value.refresh !== 'boolean')
  ) {
    return undefined;
  }
  return {
    profileId: value.profileId.trim(),
    ...(typeof value.refresh === 'boolean' ? { refresh: value.refresh } : {}),
  };
}

export function tryParseClearBrowserSiteSessionPayload(
  value: unknown,
): ClearBrowserSiteSessionPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['profileId', 'siteKey']) ||
    !validId(value.profileId) ||
    typeof value.siteKey !== 'string' ||
    value.siteKey.trim().length === 0 ||
    value.siteKey.length > 253 ||
    /\s/u.test(value.siteKey) ||
    hasAsciiControlCharacter(value.siteKey)
  ) {
    return undefined;
  }
  return { profileId: value.profileId.trim(), siteKey: value.siteKey.trim().toLowerCase() };
}

export function tryParseListBrowserRecordingsPayload(
  value: unknown,
): ListBrowserRecordingsPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['profileId', 'limit']) ||
    !validId(value.profileId) ||
    (value.limit !== undefined && !validPositiveInteger(value.limit, 50))
  ) {
    return undefined;
  }
  return {
    profileId: value.profileId.trim(),
    ...(typeof value.limit === 'number' ? { limit: value.limit } : {}),
  };
}

export function tryParseGetBrowserRecordingPayload(
  value: unknown,
): GetBrowserRecordingPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['recordingId', 'afterSequence', 'limit']) ||
    !validId(value.recordingId) ||
    (value.afterSequence !== undefined &&
      (!Number.isSafeInteger(value.afterSequence) ||
        Number(value.afterSequence) < 0 ||
        Number(value.afterSequence) > BROWSER_RECORDING_MAX_STEPS)) ||
    (value.limit !== undefined && !validPositiveInteger(value.limit, BROWSER_RECORDING_MAX_STEPS))
  ) {
    return undefined;
  }
  return {
    recordingId: value.recordingId.trim(),
    ...(typeof value.afterSequence === 'number' ? { afterSequence: value.afterSequence } : {}),
    ...(typeof value.limit === 'number' ? { limit: value.limit } : {}),
  };
}

export function tryParseStartBrowserRecordingPayload(
  value: unknown,
): StartBrowserRecordingPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['profileId', 'expectedProfileRevision', 'startUrl', 'draftId']) ||
    !validId(value.profileId) ||
    !validPositiveInteger(value.expectedProfileRevision) ||
    (value.draftId !== undefined && !validId(value.draftId)) ||
    (value.startUrl !== undefined && !validHttpUrl(value.startUrl))
  ) {
    return undefined;
  }
  return {
    profileId: value.profileId.trim(),
    expectedProfileRevision: value.expectedProfileRevision,
    ...(typeof value.startUrl === 'string' ? { startUrl: value.startUrl.trim() } : {}),
    ...(typeof value.draftId === 'string' ? { draftId: value.draftId.trim() } : {}),
  };
}

export function tryParseStopBrowserRecordingPayload(
  value: unknown,
): StopBrowserRecordingPayload | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ['recordingId']) || !validId(value.recordingId)) {
    return undefined;
  }
  return { recordingId: value.recordingId.trim() };
}

export function tryParsePauseBrowserRecordingPayload(
  value: unknown,
): PauseBrowserRecordingPayload | undefined {
  return tryParseStopBrowserRecordingPayload(value);
}

export function tryParseResumeBrowserRecordingPayload(
  value: unknown,
): ResumeBrowserRecordingPayload | undefined {
  return tryParseStopBrowserRecordingPayload(value);
}

export function tryParseAssignBrowserWorkflowWorkspacePayload(value: unknown): import('./commands.js').AssignBrowserWorkflowWorkspacePayload | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ['taskId', 'workspaceId', 'expectedRevision']) ||
      !validId(value.taskId) || (value.workspaceId !== null && !validId(value.workspaceId)) ||
      !validPositiveInteger(value.expectedRevision)) return undefined;
  return { taskId: value.taskId.trim(), workspaceId: value.workspaceId === null ? null : value.workspaceId.trim(), expectedRevision: value.expectedRevision };
}

export function tryParseListBrowserWorkflowsPayload(
  value: unknown,
): ListBrowserWorkflowsPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['profileId', 'status', 'query', 'limit', 'workspaceId', 'includeLive']) ||
    (value.workspaceId !== undefined && !validId(value.workspaceId)) ||
    (value.includeLive !== undefined && typeof value.includeLive !== 'boolean') ||
    (value.profileId !== undefined && !validId(value.profileId)) ||
    (value.status !== undefined &&
      (typeof value.status !== 'string' ||
        !TASK_STATUSES.includes(value.status as BrowserAutomationTaskStatus))) ||
    (value.query !== undefined && !validText(value.query, 200)) ||
    (value.limit !== undefined && !validPositiveInteger(value.limit, 100))
  ) {
    return undefined;
  }
  return {
    ...(typeof value.workspaceId === 'string' ? { workspaceId: value.workspaceId.trim() } : {}),
    ...(value.includeLive === true ? { includeLive: true } : {}),
    ...(typeof value.profileId === 'string' ? { profileId: value.profileId.trim() } : {}),
    ...(typeof value.status === 'string'
      ? { status: value.status as BrowserAutomationTaskStatus }
      : {}),
    ...(typeof value.query === 'string' ? { query: value.query.trim() } : {}),
    ...(typeof value.limit === 'number' ? { limit: value.limit } : {}),
  };
}

export function tryParseGetBrowserWorkflowPayload(
  value: unknown,
): GetBrowserWorkflowPayload | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ['taskId']) || !validId(value.taskId)) {
    return undefined;
  }
  return { taskId: value.taskId.trim() };
}

export function tryParseCreateBrowserWorkflowDraftPayload(
  value: unknown,
): CreateBrowserWorkflowDraftPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['workspaceId', 'profileId', 'name', 'instruction', 'startUrl', 'source']) ||
    !validId(value.profileId) ||
    (value.workspaceId !== undefined && !validId(value.workspaceId)) ||
    !validText(value.name, 120) ||
    !validText(value.instruction, 4_000) ||
    !validHttpUrl(value.startUrl) ||
    (value.source !== 'manual' && value.source !== 'ai')
  ) {
    return undefined;
  }
  return {
    profileId: value.profileId.trim(),
    ...(typeof value.workspaceId === 'string' ? { workspaceId: value.workspaceId.trim() } : {}),
    name: value.name.trim(),
    instruction: value.instruction.trim(),
    startUrl: value.startUrl.trim(),
    source: value.source,
  };
}

export function tryParseCreateBrowserWorkflowRevisionDraftPayload(
  value: unknown,
): CreateBrowserWorkflowRevisionDraftPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['taskId', 'expectedTaskRevision']) ||
    !validId(value.taskId) ||
    !validPositiveInteger(value.expectedTaskRevision)
  ) {
    return undefined;
  }
  return { taskId: value.taskId.trim(), expectedTaskRevision: value.expectedTaskRevision };
}

export function tryParseSubmitBrowserWorkflowDraftPayload(
  value: unknown,
): SubmitBrowserWorkflowDraftPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['draftId', 'recordingId']) ||
    !validId(value.draftId) ||
    !validId(value.recordingId)
  ) {
    return undefined;
  }
  return { draftId: value.draftId.trim(), recordingId: value.recordingId.trim() };
}

export function tryParseSaveBrowserWorkflowDraftPayload(
  value: unknown,
): SaveBrowserWorkflowDraftPayload | undefined {
  return tryParseSubmitBrowserWorkflowDraftPayload(value);
}

export function tryParsePublishBrowserWorkflowDraftPayload(
  value: unknown,
): PublishBrowserWorkflowDraftPayload | undefined {
  return tryParseSubmitBrowserWorkflowDraftPayload(value);
}

export function tryParseImportChatBrowserWorkflowPayload(
  value: unknown,
): ImportChatBrowserWorkflowPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'workspaceId',
      'profileId',
      'name',
      'instruction',
      'startUrl',
      'steps',
      'publish',
      'source',
    ]) ||
    !validId(value.profileId) ||
    (value.workspaceId !== undefined && !validId(value.workspaceId)) ||
    !validText(value.name, 120) ||
    !validText(value.instruction, 4_000) ||
    !validHttpUrl(value.startUrl) ||
    typeof value.publish !== 'boolean' ||
    (value.source !== undefined && value.source !== 'manual' && value.source !== 'ai') ||
    !Array.isArray(value.steps) ||
    value.steps.length < 1 ||
    value.steps.length > BROWSER_RECORDING_MAX_STEPS ||
    !value.steps.every(
      (step) =>
        isRecord(step) &&
        ['navigate', 'click', 'fill', 'select', 'check', 'press'].includes(String(step.kind)),
    )
  ) {
    return undefined;
  }
  return {
    profileId: value.profileId.trim(),
    ...(typeof value.workspaceId === 'string' ? { workspaceId: value.workspaceId.trim() } : {}),
    name: value.name.trim(),
    instruction: value.instruction.trim(),
    startUrl: value.startUrl.trim(),
    steps: structuredClone(value.steps) as BrowserRecordingStepInput[],
    publish: value.publish,
    ...(value.source === 'manual' || value.source === 'ai' ? { source: value.source } : {}),
  };
}

export function tryParseReviewBrowserWorkflowDraftPayload(
  value: unknown,
): ReviewBrowserWorkflowDraftPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['draftId', 'decision', 'note']) ||
    !validId(value.draftId) ||
    (value.decision !== 'approve' && value.decision !== 'reject') ||
    (value.note !== undefined && !validText(value.note, 2_000))
  ) {
    return undefined;
  }
  return {
    draftId: value.draftId.trim(),
    decision: value.decision,
    ...(typeof value.note === 'string' ? { note: value.note.trim() } : {}),
  };
}

export function tryParseExecuteBrowserWorkflowPayload(
  value: unknown,
): ExecuteBrowserWorkflowPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['taskId', 'variables']) ||
    !validId(value.taskId) ||
    (value.variables !== undefined && !validVariables(value.variables))
  ) {
    return undefined;
  }
  const variables = copyVariables(value.variables as Record<string, string> | undefined);
  return { taskId: value.taskId.trim(), ...(variables ? { variables } : {}) };
}

export function tryParseExecuteBrowserWorkflowDraftPayload(
  value: unknown,
): ExecuteBrowserWorkflowDraftPayload | undefined {
  return tryParseExecuteBrowserWorkflowPayload(value);
}

export function tryParseApproveExecuteBrowserWorkflowPayload(
  value: unknown,
): ApproveExecuteBrowserWorkflowPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['taskId', 'origins', 'variables']) ||
    !validId(value.taskId) ||
    !Array.isArray(value.origins) ||
    value.origins.length === 0 ||
    value.origins.length > 50 ||
    value.origins.some((origin) => !validHttpUrl(origin)) ||
    (value.variables !== undefined && !validVariables(value.variables))
  ) {
    return undefined;
  }
  const origins = [...new Set(value.origins.map((origin) => String(origin).trim()))];
  const variables = copyVariables(value.variables as Record<string, string> | undefined);
  return { taskId: value.taskId.trim(), origins, ...(variables ? { variables } : {}) };
}

export function tryParseUpdateBrowserWorkflowSchedulePayload(
  value: unknown,
): UpdateBrowserWorkflowSchedulePayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['taskId', 'enabled', 'intervalMinutes', 'expectedRevision']) ||
    !validId(value.taskId) ||
    typeof value.enabled !== 'boolean' ||
    !Number.isSafeInteger(value.intervalMinutes) ||
    Number(value.intervalMinutes) < 5 ||
    Number(value.intervalMinutes) > 10_080 ||
    (value.expectedRevision !== undefined && !validPositiveInteger(value.expectedRevision))
  ) {
    return undefined;
  }
  return {
    taskId: value.taskId.trim(),
    enabled: value.enabled,
    intervalMinutes: Number(value.intervalMinutes),
    ...(typeof value.expectedRevision === 'number'
      ? { expectedRevision: value.expectedRevision }
      : {}),
  };
}
