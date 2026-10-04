/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SidebarNavigationRail } from './SidebarNavigationRail.js';
afterEach(cleanup);
it('opens the rounded accessible tooltip immediately, without a native title delay', () => {
  render(<SidebarNavigationRail stage="talk" onHome={vi.fn()} onSelectStage={vi.fn()}/>);
  const button=screen.getByRole('button',{name:'定时任务'});
  expect(button.hasAttribute('title')).toBe(false);
  fireEvent.mouseEnter(button);
  expect(screen.getByRole('tooltip').textContent).toBe('定时任务');
  expect(button.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id);
  fireEvent.mouseLeave(button);
  expect(screen.queryByRole('tooltip')).toBeNull();
});
it('supports keyboard focus, Escape, and all seven direct navigation destinations', () => {
  const select=vi.fn();
  render(<SidebarNavigationRail stage="talk" onHome={vi.fn()} onSelectStage={select}/>);
  expect(within(screen.getByRole('navigation', { name: '主导航' })).getAllByRole('button')).toHaveLength(7);
  expect(screen.getByRole('button', { name: '本地用户 · 设置' })).toBeTruthy();
  const button=screen.getByRole('button',{name:'浏览器'});
  fireEvent.focus(button);expect(screen.getByRole('tooltip').textContent).toBe('浏览器');
  fireEvent.keyDown(button,{key:'Escape'});expect(screen.queryByRole('tooltip')).toBeNull();
  fireEvent.click(button);expect(select).toHaveBeenCalledWith('browser');
});

it('orders destinations as home, inbox, schedule, browser, agents, teams and abilities', () => {
  render(<SidebarNavigationRail stage="talk" onHome={vi.fn()} onSelectStage={vi.fn()}/>);
  expect(within(screen.getByRole('navigation', { name: '主导航' })).getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['主页', '收件箱', '定时任务', '浏览器', '智能体', '小队', '能力']);
});
