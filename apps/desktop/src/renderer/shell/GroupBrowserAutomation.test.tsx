import { changeTaskControl, taskOption } from './task-select-test-utils.js';
/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CollaborationSnapshot } from '@sync-think/shared';
import { GroupBrowserSettings, GroupBrowserHandoffs } from './GroupBrowserAutomation.js';
const command = vi.fn();
const create = vi.fn();
const update = vi.fn();
const proceed = vi.fn();
const listHandoffs = vi.fn();
const snapshot = (id = 'shirts') =>
  ({
    conversation: {
      id,
      workspaceId: 'workspace-a',
      title: id,
      kind: 'group',
      coordinatorMemberId: 'agent:lead',
      policy: {
        browserProfileId: 'account-a',
        browserWorkflowTaskId: 'flow-a',
        browserWorkflowVariables: { keyword: '衬衫' },
      },
      room: { goal: '查询爆款衬衫' },
    },
    members: [{ id: 'agent:lead', agentId: 'lead', active: true }],
    revision: 1,
    attempts: [],
  }) as unknown as CollaborationSnapshot;
beforeEach(() => {
  vi.clearAllMocks();
  listHandoffs.mockReset();
  proceed.mockReset();
  create.mockResolvedValue({
    task: { id: 'monitor-a', name: 'shirts · 定时监控', enabled: true, conversationId: 'shirts' },
  });
  update.mockResolvedValue({
    task: { id: 'monitor-a', name: 'shirts · 定时监控', enabled: false, conversationId: 'shirts' },
  });
  proceed.mockResolvedValue({ status: 'continued' });
  listHandoffs.mockResolvedValue({
    handoffs: [
      {
        handoffId: 'login-a',
        workspaceId: 'workspace-a',
        conversationId: 'shirts',
        profileId: 'account-a',
        siteOrigin: 'https://fixture.test',
        reason: 'login',
        requestedOutcome: '登录后继续查询',
        onCancel: 'keep-open',
        revision: 1,
        canContinue: true,
        canCancel: true,
      },
      {
        handoffId: 'login-b',
        workspaceId: 'workspace-a',
        conversationId: 'pants',
        profileId: 'account-b',
        siteOrigin: 'https://other.test',
        reason: 'login',
        requestedOutcome: '其他群的登录',
        onCancel: 'keep-open',
        revision: 1,
        canContinue: true,
        canCancel: true,
      },
    ],
  });
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: {
      runtime: {
        listBrowserProfiles: vi.fn(async () => ({
          profiles: [
            { id: 'account-a', name: '账号A' },
            { id: 'account-b', name: '账号B' },
          ],
        })),
        browserWorkflow: {
          list: vi.fn(async () => ({
            tasks: [
              {
                id: 'flow-a',
                name: '商品搜索',
                profileId: 'account-a',
                status: 'enabled',
                workspaceId: 'workspace-a',
              },
              { id: 'flow-b', name: '另一个账号流程', profileId: 'account-b', status: 'enabled' },
            ],
          })),
          get: vi.fn(async () => ({
            version: { steps: [{ kind: 'fill', value: { kind: 'variable', name: 'keyword' } }] },
          })),
        },
        listScheduledTasks: vi.fn(async () => ({ tasks: [] })),
        createScheduledTask: create,
        updateScheduledTask: update,
        listWaitingBrowserHandoffs: listHandoffs,
        continueBrowserHandoff: proceed,
        cancelBrowserHandoff: vi.fn(async () => ({})),
        onEvent: vi.fn(() => () => {}),
      },
    },
  });
});
afterEach(cleanup);
it('selects a persistent account and clears an incompatible flow instead of leaking another account', async () => {
  render(<GroupBrowserSettings snapshot={snapshot()} busy={false} onCommand={command} />);
  await waitFor(() => expect(screen.getByLabelText('群聊浏览器 Profile').textContent).toContain('账号A'));
  taskOption('账号B', '群聊浏览器 Profile');
  expect(screen.queryByRole('menuitemradio', { name: '另一个账号流程' })).toBeNull();
  changeTaskControl(screen.getByLabelText('群聊浏览器 Profile'), { target: { value: 'account-b' } });
  expect(command).toHaveBeenCalledWith(
    expect.objectContaining({
      conversationId: 'shirts',
      policy: {
        browserProfileId: 'account-b',
        browserWorkflowTaskId: '',
        browserWorkflowVariables: {},
      },
    }),
  );
});
it('changes the keyword for the existing reusable flow without creating or publishing a new flow', async () => {
  render(<GroupBrowserSettings snapshot={snapshot()} busy={false} onCommand={command} />);
  const keyword = await screen.findByLabelText('流程参数 keyword');
  expect((keyword as HTMLInputElement).value).toBe('衬衫');
  changeTaskControl(keyword, { target: { value: '裤子' } });
  fireEvent.blur(keyword);
  expect(command).toHaveBeenCalledWith(
    expect.objectContaining({ policy: { browserWorkflowVariables: { keyword: '裤子' } } }),
  );
});
it('creates monitoring in the existing group and pauses that monitor through its own task id', async () => {
  render(<GroupBrowserSettings snapshot={snapshot()} busy={false} onCommand={command} />);
  await screen.findByLabelText('流程参数 keyword');
  fireEvent.click(screen.getByText('定时监控 · 在本群执行'));
  changeTaskControl(screen.getByLabelText('定时监控间隔'), { target: { value: '30' } });
  fireEvent.click(screen.getByText('启用本群定时监控'));
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        collaborationConversationId: 'shirts',
        workspaceId: 'workspace-a',
        instruction: '查询爆款衬衫',
        rule: { kind: 'every', intervalMinutes: 30 },
      }),
    ),
  );
  fireEvent.click(await screen.findByText('暂停监控'));
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith({ taskId: 'monitor-a', patch: { enabled: false } }),
  );
});
it('shows only this group login and continues the exact durable handoff', async () => {
  render(<GroupBrowserHandoffs snapshot={snapshot()} active />);
  await screen.findByText('登录后继续查询');
  expect(screen.queryByText('其他群的登录')).toBeNull();
  expect(listHandoffs).toHaveBeenCalledWith({
    conversationId: 'shirts',
    workspaceId: 'workspace-a',
  });
  fireEvent.click(screen.getByText('我已完成，继续'));
  await waitFor(() =>
    expect(proceed).toHaveBeenCalledWith({ handoffId: 'login-a', expectedRevision: 1 }),
  );
});
it('an inactive group never loads or exposes a login handoff', () => {
  render(<GroupBrowserHandoffs snapshot={snapshot()} active={false} />);
  expect(listHandoffs).not.toHaveBeenCalled();
  expect(screen.queryByTestId('group-browser-login-handoff')).toBeNull();
});

it('switching groups resets monitor instructions rather than submitting the previous group goal', async () => {
  const view = render(
    <GroupBrowserSettings snapshot={snapshot()} busy={false} onCommand={command} />,
  );
  fireEvent.click(screen.getByText('定时监控 · 在本群执行'));
  changeTaskControl(screen.getByLabelText('定时监控目标'), {
    target: { value: '账号A的私有监控目标' },
  });
  const other = snapshot('pants');
  other.conversation.room!.goal = '账号B：查询裤子';
  view.rerender(<GroupBrowserSettings snapshot={other} busy={false} onCommand={command} />);
  await waitFor(() =>
    expect((screen.getByLabelText('定时监控目标') as HTMLTextAreaElement).value).toBe(
      '账号B：查询裤子',
    ),
  );
});
it('a failed login-state query is visible and offers retry instead of silently hiding the blocker', async () => {
  listHandoffs.mockRejectedValue(new Error('connection lost'));
  render(<GroupBrowserHandoffs snapshot={snapshot()} active />);
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: '重试' })).toBeDefined();
});

it('clears a failed query on a successful empty retry and shows the real failure detail', async () => {
  listHandoffs.mockRejectedValueOnce(new Error('Invalid list-waiting-browser-handoffs payload'))
    .mockResolvedValue({ handoffs: [] });
  render(<GroupBrowserHandoffs snapshot={snapshot()} active />);
  await screen.findByText('Invalid list-waiting-browser-handoffs payload');
  fireEvent.click(screen.getByText('失败详情'));
  expect(screen.getByText('Invalid list-waiting-browser-handoffs payload').closest('details')?.open).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(listHandoffs).toHaveBeenCalledTimes(2);
});

it('keeps a read failure visible even when the last durable handoff is still displayed', async () => {
  const view = render(<GroupBrowserHandoffs snapshot={snapshot()} active />);
  await screen.findByText('登录后继续查询');
  listHandoffs.mockRejectedValueOnce(new Error('query failed with durable cards'));
  view.rerender(<GroupBrowserHandoffs snapshot={{ ...snapshot(), revision: 2 }} active />);
  await screen.findByText('query failed with durable cards');
  expect(screen.getByText('登录后继续查询')).toBeDefined();
});

it('does not display another workspace even if its group id matches', async () => {
  listHandoffs.mockResolvedValue({ handoffs: [{
    handoffId: 'foreign-workspace', conversationId: 'shirts', workspaceId: 'workspace-b',
    requestedOutcome: '外部工作区登录',
  }] });
  render(<GroupBrowserHandoffs snapshot={snapshot()} active />);
  await act(async () => {});
  expect(screen.queryByText('外部工作区登录')).toBeNull();
});

it('retains an action conflict after reconciliation and clears it only on a new successful decision', async () => {
  proceed.mockRejectedValueOnce(new Error('browser.handoff-conflict: revision changed'))
    .mockResolvedValue({ status: 'continued' });
  render(<GroupBrowserHandoffs snapshot={snapshot()} active />);
  fireEvent.click(await screen.findByRole('button', { name: '我已完成，继续' }));
  await screen.findByText(/browser.handoff-conflict: revision changed/);
  expect(listHandoffs).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: '我已完成，继续' }));
  await waitFor(() => expect(screen.queryByText(/browser.handoff-conflict/)).toBeNull());
  expect(proceed).toHaveBeenCalledTimes(2);
});
