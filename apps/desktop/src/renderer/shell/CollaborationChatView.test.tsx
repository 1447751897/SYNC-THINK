/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Conversation, GlobalAgent, CollaborationSnapshot, CollaborationTask } from '@sync-think/shared';

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
    fireEvent.click(screen.getByRole('button', { name: '执行设置' }));
  fireEvent.click(screen.getByText('高级协作设置'));
  fireEvent.click(screen.getByRole('button', { name: '执行设置' }));
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
 fireEvent.keyDown(screen.getByRole('combobox', { name: '添加小队' }), { key: 'ArrowDown' });
 fireEvent.click(await screen.findByRole('menuitemradio', { name: /研发小队/ }));
 await waitFor(()=>expect(state.command).toHaveBeenCalledWith(expect.objectContaining({action:'members',addTeamIds:['team-1'],expectedTopologyRevision:4})));
});

function roomSnapshot(status: 'discussion' | 'paused' = 'discussion'): CollaborationSnapshot {
  return { ...base, conversation: { ...base.conversation, kind: 'group', room: { version: 1, state: status, goal: '只写小说 A', goalRevision: 1, sourceSequence: 0, checkpoint: { version: 1, savedAt: '2026-09-30', pendingTaskIds: [], completedTaskIds: [], artifactIds: [], note: '' } } } };
}
it('defaults to chat and returns to chat after one explicit work assignment', async () => {
  state.snapshot = roomSnapshot(); state.command.mockResolvedValue({ snapshot: state.snapshot });
  render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  fireEvent.change(screen.getByTestId('collaboration-draft'), { target: { value: '先讨论人物', selectionStart: 6 } });
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
  await waitFor(() => expect(state.command).toHaveBeenCalledWith(expect.objectContaining({ action: 'send', intent: 'chat' })));
  await waitFor(() => expect((screen.getByTestId('collaboration-draft') as HTMLInputElement).value).toBe(''));
  fireEvent.click(screen.getByRole('button', { name: '分配小工作' }));
  fireEvent.change(screen.getByTestId('collaboration-draft'), { target: { value: '写第一章', selectionStart: 4 } });
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
  await waitFor(() => expect(state.command).toHaveBeenCalledWith(expect.objectContaining({ action: 'send', intent: 'work' })));
  await waitFor(() => expect(screen.getByRole('button', { name: '聊天' }).getAttribute('aria-pressed')).toBe('true'));
  fireEvent.change(screen.getByTestId('collaboration-draft'), { target: { value: '现在呢？' } });
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
  await waitFor(() => expect(state.command).toHaveBeenLastCalledWith(expect.objectContaining({ text: '现在呢？', intent: 'chat' })));
});
it('keeps consultation available while paused and does not label a paused delivery as failed', () => {
  state.snapshot = { ...roomSnapshot('paused'), messages: [{ id: 'paused-message', conversationId: 'conv-1', senderMemberId: 'user-1', recipientMemberIds: ['agent-a'], mentions: [], kind: 'chat', blocks: [{ type: 'text', text: '写半章' }], expectsResponse: true, correlationId: 'p', hopCount: 0, sequence: 1, createdAt: '2026-09-30' }], attempts: [{ id: 'paused-attempt', taskId: 't', number: 1, status: 'interrupted', pauseRequested: true, output: '半章', contextSequence: 1, resourceClaims: [], tools: [], checklist: [], updatedAt: '2026-09-30' }], deliveries: [{ id: 'd', messageId: 'paused-message', recipientMemberId: 'agent-a', status: 'failed', attemptId: 'paused-attempt' }] };
  render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  expect((screen.getByRole('button', { name: '分配小工作' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '只讨论' }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByText('本群已暂停 · 等待继续')).toBeTruthy(); expect(screen.queryByText('重新投递')).toBeNull();
});


it('allows room consultation separately from private-chat policy and shows routed recipients', () => {
  state.snapshot = { ...base, conversation: { ...base.conversation, kind: 'group', policy: { ...base.conversation.policy, allowGroupMessages: false, allowPeerDirect: false },
    room: { version: 1, state: 'discussion', goal: '', goalRevision: 0, sourceSequence: 0, checkpoint: { version: 0, savedAt: '', pendingTaskIds: [], completedTaskIds: [], artifactIds: [], note: '' } } },
    messages: [{ id: 'consultation', conversationId: 'conv-1', senderMemberId: 'agent-a', recipientMemberIds: ['user-1'], mentions: [], kind: 'chat', blocks: [{ type: 'text', text: '收到，不再往返' }], expectsResponse: false, correlationId: 'c', hopCount: 1, sequence: 1, createdAt: '2026-01-01T00:00:00Z' }],
    deliveries: [{ id: 'delivery', messageId: 'consultation', recipientMemberId: 'user-1', status: 'processed' }] };
  render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  expect(screen.queryByText('→ 用户')).toBeNull();
  expect(screen.queryByText('已送达 · 不触发回复')).toBeNull();
  expect(screen.getByText('自动路由 · @ 可指定成员')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '成员 2' }));
  fireEvent.click(screen.getByRole('button', { name: '执行设置' }));
  fireEvent.click(screen.getByText('高级协作设置'));
  fireEvent.click(screen.getByRole('button', { name: '执行设置' }));
  const toggle = screen.getByRole('checkbox', { name: /允许群内智能体互相咨询/ });
  expect((toggle as HTMLInputElement).checked).toBe(false);
  fireEvent.click(toggle);
  expect(state.command).toHaveBeenCalledWith(expect.objectContaining({ action: 'policy', policy: { allowGroupMessages: true } }));
  expect(state.command).not.toHaveBeenCalledWith(expect.objectContaining({ policy: { allowPeerDirect: true } }));
});

it('keeps an explicit discussion-only mode rather than silently promoting it to work', async () => {
  state.snapshot = roomSnapshot(); state.command.mockResolvedValue({ snapshot: state.snapshot });
  render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '只讨论' }));
  fireEvent.change(screen.getByTestId('collaboration-draft'), { target: { value: '讨论如何开始，不要执行' } });
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
  await waitFor(() => expect(state.command).toHaveBeenCalledWith(expect.objectContaining({ intent: 'discussion' })));
  expect(screen.getByRole('button', { name: '只讨论' }).getAttribute('aria-pressed')).toBe('true');
});

it('projects real @ dispatches and one document delivery without internal receipts or automatic quotes', async () => {
  const task = { id: 't', rootTaskId: 't', originMessageId: 'assignment', assigneeMemberId: 'agent-a', title: '写正文', instructions: '写正文', expectedOutput: '', dependsOnTaskIds: [], contextRefs: [], resourceClaims: [], returnTo: { conversationId: 'conv-1', replyToMessageId: 'human' }, timeoutSeconds: 7200, currentAttemptId: 'a', kind: 'task' as const, purpose: 'work' as const, createdAt: '2026-10-01' };
  const message = { conversationId: 'conv-1', recipientMemberIds: [], mentions: [], expectsResponse: false, correlationId: 'c', hopCount: 0, createdAt: '2026-10-01' };
  state.snapshot = { ...roomSnapshot(), members: [...base.members, { id: 'leader', kind: 'agent', name: '主策划', role: '', avatar: '', active: true }], tasks: [task], attempts: [{ id: 'a', taskId: 't', number: 1, status: 'succeeded', updatedAt: '2026-10-01', contextSequence: 0, output: '原始工作回执', resourceClaims: [], tools: [], checklist: [], artifacts: [{ id: 'doc', taskId: 't', attemptId: 'a', title: '小说最终稿', kind: 'document', content: '仅在成果栏的完整正文', sha256: 'abc', bytes: 36, createdAt: '2026-10-01' }] }], messages: [
    { ...message, id: 'human', senderMemberId: 'user-1', kind: 'chat', blocks: [{ type: 'text', text: '开始写小说' }], sequence: 1 },
    { ...message, id: 'assignment', senderMemberId: 'leader', kind: 'task_assignment', blocks: [{ type: 'text', text: '冗长派工说明' }], sequence: 2, taskId: 't' },
    { ...message, id: 'notification', senderMemberId: 'agent-a', recipientMemberIds: ['leader'], kind: 'chat', causationId: 'assignment', blocks: [{ type: 'text', text: '文档已保存，84字符。' }], sequence: 2.1 },
    { ...message, id: 'question', senderMemberId: 'agent-a', recipientMemberIds: ['leader'], kind: 'chat', causationId: 'assignment', expectsResponse: true, blocks: [{ type: 'text', text: '还要修改哪一处？' }], sequence: 2.2 },
    { ...message, id: 'result', senderMemberId: 'agent-a', kind: 'task_result', blocks: [{ type: 'text', text: '原始工作回执' }], sequence: 3, taskId: 't', attemptId: 'a', replyToMessageId: 'human' },
    { ...message, id: 'manual', senderMemberId: 'user-1', kind: 'chat', blocks: [{ type: 'text', text: '这里改一下' }], sequence: 4, replyToMessageId: 'result' },
  ] };
  const { container } = render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  await screen.findByRole('navigation', { name: '成果列表' });
  expect(container.querySelector('.collab-chat__messages .collab-artifact')).toBeNull();
  expect(container.querySelector('.collab-chat__messages')?.textContent).not.toContain('仅在成果栏的完整正文');
  expect(screen.queryByText('冗长派工说明')).toBeNull();
  expect(container.querySelector('[data-message-id="result"] .collab-message__quote')).toBeNull();
  expect(container.querySelector('[data-message-id="manual"] .collab-message__quote')).toBeTruthy();
  expect(container.querySelector('.collab-work-receipt')).toBeNull();
  expect(container.querySelector('[data-message-id="assignment"]')?.textContent).toContain('@研究员');
  expect(container.querySelector('[data-message-id="assignment"]')?.textContent).toContain('请完成：写正文');
  expect(container.querySelector('[data-message-id="result"]')?.textContent).toContain('文档交付');
  expect(container.querySelector('[data-message-id="result"]')?.textContent).not.toContain('原始工作回执');
  expect(container.querySelector('.collab-chat__messages')?.textContent).not.toContain('原始工作回执');
  expect(container.querySelectorAll('[data-event-kind="delivery"]').length).toBe(1);
  expect(container.querySelector('[data-message-id="notification"]')).toBeNull();
  expect(container.querySelector('[data-message-id="result"]')?.textContent).toContain('文档已保存，84字符。');
  expect(container.querySelector('[data-message-id="question"]')?.textContent).toContain('还要修改哪一处？');
  expect(container.querySelector('[data-message-id="assignment"] .collab-message__identity')?.textContent).toContain('主策划');
  expect(screen.getByRole('button', { name: '成果 1' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /小说最终稿.*在右侧打开/ }));
  expect(screen.getByRole('complementary', { name: '群聊成果' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '关闭详情' }));
  expect(screen.queryByRole('complementary', { name: '群聊成果' })).toBeNull();
});

it('keeps genuine peer discussion visible rather than labeling it an execution receipt', () => {
  const message = { conversationId: 'conv-1', senderMemberId: 'agent-a', mentions: [], kind: 'chat' as const, blocks: [{ type: 'text' as const, text: '详细报告。'.repeat(80) }], expectsResponse: false, correlationId: 'c', hopCount: 0, createdAt: '2026-10-01' };
  state.snapshot = { ...roomSnapshot(), messages: [{ ...message, id: 'peer', recipientMemberIds: ['agent-a'], sequence: 1 }, { ...message, id: 'answer', recipientMemberIds: ['user-1'], sequence: 2 }] };
  const { container } = render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  expect(container.querySelector('[data-message-id="peer"] details')).toBeNull();
  expect(container.querySelector('[data-message-id="peer"]')?.textContent).toContain('详细报告。');
  expect(container.querySelector('[data-message-id="answer"] details')).toBeNull();
});


it('hides host coordination wakeups and receipts while retaining human instructions and genuine @ consultations', () => {
  const message = { conversationId: 'conv-1', mentions: [], expectsResponse: false, correlationId: 'c', hopCount: 0, createdAt: '2026-10-01' };
  const task = { id: 'coord', rootTaskId: 'coord', originMessageId: 'request', assigneeMemberId: 'agent-a', title: '内部协调轮次', instructions: '调度', expectedOutput: '', dependsOnTaskIds: [], contextRefs: [], resourceClaims: [], returnTo: { conversationId: 'conv-1', replyToMessageId: 'request' }, timeoutSeconds: 7200, currentAttemptId: 'co-a', kind: 'task' as const, purpose: 'coordination' as const, createdAt: '2026-10-01' };
  state.snapshot = { ...roomSnapshot(), members: [...base.members, { id: 'writer', kind: 'agent', name: '正文写手', role: '', avatar: '', active: true }], tasks: [task], messages: [
    { ...message, id: 'request', senderMemberId: 'user-1', recipientMemberIds: ['agent-a'], kind: 'chat', taskId: 'coord', blocks: [{ type: 'text', text: '先审查再开始' }], sequence: 1 },
    { ...message, id: 'wake', senderMemberId: 'agent-a', recipientMemberIds: ['agent-a'], kind: 'system', blocks: [{ type: 'text', text: '内部唤醒' }], sequence: 2 },
    { ...message, id: 'coord-start', senderMemberId: 'user-1', recipientMemberIds: ['agent-a'], kind: 'task_assignment', taskId: 'coord', blocks: [{ type: 'text', text: '自动协调启动说明' }], sequence: 3 },
    { ...message, id: 'receipt', senderMemberId: 'agent-a', recipientMemberIds: ['agent-a'], kind: 'task_result', taskId: 'coord', blocks: [{ type: 'text', text: '内部协调回执' }], sequence: 4 },
    { ...message, id: 'consult', senderMemberId: 'agent-a', recipientMemberIds: ['writer'], kind: 'chat', blocks: [{ type: 'text', text: '请确认结尾有没有矛盾' }], expectsResponse: true, sequence: 5 },
  ] };
  const { container } = render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  expect(screen.getByText('先审查再开始')).toBeTruthy();
  expect(screen.queryByText('内部唤醒')).toBeNull(); expect(screen.queryByText('内部协调回执')).toBeNull();
  expect(screen.queryByText('自动协调启动说明')).toBeNull();
  expect(container.querySelector('[data-message-id="consult"]')?.textContent).toContain('@正文写手');
  expect(screen.getByText('请确认结尾有没有矛盾')).toBeTruthy();
  expect(container.querySelectorAll('[data-event-kind="assignment"]').length).toBe(0);
});

it('labels a retained file from a failed work attempt as a draft, not a completed delivery', () => {
  const task = { id: 'draft-task', rootTaskId: 'draft-task', originMessageId: 'request', assigneeMemberId: 'agent-a', title: '写草稿', instructions: '写', expectedOutput: '', dependsOnTaskIds: [], contextRefs: [], resourceClaims: [], returnTo: { conversationId: 'conv-1', replyToMessageId: 'request' }, timeoutSeconds: 7200, currentAttemptId: 'draft-attempt', kind: 'task' as const, purpose: 'work' as const, createdAt: '2026-10-01' };
  state.snapshot = { ...roomSnapshot(), tasks: [task], attempts: [{ id: 'draft-attempt', taskId: task.id, number: 1, status: 'failed', updatedAt: '2026-10-01', contextSequence: 0, output: '执行回执', resourceClaims: [], tools: [], checklist: [], artifacts: [{ id: 'draft-doc', taskId: task.id, attemptId: 'draft-attempt', title: '未完成正文', kind: 'document', content: '草稿正文', sha256: 'abc', bytes: 12, createdAt: '2026-10-01' }] }], messages: [{ id: 'draft-message', conversationId: 'conv-1', senderMemberId: 'agent-a', recipientMemberIds: [], mentions: [], kind: 'task_result', blocks: [{ type: 'text', text: '执行回执' }], taskId: task.id, attemptId: 'draft-attempt', expectsResponse: false, correlationId: 'c', hopCount: 0, sequence: 1, createdAt: '2026-10-01' }] };
  const { container } = render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  expect(container.querySelector('[data-message-id="draft-message"]')?.textContent).toContain('文档草稿');
  expect(container.querySelector('[data-message-id="draft-message"]')?.textContent).not.toContain('文档交付');
  expect(container.querySelector('[data-message-id="draft-message"]')?.textContent).not.toContain('执行回执');
});


it.each(['哇哈哈', '@研究员 用户让你在本群发个「哇哈哈」，就行。'])('keeps actions outside the bubble and usable for %s', (text) => {
  const task: CollaborationSnapshot['tasks'][number] = { id: 'hover-task', rootTaskId: 'hover-task', originMessageId: 'hover-message', assigneeMemberId: 'agent-a', title: '聊天回复', instructions: '发个哇哈哈', expectedOutput: '', purpose: 'discussion', kind: 'reply', dependsOnTaskIds: [], contextRefs: [], resourceClaims: [], returnTo: { conversationId: 'conv-1', replyToMessageId: 'hover-message' }, timeoutSeconds: 120, currentAttemptId: 'hover-attempt', createdAt: '2026-10-01' };
  state.snapshot = { ...roomSnapshot(), tasks: [task], messages: [{ id: 'hover-message', conversationId: 'conv-1', senderMemberId: 'agent-a', recipientMemberIds: ['user-1'], mentions: text.startsWith('@') ? [{ memberId: 'agent-a', label: '@研究员', start: 0, end: 4 }] : [], kind: 'chat', taskId: task.id, blocks: [{ type: 'text', text }], expectsResponse: false, correlationId: 'hover', hopCount: 0, sequence: 1, createdAt: '2026-10-01' }] };
  const { container } = render(<CollaborationChatView workspace conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  const bubble = container.querySelector('.collab-message__body')!;
  const actions = container.querySelector('.collab-message__actions') as HTMLElement;
  expect(actions.parentElement).toBe(bubble.parentElement);
  expect(bubble.querySelector('button')).toBeNull();
  expect(within(actions).getByRole('button', { name: '查看回复执行' })).toBeTruthy();
  expect(within(actions).getByRole('button', { name: '复制回复' })).toBeTruthy();
  const up = within(actions).getByRole('button', { name: '有帮助' });
  const before = up.getAttribute('aria-pressed');
  fireEvent.click(up);
  expect(up.getAttribute('aria-pressed')).not.toBe(before);
  fireEvent.click(within(actions).getByRole('button', { name: '回复' }));
  expect(container.querySelector('.collab-composer__reference')?.textContent).toBe('回复：' + text);
  expect(screen.getByRole('button', { name: '取消回复' })).toBeTruthy();
});

it.each([false, true])('keeps a coordinator blocker visible without an artifact and bounds long explanations: %s', async (long) => {
  const task = { id: 'blocked-task', rootTaskId: 'blocked-task', originMessageId: 'origin', assigneeMemberId: 'agent-a', title: '分析仓库', instructions: '读取源码', purpose: 'coordination' as const, expectedOutput: '', dependsOnTaskIds: [], contextRefs: [], resourceClaims: [], returnTo: { conversationId: 'conv-1', replyToMessageId: 'origin' }, timeoutSeconds: 7200, currentAttemptId: 'blocked-attempt', kind: 'task' as const, createdAt: '2026-10-01' };
  state.snapshot = { ...base, conversation: { ...base.conversation, kind: 'group', room: { version: 1, state: 'blocked', goal: '分析', goalRevision: 1, sourceSequence: 1, checkpoint: { version: 1, savedAt: '', pendingTaskIds: [task.id], completedTaskIds: [], artifactIds: [], note: '缺少联网读取' } } }, tasks: [task], attempts: [{ id: task.currentAttemptId, taskId: task.id, number: 1, status: 'failed', output: '缺少联网读取', updatedAt: '2026-10-01', contextSequence: 1, resourceClaims: [], tools: [], checklist: [], error: { code: 'work_blocked', category: 'permission', message: long ? '详细阻塞原因。'.repeat(80) : '请启用群聊联网读取后继续', nextStep: '打开联网读取后核对并继续', retryable: true, traceId: 'trace' } }], messages: [{ id: 'blocked-result', conversationId: 'conv-1', senderMemberId: 'agent-a', recipientMemberIds: [], mentions: [], kind: 'task_result', taskId: task.id, attemptId: task.currentAttemptId, blocks: [{ type: 'text', text: '缺少联网读取' }], expectsResponse: false, correlationId: '', hopCount: 0, sequence: 2, createdAt: '2026-10-01' }] };
  const view = render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  expect(screen.getByText('工作阻塞')).toBeTruthy();
  if (!long) expect(screen.getByText('请启用群聊联网读取后继续')).toBeTruthy();
  expect(screen.getByText('下一步：打开联网读取后核对并继续')).toBeTruthy();
  if (long) {
    const reason = view.container.querySelector('.collab-event__blocker')!;
    expect(reason.textContent?.length).toBe(201);
    expect(reason.textContent?.endsWith('…')).toBe(true);
    expect(state.snapshot.attempts[0].error?.message.length).toBeGreaterThan(200);
  }
  expect(view.container.querySelector('[data-event-kind="blocker"]')).toBeTruthy();
  expect(screen.getByRole('button', { name: '查看执行详情' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '验收完成' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查看执行详情' }));
  await waitFor(() => expect(screen.getByRole('status', { name: '工作阻塞详情' }).textContent).toContain(state.snapshot!.attempts[0].error!.message));
  expect(screen.getByRole('status', { name: '工作阻塞详情' }).textContent).toContain('下一步：打开联网读取后核对并继续');
});
it('lets the human enable group network reading without changing file permissions', async () => {
  state.snapshot = { ...base, conversation: { ...base.conversation, kind: 'group' } };
  render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  const toggle = screen.getByRole('button', { name: '群聊联网读取' });
  expect(toggle.getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(toggle);
  await waitFor(() => expect(state.command).toHaveBeenCalledWith(expect.objectContaining({ action: 'policy', policy: { networkEnabled: true } })));
  expect(conversation.executionMode).toBe('full-access');
});

it.each(['dependency', 'dependency_failed'] as const)('keeps legacy unstarted downstream dispatches out of the room timeline (%s)', waitReason => {
  const task = { id: 'future', rootTaskId: 'future', originMessageId: 'assignment', assigneeMemberId: 'agent-a', title: '后续正文', instructions: '写正文', expectedOutput: '', dependsOnTaskIds: ['outline'], contextRefs: [], resourceClaims: [], returnTo: { conversationId: 'conv-1', replyToMessageId: 'human' }, timeoutSeconds: 7200, currentAttemptId: 'future-attempt', kind: 'task' as const, purpose: 'work' as const, createdAt: '2026-10-03' };
  const error = waitReason === 'dependency_failed' ? { code: 'dependency_failed', category: 'execution' as const, message: '前置任务未交付，当前阶段未启动', retryable: true, traceId: 'trace' } : undefined;
  const message = { conversationId: 'conv-1', senderMemberId: 'agent-a', recipientMemberIds: [], mentions: [], expectsResponse: false, correlationId: 'chain', hopCount: 0, createdAt: '2026-10-03', taskId: task.id, attemptId: task.currentAttemptId };
  state.snapshot = { ...roomSnapshot(), tasks: [task], attempts: [{ id: task.currentAttemptId, taskId: task.id, number: 1, status: error ? 'failed' : 'queued', waitReason, error, updatedAt: '2026-10-03', contextSequence: 0, output: '', resourceClaims: [], tools: [], checklist: [] }], messages: [
    { ...message, id: 'assignment', kind: 'task_assignment', blocks: [{ type: 'text', text: '提前派工' }], sequence: 1 },
    ...(error ? [{ ...message, id: 'synthetic-blocker', kind: 'task_result' as const, blocks: [{ type: 'text' as const, text: error.message }], sequence: 2 }] : []),
  ] };
  const view = render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  expect(view.container.querySelector('[data-message-id="assignment"]')).toBeNull();
  expect(view.container.querySelector('[data-message-id="synthetic-blocker"]')).toBeNull();
  expect(view.container.querySelector('.collab-chat__messages')?.textContent).not.toContain('后续正文');
  state.snapshot = { ...state.snapshot, revision: 2, attempts: [{ ...state.snapshot.attempts[0], status: 'running', waitReason: undefined, error: undefined, startedAt: '2026-10-03T00:01:00Z' }] };
  view.rerender(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  expect(view.container.querySelector('[data-message-id="assignment"]')?.textContent).toContain('请完成：后续正文');
  expect(view.container.querySelector('[data-message-id="assignment"]')?.textContent).toContain('执行中');
});

it('shows a delivered production @handoff and a textual review decision rather than hiding coordination', () => {
  const date = '2026-10-03T00:00:00Z';
  const task: CollaborationSnapshot['tasks'][number] = { id:'t',rootTaskId:'t',originMessageId:'origin',assigneeMemberId:'agent-a',purpose:'work',title:'正文',instructions:'编写',expectedOutput:'',dependsOnTaskIds:[],contextRefs:[],resourceClaims:[],returnTo:{conversationId:'conv-1',replyToMessageId:'origin'},timeoutSeconds:7200,currentAttemptId:'a',kind:'task',createdAt:date };
  state.snapshot = { ...base, conversation:{...base.conversation,kind:'group',room:{version:1,state:'review',goal:'交付正文',goalRevision:1,sourceSequence:1,checkpoint:{version:1,savedAt:date,pendingTaskIds:[],completedTaskIds:[],artifactIds:[],note:''}}},
    members:[...base.members,{id:'reviewer',kind:'agent',name:'内容审核',avatar:'',role:'审核',active:true}],
    tasks:[task,{...task,id:'review',assigneeMemberId:'reviewer',purpose:'coordination',title:'审核正文',currentAttemptId:'ra',handoff:{kind:'review',sourceTaskId:'t',sourceAttemptId:'a',artifactIds:['art']}}],
    attempts:[{id:'a',taskId:'t',number:1,status:'succeeded',updatedAt:date,contextSequence:1,output:'已完成',resourceClaims:[],tools:[],checklist:[],workHandoff:{kind:'review',recipientMemberId:'reviewer',text:'请审核这个正文版本。'},artifacts:[{id:'art',taskId:'t',attemptId:'a',kind:'document',title:'正文版本',content:'正文',sha256:'hash',bytes:6,createdAt:date}]},
      {id:'ra',taskId:'review',number:1,status:'succeeded',updatedAt:date,contextSequence:2,output:'本版审核通过。',resourceClaims:[],tools:[],checklist:[]}],
    messages:[{id:'result',conversationId:'conv-1',senderMemberId:'agent-a',recipientMemberIds:['reviewer'],mentions:[{memberId:'reviewer',label:'内容审核'}],kind:'task_result',blocks:[{type:'text',text:'请审核这个正文版本。'}],taskId:'t',attemptId:'a',expectsResponse:false,correlationId:'goal',hopCount:0,sequence:1,createdAt:date},
      {id:'review-result',conversationId:'conv-1',senderMemberId:'reviewer',recipientMemberIds:['agent-a'],mentions:[{memberId:'agent-a',label:'研究员'}],kind:'task_result',blocks:[{type:'text',text:'本版审核通过。'}],taskId:'review',attemptId:'ra',expectsResponse:false,correlationId:'goal',hopCount:0,sequence:2,createdAt:date}] };
  render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  expect(screen.getByText('请求审核')).toBeTruthy();expect(screen.getByText('@内容审核')).toBeTruthy();expect(screen.getByText('请审核这个正文版本。')).toBeTruthy();expect(screen.getByText('本版审核通过。')).toBeTruthy();
});


it.each(['outgoing', 'incoming'] as const)('folds long %s handoffs without dropping their full instructions', direction => {
  const date = '2026-10-03T00:00:00Z';
  const text = '只修表达，完成后送审核复审。'.repeat(180);
  const task: CollaborationSnapshot['tasks'][number] = { id: 'long-task', rootTaskId: 'long-task', originMessageId: 'origin', assigneeMemberId: 'agent-a', purpose: 'coordination', title: '审核正文', instructions: text, expectedOutput: '', dependsOnTaskIds: [], contextRefs: [], resourceClaims: [], returnTo: { conversationId: 'conv-1', replyToMessageId: 'origin' }, timeoutSeconds: 7200, currentAttemptId: 'long-attempt', kind: 'task', createdAt: date,
    ...(direction === 'incoming' ? { handoff: { kind: 'report', sourceTaskId: 'source', sourceAttemptId: 'source-attempt', artifactIds: [] } } : {}) };
  state.snapshot = { ...roomSnapshot(), tasks: [task], attempts: [{ id: 'long-attempt', taskId: task.id, number: 1, status: 'succeeded', updatedAt: date, contextSequence: 1, output: text, resourceClaims: [], tools: [], checklist: [],
    ...(direction === 'outgoing' ? { workHandoff: { kind: 'report', recipientMemberId: 'user-1', text } } : {}) }],
    messages: [{ id: 'long-result', conversationId: 'conv-1', senderMemberId: 'agent-a', recipientMemberIds: ['user-1'], mentions: [], kind: 'task_result', blocks: [{ type: 'text', text }], taskId: task.id, attemptId: 'long-attempt', expectsResponse: false, correlationId: 'goal', hopCount: 0, sequence: 1, createdAt: date }] };
  const view = render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  const bubble = view.container.querySelector('[data-message-id="long-result"]')!;
  const expand = within(bubble as HTMLElement).getByRole('button', { name: '展开交接说明' });
  expect(expand.getAttribute('aria-expanded')).toBe('false');
  expect(bubble.textContent).toContain(text.slice(0, 240) + '…');
  expect(bubble.textContent).not.toContain(text);
  fireEvent.click(expand);
  expect(bubble.textContent).toContain(text);
  const collapse = within(bubble as HTMLElement).getByRole('button', { name: '收起交接说明' });
  expect(collapse.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(collapse);
  expect(bubble.textContent).not.toContain(text);
  expect(state.snapshot.tasks[0].instructions).toBe(text);
});


it.each(['failed', 'interrupted', 'cancelled'] as const)('labels a routed %s attempt as blocked and shows its error only once', status => {
  const date = '2026-10-03T00:00:00Z';
  const reason = '润色超时，尚未提交新成果。';
  const task: CollaborationSnapshot['tasks'][number] = { id: 'failed-task', rootTaskId: 'failed-task', originMessageId: 'origin', assigneeMemberId: 'agent-a', purpose: 'work', title: '润色正文', instructions: '润色', expectedOutput: '', dependsOnTaskIds: [], contextRefs: [], resourceClaims: [], returnTo: { conversationId: 'conv-1', replyToMessageId: 'origin' }, timeoutSeconds: 7200, currentAttemptId: 'failed-attempt', kind: 'task', createdAt: date, handoff: { kind: 'work', sourceTaskId: 'source', sourceAttemptId: 'source-attempt', artifactIds: [] } };
  state.snapshot = { ...roomSnapshot(), tasks: [task], attempts: [{ id: 'failed-attempt', taskId: task.id, number: 1, status, startedAt: date, updatedAt: date, contextSequence: 1, output: '', resourceClaims: [], tools: [], checklist: [], error: { code: 'timeout', category: 'execution', message: reason, retryable: true, traceId: 'trace' } }], messages: [{ id: 'failed-result', conversationId: 'conv-1', senderMemberId: 'agent-a', recipientMemberIds: ['user-1'], mentions: [], kind: 'task_result', blocks: [{ type: 'text', text: reason }], taskId: task.id, attemptId: 'failed-attempt', expectsResponse: false, correlationId: 'goal', hopCount: 0, sequence: 1, createdAt: date }] };
  const view = render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  const bubble = view.container.querySelector('[data-message-id="failed-result"]')!;
  expect(bubble.textContent).toContain('工作阻塞');
  expect(bubble.textContent).not.toContain('审核／回应');
  expect(bubble.textContent?.split(reason)).toHaveLength(2);
  expect(within(bubble as HTMLElement).getByRole('status').textContent).toBe(reason);
});

it('opens members before execution settings and edits responsibilities in an app dialog with topology fencing', () => {
  state.snapshot = { ...base, conversation: { ...base.conversation, kind: 'group', topologyRevision: 7 } };
  render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '成员 2' }));
  expect(within(screen.getByRole('navigation', { name: '会话管理分区' })).getByRole('button', { name: '成员' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByRole('combobox', { name: '任务文件权限' })).toBeNull();
  expect(screen.queryByRole('textbox', { name: '研究员的角色' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '编辑职责' }));
  fireEvent.change(screen.getByRole('textbox', { name: '研究员的角色' }), { target: { value: '采集事实并提供可核验来源' } });
  fireEvent.click(screen.getByRole('button', { name: '保存职责' }));
  expect(state.command).toHaveBeenCalledWith(expect.objectContaining({ action: 'members', expectedTopologyRevision: 7, roles: { 'agent-a': '采集事实并提供可核验来源' } }));
  fireEvent.click(screen.getByRole('button', { name: '执行设置' }));
  expect(screen.getByRole('combobox', { name: '任务文件权限' })).toBeTruthy();
});


function inlineRetrySnapshot(status: 'failed' | 'interrupted' | 'cancelled' = 'failed'): CollaborationSnapshot {
  const date = '2026-10-03T00:00:00Z';
  const task: CollaborationSnapshot['tasks'][number] = { id: 'retry-task', rootTaskId: 'retry-task', originMessageId: 'origin', assigneeMemberId: 'agent-a', purpose: 'work', title: '润色正文', instructions: '润色后交给审核', expectedOutput: '', dependsOnTaskIds: [], contextRefs: [], resourceClaims: [], returnTo: { conversationId: 'conv-1', replyToMessageId: 'origin' }, timeoutSeconds: 7200, currentAttemptId: 'retry-attempt', kind: 'task', goalRevision: 1, createdAt: date, handoff: { kind: 'work', sourceTaskId: 'source', sourceAttemptId: 'source-attempt', artifactIds: [] } };
  const snapshot = roomSnapshot();
  return { ...snapshot, conversation: { ...snapshot.conversation, room: { ...snapshot.conversation.room!, state: 'blocked' } }, tasks: [task], attempts: [{ id: task.currentAttemptId, taskId: task.id, number: 1, status, startedAt: date, updatedAt: date, contextSequence: 1, output: '', resourceClaims: [], tools: [], checklist: [], error: { code: 'timeout', category: 'execution', message: '润色超时，初稿保留。', retryable: true, traceId: 'trace' } }], messages: [{ id: 'retry-result', conversationId: 'conv-1', senderMemberId: 'agent-a', recipientMemberIds: ['user-1'], mentions: [], kind: 'task_result', blocks: [{ type: 'text', text: '润色超时，初稿保留。' }], taskId: task.id, attemptId: task.currentAttemptId, expectsResponse: false, correlationId: 'goal', hopCount: 0, sequence: 1, createdAt: date }] };
}

it.each(['failed', 'interrupted', 'cancelled'] as const)('retries a %s task from its chat bubble without opening task details', async status => {
  state.snapshot = inlineRetrySnapshot(status);
  state.command.mockResolvedValue({ snapshot: state.snapshot });
  const view = render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  const bubble = view.container.querySelector('[data-message-id="retry-result"]')!;
  expect(bubble.querySelector('.collab-event__actions')).toBeTruthy();
  expect(bubble.querySelector('.collab-message__actions')).toBeNull();
  fireEvent.click(within(bubble as HTMLElement).getByRole('button', { name: '重试' }));
  await waitFor(() => expect(state.command).toHaveBeenCalledWith(expect.objectContaining({ action: 'retry', conversationId: 'conv-1', taskId: 'retry-task', clientRequestId: expect.any(String) })));
  expect(screen.queryByRole('complementary', { name: '执行详情' })).toBeNull();
  expect(state.command).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'start-workflow' }));
});

it('locks an inline retry immediately and keeps the request id for a transport retry', async () => {
  state.snapshot = inlineRetrySnapshot();
  let reject!: (error: Error) => void;
  state.command.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })).mockResolvedValue({ snapshot: state.snapshot });
  const view = render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  const bubble = view.container.querySelector('[data-message-id="retry-result"]')!;
  const controls = within(bubble as HTMLElement);
  fireEvent.click(controls.getByRole('button', { name: '重试' }));
  const busy = controls.getByRole('button', { name: '重试中…' }) as HTMLButtonElement;
  expect(busy.disabled).toBe(true);
  fireEvent.click(busy);
  expect(state.command).toHaveBeenCalledTimes(1);
  const id = state.command.mock.calls[0][0].clientRequestId;
  reject(new Error('RPC timeout'));
  await waitFor(() => expect((controls.getByRole('button', { name: '重试' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(controls.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(state.command).toHaveBeenCalledTimes(2));
  expect(state.command.mock.calls[1][0].clientRequestId).toBe(id);
});

it.each(['running', 'queued', 'waiting_input', 'stopping'] as const)('disables the old failed bubble while its new attempt is %s', status => {
  state.snapshot = inlineRetrySnapshot();
  state.snapshot.tasks[0] = { ...state.snapshot.tasks[0], currentAttemptId: 'retry-attempt-2' };
  state.snapshot.attempts.push({ ...state.snapshot.attempts[0], id: 'retry-attempt-2', number: 2, status, error: undefined });
  const view = render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  const bubble = view.container.querySelector('[data-message-id="retry-result"]')!;
  const retrying = within(bubble as HTMLElement).getByRole('button', { name: '重试中…' }) as HTMLButtonElement;
  expect(retrying.disabled).toBe(true);
  fireEvent.click(retrying);
  expect(state.command).not.toHaveBeenCalled();
});

it.each(['succeeded', 'failed'] as const)('does not offer a stale retry on an older failed message after the new attempt %s', status => {
  state.snapshot = inlineRetrySnapshot();
  state.snapshot.tasks[0] = { ...state.snapshot.tasks[0], currentAttemptId: 'retry-attempt-2' };
  state.snapshot.attempts.push({ ...state.snapshot.attempts[0], id: 'retry-attempt-2', number: 2, status });
  const view = render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  const bubble = view.container.querySelector('[data-message-id="retry-result"]')!;
  expect(within(bubble as HTMLElement).queryByRole('button', { name: /^重试/ })).toBeNull();
});

it.each(['non-retryable', 'inactive-member', 'replaced-task', 'old-goal', 'completed-room'] as const)('does not enable inline retry for %s', guard => {
  state.snapshot = inlineRetrySnapshot();
  if (guard === 'non-retryable') state.snapshot.attempts[0].error!.retryable = false;
  if (guard === 'inactive-member') state.snapshot.members = state.snapshot.members.map(member => member.id === 'agent-a' ? { ...member, active: false } : member);
  if (guard === 'replaced-task') state.snapshot.tasks[0].replacedByTaskId = 'replacement';
  if (guard === 'old-goal') state.snapshot.conversation.room!.goalRevision = 2;
  if (guard === 'completed-room') state.snapshot.conversation.room!.state = 'completed';
  const view = render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  const bubble = view.container.querySelector('[data-message-id="retry-result"]')!;
  expect(within(bubble as HTMLElement).queryByRole('button', { name: '重试' })).toBeNull();
});

it.each(['paused', 'pausing'] as const)('preserves the %s room gate on inline retry', stateValue => {
  state.snapshot = inlineRetrySnapshot(); state.snapshot.conversation.room!.state = stateValue;
  render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  const retry = screen.getByRole('button', { name: '重试' }) as HTMLButtonElement;
  expect(retry.disabled).toBe(true);
  expect(retry.title).toContain('先继续本群工作');
  fireEvent.click(retry);
  expect(state.command).not.toHaveBeenCalled();
});


it('gives a later failed attempt a new receipt instead of reusing an ambiguous older retry', async () => {
  state.snapshot = inlineRetrySnapshot();
  state.command.mockRejectedValueOnce(new Error('RPC timeout')).mockResolvedValue({ snapshot: state.snapshot });
  const view = render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  fireEvent.click(within(view.container.querySelector('[data-message-id="retry-result"]')! as HTMLElement).getByRole('button', { name: '重试' }));
  await waitFor(() => expect((within(view.container.querySelector('[data-message-id="retry-result"]')! as HTMLElement).getByRole('button', { name: '重试' }) as HTMLButtonElement).disabled).toBe(false));
  const previousId = state.command.mock.calls[0][0].clientRequestId;
  const next = { ...state.snapshot.attempts[0], id: 'retry-attempt-2', number: 2 };
  state.snapshot = { ...state.snapshot, revision: 2, tasks: [{ ...state.snapshot.tasks[0], currentAttemptId: next.id }], attempts: [...state.snapshot.attempts, next], messages: [...state.snapshot.messages, { ...state.snapshot.messages[0], id: 'retry-result-2', attemptId: next.id, sequence: 2 }] };
  view.rerender(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  fireEvent.click(within(view.container.querySelector('[data-message-id="retry-result-2"]')! as HTMLElement).getByRole('button', { name: '重试' }));
  await waitFor(() => expect(state.command).toHaveBeenCalledTimes(2));
  expect(state.command.mock.calls[1][0].clientRequestId).not.toBe(previousId);
});


it('bounds long task descriptions while preserving expandable goal and acceptance text', () => {
  const instructions = '核对真实源码及来源，保留证据并输出可验收成果。'.repeat(60);
  const expectedOutput = '表格应包含来源、商品名、采集时间与去重说明。'.repeat(35);
  const task: CollaborationTask = { id: 'description-task', rootTaskId: 'description-task', originMessageId: 'assignment', assigneeMemberId: 'agent-a', title: '采集与证据验收', instructions, expectedOutput, dependsOnTaskIds: [], contextRefs: [], resourceClaims: [], returnTo: { conversationId: 'conv-1', replyToMessageId: 'assignment' }, timeoutSeconds: 7200, currentAttemptId: 'description-attempt', kind: 'task', createdAt: '2026-10-03' };
  state.snapshot = { ...base, tasks: [task], attempts: [{ id: task.currentAttemptId, taskId: task.id, number: 1, status: 'succeeded', output: '已交付', updatedAt: '2026-10-03', contextSequence: 1, resourceClaims: [], tools: [], checklist: [] }], messages: [{ id: 'assignment', conversationId: 'conv-1', senderMemberId: 'agent-a', recipientMemberIds: [], mentions: [], kind: 'task_assignment', taskId: task.id, blocks: [{ type: 'text', text: '任务已创建' }], expectsResponse: false, correlationId: '', hopCount: 0, sequence: 1, createdAt: '2026-10-03' }] };
  render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /研究员 采集与证据验收/ }));
  const goal = screen.getByRole('region', { name: '任务说明与交付要求' });
  expect(within(goal).getByText(instructions).getAttribute('data-collapsed')).toBe('true');
  expect(within(goal).getByText(expectedOutput).getAttribute('data-collapsed')).toBe('true');
  fireEvent.click(within(goal).getByRole('button', { name: '展开完整任务目标' }));
  expect(within(goal).getByText(instructions).getAttribute('data-collapsed')).toBe('false');
  expect(within(goal).getByRole('button', { name: '收起任务目标' }).getAttribute('aria-expanded')).toBe('true');
  expect(within(goal).getByText(expectedOutput).getAttribute('data-collapsed')).toBe('true');
  fireEvent.click(within(goal).getByRole('button', { name: '收起任务目标' }));
  expect(within(goal).getByText(instructions).getAttribute('data-collapsed')).toBe('true');
  expect(screen.getByRole('tab', { name: '成果' })).toBeTruthy();
  expect(state.snapshot.tasks[0].instructions).toBe(instructions);
});

it('keeps the trajectory open when selecting another execution node', async () => {
  const date = '2026-10-04T00:00:00Z';
  const first: CollaborationTask = { id: 'graph-first', rootTaskId: 'graph-root', originMessageId: 'request', assigneeMemberId: 'agent-a', title: '正文起草', instructions: '完成已确认的章节', expectedOutput: '完整正文', dependsOnTaskIds: [], contextRefs: [], resourceClaims: [], returnTo: { conversationId: 'conv-1', replyToMessageId: 'request' }, timeoutSeconds: 120, currentAttemptId: 'graph-a1', kind: 'task', createdAt: date };
  const second = { ...first, id: 'graph-second', title: '章节审校', currentAttemptId: 'graph-a2', dependsOnTaskIds: [first.id] };
  const running: CollaborationSnapshot['attempts'][number] = { id: first.currentAttemptId, taskId: first.id, number: 1, status: 'running', updatedAt: date, contextSequence: 0, output: '', resourceClaims: [], tools: [], checklist: [] };
  state.snapshot = { ...base, tasks: [first, second], attempts: [running, { ...running, id: second.currentAttemptId, taskId: second.id, status: 'queued' }] };
  render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /任务详情/ }));
  const panel = screen.getByRole('complementary', { name: '执行详情' });
  fireEvent.click(within(panel).getByRole('tab', { name: '执行轨迹' }));
  fireEvent.click(await within(panel).findByRole('button', { name: /2.*章节审校/ }));
  await waitFor(() => expect(within(panel).getByRole('tab', { name: '执行轨迹' }).getAttribute('aria-selected')).toBe('true'));
  expect(within(panel).getByLabelText('团队执行图')).toBeTruthy();
  expect(within(panel).getByRole('heading', { name: '章节审校' })).toBeTruthy();
});


it('opens the actual producer attempt from a version-bound handoff, not its later retry', async () => {
  const date = '2026-10-04T00:00:00Z';
  const producer: CollaborationTask = { id: 'version-source', rootTaskId: 'version-root', originMessageId: 'request', assigneeMemberId: 'agent-a', title: '正文起草', instructions: '起草正文', expectedOutput: '完整正文', dependsOnTaskIds: [], contextRefs: [], resourceClaims: [], returnTo: { conversationId: 'conv-1', replyToMessageId: 'request' }, timeoutSeconds: 120, currentAttemptId: 'source-new', kind: 'task', createdAt: date };
  const reviewer = { ...producer, id: 'version-review', title: '章节审校', currentAttemptId: 'review-now', parentTaskId: producer.id, handoff: { kind: 'review' as const, sourceTaskId: producer.id, sourceAttemptId: 'source-original', artifactIds: [] } };
  const running: CollaborationSnapshot['attempts'][number] = { id: reviewer.currentAttemptId, taskId: reviewer.id, number: 1, status: 'running', updatedAt: date, contextSequence: 0, output: '', resourceClaims: [], tools: [], checklist: [] };
  state.snapshot = { ...base, tasks: [producer, reviewer], attempts: [
    { ...running, id: 'source-original', taskId: producer.id, status: 'succeeded' },
    { ...running, id: 'source-new', taskId: producer.id, status: 'succeeded', number: 2 }, running,
  ] };
  render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /任务详情/ }));
  const panel = screen.getByRole('complementary', { name: '执行详情' });
  fireEvent.click(within(panel).getByRole('tab', { name: '执行轨迹' }));
  fireEvent.click(await within(panel).findByRole('button', { name: '正文起草 · 第 1 次' }));
  await waitFor(() => expect(within(panel).getByRole('combobox', { name: '执行记录' }).textContent).toContain('第 1 次'));
  expect(within(panel).getByRole('tab', { name: '执行轨迹' }).getAttribute('aria-selected')).toBe('true');
  expect(within(panel).getByRole('heading', { name: '正文起草' })).toBeTruthy();
});

it.each(['room_paused', 'member_removed', 'loop_limit'] as const)(
  'keeps blocked queued group work still and animates it again after resume (%s)', waitReason => {
    const task: CollaborationTask = { id: 'queued-work', rootTaskId: 'queued-work', originMessageId: 'human',
      assigneeMemberId: 'agent-a', title: '等待继续的任务', instructions: '', expectedOutput: '',
      dependsOnTaskIds: [], contextRefs: [], resourceClaims: [],
      returnTo: { conversationId: 'conv-1', replyToMessageId: 'human' }, timeoutSeconds: 60,
      currentAttemptId: 'queued-attempt', kind: 'task', purpose: 'work', createdAt: '' };
    state.snapshot = { ...roomSnapshot('paused'), tasks: [task], attempts: [{ id: 'queued-attempt',
      taskId: task.id, number: 1, status: 'queued', waitReason, updatedAt: '', contextSequence: 0,
      output: '', resourceClaims: [], tools: [], checklist: [] }] };
    const view = render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
    const motion = () => view.container.querySelector('.collab-chat__header .agent-workspace-avatar')?.getAttribute('data-motion');
    expect(motion()).toBe('still');
    expect(state.snapshot.tasks).toHaveLength(1);
    expect(state.snapshot.attempts[0].status).toBe('queued');
    state.snapshot = { ...state.snapshot, revision: 2, conversation: { ...state.snapshot.conversation,
      room: { ...state.snapshot.conversation.room!, state: 'running' } },
      attempts: [{ ...state.snapshot.attempts[0], waitReason: undefined }] };
    view.rerender(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
    expect(motion()).toBe('idle');
  });


describe('group collaboration visibility controls', () => {
  it('rejects an unaddressed private message rather than sending it to a default member', () => {
    state.snapshot = { ...base, conversation: { ...base.conversation, kind: 'group' } };
    render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox', { name: '消息可见范围' }), { target: { value: 'private' } });
    fireEvent.change(screen.getByRole('textbox', { name: '协作消息' }), { target: { value: 'private secret' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    expect(state.command).not.toHaveBeenCalled();
    expect(screen.getByText('私信请先 @ 指定接收成员。')).toBeTruthy();
  });
  it('keeps a reply to a private bubble in its private audience', async () => {
    state.snapshot = { ...base, conversation: { ...base.conversation, kind: 'group' }, messages: [{ id: 'private-message', conversationId: 'conv-1', senderMemberId: 'agent-a', recipientMemberIds: ['user-1'], visibility: 'private', mentions: [], kind: 'chat', blocks: [{ type: 'text', text: 'my card' }], expectsResponse: false, correlationId: 'private-round', hopCount: 0, sequence: 1, createdAt: '2026-01-01T00:00:00Z' }] };
    state.command.mockResolvedValue({ snapshot: state.snapshot });
    render(<CollaborationChatView conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '回复' }));
    expect(screen.getByRole('combobox', { name: '消息可见范围' })).toHaveProperty('value', 'private');
    fireEvent.change(screen.getByRole('textbox', { name: '协作消息' }), { target: { value: 'keep it private' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(state.command).toHaveBeenCalledWith(expect.objectContaining({ action: 'send', visibility: 'private', replyToMessageId: 'private-message' })));
  });
});
