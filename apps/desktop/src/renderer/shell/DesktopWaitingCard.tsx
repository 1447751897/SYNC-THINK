import {
  AlertCircle,
  CheckCircle2,
  Keyboard,
  LoaderCircle,
  MonitorPause,
  MousePointer2,
  XCircle,
} from 'lucide-react';
import type { DesktopWaitingCommandSummary, DesktopWaitingReason } from '@sync-think/protocol';

const REASON_LABELS: Record<DesktopWaitingReason, string> = {
  'user-input-detected': '检测到人工输入',
  'restart-inspection': '重启后需要检查',
  'attention-required': '需要人工检查',
};

const ACTION_LABELS: Readonly<Record<string, string>> = {
  'focus-element': '聚焦界面元素',
  'invoke-element': '点击或调用界面元素',
  'set-value': '填写界面内容',
  'inspect-window': '检查窗口结构',
  'resolve-selector': '定位界面元素',
  'read-element': '读取界面元素',
  'list-windows': '读取窗口列表',
};

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

interface DesktopWaitingCardProps {
  command: DesktopWaitingCommandSummary;
  busy: boolean;
  error?: string;
  onContinue(): void;
  onCancel(): void;
}

export function DesktopWaitingCard({
  command,
  busy,
  error,
  onContinue,
  onCancel,
}: DesktopWaitingCardProps) {
  const userInputDetected = command.reason === 'user-input-detected';
  const title = userInputDetected ? '桌面操作等待你处理' : '桌面操作需要检查';
  const description = userInputDetected
    ? '检测到你正在使用键盘或鼠标，本次自动操作已停止。'
    : command.reason === 'restart-inspection'
      ? '应用重启后发现一项结果未确认的桌面操作。'
      : '这项桌面操作需要你先检查当前界面状态。';
  const actionLabel = ACTION_LABELS[command.action] ?? command.toolName;
  const targetLabel = command.target?.title || command.target?.appId;

  return (
    <section
      className="shell-desktop-waiting"
      data-testid={`desktop-waiting-${command.commandId}`}
      aria-labelledby={`desktop-waiting-title-${command.commandId}`}
    >
      <div className="shell-desktop-waiting__icon" aria-hidden="true">
        {userInputDetected ? <MousePointer2 size={18} /> : <MonitorPause size={18} />}
      </div>
      <div className="shell-desktop-waiting__content">
        <div className="shell-desktop-waiting__eyebrow">
          <span className="shell-desktop-waiting__state">
            {busy ? (
              <LoaderCircle size={12} className="shell-process-spin" />
            ) : userInputDetected ? (
              <Keyboard size={12} />
            ) : (
              <AlertCircle size={12} />
            )}
            自动操作已停止
          </span>
          <span className="shell-desktop-waiting__reason">{REASON_LABELS[command.reason]}</span>
        </div>
        <h3 id={`desktop-waiting-title-${command.commandId}`}>{title}</h3>
        <p className="shell-desktop-waiting__description">
          {description} 系统没有自动重放此操作。
        </p>
        <dl className="shell-desktop-waiting__details">
          <div>
            <dt>操作</dt>
            <dd>{actionLabel}</dd>
          </div>
          {targetLabel ? (
            <div>
              <dt>窗口</dt>
              <dd>{targetLabel}</dd>
            </div>
          ) : null}
          {command.target?.processId ? (
            <div>
              <dt>进程</dt>
              <dd>PID {command.target.processId}</dd>
            </div>
          ) : null}
          <div>
            <dt>更新时间</dt>
            <dd>{formatUpdatedAt(command.updatedAt)}</dd>
          </div>
        </dl>
        <p className="shell-desktop-waiting__notice">
          请先检查目标应用。继续只确认你已人工处理，不会重新执行原操作；取消会结束这条等待记录。
        </p>
        {error ? (
          <p className="shell-desktop-waiting__error" role="alert">
            <AlertCircle size={13} />
            {error}
          </p>
        ) : null}
        <div className="shell-desktop-waiting__actions">
          <button
            type="button"
            className="shell-desktop-waiting__button shell-desktop-waiting__button--primary"
            disabled={busy || !command.canContinue}
            onClick={onContinue}
          >
            {busy ? (
              <LoaderCircle size={14} className="shell-process-spin" />
            ) : (
              <CheckCircle2 size={14} />
            )}
            我已处理，继续
          </button>
          <button
            type="button"
            className="shell-desktop-waiting__button shell-desktop-waiting__button--cancel"
            disabled={busy || !command.canCancel}
            onClick={onCancel}
          >
            <XCircle size={14} />
            取消等待
          </button>
        </div>
      </div>
    </section>
  );
}

export function DesktopWaitingQueryError(props: { busy: boolean; onRetry(): void }) {
  return (
    <div className="shell-desktop-waiting-query-error" role="alert">
      <AlertCircle size={14} />
      <span>读取桌面等待状态失败，请检查 Runtime 连接后重试。</span>
      <button type="button" disabled={props.busy} onClick={props.onRetry}>
        {props.busy ? <LoaderCircle size={13} className="shell-process-spin" /> : null}
        重试
      </button>
    </div>
  );
}
