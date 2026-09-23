import type {
  AssistantTurnSegment,
  ConversationTransientSnapshot,
  DelegatedAgentProjection,
  DelegatedAgentUsage,
  RunProcessView,
} from '@sync-think/protocol';
import type { RunId, ThreadId } from '@sync-think/shared';
import { DELEGATION_TOOL_NAMES } from './collaboration-policy.js';
import { delegatedToolEventsFromTimeline } from './delegation-tool-events.js';

/** Only the child facts needed for a card, independent of the execution host. */
export interface DelegationCardSource {
  runId: RunId;
  userText: string;
  assistantText: string;
  assistantTimeline?: readonly AssistantTurnSegment[];
  globalAgentName?: string;
  delegationParentToolCallId?: string;
  delegationParallelGroup?: string;
  delegationTerminationReason?: string;
}

export interface DelegationUsage {
  usage?: DelegatedAgentUsage;
  durationMs?: number;
}

/** Use the already deduplicated child process totals; never add parent totals. */
export function delegatedUsageFromProcess(
  view: Pick<RunProcessView, 'tokensIn' | 'tokensOut' | 'cachedTokensHit' | 'cachedTokensCreated' | 'durationMs'>,
): DelegationUsage {
  const usage: DelegatedAgentUsage = {
    ...(view.tokensIn !== undefined ? { tokensIn: view.tokensIn } : {}),
    ...(view.tokensOut !== undefined ? { tokensOut: view.tokensOut } : {}),
    ...(view.cachedTokensHit !== undefined ? { cachedTokensHit: view.cachedTokensHit } : {}),
    ...(view.cachedTokensCreated !== undefined ? { cachedTokensCreated: view.cachedTokensCreated } : {}),
  };
  return {
    ...(Object.keys(usage).length > 0 ? { usage } : {}),
    ...(view.durationMs !== undefined ? { durationMs: view.durationMs } : {}),
  };
}

/**
 * Resolve which parent tool row a delegation belongs to.
 *
 * The child's card must sit under its own `agent_delegate` / `agent_run` row,
 * and that row is identified by the `toolCallId` the renderer already holds. The
 * durable tool result also carries `childRunId`, but it only exists once the
 * child finishes — too late to anchor a running delegation.
 *
 * Resolution happens when a projection is published rather than when the child
 * is created: the executor receives a *snapshot* of the parent run taken before
 * the delegation row was written back, so the live parent state is the first
 * place that actually holds the row.
 *
 * The child run is created from the delegation's `task` text, which is exactly
 * what the parent row's arguments carry, so task text is the deterministic key.
 * Rows already used by a sibling projection are skipped, which keeps parallel
 * siblings and repeated delegations of the same Agent on their own rows.
 */
export function resolveParentDelegationToolCallId(input: {
  timeline: readonly AssistantTurnSegment[] | undefined;
  task: string;
  /** parentToolCallId values already bound to a sibling child run. */
  claimed: ReadonlySet<string>;
}): string | undefined {
  const rows = (input.timeline ?? []).filter(
    (segment): segment is Extract<AssistantTurnSegment, { kind: 'tool' }> =>
      segment.kind === 'tool' && DELEGATION_TOOL_NAMES.has(segment.name),
  );
  const unclaimed = rows.filter((row) => !input.claimed.has(row.toolCallId));
  const taskOf = (row: Extract<AssistantTurnSegment, { kind: 'tool' }>): string => {
    try {
      const args = JSON.parse(row.argumentsJson ?? '{}') as { task?: unknown };
      return typeof args.task === 'string' ? args.task.trim() : '';
    } catch {
      return '';
    }
  };
  const wanted = input.task.trim();
  if (wanted) {
    const exact = unclaimed.filter((row) => taskOf(row) === wanted);
    // A still-running row is the live delegation; a settled one is a replay.
    const live = exact.find((row) => row.status === 'running') ?? exact[0];
    if (live) return live.toolCallId;
  }
  const running = unclaimed.filter((row) => row.status === 'running');
  // One unclaimed running row is unambiguous even if its arguments were
  // compacted away; with several candidates, guessing would mis-anchor cards.
  if (running.length === 1) return running[0]!.toolCallId;
  return unclaimed.length === 1 ? unclaimed[0]!.toolCallId : undefined;
}

export function projectDelegatedAgentCard(input: {
  child: DelegationCardSource;
  agentId: string;
  parentRunId: RunId;
  eventType: string;
  parentTimeline?: readonly AssistantTurnSegment[];
  siblings: readonly DelegatedAgentProjection[];
  storedAvatar?: string;
  childUsage: DelegationUsage;
}): { projection: DelegatedAgentProjection; terminalState?: DelegatedAgentProjection['status'] } {
  const { child, parentRunId } = input;
  const terminalState: DelegatedAgentProjection['status'] | undefined =
    input.eventType === 'run.completed'
      ? 'completed'
      : input.eventType === 'run.failed'
        ? child.delegationTerminationReason === 'timed_out' ? 'timed_out' : 'failed'
        : input.eventType === 'run.cancelled'
          ? child.delegationTerminationReason === 'timed_out' ? 'timed_out' : 'cancelled'
          : undefined;
  const toolEvents = delegatedToolEventsFromTimeline(child.assistantTimeline);
  const activeTool = [...toolEvents].reverse().find((tool) => tool.status === 'running')?.toolName;
  const claimed = new Set(input.siblings
    .filter((sibling) => String(sibling.childRunId) !== String(child.runId))
    .flatMap((sibling) => sibling.parentToolCallId ? [sibling.parentToolCallId] : []));
  const parentToolCallId = child.delegationParentToolCallId ?? resolveParentDelegationToolCallId({
    timeline: input.parentTimeline, task: child.userText, claimed,
  });
  const name = child.globalAgentName?.trim();
  return {
    terminalState,
    projection: {
      childRunId: child.runId,
      parentRunId,
      ...(parentToolCallId ? { parentToolCallId } : {}),
      ...(child.delegationParallelGroup ? { parallelGroup: child.delegationParallelGroup } : {}),
      name: name || '已配置智能体',
      avatar: input.storedAvatar?.trim() || (name ? name.slice(0, 2) : '🤖'),
      kind: 'existing',
      agentId: input.agentId,
      status: terminalState ?? 'running',
      ...(activeTool ? { activeTool } : {}),
      toolEvents,
      ...(input.childUsage.usage ? { usage: input.childUsage.usage } : {}),
      ...(input.childUsage.durationMs !== undefined ? { durationMs: input.childUsage.durationMs } : {}),
      ...(terminalState && child.assistantText.trim() ? { result: child.assistantText.trim() } : {}),
    },
  };
}

/** Broadcast late child frames, but keep a newer foreground turn's reconnect snapshot. */
export function projectDelegationSnapshot(input: {
  current: ConversationTransientSnapshot | undefined;
  threadId: ThreadId;
  parentRunId: RunId;
  streamSequence: number;
  occurredAt: string;
  agents: readonly DelegatedAgentProjection[];
}): ConversationTransientSnapshot | undefined {
  const { current, parentRunId } = input;
  if (current && current.runId !== parentRunId) return undefined;
  return {
    threadId: input.threadId,
    runId: parentRunId,
    streamSequence: input.streamSequence,
    text: current?.text ?? '',
    ...(current?.commentaryText ? { commentaryText: current.commentaryText } : {}),
    ...(current?.commentarySegments ? { commentarySegments: current.commentarySegments } : {}),
    ...(current?.reasoningText ? { reasoningText: current.reasoningText } : {}),
    ...(current?.reasoningSegments ? { reasoningSegments: current.reasoningSegments } : {}),
    ...(current?.assistantTimeline ? { assistantTimeline: current.assistantTimeline } : {}),
    ...(current?.process ? { process: current.process } : {}),
    delegatedAgents: input.agents.map((item) => ({
      ...item, toolEvents: item.toolEvents.map((tool) => ({ ...tool })),
    })),
    updatedAt: input.occurredAt,
  };
}
