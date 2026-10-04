import { describe, expect, it } from 'vitest';
import { DEFAULT_COLLABORATION_CHAT_POLICY, type CollaborationSnapshot, type CollaborationAttempt } from '@sync-think/shared';
import { collaborationRoster } from './collaboration-chat-host.js';
import { createTaskRoom } from './task-room.js';

const snapshot = (): CollaborationSnapshot => ({
  conversation: { id: 'g', workspaceId: 'w', kind: 'group', title: 'A + B', coordinatorMemberId: 'agent:a', policy: { ...DEFAULT_COLLABORATION_CHAT_POLICY }, createdAt: '2026-01-01T00:00:00Z' },
  members: [
    { id: 'user:local', kind: 'user', name: '你', avatar: '', role: '用户', active: true },
    { id: 'agent:a', kind: 'agent', agentId: 'a', name: 'A', avatar: 'bot:x', role: '', active: true },
    { id: 'agent:b', kind: 'agent', agentId: 'b', name: 'B', avatar: '', role: '', active: true },
    { id: 'agent:c', kind: 'agent', agentId: 'c', name: 'C', avatar: '', role: '', active: false },
  ],
  messages: [], deliveries: [], tasks: [], attempts: [], revision: 1, receipts: {},
});
const message = (id: string, sender: string, text: string, kind: 'chat' | 'system' = 'chat') => ({
  id, conversationId: 'g', senderMemberId: sender, recipientMemberIds: [], mentions: [], kind,
  blocks: [{ type: 'text' as const, text }], expectsResponse: false, correlationId: id, hopCount: 0, sequence: 1, createdAt: '2026-01-01T00:00:00Z',
});

describe('collaborationRoster', () => {
  it('lists active agents only and previews the latest non-system line', () => {
    const value = snapshot();
    value.messages = [message('1', 'user:local', '你好'), message('2', 'agent:b', '  结论\n已整理 '), message('3', 'agent:a', '成员变更', 'system')];
    expect(collaborationRoster(value)).toEqual({
      conversationId: 'g', kind: 'group', busy: false,
      members: [{ id: 'agent:a', name: 'A', avatar: 'bot:x' }, { id: 'agent:b', name: 'B', avatar: '' }],
      preview: '结论 已整理', previewSender: 'B',
    });
  });

  it('is busy only while a current attempt is active', () => {
    const value = snapshot();
    const task = { id: 't', rootTaskId: 't', originMessageId: '1', assigneeMemberId: 'agent:a', title: '', instructions: '', expectedOutput: '', dependsOnTaskIds: [], contextRefs: [], resourceClaims: [], returnTo: { conversationId: 'g', replyToMessageId: '1' }, timeoutSeconds: 60, currentAttemptId: 'new', kind: 'reply' as const, createdAt: '' };
    const attempt = (id: string, status: 'running' | 'failed') => ({ id, taskId: 't', number: 1, status, updatedAt: '', contextSequence: 0, output: '', resourceClaims: [], tools: [], checklist: [] });
    value.tasks = [task];
    value.attempts = [attempt('old', 'running'), attempt('new', 'failed')];
    expect(collaborationRoster(value).busy).toBe(false);
    value.attempts = [attempt('new', 'running')];
    expect(collaborationRoster(value).busy).toBe(true);
  });
});

function queuedWork(waitReason?: CollaborationAttempt['waitReason']): CollaborationSnapshot {
  const value = snapshot();
  value.conversation.room = createTaskRoom('2026-10-04');
  value.conversation.room.state = 'running';
  value.tasks = [{ id: 'work', rootTaskId: 'work', originMessageId: 'human', assigneeMemberId: 'agent:a',
    title: '保留的工作', instructions: '', expectedOutput: '', dependsOnTaskIds: [], contextRefs: [], resourceClaims: [],
    returnTo: { conversationId: 'g', replyToMessageId: 'human' }, timeoutSeconds: 60,
    currentAttemptId: 'work-attempt', kind: 'task', purpose: 'work', createdAt: '' }];
  value.attempts = [{ id: 'work-attempt', taskId: 'work', number: 1, status: 'queued', waitReason,
    updatedAt: '', contextSequence: 0, output: '', resourceClaims: [], tools: [], checklist: [] }];
  return value;
}

describe('collaboration roster activity projection', () => {
  it.each(['dependency', 'dependency_failed', 'member_removed', 'loop_limit', 'room_paused'] as const)(
    'does not show blocked queued work as running (%s)', waitReason => {
      const value = queuedWork(waitReason);
      expect(collaborationRoster(value).busy).toBe(false);
      expect(value.attempts[0].status).toBe('queued');
      expect(value.tasks).toHaveLength(1);
    });

  it('stops the busy indicator while paused and restores it after an explicit resume', () => {
    const value = queuedWork('room_paused');
    value.conversation.room!.state = 'paused';
    expect(collaborationRoster(value)).toMatchObject({ busy: false, roomState: 'paused' });
    value.conversation.room!.state = 'running';
    delete value.attempts[0].waitReason;
    expect(collaborationRoster(value).busy).toBe(true);
  });

  it('does not show unpublished downstream assignments as active members', () => {
    const value = queuedWork();
    value.tasks[0].pendingAssignment = { senderMemberId: 'agent:b', correlationId: 'handoff', hopCount: 1 };
    expect(collaborationRoster(value).busy).toBe(false);
  });

  it('still shows a live discussion reply in a paused task room', () => {
    const value = queuedWork();
    value.conversation.room!.state = 'paused';
    value.tasks[0].kind = 'reply';
    value.tasks[0].purpose = 'discussion';
    expect(collaborationRoster(value).busy).toBe(true);
  });

  it('keeps the indicator until an executing attempt has actually stopped', () => {
    const value = queuedWork('room_paused');
    value.conversation.room!.state = 'pausing';
    value.attempts[0].status = 'stopping';
    expect(collaborationRoster(value).busy).toBe(true);
  });
});
