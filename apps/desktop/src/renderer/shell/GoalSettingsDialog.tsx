import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

export interface GoalSettingsValues {
  condition: string;
  stopCondition: string;
  maxGoalRounds: number;
  maxGoalTokens: number;
}

export interface GoalSettingsDialogProps {
  open: boolean;
  mode?: 'create' | 'edit';
  initialValues?: Partial<GoalSettingsValues>;
  submitting?: boolean;
  onOpenChange(open: boolean): void;
  onSubmit(values: GoalSettingsValues): void | Promise<void>;
}

export const DEFAULT_GOAL_SETTINGS: Readonly<GoalSettingsValues> = {
  condition: '',
  stopCondition: '',
  maxGoalRounds: 10,
  maxGoalTokens: 1_000_000,
};

const DANGER_RE = /rm\s+-rf|force\s*push|drop\s+table|truncate\s+table|delete\s+from|format\s+[a-z]:|mkfs\b/i;
const MIN_GOAL_ROUNDS = 1;
const MAX_GOAL_ROUNDS = 50;
const MIN_GOAL_TOKENS = 10_000;

function clampGoalRounds(value: string): number {
  return Math.max(
    MIN_GOAL_ROUNDS,
    Math.min(MAX_GOAL_ROUNDS, Number(value) || DEFAULT_GOAL_SETTINGS.maxGoalRounds),
  );
}

function clampGoalTokens(value: string): number {
  return Math.max(MIN_GOAL_TOKENS, Number(value) || DEFAULT_GOAL_SETTINGS.maxGoalTokens);
}

export function goalRequiresRiskConfirmation(condition: string): boolean {
  return DANGER_RE.test(condition);
}

export interface GoalRiskConfirmationDialogProps {
  open: boolean;
  submitting?: boolean;
  onOpenChange(open: boolean): void;
  onContinue(): void;
}

export function GoalRiskConfirmationDialog(props: GoalRiskConfirmationDialogProps) {
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="goal-settings-dialog__overlay goal-settings-dialog__danger-overlay fixed inset-0 z-[9120] bg-[var(--color-cap-dialog-overlay)]" />
        <Dialog.Content
          data-testid="goal-risk-confirmation-dialog"
          className="goal-settings-dialog__content goal-settings-dialog__danger-content fixed left-1/2 top-1/2 z-[9121] flex max-h-[calc(100vh-64px)] w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[18px] bg-page px-6 pb-6 pt-[18px] text-text shadow-[0_24px_70px_var(--color-modal-shadow)] outline-none"
        >
          <header className="goal-settings-dialog__header flex min-h-9 items-center gap-2">
            <Dialog.Title className="m-0 flex min-h-9 min-w-0 flex-1 items-center text-[20px] font-medium leading-7 tracking-[0]">
              高风险操作
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="关闭"
                disabled={props.submitting}
                className="goal-settings-dialog__close -mr-1.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-text-faint hover:bg-hover hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </header>
          <Dialog.Description className="m-0 mt-3 text-[13px] leading-5 text-text">
            目标中包含高风险操作（如 <code>rm -rf</code>、<code>force push</code>、
            <code>DROP TABLE</code> 等）。AI
            在自主循环模式下可能直接执行这些操作，请确认你了解风险。
          </Dialog.Description>
          <footer className="goal-settings-dialog__footer mt-6 flex shrink-0 items-center justify-end gap-2">
            <button
              type="button"
              disabled={props.submitting}
              onClick={() => props.onOpenChange(false)}
              className="goal-settings-dialog__cancel h-9 rounded-full border-0 bg-[color-mix(in_srgb,var(--color-text)_6%,transparent)] px-5 text-[14px] font-medium text-text hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
            >
              返回修改
            </button>
            <button
              type="button"
              disabled={props.submitting}
              onClick={props.onContinue}
              className="goal-settings-dialog__submit h-9 rounded-full border-0 bg-accent px-5 text-[14px] font-medium text-accent-fg hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
            >
              {props.submitting ? '处理中…' : '仍然继续'}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function GoalSettingsDialog(props: GoalSettingsDialogProps) {
  const conditionId = useId();
  const stopConditionId = useId();
  const maxRoundsId = useId();
  const maxTokensId = useId();
  const [condition, setCondition] = useState(
    props.initialValues?.condition ?? DEFAULT_GOAL_SETTINGS.condition,
  );
  const [stopCondition, setStopCondition] = useState(
    props.initialValues?.stopCondition ?? DEFAULT_GOAL_SETTINGS.stopCondition,
  );
  const [maxGoalRounds, setMaxGoalRounds] = useState(
    props.initialValues?.maxGoalRounds ?? DEFAULT_GOAL_SETTINGS.maxGoalRounds,
  );
  const [maxGoalTokens, setMaxGoalTokens] = useState(
    props.initialValues?.maxGoalTokens ?? DEFAULT_GOAL_SETTINGS.maxGoalTokens,
  );
  const [showDangerWarning, setShowDangerWarning] = useState(false);

  useEffect(() => {
    if (!props.open) {
      setShowDangerWarning(false);
      return;
    }
    setCondition(props.initialValues?.condition ?? DEFAULT_GOAL_SETTINGS.condition);
    setShowDangerWarning(false);
  }, [props.initialValues?.condition, props.open]);

  const editing = props.mode === 'edit';
  const disabled = Boolean(props.submitting);
  const canSubmit = condition.trim().length > 0 && stopCondition.trim().length > 0;
  const buildValues = (): GoalSettingsValues => ({
    condition: condition.trim(),
    stopCondition: stopCondition.trim(),
    maxGoalRounds,
    maxGoalTokens,
  });
  const resetForm = () => {
    setCondition(DEFAULT_GOAL_SETTINGS.condition);
    setStopCondition(DEFAULT_GOAL_SETTINGS.stopCondition);
    setMaxGoalRounds(DEFAULT_GOAL_SETTINGS.maxGoalRounds);
    setMaxGoalTokens(DEFAULT_GOAL_SETTINGS.maxGoalTokens);
    setShowDangerWarning(false);
  };
  const submitValues = () => {
    if (!canSubmit) return;
    const values = buildValues();
    resetForm();
    void props.onSubmit(values);
  };
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    if (goalRequiresRiskConfirmation(condition)) {
      setShowDangerWarning(true);
      return;
    }
    submitValues();
  };

  const returnFromDangerWarning = () => {
    setShowDangerWarning(false);
  };

  const continueDangerousGoal = () => {
    submitValues();
  };

  return (
    <>
      <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="goal-settings-dialog__overlay fixed inset-0 z-[9100] bg-[var(--color-cap-dialog-overlay)]" />
          <Dialog.Content
            data-testid="goal-settings-dialog"
            className="goal-settings-dialog__content fixed left-1/2 top-1/2 z-[9101] flex max-h-[calc(100vh-64px)] w-[min(480px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[18px] bg-page px-6 pb-6 pt-[18px] text-text shadow-[0_24px_70px_var(--color-modal-shadow)] outline-none"
          >
          <header className="goal-settings-dialog__header shrink-0">
            <div className="flex min-h-9 items-center gap-2">
              <Dialog.Title className="m-0 flex min-h-9 min-w-0 flex-1 items-center text-[20px] font-medium leading-7 tracking-[0]">
                目标高级设置
              </Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="goal-settings-dialog__close -mr-1.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-text-faint hover:bg-hover hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  aria-label="关闭"
                  disabled={disabled}
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="m-0 pr-10 text-[13px] leading-5 text-text-secondary">
              可选配置；不修改时目标模式会使用默认轮次和预算
            </Dialog.Description>
          </header>

          <form
            className="goal-settings-dialog__form flex min-h-0 flex-1 flex-col"
            noValidate
            onSubmit={handleSubmit}
          >
            <div className="goal-settings-dialog__body -mx-6 mt-3 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-1">
            <div className="goal-settings-dialog__field grid gap-1.5">
              <label htmlFor={conditionId} className="text-[12px] font-medium text-text-secondary">
                目标{' '}
                <span aria-hidden="true" className="text-error">
                  *
                </span>
              </label>
              <input
                id={conditionId}
                type="text"
                aria-label="目标"
                autoFocus
                required
                placeholder="例：整理一份客户拜访计划"
                value={condition}
                onChange={(event) => setCondition(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.preventDefault();
                }}
                disabled={disabled}
                className="goal-settings-dialog__input h-8 w-full rounded-[12px] border-0 bg-control px-[10px] text-[13px] leading-4 text-text outline-none placeholder:text-text-faint"
              />
            </div>

            <div className="goal-settings-dialog__field grid gap-1.5">
              <label htmlFor={stopConditionId} className="text-[12px] font-medium text-text-secondary">
                停止条件{' '}
                <span aria-hidden="true" className="text-error">
                  *
                </span>
              </label>
              <input
                id={stopConditionId}
                type="text"
                aria-label="停止条件"
                required
                placeholder="例：形成一版可直接发送的拜访邮件"
                value={stopCondition}
                onChange={(event) => setStopCondition(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.preventDefault();
                }}
                disabled={disabled}
                className="goal-settings-dialog__input h-8 w-full rounded-[12px] border-0 bg-control px-[10px] text-[13px] leading-4 text-text outline-none placeholder:text-text-faint"
              />
            </div>

            <div className="goal-settings-dialog__limits grid grid-cols-2 gap-3">
              <div className="goal-settings-dialog__field grid gap-1.5">
                <label htmlFor={maxRoundsId} className="text-[12px] font-medium text-text-secondary">
                  最大轮次
                </label>
                <input
                  id={maxRoundsId}
                  type="number"
                  min={1}
                  max={50}
                  step="any"
                  placeholder={String(DEFAULT_GOAL_SETTINGS.maxGoalRounds)}
                  value={String(maxGoalRounds)}
                  onChange={(event) => setMaxGoalRounds(clampGoalRounds(event.target.value))}
                  disabled={disabled}
                  className="goal-settings-dialog__input h-8 w-full rounded-[12px] border-0 bg-control px-[10px] text-[13px] leading-4 tabular-nums text-text outline-none"
                />
              </div>

              <div className="goal-settings-dialog__field grid gap-1.5">
                <label htmlFor={maxTokensId} className="text-[12px] font-medium text-text-secondary">
                  Token 预算
                </label>
                <input
                  id={maxTokensId}
                  type="number"
                  min={10_000}
                  step="any"
                  placeholder={String(DEFAULT_GOAL_SETTINGS.maxGoalTokens)}
                  value={String(maxGoalTokens)}
                  onChange={(event) => setMaxGoalTokens(clampGoalTokens(event.target.value))}
                  disabled={disabled}
                  className="goal-settings-dialog__input h-8 w-full rounded-[12px] border-0 bg-control px-[10px] text-[13px] leading-4 tabular-nums text-text outline-none"
                />
              </div>
            </div>

            <p className="goal-settings-dialog__hint m-0 text-[11px] leading-4 text-text-faint">
              达到最大轮次或 token 预算时自动停止；可在 GoalPanel 随时暂停或取消。
            </p>
            </div>

            <footer className="goal-settings-dialog__footer mt-6 flex shrink-0 items-center justify-end gap-2">
              <Dialog.Close asChild>
                <button
                  type="button"
                  disabled={disabled}
                  className="goal-settings-dialog__cancel h-9 rounded-full border-0 bg-[color-mix(in_srgb,var(--color-text)_6%,transparent)] px-5 text-[14px] font-medium text-text hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
                >
                  取消
                </button>
              </Dialog.Close>
              <button
                type="submit"
                disabled={disabled || !canSubmit}
                className="goal-settings-dialog__submit h-9 rounded-full border-0 bg-accent px-5 text-[14px] font-medium text-accent-fg hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-50"
              >
                {disabled ? '保存中…' : editing ? '保存设置' : '开始'}
              </button>
            </footer>
          </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <GoalRiskConfirmationDialog
        open={showDangerWarning}
        onOpenChange={(open) => {
          if (!open) returnFromDangerWarning();
        }}
        submitting={disabled || !canSubmit}
        onContinue={continueDangerousGoal}
      />
    </>
  );
}
