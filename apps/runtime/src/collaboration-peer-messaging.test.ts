import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_COLLABORATION_CHAT_POLICY, type CollaborationSnapshot } from '@sync-think/shared';
import { CollaborationChatService, type CollaborationExecutionInput, type CollaborationExecutionResult } from './collaboration-chat-service.js';
import { buildTaskRoomContext, createTaskRoom } from './task-room.js';

const services: CollaborationChatService[] = [];
afterEach(async () => { for (const service of services.splice(0)) await service.stop(); });
const flush = async () => { for (let n = 0; n < 20; n++) await new Promise(r => setTimeout(r, 0)); };
function fixture(execute: (input: CollaborationExecutionInput) => Promise<CollaborationExecutionResult>) {
  const make = (id: string): CollaborationSnapshot => ({
    conversation: { id, workspaceId: 'w', kind: 'group', title: id, coordinatorMemberId: 'leader', createdAt: '',
      policy: { ...DEFAULT_COLLABORATION_CHAT_POLICY, maxConcurrent: 1 }, room: createTaskRoom('') },
    members: ['user', 'leader', 'writer', 'expert'].map(id => ({ id, name: id, kind: id === 'user' ? 'user' : 'agent',
      agentId: id === 'user' ? undefined : id, role: id, avatar: '', active: true })),
    tasks: [], attempts: [], messages: [], deliveries: [], revision: 0, receipts: {},
  });
  const records = new Map(['A', 'B'].map(id => [id, make(id)]));
  const repo = { read: (id: string) => structuredClone(records.get(id)), list: () => [...records.values()].map(s => structuredClone(s)),
    save: (s: CollaborationSnapshot) => { records.set(s.conversation.id, structuredClone(s)); }, transaction: <T>(fn: () => T) => fn() };
  const service = new CollaborationChatService(repo, { ownerId: 'owner', execute, onChanged: () => {}, resourceClaims: () => [] });
  services.push(service); return { service, repo };
}
const userMessage = (id = 'start', room = 'A') => ({ action: 'send' as const, conversationId: room, clientRequestId: id,
  text: '先咨询设定再回答', recipientMemberIds: ['writer'] });
function consult(service: CollaborationChatService, input: CollaborationExecutionInput, recipient = 'expert', expectsResponse = true) {
  return service.send({ action: 'send', conversationId: input.snapshot.conversation.id,
    clientRequestId: 'consult:' + input.attempt.id, text: '请核对本群设定', recipientMemberIds: [recipient],
    replyToMessageId: input.task.originMessageId, expectsResponse }, input.task.assigneeMemberId, undefined,
  { taskId: input.task.id, attemptId: input.attempt.id });
}

describe('room peer messages and durable joins', () => {
  it('consults without DM permission, releases capacity, returns to original discussion once, and isolates rooms', async () => {
    const calls: CollaborationExecutionInput[] = [];
    const { service, repo } = fixture(async input => {
      calls.push(input);
      if (input.task.assigneeMemberId === 'writer' && input.attempt.number === 1) {
        consult(service, input); consult(service, input); // same receipt is one consultation
        return { output: '等待专家' };
      }
      if (input.task.assigneeMemberId === 'expert') return { output: input.snapshot.conversation.id + ' 专属设定' };
      expect(input.attempt.awaitingPeerTaskIds).toHaveLength(1);
      const context = buildTaskRoomContext(input.snapshot, input.task, input.attempt);
      expect(context).toContain(input.snapshot.conversation.id + ' 专属设定');
      expect(context).not.toContain((input.snapshot.conversation.id === 'A' ? 'B' : 'A') + ' 专属设定');
      return { output: '已结合专家意见' };
    });
    service.send(userMessage()); service.send(userMessage('b', 'B')); await flush();
    for (const id of ['A', 'B']) {
      const s = repo.read(id)!;
      expect(s.conversation.policy.allowPeerDirect).toBe(false);
      expect(s.tasks).toHaveLength(2); expect(s.attempts).toHaveLength(3);
      expect(s.tasks.every(t => t.purpose === 'discussion')).toBe(true);
      expect(s.attempts.every(a => a.status === 'succeeded')).toBe(true);
      const response = s.messages.find(m => m.blocks[0].text === id + ' 专属设定')!;
      expect(response.recipientMemberIds).toEqual(['writer']); expect(response.expectsResponse).toBe(false);
      expect(s.messages.filter(m => m.blocks[0].text === '已结合专家意见')).toHaveLength(1);
      expect(s.conversation.room!.state).toBe('discussion');
    }
    expect(calls).toHaveLength(6);
  });

  it('consults before delivering work and keeps one work item with a fresh continuation', async () => {
    const { service, repo } = fixture(async input => {
      if (input.task.assigneeMemberId === 'expert') return { output: '主角只知道第一章事实' };
      if (input.attempt.number === 1) { consult(service, input); return { output: '请专家核实' }; }
      expect(input.task.purpose).toBe('work'); expect(input.attempt.threadId).toBeUndefined();
      return { output: '首章已写', artifacts: [{ id: 'artifact', taskId: input.task.id, attemptId: input.attempt.id,
        kind: 'document', title: '首章', content: '完整首章', sha256: 'hash', bytes: 12, createdAt: '' }] };
    });
    service.send({ ...userMessage(), intent: 'work' }); await flush();
    const s = repo.read('A')!;
    expect(s.tasks.filter(t => t.kind === 'task')).toHaveLength(1);
    expect(s.tasks.find(t => t.consultation)?.purpose).toBe('discussion');
    expect(s.attempts.every(a => a.status === 'succeeded')).toBe(true);
    expect(s.attempts.flatMap(a => a.artifacts ?? [])).toHaveLength(1);
    expect(s.conversation.room!.state).toBe('review');
  });

  it('routes an explicit reply to its author, explicit mentions override it, and ordinary work start stays with the leader', async () => {
    const { service, repo } = fixture(async () => ({ output: 'writer answer' }));
    service.send(userMessage()); await flush();
    const reply = repo.read('A')!.messages.at(-1)!;
    const routed = service.send({ action: 'send', conversationId: 'A', clientRequestId: 'reply', text: '继续解释', replyToMessageId: reply.id });
    expect(routed.messages.at(-1)!.recipientMemberIds).toEqual(['writer']);
    const explicit = service.send({ action: 'send', conversationId: 'A', clientRequestId: 'explicit', text: '请你解释', replyToMessageId: reply.id, recipientMemberIds: ['expert'] });
    expect(explicit.messages.at(-1)!.recipientMemberIds).toEqual(['expert']);
    const work = service.send({ action: 'send', conversationId: 'A', clientRequestId: 'work', text: '开始项目', intent: 'work' });
    expect(work.messages.at(-1)!.recipientMemberIds).toEqual(['leader']);
  });

  it('does not wake recipients for automatic status updates', async () => {
    const { service, repo } = fixture(async input => {
      consult(service, input, 'expert', false); return { output: '结束' };
    });
    service.send(userMessage()); await flush();
    expect(repo.read('A')!.tasks).toHaveLength(1);
    expect(repo.read('A')!.messages.find(m => m.blocks[0].text === '请核对本群设定')!.expectsResponse).toBe(false);
  });

  it('rejects self/ancestor loops and messages outside the current execution', async () => {
    const { service, repo } = fixture(async input => {
      if (input.task.assigneeMemberId === 'writer') {
        expect(() => consult(service, input, 'writer')).toThrow('consultation_cycle');
        consult(service, input); return { output: '' };
      }
      expect(() => consult(service, input, 'writer')).toThrow('consultation_cycle');
      return { output: '已检查' };
    });
    // Only the first writer attempt should create a consultation.
    service.updatePolicy({ action: 'policy', conversationId: 'A', policy: { maxAutoMessages: 3 } });
    service.send(userMessage()); await flush();
    const s = repo.read('A')!;
    expect(() => service.send({ ...userMessage('spoof'), replyToMessageId: s.messages[0].id }, 'writer')).toThrow('execution_no_longer_active');
    expect(s.messages.length).toBeLessThan(12);
  });

  it('surfaces peer failures to the requester without retrying the peer or creating work', async () => {
    const { service, repo } = fixture(async input => {
      if (input.task.assigneeMemberId === 'writer' && input.attempt.number === 1) { consult(service, input); return { output: '' }; }
      if (input.task.assigneeMemberId === 'expert') throw new Error('专家模型不可用');
      expect(buildTaskRoomContext(input.snapshot, input.task, input.attempt)).toContain('专家模型不可用');
      return { output: '专家失败，需要用户决定' };
    });
    service.send(userMessage()); await flush();
    const s = repo.read('A')!;
    expect(s.tasks).toHaveLength(2); expect(s.attempts.filter(a => a.status === 'failed')).toHaveLength(1);
    expect(s.messages.at(-1)?.blocks[0].text).toBe('专家失败，需要用户决定');
  });


  it('routes an unaddressed discussion to one active owner, without waking all members', async () => {
    const { service, repo } = fixture(async input => {
      if (input.task.kind === 'task') return new Promise(resolve => input.signal.addEventListener('abort', () => resolve({ output: '' }), { once: true }));
      return { output: '进度答复' };
    });
    service.send({ ...userMessage(), intent: 'work' }); await flush();
    const status = service.send({ action: 'send', conversationId: 'A', clientRequestId: 'status', text: '现在进度如何' });
    expect(status.messages.at(-1)!.recipientMemberIds).toEqual(['writer']);
    expect(status.tasks.at(-1)!.purpose).toBe('discussion');
    expect(repo.read('A')!.tasks.filter(t => t.kind === 'task')).toHaveLength(1);
  });

  it('cancels a queued consultation after permission revocation and returns the actual reason', async () => {
    let release!: () => void;
    const { service, repo } = fixture(async input => {
      if (input.attempt.number === 1) {
        consult(service, input);
        return new Promise(resolve => { release = () => resolve({ output: '' }); });
      }
      expect(buildTaskRoomContext(input.snapshot, input.task, input.attempt)).toContain('群内咨询已关闭');
      return { output: '已告知请求者咨询被关闭' };
    });
    service.send(userMessage()); await flush();
    service.updatePolicy({ action: 'policy', conversationId: 'A', policy: { allowGroupMessages: false } });
    release(); await flush();
    const s = repo.read('A')!;
    expect(s.tasks).toHaveLength(2);
    const peer = s.tasks.find(t => t.consultation)!;
    expect(s.attempts.find(a => a.id === peer.currentAttemptId)!.error?.code).toBe('consultation_unavailable');
    expect(s.messages.at(-1)?.blocks[0].text).toBe('已告知请求者咨询被关闭');
  });

  it('pauses the consultation with its originating work and resumes the same work only after its reply', async () => {
    const starts: CollaborationExecutionInput[] = [];
    const { service, repo } = fixture(async input => {
      starts.push(input);
      if (input.task.assigneeMemberId === 'expert') {
        if (input.attempt.number === 1) return new Promise(resolve => input.signal.addEventListener('abort', () => resolve({ output: '' }), { once: true }));
        return { output: '恢复后的专家回答' };
      }
      if (input.attempt.number === 1) { consult(service, input); return { output: '' }; }
      return { output: '已交付', artifacts: [{ id: 'artifact', taskId: input.task.id, attemptId: input.attempt.id,
        kind: 'document', title: '首章', content: '首章', sha256: 'hash', bytes: 6, createdAt: '' }] };
    });
    service.send({ ...userMessage(), intent: 'work' }); await flush();
    expect(starts).toHaveLength(2);
    service.roomCommand({ action: 'room-pause', conversationId: 'A', clientRequestId: 'pause' }); await flush();
    expect(repo.read('A')!.conversation.room!.state).toBe('paused');
    expect(starts).toHaveLength(2);
    service.roomCommand({ action: 'room-resume', conversationId: 'A', clientRequestId: 'resume' }); await flush();
    expect(starts.map(i => i.task.assigneeMemberId)).toEqual(['writer', 'expert', 'expert', 'writer']);
    expect(repo.read('A')!.conversation.room!.state).toBe('review');
    expect(repo.read('B')!.tasks).toHaveLength(0);
  });

  it('continues after a persisted queued join without reissuing its consultation', async () => {
    let release!: () => void;
    const { service, repo } = fixture(async input => {
      if (input.task.assigneeMemberId === 'writer') { consult(service, input); return { output: '' }; }
      return new Promise(resolve => { release = () => resolve({ output: '专家返回' }); });
    });
    service.send({ ...userMessage(), intent: 'work' }); await flush();
    const saved = repo.read('A')!;
    expect(saved.attempts.find(a => a.id === saved.tasks[0].currentAttemptId)!.awaitingPeerTaskIds).toHaveLength(1);
    // Snapshot is persisted data, without the old executor; recovery must pause the interrupted expert.
    const restarted = new CollaborationChatService(repo, { ownerId: 'restarted', onChanged: () => {}, resourceClaims: () => [], execute: async input => input.task.consultation ? { output: '重启后的专家回应' } : { output: 'continued', artifacts: [{ id: 'restored', taskId: input.task.id, attemptId: input.attempt.id, kind: 'document', title: '首章', content: '正文', sha256: 'hash', bytes: 6, createdAt: '' }] } });
    services.push(restarted);
    restarted.recover();
    expect(repo.read('A')!.conversation.room!.state).toBe('paused');
    release(); await service.stop();
    restarted.roomCommand({ action: 'room-resume', conversationId: 'A', clientRequestId: 'resume-after-restart' }); await flush();
    expect(repo.read('A')!.conversation.room!.state).toBe('review');
    expect(repo.read('A')!.tasks[0].id).toBe(saved.tasks[0].id);
    expect(repo.read('A')!.attempts.flatMap(a => a.artifacts ?? [])).toHaveLength(1);
    expect(repo.read('A')!.messages.filter(m => m.blocks[0].text === '请核对本群设定')).toHaveLength(1);
  });

  it('keeps the old group permission frozen when only private-chat permission changes', () => {
    const { service, repo } = fixture(async () => ({ output: '' }));
    const old = repo.read('A')!; delete old.conversation.policy.allowGroupMessages; repo.save(old);
    service.updatePolicy({ action: 'policy', conversationId: 'A', policy: { allowPeerDirect: true } });
    expect(repo.read('A')!.conversation.policy).toMatchObject({ allowGroupMessages: false, allowPeerDirect: true });
    service.updatePolicy({ action: 'policy', conversationId: 'A', policy: { allowGroupMessages: true, allowPeerDirect: false } });
    expect(repo.read('A')!.conversation.policy).toMatchObject({ allowGroupMessages: true, allowPeerDirect: false });
  });
});


describe('lightweight room handoffs', () => {
  it('relays through three members without resuming senders or duplicating final acknowledgements', async () => {
    const calls: CollaborationExecutionInput[] = [];
    const { service, repo } = fixture(async input => {
      calls.push(input);
      const actor = input.task.assigneeMemberId;
      const recipient = actor === 'expert' ? 'leader' : 'writer';
      if (actor !== 'writer') {
        const command = { action: 'send' as const, conversationId: 'A', replyToMessageId: input.task.originMessageId, clientRequestId: 'relay:' + input.attempt.id,
          text: actor === 'expert' ? '@leader 请让写手只发哇哈哈' : '@writer 请只发：哇哈哈',
          recipientMemberIds: [recipient], deliveryMode: 'handoff' as const };
        service.send(command, actor, undefined, { taskId: input.task.id, attemptId: input.attempt.id });
        service.send(command, actor, undefined, { taskId: input.task.id, attemptId: input.attempt.id });
        return { output: '已转达，重复的确认仅留在执行记录。' };
      }
      service.send({ action: 'send', conversationId: 'A', replyToMessageId: input.task.originMessageId, clientRequestId: 'public:' + input.attempt.id,
        text: '哇哈哈', recipientMemberIds: ['leader'], deliveryMode: 'notify' }, actor, undefined,
      { taskId: input.task.id, attemptId: input.attempt.id });
      return { output: '已发出，又一条多余回执。' };
    });
    service.send({ ...userMessage(), text: '请专家转告负责人，让写手只发哇哈哈', recipientMemberIds: ['expert'] });
    await flush();
    const s = repo.read('A')!;
    expect(calls.map(x => x.task.assigneeMemberId)).toEqual(['expert', 'leader', 'writer']);
    expect(s.tasks).toHaveLength(3); expect(s.attempts).toHaveLength(3);
    expect(s.tasks.every(t => t.purpose === 'discussion' && !t.consultation)).toBe(true);
    expect(s.attempts.every(a => a.status === 'succeeded' && !a.awaitingPeerTaskIds)).toBe(true);
    expect(s.messages.filter(m => m.senderMemberId !== 'user').map(m => m.blocks[0].text))
      .toEqual(['@leader 请让写手只发哇哈哈', '@writer 请只发：哇哈哈', '哇哈哈']);
    expect(s.conversation.room!.state).toBe('discussion');
    expect(s.attempts.flatMap(a => a.artifacts ?? [])).toHaveLength(0);
    expect(repo.read('B')!.messages).toHaveLength(0);
  });

  it('consult still resumes the same source task and returns the real peer answer once', async () => {
    const { service, repo } = fixture(async input => {
      if (input.task.assigneeMemberId === 'expert') return { output: '确切答案' };
      if (input.attempt.number === 1) {
        service.send({ action: 'send', conversationId: 'A', replyToMessageId: input.task.originMessageId, clientRequestId: 'consult-new-mode', text: '需要事实才能继续',
          recipientMemberIds: ['expert'], deliveryMode: 'consult' }, 'writer', undefined,
        { taskId: input.task.id, attemptId: input.attempt.id });
        return { output: '等待事实' };
      }
      expect(input.attempt.awaitingPeerTaskIds).toHaveLength(1);
      return { output: '结合确切答案后的回答' };
    });
    service.send(userMessage()); await flush();
    const s = repo.read('A')!;
    expect(s.tasks.filter(t => t.consultation)).toHaveLength(1);
    expect(s.attempts).toHaveLength(3);
    expect(s.messages.filter(m => m.blocks[0].text === '结合确切答案后的回答')).toHaveLength(1);
  });

  it('keeps status notifications to an unrelated member from suppressing the actual answer', async () => {
    const { service, repo } = fixture(async input => {
      service.send({ action: 'send', conversationId: 'A', replyToMessageId: input.task.originMessageId, clientRequestId: 'status', text: '知会负责人',
        recipientMemberIds: ['leader'], deliveryMode: 'notify' }, 'writer', undefined,
      { taskId: input.task.id, attemptId: input.attempt.id });
      return { output: '回答用户的问题' };
    });
    service.send(userMessage()); await flush();
    expect(repo.read('A')!.messages.map(m => m.blocks[0].text)).toContain('回答用户的问题');
    expect(repo.read('A')!.tasks).toHaveLength(1);
  });

  it('surfaces a failed attempt even when it already sent a chat reply', async () => {
    const { service, repo } = fixture(async input => {
      service.send({ action: 'send', conversationId: 'A', replyToMessageId: input.task.originMessageId, clientRequestId: 'partial', text: '先回复一句',
        recipientMemberIds: ['user'], deliveryMode: 'notify' }, 'writer', undefined,
      { taskId: input.task.id, attemptId: input.attempt.id });
      return { output: '', error: { code: 'failed_after_send', category: 'execution', message: '发送后执行失败', retryable: true, traceId: 'trace' } };
    });
    service.send(userMessage()); await flush();
    expect(repo.read('A')!.messages.map(m => m.blocks[0].text)).toContain('发送后执行失败');
  });

  it('rejects handoff cycles and conflicting wake flags before writing a message', async () => {
    const { service, repo } = fixture(async input => {
      const command = { action: 'send' as const, conversationId: 'A', replyToMessageId: input.task.originMessageId, clientRequestId: 'invalid', text: 'cycle',
        recipientMemberIds: ['writer'], deliveryMode: 'handoff' as const };
      const execution = { taskId: input.task.id, attemptId: input.attempt.id };
      expect(() => service.send(command, 'writer', undefined, execution)).toThrow('consultation_cycle');
      expect(() => service.send({ ...command, recipientMemberIds: ['expert'], expectsResponse: false }, 'writer', undefined, execution))
        .toThrow('delivery_mode_conflict');
      return { output: '正常回复' };
    });
    service.send(userMessage()); await flush();
    expect(repo.read('A')!.tasks).toHaveLength(1);
    expect(repo.read('A')!.messages).toHaveLength(2);
  });
});


it('settles a queued handoff when messaging permission is revoked without resuming its sender', async () => {
  let release!: () => void;
  const calls: string[] = [];
  const { service, repo } = fixture(async input => {
    calls.push(input.task.assigneeMemberId);
    service.send({ action: 'send', conversationId: 'A', clientRequestId: 'queued-relay', text: '只转达',
      replyToMessageId: input.task.originMessageId, recipientMemberIds: ['expert'], deliveryMode: 'handoff' }, 'writer', undefined,
    { taskId: input.task.id, attemptId: input.attempt.id });
    return new Promise(resolve => { release = () => resolve({ output: '重复确认' }); });
  });
  service.send(userMessage()); await flush();
  service.updatePolicy({ action: 'policy', conversationId: 'A', policy: { allowGroupMessages: false } });
  release(); await flush();
  const s = repo.read('A')!;
  expect(calls).toEqual(['writer']);
  expect(s.attempts).toHaveLength(2);
  expect(s.attempts.find(a => a.status === 'failed')?.error?.code).toBe('chat_recipient_unavailable');
  expect(s.messages.at(-1)?.blocks[0].text).toContain('本次转达已停止');
});
