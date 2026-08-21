import type { ScheduledTaskTarget } from './scheduled-task.js';

export type ExternalEventSourceKind = 'webhook' | 'file' | 'git' | 'bot' | 'async';

export interface ExternalEventSource {
  kind: ExternalEventSourceKind;
  /** Adapter or integration name, for example `github` or `feishu`. */
  name?: string;
}

export interface ExternalEventEnvelope {
  id: string;
  /** Stable producer identity used to collapse retries into one event. */
  dedupeKey: string;
  source: ExternalEventSource;
  instruction: string;
  target: ScheduledTaskTarget;
  workspaceId?: string;
  skillVersionIds: string[];
  /** Stable key for appending related events to the same durable conversation. */
  conversationKey?: string;
  /** Optional title used when that conversation is first created. */
  title?: string;
  /** Sanitized, bounded event context. Credentials never belong here. */
  metadata?: Record<string, unknown>;
}

export type ExternalEventState =
  | 'pending'
  | 'leased'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ExternalEventTerminalStatus = 'success' | 'failed' | 'cancelled';

export interface ExternalEventRecord extends ExternalEventEnvelope {
  state: ExternalEventState;
  attemptCount: number;
  leaseOwner?: string;
  leaseToken?: string;
  leaseExpiresAt?: string;
  runId?: string;
  resultStatus?: ExternalEventTerminalStatus;
  resultReason?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}
