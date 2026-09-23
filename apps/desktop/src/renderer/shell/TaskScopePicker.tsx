import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown, Folder, Globe, Layers } from 'lucide-react';
import type { ScheduledTask } from '@sync-think/shared';
import type { WorkspaceSummary } from '@sync-think/protocol';

export function TaskScopePicker({
  value,
  onChange,
  workspaces,
  tasks,
  allowAll = true,
  label = '按任务归属筛选',
  layout = 'menu',
}: {
  value: string;
  onChange(value: string): void;
  workspaces: readonly WorkspaceSummary[];
  tasks: readonly ScheduledTask[];
  allowAll?: boolean;
  label?: string;
  layout?: 'menu' | 'sidebar';
}) {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    const key = task.workspaceId ?? 'global';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const options = [
    ...(allowAll ? [{ id: 'all', name: '全部任务' }] : []),
    { id: 'global', name: '全局任务' },
    ...workspaces.map((ws) => ({ id: ws.workspaceId, name: ws.name })),
  ];
  for (const key of counts.keys())
    if (!options.some((option) => option.id === key))
      options.push({ id: key, name: `未找到的工作区 · ${key.slice(0, 8)}` });
  if (value !== 'all' && !options.some((option) => option.id === value))
    options.push({ id: value, name: `未找到的工作区 · ${value.slice(0, 8)}` });
  const name = options.find((option) => option.id === value)?.name ?? '全部任务';
  const Icon = value === 'all' ? Layers : value === 'global' ? Globe : Folder;
  const picker = (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="task-cal__scope-trigger" aria-label={label}>
          <Icon size={15} />
          <span>{name}</span>
          <ChevronDown size={13} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="task-cal__scope-menu"
          align="start"
          sideOffset={6}
          collisionPadding={12}
        >
          <DropdownMenu.Label className="task-cal__menu-label">
            {allowAll ? '查看哪些任务' : '将任务保存到'}
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={value} onValueChange={onChange}>
            {options.map((option, index) => (
              <div key={option.id}>
                {index === (allowAll ? 2 : 1) ? (
                  <>
                    <DropdownMenu.Separator className="task-cal__menu-separator" />
                    <DropdownMenu.Label className="task-cal__menu-label">工作区</DropdownMenu.Label>
                  </>
                ) : null}
                <DropdownMenu.RadioItem value={option.id} className="task-cal__scope-option">
                  <span className="task-cal__scope-icon" aria-hidden="true">
                    {option.id === 'all' ? (
                      <Layers size={16} />
                    ) : option.id === 'global' ? (
                      <Globe size={16} />
                    ) : (
                      option.name.slice(0, 1).toUpperCase()
                    )}
                  </span>
                  <span className="task-cal__scope-copy">
                    <strong>{option.name}</strong>
                    <small>
                      {option.id === 'all'
                        ? '全局与所有工作区'
                        : option.id === 'global'
                          ? '不隶属工作区'
                          : '工作区'}
                    </small>
                  </span>
                  {allowAll ? (
                    <span className="task-cal__scope-count">
                      {option.id === 'all' ? tasks.length : (counts.get(option.id) ?? 0)}
                    </span>
                  ) : null}
                  <span className="task-cal__scope-check">
                    <DropdownMenu.ItemIndicator>
                      <Check size={14} />
                    </DropdownMenu.ItemIndicator>
                  </span>
                </DropdownMenu.RadioItem>
              </div>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
  if (layout === 'menu') return picker;
  return (
    <div className="task-cal__scope-navigation">
      <div className="task-cal__scope-compact">{picker}</div>
      <div className="task-cal__scope-list" aria-label="任务归属">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={value === option.id}
            onClick={() => onChange(option.id)}
          >
            {option.id === 'all' ? (
              <Layers size={15} />
            ) : option.id === 'global' ? (
              <Globe size={15} />
            ) : (
              <span className="task-cal__scope-initial">
                {option.name.slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="task-cal__scope-name">{option.name}</span>
            <small>{option.id === 'all' ? tasks.length : (counts.get(option.id) ?? 0)}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
