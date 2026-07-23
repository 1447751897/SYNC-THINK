import { describe, expect, it } from 'vitest';
import {
  PRODUCT_PRIMARY_NAV,
  TALK_TRACK_NAV,
  applyTalkUpgrade,
  composeKindFromTalkTrack,
  defaultComposeTalkTarget,
  defaultProductShellNavState,
  isProductPrimaryNavId,
  isTalkTrackId,
  primaryNavFromLegacyInstrument,
  projectMainStage,
  projectProductPrimaryNav,
  projectRightRailTabs,
  projectTalkTrackNav,
  resolvePrimaryNav,
  resolveTalkTrack,
  talkTrackFromComposeKind,
} from '../src/renderer/product-shell-nav.js';

describe('product-shell-nav', () => {
  it('exposes NewMax-style primary nav without approval center', () => {
    expect(PRODUCT_PRIMARY_NAV.map((i) => i.id)).toEqual([
      'talk',
      'project',
      'agents',
      'teams',
      'capabilities',
      'settings',
    ]);
    expect(PRODUCT_PRIMARY_NAV.some((i) => i.label === '审批')).toBe(false);
    expect(TALK_TRACK_NAV.map((i) => i.id)).toEqual(['model', 'agent', 'team']);
  });

  it('defaults to talk / model track and projects stage', () => {
    const state = defaultProductShellNavState();
    expect(state.primary).toBe('talk');
    expect(state.talkTrack).toBe('model');
    expect(projectMainStage(state)).toEqual({ kind: 'talk', track: 'model' });
  });

  it('switches primary nav and talk tracks without losing split defaults', () => {
    let state = defaultProductShellNavState();
    state = resolvePrimaryNav(state, 'agents');
    expect(projectMainStage(state)).toEqual({ kind: 'agents' });
    state = resolveTalkTrack(state, 'team');
    expect(state.primary).toBe('talk');
    expect(state.talkTrack).toBe('team');
    expect(projectMainStage(state)).toEqual({ kind: 'talk', track: 'team' });
  });

  it('projects badges and talk track copy', () => {
    const nav = projectProductPrimaryNav({
      active: 'agents',
      agentCount: 3,
      teamCount: 1,
      skillCount: 5,
    });
    expect(nav.active).toBe('agents');
    expect(nav.items.find((i) => i.id === 'agents')?.badge).toBe('3');
    expect(nav.items.find((i) => i.id === 'teams')?.badge).toBe('1');
    expect(nav.summary).toMatch(/智能体/);

    const tracks = projectTalkTrackNav({ active: 'agent' });
    expect(tracks.items.filter((i) => i.active)).toHaveLength(1);
    expect(tracks.summary).toMatch(/智能体/);
  });

  it('hides diagnostics tab unless developer log is on', () => {
    const normal = projectRightRailTabs({ active: 'diagnostics', developerLog: false });
    expect(normal.items.some((i) => i.id === 'diagnostics')).toBe(false);
    expect(normal.active).not.toBe('diagnostics');

    const dev = projectRightRailTabs({ active: 'diagnostics', developerLog: true });
    expect(dev.items.some((i) => i.id === 'diagnostics')).toBe(true);
    expect(dev.active).toBe('diagnostics');
  });

  it('maps legacy instruments and validates ids', () => {
    expect(primaryNavFromLegacyInstrument('agent')).toBe('agents');
    expect(primaryNavFromLegacyInstrument('approvals')).toBe('talk');
    expect(primaryNavFromLegacyInstrument('providers')).toBe('settings');
    expect(isProductPrimaryNavId('talk')).toBe(true);
    expect(isProductPrimaryNavId('approvals')).toBe(false);
    expect(isTalkTrackId('model')).toBe(true);
    expect(isTalkTrackId('chat')).toBe(false);
  });

  it('keeps permission on compose target only and requires explicit upgrade', () => {
    const base = defaultComposeTalkTarget({
      kind: 'model',
      targetId: 'gpt-x',
      permissionMode: 'full-access',
    });
    expect(base.permissionMode).toBe('full-access');
    expect(talkTrackFromComposeKind(base.kind)).toBe('model');
    expect(composeKindFromTalkTrack('team')).toBe('team');

    const upgraded = applyTalkUpgrade(base, {
      type: 'to-agent',
      agentId: 'agent_builder',
    });
    expect(upgraded.kind).toBe('agent');
    expect(upgraded.targetId).toBe('agent_builder');
    expect(upgraded.permissionMode).toBe('full-access');

    expect(applyTalkUpgrade(base, { type: 'dismiss' })).toEqual(base);
  });
});
