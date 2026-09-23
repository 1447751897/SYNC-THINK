import type { MessageBlock } from './message.js';

/** Persistent collaboration identities are independent of model provider roles. */
export type CollaborationKind = 'model' | 'direct' | 'group';
export interface CollaborationMember {
  id: string;
  kind: 'user' | 'assistant' | 'agent';
  agentId?: string;
  name: string;
  avatar: string;
  role: string;
  active: boolean;
}
export interface CollaborationPolicy {
  allowPeerDirect: boolean;
  maxConcurrent: number;
  maxMessageHops: number;
  maxAutoMessages: number;
  taskTimeoutSeconds: number;
  statusTimeoutSeconds: number;
}
export const DEFAULT_COLLABORATION_CHAT_POLICY: CollaborationPolicy = {
  allowPeerDirect: false, maxConcurrent: 3, maxMessageHops: 6,
  maxAutoMessages: 12, taskTimeoutSeconds: 7200, statusTimeoutSeconds: 120,
};
export interface CollaborationConversation {
  id: string;
  workspaceId: string;
  kind: CollaborationKind;
  title: string;
  coordinatorMemberId: string;
  parentConversationId?: string;
  modelId?: string;
  policy: CollaborationPolicy;
  createdAt: string;
}
export interface CollaborationMessageContextRef {
  conversationId: string;
  messageId: string;
}
export interface CollaborationMessage {
  id: string;
  conversationId: string;
  senderMemberId: string;
  recipientMemberIds: string[];
  mentions: { memberId: string; label: string }[];
  kind: 'chat' | 'task_assignment' | 'task_result' | 'system';
  blocks: MessageBlock[];
  replyToMessageId?: string;
  contextRefs?: CollaborationMessageContextRef[];
  taskId?: string;
  attemptId?: string;
  expectsResponse: boolean;
  correlationId: string;
  causationId?: string;
  hopCount: number;
  sequence: number;
  createdAt: string;
}
export interface CollaborationDelivery {
  id: string;
  messageId: string;
  recipientMemberId: string;
  status: 'queued' | 'processing' | 'processed' | 'failed' | 'cancelled';
  attemptId?: string;
  error?: string;
}
export interface CollaborationResourceClaim { key: string; mode: 'read' | 'write' }
export interface CollaborationPlanRef {
  planId: string;
  revision: number;
  stepId?: string;
}
export type CollaborationAttemptStatus =
  | 'queued' | 'running' | 'waiting_input' | 'stopping'
  | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
export interface CollaborationError {
  code: string;
  category: 'execution' | 'permission' | 'timeout' | 'delivery' | 'recovery';
  message: string;
  retryable: boolean;
  traceId: string;
}
export interface CollaborationTask {
  id: string;
  rootTaskId: string;
  parentTaskId?: string;
  originMessageId: string;
  assigneeMemberId: string;
  title: string;
  instructions: string;
  expectedOutput: string;
  dependsOnTaskIds: string[];
  contextRefs: string[];
  planRef?: CollaborationPlanRef;
  resourceClaims: CollaborationResourceClaim[];
  returnTo: { conversationId: string; replyToMessageId: string };
  timeoutSeconds: number;
  currentAttemptId: string;
  kind: 'task' | 'reply' | 'summary';
  createdAt: string;
}
export interface CollaborationAttempt {
  id: string;
  taskId: string;
  number: number;
  status: CollaborationAttemptStatus;
  waitReason?: 'dependency' | 'dependency_failed' | 'resource_busy' | 'capacity' | 'member_removed' | 'loop_limit';
  runId?: string;
  threadId?: string;
  ownerId?: string;
  startedAt?: string;
  finishedAt?: string;
  heartbeatAt?: string;
  updatedAt: string;
  contextSequence: number;
  output: string;
  error?: CollaborationError;
  observation?: 'normal' | 'status_unconfirmed' | 'notification_delayed';
  resourceClaims: CollaborationResourceClaim[];
  tools: { id: string; name: string; arguments: string; status: 'running' | 'succeeded' | 'failed'; result?: string }[];
  checklist: { id: string; text: string; status: 'pending' | 'in_progress' | 'completed' }[];
  agentSnapshot?: Record<string, unknown>;
}
export interface CollaborationSnapshot {
  conversation: CollaborationConversation;
  members: CollaborationMember[];
  messages: CollaborationMessage[];
  deliveries: CollaborationDelivery[];
  tasks: CollaborationTask[];
  attempts: CollaborationAttempt[];
  revision: number;
  /** Durable request receipts and summary receipts prevent duplicate side effects. */
  receipts: Record<string, string>;
}
export interface CollaborationActivitySummary {
  conversationId: string;
  conversationTitle: string;
  taskId: string;
  taskTitle: string;
  assigneeName: string;
  status: CollaborationAttemptStatus;
  waitReason?: CollaborationAttempt['waitReason'];
  errorMessage?: string;
  updatedAt: string;
  planRef?: CollaborationPlanRef;
}
export interface CollaborationRepository {
  read(conversationId: string): CollaborationSnapshot | undefined;
  list(workspaceId?: string): CollaborationSnapshot[];
  save(snapshot: CollaborationSnapshot): void;
  transaction<T>(work: () => T): T;
}
export interface CollaborationTaskDraft {
  key?: string;
  assigneeMemberId: string;
  title: string;
  instructions: string;
  expectedOutput?: string;
  dependsOnTaskIds?: string[];
  contextRefs?: string[];
  planRef?: CollaborationPlanRef;
  resourceClaims?: CollaborationResourceClaim[];
  timeoutSeconds?: number;
}
export type CollaborationCommand =
  | { action: 'create'; clientRequestId: string; kind: CollaborationKind; title: string; workspaceId: string; agentIds: string[]; coordinatorAgentId?: string; modelId?: string; teamId?: string }
  | { action: 'get'; conversationId: string }
  | { action: 'list'; workspaceId?: string }
  | { action: 'activity'; workspaceId?: string }
  | { action: 'send'; conversationId: string; clientRequestId: string; text: string; recipientMemberIds?: string[]; replyToMessageId?: string; expectsResponse?: boolean }
  | { action: 'dispatch'; conversationId: string; clientRequestId: string; tasks: CollaborationTaskDraft[]; originMessageId?: string; parentTaskId?: string }
  | { action: 'cancel'; conversationId: string; taskId: string; includeChildren?: boolean }
  | { action: 'retry'; conversationId: string; taskId: string; clientRequestId: string }
  | { action: 'retry-message'; conversationId: string; messageId: string; clientRequestId: string }
  | { action: 'policy'; conversationId: string; policy: Partial<CollaborationPolicy> }
  | { action: 'members'; conversationId: string; addAgentIds?: string[]; removeMemberIds?: string[]; coordinatorMemberId?: string; roles?: Record<string, string> }
  | { action: 'direct'; conversationId: string; clientRequestId: string; memberIds: string[] };
export interface CollaborationResponse {
  snapshot?: CollaborationSnapshot;
  conversations?: CollaborationConversation[];
  activities?: CollaborationActivitySummary[];
}
