import type { CollaborationKind } from './conversation-kind.js';
import type { Team } from './team-definition.js';
import type { MessageBlock } from './message.js';

/** Host capability gate: delivery-gated dispatch and description-guided @work handoffs. */
export const COLLABORATION_EXECUTION_VERSION = 15;

/** Persistent collaboration identities are independent of model provider roles. */
export type { CollaborationKind } from './conversation-kind.js';
export interface CollaborationMember {
  id: string;
  kind: 'user' | 'assistant' | 'agent' | 'team';
  /** Internal actors are scoped to one team participant, not independent group members. */
  teamParticipantId?: string;
  teamSnapshot?: Team;
  agentId?: string;
  name: string;
  avatar: string;
  role: string;
  active: boolean;
}
export interface CollaborationPolicy {
  /** Opt-in for legacy groups; newly created groups enable model-driven conversation routing. */
  coordinateDiscussion?: boolean;
  /** Missing on legacy records: inherit the old peer policy without expanding access. */
  allowGroupMessages?: boolean;
  /** Explicit human room setting, frozen when each execution is admitted. Legacy rooms are offline. */
  networkEnabled?: boolean;
  /** Human-selected persistent browser identity, frozen per attempt. */
  browserProfileId?: string;
  browserWorkflowTaskId?: string;
  browserWorkflowVariables?: Record<string, string>;
  allowPeerDirect: boolean;
  maxConcurrent: number;
  maxMessageHops: number;
  maxAutoMessages: number;
  taskTimeoutSeconds: number;
  statusTimeoutSeconds: number;
}
export const DEFAULT_COLLABORATION_CHAT_POLICY: CollaborationPolicy = {
  allowGroupMessages: true, allowPeerDirect: false, maxConcurrent: 3, maxMessageHops: 6,
  maxAutoMessages: 12, taskTimeoutSeconds: 7200, statusTimeoutSeconds: 120,
};
export type TaskRoomState = 'discussion' | 'blocked' | 'running' | 'pausing' | 'paused' | 'review' | 'completed';
export interface TaskRoomCheckpoint {
  version: number;
  savedAt: string;
  pendingTaskIds: string[];
  completedTaskIds: string[];
  artifactIds: string[];
  note: string;
}
/** Durable work scope; never a provider session or a global team memory. */
export interface TaskRoom {
  version: 1;
  state: TaskRoomState;
  goal: string;
  goalRevision: number;
  /** Agent-generated summaries are not new human-authored acceptance requirements. */
  goalOrigin?: 'user' | 'assistant';
  sourceSequence: number;
  /** Explicit human continuation replenishes only this room’s automatic-message allowance. */
  autoContinueAfterSequence?: number;
  checkpoint: TaskRoomCheckpoint;
}
export interface CollaborationConversation {
  groupDescription?: string;
  groupConfigurationRevision?: number;
  room?: TaskRoom;
  id: string;
  workspaceId: string;
  kind: CollaborationKind;
  title: string;
  coordinatorMemberId: string;
  topologyRevision?: number;
  parentConversationId?: string;
  modelId?: string;
  policy: CollaborationPolicy;
  createdAt: string;
}
export interface CollaborationMessageContextRef {
  conversationId: string;
  messageId: string;
}
/** Notification does not wake peers; handoff wakes only the recipient; consult also resumes the requester. */
export type CollaborationMessageDeliveryMode = 'notify' | 'handoff' | 'consult';
export interface CollaborationImageAttachment {
  id?: string;
  name: string;
  mimeType: string;
  dataUrl?: string;
  stagingPath?: string;
}
export interface CollaborationFileAttachment {
  /** Host-owned original selection, retained for idempotent transport retries. */
  sourcePath?: string;
  path: string;
  name: string;
  kind?: 'file' | 'dir';
  mimeType?: string;
  sizeBytes?: number;
}
export interface CollaborationMessage {
  /** Recipients route actions; only this explicit flag restricts visibility. Legacy messages are public. */
  visibility?: 'public' | 'private';
  id: string;
  conversationId: string;
  senderMemberId: string;
  recipientMemberIds: string[];
  mentions: { memberId: string; label: string; start?: number; end?: number }[];
  kind: 'chat' | 'task_assignment' | 'task_result' | 'system';
  blocks: MessageBlock[];
  replyToMessageId?: string;
  contextRefs?: CollaborationMessageContextRef[];
  taskId?: string;
  attemptId?: string;
  expectsResponse: boolean;
  deliveryMode?: CollaborationMessageDeliveryMode;
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
  nextStep?: string;
  traceId: string;
}
export interface CollaborationDeliverable {
  kind: 'document' | 'file';
  title: string;
  /** Workspace-relative path; required for file deliveries. */
  path?: string;
}
export interface CollaborationArtifact {
  id: string;
  taskId: string;
  attemptId: string;
  title: string;
  kind: 'document' | 'file';
  content?: string;
  path?: string;
  /** Absolute local path of the host-saved immutable version (document or file); path remains the logical contract path. */
  storedPath?: string;
  textMetrics?: { characters: number; charactersWithoutWhitespace: number; scope: 'entire_text'; punctuationIncluded: true };
  sha256: string;
  bytes: number;
  createdAt: string;
}
/** A host-bound production @handoff, committed only after its source succeeds. */
export interface CollaborationWorkHandoff {
  kind: 'work' | 'review' | 'report';
  recipientMemberId: string;
  text: string;
  artifactIds?: string[];
  title?: string;
  deliverable?: CollaborationDeliverable;
}
export interface CollaborationTask {
  /** Host-created, tool-free routing step. Never a production dispatch or a private inbox reader. */
  conversationPlanning?: boolean;
  /** Human provenance carried by the internal plan; does not grant the controller tools. */
  conversationPlanningIntent?: 'chat' | 'discussion';
  conversationPlanTaskId?: string;
  conversationRecovery?: boolean;
  /** Incoming production decision/assignment, not an ordinary chat consultation. */
  handoff?: { kind: CollaborationWorkHandoff['kind']; sourceTaskId: string; sourceAttemptId: string; artifactIds: string[] };
  /** Host-owned staged handoff; no assignment message/delivery exists until dependencies succeed. */
  pendingAssignment?: {
    senderMemberId: string;
    correlationId: string;
    causationMessageId?: string;
    hopCount: number;
  };
  /** Host-owned goal generation. Old work stays in history after a human replan. */
  goalRevision?: number;
  /** Explicit replacement links; the failed attempt remains immutable history. */
  replacesTaskId?: string;
  replacedByTaskId?: string;
  /** Host-issued only for a human chat turn addressed to this group’s coordinator. */
  workflowStartAllowed?: boolean;
  /** Host-bound consultation; no new work authority is granted to the recipient. */
  consultation?: { requesterTaskId: string; requesterAttemptId: string; workScoped: boolean };
  purpose?: 'discussion' | 'work' | 'coordination';
  workStatus?: 'open' | 'in_progress' | 'waiting' | 'in_review' | 'done';
  id: string;
  coordinatorMemberId?: string;
  topologyRevision?: number;
  teamParticipantId?: string;
  rootTaskId: string;
  parentTaskId?: string;
  originMessageId: string;
  assigneeMemberId: string;
  title: string;
  instructions: string;
  expectedOutput: string;
  deliverable?: CollaborationDeliverable;
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
  /** Durable intent; no recipient is awakened until this attempt succeeds. */
  workHandoff?: CollaborationWorkHandoff;
  id: string;
  taskId: string;
  number: number;
  status: CollaborationAttemptStatus;
  waitReason?: 'dependency' | 'dependency_failed' | 'resource_busy' | 'capacity' | 'member_removed' | 'loop_limit' | 'room_paused' | 'peer_reply';
  runId?: string;
  threadId?: string;
  ownerId?: string;
  startedAt?: string;
  finishedAt?: string;
  heartbeatAt?: string;
  updatedAt: string;
  contextSequence: number;
  /** Only classified final-answer text belongs in the chat bubble. */
  output: string;
  /** Live execution state; reasoning content is deliberately not copied here. */
  phase?: 'thinking' | 'working' | 'answering';
  /** User-facing progress commentary, shown inside collapsed execution details. */
  commentary?: string;
  error?: CollaborationError;
  observation?: 'normal' | 'status_unconfirmed' | 'notification_delayed';
  resourceClaims: CollaborationResourceClaim[];
  tools: { id: string; name: string; arguments: string; status: 'running' | 'succeeded' | 'failed'; result?: string }[];
  checklist: { id: string; text: string; status: 'pending' | 'in_progress' | 'completed' }[];
  /** Durable join: continue this work item after all requested consultations settle. */
  awaitingPeerTaskIds?: string[];
  /** Successful discussion already published a reply or handed it onward; keep final model prose in the trace. */
  chatDeliveryMessageId?: string;
  resumeFromAttemptId?: string;
  pauseRequested?: boolean;
  contextManifest?: {
    roomId: string; purpose: string; sourceSequence: number;
    messageIds: string[]; artifactIds: string[]; historyOmitted: number;
    continuation: 'fresh' | 'resume_candidate';
  };
  agentSnapshot?: Record<string, unknown>;
  artifacts?: CollaborationArtifact[];
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
  /** Replan failed current-goal work, preserving its history. */
  replacesTaskId?: string;
  key?: string;
  purpose?: 'discussion' | 'work' | 'coordination';
  teamParticipantId?: string;
  assigneeMemberId: string;
  title: string;
  instructions: string;
  expectedOutput?: string;
  deliverable?: CollaborationDeliverable;
  dependsOnTaskIds?: string[];
  contextRefs?: string[];
  planRef?: CollaborationPlanRef;
  resourceClaims?: CollaborationResourceClaim[];
  timeoutSeconds?: number;
}
export type CollaborationCommand =
  | { action: 'create'; clientRequestId: string; kind: CollaborationKind; title: string; workspaceId?: string; agentIds: string[]; coordinatorAgentId?: string; modelId?: string; teamId?: string; teamIds?: string[] }
  | { action: 'room-pause' | 'room-resume' | 'room-complete'; conversationId: string; clientRequestId: string }
  | { action: 'room-brief'; conversationId: string; clientRequestId: string; goal: string; expectedGoalRevision: number }
  | { action: 'group-config'; conversationId: string; clientRequestId: string; description: string; expectedRevision: number }
  | { action: 'get'; conversationId: string }
  | { action: 'promote-direct'; conversationId: string }
  | { action: 'promote-team'; conversationId: string }
  | { action: 'list'; workspaceId?: string }
  | { action: 'activity'; workspaceId?: string }
  | { action: 'send'; conversationId: string; clientRequestId: string; text: string; images?: CollaborationImageAttachment[]; files?: CollaborationFileAttachment[]; attachmentContext?: { conversationId: string; workspacePath?: string }; intent?: 'chat' | 'discussion' | 'work'; visibility?: 'public' | 'private'; mentions?: { memberId: string; label: string; start: number; end: number }[]; recipientMemberIds?: string[]; replyToMessageId?: string; expectsResponse?: boolean; deliveryMode?: CollaborationMessageDeliveryMode }
  | { action: 'start-workflow'; conversationId: string; clientRequestId: string; goal: string; originMessageId?: string; parentTaskId?: string }
  | { action: 'handoff'; conversationId: string; clientRequestId: string; handoff: CollaborationWorkHandoff }
  | { action: 'dispatch'; conversationId: string; clientRequestId: string; tasks: CollaborationTaskDraft[]; originMessageId?: string; parentTaskId?: string }
  | { action: 'cancel'; conversationId: string; taskId: string; includeChildren?: boolean }
  | { action: 'replace-task'; conversationId: string; taskId: string; replacementTaskId: string; clientRequestId: string }
  | { action: 'retry'; conversationId: string; taskId: string; clientRequestId: string }
  | { action: 'retry-message'; conversationId: string; messageId: string; clientRequestId: string }
  | { action: 'policy'; conversationId: string; policy: Partial<CollaborationPolicy> }
  | { action: 'members'; conversationId: string; addAgentIds?: string[]; addTeamIds?: string[]; expectedTopologyRevision?: number; removeMemberIds?: string[]; coordinatorMemberId?: string; roles?: Record<string, string> }
  | { action: 'direct'; conversationId: string; clientRequestId: string; memberIds: string[] };
/** Sidebar-sized view of a collaboration conversation; returned by `list`. */
export interface CollaborationRosterSummary {
  conversationId: string;
  kind: CollaborationKind;
  members: Pick<CollaborationMember, 'id' | 'name' | 'avatar'>[];
  /** True while any member is queued or running on this conversation. */
  busy: boolean;
  roomState?: TaskRoomState;
  /** Bounded text of the latest chat message, if any. */
  preview?: string;
  previewSender?: string;
}
export interface CollaborationResponse {
  /** Host capability handshake; absent identifies an older running daemon. */
  executionVersion?: number;
  /** Same conversation and thread, with legacy single-agent messages preserved. */
  promotedConversation?: import('./team.js').Conversation;
  snapshot?: CollaborationSnapshot;
  conversations?: CollaborationConversation[];
  rosters?: CollaborationRosterSummary[];
  activities?: CollaborationActivitySummary[];
}

/** Host-owned provenance for new goals; ordered durable brief receipts identify legacy revisions. */
export function taskRoomGoalOrigin(snapshot: CollaborationSnapshot): 'user' | 'assistant' {
  const room = snapshot.conversation.room;
  if (room?.goalOrigin) return room.goalOrigin;
  const briefs = Object.keys(snapshot.receipts).filter(key => key.startsWith('room-brief:'));
  // Receipts are append-only, persisted in insertion order. A count mismatch is ambiguous.
  return briefs.length === room?.goalRevision && briefs.at(-1)?.startsWith('room-brief:start-brief:chat:') ? 'assistant' : 'user';
}
