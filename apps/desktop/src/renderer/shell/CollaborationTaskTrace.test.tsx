/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CollaborationSnapshot, CollaborationTask, CollaborationAttempt } from '@sync-think/shared';
import CollaborationTaskTrace from './CollaborationTaskTrace.js';
afterEach(() => { cleanup(); vi.useRealTimers(); });
function fixture() {
  const task = { id: 't2', rootTaskId: 'root', title: '审校', kind: 'task', assigneeMemberId: 'editor', dependsOnTaskIds: ['t1'], currentAttemptId: 'a2' } as CollaborationTask;
  const attempt = { id: 'a2', taskId: 't2', number: 1, status: 'succeeded', runId: 'run-2', output: '', updatedAt: '', contextSequence: 0, resourceClaims: [], checklist: [], tools: [], artifacts: [{ id: 'art', taskId: 't2', attemptId: 'a2', title: '首章修订版', kind: 'document', content: '# 回声十秒\n这是经过审校的正文。', sha256: '1234567890abcdef', bytes: 70, createdAt: '2026-09-29T00:00:00Z' }] } as CollaborationAttempt;
  const snapshot = { tasks: [{ ...task, id: 't1', title: '正文', dependsOnTaskIds: [], currentAttemptId: 'a1' }, task], attempts: [{ ...attempt, id: 'a1', taskId: 't1', artifacts: [] }, attempt], members: [{ id: 'editor', name: '编辑', avatar: '' }] } as CollaborationSnapshot;
  return { snapshot, task, attempt };
}
it('loads canonical timeline with empty projected tools and keeps internal thinking hidden', async () => {
  const api = vi.fn(async () => ({ totalSegments: 3, segments: [
    { id: 'thinking', sequence: 0, kind: 'thinking', text: 'PRIVATE REASONING CONTENT', status: 'completed' },
    { id: 'commentary', sequence: 1, kind: 'text', phase: 'commentary', text: '正在核对章节设定', status: 'completed' },
    { id: 'tool', sequence: 2, kind: 'tool', name: 'write_file', toolCallId: 'tool-1', argumentsJson: '{"path":"story.md"}', output: 'permission denied', status: 'failed' },
  ] }));
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: { listConversationRunTimeline: api } } });
  render(<CollaborationTaskTrace {...fixture()} onSelectTask={vi.fn()} />);
  await waitFor(() => expect(screen.getByText('write_file')).toBeTruthy());
  expect(api).toHaveBeenCalledWith({ runId: 'run-2', limit: 64 });
  expect(screen.queryByText('PRIVATE REASONING CONTENT')).toBeNull();
  expect(screen.getByText('正在核对章节设定')).toBeTruthy();
  expect(screen.getByLabelText('工具输入').textContent).toContain('story.md');
  expect(screen.getByLabelText('工具输出').textContent).toContain('permission denied');
  expect(screen.getByLabelText('轨迹时间轴').children).toHaveLength(3);
});
it('opens persisted document content and navigates the actual dependency graph', async () => {
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: {} } });
  const onSelectTask = vi.fn(); render(<CollaborationTaskTrace {...fixture()} onSelectTask={onSelectTask} />);
  fireEvent.click(screen.getByRole('button', { name: /首章修订版/ }));
  expect(screen.getByText('这是经过审校的正文。')).toBeTruthy();
  expect(screen.getByRole('button', { name: '下载 Markdown' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /1.*正文/ }));
  expect(onSelectTask).toHaveBeenCalledWith('t1');
  expect(screen.getByText('依赖：正文')).toBeTruthy();
});
it('ignores a delayed previous run response after selecting another task', async () => {
  let finish!: (value: object) => void;
  const api = vi.fn(({ runId }) => runId === 'run-2' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ totalSegments: 1, segments: [{ id: 'new', sequence: 0, kind: 'text', phase: 'commentary', text: '新任务轨迹', status: 'completed' }] }));
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: { listConversationRunTimeline: api } } });
  const f = fixture(); const view = render(<CollaborationTaskTrace {...f} onSelectTask={vi.fn()} />);
  await waitFor(() => expect(api).toHaveBeenCalled());
  view.rerender(<CollaborationTaskTrace {...f} attempt={{ ...f.attempt, runId: 'run-new' }} onSelectTask={vi.fn()} />);
  await screen.findByText('新任务轨迹');
  finish({ totalSegments: 1, segments: [{ id: 'old', sequence: 0, kind: 'text', phase: 'commentary', text: '过期轨迹', status: 'completed' }] });
  await waitFor(() => expect(screen.queryByText('过期轨迹')).toBeNull());
});


it('clears pending loading when selecting a stage without a run', async () => {
  const api = vi.fn(() => new Promise(() => {}));
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: { listConversationRunTimeline: api } } });
  const f = fixture();
  const view = render(<CollaborationTaskTrace {...f} onSelectTask={vi.fn()} />);
  await screen.findByText('正在读取运行轨迹…');
  view.rerender(<CollaborationTaskTrace {...f} attempt={{ ...f.attempt, status: 'queued', runId: undefined }} onSelectTask={vi.fn()} />);
  expect(screen.queryByText('正在读取运行轨迹…')).toBeNull();
  expect(screen.getByText('任务开始后，运行轨迹会出现在这里。')).toBeTruthy();
});

it('serializes live refresh with pagination and retains loaded events at completion', async () => {
  vi.useFakeTimers();
  const page = (index: number) => ({ totalSegments: 10, nextCursor: index < 9 ? String(index + 1) : undefined,
    segments: [{ id: `event-${index}`, sequence: index, kind: 'text', phase: 'commentary', text: `事件正文 ${index}`, status: 'completed' }] });
  let finishMore!: (value: object) => void;
  let deferMore = true;
  const api = vi.fn(({ cursor }) => {
    const index = Number(cursor ?? 0);
    if (index === 8 && deferMore) { deferMore = false; return new Promise(resolve => { finishMore = resolve; }); }
    return Promise.resolve(page(index));
  });
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: { listConversationRunTimeline: api } } });
  const f = fixture();
  const view = render(<CollaborationTaskTrace {...f} attempt={{ ...f.attempt, status: 'running' }} onSelectTask={vi.fn()} />);
  await act(async () => {});
  expect(api).toHaveBeenCalledTimes(8);
  fireEvent.click(screen.getByRole('button', { name: '加载更多事件' }));
  expect(api).toHaveBeenCalledTimes(9);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(api).toHaveBeenCalledTimes(9);
  await act(async () => { finishMore(page(8)); });
  expect(screen.getByText('事件正文 8')).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(screen.getByText('事件正文 8')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '加载更多事件' }));
  await act(async () => {});
  expect(screen.getByText('事件正文 9')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '加载更多事件' })).toBeNull();
  view.rerender(<CollaborationTaskTrace {...f} onSelectTask={vi.fn()} />);
  await act(async () => {});
  expect(screen.getByText('事件正文 9')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '加载更多事件' })).toBeNull();
});

it('shows the committed review edge and the exact artifact version despite a later producer retry', () => {
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: {} } });
  const f = fixture();
  const original = { ...f.attempt.artifacts![0], id: 'draft-1', taskId: 't1', attemptId: 'a1', title: '第一章初稿', content: '交给审校的第一版正文。', sha256: 'version-one-12345' };
  const later = { ...original, id: 'draft-2', attemptId: 'a3', content: '随后产生的重试版本。', sha256: 'version-two-67890' };
  const source = { ...f.snapshot.tasks[0], currentAttemptId: 'a3' };
  const task = { ...f.task, parentTaskId: 't1', purpose: 'coordination' as const, dependsOnTaskIds: [], handoff: { kind: 'review' as const, sourceTaskId: 't1', sourceAttemptId: 'a1', artifactIds: ['draft-1'] } };
  const snapshot = { ...f.snapshot, conversation: { id: 'conv-review', room: {} }, tasks: [source, task], attempts: [
    { ...f.attempt, id: 'a1', taskId: 't1', number: 1, artifacts: [original] },
    { ...f.attempt, id: 'a3', taskId: 't1', number: 2, artifacts: [later] }, f.attempt,
  ] } as CollaborationSnapshot;
  const onSelectTask = vi.fn();
  render(<CollaborationTaskTrace snapshot={snapshot} task={task} attempt={{ ...f.attempt, runId: undefined }} onSelectTask={onSelectTask} />);
  expect(screen.getByText('审核 · 来源：正文')).toBeTruthy();
  expect(screen.getByLabelText('交接关系')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '正文 · 第 1 次' }));
  expect(onSelectTask).toHaveBeenCalledWith('t1', 'a1');
  fireEvent.click(screen.getByRole('button', { name: /第一章初稿/ }));
  expect(screen.getByText('交给审校的第一版正文。')).toBeTruthy();
  expect(screen.getByText(/产物版本 version-on/)).toBeTruthy();
  expect(screen.queryByText('随后产生的重试版本。')).toBeNull();
});

it('does not replace a missing or failed handoff reference with another available draft', () => {
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: {} } });
  const f = fixture();
  const task = { ...f.task, handoff: { kind: 'report' as const, sourceTaskId: 't1', sourceAttemptId: 'missing', artifactIds: ['failed-draft', 'absent'] } };
  const snapshot = { ...f.snapshot, attempts: [...f.snapshot.attempts, { ...f.attempt, id: 'failed', status: 'failed' as const, artifacts: [{ ...f.attempt.artifacts![0], id: 'failed-draft', title: '未完成稿', content: '未完成正文' }] }] };
  render(<CollaborationTaskTrace snapshot={snapshot} task={task} attempt={{ ...f.attempt, runId: undefined }} onSelectTask={vi.fn()} />);
  expect(screen.getByText(/2 份引用产物尚未确认交付/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /未完成稿/ })).toBeNull();
});
