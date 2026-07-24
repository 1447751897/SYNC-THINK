// New shell root (2026-07-22 renderer rewrite). Mounted from shell-entry.tsx.
// Phase 1 scope: NewMax-style sidebar + stage switching + conversation CRUD
// against the runtime bridge. Chat stage renders the conversation head; the
// message stream is wired in the next slice.
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type {
  Conversation,
  ConversationTrack,
  Event,
  GlobalAgent,
  Team,
  WorkspaceId,
} from '@sync-think/shared';
import type { WorkspaceSummary } from '@sync-think/protocol';
import { mergeEventHistory } from '../../event-history.js';
import { Sidebar } from './Sidebar.js';
import { TopBar } from './TopBar.js';
import { ChatView } from './ChatView.js';
import { AgentLibrary } from './AgentLibrary.js';
import { TeamLibrary } from './TeamLibrary.js';
import { SettingsPage } from './SettingsPage.js';
import { NewConversationDialog, type ModelOption } from './NewConversationDialog.js';
import { startRuntimeConnection } from '../runtime-connection.js';
import {
  filterByWorkspace,
  INITIAL_NAV,
  openConversation,
  selectStage,
  STAGE_LABELS,
  targetName,
  toggleSidebar,
  toggleTrack,
  type ShellNavState,
} from './shell-state.js';

interface ShellData {
  conversations: Conversation[];
  agents: GlobalAgent[];
  teams: Team[];
  /** modelId → displayName from the provider catalog. */
  modelNames: Map<string, string>;
  models: ModelOption[];
  workspaces: WorkspaceSummary[];
}

const EMPTY: ShellData = {
  conversations: [],
  agents: [],
  teams: [],
  modelNames: new Map(),
  models: [],
  workspaces: [],
};

function bridge() {
  return window.syncThink?.runtime;
}

export function ShellApp() {
  const [nav, setNav] = useState<ShellNavState>(INITIAL_NAV);
  const [data, setData] = useState<ShellData>(EMPTY);
  /** Durable runtime event history used to rehydrate chat when reopening a conversation. */
  const [eventHistory, setEventHistory] = useState<readonly Event[]>([]);
  /** Which track's new-conversation picker is open; null = closed. */
  const [pickerTrack, setPickerTrack] = useState<ConversationTrack | null>(null);
  /** Settings modal open state (overlay, not page replacement). */
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Active project tab; undefined = 全部. */
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | undefined>(undefined);
  /** Cold-start status for the sidebar (connect + first listConversations). */
  const [bootState, setBootState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [bootError, setBootError] = useState<string | undefined>(undefined);

  const refresh = useCallback(async () => {
    const api = bridge();
    if (!api) return;
    const [conversations, agents, teams, providers, workspaces] = await Promise.all([
      // includeArchived so the sidebar can render the bottom「归档」section.
      api.listConversations({ includeArchived: true }),
      api.listGlobalAgents({}),
      api.listTeams(),
      api.listProviders({}),
      api.listWorkspaces({}),
    ]);
    const modelNames = new Map<string, string>();
    const models: ModelOption[] = [];
    // Disabled providers stay configured but hide from pickers (0026 / NewMax parity).
    for (const provider of providers.providers) {
      if (provider.enabled === false) continue;
      for (const model of provider.models) {
        modelNames.set(model.modelId, model.displayName);
        models.push({
          modelId: model.modelId,
          displayName: model.displayName,
          providerName: provider.name,
        });
      }
    }
    setData({
      conversations: conversations.conversations,
      agents: agents.agents,
      teams: teams.teams,
      modelNames,
      models,
      workspaces: workspaces.workspaces,
    });
  }, []);

  useEffect(() => {
    const api = bridge();
    if (!api) {
      setBootState('error');
      setBootError('渲染进程未注入 runtime bridge');
      return;
    }

    let cancelled = false;
    setBootState('loading');
    setBootError(undefined);

    // Keep a shell-level event history so reopening a conversation can project
    // durable messages (message.appended / message.delta / run.completed).
    // Events continue arriving in the background while the sidebar is already usable.
    const unsub = api.onEvent?.((event: Event) => {
      setEventHistory((prev) => mergeEventHistory(prev, [event]));
    });

    // Retryable connect: main process may still be spawning Runtime on cold start.
    // Without retries the sidebar stays on「加载中…」or looks frozen after rebuild.
    const stopConnect = startRuntimeConnection({
      connect: () => api.connect(),
      retryDelaysMs: [300, 600, 1_200, 2_000, 3_000],
      onConnected: (result) => {
        if (cancelled) return;
        setEventHistory((prev) => mergeEventHistory(prev, result.snapshot));
        void refresh()
          .then(() => {
            if (!cancelled) {
              setBootState('ready');
              setBootError(undefined);
            }
          })
          .catch((error) => {
            if (cancelled) return;
            setBootState('error');
            setBootError(error instanceof Error ? error.message : '加载对话列表失败');
          });
      },
      onFailed: (error) => {
        if (cancelled) return;
        setBootError(error.code);
        // Still try list* in case a partial runtime is up.
        void refresh()
          .then(() => {
            if (!cancelled) setBootState('ready');
          })
          .catch(() => {
            if (!cancelled) setBootState('error');
          });
      },
    });

    return () => {
      cancelled = true;
      stopConnect();
      unsub?.();
    };
  }, [refresh]);

  const handlePickTarget = useCallback(
    async (track: ConversationTrack, targetRef: string) => {
      const api = bridge();
      if (!api) return;
      setPickerTrack(null);
      const created = await api.createConversation({
        track,
        targetRef,
        workspaceId: activeWorkspaceId as WorkspaceId | undefined,
      });
      await refresh();
      setNav((n) => openConversation(n, created.conversation.id));
    },
    [activeWorkspaceId, refresh],
  );

  const handleOpenFolder = useCallback(async () => {
    const api = bridge();
    if (!api) return;
    const picked = await api.pickFolder();
    if (picked.canceled || !picked.path) return;
    const name =
      picked.path
        .replace(/[\\/]+$/, '')
        .split(/[\\/]/)
        .pop() ?? picked.path;
    const created = await api.createWorkspace({ name, folderPath: picked.path });
    await refresh();
    setActiveWorkspaceId(created.workspaceId);
  }, [refresh]);

  const handleTogglePin = useCallback(
    async (id: string, pinned: boolean) => {
      const api = bridge();
      if (!api) return;
      await api.setConversationPinned({
        conversationId: id as Parameters<typeof api.setConversationPinned>[0]['conversationId'],
        pinned,
      });
      await refresh();
    },
    [refresh],
  );

  const handleRename = useCallback(
    async (id: string, currentTitle: string) => {
      const api = bridge();
      if (!api) return;
      // Native prompt keeps this slice minimal; inline editing can follow.
      const title = window.prompt('重命名对话', currentTitle);
      if (title === null) return;
      const trimmed = title.trim();
      if (!trimmed || trimmed === currentTitle) return;
      await api.renameConversation({
        conversationId: id as Parameters<typeof api.renameConversation>[0]['conversationId'],
        title: trimmed,
      });
      await refresh();
    },
    [refresh],
  );

  const handleArchive = useCallback(
    async (id: string) => {
      const api = bridge();
      if (!api) return;
      await api.setConversationArchived({
        conversationId: id as Parameters<typeof api.setConversationArchived>[0]['conversationId'],
        archived: true,
      });
      setNav((n) =>
        n.selectedConversationId === id ? { ...n, selectedConversationId: undefined } : n,
      );
      await refresh();
    },
    [refresh],
  );

  const handleUnarchive = useCallback(
    async (id: string) => {
      const api = bridge();
      if (!api) return;
      await api.setConversationArchived({
        conversationId: id as Parameters<typeof api.setConversationArchived>[0]['conversationId'],
        archived: false,
      });
      await refresh();
    },
    [refresh],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      const api = bridge();
      if (!api) return;
      if (!window.confirm('删除后无法恢复，确定删除这条对话吗？')) return;
      await api.deleteConversation({
        conversationId: id as Parameters<typeof api.deleteConversation>[0]['conversationId'],
      });
      setNav((n) =>
        n.selectedConversationId === id ? { ...n, selectedConversationId: undefined } : n,
      );
      await refresh();
    },
    [refresh],
  );

  const visibleConversations = useMemo(
    () => filterByWorkspace(data.conversations, activeWorkspaceId),
    [data.conversations, activeWorkspaceId],
  );

  const selected = data.conversations.find((c) => c.id === nav.selectedConversationId);

  return (
    <div className="flex h-full flex-col">
      <TopBar
        workspaces={data.workspaces}
        activeWorkspaceId={activeWorkspaceId}
        onSelectWorkspace={setActiveWorkspaceId}
        onOpenFolder={() => void handleOpenFolder()}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          nav={nav}
          settingsOpen={settingsOpen}
          conversations={visibleConversations}
          agents={data.agents}
          teams={data.teams}
          modelNames={data.modelNames}
          bootState={bootState}
          bootError={bootError}
          onSelectStage={(stage) => {
            if (stage === 'settings') {
              setSettingsOpen(true);
            } else {
              setNav((n) => selectStage(n, stage));
            }
          }}
          onToggleTrack={(track) => setNav((n) => toggleTrack(n, track))}
          onToggleSidebar={() => setNav((n) => toggleSidebar(n))}
          onOpenConversation={(id) => setNav((n) => openConversation(n, id))}
          onNewConversation={(track) => setPickerTrack(track)}
          onTogglePin={(id, pinned) => void handleTogglePin(id, pinned)}
          onRename={(id, currentTitle) => void handleRename(id, currentTitle)}
          onArchive={(id) => void handleArchive(id)}
          onUnarchive={(id) => void handleUnarchive(id)}
          onDelete={(id) => void handleDelete(id)}
        />
        {pickerTrack && (
          <NewConversationDialog
            track={pickerTrack}
            models={data.models}
            agents={data.agents}
            teams={data.teams}
            onPick={(targetRef) => void handlePickTarget(pickerTrack, targetRef)}
            onGoToLibrary={(stage) => {
              setPickerTrack(null);
              setNav((n) => selectStage(n, stage));
            }}
            onClose={() => setPickerTrack(null)}
          />
        )}
        <main className="flex flex-1 flex-col bg-page overflow-hidden" data-testid="shell-stage">
          {nav.stage === 'talk' ? (
            selected ? (
              <ChatView
                conversation={selected}
                modelName={targetName(selected, data.agents, data.teams, data.modelNames)}
                models={data.models}
                workspaces={data.workspaces}
                eventHistory={eventHistory}
                onTitleUpdated={() => void refresh()}
                onConversationUpdated={() => void refresh()}
              />
            ) : (
              <EmptyTalk />
            )
          ) : nav.stage === 'agents' ? (
            <AgentLibrary
              agents={data.agents}
              models={data.models}
              onRefresh={() => void refresh()}
              onStartConversation={(agentId) => {
                void handlePickTarget('agent', agentId);
                setNav((n) => ({ ...n, stage: 'talk' }));
              }}
            />
          ) : nav.stage === 'teams' ? (
            <TeamLibrary
              teams={data.teams}
              agents={data.agents}
              onRefresh={() => void refresh()}
              onStartConversation={(teamId) => {
                void handlePickTarget('team', teamId);
                setNav((n) => ({ ...n, stage: 'talk' }));
              }}
            />
          ) : nav.stage === 'settings' ? (
            <StagePlaceholder stage={nav.stage} />
          ) : (
            <StagePlaceholder stage={nav.stage} />
          )}
        </main>
      </div>

      <Dialog.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          onCatalogChanged={() => void refresh()}
        />
      </Dialog.Root>
    </div>
  );
}

const WELCOME_CHIPS = [
  { icon: '✦', label: '分析代码或项目结构' },
  { icon: '🤖', label: '创建一个智能体' },
  { icon: '👥', label: '组建小队协作' },
  { icon: '📋', label: '拆解任务与规划' },
  { icon: '🔍', label: '搜索与研究' },
  { icon: '⚡', label: '快速问答' },
];

function EmptyTalk() {
  return (
    <div className="shell-welcome flex flex-1 flex-col items-center justify-center gap-8 px-8">
      {/* Animated orb */}
      <div className="shell-welcome-orb-wrap">
        <div className="shell-welcome-orb-ring2" />
        <div className="shell-welcome-orb-ring" />
        <div className="shell-welcome-orb" />
      </div>

      {/* Headline */}
      <div className="flex flex-col items-center gap-1.5">
        <h2 className="shell-welcome-title m-0 text-[22px] font-semibold tracking-tight text-text">
          你好，我是 Sync-Think
        </h2>
        <p className="shell-welcome-subtitle m-0 text-[13px] text-text-faint">
          AI 工作助手 · 多智能体编排工作台
        </p>
      </div>

      {/* Quick action chips */}
      <div className="flex max-w-lg flex-wrap justify-center gap-2">
        {WELCOME_CHIPS.map((chip, i) => (
          <button
            key={i}
            className="shell-chip flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 py-1.5 text-[12.5px] text-text-secondary"
            style={{ animationDelay: `${0.25 + i * 0.06}s` }}
          >
            <span className="text-[14px]">{chip.icon}</span>
            <span>{chip.label}</span>
          </button>
        ))}
      </div>

      <p
        className="m-0 text-[11.5px] text-text-faint"
        style={{
          animation: 'shell-fade-up 0.6s 0.7s ease both',
          opacity: 0,
          animationFillMode: 'both',
        }}
      >
        在左侧点击 <span className="font-medium text-text-secondary">+</span>{' '}
        新建对话，或直接选择一个意图开始
      </p>
    </div>
  );
}

function StagePlaceholder({ stage }: { stage: ShellNavState['stage'] }) {
  return (
    <div className="flex flex-1 items-center justify-center text-text-faint">
      <div className="text-[13px]">{STAGE_LABELS[stage]} · 建设中</div>
    </div>
  );
}

// ─── Settings Modal ──────────────────────────────────────────────────────────

function SettingsModal({
  onClose,
  onCatalogChanged,
}: {
  onClose(): void;
  onCatalogChanged(): void;
}) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="settings-modal-backdrop" />
      <Dialog.Content className="settings-modal-content" aria-describedby={undefined}>
        <Dialog.Title className="sr-only">设置</Dialog.Title>
        <Dialog.Close className="settings-modal-close" aria-label="关闭设置">
          <X size={17} aria-hidden="true" />
        </Dialog.Close>
        <SettingsPage onDone={onClose} onCatalogChanged={onCatalogChanged} />
      </Dialog.Content>
    </Dialog.Portal>
  );
}
