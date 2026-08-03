import { AlertCircle, CheckCircle2, ExternalLink, LoaderCircle, XCircle } from 'lucide-react';
import type { BrowserHandoffSummary } from '@sync-think/protocol';

const REASON_LABELS: Record<BrowserHandoffSummary['reason'], string> = {
  login: '登录或验证身份',
  captcha: '完成人机验证',
  payment: '确认支付信息',
  'device-confirmation': '确认设备或安全提示',
  manual: '完成人工操作',
};

interface BrowserHandoffCardProps {
  handoff: BrowserHandoffSummary;
  busy: boolean;
  error?: string;
  onContinue(): void;
  onCancel(): void;
}

export function BrowserHandoffCard({
  handoff,
  busy,
  error,
  onContinue,
  onCancel,
}: BrowserHandoffCardProps) {
  const cancelLabel =
    handoff.onCancel === 'close-page'
      ? '取消并关闭页面'
      : '取消本次操作';
  return (
    <section
      className="shell-browser-handoff"
      data-testid={`browser-handoff-${handoff.handoffId}`}
      aria-labelledby={`browser-handoff-title-${handoff.handoffId}`}
    >
      <div className="shell-browser-handoff__icon" aria-hidden="true">
        <ExternalLink size={18} />
      </div>
      <div className="shell-browser-handoff__content">
        <div className="shell-browser-handoff__eyebrow">
          <span className="shell-browser-handoff__state">
            {busy ? (
              <LoaderCircle size={12} className="shell-process-spin" />
            ) : (
              <AlertCircle size={12} />
            )}
            任务已暂停
          </span>
          <span className="shell-browser-handoff__reason">{REASON_LABELS[handoff.reason]}</span>
        </div>
        <h3 id={`browser-handoff-title-${handoff.handoffId}`}>
          需要你在系统浏览器中完成操作
        </h3>
        <p className="shell-browser-handoff__description">
          请切换到系统 Edge 或 Chrome，完成下面的操作。完成后回到这里继续任务。
        </p>
        <dl className="shell-browser-handoff__details">
          <div>
            <dt>网站</dt>
            <dd>{handoff.siteOrigin}</dd>
          </div>
          <div>
            <dt>目标</dt>
            <dd>{handoff.requestedOutcome}</dd>
          </div>
        </dl>
        {error ? (
          <p className="shell-browser-handoff__error" role="alert">
            <AlertCircle size={13} />
            {error}
          </p>
        ) : null}
        <div className="shell-browser-handoff__actions">
          <button
            type="button"
            className="shell-browser-handoff__button shell-browser-handoff__button--primary"
            disabled={busy || !handoff.canContinue}
            onClick={onContinue}
          >
            {busy ? (
              <LoaderCircle size={14} className="shell-process-spin" />
            ) : (
              <CheckCircle2 size={14} />
            )}
            我已完成，继续
          </button>
          <button
            type="button"
            className="shell-browser-handoff__button shell-browser-handoff__button--cancel"
            disabled={busy || !handoff.canCancel}
            onClick={onCancel}
          >
            <XCircle size={14} />
            {cancelLabel}
          </button>
        </div>
      </div>
    </section>
  );
}

export function BrowserHandoffQueryError(props: { busy: boolean; onRetry(): void }) {
  return (
    <div className="shell-browser-handoff-query-error" role="alert">
      <AlertCircle size={14} />
      <span>无法读取浏览器接管状态，请检查 Runtime 连接后重试。</span>
      <button type="button" disabled={props.busy} onClick={props.onRetry}>
        {props.busy ? <LoaderCircle size={13} className="shell-process-spin" /> : null}
        重试
      </button>
    </div>
  );
}
