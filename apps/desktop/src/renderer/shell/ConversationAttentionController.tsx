import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Conversation, Event } from '@sync-think/shared';
import type { WorkspaceSummary } from '@sync-think/protocol';
import {
  ConversationAttentionIndex,
  type ConversationAttention,
} from '../../conversation-attention.js';
import { buildConversationActivity } from '../conversation-activity.js';
import type { RunActivityAuthority } from '../run-activity-authority.js';
import {
  readConversationNotificationPreferences,
  writeConversationNotificationPreferences,
} from './conversation-notification-preferences.js';
import {
  useConversationAttentionRecovery,
  type AttentionRecoveryBridge,
} from './use-conversation-attention-recovery.js';
import {
  useConversationNotices,
  type ConversationNoticeBridge,
} from './use-conversation-notices.js';
import {
  ConversationAttentionCenter,
  type ConversationAttentionItem,
} from './ConversationAttentionCenter.js';

export interface ConversationAttentionProjection {
  requests: Map<string, ConversationAttention[]>;
  failedIds: ReadonlySet<string>;
}
export default function ConversationAttentionController(props: {
  api: (AttentionRecoveryBridge & ConversationNoticeBridge) | undefined;
  conversations: readonly Conversation[];
  workspaces: readonly WorkspaceSummary[];
  events: readonly Event[];
  portalHost: Element | null;
  authority?: RunActivityAuthority;
  connectionRevision: number;
  lastSeen: Record<string, number>;
  visibleIds: ReadonlySet<string>;
  titleFor(conversation: Conversation): string;
  onOpenConversation(id: string): void;
  onProjection(value: ConversationAttentionProjection): void;
}) {
  const indexRef = useRef(new ConversationAttentionIndex());
  const [preferences, setPreferences] = useState(readConversationNotificationPreferences);
  const recovered = useConversationAttentionRecovery({
    api: props.api,
    conversations: props.conversations,
    connectionRevision: props.connectionRevision,
    throughSequence: Math.max(
      props.authority?.throughSequence ?? 0,
      props.events.at(-1)?.sequence ?? 0,
    ),
  });
  const projection = useMemo(() => {
    const index = indexRef.current;
    index.ingest(props.events);
    const requests = new Map<string, ConversationAttention[]>();
    const failedIds = new Set<string>();
    const activity = buildConversationActivity(props.events, props.conversations, props.authority);
    for (const conversation of props.conversations) {
      const id = String(conversation.id);
      const pending = new Map(
        (recovered.get(id) ?? [])
          .filter(
            (request) =>
              !index.resolvedSince(request.key, request.sequence) &&
              (request.persistent || !request.runId || !index.terminal(request.runId)),
          )
          .map((request) => [request.key, request]),
      );
      for (const request of index.forConversation(conversation)) pending.set(request.key, request);
      requests.set(
        id,
        [...pending.values()]
          .filter(
            (request) =>
              request.persistent ||
              !request.runId ||
              !props.authority ||
              request.sequence > props.authority.throughSequence ||
              props.authority.activeRunIds.has(request.runId),
          )
          .sort(
            (a, b) =>
              (a.kind === 'answer' ? 0 : 1) - (b.kind === 'answer' ? 0 : 1) ||
              b.sequence - a.sequence,
          ),
      );
      const terminal = index.lastFinished(conversation);
      if (
        !activity.get(id)?.running &&
        terminal?.type === 'run.failed' &&
        terminal.sequence > (props.lastSeen[id] ?? -1)
      )
        failedIds.add(id);
    }
    return { requests, failedIds };
  }, [props.events, props.conversations, props.authority, props.lastSeen, recovered]);
  useEffect(() => {
    props.onProjection(projection);
  }, [projection, props.onProjection]);
  useConversationNotices({
    api: props.api,
    visibleIds: props.visibleIds,
    attention: projection.requests,
    preferences,
    onOpenConversation: props.onOpenConversation,
  });
  const items = useMemo(
    () =>
      props.conversations
        .flatMap((conversation) => {
          if (conversation.archivedAt) return [];
          const id = String(conversation.id);
          const request = projection.requests.get(id)?.[0];
          if (!request && !projection.failedIds.has(id)) return [];
          return [
            {
              conversationId: id,
              title: conversation.title?.trim() || props.titleFor(conversation),
              workspace:
                props.workspaces.find(
                  (workspace) => workspace.workspaceId === conversation.workspaceId,
                )?.name || '无项目会话',
              kind: request?.kind ?? 'failed',
              sequence:
                request?.sequence ?? indexRef.current.lastFinished(conversation)?.sequence ?? 0,
            } satisfies ConversationAttentionItem,
          ];
        })
        .sort(
          (a, b) =>
            (a.kind === 'answer' ? 0 : 1) - (b.kind === 'answer' ? 0 : 1) ||
            b.sequence - a.sequence,
        ),
    [props.conversations, props.workspaces, props.titleFor, projection],
  );
  return props.portalHost
    ? createPortal(
        <ConversationAttentionCenter
          items={items}
          preferences={preferences}
          onPreferencesChange={(value) => {
            setPreferences(value);
            writeConversationNotificationPreferences(value);
          }}
          onOpenConversation={props.onOpenConversation}
        />,
        props.portalHost,
      )
    : null;
}
