/**
 * 任务清单面板（对齐 DSH TodoPanel）：
 * composer 上方常驻 dock，默认折叠一行 header（图标 + 「任务清单」 + 进度
 * 文案「N 完成 · N 进行中 · N 待办」+ chevron），点击内嵌展开列表。
 * 生命周期由 todo-projection 提供：run 结束保留完成清单，新 run 开始清空。
 */
import { useState } from 'react';
import { Check, ChevronDown, ChevronUp, ListChecks, LoaderCircle } from 'lucide-react';
import type { TaskPlanItem } from './execution-process.js';
import { todoProgressLabel, type TodoProjection } from './todo-projection.js';

function StatusGlyph({ status }: { status: TaskPlanItem['status'] }) {
  if (status === 'completed') return <Check size={12} className="text-[var(--color-success)]" />;
  if (status === 'in_progress') {
    return <LoaderCircle size={12} className="shell-process-spin text-accent" />;
  }
  return <span className="shell-todo-panel__dot" aria-hidden="true" />;
}

export function TodoPanel({ todo }: { todo: TodoProjection }) {
  const [collapsed, setCollapsed] = useState(true);
  if (todo.items.length === 0) return null;
  return (
    <section className="shell-todo-panel" data-testid="todo-panel" aria-label="任务清单">
      <div className="shell-todo-panel__body">
        <button
          type="button"
          className="shell-todo-panel__header"
          aria-expanded={!collapsed}
          data-testid="todo-panel-toggle"
          onClick={() => setCollapsed((value) => !value)}
        >
          <span className="shell-todo-panel__lead" aria-hidden="true">
            <ListChecks size={14} />
          </span>
          <span className="shell-todo-panel__title">任务清单</span>
          <span className="shell-todo-panel__progress" data-testid="todo-progress">
            {todoProgressLabel(todo)}
          </span>
          <span className="shell-todo-panel__chevron" aria-hidden="true">
            {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </span>
        </button>
        {!collapsed ? (
          <ul className="shell-todo-panel__list" role="list" aria-label="任务清单明细">
            {todo.items.map((item, index) => (
              <li
                key={`${index}-${item.title}`}
                className="shell-todo-panel__item"
                data-status={item.status}
              >
                <span className="shell-todo-panel__glyph" aria-hidden="true">
                  <StatusGlyph status={item.status} />
                </span>
                <span className="shell-todo-panel__content">{item.title}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
