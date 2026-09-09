/** Surfaces that stay mounted after the first visit, matching NewMax tab keep-alive. */
export const KEEP_ALIVE_TAB_TYPES = ['conversation', 'file', 'terminal', 'review'] as const;

export const RETAINED_CONVERSATION_LIMIT = 8;
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
