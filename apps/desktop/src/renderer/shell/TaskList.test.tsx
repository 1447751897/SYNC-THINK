/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskList, TaskResourceChip, type TaskListTask } from './TaskList.js';
import { InlineProcessFlow } from './InlineProcessFlow.js';

const tasks: readonly TaskListTask[] = [
  {
    id: 'read',
    title: 'Found project files',
    runningTitle: 'Searching project files',
    steps: [{ label: 'Read', chips: [{ label: 'page.tsx' }] }, { label: 'Scanning 52 files' }],
  },
  {
    id: 'write',
    title: 'Registered the theme toggle',
    runningTitle: 'Registering the theme toggle',
    steps: [{ label: 'Created', chips: [{ label: 'theme-toggle.tsx' }] }],
  },
];
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('TaskList reference behavior', () => {
  it('reveals one header and one step per unit and uses running titles', () => {
    const { rerender } = render(<TaskList tasks={tasks} revealed={0} />);
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<TaskList tasks={tasks} revealed={1} />);
    expect(
      screen.getByRole('button', { name: 'Searching project files' }).getAttribute('aria-expanded'),
    ).toBe('true');
    expect(screen.queryByText('Read')).toBeNull();
    rerender(<TaskList tasks={tasks} revealed={2} />);
    expect(screen.getByText('page.tsx')).toBeTruthy();
    expect(screen.queryByText('Scanning 52 files')).toBeNull();
    rerender(<TaskList tasks={tasks} revealed={3} />);
    expect(screen.getByRole('button', { name: 'Found project files' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Registering the theme toggle' })).toBeNull();
    rerender(<TaskList tasks={tasks} revealed={4} />);
    expect(screen.getByRole('button', { name: 'Registering the theme toggle' })).toBeTruthy();
  });
  it('paces the timer and fires completion only after every unit lands', () => {
    vi.useFakeTimers();
    const done = vi.fn();
    render(<TaskList tasks={tasks} startDelay={320} stepInterval={850} onComplete={done} />);
    act(() => vi.advanceTimersByTime(319));
    expect(screen.queryByRole('button')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('button', { name: 'Searching project files' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(850 * 3));
    expect(done).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(850));
    expect(done).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(850 * 5));
    expect(done).toHaveBeenCalledTimes(1);
  });
  it('turns its timer off in controlled mode and clamps the unit count', () => {
    vi.useFakeTimers();
    const done = vi.fn();
    const { rerender } = render(<TaskList tasks={tasks} revealed={-1} onComplete={done} />);
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<TaskList tasks={tasks} revealed={1.9} onComplete={done} />);
    expect(screen.queryByText('page.tsx')).toBeNull();
    rerender(<TaskList tasks={tasks} revealed={100} onComplete={done} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(done).toHaveBeenCalledTimes(1);
    rerender(<TaskList tasks={tasks} revealed={200} onComplete={done} />);
    expect(done).toHaveBeenCalledTimes(1);
  });
  it('folds each finished task and lets the reader reopen it', () => {
    const { rerender } = render(<TaskList tasks={tasks} revealed={2} collapseOnComplete />);
    expect(screen.getByText('page.tsx')).toBeTruthy();
    rerender(<TaskList tasks={tasks} revealed={3} collapseOnComplete />);
    expect(screen.queryByText('page.tsx')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Found project files' }));
    expect(screen.getByText('page.tsx')).toBeTruthy();
    rerender(<TaskList tasks={tasks} revealed={5} collapseOnComplete />);
    expect(screen.getByText('page.tsx')).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: 'Registered the theme toggle' })
        .getAttribute('aria-expanded'),
    ).toBe('false');
  });
  it('holds all tasks open until the whole run ends in all-collapse mode', () => {
    const { rerender } = render(<TaskList tasks={tasks} revealed={4} collapseOnComplete="all" />);
    expect(
      screen.getByRole('button', { name: 'Found project files' }).getAttribute('aria-expanded'),
    ).toBe('true');
    rerender(<TaskList tasks={tasks} revealed={5} collapseOnComplete="all" />);
    for (const button of screen.getAllByRole('button'))
      expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('theme-toggle.tsx')).toBeNull();
  });
  it('preserves a manual disclosure choice during a running task', () => {
    const { rerender } = render(<TaskList tasks={tasks} revealed={1} />);
    fireEvent.click(screen.getByRole('button', { name: 'Searching project files' }));
    rerender(<TaskList tasks={tasks} revealed={2} />);
    expect(screen.queryByText('page.tsx')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Searching project files' }).getAttribute('aria-controls'),
    ).toBeTruthy();
  });
  it('cancels timers on unmount', () => {
    vi.useFakeTimers();
    const done = vi.fn();
    const { unmount } = render(<TaskList tasks={tasks} onComplete={done} />);
    unmount();
    act(() => vi.advanceTimersByTime(20000));
    expect(done).not.toHaveBeenCalled();
  });
  it('opens resources with mouse and keyboard without toggling the parent', () => {
    const open = vi.fn(),
      toggle = vi.fn();
    const path = 'D:/project/app/page.tsx';
    render(
      <div onClick={toggle}>
        <TaskResourceChip label="page.tsx" path={path} onOpen={open} />
      </div>,
    );
    const chip = screen.getByRole('link');
    fireEvent.click(chip);
    fireEvent.keyDown(chip, { key: 'Enter' });
    fireEvent.keyDown(chip, { key: ' ' });
    expect(open.mock.calls).toEqual([[path], [path], [path]]);
    expect(toggle).not.toHaveBeenCalled();
    expect(chip.getAttribute('title')).toBe(path);
  });
  it('uses the same task sections and resource chips in the real execution component', () => {
    render(
      <InlineProcessFlow
        defaultOpen
        items={[
          {
            kind: 'tool',
            toolCallId: 'a',
            name: 'read_file',
            argumentsJson: '{"path":"app/page.tsx"}',
            result: 'one',
            status: 'completed',
          },
          {
            kind: 'tool',
            toolCallId: 'b',
            name: 'read_file',
            argumentsJson: '{"path":"app/layout.tsx"}',
            result: 'two',
            status: 'completed',
          },
        ]}
      />,
    );
    const group = screen.getByTestId('process-action-summary');
    expect(group.classList.contains('shell-task-log')).toBe(true);
    expect(within(group).getAllByTestId('process-entry')).toHaveLength(2);
    expect(group.querySelectorAll('.shell-task-log__branch')).toHaveLength(2);
    expect(group.querySelectorAll('.shell-task-log__chip')).toHaveLength(2);
  });
});
