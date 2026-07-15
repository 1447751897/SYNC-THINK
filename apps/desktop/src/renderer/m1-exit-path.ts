/**
 * M1 hard-gate exit path board — ordered remaining steps for external handtest + dogfood.
 * Soft assist only: never auto-checks docs, never writes dogfood, never closes M1,
 * never includes secrets.
 */
import { resolveM1DogfoodRequiredDays } from './m1-dogfood-policy.js';

export type M1ExitPathStepKind =
  | 'handtest-external'
  | 'handtest-doc'
  | 'dogfood-day'
  | 'dogfood-fill'
  | 'external-focus'
  | 'soft-setup'
  | 'discuss-exit';

export type M1ExitPathStepStatus = 'todo' | 'doing' | 'done' | 'blocked';

export type M1ExitPathCtaAction =
  | 'open-handtest'
  | 'open-dogfood'
  | 'copy-dogfood-draft'
  | 'copy-dogfood-fill'
  | 'open-dogfood-fill'
  | 'focus-external'
  | 'jump-external-item'
  | 'copy-external-runsheet'
  | 'copy-evidence-bundle'
  | 'copy-handtest-paste'
  | 'jump-providers'
  | 'jump-agent'
  | 'jump-compose'
  | 'none';

export interface M1ExitPathStep {
  id: string;
  kind: M1ExitPathStepKind;
  /** 1-based order among remaining-first path. */
  order: number;
  title: string;
  detail: string;
  status: M1ExitPathStepStatus;
  gate: 'soft' | 'hard';
  ctaLabel: string;
  ctaAction: M1ExitPathCtaAction;
  /** Optional handtest item id for observability. */
  handtestItemId?: string | null;
  /** Percent contribution hint (display only). */
  weight: number;
}

export interface M1ExitPathHandtestItem {
  id: string;
  label: string;
  section?: string;
  gate: 'live' | 'external' | string;
  status: 'pass' | 'fail' | 'pending' | 'na' | string;
}

export interface M1ExitPathInput {
  connectionOnline: boolean;
  hasActiveTask: boolean;
  providersReadySoft: boolean;
  providerCount: number;
  modelCount: number;
  secretCount: number;
  agentDefaultSet: boolean;
  handtestDocChecked: number;
  handtestDocTotal: number;
  handtestLivePass: number;
  handtestLiveTotal: number;
  handtestExternalPending: number;
  dogfoodRealDays: number;
  dogfoodRequired?: number;
  dogfoodFileCount: number;
  dualAutomatedOk: boolean;
  hardGatesMet: boolean;
  exitLevel: string;
  /** Full checklist items (preferred for external step list). */
  handtestItems?: readonly M1ExitPathHandtestItem[];
  /** Soft craft round for paste notes (optional). */
  softCraftRound?: number | null;
  /** #53: doc-diff live-ahead count. */
  liveAheadCount?: number;
  /** #53: doc-diff doc-ahead count. */
  docAheadCount?: number;
  /** #56: dogfood fill board level (empty|scaffold-only|partial|ready-count|blocked-fake). */
  dogfoodFillLevel?: string | null;
  /** #56: draft / scaffold / missing counts from fill board. */
  dogfoodDraftDays?: number;
  dogfoodScaffoldDays?: number;
  dogfoodMissingCount?: number;
  /** #56: primary fill CTA action string (open-today|copy-draft|open-oldest-scaffold|none). */
  dogfoodFillPrimaryAction?: string | null;
  /** #59: next external handtest focus (optional). */
  externalFocusId?: string | null;
  externalFocusLabel?: string | null;
  externalFocusSection?: string | null;
  externalFocusJumpTarget?: string | null;
  externalFocusJumpable?: boolean;
  externalFocusPending?: number;
}

export interface M1ExitPathBoard {
  steps: M1ExitPathStep[];
  /** First non-done hard/soft actionable step. */
  focusStepId: string | null;
  remainingHardSteps: number;
  remainingSoftSteps: number;
  doneSteps: number;
  totalSteps: number;
  /** 0-100 display progress (hard gates weighted heavier). */
  progressPercent: number;
  summary: string;
  level: 'blocked' | 'setup' | 'hard-gap' | 'ready-discuss';
  /** Always false. */
  claimsM1Closed: false;
}

export interface M1ExitPathPaste {
  markdown: string;
  summary: string;
  charCount: number;
  claimsM1Closed: false;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Pure: project ordered exit path for hard-gate observability.
 * Priority: soft setup blockers first, then external handtest items,
 * then dogfood remaining days, then discuss-exit (never auto).
 */
export function projectM1ExitPath(input: M1ExitPathInput): M1ExitPathBoard {
  const dogfoodRequired = resolveM1DogfoodRequiredDays(input.dogfoodRequired);
  const docTotal = Math.max(0, input.handtestDocTotal | 0 || 18);
  const docChecked = clamp(input.handtestDocChecked | 0, 0, docTotal || 999);
  const dogfoodReal = Math.max(0, input.dogfoodRealDays | 0);
  const dogfoodLeft = Math.max(0, dogfoodRequired - dogfoodReal);
  const items = Array.isArray(input.handtestItems) ? input.handtestItems : [];

  const steps: M1ExitPathStep[] = [];

  // Soft setup (only if blocking)
  if (!input.connectionOnline) {
    steps.push({
      id: 'soft-runtime',
      kind: 'soft-setup',
      order: 0,
      title: '连接 Runtime',
      detail: '桌面端离线时无法推进会话与外网手测',
      status: 'blocked',
      gate: 'soft',
      ctaLabel: '',
      ctaAction: 'none',
      weight: 5,
    });
  }
  if (!input.hasActiveTask) {
    steps.push({
      id: 'soft-task',
      kind: 'soft-setup',
      order: 0,
      title: '打开一个任务',
      detail: '手测与多模型对话需要当前任务上下文',
      status: 'todo',
      gate: 'soft',
      ctaLabel: '',
      ctaAction: 'none',
      weight: 5,
    });
  }
  if (
    input.providerCount < 2 ||
    input.modelCount < 3 ||
    input.secretCount < 1 ||
    !input.providersReadySoft
  ) {
    steps.push({
      id: 'soft-providers',
      kind: 'soft-setup',
      order: 0,
      title: '配齐 Providers / 模型 / 密钥',
      detail:
        '当前 P' +
        (input.providerCount | 0) +
        ' · M' +
        (input.modelCount | 0) +
        ' · 密钥计数 ' +
        (input.secretCount | 0) +
        '（门槛 ≥2 / ≥3 / ≥1）',
      status: 'todo',
      gate: 'soft',
      ctaLabel: '打开 Providers',
      ctaAction: 'jump-providers',
      weight: 8,
    });
  }
  if (!input.agentDefaultSet) {
    steps.push({
      id: 'soft-agent',
      kind: 'soft-setup',
      order: 0,
      title: '设定 Agent 默认模型',
      detail: '建议同时配置 Fallback，外网失败路径才可手测',
      status: 'todo',
      gate: 'soft',
      ctaLabel: '打开 Agent',
      ctaAction: 'jump-agent',
      weight: 5,
    });
  }

  // External handtest pending items (hard)
  const externalPending = items.filter((it) => it.gate === 'external' && it.status !== 'pass');

  // #59 External focus assist (before per-item external steps)
  const focusId = String(input.externalFocusId || '').trim();
  const focusLabel = String(input.externalFocusLabel || '').trim();
  const focusSec = String(input.externalFocusSection || '').trim();
  const focusPending = Math.max(
    0,
    (input.externalFocusPending ?? input.handtestExternalPending ?? 0) | 0,
  );
  const focusJumpable = Boolean(input.externalFocusJumpable);
  if (
    focusId &&
    (externalPending.length > 0 || (input.handtestExternalPending | 0) > 0 || focusPending > 0)
  ) {
    const title = '下一外网项 · ' + (focusSec ? focusSec + ' · ' : '') + (focusLabel || focusId);
    const detail =
      '焦点 `' +
      focusId +
      '` · 外网待证 ' +
      focusPending +
      ' · 主按钮走聚焦条 · 密钥勿入库 · 不自动勾';
    let ctaLabel = '打开外网聚焦';
    let ctaAction: M1ExitPathCtaAction = 'focus-external';
    if (focusJumpable) {
      ctaLabel = '跳到相关面板';
      ctaAction = 'jump-external-item';
    }
    steps.push({
      id: 'external-focus-assist',
      kind: 'external-focus',
      order: 0,
      title,
      detail,
      status: 'todo',
      gate: 'hard',
      ctaLabel,
      ctaAction,
      handtestItemId: focusId,
      weight: 11,
    });
  }

  if (externalPending.length > 0) {
    for (const it of externalPending) {
      steps.push({
        id: 'ext-' + it.id,
        kind: 'handtest-external',
        order: 0,
        title: it.label,
        detail: '外网手测项 · 在 14-…handtest.md 勾选真源',
        status: 'todo',
        gate: 'hard',
        ctaLabel: '打开手测文档',
        ctaAction: 'open-handtest',
        handtestItemId: it.id,
        weight: 10,
      });
    }
  } else if ((input.handtestExternalPending | 0) > 0) {
    steps.push({
      id: 'ext-pending-count',
      kind: 'handtest-external',
      order: 0,
      title: '完成外网待证项（' + (input.handtestExternalPending | 0) + '）',
      detail: '本机 checklist 仍有外网 pending · 打开手测文档逐项勾',
      status: 'todo',
      gate: 'hard',
      ctaLabel: '打开手测文档',
      ctaAction: 'open-handtest',
      weight: 12,
    });
  }

  // Handtest doc checkbox gap (hard)
  if (docTotal === 0 || docChecked < docTotal) {
    steps.push({
      id: 'doc-handtest',
      kind: 'handtest-doc',
      order: 0,
      title: '勾选手测文档 ' + docChecked + '/' + (docTotal || 18),
      detail: '真源是 docs/development/14-external-gateway-handtest.md · UI 不自动勾',
      status: docChecked > 0 ? 'doing' : 'todo',
      gate: 'hard',
      ctaLabel: '打开手测文档',
      ctaAction: 'open-handtest',
      weight: 20,
    });
  } else {
    steps.push({
      id: 'doc-handtest',
      kind: 'handtest-doc',
      order: 0,
      title: '手测文档已勾满 ' + docChecked + '/' + docTotal,
      detail: '文档勾选已满 · dogfood 状态见验证区',
      status: 'done',
      gate: 'hard',
      ctaLabel: '打开手测文档',
      ctaAction: 'open-handtest',
      weight: 20,
    });
  }

  // Dogfood remaining days (hard)
  if (dogfoodLeft > 0) {
    for (let i = 0; i < dogfoodLeft; i++) {
      const dayNo = dogfoodReal + i + 1;
      steps.push({
        id: 'dogfood-day-' + dayNo,
        kind: 'dogfood-day',
        order: 0,
        title: '写有效 dogfood 第 ' + dayNo + '/' + dogfoodRequired + ' 天',
        detail:
          i === 0
            ? '可复制草稿后改「待你确认」再保存 · 粘贴草稿不计有效日'
            : '真实使用后写日记 · 勿把脚手架/草稿当有效日',
        status: i === 0 && dogfoodReal === 0 ? 'todo' : i === 0 ? 'doing' : 'todo',
        gate: 'hard',
        ctaLabel: i === 0 ? '打开今日 dogfood' : '复制 dogfood 草稿',
        ctaAction: i === 0 ? 'open-dogfood' : 'copy-dogfood-draft',
        weight: 12,
      });
    }
  } else {
    steps.push({
      id: 'dogfood-complete',
      kind: 'dogfood-day',
      order: 0,
      title: 'dogfood 有效日已满 ' + dogfoodReal + '/' + dogfoodRequired,
      detail: '日记硬门槛数字齐 · M1 状态见验证区',
      status: 'done',
      gate: 'hard',
      ctaLabel: '打开今日 dogfood',
      ctaAction: 'open-dogfood',
      weight: 12,
    });
  }

  // #56 Dogfood multi-day fill board assist (when still short)
  if (dogfoodLeft > 0) {
    const fillLevel = String(input.dogfoodFillLevel || '').trim() || 'empty';
    const draftN = Math.max(0, (input.dogfoodDraftDays ?? 0) | 0);
    const scafN = Math.max(0, (input.dogfoodScaffoldDays ?? 0) | 0);
    const missN = Math.max(0, (input.dogfoodMissingCount ?? 0) | 0);
    const primary = String(input.dogfoodFillPrimaryAction || '').trim();
    let fillDetail =
      '有效 ' +
      dogfoodReal +
      '/' +
      dogfoodRequired +
      ' · 仍差 ' +
      dogfoodLeft +
      ' · 草稿 ' +
      draftN +
      ' · 脚手架 ' +
      scafN +
      ' · 缺文件 ' +
      missN +
      ' · 草稿/脚手架不计有效日';
    if (fillLevel === 'blocked-fake') {
      fillDetail = '仅有粘贴草稿 · 改掉「待你确认」并写真实结果后才计日 · ' + fillDetail;
    } else if (fillLevel === 'scaffold-only') {
      fillDetail = '仅有脚手架 · 按模板补真实使用记录 · ' + fillDetail;
    } else if (fillLevel === 'empty') {
      fillDetail = '窗口内尚无日记 · 先写今日或复制草稿后手改 · ' + fillDetail;
    } else if (fillLevel === 'partial') {
      fillDetail = '部分有效 · 打开补填板继续差天 · ' + fillDetail;
    }
    let fillCtaLabel = '打开补填板';
    let fillCtaAction: M1ExitPathCtaAction = 'open-dogfood-fill';
    if (primary === 'copy-draft') {
      fillCtaLabel = '复制多日补填';
      fillCtaAction = 'copy-dogfood-fill';
    } else if (primary === 'open-today' || primary === 'open-oldest-scaffold') {
      fillCtaLabel = primary === 'open-today' ? '写今日 dogfood' : '打开补填板';
      fillCtaAction = 'open-dogfood-fill';
    }
    steps.push({
      id: 'dogfood-fill-assist',
      kind: 'dogfood-fill',
      order: 0,
      title: '补填 dogfood 仍差 ' + dogfoodLeft + ' 天',
      detail: fillDetail,
      status: 'todo',
      gate: 'hard',
      ctaLabel: fillCtaLabel,
      ctaAction: fillCtaAction,
      weight: 10,
    });
  }

  // #53 Doc-diff live-ahead hard assist
  const liveAhead = Math.max(0, (input.liveAheadCount ?? 0) | 0);
  const docAhead = Math.max(0, (input.docAheadCount ?? 0) | 0);
  if (liveAhead > 0) {
    steps.push({
      id: 'doc-live-ahead',
      kind: 'handtest-doc',
      order: 0,
      title: '勾本机领先 ' + liveAhead + ' 项',
      detail:
        '本机已绿但 14-…handtest 未勾 · 打开文档逐项补勾' +
        (docAhead > 0 ? ' · 另有文档领先 ' + docAhead : ''),
      status: 'todo',
      gate: 'hard',
      ctaLabel: '打开手测文档',
      ctaAction: 'open-handtest',
      weight: 8,
    });
  }

  // Discuss exit (never auto)
  const hardMet =
    Boolean(input.hardGatesMet) ||
    (docChecked >= docTotal && docTotal > 0 && dogfoodReal >= dogfoodRequired);
  steps.push({
    id: 'discuss-exit',
    kind: 'discuss-exit',
    order: 0,
    title: hardMet ? '硬门槛数字齐 · M1 状态见验证区' : '硬门槛齐后讨论关 M1（勿自动）',
    detail: hardMet
      ? '导出证据包作对照 · 用户已确认一天即可 · M2 已完成'
      : `在手测 18/18 + dogfood ≥${dogfoodRequired} 之前不要关 M1`,
    status: hardMet ? 'doing' : 'todo',
    gate: 'hard',
    ctaLabel: '导出证据包',
    ctaAction: 'copy-evidence-bundle',
    weight: 5,
  });

  // Order + focus
  steps.forEach((s, i) => {
    s.order = i + 1;
  });

  const doneSteps = steps.filter((s) => s.status === 'done').length;
  const remainingHardSteps = steps.filter((s) => s.gate === 'hard' && s.status !== 'done').length;
  const remainingSoftSteps = steps.filter((s) => s.gate === 'soft' && s.status !== 'done').length;

  // Weighted progress: done weight / total weight
  const totalW = steps.reduce((a, s) => a + s.weight, 0) || 1;
  const doneW = steps.filter((s) => s.status === 'done').reduce((a, s) => a + s.weight, 0);
  // Partial credit for doing
  const doingW = steps.filter((s) => s.status === 'doing').reduce((a, s) => a + s.weight * 0.35, 0);
  const progressPercent = clamp(Math.round(((doneW + doingW) / totalW) * 100), 0, 99);
  // Cap at 99 until human closes M1 — never show 100 as closed
  const progress = hardMet ? Math.min(99, Math.max(progressPercent, 90)) : progressPercent;

  let focus: M1ExitPathStep | null = null;
  for (const s of steps) {
    if (s.status === 'blocked') {
      focus = s;
      break;
    }
  }
  if (!focus) {
    for (const s of steps) {
      if (s.status === 'doing' || s.status === 'todo') {
        focus = s;
        break;
      }
    }
  }

  let level: M1ExitPathBoard['level'];
  if (!input.connectionOnline) level = 'blocked';
  else if (remainingSoftSteps > 0) level = 'setup';
  else if (hardMet) level = 'ready-discuss';
  else level = 'hard-gap';

  const summary = hardMet
    ? '硬门槛数字齐 · M1 已完成 · M2 已完成'
    : remainingSoftSteps > 0
      ? '先完成本机 soft 前置 · 再做外网手测 / dogfood'
      : '硬门槛剩余 ' +
        remainingHardSteps +
        ' 步 · 手测文档 ' +
        docChecked +
        '/' +
        (docTotal || 18) +
        ' · dogfood ' +
        dogfoodReal +
        '/' +
        dogfoodRequired;

  return {
    steps,
    focusStepId: focus?.id ?? null,
    remainingHardSteps,
    remainingSoftSteps,
    doneSteps,
    totalSteps: steps.length,
    progressPercent: progress,
    summary,
    level,
    claimsM1Closed: false,
  };
}

export function isM1ExitPathStepActionable(action: M1ExitPathCtaAction): boolean {
  return (
    action === 'open-handtest' ||
    action === 'open-dogfood' ||
    action === 'copy-dogfood-draft' ||
    action === 'copy-dogfood-fill' ||
    action === 'open-dogfood-fill' ||
    action === 'focus-external' ||
    action === 'jump-external-item' ||
    action === 'copy-external-runsheet' ||
    action === 'copy-evidence-bundle' ||
    action === 'copy-handtest-paste' ||
    action === 'jump-providers' ||
    action === 'jump-agent' ||
    action === 'jump-compose'
  );
}

/** Paste-ready path for dogfood / handtest notes. */
export function formatM1ExitPathPaste(input: M1ExitPathInput): M1ExitPathPaste {
  const board = projectM1ExitPath(input);
  const at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const dogfoodRequired = resolveM1DogfoodRequiredDays(input.dogfoodRequired);
  const lines: string[] = [
    '# SYNC-THINK M1 退出路径（soft 辅助 · 非退出证据）',
    '',
    '> 有序剩余步骤。**不能**替代手测文档勾选或 dogfood 真实日记。**不含**密钥。**不关 M1**。',
    '',
    '- 生成时间：' + at,
    '- soft craft 轮次：' + (input.softCraftRound ?? '—'),
    '- 进度：' + board.progressPercent + '%（封顶 99 · 人工关 M1 前不算 100）',
    '- 摘要：' + board.summary,
    '- level：' + board.level + ' · claimsM1Closed=false',
    '- 手测文档：' +
      (input.handtestDocChecked | 0) +
      '/' +
      (input.handtestDocTotal | 0 || 18) +
      ' · dogfood：' +
      (input.dogfoodRealDays | 0) +
      '/' +
      dogfoodRequired,
    '',
    '| # | 状态 | 门槛 | 步骤 | 行动 |',
    '|---|---|---|---|---|',
  ];
  for (const s of board.steps) {
    const st =
      s.status === 'done'
        ? '✅'
        : s.status === 'doing'
          ? '🔵'
          : s.status === 'blocked'
            ? '⛔'
            : '⬜';
    lines.push(
      '| ' +
        s.order +
        ' | ' +
        st +
        ' ' +
        s.status +
        ' | ' +
        s.gate +
        ' | ' +
        s.title.replace(/\|/g, '/') +
        ' | ' +
        (s.ctaLabel || '—') +
        ' |',
    );
  }
  lines.push(
    '',
    '## 边界',
    '- 本路径不自动改变 M1 状态 · M2 已完成',
    '- 本路径不自动勾文档、不写 dogfood 盘',
    '',
  );
  const markdown = lines.join('\n');
  return {
    markdown,
    summary:
      '已复制退出路径 ' +
      markdown.length +
      ' 字 · 进度 ' +
      board.progressPercent +
      '% · 硬门槛剩余 ' +
      board.remainingHardSteps +
      ' · 仍不关 M1',
    charCount: markdown.length,
    claimsM1Closed: false,
  };
}

export function exitPathLooksSecretFree(text: string): boolean {
  if (!text) return true;
  if (/\bsk-[A-Za-z0-9_\-]{16,}\b/.test(text)) return false;
  if (/\bBearer\s+[A-Za-z0-9_\-\.]{20,}\b/i.test(text)) return false;
  if (/api[_-]?key\s*[:=]\s*['\"]?[A-Za-z0-9_\-]{12,}/i.test(text)) return false;
  return true;
}
