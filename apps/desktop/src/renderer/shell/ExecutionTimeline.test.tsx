/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  CommentaryTimelineSegment,
  ExecutionProcessStep,
  RunProcessView,
} from '@sync-think/protocol';
import { buildExecutionTimeline, ExecutionTimeline } from './ExecutionTimeline.js';

function step(overrides: Partial<ExecutionProcessStep> = {}): ExecutionProcessStep {
  return {
    id: 'tool-1',
    label: '读取文件',
    verb: 'Read',
    zh: '读取文件',
    toolName: 'read_file',
    kind: 'read',
    status: 'done',
    path: 'src/main.ts',
    sequence: 11,
    startedAt: '2026-08-08T01:02:04.000Z',
    completedAt: '2026-08-08T01:02:05.000Z',
    ...overrides,
  };
}

function processView(steps: ExecutionProcessStep[]): RunProcessView {
  return {
    runId: 'run-timeline',
    steps,
    fileChanges: [],
    running: false,
    doneCount: steps.filter((item) => item.status === 'done').length,
    errorCount: steps.filter((item) => item.status === 'error').length,
  } as unknown as RunProcessView;
}

function commentary(
  id: string,
  text: string,
  afterSequence: number,
  startedAt: string,
): CommentaryTimelineSegment {
  return { id, text, afterSequence, startedAt };
}

afterEach(cleanup);

describe('ExecutionTimeline', () => {
  it('mixes commentary and tools in their actual durable-boundary order', () => {
    const timeline = buildExecutionTimeline({
      commentarySegments: [
        commentary('commentary-before', '先读取关键文件。', 10, '2026-08-08T01:02:03.000Z'),
        commentary('commentary-after', '根据结果继续分析。', 13, '2026-08-08T01:02:07.000Z'),
      ],
      steps: [
        step(),
        step({
          id: 'tool-2',
          zh: '搜索代码',
          toolName: 'search_files',
          kind: 'search',
          path: 'apps/desktop/src',
          sequence: 12,
          startedAt: '2026-08-08T01:02:05.000Z',
          completedAt: '2026-08-08T01:02:06.000Z',
        }),
        step({
          id: 'tool-3',
          zh: '运行测试',
          toolName: 'run_command',
          kind: 'bash',
          path: undefined,
          command: 'pnpm test',
          sequence: 14,
          startedAt: '2026-08-08T01:02:08.000Z',
          completedAt: '2026-08-08T01:02:09.000Z',
        }),
      ],
    });

    expect(timeline.map((item) => `${item.type}:${item.id}`)).toEqual([
      'commentary:commentary-before',
      'tools:tools:tool-1:tool-2',
      'commentary:commentary-after',
      'tools:tools:tool-3',
    ]);
    expect(timeline[1]).toMatchObject({
      type: 'tools',
      steps: [{ id: 'tool-1' }, { id: 'tool-2' }],
    });
  });

  it('folds adjacent tools into one group and keeps every tool independently expandable', () => {
    render(
      <ExecutionTimeline
        commentarySegments={[
          commentary('commentary-before', '先读取关键文件。', 10, '2026-08-08T01:02:03.000Z'),
        ]}
        processView={processView([
          step({ preview: 'first output' }),
          step({
            id: 'tool-2',
            zh: '搜索代码',
            toolName: 'search_files',
            kind: 'search',
            path: 'apps/desktop/src',
            sequence: 12,
            startedAt: '2026-08-08T01:02:05.000Z',
            completedAt: '2026-08-08T01:02:06.000Z',
            preview: 'second output',
          }),
        ])}
      />,
    );

    expect(screen.getByText('先读取关键文件。')).toBeTruthy();
    expect(screen.queryByText('01:02:03')).toBeNull();
    expect(screen.queryByText('01:02:04')).toBeNull();
    const groupToggle = screen.getByRole('button', { name: /调用了 2 个工具/ });
    expect(groupToggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('读取文件 · src/main.ts')).toBeNull();

    fireEvent.click(groupToggle);

    expect(groupToggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByText('01:02:05')).toBeNull();
    const firstTool = screen.getByRole('button', { name: /读取文件 · src\/main\.ts/ });
    const secondTool = screen.getByRole('button', { name: /搜索代码 · apps\/desktop\/src/ });
    expect(firstTool.getAttribute('aria-expanded')).toBe('false');
    expect(secondTool.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(firstTool);

    expect(firstTool.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('first output')).toBeTruthy();
    expect(secondTool.getAttribute('aria-expanded')).toBe('false');
  });

  it('renders tools alone when the provider did not return commentary', () => {
    render(<ExecutionTimeline processView={processView([step()])} />);

    expect(screen.getByRole('button', { name: /调用了 1 个工具/ })).toBeTruthy();
    expect(screen.queryByTestId('execution-commentary-item')).toBeNull();
  });

  it('renders assistant commentary as markdown instead of raw markers', () => {
    render(
      <ExecutionTimeline
        commentarySegments={[
          commentary('commentary-markdown', '**正在检查项目结构**', 10, '2026-08-08T01:02:03.000Z'),
        ]}
      />,
    );

    expect(screen.getByText('正在检查项目结构').tagName).toBe('STRONG');
    expect(screen.queryByText('**正在检查项目结构**')).toBeNull();
  });

  it('keeps aggregate commentary visible when no segments were persisted', () => {
    const timeline = buildExecutionTimeline({
      commentaryText: '旧任务的聚合执行说明。',
      steps: [step()],
    });

    expect(timeline[0]).toMatchObject({
      type: 'commentary',
      text: '旧任务的聚合执行说明。',
    });
  });

  it('uses timestamps when legacy tool steps do not have durable sequence metadata', () => {
    const timeline = buildExecutionTimeline({
      commentarySegments: [
        commentary('commentary-before', '先分析。', 10, '2026-08-08T01:02:03.000Z'),
        commentary('commentary-after', '再验证。', 12, '2026-08-08T01:02:06.000Z'),
      ],
      steps: [
        step({
          sequence: undefined,
          startedAt: '2026-08-08T01:02:04.000Z',
        }),
      ],
    });

    expect(timeline.map((item) => `${item.type}:${item.id}`)).toEqual([
      'commentary:commentary-before',
      'tools:tools:tool-1',
      'commentary:commentary-after',
    ]);
  });
});
