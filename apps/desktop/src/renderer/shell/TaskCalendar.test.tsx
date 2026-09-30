/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ScheduledTask } from '@sync-think/shared';
import { calendarTaskPalette, TaskCalendar, type TaskCalendarProps } from './TaskCalendar.js';

const now = new Date(2026, 8, 30, 10, 30).getTime();
function task(id = 'one', at = new Date(2026, 8, 30, 14)): ScheduledTask {
  return {
    id,
    name: `任务 ${id}`,
    instruction: '检查项目',
    target: { kind: 'model', modelId: 'model-1' },
    rule: { kind: 'at', runAt: at.toISOString() },
    timeZone: 'UTC',
    enabled: true,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  };
}
function props(overrides: Partial<TaskCalendarProps> = {}): TaskCalendarProps {
  return {
    tasks: [],
    allTasks: [],
    workspaces: [],
    scopes: ['all'],
    targets: new Set(['agent', 'model', 'team']),
    onScopesChange: vi.fn(),
    onTargetToggle: vi.fn(),
    statusFilters: <button>启用中</button>,
    activeFilterCount: 0,
    onResetFilters: vi.fn(),
    listContent: <p>任务管理列表</p>,
    loading: false,
    now,
    onPick: vi.fn(),
    onEdit: vi.fn(),
    onHistory: vi.fn(),
    onRun: vi.fn(),
    taskContext: () => ({ target: '测试模型', rule: '单次计划', workspace: '全局' }),
    onCreate: vi.fn(),
    onCreateTask: vi.fn(),
    onRefresh: vi.fn(),
    ...overrides,
  };
}
afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).syncThink;
});

describe('Board-style task calendar', () => {
  it('shows missing hourly slots with an honest projection notice rather than success', async () => {
    const hourly = {
      ...task('hourly'),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      createdAt: new Date(2026, 8, 30, 11, 42).toISOString(),
      rule: {
        kind: 'every' as const,
        intervalMinutes: 60,
        windowStart: '12:00',
        windowEnd: '18:00',
      },
      nextRunAt: new Date(2026, 8, 30, 15).toISOString(),
      lastResult: {
        status: 'success' as const,
        firedAt: new Date(2026, 8, 30, 12, 0, 0, 101).toISOString(),
      },
    };
    render(
      <TaskCalendar
        {...props({
          tasks: [hourly],
          allTasks: [hourly],
          now: new Date(2026, 8, 30, 14, 10).getTime(),
        })}
      />,
    );
    const missing = await screen.findByRole('button', {
      name: '2026-09-30 13:00 任务 hourly 无执行记录',
    });
    expect(
      screen.getByRole('button', { name: '2026-09-30 14:00 任务 hourly 无执行记录' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: '2026-09-30 12:00 任务 hourly 已完成' }),
    ).toBeTruthy();
    fireEvent.click(missing);
    expect(await screen.findByText(/此时间点按当前规则推算/)).toBeTruthy();
  });

  it('opens the rounded month layout with optional filters and a single date heading', () => {
    render(<TaskCalendar {...props()} />);
    expect(screen.getByRole('heading', { name: '2026年9月' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '月' }).getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelectorAll('.task-cal__month-cell')).toHaveLength(35);
    expect(screen.queryByTestId('task-sidebar')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    expect(screen.getByTestId('task-sidebar')).toBeTruthy();
    expect(screen.getByRole('button', { name: '筛选' }).getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    expect(screen.queryByTestId('task-sidebar')).toBeNull();
  });

  it('distinguishes a truly empty schedule from filtered-out tasks, with useful actions', () => {
    const input = props();
    const result = render(<TaskCalendar {...input} />);
    expect(screen.getByText('还没有定时任务')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '创建第一个任务' }));
    expect(input.onCreateTask).toHaveBeenCalledOnce();
    result.rerender(<TaskCalendar {...input} allTasks={[task()]} />);
    expect(screen.queryByText('还没有定时任务')).toBeNull();
    expect(screen.getByText('没有符合筛选条件的任务')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(input.onResetFilters).toHaveBeenCalledOnce();
  });

  it('never reports an empty collection while loading or after a service error', () => {
    const input = props({ loading: true });
    const result = render(<TaskCalendar {...input} />);
    expect(screen.queryByTestId('task-empty')).toBeNull();
    expect(screen.getByTestId('task-create')).toBeTruthy();
    expect(screen.getByRole('button', { name: '刷新任务' }).hasAttribute('disabled')).toBe(true);
    result.rerender(<TaskCalendar {...input} loading={false} loadError="连接断开" />);
    expect(screen.queryByTestId('task-empty')).toBeNull();
    expect(screen.getByText('任务加载失败，请重试')).toBeTruthy();
  });

  it('distinguishes an empty date range from an empty task collection', () => {
    const future = task('future', new Date(2027, 0, 8, 9));
    render(<TaskCalendar {...props({ tasks: [future], allTasks: [future] })} />);
    expect(screen.queryByTestId('task-empty')).toBeNull();
    expect(screen.getByText('这段时间没有日程，其他任务仍在列表中。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '查看任务列表' }));
    expect(screen.getByText('任务管理列表')).toBeTruthy();
  });

  it('opens an anchored occurrence card before navigating to complete task details', () => {
    const sample = task();
    const input = props({ tasks: [sample], allTasks: [sample] });
    render(<TaskCalendar {...input} />);
    const event = screen.getByRole('button', { name: /2026-09-30 14:00 任务 one 计划/ });
    expect(event.classList.contains('is-compact')).toBe(true);
    expect(event.querySelector('time')?.textContent).toBe('14:00');
    fireEvent.click(event);
    expect(input.onPick).not.toHaveBeenCalled();
    const details = screen.getByRole('dialog', { name: '日程详情' });
    expect(within(details).getByRole('heading', { name: sample.name })).toBeTruthy();
    expect(within(details).getByText('检查项目')).toBeTruthy();
    expect(event.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(within(details).getByRole('button', { name: '完整详情' }));
    expect(input.onPick).toHaveBeenCalledWith(sample);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('expands dense dates into the same day view without losing any events', () => {
    const samples = Array.from({ length: 5 }, (_, index) =>
      task(String(index), new Date(2026, 8, 30, 12 + index)),
    );
    render(<TaskCalendar {...props({ tasks: samples, allTasks: samples })} />);
    const cell = document.querySelector('[data-date="2026-09-30"]') as HTMLElement;
    expect(cell.querySelectorAll('.task-cal__event')).toHaveLength(3);
    const more = within(cell).getByRole('button', { name: '查看 2026-09-30 的全部 5 项日程' });
    fireEvent.click(more);
    expect(screen.getByRole('button', { name: '日' }).getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelectorAll('.task-cal__event')).toHaveLength(5);
  });

  it('creates a task on the exact selected date at 09:00, with no inherited seconds', () => {
    const input = props({ now: new Date(2026, 8, 30, 10, 30, 47, 500).getTime() });
    render(<TaskCalendar {...input} />);
    fireEvent.click(screen.getByRole('button', { name: /^在 2026-09-30 新建任务$/ }));
    expect(input.onCreate).toHaveBeenCalledWith(new Date(2026, 8, 30, 9, 0, 0, 0));
  });

  it('keeps month navigation and Today in sync with the date grid', () => {
    render(<TaskCalendar {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: '下一时段' }));
    expect(screen.getByRole('heading', { name: '2026年10月' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '上一时段' }));
    expect(screen.getByRole('heading', { name: '2026年9月' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '上一时段' }));
    fireEvent.click(screen.getByRole('button', { name: '今天' }));
    expect(screen.getByRole('heading', { name: '2026年9月' })).toBeTruthy();
  });

  it('initially focuses the current hour in week view but never resets manual scroll on refresh', () => {
    const input = props();
    const result = render(<TaskCalendar {...input} />);
    fireEvent.click(screen.getByRole('button', { name: '周' }));
    const scroll = screen.getByTestId('task-calendar-scroll');
    expect(scroll.scrollTop).toBe(570);
    scroll.scrollTop = 123;
    result.rerender(<TaskCalendar {...input} now={now + 60_000} tasks={[task()]} />);
    expect(scroll.scrollTop).toBe(123);
  });

  it('ignores stale history responses after switching tasks and resets the loading state', async () => {
    let resolveHistory!: (value: { entries: [] }) => void;
    (window as unknown as Record<string, unknown>).syncThink = {
      runtime: {
        scheduledTaskHistory: vi.fn(
          () =>
            new Promise((resolve) => {
              resolveHistory = resolve;
            }),
        ),
      },
    };
    const past = { ...task(), lastRunAt: new Date(now - 60_000).toISOString() };
    const input = props({ tasks: [past], allTasks: [past] });
    const result = render(<TaskCalendar {...input} />);
    expect(screen.getByText('正在加载运行记录…')).toBeTruthy();
    result.rerender(<TaskCalendar {...input} tasks={[]} allTasks={[]} />);
    expect(screen.getByText('还没有定时任务')).toBeTruthy();
    resolveHistory({ entries: [] });
    await waitFor(() => expect(screen.queryByText('正在加载运行记录…')).toBeNull());
  });
  it('opens a Monday-first date picker from the month title and jumps across years', () => {
    render(<TaskCalendar {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: '选择日期，当前 2026年9月' }));
    const picker = screen.getByRole('dialog', { name: '跳转日期' });
    expect(
      within(picker)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['周一', '周二', '周三', '周四', '周五', '周六', '周日']);
    expect(
      within(picker)
        .getByRole('button', { name: '2026年9月30日星期三' })
        .getAttribute('data-selected'),
    ).toBe('true');
    for (let i = 0; i < 4; i++)
      fireEvent.click(within(picker).getByRole('button', { name: '日期选择器下个月' }));
    expect(within(picker).getByRole('grid', { name: '2027年1月' })).toBeTruthy();
    fireEvent.click(within(picker).getByRole('button', { name: '2027年1月6日星期三' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('heading', { name: '2027年1月' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '日' }));
    expect(screen.getByRole('heading', { name: '2027年1月6日' })).toBeTruthy();
  });

  it('preserves the chosen view when selecting a date and synchronizes the mini calendar', () => {
    render(<TaskCalendar {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: '周' }));
    fireEvent.click(screen.getByRole('button', { name: /^选择日期/ }));
    const picker = screen.getByRole('dialog', { name: '跳转日期' });
    fireEvent.click(within(picker).getByRole('button', { name: '2026年9月8日星期二' }));
    expect(screen.getByRole('button', { name: '周' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('heading', { name: '2026年9月6日 — 9月12日' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    expect(
      within(screen.getByTestId('task-sidebar'))
        .getByRole('button', { name: '2026-09-08' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('supports keyboard date movement across a month boundary and returns focus on Escape', async () => {
    render(<TaskCalendar {...props()} />);
    const trigger = screen.getByRole('button', { name: /^选择日期/ });
    fireEvent.click(trigger);
    const picker = screen.getByRole('dialog', { name: '跳转日期' });
    const date = within(picker).getByRole('button', { name: '2026年9月30日星期三' });
    fireEvent.keyDown(date, { key: 'ArrowRight' });
    const next = within(picker).getByRole('button', { name: '2026年10月1日星期四' });
    await waitFor(() => expect(document.activeElement).toBe(next));
    expect(next.tabIndex).toBe(0);
    fireEvent.keyDown(next, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it.each(['onEdit', 'onHistory', 'onRun'] as const)(
    'routes the %s action to the selected real task and closes the card',
    (action) => {
      const sample = task();
      const input = props({ tasks: [sample], allTasks: [sample] });
      render(<TaskCalendar {...input} />);
      fireEvent.click(screen.getByRole('button', { name: /14:00 任务 one 计划/ }));
      const labels = { onEdit: '编辑任务', onHistory: '运行记录', onRun: '立即执行' };
      fireEvent.click(
        within(screen.getByRole('dialog', { name: '日程详情' })).getByRole('button', {
          name: labels[action],
        }),
      );
      expect(input[action]).toHaveBeenCalledWith(sample);
      expect(input.onPick).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).toBeNull();
    },
  );

  it('allows only one calendar popover, clears selection on view/filter changes, and updates real task metadata', () => {
    const sample = task();
    const input = props({ tasks: [sample], allTasks: [sample] });
    const result = render(<TaskCalendar {...input} />);
    const event = screen.getByRole('button', { name: /14:00 任务 one 计划/ });
    fireEvent.click(event);
    const renamed = { ...sample, name: '已重命名', instruction: '最新执行指令' };
    result.rerender(<TaskCalendar {...input} tasks={[renamed]} allTasks={[renamed]} />);
    expect(
      within(screen.getByRole('dialog', { name: '日程详情' })).getByText('最新执行指令'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^选择日期/ }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: '跳转日期' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '周' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /14:00 已重命名 计划/ }));
    result.rerender(<TaskCalendar {...input} tasks={[]} allTasks={[renamed]} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('uses the reference palette consistently across views and disables duplicate manual execution', () => {
    const sample = task();
    render(
      <TaskCalendar {...props({ tasks: [sample], allTasks: [sample], busyTaskId: sample.id })} />,
    );
    const event = screen.getByRole('button', { name: /14:00 任务 one 计划/ });
    expect(event.getAttribute('data-palette')).toBe(calendarTaskPalette(sample.id));
    fireEvent.click(event);
    expect(
      within(screen.getByRole('dialog', { name: '日程详情' }))
        .getByRole('button', { name: '立即执行' })
        .hasAttribute('disabled'),
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '日' }));
    expect(
      screen.getByRole('button', { name: /14:00 任务 one 计划/ }).getAttribute('data-palette'),
    ).toBe(calendarTaskPalette(sample.id));
  });
  it('distributes all five reference colors without depending on names, order or execution status', () => {
    expect(
      new Set(Array.from({ length: 30 }, (_, i) => calendarTaskPalette('task-' + i))).size,
    ).toBe(5);
    const sample = task();
    const result = render(<TaskCalendar {...props({ tasks: [sample], allTasks: [sample] })} />);
    const palette = screen
      .getByRole('button', { name: /14:00 任务 one 计划/ })
      .getAttribute('data-palette');
    result.rerender(
      <TaskCalendar {...props({ tasks: [{ ...sample, name: '换个名称' }], allTasks: [sample] })} />,
    );
    expect(
      screen.getByRole('button', { name: /14:00 换个名称 计划/ }).getAttribute('data-palette'),
    ).toBe(palette);
  });
  it('focuses the selected date immediately on opening the picker and dismisses on outside focus', async () => {
    render(<TaskCalendar {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: /^选择日期/ }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: '2026年9月30日星期三' }),
      ),
    );
    const outside = screen.getByRole('button', { name: '今天' });
    outside.focus();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(outside);
  });
});
