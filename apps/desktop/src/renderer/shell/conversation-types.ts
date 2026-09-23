import type {
  AssistantTurnSegment,
  CommentaryTimelineSegment,
  DelegatedAgentProjection,
} from '@sync-think/protocol';
import type { MessageImage } from './compose-mention.js';
import type { SystemMessageTone } from './compose-slash.js';
import type { MessageTextPart } from './message-text-types.js';

export type RuntimeConnectionNotice =
  { state: 'retrying'; text: string } | { state: 'failed'; text: string } | null;

export type InlineProcessItem =
  | {
      kind: 'reasoning';
      text: string;
      contentRef?: import('@sync-think/shared').DeferredContent;
      id?: string;
      sequence?: number;
      status?: 'streaming' | 'completed';
      /**
       * Clock of the originating timeline segment. The live panel merges Think
       * rows (from the assistant timeline) with tool rows (from the paged
       * process view); sharing `startedAt` is what lets the two be interleaved
       * instead of one whole stream being hoisted above the other.
       */
      startedAt?: string;
      completedAt?: string;
    }
  | {
      kind: 'text' | 'commentary';
      text: string;
      contentRef?: import('@sync-think/shared').DeferredContent;
      id?: string;
      sequence?: number;
      status?: 'streaming' | 'completed';
      startedAt?: string;
      completedAt?: string;
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
      argumentsRef?: import('@sync-think/shared').DeferredContent;
      resultRef?: import('@sync-think/shared').DeferredContent;
      detailsRef?: import('@sync-think/shared').DeferredContent;
      failed?: boolean;
      status?: 'running' | 'completed' | 'failed';
      /**
       * This row is the anchor of a delegated child Agent (`agent_delegate` /
       * `agent_run`). Its raw result is the delegation payload — an internal
       * envelope the reader cannot use — so the row points at the card below
       * instead of dumping it. `result` still carries the payload verbatim for
       * the card parser.
       */
      delegationAnchor?: boolean;
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
  textParts?: MessageTextPart[];
  answerParts?: MessageTextPart[];
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
  terminalState?: 'failed' | 'cancelled' | 'paused';
  terminalError?: string;
  /** Historical terminal event materialized after newer durable rows already existed. */
  legacyTerminalBackfill?: boolean;
  /** Bound global agent identity for this assistant turn. */
  globalAgentId?: string;
  globalAgentName?: string;
  /** Parent-scoped live child Agent cards. */
  delegatedAgents?: DelegatedAgentProjection[];
  /** Exact Skill versions selected for this user turn. */
  skillVersionIds?: string[];
  skills?: Array<{ skillVersionId: string; name: string }>;
}

export interface DelegatedAgentToolEventView {
  toolName: string;
  arguments?: string;
  status?: string;
  output?: string;
  startedAt?: string;
  completedAt?: string;
  /** `arguments`/`output` were clipped to keep the delegation payload bounded. */
  truncated?: boolean;
  argumentsTruncated?: boolean;
  argumentsCharacters?: number;
  outputTruncated?: boolean;
  /** Untrimmed output length, so the card can say how much was left out. */
  outputCharacters?: number;
}
