/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CollaborationSnapshot, Conversation, GlobalAgent, Team } from '@sync-think/shared';
import type { WorkspaceSummary } from '@sync-think/protocol';
const mock = vi.hoisted(() => ({ snapshot: undefined as CollaborationSnapshot | undefined, command: vi.fn(), request: vi.fn() }));
vi.mock('./use-collaboration-chat.js', () => ({ useCollaborationChat: () => ({ snapshot: mock.snapshot, error: '', command: mock.command }), collaborationRequest: mock.request }));
import AgentWorkspace, { AgentChatPicker, agentWorkspaceConversations, agentConversationName, agentContactConversations, type AgentWorkspaceProps } from './AgentWorkspace.js';
import { agentContactId, pinnedAgentsKey, writeContactOrder } from './agent-workspace-contacts.js';
import { CollaborationChatView } from './CollaborationChatView.js';
import { AgentEditorPanel } from './collaboration-agent-editor.js';
import { setCollaborationRostersForTest } from './collaboration-roster-store.js';
import { KeepAliveLayer } from './KeepAliveLayer.js';

const agents = ['设计师', '产品经理', '审查员'].map((name, i) => ({ id: `a${i}`, name, avatar: `bot:v1:star:cyan`, description: '', persona: '', defaultModelId: 'model', enabled: true, archived: false, availabilityScope: 'global' } as GlobalAgent));
const base: CollaborationSnapshot = { conversation: { id: 'c1', workspaceId: 'ws1', kind: 'group', title: '设计 + 产品', coordinatorMemberId: 'a0', policy: { allowPeerDirect: false, maxConcurrent: 3, maxMessageHops: 6, maxAutoMessages: 12, taskTimeoutSeconds: 7200, statusTimeoutSeconds: 120 }, createdAt: '2026-09-28T00:00:00Z' }, members: [{ id: 'u', name: '你', avatar: '', kind: 'user', role: '用户', active: true }, ...agents.map(a => ({ id: a.id, agentId: a.id, name: a.name, avatar: a.avatar, kind: 'agent' as const, role: '成员', active: true }))], tasks: [], attempts: [], deliveries: [], messages: [], revision: 1, receipts: {} };
function conversation(id: string, patch: Partial<Conversation> = {}): Conversation {
  return { id, workspaceId: 'ws1', title: id, track: 'agent', targetRef: 'a0', collaborationKind: 'group', executionMode: 'workspace', interactionMode: 'execute', createdAt: '2026-09-28T00:00:00Z', updatedAt: '2026-09-28T00:00:00Z', lastMessageAt: '2026-09-28T00:00:00Z', ...patch } as Conversation;
}
function props(): AgentWorkspaceProps {
  return { workspaceId: 'ws1', workspaces: [{ workspaceId: 'ws1', name: '项目一' }] as WorkspaceSummary[], conversations: [], agents, onExit: vi.fn(), onSelectWorkspace: vi.fn(), onRefresh: vi.fn(), onSettings: vi.fn(), onManageAgents: vi.fn(), onTogglePin: vi.fn(), onRename: vi.fn(), onArchive: vi.fn(), onUnarchive: vi.fn() };
}
beforeEach(() => {
  setCollaborationRostersForTest([]);
  localStorage.clear(); sessionStorage.clear(); mock.snapshot = base; mock.command.mockReset().mockResolvedValue({ snapshot: base }); mock.request.mockReset().mockResolvedValue({ snapshot: base, promotedConversation: conversation('c1', { collaborationKind: undefined }) });
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: { listGlobalAgentWorkspaceActivations: vi.fn().mockResolvedValue({ activations: [] }), updateGlobalAgent: vi.fn().mockResolvedValue({}), detectKernels: vi.fn().mockResolvedValue({ kernels: [{ kernelId: 'native', name: 'Sync-Think', icon: 'native', installed: true, capabilities: {}, version: '1.0', executablePath: '/bin/native', knownGood: true }] }) } } });
});
afterEach(cleanup);

describe('dedicated agent workspace', () => {
  it('unifies direct/group/legacy agent history without mixing scopes or regular model chats', () => {
    const all = [conversation('group'), conversation('direct', { collaborationKind: 'direct', pinnedAt: 'now' }), conversation('legacy', { collaborationKind: undefined }), conversation('model', { track: 'model', collaborationKind: undefined }), conversation('other-scope', { workspaceId: 'ws2' as Conversation['workspaceId'] })];
    expect(agentWorkspaceConversations(all, 'ws1').map(c => c.id)).toEqual(['direct', 'group', 'legacy']);
  });
  it('provides a single clean empty surface and a working exit', async () => {
    const p = props(); render(<AgentWorkspace {...p} />);
    const welcome = screen.getByRole('main', { name: '智能体聊天' });
    expect(screen.getByRole('heading', { name: '几个头脑，一场对话' })).toBeTruthy();
    expect(welcome.className.split(/\s+/)).toContain('aw-welcome');
    expect(welcome.querySelector('.aw-welcome__body')).toBeTruthy();
    expect(welcome.querySelector('.aw-welcome__hint')?.textContent).toContain('单聊、群聊与协作任务');
    expect(screen.queryByText('当前无任务')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '返回工作台' })); expect(p.onExit).toHaveBeenCalledOnce();
    await waitFor(() => expect(window.syncThink!.runtime.listGlobalAgentWorkspaceActivations).toHaveBeenCalled());
  });
  it('creates a real two-agent group with the first selected member as coordinator', async () => {
    const created = vi.fn(); render(<AgentChatPicker open agents={agents} workspaceId="ws1" onClose={vi.fn()} onManage={vi.fn()} onCreated={created} />);
    expect((screen.getByRole('button', { name: '选择小队或成员开始聊天' }) as HTMLButtonElement).disabled).toBe(true);
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
    fireEvent.change(screen.getByTestId('collaboration-draft'), { target: { value: '请协调这个任务' } }); fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(mock.command).toHaveBeenCalled());
    expect(mock.command).toHaveBeenCalledWith(expect.objectContaining({ action: 'send', text: '请协调这个任务', recipientMemberIds: [] }));
    await waitFor(() => expect((screen.getByTestId('collaboration-draft') as HTMLTextAreaElement).value).toBe(''));
  });
  it('preserves the draft and reuses a request id after send failure', async () => {
    mock.command.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ snapshot: base });
    render(<CollaborationChatView workspace conversation={conversation('c1')} agents={agents} onOpenConversation={vi.fn()} />);
    fireEvent.change(screen.getByTestId('collaboration-draft'), { target: { value: '保留这条草稿' } }); fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect((screen.getByRole('button', { name: '发送消息' }) as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByTestId('collaboration-draft') as HTMLTextAreaElement).value).toBe('保留这条草稿');
    const id = mock.command.mock.calls[0][0].clientRequestId;
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(mock.command).toHaveBeenCalledTimes(2)); expect(mock.command.mock.calls[1][0].clientRequestId).toBe(id);
  });
  it('restores per-conversation text drafts after switching away', () => {
    const view = render(<CollaborationChatView workspace conversation={conversation('c1')} agents={agents} onOpenConversation={vi.fn()} />);
    fireEvent.change(screen.getByTestId('collaboration-draft'), { target: { value: '未发送的想法' } }); view.unmount();
    render(<CollaborationChatView workspace conversation={conversation('c1')} agents={agents} onOpenConversation={vi.fn()} />);
    expect((screen.getByTestId('collaboration-draft') as HTMLTextAreaElement).value).toBe('未发送的想法');
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
  fireEvent.change(screen.getByTestId('collaboration-draft'), { target: { value: '@', selectionStart: 1 } });
  fireEvent.keyDown(screen.getByTestId('collaboration-draft'), { key: 'ArrowDown' });
  fireEvent.keyDown(screen.getByTestId('collaboration-draft'), { key: 'Enter' });
  expect(mock.command).not.toHaveBeenCalled();
  const mentionDraft = (screen.getByTestId('collaboration-draft') as HTMLTextAreaElement).value;
  fireEvent.change(screen.getByTestId('collaboration-draft'), { target: { value: `请${mentionDraft}先看` } });
  view.unmount(); render(mount());
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
  await waitFor(() => expect(mock.command).toHaveBeenCalledWith(expect.objectContaining({ recipientMemberIds: ['a1'], text: '请产品经理 先看' })));
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
    expect(p.renderLegacyConversation).toHaveBeenCalledWith(expect.objectContaining({ id: 'old' }), expect.any(Function), expect.any(Array), expect.any(Function));
    expect(screen.queryByText('历史会话')).toBeNull();
  });
  it('creates an agent through the real API but only exposes it in the picker until a message is sent', async () => {
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
    await screen.findByRole('complementary', { name: '智能体设置' });
    expect([...view.container.querySelectorAll('.aw-conversation__title')].map(e => e.textContent)).not.toContain('新伙伴');
    fireEvent.click(screen.getByRole('button', { name: '新建智能体聊天' }));
    expect(await screen.findByRole('button', { name: /新伙伴/ })).toBeTruthy();
    expect(mock.request).not.toHaveBeenCalled();
  });
  it('edits a chatted agent and immediately updates the roster without dropping execution bindings', async () => {
    const p = props(); p.models = models; p.conversations = [conversation('old', { collaborationKind: 'direct' })];
    p.agents = [{ ...agents[0], defaultKernelId: 'external-kernel', skillIds: ['skill'], mcpServerIds: ['mcp'], fallbackModelIds: ['fallback'] as GlobalAgent['fallbackModelIds'] }];
    const update = vi.mocked(window.syncThink!.runtime.updateGlobalAgent);
    update.mockImplementation(async payload => ({ agent: { ...p.agents[0], ...payload, name: payload.name!, updatedAt: '2026-09-28T14:00:00Z' } as GlobalAgent }));
    const view = render(<AgentWorkspace {...p} />);
    fireEvent.click(await screen.findByRole('button', { name: '设计师的选项' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '编辑智能体' }));
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
  it('shows only real chats in the sidebar and selects teams in the new-chat picker', async () => {
    const p = props(); p.teams = [team];
    const view = render(<AgentWorkspace {...p} />);
    expect(screen.queryByTestId('team-invitation')).toBeNull();
    expect(screen.queryByLabelText('邀请小队')).toBeNull();
    expect(view.container.querySelectorAll('.aw-conversation__title')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '新建群聊' }));
    expect(await screen.findByRole('button', { name: '选择小队：创作小队' })).toBeTruthy();
  });
  it('keeps teams separate while merging standalone agents and mixed group chats', async () => {
    const p = props(); p.teams = [team]; p.conversations = [conversation('mixed', { title: '创作小队 + 审查员', targetRef: 'a2', collaborationKind: 'group' })];
    render(<AgentWorkspace {...p} />);
    expect([...document.querySelectorAll('.aw-section-heading span')].map(el => el.textContent)).toEqual(['群聊']);
    expect(screen.getAllByText('创作小队 + 审查员').length).toBeGreaterThan(0);
    expect(document.querySelector('[data-contact-id="agent:a2"]')).toBeNull();
  });
  it('does not resurrect unchatted agents from persisted pins or drag order', async () => {
    writeContactOrder('ws1', [agentContactId('a2'), agentContactId('a0'), agentContactId('a1')]);
    localStorage.setItem(pinnedAgentsKey('ws1'), JSON.stringify(['a1']));
    render(<AgentWorkspace {...props()} />);
    expect(document.querySelectorAll('[data-testid="workspace-contact"]')).toHaveLength(0);
  });
  it('pins an existing conversation through the merged contact menu', async () => {
    const p = props();
    p.conversations = [conversation('direct', { collaborationKind: 'direct', targetRef: 'a2' })];
    render(<AgentWorkspace {...p} />);
    fireEvent.click(await screen.findByRole('button', { name: '审查员的选项' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '置顶' }));
    expect(p.onTogglePin).toHaveBeenCalledWith('direct', true);
  });
  it('opens a real group using team membership and coordinator from the backend', async () => {
    const p = props(); p.teams = [team];
    const create = vi.fn(); Object.assign(window.syncThink!.runtime, { createConversation: create });
    render(<AgentWorkspace {...p} />);
    fireEvent.click(screen.getByRole('button', { name: '新建群聊' }));
    fireEvent.click(await screen.findByRole('button', { name: '选择小队：创作小队' }));
    fireEvent.click(screen.getByRole('button', { name: '创建群聊 · 2 位智能体' }));
    await waitFor(() => expect(mock.request).toHaveBeenCalledWith(expect.objectContaining({ action: 'create', kind: 'group', teamId: 'team-a', agentIds: ['a0', 'a1'], workspaceId: 'ws1' })));
    expect(await screen.findByLabelText('协作消息')).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
  });
  it('always creates a new room on invitation and retains each previous room and legacy history', async () => {
    const p = props(); p.teams = [team]; p.conversations = [conversation('old-team', { track: 'team', targetRef: 'team-a', collaborationKind: undefined }), conversation('c1', { track: 'team', targetRef: 'team-a', collaborationKind: 'group' })];
    render(<AgentWorkspace {...p} />);
    fireEvent.click(screen.getByRole('button', { name: '新建群聊' }));
    fireEvent.click(await screen.findByRole('button', { name: '选择小队：创作小队' }));
    fireEvent.click(screen.getByRole('button', { name: '创建群聊 · 2 位智能体' }));
    expect(await screen.findByLabelText('协作消息')).toBeTruthy();
    await waitFor(() => expect(mock.request).toHaveBeenCalledWith(expect.objectContaining({ action: 'create', teamId: 'team-a' })));
    expect(document.querySelector('[data-contact-id="group:old-team"]')).toBeTruthy();
    expect(document.querySelector('[data-contact-id="group:c1"]')).toBeTruthy();
    expect(screen.queryByTestId('team-invitation')).toBeNull();
  });
  it('reuses the create receipt after a transport failure', async () => {
    mock.request.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ snapshot: base });
    const p = props(); p.teams = [team]; render(<AgentWorkspace {...p} />);
    fireEvent.click(screen.getByRole('button', { name: '新建群聊' }));
    fireEvent.click(await screen.findByRole('button', { name: '选择小队：创作小队' }));
    fireEvent.click(screen.getByRole('button', { name: '创建群聊 · 2 位智能体' })); await screen.findByText('offline');
    const request = mock.request.mock.calls[0][0];
    fireEvent.click(screen.getByRole('button', { name: '创建群聊 · 2 位智能体' }));
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
  expect(p.renderLegacyConversation).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1', collaborationKind: undefined }), expect.any(Function), expect.any(Array), expect.any(Function));
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
    expect(screen.getByRole('button', { name: '打开群聊：second' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: '打开群聊：first' }));
    expect(localStorage.getItem('sync-think.agent-workspace.selection.v1:ws1')).toBe('first');
    view.rerender(<AgentWorkspace {...p} conversations={history} onNavigationHandled={handled} navigation={{ workspaceId: 'ws1', conversationId: 'second', nonce: 2 }} />);
    await waitFor(() => expect(localStorage.getItem('sync-think.agent-workspace.selection.v1:ws1')).toBe('second'));
    expect(handled).toHaveBeenCalledTimes(2);
  });
  it('shows archived history when linked without unarchiving or recreating it', async () => {
    const p = props();
    render(<AgentWorkspace {...p} conversations={[conversation('archived', { archivedAt: '2026-09-29' })]} navigation={{ workspaceId: 'ws1', conversationId: 'archived', nonce: 1 }} />);
    await waitFor(() => expect(screen.getByTestId('agent-archive-section-toggle').getAttribute('aria-expanded')).toBe('true'));
    expect(screen.getByRole('region', { name: '智能体归档列表' })).toBeTruthy();
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


it('opens existing workspace agents from the creation panel without populating recent chats', async () => {
  render(<AgentWorkspace {...props()} />);
  expect(document.querySelectorAll('[data-testid="workspace-contact"]')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '创建智能体' }));
  const panel = screen.getByRole('complementary', { name: '创建智能体' });
  fireEvent.click(within(panel).getByRole('button', { name: '与已有智能体聊天' }));
  const dialog = await screen.findByRole('dialog', { name: '和你的智能体聊聊' });
  fireEvent.click(within(dialog).getByRole('button', { name: /设计师/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: '开始聊天 · 1 位智能体' }));
  await waitFor(() => expect(mock.request).toHaveBeenCalledWith(expect.objectContaining({ action: 'create', agentIds: ['a0'], workspaceId: 'ws1' })));
});


it('keeps an explicitly created empty group visible before and after its first message', () => {
  const p = props(); p.conversations = [conversation('c1', { lastMessageAt: undefined, lastMessagePreview: undefined })];
  const view = render(<AgentWorkspace {...p} />);
  expect(document.querySelectorAll('[data-testid="workspace-contact"]')).toHaveLength(1);
  mock.snapshot = { ...base, revision: 2, messages: [{ id: 'first', conversationId: 'c1', senderMemberId: 'u', recipientMemberIds: [], mentions: [], kind: 'chat', blocks: [{ type: 'text', text: '开始讨论' }], expectsResponse: true, correlationId: 'first', hopCount: 0, sequence: 1, createdAt: '2026-09-29T12:00:00Z' }] };
  view.rerender(<AgentWorkspace {...p} />);
  expect(document.querySelectorAll('[data-testid="workspace-contact"]')).toHaveLength(1);
});

it('lets the user select a coordinator instead of depending on member selection order',async()=>{
 render(<AgentChatPicker open agents={agents} workspaceId="ws1" onClose={vi.fn()} onManage={vi.fn()} onCreated={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:/设计师/}));fireEvent.click(screen.getByRole('button',{name:/产品经理/}));
 fireEvent.change(screen.getByLabelText('群聊协调员'),{target:{value:'a1'}});
 fireEvent.click(screen.getByRole('button',{name:'开始聊天 · 2 位智能体'}));
 await waitFor(()=>expect(mock.request).toHaveBeenCalledWith(expect.objectContaining({coordinatorAgentId:'a1'})));
});


const pickerTeam: Team = {
  id: 'team-novel' as Team['id'], name: '小说小队', avatar: '👥', mission: '一起完成长篇小说', strategy: 'serial',
  coordinatorAgentId: agents[1].id, members: [
    { agentId: agents[1].id, memberOrder: 1, role: 'coordinator', title: '主策划', dependsOn: [] },
    { agentId: agents[0].id, memberOrder: 0, role: 'writer', title: '写手', dependsOn: [] },
  ], createdAt: '', updatedAt: '',
};
function pickerProps() {
  return { open: true, agents, teams: [pickerTeam], workspaceId: 'ws1', onClose: vi.fn(), onManage: vi.fn(), onCreated: vi.fn() };
}

describe('existing team selection in the chat picker', () => {
  it('renders squads as avatar chips with the same selectable styling as agents', () => {
    render(<AgentChatPicker {...pickerProps()} />);
    const teamChip = screen.getByRole('button', { name: '选择小队：小说小队' });
    expect(teamChip.classList.contains('aw-agent-chip')).toBe(true);
    expect(teamChip.classList.contains('aw-team-chip')).toBe(true);
    expect(teamChip.querySelectorAll('.collab-cluster__face')).toHaveLength(2);
    expect(teamChip.textContent).toContain('小说小队');
    expect(teamChip.textContent).toContain('2 位成员');
    expect(teamChip.textContent).not.toContain('协调员');
    expect(teamChip.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(teamChip);
    expect(teamChip.getAttribute('aria-pressed')).toBe('true');
    expect(teamChip.classList.contains('is-selected')).toBe(true);
    expect((screen.getByLabelText('群聊协调员') as HTMLSelectElement).value).toBe('a1');
    fireEvent.click(teamChip);
    expect(teamChip.getAttribute('aria-pressed')).toBe('false');
  });

  it('shows three faces and the full member count for a larger squad', () => {
    const roster = Array.from({ length: 5 }, (_, index) => ({ ...agents[index % agents.length], id: ('member-' + index) as GlobalAgent['id'] }));
    const team: Team = { ...pickerTeam, coordinatorAgentId: roster[0].id, members: roster.map((agent, memberOrder) => ({ agentId: agent.id, memberOrder, role: 'writer', title: '写作', dependsOn: [] })) };
    render(<AgentChatPicker {...pickerProps()} agents={roster} teams={[team]} />);
    const chip = screen.getByRole('button', { name: '选择小队：小说小队' });
    expect(chip.querySelectorAll('.collab-cluster__face')).toHaveLength(3);
    expect(chip.querySelector('.collab-cluster.is-triangle')).toBeTruthy();
    expect(chip.textContent).toContain('5 位成员');
    expect(chip.querySelector('.collab-cluster__more')).toBeNull();
    fireEvent.click(chip);
    expect(document.querySelectorAll('.aw-picker__cluster .collab-cluster__face')).toHaveLength(3);
  });

  it('exposes the real workspace teams in the new-chat entry', async () => {
    render(<AgentWorkspace {...props()} teams={[pickerTeam]} />);
    fireEvent.click(screen.getByRole('button', { name: '新建群聊' }));
    const picker = await screen.findByRole('dialog', { name: '和你的智能体聊聊' });
    await waitFor(() => expect((within(picker).getByRole('button', { name: '选择小队：小说小队' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(within(picker).getByRole('button', { name: '选择小队：小说小队' }));
    fireEvent.change(within(picker).getByLabelText('群聊名称'), { target: { value: '小说 A' } });
    fireEvent.click(within(picker).getByRole('button', { name: '创建群聊 · 2 位智能体' }));
    await waitFor(() => expect(mock.request).toHaveBeenCalledWith(expect.objectContaining({ action: 'create', kind: 'group', teamId: 'team-novel', title: '小说 A', agentIds: ['a0', 'a1'], coordinatorAgentId: 'a1' })));
  });

  it('brings in the full roster and configured coordinator without individually picking agents', async () => {
    const p = pickerProps(); render(<AgentChatPicker {...p} />);
    fireEvent.click(screen.getByRole('button', { name: '选择小队：小说小队' }));
    expect((screen.getByLabelText('群聊协调员') as HTMLSelectElement).value).toBe('a1');
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '创建群聊 · 2 位智能体' }));
    await waitFor(() => expect(p.onCreated).toHaveBeenCalledWith(base, [agents[0], agents[1]], undefined, pickerTeam.id));
    expect(mock.request).toHaveBeenCalledTimes(1);
    expect(mock.request).toHaveBeenCalledWith(expect.objectContaining({ title: '小说小队', teamId: 'team-novel', agentIds: ['a0', 'a1'] }));
  });

  it('deduplicates manually selected teammates and permits an additional agent and coordinator override', async () => {
    render(<AgentChatPicker {...pickerProps()} />);
    fireEvent.click(screen.getByRole('button', { name: '设计师' }));
    fireEvent.click(screen.getByRole('button', { name: '选择小队：小说小队' }));
    fireEvent.click(screen.getByRole('button', { name: '审查员' }));
    fireEvent.change(screen.getByLabelText('群聊协调员'), { target: { value: 'a2' } });
    fireEvent.click(screen.getByRole('button', { name: '创建群聊 · 3 位智能体' }));
    await waitFor(() => expect(mock.request).toHaveBeenCalledWith(expect.objectContaining({ teamId: 'team-novel', agentIds: ['a0', 'a1', 'a2'], coordinatorAgentId: 'a2' })));
    expect(pickerTeam.members).toHaveLength(2);
    expect(pickerTeam.coordinatorAgentId).toBe('a1');
  });

  it('replaces automatic team members when switching squads but retains explicitly chosen guests', async () => {
    const other = { ...pickerTeam, id: 'team-design', name: '设计小队', coordinatorAgentId: 'a0', members: [pickerTeam.members[1]] } as Team;
    render(<AgentChatPicker {...pickerProps()} teams={[pickerTeam, other]} />);
    fireEvent.click(screen.getByRole('button', { name: '选择小队：小说小队' }));
    fireEvent.click(screen.getByRole('button', { name: '审查员' }));
    fireEvent.click(screen.getByRole('button', { name: '选择小队：设计小队' }));
    expect(screen.getByRole('button', { name: '产品经理' }).getAttribute('aria-pressed')).toBe('false');
    expect((screen.getByLabelText('群聊协调员') as HTMLSelectElement).value).toBe('a0');
    fireEvent.click(screen.getByRole('button', { name: '创建群聊 · 2 位智能体' }));
    await waitFor(() => expect(mock.request).toHaveBeenCalledWith(expect.objectContaining({ teamId: 'team-design', agentIds: ['a0', 'a2'], coordinatorAgentId: 'a0' })));
  });

  it('searches team names and roster names without changing the selected roster', async () => {
    render(<AgentChatPicker {...pickerProps()} />);
    fireEvent.change(screen.getByRole('textbox', { name: '搜索小队或智能体' }), { target: { value: '小说' } });
    fireEvent.click(screen.getByRole('button', { name: '选择小队：小说小队' }));
    fireEvent.change(screen.getByRole('textbox', { name: '搜索小队或智能体' }), { target: { value: '产品经理' } });
    expect(screen.getByRole('button', { name: '选择小队：小说小队' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '创建群聊 · 2 位智能体' }));
    await waitFor(() => expect(mock.request).toHaveBeenCalledWith(expect.objectContaining({ agentIds: ['a0', 'a1'] })));
  });

  it('explains unavailable squads and stops creation if a selected member becomes unavailable', () => {
    const p = pickerProps(); const view = render(<AgentChatPicker {...p} />);
    fireEvent.click(screen.getByRole('button', { name: '选择小队：小说小队' }));
    view.rerender(<AgentChatPicker {...p} agents={agents.filter(agent => agent.id !== 'a0')} />);
    expect((screen.getByRole('button', { name: '选择小队：小说小队' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('部分成员未启用');
    expect((screen.getByRole('button', { name: '创建群聊 · 1 位智能体' }) as HTMLButtonElement).disabled).toBe(true);
    expect(mock.request).not.toHaveBeenCalled();
  });

  it('reuses a request receipt on retry and issues a fresh one for another room with the same squad', async () => {
    const p = pickerProps(); const view = render(<AgentChatPicker {...p} />);
    mock.request.mockRejectedValueOnce(new Error('connection lost'));
    fireEvent.click(screen.getByRole('button', { name: '选择小队：小说小队' }));
    fireEvent.click(screen.getByRole('button', { name: '创建群聊 · 2 位智能体' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: '创建群聊 · 2 位智能体' }));
    await waitFor(() => expect(p.onCreated).toHaveBeenCalledTimes(1));
    const firstId = mock.request.mock.calls[0][0].clientRequestId;
    expect(mock.request.mock.calls[1][0].clientRequestId).toBe(firstId);
    view.rerender(<AgentChatPicker {...p} open={false} />);
    view.rerender(<AgentChatPicker {...p} open />);
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '选择小队：小说小队' }));
    fireEvent.click(screen.getByRole('button', { name: '创建群聊 · 2 位智能体' }));
    await waitFor(() => expect(p.onCreated).toHaveBeenCalledTimes(2));
    expect(mock.request.mock.calls[2][0].clientRequestId).not.toBe(firstId);
  });

  it('can deselect a squad and return to a regular single-agent chat', async () => {
    render(<AgentChatPicker {...pickerProps()} />);
    fireEvent.click(screen.getByRole('button', { name: '选择小队：小说小队' }));
    fireEvent.click(screen.getByRole('button', { name: '选择小队：小说小队' }));
    fireEvent.click(screen.getByRole('button', { name: '审查员' }));
    fireEvent.click(screen.getByRole('button', { name: '开始聊天 · 1 位智能体' }));
    await waitFor(() => expect(mock.request).toHaveBeenCalledWith(expect.objectContaining({ action: 'create', kind: 'direct', agentIds: ['a2'] })));
    expect(mock.request.mock.calls[0][0]).not.toHaveProperty('teamId');
  });
});


describe('independent task-room navigation', () => {
  it('creates two independent chats from the same team through the picker even before server refresh', async () => {
    let count = 0;
    mock.request.mockImplementation(async command => {
      if (command.action !== 'create') return { snapshot: base };
      count++;
      return { snapshot: { ...base, conversation: { ...base.conversation, id: 'book-' + count, title: command.title } } };
    });
    const p = props(); p.teams = [pickerTeam]; p.onRefresh = vi.fn();
    render(<AgentWorkspace {...p} />);
    for (let n = 0; n < 2; n++) {
      fireEvent.click(screen.getByRole('button', { name: '新建群聊' }));
      fireEvent.click(await screen.findByRole('button', { name: '选择小队：小说小队' }));
      fireEvent.click(screen.getByRole('button', { name: '创建群聊 · 2 位智能体' }));
      await screen.findByRole('button', { name: '打开群聊：小说小队' + (n ? ' · 2' : '') });
    }
    const second = screen.getByRole('button', { name: '打开群聊：小说小队 · 2' });
    const first = screen.getByRole('button', { name: '打开群聊：小说小队' });
    expect(document.querySelectorAll('[data-contact-id^="group:"]')).toHaveLength(2);
    expect(second.getAttribute('aria-current')).toBe('page');
    fireEvent.click(first);
    expect(first.getAttribute('aria-current')).toBe('page');
    const creates = mock.request.mock.calls.filter(([command]) => command.action === 'create');
    expect(creates).toHaveLength(2);
    expect(creates[0][0].clientRequestId).not.toBe(creates[1][0].clientRequestId);
    expect(mock.command).not.toHaveBeenCalled();
  });
  it('switches between two working rooms without pause/cancel and updates the background room status', () => {
    const summaries = ['book-a', 'book-b'].map(conversationId => ({ conversationId, kind: 'group' as const, members: [], busy: true, roomState: 'running' as const }));
    setCollaborationRostersForTest(summaries);
    const p = props(); p.teams = [pickerTeam]; p.conversations = ['book-a', 'book-b'].map((id, index) => conversation(id, { track: 'team', targetRef: pickerTeam.id, title: index ? '小说 B' : '小说 A' }));
    const view = render(<AgentWorkspace {...p} />);
    const first = screen.getByRole('button', { name: '打开群聊：小说 A' });
    const second = screen.getByRole('button', { name: '打开群聊：小说 B' });
    expect(first.textContent).toContain('工作中'); expect(second.textContent).toContain('工作中');
    fireEvent.click(second); fireEvent.click(first);
    expect(first.getAttribute('aria-current')).toBe('page');
    expect(second.getAttribute('aria-current')).toBeNull();
    expect(mock.command).not.toHaveBeenCalled();
    expect(mock.request).not.toHaveBeenCalled();
    act(() => setCollaborationRostersForTest([summaries[0], { ...summaries[1], busy: false, roomState: 'review' }]));
    expect(second.textContent).toContain('待验收'); expect(first.textContent).toContain('工作中');
    view.unmount();
    render(<AgentWorkspace {...p} />);
    expect(screen.getByRole('button', { name: '打开群聊：小说 A' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: '打开群聊：小说 B' })).toBeTruthy();
  });

  it('creates a one-agent task room from the dedicated group entry', async () => {
    render(<AgentWorkspace {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: '新建群聊' }));
    const dialog = screen.getByRole('dialog', { name: '和你的智能体聊聊' });
    expect((within(dialog).getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: '设计师' }));
    await waitFor(() => expect((within(dialog).getByRole('button', { name: '开始聊天 · 1 位智能体' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(within(dialog).getByRole('button', { name: '开始聊天 · 1 位智能体' }));
    await waitFor(() => expect(mock.request).toHaveBeenCalledWith(expect.objectContaining({ action: 'create', kind: 'group', agentIds: ['a0'] })));
  });
});

describe('group chat folders stay separate from team execution', () => {
  it('moves a real sidebar chat into a folder and deletes only the folder', async () => {
    const p = props(); p.conversations = [conversation('book-a', { title: '小说 A' }), conversation('book-b', { title: '小说 B' })];
    render(<AgentWorkspace {...p} />);
    fireEvent.click(await screen.findByRole('button', { name: '创建群聊分组' }));
    fireEvent.change(screen.getByLabelText('分组名称'), { target: { value: '小说组' } });
    fireEvent.click(screen.getByRole('button', { name: '保存分组' }));
    fireEvent.click(screen.getByRole('button', { name: '小说 A的选项' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '移动到分组' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '小说组' }));
    const folder = screen.getByRole('region', { name: '小说组分组' });
    expect(within(folder).getByRole('button', { name: '打开群聊：小说 A' })).toBeTruthy();
    expect(within(folder).queryByRole('button', { name: '打开群聊：小说 B' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '小说组分组的选项' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '删除分组' }));
    expect(screen.getByRole('dialog').textContent).toContain('群聊会回到');
    fireEvent.click(screen.getByRole('button', { name: '确认删除分组' }));
    expect(screen.queryByRole('region', { name: '小说组分组' })).toBeNull();
    expect(screen.getByRole('button', { name: '打开群聊：小说 A' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '打开群聊：小说 B' })).toBeTruthy();
    expect(mock.command).not.toHaveBeenCalled();
    expect(p.onArchive).not.toHaveBeenCalled();
    expect(p.onRefresh).not.toHaveBeenCalled();
  });
});


describe('embedded contacts in the shared shell', () => {
  function sidebarHost() {
    render(<div data-testid="shared-sidebar-host" />);
    return screen.getByTestId('shared-sidebar-host') as HTMLDivElement;
  }
  it('shows real group and private contacts without opening or upgrading a chat', async () => {
    const host = sidebarHost();
    const p = { ...props(), embedded: true, sidebarHost: host, sidebarVisible: true, contentActive: false,
      conversations: [conversation('direct', { collaborationKind: 'direct', hasMessages: true }), conversation('novel', { title: '小说创作小队', track: 'team' })], renderLegacyConversation: vi.fn() };
    localStorage.setItem('sync-think.agent-workspace.selection.v1:ws1', 'direct');
    render(<AgentWorkspace {...p} />);
    await within(host).findByRole('button', { name: '打开群聊：小说创作小队' });
    expect(within(host).getByRole('region', { name: '智能体私聊列表' })).toBeTruthy();
    expect(screen.queryByLabelText('升级单聊')).toBeNull();
    expect(p.renderLegacyConversation).not.toHaveBeenCalled();
    expect(mock.request).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-current="page"]')).toBeNull();
    expect(host.querySelector('.aw-conversation.is-selected')).toBeNull();
    expect(within(host).queryByRole('button', { name: '返回工作台' })).toBeNull();
    expect(within(host).queryByRole('button', { name: '设置' })).toBeNull();
  });
  it('opens a selected group on the right and preserves its draft while hiding the contacts', async () => {
    const host = sidebarHost();
    const onContentSelected = vi.fn();
    const p = { ...props(), embedded: true, sidebarHost: host, sidebarVisible: true, contentActive: false,
      onContentSelected, conversations: [conversation('c1', { title: '小说创作小队', track: 'team' })] };
    const view = render(<AgentWorkspace {...p} />);
    fireEvent.click(await within(host).findByRole('button', { name: '打开群聊：小说创作小队' }));
    expect(onContentSelected).toHaveBeenCalledOnce();
    view.rerender(<AgentWorkspace {...p} contentActive />);
    const composer = screen.getByRole('textbox', { name: '协作消息' });
    fireEvent.change(screen.getByTestId('collaboration-draft'), { target: { value: '保留群聊草稿' } });
    view.rerender(<AgentWorkspace {...p} contentActive sidebarVisible={false} sidebarHost={null} />);
    expect(screen.getByRole('textbox', { name: '协作消息' })).toBe(composer);
    expect(composer.textContent).toBe('保留群聊草稿');
    expect(host.childElementCount).toBe(0);
    view.rerender(<AgentWorkspace {...p} contentActive />);
    expect(screen.getByRole('textbox', { name: '协作消息' })).toBe(composer);
    expect(composer.textContent).toBe('保留群聊草稿');
    expect(within(host).getByRole('button', { name: '打开群聊：小说创作小队' })).toBeTruthy();
  });
  it('keeps standard actions, inline archives and workspace selection in the embedded sidebar', async () => {
    const host = sidebarHost();
    const p = { ...props(), embedded: true, sidebarHost: host, sidebarVisible: true, contentActive: false, conversations: [conversation('archive', { archivedAt: '2026-10-01T00:00:00Z' })] };
    render(<AgentWorkspace {...p} />);
    fireEvent.click(within(host).getByRole('button', { name: '搜索智能体会话' }));
    expect(within(host).getByRole('searchbox', { name: '搜索会话' })).toBeTruthy();
    fireEvent.click(within(host).getByRole('button', { name: '归档会话' }));
    expect(within(host).getByRole('button', { name: '归档会话' }).getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('.agent-chat-workspace__footer [data-testid="agent-archive-section-toggle"]')).toBeNull();
    expect(within(host).getByRole('combobox', { name: '智能体工作区' })).toBeTruthy();
    fireEvent.click(within(host).getByRole('button', { name: '新建智能体聊天' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(mock.request).not.toHaveBeenCalled();
  });
});


it('removes the sidebar portal when its parent freezes old visible props, and restores it once', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const p = { ...props(), embedded: true, sidebarHost: host, sidebarVisible: true, contentActive: false };
  const tree = (active: boolean) => <KeepAliveLayer active={active}><AgentWorkspace {...p} /></KeepAliveLayer>;
  const view = render(tree(true));
  try {
    await within(host).findByRole('button', { name: '搜索智能体会话' });
    for (let cycle = 0; cycle < 3; cycle++) {
      view.rerender(tree(false));
      expect(host.childElementCount).toBe(0);
      view.rerender(tree(true));
      expect(within(host).getAllByRole('button', { name: '搜索智能体会话' })).toHaveLength(1);
    }
    expect(mock.request).not.toHaveBeenCalled();
  } finally { view.unmount(); host.remove(); }
});


it('uses labeled standard actions and keeps archives inside the scrolling list without hiding active chats', async () => {
  const p = props();
  p.onUnarchive = vi.fn();
  p.conversations = [conversation('active-room', { title: '活跃群聊', track: 'team' }), conversation('archived-room', { title: '旧项目归档', track: 'team', archivedAt: '2026-10-01T00:00:00Z' })];
  render(<AgentWorkspace {...p} />);
  const sidebar = screen.getByRole('complementary', { name: '智能体会话列表' });
  expect(within(sidebar).queryByRole('button', { name: '与已有智能体聊天' })).toBeNull();
  expect(within(sidebar).getByTestId('nav-search').textContent).toBe('搜索');
  expect(within(sidebar).getByTestId('nav-new-chat').textContent).toBe('新建对话');
  expect(sidebar.querySelector('.agent-chat-workspace__tools')).toBeNull();
  const archive = within(sidebar).getByTestId('agent-archive-section-toggle');
  expect(archive.closest('.agent-chat-workspace__conversations')).toBeTruthy();
  expect(archive.closest('.agent-chat-workspace__footer')).toBeNull();
  expect(archive.getAttribute('aria-expanded')).toBe('false');
  expect(within(sidebar).queryByRole('button', { name: '打开群聊：旧项目归档' })).toBeNull();
  fireEvent.click(archive);
  expect(archive.getAttribute('aria-expanded')).toBe('true');
  expect(await within(sidebar).findByRole('button', { name: '打开群聊：旧项目归档' })).toBeTruthy();
  expect(within(sidebar).getByRole('button', { name: '打开群聊：活跃群聊' })).toBeTruthy();
  fireEvent.click(within(sidebar).getByRole('button', { name: '旧项目归档的选项' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '取消归档' }));
  expect(p.onUnarchive).toHaveBeenCalledWith('archived-room');
  expect(mock.request).not.toHaveBeenCalled();
});


it('mounts embedded actions in the common header and clears both portals when frozen', async () => {
  const host = document.createElement('div'); const actionsHost = document.createElement('div');
  document.body.append(host, actionsHost);
  const p = { ...props(), embedded: true, sidebarHost: host, actionsHost, sidebarVisible: true, contentActive: false };
  const tree = (active: boolean) => <KeepAliveLayer active={active}><AgentWorkspace {...p} /></KeepAliveLayer>;
  const view = render(tree(true));
  try {
    expect(within(actionsHost).getByRole('button', { name: '搜索智能体会话' })).toBeTruthy();
    expect(within(host).queryByTestId('nav-search')).toBeNull();
    fireEvent.click(within(actionsHost).getByTestId('nav-search'));
    expect(within(host).getByRole('searchbox', { name: '搜索会话' })).toBeTruthy();
    view.rerender(tree(false));
    expect(host.childElementCount).toBe(0); expect(actionsHost.childElementCount).toBe(0);
    view.rerender(tree(true));
    expect(within(actionsHost).getAllByTestId('nav-search')).toHaveLength(1);
    expect(within(host).getByRole('searchbox', { name: '搜索会话' })).toBeTruthy();
  } finally { view.unmount(); host.remove(); actionsHost.remove(); }
});
