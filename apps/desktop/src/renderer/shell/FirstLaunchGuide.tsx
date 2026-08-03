import { Check, FolderOpen, MessageSquareText, Route, X } from 'lucide-react';
import { useState } from 'react';
import type { ConversationTrack } from '@sync-think/shared';

export const FIRST_LAUNCH_GUIDE_KEY = 'sync-think.firstLaunchGuide.v1.dismissed';

export function readFirstLaunchGuideDismissed(
  storage?: Pick<Storage, 'getItem'>,
): boolean {
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
  if (dismissed) return null;

  const dismiss = () => {
    writeFirstLaunchGuideDismissed(true);
    setDismissed(true);
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
          <span className="shell-first-launch__index" aria-hidden="true">02</span>
          <Route size={15} aria-hidden="true" />
          <div>
            <strong>选择协作方式</strong>
            <span>模型、智能体或小队共享同一任务上下文</span>
          </div>
          {hasWorkspace ? <em className="sr-only">当前步骤</em> : null}
        </li>
        <li data-state="pending">
          <span className="shell-first-launch__index" aria-hidden="true">03</span>
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
