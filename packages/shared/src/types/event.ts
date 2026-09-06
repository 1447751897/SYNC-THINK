import type { DeferredContent } from '../deferred-content.js';
import type { EventId, RunId, StepId, TaskId, MessageId, WorkspaceId, AgentVersionId, ModelId, CredentialRefId, ArtifactVersionId } from './ids.js';
import type { EventCategory, RunState, FailureClass } from './enums.js';

// Append-only execution fact and audit record (§ data model). Reconstructs
// Run state on restart when combined with checkpoints (§20 rules 1-7).
export interface Event {
  id: EventId;
  workspaceId: WorkspaceId;
  taskId?: TaskId;
  runId?: RunId;
  stepId?: StepId;
  messageId?: MessageId;
  category: EventCategory;
  /** Stable type code within a category, e.g. 'run.started', 'tool.requested'. */
  type: string;
  /** Monotonic sequence per workspace (cursor for backpressure-aware subscriptions). */
  sequence: number;
  /** ISO 8601 timestamp of occurrence. */
  occurredAt: string;
  /** Structured payload by event type; opaque here. */
  payload: Record<string, unknown>;
  displayPayloadRef?: DeferredContent;
}

export interface Checkpoint {
  id: string;
  runId: RunId;
  /** Most recently applied event sequence at checkpoint time. */
  lastEventSequence: number;
  /** Serialized state snapshot (XState snapshot or domain projection). */
  state: Record<string, unknown>;
  /** ISO 8601. */
  createdAt: string;
}

// Common event payload shapes consumed by Runtime & UI.
export interface RunStateChangedPayload {
  from: RunState;
  to: RunState;
  reason?: 'plan-approved' | 'paused-by-user' | 'cancelled' | 'step-completed' | 'tool-approved' | 'tool-denied' | 'gateway-error' | 'acceptance-passed' | 'acceptance-failed';
}

export interface ToolApprovalPayload {
  toolName: string;
  summary: string;
  /** Permissions requested / required. */
  permissions: string[];
  stepId?: StepId;
}

export interface ModelCallRecordPayload {
  agentVersionId: AgentVersionId;
  modelId: ModelId;
  credentialRefId: CredentialRefId;
  /** Inbound model error class (only transient/timeout/rate-limit retry). */
  failureClass?: FailureClass;
  /** Secret-scrubbed diagnostic reference id (logs never carry plaintext). */
  diagnosticRefId?: string;
  tokensIn?: number;
  tokensOut?: number;
}

export interface ArtifactCreatedPayload {
  artifactVersionId: ArtifactVersionId;
  artifactId: string;
  sourceStepId: StepId;
  status: 'candidate' | 'selected' | 'rejected' | 'incomplete';
}
