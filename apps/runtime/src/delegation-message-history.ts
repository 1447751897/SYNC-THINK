import type { DelegatedAgentProjection } from '@sync-think/protocol';
import type {
  DelegatedRunRecord, Message, MessageBlock, MessageId, RunId,
} from '@sync-think/shared';
import type { DelegationLegacyMessagePort } from './delegation-legacy-message-history.js';
import {
  copyDelegatedAgentProjection,
  delegatedAgentsFromBlocks,
} from './delegation-message-projection.js';

export interface DelegationMessageCardPort {
  getMessage(id: MessageId): Message | undefined;
  updateBlocks(id: MessageId, blocks: readonly MessageBlock[]): unknown;
}

export interface DelegationMessagePort
  extends DelegationMessageCardPort,
    DelegationLegacyMessagePort {}

export { delegatedAgentsFromBlocks, legacyDelegatedRunRecords } from './delegation-message-projection.js';

/** Owns live cards and their compatibility representation on parent messages. */
export class DelegationMessageHistory {
  private readonly live = new Map<string, DelegatedAgentProjection[]>();

  constructor(
    private readonly messages: DelegationMessageCardPort | undefined,
    private readonly getState: (childRunId: string) => DelegatedRunRecord | undefined,
  ) {}

  listByParent(parentRunId: RunId): DelegatedAgentProjection[] {
    const stored = this.messages?.getMessage(`asst-${parentRunId}` as MessageId);
    const merged = new Map<string, DelegatedAgentProjection>();
    for (const item of [
      ...delegatedAgentsFromBlocks(stored?.blocks ?? []),
      ...(this.live.get(parentRunId) ?? []),
    ]) {
      if (item.parentRunId !== parentRunId) continue;
      const previous = merged.get(item.childRunId);
      // A delayed progress frame must not resurrect a durable terminal task.
      if (previous && previous.status !== 'running' && item.status === 'running') continue;
      merged.set(item.childRunId, copyDelegatedAgentProjection(item));
    }
    // A live frame must not scan the entire conversation or replay child events.
    // Durable status queries reconcile separately; card merge uses keyed state.
    for (const [childRunId, card] of merged) {
      const state = this.getState(childRunId);
      if (
        state &&
        state.parentRunId === parentRunId &&
        !(card.status !== 'running' && state.status === 'running')
      ) {
        merged.set(childRunId, {
          ...card,
          status: state.status,
          ...(state.result ? { result: state.result } : {}),
        });
      }
    }
    return [...merged.values()].map(copyDelegatedAgentProjection);
  }

  upsert(agent: DelegatedAgentProjection): DelegatedAgentProjection[] {
    const merged = new Map(
      this.listByParent(agent.parentRunId).map((item) => [item.childRunId, item]),
    );
    const previous = merged.get(agent.childRunId);
    if (!previous || previous.status === 'running' || agent.status !== 'running') {
      merged.set(agent.childRunId, copyDelegatedAgentProjection(agent));
    }
    const next = [...merged.values()];
    this.live.set(agent.parentRunId, next);
    return next.map(copyDelegatedAgentProjection);
  }

  withMetadata(
    blocks: readonly MessageBlock[],
    agents: readonly DelegatedAgentProjection[],
  ): MessageBlock[] {
    if (!agents.length) return blocks.map((block) => ({ ...block }));
    const copied = blocks.map((block) => {
      if (!block.payload || typeof block.payload !== 'object' || Array.isArray(block.payload))
        return { ...block };
      const payload = { ...(block.payload as Record<string, unknown>) };
      delete payload.delegatedAgents;
      return { ...block, payload };
    });
    if (!copied.length) copied.push({ type: 'commentary', text: '' });
    const index = Math.max(
      0,
      copied.findIndex((block) => block.type === 'commentary'),
    );
    const target = copied[index]!;
    const payload =
      target.payload && typeof target.payload === 'object' && !Array.isArray(target.payload)
        ? target.payload
        : {};
    copied[index] = {
      ...target,
      payload: { ...payload, delegatedAgents: agents.map(copyDelegatedAgentProjection) },
    };
    return copied;
  }

  persistParent(parentRunId: RunId): boolean {
    const message = this.messages?.getMessage(`asst-${parentRunId}` as MessageId);
    if (message) {
      const agents = this.listByParent(parentRunId);
      this.messages!.updateBlocks(message.id, this.withMetadata(message.blocks, agents));
      if (agents.every((agent) => agent.status !== 'running')) this.live.delete(parentRunId);
      return true;
    }
    return false;
  }

  releaseParent(parentRunId: RunId): void {
    // A configured store can receive the parent later. Keep pending cards for the next flush.
    if (!this.messages || this.persistParent(parentRunId)) this.live.delete(parentRunId);
  }
}
