import { afterEach, describe, expect, it } from 'vitest';
import type { CollaborationSnapshot, CollaborationTaskDraft } from '@sync-think/shared';
import { CollaborationChatService, type CollaborationExecutionInput, type CollaborationExecutionResult } from './collaboration-chat-service.js';
import { createTaskRoom } from './task-room.js';

const time = '2026-10-03T00:00:00Z';
const services: CollaborationChatService[] = [];
afterEach(async () => { for (const service of services.splice(0)) await service.stop(); });
const flush = async () => { for (let n = 0; n < 5; n++) await new Promise<void>(resolve => setImmediate(resolve)); };
const plan: CollaborationTaskDraft[] = [
  { key: 'world', assigneeMemberId: 'worker', title: '世界观', instructions: '交付世界观', deliverable: { kind: 'document', title: '世界观' } },
  { key: 'outline', assigneeMemberId: 'worker', title: '细纲', instructions: '根据世界观交付细纲', dependsOnTaskIds: ['world'], deliverable: { kind: 'document', title: '细纲' } },
  { key: 'chapter', assigneeMemberId: 'worker', title: '正文', instructions: '根据细纲交付正文', dependsOnTaskIds: ['outline'], deliverable: { kind: 'document', title: '正文' } },
];
function setup() {
  let snapshot: CollaborationSnapshot = {
    conversation: { id: 'c', workspaceId: 'w', kind: 'group', title: '小说小队', coordinatorMemberId: 'leader', createdAt: time,
      policy: { allowPeerDirect: false, maxConcurrent: 3, maxMessageHops: 6, maxAutoMessages: 12, taskTimeoutSeconds: 60, statusTimeoutSeconds: 60 }, room: createTaskRoom(time) },
    members: [
      { id: 'user', kind: 'user', name: '用户', avatar: '', role: 'user', active: true },
      { id: 'leader', kind: 'agent', name: '主策划', avatar: '', role: '协调', active: true },
      { id: 'worker', kind: 'agent', name: '执行者', avatar: '', role: '写作', active: true },
    ], messages: [], deliveries: [], tasks: [], attempts: [], revision: 0, receipts: {},
  };
  const repository = { read: () => structuredClone(snapshot), list: () => [structuredClone(snapshot)],
    save: (next: CollaborationSnapshot) => { snapshot = structuredClone(next); }, transaction: <T>(work: () => T) => work() };
  const active = new Map<string, { input: CollaborationExecutionInput; finish: (result: CollaborationExecutionResult) => void }>();
  const started: string[] = [];
  const makeService = () => {
    const service = new CollaborationChatService(repository, { ownerId: 'owner', resourceClaims: () => [], onChanged: () => {},
      execute: input => new Promise(resolve => {
        started.push(input.task.title);
        active.set(input.task.title, { input, finish: resolve });
        input.signal.addEventListener('abort', () => resolve({ output: '' }), { once: true });
      }),
    });
    services.push(service); return service;
  };
  const finish = (title: string, kind: 'delivered' | 'failed' | 'missing' = 'delivered') => {
    const execution = active.get(title)!;
    active.delete(title);
    execution.finish(kind === 'failed'
      ? { output: '', error: { code: 'provider.timeout', category: 'timeout', message: '细纲执行超时', retryable: true, traceId: 'trace' } }
      : { output: title + '已完成', artifacts: kind === 'missing' ? [] : [{ id: 'artifact-' + execution.input.attempt.id,
        taskId: execution.input.task.id, attemptId: execution.input.attempt.id, kind: 'document', title,
        content: '# ' + title, sha256: 'fixture', bytes: 12, createdAt: time }] });
  };
  return { service: makeService(), makeService, read: repository.read, active, started, finish };
}
const dispatch = (service: CollaborationChatService, tasks = plan, request = 'plan') => service.dispatch({ action: 'dispatch', conversationId: 'c', clientRequestId: request, tasks });
const assignments = (s: CollaborationSnapshot) => s.messages.filter(m => m.kind === 'task_assignment');

describe('delivery-by-delivery staged dispatch', () => {
  it('publishes only the ready stage, then commits each next handoff after the actual delivery', async () => {
    const f = setup();
    const initial = dispatch(f.service);
    expect(assignments(initial)).toHaveLength(1);
    expect(assignments(initial)[0]!.taskId).toBe(initial.tasks[0]!.id);
    expect(initial.tasks.map(t => Boolean(t.pendingAssignment))).toEqual([false, true, true]);
    expect(initial.deliveries).toHaveLength(1);
    expect(dispatch(f.service)).toEqual(initial);
    await f.service.pump('w');
    expect(f.started).toEqual(['世界观']);
    f.finish('世界观'); await flush();
    let current = f.read();
    expect(f.started).toEqual(['世界观', '细纲']);
    expect(assignments(current)).toHaveLength(2);
    const worldResult = current.messages.find(m => m.kind === 'task_result' && m.taskId === current.tasks[0]!.id)!;
    expect(assignments(current)[1]!.sequence).toBeGreaterThan(worldResult.sequence);
    expect(current.tasks[1]!.pendingAssignment).toBeUndefined();
    expect(current.tasks[2]!.pendingAssignment).toBeTruthy();
    await f.service.pump('w');
    expect(assignments(f.read())).toHaveLength(2);
    f.finish('细纲'); await flush();
    current = f.read();
    expect(f.started).toEqual(['世界观', '细纲', '正文']);
    const outlineResult = current.messages.find(m => m.kind === 'task_result' && m.taskId === current.tasks[1]!.id)!;
    expect(assignments(current)[2]!.sequence).toBeGreaterThan(outlineResult.sequence);
    f.finish('正文'); await flush();
    expect(f.read().attempts.every(a => a.status === 'succeeded')).toBe(true);
  });

  it('does not dispatch or fail a downstream stage when its prerequisite fails, and resumes after retry', async () => {
    const f = setup(); dispatch(f.service); await f.service.pump('w');
    f.finish('世界观'); await flush();
    const pending = f.read().tasks[2]!;
    f.finish('细纲', 'failed'); await flush();
    let current = f.read();
    const attempt = current.attempts.find(a => a.id === pending.currentAttemptId)!;
    expect(attempt).toMatchObject({ status: 'queued', waitReason: 'dependency_failed' });
    expect(attempt.startedAt).toBeUndefined(); expect(attempt.finishedAt).toBeUndefined(); expect(attempt.error).toBeUndefined();
    expect(assignments(current)).toHaveLength(2);
    expect(current.messages.some(m => m.taskId === pending.id)).toBe(false);
    expect(current.deliveries.some(d => d.attemptId === pending.currentAttemptId)).toBe(false);
    expect(current.conversation.room!.state).toBe('blocked');
    f.service.retry({ action: 'retry', conversationId: 'c', taskId: current.tasks[1]!.id, clientRequestId: 'retry-outline' });
    await flush();
    expect(assignments(f.read())).toHaveLength(2);
    f.finish('细纲'); await flush();
    current = f.read();
    expect(current.tasks[2]!.currentAttemptId).toBe(pending.currentAttemptId);
    expect(current.attempts.find(a => a.id === pending.currentAttemptId)?.status).toBe('running');
    expect(assignments(current)).toHaveLength(3);
    expect(current.attempts.filter(a => a.taskId === current.tasks[1]!.id)).toHaveLength(2);
    f.finish('正文'); await flush();
  });

  it('requires an actual contracted artifact, not just a successful-looking text reply', async () => {
    const f = setup(); dispatch(f.service); await f.service.pump('w');
    f.finish('世界观', 'missing'); await flush();
    const current = f.read();
    expect(current.attempts[0]!.error?.code).toBe('deliverable_missing');
    expect(assignments(current)).toHaveLength(1);
    expect(current.attempts.slice(1).every(a => a.status === 'queued' && a.waitReason === 'dependency_failed' && !a.error)).toBe(true);
    expect(f.started).toEqual(['世界观']);
  });

  it('retains the downstream plan through owner loss and dispatches it only after the retried delivery', async () => {
    const f = setup(); dispatch(f.service); await f.service.pump('w');
    const original = f.read().tasks[1]!;
    await f.service.stop();
    const restarted = f.makeService(); restarted.recover();
    const world = f.read().tasks[0]!;
    expect(f.read().tasks[1]!.pendingAssignment).toEqual(original.pendingAssignment);
    restarted.retry({ action: 'retry', conversationId: 'c', taskId: world.id, clientRequestId: 'retry-after-restart' });
    await flush();
    expect(assignments(f.read())).toHaveLength(1);
    f.finish('世界观'); await flush();
    expect(assignments(f.read())).toHaveLength(2);
    expect(f.read().tasks[1]!.currentAttemptId).toBe(original.currentAttemptId);
    f.finish('细纲'); await flush(); f.finish('正文'); await flush();
  });

  it('cancels and retries a pending plan without fabricating a delivery or execution receipt', async () => {
    const f = setup(); dispatch(f.service); await f.service.pump('w');
    const chapter = f.read().tasks[2]!;
    f.service.cancel({ action: 'cancel', conversationId: 'c', taskId: chapter.id });
    expect(f.read().messages.some(m => m.taskId === chapter.id)).toBe(false);
    expect(f.read().deliveries.some(d => d.attemptId === chapter.currentAttemptId)).toBe(false);
    f.service.retry({ action: 'retry', conversationId: 'c', taskId: chapter.id, clientRequestId: 'restore-chapter-plan' });
    await flush();
    expect(assignments(f.read())).toHaveLength(1);
    const restored = f.read().tasks[2]!;
    expect(restored.pendingAssignment).toBeTruthy();
    expect(f.read().deliveries.some(d => d.attemptId === restored.currentAttemptId)).toBe(false);
    f.finish('世界观'); await flush(); f.finish('细纲'); await flush();
    expect(assignments(f.read())).toHaveLength(3);
    f.finish('正文'); await flush();
  });

  it('admits a new stage immediately when an existing prerequisite has already delivered', async () => {
    const f = setup(); dispatch(f.service, [plan[0]!]); await f.service.pump('w');
    f.finish('世界观'); await flush();
    dispatch(f.service, [{ ...plan[1]!, dependsOnTaskIds: [f.read().tasks[0]!.id] }], 'next-stage');
    expect(assignments(f.read())).toHaveLength(2);
    expect(f.read().tasks[1]!.pendingAssignment).toBeUndefined();
    await flush(); f.finish('细纲'); await flush();
  });

  it('supports forward references in a plan without premature downstream handoffs', async () => {
    const f = setup(); dispatch(f.service, [plan[1]!, plan[0]!]); await f.service.pump('w');
    expect(f.started).toEqual(['世界观']); expect(assignments(f.read())).toHaveLength(1);
    f.finish('世界观'); await flush();
    expect(f.started).toEqual(['世界观', '细纲']); expect(assignments(f.read())).toHaveLength(2);
    f.finish('细纲'); await flush();
  });
});
