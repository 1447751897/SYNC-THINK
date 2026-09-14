import { useCallback, useSyncExternalStore } from 'react';

/**
 * 工具输入/输出的折行偏好。
 *
 * 命令输出常常是一整条几百字符的长行（JSON、日志、绝对路径），不折行时内容会把卡片撑宽，
 * 于是框里多出一条横向滚动条：得先拖滚动条才知道右半边有什么，「框」本身也看不出边界。
 * 所以默认折行，顶条按钮可以切回单行（保留代码/JSON 按行对齐的阅读习惯）。
 */
const STORAGE_KEY = 'sync-think:tool-output-wrap';

let cached: boolean | undefined;
const listeners = new Set<() => void>();

function readStoredWrap(): boolean {
  try {
    // 只有显式存过 'false' 才关闭；读不到或读到坏值一律回到默认的折行。
    return window.localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function readToolOutputWrap(): boolean {
  cached ??= readStoredWrap();
  return cached;
}

export function writeToolOutputWrap(wrap: boolean): void {
  const next = Boolean(wrap);
  if (cached === next) return;
  cached = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? 'true' : 'false');
  } catch {
    // 存不进去也不影响本次会话内的表现。
  }
  for (const listener of listeners) listener();
}

export function subscribeToolOutputWrap(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 模块级缓存不会随 localStorage 清理而失效，按仓库既有惯例留一个显式重置口给测试。 */
export function resetToolOutputWrapForTests(): void {
  cached = undefined;
  listeners.clear();
}

/** 返回 [是否折行, 切换]。同一窗口内所有输出块共享同一份偏好。 */
export function useToolOutputWrap(): [boolean, () => void] {
  const wrap = useSyncExternalStore(subscribeToolOutputWrap, readToolOutputWrap, () => true);
  const toggle = useCallback(() => writeToolOutputWrap(!readToolOutputWrap()), []);
  return [wrap, toggle];
}
