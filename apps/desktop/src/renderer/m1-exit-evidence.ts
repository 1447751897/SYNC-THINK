/**
 * M1 exit-evidence progress — soft observability for the two hard gates.
 * Never closes M1 by itself. External hand-test + dogfood still required.
 */
import { resolveM1DogfoodRequiredDays } from './m1-dogfood-policy.js';

export type M1ExitChipOk = '1' | '0' | 'partial';

export interface M1ExitEvidenceChip {
  id: string;
  label: string;
  detail: string;
  ok: M1ExitChipOk;
}

export type M1DogfoodDayKind = 'real' | 'scaffold';

export interface M1DogfoodDayBoardItem {
  date: string;
  kind: M1DogfoodDayKind;
  pendingCount: number;
  checkedCount: number;
  filledSignals: number;
  fileName: string;
  /** Short Chinese status for chip strip. */
  statusLabel: string;
  /** Paste-assist draft detected. */
  isPasteAssist: boolean;
  /** Scorer reasons for observability. */
  reasons: string[];
  /** data-kind refinement: real | scaffold | draft */
  boardKind: 'real' | 'scaffold' | 'draft';
}

export interface M1ExitEvidenceInput {
  /** Checked boxes in 14-external-gateway-handtest.md (UI path items). */
  handtestChecked: number;
  handtestTotal: number;
  /** Count of dogfood diary files under docs/development/dogfood/ */
  dogfoodFileCount: number;
  /** Diaries that look filled (not scaffold-only). */
  dogfoodRealDays: number;
  /** Required dogfood days for M1 exit discussion. */
  dogfoodRequired?: number;
  /** Soft session strip level from projectM1SessionReadiness. */
  sessionLevel: 'empty' | 'partial' | 'ready' | string;
  /** Last automated dual-gateway pack known green (local fake gateways). */
  dualAutomatedOk?: boolean;
  /** Optional short status line from loader. */
  loadNote?: string | null;
  /** Per-day dogfood reports from main IPC (optional). */
  dogfoodDays?:
    | readonly M1DogfoodDayBoardItem[]
    | readonly {
        date: string;
        kind: M1DogfoodDayKind | string;
        pendingCount?: number;
        checkedCount?: number;
        filledSignals?: number;
        fileName?: string;
        isPasteAssist?: boolean;
        reasons?: readonly string[];
        statusHint?: string;
        statusLabel?: string;
      }[];
}

export interface M1ExitEvidenceProgress {
  handtestChecked: number;
  handtestTotal: number;
  handtestOk: boolean;
  handtestPartial: boolean;
  dogfoodFileCount: number;
  dogfoodRealDays: number;
  dogfoodRequired: number;
  dogfoodOk: boolean;
  dogfoodPartial: boolean;
  sessionSoftOk: boolean;
  dualAutomatedOk: boolean;
  /** Aggregate: empty / partial / soft-only / evidence-ready (still not auto-close). */
  level: 'empty' | 'partial' | 'soft-only' | 'evidence-ready';
  /** Always false unless both hard gates true — still only "可讨论关 M1", not auto-close. */
  hardGatesMet: boolean;
  chips: M1ExitEvidenceChip[];
  /** Day board for dogfood (scaffold vs real). */
  dogfoodDays: M1DogfoodDayBoardItem[];
  /** Count of paste-assist scaffold days (for note). */
  dogfoodDraftDays: number;
  summary: string;
  note: string;
  loadNote: string | null;
}

export {
  countMarkdownTaskBoxes,
  scoreDogfoodDiary,
  countDogfoodPendingMarkers,
  looksLikeDogfoodPasteAssist,
} from '../m1-dogfood-score.js';

/** Normalize IPC day rows into board items (UI-safe). */
export function projectDogfoodDayBoard(
  days: M1ExitEvidenceInput['dogfoodDays'] | undefined | null,
): M1DogfoodDayBoardItem[] {
  if (!days || days.length === 0) return [];
  return days.map((d) => {
    const kind: M1DogfoodDayKind = d.kind === 'real' ? 'real' : 'scaffold';
    const pendingCount = Math.max(0, (d.pendingCount as number) | 0);
    const checkedCount = Math.max(0, (d.checkedCount as number) | 0);
    const filledSignals = Math.max(0, (d.filledSignals as number) | 0);
    const date = String(d.date || '').trim() || '—';
    const fileName = (d.fileName && String(d.fileName)) || (date !== '—' ? date + '.md' : '—');
    const isPasteAssist = Boolean(
      (d as { isPasteAssist?: boolean }).isPasteAssist ||
      (Array.isArray((d as { reasons?: string[] }).reasons) &&
        (d as { reasons?: string[] }).reasons!.some((r) => /粘贴|草稿/.test(String(r)))),
    );
    const reasons = Array.isArray((d as { reasons?: string[] }).reasons)
      ? ([...(d as { reasons: string[] }).reasons] as string[]).slice(0, 4)
      : isPasteAssist
        ? ['粘贴草稿特征']
        : kind === 'real'
          ? ['有效日记信号']
          : pendingCount > 0
            ? [`待确认 ${pendingCount}`]
            : ['脚手架'];
    const statusHint =
      (d as { statusHint?: string }).statusHint ||
      (d as { statusLabel?: string }).statusLabel ||
      '';
    const statusLabel =
      statusHint ||
      (kind === 'real'
        ? '有效 · 勾 ' + checkedCount + (pendingCount ? ' · 待 ' + pendingCount : '')
        : isPasteAssist
          ? '草稿 · 待改 ' + pendingCount
          : '脚手架 · 待 ' + pendingCount);
    const boardKind: M1DogfoodDayBoardItem['boardKind'] = isPasteAssist
      ? 'draft'
      : kind === 'real'
        ? 'real'
        : 'scaffold';
    return {
      date,
      kind,
      pendingCount,
      checkedCount,
      filledSignals,
      fileName,
      statusLabel,
      isPasteAssist,
      reasons,
      boardKind,
    };
  });
}

export function projectM1ExitEvidenceProgress(input: M1ExitEvidenceInput): M1ExitEvidenceProgress {
  const handtestChecked = Math.max(0, input.handtestChecked | 0);
  const handtestTotal = Math.max(0, input.handtestTotal | 0);
  const dogfoodFileCount = Math.max(0, input.dogfoodFileCount | 0);
  const dogfoodRealDays = Math.max(0, input.dogfoodRealDays | 0);
  const dogfoodRequired = resolveM1DogfoodRequiredDays(input.dogfoodRequired);
  const dualAutomatedOk = Boolean(input.dualAutomatedOk);
  const sessionSoftOk = input.sessionLevel === 'ready';
  const loadNote = input.loadNote?.trim() ? input.loadNote.trim() : null;
  const dogfoodDays = projectDogfoodDayBoard(input.dogfoodDays);
  const dogfoodDraftDays = dogfoodDays.filter((d) => d.isPasteAssist).length;

  const handtestOk = handtestTotal > 0 && handtestChecked >= handtestTotal;
  const handtestPartial = handtestChecked > 0 && !handtestOk;
  const dogfoodOk = dogfoodRealDays >= dogfoodRequired;
  const dogfoodPartial = dogfoodRealDays > 0 && !dogfoodOk;

  const hardGatesMet = handtestOk && dogfoodOk;

  let level: M1ExitEvidenceProgress['level'];
  if (hardGatesMet && sessionSoftOk) {
    level = 'evidence-ready';
  } else if (sessionSoftOk && dualAutomatedOk && !handtestOk && !dogfoodOk) {
    level = 'soft-only';
  } else if (
    handtestChecked === 0 &&
    dogfoodRealDays === 0 &&
    !sessionSoftOk &&
    dogfoodFileCount <= 1
  ) {
    level = 'empty';
  } else {
    level = 'partial';
  }

  const chips: M1ExitEvidenceChip[] = [
    {
      id: 'soft-session',
      label: '本机 soft',
      detail: sessionSoftOk
        ? '会话 soft 就绪'
        : input.sessionLevel === 'empty'
          ? '尚未起步'
          : '会话准备中',
      ok: sessionSoftOk ? '1' : input.sessionLevel === 'empty' ? '0' : 'partial',
    },
    {
      id: 'dual-auto',
      label: '本地 dual',
      detail: dualAutomatedOk ? '自动化 4/4 绿' : '未确认',
      ok: dualAutomatedOk ? '1' : '0',
    },
    {
      id: 'handtest',
      label: '外网手测',
      detail: handtestTotal === 0 ? '清单未读到' : `${handtestChecked}/${handtestTotal}`,
      ok: handtestOk ? '1' : handtestPartial ? 'partial' : '0',
    },
    {
      id: 'dogfood',
      label: 'dogfood',
      detail: `${dogfoodRealDays}/${dogfoodRequired} 天有效${
        dogfoodFileCount > 0 ? ` · 文件${dogfoodFileCount}` : ''
      }${dogfoodDraftDays > 0 ? ` · 草稿${dogfoodDraftDays}` : ''}`,
      ok: dogfoodOk ? '1' : dogfoodPartial ? 'partial' : '0',
    },
  ];

  const summary =
    level === 'evidence-ready'
      ? '退出证据齐全 · M1 已完成'
      : level === 'soft-only'
        ? 'soft 已满 · 硬门槛仍缺'
        : level === 'empty'
          ? '退出证据未开始'
          : hardGatesMet
            ? '硬门槛已满 · soft 未齐'
            : handtestPartial || dogfoodPartial
              ? '退出证据推进中'
              : '退出证据仍缺';

  const draftNote =
    dogfoodDraftDays > 0
      ? ` 粘贴草稿 ${dogfoodDraftDays} 份不计有效日（请改「待你确认」后保存）。`
      : '';

  const note =
    level === 'evidence-ready'
      ? `外网手测清单已全勾 + dogfood ≥${dogfoodRequired} 天有效日记 + 本机 soft 就绪。M1 退出证据已齐；本条不会自动关闭里程碑。`
      : !handtestOk && !dogfoodOk
        ? `关 M1 需要两件硬证据：① 外网真实网关 UI 手测（现 ${handtestChecked}/${handtestTotal || '—'}）② dogfood ≥${dogfoodRequired} 天（现有效 ${dogfoodRealDays}）。本地 dual 自动化不能替代。${draftNote}`
        : !handtestOk
          ? `dogfood 侧已有进展，但仍缺外网手测勾选（${handtestChecked}/${handtestTotal || '—'}）。打开 docs/development/14-external-gateway-handtest.md 实填。${draftNote}`
          : !dogfoodOk
            ? `外网手测已齐，仍缺 dogfood 有效日记（${dogfoodRealDays}/${dogfoodRequired}）。复制模板到 dogfood/YYYY-MM-DD.md 真实使用后填写。${draftNote}`
            : '硬门槛已满，请把本机会话 soft 补齐后再讨论关 M1。';

  return {
    handtestChecked,
    handtestTotal,
    handtestOk,
    handtestPartial,
    dogfoodFileCount,
    dogfoodRealDays,
    dogfoodRequired,
    dogfoodOk,
    dogfoodPartial,
    sessionSoftOk,
    dualAutomatedOk,
    level,
    hardGatesMet,
    chips,
    dogfoodDays,
    dogfoodDraftDays,
    summary,
    note,
    loadNote,
  };
}
