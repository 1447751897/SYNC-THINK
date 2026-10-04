import { describe, expect, it } from 'vitest';
import { isCollaborationTaskBusy } from './collaboration-activity.js';
import type { CollaborationAttempt, CollaborationTask, TaskRoom } from './types/collaboration-chat.js';

function fixture() {
  const task: CollaborationTask = { id: 'task', rootTaskId: 'task', originMessageId: 'human', assigneeMemberId: 'writer',
    title: '正文', instructions: '', expectedOutput: '', dependsOnTaskIds: [], contextRefs: [], resourceClaims: [],
    returnTo: { conversationId: 'room', replyToMessageId: 'human' }, timeoutSeconds: 60,
    currentAttemptId: 'attempt', kind: 'task', purpose: 'work', goalRevision: 1, createdAt: '' };
  const attempt: CollaborationAttempt = { id: 'attempt', taskId: task.id, number: 1, status: 'queued', updatedAt: '',
    contextSequence: 0, output: '', resourceClaims: [], tools: [], checklist: [] };
  const room: TaskRoom = { version: 1, state: 'running', goal: '写作', goalRevision: 1, sourceSequence: 0,
    checkpoint: { version: 1, savedAt: '', pendingTaskIds: [], completedTaskIds: [], artifactIds: [], note: '' } };
  return { task, attempt, room };
}

describe('isCollaborationTaskBusy', () => {
  it.each(['dependency', 'dependency_failed', 'member_removed', 'loop_limit', 'room_paused'] as const)(
    'does not animate a blocked queue (%s)', waitReason => {
      const { task, attempt, room } = fixture();
      attempt.waitReason = waitReason;
      expect(isCollaborationTaskBusy(task, attempt, room)).toBe(false);
    });

  it.each([undefined, 'capacity', 'resource_busy'] as const)(
    'keeps an admitted queue active while it can still proceed (%s)', waitReason => {
      const { task, attempt, room } = fixture();
      attempt.waitReason = waitReason;
      expect(isCollaborationTaskBusy(task, attempt, room)).toBe(true);
    });

  it.each(['paused', 'pausing', 'completed'] as const)(
    'does not animate queued production in a closed room (%s)', state => {
      const { task, attempt, room } = fixture();
      room.state = state;
      expect(isCollaborationTaskBusy(task, attempt, room)).toBe(false);
    });

  it.each(['running', 'waiting_input', 'stopping'] as const)(
    'keeps actual live execution visible until settled (%s)', status => {
      const { task, attempt, room } = fixture();
      room.state = 'pausing';
      attempt.status = status;
      expect(isCollaborationTaskBusy(task, attempt, room)).toBe(true);
    });

  it.each(['succeeded', 'failed', 'cancelled', 'interrupted'] as const)(
    'does not animate a terminal attempt (%s)', status => {
      const { task, attempt, room } = fixture();
      attempt.status = status;
      expect(isCollaborationTaskBusy(task, attempt, room)).toBe(false);
    });

  it('allows ordinary discussion while production is paused', () => {
    const { task, attempt, room } = fixture();
    room.state = 'paused'; task.kind = 'reply'; task.purpose = 'discussion';
    expect(isCollaborationTaskBusy(task, attempt, room)).toBe(true);
    task.consultation = { requesterTaskId: 'work', requesterAttemptId: 'work-attempt', workScoped: true };
    expect(isCollaborationTaskBusy(task, attempt, room)).toBe(false);
  });

  it('excludes unpublished assignments and obsolete goal generations', () => {
    const { task, attempt, room } = fixture();
    task.pendingAssignment = { senderMemberId: 'leader', correlationId: 'handoff', hopCount: 1 };
    expect(isCollaborationTaskBusy(task, attempt, room)).toBe(false);
    delete task.pendingAssignment;
    room.goalRevision = 2;
    expect(isCollaborationTaskBusy(task, attempt, room)).toBe(false);
  });

  it('only projects the matching current attempt', () => {
    const { task, attempt, room } = fixture();
    expect(isCollaborationTaskBusy(task, undefined, room)).toBe(false);
    expect(isCollaborationTaskBusy(task, { ...attempt, id: 'old' }, room)).toBe(false);
    expect(isCollaborationTaskBusy(task, { ...attempt, taskId: 'other' }, room)).toBe(false);
  });

  it('preserves queue/history and becomes active after an explicit resume', () => {
    const { task, attempt, room } = fixture();
    room.state = 'paused'; attempt.waitReason = 'room_paused';
    const before = structuredClone({ task, attempt, room });
    expect(isCollaborationTaskBusy(task, attempt, room)).toBe(false);
    expect({ task, attempt, room }).toEqual(before);
    room.state = 'running'; delete attempt.waitReason;
    expect(isCollaborationTaskBusy(task, attempt, room)).toBe(true);
  });
});
