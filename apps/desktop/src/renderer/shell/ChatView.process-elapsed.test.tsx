/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommentaryTimelineSegment, RunProcessView } from '@sync-think/protocol';
import {
  AssistantProcessGroup,
  formatAssistantProcessElapsed,
  RunTaskCapsule,
} from './ChatView.js';

function processView(overrides: Partial<RunProcessView> = {}): RunProcessView {
  return {
    runId: 'run-elapsed',
    steps: [],
    fileChanges: [],
    running: true,
    doneCount: 0,
    errorCount: 0,
    startedAt: '2026-08-04T00:00:00.000Z',
    ...overrides,
  } as RunProcessView;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('AssistantProcessGroup elapsed clock', () => {
  const segment = (text: string): CommentaryTimelineSegment => ({
    id: 'commentary-live',
    text,
    startedAt: '2026-08-04T00:00:01.000Z',
    afterSequence: 0,
  });

  it('updates once per second while the run is active', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T00:00:05.000Z'));

    render(
      <AssistantProcessGroup processView={processView()} streaming>
        <div>process body</div>
      </AssistantProcessGroup>,
    );

    const toggle = screen.getByRole('button');
    expect(toggle.textContent).toContain('过程 · 5秒');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('process body')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByRole('button').textContent).toContain('过程 · 6秒');
  });

  it('freezes a paused run at its durable terminal time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T00:00:20.000Z'));
    const paused = processView({
      running: false,
      completedAt: '2026-08-04T00:00:08.000Z',
      durationMs: 8_000,
    });

    render(
      <AssistantProcessGroup processView={paused} commentaryText="备用模型已耗尽，任务暂停。">
        <div>process body</div>
      </AssistantProcessGroup>,
    );

    expect(screen.getByRole('button').textContent).toContain('过程 · 8秒');
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByRole('button').textContent).toContain('过程 · 8秒');
  });

  it('supports a deterministic initially expanded fixture without changing later user state', () => {
    const completed = processView({
      running: false,
      completedAt: '2026-08-04T00:00:08.000Z',
      durationMs: 8_000,
    });
    const { rerender } = render(
      <AssistantProcessGroup processView={completed} defaultOpen>
        <div>process body</div>
      </AssistantProcessGroup>,
    );

    const toggle = screen.getByRole('button');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('process body')).toBeTruthy();

    act(() => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    rerender(
      <AssistantProcessGroup processView={completed} defaultOpen>
        <div>process body</div>
      </AssistantProcessGroup>,
    );
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
  });

  it('formats minute and hour durations as readable Chinese text', () => {
    expect(
      formatAssistantProcessElapsed(
        processView({
          running: false,
          startedAt: undefined,
          durationMs: 93_000,
        }),
        false,
      ),
    ).toBe('1分33秒');
    expect(
      formatAssistantProcessElapsed(
        processView({
          running: false,
          startedAt: undefined,
          durationMs: 3_723_000,
        }),
        false,
      ),
    ).toBe('1小时2分3秒');
  });

  it('expands and collapses the complete process from one compact row', () => {
    const completed = processView({
      running: false,
      completedAt: '2026-08-04T00:00:08.000Z',
      durationMs: 8_000,
    });

    render(
      <AssistantProcessGroup processView={completed}>
        <div>process body</div>
      </AssistantProcessGroup>,
    );

    const toggle = screen.getByRole('button');
    expect(toggle.textContent).toBe('过程 · 8秒');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('process body')).toBeNull();

    act(() => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('process body')).toBeTruthy();

    act(() => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('process body')).toBeNull();
  });

  it('auto-expands while thinking and folds when the final answer starts', () => {
    const { rerender } = render(
      <AssistantProcessGroup
        processView={processView({
          running: false,
          completedAt: '2026-08-04T00:00:08.000Z',
          durationMs: 8_000,
        })}
      >
        <div>process body</div>
      </AssistantProcessGroup>,
    );

    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
    rerender(
      <AssistantProcessGroup processView={processView()} streaming>
        <div>process body</div>
      </AssistantProcessGroup>,
    );
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('process body')).toBeTruthy();

    rerender(
      <AssistantProcessGroup processView={processView()} streaming answerStarted>
        <div>process body</div>
      </AssistantProcessGroup>,
    );
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('process body')).toBeNull();
  });

  it('preserves a manual fold while the active process keeps updating', () => {
    const { rerender } = render(
      <AssistantProcessGroup processView={processView()} streaming>
        <div>process body</div>
      </AssistantProcessGroup>,
    );

    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');
    act(() => screen.getByRole('button').click());
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');

    rerender(
      <AssistantProcessGroup
        processView={processView({ doneCount: 1, steps: [] })}
        commentaryText="继续分析。"
        streaming
      >
        <div>process body updated</div>
      </AssistantProcessGroup>,
    );
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('process body updated')).toBeNull();
  });

  it('follows appended commentary, pauses on upward user scroll, and resumes at the bottom', () => {
    const { container, rerender } = render(
      <AssistantProcessGroup
        processView={processView()}
        commentarySegments={[segment('first')]}
        streaming
        defaultOpen
      >
        <div>process body</div>
      </AssistantProcessGroup>,
    );
    const body = container.querySelector('.shell-process-group__body') as HTMLDivElement;
    let scrollHeight = 200;
    const clientHeight = 100;
    let scrollTop = 100;
    Object.defineProperties(body, {
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, get: () => clientHeight },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value;
        },
      },
    });

    fireEvent.scroll(body);
    scrollHeight = 400;
    fireEvent.scroll(body);
    rerender(
      <AssistantProcessGroup
        processView={processView()}
        commentarySegments={[segment('first plus appended commentary')]}
        streaming
        defaultOpen
      >
        <div>process body</div>
      </AssistantProcessGroup>,
    );
    expect(scrollTop).toBe(400);

    fireEvent.wheel(body, { deltaY: -120 });
    scrollTop = 120;
    scrollHeight = 500;
    rerender(
      <AssistantProcessGroup
        processView={processView()}
        commentarySegments={[segment('first plus appended commentary while reading history')]}
        streaming
        defaultOpen
      >
        <div>process body</div>
      </AssistantProcessGroup>,
    );
    expect(scrollTop).toBe(120);

    scrollTop = 400;
    fireEvent.scroll(body);
    scrollHeight = 600;
    rerender(
      <AssistantProcessGroup
        processView={processView()}
        commentarySegments={[
          segment('first plus appended commentary after returning to the bottom'),
        ]}
        streaming
        defaultOpen
      >
        <div>process body</div>
      </AssistantProcessGroup>,
    );
    expect(scrollTop).toBe(600);
  });

  it('omits an invalid clock instead of rendering a bogus value', () => {
    expect(
      formatAssistantProcessElapsed(
        processView({ startedAt: 'not-a-timestamp' }),
        true,
        Date.parse('2026-08-04T00:00:05.000Z'),
      ),
    ).toBeUndefined();
    expect(
      formatAssistantProcessElapsed(
        processView({ running: false, startedAt: undefined, durationMs: Number.NaN }),
        false,
      ),
    ).toBeUndefined();
  });
});

describe('RunTaskCapsule checklist projection', () => {
  const toolStep: RunProcessView['steps'][number] = {
    id: 'call-read',
    label: 'Read · README.md',
    verb: 'Read',
    zh: '读取文件',
    toolName: 'read_file',
    kind: 'read',
    status: 'done',
  };

  it('does not render a checklist when a run only has tool steps', () => {
    render(<RunTaskCapsule view={processView({ steps: [toolStep] })} />);

    expect(screen.queryByTestId('run-task-capsule')).toBeNull();
  });

  it('renders authored task items without exposing tool-call labels', () => {
    render(
      <RunTaskCapsule
        view={processView({
          steps: [toolStep],
          taskPlan: {
            items: [{ title: '检查项目', status: 'in_progress' }],
            completed: 0,
            total: 1,
          },
        })}
      />,
    );

    expect(screen.getByTestId('run-task-capsule').getAttribute('data-mode')).toBe('plan');
    expect(screen.getByText('检查项目')).toBeTruthy();
    expect(screen.queryByText('读取文件 · README.md')).toBeNull();
  });
});
