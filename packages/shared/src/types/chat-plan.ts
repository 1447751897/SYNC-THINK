import type { ConversationId } from './ids.js';

/**
 * Conversation-level plan submitted by a model during「规划模式」.
 *
 * This is distinct from the multi-agent orchestration plan (`plan.draft` /
 * `plan.approve`, which builds a step graph over agent versions). A chat plan
 * is a lightweight, human-reviewable execution outline produced by the same
 * conversation kernel (Claude Code today). The user approves one revision and
 * the host starts a fresh execution run bound to that exact revision.
 */

export type InteractionMode = 'plan' | 'execute';

export interface ChatPlanStep {
  /** Stable logical id used to diff revisions. */
  id: string;
  title: string;
  description: string;
  /** Optional files expected to be touched by this step. */
  expectedFiles?: string[];
  /** Concrete checks that prove this step is done. */
  acceptanceChecks: string[];
}

export interface ChatPlanRisk {
  description: string;
  mitigation: string;
}

/** Model-submitted plan content (plan_submit tool). */
export interface ChatPlanSubmission {
  title: string;
  goal: string;
  scope: string[];
  assumptions: string[];
  decisions: string[];
  steps: ChatPlanStep[];
  risks: ChatPlanRisk[];
  finalAcceptanceChecks: string[];
}

export type ChatPlanState = 'draft' | 'approved' | 'cancelled';

/** One immutable revision of a conversation plan. */
export interface ChatPlanRevision {
  id: string;
  conversationId: ConversationId;
  revision: number;
  plan: ChatPlanSubmission;
  state: ChatPlanState;
  createdAt: string;
  approvedAt?: string;
}

/** Conversation-scoped plan aggregate (draft + revision history). */
export interface ConversationPlanSummary {
  /** Stable plan id (conversation-bound). */
  planId: string;
  conversationId: ConversationId;
  currentRevision: number;
  state: ChatPlanState;
  latest: ChatPlanRevision;
  revisions: ChatPlanRevision[];
}
