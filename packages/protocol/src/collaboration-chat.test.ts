import { describe, expect, it } from 'vitest';
import { parseCollaborationCommand } from './collaboration-chat.js';

describe('collaboration command parsing', () => {
  it('accepts the cross-conversation activity query', () => {
    expect(parseCollaborationCommand({ action: 'activity', workspaceId: 'workspace-1' })).toEqual({
      action: 'activity',
      workspaceId: 'workspace-1',
    });
  });

  it('accepts message retry with a stable request id', () => {
    expect(parseCollaborationCommand({
      action: 'retry-message',
      conversationId: 'conversation-1',
      messageId: 'message-1',
      clientRequestId: 'request-1',
    })).toEqual({
      action: 'retry-message',
      conversationId: 'conversation-1',
      messageId: 'message-1',
      clientRequestId: 'request-1',
    });
  });

  it('rejects an invalid formal plan reference before dispatch', () => {
    expect(parseCollaborationCommand({
      action: 'dispatch',
      conversationId: 'conversation-1',
      clientRequestId: 'request-1',
      tasks: [{
        assigneeMemberId: 'agent:one',
        title: 'Implement',
        instructions: 'Implement the approved step',
        planRef: { planId: 'plan-1', revision: 0 },
      }],
    })).toBeUndefined();
  });
});

it('validates bounded workflow requests and document/file contracts', () => {
  expect(parseCollaborationCommand({ action: 'start-workflow', conversationId: 'c', clientRequestId: 'r', goal: '交付首章修订版' })).toBeDefined();
  expect(parseCollaborationCommand({ action: 'start-workflow', conversationId: 'c', clientRequestId: 'r', goal: '' })).toBeUndefined();
  const task = { assigneeMemberId: 'writer', title: '写首章', instructions: '按设定写作', deliverable: { kind: 'file', title: '首章' } };
  const command = { action: 'dispatch', conversationId: 'c', clientRequestId: 'r', tasks: [task] };
  expect(parseCollaborationCommand(command)).toBeUndefined();
  expect(parseCollaborationCommand({ ...command, tasks: [{ ...task, deliverable: { ...task.deliverable, path: 'novel/chapter.md' } }] })).toBeDefined();
});
