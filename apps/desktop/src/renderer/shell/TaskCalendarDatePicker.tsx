import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { addCalendarDays, calendarDateKey } from './scheduled-calendar.js';
import { CalendarPopover } from './TaskCalendarPopover.js';

export function TaskCalendarDatePicker({
  anchor,
  selected,
  now,
  onSelect,
  onClose,
}: {
  anchor: HTMLElement;
  selected: Date;
  now: number;
  onSelect(date: Date): void;
  onClose(): void;
}) {
  const [month, setMonth] = useState(
    () => new Date(selected.getFullYear(), selected.getMonth(), 1),
  );
  const [focused, setFocused] = useState(selected);
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const rows = Array.from({ length: Math.ceil((offset + count) / 7) }, (_, row) => row);
  const monthLabel = `${month.getFullYear()}年${month.getMonth() + 1}月`;
  const selectedKey = calendarDateKey(selected),
    focusedKey = calendarDateKey(focused),
    today = calendarDateKey(new Date(now));
  const changeMonth = (amount: number) => {
    const next = new Date(month.getFullYear(), month.getMonth() + amount, 1);
    setMonth(next);
    setFocused(next);
  };
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>, date: Date) => {
    let next: Date;
    switch (event.key) {
      case 'ArrowLeft':
        next = addCalendarDays(date, -1);
        break;
      case 'ArrowRight':
        next = addCalendarDays(date, 1);
        break;
      case 'ArrowUp':
        next = addCalendarDays(date, -7);
        break;
      case 'ArrowDown':
        next = addCalendarDays(date, 7);
        break;
      case 'Home':
        next = addCalendarDays(date, -((date.getDay() + 6) % 7));
        break;
      case 'End':
        next = addCalendarDays(date, 6 - ((date.getDay() + 6) % 7));
        break;
      case 'PageUp':
      case 'PageDown': {
        const delta = event.key === 'PageUp' ? -1 : 1;
        const last = new Date(date.getFullYear(), date.getMonth() + delta + 1, 0).getDate();
        next = new Date(
          date.getFullYear(),
          date.getMonth() + delta,
          Math.min(date.getDate(), last),
        );
        break;
      }
      default:
        return;
    }
    event.preventDefault();
    setFocused(next);
    setMonth(new Date(next.getFullYear(), next.getMonth(), 1));
    const container = event.currentTarget.closest('.task-cal__date-picker');
    requestAnimationFrame(() =>
      container
        ?.querySelector<HTMLElement>(`[data-picker-date="${calendarDateKey(next)}"]`)
        ?.focus(),
    );
  };
  return (
    <CalendarPopover anchor={anchor} title="跳转日期" onClose={onClose}>
      <div className="task-cal__date-picker">
        <header>
          <button type="button" aria-label="日期选择器上个月" onClick={() => changeMonth(-1)}>
            <ChevronLeft size={16} />
          </button>
          <h2 aria-live="polite">{monthLabel}</h2>
          <button type="button" aria-label="日期选择器下个月" onClick={() => changeMonth(1)}>
            <ChevronRight size={16} />
          </button>
        </header>
        <table role="grid" aria-label={monthLabel}>
          <thead>
            <tr>
              {['一', '二', '三', '四', '五', '六', '日'].map((day) => (
                <th scope="col" key={day}>
                  周{day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row}>
                {Array.from({ length: 7 }, (_, column) => {
                  const day = row * 7 + column - offset + 1;
                  if (day < 1 || day > count) return <td key={column} />;
                  const date = new Date(month.getFullYear(), month.getMonth(), day),
                    key = calendarDateKey(date);
                  return (
                    <td key={column} role="gridcell" aria-selected={key === selectedKey}>
                      <button
                        type="button"
                        data-picker-date={key}
                        data-today={key === today}
                        data-selected={key === selectedKey}
                        data-autofocus={key === focusedKey ? '' : undefined}
                        tabIndex={key === focusedKey ? 0 : -1}
                        aria-label={date.toLocaleDateString('zh-CN', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                          weekday: 'long',
                        })}
                        aria-current={key === today ? 'date' : undefined}
                        onFocus={() => setFocused(date)}
                        onKeyDown={(event) => keyDown(event, date)}
                        onClick={() => onSelect(date)}
                      >
                        {day}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CalendarPopover>
  );
}
