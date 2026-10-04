import { describe, expect, it } from 'vitest';
import { collaborationSnapshotForMember } from './collaboration-visibility.js';
import {
  DEFAULT_COLLABORATION_CHAT_POLICY,
  type CollaborationMessage,
  type CollaborationSnapshot,
  type CollaborationTask,
} from './types/collaboration-chat.js';

function fixture(): CollaborationSnapshot {
  const message = (
    id: string,
    senderMemberId: string,
    recipientMemberIds: string[],
    visibility: 'public' | 'private',
    sequence: number,
  ): CollaborationMessage => ({
    id,
    conversationId: 'g',
    senderMemberId,
    recipientMemberIds,
    visibility,
    sequence,
    mentions: [],
    kind: 'chat',
    blocks: [{ type: 'text', text: id }],
    expectsResponse: false,
    correlationId: 'round',
    hopCount: 0,
    createdAt: 'fixture',
  });
  const task = (id: string, originMessageId: string): CollaborationTask => ({
    id,
    originMessageId,
    rootTaskId: id,
    assigneeMemberId: 'b',
    title: id,
    instructions: id,
    expectedOutput: '',
    kind: 'reply',
    currentAttemptId: id + '-attempt',
    dependsOnTaskIds: [],
    contextRefs: ['public', 'SECRET'],
    resourceClaims: [],
    timeoutSeconds: 120,
    returnTo: { conversationId: 'g', replyToMessageId: originMessageId },
    createdAt: 'fixture',
  });
  const tasks = [task('public-task', 'public'), task('SECRET-task', 'SECRET')];
  return {
    conversation: {
      id: 'g',
      workspaceId: 'w',
      kind: 'group',
      title: 'group',
      coordinatorMemberId: 'a',
      policy: DEFAULT_COLLABORATION_CHAT_POLICY,
      createdAt: 'fixture',
      room: {
        version: 1,
        goal: 'public goal',
        goalRevision: 1,
        sourceSequence: 0,
        state: 'discussion',
        checkpoint: {
          pendingTaskIds: tasks.map((t) => t.id),
          completedTaskIds: [],
          artifactIds: ['SECRET-artifact'],
          version: 1,
          savedAt: 'fixture',
          note: 'SECRET-note',
        },
      },
    },
    members: ['u', 'a', 'b', 'c'].map((id) => ({
      id,
      name: id,
      avatar: '',
      role: '',
      kind: id === 'u' ? 'user' : 'agent',
      active: true,
    })),
    messages: [
      message('public', 'u', [], 'public', 1),
      message('SECRET', 'a', ['b'], 'private', 2),
    ],
    tasks,
    attempts: tasks.map((t) => ({
      id: t.currentAttemptId,
      taskId: t.id,
      number: 1,
      status: 'succeeded',
      contextSequence: 2,
      output: t.originMessageId,
      resourceClaims: [],
      tools: [],
      checklist: [],
      updatedAt: 'fixture',
    })),
    deliveries: [
      { id: 'SECRET-delivery', messageId: 'SECRET', recipientMemberId: 'b', status: 'processed' },
    ],
    revision: 1,
    receipts: {
      'send:private': JSON.stringify({ fingerprint: 'opaque', reference: 'SECRET' }),
      'room-pause:pause': JSON.stringify({ fingerprint: 'opaque', reference: 'paused' }),
    },
  };
}
describe('host-owned collaboration audience projection', () => {
  it('removes private content and every task/attempt/delivery/reference side channel', () => {
    const source = fixture();
    source.attempts[1]!.artifacts = [
      {
        id: 'SECRET-artifact',
        taskId: 'SECRET-task',
        attemptId: 'SECRET-task-attempt',
        kind: 'document',
        title: 'SECRET',
        content: 'SECRET-body',
        sha256: 'hash',
        bytes: 1,
        createdAt: 'fixture',
      },
    ];
    const view = collaborationSnapshotForMember(source, 'c');
    expect(JSON.stringify(view)).not.toContain('SECRET');
    expect(view.tasks).toHaveLength(1);
    expect(view.attempts).toHaveLength(1);
    expect(view.deliveries).toHaveLength(0);
    expect(view.receipts['room-pause:pause']).toBe(source.receipts['room-pause:pause']);
    expect(source.tasks[0]!.contextRefs).toContain('SECRET');
  });
  it('admits the sender/recipient, not the human observer or another member', () => {
    for (const id of ['a', 'b'])
      expect(collaborationSnapshotForMember(fixture(), id).messages).toHaveLength(2);
    for (const id of ['u', 'c'])
      expect(collaborationSnapshotForMember(fixture(), id).messages).toHaveLength(1);
    expect(collaborationSnapshotForMember(fixture(), 'a', true).messages).toHaveLength(1);
  });
  it('redacts nonparticipant tools/traces from a public task when its actor has a secret inbox', () => {
    const source = fixture();
    Object.assign(source.attempts[0]!, {
      commentary: 'SECRET commentary',
      tools: [{ SECRET: true }],
      agentSnapshot: { SECRET: true },
      runId: 'SECRET-run',
      threadId: 'SECRET-thread',
    });
    const view = collaborationSnapshotForMember(source, 'u');
    expect(JSON.stringify(view)).not.toContain('SECRET');
    expect(view.attempts[0]!.tools).toEqual([]);
  });
  it('hides internal routing output even when there are no private messages', () => {
    const source = fixture();
    source.messages.pop();
    source.tasks.pop();
    source.attempts.pop();
    source.deliveries = [];
    source.receipts = {};
    source.tasks[0]!.conversationPlanning = true;
    source.tasks[0]!.instructions = 'INTERNAL ROUTING PROMPT';
    source.attempts[0]!.output = '{"mode":"sequential"}';
    const view = collaborationSnapshotForMember(source, 'u');
    expect(view.attempts[0]!.output).toBe('');
    expect(view.tasks[0]!.instructions).not.toContain('INTERNAL');
    expect(source.attempts[0]!.output).toContain('sequential');
  });
  it('keeps legacy public messages public and preserves existing cross-conversation refs', () => {
    const source = fixture();
    source.messages.pop();
    source.tasks.pop();
    source.attempts.pop();
    source.deliveries = [];
    source.receipts = {};
    delete source.messages[0]!.visibility;
    source.messages[0]!.contextRefs = [{ conversationId: 'other', messageId: 'ref' }];
    expect(collaborationSnapshotForMember(source, 'c')).toEqual(source);
  });
  it('hides a retained trace answer when the turn actually delivered to a private audience', () => {
    const source = fixture();
    source.attempts[0]!.chatDeliveryMessageId = 'SECRET';
    source.attempts[0]!.output = 'SECRET final prose';
    expect(JSON.stringify(collaborationSnapshotForMember(source, 'u'))).not.toContain('SECRET');
    expect(collaborationSnapshotForMember(source, 'b').attempts[0]!.output).toBe(
      'SECRET final prose',
    );
  });
});
