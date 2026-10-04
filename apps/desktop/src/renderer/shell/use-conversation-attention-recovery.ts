import { useEffect, useRef, useState } from 'react';
import type { Conversation, Event } from '@sync-think/shared';
import type {
  ConversationAskPendingResponse,
  ConversationPlanResponse,
  ListPendingToolApprovalsResponse,
  ListWaitingDesktopCommandsResponse,
  OpenTaskResponse,
} from '@sync-think/protocol';
import { attentionRequest, type ConversationAttention } from '../../conversation-attention.js';

export interface AttentionRecoveryBridge {
  openTask?(input: { taskId: NonNullable<Conversation['taskId']> }): Promise<OpenTaskResponse>;
  conversationAskPending?(input: { threadId: string }): Promise<ConversationAskPendingResponse>;
  listPendingToolApprovals?(input: {
    threadId: NonNullable<OpenTaskResponse['task']>['threadId'];
  }): Promise<ListPendingToolApprovalsResponse>;
  conversationPlanGet?(input: {
    conversationId: Conversation['id'];
  }): Promise<ConversationPlanResponse>;
  listWaitingDesktopCommands?(input: {}): Promise<ListWaitingDesktopCommandsResponse>;
}
function snapshotEvent(
  conversation: Conversation,
  sequence: number,
  type: string,
  payload: Record<string, unknown>,
  createdAt: string,
): Event {
  return {
    id: `attention-snapshot:${conversation.id}:${type}` as Event['id'],
    type,
    sequence,
    category: 'system',
    workspaceId: (conversation.workspaceId ?? 'system') as Event['workspaceId'],
    taskId: conversation.taskId,
    occurredAt: createdAt,
    payload: { ...payload, conversationId: String(conversation.id) },
  };
}
/** Recover Runtime-authoritative pending waits even when its persisted replay
 * cursor has advanced beyond the original requested event. No chat must mount. */
export async function recoverConversationAttention(
  api: AttentionRecoveryBridge,
  conversations: readonly Conversation[],
  sequence: number,
): Promise<Map<string, ConversationAttention[]>> {
  const result = new Map<string, ConversationAttention[]>();
  const candidates = conversations.filter(
    (conversation) => !conversation.archivedAt && conversation.taskId,
  );
  const readConversation = async (conversation: Conversation) => {
    const requests: ConversationAttention[] = [];
    const append = (type: string, payload: Record<string, unknown>, at: string) => {
      const request = attentionRequest(snapshotEvent(conversation, sequence, type, payload, at));
      if (request) requests.push(request);
    };
    let validated = false;
    let incomplete = false;
    await Promise.all([
      (async () => {
        if (!api.openTask || (!api.conversationAskPending && !api.listPendingToolApprovals)) return;
        const response = await api.openTask({ taskId: conversation.taskId! });
        const threadId = response.task?.threadId;
        if (!threadId) return;
        await Promise.all([
          (async () => {
            if (!api.conversationAskPending) return;
            const { ask } = await api.conversationAskPending({ threadId });
            validated = true;
            if (ask) append('conversation.ask_pending', { ...ask }, ask.createdAt);
          })(),
          (async () => {
            if (!api.listPendingToolApprovals) return;
            const { approvals } = await api.listPendingToolApprovals({ threadId });
            validated = true;
            for (const approval of approvals)
              append('tool.approval_requested', { ...approval }, approval.createdAt);
          })(),
        ]);
      })().catch(() => {
        incomplete = true;
      }),
      (async () => {
        if (!api.conversationPlanGet) return;
        const { plan } = await api.conversationPlanGet({ conversationId: conversation.id });
        validated = true;
        if (plan && plan.state === 'draft')
          append(
            'conversation.plan_submitted',
            {
              conversationId: String(conversation.id),
              revision: plan.currentRevision,
            },
            plan.latest.createdAt,
          );
      })().catch(() => {
        incomplete = true;
      }),
    ]);
    if (validated && !incomplete) result.set(String(conversation.id), requests);
  };
  // Bound IPC work at startup; streaming must stay responsive in large workspaces.
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, candidates.length) }, async () => {
      while (next < candidates.length) await readConversation(candidates[next++]);
    }),
  );
  if (api.listWaitingDesktopCommands) {
    try {
      const { commands } = await api.listWaitingDesktopCommands({});
      for (const command of commands) {
        const conversation = candidates.find(
          (item) => String(item.taskId) === String(command.taskId),
        );
        if (!conversation) continue;
        const request = attentionRequest(
          snapshotEvent(
            conversation,
            sequence,
            'desktop.command.waiting_user',
            { ...command },
            command.createdAt,
          ),
        );
        if (request)
          result.set(String(conversation.id), [
            ...(result.get(String(conversation.id)) ?? []),
            request,
          ]);
      }
    } catch {
      /* Retain live-event state until Runtime reconnects. */
    }
  }
  return result;
}
export function useConversationAttentionRecovery(options: {
  api: AttentionRecoveryBridge | undefined;
  conversations: readonly Conversation[];
  connectionRevision: number;
  throughSequence: number;
}): ReadonlyMap<string, readonly ConversationAttention[]> {
  const [recovered, setRecovered] = useState(new Map<string, ConversationAttention[]>());
  const current = useRef(options);
  current.current = options;
  const key = JSON.stringify(
    options.conversations.map((item) => [item.id, item.taskId, item.archivedAt]),
  );
  useEffect(() => {
    let cancelled = false;
    const start = current.current;
    if (!start.api || !start.connectionRevision) return;
    void recoverConversationAttention(start.api, start.conversations, start.throughSequence).then(
      (snapshot) => {
        if (!cancelled) setRecovered((previous) => new Map([...previous, ...snapshot]));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, options.connectionRevision, options.api]);
  return recovered;
}
