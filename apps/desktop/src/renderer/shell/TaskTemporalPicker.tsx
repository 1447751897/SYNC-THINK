import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3 } from 'lucide-react';
import { useState } from 'react';

/** Shell-themed calendar/time shortcuts; text fields remain available for exact values. */
export function TaskTemporalPicker({
  type,
  value,
  onChange,
}: {
  type: 'date' | 'time';
  value: string;
  onChange(value: string): void;
}) {
  const [month, setMonth] = useState(() => new Date());
  const [open, setOpen] = useState(false);
  const pad = (n: number) => String(n).padStart(2, '0');
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = first.getDay();
  const [hour = '09', minute = '00'] = value.split(':');
  return (
    <DropdownMenu.Root
      modal={false}
      open={open}
      onOpenChange={(next) => {
        if (next && type === 'date') {
          const parsed = new Date(`${value}T12:00:00`);
          setMonth(Number.isNaN(parsed.getTime()) ? new Date() : parsed);
        }
        setOpen(next);
      }}
    >
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="task-temporal__trigger"
          aria-label={type === 'date' ? '选择生效日期' : '选择开始时间'}
        >
          {type === 'date' ? <CalendarDays size={16} /> : <Clock3 size={16} />}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="task-temporal"
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
              <DropdownMenu.Label>小时</DropdownMenu.Label>
              <div className="task-temporal__hours">
                {Array.from({ length: 24 }, (_, n) => (
                  <DropdownMenu.Item
                    key={n}
                    data-selected={hour === pad(n)}
                    onSelect={(e) => {
                      e.preventDefault();
                      onChange(`${pad(n)}:${minute}`);
                    }}
                  >
                    {pad(n)}
                  </DropdownMenu.Item>
                ))}
              </div>
              <DropdownMenu.Label>分钟快捷选择</DropdownMenu.Label>
              <div className="task-temporal__hours">
                {Array.from({ length: 12 }, (_, n) => (
                  <DropdownMenu.Item
                    key={n}
                    data-selected={minute === pad(n * 5)}
                    onSelect={() => onChange(`${hour}:${pad(n * 5)}`)}
                  >
                    {pad(n * 5)}
                  </DropdownMenu.Item>
                ))}
              </div>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
