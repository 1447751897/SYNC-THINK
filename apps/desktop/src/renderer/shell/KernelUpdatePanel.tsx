import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Download, RefreshCw } from 'lucide-react';
import type { KernelDetectionResult } from '@sync-think/shared';
import type {
  ManagedKernelUpdateActionResult,
  ManagedKernelUpdateId,
  ManagedKernelUpdateItem,
  ManagedKernelUpdateSnapshot,
} from '../../kernel-update-contract.js';
import { BrandLogoMark } from './BrandLogoMark.js';
import { resolveKernelBrandLogo, resolveKernelDisplayName } from './brand-icons.js';
import {
  BETA_INSTALLABLE_KERNEL_IDS,
  isKernelInstallOffered,
  visibleManagedKernelItems,
} from './kernel-beta-availability.js';

const ERROR_LABELS: Record<string, string> = {
  'kernel.update.busy': '该内核正在更新，请稍候。',
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
  return item.managedVersion ? '由 SYNC-THINK 私有管理' : '将安装到应用私有目录';
}

export function KernelUpdatePanel() {
  const [snapshot, setSnapshot] = useState<ManagedKernelUpdateSnapshot | null>(null);
  const [detected, setDetected] = useState<KernelDetectionResult[]>([]);
  const [pending, setPending] = useState<ReadonlySet<ManagedKernelUpdateId>>(() => new Set());
  const pendingRef = useRef<Set<ManagedKernelUpdateId>>(new Set());
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const beginPending = useCallback((ids: readonly ManagedKernelUpdateId[]): ManagedKernelUpdateId[] => {
    const started = ids.filter((id) => !pendingRef.current.has(id));
    if (started.length === 0) return [];
    const next = new Set(pendingRef.current);
    for (const id of started) next.add(id);
    pendingRef.current = next;
    setPending(next);
    return started;
  }, []);

  const endPending = useCallback((ids: readonly ManagedKernelUpdateId[]): void => {
    if (ids.length === 0) return;
    const next = new Set(pendingRef.current);
    for (const id of ids) next.delete(id);
    pendingRef.current = next;
    setPending(next);
  }, []);

  const refreshDetected = useCallback(async () => {
    try {
      const response = await window.syncThink?.runtime.detectKernels();
      if (response) setDetected(response.kernels);
    } catch {
      // Version detection is auxiliary; update state remains usable.
    }
  }, []);

  const applyResult = useCallback((result: ManagedKernelUpdateActionResult) => {
    setSnapshot(result.state);
    setErrorCode(result.errorCode);
  }, []);

  const check = useCallback(async (kernelId?: ManagedKernelUpdateId) => {
    const bridge = window.syncThink?.kernelUpdates;
    if (!bridge) return;
    const targets = kernelId
      ? [kernelId]
      : [...BETA_INSTALLABLE_KERNEL_IDS];
    const started = beginPending(targets);
    if (started.length === 0) return;
    setErrorCode(null);
    try {
      applyResult(
        await (kernelId ? bridge.checkForUpdates({ kernelId }) : bridge.checkForUpdates()),
      );
      await refreshDetected();
    } catch {
      setErrorCode('kernel.update.check-failed');
    } finally {
      endPending(started);
    }
  }, [applyResult, beginPending, endPending, refreshDetected]);

  useEffect(() => {
    let active = true;
    const bridge = window.syncThink?.kernelUpdates;
    if (!bridge) return;
    let receivedLiveSnapshot = false;
    const unsubscribe = bridge.subscribeState?.((state) => {
      if (!active) return;
      receivedLiveSnapshot = true;
      setSnapshot(state);
      void refreshDetected();
    });
    void Promise.all([bridge.getState(), window.syncThink?.runtime.detectKernels()])
      .then(async ([state, detection]) => {
        if (!active) return;
        // A state broadcast may win the race with the initial IPC response.
        // Do not let that response roll a terminal error back to installing.
        if (!receivedLiveSnapshot) setSnapshot(state);
        if (detection) setDetected(detection.kernels);
        if (state.installerAvailable !== false) {
          await check();
          if (!active) return;
        }
      })
      .catch(() => {
        if (active) setErrorCode('kernel.update.check-failed');
      });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [check, refreshDetected]);

  const visibleItems = useMemo(
    () => (snapshot ? visibleManagedKernelItems(snapshot.items) : []),
    [snapshot],
  );
  const versions = useMemo(
    () =>
      new Map(visibleItems.map((item) => [item.kernelId, currentVersion(item, detected)])),
    [detected, visibleItems],
  );

  const install = useCallback(async (kernelId: ManagedKernelUpdateId) => {
    const bridge = window.syncThink?.kernelUpdates;
    if (!bridge || !isKernelInstallOffered(kernelId)) return;
    const started = beginPending([kernelId]);
    if (started.length === 0) return;
    setErrorCode(null);
    try {
      const result = await bridge.installUpdate({ kernelId });
      applyResult(result);
      if (result.ok) await refreshDetected();
    } catch {
      setErrorCode('kernel.update.install-failed');
    } finally {
      endPending(started);
    }
  }, [applyResult, beginPending, endPending, refreshDetected]);

  const bridgeReady = Boolean(window.syncThink?.kernelUpdates);
  const installerAvailable = snapshot?.installerAvailable !== false;

  return (
    <section className="settings-kernel-update" aria-labelledby="kernel-update-title">
      <header className="settings-kernel-update__header">
        <h3 id="kernel-update-title">核心运行环境</h3>
        <p>Codex 与 Claude Code 安装在应用私有目录，升级不会改动系统全局版本。Pi 执行尚未接通，Beta 不提供安装。</p>
      </header>

      <div className="settings-kernel-update__list">
        {visibleItems.map((item) => {
          const version = versions.get(item.kernelId) ?? null;
          const displayName = resolveKernelDisplayName(item.kernelId, item.name);
          const brandLogo = resolveKernelBrandLogo(item.kernelId);
          const rowPending = pending.has(item.kernelId);
          const checking = rowPending || item.phase === 'checking';
          const busy = rowPending || item.phase === 'installing';
          const upToDate = item.phase === 'up-to-date' || item.phase === 'installed';
          const canInstall = !upToDate && item.phase !== 'checking';
          return (
            <article className="settings-kernel-update__row" key={item.kernelId}>
              <div className="settings-kernel-update__meta">
                <span className="settings-kernel-update__icon">
                  {brandLogo ? (
                    <BrandLogoMark logo={brandLogo} size={22} />
                  ) : (
                    <span className="settings-kernel-update__glyph" aria-hidden="true">
                      {displayName.slice(0, 1)}
                    </span>
                  )}
                </span>
                <div className="settings-kernel-update__copy">
                  <div>
                    <strong>{displayName}</strong>
                    <code>{version ? `v${version}` : '未检测到版本'}</code>
                  </div>
                  <span className={item.errorCode ? 'is-error' : undefined}>
                    {itemStatus(item, version)}
                  </span>
                </div>
                <button
                  type="button"
                  className="settings-kernel-update__check"
                  disabled={!bridgeReady || !installerAvailable || rowPending}
                  onClick={() => void check(item.kernelId)}
                  aria-label={`检查更新 ${displayName}`}
                >
                  <RefreshCw size={14} className={checking ? 'is-spinning' : undefined} />
                </button>
              </div>
              <button
                type="button"
                className="settings-kernel-update__action"
                disabled={!bridgeReady || !installerAvailable || rowPending || !canInstall}
                onClick={() => void install(item.kernelId)}
                aria-label={`${busy ? '正在安装' : upToDate ? '已是最新' : item.managedVersion ? '升级' : '私有安装'} ${displayName}`}
              >
                {upToDate ? <CheckCircle2 size={15} /> : <Download size={15} />}
                {busy
                  ? '安装中…'
                  : upToDate
                    ? '已是最新'
                    : item.managedVersion
                      ? '升级'
                      : '私有安装'}
              </button>
            </article>
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
