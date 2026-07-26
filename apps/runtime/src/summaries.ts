import type { ArtifactVersion, ArtifactVersionSummary } from '@sync-think/shared';
import type { PolicyVersionSummary, TaskSummary } from '@sync-think/protocol';
import type { PolicyVersionRecord, TaskRecord } from '@sync-think/storage';

export function toTaskSummary(task: TaskRecord): TaskSummary {
  return {
    taskId: task.id,
    workspaceId: task.workspaceId,
    parentTaskId: task.parentTaskId,
    title: task.title,
    goal: task.goal,
    status: task.status,
    participationMode: task.participationMode,
    taskVersion: task.version,
    threadId: task.threadId,
    lastOpenedAt: task.lastOpenedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export function toArtifactVersionSummary(version: ArtifactVersion): ArtifactVersionSummary {
  return {
    id: version.id,
    artifactId: version.artifactId,
    contentHash: version.contentHash,
    mimeType: version.mimeType,
    sourceStepId: version.sourceStepId,
    status: version.status,
    version: version.version,
    parentVersionIds: [...version.parentVersionIds],
    createdAt: version.createdAt,
    hasInlineContent: version.content !== undefined,
    hasContentRef: version.contentRef !== undefined,
  };
}

export function toPolicyVersionSummary(policy: PolicyVersionRecord): PolicyVersionSummary {
  return {
    id: policy.id,
    policyId: policy.policyId,
    version: policy.version,
    scopeType: policy.scopeType,
    scopeId: policy.scopeId,
    approvalMode: policy.approvalMode,
    rules: policy.rules.map((rule) => ({ ...rule })),
    createdAt: policy.createdAt,
  };
}
