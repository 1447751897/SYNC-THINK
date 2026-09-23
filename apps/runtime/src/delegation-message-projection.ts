import type { DelegatedAgentProjection } from '@sync-think/protocol';
import type { DelegatedRunRecord, Message, MessageBlock } from '@sync-think/shared';

const STATUSES = new Set(['running', 'completed', 'failed', 'cancelled', 'timed_out']);

export function delegatedAgentsFromBlocks(
  blocks: readonly MessageBlock[],
): DelegatedAgentProjection[] {
  const agents = new Map<string, DelegatedAgentProjection>();
  for (const block of blocks) {
    const payload = block.payload as { delegatedAgents?: unknown } | undefined;
    if (!Array.isArray(payload?.delegatedAgents)) continue;
    for (const value of payload.delegatedAgents) {
      if (!value || typeof value !== 'object') continue;
      const agent = value as DelegatedAgentProjection;
      if (
        typeof agent.childRunId !== 'string' ||
        typeof agent.parentRunId !== 'string' ||
        typeof agent.name !== 'string' ||
        !STATUSES.has(agent.status) ||
        !Array.isArray(agent.toolEvents)
      )
        continue;
      agents.set(agent.childRunId, copyDelegatedAgentProjection(agent));
    }
  }
  return [...agents.values()];
}

export function copyDelegatedAgentProjection(
  agent: DelegatedAgentProjection,
): DelegatedAgentProjection {
  return {
    ...agent,
    toolEvents: agent.toolEvents.map((tool) => ({ ...tool })),
    ...(agent.usage ? { usage: { ...agent.usage } } : {}),
  };
}

export function legacyDelegatedRunRecords(messages: readonly Message[]): DelegatedRunRecord[] {
  const records = new Map<string, DelegatedRunRecord>();
  for (const message of [...messages].sort((a, b) => a.sequence - b.sequence)) {
    for (const agent of delegatedAgentsFromBlocks(message.blocks)) {
      const toolCount = agent.toolEvents.reduce((count, tool) => {
        const omitted = /另有\s*(\d+)\s*项/.exec(tool.toolName ?? '');
        return count + (omitted ? Number(omitted[1]) : tool.omitted ? 0 : 1);
      }, 0);
      records.set(agent.childRunId, {
        childRunId: agent.childRunId,
        parentRunId: agent.parentRunId,
        threadId: message.threadId,
        agentId: agent.agentId,
        name: agent.name,
        status: agent.status,
        toolCount,
        ...(agent.result ? { result: agent.result } : {}),
        updatedAt: message.createdAt,
        sequence: 0,
      });
    }
  }
  return [...records.values()];
}
