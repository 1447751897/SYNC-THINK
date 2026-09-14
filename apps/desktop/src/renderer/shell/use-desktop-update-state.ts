import { useEffect, useState } from 'react';
import type { DesktopUpdatePhase, DesktopUpdateSnapshot } from '../../desktop-update-contract.js';

/**
 * 「有新版本待处理」的阶段集合。
 *
 * 这三个阶段里 `availableVersion` 一定代表一个**还能装上**的版本，所以关于页用它决定
 * 是否渲染「更新内容」，侧边栏用它决定是否把版本号挂到设置入口上。放在这里是为了让两处
 * 共用同一份判断——分叉的后果是「侧边栏说有新版本，关于页却说已是最新」。
 */
export const PENDING_UPDATE_PHASES: ReadonlySet<DesktopUpdatePhase> = new Set<DesktopUpdatePhase>([
  'available',
  'downloading',
  'downloaded',
]);

/**
 * 取出「可以升级到的版本号」，没有就返回 null。
 *
 * 只有阶段属于 {@link PENDING_UPDATE_PHASES} 时才认 `availableVersion`：一次检查失败后
 * 快照可能仍留着上次的版本号，那时候不该继续对外宣称有新版本。
 */
export function resolvePendingUpdateVersion(
  snapshot: DesktopUpdateSnapshot | null | undefined,
): string | null {
  if (!snapshot?.availableVersion) return null;
  return PENDING_UPDATE_PHASES.has(snapshot.phase) ? snapshot.availableVersion : null;
}

export interface DesktopUpdateStateResult {
  /** 主进程投影出来的更新快照；首次读取完成前为 null。 */
  snapshot: DesktopUpdateSnapshot | null;
  /** 首次读取失败（bridge 抛错）。侧边栏可以忽略，关于页要把它翻成错误提示。 */
  loadFailed: boolean;
  /**
   * 覆盖快照。动作（检查/下载/安装）的返回值本身就是最新快照，比等下一次推送更快，
   * 所以把 setter 暴露出去，避免各调用点自己再存一份副本。
   */
  applySnapshot(next: DesktopUpdateSnapshot): void;
}

/**
 * 订阅桌面更新状态。
 *
 * 侧边栏设置入口与「关于」面板都要读同一份快照，两边各订阅一次会产生两个渲染器侧的
 * 监听器和一个重复的初始 `getState()`，所以订阅逻辑收在这里。
 *
 * 降级：`window.syncThink?.updates` 不存在（纯浏览器预览、或 preload 未注入）时直接
 * 返回 null 快照并停止，不做任何假设；调用点按「还不知道」渲染，而不是按「没有更新」。
 */
export function useDesktopUpdateState(): DesktopUpdateStateResult {
  const [snapshot, setSnapshot] = useState<DesktopUpdateSnapshot | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

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
        if (active) setLoadFailed(true);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return { snapshot, loadFailed, applySnapshot: setSnapshot };
}
