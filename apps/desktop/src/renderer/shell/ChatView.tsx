import {
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
  AlertCircle,
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  FileCode2,
  FolderOpen,
  ImagePlus,
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
  Zap,
} from 'lucide-react';
import {
  matchesToolName,
  splitProviderUsageTokens,
  type Conversation,
  type ConversationPlanSummary,
  type Event,
  type GlobalAgent,
  type KernelDetectionResult,
  type Message,
  type MessageBlock,
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
  ConversationGetRunProcessResponse,
  ConversationListMessagesResponse,
  ConversationTransientFrame,
  BrowserHandoffSummary,
  CommentaryTimelineSegment,
  DesktopWaitingCommandSummary,
  PendingToolApprovalSummary,
  ToolApprovalScope,
  ConversationTransientSnapshot,
  RunProcessView,
  SkillVersionSummary,
  UsageSummaryResponse,
  WorkspaceSummary,
} from '@sync-think/protocol';
import { normalizeAssistantTurnPhases } from '@sync-think/protocol/assistant-turn';
import { parseConversationGetContextStatusResponse } from '@sync-think/protocol/conversation-context-status';
import type { ProjectTextLocation } from '../../workspace-tools-contract.js';
import { AgentAvatarView } from './AgentAvatarView.js';
import { BrandLogoMark } from './BrandLogoMark.js';
import { resolveKernelBrandLogo, resolveKernelDisplayName } from './brand-icons.js';
import { useAutoDisclosure } from './auto-disclosure.js';
import { BrowserHandoffCard, BrowserHandoffQueryError } from './BrowserHandoffCard.js';
import { DesktopWaitingCard, DesktopWaitingQueryError } from './DesktopWaitingCard.js';
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
  createQueuedComposeRequest,
  enqueueQueuedComposeRequest,
  readQueuedComposeRequests,
  removeQueuedComposeRequest,
  updateQueuedComposeRequest,
  writeQueuedComposeRequests,
  type QueuedComposeRequest,
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
import { ComposerMenuHighlight } from './ComposerMenuHighlight.js';
import { ComposerMcpMenu } from './ComposerMcpMenu.js';
import { ComposerModeBanner } from './ComposerModeBanner.js';
import { ComposerActiveModePill, ComposerModeKeywordHint } from './ComposerModeControls.js';
import { ComposerApprovalStack } from './ComposerApprovalStack.js';
import { ComposerEditor } from './ComposerEditor.js';
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
import { NewMaxComposerFrame } from './NewMaxComposerFrame.js';
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
  estimateContextWindow,
  IdentityPickerMenu,
  ModelPickerMenu,
  ModelTrigger,
  NetworkSearchSetting,
  PERMISSION_MODE_COLLAPSED_TOOLBAR_LEVEL,
  PermissionMenu,
  REASONING_LABELS,
  SKILL_COLLAPSED_TOOLBAR_LEVEL,
  resolveFloatingMenuStyle,
  useComposerToolbarCollapse,
  type IdentityOption,
  type KernelInstallState,
  type PermissionMode,
  type ReasoningEffort,
} from './compose-toolbar.js';
import { TurnSkillControl } from './TurnSkillControl.js';
import { keepListboxOptionVisible } from './compose-picker-scroll.js';
import { FileChangesCard } from './ExecutionProcessBlock.js';
import {
  formatCompactCount,
  formatCompactDuration,
  formatCompactRunMetrics,
  formatMessageAbsoluteTime,
  formatMessageClock,
  formatRunModelLabel,
} from './execution-process.js';
import { MarkdownContent } from './MarkdownContent.js';
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
import { persistentComputerUseAppOf } from './tool-approval.js';
import { projectTodoFromEvents } from './todo-projection.js';
import { ComposerTaskPanel } from './ComposerTaskPanel.js';
import { InlineProcessFlow } from './InlineProcessFlow.js';
import {
  buildAssistantTurnNavigationItems,
  ConversationMinimapRail,
  type ConversationNavigationItem,
} from './ConversationMinimapRail.js';
import { executeBrowserCommand } from './browser-commands.js';
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
  fetchProviderUsageSummary,
  formatProviderUsageWindow,
  summarizeProviderUsageWindows,
  type ProviderUsageIdentity,
  type ProviderUsageWindows,
} from './provider-usage-summary.js';
import {
  inferNativeScrollIntent,
  resolveBottomPinState,
  shouldRestorePrependAnchor,
} from './message-window.js';
import {
  collectRunProcessIds,
  projectRunTerminalEvents,
  reconcileStreamingMessageProcessTerminal,
  reconcileRunProcessTerminal,
  updateRunProcessMap,
} from './run-process-state.js';
import {
  readConversationKernelOverride,
  readConversationModelOverride,
  readConversationNetworkEnabled,
  readConversationReasoningEffort,
  writeConversationKernelOverride,
  writeConversationModelOverride,
  writeConversationNetworkEnabled,
  writeConversationReasoningEffort,
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
export type InlineProcessItem =
  | {
      kind: 'reasoning';
      text: string;
      id?: string;
      sequence?: number;
      status?: 'streaming' | 'completed';
    }
  | {
      kind: 'text' | 'commentary';
      text: string;
      id?: string;
      sequence?: number;
      status?: 'streaming' | 'completed';
    }
  | {
      kind: 'tool';
      id?: string;
      sequence?: number;
      toolCallId?: string;
      name: string;
      displayName?: string;
      inputSummary?: string;
      argumentsJson: string;
      result?: string;
      failed?: boolean;
      status?: 'running' | 'completed' | 'failed';
      /** First observed tool boundary (native steps carry these). */
      startedAt?: string;
      /** Terminal tool boundary, when reported. */
      completedAt?: string;
      /**
       * Live progress of a still-running tool, from ephemeral `tool_progress`
       * transient frames. Never persisted and never replayed — a reconnecting
       * client falls back to the elapsed clock until the next frame arrives.
       */
      progressLine?: string;
      progressBytes?: number;
      progressAt?: string;
    }
  | {
      kind: 'status';
      id?: string;
      sequence?: number;
      statusType: Extract<AssistantTurnSegment, { kind: 'status' }>['statusType'];
      label: string;
      detail?: string;
    };

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  /** User-visible assistant progress, separate from the final answer. */
  commentaryText?: string;
  /** Ordered commentary fragments interleaved with durable tool boundaries. */
  commentarySegments?: CommentaryTimelineSegment[];
  /** Provider reasoning summary — shown as a collapsible thinking region. */
  reasoningText?: string;
  /** Exact ordered assistant turn emitted by Runtime. */
  assistantTimeline?: AssistantTurnSegment[];
  /** Final formal answer: the last non-empty text block of the message. */
  answerText?: string;
  /** Ordered execution-process items before the final answer (DSH-style inline view). */
  processItems?: InlineProcessItem[];
  /** Transient reconnect or fallback transition shown with the live assistant turn. */
  processStatus?: string;
  processStatusState?: NonNullable<RuntimeConnectionNotice>['state'];
  /** Local image previews attached to this bubble (optimistic / UI only). */
  images?: MessageImage[];
  /** Visual tone for system notices — never treat all system as error. */
  tone?: SystemMessageTone;
  timestamp: string;
  /** Durable thread-local order; present for messages loaded from the store. */
  sequence?: number;
  streaming?: boolean;
  runId?: string;
  /** Kernel that produced this run (persisted on the message; survives restarts). */
  kernelId?: string;
  terminalState?: 'failed' | 'cancelled';
  terminalError?: string;
  /** Historical terminal event materialized after newer durable rows already existed. */
  legacyTerminalBackfill?: boolean;
  /** Bound global agent identity for this assistant turn. */
  globalAgentId?: string;
  globalAgentName?: string;
  /** Exact Skill versions selected for this user turn. */
  skillVersionIds?: string[];
  skills?: Array<{ skillVersionId: string; name: string }>;
}

interface RunAgentIdentity {
  id?: string;
  name?: string;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Recover the immutable agent binding stamped on each Run. */
export function projectRunAgentIdentities(events: readonly Event[]): Map<string, RunAgentIdentity> {
  const identities = new Map<string, RunAgentIdentity>();
  for (const event of events) {
    if (event.type !== 'run.started') continue;
    const payloadRun =
      event.payload.run && typeof event.payload.run === 'object'
        ? (event.payload.run as Record<string, unknown>)
        : undefined;
    const runId =
      (event.runId ? String(event.runId) : undefined) ??
      nonEmptyString(event.payload.runId) ??
      nonEmptyString(payloadRun?.id);
    if (!runId) continue;
    const id =
      nonEmptyString(event.payload.globalAgentId) ?? nonEmptyString(payloadRun?.globalAgentId);
    const name =
      nonEmptyString(event.payload.globalAgentName) ?? nonEmptyString(payloadRun?.globalAgentName);
    if (id || name) identities.set(runId, { id, name });
  }
  return identities;
}

/**
 * runId → kernelId for every run this conversation has started. Message bubbles
 * use it to badge each turn with the kernel logo that actually produced it
 * (visible across kernel switches: CC → Codex → CC shows the logo per turn).
 */
export function projectRunKernels(events: readonly Event[]): Map<string, string> {
  const kernels = new Map<string, string>();
  for (const event of events) {
    if (event.type !== 'run.started') continue;
    const payloadRun =
      event.payload.run && typeof event.payload.run === 'object'
        ? (event.payload.run as Record<string, unknown>)
        : undefined;
    const runId =
      (event.runId ? String(event.runId) : undefined) ??
      nonEmptyString(event.payload.runId) ??
      nonEmptyString(payloadRun?.id);
    if (!runId) continue;
    const kernelId = nonEmptyString(event.payload.kernelId) ?? nonEmptyString(payloadRun?.kernelId);
    if (kernelId) kernels.set(runId, kernelId);
  }
  return kernels;
}

export type RuntimeConnectionNotice =
  { state: 'retrying'; text: string } | { state: 'failed'; text: string } | null;

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

function assistantTimelineToChatFields(timeline: readonly AssistantTurnSegment[] | undefined): {
  answerText?: string;
  commentaryText?: string;
  reasoningText?: string;
  processItems?: InlineProcessItem[];
} {
  if (!timeline?.length) return {};
  const ordered = [...timeline].sort((left, right) => left.sequence - right.sequence);
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
  const reasoningText = ordered
    .filter(
      (segment): segment is Extract<AssistantTurnSegment, { kind: 'thinking' }> =>
        segment.kind === 'thinking',
    )
    .map((segment) => segment.text)
    .join('\n\n');
  const processItems = ordered.flatMap((segment): InlineProcessItem[] => {
    if (segment.kind === 'thinking') {
      return segment.text.trim()
        ? [
            {
              kind: 'reasoning',
              id: segment.id,
              sequence: segment.sequence,
              text: segment.text,
              status: segment.status,
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
          status: segment.status,
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
    ...(answerText ? { answerText } : {}),
    ...(commentaryText ? { commentaryText } : {}),
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
 * Live bubble text: classified final_answer when present, otherwise the
 * still-unclassified provider tail. Hiding that tail until the terminal
 * boundary is what made the timer freeze and then dump the whole answer.
 */
export function visibleStreamingAnswerText(projected: ProjectedTransientAnswer): string {
  return projected.answerText || projected.pendingText;
}

export interface ProjectedTransientAssistantDisplay extends ProjectedTransientAnswer {
  /** Only phase-confirmed items belong in the NewMax/DSH execution process. */
  commentaryText?: string;
  reasoningText?: string;
  processItems?: InlineProcessItem[];
}

/**
 * Project a live turn without making the unclassified text tail jump through
 * the execution panel. The tail stays out of process items until Runtime
 * classifies it; the chat bubble still shows it as a provisional answer.
 */
export function projectTransientAssistantDisplay(
  draftText: string,
  timeline: readonly AssistantTurnSegment[] | undefined,
): ProjectedTransientAssistantDisplay {
  const timelineFields = assistantTimelineToChatFields(timeline);
  return {
    ...projectTransientAnswerText(draftText, timeline),
    ...(timelineFields.commentaryText ? { commentaryText: timelineFields.commentaryText } : {}),
    ...(timelineFields.reasoningText ? { reasoningText: timelineFields.reasoningText } : {}),
    ...(timelineFields.processItems ? { processItems: timelineFields.processItems } : {}),
  };
}

export function messageToChat(msg: Message): ChatMessage {
  const assistantTimeline = parseAssistantTimeline(msg.blocks);
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
          if (reasoning.trim()) processItems.push({ kind: 'reasoning', text: reasoning });
          break;
        }
        case 'text':
          if ((block.text ?? '').trim())
            processItems.push({ kind: 'text', text: block.text ?? '' });
          break;
        case 'commentary':
          if ((block.text ?? '').trim())
            processItems.push({ kind: 'commentary', text: block.text ?? '' });
          break;
        case 'tool-call': {
          const payload = (block.payload ?? {}) as { name?: string; argumentsJson?: string };
          processItems.push({
            kind: 'tool',
            name: payload.name ?? '工具',
            argumentsJson: payload.argumentsJson ?? '',
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
    terminalPayload.terminalState === 'failed' || terminalPayload.terminalState === 'cancelled'
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
    commentaryText: timelineFields.commentaryText ?? (commentaryText || undefined),
    commentarySegments: assistantTimeline
      ? undefined
      : commentarySegments.length > 0
        ? commentarySegments
        : undefined,
    reasoningText: timelineFields.reasoningText ?? (reasoningText || undefined),
    assistantTimeline,
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

/**
 * A v2 backfill appends missing legacy terminal rows without rewriting durable
 * sequence cursors. Only pages containing such a row use event time to restore
 * the original visual turn order; normal pages retain canonical sequence order.
 */
export function orderDurableMessagesForDisplay(messages: readonly ChatMessage[]): ChatMessage[] {
  const ordered = [...messages];
  if (!ordered.some((message) => message.legacyTerminalBackfill)) {
    return ordered.sort(
      (left, right) =>
        (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER),
    );
  }
  return ordered.sort((left, right) => {
    const leftAt = Date.parse(left.timestamp);
    const rightAt = Date.parse(right.timestamp);
    if (Number.isFinite(leftAt) && Number.isFinite(rightAt) && leftAt !== rightAt) {
      return leftAt - rightAt;
    }
    return (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER);
  });
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

/**
 * Hide an optimistic user bubble in the same render that its durable copy
 * arrives. The cleanup effect still removes it from state afterwards, but
 * rendering must not wait one extra commit or the message rail briefly sees
 * duplicate ids and the conversation height jumps.
 */
export function filterPendingUserMessagesForDisplay(
  pendingMessages: readonly ChatMessage[],
  durableMessages: readonly ChatMessage[],
): ChatMessage[] {
  if (pendingMessages.length === 0 || durableMessages.length === 0) {
    return [...pendingMessages];
  }
  const durableIds = new Set(durableMessages.map((message) => message.id));
  return pendingMessages.filter((message) => !durableIds.has(message.id));
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
  arguments?: Record<string, unknown>;
  allowedScopes?: ToolApprovalScope[];
  decided?: 'approve' | 'deny';
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

interface QueueDispatchAttempt {
  requestId: string;
  token: symbol;
}

interface QueueBlockedRequest {
  requestId: string;
  error: string;
}

interface QueueDispatchState {
  dispatching?: QueueDispatchAttempt;
  blocked?: QueueBlockedRequest;
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
  /** Latest run with file changes, reported up so the workspace-files tab
   *  (ConversationTabs) can render the Review panel. */
  onLatestReviewChange?(view: RunProcessView | null): void;
  onOpenFile?: (path: string, location?: ProjectTextLocation) => void;
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

export function ChatView({
  conversation,
  modelName,
  models,
  agents = [],
  teams = [],
  workspaces = [],
  eventHistory,
  runActivityAuthority,
  runtimeConnectionRevision = 0,
  runtimeConnectionNotice,
  onTitleUpdated,
  onConversationUpdated,
  initialSkillVersionIds,
  onInitialSkillSelectionConsumed,
  seedComposerText,
  onSeedComposerTextConsumed,
  onLatestReviewChange,
  onOpenFile,
  onOpenReview,
  onOpenPlanSettings,
  onCreateSkill,
  onOpenMcpSettings,
}: ChatViewProps) {
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
  const refreshPendingAsk = useCallback(() => {
    const api = bridge();
    if (!threadId || !api?.conversationAskPending) return;
    void api
      .conversationAskPending({ threadId })
      .then((res) => setPendingAsk(res.ask))
      .catch(() => setPendingAsk(undefined));
  }, [threadId]);
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
  const lastPlanEventSeqRef = useRef(0);
  const planReviewAskIdRef = useRef<string | null>(null);
  useEffect(() => {
    planReviewAskIdRef.current = null;
  }, [conversation.id]);
  const refreshConversationPlan = useCallback(() => {
    const api = bridge();
    if (!api?.conversationPlanGet) return;
    void api
      .conversationPlanGet({ conversationId: conversation.id })
      .then((res) => setConversationPlan(res.plan))
      .catch(() => setConversationPlan(undefined));
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
    if (conversationPlan?.state !== 'draft') return;
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
  }, [conversationPlan?.state]);
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
  const [goalSettingsOpen, setGoalSettingsOpen] = useState(false);
  const [goalSettingsSubmitting, setGoalSettingsSubmitting] = useState(false);
  const [goalSettingsMode, setGoalSettingsMode] = useState<'create' | 'edit'>('create');
  const [pendingRiskGoal, setPendingRiskGoal] = useState<string | null>(null);
  const [riskGoalSubmitting, setRiskGoalSubmitting] = useState(false);
  const riskGoalSubmissionRef = useRef(false);
  const [goalSettingsInitial, setGoalSettingsInitial] = useState<
    Partial<GoalSettingsValues> | undefined
  >();
  const refreshGoal = useCallback(() => {
    const api = bridge();
    if (!conversation || !api?.getGoal) return;
    void api
      .getGoal({ conversationId: String(conversation.id) })
      .then(setGoalState)
      .catch(() => setGoalState(undefined));
  }, [conversation]);
  useEffect(() => {
    refreshGoal();
    // Active goals are evaluated after each run, so keep round/status feedback live.
    const timer = window.setInterval(
      refreshGoal,
      goalState?.goal?.status === 'active' ? 2_000 : 30_000,
    );
    return () => window.clearInterval(timer);
  }, [goalState?.goal?.status, refreshGoal]);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(
    (conversation.executionMode as PermissionMode) || 'full-access',
  );
  // Restore the conversation's own reasoning effort across switches/restarts;
  // each conversation keeps its chosen thinking intensity until changed again.
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(
    () => readConversationReasoningEffort(String(conversation.id)) ?? 'auto',
  );
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
  /** Optimistic user bubbles not yet present in durable event history. */
  const [pendingUserMessages, setPendingUserMessages] = useState<ChatMessage[]>([]);
  const [localErrors, setLocalErrorsRaw] = useState<ChatMessage[]>([]);
  // Bounded FIFO: error bubbles are transient diagnostics; cap them so a
  // failing subsystem cannot grow state (and every downstream merge/sort) unboundedly.
  const setLocalErrors = useCallback((updater: SetStateAction<ChatMessage[]>) => {
    setLocalErrorsRaw((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      return next.length > MAX_LOCAL_ERRORS ? next.slice(next.length - MAX_LOCAL_ERRORS) : next;
    });
  }, []);
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
  const updateRunProcess = useCallback((process: RunProcessView | null | undefined) => {
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
        inFlightRunProcessesRef.current.delete(String(frame.runId));
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
  }, [renderTransientDraft, threadId, updateRunProcess]);
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
  /** Active @-mention query (null = picker closed). */
  const [mention, setMention] = useState<MentionQuery | null>(null);
  const [mentionFiles, setMentionFiles] = useState<
    Array<{ path: string; name: string; kind: 'file' | 'dir' }>
  >([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionLoading, setMentionLoading] = useState(false);
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
  /** Composer-only drafts. They do not become messages or Provider context until dispatched. */
  const [queuedComposeRequests, setQueuedComposeRequests] = useState<QueuedComposeRequest[]>(() =>
    readQueuedComposeRequests(String(conversation.id)),
  );
  const [dispatchingQueuedRequestId, setDispatchingQueuedRequestId] = useState<
    string | undefined
  >();
  const [blockedQueuedRequestId, setBlockedQueuedRequestId] = useState<string | undefined>();
  const [queuedRequestDispatchError, setQueuedRequestDispatchError] = useState<
    string | undefined
  >();
  /**
   * Queue dispatch ownership is conversation-scoped. A single boolean lock is
   * insufficient because this ChatView instance survives conversation switches:
   * clearing that lock on navigation lets the same persisted draft dispatch twice
   * when the user returns before appendMessage settles.
   */
  const queuedDispatchByConversationRef = useRef(new Map<string, QueueDispatchState>());
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
  /** Click-to-preview lightbox for message / chip images. */
  const [lightbox, setLightbox] = useState<MessageImage | null>(null);
  const [dragOver, setDragOver] = useState(false);
  /** Live tick so compact capsule can show elapsed seconds. */
  const [compactNow, setCompactNow] = useState(() => Date.now());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const messagesContentRef = useRef<HTMLDivElement>(null);
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
  const inputValueRef = useRef(input);
  inputValueRef.current = input;
  const speechRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const suppressPickerRefreshRef = useRef(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const composeRef = useRef<HTMLDivElement>(null);
  const mentionListRef = useRef<HTMLDivElement>(null);
  const mentionNetworkSettingRef = useRef<HTMLDivElement>(null);
  const slashListRef = useRef<HTMLDivElement>(null);
  const lastSlashQueryRef = useRef('');
  if (slash) lastSlashQueryRef.current = slash.query;
  const permissionBtnRef = useRef<HTMLButtonElement>(null);
  const modelBtnRef = useRef<HTMLButtonElement>(null);
  const identityBtnRef = useRef<HTMLButtonElement>(null);
  const [mentionPopStyle, setMentionPopStyle] = useState<React.CSSProperties | null>(null);
  const [slashPopStyle, setSlashPopStyle] = useState<React.CSSProperties | null>(null);
  const commitQueuedComposeRequests = useCallback(
    (update: (current: readonly QueuedComposeRequest[]) => QueuedComposeRequest[]): void => {
      const conversationId = String(conversation.id);
      setQueuedComposeRequests((current) => {
        const next = update(current);
        writeQueuedComposeRequests(conversationId, next);
        return next;
      });
    },
    [conversation.id],
  );
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
    usageSummaryLoadGenerationRef.current += 1;
    setDurableUsageSummary(null);
    transientDraftRef.current = null;
    transientFrameQueueRef.current.length = 0;
    if (transientFrameFlushRef.current !== null) {
      window.clearTimeout(transientFrameFlushRef.current);
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
    setSlashIndex(-1);
    setSlashCategory('all');
    setResolvedSlashItems([]);
    setSlashPopStyle(null);
    setMcpMenuOpen(false);
    setMcpMenuStyle(null);
    setAttachments([]);
    const conversationId = String(conversation.id);
    const queuedDispatchState = queuedDispatchByConversationRef.current.get(conversationId);
    setQueuedComposeRequests(readQueuedComposeRequests(conversationId));
    setDispatchingQueuedRequestId(queuedDispatchState?.dispatching?.requestId);
    setBlockedQueuedRequestId(queuedDispatchState?.blocked?.requestId);
    setQueuedRequestDispatchError(queuedDispatchState?.blocked?.error);
    clearCompactDismissTimer();
    setCompactProgress(null);
    setMenu(null);
    setPermissionMode((conversation.executionMode as PermissionMode) || 'full-access');
    setModelOverride(readConversationModelOverride(String(conversation.id)) ?? '');
    setRetryAfterModelPickMessageId(undefined);
    setKernelOverride(readConversationKernelOverride(String(conversation.id)) ?? 'native');
    setReasoningEffort(readConversationReasoningEffort(String(conversation.id)) ?? 'auto');
    setNetEnabled(readConversationNetworkEnabled(String(conversation.id)) ?? true);
    // Always land at the latest message when opening a chat — no animated scroll.
    stickToBottomRef.current = true;
    bottomPinIntentRef.current = null;
    lastTouchClientYRef.current = null;
    // 注意：不能把 conversation.executionMode 放进依赖——权限切换会经
    // onConversationUpdated → refresh 更新该字段，导致此「切换对话」重置
    // effect 被误触发：消息被清空而 loadMessages 不重跑，聊天区永远停在
    // 「加载中…」。权限模式由 setPermission 自行同步，这里只需跟随 id。
  }, [clearCompactDismissTimer, clearRunProcessRetryState, conversation.id]);

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
            throw new Error('安装完成，但未检测到 Pi，请检查 npm 全局目录是否在 PATH 中');
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
        const converted = res.messages.map(messageToChat).filter(shouldDisplayChatMessage);
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
        if (cursor !== undefined) {
          // Prepend older messages and de-duplicate defensive retries. Durable
          // sequence is the canonical order, not async response arrival order.
          setLoadedMessages((prev) => {
            const byId = new Map<string, ChatMessage>();
            for (const message of [...converted, ...prev]) byId.set(message.id, message);
            return orderDurableMessagesForDisplay([...byId.values()]);
          });
        } else {
          // Initial / terminal refresh — already in chronological order (ASC).
          setLoadedMessages(orderDurableMessagesForDisplay(converted));
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
    [conversation.id, renderTransientDraft],
  );

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
  }, [conversation.id, conversation.targetRef, conversation.track, kernelOverride, modelOverride]);

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
      const response = await api.getUsageSummary({ taskId });
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

  // Load the durable message page only when the selected conversation changes.
  // Context refreshes can follow model/kernel changes and must not re-read the
  // message list, otherwise switching a kernel causes an avoidable second
  // history request (and makes conversation navigation feel slow).
  useEffect(() => {
    if (!conversation.id) return;
    void loadMessages();
  }, [conversation.id, loadMessages]);

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
  /** NewMax-style Review: latest run with file changes (drives the Review tab). */
  const latestReviewView = useMemo(() => {
    let latest: RunProcessView | null = null;
    for (const process of displayRunProcessById.values()) {
      if (process.fileChanges.length === 0) continue;
      if (!latest) {
        latest = process;
        continue;
      }
      const candidateStamp = process.completedAt ?? process.startedAt ?? '';
      const latestStamp = latest.completedAt ?? latest.startedAt ?? '';
      if (candidateStamp > latestStamp) latest = process;
    }
    return latest;
  }, [displayRunProcessById]);
  /** Report up so the workspace-files tab (ConversationTabs) can render Review. */
  useEffect(() => {
    onLatestReviewChange?.(latestReviewView);
  }, [latestReviewView, onLatestReviewChange]);
  const runAgentIdentityById = useMemo(
    () => projectRunAgentIdentities(eventHistory),
    [eventHistory],
  );
  const runKernelById = useMemo(() => projectRunKernels(eventHistory), [eventHistory]);
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
  const lastHostCompactionSignatureRef = useRef('');
  useEffect(() => {
    const event = latestHostCompactionEvent;
    if (!event) return;
    const signature = `${event.id}:${event.type}`;
    if (lastHostCompactionSignatureRef.current === signature) return;
    lastHostCompactionSignatureRef.current = signature;

    const mode = event.payload.mode === 'auto' ? 'auto' : 'manual';
    const eventStartedAt = Date.parse(nonEmptyString(event.payload.startedAt) ?? event.occurredAt);
    const startedAt = Number.isFinite(eventStartedAt) ? eventStartedAt : Date.now();
    const numberPayload = (key: string): number | undefined => {
      const value = event.payload[key];
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    };
    if (event.type !== 'context.compaction_started' && Date.now() - startedAt > 15_000) {
      return;
    }

    clearCompactDismissTimer();
    if (event.type === 'context.compaction_started') {
      compactingRef.current = true;
      setCompactProgress({
        status: 'running',
        mode,
        startedAt,
        message: mode === 'auto' ? '正在自动压缩上下文…' : '正在手动压缩上下文…',
      });
      return;
    }

    compactingRef.current = false;
    const beforeTokens = numberPayload('beforeTokens');
    const afterTokens = numberPayload('afterTokens');
    const foldedCount = numberPayload('foldedCount') ?? 0;
    const durationMs = numberPayload('durationMs');
    const elapsed =
      durationMs !== undefined
        ? formatCompactElapsed(Date.now() - durationMs, Date.now())
        : formatCompactElapsed(startedAt);
    if (event.type === 'context.compacted') {
      const saved =
        beforeTokens !== undefined && afterTokens !== undefined
          ? `（${beforeTokens} → ${afterTokens}）`
          : '';
      setCompactProgress({
        status: 'success',
        mode,
        startedAt,
        message: `上下文已${mode === 'auto' ? '自动' : ''}压缩${saved} · 折叠 ${foldedCount} 条 · ${elapsed}`,
        afterTokens,
      });
      scheduleCompactDismiss(2400);
      void refreshContextStatus();
      return;
    }
    if (event.type === 'context.compaction_failed') {
      setCompactProgress({
        status: 'failure',
        mode,
        startedAt,
        message: `上下文${mode === 'auto' ? '自动' : ''}压缩失败 · ${elapsed}`,
      });
      scheduleCompactDismiss(2400);
      return;
    }
    setCompactProgress({
      status: 'noop',
      mode,
      startedAt,
      message: `当前上下文无需压缩 · ${elapsed}`,
    });
    scheduleCompactDismiss(1600);
  }, [
    clearCompactDismissTimer,
    latestHostCompactionEvent,
    refreshContextStatus,
    scheduleCompactDismiss,
  ]);
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
  const activeRunAgent = useMemo(() => {
    const identity = projected.activeRunId
      ? runAgentIdentityById.get(String(projected.activeRunId))
      : undefined;
    if (!identity) return conversationAgent;
    return agents.find(
      (agent) =>
        (identity.id && String(agent.id) === identity.id) ||
        (!identity.id && identity.name && agent.name === identity.name),
    );
  }, [agents, conversationAgent, projected.activeRunId, runAgentIdentityById]);
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
            window.clearTimeout(transientFrameFlushRef.current);
            transientFrameFlushRef.current = null;
          }
          const latestStreamSequence = event.latestStreamSequence ?? 0;
          if (event.snapshot && event.snapshot.threadId === threadId) {
            transientFallbackOnlyRef.current = false;
            transientStreamHealthyRef.current = true;
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
        if (!frame) return;
        if (transientFallbackOnlyRef.current) {
          lastTransientSequenceRef.current = Math.max(
            lastTransientSequenceRef.current,
            frame.streamSequence,
          );
          if (frame.kind === 'terminal') {
            if (frame.process) {
              updateRunProcess(frame.process);
            } else {
              inFlightRunProcessesRef.current.delete(String(frame.runId));
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
        window.clearTimeout(transientFrameFlushRef.current);
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
    scheduleTransientFrameFlush,
    threadId,
    updateRunProcess,
  ]);

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
      return;
    }
    const generation = (pendingToolApprovalLoadGenerationRef.current += 1);
    try {
      const response = await api.listPendingToolApprovals({ threadId: threadId as ThreadId });
      if (pendingToolApprovalLoadGenerationRef.current !== generation) return;
      setRuntimePendingApprovals(
        response.approvals.filter((approval) => String(approval.threadId) === threadId),
      );
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

  const [decidingApprovalId, setDecidingApprovalId] = useState<string | null>(null);

  const handleToolApproval = useCallback(
    async (approvalId: string, decision: 'approve' | 'deny', scope: ToolApprovalScope = 'once') => {
      const api = bridge();
      if (!api?.decideToolApproval || decidingApprovalId) return;
      setDecidingApprovalId(approvalId);
      try {
        await api.decideToolApproval({
          approvalId,
          decision,
          scope: decision === 'deny' ? 'once' : scope,
        });
        await refreshPendingToolApprovals();
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
    [decidingApprovalId, refreshPendingToolApprovals],
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
    for (let i = 0; i < pendingUserMessagesForDisplay.length; i++) {
      stamped.push({
        value: pendingUserMessagesForDisplay[i]!,
        seq: nextVirtualSeq++,
        tie: 10_000 + i,
      });
    }

    // Streaming assistant turn: virtual sequence after the pending bubbles.
    if (visibleStreamingMessage) {
      // Keep the streaming slot's sequence stable across re-merges by hashing
      // on its runId so older-arriving frames don't reshuffle it.
      stamped.push({ value: visibleStreamingMessage, seq: nextVirtualSeq++, tie: 20_000 });
    }

    // Local diagnostics render after the live turn.
    for (let i = 0; i < localErrors.length; i++) {
      stamped.push({ value: localErrors[i]!, seq: nextVirtualSeq++, tie: 30_000 + i });
    }
    stamped.sort((a, b) => (a.seq !== b.seq ? a.seq - b.seq : a.tie - b.tie));
    return stamped.map((s) => s.value);
  }, [localErrors, loadedMessages, pendingUserMessagesForDisplay, visibleStreamingMessage]);

  const navigationItems = useMemo<ConversationNavigationItem[]>(
    () =>
      buildAssistantTurnNavigationItems(
        messages.filter(shouldDisplayChatMessage).map((message) => ({
          id: message.id,
          role: message.role,
          text: message.text,
          commentaryText: message.commentaryText,
          processStatus: message.processStatus,
          timestamp: message.timestamp,
        })),
      ),
    [messages],
  );

  const handleNavigateMessage = useCallback((_messageId: string, targetScrollTop: number) => {
    const scroller = messagesScrollRef.current;
    if (!scroller) return;
    stickToBottomRef.current = false;
    bottomPinIntentRef.current = null;
    userScrollRevisionRef.current += 1;
    programmaticScrollTargetRef.current = targetScrollTop;
    scroller.scrollTop = targetScrollTop;
    lastObservedScrollTopRef.current = targetScrollTop;
  }, []);

  // Keep every fetched durable message mounted. History is still paginated in
  // 50-message pages, but native scrolling must not compete with virtual spacer
  // refinement or persistent visual-anchor restoration.
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
      terminalState: 'failed',
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
  const liveMessages = useMemo(() => {
    const result: ChatMessage[] = [];
    result.push(...pendingUserMessagesForDisplay);
    if (visibleStreamingMessage) result.push(visibleStreamingMessage);
    result.push(...localErrors);
    return result;
  }, [localErrors, pendingUserMessagesForDisplay, visibleStreamingMessage]);

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
    const runIds = collectRunProcessIds({
      durableRunIds: visibleDurableMessages
        .filter((message) => message.role === 'assistant' && Boolean(message.runId))
        .map((message) => message.runId as string),
      transientRunId: streamingMessage?.runId,
      projectedActiveRunId: projected.activeRunId ? String(projected.activeRunId) : undefined,
    });
    for (const [runId, timer] of runProcessRetryTimersRef.current) {
      if (runIds.has(runId)) continue;
      window.clearTimeout(timer);
      runProcessRetryTimersRef.current.delete(runId);
      runProcessRetryAttemptsRef.current.delete(runId);
    }
    for (const runId of runIds) {
      if (runProcessById.has(runId) || inFlightRunProcessesRef.current.has(runId)) continue;
      inFlightRunProcessesRef.current.add(runId);
      const typedRunId = runId as RunId;
      void api
        .getConversationRunProcess({ runId: typedRunId })
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
    projected.activeRunId,
    streamingMessage?.runId,
    updateRunProcess,
    visibleDurableMessages,
  ]);

  const flowTipSignature = `${conversation.id}:${messages.at(-1)?.id ?? 'empty'}:${
    messages.at(-1)?.streaming ? 'streaming' : 'settled'
  }:${pendingApprovals.at(-1)?.approvalId ?? 'no-approval'}`;
  const pinMessagesToBottom = useCallback(() => {
    const scroller = messagesScrollRef.current;
    if (!scroller || !stickToBottomRef.current) return;
    const target = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    if (Math.abs(scroller.scrollTop - target) > 1) {
      programmaticScrollTargetRef.current = target;
      scroller.scrollTop = target;
    }
    lastObservedScrollTopRef.current = scroller.scrollTop;
  }, []);

  // Message boundaries use a stable tip signature. Actual Markdown/process
  // growth follows ResizeObserver and does not force layout on every text delta.
  useLayoutEffect(() => {
    pinMessagesToBottom();
  }, [flowTipSignature, pinMessagesToBottom]);
  useEffect(() => {
    const content = messagesContentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => pinMessagesToBottom());
    observer.observe(content);
    return () => observer.disconnect();
  }, [conversation.id, pinMessagesToBottom]);

  const sendUserText = useCallback(
    async (
      text: string,
      images: MessageImage[] = [],
      options?: {
        skillVersionIds?: readonly string[];
        modelOverride?: string;
        kernelOverride?: string;
        reasoningEffort?: ReasoningEffort;
        networkEnabled?: boolean;
        /** 批准方案后的执行轮：runtime 据此强制 plan-act 的执行模型。 */
        planExecuting?: boolean;
        /** NewMax 内置帮助轮：runtime 注入产品帮助合同，不改变会话模式。 */
        helpMode?: boolean;
      },
    ) => {
      const api = bridge();
      if (!api || (!text.trim() && images.length === 0)) return;
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

      // Auto-compact when context occupancy is near the window limit (~70%).
      // Failures are non-fatal — the user message still goes out.
      const status = contextStatusRef.current;
      if (
        api.compactConversation &&
        !compactingRef.current &&
        kernelOverride === 'native' &&
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
            if (isActiveConversation()) {
              setCompactProgress({
                status: 'success',
                mode: 'auto',
                startedAt,
                // NewMax: "Context automatically compacted"
                message: `上下文已自动压缩${saved} · 折叠 ${compactResult.foldedCount} 条 · ${elapsed}`,
                afterTokens: compactResult.afterTokens,
              });
              scheduleCompactDismiss(2400);
            }
          } else if (isActiveConversation()) {
            setCompactProgress({
              status: 'noop',
              mode: 'auto',
              startedAt,
              message: `当前上下文无需压缩 · ${formatCompactElapsed(startedAt)}`,
            });
            scheduleCompactDismiss(1600);
          }
        } catch {
          // Auto compact remains non-blocking, but its failure is visible.
          if (isActiveConversation()) {
            setCompactProgress({
              status: 'failure',
              mode: 'auto',
              startedAt,
              message: `上下文自动压缩失败 · ${formatCompactElapsed(startedAt)}`,
            });
            scheduleCompactDismiss(2400);
          }
        } finally {
          await refreshContextStatus();
          compactingRef.current = false;
        }
      }

      const tempId = `temp-${Date.now()}`;
      if (isActiveConversation()) {
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
        const prep = await api.sendConversationMessage({
          conversationId: conversation.id,
          text,
        });
        if (
          isActiveConversation() &&
          typeof prep.threadId === 'string' &&
          prep.threadId.length > 0
        ) {
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
            modelOverride: selectedModelOverride,
            track: conversation.track,
            targetRef: conversation.targetRef,
            catalogModelIds: models.map((model) => model.modelId),
          }),
          // Multi-kernel: this turn runs on the selected kernel (default native).
          kernelId: options?.kernelOverride ?? kernelOverride,
          // 'auto' 原样透传：runtime 透传后由 adapters 映射为默认思考档（auto=开启思考）。
          reasoningEffort: selectedReasoningEffort,
          networkEnabled: selectedNetworkEnabled || undefined,
          planExecuting: options?.planExecuting === true ? true : undefined,
          helpMode: options?.helpMode === true ? true : undefined,
          skillVersionIds,
          attachmentContext:
            images.length > 0
              ? {
                  conversationId,
                  workspacePath: conversation.workspaceId
                    ? workspaces
                        .find((workspace) => workspace.workspaceId === conversation.workspaceId)
                        ?.folderPath?.trim() || undefined
                    : undefined,
                }
              : undefined,
          images:
            images.length > 0
              ? images.map((img) => ({
                  id: img.id,
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
        // Vision fallback echoes: if the runtime replaced the images with a
        // description (or failed to), tell the user so the turn is not a
        // silent "the model cannot see this" surprise.
        if (images.length > 0 && isActiveConversation()) {
          if (response.imagesMode === 'materialized') {
            setLocalErrors((prev) => [
              ...prev,
              {
                id: `vision-mat-${Date.now()}`,
                role: 'system',
                tone: 'info',
                text: '当前模型不支持图片输入，附件已保存到工作区；模型会调用 ocr_image 提取文字，并可在已启用视觉 Fallback 时调用 describe_image。',
                timestamp: new Date().toISOString(),
              },
            ]);
          } else if (response.imagesMode === 'described') {
            setLocalErrors((prev) => [
              ...prev,
              {
                id: `vision-desc-${Date.now()}`,
                role: 'system',
                tone: 'info',
                text: '当前模型不支持图片输入，附件已由视觉模型生成文字描述替代。',
                timestamp: new Date().toISOString(),
              },
            ]);
          } else if (response.imagesMode === 'ocr') {
            setLocalErrors((prev) => [
              ...prev,
              {
                id: `vision-ocr-${Date.now()}`,
                role: 'system',
                tone: 'info',
                text: '当前模型不支持图片输入，已由 Windows OCR 自动提取附件文字；OCR 不包含画面中无法识别为文字的内容。',
                timestamp: new Date().toISOString(),
              },
            ]);
          } else if (response.imagesMode === 'failed') {
            setLocalErrors((prev) => [
              ...prev,
              {
                id: `vision-fail-${Date.now()}`,
                role: 'system',
                tone: 'warning',
                text: '视觉模型 Fallback 与 Windows OCR 均未能处理附件，原图未发送给当前文本模型。',
                timestamp: new Date().toISOString(),
              },
            ]);
          }
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
        }
        throw err;
      } finally {
        if (isActiveConversation()) inputRef.current?.focus();
      }
    },
    [
      clearCompactDismissTimer,
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
      refreshContextStatus,
      scheduleCompactDismiss,
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
        if (goalState?.goal?.status === 'active' && !(await pauseGoalForTransition())) return;
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
      if (goalState?.goal?.status === 'active') {
        void pauseGoalForTransition();
        return;
      }
      if (
        goalState?.goal &&
        ['paused', 'blocked'].includes(goalState.goal.status) &&
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
    goalState,
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

  const dispatchQueuedComposeRequest = useCallback(
    async (request: QueuedComposeRequest, mode: 'auto' | 'interject') => {
      const conversationId = String(conversation.id);
      if (request.conversationId !== conversationId) return;
      if (mode === 'auto' && activeConversationIdRef.current !== conversationId) return;

      const currentDispatchState =
        queuedDispatchByConversationRef.current.get(conversationId) ?? {};
      if (currentDispatchState.dispatching) return;

      const token = Symbol(`queued-compose:${conversationId}:${request.id}`);
      const nextDispatchState: QueueDispatchState = {
        ...currentDispatchState,
        dispatching: { requestId: request.id, token },
        blocked:
          currentDispatchState.blocked?.requestId === request.id
            ? undefined
            : currentDispatchState.blocked,
      };
      queuedDispatchByConversationRef.current.set(conversationId, nextDispatchState);
      if (activeConversationIdRef.current === conversationId) {
        setDispatchingQueuedRequestId(request.id);
      }
      if (
        activeConversationIdRef.current === conversationId &&
        currentDispatchState.blocked?.requestId === request.id
      ) {
        setBlockedQueuedRequestId(undefined);
        setQueuedRequestDispatchError(undefined);
      }

      const outbound = buildMessageWithAttachments(request.text, request.attachments);
      const images = messageImagesFromAttachments(request.attachments);
      try {
        const sent = await sendUserText(outbound, images, {
          modelOverride,
          reasoningEffort: request.reasoningEffort,
          networkEnabled: request.networkEnabled,
          skillVersionIds: request.skillVersionIds,
          kernelOverride: request.kernelOverride,
        });
        if (!sent) throw new Error('发送接口未返回成功结果');

        const latestDispatchState = queuedDispatchByConversationRef.current.get(conversationId);
        if (latestDispatchState?.dispatching?.token !== token) return;
        const settledDispatchState: QueueDispatchState = {
          ...latestDispatchState,
          dispatching: undefined,
        };
        if (settledDispatchState.blocked) {
          queuedDispatchByConversationRef.current.set(conversationId, settledDispatchState);
        } else {
          queuedDispatchByConversationRef.current.delete(conversationId);
        }

        if (activeConversationIdRef.current === conversationId) {
          commitQueuedComposeRequests((current) => removeQueuedComposeRequest(current, request.id));
          setDispatchingQueuedRequestId(undefined);
          setBlockedQueuedRequestId(settledDispatchState.blocked?.requestId);
          setQueuedRequestDispatchError(settledDispatchState.blocked?.error);
        } else {
          const stored = readQueuedComposeRequests(conversationId);
          writeQueuedComposeRequests(
            conversationId,
            removeQueuedComposeRequest(stored, request.id),
          );
        }
      } catch (error) {
        const latestDispatchState = queuedDispatchByConversationRef.current.get(conversationId);
        if (latestDispatchState?.dispatching?.token !== token) return;
        const dispatchError =
          mode === 'auto'
            ? '自动执行失败，需求已保留，可点击重试'
            : `插话发送失败，需求已保留：${error instanceof Error ? error.message : String(error)}`;
        const failedDispatchState: QueueDispatchState = {
          ...latestDispatchState,
          dispatching: undefined,
          blocked: { requestId: request.id, error: dispatchError },
        };
        queuedDispatchByConversationRef.current.set(conversationId, failedDispatchState);
        if (activeConversationIdRef.current === conversationId) {
          setDispatchingQueuedRequestId(undefined);
          setBlockedQueuedRequestId(request.id);
          setQueuedRequestDispatchError(dispatchError);
        }
      }
    },
    [commitQueuedComposeRequests, conversation.id, modelOverride, sendUserText],
  );

  const handleEditQueuedComposeRequest = useCallback(
    (requestId: string, text: string) => {
      const request = queuedComposeRequests.find((item) => item.id === requestId);
      if (!request || (!text.trim() && request.attachments.length === 0)) return;
      commitQueuedComposeRequests((current) =>
        updateQueuedComposeRequest(current, requestId, { text }),
      );
    },
    [commitQueuedComposeRequests, queuedComposeRequests],
  );

  const handleDeleteQueuedComposeRequest = useCallback(
    (requestId: string) => {
      if (dispatchingQueuedRequestId === requestId) return;
      commitQueuedComposeRequests((current) => removeQueuedComposeRequest(current, requestId));
      if (blockedQueuedRequestId === requestId) {
        const conversationId = String(conversation.id);
        const dispatchState = queuedDispatchByConversationRef.current.get(conversationId);
        if (dispatchState?.blocked?.requestId === requestId) {
          if (dispatchState.dispatching) {
            queuedDispatchByConversationRef.current.set(conversationId, {
              dispatching: dispatchState.dispatching,
            });
          } else {
            queuedDispatchByConversationRef.current.delete(conversationId);
          }
        }
        setBlockedQueuedRequestId(undefined);
        setQueuedRequestDispatchError(undefined);
      }
    },
    [
      blockedQueuedRequestId,
      commitQueuedComposeRequests,
      conversation.id,
      dispatchingQueuedRequestId,
    ],
  );

  const handleInterjectQueuedComposeRequest = useCallback(
    (requestId: string) => {
      const request = queuedComposeRequests.find((item) => item.id === requestId);
      if (!request) return;
      void dispatchQueuedComposeRequest(request, 'interject');
    },
    [dispatchQueuedComposeRequest, queuedComposeRequests],
  );

  useEffect(() => {
    const next = queuedComposeRequests[0];
    const dispatchState = queuedDispatchByConversationRef.current.get(String(conversation.id));
    if (
      !next ||
      next.conversationId !== String(conversation.id) ||
      runIsActive ||
      Boolean(dispatchState?.dispatching) ||
      dispatchState?.blocked?.requestId === next.id ||
      (conversation.taskId && !threadId)
    ) {
      // Safety net for a "ghost" active run: right after switching the kernel
      // the projected activeRunId can briefly outlive the run's terminal event,
      // which would park the first queued message behind `runIsActive` forever
      // (compose clears, the message never lands). When there is genuinely no
      // in-flight send (`reconciledSending`), force-dispatch after a short
      // grace period so the user's message is not silently dropped.
      if (
        next &&
        next.conversationId === String(conversation.id) &&
        !reconciledSending &&
        !dispatchState?.dispatching &&
        dispatchState?.blocked?.requestId !== next.id
      ) {
        const safetyTimer = window.setTimeout(() => {
          const current = queuedDispatchByConversationRef.current.get(String(conversation.id));
          if (current?.dispatching || current?.blocked?.requestId === next.id) return;
          if (queuedComposeRequests[0]?.id === next.id) {
            void dispatchQueuedComposeRequest(next, 'auto');
          }
        }, 6_000);
        return () => window.clearTimeout(safetyTimer);
      }
      return;
    }
    const timer = window.setTimeout(() => {
      void dispatchQueuedComposeRequest(next, 'auto');
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    blockedQueuedRequestId,
    conversation.taskId,
    dispatchQueuedComposeRequest,
    queuedComposeRequests,
    reconciledSending,
    runIsActive,
    threadId,
  ]);

  const handleRegenerate = useCallback(
    async (assistantMessageId: string, nextModelId?: string) => {
      if (sending) return;
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
      await sendUserText(userMessage.text, [], {
        skillVersionIds: userMessage.skillVersionIds ?? [],
        ...(nextModelId ? { modelOverride: nextModelId } : {}),
      });
    },
    [messages, sendUserText, sending],
  );

  const handleContinueInterrupted = useCallback(
    async (assistantMessageId: string) => {
      if (sending) return;
      const idx = messages.findIndex((message) => message.id === assistantMessageId);
      const previousUser =
        idx > 0
          ? [...messages.slice(0, idx)].reverse().find((message) => message.role === 'user')
          : undefined;
      await sendUserText('继续上一条未完成的回答。', [], {
        skillVersionIds: previousUser?.skillVersionIds ?? [],
      });
    },
    [messages, sendUserText, sending],
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
      setMentionPopStyle(
        resolveFloatingMenuStyle(
          {
            top: r.top,
            bottom: r.bottom,
            left: r.left,
            right: r.right,
            width: r.width,
            height: r.height,
          },
          { width: window.innerWidth, height: window.innerHeight },
          { width: r.width, maxHeight: 360 },
        ),
      );
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

  const dismissMentionToInput = useCallback(() => {
    suppressPickerRefreshRef.current = true;
    closeMention();
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      window.requestAnimationFrame(() => {
        suppressPickerRefreshRef.current = false;
      });
    });
  }, [closeMention]);

  const closeSlash = useCallback(() => {
    setSlash(null);
    setSlashIndex(-1);
    setSlashCategory('all');
    setResolvedSlashItems([]);
  }, []);

  const closeComposePickers = useCallback(() => {
    closeMention();
    closeSlash();
    setMcpMenuOpen(false);
    setComposerAddOpen(false);
    setMenu(null);
  }, [closeMention, closeSlash]);

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
    goalState?.goal && ['active', 'paused', 'blocked'].includes(goalState.goal.status)
      ? goalState.goal
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
      conversationPlan?.state === 'draft' &&
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
    !mention &&
    !slashMenuOpen &&
    !mcpMenuOpen &&
    !composerAddOpen &&
    !menu &&
    !composerPendingAsk &&
    conversationPlan?.state !== 'draft' &&
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
    void api
      .listSkills(
        conversation.workspaceId
          ? { limit: 500, workspaceId: conversation.workspaceId }
          : { limit: 500 },
      )
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
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
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
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
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
      if (mention) {
        const stripped = stripMentionToken(input, mention);
        setInput(stripped.text);
        closeComposePickers();
        window.requestAnimationFrame(() => {
          const el = inputRef.current;
          if (!el) return;
          resizeComposeInput();
          el.focus();
          el.setSelectionRange(stripped.caret, stripped.caret);
        });
      }
    },
    [closeComposePickers, conversation.id, input, mention, resizeComposeInput],
  );

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
          message: `上下文已压缩${saved} · 折叠 ${result.foldedCount} 条 · ${elapsed}`,
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
    if ((!text && attachments.length === 0) || compactingRef.current) return;

    const slashCmd = parseSlashCommand(text);
    const isGoalTransitionCommand =
      slashCmd.kind === 'plan' ||
      slashCmd.kind === 'plan-with-request' ||
      slashCmd.kind === 'execute' ||
      slashCmd.kind === 'goal-clear';
    if (goalState?.goal?.status === 'active' && !isGoalTransitionCommand) return;

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
          if (goalState?.goal?.status === 'active' && !(await pauseGoalForTransition())) return;
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
    commitQueuedComposeRequests,
    conversation.id,
    goalState,
    input,
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
          computeTextareaHeight(el, 36, 200);
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
    if (suppressPickerRefreshRef.current) return;
    // @ takes priority when both could match; mutually exclusive menus.
    const nextMention = detectMentionQuery(text, caret);
    if (nextMention) {
      setMention(nextMention);
      setSlash(null);
      setSlashIndex(-1);
      return;
    }
    setMention(null);
    setMentionFiles([]);
    setMentionIndex(0);
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
      setInput(next);
      updatePickersFromCaret(next, caret);
      window.requestAnimationFrame(() => {
        resizeComposeInput();
        const inputElement = inputRef.current;
        if (!inputElement) return;
        inputElement.focus();
        inputElement.setSelectionRange(caret, caret);
      });
    },
    [input, resizeComposeInput, updatePickersFromCaret],
  );

  const handleInputChange = useCallback(
    (value: string, caret: number) => {
      setMcpMenuOpen(false);
      setInput(value);
      if (composerAddOpen) {
        closeMention();
        closeSlash();
        return;
      }
      updatePickersFromCaret(value, caret);
    },
    [closeMention, closeSlash, composerAddOpen, updatePickersFromCaret],
  );

  const handleEditorSelectionChange = useCallback(
    (caret: number) => {
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
      // @-picker navigation takes priority while open.
      if (mention) {
        const mentionItemCount = 2 + mentionFiles.length;
        if (e.key === 'Escape') {
          e.preventDefault();
          closeMention();
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setMentionIndex((i) => (i + 1) % mentionItemCount);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setMentionIndex((i) => (i - 1 + mentionItemCount) % mentionItemCount);
          return;
        }
        if (e.key === 'Tab') {
          const segments = mentionNetworkSettingRef.current?.querySelectorAll<HTMLButtonElement>(
            '.shell-mention-setting__segment',
          );
          const target = segments?.[e.shiftKey ? segments.length - 1 : 0];
          if (target) {
            e.preventDefault();
            target.focus();
            return;
          }
        }
        if (e.key === 'Enter') {
          if (mentionIndex === 0) {
            e.preventDefault();
            closeComposePickers();
            imageInputRef.current?.click();
            return;
          }
          if (mentionIndex === 1) {
            e.preventDefault();
            handleNetworkSettingChange(!netEnabled);
            return;
          }
          const selected = mentionFiles[mentionIndex - 2];
          if (selected) {
            e.preventDefault();
            selectMentionFile(selected);
            return;
          }
        }
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
      if (e.key === 'Escape' && !mention && !slash) {
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
      closeMention,
      closeSlash,
      handleSend,
      handleStop,
      mention,
      mentionFiles,
      mentionIndex,
      modeKeywordHint,
      mcpMenuOpen,
      netEnabled,
      projected.streaming,
      handleNetworkSettingChange,
      selectMentionFile,
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
  // When the latest external-kernel run reports its final request occupancy
  // (context watermark — last request totalInput+output, never the tool-loop
  // sum), use that for the ring and mark the breakdown as kernel-managed.
  const kernelContextWatermark = useMemo(() => {
    let latestTokens: number | undefined;
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
        latestTokens = process.contextWatermarkTokens;
      }
    }
    return latestTokens;
  }, [displayRunProcessById, kernelOverride, runKernelById]);
  const kernelSelfManaged = kernelContextWatermark !== undefined;
  const contextUsed = kernelContextWatermark ?? contextStatus?.estimatedUsedTokens ?? 0;

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
  const showTyping = reconciledSending || projected.streaming;
  const canStop = Boolean(projected.activeRunId) && (reconciledSending || projected.streaming);
  // Active kernel display + pause degradation per capabilities.pause.
  const activeKernel = kernelRegistry?.find((kernel) => kernel.kernelId === kernelOverride) ?? null;
  // Effective ring window + source label: the model's configured window is
  // capped by a non-overridable kernel native limit (Claude Code = 200k), so
  // the ring never shows a budget the kernel itself cannot honor.
  const contextModelWindow =
    contextStatus?.modelContextWindow ??
    activeModelOption?.contextWindow ??
    estimateContextWindow(activeModelId || activeModel);
  const contextConfiguredWindow = contextStatus?.contextWindow ?? contextModelWindow;
  const contextWindowCap = activeKernel?.capabilities?.contextWindow;
  const contextWindowCapped =
    contextStatus?.contextWindowSource === 'kernel-limit' ||
    (contextWindowCap !== undefined &&
      contextWindowCap.overridable === false &&
      contextConfiguredWindow > contextWindowCap.nativeLimit);
  const contextLimit = contextWindowCapped
    ? (contextWindowCap?.nativeLimit ?? contextConfiguredWindow)
    : contextConfiguredWindow;
  const contextWindowSource: 'configured' | 'kernel-capped' | 'estimated' =
    contextStatus?.contextWindowEstimated === true
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

  // 任务清单投影（对齐 DSH todo projection）：持久化事件流 → 常驻面板。
  // run 结束保留完成清单，新 run 开始清空。
  const todoProjection = useMemo(
    () =>
      projectTodoFromEvents(eventHistory, {
        threadId,
        taskId: conversation.taskId ? String(conversation.taskId) : undefined,
      }),
    [conversation.taskId, eventHistory, threadId],
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
            onWheel={(event) => {
              if (event.deltaY !== 0) {
                userScrollRevisionRef.current += 1;
                bottomPinIntentRef.current =
                  event.deltaY > 0 ? 'toward-bottom' : 'away-from-bottom';
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
                } else if (
                  nativeIntent === 'toward-bottom' &&
                  bottomPinIntentRef.current === null
                ) {
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
            <div ref={messagesContentRef} className="shell-chat-content mx-auto flex flex-col">
              {loadingMore && (
                <div className="flex items-center justify-center py-3">
                  <LoaderCircle className="h-4 w-4 animate-spin text-text-faint" />
                  <span className="ml-2 text-[12px] text-text-faint">加载更早消息…</span>
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
              {visibleDurableMessages.map((msg) => (
                <div
                  key={msg.id}
                  data-message-id={msg.id}
                  className="shell-message-window-item pb-6"
                >
                  <MessageBubble
                    message={msg}
                    processView={msg.runId ? displayRunProcessById.get(msg.runId) : undefined}
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
                    onOpenReview={onOpenReview}
                    projectFolder={projectFolder}
                    onOpenImage={setLightbox}
                    kernelId={
                      msg.kernelId ?? (msg.runId ? runKernelById.get(String(msg.runId)) : undefined)
                    }
                    skillNameByVersionId={skillNameByVersionId}
                  />
                </div>
              ))}
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
                  className="shell-message-window-item pb-6"
                >
                  <MessageBubble
                    message={msg}
                    processView={msg.runId ? displayRunProcessById.get(msg.runId) : undefined}
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
                    onOpenReview={onOpenReview}
                    projectFolder={projectFolder}
                    onOpenImage={setLightbox}
                    kernelId={
                      msg.kernelId ?? (msg.runId ? runKernelById.get(String(msg.runId)) : undefined)
                    }
                    skillNameByVersionId={skillNameByVersionId}
                    dismissLocalError={
                      localErrors.some((error) => error.id === msg.id)
                        ? (messageId) =>
                            setLocalErrors((prev) => prev.filter((error) => error.id !== messageId))
                        : undefined
                    }
                  />
                </div>
              ))}
              {showTyping &&
                !messages.some((message) => message.streaming) &&
                pendingApprovals.length === 0 && <TypingIndicator agent={activeRunAgent} />}
              <div ref={messagesEndRef} />
            </div>
          </div>

          <ConversationMinimapRail
            items={navigationItems}
            scrollerRef={messagesScrollRef}
            onNavigate={handleNavigateMessage}
          />
        </div>

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
                conversationPlan?.state === 'draft'
                  ? {
                      key: `${conversationPlan.planId}:${conversationPlan.currentRevision}`,
                      node: (
                        <PlanApprovalCard
                          variant="composer"
                          conversationId={conversation.id}
                          plan={conversationPlan}
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
              {/* @ file picker — portal so chat column overflow cannot clip it */}
              {mention &&
                mentionPopStyle &&
                typeof document !== 'undefined' &&
                createPortal(
                  <div
                    ref={mentionListRef}
                    className="shell-mention-pop shell-mention-pop--context shell-mention-pop--portal"
                    style={mentionPopStyle}
                    data-testid="compose-mention-pop"
                    role="dialog"
                    aria-label="添加上下文和设置"
                  >
                    <ComposerMenuHighlight
                      containerRef={mentionListRef}
                      activeIndex={mentionIndex}
                    />
                    <div className="shell-mention-pop__section-label">来源与上下文</div>
                    <button
                      type="button"
                      className="shell-mention-pop__upload"
                      data-composer-menu-index={0}
                      data-active={mentionIndex === 0 ? '1' : '0'}
                      onMouseEnter={() => setMentionIndex(0)}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        closeComposePickers();
                        imageInputRef.current?.click();
                      }}
                    >
                      <ImagePlus size={13} aria-hidden="true" />
                      <span>上传图片</span>
                      <span className="shell-mention-pop__upload-hint">PNG / JPG</span>
                    </button>
                    <div
                      className="shell-mention-pop__settings"
                      data-composer-menu-index={1}
                      onMouseEnter={() => setMentionIndex(1)}
                    >
                      <NetworkSearchSetting
                        enabled={netEnabled}
                        rootRef={mentionNetworkSettingRef}
                        onDismiss={dismissMentionToInput}
                        onChange={handleNetworkSettingChange}
                      />
                    </div>
                    <div className="shell-mention-pop__divider" aria-hidden="true" />
                    <div className="shell-mention-pop__section-label">工作区文件</div>
                    <div
                      className="shell-mention-pop__files"
                      role="listbox"
                      aria-label="工作区文件"
                    >
                      {!hasProjectFolder ? (
                        <div className="shell-mention-pop__empty">未绑定项目文件夹</div>
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
                            aria-selected={index + 2 === mentionIndex}
                            data-composer-menu-index={index + 2}
                            className={`shell-mention-pop__item ${
                              index + 2 === mentionIndex ? 'is-active' : ''
                            }`}
                            onMouseEnter={() => setMentionIndex(index + 2)}
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
                    </div>
                    <div className="shell-composer-menu__hint">输入以搜索来源和文件</div>
                  </div>,
                  document.body,
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
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  onOpenAttachment={(attachment) => {
                    if (attachment.kind === 'image' && attachment.previewUrl) {
                      setLightbox({
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
                />
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
                    kernelLabel={
                      kernelOverride === 'native'
                        ? undefined
                        : resolveKernelDisplayName(kernelOverride, activeKernel?.name)
                    }
                    modelContextWindow={contextStatus?.modelContextWindow ?? contextModelWindow}
                    contextWindowEstimated={contextStatus?.contextWindowEstimated}
                    contextWindowSource={contextWindowSource}
                    // External kernels report the authoritative watermark;
                    // the Runtime snapshot ratio describes the host estimate
                    // and must not override it in ContextRing.
                    usageRatio={kernelSelfManaged ? undefined : contextStatus?.usageRatio}
                    compactThreshold={contextStatus?.compactThreshold}
                    compactedAt={contextStatus?.compactedAt}
                    sections={contextStatus?.sections}
                    kernelSelfManaged={kernelSelfManaged}
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
                        contextStatusLoadGenerationRef.current += 1;
                        setContextStatus(null);
                        setKernelOverride(kernelId);
                        writeConversationKernelOverride(String(conversation.id), kernelId);
                        onConversationUpdated?.();
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

/**
 * Collapsible user-message text. Messages taller than USER_TEXT_COLLAPSE_HEIGHT
 * are collapsed by default with a height cap; the 显示更多 / 收起 toggle sits at
 * the bottom-left of the bubble. Short messages render as-is.
 */
const USER_TEXT_COLLAPSE_HEIGHT = 160;

const CollapsibleUserText = memo(function CollapsibleUserText({
  text,
  prefix,
}: {
  text: string;
  prefix?: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const [overflowing, setOverflowing] = useState(false);
  const innerRef = useRef<HTMLDivElement>(null);

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
        <span>{text}</span>
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

function HarnessTerminalNotice({
  state,
  error,
  busy,
  onContinue,
  onRetry,
}: {
  state: 'failed' | 'cancelled';
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
  return (
    <details className="shell-harness-terminal is-failed" data-testid="assistant-terminal-failed">
      <summary>
        <span className="shell-harness-terminal__dot" aria-hidden="true" />
        <span className="shell-harness-terminal__title">运行失败</span>
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
    </details>
  );
}

function ProviderAccountUsageSection({ identity }: { identity: ProviderUsageIdentity }) {
  const [windows, setWindows] = useState<ProviderUsageWindows | null>(null);

  useEffect(() => {
    const api = bridge();
    if (!api?.getUsageSummary) return;
    let alive = true;
    void fetchProviderUsageSummary(() => api.getUsageSummary({ sinceDays: 30 }))
      .then((summary) => {
        if (alive) setWindows(summarizeProviderUsageWindows(summary, identity));
      })
      .catch(() => {
        if (alive) setWindows(null);
      });
    return () => {
      alive = false;
    };
  }, [identity]);

  if (!windows?.today && !windows?.last30d) return null;
  return (
    <div className="shell-usage-tip__account" data-testid="provider-usage-windows">
      {windows.today ? (
        <div className="shell-usage-tip__account-row">
          <span>今日</span>
          <strong>{formatProviderUsageWindow(windows.today)}</strong>
        </div>
      ) : null}
      {windows.last30d ? (
        <div className="shell-usage-tip__account-row">
          <span>近30天</span>
          <strong>{formatProviderUsageWindow(windows.last30d)}</strong>
        </div>
      ) : null}
    </div>
  );
}

const MessageBubble = memo(function MessageBubble({
  message,
  processView,
  models,
  agents,
  runAgentIdentity,
  fallbackAgent,
  regenerating,
  onRegenerate,
  onContinue,
  onOpenChange,
  onOpenReview,
  projectFolder,
  onOpenImage,
  kernelId,
  skillNameByVersionId,
  dismissLocalError,
}: {
  message: ChatMessage;
  processView?: RunProcessView;
  models?: readonly ModelOption[];
  agents?: readonly GlobalAgent[];
  runAgentIdentity?: RunAgentIdentity;
  fallbackAgent?: GlobalAgent;
  regenerating?: boolean;
  onRegenerate?: (messageId: string) => void;
  onContinue?: (messageId: string) => void;
  onChooseModelAndRetry?: (messageId: string) => void;
  onOpenChange?: (path: string, location?: ProjectTextLocation) => void;
  onOpenReview?: (view: RunProcessView) => void;
  projectFolder?: string;
  onOpenImage?: (image: MessageImage) => void;
  /** Kernel that produced this turn (native/empty → no badge). */
  kernelId?: string;
  skillNameByVersionId?: ReadonlyMap<string, string>;
  /** Dismiss callback for transient local diagnostics. */
  dismissLocalError?: (messageId: string) => void;
}) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const systemTone: SystemMessageTone = resolveSystemMessageTone(message.tone, message.text);
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);

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
    if (!message.text.trim()) return;
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore */
    }
  }, [message.text]);

  const answerSources = useMemo(
    () =>
      message.streaming
        ? []
        : collectAnswerSources(
            message.answerText ?? message.text,
            message.processItems,
            projectFolder,
          ),
    [message.answerText, message.processItems, message.streaming, message.text, projectFolder],
  );

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
              <CollapsibleUserText
                text={message.text}
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
              {message.text?.trim() ? (
                <button
                  type="button"
                  className="ml-1.5 inline-flex items-center rounded p-0.5 text-text-faint transition-colors hover:bg-[color-mix(in_srgb,var(--color-text)_10%,transparent)] hover:text-text"
                  onClick={() => void handleCopy()}
                  title="复制"
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
          <span className="whitespace-pre-wrap">{message.text}</span>
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

  // AI message — thinking + process + file changes + markdown + NewMax-style footer
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
  const timelineTiming = assistantTimelineProcessTiming(
    message.assistantTimeline,
    !message.streaming,
  );
  const showFooter = !message.streaming && (hasAnswerText || Boolean(processView));
  return (
    <div className="shell-msg shell-msg--assistant group relative flex items-start gap-2.5">
      <div className="shrink-0 pt-0.5">
        <AgentAvatarView name={avatarName} avatar={avatarSource?.avatar} size={26} />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        {visibleAgentLabel ? (
          <div className="mb-1 text-[11.5px] font-medium text-text-faint">{visibleAgentLabel}</div>
        ) : null}
        <InlineProcessFlow
          items={[
            // Streaming snapshots carry reasoning in the message field (not in
            // blocks yet); prepend it so the thinking row streams in time
            // order. Completed messages already derive it from blocks.
            ...(!(message.processItems ?? []).some((item) => item.kind === 'reasoning') &&
            message.reasoningText
              ? [{ kind: 'reasoning' as const, text: message.reasoningText }]
              : []),
            ...(message.processItems ?? []),
          ]}
          steps={processView?.steps}
          commentarySegments={message.commentarySegments}
          streaming={Boolean(message.streaming)}
          answerStarted={hasAnswerText}
          runId={message.runId ?? message.id}
          startedAt={processView?.startedAt ?? timelineTiming.startedAt}
          completedAt={processView?.completedAt ?? timelineTiming.completedAt}
          durationMs={processView?.durationMs}
          onOpenChange={onOpenChange}
          supplementalContent={
            message.processStatus ||
            message.terminalState ||
            (!message.streaming && (processView?.fileChanges.length ?? 0) > 0) ? (
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
                {!message.streaming && processView && processView.fileChanges.length > 0 ? (
                  <FileChangesCard
                    view={processView}
                    nested
                    onOpenChange={onOpenChange}
                    onOpenReview={onOpenReview}
                    projectFolder={projectFolder}
                  />
                ) : null}
              </>
            ) : undefined
          }
        />
        {message.answerText || (!message.processItems?.length && message.text) ? (
          <MarkdownContent
            text={message.answerText ?? message.text}
            streaming={Boolean(message.streaming)}
            projectFolder={projectFolder}
            onOpenFile={onOpenChange}
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
                    <button
                      type="button"
                      className="shell-msg-footer__btn"
                      onClick={() => void handleCopy()}
                      title={copied ? '已复制' : '复制'}
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
                  width={330}
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
  width?: number;
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
  const stepCount = processView?.steps.length ?? 0;
  const changeCount = processView?.fileChanges.length ?? 0;
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
  const lastProcessStep = processView?.steps.at(-1);
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

// ─── Tool approval card（询问批准） ───────────────────────────────────────────

function ToolApprovalCard({
  approval,
  busy,
  onApprove,
  onDeny,
}: {
  approval: PendingToolApproval;
  busy?: boolean;
  onApprove(scope: ToolApprovalScope): void;
  onDeny(): void;
}) {
  const persistentApp = persistentComputerUseAppOf(approval.toolName, approval.arguments);
  const scopes = approval.allowedScopes;
  const canAlwaysAllowApp = Boolean(persistentApp && (!scopes || scopes.includes('always-app')));
  const canAllowSession = Boolean(!persistentApp && (!scopes || scopes.includes('session')));
  const secondaryScope: ToolApprovalScope | undefined = canAlwaysAllowApp
    ? 'always-app'
    : canAllowSession
      ? 'session'
      : undefined;
  const secondaryLabel = canAlwaysAllowApp ? '始终允许此应用' : '本会话允许';
  const detail = approval.detail || approval.path || approval.command || approval.toolName;

  return (
    <div
      className="shell-composer-tool-approval"
      data-testid={`tool-approval-${approval.approvalId}`}
      data-tool={approval.toolName}
      data-persistent-app={persistentApp ? persistentApp.value : undefined}
    >
      <div className="shell-composer-tool-approval__main">
        <span className="shell-composer-tool-approval__icon" aria-hidden="true">
          <Shield size={16} />
        </span>
        <div className="shell-composer-tool-approval__copy">
          <div className="shell-composer-tool-approval__title">{approval.title}</div>
          <div className="shell-composer-tool-approval__detail">
            <span>需要批准</span>
            {detail ? <span aria-hidden="true"> · </span> : null}
            {detail ? (
              <span className="shell-composer-tool-approval__detail-text">{detail}</span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="shell-composer-tool-approval__actions">
        <button
          type="button"
          className="shell-composer-tool-approval__button is-approve"
          disabled={busy}
          onClick={() => onApprove('once')}
        >
          {busy ? '处理中…' : '批准'}
        </button>
        {secondaryScope ? (
          <button
            type="button"
            className="shell-composer-tool-approval__button is-secondary"
            disabled={busy}
            onClick={() => onApprove(secondaryScope)}
          >
            {secondaryLabel}
          </button>
        ) : null}
        <button
          type="button"
          className="shell-composer-tool-approval__button is-deny"
          disabled={busy}
          onClick={onDeny}
        >
          拒绝
        </button>
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

function TypingIndicator({ agent }: { agent?: GlobalAgent }) {
  return (
    <div
      className="flex items-start gap-3"
      data-testid="assistant-typing-indicator"
      role="status"
      aria-label="助手正在思考"
    >
      {agent?.avatar?.trim() ? (
        <div className="mt-0.5" data-agent-id={String(agent.id)}>
          <AgentAvatarView name={agent.name} avatar={agent.avatar} size={26} />
        </div>
      ) : (
        <div className="shell-ai-avatar mt-0.5" title={agent?.name ?? '助手'}>
          <Bot size={13} />
        </div>
      )}
      <TypingDots />
    </div>
  );
}
