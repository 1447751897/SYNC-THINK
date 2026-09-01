import {
  Check,
  Download,
  FolderOpen,
  LoaderCircle,
  MessageSquareText,
  Package,
  Route,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ConversationTrack } from '@sync-think/shared';
import type {
  ManagedKernelUpdateId,
  ManagedKernelUpdateSnapshot,
} from '../../kernel-update-contract.js';

export const FIRST_LAUNCH_GUIDE_KEY = 'sync-think.firstLaunchGuide.v1.dismissed';

export function readFirstLaunchGuideDismissed(storage?: Pick<Storage, 'getItem'>): boolean {
  try {
    const source = storage ?? window.localStorage;
    return source.getItem(FIRST_LAUNCH_GUIDE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeFirstLaunchGuideDismissed(
  dismissed: boolean,
  storage?: Pick<Storage, 'setItem' | 'removeItem'>,
): void {
  try {
    const target = storage ?? window.localStorage;
    if (dismissed) target.setItem(FIRST_LAUNCH_GUIDE_KEY, '1');
    else target.removeItem(FIRST_LAUNCH_GUIDE_KEY);
  } catch {
    // The guide remains usable when localStorage is unavailable.
  }
}

export function FirstLaunchGuide({
  hasWorkspace,
  onOpenWorkspaceMenu,
  onPickTrack,
}: {
  hasWorkspace: boolean;
  onOpenWorkspaceMenu(): void;
  onPickTrack(track: ConversationTrack): void;
}) {
  const [dismissed, setDismissed] = useState(() => readFirstLaunchGuideDismissed());
  const [kernels, setKernels] = useState<ManagedKernelUpdateSnapshot | null>(null);
  const [installing, setInstalling] = useState<ManagedKernelUpdateId | null>(null);
  const [installError, setInstallError] = useState(false);

  useEffect(() => {
    let active = true;
    const bridge = window.syncThink?.kernelUpdates;
    void bridge
      ?.getState()
      .then((state) => {
        if (active) setKernels(state);
      })
      .catch(() => undefined);
    const unsubscribe = bridge?.subscribeState?.((state) => {
      if (active) setKernels(state);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  if (dismissed) return null;

  const dismiss = () => {
    writeFirstLaunchGuideDismissed(true);
    setDismissed(true);
  };

  const installKernel = async (kernelId: ManagedKernelUpdateId) => {
    const bridge = window.syncThink?.kernelUpdates;
    if (!bridge || installing) return;
    setInstalling(kernelId);
    setInstallError(false);
    try {
      const result = await bridge.installUpdate({ kernelId });
      setKernels(result.state);
      setInstallError(!result.ok);
    } catch {
      setInstallError(true);
    } finally {
      setInstalling(null);
    }
  };

  return (
    <section className="shell-first-launch" aria-labelledby="first-launch-title">
      <div className="shell-first-launch__header">
        <div>
          <span className="shell-first-launch__eyebrow">FIRST RUN · LOCAL WORKSPACE</span>
          <h3 id="first-launch-title">三步开始第一项任务</h3>
        </div>
        <button
          type="button"
          className="shell-first-launch__dismiss"
          aria-label="关闭首次使用引导"
          onClick={dismiss}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      {kernels ? (
        <div className="shell-first-launch__kernels" aria-label="首次私有内核安装">
          <span className="shell-first-launch__kernels-icon" aria-hidden="true">
            <Package size={15} />
          </span>
          <div className="shell-first-launch__kernels-copy">
            <strong>私有内核（可选）</strong>
            <span>安装在 SYNC-THINK 私有目录，不改动本机 Codex、Claude Code 或 Pi。</span>
          </div>
          <div className="shell-first-launch__kernels-actions">
            {kernels.items.map((item) =>
              item.managedVersion ? (
                <span key={item.kernelId} className="is-installed">
                  <Check size={12} aria-hidden="true" />
                  {item.name} v{item.managedVersion} 已安装
                </span>
              ) : (
                <button
                  key={item.kernelId}
                  type="button"
                  disabled={!kernels.installerAvailable || installing !== null}
                  aria-label={`私有安装 ${item.name}`}
                  onClick={() => void installKernel(item.kernelId)}
                >
                  {installing === item.kernelId ? (
                    <LoaderCircle size={13} className="is-spinning" aria-hidden="true" />
                  ) : (
                    <Download size={13} aria-hidden="true" />
                  )}
                  {installing === item.kernelId ? '安装中…' : item.name}
                </button>
              ),
            )}
          </div>
          {installError ? (
            <span className="shell-first-launch__kernels-error">安装失败</span>
          ) : null}
        </div>
      ) : null}

      <ol className="shell-first-launch__steps">
        <li data-state={hasWorkspace ? 'complete' : 'current'}>
          <span className="shell-first-launch__index" aria-hidden="true">
            {hasWorkspace ? <Check size={12} /> : '01'}
          </span>
          <FolderOpen size={15} aria-hidden="true" />
          <div>
            <strong>打开工作区</strong>
            <span>{hasWorkspace ? '本地目录已就绪' : '把任务和文件限定在一个本地目录'}</span>
          </div>
          {!hasWorkspace ? <em className="sr-only">当前步骤</em> : null}
        </li>
        <li data-state={hasWorkspace ? 'current' : 'pending'}>
          <span className="shell-first-launch__index" aria-hidden="true">
            02
          </span>
          <Route size={15} aria-hidden="true" />
          <div>
            <strong>选择协作方式</strong>
            <span>模型、智能体或小队共享同一任务上下文</span>
          </div>
          {hasWorkspace ? <em className="sr-only">当前步骤</em> : null}
        </li>
        <li data-state="pending">
          <span className="shell-first-launch__index" aria-hidden="true">
            03
          </span>
          <MessageSquareText size={15} aria-hidden="true" />
          <div>
            <strong>描述目标并发送</strong>
            <span>运行过程、审批和产物会留在当前任务</span>
          </div>
        </li>
      </ol>

      <div className="shell-first-launch__actions">
        {hasWorkspace ? (
          <>
            <button type="button" className="is-primary" onClick={() => onPickTrack('agent')}>
              选择智能体
            </button>
            <button type="button" onClick={() => onPickTrack('model')}>
              直接使用模型
            </button>
          </>
        ) : (
          <button type="button" className="is-primary" onClick={onOpenWorkspaceMenu}>
            <FolderOpen size={14} aria-hidden="true" />
            打开工作区
          </button>
        )}
        <button type="button" className="is-quiet" onClick={dismiss}>
          跳过引导
        </button>
      </div>
    </section>
  );
}
