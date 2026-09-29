/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CollaborationSnapshot, Conversation, GlobalAgent } from '@sync-think/shared';
import type { WorkspaceSummary } from '@sync-think/protocol';
const mock = vi.hoisted(() => ({ snapshot: undefined as CollaborationSnapshot | undefined, command: vi.fn(), request: vi.fn() }));
vi.mock('./use-collaboration-chat.js', () => ({ useCollaborationChat: () => ({ snapshot: mock.snapshot, error: '', command: mock.command }), collaborationRequest: mock.request }));
import AgentWorkspace, { AgentChatPicker, agentWorkspaceConversations, agentConversationName, agentContactConversations, type AgentWorkspaceProps } from './AgentWorkspace.js';
import { CollaborationChatView } from './CollaborationChatView.js';
import { AgentEditorPanel } from './collaboration-agent-editor.js';

const agents = ['设计师', '产品经理', '审查员'].map((name, i) => ({ id: `a${i}`, name, avatar: `bot:v1:star:cyan`, description: '', persona: '', defaultModelId: 'model', enabled: true, archived: false, availabilityScope: 'global' } as GlobalAgent));
const base: CollaborationSnapshot = { conversation: { id: 'c1', workspaceId: 'ws1', kind: 'group', title: '设计 + 产品', coordinatorMemberId: 'a0', policy: { allowPeerDirect: false, maxConcurrent: 3, maxMessageHops: 6, maxAutoMessages: 12, taskTimeoutSeconds: 7200, statusTimeoutSeconds: 120 }, createdAt: '2026-09-28T00:00:00Z' }, members: [{ id: 'u', name: '你', avatar: '', kind: 'user', role: '用户', active: true }, ...agents.map(a => ({ id: a.id, agentId: a.id, name: a.name, avatar: a.avatar, kind: 'agent' as const, role: '成员', active: true }))], tasks: [], attempts: [], deliveries: [], messages: [], revision: 1, receipts: {} };
function conversation(id: string, patch: Partial<Conversation> = {}): Conversation {
  return { id, workspaceId: 'ws1', title: id, track: 'agent', targetRef: 'a0', collaborationKind: 'group', executionMode: 'workspace', interactionMode: 'execute', createdAt: '2026-09-28T00:00:00Z', updatedAt: '2026-09-28T00:00:00Z', ...patch } as Conversation;
}
function props(): AgentWorkspaceProps {
  return { workspaceId: 'ws1', workspaces: [{ workspaceId: 'ws1', name: '项目一' }] as WorkspaceSummary[], conversations: [], agents, onExit: vi.fn(), onSelectWorkspace: vi.fn(), onRefresh: vi.fn(), onSettings: vi.fn(), onManageAgents: vi.fn(), onTogglePin: vi.fn(), onRename: vi.fn(), onArchive: vi.fn(), onUnarchive: vi.fn() };
}
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); mock.snapshot = base; mock.command.mockReset().mockResolvedValue({ snapshot: base }); mock.request.mockReset().mockResolvedValue({ snapshot: base, promotedConversation: conversation('c1', { collaborationKind: undefined }) });
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: { listGlobalAgentWorkspaceActivations: vi.fn().mockResolvedValue({ activations: [] }), updateGlobalAgent: vi.fn().mockResolvedValue({}) } } });
});
afterEach(cleanup);

describe('dedicated agent workspace', () => {
  it('unifies direct/group/legacy agent history without mixing scopes or regular model chats', () => {
    const all = [conversation('group'), conversation('direct', { collaborationKind: 'direct', pinnedAt: 'now' }), conversation('legacy', { collaborationKind: undefined }), conversation('model', { track: 'model', collaborationKind: undefined }), conversation('other-scope', { workspaceId: 'ws2' as Conversation['workspaceId'] })];
    expect(agentWorkspaceConversations(all, 'ws1').map(c => c.id)).toEqual(['direct', 'group', 'legacy']);
  });
  it('provides a single clean empty surface and a working exit', async () => {
    const p = props(); render(<AgentWorkspace {...p} />);
    expect(screen.getByRole('heading', { name: '几个头脑，一场对话' })).toBeTruthy();
    expect(screen.queryByText('当前无任务')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '返回工作台' })); expect(p.onExit).toHaveBeenCalledOnce();
    await waitFor(() => expect(window.syncThink!.runtime.listGlobalAgentWorkspaceActivations).toHaveBeenCalled());
  });
  it('creates a real two-agent group with the first selected member as coordinator', async () => {
    const created = vi.fn(); render(<AgentChatPicker open agents={agents} workspaceId="ws1" onClose={vi.fn()} onManage={vi.fn()} onCreated={created} />);
    expect((screen.getByRole('button', { name: '选择成员开始聊天' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /设计师/ })); fireEvent.click(screen.getByRole('button', { name: /产品经理/ }));
    fireEvent.change(screen.getByLabelText('群聊名称'), { target: { value: '新产品讨论' } });
    fireEvent.click(screen.getByRole('button', { name: '开始聊天 · 2 位智能体' }));
    await waitFor(() => expect(created).toHaveBeenCalled());
    expect(mock.request).toHaveBeenCalledWith(expect.objectContaining({ action: 'create', kind: 'group', title: '新产品讨论', workspaceId: 'ws1', agentIds: ['a0', 'a1'], coordinatorAgentId: 'a0' }));
  });
  it('keeps the create receipt after transport failure and omits the projectless layout id', async () => {
    mock.request.mockRejectedValueOnce(new Error('连接断开')).mockResolvedValueOnce({ snapshot: base });
    render(<AgentChatPicker open agents={agents} workspaceId="__projectless__" onClose={vi.fn()} onManage={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /设计师/ })); fireEvent.click(screen.getByRole('button', { name: '开始聊天 · 1 位智能体' }));
    await screen.findByRole('alert');
    const requestId = mock.request.mock.calls[0][0].clientRequestId;
    fireEvent.click(screen.getByRole('button', { name: '开始聊天 · 1 位智能体' }));
    await waitFor(() => expect(mock.request).toHaveBeenCalledTimes(3));
    expect(mock.request.mock.calls[1][0]).toMatchObject({ kind: 'direct', clientRequestId: requestId, workspaceId: undefined });
  });
  it('does not allow inactive workspace-scoped or archived agents into the picker', async () => {
    const p = props(); p.agents = [agents[0], { ...agents[1], availabilityScope: 'workspace' }, { ...agents[2], archived: true }];
    render(<AgentWorkspace {...p} />); fireEvent.click(screen.getByRole('button', { name: '新建智能体聊天' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /设计师/ })).toBeTruthy());
    expect(screen.queryByRole('button', { name: /产品经理/ })).toBeNull(); expect(screen.queryByRole('button', { name: /审查员/ })).toBeNull();
  });
  it('keeps editor and task summaries closed by default', () => {
    render(<CollaborationChatView workspace conversation={conversation('c1')} agents={agents} onOpenConversation={vi.fn()} />);
    expect(screen.getByTestId('collaboration-group-empty')).toBeTruthy();
    expect(screen.queryByRole('complementary')).toBeNull(); expect(screen.queryByText('当前无任务')).toBeNull();
  });
  it('retains actual dispatch semantics instead of broadcasting to every visible member', async () => {
    render(<CollaborationChatView workspace conversation={conversation('c1')} agents={agents} onOpenConversation={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('协作消息'), { target: { value: '请协调这个任务' } }); fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(mock.command).toHaveBeenCalled());
    expect(mock.command).toHaveBeenCalledWith(expect.objectContaining({ action: 'send', text: '请协调这个任务', recipientMemberIds: [] }));
    await waitFor(() => expect((screen.getByLabelText('协作消息') as HTMLTextAreaElement).value).toBe(''));
  });
  it('preserves the draft and reuses a request id after send failure', async () => {
    mock.command.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ snapshot: base });
    render(<CollaborationChatView workspace conversation={conversation('c1')} agents={agents} onOpenConversation={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('协作消息'), { target: { value: '保留这条草稿' } }); fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect((screen.getByRole('button', { name: '发送消息' }) as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByLabelText('协作消息') as HTMLTextAreaElement).value).toBe('保留这条草稿');
    const id = mock.command.mock.calls[0][0].clientRequestId;
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(mock.command).toHaveBeenCalledTimes(2)); expect(mock.command.mock.calls[1][0].clientRequestId).toBe(id);
  });
  it('restores per-conversation text drafts after switching away', () => {
    const view = render(<CollaborationChatView workspace conversation={conversation('c1')} agents={agents} onOpenConversation={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('协作消息'), { target: { value: '未发送的想法' } }); view.unmount();
    render(<CollaborationChatView workspace conversation={conversation('c1')} agents={agents} onOpenConversation={vi.fn()} />);
    expect((screen.getByLabelText('协作消息') as HTMLTextAreaElement).value).toBe('未发送的想法');
  });
  it('persists the edited avatar using the existing runtime update contract', async () => {
    render(<AgentEditorPanel workspace member={base.members[1]} agent={agents[0]} />);
    fireEvent.click(screen.getByRole('button', { name: '云朵' })); fireEvent.click(screen.getByRole('button', { name: '紫色' })); fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(window.syncThink!.runtime.updateGlobalAgent).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'a0', avatar: 'aw:v1:cloud:#9a76e8:idle' })));
  });
  it('does not discard an unsaved edit on a new collaboration snapshot object', () => {
    const { rerender } = render(<AgentEditorPanel workspace member={base.members[1]} agent={agents[0]} />);
    fireEvent.change(screen.getByLabelText('名字'), { target: { value: '暂未保存的新名字' } });
    rerender(<AgentEditorPanel workspace member={{ ...base.members[1] }} agent={{ ...agents[0] }} />);
    expect((screen.getByLabelText('名字') as HTMLInputElement).value).toBe('暂未保存的新名字');
  });
});
it('selects a mention with the keyboard and preserves its target across a remount', async () => {
  const mount = () => <CollaborationChatView workspace conversation={conversation('c1')} agents={agents} onOpenConversation={vi.fn()} />;
  const view = render(mount());
  fireEvent.change(screen.getByLabelText('协作消息'), { target: { value: '@', selectionStart: 1 } });
  fireEvent.keyDown(screen.getByLabelText('协作消息'), { key: 'ArrowDown' });
  fireEvent.keyDown(screen.getByLabelText('协作消息'), { key: 'Enter' });
  expect(mock.command).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('协作消息'), { target: { value: '请产品经理先看' } });
  view.unmount(); render(mount());
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
  await waitFor(() => expect(mock.command).toHaveBeenCalledWith(expect.objectContaining({ recipientMemberIds: ['a1'], text: '请产品经理先看' })));
});


describe('agent workspace identity and lifecycle regressions', () => {
  const models = [{ modelId: 'model', displayName: 'Model', providerName: 'Provider' }, { modelId: 'second-model', displayName: 'Second', providerName: 'Provider' }];
  it('never uses the first user message as an agent name and retains distinct group titles', () => {
    const legacy = conversation('old', { collaborationKind: undefined, title: '你装了哪些技能' });
    expect(agentConversationName(legacy, agents)).toBe('设计师');
    expect(agentConversationName({ ...legacy, targetRef: 'missing' }, agents)).toBe('已移除的智能体');
    expect(agentConversationName(conversation('group', { title: '设计评审' }), agents)).toBe('设计评审');
  });
  it('groups old and new direct histories by their agent while retaining a selected older thread', () => {
    const old = conversation('old', { collaborationKind: undefined });
    const recent = conversation('recent', { collaborationKind: 'direct' });
    const group = conversation('group');
    expect(agentContactConversations([recent, group, old]).map(c => c.id)).toEqual(['recent', 'group']);
    expect(agentContactConversations([recent, group, old], 'old').map(c => c.id)).toEqual(['old', 'group']);
  });
  it('shows real agent names, animates visible contacts, and opens the existing legacy history', async () => {
    const p = props(); p.conversations = [conversation('old', { collaborationKind: undefined, title: '你装了哪些技能' })];
    p.renderLegacyConversation = vi.fn(() => <p>真实旧会话</p>);
    const view = render(<AgentWorkspace {...p} />);
    await screen.findByText('真实旧会话');
    const names = [...view.container.querySelectorAll('.aw-conversation__title')].map(e => e.textContent);
    expect(names).toContain('设计师'); expect(names).not.toContain('你装了哪些技能');
    expect(view.container.querySelector('.aw-conversation__avatar canvas')?.getAttribute('data-motion')).toBe('idle');
    expect(p.renderLegacyConversation).toHaveBeenCalledWith(expect.objectContaining({ id: 'old' }), expect.any(Function), expect.any(Array));
    expect(screen.queryByText('历史会话')).toBeNull();
  });
  it('creates an agent through the real API and immediately exposes it without needing a conversation', async () => {
    const p = props(); p.models = models;
    const created = { ...agents[0], id: 'new-agent', name: '新伙伴', avatar: 'aw:v1:cloud:#9a76e8:idle', updatedAt: '2026-09-28T13:00:00Z' } as GlobalAgent;
    const create = vi.fn().mockResolvedValue({ agent: created }); Object.assign(window.syncThink!.runtime, { createGlobalAgent: create });
    const view = render(<AgentWorkspace {...p} />);
    fireEvent.click(screen.getByRole('button', { name: '创建智能体' }));
    const panel = within(screen.getByRole('complementary', { name: '创建智能体' }));
    fireEvent.change(panel.getByLabelText('名字'), { target: { value: '新伙伴' } });
    fireEvent.change(panel.getByLabelText('人设'), { target: { value: '先解释，再行动。' } });
    fireEvent.click(panel.getByRole('button', { name: '云朵' })); fireEvent.click(panel.getByRole('button', { name: '紫色' }));
    fireEvent.click(panel.getByRole('button', { name: '创建智能体' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: '新伙伴', avatar: 'aw:v1:cloud:#9a76e8:idle', defaultModelId: 'model', persona: '先解释，再行动。', availabilityScope: 'global' })));
    await waitFor(() => expect([...view.container.querySelectorAll('.aw-conversation__title')].map(e => e.textContent)).toContain('新伙伴'));
    expect(mock.request).not.toHaveBeenCalled();
  });
  it('edits an agent with no chat and immediately updates the roster without dropping execution bindings', async () => {
    const p = props(); p.models = models;
    p.agents = [{ ...agents[0], defaultKernelId: 'external-kernel', skillIds: ['skill'], mcpServerIds: ['mcp'], fallbackModelIds: ['fallback'] as GlobalAgent['fallbackModelIds'] }];
    const update = vi.mocked(window.syncThink!.runtime.updateGlobalAgent);
    update.mockImplementation(async payload => ({ agent: { ...p.agents[0], ...payload, name: payload.name!, updatedAt: '2026-09-28T14:00:00Z' } as GlobalAgent }));
    const view = render(<AgentWorkspace {...p} />);
    fireEvent.click(await screen.findByRole('button', { name: '编辑设计师' }));
    fireEvent.change(screen.getByLabelText('名字'), { target: { value: '小美' } });
    fireEvent.change(screen.getByLabelText('默认模型'), { target: { value: 'second-model' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.objectContaining({ name: '小美', defaultModelId: 'second-model', defaultKernelId: 'external-kernel', skillIds: ['skill'], mcpServerIds: ['mcp'], fallbackModelIds: ['fallback'] })));
    await waitFor(() => expect(view.container.querySelector('.aw-conversation__title')?.textContent).toBe('小美'));
  });
  it('keeps the draft and reports creation errors instead of adding a fake agent', async () => {
    const create = vi.fn().mockRejectedValue(new Error('模型未连接')); Object.assign(window.syncThink!.runtime, { createGlobalAgent: create });
    render(<AgentEditorPanel workspace creating models={models} member={{ id: 'new', name: '新智能体', avatar: '', kind: 'agent', role: '成员', active: true }} />);
    fireEvent.change(screen.getByLabelText('名字'), { target: { value: '保留名字' } });
    fireEvent.click(screen.getByRole('button', { name: '创建智能体' }));
    await screen.findByText('模型未连接'); expect((screen.getByLabelText('名字') as HTMLInputElement).value).toBe('保留名字');
  });
  it('requires a model before persisting a new agent', async () => {
    const create = vi.fn(); Object.assign(window.syncThink!.runtime, { createGlobalAgent: create });
    render(<AgentEditorPanel workspace creating member={{ id: 'new', name: '新智能体', avatar: '', kind: 'agent', role: '成员', active: true }} />);
    fireEvent.change(screen.getByLabelText('名字'), { target: { value: '小美' } }); fireEvent.click(screen.getByRole('button', { name: '创建智能体' }));
    await screen.findByText('请选择默认模型后再保存。'); expect(create).not.toHaveBeenCalled();
  });
});


describe('teams as agent groups', () => {
  const team = { id: 'team-a', name: '创作小队', mission: '完成作品', strategy: 'serial', coordinatorAgentId: 'a0', avatar: '', createdAt: '', updatedAt: '', members: [{ agentId: 'a0', memberOrder: 0, role: 'writer', title: '主笔', dependsOn: [] }, { agentId: 'a1', memberOrder: 1, role: 'reviewer', title: '审稿', dependsOn: [] }] } as unknown as import('@sync-think/shared').Team;
  it('renders teams as chat cards rather than expandable execution folders', async () => {
    const p = props(); p.teams = [team];
    const view = render(<AgentWorkspace {...p} />);
    const card = await screen.findByTestId('team-chat-contact');
    expect(within(card).getByRole('button', { name: '与创作小队聊天' })).toBeTruthy();
    expect(within(card).getByText('2 位成员')).toBeTruthy();
    expect(view.container.querySelector('.aw-team-group__toggle')).toBeNull();
    expect([...view.container.querySelectorAll('.aw-conversation__title')].map(e => e.textContent)).toEqual(['创作小队', '审查员']);
  });
  it('separates teams, standalone agents, and mixed group chats into distinct sections', async () => {
    const p = props(); p.teams = [team]; p.conversations = [conversation('mixed', { title: '创作小队 + 审查员', targetRef: 'a2', collaborationKind: 'group' })];
    render(<AgentWorkspace {...p} />);
    expect(screen.getByText('我的团队')).toBeTruthy();
    expect(screen.getByText('单个智能体')).toBeTruthy();
    expect(screen.getByText('群聊')).toBeTruthy();
    expect(screen.getByText('创作小队 + 审查员')).toBeTruthy();
    expect(screen.getByText('审查员')).toBeTruthy();
  });
  it('opens a real group using team membership and coordinator from the backend', async () => {
    const p = props(); p.teams = [team];
    const create = vi.fn(); Object.assign(window.syncThink!.runtime, { createConversation: create });
    render(<AgentWorkspace {...p} />);
    fireEvent.click(screen.getByRole('button', { name: '与创作小队聊天' }));
    await waitFor(() => expect(mock.request).toHaveBeenCalledWith(expect.objectContaining({ action: 'create', kind: 'group', teamId: 'team-a', agentIds: [], workspaceId: 'ws1' })));
    expect(await screen.findByLabelText('协作消息')).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
  });
  it('reuses a team group and retains legacy history without duplicating the card', async () => {
    const p = props(); p.teams = [team]; p.conversations = [conversation('old-team', { track: 'team', targetRef: 'team-a', collaborationKind: undefined }), conversation('c1', { track: 'team', targetRef: 'team-a', collaborationKind: 'group' })];
    render(<AgentWorkspace {...p} />);
    fireEvent.click(screen.getByRole('button', { name: '与创作小队聊天' }));
    expect(await screen.findByLabelText('协作消息')).toBeTruthy(); expect(mock.request).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('team-chat-contact')).toHaveLength(1);
  });
  it('reuses the create receipt after a transport failure', async () => {
    mock.request.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ snapshot: base });
    const p = props(); p.teams = [team]; render(<AgentWorkspace {...p} />);
    fireEvent.click(screen.getByRole('button', { name: '与创作小队聊天' })); await screen.findByText('offline');
    const request = mock.request.mock.calls[0][0];
    fireEvent.click(screen.getByRole('button', { name: '与创作小队聊天' }));
    await waitFor(() => expect(mock.request).toHaveBeenCalledTimes(2));
    expect(mock.request.mock.calls[1][0].clientRequestId).toBe(request.clientRequestId);
  });
});

it('opens an existing direct agent chat through the same full-chat renderer after preserving history', async () => {
  const direct = conversation('c1', { collaborationKind: 'direct' });
  const p = props(); p.conversations = [direct];
  p.renderLegacyConversation = vi.fn(() => <div data-testid="unified-full-chat">完整聊天输入框</div>);
  render(<AgentWorkspace {...p} />);
  expect(await screen.findByTestId('unified-full-chat')).toBeTruthy();
  expect(mock.request).toHaveBeenCalledWith({ action: 'promote-direct', conversationId: 'c1' });
  expect(screen.queryByLabelText('协作消息')).toBeNull();
  expect(p.renderLegacyConversation).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1', collaborationKind: undefined }), expect.any(Function), expect.any(Array));
});
it('new single-agent chats return a standard conversation, not the group composer', async () => {
  const created = vi.fn();
  render(<AgentChatPicker open agents={agents} workspaceId="ws1" onClose={vi.fn()} onManage={vi.fn()} onCreated={created} />);
  fireEvent.click(screen.getByRole('button', { name: /设计师/ }));
  fireEvent.click(screen.getByRole('button', { name: '开始聊天 · 1 位智能体' }));
  await waitFor(() => expect(created).toHaveBeenCalled());
  expect(mock.request.mock.calls.map(call => call[0].action)).toEqual(['create', 'promote-direct']);
  expect(created.mock.calls[0][2]).toMatchObject({ id: 'c1', collaborationKind: undefined });
});

it('routes an existing legacy team conversation into the collaboration composer', async () => {
  const p = props(); p.teams = [{ id: 'team-a', name: '创作小队', mission: '完成作品', strategy: 'serial', coordinatorAgentId: 'a0', avatar: '', createdAt: '', updatedAt: '', members: [{ agentId: 'a0', memberOrder: 0, role: 'writer', title: '主笔', dependsOn: [] }, { agentId: 'a1', memberOrder: 1, role: 'reviewer', title: '审稿', dependsOn: [] }] } as unknown as import('@sync-think/shared').Team];
  p.conversations = [conversation('legacy-team', { track: 'team', targetRef: 'team-a', collaborationKind: undefined })];
  render(<AgentWorkspace {...p} />);
  expect(await screen.findByLabelText('协作消息')).toBeTruthy();
});



describe('agent workspace navigation requests', () => {
  it('selects the exact linked history and handles a new request after internal navigation', async () => {
    const p = props();
    const handled = vi.fn();
    const history = [conversation('first'), conversation('second')];
    const view = render(<AgentWorkspace {...p} conversations={history} onNavigationHandled={handled} navigation={{ workspaceId: 'ws1', conversationId: 'second', nonce: 1 }} />);
    await waitFor(() => expect(localStorage.getItem('sync-think.agent-workspace.selection.v1:ws1')).toBe('second'));
    expect(handled).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: /second 一起开始/ }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: /first 一起开始/ }));
    expect(localStorage.getItem('sync-think.agent-workspace.selection.v1:ws1')).toBe('first');
    view.rerender(<AgentWorkspace {...p} conversations={history} onNavigationHandled={handled} navigation={{ workspaceId: 'ws1', conversationId: 'second', nonce: 2 }} />);
    await waitFor(() => expect(localStorage.getItem('sync-think.agent-workspace.selection.v1:ws1')).toBe('second'));
    expect(handled).toHaveBeenCalledTimes(2);
  });
  it('shows archived history when linked without unarchiving or recreating it', async () => {
    const p = props();
    render(<AgentWorkspace {...p} conversations={[conversation('archived', { archivedAt: '2026-09-29' })]} navigation={{ workspaceId: 'ws1', conversationId: 'archived', nonce: 1 }} />);
    await screen.findByText('已归档');
    expect(p.onUnarchive).not.toHaveBeenCalled();
    expect(mock.request).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'create' }));
  });
  it('does not consume a navigation request for a different workspace', () => {
    const handled = vi.fn();
    render(<AgentWorkspace {...props()} onNavigationHandled={handled} navigation={{ workspaceId: 'ws2', conversationId: 'elsewhere', nonce: 1 }} />);
    expect(handled).not.toHaveBeenCalled();
    expect(mock.request).not.toHaveBeenCalled();
  });
});
