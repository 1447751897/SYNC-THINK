import type {
  MessageId,
  ThreadId,
  AgentVersionId,
  ModelId,
  CredentialRefId,
  RunId,
  StepId,
} from './ids.js';
import type { MessageRole } from './enums.js';
import type { DeferredContent } from '../deferred-content.js';

export interface MessageBlock {
  type:
    | 'text'
    | 'code'
    | 'image'
    | 'plan'
    | 'tool-call'
    | 'tool-result'
    | 'error'
    | 'commentary'
    | 'reasoning';
  text?: string;
  /** Provider reasoning summary for legacy/diagnostic 'reasoning' blocks. */
  reasoningText?: string;
  /** Structured payload per block type. Kept opaque here; refined in core. */
  payload?: unknown;
  contentRef?: DeferredContent;
}

export interface Message {
  id: MessageId;
  threadId: ThreadId;
  role: MessageRole;
  /** Agent that produced this message (assistant/tool/system). */
  agentVersionId?: AgentVersionId;
  /** Model used for this assistant message — contextual continuity evidence. */
  modelId?: ModelId;
  /** Credential reference actually used to call the provider. */
  credentialRefId?: CredentialRefId;
  /** Run/Step this message belongs to (empty for plain conversation). */
  runId?: RunId;
  stepId?: StepId;
  /** Kernel that produced this run (persisted so UI badges survive restarts). */
  kernelId?: string;
  blocks: MessageBlock[];
  createdAt: string;
  /** Logical ordering within thread (stable across retries & recovery). */
  sequence: number;
}

export interface MessageNavigationEntry {
  id: MessageId;
  sequence: number;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  runId?: RunId;
  terminalState?: 'failed' | 'cancelled';
  legacyTerminalBackfill?: boolean;
}
