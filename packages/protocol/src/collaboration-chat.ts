import { randomUUID } from 'node:crypto';
import type { CollaborationCommand, CollaborationPolicy, CollaborationTaskDraft } from '@sync-think/shared';
export type { CollaborationCommand, CollaborationResponse } from '@sync-think/shared';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 100_000;
const id = (v: unknown): v is string => text(v) && v.length <= 256;
const ids = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 32 && v.every(id);
const optional = (v: unknown, check: (v: unknown) => boolean) => v === undefined || check(v);
const integer = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;

export function isCollaborationPolicy(value: unknown): value is Partial<CollaborationPolicy> {
  if (!object(value)) return false;
  const bounds: Record<string, [number, number]> = {
    maxConcurrent: [1, 16], maxMessageHops: [1, 20], maxAutoMessages: [1, 100],
    taskTimeoutSeconds: [60, 7200], statusTimeoutSeconds: [15, 900],
  };
  return Object.entries(value).every(([key, v]) => key === 'browserProfileId' ? id(v) : key === 'browserWorkflowTaskId' ? v === '' || id(v) : key === 'browserWorkflowVariables' ? object(v) && Object.keys(v).length <= 50 && Object.entries(v).every(([name, value]) => text(name) && name.length <= 128 && typeof value === 'string' && value.length <= 4000 && !/password|cookie|token|secret/i.test(name)) : (key === 'allowPeerDirect' || key === 'allowGroupMessages' || key === 'networkEnabled' || key === 'coordinateDiscussion')
    ? typeof v === 'boolean'
    : !!bounds[key] && integer(v, ...bounds[key]!));
}

export function isCollaborationTaskDraft(v: unknown): v is CollaborationTaskDraft {
  return object(v) && v.conversationPlanning === undefined && v.conversationPlanningIntent === undefined && v.conversationPlanTaskId === undefined && v.conversationRecovery === undefined && v.handoff === undefined && v.workHandoff === undefined && v.pendingAssignment === undefined && v.consultation === undefined && v.workflowStartAllowed === undefined && id(v.assigneeMemberId) && text(v.title) && text(v.instructions)
    && optional(v.purpose, x => ['discussion', 'work', 'coordination'].includes(String(x))) && optional(v.key, id) && optional(v.teamParticipantId, id) && optional(v.expectedOutput, (x) => typeof x === 'string' && x.length <= 100_000)
    && optional(v.deliverable, (x) => object(x) && ['document', 'file'].includes(String(x.kind))
      && text(x.title) && (x.kind === 'file' ? text(x.path) : x.path === undefined))
    && optional(v.replacesTaskId, id) && v.replacedByTaskId === undefined && v.goalRevision === undefined
    && optional(v.dependsOnTaskIds, ids) && optional(v.contextRefs, ids)
    && optional(v.planRef, (x) => object(x) && id(x.planId)
      && integer(x.revision, 1, Number.MAX_SAFE_INTEGER) && optional(x.stepId, id))
    && optional(v.timeoutSeconds, (x) => integer(x, 60, 7200))
    && optional(v.resourceClaims, (x) => Array.isArray(x) && x.length <= 32 && x.every((r) => object(r) && id(r.key) && (r.mode === 'read' || r.mode === 'write')));
}

/** Shared IPC/pipe boundary; model tool input is subject to the same checks. */
export function parseCollaborationCommand(value: unknown): CollaborationCommand | undefined {
  if (!object(value) || typeof value.action !== 'string') return undefined;
  if (value.action === 'list' || value.action === 'activity') {
    return optional(value.workspaceId, id) ? value as unknown as CollaborationCommand : undefined;
  }
  if (value.action === 'create') {
    return id(value.clientRequestId) && optional(value.workspaceId, id) && text(value.title)
      && ['model', 'direct', 'group'].includes(String(value.kind)) && ids(value.agentIds)
      && optional(value.coordinatorAgentId, id) && optional(value.modelId, id) && optional(value.teamId, id) && optional(value.teamIds, ids)
      ? value as unknown as CollaborationCommand : undefined;
  }
  if (!id(value.conversationId)) return undefined;
  let valid = false;
  switch (value.action) {
    case 'room-pause':
    case 'room-resume':
    case 'room-complete': valid = id(value.clientRequestId); break;
    case 'room-brief': valid = id(value.clientRequestId) && text(value.goal) && integer(value.expectedGoalRevision, 0, Number.MAX_SAFE_INTEGER); break;
    case 'group-config': valid = id(value.clientRequestId) && typeof value.description === 'string' && value.description.length <= 16000 && integer(value.expectedRevision, 0, Number.MAX_SAFE_INTEGER); break;
    case 'get':
    case 'promote-direct':
    case 'promote-team': valid = true; break;
    case 'send': valid = id(value.clientRequestId) && typeof value.text === 'string' && value.text.length <= 100_000
      && (value.text.trim().length > 0 || Array.isArray(value.images) && value.images.length > 0 || Array.isArray(value.files) && value.files.length > 0)
      && optional(value.images, v => Array.isArray(v) && v.length <= 8 && v.every(image => object(image)
        && optional(image.id, id) && text(image.name) && image.name.length <= 256
        && typeof image.mimeType === 'string' && /^image\/(png|jpeg|webp|gif)$/.test(image.mimeType)
        && (typeof image.dataUrl === 'string' && image.dataUrl.startsWith('data:' + image.mimeType + ';base64,') && image.dataUrl.length <= 700_000
          || typeof image.stagingPath === 'string' && image.stagingPath.length > 0 && image.stagingPath.length <= 4096)))
      && optional(value.files, v => Array.isArray(v) && v.length <= 20 && v.every(file => object(file)
        && text(file.path) && file.path.length <= 4096 && text(file.name) && file.name.length <= 256
        && optional(file.kind, k => k === 'file' || k === 'dir')
        && optional(file.mimeType, m => typeof m === 'string' && m.length <= 128)
        && optional(file.sizeBytes, n => integer(n, 0, 50 * 1024 * 1024))))
      && optional(value.visibility, v => v === 'public' || v === 'private')
      && optional(value.intent, x => x === 'chat' || x === 'discussion' || x === 'work')
      && optional(value.recipientMemberIds, ids) && optional(value.replyToMessageId, id)
      && optional(value.mentions, (v) => Array.isArray(v) && v.length <= 128 && v.every(m => object(m)
        && id(m.memberId) && text(m.label) && integer(m.start, 0, 100_000) && integer(m.end, 1, 100_000)
        && Number(m.end) > Number(m.start)))
      && optional(value.expectsResponse, (v) => typeof v === 'boolean')
      && optional(value.deliveryMode, v => v === 'notify' || v === 'handoff' || v === 'consult')
      && (value.deliveryMode === undefined || value.expectsResponse === undefined || value.expectsResponse === (value.deliveryMode !== 'notify')); break;
    case 'handoff': valid = id(value.clientRequestId) && object(value.handoff)
      && ['work', 'review', 'report'].includes(String(value.handoff.kind))
      && id(value.handoff.recipientMemberId) && text(value.handoff.text)
      && optional(value.handoff.artifactIds, ids) && optional(value.handoff.title, text)
      && (value.handoff.kind === 'work'
        ? isCollaborationTaskDraft({ assigneeMemberId: value.handoff.recipientMemberId,
          title: value.handoff.title, instructions: value.handoff.text, deliverable: value.handoff.deliverable }) && object(value.handoff.deliverable)
        : value.handoff.deliverable === undefined); break;
    case 'start-workflow': valid = id(value.clientRequestId) && text(value.goal)
      && optional(value.originMessageId, id) && optional(value.parentTaskId, id); break;
    case 'dispatch': valid = id(value.clientRequestId) && Array.isArray(value.tasks)
      && value.tasks.length > 0 && value.tasks.length <= 32 && value.tasks.every(isCollaborationTaskDraft)
      && optional(value.originMessageId, id) && optional(value.parentTaskId, id); break;
    case 'cancel': valid = id(value.taskId) && optional(value.includeChildren, (v) => typeof v === 'boolean'); break;
    case 'replace-task': valid = id(value.taskId) && id(value.replacementTaskId) && id(value.clientRequestId); break;
    case 'retry': valid = id(value.taskId) && id(value.clientRequestId); break;
    case 'retry-message': valid = id(value.messageId) && id(value.clientRequestId); break;
    case 'policy': valid = isCollaborationPolicy(value.policy); break;
    case 'members': valid = optional(value.addAgentIds, ids) && optional(value.addTeamIds, ids) && optional(value.expectedTopologyRevision, v => integer(v, 0, Number.MAX_SAFE_INTEGER)) && optional(value.removeMemberIds, ids)
      && optional(value.coordinatorMemberId, id)
      && optional(value.roles, (v) => object(v) && Object.keys(v).length <= 32
        && Object.entries(v).every(([k, role]) => id(k) && typeof role === 'string' && role.length <= 4000)); break;
    case 'direct': valid = id(value.clientRequestId) && ids(value.memberIds) && value.memberIds.length >= 1 && value.memberIds.length <= 2; break;
  }
  return valid ? value as unknown as CollaborationCommand : undefined;
}

export const collaborationCommandExamples = {
  createDirect: (workspaceId: string, agentId: string) => ({
    action: 'create' as const, clientRequestId: randomUUID(), kind: 'direct' as const,
    title: '智能体单聊', workspaceId, agentIds: [agentId],
  }),
  createGroup: (workspaceId: string, agentIds: string[]) => ({
    action: 'create' as const, clientRequestId: randomUUID(), kind: 'group' as const,
    title: '智能体群聊', workspaceId, agentIds,
  }),
} as const;

/** Explain invalid provider drafts without executing or silently upgrading a document to a file. */
export function collaborationDispatchIssues(tasks: unknown): { field: string; message: string }[] {
  if (!Array.isArray(tasks) || tasks.length < 1 || tasks.length > 32) return [{ field: 'tasks', message: 'Expected 1–32 task drafts.' }];
  return tasks.flatMap((task, index) => {
    const field = 'tasks[' + index + ']';
    if (!object(task)) return [{ field, message: 'Expected an object.' }];
    const issues: { field: string; message: string }[] = [];
    for (const key of ['assigneeMemberId', 'title', 'instructions']) if (!text(task[key])) issues.push({ field: field + '.' + key, message: 'Required non-empty string; copy assigneeMemberId from members.' });
    if (object(task.deliverable)) {
      const d = task.deliverable;
      if (d.kind === 'document' && d.path !== undefined) issues.push({ field: field + '.deliverable.path', message: 'Document is host-managed: omit path. For an actual workspace file, explicitly choose kind=file and supply a relative path.' });
      if (d.kind === 'file' && !text(d.path)) issues.push({ field: field + '.deliverable.path', message: 'File delivery requires the actual relative workspace path.' });
    }
    if (!isCollaborationTaskDraft(task) && !issues.length) issues.push({ field, message: 'Invalid task draft; check deliverable kind/title, dependencies, timeoutSeconds (60–7200), and resource claims.' });
    return issues;
  });
}
