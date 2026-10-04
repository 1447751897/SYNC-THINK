import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { FileTypeIcon } from './FileTypeIcon.js';

function reducedTaskMotion() {
  return (
    typeof document !== 'undefined' &&
    (document.documentElement.hasAttribute('data-reduced-motion') ||
      (typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches))
  );
}

/** Native height/blur/lift reveal: real events add rows without importing an animation runtime. */
export function TaskReveal({
  as: Element = 'div',
  reveal = true,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & {
  as?: 'div' | 'section';
  reveal?: boolean;
  children?: ReactNode;
  'data-testid'?: string;
  'data-running'?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!reveal || reducedTaskMotion() || !node?.animate) return;
    const animation = node.animate(
      [
        { height: '0px', opacity: 0, filter: 'blur(4px)', transform: 'translateY(4px)' },
        {
          height: node.getBoundingClientRect().height + 'px',
          opacity: 1,
          filter: 'blur(0px)',
          transform: 'translateY(0)',
        },
      ],
      { duration: 300, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
    return () => animation.cancel();
  }, [reveal]);
  return (
    <Element {...props} ref={ref as React.Ref<HTMLDivElement>}>
      {children}
    </Element>
  );
}

function TaskCollapse({ open, children, id }: { open: boolean; children?: ReactNode; id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef({ open, height: 0 });
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const height = open ? node.getBoundingClientRect().height : 0;
    const old = previous.current;
    previous.current = { open, height };
    if (old.open === open || reducedTaskMotion() || !node.animate) return;
    const animation = node.animate(
      [
        { height: old.height + 'px', opacity: old.open ? 1 : 0 },
        { height: height + 'px', opacity: open ? 1 : 0 },
      ],
      { duration: 300, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
    return () => animation.cancel();
  }, [open, children]);
  return (
    <div ref={ref} id={id} className="shell-task-log__body" style={{ height: open ? 'auto' : 0 }}>
      {children}
    </div>
  );
}

export type TaskListIconKind = 'search' | 'file' | 'command' | 'other';

/** Filled glyphs keep the same 16px optical weight as the task-log reference. */
export function TaskListIcon({ kind = 'search' }: { kind?: TaskListIconKind }) {
  const path =
    kind === 'search'
      ? 'M18.031 16.6168L22.3137 20.8995L20.8995 22.3137L16.6168 18.031C15.0769 19.263 13.124 20 11 20C6.032 20 2 15.968 2 11C2 6.032 6.032 2 11 2C15.968 2 20 6.032 20 11C20 13.124 19.263 15.0769 18.031 16.6168ZM16.0247 15.8748C17.2475 14.6146 18 12.8956 18 11C18 7.1325 14.8675 4 11 4C7.1325 4 4 7.1325 4 11C4 14.8675 7.1325 18 11 18C12.8956 18 14.6146 17.2475 15.8748 16.0247L16.0247 15.8748Z'
      : kind === 'file'
        ? 'M15 4H5V20H19V8H15V4ZM3 2.9918C3 2.44405 3.44749 2 3.9985 2H16L20.9997 7L21 20.9925C21 21.5489 20.5551 22 20.0066 22H3.9934C3.44476 22 3 21.5447 3 21.0082V2.9918ZM17.6569 12L14.1213 15.5355L12.7071 14.1213L14.8284 12L12.7071 9.87868L14.1213 8.46447L17.6569 12ZM6.34315 12L9.87868 8.46447L11.2929 9.87868L9.17157 12L11.2929 14.1213L9.87868 15.5355L6.34315 12Z'
        : 'M3 3H21V21H3V3ZM5 5V19H19V5H5ZM7 8L11 12L7 16L5.6 14.6L8.2 12L5.6 9.4L7 8ZM12 14H17V16H12V14Z';
  return (
    <svg
      className="shell-task-log__icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

export function TaskBranch() {
  return (
    <span className="shell-task-log__branch" aria-hidden="true">
      <svg width="12" height="15" viewBox="0 0 12 15" fill="none">
        <path d="M0.5 0 V8 Q0.5 14 6.5 14 H11.5" stroke="currentColor" strokeWidth="1" />
      </svg>
      <span />
    </span>
  );
}

export function TaskResourceChip({
  label,
  path = label,
  icon,
  onOpen,
}: {
  label: string;
  path?: string;
  icon?: ReactNode;
  onOpen?: (path: string) => void;
}) {
  return (
    <span
      className="shell-task-log__chip"
      title={path}
      {...(onOpen
        ? {
            role: 'link',
            tabIndex: 0,
            onClick: (event: React.MouseEvent) => {
              event.stopPropagation();
              onOpen(path);
            },
            onKeyDown: (event: React.KeyboardEvent) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              event.stopPropagation();
              onOpen(path);
            },
          }
        : {})}
    >
      <span className="shell-task-log__chip-icon" aria-hidden="true">
        {icon ??
          (/\.[jt]sx$/i.test(path) ? (
            <span className="shell-task-log__react-icon" />
          ) : (
            <FileTypeIcon path={path} size={14} />
          ))}
      </span>
      <span className="shell-task-log__chip-label">{label}</span>
    </span>
  );
}

/** Also used by the real execution trace; no simulated timer sits on real events. */
export function TaskListSection({
  title,
  icon,
  open,
  running = false,
  onToggle,
  children,
  testId,
  toggleTestId,
}: {
  title: string;
  icon?: ReactNode;
  open: boolean;
  running?: boolean;
  onToggle: () => void;
  children?: ReactNode;
  testId?: string;
  toggleTestId?: string;
}) {
  const bodyId = useId();
  return (
    <TaskReveal
      as="section"
      className="shell-task-log shell-process-actions"
      data-testid={testId}
      data-running={running || undefined}
    >
      <button
        type="button"
        className="shell-task-log__header shell-process-actions__toggle"
        data-testid={toggleTestId}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        {icon ?? <TaskListIcon />}
        <span
          className={
            'shell-task-log__title shell-process-actions__label' + (running ? ' is-running' : '')
          }
        >
          {title}
        </span>
        <svg
          className="shell-task-log__chevron"
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M12 13.171L16.95 8.222L18.364 9.636L12 16L5.636 9.636L7.05 8.222L12 13.171Z" />
        </svg>
      </button>
      <TaskCollapse id={bodyId} open={open}>
        {open ? (
          <div
            className="shell-task-log__steps shell-process-actions__body"
            role="list"
            aria-live="polite"
          >
            {children}
          </div>
        ) : null}
      </TaskCollapse>
    </TaskReveal>
  );
}

export interface TaskListStep {
  id?: string;
  label: string;
  chips?: readonly { label: string; icon?: ReactNode; path?: string }[];
}
export interface TaskListTask {
  id?: string;
  title: string;
  runningTitle?: string;
  icon?: ReactNode;
  steps: readonly TaskListStep[];
}

function RevealedTask({
  task,
  count,
  complete,
  collapseOnComplete,
}: {
  task: TaskListTask;
  count: number;
  complete: boolean;
  collapseOnComplete?: boolean | 'all';
}) {
  const [manualOpen, setManualOpen] = useState<boolean>();
  const done = count >= task.steps.length + 1;
  const open =
    manualOpen ?? !(collapseOnComplete === 'all' ? complete : collapseOnComplete && done);
  return (
    <TaskListSection
      title={!done && task.runningTitle ? task.runningTitle : task.title}
      icon={task.icon}
      open={open}
      running={!done}
      onToggle={() => setManualOpen(!open)}
    >
      {task.steps.slice(0, Math.max(0, count - 1)).map((step, index) => (
        <TaskReveal key={step.id ?? index} className="shell-task-log__step" role="listitem">
          <TaskBranch />
          <span className="shell-task-log__step-label">
            {step.label}
            {step.chips?.map((chip, chipIndex) => (
              <TaskResourceChip key={chipIndex} {...chip} />
            ))}
          </span>
        </TaskReveal>
      ))}
    </TaskListSection>
  );
}

/** Public-style API for isolated previews. Production uses controlled real tool events. */
export function TaskList({
  tasks,
  revealed,
  startDelay = 320,
  stepInterval = 850,
  collapseOnComplete,
  onComplete,
}: {
  tasks: readonly TaskListTask[];
  revealed?: number;
  startDelay?: number;
  stepInterval?: number;
  collapseOnComplete?: boolean | 'all';
  onComplete?: () => void;
}) {
  const total = tasks.reduce((sum, task) => sum + task.steps.length + 1, 0);
  const [timedCount, setTimedCount] = useState(0);
  const completionFired = useRef(false);
  const callback = useRef(onComplete);
  callback.current = onComplete;
  const controlled = revealed !== undefined;
  useEffect(() => {
    if (controlled || total === 0) return;
    let timer: ReturnType<typeof setTimeout>;
    let count = 0;
    const advance = () => {
      count += 1;
      setTimedCount(count);
      if (count < total) timer = setTimeout(advance, Math.max(0, stepInterval));
    };
    timer = setTimeout(advance, Math.max(0, startDelay));
    return () => clearTimeout(timer);
  }, [controlled, total, startDelay, stepInterval]);
  const units = Math.min(total, Math.max(0, Math.floor(revealed ?? timedCount)));
  const complete = units >= total;
  useEffect(() => {
    if (!complete) {
      completionFired.current = false;
      return;
    }
    if (!completionFired.current) {
      completionFired.current = true;
      callback.current?.();
    }
  }, [complete]);
  let offset = 0;
  return (
    <div className="shell-task-list" data-complete={complete}>
      {tasks.map((task, index) => {
        const count = Math.min(task.steps.length + 1, Math.max(0, units - offset));
        offset += task.steps.length + 1;
        return count > 0 ? (
          <RevealedTask
            key={task.id ?? index}
            task={task}
            count={count}
            complete={complete}
            collapseOnComplete={collapseOnComplete}
          />
        ) : null;
      })}
    </div>
  );
}
