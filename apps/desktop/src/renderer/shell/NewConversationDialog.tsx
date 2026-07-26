// New-conversation picker (P0.2). Opened by the per-track + buttons in the
// sidebar. Model track shows a provider→model two-level list; agent/team
// tracks list the global libraries with an empty-state pointer to the
// corresponding library stage.
import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Bot, ChevronRight, Search, Sparkles, Users, X } from 'lucide-react';
import clsx from 'clsx';
import type { ConversationTrack, GlobalAgent, Team } from '@sync-think/shared';
import { TRACK_LABELS } from './shell-state.js';

export interface ModelOption {
  modelId: string;
  displayName: string;
  providerName: string;
  /** Configured context window in tokens; undefined falls back to a heuristic. */
  contextWindow?: number;
}

export interface NewConversationDialogProps {
  track: ConversationTrack;
  models: readonly ModelOption[];
  agents: readonly GlobalAgent[];
  teams: readonly Team[];
  draft?: string;
  onPick(targetRef: string): void;
  onGoToLibrary(stage: 'agents' | 'teams'): void;
  onClose(): void;
}

export function NewConversationDialog(props: NewConversationDialogProps) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  return (
    <Dialog.Root open onOpenChange={(open) => !open && props.onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30" />
        <Dialog.Content
          data-testid="new-conversation-dialog"
          className="fixed left-1/2 top-1/2 flex max-h-[70vh] w-[420px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-(--radius-card) border border-border bg-overlay shadow-xl"
        >
          <div className="flex h-11 items-center gap-2 border-b border-border px-4">
            <Dialog.Title className="flex-1 text-[13px] font-medium">
              新建{TRACK_LABELS[props.track]}
            </Dialog.Title>
            <Dialog.Close
              className="flex h-6 w-6 items-center justify-center rounded text-text-faint hover:bg-hover hover:text-text"
              aria-label="关闭"
            >
              <X size={14} />
            </Dialog.Close>
          </div>
          {props.draft !== undefined ? (
            <div className="border-b border-border px-4 py-2 text-[11.5px] text-text-faint">
              将保留当前输入：
              <span className="ml-1 text-text-secondary">
                {props.draft.trim() ? props.draft.trim().slice(0, 72) : '尚未输入内容'}
              </span>
            </div>
          ) : null}
          <div className="flex items-center gap-2 border-b border-border px-4 py-2">
            <Search size={13} className="text-text-faint" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索…"
              className="h-6 flex-1 bg-transparent text-[12.5px] text-text outline-none placeholder:text-text-faint"
            />
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {props.track === 'model' && (
              <ModelList models={props.models} query={q} onPick={props.onPick} />
            )}
            {props.track === 'agent' && (
              <TargetList
                kind="agent"
                query={q}
                items={props.agents.map((a) => ({ id: a.id, name: a.name, hint: a.description }))}
                emptyText="还没有智能体"
                emptyAction="去智能体库创建"
                onPick={props.onPick}
                onEmptyAction={() => props.onGoToLibrary('agents')}
              />
            )}
            {props.track === 'team' && (
              <TargetList
                kind="team"
                query={q}
                items={props.teams.map((t) => ({
                  id: t.id,
                  name: t.name,
                  hint: `${t.members.length} 名成员 · ${t.strategy === 'serial' ? '串行' : '并行'}`,
                }))}
                emptyText="还没有小队"
                emptyAction="去小队库创建"
                onPick={props.onPick}
                onEmptyAction={() => props.onGoToLibrary('teams')}
              />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ModelList(props: {
  models: readonly ModelOption[];
  query: string;
  onPick(id: string): void;
}) {
  const grouped = useMemo(() => {
    const byProvider = new Map<string, ModelOption[]>();
    for (const model of props.models) {
      if (props.query && !model.displayName.toLowerCase().includes(props.query)) continue;
      const list = byProvider.get(model.providerName) ?? [];
      list.push(model);
      byProvider.set(model.providerName, list);
    }
    return [...byProvider.entries()];
  }, [props.models, props.query]);

  if (props.models.length === 0) {
    return (
      <EmptyState
        icon={<Sparkles size={20} />}
        text="还没有可用模型"
        hint="先在设置里添加 Provider，或从 CC Switch 导入"
      />
    );
  }
  if (grouped.length === 0) {
    return <EmptyState icon={<Search size={20} />} text="没有匹配的模型" />;
  }
  return (
    <>
      {grouped.map(([providerName, models]) => (
        <div key={providerName} className="mb-1">
          <div className="px-2 py-1 text-[11px] font-medium text-text-faint">{providerName}</div>
          {models.map((model) => (
            <button
              key={model.modelId}
              data-testid={`pick-model-${model.modelId}`}
              className="flex h-8 w-full items-center gap-2 rounded-(--radius-row) px-2 text-left hover:bg-hover"
              onClick={() => props.onPick(model.modelId)}
            >
              <Sparkles size={13} className="text-text-secondary" />
              <span className="flex-1 truncate text-[12.5px]">{model.displayName}</span>
              <ChevronRight size={13} className="text-text-faint" />
            </button>
          ))}
        </div>
      ))}
    </>
  );
}

function TargetList(props: {
  kind: 'agent' | 'team';
  query: string;
  items: readonly { id: string; name: string; hint?: string }[];
  emptyText: string;
  emptyAction: string;
  onPick(id: string): void;
  onEmptyAction(): void;
}) {
  const Icon = props.kind === 'agent' ? Bot : Users;
  const filtered = props.query
    ? props.items.filter((item) => item.name.toLowerCase().includes(props.query))
    : props.items;

  if (props.items.length === 0) {
    return (
      <EmptyState
        icon={<Icon size={20} />}
        text={props.emptyText}
        action={props.emptyAction}
        onAction={props.onEmptyAction}
      />
    );
  }
  if (filtered.length === 0) {
    return <EmptyState icon={<Search size={20} />} text="没有匹配的结果" />;
  }
  return (
    <>
      {filtered.map((item) => (
        <button
          key={item.id}
          data-testid={`pick-${props.kind}-${item.id}`}
          className="flex h-9 w-full items-center gap-2 rounded-(--radius-row) px-2 text-left hover:bg-hover"
          onClick={() => props.onPick(item.id)}
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-soft text-accent-text">
            <Icon size={13} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px]">{item.name}</span>
            {item.hint && (
              <span className="block truncate text-[11px] text-text-faint">{item.hint}</span>
            )}
          </span>
          <ChevronRight size={13} className="text-text-faint" />
        </button>
      ))}
    </>
  );
}

function EmptyState(props: {
  icon: React.ReactNode;
  text: string;
  hint?: string;
  action?: string;
  onAction?(): void;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-text-faint">
      {props.icon}
      <div className="text-[12.5px] text-text-secondary">{props.text}</div>
      {props.hint && <div className="text-[11px]">{props.hint}</div>}
      {props.action && (
        <button
          data-testid="empty-action"
          className={clsx(
            'mt-1 rounded-(--radius-row) bg-accent-soft px-3 py-1.5 text-[12px] text-accent-text',
            'hover:opacity-90',
          )}
          onClick={props.onAction}
        >
          {props.action}
        </button>
      )}
    </div>
  );
}
