import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  Circle,
  CircleCheck,
  CircleDashed,
  ListTodo,
  Pause,
  Pencil,
  Play,
  Target,
  Trash2,
  X,
} from 'lucide-react';
import type { GoalStatus } from '@sync-think/protocol';
import type { TodoProjection } from './todo-projection.js';

function formatElapsed(startedAt: string): string {
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return '0m';
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - started) / 60_000));
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;
  const hours = Math.floor(elapsedMinutes / 60);
  const minutes = elapsedMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function StatusSection({
  id,
  title,
  trailing,
  open,
  onToggle,
  children,
}: {
  id: 'git' | 'goal' | 'progress';
  title: string;
  trailing?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section
      className="shell-task-status__section"
      data-section={id}
      data-testid="task-status-section"
    >
      <div className="shell-task-status__section-header">
        <button
          type="button"
          className="shell-task-status__section-toggle"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={`task-status-${id}`}
        >
          <span>{title}</span>
          <ChevronDown size={14} className={open ? 'is-open' : undefined} aria-hidden="true" />
        </button>
        {trailing ? <div className="shell-task-status__section-trailing">{trailing}</div> : null}
      </div>
      {open ? (
        <div id={`task-status-${id}`} className="shell-task-status__section-body">
          {children}
        </div>
      ) : null}
    </section>
  );
}

function GoalSection({
  goal,
  todo,
  onPause,
  onResume,
  onEdit,
  onClear,
}: {
  goal: GoalStatus;
  todo?: TodoProjection | null;
  onPause?: () => void;
  onResume?: () => void;
  onEdit?: () => void;
  onClear?: () => void;
}) {
  const roundsStarted = goal.roundsStarted ?? 0;
  const maxRounds = goal.maxGoalRounds ?? 5;
  const complete = goal.status === 'achieved';
  return (
    <div className="shell-task-status__goal">
      <div className="shell-task-status__goal-row">
        <span
          className="shell-task-status__goal-index"
          data-complete={complete ? 'true' : undefined}
        >
          {complete ? <Check size={13} /> : Math.max(1, roundsStarted || 1)}
        </span>
        <div className="shell-task-status__goal-copy">
          <strong>{goal.condition}</strong>
          <span>
            第 {roundsStarted}/{maxRounds} 轮 · {formatElapsed(goal.startedAt)}
            {todo ? ` · ${todo.completed}/${todo.total}` : ''}
          </span>
        </div>
      </div>
      {goal.blockedReason || goal.lastReason ? (
        <div className="shell-task-status__goal-reason">
          {goal.blockedReason ?? goal.lastReason}
        </div>
      ) : null}
      <div className="shell-task-status__goal-actions">
        {goal.status === 'active' && onPause ? (
          <button type="button" onClick={onPause} title="暂停目标" aria-label="暂停目标">
            <Pause size={13} />
          </button>
        ) : (goal.status === 'paused' || goal.status === 'blocked') && onResume ? (
          <button type="button" onClick={onResume} title="继续目标" aria-label="继续目标">
            <Play size={13} />
          </button>
        ) : null}
        {onEdit ? (
          <button type="button" onClick={onEdit} title="编辑目标" aria-label="编辑目标">
            <Pencil size={13} />
          </button>
        ) : null}
        {onClear ? (
          <button type="button" onClick={onClear} title="清空目标" aria-label="清空目标">
            <Trash2 size={13} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ProgressFold({
  side,
  items,
}: {
  side: 'before' | 'after';
  items: TodoProjection['items'];
}) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  const label =
    side === 'before'
      ? items.every((item) => item.status === 'completed')
        ? `已完成 ${items.length} 项`
        : `前面 ${items.length} 项`
      : items.every((item) => item.status === 'pending')
        ? `待处理 ${items.length} 项`
        : `后面 ${items.length} 项`;
  return (
    <div
      className="shell-task-status__progress-fold"
      data-testid={`task-progress-fold-${side}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <button type="button" aria-label={label}>
        <ListTodo size={14} />
        <span>{label}</span>
      </button>
      {open ? (
        <div className="shell-task-status__progress-popover" role="tooltip">
          {items.map((item) => (
            <div key={item.title}>{item.title}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function progressWindow(todo: TodoProjection): {
  before: TodoProjection['items'];
  visible: TodoProjection['items'];
  after: TodoProjection['items'];
} {
  if (todo.items.length <= 6) return { before: [], visible: todo.items, after: [] };
  let focus = todo.items.findIndex((item) => item.status === 'in_progress');
  if (focus < 0) focus = todo.items.findIndex((item) => item.status !== 'completed');
  if (focus < 0) focus = todo.items.length - 1;
  const start = Math.min(todo.items.length - 3, Math.max(0, focus - 1));
  return {
    before: todo.items.slice(0, start),
    visible: todo.items.slice(start, start + 3),
    after: todo.items.slice(start + 3),
  };
}

function ProgressSection({ todo }: { todo: TodoProjection }) {
  const windowed = useMemo(() => progressWindow(todo), [todo]);
  return (
    <div className="shell-task-status__progress">
      <ProgressFold side="before" items={windowed.before} />
      {windowed.visible.map((item) => (
        <div
          key={item.title}
          className="shell-task-status__progress-row"
          data-status={item.status}
          data-testid="task-progress-item"
        >
          <span className="shell-task-status__progress-icon">
            {item.status === 'completed' ? (
              <CircleCheck size={14} />
            ) : item.status === 'in_progress' ? (
              <CircleDashed size={14} className="shell-process-spin" />
            ) : (
              <Circle size={13} />
            )}
          </span>
          <span className={item.status === 'completed' ? 'is-completed' : undefined}>
            {item.title}
          </span>
        </div>
      ))}
      <ProgressFold side="after" items={windowed.after} />
    </div>
  );
}

function goalStateLabel(goal: GoalStatus): string {
  if (goal.status === 'achieved') return '已完成';
  if (goal.status === 'paused') return '已暂停';
  if (goal.status === 'blocked') return '已阻塞';
  return formatElapsed(goal.startedAt);
}

export function TaskStatusPanel({
  scopeKey,
  goal,
  todo,
  onGoalPause,
  onGoalResume,
  onGoalEdit,
  onGoalClear,
}: {
  scopeKey?: string;
  goal?: GoalStatus;
  todo?: TodoProjection | null;
  onGoalPause?: () => void;
  onGoalResume?: () => void;
  onGoalEdit?: () => void;
  onGoalClear?: () => void;
}) {
  const [manualOpen, setManualOpen] = useState(false);
  const [openSections, setOpenSections] = useState({ goal: true, progress: true });

  const visibleGoal =
    goal && ['active', 'paused', 'blocked', 'achieved'].includes(goal.status) ? goal : undefined;
  const visibleTodo = todo && todo.items.length > 0 ? todo : undefined;
  const activeTodoSignature = visibleTodo?.items
    .map((item) => `${item.status}:${item.title}`)
    .join('\u0000');
  const autoOpenedTodoScopesRef = useRef(new Set<string>());
  useEffect(() => {
    if (!activeTodoSignature) return;
    const resolvedScopeKey = scopeKey?.trim() || '__default__';
    if (autoOpenedTodoScopesRef.current.has(resolvedScopeKey)) return;
    autoOpenedTodoScopesRef.current.add(resolvedScopeKey);
    setManualOpen(true);
  }, [activeTodoSignature, scopeKey]);
  if (!visibleGoal && !visibleTodo) return null;

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections((current) => ({ ...current, [section]: !current[section] }));
  };
  const miniLabel = visibleTodo
    ? `${visibleTodo.completed}/${visibleTodo.total}`
    : visibleGoal
      ? goalStateLabel(visibleGoal)
      : '';
  const currentTodo = visibleTodo?.items.find((item) => item.status === 'in_progress');
  const activeGoal =
    visibleGoal && ['active', 'paused', 'blocked'].includes(visibleGoal.status)
      ? visibleGoal
      : undefined;

  return (
    <div className="shell-task-status-host" data-testid="task-status-host">
      <button
        type="button"
        className="shell-task-status-mini"
        onClick={() => setManualOpen(true)}
        aria-label="打开任务状态"
        title="任务状态"
      >
        {activeGoal ? (
          <Target size={15} />
        ) : currentTodo ? (
          <CircleDashed size={15} className="shell-process-spin" />
        ) : (
          <ListTodo size={15} />
        )}
        <span className="shell-task-status-mini__label">
          {currentTodo?.title || activeGoal?.condition || miniLabel}
        </span>
      </button>
      <aside
        className="shell-task-status-panel"
        data-manual-open={manualOpen ? 'true' : undefined}
        data-testid="task-status-panel"
        data-theme-surface="semantic"
        aria-label="任务状态"
      >
        <button
          type="button"
          className="shell-task-status-panel__close"
          onClick={() => setManualOpen(false)}
          aria-label="关闭任务状态"
          title="关闭"
        >
          <X size={14} />
        </button>
        {visibleGoal ? (
          <StatusSection
            id="goal"
            title="目标"
            open={openSections.goal}
            onToggle={() => toggleSection('goal')}
            trailing={
              <span className="shell-task-status__goal-state" data-status={visibleGoal.status}>
                {visibleGoal.status === 'blocked' ? <AlertCircle size={12} /> : null}
                {goalStateLabel(visibleGoal)}
              </span>
            }
          >
            <GoalSection
              goal={visibleGoal}
              todo={visibleTodo}
              onPause={onGoalPause}
              onResume={onGoalResume}
              onEdit={onGoalEdit}
              onClear={onGoalClear}
            />
          </StatusSection>
        ) : null}
        {visibleTodo ? (
          <StatusSection
            id="progress"
            title="任务清单"
            open={openSections.progress}
            onToggle={() => toggleSection('progress')}
            trailing={
              <span className="shell-task-status__progress-count">
                {visibleTodo.completed}/{visibleTodo.total}
              </span>
            }
          >
            <ProgressSection todo={visibleTodo} />
          </StatusSection>
        ) : null}
      </aside>
    </div>
  );
}
