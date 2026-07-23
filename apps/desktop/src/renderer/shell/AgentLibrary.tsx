// P2 · Global Agent Library
// NewMax-style card grid + slide-in edit drawer.
import { Bot, ChevronRight, Plus, Trash2, X } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import clsx from 'clsx';
import type { GlobalAgent, AgentId } from '@sync-think/shared';
import type { ModelOption } from './NewConversationDialog.js';

interface Props {
  agents: readonly GlobalAgent[];
  models: readonly ModelOption[];
  onRefresh(): void;
  /** Called when user clicks "开始对话" from an agent card. */
  onStartConversation?(agentId: string): void;
}

type DraftAgent = {
  name: string;
  avatar: string;
  description: string;
  persona: string;
  defaultModelId: string;
  reasoningEffort: string;
};

const EMPTY_DRAFT: DraftAgent = {
  name: '',
  avatar: '🤖',
  description: '',
  persona: '',
  defaultModelId: '',
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

/** Avatar circle: emoji or first char, color-coded by name. */
function AgentAvatar({ agent, size = 40 }: { agent: GlobalAgent; size?: number }) {
  const colors = [
    '#2f7d4f', '#3568a8', '#7c5ab8', '#b07d2a',
    '#c4453d', '#2b8a8a', '#8a5a2b', '#5a2b8a',
  ];
  const color = colors[(agent.name.charCodeAt(0) || 0) % colors.length];
  const label = agent.avatar && agent.avatar.trim()
    ? agent.avatar.trim().slice(0, 2)
    : (agent.name[0] ?? '?').toUpperCase();
  return (
    <div
      style={{ width: size, height: size, background: color, borderRadius: '50%', fontSize: size * 0.45 }}
      className="flex shrink-0 items-center justify-center text-white select-none"
    >
      {label}
    </div>
  );
}

export function AgentLibrary({ agents, models, onRefresh, onStartConversation }: Props) {
  const [selected, setSelected] = useState<GlobalAgent | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [draft, setDraft] = useState<DraftAgent>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const active = agents.filter((a) => !a.archived);

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
      reasoningEffort: agent.reasoningEffort || 'auto',
    });
    setTimeout(() => nameRef.current?.focus(), 50);
  }, []);

  const closeDrawer = () => {
    setSelected(null);
    setIsNew(false);
  };

  const handleSave = useCallback(async () => {
    if (!draft.name.trim()) return;
    const api = bridge();
    if (!api) return;
    setSaving(true);
    try {
      if (isNew) {
        await api.createGlobalAgent({
          name: draft.name.trim(),
          avatar: draft.avatar,
          description: draft.description,
          persona: draft.persona,
          defaultModelId: draft.defaultModelId as AgentId,
          reasoningEffort: draft.reasoningEffort,
        });
      } else if (selected) {
        await api.updateGlobalAgent({
          agentId: selected.id,
          name: draft.name.trim(),
          avatar: draft.avatar,
          description: draft.description,
          persona: draft.persona,
          defaultModelId: draft.defaultModelId as AgentId,
          reasoningEffort: draft.reasoningEffort,
        });
      }
      onRefresh();
      closeDrawer();
    } finally {
      setSaving(false);
    }
  }, [draft, isNew, selected, onRefresh]);

  const handleDelete = useCallback(async () => {
    if (!selected) return;
    if (!window.confirm(`确定删除智能体「${selected.name}」吗？`)) return;
    const api = bridge();
    if (!api) return;
    setDeleting(true);
    try {
      await api.deleteGlobalAgent({ agentId: selected.id });
      onRefresh();
      closeDrawer();
    } finally {
      setDeleting(false);
    }
  }, [selected, onRefresh]);

  const drawerOpen = isNew || selected !== null;

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* ── Library panel ─────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-5">
          <span className="text-[14px] font-semibold text-text">智能体库</span>
          <button
            className="flex h-7 items-center gap-1.5 rounded-lg bg-accent px-3 text-[12.5px] font-medium text-white hover:opacity-90"
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

      {/* ── Edit drawer ───────────────────────────────────────────── */}
      {drawerOpen && (
        <div className="flex w-[360px] shrink-0 flex-col border-l border-border bg-surface">
          {/* Drawer header */}
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
            <span className="text-[13px] font-semibold text-text">
              {isNew ? '新建智能体' : '编辑智能体'}
            </span>
            <button
              className="flex h-6 w-6 items-center justify-center rounded text-text-faint hover:bg-hover hover:text-text"
              onClick={closeDrawer}
            >
              <X size={14} />
            </button>
          </div>

          {/* Form */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {/* Avatar + Name row */}
            <div className="flex gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-text-faint">头像</label>
                <input
                  className="h-9 w-14 rounded-lg border border-border bg-page text-center text-[18px] focus:border-accent focus:outline-none"
                  value={draft.avatar}
                  onChange={(e) => setDraft((d) => ({ ...d, avatar: e.target.value }))}
                  maxLength={2}
                  title="输入一个 emoji 或字母"
                />
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <label className="text-[11px] text-text-faint">名称 *</label>
                <input
                  ref={nameRef}
                  className="h-9 w-full rounded-lg border border-border bg-page px-3 text-[13px] text-text focus:border-accent focus:outline-none"
                  placeholder="前端小张"
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                />
              </div>
            </div>

            {/* Description */}
            <Field label="简介">
              <input
                className="h-9 w-full rounded-lg border border-border bg-page px-3 text-[13px] text-text focus:border-accent focus:outline-none"
                placeholder="擅长前端开发与调试"
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              />
            </Field>

            {/* Default model */}
            <Field label="默认模型">
              <select
                className="h-9 w-full rounded-lg border border-border bg-page px-3 text-[13px] text-text focus:border-accent focus:outline-none"
                value={draft.defaultModelId}
                onChange={(e) => setDraft((d) => ({ ...d, defaultModelId: e.target.value }))}
              >
                <option value="">不指定</option>
                {models.map((m) => (
                  <option key={m.modelId} value={m.modelId}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </Field>

            {/* Reasoning effort */}
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

            {/* Persona */}
            <Field label="人设 / 系统指令">
              <textarea
                className="w-full resize-none rounded-lg border border-border bg-page px-3 py-2 text-[12.5px] text-text focus:border-accent focus:outline-none"
                rows={6}
                placeholder="你是一名经验丰富的前端工程师，专注于 React 和 TypeScript…"
                value={draft.persona}
                onChange={(e) => setDraft((d) => ({ ...d, persona: e.target.value }))}
              />
            </Field>
          </div>

          {/* Footer actions */}
          <div className="flex shrink-0 items-center justify-between border-t border-border px-4 py-3">
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
        <AgentAvatar agent={agent} size={40} />
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
        className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[12.5px] font-medium text-white hover:opacity-90"
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
