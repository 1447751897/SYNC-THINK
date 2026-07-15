import type { M1SessionJumpTarget } from './m1-session-readiness.js';
import { resolveM1DogfoodRequiredDays } from './m1-dogfood-policy.js';

/**
 * M1 "next action" strip — one primary CTA from soft + hard evidence state.
 * Soft only: never closes M1; never auto-checks handtest/dogfood docs.
 */

export type M1NextActionKind =
  | 'connect-runtime'
  | 'open-task'
  | 'configure-providers'
  | 'bind-agent'
  | 'send-multi-model'
  | 'external-handtest'
  | 'write-dogfood'
  | 'refresh-evidence'
  | 'discuss-exit'
  | 'idle-soft';

/** What the primary CTA should do (beyond optional panel jump). */
export type M1NextCtaAction =
  | 'jump'
  | 'reconnect'
  | 'open-handtest'
  | 'open-dogfood'
  | 'open-dogfood-fill'
  | 'copy-dogfood-fill'
  | 'focus-external'
  | 'jump-external-item'
  | 'copy-external-runsheet'
  | 'refresh';

export type M1OpenDocTarget = 'handtest' | 'dogfood' | 'dogfood-today' | 'dogfood-template';

export interface M1NextActionInput {
  connectionOnline: boolean;
  hasActiveTask: boolean;
  providerCount: number;
  modelCount: number;
  secretCount: number;
  providersReadySoft: boolean;
  agentDefaultSet: boolean;
  sessionLevel: string;
  handtestLivePass: number;
  handtestLiveTotal: number;
  handtestSoftLiveAllPass: boolean;
  handtestExternalPending: number;
  handtestDocChecked: number;
  handtestDocTotal: number;
  dogfoodRealDays: number;
  dogfoodRequired?: number;
  dogfoodFileCount: number;
  dualAutomatedOk: boolean;
  hardGatesMet: boolean;
  exitLevel: string;
  /** #57: dogfood multi-day fill board signals (optional). */
  dogfoodFillLevel?: string | null;
  dogfoodDraftDays?: number;
  dogfoodScaffoldDays?: number;
  dogfoodMissingCount?: number;
  /** open-today | copy-draft | open-oldest-scaffold | none */
  dogfoodFillPrimaryAction?: string | null;
  /** #59: next external handtest focus (optional). */
  externalFocusId?: string | null;
  externalFocusLabel?: string | null;
  externalFocusSection?: string | null;
  externalFocusJumpTarget?: string | null;
  externalFocusJumpable?: boolean;
  externalFocusPending?: number;
}

export interface M1NextAction {
  kind: M1NextActionKind;
  title: string;
  body: string;
  ctaLabel: string;
  jumpTarget: M1SessionJumpTarget;
  /** Primary button behavior. */
  ctaAction: M1NextCtaAction;
  /** When ctaAction is open-*, which allowlisted doc path to open. */
  openDoc: M1OpenDocTarget | null;
  priority: number;
  gate: 'soft' | 'hard';
  level: 'blocked' | 'action' | 'evidence' | 'ready-discuss';
}

function providersGap(input: M1NextActionInput): boolean {
  return (
    input.providerCount < 2 ||
    input.modelCount < 3 ||
    input.secretCount < 1 ||
    !input.providersReadySoft
  );
}

function action(
  partial: Omit<M1NextAction, 'openDoc' | 'ctaAction'> & {
    ctaAction?: M1NextCtaAction;
    openDoc?: M1OpenDocTarget | null;
  },
): M1NextAction {
  const ctaAction = partial.ctaAction ?? 'jump';
  const openDoc =
    partial.openDoc ??
    (ctaAction === 'open-handtest'
      ? 'handtest'
      : ctaAction === 'open-dogfood'
        ? 'dogfood-today'
        : null);
  return {
    ...partial,
    ctaAction,
    openDoc,
  };
}

/** #57: build write-dogfood next action from fill board signals. */
function buildWriteDogfoodAction(
  input: M1NextActionInput,
  dogfoodRequired: number,
  opts?: { handtestDocReady?: boolean },
): M1NextAction {
  const left = Math.max(0, dogfoodRequired - (input.dogfoodRealDays | 0));
  const fillLevel = String(input.dogfoodFillLevel || '').trim() || 'empty';
  const draftN = Math.max(0, (input.dogfoodDraftDays ?? 0) | 0);
  const scafN = Math.max(0, (input.dogfoodScaffoldDays ?? 0) | 0);
  const missN = Math.max(0, (input.dogfoodMissingCount ?? 0) | 0);
  const primary = String(input.dogfoodFillPrimaryAction || '').trim();
  const fillBits =
    '有效 ' +
    input.dogfoodRealDays +
    '/' +
    dogfoodRequired +
    ' · 仍差 ' +
    left +
    (draftN ? ' · 草稿 ' + draftN + '（不计）' : '') +
    (scafN ? ' · 脚手架 ' + scafN : '') +
    (missN ? ' · 缺文件 ' + missN : '');

  const prefix = opts?.handtestDocReady ? '手测文档已齐，' : '';
  let title = '写 dogfood 真实日记';
  let body = prefix + fillBits + '。打开今日日记真实使用后填写；脚手架/草稿不计有效日。';
  if (fillLevel === 'blocked-fake') {
    title = '改掉假草稿 · 写真实 dogfood';
    body = '仅有粘贴草稿（不计有效日）。改掉「待你确认」并写真实结果后再计日 · ' + fillBits + '。';
  } else if (fillLevel === 'scaffold-only') {
    title = '补填 dogfood 脚手架 · 仍差 ' + left + ' 天';
    body = '仅有脚手架 · 按模板写真实使用记录 · ' + fillBits + '。';
  } else if (fillLevel === 'partial') {
    title = '继续补 dogfood · 仍差 ' + left + ' 天';
    body = '部分有效 · ' + fillBits + ' · 点主按钮可走补填板。';
  } else if (fillLevel === 'empty' || missN > 0) {
    title = '写 dogfood · 仍差 ' + left + ' 天';
    body = '窗口内尚缺日记 · ' + fillBits + '。';
  }

  let ctaLabel = '打开今日 dogfood';
  let ctaAction: M1NextCtaAction = 'open-dogfood';
  let openDoc: M1OpenDocTarget | null = 'dogfood-today';
  if (primary === 'copy-draft') {
    ctaLabel = '复制多日补填';
    ctaAction = 'copy-dogfood-fill';
    openDoc = null;
  } else if (primary === 'open-oldest-scaffold') {
    ctaLabel = '打开补填板';
    ctaAction = 'open-dogfood-fill';
    openDoc = null;
  } else if (primary === 'open-today' || primary === '' || primary === 'none') {
    ctaLabel =
      fillLevel === 'scaffold-only' || fillLevel === 'empty'
        ? '写今日 dogfood'
        : '打开今日 dogfood';
    ctaAction = 'open-dogfood';
    openDoc = 'dogfood-today';
  } else {
    ctaLabel = '打开补填板';
    ctaAction = 'open-dogfood-fill';
    openDoc = null;
  }

  return action({
    kind: 'write-dogfood',
    title,
    body,
    ctaLabel,
    jumpTarget: 'none',
    ctaAction,
    openDoc,
    priority: 6,
    gate: 'hard',
    level: 'evidence',
  });
}

/** #59: external-handtest next action enriched by external focus strip. */
function buildExternalHandtestAction(
  input: M1NextActionInput,
  opts: { title: string; bodyPrefix?: string },
): M1NextAction {
  const docTotal = Math.max(0, input.handtestDocTotal | 0);
  const docChecked = Math.max(0, input.handtestDocChecked | 0);
  const focusId = String(input.externalFocusId || '').trim();
  const focusLabel = String(input.externalFocusLabel || '').trim();
  const focusSec = String(input.externalFocusSection || '').trim();
  const pending = Math.max(
    0,
    (input.externalFocusPending ?? input.handtestExternalPending ?? 0) | 0,
  );
  const jumpable = Boolean(input.externalFocusJumpable);
  const jumpRaw = String(input.externalFocusJumpTarget || 'none').trim();
  const jumpTarget = (
    jumpRaw === 'providers' ||
    jumpRaw === 'agent' ||
    jumpRaw === 'compose' ||
    jumpRaw === 'trace' ||
    jumpRaw === 'manifest' ||
    jumpRaw === 'workspaces' ||
    jumpRaw === 'memory' ||
    jumpRaw === 'approvals' ||
    jumpRaw === 'theme'
      ? jumpRaw
      : 'providers'
  ) as import('./m1-session-readiness.js').M1SessionJumpTarget;

  if (focusId && focusLabel) {
    const title = '下一外网项 · ' + (focusSec ? focusSec + ' · ' : '') + focusLabel;
    const body =
      (opts.bodyPrefix ? opts.bodyPrefix + ' ' : '') +
      '焦点 `' +
      focusId +
      '` · 外网待证 ' +
      pending +
      ' · 文档 ' +
      docChecked +
      '/' +
      (docTotal || 18) +
      '。主按钮走聚焦条；密钥勿入库；不自动勾。';
    if (jumpable) {
      return action({
        kind: 'external-handtest',
        title,
        body,
        ctaLabel: '跳到相关面板',
        jumpTarget,
        ctaAction: 'jump-external-item',
        openDoc: null,
        priority: 5,
        gate: 'hard',
        level: 'evidence',
      });
    }
    return action({
      kind: 'external-handtest',
      title,
      body,
      ctaLabel: '打开外网聚焦',
      jumpTarget: 'providers',
      ctaAction: 'focus-external',
      openDoc: null,
      priority: 5,
      gate: 'hard',
      level: 'evidence',
    });
  }

  // Fallback: generic open handtest
  return action({
    kind: 'external-handtest',
    title: opts.title,
    body:
      (opts.bodyPrefix ? opts.bodyPrefix + ' ' : '') +
      '手测文档 ' +
      docChecked +
      '/' +
      (docTotal || 18) +
      ' · 外网待证 ' +
      pending +
      '。打开清单继续；本机 soft 可同步补齐。',
    ctaLabel: '打开手测清单',
    jumpTarget: 'providers',
    ctaAction: 'open-handtest',
    openDoc: 'handtest',
    priority: 5,
    gate: 'hard',
    level: 'evidence',
  });
}

/**
 * Pure: pick exactly one primary next action (deterministic priority ladder).
 */
export function projectM1NextAction(input: M1NextActionInput): M1NextAction {
  const dogfoodRequired = resolveM1DogfoodRequiredDays(input.dogfoodRequired);
  const docTotal = Math.max(0, input.handtestDocTotal | 0);
  const docChecked = Math.max(0, input.handtestDocChecked | 0);
  const handtestIncomplete = docTotal === 0 || docChecked < docTotal;
  const dogfoodIncomplete = input.dogfoodRealDays < dogfoodRequired;

  if (!input.connectionOnline) {
    return action({
      kind: 'connect-runtime',
      title: '先连上 Runtime',
      body: '桌面端要先连本地 Runtime，会话就绪与发送才会亮。可点主按钮重新连接；或看左侧工作区底部连接状态。',
      ctaLabel: '重新连接 Runtime',
      jumpTarget: 'workspaces',
      ctaAction: 'reconnect',
      priority: 1,
      gate: 'soft',
      level: 'blocked',
    });
  }

  if (!input.hasActiveTask) {
    return action({
      kind: 'open-task',
      title: '打开或创建一个任务',
      body: '多模型对话、Manifest、轨迹都以任务为边界。在左侧工作区选一个任务或新建。',
      ctaLabel: '打开工作区导航',
      jumpTarget: 'workspaces',
      ctaAction: 'jump',
      priority: 2,
      gate: 'soft',
      level: 'action',
    });
  }

  if (providersGap(input)) {
    const bits: string[] = [];
    if (input.providerCount < 2) bits.push('Provider ' + input.providerCount + '/2');
    if (input.modelCount < 3) bits.push('模型 ' + input.modelCount + '/3');
    if (input.secretCount < 1) bits.push('密钥未写');
    return action({
      kind: 'configure-providers',
      title: '配齐多模型门槛',
      body:
        '当前：' +
        (bits.join(' · ') || '未就绪') +
        '。M1 需要 ≥2 Provider、≥3 模型，密钥只进安全存储（界面遮罩，勿入库）。',
      ctaLabel: '去 Providers',
      jumpTarget: 'providers',
      ctaAction: 'jump',
      priority: 3,
      gate: 'soft',
      level: 'action',
    });
  }

  if (!input.agentDefaultSet) {
    return action({
      kind: 'bind-agent',
      title: '设定 Agent 默认模型',
      body: '建议再配 Fallback 链：主模型失败时可降级；无 Fallback 时按暂停策略处理。',
      ctaLabel: '打开 Agent 绑定',
      jumpTarget: 'agent',
      ctaAction: 'jump',
      priority: 4,
      gate: 'soft',
      level: 'action',
    });
  }

  if (input.hardGatesMet) {
    return action({
      kind: 'discuss-exit',
      title: 'M1 已完成',
      body: '外网手测 18/18 与 dogfood 1/1 均已满足；用户已确认一天即可。',
      ctaLabel: '刷新退出证据',
      jumpTarget: 'none',
      ctaAction: 'refresh',
      priority: 9,
      gate: 'hard',
      level: 'ready-discuss',
    });
  }

  // Soft live full → hard evidence path
  if (input.handtestSoftLiveAllPass) {
    if (handtestIncomplete && docChecked === 0) {
      return buildExternalHandtestAction(input, {
        title: '下一步：外网网关 UI 手测',
        bodyPrefix:
          '本机 soft 可核 ' +
          input.handtestLivePass +
          '/' +
          (input.handtestLiveTotal || '—') +
          ' 已满。',
      });
    }

    if (handtestIncomplete) {
      return buildExternalHandtestAction(input, {
        title: '继续外网手测勾选',
        bodyPrefix: '继续外网路径。',
      });
    }

    if (dogfoodIncomplete) {
      return buildWriteDogfoodAction(input, dogfoodRequired, { handtestDocReady: true });
    }
  }

  // Soft not full — multi-model send nudge
  if (input.sessionLevel === 'ready' || input.handtestLivePass > 0) {
    if (!input.handtestSoftLiveAllPass) {
      return action({
        kind: 'send-multi-model',
        title: '同任务多模型走一轮',
        body:
          '本机 soft 手测 ' +
          input.handtestLivePass +
          '/' +
          (input.handtestLiveTotal || '—') +
          ' · 文档 ' +
          docChecked +
          '/' +
          (docTotal || '—') +
          ' · dogfood ' +
          input.dogfoodRealDays +
          '/' +
          dogfoodRequired +
          '。Compose 切换 ≥3 模型各发一轮；点手测对照行可跳面板。',
        ctaLabel: '刷新退出证据',
        jumpTarget: 'none',
        ctaAction: 'refresh',
        priority: 8,
        gate: 'soft',
        level: 'action',
      });
    }
  }

  if (!input.dualAutomatedOk) {
    return action({
      kind: 'refresh-evidence',
      title: '确认本地 dual 自测',
      body: '本地 dual 网关自动化未确认绿。可跑 runtime dual-http / dual-protocol；这不能替代外网手测。',
      ctaLabel: '刷新退出证据',
      jumpTarget: 'none',
      ctaAction: 'refresh',
      priority: 7,
      gate: 'soft',
      level: 'action',
    });
  }

  // Partial handtest/dogfood without soft-all-pass
  if (handtestIncomplete && docChecked > 0) {
    return buildExternalHandtestAction(input, {
      title: '继续外网手测勾选',
      bodyPrefix: '文档已有勾选进度。',
    });
  }

  if (!handtestIncomplete && dogfoodIncomplete) {
    return buildWriteDogfoodAction(input, dogfoodRequired, { handtestDocReady: true });
  }

  return action({
    kind: 'idle-soft',
    title: '本机 soft 推进中',
    body:
      '会话 ' +
      input.sessionLevel +
      ' · 手测文档 ' +
      docChecked +
      '/' +
      (docTotal || '—') +
      ' · dogfood ' +
      input.dogfoodRealDays +
      '/' +
      dogfoodRequired +
      '。对照手测条逐项点跳；关 M1 仍要外网手测 + dogfood。',
    ctaLabel: '刷新退出证据',
    jumpTarget: 'none',
    ctaAction: 'refresh',
    priority: 8,
    gate: 'soft',
    level: 'action',
  });
}

export function isM1NextActionJumpable(target: M1SessionJumpTarget): boolean {
  return target !== 'none';
}

export function isM1NextOpenDocAction(action: M1NextCtaAction): boolean {
  return action === 'open-handtest' || action === 'open-dogfood';
}

/** #57: next-action CTAs that route to dogfood fill board. */
export function isM1NextDogfoodFillAction(action: M1NextCtaAction): boolean {
  return action === 'open-dogfood-fill' || action === 'copy-dogfood-fill';
}

/** #59: next-action CTAs that route to external focus strip. */
export function isM1NextExternalFocusAction(action: M1NextCtaAction): boolean {
  return (
    action === 'focus-external' ||
    action === 'jump-external-item' ||
    action === 'copy-external-runsheet'
  );
}
