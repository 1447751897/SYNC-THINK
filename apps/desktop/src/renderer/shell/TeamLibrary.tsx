// P2 · Global Team Library
// NewMax-style card grid + centered two-column edit dialog with member management.
import { Plus, Trash2, Users, X, ChevronRight, ArrowRight, Pencil } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import type { GlobalAgent, Team, AgentId, TeamStrategy } from '@sync-think/shared';
import { useDialog } from './Dialog.js';
import { AgentAvatarView } from './AgentAvatarView.js';

interface Props {
  teams: readonly Team[];
  agents: readonly GlobalAgent[];
  onRefresh(): void;
  onStartConversation?(teamId: string): void;
}

type DraftMember = {
  agentId: string;
  role: string;
  title: string;
  dependsOn: string[];
};

type DraftTeam = {
  name: string;
  avatar: string;
  mission: string;
  strategy: TeamStrategy;
  coordinatorAgentId: string;
  members: DraftMember[];
};

const EMPTY_DRAFT: DraftTeam = {
  name: '',
  avatar: '👥',
  mission: '',
  strategy: 'serial',
  coordinatorAgentId: '',
  members: [],
};

/**
 * Meaningful role presets. Member roles are free-form strings in the data
 * model (chat-created teams may use "member" or Chinese labels), so any value
 * outside this list is treated as a custom role and displayed verbatim —
 * previously a controlled <select> with an off-list value silently rendered
 * the first option, making every member look like "architect".
 */
const ROLE_PRESETS: readonly { value: string; label: string }[] = [
  { value: 'coordinator', label: '协调' },
  { value: 'architect', label: '架构' },
  { value: 'builder', label: '开发' },
  { value: 'reviewer', label: '评审' },
  { value: 'researcher', label: '调研' },
  { value: 'writer', label: '写作' },
  { value: 'pm', label: '产品' },
];

const CUSTOM_ROLE = '__custom__';

function roleLabel(role: string): string {
  const preset = ROLE_PRESETS.find((r) => r.value === role);
  return preset ? preset.label : role;
}

function bridge() {
  return window.syncThink?.runtime;
}

function AgentAvatar({ agent, size = 28 }: { agent: GlobalAgent; size?: number }) {
  return <AgentAvatarView name={agent.name} avatar={agent.avatar} size={size} />;
}

export function TeamLibrary({ teams, agents, onRefresh, onStartConversation }: Props) {
  const dialog = useDialog();
  const [selected, setSelected] = useState<Team | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [draft, setDraft] = useState<DraftTeam>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [memberModal, setMemberModal] = useState<
    | { mode: 'add' }
    | { mode: 'edit'; agentId: string }
    | null
  >(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const openNew = useCallback(() => {
    setIsNew(true);
    setSelected(null);
    setDraft({ ...EMPTY_DRAFT });
    setTimeout(() => nameRef.current?.focus(), 50);
  }, []);

  const openEdit = useCallback((team: Team) => {
    setIsNew(false);
    setSelected(team);
    setDraft({
      name: team.name,
      avatar: team.avatar,
      mission: team.mission,
      strategy: team.strategy,
      coordinatorAgentId: team.coordinatorAgentId ?? '',
      members: team.members.map((m) => ({
        agentId: m.agentId,
        role: m.role,
        title: m.title,
        dependsOn: [...m.dependsOn],
      })),
    });
    setTimeout(() => nameRef.current?.focus(), 50);
  }, []);

  const closeDrawer = () => { setSelected(null); setIsNew(false); setMemberModal(null); };

  const handleSave = useCallback(async () => {
    if (!draft.name.trim()) return;
    if (draft.members.length === 0) {
      await dialog.alert({
        title: '请添加成员',
        message: '小队至少需要一名智能体成员。',
      });
      return;
    }
    const api = bridge();
    if (!api) return;
    setSaving(true);
    try {
      const payload = {
        name: draft.name.trim(),
        avatar: draft.avatar,
        mission: draft.mission,
        strategy: draft.strategy,
        coordinatorAgentId: draft.coordinatorAgentId as AgentId || undefined,
        members: draft.members.map((m, i) => ({
          agentId: m.agentId as AgentId,
          role: m.role.trim() || 'builder',
          title: m.title.trim() || m.role.trim() || 'builder',
          dependsOn: m.dependsOn as AgentId[],
          memberOrder: i,
        })),
      };
      if (isNew) {
        await api.createTeam(payload);
      } else if (selected) {
        await api.updateTeam({ teamId: selected.id, ...payload });
      }
      onRefresh();
      closeDrawer();
    } catch (error) {
      await dialog.alert({
        title: '保存失败',
        message: error instanceof Error ? error.message : '保存小队失败',
      });
    } finally {
      setSaving(false);
    }
  }, [dialog, draft, isNew, selected, onRefresh]);

  const handleDelete = useCallback(async () => {
    if (!selected) return;
    if (
      !(await dialog.confirm({
        title: '删除小队',
        message: `确定删除小队「${selected.name}」吗？若仍有对话引用或历史运行，将无法删除。`,
        confirmText: '删除',
        danger: true,
      }))
    )
      return;
    const api = bridge();
    if (!api) return;
    setDeleting(true);
    try {
      await api.deleteTeam({ teamId: selected.id });
      onRefresh();
      closeDrawer();
    } catch (error) {
      await dialog.alert({
        title: '删除失败',
        message: error instanceof Error ? error.message : '删除小队失败',
      });
    } finally {
      setDeleting(false);
    }
  }, [dialog, selected, onRefresh]);

  const addMember = useCallback((member: DraftMember) => {
    setDraft((d) => {
      if (d.members.some((m) => m.agentId === member.agentId)) return d;
      return { ...d, members: [...d.members, member] };
    });
  }, []);

  const removeMember = useCallback((agentId: string) => {
    setDraft((d) => ({
      ...d,
      members: d.members
        .filter((m) => m.agentId !== agentId)
        .map((m) => ({ ...m, dependsOn: m.dependsOn.filter((dep) => dep !== agentId) })),
      coordinatorAgentId: d.coordinatorAgentId === agentId ? '' : d.coordinatorAgentId,
    }));
  }, []);

  const updateMember = useCallback((agentId: string, patch: Partial<DraftMember>) => {
    setDraft((d) => ({
      ...d,
      members: d.members.map((m) => m.agentId === agentId ? { ...m, ...patch } : m),
    }));
  }, []);

  const drawerOpen = isNew || selected !== null;

  // Esc closes the topmost layer only: the member modal first (it has its own
  // listener too — both just close the member modal, which is idempotent), and
  // the team dialog only when no member modal is stacked on top.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (memberModal) {
        setMemberModal(null);
        return;
      }
      setSelected(null);
      setIsNew(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen, memberModal]);

  const availableAgents = agents.filter((a) => !a.archived);
  const unusedAgents = availableAgents.filter(
    (a) => !draft.members.some((m) => m.agentId === a.id),
  );

  return (
    <div className="shell-library-page">
      {/* ── Library panel ─────────────────────────────────────────── */}
      <div className="shell-library-panel">
        <div className="shell-library-header">
          <span className="text-[14px] font-semibold text-text">小队库</span>
          <button
            className="shell-library-primary-action"
            onClick={openNew}
          >
            <Plus size={13} /> 新建小队
          </button>
        </div>

        <div className="shell-library-content">
          {teams.length === 0 ? (
            <EmptyTeams onNew={openNew} />
          ) : (
            <div className="shell-library-grid">
              {teams.map((team) => (
                <TeamCard
                  key={team.id}
                  team={team}
                  agents={agents}
                  selected={selected?.id === team.id}
                  onClick={() => openEdit(team)}
                  onStartConversation={onStartConversation}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Edit drawer. Left: identity & coordinator. Right: members.
            The stacked MemberModal (st-member-modal-backdrop, z-220) renders
            above this backdrop (z-50). ── */}
      {drawerOpen && (
        <div
          className="shell-library-drawer-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeDrawer();
          }}
        >
          <div
            className="shell-library-drawer shell-library-drawer--team"
            data-testid="team-detail-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={isNew ? '新建小队' : '编辑小队'}
          >
            {/* 身份卡：图标 + 名称 + 使命，常驻顶部（替代旧 header） */}
            {!isNew ? (
              <div
                className="shell-agent-identity"
                data-testid="team-identity-card"
              >
                <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-accent-soft text-[24px] leading-none">
                  {draft.avatar || '👥'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold text-text">
                    {draft.name || '未命名小队'}
                  </div>
                  {draft.mission ? (
                    <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-text-secondary">
                      {draft.mission}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-[12px] text-text-faint">暂无使命</p>
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
              /* 新建态顶端仅放标题+关闭 */
              <div className="shell-agent-identity shell-agent-identity--bare">
                <span className="text-[13px] font-medium text-text">新建小队</span>
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

            {/* 单列分组卡片表单：身份 / 策略 / 成员 */}
            <div className="shell-library-drawer__body">
              <div className="shell-library-pane">

                {/* ── 基本信息 ── */}
                <div className="shell-agent-setting-group space-y-5">
                  <SectionTitle>基本信息</SectionTitle>
                  {/* Avatar + Name */}
                  <div className="flex gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] text-text-faint">图标</label>
                      <input
                        className="h-9 w-14 rounded-lg border border-border bg-page text-center text-[18px] focus:border-accent focus:outline-none"
                        value={draft.avatar}
                        onChange={(e) => setDraft((d) => ({ ...d, avatar: e.target.value }))}
                        maxLength={2}
                      />
                    </div>
                    <div className="flex flex-1 flex-col gap-1">
                      <label className="text-[11px] text-text-faint">名称 *</label>
                      <input
                        ref={nameRef}
                        className="h-9 w-full rounded-lg border border-border bg-page px-3 text-[13px] text-text focus:border-accent focus:outline-none"
                        placeholder="交付小队"
                        value={draft.name}
                        onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                      />
                    </div>
                  </div>
                  {/* Mission */}
                  <Field label="使命 / 总目标">
                    <textarea
                      className="w-full resize-y rounded-lg border border-border bg-page px-3 py-2 text-[12.5px] text-text focus:border-accent focus:outline-none"
                      rows={5}
                      placeholder="负责完整交付功能：从设计到实现到测试"
                      value={draft.mission}
                      onChange={(e) => setDraft((d) => ({ ...d, mission: e.target.value }))}
                    />
                  </Field>
                </div>

                {/* ── 协作策略 ── */}
                <div className="shell-agent-setting-group space-y-5">
                  <SectionTitle>协作策略</SectionTitle>
                  <Field label="执行方式">
                    <div className="flex gap-2">
                      {(['serial', 'parallel'] as TeamStrategy[]).map((s) => (
                        <button
                          key={s}
                          className={clsx(
                            'shell-library-option flex-1',
                            draft.strategy === s
                              ? 'shell-library-option--selected'
                              : undefined,
                          )}
                          onClick={() => setDraft((d) => ({ ...d, strategy: s }))}
                        >
                          {s === 'serial' ? '串行' : '并行'}
                          <span className="ml-1 text-[10px] text-text-faint">
                            {s === 'serial' ? '（依次执行）' : '（同时执行）'}
                          </span>
                        </button>
                      ))}
                    </div>
                  </Field>
                  {/* Coordinator — only meaningful when there are members */}
                  {draft.members.length > 0 && (
                    <Field label="统筹智能体（可代审分工卡）">
                      <select
                        className="h-9 w-full rounded-lg border border-border bg-page px-3 text-[13px] text-text focus:border-accent focus:outline-none"
                        value={draft.coordinatorAgentId}
                        onChange={(e) => setDraft((d) => ({ ...d, coordinatorAgentId: e.target.value }))}
                      >
                        <option value="">无（由用户确认）</option>
                        {draft.members.map((m) => {
                          const a = agents.find((ag) => ag.id === m.agentId);
                          return a ? <option key={m.agentId} value={m.agentId}>{a.name}</option> : null;
                        })}
                      </select>
                    </Field>
                  )}
                </div>

                {/* ── 成员 ── */}
                <div className="shell-agent-setting-group space-y-5">
                  <SectionTitle>成员（{draft.members.length}）</SectionTitle>
                  <div className="space-y-1.5">
                    {draft.members.map((m) => {
                      const agent = agents.find((a) => a.id === m.agentId);
                      if (!agent) return null;
                      return (
                        <div
                          key={m.agentId}
                          className="shell-library-subpanel st-member-row group/member flex cursor-pointer items-center gap-2.5 px-3 py-2 transition-colors hover:border-border-strong"
                          role="button"
                          tabIndex={0}
                          onClick={() => setMemberModal({ mode: 'edit', agentId: m.agentId })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setMemberModal({ mode: 'edit', agentId: m.agentId });
                            }
                          }}
                        >
                          <AgentAvatar agent={agent} size={26} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[12.5px] text-text">
                              {m.title.trim() || agent.name}
                            </div>
                            {m.title.trim() && m.title.trim() !== agent.name && (
                              <div className="truncate text-[10.5px] text-text-faint">{agent.name}</div>
                            )}
                          </div>
                          <span className="st-member-role-chip shrink-0">{roleLabel(m.role)}</span>
                          <Pencil
                            size={12}
                            className="shrink-0 text-text-faint opacity-0 transition-opacity group-hover/member:opacity-100"
                          />
                          <button
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-faint hover:bg-error/10 hover:text-error"
                            title="移除成员"
                            onClick={(e) => { e.stopPropagation(); removeMember(m.agentId); }}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      );
                    })}

                    {/* Add member */}
                    <button
                      className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-page text-[12px] text-text-faint transition-colors hover:border-border-strong hover:text-text-secondary disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={unusedAgents.length === 0}
                      onClick={() => setMemberModal({ mode: 'add' })}
                    >
                      <Plus size={12} />
                      {unusedAgents.length === 0 ? '所有智能体均已加入' : '添加成员…'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

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
              ) : <span />}
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
                  disabled={saving || !draft.name.trim()}
                >
                  {saving ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Member add / edit modal ───────────────────────────────── */}
      {memberModal && (
        <MemberModal
          mode={memberModal.mode}
          agents={availableAgents}
          unusedAgents={unusedAgents}
          members={draft.members}
          member={
            memberModal.mode === 'edit'
              ? draft.members.find((m) => m.agentId === memberModal.agentId) ?? null
              : null
          }
          onClose={() => setMemberModal(null)}
          onSubmit={(member) => {
            if (memberModal.mode === 'add') {
              addMember(member);
            } else {
              updateMember(memberModal.agentId, member);
            }
            setMemberModal(null);
          }}
        />
      )}
    </div>
  );
}

// ── Member modal ────────────────────────────────────────────────────────────

function MemberModal({
  mode, agents, unusedAgents, members, member, onClose, onSubmit,
}: {
  mode: 'add' | 'edit';
  agents: readonly GlobalAgent[];
  unusedAgents: readonly GlobalAgent[];
  members: readonly DraftMember[];
  member: DraftMember | null;
  onClose(): void;
  onSubmit(member: DraftMember): void;
}) {
  const isPreset = (role: string) => ROLE_PRESETS.some((r) => r.value === role);
  const [agentId, setAgentId] = useState(member?.agentId ?? unusedAgents[0]?.id ?? '');
  const [roleChoice, setRoleChoice] = useState(() => {
    const role = member?.role ?? 'builder';
    return isPreset(role) ? role : CUSTOM_ROLE;
  });
  const [customRole, setCustomRole] = useState(() => {
    const role = member?.role ?? '';
    return isPreset(role) ? '' : role;
  });
  const [title, setTitle] = useState(member?.title ?? '');
  const [dependsOn, setDependsOn] = useState<string[]>(member?.dependsOn ?? []);
  const firstFieldRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const agent = agents.find((a) => a.id === agentId);
  const resolvedRole = roleChoice === CUSTOM_ROLE ? customRole.trim() : roleChoice;
  const canSubmit = agentId !== '' && resolvedRole !== '';
  // Other members are valid dependency targets (self excluded).
  const dependencyCandidates = members.filter((m) => m.agentId !== agentId);

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      agentId,
      role: resolvedRole,
      title: title.trim(),
      dependsOn: dependsOn.filter((dep) => dep !== agentId),
    });
  };

  return (
    <div
      className="st-member-modal-backdrop"
      data-testid="team-member-modal"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="st-member-modal"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'add' ? '添加成员' : '编辑成员'}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <span className="text-[14px] font-semibold text-text">
            {mode === 'add' ? '添加成员' : '编辑成员'}
          </span>
          <button
            className="flex h-6 w-6 items-center justify-center rounded text-text-faint hover:bg-hover hover:text-text"
            title="关闭"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[min(60vh,480px)] space-y-4 overflow-y-auto px-5 py-4">
          {/* Agent picker (add) / identity (edit) */}
          {mode === 'add' ? (
            <Field label="智能体 *">
              <select
                ref={firstFieldRef}
                className="h-9 w-full rounded-lg border border-border bg-page px-3 text-[13px] text-text focus:border-accent focus:outline-none"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
              >
                {unusedAgents.length === 0 && <option value="">（没有可添加的智能体）</option>}
                {unusedAgents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              {agent?.description && (
                <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-text-faint">
                  {agent.description}
                </p>
              )}
            </Field>
          ) : (
            agent && (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-page px-3 py-2.5">
                <AgentAvatar agent={agent} size={32} />
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-text">{agent.name}</div>
                  {agent.description && (
                    <div className="truncate text-[11px] text-text-faint">{agent.description}</div>
                  )}
                </div>
              </div>
            )
          )}

          {/* Title */}
          <Field label="头衔 / 显示名称">
            <input
              className="h-9 w-full rounded-lg border border-border bg-page px-3 text-[13px] text-text focus:border-accent focus:outline-none"
              placeholder={agent?.name ?? '如：前端负责人'}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>

          {/* Role */}
          <Field label="角色 *">
            <div className="grid grid-cols-4 gap-1.5">
              {ROLE_PRESETS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  className={clsx(
                    'st-role-option',
                    roleChoice === r.value && 'st-role-option--active',
                  )}
                  onClick={() => setRoleChoice(r.value)}
                >
                  {r.label}
                  <span className="block text-[9.5px] opacity-70">{r.value}</span>
                </button>
              ))}
              <button
                type="button"
                className={clsx(
                  'st-role-option',
                  roleChoice === CUSTOM_ROLE && 'st-role-option--active',
                )}
                onClick={() => setRoleChoice(CUSTOM_ROLE)}
              >
                自定义
                <span className="block text-[9.5px] opacity-70">custom</span>
              </button>
            </div>
            {roleChoice === CUSTOM_ROLE && (
              <input
                className="mt-1.5 h-9 w-full rounded-lg border border-border bg-page px-3 text-[13px] text-text focus:border-accent focus:outline-none"
                placeholder="输入自定义角色，如 tester / 数据分析"
                autoFocus
                value={customRole}
                onChange={(e) => setCustomRole(e.target.value)}
              />
            )}
          </Field>

          {/* Dependencies */}
          {dependencyCandidates.length > 0 && (
            <Field label="依赖成员（需等待其完成）">
              <div className="space-y-1">
                {dependencyCandidates.map((m) => {
                  const depAgent = agents.find((a) => a.id === m.agentId);
                  if (!depAgent) return null;
                  const checked = dependsOn.includes(m.agentId);
                  return (
                    <label
                      key={m.agentId}
                      className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-page px-3 py-1.5 transition-colors hover:border-border-strong"
                    >
                      <input
                        type="checkbox"
                        className="accent-[var(--color-accent)]"
                        checked={checked}
                        onChange={(e) =>
                          setDependsOn((prev) =>
                            e.target.checked
                              ? [...prev, m.agentId]
                              : prev.filter((id) => id !== m.agentId),
                          )
                        }
                      />
                      <AgentAvatar agent={depAgent} size={20} />
                      <span className="flex-1 truncate text-[12px] text-text">
                        {m.title.trim() || depAgent.name}
                      </span>
                      <span className="st-member-role-chip">{roleLabel(m.role)}</span>
                    </label>
                  );
                })}
              </div>
            </Field>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            className="rounded-lg border border-border px-3 py-1.5 text-[12.5px] text-text-secondary hover:bg-hover"
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="rounded-lg bg-accent px-4 py-1.5 text-[12.5px] font-medium text-[var(--color-accent-fg)] hover:opacity-90 disabled:opacity-40"
            disabled={!canSubmit}
            onClick={submit}
          >
            {mode === 'add' ? '添加' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function TeamCard({
  team, agents, selected, onClick, onStartConversation,
}: {
  team: Team;
  agents: readonly GlobalAgent[];
  selected: boolean;
  onClick(): void;
  onStartConversation?: (teamId: string) => void;
}) {
  const memberAgents = team.members
    .map((m) => agents.find((a) => a.id === m.agentId))
    .filter(Boolean) as GlobalAgent[];

  return (
    <div
      className={clsx(
        'shell-library-card group',
        selected && 'shell-library-card--selected',
      )}
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[20px]">
          {team.avatar || '👥'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-medium text-text">{team.name}</div>
          <div className="flex items-center gap-1.5 text-[11.5px] text-text-faint">
            <span>{team.members.length} 名成员</span>
            <span>·</span>
            <span>{team.strategy === 'serial' ? '串行' : '并行'}</span>
          </div>
        </div>
        <ChevronRight size={14} className="text-text-faint opacity-0 transition-opacity group-hover:opacity-100" />
      </div>

      {/* Mission */}
      <p
        className="shell-library-card__description"
        data-empty={team.mission ? undefined : '1'}
      >
        {team.mission || '暂无小队使命'}
      </p>

      {/* Member avatars */}
      <div className="shell-library-card__meta">
        {memberAgents.length > 0 ? (
          <>
          {memberAgents.slice(0, 5).map((a) => (
            <AgentAvatar key={a.id} agent={a} size={22} />
          ))}
          {memberAgents.length > 5 && (
            <span className="text-[11px] text-text-faint">+{memberAgents.length - 5}</span>
          )}
          </>
        ) : (
          <span className="text-[11px] text-text-faint">尚未添加成员</span>
        )}
      </div>

      {/* Start conversation button */}
      {onStartConversation && (
        <button
          className="shell-library-card__action"
          onClick={(e) => { e.stopPropagation(); onStartConversation(team.id); }}
        >
          <ArrowRight size={12} /> 开始小队对话
        </button>
      )}
    </div>
  );
}

function EmptyTeams({ onNew }: { onNew(): void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 py-20 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft">
        <Users size={24} className="text-accent-text" />
      </div>
      <div>
        <p className="text-[14px] font-medium text-text">还没有小队</p>
        <p className="mt-1 text-[12px] text-text-faint">将多个智能体组合成小队，分工协作完成复杂任务</p>
      </div>
      <button
        className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[12.5px] font-medium text-[var(--color-accent-fg)] hover:opacity-90"
        onClick={onNew}
      >
        <Plus size={13} /> 新建第一支小队
      </button>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="shell-library-section-title">{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="shell-library-field">
      <label className="text-[11px] text-text-faint">{label}</label>
      {children}
    </div>
  );
}
