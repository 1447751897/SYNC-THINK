import type {
  BrowserAutomationTaskStatus,
  CreateBrowserWorkflowDraftPayload,
  GetBrowserWorkflowPayload,
  ListBrowserWorkflowsPayload,
  ReviewBrowserWorkflowDraftPayload,
  SubmitBrowserWorkflowDraftPayload,
} from '@sync-think/protocol';
import { BROWSER_RECORDING_MAX_URL_CHARS } from '@sync-think/shared';
import { hasOnlyKeys, isRecord } from './shared.js';

const TASK_STATUSES: readonly BrowserAutomationTaskStatus[] = [
  'draft',
  'pending_review',
  'enabled',
  'disabled',
  'failed',
];

const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 256 && !/\s/u.test(value);

const validPositiveInteger = (value: unknown, max: number): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= max;

export function parseListBrowserWorkflowsPayload(
  value: unknown,
): ListBrowserWorkflowsPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['profileId', 'status', 'query', 'limit']) ||
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
    ...(typeof value.profileId === 'string' ? { profileId: value.profileId.trim() } : {}),
    ...(typeof value.status === 'string'
      ? { status: value.status as BrowserAutomationTaskStatus }
      : {}),
    ...(typeof value.query === 'string' ? { query: value.query.trim() } : {}),
    ...(typeof value.limit === 'number' ? { limit: value.limit } : {}),
  };
}

export function parseGetBrowserWorkflowPayload(
  value: unknown,
): GetBrowserWorkflowPayload | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ['taskId']) || !validId(value.taskId)) {
    return undefined;
  }
  return { taskId: value.taskId.trim() };
}

export function parseCreateBrowserWorkflowDraftPayload(
  value: unknown,
): CreateBrowserWorkflowDraftPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['profileId', 'name', 'instruction', 'startUrl', 'source']) ||
    !validId(value.profileId) ||
    !validText(value.name, 120) ||
    !validText(value.instruction, 4_000) ||
    !validHttpUrl(value.startUrl) ||
    (value.source !== 'manual' && value.source !== 'ai')
  ) {
    return undefined;
  }
  return {
    profileId: value.profileId.trim(),
    name: value.name.trim(),
    instruction: value.instruction.trim(),
    startUrl: value.startUrl.trim(),
    source: value.source,
  };
}

export function parseSubmitBrowserWorkflowDraftPayload(
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
  return {
    draftId: value.draftId.trim(),
    recordingId: value.recordingId.trim(),
  };
}

export function parseReviewBrowserWorkflowDraftPayload(
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

function hasAsciiControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.charCodeAt(0);
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}
