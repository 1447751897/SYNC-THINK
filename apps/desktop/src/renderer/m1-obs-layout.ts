/**
 * M1 observation layout — primary path rail vs collapsible secondary boards.
 * Soft craft only: declutter crowded context rail. Never closes M1 / never starts M2.
 */

export type M1ObsBoardId =
  | 'next-action'
  | 'external-focus'
  | 'exit-path'
  | 'session-readiness'
  | 'exit-evidence'
  | 'evidence-bundle'
  | 'dogfood-fill'
  | 'dogfood-days'
  | 'soft-regression'
  | 'handtest-checklist'
  | 'doc-diff'
  | 'handtest-sections';

export type M1ObsTier = 'primary' | 'secondary';

export interface M1ObsBoardDef {
  id: M1ObsBoardId;
  tier: M1ObsTier;
  label: string;
  /** Short kicker shown in layout chrome */
  kicker: string;
  /** Whether the board is expanded by default (secondary only; primary always shown). */
  defaultExpanded: boolean;
  /** Primary data-testid for flash / jump targets */
  testId: string;
}

export interface M1ObsLayoutBoard {
  id: M1ObsBoardId;
  tier: M1ObsTier;
  label: string;
  kicker: string;
  defaultExpanded: boolean;
  testId: string;
  order: number;
}

export interface M1ObsLayout {
  primary: M1ObsLayoutBoard[];
  secondary: M1ObsLayoutBoard[];
  /** Ordered primary ids for DOM / rail */
  primaryOrder: M1ObsBoardId[];
  /** Ordered secondary ids */
  secondaryOrder: M1ObsBoardId[];
  /** Map boardId → defaultExpanded (secondary); primary always true */
  defaultExpanded: Record<M1ObsBoardId, boolean>;
  summary: string;
  secondarySummary: string;
  /** The validation workbench stays out of the primary conversation until requested. */
  workspaceDefaultOpen: false;
  workspaceLabel: string;
  workspaceHint: string;
  claimsM1Closed: false;
  softCraftRound: number;
}

export const M1_OBS_SOFT_CRAFT_ROUND = 60;

/** Canonical board table — primary path first, secondary observatory folded by default. */
export const M1_OBS_BOARDS: readonly M1ObsBoardDef[] = [
  {
    id: 'next-action',
    tier: 'primary',
    label: '下一步',
    kicker: '主路径',
    defaultExpanded: true,
    testId: 'm1-next-action',
  },
  {
    id: 'external-focus',
    tier: 'primary',
    label: '下一外网项',
    kicker: '主路径',
    defaultExpanded: true,
    testId: 'm1-external-focus',
  },
  {
    id: 'exit-path',
    tier: 'primary',
    label: '退出路径',
    kicker: '主路径',
    defaultExpanded: true,
    testId: 'm1-exit-path',
  },
  {
    id: 'session-readiness',
    tier: 'secondary',
    label: '会话就绪',
    kicker: '状态',
    defaultExpanded: false,
    testId: 'm1-session-readiness',
  },
  {
    id: 'exit-evidence',
    tier: 'secondary',
    label: '退出证据',
    kicker: '证据',
    defaultExpanded: false,
    testId: 'm1-exit-evidence',
  },
  {
    id: 'evidence-bundle',
    tier: 'secondary',
    label: '证据包',
    kicker: '导出',
    defaultExpanded: false,
    testId: 'm1-evidence-bundle',
  },
  {
    id: 'dogfood-fill',
    tier: 'secondary',
    label: 'dogfood 补填',
    kicker: '日记',
    defaultExpanded: false,
    testId: 'm1-dogfood-fill',
  },
  {
    id: 'dogfood-days',
    tier: 'secondary',
    label: 'dogfood 天数',
    kicker: '日记',
    defaultExpanded: false,
    testId: 'm1-dogfood-days',
  },
  {
    id: 'soft-regression',
    tier: 'secondary',
    label: 'soft 回归',
    kicker: '矩阵',
    defaultExpanded: false,
    testId: 'm1-soft-regression',
  },
  {
    id: 'handtest-checklist',
    tier: 'secondary',
    label: '手测对照',
    kicker: '清单',
    defaultExpanded: false,
    testId: 'm1-handtest-checklist',
  },
  {
    id: 'doc-diff',
    tier: 'secondary',
    label: '文档 ↔ 本机',
    kicker: '差异',
    defaultExpanded: false,
    testId: 'm1-handtest-doc-diff',
  },
  {
    id: 'handtest-sections',
    tier: 'secondary',
    label: '手测分区',
    kicker: '分区',
    defaultExpanded: false,
    testId: 'm1-handtest-sections',
  },
] as const;

export function isM1ObsPrimary(id: M1ObsBoardId): boolean {
  const def = M1_OBS_BOARDS.find((b) => b.id === id);
  return def?.tier === 'primary';
}

export function isM1ObsSecondary(id: M1ObsBoardId): boolean {
  const def = M1_OBS_BOARDS.find((b) => b.id === id);
  return def?.tier === 'secondary';
}

export function getM1ObsBoard(id: M1ObsBoardId): M1ObsBoardDef | undefined {
  return M1_OBS_BOARDS.find((b) => b.id === id);
}

/**
 * Pure: build observation layout projection.
 * Primary = next → external focus → exit path (always visible).
 * Secondary = everything else (collapsed by default).
 */
export function projectM1ObsLayout(input?: {
  softCraftRound?: number;
}): M1ObsLayout {
  const softCraftRound =
    typeof input?.softCraftRound === 'number' && input.softCraftRound > 0
      ? input.softCraftRound
      : M1_OBS_SOFT_CRAFT_ROUND;

  const primary: M1ObsLayoutBoard[] = [];
  const secondary: M1ObsLayoutBoard[] = [];
  const defaultExpanded = {} as Record<M1ObsBoardId, boolean>;

  M1_OBS_BOARDS.forEach((def, index) => {
    const board: M1ObsLayoutBoard = {
      id: def.id,
      tier: def.tier,
      label: def.label,
      kicker: def.kicker,
      defaultExpanded: def.tier === 'primary' ? true : def.defaultExpanded,
      testId: def.testId,
      order: index + 1,
    };
    defaultExpanded[def.id] = board.defaultExpanded;
    if (def.tier === 'primary') primary.push(board);
    else secondary.push(board);
  });

  const primaryOrder = primary.map((b) => b.id);
  const secondaryOrder = secondary.map((b) => b.id);

  return {
    primary,
    secondary,
    primaryOrder,
    secondaryOrder,
    defaultExpanded,
    summary: `主路径 ${primary.length} · 次要观测 ${secondary.length}（默认折叠）`,
    secondarySummary: `更多 soft 观测 · ${secondary.map((b) => b.label).join(' · ')}`,
    workspaceDefaultOpen: false,
    workspaceLabel: 'M1 验证',
    workspaceHint: '按需展开验证工作台',
    claimsM1Closed: false,
    softCraftRound,
  };
}

/** Selector helpers for flash / jump — primary rail first. */
export function m1ObsPrimarySelectors(): string[] {
  return M1_OBS_BOARDS.filter((b) => b.tier === 'primary').map(
    (b) => `[data-testid="${b.testId}"]`,
  );
}

export function m1ObsSecondarySelectors(): string[] {
  return M1_OBS_BOARDS.filter((b) => b.tier === 'secondary').map(
    (b) => `[data-testid="${b.testId}"]`,
  );
}

/**
 * Whether a data-testid belongs to the secondary (folded) tier.
 * Used to auto-expand the "更多 soft 观测" accordion on flash.
 */
export function isM1ObsSecondaryTestId(testId: string): boolean {
  const id = String(testId || '')
    .replace(/^\[data-testid="/, '')
    .replace(/"\]$/, '')
    .trim();
  if (!id) return false;
  // Primary rail never treated as secondary (keep accordion closed on main path flash)
  if (
    id === 'm1-next-action' ||
    id.startsWith('m1-next-') ||
    id === 'm1-external-focus' ||
    id.startsWith('m1-external-focus') ||
    id === 'm1-exit-path' ||
    id.startsWith('m1-exit-path') ||
    id === 'm1-obs-layout' ||
    id === 'm1-obs-primary' ||
    id.startsWith('m1-obs-primary') ||
    id === 'm1-obs-secondary' ||
    id.startsWith('m1-obs-secondary')
  ) {
    return false;
  }
  if (
    M1_OBS_BOARDS.some(
      (b) =>
        b.tier === 'secondary' &&
        (b.testId === id ||
          id.startsWith(b.testId + '-') ||
          id.startsWith(b.testId)),
    )
  ) {
    return true;
  }
  // Nested soft boards / chips under secondary accordion
  return /^(m1-session|m1-exit-chip|m1-exit-note|m1-exit-refresh|m1-exit-summary|m1-soft-snapshot|m1-dogfood|m1-soft-regression|m1-handtest|m1-known-limits|m1-open-doc|m1-evidence-bundle)/.test(
    id,
  );
}
