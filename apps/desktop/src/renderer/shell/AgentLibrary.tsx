// P2 · Global Agent Library
// Management console aligned with the Ability Center: the ability page's own
// hub shell (back · title · sibling link · sliding scope tabs · stat strip ·
// filter chips), a dense row list as the primary view, and the detail surface
// in a right-hand drawer (概览 / 工作 / 能力 / 设置).
import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowLeft,
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  GripVertical,
  ImagePlus,
  LayoutGrid,
  Lock,
  List as ListIcon,
  MessageSquare,
  Play,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  WandSparkles,
  Wrench,
  X,
} from 'lucide-react';
import { SlidingTabs } from './SlidingTabs.js';
import { WorkspaceScopeRow } from './WorkspaceScopeRow.js';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import clsx from 'clsx';
import type {
  AgentWritePolicy,
  Conversation,
  GlobalAgent,
  ModelId,
  Team,
} from '@sync-think/shared';
import type { WorkspaceSummary } from '@sync-think/protocol';
import type { ModelOption } from './NewConversationDialog.js';
import { useDialog } from './Dialog.js';
import { AgentAvatarView, isImageAvatar, readAvatarImage } from './AgentAvatarView.js';
import {
  AVATAR_COLORS,
  AVATAR_SHAPES,
  avatarDataUrl,
  avatarSeed,
  colorHex,
  resolveAvatarFace,
} from './avatar-gen.js';
import { avatarColor } from './avatar-color.js';
import { ModelPickerMenu } from './compose-toolbar.js';
import { OverlayScrollArea } from './OverlayScrollArea.js';
import { McpIdentityMark } from './abilities/McpIdentityMark.js';
import { BrandLogoMark } from './BrandLogoMark.js';
import { resolveProviderBrandLogo, resolveProviderBrandLogoByName } from './brand-icons.js';
import { loadMcpCatalog } from './mcp-catalog-loader.js';
import { loadSkillCatalog } from './skill-catalog-loader.js';

interface Props {
  agents: readonly GlobalAgent[];
  models: readonly ModelOption[];
  onRefresh(): void;
  onStartConversation?(agentId: string): void;
  /** Opens the central Skill library from the binding empty state. */
  onManageSkills?(): void;
  /** Increment after the Skill catalog changes to reload the binding picker. */
  skillCatalogRevision?: number;
  /** Team roster — used to show which teams an agent belongs to. */
  teams?: readonly Team[];
  /** Full conversation list — used to list conversations assigned to an agent. */
  conversations?: readonly Conversation[];
  /** Workspaces — used to group the work tab by workspace and resolve names. */
  workspaces?: readonly WorkspaceSummary[];
  /** Leave this stage. The ability page's topbar carries the same back action. */
  onBack?(): void;
  /** Jump to the sibling Ability Center stage. */
  onGoToAbilities?(): void;
}

type DrawerTab = 'overview' | 'abilities' | 'settings';
type AbilitySubTab = 'skills' | 'mcp' | 'persona';
type LibraryView = 'grid' | 'list';
type ScopeFilter = 'all' | 'global' | 'workspace' | `workspace:${string}`;
type ScopeOption = { id: ScopeFilter; label: string };
type PolicyFilter = 'all' | 'read-only' | 'inherit';
type StatusFilter = 'all' | 'ok' | 'unavailable' | 'active';
type SortMode = 'recent' | 'name' | 'binding';

type DraftAgent = {
  name: string;
  avatar: string;
  description: string;
  persona: string;
  defaultModelId: string;
  fallbackModelIds: string[];
  skillIds: string[];
  mcpServerIds: string[];
  reasoningEffort: string;
  availabilityScope: 'global' | 'workspace';
  /** Whether this Agent may write when another conversation delegates to it. */
  writePolicy: AgentWritePolicy;
};

type SkillOption = {
  id: string;
  name: string;
  description: string;
  version: string;
};

type McpOption = {
  id: string;
  name: string;
  endpoint: string;
  toolCount: number;
  trusted: boolean;
};

const EMPTY_DRAFT: DraftAgent = {
  name: '',
  avatar: '🤖',
  description: '',
  persona: '',
  defaultModelId: '',
  fallbackModelIds: [],
  skillIds: [],
  mcpServerIds: [],
  reasoningEffort: 'auto',
  availabilityScope: 'global',
  // 新建智能体默认继承当前会话；逐次询问模式下运行时仍保持只读。
  writePolicy: 'inherit',
};

const REASONING_OPTIONS = [
  { value: 'auto', label: '自动', title: '自动（默认开启思考）' },
  { value: 'off', label: '关', title: '关闭' },
  { value: 'low', label: '低', title: '低' },
  { value: 'medium', label: '中', title: '中' },
  { value: 'high', label: '高', title: '高' },
] as const;

const AGENT_DRAWER_TABS: Array<{ id: DrawerTab; label: string }> = [
  { id: 'overview', label: '概览' },
  { id: 'abilities', label: '能力' },
  { id: 'settings', label: '设置' },
];

const SCOPE_OPTIONS: ScopeOption[] = [
  { id: 'all', label: '全部' },
  { id: 'global', label: '全局' },
  { id: 'workspace', label: '指定工作区' },
];

const POLICY_OPTIONS: Array<{ id: PolicyFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'read-only', label: '只读' },
  { id: 'inherit', label: '继承当前会话' },
];

// Short labels: the chips sit behind a 「状态」 label, and the full phrase
// 「模型不可用」 is the card badge's own wording — keeping them identical makes
// the filter and the badge indistinguishable in the DOM and to screen readers.
const STATUS_OPTIONS: Array<{ id: StatusFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'ok', label: '可用' },
  { id: 'unavailable', label: '不可用' },
  { id: 'active', label: '已激活工作区' },
];

const SORT_OPTIONS: Array<{ id: SortMode; label: string }> = [
  { id: 'recent', label: '按最近活跃' },
  { id: 'name', label: '按名称' },
  { id: 'binding', label: '按绑定能力数' },
];

function bridge() {
  return window.syncThink?.runtime;
}

function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function modelDisplayName(
  models: readonly ModelOption[],
  modelId: string,
  emptyLabel: string,
): string {
  if (!modelId) return emptyLabel;
  return models.find((model) => model.modelId === modelId)?.displayName ?? '模型不可用';
}

function ProviderMark({ model, size = 16 }: { model?: ModelOption; size?: number }) {
  if (!model) {
    return (
      <span className="agent-provider-mark agent-provider-mark--fallback" aria-hidden="true">
        ?
      </span>
    );
  }
  const brandLogo =
    (model.providerId ? resolveProviderBrandLogo(model.providerId) : undefined) ??
    resolveProviderBrandLogoByName(model.providerName);
  return (
    <span
      className={clsx('agent-provider-mark', brandLogo && 'agent-provider-mark--logo')}
      title={model.providerName}
      aria-label={brandLogo ? undefined : model.providerName}
      role={brandLogo ? undefined : 'img'}
    >
      {brandLogo ? (
        <BrandLogoMark logo={brandLogo} size={size} />
      ) : (
        model.providerName.trim().slice(0, 1).toLocaleUpperCase() || '?'
      )}
    </span>
  );
}

function updateAgentPayload(agent: GlobalAgent, overrides: Partial<GlobalAgent> = {}) {
  const next = { ...agent, ...overrides };
  return {
    agentId: next.id,
    name: next.name,
    avatar: next.avatar,
    description: next.description,
    persona: next.persona,
    defaultModelId: next.defaultModelId,
    fallbackModelIds: next.fallbackModelIds ?? [],
    skillIds: next.skillIds ?? [],
    mcpServerIds: next.mcpServerIds ?? [],
    reasoningEffort: next.reasoningEffort || 'auto',
    availabilityScope: next.availabilityScope ?? 'global',
    writePolicy: next.writePolicy ?? 'inherit',
  };
}

/**
 * Soft radial glow behind an avatar. Generated faces use their own color;
 * imported images and legacy text avatars fall back to the name-hash color so
 * every card gets a halo, never a bare edge.
 */
function avatarGlowStyle(avatar: string | undefined, name: string, id: string): CSSProperties {
  const face = resolveAvatarFace(avatar, id);
  const glow = isImageAvatar(avatar) ? avatarColor(name) : colorHex(face.color);
  return { ['--avatar-glow' as string]: glow } as CSSProperties;
}

export function AgentLibrary({
  agents,
  models,
  onRefresh,
  onStartConversation,
  onManageSkills,
  skillCatalogRevision = 0,
  teams = [],
  workspaces = [],
  onBack,
  onGoToAbilities,
}: Props) {
  const dialog = useDialog();
  const [selected, setSelected] = useState<GlobalAgent | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('overview');
  const [abilitySubTab, setAbilitySubTab] = useState<AbilitySubTab>('skills');
  const [abilityQuery, setAbilityQuery] = useState('');
  const [draft, setDraft] = useState<DraftAgent>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');
  const [libraryView, setLibraryView] = useState<LibraryView>('list');
  const [policyFilter, setPolicyFilter] = useState<PolicyFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [skills, setSkills] = useState<SkillOption[]>([]);
  const [mcpServers, setMcpServers] = useState<McpOption[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [skillCatalogError, setSkillCatalogError] = useState<string>();
  const nameRef = useRef<HTMLInputElement>(null);
  const avatarFileRef = useRef<HTMLInputElement>(null);
  // Two-level provider → model picker for the default model field.
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelAnchorEl, setModelAnchorEl] = useState<HTMLButtonElement | null>(null);
  const [workspaceActivations, setWorkspaceActivations] = useState<Record<string, boolean>>({});
  const [activationMenuAgentId, setActivationMenuAgentId] = useState<string | null>(null);
  const [activationSavingAgentIds, setActivationSavingAgentIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [fallbackPickerOpen, setFallbackPickerOpen] = useState(false);
  const [fallbackQuery, setFallbackQuery] = useState('');
  const [fallbackProvider, setFallbackProvider] = useState<string>('all');
  const fallbackSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleAvatarFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      try {
        const dataUrl = await readAvatarImage(file);
        setDraft((d) => ({ ...d, avatar: dataUrl }));
      } catch (error) {
        await dialog.alert({
          title: '导入头像失败',
          message: error instanceof Error ? error.message : '无法读取该图片',
        });
      }
    },
    [dialog],
  );

  const active = useMemo(() => agents.filter((agent) => !agent.archived), [agents]);

  const scopeOptions = useMemo<ScopeOption[]>(
    () => [
      SCOPE_OPTIONS[0],
      SCOPE_OPTIONS[1],
      ...(workspaces.length > 0
        ? workspaces.map((workspace) => ({
            id: `workspace:${workspace.workspaceId}` as ScopeFilter,
            label: workspace.name,
          }))
        : [SCOPE_OPTIONS[2]]),
    ],
    [workspaces],
  );

  const reloadWorkspaceActivations = useCallback(async () => {
    const api = bridge();
    if (!api?.listGlobalAgentWorkspaceActivations || workspaces.length === 0) return;
    const results = await Promise.all(
      workspaces.map(async (workspace) => {
        const response = await api.listGlobalAgentWorkspaceActivations({
          workspaceId: workspace.workspaceId,
        });
        return response.activations;
      }),
    );
    const next: Record<string, boolean> = {};
    for (const activations of results) {
      for (const activation of activations) {
        next[`${activation.agentId}:${activation.workspaceId}`] = activation.active;
      }
    }
    setWorkspaceActivations(next);
  }, [workspaces]);

  useEffect(() => {
    void reloadWorkspaceActivations();
  }, [reloadWorkspaceActivations]);

  // Current procedural face for the live preview — the stored seed when there is
  // one, otherwise the deterministic derivation the avatar view would fall back to.
  const avatarFace = useMemo(
    () => resolveAvatarFace(draft.avatar, selected?.id ?? draft.name),
    [draft.avatar, selected?.id, draft.name],
  );

  /**
   * Bulk-backfill seeds for every agent still on a text avatar. Imported images
   * are skipped, and agents that already carry a seed keep the face the user
   * picked — so this is safe to run more than once.
   */
  const handleRegenerateAllAvatars = useCallback(async () => {
    const api = bridge();
    if (!api) return;
    const targets = active.filter((agent) => !isImageAvatar(agent.avatar));
    if (targets.length === 0) {
      await dialog.alert({
        title: '无需生成',
        message: '所有智能体都已经有专属头像或已导入图片。',
      });
      return;
    }
    if (
      !(await dialog.confirm({
        title: '生成专属头像',
        message: `将为 ${targets.length} 个智能体生成专属头像。已导入图片的头像会保留，继续吗？`,
        confirmText: '生成',
      }))
    ) {
      return;
    }
    let failed = 0;
    for (const agent of targets) {
      const face = resolveAvatarFace(agent.avatar, String(agent.id));
      try {
        await api.updateGlobalAgent({
          agentId: agent.id,
          name: agent.name,
          avatar: avatarSeed(face.shape, face.color),
          description: agent.description,
          persona: agent.persona,
          defaultModelId: agent.defaultModelId,
          fallbackModelIds: agent.fallbackModelIds ?? [],
          skillIds: agent.skillIds ?? [],
          mcpServerIds: agent.mcpServerIds ?? [],
          reasoningEffort: agent.reasoningEffort || 'auto',
        });
      } catch {
        failed += 1;
      }
    }
    onRefresh();
    if (failed > 0) {
      await dialog.alert({
        title: '部分头像未生成',
        message: `${failed} 个智能体更新失败，其余已生成。`,
      });
    }
  }, [active, dialog, onRefresh]);

  const visibleAgents = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    const matches = active.filter((agent) => {
      if (scopeFilter === 'global' && (agent.availabilityScope ?? 'global') !== 'global') {
        return false;
      }
      if (scopeFilter === 'workspace' && (agent.availabilityScope ?? 'global') !== 'workspace') {
        return false;
      }
      if (scopeFilter.startsWith('workspace:')) {
        const workspaceId = scopeFilter.slice('workspace:'.length);
        const availableInWorkspace =
          (agent.availabilityScope ?? 'global') === 'global' ||
          workspaceActivations[`${agent.id}:${workspaceId}`] === true;
        if (!availableInWorkspace) return false;
      }
      if (policyFilter !== 'all' && (agent.writePolicy ?? 'inherit') !== policyFilter) return false;
      const modelName = models.find((model) => model.modelId === agent.defaultModelId)?.displayName;
      const modelOk = modelName !== undefined && modelName !== '模型不可用';
      const activated =
        (agent.availabilityScope ?? 'global') === 'global' ||
        workspaces.some(
          (workspace) => workspaceActivations[`${agent.id}:${workspace.workspaceId}`] === true,
        );
      if (statusFilter === 'ok' && !modelOk) return false;
      if (statusFilter === 'unavailable' && modelOk) return false;
      if (statusFilter === 'active' && !activated) return false;
      if (!query) return true;
      return [agent.name, agent.description, agent.persona, modelName]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLocaleLowerCase().includes(query));
    });
    if (sortMode === 'name') {
      return [...matches].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    }
    if (sortMode === 'binding') {
      return [...matches].sort(
        (a, b) =>
          b.skillIds.length + b.mcpServerIds.length - (a.skillIds.length + a.mcpServerIds.length),
      );
    }
    return [...matches].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  }, [
    active,
    models,
    policyFilter,
    scopeFilter,
    searchQuery,
    sortMode,
    statusFilter,
    workspaceActivations,
    workspaces,
  ]);

  const stats = useMemo(() => {
    const skillTotal = active.reduce((n, agent) => n + (agent.skillIds?.length ?? 0), 0);
    const mcpTotal = active.reduce((n, agent) => n + (agent.mcpServerIds?.length ?? 0), 0);
    const activatedWorkspaceTotal = active.reduce((total, agent) => {
      if ((agent.availabilityScope ?? 'global') === 'global') return total + workspaces.length;
      return (
        total +
        workspaces.filter(
          (workspace) => workspaceActivations[`${agent.id}:${workspace.workspaceId}`] === true,
        ).length
      );
    }, 0);
    const inheritCount = active.filter((a) => (a.writePolicy ?? 'inherit') === 'inherit').length;
    return {
      agentCount: active.length,
      skillTotal,
      mcpTotal,
      activatedWorkspaceTotal,
      inheritCount,
      inheritRatio: active.length === 0 ? 0 : Math.round((inheritCount / active.length) * 100),
    };
  }, [active, workspaceActivations, workspaces]);

  const policyCounts = useMemo(
    () => ({
      all: active.length,
      'read-only': active.filter((a) => a.writePolicy === 'read-only').length,
      inherit: active.filter((a) => (a.writePolicy ?? 'inherit') === 'inherit').length,
    }),
    [active],
  );

  const scopeCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: active.length,
      global: active.filter((agent) => (agent.availabilityScope ?? 'global') === 'global').length,
      workspace: active.filter((agent) => (agent.availabilityScope ?? 'global') === 'workspace')
        .length,
    };
    for (const workspace of workspaces) {
      counts[`workspace:${workspace.workspaceId}`] = active.filter(
        (agent) =>
          (agent.availabilityScope ?? 'global') === 'global' ||
          workspaceActivations[`${agent.id}:${workspace.workspaceId}`] === true,
      ).length;
    }
    return counts;
  }, [active, workspaceActivations, workspaces]);

  const statusCounts = useMemo(() => {
    const count = (predicate: (agent: GlobalAgent) => boolean) => active.filter(predicate).length;
    return {
      all: active.length,
      ok: count((a) => {
        const name = models.find((m) => m.modelId === a.defaultModelId)?.displayName;
        return name !== undefined && name !== '模型不可用';
      }),
      unavailable: count((a) => {
        const name = models.find((m) => m.modelId === a.defaultModelId)?.displayName;
        return name === undefined || name === '模型不可用';
      }),
      active: count(
        (a) =>
          (a.availabilityScope ?? 'global') === 'global' ||
          workspaces.some(
            (workspace) => workspaceActivations[`${a.id}:${workspace.workspaceId}`] === true,
          ),
      ),
    };
  }, [active, models, workspaceActivations, workspaces]);

  const sortLabel =
    SORT_OPTIONS.find((option) => option.id === sortMode)?.label ?? SORT_OPTIONS[0].label;

  // Reload when the central ability catalog changes or this library remounts.
  useEffect(() => {
    const api = bridge();
    if (!api) return;
    let cancelled = false;
    setCatalogLoading(true);
    setSkillCatalogError(undefined);
    void (async () => {
      try {
        const [skillResult, mcpResult] = await Promise.allSettled([
          loadSkillCatalog(api),
          loadMcpCatalog(api),
        ]);
        if (cancelled) return;
        if (skillResult.status === 'fulfilled') {
          const skillRows = (skillResult.value?.skills ?? []) as Array<{
            skillVersionId?: string;
            skillId?: string;
            name?: string;
            description?: string;
            version?: string;
          }>;
          // GlobalAgent.skillIds stores exact immutable SkillVersion ids.
          setSkills(
            skillRows
              .map((s) => ({
                id: String(s.skillVersionId || ''),
                name: String(s.name || s.skillId || '未命名 Skill'),
                description: String(s.description || ''),
                version: String(s.version || ''),
              }))
              .filter((s) => s.id),
          );
        } else {
          setSkills([]);
          setSkillCatalogError(
            skillResult.reason instanceof Error ? skillResult.reason.message : '加载 Skill 失败',
          );
        }
        if (mcpResult.status === 'fulfilled') {
          const mcpRows = (mcpResult.value?.servers ?? []) as Array<{
            mcpServerId?: string;
            name?: string;
            tools?: unknown[];
            trusted?: boolean;
            endpoint?: string;
          }>;
          setMcpServers(
            mcpRows
              .map((s) => ({
                id: String(s.mcpServerId || ''),
                name: String(s.name || s.mcpServerId || 'MCP'),
                endpoint: String(s.endpoint || ''),
                toolCount: Array.isArray(s.tools) ? s.tools.length : 0,
                trusted: s.trusted === true,
              }))
              .filter((s) => s.id),
          );
        } else {
          setMcpServers([]);
        }
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [skillCatalogRevision]);

  const openNew = useCallback(() => {
    setIsNew(true);
    setSelected(null);
    setDrawerTab('settings');
    setAbilitySubTab('skills');
    setAbilityQuery('');
    setDraft({ ...EMPTY_DRAFT, defaultModelId: models[0]?.modelId ?? '' });
    setTimeout(() => nameRef.current?.focus(), 50);
  }, [models]);

  const openEdit = useCallback((agent: GlobalAgent) => {
    setIsNew(false);
    setSelected(agent);
    setDrawerTab('overview');
    setAbilitySubTab('skills');
    setAbilityQuery('');
    setDraft({
      name: agent.name,
      avatar: agent.avatar,
      description: agent.description,
      persona: agent.persona,
      defaultModelId: agent.defaultModelId,
      fallbackModelIds: [...(agent.fallbackModelIds ?? [])],
      skillIds: [...(agent.skillIds ?? [])],
      mcpServerIds: [...(agent.mcpServerIds ?? [])],
      reasoningEffort: agent.reasoningEffort || 'auto',
      availabilityScope: agent.availabilityScope || 'global',
      writePolicy: agent.writePolicy === 'read-only' ? 'read-only' : 'inherit',
    });
    setTimeout(() => nameRef.current?.focus(), 50);
  }, []);

  const closeDialog = useCallback(() => {
    setSelected(null);
    setIsNew(false);
    setDrawerTab('overview');
    setAbilitySubTab('skills');
    setAbilityQuery('');
    setModelMenuOpen(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (!draft.name.trim()) return;
    if (!draft.defaultModelId.trim()) {
      await dialog.alert({
        title: '请选择默认模型',
        message: '智能体必须指定一个默认模型，不能保存为「不指定」。',
      });
      return;
    }
    const api = bridge();
    if (!api) return;
    setSaving(true);
    // Fallback chain must not include the primary default model.
    const fallbackModelIds = draft.fallbackModelIds.filter(
      (id) => id && id !== draft.defaultModelId,
    );
    const payload = {
      name: draft.name.trim(),
      avatar: draft.avatar,
      description: draft.description,
      persona: draft.persona,
      defaultModelId: draft.defaultModelId as ModelId,
      fallbackModelIds: fallbackModelIds.map((id) => id as ModelId),
      skillIds: draft.skillIds,
      mcpServerIds: draft.mcpServerIds,
      reasoningEffort: draft.reasoningEffort,
      availabilityScope: draft.availabilityScope,
      writePolicy: draft.writePolicy,
    };
    try {
      if (isNew) {
        await api.createGlobalAgent(payload);
      } else if (selected) {
        await api.updateGlobalAgent({
          agentId: selected.id,
          ...payload,
        });
      }
      onRefresh();
      closeDialog();
    } catch (error) {
      await dialog.alert({
        title: '保存失败',
        message: error instanceof Error ? error.message : '保存智能体失败',
      });
    } finally {
      setSaving(false);
    }
  }, [closeDialog, dialog, draft, isNew, onRefresh, selected]);

  const setAgentActivationSaving = useCallback((agentId: string, saving: boolean) => {
    setActivationSavingAgentIds((current) => {
      const next = new Set(current);
      if (saving) next.add(agentId);
      else next.delete(agentId);
      return next;
    });
  }, []);

  const handleAllWorkspaceActivation = useCallback(
    async (agent: GlobalAgent, activeInAllWorkspaces: boolean) => {
      const api = bridge();
      if (!api?.setGlobalAgentWorkspaceActivation || workspaces.length === 0) return;
      const agentId = String(agent.id);
      const previous = Object.fromEntries(
        workspaces.map((workspace) => [
          String(workspace.workspaceId),
          workspaceActivations[`${agentId}:${workspace.workspaceId}`] ?? false,
        ]),
      );
      setWorkspaceActivations((current) => {
        const next = { ...current };
        for (const workspace of workspaces) {
          next[`${agentId}:${workspace.workspaceId}`] = activeInAllWorkspaces;
        }
        return next;
      });
      setAgentActivationSaving(agentId, true);
      try {
        for (const workspace of workspaces) {
          await api.setGlobalAgentWorkspaceActivation({
            agentId: agent.id,
            workspaceId: workspace.workspaceId as import('@sync-think/shared').WorkspaceId,
            active: activeInAllWorkspaces,
          });
        }
        if (api.updateGlobalAgent) {
          await api.updateGlobalAgent(
            updateAgentPayload(agent, {
              availabilityScope: activeInAllWorkspaces ? 'global' : 'workspace',
            }),
          );
        }
        if (selected?.id === agent.id) {
          const nextScope = activeInAllWorkspaces ? 'global' : 'workspace';
          setSelected((current) =>
            current ? { ...current, availabilityScope: nextScope } : current,
          );
          setDraft((current) => ({ ...current, availabilityScope: nextScope }));
        }
        onRefresh();
      } catch (error) {
        setWorkspaceActivations((current) => {
          const next = { ...current };
          for (const workspace of workspaces) {
            next[`${agentId}:${workspace.workspaceId}`] =
              previous[String(workspace.workspaceId)] ?? false;
          }
          return next;
        });
        await dialog.alert({
          title: '更新工作区激活失败',
          message: error instanceof Error ? error.message : '无法更新工作区激活状态',
        });
      } finally {
        setAgentActivationSaving(agentId, false);
      }
    },
    [dialog, onRefresh, selected?.id, setAgentActivationSaving, workspaceActivations, workspaces],
  );

  const handleWorkspaceActivation = useCallback(
    async (agent: GlobalAgent, workspaceId: string, activeInWorkspace: boolean) => {
      const api = bridge();
      if (!api?.setGlobalAgentWorkspaceActivation) return;
      const agentId = String(agent.id);
      const key = `${agentId}:${workspaceId}`;
      const previous = workspaceActivations[key] ?? false;
      setWorkspaceActivations((current) => ({ ...current, [key]: activeInWorkspace }));
      setAgentActivationSaving(agentId, true);
      try {
        if ((agent.availabilityScope ?? 'global') === 'global') {
          if (!api.updateGlobalAgent) throw new Error('运行时未连接');
          await api.updateGlobalAgent(
            updateAgentPayload(agent, { availabilityScope: 'workspace' }),
          );
        }
        await api.setGlobalAgentWorkspaceActivation({
          agentId: agent.id,
          workspaceId: workspaceId as import('@sync-think/shared').WorkspaceId,
          active: activeInWorkspace,
        });
        if (selected?.id === agent.id) {
          setSelected((current) =>
            current ? { ...current, availabilityScope: 'workspace' } : current,
          );
          setDraft((current) => ({ ...current, availabilityScope: 'workspace' }));
        }
        onRefresh();
      } catch (error) {
        setWorkspaceActivations((current) => ({ ...current, [key]: previous }));
        await dialog.alert({
          title: '更新激活状态失败',
          message: error instanceof Error ? error.message : '无法更新工作区激活状态',
        });
      } finally {
        setAgentActivationSaving(agentId, false);
      }
    },
    [dialog, onRefresh, selected?.id, setAgentActivationSaving, workspaceActivations],
  );

  const handleDelete = useCallback(async () => {
    if (!selected) return;
    if (
      !(await dialog.confirm({
        title: '删除智能体',
        message: `确定删除智能体「${selected.name}」吗？若仍有对话引用它，将改为归档而非硬删除；若仍在小队中则无法删除。`,
        confirmText: '删除',
        danger: true,
      }))
    )
      return;
    const api = bridge();
    if (!api) return;
    setDeleting(true);
    try {
      // Runtime may hard-delete or soft-archive when conversations still reference
      // the agent. Soft-archive returns { archived, message } without throwing.
      const result = await api.deleteGlobalAgent({ agentId: selected.id });
      onRefresh();
      closeDialog();
      if (result && result.archived && result.message) {
        await dialog.alert({
          title: '已归档智能体',
          message: result.message,
        });
      }
    } catch (error) {
      const raw = error instanceof Error ? error.message : '删除智能体失败';
      const message = /member of team/i.test(raw)
        ? '该智能体仍在某个小队中，请先从小队移除后再删除。'
        : raw;
      await dialog.alert({
        title: '删除失败',
        message,
      });
    } finally {
      setDeleting(false);
    }
  }, [closeDialog, dialog, onRefresh, selected]);

  const dialogOpen = isNew || selected !== null;

  // Escape dismisses the topmost layer first. When the model picker is open,
  // keep the agent draft intact and only close that picker; a second Escape
  // closes the dialog itself. (Radix's dismissable-layer stack covers the same
  // ordering for real keyboard input; this handler keeps jsdom-driven Escapes
  // working too.)
  useEffect(() => {
    if (!dialogOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (modelMenuOpen) {
        setModelMenuOpen(false);
        return;
      }
      closeDialog();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeDialog, dialogOpen, modelMenuOpen]);

  // Clicking outside the create / sort menus dismisses them (the ability page's
  // own dropdowns behave the same way).
  useEffect(() => {
    if (!createMenuOpen && !sortMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof HTMLElement)) return;
      if (event.target.closest('.newmax-skill-create')) return;
      if (event.target.closest('.ability-hub__sort-wrap')) return;
      setCreateMenuOpen(false);
      setSortMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [createMenuOpen, sortMenuOpen]);

  const fallbackCandidates = models.filter((m) => m.modelId !== draft.defaultModelId);
  const selectedFallbackModels = draft.fallbackModelIds
    .map((id) => models.find((model) => model.modelId === id))
    .filter((model): model is ModelOption => Boolean(model));
  const fallbackProviders = useMemo(
    () =>
      [...new Set(fallbackCandidates.map((model) => model.providerName))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [fallbackCandidates],
  );
  const fallbackGroups = useMemo(() => {
    const query = fallbackQuery.trim().toLocaleLowerCase();
    const byProvider = new Map<string, ModelOption[]>();
    for (const model of fallbackCandidates) {
      if (draft.fallbackModelIds.includes(model.modelId)) continue;
      if (fallbackProvider !== 'all' && model.providerName !== fallbackProvider) continue;
      if (
        query &&
        ![model.displayName, model.providerName, model.modelId].some((value) =>
          value.toLocaleLowerCase().includes(query),
        )
      ) {
        continue;
      }
      const list = byProvider.get(model.providerName) ?? [];
      list.push(model);
      byProvider.set(model.providerName, list);
    }
    return [...byProvider.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [draft.fallbackModelIds, fallbackCandidates, fallbackProvider, fallbackQuery]);
  const defaultModel = models.find((model) => model.modelId === draft.defaultModelId);
  const defaultModelLabel = modelDisplayName(models, draft.defaultModelId, '请选择模型');
  const modelUnavailable = defaultModelLabel === '模型不可用';
  const filteredSkills = useMemo(() => {
    const query = abilityQuery.trim().toLocaleLowerCase();
    if (!query) return skills;
    return skills.filter((skill) =>
      [skill.name, skill.description, skill.version].some((value) =>
        value.toLocaleLowerCase().includes(query),
      ),
    );
  }, [abilityQuery, skills]);
  const filteredMcpServers = useMemo(() => {
    const query = abilityQuery.trim().toLocaleLowerCase();
    if (!query) return mcpServers;
    return mcpServers.filter((server) => server.name.toLocaleLowerCase().includes(query));
  }, [abilityQuery, mcpServers]);

  const openAbilitySubTab = useCallback((tab: AbilitySubTab) => {
    setAbilitySubTab(tab);
    setAbilityQuery('');
  }, []);

  // Teams this agent belongs to (overview tab, read-only).
  const memberTeams = useMemo(
    () => (selected ? teams.filter((t) => t.members.some((m) => m.agentId === selected.id)) : []),
    [selected, teams],
  );

  return (
    <main className="agent-hub ability-hub" data-testid="agent-library-page">
      {/* ── Topbar — same shape as the ability page: back · h1 · sibling link ── */}
      <header className="ability-hub__topbar">
        <div className="ability-hub__title-block">
          {onBack ? (
            <button
              type="button"
              className="ability-hub__back"
              aria-label="返回对话"
              title="返回对话"
              onClick={onBack}
            >
              <ArrowLeft size={17} />
            </button>
          ) : null}
          <h1>智能体库</h1>
          {onGoToAbilities ? (
            <button
              type="button"
              className="ability-hub__sibling-link"
              aria-label="能力中心"
              title="前往能力中心"
              onClick={onGoToAbilities}
            >
              <Sparkles size={14} aria-hidden="true" />
              <span>能力中心</span>
            </button>
          ) : null}
        </div>
        <div className="ability-hub__actions">
          <button
            type="button"
            className="ability-hub__ghost-action"
            title="为未生成头像的智能体批量生成专属头像"
            onClick={() => void handleRegenerateAllAvatars()}
          >
            <WandSparkles size={14} /> 生成专属头像
          </button>
          <div className="newmax-skill-create">
            <button
              type="button"
              className="ability-hub__create-action"
              aria-expanded={createMenuOpen}
              aria-haspopup="menu"
              onClick={() => {
                setCreateMenuOpen((open) => !open);
                setSortMenuOpen(false);
              }}
            >
              <Plus size={14} /> 新建智能体
              <ChevronDown size={13} />
            </button>
            {createMenuOpen ? (
              <div
                className="newmax-skill-create__menu"
                role="menu"
                data-testid="agent-create-menu"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setCreateMenuOpen(false);
                    openNew();
                  }}
                >
                  <Plus size={14} /> 新建空白智能体
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setCreateMenuOpen(false);
                    void handleRegenerateAllAvatars();
                  }}
                >
                  <WandSparkles size={14} /> 批量生成头像
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="ability-hub__body">
        {/* ── Stat strip — NewMaxStat cards + write-policy meter ─────────── */}
        <section className="ability-hub__stats" aria-label="智能体统计">
          <div className="ability-stat">
            <div>
              <strong>{stats.agentCount}</strong>
              <span>智能体总数</span>
            </div>
            <p>全局可用 + 指定工作区</p>
          </div>
          <div className="ability-stat">
            <div>
              <strong>{stats.skillTotal}</strong>
              <span>绑定 Skill</span>
            </div>
            <p>跨智能体累计</p>
          </div>
          <div className="ability-stat">
            <div>
              <strong>{stats.mcpTotal}</strong>
              <span>绑定 MCP</span>
            </div>
            <p>跨智能体累计</p>
          </div>
          <div className="ability-stat">
            <div>
              <strong>{stats.activatedWorkspaceTotal}</strong>
              <span>工作区激活</span>
            </div>
            <p>{workspaces.length} 个工作区 · 跨智能体累计</p>
          </div>
          <div
            className={clsx(
              'ability-stat ability-stat--context',
              stats.inheritRatio < 50 && 'is-warning',
            )}
            data-testid="agent-write-policy-stat"
          >
            <div>
              <span>委派写入策略</span>
              <strong>
                {stats.inheritCount} / {stats.agentCount} 继承会话
              </strong>
            </div>
            <span className="ability-stat__meter">
              <i style={{ width: `${stats.inheritRatio}%` }} />
            </span>
            <p>新建智能体默认继承当前会话的写入权限</p>
          </div>
        </section>

        {/* ── Scope row (scope chips + search / view switch) + filter row ── */}
        <div className="ability-hub__filter-stack">
          <div className="ability-hub__scope-row">
            <span className="ability-hub__filter-label">可用范围</span>
            <WorkspaceScopeRow
              label="范围筛选"
              fixedCount={workspaces.length > 0 ? 2 : 3}
              options={scopeOptions.map((option) => ({
                id: option.id,
                label: option.label,
                count: scopeCounts[option.id] ?? 0,
              }))}
              value={scopeFilter}
              onChange={(next) => setScopeFilter(next as ScopeFilter)}
            />
            <div className="ability-hub__controls-right">
              <label className="ability-hub__search">
                <Search size={14} aria-hidden="true" />
                <input
                  type="search"
                  aria-label="搜索智能体"
                  placeholder="搜索智能体"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
                {searchQuery ? (
                  <button
                    type="button"
                    aria-label="清除搜索"
                    title="清除搜索"
                    onClick={() => setSearchQuery('')}
                  >
                    <X size={12} />
                  </button>
                ) : null}
              </label>
              <div className="agent-view-switch" role="group" aria-label="显示方式">
                <button
                  type="button"
                  title="网格视图"
                  aria-label="网格视图"
                  aria-pressed={libraryView === 'grid'}
                  onClick={() => setLibraryView('grid')}
                >
                  <LayoutGrid size={14} />
                </button>
                <button
                  type="button"
                  title="列表视图"
                  aria-label="列表视图"
                  aria-pressed={libraryView === 'list'}
                  onClick={() => setLibraryView('list')}
                >
                  <ListIcon size={14} />
                </button>
              </div>
            </div>
          </div>
          <div className="ability-hub__filter-row">
            <span className="ability-hub__filter-label">写入策略</span>
            <SlidingTabs
              className="ability-hub__security-filter"
              rootRole="group"
              aria-label="写入策略筛选"
            >
              {POLICY_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={policyFilter === option.id}
                  onClick={() => setPolicyFilter(option.id)}
                >
                  {option.label}
                  <small>{policyCounts[option.id]}</small>
                </button>
              ))}
            </SlidingTabs>
            <span className="ability-hub__filter-label">状态</span>
            <SlidingTabs
              className="ability-hub__security-filter"
              rootRole="group"
              aria-label="状态筛选"
            >
              {STATUS_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={statusFilter === option.id}
                  onClick={() => setStatusFilter(option.id)}
                >
                  {option.label}
                  <small>{statusCounts[option.id]}</small>
                </button>
              ))}
            </SlidingTabs>
            <div className="ability-hub__sort-wrap">
              <button
                type="button"
                className="ability-hub__sort"
                aria-expanded={sortMenuOpen}
                aria-haspopup="menu"
                onClick={() => {
                  setSortMenuOpen((open) => !open);
                  setCreateMenuOpen(false);
                }}
              >
                {sortLabel}
                <ChevronDown size={12} />
              </button>
              {sortMenuOpen ? (
                <div className="ability-hub__sort-menu" role="menu" data-testid="agent-sort-menu">
                  {SORT_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={sortMode === option.id}
                      onClick={() => {
                        setSortMode(option.id);
                        setSortMenuOpen(false);
                      }}
                    >
                      {option.label}
                      {sortMode === option.id ? <Check size={13} /> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* ── Library: dense rows (list) or cards (grid) ─────────────────── */}
        <div className="agent-hub__scroll agent-hub__scroll--installed">
          {active.length === 0 ? (
            <EmptyAgents onNew={openNew} />
          ) : visibleAgents.length === 0 ? (
            <div className="agent-empty">
              <div className="agent-empty__glyph">
                <Search size={22} />
              </div>
              <p className="agent-empty__title">没有匹配的智能体</p>
              <p className="agent-empty__hint">换个关键词，或清除筛选条件</p>
              <button
                type="button"
                className="agent-btn"
                onClick={() => {
                  setSearchQuery('');
                  setScopeFilter('all');
                  setPolicyFilter('all');
                  setStatusFilter('all');
                }}
              >
                清除筛选
              </button>
            </div>
          ) : (
            <div className="agent-grid" data-view={libraryView} data-testid="agent-list">
              {libraryView === 'list' ? (
                <div className="agent-grid__header" role="row" aria-hidden={true}>
                  <span>智能体</span>
                  <span>使用模型</span>
                  <span>所在小队</span>
                  <span>激活的工作区</span>
                  <span>写入策略</span>
                  <span>操作</span>
                </div>
              ) : null}
              {visibleAgents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  models={models}
                  selected={selected?.id === agent.id}
                  onClick={() => openEdit(agent)}
                  onStartConversation={onStartConversation}
                  teams={teams}
                  workspaces={workspaces}
                  workspaceActivations={workspaceActivations}
                  activationMenuOpen={activationMenuAgentId === String(agent.id)}
                  activationSaving={activationSavingAgentIds.has(String(agent.id))}
                  onActivationMenuOpenChange={(nextOpen) =>
                    setActivationMenuAgentId(nextOpen ? String(agent.id) : null)
                  }
                  onWorkspaceToggle={(workspaceId, activeInWorkspace) =>
                    void handleWorkspaceActivation(agent, workspaceId, activeInWorkspace)
                  }
                  onAllWorkspaceToggle={(activeInAllWorkspaces) =>
                    void handleAllWorkspaceActivation(agent, activeInAllWorkspaces)
                  }
                  view={libraryView}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Detail dialog (centered overlay) ───────────────────────────── */}
      <Dialog.Root open={dialogOpen} onOpenChange={(open) => !open && closeDialog()}>
        {/*
         * Deliberately rendered without Dialog.Portal: this stage lives inside a
         * KeepAliveLayer that hides it with the `hidden` attribute (display:
         * none) when another stage is active. A body-level portal would remain
         * visible over the new stage; staying in the tree makes the dialog hide
         * together with the stage. Fixed positioning still escapes the shell's
         * overflow clip (no ancestor owns a transform/filter containing block)
         * and `.agent-hub` establishes no stacking context, so the dialog's
         * z-index keeps winning globally.
         */}
        <Dialog.Overlay className="agent-dialog-overlay" />
        <Dialog.Content
          className="agent-dialog"
          data-testid="agent-detail-drawer"
          aria-label={isNew ? '新建智能体' : `编辑智能体${draft.name ? ` · ${draft.name}` : ''}`}
        >
          {/* The Radix model picker portals to <body> with z-index auto, which
                would paint below this z-51 dialog. Radix popper mirrors the
                content's computed z-index onto its wrapper, so lift the menu
                panels above the dialog while it is open. */}
          <style>{'.shell-menu--model-providers,.shell-menu--model-flyout{z-index:60}'}</style>

          <header className="agent-dialog__header">
            <div className="agent-dialog__identity" data-testid="agent-identity-card">
              <span
                className="agent-dialog__avatar"
                style={avatarGlowStyle(draft.avatar, draft.name || '?', selected?.id ?? draft.name)}
              >
                <AgentAvatarView name={draft.name || '?'} avatar={draft.avatar} size={46} />
              </span>
              <div className="agent-dialog__text">
                <Dialog.Title className="agent-dialog__title">
                  {isNew ? '新建智能体' : draft.name || '未命名智能体'}
                </Dialog.Title>
                <Dialog.Description asChild>
                  <div className="agent-dialog__subtitle">
                    {isNew ? (
                      <span>填写基本信息与能力绑定后保存</span>
                    ) : (
                      <>
                        <span>
                          {defaultModelLabel === '请选择模型' ? '未设置模型' : defaultModelLabel}
                        </span>
                        <span className="agent-dialog__sep" aria-hidden="true">
                          ·
                        </span>
                        <span>
                          {memberTeams.length > 0
                            ? memberTeams.map((t) => t.name).join('、')
                            : '未加入小队'}
                        </span>
                      </>
                    )}
                  </div>
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="agent-icon-button" aria-label="关闭" title="关闭">
                <X size={17} />
              </button>
            </Dialog.Close>
          </header>

          {/* Tab row — sliding pill, same mechanism as the hub tabs */}
          <SlidingTabs className="agent-detail-tabs" aria-label="智能体详情">
            {AGENT_DRAWER_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={drawerTab === tab.id}
                data-testid={`agent-drawer-tab-${tab.id}`}
                onClick={() => setDrawerTab(tab.id)}
              >
                {tab.label}
                {tab.id === 'abilities' ? (
                  <span>{draft.skillIds.length + draft.mcpServerIds.length}</span>
                ) : null}
              </button>
            ))}
          </SlidingTabs>

          {/* ── 概览：只读基本信息 ── */}
          {drawerTab === 'overview' && (
            <OverlayScrollArea
              className="agent-dialog__body"
              innerClassName="agent-dialog__body-inner"
              fadeColor="var(--color-cap-surface)"
              dataTestId="agent-drawer-overview"
            >
              <div className="agent-pane">
                {draft.description ? (
                  <p className="agent-dialog__lede">{draft.description}</p>
                ) : (
                  <p className="agent-dialog__lede is-empty">暂无简介</p>
                )}
                <div className="agent-meta-grid">
                  <div className="agent-meta">
                    <span className="agent-meta__label">ID</span>
                    <AgentCopyChip value={selected?.id ? String(selected.id) : '-'} />
                  </div>
                  <div className="agent-meta">
                    <span className="agent-meta__label">所在小队</span>
                    {memberTeams.length > 0 ? (
                      <div className="agent-pill-row">
                        {memberTeams.map((t) => (
                          <span key={t.id} className="agent-pill">
                            <Users size={11} aria-hidden="true" /> {t.name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="agent-meta__empty">未加入小队</p>
                    )}
                  </div>
                  <div className="agent-meta">
                    <span className="agent-meta__label">使用模型</span>
                    <div className="agent-meta__model">
                      <span
                        className={clsx('agent-model-chip', modelUnavailable && 'is-unavailable')}
                      >
                        <ProviderMark model={defaultModel} size={15} />
                        <span>
                          {defaultModelLabel === '请选择模型' && !draft.defaultModelId
                            ? '未设置'
                            : defaultModelLabel}
                        </span>
                      </span>
                      <button
                        type="button"
                        data-testid="agent-overview-edit-model"
                        className="agent-text-link"
                        onClick={() => setDrawerTab('settings')}
                      >
                        修改
                      </button>
                    </div>
                  </div>
                  <div className="agent-meta">
                    <span className="agent-meta__label">Skill</span>
                    {draft.skillIds.length === 0 ? (
                      <button
                        type="button"
                        className="agent-text-link"
                        onClick={() => {
                          setDrawerTab('abilities');
                          openAbilitySubTab('skills');
                        }}
                      >
                        未绑定 · 去能力
                      </button>
                    ) : (
                      <div className="agent-pill-row">
                        {draft.skillIds.map((id) => {
                          const skill = skills.find((s) => s.id === id);
                          return (
                            <span key={id} className="agent-pill" title={skill?.description}>
                              {skill ? skill.name : id}
                              {skill?.version ? (
                                <span className="agent-pill__meta">@{skill.version}</span>
                              ) : null}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <div className="agent-meta__label" style={{ marginBottom: 6 }}>
                    系统 / 人设指令
                  </div>
                  <div className="agent-persona-card">{draft.persona || '—'}</div>
                </div>
              </div>
            </OverlayScrollArea>
          )}

          {/* ── 能力：子 tab 切换 Skill / MCP / 人设 ── */}
          {drawerTab === 'abilities' && (
            <OverlayScrollArea
              className="agent-dialog__body"
              innerClassName="agent-dialog__body-inner"
              fadeColor="var(--color-cap-surface)"
              dataTestId="agent-drawer-abilities"
            >
              <div className="agent-pane">
                <div className="agent-subtabs" role="group" aria-label="能力子分类">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={abilitySubTab === 'skills'}
                    data-testid="agent-ability-subtab-skills"
                    className={clsx('agent-subtab', abilitySubTab === 'skills' && 'is-active')}
                    onClick={() => openAbilitySubTab('skills')}
                  >
                    <Sparkles size={12} /> Skill
                    <span className="agent-subtab__count">{draft.skillIds.length}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={abilitySubTab === 'mcp'}
                    data-testid="agent-ability-subtab-mcp"
                    className={clsx('agent-subtab', abilitySubTab === 'mcp' && 'is-active')}
                    onClick={() => openAbilitySubTab('mcp')}
                  >
                    <Wrench size={12} /> MCP
                    <span className="agent-subtab__count">{draft.mcpServerIds.length}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={abilitySubTab === 'persona'}
                    data-testid="agent-ability-subtab-persona"
                    className={clsx('agent-subtab', abilitySubTab === 'persona' && 'is-active')}
                    onClick={() => openAbilitySubTab('persona')}
                  >
                    人设指令
                  </button>
                </div>

                <div data-testid="agent-ability-content">
                  {abilitySubTab === 'skills' && (
                    <div role="tabpanel">
                      {catalogLoading ? (
                        <p className="agent-meta__empty">加载中…</p>
                      ) : skillCatalogError ? (
                        <div className="agent-empty-state">
                          <p>Skill 加载失败：{skillCatalogError}</p>
                          {onManageSkills ? (
                            <button
                              type="button"
                              className="agent-capsule-btn"
                              onClick={onManageSkills}
                            >
                              打开能力中心
                            </button>
                          ) : null}
                        </div>
                      ) : skills.length === 0 ? (
                        <AgentEmptyState
                          actionLabel={onManageSkills ? '去能力中心' : undefined}
                          actionTestId="manage-skills-from-agent"
                          onAction={onManageSkills}
                        >
                          暂无已导入 Skill
                        </AgentEmptyState>
                      ) : (
                        <div className="agent-bind">
                          <label className="agent-bind-search">
                            <Search size={13} aria-hidden="true" />
                            <input
                              type="search"
                              aria-label="搜索 Skill"
                              placeholder="搜索 Skill"
                              value={abilityQuery}
                              onChange={(event) => setAbilityQuery(event.target.value)}
                            />
                            {abilityQuery ? (
                              <button
                                type="button"
                                className="agent-bind-search__clear"
                                aria-label="清除能力搜索"
                                onClick={() => setAbilityQuery('')}
                              >
                                <X size={12} />
                              </button>
                            ) : null}
                          </label>
                          <div className="agent-check-list agent-check-list--catalog">
                            {filteredSkills.length === 0 ? (
                              <p className="agent-meta__empty">没有匹配的 Skill</p>
                            ) : (
                              filteredSkills.map((s) => (
                                <AgentCheckRow
                                  key={s.id}
                                  checked={draft.skillIds.includes(s.id)}
                                  title={
                                    <>
                                      {s.name}
                                      {s.version ? (
                                        <span className="agent-pill__meta">@{s.version}</span>
                                      ) : null}
                                    </>
                                  }
                                  description={s.description || undefined}
                                  onToggle={() =>
                                    setDraft((d) => ({
                                      ...d,
                                      skillIds: toggleId(d.skillIds, s.id),
                                    }))
                                  }
                                />
                              ))
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {abilitySubTab === 'mcp' && (
                    <div role="tabpanel">
                      {mcpServers.length === 0 ? (
                        <AgentEmptyState
                          actionLabel={onManageSkills ? '去能力中心' : undefined}
                          onAction={onManageSkills}
                        >
                          暂无已注册 MCP 服务器。注册后可在此绑定，对话内可调用其工具。
                        </AgentEmptyState>
                      ) : (
                        <div className="agent-bind">
                          <label className="agent-bind-search">
                            <Search size={13} aria-hidden="true" />
                            <input
                              type="search"
                              aria-label="搜索 MCP"
                              placeholder="搜索 MCP"
                              value={abilityQuery}
                              onChange={(event) => setAbilityQuery(event.target.value)}
                            />
                            {abilityQuery ? (
                              <button
                                type="button"
                                className="agent-bind-search__clear"
                                aria-label="清除能力搜索"
                                onClick={() => setAbilityQuery('')}
                              >
                                <X size={12} />
                              </button>
                            ) : null}
                          </label>
                          <div className="agent-check-list agent-check-list--catalog">
                            {filteredMcpServers.length === 0 ? (
                              <p className="agent-meta__empty">没有匹配的 MCP</p>
                            ) : (
                              filteredMcpServers.map((s) => (
                                <AgentCheckRow
                                  key={s.id}
                                  checked={draft.mcpServerIds.includes(s.id)}
                                  title={s.name}
                                  leading={
                                    <McpIdentityMark
                                      name={s.name}
                                      endpoint={s.endpoint}
                                      size={20}
                                    />
                                  }
                                  description={`${s.toolCount} 工具${s.trusted ? ' · 信任' : ''}`}
                                  onToggle={() =>
                                    setDraft((d) => ({
                                      ...d,
                                      mcpServerIds: toggleId(d.mcpServerIds, s.id),
                                    }))
                                  }
                                />
                              ))
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {abilitySubTab === 'persona' && (
                    <div role="tabpanel">
                      <div className="agent-persona-editor-wrap">
                        <textarea
                          className="agent-persona-editor"
                          placeholder="你是一名经验丰富的前端工程师，专注于 React 和 TypeScript…"
                          value={draft.persona}
                          onChange={(e) => setDraft((d) => ({ ...d, persona: e.target.value }))}
                        />
                        <span className="agent-persona-count">{draft.persona.length} 字符</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </OverlayScrollArea>
          )}

          {/* ── 设置：单列分组卡片 —— 身份 / 模型 ── */}
          {drawerTab === 'settings' && (
            <OverlayScrollArea
              className="agent-dialog__body"
              innerClassName="agent-dialog__body-inner"
              fadeColor="var(--color-cap-surface)"
              dataTestId="agent-drawer-settings"
            >
              <div className="agent-pane">
                <div className="agent-settings-group">
                  <SectionTitle hint="头像、名称、简介与人设指令会一起进入每次对话的上下文。">
                    基本信息
                  </SectionTitle>

                  <div className="agent-avatar-editor">
                    <span
                      className="agent-dialog__avatar agent-dialog__avatar--lg"
                      style={avatarGlowStyle(
                        draft.avatar,
                        draft.name || '?',
                        selected?.id ?? draft.name,
                      )}
                    >
                      <AgentAvatarView name={draft.name || '?'} avatar={draft.avatar} size={56} />
                    </span>
                    <div className="agent-avatar-editor__main">
                      <label className="agent-meta__label">头像</label>
                      <div className="agent-avatar-editor__row">
                        {!isImageAvatar(draft.avatar) && (
                          <input
                            className="agent-emoji-input"
                            value={draft.avatar}
                            onChange={(e) => setDraft((d) => ({ ...d, avatar: e.target.value }))}
                            maxLength={2}
                            title="输入一个 emoji 或字母"
                            placeholder="🤖"
                          />
                        )}
                        <button
                          type="button"
                          className="agent-capsule-btn"
                          onClick={() => avatarFileRef.current?.click()}
                        >
                          <ImagePlus size={13} /> 导入图片
                        </button>
                        {isImageAvatar(draft.avatar) && (
                          <button
                            type="button"
                            className="agent-text-link"
                            onClick={() => setDraft((d) => ({ ...d, avatar: '🤖' }))}
                          >
                            恢复 emoji
                          </button>
                        )}
                        <input
                          ref={avatarFileRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            void handleAvatarFile(e.target.files?.[0]);
                            e.target.value = '';
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="agent-avatar-picker-block">
                    <div className="agent-avatar-picker-head">
                      <label className="agent-meta__label">专属头像</label>
                      <button
                        type="button"
                        className="agent-text-link"
                        onClick={() => void handleRegenerateAllAvatars()}
                      >
                        给全部智能体生成
                      </button>
                    </div>
                    <div className="avatar-picker">
                      {AVATAR_SHAPES.map((shape) => {
                        const isActiveShape = avatarFace.shape === shape;
                        return (
                          <button
                            key={shape}
                            type="button"
                            title={shape}
                            aria-label={`形状 ${shape}`}
                            aria-pressed={isActiveShape}
                            className={clsx('avatar-shape', isActiveShape && 'is-active')}
                            onClick={() =>
                              setDraft((d) => ({
                                ...d,
                                avatar: avatarSeed(shape, avatarFace.color),
                              }))
                            }
                          >
                            <img
                              src={avatarDataUrl(shape, avatarFace.color, 'idle', 24)}
                              alt=""
                              draggable={false}
                            />
                          </button>
                        );
                      })}
                    </div>
                    <div className="avatar-picker">
                      {AVATAR_COLORS.map((color) => {
                        const isActiveColor = avatarFace.color === color;
                        return (
                          <button
                            key={color}
                            type="button"
                            title={color}
                            aria-label={`颜色 ${color}`}
                            aria-pressed={isActiveColor}
                            className={clsx('avatar-swatch', isActiveColor && 'is-active')}
                            style={{ background: colorHex(color) }}
                            onClick={() =>
                              setDraft((d) => ({
                                ...d,
                                avatar: avatarSeed(avatarFace.shape, color),
                              }))
                            }
                          />
                        );
                      })}
                    </div>
                  </div>

                  <Field label="名称 *">
                    <input
                      ref={nameRef}
                      className="agent-input"
                      placeholder="前端小张"
                      value={draft.name}
                      onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    />
                  </Field>

                  <Field label="简介">
                    <input
                      className="agent-input"
                      placeholder="擅长前端开发与调试"
                      value={draft.description}
                      onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                    />
                  </Field>
                </div>

                <div className="agent-settings-group agent-settings-group--model">
                  <SectionTitle hint="主模型负责首轮执行；备用链按 1 → 2 → 3 的优先级依次接管。">
                    模型与推理
                  </SectionTitle>

                  <Field label="默认模型 *" onLabelClick={() => setModelMenuOpen((o) => !o)}>
                    <button
                      ref={setModelAnchorEl}
                      type="button"
                      className={clsx('agent-model-select', modelMenuOpen && 'is-open')}
                      aria-haspopup="menu"
                      aria-expanded={modelMenuOpen}
                      title="切换模型"
                      onClick={() => setModelMenuOpen((open) => !open)}
                    >
                      <ProviderMark model={defaultModel} size={19} />
                      <span className="agent-model-select__copy">
                        <small>{defaultModel?.providerName ?? '选择供应商'}</small>
                        <strong>{defaultModelLabel}</strong>
                      </span>
                      <ChevronDown size={14} aria-hidden="true" />
                    </button>
                    <ModelPickerMenu
                      open={modelMenuOpen}
                      models={models}
                      selectedModelId={draft.defaultModelId}
                      defaultLabel="请选择模型"
                      anchorEl={modelAnchorEl}
                      onClose={() => setModelMenuOpen(false)}
                      onPick={(modelId) => {
                        setDraft((d) => ({
                          ...d,
                          defaultModelId: modelId,
                          fallbackModelIds: d.fallbackModelIds.filter((id) => id !== modelId),
                        }));
                      }}
                    />
                  </Field>

                  <Field label="备用模型优先级">
                    <div className="agent-fallback-chain" data-testid="agent-fallback-chain">
                      {selectedFallbackModels.length === 0 ? (
                        <div className="agent-fallback-empty">
                          <span>尚未设置备用模型</span>
                          <small>主模型不可用时任务会暂停。</small>
                        </div>
                      ) : (
                        <DndContext
                          sensors={fallbackSensors}
                          collisionDetection={closestCenter}
                          onDragEnd={(event: DragEndEvent) => {
                            const activeId = String(event.active.id);
                            const overId = event.over ? String(event.over.id) : null;
                            if (!overId || activeId === overId) return;
                            setDraft((current) => {
                              const oldIndex = current.fallbackModelIds.indexOf(activeId);
                              const newIndex = current.fallbackModelIds.indexOf(overId);
                              if (oldIndex < 0 || newIndex < 0) return current;
                              return {
                                ...current,
                                fallbackModelIds: arrayMove(
                                  current.fallbackModelIds,
                                  oldIndex,
                                  newIndex,
                                ),
                              };
                            });
                          }}
                        >
                          <SortableContext
                            items={selectedFallbackModels.map((model) => model.modelId)}
                            strategy={verticalListSortingStrategy}
                          >
                            <div className="agent-fallback-chain__list">
                              {selectedFallbackModels.map((model, index) => (
                                <SortableFallbackRow
                                  key={model.modelId}
                                  model={model}
                                  index={index}
                                  onRemove={() =>
                                    setDraft((current) => ({
                                      ...current,
                                      fallbackModelIds: current.fallbackModelIds.filter(
                                        (id) => id !== model.modelId,
                                      ),
                                    }))
                                  }
                                />
                              ))}
                            </div>
                          </SortableContext>
                        </DndContext>
                      )}
                    </div>
                    {fallbackCandidates.length > 0 ? (
                      <button
                        type="button"
                        className="agent-add-fallback"
                        aria-expanded={fallbackPickerOpen}
                        onClick={() => setFallbackPickerOpen((open) => !open)}
                      >
                        <Plus size={13} />
                        {fallbackPickerOpen ? '收起模型库' : '添加备用模型'}
                      </button>
                    ) : (
                      <p className="agent-meta__empty">请先在模型设置中添加其它模型。</p>
                    )}
                    {fallbackPickerOpen ? (
                      <div className="agent-fallback-picker">
                        <label className="agent-bind-search">
                          <Search size={13} aria-hidden="true" />
                          <input
                            type="search"
                            aria-label="搜索备用模型"
                            placeholder="搜索模型或供应商"
                            value={fallbackQuery}
                            onChange={(event) => setFallbackQuery(event.target.value)}
                          />
                          {fallbackQuery ? (
                            <button
                              type="button"
                              className="agent-bind-search__clear"
                              aria-label="清除备用模型搜索"
                              onClick={() => setFallbackQuery('')}
                            >
                              <X size={12} />
                            </button>
                          ) : null}
                        </label>
                        <div className="agent-provider-filter" role="tablist" aria-label="供应商">
                          <button
                            type="button"
                            role="tab"
                            aria-selected={fallbackProvider === 'all'}
                            className={fallbackProvider === 'all' ? 'is-active' : undefined}
                            onClick={() => setFallbackProvider('all')}
                          >
                            全部
                          </button>
                          {fallbackProviders.map((provider) => (
                            <button
                              key={provider}
                              type="button"
                              role="tab"
                              aria-selected={fallbackProvider === provider}
                              className={fallbackProvider === provider ? 'is-active' : undefined}
                              onClick={() => setFallbackProvider(provider)}
                            >
                              {provider}
                            </button>
                          ))}
                        </div>
                        <div className="agent-fallback-catalog">
                          {fallbackGroups.length === 0 ? (
                            <p className="agent-meta__empty">没有匹配的可选模型</p>
                          ) : (
                            fallbackGroups.map(([providerName, providerModels]) => (
                              <div key={providerName} className="agent-fallback-catalog__group">
                                <span>{providerName}</span>
                                {providerModels.map((model) => (
                                  <button
                                    key={model.modelId}
                                    type="button"
                                    onClick={() =>
                                      setDraft((current) => ({
                                        ...current,
                                        fallbackModelIds: [
                                          ...current.fallbackModelIds,
                                          model.modelId,
                                        ],
                                      }))
                                    }
                                  >
                                    <ProviderMark model={model} size={16} />
                                    <span>{model.displayName}</span>
                                    <Plus size={13} />
                                  </button>
                                ))}
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    ) : null}
                  </Field>

                  <Field label="推理强度">
                    <div className="agent-reasoning-grid" role="group" aria-label="推理强度">
                      {REASONING_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          aria-label={option.label}
                          aria-pressed={draft.reasoningEffort === option.value}
                          className={
                            draft.reasoningEffort === option.value ? 'is-active' : undefined
                          }
                          title={option.title}
                          onClick={() =>
                            setDraft((current) => ({
                              ...current,
                              reasoningEffort: option.value,
                            }))
                          }
                        >
                          <Brain size={13} aria-hidden="true" />
                          <span>{option.label}</span>
                        </button>
                      ))}
                    </div>
                  </Field>
                </div>

                <div className="agent-settings-group">
                  <SectionTitle hint="仅影响这个智能体作为子任务被委派时的写入权限。">
                    委派写入
                  </SectionTitle>
                  <div className="agent-policy-cards" role="group" aria-label="委派写入权限">
                    <button
                      type="button"
                      aria-pressed={draft.writePolicy === 'inherit'}
                      className={draft.writePolicy === 'inherit' ? 'is-active' : undefined}
                      onClick={() =>
                        setDraft((current) => ({ ...current, writePolicy: 'inherit' }))
                      }
                    >
                      <span className="agent-policy-cards__icon">
                        <ShieldCheck size={16} />
                      </span>
                      <span>
                        <strong>继承当前会话</strong>
                        <small>跟随发起对话的权限；逐次询问模式下仍保持只读。</small>
                      </span>
                      <span className="agent-policy-cards__radio" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-pressed={draft.writePolicy === 'read-only'}
                      className={draft.writePolicy === 'read-only' ? 'is-active' : undefined}
                      onClick={() =>
                        setDraft((current) => ({ ...current, writePolicy: 'read-only' }))
                      }
                    >
                      <span className="agent-policy-cards__icon">
                        <Lock size={16} />
                      </span>
                      <span>
                        <strong>始终只读</strong>
                        <small>仅允许读取与分析，不执行命令或修改文件。</small>
                      </span>
                      <span className="agent-policy-cards__radio" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>
            </OverlayScrollArea>
          )}

          {/* Footer actions */}
          <footer className="agent-dialog__footer">
            {!isNew ? (
              <button
                type="button"
                className="agent-dialog__danger"
                onClick={() => void handleDelete()}
                disabled={deleting}
              >
                <Trash2 size={13} /> 删除
              </button>
            ) : (
              <span />
            )}
            <div className="agent-dialog__footer-right">
              <Dialog.Close asChild>
                <button type="button" className="agent-btn">
                  取消
                </button>
              </Dialog.Close>
              <button
                type="button"
                className="agent-btn agent-btn--primary"
                onClick={() => void handleSave()}
                disabled={saving || !draft.name.trim() || !draft.defaultModelId.trim()}
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Root>
    </main>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

/**
 * 区块头，对齐能力弹窗的 section-head：一行标题（12px/680）+ 一行说明
 * （11px faint）。以前只有标题、而且被压成 10px 带字距的小字，中文看起来
 * 又小又散，也不解释这一组字段是干什么的。
 */
function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="agent-section-head">
      <div className="agent-section-title">{children}</div>
      {hint ? <p className="agent-section-hint">{hint}</p> : null}
    </div>
  );
}

function AgentCard({
  agent,
  models,
  selected,
  onClick,
  onStartConversation,
  teams = [],
  workspaces = [],
  workspaceActivations,
  activationMenuOpen,
  activationSaving,
  onActivationMenuOpenChange,
  onWorkspaceToggle,
  onAllWorkspaceToggle,
  view = 'list',
}: {
  agent: GlobalAgent;
  models: readonly ModelOption[];
  selected: boolean;
  onClick(): void;
  onStartConversation?: (agentId: string) => void;
  teams?: readonly Team[];
  workspaces?: readonly WorkspaceSummary[];
  workspaceActivations: Readonly<Record<string, boolean>>;
  activationMenuOpen: boolean;
  activationSaving: boolean;
  onActivationMenuOpenChange(open: boolean): void;
  onWorkspaceToggle(workspaceId: string, active: boolean): void;
  onAllWorkspaceToggle(active: boolean): void;
  /** Only one layout is mounted: two would double every query and the a11y tree. */
  view?: LibraryView;
}) {
  const modelName = modelDisplayName(models, agent.defaultModelId, '未指定模型');
  const model = models.find((candidate) => candidate.modelId === agent.defaultModelId);
  const skillN = agent.skillIds?.length ?? 0;
  const mcpN = agent.mcpServerIds?.length ?? 0;
  const fallbackN = agent.fallbackModelIds?.length ?? 0;
  const modelMissing = modelName === '模型不可用';
  const modelLabel = !agent.defaultModelId ? '未指定模型' : modelName;
  const policy = agent.writePolicy ?? 'inherit';
  const teamNames = teams
    .filter((t) => t.members.some((m) => m.agentId === agent.id))
    .map((t) => t.name)
    .join('、');
  const scope = agent.availabilityScope ?? 'global';
  const activeWorkspaces = workspaces.filter(
    (workspace) => workspaceActivations[`${agent.id}:${workspace.workspaceId}`] === true,
  );
  const activationLabel =
    scope === 'global'
      ? '全部工作区'
      : activeWorkspaces.length === 0
        ? '未激活'
        : activeWorkspaces.length === 1
          ? activeWorkspaces[0].name
          : `${activeWorkspaces[0].name} +${activeWorkspaces.length - 1}`;

  return (
    <div
      className={clsx('agent-card group', selected && 'agent-card--selected')}
      role="button"
      tabIndex={0}
      aria-label={`查看 ${agent.name} 详情`}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
    >
      {view === 'list' ? (
        <div className="agent-card__row">
          <span className="agent-card__identity">
            <span
              className="agent-card__avatar"
              style={avatarGlowStyle(agent.avatar, agent.name, String(agent.id))}
            >
              <AgentAvatarView name={agent.name} avatar={agent.avatar} size={38} />
            </span>
            <span className="agent-card__copy">
              <span className="agent-card__title-row">
                <span className="agent-card__name">{agent.name}</span>
              </span>
              <span
                className="agent-card__description"
                data-empty={agent.description ? undefined : '1'}
              >
                {agent.description || '暂无简介'}
              </span>
            </span>
          </span>
          <span
            className={clsx('agent-card__model-cell', modelMissing && 'is-unavailable')}
            title={modelMissing ? '已配置模型当前不可用，请进入设置重新选择' : model?.providerName}
          >
            <ProviderMark model={model} size={16} />
            <span>{modelLabel}</span>
          </span>
          <span className="agent-card__team">{teamNames || '未加入小队'}</span>
          <AgentWorkspacePicker
            agent={agent}
            workspaces={workspaces}
            workspaceActivations={workspaceActivations}
            label={activationLabel}
            open={activationMenuOpen}
            saving={activationSaving}
            onOpenChange={onActivationMenuOpenChange}
            onWorkspaceToggle={onWorkspaceToggle}
            onAllWorkspaceToggle={onAllWorkspaceToggle}
          />
          <span>
            <span
              className={clsx(
                'agent-card__policy',
                policy === 'inherit' && 'agent-card__policy--inherit',
              )}
            >
              {policy === 'inherit' ? <ShieldCheck size={11} /> : <Lock size={11} />}
              <span>{policy === 'inherit' ? '继承当前会话' : '只读'}</span>
            </span>
          </span>
          <div className="agent-card__row-actions">
            {onStartConversation ? (
              <button
                type="button"
                className="agent-card__row-action agent-card__row-action--primary"
                title="开始对话"
                aria-label={`与 ${agent.name} 开始对话`}
                onClick={(event) => {
                  event.stopPropagation();
                  onStartConversation(agent.id);
                }}
              >
                <Play size={13} />
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <div className="agent-card__main">
            <span
              className="agent-card__avatar"
              style={avatarGlowStyle(agent.avatar, agent.name, String(agent.id))}
            >
              <AgentAvatarView name={agent.name} avatar={agent.avatar} size={56} />
            </span>
            <div className="agent-card__copy">
              <div className="agent-card__title-row">
                <span className="agent-card__name">{agent.name}</span>
                <ChevronRight size={14} className="agent-card__chevron" aria-hidden="true" />
              </div>
              <span
                className={clsx('agent-model-chip', modelMissing && 'is-unavailable')}
                title={modelMissing ? '已配置模型当前不可用，请进入设置重新选择' : modelLabel}
              >
                <ProviderMark model={model} size={15} />
                <span>{modelLabel}</span>
              </span>
              <p
                className="agent-card__description"
                data-empty={agent.description ? undefined : '1'}
              >
                {agent.description || '暂无简介'}
              </p>
            </div>
          </div>
          <footer className="agent-card__footer">
            <div className="agent-card__badges">
              <span className="agent-badge is-accent">
                <Sparkles size={10} aria-hidden="true" /> Skill {skillN}
              </span>
              <span className="agent-badge">
                <Wrench size={10} aria-hidden="true" /> MCP {mcpN}
              </span>
              {fallbackN > 0 ? <span className="agent-badge">备用 {fallbackN}</span> : null}
              <AgentWorkspacePicker
                agent={agent}
                workspaces={workspaces}
                workspaceActivations={workspaceActivations}
                label={activationLabel}
                open={activationMenuOpen}
                saving={activationSaving}
                onOpenChange={onActivationMenuOpenChange}
                onWorkspaceToggle={onWorkspaceToggle}
                onAllWorkspaceToggle={onAllWorkspaceToggle}
                compact
              />
            </div>
            {onStartConversation ? (
              <button
                type="button"
                className="agent-card__action"
                onClick={(event) => {
                  event.stopPropagation();
                  onStartConversation(agent.id);
                }}
              >
                <MessageSquare size={11} aria-hidden="true" /> 开始对话
              </button>
            ) : null}
          </footer>
        </>
      )}
    </div>
  );
}

function AgentWorkspacePicker({
  agent,
  workspaces,
  workspaceActivations,
  label,
  open,
  saving,
  onOpenChange,
  onWorkspaceToggle,
  onAllWorkspaceToggle,
  compact = false,
}: {
  agent: GlobalAgent;
  workspaces: readonly WorkspaceSummary[];
  workspaceActivations: Readonly<Record<string, boolean>>;
  label: string;
  open: boolean;
  saving: boolean;
  onOpenChange(open: boolean): void;
  onWorkspaceToggle(workspaceId: string, active: boolean): void;
  onAllWorkspaceToggle(active: boolean): void;
  compact?: boolean;
}) {
  const global = (agent.availabilityScope ?? 'global') === 'global';
  const allWorkspacesActive =
    global ||
    (workspaces.length > 0 &&
      workspaces.every(
        (workspace) => workspaceActivations[`${agent.id}:${workspace.workspaceId}`] === true,
      ));
  return (
    <div
      className={clsx('agent-workspace-picker', compact && 'is-compact')}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <DropdownMenu.Root open={open} onOpenChange={onOpenChange} modal={false}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className={clsx(
              'capability-workspace-activation',
              open && 'is-active',
              saving && 'is-busy',
            )}
            aria-label={`配置 ${agent.name} 的激活工作区`}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-busy={saving || undefined}
            onClick={() => {
              // Radix opens this during pointer interaction. The explicit branch
              // keeps keyboard/jsdom click activation deterministic without
              // turning a close click back into an open one.
              if (!open) onOpenChange(true);
            }}
          >
            <span className="capability-workspace-activation__label">{label}</span>
            <ChevronDown size={12} aria-hidden="true" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="skill-workspace-menu"
            align="start"
            side="bottom"
            sideOffset={4}
            collisionPadding={12}
            aria-label="激活到工作区"
          >
            <DropdownMenu.Label className="skill-workspace-menu__title">
              激活到工作区
            </DropdownMenu.Label>
            <button
              type="button"
              className="skill-workspace-menu__row"
              aria-pressed={allWorkspacesActive}
              aria-label="激活全部工作区"
              disabled={saving || workspaces.length === 0}
              onClick={() => {
                onAllWorkspaceToggle(!allWorkspacesActive);
              }}
            >
              <span>全局</span>
              <span
                className="skill-workspace-menu__switch"
                data-checked={allWorkspacesActive ? '1' : '0'}
                aria-hidden="true"
              >
                <i />
              </span>
            </button>
            <DropdownMenu.Separator className="skill-workspace-menu__separator" />
            <div
              className="skill-workspace-menu__list"
              data-testid={`agent-workspace-menu-${agent.id}`}
            >
              {workspaces.length === 0 ? (
                <p className="agent-workspace-menu__empty">当前没有工作区</p>
              ) : (
                workspaces.map((workspace) => {
                  const active =
                    global || workspaceActivations[`${agent.id}:${workspace.workspaceId}`] === true;
                  return (
                    <button
                      key={workspace.workspaceId}
                      type="button"
                      className="skill-workspace-menu__row"
                      aria-pressed={active}
                      aria-label={`${workspace.name} 工作区`}
                      disabled={saving}
                      onClick={() => onWorkspaceToggle(String(workspace.workspaceId), !active)}
                    >
                      <span>{workspace.name}</span>
                      <span
                        className="skill-workspace-menu__switch"
                        data-checked={active ? '1' : '0'}
                        aria-hidden="true"
                      >
                        <i />
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            <DropdownMenu.Separator className="skill-workspace-menu__separator" />
            <button
              type="button"
              className="skill-workspace-menu__done"
              onClick={() => onOpenChange(false)}
            >
              完成
            </button>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

function EmptyAgents({ onNew }: { onNew(): void }) {
  return (
    <div className="agent-empty">
      <div className="agent-empty__glyph">
        <Bot size={24} />
      </div>
      <div>
        <p className="agent-empty__title">还没有智能体</p>
        <p className="agent-empty__hint">创建一个专属于你的 AI 助手</p>
      </div>
      <button type="button" className="agent-btn agent-btn--primary" onClick={onNew}>
        <Plus size={13} /> 新建第一个智能体
      </button>
    </div>
  );
}

function Field({
  label,
  children,
  onLabelClick,
}: {
  label: string;
  children: React.ReactNode;
  /** Make the label clickable (e.g. open the model picker when the label is pressed). */
  onLabelClick?: () => void;
}) {
  return (
    <div className="agent-field">
      <label
        className="agent-field__label"
        onClick={onLabelClick}
        style={onLabelClick ? { cursor: 'pointer' } : undefined}
        title={onLabelClick ? '点击打开选择器' : undefined}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function AgentCopyChip({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copyable = Boolean(value) && value !== '-';
  return (
    <button
      type="button"
      className="agent-id-chip"
      aria-label={copied ? '已复制 ID' : '复制 ID'}
      title={copied ? '已复制' : '复制 ID'}
      disabled={!copyable}
      onClick={() => {
        if (!copyable) return;
        void (async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          } catch {
            /* ignore missing clipboard in tests / restricted contexts */
          }
        })();
      }}
    >
      <span className="agent-id-chip__value">{value}</span>
      {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
    </button>
  );
}

function AgentEmptyState({
  children,
  actionLabel,
  actionTestId,
  onAction,
}: {
  children: React.ReactNode;
  actionLabel?: string;
  actionTestId?: string;
  onAction?: () => void;
}) {
  return (
    <div className="agent-empty-state">
      <p>{children}</p>
      {onAction && actionLabel ? (
        <button
          type="button"
          data-testid={actionTestId}
          className="agent-capsule-btn"
          onClick={onAction}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function SortableFallbackRow({
  model,
  index,
  onRemove,
}: {
  model: ModelOption;
  index: number;
  onRemove(): void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: model.modelId,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 2 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      className={clsx('agent-fallback-row', isDragging && 'is-dragging')}
      style={style}
    >
      <button
        type="button"
        className="agent-fallback-row__grip"
        aria-label={`拖拽 ${model.displayName} 调整优先级`}
        title="拖拽调整优先级"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} aria-hidden="true" />
      </button>
      <span className="agent-fallback-row__priority">{index + 1}</span>
      <ProviderMark model={model} size={18} />
      <span className="agent-fallback-row__copy">
        <strong>{model.displayName}</strong>
        <small>{model.providerName}</small>
      </span>
      <span className="agent-fallback-row__actions">
        <button type="button" aria-label={`移除备用模型 ${model.displayName}`} onClick={onRemove}>
          <X size={13} aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}

function AgentCheckRow({
  checked,
  title,
  description,
  leading,
  disabled = false,
  onToggle,
}: {
  checked: boolean;
  title: React.ReactNode;
  description?: string;
  leading?: React.ReactNode;
  disabled?: boolean;
  onToggle(): void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-disabled={disabled}
      disabled={disabled}
      className={clsx('agent-check-row', checked && 'is-checked')}
      title={description}
      onClick={onToggle}
    >
      <span className="agent-check-row__box" aria-hidden="true">
        {checked ? <Check size={11} strokeWidth={3} /> : null}
      </span>
      {leading ? <span className="agent-check-row__identity">{leading}</span> : null}
      <span className="agent-check-row__copy">
        <span className="agent-check-row__name">{title}</span>
        {description ? <span className="agent-check-row__desc">{description}</span> : null}
      </span>
    </button>
  );
}
