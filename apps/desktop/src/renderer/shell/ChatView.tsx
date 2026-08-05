import {
  useCallback,
  useEffect,
  useLayoutEffect,
  memo,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  Archive,
  Bot,
  Brain,
  Check,
  ChevronDown,
  Copy,
  FileCode2,
  FileWarning,
  FolderOpen,
  Globe,
  Info,
  Lock,
  LoaderCircle,
  MessageSquare,
  PenLine,
  RefreshCw,
  SendHorizonal,
  Share2,
  Shield,
  Sparkles,
  Square,
  Terminal,
  Users,
  X,
  Zap,
} from 'lucide-react';
import {
  splitProviderUsageTokens,
  type Conversation,
  type Event,
  type GlobalAgent,
  type Message,
  type MessageBlock,
  type RunId,
  type TaskId,
  type Team,
} from '@sync-think/shared';
import type {
  ConversationGetContextStatusResponse,
  ConversationGetRunProcessResponse,
  ConversationListMessagesResponse,
  ConversationTransientFrame,
  BrowserHandoffSummary,
  DesktopWaitingCommandSummary,
  ConversationTransientSnapshot,
  RunProcessView,
  WorkspaceSummary,
} from '@sync-think/protocol';
import { parseConversationGetContextStatusResponse } from '@sync-think/protocol/conversation-context-status';
import type { ProjectTextLocation } from '../../workspace-tools-contract.js';
import { AgentAvatarView } from './AgentAvatarView.js';
import { BrowserHandoffCard, BrowserHandoffQueryError } from './BrowserHandoffCard.js';
import { DesktopWaitingCard, DesktopWaitingQueryError } from './DesktopWaitingCard.js';
import { RightDock } from './RightDock.js';
import type { ModelOption } from './NewConversationDialog.js';
import {
  addAttachment,
  buildMessageWithAttachments,
  computeTextareaHeight,
  detectMentionQuery,
  fileNameFromPath,
  isImageFile,
  messageImagesFromAttachments,
  readFileAsDataUrl,
  removeAttachment,
  stripMentionToken,
  type ComposeAttachment,
  type MentionQuery,
  type MessageImage,
} from './compose-mention.js';
import {
  detectSlashQuery,
  filterSlashCommands,
  formatCompactElapsed,
  parseSlashCommand,
  resolveSendModelId,
  resolveSystemMessageTone,
  stripSlashToken,
  type SlashCommand,
  type SlashQuery,
  type SystemMessageTone,
} from './compose-slash.js';
import {
  resolveAppendSkillVersionIds,
  resolveConversationSkillOwner,
  resolveDefaultComposeSkillVersionIds,
} from './compose-skill-selection.js';
import { compressImageDataUrl } from './image-compress.js';
import {
  ContextRing,
  IdentityPickerMenu,
  ModelPickerMenu,
  ModelTrigger,
  PermissionMenu,
  ReasoningMenu,
  REASONING_LABELS,
  type IdentityOption,
  type PermissionMode,
  type ReasoningEffort,
} from './compose-toolbar.js';
import { TurnSkillControl } from './TurnSkillControl.js';
import {
  ExecutionProcessBlock,
  FileChangesCard,
  formatExecutionStepTitle,
} from './ExecutionProcessBlock.js';
import {
  formatCompactCount,
  formatCompactDuration,
  formatCompactRunMetrics,
  formatMessageAbsoluteTime,
  formatMessageClock,
  formatRunModelLabel,
} from './execution-process.js';
import { MarkdownContent } from './MarkdownContent.js';
import { executeBrowserCommand } from './browser-commands.js';
import {
  applyConversationStreamOperations,
  collectConversationStreamBatch,
  isRunTerminalEventType,
  projectConversationRunActivity,
  selectLatestRunPauseNotice,
  type ConversationStreamDraft,
} from './chat-stream.js';
import { applyTransientConversationFrames } from './chat-transient-stream.js';
import {
  inferNativeScrollIntent,
  resolveBottomPinState,
  shouldRestorePrependAnchor,
} from './message-window.js';
import { updateRunProcessMap } from './run-process-state.js';
import {
  readConversationModelOverride,
  writeConversationModelOverride,
} from '../ui-preferences.js';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  /** Extended thinking / reasoning channel (never mixed into text). */
  reasoningText?: string;
  /** Local image previews attached to this bubble (optimistic / UI only). */
  images?: MessageImage[];
  /** Visual tone for system notices — never treat all system as error. */
  tone?: SystemMessageTone;
  timestamp: string;
  /** Durable thread-local order; present for messages loaded from the store. */
  sequence?: number;
  streaming?: boolean;
  runId?: string;
  terminalState?: 'failed' | 'cancelled';
  terminalError?: string;
  /** Bound global agent identity for this assistant turn. */
  globalAgentId?: string;
  globalAgentName?: string;
}

/** Convert a durable Message from the store into the UI ChatMessage shape. */
export function messageToChat(msg: Message): ChatMessage {
  const textBlocks = msg.blocks.filter((b: MessageBlock) => b.type === 'text');
  const text = textBlocks.map((b: MessageBlock) => b.text ?? '').join('\n');
  const imageBlocks = msg.blocks.filter((b: MessageBlock) => b.type === 'image');
  const terminalPayload = (msg.blocks.find((block: MessageBlock) => block.type === 'error')
    ?.payload ?? {}) as Record<string, unknown>;
  const terminalState =
    terminalPayload.terminalState === 'failed' || terminalPayload.terminalState === 'cancelled'
      ? terminalPayload.terminalState
      : undefined;
  const images: MessageImage[] | undefined =
    imageBlocks.length > 0
      ? imageBlocks.map((b: MessageBlock) => {
          const p = (b.payload ?? {}) as Record<string, unknown>;
          const storageRef = typeof p.storageRef === 'string' ? p.storageRef : String(p.id ?? '');
          return {
            id: typeof p.id === 'string' ? p.id : storageRef,
            name: typeof p.name === 'string' ? p.name : 'image',
            mimeType: typeof p.mimeType === 'string' ? p.mimeType : 'image/png',
            url: `sync-think-image://media/${encodeURIComponent(storageRef)}`,
          };
        })
      : undefined;
  // Map role — 'tool' is not a valid ChatMessage role, show as system.
  const role: ChatMessage['role'] =
    msg.role === 'user' ? 'user' : msg.role === 'assistant' ? 'assistant' : 'system';
  return {
    id: String(msg.id),
    role,
    text,
    images,
    timestamp: msg.createdAt ?? '',
    sequence: msg.sequence,
    runId: msg.runId ? String(msg.runId) : undefined,
    terminalState,
    terminalError:
      typeof terminalPayload.errorMessage === 'string' ? terminalPayload.errorMessage : undefined,
    // sequence carried via id ordering; globalAgent fields are not in the store Message model
    // but could be enriched later if needed.
  };
}

type CompactProgressStatus = 'running' | 'success' | 'noop' | 'failure';

interface CompactProgressState {
  status: CompactProgressStatus;
  mode: 'manual' | 'auto';
  startedAt: number;
  message: string;
  /** After-tokens estimate from a successful compact — drives the ring until next usage. */
  afterTokens?: number;
}

interface PendingToolApproval {
  approvalId: string;
  runId?: string;
  toolCallId?: string;
  toolName: string;
  title: string;
  detail: string;
  path?: string;
  command?: string;
  decided?: 'approve' | 'deny';
}

export type { PermissionMode, ReasoningEffort };

interface ChatViewProps {
  conversation: Conversation;
  modelName: string;
  models: readonly ModelOption[];
  /** Global agents — used so agent-track chats resolve defaultModelId, not agent id. */
  agents?: readonly GlobalAgent[];
  /** 小队列表 — 输入框「对话对象」选择器用。 */
  teams?: readonly Team[];
  workspaces?: readonly WorkspaceSummary[];
  /** Shell-level durable event history (connect snapshot + live events). */
  eventHistory: readonly Event[];
  /** Increments after every Runtime connect/reconnect so durable UI state is re-queried. */
  runtimeConnectionRevision?: number;
  onTitleUpdated: (title: string) => void;
  /** Fired after permission mode is persisted so the shell can refresh the conversation list. */
  onConversationUpdated?: () => void;
  /** One-shot selection carried from the welcome-page first send. */
  initialSkillVersionIds?: readonly string[];
  onInitialSkillSelectionConsumed?(conversationId: string): void;
  /**
   * Right-rail open state is owned by the stage tab strip so the duplicate
   * in-chat title bar can stay gone (NewMax: tabs are the only chrome).
   */
  railOpen?: boolean;
  onRailOpenChange?(open: boolean): void;
  onOpenFile?: (path: string, location?: ProjectTextLocation) => void;
}

function bridge() {
  return window.syncThink?.runtime;
}

const PERMISSION_LABELS: Record<PermissionMode, string> = {
  ask: '询问批准',
  workspace: '为我批准',
  'full-access': '完全访问',
};
const PERMISSION_ICONS: Record<PermissionMode, typeof Shield> = {
  ask: Lock,
  workspace: Shield,
  'full-access': Zap,
};

export function ChatView({
  conversation,
  modelName,
  models,
  agents = [],
  teams = [],
  workspaces = [],
  eventHistory,
  runtimeConnectionRevision = 0,
  onTitleUpdated,
  onConversationUpdated,
  initialSkillVersionIds,
  onInitialSkillSelectionConsumed,
  railOpen: railOpenProp,
  onRailOpenChange,
  onOpenFile,
}: ChatViewProps) {
  const skillOwner = useMemo(
    () => resolveConversationSkillOwner(conversation, agents, teams),
    [agents, conversation, teams],
  );
  const defaultSkillVersionIds = useMemo(
    () => resolveDefaultComposeSkillVersionIds(conversation, agents, teams),
    [agents, conversation, teams],
  );
  const skillSelectionScopeKey = `${String(conversation.id)}\0${conversation.track}\0${String(
    conversation.targetRef,
  )}\0${String(skillOwner?.id ?? '')}\0${defaultSkillVersionIds.join('\0')}`;
  const skillSelectionScopeKeyRef = useRef(skillSelectionScopeKey);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(
    (conversation.executionMode as PermissionMode) || 'full-access',
  );
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('auto');
  // Restore last explicit model pick for this conversation across restarts.
  const [modelOverride, setModelOverride] = useState<string>(
    () => readConversationModelOverride(String(conversation.id)) ?? '',
  );
  const [netEnabled, setNetEnabled] = useState(true);
  /** NewMax-style context compact progress capsule. */
  const [compactProgress, setCompactProgress] = useState<CompactProgressState | null>(null);
  /** In-flight compact lock — blocks concurrent compact / command swallow. */
  const compactingRef = useRef(false);
  /**
   * Single dismiss timer for the compact capsule.
   * Without this, an older success/noop timeout can clear a newer running state.
   */
  const compactDismissTimerRef = useRef<number | null>(null);
  const clearCompactDismissTimer = useCallback(() => {
    if (compactDismissTimerRef.current !== null) {
      window.clearTimeout(compactDismissTimerRef.current);
      compactDismissTimerRef.current = null;
    }
  }, []);
  const scheduleCompactDismiss = useCallback(
    (delayMs: number) => {
      clearCompactDismissTimer();
      compactDismissTimerRef.current = window.setTimeout(() => {
        compactDismissTimerRef.current = null;
        setCompactProgress(null);
      }, delayMs);
    },
    [clearCompactDismissTimer],
  );
  useEffect(() => () => clearCompactDismissTimer(), [clearCompactDismissTimer]);
  /** Uncontrolled fallback when the stage does not own the rail. */
  const [railOpenInternal, setRailOpenInternal] = useState(false);
  const railOpen = railOpenProp ?? railOpenInternal;
  const setRailOpen = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const value = typeof next === 'function' ? next(railOpen) : next;
      if (onRailOpenChange) onRailOpenChange(value);
      else setRailOpenInternal(value);
    },
    [onRailOpenChange, railOpen],
  );
  /** Resolved thread for this conversation (from bound task). */
  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  /** Optimistic user bubbles not yet present in durable event history. */
  const [pendingUserMessages, setPendingUserMessages] = useState<ChatMessage[]>([]);
  const [localErrors, setLocalErrors] = useState<ChatMessage[]>([]);
  /** Paginated message store state. */
  const [loadedMessages, setLoadedMessages] = useState<ChatMessage[]>([]);
  const [runProcessById, setRunProcessById] = useState<Map<string, RunProcessView>>(
    () => new Map(),
  );
  const inFlightRunProcessesRef = useRef(new Set<string>());
  const processLoadGenerationRef = useRef(0);
  const runProcessRetryTimersRef = useRef(new Map<string, number>());
  const runProcessRetryAttemptsRef = useRef(new Map<string, number>());
  const [runProcessRetryEpoch, setRunProcessRetryEpoch] = useState(0);
  const clearRunProcessRetryState = useCallback(() => {
    for (const timer of runProcessRetryTimersRef.current.values()) {
      window.clearTimeout(timer);
    }
    runProcessRetryTimersRef.current.clear();
    runProcessRetryAttemptsRef.current.clear();
  }, []);
  useEffect(() => () => clearRunProcessRetryState(), [clearRunProcessRetryState]);
  const loadedMessagesConversationIdRef = useRef<string | undefined>(undefined);
  const updateRunProcess = useCallback((process: RunProcessView) => {
    setRunProcessById((previous) => updateRunProcessMap(previous, process));
  }, []);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<number | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  /** Whether the initial page load has completed (success or failure). */
  const [initialLoaded, setInitialLoaded] = useState(false);
  /** Runtime-owned snapshot used by the ring and compact threshold. */
  const [contextStatus, setContextStatus] = useState<ConversationGetContextStatusResponse | null>(
    null,
  );
  const contextStatusRef = useRef<ConversationGetContextStatusResponse | null>(null);
  contextStatusRef.current = contextStatus;
  const contextStatusLoadGenerationRef = useRef(0);
  /** Streaming message accumulated from the transient stream (durable delta is fallback only). */
  const [streamingMessage, setStreamingMessage] = useState<ChatMessage | null>(null);
  const transientDraftRef = useRef<ConversationStreamDraft | null>(null);
  const transientFrameQueueRef = useRef<ConversationTransientFrame[]>([]);
  const transientFrameFlushRef = useRef<number | null>(null);
  /** Last durable event sequence consumed by the fallback streaming bridge. */
  const lastConsumedEventSequenceRef = useRef(0);
  /** Thread-local transient cursor, preserved across Runtime reconnects within this ChatView. */
  const lastTransientSequenceRef = useRef(0);
  /** Live subscription availability: fallback durable deltas are consumed only when false. */
  const transientStreamHealthyRef = useRef(false);
  /** resetRequired pins this ChatView to durable fallback until it resubscribes cleanly. */
  const transientFallbackOnlyRef = useRef(false);
  /** Forces fallback replay after a reset/subscribe failure even if no new durable event arrived. */
  const [transientFallbackEpoch, setTransientFallbackEpoch] = useState(0);
  /** resetRequired means the bounded replay had a gap; rebuild the current draft from durable deltas. */
  const transientResetGenerationRef = useRef(0);
  /** Guards against processing events with a stale threadId after switching chats. */
  const threadConversationIdRef = useRef<string | undefined>(undefined);
  /** Invalidates in-flight durable message reads after a refresh or conversation switch. */
  const messageLoadGenerationRef = useRef(0);
  const activeConversationIdRef = useRef(String(conversation.id));
  activeConversationIdRef.current = String(conversation.id);
  const renderTransientDraft = useCallback(
    (draft: ConversationStreamDraft | null, fallbackSequence: number) => {
      transientDraftRef.current = draft;
      setStreamingMessage(
        draft
          ? {
              id: `streaming-${draft.runId ?? fallbackSequence}`,
              role: 'assistant',
              text: draft.text,
              reasoningText: draft.reasoningText,
              timestamp: draft.timestamp,
              streaming: true,
              runId: draft.runId,
            }
          : null,
      );
    },
    [],
  );
  const flushTransientFrames = useCallback(() => {
    transientFrameFlushRef.current = null;
    const frames = transientFrameQueueRef.current.splice(0);
    if (!threadId || frames.length === 0) return;
    const next = applyTransientConversationFrames({
      current: transientDraftRef.current,
      frames,
      threadId,
      afterStreamSequence: lastTransientSequenceRef.current,
    });
    lastTransientSequenceRef.current = next.lastStreamSequence;
    renderTransientDraft(next.draft, next.lastStreamSequence);
  }, [renderTransientDraft, threadId]);
  /** Active @-mention query (null = picker closed). */
  const [mention, setMention] = useState<MentionQuery | null>(null);
  const [mentionFiles, setMentionFiles] = useState<
    Array<{ path: string; name: string; kind: 'file' | 'dir' }>
  >([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionLoading, setMentionLoading] = useState(false);
  /** Active / slash-command query (null = menu closed). Mutually exclusive with @. */
  const [slash, setSlash] = useState<SlashQuery | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  /** Selected @-files / images shown as chips (NewMax style). */
  const [attachments, setAttachments] = useState<ComposeAttachment[]>([]);
  /** Exact immutable Skill versions used by normal Composer sends in this conversation. */
  const [selectedSkillVersionIds, setSelectedSkillVersionIds] = useState<string[]>(() =>
    resolveAppendSkillVersionIds(
      conversation.track,
      initialSkillVersionIds ?? defaultSkillVersionIds,
    ),
  );
  /** Which compose menu is open (exclusive). */
  const [menu, setMenu] = useState<
    'permission' | 'reasoning' | 'skill' | 'model' | 'identity' | null
  >(null);
  /** Click-to-preview lightbox for message / chip images. */
  const [lightbox, setLightbox] = useState<MessageImage | null>(null);
  const [dragOver, setDragOver] = useState(false);
  /** Live tick so compact capsule can show elapsed seconds. */
  const [compactNow, setCompactNow] = useState(() => Date.now());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  /** Prevent duplicate history-page requests while a top-edge load is pending. */
  const loadingMoreRef = useRef(false);
  /** Invalidates an async prepend anchor when the user keeps scrolling meanwhile. */
  const userScrollRevisionRef = useRef(0);
  /** Distinguishes native/user scroll direction, including scrollbar dragging. */
  const lastObservedScrollTopRef = useRef(0);
  /** Prevents our own one-shot scroll corrections from being treated as user input. */
  const programmaticScrollTargetRef = useRef<number | null>(null);
  /** After switching conversations, jump to bottom instantly (no smooth scroll). */
  const stickToBottomRef = useRef(true);
  /** Last explicit scroll direction; layout-driven scroll events leave it null. */
  const bottomPinIntentRef = useRef<'toward-bottom' | 'away-from-bottom' | null>(null);
  const lastTouchClientYRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const composeRef = useRef<HTMLDivElement>(null);
  const mentionListRef = useRef<HTMLDivElement>(null);
  const slashListRef = useRef<HTMLDivElement>(null);
  const permissionBtnRef = useRef<HTMLButtonElement>(null);
  const reasoningBtnRef = useRef<HTMLButtonElement>(null);
  const modelBtnRef = useRef<HTMLButtonElement>(null);
  const identityBtnRef = useRef<HTMLButtonElement>(null);
  const [mentionPopStyle, setMentionPopStyle] = useState<React.CSSProperties | null>(null);
  const [slashPopStyle, setSlashPopStyle] = useState<React.CSSProperties | null>(null);
  useEffect(() => {
    if (initialSkillVersionIds !== undefined) {
      onInitialSkillSelectionConsumed?.(String(conversation.id));
    }
  }, [conversation.id, initialSkillVersionIds, onInitialSkillSelectionConsumed]);

  useEffect(() => {
    if (skillSelectionScopeKeyRef.current === skillSelectionScopeKey) return;
    skillSelectionScopeKeyRef.current = skillSelectionScopeKey;
    setSelectedSkillVersionIds(defaultSkillVersionIds);
    setMenu(null);
  }, [defaultSkillVersionIds, skillSelectionScopeKey]);

  // Reset local compose state when switching conversations.
  useEffect(() => {
    userScrollRevisionRef.current = 0;
    lastObservedScrollTopRef.current = 0;
    programmaticScrollTargetRef.current = null;
    setInput('');
    setSending(false);
    setPendingUserMessages([]);
    setLocalErrors([]);
    browserHandoffLoadGenerationRef.current += 1;
    setBrowserHandoffs([]);
    setBrowserHandoffStatus('idle');
    setBrowserHandoffError(undefined);
    setBusyBrowserHandoffId(undefined);
    desktopWaitingLoadGenerationRef.current += 1;
    setDesktopWaitingCommands([]);
    setDesktopWaitingStatus('idle');
    setDesktopWaitingError(undefined);
    setBusyDesktopCommandId(undefined);
    setLoadedMessages([]);
    setRunProcessById(new Map());
    inFlightRunProcessesRef.current.clear();
    clearRunProcessRetryState();
    processLoadGenerationRef.current += 1;
    loadedMessagesConversationIdRef.current = undefined;
    setHasMore(false);
    setNextCursor(undefined);
    setLoadingMore(false);
    loadingMoreRef.current = false;
    setInitialLoaded(false);
    contextStatusLoadGenerationRef.current += 1;
    setContextStatus(null);
    transientDraftRef.current = null;
    transientFrameQueueRef.current.length = 0;
    if (transientFrameFlushRef.current !== null) {
      window.cancelAnimationFrame(transientFrameFlushRef.current);
      transientFrameFlushRef.current = null;
    }
    setStreamingMessage(null);
    lastConsumedEventSequenceRef.current = 0;
    lastTransientSequenceRef.current = 0;
    transientStreamHealthyRef.current = false;
    transientFallbackOnlyRef.current = false;
    transientResetGenerationRef.current += 1;
    threadConversationIdRef.current = undefined;
    messageLoadGenerationRef.current += 1;
    setMention(null);
    setMentionFiles([]);
    setSlash(null);
    setSlashIndex(0);
    setAttachments([]);
    setCompactProgress(null);
    setMenu(null);
    setPermissionMode((conversation.executionMode as PermissionMode) || 'full-access');
    setModelOverride(readConversationModelOverride(String(conversation.id)) ?? '');
    // Always land at the latest message when opening a chat — no animated scroll.
    stickToBottomRef.current = true;
    bottomPinIntentRef.current = null;
    lastTouchClientYRef.current = null;
    // Right-rail open state is owned by the stage; do not force-close it on switch.
  }, [clearRunProcessRetryState, conversation.id, conversation.executionMode]);

  // Resolve threadId from the bound task so we can project history for this conversation.
  useEffect(() => {
    let cancelled = false;
    const api = bridge();
    const taskId = conversation.taskId as TaskId | undefined;

    if (!api?.openTask || !taskId) {
      setThreadId(undefined);
      return;
    }

    void api
      .openTask({ taskId })
      .then((response: { task?: { threadId?: string } }) => {
        if (cancelled) return;
        const resolved = response?.task?.threadId;
        const nextThreadId =
          typeof resolved === 'string' && resolved.length > 0 ? resolved : undefined;
        threadConversationIdRef.current = nextThreadId ? String(conversation.id) : undefined;
        setThreadId(nextThreadId);
      })
      .catch(() => {
        if (!cancelled) setThreadId(undefined);
      });

    return () => {
      cancelled = true;
    };
  }, [conversation.id, conversation.taskId]);

  // ─── Paginated message loading from the durable store ───────────────────────
  const loadMessages = useCallback(
    async (cursor?: number): Promise<boolean> => {
      const api = bridge();
      if (!api?.listConversationMessages) {
        if (cursor === undefined) setInitialLoaded(true);
        return false;
      }
      const conversationId = String(conversation.id);
      // Every latest-page read supersedes earlier initial/terminal refreshes and
      // any older-page request that started from an obsolete list snapshot.
      const generation =
        cursor === undefined
          ? (messageLoadGenerationRef.current += 1)
          : messageLoadGenerationRef.current;
      if (cursor === undefined) {
        setLoadingMore(false);
      } else {
        // Wheel events can arrive several times before React commits the
        // loadingMore state update. Guard the imperative edge-trigger as well
        // so one scroll gesture cannot start overlapping prepends.
        if (loadingMoreRef.current) return false;
        loadingMoreRef.current = true;
        setLoadingMore(true);
      }
      try {
        const res: ConversationListMessagesResponse = await api.listConversationMessages({
          conversationId: conversation.id,
          beforeSequence: cursor,
          limit: 50,
        });
        if (
          activeConversationIdRef.current !== conversationId ||
          messageLoadGenerationRef.current !== generation
        ) {
          return false;
        }
        loadedMessagesConversationIdRef.current = conversationId;
        const converted = res.messages
          .map(messageToChat)
          .filter((m) => m.text.trim().length > 0 || Boolean(m.images?.length));
        if (cursor !== undefined) {
          // Prepend older messages and de-duplicate defensive retries. Durable
          // sequence is the canonical order, not async response arrival order.
          setLoadedMessages((prev) => {
            const byId = new Map<string, ChatMessage>();
            for (const message of [...converted, ...prev]) byId.set(message.id, message);
            return [...byId.values()].sort(
              (left, right) =>
                (left.sequence ?? Number.MAX_SAFE_INTEGER) -
                (right.sequence ?? Number.MAX_SAFE_INTEGER),
            );
          });
        } else {
          // Initial / terminal refresh — already in chronological order (ASC).
          setLoadedMessages(converted);
        }
        setHasMore(res.hasMore);
        setNextCursor(res.nextCursor);
        return true;
      } catch {
        // Non-fatal: the user can still send messages.
        return false;
      } finally {
        if (
          activeConversationIdRef.current === conversationId &&
          messageLoadGenerationRef.current === generation
        ) {
          if (cursor !== undefined) {
            loadingMoreRef.current = false;
            setLoadingMore(false);
          } else setInitialLoaded(true);
        }
      }
    },
    [conversation.id],
  );

  const refreshContextStatus = useCallback(async (): Promise<void> => {
    const api = bridge();
    if (!api?.getConversationContextStatus) return;
    const conversationId = String(conversation.id);
    const generation = (contextStatusLoadGenerationRef.current += 1);
    try {
      const response = parseConversationGetContextStatusResponse(
        await api.getConversationContextStatus({ conversationId: conversation.id }),
      );
      if (
        activeConversationIdRef.current === conversationId &&
        contextStatusLoadGenerationRef.current === generation
      ) {
        setContextStatus(response);
      }
    } catch {
      // Keep the last validated snapshot on transient IPC/runtime failures.
    }
  }, [conversation.id]);

  // Load initial durable messages and the Runtime-owned context snapshot.
  useEffect(() => {
    if (!conversation.id) return;
    void loadMessages();
    void refreshContextStatus();
  }, [conversation.id, threadId, loadMessages, refreshContextStatus]);

  // Lightweight streaming/activeRunId detection from eventHistory.
  // This only scans run lifecycle events (O(n) but no message text building).
  const [browserHandoffs, setBrowserHandoffs] = useState<BrowserHandoffSummary[]>([]);
  const [browserHandoffStatus, setBrowserHandoffStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle');
  const [browserHandoffError, setBrowserHandoffError] = useState<string | undefined>();
  const [busyBrowserHandoffId, setBusyBrowserHandoffId] = useState<string | undefined>();
  const browserHandoffLoadGenerationRef = useRef(0);
  const [desktopWaitingCommands, setDesktopWaitingCommands] = useState<
    DesktopWaitingCommandSummary[]
  >([]);
  const [desktopWaitingStatus, setDesktopWaitingStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle');
  const [desktopWaitingError, setDesktopWaitingError] = useState<string | undefined>();
  const [busyDesktopCommandId, setBusyDesktopCommandId] = useState<string | undefined>();
  const desktopWaitingLoadGenerationRef = useRef(0);

  const projected = useMemo(
    () =>
      threadId
        ? projectConversationRunActivity({
            events: eventHistory,
            threadId,
            taskId: conversation.taskId ? String(conversation.taskId) : undefined,
          })
        : { streaming: false, activeRunId: undefined },
    [conversation.taskId, eventHistory, threadId],
  );

  const pausedRunNotice = useMemo(
    () =>
      threadId
        ? selectLatestRunPauseNotice({
            events: eventHistory,
            threadId,
            taskId: conversation.taskId ? String(conversation.taskId) : undefined,
          })
        : undefined,
    [conversation.taskId, eventHistory, threadId],
  );

  const browserHandoffLifecycleRevision = useMemo(() => {
    let revision = 0;
    for (const event of eventHistory) {
      if (conversation.workspaceId && event.workspaceId !== conversation.workspaceId) continue;
      if (projected.activeRunId && event.runId && event.runId !== projected.activeRunId) continue;
      const isLifecycleEvent =
        event.type === 'browser.handoff.continued' || event.type === 'browser.handoff.cancelled';
      const isExplicitWaitingEvent =
        event.type === 'approval.requested' && event.payload.action === 'browser.handoff';
      const isOrchestrationWaitingEvent =
        event.type === 'step.awaitingApproval' || event.type === 'run.awaitingToolApproval';
      if (isLifecycleEvent || isExplicitWaitingEvent || isOrchestrationWaitingEvent) {
        revision = Math.max(revision, event.sequence);
      }
    }
    return revision;
  }, [conversation.workspaceId, eventHistory, projected.activeRunId]);

  const desktopWaitingLifecycleRevision = useMemo(() => {
    let revision = 0;
    for (const event of eventHistory) {
      if (
        event.type !== 'desktop.command.waiting_user' &&
        event.type !== 'desktop.command.continued' &&
        event.type !== 'desktop.command.cancelled'
      ) {
        continue;
      }
      if (conversation.workspaceId && event.workspaceId !== conversation.workspaceId) continue;
      if (projected.activeRunId && event.runId && event.runId !== projected.activeRunId) continue;
      revision = Math.max(revision, event.sequence);
    }
    return revision;
  }, [conversation.workspaceId, eventHistory, projected.activeRunId]);

  const refreshDesktopWaitingCommands = useCallback(
    async (showLoading = true) => {
      const api = bridge();
      const workspaceId = conversation.workspaceId;
      const taskId = conversation.taskId;
      const runId = projected.activeRunId;
      if (!api?.listWaitingDesktopCommands || !workspaceId || !taskId || !threadId) {
        desktopWaitingLoadGenerationRef.current += 1;
        setDesktopWaitingCommands([]);
        setDesktopWaitingStatus('idle');
        setDesktopWaitingError(undefined);
        return;
      }
      const generation = (desktopWaitingLoadGenerationRef.current += 1);
      if (showLoading) setDesktopWaitingStatus('loading');
      setDesktopWaitingError(undefined);
      try {
        const response = await api.listWaitingDesktopCommands({
          workspaceId,
          ...(runId ? { runId: runId as RunId } : {}),
        });
        if (desktopWaitingLoadGenerationRef.current !== generation) return;
        setDesktopWaitingCommands(
          response.commands.filter(
            (command) =>
              command.workspaceId === workspaceId &&
              command.taskId === taskId &&
              (!runId || command.runId === runId),
          ),
        );
        setDesktopWaitingStatus('ready');
      } catch {
        if (desktopWaitingLoadGenerationRef.current !== generation) return;
        setDesktopWaitingStatus('error');
      }
    },
    [conversation.taskId, conversation.workspaceId, projected.activeRunId, threadId],
  );

  useEffect(() => {
    void refreshDesktopWaitingCommands();
  }, [desktopWaitingLifecycleRevision, refreshDesktopWaitingCommands, runtimeConnectionRevision]);

  const decideDesktopCommand = useCallback(
    async (command: DesktopWaitingCommandSummary, decision: 'continue' | 'cancel') => {
      const api = bridge();
      if (busyDesktopCommandId || !api?.continueDesktopCommand || !api.cancelDesktopCommand) {
        return;
      }
      setBusyDesktopCommandId(command.commandId);
      setDesktopWaitingError(undefined);
      try {
        if (decision === 'continue') {
          await api.continueDesktopCommand({
            commandId: command.commandId,
            expectedUpdatedAt: command.updatedAt,
          });
        } else {
          await api.cancelDesktopCommand({
            commandId: command.commandId,
            expectedUpdatedAt: command.updatedAt,
          });
        }
        await refreshDesktopWaitingCommands(false);
      } catch {
        await refreshDesktopWaitingCommands(false);
        setDesktopWaitingError('操作未生效，桌面等待状态可能已在其他窗口改变。请刷新状态后重试。');
      } finally {
        setBusyDesktopCommandId(undefined);
      }
    },
    [busyDesktopCommandId, refreshDesktopWaitingCommands],
  );

  const refreshBrowserHandoffs = useCallback(
    async (showLoading = true) => {
      const api = bridge();
      const workspaceId = conversation.workspaceId;
      const taskId = conversation.taskId;
      const runId = projected.activeRunId;
      if (!api?.listWaitingBrowserHandoffs || !workspaceId || !taskId || !threadId) {
        browserHandoffLoadGenerationRef.current += 1;
        setBrowserHandoffs([]);
        setBrowserHandoffStatus('idle');
        setBrowserHandoffError(undefined);
        return;
      }
      const generation = (browserHandoffLoadGenerationRef.current += 1);
      if (showLoading) setBrowserHandoffStatus('loading');
      setBrowserHandoffError(undefined);
      try {
        const response = await api.listWaitingBrowserHandoffs({
          workspaceId,
          ...(runId ? { runId: runId as RunId } : {}),
        });
        if (browserHandoffLoadGenerationRef.current !== generation) return;
        setBrowserHandoffs(
          response.handoffs.filter(
            (handoff) =>
              handoff.workspaceId === workspaceId &&
              handoff.taskId === taskId &&
              (!runId || handoff.runId === runId),
          ),
        );
        setBrowserHandoffStatus('ready');
      } catch {
        if (browserHandoffLoadGenerationRef.current !== generation) return;
        setBrowserHandoffStatus('error');
      }
    },
    [conversation.taskId, conversation.workspaceId, projected.activeRunId, threadId],
  );

  useEffect(() => {
    void refreshBrowserHandoffs();
  }, [browserHandoffLifecycleRevision, refreshBrowserHandoffs, runtimeConnectionRevision]);

  const decideBrowserHandoff = useCallback(
    async (handoff: BrowserHandoffSummary, decision: 'continue' | 'cancel') => {
      const api = bridge();
      if (busyBrowserHandoffId || !api?.continueBrowserHandoff || !api.cancelBrowserHandoff) {
        return;
      }
      setBusyBrowserHandoffId(handoff.handoffId);
      setBrowserHandoffError(undefined);
      try {
        if (decision === 'continue') {
          await api.continueBrowserHandoff({
            handoffId: handoff.handoffId,
            expectedRevision: handoff.revision,
          });
        } else {
          await api.cancelBrowserHandoff({
            handoffId: handoff.handoffId,
            expectedRevision: handoff.revision,
            leaseDisposition: handoff.onCancel === 'close-page' ? 'release' : 'preserve',
          });
        }
        await refreshBrowserHandoffs(false);
      } catch {
        await refreshBrowserHandoffs(false);
        setBrowserHandoffError(
          '\u64cd\u4f5c\u672a\u751f\u6548\uff0c\u63a5\u7ba1\u72b6\u6001\u53ef\u80fd\u5df2\u5728\u5176\u4ed6\u7a97\u53e3\u6539\u53d8\u3002\u8bf7\u5237\u65b0\u72b6\u6001\u540e\u91cd\u8bd5\u3002',
        );
      } finally {
        setBusyBrowserHandoffId(undefined);
      }
    },
    [busyBrowserHandoffId, refreshBrowserHandoffs],
  );

  // Primary S2 streaming path: subscribe only to the currently opened thread.
  // Replay/live frames use a thread-local cursor and never enter global eventHistory.
  useEffect(() => {
    if (!threadId) return;
    if (threadConversationIdRef.current !== String(conversation.id)) return;
    const api = bridge();
    if (!api?.subscribeConversationTransientStream) return;

    const generation = transientResetGenerationRef.current;
    const frameQueue = transientFrameQueueRef.current;
    let disposed = false;
    transientStreamHealthyRef.current = true;
    const subscription = api.subscribeConversationTransientStream(
      { threadId, afterStreamSequence: lastTransientSequenceRef.current },
      (event: {
        type: 'frame' | 'reset';
        frame?: ConversationTransientFrame;
        latestStreamSequence?: number;
        snapshot?: ConversationTransientSnapshot;
      }) => {
        if (disposed || transientResetGenerationRef.current !== generation) return;
        if (event.type === 'reset') {
          frameQueue.length = 0;
          if (transientFrameFlushRef.current !== null) {
            window.cancelAnimationFrame(transientFrameFlushRef.current);
            transientFrameFlushRef.current = null;
          }
          const latestStreamSequence = event.latestStreamSequence ?? 0;
          lastTransientSequenceRef.current = latestStreamSequence;
          if (event.snapshot && event.snapshot.threadId === threadId) {
            transientFallbackOnlyRef.current = false;
            transientStreamHealthyRef.current = true;
            if (event.snapshot.process) updateRunProcess(event.snapshot.process);
            renderTransientDraft(
              {
                runId: event.snapshot.runId,
                text: event.snapshot.text,
                reasoningText: event.snapshot.reasoningText,
                timestamp: event.snapshot.updatedAt,
              },
              latestStreamSequence,
            );
          } else {
            transientFallbackOnlyRef.current = false;
            transientStreamHealthyRef.current = true;
            renderTransientDraft(null, latestStreamSequence);
            void loadMessages();
          }
          return;
        }
        const frame = event.frame;
        if (!frame) return;
        if (transientFallbackOnlyRef.current) {
          if (frame.kind === 'terminal') {
            inFlightRunProcessesRef.current.delete(String(frame.runId));
            setRunProcessById((previous) => {
              if (!previous.has(frame.runId)) return previous;
              const next = new Map(previous);
              next.delete(frame.runId);
              return next;
            });
          }
          lastTransientSequenceRef.current = Math.max(
            lastTransientSequenceRef.current,
            frame.streamSequence,
          );
          if (frame.kind === 'terminal') {
            void loadMessages();
            void refreshContextStatus();
          }
          return;
        }
        transientStreamHealthyRef.current = true;
        if (frame.process) updateRunProcess(frame.process);
        else if (frame.kind === 'terminal') {
          inFlightRunProcessesRef.current.delete(String(frame.runId));
          setRunProcessById((previous) => {
            if (!previous.has(frame.runId)) return previous;
            const next = new Map(previous);
            next.delete(frame.runId);
            return next;
          });
        }
        frameQueue.push(frame);
        if (frame.kind === 'process' || frame.kind === 'terminal') {
          if (transientFrameFlushRef.current !== null) {
            window.cancelAnimationFrame(transientFrameFlushRef.current);
          }
          flushTransientFrames();
        } else if (transientFrameFlushRef.current === null) {
          transientFrameFlushRef.current = window.requestAnimationFrame(flushTransientFrames);
        }
        if (frame.kind === 'terminal') {
          void loadMessages();
          void refreshContextStatus();
        }
      },
    );
    void subscription.ready.catch(() => {
      if (!disposed && transientResetGenerationRef.current === generation) {
        transientFallbackOnlyRef.current = true;
        transientStreamHealthyRef.current = false;
        lastConsumedEventSequenceRef.current = 0;
        setTransientFallbackEpoch((value) => value + 1);
      }
    });

    return () => {
      disposed = true;
      frameQueue.length = 0;
      if (transientFrameFlushRef.current !== null) {
        window.cancelAnimationFrame(transientFrameFlushRef.current);
        transientFrameFlushRef.current = null;
      }
      void subscription.unsubscribe();
    };
  }, [
    conversation.id,
    flushTransientFrames,
    loadMessages,
    refreshContextStatus,
    renderTransientDraft,
    threadId,
    updateRunProcess,
  ]);

  // Streaming via durable events is now a compatibility/failure fallback.
  // Terminal events are always consumed so final Message Store refresh remains
  // correct even while transient is healthy.
  useEffect(() => {
    if (!threadId) return;
    if (threadConversationIdRef.current !== String(conversation.id)) return;

    const batch = collectConversationStreamBatch({
      events: eventHistory,
      afterSequence: lastConsumedEventSequenceRef.current,
      threadId,
      taskId: conversation.taskId ? String(conversation.taskId) : undefined,
    });
    if (batch.maxSeenSequence === lastConsumedEventSequenceRef.current) return;

    lastConsumedEventSequenceRef.current = batch.maxSeenSequence;
    if (batch.operations.length > 0) {
      const operations = transientStreamHealthyRef.current
        ? batch.operations.filter((operation) => operation.type === 'run.terminal')
        : batch.operations;
      if (operations.length === 0 && !batch.sawTerminalEvent) return;
      setStreamingMessage((previous) => {
        const current = previous
          ? {
              runId: previous.runId,
              text: previous.text,
              reasoningText: previous.reasoningText,
              timestamp: previous.timestamp,
            }
          : null;
        const next = applyConversationStreamOperations(current, operations);
        transientDraftRef.current = next;
        return next
          ? {
              id: `streaming-${next.runId ?? batch.maxSeenSequence}`,
              role: 'assistant',
              text: next.text,
              reasoningText: next.reasoningText,
              timestamp: next.timestamp,
              streaming: true,
              runId: next.runId,
            }
          : null;
      });
    }
    if (batch.sawTerminalEvent) {
      // The runtime persists a successful final message before publishing
      // run.completed. Failed/cancelled runs still refresh terminal state.
      void loadMessages();
      void refreshContextStatus();
    }
  }, [
    conversation.id,
    conversation.taskId,
    eventHistory,
    loadMessages,
    refreshContextStatus,
    threadId,
    transientFallbackEpoch,
  ]);

  // Pending tool approvals for「询问批准」(from tool.approval_requested events).
  const pendingApprovals = useMemo(() => {
    if (!threadId) return [] as PendingToolApproval[];
    const byId = new Map<string, PendingToolApproval>();
    /** Runs that reached a terminal state — their unresolved cards are dead. */
    const endedRuns = new Set<string>();
    const ordered = [...eventHistory].sort((a, b) => a.sequence - b.sequence);
    for (const event of ordered) {
      const eventThread =
        typeof event.payload.threadId === 'string' ? event.payload.threadId : undefined;
      if (eventThread && eventThread !== threadId) continue;
      if (event.type === 'tool.approval_requested') {
        const approvalId =
          typeof event.payload.approvalId === 'string' ? event.payload.approvalId : event.id;
        byId.set(approvalId, {
          approvalId,
          runId: typeof event.payload.runId === 'string' ? event.payload.runId : event.runId,
          toolCallId:
            typeof event.payload.toolCallId === 'string' ? event.payload.toolCallId : undefined,
          toolName: typeof event.payload.toolName === 'string' ? event.payload.toolName : 'tool',
          title:
            typeof event.payload.title === 'string'
              ? event.payload.title
              : `需要批准：${String(event.payload.toolName ?? 'tool')}`,
          detail: typeof event.payload.detail === 'string' ? event.payload.detail : '',
          path: typeof event.payload.path === 'string' ? event.payload.path : undefined,
          command: typeof event.payload.command === 'string' ? event.payload.command : undefined,
        });
      } else if (event.type === 'tool.approval_decided') {
        const approvalId =
          typeof event.payload.approvalId === 'string' ? event.payload.approvalId : undefined;
        if (!approvalId) continue;
        const existing = byId.get(approvalId);
        if (existing) {
          existing.decided =
            event.payload.decision === 'approve' || event.payload.decision === 'deny'
              ? event.payload.decision
              : existing.decided;
        }
      } else if (isRunTerminalEventType(event.type)) {
        if (event.runId) endedRuns.add(event.runId);
      }
    }
    // Drop resolved cards and cards belonging to runs that already ended
    // (cancel/abort paths and runtime restarts can strand requested events).
    const unresolved = [...byId.values()].filter(
      (item) => !item.decided && !(item.runId && endedRuns.has(item.runId)),
    );
    // A runtime restart replays the tool loop and re-requests the same
    // toolCall with a fresh approvalId — keep only the newest per toolCall.
    const byToolCall = new Map<string, PendingToolApproval>();
    const noToolCall: PendingToolApproval[] = [];
    for (const item of unresolved) {
      if (item.toolCallId) byToolCall.set(item.toolCallId, item);
      else noToolCall.push(item);
    }
    return [...byToolCall.values(), ...noToolCall];
  }, [eventHistory, threadId]);

  const [decidingApprovalId, setDecidingApprovalId] = useState<string | null>(null);

  const handleToolApproval = useCallback(
    async (approvalId: string, decision: 'approve' | 'deny') => {
      const api = bridge();
      if (!api?.decideToolApproval || decidingApprovalId) return;
      setDecidingApprovalId(approvalId);
      try {
        await api.decideToolApproval({ approvalId, decision });
      } catch (error) {
        setLocalErrors((prev) => [
          ...prev,
          {
            id: `err-appr-${Date.now()}`,
            role: 'system',
            tone: 'error',
            text: `处理批准失败: ${error instanceof Error ? error.message : String(error)}`,
            timestamp: new Date().toISOString(),
          },
        ]);
      } finally {
        setDecidingApprovalId(null);
      }
    },
    [decidingApprovalId],
  );

  // Remove optimistic bubbles only after their durable message id arrives.
  // The send handler renames the pending bubble's temp id to the durable
  // messageId returned by appendMessage, so once that durable copy enters
  // loadedMessages with the same id the optimistic echo can be dropped by id
  // equality. Text/timestamp matching is avoided: store timestamps differ
  // from the client clock (they would never pair) and text matching would
  // wrongly collapse distinct prompts that share the same words.
  useEffect(() => {
    if (pendingUserMessages.length === 0) return;
    const durableUserIds = new Set(
      loadedMessages.filter((message) => message.role === 'user').map((message) => message.id),
    );
    setPendingUserMessages((prev) => prev.filter((message) => !durableUserIds.has(message.id)));
  }, [pendingUserMessages.length, loadedMessages]);

  // Clear "sending" once the run leaves the streaming state (or fails via local error).
  useEffect(() => {
    if (!sending && !stopping) return;
    if (!projected.streaming && pendingUserMessages.length === 0) {
      // Keep a tiny grace window so a just-started run isn't cleared before run.started arrives.
      const timer = window.setTimeout(() => {
        setSending(false);
        setStopping(false);
      }, 120);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [pendingUserMessages.length, projected.streaming, sending, stopping]);

  const messages = useMemo(() => {
    // Global sequence merge: the four sources (loadedMessages,
    // pendingUserMessages, streamingMessage, localErrors) used to be
    // concatenated in a hard-coded order, which let the streaming thought
    // panel render above a just-sent user bubble whenever React state
    // settled in the wrong order (run reused on an existing thread, or the
    // optimistic pending bubble cleared a frame before the durable message
    // arrived). Instead, merge by a monotonic sequence so every item finds
    // its stable slot regardless of which state committed first.
    //
    // Durable messages carry a real store sequence. Transient items don't,
    // so they are stamped with virtual sequences past the current durable
    // tail, in the order they must visually appear:
    //   pending user bubbles  → right after the tail (they precede the turn)
    //   streaming assistant   → after the pending bubbles
    //   local errors          → after the streaming turn
    // Once those transients persist, loadMessages() returns them with real
    // sequences and the virtual copies are cleared, so the list converges.
    const maxDurableSeq = loadedMessages.reduce(
      (max, m) =>
        Number.isFinite(m.sequence) ? Math.max(max, (m.sequence as number) ?? max) : max,
      Number.MIN_SAFE_INTEGER,
    );
    let nextVirtualSeq = maxDurableSeq === Number.MIN_SAFE_INTEGER ? 0 : maxDurableSeq + 1;

    type SeqItem = { value: ChatMessage; seq: number; tie: number };
    const stamped: SeqItem[] = [];

    // Durable messages keep their real sequence; tie-break by array order.
    for (let i = 0; i < loadedMessages.length; i++) {
      const m = loadedMessages[i]!;
      stamped.push({ value: m, seq: m.sequence ?? nextVirtualSeq, tie: i });
    }

    // Pending user bubbles: virtual sequence before the streaming turn so a
    // just-sent prompt is always visually followed by the thinking panel.
    for (let i = 0; i < pendingUserMessages.length; i++) {
      stamped.push({
        value: pendingUserMessages[i]!,
        seq: nextVirtualSeq++,
        tie: 10_000 + i,
      });
    }

    // Streaming assistant turn: virtual sequence after the pending bubbles.
    if (streamingMessage) {
      // Keep the streaming slot's sequence stable across re-merges by hashing
      // on its runId so older-arriving frames don't reshuffle it.
      stamped.push({ value: streamingMessage, seq: nextVirtualSeq++, tie: 20_000 });
    }

    // Local errors and the latest durable pause notice render after the live turn.
    for (let i = 0; i < localErrors.length; i++) {
      stamped.push({ value: localErrors[i]!, seq: nextVirtualSeq++, tie: 30_000 + i });
    }
    if (pausedRunNotice) {
      stamped.push({
        value: {
          id: pausedRunNotice.id,
          role: 'system',
          tone: pausedRunNotice.tone,
          text: pausedRunNotice.text,
          timestamp: pausedRunNotice.timestamp,
          runId: pausedRunNotice.runId,
        },
        seq: nextVirtualSeq++,
        tie: 40_000,
      });
    }

    stamped.sort((a, b) => (a.seq !== b.seq ? a.seq - b.seq : a.tie - b.tie));
    return stamped.map((s) => s.value);
  }, [localErrors, loadedMessages, pausedRunNotice, pendingUserMessages, streamingMessage]);

  // Keep every fetched durable message mounted. History is still paginated in
  // 50-message pages, but native scrolling must not compete with virtual spacer
  // refinement or persistent visual-anchor restoration.
  const visibleDurableMessages = loadedMessages;
  const liveMessages = useMemo(() => {
    const result: ChatMessage[] = [];
    result.push(...pendingUserMessages);
    if (streamingMessage) result.push(streamingMessage);
    result.push(...localErrors);
    if (pausedRunNotice) {
      result.push({
        id: pausedRunNotice.id,
        role: 'system',
        tone: pausedRunNotice.tone,
        text: pausedRunNotice.text,
        timestamp: pausedRunNotice.timestamp,
        runId: pausedRunNotice.runId,
      });
    }
    return result;
  }, [localErrors, pausedRunNotice, pendingUserMessages, streamingMessage]);

  const capturePrependAnchor = useCallback((scroller: HTMLDivElement) => {
    const viewportTop = scroller.getBoundingClientRect().top;
    const nodes = scroller.querySelectorAll<HTMLElement>('[data-message-id]');
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      if (rect.bottom <= viewportTop) continue;
      const id = node.dataset.messageId;
      if (id) return { id, viewportOffset: rect.top - viewportTop };
    }
    return null;
  }, []);

  const restorePrependAnchor = useCallback(
    (
      scroller: HTMLDivElement,
      anchor: { id: string; viewportOffset: number },
      expectedUserScrollRevision: number,
    ) => {
      if (
        !shouldRestorePrependAnchor({
          capturedUserScrollRevision: expectedUserScrollRevision,
          currentUserScrollRevision: userScrollRevisionRef.current,
          hasAnchor: true,
        })
      )
        return;
      const nodes = scroller.querySelectorAll<HTMLElement>('[data-message-id]');
      const node = Array.from(nodes).find((candidate) => candidate.dataset.messageId === anchor.id);
      if (!node) return;
      const nextViewportOffset =
        node.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      const adjustment = nextViewportOffset - anchor.viewportOffset;
      if (Math.abs(adjustment) > 0.5) {
        programmaticScrollTargetRef.current = scroller.scrollTop + adjustment;
        scroller.scrollTop += adjustment;
      }
      lastObservedScrollTopRef.current = scroller.scrollTop;
    },
    [],
  );

  // Historical assistant bubbles load one already-projected process snapshot per run.
  useEffect(() => {
    const conversationId = String(conversation.id);
    if (loadedMessagesConversationIdRef.current !== conversationId) return;
    const api = bridge();
    if (!api?.getConversationRunProcess) return;
    const generation = processLoadGenerationRef.current;
    const runIds = new Set(
      visibleDurableMessages
        .filter((message) => message.role === 'assistant' && Boolean(message.runId))
        .map((message) => message.runId as RunId),
    );
    for (const [runId, timer] of runProcessRetryTimersRef.current) {
      if (runIds.has(runId as RunId)) continue;
      window.clearTimeout(timer);
      runProcessRetryTimersRef.current.delete(runId);
      runProcessRetryAttemptsRef.current.delete(runId);
    }
    for (const runId of runIds) {
      if (runProcessById.has(runId) || inFlightRunProcessesRef.current.has(runId)) continue;
      inFlightRunProcessesRef.current.add(runId);
      void api
        .getConversationRunProcess({ runId })
        .then((response: ConversationGetRunProcessResponse) => {
          if (
            activeConversationIdRef.current !== conversationId ||
            processLoadGenerationRef.current !== generation
          ) {
            return;
          }
          inFlightRunProcessesRef.current.delete(runId);
          runProcessRetryAttemptsRef.current.delete(runId);
          const retryTimer = runProcessRetryTimersRef.current.get(runId);
          if (retryTimer !== undefined) window.clearTimeout(retryTimer);
          runProcessRetryTimersRef.current.delete(runId);
          updateRunProcess(response.process);
        })
        .catch(() => {
          if (
            processLoadGenerationRef.current !== generation ||
            activeConversationIdRef.current !== conversationId
          ) {
            return;
          }
          inFlightRunProcessesRef.current.delete(runId);
          if (runProcessRetryTimersRef.current.has(runId)) return;
          const attempts = (runProcessRetryAttemptsRef.current.get(runId) ?? 0) + 1;
          runProcessRetryAttemptsRef.current.set(runId, attempts);
          const delayMs = Math.min(500 * 2 ** Math.min(attempts - 1, 4), 8_000);
          const timer = window.setTimeout(() => {
            runProcessRetryTimersRef.current.delete(runId);
            if (
              processLoadGenerationRef.current === generation &&
              activeConversationIdRef.current === conversationId
            ) {
              setRunProcessRetryEpoch((value) => value + 1);
            }
          }, delayMs);
          runProcessRetryTimersRef.current.set(runId, timer);
        });
    }
  }, [
    conversation.id,
    runProcessById,
    runProcessRetryEpoch,
    updateRunProcess,
    visibleDurableMessages,
  ]);

  // Pin to bottom without a smooth animation. Once the user scrolls upward,
  // streaming/process updates must leave the historical viewport untouched.
  useLayoutEffect(() => {
    const scroller = messagesScrollRef.current;
    if (!scroller || !stickToBottomRef.current) return;
    const target = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    if (Math.abs(scroller.scrollTop - target) > 1) {
      programmaticScrollTargetRef.current = target;
      scroller.scrollTop = target;
    }
    lastObservedScrollTopRef.current = scroller.scrollTop;
  }, [messages, sending, projected.streaming, conversation.id]);

  const sendUserText = useCallback(
    async (
      text: string,
      images: MessageImage[] = [],
      options?: {
        skillVersionIds?: readonly string[];
      },
    ) => {
      const api = bridge();
      if (!api || (!text.trim() && images.length === 0) || sending) return;
      // Freeze before auto-compaction or any IPC so menu changes cannot alter this Run.
      const skillVersionIds = resolveAppendSkillVersionIds(
        conversation.track,
        options?.skillVersionIds ?? selectedSkillVersionIds,
      );

      // Auto-compact when context occupancy is near the window limit (~70%).
      // Failures are non-fatal — the user message still goes out.
      const status = contextStatusRef.current;
      if (
        api.compactConversation &&
        !compactingRef.current &&
        status &&
        status.usageRatio >= status.compactThreshold
      ) {
        // NewMax: "Automatically compacting context" / 自动压缩上下文
        const startedAt = Date.now();
        compactingRef.current = true;
        clearCompactDismissTimer();
        setCompactProgress({
          status: 'running',
          mode: 'auto',
          startedAt,
          message: '正在自动压缩上下文…',
        });
        try {
          const compactResult = await api.compactConversation({
            conversationId: conversation.id,
            mode: 'auto',
            onlyIfNeeded: true,
          });
          if (compactResult.compacted) {
            const saved =
              compactResult.beforeTokens > compactResult.afterTokens
                ? `（${compactResult.beforeTokens} → ${compactResult.afterTokens}）`
                : '';
            const elapsed = formatCompactElapsed(startedAt);
            setCompactProgress({
              status: 'success',
              mode: 'auto',
              startedAt,
              // NewMax: "Context automatically compacted"
              message: `上下文已自动压缩${saved} · ${elapsed}`,
              afterTokens: compactResult.afterTokens,
            });
            scheduleCompactDismiss(2400);
          } else {
            clearCompactDismissTimer();
            setCompactProgress(null);
          }
        } catch {
          // Auto compact failure is silent — do not block the user message.
          clearCompactDismissTimer();
          setCompactProgress(null);
        } finally {
          await refreshContextStatus();
          compactingRef.current = false;
        }
      }

      setSending(true);
      const tempId = `temp-${Date.now()}`;
      setPendingUserMessages((prev) => [
        ...prev,
        {
          id: tempId,
          role: 'user',
          text,
          images: images.length > 0 ? images : undefined,
          timestamp: new Date().toISOString(),
        },
      ]);

      try {
        const prep = await api.sendConversationMessage({
          conversationId: conversation.id,
          text,
        });
        if (typeof prep.threadId === 'string' && prep.threadId.length > 0) {
          setThreadId(prep.threadId);
        }
        const response = await api.appendMessage({
          threadId: prep.threadId,
          expectedTaskVersion: prep.taskVersion,
          role: 'user',
          text: text.trim()
            ? text
            : images.length > 0
              ? images.map((img) => `[图片] ${img.name}`).join('\n')
              : text,
          // Prefer explicit override; only fall back to targetRef when it is a real
          // catalog model id. Agent/team tracks store agent/team ids in targetRef.
          modelId: resolveSendModelId({
            modelOverride,
            track: conversation.track,
            targetRef: conversation.targetRef,
            catalogModelIds: models.map((model) => model.modelId),
          }),
          reasoningEffort: reasoningEffort === 'auto' ? undefined : reasoningEffort,
          networkEnabled: netEnabled || undefined,
          skillVersionIds,
          images:
            images.length > 0
              ? images.map((img) => ({
                  name: img.name || 'image',
                  mimeType: img.mimeType || 'image/png',
                  dataUrl: img.url,
                }))
              : undefined,
        });
        const durableImages = Array.isArray(response.images)
          ? (
              response.images as Array<{
                id: string;
                name: string;
                mimeType?: string;
                url?: string;
              }>
            )
              .filter((image) => typeof image.url === 'string' && image.url.length > 0)
              .map((image) => ({
                id: image.id,
                name: image.name,
                mimeType: image.mimeType,
                url: image.url!,
              }))
          : images;
        setPendingUserMessages((prev) =>
          prev.map((message) =>
            message.id === tempId
              ? {
                  ...message,
                  id: response.messageId,
                  images: durableImages.length > 0 ? durableImages : message.images,
                }
              : message,
          ),
        );
        onTitleUpdated(prep.conversationTitle || response.taskTitle || conversation.title || '');
        return true;
      } catch (err) {
        setSending(false);
        setPendingUserMessages((prev) => prev.filter((message) => message.id !== tempId));
        setLocalErrors((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: 'system',
            tone: 'error',
            text: `发送失败: ${(err as Error).message}`,
            timestamp: new Date().toISOString(),
          },
        ]);
        throw err;
      } finally {
        inputRef.current?.focus();
      }
    },
    [
      clearCompactDismissTimer,
      conversation.id,
      conversation.targetRef,
      conversation.title,
      conversation.track,
      modelOverride,
      models,
      netEnabled,
      onTitleUpdated,
      reasoningEffort,
      refreshContextStatus,
      scheduleCompactDismiss,
      selectedSkillVersionIds,
      sending,
    ],
  );

  const handleRegenerate = useCallback(
    async (assistantMessageId: string) => {
      if (sending) return;
      const idx = messages.findIndex((m) => m.id === assistantMessageId);
      if (idx <= 0) return;
      // Find nearest previous user message (NewMax: regenerate last turn).
      let userText = '';
      for (let i = idx - 1; i >= 0; i -= 1) {
        if (messages[i]?.role === 'user') {
          userText = messages[i]!.text;
          break;
        }
      }
      if (!userText.trim()) return;
      await sendUserText(userText, [], {
        skillVersionIds: [],
      });
    },
    [messages, sendUserText, sending],
  );

  const openChangeInRail = useCallback(
    (_path: string) => {
      // R2/H2: open empty right shell only (no real Changes data this cut).
      setRailOpen(true);
    },
    [setRailOpen],
  );
  const expandRail = useCallback(() => setRailOpen(true), [setRailOpen]);

  const boundWorkspace = conversation.workspaceId
    ? workspaces.find((workspace) => workspace.workspaceId === conversation.workspaceId)
    : undefined;
  const projectFolder = boundWorkspace?.folderPath?.trim();
  const hasProjectFolder = Boolean(projectFolder);

  // Position the @ picker as a fixed portal above the compose box so parent
  // overflow:hidden (chat column / page flex) cannot clip it.
  useLayoutEffect(() => {
    if (!mention) {
      setMentionPopStyle(null);
      return;
    }
    const update = () => {
      const el = composeRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.min(r.width, 520);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const gap = 8;
      const maxH = Math.min(260, Math.max(120, r.top - gap - 8));
      setMentionPopStyle({
        position: 'fixed',
        left,
        width,
        bottom: window.innerHeight - r.top + gap,
        maxHeight: maxH,
        zIndex: 10000,
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [mention]);

  // Load project files when an @-mention is active.
  useEffect(() => {
    if (!mention) {
      setMentionFiles([]);
      setMentionLoading(false);
      return;
    }
    if (!projectFolder) {
      setMentionFiles([]);
      setMentionLoading(false);
      return;
    }
    const api = bridge();
    if (!api?.listProjectFiles) {
      setMentionFiles([]);
      return;
    }
    let cancelled = false;
    setMentionLoading(true);
    const handle = window.setTimeout(() => {
      void api
        .listProjectFiles({ root: projectFolder, query: mention.query, maxEntries: 40 })
        .then((result: { files?: Array<{ path: string; name: string; kind: 'file' | 'dir' }> }) => {
          if (cancelled) return;
          setMentionFiles(result.files ?? []);
          setMentionIndex(0);
          setMentionLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          setMentionFiles([]);
          setMentionLoading(false);
        });
    }, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [mention, projectFolder]);

  const closeMention = useCallback(() => {
    setMention(null);
    setMentionFiles([]);
    setMentionIndex(0);
  }, []);

  const closeSlash = useCallback(() => {
    setSlash(null);
    setSlashIndex(0);
  }, []);

  const closeComposePickers = useCallback(() => {
    closeMention();
    closeSlash();
    setMenu(null);
  }, [closeMention, closeSlash]);

  const slashCommands = useMemo(() => (slash ? filterSlashCommands(slash.query) : []), [slash]);

  // Tick while compacting so the capsule can show NewMax-style elapsed time.
  useEffect(() => {
    if (!compactProgress) return;
    setCompactNow(Date.now());
    const id = window.setInterval(() => setCompactNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [compactProgress]);

  // Position the / menu as a fixed portal above the compose box (same as @).
  useLayoutEffect(() => {
    if (!slash) {
      setSlashPopStyle(null);
      return;
    }
    const update = () => {
      const el = composeRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.min(r.width, 420);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const gap = 8;
      const maxH = Math.min(280, Math.max(120, r.top - gap - 8));
      setSlashPopStyle({
        position: 'fixed',
        left,
        width,
        bottom: window.innerHeight - r.top + gap,
        maxHeight: maxH,
        zIndex: 10000,
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [slash]);

  const resizeComposeInput = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    computeTextareaHeight(el, 56, 220);
  }, []);

  useLayoutEffect(() => {
    resizeComposeInput();
  }, [input, resizeComposeInput]);

  /** NewMax: manual /compact — model summary path, no chat turn. */
  const runManualCompact = useCallback(async () => {
    const api = bridge();
    if (!api?.compactConversation) return;
    if (compactingRef.current) return;
    compactingRef.current = true;
    const startedAt = Date.now();
    clearCompactDismissTimer();
    setCompactProgress({
      status: 'running',
      mode: 'manual',
      startedAt,
      message: '正在手动压缩上下文…',
    });
    try {
      const result = await api.compactConversation({
        conversationId: conversation.id,
        mode: 'manual',
        onlyIfNeeded: false,
      });
      const elapsed = formatCompactElapsed(startedAt);
      const saved =
        result.compacted && result.beforeTokens > result.afterTokens
          ? `（${result.beforeTokens} → ${result.afterTokens}）`
          : '';
      if (result.compacted) {
        setCompactProgress({
          status: 'success',
          mode: 'manual',
          startedAt,
          message: `上下文已压缩${saved} · ${elapsed}`,
          afterTokens: result.afterTokens,
        });
        scheduleCompactDismiss(2400);
      } else {
        setCompactProgress({
          status: 'noop',
          mode: 'manual',
          startedAt,
          message: `当前上下文仍充足，无需压缩 · ${elapsed}`,
        });
        scheduleCompactDismiss(1600);
      }
    } catch (error) {
      setCompactProgress({
        status: 'failure',
        mode: 'manual',
        startedAt,
        message: '上下文压缩失败',
      });
      scheduleCompactDismiss(1600);
      const raw = error instanceof Error ? error.message : String(error);
      const friendly = /timed out|timeout/i.test(raw)
        ? '上下文压缩超时：模型摘要耗时过长，请稍后重试，或先缩短对话后再压缩'
        : `上下文压缩失败: ${raw}`;
      setLocalErrors((errs) => [
        ...errs,
        {
          id: `err-compact-${Date.now()}`,
          role: 'system',
          tone: 'error',
          text: friendly,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      await refreshContextStatus();
      compactingRef.current = false;
    }
  }, [clearCompactDismissTimer, conversation.id, refreshContextStatus, scheduleCompactDismiss]);

  const selectSlashCommand = useCallback(
    (cmd: SlashCommand) => {
      if (!slash) return;
      // NewMax-like UX: selecting a command only fills the input.
      // Real execution happens when the user presses Send (e.g. /compact).
      if (cmd.kind === 'coming-soon') {
        const stripped = stripSlashToken(input, slash);
        setInput(stripped.text);
        closeComposePickers();
        window.requestAnimationFrame(() => {
          resizeComposeInput();
          const el = inputRef.current;
          if (el) {
            el.focus();
            el.setSelectionRange(stripped.caret, stripped.caret);
          }
        });
        setLocalErrors((errs) => [
          ...errs,
          {
            id: `slash-soon-${cmd.id}-${Date.now()}`,
            role: 'system',
            tone: 'info',
            text: `${cmd.command} ${cmd.label}即将支持`,
            timestamp: new Date().toISOString(),
          },
        ]);
        return;
      }
      // Only allow slash commands at the start of the input (first non-ws token).
      if (slash.slashIndex !== 0 && input.slice(0, slash.slashIndex).trim().length > 0) {
        closeComposePickers();
        setLocalErrors((errs) => [
          ...errs,
          {
            id: `slash-pos-${Date.now()}`,
            role: 'system',
            tone: 'warning',
            text: '斜杠命令只能出现在输入开头',
            timestamp: new Date().toISOString(),
          },
        ]);
        return;
      }
      // prefix / action: insert the command token; user confirms with Send.
      const next = `${cmd.command}`;
      setInput(next);
      closeComposePickers();
      window.requestAnimationFrame(() => {
        resizeComposeInput();
        const el = inputRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(next.length, next.length);
        }
      });
    },
    [closeComposePickers, input, resizeComposeInput, slash],
  );

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || sending || compactingRef.current) return;

    // NewMax: `/compact` manually compresses context without sending a chat turn.
    const slashCmd = parseSlashCommand(text);
    if (slashCmd.kind === 'compact' || slashCmd.kind === 'compact-with-trailing') {
      if (attachments.length > 0) {
        setLocalErrors((errs) => [
          ...errs,
          {
            id: `slash-attach-${Date.now()}`,
            role: 'system',
            tone: 'warning',
            text: '执行 /compact 前请先移除附件',
            timestamp: new Date().toISOString(),
          },
        ]);
        return;
      }
      if (slashCmd.kind === 'compact-with-trailing') {
        setLocalErrors((errs) => [
          ...errs,
          {
            id: `slash-trail-${Date.now()}`,
            role: 'system',
            tone: 'warning',
            text: '请只发送 /compact（不要附加其他文字）',
            timestamp: new Date().toISOString(),
          },
        ]);
        return;
      }
      if (compactingRef.current) {
        setLocalErrors((errs) => [
          ...errs,
          {
            id: `slash-busy-${Date.now()}`,
            role: 'system',
            tone: 'info',
            text: '正在压缩上下文，请稍候',
            timestamp: new Date().toISOString(),
          },
        ]);
        return;
      }
      // Confirm executable first, then clear input.
      setInput('');
      closeComposePickers();
      window.requestAnimationFrame(() => resizeComposeInput());
      await runManualCompact();
      return;
    }

    const snapshot = attachments;
    const outbound = buildMessageWithAttachments(input, snapshot);
    const images = messageImagesFromAttachments(snapshot);
    setInput('');
    closeComposePickers();
    window.requestAnimationFrame(() => resizeComposeInput());
    try {
      await sendUserText(outbound, images);
      setAttachments([]);
    } catch {
      setAttachments(snapshot);
    }
  }, [
    attachments,
    closeComposePickers,
    input,
    resizeComposeInput,
    runManualCompact,
    sendUserText,
    sending,
  ]);

  /** NewMax: selecting a file becomes an attachment chip, not inline @path text. */
  const selectMentionFile = useCallback(
    (file: { path: string; name?: string; kind: 'file' | 'dir' }) => {
      const attachment: ComposeAttachment = {
        path: file.path,
        name: file.name || fileNameFromPath(file.path),
        kind: file.kind,
      };
      setAttachments((prev) => addAttachment(prev, attachment));
      if (mention) {
        const stripped = stripMentionToken(input, mention);
        setInput(stripped.text);
        window.requestAnimationFrame(() => {
          const el = inputRef.current;
          if (!el) return;
          el.focus();
          el.setSelectionRange(stripped.caret, stripped.caret);
          computeTextareaHeight(el, 56, 220);
        });
      } else {
        inputRef.current?.focus();
      }
      closeComposePickers();
    },
    [closeComposePickers, input, mention],
  );

  const addImageFiles = useCallback(
    async (files: FileList | File[]) => {
      const remainingSlots = Math.max(
        0,
        8 - attachments.filter((item) => item.kind === 'image').length,
      );
      const list = Array.from(files).filter(isImageFile).slice(0, remainingSlots);
      if (list.length === 0) return;
      const nextItems: ComposeAttachment[] = [];
      for (const file of list) {
        try {
          const rawUrl = await readFileAsDataUrl(file);
          // Compress before staging so provider requests stay reasonable.
          const compressed = await compressImageDataUrl(rawUrl, {
            mimeType: file.type || 'image/png',
          });
          nextItems.push({
            path: `image:${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name}`,
            name: file.name || 'image',
            kind: 'image',
            previewUrl: compressed.dataUrl,
            mimeType: compressed.mimeType,
            sizeBytes: Math.floor(
              (compressed.dataUrl.length - compressed.dataUrl.indexOf(',') - 1) * 0.75,
            ),
          });
        } catch {
          setLocalErrors((prev) => [
            ...prev,
            {
              id: `image-error-${Date.now()}`,
              role: 'system',
              tone: 'error',
              text: `无法读取图片：${file.name || '未命名图片'}`,
              timestamp: new Date().toISOString(),
            },
          ]);
        }
      }
      if (nextItems.length === 0) return;
      setAttachments((prev) => {
        let next = [...prev];
        for (const item of nextItems) next = addAttachment(next, item);
        return next.slice(0, 8);
      });
    },
    [attachments],
  );

  const handleImageInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) void addImageFiles(files);
      e.target.value = '';
    },
    [addImageFiles],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length === 0) return;
      e.preventDefault();
      void addImageFiles(files);
    },
    [addImageFiles],
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only clear when leaving the compose shell itself.
    if (e.currentTarget === e.target) setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) void addImageFiles(files);
    },
    [addImageFiles],
  );

  const updatePickersFromCaret = useCallback((text: string, caret: number) => {
    // @ takes priority when both could match; mutually exclusive menus.
    const nextMention = detectMentionQuery(text, caret);
    if (nextMention) {
      setMention(nextMention);
      setSlash(null);
      setSlashIndex(0);
      return;
    }
    setMention(null);
    setMentionFiles([]);
    setMentionIndex(0);
    const nextSlash = detectSlashQuery(text, caret);
    setSlash(nextSlash);
    if (!nextSlash) setSlashIndex(0);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setInput(value);
      updatePickersFromCaret(value, e.target.selectionStart ?? value.length);
    },
    [updatePickersFromCaret],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // @-picker navigation takes priority while open.
      if (mention) {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeMention();
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setMentionIndex((i) => (mentionFiles.length === 0 ? 0 : (i + 1) % mentionFiles.length));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setMentionIndex((i) =>
            mentionFiles.length === 0 ? 0 : (i - 1 + mentionFiles.length) % mentionFiles.length,
          );
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          const selected = mentionFiles[mentionIndex];
          if (selected) {
            e.preventDefault();
            selectMentionFile(selected);
            return;
          }
        }
      }

      // / slash-command menu navigation.
      if (slash) {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeSlash();
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSlashIndex((i) => (slashCommands.length === 0 ? 0 : (i + 1) % slashCommands.length));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSlashIndex((i) =>
            slashCommands.length === 0 ? 0 : (i - 1 + slashCommands.length) % slashCommands.length,
          );
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          const selected = slashCommands[slashIndex];
          if (selected) {
            e.preventDefault();
            selectSlashCommand(selected);
            return;
          }
        }
      }

      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        void handleSend();
      }
    },
    [
      closeMention,
      closeSlash,
      handleSend,
      mention,
      mentionFiles,
      mentionIndex,
      selectMentionFile,
      selectSlashCommand,
      slash,
      slashCommands,
      slashIndex,
    ],
  );

  const setPermission = useCallback(
    (next: PermissionMode) => {
      const prev = permissionMode;
      if (next === prev) return;
      setPermissionMode(next);
      const api = bridge();
      if (!api?.setConversationExecutionMode) return;
      void api
        .setConversationExecutionMode({
          conversationId: conversation.id,
          executionMode: next,
        })
        .then(() => {
          onConversationUpdated?.();
        })
        .catch((error: unknown) => {
          setPermissionMode(prev);
          setLocalErrors((errs) => [
            ...errs,
            {
              id: `err-perm-${Date.now()}`,
              role: 'system',
              tone: 'error',
              text: `权限切换失败: ${error instanceof Error ? error.message : String(error)}`,
              timestamp: new Date().toISOString(),
            },
          ]);
        });
    },
    [conversation.id, onConversationUpdated, permissionMode],
  );

  const handleStop = useCallback(async () => {
    const api = bridge();
    const runId = projected.activeRunId;
    if (!api?.cancelRun || !runId || stopping) return;
    setStopping(true);
    try {
      await api.cancelRun({ runId: runId as RunId });
      setSending(false);
    } catch (error) {
      setLocalErrors((prev) => [
        ...prev,
        {
          id: `err-stop-${Date.now()}`,
          role: 'system',
          tone: 'error',
          text: `停止失败: ${error instanceof Error ? error.message : String(error)}`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setStopping(false);
    }
  }, [projected.activeRunId, stopping]);

  /**
   * Resolve the model currently in effect for this conversation.
   * Priority:
   * 1) explicit compose override (persisted)
   * 2) model-track targetRef if still in catalog
   * 3) agent-track: bound global agent defaultModelId
   * 4) latest run's providerModelId / modelId from event history
   * Never fall back to the track label "模型对话", and never treat agent/team ids as model ids.
   */
  const resolvedModel = useMemo(() => {
    const findModel = (ref?: string) => {
      const key = ref?.trim();
      if (!key) return undefined;
      return (
        models.find((model) => model.modelId === key) ||
        models.find((model) => model.displayName.toLowerCase() === key.toLowerCase()) ||
        models.find(
          (model) =>
            model.displayName.toLowerCase() === key.slice(key.lastIndexOf('/') + 1).toLowerCase(),
        )
      );
    };

    const override = modelOverride.trim();
    const overrideModel = findModel(override);
    if (overrideModel) {
      return { id: overrideModel.modelId, option: overrideModel, source: 'override' as const };
    }

    const target = conversation.targetRef?.trim() || '';
    // Model track only: targetRef is a model id. Agent/team targetRef is an entity id.
    if (conversation.track === 'model' || !conversation.track) {
      const targetModel = findModel(target);
      if (targetModel) {
        return { id: targetModel.modelId, option: targetModel, source: 'target' as const };
      }
    }

    if (conversation.track === 'agent' && target) {
      const agent = agents.find((item) => item.id === target);
      const agentModel = findModel(agent?.defaultModelId);
      if (agentModel) {
        return { id: agentModel.modelId, option: agentModel, source: 'agent-default' as const };
      }
      if (agent?.defaultModelId?.trim()) {
        return {
          id: agent.defaultModelId,
          option: undefined,
          label: agent.defaultModelId.includes('/')
            ? agent.defaultModelId.slice(agent.defaultModelId.lastIndexOf('/') + 1)
            : agent.defaultModelId,
          source: 'agent-default-label' as const,
        };
      }
    }

    // Recover from a deleted/stale targetRef via the latest run on this thread/task.
    const ordered = [...eventHistory].sort((a, b) => b.sequence - a.sequence);
    for (const event of ordered) {
      if (
        event.type !== 'run.started' &&
        event.type !== 'run.fallback.selected' &&
        !isRunTerminalEventType(event.type) &&
        event.type !== 'provider.usage'
      ) {
        continue;
      }
      const runPayload =
        event.payload.run && typeof event.payload.run === 'object'
          ? (event.payload.run as Record<string, unknown>)
          : undefined;
      const eventThread =
        typeof event.payload.threadId === 'string'
          ? event.payload.threadId
          : typeof runPayload?.threadId === 'string'
            ? runPayload.threadId
            : undefined;
      if (threadId && eventThread && eventThread !== threadId) continue;
      if (
        threadId &&
        !eventThread &&
        conversation.taskId &&
        event.taskId &&
        event.taskId !== conversation.taskId
      ) {
        continue;
      }
      const providerModelId =
        (typeof event.payload.providerModelId === 'string' && event.payload.providerModelId) ||
        (typeof runPayload?.providerModelId === 'string' && runPayload.providerModelId) ||
        undefined;
      const modelId =
        (typeof event.payload.modelId === 'string' && event.payload.modelId) ||
        (typeof runPayload?.modelId === 'string' && runPayload.modelId) ||
        undefined;
      const recovered = findModel(providerModelId) || findModel(modelId);
      if (recovered) {
        return { id: recovered.modelId, option: recovered, source: 'history' as const };
      }
      if (providerModelId) {
        return {
          id: modelId || providerModelId,
          option: undefined,
          label: providerModelId.includes('/')
            ? providerModelId.slice(providerModelId.lastIndexOf('/') + 1)
            : providerModelId,
          source: 'history-label' as const,
        };
      }
    }

    // Last resort: catalog first model. Never use agent/team targetRef or track labels.
    if (conversation.track === 'agent' || conversation.track === 'team') {
      return {
        id: models[0]?.modelId || '',
        option: models[0],
        label: models[0]?.displayName || '选择模型',
        source: 'fallback' as const,
      };
    }
    const fallbackLabel =
      modelName && modelName !== '模型对话' && modelName !== '智能体' && modelName !== '小队'
        ? modelName
        : models[0]?.displayName || '选择模型';
    return {
      id: models[0]?.modelId || (conversation.track === 'model' ? target : '') || '',
      option: models[0],
      label: fallbackLabel,
      source: 'fallback' as const,
    };
  }, [
    agents,
    conversation.targetRef,
    conversation.taskId,
    conversation.track,
    eventHistory,
    modelName,
    modelOverride,
    models,
    threadId,
  ]);

  const activeModelId = resolvedModel.id;
  const activeModelOption = resolvedModel.option;
  const activeModel =
    activeModelOption?.displayName ||
    ('label' in resolvedModel ? resolvedModel.label : undefined) ||
    modelName ||
    activeModelId ||
    '选择模型';

  // Context usage for the ring: the live context footprint is the latest
  // *input* token count of this thread (prompt + history), not input+output.
  // After a successful compact, prefer context.compacted.afterTokens until a
  // newer provider.usage arrives so the ring drops immediately.
  // Runtime stores threadId under payload.run.threadId (not always top-level).
  const contextUsed = contextStatus?.estimatedUsedTokens ?? 0;
  const contextLimit = contextStatus?.contextWindow ?? 0;

  // Session metrics for the NewMax ring hover card (会话 耗时 / 用量).
  const sessionMetrics = useMemo(() => {
    let tokens = 0;
    let firstStart: number | undefined;
    let lastEnd: number | undefined;
    const ordered = [...eventHistory].sort((a, b) => a.sequence - b.sequence);
    for (const event of ordered) {
      const runPayload =
        event.payload.run && typeof event.payload.run === 'object'
          ? (event.payload.run as Record<string, unknown>)
          : undefined;
      const eventThread =
        typeof event.payload.threadId === 'string'
          ? event.payload.threadId
          : typeof runPayload?.threadId === 'string'
            ? runPayload.threadId
            : undefined;
      if (threadId && eventThread && eventThread !== threadId) continue;
      if (
        threadId &&
        !eventThread &&
        conversation.taskId &&
        event.taskId &&
        event.taskId !== conversation.taskId
      ) {
        continue;
      }

      if (event.type === 'run.started') {
        const t = Date.parse(event.occurredAt);
        if (Number.isFinite(t)) {
          firstStart = firstStart === undefined ? t : Math.min(firstStart, t);
        }
      }
      if (isRunTerminalEventType(event.type) || event.type === 'provider.usage') {
        const t = Date.parse(event.occurredAt);
        if (Number.isFinite(t)) {
          lastEnd = lastEnd === undefined ? t : Math.max(lastEnd, t);
        }
      }
      if (event.type === 'provider.usage') {
        const inn =
          typeof event.payload.tokensIn === 'number'
            ? event.payload.tokensIn
            : typeof event.payload.inputTokens === 'number'
              ? event.payload.inputTokens
              : 0;
        const out =
          typeof event.payload.tokensOut === 'number'
            ? event.payload.tokensOut
            : typeof event.payload.outputTokens === 'number'
              ? event.payload.outputTokens
              : 0;
        // For session total usage, sum each request's reported totals when possible.
        // Prefer the latest cumulative-looking value if later rows dominate.
        tokens = Math.max(tokens, inn + out);
      }
    }
    const durationMs =
      firstStart !== undefined && lastEnd !== undefined && lastEnd >= firstStart
        ? lastEnd - firstStart
        : undefined;
    return { durationMs, tokens };
  }, [conversation.taskId, eventHistory, threadId]);

  const PermIcon = PERMISSION_ICONS[permissionMode];

  // 对话对象（模型 / 智能体 / 小队）标识与换绑。
  const identityLabel = useMemo(() => {
    if (conversation.track === 'agent') {
      const agent = agents.find((a) => String(a.id) === String(conversation.targetRef));
      return agent?.name ?? '智能体';
    }
    if (conversation.track === 'team') {
      const team = teams.find((t) => String(t.id) === String(conversation.targetRef));
      return team?.name ?? '小队';
    }
    return '模型';
  }, [conversation.track, conversation.targetRef, agents, teams]);
  const IdentityIcon =
    conversation.track === 'agent' ? Bot : conversation.track === 'team' ? Users : MessageSquare;
  const handlePickIdentity = useCallback(
    async (option: IdentityOption) => {
      const api = bridge();
      if (!api?.rebindConversationTarget) return;
      // 切回「直接跟模型聊」时 targetRef 用当前生效模型。
      const targetRef =
        option.track === 'model'
          ? option.targetRef || activeModelId || models[0]?.modelId || ''
          : option.targetRef;
      if (!targetRef) return;
      if (option.track === conversation.track && targetRef === String(conversation.targetRef)) {
        return;
      }
      try {
        await api.rebindConversationTarget({
          conversationId: conversation.id,
          track: option.track,
          targetRef,
        });
        setSelectedSkillVersionIds(
          resolveDefaultComposeSkillVersionIds({ track: option.track, targetRef }, agents, teams),
        );
        onConversationUpdated?.();
      } catch {
        // 换绑失败保持原状（无 toast 通道，静默即可，下次点击可重试）。
      }
    },
    [
      conversation.id,
      conversation.track,
      conversation.targetRef,
      activeModelId,
      agents,
      models,
      onConversationUpdated,
      teams,
    ],
  );
  const showTyping = sending || projected.streaming;
  const canStop = Boolean(projected.activeRunId) && (sending || projected.streaming);

  // AI browser_open 工具 → 打开右栏并把 URL 推给浏览器面板。
  // seq 递增保证同一 URL 重复打开也会重新导航。
  const [aiBrowserNav, setAiBrowserNav] = useState<{ url: string; seq: number } | null>(null);
  const seenBrowserOpenIdsRef = useRef<Set<string>>(new Set());
  const browserNavPrimedRef = useRef(false);
  useEffect(() => {
    // 首轮只登记历史事件，不回放——避免重开会话时右栏自动弹出。
    const priming = !browserNavPrimedRef.current;
    browserNavPrimedRef.current = true;
    let latest: { id: string; url: string } | undefined;
    for (const event of eventHistory) {
      if (event.type !== 'tool.completed' && event.type !== 'execution.tool.completed') continue;
      const payload = event.payload as {
        toolName?: unknown;
        tool?: unknown;
        result?: unknown;
        toolCallId?: unknown;
      };
      const toolName =
        typeof payload.toolName === 'string'
          ? payload.toolName
          : typeof payload.tool === 'string'
            ? payload.tool
            : '';
      if (toolName !== 'browser_open') continue;
      const eventKey =
        typeof payload.toolCallId === 'string' && payload.toolCallId
          ? payload.toolCallId
          : String(event.id);
      if (seenBrowserOpenIdsRef.current.has(eventKey)) continue;
      if (priming) {
        // 历史回放：全部登记为已见，绝不自动弹出右栏。
        seenBrowserOpenIdsRef.current.add(eventKey);
        continue;
      }
      try {
        const parsed = JSON.parse(String(payload.result ?? '')) as { ok?: boolean; url?: string };
        if (parsed.ok === true && typeof parsed.url === 'string') {
          latest = { id: eventKey, url: parsed.url };
        }
      } catch {
        /* malformed result — ignore */
      }
    }
    if (latest) {
      seenBrowserOpenIdsRef.current.add(latest.id);
      const url = latest.url;
      setRailOpen(true);
      setAiBrowserNav((current) => ({ url, seq: (current?.seq ?? 0) + 1 }));
    }
  }, [eventHistory, setRailOpen]);

  // 迁移期兼容桥：新 Runtime 已由 Browser Worker 执行真实命令，不再发此事件。
  // 保留旧 Runtime 的 browser.command_requested 回传，历史事件仍只登记、不重放。
  const seenBrowserCommandIdsRef = useRef<Set<string>>(new Set());
  const browserCommandPrimedRef = useRef(false);
  useEffect(() => {
    const priming = !browserCommandPrimedRef.current;
    browserCommandPrimedRef.current = true;
    const fresh: Array<{
      requestId: string;
      action: string;
      args: Record<string, unknown>;
    }> = [];
    for (const event of eventHistory) {
      if (event.type !== 'browser.command_requested') continue;
      const payload = event.payload as {
        requestId?: unknown;
        action?: unknown;
        args?: unknown;
        threadId?: unknown;
      };
      const requestId = typeof payload.requestId === 'string' ? payload.requestId : '';
      if (!requestId || seenBrowserCommandIdsRef.current.has(requestId)) continue;
      seenBrowserCommandIdsRef.current.add(requestId);
      if (priming) continue;
      if (threadId && typeof payload.threadId === 'string' && payload.threadId !== threadId) {
        continue;
      }
      fresh.push({
        requestId,
        action: typeof payload.action === 'string' ? payload.action : '',
        args:
          payload.args && typeof payload.args === 'object' && !Array.isArray(payload.args)
            ? (payload.args as Record<string, unknown>)
            : {},
      });
    }
    if (fresh.length === 0) return;
    const api = bridge();
    for (const command of fresh) {
      void (async () => {
        const outcome = await executeBrowserCommand({
          action: command.action,
          args: command.args,
          projectFolder,
          saveScreenshot: api?.saveBrowserScreenshot
            ? (payload) => api.saveBrowserScreenshot(payload)
            : undefined,
        });
        try {
          await api?.submitBrowserResult?.({
            requestId: command.requestId,
            ok: outcome.ok,
            resultJson: outcome.resultJson,
            error: outcome.error,
          });
        } catch {
          /* runtime 侧超时兜底会接管 */
        }
      })();
    }
  }, [eventHistory, projectFolder, threadId]);

  // Live task progress for the active run — powers the spinner capsule above
  // the composer (hover reveals the full step list, NewMax-style).
  const liveTaskView = projected.activeRunId
    ? runProcessById.get(projected.activeRunId)
    : undefined;
  const showTaskCapsule = Boolean(
    (sending || projected.streaming) &&
    liveTaskView &&
    (liveTaskView.steps.length > 0 || (liveTaskView.taskPlan?.total ?? 0) > 0),
  );

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* ─── Chat column ───────────────────────────────────────────── */}
      {/* min-w 从 360 降到 260：三栏（聊天列+文件分屏+右栏）同开时硬性下限
          之和必须小于中等窗口宽度，否则父容器 overflow:hidden 会裁掉行末的右栏。 */}
      <div className="flex min-h-0 min-w-[260px] flex-1 flex-col overflow-hidden bg-surface">
        {!hasProjectFolder ? (
          <div className="shell-warning-banner border-b px-4 py-2 text-[12px] leading-relaxed">
            当前对话没有绑定本地项目文件夹，所以 AI 不能读取工作区目录。 请先在工作区 Tab
            选择/打开项目（带真实文件夹路径），再新建对话。
          </div>
        ) : null}

        {/* ─── Messages ───────────────────────────────────────────────── */}
        <div
          ref={messagesScrollRef}
          className="shell-chat-content-wrap shell-chat-message-scroller flex-1 overflow-y-auto py-6"
          onWheel={(event) => {
            if (event.deltaY !== 0) {
              userScrollRevisionRef.current += 1;
              bottomPinIntentRef.current = event.deltaY > 0 ? 'toward-bottom' : 'away-from-bottom';
              // Release the pin during the gesture itself. Waiting for the
              // native scroll event lets a streaming render run first and
              // snap the viewport back to the bottom, perceived as jitter.
              if (event.deltaY < 0) stickToBottomRef.current = false;
            }
          }}
          onTouchStart={(event) => {
            lastTouchClientYRef.current = event.touches[0]?.clientY ?? null;
          }}
          onTouchMove={(event) => {
            const currentClientY = event.touches[0]?.clientY;
            const previousClientY = lastTouchClientYRef.current;
            if (currentClientY !== undefined && previousClientY !== null) {
              userScrollRevisionRef.current += 1;
              if (currentClientY < previousClientY) {
                bottomPinIntentRef.current = 'toward-bottom';
              } else if (currentClientY > previousClientY) {
                bottomPinIntentRef.current = 'away-from-bottom';
                stickToBottomRef.current = false;
              }
            }
            lastTouchClientYRef.current = currentClientY ?? null;
          }}
          onTouchEnd={() => {
            lastTouchClientYRef.current = null;
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === 'End') {
              userScrollRevisionRef.current += 1;
              bottomPinIntentRef.current = 'toward-bottom';
            } else if (event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'Home') {
              userScrollRevisionRef.current += 1;
              bottomPinIntentRef.current = 'away-from-bottom';
              stickToBottomRef.current = false;
            }
          }}
          onScroll={(event) => {
            const scroller = event.currentTarget;
            const currentScrollTop = scroller.scrollTop;
            const programmaticTarget = programmaticScrollTargetRef.current;
            const isProgrammatic =
              programmaticTarget !== null && Math.abs(currentScrollTop - programmaticTarget) <= 1;
            if (isProgrammatic) {
              programmaticScrollTargetRef.current = null;
            } else {
              const nativeIntent = inferNativeScrollIntent({
                previousScrollTop: lastObservedScrollTopRef.current,
                nextScrollTop: currentScrollTop,
              });
              // Native scrollbar dragging does not emit wheel events. Infer its
              // direction from scrollTop so dragging upward always releases pinning.
              if (nativeIntent === 'away-from-bottom') {
                userScrollRevisionRef.current += 1;
                bottomPinIntentRef.current = nativeIntent;
                stickToBottomRef.current = false;
              } else if (nativeIntent === 'toward-bottom' && bottomPinIntentRef.current === null) {
                userScrollRevisionRef.current += 1;
                bottomPinIntentRef.current = nativeIntent;
              }
            }
            lastObservedScrollTopRef.current = currentScrollTop;

            // Proximity may disable pinning, but only an explicit/native
            // downward gesture may re-enable it after the user viewed history.
            const distance = scroller.scrollHeight - currentScrollTop - scroller.clientHeight;
            stickToBottomRef.current = resolveBottomPinState({
              currentlyPinned: stickToBottomRef.current,
              distanceFromBottom: distance,
              userIntent: isProgrammatic ? null : bottomPinIntentRef.current,
            });
            bottomPinIntentRef.current = null;

            // Load older messages when scrolled near top. Capture one real DOM
            // row and restore it only if the user did not keep scrolling while
            // the async history request was pending.
            if (currentScrollTop < 50 && hasMore && !loadingMore && !loadingMoreRef.current) {
              const anchor = capturePrependAnchor(scroller);
              const expectedUserScrollRevision = userScrollRevisionRef.current;
              void loadMessages(nextCursor).then((applied) => {
                if (!applied || !anchor) return;
                requestAnimationFrame(() => {
                  restorePrependAnchor(scroller, anchor, expectedUserScrollRevision);
                });
              });
            }
          }}
        >
          {messages.length === 0 && !showTyping && (
            <div className="flex h-full items-center justify-center">
              <span className="text-[13px] text-text-faint">
                {!initialLoaded ? '加载中…' : '发送消息开始对话'}
              </span>
            </div>
          )}
          {/* Keep message column and compose at the same content width. */}
          <div className="shell-chat-content mx-auto flex flex-col">
            {loadingMore && (
              <div className="flex items-center justify-center py-3">
                <LoaderCircle className="h-4 w-4 animate-spin text-text-faint" />
                <span className="ml-2 text-[12px] text-text-faint">加载更早消息…</span>
              </div>
            )}
            {visibleDurableMessages.map((msg) => (
              <div key={msg.id} data-message-id={msg.id} className="shell-message-window-item pb-6">
                <MessageBubble
                  message={msg}
                  processView={msg.runId ? runProcessById.get(msg.runId) : undefined}
                  models={models}
                  agents={agents}
                  regenerating={sending}
                  onRegenerate={handleRegenerate}
                  onOpenChange={openChangeInRail}
                  onExpandRail={expandRail}
                  onOpenImage={setLightbox}
                />
              </div>
            ))}
            {liveMessages.map((msg) => (
              <div key={msg.id} className="pb-6">
                <MessageBubble
                  message={msg}
                  processView={msg.runId ? runProcessById.get(msg.runId) : undefined}
                  models={models}
                  agents={agents}
                  regenerating={sending}
                  onRegenerate={handleRegenerate}
                  onOpenChange={openChangeInRail}
                  onExpandRail={expandRail}
                  onOpenImage={setLightbox}
                />
              </div>
            ))}
            {pendingApprovals.map((approval) => (
              <ToolApprovalCard
                key={approval.approvalId}
                approval={approval}
                busy={decidingApprovalId === approval.approvalId}
                onApprove={() => void handleToolApproval(approval.approvalId, 'approve')}
                onDeny={() => void handleToolApproval(approval.approvalId, 'deny')}
              />
            ))}
            {showTyping &&
              !messages.some((message) => message.streaming) &&
              pendingApprovals.length === 0 && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* ─── Compose (NewMax-style) ─────────────────────────────────── */}
        <div className="shell-chat-content-wrap shrink-0 pb-4 pt-2">
          <div className="shell-chat-content mx-auto">
            {desktopWaitingStatus === 'error' && desktopWaitingCommands.length === 0 ? (
              <DesktopWaitingQueryError
                busy={false}
                onRetry={() => void refreshDesktopWaitingCommands()}
              />
            ) : null}
            {desktopWaitingCommands.map((command) => (
              <DesktopWaitingCard
                key={command.commandId}
                command={command}
                busy={busyDesktopCommandId === command.commandId}
                error={
                  desktopWaitingError && busyDesktopCommandId === undefined
                    ? desktopWaitingError
                    : undefined
                }
                onContinue={() => void decideDesktopCommand(command, 'continue')}
                onCancel={() => void decideDesktopCommand(command, 'cancel')}
              />
            ))}
            {browserHandoffStatus === 'error' && browserHandoffs.length === 0 ? (
              <BrowserHandoffQueryError
                busy={false}
                onRetry={() => void refreshBrowserHandoffs()}
              />
            ) : null}
            {browserHandoffs.map((handoff) => (
              <BrowserHandoffCard
                key={handoff.handoffId}
                handoff={handoff}
                busy={busyBrowserHandoffId === handoff.handoffId}
                error={
                  browserHandoffError && busyBrowserHandoffId === undefined
                    ? browserHandoffError
                    : undefined
                }
                onContinue={() => void decideBrowserHandoff(handoff, 'continue')}
                onCancel={() => void decideBrowserHandoff(handoff, 'cancel')}
              />
            ))}
            {showTaskCapsule && liveTaskView ? <RunTaskCapsule view={liveTaskView} /> : null}
            {compactProgress ? (
              <div
                className="shell-compact-capsule"
                data-mode={compactProgress.mode}
                data-status={compactProgress.status}
                data-testid="context-compact-capsule"
              >
                {compactProgress.status === 'running' ? (
                  <LoaderCircle size={13} className="shell-process-spin" />
                ) : compactProgress.status === 'success' ? (
                  <Check size={13} />
                ) : compactProgress.status === 'failure' ? (
                  <AlertCircle size={13} />
                ) : (
                  <Info size={13} />
                )}
                <span>{compactProgress.message || '正在压缩上下文…'}</span>
                {compactProgress.status === 'running' ? (
                  <span className="shell-compact-capsule__elapsed">
                    {formatCompactElapsed(compactProgress.startedAt, compactNow)}
                  </span>
                ) : null}
              </div>
            ) : null}
            <div
              className={`shell-compose relative ${dragOver ? 'is-dragover' : ''}`}
              ref={composeRef}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              {/* / slash command menu — portal above compose */}
              {slash &&
                slashPopStyle &&
                typeof document !== 'undefined' &&
                createPortal(
                  <div
                    ref={slashListRef}
                    className="shell-mention-pop shell-mention-pop--portal shell-slash-pop"
                    style={slashPopStyle}
                    data-testid="compose-slash-pop"
                    role="listbox"
                    aria-label="斜杠命令"
                  >
                    <div className="shell-slash-pop__section">命令</div>
                    {slashCommands.length === 0 ? (
                      <div className="shell-mention-pop__empty">无匹配命令</div>
                    ) : (
                      slashCommands.map((cmd, index) => (
                        <button
                          key={cmd.id}
                          type="button"
                          role="option"
                          aria-selected={index === slashIndex}
                          className={`shell-mention-pop__item shell-slash-pop__item ${
                            index === slashIndex ? 'is-active' : ''
                          }`}
                          onMouseEnter={() => setSlashIndex(index)}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            selectSlashCommand(cmd);
                          }}
                        >
                          <span className="shell-slash-pop__cmd">{cmd.command}</span>
                          <span className="shell-slash-pop__meta">
                            <span className="shell-slash-pop__label">{cmd.label}</span>
                            <span className="shell-slash-pop__desc">{cmd.description}</span>
                          </span>
                          {cmd.kind === 'coming-soon' ? (
                            <span className="shell-slash-pop__badge">即将</span>
                          ) : null}
                        </button>
                      ))
                    )}
                  </div>,
                  document.body,
                )}
              {/* @ file picker — portal so chat column overflow cannot clip it */}
              {mention &&
                mentionPopStyle &&
                typeof document !== 'undefined' &&
                createPortal(
                  <div
                    ref={mentionListRef}
                    className="shell-mention-pop shell-mention-pop--portal"
                    style={mentionPopStyle}
                    data-testid="compose-mention-pop"
                    role="listbox"
                  >
                    {!hasProjectFolder ? (
                      <div className="shell-mention-pop__empty">
                        未绑定项目文件夹，无法 @ 引用本地文件
                      </div>
                    ) : mentionLoading ? (
                      <div className="shell-mention-pop__empty">搜索文件…</div>
                    ) : mentionFiles.length === 0 ? (
                      <div className="shell-mention-pop__empty">
                        {mention.query ? '无匹配文件' : '输入以过滤项目文件'}
                      </div>
                    ) : (
                      mentionFiles.map((file, index) => (
                        <button
                          key={`${file.kind}:${file.path}`}
                          type="button"
                          role="option"
                          aria-selected={index === mentionIndex}
                          className={`shell-mention-pop__item ${
                            index === mentionIndex ? 'is-active' : ''
                          }`}
                          onMouseEnter={() => setMentionIndex(index)}
                          onMouseDown={(ev) => {
                            ev.preventDefault();
                            selectMentionFile(file);
                          }}
                        >
                          <span className="shell-mention-pop__icon">
                            {file.kind === 'dir' ? (
                              <FolderOpen size={13} />
                            ) : (
                              <FileCode2 size={13} />
                            )}
                          </span>
                          <span className="shell-mention-pop__path" title={file.path}>
                            {file.path}
                          </span>
                          <span className="shell-mention-pop__kind">
                            {file.kind === 'dir' ? '目录' : '文件'}
                          </span>
                        </button>
                      ))
                    )}
                  </div>,
                  document.body,
                )}

              {/* Attachment chips (NewMax: selected @ files / images become chips) */}
              {attachments.length > 0 && (
                <div className="shell-compose__chips" data-testid="compose-attachments">
                  {attachments.map((file) => (
                    <div
                      key={file.path}
                      className="shell-attach-chip"
                      title={file.path}
                      data-kind={file.kind}
                    >
                      {file.kind === 'image' && file.previewUrl ? (
                        <button
                          type="button"
                          className="shell-attach-chip__thumb"
                          title="点击查看"
                          onClick={() =>
                            setLightbox({
                              id: file.path,
                              name: file.name,
                              url: file.previewUrl!,
                              mimeType: file.mimeType,
                            })
                          }
                        >
                          <img src={file.previewUrl} alt={file.name} />
                        </button>
                      ) : (
                        <span className="shell-attach-chip__icon">
                          {file.kind === 'dir' ? <FolderOpen size={14} /> : <FileCode2 size={14} />}
                        </span>
                      )}
                      <span className="shell-attach-chip__name">{file.name}</span>
                      <button
                        type="button"
                        className="shell-attach-chip__remove"
                        title="移除"
                        onClick={() => setAttachments((prev) => removeAttachment(prev, file.path))}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <textarea
                ref={inputRef}
                className="shell-compose__input"
                placeholder={
                  hasProjectFolder
                    ? '有什么我能帮你的吗？输入 @ 引用文件，/ 打开命令'
                    : '有什么我能帮你的吗？输入 / 打开命令'
                }
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onClick={(e) =>
                  updatePickersFromCaret(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)
                }
                onSelect={(e) =>
                  updatePickersFromCaret(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)
                }
                rows={1}
                disabled={sending || compactProgress?.status === 'running'}
              />

              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                className="shell-compose__file-input"
                onChange={handleImageInputChange}
                tabIndex={-1}
              />

              {/* Bottom toolbar */}
              <div className="shell-compose__bar">
                <div className="shell-compose__bar-left">
                  {/* Permission menu */}
                  <div className="shell-compose__tool-wrap">
                    <button
                      ref={permissionBtnRef}
                      type="button"
                      className="shell-compose__tool"
                      data-active={
                        menu === 'permission' || permissionMode === 'full-access' ? '1' : '0'
                      }
                      onClick={() => setMenu((m) => (m === 'permission' ? null : 'permission'))}
                      title={`权限：${PERMISSION_LABELS[permissionMode]}`}
                    >
                      <PermIcon size={15} />
                      <span className="shell-compose__tool-label">
                        {PERMISSION_LABELS[permissionMode]}
                      </span>
                    </button>
                    <PermissionMenu
                      open={menu === 'permission'}
                      value={permissionMode}
                      anchorEl={permissionBtnRef.current}
                      onClose={() => setMenu(null)}
                      onChange={setPermission}
                    />
                  </div>

                  {/* Network */}
                  <button
                    type="button"
                    className="shell-compose__tool"
                    data-active={netEnabled ? '1' : '0'}
                    onClick={() => setNetEnabled((v) => !v)}
                    title={netEnabled ? '联网已开（点击关闭）' : '联网已关（点击开启）'}
                  >
                    <Globe size={15} />
                  </button>

                  {/* Reasoning menu — fixed full ladder */}
                  <div className="shell-compose__tool-wrap">
                    <button
                      ref={reasoningBtnRef}
                      type="button"
                      className="shell-compose__tool"
                      data-active={menu === 'reasoning' || reasoningEffort !== 'auto' ? '1' : '0'}
                      onClick={() => setMenu((m) => (m === 'reasoning' ? null : 'reasoning'))}
                      title={`推理强度：${REASONING_LABELS[reasoningEffort]}`}
                    >
                      <Brain size={15} />
                      <span className="shell-compose__tool-label">
                        {REASONING_LABELS[reasoningEffort]}
                      </span>
                    </button>
                    <ReasoningMenu
                      open={menu === 'reasoning'}
                      value={reasoningEffort}
                      anchorEl={reasoningBtnRef.current}
                      onClose={() => setMenu(null)}
                      onChange={setReasoningEffort}
                    />
                  </div>

                  <TurnSkillControl
                    owner={skillOwner}
                    open={menu === 'skill'}
                    selectedSkillVersionIds={selectedSkillVersionIds}
                    onOpenChange={(open) => setMenu(open ? 'skill' : null)}
                    onChange={setSelectedSkillVersionIds}
                  />
                </div>

                <div className="shell-compose__bar-right">
                  {/* 对话对象选择器：模型 / 智能体 / 小队（rebindTarget 换绑） */}
                  <div className="shell-compose__tool-wrap">
                    <button
                      ref={identityBtnRef}
                      type="button"
                      className="shell-compose__tool"
                      data-active={
                        menu === 'identity' || conversation.track !== 'model' ? '1' : '0'
                      }
                      data-testid="compose-identity"
                      onClick={() => setMenu((m) => (m === 'identity' ? null : 'identity'))}
                      title={`对话对象：${identityLabel}`}
                    >
                      <IdentityIcon size={15} />
                      <span className="shell-compose__tool-label">{identityLabel}</span>
                    </button>
                    <IdentityPickerMenu
                      open={menu === 'identity'}
                      agents={agents.map((a) => ({
                        id: String(a.id),
                        name: a.name,
                        description: a.description,
                      }))}
                      teams={teams.map((t) => ({
                        id: String(t.id),
                        name: t.name,
                        description: t.mission,
                      }))}
                      currentTrack={conversation.track}
                      currentTargetRef={String(conversation.targetRef ?? '')}
                      anchorEl={identityBtnRef.current}
                      onClose={() => setMenu(null)}
                      onPick={(option) => void handlePickIdentity(option)}
                    />
                  </div>

                  {/* NewMax ring: context occupancy + hover shows session/cost/context */}
                  <ContextRing
                    used={contextUsed}
                    limit={contextLimit}
                    usageRatio={contextStatus?.usageRatio}
                    sections={contextStatus?.sections}
                    sessionDurationMs={sessionMetrics.durationMs}
                    sessionTokens={sessionMetrics.tokens}
                  />

                  {/* Two-level model picker */}
                  <div className="shell-compose__tool-wrap">
                    <ModelTrigger
                      label={activeModel}
                      open={menu === 'model'}
                      buttonRef={modelBtnRef}
                      onClick={() => setMenu((m) => (m === 'model' ? null : 'model'))}
                    />
                    <ModelPickerMenu
                      open={menu === 'model'}
                      models={models}
                      selectedModelId={activeModelId}
                      defaultLabel={activeModel}
                      anchorEl={modelBtnRef.current}
                      onClose={() => setMenu(null)}
                      onPick={(modelId) => {
                        // Persist per-conversation so restart keeps the chosen model.
                        // Also notify the shell so the sidebar identity line
                        // (模型 · xxx) updates immediately — targetRef alone
                        // still points at the original create-time model.
                        setModelOverride(modelId);
                        writeConversationModelOverride(
                          String(conversation.id),
                          modelId || undefined,
                        );
                        onConversationUpdated?.();
                      }}
                    />
                  </div>

                  {/* Send / Stop */}
                  {canStop ? (
                    <button
                      type="button"
                      className="shell-compose__send is-stop"
                      onClick={() => void handleStop()}
                      disabled={stopping}
                      title="停止生成"
                      data-testid="compose-stop"
                    >
                      <Square size={12} fill="currentColor" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="shell-compose__send"
                      onClick={() => void handleSend()}
                      disabled={
                        (!input.trim() && attachments.length === 0) ||
                        sending ||
                        compactProgress?.status === 'running'
                      }
                      title="发送 (Enter)"
                      data-testid="compose-send"
                    >
                      <SendHorizonal size={15} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* end chat column */}

      {/* 右栏：多面板 Dock（浏览器 / 文件 / 工作区）。带滑入动画。 */}
      {railOpen && (
        <aside
          className="shell-right-dock flex shrink-0 flex-col border-l border-border bg-surface"
          data-testid="right-rail-shell"
        >
          <RightDock
            projectFolder={projectFolder}
            browserUrl={aiBrowserNav?.url}
            browserNavSeq={aiBrowserNav?.seq}
            onOpenFile={onOpenFile}
            onClose={() => setRailOpen(false)}
          />
        </aside>
      )}

      {lightbox && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="shell-lightbox"
              role="dialog"
              aria-modal="true"
              aria-label={lightbox.name || '图片预览'}
              onClick={() => setLightbox(null)}
            >
              <button
                type="button"
                className="shell-lightbox__close"
                title="关闭"
                onClick={() => setLightbox(null)}
              >
                <X size={18} />
              </button>
              <img
                className="shell-lightbox__img"
                src={lightbox.url}
                alt={lightbox.name || '预览'}
                onClick={(e) => e.stopPropagation()}
              />
              {lightbox.name ? (
                <div className="shell-lightbox__caption">{lightbox.name}</div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

const MessageBubble = memo(function MessageBubble({
  message,
  processView,
  models,
  agents,
  regenerating,
  onRegenerate,
  onOpenChange,
  onExpandRail,
  onOpenImage,
}: {
  message: ChatMessage;
  processView?: RunProcessView;
  models?: readonly ModelOption[];
  agents?: readonly GlobalAgent[];
  regenerating?: boolean;
  onRegenerate?: (messageId: string) => void;
  onOpenChange?: (path: string) => void;
  onExpandRail?: () => void;
  onOpenImage?: (image: MessageImage) => void;
}) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const systemTone: SystemMessageTone = resolveSystemMessageTone(message.tone, message.text);
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);

  const metricsLabel = useMemo(() => {
    if (!processView) return undefined;
    return formatCompactRunMetrics({
      durationMs: processView.durationMs,
      tokensIn: processView.tokensIn,
      tokensOut: processView.tokensOut,
    });
  }, [processView]);

  const modelLabel = useMemo(() => {
    if (!processView) return undefined;
    const catalogName = models?.find(
      (model) =>
        model.modelId === processView.modelId ||
        model.displayName === processView.providerModelId ||
        model.displayName.toLowerCase() === (processView.providerModelId ?? '').toLowerCase(),
    )?.displayName;
    return formatRunModelLabel({
      providerModelId: processView.providerModelId,
      modelId: processView.modelId,
      catalogName,
    });
  }, [models, processView]);

  const clockLabel = formatMessageClock(message.timestamp);
  const absoluteTime = formatMessageAbsoluteTime(message.timestamp);

  const metricsDetail = useMemo(() => {
    if (!processView) return undefined;
    const duration = formatCompactDuration(processView.durationMs);
    const durationExact =
      typeof processView.durationMs === 'number'
        ? `${Math.round(processView.durationMs)}ms`
        : undefined;
    const tokens =
      processView.tokensIn !== undefined || processView.tokensOut !== undefined
        ? splitProviderUsageTokens({
            tokensIn: processView.tokensIn ?? 0,
            tokensOut: processView.tokensOut ?? 0,
            cachedTokensHit: processView.cachedTokensHit,
            cachedTokensCreated: processView.cachedTokensCreated,
          })
        : undefined;
    return {
      duration,
      durationExact,
      tokens,
      cacheReadReported: typeof processView.cachedTokensHit === 'number',
      cacheWriteReported: typeof processView.cachedTokensCreated === 'number',
      model: modelLabel,
      absoluteTime,
    };
  }, [absoluteTime, modelLabel, processView]);

  const handleCopy = useCallback(async () => {
    if (!message.text.trim()) return;
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore */
    }
  }, [message.text]);

  const handleShare = useCallback(async () => {
    if (!message.text.trim()) return;
    try {
      await navigator.clipboard.writeText(message.text);
      setShared(true);
      window.setTimeout(() => setShared(false), 1400);
    } catch {
      /* ignore */
    }
  }, [message.text]);

  if (isUser) {
    const images = message.images ?? [];
    return (
      <div className="shell-msg shell-msg--user group relative flex justify-end">
        <div className="shell-user-bubble-wrap">
          <div className="shell-user-bubble max-w-full rounded-2xl bg-[color-mix(in_srgb,var(--color-elevated)_88%,var(--color-text)_12%)] px-4 py-2.5 text-[13.5px] leading-relaxed text-text shadow-sm">
            {images.length > 0 ? (
              <div className="shell-msg-images shell-msg-images--user">
                {images.map((img) => (
                  <button
                    key={img.id}
                    type="button"
                    className="shell-msg-image-btn"
                    title={img.name || '点击查看'}
                    onClick={() => onOpenImage?.(img)}
                  >
                    <img src={img.url} alt={img.name || '图片'} />
                  </button>
                ))}
              </div>
            ) : null}
            {message.text ? (
              <div className="whitespace-pre-wrap break-words">{message.text}</div>
            ) : null}
          </div>
          {clockLabel ? (
            <div className="shell-msg-meta shell-msg-meta--user">
              <MetaHover
                className="shell-msg-meta__time"
                label={clockLabel}
                panel={
                  <div className="shell-meta-tip">
                    <div className="shell-meta-tip__title">发送时间</div>
                    <div className="shell-meta-tip__row">
                      <span>时间</span>
                      <strong>{absoluteTime ?? clockLabel}</strong>
                    </div>
                  </div>
                }
              />
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (isSystem) {
    const bubbleClass =
      systemTone === 'error'
        ? 'shell-error-bubble'
        : systemTone === 'warning'
          ? 'shell-system-bubble shell-system-bubble--warning'
          : systemTone === 'success'
            ? 'shell-system-bubble shell-system-bubble--success'
            : 'shell-system-bubble shell-system-bubble--info';
    return (
      <div className="shell-msg group relative flex justify-start">
        <div
          className={`${bubbleClass} max-w-[80%] rounded-xl border px-4 py-2.5 text-[12.5px]`}
          data-tone={systemTone}
        >
          {message.text}
        </div>
      </div>
    );
  }

  // AI message — thinking + process + file changes + markdown + NewMax-style footer
  const agentLabel = message.globalAgentName?.trim();
  // Resolve the live agent record so chat shows the exact avatar designed in
  // the library (emoji or imported image); fall back to name lookup for runs
  // recorded before agent ids were stamped on events.
  const agentRecord = agents?.find(
    (a) =>
      (message.globalAgentId && a.id === message.globalAgentId) ||
      (!message.globalAgentId && agentLabel && a.name === agentLabel),
  );
  return (
    <div className="shell-msg shell-msg--assistant group relative flex items-start gap-3">
      {agentRecord || agentLabel ? (
        <div className="mt-0.5" data-agent-id={message.globalAgentId || undefined}>
          <AgentAvatarView
            name={agentRecord?.name ?? agentLabel ?? '助手'}
            avatar={agentRecord?.avatar}
            size={26}
            title={agentLabel || '助手'}
          />
        </div>
      ) : (
        <div className="shell-ai-avatar mt-0.5" title="助手">
          <Bot size={13} />
        </div>
      )}
      <div className="min-w-0 flex-1 pt-0.5">
        {agentLabel ? (
          <div className="mb-1 text-[11.5px] font-medium text-text-faint">{agentLabel}</div>
        ) : null}
        <AssistantProcessGroup
          reasoningText={message.reasoningText}
          processView={processView}
          streaming={Boolean(message.streaming)}
        >
          <ReasoningBlock
            text={message.reasoningText}
            streaming={Boolean(message.streaming && !message.text.trim())}
          />
          {processView ? (
            <ExecutionProcessBlock
              view={processView}
              forceExpanded={Boolean(message.streaming)}
              nested
              onOpenChange={onOpenChange}
            />
          ) : null}
        </AssistantProcessGroup>
        {message.text ? (
          <MarkdownContent text={message.text} streaming={Boolean(message.streaming)} />
        ) : message.streaming && !message.reasoningText?.trim() ? (
          <TypingDots inline />
        ) : null}
        {message.terminalState ? (
          <div
            className="mt-2 flex items-center gap-1.5 text-[11.5px] text-text-faint"
            data-testid={`assistant-terminal-${message.terminalState}`}
            title={message.terminalError}
          >
            {message.terminalState === 'failed' ? (
              <AlertCircle size={12} className="shrink-0 text-[var(--color-error)]" />
            ) : (
              <Square size={11} className="shrink-0" />
            )}
            <span>
              {message.terminalState === 'failed'
                ? '回复失败，已保留中断前内容'
                : '已停止生成，以上内容已保留'}
            </span>
          </div>
        ) : null}
        {/* NewMax: the per-run file summary stays visible after the reply
            lands (outside the auto-collapsing process group) so「本轮改了
            哪些文件」is always one glance away. */}
        {!message.streaming && processView ? (
          <FileChangesCard
            view={processView}
            nested
            onOpenChange={onOpenChange}
            onExpandRail={onExpandRail}
          />
        ) : null}

        {!message.streaming && message.text.trim() ? (
          <div className="shell-msg-footer">
            <div className="shell-msg-footer__actions">
              <button
                type="button"
                className="shell-msg-footer__btn"
                onClick={() => void handleCopy()}
                title="复制"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                <span>{copied ? '已复制' : '复制'}</span>
              </button>
              <button
                type="button"
                className="shell-msg-footer__btn"
                onClick={() => void onRegenerate?.(message.id)}
                disabled={regenerating}
                title="重新生成"
              >
                <RefreshCw size={13} className={regenerating ? 'shell-process-spin' : ''} />
                <span>重新生成</span>
              </button>
              <button
                type="button"
                className="shell-msg-footer__btn"
                onClick={() => void handleShare()}
                title="分享（先复制 Markdown）"
              >
                <Share2 size={13} />
                <span>{shared ? '已复制' : '分享'}</span>
              </button>
            </div>
            <div className="shell-msg-meta shell-msg-meta--assistant">
              {metricsLabel && metricsDetail ? (
                <MetaHover
                  className="shell-msg-meta__metrics"
                  label={metricsLabel}
                  panel={
                    <div className="shell-meta-tip">
                      <div className="shell-meta-tip__title">本次回复累计</div>
                      {metricsDetail.duration ? (
                        <div className="shell-meta-tip__row">
                          <span>耗时</span>
                          <strong>
                            {metricsDetail.duration}
                            {metricsDetail.durationExact ? (
                              <span className="shell-meta-tip__muted">
                                {' '}
                                · {metricsDetail.durationExact}
                              </span>
                            ) : null}
                          </strong>
                        </div>
                      ) : null}
                      {metricsDetail.tokens ? (
                        <div className="shell-meta-tip__row">
                          <span>总 Token</span>
                          <strong>{formatCompactCount(metricsDetail.tokens.totalTokens)}</strong>
                        </div>
                      ) : null}
                      {metricsDetail.tokens ? (
                        <div className="shell-meta-tip__row">
                          <span>普通输入</span>
                          <strong>{formatCompactCount(metricsDetail.tokens.inputTokens)}</strong>
                        </div>
                      ) : null}
                      {metricsDetail.tokens ? (
                        <div className="shell-meta-tip__row">
                          <span>缓存读取</span>
                          <strong>
                            {metricsDetail.cacheReadReported
                              ? formatCompactCount(metricsDetail.tokens.cacheReadTokens)
                              : '未上报'}
                          </strong>
                        </div>
                      ) : null}
                      {metricsDetail.tokens ? (
                        <div className="shell-meta-tip__row">
                          <span>缓存创建</span>
                          <strong>
                            {metricsDetail.cacheWriteReported
                              ? formatCompactCount(metricsDetail.tokens.cacheWriteTokens)
                              : '未上报'}
                          </strong>
                        </div>
                      ) : null}
                      {metricsDetail.tokens ? (
                        <div className="shell-meta-tip__row">
                          <span>输出</span>
                          <strong>{formatCompactCount(metricsDetail.tokens.outputTokens)}</strong>
                        </div>
                      ) : null}
                      {metricsDetail.model ? (
                        <div className="shell-meta-tip__row">
                          <span>模型</span>
                          <strong>{metricsDetail.model}</strong>
                        </div>
                      ) : null}
                      {metricsDetail.absoluteTime ? (
                        <div className="shell-meta-tip__row">
                          <span>时间</span>
                          <strong>{metricsDetail.absoluteTime}</strong>
                        </div>
                      ) : null}
                    </div>
                  }
                />
              ) : null}
              {clockLabel ? (
                <MetaHover
                  className="shell-msg-meta__time"
                  label={clockLabel}
                  panel={
                    <div className="shell-meta-tip">
                      <div className="shell-meta-tip__title">完成时间</div>
                      <div className="shell-meta-tip__row">
                        <span>时间</span>
                        <strong>{absoluteTime ?? clockLabel}</strong>
                      </div>
                    </div>
                  }
                />
              ) : null}
              {modelLabel ? (
                <MetaHover
                  className="shell-msg-meta__model"
                  label={modelLabel}
                  panel={
                    <div className="shell-meta-tip">
                      <div className="shell-meta-tip__title">本轮模型</div>
                      <div className="shell-meta-tip__row">
                        <span>模型</span>
                        <strong>{modelLabel}</strong>
                      </div>
                    </div>
                  }
                />
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
});

// ─── NewMax-style meta hover (replaces native title tooltips) ────────────────

function MetaHover({
  label,
  panel,
  className,
}: {
  label: ReactNode;
  panel: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<number | null>(null);

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const show = () => {
    cancelClose();
    const el = triggerRef.current;
    if (!el || typeof window === 'undefined') return;
    const rect = el.getBoundingClientRect();
    const width = 220;
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    setStyle({
      position: 'fixed',
      left,
      bottom: window.innerHeight - rect.top + 8,
      width,
      zIndex: 10020,
    });
    setOpen(true);
  };

  const hide = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  };

  useEffect(() => () => cancelClose(), []);

  return (
    <>
      <span
        ref={triggerRef}
        className={className}
        tabIndex={0}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {label}
      </span>
      {open && style && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="shell-meta-tip-portal"
              style={style}
              role="tooltip"
              onMouseEnter={cancelClose}
              onMouseLeave={hide}
            >
              {panel}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

// ─── Thinking + tool process group (higher-level fold) ─────────────────────────

export function formatAssistantProcessElapsed(
  processView: RunProcessView | undefined,
  active: boolean,
  now: number = Date.now(),
): string | undefined {
  const durationMs = (() => {
    if (active) {
      const startedAt = Date.parse(processView?.startedAt ?? '');
      return Number.isFinite(startedAt) && Number.isFinite(now) && now >= startedAt
        ? now - startedAt
        : undefined;
    }
    const startedAt = Date.parse(processView?.startedAt ?? '');
    const completedAt = Date.parse(processView?.completedAt ?? '');
    if (Number.isFinite(startedAt) && Number.isFinite(completedAt) && completedAt >= startedAt) {
      return completedAt - startedAt;
    }
    return typeof processView?.durationMs === 'number' &&
      Number.isFinite(processView.durationMs) &&
      processView.durationMs >= 0
      ? processView.durationMs
      : undefined;
  })();
  if (durationMs === undefined) return undefined;
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
    : [minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

export function AssistantProcessGroup({
  reasoningText,
  processView,
  streaming,
  children,
}: {
  reasoningText?: string;
  processView?: RunProcessView;
  streaming?: boolean;
  children: ReactNode;
}) {
  const hasReasoning = Boolean(reasoningText?.trim());
  const stepCount = processView?.steps.length ?? 0;
  const changeCount = processView?.fileChanges.length ?? 0;
  const active = Boolean(streaming || processView?.running);
  const hasContent = hasReasoning || stepCount > 0 || changeCount > 0 || active;
  const [open, setOpen] = useState(Boolean(streaming));
  const [clockNow, setClockNow] = useState(() => Date.now());

  useEffect(() => {
    if (streaming) setOpen(true);
    else setOpen(false);
  }, [streaming]);

  useEffect(() => {
    setClockNow(Date.now());
    if (!active || !processView?.startedAt) return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active, processView?.startedAt]);

  if (!hasContent) return null;

  const elapsed = formatAssistantProcessElapsed(processView, active, clockNow);
  const summaryParts = [
    hasReasoning ? '深度思考' : undefined,
    stepCount > 0 ? `${stepCount} 个工具步骤` : undefined,
    changeCount > 0 ? `${changeCount} 个文件变更` : undefined,
  ].filter(Boolean);

  return (
    <section
      className={`shell-process-group ${open ? 'is-open' : ''}`}
      data-streaming={streaming ? '1' : '0'}
    >
      <button
        type="button"
        className="shell-process-group__toggle"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="shell-process-group__icon">
          {active ? (
            <LoaderCircle size={14} className="shell-process-spin" />
          ) : processView?.errorCount ? (
            <FileWarning size={14} />
          ) : (
            <Brain size={14} />
          )}
        </span>
        <span className="shell-process-group__heading">
          <strong>
            {active ? '正在思考与执行…' : '思考与执行过程'}
            {elapsed ? ` · ${elapsed}` : ''}
          </strong>
          <small>{summaryParts.length > 0 ? summaryParts.join(' · ') : '准备中'}</small>
        </span>
        <ChevronDown size={15} className="shell-process-group__chevron" />
      </button>
      {open ? <div className="shell-process-group__body">{children}</div> : null}
    </section>
  );
}

// ─── Depth thinking / reasoning block (NewMax-style) ─────────────────────────

function ReasoningBlock({ text, streaming }: { text?: string; streaming?: boolean }) {
  const content = (text ?? '').trim();
  const [open, setOpen] = useState(Boolean(streaming));
  const bodyRef = useRef<HTMLDivElement>(null);
  const followTailRef = useRef(true);
  const previousStreamingRef = useRef(Boolean(streaming));

  useEffect(() => {
    // Expanded while thinking, folded once the answer lands (P2). Without the
    // collapse the reasoning stayed open forever and dominated the transcript.
    setOpen(Boolean(streaming));
    // A new streaming turn starts at the tail; preserve a user's manual
    // position while that same turn continues to receive tokens.
    if (streaming && !previousStreamingRef.current) followTailRef.current = true;
    previousStreamingRef.current = Boolean(streaming);
  }, [streaming]);

  // NewMax-style live thinking: keep the newest reasoning line in view while
  // tokens stream, so the panel reads like a rolling console. Once the user
  // wheels upward, stop forcing scrollTop so the text no longer jumps back.
  useEffect(() => {
    if (!streaming || !open || !followTailRef.current) return;
    const el = bodyRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom <= 32) el.scrollTop = el.scrollHeight;
  }, [content, streaming, open]);

  if (!content && !streaming) return null;

  return (
    <div
      className={`shell-reasoning ${open ? 'is-open' : ''}`}
      data-streaming={streaming ? '1' : '0'}
    >
      <button
        type="button"
        className="shell-reasoning__toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Brain size={13} className="shell-reasoning__icon" />
        <span className="shell-reasoning__title">{streaming ? '深度思考中…' : '深度思考'}</span>
        <span className="shell-reasoning__chev" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open ? (
        <div
          ref={bodyRef}
          className="shell-reasoning__body"
          onWheel={(event) => {
            if (event.deltaY < 0) followTailRef.current = false;
          }}
          onScroll={() => {
            const el = bodyRef.current;
            if (!el) return;
            const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
            if (distanceFromBottom > 32) followTailRef.current = false;
            else if (streaming) followTailRef.current = true;
          }}
        >
          {content ? (
            <pre className="shell-reasoning__text">
              {content}
              {streaming ? <span className="shell-reasoning__caret" aria-hidden /> : null}
            </pre>
          ) : (
            <div className="shell-reasoning__placeholder">正在思考…</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ─── Tool approval card（询问批准） ───────────────────────────────────────────

function ToolApprovalCard({
  approval,
  busy,
  onApprove,
  onDeny,
}: {
  approval: PendingToolApproval;
  busy?: boolean;
  onApprove(): void;
  onDeny(): void;
}) {
  // Per-tool presentation: icon + subtitle + approve label.
  // Agent Library mutations get distinct icons so the user can tell at a glance
  // whether the model wants to create, modify, or archive an agent.
  const presentation: Record<string, { Icon: typeof Bot; subtitle: string; approveLabel: string }> =
    {
      create_agent: {
        Icon: Bot,
        subtitle: '创建智能体 · 需要你批准后才会写入智能体库',
        approveLabel: '批准创建',
      },
      update_agent: {
        Icon: PenLine,
        subtitle: '修改智能体 · 批准后变更立即生效',
        approveLabel: '批准修改',
      },
      archive_agent: {
        Icon: Archive,
        subtitle: '归档智能体 · 软删除，可在智能体库随时恢复',
        approveLabel: '批准归档',
      },
      create_skill: {
        Icon: Sparkles,
        subtitle: '创建 Skill · 只导入说明文本，不会执行脚本',
        approveLabel: '批准创建',
      },
      update_skill: {
        Icon: Sparkles,
        subtitle: '更新 Skill · 新版本入库，旧版本保留',
        approveLabel: '批准更新',
      },
      delete_skill: {
        Icon: Archive,
        subtitle: '卸载 Skill · 被智能体装备时会被拒绝',
        approveLabel: '批准卸载',
      },
      create_team: {
        Icon: Users,
        subtitle: '创建小队 · 需要你批准后才会写入小队库',
        approveLabel: '批准创建',
      },
      update_team: {
        Icon: Users,
        subtitle: '修改小队 · 批准后变更立即生效，进行中的运行不受影响',
        approveLabel: '批准修改',
      },
      delete_team: {
        Icon: Users,
        subtitle: '删除小队 · 仍被对话引用或已有运行记录时会被拒绝',
        approveLabel: '批准删除',
      },
      write_file: {
        Icon: FileWarning,
        subtitle: '询问批准 · 需要你确认后才会执行',
        approveLabel: '批准执行',
      },
    };
  const view = presentation[approval.toolName] ?? {
    Icon: Terminal,
    subtitle: '询问批准 · 需要你确认后才会执行',
    approveLabel: '批准执行',
  };
  const Icon = view.Icon;
  const isAgentMutation =
    approval.toolName === 'create_agent' ||
    approval.toolName === 'update_agent' ||
    approval.toolName === 'archive_agent' ||
    approval.toolName === 'create_skill' ||
    approval.toolName === 'update_skill' ||
    approval.toolName === 'delete_skill' ||
    approval.toolName === 'create_team' ||
    approval.toolName === 'update_team' ||
    approval.toolName === 'delete_team';
  return (
    <div
      className="shell-approval-card"
      data-testid={`tool-approval-${approval.approvalId}`}
      data-tool={approval.toolName}
      data-agent-mutation={isAgentMutation ? 'true' : undefined}
    >
      <div className="shell-approval-card__head">
        <span className="shell-approval-card__icon">
          <Icon size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="shell-approval-card__title">{approval.title}</div>
          <div className="shell-approval-card__subtitle">{view.subtitle}</div>
        </div>
      </div>
      {(approval.path || approval.command || approval.detail) && (
        <div className="shell-approval-card__body">
          {approval.path ? (
            <div className="shell-approval-card__meta">
              <span className="shell-approval-card__meta-key">路径</span>
              <code className="shell-approval-card__meta-val">{approval.path}</code>
            </div>
          ) : null}
          {approval.command ? (
            <div className="shell-approval-card__meta">
              <span className="shell-approval-card__meta-key">命令</span>
              <code className="shell-approval-card__meta-val">{approval.command}</code>
            </div>
          ) : null}
          {approval.detail ? (
            <div className="shell-approval-card__detail">{approval.detail}</div>
          ) : null}
        </div>
      )}
      <div className="shell-approval-card__actions">
        <button
          type="button"
          className="shell-approval-card__btn is-deny"
          disabled={busy}
          onClick={onDeny}
        >
          <X size={13} />
          拒绝
        </button>
        <button
          type="button"
          className="shell-approval-card__btn is-approve"
          disabled={busy}
          onClick={onApprove}
        >
          <Check size={13} />
          {busy ? '处理中…' : view.approveLabel}
        </button>
      </div>
    </div>
  );
}

// ─── Run task capsule（输入框上方居中 + hover 展开可滚动任务清单） ─────────────
//
// NewMax 语义：优先展示模型通过 update_task_plan 维护的「任务清单」（真正的
// 待办，不是工具调用流水）；模型没报清单时回退为工具步骤概览。

function RunTaskCapsule({ view }: { view: RunProcessView }) {
  const [hovered, setHovered] = useState(false);
  const plan = view.taskPlan;

  // 清单模式（首选）：模型自己维护的任务列表。
  if (plan && plan.items.length > 0) {
    const runningItem = plan.items.find((item) => item.status === 'in_progress');
    const label = runningItem
      ? runningItem.title
      : plan.completed >= plan.total
        ? '任务已全部完成'
        : plan.items[0]!.title;
    return (
      <div
        className="shell-task-capsule-wrap"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        data-testid="run-task-capsule"
        data-mode="plan"
      >
        {hovered ? (
          <div className="shell-task-capsule__pop" role="list" aria-label="本轮任务清单">
            <div className="shell-task-capsule__pop-title">
              任务清单（{plan.completed}/{plan.total}）
            </div>
            <ul className="shell-task-capsule__pop-list">
              {plan.items.map((item, index) => (
                <li
                  key={`${index}-${item.title}`}
                  className="shell-task-capsule__pop-item"
                  data-status={
                    item.status === 'in_progress'
                      ? 'running'
                      : item.status === 'completed'
                        ? 'done'
                        : 'pending'
                  }
                >
                  {item.status === 'in_progress' ? (
                    <LoaderCircle size={12} className="shell-process-spin text-accent" />
                  ) : item.status === 'completed' ? (
                    <Check size={12} className="text-[var(--color-success)]" />
                  ) : (
                    <span className="shell-task-capsule__dot" aria-hidden />
                  )}
                  <span
                    className="shell-task-capsule__pop-text"
                    data-done={item.status === 'completed' ? 'true' : undefined}
                    title={item.title}
                  >
                    {item.title}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="shell-task-capsule">
          {view.running ? (
            <LoaderCircle size={13} className="shell-process-spin" />
          ) : (
            <Check size={13} className="text-[var(--color-success)]" />
          )}
          <span className="shell-task-capsule__label">{label}</span>
          <span className="shell-task-capsule__count">
            {plan.completed}/{plan.total}
          </span>
        </div>
      </div>
    );
  }

  // 回退模式：工具步骤概览（模型没维护清单时）。
  const total = view.steps.length;
  const doneCount = view.steps.filter((s) => s.status === 'done').length;
  const runningStep = view.steps.find((s) => s.status === 'running');
  const label = runningStep
    ? formatExecutionStepTitle(runningStep)
    : `已完成 ${doneCount}/${total} 个步骤`;

  return (
    <div
      className="shell-task-capsule-wrap"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-testid="run-task-capsule"
      data-mode="steps"
    >
      {hovered ? (
        <div className="shell-task-capsule__pop" role="list" aria-label="本轮执行步骤">
          <div className="shell-task-capsule__pop-title">
            执行步骤（{doneCount}/{total}）
          </div>
          <ul className="shell-task-capsule__pop-list">
            {view.steps.map((step) => (
              <li key={step.id} className="shell-task-capsule__pop-item" data-status={step.status}>
                {step.status === 'running' ? (
                  <LoaderCircle size={12} className="shell-process-spin text-accent" />
                ) : step.status === 'error' ? (
                  <AlertCircle size={12} className="text-[var(--color-error)]" />
                ) : step.status === 'done' ? (
                  <Check size={12} className="text-[var(--color-success)]" />
                ) : (
                  <span className="shell-task-capsule__dot" aria-hidden />
                )}
                <span
                  className="shell-task-capsule__pop-text"
                  title={formatExecutionStepTitle(step)}
                >
                  {formatExecutionStepTitle(step)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="shell-task-capsule">
        <LoaderCircle size={13} className="shell-process-spin" />
        <span className="shell-task-capsule__label">{label}</span>
        <span className="shell-task-capsule__count">
          {doneCount}/{total}
        </span>
      </div>
    </div>
  );
}

// ─── Typing Indicator ─────────────────────────────────────────────────────────

function TypingDots({ inline = false }: { inline?: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 ${inline ? '' : 'pt-3'}`}>
      {[0, 1, 2].map((i) => (
        <span key={i} className="shell-typing-dot" style={{ animationDelay: `${i * 160}ms` }} />
      ))}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-start gap-3">
      <div className="shell-ai-avatar mt-0.5">
        <Bot size={13} />
      </div>
      <TypingDots />
    </div>
  );
}
