import type { M1SessionJumpTarget } from './m1-session-readiness.js';
import { resolveM1DogfoodRequiredDays } from './m1-dogfood-policy.js';

/**
 * M1 external hand-test checklist projection (aligned with
 * docs/development/14-external-gateway-handtest.md).
 *
 * live = can be inferred from current desktop soft state
 * external = needs real external gateway / intentional failure / multi-day ops
 * Never auto-closes M1. Doc checkboxes remain the human evidence trail.
 */

export type M1HandtestGate = 'live' | 'external';
export type M1HandtestStatus = 'pass' | 'fail' | 'pending' | 'na';

export interface M1HandtestItemDef {
  id: string;
  section: 'pre' | 'A' | 'B' | 'C' | 'D';
  label: string;
  gate: M1HandtestGate;
  /** Short Chinese how-to when pending. */
  hint: string;
}

/** Canonical 18 items — keep in sync with 14-external-gateway-handtest.md */
export const M1_HANDTEST_ITEMS: readonly M1HandtestItemDef[] = [
  {
    id: 'pre-runtime',
    section: 'pre',
    label: 'Runtime 已连接',
    gate: 'live',
    hint: '确认左侧项目区底部 Runtime 为已连接',
  },
  {
    id: 'pre-task',
    section: 'pre',
    label: '已打开任务',
    gate: 'live',
    hint: '在项目导航打开一个任务',
  },
  {
    id: 'pre-providers',
    section: 'pre',
    label: '≥2 个 Provider 端点',
    gate: 'live',
    hint: 'Providers 面板添加第二个网关（外网可达才算手测通过）',
  },
  {
    id: 'pre-models',
    section: 'pre',
    label: '≥3 个模型 id',
    gate: 'live',
    hint: '发现或手动添加模型至合计 ≥3',
  },
  {
    id: 'a-provider-a',
    section: 'A',
    label: 'Provider A + 密钥遮罩',
    gate: 'live',
    hint: '至少一个 Provider 已写入密钥（界面仅遮罩）',
  },
  {
    id: 'a-discover',
    section: 'A',
    label: '发现模型 ≥1',
    gate: 'live',
    hint: '对 Provider 执行发现或手动添加至少一个模型',
  },
  {
    id: 'a-provider-b',
    section: 'A',
    label: 'Provider B 已配置',
    gate: 'live',
    hint: '配置第二个 Provider（手测要求可访问外网端点）',
  },
  {
    id: 'a-readiness',
    section: 'A',
    label: '多模型就绪条变绿',
    gate: 'live',
    hint: 'Provider≥2 且模型≥3 后 Providers 就绪条应变绿',
  },
  {
    id: 'b-multi-model',
    section: 'B',
    label: '同任务切换 ≥3 模型各发一轮',
    gate: 'external',
    hint: '用 Compose chips 在真实外网模型上各发一轮（本机 soft 只能看是否已有多模型消息）',
  },
  {
    id: 'b-send-ready',
    section: 'B',
    label: '发送就绪条正确',
    gate: 'live',
    hint: 'Compose 发送就绪显示可发送/覆盖或 Agent 默认',
  },
  {
    id: 'b-trace',
    section: 'B',
    label: 'Trace 中文类别',
    gate: 'live',
    hint: '发送后右侧轨迹出现中文类别事件',
  },
  {
    id: 'b-manifest',
    section: 'B',
    label: 'Manifest 解析阶梯',
    gate: 'live',
    hint: '首轮模型调用后打开 Manifest 看解析阶梯',
  },
  {
    id: 'c-agent-bind',
    section: 'C',
    label: 'Agent 默认 + Fallback 保存',
    gate: 'live',
    hint: 'Agent 面板设定默认模型；建议再配 Fallback 链',
  },
  {
    id: 'c-fallback-fail',
    section: 'C',
    label: '主模型失败走 Fallback',
    gate: 'external',
    hint: '故意限流/错密钥验证 Fallback 与 Manifest 链位（外网）',
  },
  {
    id: 'c-pause-policy',
    section: 'C',
    label: '无 Fallback 时暂停',
    gate: 'external',
    hint: 'pauseOnFailure 场景需人工配置验证',
  },
  {
    id: 'd-no-secret',
    section: 'D',
    label: '无明文 API Key 泄漏',
    gate: 'live',
    hint: 'soft：密钥遮罩+dual 擦洗绿；外网手测仍需你目视日志',
  },
  {
    id: 'd-restart',
    section: 'D',
    label: '重启后对话仍在',
    gate: 'external',
    hint: '重启应用后确认任务与对话仍在、无重复副作用',
  },
  {
    id: 'd-limits',
    section: 'D',
    label: '已知限制文案可读',
    gate: 'live',
    hint: '见本条下方「M1 已知限制」折叠说明',
  },
] as const;

export interface M1HandtestLiveInput {
  connectionOnline: boolean;
  hasActiveTask: boolean;
  providerCount: number;
  modelCount: number;
  secretCount: number;
  /** Soft multi-model readiness (≥2 providers & ≥3 models). */
  providersReadySoft: boolean;
  /** Compose can send (has text optional — use structural readiness). */
  composeStructurallyReady: boolean;
  hasTraceEvents: boolean;
  manifestCount: number;
  agentDefaultSet: boolean;
  agentFallbackCount: number;
  /** Distinct model ids observed in current task messages (soft signal for multi-round). */
  distinctMessageModelCount: number;
  dualAutomatedOk: boolean;
  /** UI shows known-limits copy. */
  knownLimitsVisible: boolean;
  /** Doc checklist progress (human). */
  docChecked: number;
  docTotal: number;
  /** Distinct real dogfood dates recorded by the exit-evidence scanner. */
  dogfoodRealDays?: number;
  /** Product default is one real date; explicit values are accepted by fixtures. */
  dogfoodRequired?: number;
}

export interface M1HandtestChecklistItem {
  id: string;
  section: M1HandtestItemDef['section'];
  label: string;
  gate: M1HandtestGate;
  status: M1HandtestStatus;
  detail: string;
  hint: string;
  /** Soft jump — reuses session chip instrument targets. */
  jumpTarget: M1SessionJumpTarget;
  jumpHint: string;
}

export interface M1HandtestChecklist {
  items: M1HandtestChecklistItem[];
  livePass: number;
  liveTotal: number;
  externalPending: number;
  externalTotal: number;
  softLiveAllPass: boolean;
  docChecked: number;
  docTotal: number;
  level:
    'empty' | 'partial' | 'soft-live' | 'awaiting-external' | 'awaiting-dogfood' | 'evidence-ready';
  summary: string;
  note: string;
}

export interface M1CurrentMilestoneCopyInput {
  handtestChecked: number;
  handtestTotal: number;
  dogfoodRealDays: number;
  dogfoodRequired: number;
  m2Complete: boolean;
}

/** Current milestone copy for the Desktop status panel. */
export function projectM1CurrentMilestoneCopy(input: M1CurrentMilestoneCopyInput): string[] {
  const handtestTotal = Math.max(1, input.handtestTotal | 0 || 18);
  const handtestChecked = Math.min(handtestTotal, Math.max(0, input.handtestChecked | 0));
  const dogfoodRequired = resolveM1DogfoodRequiredDays(input.dogfoodRequired);
  const dogfoodRealDays = Math.max(0, input.dogfoodRealDays | 0);
  const dogfoodRemaining = Math.max(0, dogfoodRequired - dogfoodRealDays);
  const handtestComplete = handtestChecked >= handtestTotal;

  return [
    handtestComplete
      ? `外网真实网关 UI 手测 ${handtestChecked}/${handtestTotal} 已完成。`
      : `外网真实网关 UI 手测 ${handtestChecked}/${handtestTotal}，未完成项以验证区为准。`,
    input.m2Complete
      ? 'M2 已完成：协作/自动模式与多 Agent 编排已启用。'
      : 'M2 尚未完成，进度以路线图为准。',
    'CC Switch 完整导入已完成；导入密钥只进入安全存储。',
    dogfoodRemaining === 0
      ? handtestComplete
        ? `dogfood ${dogfoodRealDays}/${dogfoodRequired} 已满足；M1 已完成。`
        : `dogfood ${dogfoodRealDays}/${dogfoodRequired} 已满足；M1 仍缺外网手测。`
      : `dogfood ${dogfoodRealDays}/${dogfoodRequired}，还差 ${dogfoodRemaining} 个真实日期；M1 仍 open。`,
  ];
}

/** Item id → panel jump (align with session chip instruments). */
const HANDTEST_JUMP: Record<string, { target: M1SessionJumpTarget; hint: string }> = {
  'pre-runtime': {
    target: 'workspaces',
    hint: '看左侧项目区底部 Runtime 连接状态',
  },
  'pre-task': {
    target: 'workspaces',
    hint: '跳到项目导航 · 打开任务',
  },
  'pre-providers': {
    target: 'providers',
    hint: '跳到 Providers · 添加第二个网关',
  },
  'pre-models': {
    target: 'providers',
    hint: '跳到 Providers · 发现/添加模型',
  },
  'a-provider-a': {
    target: 'providers',
    hint: '跳到 Providers · 填写密钥（界面遮罩）',
  },
  'a-discover': {
    target: 'providers',
    hint: '跳到 Providers · 发现模型',
  },
  'a-provider-b': {
    target: 'providers',
    hint: '跳到 Providers · 配置 Provider B',
  },
  'a-readiness': {
    target: 'providers',
    hint: '跳到 Providers · 看多模型就绪条',
  },
  'b-multi-model': {
    target: 'providers',
    hint: '外网项：Compose 切模型各发一轮（先确认 Providers 就绪）',
  },
  'b-send-ready': {
    target: 'none',
    hint: '看对话区底部 Compose「发送就绪」条',
  },
  'b-trace': {
    target: 'trace',
    hint: '展开运行轨迹 · 中文类别事件',
  },
  'b-manifest': {
    target: 'manifest',
    hint: '展开轨迹栏 · Manifest 解析阶梯',
  },
  'c-agent-bind': {
    target: 'agent',
    hint: '跳到 Agent · 默认模型 / Fallback',
  },
  'c-fallback-fail': {
    target: 'agent',
    hint: '外网项：Agent Fallback 链 + 故意失败验证',
  },
  'c-pause-policy': {
    target: 'agent',
    hint: '外网项：Agent 无 Fallback / 暂停策略',
  },
  'd-no-secret': {
    target: 'providers',
    hint: 'Providers 密钥仅遮罩 · 日志无明文',
  },
  'd-restart': {
    target: 'none',
    hint: '外网项：重启应用后确认对话仍在',
  },
  'd-limits': {
    target: 'none',
    hint: '展开下方「M1 已知限制」折叠',
  },
};

/** Pure: handtest item → jump target + hint. */
export function resolveM1HandtestItemJump(itemId: string): {
  target: M1SessionJumpTarget;
  hint: string;
} {
  return (
    HANDTEST_JUMP[itemId] ?? {
      target: 'none',
      hint: '本项无面板跳转',
    }
  );
}

/** Pure: whether the handtest row is clickable. */
export function isM1HandtestItemJumpable(target: M1SessionJumpTarget): boolean {
  return target !== 'none';
}

function liveStatus(
  pass: boolean,
  partialDetail?: string,
): {
  status: M1HandtestStatus;
  detail: string;
} {
  if (pass) return { status: 'pass', detail: '本机 soft 已满足' };
  return {
    status: 'fail',
    detail: partialDetail ?? '本机尚未满足',
  };
}

export function projectM1HandtestChecklist(input: M1HandtestLiveInput): M1HandtestChecklist {
  const evals: Record<string, { status: M1HandtestStatus; detail: string }> = {
    'pre-runtime': liveStatus(input.connectionOnline, 'Runtime 未连接'),
    'pre-task': liveStatus(input.hasActiveTask, '未打开任务'),
    'pre-providers': liveStatus(input.providerCount >= 2, `Provider ${input.providerCount}/2`),
    'pre-models': liveStatus(input.modelCount >= 3, `模型 ${input.modelCount}/3`),
    'a-provider-a': liveStatus(
      input.secretCount >= 1 || input.providerCount >= 1,
      input.providerCount === 0 ? '无 Provider' : '密钥未写入',
    ),
    'a-discover': liveStatus(input.modelCount >= 1, '尚无模型'),
    'a-provider-b': liveStatus(input.providerCount >= 2, `Provider ${input.providerCount}/2`),
    'a-readiness': liveStatus(input.providersReadySoft, '未达 ≥2 Provider / ≥3 模型'),
    'b-multi-model': {
      status:
        input.distinctMessageModelCount >= 3
          ? 'pass'
          : input.distinctMessageModelCount > 0
            ? 'pending'
            : 'pending',
      detail:
        input.distinctMessageModelCount >= 3
          ? `soft 见 ${input.distinctMessageModelCount} 个模型消息 · 外网仍需手勾`
          : input.distinctMessageModelCount > 0
            ? `已见 ${input.distinctMessageModelCount} 个模型消息 · 需外网凑满 ≥3 轮`
            : '待外网 Compose 多模型轮次',
    },
    'b-send-ready': liveStatus(
      input.composeStructurallyReady,
      '发送结构未就绪（Runtime/任务/模型）',
    ),
    'b-trace': liveStatus(input.hasTraceEvents, '尚无轨迹事件'),
    'b-manifest': liveStatus(input.manifestCount > 0, '尚无 Manifest'),
    'c-agent-bind': liveStatus(
      input.agentDefaultSet,
      input.agentDefaultSet ? '默认已设' : '未设 Agent 默认模型',
    ),
    'c-fallback-fail': {
      status: 'pending',
      detail: '需外网故意失败验证',
    },
    'c-pause-policy': {
      status: 'pending',
      detail: '需人工配置 pauseOnFailure',
    },
    'd-no-secret': liveStatus(input.dualAutomatedOk && input.secretCount >= 0, '待确认擦洗路径'),
    'd-restart': {
      status: 'pending',
      detail: '需你重启应用后勾选',
    },
    'd-limits': liveStatus(input.knownLimitsVisible, '已知限制文案未展示'),
  };

  // Refine secret: if no providers, fail; if providers but no secret mark fail
  if (input.providerCount >= 1 && input.secretCount === 0) {
    evals['a-provider-a'] = {
      status: 'fail',
      detail: '有 Provider 但密钥未写入',
    };
  }
  // Agent with fallback is nicer detail
  if (input.agentDefaultSet) {
    evals['c-agent-bind'] = {
      status: 'pass',
      detail:
        input.agentFallbackCount > 0
          ? `默认已设 · Fallback ${input.agentFallbackCount}`
          : '默认已设 · 建议补 Fallback',
    };
  }

  const docChecked = Math.max(0, input.docChecked | 0);
  const docTotal = Math.max(0, input.docTotal | 0);
  const docComplete = docTotal > 0 && docChecked >= docTotal;
  const dogfoodRequired = resolveM1DogfoodRequiredDays(input.dogfoodRequired);
  const dogfoodRealDays = Math.max(0, input.dogfoodRealDays ?? 0);
  const dogfoodRemaining = Math.max(0, dogfoodRequired - dogfoodRealDays);

  const items: M1HandtestChecklistItem[] = M1_HANDTEST_ITEMS.map((def) => {
    const e = evals[def.id] ?? { status: 'pending' as const, detail: '—' };
    const j = resolveM1HandtestItemJump(def.id);
    return {
      id: def.id,
      section: def.section,
      label: def.label,
      gate: def.gate,
      status: docComplete && def.gate === 'external' ? 'pass' : e.status,
      detail: docComplete && def.gate === 'external' ? '手测文档已勾选' : e.detail,
      hint: def.hint,
      jumpTarget: j.target,
      jumpHint: j.hint,
    };
  });

  const liveItems = items.filter((i) => i.gate === 'live');
  const externalItems = items.filter((i) => i.gate === 'external');
  const livePass = liveItems.filter((i) => i.status === 'pass').length;
  const liveTotal = liveItems.length;
  const externalPending = externalItems.filter((i) => i.status !== 'pass').length;
  const externalTotal = externalItems.length;
  const softLiveAllPass = livePass === liveTotal && liveTotal > 0;

  let level: M1HandtestChecklist['level'];
  if (livePass === 0 && docChecked === 0) level = 'empty';
  else if (softLiveAllPass && docComplete && dogfoodRemaining === 0) level = 'evidence-ready';
  else if (softLiveAllPass && docComplete) level = 'awaiting-dogfood';
  else if (softLiveAllPass && externalPending > 0) level = 'soft-live';
  else if (softLiveAllPass && externalPending === 0 && docChecked < docTotal)
    level = 'awaiting-external';
  else if (softLiveAllPass && docChecked >= docTotal && docTotal > 0)
    level = 'awaiting-external'; // still need human doc — never auto done
  else level = 'partial';

  const summary =
    level === 'empty'
      ? '手测对照未起步'
      : level === 'evidence-ready'
        ? `外网手测 ${docChecked}/${docTotal} 已完成 · dogfood ${dogfoodRealDays}/${dogfoodRequired} · M1 已完成`
        : level === 'awaiting-dogfood'
          ? `外网手测 ${docChecked}/${docTotal} 已完成 · 等待 dogfood ${dogfoodRealDays}/${dogfoodRequired}`
          : softLiveAllPass
            ? `本机可核 ${livePass}/${liveTotal} 已满 · 外网项 ${externalPending} 待证`
            : `本机可核 ${livePass}/${liveTotal} · 文档勾选 ${docChecked}/${docTotal || '—'}`;

  const note =
    level === 'evidence-ready'
      ? `外网手测 ${docChecked}/${docTotal} 已完成；dogfood ${dogfoodRealDays}/${dogfoodRequired} 已满足。用户已确认一天即可，M1 已完成。`
      : level === 'awaiting-dogfood'
        ? `外网手测 ${docChecked}/${docTotal} 已完成；dogfood ${dogfoodRealDays}/${dogfoodRequired}，还差 ${dogfoodRemaining} 个真实日期。M1 仍 open，本对照不会自动写 dogfood。`
        : softLiveAllPass
          ? `本机 soft 可核项已满，但关 M1 仍需：① 文档 ${docChecked}/${docTotal || 18} 人手勾选 ② 外网项（多模型真轮次/Fallback 失败/重启等）③ dogfood ≥${dogfoodRequired} 天。本对照不会自动勾文档。`
          : `绿色=本机 soft 已见；灰/红=还没满足；标「外网」的必须你在真实网关完成后再勾 docs/development/14-external-gateway-handtest.md。`;

  return {
    items,
    livePass,
    liveTotal,
    externalPending,
    externalTotal,
    softLiveAllPass,
    docChecked,
    docTotal,
    level,
    summary,
    note,
  };
}
