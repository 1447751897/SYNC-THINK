/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationAttentionCenter } from './ConversationAttentionCenter.js';
afterEach(cleanup);
const items = [
  {
    conversationId: 'a',
    title: '数据库迁移',
    workspace: '项目 A',
    kind: 'answer' as const,
    sequence: 3,
  },
  {
    conversationId: 'b',
    title: '上线检查',
    workspace: '项目 B',
    kind: 'approval' as const,
    sequence: 2,
  },
];
describe('global attention center', () => {
  it('lists pending conversations across projects and navigates on demand', () => {
    const open = vi.fn();
    render(
      <ConversationAttentionCenter
        items={items}
        preferences={{ completed: true, sound: false }}
        onPreferencesChange={vi.fn()}
        onOpenConversation={open}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '待处理 · 2' }));
    expect(screen.getByText('等你回答')).toBeTruthy();
    expect(screen.getByText('等你审批')).toBeTruthy();
    expect(screen.getByText('项目 B')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /数据库迁移/ }));
    expect(open).toHaveBeenCalledWith('a');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(items).toHaveLength(2);
  });
  it('provides completion and optional sound settings without a switch to mute pending questions', () => {
    const change = vi.fn();
    render(
      <ConversationAttentionCenter
        items={[]}
        preferences={{ completed: true, sound: false }}
        onPreferencesChange={change}
        onOpenConversation={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '待处理 · 0' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '任务完成时提醒' }));
    expect(change).toHaveBeenLastCalledWith({ completed: false, sound: false });
    fireEvent.click(screen.getByRole('checkbox', { name: '系统通知声音' }));
    expect(change).toHaveBeenLastCalledWith({ completed: true, sound: true });
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });
});
