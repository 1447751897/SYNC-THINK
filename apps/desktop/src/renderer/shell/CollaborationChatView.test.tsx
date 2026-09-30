/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Conversation, GlobalAgent, CollaborationSnapshot } from '@sync-think/shared';

const state = vi.hoisted(() => ({ snapshot: undefined as CollaborationSnapshot | undefined, command: vi.fn() }));
vi.mock('./use-collaboration-chat.js', () => ({ useCollaborationChat: () => ({ snapshot: state.snapshot, error: '', command: state.command }) }));

import { CollaborationChatView } from './CollaborationChatView.js';

afterEach(() => cleanup());
beforeEach(() => { sessionStorage.clear(); state.snapshot = undefined; state.command.mockReset(); });

const conversation = { id: 'conv-1', workspaceId: 'ws-1', track: 'agent', targetRef: 'agent-a', title: '协作会话', executionMode: 'full-access', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' } as Conversation;
const agent = { id: 'agent-a', name: '研究员', description: '', enabled: true, archived: false } as GlobalAgent;
const base = {
  conversation: { id: 'conv-1', workspaceId: 'ws-1', kind: 'direct', title: '协作会话', coordinatorMemberId: 'agent-a', policy: { allowPeerDirect: false, maxConcurrent: 3, maxMessageHops: 6, maxAutoMessages: 12, taskTimeoutSeconds: 7200, statusTimeoutSeconds: 120 }, createdAt: '2026-01-01T00:00:00Z' },
  members: [{ id: 'user-1', kind: 'user', name: '用户', avatar: '', role: '', active: true }, { id: 'agent-a', kind: 'agent', agentId: 'agent-a', name: '研究员', avatar: '', role: '执行者', active: true }],
  messages: [], deliveries: [], tasks: [], attempts: [], revision: 1, receipts: {},
} satisfies CollaborationSnapshot;

describe('CollaborationChatView', () => {
  it('keeps a task card visible while the attempt is running', () => {
    state.snapshot = { ...base, tasks: [{ id: 'task-1', rootTaskId: 'task-1', originMessageId: 'msg-1', assigneeMemberId: 'agent-a', title: '分析页面', instructions: '检查页面', expectedOutput: '', dependsOnTaskIds: [], contextRefs: [], resourceClaims: [], returnTo: { conversationId: 'conv-1', replyToMessageId: 'msg-1' }, timeoutSeconds: 7200, currentAttemptId: 'attempt-1', kind: 'task', createdAt: '2026-01-01T00:00:00Z' }], attempts: [{ id: 'attempt-1', taskId: 'task-1', number: 1, status: 'running', updatedAt: '2026-01-01T00:00:00Z', contextSequence: 0, output: '正在分析', resourceClaims: [], tools: [], checklist: [] }] };
    render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
    expect(screen.getByText(/分析页面/)).toBeTruthy();
    expect(screen.queryByTestId('collaboration-stream-attempt-1')).toBeNull();
    expect(screen.getByTestId('collaboration-thinking-attempt-1')).toBeTruthy();
  });

  it('renders a completed result message and failed task state', () => {
    state.snapshot = { ...base, messages: [{ id: 'msg-1', conversationId: 'conv-1', senderMemberId: 'agent-a', recipientMemberIds: [], mentions: [], kind: 'task_result', blocks: [{ type: 'text', text: '结果已整理' }], expectsResponse: false, correlationId: 'c-1', hopCount: 0, sequence: 1, createdAt: '2026-01-01T00:00:00Z' }], tasks: [{ id: 'task-1', rootTaskId: 'task-1', originMessageId: 'msg-1', assigneeMemberId: 'agent-a', title: '失败任务', instructions: '执行', expectedOutput: '', dependsOnTaskIds: [], contextRefs: [], resourceClaims: [], returnTo: { conversationId: 'conv-1', replyToMessageId: 'msg-1' }, timeoutSeconds: 7200, currentAttemptId: 'attempt-1', kind: 'task', createdAt: '2026-01-01T00:00:00Z' }], attempts: [{ id: 'attempt-1', taskId: 'task-1', number: 1, status: 'failed', updatedAt: '2026-01-01T00:00:00Z', contextSequence: 0, output: '', error: { code: 'ERR', category: 'execution', message: '执行失败', retryable: true, traceId: 'trace-1' }, resourceClaims: [], tools: [], checklist: [] }] };
    render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
    expect(screen.getByText('结果已整理')).toBeTruthy();
    expect(screen.getByText('失败')).toBeTruthy();
    expect(screen.getByText('执行失败')).toBeTruthy();
  });

  it('opens task details and retains the task card after completion', () => {
    state.snapshot = { ...base, messages: [{ id: 'msg-1', conversationId: 'conv-1', senderMemberId: 'agent-a', recipientMemberIds: [], mentions: [], kind: 'task_assignment', blocks: [{ type: 'text', text: '任务已创建' }], expectsResponse: false, correlationId: 'c-1', hopCount: 0, sequence: 1, createdAt: '2026-01-01T00:00:00Z' }], tasks: [{ id: 'task-1', rootTaskId: 'task-1', originMessageId: 'msg-1', assigneeMemberId: 'agent-a', title: '保留结果', instructions: '执行并保留', expectedOutput: '文本', dependsOnTaskIds: [], contextRefs: [], planRef: { planId: 'plan-1', revision: 2, stepId: 'step-1' }, resourceClaims: [], returnTo: { conversationId: 'conv-1', replyToMessageId: 'msg-1' }, timeoutSeconds: 7200, currentAttemptId: 'attempt-1', kind: 'task', createdAt: '2026-01-01T00:00:00Z' }], attempts: [{ id: 'attempt-1', taskId: 'task-1', number: 1, status: 'succeeded', updatedAt: '2026-01-01T00:00:00Z', contextSequence: 0, output: '最终文本', resourceClaims: [], tools: [], checklist: [] }] };
    render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
    expect(screen.getByText('保留结果')).toBeTruthy();
    expect(screen.getByText('已完成')).toBeTruthy();
    expect(screen.getByText('计划 v2 · step-1')).toBeTruthy();
  });

  it('exposes the peer-direct policy and sends the toggle command', () => {
    const group = { ...base, conversation: { ...base.conversation, kind: 'group' as const, policy: { ...base.conversation.policy, allowPeerDirect: false } }, members: [...base.members, { id: 'agent-b', kind: 'agent' as const, agentId: 'agent-b', name: '审查员', avatar: '', role: '审查', active: true }] };
    state.snapshot = group;
    render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '成员 3' }));
    const toggle = screen.getByRole('checkbox', { name: /允许智能体之间发起单聊/ });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    fireEvent.click(toggle);
    expect(state.command).toHaveBeenCalledWith(expect.objectContaining({ action: 'policy', policy: { allowPeerDirect: true } }));
  });

  it('opens the parent group from a linked peer-direct message', () => {
    const onOpenConversation = vi.fn();
    state.snapshot = {
      ...base,
      conversation: { ...base.conversation, parentConversationId: 'group-1' },
      messages: [{
        id: 'msg-direct', conversationId: 'conv-1', senderMemberId: 'agent-a',
        recipientMemberIds: [], mentions: [], kind: 'chat', blocks: [{ type: 'text', text: '核对完成' }],
        contextRefs: [{ conversationId: 'group-1', messageId: 'group-msg-1' }],
        expectsResponse: false, correlationId: 'c-direct', causationId: 'group-msg-1', hopCount: 1,
        sequence: 1, createdAt: '2026-01-01T00:00:00Z',
      }],
    };
    render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={onOpenConversation} />);

    fireEvent.click(screen.getByRole('button', { name: '查看关联群聊消息' }));

    expect(onOpenConversation).toHaveBeenCalledWith('group-1');
  });

  it('retries a failed message delivery from the timeline', () => {
    state.command.mockResolvedValue({ snapshot: base });
    state.snapshot = {
      ...base,
      messages: [{
        id: 'failed-message', conversationId: 'conv-1', senderMemberId: 'user-1',
        recipientMemberIds: ['agent-a'], mentions: [], kind: 'chat',
        blocks: [{ type: 'text', text: '请重试' }], expectsResponse: true,
        correlationId: 'failed-correlation', hopCount: 0, sequence: 1,
        createdAt: '2026-01-01T00:00:00Z',
      }],
      deliveries: [{
        id: 'failed-delivery', messageId: 'failed-message', recipientMemberId: 'agent-a',
        status: 'failed', attemptId: 'failed-attempt', error: '发送失败',
      }],
    };
    render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '重新投递' }));

    expect(state.command).toHaveBeenCalledWith(expect.objectContaining({
      action: 'retry-message', conversationId: 'conv-1', messageId: 'failed-message',
    }));
  });

  it('renders @mentions inside the bubble with the member avatar', () => {
    state.snapshot = {
      ...base,
      conversation: { ...base.conversation, kind: 'group' },
      members: [...base.members, { id: 'agent-b', kind: 'agent', agentId: 'agent-b', name: '前端工程师', avatar: 'aw:v1:star:#55aadd:idle', role: '成员', active: true }],
      messages: [{
        id: 'mention-message', conversationId: 'conv-1', senderMemberId: 'user-1',
        recipientMemberIds: ['agent-b'], mentions: [{ memberId: 'agent-b', label: '前端工程师' }],
        kind: 'chat', blocks: [{ type: 'text', text: '但是我看到你就是在做协调员的工作啊' }],
        expectsResponse: true, correlationId: 'mention-correlation', hopCount: 0, sequence: 1,
        createdAt: '2026-01-01T00:00:00Z',
      }],
    };
    render(<CollaborationChatView workspace conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
    const body = screen.getByText('但是我看到你就是在做协调员的工作啊').closest('.collab-message__body');
    const chip = body?.querySelector('.collab-mention-chip');
    expect(chip?.textContent).toBe('前端工程师');
    expect(chip?.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('前端工程师');
    expect(document.querySelector('.collab-message__recipients')).toBeNull();
  });

  const groupBase = { ...base, conversation: { ...base.conversation, kind: 'group' as const }, members: [...base.members, { id: 'agent-b', kind: 'agent' as const, agentId: 'agent-b', name: '审查员', avatar: '', role: '审查', active: true }] };

  it('greets an empty group with every agent member', () => {
    state.snapshot = groupBase;
    render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
    const empty = screen.getByTestId('collaboration-group-empty');
    expect(empty.textContent).toContain('几个头脑，一场对话');
    expect(empty.textContent).toContain('研究员、审查员');
    expect([...empty.querySelectorAll('[data-motion]')].every((avatar) => avatar.getAttribute('data-motion') === 'idle')).toBe(true);
  });

  it('shows who is thinking before a running reply has output', () => {
    state.snapshot = { ...groupBase, tasks: [{ id: 'task-r', rootTaskId: 'task-r', originMessageId: 'msg-1', assigneeMemberId: 'agent-b', title: '回复', instructions: '', expectedOutput: '', dependsOnTaskIds: [], contextRefs: [], resourceClaims: [], returnTo: { conversationId: 'conv-1', replyToMessageId: 'msg-1' }, timeoutSeconds: 7200, currentAttemptId: 'attempt-r', kind: 'reply', createdAt: '2026-01-01T00:00:00Z' }], attempts: [{ id: 'attempt-r', taskId: 'task-r', number: 1, status: 'running', updatedAt: '2026-01-01T00:00:00Z', contextSequence: 0, output: '', resourceClaims: [], tools: [], checklist: [] }] };
    render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
    expect(screen.getByTestId('collaboration-thinking-attempt-r').textContent).toContain('思考中… 审查员');
  });

  it('lets the user rate an agent reply and toggles it off again', () => {
    localStorage.clear();
    state.snapshot = { ...groupBase, messages: [{ id: 'reply-1', conversationId: 'conv-1', senderMemberId: 'agent-a', recipientMemberIds: [], mentions: [], kind: 'chat', blocks: [{ type: 'text', text: '建议如下' }], expectsResponse: false, correlationId: 'c-1', hopCount: 0, sequence: 1, createdAt: '2026-01-01T00:00:00Z' }] };
    render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
    const up = screen.getByRole('button', { name: '有帮助' });
    fireEvent.click(up);
    expect(up.getAttribute('aria-pressed')).toBe('true');
    expect(JSON.parse(localStorage.getItem('sync-think.collab-feedback')!)).toEqual({ 'reply-1': 'up' });
    fireEvent.click(up);
    expect(up.getAttribute('aria-pressed')).toBe('false');
  });

  it('opens the agent editor from a reply author', () => {
    state.snapshot = { ...groupBase, messages: [{ id: 'reply-2', conversationId: 'conv-1', senderMemberId: 'agent-a', recipientMemberIds: [], mentions: [], kind: 'chat', blocks: [{ type: 'text', text: '好的' }], expectsResponse: false, correlationId: 'c-2', hopCount: 0, sequence: 1, createdAt: '2026-01-01T00:00:00Z' }] };
    render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '编辑研究员' }));
    expect(screen.getByTestId('collaboration-agent-editor')).toBeTruthy();
    expect(screen.getByRole('complementary', { name: '智能体设置' })).toBeTruthy();
  });
});

it('keeps thinking and progress details out of the streaming answer bubble', () => {
  const task: CollaborationSnapshot['tasks'][number] = { id: 'phase-task', rootTaskId: 'phase-task', originMessageId: 'origin', assigneeMemberId: 'agent-a', title: '聊天', instructions: '', expectedOutput: '', dependsOnTaskIds: [], contextRefs: [], resourceClaims: [], returnTo: { conversationId: 'conv-1', replyToMessageId: 'origin' }, timeoutSeconds: 120, currentAttemptId: 'phase-attempt', kind: 'reply', createdAt: '2026-01-01T00:00:00Z' };
  const attempt: CollaborationSnapshot['attempts'][number] = { id: 'phase-attempt', taskId: task.id, number: 1, status: 'running', phase: 'thinking', output: '', updatedAt: '2026-01-01T00:00:00Z', contextSequence: 0, resourceClaims: [], tools: [], checklist: [] };
  state.snapshot = { ...base, tasks: [task], attempts: [attempt] };
  const element = <CollaborationChatView workspace conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />;
  const view = render(element);
  expect(screen.getByTestId('collaboration-thinking-phase-attempt').textContent).toContain('思考中');
  expect(screen.queryByTestId('collaboration-stream-phase-attempt')).toBeNull();

  state.snapshot = { ...state.snapshot, attempts: [{ ...attempt, phase: 'working', commentary: '我先查看已提供的设定', tools: [{ id: 'read', name: 'read_file', arguments: '', status: 'running' }] }] };
  view.rerender(<CollaborationChatView workspace conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  expect(screen.queryByText('我先查看已提供的设定')).toBeNull();
  expect(screen.queryByTestId('collaboration-stream-phase-attempt')).toBeNull();
  const details = screen.getByRole('button', { name: '研究员 · 执行中…' });
  expect(details.hasAttribute('disabled')).toBe(true);
  expect(screen.queryByText('我先查看已提供的设定')).toBeNull();
  expect(screen.getByRole('button', { name: /任务详情/ })).toBeTruthy();

  state.snapshot = { ...state.snapshot, attempts: [{ ...attempt, phase: 'answering', output: '先从你喜欢的世界观聊起。' }] };
  view.rerender(<CollaborationChatView workspace conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  expect(screen.queryByTestId('collaboration-stream-phase-attempt')).toBeNull();
  expect(screen.getByTestId('collaboration-thinking-phase-attempt')).toBeTruthy();
  // Old daemons have no phase marker: they must not leak intermediate output either.
  state.snapshot = { ...state.snapshot, attempts: [{ ...attempt, phase: undefined, output: '我先检查工作区' }] };
  view.rerender(<CollaborationChatView workspace conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  expect(screen.queryByText('我先检查工作区')).toBeNull();

  state.snapshot = { ...state.snapshot, attempts: [{ ...attempt, status: 'waiting_input' }] };
  view.rerender(<CollaborationChatView workspace conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  expect(screen.getByText('等待你确认')).toBeTruthy();

  state.snapshot = { ...state.snapshot, attempts: [{ ...attempt, status: 'stopping' }] };
  view.rerender(<CollaborationChatView workspace conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  expect(screen.getByText('正在停止…')).toBeTruthy();
});


it('inserts a selected member in the middle of the editor and sends durable positions', async () => {
  state.snapshot = base;
  state.command.mockResolvedValue({ snapshot: base });
  const { container } = render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  const input = screen.getByTestId('collaboration-draft');
  fireEvent.change(input, { target: { value: '帮我问一下@ 这个问题', selectionStart: 6 } });
  fireEvent.click(screen.getByRole('option', { name: /研究员/ }));
  const editor = screen.getByRole('textbox', { name: '协作消息' });
  expect(editor.textContent).toBe('帮我问一下研究员 这个问题');
  expect(editor.querySelector('[data-member-id="agent-a"]')?.textContent).toBe('研究员');
  expect(container.querySelector('.collab-composer__recipients')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
  await waitFor(() => expect(state.command).toHaveBeenCalledWith(expect.objectContaining({
    text: '帮我问一下研究员 这个问题', recipientMemberIds: ['agent-a'],
    mentions: [{ memberId: 'agent-a', label: '研究员', start: 5, end: 8 }],
  })));
});

it('renders mention tags between surrounding text, even after the agent is renamed', () => {
  state.snapshot = { ...base, messages: [{
    id: 'inline', conversationId: 'conv-1', senderMemberId: 'user-1', recipientMemberIds: ['agent-a'],
    mentions: [{ memberId: 'agent-a', label: '原名字', start: 2, end: 5 }],
    kind: 'chat', blocks: [{ type: 'text', text: '问问原名字这个问题' }], expectsResponse: true,
    correlationId: 'inline', hopCount: 0, sequence: 1, createdAt: '2026-09-29',
  }] };
  const { container } = render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  const paragraph = container.querySelector('[data-message-id="inline"] .shell-md p');
  expect(paragraph?.textContent).toBe('问问研究员这个问题');
  expect(paragraph?.childNodes[0].textContent).toBe('问问');
  expect(paragraph?.querySelector('.collab-mention-chip')?.textContent).toBe('研究员');
  expect(paragraph?.lastChild?.textContent).toBe('这个问题');
  expect(paragraph?.textContent).not.toContain('@');
});

it('does not manufacture a visible mention from automatic direct-chat recipients', () => {
  state.snapshot = { ...base, messages: [{
    id: 'plain', conversationId: 'conv-1', senderMemberId: 'user-1', recipientMemberIds: ['agent-a'], mentions: [],
    kind: 'chat', blocks: [{ type: 'text', text: '没有提及' }], expectsResponse: true,
    correlationId: 'plain', hopCount: 0, sequence: 1, createdAt: '2026-09-29',
  }] };
  const { container } = render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  expect(container.querySelector('.collab-mention-chip')).toBeNull();
});

it('adds an existing team with a topology precondition and keeps internals out of group member count',async()=>{
 state.snapshot={...base,conversation:{...base.conversation,kind:'group',topologyRevision:4}};
 const team: import('@sync-think/shared').Team={id:'team-1' as import('@sync-think/shared').TeamId,name:'研发小队',avatar:'',mission:'研发',strategy:'serial',members:[],createdAt:'',updatedAt:''};
 render(<CollaborationChatView conversation={conversation} agents={[agent]} teams={[team]} onOpenConversation={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'成员 2'}));
 fireEvent.change(screen.getByLabelText('添加小队'),{target:{value:'team-1'}});
 await waitFor(()=>expect(state.command).toHaveBeenCalledWith(expect.objectContaining({action:'members',addTeamIds:['team-1'],expectedTopologyRevision:4})));
});
