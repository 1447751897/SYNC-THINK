import { describe, expect, it } from 'vitest';
import type { CollaborationSnapshot } from '@sync-think/shared';
import { CollaborationChatService } from './collaboration-chat-service.js';

function repository(initial: CollaborationSnapshot) {
  const snapshots = new Map([[initial.conversation.id, structuredClone(initial)]]);
  return {
    read: (id: string) => structuredClone(snapshots.get(id)),
    list: (workspaceId?: string) => [...snapshots.values()].filter((s) => !workspaceId || s.conversation.workspaceId === workspaceId).map((s) => structuredClone(s)),
    save: (snapshot: CollaborationSnapshot) => snapshots.set(snapshot.conversation.id, structuredClone(snapshot)),
    transaction: <T>(work: () => T) => work(),
  };
}

function fixture(): CollaborationSnapshot {
  return {
    conversation: { id: 'c', workspaceId: 'w', kind: 'group', title: '协作', coordinatorMemberId: 'agent:a', policy: { allowPeerDirect: false, maxConcurrent: 3, maxMessageHops: 6, maxAutoMessages: 12, taskTimeoutSeconds: 60, statusTimeoutSeconds: 60 }, createdAt: new Date(0).toISOString() },
    members: [
      { id: 'user:local', kind: 'user', name: '用户', avatar: '', role: 'owner', active: true },
      { id: 'agent:a', kind: 'agent', agentId: 'a', name: 'A', avatar: '', role: '协调者', active: true },
      { id: 'agent:b', kind: 'agent', agentId: 'b', name: 'B', avatar: '', role: '执行者', active: true },
    ], messages: [], deliveries: [], tasks: [], attempts: [], revision: 0, receipts: {},
  };
}

describe('CollaborationChatService', () => {
  it('runs independent read tasks concurrently and preserves idempotency', async () => {
    const repo = repository(fixture());
    let resolveA!: (value: { output: string }) => void;
    let resolveB!: (value: { output: string }) => void;
    const started: string[] = [];
    const service = new CollaborationChatService(repo, {
      ownerId: 'runtime', onChanged: () => undefined,
      resourceClaims: () => [{ key: 'workspace:w', mode: 'read' }],
      execute: ({ task }) => {
        started.push(task.title);
        return new Promise((resolve) => task.title === 'A' ? (resolveA = resolve as typeof resolveA) : (resolveB = resolve as typeof resolveB));
      },
      id: (() => { let i = 0; return () => `id-${++i}`; })(),
    });
    const command = { action: 'dispatch' as const, conversationId: 'c', clientRequestId: 'r1', tasks: [
      { key: 'a', assigneeMemberId: 'agent:b', title: 'A', instructions: 'A', resourceClaims: [{ key: 'workspace:w', mode: 'read' as const }] },
      { key: 'b', assigneeMemberId: 'agent:b', title: 'B', instructions: 'B', resourceClaims: [{ key: 'workspace:w', mode: 'read' as const }] },
    ] };
    service.dispatch(command);
    await service.pump('w');
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(started).toHaveLength(2);
    resolveA({ output: 'A done' }); resolveB({ output: 'B done' });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(repo.read('c')?.attempts.filter((a) => a.status === 'succeeded')).toHaveLength(2);
  });

  it('keeps a dependent task queued until its prerequisite succeeds', async () => {
    const repo = repository(fixture());
    let finish!: (value: { output: string }) => void;
    const service = new CollaborationChatService(repo, { ownerId: 'runtime', onChanged: () => undefined, resourceClaims: () => [{ key: 'w', mode: 'read' }], execute: () => new Promise((resolve) => { finish = resolve; }) });
    service.dispatch({ action: 'dispatch', conversationId: 'c', clientRequestId: 'r2', tasks: [
      { key: 'first', assigneeMemberId: 'agent:b', title: 'first', instructions: 'first' },
      { key: 'second', assigneeMemberId: 'agent:b', title: 'second', instructions: 'second', dependsOnTaskIds: ['first'] },
    ] });
    await service.pump('w');
    const second = repo.read('c')!.tasks.find((t) => t.title === 'second')!;
    expect(repo.read('c')!.attempts.find((a) => a.id === second.currentAttemptId)?.status).toBe('queued');
    finish({ output: 'done' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(repo.read('c')!.attempts.find((a) => a.id === second.currentAttemptId)?.status).toBe('running');
    expect(repo.read('c')!.tasks).toHaveLength(2);
  });

  it('creates a new attempt on retry and leaves the old attempt intact', () => {
    const repo = repository(fixture());
    const service = new CollaborationChatService(repo, { ownerId: 'runtime', onChanged: () => undefined, resourceClaims: () => [], execute: async () => ({ output: '', error: { code: 'x', category: 'execution', message: 'x', retryable: true, traceId: 't' } }) });
    service.dispatch({ action: 'dispatch', conversationId: 'c', clientRequestId: 'r3', tasks: [{ key: 'x', assigneeMemberId: 'agent:b', title: 'x', instructions: 'x' }] });
    return service.pump('w').then(() => new Promise<void>((resolve) => setTimeout(() => {
      const current = repo.read('c')!;
      const task = current.tasks[0]!;
      expect(current.attempts[0]!.status).toBe('failed');
      const retried = service.retry({ action: 'retry', conversationId: 'c', taskId: task.id, clientRequestId: 'retry-1' });
      expect(retried.attempts.filter((attempt) => attempt.taskId === task.id)).toHaveLength(2);
      expect(retried.attempts[0]!.status).toBe('failed');
      resolve();
    }, 20)));
  });

  it('retries failed message deliveries idempotently without duplicating delivery rows', async () => {
    const repo = repository(fixture());
    const service = new CollaborationChatService(repo, {
      ownerId: 'runtime', onChanged: () => undefined, resourceClaims: () => [],
      execute: async () => ({
        output: '',
        error: { code: 'failed', category: 'delivery', message: '发送失败', retryable: true, traceId: 'trace' },
      }),
    });
    const sent = service.send({
      action: 'send', conversationId: 'c', clientRequestId: 'message-retry-root',
      text: '请处理', recipientMemberIds: ['agent:b'], expectsResponse: true,
    });
    await service.pump('w');
    await new Promise((resolve) => setTimeout(resolve, 10));
    const failed = repo.read('c')!;
    expect(failed.deliveries[0]?.status).toBe('failed');

    const request = {
      action: 'retry-message' as const,
      conversationId: 'c', messageId: sent.messages[0]!.id, clientRequestId: 'message-retry-1',
    };
    const retried = service.retryMessage(request);
    const duplicate = service.retryMessage(request);

    expect(retried.attempts).toHaveLength(2);
    const messageDeliveries = retried.deliveries.filter((delivery) =>
      delivery.messageId === sent.messages[0]!.id,
    );
    expect(messageDeliveries).toHaveLength(1);
    expect(messageDeliveries[0]?.status).toBe('queued');
    expect(duplicate.revision).toBe(retried.revision);
  });

  it('returns the same snapshot for a repeated dispatch request', () => {
    const repo = repository(fixture());
    const service = new CollaborationChatService(repo, {
      ownerId: 'runtime', onChanged: () => undefined, resourceClaims: () => [],
      execute: async () => ({ output: 'done' }),
    });
    const command = { action: 'dispatch' as const, conversationId: 'c', clientRequestId: 'same-request', tasks: [
      { key: 'same', assigneeMemberId: 'agent:b', title: 'once', instructions: 'once' },
    ] };
    const first = service.dispatch(command);
    const second = service.dispatch(command);
    expect(second.revision).toBe(first.revision);
    expect(second.tasks.map((task) => task.id)).toEqual(first.tasks.map((task) => task.id));
    expect(repo.read('c')!.tasks).toHaveLength(1);
  });

  it('persists an immutable formal plan revision reference on dispatched tasks', () => {
    const repo = repository(fixture());
    const service = new CollaborationChatService(repo, {
      ownerId: 'runtime', onChanged: () => undefined, resourceClaims: () => [],
      execute: async () => ({ output: 'done' }),
    });

    const next = service.dispatch({
      action: 'dispatch', conversationId: 'c', clientRequestId: 'plan-task',
      tasks: [{
        assigneeMemberId: 'agent:b', title: '实现步骤', instructions: '按批准计划执行',
        planRef: { planId: 'formal-plan-1', revision: 3, stepId: 'step-2' },
      }],
    });

    expect(next.tasks[0]?.planRef).toEqual({
      planId: 'formal-plan-1', revision: 3, stepId: 'step-2',
    });
  });

  it('returns the same message for a repeated send request', () => {
    const repo = repository(fixture());
    const service = new CollaborationChatService(repo, {
      ownerId: 'runtime', onChanged: () => undefined, resourceClaims: () => [],
      execute: async () => ({ output: '' }),
    });
    const command = { action: 'send' as const, conversationId: 'c', clientRequestId: 'same-message', text: '幂等消息', recipientMemberIds: ['agent:a'] };
    const first = service.send(command);
    const second = service.send(command);
    expect(second.revision).toBe(first.revision);
    expect(second.messages.map((message) => message.id)).toEqual(first.messages.map((message) => message.id));
    expect(repo.read('c')!.messages).toHaveLength(1);
  });

  it('keeps a late result on the old attempt after retry creates a new current attempt', async () => {
    const repo = repository(fixture());
    let resolveFirst!: (value: { output: string }) => void;
    let invocation = 0;
    const service = new CollaborationChatService(repo, {
      ownerId: 'runtime', onChanged: () => undefined, resourceClaims: () => [],
      execute: () => {
        invocation += 1;
        if (invocation === 1) return new Promise((resolve) => { resolveFirst = resolve; });
        return Promise.resolve({ output: 'retry result' });
      },
    });
    service.dispatch({ action: 'dispatch', conversationId: 'c', clientRequestId: 'late-root', tasks: [{ key: 'late', assigneeMemberId: 'agent:b', title: 'late', instructions: 'late' }] });
    await service.pump('w');
    const task = repo.read('c')!.tasks[0]!;
    // Cancel the first execution after it has been claimed. Its eventual
    // completion is deliberately delivered after the replacement attempt.
    service.cancel({ action: 'cancel', conversationId: 'c', taskId: task.id });
    resolveFirst({ output: 'old result' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const retried = service.retry({ action: 'retry', conversationId: 'c', taskId: task.id, clientRequestId: 'late-retry' });
    await service.pump('w');
    await new Promise((resolve) => setTimeout(resolve, 10));
    const final = repo.read('c')!;
    const currentAttempt = final.attempts.find((attempt) => attempt.id === retried.tasks[0]!.currentAttemptId)!;
    expect(currentAttempt.output).toBe('retry result');
    expect(final.attempts.some((attempt) => attempt.output === 'old result')).toBe(true);
  });

  it('cancels only the selected task unless children are explicitly included', async () => {
    const repo = repository(fixture());
    const service = new CollaborationChatService(repo, {
      ownerId: 'runtime', onChanged: () => undefined, resourceClaims: () => [],
      execute: async ({ task }) => ({ output: task.title }),
    });
    service.dispatch({ action: 'dispatch', conversationId: 'c', clientRequestId: 'cancel-scope', tasks: [
      { key: 'parent', assigneeMemberId: 'agent:b', title: '父任务', instructions: '父' },
      { key: 'other', assigneeMemberId: 'agent:b', title: '独立任务', instructions: '独立' },
    ] });
    const before = repo.read('c')!;
    const parent = before.tasks.find((task) => task.title === '父任务')!;
    service.cancel({ action: 'cancel', conversationId: 'c', taskId: parent.id });
    const after = repo.read('c')!;
    expect(after.attempts.find((attempt) => attempt.taskId === parent.id)?.status).toMatch(/stopping|cancelled/);
    const other = after.tasks.find((task) => task.title === '独立任务')!;
    expect(after.attempts.find((attempt) => attempt.taskId === other.id)?.status).toBe('queued');
  });

  it('marks active attempts as interrupted during startup recovery', () => {
    const initial = fixture();
    initial.messages = [{ id: 'msg-recover', conversationId: 'c', senderMemberId: 'user:local', recipientMemberIds: ['agent:b'], mentions: [], kind: 'task_assignment', blocks: [{ type: 'text', text: '恢复任务' }], expectsResponse: true, correlationId: 'recover-correlation', hopCount: 0, sequence: 1, createdAt: new Date(0).toISOString() }];
    initial.tasks = [{ id: 'task-recover', rootTaskId: 'task-recover', originMessageId: 'msg-recover', assigneeMemberId: 'agent:b', title: '恢复任务', instructions: '恢复', expectedOutput: '', dependsOnTaskIds: [], contextRefs: [], resourceClaims: [], returnTo: { conversationId: 'c', replyToMessageId: 'msg-recover' }, timeoutSeconds: 60, currentAttemptId: 'attempt-recover', kind: 'task', createdAt: new Date(0).toISOString() }];
    initial.attempts = [{ id: 'attempt-recover', taskId: 'task-recover', number: 1, status: 'running', ownerId: 'old-runtime', updatedAt: new Date(0).toISOString(), contextSequence: 0, output: '部分结果', resourceClaims: [], tools: [], checklist: [] }];
    const repo = repository(initial);
    const service = new CollaborationChatService(repo, { ownerId: 'new-runtime', onChanged: () => undefined, resourceClaims: () => [], execute: async () => ({ output: '' }) });
    const recovered = service.recover();
    const snapshot = repo.read('c')!;
    expect(recovered).toHaveLength(1);
    expect(snapshot.attempts[0]!.status).toBe('interrupted');
    expect(snapshot.attempts[0]!.error?.code).toBe('owner_lost');
    expect(snapshot.attempts[0]!.output).toBe('部分结果');
  });

  it('routes ordinary coordinator replies while peer direct mode is disabled', () => {
    const repo = repository(fixture());
    const service = new CollaborationChatService(repo, {
      ownerId: 'runtime', onChanged: () => undefined, resourceClaims: () => [],
      execute: async () => ({ output: '' }),
    });
    const userMessage = service.send({
      action: 'send', conversationId: 'c', clientRequestId: 'direct-root', text: 'start',
      recipientMemberIds: ['agent:a'], expectsResponse: false,
    });
    const next = service.send({
      action: 'send', conversationId: 'c', clientRequestId: 'direct-1', text: 'hello',
      recipientMemberIds: ['agent:b'], replyToMessageId: userMessage.messages[0]!.id,
    }, 'agent:a');
    expect(next.messages.at(-1)?.recipientMemberIds).toEqual(['agent:b']);
  });

  it('allows direct messages after the group policy is explicitly enabled', () => {
    const repo = repository(fixture());
    const service = new CollaborationChatService(repo, {
      ownerId: 'runtime', onChanged: () => undefined, resourceClaims: () => [],
      execute: async () => ({ output: '' }),
    });
    service.updatePolicy({ action: 'policy', conversationId: 'c', policy: { allowPeerDirect: true } });
    const userMessage = service.send({
      action: 'send', conversationId: 'c', clientRequestId: 'direct-root-2', text: 'start',
      recipientMemberIds: ['agent:a'], expectsResponse: false,
    });
    const next = service.send({
      action: 'send', conversationId: 'c', clientRequestId: 'direct-2', text: 'hello',
      recipientMemberIds: ['agent:b'], replyToMessageId: userMessage.messages[0]!.id,
    }, 'agent:a');
    expect(next.messages.at(-1)?.recipientMemberIds).toEqual(['agent:b']);
  });

  it('revokes queued peer-direct work while leaving active attempts running', () => {
    const initial = fixture();
    initial.conversation.kind = 'direct';
    initial.conversation.parentConversationId = 'parent-group';
    initial.messages = [{
      id: 'peer-message', conversationId: 'c', senderMemberId: 'agent:a',
      recipientMemberIds: ['agent:b'], mentions: [{ memberId: 'agent:b', label: 'B' }],
      kind: 'task_assignment', blocks: [{ type: 'text', text: 'peer work' }],
      expectsResponse: true, correlationId: 'peer-correlation', hopCount: 1,
      sequence: 1, createdAt: new Date(0).toISOString(),
    }];
    initial.tasks = [
      {
        id: 'queued-task', rootTaskId: 'queued-task', originMessageId: 'peer-message',
        assigneeMemberId: 'agent:b', title: 'queued', instructions: 'queued', expectedOutput: '',
        dependsOnTaskIds: [], contextRefs: [], resourceClaims: [],
        returnTo: { conversationId: 'c', replyToMessageId: 'peer-message' }, timeoutSeconds: 60,
        currentAttemptId: 'queued-attempt', kind: 'reply', createdAt: new Date(0).toISOString(),
      },
      {
        id: 'running-task', rootTaskId: 'running-task', originMessageId: 'peer-message',
        assigneeMemberId: 'agent:b', title: 'running', instructions: 'running', expectedOutput: '',
        dependsOnTaskIds: [], contextRefs: [], resourceClaims: [],
        returnTo: { conversationId: 'c', replyToMessageId: 'peer-message' }, timeoutSeconds: 60,
        currentAttemptId: 'running-attempt', kind: 'reply', createdAt: new Date(0).toISOString(),
      },
    ];
    initial.attempts = [
      { id: 'queued-attempt', taskId: 'queued-task', number: 1, status: 'queued', updatedAt: new Date(0).toISOString(), contextSequence: 1, output: '', resourceClaims: [], tools: [], checklist: [] },
      { id: 'running-attempt', taskId: 'running-task', number: 1, status: 'running', ownerId: 'runtime', updatedAt: new Date(0).toISOString(), contextSequence: 1, output: '', resourceClaims: [], tools: [], checklist: [] },
    ];
    initial.deliveries = [
      { id: 'queued-delivery', messageId: 'peer-message', recipientMemberId: 'agent:b', status: 'queued', attemptId: 'queued-attempt' },
      { id: 'running-delivery', messageId: 'peer-message', recipientMemberId: 'agent:b', status: 'processing', attemptId: 'running-attempt' },
    ];
    const repo = repository(initial);
    const service = new CollaborationChatService(repo, {
      ownerId: 'runtime', onChanged: () => undefined, resourceClaims: () => [],
      execute: async () => ({ output: '' }),
    });

    const next = service.revokeQueuedPeerDirectWork('c');

    expect(next.attempts.find((attempt) => attempt.id === 'queued-attempt')?.status).toBe('cancelled');
    expect(next.deliveries.find((delivery) => delivery.id === 'queued-delivery')?.status).toBe('cancelled');
    expect(next.attempts.find((attempt) => attempt.id === 'running-attempt')?.status).toBe('running');
    expect(next.deliveries.find((delivery) => delivery.id === 'running-delivery')?.status).toBe('processing');
  });

  it('rejects sends and dispatches from a member removed from the group', () => {
    const repo = repository(fixture());
    const service = new CollaborationChatService(repo, {
      ownerId: 'runtime', onChanged: () => undefined, resourceClaims: () => [],
      execute: async () => ({ output: '' }),
    });
    const removed = repo.read('c')!;
    removed.members = removed.members.map((member) => member.id === 'agent:b' ? { ...member, active: false } : member);
    repo.save({ ...removed, revision: removed.revision + 1 });
    expect(() => service.send({
      action: 'send', conversationId: 'c', clientRequestId: 'removed-send', text: 'still here',
      recipientMemberIds: ['agent:a'], expectsResponse: false,
    }, 'agent:b')).toThrow('collaboration.sender_inactive');
    expect(() => service.dispatch({
      action: 'dispatch', conversationId: 'c', clientRequestId: 'removed-dispatch',
      tasks: [{ key: 'removed', assigneeMemberId: 'agent:b', title: '被移除成员任务', instructions: '执行' }],
    }, 'agent:b')).toThrow('collaboration.sender_inactive');
  });

  it('retains task result messages and creates one deduplicated summary task', async () => {
    const repo = repository(fixture());
    const service = new CollaborationChatService(repo, {
      ownerId: 'runtime', onChanged: () => undefined, resourceClaims: () => [],
      execute: async ({ task }) => ({ output: `${task.title} complete` }),
    });
    service.dispatch({ action: 'dispatch', conversationId: 'c', clientRequestId: 'summary-root', tasks: [
      { key: 'one', assigneeMemberId: 'agent:b', title: 'one', instructions: 'one' },
      { key: 'two', assigneeMemberId: 'agent:b', title: 'two', instructions: 'two' },
    ] });
    await service.pump('w');
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const completed = repo.read('c')!;
    expect(completed.messages.filter((message) => message.kind === 'task_result')).toHaveLength(3);
    const summaries = completed.tasks.filter((task) => task.kind === 'summary');
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.instructions).toContain('one complete');
    const before = completed.revision;
    await service.pump('w');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(repo.read('c')!.tasks.filter((task) => task.kind === 'summary')).toHaveLength(1);
    expect(repo.read('c')!.revision).toBeGreaterThanOrEqual(before);
  });

  it('records a delayed status observation when the probe reports completion without notification', async () => {
    const initial = fixture();
    const repo = repository(initial);
    let resolveExecution!: (value: { output: string }) => void;
    let probeCalls = 0;
    const service = new CollaborationChatService(repo, {
      ownerId: 'runtime', onChanged: () => undefined, resourceClaims: () => [],
      execute: () => new Promise((resolve) => { resolveExecution = resolve; }),
      probeStatus: async () => { probeCalls += 1; return { status: 'succeeded', output: '权威结果' }; },
      now: (() => { let current = 0; return () => new Date(current++ * 1000).toISOString(); })(),
    });
    service.updatePolicy({ action: 'policy', conversationId: 'c', policy: { statusTimeoutSeconds: 1 } });
    service.dispatch({ action: 'dispatch', conversationId: 'c', clientRequestId: 'probe-complete', tasks: [{ key: 'probe', assigneeMemberId: 'agent:b', title: '核对状态', instructions: '核对' }] });
    await service.pump('w');
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(probeCalls).toBeGreaterThanOrEqual(1);
    const attempt = repo.read('c')!.attempts[0]!;
    expect(attempt.observation).toBe('notification_delayed');
    expect(attempt.output).toBe('权威结果');
    resolveExecution({ output: '执行器结果' });
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it('marks status observation delivery failures without changing the running state', async () => {
    const repo = repository(fixture());
    let resolveExecution!: (value: { output: string }) => void;
    const service = new CollaborationChatService(repo, {
      ownerId: 'runtime', onChanged: () => undefined, resourceClaims: () => [],
      execute: () => new Promise((resolve) => { resolveExecution = resolve; }),
      probeStatus: async () => { throw new Error('probe offline'); },
    });
    service.updatePolicy({ action: 'policy', conversationId: 'c', policy: { statusTimeoutSeconds: 1 } });
    service.dispatch({ action: 'dispatch', conversationId: 'c', clientRequestId: 'probe-failed', tasks: [{ key: 'probe-failed', assigneeMemberId: 'agent:b', title: '探测失败', instructions: '探测' }] });
    await service.pump('w');
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const attempt = repo.read('c')!.attempts[0]!;
    expect(attempt.status).toBe('running');
    expect(attempt.error?.code).toBe('status_delivery_failed');
    resolveExecution({ output: 'done' });
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it('reschedules status observation while the execution remains active', async () => {
    const repo = repository(fixture());
    let resolveExecution!: (value: { output: string }) => void;
    let probes = 0;
    const service = new CollaborationChatService(repo, {
      ownerId: 'runtime', onChanged: () => undefined, resourceClaims: () => [],
      execute: () => new Promise((resolve) => { resolveExecution = resolve; }),
      probeStatus: async () => { probes += 1; return { status: 'running' as const }; },
    });
    service.updatePolicy({ action: 'policy', conversationId: 'c', policy: { statusTimeoutSeconds: 1 } });
    service.dispatch({ action: 'dispatch', conversationId: 'c', clientRequestId: 'probe-repeat', tasks: [{ key: 'probe-repeat', assigneeMemberId: 'agent:b', title: '重复核对', instructions: '重复核对' }] });
    await service.pump('w');
    await new Promise((resolve) => setTimeout(resolve, 2200));
    expect(probes).toBeGreaterThanOrEqual(2);
    expect(repo.read('c')!.attempts[0]!.status).toBe('running');
    resolveExecution({ output: '完成' });
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
});
