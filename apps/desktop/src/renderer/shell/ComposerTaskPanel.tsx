import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Circle, CircleCheck, CircleDot, ListTodo, X } from 'lucide-react';
import type { TodoProjection } from './todo-projection.js';

function taskSignature(todo: TodoProjection): string {
  return JSON.stringify(
    todo.items.map((item) => [item.status, item.title, item.description ?? '']),
  );
}

export function ComposerTaskPanel({
  todo,
  scopeKey = '__default__',
}: {
  todo?: TodoProjection | null;
  scopeKey?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState<{ scope: string; signature: string }>();
  const panelRef = useRef<HTMLDivElement>(null);
  const autoExpandedScopesRef = useRef(new Set<string>());
  const visibleTodo = todo?.items.some((item) => item.status !== 'completed') ? todo : undefined;
  const signature = useMemo(() => (visibleTodo ? taskSignature(visibleTodo) : ''), [visibleTodo]);

  useEffect(() => {
    setExpanded(false);
  }, [scopeKey]);

  useEffect(() => {
    if (!visibleTodo || autoExpandedScopesRef.current.has(scopeKey)) return;
    autoExpandedScopesRef.current.add(scopeKey);
    setExpanded(true);
  }, [scopeKey, visibleTodo]);

  useEffect(() => {
    if (!expanded || !visibleTodo) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [expanded, visibleTodo]);

  if (!visibleTodo || (dismissed?.scope === scopeKey && dismissed.signature === signature)) {
    return null;
  }

  const current = visibleTodo.items.find((item) => item.status === 'in_progress');
  const headline = current?.title || '任务清单';
  const progress = visibleTodo.total > 0 ? visibleTodo.completed / visibleTodo.total : 0;

  return (
    <div
      ref={panelRef}
      className="shell-composer-task-panel"
      data-testid="composer-task-panel"
      data-running={visibleTodo.running ? 'true' : 'false'}
    >
      <div className="shell-composer-task-panel__summary">
        <button
          type="button"
          className="shell-composer-task-panel__toggle"
          aria-expanded={expanded}
          aria-label={`任务进度 ${visibleTodo.completed}/${visibleTodo.total}`}
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronDown
            size={14}
            className="shell-composer-task-panel__chevron"
            data-expanded={expanded ? 'true' : 'false'}
            aria-hidden="true"
          />
          <ListTodo size={16} aria-hidden="true" />
          <span className="shell-composer-task-panel__headline">
            {headline}
            <span>
              ({visibleTodo.completed}/{visibleTodo.total})
            </span>
          </span>
          {progress === 1 ? (
            <CircleCheck
              size={14}
              className="shell-composer-task-panel__complete"
              aria-hidden="true"
            />
          ) : progress > 0 ? (
            <span className="shell-composer-task-panel__progress" aria-hidden="true">
              <span style={{ width: `${progress * 100}%` }} />
            </span>
          ) : null}
        </button>
        <button
          type="button"
          className="shell-composer-task-panel__dismiss"
          aria-label="清除任务清单"
          title="清除任务清单"
          onClick={() => setDismissed({ scope: scopeKey, signature })}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      <div
        className="shell-composer-task-panel__reveal"
        data-expanded={expanded ? 'true' : 'false'}
      >
        <div>
          {expanded ? (
            <div className="shell-composer-task-panel__list" data-testid="composer-task-list">
              {visibleTodo.items.map((item, index) => {
                const Icon =
                  item.status === 'completed'
                    ? CircleCheck
                    : item.status === 'in_progress'
                      ? CircleDot
                      : Circle;
                return (
                  <div
                    key={`${item.title}:${index}`}
                    className="shell-composer-task-panel__item"
                    data-status={item.status}
                  >
                    <Icon size={16} aria-hidden="true" />
                    <div className="shell-composer-task-panel__content">
                      <span className="shell-composer-task-panel__title">{item.title}</span>
                      {item.description?.trim() ? (
                        <span className="shell-composer-task-panel__description">
                          {item.description}
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
