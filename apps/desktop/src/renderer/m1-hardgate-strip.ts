/**
 * M1 hard-gate strip — primary-rail observability for the two exit hard gates.
 * Soft craft only: never auto-checks docs, never writes dogfood, never closes M1.
 */
import { resolveM1DogfoodRequiredDays } from './m1-dogfood-policy.js';

export type M1HardgateStripLevel = 'empty' | 'partial' | 'soft-only' | 'evidence-ready';

export type M1HardgateMeterId = 'handtest' | 'dogfood';

export type M1HardgateCtaAction =
  | 'open-handtest'
  | 'open-dogfood-today'
  | 'focus-external'
  | 'open-dogfood-fill'
  | 'expand-secondary'
  | 'refresh-evidence'
  | 'copy-exit-path';

export interface M1HardgateMeter {
  id: M1HardgateMeterId;
  label: string;
  /** 0..100 display; never claims complete exit by itself */
  percent: number;
  current: number;
  required: number;
  ok: boolean;
  partial: boolean;
  detail: string;
  /** short badge text */
  badge: string;
  /** suggested CTA for this meter */
  ctaAction: M1HardgateCtaAction;
  ctaLabel: string;
}

export interface M1HardgateStrip {
  level: M1HardgateStripLevel;
  summary: string;
  note: string;
  handtest: M1HardgateMeter;
  dogfood: M1HardgateMeter;
  meters: M1HardgateMeter[];
  /** both hard gates true — still only "可讨论关 M1", never auto-close */
  hardGatesMet: boolean;
  dualAutomatedOk: boolean;
  externalPending: number;
  softCraftRound: number;
  claimsM1Closed: false;
  primaryCta: { action: M1HardgateCtaAction; label: string };
  secondaryCtas: { action: M1HardgateCtaAction; label: string }[];
}

export const M1_HARDGATE_SOFT_CRAFT_ROUND = 61;

function clampPct(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n >= 100) return 100;
  return Math.round(n);
}

function handtestMeter(input: { checked: number; total: number }): M1HardgateMeter {
  const total = Math.max(0, input.total | 0);
  const checked = Math.max(0, Math.min(total || input.checked | 0, input.checked | 0));
  const ok = total > 0 && checked >= total;
  const partial = checked > 0 && !ok;
  const percent = total <= 0 ? 0 : clampPct((checked / total) * 100);
  return {
    id: 'handtest',
    label: '外网手测',
    percent,
    current: checked,
    required: total || 18,
    ok,
    partial,
    detail:
      total <= 0
        ? '手测清单未加载'
        : ok
          ? `${checked}/${total} 文档已勾 · M1 状态见验证区`
          : `${checked}/${total} 已勾 · 差 ${Math.max(0, total - checked)} 项（含真实网关 UI）`,
    badge: ok ? '完成' : partial ? '进行中' : '未开始',
    ctaAction: ok ? 'expand-secondary' : 'open-handtest',
    ctaLabel: ok ? '看退出证据' : '打开手测文档',
  };
}

function dogfoodMeter(input: {
  realDays: number;
  required: number;
  fileCount: number;
}): M1HardgateMeter {
  const required = resolveM1DogfoodRequiredDays(input.required);
  const real = Math.max(0, input.realDays | 0);
  const files = Math.max(0, input.fileCount | 0);
  const ok = real >= required;
  const partial = !ok && (real > 0 || files > 0);
  const percent = clampPct((real / required) * 100);
  return {
    id: 'dogfood',
    label: 'dogfood 日记',
    percent: ok ? 100 : percent,
    current: real,
    required,
    ok,
    partial,
    detail: ok
      ? `真实有效日 ${real}/${required} · 脚手架/草稿不计`
      : real > 0
        ? `真实 ${real}/${required} 天 · 文件 ${files} · 差 ${required - real} 天`
        : files > 0
          ? `仅有脚手架/草稿 ${files} 个 · 真实有效日 0/${required}`
          : `尚无有效日记 · 需要 ≥${required} 真实天`,
    badge: ok ? '完成' : real > 0 ? '进行中' : files > 0 ? '仅草稿' : '未开始',
    ctaAction: ok
      ? 'open-dogfood-today'
      : real > 0 || files > 0
        ? 'open-dogfood-fill'
        : 'open-dogfood-today',
    ctaLabel: ok ? '打开今日日记' : real > 0 || files > 0 ? '打开补填板' : '写今日 dogfood',
  };
}

export interface M1HardgateStripInput {
  handtestChecked: number;
  handtestTotal: number;
  dogfoodRealDays: number;
  dogfoodRequired?: number;
  dogfoodFileCount?: number;
  dualAutomatedOk?: boolean;
  hardGatesMet?: boolean;
  exitLevel?: string;
  externalPending?: number;
  softCraftRound?: number;
}

/**
 * Pure: project hard-gate strip for primary rail.
 * Never sets claimsM1Closed true.
 */
export function projectM1HardgateStrip(input: M1HardgateStripInput): M1HardgateStrip {
  const handtest = handtestMeter({
    checked: input.handtestChecked,
    total: input.handtestTotal,
  });
  const dogfood = dogfoodMeter({
    realDays: input.dogfoodRealDays,
    required: resolveM1DogfoodRequiredDays(input.dogfoodRequired),
    fileCount: input.dogfoodFileCount ?? 0,
  });
  const dualAutomatedOk = Boolean(input.dualAutomatedOk);
  const hardGatesMet = Boolean(input.hardGatesMet) || (handtest.ok && dogfood.ok);
  const externalPending = Math.max(0, Number(input.externalPending ?? 0) || 0);

  let level: M1HardgateStripLevel;
  if (hardGatesMet) level = 'evidence-ready';
  else if (handtest.ok || dogfood.ok || handtest.partial || dogfood.partial) {
    level = dualAutomatedOk && !handtest.ok ? 'soft-only' : 'partial';
  } else if (dualAutomatedOk) level = 'soft-only';
  else level = 'empty';

  // Prefer most urgent hard gate CTA
  let primaryCta: M1HardgateStrip['primaryCta'];
  if (!handtest.ok) {
    primaryCta = {
      action: externalPending > 0 ? 'focus-external' : 'open-handtest',
      label: externalPending > 0 ? '聚焦下一外网项' : handtest.ctaLabel,
    };
  } else if (!dogfood.ok) {
    primaryCta = { action: dogfood.ctaAction, label: dogfood.ctaLabel };
  } else {
    primaryCta = { action: 'copy-exit-path', label: '复制退出路径' };
  }

  const secondaryCtas: M1HardgateStrip['secondaryCtas'] = [
    { action: 'open-handtest', label: '手测文档' },
    { action: 'open-dogfood-today', label: '今日 dogfood' },
    { action: 'refresh-evidence', label: '刷新证据' },
    { action: 'expand-secondary', label: '更多观测' },
  ];

  const summary = hardGatesMet
    ? `外网 ${handtest.current}/${handtest.required} · dogfood ${dogfood.current}/${dogfood.required} · M1 已完成`
    : `硬门槛 · 手测 ${handtest.current}/${handtest.required} · dogfood ${dogfood.current}/${dogfood.required}`;

  const noteParts = [
    dualAutomatedOk ? '本机 dual 已绿（≠外网）' : '本机 dual 未确认',
    externalPending > 0 ? `外网待证 ${externalPending}` : '外网待证 0',
    '不自动勾手测 · 不写 dogfood · 本条不改变 M1 状态',
  ];

  return {
    level,
    summary,
    note: noteParts.join(' · '),
    handtest,
    dogfood,
    meters: [handtest, dogfood],
    hardGatesMet,
    dualAutomatedOk,
    externalPending,
    softCraftRound:
      typeof input.softCraftRound === 'number' && input.softCraftRound > 0
        ? input.softCraftRound
        : M1_HARDGATE_SOFT_CRAFT_ROUND,
    claimsM1Closed: false,
    primaryCta,
    secondaryCtas,
  };
}

export function isM1HardgateCtaActionable(action: M1HardgateCtaAction): boolean {
  return (
    action === 'open-handtest' ||
    action === 'open-dogfood-today' ||
    action === 'focus-external' ||
    action === 'open-dogfood-fill' ||
    action === 'expand-secondary' ||
    action === 'refresh-evidence' ||
    action === 'copy-exit-path'
  );
}

/** Short paste for clipboard / evidence assist (no secrets). */
export function formatM1HardgateStripPaste(strip: M1HardgateStrip): string {
  const lines = [
    '# M1 硬门槛进度（soft · 不关 M1）',
    '',
    `- softCraftRound: ${strip.softCraftRound}`,
    `- level: ${strip.level}`,
    `- hardGatesMet: ${strip.hardGatesMet}`,
    `- claimsM1Closed: false`,
    `- dualAutomatedOk: ${strip.dualAutomatedOk}`,
    `- externalPending: ${strip.externalPending}`,
    '',
    '## 外网手测',
    `- ${strip.handtest.current}/${strip.handtest.required} · ${strip.handtest.badge}`,
    `- ${strip.handtest.detail}`,
    '',
    '## dogfood',
    `- 真实日 ${strip.dogfood.current}/${strip.dogfood.required} · ${strip.dogfood.badge}`,
    `- ${strip.dogfood.detail}`,
    '',
    `> ${strip.note}`,
    '',
  ];
  return lines.join('\n');
}
