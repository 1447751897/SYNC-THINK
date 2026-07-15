import { describe, expect, it } from 'vitest';
import {
  countDogfoodPendingMarkers,
  looksLikeDogfoodPasteAssist,
  scoreDogfoodDiary,
} from '../src/m1-dogfood-score.js';
import { formatM1DogfoodDayDraft } from '../src/renderer/m1-dogfood-draft.js';
import {
  listDogfoodDayReports,
  scoreDogfoodDiary as scoreMain,
} from '../src/main/m1-exit-evidence-load.js';
import {
  projectDogfoodDayBoard,
  projectM1ExitEvidenceProgress,
} from '../src/renderer/m1-exit-evidence.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const PASTE_DRAFT_SOFT_GREEN = formatM1DogfoodDayDraft({
  date: '2026-07-12',
  generatedAt: '2026-07-12T12:00:00Z',
  connectionState: 'online',
  hasActiveTask: true,
  taskTitle: 'demo',
  providerCount: 2,
  modelCount: 3,
  secretCount: 2,
  providersReadySoft: true,
  agentDefaultSet: true,
  agentFallbackCount: 1,
  sessionLevel: 'ready',
  handtestLivePass: 10,
  handtestLiveTotal: 18,
  handtestDocChecked: 0,
  handtestDocTotal: 18,
  handtestExternalPending: 8,
  dogfoodRealDays: 0,
  dogfoodRequired: 3,
  dogfoodFileCount: 1,
  dualAutomatedOk: true,
  hardGatesMet: false,
  exitLevel: 'soft-only',
  distinctMessageModelCount: 3,
  manifestCount: 2,
  hasTraceEvents: true,
  softCraftRound: 42,
}).markdown;

describe('countDogfoodPendingMarkers', () => {
  it('counts 待填 and 待你确认 without double-count', () => {
    expect(countDogfoodPendingMarkers('待填\n待你确认\n待确认')).toBe(3);
    expect(countDogfoodPendingMarkers('待你确认 · 待你确认')).toBe(2);
  });
});

describe('looksLikeDogfoodPasteAssist', () => {
  it('detects copy-dogfood-draft banner', () => {
    expect(looksLikeDogfoodPasteAssist(PASTE_DRAFT_SOFT_GREEN)).toBe(true);
    expect(
      looksLikeDogfoodPasteAssist('# Dogfood · 2026-07-12\n- [x] 启动\n是否愿意：是\n'),
    ).toBe(false);
  });
});

describe('scoreDogfoodDiary (hardening #43)', () => {
  it('refuses soft-green paste draft as real day', () => {
    const r = scoreDogfoodDiary(PASTE_DRAFT_SOFT_GREEN);
    expect(r.isScaffold).toBe(true);
    expect(r.isPasteAssist).toBe(true);
    expect(r.pendingCount).toBeGreaterThanOrEqual(4);
    expect(r.statusHint).toMatch(/草稿/);
    expect(r.reasons.some((x) => /粘贴|草稿|不计/.test(x))).toBe(true);
  });

  it('still flags classic scaffold with 待填', () => {
    const r = scoreDogfoodDiary(
      '# Dogfood\n脚手架\n- Provider A：待填\n- Provider B：待填\n- 模型：待填\n- 结论：待填\n',
    );
    expect(r.isScaffold).toBe(true);
    expect(r.isPasteAssist).toBe(false);
  });

  it('accepts filled human diary', () => {
    const r = scoreDogfoodDiary(
      '# Dogfood · 2026-07-13\n- [x] 启动桌面端\n- [x] 发送一轮\nProvider A：openai 已连接\n是否愿意继续：是\n重启后对话仍在：是\n',
    );
    expect(r.isScaffold).toBe(false);
    expect(r.isPasteAssist).toBe(false);
    expect(r.filledSignals).toBeGreaterThan(0);
    expect(r.statusHint).toMatch(/有效/);
  });

  it('honors an explicit same-day not-counted conclusion despite checked evidence', () => {
    const r = scoreDogfoodDiary(
      [
        '# Dogfood · 2026-07-13（进行中，尚未计入 3 天门槛）',
        '- [x] Runtime 在线并恢复任务',
        '- [x] 真实长回复完成',
        '- [x] 取消后 Composer 恢复',
        '- [x] run.cancelled 唯一终态',
        '- [x] Manifest 可检查',
        '## 当前结论',
        '- 真实取消路径通过；本日暂不计入 dogfood 天数，M1 仍为 **1/3**。',
      ].join('\n'),
    );
    expect(r.isScaffold).toBe(true);
    expect(r.statusHint).toMatch(/脚手架/);
    expect(r.reasons).toContain('明确未计入');
  });

  it('refuses half-filled paste leftover with many 待你确认', () => {
    const r = scoreDogfoodDiary(
      [
        '# Dogfood · 2026-07-14',
        '- [x] Runtime online',
        '- Provider A：待你确认',
        '- Provider B：待你确认',
        '- 模型切换：待你确认',
        '- 重启：待你确认',
        '- 结论：待你确认',
      ].join('\n'),
    );
    expect(r.isScaffold).toBe(true);
  });
});

describe('listDogfoodDayReports + board projection', () => {
  it('classifies paste draft as scaffold with paste flag', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-dogfood-score-'));
    fs.writeFileSync(path.join(dir, '2026-07-12.md'), PASTE_DRAFT_SOFT_GREEN, 'utf8');
    fs.writeFileSync(
      path.join(dir, '2026-07-13.md'),
      '# Dogfood · 2026-07-13\n- [x] 启动桌面端\n- [x] 发送一轮\nProvider A：openai 已连接\n是否愿意继续：是\n',
      'utf8',
    );
    const r = listDogfoodDayReports(dir);
    expect(r.dogfoodFileCount).toBe(2);
    expect(r.dogfoodRealDays).toBe(1);
    expect(r.days[0]!.kind).toBe('scaffold');
    expect(r.days[0]!.isPasteAssist).toBe(true);
    expect(r.days[1]!.kind).toBe('real');

    const board = projectDogfoodDayBoard(r.days);
    expect(board[0]!.boardKind).toBe('draft');
    expect(board[0]!.statusLabel).toMatch(/草稿|脚手架|待/);
    expect(board[1]!.boardKind).toBe('real');

    const progress = projectM1ExitEvidenceProgress({
      handtestChecked: 0,
      handtestTotal: 18,
      dogfoodFileCount: r.dogfoodFileCount,
      dogfoodRealDays: r.dogfoodRealDays,
      sessionLevel: 'ready',
      dualAutomatedOk: true,
      dogfoodDays: r.days,
    });
    expect(progress.dogfoodDraftDays).toBe(1);
    expect(progress.hardGatesMet).toBe(false);
    expect(progress.note).toMatch(/草稿/);
    expect(progress.chips.find((c) => c.id === 'dogfood')?.detail).toMatch(/草稿1/);
  });

  it('main re-export score matches pure module on draft', () => {
    expect(scoreMain(PASTE_DRAFT_SOFT_GREEN).isScaffold).toBe(true);
  });
});
