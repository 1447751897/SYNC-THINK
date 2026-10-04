/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Conversation } from '@sync-think/shared';
import type { WorkspaceSummary } from '@sync-think/protocol';
import { TaskConversationPicker } from './TaskConversationPicker.js';

const workspace = { workspaceId: 'work-one', name: '工作区一' } as WorkspaceSummary;
const conversation = (id: string, patch: Partial<Conversation> = {}): Conversation => ({
  id: id as Conversation['id'], workspaceId: workspace.workspaceId, title: id,
  track: 'model', targetRef: 'model-one', executionMode: 'workspace', interactionMode: 'execute',
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z', ...patch,
});
afterEach(() => { cleanup(); Reflect.deleteProperty(window, 'syncThink'); });
function setup(rows: Conversation[], onChange = vi.fn(), failOnce = false) {
  const listConversations = vi.fn(async () => ({ conversations: rows }));
  if (failOnce) listConversations.mockRejectedValueOnce(new Error('offline'));
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: { listConversations } } });
  render(<TaskConversationPicker workspaceId={workspace.workspaceId} workspaces={[workspace]} onChange={onChange} />);
  fireEvent.keyDown(screen.getByRole('button', { name: '运行会话' }), { key: 'ArrowDown', code: 'ArrowDown' });
  return { listConversations, onChange };
}
it('filters the chosen workspace and archived chats, puts pinned chats first, and searches', async () => {
  setup([
    conversation('普通会话'), conversation('置顶会话', { pinnedAt: '2026-10-02T00:00:00Z' }),
    conversation('其他工作区', { workspaceId: 'work-two' as Conversation['workspaceId'] }),
    conversation('已归档', { archivedAt: '2026-10-03T00:00:00Z' }),
    conversation('旧版小队会话', { track: 'team' }),
  ]);
  await screen.findByRole('menuitem', { name: /置顶会话/ });
  expect(screen.queryByRole('menuitem', { name: /其他工作区|已归档|旧版小队会话/ })).toBeNull();
  expect(screen.getAllByRole('menuitem').slice(2).map(item => item.textContent)).toEqual([
    expect.stringContaining('置顶会话'), expect.stringContaining('普通会话'),
  ]);
  fireEvent.change(screen.getByRole('textbox', { name: '搜索运行会话' }), { target: { value: '普通' } });
  expect(screen.getByRole('menuitem', { name: /普通会话/ })).toBeTruthy();
  expect(screen.queryByRole('menuitem', { name: /置顶会话/ })).toBeNull();
});
it.each(['new', 'task'] as const)('selects %s policy and closes the menu', async mode => {
  const { onChange } = setup([]);
  fireEvent.click(screen.getByRole('menuitem', { name: mode === 'new' ? '每次运行时新建会话' : '此任务的专属会话' }));
  expect(onChange).toHaveBeenCalledWith({ mode }, undefined);
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
});
it('returns the real existing conversation so the editor can adopt its executor', async () => {
  const chosen = conversation('正文继续编写', { track: 'agent', targetRef: 'agent-writer' });
  const { onChange } = setup([chosen]);
  fireEvent.click(await screen.findByRole('menuitem', { name: /正文继续编写/ }));
  expect(onChange).toHaveBeenCalledWith({ mode: 'existing', conversationId: chosen.id }, chosen);
});
it('retries a failed list request without altering the destination', async () => {
  const { onChange } = setup([], vi.fn(), true);
  expect(await screen.findByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await screen.findByText('没有匹配的会话');
  expect(onChange).not.toHaveBeenCalled();
});
it('lists internal-inbox chats under global scope without adopting the hidden workspace ID', async () => {
  const chosen = conversation('全局继续会话', { workspaceId: 'internal-inbox' as Conversation['workspaceId'] });
  const onChange = vi.fn();
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: {
    listConversations: async () => ({ conversations: [chosen, conversation('真实工作区会话')] }),
    listWorkspaces: async () => ({ workspaces: [{ workspaceId: 'internal-inbox', name: '__inbox__' }, workspace] }),
  } } });
  render(<TaskConversationPicker workspaces={[workspace]} onChange={onChange} />);
  fireEvent.keyDown(screen.getByRole('button', { name: '运行会话' }), { key: 'ArrowDown', code: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('menuitem', { name: /全局继续会话/ }));
  expect(onChange).toHaveBeenCalledWith({ mode: 'existing', conversationId: chosen.id }, { ...chosen, workspaceId: undefined });
});
