import type { CollaborationMessage, CollaborationSnapshot } from './types/collaboration-chat.js';

export function collaborationMessageVisible(
  message: CollaborationMessage,
  memberId: string,
): boolean {
  return (
    message.visibility !== 'private' ||
    message.senderMemberId === memberId ||
    message.recipientMemberIds.includes(memberId)
  );
}

function hideConversationPlanning(snapshot: CollaborationSnapshot): void {
  for (const task of snapshot.tasks.filter((t) => t.conversationPlanning)) {
    task.instructions = '宿主正在决定本轮发言成员与执行顺序。';
    for (const attempt of snapshot.attempts.filter((a) => a.taskId === task.id)) {
      attempt.output = '';
      attempt.tools = [];
      attempt.checklist = [];
      delete attempt.commentary;
      delete attempt.agentSnapshot;
      delete attempt.runId;
      delete attempt.threadId;
    }
  }
}

/** One projection for model inputs, context tools, snapshots, sidebar/activity feeds and recovery.
 * Storage remains host-owned. This is application audience isolation, not an OS sandbox. */
export function collaborationSnapshotForMember(
  snapshot: CollaborationSnapshot,
  memberId: string,
  controller = false,
): CollaborationSnapshot {
  if (!snapshot.messages.some((m) => m.visibility === 'private')) {
    const result = structuredClone(snapshot);
    hideConversationPlanning(result);
    return result;
  }
  const visible = (m: CollaborationMessage) =>
    controller ? m.visibility !== 'private' : collaborationMessageVisible(m, memberId);
  const messages = snapshot.messages.filter(visible);
  const messageIds = new Set(messages.map((m) => m.id));
  const tasks = snapshot.tasks.filter((t) => messageIds.has(t.originMessageId));
  const taskIds = new Set(tasks.map((t) => t.id));
  const attempts = snapshot.attempts.filter((a) => taskIds.has(a.taskId));
  const attemptIds = new Set(attempts.map((a) => a.id));
  const result = structuredClone({
    ...snapshot,
    messages,
    tasks,
    attempts,
    deliveries: snapshot.deliveries.filter((d) => messageIds.has(d.messageId)),
  });
  for (const message of result.messages) {
    if (message.replyToMessageId && !messageIds.has(message.replyToMessageId))
      delete message.replyToMessageId;
    message.contextRefs = message.contextRefs?.filter(
      (ref) => ref.conversationId === snapshot.conversation.id && messageIds.has(ref.messageId),
    );
  }
  for (const task of result.tasks) {
    task.contextRefs = task.contextRefs.filter((id) => messageIds.has(id));
    task.dependsOnTaskIds = task.dependsOnTaskIds.filter((id) => taskIds.has(id));
    if (task.parentTaskId && !taskIds.has(task.parentTaskId)) delete task.parentTaskId;
  }
  hideConversationPlanning(result);
  for (const attempt of result.attempts) {
    const task = result.tasks.find((t) => t.id === attempt.taskId)!;
    const privateDelivery = snapshot.messages.find((m) => m.id === attempt.chatDeliveryMessageId);
    if (privateDelivery && !visible(privateDelivery)) {
      // A public-origin turn may have privately answered through a tool. Its
      // retained final prose is a trace, not a public participant contribution.
      attempt.output = '';
      delete attempt.chatDeliveryMessageId;
    }
    const hiddenInbox = snapshot.messages.some(
      (m) =>
        m.visibility === 'private' &&
        collaborationMessageVisible(m, task.assigneeMemberId) &&
        !visible(m),
    );
    if (hiddenInbox && task.assigneeMemberId !== memberId) {
      attempt.tools = [];
      attempt.checklist = [];
      delete attempt.commentary;
      delete attempt.agentSnapshot;
      delete attempt.runId;
      delete attempt.threadId;
    }
    if (attempt.contextManifest) {
      attempt.contextManifest.messageIds = attempt.contextManifest.messageIds.filter((id) =>
        messageIds.has(id),
      );
    }
  }
  if (result.conversation.room) {
    if (tasks.length !== snapshot.tasks.length)
      result.conversation.room.checkpoint.note =
        '检查点包含私人步骤；这里只展示本视角可见的工作记录。';
    result.conversation.room.checkpoint.pendingTaskIds =
      result.conversation.room.checkpoint.pendingTaskIds.filter((id) => taskIds.has(id));
    result.conversation.room.checkpoint.completedTaskIds =
      result.conversation.room.checkpoint.completedTaskIds.filter((id) => taskIds.has(id));
    const artifacts = new Set(attempts.flatMap((a) => a.artifacts?.map((x) => x.id) ?? []));
    result.conversation.room.checkpoint.artifactIds =
      result.conversation.room.checkpoint.artifactIds.filter((id) => artifacts.has(id));
  }
  // Host receipts are not authorization tokens. Only opaque references are exposed;
  // hide references to another audience's messages/tasks/attempts.
  result.receipts = Object.fromEntries(
    Object.entries(result.receipts).filter(([key, value]) => {
      if (/^(room-brief|room-pause|room-resume|room-accept|group-config):/.test(key)) return true;
      try {
        const ref = JSON.parse(value).reference;
        return !ref || messageIds.has(ref) || taskIds.has(ref) || attemptIds.has(ref);
      } catch {
        return messageIds.has(value) || taskIds.has(value) || attemptIds.has(value);
      }
    }),
  );
  return result;
}
