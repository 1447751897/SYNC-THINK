/**
 * Maps live conversation signals onto an avatar expression.
 *
 * Only signals that actually exist in this app are used — there is no agent-level
 * run state to read, so each expression is inferred from the conversation the
 * agent is currently in. That also defines where expressions can show up:
 * a face only animates while its conversation is open, because that is the only
 * place these signals exist. Library grids, the sidebar and task panels render
 * the same avatars with the default `idle` face.
 */
import type { AvatarState } from './avatar-gen.js';

export interface AvatarSignals {
  /** The agent (or team) is archived — reads as switched off. */
  archived?: boolean;
  /** The most recent turn in this conversation failed. */
  failed?: boolean;
  /** A tool approval is waiting on the human. */
  awaitingApproval?: boolean;
  /** A reasoning stream is in flight. */
  reasoning?: boolean;
  /** The turn is actively streaming output. */
  streaming?: boolean;
  /** A turn finished successfully within the recent-completion window. */
  justCompleted?: boolean;
  /** There are unread messages from this agent (no signal wired yet). */
  unread?: boolean;
  /** The conversation has been idle past a threshold (no signal wired yet). */
  idleLong?: boolean;
}

/**
 * Priority order, most specific first:
 *   archived → failed → awaiting approval → reasoning → streaming
 *           → just completed → unread → idle → sleeping
 *
 * `failed` outranks the active states so a crash is visible immediately rather
 * than being masked by a still-streaming turn, and `justCompleted` sits below
 * the active states so a new turn immediately overrides the celebration.
 */
export function avatarStateFrom(signals: AvatarSignals): AvatarState {
  if (signals.archived) return 'inactive';
  if (signals.failed) return 'error';
  if (signals.awaitingApproval) return 'waiting';
  if (signals.reasoning) return 'thinking';
  if (signals.streaming) return 'working';
  if (signals.justCompleted) return 'happy';
  if (signals.unread) return 'looking';
  if (signals.idleLong) return 'sleeping';
  return 'idle';
}
