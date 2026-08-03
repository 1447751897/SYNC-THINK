/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { BrowserHandoffSummary } from '@sync-think/protocol';
import { BrowserHandoffCard, BrowserHandoffQueryError } from './BrowserHandoffCard.js';

const handoff: BrowserHandoffSummary = {
  handoffId: 'handoff-1',
  revision: 1,
  workspaceId: 'workspace-1' as BrowserHandoffSummary['workspaceId'],
  taskId: 'task-1' as BrowserHandoffSummary['taskId'],
  runId: 'run-1' as BrowserHandoffSummary['runId'],
  siteOrigin: 'https://example.test',
  reason: 'login',
  requestedOutcome: '登录测试账号并进入控制台',
  onCancel: 'close-page',
  status: 'waiting_user',
  createdAt: '2026-07-31T00:00:00.000Z',
  updatedAt: '2026-07-31T00:00:00.000Z',
  canContinue: true,
  canCancel: true,
};

afterEach(cleanup);

describe('BrowserHandoffCard', () => {
  it('explains the system-browser workflow without exposing internal ownership data', () => {
    render(
      <BrowserHandoffCard handoff={handoff} busy={false} onContinue={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText('需要你在系统浏览器中完成操作')).toBeTruthy();
    expect(screen.getByText('https://example.test')).toBeTruthy();
    expect(screen.getByText('登录测试账号并进入控制台')).toBeTruthy();
    expect(screen.getByRole('button', { name: '我已完成，继续' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '取消并关闭页面' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/lease|profile|owner|cookie/i);
  });

  it('shares one busy lock across both decisions', () => {
    const onContinue = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(
      <BrowserHandoffCard
        handoff={handoff}
        busy={false}
        onContinue={onContinue}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '我已完成，继续' }));
    fireEvent.click(screen.getByRole('button', { name: '取消并关闭页面' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);

    rerender(
      <BrowserHandoffCard handoff={handoff} busy onContinue={onContinue} onCancel={onCancel} />,
    );
    expect(
      (screen.getByRole('button', { name: '我已完成，继续' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: '取消并关闭页面' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('offers an explicit retry state when the durable query fails', () => {
    const onRetry = vi.fn();
    render(<BrowserHandoffQueryError busy={false} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
