import { ChevronRight, CirclePause, CirclePlay, Info, Target, X } from 'lucide-react';
import type { GoalStatus } from '@sync-think/protocol';

interface PlanBannerProps {
  mode: 'plan';
  planModelLabel: string;
  actModelLabel: string;
  onOpenPlanSettings(): void;
  onExitPlan?: () => void;
}

interface GoalBannerProps {
  mode: 'goal';
  goal?: GoalStatus;
  pendingCondition?: string;
  onConfigureGoal?(): void;
  onPauseGoal?(): void;
  onResumeGoal?(): void;
  onClearGoal?(): void;
}

export type ComposerModeBannerProps = PlanBannerProps | GoalBannerProps;

export function truncateGoalCondition(condition: string, maxLength = 40): string {
  const normalized = condition.trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}

export function formatGoalTokens(tokens: number): string {
  return `${Math.max(0, tokens / 1_000).toFixed(0)}k`;
}

export function ComposerModeBanner(props: ComposerModeBannerProps) {
  if (props.mode === 'plan') {
    return (
      <section
        className="shell-composer-mode-banner is-plan"
        data-testid="composer-plan-banner"
        data-composer-mode="plan"
      >
        <Info className="shell-composer-mode-banner__icon" size={14} aria-hidden="true" />
        <div className="shell-composer-mode-banner__copy">
          <strong>规划模式 · 只读</strong>
          <span aria-hidden="true">·</span>
          <span
            className="shell-composer-mode-banner__meta"
            title={`规划模型：${props.planModelLabel} · 执行模型：${props.actModelLabel}`}
          >
            规划模型：{props.planModelLabel} · 执行模型：{props.actModelLabel}
          </span>
        </div>
        <button
          type="button"
          className="shell-composer-mode-banner__link"
          onClick={props.onOpenPlanSettings}
        >
          <span>设置规划/执行模型</span>
          <ChevronRight size={13} aria-hidden="true" />
        </button>
      </section>
    );
  }

  const goal = props.goal;
  const status = goal?.status ?? 'active';
  const condition = goal?.condition ?? props.pendingCondition ?? '';
  const rounds = goal?.roundsStarted ?? goal?.turnCount ?? 0;
  const maxRounds = goal?.maxGoalRounds;
  const tokens = (goal?.tokensIn ?? 0) + (goal?.tokensOut ?? 0);
  const statusLabel =
    goal === undefined
      ? '准备中'
      : status === 'active'
        ? '进行中'
        : status === 'paused'
          ? '已暂停'
          : status === 'blocked'
            ? '已阻塞'
            : status === 'achieved'
              ? '已完成'
              : '已清除';
  const resumable = status === 'paused' || status === 'blocked';

  return (
    <section
      className="shell-composer-mode-banner is-goal"
      data-testid="composer-goal-banner"
      data-composer-mode="goal"
    >
      <Target className="shell-composer-mode-banner__icon" size={15} aria-hidden="true" />
      <div className="shell-composer-mode-banner__copy">
        {goal ? (
          <>
            <strong>{statusLabel}</strong>
            {condition ? (
              <span className="shell-composer-mode-banner__goal" title={condition}>
                · {truncateGoalCondition(condition)}
              </span>
            ) : null}
            <div className="shell-composer-mode-banner__meta">
              <span>
                第 {rounds}
                {maxRounds ? `/${maxRounds}` : ''} 轮
              </span>
              <span aria-hidden="true">·</span>
              <span>{formatGoalTokens(tokens)} token</span>
            </div>
          </>
        ) : (
          <>
            <strong>目标模式</strong>
            <span className="shell-composer-mode-banner__goal">
              输入目标后发送，AI 自主执行直到完成
            </span>
            {props.onConfigureGoal ? (
              <>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  className="shell-composer-mode-banner__link"
                  onClick={props.onConfigureGoal}
                >
                  高级设置
                </button>
              </>
            ) : null}
          </>
        )}
      </div>
      {goal ? (
        <div className="shell-composer-mode-banner__actions">
          {status === 'active' && props.onPauseGoal ? (
            <button
              type="button"
              className="is-icon"
              aria-label="暂停目标"
              onClick={props.onPauseGoal}
            >
              <CirclePause size={15} aria-hidden="true" />
            </button>
          ) : null}
          {resumable && props.onResumeGoal ? (
            <button
              type="button"
              className="is-icon"
              aria-label="继续目标"
              onClick={props.onResumeGoal}
            >
              <CirclePlay size={15} aria-hidden="true" />
            </button>
          ) : null}
          {props.onClearGoal ? (
            <button
              type="button"
              className="is-icon"
              aria-label="清除目标"
              onClick={props.onClearGoal}
            >
              <X size={14} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
