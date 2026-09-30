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


it('accepts bounded inline mentions and rejects malformed coordinates', () => {
  const command = { action: 'send', conversationId: 'c', clientRequestId: 'r', text: '问研究员', mentions: [{ memberId: 'agent:a', label: '研究员', start: 1, end: 4 }] };
  expect(parseCollaborationCommand(command)).toEqual(command);
  for (const range of [{ start: -1, end: 3 }, { start: 1, end: 1 }, { start: 0.5, end: 4 }, { start: 0, end: 100001 }]) {
    expect(parseCollaborationCommand({ ...command, mentions: [{ ...command.mentions[0], ...range }] })).toBeUndefined();
  }
  expect(parseCollaborationCommand({ ...command, mentions: Array(129).fill(command.mentions[0]) })).toBeUndefined();
});

it('validates team admission and topology preconditions',()=>{
 expect(parseCollaborationCommand({action:'create',clientRequestId:'r',kind:'group',title:'协作',agentIds:[],teamIds:['team-1']})).toBeDefined();
 expect(parseCollaborationCommand({action:'members',conversationId:'c',addTeamIds:['team-1'],expectedTopologyRevision:2})).toBeDefined();
 expect(parseCollaborationCommand({action:'members',conversationId:'c',addTeamIds:['team-1'],expectedTopologyRevision:-1})).toBeUndefined();
 expect(parseCollaborationCommand({action:'members',conversationId:'c',addTeamIds:[3]})).toBeUndefined();
});
