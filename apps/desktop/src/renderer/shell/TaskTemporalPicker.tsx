import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock3 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTaskSheetPortalContainer } from './TaskSheet.js';

/** Strict wall-clock values shared by the picker and task-editor validation. */
export function isTaskTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** Shell-themed calendar/time shortcuts; text fields remain available for exact values. */
export function TaskTemporalPicker({
  type,
  value,
  onChange,
  label,
  disabled = false,
}: {
  type: 'date' | 'time';
  value: string;
  onChange(value: string): void;
  label?: string;
  disabled?: boolean;
}) {
  const portalContainer = useTaskSheetPortalContainer();
  const [month, setMonth] = useState(() => new Date());
  const [open, setOpen] = useState(false);
  const pad = (n: number) => String(n).padStart(2, '0');
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = first.getDay();
  const [hour, minute] = (isTaskTime(value) ? value : '09:00').split(':');
  const selectedHour = useRef<HTMLDivElement>(null);
  const selectedMinute = useRef<HTMLDivElement>(null);
  const pickerLabel = label ?? (type === 'date' ? '选择生效日期' : '选择开始时间');
  return (
    <DropdownMenu.Root
      modal={false}
      open={open && !disabled}
      onOpenChange={(next) => {
        if (next && type === 'date') {
          const parsed = new Date(`${value}T12:00:00`);
          setMonth(Number.isNaN(parsed.getTime()) ? new Date() : parsed);
        }
        setOpen(next);
      }}
    >
      <DropdownMenu.Trigger asChild disabled={disabled}>
        <button
          type="button"
          className="task-temporal__trigger"
          aria-label={pickerLabel}
          disabled={disabled}
        >
          {type === 'date' ? <CalendarDays size={16} /> : <Clock3 size={16} />}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal container={portalContainer}>
        <DropdownMenu.Content
          className="task-temporal"
          data-kind={type}
          aria-label={pickerLabel}
          onFocus={(event) => {
            if (type !== 'time' || event.target !== event.currentTarget) return;
            // Override roving-focus entry synchronously; an effect runs before
            // Radix mounts its focus scope and gets reset to the first hour.
            event.preventDefault();
            selectedHour.current?.focus({ preventScroll: true });
          }}
          sideOffset={6}
          collisionPadding={12}
          align="end"
        >
          {type === 'date' ? (
            <>
              <div className="task-temporal__head">
                <DropdownMenu.Item
                  aria-label="上个月"
                  onSelect={(e) => {
                    e.preventDefault();
                    setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1));
                  }}
                >
                  <ChevronLeft size={16} />
                </DropdownMenu.Item>
                <span>
                  {month.getFullYear()} 年 {month.getMonth() + 1} 月
                </span>
                <DropdownMenu.Item
                  aria-label="下个月"
                  onSelect={(e) => {
                    e.preventDefault();
                    setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1));
                  }}
                >
                  <ChevronRight size={16} />
                </DropdownMenu.Item>
              </div>
              <div className="task-temporal__calendar">
                {['日', '一', '二', '三', '四', '五', '六'].map((d) => (
                  <span key={d}>{d}</span>
                ))}
                {Array.from({ length: 42 }, (_, index) => {
                  const date = new Date(first.getFullYear(), first.getMonth(), index - offset + 1);
                  const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
                  return (
                    <DropdownMenu.Item
                      key={key}
                      aria-label={key}
                      data-selected={value === key}
                      data-outside={date.getMonth() !== first.getMonth()}
                      onSelect={() => onChange(key)}
                    >
                      {date.getDate()}
                    </DropdownMenu.Item>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <div className="task-temporal__time-head">
                <Clock3 size={16} aria-hidden="true" />
                <DropdownMenu.Label>{pickerLabel.replace(/^选择/, '')}</DropdownMenu.Label>
                <span>24 小时制</span>
              </div>
              <div className="task-temporal__time-columns">
                <div>
                  <DropdownMenu.Label className="task-temporal__column-label">
                    小时
                  </DropdownMenu.Label>
                  <DropdownMenu.RadioGroup
                    value={hour}
                    className="task-temporal__time-grid task-temporal__hours"
                    data-layout="grid"
                    aria-label="点选小时"
                  >
                    {Array.from({ length: 24 }, (_, n) => (
                      <DropdownMenu.RadioItem
                        key={n}
                        value={pad(n)}
                        aria-label={`${pad(n)} 时`}
                        ref={hour === pad(n) ? selectedHour : undefined}
                        onSelect={(event) => {
                          event.preventDefault();
                          onChange(`${pad(n)}:${minute}`);
                        }}
                      >
                        <span>{pad(n)}</span>
                        <DropdownMenu.ItemIndicator>
                          <Check size={14} />
                        </DropdownMenu.ItemIndicator>
                      </DropdownMenu.RadioItem>
                    ))}
                  </DropdownMenu.RadioGroup>
                </div>
                <div>
                  <DropdownMenu.Label className="task-temporal__column-label">
                    分钟
                  </DropdownMenu.Label>
                  <DropdownMenu.RadioGroup
                    value={minute}
                    className="task-temporal__time-grid task-temporal__minutes"
                    data-layout="grid"
                    aria-label="点选分钟"
                  >
                    {Array.from({ length: 60 }, (_, n) => (
                      <DropdownMenu.RadioItem
                        key={n}
                        value={pad(n)}
                        aria-label={`${pad(n)} 分`}
                        ref={minute === pad(n) ? selectedMinute : undefined}
                        onSelect={() => onChange(`${hour}:${pad(n)}`)}
                      >
                        <span>{pad(n)}</span>
                        <DropdownMenu.ItemIndicator>
                          <Check size={14} />
                        </DropdownMenu.ItemIndicator>
                      </DropdownMenu.RadioItem>
                    ))}
                  </DropdownMenu.RadioGroup>
                </div>
              </div>
              <div className="task-temporal__time-foot">
                <time>{isTaskTime(value) ? value : '—'}</time>
                <span>选择分钟后收起 · 可手输精确时间</span>
              </div>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** A manually editable HH:mm field with an equally available keyboard/mouse picker. */
export function TaskTimeField({
  label,
  value,
  disabled = false,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange(value: string): void;
}) {
  return (
    <div className="task-time-field" data-disabled={disabled}>
      <input
        aria-label={label}
        type="text"
        inputMode="numeric"
        placeholder="HH:mm"
        maxLength={5}
        value={value}
        disabled={disabled}
        aria-invalid={!disabled && value !== '' && !isTaskTime(value)}
        onChange={(event) => onChange(event.target.value)}
      />
      <TaskTemporalPicker
        type="time"
        label={`选择${label}`}
        value={value}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  );
}
