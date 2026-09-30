import type { CollaborationSnapshot, CollaborationTaskDraft } from '@sync-think/shared';
import { compileCollaborationWorkflow } from './collaboration-workflow.js';

/** Lower each team to scoped internal nodes plus one leader-owned handoff node.
 * The handoff is queued after its children (never holds a slot/lock while waiting).
 */
export function expandTeamParticipants(
  snapshot: CollaborationSnapshot,
  tasks: CollaborationTaskDraft[],
): CollaborationTaskDraft[] {
  const expanded = tasks.flatMap((task, index) => {
    const participant = snapshot.members.find((member) => member.id === task.assigneeMemberId);
    if (!participant?.active || participant.kind !== 'team') return [task];
    const team = participant.teamSnapshot;
    if (!team) throw new Error('collaboration.team_snapshot_missing');
    const key = task.key ?? 'team-handoff-' + index;
    const members = snapshot.members.filter(
      (member) => member.teamParticipantId === participant.id,
    );
    const internal = compileCollaborationWorkflow(
      { ...snapshot, members },
      task.instructions,
      team,
    );
    const internalKeys = new Set(internal.flatMap((node) => (node.key ? [node.key] : [])));
    const outgoing = new Set(internal.flatMap((node) => node.dependsOnTaskIds ?? []));
    const prefixed = (id: string) => (internalKeys.has(id) ? key + ':' + id : id);
    const nodes = internal.map((node) => ({
      ...node,
      key: prefixed(node.key!),
      teamParticipantId: participant.id,
      planRef: task.planRef,
      contextRefs: [...new Set([...(task.contextRefs ?? []), ...(node.contextRefs ?? [])])],
      dependsOnTaskIds: node.dependsOnTaskIds?.length
        ? node.dependsOnTaskIds.map(prefixed)
        : [...(task.dependsOnTaskIds ?? [])],
    }));
    return [
      ...nodes,
      {
        ...task,
        key,
        teamParticipantId: participant.id,
        dependsOnTaskIds: internal
          .filter((node) => !outgoing.has(node.key!))
          .map((node) => prefixed(node.key!)),
        deliverable: task.deliverable ?? { kind: 'document' as const, title: team.name + '交付' },
        instructions:
          '你是小队内部负责人，只验收并整合本小队前置节点的实际交付，不重新派发。提交约定产物后向群协调员返回一次结果。\n' +
          task.instructions,
      },
    ];
  });
  if (expanded.length > 64) throw new Error('collaboration.workflow_too_large');
  return expanded;
}
