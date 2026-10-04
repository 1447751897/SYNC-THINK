import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_COLLABORATION_CHAT_POLICY, taskRoomGoalOrigin, type CollaborationSnapshot } from '@sync-think/shared';
import { CollaborationChatService, type CollaborationExecutionInput, type CollaborationExecutionResult } from './collaboration-chat-service.js';
import { buildTaskRoomContext, createTaskRoom, ensureTaskRoomDirectory, readTaskRoomContext } from './task-room.js';

const time = '2026-09-30T00:00:00Z';
function room(id: string): CollaborationSnapshot {
  return { conversation: { id, workspaceId: 'workspace', kind: 'group', title: '小说 ' + id, coordinatorMemberId: 'agent:leader', createdAt: time, policy: { ...DEFAULT_COLLABORATION_CHAT_POLICY }, room: createTaskRoom(time) },
    members: [{ id: 'user', kind: 'user', name: '用户', avatar: '', role: 'user', active: true },
      { id: 'agent:leader', agentId: 'leader', kind: 'agent', name: '负责人', avatar: '', role: '协调', active: true },
      { id: 'agent:writer', agentId: 'writer', kind: 'agent', name: '主笔', avatar: '', role: '写作', active: true }],
    tasks: [], attempts: [], messages: [], deliveries: [], revision: 0, receipts: {} };
}
function repository(...snapshots: CollaborationSnapshot[]) {
  const data = new Map(snapshots.map(s => [s.conversation.id, structuredClone(s)]));
  return { read: (id: string) => structuredClone(data.get(id)), list: (id?: string) => [...data.values()].filter(s => !id || id === s.conversation.workspaceId).map(s => structuredClone(s)), save: (s: CollaborationSnapshot) => { data.set(s.conversation.id, structuredClone(s)); }, transaction: <T>(work: () => T) => work() };
}
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
const services: CollaborationChatService[] = [];
afterEach(async () => { for (const s of services.splice(0)) await s.stop(); });
function setup(execute: (input: CollaborationExecutionInput) => Promise<CollaborationExecutionResult>) {
  const repo = repository(room('A'), room('B'));
  const service = new CollaborationChatService(repo, { ownerId: 'owner', execute, onChanged: vi.fn(), resourceClaims: snapshot => [{ key: snapshot.conversation.id, mode: 'read' }], id: (() => { let n = 0; return () => 'id-' + ++n; })() });
  services.push(service); return { repo, service };
}
const send = (conversationId: string, clientRequestId: string, intent: 'work' | 'discussion' = 'work') => ({ action: 'send' as const, conversationId, clientRequestId, text: '只写小说' + conversationId, intent, recipientMemberIds: ['agent:writer'] });

describe('task rooms: isolation and durable continuation', () => {
  it('keeps two rooms using the same agent running at once and finishing A does not interrupt B', async () => {
    const started = new Map<string, CollaborationExecutionInput>();
    const finish = new Map<string, () => void>();
    const { service, repo } = setup(input => {
      if (input.task.purpose === 'coordination') return Promise.resolve({ output: '已汇总本群成果' });
      started.set(input.snapshot.conversation.id, input);
      return new Promise(resolve => {
        finish.set(input.snapshot.conversation.id, () => resolve({ output: '本群成果' }));
        input.signal.addEventListener('abort', () => resolve({ output: '' }), { once: true });
      });
    });
    service.send(send('A', 'a')); await flush();
    service.send(send('B', 'b')); await flush();
    expect(started.size).toBe(2);
    expect(started.get('A')!.task.assigneeMemberId).toBe(started.get('B')!.task.assigneeMemberId);
    for (const id of ['A', 'B']) {
      expect(repo.read(id)!.conversation.room!.state).toBe('running');
      expect(started.get(id)!.signal.aborted).toBe(false);
    }
    finish.get('A')!(); await flush();
    // A fake coordinator response with no artifact is blocked, never a completed delivery.
    expect(repo.read('A')!.conversation.room!.state).toBe('blocked');
    expect(repo.read('B')!.conversation.room!.state).toBe('running');
    expect(started.get('B')!.signal.aborted).toBe(false);
    finish.get('B')!(); await flush();
    expect(repo.read('B')!.conversation.room!.state).toBe('blocked');
  });

  it('runs the same Agent in two rooms without mixing history or context manifests', async () => {
    const seen: CollaborationExecutionInput[] = [];
    const { service, repo } = setup(async input => { seen.push(input); return { output: input.task.instructions, artifacts: [{ id: input.attempt.id + '-art', taskId: input.task.id, attemptId: input.attempt.id, title: input.task.title, kind: 'document', content: input.task.instructions, sha256: 'digest', bytes: 10, createdAt: time }] }; });
    service.send(send('A', 'a')); service.send(send('B', 'b')); await flush();
    expect(seen).toHaveLength(2);
    const a = seen.find(x => x.snapshot.conversation.id === 'A')!;
    expect(buildTaskRoomContext(a.snapshot, a.task, a.attempt)).not.toContain('只写小说B');
    expect(a.attempt.contextManifest?.roomId).toBe('A');
    expect(repo.read('A')!.tasks[0].id).not.toBe(repo.read('B')!.tasks[0].id);
    expect(() => readTaskRoomContext(repo.read('A')!, { kind: 'artifact', id: repo.read('B')!.attempts[0].artifacts![0].id })).toThrow('not_in_room');
  });

  it('pauses only A; preserves progress; resumes a new attempt and ignores late old callbacks', async () => {
    const started: CollaborationExecutionInput[] = [];
    const { service, repo } = setup(input => {
      started.push(input); input.onProgress({ threadId: input.snapshot.conversation.id + ':' + input.task.id, output: '已保存半章' });
      return new Promise(resolve => input.signal.addEventListener('abort', () => resolve({ output: '' }), { once: true }));
    });
    service.send(send('A', 'a')); service.send(send('B', 'b')); await flush();
    service.roomCommand({ action: 'room-pause', conversationId: 'A', clientRequestId: 'pause' });
    expect(repo.read('A')!.conversation.room!.state).toBe('pausing');
    expect(() => service.roomCommand({ action: 'room-resume', conversationId: 'A', clientRequestId: 'too-early' })).toThrow('still_stopping');
    await flush();
    expect(repo.read('A')!.conversation.room!.state).toBe('paused');
    expect(started[0].signal.aborted).toBe(true); expect(started[1].signal.aborted).toBe(false);
    const old = repo.read('A')!.attempts[0];
    expect(old.output).toBe('已保存半章'); expect(old.status).toBe('interrupted');
    expect(() => service.send(send('A', 'blocked-work'))).toThrow('resume_required');
    service.roomCommand({ action: 'room-resume', conversationId: 'A', clientRequestId: 'resume' }); await flush();
    const next = repo.read('A')!.attempts[1];
    expect(next.resumeFromAttemptId).toBe(old.id); expect(next.threadId).toBe(old.threadId);
    expect(started).toHaveLength(3);
    started[0].onProgress({ output: 'stale' });
    expect(repo.read('A')!.attempts[1].output).toBe('已保存半章');
    service.roomCommand({ action: 'room-resume', conversationId: 'A', clientRequestId: 'resume' });
    expect(repo.read('A')!.attempts).toHaveLength(2);
  });

  it('permits consultation while paused without waking queued work', async () => {
    const started: CollaborationExecutionInput[] = [];
    const { service, repo } = setup(async input => { started.push(input); return { output: '回答' }; });
    service.roomCommand({ action: 'room-pause', conversationId: 'A', clientRequestId: 'pause' });
    service.send(send('A', 'question', 'discussion')); await flush();
    expect(started).toHaveLength(1); expect(started[0].task.purpose).toBe('discussion');
    expect(started[0].task.kind).toBe('reply'); expect(started[0].task.deliverable).toBeUndefined();
    expect(repo.read('A')!.conversation.room!.state).toBe('paused');
  });

  it('records immutable goal history and rejects stale updates or premature acceptance', () => {
    const { service, repo } = setup(async () => ({ output: 'ok' }));
    service.roomCommand({ action: 'room-brief', conversationId: 'A', clientRequestId: 'brief', goal: '只写 A', expectedGoalRevision: 0 });
    expect(() => service.roomCommand({ action: 'room-brief', conversationId: 'A', clientRequestId: 'stale', goal: '改成 B', expectedGoalRevision: 0 })).toThrow('goal_revision_conflict');
    expect(repo.read('A')!.messages[0].blocks[0].text).toContain('只写 A');
    service.send(send('A', 'a'));
    expect(() => service.roomCommand({ action: 'room-complete', conversationId: 'A', clientRequestId: 'done' })).toThrow('unfinished_work');
  });

  it('recovers lost owners as paused and requires explicit continuation', async () => {
    const snapshot = room('A');
    const { service, repo } = setup(async () => ({ output: '' }));
    service.send(send('A', 'a'));
    const dirty = repo.read('A')!;
    dirty.attempts[0].status = 'running'; dirty.attempts[0].ownerId = 'dead-owner'; dirty.attempts[0].output = '旧进度';
    repo.save(dirty); service.recover();
    expect(repo.read('A')!.conversation.room!.state).toBe('paused');
    expect(repo.read('A')!.attempts[0].status).toBe('interrupted');
    expect(snapshot.conversation.room!.state).toBe('discussion');
    await flush();
    expect(repo.read('A')!.attempts).toHaveLength(1);
  });

  it('deduplicates direct and team membership targeting the same Agent', async () => {
    const started: CollaborationExecutionInput[] = [];
    const { service, repo } = setup(async input => { started.push(input); return { output: '答复' }; });
    const a = repo.read('A')!; a.members.push({ ...a.members[2], id: 'team:novel:writer', teamParticipantId: 'team:novel' }); repo.save(a);
    service.send({ ...send('A', 'question', 'discussion'), recipientMemberIds: ['agent:writer', 'team:novel:writer'] }); await flush();
    expect(started).toHaveLength(1);
  });

  it('wakes the coordinator once per completed member batch rather than expanding a fixed team DAG', async () => {
    const started: string[] = [];
    const fixture = setup(async input => {
      started.push(input.task.title);
      if (input.task.title === '负责人') service.dispatch({ action: 'dispatch', conversationId: 'A', clientRequestId: 'member-job', parentTaskId: input.task.id, originMessageId: input.task.originMessageId, tasks: [{ assigneeMemberId: 'agent:writer', title: '第一章', instructions: '写第一章', purpose: 'work' }] }, input.task.assigneeMemberId);
      return { output: '本轮结果' };
    }); const service = fixture.service;
    service.dispatch({ action: 'dispatch', conversationId: 'A', clientRequestId: 'start', tasks: [{ assigneeMemberId: 'agent:leader', purpose: 'coordination', title: '负责人', instructions: '安排一章' }] }); await flush();
    expect(started).toEqual(['负责人', '第一章', '负责人检查成员成果']);
    expect(fixture.repo.read('A')!.conversation.room!.state).toBe('review');
    await service.pump(); await flush(); expect(started).toHaveLength(3);
  });

  it('returns an empty paused room to discussion, not a stuck running state', () => {
    const { service, repo } = setup(async () => ({ output: '' }));
    service.roomCommand({ action: 'room-pause', conversationId: 'A', clientRequestId: 'pause-empty' });
    service.roomCommand({ action: 'room-resume', conversationId: 'A', clientRequestId: 'resume-empty' });
    expect(repo.read('A')!.conversation.room!.state).toBe('discussion');
    expect(repo.read('A')!.tasks).toHaveLength(0);
  });

  it('replenishes the automatic-message budget only on explicit room continuation', async () => {
    let rounds = 0;
    const fixture = setup(async input => {
      if (input.task.purpose === 'coordination' && rounds++ < 2) service.dispatch({ action: 'dispatch', conversationId: 'A', clientRequestId: 'batch-' + rounds, parentTaskId: input.task.id,
        tasks: [{ assigneeMemberId: 'agent:writer', purpose: 'work', title: '章节' + rounds, instructions: '写一章' }] }, input.task.assigneeMemberId);
      return { output: '本轮结束' };
    }); const service = fixture.service;
    const initial = fixture.repo.read('A')!; initial.conversation.policy.maxAutoMessages = 1; fixture.repo.save(initial);
    service.dispatch({ action: 'dispatch', conversationId: 'A', clientRequestId: 'start-budget', tasks: [{ assigneeMemberId: 'agent:leader', purpose: 'coordination', title: '负责人', instructions: '安排小说' }] });
    await flush(); expect(fixture.repo.read('A')!.conversation.room!.state).toBe('paused');
    expect(rounds).toBe(2);
    service.roomCommand({ action: 'room-resume', conversationId: 'A', clientRequestId: 'continue-budget' });
    await flush(); expect(rounds).toBe(3); expect(fixture.repo.read('A')!.conversation.room!.state).toBe('review');
  });

  it('uses separate real working directories for the same workspace', () => {
    const base = mkdtempSync(join(tmpdir(), 'task-room-path-test-'));
    const a = ensureTaskRoomDirectory(base, 'A'); const b = ensureTaskRoomDirectory(base, 'B');
    writeFileSync(join(a, 'chapter.md'), 'A'); writeFileSync(join(b, 'chapter.md'), 'B');
    expect(a).not.toBe(b); expect(readFileSync(join(a, 'chapter.md'), 'utf8')).toBe('A');
    expect(ensureTaskRoomDirectory(base, 'A')).toBe(a);
    expect(ensureTaskRoomDirectory(base, '../../escape')).toContain(realpathSync.native(base));
  });
});


it('grants workflow start only to the coordinator on human chat turns and turns explicit coordinator work into coordination', async () => {
  const { service, repo } = setup(async () => ({ output: '只回答当前问题' }));
  service.send({ ...send('A', 'chat'), text: '现在呢？', intent: 'chat', recipientMemberIds: ['agent:leader'] });
  service.send({ ...send('A', 'discuss'), intent: 'discussion', recipientMemberIds: ['agent:leader'] });
  service.send({ ...send('A', 'writer-chat'), intent: 'chat' });
  await flush();
  const before = repo.read('A')!;
  expect(before.tasks.map(t => t.workflowStartAllowed)).toEqual([true, undefined, undefined]);
  expect(before.tasks.every(t => t.kind === 'reply' && !t.deliverable)).toBe(true);
  expect(before.conversation.room!.goal).toBe('');
  service.send({ ...send('A', 'work'), recipientMemberIds: ['agent:leader'] });
  await flush();
  const work = repo.read('A')!.tasks.at(-1)!;
  expect(work.purpose).toBe('coordination'); expect(work.deliverable).toBeUndefined();
  expect(work.workflowStartAllowed).toBeUndefined();
});

it('keeps a bounded excerpt and read-back reference for long recent member output instead of omitting it', async () => {
  const { service, repo } = setup(async () => ({ output: '世界观正文：' + '设定。'.repeat(7000) }));
  service.send(send('A', 'world', 'discussion')); await flush();
  service.send({ ...send('A', 'next', 'discussion'), text: '现在请核对世界观', recipientMemberIds: ['agent:leader'] });
  await flush();
  const snapshot = repo.read('A')!;
  const task = snapshot.tasks.at(-1)!;
  const attempt = snapshot.attempts.find(a => a.id === task.currentAttemptId)!;
  const context = buildTaskRoomContext(snapshot, task, attempt);
  const result = snapshot.messages.find(m => m.senderMemberId === 'agent:writer')!;
  expect(attempt.contextManifest?.messageIds).toContain(result.id);
  expect(context).toContain('世界观正文：'); expect(context).toContain('本条正文已截断');
  expect(context.length).toBeLessThan(18000);
  const full = readTaskRoomContext(snapshot, { kind: 'messages', id: result.id }) as { totalCharacters: number; nextOffset: number };
  expect(full.totalCharacters).toBeGreaterThan(20000); expect(full.nextOffset).toBe(12000);
});

it('measures exact scoped text and never reads an artifact from another room', () => {
  const snapshot = room('A');
  expect(readTaskRoomContext(snapshot, { kind: 'measure', text: '雨。\n😀 A' })).toEqual({ characters: 6, charactersWithoutWhitespace: 4, scope: 'entire_text', punctuationIncluded: true });
  expect(() => readTaskRoomContext(snapshot, { kind: 'measure', id: 'foreign' })).toThrow('artifact_not_in_room');
  expect(() => readTaskRoomContext(snapshot, { kind: 'measure' })).toThrow('invalid_measure_text');
  expect(() => readTaskRoomContext(snapshot, { kind: 'measure', text: 'x'.repeat(500001) })).toThrow('invalid_measure_text');
});

it('returns a scoped live roster rather than confusing task index entries with active members', () => {
  const members = readTaskRoomContext(room('A'), { kind: 'members' }) as { members: { id: string; name: string; active: boolean }[] };
  expect(members.members.find(m => m.id === 'agent:writer')).toEqual(expect.objectContaining({ name: '主笔', active: true }));
  expect(members.members).toHaveLength(3);
});
it('does not mark a coordinator-only attempt with no delivered artifact ready for acceptance', async () => {
  const { service, repo } = setup(async () => ({ output: '派工标识有误，未提交成果' }));
  service.dispatch({ action: 'dispatch', conversationId: 'A', clientRequestId: 'no-delivery', tasks: [{ assigneeMemberId: 'agent:leader', purpose: 'coordination', title: '协调', instructions: '写正文' }] });
  await flush(); expect(repo.read('A')!.conversation.room!.state).toBe('blocked');
  expect(repo.read('A')!.attempts.at(-1)?.status).toBe('failed');
  expect(repo.read('A')!.conversation.room!.checkpoint.note).toContain('尚无真实成果');
});

it('returns recoverable scoped roster information for an invalid member id without routing by a fuzzy prefix', () => {
  const { service } = setup(async () => ({ output: '' }));
  expect(() => service.send({ ...send('A', 'bad-id', 'discussion'), recipientMemberIds: ['agent:writ'] })).toThrow('agent:writer');
});

it('rejects accepting a legacy coordinator-only review with no real artifact', async () => {
  const { service, repo } = setup(async () => ({ output: '只有计划' }));
  const snapshot = repo.read('A')!; snapshot.conversation.room!.goal = '写一章'; repo.save(snapshot);
  service.dispatch({ action: 'dispatch', conversationId: 'A', clientRequestId: 'no-artifact', tasks: [{ assigneeMemberId: 'agent:leader', purpose: 'coordination', title: '协调', instructions: '写一章' }] });
  await flush(); expect(() => service.roomCommand({ action: 'room-complete', conversationId: 'A', clientRequestId: 'accept-empty' })).toThrow('unfinished_work');
});


it('does not advertise a hosted document path as an execution-relative file to later members', async () => {
  const { service, repo } = setup(async () => ({ output: 'done', artifacts: [] }));
  service.send(send('A', 'document-read', 'discussion'));
  await flush();
  const snapshot = repo.read('A')!;
  const task = snapshot.tasks[0]; const attempt = snapshot.attempts.find(a => a.id === task.currentAttemptId)!;
  attempt.artifacts = [{ id: 'hosted-doc', taskId: task.id, attemptId: attempt.id, title: '旧正文', kind: 'document', content: '旧正文', storedPath: 'D:/host-root/.sync-think/task-rooms/A/.artifacts/doc.md', sha256: 'fixture', bytes: 9, createdAt: time }];
  const context = buildTaskRoomContext(snapshot, task, attempt);
  expect(context).toContain('hosted-doc'); expect(context).toContain('按产物 ID 读取');
  expect(context).not.toContain('D:/host-root/');
  snapshot.conversation.topologyRevision = 4;
  expect(readTaskRoomContext(snapshot, { kind: 'members' })).toEqual(expect.objectContaining({ topologyRevision: 4, coordinatorMemberId: 'agent:leader' }));
});


it('keeps casual chat free of production instructions while retaining real work context', async () => {
  const { service, repo } = setup(async () => ({ output: '正常回复' }));
  const initial = repo.read('A')!;
  initial.conversation.room!.goal = '历史工作要求：至少交付十份文档';
  repo.save(initial);
  service.send({ ...send('A', 'casual', 'discussion'), text: '请转达一句问候' }); await flush();
  let snapshot = repo.read('A')!;
  let task = snapshot.tasks[0]; let attempt = snapshot.attempts.find(a => a.id === task.currentAttemptId)!;
  let context = buildTaskRoomContext(snapshot, task, attempt);
  expect(context).toContain('deliveryMode="handoff"'); expect(context).toContain('原样输出');
  expect(context).not.toContain('历史工作要求：至少交付十份文档');
  expect(context).not.toContain('字符上限必须'); expect(context).not.toContain('检查点：');
  service.send(send('A', 'real-work')); await flush();
  snapshot = repo.read('A')!; task = snapshot.tasks.find(t => t.purpose === 'work')!;
  attempt = snapshot.attempts.find(a => a.id === task.currentAttemptId)!;
  context = buildTaskRoomContext(snapshot, task, attempt);
  expect(context).toContain('历史工作要求：至少交付十份文档');
  expect(context).toContain('只有真实工具成功才算交付'); expect(context).toContain('字符上限必须');
});

it('retains a structured blocker and explicitly resumes only the retryable unfinished work', async () => {
  let count = 0;
  const { service, repo } = setup(async ({ task, attempt }) => {
    if (!count++) return { output: '联网未开启', error: { code: 'work_blocked', category: 'permission', message: '请启用本群联网读取后继续', retryable: true, traceId: 'trace' } };
    return { output: '交付', artifacts: [{ id: 'artifact', taskId: task.id, attemptId: attempt.id, kind: 'document', title: '证据', content: '真实内容', sha256: 'hash', bytes: 12, createdAt: time }] };
  });
  service.dispatch({ action: 'dispatch', conversationId: 'A', clientRequestId: 'blocked-job', tasks: [{ assigneeMemberId: 'agent:writer', purpose: 'work', title: '分析', instructions: '读取证据', deliverable: { kind: 'document', title: '证据' } }] });
  await flush();
  expect(repo.read('A')!.conversation.room!.state).toBe('blocked');
  expect(repo.read('A')!.messages.some(m => m.kind === 'task_result')).toBe(true);
  expect(() => service.roomCommand({ action: 'room-complete', conversationId: 'A', clientRequestId: 'premature' })).toThrow('unfinished_work');
  service.updatePolicy({ action: 'policy', conversationId: 'A', policy: { networkEnabled: true } });
  service.roomCommand({ action: 'room-resume', conversationId: 'A', clientRequestId: 'continue-after-fix' });
  await flush();
  expect(repo.read('A')!.attempts).toHaveLength(2);
  expect(repo.read('A')!.conversation.room!.state).toBe('review');
  expect(repo.read('A')!.attempts[0]?.error?.message).toContain('联网');
  expect(repo.read('A')!.attempts[1]?.resumeFromAttemptId).toBe(repo.read('A')!.attempts[0]!.id);
});

it('keeps assistant summaries distinct from human goals and recognizes legacy first summaries', async () => {
  const { service, repo } = setup(async () => ({ output: '本轮结束' }));
  service.roomCommand({ action: 'room-brief', conversationId: 'A', clientRequestId: 'automatic', goal: '模板流水线', expectedGoalRevision: 0 }, 'assistant');
  expect(repo.read('A')!.conversation.room!.goalOrigin).toBe('assistant');
  expect(repo.read('A')!.messages[0].blocks[0].text).toContain('已自动整理工作目标');
  service.roomCommand({ action: 'room-brief', conversationId: 'A', clientRequestId: 'automatic', goal: '模板流水线', expectedGoalRevision: 0 });
  expect(repo.read('A')!.conversation.room!.goalOrigin).toBe('assistant'); // replay does not change authorship
  service.roomCommand({ action: 'room-brief', conversationId: 'A', clientRequestId: 'human-edit', goal: '只分析给定仓库', expectedGoalRevision: 1 });
  expect(repo.read('A')!.conversation.room).toMatchObject({ goalOrigin: 'user', goalRevision: 2 });
  const legacy = room('B'); legacy.conversation.room!.goalRevision = 1;
  legacy.receipts['room-brief:start-brief:chat:old-task'] = 'old-goal-message';
  expect(taskRoomGoalOrigin(legacy)).toBe('assistant');
  legacy.conversation.room!.goalOrigin = 'user'; expect(taskRoomGoalOrigin(legacy)).toBe('user');
  delete legacy.conversation.room!.goalOrigin; legacy.conversation.room!.goalRevision = 2;
  expect(taskRoomGoalOrigin(legacy)).toBe('user');
  legacy.receipts['room-brief:start-brief:chat:second-task'] = 'second';
  expect(taskRoomGoalOrigin(legacy)).toBe('assistant');
  legacy.receipts['room-brief:manual-edit'] = 'third'; legacy.conversation.room!.goalRevision = 3;
  expect(taskRoomGoalOrigin(legacy)).toBe('user');
  legacy.receipts['room-brief:start-brief:chat:fourth-task'] = 'fourth'; legacy.conversation.room!.goalRevision = 4;
  expect(taskRoomGoalOrigin(legacy)).toBe('assistant');
});

it('labels automatically summarized work as background without weakening a human goal', async () => {
  const { service, repo } = setup(async () => ({ output: '本轮结束' }));
  service.roomCommand({ action: 'room-brief', conversationId: 'A', clientRequestId: 'auto-goal', goal: '候选筛选，然后全员跑流水线', expectedGoalRevision: 0 }, 'assistant');
  service.dispatch({ action: 'dispatch', conversationId: 'A', clientRequestId: 'context-check', tasks: [{ assigneeMemberId: 'agent:leader', purpose: 'coordination', title: '分析', instructions: '分析用户给定的仓库' }] });
  await flush(); const snapshot = repo.read('A')!;
  const context = () => buildTaskRoomContext(snapshot, snapshot.tasks[0], snapshot.attempts[0]);
  expect(context()).toContain('origin="assistant-summary"');
  expect(context()).toContain('自动添加的候选筛选');
  expect(context()).toContain('用户真正提出的范围与验收要求');
  snapshot.conversation.room!.goalOrigin = 'user';
  expect(context()).toContain('origin="user"');
  expect(context()).not.toContain('以上目标是智能体自动归纳');
});

it('archives an old failed plan on human goal change without retrying it or blocking the new delivery', async () => {
  const { service, repo } = setup(async ({ task, attempt }) => task.title === 'old' ? { output: 'failed', error: { code: 'source', category: 'execution', message: 'old failure', retryable: true, traceId: 'old' } } : { output: 'done', artifacts: [{ id: 'new-document', taskId: task.id, attemptId: attempt.id, title: 'new', kind: 'document', content: 'new', bytes: 3, sha256: 'new', createdAt: time }] });
  service.roomCommand({ action: 'room-brief', conversationId: 'A', clientRequestId: 'goal1', goal: 'old plan', expectedGoalRevision: 0 });
  service.dispatch({ action: 'dispatch', conversationId: 'A', clientRequestId: 'old-job', tasks: [{ assigneeMemberId: 'agent:writer', title: 'old', instructions: 'old', purpose: 'work' }] });
  await flush(); const old = repo.read('A')!; expect(old.conversation.room!.state).toBe('blocked');
  service.roomCommand({ action: 'room-pause', conversationId: 'A', clientRequestId: 'pause-before-goal' });
  service.roomCommand({ action: 'room-brief', conversationId: 'A', clientRequestId: 'goal2', goal: 'new plan', expectedGoalRevision: 1 });
  service.roomCommand({ action: 'room-resume', conversationId: 'A', clientRequestId: 'continue-new-goal' });
  await flush(); expect(repo.read('A')!.attempts).toHaveLength(1);
  expect(() => service.retry({ action: 'retry', conversationId: 'A', clientRequestId: 'old-retry', taskId: old.tasks[0].id })).toThrow('goal_changed');
  service.dispatch({ action: 'dispatch', conversationId: 'A', clientRequestId: 'new-job', tasks: [{ assigneeMemberId: 'agent:writer', title: 'new', instructions: 'new', purpose: 'work', deliverable: { kind: 'document', title: 'new' } }] });
  await flush(); const after = repo.read('A')!;
  expect(after.conversation.room!.state).toBe('review');
  expect(after.conversation.room!.checkpoint.artifactIds).toEqual(['new-document']);
  expect(after.conversation.room!.checkpoint.pendingTaskIds).toEqual([]);
  expect(after.tasks[0].goalRevision).toBe(1); expect(after.tasks[1].goalRevision).toBe(2);
  expect(after.attempts[0]).toEqual(old.attempts[0]);
  service.roomCommand({ action: 'room-complete', conversationId: 'A', clientRequestId: 'accept-new' });
  expect(repo.read('A')!.conversation.room!.state).toBe('completed');
});


it('replaces failed work explicitly without hiding failures or accepting an unfinished replacement', async () => {
  let finish: (() => void) | undefined;
  const { service, repo } = setup(({ task, attempt }) => task.title === 'failed' ? Promise.resolve({ output: 'actual failure', error: { code: 'source', category: 'execution', message: 'actual failure', retryable: true, traceId: 'old' } }) : new Promise(resolve => {
    finish = () => resolve({ output: 'done', artifacts: [{ id: 'replacement-document', taskId: task.id, attemptId: attempt.id, title: 'fixed', kind: 'document', content: 'real delivery', bytes: 13, sha256: 'new', createdAt: time }] });
  }));
  service.roomCommand({ action: 'room-brief', conversationId: 'A', clientRequestId: 'goal', goal: 'one document', expectedGoalRevision: 0 });
  const old = service.dispatch({ action: 'dispatch', conversationId: 'A', clientRequestId: 'failed', tasks: [{ assigneeMemberId: 'agent:writer', title: 'failed', instructions: 'work', purpose: 'work', deliverable: { kind: 'document', title: 'document' } }] }).tasks[0];
  await flush(); const failedAttempt = repo.read('A')!.attempts[0];
  const next = service.dispatch({ action: 'dispatch', conversationId: 'A', clientRequestId: 'replace', tasks: [{ assigneeMemberId: 'agent:writer', title: 'fixed', instructions: 'replan', purpose: 'work', replacesTaskId: old.id, deliverable: { kind: 'document', title: 'document' } }] }).tasks[1];
  await flush(); expect(repo.read('A')!.conversation.room!.checkpoint.pendingTaskIds).toEqual([next.id]);
  expect(() => service.roomCommand({ action: 'room-complete', conversationId: 'A', clientRequestId: 'early' })).toThrow('unfinished_work');
  expect(() => service.retry({ action: 'retry', conversationId: 'A', taskId: old.id, clientRequestId: 'old-retry' })).toThrow('task_replaced');
  finish!(); await flush(); const snapshot = repo.read('A')!;
  expect(snapshot.tasks[0].replacedByTaskId).toBe(next.id); expect(snapshot.tasks[1].replacesTaskId).toBe(old.id);
  const index = readTaskRoomContext(snapshot, { kind: 'tasks' }) as { tasks: { id: string; historical: boolean; replacedByTaskId?: string; attempt?: { errorCode?: string } }[] };
  expect(index.tasks[0]).toMatchObject({ historical: true, replacedByTaskId: next.id, attempt: { errorCode: 'source' } });
  expect(index.tasks[1].historical).toBe(false);
  expect(snapshot.attempts[0]).toEqual(failedAttempt); expect(snapshot.conversation.room!.state).toBe('review');
  expect(snapshot.conversation.room!.checkpoint.artifactIds).toEqual(['replacement-document']);
  const link = { action: 'replace-task' as const, conversationId: 'A', taskId: old.id, replacementTaskId: next.id, clientRequestId: 'repair-link' };
  service.replaceTask(link); const revision = repo.read('A')!.revision; service.replaceTask(link); expect(repo.read('A')!.revision).toBe(revision);
  service.roomCommand({ action: 'room-complete', conversationId: 'A', clientRequestId: 'accept' }); expect(repo.read('A')!.conversation.room!.state).toBe('completed');
});

it('rejects replacing active work and rejects dangling downstream dependencies atomically', async () => {
  const { service, repo } = setup(async ({ task }) => ({ output: 'failed', error: { code: 'source', category: 'execution', message: task.title, retryable: true, traceId: 'failure' } }));
  service.roomCommand({ action: 'room-brief', conversationId: 'A', clientRequestId: 'goal', goal: 'chain', expectedGoalRevision: 0 });
  const dispatched = service.dispatch({ action: 'dispatch', conversationId: 'A', clientRequestId: 'chain', tasks: [
    { key: 'first', assigneeMemberId: 'agent:writer', title: 'first', instructions: 'work', deliverable: { kind: 'document', title: 'first' } },
    { assigneeMemberId: 'agent:writer', title: 'second', instructions: 'work', dependsOnTaskIds: ['first'], deliverable: { kind: 'document', title: 'second' } },
  ] });
  const replace = () => service.dispatch({ action: 'dispatch', conversationId: 'A', clientRequestId: 'replace', tasks: [{ assigneeMemberId: 'agent:writer', title: 'fixed', instructions: 'replan', replacesTaskId: dispatched.tasks[0].id, deliverable: { kind: 'document', title: 'first' } }] });
  expect(replace).toThrow('invalid_replacement'); await flush(); const before = repo.read('A');
  expect(replace).toThrow('replacement_has_dependents'); expect(repo.read('A')).toEqual(before);
});
