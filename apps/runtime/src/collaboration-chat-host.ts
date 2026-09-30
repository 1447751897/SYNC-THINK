import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_COLLABORATION_CHAT_POLICY, ulid,
  type CollaborationCommand, type CollaborationResponse, type CollaborationSnapshot,
  type CollaborationMember, type CollaborationRepository, type CollaborationTask,
  type CollaborationRosterSummary,
  type ChatPlanRevision,
  type AgentId, type ConversationId, type MessageId, type ModelId, type TeamId, type WorkspaceId,
} from '@sync-think/shared';
import type { SqliteMessageStore, SqliteConversationStore, SqliteGlobalAgentStore, SqliteTeamStore, SqliteWorkspaceStore } from '@sync-think/storage';
import { expandTeamParticipants } from './collaboration-team-participants.js';
import { compileCollaborationWorkflow } from './collaboration-workflow.js';
import { CollaborationChatService, type CollaborationChatPorts } from './collaboration-chat-service.js';

export interface CollaborationChatHostPorts extends Omit<CollaborationChatPorts, 'resourceClaims'> {
  conversations: SqliteConversationStore;
  messages?: SqliteMessageStore;
  agents: SqliteGlobalAgentStore;
  teams?: SqliteTeamStore;
  workspaces: SqliteWorkspaceStore;
}

export interface CollaborationRunStarter {
  start(input: {
    workspaceId: string;
    snapshot: import('@sync-think/shared').CollaborationSnapshot;
    task: CollaborationTask;
    attempt: import('@sync-think/shared').CollaborationAttempt;
    signal: AbortSignal;
    onProgress: (progress: import('./collaboration-chat-service.js').CollaborationProgress) => void;
  }): Promise<import('./collaboration-chat-service.js').CollaborationExecutionResult>;
}

const BUSY_ATTEMPT = new Set(['queued', 'running', 'waiting_input', 'stopping']);

/** Sidebar summary: faces, whether anyone is replying, and the latest line of chat. */
export function collaborationRoster(snapshot: CollaborationSnapshot): CollaborationRosterSummary {
  const members = snapshot.members.filter((m) => m.active && m.kind !== 'user' && !m.teamParticipantId).map(({ id, name, avatar }) => ({ id, name, avatar }));
  const current = new Set(snapshot.tasks.map((task) => task.currentAttemptId));
  const busy = snapshot.attempts.some((attempt) => current.has(attempt.id) && BUSY_ATTEMPT.has(attempt.status));
  const last = [...snapshot.messages].reverse().find((message) => message.kind !== 'system'
    && message.blocks.some((block) => block.type === 'text' && block.text?.trim()));
  const text = last?.blocks.filter((block) => block.type === 'text').map((block) => block.text ?? '').join(' ').replace(/\s+/g, ' ').trim();
  return {
    conversationId: snapshot.conversation.id, kind: snapshot.conversation.kind, members, busy,
    ...(text ? { preview: text.slice(0, 160), previewSender: snapshot.members.find((m) => m.id === last!.senderMemberId)?.name } : {}),
  };
}

/** Product boundary: authenticated user commands and execution-bound agent commands. */
export class CollaborationChatHost {
  readonly service: CollaborationChatService;
  constructor(readonly repository: CollaborationRepository, private readonly ports: CollaborationChatHostPorts, runStarter?: CollaborationRunStarter) {
    this.service = new CollaborationChatService(repository, {
      ...ports,
      execute: runStarter ? (input) => runStarter.start({ workspaceId: input.snapshot.conversation.workspaceId, snapshot: input.snapshot, task: input.task, attempt: input.attempt, signal: input.signal, onProgress: input.onProgress }) : ports.execute,
      resourceClaims: (snapshot, task) => this.resourceClaims(snapshot, task),
    });
    // Repair historical metadata projections without changing conversation identity/history.
    for (const snapshot of this.repository.list()) this.refreshConversationMetadata(snapshot.conversation.id, false);
    for (const parent of this.repository.list().filter((snapshot) =>
      snapshot.conversation.kind === 'group' && !snapshot.conversation.policy.allowPeerDirect)) {
      this.revokePeerDirectChildren(parent.conversation.id);
    }
  }

  refreshConversationMetadata(conversationId: string, notify = true): void {
    const snapshot = this.repository.transaction(() => {
      const current = this.repository.read(conversationId);
      const record = this.ports.conversations.get(conversationId as ConversationId);
      if (!current || !record) return undefined;
      if (current.conversation.title !== record.title) {
        current.conversation.title = record.title;
        current.revision++;
        this.repository.save(current);
      }
      return current;
    });
    if (snapshot && notify) this.ports.onChanged(snapshot);
  }

  private teamMembers(teamId: string, workspaceId: string): CollaborationMember[] {
    const team = this.ports.teams?.get(teamId as TeamId);
    if (!team || !team.members.length) throw new Error('collaboration.team_not_found');
    const leaderId = team.coordinatorAgentId ?? team.members[0].agentId;
    if (!team.members.some(member => member.agentId === leaderId)) throw new Error('collaboration.team_leader_not_member');
    const participantId = `team:${team.id}`;
    const leader = this.agentMember(leaderId, workspaceId);
    return [{ ...leader, id: participantId, kind: 'team', name: team.name, avatar: team.avatar, role: '小队负责人：' + leader.name, teamSnapshot: structuredClone(team) },
      ...team.members.map(config => ({ ...this.agentMember(config.agentId, workspaceId), id: `${participantId}:agent:${config.agentId}`, role: config.role, teamParticipantId: participantId }))];
  }

  private agentMember(agentId: string, workspaceId: string): CollaborationMember {
    const agent = this.ports.agents.listEffective(workspaceId as WorkspaceId)
      .find((entry) => entry.id === agentId && entry.enabled !== false && !entry.archived);
    if (!agent) throw new Error('collaboration.agent_unavailable');
    return { id: `agent:${agent.id}`, kind: 'agent', agentId: agent.id, name: agent.name,
      avatar: agent.avatar, role: agent.description, active: true };
  }

  resourceClaims(snapshot: CollaborationSnapshot, task: CollaborationTask) {
    const folder = this.ports.workspaces.getWorkspace(snapshot.conversation.workspaceId as WorkspaceId)?.folderPath;
    let canonical = folder ? resolve(folder) : snapshot.conversation.workspaceId;
    if (folder) canonical = realpathSync.native(canonical);
    if (process.platform === 'win32') canonical = canonical.toLowerCase();
    // A read declaration can only reduce tools. The executor enforces the same allowlist.
    const agentId = snapshot.members.find(m => m.id === task.assigneeMemberId)?.agentId;
    const agent = agentId ? this.ports.agents.get(agentId as AgentId) : undefined;
    const conversation = this.ports.conversations.get(snapshot.conversation.id as ConversationId);
    const readOnly = task.kind !== 'task' || task.deliverable?.kind === 'document' || agent?.writePolicy !== 'inherit' || conversation?.executionMode === 'ask' || (task.resourceClaims.length > 0 && task.resourceClaims.every((claim) => claim.mode === 'read'));
    return [
      { key: `workspace:${canonical}`, mode: readOnly ? 'read' as const : 'write' as const },
      // Unknown external resources are conservatively exclusive across workspaces.
      { key: 'external-tools', mode: readOnly ? 'read' as const : 'write' as const },
    ];
  }

  dispatchApprovedPlan(
    conversationId: string,
    planId: string,
    revision: ChatPlanRevision,
  ): { snapshot: CollaborationSnapshot; taskIds: string[] } {
    const current = this.repository.read(conversationId);
    if (!current) throw new Error('collaboration.conversation_not_found');
    if (!revision.plan.steps.length) throw new Error('collaboration.tasks_required');
    const coordinator = current.members.find((member) =>
      member.id === current.conversation.coordinatorMemberId && member.active && member.kind !== 'user');
    if (!coordinator) throw new Error('collaboration.coordinator_required');
    const taskKeys = revision.plan.steps.map((step, index) =>
      `approved-plan:${planId}:v${revision.revision}:${index}:${step.id}`);
    const response = this.command({
      action: 'dispatch',
      conversationId,
      clientRequestId: `approved-plan:${planId}:v${revision.revision}`,
      tasks: revision.plan.steps.map((step, index) => ({
        key: taskKeys[index],
        assigneeMemberId: coordinator.id,
        title: step.title,
        instructions: [
          step.description,
          step.expectedFiles?.length ? `预期文件：\n${step.expectedFiles.map((file) => `- ${file}`).join('\n')}` : '',
          step.acceptanceChecks.length ? `验收标准：\n${step.acceptanceChecks.map((check) => `- ${check}`).join('\n')}` : '',
        ].filter(Boolean).join('\n\n'),
        expectedOutput: step.acceptanceChecks.join('\n'),
        dependsOnTaskIds: index > 0 ? [taskKeys[index - 1]!] : [],
        planRef: { planId, revision: revision.revision, stepId: step.id },
      })),
    });
    const snapshot = response.snapshot!;
    const taskIds = snapshot.tasks
      .filter((task) => task.planRef?.planId === planId && task.planRef.revision === revision.revision)
      .map((task) => task.id);
    return { snapshot, taskIds };
  }

  command(command: CollaborationCommand, actorMemberId?: string): CollaborationResponse {
    if (command.action === 'promote-direct') {
      if (actorMemberId) throw new Error('collaboration.user_action_required');
      return this.promoteDirect(command.conversationId);
    }
    if (command.action === 'promote-team') {
      if (actorMemberId) throw new Error('collaboration.user_action_required');
      return this.promoteTeam(command.conversationId);
    }
    if (command.action === 'activity') {
      if (actorMemberId) throw new Error('collaboration.user_action_required');
      const activities = this.repository.list(command.workspaceId).flatMap((snapshot) => {
        const members = new Map(snapshot.members.map((member) => [member.id, member]));
        return snapshot.tasks.map((task) => {
          const attempt = snapshot.attempts.find((entry) => entry.id === task.currentAttemptId);
          if (!attempt) throw new Error('collaboration.attempt_missing');
          return {
            conversationId: snapshot.conversation.id,
            conversationTitle: snapshot.conversation.title,
            taskId: task.id,
            taskTitle: task.title,
            assigneeName: members.get(task.assigneeMemberId)?.name ?? '已离开的成员',
            status: attempt.status,
            ...(attempt.waitReason ? { waitReason: attempt.waitReason } : {}),
            ...(attempt.error?.message ? { errorMessage: attempt.error.message } : {}),
            updatedAt: attempt.updatedAt,
            ...(task.planRef ? { planRef: task.planRef } : {}),
          };
        });
      }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      return { activities };
    }
    if (command.action === 'list') {
      if (actorMemberId) throw new Error('collaboration.user_action_required');
      const snapshots = this.repository.list(command.workspaceId).filter(snapshot =>
        this.ports.conversations.get(snapshot.conversation.id)?.collaborationKind);
      return { conversations: snapshots.map((s) => s.conversation), rosters: snapshots.map((s) => collaborationRoster(s)) };
    }
    if (command.action === 'create') {
      if (actorMemberId) throw new Error('collaboration.user_action_required');
      return { snapshot: this.create(command) };
    }
    const legacyRecord = this.ports.conversations.get(command.conversationId as ConversationId);
    if (command.action === 'get' && legacyRecord?.track === 'team' && !legacyRecord.collaborationKind) {
      return this.promoteTeam(command.conversationId);
    }
    const current = this.repository.read(command.conversationId);
    if (!current || !legacyRecord) throw new Error('collaboration.conversation_not_found');
    if (command.action !== 'get' && !this.ports.conversations.get(command.conversationId)?.collaborationKind)
      throw new Error('collaboration.conversation_promoted');
    if (actorMemberId && !current.members.some((m) => m.id === actorMemberId && m.active)) throw new Error('collaboration.member_removed');
    if (current.conversation.parentConversationId) {
      const parent = this.repository.read(current.conversation.parentConversationId);
      const requiresPeerDirect = ['send', 'start-workflow', 'dispatch', 'retry', 'retry-message', 'direct'].includes(command.action);
      if (requiresPeerDirect && !parent?.conversation.policy.allowPeerDirect) {
        throw new Error('collaboration.peer_direct_disabled');
      }
      if (actorMemberId && !parent?.members.some((m) => m.id === actorMemberId && m.active)) {
        throw new Error('collaboration.peer_direct_disabled');
      }
    }
    let snapshot: CollaborationSnapshot;
    switch (command.action) {
      case 'get': return { snapshot: current };
      case 'send': snapshot = this.service.send(command, actorMemberId); break;
      case 'start-workflow': {
        // One user turn -> one workflow even if the provider retries with a new call ID.
        const parent = command.parentTaskId ? current.tasks.find(t => t.id === command.parentTaskId) : undefined;
        if (actorMemberId && (!parent || parent.kind !== 'reply' || parent.assigneeMemberId !== actorMemberId)) throw new Error('collaboration.workflow_reply_required');
        if (parent && current.tasks.some(t => t.parentTaskId === parent.id && t.kind === 'task')) return { snapshot: current };
        const selfOnly = Boolean(actorMemberId && actorMemberId !== current.conversation.coordinatorMemberId);
        const team = !selfOnly && legacyRecord.track === 'team' ? this.ports.teams?.get(legacyRecord.targetRef as TeamId) : undefined;
        const roster = selfOnly ? { ...current, members: current.members.filter(m => m.id === actorMemberId) } : current;
        snapshot = this.service.dispatch({ action: 'dispatch', conversationId: command.conversationId,
          clientRequestId: `workflow:${command.clientRequestId}`, originMessageId: command.originMessageId,
          parentTaskId: command.parentTaskId, tasks: expandTeamParticipants(current, compileCollaborationWorkflow(roster, command.goal, team)) }, actorMemberId);
        break;
      }
      case 'dispatch': {
        const parent = command.parentTaskId ? current.tasks.find(t => t.id === command.parentTaskId) : undefined;
        if (actorMemberId && parent?.kind === 'reply' && current.tasks.some(t => t.parentTaskId === parent.id && t.kind === 'task')) return { snapshot: current };
        if (actorMemberId && actorMemberId !== current.conversation.coordinatorMemberId && command.tasks.some(task => task.assigneeMemberId !== actorMemberId)) throw new Error('collaboration.coordinator_required');
        snapshot = this.service.dispatch({ ...command, tasks: expandTeamParticipants(current, command.tasks) }, actorMemberId); break;
      }
      case 'cancel':
        if (actorMemberId) throw new Error('collaboration.user_action_required');
        snapshot = this.service.cancel(command); break;
      case 'retry':
        if (actorMemberId) throw new Error('collaboration.user_action_required');
        snapshot = this.service.retry(command); break;
      case 'retry-message':
        if (actorMemberId) throw new Error('collaboration.user_action_required');
        snapshot = this.service.retryMessage(command); break;
      case 'policy':
        if (actorMemberId) throw new Error('collaboration.user_action_required');
        snapshot = this.service.updatePolicy(command);
        if (command.policy.allowPeerDirect === false) {
          this.revokePeerDirectChildren(command.conversationId);
        }
        break;
      case 'members':
        if (actorMemberId) throw new Error('collaboration.user_action_required');
        snapshot = this.updateMembers(command); break;
      case 'direct': return { snapshot: this.openDirect(command, actorMemberId) };
    }
    this.ports.conversations.touchLastMessage(command.conversationId as ConversationId);
    // The service schedules execution after the durable command acknowledgement.
    return { snapshot };
  }

  /** Lazily migrate a legacy team conversation into the group-chat surface. */
  private promoteTeam(conversationId: string): CollaborationResponse {
    return this.repository.transaction(() => {
      const record = this.ports.conversations.get(conversationId);
      if (!record) throw new Error('collaboration.conversation_not_found');
      if (record.collaborationKind === 'group') {
        return { promotedConversation: record, snapshot: this.repository.read(conversationId) };
      }
      if (record.track !== 'team' || !record.workspaceId || !this.ports.teams || !this.ports.messages) {
        throw new Error('collaboration.not_legacy_team');
      }
      const workspaceId = record.workspaceId;
      const team = this.ports.teams.get(record.targetRef as TeamId);
      const coordinatorAgentId = team?.coordinatorAgentId ?? team?.members[0]?.agentId;
      const threadId = record.taskId && this.ports.workspaces.getTask(record.taskId)?.threadId;
      if (!team || !coordinatorAgentId || !threadId) throw new Error('collaboration.team_transcript_missing');
      const coordinator = this.agentMember(coordinatorAgentId, workspaceId);
      const members: CollaborationMember[] = [
        { id: 'user:local', kind: 'user', name: '你', avatar: '', role: '用户', active: true },
        ...team.members.map((member) => {
          const agent = this.agentMember(member.agentId, workspaceId);
          return { ...agent, role: member.title ?? member.role ?? agent.role };
        }),
      ];
      const transcript = this.ports.messages.listMessages(threadId).messages;
      const snapshot: CollaborationSnapshot = {
        conversation: {
          id: record.id,
          workspaceId,
          kind: 'group',
          title: record.title,
          coordinatorMemberId: coordinator.id,
          policy: { ...DEFAULT_COLLABORATION_CHAT_POLICY },
          createdAt: record.createdAt,
        },
        members,
        messages: transcript.sort((left, right) => left.sequence - right.sequence).map((message, index) => ({
          id: ('legacy-team:' + message.id) as MessageId,
          conversationId: record.id,
          senderMemberId: message.role === 'user' ? 'user:local' : coordinator.id,
          recipientMemberIds: [],
          mentions: [],
          kind: 'chat' as const,
          blocks: structuredClone(message.blocks),
          expectsResponse: message.role === 'user',
          correlationId: 'legacy-team:' + message.id,
          hopCount: 0,
          sequence: index + 1,
          createdAt: message.createdAt,
        })),
        deliveries: [],
        tasks: [],
        attempts: [],
        revision: 1,
        receipts: { ['promote-team:' + record.id]: record.id },
      };
      this.repository.save(snapshot);
      const promotedConversation = this.ports.conversations.promoteTeam(record.id);
      return { promotedConversation, snapshot };
    });
  }

  /** Preserve the original id, task, transcript, policy and archived collaboration history. */
  private promoteDirect(conversationId: string): CollaborationResponse {
    return this.repository.transaction(() => {
      const record = this.ports.conversations.get(conversationId);
      if (!record) throw new Error('collaboration.conversation_not_found');
      if (!record.collaborationKind) return { promotedConversation: record, snapshot: this.repository.read(conversationId) };
      const snapshot = this.repository.read(conversationId);
      const people = snapshot?.members.filter(member => member.active) ?? [];
      if (!snapshot || record.collaborationKind !== 'direct' || snapshot.conversation.parentConversationId
        || people.length !== 2 || people.filter(member => member.kind === 'user').length !== 1
        || people.filter(member => member.kind === 'agent' && member.agentId === record.targetRef).length !== 1)
        throw new Error('collaboration.not_user_direct');
      if (snapshot.attempts.some(attempt => BUSY_ATTEMPT.has(attempt.status)))
        throw new Error('collaboration.direct_busy');
      const threadId = record.taskId && this.ports.workspaces.getTask(record.taskId)?.threadId;
      if (!threadId || !this.ports.messages) throw new Error('collaboration.transcript_store_missing');
      for (const message of [...snapshot.messages].sort((a, b) => a.sequence - b.sequence)) {
        const sender = snapshot.members.find(member => member.id === message.senderMemberId);
        this.ports.messages.append({
          id: ('collaboration:' + message.id) as MessageId, threadId,
          role: message.kind === 'system' ? 'system' : sender?.kind === 'user' ? 'user' : 'assistant',
          sequence: this.ports.messages.nextSequence(threadId), createdAt: message.createdAt,
          blocks: structuredClone(message.blocks),
        });
      }
      // Snapshot + task history are deliberately retained. New writes go through the standard chat.
      const promotedConversation = this.ports.conversations.promoteDirect(record.id);
      return { promotedConversation, snapshot };
    });
  }

  sendPeerDirectMessage(input: {
    conversationId: string;
    clientRequestId: string;
    actorMemberId: string;
    recipientMemberId: string;
    originMessageId: string;
    text: string;
    expectsResponse?: boolean;
  }): CollaborationSnapshot {
    const parent = this.repository.read(input.conversationId);
    if (!parent || parent.conversation.kind !== 'group' || !parent.conversation.policy.allowPeerDirect) {
      throw new Error('collaboration.peer_direct_disabled');
    }
    for (const memberId of [input.actorMemberId, input.recipientMemberId]) {
      const member = parent.members.find((entry) => entry.id === memberId);
      if (!member?.active || member.kind === 'user') throw new Error('collaboration.invalid_direct_members');
    }
    if (input.actorMemberId === input.recipientMemberId) {
      throw new Error('collaboration.invalid_peer_direct_members');
    }
    const origin = parent.messages.find((message) => message.id === input.originMessageId);
    if (!origin) throw new Error('collaboration.message_missing');
    const direct = this.openDirect({
      action: 'direct',
      conversationId: input.conversationId,
      clientRequestId: `${input.clientRequestId}:conversation`,
      memberIds: [input.actorMemberId, input.recipientMemberId],
    }, input.actorMemberId);
    const snapshot = this.service.send({
      action: 'send',
      conversationId: direct.conversation.id,
      clientRequestId: `${input.clientRequestId}:message`,
      text: input.text,
      recipientMemberIds: [input.recipientMemberId],
      expectsResponse: input.expectsResponse,
    }, input.actorMemberId, {
      ref: { conversationId: parent.conversation.id, messageId: origin.id },
      message: origin,
    });
    this.ports.conversations.touchLastMessage(snapshot.conversation.id as ConversationId);
    void this.service.pump(snapshot.conversation.workspaceId);
    return snapshot;
  }

  private create(command: Extract<CollaborationCommand, { action: 'create' }>): CollaborationSnapshot {
    return this.repository.transaction(() => {
      const workspaceId = command.workspaceId ?? (
        this.ports.workspaces.listWorkspaces().find(workspace => workspace.name === '__inbox__')?.id
        ?? this.ports.workspaces.createWorkspace({ name: '__inbox__' }).id
      );
      const previous = this.repository.list(workspaceId).find((s) => s.receipts[`create:${command.clientRequestId}`]);
      if (previous) return previous;
      if (!this.ports.workspaces.getWorkspace(workspaceId as WorkspaceId)) throw new Error('collaboration.workspace_not_found');
      const team = command.teamId ? this.ports.teams?.get(command.teamId as TeamId) : undefined;
      if (command.teamId && !team) throw new Error('collaboration.team_not_found');
      const agentIds = [...new Set(command.agentIds.length ? command.agentIds : team?.members.map((m) => m.agentId) ?? [])];
      if (command.teamId && command.teamIds?.length) throw new Error('collaboration.ambiguous_team_binding');
      if (command.kind !== 'group' && command.teamIds?.length) throw new Error('collaboration.team_requires_group');
      if (command.kind === 'direct' && agentIds.length !== 1) throw new Error('collaboration.direct_requires_one_agent');
      if (command.kind === 'group' && agentIds.length < 2 && !command.teamIds?.length) throw new Error('collaboration.group_requires_two_agents');
      if (command.kind === 'model' && !command.modelId) throw new Error('collaboration.model_required');
      const members: CollaborationMember[] = [
        { id: 'user:local', kind: 'user', name: '你', avatar: '', role: '用户', active: true },
        ...agentIds.map((id) => this.agentMember(id, workspaceId)),
        ...[...new Set(command.teamIds ?? [])].flatMap(id => this.teamMembers(id, workspaceId)),
      ];
      for (const member of members) {
        const role = team?.members.find((m) => m.agentId === member.agentId)?.role;
        if (role) member.role = role;
      }
      const coordinatorAgentId = command.coordinatorAgentId ?? team?.coordinatorAgentId ?? agentIds[0] ?? members.find(member => member.kind === 'team')?.agentId;
      const coordinatorMemberId = command.kind === 'model' ? 'assistant:main' : members.find(member => !member.teamParticipantId && member.agentId === coordinatorAgentId)?.id ?? '';
      if (command.kind === 'model') members.push({ id: coordinatorMemberId, kind: 'assistant', name: '主助手', avatar: '', role: '协调与汇总', active: true });
      if (!members.some((m) => m.id === coordinatorMemberId)) throw new Error('collaboration.coordinator_not_member');
      const id = ulid();
      const now = new Date().toISOString();
      // Existing navigation identity stays stable; only the v2 execution path changes.
      this.ports.conversations.create({ id: id as ConversationId, workspaceId: command.workspaceId as WorkspaceId,
        title: command.title, executionMode: 'ask',
        collaborationKind: command.kind,
        target: command.kind === 'model' ? { track: 'model', modelId: command.modelId as ModelId }
          : team ? { track: 'team', teamId: team.id }
          : { track: 'agent', agentId: coordinatorAgentId as AgentId },
      });
      const backing = this.ports.workspaces.createTask({ workspaceId: workspaceId as WorkspaceId, title: command.title, goal: command.title });
      this.ports.conversations.bindTask(id as ConversationId, backing.taskId);
      const snapshot: CollaborationSnapshot = {
        conversation: { id, workspaceId, kind: command.kind, title: command.title,
          coordinatorMemberId, modelId: command.modelId, policy: { ...DEFAULT_COLLABORATION_CHAT_POLICY }, createdAt: now },
        members, messages: [], deliveries: [], tasks: [], attempts: [], revision: 0,
        receipts: { [`create:${command.clientRequestId}`]: id },
      };
      this.repository.save(snapshot);
      return snapshot;
    });
  }

  private updateMembers(command: Extract<CollaborationCommand, { action: 'members' }>): CollaborationSnapshot {
    const snapshot = this.repository.transaction(() => {
      const current = this.repository.read(command.conversationId)!;
      if (command.expectedTopologyRevision !== undefined && command.expectedTopologyRevision !== (current.conversation.topologyRevision ?? 0)) throw new Error('collaboration.topology_conflict：成员已变化，请刷新后重试');
      const pending = current.tasks.filter(task => current.attempts.some(attempt => attempt.id === task.currentAttemptId && BUSY_ATTEMPT.has(attempt.status)));
      if (command.coordinatorMemberId && command.coordinatorMemberId !== current.conversation.coordinatorMemberId && pending.length) throw new Error('collaboration.coordinator_busy：当前工作流结束或停止后再移交协调权');
      for (const removed of command.removeMemberIds ?? []) {
        const affected = new Set(current.members.filter(member => member.id === removed || member.teamParticipantId === removed).map(member => member.id));
        if (pending.some(task => affected.has(task.assigneeMemberId))) throw new Error('collaboration.member_busy：请先停止或完成该成员的任务再移出');
      }
      if (command.addTeamIds?.length && current.conversation.kind !== 'group') throw new Error('collaboration.team_requires_group');
      for (const id of command.addTeamIds ?? []) {
        if (current.members.some(member => member.id === `team:${id}` && member.active)) continue;
        for (const member of this.teamMembers(id, current.conversation.workspaceId)) {
          const index = current.members.findIndex(existing => existing.id === member.id);
          if (index >= 0) current.members[index] = member; else current.members.push(member);
        }
      }
      for (const id of command.addAgentIds ?? []) {
        const member = this.agentMember(id, current.conversation.workspaceId);
        const existing = current.members.find((m) => m.id === member.id);
        if (existing) existing.active = true; else current.members.push(member);
      }
      if (command.coordinatorMemberId) current.conversation.coordinatorMemberId = command.coordinatorMemberId;
      for (const id of command.removeMemberIds ?? []) {
        const member = current.members.find((m) => m.id === id);
        if (member && member.kind !== 'user') {
          member.active = false;
          for (const child of current.members.filter(item => item.teamParticipantId === member.id)) child.active = false;
        }
      }
      for (const [id, role] of Object.entries(command.roles ?? {})) {
        const member = current.members.find((m) => m.id === id);
        if (member) member.role = role;
      }
      if (!current.members.some((m) => m.id === current.conversation.coordinatorMemberId && m.active && m.kind !== 'user' && !m.teamParticipantId)) throw new Error('collaboration.coordinator_required');
      current.conversation.topologyRevision = (current.conversation.topologyRevision ?? 0) + 1;
      current.revision++;
      this.repository.save(current);
      return current;
    });
    this.ports.onChanged(snapshot);
    return snapshot;
  }

  private openDirect(command: Extract<CollaborationCommand, { action: 'direct' }>, actorMemberId?: string): CollaborationSnapshot {
    const parent = this.repository.read(command.conversationId)!;
    const ids = [...new Set(command.memberIds)].sort();
    const userIncluded = ids.includes('user:local');
    const peer = !userIncluded;
    if (ids.length < 1 || ids.length > 2 || !ids.every((id) => parent.members.some((m) => m.id === id && m.active))) throw new Error('collaboration.invalid_direct_members');
    if (!userIncluded && ids.length !== 2) throw new Error('collaboration.invalid_peer_direct_members');
    if (actorMemberId && !ids.includes(actorMemberId)) throw new Error('collaboration.sender_not_participant');
    if (peer && (parent.conversation.kind !== 'group' || !parent.conversation.policy.allowPeerDirect)) throw new Error('collaboration.peer_direct_disabled');
    if (actorMemberId && !peer) throw new Error('collaboration.user_action_required');
    const existing = this.repository.list(parent.conversation.workspaceId).find((s) => s.receipts[`direct:${parent.conversation.id}:${ids.join(',')}`]);
    if (existing) return existing;
    return this.repository.transaction(() => {
      const members = ids.map((id) => ({ ...parent.members.find((m) => m.id === id)! }));
      const agent = members.find((m) => m.kind === 'agent');
      if (!agent) throw new Error('collaboration.agent_required');
      const snapshot = this.create({ action: 'create', clientRequestId: command.clientRequestId, kind: 'direct',
        workspaceId: parent.conversation.workspaceId, title: members.map((m) => m.name).join(' · '), agentIds: [agent.agentId!] });
      snapshot.members = members;
      // A user-created direct chat has its own coordinator identity. A peer
      // direct chat keeps the initiating agent as coordinator and remains tied
      // to the parent group's policy for future writes.
      snapshot.conversation.coordinatorMemberId = agent.id;
      // User-started DMs do not inherit group context; peer DMs remain policy-bound to it.
      if (peer) snapshot.conversation.parentConversationId = parent.conversation.id;
      snapshot.receipts[`direct:${parent.conversation.id}:${ids.join(',')}`] = snapshot.conversation.id;
      snapshot.revision++;
      this.repository.save(snapshot);
      this.ports.onChanged(snapshot);
      return snapshot;
    });
  }

  private revokePeerDirectChildren(parentConversationId: string): void {
    for (const child of this.repository.list().filter((snapshot) =>
      snapshot.conversation.parentConversationId === parentConversationId)) {
      this.service.revokeQueuedPeerDirectWork(child.conversation.id);
    }
  }
}
