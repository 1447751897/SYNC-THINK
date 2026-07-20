import type { TaskSummary } from '@sync-think/protocol';
import type { Event, GroupDefinition } from '@sync-think/shared';

export interface AgentVersionIdentity {
  agentId: string;
  agentVersionId: string;
}

export interface AgentGroupMembershipSummary {
  groupId: string;
  name: string;
  responsibility: string;
  isLead: boolean;
}

const AGENT_VERSION_PAYLOAD_KEYS = [
  'agentVersionId',
  'leadAgentVersionId',
  'reviewerAgentVersionId',
  'delegateAgentVersionId',
] as const;

const CONVERSATION_TEXT_EVENT_TYPES = new Set([
  'group.agent-message',
  'group.delegation-decided',
  'group.subtask-delegated',
  'group.handoff-recorded',
  'subtask.delegated',
  'subtask.agent-message',
  'subtask.completed',
  'subtask.failed',
  'subtask.handoff-recorded',
  'group.collaboration.started',
  'group.collaboration.completed',
  'group.collaboration.failed',
  'group.collaboration.skipped',
]);

function orderedEvents(events: readonly Event[]): Event[] {
  return [...events].sort(
    (left, right) =>
      left.sequence - right.sequence ||
      left.occurredAt.localeCompare(right.occurredAt) ||
      String(left.id).localeCompare(String(right.id)),
  );
}

function payloadString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function eventTaskId(
  event: Event,
  taskIdByThread: ReadonlyMap<string, string> = new Map(),
): string | undefined {
  const threadId = payloadString(event.payload.threadId);
  return (
    (event.taskId ? String(event.taskId) : undefined) ??
    payloadString(event.payload.taskId) ??
    (threadId ? taskIdByThread.get(threadId) : undefined)
  );
}

export function projectTaskPrimaryAgentVersions(
  events: readonly Event[],
): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const ordered = orderedEvents(events);
  const taskIdByThread = new Map<string, string>();

  for (const event of ordered) {
    const threadId = payloadString(event.payload.threadId);
    const taskId =
      (event.taskId ? String(event.taskId) : undefined) ?? payloadString(event.payload.taskId);
    if (threadId && taskId) taskIdByThread.set(threadId, taskId);
  }

  for (const event of ordered) {
    const taskId = eventTaskId(event, taskIdByThread);
    if (!taskId) continue;

    const leadAgentVersionId = payloadString(event.payload.leadAgentVersionId);
    const agentVersionId = payloadString(event.payload.agentVersionId);
    const primaryAgentVersionId = leadAgentVersionId ?? agentVersionId;
    if (primaryAgentVersionId) result.set(taskId, primaryAgentVersionId);
  }

  return result;
}

export function projectTaskGroupIds(events: readonly Event[]): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const event of orderedEvents(events)) {
    const taskId = eventTaskId(event);
    const groupId = payloadString(event.payload.groupId);
    if (taskId && groupId) result.set(taskId, groupId);
  }
  return result;
}

export function projectTaskConversationSummaries(
  events: readonly Event[],
  tasks: readonly TaskSummary[],
): ReadonlyMap<string, string> {
  const taskIdByThread = new Map(tasks.map((task) => [String(task.threadId), String(task.taskId)]));
  const summaries = new Map<string, string>();
  const taskIdByRun = new Map<string, string>();
  const textByRun = new Map<string, string>();

  const setSummary = (taskId: string | undefined, text: unknown) => {
    if (!taskId || typeof text !== 'string') return;
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized) summaries.set(taskId, normalized);
  };

  for (const event of orderedEvents(events)) {
    const taskId = eventTaskId(event, taskIdByThread);
    if (event.runId && taskId) taskIdByRun.set(String(event.runId), taskId);
    const runTaskId = event.runId ? (taskIdByRun.get(String(event.runId)) ?? taskId) : taskId;

    if (event.type === 'message.appended') {
      setSummary(taskId, event.payload.text);
      continue;
    }
    if (CONVERSATION_TEXT_EVENT_TYPES.has(event.type)) {
      setSummary(taskId, event.payload.text);
      continue;
    }
    if (!event.runId) continue;

    const runId = String(event.runId);
    if (event.type === 'run.started') {
      textByRun.set(runId, '');
      continue;
    }
    if (event.type === 'message.delta' && typeof event.payload.textDelta === 'string') {
      const next = (textByRun.get(runId) ?? '') + event.payload.textDelta;
      textByRun.set(runId, next);
      setSummary(runTaskId, next);
      continue;
    }
    if (event.type === 'run.completed') {
      const finalText =
        typeof event.payload.assistantText === 'string'
          ? event.payload.assistantText
          : (textByRun.get(runId) ?? '');
      textByRun.set(runId, finalText);
      setSummary(runTaskId, finalText);
    }
  }

  return summaries;
}

export function projectAgentRelatedTasks(
  events: readonly Event[],
  tasks: readonly TaskSummary[],
  versions: readonly AgentVersionIdentity[],
): ReadonlyMap<string, readonly TaskSummary[]> {
  const agentIdByVersion = new Map(
    versions.map((version) => [version.agentVersionId, version.agentId] as const),
  );
  const taskIdsByAgent = new Map<string, Set<string>>();

  for (const event of events) {
    if (!event.taskId) continue;
    for (const key of AGENT_VERSION_PAYLOAD_KEYS) {
      const agentVersionId = event.payload[key];
      if (typeof agentVersionId !== 'string') continue;
      const agentId = agentIdByVersion.get(agentVersionId);
      if (!agentId) continue;
      const taskIds = taskIdsByAgent.get(agentId) ?? new Set<string>();
      taskIds.add(String(event.taskId));
      taskIdsByAgent.set(agentId, taskIds);
    }
  }

  const result = new Map<string, readonly TaskSummary[]>();
  for (const [agentId, taskIds] of taskIdsByAgent) {
    result.set(
      agentId,
      tasks
        .filter((task) => taskIds.has(String(task.taskId)))
        .sort(
          (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) ||
            String(left.taskId).localeCompare(String(right.taskId)),
        ),
    );
  }
  return result;
}

export function projectAgentGroupMemberships(
  groups: readonly GroupDefinition[],
  versions: readonly AgentVersionIdentity[],
): ReadonlyMap<string, readonly AgentGroupMembershipSummary[]> {
  const agentIdByVersion = new Map(
    versions.map((version) => [version.agentVersionId, version.agentId] as const),
  );
  const result = new Map<string, Map<string, AgentGroupMembershipSummary>>();

  for (const group of groups) {
    for (const member of group.members) {
      const agentId = agentIdByVersion.get(String(member.agentVersionId));
      if (!agentId) continue;
      const memberships = result.get(agentId) ?? new Map<string, AgentGroupMembershipSummary>();
      memberships.set(String(group.id), {
        groupId: String(group.id),
        name: group.name,
        responsibility: member.responsibility,
        isLead: member.agentVersionId === group.leadAgentVersionId,
      });
      result.set(agentId, memberships);
    }
  }

  return new Map(
    [...result].map(([agentId, memberships]) => [
      agentId,
      [...memberships.values()].sort(
        (left, right) =>
          left.name.localeCompare(right.name) || left.groupId.localeCompare(right.groupId),
      ),
    ]),
  );
}
