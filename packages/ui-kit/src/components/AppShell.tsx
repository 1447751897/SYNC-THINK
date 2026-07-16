import { useState, useRef, useMemo, type ReactNode, useEffect, useCallback } from 'react';
import { LayoutPanelLeft, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { applyTheme, type Theme } from '../theme.js';

export type AppShellReadinessLevel = 'empty' | 'partial' | 'ready' | 'compact';

export interface AppShellReadiness {
  level: AppShellReadinessLevel;
  badge: string;
  hasLeftNav: boolean;
  hasConversation: boolean;
  hasCompose: boolean;
  hasContextRail: boolean;
  hasTrace: boolean;
  traceCollapsed: boolean;
  theme: Theme | null;
  themeLabel: string;
  note: string;
}

export interface AppShellProps {
  /** Left navigation starts with projects; tasks nest under projects; local folders bind optionally. */
  leftNav?: ReactNode;
  /** Center: scrollable complete conversation history. */
  conversation?: ReactNode;
  /** Right Run trace — visible by default, collapsible. Collapsing does not pause Run. */
  trace?: ReactNode;
  /** Bottom compose bar. */
  compose?: ReactNode;
  /** Continuum rail spans the top of the main conversation area. */
  contextRail?: ReactNode;
  traceCollapsedDefault?: boolean;
  theme?: Theme;
  /** Controlled trace collapse (optional). */
  traceCollapsed?: boolean;
  onTraceCollapsedChange?: (collapsed: boolean) => void;
  /** Hide the layout readiness strip (dense embeds / tests). */
  hideReadiness?: boolean;
  /** Product-facing title for the right rail; defaults to the technical IA label. */
  traceTitle?: string;
  /** Accessible right-rail landmark label; defaults to traceTitle. */
  traceAriaLabel?: string;
}

function themeLabel(theme: Theme | null | undefined): string {
  if (theme === 'light') return '浅色';
  if (theme === 'dark') return '深色';
  if (theme === 'system') return '跟随系统';
  return '未设';
}

/** Pure projector for tests + UI — §15.2 locked IA / §15.3 theme observability. */
export function projectAppShellReadiness(input: {
  hasLeftNav?: boolean;
  hasConversation?: boolean;
  hasCompose?: boolean;
  hasContextRail?: boolean;
  hasTrace?: boolean;
  traceCollapsed?: boolean;
  theme?: Theme | null;
}): AppShellReadiness {
  const hasLeftNav = Boolean(input.hasLeftNav);
  const hasConversation = Boolean(input.hasConversation);
  const hasCompose = Boolean(input.hasCompose);
  const hasContextRail = Boolean(input.hasContextRail);
  const hasTrace = Boolean(input.hasTrace);
  const traceCollapsed = Boolean(input.traceCollapsed);
  const theme = input.theme ?? null;
  const coreSlots = [hasLeftNav, hasConversation, hasCompose, hasTrace].filter(Boolean).length;
  let level: AppShellReadinessLevel = 'empty';
  if (coreSlots === 0) level = 'empty';
  else if (coreSlots < 4) level = 'partial';
  else if (traceCollapsed) level = 'compact';
  else level = 'ready';

  const badge =
    level === 'ready'
      ? '布局就绪'
      : level === 'compact'
        ? '轨迹已折'
        : level === 'partial'
          ? '布局不全'
          : '空壳';

  const notes: string[] = [];
  if (level === 'empty') {
    notes.push('工作区骨架未装载 · 需要左侧文件夹、对话、Compose 与运行轨迹');
  } else if (level === 'partial') {
    notes.push(
      `核心栏位 ${coreSlots}/4 · 连续体 ${hasContextRail ? '有' : '无'} · 折叠轨迹不暂停 Run`,
    );
  } else if (level === 'compact') {
    notes.push('运行轨迹已折叠 · Run 不暂停 · Ctrl+\\ 可展开 · 主题偏好会记住');
  } else {
    notes.push(
      hasContextRail
        ? '左文件夹 · 中对话 · 上连续体 · 右轨迹 · 主题完整'
        : '左文件夹 · 中对话 · 右轨迹已就位 · 可补连续体签名条',
    );
  }

  return {
    level,
    badge,
    hasLeftNav,
    hasConversation,
    hasCompose,
    hasContextRail,
    hasTrace,
    traceCollapsed,
    theme,
    themeLabel: themeLabel(theme),
    note: notes.join(' · '),
  };
}

// AppShell is the structural skeleton of the main workspace per Locked IA
// §15.2: left folder/task tree, center chat, right collapsible trace.
// The signature element — Context Continuum Rail — sits above the conversation.
// Collapsing the trace breathes: center column expands with a 200-300ms ease.
export function AppShell(props: AppShellProps) {
  const [internalCollapsed, setInternalCollapsed] = useState<boolean>(
    props.traceCollapsedDefault ?? false,
  );
  const isControlled = props.traceCollapsed !== undefined;
  const collapsed = isControlled ? Boolean(props.traceCollapsed) : internalCollapsed;
  const setCollapsed = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const value = typeof next === 'function' ? next(collapsed) : next;
      if (!isControlled) setInternalCollapsed(value);
      props.onTraceCollapsedChange?.(value);
    },
    [collapsed, isControlled, props],
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const traceTitle = props.traceTitle ?? '运行轨迹';

  const readiness = useMemo(
    () =>
      projectAppShellReadiness({
        hasLeftNav: props.leftNav != null,
        hasConversation: props.conversation != null,
        hasCompose: props.compose != null,
        hasContextRail: props.contextRail != null,
        hasTrace: props.trace != null,
        traceCollapsed: collapsed,
        theme: props.theme ?? null,
      }),
    [
      props.leftNav,
      props.conversation,
      props.compose,
      props.contextRail,
      props.trace,
      props.theme,
      collapsed,
    ],
  );

  useEffect(() => {
    if (props.theme && rootRef.current?.ownerDocument) {
      applyTheme(rootRef.current.ownerDocument.documentElement, props.theme);
    }
  }, [props.theme]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Ctrl/Cmd + \ toggles the Run trace rail (design §15.4 keyboard).
      if ((event.ctrlKey || event.metaKey) && event.key === '\\') {
        const target = event.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) {
          // Still allow from compose: user may want more conversation space.
        }
        event.preventDefault();
        setCollapsed((c) => !c);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setCollapsed]);

  return (
    <div
      ref={rootRef}
      className="st-app-shell"
      data-trace-collapsed={collapsed}
      data-level={readiness.level}
      data-testid="app-shell"
    >
      <aside className="st-app-shell__nav" aria-label="项目导航">
        {props.leftNav}
      </aside>
      <main className="st-app-shell__main">
        {props.contextRail != null && (
          <div className="st-app-shell__context-rail" aria-label="上下文连续体">
            {props.contextRail}
          </div>
        )}
        <section
          id="st-main-conversation"
          className="st-app-shell__conversation"
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          tabIndex={-1}
        >
          {props.conversation}
        </section>
        <footer className="st-app-shell__compose">{props.compose}</footer>
      </main>
      <aside
        className="st-app-shell__trace"
        aria-label={props.traceAriaLabel ?? traceTitle}
        data-collapsed={collapsed}
      >
        <div className="st-app-shell__trace-header">
          <div className="st-app-shell__trace-heading">
            <span data-testid="shell-trace-title">{traceTitle}</span>
            <span
              className="st-app-shell__shortcut-hint"
              data-testid="shell-shortcut-hint"
              title={'Ctrl+\\ 折叠/展开轨迹'}
            >
              <kbd>Ctrl</kbd>
              {'\\'}
            </span>
          </div>
          <button
            type="button"
            className="st-app-shell__trace-toggle"
            onClick={() => setCollapsed((c) => !c)}
            aria-pressed={collapsed}
            aria-label={collapsed ? '展开运行轨迹' : '折叠运行轨迹'}
            title={collapsed ? '展开运行轨迹 (Ctrl+\\)' : '折叠运行轨迹 (Ctrl+\\)'}
            data-testid="trace-toggle"
          >
            {collapsed ? (
              <PanelRightOpen aria-hidden="true" size={16} strokeWidth={1.8} />
            ) : (
              <PanelRightClose aria-hidden="true" size={16} strokeWidth={1.8} />
            )}
          </button>
        </div>

        {props.hideReadiness ? null : (
          <div
            className="st-app-shell__readiness"
            data-testid="app-shell-readiness"
            data-level={readiness.level}
            aria-label="工作区布局就绪"
          >
            <div className="st-app-shell__readiness-head">
              <LayoutPanelLeft size={12} strokeWidth={1.8} aria-hidden="true" />
              <span>工作区布局</span>
              <small>§15.2 · §15.3</small>
              <strong data-testid="app-shell-readiness-badge">{readiness.badge}</strong>
            </div>
            <ul className="st-app-shell__readiness-list">
              <li data-ok={readiness.hasLeftNav ? '1' : '0'} data-testid="shell-check-nav">
                <span className="st-app-shell__readiness-dot" aria-hidden="true" />
                左侧导航 {readiness.hasLeftNav ? '有' : '无'}
              </li>
              <li
                data-ok={readiness.hasConversation ? '1' : '0'}
                data-testid="shell-check-conversation"
              >
                <span className="st-app-shell__readiness-dot" aria-hidden="true" />
                对话列 {readiness.hasConversation ? '有' : '无'}
              </li>
              <li data-ok={readiness.hasCompose ? '1' : '0'} data-testid="shell-check-compose">
                <span className="st-app-shell__readiness-dot" aria-hidden="true" />
                Compose {readiness.hasCompose ? '有' : '无'}
              </li>
              <li
                data-ok={readiness.hasContextRail ? '1' : '0'}
                data-testid="shell-check-continuum"
              >
                <span className="st-app-shell__readiness-dot" aria-hidden="true" />
                连续体 {readiness.hasContextRail ? '有' : '无'}
              </li>
              <li
                data-ok={readiness.hasTrace && !readiness.traceCollapsed ? '1' : '0'}
                data-testid="shell-check-trace"
              >
                <span className="st-app-shell__readiness-dot" aria-hidden="true" />
                轨迹 {readiness.traceCollapsed ? '已折' : readiness.hasTrace ? '展开' : '无'}
              </li>
              <li data-ok={readiness.theme ? '1' : '0'} data-testid="shell-check-theme">
                <span className="st-app-shell__readiness-dot" aria-hidden="true" />
                主题 {readiness.themeLabel}
              </li>
            </ul>
            <p className="st-app-shell__readiness-note" data-testid="app-shell-readiness-note">
              {readiness.note}
            </p>
          </div>
        )}

        {collapsed ? (
          <p
            className="st-app-shell__trace-collapsed-hint"
            data-testid="shell-trace-collapsed-hint"
          >
            已折叠 · Run 不暂停 · Ctrl+\\ 展开
          </p>
        ) : (
          <div className="st-app-shell__trace-body">{props.trace}</div>
        )}
      </aside>
    </div>
  );
}
