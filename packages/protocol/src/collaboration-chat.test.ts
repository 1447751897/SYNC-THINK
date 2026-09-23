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
