// run-plan command payload parsers (extracted from command-validation.ts).
import type { CancelRunPayload, PauseRunPayload, ResumeRunPayload, ContinueEventReplayPayload, SubscribeEventsPayload, UnsubscribeEventsPayload, PlanDraftPayload, PlanRevisePayload, PlanListRevisionsPayload, PlanApprovePayload, RunGetGraphPayload } from '@sync-think/protocol';
import type { EventCategory } from '@sync-think/shared';
import { EVENT_CATEGORIES, parseOrchestrationRunMutationPayload, PLAN_ID_MAX_LENGTH, PLAN_TITLE_MAX_LENGTH, hasOnlyKeys, isBoundedText, parsePlanSteps, isRecord } from './shared.js';

export function parseSubscribeEventsPayload(value: unknown): SubscribeEventsPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (!Number.isInteger(value.afterCursor) || (value.afterCursor as number) < 0) {
    return undefined;
  }
  if (
    value.categories !== undefined &&
    (!Array.isArray(value.categories) ||
      !value.categories.every(
        (category) =>
          typeof category === 'string' && EVENT_CATEGORIES.has(category as EventCategory),
      ))
  ) {
    return undefined;
  }
  return value as unknown as SubscribeEventsPayload;
}

export function parseContinueEventReplayPayload(
  value: unknown,
): ContinueEventReplayPayload | undefined {
  if (
    !isRecord(value) ||
    typeof value.streamId !== 'string' ||
    value.streamId.length === 0 ||
    value.streamId.length > 256 ||
    !Number.isInteger(value.afterCursor) ||
    (value.afterCursor as number) < 0
  ) {
    return undefined;
  }
  return value as unknown as ContinueEventReplayPayload;
}

export function parseUnsubscribeEventsPayload(
  value: unknown,
): UnsubscribeEventsPayload | undefined {
  if (!isRecord(value) || typeof value.streamId !== 'string' || value.streamId.length === 0) {
    return undefined;
  }
  return value as unknown as UnsubscribeEventsPayload;
}

export function parseCancelRunPayload(value: unknown): CancelRunPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (hasOnlyKeys(value, ['runId']) && isBoundedText(value.runId, 256)) {
    return { runId: value.runId as CancelRunPayload['runId'] };
  }
  return parseOrchestrationRunMutationPayload(value);
}

export function parsePauseRunPayload(value: unknown): PauseRunPayload | undefined {
  return parseOrchestrationRunMutationPayload(value);
}

export function parseResumeRunPayload(value: unknown): ResumeRunPayload | undefined {
  return parseOrchestrationRunMutationPayload(value);
}

export function parsePlanDraftPayload(value: unknown): PlanDraftPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['taskId', 'expectedTaskVersion', 'title', 'steps']) ||
    !isBoundedText(value.taskId, PLAN_ID_MAX_LENGTH) ||
    !Number.isInteger(value.expectedTaskVersion) ||
    (value.expectedTaskVersion as number) < 0 ||
    !isBoundedText(value.title, PLAN_TITLE_MAX_LENGTH)
  ) {
    return undefined;
  }
  const steps = parsePlanSteps(value.steps);
  if (!steps) return undefined;
  return {
    taskId: value.taskId as PlanDraftPayload['taskId'],
    expectedTaskVersion: value.expectedTaskVersion as number,
    title: value.title,
    steps,
  };
}

export function parsePlanRevisePayload(value: unknown): PlanRevisePayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['planId', 'expectedRevision', 'title', 'steps']) ||
    !isBoundedText(value.planId, PLAN_ID_MAX_LENGTH) ||
    !Number.isInteger(value.expectedRevision) ||
    (value.expectedRevision as number) < 1 ||
    (value.title !== undefined && !isBoundedText(value.title, PLAN_TITLE_MAX_LENGTH))
  ) {
    return undefined;
  }
  const steps = parsePlanSteps(value.steps);
  if (!steps) return undefined;
  return {
    planId: value.planId as PlanRevisePayload['planId'],
    expectedRevision: value.expectedRevision as number,
    ...(value.title === undefined ? {} : { title: value.title }),
    steps,
  };
}

export function parsePlanListRevisionsPayload(
  value: unknown,
): PlanListRevisionsPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['planId']) ||
    !isBoundedText(value.planId, PLAN_ID_MAX_LENGTH)
  ) {
    return undefined;
  }
  return { planId: value.planId as PlanListRevisionsPayload['planId'] };
}

export function parsePlanApprovePayload(value: unknown): PlanApprovePayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['planId', 'revision']) ||
    !isBoundedText(value.planId, PLAN_ID_MAX_LENGTH) ||
    !Number.isInteger(value.revision) ||
    (value.revision as number) < 1
  ) {
    return undefined;
  }
  return {
    planId: value.planId as PlanApprovePayload['planId'],
    revision: value.revision as number,
  };
}

export function parseRunGetGraphPayload(value: unknown): RunGetGraphPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['workspaceId', 'taskId', 'runId']) ||
    !isBoundedText(value.workspaceId, PLAN_ID_MAX_LENGTH) ||
    !isBoundedText(value.taskId, PLAN_ID_MAX_LENGTH) ||
    !isBoundedText(value.runId, PLAN_ID_MAX_LENGTH)
  ) {
    return undefined;
  }
  return {
    workspaceId: value.workspaceId as RunGetGraphPayload['workspaceId'],
    taskId: value.taskId as RunGetGraphPayload['taskId'],
    runId: value.runId as RunGetGraphPayload['runId'],
  };
}
