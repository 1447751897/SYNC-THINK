/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CollaborationSnapshot } from '@sync-think/shared';
import { CollaborationApprovals } from './CollaborationApprovals.js';
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'syncThink');
});
it('restores only this conversation child approval and submits a one-shot decision', async () => {
  const list = vi.fn().mockResolvedValue({
    approvals: [
      {
        approvalId: 'own',
        threadId: 'own-thread',
        toolName: 'create_agent',
        title: '创建研究智能体',
        detail: '保存配置',
        allowedScopes: ['once', 'session'],
      },
      {
        approvalId: 'other',
        threadId: 'other-thread',
        toolName: 'create_agent',
        title: '别的会话',
        detail: '',
      },
    ],
  });
  const decide = vi.fn().mockImplementation(async () => {
    list.mockResolvedValue({ approvals: [] });
    return { approvalId: 'own', outcome: 'approved' };
  });
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: {
      runtime: {
        listPendingToolApprovals: list,
        decideToolApproval: decide,
        onEvent: vi.fn(() => vi.fn()),
      },
    },
  });
  const snapshot = {
    conversation: { id: 'c' },
    attempts: [{ id: 'a', threadId: 'own-thread', status: 'waiting_input' }],
  } as CollaborationSnapshot;
  const result = render(<CollaborationApprovals snapshot={snapshot} active />);
  await screen.findByTestId('tool-approval-own');
  expect(screen.queryByTestId('tool-approval-other')).toBeNull();
  expect(screen.queryByRole('button', { name: '本会话允许此工具' })).toBeNull();
  const approve = screen
    .getAllByRole('button')
    .find(
      (button) =>
        button.textContent === '批准一次' ||
        button.textContent === '允许一次' ||
        button.className.includes('is-primary'),
    )!;
  fireEvent.click(approve);
  await waitFor(() =>
    expect(decide).toHaveBeenCalledWith({ approvalId: 'own', decision: 'approve', scope: 'once' }),
  );
  result.rerender(<CollaborationApprovals snapshot={snapshot} active={false} />);
  expect(screen.queryByTestId('tool-approval-own')).toBeNull();
});
