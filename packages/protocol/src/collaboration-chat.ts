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
  return Object.entries(value).every(([key, v]) => key === 'allowPeerDirect'
    ? typeof v === 'boolean'
    : !!bounds[key] && integer(v, ...bounds[key]!));
}

export function isCollaborationTaskDraft(v: unknown): v is CollaborationTaskDraft {
  return object(v) && id(v.assigneeMemberId) && text(v.title) && text(v.instructions)
    && optional(v.key, id) && optional(v.expectedOutput, (x) => typeof x === 'string' && x.length <= 100_000)
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
    return id(value.clientRequestId) && id(value.workspaceId) && text(value.title)
      && ['model', 'direct', 'group'].includes(String(value.kind)) && ids(value.agentIds)
      && optional(value.coordinatorAgentId, id) && optional(value.modelId, id) && optional(value.teamId, id)
      ? value as unknown as CollaborationCommand : undefined;
  }
  if (!id(value.conversationId)) return undefined;
  let valid = false;
  switch (value.action) {
    case 'get': valid = true; break;
    case 'send': valid = id(value.clientRequestId) && text(value.text)
      && optional(value.recipientMemberIds, ids) && optional(value.replyToMessageId, id)
      && optional(value.expectsResponse, (v) => typeof v === 'boolean'); break;
    case 'dispatch': valid = id(value.clientRequestId) && Array.isArray(value.tasks)
      && value.tasks.length > 0 && value.tasks.length <= 32 && value.tasks.every(isCollaborationTaskDraft)
      && optional(value.originMessageId, id) && optional(value.parentTaskId, id); break;
    case 'cancel': valid = id(value.taskId) && optional(value.includeChildren, (v) => typeof v === 'boolean'); break;
    case 'retry': valid = id(value.taskId) && id(value.clientRequestId); break;
    case 'retry-message': valid = id(value.messageId) && id(value.clientRequestId); break;
    case 'policy': valid = isCollaborationPolicy(value.policy); break;
    case 'members': valid = optional(value.addAgentIds, ids) && optional(value.removeMemberIds, ids)
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
