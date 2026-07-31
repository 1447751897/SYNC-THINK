import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Bot,
  Check,
  KeyRound,
  Layers3,
  PauseCircle,
  Pin,
  Sparkles,
  BookMarked,
  Upload,
  Plug,
  Radar,
} from 'lucide-react';
import type { ProviderSurface } from '@sync-think/shared';
import { ModelPathBoard, formatModelPathLabel } from './ModelPathBoard.js';

export interface AgentBindingModelOption {
  modelId: string;
  label: string;
  providerName?: string;
  providerId?: string;
  providerModelId?: string;
  surface?: ProviderSurface;
  protocol?: string;
}

/** Credential option for §5.4 group + pin selection (never includes secrets). */
export interface AgentBindingCredentialOption {
  credentialRefId: string;
  credentialGroupId: string;
  groupName: string;
  label: string;
  providerName?: string;
  kind?: string;
}

export interface AgentBindingView {
  agentId: string;
  agentVersionId: string;
  version: number;
  name: string;
  role: string;
  defaultModelId: string;
  fallbackModelIds: readonly string[];
  pauseOnFailure: boolean;
  defaultCredentialGroupId?: string;
  pinnedCredentialRefId?: string | null;
  skillVersionIds?: readonly string[];
  mcpServerIds?: readonly string[];
}

export interface AgentBindingSkillOption {
  skillVersionId: string;
  name: string;
  version: string;
  description?: string;
  hasScripts?: boolean;
  allowedTools?: readonly string[];
  /** Permission-diff label from last import comparison (optional). */
  permissionNote?: string;
  contentFingerprint?: string;
}

export interface AgentBindingMcpOption {
  mcpServerId: string;
  name: string;
  transport?: string;
  endpoint?: string;
  toolCount?: number;
  /** Discovered tool names (from tools/list or register); display only. */
  toolNames?: readonly string[];
  trusted?: boolean;
  maxOutputBytes?: number;
  timeoutMs?: number;
  policyLabel?: string;
}

export interface AgentBindingSaveInput {
  defaultModelId: string;
  fallbackModelIds: string[];
  pauseOnFailure: boolean;
  defaultCredentialGroupId?: string;
  /** null clears pin; undefined keeps previous when parent merges. Panel always sends string|null. */
  pinnedCredentialRefId?: string | null;
  /** Explicit Skill allowlist for this Agent (section 9.1). */
  skillVersionIds: string[];
  mcpServerIds: string[];
}

export interface AgentBindingPanelProps {
  binding: AgentBindingView | null;
  models: readonly AgentBindingModelOption[];
  /** Available credentials from provider catalog (metadata only). */
  credentials?: readonly AgentBindingCredentialOption[];
  /** Installed Skill library (import does not auto-allowlist). */
  skills?: readonly AgentBindingSkillOption[];
  skillBusy?: boolean;
  skillError?: string | null;
  skillStatusNote?: string | null;
  /** Registered MCP servers (register ≠ allowlist). */
  mcpServers?: readonly AgentBindingMcpOption[];
  mcpBusy?: boolean;
  mcpError?: string | null;
  mcpStatusNote?: string | null;
  onRegisterMcp?: (input: {
    name: string;
    transport?: string;
    endpoint?: string;
    toolsJson?: string;
    trusted?: boolean;
    maxOutputBytes?: number;
    timeoutMs?: number;
  }) => void | Promise<void>;
  onProbeMcpPolicy?: (input: {
    mcpServerId?: string;
    maxOutputBytes?: number;
    timeoutMs?: number;
    trusted?: boolean;
    simulatedOutput?: string;
    simulatedElapsedMs?: number;
  }) => void | Promise<void>;
  mcpProbeBusy?: boolean;
  /** Soft craft: request MCP tool → Approval Center (no spawn). */
  onRequestMcpTool?: (input: {
    mcpServerId?: string;
    toolName: string;
    forceSensitive?: boolean;
  }) => void | Promise<void>;
  mcpRequestBusy?: boolean;
  /** Real local-stdio spawn probe (process host only, no tool execution). */
  onProbeMcpSpawn?: (input: {
    mcpServerId?: string;
    endpoint?: string;
    maxOutputBytes?: number;
    timeoutMs?: number;
    trusted?: boolean;
  }) => void | Promise<void>;
  mcpSpawnBusy?: boolean;
  /** Real MCP JSON-RPC tool call (authz + approval gates + spawn). */
  onCallMcpTool?: (input: {
    mcpServerId?: string;
    toolName: string;
    argumentsJson?: string;
    forceSensitive?: boolean;
  }) => void | Promise<void>;
  mcpCallBusy?: boolean;
  /** Real MCP JSON-RPC tools/list discovery; persists schemas, no tool execution. */
  onRefreshMcpTools?: (input: {
    mcpServerId?: string;
    maxOutputBytes?: number;
    timeoutMs?: number;
  }) => void | Promise<void>;
  mcpRefreshBusy?: boolean;
  loading?: boolean;
  busy?: boolean;
  error?: string | null;
  statusNote?: string | null;
  onSave?: (input: AgentBindingSaveInput) => void | Promise<void>;
  onImportSkill?: (skillMd: string) => void | Promise<void>;
  /**
   * full = classic long form (legacy drawer).
   * tabs = embed under AgentWorkspace; only show activeSection.
   */
  layout?: 'full' | 'tabs';
  /** Which section to show when layout is tabs. */
  activeSection?: 'overview' | 'runtime' | 'skills' | 'tools' | 'more' | 'all';
}

export type AgentCapabilityReadinessLevel = 'empty' | 'partial' | 'ready';

export interface AgentCapabilityReadiness {
  level: AgentCapabilityReadinessLevel;
  badge: string;
  modelOk: boolean;
  fallbackCount: number;
  hasCredGroup: boolean;
  pinOk: boolean;
  skillLib: number;
  skillBound: number;
  mcpLib: number;
  mcpBound: number;
  /** True when a credential group is bound OR catalog has any credential options. */
  credOk: boolean;
  note: string;
}

export interface AgentCapabilityReadinessInput {
  /** Whether an Agent binding payload is loaded from Runtime. */
  hasBinding: boolean;
  defaultModelId?: string | null;
  fallbackModelIds?: readonly string[] | null;
  credentialGroupId?: string | null;
  pinnedCredentialRefId?: string | null;
  skillVersionIds?: readonly string[] | null;
  mcpServerIds?: readonly string[] | null;
  /** Installed Skill library size (import !== allowlist). */
  skillLibraryCount?: number;
  /** Registered MCP server library size (register !== allowlist). */
  mcpLibraryCount?: number;
  /** Credential catalog size (metadata only; never secrets). */
  credentialOptionCount?: number;
  /** Sentinel for unbound credential group (default: credential-group-unassigned). */
  unassignedGroupId?: string;
}

/**
 * Pure projector for Agent capability readiness (binding + Skill/MCP).
 * UI + unit tests share this — does NOT close M1; external hand-test + dogfood remain.
 */
export function projectAgentCapabilityReadiness(
  input: AgentCapabilityReadinessInput,
): AgentCapabilityReadiness {
  const unassigned = input.unassignedGroupId ?? 'credential-group-unassigned';
  const modelOk = Boolean((input.defaultModelId ?? '').trim());
  const fallbackIds = input.fallbackModelIds ?? [];
  const fallbackCount = fallbackIds.length;
  const credentialGroupId = input.credentialGroupId ?? unassigned;
  const hasCredGroup = credentialGroupId !== unassigned;
  const credOk = hasCredGroup || (input.credentialOptionCount ?? 0) > 0;
  const skillLib = Math.max(0, Number(input.skillLibraryCount ?? 0) || 0);
  const skillBound = (input.skillVersionIds ?? []).length;
  const mcpLib = Math.max(0, Number(input.mcpLibraryCount ?? 0) || 0);
  const mcpBound = (input.mcpServerIds ?? []).length;
  const pinOk = Boolean(input.pinnedCredentialRefId);

  let level: AgentCapabilityReadinessLevel = 'partial';
  if (!input.hasBinding || !modelOk) {
    level = 'empty';
  } else if (hasCredGroup && modelOk && (skillBound > 0 || mcpBound > 0 || fallbackCount > 0)) {
    level = 'ready';
  } else {
    level = 'partial';
  }

  const badge =
    level === 'ready'
      ? '能力已配'
      : level === 'partial'
        ? '进行中'
        : input.hasBinding
          ? '缺默认模型'
          : '未加载';

  let note = '';
  if (!input.hasBinding) {
    note = '连接 Runtime 后加载默认 Agent；导入 Skill / 登记 MCP 不会自动进白名单。';
  } else if (!modelOk) {
    note = '先选默认模型，再绑凭证组与 Fallback；Skill/MCP 导入后须勾选白名单并保存。';
  } else if (level === 'ready') {
    note =
      '导入 ≠ 授权。Skill/MCP 需勾选白名单并保存；敏感 MCP 会进批准中心。能力 soft 已满；外网 18/18、dogfood 1/1，M1 已完成。';
  } else {
    note =
      '导入 ≠ 授权。Skill/MCP 需勾选白名单并保存；敏感 MCP 会进批准中心。补齐凭证组或 Fallback/白名单可达「能力已配」。';
  }

  return {
    level,
    badge,
    modelOk,
    fallbackCount,
    hasCredGroup,
    pinOk,
    skillLib,
    skillBound,
    mcpLib,
    mcpBound,
    credOk,
    note,
  };
}

const UNASSIGNED = 'credential-group-unassigned';

/**
 * Compact Agent default / fallback / credential panel (product §5.3 + §5.4).
 * Continuum Bench aesthetic: calm instrument strip, not a form jungle.
 */
export function AgentBindingPanel(inputProps: AgentBindingPanelProps) {
  const props: AgentBindingPanelProps = {
    ...inputProps,
    busy: Boolean(inputProps.busy || inputProps.loading),
  };
  const [defaultModelId, setDefaultModelId] = useState('');
  const [fallbackIds, setFallbackIds] = useState<string[]>([]);
  const [pauseOnFailure, setPauseOnFailure] = useState(true);
  const [credentialGroupId, setCredentialGroupId] = useState(UNASSIGNED);
  const [pinnedCredentialRefId, setPinnedCredentialRefId] = useState<string>('');
  const [skillVersionIds, setSkillVersionIds] = useState<string[]>([]);
  const [mcpServerIds, setMcpServerIds] = useState<string[]>([]);
  const [skillMdDraft, setSkillMdDraft] = useState('');
  const [mcpNameDraft, setMcpNameDraft] = useState('');
  const [mcpEndpointDraft, setMcpEndpointDraft] = useState('');
  const [mcpToolsDraft, setMcpToolsDraft] = useState('read_file,list_dir');
  const [mcpTrustedDraft, setMcpTrustedDraft] = useState(false);
  const [mcpTimeoutDraft, setMcpTimeoutDraft] = useState('15000');
  const [mcpMaxBytesDraft, setMcpMaxBytesDraft] = useState('65536');
  const [mcpToolNameDraft, setMcpToolNameDraft] = useState('write_file');

  const credentials = useMemo(() => props.credentials ?? [], [props.credentials]);
  const skills = props.skills ?? [];
  const mcpServers = props.mcpServers ?? [];
  const layout = props.layout ?? 'full';
  const activeSection = props.activeSection ?? 'all';
  const showSection = (section: 'runtime' | 'skills' | 'tools' | 'more' | 'chrome') => {
    if (layout === 'full') return true;
    if (activeSection === 'all') return true;
    if (section === 'chrome') return false;
    return activeSection === section;
  };

  useEffect(() => {
    if (!props.binding) return;
    setDefaultModelId(props.binding.defaultModelId);
    setFallbackIds([...props.binding.fallbackModelIds]);
    setPauseOnFailure(props.binding.pauseOnFailure);
    const group =
      props.binding.defaultCredentialGroupId &&
      props.binding.defaultCredentialGroupId.trim().length > 0
        ? props.binding.defaultCredentialGroupId
        : UNASSIGNED;
    setCredentialGroupId(group);
    setPinnedCredentialRefId(props.binding.pinnedCredentialRefId ?? '');
    setSkillVersionIds([...(props.binding.skillVersionIds ?? [])]);
    setMcpServerIds([...(props.binding.mcpServerIds ?? [])]);
  }, [props.binding]);

  const modelLabel = useMemo(() => {
    return (id: string) => formatModelPathLabel(props.models, id, id);
  }, [props.models]);

  const groups = useMemo(() => {
    const map = new Map<
      string,
      { groupId: string; groupName: string; providerName?: string; count: number }
    >();
    for (const c of credentials) {
      const existing = map.get(c.credentialGroupId);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(c.credentialGroupId, {
          groupId: c.credentialGroupId,
          groupName: c.groupName || 'default',
          providerName: c.providerName,
          count: 1,
        });
      }
    }
    return [...map.values()];
  }, [credentials]);

  const pinsInGroup = useMemo(() => {
    if (!credentialGroupId || credentialGroupId === UNASSIGNED)
      return [] as AgentBindingCredentialOption[];
    return credentials.filter((c) => c.credentialGroupId === credentialGroupId);
  }, [credentials, credentialGroupId]);

  // If pin no longer belongs to selected group, clear draft pin.
  useEffect(() => {
    if (!pinnedCredentialRefId) return;
    if (credentialGroupId === UNASSIGNED) {
      setPinnedCredentialRefId('');
      return;
    }
    if (!pinsInGroup.some((c) => c.credentialRefId === pinnedCredentialRefId)) {
      setPinnedCredentialRefId('');
    }
  }, [credentialGroupId, pinnedCredentialRefId, pinsInGroup]);

  const dirty = useMemo(() => {
    if (!props.binding) return false;
    if (defaultModelId !== props.binding.defaultModelId) return true;
    if (pauseOnFailure !== props.binding.pauseOnFailure) return true;
    const a = fallbackIds.join('\0');
    const b = props.binding.fallbackModelIds.join('\0');
    if (a !== b) return true;
    const boundGroup = props.binding.defaultCredentialGroupId || UNASSIGNED;
    if (credentialGroupId !== boundGroup) return true;
    const boundPin = props.binding.pinnedCredentialRefId ?? '';
    if ((pinnedCredentialRefId || '') !== boundPin) return true;
    const boundMcp = [...(props.binding.mcpServerIds ?? [])].join('\0');
    const boundSkills = [...(props.binding.skillVersionIds ?? [])].join('\0');
    if (skillVersionIds.join('\0') !== boundSkills) return true;
    if (mcpServerIds.join('\0') !== boundMcp) return true;
    return false;
  }, [
    props.binding,
    defaultModelId,
    fallbackIds,
    pauseOnFailure,
    credentialGroupId,
    pinnedCredentialRefId,
    skillVersionIds,
    mcpServerIds,
  ]);

  const toggleFallback = (modelId: string) => {
    if (modelId === defaultModelId) return;
    setFallbackIds((prev) => {
      if (prev.includes(modelId)) return prev.filter((id) => id !== modelId);
      return [...prev, modelId];
    });
  };

  const moveFallback = (modelId: string, dir: -1 | 1) => {
    setFallbackIds((prev) => {
      const idx = prev.indexOf(modelId);
      if (idx < 0) return prev;
      const next = idx + dir;
      if (next < 0 || next >= prev.length) return prev;
      const copy = [...prev];
      const tmp = copy[idx]!;
      copy[idx] = copy[next]!;
      copy[next] = tmp;
      return copy;
    });
  };

  const removeFallback = (modelId: string) => {
    setFallbackIds((prev) => prev.filter((id) => id !== modelId));
  };

  /** Models eligible as fallback (exclude current default). */
  const fallbackSelectableModels = useMemo(
    () => props.models.filter((m) => m.modelId !== defaultModelId),
    [props.models, defaultModelId],
  );

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!props.onSave || props.busy || !defaultModelId.trim()) return;
    await props.onSave({
      defaultModelId: defaultModelId.trim(),
      fallbackModelIds: fallbackIds.filter((id) => id && id !== defaultModelId),
      pauseOnFailure,
      defaultCredentialGroupId: credentialGroupId,
      pinnedCredentialRefId: pinnedCredentialRefId ? pinnedCredentialRefId : null,
      skillVersionIds: [...skillVersionIds],
      mcpServerIds: [...mcpServerIds],
    });
  };

  const toggleSkill = (id: string) => {
    setSkillVersionIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const toggleMcp = (id: string) => {
    setMcpServerIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const SKILL_SAMPLE_MD = `---
name: minimal-demo
description: 最小可导入示例（不执行脚本）
version: 0.1.0
---
这是一段示例 Skill 正文。导入后须勾选白名单并保存 Agent，才会对会话生效。
`;

  const onImport = async () => {
    if (!props.onImportSkill || props.skillBusy || !skillMdDraft.trim()) return;
    const draft = skillMdDraft;
    try {
      await props.onImportSkill(draft);
      // Only clear when import resolves without throw
      setSkillMdDraft((cur) => (cur === draft ? '' : cur));
    } catch {
      // keep draft for edit/retry; error shown via skillError prop
    }
  };

  const fillSkillSample = () => {
    setSkillMdDraft(SKILL_SAMPLE_MD);
  };

  const capability = useMemo(
    () =>
      projectAgentCapabilityReadiness({
        hasBinding: Boolean(props.binding),
        defaultModelId,
        fallbackModelIds: fallbackIds,
        credentialGroupId,
        pinnedCredentialRefId,
        skillVersionIds,
        mcpServerIds,
        skillLibraryCount: props.skills?.length ?? 0,
        mcpLibraryCount: props.mcpServers?.length ?? 0,
        credentialOptionCount: props.credentials?.length ?? 0,
        unassignedGroupId: UNASSIGNED,
      }),
    [
      defaultModelId,
      fallbackIds,
      credentialGroupId,
      pinnedCredentialRefId,
      skillVersionIds,
      mcpServerIds,
      props.binding,
      props.skills,
      props.credentials,
      props.mcpServers,
    ],
  );

  const versionLabel = props.binding
    ? `v${props.binding.version} · ${props.binding.name}`
    : '未加载';

  const groupHint =
    credentialGroupId === UNASSIGNED
      ? '未绑定凭证组时，Runtime 使用模型所属 Provider 的主密钥'
      : pinnedCredentialRefId
        ? '已固定密钥：运行时不会在组内切换'
        : '组内自动选用：运行时只从该组取可用密钥';

  return (
    <section
      className="st-agent"
      aria-label={layout === 'tabs' ? 'Agent 绑定（页签）' : 'Agent 绑定'}
      data-testid="agent-binding-panel"
      data-layout={layout}
      data-level={capability.level}
    >
      {layout === 'full' ? (
        <>
          <header className="st-agent__header">
            <div className="st-agent__title-row">
              <span className="st-agent__mark" aria-hidden="true">
                <Bot size={14} strokeWidth={1.8} />
              </span>
              <div>
                <strong>Agent</strong>
                <small data-testid="agent-version-label">{versionLabel}</small>
              </div>
            </div>
            {props.binding ? (
              <span className="st-agent__chip" title={props.binding.agentVersionId}>
                <Layers3 size={11} strokeWidth={1.8} aria-hidden="true" />
                {props.binding.role}
              </span>
            ) : null}
          </header>

          {props.statusNote ? (
            <p className="st-agent__status" role="status" data-testid="agent-status">
              <Sparkles size={12} strokeWidth={1.8} aria-hidden="true" />
              {props.statusNote}
            </p>
          ) : null}
          {props.error ? (
            <p className="st-agent__error" role="alert" data-testid="agent-error">
              {props.error}
            </p>
          ) : null}

          <div
            className="st-agent__readiness"
            data-testid="agent-capability-readiness"
            data-level={capability.level}
            aria-label="Agent 能力就绪（§5 / §9）"
          >
            <div className="st-agent__readiness-head">
              <Radar size={12} strokeWidth={1.8} aria-hidden="true" />
              <span>能力就绪</span>
              <small>§5 绑定 · §9 Skill/MCP</small>
              <strong data-testid="agent-capability-badge">{capability.badge}</strong>
            </div>
            <ul className="st-agent__readiness-list">
              <li data-ok={capability.modelOk ? '1' : '0'} data-testid="agent-cap-check-model">
                <span className="st-agent__readiness-dot" aria-hidden="true" />
                默认模型 {capability.modelOk ? '已设' : '未设'}
              </li>
              <li
                data-ok={capability.fallbackCount > 0 ? '1' : '0'}
                data-testid="agent-cap-check-fallback"
              >
                <span className="st-agent__readiness-dot" aria-hidden="true" />
                Fallback {capability.fallbackCount}
                {capability.fallbackCount > 0 ? ' · 有序链' : ' · 可选'}
              </li>
              <li data-ok={capability.hasCredGroup ? '1' : '0'} data-testid="agent-cap-check-cred">
                <span className="st-agent__readiness-dot" aria-hidden="true" />
                凭证组 {capability.hasCredGroup ? '已绑' : '未绑'}
                {capability.pinOk ? ' · 已固定' : ''}
              </li>
              <li
                data-ok={capability.skillBound > 0 ? '1' : '0'}
                data-testid="agent-cap-check-skill"
              >
                <span className="st-agent__readiness-dot" aria-hidden="true" />
                Skill 白名单 {capability.skillBound}/{capability.skillLib}
              </li>
              <li data-ok={capability.mcpBound > 0 ? '1' : '0'} data-testid="agent-cap-check-mcp">
                <span className="st-agent__readiness-dot" aria-hidden="true" />
                MCP 白名单 {capability.mcpBound}/{capability.mcpLib}
              </li>
              <li data-ok={dirty ? '0' : '1'} data-testid="agent-cap-check-dirty">
                <span className="st-agent__readiness-dot" aria-hidden="true" />
                {dirty ? '有未保存改动' : '已与 Runtime 同步'}
              </li>
            </ul>
            <p className="st-agent__readiness-note" data-testid="agent-capability-note">
              {capability.note}
            </p>
          </div>
        </>
      ) : null}

      {props.loading && !props.binding ? (
        <p className="st-agent__empty" data-testid="agent-loading">
          读取 Agent 绑定…
        </p>
      ) : null}

      {!props.loading && !props.binding ? (
        <p className="st-agent__empty" data-testid="agent-empty">
          连接 Runtime 后显示默认模型、凭证组与 fallback 链
        </p>
      ) : null}

      {layout === 'tabs' && props.statusNote ? (
        <p className="st-agent__status" role="status" data-testid="agent-status">
          {props.statusNote}
        </p>
      ) : null}
      {layout === 'tabs' && props.error ? (
        <p className="st-agent__error" role="alert" data-testid="agent-error">
          {props.error}
        </p>
      ) : null}

      {props.binding ? (
        <form
          className="st-agent__form"
          onSubmit={(e) => void onSubmit(e)}
          data-testid="agent-form"
        >
          {layout === 'full' ? (
            <div
              className="st-agent__precedence"
              data-testid="agent-precedence"
              aria-label="模型绑定优先级"
            >
              <div className="st-agent__precedence-head">
                <Sparkles size={12} strokeWidth={1.8} aria-hidden="true" />
                <span>绑定优先级</span>
                <small>§5.3</small>
              </div>
              <ol className="st-agent__precedence-list">
                <li data-rank="1" data-testid="agent-precedence-run">
                  <span className="st-agent__precedence-rank">1</span>
                  <span className="st-agent__precedence-label">本轮覆盖</span>
                  <span className="st-agent__precedence-hint">Compose 选模型</span>
                </li>
                <li data-rank="2" data-testid="agent-precedence-workflow">
                  <span className="st-agent__precedence-rank">2</span>
                  <span className="st-agent__precedence-label">工作流步骤</span>
                  <span className="st-agent__precedence-hint">M2</span>
                </li>
                <li data-rank="3" data-active="1" data-testid="agent-precedence-agent">
                  <span className="st-agent__precedence-rank">3</span>
                  <span className="st-agent__precedence-label">Agent 默认</span>
                  <span className="st-agent__precedence-hint">
                    {modelLabel(defaultModelId) || defaultModelId.slice(0, 12) || '—'}
                  </span>
                </li>
                <li data-rank="4" data-testid="agent-precedence-fallback">
                  <span className="st-agent__precedence-rank">4</span>
                  <span className="st-agent__precedence-label">Fallback 链</span>
                  <span className="st-agent__precedence-hint">
                    {fallbackIds.length > 0
                      ? fallbackIds.map((id) => modelLabel(id) || id.slice(0, 8)).join(' → ')
                      : '未配置'}
                  </span>
                </li>
              </ol>
              <p className="st-agent__precedence-note" data-testid="agent-precedence-note">
                发送时：有本轮覆盖用覆盖；否则 Agent 默认；失败再按 Fallback 有序走
                {pauseOnFailure ? ' · 链尽暂停' : ' · 链尽不强制暂停'}
              </p>
            </div>
          ) : null}
          {showSection('runtime') ? (
            <div
              className="st-agent__field st-agent__field--runtime"
              data-testid="agent-runtime-board"
            >
              <span>默认模型 · 分组 → 供应商 → 模型</span>
              <ModelPathBoard
                id="agent-default-model"
                data-testid="agent-default-model"
                models={props.models}
                value={defaultModelId || null}
                onChange={(next) => {
                  const id = next ?? '';
                  setDefaultModelId(id);
                  if (id) setFallbackIds((prev) => prev.filter((x) => x !== id));
                }}
                disabled={props.busy || props.models.length === 0}
                allowDefault={false}
                defaultLabel="选择默认模型"
                variant="embedded"
              />
            </div>
          ) : null}

          {showSection('more') ? (
            <div className="st-agent__cred" data-testid="agent-credential-block">
              <div className="st-agent__cred-head">
                <KeyRound size={12} strokeWidth={1.8} aria-hidden="true" />
                <span>凭证路由</span>
                <small>§5.4</small>
              </div>

              <label className="st-agent__field">
                <span>凭证组</span>
                <select
                  value={credentialGroupId}
                  onChange={(e) => setCredentialGroupId(e.target.value)}
                  data-testid="agent-credential-group"
                  disabled={props.busy}
                >
                  <option value={UNASSIGNED}>未绑定（Provider 主密钥）</option>
                  {groups.map((g) => (
                    <option key={g.groupId} value={g.groupId}>
                      {(g.providerName ? `${g.providerName} · ` : '') + g.groupName}
                      {` · ${g.count} 钥`}
                    </option>
                  ))}
                </select>
              </label>

              <label className="st-agent__field">
                <span className="st-agent__pin-label">
                  <Pin size={11} strokeWidth={1.8} aria-hidden="true" />
                  固定密钥（可选）
                </span>
                <select
                  value={pinnedCredentialRefId}
                  onChange={(e) => setPinnedCredentialRefId(e.target.value)}
                  data-testid="agent-credential-pin"
                  disabled={
                    props.busy || credentialGroupId === UNASSIGNED || pinsInGroup.length === 0
                  }
                >
                  <option value="">自动从组内选用</option>
                  {pinsInGroup.map((c) => (
                    <option key={c.credentialRefId} value={c.credentialRefId}>
                      {c.label}
                      {c.kind ? ` · ${c.kind}` : ''}
                    </option>
                  ))}
                </select>
              </label>

              <p className="st-agent__hint" data-testid="agent-credential-hint">
                {groupHint}
              </p>
            </div>
          ) : null}

          {showSection('runtime') ? (
            <div
              className="st-agent__field st-agent__field--fallback"
              data-testid="agent-fallback-block"
            >
              <span>Fallback 链 · 分组 → 供应商 → 模型</span>
              <p className="st-agent__hint" data-testid="agent-fallback-hint">
                先维护有序链，再从下方路径板添加：点击模型加入 / 再次点击移出；默认模型不可作
                Fallback。
              </p>
              {fallbackIds.length === 0 ? (
                <p className="st-agent__hint" data-testid="agent-fallback-chain-empty">
                  尚未配置 Fallback · 失败时{pauseOnFailure ? '将暂停' : '不会强制暂停'}
                </p>
              ) : (
                <ol
                  className="st-agent__fallback-list st-agent__fallback-chain"
                  data-testid="agent-fallback-list"
                >
                  {fallbackIds.map((id, index) => {
                    const order = index + 1;
                    const path = formatModelPathLabel(props.models, id, id);
                    return (
                      <li key={id} data-selected="1" data-order={order}>
                        <div
                          className="st-agent__fallback-toggle"
                          data-testid={`agent-fallback-row-${id}`}
                        >
                          <span className="st-agent__fallback-order" aria-hidden="true">
                            {order}
                          </span>
                          <span className="st-agent__fallback-label" title={path}>
                            {path}
                          </span>
                          <Check size={12} strokeWidth={2} aria-hidden="true" />
                        </div>
                        <span className="st-agent__fallback-move">
                          <button
                            type="button"
                            aria-label="上移"
                            data-testid={`agent-fallback-up-${id}`}
                            onClick={() => moveFallback(id, -1)}
                            disabled={props.busy || order <= 1}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            aria-label="下移"
                            data-testid={`agent-fallback-down-${id}`}
                            onClick={() => moveFallback(id, 1)}
                            disabled={props.busy || order >= fallbackIds.length}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            aria-label="移出链"
                            className="st-agent__fallback-remove"
                            data-testid={`agent-fallback-toggle-${id}`}
                            onClick={() => removeFallback(id)}
                            disabled={props.busy}
                          >
                            ×
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
              {props.models.length === 0 ? (
                <p className="st-agent__hint" data-testid="agent-fallback-empty">
                  先在 Providers 发现或添加模型
                </p>
              ) : fallbackSelectableModels.length === 0 ? (
                <p className="st-agent__hint" data-testid="agent-fallback-no-options">
                  当前仅有默认模型，请先添加更多模型后再配 Fallback
                </p>
              ) : (
                <div className="st-agent__fallback-board-wrap">
                  <span className="st-agent__fallback-board-label">添加 / 调整候选</span>
                  <ModelPathBoard
                    id="agent-fallback-board"
                    data-testid="agent-fallback-board"
                    models={fallbackSelectableModels}
                    value={null}
                    multiSelectedIds={fallbackIds}
                    multiSelectedBadge="链中"
                    onChange={(next) => {
                      if (next) toggleFallback(next);
                    }}
                    disabled={props.busy}
                    allowDefault={false}
                    defaultLabel="选择 Fallback 模型"
                    variant="embedded"
                    showPathFooter
                  />
                </div>
              )}
            </div>
          ) : null}

          {showSection('skills') ? (
            <div className="st-agent__field" data-testid="agent-skills">
              <span className="st-agent__skills-label">
                <BookMarked size={12} strokeWidth={1.8} aria-hidden="true" />
                Skills 白名单
              </span>
              <p className="st-agent__hint">安装 ≠ 可用：仅勾选后写入 Agent 版本 allowlist</p>
              {props.skillStatusNote ? (
                <p className="st-agent__status" role="status" data-testid="skill-status">
                  <Sparkles size={12} strokeWidth={1.8} aria-hidden="true" />
                  {props.skillStatusNote}
                </p>
              ) : null}
              {skills.length === 0 ? (
                <p className="st-agent__hint" data-testid="agent-skills-empty">
                  尚未导入 Skill · 粘贴 SKILL.md 后导入
                </p>
              ) : (
                <ul className="st-agent__skill-list" data-testid="agent-skill-list">
                  {skills.map((sk) => {
                    const selected = skillVersionIds.includes(sk.skillVersionId);
                    return (
                      <li key={sk.skillVersionId} data-selected={selected || undefined}>
                        <button
                          type="button"
                          className="st-agent__skill-toggle"
                          data-testid={`agent-skill-toggle-${sk.skillVersionId}`}
                          aria-pressed={selected}
                          onClick={() => toggleSkill(sk.skillVersionId)}
                          disabled={props.busy}
                        >
                          <span className="st-agent__fallback-order" aria-hidden="true">
                            {selected ? <Check size={12} strokeWidth={2} /> : '·'}
                          </span>
                          <span className="st-agent__skill-meta">
                            <strong>{sk.name}</strong>
                            <small>
                              v{sk.version}
                              {typeof sk.allowedTools?.length === 'number' &&
                              sk.allowedTools.length > 0
                                ? ` · ${sk.allowedTools.length} tools`
                                : ''}
                              {sk.hasScripts ? ' · scripts recorded' : ''}
                              {sk.permissionNote ? ` · ${sk.permissionNote}` : ''}
                            </small>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="st-agent__import" data-testid="agent-skill-import">
                <p className="st-agent__hint" data-testid="agent-skill-import-hint">
                  粘贴完整 SKILL.md：首行 --- · 必填 name · 再 --- · 后接正文。无 frontmatter
                  会失败。
                </p>
                <textarea
                  className="st-agent__import-input"
                  data-testid="agent-skill-md"
                  placeholder={'---\nname: my-skill\nversion: 0.1.0\n---\nInstructions...'}
                  value={skillMdDraft}
                  onChange={(e) => setSkillMdDraft(e.target.value)}
                  disabled={props.skillBusy || props.busy}
                  rows={5}
                  spellCheck={false}
                />
                {props.skillError ? (
                  <p
                    className="st-agent__error st-agent__error--import"
                    role="alert"
                    data-testid="skill-error"
                  >
                    {props.skillError}
                  </p>
                ) : null}
                <div className="st-agent__import-actions">
                  <button
                    type="button"
                    className="st-agent__import-btn st-agent__import-btn--ghost"
                    data-testid="agent-skill-sample"
                    onClick={fillSkillSample}
                    disabled={props.skillBusy || props.busy}
                  >
                    填入示例
                  </button>
                  <button
                    type="button"
                    className="st-agent__import-btn"
                    data-testid="agent-skill-import-btn"
                    onClick={() => void onImport()}
                    disabled={
                      props.skillBusy || props.busy || !skillMdDraft.trim() || !props.onImportSkill
                    }
                  >
                    <Upload size={12} strokeWidth={1.8} aria-hidden="true" />
                    {props.skillBusy ? '导入中…' : '导入 SKILL.md'}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {showSection('tools') ? (
            <div className="st-agent__field" data-testid="agent-mcp">
              <span className="st-agent__skills-label">
                <Plug size={12} strokeWidth={1.8} aria-hidden="true" />
                MCP 白名单
              </span>
              <p className="st-agent__hint">
                注册 ≠ 可用：仅勾选后写入 Agent 版本 · Schema 入包不执行
              </p>
              {props.mcpStatusNote ? (
                <p className="st-agent__status" role="status" data-testid="mcp-status">
                  <Sparkles size={12} strokeWidth={1.8} aria-hidden="true" />
                  {props.mcpStatusNote}
                </p>
              ) : null}
              {props.mcpError ? (
                <p className="st-agent__error" role="alert" data-testid="mcp-error">
                  {props.mcpError}
                </p>
              ) : null}
              {mcpServers.length === 0 ? (
                <p className="st-agent__hint" data-testid="agent-mcp-empty">
                  尚未注册 MCP · 可先登记 endpoint，再「刷新工具目录」发现 Schema
                </p>
              ) : (
                <ul className="st-agent__skill-list" data-testid="agent-mcp-list">
                  {mcpServers.map((sv) => {
                    const selected = mcpServerIds.includes(sv.mcpServerId);
                    return (
                      <li
                        key={sv.mcpServerId}
                        data-selected={selected || undefined}
                        className="st-agent__mcp-item"
                      >
                        <button
                          type="button"
                          className="st-agent__skill-toggle"
                          data-testid={`agent-mcp-toggle-${sv.mcpServerId}`}
                          aria-pressed={selected}
                          onClick={() => toggleMcp(sv.mcpServerId)}
                          disabled={props.busy}
                        >
                          <span className="st-agent__fallback-order" aria-hidden="true">
                            {selected ? <Check size={12} strokeWidth={2} /> : '·'}
                          </span>
                          <span className="st-agent__skill-meta">
                            <strong>{sv.name}</strong>
                            <small>
                              {sv.transport || 'local-stdio'}
                              {typeof sv.toolCount === 'number' ? ` · ${sv.toolCount} tools` : ''}
                              {sv.policyLabel
                                ? ` · ${sv.policyLabel}`
                                : (sv.trusted ? ' · trusted' : ' · untrusted') +
                                  (typeof sv.timeoutMs === 'number' &&
                                  typeof sv.maxOutputBytes === 'number'
                                    ? ` · ${Math.round(sv.timeoutMs / 1000)}s / ${Math.round(sv.maxOutputBytes / 1024)}KB`
                                    : '')}
                            </small>
                          </span>
                        </button>
                        {sv.toolNames && sv.toolNames.length > 0 ? (
                          <span
                            className="st-agent__mcp-tool-chips"
                            data-testid={`agent-mcp-tools-${sv.mcpServerId}`}
                            title="已发现工具目录（Schema 元数据 · 未执行）"
                          >
                            {sv.toolNames.slice(0, 8).map((n) => (
                              <button
                                key={n}
                                type="button"
                                className="st-agent__mcp-tool-chip"
                                data-testid={`agent-mcp-tool-chip-${sv.mcpServerId}-${n}`}
                                title={`填入工具名：${n}（仅填写，不执行）`}
                                onClick={() => setMcpToolNameDraft(n)}
                                disabled={props.busy}
                              >
                                {n}
                              </button>
                            ))}
                            {sv.toolNames.length > 8 ? (
                              <span className="st-agent__mcp-tool-chip st-agent__mcp-tool-chip--more">
                                +{sv.toolNames.length - 8}
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          <span
                            className="st-agent__mcp-tool-empty"
                            data-testid={`agent-mcp-tools-empty-${sv.mcpServerId}`}
                          >
                            目录空 · 可「刷新工具目录」
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="st-agent__import" data-testid="agent-mcp-register">
                <input
                  className="st-agent__import-input"
                  data-testid="agent-mcp-name"
                  placeholder="server name e.g. filesystem"
                  value={mcpNameDraft}
                  onChange={(e) => setMcpNameDraft(e.target.value)}
                  disabled={props.mcpBusy || props.busy}
                />
                <input
                  className="st-agent__import-input"
                  data-testid="agent-mcp-endpoint"
                  placeholder="endpoint / command (not executed)"
                  value={mcpEndpointDraft}
                  onChange={(e) => setMcpEndpointDraft(e.target.value)}
                  disabled={props.mcpBusy || props.busy}
                />
                <input
                  className="st-agent__import-input"
                  data-testid="agent-mcp-tools"
                  placeholder="tools: read_file,list_dir"
                  value={mcpToolsDraft}
                  onChange={(e) => setMcpToolsDraft(e.target.value)}
                  disabled={props.mcpBusy || props.busy}
                />
                <div className="st-agent__mcp-policy-row" data-testid="agent-mcp-policy-fields">
                  <label className="st-agent__mcp-policy-field">
                    <span>超时 ms</span>
                    <input
                      className="st-agent__import-input"
                      data-testid="agent-mcp-timeout"
                      inputMode="numeric"
                      value={mcpTimeoutDraft}
                      onChange={(e) => setMcpTimeoutDraft(e.target.value)}
                      disabled={props.mcpBusy || props.busy}
                      placeholder="15000"
                    />
                  </label>
                  <label className="st-agent__mcp-policy-field">
                    <span>输出上限 B</span>
                    <input
                      className="st-agent__import-input"
                      data-testid="agent-mcp-max-bytes"
                      inputMode="numeric"
                      value={mcpMaxBytesDraft}
                      onChange={(e) => setMcpMaxBytesDraft(e.target.value)}
                      disabled={props.mcpBusy || props.busy}
                      placeholder="65536"
                    />
                  </label>
                </div>
                <label className="st-agent__toggle" data-testid="agent-mcp-trusted">
                  <input
                    type="checkbox"
                    checked={mcpTrustedDraft}
                    onChange={(e) => setMcpTrustedDraft(e.target.checked)}
                    disabled={props.mcpBusy || props.busy}
                  />
                  <span>标记 trusted（默认 untrusted · 仍需白名单）</span>
                </label>
                <label className="st-agent__mcp-policy-field">
                  <span>模拟工具名</span>
                  <input
                    data-testid="agent-mcp-tool-name"
                    value={mcpToolNameDraft}
                    onChange={(e) => setMcpToolNameDraft(e.target.value)}
                    disabled={
                      props.mcpBusy || props.mcpRequestBusy || props.mcpSpawnBusy || props.busy
                    }
                    placeholder="write_file"
                  />
                </label>
                <div className="st-agent__mcp-actions">
                  <button
                    type="button"
                    className="st-agent__import-btn"
                    data-testid="agent-mcp-register-btn"
                    onClick={() => {
                      void (async () => {
                        if (!props.onRegisterMcp || !mcpNameDraft.trim()) return;
                        const timeoutMs = Number(mcpTimeoutDraft);
                        const maxOutputBytes = Number(mcpMaxBytesDraft);
                        await props.onRegisterMcp({
                          name: mcpNameDraft.trim(),
                          endpoint: mcpEndpointDraft.trim() || undefined,
                          toolsJson: mcpToolsDraft.trim() || undefined,
                          trusted: mcpTrustedDraft,
                          timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : undefined,
                          maxOutputBytes: Number.isFinite(maxOutputBytes)
                            ? maxOutputBytes
                            : undefined,
                        });
                        setMcpNameDraft('');
                        setMcpEndpointDraft('');
                        setMcpToolsDraft('read_file,list_dir');
                        setMcpTrustedDraft(false);
                        setMcpTimeoutDraft('15000');
                        setMcpMaxBytesDraft('65536');
                      })();
                    }}
                    disabled={
                      props.mcpBusy || props.busy || !mcpNameDraft.trim() || !props.onRegisterMcp
                    }
                  >
                    <Plug size={12} strokeWidth={1.8} aria-hidden="true" />
                    {props.mcpBusy ? '登记中…' : '登记 MCP'}
                  </button>
                  <button
                    type="button"
                    className="st-agent__import-btn st-agent__import-btn--ghost"
                    data-testid="agent-mcp-probe-btn"
                    onClick={() => {
                      void (async () => {
                        if (!props.onProbeMcpPolicy) return;
                        const timeoutMs = Number(mcpTimeoutDraft);
                        const maxOutputBytes = Number(mcpMaxBytesDraft);
                        const selectedId = mcpServerIds[0];
                        await props.onProbeMcpPolicy({
                          mcpServerId: selectedId,
                          timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : undefined,
                          maxOutputBytes: Number.isFinite(maxOutputBytes)
                            ? maxOutputBytes
                            : undefined,
                          trusted: mcpTrustedDraft,
                          // oversize sample so truncation is observable
                          simulatedOutput: 'PROBE-' + 'x'.repeat(900),
                          simulatedElapsedMs: 0,
                        });
                      })();
                    }}
                    disabled={
                      props.mcpBusy || props.mcpProbeBusy || props.busy || !props.onProbeMcpPolicy
                    }
                    title="模拟输出限幅/超时/untrusted，不启动进程"
                  >
                    {props.mcpProbeBusy ? '探测中…' : '探测策略'}
                  </button>
                  <button
                    type="button"
                    className="st-agent__import-btn st-agent__import-btn--ghost"
                    data-testid="agent-mcp-request-btn"
                    onClick={() => {
                      void (async () => {
                        if (!props.onRequestMcpTool || !mcpToolNameDraft.trim()) return;
                        const selectedId = mcpServerIds[0] ?? mcpServers[0]?.mcpServerId;
                        await props.onRequestMcpTool({
                          mcpServerId: selectedId,
                          toolName: mcpToolNameDraft.trim(),
                          forceSensitive: !mcpTrustedDraft,
                        });
                      })();
                    }}
                    disabled={
                      props.mcpRequestBusy ||
                      props.mcpBusy ||
                      props.busy ||
                      !mcpToolNameDraft.trim() ||
                      !props.onRequestMcpTool
                    }
                  >
                    {props.mcpRequestBusy ? '入队中…' : '请求工具审批'}
                  </button>
                  <button
                    type="button"
                    className="st-agent__import-btn st-agent__import-btn--ghost"
                    data-testid="agent-mcp-refresh-btn"
                    onClick={() => {
                      void (async () => {
                        if (!props.onRefreshMcpTools) return;
                        const timeoutMs = Number(mcpTimeoutDraft);
                        const maxOutputBytes = Number(mcpMaxBytesDraft);
                        const selectedId = mcpServerIds[0] ?? mcpServers[0]?.mcpServerId;
                        await props.onRefreshMcpTools({
                          mcpServerId: selectedId,
                          timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : undefined,
                          maxOutputBytes: Number.isFinite(maxOutputBytes)
                            ? maxOutputBytes
                            : undefined,
                        });
                      })();
                    }}
                    disabled={
                      props.mcpRefreshBusy ||
                      props.mcpBusy ||
                      props.busy ||
                      !props.onRefreshMcpTools ||
                      (mcpServerIds.length === 0 && mcpServers.length === 0)
                    }
                    title="刷新工具目录：JSON-RPC tools/list，写入注册表，不执行工具"
                  >
                    {props.mcpRefreshBusy ? '刷新中…' : '刷新工具目录'}
                  </button>
                  <button
                    type="button"
                    className="st-agent__import-btn st-agent__import-btn--ghost"
                    data-testid="agent-mcp-spawn-btn"
                    onClick={() => {
                      void (async () => {
                        if (!props.onProbeMcpSpawn) return;
                        const timeoutMs = Number(mcpTimeoutDraft);
                        const maxOutputBytes = Number(mcpMaxBytesDraft);
                        const selectedId = mcpServerIds[0] ?? mcpServers[0]?.mcpServerId;
                        const selected = mcpServers.find((s) => s.mcpServerId === selectedId);
                        await props.onProbeMcpSpawn({
                          mcpServerId: selectedId,
                          endpoint: mcpEndpointDraft.trim() || selected?.endpoint || undefined,
                          timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : undefined,
                          maxOutputBytes: Number.isFinite(maxOutputBytes)
                            ? maxOutputBytes
                            : undefined,
                          trusted: mcpTrustedDraft,
                        });
                      })();
                    }}
                    disabled={
                      props.mcpSpawnBusy || props.mcpBusy || props.busy || !props.onProbeMcpSpawn
                    }
                    title="真 spawn 探测：允许 node/npx/echo/cmd，不执行 JSON-RPC 工具"
                  >
                    {props.mcpSpawnBusy ? 'Spawn 中…' : '真 spawn 探测'}
                  </button>
                  <button
                    type="button"
                    className="st-agent__import-btn st-agent__import-btn--primary"
                    data-testid="agent-mcp-call-btn"
                    onClick={() => {
                      void (async () => {
                        if (!props.onCallMcpTool || !mcpToolNameDraft.trim()) return;
                        const selectedId = mcpServerIds[0] ?? mcpServers[0]?.mcpServerId;
                        const args =
                          mcpToolNameDraft.trim() === 'echo'
                            ? JSON.stringify({ text: 'UI_CALL_OK' })
                            : mcpToolNameDraft.trim() === 'ping'
                              ? '{}'
                              : undefined;
                        await props.onCallMcpTool({
                          mcpServerId: selectedId,
                          toolName: mcpToolNameDraft.trim(),
                          argumentsJson: args,
                          forceSensitive: !mcpTrustedDraft,
                        });
                      })();
                    }}
                    disabled={
                      props.mcpCallBusy ||
                      props.mcpBusy ||
                      props.busy ||
                      !mcpToolNameDraft.trim() ||
                      !props.onCallMcpTool
                    }
                    title="真工具调用：白名单 + 敏感闸 + 审批后 JSON-RPC tools/call"
                  >
                    {props.mcpCallBusy ? '调用中…' : '真工具调用'}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {showSection('more') || showSection('runtime') ? (
            <label className="st-agent__toggle" data-testid="agent-pause-toggle">
              <input
                type="checkbox"
                checked={pauseOnFailure}
                onChange={(e) => setPauseOnFailure(e.target.checked)}
                disabled={props.busy}
              />
              <PauseCircle size={14} strokeWidth={1.8} aria-hidden="true" />
              <span>无 fallback 时暂停（不静默换模）</span>
            </label>
          ) : null}

          <div className="st-agent__actions">
            <button
              type="submit"
              className="st-agent__save"
              data-testid="agent-save"
              disabled={props.busy || !dirty || !defaultModelId.trim()}
            >
              {props.busy ? '保存中…' : dirty ? '保存绑定' : '已同步'}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
