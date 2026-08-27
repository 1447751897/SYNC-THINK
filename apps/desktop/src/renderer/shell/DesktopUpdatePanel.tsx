import { useEffect, useState } from 'react';
import { AlertTriangle, Download, ExternalLink, Info, PackageCheck, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import type {
  DesktopUpdateActionResult,
  DesktopUpdatePhase,
  DesktopUpdateSnapshot,
} from '../../desktop-update-contract.js';
import syncThinkLogo from './assets/sync-think-logo.png';

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
  'desktop.update.disabled': '当前构建未配置更新通道。',
  'desktop.update.initialization-failed': '更新组件初始化失败。',
  'desktop.update.release-notes-open-failed': '打开更新日志失败。',
};

type UpdateAction = () => Promise<DesktopUpdateActionResult>;
type UpdateActionKind = 'check' | 'download' | 'install';

export function DesktopUpdatePanel() {
  const [snapshot, setSnapshot] = useState<DesktopUpdateSnapshot | null>(null);
  const [pendingAction, setPendingAction] = useState<UpdateActionKind | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [auxiliaryError, setAuxiliaryError] = useState<string | null>(null);
  const [autoCheck, setAutoCheck] = useState(true);
  const [autoCheckBusy, setAutoCheckBusy] = useState(false);

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
    void bridge
      .getAutoCheck()
      .then((preference) => {
        if (active) setAutoCheck(preference.enabled);
      })
      .catch(() => undefined);
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

  async function changeAutoCheck(enabled: boolean) {
    const bridge = window.syncThink?.updates;
    if (!bridge || autoCheckBusy) return;
    setAutoCheckBusy(true);
    setAuxiliaryError(null);
    try {
      const preference = await bridge.setAutoCheck({ enabled });
      setAutoCheck(preference.enabled);
    } catch {
      setAuxiliaryError('保存自动更新偏好失败。');
    } finally {
      setAutoCheckBusy(false);
    }
  }

  async function openReleaseNotes() {
    const bridge = window.syncThink?.updates;
    if (!bridge) return;
    setAuxiliaryError(null);
    try {
      const result = await bridge.openReleaseNotes();
      if (!result.opened) {
        setAuxiliaryError(ERROR_LABELS[result.error ?? ''] ?? '打开更新日志失败。');
      }
    } catch {
      setAuxiliaryError('打开更新日志失败。');
    }
  }

  async function openLogDirectory() {
    const bridge = window.syncThink?.updates;
    if (!bridge) return;
    setAuxiliaryError(null);
    try {
      const result = await bridge.openLogDirectory();
      if (!result.opened) setAuxiliaryError('打开日志目录失败。');
    } catch {
      setAuxiliaryError('打开日志目录失败。');
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
  const visibleError = actionError ?? snapshot?.errorCode ?? null;
  const statusLabel = snapshot
    ? snapshot.phase === 'available' && snapshot.availableVersion
      ? `发现新版本 ${snapshot.availableVersion}`
      : snapshot.phase === 'downloading' && snapshot.progressPercent !== null
        ? `正在下载安装包 ${snapshot.progressPercent.toFixed(1)}%`
        : PHASE_LABELS[snapshot.phase]
    : '正在读取更新状态…';

  const primaryAction: UpdateActionKind =
    phase === 'downloaded' || phase === 'installing'
      ? 'install'
      : phase === 'available' || phase === 'downloading'
        ? 'download'
        : 'check';
  const primaryEnabled =
    primaryAction === 'install'
      ? canInstall
      : primaryAction === 'download'
        ? canDownload
        : canCheck;
  const primaryLabel =
    primaryAction === 'install'
      ? pendingAction === 'install' || phase === 'installing'
        ? '正在重启…'
        : '重启并安装'
      : primaryAction === 'download'
        ? pendingAction === 'download' || phase === 'downloading'
          ? '下载中…'
          : '下载更新'
        : pendingAction === 'check' || phase === 'checking'
          ? '检查中…'
          : '检查更新';
  const PrimaryIcon =
    primaryAction === 'install'
      ? PackageCheck
      : primaryAction === 'download'
        ? Download
        : RefreshCw;

  const runPrimaryAction = () => {
    if (!bridge) return;
    if (primaryAction === 'install') {
      void runAction('install', () => bridge.installUpdate());
      return;
    }
    if (primaryAction === 'download') {
      void runAction('download', () => bridge.downloadUpdate());
      return;
    }
    void runAction('check', () => bridge.checkForUpdates());
  };

  return (
    <section className="settings-about-release" aria-label="关于 SYNC-THINK">
      <div className="settings-about-brand">
        <div className="settings-about-brand__line">
          <img
            src={syncThinkLogo}
            alt=""
            draggable={false}
            className="sync-think-logo settings-about-brand__mark"
          />
          <h2>SYNC-THINK</h2>
        </div>
        <p>版本 v{snapshot?.currentVersion ?? '读取中'}</p>
      </div>

      <div className="settings-about-update">
        <div className="settings-about-auto-check">
          <div>
            <strong>自动检查更新</strong>
            <span>启动时自动检查新版本</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-label="自动检查更新"
            aria-checked={autoCheck}
            disabled={!bridge || autoCheckBusy}
            className={clsx('settings-about-toggle', autoCheck && 'is-checked')}
            onClick={() => void changeAutoCheck(!autoCheck)}
          >
            <span />
          </button>
        </div>

        <button
          type="button"
          className="settings-about-update__primary"
          disabled={!primaryEnabled || !bridge}
          onClick={runPrimaryAction}
        >
          <PrimaryIcon
            size={15}
            className={pendingAction === primaryAction ? 'is-spinning' : undefined}
            aria-hidden="true"
          />
          {primaryLabel}
        </button>

        {snapshot?.phase === 'downloading' && snapshot.progressPercent !== null ? (
          <div
            className="settings-about-progress"
            role="progressbar"
            aria-label="更新下载进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={snapshot.progressPercent}
          >
            <span style={{ width: `${Math.min(100, Math.max(0, snapshot.progressPercent))}%` }} />
          </div>
        ) : null}

        {phase && phase !== 'idle' && phase !== 'disabled' && phase !== 'error' ? (
          <p className="settings-about-update__status" aria-live="polite">
            {statusLabel}
          </p>
        ) : null}

        {visibleError ? (
          <div className="settings-about-alert" role="alert">
            <AlertTriangle size={14} aria-hidden="true" />
            <span>{ERROR_LABELS[visibleError] ?? '更新操作失败，请稍后重试。'}</span>
          </div>
        ) : null}

        <div className="settings-about-links">
          <button type="button" onClick={() => void openReleaseNotes()}>
            <Info size={15} aria-hidden="true" />
            查看更新日志
          </button>
          <button type="button" onClick={() => void openLogDirectory()}>
            <ExternalLink size={15} aria-hidden="true" />
            打开日志目录
          </button>
        </div>

        {auxiliaryError ? (
          <p className="settings-about-auxiliary-error" role="alert">
            {auxiliaryError}
          </p>
        ) : null}
      </div>

      <p className="settings-about-copyright">© 2026 SYNC-THINK. All rights reserved.</p>
    </section>
  );
}
