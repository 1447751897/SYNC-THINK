import { useMemo } from 'react';
import { Layers3 } from 'lucide-react';
import type { ParticipationMode } from '@sync-think/shared';

// ModeSwitch — segmented control. Only these three modes per §5.2. Indicator
// colour is an accent; the selected segment carries aria-pressed and selected
// attribute so screen readers see the state independently (§15.4).
// M1: conversation primary; collaboration/automatic remain visible but typically
// disabled until M2 (orchestration). Soft readiness strip makes the gate observable.

export type ModeReadinessLevel = 'm1' | 'm2-open' | 'mixed' | 'locked';

export interface ModeReadiness {
  level: ModeReadinessLevel;
  badge: string;
  value: ParticipationMode;
  conversationOpen: boolean;
  collaborationOpen: boolean;
  automaticOpen: boolean;
  isConversation: boolean;
  isCollaboration: boolean;
  isAutomatic: boolean;
  m2Locked: boolean;
  note: string;
}

export interface ModeSwitchProps {
  value: ParticipationMode;
  onChange: (value: ParticipationMode) => void;
  approvedPlan?: boolean;
  applicablePolicy?: boolean;
  /** Hide the readiness strip (dense embeds / tests). */
  hideReadiness?: boolean;
}

const MODE_LABEL: Record<ParticipationMode, string> = {
  conversation: '对话',
  collaboration: '协作',
  automatic: '自动',
};

const MODE_HINT: Record<ParticipationMode, string> = {
  conversation: '单 Agent 多模型对话（M1）',
  collaboration: '多 Agent 协作（M2）',
  automatic: '自动编排（M2）',
};

/** Pure projector for tests + UI — §5.2 participation mode observability. */
export function projectModeReadiness(input: {
  value: ParticipationMode;
  approvedPlan?: boolean;
  applicablePolicy?: boolean;
}): ModeReadiness {
  const value = input.value;
  const collaborationOpen = true;
  const automaticOpen = input.approvedPlan === true && input.applicablePolicy === true;
  const conversationOpen = true;
  const isConversation = value === 'conversation';
  const isCollaboration = value === 'collaboration';
  const isAutomatic = value === 'automatic';
  const m2Locked = !automaticOpen;

  const level: ModeReadinessLevel = automaticOpen ? 'm2-open' : 'locked';
  const badge = automaticOpen ? 'M2 已开' : '门控需要计划 + 策略';
  const note = automaticOpen
    ? '协作与自动已开放 · 切换模式会改变编排参与方式'
    : '自动模式需要当前任务已批准计划且具有适用策略。';

  return {
    level,
    badge,
    value,
    conversationOpen,
    collaborationOpen,
    automaticOpen,
    isConversation,
    isCollaboration,
    isAutomatic,
    m2Locked,
    note,
  };
}

export function ModeSwitch(props: ModeSwitchProps) {
  const modes: ParticipationMode[] = ['conversation', 'collaboration', 'automatic'];
  const readiness = useMemo(
    () =>
      projectModeReadiness({
        value: props.value,
        approvedPlan: props.approvedPlan,
        applicablePolicy: props.applicablePolicy,
      }),
    [props.value, props.approvedPlan, props.applicablePolicy],
  );

  return (
    <div
      className="st-mode-switch-wrap"
      data-testid="mode-switch-wrap"
      data-level={readiness.level}
      data-mode={props.value}
    >
      {props.hideReadiness ? null : (
        <div
          className="st-mode-switch__readiness"
          data-testid="mode-switch-readiness"
          data-level={readiness.level}
          aria-label="参与模式就绪"
        >
          <div className="st-mode-switch__readiness-head">
            <Layers3 size={12} strokeWidth={1.8} aria-hidden="true" />
            <span>参与模式</span>
            <small>§5.2 · M1/M2 门</small>
            <strong data-testid="mode-switch-readiness-badge">{readiness.badge}</strong>
          </div>
          <ul className="st-mode-switch__readiness-list">
            <li data-ok={readiness.isConversation ? '1' : '0'} data-testid="mode-check-conversation">
              <span className="st-mode-switch__readiness-dot" aria-hidden="true" />
              对话 {readiness.isConversation ? '当前' : '可选'} · M1
            </li>
            <li
              data-ok={readiness.collaborationOpen ? '1' : '0'}
              data-testid="mode-check-collaboration"
            >
              <span className="st-mode-switch__readiness-dot" aria-hidden="true" />
              协作 {readiness.collaborationOpen ? (readiness.isCollaboration ? '当前' : '已开') : '锁定 · M2'}
            </li>
            <li
              data-ok={readiness.automaticOpen ? '1' : '0'}
              data-testid="mode-check-automatic"
            >
              <span className="st-mode-switch__readiness-dot" aria-hidden="true" />
              自动 {readiness.automaticOpen ? (readiness.isAutomatic ? '当前' : '已开') : '锁定 · M2'}
            </li>
            <li data-ok={readiness.m2Locked ? '1' : '0'} data-testid="mode-check-gate">
              <span className="st-mode-switch__readiness-dot" aria-hidden="true" />
              {readiness.m2Locked ? '门控 · 仅对话' : '门控 · 已放行'}
            </li>
          </ul>
          <p className="st-mode-switch__readiness-note" data-testid="mode-switch-readiness-note">
            {readiness.note}
          </p>
        </div>
      )}

      <div className="st-mode-switch" role="group" aria-label="参与模式">
        {modes.map((m) => {
          return (
            <button
              key={m}
              type="button"
              data-mode={m}
              data-selected={props.value === m}
              aria-pressed={props.value === m}
              aria-label={`${MODE_LABEL[m]}模式`}
              title={MODE_HINT[m]}
              disabled={m === 'automatic' && !readiness.automaticOpen}
              onClick={() => props.onChange(m)}
              data-testid={`mode-switch-${m}`}
            >
              {MODE_LABEL[m]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
