import { describe, expect, it } from 'vitest';
import {
  isCollaborationPolicy,
  isCollaborationTaskDraft,
  parseCollaborationCommand,
} from './collaboration-chat.js';
describe('group configuration and private message boundary', () => {
  it('accepts local descriptions including clearing and requires revision CAS', () => {
    const command = {
      action: 'group-config',
      conversationId: 'g',
      clientRequestId: 'save',
      description: '',
      expectedRevision: 0,
    };
    expect(parseCollaborationCommand(command)).toEqual(command);
    for (const invalid of [
      { expectedRevision: -1 },
      { expectedRevision: undefined },
      { description: 'x'.repeat(16001) },
    ])
      expect(parseCollaborationCommand({ ...command, ...invalid })).toBeUndefined();
  });
  it('accepts explicit message audiences and rejects unknown audience values', () => {
    const send = {
      action: 'send',
      conversationId: 'g',
      clientRequestId: 'send',
      text: 'card',
      recipientMemberIds: ['b'],
    };
    expect(parseCollaborationCommand({ ...send, visibility: 'private' })).toBeTruthy();
    expect(parseCollaborationCommand({ ...send, visibility: 'public' })).toBeTruthy();
    expect(parseCollaborationCommand({ ...send, visibility: 'hidden' })).toBeUndefined();
  });
  it('validates the opt-in switch without admitting host-owned planning flags in task drafts', () => {
    expect(isCollaborationPolicy({ coordinateDiscussion: true })).toBe(true);
    expect(isCollaborationPolicy({ coordinateDiscussion: 'true' })).toBe(false);
    const draft = { assigneeMemberId: 'b', title: 'work', instructions: 'work' };
    expect(isCollaborationTaskDraft(draft)).toBe(true);
    for (const field of [
      'conversationPlanning',
      'conversationPlanningIntent',
      'conversationPlanTaskId',
      'conversationRecovery',
    ])
      expect(isCollaborationTaskDraft({ ...draft, [field]: true })).toBe(false);
  });
});
