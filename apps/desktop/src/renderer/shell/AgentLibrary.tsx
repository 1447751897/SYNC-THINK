// P2 · Global Agent Library
// NewMax-style card grid + tabbed detail drawer: 概览 (read-only), 工作
// (assigned conversations), 能力 (editable skills/MCP/persona) and
// 设置 (editable identity/models/reasoning).
import {
  ArrowUpRight,
  Bot,
  ChevronDown,
  ChevronRight,
  Folder,
  ImagePlus,
  LayoutGrid,
  List as ListIcon,
  Plus,
  Search,
  Trash2,
  X,
  Wrench,
  Sparkles,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import type { Conversation, GlobalAgent, ModelId, Team } from '@sync-think/shared';
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
import { ModelPickerMenu, ModelTrigger } from './compose-toolbar.js';
import { SlidingTabs } from './SlidingTabs.js';

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
};

const REASONING_OPTIONS = [
  { value: 'auto', label: '自动（默认开启思考）' },
  { value: 'off', label: '关闭' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
];

const AGENT_DRAWER_TABS: Array<{ id: DrawerTab; label: string }> = [
  { id: 'overview', label: '概览' },
  { id: 'work', label: '工作' },
  { id: 'abilities', label: '能力' },
  { id: 'settings', label: '设置' },
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
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(() => new Set());
  const [draft, setDraft] = useState<DraftAgent>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [modelFilter, setModelFilter] = useState('');
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
      if (modelFilter && agent.defaultModelId !== modelFilter) return false;
      if (!query) return true;
      const modelName = models.find((model) => model.modelId === agent.defaultModelId)?.displayName;
      return [agent.name, agent.description, agent.persona, modelName]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLocaleLowerCase().includes(query));
    });
  }, [active, modelFilter, models, searchQuery]);

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
    setDrawerTab('overview');
    setDraft({ ...EMPTY_DRAFT, defaultModelId: models[0]?.modelId ?? '' });
    setTimeout(() => nameRef.current?.focus(), 50);
  }, [models]);

  const openEdit = useCallback((agent: GlobalAgent) => {
    setIsNew(false);
    setSelected(agent);
    setDrawerTab('overview');
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
    });
    setTimeout(() => nameRef.current?.focus(), 50);
  }, []);

  const closeDrawer = () => {
    setSelected(null);
    setIsNew(false);
    setDrawerTab('overview');
    setModelMenuOpen(false);
  };

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
      closeDrawer();
    } catch (error) {
      await dialog.alert({
        title: '保存失败',
        message: error instanceof Error ? error.message : '保存智能体失败',
      });
    } finally {
      setSaving(false);
    }
  }, [dialog, draft, isNew, selected, onRefresh]);

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
      closeDrawer();
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
  }, [dialog, selected, onRefresh]);

  const drawerOpen = isNew || selected !== null;

  // Escape dismisses the topmost layer first. When the model picker is open,
  // keep the agent draft intact and only close that picker; a second Escape
  // closes the drawer itself.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (modelMenuOpen) {
        setModelMenuOpen(false);
        return;
      }
      setSelected(null);
      setIsNew(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen, modelMenuOpen]);

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

  return (
    <div className="shell-library-page">
      {/* ── Library panel ─────────────────────────────────────────── */}
      <div className="shell-library-panel">
        {/* Header */}
        <div className="shell-library-header">
          <span className="text-[14px] font-semibold text-text">智能体库</span>
          <div className="shell-library-header__controls">
            <label className="shell-library-search">
              <Search size={13} aria-hidden="true" />
              <input
                type="search"
                aria-label="搜索智能体"
                placeholder="搜索智能体"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </label>
            <select
              className="shell-library-filter"
              aria-label="按模型筛选"
              value={modelFilter}
              onChange={(event) => setModelFilter(event.target.value)}
            >
              <option value="">全部模型</option>
              {models.map((model) => (
                <option key={model.modelId} value={model.modelId}>
                  {model.displayName}
                </option>
              ))}
            </select>
            <div className="shell-library-view-switch" role="group" aria-label="显示方式">
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
            <button className="shell-library-primary-action" onClick={openNew}>
              <Plus size={13} /> 新建智能体
            </button>
          </div>
        </div>

        {/* Cards */}
        <div className="shell-library-content">
          {active.length === 0 ? (
            <EmptyAgents onNew={openNew} />
          ) : visibleAgents.length === 0 ? (
            <div className="shell-library-filter-empty">
              <Search size={20} />
              <span>没有匹配的智能体</span>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setModelFilter('');
                }}
              >
                清除筛选
              </button>
            </div>
          ) : (
            <div className="shell-library-grid" data-view={libraryView}>
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
      </div>

      {/* ── Edit drawer. Left: identity & persona. Right: model & bindings. ── */}
      {drawerOpen && (
        <div
          className="shell-library-drawer-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeDrawer();
          }}
        >
          {/* The Radix model picker portals to <body> with z-index auto, which
              would paint below this z-50 backdrop. Radix popper mirrors the
              content's computed z-index onto its wrapper, so lift the menu
              panels above the backdrop while this dialog is open. */}
          <style>{'.shell-menu--model-providers,.shell-menu--model-flyout{z-index:60}'}</style>
          <div
            className="shell-library-drawer shell-library-drawer--agent"
            data-testid="agent-detail-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={isNew ? '新建智能体' : `编辑智能体${draft.name ? ` · ${draft.name}` : ''}`}
          >
            {/* 身份卡：头像 + 名称 + 简介 + 关闭，常驻 tab 之上（替代旧 header） */}
            {!isNew ? (
              <div className="shell-agent-identity" data-testid="agent-identity-card">
                <AgentAvatarView name={draft.name || '?'} avatar={draft.avatar} size={52} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold text-text">
                    {draft.name || '未命名智能体'}
                  </div>
                  {draft.description ? (
                    <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-text-secondary">
                      {draft.description}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-[12px] text-text-faint">暂无简介</p>
                  )}
                </div>
                <button
                  type="button"
                  className="shell-agent-identity__close"
                  onClick={closeDrawer}
                  title="关闭"
                  aria-label="关闭"
                >
                  <X size={15} />
                </button>
              </div>
            ) : (
              /* 新建态无身份卡,顶端仅放关闭条 */
              <div className="shell-agent-identity shell-agent-identity--bare">
                <span className="text-[13px] font-medium text-text">新建智能体</span>
                <button
                  type="button"
                  className="shell-agent-identity__close"
                  onClick={closeDrawer}
                  title="关闭"
                  aria-label="关闭"
                >
                  <X size={15} />
                </button>
              </div>
            )}

            {/* Tab row */}
            <SlidingTabs className="shell-agent-tabs" aria-label="智能体详情">
              {AGENT_DRAWER_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={drawerTab === tab.id}
                  data-testid={`agent-drawer-tab-${tab.id}`}
                  className={clsx('shell-agent-tab', drawerTab === tab.id && 'is-active')}
                  onClick={() => setDrawerTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </SlidingTabs>

            {/* ── 概览：只读基本信息 ── */}
            {drawerTab === 'overview' && (
              <div className="shell-library-drawer__body" data-testid="agent-drawer-overview">
                <div className="shell-library-pane">
                  <div className="space-y-5">
                    <Field label="ID">
                      <p className="font-mono text-[11.5px] text-text-faint">
                        {selected?.id ?? '-'}
                      </p>
                    </Field>

                    <Field label="所在小队">
                      {memberTeams.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {memberTeams.map((t) => (
                            <span
                              key={t.id}
                              className="rounded-md border border-border bg-surface px-2 py-0.5 text-[11.5px] text-text-secondary"
                            >
                              {t.avatar} {t.name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[12.5px] text-text-faint">无</p>
                      )}
                    </Field>

                    <Field label="使用模型">
                      <div className="flex items-center gap-2">
                        <p className="text-[12.5px] text-text">
                          {defaultModelLabel === '请选择模型' && !draft.defaultModelId
                            ? '未设置'
                            : defaultModelLabel}
                        </p>
                        <button
                          type="button"
                          data-testid="agent-overview-edit-model"
                          className="rounded-md px-2 py-0.5 text-[11px] text-text-faint hover:bg-hover hover:text-text"
                          onClick={() => setDrawerTab('settings')}
                        >
                          修改
                        </button>
                      </div>
                    </Field>

                    <Field label={`包含 Skill（${draft.skillIds.length}）`}>
                      {draft.skillIds.length === 0 ? (
                        <p className="text-[12.5px] text-text-faint">无</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {draft.skillIds.map((id) => {
                            const skill = skills.find((s) => s.id === id);
                            return (
                              <span
                                key={id}
                                className="rounded-md border border-border bg-surface px-2 py-0.5 text-[11.5px] text-text-secondary"
                                title={skill?.description}
                              >
                                {skill ? skill.name : id}
                                {skill?.version ? (
                                  <span className="ml-1 text-[10.5px] text-text-faint">
                                    @{skill.version}
                                  </span>
                                ) : null}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </Field>

                    <Field label="系统 / 人设指令">
                      <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-page p-3 font-mono text-[12px] leading-relaxed text-text">
                        {draft.persona || '—'}
                      </pre>
                    </Field>
                  </div>
                </div>
              </div>
            )}

            {/* ── 工作：按工作区分组的手风琴 ── */}
            {drawerTab === 'work' && (
              <div className="shell-library-drawer__body" data-testid="agent-drawer-work">
                <div className="shell-library-pane">
                  {groupedByWorkspace.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
                      <p className="m-0 text-[12px] text-text-faint">
                        暂无已分配对话。在对话中切换对象为该智能体后，对话会出现在这里。
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2" data-testid="agent-work-workspace-list">
                      {groupedByWorkspace.map((group) => {
                        const isOpen = expandedWorkspaces.has(group.workspaceId);
                        return (
                          <div
                            key={group.workspaceId}
                            className={clsx('shell-agent-workspace', isOpen && 'is-open')}
                          >
                            <button
                              type="button"
                              className="shell-agent-workspace__head"
                              aria-expanded={isOpen}
                              data-testid={`agent-work-workspace-${group.workspaceId}`}
                              onClick={() => toggleWorkspace(group.workspaceId)}
                            >
                              <span className="shell-agent-workspace__icon">
                                {group.icon ? (
                                  <span className="text-[14px] leading-none">{group.icon}</span>
                                ) : (
                                  <Folder size={14} className="text-accent" />
                                )}
                              </span>
                              <span
                                className="min-w-0 flex-1 truncate text-[13px] font-medium text-text"
                                title={group.name}
                              >
                                {group.name}
                              </span>
                              <span className="shell-agent-workspace__count">
                                {group.conversations.length}
                              </span>
                              <ChevronDown
                                size={14}
                                className={clsx(
                                  'shell-agent-workspace__chevron shrink-0 text-text-faint',
                                )}
                              />
                            </button>
                            <div className="shell-agent-workspace__body" aria-hidden={!isOpen}>
                              {isOpen && (
                                <div
                                  className="space-y-1.5 shell-agent-sub-enter"
                                  data-testid={`agent-work-conversations-${group.workspaceId}`}
                                >
                                  {group.conversations.map((c) => (
                                    <div
                                      key={c.id}
                                      className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 transition-colors hover:border-border-strong"
                                    >
                                      <div className="min-w-0 flex-1">
                                        <div className="truncate text-[12.5px] text-text">
                                          {c.title || '未命名对话'}
                                        </div>
                                        <div className="text-[11px] text-text-faint">
                                          {c.lastMessageAt
                                            ? new Date(c.lastMessageAt).toLocaleString()
                                            : '尚无消息'}
                                        </div>
                                      </div>
                                      {onOpenConversation ? (
                                        <button
                                          type="button"
                                          data-testid={`agent-work-open-${c.id}`}
                                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-faint transition-colors hover:bg-hover hover:text-text"
                                          title="打开该对话"
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
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── 能力：子 tab 切换 Skill / MCP / 人设 ── */}
            {drawerTab === 'abilities' && (
              <div className="shell-library-drawer__body" data-testid="agent-drawer-abilities">
                <div className="shell-library-pane">
                  <SlidingTabs className="shell-agent-subtabs" aria-label="能力子分类">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={abilitySubTab === 'skills'}
                      data-testid="agent-ability-subtab-skills"
                      className={clsx(
                        'shell-agent-subtab',
                        abilitySubTab === 'skills' && 'is-active',
                      )}
                      onClick={() => setAbilitySubTab('skills')}
                    >
                      <Sparkles size={12} /> Skill
                      <span className="shell-agent-subtab__count">{draft.skillIds.length}</span>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={abilitySubTab === 'mcp'}
                      data-testid="agent-ability-subtab-mcp"
                      className={clsx('shell-agent-subtab', abilitySubTab === 'mcp' && 'is-active')}
                      onClick={() => setAbilitySubTab('mcp')}
                    >
                      <Wrench size={12} /> MCP
                      <span className="shell-agent-subtab__count">{draft.mcpServerIds.length}</span>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={abilitySubTab === 'persona'}
                      data-testid="agent-ability-subtab-persona"
                      className={clsx(
                        'shell-agent-subtab',
                        abilitySubTab === 'persona' && 'is-active',
                      )}
                      onClick={() => setAbilitySubTab('persona')}
                    >
                      人设指令
                    </button>
                  </SlidingTabs>

                  <div className="shell-agent-subpanel" data-testid="agent-ability-content">
                    {/* ── Skill 绑定 ── */}
                    {abilitySubTab === 'skills' && (
                      <div className="space-y-3 shell-agent-sub-enter" role="tabpanel">
                        <SectionTitle>
                          <span className="inline-flex items-center gap-1">
                            <Sparkles size={12} /> Skill 绑定
                          </span>
                        </SectionTitle>
                        <Field
                          label={catalogLoading ? '加载中…' : `已选 ${draft.skillIds.length} 个`}
                        >
                          {skillCatalogError ? (
                            <div className="flex items-center justify-between gap-2 rounded-lg bg-error/10 px-3 py-2 text-[11.5px] text-error">
                              <span className="min-w-0 truncate">
                                Skill 加载失败：{skillCatalogError}
                              </span>
                              {onManageSkills ? (
                                <button
                                  type="button"
                                  className="shrink-0 underline"
                                  onClick={onManageSkills}
                                >
                                  打开能力中心
                                </button>
                              ) : null}
                            </div>
                          ) : skills.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-border px-3 py-3 text-center">
                              <p className="m-0 text-[11.5px] text-text-faint">暂无已导入 Skill</p>
                              {onManageSkills ? (
                                <button
                                  type="button"
                                  data-testid="manage-skills-from-agent"
                                  className="shell-library-secondary-action mt-2"
                                  onClick={onManageSkills}
                                >
                                  去能力中心导入
                                </button>
                              ) : null}
                            </div>
                          ) : (
                            <div className="shell-library-subpanel max-h-[420px] space-y-1 overflow-y-auto p-2">
                              {skills.map((s) => {
                                const checked = draft.skillIds.includes(s.id);
                                return (
                                  <label
                                    key={s.id}
                                    className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1.5 hover:bg-hover"
                                    title={s.description || s.id}
                                  >
                                    <input
                                      type="checkbox"
                                      className="mt-0.5 accent-[var(--color-accent)]"
                                      checked={checked}
                                      onChange={() =>
                                        setDraft((d) => ({
                                          ...d,
                                          skillIds: toggleId(d.skillIds, s.id),
                                        }))
                                      }
                                    />
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-[12.5px] text-text">
                                        {s.name}
                                        {s.version ? (
                                          <span className="ml-1 text-[11px] text-text-faint">
                                            @{s.version}
                                          </span>
                                        ) : null}
                                      </span>
                                      {s.description ? (
                                        <span className="block truncate text-[11px] text-text-faint">
                                          {s.description}
                                        </span>
                                      ) : null}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </Field>
                      </div>
                    )}

                    {/* ── MCP 绑定 ── */}
                    {abilitySubTab === 'mcp' && (
                      <div className="space-y-3 shell-agent-sub-enter" role="tabpanel">
                        <SectionTitle>
                          <span className="inline-flex items-center gap-1">
                            <Wrench size={12} /> MCP 绑定
                          </span>
                        </SectionTitle>
                        <Field
                          label={
                            catalogLoading ? '加载中…' : `已选 ${draft.mcpServerIds.length} 个`
                          }
                        >
                          {mcpServers.length === 0 ? (
                            <p className="text-[11.5px] text-text-faint">
                              暂无已注册 MCP 服务器。注册后可在此绑定，对话内可调用其工具。
                            </p>
                          ) : (
                            <div className="shell-library-subpanel max-h-[420px] space-y-1 overflow-y-auto p-2">
                              {mcpServers.map((s) => {
                                const checked = draft.mcpServerIds.includes(s.id);
                                return (
                                  <label
                                    key={s.id}
                                    className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-hover"
                                  >
                                    <input
                                      type="checkbox"
                                      className="accent-[var(--color-accent)]"
                                      checked={checked}
                                      onChange={() =>
                                        setDraft((d) => ({
                                          ...d,
                                          mcpServerIds: toggleId(d.mcpServerIds, s.id),
                                        }))
                                      }
                                    />
                                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-text">
                                      {s.name}
                                    </span>
                                    <span className="shrink-0 text-[11px] text-text-faint">
                                      {s.toolCount} 工具{s.trusted ? ' · 信任' : ''}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </Field>
                      </div>
                    )}

                    {/* ── 人设 / 系统指令 ── */}
                    {abilitySubTab === 'persona' && (
                      <div className="space-y-3 shell-agent-sub-enter" role="tabpanel">
                        <SectionTitle>系统 / 人设指令</SectionTitle>
                        <Field label="人设 / 系统指令">
                          <textarea
                            className="w-full resize-y rounded-lg border border-border bg-page px-3 py-2 font-mono text-[12.5px] leading-relaxed text-text focus:border-accent focus:outline-none"
                            rows={16}
                            placeholder="你是一名经验丰富的前端工程师，专注于 React 和 TypeScript…"
                            value={draft.persona}
                            onChange={(e) => setDraft((d) => ({ ...d, persona: e.target.value }))}
                          />
                        </Field>
                        {draft.persona.trim() ? (
                          <p className="text-[11px] text-text-faint">{draft.persona.length} 字符</p>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── 设置：单列分组卡片 —— 身份 / 模型 ── */}
            {drawerTab === 'settings' && (
              <div className="shell-library-drawer__body" data-testid="agent-drawer-settings">
                <div className="shell-library-pane">
                  {/* 身份 */}
                  <div className="shell-agent-setting-group space-y-5">
                    <SectionTitle>基本信息</SectionTitle>

                    {/* Avatar picker: live preview + emoji input + image import */}
                    <div className="flex items-center gap-4">
                      <AgentAvatarView name={draft.name || '?'} avatar={draft.avatar} size={56} />
                      <div className="flex flex-1 flex-col gap-1.5">
                        <label className="text-[11px] text-text-faint">头像</label>
                        <div className="flex items-center gap-2">
                          {!isImageAvatar(draft.avatar) && (
                            <input
                              className="h-9 w-16 rounded-lg border border-border bg-page text-center text-[18px] focus:border-accent focus:outline-none"
                              value={draft.avatar}
                              onChange={(e) => setDraft((d) => ({ ...d, avatar: e.target.value }))}
                              maxLength={2}
                              title="输入一个 emoji 或字母"
                            />
                          )}
                          <button
                            type="button"
                            className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-text-secondary hover:bg-hover"
                            onClick={() => avatarFileRef.current?.click()}
                          >
                            <ImagePlus size={13} /> 导入图片
                          </button>
                          {isImageAvatar(draft.avatar) && (
                            <button
                              type="button"
                              className="h-9 rounded-lg px-2 text-[12px] text-text-faint hover:bg-hover hover:text-text"
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

                    {/* Procedural face picker — writes a `gen:v1:<shape>:<color>` seed. */}
                    <div className="space-y-2.5 rounded-lg border border-border bg-page p-3">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] text-text-faint">专属头像</label>
                        <button
                          type="button"
                          className="text-[11px] text-text-faint transition-colors hover:text-text"
                          onClick={() => void handleRegenerateAllAvatars()}
                        >
                          给全部智能体生成
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {AVATAR_SHAPES.map((shape) => {
                          const isActiveShape = avatarFace.shape === shape;
                          return (
                            <button
                              key={shape}
                              type="button"
                              title={shape}
                              aria-label={`形状 ${shape}`}
                              aria-pressed={isActiveShape}
                              className={`h-8 w-8 rounded-lg border p-0.5 transition-colors ${
                                isActiveShape ? 'border-accent bg-hover' : 'border-border hover:bg-hover'
                              }`}
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
                                className="h-full w-full select-none"
                                draggable={false}
                              />
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {AVATAR_COLORS.map((color) => {
                          const isActiveColor = avatarFace.color === color;
                          return (
                            <button
                              key={color}
                              type="button"
                              title={color}
                              aria-label={`颜色 ${color}`}
                              aria-pressed={isActiveColor}
                              className={`h-6 w-6 rounded-full border-2 transition-transform ${
                                isActiveColor ? 'scale-110 border-accent' : 'border-border'
                              }`}
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
                        className="h-9 w-full rounded-lg border border-border bg-page px-3 text-[13px] text-text focus:border-accent focus:outline-none"
                        placeholder="前端小张"
                        value={draft.name}
                        onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                      />
                    </Field>

                    <Field label="简介">
                      <input
                        className="h-9 w-full rounded-lg border border-border bg-page px-3 text-[13px] text-text focus:border-accent focus:outline-none"
                        placeholder="擅长前端开发与调试"
                        value={draft.description}
                        onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                      />
                    </Field>
                  </div>

                  {/* 模型 */}
                  <div className="shell-agent-setting-group space-y-5">
                    <SectionTitle>模型</SectionTitle>

                    {/* Default model — required; empty value is rejected by protocol.
                        Two-level provider → model picker (same widget as the compose bar).
                        Both the label and the control open the picker so pressing
                        the field text is never a silent no-op. */}
                    <Field label="默认模型 *" onLabelClick={() => setModelMenuOpen((o) => !o)}>
                      <div
                        className="shell-library-control flex h-9 cursor-pointer items-center px-1.5"
                        onClick={(e) => {
                          // The trigger button handles its own click; only open
                          // when pressing elsewhere in the control area.
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
                        <p className="text-[11.5px] text-text-faint">
                          没有其它可选模型。请先在设置里导入更多模型。
                        </p>
                      ) : (
                        <div className="shell-library-subpanel max-h-40 space-y-2 overflow-y-auto p-2">
                          {fallbackGroups.map(([providerName, providerModels]) => (
                            <div key={providerName}>
                              <div className="px-1.5 pb-0.5 text-[10.5px] font-medium text-text-faint">
                                {providerName}
                              </div>
                              {providerModels.map((m) => {
                                const checked = draft.fallbackModelIds.includes(m.modelId);
                                return (
                                  <label
                                    key={m.modelId}
                                    className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 hover:bg-hover"
                                  >
                                    <input
                                      type="checkbox"
                                      className="accent-[var(--color-accent)]"
                                      checked={checked}
                                      onChange={() =>
                                        setDraft((d) => ({
                                          ...d,
                                          fallbackModelIds: toggleId(d.fallbackModelIds, m.modelId),
                                        }))
                                      }
                                    />
                                    <span className="truncate text-[12.5px] text-text">
                                      {m.displayName}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      )}
                      {draft.fallbackModelIds.length > 0 && (
                        <p className="mt-1 text-[11px] text-text-faint">
                          已选 {draft.fallbackModelIds.length} 个备用
                        </p>
                      )}
                    </Field>

                    <Field label="推理强度">
                      <select
                        className="h-9 w-full rounded-lg border border-border bg-page px-3 text-[13px] text-text focus:border-accent focus:outline-none"
                        value={draft.reasoningEffort}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, reasoningEffort: e.target.value }))
                        }
                      >
                        {REASONING_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                </div>
              </div>
            )}

            {/* Footer actions */}
            <div className="shell-library-drawer__footer">
              {!isNew ? (
                <button
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] text-error hover:bg-error/10 disabled:opacity-40"
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                >
                  <Trash2 size={13} /> 删除
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button
                  className="rounded-lg border border-border px-3 py-1.5 text-[12.5px] text-text-secondary hover:bg-hover"
                  onClick={closeDrawer}
                >
                  取消
                </button>
                <button
                  className="rounded-lg bg-accent px-4 py-1.5 text-[12.5px] font-medium text-[var(--color-accent-fg)] hover:opacity-90 disabled:opacity-40"
                  onClick={() => void handleSave()}
                  disabled={saving || !draft.name.trim() || !draft.defaultModelId.trim()}
                >
                  {saving ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="shell-library-section-title">{children}</div>;
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

  return (
    <div
      className={clsx('shell-library-card group', selected && 'shell-library-card--selected')}
      onClick={onClick}
    >
      {/* Card header */}
      <div className="flex items-center gap-3">
        <AgentAvatarView name={agent.name} avatar={agent.avatar} size={40} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-medium text-text">{agent.name}</div>
          <div
            className="truncate text-[11.5px] text-text-faint"
            data-model-state={modelName === '模型不可用' ? 'unavailable' : 'available'}
            title={
              modelName === '模型不可用' ? '已配置模型当前不可用，请进入设置重新选择' : modelName
            }
          >
            {modelName}
          </div>
        </div>
        <ChevronRight
          size={14}
          className="text-text-faint opacity-0 transition-opacity group-hover:opacity-100"
        />
      </div>

      {/* Description */}
      <p
        className="shell-library-card__description"
        data-empty={agent.description ? undefined : '1'}
      >
        {agent.description || '暂无简介'}
      </p>

      {/* Binding badges */}
      <div className="shell-library-card__meta">
        {fallbackN > 0 && (
          <span className="rounded-md bg-page px-1.5 py-0.5 text-[10.5px] text-text-faint">
            备用 {fallbackN}
          </span>
        )}
        <span className="rounded-md bg-page px-1.5 py-0.5 text-[10.5px] text-text-faint">
          Skill {skillN}
        </span>
        <span className="rounded-md bg-page px-1.5 py-0.5 text-[10.5px] text-text-faint">
          MCP {mcpN}
        </span>
      </div>

      {/* Footer */}
      {onStartConversation && (
        <button
          className="shell-library-card__action"
          onClick={(e) => {
            e.stopPropagation();
            onStartConversation(agent.id);
          }}
        >
          <Bot size={12} /> 开始对话
        </button>
      )}
    </div>
  );
}

function EmptyAgents({ onNew }: { onNew(): void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 py-20 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft">
        <Bot size={24} className="text-accent-text" />
      </div>
      <div>
        <p className="text-[14px] font-medium text-text">还没有智能体</p>
        <p className="mt-1 text-[12px] text-text-faint">创建一个专属于你的 AI 助手</p>
      </div>
      <button
        className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[12.5px] font-medium text-[var(--color-accent-fg)] hover:opacity-90"
        onClick={onNew}
      >
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
    <div className="shell-library-field">
      <label
        className="text-[11px] text-text-faint"
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
