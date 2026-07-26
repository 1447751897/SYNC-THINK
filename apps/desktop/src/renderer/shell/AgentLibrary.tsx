// P2 · Global Agent Library
// NewMax-style card grid + centered two-column edit dialog with avatar import,
// Skill / MCP bindings and fallback models.
import { Bot, ChevronRight, ImagePlus, Plus, Trash2, X, Wrench, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import type { GlobalAgent } from '@sync-think/shared';
import type { ModelOption } from './NewConversationDialog.js';
import { useDialog } from './Dialog.js';
import { AgentAvatarView, isImageAvatar, readAvatarImage } from './AgentAvatarView.js';
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
}

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
  { value: 'auto', label: '自动' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
];

function bridge() {
  return (window as any).syncThink?.runtime;
}

function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export function AgentLibrary({
  agents,
  models,
  onRefresh,
  onStartConversation,
  onManageSkills,
  skillCatalogRevision = 0,
}: Props) {
  const dialog = useDialog();
  const [selected, setSelected] = useState<GlobalAgent | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [draft, setDraft] = useState<DraftAgent>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
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

  const active = agents.filter((a) => !a.archived);

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
    setDraft({ ...EMPTY_DRAFT, defaultModelId: models[0]?.modelId ?? '' });
    setTimeout(() => nameRef.current?.focus(), 50);
  }, [models]);

  const openEdit = useCallback((agent: GlobalAgent) => {
    setIsNew(false);
    setSelected(agent);
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
      defaultModelId: draft.defaultModelId,
      fallbackModelIds,
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
  const defaultModelLabel =
    models.find((m) => m.modelId === draft.defaultModelId)?.displayName
    ?? (draft.defaultModelId || '请选择模型');

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* ── Library panel ─────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-5">
          <span className="text-[14px] font-semibold text-text">智能体库</span>
          <button
            className="flex h-7 items-center gap-1.5 rounded-lg bg-accent px-3 text-[12.5px] font-medium text-[var(--color-accent-fg)] hover:opacity-90"
            onClick={openNew}
          >
            <Plus size={13} /> 新建智能体
          </button>
        </div>

        {/* Cards */}
        <div className="flex-1 overflow-y-auto p-5">
          {active.length === 0 ? (
            <EmptyAgents onNew={openNew} />
          ) : (
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))' }}>
              {active.map((agent) => (
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

      {/* ── Edit dialog — centered two-column layout, roomy (was a cramped
            380px drawer). Left: identity & persona. Right: model & bindings. ── */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeDrawer();
          }}
        >
          {/* The Radix model picker portals to <body> with z-index auto, which
              would paint below this z-50 backdrop. Radix popper mirrors the
              content's computed z-index onto its wrapper, so lift the menu
              panels above the backdrop while this dialog is open. */}
          <style>{'.shell-menu--model-providers,.shell-menu--model-flyout{z-index:60}'}</style>
          <div className="flex max-h-[88vh] w-full max-w-[860px] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
            {/* Dialog header */}
            <div className="flex h-13 shrink-0 items-center justify-between border-b border-border px-6 py-3">
              <div className="flex items-center gap-3">
                <AgentAvatarView name={draft.name || '?'} avatar={draft.avatar} size={30} />
                <span className="text-[14px] font-semibold text-text">
                  {isNew ? '新建智能体' : `编辑智能体${draft.name ? ` · ${draft.name}` : ''}`}
                </span>
              </div>
              <button
                className="flex h-7 w-7 items-center justify-center rounded-lg text-text-faint hover:bg-hover hover:text-text"
                onClick={closeDrawer}
              >
                <X size={15} />
              </button>
            </div>

            {/* Two-column form */}
            <div className="grid flex-1 gap-x-8 gap-y-5 overflow-y-auto px-6 py-5 md:grid-cols-2">
              {/* ── Left column: identity ── */}
              <div className="space-y-5">
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

                <Field label="人设 / 系统指令">
                  <textarea
                    className="w-full resize-y rounded-lg border border-border bg-page px-3 py-2 font-mono text-[12.5px] leading-relaxed text-text focus:border-accent focus:outline-none"
                    rows={12}
                    placeholder="你是一名经验丰富的前端工程师，专注于 React 和 TypeScript…"
                    value={draft.persona}
                    onChange={(e) => setDraft((d) => ({ ...d, persona: e.target.value }))}
                  />
                </Field>
              </div>

              {/* ── Right column: model & bindings ── */}
              <div className="space-y-5">
                <SectionTitle>模型</SectionTitle>

                {/* Default model — required; empty value is rejected by protocol.
                    Two-level provider → model picker (same widget as the compose bar). */}
                <Field label="默认模型 *">
              <div className="flex h-9 items-center rounded-lg border border-border bg-page px-1.5 focus-within:border-accent">
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
                <div className="max-h-36 space-y-2 overflow-y-auto rounded-lg border border-border bg-page p-2">
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
                            <span className="truncate text-[12.5px] text-text">{m.displayName}</span>
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
                onChange={(e) => setDraft((d) => ({ ...d, reasoningEffort: e.target.value }))}
              >
                {REASONING_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>

            <SectionTitle>
              <span className="inline-flex items-center gap-1">
                <Sparkles size={12} /> Skill 绑定
              </span>
            </SectionTitle>
            <Field label={catalogLoading ? '加载中…' : `已选 ${draft.skillIds.length} 个`}>
              {skillCatalogError ? (
                <div className="flex items-center justify-between gap-2 rounded-lg bg-error/10 px-3 py-2 text-[11.5px] text-error">
                  <span className="min-w-0 truncate">Skill 加载失败：{skillCatalogError}</span>
                  {onManageSkills ? (
                    <button type="button" className="shrink-0 underline" onClick={onManageSkills}>
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
                      className="mt-2 rounded-lg bg-accent-soft px-3 py-1.5 text-[11.5px] font-medium text-accent-text hover:opacity-80"
                      onClick={onManageSkills}
                    >
                      去能力中心导入
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border bg-page p-2">
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
                          disabled={!checked && draft.skillIds.length >= 8}
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
                              <span className="ml-1 text-[11px] text-text-faint">@{s.version}</span>
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
              {draft.skillIds.length >= 8 ? (
                <p className="mt-1 text-[11px] text-warning">最多装备 8 个 Skill；请先取消一个再选择。</p>
              ) : draft.skillIds.length > 0 ? (
                <p className="mt-1 text-[11px] text-text-faint">最多可装备 8 个 Skill</p>
              ) : null}
            </Field>

            <SectionTitle>
              <span className="inline-flex items-center gap-1">
                <Wrench size={12} /> MCP 绑定
              </span>
            </SectionTitle>
            <Field label={catalogLoading ? '加载中…' : `已选 ${draft.mcpServerIds.length} 个`}>
              {mcpServers.length === 0 ? (
                <p className="text-[11.5px] text-text-faint">
                  暂无已注册 MCP 服务器。注册后可在此绑定，对话内可调用其工具。
                </p>
              ) : (
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border bg-page p-2">
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
            </div>

            {/* Footer actions */}
            <div className="flex shrink-0 items-center justify-between border-t border-border px-6 py-3">
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
  return (
    <div className="border-b border-border pb-1 text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">
      {children}
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
  const modelName = models.find((m) => m.modelId === agent.defaultModelId)?.displayName
    ?? agent.defaultModelId
    ?? '未指定模型';
  const skillN = agent.skillIds?.length ?? 0;
  const mcpN = agent.mcpServerIds?.length ?? 0;
  const fallbackN = agent.fallbackModelIds?.length ?? 0;

  return (
    <div
      className={clsx(
        'group relative flex cursor-pointer flex-col gap-3 rounded-xl border p-4 transition-all',
        selected
          ? 'border-accent/40 bg-accent-soft'
          : 'border-border bg-surface hover:border-border-strong hover:shadow-sm',
      )}
      onClick={onClick}
    >
      {/* Card header */}
      <div className="flex items-center gap-3">
        <AgentAvatarView name={agent.name} avatar={agent.avatar} size={40} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-medium text-text">{agent.name}</div>
          <div className="truncate text-[11.5px] text-text-faint">{modelName}</div>
        </div>
        <ChevronRight size={14} className="text-text-faint opacity-0 transition-opacity group-hover:opacity-100" />
      </div>

      {/* Description */}
      {agent.description && (
        <p className="line-clamp-2 text-[12px] text-text-secondary leading-relaxed">
          {agent.description}
        </p>
      )}

      {/* Binding badges */}
      <div className="flex flex-wrap gap-1.5">
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
          className="mt-1 flex h-7 w-full items-center justify-center gap-1.5 rounded-lg border border-border text-[12px] text-text-secondary opacity-0 transition-opacity hover:bg-hover group-hover:opacity-100"
          onClick={(e) => { e.stopPropagation(); onStartConversation(agent.id); }}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] text-text-faint">{label}</label>
      {children}
    </div>
  );
}
