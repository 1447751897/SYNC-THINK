import type {
  AddGroupMemberPayload,
  CreateGroupPayload,
  CreateGroupTaskPayload,
  GetGroupPayload,
  ListGroupsPayload,
  RemoveGroupMemberPayload,
  SetGroupLeadPayload,
  UpdateGroupMemberResponsibilityPayload,
  UpdateGroupPayload,
} from '@sync-think/protocol';

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid ${label} payload`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function expectedVersion(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error('expectedVersion must be a positive integer');
  }
  return value as number;
}

export function parseCreateGroupPayload(value: unknown): CreateGroupPayload {
  const input = record(value, 'group-create');
  requiredString(input.name, 'name');
  requiredString(input.leadAgentVersionId, 'leadAgentVersionId');
  if (!Array.isArray(input.members) || input.members.length === 0) {
    throw new Error('members are required');
  }
  return input as unknown as CreateGroupPayload;
}

export function parseGetGroupPayload(value: unknown): GetGroupPayload {
  const input = record(value, 'group-get');
  return { groupId: requiredString(input.groupId, 'groupId') as GetGroupPayload['groupId'] };
}

export function parseListGroupsPayload(value: unknown): ListGroupsPayload {
  if (value === undefined || value === null) return {};
  return record(value, 'group-list') as ListGroupsPayload;
}

export function parseUpdateGroupPayload(value: unknown): UpdateGroupPayload {
  const input = record(value, 'group-update');
  requiredString(input.groupId, 'groupId');
  expectedVersion(input.expectedVersion);
  return input as unknown as UpdateGroupPayload;
}

export function parseAddGroupMemberPayload(value: unknown): AddGroupMemberPayload {
  const input = record(value, 'group-member-add');
  requiredString(input.groupId, 'groupId');
  expectedVersion(input.expectedVersion);
  record(input.member, 'group-member');
  return input as unknown as AddGroupMemberPayload;
}

export function parseRemoveGroupMemberPayload(value: unknown): RemoveGroupMemberPayload {
  const input = record(value, 'group-member-remove');
  requiredString(input.groupId, 'groupId');
  expectedVersion(input.expectedVersion);
  requiredString(input.agentVersionId, 'agentVersionId');
  return input as unknown as RemoveGroupMemberPayload;
}

export function parseUpdateGroupMemberResponsibilityPayload(
  value: unknown,
): UpdateGroupMemberResponsibilityPayload {
  const input = record(value, 'group-member-responsibility');
  requiredString(input.groupId, 'groupId');
  expectedVersion(input.expectedVersion);
  requiredString(input.agentVersionId, 'agentVersionId');
  requiredString(input.responsibility, 'responsibility');
  return input as unknown as UpdateGroupMemberResponsibilityPayload;
}

export function parseSetGroupLeadPayload(value: unknown): SetGroupLeadPayload {
  return parseRemoveGroupMemberPayload(value) as SetGroupLeadPayload;
}

export function parseCreateGroupTaskPayload(value: unknown): CreateGroupTaskPayload {
  const input = record(value, 'group-task-create');
  requiredString(input.groupId, 'groupId');
  requiredString(input.workspaceId, 'workspaceId');
  requiredString(input.title, 'title');
  requiredString(input.goal, 'goal');
  return input as unknown as CreateGroupTaskPayload;
}
