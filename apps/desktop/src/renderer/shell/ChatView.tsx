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
  Archive,
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  FileCode2,
  FileWarning,
  FolderOpen,
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
  type ConversationPlanSummary,
  type Event,
  type GlobalAgent,
  type KernelDetectionResult,
  type Message,
  type MessageBlock,
  type RunId,
  type TaskId,
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
import { resolveKernelBrandLogo } from './brand-icons.js';
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
} from './compose-skill-selection.js';
import { ComposeRequestQueue } from './ComposeRequestQueue.js';
import { compressImageDataUrl } from './image-compress.js';
import {
  ContextRing,
  IdentityPickerMenu,
  ModelPickerMenu,
  ModelTrigger,
  NetworkSearchSetting,
  PermissionMenu,
  REASONING_LABELS,
  resolveFloatingMenuStyle,
  type IdentityOption,
  type KernelInstallState,
  type PermissionMode,
  type ReasoningEffort,
} from './compose-toolbar.js';
import { TurnSkillControl } from './TurnSkillControl.js';
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
import {
  AskQuestionCard,
  formatAskToolResult,
  parsePlanReviewDetail,
  planReviewOf,
  type PendingAsk,
} from './AskQuestionCard.js';
import { PlanApprovalCard } from './PlanApprovalCard.js';
import { TodoPanel } from './TodoPanel.js';
import { projectTodoFromEvents } from './todo-projection.js';
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
  selectLatestRunConnectionStatus,
  selectLatestRunPauseNotice,
  type ConversationStreamDraft,
} from './chat-stream.js';
import {
  buildConversationSnapshotDisplayQueue,
  getConversationDisplayQueueBatchOptions,
  mergeTransientConversationDraft,
  reconcileTransientConversationDraft,
  takeConversationDisplayQueueBatch,
  type ConversationDisplayQueueItem,
} from './chat-transient-stream.js';
import { projectConversationUsageMetrics } from './chat-usage.js';
import {
  inferNativeScrollIntent,
  resolveBottomPinState,
  shouldRestorePrependAnchor,
} from './message-window.js';
import {
  projectRunTerminalEvents,
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

/** Local error bubble FIFO cap: diagnostics are transient, keep them bounded. */
const MAX_LOCAL_ERRORS = 50;

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
  /** Bound global agent identity for this assistant turn. */
  globalAgentId?: string;
  globalAgentName?: string;
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
  /** 尚未被 timeline 分类的流式文本尾部（显示在过程面板当前顺序位置，§12.17.18）。 */
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
  decided?: 'approve' | 'deny';
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
  /** Latest run with file changes, reported up so the workspace-files tab
   *  (ConversationTabs) can render the Review panel. */
  onLatestReviewChange?(view: RunProcessView | null): void;
  onOpenFile?: (path: string, location?: ProjectTextLocation) => void;
  onOpenReview?: (view: RunProcessView) => void;
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
  onLatestReviewChange,
  onOpenFile,
  onOpenReview,
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
  const [sending, setSending] = useState(false);
  const [sendingRunId, setSendingRunId] = useState<string | undefined>();
  const [stopping, setStopping] = useState(false);
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
        scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
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
  const [planActSetting, setPlanActSetting] = useState<{
    enabled: boolean;
    planModelId: string | null;
    actModelId: string | null;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const api = bridge();
    if (!api?.getSettings) return;
    void api
      .getSettings({ keys: ['plan-act'] })
      .then((res) => {
        if (cancelled) return;
        const raw = res.settings?.['plan-act'];
        const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
        setPlanActSetting(
          o
            ? {
                enabled: o.enabled === true,
                planModelId:
                  typeof o.planModelId === 'string' && o.planModelId ? o.planModelId : null,
                actModelId:
                  typeof o.actModelId === 'string' && o.actModelId ? o.actModelId : null,
              }
            : null,
        );
      })
      .catch(() => setPlanActSetting(null));
    return () => {
      cancelled = true;
    };
  }, [conversation.id]);
  const [goalState, setGoalState] = useState<
    import('@sync-think/protocol').GoalGetResponse | undefined
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
    // 每轮 run 结束后刷新目标状态（评估器可能已推进/达成）。
    const timer = window.setInterval(refreshGoal, 30_000);
    return () => window.clearInterval(timer);
  }, [refreshGoal]);
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
  // plan-act 生效模型提示（规划模式路由）：显示规划模型，手动选择被忽略时附注。
  const planActHint = useMemo(() => {
    const setting = planActSetting;
    // 仅规划模式有路由提示：普通 execute 消息不路由，执行方案轮由批准动作
    // 触发、无需提示；执行模型只在批准后那一轮生效。
    if (!setting?.enabled || interactionMode !== 'plan') return null;
    const modelId = setting.planModelId;
    if (!modelId) return null;
    const option = models?.find((model) => model.modelId === modelId);
    const label = option ? `${option.displayName} · ${option.providerName}` : modelId;
    let ignoredLabel: string | undefined;
    const manualId = modelOverride.trim();
    if (manualId && manualId !== modelId) {
      const manualOption = models?.find((model) => model.modelId === manualId);
      ignoredLabel = manualOption
        ? `${manualOption.displayName} · ${manualOption.providerName}`
        : manualId;
    }
    return { role: 'plan' as const, label, ignoredLabel };
  }, [interactionMode, modelOverride, models, planActSetting]);
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
      const timelineFields = assistantTimelineToChatFields(draft?.assistantTimeline);
      const projected = draft
        ? projectTransientAnswerText(draft.text, draft.assistantTimeline)
        : { answerText: undefined as string | undefined, pendingText: '' };
      // 未分类流式文本尾部显示在过程面板当前顺序位置（§12.17.18），
      // 不进入总结面板；工具/终态边界分类后由 timeline 段取代。
      const processItems = projected.pendingText
        ? [
            ...(timelineFields.processItems ?? []),
            { kind: 'text' as const, text: projected.pendingText },
          ]
        : timelineFields.processItems;
      setStreamingMessage(
        draft
          ? {
              id: `streaming-${draft.runId ?? fallbackSequence}`,
              role: 'assistant',
              text: projected.answerText ?? '',
              commentaryText: timelineFields.commentaryText ?? draft.commentaryText,
              commentarySegments: draft.assistantTimeline ? undefined : draft.commentarySegments,
              reasoningText: timelineFields.reasoningText ?? draft.reasoningText,
              assistantTimeline: draft.assistantTimeline,
              answerText: projected.answerText,
              processItems,
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
      transientFrameFlushRef.current = window.requestAnimationFrame(flushTransientFrames);
    }
  }, [renderTransientDraft, threadId, updateRunProcess]);
  const scheduleTransientFrameFlush = useCallback(
    (publication: 'animation-frame' | 'immediate' = 'animation-frame') => {
      if (publication === 'immediate') {
        if (transientFrameFlushRef.current !== null) {
          window.cancelAnimationFrame(transientFrameFlushRef.current);
          transientFrameFlushRef.current = null;
        }
        flushTransientFrames();
        return;
      }
      if (transientFrameFlushRef.current === null) {
        transientFrameFlushRef.current = window.requestAnimationFrame(flushTransientFrames);
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
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashSkills, setSlashSkills] = useState<SkillVersionSummary[]>([]);
  const [slashSkillsLoading, setSlashSkillsLoading] = useState(false);
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
  const suppressPickerRefreshRef = useRef(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const composeRef = useRef<HTMLDivElement>(null);
  const mentionListRef = useRef<HTMLDivElement>(null);
  const mentionNetworkSettingRef = useRef<HTMLDivElement>(null);
  const slashListRef = useRef<HTMLDivElement>(null);
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
  }, [conversation.id, conversation.targetRef, conversation.track, modelOverride]);

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

  // Load initial durable messages and the Runtime-owned context snapshot.
  useEffect(() => {
    if (!conversation.id) return;
    void loadMessages();
    void refreshContextStatus();
  }, [conversation.id, threadId, loadMessages, refreshContextStatus]);

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
   * External-kernel self-compaction notices (kernel.context_compacted). Claude
   * Code / Codex give no live "compacting" signal, but once a run reports its
   * boundary the host surfaces it as a message-stream note so a compacted turn
   * is not mistaken for history loss.
   */
  const kernelCompactionEvents = useMemo(() => {
    const events: Event[] = [];
    for (const event of eventHistory) {
      if (event.type !== 'kernel.context_compacted') continue;
      const payloadThreadId = nonEmptyString(event.payload.threadId);
      if (threadId && payloadThreadId && payloadThreadId !== threadId) continue;
      events.push(event);
    }
    events.sort((a, b) => a.sequence - b.sequence);
    return events;
  }, [eventHistory, threadId]);
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
  const runIsActive = reconciledSending || projected.streaming || Boolean(projected.activeRunId);

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
    const attachRuntimeNotice = Boolean(
      runtimeConnectionNotice && (streamingMessage || projected.streaming || runConnectionStatus),
    );
    const statusText = attachRuntimeNotice
      ? runtimeConnectionNotice?.text
      : runConnectionStatus?.text;
    if (!statusText) return streamingMessage;
    const statusRunId =
      runConnectionStatus?.runId ?? projected.activeRunId ?? streamingMessage?.runId;
    if (
      streamingMessage &&
      (!statusRunId || !streamingMessage.runId || streamingMessage.runId === statusRunId)
    ) {
      return {
        ...streamingMessage,
        runId: streamingMessage.runId ?? statusRunId,
        processStatus: statusText,
        ...(attachRuntimeNotice && runtimeConnectionNotice
          ? { processStatusState: runtimeConnectionNotice.state }
          : {}),
      };
    }
    if (!runConnectionStatus && !attachRuntimeNotice) return streamingMessage;
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
            window.cancelAnimationFrame(transientFrameFlushRef.current);
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
  }, [
    localErrors,
    loadedMessages,
    pausedRunNotice,
    pendingUserMessagesForDisplay,
    visibleStreamingMessage,
  ]);

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
  const visibleDurableMessages = loadedMessages;
  const liveMessages = useMemo(() => {
    const result: ChatMessage[] = [];
    result.push(...pendingUserMessagesForDisplay);
    if (visibleStreamingMessage) result.push(visibleStreamingMessage);
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
  }, [localErrors, pausedRunNotice, pendingUserMessagesForDisplay, visibleStreamingMessage]);

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
                message: `上下文已自动压缩${saved} · ${elapsed}`,
                afterTokens: compactResult.afterTokens,
              });
              scheduleCompactDismiss(2400);
            }
          } else if (isActiveConversation()) {
            clearCompactDismissTimer();
            setCompactProgress(null);
          }
        } catch {
          // Auto compact failure is silent — do not block the user message.
          if (isActiveConversation()) {
            clearCompactDismissTimer();
            setCompactProgress(null);
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
          { width: Math.min(r.width, 520), maxHeight: 360 },
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
    setSlashIndex(0);
  }, []);

  const closeComposePickers = useCallback(() => {
    closeMention();
    closeSlash();
    setMenu(null);
  }, [closeMention, closeSlash]);

  const slashCommands = useMemo(() => (slash ? filterSlashCommands(slash.query) : []), [slash]);
  const filteredSlashSkills = useMemo(() => {
    if (!slash) return [];
    const query = slash.query.trim().toLocaleLowerCase();
    return slashSkills.filter((skill) => {
      if (!skill.enabled || selectedSkillVersionIds.includes(skill.skillVersionId)) return false;
      if (!query) return true;
      return [skill.name, skill.description, skill.skillId, skill.version]
        .join('\n')
        .toLocaleLowerCase()
        .includes(query);
    });
  }, [selectedSkillVersionIds, slash, slashSkills]);
  const slashItemCount = slashCommands.length + filteredSlashSkills.length;

  useEffect(() => {
    if (!slash) return;
    const api = bridge();
    if (!api?.listSkills) return;
    let cancelled = false;
    setSlashSkillsLoading(true);
    void api
      .listSkills(
        conversation.workspaceId
          ? { limit: 500, workspaceId: conversation.workspaceId }
          : { limit: 500 },
      )
      .then((response) => {
        if (!cancelled) setSlashSkills(response.skills.filter((skill) => skill.enabled));
      })
      .catch(() => {
        if (!cancelled) setSlashSkills([]);
      })
      .finally(() => {
        if (!cancelled) setSlashSkillsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [Boolean(slash), conversation.workspaceId]);

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

  const selectSlashSkill = useCallback(
    (skill: SkillVersionSummary) => {
      if (!slash) return;
      const stripped = stripSlashToken(input, slash);
      setInput(stripped.text);
      setSelectedSkillVersionIds((current) =>
        resolveAppendSkillVersionIds(conversation.track, [...current, skill.skillVersionId]),
      );
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

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || compactingRef.current) return;

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
          if (!api?.setGoal) return;
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
          const result = await api.setGoal({ conversationId, condition: slashCmd.condition });
          await refreshGoal();
          setLocalErrors((errs) => [
            ...errs,
            {
              id: `goal-set-${Date.now()}`,
              role: 'system',
              tone: 'success',
              text: result?.evaluatorConfigured
                ? '目标已设置：每轮结束后将自动评估并续跑'
                : '目标已设置，但尚未配置评估模型（设置 → 模型 → 目标模式评估模型）',
              timestamp: new Date().toISOString(),
            },
          ]);
        } else {
          // Bare /goal — show current goal or the required format.
          const current = goalState?.goal;
          setLocalErrors((errs) => [
            ...errs,
            {
              id: `goal-help-${Date.now()}`,
              role: 'system',
              tone: 'info',
              text: current
                ? `当前目标：${current.condition}（已运行 ${Math.floor(
                    (Date.now() - Date.parse(current.startedAt)) / 60_000,
                  )} 分钟 · 评估 ${current.turnCount} 轮）——使用 /goal <完成条件> 更新目标，/goal clear 清除`
                : '目标模式：使用 /goal <完成条件> 设置目标，如 /goal 完成所有测试；每轮结束后由独立评估模型判断是否达成',
              timestamp: new Date().toISOString(),
            },
          ]);
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
        } else {
          await api?.setConversationInteractionMode?.({
            conversationId: conversation.id,
            interactionMode: 'plan',
          });
          setInteractionMode('plan');
          if (slashCmd.kind === 'plan-with-request') {
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
            // 发送需求文本触发规划 run（只读工具注入由 runtime 处理）。
            await sendUserText(slashCmd.request, []);
          } else {
            setLocalErrors((errs) => [
              ...errs,
              {
                id: `plan-help-${Date.now()}`,
                role: 'system',
                tone: 'info',
                text: '已进入规划模式（只读）。请输入要分析的需求，或使用 /plan <需求> 一步进入',
                timestamp: new Date().toISOString(),
              },
            ]);
          }
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
    reasoningEffort,
    refreshGoal,
    resizeComposeInput,
    runIsActive,
    runManualCompact,
    selectedSkillVersionIds,
    sendUserText,
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
    if (suppressPickerRefreshRef.current) return;
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

  const handleStop = useCallback(async () => {
    const api = bridge();
    const runId = projected.activeRunId;
    if (!api?.cancelRun || !runId || stopping) return;
    setStopping(true);
    try {
      await api.cancelRun({ runId: runId as RunId });
      setSending(false);
      setSendingRunId(undefined);
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
          setSlashIndex((i) => (slashItemCount === 0 ? 0 : (i + 1) % slashItemCount));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSlashIndex((i) =>
            slashItemCount === 0 ? 0 : (i - 1 + slashItemCount) % slashItemCount,
          );
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          const selectedCommand = slashCommands[slashIndex];
          const selectedSkill = filteredSlashSkills[slashIndex - slashCommands.length];
          if (selectedCommand || selectedSkill) {
            e.preventDefault();
            if (selectedCommand) selectSlashCommand(selectedCommand);
            else if (selectedSkill) selectSlashSkill(selectedSkill);
            return;
          }
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
      closeMention,
      closeSlash,
      handleSend,
      handleStop,
      mention,
      mentionFiles,
      mentionIndex,
      projected.streaming,
      selectMentionFile,
      selectSlashCommand,
      slash,
      slashCommands,
      filteredSlashSkills,
      slashItemCount,
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
      if (!kernelId || kernelId === 'native') continue;
      const stamp = process.completedAt ?? process.startedAt ?? '';
      if (!latestStamp || stamp >= latestStamp) {
        latestStamp = stamp;
        latestTokens = process.contextWatermarkTokens;
      }
    }
    return latestTokens;
  }, [displayRunProcessById, runKernelById]);
  const kernelSelfManaged = kernelContextWatermark !== undefined;
  const contextUsed = kernelContextWatermark ?? contextStatus?.estimatedUsedTokens ?? 0;
  const contextLimitRaw = contextStatus?.contextWindow ?? 0;

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
  const contextWindowCap = activeKernel?.capabilities?.contextWindow;
  const contextWindowCapped =
    contextWindowCap !== undefined &&
    contextWindowCap.overridable === false &&
    contextLimitRaw > contextWindowCap.nativeLimit;
  const contextLimit = contextWindowCapped ? contextWindowCap!.nativeLimit : contextLimitRaw;
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
  const todoProjection = useMemo(() => projectTodoFromEvents(eventHistory), [eventHistory]);

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
              {kernelCompactionEvents.length > 0 ? (
                <div className="shell-kernel-compact-note" data-testid="kernel-compact-note">
                  <Info size={13} />
                  <span>
                    内核已自动压缩上下文
                    {kernelCompactionEvents.at(-1)?.occurredAt
                      ? `（${formatMessageClock(kernelCompactionEvents.at(-1)!.occurredAt)}）`
                      : ''}
                    —— 更早的对话细节已由内核摘要保留，可继续提问。
                  </span>
                </div>
              ) : null}
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
                    onOpenChange={onOpenFile}
                    onOpenReview={onOpenReview}
                    projectFolder={projectFolder}
                    onOpenImage={setLightbox}
                    kernelId={
                      msg.kernelId ?? (msg.runId ? runKernelById.get(String(msg.runId)) : undefined)
                    }
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
                    onOpenChange={onOpenFile}
                    onOpenReview={onOpenReview}
                    projectFolder={projectFolder}
                    onOpenImage={setLightbox}
                    kernelId={
                      msg.kernelId ?? (msg.runId ? runKernelById.get(String(msg.runId)) : undefined)
                    }
                  />
                </div>
              ))}
              {/* §方案卡：方案直接输出在聊天区（消息流尾部，draft 态），
                  大方案靠聊天区整体滚动查看；批准/取消后收起。 */}
              {conversationPlan?.state === 'draft' ? (
                <div className="shell-message-window-item pb-6" data-testid="plan-approval-message">
                  <PlanApprovalCard
                    conversationId={conversation.id}
                    plan={conversationPlan}
                    onPlanUpdated={handlePlanUpdated}
                    onExecute={(instruction) => void handlePlanExecute(instruction)}
                    onSwitchMode={(mode) => void handlePlanSwitchMode(mode)}
                    onNotify={handlePlanNotify}
                  />
                </div>
              ) : null}
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
            {todoProjection ? <TodoPanel todo={todoProjection} /> : null}
            {goalState?.goal ? (
              <GoalCapsule
                goal={goalState.goal}
                evaluatorConfigured={Boolean(goalState.evaluatorConfigured)}
                onPause={() => {
                  const api = bridge();
                  if (!conversation || !api?.goalPause) return;
                  void api.goalPause({ conversationId: String(conversation.id) }).then(refreshGoal);
                }}
                onResume={() => {
                  const api = bridge();
                  if (!conversation || !api?.goalResume) return;
                  void api.goalResume({ conversationId: String(conversation.id) }).then(refreshGoal);
                }}
                onEdit={() => {
                  setInput('/goal ');
                  inputRef.current?.focus();
                }}
                onClear={() => {
                  const api = bridge();
                  if (!conversation || !api?.clearGoal) return;
                  void api.clearGoal({ conversationId: String(conversation.id) }).then(refreshGoal);
                }}
              />
            ) : null}
            {!compactProgress &&
            kernelSelfManaged &&
            contextStatus &&
            typeof contextStatus.usageRatio === 'number' &&
            contextStatus.usageRatio >= 0.85 ? (
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
                    <div className="shell-slash-pop__section">Skill</div>
                    {slashSkillsLoading ? (
                      <div className="shell-mention-pop__empty">正在读取已启用 Skill…</div>
                    ) : filteredSlashSkills.length === 0 ? (
                      <div className="shell-mention-pop__empty">没有匹配的已启用 Skill</div>
                    ) : (
                      filteredSlashSkills.map((skill, skillIndex) => {
                        const index = slashCommands.length + skillIndex;
                        return (
                          <button
                            key={skill.skillVersionId}
                            type="button"
                            role="option"
                            aria-selected={index === slashIndex}
                            className={`shell-mention-pop__item shell-slash-pop__item ${
                              index === slashIndex ? 'is-active' : ''
                            }`}
                            onMouseEnter={() => setSlashIndex(index)}
                            onMouseDown={(event) => {
                              event.preventDefault();
                              selectSlashSkill(skill);
                            }}
                          >
                            <span className="shell-slash-pop__cmd">/{skill.name}</span>
                            <span className="shell-slash-pop__meta">
                              <span className="shell-slash-pop__label">{skill.name}</span>
                              <span className="shell-slash-pop__desc">
                                {skill.description || `v${skill.version}`}
                              </span>
                            </span>
                            <span className="shell-slash-pop__badge">Skill</span>
                          </button>
                        );
                      })
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
                    className="shell-mention-pop shell-mention-pop--context shell-mention-pop--portal"
                    style={mentionPopStyle}
                    data-testid="compose-mention-pop"
                    role="dialog"
                    aria-label="添加上下文和设置"
                  >
                    <div className="shell-mention-pop__section-label">设置</div>
                    <div className="shell-mention-pop__settings">
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
                    </div>
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

              {/* 问询卡片（ask_user_question 接管 composer；方案卡已移至消息流 §方案卡） */}
              {pendingAsk ? (
                <AskQuestionCard ask={pendingAsk} onSettled={() => setPendingAsk(undefined)} />
              ) : (
                <>
                  {/* The textarea stays editable while streaming. Send queues a draft;
                      only the queued item's explicit 插话 action supersedes the Run. */}
                  <textarea
                    ref={inputRef}
                    className="shell-compose__input"
                    data-testid="compose-input"
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
                    disabled={compactProgress?.status === 'running'}
                  />
                </>
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

              {/* Interaction work mode strip (规划/执行) */}
              {interactionMode === 'plan' && (
                <div className="shell-compose__mode-strip" data-mode="plan">
                  <span className="shell-compose__mode-label">🧭 规划模式</span>
                  <span className="shell-compose__mode-hint">
                    只读分析，提交方案等待审批
                  </span>
                  <button
                    type="button"
                    className="shell-compose__mode-switch"
                    onClick={() => {
                      const api = bridge();
                      void api?.setConversationInteractionMode?.({
                        conversationId: conversation.id,
                        interactionMode: 'execute',
                      });
                      setInteractionMode('execute');
                    }}
                  >
                    切到执行模式
                  </button>
                </div>
              )}

              {/* plan-act 生效模型提示（规划模式路由） */}
              {planActHint && (
                <div
                  className="shell-compose__mode-strip"
                  data-mode={planActHint.role}
                  data-testid="plan-act-hint"
                >
                  <span className="shell-compose__mode-label">
                    🧭 本轮由规划模型驱动
                  </span>
                  <span className="shell-compose__mode-hint">
                    {planActHint.label}
                    {planActHint.ignoredLabel
                      ? `（已忽略所选 ${planActHint.ignoredLabel}）`
                      : ''}
                  </span>
                </div>
              )}

              {/* Bottom toolbar */}
              <div className="shell-compose__bar">
                <div className="shell-compose__bar-left">
                  {/* Permission menu */}
                  <div className="shell-compose__tool-wrap">
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

                  <TurnSkillControl
                    owner={skillOwner}
                    workspaceId={conversation.workspaceId}
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
                    contextWindowEstimated={contextStatus?.contextWindowEstimated}
                    contextWindowSource={contextWindowSource}
                    usageRatio={contextStatus?.usageRatio}
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
                    <ModelTrigger
                      label={activeModel}
                      reasoningLabel={REASONING_LABELS[reasoningEffort]}
                      open={menu === 'model'}
                      buttonRef={modelBtnRef}
                      onClick={() => setMenu((m) => (m === 'model' ? null : 'model'))}
                    />
                    {kernelOverride !== 'native'
                      ? (() => {
                          const chipLabel = activeKernel ? activeKernel.name : kernelOverride;
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
                              {chipLogo ? <BrandLogoMark logo={chipLogo} size={14} /> : chipLabel}
                            </span>
                          );
                        })()
                      : null}
                    <ModelPickerMenu
                      open={menu === 'model'}
                      models={models}
                      selectedModelId={activeModelId}
                      defaultLabel={activeModel}
                      reasoningEffort={reasoningEffort}
                      kernels={kernelRegistry ?? undefined}
                      selectedKernelId={kernelOverride}
                      kernelInstallStates={kernelInstallStates}
                      anchorEl={modelBtnRef.current}
                      onClose={() => setMenu(null)}
                      onInstallKernel={(kernelId) => void installKernel(kernelId)}
                      onPickKernel={(kernelId) => {
                        setKernelOverride(kernelId);
                        writeConversationKernelOverride(String(conversation.id), kernelId);
                        onConversationUpdated?.();
                      }}
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
                      onReasoningChange={(value) => {
                        setReasoningEffort(value);
                        writeConversationReasoningEffort(String(conversation.id), value);
                      }}
                    />
                  </div>

                  {/* Dynamic single button: while a run is active with an empty
                      composer it becomes 暂停 (stop the current task); typing a
                      new message flips it back to 发送 (send = interject), and
                      after the message is dispatched with the input cleared it
                      flips back to 暂停 while the task is still running. */}
                  {canStop && !input.trim() && attachments.length === 0 ? (
                    <button
                      type="button"
                      className="shell-compose__send is-stop"
                      onClick={() => void handleStop()}
                      disabled={stopping}
                      title={stopTitle}
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

const CollapsibleUserText = memo(function CollapsibleUserText({ text }: { text: string }) {
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
        {text}
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

const MessageBubble = memo(function MessageBubble({
  message,
  processView,
  models,
  agents,
  runAgentIdentity,
  fallbackAgent,
  regenerating,
  onRegenerate,
  onOpenChange,
  onOpenReview,
  projectFolder,
  onOpenImage,
  kernelId,
}: {
  message: ChatMessage;
  processView?: RunProcessView;
  models?: readonly ModelOption[];
  agents?: readonly GlobalAgent[];
  runAgentIdentity?: RunAgentIdentity;
  fallbackAgent?: GlobalAgent;
  regenerating?: boolean;
  onRegenerate?: (messageId: string) => void;
  onOpenChange?: (path: string) => void;
  onOpenReview?: (view: RunProcessView) => void;
  projectFolder?: string;
  onOpenImage?: (image: MessageImage) => void;
  /** Kernel that produced this turn (native/empty → no badge). */
  kernelId?: string;
}) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const systemTone: SystemMessageTone = resolveSystemMessageTone(message.tone, message.text);
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);

  const metricsLabel = useMemo(() => {
    if (!processView) return undefined;
    // 主标签显示「上下文占用」（最后一次请求的真实大小），而不是工具循环的
    // 累计求和——后者（tokensIn+tokensOut 累加）会让人误以为上下文占用了那么大。
    const watermark = processView.contextWatermarkTokens;
    if (typeof watermark === 'number') {
      return formatCompactRunMetrics({
        durationMs: processView.durationMs,
        tokensIn: watermark,
        tokensOut: 0,
      });
    }
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
  // Kernel badge for this turn: show the brand logo next to the model label so
  // it is obvious which kernel produced each reply (native/unknown → none).
  const kernelLogo = useMemo(() => {
    if (!kernelId || kernelId === 'native') return undefined;
    return resolveKernelBrandLogo(kernelId);
  }, [kernelId]);

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
    // 单次请求口径（最后一次请求）：普通输入/缓存读取/输出 用这个值，避免
    // 工具循环重发导致的累计虚高。
    const last = processView.lastRequestUsage;
    const lastTokens =
      last && (last.tokensIn !== undefined || last.tokensOut !== undefined)
        ? splitProviderUsageTokens({
            tokensIn: last.tokensIn ?? 0,
            tokensOut: last.tokensOut ?? 0,
            cachedTokensHit: last.cachedTokensHit,
            cachedTokensCreated: last.cachedTokensCreated,
          })
        : undefined;
    return {
      duration,
      durationExact,
      tokens,
      lastTokens,
      lastCacheReadReported: typeof processView.lastRequestUsage?.cachedTokensHit === 'number',
      contextWatermarkTokens: processView.contextWatermarkTokens,
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
            {message.text ? <CollapsibleUserText text={message.text} /> : null}
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
          turnPlan={processView?.taskPlan}
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
                  <div
                    className="mt-2 flex items-start gap-1.5 text-[11.5px] text-text-faint"
                    data-testid={`assistant-terminal-${message.terminalState}`}
                  >
                    {message.terminalState === 'failed' ? (
                      <AlertCircle
                        size={12}
                        className="mt-0.5 shrink-0 text-[var(--color-error)]"
                      />
                    ) : (
                      <Square size={11} className="mt-0.5 shrink-0" />
                    )}
                    <span className="min-w-0">
                      <span>
                        {message.terminalState === 'failed'
                          ? '回复失败，已保留中断前内容'
                          : '已停止生成，以上内容已保留'}
                      </span>
                      {message.terminalState === 'failed' && message.terminalError ? (
                        <span
                          className="shell-terminal-error"
                          data-testid="assistant-terminal-error"
                          title={message.terminalError}
                        >
                          {message.terminalError}
                        </span>
                      ) : null}
                    </span>
                  </div>
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
          />
        ) : message.streaming &&
          !message.commentaryText?.trim() &&
          !message.commentarySegments?.some((segment) => segment.text.trim()) &&
          !message.processStatus &&
          !message.processItems?.length ? (
          <TypingDots inline />
        ) : null}
        {showFooter ? (
          <div className="shell-msg-footer">
            {hasAnswerText ? (
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
            ) : null}
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
                          <span>计费累计</span>
                          <strong>{formatCompactCount(metricsDetail.tokens.totalTokens)}</strong>
                        </div>
                      ) : null}
                      {typeof metricsDetail.contextWatermarkTokens === 'number' ? (
                        <div className="shell-meta-tip__row">
                          <span>上下文占用</span>
                          <strong>
                            {formatCompactCount(metricsDetail.contextWatermarkTokens)}
                          </strong>
                        </div>
                      ) : null}
                      {metricsDetail.lastTokens ? (
                        <div className="shell-meta-tip__row">
                          <span>普通输入</span>
                          <strong>
                            {formatCompactCount(metricsDetail.lastTokens.inputTokens)}
                          </strong>
                        </div>
                      ) : null}
                      {metricsDetail.lastTokens ? (
                        <div className="shell-meta-tip__row">
                          <span>缓存读取</span>
                          <strong>
                            {metricsDetail.lastCacheReadReported
                              ? formatCompactCount(metricsDetail.lastTokens.cacheReadTokens)
                              : '未上报'}
                          </strong>
                        </div>
                      ) : null}
                      {metricsDetail.lastTokens ? (
                        <div className="shell-meta-tip__row">
                          <span>输出</span>
                          <strong>
                            {formatCompactCount(metricsDetail.lastTokens.outputTokens)}
                          </strong>
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
              {kernelLogo ? (
                <span
                  className="shell-msg-meta__kernel"
                  data-testid={`msg-kernel-${kernelId}`}
                  title={`内核：${kernelId}`}
                  aria-label={`内核：${kernelId}`}
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
// NewMax 语义：只展示模型维护的「任务清单」（真正的待办），工具调用
// 流水由执行过程区域单独展示，不混入任务清单。

export function RunTaskCapsule({ view }: { view: RunProcessView }) {
  const [hovered, setHovered] = useState(false);
  const plan = view.taskPlan;

  if (!plan || plan.items.length === 0) return null;

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

// ─── Goal capsule（NewMax /goal：目标模式进行中/已达成状态展示） ────────────────

function GoalCapsule({
  goal,
  evaluatorConfigured,
  onPause,
  onResume,
  onEdit,
  onClear,
}: {
  goal: import('@sync-think/protocol').GoalStatus;
  evaluatorConfigured: boolean;
  onPause: () => void;
  onResume: () => void;
  onEdit: () => void;
  onClear: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  if (goal.status !== 'active' && goal.status !== 'paused' && goal.status !== 'blocked' && goal.status !== 'achieved') {
    return null;
  }
  const elapsedMinutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(goal.startedAt)) / 60_000),
  );
  const roundsStarted = goal.roundsStarted ?? 0;
  const maxRounds = goal.maxGoalRounds ?? 5;
  const stateLabel =
    goal.status === 'achieved'
      ? '目标已达成'
      : goal.status === 'paused'
        ? '目标已暂停'
        : goal.status === 'blocked'
          ? '目标受阻'
          : '目标进行中';
  return (
    <div
      className="shell-goal-capsule-wrap"
      data-status={goal.status}
      data-testid="goal-capsule"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hovered ? (
        <div className="shell-task-capsule__pop shell-goal-capsule__pop">
          <div className="shell-task-capsule__pop-title">{stateLabel}</div>
          <div className="shell-goal-capsule__condition" title={goal.condition}>
            {goal.condition}
          </div>
          <div className="shell-goal-capsule__meta">
            已运行 {elapsedMinutes} 分钟 · 第 {roundsStarted}/{maxRounds} 轮
            {!evaluatorConfigured ? ' · 评估模型未配置' : ''}
          </div>
          {goal.lastReason ? (
            <div className="shell-goal-capsule__reason">
              {goal.status === 'blocked' ? `受阻原因：${goal.blockedReason ?? goal.lastReason}` : `最近评估：${goal.lastReason}`}
            </div>
          ) : null}
          <div className="shell-goal-capsule__actions">
            {goal.status === 'active' ? (
              <button type="button" className="shell-goal-capsule__clear" onClick={onPause} title="暂停目标">
                ⏸ 暂停
              </button>
            ) : goal.status === 'paused' || goal.status === 'blocked' ? (
              <button type="button" className="shell-goal-capsule__clear" onClick={onResume} title="恢复目标">
                ▶ 恢复
              </button>
            ) : null}
            <button type="button" className="shell-goal-capsule__clear" onClick={onEdit} title="编辑目标">
              ✎ 编辑
            </button>
            <button type="button" className="shell-goal-capsule__clear" onClick={onClear} title="清除目标">
              <X size={12} />
              清除目标
            </button>
          </div>
        </div>
      ) : null}
      <div className="shell-task-capsule shell-goal-capsule">
        {goal.status === 'active' ? (
          <LoaderCircle size={13} className="shell-process-spin" />
        ) : goal.status === 'paused' ? (
          <span className="shell-goal-capsule__paused-icon">⏸</span>
        ) : goal.status === 'blocked' ? (
          <AlertCircle size={13} className="text-[var(--color-warning)]" />
        ) : (
          <Check size={13} className="text-[var(--color-success)]" />
        )}
        <span className="shell-task-capsule__label">{stateLabel}</span>
        {goal.status === 'active' || goal.status === 'paused' || goal.status === 'blocked' ? (
          <span className="shell-task-capsule__count">
            {roundsStarted}/{maxRounds} 轮
          </span>
        ) : null}
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
