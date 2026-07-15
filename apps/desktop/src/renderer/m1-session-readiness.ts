/**
 * M1 session readiness chips — pure projection for task-header observability.
 * Soft gate only: does NOT close M1. External gateway hand-test + dogfood still required.
 */
export type M1ConnectionState = 'online' | 'connecting' | 'offline' | string;

export interface M1ProviderLike {
  providerId: string;
  protocol?: string;
  models: readonly unknown[];
  credentials?: readonly { hasSecret?: boolean }[];
}

export interface M1SessionReadinessInput {
  connectionState: M1ConnectionState;
  providers: readonly M1ProviderLike[];
  manifestCount: number;
  theme: string;
  traceCollapsed: boolean;
  hasActiveTask: boolean;
  conversationLayout?: 'default' | 'single';
  /** Agent default model bound (soft · §5.3). */
  agentDefaultModelId?: string | null;
  /** Agent fallback chain length. */
  agentFallbackCount?: number;
  /** Skill allowlist bound count. */
  agentSkillBound?: number;
  /** MCP allowlist bound count. */
  agentMcpBound?: number;
  /** Pending approval queue depth (§13). */
  approvalPendingCount?: number;
  /** Active durable memory entries (§10.4). */
  memoryEntryCount?: number;
  /** Pending MemoryChange count (approval bridge). */
  memoryPendingCount?: number;
  /** Scrubbed diagnostics count (§19). */
  memoryDiagCount?: number;
}

export type M1ChipOk = '1' | '0' | 'partial';

export interface M1SessionChip {
  id: string;
  label: string;
  detail: string;
  ok: M1ChipOk;
  /** Soft jump target for cross-panel observability (click chip → scroll/flash). */
  jumpTarget: M1SessionJumpTarget;
  /** Short Chinese hint for title/aria. */
  jumpHint: string;
}

/** Where a session chip should take the operator (desktop nav/trace). */
export type M1SessionJumpTarget =
  | 'workspaces'
  | 'providers'
  | 'agent'
  | 'memory'
  | 'approvals'
  | 'manifest'
  | 'trace'
  | 'theme'
  | 'none';

const CHIP_JUMP: Record<string, { target: M1SessionJumpTarget; hint: string }> = {
  runtime: {
    target: 'none',
    hint: 'Runtime 连接状态 · 见左侧工作区底部连接说明',
  },
  task: {
    target: 'workspaces',
    hint: '跳到工作区导航 · 打开或创建任务',
  },
  providers: {
    target: 'providers',
    hint: '跳到 Providers · 配置网关与密钥',
  },
  models: {
    target: 'providers',
    hint: '跳到 Providers · 发现/添加模型（≥3）',
  },
  manifest: {
    target: 'manifest',
    hint: '展开轨迹栏 · 查看 Manifest 解析阶梯',
  },
  'trace-theme': {
    target: 'trace',
    hint: '展开运行轨迹 · 主题切换在任务头',
  },
  agent: {
    target: 'agent',
    hint: '跳到 Agent 绑定 · 默认模型 / Fallback',
  },
  approval: {
    target: 'approvals',
    hint: '跳到批准中心 · 处理待审',
  },
  memory: {
    target: 'memory',
    hint: '跳到 Memory/Diagnostics · 待审记忆与诊',
  },
};

/** Pure: chip id → jump target + hint (for tests & UI). */
export function resolveM1SessionChipJump(chipId: string): {
  target: M1SessionJumpTarget;
  hint: string;
} {
  return (
    CHIP_JUMP[chipId] ?? {
      target: 'none',
      hint: '本芯片无可跳转目标',
    }
  );
}

/** Pure: whether the jump is interactive in the strip. */
export function isM1SessionChipJumpable(target: M1SessionJumpTarget): boolean {
  return target !== 'none';
}

export interface M1SessionReadiness {
  providerCount: number;
  modelCount: number;
  secretCount: number;
  protocolCount: number;
  providersOk: boolean;
  modelsOk: boolean;
  connectionOk: boolean;
  taskOk: boolean;
  manifestOk: boolean;
  themeOk: boolean;
  agentOk: boolean;
  approvalOk: boolean;
  memoryOk: boolean;
  memoryEntryCount: number;
  memoryPendingCount: number;
  memoryDiagCount: number;
  agentFallbackCount: number;
  agentSkillBound: number;
  agentMcpBound: number;
  approvalPendingCount: number;
  /** Aggregate soft level for strip styling */
  level: 'empty' | 'partial' | 'ready';
  chips: M1SessionChip[];
  summary: string;
  note: string;
}

export function projectM1SessionReadiness(input: M1SessionReadinessInput): M1SessionReadiness {
  const providerCount = input.providers.length;
  const modelCount = input.providers.reduce((sum, p) => sum + p.models.length, 0);
  const secretCount = input.providers.reduce(
    (sum, p) => sum + (p.credentials?.filter((c) => c.hasSecret).length ?? 0),
    0,
  );
  const protocolCount = new Set(input.providers.map((p) => p.protocol).filter(Boolean) as string[])
    .size;

  const providersOk = providerCount >= 2;
  const modelsOk = modelCount >= 3;
  const connectionOk = input.connectionState === 'online';
  const taskOk = input.hasActiveTask;
  const manifestOk = input.manifestCount > 0;
  const themeOk = input.theme === 'light' || input.theme === 'dark';

  const agentDefaultModelId = (input.agentDefaultModelId ?? '').trim();
  const agentFallbackCount = Math.max(0, input.agentFallbackCount ?? 0);
  const agentSkillBound = Math.max(0, input.agentSkillBound ?? 0);
  const agentMcpBound = Math.max(0, input.agentMcpBound ?? 0);
  const approvalPendingCount = Math.max(0, input.approvalPendingCount ?? 0);
  const agentOk = Boolean(agentDefaultModelId);
  const approvalOk = approvalPendingCount === 0;
  const agentExtras = agentFallbackCount > 0 || agentSkillBound > 0 || agentMcpBound > 0;

  const memoryEntryCount = Math.max(0, input.memoryEntryCount ?? 0);
  const memoryPendingCount = Math.max(0, input.memoryPendingCount ?? 0);
  const memoryDiagCount = Math.max(0, input.memoryDiagCount ?? 0);
  /** Soft: no pending MemoryChange (entries optional until first approved write). */
  const memoryOk = memoryPendingCount === 0;
  const memoryEvidence = memoryEntryCount > 0 || memoryDiagCount > 0;

  const multiSoft = providersOk && modelsOk;
  const level: M1SessionReadiness['level'] =
    !taskOk && providerCount === 0 && !connectionOk
      ? 'empty'
      : multiSoft && connectionOk && taskOk && agentOk && approvalOk && memoryOk
        ? 'ready'
        : 'partial';

  const withJump = <T extends { id: string }>(
    chip: T & { label: string; detail: string; ok: M1ChipOk },
  ): M1SessionChip => {
    const j = resolveM1SessionChipJump(chip.id);
    return { ...chip, jumpTarget: j.target, jumpHint: j.hint };
  };

  const chips: M1SessionChip[] = [
    withJump({
      id: 'runtime',
      label: 'Runtime',
      detail:
        input.connectionState === 'online'
          ? '已连接'
          : input.connectionState === 'connecting'
            ? '连接中'
            : input.connectionState === 'offline'
              ? '未连接'
              : String(input.connectionState),
      ok: connectionOk ? '1' : input.connectionState === 'connecting' ? 'partial' : '0',
    }),
    withJump({
      id: 'task',
      label: '任务',
      detail: taskOk ? '已打开' : '未打开',
      ok: taskOk ? '1' : '0',
    }),
    withJump({
      id: 'providers',
      label: 'Provider',
      detail: `${providerCount}/2`,
      ok: providersOk ? '1' : providerCount > 0 ? 'partial' : '0',
    }),
    withJump({
      id: 'models',
      label: '模型',
      detail: `${modelCount}/3`,
      ok: modelsOk ? '1' : modelCount > 0 ? 'partial' : '0',
    }),
    withJump({
      id: 'manifest',
      label: 'Manifest',
      detail: manifestOk ? `${input.manifestCount} 次可查` : '尚无调用',
      ok: manifestOk ? '1' : '0',
    }),
    withJump({
      id: 'trace-theme',
      label: '轨迹/主题',
      detail: `${input.traceCollapsed ? '轨迹收起' : '轨迹展开'} · ${input.theme === 'dark' ? '暗色' : input.theme === 'light' ? '浅色' : input.theme}`,
      ok: themeOk ? '1' : '0',
    }),
    withJump({
      id: 'agent',
      label: 'Agent',
      detail: !agentOk
        ? '未设默认模型'
        : agentExtras
          ? `已绑 · F${agentFallbackCount}/S${agentSkillBound}/M${agentMcpBound}`
          : '默认已设',
      ok: agentOk ? (agentExtras ? '1' : 'partial') : '0',
    }),
    withJump({
      id: 'approval',
      label: '审批',
      detail: approvalPendingCount === 0 ? '空闲' : `待审 ${approvalPendingCount}`,
      ok: approvalOk ? '1' : '0',
    }),
    withJump({
      id: 'memory',
      label: 'Memory',
      detail:
        memoryPendingCount > 0
          ? `待审 ${memoryPendingCount}`
          : memoryEvidence
            ? `${memoryEntryCount} 条${memoryDiagCount > 0 ? ` · 诊${memoryDiagCount}` : ''}`
            : '尚无证据',
      ok: memoryPendingCount > 0 ? '0' : memoryEvidence ? '1' : 'partial',
    }),
  ];

  const summary =
    level === 'ready'
      ? '会话 soft 就绪'
      : level === 'empty'
        ? '等待开始'
        : memoryPendingCount > 0
          ? `会话准备中 · Memory 待审 ${memoryPendingCount}`
          : approvalPendingCount > 0
            ? `会话准备中 · 待审 ${approvalPendingCount}`
            : !agentOk
              ? '会话准备中 · 缺 Agent 默认模型'
              : '会话准备中';

  const note =
    level === 'ready'
      ? '本机会话 soft 门槛已满（Runtime+任务+≥2 Provider+≥3 模型+Agent 默认+审批/Memory 空闲）。M1 当前状态见验证区。'
      : memoryPendingCount > 0
        ? `Memory 有 ${memoryPendingCount} 条待审变更；在 Memory 面板通过/拒绝后写入持久记忆。`
        : approvalPendingCount > 0
          ? `批准中心有 ${approvalPendingCount} 条待审；处理后再跑敏感 MCP / Skill 升级。`
          : !agentOk
            ? '在 Agent 面板设定默认模型与可选 Fallback / Skill / MCP 白名单。'
            : secretCount === 0
              ? '配置 Provider 密钥（只写安全存储）并打开任务，即可在 Compose 跨模型切换。'
              : '继续补齐 Provider/模型或打开任务；Manifest 在首轮模型调用后出现。';

  return {
    providerCount,
    modelCount,
    secretCount,
    protocolCount,
    providersOk,
    modelsOk,
    connectionOk,
    taskOk,
    manifestOk,
    themeOk,
    agentOk,
    approvalOk,
    memoryOk,
    memoryEntryCount,
    memoryPendingCount,
    memoryDiagCount,
    agentFallbackCount,
    agentSkillBound,
    agentMcpBound,
    approvalPendingCount,
    level,
    chips,
    summary,
    note,
  };
}
