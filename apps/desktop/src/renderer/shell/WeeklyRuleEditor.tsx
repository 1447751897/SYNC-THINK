import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown } from 'lucide-react';
import { TaskTemporalPicker } from './TaskTemporalPicker.js';
import type { TaskRuleWeekly } from '@sync-think/shared';
import {
  nextWeeklyRunAt,
  parseWeeklyRule,
  weeklyDays,
  weeklyRuleSummary,
  WEEKDAY_LABELS,
} from '@sync-think/shared/task-schedule';

function WeekdayPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange(day: number): void;
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="task-weekly__picker" aria-label={label}>
          <span>{WEEKDAY_LABELS[value - 1]}</span>
          <ChevronDown size={14} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="task-weekly__menu" sideOffset={5} collisionPadding={12}>
          <DropdownMenu.RadioGroup
            value={String(value)}
            onValueChange={(day) => onChange(Number(day))}
          >
            {WEEKDAY_LABELS.map((day, index) => (
              <DropdownMenu.RadioItem
                key={day}
                className="task-weekly__option"
                value={String(index + 1)}
              >
                {day}
                <DropdownMenu.ItemIndicator>
                  <Check size={14} />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Controlled editor: the complete selection is persisted, including range intent. */
export function WeeklyRuleEditor({
  rule,
  timeZone,
  onChange,
}: {
  rule: TaskRuleWeekly;
  timeZone: string;
  onChange(rule: TaskRuleWeekly): void;
}) {
  const selection = rule.selection;
  const days = weeklyDays(selection);
  const valid = parseWeeklyRule(rule);
  const [hour = '', minute = ''] = rule.time.split(':');
  let error = valid
    ? ''
    : days.length
      ? '请填写有效的时间（00:00–23:59）和生效日期（YYYY-MM-DD）。'
      : '请至少选择一个星期。';
  const next: string[] = [];
  if (valid) {
    try {
      let cursor = new Date();
      const format = new Intl.DateTimeFormat('zh-CN', {
        timeZone,
        month: 'numeric',
        day: 'numeric',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      });
      for (let i = 0; i < 3; i++) {
        const at = nextWeeklyRunAt(valid, timeZone, cursor);
        if (!at) break;
        cursor = new Date(at);
        next.push(format.format(cursor));
      }
    } catch {
      error = '时区无效，请在下方选择有效的任务时区。';
    }
  }
  const setTime = (part: 'hour' | 'minute', value: string) =>
    onChange({ ...rule, time: part === 'hour' ? `${value}:${minute}` : `${hour}:${value}` });
  return (
    <div className="task-weekly" data-testid="weekly-rule-editor">
      <div className="task-weekly__heading">
        <span>执行星期</span>
        <div className="task-weekly__modes" aria-label="星期选择方式">
          <button
            type="button"
            aria-pressed={selection.mode === 'days'}
            onClick={() => onChange({ ...rule, selection: { mode: 'days', days } })}
          >
            <span aria-hidden="true" />
            指定星期
          </button>
          <button
            type="button"
            aria-pressed={selection.mode === 'range'}
            onClick={() =>
              onChange({
                ...rule,
                selection: { mode: 'range', start: days[0] ?? 1, end: days.at(-1) ?? 5 },
              })
            }
          >
            <span aria-hidden="true" />
            连续范围
          </button>
        </div>
      </div>
      {selection.mode === 'days' ? (
        <div className="task-weekly__days" aria-label="执行星期">
          {WEEKDAY_LABELS.map((day, index) => (
            <button
              key={day}
              type="button"
              aria-pressed={days.includes(index + 1)}
              onClick={() =>
                onChange({
                  ...rule,
                  selection: {
                    mode: 'days',
                    days: days.includes(index + 1)
                      ? days.filter((value) => value !== index + 1)
                      : [...days, index + 1],
                  },
                })
              }
            >
              {day}
            </button>
          ))}
        </div>
      ) : (
        <div className="task-weekly__range">
          <div>
            <span className="task-weekly__label">从</span>
            <WeekdayPicker
              label="开始星期"
              value={selection.start}
              onChange={(start) => onChange({ ...rule, selection: { ...selection, start } })}
            />
          </div>
          <div>
            <span className="task-weekly__label">至（含当天）</span>
            <WeekdayPicker
              label="结束星期"
              value={selection.end}
              onChange={(end) => onChange({ ...rule, selection: { ...selection, end } })}
            />
          </div>
        </div>
      )}
      {selection.mode === 'range' && selection.start > selection.end ? (
        <p className="task-weekly__hint">
          跨周范围：{days.map((day) => WEEKDAY_LABELS[day - 1]).join('、')}，每天执行一次。
        </p>
      ) : null}
      <div className="task-weekly__fields">
        <div>
          <span className="task-weekly__label">执行时间</span>
          <div className="task-weekly__time">
            <input
              aria-label="开始时间：小时"
              inputMode="numeric"
              maxLength={2}
              value={hour}
              onChange={(event) => setTime('hour', event.target.value)}
              onBlur={() => {
                if (/^\d$/.test(hour)) setTime('hour', hour.padStart(2, '0'));
              }}
            />
            <span>:</span>
            <input
              aria-label="开始时间：分钟"
              inputMode="numeric"
              maxLength={2}
              value={minute}
              onChange={(event) => setTime('minute', event.target.value)}
              onBlur={() => {
                if (/^\d$/.test(minute)) setTime('minute', minute.padStart(2, '0'));
              }}
            />
            <TaskTemporalPicker
              type="time"
              value={/^\d{2}:\d{2}$/.test(rule.time) ? rule.time : ''}
              onChange={(time) => onChange({ ...rule, time })}
            />
          </div>
        </div>
        <div>
          <span className="task-weekly__label">开始日期</span>
          <div className="task-weekly__date-field">
            <input
              className="task-weekly__date"
              aria-label="每周任务生效日期"
              placeholder="YYYY-MM-DD"
              maxLength={10}
              value={rule.startDate}
              onChange={(event) => onChange({ ...rule, startDate: event.target.value })}
            />
            <TaskTemporalPicker
              type="date"
              value={/^\d{4}-\d{2}-\d{2}$/.test(rule.startDate) ? rule.startDate : ''}
              onChange={(startDate) => onChange({ ...rule, startDate })}
            />
          </div>
        </div>
      </div>
      <div className="task-weekly__preview">
        <div className="task-weekly__summary" aria-live="polite">
          <strong>{error ? '待完善执行规则' : weeklyRuleSummary(rule)}</strong>
          <span>每周 {days.length} 次</span>
        </div>
        <details>
          <summary>查看执行预览</summary>
          <div className="task-weekly__week" aria-label="一周执行分布">
            {WEEKDAY_LABELS.map((day, index) => (
              <div key={day} data-active={days.includes(index + 1)}>
                <span>{day}</span>
                <strong>{days.includes(index + 1) && !error ? rule.time : '—'}</strong>
              </div>
            ))}
          </div>
          {!error ? (
            <div className="task-weekly__next">
              <span>接下来 3 次</span>
              <ol>
                {next.map((at) => (
                  <li key={at}>{at}</li>
                ))}
              </ol>
            </div>
          ) : null}
        </details>
        {error ? (
          <p className="task-weekly__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
