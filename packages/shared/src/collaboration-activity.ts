import type { CollaborationAttempt, CollaborationTask, TaskRoom } from './types/collaboration-chat.js';

const ACTIVE = new Set<CollaborationAttempt['status']>(['queued', 'running', 'waiting_input', 'stopping']);
const BLOCKED_QUEUE = new Set<NonNullable<CollaborationAttempt['waitReason']>>([
  'dependency', 'dependency_failed', 'member_removed', 'loop_limit', 'room_paused',
]);

/** Display activity only; durable queued work remains available for review/resume. */
export function isCollaborationTaskBusy(
  task: CollaborationTask,
  attempt: CollaborationAttempt | undefined,
  room?: TaskRoom,
): boolean {
  if (!attempt || attempt.id !== task.currentAttemptId || attempt.taskId !== task.id ||
    task.pendingAssignment || !ACTIVE.has(attempt.status)) return false;
  // A live/stopping execution still counts until the host settles it, even while pausing.
  if (attempt.status !== 'queued') return true;
  if (attempt.waitReason && BLOCKED_QUEUE.has(attempt.waitReason)) return false;
  const roomWork = Boolean(task.consultation?.workScoped) || task.purpose !== 'discussion' && task.kind !== 'reply';
  if (room && roomWork && (['paused', 'pausing', 'completed'].includes(room.state) ||
    task.goalRevision !== undefined && task.goalRevision !== room.goalRevision)) return false;
  return true;
}
