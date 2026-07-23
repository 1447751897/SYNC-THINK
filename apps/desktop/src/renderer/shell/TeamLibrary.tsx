// P2 · Global Team Library
// NewMax-style card grid + slide-in edit drawer with member management.
import { Plus, Trash2, Users, X, ChevronRight, ArrowRight } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import clsx from 'clsx';
import type { GlobalAgent, Team, AgentId, TeamStrategy } from '@sync-think/shared';

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

const ROLES = ['architect', 'builder', 'reviewer', 'pm', 'researcher', 'writer'];

function bridge() {
  return (window as any).syncThink?.runtime;
}

function AgentAvatar({ agent, size = 28 }: { agent: GlobalAgent; size?: number }) {
  const colors = [
    '#2f7d4f', '#3568a8', '#7c5ab8', '#b07d2a',
    '#c4453d', '#2b8a8a', '#8a5a2b', '#5a2b8a',
  ];
  const color = colors[(agent.name.charCodeAt(0) || 0) % colors.length];
  const label = agent.avatar?.trim().slice(0, 2) || (agent.name[0] ?? '?').toUpperCase();
  return (
    <div
      style={{ width: size, height: size, background: color, borderRadius: '50%', fontSize: size * 0.4 }}
      className="flex shrink-0 items-center justify-center text-white select-none"
      title={agent.name}
    >
      {label}
    </div>
  );
}

export function TeamLibrary({ teams, agents, onRefresh, onStartConversation }: Props) {
  const [selected, setSelected] = useState<Team | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [draft, setDraft] = useState<DraftTeam>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
      })),
    });
    setTimeout(() => nameRef.current?.focus(), 50);
  }, []);

  const closeDrawer = () => { setSelected(null); setIsNew(false); };

  const handleSave = useCallback(async () => {
    if (!draft.name.trim()) return;
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
          role: m.role || 'builder',
          title: m.title || m.role,
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
    } finally {
      setSaving(false);
    }
  }, [draft, isNew, selected, onRefresh]);

  const handleDelete = useCallback(async () => {
    if (!selected) return;
    if (!window.confirm(`确定删除小队「${selected.name}」吗？`)) return;
    const api = bridge();
    if (!api) return;
    setDeleting(true);
    try {
      await api.deleteTeam({ teamId: selected.id });
      onRefresh();
      closeDrawer();
    } finally {
      setDeleting(false);
    }
  }, [selected, onRefresh]);

  const addMember = useCallback((agentId: string) => {
    if (draft.members.some((m) => m.agentId === agentId)) return;
    const agent = agents.find((a) => a.id === agentId);
    setDraft((d) => ({
      ...d,
      members: [...d.members, { agentId, role: 'builder', title: agent?.name ?? '' }],
    }));
  }, [draft.members, agents]);

  const removeMember = useCallback((agentId: string) => {
    setDraft((d) => ({
      ...d,
      members: d.members.filter((m) => m.agentId !== agentId),
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
  const availableAgents = agents.filter((a) => !a.archived);
  const unusedAgents = availableAgents.filter(
    (a) => !draft.members.some((m) => m.agentId === a.id),
  );

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* ── Library panel ─────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-5">
          <span className="text-[14px] font-semibold text-text">小队库</span>
          <button
            className="flex h-7 items-center gap-1.5 rounded-lg bg-accent px-3 text-[12.5px] font-medium text-white hover:opacity-90"
            onClick={openNew}
          >
            <Plus size={13} /> 新建小队
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {teams.length === 0 ? (
            <EmptyTeams onNew={openNew} />
          ) : (
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))' }}>
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

      {/* ── Edit drawer ───────────────────────────────────────────── */}
      {drawerOpen && (
        <div className="flex w-[400px] shrink-0 flex-col border-l border-border bg-surface">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
            <span className="text-[13px] font-semibold text-text">
              {isNew ? '新建小队' : '编辑小队'}
            </span>
            <button
              className="flex h-6 w-6 items-center justify-center rounded text-text-faint hover:bg-hover hover:text-text"
              onClick={closeDrawer}
            >
              <X size={14} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
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
                className="w-full resize-none rounded-lg border border-border bg-page px-3 py-2 text-[12.5px] text-text focus:border-accent focus:outline-none"
                rows={3}
                placeholder="负责完整交付功能：从设计到实现到测试"
                value={draft.mission}
                onChange={(e) => setDraft((d) => ({ ...d, mission: e.target.value }))}
              />
            </Field>

            {/* Strategy */}
            <Field label="协作策略">
              <div className="flex gap-2">
                {(['serial', 'parallel'] as TeamStrategy[]).map((s) => (
                  <button
                    key={s}
                    className={clsx(
                      'flex-1 rounded-lg border py-2 text-[12.5px] transition-colors',
                      draft.strategy === s
                        ? 'border-accent/40 bg-accent-soft text-accent-text'
                        : 'border-border text-text-secondary hover:bg-hover',
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

            {/* Members */}
            <Field label={`成员（${draft.members.length}）`}>
              <div className="space-y-1.5">
                {draft.members.map((m) => {
                  const agent = agents.find((a) => a.id === m.agentId);
                  if (!agent) return null;
                  return (
                    <div
                      key={m.agentId}
                      className="flex items-center gap-2 rounded-lg border border-border bg-page px-3 py-2"
                    >
                      <AgentAvatar agent={agent} size={26} />
                      <span className="flex-1 truncate text-[12.5px] text-text">{agent.name}</span>
                      <select
                        className="h-6 rounded border border-border bg-surface px-1.5 text-[11px] text-text-secondary focus:outline-none"
                        value={m.role}
                        onChange={(e) => updateMember(m.agentId, { role: e.target.value })}
                      >
                        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <button
                        className="flex h-5 w-5 items-center justify-center rounded text-text-faint hover:bg-error/10 hover:text-error"
                        onClick={() => removeMember(m.agentId)}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  );
                })}

                {/* Add member */}
                {unusedAgents.length > 0 && (
                  <select
                    className="h-8 w-full rounded-lg border border-dashed border-border bg-page px-3 text-[12px] text-text-faint focus:outline-none"
                    value=""
                    onChange={(e) => { if (e.target.value) addMember(e.target.value); }}
                  >
                    <option value="">＋ 添加成员…</option>
                    {unusedAgents.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                )}
              </div>
            </Field>

            {/* Coordinator */}
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

          {/* Footer */}
          <div className="flex shrink-0 items-center justify-between border-t border-border px-4 py-3">
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
                className="rounded-lg bg-accent px-4 py-1.5 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-40"
                onClick={() => void handleSave()}
                disabled={saving || !draft.name.trim()}
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
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
        'group relative flex cursor-pointer flex-col gap-3 rounded-xl border p-4 transition-all',
        selected
          ? 'border-accent/40 bg-accent-soft'
          : 'border-border bg-surface hover:border-border-strong hover:shadow-sm',
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
      {team.mission && (
        <p className="line-clamp-2 text-[12px] text-text-secondary leading-relaxed">
          {team.mission}
        </p>
      )}

      {/* Member avatars */}
      {memberAgents.length > 0 && (
        <div className="flex items-center gap-1">
          {memberAgents.slice(0, 5).map((a) => (
            <AgentAvatar key={a.id} agent={a} size={22} />
          ))}
          {memberAgents.length > 5 && (
            <span className="text-[11px] text-text-faint">+{memberAgents.length - 5}</span>
          )}
        </div>
      )}

      {/* Start conversation button */}
      {onStartConversation && (
        <button
          className="mt-1 flex h-7 w-full items-center justify-center gap-1.5 rounded-lg border border-border text-[12px] text-text-secondary opacity-0 transition-opacity hover:bg-hover group-hover:opacity-100"
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
        className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[12.5px] font-medium text-white hover:opacity-90"
        onClick={onNew}
      >
        <Plus size={13} /> 新建第一支小队
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
