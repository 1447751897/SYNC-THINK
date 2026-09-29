/** @vitest-environment jsdom */
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AgentExecutionStatus } from './AgentExecutionStatus.js';
afterEach(cleanup);
it('shows a compact thinking identity, mounts real details only after expansion', () => {
  render(<AgentExecutionStatus name="小美" avatar="bot:v1:triangle:violet" running><div>真实工具事件</div></AgentExecutionStatus>);
  expect(screen.getByText('思考中…')).toBeTruthy();
  expect(screen.queryByText('Think')).toBeNull(); expect(screen.queryByText('真实工具事件')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '小美 · 思考中…' }));
  expect(screen.getByText('真实工具事件')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '小美 · 思考中…' }));
  expect(screen.queryByText('真实工具事件')).toBeNull();
});
it('does not animate approval or failure as though they were still progressing', () => {
  const view = render(<AgentExecutionStatus name="小美" running waiting />);
  expect(screen.getByText('等待你确认')).toBeTruthy();
  expect(screen.getByRole('img').getAttribute('data-expression')).toBe('worried');
  view.rerender(<AgentExecutionStatus name="小美" failed />);
  expect(screen.getByText('执行遇到问题')).toBeTruthy();
});
it('does not invent details when collaboration reports only a waiting attempt', () => {
  render(<AgentExecutionStatus name="小美" running hasDetails={false} />);
  expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText('执行过程')).toBeNull();
});
