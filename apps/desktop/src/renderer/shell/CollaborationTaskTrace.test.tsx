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
