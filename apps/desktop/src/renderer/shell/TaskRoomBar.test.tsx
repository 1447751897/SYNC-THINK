/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_COLLABORATION_CHAT_POLICY, type CollaborationSnapshot } from '@sync-think/shared';
import { TaskRoomBar } from './TaskRoomBar.js';
afterEach(cleanup);
function room(state: NonNullable<CollaborationSnapshot['conversation']['room']>['state'] = 'discussion'): CollaborationSnapshot {
  return { conversation: { id: 'room-a', title: '小说A', workspaceId: 'w', kind: 'group', coordinatorMemberId: 'leader', createdAt: '', policy: DEFAULT_COLLABORATION_CHAT_POLICY,
    room: { version: 1, state, goal: '只写 A', goalRevision: 3, sourceSequence: 0, checkpoint: { version: 1, savedAt: '2026-09-30', pendingTaskIds: [], completedTaskIds: [], artifactIds: [], note: '半章已保留' } } }, members: [], tasks: [], attempts: [], messages: [], deliveries: [], receipts: {}, revision: 1 };
}
it('starts explicit work against the confirmed room brief', async () => {
  const command = vi.fn().mockResolvedValue({}); render(<TaskRoomBar snapshot={room()} onCommand={command} onSelectTask={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '开始团队工作' }));
  await waitFor(() => expect(command).toHaveBeenCalledWith(expect.objectContaining({ action: 'start-workflow', conversationId: 'room-a', goal: '只写 A', clientRequestId: expect.any(String) })));
});
it('requires reviewing checkpoint before continuing and uses an idempotent retry key', async () => {
  const command = vi.fn().mockRejectedValue(new Error('timeout')); render(<TaskRoomBar snapshot={room('paused')} onCommand={command} onSelectTask={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '核对并继续' }));
  const resume = screen.getByRole('button', { name: '继续本群工作' }) as HTMLButtonElement;
  expect(resume.disabled).toBe(true); fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(resume);
  await waitFor(() => expect(resume.disabled).toBe(false)); fireEvent.click(resume);
  await waitFor(() => expect(command).toHaveBeenCalledTimes(2));
  expect(command.mock.calls[0][0]).toEqual(command.mock.calls[1][0]);
  expect(command.mock.calls[0][0].action).toBe('room-resume');
  expect(screen.queryByRole('button', { name: '开始团队工作' })).toBeNull();
});
it('edits the brief with optimistic revision instead of immediately dispatching', async () => {
  const command = vi.fn().mockResolvedValue({}); render(<TaskRoomBar snapshot={room()} onCommand={command} onSelectTask={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '工作目标 v3 · 查看与编辑' }));
  fireEvent.click(screen.getByRole('button', { name: '编辑工作目标 v3' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '新设定' } });
  fireEvent.click(screen.getByRole('button', { name: '保存工作目标' }));
  await waitFor(() => expect(command).toHaveBeenCalledWith(expect.objectContaining({ action: 'room-brief', goal: '新设定', expectedGoalRevision: 3 })));
  expect(command).toHaveBeenCalledTimes(1);
});
it('shows pausing with no premature resume and offers acceptance only after review', () => {
  const view = render(<TaskRoomBar snapshot={room('pausing')} onCommand={vi.fn()} onSelectTask={vi.fn()} />);
  expect(screen.getByText('等待停止…')).toBeTruthy(); expect(screen.queryByRole('button', { name: '继续本群工作' })).toBeNull();
  const ready = room('review'); ready.conversation.room!.checkpoint.artifactIds = ['delivered-doc'];
  view.rerender(<TaskRoomBar snapshot={ready} onCommand={vi.fn()} onSelectTask={vi.fn()} />);
  expect(screen.getByRole('button', { name: '验收完成' })).toBeTruthy();
});

it('starts an empty group as chat without a mandatory form or disabled work buttons', () => {
  const snapshot = room(); snapshot.conversation.room!.goal = '';
  render(<TaskRoomBar snapshot={snapshot} onCommand={vi.fn()} onSelectTask={vi.fn()} />);
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('button', { name: '开始团队工作' })).toBeNull();
  expect(screen.queryByRole('button', { name: '暂停本群工作' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '设置工作目标（可选）' }));
  expect(screen.getByRole('textbox')).toBeTruthy();
});

it('opens the goal in a modal, leaves no inline expansion, and restores focus on escape', async () => {
  const { container } = render(<TaskRoomBar snapshot={room()} onCommand={vi.fn()} onSelectTask={vi.fn()} />);
  expect(container.querySelector('details')).toBeNull(); expect(screen.queryByText('只写 A')).toBeNull();
  const trigger = screen.getByRole('button', { name: '工作目标 v3 · 查看与编辑' });
  trigger.focus(); fireEvent.click(trigger);
  const modal = screen.getByRole('dialog', { name: '工作目标' });
  expect(modal.textContent).toContain('只写 A');
  fireEvent.keyDown(modal, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

it('keeps the revision captured at edit start when another update arrives', async () => {
  const command = vi.fn().mockResolvedValue({});
  const view = render(<TaskRoomBar snapshot={room()} onCommand={command} onSelectTask={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '工作目标 v3 · 查看与编辑' }));
  fireEvent.click(screen.getByRole('button', { name: '编辑工作目标 v3' }));
  const updated = room(); updated.conversation.room!.goalRevision = 4; updated.conversation.room!.goal = '另一位用户的修改';
  view.rerender(<TaskRoomBar snapshot={updated} onCommand={command} onSelectTask={vi.fn()} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '我的修改' } });
  fireEvent.click(screen.getByRole('button', { name: '保存工作目标' }));
  await waitFor(() => expect(command).toHaveBeenCalledWith(expect.objectContaining({ expectedGoalRevision: 3, goal: '我的修改' })));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('keeps a failed goal save open for retry without starting work', async () => {
  const command = vi.fn().mockRejectedValue(new Error('conflict'));
  render(<TaskRoomBar snapshot={room()} onCommand={command} onSelectTask={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '工作目标 v3 · 查看与编辑' }));
  fireEvent.click(screen.getByRole('button', { name: '编辑工作目标 v3' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '保留草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '保存工作目标' }));
  await waitFor(() => expect((screen.getByRole('button', { name: '保存工作目标' }) as HTMLButtonElement).disabled).toBe(false));
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('保留草稿');
  expect(screen.getByRole('alert').textContent).toBe('conflict');
  fireEvent.click(screen.getByRole('button', { name: '保存工作目标' }));
  await waitFor(() => expect(command).toHaveBeenCalledTimes(2));
  expect(command.mock.calls[0][0]).toEqual(command.mock.calls[1][0]);
});

it('shows compact separate colored tags and opens progress only on request', () => {
  const open = vi.fn();
  const { container } = render(<TaskRoomBar snapshot={room()} onCommand={vi.fn()} onSelectTask={vi.fn()} artifactCount={2} onOpenResults={open} />);
  expect(container.querySelectorAll('.task-room-bar__tags .task-room-tag').length).toBe(4);
  expect(container.querySelector('.task-room-tag--goal')).toBeTruthy();
  expect(container.querySelector('.task-room-tag--execution')).toBeTruthy();
  expect(container.querySelector('.task-room-tag--results')).toBeTruthy();
  expect(screen.queryByText('半章已保留')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '成果 2' })); expect(open).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '执行 0' }));
  expect(screen.getByRole('dialog', { name: '执行进度' }).textContent).toContain('半章已保留');
});

it('does not offer acceptance for a legacy review state that has no artifact', () => {
  render(<TaskRoomBar snapshot={room('review')} onCommand={vi.fn()} onSelectTask={vi.fn()} />);
  expect(screen.queryByRole('button', { name: '验收完成' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '执行 0' }));
  expect(screen.getByText(/尚无真实交付成果/)).toBeTruthy();
});

it('shows a blocker rather than completion and requires checkpoint review before retrying', async () => {
  const command = vi.fn().mockResolvedValue({});
  render(<TaskRoomBar snapshot={room('blocked')} onCommand={command} onSelectTask={vi.fn()} />);
  expect(screen.getByText('有阻塞')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '验收完成' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '核对并继续' }));
  const resume = screen.getByRole('button', { name: '继续本群工作' }) as HTMLButtonElement;
  expect(resume.disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(resume);
  await waitFor(() => expect(command).toHaveBeenCalledWith(expect.objectContaining({ action: 'room-resume' })));
});

it('shows the author of a legacy summarized goal and labels human revisions separately', () => {
  const snapshot = room(); snapshot.conversation.room!.goalRevision = 1;
  snapshot.receipts['room-brief:start-brief:chat:old-task'] = 'old-message';
  const view = render(<TaskRoomBar snapshot={snapshot} onCommand={vi.fn()} onSelectTask={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '工作目标 v1 · 查看与编辑' }));
  expect(screen.getByText(/智能体自动整理，以用户原始需求为准/)).toBeTruthy();
  expect(screen.getByText(/小队流程只是协作参考/)).toBeTruthy();
  const edited = structuredClone(snapshot); edited.conversation.room!.goalOrigin = 'user';
  view.rerender(<TaskRoomBar snapshot={edited} onCommand={vi.fn()} onSelectTask={vi.fn()} />);
  expect(screen.queryByText(/智能体自动整理，以用户原始需求为准/)).toBeNull();
  expect(screen.getByText(/用户设置/)).toBeTruthy();
});


it('counts only the current goal and explicit replacement plan in progress tags', () => {
  const snapshot = room('review');
  const base = { rootTaskId: 'root', originMessageId: 'message', assigneeMemberId: 'writer', title: 'document', instructions: 'work', expectedOutput: '', dependsOnTaskIds: [], contextRefs: [], resourceClaims: [], returnTo: { conversationId: 'room-a', replyToMessageId: 'message' }, timeoutSeconds: 120, kind: 'task' as const, createdAt: '', purpose: 'work' as const };
  snapshot.tasks = [
    { ...base, id: 'old-goal', goalRevision: 2, currentAttemptId: 'attempt-old' },
    { ...base, id: 'failed', goalRevision: 3, replacedByTaskId: 'fixed', currentAttemptId: 'attempt-failed' },
    { ...base, id: 'fixed', goalRevision: 3, replacesTaskId: 'failed', currentAttemptId: 'attempt-fixed' },
  ];
  snapshot.attempts = snapshot.tasks.map(t => ({ id: t.currentAttemptId, taskId: t.id, number: 1, status: t.id === 'fixed' ? 'succeeded' : 'failed', updatedAt: '', contextSequence: 0, output: '', resourceClaims: [], tools: [], checklist: [] }));
  snapshot.conversation.room!.checkpoint.artifactIds = ['document'];
  render(<TaskRoomBar snapshot={snapshot} onCommand={vi.fn()} onSelectTask={vi.fn()} />);
  expect(screen.getByRole('button', { name: '执行 1' })).toBeTruthy();
  expect(screen.queryByText(/异常/)).toBeNull();
  expect(screen.getByRole('button', { name: '验收完成' })).toBeTruthy();
});

it('separates actual dispatches from downstream plans in the room counter and work index', () => {
  const snapshot = room('running');
  snapshot.tasks = [0, 1, 2].map(n => ({ id: 't-' + n, rootTaskId: 't-0', originMessageId: 'm', assigneeMemberId: 'writer',
    title: '阶段 ' + n, instructions: '阶段 ' + n, expectedOutput: '', dependsOnTaskIds: n ? ['t-' + (n - 1)] : [], contextRefs: [], resourceClaims: [],
    returnTo: { conversationId: 'room-a', replyToMessageId: 'm' }, timeoutSeconds: 7200, currentAttemptId: 'a-' + n,
    kind: 'task', goalRevision: 3, purpose: 'work', createdAt: '',
    ...(n ? { pendingAssignment: { senderMemberId: 'leader', correlationId: 'c', hopCount: 1 } } : {}),
  }));
  snapshot.attempts = snapshot.tasks.map((t, n) => ({ id: t.currentAttemptId, taskId: t.id, number: 1, status: n ? 'queued' : 'running',
    updatedAt: '', contextSequence: 0, output: '', resourceClaims: [], tools: [], checklist: [], ...(n ? { waitReason: 'dependency' as const } : {}),
  }));
  render(<TaskRoomBar snapshot={snapshot} onCommand={vi.fn()} onSelectTask={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '执行 1 · 待派工 2' }));
  expect(screen.getAllByText('待派工 · 等待前置交付')).toHaveLength(2);
});
