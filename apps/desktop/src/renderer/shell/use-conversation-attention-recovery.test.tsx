/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@sync-think/shared';
import {
  recoverConversationAttention,
  useConversationAttentionRecovery,
  type AttentionRecoveryBridge,
} from './use-conversation-attention-recovery.js';
const conversations = [
  { id: 'a', taskId: 'task-a', workspaceId: 'ws-a' },
  { id: 'b', taskId: 'task-b', workspaceId: 'ws-b' },
] as unknown as Conversation[];
const ask = {
  askId: 'ask-a',
  threadId: 'thread-a',
  runId: 'run-a',
  questions: [],
  createdAt: '2026-10-04T00:00:00Z',
};
function fixture(): AttentionRecoveryBridge {
  return {
    openTask: vi.fn(async ({ taskId }) => ({
      task: { threadId: String(taskId).replace('task-', 'thread-') },
    })) as unknown as AttentionRecoveryBridge['openTask'],
    conversationAskPending: vi.fn(async ({ threadId }) => (threadId === 'thread-a' ? { ask } : {})),
    listPendingToolApprovals: vi.fn(async () => ({ approvals: [] })),
    conversationPlanGet: vi.fn(
      async () => ({}),
    ) as unknown as AttentionRecoveryBridge['conversationPlanGet'],
  };
}
afterEach(cleanup);
describe('attention recovery beyond the persisted event cursor', () => {
  it('restores pending questions without mounting or selecting a chat', async () => {
    const result = await recoverConversationAttention(fixture(), conversations, 50);
    expect(result.get('a')?.[0]).toMatchObject({
      key: 'ask:ask-a',
      kind: 'answer',
      conversationId: 'a',
      sequence: 50,
    });
    expect(result.get('b')).toEqual([]);
  });
  it('restores plans from their draft aggregate even after the planning run ended', async () => {
    const api = fixture();
    api.conversationPlanGet = vi.fn(async () => ({
      plan: { state: 'draft', currentRevision: 2, latest: { createdAt: ask.createdAt } },
    })) as unknown as AttentionRecoveryBridge['conversationPlanGet'];
    const result = await recoverConversationAttention(api, conversations.slice(0, 1), 50);
    expect(result.get('a')?.find((item) => item.key === 'plan:a')).toMatchObject({
      kind: 'approval',
      persistent: true,
    });
  });
  it('skips archived and empty conversations and avoids querying messages', async () => {
    const api = fixture();
    await recoverConversationAttention(
      api,
      [
        { id: 'empty' },
        { ...conversations[0], archivedAt: ask.createdAt },
        conversations[1],
      ] as Conversation[],
      50,
    );
    expect(api.openTask).toHaveBeenCalledTimes(1);
    expect(api.openTask).toHaveBeenCalledWith({ taskId: 'task-b' });
  });
  it('restores desktop handoff waits across workspaces', async () => {
    const api = fixture();
    api.listWaitingDesktopCommands = vi.fn(async () => ({
      commands: [
        { commandId: 'desktop-b', taskId: 'task-b', runId: 'run-b', createdAt: ask.createdAt },
      ],
    })) as unknown as AttentionRecoveryBridge['listWaitingDesktopCommands'];
    const result = await recoverConversationAttention(api, conversations, 50);
    expect(result.get('b')?.[0]).toMatchObject({
      kind: 'desktop',
      key: 'desktop:desktop-b',
      persistent: true,
    });
  });
  it('keeps failed queries out of authoritative replacements instead of erasing known waits', async () => {
    const api = fixture();
    api.conversationAskPending = vi.fn(async () => {
      throw new Error('offline');
    });
    expect((await recoverConversationAttention(api, conversations, 50)).has('a')).toBe(false);
  });
  it('requeries on reconnect, not each streaming event', async () => {
    const api = fixture();
    const options = { api, conversations, connectionRevision: 1, throughSequence: 50 };
    const hook = renderHook(({ state }) => useConversationAttentionRecovery(state), {
      initialProps: { state: options },
    });
    await waitFor(() => expect(hook.result.current.get('a')).toHaveLength(1));
    hook.rerender({ state: { ...options, throughSequence: 500 } });
    expect(api.openTask).toHaveBeenCalledTimes(2);
    await act(async () =>
      hook.rerender({ state: { ...options, connectionRevision: 2, throughSequence: 500 } }),
    );
    await waitFor(() => expect(api.openTask).toHaveBeenCalledTimes(4));
  });
});
