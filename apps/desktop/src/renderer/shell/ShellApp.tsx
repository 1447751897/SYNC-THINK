// New shell root — NewMax visual constitution (S3 / D3 first cut).
// Sidebar top actions + three tracks with groups · workspace tabs (no 全部) ·
// welcome empty state · settings modal.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowLeftRight, Bot, Brain, Columns2, Globe, Puzzle, SendHorizonal, Sparkles, Users, Zap, X } from 'lucide-react';
import clsx from 'clsx';
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
import {
  buildConversationActivity,
  buildWorkspaceActivity,
  isConversationUnread,
  markConversationSeen,
  readConversationLastSeen,
  writeConversationLastSeen,
} from '../conversation-activity.js';
import { Sidebar } from './Sidebar.js';
import { TopBar } from './TopBar.js';
import { ConversationTabs } from './ConversationTabs.js';
import { ChatView } from './ChatView.js';
import { AgentLibrary } from './AgentLibrary.js';
import { TeamLibrary } from './TeamLibrary.js';
import { AbilitiesPage } from './AbilitiesPage.js';
import { BrowserStage } from './BrowserStage.js';
import { SettingsPage } from './SettingsPage.js';
import {
  ContextRing,
  estimateContextWindow,
  ModelPickerMenu,
  ModelTrigger,
  PermissionMenu,
  PERMISSION_OPTIONS,
  REASONING_LABELS,
  ReasoningMenu,
  type PermissionMode,
  type ReasoningEffort,
} from './compose-toolbar.js';
import { canCloseSettings } from './settings-unsaved.js';
import { NewConversationDialog, type ModelOption } from './NewConversationDialog.js';
import { useDialog, DialogProvider } from './Dialog.js';
import { startRuntimeConnection } from '../runtime-connection.js';
import {
  closeConversationTab,
  createConversationGroup,
  deleteConversationGroup,
  emptyConversationGroups,
  filterByWorkspace,
  INITIAL_NAV,
  moveConversationToGroup,
  openConversation,
  openConversationTab,
  pruneOpenTabs,
  rememberWorkspaceSelection,
  renameConversationGroup,
  reorderConversationTab,
  resolveWorkspaceSelection,
  selectStage,
  setLastTrack,
  setSidebarCollapsed,
  STAGE_LABELS,
  targetName,
  toggleConversationGroupCollapsed,
  toggleSidebar,
  toggleTrack,
  type OpenTabsByWorkspace,
  type SelectedByWorkspace,
  type ShellNavState,
  type ShellStage,
} from './shell-state.js';
import {
  readActiveWorkspaceId,
  readConversationGroups,
  readDefaultPermission,
  readLastConversationTrack,
  readNewConversationDraft,
  readNewConversationModel,
  readConversationModelOverrides,
  readOpenConversationTabs,
  readSelectedConversationByWorkspace,
  readSidebarWidth,
  readUserName,
  buildGreeting,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  writeActiveWorkspaceId,
  writeConversationGroups,
  writeLastConversationTrack,
  writeNewConversationDraft,
  writeNewConversationModel,
  writeOpenConversationTabs,
  writeSelectedConversationByWorkspace,
  writeSidebarWidth,
  type ConversationGroupsByTrack,
} from '../ui-preferences.js';

interface ShellData {
  conversations: Conversation[];
  agents: GlobalAgent[];
  teams: Team[];
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
  // DialogProvider wraps the real component tree so useDialog() resolves
  // to the in-app NewMax dialogs; tests that render <ShellApp /> also get it.
  return (
    <DialogProvider>
      <ShellAppInner />
    </DialogProvider>
  );
}

function ShellAppInner() {
  const dialog = useDialog();
  const [nav, setNav] = useState<ShellNavState>(() => ({
    ...INITIAL_NAV,
    lastTrack: readLastConversationTrack(),
  }));
  const [data, setData] = useState<ShellData>(EMPTY);
  const [skillCatalogRevision, setSkillCatalogRevision] = useState(0);
  const [eventHistory, setEventHistory] = useState<readonly Event[]>([]);
  const [pickerTrack, setPickerTrack] = useState<ConversationTrack | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | undefined>(() =>
    readActiveWorkspaceId(),
  );
  const [bootState, setBootState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [bootError, setBootError] = useState<string | undefined>(undefined);
  const [sidebarWidth, setSidebarWidth] = useState(() => readSidebarWidth());
  const [groups, setGroups] = useState<ConversationGroupsByTrack>(() =>
    readConversationGroups(readActiveWorkspaceId()),
  );
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [newConversationDraft, setNewConversationDraft] = useState(() =>
    readNewConversationDraft(),
  );
  const [newConversationModel, setNewConversationModel] = useState(() =>
    readNewConversationModel(),
  );
  const [newConversationSending, setNewConversationSending] = useState(false);
  const [newConversationError, setNewConversationError] = useState<string | undefined>();
  const [openTabs, setOpenTabs] = useState<OpenTabsByWorkspace>(() => readOpenConversationTabs());
  const [selectedByWorkspace, setSelectedByWorkspace] = useState<SelectedByWorkspace>(() =>
    readSelectedConversationByWorkspace(),
  );
  /**
   * Per-conversation compose model overrides (local UI pref).
   * Sidebar identity for model-track chats must prefer these over targetRef,
   * otherwise switching models in Compose leaves the left list stale.
   */
  const [modelOverrides, setModelOverrides] = useState(() => readConversationModelOverrides());
  /** Right rail open state lives on the stage tab strip (no in-chat title bar). */
  const [railOpen, setRailOpen] = useState(false);
  /**
   * Split view (dual-talk): a second conversation rendered beside the active
   * one. Opened via tab context-menu; a draggable divider adjusts the ratio.
   */
  const [splitConversationId, setSplitConversationId] = useState<string | null>(null);
  const [splitRatio, setSplitRatio] = useState(0.5);
  /**
   * 正在被拖拽的对话 tab id（NewMax 式跨屏移动）：拖动 tab 时聊天区右缘
   * 显示「拖到此处开分屏」落点，drop 后该对话进入右侧分屏。
   */
  const [tabDragId, setTabDragId] = useState<string | null>(null);
  const [splitDropActive, setSplitDropActive] = useState(false);
  /** 各对话「用户最后查看到的事件 sequence」——完成后未查看即未读。 */
  const [conversationLastSeen, setConversationLastSeen] = useState(() =>
    readConversationLastSeen(),
  );
  const splitResizeRef = useRef<{ startX: number; startRatio: number; width: number } | null>(null);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  /**
   * Draft "new chat" context. Exists only in the welcome empty state — nothing is
   * written to Runtime / the sidebar until the user sends the first message.
   */
  const [draftSession, setDraftSession] = useState<{
    track: ConversationTrack;
    targetRef?: string;
  } | null>(null);
  const pendingFirstMessageRef = useRef<{
    text: string;
    modelId?: string;
    permissionMode: PermissionMode;
    reasoningEffort: ReasoningEffort;
    networkEnabled: boolean;
  } | null>(null);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const persistGroups = useCallback(
    (next: ConversationGroupsByTrack) => {
      setGroups(next);
      if (activeWorkspaceId) writeConversationGroups(activeWorkspaceId, next);
    },
    [activeWorkspaceId],
  );

  const focusConversation = useCallback(
    (conversationId: string, workspaceId?: string) => {
      const ws =
        workspaceId ??
        data.conversations.find((c) => c.id === conversationId)?.workspaceId ??
        activeWorkspaceId;
      if (ws) {
        setOpenTabs((current) => {
          const next = openConversationTab(current, ws, conversationId);
          if (next !== current) writeOpenConversationTabs(next);
          return next;
        });
        setSelectedByWorkspace((current) => {
          const next = rememberWorkspaceSelection(current, ws, conversationId);
          if (next !== current) {
            writeSelectedConversationByWorkspace(
              Object.fromEntries(
                Object.entries(next).filter(
                  (entry): entry is [string, string] => Boolean(entry[1]),
                ),
              ),
            );
          }
          return next;
        });
      }
      setDraftSession(null);
      setNav((n) => openConversation(n, conversationId));
    },
    [activeWorkspaceId, data.conversations],
  );

  const handleOpenInSplit = useCallback(
    (conversationId: string) => {
      // Same conversation on both panes is pointless — treat as a no-op.
      setSplitConversationId((current) => {
        if (conversationId === nav.selectedConversationId) return current;
        return conversationId;
      });
      // Split and the right dock fight for width (a pane at ~50% minus a
      // 420px dock collapses the chat column into a vertical strip) — the
      // two are mutually exclusive.
      setRailOpen(false);
    },
    [nav.selectedConversationId],
  );

  const handleCloseSplit = useCallback(() => {
    setSplitConversationId(null);
  }, []);

  /**
   * Rail setter handed to ChatView. ChatView opens the rail directly (e.g. the
   * AI browser_open tool), bypassing onToggleRail — so the split/rail mutual
   * exclusion must live here too, or the 420px dock squeezes the split panes
   * into unusable strips (the "covered by workspace panel" bug).
   */
  const handleRailOpenChange = useCallback((open: boolean) => {
    if (open) setSplitConversationId(null);
    setRailOpen(open);
  }, []);

  const handleCloseConversationTab = useCallback(
    (conversationId: string) => {
      if (!activeWorkspaceId) return;
      // Closing the tab that lives in the split pane also closes the split.
      setSplitConversationId((current) => (current === conversationId ? null : current));
      setOpenTabs((current) => {
        const result = closeConversationTab(current, activeWorkspaceId, conversationId);
        writeOpenConversationTabs(result.tabs);
        setNav((navState) => {
          if (navState.selectedConversationId !== conversationId) return navState;
          return {
            ...navState,
            stage: 'talk',
            selectedConversationId: result.nextSelectedId,
          };
        });
        setSelectedByWorkspace((selected) => {
          const next = rememberWorkspaceSelection(
            selected,
            activeWorkspaceId,
            result.nextSelectedId,
          );
          writeSelectedConversationByWorkspace(
            Object.fromEntries(
              Object.entries(next).filter((entry): entry is [string, string] => Boolean(entry[1])),
            ),
          );
          return next;
        });
        return result.tabs;
      });
    },
    [activeWorkspaceId],
  );

  const selectWorkspace = useCallback(
    (workspaceId: string) => {
      setActiveWorkspaceId(workspaceId);
      writeActiveWorkspaceId(workspaceId);
      setGroups(readConversationGroups(workspaceId));
      // Restore the last focused open tab for this workspace (O1 tab strip).
      // Never keep the previous workspace's conversation selected.
      const restored = resolveWorkspaceSelection(openTabs, selectedByWorkspace, workspaceId);
      setNav((current) => ({
        ...current,
        stage: 'talk',
        selectedConversationId: restored,
      }));
      setSelectedIds(new Set());
      setMultiSelect(false);
      setPickerTrack(null);
      setRailOpen(false);
      setSplitConversationId(null);
      setDraftSession(null);
    },
    [openTabs, selectedByWorkspace],
  );

  const handleReorderConversationTab = useCallback(
    (fromId: string, toId: string) => {
      if (!activeWorkspaceId) return;
      setOpenTabs((current) => {
        const next = reorderConversationTab(current, activeWorkspaceId, fromId, toId);
        if (next !== current) writeOpenConversationTabs(next);
        return next;
      });
    },
    [activeWorkspaceId],
  );

  useEffect(() => {
    setGroups(readConversationGroups(activeWorkspaceId));
  }, [activeWorkspaceId]);

  const refresh = useCallback(async () => {
    const api = bridge();
    if (!api) return;
    const [conversations, agents, teams, providers, workspaces] = await Promise.all([
      api.listConversations({ includeArchived: true }),
      api.listGlobalAgents({}),
      api.listTeams(),
      api.listProviders({}),
      api.listWorkspaces({}),
    ]);
    const modelNames = new Map<string, string>();
    const models: ModelOption[] = [];
    for (const provider of providers.providers) {
      if (provider.enabled === false) continue;
      for (const model of provider.models) {
        modelNames.set(model.modelId, model.displayName);
        models.push({
          modelId: model.modelId,
          displayName: model.displayName,
          providerName: provider.name,
          contextWindow: model.contextWindow,
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

    // Drop open-tab ids that no longer exist (deleted elsewhere / archived out).
    const existingIds = new Set(conversations.conversations.map((c) => c.id));
    setOpenTabs((current) => {
      const pruned = pruneOpenTabs(current, existingIds);
      if (pruned !== current) writeOpenConversationTabs(pruned);
      return pruned;
    });

    // No「全部」: always land on a concrete workspace when possible.
    setActiveWorkspaceId((current) => {
      const list = workspaces.workspaces;
      if (list.length === 0) {
        writeActiveWorkspaceId(undefined);
        return undefined;
      }
      if (current && list.some((w) => w.workspaceId === current)) return current;
      const next = list[0]!.workspaceId;
      writeActiveWorkspaceId(next);
      return next;
    });
  }, []);

  // After boot data is ready, restore the last focused conversation for the
  // active workspace so open tabs and the main stage stay in sync.
  useEffect(() => {
    if (bootState !== 'ready') return;
    if (!activeWorkspaceId) return;
    setNav((current) => {
      if (current.stage !== 'talk') return current;
      if (current.selectedConversationId) return current;
      const restored = resolveWorkspaceSelection(
        openTabs,
        selectedByWorkspace,
        activeWorkspaceId,
      );
      if (!restored || restored === current.selectedConversationId) return current;
      return { ...current, selectedConversationId: restored };
    });
    // Intentionally only on boot readiness / workspace id — not on every tab edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootState, activeWorkspaceId]);

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

    const unsub = api.onEvent?.((event: Event) => {
      setEventHistory((prev) => mergeEventHistory(prev, [event]));
    });

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

  const pendingOpenRef = useRef<string | null>(null);

  const openConversationById = useCallback(
    (conversationId: string) => {
      const target = data.conversations.find((c) => c.id === conversationId);
      if (!target) {
        // Conversations not loaded yet — hold the id; refresh() or a later
        // data update flushes it once it appears.
        pendingOpenRef.current = conversationId;
        return;
      }
      pendingOpenRef.current = null;
      // Deep links can target a conversation in another workspace. Switch there
      // first so the workspace-scoped main stage can resolve the selection.
      if (target.workspaceId && target.workspaceId !== activeWorkspaceId) {
        setActiveWorkspaceId(target.workspaceId);
        writeActiveWorkspaceId(target.workspaceId);
        setGroups(readConversationGroups(target.workspaceId));
      }
      focusConversation(conversationId, target.workspaceId);
    },
    [activeWorkspaceId, data.conversations, focusConversation],
  );

  // Inbox for syncthink://conversation/{id} dispatched by the main process.
  useEffect(() => {
    const api = bridge();
    const unsubscribe = api?.onOpenConversation?.((conversationId) => {
      void openConversationById(conversationId);
    });
    // Tell main we are mounted so it can flush any cold-start deep link.
    api?.notifyRendererReady?.();
    return () => unsubscribe?.();
  }, [openConversationById]);

  // Flush a pending deep link once conversations arrive.
  useEffect(() => {
    if (pendingOpenRef.current && data.conversations.length > 0) {
      openConversationById(pendingOpenRef.current);
    }
  }, [data.conversations, openConversationById]);

  // Ctrl+B toggles sidebar (R3).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        setNav((n) => toggleSidebar(n));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Sidebar drag resize.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = resizeRef.current;
      if (!drag) return;
      const next = Math.min(
        SIDEBAR_WIDTH_MAX,
        Math.max(SIDEBAR_WIDTH_MIN, drag.startWidth + (e.clientX - drag.startX)),
      );
      setSidebarWidth(next);
    };
    const onUp = () => {
      if (!resizeRef.current) return;
      resizeRef.current = null;
      setSidebarWidth((w) => {
        writeSidebarWidth(w);
        return w;
      });
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Split-view divider drag resize (dual-talk).
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = splitResizeRef.current;
      if (!drag || drag.width <= 0) return;
      const delta = (e.clientX - drag.startX) / drag.width;
      const next = Math.min(0.75, Math.max(0.25, drag.startRatio + delta));
      setSplitRatio(next);
    };
    const onUp = () => {
      if (!splitResizeRef.current) return;
      splitResizeRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const rememberTrack = useCallback((track: ConversationTrack) => {
    setNav((n) => setLastTrack(n, track));
    writeLastConversationTrack(track);
  }, []);

  const createConversationWithTarget = useCallback(
    async (track: ConversationTrack, targetRef: string, firstMessage?: {
      text: string;
      modelId?: string;
      permissionMode: PermissionMode;
      reasoningEffort: ReasoningEffort;
      networkEnabled: boolean;
    }) => {
      const api = bridge();
      if (!api) return;
      if (!activeWorkspaceId) {
        setNewConversationError('请先创建或打开一个工作区');
        return;
      }
      setPickerTrack(null);
      rememberTrack(track);
      const created = await api.createConversation({
        track,
        targetRef,
        workspaceId: activeWorkspaceId as WorkspaceId,
        executionMode: firstMessage?.permissionMode ?? readDefaultPermission(),
      });

      if (firstMessage?.text.trim()) {
        const prep = await api.sendConversationMessage({
          conversationId: created.conversation.id,
          text: firstMessage.text,
          modelId: firstMessage.modelId as Parameters<
            typeof api.sendConversationMessage
          >[0]['modelId'],
        });
        await api.appendMessage({
          threadId: prep.threadId,
          expectedTaskVersion: prep.taskVersion,
          role: 'user',
          text: firstMessage.text,
          modelId: firstMessage.modelId as Parameters<typeof api.appendMessage>[0]['modelId'],
          reasoningEffort:
            firstMessage.reasoningEffort === 'auto' ? undefined : firstMessage.reasoningEffort,
          networkEnabled: firstMessage.networkEnabled || undefined,
        });
      }

      await refresh();
      focusConversation(created.conversation.id, activeWorkspaceId);
      setDraftSession(null);
      if (firstMessage?.text.trim()) {
        setNewConversationDraft('');
        writeNewConversationDraft('');
      }
      setNewConversationError(undefined);
      return created.conversation;
    },
    [activeWorkspaceId, focusConversation, refresh, rememberTrack],
  );

  const handlePickTarget = useCallback(
    async (track: ConversationTrack, targetRef: string) => {
      const pending = pendingFirstMessageRef.current;
      // From the welcome draft, picking a target only *prepares* the session —
      // we create the conversation when the user actually sends a message.
      if (!pending) {
        setDraftSession({ track, targetRef });
        rememberTrack(track);
        setPickerTrack(null);
        setNav((n) => ({ ...n, stage: 'talk', selectedConversationId: undefined }));
        if (track === 'model') {
          setNewConversationModel(targetRef);
          writeNewConversationModel(targetRef);
        }
        return;
      }
      setNewConversationSending(true);
      try {
        await createConversationWithTarget(track, targetRef, pending);
        pendingFirstMessageRef.current = null;
        setDraftSession(null);
      } catch (error) {
        setNewConversationError(error instanceof Error ? error.message : '新建对话失败');
      } finally {
        setNewConversationSending(false);
      }
    },
    [createConversationWithTarget, rememberTrack],
  );

  const handleNewConversation = useCallback(
    (track?: ConversationTrack) => {
      // New chat is a *draft* welcome state: no Runtime create until the user
      // actually sends the first message. That way the sidebar only lists real
      // conversations, and the welcome page stays visible.
      const current = data.conversations.find((c) => c.id === nav.selectedConversationId);
      const t = track ?? current?.track ?? nav.lastTrack;
      rememberTrack(t);
      setPickerTrack(null);
      setRailOpen(false);
      setNav((n) => ({
        ...n,
        stage: 'talk',
        selectedConversationId: undefined,
      }));
      if (activeWorkspaceId) {
        setSelectedByWorkspace((selected) => {
          const next = rememberWorkspaceSelection(selected, activeWorkspaceId, undefined);
          writeSelectedConversationByWorkspace(
            Object.fromEntries(
              Object.entries(next).filter((entry): entry is [string, string] => Boolean(entry[1])),
            ),
          );
          return next;
        });
      }
      // Carry the current conversation's target into the draft so the first
      // send can create the same kind of session without a picker.
      if (current && !track) {
        setDraftSession({ track: current.track, targetRef: current.targetRef });
        if (current.track === 'model' && current.targetRef) {
          setNewConversationModel(current.targetRef);
          writeNewConversationModel(current.targetRef);
        }
        return;
      }
      setDraftSession(track ? { track } : { track: t });
      // Explicit track from a header still needs a target for agent/team.
      if (t !== 'model') setPickerTrack(t);
    },
    [
      activeWorkspaceId,
      data.conversations,
      nav.lastTrack,
      nav.selectedConversationId,
      rememberTrack,
    ],
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
    selectWorkspace(created.workspaceId);
  }, [refresh, selectWorkspace]);

  const handleCreateWorkspace = useCallback(
    async (input: {
      name: string;
      folderPath: string;
      icon?: string;
    }): Promise<boolean> => {
      const api = bridge();
      if (!api) {
        return false;
      }
      try {
        const created = await api.createWorkspace({
          name: input.name,
          folderPath: input.folderPath,
        });
        // Icon is stored via workspace.update (create payload has no icon field).
        if (input.icon?.trim() && api.updateWorkspace) {
          await api.updateWorkspace({
            workspaceId: created.workspaceId,
            icon: input.icon.trim(),
          });
        }
        await refresh();
        selectWorkspace(created.workspaceId);
        return true;
      } catch (err) {
        throw err instanceof Error ? err : new Error(String(err));
      }
    },
    [refresh, selectWorkspace],
  );

  const handleUpdateWorkspace = useCallback(
    async (input: {
      workspaceId: string;
      name?: string;
      folderPath?: string;
      icon?: string | null;
    }): Promise<boolean> => {
      const api = bridge();
      if (!api?.updateWorkspace) return false;
      try {
        await api.updateWorkspace({
          workspaceId: input.workspaceId as WorkspaceId,
          name: input.name,
          folderPath: input.folderPath,
          icon: input.icon,
        });
        await refresh();
        return true;
      } catch (err) {
        throw err instanceof Error ? err : new Error(String(err));
      }
    },
    [refresh],
  );

  const handleDeleteWorkspace = useCallback(
    async (workspaceId: string): Promise<boolean> => {
      const api = bridge();
      if (!api?.deleteWorkspace) return false;
      const target = data.workspaces.find((w) => w.workspaceId === workspaceId);
      const label = target?.name ?? workspaceId;
      if (
        !(await dialog.confirm({
          title: '删除工作区',
          message: `确定删除工作区「${label}」吗？对话不会随工作区自动删除，但该工作区将从列表中移除。`,
          confirmText: '删除',
          danger: true,
        }))
      ) {
        return false;
      }
      try {
        await api.deleteWorkspace({
          workspaceId: workspaceId as WorkspaceId,
        });
        if (activeWorkspaceId === workspaceId) {
          const remaining = data.workspaces.filter((w) => w.workspaceId !== workspaceId);
          if (remaining[0]) selectWorkspace(remaining[0].workspaceId);
          else {
            setActiveWorkspaceId(undefined);
            writeActiveWorkspaceId(undefined);
            setNav((n) => ({ ...n, selectedConversationId: undefined }));
          }
        }
        await refresh();
        return true;
      } catch (err) {
        await dialog.alert({
          title: '删除失败',
          message: err instanceof Error ? err.message : String(err),
          dismissText: '知道了',
        });
        return false;
      }
    },
    [activeWorkspaceId, data.workspaces, dialog, refresh, selectWorkspace],
  );

  const handlePickFolder = useCallback(async () => {
    const api = bridge();
    if (!api) return { canceled: true as const };
    const picked = await api.pickFolder();
    return { canceled: picked.canceled, path: picked.path ?? undefined };
  }, []);

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
      const title = await dialog.prompt({
        title: '重命名对话',
        message: '为这条对话设置一个新标题',
        defaultValue: currentTitle,
        placeholder: '对话标题',
        confirmText: '保存',
      });
      if (title === null) return;
      const trimmed = title.trim();
      if (!trimmed || trimmed === currentTitle) return;
      await api.renameConversation({
        conversationId: id as Parameters<typeof api.renameConversation>[0]['conversationId'],
        title: trimmed,
      });
      await refresh();
    },
    [dialog, refresh],
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
      if (
        !(await dialog.confirm({
          title: '删除对话',
          message: '删除后无法恢复，确定删除这条对话吗？',
          confirmText: '删除',
          danger: true,
        }))
      )
        return;
      await api.deleteConversation({
        conversationId: id as Parameters<typeof api.deleteConversation>[0]['conversationId'],
      });
      // Closing the open tab also clears selection when this chat was focused.
      if (activeWorkspaceId) {
        setOpenTabs((current) => {
          const result = closeConversationTab(current, activeWorkspaceId, id);
          writeOpenConversationTabs(result.tabs);
          setNav((n) => {
            if (n.selectedConversationId !== id) return n;
            return { ...n, selectedConversationId: result.nextSelectedId };
          });
          return result.tabs;
        });
      } else {
        setNav((n) =>
          n.selectedConversationId === id ? { ...n, selectedConversationId: undefined } : n,
        );
      }
      // Drop from local groups.
      persistGroups({
        model: groups.model.map((g) => ({
          ...g,
          conversationIds: g.conversationIds.filter((cid) => cid !== id),
        })),
        agent: groups.agent.map((g) => ({
          ...g,
          conversationIds: g.conversationIds.filter((cid) => cid !== id),
        })),
        team: groups.team.map((g) => ({
          ...g,
          conversationIds: g.conversationIds.filter((cid) => cid !== id),
        })),
      });
      await refresh();
    },
    [activeWorkspaceId, dialog, groups, persistGroups, refresh],
  );

  const handleDuplicate = useCallback(
    async (id: string) => {
      const api = bridge();
      if (!api) return;
      const source = data.conversations.find((c) => c.id === id);
      if (!source) return;
      const workspaceId = (source.workspaceId ?? activeWorkspaceId) as
        | WorkspaceId
        | undefined;
      // Copy conversation config (track, target, workspace, execution permission,
      // bound model) and the title in a single create. Message history is NOT
      // copied: there is no Runtime command to list a conversation's messages,
      // so duplicating messages would require a new protocol command.
      const created = await api.createConversation({
        track: source.track,
        targetRef: source.targetRef,
        workspaceId,
        title: source.title ? `${source.title}（副本）` : undefined,
        executionMode: source.executionMode,
      });
      // Preserve group membership (front-end only; no Runtime call needed).
      const track = source.track;
      const sourceGroup = groups[track].find((g) => g.conversationIds.includes(id));
      if (sourceGroup && workspaceId) {
        persistGroups(
          moveConversationToGroup(groups, track, created.conversation.id, sourceGroup.id),
        );
      }
      await refresh();
      focusConversation(created.conversation.id, workspaceId);
    },
    [activeWorkspaceId, data.conversations, focusConversation, groups, persistGroups, refresh],
  );

  const handleCopyLink = useCallback(
    async (id: string) => {
      const link = `syncthink://conversation/${id}`;
      try {
        await navigator.clipboard.writeText(link);
        return;
      } catch {
        // clipboard unavailable; fall through to an in-app alert so the user can copy manually.
      }
      await dialog.alert({
        title: '复制链接',
        message: (
          <code className="block break-all rounded-(--radius-row) bg-surface-200 px-2 py-1 text-[12px] text-text">
            {link}
          </code>
        ),
        dismissText: '关闭',
      });
    },
    [dialog],
  );

  const removeConversationIdsFromGroups = useCallback(
    (source: ConversationGroupsByTrack, ids: ReadonlySet<string>): ConversationGroupsByTrack => ({
      model: source.model.map((group) => ({
        ...group,
        conversationIds: group.conversationIds.filter((id) => !ids.has(id)),
      })),
      agent: source.agent.map((group) => ({
        ...group,
        conversationIds: group.conversationIds.filter((id) => !ids.has(id)),
      })),
      team: source.team.map((group) => ({
        ...group,
        conversationIds: group.conversationIds.filter((id) => !ids.has(id)),
      })),
    }),
    [],
  );

  const handleBulkArchive = useCallback(async () => {
    const api = bridge();
    if (!api || selectedIds.size === 0) return;
    for (const id of selectedIds) {
      await api.setConversationArchived({
        conversationId: id as Parameters<typeof api.setConversationArchived>[0]['conversationId'],
        archived: true,
      });
    }
    setSelectedIds(new Set());
    setMultiSelect(false);
    await refresh();
  }, [refresh, selectedIds]);

  const handleBulkDelete = useCallback(async () => {
    const api = bridge();
    if (!api || selectedIds.size === 0) return;
    if (
      !(await dialog.confirm({
        title: '批量删除对话',
        message: `确定删除选中的 ${selectedIds.size} 条对话？删除后无法恢复。`,
        confirmText: '删除',
        danger: true,
      }))
    )
      return;
    for (const id of selectedIds) {
      await api.deleteConversation({
        conversationId: id as Parameters<typeof api.deleteConversation>[0]['conversationId'],
      });
    }
    if (activeWorkspaceId) {
      setOpenTabs((current) => {
        let next = current;
        let nextSelected = nav.selectedConversationId;
        for (const id of selectedIds) {
          const result = closeConversationTab(next, activeWorkspaceId, id);
          next = result.tabs;
          if (nextSelected === id) nextSelected = result.nextSelectedId;
        }
        writeOpenConversationTabs(next);
        setNav((n) =>
          n.selectedConversationId && selectedIds.has(n.selectedConversationId)
            ? { ...n, selectedConversationId: nextSelected }
            : n,
        );
        return next;
      });
    }
    persistGroups(removeConversationIdsFromGroups(groups, selectedIds));
    setSelectedIds(new Set());
    setMultiSelect(false);
    await refresh();
  }, [
    activeWorkspaceId,
    dialog,
    groups,
    nav.selectedConversationId,
    persistGroups,
    refresh,
    removeConversationIdsFromGroups,
    selectedIds,
  ]);

  const handleBulkMoveToGroup = useCallback(
    (track: ConversationTrack, groupId: string | null) => {
      const idsInTrack = data.conversations
        .filter(
          (conversation) =>
            conversation.workspaceId === activeWorkspaceId &&
            conversation.track === track &&
            selectedIds.has(conversation.id),
        )
        .map((conversation) => conversation.id);
      if (idsInTrack.length === 0) return;
      let next = groups;
      for (const id of idsInTrack) {
        next = moveConversationToGroup(next, track, id, groupId);
      }
      persistGroups(next);
      setSelectedIds((current) => {
        const remaining = new Set(current);
        idsInTrack.forEach((id) => remaining.delete(id));
        if (remaining.size === 0) setMultiSelect(false);
        return remaining;
      });
    },
    [activeWorkspaceId, data.conversations, groups, persistGroups, selectedIds],
  );

  const visibleConversations = useMemo(
    () => filterByWorkspace(data.conversations, activeWorkspaceId),
    [data.conversations, activeWorkspaceId],
  );

  const selected = visibleConversations.find((c) => c.id === nav.selectedConversationId);
  // Split pane renders only while its conversation is still open in this
  // workspace and differs from the active one (selecting it collapses split).
  const splitConversation =
    splitConversationId && splitConversationId !== selected?.id
      ? visibleConversations.find((c) => c.id === splitConversationId)
      : undefined;

  const resolveTargetName = useCallback(
    (conversation: Conversation) =>
      targetName(conversation, data.agents, data.teams, data.modelNames, modelOverrides),
    [data.agents, data.modelNames, data.teams, modelOverrides],
  );

  const handleConversationUpdated = useCallback(() => {
    // Re-read local model overrides so sidebar identity updates immediately
    // after a compose model switch (without waiting for a full runtime refresh).
    setModelOverrides(readConversationModelOverrides());
    void refresh();
  }, [refresh]);

  /** 各对话运行/完成状态（由全局事件流按 taskId 投影）。 */
  const conversationActivity = useMemo(
    () => buildConversationActivity(eventHistory, data.conversations),
    [eventHistory, data.conversations],
  );
  /** 对话级 running/unread map（对话 tab 与侧栏用）。 */
  const conversationActivityView = useMemo(() => {
    const map = new Map<string, { running: boolean; unread: boolean }>();
    for (const conversation of data.conversations) {
      const id = String(conversation.id);
      const activity = conversationActivity.get(id);
      if (!activity) continue;
      map.set(id, {
        running: activity.running,
        unread: isConversationUnread(activity, conversationLastSeen, id),
      });
    }
    return map;
  }, [data.conversations, conversationActivity, conversationLastSeen]);
  /** 工作区级聚合（顶部工作区 tab 用）。 */
  const workspaceActivity = useMemo(
    () => buildWorkspaceActivity(data.conversations, conversationActivity, conversationLastSeen),
    [data.conversations, conversationActivity, conversationLastSeen],
  );
  // 当前正在查看的对话自动标记已读（含分屏右窗格）。
  useEffect(() => {
    const watched = [nav.selectedConversationId, splitConversationId].filter(
      (id): id is string => Boolean(id),
    );
    if (watched.length === 0) return;
    setConversationLastSeen((current) => {
      let next = current;
      for (const id of watched) {
        const activity = conversationActivity.get(id);
        if (activity?.lastFinishedSequence == null) continue;
        next = markConversationSeen(next, id, activity.lastFinishedSequence);
      }
      if (next !== current) writeConversationLastSeen(next);
      return next;
    });
  }, [nav.selectedConversationId, splitConversationId, conversationActivity]);

  const handleSelectStage = useCallback((stage: ShellStage) => {
    if (stage === 'settings') {
      setSettingsOpen(true);
      return;
    }
    setNav((n) => selectStage(n, stage));
  }, []);

  const openIdsForWorkspace = activeWorkspaceId ? (openTabs[activeWorkspaceId] ?? []) : [];

  return (
    <div className="flex h-full flex-col bg-page">
      <div className="shell-boards flex min-h-0 flex-1 bg-page">
        {/* Keep sidebar mounted so width can animate on collapse/expand. */}
        <Sidebar
          nav={nav}
          width={sidebarWidth || SIDEBAR_WIDTH_DEFAULT}
          collapsed={nav.sidebarCollapsed}
          settingsOpen={settingsOpen}
          conversations={visibleConversations}
          agents={data.agents}
          teams={data.teams}
          modelNames={data.modelNames}
          modelOverrides={modelOverrides}
          groups={groups}
          bootState={bootState}
          bootError={bootError}
          multiSelect={multiSelect}
          selectedIds={selectedIds}
          conversationActivity={conversationActivityView}
          onSelectStage={handleSelectStage}
          onToggleTrack={(track) => setNav((n) => toggleTrack(n, track))}
          onToggleSidebar={() => setNav((n) => setSidebarCollapsed(n, true))}
          onOpenConversation={(id) => focusConversation(id)}
          onNewConversation={handleNewConversation}
          onTogglePin={(id, pinned) => void handleTogglePin(id, pinned)}
          onRename={(id, currentTitle) => void handleRename(id, currentTitle)}
          onArchive={(id) => void handleArchive(id)}
          onUnarchive={(id) => void handleUnarchive(id)}
          onDelete={(id) => void handleDelete(id)}
          onDuplicate={(id) => void handleDuplicate(id)}
          onCopyLink={(id) => void handleCopyLink(id)}
          onCreateGroup={(track, name) => {
            persistGroups(createConversationGroup(groups, track, name));
          }}
          onRenameGroup={(track, groupId, name) => {
            persistGroups(renameConversationGroup(groups, track, groupId, name));
          }}
          onDeleteGroup={(track, groupId) => {
            persistGroups(deleteConversationGroup(groups, track, groupId));
          }}
          onToggleGroupCollapsed={(track, groupId) => {
            persistGroups(toggleConversationGroupCollapsed(groups, track, groupId));
          }}
          onMoveToGroup={(track, conversationId, groupId) => {
            persistGroups(moveConversationToGroup(groups, track, conversationId, groupId));
          }}
          onToggleMultiSelect={() => {
            setMultiSelect((v) => !v);
            setSelectedIds(new Set());
          }}
          onToggleSelected={(id) => {
            setSelectedIds((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
          }}
          onBulkArchive={() => void handleBulkArchive()}
          onBulkDelete={() => void handleBulkDelete()}
          onBulkMoveToGroup={handleBulkMoveToGroup}
          onResizeStart={(clientX) => {
            if (nav.sidebarCollapsed) return;
            resizeRef.current = { startX: clientX, startWidth: sidebarWidth };
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
          }}
        />

        {pickerTrack && (
          <NewConversationDialog
            track={pickerTrack}
            models={data.models}
            agents={data.agents}
            teams={data.teams}
            draft={newConversationDraft}
            onPick={(targetRef) => void handlePickTarget(pickerTrack, targetRef)}
            onGoToLibrary={(stage) => {
              pendingFirstMessageRef.current = null;
              setPickerTrack(null);
              setNav((n) => selectStage(n, stage === 'agents' || stage === 'teams' ? stage : n.stage));
            }}
            onClose={() => {
              pendingFirstMessageRef.current = null;
              setPickerTrack(null);
            }}
          />
        )}

        <main
          className="shell-board flex min-w-0 flex-1 flex-col overflow-hidden bg-surface"
          data-testid="shell-stage"
        >
          {/* Workspace tabs live inside the stage board (NewMax mid-stage),
              not as a full-window chrome bar above the pure sidebar. */}
          <TopBar
            workspaces={data.workspaces}
            activeWorkspaceId={activeWorkspaceId}
            sidebarCollapsed={nav.sidebarCollapsed}
            onSelectWorkspace={selectWorkspace}
            onOpenFolder={() => void handleOpenFolder()}
            onCreateWorkspace={handleCreateWorkspace}
            onUpdateWorkspace={handleUpdateWorkspace}
            onDeleteWorkspace={handleDeleteWorkspace}
            onToggleSidebar={() => setNav((n) => toggleSidebar(n))}
            onPickFolder={handlePickFolder}
            workspaceActivity={workspaceActivity}
          />
          {nav.stage === 'talk' ? (
            <>
              <ConversationTabs
                conversations={visibleConversations}
                openIds={openIdsForWorkspace}
                activeId={selected?.id}
                railOpen={railOpen}
                splitId={splitConversation?.id}
                onSelect={(id) => focusConversation(id)}
                onClose={handleCloseConversationTab}
                onNew={() => handleNewConversation()}
                onReorder={handleReorderConversationTab}
                onToggleRail={() => {
                  setRailOpen((v) => {
                    // Opening the dock while split is active would squeeze the
                    // panes below usable width — dock and split are exclusive.
                    if (!v) setSplitConversationId(null);
                    return !v;
                  });
                }}
                onRename={(id, currentTitle) => void handleRename(id, currentTitle)}
                onOpenInSplit={handleOpenInSplit}
                onCloseSplit={handleCloseSplit}
                onTabDragStateChange={(id) => {
                  setTabDragId(id);
                  if (!id) setSplitDropActive(false);
                }}
                conversationActivity={conversationActivityView}
              />
              {selected && splitConversation ? (
              <div
                ref={splitContainerRef}
                data-testid="chat-split-view"
                className="shell-split-view flex min-h-0 flex-1 overflow-hidden"
              >
                <div
                  className="shell-split-pane flex min-w-0 flex-col overflow-hidden"
                  style={{ flexBasis: `${splitRatio * 100}%` }}
                >
                  <ChatView
                    key={selected.id}
                    conversation={selected}
                    modelName={resolveTargetName(selected)}
                    models={data.models}
                    agents={data.agents}
                    teams={data.teams}
                    workspaces={data.workspaces}
                    eventHistory={eventHistory}
                    onTitleUpdated={() => void refresh()}
                    onConversationUpdated={handleConversationUpdated}
                    railOpen={railOpen}
                    onRailOpenChange={handleRailOpenChange}
                  />
                </div>
                <div
                  data-testid="chat-split-divider"
                  className="shell-split-divider"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="拖拽调整分屏比例"
                  onMouseDown={(e) => {
                    const width = splitContainerRef.current?.getBoundingClientRect().width ?? 0;
                    if (width <= 0) return;
                    e.preventDefault();
                    splitResizeRef.current = {
                      startX: e.clientX,
                      startRatio: splitRatio,
                      width,
                    };
                    document.body.style.cursor = 'col-resize';
                    document.body.style.userSelect = 'none';
                  }}
                  onDoubleClick={() => setSplitRatio(0.5)}
                />
                <div
                  className="shell-split-pane shell-split-pane--secondary relative flex min-w-0 flex-1 flex-col overflow-hidden"
                  onDragOver={(e) => {
                    // 分屏已开时，拖 tab 到右窗格 → 替换右侧对话。
                    if (!tabDragId || tabDragId === splitConversation.id) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setSplitDropActive(true);
                  }}
                  onDragLeave={() => setSplitDropActive(false)}
                  onDrop={(e) => {
                    if (!tabDragId) return;
                    e.preventDefault();
                    const id = e.dataTransfer.getData('text/plain') || tabDragId;
                    setSplitDropActive(false);
                    setTabDragId(null);
                    if (id && id !== splitConversation.id) handleOpenInSplit(id);
                  }}
                >
                  <div className="shell-split-pane-head flex h-8 shrink-0 items-center gap-1.5 px-3 text-[12px] text-text-secondary">
                    <Columns2 size={12} className="shrink-0 text-text-faint" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">
                      {splitConversation.title?.trim() || '新对话'}
                    </span>
                    <button
                      type="button"
                      data-testid="chat-split-swap"
                      className="st-icon-motion flex h-5 w-5 items-center justify-center rounded text-text-faint hover:bg-hover hover:text-text"
                      title="与左侧对调"
                      onClick={() => {
                        const rightId = splitConversation.id;
                        setSplitConversationId(selected.id);
                        focusConversation(rightId);
                      }}
                    >
                      <ArrowLeftRight size={12} />
                    </button>
                    <button
                      type="button"
                      data-testid="chat-split-close-pane"
                      className="st-icon-motion flex h-5 w-5 items-center justify-center rounded text-text-faint hover:bg-hover hover:text-text"
                      title="关闭分屏"
                      onClick={handleCloseSplit}
                    >
                      <X size={12} />
                    </button>
                  </div>
                  <ChatView
                    key={splitConversation.id}
                    conversation={splitConversation}
                    modelName={resolveTargetName(splitConversation)}
                    models={data.models}
                    agents={data.agents}
                    teams={data.teams}
                    workspaces={data.workspaces}
                    eventHistory={eventHistory}
                    onTitleUpdated={() => void refresh()}
                    onConversationUpdated={handleConversationUpdated}
                  />
                  {tabDragId && tabDragId !== splitConversation.id && splitDropActive ? (
                    <div className="pointer-events-none absolute inset-0 z-30 border-2 border-dashed border-accent/60 bg-accent/5" />
                  ) : null}
                </div>
              </div>
            ) : selected ? (
              <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                <ChatView
                  conversation={selected}
                  modelName={resolveTargetName(selected)}
                  models={data.models}
                  agents={data.agents}
                  teams={data.teams}
                  workspaces={data.workspaces}
                  eventHistory={eventHistory}
                  onTitleUpdated={() => void refresh()}
                  onConversationUpdated={handleConversationUpdated}
                  railOpen={railOpen}
                  onRailOpenChange={handleRailOpenChange}
                />
                {/* NewMax 式跨屏移动：拖动对话 tab 时，聊天区右缘出现落点；
                    松手即把该对话放到右侧分屏。 */}
                {tabDragId && tabDragId !== selected.id ? (
                  <div
                    data-testid="chat-split-dropzone"
                    className={clsx(
                      'shell-split-dropzone',
                      splitDropActive && 'shell-split-dropzone--active',
                    )}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      setSplitDropActive(true);
                    }}
                    onDragLeave={() => setSplitDropActive(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      const id = e.dataTransfer.getData('text/plain') || tabDragId;
                      setSplitDropActive(false);
                      setTabDragId(null);
                      if (id) handleOpenInSplit(id);
                    }}
                  >
                    <div className="shell-split-dropzone__hint">
                      <Columns2 size={14} aria-hidden />
                      <span>拖到此处分屏</span>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <EmptyTalk
                hasWorkspace={Boolean(activeWorkspaceId)}
                models={data.models}
                draft={newConversationDraft}
                selectedModelId={newConversationModel}
                draftTrack={draftSession?.track ?? nav.lastTrack}
                draftTargetRef={draftSession?.targetRef}
                sending={newConversationSending}
                error={newConversationError}
                onDraftChange={(draft) => {
                  setNewConversationDraft(draft);
                  writeNewConversationDraft(draft);
                  setNewConversationError(undefined);
                }}
                onModelChange={(modelId) => {
                  setNewConversationModel(modelId);
                  writeNewConversationModel(modelId);
                  setDraftSession((prev) => ({
                    track: prev?.track ?? 'model',
                    targetRef: modelId || prev?.targetRef,
                  }));
                }}
                onSend={async (options) => {
                  const text = newConversationDraft.trim();
                  if (!text || newConversationSending) return;
                  if (!activeWorkspaceId) {
                    setNewConversationError('请先创建或打开一个工作区');
                    return;
                  }
                  const track = draftSession?.track ?? nav.lastTrack;
                  // Agent/team drafts must NOT carry the welcome-page model picker.
                  // Explicit modelId would override the agent's defaultModelId on the
                  // first turn (and only the first turn), causing model thrash.
                  const requested = {
                    text,
                    modelId: track === 'model' ? options.modelId || undefined : undefined,
                    permissionMode: options.permissionMode,
                    reasoningEffort: options.reasoningEffort,
                    networkEnabled: options.networkEnabled,
                  };
                  // Agent/team drafts without a target still need a picker first.
                  if (track !== 'model' && !draftSession?.targetRef) {
                    pendingFirstMessageRef.current = requested;
                    setPickerTrack(track);
                    return;
                  }
                  if (track !== 'model' && draftSession?.targetRef) {
                    setNewConversationSending(true);
                    try {
                      await createConversationWithTarget(
                        track,
                        draftSession.targetRef,
                        requested,
                      );
                    } catch (error) {
                      setNewConversationError(
                        error instanceof Error ? error.message : '发送第一条消息失败',
                      );
                    } finally {
                      setNewConversationSending(false);
                    }
                    return;
                  }
                  const modelId =
                    options.modelId ||
                    draftSession?.targetRef ||
                    data.models[0]?.modelId;
                  if (!modelId) {
                    setNewConversationError('还没有可用模型，请先在设置中添加模型');
                    return;
                  }
                  setNewConversationSending(true);
                  try {
                    await createConversationWithTarget('model', modelId, {
                      ...requested,
                      modelId,
                    });
                  } catch (error) {
                    setNewConversationError(
                      error instanceof Error ? error.message : '发送第一条消息失败',
                    );
                  } finally {
                    setNewConversationSending(false);
                  }
                }}
                onOpenWorkspaceMenu={() => {
                  /* user uses topbar */
                }}
                onPickTrack={(track) => {
                  rememberTrack(track);
                  if (track !== 'model') setPickerTrack(track);
                }}
              />
              )}
            </>
          ) : nav.stage === 'agents' ? (
            <AgentLibrary
              agents={data.agents}
              models={data.models}
              onRefresh={() => void refresh()}
              onManageSkills={() => setNav((n) => selectStage(n, 'abilities'))}
              skillCatalogRevision={skillCatalogRevision}
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
          ) : nav.stage === 'browser' ? (
            <BrowserStage />
          ) : nav.stage === 'abilities' ? (
            <AbilitiesPage
              onCatalogChanged={() => {
                setSkillCatalogRevision((revision) => revision + 1);
                void refresh();
              }}
              onGoToAgents={() => setNav((n) => selectStage(n, 'agents'))}
            />
          ) : (
            <StagePlaceholder stage={nav.stage} />
          )}
        </main>
      </div>

      <Dialog.Root
        open={settingsOpen}
        onOpenChange={(open) => {
          if (open) setSettingsOpen(true);
        }}
      >
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          onCatalogChanged={() => void refresh()}
        />
      </Dialog.Root>
    </div>
  );
}

function EmptyTalk(props: {
  hasWorkspace: boolean;
  models: readonly ModelOption[];
  draft: string;
  selectedModelId: string;
  /** Track/target carried from "new chat" while still a welcome draft. */
  draftTrack?: ConversationTrack;
  draftTargetRef?: string;
  sending: boolean;
  error?: string;
  onDraftChange(draft: string): void;
  onModelChange(modelId: string): void;
  onSend(options: {
    modelId: string;
    permissionMode: PermissionMode;
    reasoningEffort: ReasoningEffort;
    networkEnabled: boolean;
  }): Promise<void>;
  onOpenWorkspaceMenu(): void;
  onPickTrack(track: ConversationTrack): void;
}) {
  const chips: Array<{ track: ConversationTrack; icon: typeof Sparkles; label: string; desc: string }> =
    [
      { track: 'model', icon: Sparkles, label: '跟模型聊', desc: '使用下方当前模型直接开始' },
      { track: 'agent', icon: Bot, label: '智能体', desc: '先选择一个智能体' },
      { track: 'team', icon: Users, label: '小队', desc: '先选择一个小队' },
    ];
  const [networkEnabled, setNetworkEnabled] = useState(true);
  const [userName, setUserName] = useState(() => readUserName());
  // Settings writes the name to localStorage; this event keeps the greeting
  // live without needing a restart or a shared store.
  useEffect(() => {
    const sync = () => setUserName(readUserName());
    window.addEventListener('shell-user-name-changed', sync);
    return () => window.removeEventListener('shell-user-name-changed', sync);
  }, []);
  const greeting = buildGreeting(new Date().getHours(), userName);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(() =>
    readDefaultPermission(),
  );
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('auto');
  const [permissionMenuOpen, setPermissionMenuOpen] = useState(false);
  const [reasoningMenuOpen, setReasoningMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const permissionButtonRef = useRef<HTMLButtonElement>(null);
  const reasoningButtonRef = useRef<HTMLButtonElement>(null);
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const selectedModel =
    props.models.find((model) => model.modelId === props.selectedModelId) ?? props.models[0];

  const submit = () =>
    props.onSend({
      modelId: selectedModel?.modelId ?? '',
      permissionMode,
      reasoningEffort,
      networkEnabled,
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-page">
      <div className="shell-welcome flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-8">
        <div className="flex flex-col items-center gap-1.5">
          <h2
            data-testid="welcome-greeting"
            className="shell-welcome-title m-0 text-[26px] font-semibold tracking-tight text-text"
          >
            {props.hasWorkspace ? greeting : '先打开一个工作区'}
          </h2>
          <p className="shell-welcome-subtitle m-0 text-[13px] text-text-faint">
            {props.hasWorkspace
              ? '今天想做什么？'
              : '在顶栏打开文件夹或新建工作区后即可对话'}
          </p>
        </div>

        {props.hasWorkspace ? (
          <div className="flex flex-wrap justify-center gap-2">
            {chips.map((chip, i) => {
              const Icon = chip.icon;
              return (
                <button
                  key={chip.track}
                  type="button"
                  data-testid={`welcome-track-${chip.track}`}
                  title={chip.desc}
                  className="shell-chip flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-[12.5px] text-text-secondary"
                  style={{ animationDelay: `${0.12 + i * 0.06}s` }}
                  onClick={() => props.onPickTrack(chip.track)}
                >
                  <Icon size={13} className="text-accent" />
                  {chip.label}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="m-0 text-[12px] text-text-faint">
            使用顶栏 <span className="font-medium text-text-secondary">+</span> 或工作区菜单创建
          </p>
        )}
      </div>

      {props.hasWorkspace ? (
        <div className="shell-chat-content-wrap shrink-0 pb-4 pt-2" data-testid="empty-compose-wrap">
          <div className="shell-chat-content mx-auto">
            <div className="shell-compose relative" data-testid="empty-compose">
              <textarea
                data-testid="empty-compose-input"
                className="shell-compose__input"
                placeholder="有什么我能帮你的吗？"
                value={props.draft}
                onChange={(event) => props.onDraftChange(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    void submit();
                  }
                }}
                rows={1}
                disabled={props.sending}
              />
              <div className="shell-compose__bar">
                <div className="shell-compose__bar-left">
                  <div className="shell-compose__tool-wrap">
                    <button
                      ref={permissionButtonRef}
                      type="button"
                      className="shell-compose__tool"
                      data-active={
                        permissionMenuOpen || permissionMode === 'full-access' ? '1' : '0'
                      }
                      title={`权限：${PERMISSION_OPTIONS.find((option) => option.value === permissionMode)?.title ?? '完全访问'}`}
                      onClick={() => setPermissionMenuOpen((value) => !value)}
                    >
                      <Zap size={15} />
                      <span className="shell-compose__tool-label">
                        {PERMISSION_OPTIONS.find((option) => option.value === permissionMode)?.title ??
                          '完全访问'}
                      </span>
                    </button>
                    <PermissionMenu
                      open={permissionMenuOpen}
                      value={permissionMode}
                      anchorEl={permissionButtonRef.current}
                      onClose={() => setPermissionMenuOpen(false)}
                      onChange={setPermissionMode}
                    />
                  </div>
                  <button
                    type="button"
                    className="shell-compose__tool"
                    data-active={networkEnabled ? '1' : '0'}
                    onClick={() => setNetworkEnabled((value) => !value)}
                    title={networkEnabled ? '联网已开（点击关闭）' : '联网已关（点击开启）'}
                  >
                    <Globe size={15} />
                  </button>
                  <div className="shell-compose__tool-wrap">
                    <button
                      ref={reasoningButtonRef}
                      type="button"
                      className="shell-compose__tool"
                      data-active={reasoningMenuOpen ? '1' : '0'}
                      title={`推理强度：${REASONING_LABELS[reasoningEffort]}`}
                      onClick={() => setReasoningMenuOpen((value) => !value)}
                    >
                      <Brain size={15} />
                      <span className="shell-compose__tool-label">
                        {REASONING_LABELS[reasoningEffort]}
                      </span>
                    </button>
                    <ReasoningMenu
                      open={reasoningMenuOpen}
                      value={reasoningEffort}
                      anchorEl={reasoningButtonRef.current}
                      onClose={() => setReasoningMenuOpen(false)}
                      onChange={setReasoningEffort}
                    />
                  </div>
                  <button type="button" className="shell-compose__tool" title="Skill（即将支持）" disabled>
                    <Puzzle size={15} />
                  </button>
                </div>
                <div className="shell-compose__bar-right">
                  <ContextRing
                    used={Math.round(props.draft.length / 4)}
                    limit={
                      (typeof selectedModel?.contextWindow === 'number' &&
                      selectedModel.contextWindow > 0
                        ? selectedModel.contextWindow
                        : undefined) ||
                      estimateContextWindow(
                        selectedModel?.displayName || selectedModel?.modelId,
                      )
                    }
                  />
                  <div className="shell-compose__tool-wrap">
                    <ModelTrigger
                      label={selectedModel?.displayName ?? '选择模型'}
                      open={modelMenuOpen}
                      buttonRef={modelButtonRef}
                      onClick={() => setModelMenuOpen((value) => !value)}
                    />
                    <ModelPickerMenu
                      open={modelMenuOpen}
                      models={props.models}
                      selectedModelId={selectedModel?.modelId ?? ''}
                      defaultLabel="选择模型"
                      anchorEl={modelButtonRef.current}
                      onClose={() => setModelMenuOpen(false)}
                      onPick={props.onModelChange}
                    />
                  </div>
                  <button
                    type="button"
                    className="shell-compose__send"
                    onClick={() => void submit()}
                    disabled={!props.draft.trim() || props.sending}
                    title="发送 (Enter)"
                    data-testid="empty-compose-send"
                  >
                    <SendHorizonal size={15} />
                  </button>
                </div>
              </div>
              {props.error ? (
                <div className="px-3 pb-2 text-[11.5px] text-error" role="alert">
                  {props.error}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StagePlaceholder({ stage }: { stage: ShellNavState['stage'] }) {
  return (
    <div className="flex flex-1 items-center justify-center text-text-faint">
      <div className="text-[13px]">{STAGE_LABELS[stage]} · 即将推出</div>
    </div>
  );
}

function SettingsModal({
  onClose,
  onCatalogChanged,
}: {
  onClose(): void;
  onCatalogChanged(): void;
}) {
  const [dirty, setDirty] = useState(false);

  const requestClose = () => {
    if (!canCloseSettings(dirty, (message) => confirm(message))) return;
    setDirty(false);
    onClose();
  };

  const forceClose = () => {
    setDirty(false);
    onClose();
  };

  return (
    <Dialog.Portal>
      <Dialog.Overlay className="settings-modal-backdrop" />
      <Dialog.Content
        className="settings-modal-positioner"
        aria-describedby={undefined}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          requestClose();
        }}
        onPointerDownOutside={(event) => {
          event.preventDefault();
          requestClose();
        }}
      >
        <div className="settings-modal-content">
          <Dialog.Title className="sr-only">设置</Dialog.Title>
          <button
            type="button"
            className="settings-modal-close"
            aria-label="关闭设置"
            onClick={requestClose}
          >
            <X size={17} aria-hidden="true" />
          </button>
          <SettingsPage
            onDone={forceClose}
            onCatalogChanged={onCatalogChanged}
            onDirtyChange={setDirty}
          />
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  );
}

// Keep empty groups helper referenced for tests / future reset.
void emptyConversationGroups;
