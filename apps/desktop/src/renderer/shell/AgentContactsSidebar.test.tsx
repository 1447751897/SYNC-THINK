/** @vitest-environment jsdom */
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GlobalAgent, Conversation } from '@sync-think/shared';
import type { WorkspaceSummary } from '@sync-think/protocol';
import AgentContactsSidebar, { type AgentContactsSidebarProps } from './AgentContactsSidebar.js';
import { DialogProvider } from './Dialog.js';
import { writeAgentContactGroups } from './agent-contacts.js';
import { projectlessWorkspace, PROJECTLESS_SCOPE } from './projectless-scope.js';
vi.mock('./AgentAvatarView.js', () => ({
  AgentAvatarView: ({ name, state, animate }: { name: string; state?: string; animate?: boolean }) => (
    <span data-testid={`avatar-${name}`} data-state={state} data-animate={animate ? 'true' : 'false'}>
      {name.slice(0, 1)}
    </span>
  ),
}));
const agent = {
  id: 'a',
  name: '前端工程师',
  avatar: 'bot:v1:drop:blue',
  availabilityScope: 'global',
  archived: false,
  description: '开发界面',
} as GlobalAgent;
const scoped = {
  ...agent,
  id: 'b',
  name: '质量复审官',
  availabilityScope: 'workspace',
} as GlobalAgent;
const workspaces = [
  { workspaceId: 'ws-a', name: '项目 A' },
  { workspaceId: 'ws-b', name: '项目 B' },
] as WorkspaceSummary[];
let api: {
  listGlobalAgentWorkspaceActivations: ReturnType<typeof vi.fn>;
  setGlobalAgentWorkspaceActivation: ReturnType<typeof vi.fn>;
  updateGlobalAgent: ReturnType<typeof vi.fn>;
};
beforeEach(() => {
  api = {
    listGlobalAgentWorkspaceActivations: vi.fn().mockResolvedValue({ activations: [] }),
    setGlobalAgentWorkspaceActivation: vi.fn().mockResolvedValue({}),
    updateGlobalAgent: vi.fn().mockResolvedValue({}),
  };
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: api } });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});
const defaults = (): AgentContactsSidebarProps => ({
  agents: [agent, scoped],
  workspaces,
  workspaceId: 'ws-a',
  conversations: ['ws-a', 'ws-b', PROJECTLESS_SCOPE].flatMap(workspaceId => ['a', 'b'].map(targetRef => ({ id: `${workspaceId}-${targetRef}`, workspaceId, targetRef, track: 'agent', lastMessageAt: '2026-09-20', createdAt: '2026-09-20' } as Conversation))),
  onChat: vi.fn(),
  onOpenConversation: vi.fn(),
  onManage: vi.fn(),
  onRefresh: vi.fn(),
});
function view(props = defaults()) {
  return render(
    <StrictMode>
      <DialogProvider>
        <AgentContactsSidebar key={props.workspaceId} {...props} />
      </DialogProvider>
    </StrictMode>,
  );
}

describe('AgentContactsSidebar', () => {
  it('renders actual workspace message previews, unread and running state without leaking other projects', async () => {
    const props = defaults();
    props.conversations = [
      {
        id: 'ca',
        track: 'agent',
        targetRef: 'a',
        workspaceId: 'ws-a',
        title: 'Not the preview',
        lastMessagePreview: '这次要接什么？',
        createdAt: '2026-09-20',
      },
      {
        id: 'cb',
        track: 'agent',
        targetRef: 'a',
        workspaceId: 'ws-b',
        lastMessagePreview: '私有的 B 项目消息',
        createdAt: '2026-09-24',
      },
    ] as Conversation[];
    props.conversationActivity = new Map([
      ['ca', { running: false, unread: true }],
      ['cb', { running: true, unread: false }],
    ]);
    props.selectedConversationId = 'ca';
    view(props);
    expect(screen.getByText('这次要接什么？')).toBeTruthy();
    expect(screen.queryByText('私有的 B 项目消息')).toBeNull();
    expect(screen.queryByText('Not the preview')).toBeNull();
    expect(screen.getByLabelText('有未读消息')).toBeTruthy();
    expect(screen.queryByLabelText('运行中')).toBeNull();
    const button = screen.getByRole('button', { name: '与 前端工程师 聊天' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('avatar-前端工程师').getAttribute('data-state')).toBe('idle');
    expect(screen.getByTestId('avatar-前端工程师').getAttribute('data-animate')).toBe('true');
    expect(screen.queryByTestId('avatar-质量复审官')).toBeNull();
    fireEvent.click(button);
    expect(props.onChat).toHaveBeenCalledWith('a', 'ws-a');
    expect(screen.queryByText('点击激活到此工作区并聊天')).toBeNull();
  });

  it('uses the working motion profile while the current agent conversation is running', async () => {
    const props = defaults();
    props.conversations = [
      {
        id: 'ca',
        track: 'agent',
        targetRef: 'a',
        workspaceId: 'ws-a',
        lastMessagePreview: '处理中',
        createdAt: '2026-09-29',
      },
    ] as Conversation[];
    props.conversationActivity = new Map([['ca', { running: true, unread: false }]]);
    view(props);
    await waitFor(() => expect(screen.getByLabelText('运行中')).toBeTruthy());
    expect(screen.getByTestId('avatar-前端工程师').getAttribute('data-state')).toBe('working');
    expect(screen.getByTestId('avatar-前端工程师').getAttribute('data-animate')).toBe('true');
  });
  it('activates an inactive contact in the current workspace and then opens chat', async () => {
    const props = defaults();
    view(props);
    const button = await screen.findByRole('button', { name: '激活并与 质量复审官 聊天' });
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(props.onChat).toHaveBeenCalledWith('b', 'ws-a'));
    expect(api.setGlobalAgentWorkspaceActivation).toHaveBeenCalledTimes(1);
    expect(api.setGlobalAgentWorkspaceActivation).toHaveBeenCalledWith({
      agentId: 'b',
      workspaceId: 'ws-a',
      active: true,
    });
    expect(api.updateGlobalAgent).not.toHaveBeenCalled();
  });
  it('does not open a chat after switching away during activation', async () => {
    let resolve!: () => void;
    api.setGlobalAgentWorkspaceActivation.mockReturnValue(
      new Promise<void>((r) => {
        resolve = r;
      }),
    );
    const props = defaults();
    const root = view(props);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '激活并与 质量复审官 聊天' }).hasAttribute('disabled'),
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: '激活并与 质量复审官 聊天' }));
    root.unmount();
    view({ ...props, workspaceId: 'ws-b' });
    await act(async () => resolve());
    expect(props.onChat).not.toHaveBeenCalled();
  });
  it('reports write failure and keeps the user out of a falsely activated conversation', async () => {
    api.setGlobalAgentWorkspaceActivation.mockRejectedValue(new Error('保存失败，请重试'));
    const props = defaults();
    view(props);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '激活并与 质量复审官 聊天' }).hasAttribute('disabled'),
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: '激活并与 质量复审官 聊天' }));
    await screen.findByRole('alert');
    expect(props.onChat).not.toHaveBeenCalled();
  });
  it('loads contact groups independently and reveals collapsed matches while searching', async () => {
    writeAgentContactGroups('ws-a', [
      { id: 'g', name: '产品维护组', agentIds: ['a'], collapsed: true },
    ]);
    const root = view();
    expect(screen.getByText('产品维护组')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '与 前端工程师 聊天' })).toBeNull();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '前端' } });
    expect(screen.getByRole('button', { name: '与 前端工程师 聊天' })).toBeTruthy();
    root.unmount();
    view({ ...defaults(), workspaceId: 'ws-b' });
    expect(screen.queryByText('产品维护组')).toBeNull();
    await waitFor(() => expect(api.listGlobalAgentWorkspaceActivations).toHaveBeenCalled());
  });
  it('offers explicit fresh-chat and management actions', async () => {
    const props = defaults();
    view(props);
    fireEvent.click(screen.getByRole('button', { name: '前端工程师 的聊天与工作区设置' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '新建独立对话' }));
    expect(props.onChat).toHaveBeenCalledWith('a', 'ws-a', true);
    fireEvent.click(screen.getByRole('button', { name: '管理智能体' }));
    expect(props.onManage).toHaveBeenCalled();
  });
});


describe('projectless sidebar activation scope', () => {
  it.each(['ws-a', PROJECTLESS_SCOPE])('does not query virtual scopes while viewing %s', async (workspaceId) => {
    api.listGlobalAgentWorkspaceActivations.mockImplementation(async ({ workspaceId }) => {
      if (workspaceId === PROJECTLESS_SCOPE) throw new Error('Workspace not found: __projectless__');
      return { activations: [{ agentId: 'b', workspaceId, active: true }] };
    });
    const props = { ...defaults(), workspaceId, workspaces: [...workspaces, projectlessWorkspace] };
    view(props);
    await waitFor(() => expect(api.listGlobalAgentWorkspaceActivations).toHaveBeenCalled());
    expect(new Set(api.listGlobalAgentWorkspaceActivations.mock.calls.map(([input]) => input.workspaceId))).toEqual(new Set(['ws-a', 'ws-b']));
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '与 前端工程师 聊天' }));
    expect(props.onChat).toHaveBeenCalledWith('a', workspaceId);
    if (workspaceId === PROJECTLESS_SCOPE) {
      expect(screen.getByText('可在菜单中设为全局可用后聊天')).toBeTruthy();
      expect(screen.getByRole('button', { name: '激活并与 质量复审官 聊天' }).hasAttribute('disabled')).toBe(true);
      expect(api.setGlobalAgentWorkspaceActivation).not.toHaveBeenCalled();
    }
  });
  it('supports projectless-only use without requesting a workspace activation list', async () => {
    const props = { ...defaults(), workspaceId: PROJECTLESS_SCOPE, workspaces: [projectlessWorkspace] };
    view(props);
    fireEvent.click(screen.getByRole('button', { name: '与 前端工程师 聊天' }));
    expect(props.onChat).toHaveBeenCalledWith('a', PROJECTLESS_SCOPE);
    expect(api.listGlobalAgentWorkspaceActivations).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('still exposes a genuine workspace loading error', async () => {
    api.listGlobalAgentWorkspaceActivations.mockRejectedValue(new Error('真实工作区读取失败'));
    view({ ...defaults(), workspaces: [...workspaces, projectlessWorkspace] });
    expect((await screen.findByRole('alert')).textContent).toContain('真实工作区读取失败');
  });
});

it('omits newly created agents and empty conversations from chat contacts', () => {
  view({ ...defaults(), conversations: [{ id: 'empty', workspaceId: 'ws-a', targetRef: 'a', track: 'agent', createdAt: '2026-09-29' } as Conversation] });
  expect(screen.queryByRole('button', { name: '与 前端工程师 聊天' })).toBeNull();
  expect(screen.queryByRole('button', { name: '激活并与 质量复审官 聊天' })).toBeNull();
});
