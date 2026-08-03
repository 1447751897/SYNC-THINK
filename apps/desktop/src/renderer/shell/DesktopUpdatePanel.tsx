import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Download,
  PackageCheck,
  RefreshCw,
  Radio,
  ShieldCheck,
} from 'lucide-react';
import clsx from 'clsx';
import type {
  DesktopUpdateActionResult,
  DesktopUpdatePhase,
  DesktopUpdateSnapshot,
} from '../../desktop-update-contract.js';

const PHASE_LABELS: Record<DesktopUpdatePhase, string> = {
  disabled: '更新通道未启用',
  idle: '等待检查更新',
  checking: '正在检查更新…',
  available: '发现可用更新',
  'up-to-date': '当前已是最新版本',
  downloading: '正在下载安装包…',
  downloaded: '安装包已就绪',
  installing: '正在安全退出并启动安装…',
  error: '更新操作需要处理',
};

const PHASE_TONES: Record<
  DesktopUpdatePhase,
  'neutral' | 'info' | 'success' | 'warning' | 'error'
> = {
  disabled: 'neutral',
  idle: 'neutral',
  checking: 'info',
  available: 'info',
  'up-to-date': 'success',
  downloading: 'info',
  downloaded: 'success',
  installing: 'warning',
  error: 'error',
};

const ERROR_LABELS: Record<string, string> = {
  'desktop.update.feed-invalid': '更新通道地址配置无效。',
  'desktop.update.channel-invalid': '更新通道名称配置无效。',
  'desktop.update.token-invalid': '更新通道凭据配置无效。',
  'desktop.update.dev-disabled': '开发构建未显式允许更新测试。',
  'desktop.update.check-failed': '检查更新失败，请稍后重试。',
  'desktop.update.download-failed': '更新下载失败，请重新下载。',
  'desktop.update.channel-unavailable': '更新通道暂不可用，请检查发布通道。',
  'desktop.update.metadata-invalid': '更新元数据无效，已停止本次更新。',
  'desktop.update.checksum-mismatch': '安装包校验失败，已丢弃本次下载。',
  'desktop.update.install-failed': '安装准备失败，请重启应用后重试。',
  'desktop.update.provider-failed': '更新服务返回异常。',
  'desktop.update.action-busy': '已有更新操作正在进行。',
  'desktop.update.action-invalid': '当前状态不允许执行该操作。',
  'desktop.update.disabled': '当前构建未配置私有更新通道。',
  'desktop.update.initialization-failed': '更新组件初始化失败。',
};

type UpdateAction = () => Promise<DesktopUpdateActionResult>;
type UpdateActionKind = 'check' | 'download' | 'install';
type StepState = 'pending' | 'current' | 'complete' | 'locked';

interface UpdateStep {
  id: UpdateActionKind;
  label: string;
  detail: string;
  state: StepState;
}

function resolveStepStates(snapshot: DesktopUpdateSnapshot | null): UpdateStep[] {
  const phase = snapshot?.phase;
  const disabled = !snapshot || phase === 'disabled';
  const checkComplete =
    phase === 'available' ||
    phase === 'up-to-date' ||
    phase === 'downloading' ||
    phase === 'downloaded' ||
    phase === 'installing';
  const downloadComplete = phase === 'downloaded' || phase === 'installing';

  return [
    {
      id: 'check',
      label: '检查',
      detail: '读取通道版本',
      state: disabled
        ? 'locked'
        : checkComplete
          ? 'complete'
          : phase === 'idle' || phase === 'checking' || phase === 'error'
            ? 'current'
            : 'pending',
    },
    {
      id: 'download',
      label: '下载',
      detail: '校验完整安装包',
      state: disabled
        ? 'locked'
        : downloadComplete
          ? 'complete'
          : phase === 'available' || phase === 'downloading'
            ? 'current'
            : 'pending',
    },
    {
      id: 'install',
      label: '安装',
      detail: '安全退出并升级',
      state: disabled
        ? 'locked'
        : phase === 'downloaded' || phase === 'installing'
          ? 'current'
          : 'pending',
    },
  ];
}

function formatStatusTime(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return fallback;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(timestamp);
}

export function DesktopUpdatePanel() {
  const [snapshot, setSnapshot] = useState<DesktopUpdateSnapshot | null>(null);
  const [pendingAction, setPendingAction] = useState<UpdateActionKind | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const bridge = window.syncThink?.updates;
    if (!bridge) return;
    let active = true;
    const unsubscribe = bridge.subscribeState((next) => {
      if (active) setSnapshot(next);
    });
    void bridge
      .getState()
      .then((next) => {
        if (active) setSnapshot(next);
      })
      .catch(() => {
        if (active) setActionError('desktop.update.initialization-failed');
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  async function runAction(kind: UpdateActionKind, action: UpdateAction) {
    setPendingAction(kind);
    setActionError(null);
    try {
      const result = await action();
      setSnapshot(result.state);
      setActionError(result.errorCode);
    } catch {
      setActionError(`desktop.update.${kind}-failed`);
    } finally {
      setPendingAction(null);
    }
  }

  const bridge = window.syncThink?.updates;
  const phase = snapshot?.phase;
  const configured = snapshot?.configured === true;
  const canCheck =
    configured &&
    pendingAction === null &&
    phase !== 'checking' &&
    phase !== 'downloading' &&
    phase !== 'downloaded' &&
    phase !== 'installing';
  const canDownload = configured && pendingAction === null && phase === 'available';
  const canInstall = configured && pendingAction === null && phase === 'downloaded';
  const statusLabel = snapshot
    ? snapshot.phase === 'available' && snapshot.availableVersion
      ? `发现新版本 ${snapshot.availableVersion}`
      : snapshot.phase === 'downloading' && snapshot.progressPercent !== null
        ? `正在下载安装包 ${snapshot.progressPercent.toFixed(1)}%`
        : PHASE_LABELS[snapshot.phase]
    : '正在读取更新状态…';
  const visibleError = actionError ?? snapshot?.errorCode ?? null;
  const steps = resolveStepStates(snapshot);
  const phaseTone = snapshot ? PHASE_TONES[snapshot.phase] : 'neutral';
  const targetVersion = snapshot?.availableVersion ?? null;
  const checkedLabel = formatStatusTime(snapshot?.checkedAt, '尚未检查');
  const downloadLabel = formatStatusTime(snapshot?.downloadedAt, '等待下载');
  const progressPercent = snapshot?.progressPercent ?? 0;

  return (
    <section
      className={clsx('settings-update-panel', snapshot && `is-${snapshot.phase}`)}
      aria-label="桌面更新"
    >
      <header className="settings-update-panel__header">
        <div className="settings-update-panel__heading">
          <span className="settings-update-panel__icon" aria-hidden="true">
            <PackageCheck size={18} strokeWidth={1.8} />
          </span>
          <div>
            <p className="settings-update-panel__eyebrow">DESKTOP RELEASE</p>
            <h3>桌面发布通道</h3>
            <span>手动检查、下载并安装经过完整性校验的版本。</span>
          </div>
        </div>
        <div
          className={clsx('settings-update-status', `is-${phaseTone}`)}
          aria-live="polite"
          data-phase={phase ?? 'loading'}
        >
          <span aria-hidden="true" />
          {statusLabel}
        </div>
      </header>

      <div className="settings-update-version-lane" aria-label="版本信息">
        <div className="settings-update-version-block">
          <span>当前版本</span>
          <strong>{snapshot?.currentVersion ?? '读取中'}</strong>
          <small>本机正在运行</small>
        </div>
        <div className={clsx('settings-update-version-arrow', targetVersion && 'is-ready')}>
          <ArrowRight size={18} strokeWidth={1.7} aria-hidden="true" />
        </div>
        <div
          className={clsx(
            'settings-update-version-block',
            'is-target',
            targetVersion && 'is-ready',
          )}
        >
          <span>目标版本</span>
          <strong>{targetVersion ?? '等待检查'}</strong>
          <small>{targetVersion ? '来自受控发布通道' : '检查后显示可用版本'}</small>
        </div>
      </div>

      <div className="settings-update-facts" aria-label="更新通道详情">
        <span>
          <Radio size={14} aria-hidden="true" />
          <span>
            <small>发布通道</small>
            <code>{snapshot?.channel ?? '读取中'}</code>
          </span>
        </span>
        <span>
          <ShieldCheck size={14} aria-hidden="true" />
          <span>
            <small>完整性保护</small>
            <strong>SHA-512 完整性校验</strong>
          </span>
        </span>
        <span>
          <span>
            <small>上次检查</small>
            <strong>{checkedLabel}</strong>
          </span>
        </span>
        <span>
          <span>
            <small>下载状态</small>
            <strong>{downloadLabel}</strong>
          </span>
        </span>
      </div>

      <ol className="settings-update-steps" aria-label="更新流程">
        {steps.map((step, index) => (
          <li
            key={step.id}
            className={clsx(`is-${step.state}`)}
            aria-current={step.state === 'current' ? 'step' : undefined}
          >
            <span className="settings-update-step__marker" aria-hidden="true">
              {step.state === 'complete' ? <Check size={13} strokeWidth={2.4} /> : index + 1}
            </span>
            <span className="settings-update-step__copy">
              <strong>{step.label}</strong>
              <small>{step.detail}</small>
            </span>
          </li>
        ))}
      </ol>

      {snapshot?.phase === 'downloading' && snapshot.progressPercent !== null ? (
        <div className="settings-update-progress-wrap">
          <div className="settings-update-progress__label">
            <span>正在接收安装包</span>
            <strong>{snapshot.progressPercent.toFixed(1)}%</strong>
          </div>
          <div
            className="settings-update-progress"
            role="progressbar"
            aria-label="更新下载进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={snapshot.progressPercent}
          >
            <span style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }} />
          </div>
        </div>
      ) : null}

      {visibleError ? (
        <div className="settings-update-alert" role="alert">
          <AlertTriangle size={15} aria-hidden="true" />
          <div>
            <strong>本次更新已停止</strong>
            <span>{ERROR_LABELS[visibleError] ?? '更新操作失败，请稍后重试。'}</span>
          </div>
        </div>
      ) : null}

      {!configured && snapshot ? (
        <p className="settings-update-disabled-note">
          当前构建未配置私有更新通道。配置完成前，应用不会访问更新网络。
        </p>
      ) : null}

      <footer className="settings-update-panel__footer">
        <p>更新只在你主动操作时执行；安装前会先安全停止 Runtime 与桌面服务。</p>
        <div className="settings-update-actions">
          <button
            type="button"
            className={clsx(canCheck && 'is-primary')}
            disabled={!canCheck || !bridge}
            onClick={() =>
              bridge ? void runAction('check', () => bridge.checkForUpdates()) : undefined
            }
          >
            <RefreshCw
              size={14}
              className={pendingAction === 'check' ? 'is-spinning' : undefined}
              aria-hidden="true"
            />
            {pendingAction === 'check' || phase === 'checking' ? '检查中…' : '检查更新'}
          </button>
          <button
            type="button"
            className={clsx(canDownload && 'is-primary')}
            disabled={!canDownload || !bridge}
            onClick={() =>
              bridge ? void runAction('download', () => bridge.downloadUpdate()) : undefined
            }
          >
            <Download size={14} aria-hidden="true" />
            {pendingAction === 'download' || phase === 'downloading' ? '下载中…' : '下载更新'}
          </button>
          <button
            type="button"
            className={clsx(canInstall && 'is-primary')}
            disabled={!canInstall || !bridge}
            onClick={() =>
              bridge ? void runAction('install', () => bridge.installUpdate()) : undefined
            }
          >
            <PackageCheck size={14} aria-hidden="true" />
            {pendingAction === 'install' || phase === 'installing' ? '正在重启…' : '重启并安装'}
          </button>
        </div>
      </footer>
    </section>
  );
}
