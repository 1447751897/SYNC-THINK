import { describe, expect, it } from 'vitest';
import {
  countMarkdownTaskBoxes,
  projectDogfoodDayBoard,
  projectM1ExitEvidenceProgress,
  scoreDogfoodDiary,
} from '../src/renderer/m1-exit-evidence.js';
import {
  M1_DOGFOOD_REQUIRED_DAYS,
  resolveM1DogfoodRequiredDays,
} from '../src/renderer/m1-dogfood-policy.js';

describe('M1 dogfood policy', () => {
  it('uses one real day as the product default', () => {
    expect(M1_DOGFOOD_REQUIRED_DAYS).toBe(1);
    expect(resolveM1DogfoodRequiredDays()).toBe(1);
    expect(resolveM1DogfoodRequiredDays(0)).toBe(1);
    expect(resolveM1DogfoodRequiredDays(2)).toBe(2);
  });
});

describe('countMarkdownTaskBoxes', () => {
  it('counts checked and total task boxes', () => {
    const md = `
- [ ] a
- [x] b
- [X] c
* [ ] d
not a box
`;
    expect(countMarkdownTaskBoxes(md)).toEqual({ checked: 2, total: 4 });
  });
});

describe('scoreDogfoodDiary', () => {
  it('flags scaffold with many 待填', () => {
    const r = scoreDogfoodDiary(
      '# Dogfood\n脚手架\n- Provider A：待填\n- Provider B：待填\n- 模型：待填\n- 结论：待填\n- 重启：待填\n- 是否：待填\n',
    );
    expect(r.isScaffold).toBe(true);
  });

  it('accepts filled diary signals', () => {
    const r = scoreDogfoodDiary(
      '# Dogfood · 2026-07-13\n- [x] 启动桌面端\n- [x] 发送一轮\nProvider A：openai 已连接\n是否愿意继续：是\n',
    );
    expect(r.isScaffold).toBe(false);
    expect(r.filledSignals).toBeGreaterThan(0);
  });
});

describe('projectM1ExitEvidenceProgress', () => {
  it('reports empty when nothing started', () => {
    const r = projectM1ExitEvidenceProgress({
      handtestChecked: 0,
      handtestTotal: 18,
      dogfoodFileCount: 1,
      dogfoodRealDays: 0,
      sessionLevel: 'empty',
      dualAutomatedOk: false,
    });
    expect(r.level).toBe('empty');
    expect(r.hardGatesMet).toBe(false);
    expect(r.summary).toMatch(/未开始/);
    expect(r.chips.find((c) => c.id === 'handtest')?.detail).toBe('0/18');
  });

  it('reports soft-only when session ready + dual green but hard gates empty', () => {
    const r = projectM1ExitEvidenceProgress({
      handtestChecked: 0,
      handtestTotal: 18,
      dogfoodFileCount: 1,
      dogfoodRealDays: 0,
      sessionLevel: 'ready',
      dualAutomatedOk: true,
    });
    expect(r.level).toBe('soft-only');
    expect(r.sessionSoftOk).toBe(true);
    expect(r.dualAutomatedOk).toBe(true);
    expect(r.hardGatesMet).toBe(false);
    expect(r.summary).toMatch(/硬门槛/);
    expect(r.note).toMatch(/不能替代|外网/);
  });

  it('treats one real dogfood day as complete while handtest is still advancing', () => {
    const r = projectM1ExitEvidenceProgress({
      handtestChecked: 5,
      handtestTotal: 18,
      dogfoodFileCount: 2,
      dogfoodRealDays: 1,
      sessionLevel: 'partial',
      dualAutomatedOk: true,
    });
    expect(r.level).toBe('partial');
    expect(r.handtestPartial).toBe(true);
    expect(r.dogfoodOk).toBe(true);
    expect(r.dogfoodPartial).toBe(false);
    expect(r.chips.find((c) => c.id === 'dogfood')?.detail).toMatch(/1\/1/);
  });

  it('reports evidence-ready only when both hard gates + soft ready', () => {
    const r = projectM1ExitEvidenceProgress({
      handtestChecked: 18,
      handtestTotal: 18,
      dogfoodFileCount: 1,
      dogfoodRealDays: 1,
      sessionLevel: 'ready',
      dualAutomatedOk: true,
    });
    expect(r.level).toBe('evidence-ready');
    expect(r.hardGatesMet).toBe(true);
    expect(r.handtestOk).toBe(true);
    expect(r.dogfoodOk).toBe(true);
    expect(r.summary).toMatch(/M1 已完成/);
    expect(r.note).toMatch(/不会自动关|人工复核/);
  });

  it('hard gates met without soft stays partial-ish not evidence-ready', () => {
    const r = projectM1ExitEvidenceProgress({
      handtestChecked: 18,
      handtestTotal: 18,
      dogfoodFileCount: 1,
      dogfoodRealDays: 1,
      sessionLevel: 'partial',
      dualAutomatedOk: true,
    });
    expect(r.hardGatesMet).toBe(true);
    expect(r.level).not.toBe('evidence-ready');
    expect(r.summary).toMatch(/soft|硬门槛/);
  });
});

describe('projectDogfoodDayBoard', () => {
  it('maps real and scaffold days with status labels', () => {
    const board = projectDogfoodDayBoard([
      {
        date: '2026-07-12',
        kind: 'scaffold',
        pendingCount: 8,
        checkedCount: 0,
        filledSignals: 0,
        fileName: '2026-07-12.md',
      },
      {
        date: '2026-07-13',
        kind: 'real',
        pendingCount: 1,
        checkedCount: 4,
        filledSignals: 5,
        fileName: '2026-07-13.md',
      },
    ]);
    expect(board).toHaveLength(2);
    expect(board[0]!.kind).toBe('scaffold');
    expect(board[0]!.statusLabel).toMatch(/脚手架/);
    expect(board[1]!.kind).toBe('real');
    expect(board[1]!.statusLabel).toMatch(/有效/);
  });

  it('returns empty for missing days', () => {
    expect(projectDogfoodDayBoard(undefined)).toEqual([]);
    expect(projectDogfoodDayBoard([])).toEqual([]);
  });
});

describe('projectM1ExitEvidenceProgress dogfood board', () => {
  it('includes dogfoodDays on progress output', () => {
    const r = projectM1ExitEvidenceProgress({
      handtestChecked: 0,
      handtestTotal: 18,
      dogfoodFileCount: 1,
      dogfoodRealDays: 0,
      sessionLevel: 'ready',
      dualAutomatedOk: true,
      dogfoodDays: [
        {
          date: '2026-07-12',
          kind: 'scaffold',
          pendingCount: 6,
          checkedCount: 0,
          filledSignals: 0,
          fileName: '2026-07-12.md',
        },
      ],
    });
    expect(r.dogfoodDays).toHaveLength(1);
    expect(r.dogfoodDays[0]!.kind).toBe('scaffold');
    expect(r.level).toBe('soft-only');
    expect(r.hardGatesMet).toBe(false);
  });
});

describe('projectDogfoodDayBoard draft reasons (#43)', () => {
  it('maps paste assist rows to draft boardKind', () => {
    const board = projectDogfoodDayBoard([
      {
        date: '2026-07-12',
        kind: 'scaffold',
        pendingCount: 12,
        checkedCount: 6,
        filledSignals: 0,
        fileName: '2026-07-12.md',
        isPasteAssist: true,
        reasons: ['粘贴草稿特征', '不计有效日'],
        statusHint: '草稿 · 待改 12',
      },
    ]);
    expect(board[0]!.boardKind).toBe('draft');
    expect(board[0]!.isPasteAssist).toBe(true);
    expect(board[0]!.statusLabel).toMatch(/草稿/);
    expect(board[0]!.reasons[0]).toMatch(/粘贴|草稿/);
  });
});
