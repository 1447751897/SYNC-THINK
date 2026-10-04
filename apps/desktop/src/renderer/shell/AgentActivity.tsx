/**
 * Be UI Agent Activity local adaptation (MIT).
 * Copyright (c) 2026 Saurabh Chauhan. See third-party/beui-code-block.LICENSE.
 * Uses the existing durable process rows in the conversation flow. The chat
 * owns scrolling and following; this surface never clips or scrolls the trace
 * independently. No synthetic steps or progress percentages are generated.
 */
import { createContext, type ReactNode } from 'react';
import { Check, CircleAlert, CircleDashed, CircleStop, LoaderCircle, Pause, Shield } from 'lucide-react';

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

/** Natural-height execution record; the surrounding conversation owns scrolling. */
export function AgentActivityViewport({ children, state, onInspect }: {
  children: ReactNode; state: AgentActivityState; runId?: string; onInspect?: () => void;
}) {
  return <div className="shell-agent-activity" data-state={state} data-layout="flow">
    <div className="shell-agent-activity__viewport" data-testid="agent-activity-viewport"
      role="region" aria-label="执行活动记录"
      onContextMenuCapture={() => onInspect?.()}
      onWheelCapture={event => { if (event.deltaY < 0) onInspect?.(); }}
      onTouchStart={() => { if (state === 'working') onInspect?.(); }}
      onKeyDownCapture={event => {
        if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) onInspect?.();
      }}
      onPointerDownCapture={event => {
        if (event.target instanceof Element && event.target.closest('pre, code, .shell-beui-code, .shell-tool-result')) onInspect?.();
      }}
      onClickCapture={event => {
        if (event.target instanceof Element && event.target.closest('button, a, summary, input, textarea, [role="button"]')) onInspect?.();
      }}>
      <div className="shell-agent-activity__content">{children}</div>
    </div>
  </div>;
}
