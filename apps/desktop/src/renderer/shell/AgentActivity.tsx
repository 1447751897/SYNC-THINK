/**
 * Be UI Agent Activity local adaptation (MIT).
 * Copyright (c) 2026 Saurabh Chauhan. See third-party/beui-code-block.LICENSE.
 * Uses the existing durable process rows, with a scrollable live window instead
 * of translating/clipping the stream. Readers can inspect tools without losing
 * their place; no synthetic steps or progress percentages are generated.
 */
import { createContext, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, Check, CircleAlert, CircleDashed, CircleStop, LoaderCircle, Pause, Shield } from 'lucide-react';

export type AgentActivityState = 'working' | 'approval' | 'complete' | 'failed' | 'cancelled' | 'paused' | 'recorded';

export function agentActivityState(input: {
  streaming?: boolean;
  waitingForApproval?: boolean;
  terminalState?: 'failed' | 'cancelled' | 'paused';
  answerStarted?: boolean;
  completedAt?: string;
}): AgentActivityState {
  if (input.terminalState) return input.terminalState;
  if (input.waitingForApproval) return 'approval';
  if (input.streaming) return 'working';
  return input.answerStarted || input.completedAt ? 'complete' : 'recorded';
}

export const AgentActivityStateContext = createContext<AgentActivityState | undefined>(undefined);

const labels: Record<AgentActivityState, string> = {
  working: '进行中', approval: '待批准', complete: '已完成', failed: '执行失败',
  cancelled: '已停止', paused: '已暂停', recorded: '执行记录',
};
const icons = { working: LoaderCircle, approval: Shield, complete: Check, failed: CircleAlert,
  cancelled: CircleStop, paused: Pause, recorded: CircleDashed };

export function AgentActivityStatus({ state, hasFailures }: { state: AgentActivityState; hasFailures?: boolean }) {
  const Icon = state === 'complete' && hasFailures ? CircleAlert : icons[state];
  return <span className="shell-agent-activity__status" data-state={state} data-warning={hasFailures || undefined} data-testid="agent-activity-status">
    <Icon size={13} aria-hidden="true" />
    <span>{state === 'complete' && hasFailures ? '执行结束' : labels[state]}</span>
  </span>;
}

/** A bounded, keyboard-scrollable viewport shared by all conversation identities. */
export function AgentActivityViewport({ children, state, runId, onInspect, onReadingChange }: {
  children: ReactNode; state: AgentActivityState; runId?: string; onInspect?: () => void; onReadingChange?: (reading: boolean) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const active = state === 'working';
  const followingRef = useRef(active || state === 'approval');
  const inspectingRef = useRef(false);
  const [following, setFollowing] = useState(active || state === 'approval');
  const [edges, setEdges] = useState({ above: false, below: false });
  const expectedScrollRef = useRef<number | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  const setFollow = useCallback((value: boolean) => {
    followingRef.current = value;
    setFollowing(value);
  }, []);
  const measure = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (activeRef.current && followingRef.current) {
      const end = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      if (Math.abs(viewport.scrollTop - end) > 1) {
        expectedScrollRef.current = end;
        viewport.scrollTop = end;
      }
    }
    const above = viewport.scrollTop > 2;
    const below = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop > 2;
    setEdges(previous => previous.above === above && previous.below === below ? previous : { above, below });
  }, []);
  const pause = useCallback((inspecting = false) => {
    expectedScrollRef.current = null;
    inspectingRef.current = inspecting;
    setFollow(false);
    onReadingChange?.(true);
  }, [onReadingChange, setFollow]);
  const resume = useCallback(() => {
    inspectingRef.current = false;
    setFollow(true);
    onReadingChange?.(false);
    measure();
  }, [measure, onReadingChange, setFollow]);

  useLayoutEffect(() => {
    inspectingRef.current = false;
    expectedScrollRef.current = null;
    setFollow(activeRef.current || state === 'approval');
    onReadingChange?.(false);
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
    measure();
  }, [runId, measure, setFollow, onReadingChange]);
  useEffect(() => () => onReadingChange?.(false), [onReadingChange]);
  useLayoutEffect(() => {
    // An approval pause preserves the reading position. Resuming the run follows
    // only if the reader had not explicitly scrolled away or opened a detail.
    measure();
  }, [active, measure]);
  useLayoutEffect(() => {
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    if (contentRef.current) observer.observe(contentRef.current);
    if (viewportRef.current) observer.observe(viewportRef.current);
    return () => observer.disconnect();
  }, [measure]);
  useEffect(() => {
    // Also handle DOM updates in environments without ResizeObserver.
    measure();
  }, [children, measure]);

  return <div className="shell-agent-activity" data-state={state} data-following={following ? 'true' : 'false'}>
    <div className="shell-agent-activity__window" data-above={edges.above || undefined} data-below={edges.below || undefined}>
      <div ref={viewportRef} className="shell-agent-activity__viewport" data-testid="agent-activity-viewport"
        role="region" aria-label="执行活动记录" tabIndex={0}
        onContextMenuCapture={() => pause(true)}
        onWheel={event => {
          const viewport = viewportRef.current;
          if (event.deltaY < 0 && viewport && viewport.scrollHeight > viewport.clientHeight) pause();
        }}
        onTouchStart={() => { if (active) pause(); }}
        onKeyDownCapture={event => {
          if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) pause(true);
        }}
        onPointerDownCapture={event => {
          if (event.target instanceof Element && event.target.closest('pre, code, .shell-beui-code, .shell-tool-result')) pause(true);
        }}
        onClickCapture={event => {
          if (!(event.target instanceof Element) || !event.target.closest('button, a, summary, input, textarea, [role="button"]')) return;
          pause(true);
          onInspect?.();
        }}
        onScroll={() => {
          const viewport = viewportRef.current;
          if (!viewport) return;
          if (expectedScrollRef.current !== null && Math.abs(viewport.scrollTop - expectedScrollRef.current) <= 1) {
            expectedScrollRef.current = null;
          } else if (activeRef.current && !inspectingRef.current) {
            const atEnd = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 20;
            setFollow(atEnd);
            onReadingChange?.(!atEnd);
          }
          measure();
        }}>
        <div ref={contentRef} className="shell-agent-activity__content">{children}</div>
      </div>
    </div>
    {active && !following ? <div className="shell-agent-activity__resume-row">
      <span>正在查看先前活动</span>
      <button type="button" className="shell-agent-activity__resume" onClick={resume}>
        <ArrowDown size={12} aria-hidden="true" />回到最新活动
      </button>
    </div> : null}
  </div>;
}
