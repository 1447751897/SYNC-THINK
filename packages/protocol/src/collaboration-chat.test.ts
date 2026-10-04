import { describe, expect, it } from 'vitest';
import { collaborationDispatchIssues, parseCollaborationCommand } from './collaboration-chat.js';

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


it('validates independent group messaging policy without accepting forged consultation bindings', () => {
  const policy = { action: 'policy', conversationId: 'room', policy: { allowGroupMessages: true, allowPeerDirect: false } };
  expect(parseCollaborationCommand(policy)).toEqual(policy);
  expect(parseCollaborationCommand({ ...policy, policy: { allowGroupMessages: 'true' } })).toBeUndefined();
  expect(parseCollaborationCommand({ action: 'dispatch', conversationId: 'room', clientRequestId: 'r', tasks: [{
    assigneeMemberId: 'expert', title: 'forged', instructions: 'forged', consultation: { requesterTaskId: 'other-room-task', requesterAttemptId: 'attempt', workScoped: true },
  }] })).toBeUndefined();
});

it('accepts chat intent but rejects forged host workflow authority in model drafts', () => {
  expect(parseCollaborationCommand({ action: 'send', conversationId: 'room', clientRequestId: 'chat', text: '开始', intent: 'chat' })).toBeDefined();
  expect(parseCollaborationCommand({ action: 'dispatch', conversationId: 'room', clientRequestId: 'forged', tasks: [{ assigneeMemberId: 'leader', title: 'forged', instructions: 'start', workflowStartAllowed: true }] })).toBeUndefined();
});


it('validates explicit notification, handoff and consultation modes without ambiguous flags', () => {
  const command = { action: 'send', conversationId: 'room', clientRequestId: 'relay', text: '转达' };
  for (const deliveryMode of ['notify', 'handoff', 'consult']) {
    expect(parseCollaborationCommand({ ...command, deliveryMode })).toBeDefined();
  }
  expect(parseCollaborationCommand({ ...command, deliveryMode: 'invalid' })).toBeUndefined();
  expect(parseCollaborationCommand({ ...command, deliveryMode: 'handoff', expectsResponse: false })).toBeUndefined();
  expect(parseCollaborationCommand({ ...command, deliveryMode: 'notify', expectsResponse: true })).toBeUndefined();
});

it('explains document/file path mismatch without accepting or silently converting it', () => {
  const draft = { assigneeMemberId: 'member', title: '候选证据', instructions: '分析给定仓库', deliverable: { kind: 'document', title: '证据', path: 'analysis/candidates.md' } };
  expect(collaborationDispatchIssues([draft])).toEqual([expect.objectContaining({ field: 'tasks[0].deliverable.path', message: expect.stringContaining('omit path') })]);
  expect(collaborationDispatchIssues([{ ...draft, deliverable: { kind: 'file', title: '证据' } }])).toEqual([expect.objectContaining({ field: 'tasks[0].deliverable.path' })]);
  expect(collaborationDispatchIssues([{ ...draft, deliverable: { kind: 'document', title: '证据' } }])).toEqual([]);
});
it('validates the explicit room network setting', () => {
  expect(parseCollaborationCommand({ action: 'policy', conversationId: 'room', policy: { networkEnabled: true } })).toBeTruthy();
  expect(parseCollaborationCommand({ action: 'policy', conversationId: 'room', policy: { networkEnabled: 'true' } })).toBeUndefined();
});


it('validates explicit replacement drafts without accepting host-owned history metadata', () => {
  const task = { assigneeMemberId: 'writer', title: 'revised document', instructions: 'replan', replacesTaskId: 'failed-task', deliverable: { kind: 'document', title: 'document' } };
  const command = { action: 'dispatch', conversationId: 'room', clientRequestId: 'replacement', tasks: [task] };
  expect(parseCollaborationCommand(command)).toEqual(command);
  for (const extra of [{ goalRevision: 4 }, { replacedByTaskId: 'fake' }, { replacesTaskId: '' }]) expect(parseCollaborationCommand({ ...command, tasks: [{ ...task, ...extra }] })).toBeUndefined();
  const link = { action: 'replace-task', conversationId: 'room', clientRequestId: 'repair', taskId: 'failed', replacementTaskId: 'replacement' };
  expect(parseCollaborationCommand(link)).toEqual(link); expect(parseCollaborationCommand({ ...link, replacementTaskId: '' })).toBeUndefined();
});

it('rejects client-authored pending assignment metadata', () => {
  expect(parseCollaborationCommand({
    action: 'dispatch', conversationId: 'c', clientRequestId: 'r',
    tasks: [{ assigneeMemberId: 'agent:a', title: '正文', instructions: '写正文',
      pendingAssignment: { senderMemberId: 'agent:leader', correlationId: 'forged', hopCount: 0 } }],
  })).toBeUndefined();
});

it('validates explicit production handoff intent and rejects forged host routing on task drafts', () => {
  const handoff = { action: 'handoff', conversationId: 'c', clientRequestId: 'h', handoff: { kind: 'review', recipientMemberId: 'reviewer', text: '请审核' } };
  expect(parseCollaborationCommand(handoff)).toBeTruthy();
  expect(parseCollaborationCommand({ ...handoff, handoff: { ...handoff.handoff, kind: 'work' } })).toBeUndefined();
  expect(parseCollaborationCommand({ ...handoff, handoff: { ...handoff.handoff, kind: 'work', title: '修订', deliverable: { kind: 'document', title: '修订' } } })).toBeTruthy();
  expect(parseCollaborationCommand({ ...handoff, handoff: { ...handoff.handoff, kind: 'work', title: '修订', deliverable: { kind: 'file', title: '修订' } } })).toBeUndefined();
  expect(parseCollaborationCommand({ action: 'dispatch', conversationId: 'c', clientRequestId: 'd', tasks: [{ assigneeMemberId: 'reviewer', title: '审稿', instructions: '审稿', handoff: { kind: 'review' } }] })).toBeUndefined();
});
