import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteConversationStore,
  SqliteCollaborationStore,
  SqliteGlobalAgentStore,
  SqliteWorkspaceStore,
  SqliteTeamStore,
} from '@sync-think/storage';
import type {
  ConversationId,
  CollaborationTask,
  CollaborationAttempt,
  AgentId,
  ModelId,
} from '@sync-think/shared';
import { CollaborationChatHost, collaborationRoster } from './collaboration-chat-host.js';
import { submitCollaborationArtifact } from './collaboration-artifacts.js';
import { expandTeamParticipants } from './collaboration-team-participants.js';

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'team-participant-'));
  const path = join(directory, 'test.db');
  await runMigrations(path);
  const db = await openDatabaseAsync({ path });
  const workspaces = new SqliteWorkspaceStore(db.raw);
  const workspace = workspaces.createWorkspace({ name: '协作测试', folderPath: directory });
  const agents = new SqliteGlobalAgentStore(db.raw);
  const roster = ['协调员', '研发负责人', '测试员', '新增成员'].map((name, i) =>
    agents.create({ id: ('nested-' + i) as AgentId, name, defaultModelId: 'fake-mini' as ModelId }),
  );
  const teams = new SqliteTeamStore(db.raw);
  const team = teams.create({
    name: '研发小队',
    mission: '设计到验收',
    strategy: 'serial',
    coordinatorAgentId: roster[1].id,
    members: roster.slice(1, 3).map((a, i) => ({
      agentId: a.id,
      role: a.name,
      title: a.name,
      dependsOn: i ? [roster[1].id] : [],
    })),
  });
  const conversations = new SqliteConversationStore(db.raw);
  const repository = new SqliteCollaborationStore(db.raw);
  const executions: { task: CollaborationTask; attempt: CollaborationAttempt }[] = [];
  const ports = {
    ownerId: 'nested-fixture',
    conversations,
    agents,
    teams,
    workspaces,
    onChanged: () => {},
    execute: async ({
      task,
      attempt,
    }: {
      task: CollaborationTask;
      attempt: CollaborationAttempt;
    }) => {
      executions.push({ task, attempt });
      return {
        output: task.title,
        artifacts: task.deliverable
          ? [
              submitCollaborationArtifact({
                task,
                attempt,
                content: '# ' + task.title + '完整交付',
              }),
            ]
          : [],
      };
    },
  };
  const host = new CollaborationChatHost(repository, ports);
  const create = () =>
    host.command({
      action: 'create',
      clientRequestId: crypto.randomUUID(),
      kind: 'group',
      title: '产品协作',
      workspaceId: workspace.id,
      agentIds: [roster[0].id],
      teamIds: [team.id],
      coordinatorAgentId: roster[0].id,
    }).snapshot!;
  return {
    workspace,
    agents,
    roster,
    teams,
    team,
    host,
    repository,
    conversations,
    ports,
    executions,
    create,
    close: async () => {
      await host.service.stop();
      db.raw.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
it('stores a namespaced team, preserves its leader and freezes the internal chain at admission', async () => {
  const f = await fixture();
  try {
    const s = f.create();
    const head = s.members.find((m) => m.kind === 'team')!;
    expect(head.name).toBe('研发小队');
    expect(head.agentId).toBe(f.roster[1].id);
    expect(s.members.filter((m) => m.teamParticipantId === head.id)).toHaveLength(2);
    expect(collaborationRoster(s).members).toHaveLength(2);
    const drafts = expandTeamParticipants(s, [
      { key: 'handoff', assigneeMemberId: head.id, title: '交付', instructions: '实现并验收' },
    ]);
    expect(drafts.map((d) => d.dependsOnTaskIds)).toEqual([
      [],
      ['handoff:stage-1'],
      ['handoff:stage-2'],
    ]);
    f.teams.update({
      teamId: f.team.id,
      name: '新名称',
      strategy: 'parallel',
      members: [{ agentId: f.roster[3].id, role: '新成员' }],
      coordinatorAgentId: f.roster[3].id,
    });
    expect(
      expandTeamParticipants(f.repository.read(s.conversation.id)!, [
        { key: 'handoff', assigneeMemberId: head.id, title: '交付', instructions: '实现并验收' },
      ]),
    ).toEqual(drafts);
    const added = f.host.command({
      action: 'members',
      conversationId: s.conversation.id,
      expectedTopologyRevision: 0,
      addAgentIds: [f.roster[1].id],
    }).snapshot!;
    expect(added.members.filter((m) => m.agentId === f.roster[1].id)).toHaveLength(3);
    expect(() =>
      f.host.command({
        action: 'members',
        conversationId: s.conversation.id,
        expectedTopologyRevision: 0,
        addAgentIds: [f.roster[3].id],
      }),
    ).toThrow('topology_conflict');
  } finally {
    await f.close();
  }
});
it('starts only the team leader and does not automatically expand the old stage graph', async () => {
  const f = await fixture();
  try {
    const s = f.create();
    const head = s.members.find((m) => m.kind === 'team')!;
    f.host.command({
      action: 'dispatch',
      conversationId: s.conversation.id,
      clientRequestId: 'deliver',
      tasks: [{ assigneeMemberId: head.id, title: '验收交付', instructions: '完成交付' }],
    });
    await f.host.service.pump(f.workspace.id);
    await expect
      .poll(
        () =>
          f.repository
            .read(s.conversation.id)!
            .attempts.filter((a) => ['queued', 'running'].includes(a.status)).length,
      )
      .toBe(0);
    const done = f.repository.read(s.conversation.id)!;
    expect(
      f.executions.filter((e) => e.task.kind === 'task').map((e) => e.task.assigneeMemberId),
    ).toEqual([head.id]);
    expect(done.tasks[0].purpose).toBe('coordination');
    const results = done.messages.filter((m) => m.kind === 'task_result');
    expect(results.filter((m) => m.recipientMemberIds.includes(head.id))).toHaveLength(0);
    expect(
      results.filter(
        (m) =>
          m.senderMemberId === head.id &&
          m.recipientMemberIds.includes(s.conversation.coordinatorMemberId),
      ),
    ).toHaveLength(1);
    // The fixture returns prose without dispatch or delivery: transport completion is not goal completion.
    const coordinator = done.tasks.find(t => t.purpose === 'coordination')!;
    expect(done.attempts.find(a => a.id === coordinator.currentAttemptId)).toMatchObject({ status: 'failed', error: { code: 'coordination_no_progress' } });
    expect(done.conversation.room!.state).toBe('blocked');
  } finally {
    await f.close();
  }
});
it('freezes running graphs, admits new members next round, and cancels a team handoff with its internal nodes', async () => {
  const f = await fixture();
  try {
    const s = f.create();
    const head = s.members.find((m) => m.kind === 'team')!;
    const started = f.host.command({
      action: 'dispatch',
      conversationId: s.conversation.id,
      clientRequestId: 'cancel',
      tasks: [{ assigneeMemberId: head.id, title: '交付', instructions: '完成交付' }],
    }).snapshot!;
    expect(() =>
      f.host.command({
        action: 'members',
        conversationId: s.conversation.id,
        removeMemberIds: [head.id],
      }),
    ).toThrow('member_busy');
    expect(() =>
      f.host.command({
        action: 'members',
        conversationId: s.conversation.id,
        coordinatorMemberId: head.id,
      }),
    ).toThrow('coordinator_busy');
    const updated = f.host.command({
      action: 'members',
      conversationId: s.conversation.id,
      addAgentIds: [f.roster[3].id],
    }).snapshot!;
    expect(updated.tasks).toEqual(started.tasks);
    expect(updated.tasks.every((t) => t.topologyRevision === 0)).toBe(true);
    const stopped = f.host.command({
      action: 'cancel',
      conversationId: s.conversation.id,
      taskId: started.tasks.find((t) => t.assigneeMemberId === head.id)!.id,
      includeChildren: true,
    }).snapshot!;
    expect(
      stopped.attempts
        .filter((a) => started.attempts.some((old) => old.id === a.id))
        .every((a) => a.status === 'cancelled'),
    ).toBe(true);
  } finally {
    await f.close();
  }
});
it('adds a team to an existing group and synchronizes renamed titles transactionally and on restart', async () => {
  const f = await fixture();
  try {
    const s = f.host.command({
      action: 'create',
      clientRequestId: 'existing',
      kind: 'group',
      title: '原名',
      workspaceId: f.workspace.id,
      agentIds: [f.roster[0].id, f.roster[3].id],
      coordinatorAgentId: f.roster[3].id,
    }).snapshot!;
    const joined = f.host.command({
      action: 'members',
      conversationId: s.conversation.id,
      addTeamIds: [f.team.id],
      expectedTopologyRevision: 0,
    }).snapshot!;
    expect(joined.members.some((m) => m.kind === 'team')).toBe(true);
    expect(joined.conversation.coordinatorMemberId).toBe('agent:' + f.roster[3].id);
    f.conversations.rename(s.conversation.id as ConversationId, '审查调研');
    expect(f.repository.read(s.conversation.id)!.conversation.title).toBe('审查调研');
    const stale = f.repository.read(s.conversation.id)!;
    stale.conversation.title = '旧成员拼接名';
    stale.revision++;
    f.repository.save(stale);
    const restarted = new CollaborationChatHost(f.repository, f.ports);
    expect(f.repository.read(s.conversation.id)!.conversation.title).toBe('审查调研');
    await restarted.service.stop();
  } finally {
    await f.close();
  }
});

it('keeps multiple teams available while discussion never launches the old frozen graph', async () => {
  const f = await fixture();
  try {
    const extra = Array.from({ length: 9 }, (_, i) =>
      f.agents.create({
        id: ('large-' + i) as AgentId,
        name: '阶段' + i,
        defaultModelId: 'fake-mini' as ModelId,
      }),
    );
    const large = f.teams.create({
      name: '长流程小队',
      mission: '九阶段',
      strategy: 'serial',
      coordinatorAgentId: extra[0].id,
      members: extra.map((a) => ({ agentId: a.id, role: a.name, title: a.name })),
    });
    const s = f.host.command({
      action: 'create',
      clientRequestId: 'multiple',
      kind: 'group',
      title: '两个小队',
      workspaceId: f.workspace.id,
      agentIds: [f.roster[0].id],
      teamIds: [f.team.id, large.id],
      coordinatorAgentId: f.roster[0].id,
    }).snapshot!;
    const reply = f.host.command({
      action: 'send',
      conversationId: s.conversation.id,
      clientRequestId: 'goal',
      text: '执行完整工作流',
    }).snapshot!;
    expect(() => f.host.command(
      {
        action: 'start-workflow',
        conversationId: s.conversation.id,
        clientRequestId: 'workflow',
        parentTaskId: reply.tasks[0].id,
        originMessageId: reply.messages[0].id,
        goal: '交付完整文档',
      },
      s.conversation.coordinatorMemberId,
    )).toThrow('explicit_user_start_required');
    const admitted = f.host.command({ action: 'start-workflow', conversationId: s.conversation.id, clientRequestId: 'user-start', goal: '交付完整文档' }).snapshot!;
    expect(admitted.tasks.filter(t => t.kind === 'task')).toHaveLength(1);
    await f.host.service.pump(f.workspace.id);
    await expect
      .poll(
        () =>
          f.repository
            .read(s.conversation.id)!
            .attempts.some((a) => ['queued', 'running'].includes(a.status)),
        { timeout: 10000 },
      )
      .toBe(false);
    const done = f.repository.read(s.conversation.id)!;
    expect(done.tasks.some((t) => t.kind === 'summary')).toBe(false);
    expect(done.tasks.filter(t => t.purpose === 'coordination')).toHaveLength(1);
    // The fixture returns prose without dispatch or delivery: transport completion is not goal completion.
    const coordinator = done.tasks.find(t => t.purpose === 'coordination')!;
    expect(done.attempts.find(a => a.id === coordinator.currentAttemptId)).toMatchObject({ status: 'failed', error: { code: 'coordination_no_progress' } });
    expect(done.conversation.room!.state).toBe('blocked');
  } finally {
    await f.close();
  }
});
