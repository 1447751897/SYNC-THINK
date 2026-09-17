/** Surfaces that stay mounted after the first visit, matching NewMax tab keep-alive. */
export const KEEP_ALIVE_TAB_TYPES = ['conversation', 'file', 'terminal', 'review'] as const;

/**
 * 会话面保活上限。
 *
 * NewMax 的 `TabContent` 一旦激活就常驻（切走只是 `display:none`），**没有** DOM 侧
 * 的保活上限（`shouldMountTabContent` 对 conversation 类型只看 `hasBeenActive`，
 * 不看数量）——它的内存边界来自另外两件事：每个会话只加载有限的消息页
 * （`conversations:getMessages(id, limit, offset)`）以及消息渲染窗口只有尾部 12 条。
 *
 * 这里严格对齐该语义：conversation 一旦在本 pane 激活过就**永不卸载**，用
 * `Number.POSITIVE_INFINITY` 表达「无上限」。其它类型（file/terminal/review）仍保留
 * 有界 LRU。曾经用过的 100 上限是「标签页容量」式的近似，但它仍然会在
 * 「开着第 101 个会话」时把最早激活的会话卸掉——被卸载的会话只能靠快照重放，
 * 而重放远不如 DOM 常驻可靠，这正是「切回去位置没了」的成因。
 */
export const RETAINED_CONVERSATION_LIMIT = Number.POSITIVE_INFINITY;
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
