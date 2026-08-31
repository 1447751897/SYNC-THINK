/**
 * NewMax-style product shell navigation (Locked 2026-07-22).
 * Primary IA: 对话 / 项目 / 智能体 / 小队 / 能力 / 设置
 * Talk tracks: 模型对话 / 智能体对话 / 小队对话
 */

export type ProductPrimaryNavId =
  'talk' | 'project' | 'agents' | 'teams' | 'capabilities' | 'settings';

export type TalkTrackId = 'model' | 'agent' | 'team';

export type ProductMainStage =
  | { kind: 'talk'; track: TalkTrackId }
  | { kind: 'project' }
  | { kind: 'agents' }
  | { kind: 'teams' }
  | { kind: 'capabilities'; surface: 'skills' | 'browser' | 'providers' }
  | { kind: 'settings' };

export interface ProductPrimaryNavItem {
  id: ProductPrimaryNavId;
  label: string;
  short: string;
  testId: string;
  /** Optional badge count projection key */
  badgeKey?: 'agents' | 'teams' | 'skills' | 'pending';
}

export interface TalkTrackNavItem {
  id: TalkTrackId;
  label: string;
  testId: string;
  description: string;
}

export const PRODUCT_PRIMARY_NAV: readonly ProductPrimaryNavItem[] = [
  {
    id: 'talk',
    label: '对话',
    short: '聊',
    testId: 'product-nav-talk',
  },
  {
    id: 'project',
    label: '项目',
    short: '项',
    testId: 'product-nav-project',
  },
  {
    id: 'agents',
    label: '智能体',
    short: '体',
    testId: 'product-nav-agents',
    badgeKey: 'agents',
  },
  {
    id: 'teams',
    label: '小队',
    short: '队',
    testId: 'product-nav-teams',
    badgeKey: 'teams',
  },
  {
    id: 'capabilities',
    label: '能力',
    short: '能',
    testId: 'product-nav-capabilities',
    badgeKey: 'skills',
  },
  {
    id: 'settings',
    label: '设置',
    short: '设',
    testId: 'product-nav-settings',
  },
] as const;

export const TALK_TRACK_NAV: readonly TalkTrackNavItem[] = [
  {
    id: 'model',
    label: '模型对话',
    testId: 'talk-track-model',
    description: '直接选择模型聊天，不必先建智能体',
  },
  {
    id: 'agent',
    label: '智能体对话',
    testId: 'talk-track-agent',
    description: '与全局智能体对话，自带人设与默认 Skill',
  },
  {
    id: 'team',
    label: '小队对话',
    testId: 'talk-track-team',
    description: '使用小队模板分工执行',
  },
] as const;

export type RightRailProductTab = 'files' | 'changes' | 'tasks' | 'process' | 'diagnostics';

export const RIGHT_RAIL_PRODUCT_TABS: readonly {
  id: RightRailProductTab;
  label: string;
  testId: string;
  developerOnly?: boolean;
}[] = [
  { id: 'files', label: '文件', testId: 'right-rail-tab-files' },
  { id: 'changes', label: '变更', testId: 'right-rail-tab-changes' },
  { id: 'tasks', label: '任务', testId: 'right-rail-tab-tasks' },
  { id: 'process', label: '过程', testId: 'right-rail-tab-process' },
  {
    id: 'diagnostics',
    label: '诊断',
    testId: 'right-rail-tab-diagnostics',
    developerOnly: true,
  },
] as const;

/** Split layout (NewMax-aligned). P0 keeps single pane + right rail; P1 enables dual pane. */
export type ShellSplitMode = 'single' | 'dual-talk' | 'talk-file';

export interface ProductShellNavState {
  primary: ProductPrimaryNavId;
  talkTrack: TalkTrackId;
  capabilitiesSurface: 'skills' | 'browser' | 'providers';
  splitMode: ShellSplitMode;
  rightRailTab: RightRailProductTab;
  developerLog: boolean;
}

export function defaultProductShellNavState(
  partial?: Partial<ProductShellNavState>,
): ProductShellNavState {
  return {
    primary: 'talk',
    talkTrack: 'model',
    capabilitiesSurface: 'skills',
    splitMode: 'single',
    rightRailTab: 'process',
    developerLog: false,
    ...partial,
  };
}

export function isProductPrimaryNavId(value: unknown): value is ProductPrimaryNavId {
  return (
    value === 'talk' ||
    value === 'project' ||
    value === 'agents' ||
    value === 'teams' ||
    value === 'capabilities' ||
    value === 'settings'
  );
}

export function isTalkTrackId(value: unknown): value is TalkTrackId {
  return value === 'model' || value === 'agent' || value === 'team';
}

export function resolvePrimaryNav(
  current: ProductShellNavState,
  selected: ProductPrimaryNavId,
): ProductShellNavState {
  const primary = isProductPrimaryNavId(selected) ? selected : 'talk';
  return { ...current, primary };
}

export function resolveTalkTrack(
  current: ProductShellNavState,
  track: TalkTrackId,
): ProductShellNavState {
  const talkTrack = isTalkTrackId(track) ? track : 'model';
  return { ...current, primary: 'talk', talkTrack };
}

export function projectMainStage(state: ProductShellNavState): ProductMainStage {
  switch (state.primary) {
    case 'project':
      return { kind: 'project' };
    case 'agents':
      return { kind: 'agents' };
    case 'teams':
      return { kind: 'teams' };
    case 'capabilities':
      return { kind: 'capabilities', surface: state.capabilitiesSurface };
    case 'settings':
      return { kind: 'settings' };
    case 'talk':
    default:
      return { kind: 'talk', track: state.talkTrack };
  }
}

export function projectProductPrimaryNav(input: {
  active: ProductPrimaryNavId;
  agentCount?: number;
  teamCount?: number;
  skillCount?: number;
  pendingCount?: number;
}): {
  active: ProductPrimaryNavId;
  items: Array<
    ProductPrimaryNavItem & {
      active: boolean;
      badge: string | null;
      ariaLabel: string;
    }
  >;
  stage: ProductMainStage;
  summary: string;
} {
  const active = isProductPrimaryNavId(input.active) ? input.active : 'talk';
  const badgeFor = (key: ProductPrimaryNavItem['badgeKey']): string | null => {
    if (key === 'agents') {
      const n = Math.max(0, Number(input.agentCount ?? 0) || 0);
      return n > 0 ? String(n) : null;
    }
    if (key === 'teams') {
      const n = Math.max(0, Number(input.teamCount ?? 0) || 0);
      return n > 0 ? String(n) : null;
    }
    if (key === 'skills') {
      const n = Math.max(0, Number(input.skillCount ?? 0) || 0);
      return n > 0 ? String(n) : null;
    }
    if (key === 'pending') {
      const n = Math.max(0, Number(input.pendingCount ?? 0) || 0);
      return n > 0 ? String(n) : null;
    }
    return null;
  };

  const items = PRODUCT_PRIMARY_NAV.map((def) => {
    const isActive = def.id === active;
    const badge = badgeFor(def.badgeKey);
    return {
      ...def,
      active: isActive,
      badge,
      ariaLabel: badge ? `${def.label}（${badge}）` : def.label,
    };
  });

  const state = defaultProductShellNavState({ primary: active });
  const stage = projectMainStage(state);
  const activeDef = PRODUCT_PRIMARY_NAV.find((d) => d.id === active) ?? PRODUCT_PRIMARY_NAV[0];

  return {
    active,
    items,
    stage,
    summary: `${activeDef.label} · SYNC-THINK 主导航`,
  };
}

export function projectTalkTrackNav(input: { active: TalkTrackId }): {
  active: TalkTrackId;
  items: Array<TalkTrackNavItem & { active: boolean }>;
  summary: string;
} {
  const active = isTalkTrackId(input.active) ? input.active : 'model';
  const items = TALK_TRACK_NAV.map((def) => ({
    ...def,
    active: def.id === active,
  }));
  const current = TALK_TRACK_NAV.find((d) => d.id === active) ?? TALK_TRACK_NAV[0];
  return {
    active,
    items,
    summary: current.description,
  };
}

export function projectRightRailTabs(input: {
  active: RightRailProductTab;
  developerLog?: boolean;
}): {
  active: RightRailProductTab;
  items: Array<{
    id: RightRailProductTab;
    label: string;
    testId: string;
    active: boolean;
    developerOnly?: boolean;
  }>;
} {
  const developerLog = Boolean(input.developerLog);
  const visible = RIGHT_RAIL_PRODUCT_TABS.filter((tab) => !tab.developerOnly || developerLog);
  const requested = input.active;
  const active = visible.some((tab) => tab.id === requested)
    ? requested
    : (visible[0]?.id ?? 'process');

  return {
    active,
    items: visible.map((tab) => ({
      ...tab,
      active: tab.id === active,
    })),
  };
}

/** Map legacy left-instrument ids onto product primary nav (migration). */
export function primaryNavFromLegacyInstrument(
  instrument: string | null | undefined,
): ProductPrimaryNavId {
  const t = String(instrument ?? '');
  if (t === 'agent' || t === 'agents') return 'agents';
  if (t === 'providers' || t === 'settings') return 'settings';
  if (t === 'memory') return 'settings';
  if (t === 'approvals') return 'talk';
  if (t === 'project' || t === 'tasks' || t === 'workspaces') return 'project';
  if (t === 'teams' || t === 'team') return 'teams';
  if (t === 'skills' || t === 'capabilities' || t === 'browser') return 'capabilities';
  if (t === 'talk' || t === 'chat') return 'talk';
  return 'talk';
}

/**
 * Compose talk target — permission is conversation-scoped only (Locked).
 * Agent carries skills/tools; does not carry its own permission mode.
 */
export type ComposeTalkTargetKind = 'model' | 'agent' | 'team';

export interface ComposeTalkTargetState {
  kind: ComposeTalkTargetKind;
  /** model id | agent id | team template id */
  targetId: string | null;
  permissionMode: 'ask' | 'workspace' | 'full-access';
  reasoningEffort: 'auto' | 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

export function defaultComposeTalkTarget(
  partial?: Partial<ComposeTalkTargetState>,
): ComposeTalkTargetState {
  return {
    kind: 'model',
    targetId: null,
    permissionMode: 'workspace',
    reasoningEffort: 'auto',
    ...partial,
  };
}

export function talkTrackFromComposeKind(kind: ComposeTalkTargetKind): TalkTrackId {
  if (kind === 'agent') return 'agent';
  if (kind === 'team') return 'team';
  return 'model';
}

export function composeKindFromTalkTrack(track: TalkTrackId): ComposeTalkTargetKind {
  if (track === 'agent') return 'agent';
  if (track === 'team') return 'team';
  return 'model';
}

/** Upgrade model chat → agent/team requires explicit confirm (never silent). */
export type TalkUpgradeAction =
  | { type: 'to-agent'; agentId: string }
  | { type: 'to-team'; teamTemplateId: string }
  | { type: 'dismiss' };

export function applyTalkUpgrade(
  current: ComposeTalkTargetState,
  action: TalkUpgradeAction,
): ComposeTalkTargetState {
  if (action.type === 'dismiss') return current;
  if (action.type === 'to-agent') {
    return {
      ...current,
      kind: 'agent',
      targetId: action.agentId,
    };
  }
  return {
    ...current,
    kind: 'team',
    targetId: action.teamTemplateId,
  };
}
