/**
 * Left tool drawer — one temporary instrument beside the workspace tree.
 * Soft craft: declutter crowded left column (design §15.2). Never closes M1.
 */

export type LeftInstrumentId = 'providers' | 'agent' | 'memory' | 'approvals';

export interface LeftInstrumentDef {
  id: LeftInstrumentId;
  label: string;
  short: string;
  /** data-instrument / CSS stack class suffix */
  stackKey: string;
  testId: string;
}

export const LEFT_INSTRUMENTS: readonly LeftInstrumentDef[] = [
  {
    id: 'providers',
    label: 'Providers',
    short: '模型源',
    stackKey: 'providers',
    testId: 'left-inst-providers',
  },
  {
    id: 'agent',
    label: '智能体',
    short: '中心',
    stackKey: 'agent',
    testId: 'left-inst-agent',
  },
  {
    id: 'memory',
    label: '记忆',
    short: '诊断',
    stackKey: 'memory',
    testId: 'left-inst-memory',
  },
  {
    id: 'approvals',
    label: '审批',
    short: '中心',
    stackKey: 'approval',
    testId: 'left-inst-approvals',
  },
] as const;

export const LEFT_INSTRUMENT_SOFT_CRAFT_ROUND = 64;

export interface LeftInstrumentDrawerState {
  active: LeftInstrumentId;
  open: boolean;
}

export function resolveLeftInstrumentDrawer(
  current: LeftInstrumentDrawerState,
  selected: LeftInstrumentId,
): LeftInstrumentDrawerState {
  const active = isLeftInstrumentId(selected) ? selected : 'providers';
  return {
    active,
    open: current.active === active ? !current.open : true,
  };
}

export function closeLeftInstrumentDrawer(
  active: LeftInstrumentId,
): LeftInstrumentDrawerState {
  return {
    active: isLeftInstrumentId(active) ? active : 'providers',
    open: false,
  };
}

export function isLeftInstrumentId(value: unknown): value is LeftInstrumentId {
  return (
    value === 'providers' ||
    value === 'agent' ||
    value === 'memory' ||
    value === 'approvals'
  );
}

export function projectLeftInstrumentSwitch(input: {
  active: LeftInstrumentId;
  providerCount?: number;
  skillCount?: number;
  memoryPending?: number;
  approvalPending?: number;
  softCraftRound?: number;
}): {
  active: LeftInstrumentId;
  items: Array<
    LeftInstrumentDef & {
      active: boolean;
      badge: string | null;
      ariaLabel: string;
    }
  >;
  summary: string;
  softCraftRound: number;
  claimsM1Closed: false;
} {
  const active = isLeftInstrumentId(input.active) ? input.active : 'providers';
  const softCraftRound =
    typeof input.softCraftRound === 'number' && input.softCraftRound > 0
      ? input.softCraftRound
      : LEFT_INSTRUMENT_SOFT_CRAFT_ROUND;

  const badgeFor = (id: LeftInstrumentId): string | null => {
    if (id === 'providers') {
      const n = Math.max(0, Number(input.providerCount ?? 0) || 0);
      return n > 0 ? String(n) : null;
    }
    if (id === 'agent') {
      const n = Math.max(0, Number(input.skillCount ?? 0) || 0);
      return n > 0 ? String(n) : null;
    }
    if (id === 'memory') {
      const n = Math.max(0, Number(input.memoryPending ?? 0) || 0);
      return n > 0 ? String(n) : null;
    }
    if (id === 'approvals') {
      const n = Math.max(0, Number(input.approvalPending ?? 0) || 0);
      return n > 0 ? String(n) : null;
    }
    return null;
  };

  const items = LEFT_INSTRUMENTS.map((def) => {
    const isActive = def.id === active;
    const badge = badgeFor(def.id);
    return {
      ...def,
      active: isActive,
      badge,
      ariaLabel: badge ? `${def.label}（${badge}）` : def.label,
    };
  });

  const activeDef = LEFT_INSTRUMENTS.find((d) => d.id === active) ?? LEFT_INSTRUMENTS[0];
  return {
    active,
    items,
    summary: `${activeDef.label} · 临时工具抽屉`,
    softCraftRound,
    claimsM1Closed: false,
  };
}

/** Map session jump targets onto left instruments when applicable. */
export function leftInstrumentFromJump(
  target: string | null | undefined,
): LeftInstrumentId | null {
  const t = String(target ?? '');
  if (t === 'providers' || t === 'settings') return 'providers';
  if (t === 'agent' || t === 'agents') return 'agent';
  if (t === 'memory') return 'memory';
  if (t === 'approvals') return 'approvals';
  return null;
}
