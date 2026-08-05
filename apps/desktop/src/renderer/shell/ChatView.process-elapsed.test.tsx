/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunProcessView } from '@sync-think/protocol';
import { AssistantProcessGroup, formatAssistantProcessElapsed } from './ChatView.js';

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
  it('updates once per second while the run is active', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T00:00:05.000Z'));

    render(
      <AssistantProcessGroup processView={processView()} streaming>
        <div>process body</div>
      </AssistantProcessGroup>,
    );

    expect(screen.getByRole('button').textContent).toContain('正在思考与执行… · 00:05');

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByRole('button').textContent).toContain('正在思考与执行… · 00:06');
  });

  it('freezes at the durable completion time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T00:00:20.000Z'));
    const completed = processView({
      running: false,
      completedAt: '2026-08-04T00:00:08.000Z',
      durationMs: 8_000,
    });

    render(
      <AssistantProcessGroup processView={completed} reasoningText="done">
        <div>process body</div>
      </AssistantProcessGroup>,
    );

    expect(screen.getByRole('button').textContent).toContain('思考与执行过程 · 00:08');
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByRole('button').textContent).toContain('思考与执行过程 · 00:08');
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
