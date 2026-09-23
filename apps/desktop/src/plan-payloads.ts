import type {
  PlanApprovePayload,
  PlanDraftPayload,
  PlanListRevisionsPayload,
  PlanRevisePayload,
} from '@sync-think/protocol';
import { isImageGenerationConfig, type PlanStepDraft } from '@sync-think/shared';
import {
  assertRendererSafeOrchestrationPayload,
  boundedText,
  hasOnlyKeys,
  invalid,
  isRecord,
  revision,
  taskVersion,
} from './orchestration-payload-validation.js';

const MAX_TITLE = 512;
const MAX_INSTRUCTIONS = 20_000;
const MAX_STEPS = 256;

function parseSteps(value: unknown, payloadName: string): PlanStepDraft[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_STEPS) {
    return invalid(payloadName);
  }
  const steps: PlanStepDraft[] = [];
  const ids = new Set<string>();
  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      !hasOnlyKeys(candidate, [
        'id',
        'kind',
        'title',
        'instructions',
        'agentVersionId',
        'modelOverrideId',
        'imageGeneration',
        'dependsOn',
      ]) ||
      !boundedText(candidate.id) ||
      ids.has(candidate.id) ||
      (candidate.kind !== undefined &&
        candidate.kind !== 'execution' &&
        candidate.kind !== 'merge') ||
      !boundedText(candidate.title, MAX_TITLE) ||
      !boundedText(candidate.instructions, MAX_INSTRUCTIONS) ||
      !boundedText(candidate.agentVersionId) ||
      (candidate.modelOverrideId !== undefined && !boundedText(candidate.modelOverrideId)) ||
      (candidate.imageGeneration !== undefined &&
        !isImageGenerationConfig(candidate.imageGeneration)) ||
      (candidate.kind === 'merge' && candidate.imageGeneration !== undefined) ||
      !Array.isArray(candidate.dependsOn) ||
      candidate.dependsOn.length > MAX_STEPS ||
      !candidate.dependsOn.every((dependency) => boundedText(dependency))
    ) {
      return invalid(payloadName);
    }
    ids.add(candidate.id);
    steps.push({
      id: candidate.id as PlanStepDraft['id'],
      kind: candidate.kind === 'merge' ? 'merge' : 'execution',
      title: candidate.title,
      instructions: candidate.instructions,
      agentVersionId: candidate.agentVersionId as PlanStepDraft['agentVersionId'],
      ...(candidate.modelOverrideId
        ? { modelOverrideId: candidate.modelOverrideId as PlanStepDraft['modelOverrideId'] }
        : {}),
      ...(candidate.imageGeneration
        ? { imageGeneration: { ...candidate.imageGeneration } }
        : {}),
      dependsOn: [...candidate.dependsOn] as PlanStepDraft['dependsOn'],
    });
  }
  if (steps.some((step) => step.dependsOn.some((id) => !ids.has(String(id))))) {
    return invalid(payloadName);
  }
  return steps;
}

export function parsePlanCreatePayload(value: unknown): PlanDraftPayload {
  assertRendererSafeOrchestrationPayload(value);
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['taskId', 'expectedTaskVersion', 'title', 'steps']) ||
    !boundedText(value.taskId) ||
    !taskVersion(value.expectedTaskVersion) ||
    !boundedText(value.title, MAX_TITLE)
  ) {
    return invalid('plan-create');
  }
  return {
    taskId: value.taskId as PlanDraftPayload['taskId'],
    expectedTaskVersion: value.expectedTaskVersion,
    title: value.title,
    steps: parseSteps(value.steps, 'plan-create'),
  };
}

export function parsePlanRevisePayload(value: unknown): PlanRevisePayload {
  assertRendererSafeOrchestrationPayload(value);
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['planId', 'expectedRevision', 'title', 'steps']) ||
    !boundedText(value.planId) ||
    !revision(value.expectedRevision) ||
    (value.title !== undefined && !boundedText(value.title, MAX_TITLE))
  ) {
    return invalid('plan-revise');
  }
  return {
    planId: value.planId as PlanRevisePayload['planId'],
    expectedRevision: value.expectedRevision,
    ...(value.title === undefined ? {} : { title: value.title }),
    steps: parseSteps(value.steps, 'plan-revise'),
  };
}

export function parsePlanListPayload(value: unknown): PlanListRevisionsPayload {
  assertRendererSafeOrchestrationPayload(value);
  if (!isRecord(value) || !hasOnlyKeys(value, ['planId']) || !boundedText(value.planId)) {
    return invalid('plan-list');
  }
  return { planId: value.planId as PlanListRevisionsPayload['planId'] };
}

export function parsePlanApprovePayload(value: unknown): PlanApprovePayload {
  assertRendererSafeOrchestrationPayload(value);
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['planId', 'revision']) ||
    !boundedText(value.planId) ||
    !revision(value.revision)
  ) {
    return invalid('plan-approve');
  }
  return {
    planId: value.planId as PlanApprovePayload['planId'],
    revision: value.revision,
  };
}
