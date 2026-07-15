import { describe, expect, it } from 'vitest';
import {
  projectM1HandtestDocDiff,
  listM1HandtestDocDiffAttention,
  formatM1HandtestDocDiffPaste,
  handtestDocDiffLooksSecretFree,
  planM1HandtestDocDiffCta,
  isM1HandtestDocDiffCtaActionable,
  filterM1HandtestDocDiffAttention,
} from '../src/renderer/m1-handtest-doc-diff.js';

const base = [
  {
    id: 'pre-runtime',
    label: 'Runtime 已连接',
    section: 'pre',
    status: 'pass' as const,
    gate: 'live' as const,
    docChecked: false,
  },
  {
    id: 'pre-task',
    label: '已打开任务',
    section: 'pre',
    status: 'pending' as const,
    gate: 'live' as const,
    docChecked: false,
  },
  {
    id: 'b-multi-model',
    label: '多模型',
    section: 'B',
    status: 'pending' as const,
    gate: 'external' as const,
    docChecked: false,
  },
  {
    id: 'd-no-secret',
    label: '无密钥',
    section: 'D',
    status: 'pass' as const,
    gate: 'live' as const,
    docChecked: true,
  },
];

describe('projectM1HandtestDocDiff', () => {
  it('classifies live-ahead / external-gap / aligned and never claims closed', () => {
    const r = projectM1HandtestDocDiff(base);
    expect(r.claimsM1Closed).toBe(false);
    expect(r.liveAhead).toBe(1);
    expect(r.externalGap).toBe(1);
    expect(r.alignedPass).toBe(1);
    expect(r.total).toBe(4);
    expect(r.level).toMatch(/attention|critical|quiet/);
    expect(r.summary).toMatch(/本机领先待勾/);
    expect(r.primaryCta.kind).toBe('open-handtest');
    expect(r.primaryCta.liveAhead).toBe(1);
    expect(r.primaryCta.label).toMatch(/本机领先|打开手测/);
  });

  it('marks doc-ahead when doc ticked but live not green', () => {
    const r = projectM1HandtestDocDiff([
      {
        id: 'pre-task',
        label: '任务',
        section: 'pre',
        status: 'pending',
        gate: 'live',
        docChecked: true,
      },
    ]);
    expect(r.docAhead).toBe(1);
    expect(r.rows[0].kind).toBe('doc-ahead');
    expect(r.rows[0].ctaKind).toBe('jump-panel');
    expect(r.rows[0].ctaLabel).toMatch(/跳转|打开/);
  });

  it('assigns CTA for live-ahead rows (open doc + jump when jumpable)', () => {
    const r = projectM1HandtestDocDiff(base);
    const live = r.rows.find((x) => x.id === 'pre-runtime');
    expect(live?.kind).toBe('live-ahead');
    expect(live?.ctaKind).toBe('open-handtest-and-jump');
    expect(live?.jumpable).toBe(true);
    expect(live?.jumpTarget).toBe('workspaces');
    expect(isM1HandtestDocDiffCtaActionable(live!.ctaKind)).toBe(true);
  });
});

describe('listM1HandtestDocDiffAttention + filter', () => {
  it('lists only attention kinds', () => {
    const board = projectM1HandtestDocDiff(base);
    const attn = listM1HandtestDocDiffAttention(board);
    expect(attn.every((r) => r.kind !== 'aligned-pass')).toBe(true);
    expect(attn.some((r) => r.kind === 'live-ahead')).toBe(true);
    const onlyLive = filterM1HandtestDocDiffAttention(attn, 'live-ahead');
    expect(onlyLive.every((r) => r.kind === 'live-ahead')).toBe(true);
    expect(onlyLive.length).toBe(1);
  });
});

describe('planM1HandtestDocDiffCta', () => {
  it('plans open/jump flags', () => {
    expect(planM1HandtestDocDiffCta('open-handtest')).toEqual({
      openHandtest: true,
      jumpPanel: false,
    });
    expect(planM1HandtestDocDiffCta('jump-panel')).toEqual({
      openHandtest: false,
      jumpPanel: true,
    });
    expect(planM1HandtestDocDiffCta('open-handtest-and-jump')).toEqual({
      openHandtest: true,
      jumpPanel: true,
    });
    expect(planM1HandtestDocDiffCta('none')).toEqual({
      openHandtest: false,
      jumpPanel: false,
    });
  });
});

describe('formatM1HandtestDocDiffPaste', () => {
  it('formats paste with CTA and stays secret-free', () => {
    const board = projectM1HandtestDocDiff(base);
    const paste = formatM1HandtestDocDiffPaste(board);
    expect(paste).toMatch(/文档↔本机差异/);
    expect(paste).toMatch(/live-ahead|本机领先|CTA=/);
    expect(paste).toMatch(/主行动/);
    expect(paste).toMatch(/claimsM1Closed: false/);
    expect(handtestDocDiffLooksSecretFree(paste)).toBe(true);
    expect(
      handtestDocDiffLooksSecretFree('sk-abcdefghijklmnopqrstuvwxyz1234'),
    ).toBe(false);
  });

  it('does not ask for external confirmation when every document row is aligned', () => {
    const board = projectM1HandtestDocDiff([
      {
        id: 'b-multi-model',
        label: '多模型',
        section: 'B',
        status: 'pass',
        gate: 'external',
        docChecked: true,
      },
    ]);
    const paste = formatM1HandtestDocDiffPaste(board);
    expect(paste).toMatch(/已对齐|无待办差异/);
    expect(paste).not.toMatch(/外网.*仍须人手/);
  });
});
