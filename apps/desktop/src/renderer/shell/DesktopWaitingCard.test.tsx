/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DesktopWaitingCommandSummary } from '@sync-think/protocol';
import type { RunId, TaskId, WorkspaceId } from '@sync-think/shared';
import { DesktopWaitingCard, DesktopWaitingQueryError } from './DesktopWaitingCard.js';

const command: DesktopWaitingCommandSummary = {
  commandId: 'desktop-command-1',
  workspaceId: 'workspace-1' as WorkspaceId,
  taskId: 'task-1' as TaskId,
  runId: 'run-1' as RunId,
  toolName: 'desktop_set_value',
  action: 'set-value',
  target: { processId: 42, title: 'Settings', appId: 'fixture.settings' },
  reason: 'user-input-detected',
  errorCode: 'desktop.user-input-detected',
  status: 'waiting_user',
  canContinue: true,
  canCancel: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:01:00.000Z',
};

afterEach(cleanup);

describe('DesktopWaitingCard', () => {
  it('renders a read-only user-input interruption summary without sensitive internals', () => {
    render(
      <DesktopWaitingCard command={command} busy={false} onContinue={vi.fn()} onCancel={vi.fn()} />,
    );

    expect(screen.getByText('\u684c\u9762\u64cd\u4f5c\u7b49\u5f85\u4f60\u5904\u7406')).toBeTruthy();
    expect(screen.getByText('\u586b\u5199\u754c\u9762\u5185\u5bb9')).toBeTruthy();
    expect(screen.getByText('Settings')).toBeTruthy();
    expect(screen.getByText('PID 42')).toBeTruthy();
    expect(screen.getByRole('button', { name: '我已处理，继续' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '取消等待' })).toBeTruthy();
    expect(document.body.textContent).toContain(
      '\u7cfb\u7edf\u6ca1\u6709\u81ea\u52a8\u91cd\u653e\u6b64\u64cd\u4f5c',
    );
    expect(document.body.textContent).not.toMatch(
      /nativeWindowHandle|targetIdentity|ownerId|snapshotRevision|accessibilityRevision|secret/i,
    );
  });

  it('distinguishes restart inspection from active user input', () => {
    render(
      <DesktopWaitingCard
        busy={false}
        onContinue={vi.fn()}
        onCancel={vi.fn()}
        command={{
          ...command,
          reason: 'restart-inspection',
          errorCode: 'desktop.command-inspection-required',
        }}
      />,
    );

    expect(screen.getByText('\u684c\u9762\u64cd\u4f5c\u9700\u8981\u68c0\u67e5')).toBeTruthy();
    expect(
      screen.getByText(
        /\u5e94\u7528\u91cd\u542f\u540e\u53d1\u73b0\u4e00\u9879\u7ed3\u679c\u672a\u786e\u8ba4/,
      ),
    ).toBeTruthy();
  });

  it('emits continue and cancel decisions and locks both actions while busy', () => {
    const onContinue = vi.fn();
    const onCancel = vi.fn();
    const view = render(
      <DesktopWaitingCard
        command={command}
        busy={false}
        onContinue={onContinue}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '我已处理，继续' }));
    fireEvent.click(screen.getByRole('button', { name: '取消等待' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);

    view.rerender(
      <DesktopWaitingCard command={command} busy onContinue={onContinue} onCancel={onCancel} />,
    );
    expect(
      (screen.getByRole('button', { name: '我已处理，继续' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole('button', { name: '取消等待' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('supports an explicit retry for query failures', () => {
    const onRetry = vi.fn();
    render(<DesktopWaitingQueryError busy={false} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: '\u91cd\u8bd5' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
