/** Surfaces that stay mounted after the first visit, matching NewMax tab keep-alive. */
export const KEEP_ALIVE_TAB_TYPES = ['conversation', 'file', 'terminal', 'review'] as const;

/**
 * 会话面保活上限。
 *
 * DeepSeek Harness 的做法是**不保活会话 DOM**：切换会话时旧 ChatView 卸载、新的重新
 * 挂载，阅读位置存在一个无上限的 module 级 Map 里（`chatScrollPositions`），重挂载时
 * 用锚点（`anchorKey` + `anchorTop` + `scrollTop`）精确恢复。它完全不依赖浏览器替一个
 * 隐藏容器守住 `scrollTop`——真实浏览器里图片解码、markdown 异步渲染都会改变
 * `scrollHeight` 从而钳位 `scrollTop`，保活路线下位置会漂移且无法重放。
 *
 * 这里严格对齐 DSH：会话面 `0` = 切走即卸载，只挂载当前激活的会话。位置由
 * `conversationScrollPositions`（无上限）在重挂载时恢复。其它类型
 * （file/terminal/review）仍保留有界 LRU——它们没有等价的锚点恢复机制。
 */
export const RETAINED_CONVERSATION_LIMIT = 0;
export const RETAINED_FILE_LIMIT = 8;
export const RETAINED_TERMINAL_LIMIT = 8;
export const RETAINED_REVIEW_LIMIT = 4;

export type KeepAliveTabType = (typeof KEEP_ALIVE_TAB_TYPES)[number];

export interface PaneRetainedSurfaces {
  conversations: string[];
  files: string[];
  terminals: string[];
  reviews: string[];
}

export function emptyPaneRetainedSurfaces(): PaneRetainedSurfaces {
  return { conversations: [], files: [], terminals: [], reviews: [] };
}

/** LRU: newest key at the end; drop the oldest when over the cap. */
export function rememberRetainedKey(retained: readonly string[], key: string, limit: number): string[] {
  const id = key.trim();
  if (!id || limit <= 0) return retained.filter(Boolean);
  const next = retained.filter((item) => item !== id);
  next.push(id);
  while (next.length > limit) next.shift();
  return next;
}

export function shouldMountRetainedSurface(
  key: string,
  isActive: boolean,
  retainedKeys: readonly string[],
): boolean {
  return isActive || retainedKeys.includes(key);
}

export function retainPaneSurface(
  current: PaneRetainedSurfaces,
  kind: keyof PaneRetainedSurfaces,
  key: string,
  limit: number,
): PaneRetainedSurfaces {
  return {
    ...current,
    [kind]: rememberRetainedKey(current[kind], key, limit),
  };
}
