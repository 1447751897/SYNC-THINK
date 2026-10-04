import { describe, expect, it } from 'vitest';
import { collaborationSnapshotForMember, type CollaborationSnapshot } from '@sync-think/shared';
import { CollaborationChatService } from './collaboration-chat-service.js';
import { createTaskRoom } from './task-room.js';
import {
  groupConversationPlanningPrompt,
  parseGroupConversationPlan,
  publicConversationHandoffs,
} from './collaboration-group-planning.js';
function fixture(): CollaborationSnapshot {
  return {
    conversation: {
      id: 'c',
      workspaceId: 'w',
      kind: 'group',
      title: '群',
      coordinatorMemberId: 'a',
      createdAt: new Date(0).toISOString(),
      groupDescription: 'B先提议，C质疑，A总结。',
      room: createTaskRoom(new Date(0).toISOString()),
      policy: {
        coordinateDiscussion: true,
        allowGroupMessages: true,
        allowPeerDirect: false,
        maxConcurrent: 3,
        maxMessageHops: 6,
        maxAutoMessages: 12,
        taskTimeoutSeconds: 60,
        statusTimeoutSeconds: 60,
      },
    },
    members: [
      { id: 'u', kind: 'user', name: '用户', avatar: '', role: 'owner', active: true },
      ...['a', 'b', 'c'].map((id) => ({
        id,
        kind: 'agent' as const,
        agentId: id,
        name: id.toUpperCase(),
        avatar: '',
        role: id === 'a' ? '协调员' : '成员',
        active: true,
      })),
    ],
    messages: [],
    tasks: [],
    attempts: [],
    deliveries: [],
    receipts: {},
    revision: 0,
  };
}
function setup(execute: ConstructorParameters<typeof CollaborationChatService>[1]['execute']) {
  let stored = fixture();
  let n = 0;
  const repo = {
    read: () => structuredClone(stored),
    list: () => [structuredClone(stored)],
    save: (s: CollaborationSnapshot) => {
      stored = structuredClone(s);
    },
    transaction: <T>(f: () => T) => f(),
  };
  return {
    service: new CollaborationChatService(repo, {
      ownerId: 'test',
      resourceClaims: () => [{ key: 'w', mode: 'read' }],
      execute,
      onChanged: () => undefined,
      onError: (e) => console.error('GROUP_TEST_ERROR', e),
      id: () => `i${++n}`,
    }),
    read: () => repo.read(),
  };
}
const send = (s: CollaborationChatService, extra = {}) =>
  s.send({
    action: 'send',
    conversationId: 'c',
    clientRequestId: 'human',
    text: '讨论今天的方案',
    intent: 'discussion',
    ...extra,
  });
async function until(p: () => boolean) {
  const end = Date.now() + 4000;
  while (!p()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}
describe('generic group planning', () => {
  it('validates exact actors, modes, unique slots and assignment audience', () => {
    const s = fixture();
    expect(
      parseGroupConversationPlan('{"mode":"sequential","memberIds":["b","c","a"]}', s).memberIds,
    ).toEqual(['b', 'c', 'a']);
    for (const p of [
      { mode: 'single', memberIds: ['no'] },
      { mode: 'parallel', memberIds: ['b', 'b'] },
      { mode: 'none', memberIds: ['b'] },
      { mode: 'single', memberIds: ['u'] },
      { mode: 'single', memberIds: ['b'], assignments: { c: 'wrong' } },
    ])
      expect(() => parseGroupConversationPlan(JSON.stringify(p), s)).toThrow();
  });
  it('runs real replies in order and includes successful predecessor results', async () => {
    const starts: string[] = [];
    const views: Record<string, string> = {};
    const { service, read } = setup(async (i) => {
      if (i.task.conversationPlanning)
        return { output: '{"mode":"sequential","memberIds":["b","c","a"]}' };
      starts.push(i.task.assigneeMemberId);
      views[i.task.assigneeMemberId] = JSON.stringify(i.snapshot.messages);
      return { output: 'actual-' + i.task.assigneeMemberId };
    });
    send(service);
    await service.pump('w');
    await until(() => read().attempts.filter((a) => a.status === 'succeeded').length === 4);
    expect(starts).toEqual(['b', 'c', 'a']);
    expect(views.c).toContain('actual-b');
    expect(views.a).toContain('actual-c');
    expect(
      read()
        .messages.filter((m) => m.senderMemberId !== 'u')
        .map((m) => m.blocks[0]?.text),
    ).toEqual(['actual-b', 'actual-c', 'actual-a']);
    expect(
      read()
        .tasks.filter((t) => t.conversationPlanTaskId)
        .every((t) => !t.workflowStartAllowed),
    ).toBe(true);
    await service.stop();
  });
  it('runs independent contributors concurrently without fake leader opening', async () => {
    const starts: string[] = [];
    const finish: Record<string, (x: { output: string }) => void> = {};
    const { service, read } = setup((i) =>
      i.task.conversationPlanning
        ? Promise.resolve({ output: '{"mode":"parallel","memberIds":["b","c"]}' })
        : new Promise((r) => {
            starts.push(i.task.assigneeMemberId);
            finish[i.task.assigneeMemberId] = r;
          }),
    );
    send(service);
    await service.pump('w');
    await until(() => starts.length === 2);
    expect(starts.sort()).toEqual(['b', 'c']);
    finish.b!({ output: 'B' });
    finish.c!({ output: 'C' });
    await until(() => read().attempts.every((a) => a.status === 'succeeded'));
    await service.stop();
  });
  it('keeps explicit single @ direct', async () => {
    const starts: string[] = [];
    const { service, read } = setup(async (i) => {
      expect(i.task.conversationPlanning).not.toBe(true);
      starts.push(i.task.assigneeMemberId);
      return { output: 'B reply' };
    });
    send(service, { recipientMemberIds: ['b'] });
    await service.pump('w');
    await until(() => read().attempts.every((a) => a.status === 'succeeded'));
    expect(starts).toEqual(['b']);
    await service.stop();
  });
  it('falls back once on malformed plan without publishing JSON', async () => {
    const { service, read } = setup(async (i) => ({
      output: i.task.conversationPlanning ? 'not-json' : 'real coordinator reply',
    }));
    send(service);
    await service.pump('w');
    await until(() => read().attempts.filter((a) => a.status === 'succeeded').length === 2);
    expect(JSON.stringify(read().messages)).not.toContain('not-json');
    expect(read().messages.at(-1)?.blocks[0]?.text).toBe('real coordinator reply');
    await service.stop();
  });
  it('allows explicit silence without a worker turn', async () => {
    const { service, read } = setup(async () => ({ output: '{"mode":"none","memberIds":[]}' }));
    send(service);
    await service.pump('w');
    await until(() => read().attempts[0]?.status === 'succeeded');
    expect(read().tasks).toHaveLength(1);
    expect(read().messages).toHaveLength(1);
    await service.stop();
  });
  it('executes line-leading public handoffs, not prose or fenced quotes', async () => {
    expect(
      publicConversationHandoffs('提到 @B\n```\n@B quoted\n```\n@C 请补充', fixture(), 'a'),
    ).toEqual(['c']);
    const starts: string[] = [];
    const { service, read } = setup(async (i) => {
      if (i.task.conversationPlanning) return { output: '{"mode":"single","memberIds":["b"]}' };
      starts.push(i.task.assigneeMemberId);
      return { output: i.task.assigneeMemberId === 'b' ? '我的意见\n@C 请检查' : 'C 已检查' };
    });
    send(service);
    await service.pump('w');
    await until(
      () => read().tasks.length === 3 && read().attempts.every((a) => a.status === 'succeeded'),
    );
    expect(starts).toEqual(['b', 'c']);
    await service.stop();
  });
  it('gives one bounded failure recovery to coordinator without impersonation', async () => {
    const starts: string[] = [];
    const { service, read } = setup(async (i) => {
      if (i.task.conversationPlanning)
        return { output: '{"mode":"sequential","memberIds":["b","c"]}' };
      starts.push(i.task.assigneeMemberId);
      return i.task.assigneeMemberId === 'b'
        ? {
            output: '',
            error: {
              code: 'offline',
              category: 'execution',
              message: 'offline',
              retryable: true,
              traceId: 'test-offline',
            },
          }
        : { output: '协调员报告阻塞，请确认' };
    });
    send(service);
    await service.pump('w');
    await until(
      () =>
        read().tasks.some((t) => t.conversationRecovery) &&
        read().attempts.filter((a) => a.status === 'succeeded').length === 2,
    );
    expect(starts).toEqual(['b', 'a']);
    expect(read().tasks.filter((t) => t.conversationRecovery)).toHaveLength(1);
    await service.stop();
  });
  it('pause wins over late controller output', async () => {
    let finish!: (x: { output: string }) => void;
    const { service, read } = setup(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
    send(service);
    await service.pump('w');
    await until(() => read().attempts[0]?.status === 'running');
    service.roomCommand({ action: 'room-pause', conversationId: 'c', clientRequestId: 'pause' });
    finish({ output: '{"mode":"parallel","memberIds":["b","c"]}' });
    await until(() => read().attempts[0]?.status === 'interrupted');
    expect(read().tasks).toHaveLength(1);
    expect(read().conversation.room?.state).toBe('paused');
    await service.stop();
  });
  it('persists descriptions with revision conflict and idempotence', () => {
    const { service, read } = setup(async () => ({ output: '' }));
    const cmd = {
      action: 'group-config' as const,
      conversationId: 'c',
      clientRequestId: 'config',
      description: 'B→C→A',
      expectedRevision: 0,
    };
    service.groupConfig(cmd);
    service.groupConfig(cmd);
    expect(read().conversation.groupConfigurationRevision).toBe(1);
    expect(() =>
      service.groupConfig({ ...cmd, clientRequestId: 'stale', description: 'overwrite' }),
    ).toThrow('conflict');
    expect(read().conversation.groupDescription).toBe('B→C→A');
  });
  it('private information-only messages do not wake recipients or reach controller', async () => {
    const { service, read } = setup(async () => ({ output: '' }));
    service.send({
      action: 'send',
      conversationId: 'c',
      clientRequestId: 'card',
      text: 'PRIVATE_CARD_CANARY',
      visibility: 'private',
      recipientMemberIds: ['b'],
      deliveryMode: 'notify',
    });
    expect(read().tasks).toHaveLength(0);
    expect(JSON.stringify(collaborationSnapshotForMember(read(), 'b'))).toContain(
      'PRIVATE_CARD_CANARY',
    );
    expect(JSON.stringify(collaborationSnapshotForMember(read(), 'c'))).not.toContain(
      'PRIVATE_CARD_CANARY',
    );
    const p = collaborationSnapshotForMember(read(), 'a', true);
    expect(groupConversationPlanningPrompt(p, read().messages[0]!.id)).not.toContain(
      'PRIVATE_CARD_CANARY',
    );
    await service.stop();
  });
  it('private request replies and attempts stay in sender/recipient audience', async () => {
    const views: string[] = [];
    const { service, read } = setup(async (i) => {
      views.push(JSON.stringify(i.snapshot));
      return { output: 'PRIVATE_RESPONSE_CANARY' };
    });
    send(service, {
      text: 'PRIVATE_INPUT_CANARY',
      recipientMemberIds: ['b'],
      visibility: 'private',
    });
    await service.pump('w');
    await until(() => read().attempts.every((a) => a.status === 'succeeded'));
    expect(views[0]).toContain('PRIVATE_INPUT_CANARY');
    expect(read().messages.at(-1)?.visibility).toBe('private');
    expect(JSON.stringify(collaborationSnapshotForMember(read(), 'c'))).not.toMatch(
      /PRIVATE_(INPUT|RESPONSE)_CANARY/,
    );
    expect(() =>
      service.send({
        action: 'send',
        conversationId: 'c',
        clientRequestId: 'bad',
        text: 'public',
        visibility: 'public',
        replyToMessageId: read().messages[0]!.id,
      }),
    ).toThrow('private_reply_required');
    await service.stop();
  });
  it('resumes an interrupted planner once without replaying completed contributors', async () => {
    let finish!: (value: { output: string }) => void;
    let routingTurns = 0;
    const members: string[] = [];
    const { service, read } = setup(async (i) => {
      if (i.task.conversationPlanning) {
        routingTurns++;
        if (routingTurns === 1)
          return new Promise((resolve) => {
            finish = resolve;
          });
        return { output: '{"mode":"single","memberIds":["b"]}' };
      }
      members.push(i.task.assigneeMemberId);
      return { output: 'B completed' };
    });
    send(service);
    await service.pump('w');
    await until(() => routingTurns === 1);
    service.roomCommand({ action: 'room-pause', conversationId: 'c', clientRequestId: 'pause' });
    finish({ output: '{"mode":"parallel","memberIds":["b","c"]}' });
    await until(() => read().conversation.room?.state === 'paused');
    service.roomCommand({ action: 'room-resume', conversationId: 'c', clientRequestId: 'resume' });
    await until(
      () =>
        read().tasks.length === 2 &&
        read().attempts.filter((a) => a.status === 'succeeded').length === 2,
    );
    expect(members).toEqual(['b']);
    expect(read().tasks.filter((t) => t.conversationPlanning)).toHaveLength(1);
    expect(read().conversation.room?.state).toBe('discussion');
    await service.stop();
  });
  it('keeps peer handoff loops inside the admitted budget', async () => {
    const { service, read } = setup(async (i) => ({
      output: i.task.conversationPlanning
        ? '{"mode":"single","memberIds":["b"]}'
        : i.task.assigneeMemberId === 'b'
          ? '@C 接着说'
          : '@B 接着说',
    }));
    send(service);
    await service.pump('w');
    await until(
      () => read().tasks.length >= 7 && read().attempts.every((a) => a.status === 'succeeded'),
    );
    const count = read().tasks.length;
    await service.pump('w');
    expect(read().tasks).toHaveLength(count);
    expect(count).toBeLessThanOrEqual(read().conversation.policy.maxAutoMessages);
    await service.stop();
  });
  it('never gives the routing controller a recipient private inbox', async () => {
    let controllerView = '';
    let workerView = '';
    const { service, read } = setup(async (i) => {
      if (i.task.conversationPlanning) {
        controllerView = JSON.stringify(i.snapshot);
        return { output: '{"mode":"single","memberIds":["b"]}' };
      }
      workerView = JSON.stringify(i.snapshot);
      return { output: 'member contribution' };
    });
    service.send({
      action: 'send',
      conversationId: 'c',
      clientRequestId: 'card',
      text: 'SECRET_INBOX_CANARY',
      visibility: 'private',
      recipientMemberIds: ['b'],
      deliveryMode: 'notify',
    });
    send(service);
    await service.pump('w');
    await until(() => read().attempts.every((a) => a.status === 'succeeded'));
    expect(controllerView).not.toContain('SECRET_INBOX_CANARY');
    expect(workerView).toContain('SECRET_INBOX_CANARY');
    await service.stop();
  });
  it('rejects work intent inherited from a private reply without updating the shared goal', () => {
    const { service, read } = setup(async () => ({ output: '' }));
    service.send({
      action: 'send',
      conversationId: 'c',
      clientRequestId: 'private',
      text: 'SECRET_GOAL',
      visibility: 'private',
      recipientMemberIds: ['b'],
      deliveryMode: 'notify',
    });
    expect(() =>
      service.send({
        action: 'send',
        conversationId: 'c',
        clientRequestId: 'work',
        text: 'SECRET_GOAL',
        replyToMessageId: read().messages[0]!.id,
        intent: 'work',
      }),
    ).toThrow('private_work_goal_forbidden');
    expect(read().conversation.room?.goal).toBe('');
    expect(read().messages).toHaveLength(1);
  });
  it('never upgrades a private coordinator chat into shared production authority', async () => {
    const { service, read } = setup(async () => ({ output: '' }));
    send(service, {
      intent: 'chat',
      text: 'private instruction',
      recipientMemberIds: ['a'],
      visibility: 'private',
    });
    expect(read().tasks).toHaveLength(1);
    expect(read().tasks[0]!.workflowStartAllowed).not.toBe(true);
    await service.stop();
  });
});
