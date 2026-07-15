import { describe, expect, it } from 'vitest';
import {
  projectLeftInstrumentSwitch,
  leftInstrumentFromJump,
  isLeftInstrumentId,
  LEFT_INSTRUMENT_SOFT_CRAFT_ROUND,
  closeLeftInstrumentDrawer,
  resolveLeftInstrumentDrawer,
} from '../src/renderer/left-instrument-switch.js';

describe('left-instrument-switch', () => {
  it('defaults invalid active to providers and never claims M1 closed', () => {
    const s = projectLeftInstrumentSwitch({
      active: 'nope' as never,
      providerCount: 0,
    });
    expect(s.active).toBe('providers');
    expect(s.claimsM1Closed).toBe(false);
    expect(s.items).toHaveLength(4);
    expect(s.items.filter((i) => i.active)).toHaveLength(1);
    expect(s.softCraftRound).toBe(LEFT_INSTRUMENT_SOFT_CRAFT_ROUND);
    expect(s.softCraftRound).toBe(64);
  });

  it('shows badges for counts and marks active instrument', () => {
    const s = projectLeftInstrumentSwitch({
      active: 'agent',
      providerCount: 2,
      skillCount: 3,
      memoryPending: 1,
      approvalPending: 4,
    });
    expect(s.active).toBe('agent');
    expect(s.items.find((i) => i.id === 'providers')?.badge).toBe('2');
    expect(s.items.find((i) => i.id === 'agent')?.badge).toBe('3');
    expect(s.items.find((i) => i.id === 'agent')?.active).toBe(true);
    expect(s.items.find((i) => i.id === 'approvals')?.badge).toBe('4');
    expect(s.summary).toMatch(/智能体/);
  });

  it('maps jump targets', () => {
    expect(leftInstrumentFromJump('providers')).toBe('providers');
    expect(leftInstrumentFromJump('agents')).toBe('agent');
    expect(leftInstrumentFromJump('settings')).toBe('providers');
    expect(leftInstrumentFromJump('memory')).toBe('memory');
    expect(leftInstrumentFromJump('approvals')).toBe('approvals');
    expect(leftInstrumentFromJump('compose')).toBe(null);
    expect(isLeftInstrumentId('memory')).toBe(true);
    expect(isLeftInstrumentId('compose')).toBe(false);
  });

  it('opens a closed drawer and toggles the active tool closed', () => {
    expect(
      resolveLeftInstrumentDrawer(
        { active: 'providers', open: false },
        'providers',
      ),
    ).toEqual({ active: 'providers', open: true });

    expect(
      resolveLeftInstrumentDrawer(
        { active: 'providers', open: true },
        'providers',
      ),
    ).toEqual({ active: 'providers', open: false });
  });

  it('replaces drawer content without closing and dismisses without losing selection', () => {
    expect(
      resolveLeftInstrumentDrawer(
        { active: 'providers', open: true },
        'agent',
      ),
    ).toEqual({ active: 'agent', open: true });

    expect(closeLeftInstrumentDrawer('agent')).toEqual({
      active: 'agent',
      open: false,
    });
  });
});
