import type { GoalStatusState } from '@sync-think/protocol';
import { Lightbulb, ListChecks, Target, X } from 'lucide-react';

export type ComposerActiveMode = 'help' | 'plan' | 'goal';
export type ComposerSuggestedMode = Exclude<ComposerActiveMode, 'help'>;

export interface ComposerActiveModePillProps {
  mode: ComposerActiveMode;
  goalStatus?: GoalStatusState;
  onClick(): void;
}

/** NewMax toolbar pill: the mode icon morphs to close on hover. */
export function ComposerActiveModePill(props: ComposerActiveModePillProps) {
  const help = props.mode === 'help';
  const plan = props.mode === 'plan';
  const activeGoal = props.goalStatus === 'active';
  const pausedGoal = props.goalStatus === 'paused' || props.goalStatus === 'blocked';
  const label = help
    ? '帮助'
    : plan
      ? '规划'
      : activeGoal
        ? '目标运行中'
        : pausedGoal
          ? '目标已暂停'
          : '目标';
  const ariaLabel = help
    ? '退出帮助模式'
    : plan
      ? '退出规划模式'
      : activeGoal
        ? '暂停目标'
        : pausedGoal
          ? '继续目标'
          : '退出目标模式';
  const ModeIcon = help ? Lightbulb : plan ? ListChecks : Target;

  return (
    <button
      type="button"
      className="shell-composer-active-mode-pill"
      data-mode={props.mode}
      data-goal-status={props.goalStatus}
      aria-label={ariaLabel}
      title={ariaLabel}
      onMouseDown={(event) => event.preventDefault()}
      onClick={props.onClick}
    >
      <span className="shell-composer-active-mode-pill__icon" aria-hidden="true">
        <ModeIcon data-mode-icon size={18} />
        <X data-close-icon size={18} />
      </span>
      <span>{label}</span>
    </button>
  );
}

export interface ComposerModeKeywordHintProps {
  kind: ComposerSuggestedMode;
  onAccept(): void;
  onDismiss(): void;
}

/** NewMax ordinary-text mode suggestion shown above the composer. */
export function ComposerModeKeywordHint(props: ComposerModeKeywordHintProps) {
  const plan = props.kind === 'plan';
  const ModeIcon = plan ? ListChecks : Target;
  const title = plan ? '创建规划' : '创建目标';
  const action = plan ? '使用规划模式' : '使用目标模式';

  return (
    <div
      className="shell-composer-mode-keyword-hint"
      data-testid="composer-mode-keyword-hint"
      role="status"
    >
      <ModeIcon size={17} aria-hidden="true" />
      <span className="shell-composer-mode-keyword-hint__title">{title}</span>
      <kbd>Shift + Tab</kbd>
      <button
        type="button"
        className="shell-composer-mode-keyword-hint__accept"
        onMouseDown={(event) => event.preventDefault()}
        onClick={props.onAccept}
        aria-label={action}
      >
        {action}
      </button>
      <button
        type="button"
        className="shell-composer-mode-keyword-hint__dismiss"
        onMouseDown={(event) => event.preventDefault()}
        onClick={props.onDismiss}
        aria-label={`关闭${plan ? '规划' : '目标'}模式建议`}
      >
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  );
}
