// P2 · Global Agent Library
// Redesigned as a hub workbench that shares the Ability Center's visual
// language: branded topbar, segmented scope filter, a stat strip and a
// card grid, with details in a centered overlay dialog (概览 / 工作 /
// 能力 / 设置) instead of the old right-hand drawer.
import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowUpRight,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Folder,
  ImagePlus,
  LayoutGrid,
  List as ListIcon,
  MessageSquare,
  Plus,
  Plug,
  Search,
  Sparkles,
  Trash2,
  Users,
  WandSparkles,
  Wrench,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
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
import { ModelPickerMenu, ModelTrigger } from './compose-toolbar.js';

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
  /** Focus/open an existing conversation by id. */
  onOpenConversation?(conversationId: string): void;
}

type DrawerTab = 'overview' | 'work' | 'abilities' | 'settings';
type AbilitySubTab = 'skills' | 'mcp' | 'persona';
type LibraryView = 'grid' | 'list';
type ScopeFilter = 'all' | 'global' | 'workspace';

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
  // 默认只读：委派出去的子智能体无人值守，写入没有审批入口。
  writePolicy: 'read-only',
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
  { id: 'work', label: '工作' },
  { id: 'abilities', label: '能力' },
  { id: 'settings', label: '设置' },
];

const SCOPE_OPTIONS: Array<{ id: ScopeFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'global', label: '全局可用' },
  { id: 'workspace', label: '指定工作区' },
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

/**
 * Soft radial glow behind an avatar. Generated faces use their own color;
 * imported images and legacy text avatars fall back to the name-hash color so
 * every card gets a halo, never a bare edge.
 */
function avatarGlowStyle(
  avatar: string | undefined,
  name: string,
  id: string,
): CSSProperties {
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
  conversations = [],
  workspaces = [],
  onOpenConversation,
}: Props) {
  const dialog = useDialog();
  const [selected, setSelected] = useState<GlobalAgent | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('overview');
  const [abilitySubTab, setAbilitySubTab] = useState<AbilitySubTab>('skills');
  const [abilityQuery, setAbilityQuery] = useState('');
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(() => new Set());
  const [draft, setDraft] = useState<DraftAgent>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');
  const [libraryView, setLibraryView] = useState<LibraryView>('grid');
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
  const [activationSaving, setActivationSaving] = useState(false);

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
    return active.filter((agent) => {
      if (scopeFilter !== 'all' && (agent.availabilityScope ?? 'global') !== scopeFilter)
        return false;
      if (!query) return true;
      const modelName = models.find((model) => model.modelId === agent.defaultModelId)?.displayName;
      return [agent.name, agent.description, agent.persona, modelName]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLocaleLowerCase().includes(query));
    });
  }, [active, models, scopeFilter, searchQuery]);

  const stats = useMemo(() => {
    const skillTotal = active.reduce((n, agent) => n + (agent.skillIds?.length ?? 0), 0);
    const mcpTotal = active.reduce((n, agent) => n + (agent.mcpServerIds?.length ?? 0), 0);
    const conversationTotal = conversations.filter(
      (conversation) => conversation.track === 'agent' && !conversation.archivedAt,
    ).length;
    return { agentCount: active.length, skillTotal, mcpTotal, conversationTotal };
  }, [active, conversations]);

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
          api.listSkills?.({ limit: 500 }),
          api.listMcpServers?.({ limit: 100 }),
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
          }>;
          setMcpServers(
            mcpRows
              .map((s) => ({
                id: String(s.mcpServerId || ''),
                name: String(s.name || s.mcpServerId || 'MCP'),
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
      writePolicy: agent.writePolicy === 'inherit' ? 'inherit' : 'read-only',
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

  const handleWorkspaceActivation = useCallback(
    async (workspaceId: string, active: boolean) => {
      if (!selected) return;
      const key = `${selected.id}:${workspaceId}`;
      const previous = workspaceActivations[key] ?? false;
      setWorkspaceActivations((current) => ({ ...current, [key]: active }));
      setActivationSaving(true);
      try {
        const api = bridge();
        if (!api?.setGlobalAgentWorkspaceActivation) throw new Error('运行时未连接');
        await api.setGlobalAgentWorkspaceActivation({
          agentId: selected.id,
          workspaceId: workspaceId as import('@sync-think/shared').WorkspaceId,
          active,
        });
      } catch (error) {
        setWorkspaceActivations((current) => ({ ...current, [key]: previous }));
        await dialog.alert({
          title: '更新激活状态失败',
          message: error instanceof Error ? error.message : '无法更新工作区激活状态',
        });
      } finally {
        setActivationSaving(false);
      }
    },
    [dialog, selected, workspaceActivations],
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
      const result = (await api.deleteGlobalAgent({ agentId: selected.id })) as {
        archived?: boolean;
        conversationCount?: number;
        message?: string;
      } | void;
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

  const fallbackCandidates = models.filter((m) => m.modelId !== draft.defaultModelId);
  // Fallback checkboxes grouped by provider, mirroring the two-level picker.
  const fallbackGroups = useMemo(() => {
    const byProvider = new Map<string, ModelOption[]>();
    for (const m of fallbackCandidates) {
      const list = byProvider.get(m.providerName) ?? [];
      list.push(m);
      byProvider.set(m.providerName, list);
    }
    return [...byProvider.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [fallbackCandidates]);
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
  // Conversations assigned to this agent (work tab).
  // Conversations without a workspace cannot be located by the stage (tabs are
  // workspace-scoped), so jumping to them is a no-op — exclude those orphaned
  // rows instead of showing entries that cannot be opened.
  const assignedConversations = useMemo(
    () =>
      selected
        ? conversations.filter(
            (c) =>
              c.track === 'agent' &&
              c.targetRef === selected.id &&
              !c.archivedAt &&
              Boolean(c.workspaceId),
          )
        : [],
    [conversations, selected],
  );

  // Group assigned conversations by workspace for the work tab's accordion.
  // Each group carries the resolved workspace name/icon (falls back to the id).
  const groupedByWorkspace = useMemo(() => {
    const groups = new Map<
      string,
      { workspaceId: string; name: string; icon?: string; conversations: Conversation[] }
    >();
    for (const c of assignedConversations) {
      const wid = String(c.workspaceId);
      const ws = workspaces.find((w) => w.workspaceId === wid);
      const bucket = groups.get(wid) ?? {
        workspaceId: wid,
        name: ws?.name ?? wid,
        icon: ws?.icon,
        conversations: [],
      };
      bucket.conversations.push(c);
      groups.set(wid, bucket);
    }
    // Stable order: by workspace name then id.
    return [...groups.values()].sort(
      (a, b) => a.name.localeCompare(b.name) || a.workspaceId.localeCompare(b.workspaceId),
    );
  }, [assignedConversations, workspaces]);

  const toggleWorkspace = useCallback((workspaceId: string) => {
    setExpandedWorkspaces((current) => {
      const next = new Set(current);
      if (next.has(workspaceId)) next.delete(workspaceId);
      else next.add(workspaceId);
      return next;
    });
  }, []);

  const assignedConversationTotal = groupedByWorkspace.reduce(
    (n, group) => n + group.conversations.length,
    0,
  );

  return (
    <main className="agent-hub" data-testid="agent-library-page">
      {/* ── Topbar ─────────────────────────────────────────────────────── */}
      <header className="agent-hub__topbar">
        <div className="agent-hub__title-block">
          <span className="agent-hub__brand" aria-hidden="true">
            <Bot size={18} />
          </span>
          <div>
            <h1>智能体库</h1>
            <p>管理专属 AI 助手 · 绑定 Skill 与 MCP · 编排小队</p>
          </div>
        </div>
        <div className="agent-hub__actions">
          <button
            type="button"
            className="agent-hub__action"
            title="为未生成头像的智能体批量生成专属头像"
            onClick={() => void handleRegenerateAllAvatars()}
          >
            <WandSparkles size={14} /> 生成专属头像
          </button>
          <button
            type="button"
            className="agent-hub__action agent-hub__action--primary"
            onClick={openNew}
          >
            <Plus size={14} /> 新建智能体
          </button>
        </div>
      </header>

      {/* ── Controls: scope segmented filter + search + view switch ─────── */}
      <section className="agent-hub__controls">
        <div className="agent-segmented" role="group" aria-label="范围筛选">
          {SCOPE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={scopeFilter === option.id}
              className={scopeFilter === option.id ? 'is-active' : undefined}
              onClick={() => setScopeFilter(option.id)}
            >
              {option.label}
              <span>
                {option.id === 'all'
                  ? active.length
                  : active.filter((a) => (a.availabilityScope ?? 'global') === option.id).length}
              </span>
            </button>
          ))}
        </div>
        <div className="agent-hub__controls-right">
          <label className="agent-hub__search">
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
      </section>

      {/* ── Stat strip ─────────────────────────────────────────────────── */}
      <section className="agent-stats" aria-label="智能体统计">
        <StatCard label="智能体总数" value={stats.agentCount} icon={<Bot size={15} />} />
        <StatCard
          label="绑定 Skill"
          value={stats.skillTotal}
          icon={<Sparkles size={15} />}
          tone="is-info"
        />
        <StatCard
          label="绑定 MCP"
          value={stats.mcpTotal}
          icon={<Plug size={15} />}
          tone="is-violet"
        />
        <StatCard
          label="已分配对话"
          value={stats.conversationTotal}
          icon={<MessageSquare size={15} />}
          tone="is-warn"
        />
      </section>

      {/* ── Card grid ──────────────────────────────────────────────────── */}
      <div className="agent-hub__scroll">
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
              }}
            >
              清除筛选
            </button>
          </div>
        ) : (
          <div className="agent-grid" data-view={libraryView}>
            {visibleAgents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                models={models}
                selected={selected?.id === agent.id}
                onClick={() => openEdit(agent)}
                onStartConversation={onStartConversation}
              />
            ))}
          </div>
        )}
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
                          <span>{defaultModelLabel === '请选择模型' ? '未设置模型' : defaultModelLabel}</span>
                          <span className="agent-dialog__sep" aria-hidden="true">
                            ·
                          </span>
                          <span>
                            {memberTeams.length > 0
                              ? memberTeams.map((t) => t.name).join('、')
                              : '未加入小队'}
                          </span>
                          <span className="agent-dialog__sep" aria-hidden="true">
                            ·
                          </span>
                          <span>{assignedConversationTotal} 个已分配对话</span>
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

            {/* Tab row */}
            <nav className="agent-dialog__tabs" aria-label="智能体详情">
              {AGENT_DRAWER_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={drawerTab === tab.id}
                  data-testid={`agent-drawer-tab-${tab.id}`}
                  className={clsx('agent-dialog__tab', drawerTab === tab.id && 'is-active')}
                  onClick={() => setDrawerTab(tab.id)}
                >
                  {tab.label}
                  {tab.id === 'work' ? <span>{assignedConversationTotal}</span> : null}
                  {tab.id === 'abilities' ? (
                    <span>{draft.skillIds.length + draft.mcpServerIds.length}</span>
                  ) : null}
                </button>
              ))}
            </nav>

            {/* ── 概览：只读基本信息 ── */}
            {drawerTab === 'overview' && (
              <div className="agent-dialog__body" data-testid="agent-drawer-overview">
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
                        <p
                          className={clsx(
                            'agent-meta__value',
                            modelUnavailable && 'is-unavailable',
                          )}
                        >
                          {defaultModelLabel === '请选择模型' && !draft.defaultModelId
                            ? '未设置'
                            : defaultModelLabel}
                        </p>
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
                              <span
                                key={id}
                                className="agent-pill"
                                title={skill?.description}
                              >
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
              </div>
            )}

            {/* ── 工作：按工作区分组的手风琴 ── */}
            {drawerTab === 'work' && (
              <div className="agent-dialog__body" data-testid="agent-drawer-work">
                <div className="agent-pane">
                  {groupedByWorkspace.length === 0 ? (
                    <div className="agent-work-empty">
                      <p>暂无已分配对话。在对话中切换对象为该智能体后，对话会出现在这里。</p>
                    </div>
                  ) : (
                    groupedByWorkspace.map((group) => {
                      const isOpen = expandedWorkspaces.has(group.workspaceId);
                      return (
                        <div
                          key={group.workspaceId}
                          className={clsx('agent-workspace', isOpen && 'is-open')}
                        >
                          <button
                            type="button"
                            className="agent-workspace__head"
                            aria-expanded={isOpen}
                            data-testid={`agent-work-workspace-${group.workspaceId}`}
                            onClick={() => toggleWorkspace(group.workspaceId)}
                          >
                            <span className="agent-workspace__icon">
                              {group.icon ? (
                                <span className="text-[14px] leading-none">{group.icon}</span>
                              ) : (
                                <Folder size={14} />
                              )}
                            </span>
                            <span
                              className="agent-workspace__name"
                              title={group.name}
                            >
                              {group.name}
                            </span>
                            <span className="agent-workspace__count">
                              {group.conversations.length}
                            </span>
                            <ChevronDown
                              size={14}
                              className="agent-workspace__chevron"
                              aria-hidden="true"
                            />
                          </button>
                          <div className="agent-workspace__body" aria-hidden={!isOpen}>
                            {isOpen && (
                              <div
                                className="agent-workspace__list"
                                data-testid={`agent-work-conversations-${group.workspaceId}`}
                              >
                                {group.conversations.map((c) => (
                                  <div key={c.id} className="agent-conv-row">
                                    <div className="agent-conv-row__main">
                                      <div className="agent-conv-row__title">
                                        {c.title || '未命名对话'}
                                      </div>
                                      <div className="agent-conv-row__meta">
                                        {c.lastMessageAt
                                          ? new Date(c.lastMessageAt).toLocaleString()
                                          : '尚无消息'}
                                      </div>
                                    </div>
                                    {onOpenConversation ? (
                                      <button
                                        type="button"
                                        data-testid={`agent-work-open-${c.id}`}
                                        className="agent-conv-row__open"
                                        title="打开该对话"
                                        aria-label="打开该对话"
                                        onClick={() => onOpenConversation(String(c.id))}
                                      >
                                        <ArrowUpRight size={15} />
                                      </button>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* ── 能力：子 tab 切换 Skill / MCP / 人设 ── */}
            {drawerTab === 'abilities' && (
              <div className="agent-dialog__body" data-testid="agent-drawer-abilities">
                <div className="agent-pane">
                  <div className="agent-subtabs" role="group" aria-label="能力子分类">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={abilitySubTab === 'skills'}
                      data-testid="agent-ability-subtab-skills"
                      className={clsx(
                        'agent-subtab',
                        abilitySubTab === 'skills' && 'is-active',
                      )}
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
                      className={clsx(
                        'agent-subtab',
                        abilitySubTab === 'persona' && 'is-active',
                      )}
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
                            </label>
                            <div className="agent-check-list">
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
                            </label>
                            <div className="agent-check-list">
                              {filteredMcpServers.length === 0 ? (
                                <p className="agent-meta__empty">没有匹配的 MCP</p>
                              ) : (
                                filteredMcpServers.map((s) => (
                                  <AgentCheckRow
                                    key={s.id}
                                    checked={draft.mcpServerIds.includes(s.id)}
                                    title={s.name}
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
                          <span className="agent-persona-count">
                            {draft.persona.length} 字符
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── 设置：单列分组卡片 —— 身份 / 模型 ── */}
            {drawerTab === 'settings' && (
              <div className="agent-dialog__body" data-testid="agent-drawer-settings">
                <div className="agent-pane">
                  <div className="agent-settings-group">
                    <SectionTitle hint="头像、名称、简介与人设指令会一起进入每次对话的上下文。">
                      基本信息
                    </SectionTitle>

                    <div className="agent-avatar-editor">
                      <span
                        className="agent-dialog__avatar agent-dialog__avatar--lg"
                        style={avatarGlowStyle(draft.avatar, draft.name || '?', selected?.id ?? draft.name)}
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

                  <div className="agent-settings-group">
                    <SectionTitle hint="主模型失败时按备用顺序依次尝试。">
                      模型
                    </SectionTitle>

                    <Field label="默认模型 *" onLabelClick={() => setModelMenuOpen((o) => !o)}>
                      <div
                        className="agent-select"
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest('button')) return;
                          setModelMenuOpen((o) => !o);
                        }}
                      >
                        <ModelTrigger
                          label={defaultModelLabel}
                          open={modelMenuOpen}
                          buttonRef={setModelAnchorEl}
                          onClick={() => setModelMenuOpen((o) => !o)}
                        />
                      </div>
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

                    <Field label="备用模型（主模型失败后按顺序尝试）">
                      {fallbackCandidates.length === 0 ? (
                        <p className="agent-meta__empty">
                          没有其它可选模型。请先在设置里导入更多模型。
                        </p>
                      ) : (
                        <div className="agent-check-list">
                          {fallbackGroups.map(([providerName, providerModels]) => (
                            <div key={providerName} className="agent-check-group">
                              <div className="agent-check-group__label">{providerName}</div>
                              {providerModels.map((m) => (
                                <AgentCheckRow
                                  key={m.modelId}
                                  checked={draft.fallbackModelIds.includes(m.modelId)}
                                  title={m.displayName}
                                  onToggle={() =>
                                    setDraft((d) => ({
                                      ...d,
                                      fallbackModelIds: toggleId(d.fallbackModelIds, m.modelId),
                                    }))
                                  }
                                />
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                      {draft.fallbackModelIds.length > 0 && (
                        <p className="agent-meta__empty">已选 {draft.fallbackModelIds.length} 个备用</p>
                      )}
                    </Field>

                    <Field label="推理强度">
                      <AgentSegmented
                        ariaLabel="推理强度"
                        value={draft.reasoningEffort}
                        options={REASONING_OPTIONS}
                        onChange={(reasoningEffort) =>
                          setDraft((d) => ({ ...d, reasoningEffort }))
                        }
                      />
                    </Field>
                  </div>

                  <div className="agent-settings-group">
                    <SectionTitle hint="只在被其他对话委派时生效；「逐次询问」下仍只读。">
                      委派写入
                    </SectionTitle>
                    <Field label="被委派时">
                      <AgentSegmented
                        ariaLabel="委派写入权限"
                        value={draft.writePolicy}
                        options={[
                          { value: 'read-only', label: '只读', title: '被委派时永远只读' },
                          {
                            value: 'inherit',
                            label: '继承会话',
                            title: '跟随对话权限；逐次询问下仍只读',
                          },
                        ]}
                        onChange={(writePolicy) =>
                          setDraft((current) => ({
                            ...current,
                            writePolicy: writePolicy as DraftAgent['writePolicy'],
                          }))
                        }
                      />
                    </Field>
                    <p className="agent-meta__empty">
                      {draft.writePolicy === 'inherit'
                        ? '跟随对话权限；逐次询问下仍只读（子智能体没有审批入口）。'
                        : '被委派时只能读取，不能写入或执行命令。'}
                    </p>
                  </div>

                  <div className="agent-settings-group">
                    <SectionTitle hint="决定哪些工作区的模型对话可以委派这个智能体。">
                      可用范围
                    </SectionTitle>
                    <Field label="激活范围">
                      <AgentSegmented
                        ariaLabel="激活范围"
                        value={draft.availabilityScope}
                        options={[
                          { value: 'global', label: '全局', title: '所有工作区可用' },
                          {
                            value: 'workspace',
                            label: '指定工作区',
                            title: '仅在选中的工作区可用',
                          },
                        ]}
                        onChange={(availabilityScope) =>
                          setDraft((current) => ({
                            ...current,
                            availabilityScope: availabilityScope as DraftAgent['availabilityScope'],
                          }))
                        }
                      />
                    </Field>
                    {draft.availabilityScope === 'global' ? (
                      <p className="agent-meta__empty">全局激活：所有工作区都可以调用这个智能体。</p>
                    ) : isNew ? (
                      <p className="agent-meta__empty">保存后重新打开该智能体，即可选择具体工作区。</p>
                    ) : workspaces.length === 0 ? (
                      <p className="agent-meta__empty">当前还没有可配置的工作区。</p>
                    ) : (
                      <div
                        className="agent-check-list"
                        data-testid="agent-workspace-activation-list"
                      >
                        {workspaces.map((workspace) => {
                          const key = `${selected?.id}:${workspace.workspaceId}`;
                          return (
                            <AgentCheckRow
                              key={workspace.workspaceId}
                              checked={workspaceActivations[key] === true}
                              title={workspace.name}
                              description={workspace.folderPath || String(workspace.workspaceId)}
                              disabled={activationSaving}
                              onToggle={() =>
                                void handleWorkspaceActivation(
                                  String(workspace.workspaceId),
                                  workspaceActivations[key] !== true,
                                )
                              }
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
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

function StatCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="agent-stat">
      <span className={clsx('agent-stat__icon', tone)}>{icon}</span>
      <div>
        <div className="agent-stat__label">{label}</div>
        <div className="agent-stat__value">{value}</div>
      </div>
    </div>
  );
}

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
}: {
  agent: GlobalAgent;
  models: readonly ModelOption[];
  selected: boolean;
  onClick(): void;
  onStartConversation?: (agentId: string) => void;
}) {
  const modelName = modelDisplayName(models, agent.defaultModelId, '未指定模型');
  const skillN = agent.skillIds?.length ?? 0;
  const mcpN = agent.mcpServerIds?.length ?? 0;
  const fallbackN = agent.fallbackModelIds?.length ?? 0;
  const modelMissing = modelName === '模型不可用';
  const modelLabel = !agent.defaultModelId ? '未指定模型' : modelName;

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
      {/* Card header */}
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
            <ChevronRight
              size={14}
              className="agent-card__chevron"
              aria-hidden="true"
            />
          </div>
          <span
            className={clsx('agent-card__model', modelMissing && 'is-unavailable')}
            data-model-state={modelMissing ? 'unavailable' : 'available'}
            title={
              modelMissing ? '已配置模型当前不可用，请进入设置重新选择' : modelLabel
            }
          >
            <span className="agent-card__model-dot" aria-hidden="true" />
            {modelLabel}
          </span>
          <p
            className="agent-card__description"
            data-empty={agent.description ? undefined : '1'}
          >
            {agent.description || '暂无简介'}
          </p>
        </div>
      </div>

      {/* Binding badges + action */}
      <footer className="agent-card__footer">
        <div className="agent-card__badges">
          <span className="agent-badge is-accent">
            <Sparkles size={10} aria-hidden="true" /> Skill {skillN}
          </span>
          <span className="agent-badge">
            <Wrench size={10} aria-hidden="true" /> MCP {mcpN}
          </span>
          {fallbackN > 0 ? <span className="agent-badge">备用 {fallbackN}</span> : null}
          <span className="agent-badge">
            {(agent.availabilityScope ?? 'global') === 'workspace' ? '指定工作区' : '全局'}
          </span>
        </div>
        {onStartConversation ? (
          <button
            type="button"
            className="agent-card__action"
            onClick={(e) => {
              e.stopPropagation();
              onStartConversation(agent.id);
            }}
          >
            <MessageSquare size={11} aria-hidden="true" /> 开始对话
          </button>
        ) : null}
      </footer>
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

function AgentCheckRow({
  checked,
  title,
  description,
  disabled = false,
  onToggle,
}: {
  checked: boolean;
  title: React.ReactNode;
  description?: string;
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
      <span className="agent-check-row__copy">
        <span className="agent-check-row__name">{title}</span>
        {description ? <span className="agent-check-row__desc">{description}</span> : null}
      </span>
    </button>
  );
}

function AgentSegmented({
  ariaLabel,
  value,
  options,
  onChange,
}: {
  ariaLabel: string;
  value: string;
  options: readonly { value: string; label: string; title?: string }[];
  onChange(value: string): void;
}) {
  return (
    <div className="agent-seg" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? 'is-active' : undefined}
          aria-pressed={value === option.value}
          title={option.title ?? option.label}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
