import { describe, expect, it } from 'vitest';
import {
  projectM1DogfoodFillBoard,
  formatM1DogfoodFillBoardPaste,
  dogfoodFillBoardLooksSecretFree,
  localYmd,
  shiftYmd,
} from '../src/renderer/m1-dogfood-fill-board.js';

describe('localYmd / shiftYmd', () => {
  it('formats local YYYY-MM-DD without UTC shift', () => {
    const d = new Date(2026, 6, 12); // July 12 local
    expect(localYmd(d)).toBe('2026-07-12');
  });

  it('shifts calendar days', () => {
    expect(shiftYmd('2026-07-12', 0)).toBe('2026-07-12');
    expect(shiftYmd('2026-07-12', -1)).toBe('2026-07-11');
    expect(shiftYmd('2026-07-01', -1)).toBe('2026-06-30');
    expect(shiftYmd('bad', -1)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('projectM1DogfoodFillBoard', () => {
  it('empty window when no files', () => {
    const b = projectM1DogfoodFillBoard({
      today: '2026-07-12',
      dogfoodRequired: 3,
      dogfoodRealDays: 0,
      dogfoodFileCount: 0,
      days: [],
    });
    expect(b.claimsM1Closed).toBe(false);
    expect(b.claimsDogfoodReal).toBe(false);
    expect(b.level).toBe('empty');
    expect(b.remainingDays).toBe(3);
    expect(b.missingSlots).toEqual(['2026-07-12', '2026-07-11', '2026-07-10']);
    expect(b.rows.some((r) => r.kind === 'missing' && r.date === '2026-07-12')).toBe(true);
    expect(b.primaryCta.action).toBe('open-today');
    expect(b.summary).toMatch(/有效 0\/3/);
  });

  it('classifies scaffold / draft / real and never upgrades draft', () => {
    const b = projectM1DogfoodFillBoard({
      today: '2026-07-12',
      dogfoodRequired: 3,
      dogfoodRealDays: 1,
      dogfoodFileCount: 3,
      days: [
        {
          date: '2026-07-12',
          kind: 'scaffold',
          boardKind: 'scaffold',
          pendingCount: 4,
          statusLabel: '脚手架',
          reasons: ['填充不足'],
        },
        {
          date: '2026-07-11',
          kind: 'scaffold',
          boardKind: 'draft',
          isPasteAssist: true,
          pendingCount: 5,
          statusLabel: '草稿',
        },
        {
          date: '2026-07-10',
          kind: 'real',
          boardKind: 'real',
          pendingCount: 0,
          statusLabel: '有效',
        },
      ],
    });
    expect(b.level).toBe('partial');
    expect(b.realDays).toBe(1);
    expect(b.draftDays).toBe(1);
    expect(b.scaffoldDays).toBe(1);
    expect(b.remainingDays).toBe(2);
    const draft = b.rows.find((r) => r.date === '2026-07-11')!;
    expect(draft.kind).toBe('draft');
    expect(draft.countsAsReal).toBe(false);
    expect(draft.fillHint).toMatch(/草稿不计有效日/);
    const real = b.rows.find((r) => r.date === '2026-07-10')!;
    expect(real.countsAsReal).toBe(true);
    expect(b.claimsDogfoodReal).toBe(false);
    expect(b.claimsM1Closed).toBe(false);
  });

  it('scaffold-only level when only scaffolds', () => {
    const b = projectM1DogfoodFillBoard({
      today: '2026-07-12',
      dogfoodRequired: 3,
      dogfoodRealDays: 0,
      dogfoodFileCount: 1,
      days: [
        {
          date: '2026-07-12',
          kind: 'scaffold',
          boardKind: 'scaffold',
          pendingCount: 3,
        },
      ],
    });
    expect(b.level).toBe('scaffold-only');
    expect(b.primaryCta.action).toBe('open-oldest-scaffold');
    expect(b.primaryCta.targetDate).toBe('2026-07-12');
  });

  it('blocked-fake when only paste drafts', () => {
    const b = projectM1DogfoodFillBoard({
      today: '2026-07-12',
      dogfoodRequired: 3,
      dogfoodRealDays: 0,
      dogfoodFileCount: 1,
      days: [
        {
          date: '2026-07-12',
          kind: 'scaffold',
          boardKind: 'draft',
          isPasteAssist: true,
          pendingCount: 6,
        },
      ],
    });
    expect(b.level).toBe('blocked-fake');
    expect(b.draftDays).toBe(1);
    expect(b.realDays).toBe(0);
  });

  it('ready-count still never claims closed', () => {
    const b = projectM1DogfoodFillBoard({
      today: '2026-07-12',
      dogfoodRequired: 3,
      dogfoodRealDays: 3,
      dogfoodFileCount: 3,
      days: [
        { date: '2026-07-12', kind: 'real', boardKind: 'real' },
        { date: '2026-07-11', kind: 'real', boardKind: 'real' },
        { date: '2026-07-10', kind: 'real', boardKind: 'real' },
      ],
    });
    expect(b.level).toBe('ready-count');
    expect(b.remainingDays).toBe(0);
    expect(b.primaryCta.action).toBe('none');
    expect(b.primaryCta.label).toMatch(/门槛已满.*状态见验证区/);
    expect(b.claimsM1Closed).toBe(false);
    expect(b.claimsDogfoodReal).toBe(false);
  });

  it('row CTAs open-day / open-today for missing', () => {
    const b = projectM1DogfoodFillBoard({
      today: '2026-07-12',
      dogfoodRequired: 3,
      days: [],
    });
    const today = b.rows.find((r) => r.date === '2026-07-12')!;
    expect(today.ctaAction).toBe('open-today');
    const older = b.rows.find((r) => r.date === '2026-07-11')!;
    expect(older.ctaAction).toBe('open-day');
  });
});

describe('formatM1DogfoodFillBoardPaste', () => {
  it('paste is secret-free and marks non-close', () => {
    const b = projectM1DogfoodFillBoard({
      today: '2026-07-12',
      dogfoodRequired: 3,
      dogfoodRealDays: 0,
      dogfoodFileCount: 0,
      days: [],
      softCraftRound: 54,
    });
    const paste = formatM1DogfoodFillBoardPaste(b, {
      softCraftRound: 54,
      today: '2026-07-12',
    });
    expect(paste).toMatch(/多日补填板/);
    expect(paste).toMatch(/claimsM1Closed: false/);
    expect(paste).toMatch(/claimsDogfoodReal: false/);
    expect(paste).toMatch(/soft craft 轮次：54/);
    expect(paste).toMatch(/2026-07-12/);
    expect(dogfoodFillBoardLooksSecretFree(paste)).toBe(true);
    expect(dogfoodFillBoardLooksSecretFree('sk-abcdefghijklmnopqrstuvwxyz1234')).toBe(false);
  });
});
