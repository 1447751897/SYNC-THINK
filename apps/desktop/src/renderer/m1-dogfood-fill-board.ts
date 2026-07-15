/**
 * Dogfood fill board — hard-gate assist for the required real diary days.
 * Soft only: never writes dogfood files, never treats paste drafts as real,
 * never closes M1, never includes secrets.
 *
 * #54: project remaining day slots + per-day fill actions from scored days.
 */
import { resolveM1DogfoodRequiredDays } from './m1-dogfood-policy.js';

export type M1DogfoodFillDayKind = 'real' | 'scaffold' | 'draft' | 'missing';

export interface M1DogfoodFillDayInput {
  date: string;
  kind?: string;
  boardKind?: string;
  isPasteAssist?: boolean;
  pendingCount?: number;
  checkedCount?: number;
  filledSignals?: number;
  statusLabel?: string;
  reasons?: readonly string[];
  fileName?: string;
}

export interface M1DogfoodFillDayRow {
  date: string;
  kind: M1DogfoodFillDayKind;
  pendingCount: number;
  checkedCount: number;
  filledSignals: number;
  statusLabel: string;
  reasons: string[];
  /** One-line Chinese fill hint for the day. */
  fillHint: string;
  ctaLabel: string;
  ctaAction: 'open-day' | 'open-today' | 'copy-draft' | 'none';
  countsAsReal: boolean;
}

export interface M1DogfoodFillBoard {
  rows: M1DogfoodFillDayRow[];
  required: number;
  realDays: number;
  fileCount: number;
  draftDays: number;
  scaffoldDays: number;
  remainingDays: number;
  /** Suggested calendar slots still empty (YYYY-MM-DD), newest first. */
  missingSlots: string[];
  level: 'empty' | 'scaffold-only' | 'partial' | 'ready-count' | 'blocked-fake';
  summary: string;
  primaryCta: {
    action: 'open-today' | 'copy-draft' | 'open-oldest-scaffold' | 'none';
    label: string;
    targetDate: string | null;
  };
  /** Always false. */
  claimsM1Closed: false;
  /** Always false — board never upgrades scaffold to real. */
  claimsDogfoodReal: false;
}

export interface M1DogfoodFillBoardInput {
  days?: readonly M1DogfoodFillDayInput[] | null;
  dogfoodRealDays?: number;
  dogfoodFileCount?: number;
  dogfoodRequired?: number;
  /** YYYY-MM-DD; defaults to local today. */
  today?: string;
  softCraftRound?: number | null;
}

function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

/** Local calendar YYYY-MM-DD (no UTC shift for dogfood filenames). */
export function localYmd(d: Date = new Date()): string {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/** Subtract calendar days from YYYY-MM-DD (local parse). */
export function shiftYmd(ymd: string, deltaDays: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '').trim());
  if (!m) return localYmd();
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  dt.setDate(dt.getDate() + deltaDays);
  return localYmd(dt);
}

function classifyKind(d: M1DogfoodFillDayInput): M1DogfoodFillDayKind {
  if (d.isPasteAssist || d.boardKind === 'draft') return 'draft';
  if (d.kind === 'real' || d.boardKind === 'real') return 'real';
  return 'scaffold';
}

function fillHintFor(kind: M1DogfoodFillDayKind, pending: number, reasons: string[]): string {
  if (kind === 'real') {
    return pending > 0 ? '已计有效日 · 仍可补清剩余待确认' : '已计有效日 · 可打开回看';
  }
  if (kind === 'draft') {
    return '粘贴草稿不计有效日 · 改掉「待你确认」后保存再刷新';
  }
  if (pending >= 3) {
    return '脚手架待填 · 至少勾选实际做过的项并写结论';
  }
  if (reasons.some((r) => /填充不足|无实质/.test(r))) {
    return '填充不足 · 写 Provider/模型/重启恢复等真实结果';
  }
  return '未达有效日 · 请按模板补真实使用记录';
}

function ctaFor(
  kind: M1DogfoodFillDayKind,
  date: string,
  today: string,
): { ctaLabel: string; ctaAction: M1DogfoodFillDayRow['ctaAction'] } {
  if (kind === 'missing') {
    if (date === today) {
      return { ctaLabel: '打开今日 dogfood', ctaAction: 'open-today' };
    }
    return { ctaLabel: '打开该日日记', ctaAction: 'open-day' };
  }
  if (kind === 'draft') {
    return { ctaLabel: '打开草稿日', ctaAction: 'open-day' };
  }
  if (kind === 'scaffold') {
    return { ctaLabel: '打开补填', ctaAction: 'open-day' };
  }
  return { ctaLabel: '打开日记', ctaAction: 'open-day' };
}

/**
 * Pure: project multi-day dogfood fill board.
 * remainingDays = max(0, required - realDays).
 * Suggests missing calendar slots for the last `required` days ending today.
 */
export function projectM1DogfoodFillBoard(input: M1DogfoodFillBoardInput): M1DogfoodFillBoard {
  const required = resolveM1DogfoodRequiredDays(input.dogfoodRequired);
  const today = (
    input.today && /^\d{4}-\d{2}-\d{2}$/.test(input.today) ? input.today : localYmd()
  ).trim();

  const rawDays = Array.isArray(input.days) ? input.days : [];
  const byDate = new Map<string, M1DogfoodFillDayInput>();
  for (const d of rawDays) {
    const date = String(d.date || '').trim();
    if (!date) continue;
    byDate.set(date, d);
  }

  // Suggest last `required` calendar days ending today (inclusive).
  const windowDates: string[] = [];
  for (let i = 0; i < required; i++) {
    windowDates.push(shiftYmd(today, -i));
  }

  const rows: M1DogfoodFillDayRow[] = [];
  // Existing files first (sorted desc by date), then missing slots not present
  const existingDates = [...byDate.keys()].sort().reverse();
  const seen = new Set<string>();

  for (const date of existingDates) {
    const d = byDate.get(date)!;
    const kind = classifyKind(d);
    const pending = Math.max(0, (d.pendingCount as number) | 0);
    const checked = Math.max(0, (d.checkedCount as number) | 0);
    const filled = Math.max(0, (d.filledSignals as number) | 0);
    const reasons = Array.isArray(d.reasons) ? d.reasons.map(String).slice(0, 4) : [];
    const cta = ctaFor(kind, date, today);
    rows.push({
      date,
      kind,
      pendingCount: pending,
      checkedCount: checked,
      filledSignals: filled,
      statusLabel:
        String(d.statusLabel || '').trim() ||
        (kind === 'real' ? '有效' : kind === 'draft' ? '草稿' : '脚手架'),
      reasons,
      fillHint: fillHintFor(kind, pending, reasons),
      ctaLabel: cta.ctaLabel,
      ctaAction: cta.ctaAction,
      countsAsReal: kind === 'real',
    });
    seen.add(date);
  }

  const missingSlots: string[] = [];
  for (const date of windowDates) {
    if (seen.has(date)) continue;
    missingSlots.push(date);
    const cta = ctaFor('missing', date, today);
    rows.push({
      date,
      kind: 'missing',
      pendingCount: 0,
      checkedCount: 0,
      filledSignals: 0,
      statusLabel: '缺日记',
      reasons: ['窗口内无文件'],
      fillHint:
        date === today
          ? '今天还没有日记文件 · 打开今日或复制草稿后手写真实结果'
          : '该日无文件 · 真实使用后补写（勿用草稿顶有效日）',
      ctaLabel: cta.ctaLabel,
      ctaAction: cta.ctaAction,
      countsAsReal: false,
    });
  }

  // Sort: missing/today first priority, then by date desc
  rows.sort((a, b) => {
    const rank = (k: M1DogfoodFillDayKind) =>
      k === 'missing' ? 0 : k === 'draft' ? 1 : k === 'scaffold' ? 2 : 3;
    const rd = rank(a.kind) - rank(b.kind);
    if (rd !== 0) return rd;
    return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
  });

  const realFromRows = rows.filter((r) => r.countsAsReal).length;
  const realDays = Math.max(
    0,
    input.dogfoodRealDays != null ? input.dogfoodRealDays | 0 : realFromRows,
  );
  // Prefer loader count when provided (authoritative), but never invent real
  const draftDays = rows.filter((r) => r.kind === 'draft').length;
  const scaffoldDays = rows.filter((r) => r.kind === 'scaffold').length;
  const fileCount = Math.max(
    0,
    input.dogfoodFileCount != null ? input.dogfoodFileCount | 0 : existingDates.length,
  );
  const remainingDays = Math.max(0, required - realDays);

  let level: M1DogfoodFillBoard['level'];
  if (fileCount === 0 && realDays === 0) level = 'empty';
  else if (realDays >= required) level = 'ready-count';
  else if (draftDays > 0 && realDays === 0 && scaffoldDays === 0) level = 'blocked-fake';
  else if (realDays === 0) level = 'scaffold-only';
  else level = 'partial';

  const summary =
    'dogfood 有效 ' +
    realDays +
    '/' +
    required +
    ' · 文件 ' +
    fileCount +
    ' · 草稿 ' +
    draftDays +
    ' · 脚手架 ' +
    scaffoldDays +
    ' · 仍差 ' +
    remainingDays +
    ' 天';

  // Primary CTA
  let primaryCta: M1DogfoodFillBoard['primaryCta'] = {
    action: 'none',
    label: '',
    targetDate: null,
  };
  if (remainingDays > 0) {
    const todayRow = rows.find((r) => r.date === today);
    if (!todayRow || todayRow.kind === 'missing') {
      primaryCta = {
        action: 'open-today',
        label: '写今日 dogfood（打开/创建）',
        targetDate: today,
      };
    } else if (todayRow.kind === 'draft' || todayRow.kind === 'scaffold') {
      primaryCta = {
        action: 'open-oldest-scaffold',
        label: todayRow.kind === 'draft' ? '打开今日草稿并改真实结果' : '补填今日脚手架',
        targetDate: today,
      };
    } else {
      // today real but still remaining — open oldest scaffold/missing
      const need = rows.find(
        (r) => r.kind === 'scaffold' || r.kind === 'draft' || r.kind === 'missing',
      );
      if (need) {
        primaryCta = {
          action:
            need.kind === 'missing' && need.date === today
              ? 'open-today'
              : need.kind === 'missing'
                ? 'open-today'
                : 'open-oldest-scaffold',
          label: need.kind === 'missing' ? '补缺日记 · ' + need.date : '补填 ' + need.date,
          targetDate: need.date,
        };
      } else {
        primaryCta = {
          action: 'copy-draft',
          label: '复制 dogfood 草稿（须手改）',
          targetDate: today,
        };
      }
    }
  } else {
    primaryCta = {
      action: 'none',
      label: '有效日门槛已满 · M1 状态见验证区',
      targetDate: null,
    };
  }

  return {
    rows,
    required,
    realDays,
    fileCount,
    draftDays,
    scaffoldDays,
    remainingDays,
    missingSlots,
    level,
    summary,
    primaryCta,
    claimsM1Closed: false,
    claimsDogfoodReal: false,
  };
}

export function formatM1DogfoodFillBoardPaste(
  board: M1DogfoodFillBoard,
  opts?: { softCraftRound?: number | null; today?: string },
): string {
  const at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const lines = [
    '## dogfood 多日补填板（soft · 不关 M1 · 草稿不计有效日）',
    '',
    '- 生成时间：' + at,
    '- soft craft 轮次：' + (opts?.softCraftRound != null ? String(opts.softCraftRound) : '—'),
    '- ' + board.summary,
    '- level: ' + board.level,
    '- claimsM1Closed: false · claimsDogfoodReal: false',
    '',
  ];
  if (board.primaryCta.action !== 'none' && board.primaryCta.label) {
    lines.push('- 主行动：' + board.primaryCta.label);
    if (board.primaryCta.targetDate) {
      lines.push('- 目标日：' + board.primaryCta.targetDate);
    }
    lines.push('');
  }
  if (board.missingSlots.length > 0) {
    lines.push('### 窗口内缺文件');
    for (const d of board.missingSlots) {
      lines.push('- ' + d);
    }
    lines.push('');
  }
  lines.push('### 按日');
  for (const r of board.rows.slice(0, 12)) {
    lines.push(
      '- ' +
        r.date +
        ' · ' +
        r.kind +
        ' · ' +
        r.statusLabel +
        ' · ' +
        r.fillHint +
        (r.ctaLabel ? ' · CTA=' + r.ctaLabel : ''),
    );
  }
  lines.push('');
  lines.push('> 有效日只认真实填写；粘贴草稿 / 脚手架 **不计**。M1 状态见验证区。');
  return lines.join('\n');
}

export function dogfoodFillBoardLooksSecretFree(text: string): boolean {
  if (!text) return true;
  if (/\bsk-[A-Za-z0-9_\-]{16,}\b/.test(text)) return false;
  if (/\bBearer\s+[A-Za-z0-9_\-\.]{20,}/i.test(text)) return false;
  if (/api[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9_\-]{12,}/i.test(text)) return false;
  return true;
}
