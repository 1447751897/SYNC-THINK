import type { ReviewView } from './review-view.js';
import { useComposeDraftRecovery } from './use-compose-draft-recovery.js';
import { submitConversationMessage } from './submit-conversation-message.js';
import { useRunProcessPage } from './use-run-process-page.js';
import { useComposeRequestQueue } from './use-compose-request-queue.js';
import { useConversationCompaction } from './use-conversation-compaction.js';
import { useVisiblePolling } from './use-visible-polling.js';
import type { ComposeSendOptions } from './compose-send-request.js';
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  memo,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { createPortal } from 'react-dom';
import {
  historyRangeGaps,
  mergeHistoryPageMessages,
  mergeHistoryRanges,
  type HistoryRange,
} from './conversation-history-pages.js';
import {
  filterPendingUserMessagesForDisplay,
  mergeConversationMessagesForDisplay,
  orderDurableMessagesForDisplay,
} from './conversation-message-merge.js';
import { projectRunIdentities, type RunAgentIdentity } from './run-identity-projection.js';
export { projectRunAgentIdentities, projectRunKernels } from './run-identity-projection.js';
import { useConversationNavigation } from './use-conversation-navigation.js';
import { useConversationNavigationController } from './use-conversation-navigation-controller.js';
import { useMessageVirtualWindow } from './use-message-virtual-window.js';
import {
  useConversationTransientSubscription,
  type ConversationTransientSubscriptionEvent,
  type ConversationTransientSubscriptionPort,
} from './use-conversation-transient-subscription.js';
import {
  AlertCircle,
  Bot,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleSlash,
  Clock,
  Copy,
  FileText,
  Folder,
  Info,
  Lock,
  LoaderCircle,
  MessageSquare,
  Puzzle,
  RefreshCw,
  SendHorizonal,
  Shield,
  ThumbsDown,
  ThumbsUp,
  Users,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  matchesToolName,
  isKernelExecutionSupported,
  kernelExecutionUnavailableReason,
  splitProviderUsageTokens,
  type Conversation,
  type ConversationPlanSummary,
  type Event,
  type GlobalAgent,
  type KernelDetectionResult,
  type Message,
  type MessageBlock,
  type MessageId,
  type RunId,
  type TaskId,
  type ThreadId,
  type Team,
} from '@sync-think/shared';
import type {
  AssistantTurnSegment,
  AskQuestion,
  AskQuestionAnswer,
  ConversationGetContextStatusResponse,
  ConversationListRunTimelineResponse,
  ConversationListMessagesResponse,
  BrowserHandoffSummary,
  CommentaryTimelineSegment,
  DesktopWaitingCommandSummary,
  PendingToolApprovalSummary,
  ExpiredToolApprovalSummary,
  ToolApprovalScope,
  DelegatedAgentProjection,
  DelegatedAgentUsage,
  RunProcessView,
  ProviderBalancePayload,
  SkillVersionSummary,
  UsageSummaryResponse,
  WorkspaceSummary,
} from '@sync-think/protocol';
import { normalizeAssistantTurnPhases } from '@sync-think/protocol/assistant-turn';
import { parseConversationGetContextStatusResponse } from '@sync-think/protocol/conversation-context-status';
import type { ProjectTextLocation } from '../../workspace-tools-contract.js';
import { AgentAvatarView } from './AgentAvatarView.js';
import { avatarSeed, resolveAvatarFace } from './avatar-gen.js';
import { avatarStateFrom } from './agentAvatarState.js';
import { BrandLogoMark } from './BrandLogoMark.js';
import { loadSkillCatalog } from './skill-catalog-loader.js';
import { resolveKernelBrandLogo, resolveKernelDisplayName } from './brand-icons.js';
import { useAutoDisclosure } from './auto-disclosure.js';
import { BrowserHandoffCard, BrowserHandoffQueryError } from './BrowserHandoffCard.js';
import { DesktopWaitingCard, DesktopWaitingQueryError } from './DesktopWaitingCard.js';
import type { ModelOption } from './NewConversationDialog.js';
import {
  addAttachment,
  computeTextareaHeight,
  detectMentionQuery,
  fileNameFromPath,
  isImageFile,
  readFileAsDataUrl,
  removeAttachment,
  splitMessageFileReferences,
  type ComposeAttachment,
  messageImagesFromAttachments,
  type MessageImage,
} from './compose-mention.js';
import {
  createQueuedComposeRequest,
  enqueueQueuedComposeRequest,
} from './compose-request-queue.js';
import {
  detectSlashQuery,
  filterSlashCommands,
  formatCompactElapsed,
  parseSlashCommand,
  parseComposerModeKeywordHint,
  replaceSlashTokenWithCommand,
  resolveSendModelId,
  resolveSystemMessageTone,
  stripSlashToken,
  withComposerModeKeywordHint,
  withComposerModeCommand,
  withoutComposerModeCommand,
  type SlashCommand,
  type SlashQuery,
  type SystemMessageTone,
} from './compose-slash.js';
import {
  resolveAppendSkillVersionIds,
  resolveConversationSkillOwner,
} from './compose-skill-selection.js';
import { ComposeRequestQueue } from './ComposeRequestQueue.js';
import { ComposerMcpMenu } from './ComposerMcpMenu.js';
import { ComposerModeBanner, ComposerTaskPanel, NewMaxComposerFrame } from '@sync-think/ui-kit';
import { ComposerActiveModePill, ComposerModeKeywordHint } from './ComposerModeControls.js';
import { ComposerApprovalStack } from './ComposerApprovalStack.js';
import { ExpiredToolApprovalNotice } from './ExpiredToolApprovalNotice.js';
import { prepareApprovalRequestDraft } from './approval-request-recovery.js';
import { ComposerEditor } from './ComposerEditor.js';
import {
  PromptEnhancementAction,
  tryHandlePromptEnhancementShortcut,
  usePromptEnhancement,
  usePromptEnhancementShortcutEnabled,
} from './prompt-enhancement.js';
import {
  ComposerSlashMenu,
  resolveComposerSlashMenuKeyboardAction,
  type ComposerSkillCategory,
  type ComposerSlashMenuResolvedItem,
} from './ComposerSlashMenu.js';
import {
  DEFAULT_GOAL_SETTINGS,
  GoalRiskConfirmationDialog,
  GoalSettingsDialog,
  goalRequiresRiskConfirmation,
  type GoalSettingsValues,
} from './GoalSettingsDialog.js';
import { ComposerAddControl } from './ComposerAddMenu.js';
import {
  parseComposerPlanActSetting,
  resolveComposerModelSelection,
  type ComposerPlanActSetting,
} from './composer-plan-model.js';
import { compressImageDataUrl } from './image-compress.js';
import {
  ComposerActionSlot,
  ContextRing,
  IdentityPickerMenu,
  ModelPickerMenu,
  ModelTrigger,
  PERMISSION_MODE_COLLAPSED_TOOLBAR_LEVEL,
  PermissionMenu,
  REASONING_LABELS,
  SKILL_COLLAPSED_TOOLBAR_LEVEL,
  resolveDisplayedContextWindow,
  useComposerToolbarCollapse,
  type IdentityOption,
  type KernelInstallState,
  type PermissionMode,
  type ReasoningEffort,
} from './compose-toolbar.js';
import {
  applyManagedKernelSnapshotToInstallStates,
  useManagedKernelUpdateSync,
} from './managed-kernel-sync.js';
import { TurnSkillControl } from './TurnSkillControl.js';
import { keepListboxOptionVisible } from './compose-picker-scroll.js';
import { FileChangesCard } from './ExecutionProcessBlock.js';
import { RunProcessLoadNotice } from './RunProcessLoadNotice.js';
import type { RunProcessLoadFailure } from './run-process-history-loader.js';
import {
  useRunProcessHistoryLoader,
  useRunProcessHistoryRequests,
} from './use-run-process-history.js';
import {
  formatCompactCount,
  formatCompactDuration,
  formatCompactRunMetrics,
  formatMessageAbsoluteTime,
  formatMessageClock,
  formatRunModelLabel,
} from './run-display-format.js';
import { MarkdownContent } from './MarkdownContent.js';
import { toastApi, toastTypeFromTone } from './Toast.js';
import { classifyAppendMessageFailure } from '../append-message-error.js';
import { MessageTextContent, type MessageTextPart } from './MessageTextContent.js';
import { ImageLightbox } from './ImageLightbox.js';
import { resolveMessageText } from './message-text-source.js';
import type { OpenHtmlInBrowser } from './html-browser.js';
import { AnswerSources } from './AnswerSources.js';
import { collectAnswerSources } from './answer-sources.js';
import {
  AskQuestionCard,
  formatAskToolResult,
  parsePlanReviewDetail,
  planReviewOf,
  type PendingAsk,
} from './AskQuestionCard.js';
import { PlanApprovalCard } from './PlanApprovalCard.js';
import { ToolApprovalCard, type PendingToolApproval } from './ToolApprovalCard.js';
import { projectTodoFromEvents } from './todo-projection.js';
import { DelegatedAgentToolRow, InlineProcessFlow } from './InlineProcessFlow.js';
import { reconcileProcessItemOutcomes } from './process-item-outcome.js';
import { generatedImageModelsFromProcessItems } from './process-activity.js';
import {
  buildAssistantTurnNavigationItems,
  ConversationMinimapRail,
  type ConversationNavigationItem,
} from './ConversationMinimapRail.js';
import { ScrollToBottomButton } from './ScrollToBottomButton.js';
import { splitUserMessageLinks } from './user-message-links.js';
import { WebTextLink } from './WebTextLink.js';
import { loadRunTimelinePage, mergeRunTimelineSegments } from './run-timeline-loader.js';
import {
  applyConversationStreamOperations,
  collectConversationStreamBatch,
  isRunTerminalEventType,
  projectConversationRunActivity,
  projectRunPauseTerminals,
  selectLatestRunConnectionStatus,
  type ConversationStreamDraft,
} from './chat-stream.js';
import {
  buildConversationSnapshotDisplayQueue,
  getConversationDisplayQueueBatchOptions,
  getConversationDisplayQueueFlushDelay,
  mergeTransientConversationDraft,
  reconcileTransientConversationDraft,
  takeConversationDisplayQueueBatch,
  type ConversationDisplayQueueItem,
} from './chat-transient-stream.js';
import { projectConversationUsageMetrics } from './chat-usage.js';
import {
  fetchProviderBalanceView,
  fetchProviderUsageWindows,
  formatProviderUsageWindow,
  type ProviderBalanceView,
  type ProviderUsageIdentity,
  type ProviderUsageWindows,
} from './provider-usage-summary.js';
import {
  applyConversationStickOnScroll,
  expandMessageRenderStart,
  getInitialMessageRenderStart,
  isConversationNearBottom,
  MESSAGE_LOAD_EARLIER_BATCH,
  shouldFollowConversationContentResize,
  shouldReleaseStickOnWheel,
  shouldRestorePrependAnchor,
} from './message-window.js';
import { listenForFrameCoalescedViewportChange } from './viewport-frame.js';
import {
  projectRunTerminalEvents,
  reconcileStreamingMessageProcessTerminal,
  reconcileRunProcessTerminal,
  updateRunProcessMap,
} from './run-process-state.js';
import {
  AGENT_PREFERENCES_CHANGED_EVENT,
  readAgentPreferences,
  readConversationKernelOverride,
  readConversationModelOverride,
  readConversationNetworkEnabled,
  readConversationReasoningEffort,
  writeAgentPreferences,
  writeConversationKernelOverride,
  writeConversationModelOverride,
  writeConversationNetworkEnabled,
  writeConversationReasoningEffort,
  type AgentPreferences,
} from '../ui-preferences.js';
import type { RunActivityAuthority } from '../run-activity-authority.js';

const TASK_PLAN_TOOL_NAMES = new Set(['update_task_plan', 'TaskCreate', 'TaskUpdate', 'TaskList']);

/** Local error bubble FIFO cap: diagnostics are transient, keep them bounded. */
const MAX_LOCAL_ERRORS = 50;

interface BrowserSpeechRecognitionResult {
  isFinal: boolean;
  readonly length: number;
  readonly [index: number]: { transcript: string };
}

interface BrowserSpeechRecognitionEvent {
  readonly results: ArrayLike<BrowserSpeechRecognitionResult>;
}

interface BrowserSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

/**
 * One ordered item of the assistant's execution process (DSH-style inline
 * view): reasoning rows, intermediate commentary/text, and paired tool
 * cards, in durable block order. The final answer is NOT part of this list.
 */
import type {
  ChatMessage,
  InlineProcessItem,
  RuntimeConnectionNotice,
  DelegatedAgentToolEventView,
} from './conversation-types.js';
export type {
  ChatMessage,
  InlineProcessItem,
  RuntimeConnectionNotice,
  DelegatedAgentToolEventView,
} from './conversation-types.js';

import { recentConversationPageCache } from './conversation-page-cache.js';
import {
  captureConversationScrollPosition,
  readConversationScrollPosition,
  restoreConversationScrollPosition,
  writeConversationScrollPosition,
} from './conversation-scroll-position.js';

/** Initial durable message retries (1.2s / 2.4s backoff). */
const MAX_MESSAGE_RELOAD_ATTEMPTS = 2;
export function resetRecentConversationPageCacheForTests(): void {
  recentConversationPageCache.clear();
}
const readRecentConversationPage = (key: string) => recentConversationPageCache.read(key);
const readUsableRecentConversationPage = (key: string) =>
  recentConversationPageCache.readUsable(key);
const cacheRecentConversationPage = (
  key: string,
  page: import('./conversation-page-cache.js').CachedConversationPage,
) => recentConversationPageCache.write(key, page);

function ConversationLoadingSkeleton() {
  return (
    <div className="shell-chat-skeleton" role="status" aria-label="正在加载对话">
      <span className="sr-only">正在加载对话</span>
      <div className="shell-chat-skeleton__turn shell-chat-skeleton__turn--user" aria-hidden="true">
        <span className="shell-chat-skeleton__line shell-chat-skeleton__line--short" />
        <span className="shell-chat-skeleton__line shell-chat-skeleton__line--medium" />
      </div>
      <div
        className="shell-chat-skeleton__turn shell-chat-skeleton__turn--assistant"
        aria-hidden="true"
      >
        <span className="shell-chat-skeleton__avatar" />
        <div className="shell-chat-skeleton__copy">
          <span className="shell-chat-skeleton__line shell-chat-skeleton__line--long" />
          <span className="shell-chat-skeleton__line shell-chat-skeleton__line--medium" />
          <span className="shell-chat-skeleton__line shell-chat-skeleton__line--short" />
        </div>
      </div>
    </div>
  );
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Convert a durable Message from the store into the UI ChatMessage shape. */
function parseAssistantTimeline(
  blocks: readonly MessageBlock[],
): AssistantTurnSegment[] | undefined {
  const statusTypes = new Set<Extract<AssistantTurnSegment, { kind: 'status' }>['statusType']>([
    'retry',
    'model_switch',
    'connection',
    'compaction',
    'other',
  ]);
  for (const block of blocks) {
    const payload =
      block.payload && typeof block.payload === 'object'
        ? (block.payload as Record<string, unknown>)
        : undefined;
    if (!Array.isArray(payload?.assistantTimeline)) continue;
    const parsed = payload.assistantTimeline.flatMap((candidate): AssistantTurnSegment[] => {
      if (!candidate || typeof candidate !== 'object') return [];
      const segment = candidate as Record<string, unknown>;
      if (typeof segment.id !== 'string' || typeof segment.sequence !== 'number') return [];
      if (
        segment.kind === 'thinking' &&
        typeof segment.text === 'string' &&
        (segment.status === 'streaming' || segment.status === 'completed')
      ) {
        return [{ ...(segment as unknown as Extract<AssistantTurnSegment, { kind: 'thinking' }>) }];
      }
      if (
        segment.kind === 'text' &&
        (segment.phase === 'commentary' || segment.phase === 'final_answer') &&
        typeof segment.text === 'string' &&
        (segment.status === 'streaming' || segment.status === 'completed')
      ) {
        return [{ ...(segment as unknown as Extract<AssistantTurnSegment, { kind: 'text' }>) }];
      }
      if (
        segment.kind === 'tool' &&
        typeof segment.toolCallId === 'string' &&
        typeof segment.name === 'string' &&
        (segment.status === 'running' ||
          segment.status === 'completed' ||
          segment.status === 'failed')
      ) {
        return [{ ...(segment as unknown as Extract<AssistantTurnSegment, { kind: 'tool' }>) }];
      }
      if (
        segment.kind === 'status' &&
        typeof segment.label === 'string' &&
        typeof segment.statusType === 'string' &&
        statusTypes.has(
          segment.statusType as Extract<AssistantTurnSegment, { kind: 'status' }>['statusType'],
        )
      ) {
        return [{ ...(segment as unknown as Extract<AssistantTurnSegment, { kind: 'status' }>) }];
      }
      return [];
    });
    if (parsed.length > 0) {
      return normalizeAssistantTurnPhases(
        parsed.sort((left, right) => left.sequence - right.sequence),
      );
    }
  }
  return undefined;
}

/** Restore background Agent cards persisted on the parent assistant message. */
function parseDelegatedAgentProjections(
  blocks: readonly MessageBlock[],
): DelegatedAgentProjection[] | undefined {
  const statuses = new Set<DelegatedAgentProjection['status']>([
    'running',
    'completed',
    'failed',
    'cancelled',
    'timed_out',
  ]);
  const byChildRunId = new Map<string, DelegatedAgentProjection>();
  for (const block of blocks) {
    const payload =
      block.payload && typeof block.payload === 'object' && !Array.isArray(block.payload)
        ? (block.payload as Record<string, unknown>)
        : undefined;
    if (!Array.isArray(payload?.delegatedAgents)) continue;
    for (const candidate of payload.delegatedAgents) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
      const record = candidate as Record<string, unknown>;
      if (
        typeof record.childRunId !== 'string' ||
        typeof record.parentRunId !== 'string' ||
        typeof record.name !== 'string' ||
        typeof record.avatar !== 'string' ||
        typeof record.agentId !== 'string' ||
        record.kind !== 'existing' ||
        typeof record.status !== 'string' ||
        !statuses.has(record.status as DelegatedAgentProjection['status'])
      ) {
        continue;
      }
      const toolEvents = Array.isArray(record.toolEvents)
        ? record.toolEvents.flatMap((entry) => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
            const tool = entry as Record<string, unknown>;
            if (typeof tool.toolName !== 'string') return [];
            const status: DelegatedAgentProjection['toolEvents'][number]['status'] =
              tool.status === 'running' || tool.status === 'completed' || tool.status === 'failed'
                ? tool.status
                : undefined;
            return [
              {
                toolName: tool.toolName,
                ...(typeof tool.arguments === 'string' ? { arguments: tool.arguments } : {}),
                ...(status ? { status } : {}),
                ...(typeof tool.output === 'string' ? { output: tool.output } : {}),
                ...(tool.truncated === true ? { truncated: true } : {}),
                ...(tool.argumentsTruncated === true ? { argumentsTruncated: true } : {}),
                ...(typeof tool.argumentsCharacters === 'number'
                  ? { argumentsCharacters: tool.argumentsCharacters }
                  : {}),
                ...(tool.outputTruncated === true ? { outputTruncated: true } : {}),
                ...(typeof tool.outputCharacters === 'number'
                  ? { outputCharacters: tool.outputCharacters }
                  : {}),
              },
            ];
          })
        : [];
      const usage = parseDelegatedAgentUsage(record.usage);
      byChildRunId.set(record.childRunId, {
        childRunId: record.childRunId as RunId,
        parentRunId: record.parentRunId as RunId,
        ...(typeof record.parentToolCallId === 'string'
          ? { parentToolCallId: record.parentToolCallId }
          : {}),
        ...(typeof record.parallelGroup === 'string'
          ? { parallelGroup: record.parallelGroup }
          : {}),
        name: record.name,
        avatar: record.avatar,
        kind: 'existing',
        agentId: record.agentId,
        status: record.status as DelegatedAgentProjection['status'],
        ...(typeof record.activeTool === 'string' ? { activeTool: record.activeTool } : {}),
        toolEvents,
        ...(typeof record.result === 'string' ? { result: record.result } : {}),
        ...(usage ? { usage } : {}),
        ...(typeof record.durationMs === 'number' && Number.isFinite(record.durationMs)
          ? { durationMs: record.durationMs }
          : {}),
      });
    }
  }
  return byChildRunId.size > 0 ? [...byChildRunId.values()] : undefined;
}

function mergeDelegatedAgentProjection(
  current: readonly DelegatedAgentProjection[] | undefined,
  incoming: DelegatedAgentProjection,
): DelegatedAgentProjection[] {
  const byChildRunId = new Map(
    (current ?? []).map((item) => [String(item.childRunId), item] as const),
  );
  byChildRunId.set(String(incoming.childRunId), incoming);
  return [...byChildRunId.values()].map((item) => ({
    ...item,
    toolEvents: item.toolEvents.map((tool) => ({ ...tool })),
    ...(item.usage ? { usage: { ...item.usage } } : {}),
  }));
}

function assistantTimelineToChatFields(timeline: readonly AssistantTurnSegment[] | undefined): {
  answerText?: string;
  answerParts?: MessageTextPart[];
  commentaryText?: string;
  commentarySegments?: CommentaryTimelineSegment[];
  reasoningText?: string;
  processItems?: InlineProcessItem[];
} {
  if (!timeline?.length) return {};
  const ordered = [...timeline].sort((left, right) => left.sequence - right.sequence);
  const answerParts = ordered.flatMap((segment): MessageTextPart[] =>
    segment.kind === 'text' && segment.phase === 'final_answer'
      ? [{ text: segment.text, ...(segment.textRef ? { contentRef: segment.textRef } : {}) }]
      : [],
  );
  const answerText = ordered
    .filter(
      (segment): segment is Extract<AssistantTurnSegment, { kind: 'text' }> =>
        segment.kind === 'text' && segment.phase === 'final_answer',
    )
    .map((segment) => segment.text)
    .join('');
  const commentaryText = ordered
    .filter(
      (segment): segment is Extract<AssistantTurnSegment, { kind: 'text' }> =>
        segment.kind === 'text' && segment.phase === 'commentary',
    )
    .map((segment) => segment.text)
    .join('');
  /**
   * Commentary as *segments*, so the execution process can interleave each
   * fragment with the tool steps it preceded.
   *
   * The durable `commentary` block only ever carries `payload.assistantTimeline`
   * — `payload.commentarySegments` is never written by any producer, so reading
   * it left this list permanently empty and the live panel silently dropped
   * every summary line. The timeline already holds the same fragments with their
   * clocks, so derive them here instead of trusting that dead field.
   */
  const commentarySegments = ordered.flatMap((segment): CommentaryTimelineSegment[] =>
    segment.kind === 'text' && segment.phase === 'commentary' && segment.text.trim()
      ? [
          {
            id: segment.id,
            text: segment.text,
            startedAt: segment.startedAt ?? segment.completedAt ?? '',
            ...(segment.completedAt ? { completedAt: segment.completedAt } : {}),
          },
        ]
      : [],
  );
  const reasoningText = ordered
    .filter(
      (segment): segment is Extract<AssistantTurnSegment, { kind: 'thinking' }> =>
        segment.kind === 'thinking',
    )
    .map((segment) => segment.text)
    .join('\n\n');
  const processItems = ordered.flatMap((segment): InlineProcessItem[] => {
    if (segment.id === 'durable-timeline-truncated') return [];
    if (segment.kind === 'thinking') {
      return segment.text.trim()
        ? [
            {
              kind: 'reasoning',
              id: segment.id,
              sequence: segment.sequence,
              text: segment.text,
              ...(segment.textRef ? { contentRef: segment.textRef } : {}),
              status: segment.status,
              ...(segment.startedAt ? { startedAt: segment.startedAt } : {}),
              ...(segment.completedAt ? { completedAt: segment.completedAt } : {}),
            },
          ]
        : [];
    }
    if (segment.kind === 'text') {
      if (segment.phase === 'final_answer' || !segment.text.trim()) return [];
      return [
        {
          kind: 'commentary',
          id: segment.id,
          sequence: segment.sequence,
          text: segment.text,
          ...(segment.textRef ? { contentRef: segment.textRef } : {}),
          status: segment.status,
          ...(segment.startedAt ? { startedAt: segment.startedAt } : {}),
          ...(segment.completedAt ? { completedAt: segment.completedAt } : {}),
        },
      ];
    }
    if (segment.kind === 'tool') {
      if (matchesToolName(segment.name, TASK_PLAN_TOOL_NAMES)) return [];
      return [
        {
          kind: 'tool',
          id: segment.id,
          sequence: segment.sequence,
          toolCallId: segment.toolCallId,
          name: segment.name,
          ...(segment.displayName ? { displayName: segment.displayName } : {}),
          ...(segment.inputSummary ? { inputSummary: segment.inputSummary } : {}),
          argumentsJson: segment.argumentsJson ?? '',
          ...(segment.output !== undefined ? { result: segment.output } : {}),
          ...(isDelegationToolName(segment.name) ? { delegationAnchor: true } : {}),
          ...(segment.argumentsRef ? { argumentsRef: segment.argumentsRef } : {}),
          ...(segment.outputRef ? { resultRef: segment.outputRef } : {}),
          ...(segment.isError || segment.status === 'failed' ? { failed: true } : {}),
          status: segment.status,
          ...(segment.startedAt ? { startedAt: segment.startedAt } : {}),
          ...(segment.completedAt ? { completedAt: segment.completedAt } : {}),
        },
      ];
    }
    return [
      {
        kind: 'status',
        id: segment.id,
        sequence: segment.sequence,
        statusType: segment.statusType,
        label: segment.label,
        ...(segment.detail ? { detail: segment.detail } : {}),
      },
    ];
  });
  return {
    ...(answerText
      ? { answerText, ...(answerParts.some((part) => part.contentRef) ? { answerParts } : {}) }
      : {}),
    ...(commentaryText ? { commentaryText } : {}),
    ...(commentarySegments.length > 0 ? { commentarySegments } : {}),
    ...(reasoningText ? { reasoningText } : {}),
    ...(processItems.length > 0 ? { processItems } : {}),
  };
}

export function assistantTimelineProcessTiming(
  timeline: readonly AssistantTurnSegment[] | undefined,
  settled: boolean,
): { startedAt?: string; completedAt?: string } {
  let startedAt: { value: string; time: number } | undefined;
  let completedAt: { value: string; time: number } | undefined;
  for (const segment of timeline ?? []) {
    const timing = segment as {
      startedAt?: string;
      completedAt?: string;
      occurredAt?: string;
    };
    const startValue = timing.startedAt ?? timing.occurredAt;
    const startTime = Date.parse(startValue ?? '');
    if (Number.isFinite(startTime) && (!startedAt || startTime < startedAt.time)) {
      startedAt = { value: startValue!, time: startTime };
    }
    if (!settled) continue;
    const completedValue = timing.completedAt ?? timing.occurredAt;
    const completedTime = Date.parse(completedValue ?? '');
    if (Number.isFinite(completedTime) && (!completedAt || completedTime > completedAt.time)) {
      completedAt = { value: completedValue!, time: completedTime };
    }
  }
  return {
    ...(startedAt ? { startedAt: startedAt.value } : {}),
    ...(completedAt ? { completedAt: completedAt.value } : {}),
  };
}

export interface ProjectedTransientAnswer {
  /** 明确的 final_answer 段（总结面板只显示这个，§12.17.7/18）。 */
  answerText: string | undefined;
  /** 尚未被 timeline 分类的流式文本尾部，等待工具/终态边界确认所属阶段。 */
  pendingText: string;
}

export function projectTransientAnswerText(
  draftText: string,
  timeline: readonly AssistantTurnSegment[] | undefined,
): ProjectedTransientAnswer {
  const ordered = [...(timeline ?? [])].sort((left, right) => left.sequence - right.sequence);
  const classifiedText = ordered
    .filter(
      (segment): segment is Extract<AssistantTurnSegment, { kind: 'text' }> =>
        segment.kind === 'text',
    )
    .map((segment) => segment.text)
    .join('');
  const classifiedAnswer = ordered
    .filter(
      (segment): segment is Extract<AssistantTurnSegment, { kind: 'text' }> =>
        segment.kind === 'text' && segment.phase === 'final_answer',
    )
    .map((segment) => segment.text)
    .join('');
  const pendingText = classifiedText
    ? draftText.startsWith(classifiedText)
      ? draftText.slice(classifiedText.length)
      : ''
    : draftText;
  return { answerText: classifiedAnswer || undefined, pendingText };
}

/**
 * Live bubble text: only a phase-confirmed final answer is allowed here.
 * Unclassified kernel prose stays buffered until a tool/terminal boundary
 * assigns it to commentary or final_answer, matching Codex's split panes.
 */
export function visibleStreamingAnswerText(projected: ProjectedTransientAnswer): string {
  return projected.answerText || '';
}

export interface ProjectedTransientAssistantDisplay extends ProjectedTransientAnswer {
  /** Only phase-confirmed items belong in the NewMax/DSH execution process. */
  commentaryText?: string;
  reasoningText?: string;
  processItems?: InlineProcessItem[];
}

/**
 * Project a live turn. Unclassified tokens stay out of the final-answer
 * bubble and stream as a pending commentary row at the current process
 * position until a tool or terminal boundary classifies them.
 */
export function projectTransientAssistantDisplay(
  draftText: string,
  timeline: readonly AssistantTurnSegment[] | undefined,
): ProjectedTransientAssistantDisplay {
  const projected = projectTransientAnswerText(draftText, timeline);
  const timelineFields = assistantTimelineToChatFields(timeline);
  const processItems = [...(timelineFields.processItems ?? [])];
  if (projected.pendingText.trim()) {
    processItems.push({
      kind: 'commentary',
      id: 'pending-text',
      text: projected.pendingText,
      status: 'streaming',
    });
  }
  return {
    ...projected,
    ...(timelineFields.commentaryText ? { commentaryText: timelineFields.commentaryText } : {}),
    ...(timelineFields.reasoningText ? { reasoningText: timelineFields.reasoningText } : {}),
    ...(processItems.length > 0 ? { processItems } : {}),
  };
}

export function messageToChat(msg: Message): ChatMessage {
  const assistantTimeline = parseAssistantTimeline(msg.blocks);
  const delegatedAgents = parseDelegatedAgentProjections(msg.blocks);
  const timelineFields = assistantTimelineToChatFields(assistantTimeline);
  const textBlocks = msg.blocks.filter((b: MessageBlock) => b.type === 'text');
  const legacyText = textBlocks.map((b: MessageBlock) => b.text ?? '').join('\n');
  const text = timelineFields.answerText ?? legacyText;
  // Final formal answer: the LAST non-empty text block with no tool boundary
  // after it. Everything before it is execution process (reasoning /
  // commentary / intermediate text / tools). This keeps §12.17.7: the final
  // answer is not a "last non-empty text" guess — intermediate text followed
  // by tools is process, not answer.
  const textBlockIndexByIdentity = new Map<MessageBlock, number>();
  msg.blocks.forEach((block: MessageBlock, blockIndex: number) => {
    if (block.type === 'text') textBlockIndexByIdentity.set(block, blockIndex);
  });
  const answerBlock =
    [...textBlocks].reverse().find((b: MessageBlock) => {
      if (!(b.text ?? '').trim()) return false;
      const blockIndex = textBlockIndexByIdentity.get(b);
      if (blockIndex === undefined) return true;
      return !msg.blocks.some(
        (candidate: MessageBlock, candidateIndex: number) =>
          candidateIndex > blockIndex &&
          (candidate.type === 'tool-call' || candidate.type === 'tool-result'),
      );
    }) ?? undefined;
  const processItems: InlineProcessItem[] = [];
  if (!assistantTimeline)
    for (const block of msg.blocks) {
      if (block === answerBlock) continue;
      switch (block.type) {
        case 'reasoning': {
          const blockReasoning =
            typeof block.reasoningText === 'string'
              ? block.reasoningText
              : block.payload && typeof block.payload === 'object'
                ? (block.payload as Record<string, unknown>).reasoningText
                : undefined;
          const reasoning =
            typeof blockReasoning === 'string' ? blockReasoning : (block.text ?? '');
          if (reasoning.trim())
            processItems.push({
              kind: 'reasoning',
              text: reasoning,
              ...(block.contentRef ? { contentRef: block.contentRef } : {}),
            });
          break;
        }
        case 'text':
          if ((block.text ?? '').trim())
            processItems.push({
              kind: 'text',
              text: block.text ?? '',
              ...(block.contentRef ? { contentRef: block.contentRef } : {}),
            });
          break;
        case 'commentary':
          if ((block.text ?? '').trim())
            processItems.push({
              kind: 'commentary',
              text: block.text ?? '',
              ...(block.contentRef ? { contentRef: block.contentRef } : {}),
            });
          break;
        case 'tool-call': {
          const payload = (block.payload ?? {}) as {
            name?: string;
            toolCallId?: string;
            argumentsJson?: string;
            argumentsRef?: import('@sync-think/shared').DeferredContent;
          };
          processItems.push({
            kind: 'tool',
            name: payload.name ?? '工具',
            argumentsJson: payload.argumentsJson ?? '',
            ...(payload.toolCallId ? { toolCallId: payload.toolCallId } : {}),
            ...(payload.argumentsRef ? { argumentsRef: payload.argumentsRef } : {}),
          });
          break;
        }
        case 'tool-result': {
          const last = processItems[processItems.length - 1];
          if (last?.kind === 'tool') {
            // ask_user_question 结果渲染为可读回答（问询记录在消息流中可见）。
            if (last.name === 'ask_user_question') {
              last.result = formatAskToolResult(block.text ?? '') ?? block.text ?? '';
            } else {
              last.result = block.text ?? '';
            }
            const payload = (block.payload ?? {}) as { failed?: boolean };
            if (payload.failed === true) last.failed = true;
            if (block.contentRef) last.resultRef = block.contentRef;
          }
          break;
        }
        default:
          break;
      }
    }
  const commentaryBlocks = msg.blocks.filter((b: MessageBlock) => b.type === 'commentary');
  const persistedCommentaryText = commentaryBlocks
    .map((b: MessageBlock) => b.text ?? '')
    .filter(Boolean)
    .join('\n');
  const commentarySegments = commentaryBlocks.flatMap((block) => {
    const payload = (block.payload ?? {}) as Record<string, unknown>;
    if (!Array.isArray(payload.commentarySegments)) return [];
    return payload.commentarySegments.flatMap((candidate): CommentaryTimelineSegment[] => {
      if (!candidate || typeof candidate !== 'object') return [];
      const record = candidate as Record<string, unknown>;
      if (
        typeof record.id !== 'string' ||
        typeof record.text !== 'string' ||
        typeof record.startedAt !== 'string'
      ) {
        return [];
      }
      return [
        {
          id: record.id,
          text: record.text,
          startedAt: record.startedAt,
          ...(typeof record.completedAt === 'string' ? { completedAt: record.completedAt } : {}),
          ...(typeof record.afterSequence === 'number' && Number.isFinite(record.afterSequence)
            ? { afterSequence: record.afterSequence }
            : {}),
        },
      ];
    });
  });
  const commentaryText =
    persistedCommentaryText ||
    (commentarySegments.length > 0
      ? commentarySegments.map((segment) => segment.text).join('\n\n')
      : '');
  const reasoningBlocks = msg.blocks.filter((b: MessageBlock) => b.type === 'reasoning');
  const reasoningText = reasoningBlocks
    .map((b: MessageBlock) => {
      const blockReasoning =
        typeof b.reasoningText === 'string'
          ? b.reasoningText
          : b.payload && typeof b.payload === 'object'
            ? (b.payload as Record<string, unknown>).reasoningText
            : undefined;
      return typeof blockReasoning === 'string' ? blockReasoning : (b.text ?? '');
    })
    .filter(Boolean)
    .join('\n\n');
  const imageBlocks = msg.blocks.filter((b: MessageBlock) => b.type === 'image');
  const terminalPayload = (msg.blocks.find((block: MessageBlock) => block.type === 'error')
    ?.payload ?? {}) as Record<string, unknown>;
  const terminalState =
    terminalPayload.terminalState === 'failed' ||
    terminalPayload.terminalState === 'cancelled' ||
    terminalPayload.terminalState === 'paused'
      ? terminalPayload.terminalState
      : undefined;
  const skillVersionIds = msg.blocks.flatMap((block: MessageBlock) => {
    const payload =
      block.payload && typeof block.payload === 'object'
        ? (block.payload as Record<string, unknown>)
        : undefined;
    if (!Array.isArray(payload?.skillVersionIds)) return [];
    return payload.skillVersionIds.filter(
      (skillVersionId): skillVersionId is string =>
        typeof skillVersionId === 'string' && Boolean(skillVersionId.trim()),
    );
  });
  const skills = msg.blocks.flatMap((block: MessageBlock) => {
    const payload =
      block.payload && typeof block.payload === 'object'
        ? (block.payload as Record<string, unknown>)
        : undefined;
    if (!Array.isArray(payload?.skills)) return [];
    return payload.skills.flatMap((candidate) => {
      if (!candidate || typeof candidate !== 'object') return [];
      const skill = candidate as Record<string, unknown>;
      return typeof skill.skillVersionId === 'string' && typeof skill.name === 'string'
        ? [{ skillVersionId: skill.skillVersionId, name: skill.name }]
        : [];
    });
  });
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
    ...(timelineFields.answerText === undefined && textBlocks.some((block) => block.contentRef)
      ? {
          textParts: textBlocks.map((block) => ({
            text: block.text ?? '',
            ...(block.contentRef ? { contentRef: block.contentRef } : {}),
          })),
        }
      : {}),
    ...(timelineFields.answerParts
      ? { answerParts: timelineFields.answerParts }
      : answerBlock?.contentRef
        ? { answerParts: [{ text: answerBlock.text ?? '', contentRef: answerBlock.contentRef }] }
        : {}),
    commentaryText: timelineFields.commentaryText ?? (commentaryText || undefined),
    commentarySegments:
      timelineFields.commentarySegments ??
      (!assistantTimeline && commentarySegments.length > 0 ? commentarySegments : undefined),
    reasoningText: timelineFields.reasoningText ?? (reasoningText || undefined),
    assistantTimeline,
    delegatedAgents,
    answerText: timelineFields.answerText ?? (answerBlock?.text || undefined),
    processItems: timelineFields.processItems ?? processItems,
    images,
    timestamp: msg.createdAt ?? '',
    sequence: msg.sequence,
    runId: msg.runId ? String(msg.runId) : undefined,
    kernelId: msg.kernelId,
    terminalState,
    terminalError:
      typeof terminalPayload.errorMessage === 'string' ? terminalPayload.errorMessage : undefined,
    legacyTerminalBackfill: terminalPayload.legacyBackfill === true ? true : undefined,
    skillVersionIds: skillVersionIds.length > 0 ? [...new Set(skillVersionIds)] : undefined,
    skills:
      skills.length > 0
        ? [...new Map(skills.map((skill) => [skill.skillVersionId, skill] as const)).values()]
        : undefined,
    // sequence carried via id ordering; globalAgent fields are not in the store Message model
    // but could be enriched later if needed.
  };
}

export function shouldDisplayChatMessage(message: ChatMessage): boolean {
  return (
    message.text.trim().length > 0 ||
    Boolean(message.commentaryText?.trim()) ||
    Boolean(message.commentarySegments?.some((segment) => segment.text.trim())) ||
    Boolean(message.processItems?.some((item) => item.kind !== 'reasoning')) ||
    Boolean(message.assistantTimeline?.length) ||
    Boolean(message.images?.length) ||
    Boolean(message.terminalState)
  );
}

function toolApprovalArguments(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function toolApprovalScopes(value: unknown): ToolApprovalScope[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const scopes = value.filter(
    (scope): scope is ToolApprovalScope =>
      scope === 'once' || scope === 'session' || scope === 'always-app',
  );
  return scopes.length > 0 ? scopes : undefined;
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
  /** Runtime-owned boundary used to reconcile replayed orphan run starts. */
  runActivityAuthority?: RunActivityAuthority;
  /** Increments after every Runtime connect/reconnect so durable UI state is re-queried. */
  runtimeConnectionRevision?: number;
  /**
   * 该会话面是否处于激活（可见）状态。保活面在后台时仍然是挂载的，靠这个标记做
   * 「重新激活即重新同步」——见下方 durable 消息加载的补偿 effect。
   */
  active?: boolean;
  /** Shell transport state; intentionally transient and never persisted as a message. */
  runtimeConnectionNotice?: RuntimeConnectionNotice;
  onTitleUpdated: (title: string) => void;
  /** Fired after permission mode is persisted so the shell can refresh the conversation list. */
  onConversationUpdated?: () => void;
  /** One-shot selection carried from the welcome-page first send. */
  initialSkillVersionIds?: readonly string[];
  onInitialSkillSelectionConsumed?(conversationId: string): void;
  /**
   * One-shot composer text pushed in from outside (活动中心“重新编辑”).
   * It only fills the input — the user still presses Send, so the turn keeps
   * going through this component's single send path.
   */
  seedComposerText?: string;
  onSeedComposerTextConsumed?(conversationId: string): void;
  /** Latest run with file changes, reported up so review surfaces can render it. */
  onLatestReviewChange?(view: ReviewView | null): void;
  onOpenFile?: (path: string, location?: ProjectTextLocation) => void;
  /** Opens generated HTML in the embedded browser tab. */
  onOpenHtmlInBrowser?: OpenHtmlInBrowser;
  /** Opens a user-message http(s) URL in the embedded browser tab. */
  onOpenWebUrl?: (url: string) => void;
  onOpenReview?: (view: RunProcessView) => void;
  /** Opens the real model settings destination used by the Plan banner. */
  onOpenPlanSettings?: () => void;
  /** Routes the slash menu's create action to the Skill editor. */
  onCreateSkill?: () => void;
  /** Opens Settings -> Connection -> MCP from the real status panel. */
  onOpenMcpSettings?: () => void;
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

const EMPTY_CHAT_AGENTS: readonly GlobalAgent[] = [];
const EMPTY_CHAT_TEAMS: readonly Team[] = [];
const EMPTY_CHAT_WORKSPACES: readonly WorkspaceSummary[] = [];

export function ChatView({
  conversation,
  modelName,
  models,
  agents = EMPTY_CHAT_AGENTS,
  teams = EMPTY_CHAT_TEAMS,
  workspaces = EMPTY_CHAT_WORKSPACES,
  eventHistory,
  runActivityAuthority,
  runtimeConnectionRevision = 0,
  runtimeConnectionNotice,
  active = true,
  onTitleUpdated,
  onConversationUpdated,
  initialSkillVersionIds,
  onInitialSkillSelectionConsumed,
  seedComposerText,
  onSeedComposerTextConsumed,
  onLatestReviewChange,
  onOpenFile,
  onOpenHtmlInBrowser,
  onOpenWebUrl,
  onOpenReview,
  onOpenPlanSettings,
  onCreateSkill,
  onOpenMcpSettings,
}: ChatViewProps) {
  const activeConversationIdRef = useRef(String(conversation.id));
  activeConversationIdRef.current = String(conversation.id);
  const skillOwner = useMemo(
    () => resolveConversationSkillOwner(conversation, agents, teams),
    [agents, conversation, teams],
  );
  const defaultSkillVersionIds = useMemo<string[]>(() => [], []);
  const skillSelectionScopeKey = `${String(conversation.id)}\0${String(
    conversation.workspaceId ?? '',
  )}\0${conversation.track}\0${String(conversation.targetRef)}`;
  const skillSelectionScopeKeyRef = useRef(skillSelectionScopeKey);
  const [input, setInput] = useState('');
  const [dismissedModeHintText, setDismissedModeHintText] = useState<string | null>(null);
  const [voiceInputActive, setVoiceInputActive] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendingRunId, setSendingRunId] = useState<string | undefined>();
  const [stopping, setStopping] = useState(false);
  const activeRunCancellationRef = useRef<Promise<void> | null>(null);
  // 交互工作模式：'plan'（规划模式，只读分析并提交可审批计划）| 'execute'（执行模式）。
  const [interactionMode, setInteractionMode] = useState<'plan' | 'execute'>(
    conversation.interactionMode === 'plan' ? 'plan' : 'execute',
  );
  useEffect(() => {
    setInteractionMode(conversation.interactionMode === 'plan' ? 'plan' : 'execute');
  }, [conversation.id, conversation.interactionMode]);
  // 挂起的模型问询（ask_user_question → 接管 composer 的问询卡片）。
  const [pendingAsk, setPendingAsk] = useState<PendingAsk | undefined>();
  /** Resolved thread for this conversation (from bound task). */
  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  const lastAskEventSeqRef = useRef(0);
  const pendingAskLoadGenerationRef = useRef(0);
  const refreshPendingAsk = useCallback(() => {
    const api = bridge();
    const conversationId = String(conversation.id);
    const requestedThreadId = threadId;
    const generation = (pendingAskLoadGenerationRef.current += 1);
    if (!requestedThreadId || !api?.conversationAskPending) {
      setPendingAsk(undefined);
      return;
    }
    void api
      .conversationAskPending({ threadId: requestedThreadId })
      .then((res) => {
        if (
          activeConversationIdRef.current !== conversationId ||
          pendingAskLoadGenerationRef.current !== generation
        )
          return;
        setPendingAsk(res.ask);
      })
      .catch(() => {
        if (
          activeConversationIdRef.current !== conversationId ||
          pendingAskLoadGenerationRef.current !== generation
        )
          return;
        setPendingAsk(undefined);
      });
  }, [conversation.id, threadId]);
  useEffect(() => {
    // 会话切换 / 刷新恢复：始终查询一次当前挂起问询。
    refreshPendingAsk();
    // 问询生命周期事件（pending/answered/cancelled）后刷新；eventHistory 是
    // 全局的，必须按 threadId 过滤，避免其他会话的问询事件触发本会话刷新。
    const askEvents = eventHistory
      .filter((e) => {
        if (
          e.type !== 'conversation.ask_pending' &&
          e.type !== 'conversation.ask_answered' &&
          e.type !== 'conversation.ask_cancelled'
        ) {
          return false;
        }
        return Boolean(threadId) && e.payload?.threadId === threadId;
      })
      .map((e) => e.sequence);
    const latest = askEvents.length > 0 ? Math.max(...askEvents) : 0;
    if (latest > lastAskEventSeqRef.current) {
      lastAskEventSeqRef.current = latest;
      refreshPendingAsk();
    }
  }, [eventHistory, refreshPendingAsk]);
  // §12.18 统一方案卡：conversation.plan.*（submit/get/approve/revise/cancel）驱动。
  // 模型仍以 ask plan-review 提交方案 → 前端把 detail 宽松解析为结构化草稿并
  // submit，渲染可编辑/可审批的 PlanApprovalCard；中途普通问询保持 ask 卡。
  const [conversationPlan, setConversationPlan] = useState<ConversationPlanSummary | undefined>();
  // A previous conversation can still be present during the navigation render;
  // never expose that stale aggregate through the current composer.
  const activeConversationPlan =
    conversationPlan && String(conversationPlan.conversationId) === String(conversation.id)
      ? conversationPlan
      : undefined;
  const lastPlanEventSeqRef = useRef(0);
  const conversationPlanLoadGenerationRef = useRef(0);
  const planReviewAskIdRef = useRef<string | null>(null);
  useEffect(() => {
    planReviewAskIdRef.current = null;
  }, [conversation.id]);
  const refreshConversationPlan = useCallback(() => {
    const api = bridge();
    const conversationId = String(conversation.id);
    const generation = (conversationPlanLoadGenerationRef.current += 1);
    if (!api?.conversationPlanGet) {
      setConversationPlan(undefined);
      return;
    }
    void api
      .conversationPlanGet({ conversationId: conversation.id })
      .then((res) => {
        if (
          activeConversationIdRef.current !== conversationId ||
          conversationPlanLoadGenerationRef.current !== generation
        )
          return;
        setConversationPlan(res.plan);
      })
      .catch(() => {
        if (
          activeConversationIdRef.current !== conversationId ||
          conversationPlanLoadGenerationRef.current !== generation
        )
          return;
        setConversationPlan(undefined);
      });
  }, [conversation.id]);
  useEffect(() => {
    refreshConversationPlan();
    // plan 生命周期事件（submitted/approved/cancelled/revised）后刷新。
    const planEvents = eventHistory.filter(
      (e) =>
        e.type === 'conversation.plan_submitted' ||
        e.type === 'conversation.plan_approved' ||
        e.type === 'conversation.plan_cancelled' ||
        e.type === 'conversation.plan_revised',
    );
    const latest = planEvents.length > 0 ? Math.max(...planEvents.map((e) => e.sequence)) : 0;
    if (latest > lastPlanEventSeqRef.current) {
      lastPlanEventSeqRef.current = latest;
      refreshConversationPlan();
    }
  }, [eventHistory, refreshConversationPlan]);
  // 方案卡进入 draft 时滚到底部——方案直接输出在消息流尾部，让用户看到整卡。
  useEffect(() => {
    if (activeConversationPlan?.state !== 'draft') return;
    const frame = requestAnimationFrame(() => {
      const scroller = messagesScrollRef.current;
      if (scroller) {
        if (typeof scroller.scrollTo === 'function') {
          scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
        } else {
          scroller.scrollTop = scroller.scrollHeight;
        }
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [activeConversationPlan?.state]);
  // plan-review 问询到达 → 解析 detail 并提交为 plan 草稿（按 askId 幂等）；
  // 提交失败（detail 无法满足校验）回退到只读方案卡。
  useEffect(() => {
    if (!pendingAsk) return;
    const review = planReviewOf(pendingAsk.questions);
    if (!review) return;
    if (planReviewAskIdRef.current === pendingAsk.askId) return;
    const api = bridge();
    if (!api?.conversationPlanSubmit) return;
    void api
      .conversationPlanSubmit({
        conversationId: conversation.id,
        plan: parsePlanReviewDetail(review.question, review.plan),
      })
      .then((res) => {
        if (activeConversationIdRef.current !== String(conversation.id)) return;
        // 提交成功才标记「已由方案卡接管」——失败回退到只读方案卡时，
        // ask_answered 事件路径仍须生效（executeApprovedPlanReview 不被跳过）。
        planReviewAskIdRef.current = pendingAsk.askId;
        setConversationPlan(res.plan);
      })
      .catch(() => {
        // 提交失败 → 保持 ask 卡（PlanReviewCard 只读形态）由用户走原确认流程。
      });
  }, [conversation.id, pendingAsk]);
  // plan-review 确认执行：结束规划轮，切执行模式并发起执行轮（actModelId + 全工具）。
  // 定义在 sendUserText 之后（见 sendUserText 定义处下方的 executeApprovedPlanReview）。
  // plan-act（规划/执行双模型）设置：用于提示本轮生效模型。
  const [planActSetting, setPlanActSetting] = useState<ComposerPlanActSetting | null>(null);
  useEffect(() => {
    let cancelled = false;
    const api = bridge();
    if (!api?.getSettings) return;
    void api
      .getSettings({ keys: ['plan-act'] })
      .then((res) => {
        if (cancelled) return;
        setPlanActSetting(parseComposerPlanActSetting(res.settings?.['plan-act']));
      })
      .catch(() => setPlanActSetting(null));
    return () => {
      cancelled = true;
    };
  }, [conversation.id]);
  const [goalState, setGoalState] = useState<
    import('@sync-think/protocol').GoalGetResponse | undefined
  >();
  const activeGoalState =
    goalState?.goal && String(goalState.goal.conversationId) === String(conversation.id)
      ? goalState
      : undefined;
  const goalLoadGenerationRef = useRef(0);
  const scopedStateConversationIdRef = useRef(String(conversation.id));
  useLayoutEffect(() => {
    const conversationId = String(conversation.id);
    if (scopedStateConversationIdRef.current === conversationId) return;
    scopedStateConversationIdRef.current = conversationId;
    pendingAskLoadGenerationRef.current += 1;
    conversationPlanLoadGenerationRef.current += 1;
    goalLoadGenerationRef.current += 1;
    setPendingAsk(undefined);
    setConversationPlan(undefined);
    setGoalState(undefined);
    setThreadId(undefined);
  }, [conversation.id]);
  const [goalSettingsOpen, setGoalSettingsOpen] = useState(false);
  const [goalSettingsSubmitting, setGoalSettingsSubmitting] = useState(false);
  const [goalSettingsMode, setGoalSettingsMode] = useState<'create' | 'edit'>('create');
  const [pendingRiskGoal, setPendingRiskGoal] = useState<string | null>(null);
  const [riskGoalSubmitting, setRiskGoalSubmitting] = useState(false);
  const riskGoalSubmissionRef = useRef(false);
  const [goalSettingsInitial, setGoalSettingsInitial] = useState<
    Partial<GoalSettingsValues> | undefined
  >();
  const refreshGoal = useCallback(async (): Promise<boolean> => {
    const api = bridge();
    const conversationId = String(conversation.id);
    const generation = (goalLoadGenerationRef.current += 1);
    if (!api?.getGoal) {
      setGoalState(undefined);
      return true;
    }
    try {
      const response = await api.getGoal({ conversationId });
      if (
        activeConversationIdRef.current !== conversationId ||
        goalLoadGenerationRef.current !== generation
      )
        return true;
      setGoalState(response);
      return true;
    } catch {
      if (
        activeConversationIdRef.current !== conversationId ||
        goalLoadGenerationRef.current !== generation
      )
        return false;
      setGoalState(undefined);
      return false;
    }
  }, [conversation.id]);
  // Active goals are evaluated after each run, so keep round/status feedback live.
  useVisiblePolling(refreshGoal, {
    intervalMs: activeGoalState?.goal?.status === 'active' ? 2_000 : 30_000,
    refreshKey: conversation.id,
  });
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(
    (conversation.executionMode as PermissionMode) || 'full-access',
  );
  const [agentPreferences, setAgentPreferences] = useState<AgentPreferences>(() =>
    readAgentPreferences(),
  );
  // Restore the conversation's own reasoning effort across switches/restarts;
  // each conversation keeps its chosen thinking intensity until changed again.
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(
    () =>
      readConversationReasoningEffort(String(conversation.id)) ??
      readAgentPreferences().thinkingBudget,
  );
  useEffect(() => {
    const syncAgentPreferences = () => {
      const next = readAgentPreferences();
      setAgentPreferences(next);
      if (readConversationReasoningEffort(String(conversation.id)) === undefined) {
        setReasoningEffort(next.thinkingBudget);
      }
    };
    window.addEventListener(AGENT_PREFERENCES_CHANGED_EVENT, syncAgentPreferences);
    return () => window.removeEventListener(AGENT_PREFERENCES_CHANGED_EVENT, syncAgentPreferences);
  }, [conversation.id]);
  // Restore last explicit model pick for this conversation across restarts.
  const [modelOverride, setModelOverride] = useState<string>(
    () => readConversationModelOverride(String(conversation.id)) ?? '',
  );
  const [retryAfterModelPickMessageId, setRetryAfterModelPickMessageId] = useState<string>();
  // Multi-kernel selector: per-conversation kernel id (default = native).
  const [kernelOverride, setKernelOverride] = useState<string>(
    () => readConversationKernelOverride(String(conversation.id)) ?? 'native',
  );
  // Kernel registry sweep for the selector (cached per conversation view).
  const [kernelRegistry, setKernelRegistry] = useState<KernelDetectionResult[] | null>(null);
  const [kernelInstallStates, setKernelInstallStates] = useState<
    Record<string, KernelInstallState | undefined>
  >({});
  const kernelInstallPromisesRef = useRef(new Map<string, Promise<void>>());
  const kernelDetectionGenerationRef = useRef(0);
  const kernelInstallMountedRef = useRef(true);
  useEffect(() => {
    kernelInstallMountedRef.current = true;
    return () => {
      kernelInstallMountedRef.current = false;
    };
  }, []);
  const [netEnabled, setNetEnabled] = useState(
    () => readConversationNetworkEnabled(String(conversation.id)) ?? true,
  );
  /** Optimistic user bubbles not yet present in durable event history. */
  const [pendingUserMessages, setPendingUserMessages] = useState<ChatMessage[]>([]);
  const localErrorsRef = useRef<ChatMessage[]>([]);
  // Transient diagnostics used to render as chat bubbles. They now go to the
  // NewMax top-right toast host so they no longer interleave with the thread.
  const setLocalErrors = useCallback((updater: SetStateAction<ChatMessage[]>) => {
    const previous = localErrorsRef.current;
    const next = typeof updater === 'function' ? updater(previous) : updater;
    const capped =
      next.length > MAX_LOCAL_ERRORS ? next.slice(next.length - MAX_LOCAL_ERRORS) : next;
    const nextIds = new Set(capped.map((item) => item.id));
    for (const item of previous) {
      if (!nextIds.has(item.id)) toastApi.dismiss(item.id);
    }
    localErrorsRef.current = capped;
    for (const item of capped) {
      toastApi.toast({
        id: item.id,
        type: toastTypeFromTone(item.tone),
        title: item.text,
      });
    }
  }, []);
  /** Paginated message store state. */
  const historyScopeKey = JSON.stringify([conversation.id, conversation.taskId ?? null]);
  const historyScopeRef = useRef({ key: historyScopeKey });
  if (historyScopeRef.current.key !== historyScopeKey)
    historyScopeRef.current = { key: historyScopeKey };
  const initialCachedPage = readUsableRecentConversationPage(historyScopeKey);
  const [storedLoadedMessages, setLoadedMessages] = useState<ChatMessage[]>(
    () => initialCachedPage?.messages ?? [],
  );
  const [loadedMessagesScopeKey, setLoadedMessagesScopeKey] = useState(historyScopeKey);
  // Scope the page before deriving render windows, navigation, or source reads.
  // The layout-effect reset alone is too late to prevent child read effects.
  const loadedMessages = useMemo(
    () => (loadedMessagesScopeKey === historyScopeKey ? storedLoadedMessages : []),
    [historyScopeKey, loadedMessagesScopeKey, storedLoadedMessages],
  );
  const loadedMessagesRef = useRef(loadedMessages);
  loadedMessagesRef.current = loadedMessages;
  const [historyRanges, setHistoryRanges] = useState<HistoryRange[]>(
    () => initialCachedPage?.ranges ?? [],
  );
  const historyRangesRef = useRef(historyRanges);
  const [renderWindowTargetId, setRenderWindowTargetId] = useState<string>();
  const navigationDirectory = useConversationNavigation(
    String(conversation.id),
    Boolean(conversation.taskId),
    historyScopeKey,
  );
  const refreshNavigationDirectory = navigationDirectory.refresh;
  const [runProcessById, setRunProcessById] = useState<Map<string, RunProcessView>>(
    () => new Map(),
  );
  const {
    loader: runProcessLoader,
    failures: runProcessLoadFailures,
    retry: retryRunProcess,
  } = useRunProcessHistoryLoader(String(conversation.id), (process) => {
    setRunProcessById((previous) => updateRunProcessMap(previous, process));
  });
  const loadedMessagesConversationIdRef = useRef<string | undefined>(undefined);
  /** 当前 durable 列表的条数（供「要不要补拉」判断读取最新值，不进依赖）。 */
  const loadedMessagesCountRef = useRef(0);
  const loadedMessagesScopeKeyRef = useRef(historyScopeKey);
  /** 首屏/补拉是否在飞行中，避免同一瞬间重复发请求。 */
  const messageLoadInFlightScopeRef = useRef<string | null>(null);
  /** 已处理过的「重新同步键」，保证每个触发点只发一次物理请求。 */
  const messageResyncKeyRef = useRef('');
  /** 每次 active false→true 自增一次，作为重新同步键的一部分。 */
  const activeNonceRef = useRef(0);
  const wasActiveForResyncRef = useRef(active);
  if (active && !wasActiveForResyncRef.current) activeNonceRef.current += 1;
  wasActiveForResyncRef.current = active;
  const historyScopeChangedForLoad = loadedMessagesScopeKeyRef.current !== historyScopeKey;
  if (historyScopeChangedForLoad) loadedMessagesScopeKeyRef.current = historyScopeKey;
  loadedMessagesCountRef.current = historyScopeChangedForLoad ? 0 : loadedMessages.length;
  /**
   * 首屏/补拉失败的自动重试计数（成功即清零）。
   * 失败本身不弹提示（对齐 NewMax 的静默），但也不能就此永久空白。
   */
  const messageReloadAttemptRef = useRef(0);
  const updateRunProcess = useCallback(
    (process: RunProcessView | null | undefined) => {
      if (process) runProcessLoader.accept(String(process.runId));
      setRunProcessById((previous) => updateRunProcessMap(previous, process));
    },
    [runProcessLoader],
  );
  const [hasMore, setHasMore] = useState(() => initialCachedPage?.hasMore ?? false);
  const [nextCursor, setNextCursor] = useState<number | undefined>(
    () => initialCachedPage?.nextCursor,
  );
  const [loadingMore, setLoadingMore] = useState(false);
  /** Whether the initial page load has completed (success or failure). */
  const [initialLoaded, setInitialLoaded] = useState(Boolean(initialCachedPage));
  const [durableTaskPlan, setDurableTaskPlan] = useState<{
    conversationId: string;
    state: NonNullable<ConversationListMessagesResponse['taskPlan']>;
  }>();
  /** Runtime-owned snapshot used by the ring and compact threshold. */
  const [contextStatus, setContextStatus] = useState<ConversationGetContextStatusResponse | null>(
    null,
  );
  const contextStatusRef = useRef<ConversationGetContextStatusResponse | null>(null);
  contextStatusRef.current = contextStatus;
  const contextStatusLoadGenerationRef = useRef(0);
  /** Durable Task-wide provider usage; null means the event projection is the fallback. */
  const [durableUsageSummary, setDurableUsageSummary] = useState<UsageSummaryResponse | null>(null);
  const usageSummaryLoadGenerationRef = useRef(0);
  /** Streaming message accumulated from the transient stream (durable delta is fallback only). */
  const [streamingMessage, setStreamingMessage] = useState<ChatMessage | null>(null);
  const transientDraftRef = useRef<ConversationStreamDraft | null>(null);
  const transientFrameQueueRef = useRef<ConversationDisplayQueueItem[]>([]);
  const transientFrameFlushRef = useRef<number | null>(null);
  const transientTerminalEffectsRef = useRef<(runId: string) => void>(() => undefined);
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
  /** Guards against processing events with a stale threadId after switching chats. */
  const threadConversationIdRef = useRef<string | undefined>(undefined);
  /** Invalidates in-flight durable message reads after a refresh or conversation switch. */
  const messageLoadGenerationRef = useRef(0);
  const renderTransientDraft = useCallback(
    (draft: ConversationStreamDraft | null, fallbackSequence: number) => {
      transientDraftRef.current = draft;
      const projected = draft
        ? projectTransientAssistantDisplay(draft.text, draft.assistantTimeline)
        : {
            answerText: undefined as string | undefined,
            pendingText: '',
            processItems: undefined,
          };
      const streamedAnswer = visibleStreamingAnswerText(projected);
      const visibleAnswer = streamedAnswer.trim() ? streamedAnswer : undefined;
      setStreamingMessage(
        draft
          ? {
              id: `streaming-${draft.runId ?? fallbackSequence}`,
              role: 'assistant',
              text: visibleAnswer ?? '',
              commentaryText: projected.commentaryText ?? draft.commentaryText,
              commentarySegments: draft.assistantTimeline ? undefined : draft.commentarySegments,
              reasoningText: projected.reasoningText ?? draft.reasoningText,
              assistantTimeline: draft.assistantTimeline,
              delegatedAgents: draft.delegatedAgents,
              answerText: visibleAnswer,
              processItems: projected.processItems,
              timestamp: draft.timestamp,
              streaming: !draft.terminal,
              runId: draft.runId,
              ...(draft.terminalState && draft.terminalState !== 'completed'
                ? { terminalState: draft.terminalState }
                : {}),
              ...(draft.terminalError ? { terminalError: draft.terminalError } : {}),
            }
          : null,
      );
    },
    [],
  );
  const flushTransientFrames = useCallback(() => {
    transientFrameFlushRef.current = null;
    const queued = transientFrameQueueRef.current;
    if (!threadId || queued.length === 0) return;
    let nextDraft = transientDraftRef.current;
    const batch = takeConversationDisplayQueueBatch(
      queued,
      getConversationDisplayQueueBatchOptions(queued),
    );
    queued.splice(0, queued.length, ...batch.remaining);
    nextDraft = applyConversationStreamOperations(nextDraft, batch.operations);
    for (const item of batch.completed) {
      if (item.source === 'snapshot') {
        nextDraft = mergeTransientConversationDraft(nextDraft, item.draft);
        lastTransientSequenceRef.current = Math.max(
          lastTransientSequenceRef.current,
          item.streamSequence,
        );
        if (item.process) updateRunProcess(item.process);
        if (item.refreshDurable) {
          transientTerminalEffectsRef.current(String(item.draft?.runId ?? ''));
        }
        continue;
      }
      if (item.source === 'durable') {
        if (item.operation.type === 'run.terminal') {
          transientTerminalEffectsRef.current(String(item.operation.runId ?? ''));
        }
        continue;
      }

      const frame = item.frame;
      lastTransientSequenceRef.current = Math.max(
        lastTransientSequenceRef.current,
        frame.streamSequence,
      );
      if (frame.process) {
        updateRunProcess(frame.process);
      } else if (frame.kind === 'terminal') {
        runProcessLoader.invalidate(String(frame.runId));
        setRunProcessById((previous) => {
          if (!previous.has(frame.runId)) return previous;
          const updated = new Map(previous);
          updated.delete(frame.runId);
          return updated;
        });
      }
      if (frame.kind === 'terminal') {
        transientTerminalEffectsRef.current(String(frame.runId));
      }
    }
    renderTransientDraft(nextDraft, lastTransientSequenceRef.current);

    if (queued.length > 0 && transientFrameFlushRef.current === null) {
      transientFrameFlushRef.current = window.setTimeout(
        flushTransientFrames,
        getConversationDisplayQueueFlushDelay(queued),
      );
    }
  }, [renderTransientDraft, runProcessLoader, threadId, updateRunProcess]);
  const scheduleTransientFrameFlush = useCallback(
    (publication: 'animation-frame' | 'immediate' = 'animation-frame') => {
      if (publication === 'immediate') {
        if (transientFrameFlushRef.current !== null) {
          window.clearTimeout(transientFrameFlushRef.current);
          transientFrameFlushRef.current = null;
        }
        flushTransientFrames();
        return;
      }
      if (transientFrameFlushRef.current === null) {
        const queued = transientFrameQueueRef.current;
        transientFrameFlushRef.current = window.setTimeout(
          flushTransientFrames,
          getConversationDisplayQueueFlushDelay(queued),
        );
      }
    },
    [flushTransientFrames],
  );
  const clearTransientDisplayQueue = useCallback(() => {
    transientFrameQueueRef.current.length = 0;
    if (transientFrameFlushRef.current !== null) {
      window.clearTimeout(transientFrameFlushRef.current);
      transientFrameFlushRef.current = null;
    }
  }, []);
  /** Active / slash-command query (null = menu closed). Mutually exclusive with @. */
  const [slash, setSlash] = useState<SlashQuery | null>(null);
  const [slashIndex, setSlashIndex] = useState(-1);
  const [slashSkills, setSlashSkills] = useState<SkillVersionSummary[]>([]);
  const [slashSkillsLoading, setSlashSkillsLoading] = useState(false);
  const [slashSkillsResolved, setSlashSkillsResolved] = useState(false);
  const [slashCategory, setSlashCategory] = useState<ComposerSkillCategory>('all');
  const [availableSlashCategories, setAvailableSlashCategories] = useState<
    readonly ComposerSkillCategory[]
  >(['all']);
  const [resolvedSlashItems, setResolvedSlashItems] = useState<
    readonly ComposerSlashMenuResolvedItem[]
  >([]);
  const [mcpMenuOpen, setMcpMenuOpen] = useState(false);
  const [composerAddOpen, setComposerAddOpen] = useState(false);
  const [mcpMenuStyle, setMcpMenuStyle] = useState<React.CSSProperties | null>(null);
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
  const [menu, setMenu] = useState<'permission' | 'skill' | 'model' | 'identity' | null>(null);
  const composerToolbar = useComposerToolbarCollapse({
    permissionMenuOpen: menu === 'permission',
    onPermissionMenuOpenChange: (open) => setMenu(open ? 'permission' : null),
  });
  /** Shared image gallery for message attachments and composer previews. */
  const [lightbox, setLightbox] = useState<{
    images: MessageImage[];
    activeIndex: number;
  } | null>(null);
  const openImageLightbox = useCallback((image: MessageImage, group?: readonly MessageImage[]) => {
    const images = (group && group.length > 0 ? [...group] : [image]).filter((candidate) =>
      Boolean(candidate.url),
    );
    const activeIndex = Math.max(
      0,
      images.findIndex((candidate) => candidate.id === image.id),
    );
    setLightbox({ images, activeIndex });
  }, []);
  const [dragOver, setDragOver] = useState(false);
  /** Live tick so compact capsule can show elapsed seconds. */
  const [compactNow, setCompactNow] = useState(() => Date.now());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const messagesContentRef = useRef<HTMLDivElement>(null);
  /** Prevent duplicate history-page requests while a top-edge load is pending. */
  const loadingMoreRef = useRef(false);
  const previousHistoryScopeRef = useRef(historyScopeKey);
  useLayoutEffect(() => {
    if (previousHistoryScopeRef.current === historyScopeKey) return;
    previousHistoryScopeRef.current = historyScopeKey;
    const cachedPage = readRecentConversationPage(historyScopeKey);
    setLoadedMessages(cachedPage?.messages ?? []);
    setLoadedMessagesScopeKey(historyScopeKey);
    historyRangesRef.current = cachedPage?.ranges ?? [];
    setHistoryRanges(historyRangesRef.current);
    setHasMore(cachedPage?.hasMore ?? false);
    setNextCursor(cachedPage?.nextCursor);
    setLoadingMore(false);
    loadingMoreRef.current = false;
    setRenderWindowTargetId(undefined);
    setInitialLoaded(Boolean(readUsableRecentConversationPage(historyScopeRef.current.key)));
    setDurableTaskPlan(undefined);
    loadedMessagesConversationIdRef.current = undefined;
    messageLoadGenerationRef.current += 1;
  }, [historyScopeKey]);
  /** Invalidates an async prepend anchor when the user keeps scrolling meanwhile. */
  const userScrollRevisionRef = useRef(0);
  /** Distinguishes native/user scroll direction, including scrollbar dragging. */
  const lastObservedScrollTopRef = useRef(0);
  /** Prevents our own one-shot scroll corrections from being treated as user input. */
  const programmaticScrollTargetRef = useRef<number | null>(null);
  /** NewMax markProgrammaticScroll: layout/html/mermaid writes must not unpin. */
  const programmaticScrollPendingRef = useRef(false);
  /** Restores a saved position once the current conversation has rendered. */
  const restoredScrollPositionRef = useRef<string | null>(null);
  /** Coalesces high-frequency scroll writes into one local snapshot per frame. */
  const scrollPositionWriteFrameRef = useRef<number | null>(null);
  const stickToBottomRef = useRef(true);
  /** Floating "jump to latest" affordance; shown only once the reader is away. */
  const [jumpToLatestVisible, setJumpToLatestVisible] = useState(false);
  /** Assistant output landed while the reader was away from the tail. */
  const [jumpToLatestUnread, setJumpToLatestUnread] = useState(false);
  /** Last explicit scroll direction; layout-driven scroll events leave it null. */
  const bottomPinIntentRef = useRef<'toward-bottom' | 'away-from-bottom' | null>(null);
  const lastTouchClientYRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { failedComposeDrafts, sendDraft, restoreFailedDrafts } = useComposeDraftRecovery({
    scope: JSON.stringify([conversation.workspaceId ?? '', String(conversation.id)]),
    inputRef,
    setInput,
    setAttachments,
  });
  const inputValueRef = useRef(input);
  inputValueRef.current = input;
  const speechRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const suppressPickerRefreshRef = useRef(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const composeRef = useRef<HTMLDivElement>(null);
  const slashListRef = useRef<HTMLDivElement>(null);
  const lastSlashQueryRef = useRef('');
  if (slash) lastSlashQueryRef.current = slash.query;
  const permissionBtnRef = useRef<HTMLButtonElement>(null);
  const modelBtnRef = useRef<HTMLButtonElement>(null);
  const identityBtnRef = useRef<HTMLButtonElement>(null);
  const [slashPopStyle, setSlashPopStyle] = useState<React.CSSProperties | null>(null);
  useEffect(() => {
    if (initialSkillVersionIds !== undefined) {
      onInitialSkillSelectionConsumed?.(String(conversation.id));
    }
  }, [conversation.id, initialSkillVersionIds, onInitialSkillSelectionConsumed]);

  useEffect(() => {
    if (skillSelectionScopeKeyRef.current === skillSelectionScopeKey) return;
    skillSelectionScopeKeyRef.current = skillSelectionScopeKey;
    setSelectedSkillVersionIds([]);
    setMenu(null);
  }, [skillSelectionScopeKey]);

  // Reset local compose state when switching conversations.
  useEffect(() => {
    userScrollRevisionRef.current = 0;
    lastObservedScrollTopRef.current = 0;
    programmaticScrollTargetRef.current = null;
    programmaticScrollPendingRef.current = false;
    restoredScrollPositionRef.current = null;
    setInput('');
    setDismissedModeHintText(null);
    setPendingRiskGoal(null);
    setRiskGoalSubmitting(false);
    riskGoalSubmissionRef.current = false;
    setSending(false);
    setSendingRunId(undefined);
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
    const cachedPage = readRecentConversationPage(historyScopeRef.current.key);
    setLoadedMessages(cachedPage?.messages ?? []);
    historyRangesRef.current = cachedPage?.ranges ?? [];
    setHistoryRanges(historyRangesRef.current);
    setDurableTaskPlan(undefined);
    setRunProcessById(new Map());
    runProcessLoader.suspend();
    loadedMessagesConversationIdRef.current = undefined;
    setHasMore(cachedPage?.hasMore ?? false);
    setNextCursor(cachedPage?.nextCursor);
    setLoadingMore(false);
    loadingMoreRef.current = false;
    setInitialLoaded(Boolean(readUsableRecentConversationPage(historyScopeRef.current.key)));
    contextStatusLoadGenerationRef.current += 1;
    setContextStatus(null);
    usageSummaryLoadGenerationRef.current += 1;
    setDurableUsageSummary(null);
    transientDraftRef.current = null;
    clearTransientDisplayQueue();
    setStreamingMessage(null);
    lastConsumedEventSequenceRef.current = 0;
    lastTransientSequenceRef.current = 0;
    transientStreamHealthyRef.current = false;
    transientFallbackOnlyRef.current = false;
    threadConversationIdRef.current = undefined;
    messageLoadGenerationRef.current += 1;
    setComposerAddOpen(false);
    setSlash(null);
    setSlashIndex(-1);
    setSlashCategory('all');
    setResolvedSlashItems([]);
    setSlashPopStyle(null);
    setMcpMenuOpen(false);
    setMcpMenuStyle(null);
    setAttachments([]);
    setMenu(null);
    setPermissionMode((conversation.executionMode as PermissionMode) || 'full-access');
    setModelOverride(readConversationModelOverride(String(conversation.id)) ?? '');
    setRetryAfterModelPickMessageId(undefined);
    setKernelOverride(readConversationKernelOverride(String(conversation.id)) ?? 'native');
    setReasoningEffort(
      readConversationReasoningEffort(String(conversation.id)) ??
        readAgentPreferences().thinkingBudget,
    );
    setNetEnabled(readConversationNetworkEnabled(String(conversation.id)) ?? true);
    // A saved position is restored after the current message page is mounted.
    // New conversations without a snapshot retain the default bottom pin.
    const savedScrollPosition = readConversationScrollPosition(historyScopeRef.current.key);
    stickToBottomRef.current = savedScrollPosition?.stickToBottom ?? true;
    bottomPinIntentRef.current = null;
    lastTouchClientYRef.current = null;
    // 注意：不能把 conversation.executionMode 放进依赖——权限切换会经
    // onConversationUpdated → refresh 更新该字段，导致此「切换对话」重置
    // effect 被误触发：消息被清空而 loadMessages 不重跑，聊天区永远停在
    // 「加载中…」。权限模式由 setPermission 自行同步，这里只需跟随 id。
  }, [clearTransientDisplayQueue, conversation.id, runProcessLoader]);

  // A provider can be disabled while a conversation still has its old local
  // override. Repair that hidden stale selection as soon as the available
  // catalog arrives, so the picker, sidebar and next append all agree.
  useEffect(() => {
    const current = modelOverride.trim();
    if (!current || models.length === 0 || models.some((model) => model.modelId === current)) {
      return;
    }
    const fallback = models[0]!;
    setModelOverride(fallback.modelId);
    writeConversationModelOverride(String(conversation.id), fallback.modelId);
    setLocalErrors((previous) => [
      ...previous.filter((message) => message.id !== `model-repaired-${conversation.id}`),
      {
        id: `model-repaired-${conversation.id}`,
        role: 'system',
        tone: 'warning',
        text: `原模型已停用或删除，已切换到 ${fallback.displayName}`,
        timestamp: new Date().toISOString(),
      },
    ]);
    onConversationUpdated?.();
  }, [conversation.id, modelOverride, models, onConversationUpdated, setLocalErrors]);

  // Seeded composer text (活动中心“重新编辑”). Declared *after* the conversation
  // reset effect above so the seed survives: effects run in declaration order,
  // and that one clears `input` when the chat is (re)mounted.
  useEffect(() => {
    const seed = seedComposerText?.trim();
    if (!seed) return;
    onSeedComposerTextConsumed?.(String(conversation.id));
    setInput((current) =>
      // Never clobber something the user already typed — append instead.
      current.trim() ? `${current.replace(/\s+$/, '')}\n${seed}` : seed,
    );
    window.requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      // `resizeComposeInput` is declared further down this component, so it is
      // in its TDZ here; the shared helper it wraps is a module import.
      computeTextareaHeight(el, 36, 200);
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, [conversation.id, onSeedComposerTextConsumed, seedComposerText]);

  const detectKernels = useCallback(async (): Promise<KernelDetectionResult[] | null> => {
    const api = bridge();
    if (!api?.detectKernels) return null;
    const generation = (kernelDetectionGenerationRef.current += 1);
    try {
      const response = await api.detectKernels();
      if (Array.isArray(response?.kernels)) {
        if (
          kernelInstallMountedRef.current &&
          generation === kernelDetectionGenerationRef.current
        ) {
          setKernelRegistry(response.kernels);
        }
        return response.kernels;
      }
    } catch {
      if (kernelInstallMountedRef.current && generation === kernelDetectionGenerationRef.current) {
        setKernelRegistry(null);
      }
    }
    return null;
  }, []);

  // Kernel registry sweep for the selector. Probe once per conversation view;
  // failures degrade to an empty list (the kernel group hides).
  useEffect(() => {
    setKernelRegistry(null);
    void detectKernels();
  }, [conversation.id, detectKernels]);

  const handleManagedKernelSnapshot = useCallback(
    (snapshot: Parameters<typeof applyManagedKernelSnapshotToInstallStates>[1]) => {
      setKernelInstallStates((current) =>
        applyManagedKernelSnapshotToInstallStates(current, snapshot),
      );
      void detectKernels();
    },
    [detectKernels],
  );
  useManagedKernelUpdateSync(handleManagedKernelSnapshot);

  const installKernel = useCallback(
    (kernelId: string) => {
      const existing = kernelInstallPromisesRef.current.get(kernelId);
      if (existing) return existing;
      const api = bridge();
      if (!api?.installKernel) {
        setKernelInstallStates((current) => ({
          ...current,
          [kernelId]: { status: 'error', error: '当前桌面版本不支持内核安装' },
        }));
        return Promise.resolve();
      }

      const installPromise = (async () => {
        setKernelInstallStates((current) => ({
          ...current,
          [kernelId]: { status: 'installing' },
        }));
        try {
          const result = await api.installKernel(kernelId);
          if (!result.ok) {
            throw new Error(result.error || '安装命令执行失败');
          }
          if (!kernelInstallMountedRef.current) return;
          setKernelInstallStates((current) => ({
            ...current,
            [kernelId]: { status: 'verifying' },
          }));
          const detected = await detectKernels();
          if (!detected?.some((kernel) => kernel.kernelId === kernelId && kernel.installed)) {
            throw new Error('安装完成，但仍未检测到内核');
          }
          if (!kernelInstallMountedRef.current) return;
          setKernelInstallStates((current) => ({
            ...current,
            [kernelId]: { status: 'success' },
          }));
        } catch (error) {
          if (!kernelInstallMountedRef.current) return;
          const message = error instanceof Error ? error.message : String(error);
          setKernelInstallStates((current) => ({
            ...current,
            [kernelId]: { status: 'error', error: message || '未知错误' },
          }));
        } finally {
          kernelInstallPromisesRef.current.delete(kernelId);
        }
      })();
      kernelInstallPromisesRef.current.set(kernelId, installPromise);
      return installPromise;
    },
    [detectKernels],
  );

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

  const loadMessages = useCallback(
    async (
      cursor?: number,
      options?: {
        aroundMessageId?: string;
        accept?: () => boolean;
        revealLoadedPage?: boolean;
      },
    ): Promise<boolean> => {
      const latest = cursor === undefined && !options?.aroundMessageId;
      const api = bridge();
      if (!api?.listConversationMessages) {
        if (latest) setInitialLoaded(true);
        return false;
      }
      const conversationId = String(conversation.id);
      const scope = historyScopeRef.current;
      if (scope.key !== historyScopeKey) return false;
      if (latest) messageLoadInFlightScopeRef.current = historyScopeKey;
      const generation = latest
        ? ++messageLoadGenerationRef.current
        : messageLoadGenerationRef.current;
      if (cursor !== undefined) {
        if (loadingMoreRef.current) return false;
        loadingMoreRef.current = true;
        setLoadingMore(true);
      }
      const current = () =>
        scope === historyScopeRef.current &&
        (!latest || generation === messageLoadGenerationRef.current);
      try {
        const res: ConversationListMessagesResponse = await api.listConversationMessages({
          conversationId: conversation.id,
          beforeSequence: cursor,
          ...(options?.aroundMessageId
            ? { aroundMessageId: options.aroundMessageId as MessageId }
            : {}),
          limit: 50,
        });
        if (!current() || options?.accept?.() === false) {
          return false;
        }
        loadedMessagesConversationIdRef.current = conversationId;
        messageReloadAttemptRef.current = 0;
        if (latest && res.taskPlan) {
          setDurableTaskPlan({ conversationId, state: res.taskPlan });
        }
        const converted = res.messages.map(messageToChat).filter(shouldDisplayChatMessage);
        if (options?.revealLoadedPage && converted[0]) {
          setRenderWindowTargetId(converted[0].id);
        }
        const durableAssistantRunIds = converted
          .filter((message) => message.role === 'assistant' && Boolean(message.runId))
          .map((message) => message.runId as string);
        const reconciledDraft = reconcileTransientConversationDraft(
          transientDraftRef.current,
          durableAssistantRunIds,
        );
        if (reconciledDraft !== transientDraftRef.current) {
          renderTransientDraft(reconciledDraft, lastTransientSequenceRef.current);
        }
        const sequences = res.messages.map((message) => message.sequence);
        const latestEnd = Math.max(...sequences);
        const previousRanges = latest
          ? res.hasMore
            ? historyRangesRef.current
                .filter((range) => range.start <= latestEnd)
                .map((range) => ({ ...range, end: Math.min(range.end, latestEnd) }))
            : []
          : historyRangesRef.current;
        const ranges = mergeHistoryRanges(
          previousRanges,
          {
            sequences: res.messages.map((message) => message.sequence),
            hasMore: res.hasMore,
          },
          cursor,
        );
        historyRangesRef.current = ranges;
        setHistoryRanges(ranges);
        const more = ranges.length ? ranges[0]!.start > 0 : res.hasMore;
        const next = more ? (ranges[0]?.start ?? res.nextCursor) : undefined;
        setLoadedMessages((previous) => {
          if (scope !== historyScopeRef.current) return previous;
          const merged = orderDurableMessagesForDisplay(
            mergeHistoryPageMessages(previous, converted, {
              sequences,
              hasMore: res.hasMore,
              latest,
            }),
          );
          cacheRecentConversationPage(scope.key, {
            messages: merged,
            ranges,
            hasMore: more,
            nextCursor: next,
          });
          return merged;
        });
        setHasMore(more);
        setNextCursor(next);
        if (latest) refreshNavigationDirectory();
        return true;
      } catch (error) {
        // NewMax conversations.get / getMessages failures only log; ChatView
        // keeps any already-rendered page and does not invent a retry banner.
        console.error('[ChatView] Failed to load messages:', error);
        // 但「静默」不等于「永久空白」：首屏这一次很可能只是 runtime 还没就绪
        // （窗口比 runtime 先起来）。走有界退避，成功即清零；保活之后实例不再重挂，
        // 没有这段补偿就会一直空着。
        if (latest) scheduleMessageResyncRetry();
        return false;
      } finally {
        if (latest && messageLoadInFlightScopeRef.current === historyScopeKey) {
          messageLoadInFlightScopeRef.current = null;
        }
        if (current()) {
          if (cursor !== undefined) {
            loadingMoreRef.current = false;
            setLoadingMore(false);
          } else if (latest) setInitialLoaded(true);
        }
      }
    },
    [conversation.id, historyScopeKey, refreshNavigationDirectory, renderTransientDraft],
  );

  const catalogContextWindow = models.find((model) => {
    const requestedModelId =
      modelOverride.trim() ||
      (conversation.track === 'model' ? String(conversation.targetRef ?? '').trim() : '');
    return requestedModelId !== '' && model.modelId === requestedModelId;
  })?.contextWindow;
  const refreshContextStatus = useCallback(async (): Promise<void> => {
    const api = bridge();
    if (!api?.getConversationContextStatus) return;
    const conversationId = String(conversation.id);
    const requestedModelId =
      modelOverride.trim() ||
      (conversation.track === 'model' ? String(conversation.targetRef ?? '').trim() : '');
    const generation = (contextStatusLoadGenerationRef.current += 1);
    try {
      const response = parseConversationGetContextStatusResponse(
        await api.getConversationContextStatus({
          conversationId: conversation.id,
          ...(requestedModelId ? { modelId: requestedModelId } : {}),
          ...(kernelOverride ? { kernelId: kernelOverride } : {}),
        }),
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
  }, [
    conversation.id,
    conversation.targetRef,
    conversation.track,
    kernelOverride,
    modelOverride,
    catalogContextWindow,
  ]);

  const refreshDurableUsageSummary = useCallback(async (): Promise<void> => {
    const api = bridge();
    const conversationId = String(conversation.id);
    const taskId = conversation.taskId ? String(conversation.taskId).trim() : '';
    const generation = (usageSummaryLoadGenerationRef.current += 1);
    if (!api?.getUsageSummary || !taskId) {
      if (
        activeConversationIdRef.current === conversationId &&
        usageSummaryLoadGenerationRef.current === generation
      ) {
        setDurableUsageSummary(null);
      }
      return;
    }
    try {
      const response = await api.getUsageSummary({ taskId, includeRequests: false });
      if (
        activeConversationIdRef.current === conversationId &&
        usageSummaryLoadGenerationRef.current === generation
      ) {
        setDurableUsageSummary(response);
      }
    } catch {
      if (
        activeConversationIdRef.current === conversationId &&
        usageSummaryLoadGenerationRef.current === generation
      ) {
        // A failed durable query falls back to the bounded in-memory event projection.
        setDurableUsageSummary(null);
      }
    }
  }, [conversation.id, conversation.taskId]);

  transientTerminalEffectsRef.current = () => {
    void loadMessages();
    void refreshContextStatus();
    void refreshDurableUsageSummary();
  };

  /**
   * durable 消息页的加载 / 重新同步（唯一入口）。
   *
   * 语义对齐 NewMax：**渲染读到的消息永远来自「当前真相」，激活即同步**。
   * NewMax 的消息在按会话索引的 store 里，天然如此；SYNC-THINK 的消息在组件
   * state + 一个模块级 LRU 缓存里，原来的写法是「挂载时拉一次，命中缓存就跳过」，
   * 在会话面保活之后这会把一次失败（或一次空结果）**永久固化**：库里明明有 6 条
   * 消息，界面一条都不显示，切走切回也不会再拉。
   *
   * 所以规则与 NewMax 一样分成两步：缓存有内容就直接首帧渲染；只要这个面重新
   * 激活，仍在后台读取一次最新页并合并。后台同步不清空当前 DOM、不闪骨架，旧响应
   * 继续由 scope/generation 丢弃。触发点是挂载、重新激活(active false→true)、
   * runtime 重连(connectionRevision)，以及首屏失败后的退避重试。
   */
  /**
   * 补拉的有界退避（成功即清零，见上面的重新同步 effect）。
   * 抛错与被判过期都走这里，避免「失败一次 = 永远空白」。
   */
  const scheduleMessageResyncRetry = useCallback(() => {
    const attempt = messageReloadAttemptRef.current + 1;
    messageReloadAttemptRef.current = attempt;
    if (attempt > MAX_MESSAGE_RELOAD_ATTEMPTS) return;
    window.setTimeout(
      () => {
        if (loadedMessagesCountRef.current > 0) return;
        // 只补消息本身：transient 包还会刷新 context / usage，那些会让不相干的
        // 请求计数（用量悬浮的「过期响应不得覆盖新会话」保护）多出一次调用。
        void loadMessages();
      },
      attempt === 1 ? 0 : 1_200 * attempt,
    );
  }, [loadMessages]);

  useEffect(() => {
    if (!active || !conversation.id) return;
    // 去重键 = 「哪个会话 + 哪个 scope + 第几次连接 + 第几次被激活」。
    // 没有它，任何一次无关的重渲染（loadMessages 的 identity 变化、effect 重放）
    // 都会在「列表还空着」时再发一次物理请求 —— 那正是 process-history 用例
    // 断言的「不得重复请求」。失败重试由 catch 里的退避负责，不靠重复触发。
    const resyncKey = `${conversation.id}|${historyScopeKey}|${runtimeConnectionRevision}|${activeNonceRef.current}`;
    if (messageResyncKeyRef.current === resyncKey) return;
    if (messageLoadInFlightScopeRef.current === historyScopeKey) return;
    const cached = readUsableRecentConversationPage(historyScopeKey);
    if (loadedMessagesCountRef.current === 0 && cached) {
      // 缓存里有内容：直接补水到 state（可能是本会话里另一个实例加载的），
      // 并标记 history-ready —— run-process 的历史加载与用量悬浮都依赖这个标记。
      loadedMessagesConversationIdRef.current = String(conversation.id);
      setLoadedMessages((previous) => (previous.length > 0 ? previous : cached.messages));
    }
    messageResyncKeyRef.current = resyncKey;
    void loadMessages().then((ok) => {
      if (ok) {
        messageReloadAttemptRef.current = 0;
        return;
      }
      // 没成功（抛错，或响应被判过期 —— 例如 effect 重放期间 generation 变了：
      // 那一次响应会被丢弃，界面依旧空白）。解除去重键并立刻补一次，
      // 仍然有界，不会变成请求风暴。
      if (messageResyncKeyRef.current === resyncKey) messageResyncKeyRef.current = '';
      scheduleMessageResyncRetry();
    });
  }, [active, conversation.id, historyScopeKey, loadMessages, runtimeConnectionRevision]);

  // Runtime-owned context is keyed by the active conversation, model, and
  // kernel. Keep this independent from durable message loading so a context
  // refresh never restarts the history fetch.
  useEffect(() => {
    if (!conversation.id) return;
    void refreshContextStatus();
  }, [conversation.id, refreshContextStatus]);

  // Provider usage is Task-scoped and independent from thread resolution.
  useEffect(() => {
    void refreshDurableUsageSummary();
  }, [refreshDurableUsageSummary, runtimeConnectionRevision]);

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

  const durableAssistantRunIds = useMemo(
    () =>
      new Set(
        loadedMessages
          .filter((message) => message.role === 'assistant' && Boolean(message.runId))
          .map((message) => message.runId as string),
      ),
    [loadedMessages],
  );
  const projected = useMemo(
    () =>
      threadId
        ? projectConversationRunActivity({
            events: eventHistory,
            threadId,
            taskId: conversation.taskId ? String(conversation.taskId) : undefined,
            authority: runActivityAuthority,
            durableAssistantRunIds,
          })
        : { streaming: false, activeRunId: undefined },
    [conversation.taskId, durableAssistantRunIds, eventHistory, runActivityAuthority, threadId],
  );
  const cancelActiveRun = useCallback(async (): Promise<void> => {
    if (activeRunCancellationRef.current) {
      await activeRunCancellationRef.current;
      return;
    }
    const runId = projected.activeRunId ?? sendingRunId;
    if (!runId) return;
    const api = bridge();
    if (!api?.cancelRun) throw new Error('当前运行不支持停止');

    setStopping(true);
    const cancellation = api.cancelRun({ runId: runId as RunId }).then(() => {
      setSending(false);
      setSendingRunId(undefined);
    });
    activeRunCancellationRef.current = cancellation;
    try {
      await cancellation;
    } finally {
      if (activeRunCancellationRef.current === cancellation) {
        activeRunCancellationRef.current = null;
      }
      setStopping(false);
    }
  }, [projected.activeRunId, sendingRunId]);

  const handleStop = useCallback(async () => {
    try {
      await cancelActiveRun();
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
    }
  }, [cancelActiveRun]);

  const pauseGoalAndStopActiveRun = useCallback(async (): Promise<void> => {
    const api = bridge();
    if (!api?.goalPause) throw new Error('目标暂停功能未就绪');
    await api.goalPause({ conversationId: String(conversation.id) });
    try {
      await cancelActiveRun();
    } finally {
      await refreshGoal();
    }
  }, [cancelActiveRun, conversation.id, refreshGoal]);

  const pauseGoalForTransition = useCallback(async (): Promise<boolean> => {
    try {
      await pauseGoalAndStopActiveRun();
      return true;
    } catch (error) {
      setLocalErrors((prev) => [
        ...prev,
        {
          id: `err-goal-pause-${Date.now()}`,
          role: 'system',
          tone: 'error',
          text: `暂停目标失败: ${error instanceof Error ? error.message : String(error)}`,
          timestamp: new Date().toISOString(),
        },
      ]);
      return false;
    }
  }, [pauseGoalAndStopActiveRun]);
  const sendingRunHasDurableReply = Boolean(
    sendingRunId && durableAssistantRunIds.has(sendingRunId),
  );
  const runTerminalById = useMemo(() => projectRunTerminalEvents(eventHistory), [eventHistory]);
  const sendingRunHasTerminal = Boolean(sendingRunId && runTerminalById.has(sendingRunId));
  const sendingRunIsSettled = sendingRunHasDurableReply || sendingRunHasTerminal;
  const reconciledSending = sending && !sendingRunIsSettled;
  const displayRunProcessById = useMemo(() => {
    const display = new Map<string, RunProcessView>();
    for (const [runId, process] of runProcessById) {
      display.set(runId, reconcileRunProcessTerminal(process, runTerminalById.get(runId)));
    }
    return display;
  }, [runProcessById, runTerminalById]);
  /** Conversation-scoped Review: every created/edited file across this chat. */
  const latestReviewView = useMemo<ReviewView>(
    () => ({ reviewScope: 'conversation', conversationId: conversation.id }),
    [conversation.id],
  );
  /** Report up so workspace review surfaces can render the latest run. */
  useEffect(() => {
    onLatestReviewChange?.(latestReviewView);
  }, [latestReviewView, onLatestReviewChange, conversation.id]);
  const { agentIdentities: runAgentIdentityById, kernels: runKernelById } = useMemo(
    () => projectRunIdentities(eventHistory),
    [eventHistory],
  );
  /**
   * External-kernel self-compaction notices. Codex exposes a real item
   * lifecycle; Claude currently exposes only the completed compact boundary.
   * The host renders exactly the states each kernel reports.
   */
  const kernelCompactionEvents = useMemo(() => {
    const events: Event[] = [];
    for (const event of eventHistory) {
      if (
        event.type !== 'kernel.context_compaction_started' &&
        event.type !== 'kernel.context_compacted' &&
        event.type !== 'kernel.context_compaction_failed'
      ) {
        continue;
      }
      const payloadThreadId = nonEmptyString(event.payload.threadId);
      if (threadId && payloadThreadId && payloadThreadId !== threadId) continue;
      events.push(event);
    }
    events.sort((a, b) => a.sequence - b.sequence);
    return events;
  }, [eventHistory, threadId]);
  const latestHostCompactionEvent = useMemo(() => {
    const conversationId = String(conversation.id);
    return [...eventHistory]
      .reverse()
      .find(
        (event) =>
          (event.type === 'context.compaction_started' ||
            event.type === 'context.compacted' ||
            event.type === 'context.compaction_failed' ||
            event.type === 'context.compaction_skipped') &&
          nonEmptyString(event.payload.operationId) !== undefined &&
          nonEmptyString(event.payload.conversationId) === conversationId,
      );
  }, [conversation.id, eventHistory]);
  const reportManualCompactError = useCallback(
    (message: string) => {
      setLocalErrors((errors) => [
        ...errors,
        {
          id: `err-compact-${Date.now()}`,
          role: 'system',
          tone: 'error',
          text: message,
          timestamp: new Date().toISOString(),
        },
      ]);
    },
    [setLocalErrors],
  );
  const getCompact = useCallback(() => {
    const api = bridge();
    return api?.compactConversation
      ? (payload: import('@sync-think/protocol').ConversationCompactPayload) =>
          api.compactConversation!(payload)
      : undefined;
  }, []);
  const { compactProgress, isCompacting, runAutoCompact, runManualCompact } =
    useConversationCompaction({
      conversationId: String(conversation.id),
      getCompact,
      refreshContextStatus,
      onManualError: reportManualCompactError,
      hostEvent: latestHostCompactionEvent,
    });
  const conversationAgent = useMemo(
    () =>
      conversation.track === 'agent'
        ? agents.find((agent) => String(agent.id) === String(conversation.targetRef))
        : undefined,
    [agents, conversation.targetRef, conversation.track],
  );
  const conversationTeam = useMemo(
    () =>
      conversation.track === 'team'
        ? teams.find((team) => String(team.id) === String(conversation.targetRef))
        : undefined,
    [conversation.targetRef, conversation.track, teams],
  );
  const projectedProcessSettled = Boolean(
    projected.activeRunId && displayRunProcessById.get(String(projected.activeRunId))?.completedAt,
  );
  const runIsActive =
    !projectedProcessSettled &&
    (reconciledSending || projected.streaming || Boolean(projected.activeRunId));

  const runConnectionStatus = useMemo(
    () =>
      threadId
        ? selectLatestRunConnectionStatus({
            events: eventHistory,
            threadId,
            taskId: conversation.taskId ? String(conversation.taskId) : undefined,
            activeRunId: projected.activeRunId,
            streamingMessage,
          })
        : undefined,
    [conversation.taskId, eventHistory, projected.activeRunId, streamingMessage, threadId],
  );

  const visibleStreamingMessage = useMemo<ChatMessage | null>(() => {
    const settledStreamingMessage = reconcileStreamingMessageProcessTerminal(
      streamingMessage,
      streamingMessage?.runId
        ? displayRunProcessById.get(String(streamingMessage.runId))
        : undefined,
    );
    const processSettled = Boolean(
      streamingMessage?.streaming && !settledStreamingMessage?.streaming,
    );
    const attachRuntimeNotice = Boolean(
      !processSettled &&
      runtimeConnectionNotice &&
      (settledStreamingMessage || projected.streaming || runConnectionStatus),
    );
    const statusText = processSettled
      ? undefined
      : attachRuntimeNotice
        ? runtimeConnectionNotice?.text
        : runConnectionStatus?.text;
    if (!statusText) return settledStreamingMessage;
    const statusRunId =
      runConnectionStatus?.runId ?? projected.activeRunId ?? settledStreamingMessage?.runId;
    if (
      settledStreamingMessage &&
      (!statusRunId ||
        !settledStreamingMessage.runId ||
        settledStreamingMessage.runId === statusRunId)
    ) {
      return {
        ...settledStreamingMessage,
        runId: settledStreamingMessage.runId ?? statusRunId,
        processStatus: statusText,
        ...(attachRuntimeNotice && runtimeConnectionNotice
          ? { processStatusState: runtimeConnectionNotice.state }
          : {}),
      };
    }
    if (!runConnectionStatus && !attachRuntimeNotice) return settledStreamingMessage;
    return {
      id:
        runConnectionStatus?.id ??
        `runtime-connection-${runtimeConnectionNotice?.state ?? 'status'}`,
      role: 'assistant',
      text: '',
      processStatus: statusText,
      ...(attachRuntimeNotice && runtimeConnectionNotice
        ? { processStatusState: runtimeConnectionNotice.state }
        : {}),
      timestamp: runConnectionStatus?.timestamp ?? new Date().toISOString(),
      streaming: true,
      runId: statusRunId,
    };
  }, [
    projected.activeRunId,
    projected.streaming,
    displayRunProcessById,
    runConnectionStatus,
    runtimeConnectionNotice,
    streamingMessage,
  ]);

  const standaloneRuntimeConnectionNotice =
    runtimeConnectionNotice && !streamingMessage && !projected.streaming && !runConnectionStatus
      ? runtimeConnectionNotice
      : null;

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

  const mergeTransientAgentsIntoDurableParent = useCallback(
    (runId: string, projections: readonly DelegatedAgentProjection[]): boolean => {
      if (!loadedMessagesRef.current.some((message) => message.runId === runId)) return false;
      setLoadedMessages((previous) =>
        previous.map((message) => {
          if (message.runId !== runId) return message;
          let delegatedAgents = message.delegatedAgents;
          for (const projection of projections) {
            delegatedAgents = mergeDelegatedAgentProjection(delegatedAgents, projection);
          }
          return { ...message, delegatedAgents };
        }),
      );
      return true;
    },
    [],
  );
  const handleTransientSubscriptionEvent = useCallback(
    (event: ConversationTransientSubscriptionEvent) => {
      if (!threadId) return;
      const frameQueue = transientFrameQueueRef.current;
      if (event.type === 'reset') {
        clearTransientDisplayQueue();
        const latestStreamSequence = event.latestStreamSequence;
        if (event.snapshot && event.snapshot.threadId === threadId) {
          transientFallbackOnlyRef.current = false;
          transientStreamHealthyRef.current = true;
          if (
            event.snapshot.delegatedAgents?.length &&
            mergeTransientAgentsIntoDurableParent(
              String(event.snapshot.runId),
              event.snapshot.delegatedAgents,
            )
          ) {
            lastTransientSequenceRef.current = Math.max(
              lastTransientSequenceRef.current,
              latestStreamSequence,
            );
            return;
          }
          frameQueue.push(
            ...buildConversationSnapshotDisplayQueue({
              current: transientDraftRef.current,
              incoming: {
                runId: event.snapshot.runId,
                text: event.snapshot.text,
                commentaryText: event.snapshot.commentaryText,
                commentarySegments: event.snapshot.commentarySegments,
                reasoningText: event.snapshot.reasoningText,
                assistantTimeline: event.snapshot.assistantTimeline,
                delegatedAgents: event.snapshot.delegatedAgents,
                timestamp: event.snapshot.updatedAt,
              },
              streamSequence: latestStreamSequence,
              process: event.snapshot.process,
            }),
          );
        } else {
          transientFallbackOnlyRef.current = false;
          transientStreamHealthyRef.current = true;
          frameQueue.push(
            ...buildConversationSnapshotDisplayQueue({
              current: transientDraftRef.current,
              incoming: null,
              streamSequence: latestStreamSequence,
              refreshDurable: true,
            }),
          );
        }
        scheduleTransientFrameFlush('immediate');
        return;
      }
      const frame = event.frame;
      if (
        frame.delegatedAgent &&
        mergeTransientAgentsIntoDurableParent(String(frame.runId), [frame.delegatedAgent])
      ) {
        lastTransientSequenceRef.current = Math.max(
          lastTransientSequenceRef.current,
          frame.streamSequence,
        );
        if (frame.delegatedAgent.status !== 'running') {
          transientTerminalEffectsRef.current(String(frame.runId));
        }
        return;
      }
      if (transientFallbackOnlyRef.current) {
        lastTransientSequenceRef.current = Math.max(
          lastTransientSequenceRef.current,
          frame.streamSequence,
        );
        if (frame.kind === 'terminal') {
          if (frame.process) {
            updateRunProcess(frame.process);
          } else {
            runProcessLoader.invalidate(String(frame.runId));
            setRunProcessById((previous) => {
              if (!previous.has(frame.runId)) return previous;
              const next = new Map(previous);
              next.delete(frame.runId);
              return next;
            });
          }
          transientTerminalEffectsRef.current(String(frame.runId));
        }
        return;
      }
      transientStreamHealthyRef.current = true;
      frameQueue.push({ source: 'transient', frame, offset: 0 });
      scheduleTransientFrameFlush(
        frame.kind === 'process' || frame.kind === 'terminal' ? 'immediate' : 'animation-frame',
      );
    },
    [
      clearTransientDisplayQueue,
      mergeTransientAgentsIntoDurableParent,
      runProcessLoader,
      scheduleTransientFrameFlush,
      threadId,
      updateRunProcess,
    ],
  );
  const openTransientSubscription = useCallback<ConversationTransientSubscriptionPort>(
    (payload, listener) => bridge()?.subscribeConversationTransientStream?.(payload, listener),
    [],
  );
  const getTransientSequence = useCallback(() => lastTransientSequenceRef.current, []);
  const markTransientSubscriptionStarted = useCallback(() => {
    transientStreamHealthyRef.current = true;
  }, []);
  const handleTransientSubscriptionFailure = useCallback(() => {
    transientFallbackOnlyRef.current = true;
    transientStreamHealthyRef.current = false;
    lastConsumedEventSequenceRef.current = 0;
    setTransientFallbackEpoch((value) => value + 1);
  }, []);
  useConversationTransientSubscription({
    scopeKey: String(conversation.id),
    threadId,
    enabled: Boolean(threadId) && threadConversationIdRef.current === String(conversation.id),
    subscribe: openTransientSubscription,
    getAfterStreamSequence: getTransientSequence,
    onStarted: markTransientSubscriptionStarted,
    onEvent: handleTransientSubscriptionEvent,
    onFailure: handleTransientSubscriptionFailure,
    onDispose: clearTransientDisplayQueue,
  });

  // Streaming via durable events is now a compatibility/failure fallback.
  // While transient is healthy it owns the complete visible order, including
  // the terminal boundary. If the subscription later fails we rewind the
  // durable cursor to zero and replay this thread, so durable terminal events
  // never overtake transient text that has not reached the renderer yet.
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
    if (transientStreamHealthyRef.current) return;
    if (batch.operations.length > 0) {
      transientFrameQueueRef.current.push(
        ...batch.operations.map((operation): ConversationDisplayQueueItem => ({
          source: 'durable',
          operation,
          offset: 0,
        })),
      );
      scheduleTransientFrameFlush(
        batch.operations.some(
          (operation) => operation.type === 'process.boundary' || operation.type === 'run.terminal',
        )
          ? 'immediate'
          : 'animation-frame',
      );
    }
  }, [
    conversation.id,
    conversation.taskId,
    eventHistory,
    flushTransientFrames,
    scheduleTransientFrameFlush,
    threadId,
    transientFallbackEpoch,
  ]);

  const [runtimePendingApprovals, setRuntimePendingApprovals] = useState<
    PendingToolApprovalSummary[]
  >([]);
  const [runtimeExpiredApprovals, setRuntimeExpiredApprovals] = useState<
    ExpiredToolApprovalSummary[]
  >([]);
  const [expiredApprovalCount, setExpiredApprovalCount] = useState(0);
  const [recoveringApprovalId, setRecoveringApprovalId] = useState<string>();
  const approvalRecoveryRead = useRef<AbortController>();
  useEffect(() => {
    setRecoveringApprovalId(undefined);
    return () => {
      approvalRecoveryRead.current?.abort();
      approvalRecoveryRead.current = undefined;
    };
  }, [conversation.id]);
  const handleRecoverApproval = useCallback(
    async (approval: ExpiredToolApprovalSummary) => {
      const api = bridge();
      if (
        !api?.listConversationMessages ||
        !approval.requestMessageId ||
        approvalRecoveryRead.current ||
        String(approval.threadId) !== threadId
      )
        return;
      const targetConversationId = String(conversation.id);
      const controller = new AbortController();
      approvalRecoveryRead.current = controller;
      setRecoveringApprovalId(approval.approvalId);
      try {
        const response = await api.listConversationMessages({
          conversationId: conversation.id,
          aroundMessageId: approval.requestMessageId,
          limit: 1,
        });
        if (controller.signal.aborted || activeConversationIdRef.current !== targetConversationId)
          return;
        const original = response.messages.find(
          (message) => message.id === approval.requestMessageId,
        );
        if (
          !original ||
          original.role !== 'user' ||
          String(original.threadId) !== threadId ||
          (original.runId != null && String(original.runId) !== String(approval.runId))
        )
          throw new Error('原请求已变更或不属于该审批');
        const draft = await prepareApprovalRequestDraft(
          messageToChat(original),
          targetConversationId,
          controller.signal,
          api.readApprovalRequestImage,
        );
        if (controller.signal.aborted || activeConversationIdRef.current !== targetConversationId)
          return;
        setInput((current) => [current, draft.text].filter(Boolean).join('\n\n'));
        setAttachments((current) => [
          ...new Map(
            [...draft.attachments, ...current].map((attachment) => [attachment.path, attachment]),
          ).values(),
        ]);
        setSelectedSkillVersionIds((current) => [
          ...new Set([...current, ...draft.skillVersionIds]),
        ]);
        setLocalErrors((previous) => [
          ...previous,
          {
            id: 'approval-recovered-' + approval.approvalId + '-' + Date.now(),
            role: 'system',
            tone: 'info',
            text: '已恢复原请求，请核对后发送。新请求不会沿用旧批准，原运行可能已完成部分操作。',
            timestamp: new Date().toISOString(),
          },
        ]);
        window.requestAnimationFrame(() => inputRef.current?.focus());
      } catch (error) {
        const cancelled = controller.signal.aborted;
        controller.abort();
        if (!cancelled && activeConversationIdRef.current === targetConversationId)
          setLocalErrors((previous) => [
            ...previous,
            {
              id: 'approval-recovery-error-' + Date.now(),
              role: 'system',
              tone: 'error',
              text:
                '恢复原请求失败，当前草稿保持不变：' +
                (error instanceof Error ? error.message : String(error)),
              timestamp: new Date().toISOString(),
            },
          ]);
      } finally {
        if (approvalRecoveryRead.current === controller) {
          approvalRecoveryRead.current = undefined;
          setRecoveringApprovalId(undefined);
        }
      }
    },
    [conversation.id, threadId, setLocalErrors],
  );
  const pendingToolApprovalLoadGenerationRef = useRef(0);
  const toolApprovalLifecycleRevision = useMemo(() => {
    let revision = 0;
    for (const event of eventHistory) {
      const eventThread =
        typeof event.payload.threadId === 'string' ? event.payload.threadId : undefined;
      if (threadId && eventThread && eventThread !== threadId) continue;
      if (
        event.type === 'tool.approval_requested' ||
        event.type === 'tool.approval_decided' ||
        isRunTerminalEventType(event.type)
      ) {
        revision = Math.max(revision, event.sequence);
      }
    }
    return revision;
  }, [eventHistory, threadId]);
  const refreshPendingToolApprovals = useCallback(async () => {
    const api = bridge();
    if (!api?.listPendingToolApprovals || !threadId) {
      pendingToolApprovalLoadGenerationRef.current += 1;
      setRuntimePendingApprovals([]);
      setRuntimeExpiredApprovals([]);
      setExpiredApprovalCount(0);
      return;
    }
    const generation = (pendingToolApprovalLoadGenerationRef.current += 1);
    try {
      const response = await api.listPendingToolApprovals({ threadId: threadId as ThreadId });
      if (pendingToolApprovalLoadGenerationRef.current !== generation) return;
      setRuntimePendingApprovals(
        response.approvals.filter((approval) => String(approval.threadId) === threadId),
      );
      const expired = (response.expired ?? []).filter(
        (approval) => String(approval.threadId) === threadId && approval.status === 'expired',
      );
      setRuntimeExpiredApprovals(expired);
      setExpiredApprovalCount(response.expiredCount ?? expired.length);
    } catch {
      // Keep the last validated Runtime snapshot. Durable events still resolve
      // cards while a reconnect query is transiently unavailable.
    }
  }, [threadId]);
  useEffect(() => {
    void refreshPendingToolApprovals();
  }, [refreshPendingToolApprovals, runtimeConnectionRevision, toolApprovalLifecycleRevision]);

  // Pending tool approvals merge durable history with the Runtime's current
  // in-memory wait set. The latter restores a card when Desktop's persisted
  // replay cursor has already advanced past its original requested event.
  const pendingApprovals = useMemo(() => {
    if (!threadId) return [] as PendingToolApproval[];
    const byId = new Map<string, PendingToolApproval>();
    const decidedIds = new Set<string>();
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
          arguments: toolApprovalArguments(event.payload.arguments),
          allowedScopes: toolApprovalScopes(event.payload.allowedScopes),
        });
      } else if (event.type === 'tool.approval_decided') {
        const approvalId =
          typeof event.payload.approvalId === 'string' ? event.payload.approvalId : undefined;
        if (!approvalId) continue;
        decidedIds.add(approvalId);
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
    for (const approval of runtimePendingApprovals) {
      if (
        String(approval.threadId) !== threadId ||
        decidedIds.has(approval.approvalId) ||
        endedRuns.has(String(approval.runId))
      ) {
        continue;
      }
      byId.set(approval.approvalId, {
        approvalId: approval.approvalId,
        runId: String(approval.runId),
        toolName: approval.toolName,
        title: approval.title,
        detail: approval.detail,
        ...(approval.toolCallId ? { toolCallId: approval.toolCallId } : {}),
        ...(approval.path ? { path: approval.path } : {}),
        ...(approval.command ? { command: approval.command } : {}),
        ...(approval.arguments ? { arguments: approval.arguments } : {}),
        ...(approval.allowedScopes ? { allowedScopes: approval.allowedScopes } : {}),
      });
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
  }, [eventHistory, runtimePendingApprovals, threadId]);

  const approvalWaitingRunIds = useMemo(
    () => new Set(pendingApprovals.flatMap((approval) => (approval.runId ? [approval.runId] : []))),
    [pendingApprovals],
  );

  const [decidingApprovalId, setDecidingApprovalId] = useState<string | null>(null);
  useEffect(() => {
    setDecidingApprovalId(null);
  }, [conversation.id]);

  const handleToolApproval = useCallback(
    async (approvalId: string, decision: 'approve' | 'deny', scope: ToolApprovalScope = 'once') => {
      const api = bridge();
      if (!api?.decideToolApproval || decidingApprovalId) return;
      const targetConversationId = String(conversation.id);
      setDecidingApprovalId(approvalId);
      try {
        const response = await api.decideToolApproval({
          approvalId,
          decision,
          scope: decision === 'deny' ? 'once' : scope,
        });
        if (activeConversationIdRef.current !== targetConversationId) return;
        if (response.outcome === 'expired' || response.decision !== decision) {
          const id = 'approval-outcome-' + approvalId;
          const text =
            response.outcome === 'expired'
              ? '原审批已失效，本次点击没有授予权限。请重新编辑原请求并核对后发送。'
              : response.decision === 'deny'
                ? '该请求此前已被拒绝，本次点击没有授予权限。'
                : '该请求此前已获批准，本次拒绝没有撤回已生效的批准。';
          setLocalErrors((previous) => [
            ...previous.filter((message) => message.id !== id),
            { id, role: 'system', tone: 'warning', text, timestamp: new Date().toISOString() },
          ]);
        }
        await refreshPendingToolApprovals();
      } catch (error) {
        if (activeConversationIdRef.current !== targetConversationId) return;
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
        if (activeConversationIdRef.current === targetConversationId) setDecidingApprovalId(null);
      }
    },
    [conversation.id, decidingApprovalId, refreshPendingToolApprovals, setLocalErrors],
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

  const pendingUserMessagesForDisplay = useMemo(
    () => filterPendingUserMessagesForDisplay(pendingUserMessages, loadedMessages),
    [loadedMessages, pendingUserMessages],
  );

  useEffect(() => {
    if (!sendingRunIsSettled) return;
    setSending(false);
    setStopping(false);
    setSendingRunId(undefined);
  }, [sendingRunIsSettled]);

  // Clear "sending" once the run leaves the streaming state (or fails via local error).
  useEffect(() => {
    if (!sending && !stopping) return;
    if (!projected.streaming && pendingUserMessages.length === 0) {
      // Keep a tiny grace window so a just-started run isn't cleared before run.started arrives.
      const timer = window.setTimeout(() => {
        setSending(false);
        setStopping(false);
        setSendingRunId(undefined);
      }, 120);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [pendingUserMessages.length, projected.streaming, sending, stopping]);

  const messages = useMemo(() => {
    // Navigation changes props before the history reset commits. Do not mount
    // old messages under the new content scope, even for that intermediate render:
    // their automatic source reads would otherwise use the wrong conversation.
    if (loadedMessagesScopeKey !== historyScopeKey) return [];
    return mergeConversationMessagesForDisplay({
      durableMessages: loadedMessages,
      pendingMessages: pendingUserMessagesForDisplay,
      streamingMessage: visibleStreamingMessage ?? undefined,
    });
  }, [
    historyScopeKey,
    loadedMessagesScopeKey,
    loadedMessages,
    pendingUserMessagesForDisplay,
    visibleStreamingMessage,
  ]);

  const navigationItems = useMemo<ConversationNavigationItem[]>(() => {
    const byId = new Map<string, ChatMessage>(
      navigationDirectory.entries.map((entry) => [
        String(entry.id),
        {
          id: String(entry.id),
          role: entry.role,
          text: entry.text,
          sequence: entry.sequence,
          timestamp: entry.createdAt,
          runId: entry.runId,
          terminalState: entry.terminalState,
          legacyTerminalBackfill: entry.legacyTerminalBackfill,
        },
      ]),
    );
    for (const message of messages.filter(shouldDisplayChatMessage)) byId.set(message.id, message);
    return buildAssistantTurnNavigationItems(
      orderDurableMessagesForDisplay([...byId.values()]).map((message) => ({
        id: message.id,
        role: message.role,
        text: message.text,
        commentaryText: message.commentaryText,
        processStatus: message.processStatus,
        streaming: message.streaming,
        terminalState: message.terminalState,
        timestamp: message.timestamp,
      })),
    );
  }, [messages, navigationDirectory.entries]);

  const isNavigationTargetLoaded = useCallback(
    (messageId: string) => loadedMessagesRef.current.some((message) => message.id === messageId),
    [],
  );
  const loadNavigationTargetPage = useCallback(
    (messageId: string, isCurrent: () => boolean) =>
      loadMessages(undefined, { aroundMessageId: messageId, accept: isCurrent }),
    [loadMessages],
  );
  const markNavigationStart = useCallback(() => {
    stickToBottomRef.current = false;
    bottomPinIntentRef.current = null;
    userScrollRevisionRef.current += 1;
  }, []);
  const writeNavigationScroll = useCallback((scroller: HTMLDivElement, scrollTop: number) => {
    programmaticScrollTargetRef.current = scrollTop;
    programmaticScrollPendingRef.current = true;
    scroller.scrollTop = scrollTop;
    lastObservedScrollTopRef.current = scrollTop;
  }, []);
  const {
    loadingTarget: loadingHistoryTarget,
    loadTarget: loadNavigationTarget,
    navigate: handleNavigateMessage,
    stop: stopNavigationSlide,
    captureIntent: captureNavigationIntent,
    isIntentCurrent: isNavigationIntentCurrent,
  } = useConversationNavigationController({
    scopeKey: historyScopeKey,
    scrollerRef: messagesScrollRef,
    isMessageLoaded: isNavigationTargetLoaded,
    loadAround: loadNavigationTargetPage,
    onRenderTarget: setRenderWindowTargetId,
    onNavigationStart: markNavigationStart,
    writeProgrammaticScroll: writeNavigationScroll,
  });

  const visibleDurableMessages = useMemo(() => {
    if (!threadId) return loadedMessages;
    const excludedRunIds = new Set(durableAssistantRunIds);
    if (visibleStreamingMessage?.runId) excludedRunIds.add(visibleStreamingMessage.runId);
    const recovered = projectRunPauseTerminals({
      events: eventHistory,
      threadId,
      taskId: conversation.taskId ? String(conversation.taskId) : undefined,
      excludedRunIds,
    }).map((terminal): ChatMessage => ({
      id: terminal.id,
      role: 'assistant',
      text: '',
      timestamp: terminal.timestamp,
      runId: terminal.runId,
      // A pause is resumable; labelling it `failed` made a provider outage read
      // as a hard error and hid that the turn can simply be continued.
      terminalState: 'paused',
      terminalError: terminal.error,
    }));
    if (recovered.length === 0) return loadedMessages;

    const merged = [...loadedMessages];
    for (const terminal of recovered) {
      const terminalTime = Date.parse(terminal.timestamp);
      const insertionIndex = Number.isFinite(terminalTime)
        ? merged.findIndex((message) => {
            const messageTime = Date.parse(message.timestamp);
            return Number.isFinite(messageTime) && messageTime > terminalTime;
          })
        : -1;
      if (insertionIndex < 0) merged.push(terminal);
      else merged.splice(insertionIndex, 0, terminal);
    }
    return merged;
  }, [
    conversation.taskId,
    durableAssistantRunIds,
    eventHistory,
    loadedMessages,
    threadId,
    visibleStreamingMessage?.runId,
  ]);
  const initialDurableRenderStart = getInitialMessageRenderStart(visibleDurableMessages.length);
  const durableRenderWindowResetKey = `${historyScopeKey}:${visibleDurableMessages.length}:${visibleDurableMessages[0]?.id ?? ''}:${visibleDurableMessages.at(-1)?.id ?? ''}`;
  const [durableRenderWindow, setDurableRenderWindow] = useState(() => ({
    resetKey: durableRenderWindowResetKey,
    startIndex: initialDurableRenderStart,
  }));
  const requestedRenderTargetIndex = renderWindowTargetId
    ? visibleDurableMessages.findIndex((message) => message.id === renderWindowTargetId)
    : -1;
  const durableRenderStartIndex = Math.min(
    durableRenderWindow.resetKey === durableRenderWindowResetKey
      ? durableRenderWindow.startIndex
      : initialDurableRenderStart,
    requestedRenderTargetIndex >= 0 ? requestedRenderTargetIndex : initialDurableRenderStart,
  );
  useEffect(() => {
    if (requestedRenderTargetIndex < 0) return;
    setDurableRenderWindow((previous) => {
      const currentStart =
        previous.resetKey === durableRenderWindowResetKey
          ? previous.startIndex
          : initialDurableRenderStart;
      const startIndex = Math.min(currentStart, requestedRenderTargetIndex);
      return previous.resetKey === durableRenderWindowResetKey && previous.startIndex === startIndex
        ? previous
        : { resetKey: durableRenderWindowResetKey, startIndex };
    });
  }, [durableRenderWindowResetKey, initialDurableRenderStart, requestedRenderTargetIndex]);
  const renderedDurableMessages = useMemo(
    () => visibleDurableMessages.slice(durableRenderStartIndex),
    [durableRenderStartIndex, visibleDurableMessages],
  );
  const renderedDurableMessageIds = useMemo(
    () => renderedDurableMessages.map((message) => message.id),
    [renderedDurableMessages],
  );
  const durableMessageWindow = useMessageVirtualWindow({
    ids: renderedDurableMessageIds,
    scrollerRef: messagesScrollRef,
    forcedTargetId: renderWindowTargetId,
  });
  const windowedDurableMessages = useMemo(
    () =>
      renderedDurableMessages.slice(durableMessageWindow.startIndex, durableMessageWindow.endIndex),
    [durableMessageWindow.endIndex, durableMessageWindow.startIndex, renderedDurableMessages],
  );
  const hiddenDurableMessageCount = durableRenderStartIndex;
  useEffect(() => {
    setDurableRenderWindow((previous) => {
      if (previous.resetKey === durableRenderWindowResetKey) return previous;
      return {
        resetKey: durableRenderWindowResetKey,
        startIndex:
          requestedRenderTargetIndex >= 0
            ? Math.min(initialDurableRenderStart, requestedRenderTargetIndex)
            : initialDurableRenderStart,
      };
    });
  }, [durableRenderWindowResetKey, initialDurableRenderStart, requestedRenderTargetIndex]);
  const liveMessages = useMemo(() => {
    const result: ChatMessage[] = [];
    result.push(...pendingUserMessagesForDisplay);
    if (visibleStreamingMessage) result.push(visibleStreamingMessage);
    return result;
  }, [pendingUserMessagesForDisplay, visibleStreamingMessage]);

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

  const gapBeforeMessage = useMemo(() => {
    const result = new Map<string, number>();
    for (const gap of historyRangeGaps(historyRanges)) {
      const first = visibleDurableMessages.find(
        (message) =>
          !message.legacyTerminalBackfill &&
          message.sequence !== undefined &&
          message.sequence >= gap.beforeSequence,
      );
      if (first) result.set(first.id, gap.beforeSequence);
    }
    return result;
  }, [historyRanges, visibleDurableMessages]);
  const loadHistoryGap = useCallback(
    async (cursor: number, options?: { revealLoadedPage?: boolean }) => {
      const scroller = messagesScrollRef.current;
      const anchor = scroller ? capturePrependAnchor(scroller) : null;
      if (anchor) setRenderWindowTargetId(anchor.id);
      const revision = userScrollRevisionRef.current;
      const intent = captureNavigationIntent();
      const applied = await loadMessages(cursor, {
        accept: () => isNavigationIntentCurrent(intent),
        revealLoadedPage: options?.revealLoadedPage,
      });
      if (applied && scroller && anchor)
        window.requestAnimationFrame(() => {
          if (messagesScrollRef.current === scroller) {
            restorePrependAnchor(scroller, anchor, revision);
            setRenderWindowTargetId(undefined);
          }
        });
    },
    [
      captureNavigationIntent,
      capturePrependAnchor,
      isNavigationIntentCurrent,
      loadMessages,
      restorePrependAnchor,
    ],
  );

  const expandDurableRenderWindowTo = useCallback(
    (startIndex: number) => {
      const scroller = messagesScrollRef.current;
      const previousScrollHeight = scroller?.scrollHeight ?? 0;
      setDurableRenderWindow((previous) => {
        const currentStart =
          previous.resetKey === durableRenderWindowResetKey
            ? previous.startIndex
            : initialDurableRenderStart;
        return {
          resetKey: durableRenderWindowResetKey,
          startIndex: expandMessageRenderStart(currentStart, startIndex),
        };
      });
      window.requestAnimationFrame(() => {
        if (!scroller || messagesScrollRef.current !== scroller) return;
        const target = scroller.scrollTop + (scroller.scrollHeight - previousScrollHeight);
        programmaticScrollPendingRef.current = true;
        programmaticScrollTargetRef.current = target;
        scroller.scrollTop = target;
        lastObservedScrollTopRef.current = target;
      });
    },
    [durableRenderWindowResetKey, initialDurableRenderStart],
  );

  const handleLoadEarlierMessages = useCallback(() => {
    if (durableRenderStartIndex > 0) {
      expandDurableRenderWindowTo(durableRenderStartIndex - MESSAGE_LOAD_EARLIER_BATCH);
      return;
    }
    if (!hasMore || loadingMore || loadingMoreRef.current || nextCursor === undefined) return;
    void loadHistoryGap(nextCursor, { revealLoadedPage: true });
  }, [
    durableRenderStartIndex,
    expandDurableRenderWindowTo,
    hasMore,
    loadHistoryGap,
    loadingMore,
    nextCursor,
  ]);

  const durableProcessRunIds = useMemo(
    () =>
      windowedDurableMessages
        .filter((message) => message.role === 'assistant' && Boolean(message.runId))
        .map((message) => String(message.runId)),
    [windowedDurableMessages],
  );
  const activeProcessRunIds = useMemo(
    () =>
      [streamingMessage?.runId, projected.activeRunId]
        .filter((runId): runId is RunId => Boolean(runId))
        .map(String),
    [projected.activeRunId, streamingMessage?.runId],
  );
  useRunProcessHistoryRequests({
    loader: runProcessLoader,
    conversationId: String(conversation.id),
    enabled:
      loadedMessagesConversationIdRef.current === String(conversation.id) &&
      Boolean(bridge()?.getConversationRunProcess),
    scrollerRef: messagesScrollRef,
    durableRunIds: durableProcessRunIds,
    activeRunIds: activeProcessRunIds,
    available: runProcessById,
  });

  const liveTail = visibleStreamingMessage ?? messages.at(-1);
  const flowTipSignature = `${conversation.id}:${messages.at(-1)?.id ?? 'empty'}:${
    liveTail?.streaming ? 'streaming' : 'settled'
  }:${pendingApprovals.at(-1)?.approvalId ?? 'no-approval'}:${liveTail?.reasoningText?.length ?? 0}:${
    liveTail?.answerText?.length ?? liveTail?.text?.length ?? 0
  }:${liveTail?.commentaryText?.length ?? 0}:${liveTail?.commentarySegments?.length ?? 0}:${
    liveTail?.processItems?.length ?? 0
  }`;
  const followMainContentResize = shouldFollowConversationContentResize({
    streaming: Boolean(visibleStreamingMessage?.streaming),
    hasAnswerText: Boolean(visibleStreamingMessage?.answerText?.trim()),
  });
  const saveCurrentScrollPosition = useCallback(() => {
    const scroller = messagesScrollRef.current;
    if (!scroller) return;
    writeConversationScrollPosition(
      historyScopeKey,
      captureConversationScrollPosition(scroller, stickToBottomRef.current),
    );
  }, [historyScopeKey]);

  const scheduleScrollPositionSave = useCallback(() => {
    if (scrollPositionWriteFrameRef.current !== null) return;
    scrollPositionWriteFrameRef.current = window.requestAnimationFrame(() => {
      scrollPositionWriteFrameRef.current = null;
      saveCurrentScrollPosition();
    });
  }, [saveCurrentScrollPosition]);

  useEffect(() => {
    return () => {
      if (scrollPositionWriteFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollPositionWriteFrameRef.current);
        scrollPositionWriteFrameRef.current = null;
      }
      saveCurrentScrollPosition();
    };
  }, [saveCurrentScrollPosition]);

  const pinMessagesToBottom = useCallback(() => {
    const scroller = messagesScrollRef.current;
    if (!scroller || !stickToBottomRef.current) return;
    const target = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    if (Math.abs(scroller.scrollTop - target) > 1) {
      programmaticScrollTargetRef.current = target;
      programmaticScrollPendingRef.current = true;
      scroller.scrollTop = target;
    }
    lastObservedScrollTopRef.current = scroller.scrollTop;
  }, []);

  /**
   * The jump-to-latest button mirrors the scroller's own distance from the tail
   * instead of a timer or the stick flag, so it appears exactly when the reader
   * has scrolled past `CONVERSATION_STICK_THRESHOLD_PX` into history.
   */
  const syncJumpToLatest = useCallback(() => {
    const scroller = messagesScrollRef.current;
    if (!scroller) return;
    const awayFromTail =
      scroller.scrollHeight > scroller.clientHeight &&
      !isConversationNearBottom({
        scrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
      });
    setJumpToLatestVisible(awayFromTail);
    // Back at the tail: there is nothing left to catch up on.
    if (!awayFromTail) setJumpToLatestUnread(false);
  }, []);

  const handleJumpToLatest = useCallback(() => {
    const scroller = messagesScrollRef.current;
    if (!scroller) return;
    const target = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    // Re-arm the pin first, so streaming output keeps following the tail after
    // the reader lands instead of stranding them again.
    stickToBottomRef.current = true;
    bottomPinIntentRef.current = 'toward-bottom';
    programmaticScrollPendingRef.current = true;
    programmaticScrollTargetRef.current = target;
    setJumpToLatestUnread(false);
    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (typeof scroller.scrollTo === 'function') {
      scroller.scrollTo({ top: target, behavior: reduceMotion ? 'auto' : 'smooth' });
    } else {
      scroller.scrollTop = target;
    }
    syncJumpToLatest();
  }, [syncJumpToLatest]);

  useLayoutEffect(() => {
    if (
      loadedMessagesScopeKey !== historyScopeKey ||
      !initialLoaded ||
      restoredScrollPositionRef.current === historyScopeKey
    )
      return;
    const scroller = messagesScrollRef.current;
    if (!scroller) return;
    restoredScrollPositionRef.current = historyScopeKey;
    const saved = readConversationScrollPosition(historyScopeKey);
    if (!saved) {
      stickToBottomRef.current = true;
      pinMessagesToBottom();
      return;
    }
    stickToBottomRef.current = saved.stickToBottom;
    restoreConversationScrollPosition(scroller, saved);
    lastObservedScrollTopRef.current = scroller.scrollTop;
    // 快照只重放一次是不够的：消息页刷新、图片解码、折叠面板展开都会在随后的若干帧
    // 里继续撑高锚点以上的内容，读者刚回到会话就发现位置漂走了。这里用一段有界的
    // settle 循环盯住锚点，直到「锚点对齐 + 高度连续稳定」或超时；一旦用户自己滚动
    // （userScrollRevision 变化）立刻放手，位置归用户。
    const expectedUserScrollRevision = userScrollRevisionRef.current;
    const deadline = performance.now() + 2_500;
    // 帧数上限兜底：测试环境用假定时器时 performance.now() 可能不前进，
    // 只靠 deadline 会让循环停不下来。
    const maxFrames = 90;
    let frames = 0;
    let stableFrames = 0;
    let lastHeight = -1;
    const settle = () => {
      // 判活用滚动容器节点本身，而不是 restoredScrollPositionRef：会话切换时的
      // 重置 effect 是 passive 的，会在本 layout effect 之后把那个 ref 清成 null，
      // 循环会在第一帧就误判「已过期」而退出（快照只重放一次，位置照样漂）。
      // 换会话 = 换容器节点，这个判据既准确又不受 effect 顺序影响。
      if (messagesScrollRef.current !== scroller) return;
      if (userScrollRevisionRef.current !== expectedUserScrollRevision) return;
      if (frames >= maxFrames) return;
      frames += 1;
      restoreConversationScrollPosition(scroller, saved);
      lastObservedScrollTopRef.current = scroller.scrollTop;
      const viewportTop = scroller.getBoundingClientRect().top;
      const anchorNode = saved.anchorMessageId
        ? Array.from(scroller.querySelectorAll<HTMLElement>('[data-message-id]')).find(
            (node) => node.dataset.messageId === saved.anchorMessageId,
          )
        : undefined;
      const aligned = saved.stickToBottom
        ? Math.abs(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop) <= 1
        : Boolean(anchorNode) &&
          Math.abs(anchorNode!.getBoundingClientRect().top - viewportTop - saved.anchorOffset) <= 1;
      const height = scroller.scrollHeight;
      const heightStable = height === lastHeight;
      lastHeight = height;
      stableFrames = aligned && heightStable ? stableFrames + 1 : 0;
      if (stableFrames >= 2 || performance.now() >= deadline) return;
      window.requestAnimationFrame(settle);
    };
    window.requestAnimationFrame(settle);
  }, [
    historyScopeKey,
    initialLoaded,
    loadedMessages.length,
    loadedMessagesScopeKey,
    pinMessagesToBottom,
  ]);

  // Follow the live tail while the user stays pinned. Think, commentary,
  // tools, and the final answer all grow the same content column.
  useLayoutEffect(() => {
    pinMessagesToBottom();
  }, [flowTipSignature, followMainContentResize, pinMessagesToBottom]);
  // Content that lands while the reader is away from the tail stays "unread"
  // until they jump back down — this drives the dot on the jump-to-latest
  // button. Runs after `pinMessagesToBottom`, so a pinned reader is already at
  // the tail and keeps the dot off.
  useLayoutEffect(() => {
    const scroller = messagesScrollRef.current;
    if (!scroller) return;
    if (
      isConversationNearBottom({
        scrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
      })
    )
      return;
    setJumpToLatestUnread(true);
  }, [flowTipSignature]);
  useEffect(() => {
    const content = messagesContentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (followMainContentResize) pinMessagesToBottom();
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [conversation.id, followMainContentResize, pinMessagesToBottom]);

  const ensureKernelExecution = useCallback(
    (selectedKernelId: string) => {
      const kernel = kernelRegistry?.find((entry) => entry.kernelId === selectedKernelId);
      if (isKernelExecutionSupported(kernel ?? { kernelId: selectedKernelId })) return true;
      const text =
        kernel?.executionUnavailableReason ??
        kernelExecutionUnavailableReason(resolveKernelDisplayName(selectedKernelId, kernel?.name));
      setLocalErrors((previous) => [
        ...previous.filter((message) => message.id !== 'kernel-unavailable-' + conversation.id),
        {
          id: 'kernel-unavailable-' + conversation.id,
          role: 'system',
          tone: 'warning',
          text,
          timestamp: new Date().toISOString(),
        },
      ]);
      return false;
    },
    [conversation.id, kernelRegistry, setLocalErrors],
  );

  const sendUserText = useCallback(
    async (text: string, images: MessageImage[] = [], options?: ComposeSendOptions) => {
      const api = bridge();
      if (!api || (!text.trim() && images.length === 0)) return;
      if (!ensureKernelExecution(options?.kernelOverride ?? kernelOverride)) {
        throw new Error('当前内核执行尚未接通');
      }
      const conversationId = String(conversation.id);
      const isActiveConversation = () => activeConversationIdRef.current === conversationId;
      // Freeze before auto-compaction or any IPC so menu changes cannot alter this Run.
      const skillVersionIds = resolveAppendSkillVersionIds(
        conversation.track,
        options?.skillVersionIds ?? selectedSkillVersionIds,
      );
      const selectedModelOverride = options?.modelOverride ?? modelOverride;
      const selectedReasoningEffort = options?.reasoningEffort ?? reasoningEffort;
      const selectedNetworkEnabled = options?.networkEnabled ?? netEnabled;

      // Use the frozen kernel choice, including queued drafts and explicit overrides.
      await runAutoCompact(options?.kernelOverride ?? kernelOverride, contextStatusRef.current);

      const tempId = `temp-${Date.now()}`;
      if (isActiveConversation()) {
        stickToBottomRef.current = true;
        bottomPinIntentRef.current = null;
        setSending(true);
        setSendingRunId(undefined);
        setPendingUserMessages((prev) => [
          ...prev,
          {
            id: tempId,
            role: 'user',
            text,
            images: images.length > 0 ? images : undefined,
            skillVersionIds,
            timestamp: new Date().toISOString(),
          },
        ]);
      }

      try {
        const {
          preparation: prep,
          response,
          durableImages,
          imageNotice,
        } = await submitConversationMessage(
          {
            conversationId,
            text,
            images,
            modelOverride: selectedModelOverride,
            track: conversation.track,
            targetRef: conversation.targetRef,
            catalogModelIds: models.map((model) => model.modelId),
            kernelOverride: options?.kernelOverride ?? kernelOverride,
            reasoningEffort: selectedReasoningEffort,
            networkEnabled: selectedNetworkEnabled,
            planExecuting: options?.planExecuting,
            helpMode: options?.helpMode,
            skillVersionIds,
            workspacePath: conversation.workspaceId
              ? workspaces.find((workspace) => workspace.workspaceId === conversation.workspaceId)
                  ?.folderPath
              : undefined,
          },
          {
            prepare: (payload) => api.sendConversationMessage(payload),
            append: (payload) => api.appendMessage(payload),
          },
          (preparedThreadId) => {
            if (isActiveConversation()) setThreadId(preparedThreadId);
          },
        );
        if (imageNotice && isActiveConversation()) {
          setLocalErrors((prev) => [
            ...prev,
            {
              id: `${imageNotice.prefix}-${Date.now()}`,
              role: 'system',
              tone: imageNotice.tone,
              text: imageNotice.text,
              timestamp: new Date().toISOString(),
            },
          ]);
        }
        if (isActiveConversation()) {
          setSendingRunId(
            typeof response.streamId === 'string' && response.streamId.length > 0
              ? response.streamId
              : undefined,
          );
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
        }
        return true;
      } catch (err) {
        if (isActiveConversation()) {
          setSending(false);
          setSendingRunId(undefined);
          setPendingUserMessages((prev) => prev.filter((message) => message.id !== tempId));
          const text = classifyAppendMessageFailure(err).message;
          setLocalErrors((prev) => [
            ...prev,
            {
              id: `err-${Date.now()}`,
              role: 'system',
              tone: 'error',
              text,
              timestamp: new Date().toISOString(),
            },
          ]);
        }
        throw err;
      } finally {
        if (isActiveConversation()) inputRef.current?.focus();
      }
    },
    [
      ensureKernelExecution,
      conversation.id,
      conversation.workspaceId,
      conversation.targetRef,
      conversation.title,
      conversation.track,
      kernelOverride,
      modelOverride,
      models,
      netEnabled,
      onTitleUpdated,
      reasoningEffort,
      runAutoCompact,
      selectedSkillVersionIds,
      workspaces,
    ],
  );

  // plan-review 确认执行：结束规划轮，切执行模式并发起执行轮（actModelId + 全工具）。
  // 放在 sendUserText 定义之后；事件回调经 lastAskAnsweredSeqRef 幂等。
  const executeApprovedPlanReview = useCallback(
    (questions: readonly AskQuestion[], answers: readonly AskQuestionAnswer[]) => {
      const review = planReviewOf(questions);
      if (!review) return;
      const answer = answers.find((item) => item.id === review.id);
      const approved = answer?.selected.includes(review.approveLabel) === true;
      if (!approved) return;
      const api = bridge();
      void api?.setConversationInteractionMode?.({
        conversationId: conversation.id,
        interactionMode: 'execute',
      });
      setInteractionMode('execute');
      const instruction = [
        '【执行已批准方案】',
        `方案：${review.question}`,
        '',
        '请严格按以下已批准方案执行，每步完成后按方案中的验收标准自检；如发现方案不再适用，暂停并说明偏差，不要擅自扩大范围。',
        '',
        '【已批准方案全文】',
        review.plan,
      ].join('\n');
      void sendUserText(instruction, [], { planExecuting: true });
    },
    [conversation.id, sendUserText],
  );
  // §12.18 方案卡回调：批准执行 / 切换模式 / 通知 / 卡片清除。
  const handlePlanExecute = useCallback(
    async (instruction: string) => {
      // 结束挂起的 plan-review 轮（回答「确认执行」→ 规划 run 恢复并收尾）。
      if (pendingAsk) {
        const review = planReviewOf(pendingAsk.questions);
        if (review) {
          try {
            await bridge()?.conversationAskAnswer?.({
              askId: pendingAsk.askId,
              answers: [{ id: review.id, selected: [review.approveLabel] }],
            });
          } catch {
            // 回答失败不阻塞执行轮；规划轮仍会随自身超时/取消结束。
          }
          setPendingAsk(undefined);
        }
      }
      await sendUserText(instruction, [], { planExecuting: true });
    },
    [pendingAsk, sendUserText],
  );
  const handlePlanSwitchMode = useCallback(
    async (mode: 'plan' | 'execute') => {
      await bridge()?.setConversationInteractionMode?.({
        conversationId: conversation.id,
        interactionMode: mode,
      });
      setInteractionMode(mode);
    },
    [conversation.id],
  );
  useEffect(() => {
    const matchesConversation = (event: globalThis.Event) =>
      String((event as CustomEvent<{ conversationId?: string }>).detail?.conversationId ?? '') ===
      String(conversation.id);
    const togglePlan = (event: globalThis.Event) => {
      if (!matchesConversation(event)) return;
      const parsed = parseSlashCommand(input);
      const activePrefix = parsed.kind === 'plan' || parsed.kind === 'plan-with-request';
      if (activePrefix || interactionMode === 'plan') {
        const next = withoutComposerModeCommand(input, 'plan');
        setInput(next);
        if (interactionMode === 'plan') void handlePlanSwitchMode('execute');
        window.requestAnimationFrame(() => {
          inputRef.current?.focus();
          inputRef.current?.setSelectionRange(next.length, next.length);
        });
        return;
      }
      void (async () => {
        if (activeGoalState?.goal?.status === 'active' && !(await pauseGoalForTransition())) return;
        const next = withComposerModeCommand(input, 'plan');
        setInput(next);
        window.requestAnimationFrame(() => {
          inputRef.current?.focus();
          inputRef.current?.setSelectionRange(next.length, next.length);
        });
      })();
    };
    const openGoal = (event: globalThis.Event) => {
      if (!matchesConversation(event)) return;
      const api = bridge();
      if (activeGoalState?.goal?.status === 'active') {
        void pauseGoalForTransition();
        return;
      }
      if (
        activeGoalState?.goal &&
        ['paused', 'blocked'].includes(activeGoalState.goal.status) &&
        api?.goalResume
      ) {
        void api.goalResume({ conversationId: String(conversation.id) }).then(refreshGoal);
        return;
      }
      const parsed = parseSlashCommand(input);
      const activePrefix = parsed.kind === 'goal' || parsed.kind === 'goal-with-condition';
      const next = activePrefix
        ? withoutComposerModeCommand(input, 'goal')
        : withComposerModeCommand(input, 'goal');
      if (!activePrefix && interactionMode === 'plan') void handlePlanSwitchMode('execute');
      setInput(next);
      window.requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(next.length, next.length);
      });
    };
    window.addEventListener('shell-toggle-plan-mode', togglePlan);
    window.addEventListener('shell-toggle-goal-mode', openGoal);
    return () => {
      window.removeEventListener('shell-toggle-plan-mode', togglePlan);
      window.removeEventListener('shell-toggle-goal-mode', openGoal);
    };
  }, [
    conversation.id,
    activeGoalState,
    handlePlanSwitchMode,
    input,
    interactionMode,
    pauseGoalForTransition,
    refreshGoal,
  ]);

  useEffect(() => {
    const matchesConversation = (event: globalThis.Event) =>
      String((event as CustomEvent<{ conversationId?: string }>).detail?.conversationId ?? '') ===
      String(conversation.id);
    const stopVoiceInput = (event: globalThis.Event) => {
      if (!matchesConversation(event)) return;
      speechRecognitionRef.current?.stop();
    };
    const startVoiceInput = (event: globalThis.Event) => {
      if (!matchesConversation(event)) return;
      speechRecognitionRef.current?.abort();
      const Recognition =
        (
          window as typeof window & {
            webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
            SpeechRecognition?: BrowserSpeechRecognitionConstructor;
          }
        ).SpeechRecognition ??
        (
          window as typeof window & {
            webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
          }
        ).webkitSpeechRecognition;
      if (!Recognition) {
        setVoiceInputActive(false);
        setLocalErrors((current) => [
          ...current,
          {
            id: `voice-unavailable-${Date.now()}`,
            role: 'system',
            tone: 'warning',
            text: '当前系统未提供语音识别服务。',
            timestamp: new Date().toISOString(),
          },
        ]);
        return;
      }

      const recognition = new Recognition();
      const prefix = inputValueRef.current.trimEnd();
      recognition.lang = navigator.language || 'zh-CN';
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onresult = (resultEvent) => {
        let transcript = '';
        for (let index = 0; index < resultEvent.results.length; index += 1) {
          transcript += resultEvent.results[index]?.[0]?.transcript ?? '';
        }
        setInput(`${prefix}${prefix && transcript ? ' ' : ''}${transcript}`);
        window.requestAnimationFrame(() => inputRef.current?.focus());
      };
      recognition.onerror = ({ error }) => {
        if (error === 'aborted' || error === 'no-speech') return;
        setLocalErrors((current) => [
          ...current,
          {
            id: `voice-error-${Date.now()}`,
            role: 'system',
            tone: 'warning',
            text: `语音输入失败: ${error}`,
            timestamp: new Date().toISOString(),
          },
        ]);
      };
      recognition.onend = () => {
        setVoiceInputActive(false);
        if (speechRecognitionRef.current === recognition) speechRecognitionRef.current = null;
      };
      speechRecognitionRef.current = recognition;
      try {
        recognition.start();
        setVoiceInputActive(true);
        inputRef.current?.focus();
      } catch (error) {
        setVoiceInputActive(false);
        speechRecognitionRef.current = null;
        setLocalErrors((current) => [
          ...current,
          {
            id: `voice-start-${Date.now()}`,
            role: 'system',
            tone: 'warning',
            text: `语音输入启动失败: ${error instanceof Error ? error.message : String(error)}`,
            timestamp: new Date().toISOString(),
          },
        ]);
      }
    };

    window.addEventListener('shell-voice-input-start', startVoiceInput);
    window.addEventListener('shell-voice-input-stop', stopVoiceInput);
    return () => {
      window.removeEventListener('shell-voice-input-start', startVoiceInput);
      window.removeEventListener('shell-voice-input-stop', stopVoiceInput);
      speechRecognitionRef.current?.abort();
      speechRecognitionRef.current = null;
      setVoiceInputActive(false);
    };
  }, [conversation.id, setLocalErrors]);
  const handlePlanNotify = useCallback((tone: 'info' | 'error', text: string) => {
    setLocalErrors((prev) => [
      ...prev,
      {
        id: `plan-notify-${Date.now()}`,
        role: 'system',
        tone,
        text,
        timestamp: new Date().toISOString(),
      },
    ]);
  }, []);
  const handlePlanUpdated = useCallback(
    (plan: ConversationPlanSummary | undefined) => {
      setConversationPlan(plan);
      // 方案取消/批准收尾：plan 消失且仍有挂起的 plan-review ask 时取消该
      // 问询，让规划 run 恢复（不再强制要求用户在只读卡上二次确认）。
      if (!plan && pendingAsk && planReviewOf(pendingAsk.questions)) {
        const api = bridge();
        if (api?.conversationAskCancel) {
          void api.conversationAskCancel({ askId: pendingAsk.askId }).catch(() => undefined);
        }
        setPendingAsk(undefined);
      }
    },
    [pendingAsk],
  );
  const lastAskAnsweredSeqRef = useRef(0);
  useEffect(() => {
    const answeredEvents = eventHistory.filter((e) => e.type === 'conversation.ask_answered');
    const latest = answeredEvents[answeredEvents.length - 1];
    if (!latest) return;
    const seq = Number(latest.sequence);
    if (!Number.isFinite(seq) || seq <= lastAskAnsweredSeqRef.current) return;
    lastAskAnsweredSeqRef.current = seq;
    const questions = Array.isArray(latest.payload?.questions) ? latest.payload.questions : [];
    const answers = Array.isArray(latest.payload?.answers) ? latest.payload.answers : [];
    if (questions.length === 0 || answers.length === 0) return;
    // 已由 §12.18 方案卡接管（submit 过 plan）的 plan-review ask，其「确认执行」
    // 由方案卡批准流程回答 → 跳过事件路径，避免双重发起执行轮。
    const answeredAskId =
      latest.payload && typeof latest.payload === 'object'
        ? (latest.payload as Record<string, unknown>).askId
        : undefined;
    if (typeof answeredAskId === 'string' && planReviewAskIdRef.current === answeredAskId) return;
    executeApprovedPlanReview(questions as AskQuestion[], answers as AskQuestionAnswer[]);
  }, [eventHistory, executeApprovedPlanReview]);

  const {
    queuedComposeRequests,
    dispatchingQueuedRequestId,
    blockedQueuedRequestId,
    queuedRequestDispatchError,
    commitQueuedComposeRequests,
    handleEditQueuedComposeRequest,
    handleDeleteQueuedComposeRequest,
    handleInterjectQueuedComposeRequest,
  } = useComposeRequestQueue({
    conversationId: String(conversation.id),
    modelOverride,
    runIsActive,
    waitingForThread: Boolean(conversation.taskId && !threadId),
    sendUserText,
  });

  const regenerationRead = useRef<AbortController>();
  useEffect(
    () => () => {
      regenerationRead.current?.abort();
      regenerationRead.current = undefined;
    },
    [conversation.id],
  );

  const handleRegenerate = useCallback(
    async (assistantMessageId: string, nextModelId?: string) => {
      if (sending || regenerationRead.current) return;
      const idx = messages.findIndex((m) => m.id === assistantMessageId);
      if (idx <= 0) return;
      // Find nearest previous user message (NewMax: regenerate last turn).
      let userMessage: ChatMessage | undefined;
      for (let i = idx - 1; i >= 0; i -= 1) {
        if (messages[i]?.role === 'user') {
          userMessage = messages[i];
          break;
        }
      }
      if (!userMessage?.text.trim()) return;
      const controller = new AbortController();
      const conversationId = String(conversation.id);
      regenerationRead.current = controller;
      try {
        const text = await resolveMessageText(
          userMessage.textParts,
          userMessage.text,
          conversationId,
          controller.signal,
        );
        if (controller.signal.aborted || activeConversationIdRef.current !== conversationId) return;
        await sendUserText(text, [], {
          skillVersionIds: userMessage.skillVersionIds ?? [],
          ...(nextModelId ? { modelOverride: nextModelId } : {}),
        });
      } catch (error) {
        if (!controller.signal.aborted && activeConversationIdRef.current === conversationId)
          setLocalErrors((previous) => [
            ...previous,
            {
              id: 'regenerate-read-' + Date.now(),
              role: 'system',
              tone: 'error',
              text:
                '读取原始提示失败，未重新发送：' +
                (error instanceof Error ? error.message : String(error)),
              timestamp: new Date().toISOString(),
            },
          ]);
      } finally {
        if (regenerationRead.current === controller) regenerationRead.current = undefined;
      }
    },
    [conversation.id, messages, sendUserText, sending, setLocalErrors],
  );

  const handleContinueInterrupted = useCallback(
    async (assistantMessageId: string) => {
      if (sending) return;
      const idx = messages.findIndex((message) => message.id === assistantMessageId);
      const previousUser =
        idx > 0
          ? [...messages.slice(0, idx)].reverse().find((message) => message.role === 'user')
          : undefined;
      // A user may attach the image after the interrupted assistant row has
      // already been rendered (the common “读图 → 继续回答” flow). Prefer
      // that newer image request over the older coding/task prompt that
      // originally produced the interruption.
      const laterImageUser =
        idx >= 0
          ? [...messages.slice(idx + 1)]
              .reverse()
              .find((message) => message.role === 'user' && (message.images?.length ?? 0) > 0)
          : undefined;
      const continuationSource = laterImageUser ?? previousUser;
      let continuationImages = continuationSource?.images ?? [];
      if (continuationImages.length > 0) {
        const inlineImages = continuationImages.every((image) =>
          /^data:image\/[A-Za-z0-9.+-]+;base64,/.test(image.url),
        );
        if (!inlineImages) {
          const api = bridge();
          const controller = new AbortController();
          try {
            const draft = await prepareApprovalRequestDraft(
              continuationSource!,
              String(conversation.id),
              controller.signal,
              api?.readApprovalRequestImage,
            );
            continuationImages = messageImagesFromAttachments(draft.attachments);
          } catch (error) {
            setLocalErrors((previous) => [
              ...previous,
              {
                id: `continue-image-recovery-${Date.now()}`,
                role: 'system',
                tone: 'error',
                text:
                  '继续回答时读取原图片失败，未发送空的续答请求：' +
                  (error instanceof Error ? error.message : String(error)),
                timestamp: new Date().toISOString(),
              },
            ]);
            return;
          }
        }
      }
      await sendUserText('继续上一条未完成的回答。', continuationImages, {
        skillVersionIds: continuationSource?.skillVersionIds ?? [],
      });
    },
    [conversation.id, messages, sendUserText, sending, setLocalErrors],
  );

  const handleChooseModelAndRetry = useCallback((assistantMessageId: string) => {
    setRetryAfterModelPickMessageId(assistantMessageId);
    setMenu('model');
  }, []);

  const boundWorkspace = conversation.workspaceId
    ? workspaces.find((workspace) => workspace.workspaceId === conversation.workspaceId)
    : undefined;
  const projectFolder = boundWorkspace?.folderPath?.trim();
  const hasProjectFolder = Boolean(projectFolder);

  const closeSlash = useCallback(() => {
    setSlash(null);
    setSlashIndex(-1);
    setSlashCategory('all');
    setResolvedSlashItems([]);
  }, []);

  const closeComposePickers = useCallback(() => {
    closeSlash();
    setMcpMenuOpen(false);
    setComposerAddOpen(false);
    setMenu(null);
  }, [closeSlash]);

  const slashCommands = useMemo(() => (slash ? filterSlashCommands(slash.query) : []), [slash]);
  const filteredSlashSkills = useMemo(() => {
    if (!slash) return [];
    const query = slash.query.trim().toLocaleLowerCase();
    return slashSkills.filter((skill) => {
      if (skill.enabled === false) return false;
      if (!query) return true;
      return [skill.name, skill.description, skill.skillId, skill.version]
        .join('\n')
        .toLocaleLowerCase()
        .includes(query);
    });
  }, [slash, slashSkills]);
  const slashCandidateItemCount = slashCommands.length + filteredSlashSkills.length;
  const slashMenuOpen = Boolean(
    slash &&
    (!slash.query.trim() ||
      slashCandidateItemCount > 0 ||
      slashSkillsLoading ||
      !slashSkillsResolved),
  );
  const composerSlashCommand = parseSlashCommand(input);
  const helpCommandPreview =
    composerSlashCommand.kind === 'help' || composerSlashCommand.kind === 'help-with-request';
  const planCommandPreview =
    composerSlashCommand.kind === 'plan' || composerSlashCommand.kind === 'plan-with-request';
  const goalCommandPreview =
    composerSlashCommand.kind === 'goal' || composerSlashCommand.kind === 'goal-with-condition';
  const visibleGoal =
    activeGoalState?.goal && ['active', 'paused', 'blocked'].includes(activeGoalState.goal.status)
      ? activeGoalState.goal
      : undefined;
  const goalIsActive = visibleGoal?.status === 'active';
  useEffect(() => {
    if (!goalIsActive) return;
    speechRecognitionRef.current?.abort();
    setVoiceInputActive(false);
  }, [goalIsActive]);
  const composerPendingAsk =
    pendingAsk &&
    !(
      activeConversationPlan?.state === 'draft' &&
      planReviewAskIdRef.current === pendingAsk.askId &&
      planReviewOf(pendingAsk.questions)
    )
      ? pendingAsk
      : undefined;
  const detectedModeKeywordHint = parseComposerModeKeywordHint(input);
  const modeKeywordHint =
    detectedModeKeywordHint &&
    dismissedModeHintText !== input &&
    !helpCommandPreview &&
    !planCommandPreview &&
    !goalCommandPreview &&
    interactionMode !== 'plan' &&
    !visibleGoal &&
    !slashMenuOpen &&
    !mcpMenuOpen &&
    !composerAddOpen &&
    !menu &&
    !composerPendingAsk &&
    activeConversationPlan?.state !== 'draft' &&
    pendingApprovals.length === 0 &&
    compactProgress?.status !== 'running'
      ? detectedModeKeywordHint
      : null;
  const selectedSlashSkills = useMemo(
    () =>
      selectedSkillVersionIds
        .map((skillVersionId) =>
          slashSkills.find((skill) => skill.skillVersionId === skillVersionId),
        )
        .filter((skill): skill is SkillVersionSummary => Boolean(skill)),
    [selectedSkillVersionIds, slashSkills],
  );
  const referencedSkillVersionIds = useMemo(
    () => [...new Set(messages.flatMap((message) => message.skillVersionIds ?? []))],
    [messages],
  );
  const shouldLoadSlashSkills =
    Boolean(slash) || selectedSkillVersionIds.length > 0 || referencedSkillVersionIds.length > 0;
  const skillNameByVersionId = useMemo(
    () => new Map(slashSkills.map((skill) => [skill.skillVersionId, skill.name] as const)),
    [slashSkills],
  );

  useEffect(() => {
    if (!shouldLoadSlashSkills) {
      setSlashSkillsLoading(false);
      setSlashSkillsResolved(false);
      return;
    }
    const api = bridge();
    if (!api?.listSkills) {
      setSlashSkillsLoading(false);
      setSlashSkillsResolved(true);
      return;
    }
    let cancelled = false;
    setSlashSkillsLoading(true);
    void loadSkillCatalog(api, { workspaceId: conversation.workspaceId })
      .then((response) => {
        if (!cancelled) {
          // Older Runtime payloads omit `enabled`; treat omission as enabled
          // so the slash palette remains backward-compatible with the Skill
          // picker and with persisted catalog snapshots.
          setSlashSkills(response.skills);
        }
      })
      .catch(() => {
        if (!cancelled) setSlashSkills([]);
      })
      .finally(() => {
        if (!cancelled) {
          setSlashSkillsLoading(false);
          setSlashSkillsResolved(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [conversation.workspaceId, shouldLoadSlashSkills]);

  useLayoutEffect(() => {
    if (!slashMenuOpen) return;
    keepListboxOptionVisible(slashListRef.current, slashIndex);
  }, [resolvedSlashItems.length, slashIndex, slashMenuOpen]);

  // Tick while compacting so the capsule can show NewMax-style elapsed time.
  useEffect(() => {
    if (!compactProgress) return;
    setCompactNow(Date.now());
    const id = window.setInterval(() => setCompactNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [compactProgress]);

  // Position the / menu as a fixed portal above the compose box (same as @).
  useLayoutEffect(() => {
    if (!slashMenuOpen) return;
    const update = () => {
      const el = composeRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // NewMax keeps the command sheet aligned to the complete composer edge.
      // Clamp only when the viewport is narrower than the composer so the
      // portal remains usable on compact windows.
      const width = Math.min(r.width, window.innerWidth - 16);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const gap = 8;
      const maxH = Math.min(420, Math.max(120, r.top - gap - 8));
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
    return listenForFrameCoalescedViewportChange(update);
  }, [slashMenuOpen]);

  useLayoutEffect(() => {
    if (!mcpMenuOpen) return;
    const update = () => {
      const el = composeRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const width = Math.min(rect.width, window.innerWidth - 16);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const gap = 8;
      setMcpMenuStyle({
        position: 'fixed',
        left,
        width,
        bottom: window.innerHeight - rect.top + gap,
        maxHeight: Math.min(420, Math.max(120, rect.top - gap - 8)),
        zIndex: 10001,
      });
    };
    update();
    return listenForFrameCoalescedViewportChange(update);
  }, [mcpMenuOpen]);

  useEffect(() => {
    setMcpMenuOpen(false);
  }, [conversation.id]);

  const resizeComposeInput = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    computeTextareaHeight(el, 36, 200);
  }, []);

  useLayoutEffect(() => {
    resizeComposeInput();
  }, [input, resizeComposeInput]);

  const acceptModeKeywordHint = useCallback(() => {
    const next = withComposerModeKeywordHint(input);
    if (next === input) return;
    setDismissedModeHintText(null);
    setInput(next);
    closeComposePickers();
    window.requestAnimationFrame(() => {
      resizeComposeInput();
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(next.length, next.length);
    });
  }, [closeComposePickers, input, resizeComposeInput]);

  const handleNetworkSettingChange = useCallback(
    (enabled: boolean) => {
      setNetEnabled(enabled);
      writeConversationNetworkEnabled(String(conversation.id), enabled);
    },
    [conversation.id],
  );

  const selectSlashCommand = useCallback(
    (cmd: SlashCommand) => {
      if (!slash) return;
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

      if (cmd.kind === 'action' || cmd.kind === 'panel') {
        const stripped = stripSlashToken(input, slash);
        setInput(stripped.text);
        closeComposePickers();
        if (cmd.kind === 'panel') setMcpMenuOpen(true);
        window.requestAnimationFrame(() => {
          resizeComposeInput();
          const el = inputRef.current;
          if (!el) return;
          el.focus();
          el.setSelectionRange(stripped.caret, stripped.caret);
        });
        if (cmd.kind === 'action') {
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
          } else {
            void runManualCompact();
          }
        }
        return;
      }

      const replacement = replaceSlashTokenWithCommand(input, slash, cmd.command);
      setInput(replacement.text);
      closeComposePickers();
      window.requestAnimationFrame(() => {
        resizeComposeInput();
        const el = inputRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(replacement.caret, replacement.caret);
        }
      });
    },
    [attachments.length, closeComposePickers, input, resizeComposeInput, runManualCompact, slash],
  );

  const selectSlashSkill = useCallback(
    (skill: SkillVersionSummary) => {
      if (!slash) return;
      const stripped = stripSlashToken(input, slash);
      setInput(stripped.text);
      setSelectedSkillVersionIds((current) => {
        const normalized = resolveAppendSkillVersionIds(conversation.track, current);
        return normalized.includes(skill.skillVersionId)
          ? normalized.filter((id) => id !== skill.skillVersionId)
          : resolveAppendSkillVersionIds(conversation.track, [...normalized, skill.skillVersionId]);
      });
      closeComposePickers();
      window.requestAnimationFrame(() => {
        resizeComposeInput();
        const el = inputRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(stripped.caret, stripped.caret);
        }
      });
    },
    [closeComposePickers, conversation.track, input, resizeComposeInput, slash],
  );

  const startGoalFromShortcut = useCallback(
    async (condition: string) => {
      const api = bridge();
      if (!api?.setGoal) throw new Error('当前 Runtime 不支持目标模式');
      const goalModelId = resolveSendModelId({
        modelOverride,
        track: conversation.track,
        targetRef: conversation.targetRef,
        catalogModelIds: models.map((model) => model.modelId),
      });
      await api.setConversationInteractionMode?.({
        conversationId: conversation.id,
        interactionMode: 'execute',
      });
      setInteractionMode('execute');
      await api.setGoal({
        conversationId: String(conversation.id),
        condition,
        maxGoalRounds: DEFAULT_GOAL_SETTINGS.maxGoalRounds,
        maxGoalTokens: DEFAULT_GOAL_SETTINGS.maxGoalTokens,
        ...(goalModelId ? { modelId: goalModelId } : {}),
        kernelId: kernelOverride,
        reasoningEffort,
        networkEnabled: netEnabled,
      });
      await refreshGoal();
      setLocalErrors((errors) => [
        ...errors,
        {
          id: `goal-set-${Date.now()}`,
          role: 'system',
          tone: 'success',
          text: '目标已设置：将按目标状态持续推进',
          timestamp: new Date().toISOString(),
        },
      ]);
    },
    [
      conversation.id,
      conversation.targetRef,
      conversation.track,
      kernelOverride,
      modelOverride,
      models,
      netEnabled,
      reasoningEffort,
      refreshGoal,
    ],
  );

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || isCompacting()) return;

    const slashCmd = parseSlashCommand(text);
    const isGoalTransitionCommand =
      slashCmd.kind === 'plan' ||
      slashCmd.kind === 'plan-with-request' ||
      slashCmd.kind === 'execute' ||
      slashCmd.kind === 'goal-clear';
    if (activeGoalState?.goal?.status === 'active' && !isGoalTransitionCommand) return;

    // 上一轮的发送失败/错误气泡不跨轮贴底：新消息发送时清掉，避免“报错无法消除”。
    setLocalErrors((prev) => prev.filter((error) => error.tone !== 'error'));

    // NewMax: `/compact` manually compresses context without sending a chat turn.
    if (slashCmd.kind === 'help') {
      setInput('/help ');
      closeComposePickers();
      window.requestAnimationFrame(() => {
        resizeComposeInput();
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(6, 6);
      });
      return;
    }
    if (slashCmd.kind === 'help-with-request') {
      const snapshot = attachments;
      const images = messageImagesFromAttachments(snapshot);
      setInput('');
      closeComposePickers();
      window.requestAnimationFrame(() => resizeComposeInput());
      try {
        await sendUserText(slashCmd.request, images, { helpMode: true });
        setAttachments([]);
      } catch {
        setInput(`/help ${slashCmd.request}`);
        setAttachments(snapshot);
        window.requestAnimationFrame(() => resizeComposeInput());
      }
      return;
    }

    if (slashCmd.kind === 'mcp') {
      setInput('');
      closeComposePickers();
      setMcpMenuOpen(true);
      window.requestAnimationFrame(() => {
        resizeComposeInput();
        inputRef.current?.focus();
      });
      return;
    }

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
      if (isCompacting()) {
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

    // NewMax `/goal`: goal mode only triggers when the input starts with /goal.
    if (
      slashCmd.kind === 'goal' ||
      slashCmd.kind === 'goal-with-condition' ||
      slashCmd.kind === 'goal-clear'
    ) {
      if (attachments.length > 0) {
        setLocalErrors((errs) => [
          ...errs,
          {
            id: `goal-attach-${Date.now()}`,
            role: 'system',
            tone: 'warning',
            text: '执行 /goal 前请先移除附件',
            timestamp: new Date().toISOString(),
          },
        ]);
        return;
      }
      if (
        slashCmd.kind === 'goal-with-condition' &&
        slashCmd.condition.length <= 4000 &&
        goalRequiresRiskConfirmation(slashCmd.condition)
      ) {
        setPendingRiskGoal(slashCmd.condition);
        closeComposePickers();
        inputRef.current?.blur();
        return;
      }
      const api = bridge();
      const conversationId = String(conversation.id);
      try {
        if (slashCmd.kind === 'goal-clear') {
          if (!api?.clearGoal) return;
          await api.clearGoal({ conversationId });
          await refreshGoal();
          setLocalErrors((errs) => [
            ...errs,
            {
              id: `goal-cleared-${Date.now()}`,
              role: 'system',
              tone: 'success',
              text: '目标已清除',
              timestamp: new Date().toISOString(),
            },
          ]);
        } else if (slashCmd.kind === 'goal-with-condition') {
          if (slashCmd.condition.length > 4000) {
            setLocalErrors((errs) => [
              ...errs,
              {
                id: `goal-len-${Date.now()}`,
                role: 'system',
                tone: 'warning',
                text: '目标条件过长（最多 4000 字符）',
                timestamp: new Date().toISOString(),
              },
            ]);
            return;
          }
          await startGoalFromShortcut(slashCmd.condition);
        } else {
          // NewMax treats a bare mode command as a preview toggle. Sending it
          // without a body simply closes the preview and leaves no chat row.
        }
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error);
        setLocalErrors((errs) => [
          ...errs,
          {
            id: `goal-err-${Date.now()}`,
            role: 'system',
            tone: 'error',
            text: `目标模式操作失败: ${raw}`,
            timestamp: new Date().toISOString(),
          },
        ]);
      } finally {
        setInput('');
        closeComposePickers();
        window.requestAnimationFrame(() => resizeComposeInput());
      }
      return;
    }

    // NewMax `/plan` / `/execute`: switch the conversation interaction work mode.
    if (
      slashCmd.kind === 'plan' ||
      slashCmd.kind === 'plan-with-request' ||
      slashCmd.kind === 'execute'
    ) {
      if (attachments.length > 0) {
        setLocalErrors((errs) => [
          ...errs,
          {
            id: `plan-attach-${Date.now()}`,
            role: 'system',
            tone: 'warning',
            text: '执行 /plan 或 /execute 前请先移除附件',
            timestamp: new Date().toISOString(),
          },
        ]);
        return;
      }
      const api = bridge();
      try {
        if (slashCmd.kind === 'execute') {
          await api?.setConversationInteractionMode?.({
            conversationId: conversation.id,
            interactionMode: 'execute',
          });
          setInteractionMode('execute');
          setLocalErrors((errs) => [
            ...errs,
            {
              id: `execute-mode-${Date.now()}`,
              role: 'system',
              tone: 'success',
              text: '已切换到执行模式：可直接完成任务；若存在待审批计划，请到计划卡批准或取消',
              timestamp: new Date().toISOString(),
            },
          ]);
        } else if (slashCmd.kind === 'plan-with-request') {
          if (activeGoalState?.goal?.status === 'active' && !(await pauseGoalForTransition()))
            return;
          await api?.setConversationInteractionMode?.({
            conversationId: conversation.id,
            interactionMode: 'plan',
          });
          setInteractionMode('plan');
          setLocalErrors((errs) => [
            ...errs,
            {
              id: `plan-mode-${Date.now()}`,
              role: 'system',
              tone: 'info',
              text: '已进入规划模式（只读）：正在分析并准备可审批计划',
              timestamp: new Date().toISOString(),
            },
          ]);
          // Persist Plan before the request so the run is born in native plan mode.
          await sendUserText(slashCmd.request, []);
        } else {
          // Bare /plan only dismisses the local preview in NewMax.
        }
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error);
        setLocalErrors((errs) => [
          ...errs,
          {
            id: `plan-err-${Date.now()}`,
            role: 'system',
            tone: 'error',
            text: `规划/执行模式切换失败: ${raw}`,
            timestamp: new Date().toISOString(),
          },
        ]);
      } finally {
        setInput('');
        closeComposePickers();
        window.requestAnimationFrame(() => resizeComposeInput());
      }
      return;
    }

    if (!ensureKernelExecution(kernelOverride)) return;
    const snapshot = attachments;
    if (runIsActive) {
      const request = createQueuedComposeRequest({
        conversationId: String(conversation.id),
        text: input,
        attachments: snapshot,
        modelOverride,
        reasoningEffort,
        networkEnabled: netEnabled,
        skillVersionIds: selectedSkillVersionIds,
        kernelOverride,
      });
      commitQueuedComposeRequests((current) => enqueueQueuedComposeRequest(current, request));
      setInput('');
      setAttachments([]);
      closeComposePickers();
      window.requestAnimationFrame(() => resizeComposeInput());
      return;
    }

    const draft = { text: input, attachments: snapshot };
    setInput('');
    closeComposePickers();
    window.requestAnimationFrame(() => resizeComposeInput());
    await sendDraft(draft, sendUserText);
  }, [
    attachments,
    closeComposePickers,
    commitQueuedComposeRequests,
    ensureKernelExecution,
    conversation.id,
    sendDraft,
    activeGoalState,
    input,
    isCompacting,
    kernelOverride,
    modelOverride,
    netEnabled,
    pauseGoalForTransition,
    reasoningEffort,
    refreshGoal,
    resizeComposeInput,
    runIsActive,
    runManualCompact,
    selectedSkillVersionIds,
    sendUserText,
    startGoalFromShortcut,
  ]);

  const confirmRiskGoal = useCallback(async () => {
    if (!pendingRiskGoal || riskGoalSubmissionRef.current) return;
    riskGoalSubmissionRef.current = true;
    setRiskGoalSubmitting(true);
    try {
      await startGoalFromShortcut(pendingRiskGoal);
      setPendingRiskGoal(null);
      setInput('');
      closeComposePickers();
      window.requestAnimationFrame(() => {
        resizeComposeInput();
        inputRef.current?.focus();
      });
    } catch (error) {
      setLocalErrors((errors) => [
        ...errors,
        {
          id: `goal-risk-${Date.now()}`,
          role: 'system',
          tone: 'error',
          text: `目标模式操作失败: ${error instanceof Error ? error.message : String(error)}`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      riskGoalSubmissionRef.current = false;
      setRiskGoalSubmitting(false);
    }
  }, [closeComposePickers, pendingRiskGoal, resizeComposeInput, startGoalFromShortcut]);

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
    // @ opens the shared + action sheet; / remains the slash/Skill palette.
    const nextMention = detectMentionQuery(text, caret);
    if (nextMention) {
      setComposerAddOpen(true);
      setSlash(null);
      setSlashIndex(-1);
      return;
    }
    setComposerAddOpen(false);
    const nextSlash = detectSlashQuery(text, caret);
    setSlash(nextSlash);
    setSlashIndex(nextSlash ? 0 : -1);
  }, []);

  const insertComposeToken = useCallback(
    (token: '@' | '/') => {
      const el = inputRef.current;
      const start = el?.selectionStart ?? input.length;
      const end = el?.selectionEnd ?? start;
      const before = input.slice(0, start);
      const after = input.slice(end);
      const separator = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
      const prefix = `${before}${separator}`;
      const next = `${prefix}${token}${after}`;
      const caret = prefix.length + token.length;
      setMenu(null);
      setMcpMenuOpen(false);
      suppressPickerRefreshRef.current = true;
      setInput(next);
      updatePickersFromCaret(next, caret);
      window.requestAnimationFrame(() => {
        resizeComposeInput();
        const inputElement = inputRef.current;
        if (inputElement) {
          inputElement.focus();
          inputElement.setSelectionRange(caret, caret);
        }
        suppressPickerRefreshRef.current = false;
      });
    },
    [input, resizeComposeInput, updatePickersFromCaret],
  );

  const handleInputChange = useCallback(
    (value: string, caret: number) => {
      setMcpMenuOpen(false);
      setInput(value);
      if (suppressPickerRefreshRef.current) return;
      if (composerAddOpen) {
        closeSlash();
        return;
      }
      updatePickersFromCaret(value, caret);
    },
    [closeSlash, composerAddOpen, updatePickersFromCaret],
  );

  const handleEditorSelectionChange = useCallback(
    (caret: number) => {
      if (suppressPickerRefreshRef.current) return;
      if (composerAddOpen) return;
      // ComposerEditor publishes selection in the same native input event as
      // the new text. Read the DOM value first so picker detection never sees
      // the previous controlled-render snapshot.
      updatePickersFromCaret(inputRef.current?.value ?? inputValueRef.current, caret);
    },
    [composerAddOpen, updatePickersFromCaret],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Tab' && e.shiftKey && modeKeywordHint) {
        e.preventDefault();
        acceptModeKeywordHint();
        return;
      }
      if (mcpMenuOpen && e.key === 'Escape') {
        e.preventDefault();
        setMcpMenuOpen(false);
        return;
      }

      // / slash-command menu navigation.
      if (slash && slashMenuOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeSlash();
          return;
        }
        const action = resolveComposerSlashMenuKeyboardAction({
          key: e.key,
          shiftKey: e.shiftKey,
          isComposing: e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229,
          category: slashCategory,
          availableCategories: availableSlashCategories,
          activeIndex: slashIndex,
          itemCount: Math.max(resolvedSlashItems.length, slashCandidateItemCount),
        });
        if (action) {
          e.preventDefault();
          if (action.kind === 'change-category') {
            setSlashCategory(action.category);
            setSlashIndex(-1);
          } else if (action.kind === 'change-active-index') {
            setSlashIndex(action.index);
          } else {
            const selected =
              resolvedSlashItems[action.index] ??
              (slashCommands[action.index]
                ? { kind: 'command' as const, command: slashCommands[action.index] }
                : filteredSlashSkills[action.index - slashCommands.length]
                  ? {
                      kind: 'skill' as const,
                      skill: filteredSlashSkills[action.index - slashCommands.length],
                    }
                  : undefined);
            if (selected?.kind === 'command') selectSlashCommand(selected.command);
            else if (selected?.kind === 'skill') selectSlashSkill(selected.skill);
          }
          return;
        }
      }

      // Esc while the model is streaming = stop generation (NewMax parity).
      if (e.key === 'Escape' && !slash) {
        if (projected.streaming && !stopping) {
          e.preventDefault();
          void handleStop();
          return;
        }
      }

      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        void handleSend();
      }
    },
    [
      acceptModeKeywordHint,
      availableSlashCategories,
      closeSlash,
      handleSend,
      handleStop,
      modeKeywordHint,
      mcpMenuOpen,
      projected.streaming,
      selectSlashCommand,
      slash,
      slashCandidateItemCount,
      slashCommands,
      filteredSlashSkills,
      slashCategory,
      slashMenuOpen,
      resolvedSlashItems,
      slashIndex,
      selectSlashSkill,
      stopping,
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

  const composerMode: 'plan' | 'goal' | null = goalCommandPreview
    ? 'goal'
    : planCommandPreview
      ? 'plan'
      : interactionMode === 'plan'
        ? 'plan'
        : visibleGoal
          ? 'goal'
          : null;
  const configuredModelLabel = (modelId: string | null | undefined) => {
    if (!modelId) return activeModel;
    return models.find((model) => model.modelId === modelId)?.displayName ?? modelId;
  };
  const planBannerModelLabel =
    planActSetting?.enabled && planActSetting.planModelId
      ? configuredModelLabel(planActSetting.planModelId)
      : activeModel;
  const actBannerModelLabel =
    planActSetting?.enabled && planActSetting.actModelId
      ? configuredModelLabel(planActSetting.actModelId)
      : activeModel;
  const composerModelSelection = resolveComposerModelSelection({
    planMode: composerMode === 'plan',
    setting: planActSetting,
    currentModelId: activeModelId,
    currentReasoningEffort: reasoningEffort,
  });
  const composerModelLabel = configuredModelLabel(composerModelSelection.modelId);
  const promptEnhancementShortcutEnabled = usePromptEnhancementShortcutEnabled();
  const promptEnhancement = usePromptEnhancement({
    value: input,
    onValueChange: setInput,
    enabled: agentPreferences.promptEnhancementEnabled && promptEnhancementShortcutEnabled,
    configuredModelId: agentPreferences.promptEnhancementModelId,
    currentModelId: activeModelId,
    models,
    disabled:
      sending ||
      runIsActive ||
      Boolean(composerPendingAsk) ||
      goalIsActive ||
      activeConversationPlan?.state === 'draft' ||
      pendingApprovals.length > 0 ||
      compactProgress?.status === 'running',
  });
  const updatePlanActSetting = (next: ComposerPlanActSetting) => {
    const previous = planActSetting;
    setPlanActSetting(next);
    const api = bridge();
    if (!api?.setSetting) return;
    void api.setSetting({ key: 'plan-act', value: next }).catch(() => setPlanActSetting(previous));
  };

  const openGoalSettings = (mode: 'create' | 'edit') => {
    const parsed = parseSlashCommand(input);
    const draftCondition = parsed.kind === 'goal-with-condition' ? parsed.condition : '';
    const current = mode === 'edit' ? visibleGoal : undefined;
    setGoalSettingsMode(mode);
    setGoalSettingsInitial({
      condition: current?.condition ?? draftCondition,
      stopCondition: current?.stopCondition ?? '',
      maxGoalRounds: current?.maxGoalRounds ?? 10,
      maxGoalTokens: current?.maxGoalTokens ?? 1_000_000,
    });
    setGoalSettingsOpen(true);
  };

  const submitGoalSettings = async (values: GoalSettingsValues) => {
    const api = bridge();
    if (!api?.setGoal || goalSettingsSubmitting) return;
    setGoalSettingsSubmitting(true);
    try {
      await api.setConversationInteractionMode?.({
        conversationId: conversation.id,
        interactionMode: 'execute',
      });
      setInteractionMode('execute');
      const result = await api.setGoal({
        conversationId: String(conversation.id),
        ...values,
        ...(activeModelId
          ? { modelId: activeModelId as Parameters<typeof api.setGoal>[0]['modelId'] }
          : {}),
        kernelId: kernelOverride as Parameters<typeof api.setGoal>[0]['kernelId'],
        reasoningEffort,
        networkEnabled: netEnabled,
      });
      setGoalState({ goal: result.goal, evaluatorConfigured: result.evaluatorConfigured });
      setGoalSettingsOpen(false);
      setInput('');
      closeComposePickers();
      window.requestAnimationFrame(() => {
        resizeComposeInput();
        inputRef.current?.focus();
      });
    } catch (error) {
      setLocalErrors((errors) => [
        ...errors,
        {
          id: `goal-settings-${Date.now()}`,
          role: 'system',
          tone: 'error',
          text: `目标设置失败: ${error instanceof Error ? error.message : String(error)}`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setGoalSettingsSubmitting(false);
    }
  };

  const composerModeBanner =
    composerMode === 'plan' ? (
      <ComposerModeBanner
        mode="plan"
        planModelLabel={planBannerModelLabel}
        actModelLabel={actBannerModelLabel}
        onOpenPlanSettings={() => onOpenPlanSettings?.()}
        onExitPlan={() => {
          setInput(withoutComposerModeCommand(input, 'plan'));
          if (interactionMode === 'plan') void handlePlanSwitchMode('execute');
          window.requestAnimationFrame(() => {
            resizeComposeInput();
            inputRef.current?.focus();
          });
        }}
      />
    ) : composerMode === 'goal' ? (
      <ComposerModeBanner
        mode="goal"
        goal={visibleGoal}
        pendingCondition={
          composerSlashCommand.kind === 'goal-with-condition'
            ? composerSlashCommand.condition
            : undefined
        }
        onConfigureGoal={() => openGoalSettings(visibleGoal ? 'edit' : 'create')}
        onPauseGoal={
          visibleGoal?.status === 'active' ? () => void pauseGoalForTransition() : undefined
        }
        onResumeGoal={
          visibleGoal && ['paused', 'blocked'].includes(visibleGoal.status)
            ? () => {
                const api = bridge();
                if (!api?.goalResume) return;
                void api
                  .goalResume({
                    conversationId: String(conversation.id),
                    ...(activeModelId
                      ? {
                          modelId: activeModelId as Parameters<typeof api.goalResume>[0]['modelId'],
                        }
                      : {}),
                    kernelId: kernelOverride as Parameters<typeof api.goalResume>[0]['kernelId'],
                    reasoningEffort,
                    networkEnabled: netEnabled,
                  })
                  .then(refreshGoal);
              }
            : undefined
        }
        onClearGoal={() => {
          if (!visibleGoal) {
            const next = withoutComposerModeCommand(input, 'goal');
            setInput(next);
            window.requestAnimationFrame(() => {
              resizeComposeInput();
              inputRef.current?.focus();
            });
            return;
          }
          const api = bridge();
          if (!api?.clearGoal) return;
          void api.clearGoal({ conversationId: String(conversation.id) }).then(async () => {
            if (canStop) await handleStop();
            refreshGoal();
          });
        }}
      />
    ) : undefined;

  // Runtime is the single source of truth for the ring. estimatedUsedTokens is
  // the complete context that would be sent on the next model request
  // (instructions + agent/team + project + saved summary + messages + tools),
  // not the latest turn's provider usage and not the cross-turn cumulative cost.
  //
  // External kernels (claude-code / codex) keep their history inside the spawned
  // process, so the host estimate has no relation to what they actually hold.
  // Prefer kernel.context_occupancy (Claude /context, Codex tokenUsage.last);
  // fall back to the last billed request input when the kernel did not report.
  const kernelContextOccupancy = useMemo(() => {
    let latest:
      | {
          usedTokens: number;
          windowTokens?: number;
          categories?: Array<{ name: string; tokens: number }>;
        }
      | undefined;
    let latestStamp = '';
    for (const [runId, process] of displayRunProcessById) {
      if (typeof process.contextWatermarkTokens !== 'number') continue;
      const kernelId = runKernelById.get(runId);
      // A conversation can switch between external kernels. A watermark from
      // another kernel describes a different native session and must not leak
      // into the currently selected context ring.
      if (!kernelId || kernelId === 'native' || kernelId !== kernelOverride) continue;
      const stamp = process.completedAt ?? process.startedAt ?? '';
      if (!latestStamp || stamp >= latestStamp) {
        latestStamp = stamp;
        latest = {
          usedTokens: process.contextWatermarkTokens,
          ...(typeof process.contextOccupancyWindowTokens === 'number'
            ? { windowTokens: process.contextOccupancyWindowTokens }
            : {}),
          ...(process.contextOccupancyCategories && process.contextOccupancyCategories.length > 0
            ? { categories: process.contextOccupancyCategories }
            : {}),
        };
      }
    }
    return latest;
  }, [displayRunProcessById, kernelOverride, runKernelById]);
  const kernelSelfManaged = kernelOverride !== 'native' && Boolean(kernelOverride);
  const contextUsed = kernelContextOccupancy?.usedTokens ?? contextStatus?.estimatedUsedTokens ?? 0;

  // Session metrics for the NewMax ring hover card (会话 耗时 / 用量).
  const sessionMetrics = useMemo(() => {
    return projectConversationUsageMetrics({
      events: eventHistory,
      threadId,
      taskId: conversation.taskId ? String(conversation.taskId) : undefined,
    });
  }, [conversation.taskId, eventHistory, threadId]);

  const PermIcon = PERMISSION_ICONS[permissionMode];

  // 对话对象（模型 / 智能体 / 小队）标识与换绑。
  const identityLabel = useMemo(() => {
    if (conversation.track === 'agent') {
      return conversationAgent?.name ?? '智能体';
    }
    if (conversation.track === 'team') {
      return conversationTeam?.name ?? '小队';
    }
    return '模型';
  }, [conversation.track, conversationAgent?.name, conversationTeam?.name]);
  const IdentityIcon =
    conversation.track === 'agent' ? Bot : conversation.track === 'team' ? Users : MessageSquare;
  const identityAvatar = conversationAgent ?? conversationTeam;
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
        setSelectedSkillVersionIds([]);
        onConversationUpdated?.();
      } catch (error) {
        toastApi.toast({
          type: 'error',
          title: '换绑对话失败',
          description: error instanceof Error ? error.message : String(error),
        });
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
  const showTyping = reconciledSending || projected.streaming;
  const canStop = Boolean(projected.activeRunId) && (reconciledSending || projected.streaming);
  // Active kernel display + pause degradation per capabilities.pause.
  const activeKernel = kernelRegistry?.find((kernel) => kernel.kernelId === kernelOverride) ?? null;
  // Effective ring window + source label: a non-overridable kernel native
  // limit still caps the ring; Claude Code now follows the model window.
  const displayedContext = resolveDisplayedContextWindow({
    catalogContextWindow: activeModelOption?.contextWindow,
    snapshotContextWindow: contextStatus?.contextWindow,
    snapshotModelContextWindow: contextStatus?.modelContextWindow,
    snapshotEstimated: contextStatus?.contextWindowEstimated === true,
    modelId: activeModelId || activeModel,
  });
  const contextModelWindow = displayedContext.modelContextWindow;
  const contextConfiguredWindow = displayedContext.contextWindow;
  const contextWindowCap = activeKernel?.capabilities?.contextWindow;
  const contextWindowCapped =
    contextStatus?.contextWindowSource === 'kernel-limit' ||
    (contextWindowCap !== undefined &&
      contextWindowCap.overridable === false &&
      contextConfiguredWindow > contextWindowCap.nativeLimit);
  const occupancyWindow = kernelContextOccupancy?.windowTokens;
  const contextLimit =
    occupancyWindow !== undefined && occupancyWindow > 0
      ? occupancyWindow
      : contextWindowCapped
        ? (contextWindowCap?.nativeLimit ?? contextConfiguredWindow)
        : contextConfiguredWindow;
  const contextWindowSource: 'configured' | 'kernel-capped' | 'estimated' | 'kernel-reported' =
    occupancyWindow !== undefined && occupancyWindow > 0
      ? 'kernel-reported'
      : displayedContext.estimated
        ? 'estimated'
        : contextWindowCapped
          ? 'kernel-capped'
          : 'configured';
  const stopTitle = activeKernel?.capabilities.pause
    ? activeKernel.capabilities.pause === 'executor'
      ? '暂停任务'
      : activeKernel.capabilities.pause === 'turn'
        ? '停止本轮（下条消息继续会话）'
        : activeKernel.capabilities.pause === 'session'
          ? '结束会话（下次消息新开会话）'
          : '终止内核进程'
    : '暂停任务';

  // 任务清单投影（对齐 DSH todo projection）：持久化事件流 → 常驻面板。
  const todoProjection = useMemo(
    () =>
      !threadId && !conversation.taskId
        ? null
        : projectTodoFromEvents(
            eventHistory,
            {
              threadId,
              taskId: conversation.taskId ? String(conversation.taskId) : undefined,
            },
            durableTaskPlan?.conversationId === String(conversation.id)
              ? durableTaskPlan.state
              : undefined,
          ),
    [conversation.id, conversation.taskId, durableTaskPlan, eventHistory, threadId],
  );

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* ─── Chat column ───────────────────────────────────────────── */}
      {/* min-w 从 360 降到 260：三栏（聊天列+文件分屏+右栏）同开时硬性下限
          之和必须小于中等窗口宽度，否则父容器 overflow:hidden 会裁掉行末的右栏。 */}
      <div className="shell-chat-column flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-chat">
        {!hasProjectFolder ? (
          <div className="shell-warning-banner border-b px-4 py-2 text-[12px] leading-relaxed">
            当前对话没有绑定本地项目文件夹，所以 AI 不能读取工作区目录。 请先在工作区 Tab
            选择/打开项目（带真实文件夹路径），再新建对话。
          </div>
        ) : null}

        {/* ─── Messages ───────────────────────────────────────────────── */}
        <div className="shell-chat-message-stage">
          <div
            ref={messagesScrollRef}
            className="shell-chat-content-wrap shell-chat-message-scroller h-full overflow-y-auto py-6"
            onPointerDown={() => stopNavigationSlide()}
            onWheel={(event) => {
              if (event.deltaY === 0) return;
              stopNavigationSlide();
              const scroller = event.currentTarget;
              userScrollRevisionRef.current += 1;
              bottomPinIntentRef.current = event.deltaY > 0 ? 'toward-bottom' : 'away-from-bottom';
              if (
                shouldReleaseStickOnWheel({
                  deltaY: event.deltaY,
                  nearBottom: isConversationNearBottom({
                    scrollTop: scroller.scrollTop,
                    scrollHeight: scroller.scrollHeight,
                    clientHeight: scroller.clientHeight,
                  }),
                })
              ) {
                stickToBottomRef.current = false;
              }
            }}
            onTouchStart={(event) => {
              stopNavigationSlide();
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
                  const scroller = event.currentTarget;
                  if (
                    !isConversationNearBottom({
                      scrollTop: scroller.scrollTop,
                      scrollHeight: scroller.scrollHeight,
                      clientHeight: scroller.clientHeight,
                    })
                  ) {
                    stickToBottomRef.current = false;
                  }
                }
              }
              lastTouchClientYRef.current = currentClientY ?? null;
            }}
            onTouchEnd={() => {
              lastTouchClientYRef.current = null;
            }}
            onKeyDown={(event) => {
              stopNavigationSlide();
              if (event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === 'End') {
                userScrollRevisionRef.current += 1;
                bottomPinIntentRef.current = 'toward-bottom';
              } else if (
                event.key === 'ArrowUp' ||
                event.key === 'PageUp' ||
                event.key === 'Home'
              ) {
                userScrollRevisionRef.current += 1;
                bottomPinIntentRef.current = 'away-from-bottom';
                stickToBottomRef.current = false;
              }
            }}
            onScroll={(event) => {
              const scroller = event.currentTarget;
              durableMessageWindow.syncViewport();
              const currentScrollTop = scroller.scrollTop;
              const programmaticTarget = programmaticScrollTargetRef.current;
              const isProgrammatic =
                programmaticScrollPendingRef.current ||
                (programmaticTarget !== null &&
                  Math.abs(currentScrollTop - programmaticTarget) <= 1);
              if (!isProgrammatic) stopNavigationSlide();
              if (programmaticTarget !== null) {
                programmaticScrollTargetRef.current = null;
              }
              const nextStick = applyConversationStickOnScroll({
                sticky: stickToBottomRef.current,
                programmaticPending: isProgrammatic,
                previousScrollTop: lastObservedScrollTopRef.current,
                scrollTop: currentScrollTop,
                scrollHeight: scroller.scrollHeight,
                clientHeight: scroller.clientHeight,
              });
              if (!nextStick.sticky && stickToBottomRef.current) {
                userScrollRevisionRef.current += 1;
                bottomPinIntentRef.current = 'away-from-bottom';
              }
              stickToBottomRef.current = nextStick.sticky;
              programmaticScrollPendingRef.current = nextStick.programmaticPending;
              lastObservedScrollTopRef.current = currentScrollTop;
              bottomPinIntentRef.current = null;

              scheduleScrollPositionSave();
              syncJumpToLatest();
            }}
          >
            {messages.length === 0 && !showTyping ? (
              !initialLoaded ? (
                <ConversationLoadingSkeleton />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <span className="text-[13px] text-text-faint">发送消息开始对话</span>
                </div>
              )
            ) : null}
            {/* Keep message column and compose at the same content width. */}
            <div ref={messagesContentRef} className="shell-chat-content mx-auto flex flex-col">
              {(hiddenDurableMessageCount > 0 || hasMore) && (
                <div className="flex items-center justify-center py-2">
                  <button
                    type="button"
                    className="shell-history-load-earlier"
                    disabled={loadingMore}
                    onClick={handleLoadEarlierMessages}
                  >
                    {loadingMore
                      ? '正在加载…'
                      : hiddenDurableMessageCount > 0
                        ? `加载更早消息（${hiddenDurableMessageCount}）`
                        : '加载更早消息'}
                  </button>
                </div>
              )}
              {kernelCompactionEvents.length > 0
                ? (() => {
                    const latestKernelCompaction = kernelCompactionEvents.at(-1)!;
                    const compactState =
                      latestKernelCompaction.type === 'kernel.context_compaction_started'
                        ? 'running'
                        : latestKernelCompaction.type === 'kernel.context_compaction_failed'
                          ? 'failure'
                          : 'success';
                    const compactLabel =
                      compactState === 'running'
                        ? '内核正在压缩上下文'
                        : compactState === 'failure'
                          ? '内核压缩上下文失败'
                          : '内核已自动压缩上下文';
                    const compactError = nonEmptyString(latestKernelCompaction.payload.error);
                    return (
                      <div
                        className="shell-kernel-compact-note"
                        data-status={compactState}
                        data-testid="kernel-compact-note"
                      >
                        <Info size={13} />
                        <span>
                          {compactLabel}
                          {latestKernelCompaction.occurredAt
                            ? `（${formatMessageClock(latestKernelCompaction.occurredAt)}）`
                            : ''}
                          {compactState === 'success'
                            ? '—— 更早的对话细节已由内核摘要保留，可继续提问。'
                            : compactError
                              ? `—— ${compactError}`
                              : ''}
                        </span>
                      </div>
                    );
                  })()
                : null}
              {durableMessageWindow.topSpacer > 0 ? (
                <div
                  aria-hidden="true"
                  data-message-window-spacer="top"
                  style={{ height: durableMessageWindow.topSpacer }}
                />
              ) : null}
              {windowedDurableMessages.map((msg) => (
                <div
                  key={msg.id}
                  ref={durableMessageWindow.rowRef(msg.id)}
                  data-virtual-message-id={msg.id}
                  data-message-id={msg.id}
                  data-process-run-id={msg.role === 'assistant' ? msg.runId : undefined}
                  className="shell-message-window-item pb-6"
                  data-message-role={msg.role}
                >
                  {gapBeforeMessage.has(msg.id) ? (
                    <div
                      className="shell-history-gap"
                      data-history-gap={gapBeforeMessage.get(msg.id)}
                    >
                      <span>这两段之间的历史消息尚未加载</span>
                      <button
                        type="button"
                        disabled={loadingMore}
                        onClick={() => void loadHistoryGap(gapBeforeMessage.get(msg.id)!)}
                      >
                        {loadingMore ? '正在加载…' : '加载中间消息'}
                      </button>
                    </div>
                  ) : null}
                  <MessageBubble
                    message={msg}
                    waitingForApproval={Boolean(msg.runId && approvalWaitingRunIds.has(msg.runId))}
                    processView={msg.runId ? displayRunProcessById.get(msg.runId) : undefined}
                    processLoadFailure={
                      msg.runId ? runProcessLoadFailures.get(msg.runId) : undefined
                    }
                    onRetryProcess={retryRunProcess}
                    models={models}
                    agents={agents}
                    runAgentIdentity={
                      msg.runId ? runAgentIdentityById.get(String(msg.runId)) : undefined
                    }
                    fallbackAgent={conversationAgent}
                    regenerating={sending}
                    onRegenerate={handleRegenerate}
                    onContinue={handleContinueInterrupted}
                    onChooseModelAndRetry={handleChooseModelAndRetry}
                    onOpenChange={onOpenFile}
                    conversationId={String(conversation.id)}
                    onOpenHtmlInBrowser={onOpenHtmlInBrowser}
                    onOpenWebUrl={onOpenWebUrl}
                    onOpenReview={onOpenReview}
                    projectFolder={projectFolder}
                    onOpenImage={openImageLightbox}
                    kernelId={
                      msg.kernelId ?? (msg.runId ? runKernelById.get(String(msg.runId)) : undefined)
                    }
                    skillNameByVersionId={skillNameByVersionId}
                    agentPreferences={agentPreferences}
                  />
                </div>
              ))}
              {durableMessageWindow.bottomSpacer > 0 ? (
                <div
                  aria-hidden="true"
                  data-message-window-spacer="bottom"
                  style={{ height: durableMessageWindow.bottomSpacer }}
                />
              ) : null}
              {standaloneRuntimeConnectionNotice ? (
                <div className="pb-4">
                  <div
                    className="shell-run-connection-status shell-run-connection-status--standalone"
                    data-state={standaloneRuntimeConnectionNotice.state}
                    role="status"
                    aria-live="polite"
                  >
                    {standaloneRuntimeConnectionNotice.state === 'failed' ? (
                      <AlertCircle size={12} aria-hidden="true" />
                    ) : (
                      <RefreshCw size={12} aria-hidden="true" />
                    )}
                    <span>{standaloneRuntimeConnectionNotice.text}</span>
                  </div>
                </div>
              ) : null}
              {liveMessages.map((msg) => (
                <div
                  key={msg.id}
                  data-message-id={msg.id}
                  data-process-run-id={msg.role === 'assistant' ? msg.runId : undefined}
                  className="shell-message-window-item pb-6"
                  data-message-role={msg.role}
                >
                  <MessageBubble
                    message={msg}
                    waitingForApproval={Boolean(msg.runId && approvalWaitingRunIds.has(msg.runId))}
                    processView={msg.runId ? displayRunProcessById.get(msg.runId) : undefined}
                    processLoadFailure={
                      msg.runId ? runProcessLoadFailures.get(msg.runId) : undefined
                    }
                    onRetryProcess={retryRunProcess}
                    models={models}
                    agents={agents}
                    runAgentIdentity={
                      msg.runId ? runAgentIdentityById.get(String(msg.runId)) : undefined
                    }
                    fallbackAgent={conversationAgent}
                    regenerating={sending}
                    onRegenerate={handleRegenerate}
                    onContinue={handleContinueInterrupted}
                    onChooseModelAndRetry={handleChooseModelAndRetry}
                    onOpenChange={onOpenFile}
                    conversationId={String(conversation.id)}
                    onOpenHtmlInBrowser={onOpenHtmlInBrowser}
                    onOpenWebUrl={onOpenWebUrl}
                    onOpenReview={onOpenReview}
                    projectFolder={projectFolder}
                    onOpenImage={openImageLightbox}
                    kernelId={
                      msg.kernelId ?? (msg.runId ? runKernelById.get(String(msg.runId)) : undefined)
                    }
                    skillNameByVersionId={skillNameByVersionId}
                    agentPreferences={agentPreferences}
                    dismissLocalError={undefined}
                  />
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {loadingHistoryTarget ? (
            <div className="shell-history-status" role="status" aria-live="polite">
              <span>正在读取目标附近的消息…</span>
            </div>
          ) : null}

          <ScrollToBottomButton
            visible={jumpToLatestVisible}
            unread={jumpToLatestUnread}
            onScrollToBottom={handleJumpToLatest}
          />
        </div>

        <ConversationMinimapRail
          key={historyScopeKey}
          items={navigationItems}
          scrollerRef={messagesScrollRef}
          onNavigate={handleNavigateMessage}
          onLoadItem={loadNavigationTarget}
        />

        {/* ─── Compose (NewMax-style) ─────────────────────────────────── */}
        <div className="shell-chat-content-wrap shrink-0 pb-4 pt-2">
          <div className="shell-chat-content shell-chat-content--composer mx-auto">
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
            {!compactProgress &&
            kernelSelfManaged &&
            contextLimit > 0 &&
            contextUsed / contextLimit >= 0.85 ? (
              <div
                className="shell-compact-capsule"
                data-mode="kernel-near-limit"
                data-status="idle"
                data-testid="context-near-limit"
              >
                <Info size={13} />
                <span>
                  上下文接近窗口上限（{formatCompactCount(contextLimit)}），内核可能自动压缩
                </span>
              </div>
            ) : null}
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
            {interactionMode !== 'plan' ? (
              <ComposerTaskPanel scopeKey={String(conversation.id)} todo={todoProjection} />
            ) : null}
            <ExpiredToolApprovalNotice
              approvals={runtimeExpiredApprovals.filter(
                (approval) => String(approval.threadId) === threadId,
              )}
              total={expiredApprovalCount}
              busy={Boolean(recoveringApprovalId)}
              onRecover={(approval) => void handleRecoverApproval(approval)}
            />
            <ComposerApprovalStack
              hasSurfaceBelow={Boolean(composerModeBanner)}
              tool={
                pendingApprovals[0]
                  ? {
                      key: pendingApprovals[0].approvalId,
                      node: (
                        <ToolApprovalCard
                          approval={pendingApprovals[0]}
                          busy={decidingApprovalId === pendingApprovals[0].approvalId}
                          onApprove={(scope) =>
                            void handleToolApproval(
                              pendingApprovals[0]!.approvalId,
                              'approve',
                              scope,
                            )
                          }
                          onDeny={() =>
                            void handleToolApproval(pendingApprovals[0]!.approvalId, 'deny', 'once')
                          }
                        />
                      ),
                    }
                  : undefined
              }
              plan={
                activeConversationPlan?.state === 'draft'
                  ? {
                      key: `${activeConversationPlan.planId}:${activeConversationPlan.currentRevision}`,
                      node: (
                        <PlanApprovalCard
                          variant="composer"
                          conversationId={conversation.id}
                          plan={activeConversationPlan}
                          onPlanUpdated={handlePlanUpdated}
                          onExecute={handlePlanExecute}
                          onSwitchMode={handlePlanSwitchMode}
                          onNotify={handlePlanNotify}
                        />
                      ),
                    }
                  : undefined
              }
            />
            <NewMaxComposerFrame
              variant="conversation"
              modeBanner={composerModeBanner}
              className={`relative ${dragOver ? 'is-dragover' : ''}`}
              data-layout="tall"
              innerRef={composeRef}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              {modeKeywordHint ? (
                <ComposerModeKeywordHint
                  kind={modeKeywordHint.kind}
                  onAccept={acceptModeKeywordHint}
                  onDismiss={() => setDismissedModeHintText(input)}
                />
              ) : null}
              {/* / slash command menu — one shared NewMax menu in both entry points. */}
              {slashPopStyle &&
                typeof document !== 'undefined' &&
                createPortal(
                  <ComposerSlashMenu
                    open={slashMenuOpen}
                    skills={slashSkills}
                    loading={slashSkillsLoading}
                    query={slash?.query ?? lastSlashQueryRef.current}
                    selectedSkillVersionIds={selectedSkillVersionIds}
                    activeIndex={slashIndex}
                    onActiveIndexChange={setSlashIndex}
                    category={slashCategory}
                    onCategoryChange={setSlashCategory}
                    onAvailableCategoriesChange={setAvailableSlashCategories}
                    onResolvedItemsChange={setResolvedSlashItems}
                    onCommand={selectSlashCommand}
                    onSkill={selectSlashSkill}
                    onCreateSkill={() => {
                      closeComposePickers();
                      onCreateSkill?.();
                    }}
                    style={slashPopStyle}
                    placement="above"
                    testId="compose-slash-pop"
                    listRef={slashListRef}
                  />,
                  document.body,
                )}
              {mcpMenuStyle &&
                typeof document !== 'undefined' &&
                createPortal(
                  <ComposerMcpMenu
                    open={mcpMenuOpen}
                    style={mcpMenuStyle}
                    onDismiss={() => {
                      setMcpMenuOpen(false);
                      window.requestAnimationFrame(() => inputRef.current?.focus());
                    }}
                    onOpenSettings={() => onOpenMcpSettings?.()}
                  />,
                  document.body,
                )}

              {failedComposeDrafts.length > 0 && (
                <div className="shell-compose__draft-recovery" role="status">
                  <span>发送失败的草稿已保留，恢复会追加到当前输入。</span>
                  <button
                    type="button"
                    onClick={() => {
                      restoreFailedDrafts();
                      window.requestAnimationFrame(() => inputRef.current?.focus());
                    }}
                  >
                    恢复未发送草稿
                  </button>
                </div>
              )}

              <ComposeRequestQueue
                items={queuedComposeRequests}
                activeRun={runIsActive}
                dispatchingId={dispatchingQueuedRequestId}
                blockedId={blockedQueuedRequestId}
                dispatchError={queuedRequestDispatchError}
                onEdit={handleEditQueuedComposeRequest}
                onDelete={handleDeleteQueuedComposeRequest}
                onInterject={handleInterjectQueuedComposeRequest}
              />

              {/* ask_user_question alone replaces the editor; plan/tool approvals stay in ComposerApprovalStack above. */}
              {composerPendingAsk ? (
                <AskQuestionCard
                  ask={composerPendingAsk}
                  onSettled={() => setPendingAsk(undefined)}
                />
              ) : (
                <div className="shell-compose__editor-area">
                  <ComposerEditor
                    value={input}
                    inputElementRef={inputRef}
                    inputTestId="compose-input"
                    testId="conversation-composer-editor"
                    placeholder={
                      hasProjectFolder
                        ? '输入消息…（输入 @ 引用文件，/ 打开快捷面板）'
                        : '输入消息…（输入 / 打开快捷面板）'
                    }
                    attachments={attachments}
                    selectedSkills={selectedSlashSkills}
                    minHeight={36}
                    maxHeight={200}
                    disabled={compactProgress?.status === 'running'}
                    goalRunning={goalIsActive}
                    onChange={(value, selection) => handleInputChange(value, selection.start)}
                    onSelectionChange={({ start }) => handleEditorSelectionChange(start)}
                    onKeyDown={(event) => {
                      if (tryHandlePromptEnhancementShortcut(event, promptEnhancement)) return;
                      handleKeyDown(event);
                    }}
                    onPaste={handlePaste}
                    onOpenAttachment={(attachment) => {
                      if (attachment.kind === 'image' && attachment.previewUrl) {
                        openImageLightbox({
                          id: attachment.path,
                          name: attachment.name,
                          url: attachment.previewUrl,
                          mimeType: attachment.mimeType,
                        });
                        return;
                      }
                      if (attachment.kind === 'file') onOpenFile?.(attachment.path);
                    }}
                    onRemoveAttachment={(path) =>
                      setAttachments((current) => removeAttachment(current, path))
                    }
                    onRemoveSkill={(skillVersionId) =>
                      setSelectedSkillVersionIds((current) =>
                        current.filter((selected) => selected !== skillVersionId),
                      )
                    }
                    enhancing={promptEnhancement.busy}
                    trailingAction={
                      promptEnhancement.visible ? (
                        <PromptEnhancementAction
                          enhancement={promptEnhancement}
                          testId="compose-prompt-enhance"
                        />
                      ) : undefined
                    }
                  />
                </div>
              )}

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
              <div
                ref={composerToolbar.outerRef}
                className="shell-compose__bar"
                data-testid="compose-toolbar"
                data-collapse-level={composerToolbar.collapseLevel}
              >
                <div ref={composerToolbar.leftRef} className="shell-compose__bar-left">
                  <ComposerAddControl
                    variant="conversation"
                    open={composerAddOpen}
                    inputRef={inputRef}
                    composerRef={composeRef}
                    value={input}
                    onValueChange={setInput}
                    onOpenChange={setComposerAddOpen}
                    onBeforeOpen={closeComposePickers}
                    workspaceFolder={projectFolder}
                    selectedFilePaths={attachments
                      .filter((attachment) => attachment.kind !== 'image')
                      .map((attachment) => attachment.path)}
                    networkEnabled={netEnabled}
                    permissionMode={permissionMode}
                    showPermissionItems={
                      composerToolbar.collapseLevel >= PERMISSION_MODE_COLLAPSED_TOOLBAR_LEVEL
                    }
                    disabled={Boolean(composerPendingAsk) || compactProgress?.status === 'running'}
                    attachDisabled={
                      attachments.filter((attachment) => attachment.kind === 'image').length >= 8
                    }
                    onAttach={() => imageInputRef.current?.click()}
                    onPlan={() =>
                      window.dispatchEvent(
                        new CustomEvent('shell-toggle-plan-mode', {
                          detail: { conversationId: conversation.id },
                        }),
                      )
                    }
                    onGoal={() =>
                      window.dispatchEvent(
                        new CustomEvent('shell-toggle-goal-mode', {
                          detail: { conversationId: conversation.id },
                        }),
                      )
                    }
                    onNetworkChange={handleNetworkSettingChange}
                    onPermissionChange={setPermission}
                    onFile={(file) =>
                      setAttachments((current) =>
                        current.some((attachment) => attachment.path === file.path)
                          ? removeAttachment(current, file.path)
                          : addAttachment(current, {
                              path: file.path,
                              name: file.name || fileNameFromPath(file.path),
                              kind: file.kind,
                            }),
                      )
                    }
                    triggerTestId="compose-add-trigger"
                    menuTestId="compose-add-menu"
                  />
                  {helpCommandPreview ? (
                    <ComposerActiveModePill
                      mode="help"
                      onClick={() => {
                        const next = input.replace(/^\s*\/help(?:\s+|$)/i, '');
                        setInput(next);
                        window.requestAnimationFrame(() => {
                          resizeComposeInput();
                          inputRef.current?.focus();
                          inputRef.current?.setSelectionRange(next.length, next.length);
                        });
                      }}
                    />
                  ) : null}
                  {planCommandPreview || interactionMode === 'plan' ? (
                    <ComposerActiveModePill
                      mode="plan"
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent('shell-toggle-plan-mode', {
                            detail: { conversationId: conversation.id },
                          }),
                        )
                      }
                    />
                  ) : null}
                  {goalCommandPreview || visibleGoal ? (
                    <ComposerActiveModePill
                      mode="goal"
                      goalStatus={visibleGoal?.status}
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent('shell-toggle-goal-mode', {
                            detail: { conversationId: conversation.id },
                          }),
                        )
                      }
                    />
                  ) : null}
                  {/* Permission menu */}
                  <div
                    ref={composerToolbar.permissionRef}
                    className="shell-compose__tool-wrap"
                    data-testid="compose-permission-control"
                    hidden={
                      composerToolbar.collapseLevel >= PERMISSION_MODE_COLLAPSED_TOOLBAR_LEVEL
                    }
                  >
                    <button
                      ref={permissionBtnRef}
                      type="button"
                      className="shell-compose__tool"
                      data-active={permissionMode === 'full-access' ? '1' : '0'}
                      data-open={menu === 'permission' ? '1' : '0'}
                      aria-haspopup="menu"
                      aria-expanded={menu === 'permission'}
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

                  <div
                    className="shell-compose__tool-wrap"
                    data-testid="compose-skill-control"
                    hidden={composerToolbar.collapseLevel >= SKILL_COLLAPSED_TOOLBAR_LEVEL}
                  >
                    <TurnSkillControl
                      owner={skillOwner}
                      workspaceId={conversation.workspaceId}
                      open={menu === 'skill'}
                      selectedSkillVersionIds={selectedSkillVersionIds}
                      onShortcut={() => insertComposeToken('/')}
                      shortcutActive={slashMenuOpen}
                      onOpenChange={(open) => setMenu(open ? 'skill' : null)}
                      onChange={setSelectedSkillVersionIds}
                    />
                  </div>
                </div>

                <div ref={composerToolbar.rightRef} className="shell-compose__bar-right">
                  {/* 对话对象选择器：模型 / 智能体 / 小队（rebindTarget 换绑） */}
                  <div className="shell-compose__tool-wrap">
                    <button
                      ref={identityBtnRef}
                      type="button"
                      className="shell-compose__tool"
                      data-active={conversation.track !== 'model' ? '1' : '0'}
                      data-open={menu === 'identity' ? '1' : '0'}
                      aria-haspopup="menu"
                      aria-expanded={menu === 'identity'}
                      data-testid="compose-identity"
                      onClick={() => setMenu((m) => (m === 'identity' ? null : 'identity'))}
                      title={`对话对象：${identityLabel}`}
                    >
                      {identityAvatar?.avatar?.trim() ? (
                        <AgentAvatarView
                          name={identityAvatar.name}
                          avatar={identityAvatar.avatar}
                          size={18}
                        />
                      ) : (
                        <IdentityIcon size={15} />
                      )}
                      <span className="shell-compose__tool-label">{identityLabel}</span>
                    </button>
                    <IdentityPickerMenu
                      open={menu === 'identity'}
                      agents={agents.map((a) => ({
                        id: String(a.id),
                        name: a.name,
                        description: a.description,
                        avatar: a.avatar,
                      }))}
                      teams={teams.map((t) => ({
                        id: String(t.id),
                        name: t.name,
                        description: t.mission,
                        avatar: t.avatar,
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
                    kernelId={kernelOverride === 'native' ? undefined : kernelOverride}
                    kernelLabel={
                      kernelOverride === 'native'
                        ? undefined
                        : resolveKernelDisplayName(kernelOverride, activeKernel?.name)
                    }
                    modelContextWindow={contextModelWindow}
                    contextWindowEstimated={displayedContext.estimated}
                    contextWindowSource={contextWindowSource}
                    // External kernels report the authoritative watermark;
                    // the Runtime snapshot ratio describes the host estimate
                    // and must not override it in ContextRing.
                    usageRatio={
                      kernelSelfManaged ||
                      contextStatus?.contextWindow !== displayedContext.contextWindow
                        ? undefined
                        : contextStatus?.usageRatio
                    }
                    compactThreshold={contextStatus?.compactThreshold}
                    compactedAt={contextStatus?.compactedAt}
                    sections={contextStatus?.sections}
                    kernelSelfManaged={kernelSelfManaged}
                    occupancySections={kernelContextOccupancy?.categories}
                    sessionDurationMs={sessionMetrics.durationMs}
                    sessionTokens={
                      durableUsageSummary
                        ? durableUsageSummary.totalTokens
                        : sessionMetrics.requestCount > 0
                          ? sessionMetrics.totalTokens
                          : undefined
                    }
                  />

                  {/* Two-level model picker */}
                  <div className="shell-compose__tool-wrap">
                    <ModelPickerMenu
                      open={menu === 'model'}
                      models={models}
                      selectedModelId={composerModelSelection.modelId}
                      defaultLabel={composerModelLabel}
                      reasoningEffort={composerModelSelection.reasoningEffort}
                      kernels={kernelRegistry ?? undefined}
                      selectedKernelId={kernelOverride}
                      kernelInstallStates={kernelInstallStates}
                      anchorEl={modelBtnRef.current}
                      trigger={
                        <ModelTrigger
                          label={composerModelLabel}
                          reasoningLabel={REASONING_LABELS[composerModelSelection.reasoningEffort]}
                          mode={interactionMode}
                          planLabel={planBannerModelLabel}
                          planReasoningLabel={
                            REASONING_LABELS[composerModelSelection.reasoningEffort]
                          }
                          open={menu === 'model'}
                          buttonRef={modelBtnRef}
                          onClick={() => {
                            setRetryAfterModelPickMessageId(undefined);
                            setMenu((m) => (m === 'model' ? null : 'model'));
                          }}
                        />
                      }
                      onClose={() => {
                        setRetryAfterModelPickMessageId(undefined);
                        setMenu(null);
                      }}
                      onInstallKernel={(kernelId) => void installKernel(kernelId)}
                      onPickKernel={(kernelId) => {
                        // The old snapshot belongs to the previous kernel. Drop
                        // it immediately so the ring never presents a stale
                        // capacity while the Runtime builds the new snapshot.
                        // Kernel override is local-only — do not refresh the
                        // whole workspace catalog here; that races the snapshot
                        // rebuild and the 5s IPC budget.
                        contextStatusLoadGenerationRef.current += 1;
                        setContextStatus(null);
                        setKernelOverride(kernelId);
                        writeConversationKernelOverride(String(conversation.id), kernelId);
                      }}
                      onPick={(modelId) => {
                        if (composerModelSelection.routed && planActSetting) {
                          updatePlanActSetting({ ...planActSetting, planModelId: modelId });
                          return;
                        }
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
                        const retryMessageId = retryAfterModelPickMessageId;
                        if (retryMessageId) {
                          setRetryAfterModelPickMessageId(undefined);
                          void handleRegenerate(retryMessageId, modelId);
                        }
                      }}
                      onReasoningChange={(value) => {
                        if (composerModelSelection.routed && planActSetting) {
                          updatePlanActSetting({ ...planActSetting, planReasoningEffort: value });
                          return;
                        }
                        setReasoningEffort(value);
                        writeConversationReasoningEffort(String(conversation.id), value);
                      }}
                    />
                    {kernelOverride !== 'native'
                      ? (() => {
                          const chipLabel = resolveKernelDisplayName(
                            kernelOverride,
                            activeKernel?.name,
                          );
                          const chipLogo = resolveKernelBrandLogo(
                            activeKernel ? activeKernel.icon : kernelOverride,
                          );
                          return (
                            <span
                              className={`shell-kernel-chip${chipLogo ? ' shell-kernel-chip--logo' : ''}`}
                              data-testid="compose-kernel-chip"
                              title={`内核：${chipLabel}`}
                              aria-label={chipLogo ? `内核：${chipLabel}` : undefined}
                              role={chipLogo ? 'img' : undefined}
                            >
                              {chipLogo ? <BrandLogoMark logo={chipLogo} size={18} /> : chipLabel}
                            </span>
                          );
                        })()
                      : null}
                  </div>

                  <ComposerActionSlot
                    hasContent={!goalIsActive && Boolean(input.trim() || attachments.length > 0)}
                    running={canStop}
                    voiceActive={voiceInputActive}
                    voiceDisabled={goalIsActive || compactProgress?.status === 'running'}
                    sendDisabled={goalIsActive || compactProgress?.status === 'running'}
                    stopDisabled={stopping}
                    stopLabel={stopTitle}
                    onVoice={() => {
                      const eventName = voiceInputActive
                        ? 'shell-voice-input-stop'
                        : 'shell-voice-input-start';
                      window.dispatchEvent(
                        new CustomEvent(eventName, {
                          detail: { conversationId: conversation.id },
                        }),
                      );
                    }}
                    onSend={() => void handleSend()}
                    onStop={() => void handleStop()}
                  />
                </div>
              </div>
            </NewMaxComposerFrame>
          </div>
        </div>
      </div>
      {/* end chat column */}

      <GoalSettingsDialog
        open={goalSettingsOpen}
        mode={goalSettingsMode}
        initialValues={goalSettingsInitial}
        submitting={goalSettingsSubmitting}
        onOpenChange={setGoalSettingsOpen}
        onSubmit={submitGoalSettings}
      />
      <GoalRiskConfirmationDialog
        open={pendingRiskGoal !== null}
        submitting={riskGoalSubmitting}
        onOpenChange={(open) => {
          if (open || riskGoalSubmitting) return;
          setPendingRiskGoal(null);
          window.requestAnimationFrame(() => inputRef.current?.focus());
        }}
        onContinue={() => void confirmRiskGoal()}
      />

      {lightbox ? (
        <ImageLightbox
          open
          images={lightbox.images.map((image) => ({ src: image.url, alt: image.name || '图片' }))}
          activeIndex={lightbox.activeIndex}
          onChangeIndex={(activeIndex) =>
            setLightbox((current) => (current ? { ...current, activeIndex } : current))
          }
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </div>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

/**
 * Collapsible user-message text. Messages taller than USER_TEXT_COLLAPSE_HEIGHT
 * are collapsed by default with a height cap; the 显示更多 / 收起 toggle sits at
 * the bottom-left of the bubble. Short messages render as-is.
 */
const USER_TEXT_COLLAPSE_HEIGHT = 160;

const CollapsibleUserText = memo(function CollapsibleUserText({
  text,
  prefix,
  onOpenUrl,
}: {
  text: string;
  prefix?: ReactNode;
  onOpenUrl?: (url: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const [overflowing, setOverflowing] = useState(false);
  const innerRef = useRef<HTMLDivElement>(null);
  const parts = useMemo(() => splitUserMessageLinks(text), [text]);

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    // Inner is rendered at natural height; compare against the collapse cap.
    setOverflowing(el.scrollHeight > USER_TEXT_COLLAPSE_HEIGHT);
  }, [text]);

  const expanded = !collapsed || !overflowing;
  return (
    <div className="shell-user-text">
      <div
        ref={innerRef}
        className="shell-user-text__inner"
        data-collapsed={!expanded}
        style={expanded ? undefined : { maxHeight: USER_TEXT_COLLAPSE_HEIGHT }}
      >
        {prefix}
        {parts.map((part, index) =>
          part.type === 'url' ? (
            <WebTextLink key={`url-${index}`} url={part.value} onOpen={onOpenUrl} />
          ) : (
            <span key={`text-${index}`}>{part.value}</span>
          ),
        )}
      </div>
      {overflowing ? (
        <button
          type="button"
          className="shell-user-text__toggle"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded ? (
            <>
              <ChevronUp size={12} />
              <span>收起</span>
            </>
          ) : (
            <>
              <ChevronDown size={12} />
              <span>显示更多</span>
            </>
          )}
        </button>
      ) : null}
    </div>
  );
});

/** Provider reasoning summary, merged into the shared process panel. */
const ReasoningContent = memo(function ReasoningContent({
  text,
  streaming,
}: {
  text: string;
  streaming?: boolean;
}) {
  return (
    <div className="shell-process-group__reasoning-inner" data-testid="assistant-reasoning">
      <div className="shell-process-group__reasoning-label">
        <Brain size={12} aria-hidden="true" />
        <span>{streaming ? '正在思考…' : '思考过程'}</span>
      </div>
      <MarkdownContent text={text} streaming={Boolean(streaming)} />
    </div>
  );
});

function isTransientModelOverload(error?: string): boolean {
  return /overloaded|try again later|服务超载|服务器.*繁忙/i.test(error ?? '');
}

function HarnessTerminalNotice({
  state,
  error,
  busy,
  onContinue,
  onRetry,
}: {
  state: 'failed' | 'cancelled' | 'paused';
  error?: string;
  busy?: boolean;
  onContinue?(): void;
  onRetry?(): void;
}) {
  const errorSummary = error
    ?.split('\n')
    .find((line) => line.trim())
    ?.trim();
  if (state === 'cancelled') {
    return (
      <div
        className="shell-harness-terminal is-cancelled"
        data-testid="assistant-terminal-cancelled"
      >
        <span className="shell-harness-terminal__dot" aria-hidden="true" />
        <span className="shell-harness-terminal__title">回答已中断</span>
        <button type="button" disabled={busy} onClick={onContinue} aria-label="继续回答">
          <SendHorizonal size={12} aria-hidden="true" />
          <span>继续</span>
        </button>
        <button type="button" disabled={busy} onClick={onRetry} aria-label="重试回答">
          <RefreshCw size={12} aria-hidden="true" />
          <span>重试</span>
        </button>
      </div>
    );
  }
  if (state === 'paused') {
    // A pause is recoverable, so it must not read like a hard failure — and it
    // must be visible: the reason used to live only on a tool step that was
    // still running, so a pause between calls showed nothing at all.
    return (
      <details className="shell-harness-terminal is-paused" data-testid="assistant-terminal-paused">
        <summary>
          <span className="shell-harness-terminal__dot" aria-hidden="true" />
          <span className="shell-harness-terminal__title">已暂停</span>
          {errorSummary ? (
            <span
              className="shell-harness-terminal__summary"
              data-testid="assistant-terminal-error"
              title={error}
            >
              {errorSummary}
            </span>
          ) : null}
          <ChevronDown size={13} className="shell-harness-terminal__chevron" aria-hidden="true" />
        </summary>
        {error ? <pre className="shell-harness-terminal__detail">{error}</pre> : null}
        {onContinue || onRetry ? (
          <div className="shell-harness-terminal__actions">
            {onContinue ? (
              <button type="button" disabled={busy} onClick={onContinue} aria-label="继续回答">
                <SendHorizonal size={12} aria-hidden="true" />
                <span>继续</span>
              </button>
            ) : null}
            {onRetry ? (
              <button type="button" disabled={busy} onClick={onRetry} aria-label="重试回答">
                <RefreshCw size={12} aria-hidden="true" />
                <span>重试</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </details>
    );
  }
  const overloaded = isTransientModelOverload(error);
  return (
    <details className="shell-harness-terminal is-failed" data-testid="assistant-terminal-failed">
      <summary>
        <span className="shell-harness-terminal__dot" aria-hidden="true" />
        <span className="shell-harness-terminal__title">
          {overloaded ? '回答中断' : '运行失败'}
        </span>
        {errorSummary ? (
          <span
            className="shell-harness-terminal__summary"
            data-testid="assistant-terminal-error"
            title={error}
          >
            {overloaded ? '模型服务繁忙，回答没有写完。' : errorSummary}
          </span>
        ) : null}
        <ChevronDown size={13} className="shell-harness-terminal__chevron" aria-hidden="true" />
      </summary>
      {error ? <pre className="shell-harness-terminal__detail">{error}</pre> : null}
    </details>
  );
}

function ProviderAccountUsageSection({ identity }: { identity: ProviderUsageIdentity }) {
  const [windows, setWindows] = useState<ProviderUsageWindows | null>(null);
  const [balance, setBalance] = useState<ProviderBalanceView | null>(null);

  useEffect(() => {
    const api = bridge();
    if (!api?.getUsageSummary) return;
    let alive = true;
    void fetchProviderUsageWindows(
      (sinceDays) => api.getUsageSummary({ sinceDays, includeRequests: false }),
      identity,
    )
      .then((nextWindows) => {
        if (alive) setWindows(nextWindows);
      })
      .catch(() => {
        if (alive) setWindows(null);
      });
    return () => {
      alive = false;
    };
  }, [identity]);

  const providerId = identity.providerId;
  useEffect(() => {
    const api = bridge();
    if (!api?.queryProviderBalance || !providerId) {
      setBalance(null);
      return;
    }
    let alive = true;
    void fetchProviderBalanceView(providerId, () =>
      api.queryProviderBalance({
        providerId: providerId as ProviderBalancePayload['providerId'],
      }),
    )
      .then((view) => {
        if (alive) setBalance(view ?? null);
      })
      .catch(() => {
        if (alive) setBalance(null);
      });
    return () => {
      alive = false;
    };
  }, [providerId]);

  if (!balance && !windows?.today && !windows?.last30d) return null;
  return (
    <div className="shell-usage-tip__account" data-testid="provider-usage-windows">
      {balance ? (
        <div className="shell-usage-tip__account-row" data-testid="provider-balance">
          <span>{identity.providerName ?? '账户'} 余额</span>
          <strong>{balance.total}</strong>
        </div>
      ) : null}
      {balance?.toppedUp || balance?.granted ? (
        <div className="shell-usage-tip__account-row" data-testid="provider-balance-credits">
          {balance?.toppedUp ? <span>充值 {balance.toppedUp}</span> : null}
          {balance?.granted ? <span>赠送 {balance.granted}</span> : null}
        </div>
      ) : null}
      {windows?.today ? (
        <div className="shell-usage-tip__account-row">
          <span>今日</span>
          <strong>{formatProviderUsageWindow(windows.today)}</strong>
        </div>
      ) : null}
      {windows?.last30d ? (
        <div className="shell-usage-tip__account-row">
          <span>近30天</span>
          <strong>{formatProviderUsageWindow(windows.last30d)}</strong>
        </div>
      ) : null}
    </div>
  );
}

interface DelegatedAgentTaskView {
  childRunId: string;
  parallelGroup?: string;
  name: string;
  avatar: string;
  kind: 'existing';
  /** Agent Library id reused for this child run. */
  agentId: string;
  status: string;
  statusObservation?: DelegatedAgentProjection['statusObservation'];
  result?: string;
  toolEvents: DelegatedAgentToolEventView[];
  /** Tokens this child billed, summed over its own provider requests. */
  usage?: DelegatedAgentUsage;
  /** Wall-clock milliseconds this child has run. */
  durationMs?: number;
}

/** Read the usage block a child run reports, ignoring malformed fields. */
function parseDelegatedAgentUsage(value: unknown): DelegatedAgentUsage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const usage: DelegatedAgentUsage = {
    ...(typeof record.tokensIn === 'number' ? { tokensIn: record.tokensIn } : {}),
    ...(typeof record.tokensOut === 'number' ? { tokensOut: record.tokensOut } : {}),
    ...(typeof record.cachedTokensHit === 'number'
      ? { cachedTokensHit: record.cachedTokensHit }
      : {}),
    ...(typeof record.cachedTokensCreated === 'number'
      ? { cachedTokensCreated: record.cachedTokensCreated }
      : {}),
  };
  return Object.keys(usage).length > 0 ? usage : undefined;
}

/**
 * Chat tools that delegate one focused task to an Agent that already exists in
 * the Agent Library.
 *
 * The runtime executes both names through the same child-run path
 * (`executeDynamicAgentDelegation`) and returns the same payload — `childRunId`,
 * `assignment.kind === 'existing'`, `agentId`, `toolEvents`, `result` — so the
 * card must accept either. `agent_run` (the `agent-library` MCP tool) previously
 * fell through this gate: its card appeared only while the live transient
 * projection existed, and vanished as soon as the run settled, because the
 * durable process item was rejected here.
 */
const DELEGATION_TOOL_NAMES: ReadonlySet<string> = new Set(['agent_delegate', 'agent_run']);

function isDelegationToolName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (DELEGATION_TOOL_NAMES.has(normalized)) return true;
  return [...DELEGATION_TOOL_NAMES].some((toolName) => normalized.endsWith(`__${toolName}`));
}

/**
 * Read a delegation payload out of a tool result.
 *
 * The payload reaches the desktop in one of two shapes: the raw result JSON, or
 * the MCP content-block array (`[{ "type": "text", "text": "<json>" }]`) that the
 * kernel returns for a platform MCP tool — where the real payload sits inside
 * `text` as an escaped string. Unwrap the block form so the card works on either
 * path instead of silently rendering nothing.
 */
function readDelegationPayload(result: string): Record<string, unknown> | undefined {
  let value: unknown;
  try {
    value = JSON.parse(result);
  } catch {
    return undefined;
  }
  for (let depth = 0; depth < 2; depth += 1) {
    const blocks = Array.isArray(value)
      ? value
      : value &&
          typeof value === 'object' &&
          Array.isArray((value as { content?: unknown }).content)
        ? (value as { content: unknown[] }).content
        : undefined;
    if (!blocks) break;
    const text = blocks
      .flatMap((block) =>
        block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string'
          ? [(block as { text: string }).text]
          : [],
      )
      .join('');
    if (!text.trim()) return undefined;
    try {
      value = JSON.parse(text);
    } catch {
      return undefined;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseDelegatedAgentTask(item: InlineProcessItem): DelegatedAgentTaskView | undefined {
  if (item.kind !== 'tool' || !isDelegationToolName(item.name) || !item.result) {
    return undefined;
  }
  try {
    const value = readDelegationPayload(item.result);
    if (!value) return undefined;
    const assignment = value.assignment as Record<string, unknown> | undefined;
    if (typeof value.childRunId !== 'string' || !assignment) return undefined;
    if (assignment.kind !== 'existing') return undefined;
    const events = Array.isArray(value.toolEvents)
      ? value.toolEvents.flatMap((entry): DelegatedAgentToolEventView[] => {
          if (!entry || typeof entry !== 'object') return [];
          const record = entry as Record<string, unknown>;
          if (typeof record.toolName !== 'string') return [];
          return [
            {
              toolName: record.toolName,
              ...(typeof record.arguments === 'string' ? { arguments: record.arguments } : {}),
              ...(typeof record.status === 'string' ? { status: record.status } : {}),
              ...(typeof record.output === 'string' ? { output: record.output } : {}),
              ...(typeof record.startedAt === 'string' ? { startedAt: record.startedAt } : {}),
              ...(typeof record.completedAt === 'string'
                ? { completedAt: record.completedAt }
                : {}),
              ...(record.truncated === true ? { truncated: true } : {}),
              ...(record.argumentsTruncated === true ? { argumentsTruncated: true } : {}),
              ...(typeof record.argumentsCharacters === 'number'
                ? { argumentsCharacters: record.argumentsCharacters }
                : {}),
              ...(record.outputTruncated === true ? { outputTruncated: true } : {}),
              ...(typeof record.outputCharacters === 'number'
                ? { outputCharacters: record.outputCharacters }
                : {}),
            },
          ];
        })
      : [];
    const agentId = typeof assignment.agentId === 'string' ? assignment.agentId.trim() : '';
    if (!agentId) return undefined;
    return {
      childRunId: value.childRunId,
      ...(typeof value.parallelGroup === 'string' && value.parallelGroup.trim()
        ? { parallelGroup: value.parallelGroup.trim() }
        : {}),
      name: typeof assignment.name === 'string' ? assignment.name : '已配置智能体',
      avatar: typeof assignment.avatar === 'string' ? assignment.avatar : '🤖',
      kind: 'existing',
      agentId,
      status:
        typeof value.status === 'string'
          ? value.status
          : value.ok === false
            ? 'failed'
            : 'completed',
      ...(typeof value.result === 'string' && value.result.trim() ? { result: value.result } : {}),
      ...(parseDelegatedAgentUsage(value.usage)
        ? { usage: parseDelegatedAgentUsage(value.usage)! }
        : {}),
      ...(typeof value.durationMs === 'number' && Number.isFinite(value.durationMs)
        ? { durationMs: value.durationMs }
        : {}),
      toolEvents: events,
    };
  } catch {
    return undefined;
  }
}

/** Tool rows shown before a delegated card collapses its command log (20 rows). */
const DELEGATED_TOOL_VISIBLE_LIMIT = 20;

/** Child-run status → the Chinese label shown on the card. */
function delegatedAgentStatusLabel(status: string): string {
  return status === 'completed'
    ? '已完成'
    : status === 'running'
      ? '运行中'
      : status === 'failed'
        ? '失败'
        : status === 'cancelled'
          ? '已取消'
          : status === 'timed_out'
            ? '已超时'
            : status;
}

function delegatedAgentObservationLabel(task: DelegatedAgentTaskView): string | undefined {
  const observation = task.statusObservation;
  switch (observation?.diagnostic) {
    case 'completed_unnotified': return '已完成，通知延迟';
    case 'communication_failed': return '状态查询失败';
    case 'stalled': return '状态待确认';
    case 'timed_out': return '已超时';
    case 'abnormal_exit': return '异常退出';
    case 'running': return '运行中';
    default: return undefined;
  }
}

/**
 * 智能体头像值的解析。
 *
 * 运行时的兜底是「名字前两个字」（`resolveDelegatedAgentAvatar`），那只是没有头像时
 * 的占位符，不是头像——卡片上直接把它当文字渲染，看起来就是一块「代码」。
 * 凡是占位（空串或恰好等于名字前两字）就按 Agent 身份派生一张程序化脸，
 * 与 Agent Library 建库时的回填（`avatarSeed`）保持同一套外观。
 */
function delegatedAgentAvatarValue(task: DelegatedAgentTaskView): string {
  const trimmed = (task.avatar ?? '').trim();
  const initials = task.name.trim().slice(0, 2);
  if (trimmed && trimmed !== initials) return trimmed;
  const face = resolveAvatarFace(trimmed, task.agentId);
  return avatarSeed(face.shape, face.color);
}

/** Live projection → card view (used when there is no durable item yet). */
function delegatedTaskViewFromProjection(
  projection: DelegatedAgentProjection,
): DelegatedAgentTaskView {
  return {
    childRunId: String(projection.childRunId),
    ...(projection.parallelGroup ? { parallelGroup: projection.parallelGroup } : {}),
    name: projection.name,
    avatar: projection.avatar,
    kind: 'existing',
    agentId: projection.agentId,
    status: projection.status,
    ...(projection.statusObservation ? { statusObservation: projection.statusObservation } : {}),
    ...(projection.result ? { result: projection.result } : {}),
    ...(projection.usage ? { usage: projection.usage } : {}),
    ...(projection.durationMs !== undefined ? { durationMs: projection.durationMs } : {}),
    toolEvents: projection.toolEvents.map((event) => ({
      toolName: event.toolName,
      ...(event.arguments ? { arguments: event.arguments } : {}),
      ...(event.status ? { status: event.status } : {}),
      ...(event.output ? { output: event.output } : {}),
      ...(event.truncated ? { truncated: true } : {}),
      ...(event.argumentsTruncated ? { argumentsTruncated: true } : {}),
      ...(event.argumentsCharacters !== undefined
        ? { argumentsCharacters: event.argumentsCharacters }
        : {}),
      ...(event.outputTruncated ? { outputTruncated: true } : {}),
      ...(event.outputCharacters !== undefined ? { outputCharacters: event.outputCharacters } : {}),
    })),
  };
}

const DelegatedAgentToolList = memo(function DelegatedAgentToolList({
  events,
}: {
  events: readonly DelegatedAgentToolEventView[];
}) {
  const [expanded, setExpanded] = useState(false);
  const hiddenCount = events.length - DELEGATED_TOOL_VISIBLE_LIMIT;
  const visible = expanded ? events : events.slice(0, DELEGATED_TOOL_VISIBLE_LIMIT);
  return (
    <div className="shell-delegated-agent__tools">
      {visible.map((event, index) => (
        <DelegatedAgentToolRow key={`${event.toolName}-${index}`} event={event} />
      ))}
      {hiddenCount > 0 ? (
        <button
          type="button"
          className="shell-delegated-agent__tools-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded
            ? '收起工具调用'
            : `展开全部 ${events.length} 项工具调用（还有 ${hiddenCount} 项）`}
        </button>
      ) : null}
    </div>
  );
});

/** Child-run status uses the shared glyphs plus a visible label. */
function DelegatedAgentStatusIcon({ status }: { status: string }) {
  const label = delegatedAgentStatusLabel(status);
  const icon =
    status === 'completed' ? (
      <CheckCircle2 size={13} className="text-[var(--color-success)]" />
    ) : status === 'failed' ? (
      <XCircle size={13} className="text-[var(--color-error)]" />
    ) : status === 'cancelled' ? (
      <CircleSlash size={13} className="text-text-faint" />
    ) : status === 'timed_out' ? (
      <Clock size={13} className="text-[var(--color-warning)]" />
    ) : (
      <LoaderCircle size={13} className="shell-process-spin text-accent" />
    );
  return (
    <span className="shell-delegated-agent__status" role="img" aria-label={label} title={label}>
      {icon}
      <span>{label}</span>
    </span>
  );
}

/**
 * Tokens this child billed, shown on the card itself (no expansion needed).
 * Cumulative sums keep the parent and child on one billing semantic; cache
 * read/write are the two numbers a delegated run is usually judged by.
 */
function delegatedAgentUsageLabel(task: DelegatedAgentTaskView): string | undefined {
  const usage = task.usage;
  const tokens =
    usage && (usage.tokensIn !== undefined || usage.tokensOut !== undefined)
      ? (usage.tokensIn ?? 0) + (usage.tokensOut ?? 0)
      : undefined;
  const parts = [
    ...(tokens !== undefined ? [`${formatCompactCount(tokens)} tokens`] : []),
    ...(usage?.cachedTokensHit ? [`缓存读 ${formatCompactCount(usage.cachedTokensHit)}`] : []),
    ...(usage?.cachedTokensCreated
      ? [`缓存写 ${formatCompactCount(usage.cachedTokensCreated)}`]
      : []),
    ...(task.durationMs !== undefined
      ? [formatCompactDuration(task.durationMs)].filter((value): value is string => Boolean(value))
      : []),
  ];
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/**
 * 单个子智能体卡片。抽出来是为了让同一张卡既能出现在「执行过程」里
 * 委派发生的那一刻（内联锚点），也能作为兜底列表的一项。
 */
const DelegatedAgentTaskCard = memo(function DelegatedAgentTaskCard({
  task,
  onStopChild,
}: {
  task: DelegatedAgentTaskView;
  onStopChild?: (childRunId: string) => void;
}) {
  const usageLabel = delegatedAgentUsageLabel(task);
  const [expanded, setExpanded] = useState(
    task.status !== 'running' && Boolean(task.result?.trim()),
  );
  useEffect(() => {
    if (task.status !== 'running' && task.result?.trim()) setExpanded(true);
  }, [task.result, task.status]);
  return (
    <details
      className="shell-delegated-agent"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="shell-delegated-agent__summary">
        <span className="shell-delegated-agent__avatar">
          <AgentAvatarView name={task.name} avatar={delegatedAgentAvatarValue(task)} size={22} />
        </span>
        <span className="shell-delegated-agent__identity">
          <strong>{task.name}</strong>
        </span>
        {usageLabel ? (
          <span className="shell-delegated-agent__usage" data-testid="delegated-agent-usage">
            {usageLabel}
          </span>
        ) : null}
        <DelegatedAgentStatusIcon status={task.status} />
        {delegatedAgentObservationLabel(task) ? (
          <span className="shell-delegated-agent__observation" role="status">
            {delegatedAgentObservationLabel(task)}
          </span>
        ) : null}
      </summary>
      <div className="shell-delegated-agent__details">
        {task.toolEvents.length > 0 ? (
          <DelegatedAgentToolList events={task.toolEvents} />
        ) : (
          <span className="shell-delegated-agent__empty">本次任务没有调用工具</span>
        )}
        {task.result ? <div className="shell-delegated-agent__result">{task.result}</div> : null}
        {task.status === 'cancelled' && !task.result ? (
          <div className="shell-delegated-agent__termination">
            任务已由用户停止，执行记录已保留。
          </div>
        ) : null}
        {task.status === 'running' && onStopChild ? (
          <button
            type="button"
            className="shell-delegated-agent__stop"
            onClick={() => onStopChild(task.childRunId)}
          >
            停止当前子任务
          </button>
        ) : null}
      </div>
    </details>
  );
});

/**
 * 执行过程时间线里的子智能体卡片。
 *
 * 委派发生时那条 `agent_delegate` 工具项就长在时间线上，因此卡片应该留在那一刻，
 * 而不是被抽出来钉在整个面板顶部。返回 `undefined` 表示这一项不是委派，交回给
 * 普通工具行渲染。
 */
export const InlineDelegatedAgentTask = memo(function InlineDelegatedAgentTask({
  item,
  delegatedAgents,
  onStopChild,
}: {
  item: InlineProcessItem;
  delegatedAgents?: readonly DelegatedAgentProjection[];
  onStopChild?: (childRunId: string) => void;
}) {
  const parsed = parseDelegatedAgentTask(item);
  const toolCallId = item.kind === 'tool' ? item.toolCallId : undefined;
  // A durable result wins: it is the authoritative card (final status, result
  // text, tool list). While the delegation is still running there is no result
  // yet, so anchor the live projection by the tool row that spawned it — that is
  // what keeps the card under its own `agent_run` row instead of leaving it in
  // the panel's fallback list until the child finishes.
  if (parsed?.result) {
    const completedProjection = delegatedAgents?.find((candidate) => String(candidate.childRunId) === parsed.childRunId);
    return <DelegatedAgentTaskCard task={completedProjection ? { ...parsed, statusObservation: completedProjection.statusObservation } : parsed} onStopChild={onStopChild} />;
  }
  const live = delegatedAgents?.find((candidate) =>
    parsed
      ? String(candidate.childRunId) === parsed.childRunId
      : Boolean(toolCallId) && candidate.parentToolCallId === toolCallId,
  );
  const task = live ? delegatedTaskViewFromProjection(live) : parsed;
  if (!task) return null;
  return <DelegatedAgentTaskCard task={task} onStopChild={onStopChild} />;
});

export const DelegatedAgentTasks = memo(function DelegatedAgentTasks({
  items,
  delegatedAgents,
  onStopChild,
  inlineChildRunIds,
}: {
  items: readonly InlineProcessItem[];
  delegatedAgents?: readonly DelegatedAgentProjection[];
  onStopChild?: (childRunId: string) => void;
  /**
   * 已经作为内联卡片挂在执行过程里的子任务。它们不再出现在这份兜底列表里，
   * 否则同一张卡会被渲染两次。
   */
  inlineChildRunIds?: ReadonlySet<string>;
}) {
  const parsedTasks = items.flatMap((item) => {
    const task = parseDelegatedAgentTask(item);
    return task ? [task] : [];
  });
  const taskById = new Map<string, DelegatedAgentTaskView>();
  for (const task of delegatedAgents ?? []) {
    taskById.set(String(task.childRunId), delegatedTaskViewFromProjection(task));
  }
  for (const task of parsedTasks) taskById.set(task.childRunId, task);
  const tasks = [...taskById.values()].filter(
    (task) => !inlineChildRunIds?.has(String(task.childRunId)),
  );
  if (tasks.length === 0) return null;
  const runningTasks = tasks.filter((task) => task.status === 'running');
  const parallelGroupFirst = new Set<string>();
  for (const task of tasks) {
    if (!task.parallelGroup) continue;
    if (
      ![...parallelGroupFirst].some(
        (childRunId) =>
          tasks.find((candidate) => candidate.childRunId === childRunId)?.parallelGroup ===
          task.parallelGroup,
      )
    ) {
      parallelGroupFirst.add(task.childRunId);
    }
  }
  return (
    <div className="shell-delegated-agent-list">
      {runningTasks.length > 1 && onStopChild ? (
        <button
          type="button"
          className="shell-delegated-agent__stop-all"
          onClick={() => runningTasks.forEach((task) => onStopChild(task.childRunId))}
        >
          停止全部子任务
        </button>
      ) : null}
      {tasks.map((task) => (
        <Fragment key={task.childRunId}>
          {task.parallelGroup && parallelGroupFirst.has(task.childRunId) ? (
            <div className="shell-delegated-agent-group__header">
              <span>并行任务组：{task.parallelGroup}</span>
              <span>
                {tasks.filter((candidate) => candidate.parallelGroup === task.parallelGroup).length}{' '}
                个任务
              </span>
            </div>
          ) : null}
          <DelegatedAgentTaskCard task={task} onStopChild={onStopChild} />
        </Fragment>
      ))}
    </div>
  );
});

const MessageBubble = memo(function MessageBubble({
  message,
  waitingForApproval = false,
  processView: sourceProcessView,
  processLoadFailure,
  onRetryProcess,
  models,
  agents,
  runAgentIdentity,
  fallbackAgent,
  regenerating,
  onRegenerate,
  onContinue,
  onOpenChange,
  conversationId,
  onOpenHtmlInBrowser,
  onOpenWebUrl,
  onOpenReview,
  projectFolder,
  onOpenImage,
  kernelId,
  skillNameByVersionId,
  agentPreferences,
  dismissLocalError,
}: {
  message: ChatMessage;
  waitingForApproval?: boolean;
  processView?: RunProcessView;
  processLoadFailure?: RunProcessLoadFailure;
  onRetryProcess?: (runId: string) => void;
  models?: readonly ModelOption[];
  agents?: readonly GlobalAgent[];
  runAgentIdentity?: RunAgentIdentity;
  fallbackAgent?: GlobalAgent;
  regenerating?: boolean;
  onRegenerate?: (messageId: string) => void;
  onContinue?: (messageId: string) => void;
  onChooseModelAndRetry?: (messageId: string) => void;
  onOpenChange?: (path: string, location?: ProjectTextLocation) => void;
  conversationId?: string;
  onOpenHtmlInBrowser?: OpenHtmlInBrowser;
  onOpenWebUrl?: (url: string) => void;
  onOpenReview?: (view: RunProcessView) => void;
  projectFolder?: string;
  onOpenImage?: (image: MessageImage, group?: readonly MessageImage[]) => void;
  /** Kernel that produced this turn (native/empty → no badge). */
  kernelId?: string;
  skillNameByVersionId?: ReadonlyMap<string, string>;
  agentPreferences: AgentPreferences;
  /** Dismiss callback for transient local diagnostics. */
  dismissLocalError?: (messageId: string) => void;
}) {
  const { process: processView, controls: processPageControls } = useRunProcessPage(
    sourceProcessView,
    'steps',
    conversationId,
    { accumulate: true },
  );
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const systemTone: SystemMessageTone = resolveSystemMessageTone(message.tone, message.text);
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const copyRead = useRef<AbortController>();
  const copyTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    setCopied(false);
    setCopying(false);
    setCopyFailed(false);
    return () => {
      copyRead.current?.abort();
      copyRead.current = undefined;
      clearTimeout(copyTimer.current);
    };
  }, [conversationId, message.id]);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  const [loadedAssistantTimeline, setLoadedAssistantTimeline] = useState<AssistantTurnSegment[]>();
  const [timelineLoadState, setTimelineLoadState] = useState<
    'idle' | 'loading' | 'loaded' | 'error'
  >('idle');
  const [timelineNextCursor, setTimelineNextCursor] = useState<string>();
  const [timelineTotalSegments, setTimelineTotalSegments] = useState<number>();
  const timelineLoadPromiseRef = useRef<Promise<void> | null>(null);
  const timelineLoadGenerationRef = useRef(0);
  const timelineNextCursorRef = useRef<string>();
  const timelineHasLoadedPageRef = useRef(false);
  const timelineSeenCursorsRef = useRef(new Set<string>());
  const observedTimelineRunRef = useRef(message.runId);
  // Expression layer: a turn that just finished celebrates briefly. Tracked through
  // a ref so remounting (e.g. switching conversations) never replays a stale one.
  const [justCompleted, setJustCompleted] = useState(false);
  const wasStreamingRef = useRef(Boolean(message.streaming));
  useEffect(() => {
    const finished = wasStreamingRef.current && !message.streaming;
    wasStreamingRef.current = Boolean(message.streaming);
    if (!finished) return;
    setJustCompleted(true);
    const timer = setTimeout(() => setJustCompleted(false), 4_000);
    return () => clearTimeout(timer);
  }, [message.streaming]);

  useEffect(() => {
    if (observedTimelineRunRef.current === message.runId) return;
    observedTimelineRunRef.current = message.runId;
    timelineLoadGenerationRef.current += 1;
    timelineLoadPromiseRef.current = null;
    timelineNextCursorRef.current = undefined;
    timelineHasLoadedPageRef.current = false;
    timelineSeenCursorsRef.current.clear();
    setLoadedAssistantTimeline(undefined);
    setTimelineNextCursor(undefined);
    setTimelineTotalSegments(undefined);
    setTimelineLoadState('idle');
  }, [message.runId]);

  useEffect(
    () => () => {
      timelineLoadGenerationRef.current += 1;
    },
    [],
  );

  const loadAssistantTimelinePage = useCallback(() => {
    const runId = message.runId;
    const api = bridge();
    if (!runId || !api?.listConversationRunTimeline) return;
    if (timelineLoadPromiseRef.current) return;
    const requestCursor = timelineHasLoadedPageRef.current
      ? timelineNextCursorRef.current
      : undefined;
    if (timelineHasLoadedPageRef.current && !requestCursor) return;

    const generation = timelineLoadGenerationRef.current;
    setTimelineLoadState('loading');
    const request = loadRunTimelinePage(
      (payload) =>
        api.listConversationRunTimeline(payload) as Promise<ConversationListRunTimelineResponse>,
      runId as RunId,
      requestCursor,
    )
      .then((page) => {
        if (timelineLoadGenerationRef.current !== generation) return;
        if (page.nextCursor && timelineSeenCursorsRef.current.has(page.nextCursor)) {
          throw new Error('conversation.run_timeline_cursor_repeated');
        }
        if (page.nextCursor) timelineSeenCursorsRef.current.add(page.nextCursor);
        timelineHasLoadedPageRef.current = true;
        timelineNextCursorRef.current = page.nextCursor;
        if (timelineLoadPromiseRef.current === request) timelineLoadPromiseRef.current = null;
        setTimelineNextCursor(page.nextCursor);
        setTimelineTotalSegments(page.totalSegments);
        if (page.segments.length > 0) {
          setLoadedAssistantTimeline((current) =>
            mergeRunTimelineSegments(current ?? [], page.segments),
          );
        }
        setTimelineLoadState('loaded');
      })
      .catch(() => {
        if (timelineLoadGenerationRef.current === generation) setTimelineLoadState('error');
      })
      .finally(() => {
        if (timelineLoadPromiseRef.current === request) timelineLoadPromiseRef.current = null;
      });
    timelineLoadPromiseRef.current = request;
  }, [message.runId]);

  useEffect(() => {
    if (timelineLoadState !== 'loaded' || !timelineNextCursor) return;
    loadAssistantTimelinePage();
  }, [loadAssistantTimelinePage, timelineLoadState, timelineNextCursor]);

  const displayedTimeline = useMemo(
    () => mergeRunTimelineSegments(message.assistantTimeline ?? [], loadedAssistantTimeline ?? []),
    [loadedAssistantTimeline, message.assistantTimeline],
  );
  const displayedTimelineFields = useMemo(
    () => assistantTimelineToChatFields(displayedTimeline),
    [displayedTimeline],
  );
  const hasLoadedTimeline = Boolean(loadedAssistantTimeline?.length);
  const displayedProcessItems = useMemo(
    () =>
      reconcileProcessItemOutcomes(
        displayedTimeline.length ? displayedTimelineFields.processItems : message.processItems,
        processView,
      ),
    [
      displayedTimeline.length,
      displayedTimelineFields.processItems,
      message.processItems,
      processView,
    ],
  );
  const generatedImageModels = useMemo(
    () => generatedImageModelsFromProcessItems(displayedProcessItems),
    [displayedProcessItems],
  );
  /** 已经以内联卡片挂在时间线上的子任务 id。兜底列表跳过它们，避免重复渲染。 */
  const inlineDelegatedChildRunIds = useMemo(() => {
    const ids = new Set<string>();
    // Running delegations have no durable result yet, so their tool row cannot
    // yield a childRunId — resolve it from the live projection instead. Without
    // this the fallback list keeps rendering the same card at the panel top.
    const byParentToolCallId = new Map<string, string>();
    for (const agent of message.delegatedAgents ?? []) {
      if (agent.parentToolCallId) {
        byParentToolCallId.set(String(agent.parentToolCallId), String(agent.childRunId));
      }
    }
    for (const item of displayedProcessItems ?? []) {
      const task = parseDelegatedAgentTask(item);
      if (task) {
        ids.add(task.childRunId);
        continue;
      }
      if (item.kind !== 'tool' || !item.toolCallId || !isDelegationToolName(item.name)) continue;
      const childRunId = byParentToolCallId.get(String(item.toolCallId));
      if (childRunId) ids.add(childRunId);
    }
    return ids;
  }, [displayedProcessItems, message.delegatedAgents]);
  const stopDelegatedChild = useCallback((childRunId: string) => {
    const api = bridge();
    if (!api?.cancelRun) {
      toastApi.toast({ type: 'error', title: '停止子任务失败', description: 'Runtime 未连接' });
      return;
    }
    void api.cancelRun({ runId: childRunId as RunId }).catch((error) => {
      toastApi.toast({
        type: 'error',
        title: '停止子任务失败',
        description: error instanceof Error ? error.message : String(error),
      });
    });
  }, []);
  const renderInlineAgentTask = useCallback(
    (item: InlineProcessItem) =>
      item.kind === 'tool' && isDelegationToolName(item.name) ? (
        <InlineDelegatedAgentTask
          item={item}
          delegatedAgents={message.delegatedAgents}
          onStopChild={stopDelegatedChild}
        />
      ) : undefined,
    [message.delegatedAgents, stopDelegatedChild],
  );
  const delegatedAgentTaskContent = useMemo(
    () => (
      <DelegatedAgentTasks
        items={displayedProcessItems ?? []}
        delegatedAgents={message.delegatedAgents}
        inlineChildRunIds={inlineDelegatedChildRunIds}
        onStopChild={stopDelegatedChild}
      />
    ),
    [
      displayedProcessItems,
      inlineDelegatedChildRunIds,
      message.delegatedAgents,
      stopDelegatedChild,
    ],
  );
  /**
   * 兜底列表只保留「没有内联锚点」的委派（例如只有 live 投影、时间线上还没有
   * `agent_delegate` 条目的时候）。其余都在委派发生的那一刻就地显示。
   */
  const hasDelegatedAgentTasks = (message.delegatedAgents ?? []).some(
    (task) => !inlineDelegatedChildRunIds.has(String(task.childRunId)),
  );

  const metricsLabel = useMemo(() => {
    if (!processView) return undefined;
    return formatCompactRunMetrics({
      durationMs: processView.durationMs,
      tokensIn: processView.tokensIn,
      tokensOut: processView.tokensOut,
    });
  }, [processView]);

  const runModelOption = useMemo(() => {
    if (!processView) return undefined;
    return models?.find(
      (model) =>
        model.modelId === processView.modelId ||
        model.displayName === processView.providerModelId ||
        model.displayName.toLowerCase() === (processView.providerModelId ?? '').toLowerCase(),
    );
  }, [models, processView]);

  const modelLabel = useMemo(() => {
    if (!processView) return undefined;
    return formatRunModelLabel({
      providerModelId: processView.providerModelId,
      modelId: processView.modelId,
      catalogName: runModelOption?.displayName,
    });
  }, [processView, runModelOption?.displayName]);

  const providerUsageIdentity = useMemo<ProviderUsageIdentity | undefined>(() => {
    if (!processView) return undefined;
    return {
      providerId: runModelOption?.providerId,
      providerName: runModelOption?.providerName,
      modelId: processView.modelId,
      providerModelId: processView.providerModelId,
    };
  }, [processView, runModelOption?.providerId, runModelOption?.providerName]);

  const clockLabel = formatMessageClock(message.timestamp);
  const absoluteTime = formatMessageAbsoluteTime(message.timestamp);
  // Kernel badge for this turn: show the brand logo next to the model label so
  // it is obvious which kernel produced each reply (native/unknown → none).
  const kernelLogo = useMemo(() => {
    if (!kernelId || kernelId === 'native') return undefined;
    return resolveKernelBrandLogo(kernelId);
  }, [kernelId]);
  const kernelLabel = kernelId ? resolveKernelDisplayName(kernelId) : undefined;

  const metricsDetail = useMemo(() => {
    if (!processView) return undefined;
    const duration = formatCompactDuration(processView.durationMs);
    const durationExact =
      typeof processView.durationMs === 'number'
        ? `${Math.round(processView.durationMs)}ms`
        : undefined;
    const tokens =
      processView.tokensIn !== undefined || processView.tokensOut !== undefined
        ? {
            ...splitProviderUsageTokens({
              tokensIn: processView.tokensIn ?? 0,
              tokensOut: processView.tokensOut ?? 0,
              cachedTokensHit: processView.cachedTokensHit,
              cachedTokensCreated: processView.cachedTokensCreated,
            }),
          }
        : undefined;
    return {
      duration,
      durationExact,
      tokens,
      model: modelLabel,
      absoluteTime,
    };
  }, [absoluteTime, modelLabel, processView]);

  const handleCopy = useCallback(async () => {
    if (!message.text.trim() || copyRead.current) return;
    const controller = new AbortController();
    copyRead.current = controller;
    setCopying(true);
    setCopyFailed(false);
    try {
      const text = await resolveMessageText(
        message.textParts ?? message.answerParts,
        message.text,
        conversationId ?? '',
        controller.signal,
        message.textParts ? '\n' : '',
      );
      if (controller.signal.aborted) return;
      await navigator.clipboard.writeText(text);
      if (controller.signal.aborted) return;
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1400);
    } catch {
      if (!controller.signal.aborted) setCopyFailed(true);
    } finally {
      if (copyRead.current === controller) {
        copyRead.current = undefined;
        setCopying(false);
      }
    }
  }, [conversationId, message.answerParts, message.text, message.textParts]);

  const answerSources = useMemo(
    () =>
      message.streaming
        ? []
        : collectAnswerSources(
            message.answerText ?? message.text,
            displayedProcessItems,
            projectFolder,
          ),
    [displayedProcessItems, message.answerText, message.streaming, message.text, projectFolder],
  );

  if (isUser) {
    const images = message.images ?? [];
    const fileReferences = splitMessageFileReferences(message.text ?? '');
    const visibleText = fileReferences.body;
    return (
      <div className="shell-msg shell-msg--user group relative flex justify-end">
        <div className="shell-user-bubble-wrap">
          {fileReferences.files.length > 0 ? (
            <div
              className="shell-msg-files shell-msg-files--user"
              data-testid="message-file-references"
            >
              {fileReferences.files.map((file) => {
                const Icon = file.kind === 'dir' ? Folder : FileText;
                return (
                  <button
                    key={file.path}
                    type="button"
                    className="shell-msg-file"
                    title={file.path}
                    onClick={() => onOpenChange?.(file.path)}
                  >
                    <Icon size={15} aria-hidden="true" />
                    <span className="shell-msg-file__name">{file.name}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
          {images.length > 0 ? (
            <div className="shell-msg-images shell-msg-images--user">
              {images.map((img) => (
                <button
                  key={img.id}
                  type="button"
                  className="shell-msg-image-btn"
                  title={img.name || '点击查看'}
                  onClick={() => onOpenImage?.(img, images)}
                >
                  <img src={img.url} alt={img.name || '图片'} />
                </button>
              ))}
            </div>
          ) : null}
          {visibleText ? (
            <div className="shell-user-bubble max-w-full rounded-2xl bg-[color-mix(in_srgb,var(--color-elevated)_88%,var(--color-text)_12%)] px-4 py-2.5 text-[13.5px] leading-relaxed text-text shadow-sm">
              <MessageTextContent
                text={visibleText}
                parts={visibleText === message.text ? message.textParts : undefined}
                conversationId={conversationId}
                readingStateKey={`${conversationId ?? 'conversation'}:${message.id}:user`}
                renderPreview={(text) => (
                  <CollapsibleUserText
                    text={text}
                    onOpenUrl={onOpenWebUrl}
                    prefix={
                      message.skillVersionIds?.length ? (
                        <span className="shell-user-skill-list" data-testid="message-skill-list">
                          {message.skillVersionIds.map((skillVersionId) => (
                            <span className="shell-user-skill" key={skillVersionId}>
                              <Puzzle size={12} aria-hidden="true" />
                              <span>
                                {message.skills?.find(
                                  (skill) => skill.skillVersionId === skillVersionId,
                                )?.name ??
                                  skillNameByVersionId?.get(skillVersionId) ??
                                  skillVersionId}
                              </span>
                            </span>
                          ))}
                        </span>
                      ) : undefined
                    }
                  />
                )}
              />
            </div>
          ) : null}
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
              {copyFailed ? <span role="alert">读取或复制失败，请重试</span> : null}
              {message.text?.trim() ? (
                <button
                  type="button"
                  className="ml-1.5 inline-flex items-center rounded p-0.5 text-text-faint transition-colors hover:bg-[color-mix(in_srgb,var(--color-text)_10%,transparent)] hover:text-text"
                  onClick={() => void handleCopy()}
                  disabled={copying}
                  title={copying ? '读取原文中' : copyFailed ? '读取或复制失败，请重试' : '复制'}
                  aria-label="复制我的消息"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                </button>
              ) : null}
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
    // Transient diagnostics (failed sends, vision hints) are dismissible —
    // durable system notices stay static. The callback is only wired-in by
    // the caller when `message.id` belongs to the local diagnostics list.
    const dismissible = Boolean(dismissLocalError);
    return (
      <div className="shell-msg group relative flex justify-start">
        <div
          className={`${bubbleClass} max-w-[80%] rounded-xl border px-4 py-2.5 text-[12.5px]`}
          data-tone={systemTone}
        >
          <MessageTextContent
            text={message.text}
            parts={message.textParts}
            conversationId={conversationId}
            readingStateKey={`${conversationId ?? 'conversation'}:${message.id}:system`}
            renderPreview={(text) => <span className="whitespace-pre-wrap">{text}</span>}
          />
          {dismissible ? (
            <button
              type="button"
              className="ml-1.5 inline-flex shrink-0 translate-y-[-1px] items-center rounded p-0.5 align-middle text-text-faint transition-colors hover:bg-[color-mix(in_srgb,var(--color-text)_10%,transparent)] hover:text-text"
              onClick={() => dismissLocalError?.(message.id)}
              title="关闭这条提示"
              aria-label="关闭这条提示"
            >
              <X size={12} />
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  // AI message — thinking + process + markdown + file changes + NewMax-style footer
  // Agent avatar: prefer the run's immutable agent (matched by id), then the
  // conversation's current agent, then a first-letter placeholder circle.
  const identityAgent = runAgentIdentity?.id
    ? agents?.find((agent) => String(agent.id) === runAgentIdentity.id)
    : undefined;
  const avatarSource = identityAgent ?? fallbackAgent;
  // 名字与头像同源：优先消息/run 的智能体名；缺失时回退到当前绑定智能体
  // （头像已回退到它），避免"有头像没名字"的割裂。
  const visibleAgentLabel =
    message.globalAgentName?.trim() || runAgentIdentity?.name || avatarSource?.name;
  const avatarName = avatarSource?.name ?? visibleAgentLabel ?? '助手';
  const hasAnswerText = Boolean((message.answerText ?? message.text).trim());
  // Expression for the procedural avatar. Every signal below comes from this
  // conversation, which is exactly where these expressions can appear.
  const reasoningInFlight =
    Boolean(message.streaming) &&
    ((displayedProcessItems ?? []).some(
      (item) => item.kind === 'reasoning' && item.status === 'streaming',
    ) ||
      // Streaming snapshots carry reasoning in the message field before any
      // answer text exists — that window is "thinking", not "working".
      (Boolean(message.reasoningText?.trim()) && !hasAnswerText));
  const avatarState = avatarStateFrom({
    streaming: Boolean(message.streaming),
    reasoning: reasoningInFlight,
    awaitingApproval: waitingForApproval,
    failed: Boolean(processLoadFailure),
    justCompleted,
  });
  const timelineTiming = assistantTimelineProcessTiming(displayedTimeline, !message.streaming);
  const showFooter = !message.streaming && (hasAnswerText || Boolean(processView));
  return (
    <div className="shell-msg shell-msg--assistant group relative flex items-start gap-2.5">
      <div className="shrink-0 pt-0.5">
        <AgentAvatarView
          name={avatarName}
          avatar={avatarSource?.avatar}
          size={26}
          state={avatarState}
        />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        {visibleAgentLabel ? (
          <div className="mb-1 text-[11.5px] font-medium text-text-faint">{visibleAgentLabel}</div>
        ) : null}
        {message.runId && onRetryProcess ? (
          <RunProcessLoadNotice
            runId={message.runId}
            failure={processLoadFailure}
            onRetry={onRetryProcess}
          />
        ) : null}
        <InlineProcessFlow
          items={[
            // Streaming snapshots carry reasoning in the message field (not in
            // blocks yet); prepend it so the thinking row streams in time
            // order. Completed messages already derive it from blocks.
            ...(!(displayedProcessItems ?? []).some((item) => item.kind === 'reasoning') &&
            message.reasoningText
              ? [{ kind: 'reasoning' as const, text: message.reasoningText }]
              : []),
            ...(processView?.pages && !hasLoadedTimeline
              ? (displayedProcessItems ?? []).filter(
                  (item) => item.kind !== 'tool' && item.kind !== 'status',
                )
              : (displayedProcessItems ?? [])),
          ]}
          steps={hasLoadedTimeline ? undefined : processView?.steps}
          totalFailedTools={processView?.pages ? processView.errorCount : undefined}
          pageControls={
            !hasLoadedTimeline && agentPreferences.showToolUse ? processPageControls : null
          }
          commentarySegments={hasLoadedTimeline ? undefined : message.commentarySegments}
          streaming={Boolean(message.streaming)}
          waitingForApproval={waitingForApproval}
          answerStarted={hasAnswerText}
          runId={message.runId ?? message.id}
          conversationId={conversationId}
          startedAt={processView?.startedAt ?? timelineTiming.startedAt}
          completedAt={processView?.completedAt ?? timelineTiming.completedAt}
          durationMs={processView?.durationMs}
          collapseExecutionProcess={agentPreferences.collapseExecutionProcess}
          showToolUse={agentPreferences.showToolUse}
          showThinking={agentPreferences.showThinking}
          onShowThinkingChange={(value) => {
            writeAgentPreferences({ ...agentPreferences, showThinking: value });
          }}
          toolCallExpandedByDefault={agentPreferences.toolCallExpandedByDefault}
          onOpenChange={onOpenChange}
          onPanelOpen={
            message.runId && bridge()?.listConversationRunTimeline
              ? loadAssistantTimelinePage
              : undefined
          }
          timelineLoadState={timelineLoadState}
          timelineLoadedCount={loadedAssistantTimeline?.length}
          timelineTotalSegments={timelineTotalSegments}
          timelineHasMore={Boolean(timelineNextCursor)}
          onLoadMoreTimeline={loadAssistantTimelinePage}
          onRetryTimelineLoad={loadAssistantTimelinePage}
          agentTaskContent={hasDelegatedAgentTasks ? delegatedAgentTaskContent : undefined}
          renderInlineAgentTask={renderInlineAgentTask}
          supplementalContent={
            message.processStatus || message.terminalState ? (
              <>
                {message.processStatus ? (
                  <div
                    className="shell-run-connection-status"
                    data-state={message.processStatusState}
                    role="status"
                    aria-live="polite"
                  >
                    {message.processStatusState === 'failed' ? (
                      <AlertCircle size={12} aria-hidden="true" />
                    ) : (
                      <RefreshCw size={12} aria-hidden="true" />
                    )}
                    <span>{message.processStatus}</span>
                  </div>
                ) : null}
                {message.terminalState ? (
                  <HarnessTerminalNotice
                    state={message.terminalState}
                    error={message.terminalError}
                    busy={Boolean(regenerating)}
                    onContinue={() => onContinue?.(message.id)}
                    onRetry={() => onRegenerate?.(message.id)}
                  />
                ) : null}
              </>
            ) : undefined
          }
        />
        {message.answerText || (!message.processItems?.length && message.text) ? (
          <MessageTextContent
            parts={message.answerText !== undefined ? message.answerParts : message.textParts}
            text={message.answerText ?? message.text}
            streaming={Boolean(message.streaming)}
            readingStateKey={`${conversationId ?? 'conversation'}:${message.id}:answer`}
            projectFolder={projectFolder}
            conversationId={conversationId}
            imageModelBySrc={generatedImageModels}
            onOpenFile={onOpenChange}
            onOpenHtmlInBrowser={onOpenHtmlInBrowser}
            onOpenUrl={onOpenWebUrl}
          />
        ) : null}
        {!message.streaming && processView && processView.fileChanges.length > 0 ? (
          <FileChangesCard
            view={processView}
            conversationId={conversationId}
            onOpenChange={onOpenChange}
            onOpenReview={onOpenReview}
            projectFolder={projectFolder}
          />
        ) : null}
        {showFooter ? (
          <div className="shell-msg-footer">
            {hasAnswerText ? (
              <AnswerSources
                sources={answerSources}
                onOpenFile={onOpenChange}
                actions={
                  <>
                    {copyFailed ? <span role="alert">读取或复制失败，请重试</span> : null}
                    <button
                      type="button"
                      className="shell-msg-footer__btn"
                      onClick={() => void handleCopy()}
                      disabled={copying}
                      title={
                        copying
                          ? '读取原文中'
                          : copyFailed
                            ? '读取或复制失败，请重试'
                            : copied
                              ? '已复制'
                              : '复制'
                      }
                      aria-label={copied ? '已复制' : '复制'}
                    >
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                    <button
                      type="button"
                      className="shell-msg-footer__btn"
                      onClick={() => void onRegenerate?.(message.id)}
                      disabled={regenerating}
                      title="重新生成"
                      aria-label="重新生成"
                    >
                      <RefreshCw size={14} className={regenerating ? 'shell-process-spin' : ''} />
                    </button>
                    <button
                      type="button"
                      className="shell-msg-footer__btn"
                      onClick={() => setFeedback((current) => (current === 'up' ? null : 'up'))}
                      title="有帮助"
                      aria-label="有帮助"
                      aria-pressed={feedback === 'up'}
                    >
                      <ThumbsUp size={14} />
                    </button>
                    <button
                      type="button"
                      className="shell-msg-footer__btn"
                      onClick={() => setFeedback((current) => (current === 'down' ? null : 'down'))}
                      title="没有帮助"
                      aria-label="没有帮助"
                      aria-pressed={feedback === 'down'}
                    >
                      <ThumbsDown size={14} />
                    </button>
                  </>
                }
              />
            ) : null}
            <div className="shell-msg-meta shell-msg-meta--assistant">
              {metricsLabel && metricsDetail ? (
                <MetaHover
                  className="shell-msg-meta__metrics"
                  label={metricsLabel}
                  width="auto"
                  panel={
                    <div
                      className="shell-meta-tip shell-usage-tip"
                      data-testid="reply-usage-tooltip"
                    >
                      <div className="shell-usage-tip__summary">
                        <span>{metricsDetail.duration}</span>
                        {metricsDetail.tokens ? (
                          <span className="shell-usage-tip__token-detail">
                            {[
                              metricsDetail.tokens.inputTokens > 0
                                ? `↑ ${formatCompactCount(metricsDetail.tokens.inputTokens)}`
                                : undefined,
                              metricsDetail.tokens.outputTokens > 0
                                ? `↓ ${formatCompactCount(metricsDetail.tokens.outputTokens)}`
                                : undefined,
                              metricsDetail.tokens.cacheReadTokens > 0
                                ? `缓存读 ${formatCompactCount(metricsDetail.tokens.cacheReadTokens)}`
                                : undefined,
                              metricsDetail.tokens.cacheWriteTokens > 0
                                ? `缓存写 ${formatCompactCount(metricsDetail.tokens.cacheWriteTokens)}`
                                : undefined,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        ) : null}
                      </div>
                      {providerUsageIdentity ? (
                        <ProviderAccountUsageSection identity={providerUsageIdentity} />
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
              {kernelLogo ? (
                <span
                  className="shell-msg-meta__kernel"
                  data-testid={`msg-kernel-${kernelId}`}
                  title={`内核：${kernelLabel}`}
                  aria-label={`内核：${kernelLabel}`}
                >
                  <BrandLogoMark logo={kernelLogo} size={13} />
                </span>
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
  width = 220,
}: {
  label: ReactNode;
  panel: ReactNode;
  className?: string;
  width?: number | 'auto';
}) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  // Right-align the card to its trigger, clamped to the viewport.
  const place = (el: HTMLElement, w: number): React.CSSProperties => {
    const rect = el.getBoundingClientRect();
    return {
      position: 'fixed',
      left: Math.max(8, Math.min(rect.right - w, window.innerWidth - w - 8)),
      bottom: window.innerHeight - rect.top + 8,
      zIndex: 10020,
    };
  };

  const show = () => {
    cancelClose();
    const el = triggerRef.current;
    if (!el || typeof window === 'undefined') return;
    // 'auto' lets the card size to its content (NewMax behaviour). We anchor
    // from an estimate first and re-anchor once the real box is measured.
    const w = width === 'auto' ? 260 : width;
    const next = place(el, Math.min(w, window.innerWidth - 16));
    if (width !== 'auto') next.width = w;
    setStyle(next);
    setOpen(true);
  };

  const hide = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  };

  // Content-sized cards only know their width after mount, so re-anchor from
  // the measured box instead of the estimate. No-op for fixed widths.
  useLayoutEffect(() => {
    if (!open || width !== 'auto') return;
    const el = triggerRef.current;
    const portal = portalRef.current;
    if (!el || !portal || typeof window === 'undefined') return;
    const measured = portal.offsetWidth;
    if (!measured) return;
    setStyle((s) => {
      const next = place(el, measured);
      return s && s.left === next.left && s.bottom === next.bottom ? s : { ...(s ?? {}), ...next };
    });
  }, [open, width]);

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
              ref={portalRef}
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
  if (hours > 0) return `${hours}小时${minutes}分${seconds}秒`;
  if (minutes > 0) return `${minutes}分${seconds}秒`;
  return `${seconds}秒`;
}

export function AssistantProcessGroup({
  commentaryText,
  commentarySegments,
  processView,
  streaming,
  answerStarted = false,
  defaultOpen = false,
  autoOpenActive = true,
  reasoningText,
  children,
}: {
  commentaryText?: string;
  commentarySegments?: readonly CommentaryTimelineSegment[];
  processView?: RunProcessView;
  streaming?: boolean;
  answerStarted?: boolean;
  /** Deterministic visual/test fixture override; production follows the active phase. */
  defaultOpen?: boolean;
  /** Whether an active run without an answer yet auto-opens the panel. */
  autoOpenActive?: boolean;
  /** Provider reasoning summary — merged into the same collapsible process panel. */
  reasoningText?: string;
  children: ReactNode;
}) {
  const hasCommentary = Boolean(
    commentaryText?.trim() || commentarySegments?.some((segment) => segment.text.trim()),
  );
  const hasReasoning = Boolean(reasoningText?.trim());
  const stepCount = processView?.pages?.steps.total ?? processView?.steps.length ?? 0;
  const changeCount = processView?.pages?.fileChanges.total ?? processView?.fileChanges.length ?? 0;
  const completed = Boolean(processView?.completedAt);
  const lifecycleActive = Boolean(processView?.startedAt && !processView?.completedAt);
  const active = !completed && Boolean(streaming || processView?.running || lifecycleActive);
  const hasLifecycle = Boolean(processView?.startedAt || completed);
  const hasDetails = hasCommentary || hasReasoning || stepCount > 0 || changeCount > 0;
  // Keep the application-owned run summary even when a provider withholds its
  // commentary. Active work opens automatically; historical and final-answer
  // states retain the compact durable elapsed-time marker.
  const hasContent = hasDetails || active || hasLifecycle;
  const { open, toggle } = useAutoDisclosure({
    autoOpen: defaultOpen || (autoOpenActive && active && !answerStarted),
    resetKey: processView?.runId,
  });
  const [clockNow, setClockNow] = useState(() => Date.now());
  const bodyRef = useRef<HTMLDivElement>(null);
  const followTailRef = useRef(true);
  const previousScrollTopRef = useRef<number | null>(null);
  const lastCommentarySegment = commentarySegments?.at(-1);
  const lastProcessStep = processView?.latestStep ?? processView?.steps.at(-1);
  const commentaryRevision = [
    commentarySegments?.length ?? 0,
    lastCommentarySegment?.id ?? '',
    lastCommentarySegment?.text.length ?? commentaryText?.length ?? 0,
    lastCommentarySegment?.completedAt ?? '',
  ].join(':');
  const processRevision = [
    lastProcessStep?.id ?? '',
    lastProcessStep?.status ?? '',
    lastProcessStep?.completedAt ?? '',
    lastProcessStep?.preview?.length ?? 0,
    lastProcessStep?.error?.length ?? 0,
  ].join(':');

  useEffect(() => {
    setClockNow(Date.now());
    if (!active || !processView?.startedAt) return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active, processView?.startedAt]);

  useEffect(() => {
    if (active) {
      followTailRef.current = true;
      previousScrollTopRef.current = null;
    }
  }, [active, processView?.runId]);

  useLayoutEffect(() => {
    if (!active || !open || !followTailRef.current) return;
    const body = bodyRef.current;
    if (body) {
      body.scrollTop = body.scrollHeight;
      previousScrollTopRef.current = body.scrollTop;
    }
  }, [
    active,
    open,
    processView?.runId,
    processView?.steps.length,
    processView?.fileChanges.length,
    processView?.doneCount,
    processView?.errorCount,
    processRevision,
    commentaryRevision,
  ]);

  if (!hasContent) return null;

  const elapsed = formatAssistantProcessElapsed(processView, active, clockNow);

  return (
    <section
      className={`shell-process-group ${open ? 'is-open' : ''}`}
      data-streaming={streaming ? '1' : '0'}
    >
      <button
        type="button"
        className="shell-process-group__toggle"
        onClick={() => {
          if (!open && active) {
            followTailRef.current = true;
            previousScrollTopRef.current = null;
          }
          toggle();
        }}
        aria-expanded={open}
      >
        <span className="shell-process-group__title">
          过程
          {elapsed ? ` · ${elapsed}` : ''}
        </span>
        <ChevronDown size={15} className="shell-process-group__chevron" />
      </button>
      {open ? (
        <div
          ref={bodyRef}
          className="shell-process-group__body"
          onWheel={(event) => {
            if (event.deltaY < 0) followTailRef.current = false;
          }}
          onScroll={() => {
            const body = bodyRef.current;
            if (!body) return;
            const previousScrollTop = previousScrollTopRef.current;
            const currentScrollTop = body.scrollTop;
            const distanceFromBottom = body.scrollHeight - body.scrollTop - body.clientHeight;
            if (distanceFromBottom <= 32) {
              followTailRef.current = true;
            } else if (previousScrollTop !== null && currentScrollTop < previousScrollTop - 1) {
              followTailRef.current = false;
            }
            previousScrollTopRef.current = currentScrollTop;
          }}
        >
          {hasReasoning ? (
            <div className="shell-process-group__reasoning">
              <ReasoningContent text={reasoningText!} streaming={Boolean(streaming)} />
            </div>
          ) : null}
          {children}
        </div>
      ) : null}
    </section>
  );
}
