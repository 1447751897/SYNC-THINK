/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SidebarChatActions, SidebarChatSearch } from './SidebarChatActions.js';
afterEach(cleanup);
it('keeps the same labels, icons and classes for both modes while dispatching distinct actions', () => {
  const onSearch = vi.fn(); const onNewConversation = vi.fn();
  const view = render(<SidebarChatActions onSearch={onSearch} onNewConversation={onNewConversation} />);
  const search = screen.getByTestId('nav-search'); const create = screen.getByTestId('nav-new-chat');
  const classes = [search.className, create.className];
  fireEvent.click(search); fireEvent.click(create);
  expect(onSearch).toHaveBeenCalledOnce(); expect(onNewConversation).toHaveBeenCalledOnce();
  view.rerender(<SidebarChatActions searchLabel="搜索智能体会话" newConversationLabel="新建智能体聊天" searching onSearch={onSearch} onNewConversation={onNewConversation} />);
  expect([search.className, create.className]).toEqual(classes);
  expect(search.textContent).toBe('搜索'); expect(create.textContent).toBe('新建对话');
  expect(search.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: '新建智能体聊天' })).toBe(create);
});
it('uses the same search field with editable text, empty-blur and Escape behavior', () => {
  const onChange = vi.fn(); const onEmptyBlur = vi.fn(); const onClose = vi.fn();
  const p = { value: '', onChange, onEmptyBlur, onClose };
  const view = render(<SidebarChatSearch {...p} />);
  const input = screen.getByRole('searchbox', { name: '搜索对话' });
  fireEvent.change(input, { target: { value: '研究' } }); expect(onChange).toHaveBeenCalledWith('研究');
  fireEvent.blur(input); expect(onEmptyBlur).toHaveBeenCalledOnce();
  view.rerender(<SidebarChatSearch {...p} value="研究" label="搜索会话" />);
  fireEvent.blur(input); expect(onEmptyBlur).toHaveBeenCalledOnce();
  fireEvent.keyDown(input, { key: 'Escape' }); expect(onClose).toHaveBeenCalledOnce();
  expect(screen.getByRole('searchbox', { name: '搜索会话' })).toBe(input);
});
