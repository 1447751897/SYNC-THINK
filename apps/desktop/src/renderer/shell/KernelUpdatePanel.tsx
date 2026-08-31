import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Download, Package, RefreshCw } from 'lucide-react';
import type { KernelDetectionResult } from '@sync-think/shared';
import type {
  ManagedKernelUpdateActionResult,
  ManagedKernelUpdateId,
  ManagedKernelUpdateItem,
  ManagedKernelUpdateSnapshot,
} from '../../kernel-update-contract.js';

const ERROR_LABELS: Record<string, string> = {
  'kernel.update.busy': '已有内核更新操作正在执行。',
  'kernel.update.installer-missing': '内核安装器尚未就绪。',
  'kernel.update.check-failed': '检查内核版本失败，请稍后重试。',
  'kernel.update.install-failed': '内核下载或安装失败。',
  'kernel.update.verify-failed': '新内核验证失败，当前版本未切换。',
  'kernel.update.kernel-invalid': '内核更新目标无效。',
};

function currentVersion(
  item: ManagedKernelUpdateItem,
  detected: readonly KernelDetectionResult[],
): string | null {
  return (
    item.managedVersion ??
    detected.find((kernel) => kernel.kernelId === item.kernelId)?.version ??
    null
  );
}

function itemStatus(item: ManagedKernelUpdateItem, detectedVersion: string | null): string {
  if (item.phase === 'checking') return '正在检查版本…';
  if (item.phase === 'installing') return '正在安装并验证…';
  if (item.phase === 'installed') {
    return `私有版本 ${item.managedVersion} 已激活，现有会话下一轮继续使用`;
  }
  if (item.phase === 'up-to-date') return `当前已是最新版本 ${detectedVersion ?? ''}`.trim();
  if (item.phase === 'available' && item.latestVersion) {
    return `可升级到 ${item.latestVersion}`;
  }
  if (item.errorCode) return ERROR_LABELS[item.errorCode] ?? '内核更新失败。';
  return item.managedVersion ? '由 SYNC-THINK 私有管理' : '当前使用本机或随应用版本';
}

export function KernelUpdatePanel() {
  const [snapshot, setSnapshot] = useState<ManagedKernelUpdateSnapshot | null>(null);
  const [detected, setDetected] = useState<KernelDetectionResult[]>([]);
  const [pending, setPending] = useState<ManagedKernelUpdateId | 'check' | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const refreshDetected = async () => {
    try {
      const response = await window.syncThink?.runtime.detectKernels();
      if (response) setDetected(response.kernels);
    } catch {
      // Version detection is auxiliary; update state remains usable.
    }
  };

  useEffect(() => {
    let active = true;
    const bridge = window.syncThink?.kernelUpdates;
    if (!bridge) return;
    void Promise.all([bridge.getState(), window.syncThink?.runtime.detectKernels()])
      .then(([state, detection]) => {
        if (!active) return;
        setSnapshot(state);
        if (detection) setDetected(detection.kernels);
      })
      .catch(() => {
        if (active) setErrorCode('kernel.update.check-failed');
      });
    return () => {
      active = false;
    };
  }, []);

  const versions = useMemo(
    () =>
      new Map(snapshot?.items.map((item) => [item.kernelId, currentVersion(item, detected)]) ?? []),
    [detected, snapshot],
  );

  const applyResult = (result: ManagedKernelUpdateActionResult) => {
    setSnapshot(result.state);
    setErrorCode(result.errorCode);
  };

  const check = async () => {
    const bridge = window.syncThink?.kernelUpdates;
    if (!bridge || pending) return;
    setPending('check');
    setErrorCode(null);
    try {
      applyResult(await bridge.checkForUpdates());
    } catch {
      setErrorCode('kernel.update.check-failed');
    } finally {
      setPending(null);
    }
  };

  const install = async (kernelId: ManagedKernelUpdateId) => {
    const bridge = window.syncThink?.kernelUpdates;
    if (!bridge || pending) return;
    setPending(kernelId);
    setErrorCode(null);
    try {
      const result = await bridge.installUpdate({ kernelId });
      applyResult(result);
      if (result.ok) await refreshDetected();
    } catch {
      setErrorCode('kernel.update.install-failed');
    } finally {
      setPending(null);
    }
  };

  const bridgeReady = Boolean(window.syncThink?.kernelUpdates);
  const installerAvailable = snapshot?.installerAvailable !== false;

  return (
    <section className="settings-kernel-update" aria-labelledby="kernel-update-title">
      <header className="settings-kernel-update__header">
        <div>
          <span className="settings-kernel-update__eyebrow">核心运行环境</span>
          <h3 id="kernel-update-title">Codex 与 Claude Code</h3>
          <p>应用私有安装，升级不会改动系统全局版本。</p>
        </div>
        <button
          type="button"
          className="settings-kernel-update__check"
          disabled={!bridgeReady || !installerAvailable || Boolean(pending)}
          onClick={() => void check()}
        >
          <RefreshCw size={14} className={pending === 'check' ? 'is-spinning' : undefined} />
          {pending === 'check' ? '检查中…' : '检查内核更新'}
        </button>
      </header>

      <div className="settings-kernel-update__list">
        {snapshot?.items.map((item) => {
          const version = versions.get(item.kernelId) ?? null;
          const busy = pending === item.kernelId || item.phase === 'installing';
          const upToDate = item.phase === 'up-to-date' || item.phase === 'installed';
          return (
            <div className="settings-kernel-update__row" key={item.kernelId}>
              <span className="settings-kernel-update__icon" aria-hidden="true">
                <Package size={17} />
              </span>
              <div className="settings-kernel-update__copy">
                <div>
                  <strong>{item.name}</strong>
                  <code>{version ? `v${version}` : '未检测到版本'}</code>
                </div>
                <span className={item.errorCode ? 'is-error' : undefined}>
                  {itemStatus(item, version)}
                </span>
              </div>
              <button
                type="button"
                className="settings-kernel-update__action"
                disabled={!bridgeReady || !installerAvailable || Boolean(pending) || upToDate}
                onClick={() => void install(item.kernelId)}
                aria-label={`${busy ? '正在安装' : upToDate ? '已是最新' : item.managedVersion ? '升级' : '私有安装'} ${item.name}`}
              >
                {upToDate ? <CheckCircle2 size={14} /> : <Download size={14} />}
                {busy
                  ? '安装中…'
                  : upToDate
                    ? '已是最新'
                    : item.managedVersion
                      ? '升级'
                      : '私有安装'}
              </button>
            </div>
          );
        })}
      </div>

      {!snapshot && bridgeReady ? (
        <p className="settings-kernel-update__loading">正在读取内核版本…</p>
      ) : null}
      {!installerAvailable ? (
        <p className="settings-kernel-update__error" role="alert">
          {ERROR_LABELS['kernel.update.installer-missing']}
        </p>
      ) : errorCode ? (
        <p className="settings-kernel-update__error" role="alert">
          {ERROR_LABELS[errorCode] ?? '内核更新操作失败。'}
        </p>
      ) : null}
    </section>
  );
}
