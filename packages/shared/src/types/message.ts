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

export type MessageAttachmentKind = 'image' | 'file' | 'folder';

/**
 * Persisted attachment metadata. `managedRef` points to a local immutable snapshot for files;
 * folder references are explicitly read-only and are only authorized for the current turn.
 */
export interface MessageAttachment {
  id: string;
  kind: MessageAttachmentKind;
  name: string;
  mimeType: string;
  size: number;
  sha256?: string;
  managedRef: string;
  readOnly: true;
}

export interface MessageBlock {
  type: 'text' | 'code' | 'image' | 'plan' | 'tool-call' | 'tool-result' | 'error';
  text?: string;
  /** Structured payload per block type. Kept opaque here; refined in core. */
  payload?: unknown;
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
  blocks: MessageBlock[];
  createdAt: string;
  /** Logical ordering within thread (stable across retries & recovery). */
  sequence: number;
}
