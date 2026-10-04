import { describe, expect, it } from 'vitest';
import type { Message } from '@sync-think/shared';
import {
  captureNativeCheckpointLineage,
  selectNativeCheckpointMessages,
} from './native-checkpoint-lineage.js';
const history = [
  {
    id: 'u',
    threadId: 't',
    sequence: 1,
    role: 'user',
    createdAt: '2026-10-02T00:00:00.000Z',
    blocks: [{ type: 'text', text: 'old' }],
  },
  {
    id: 'a',
    threadId: 't',
    sequence: 2,
    role: 'assistant',
    createdAt: '2026-10-02T00:00:00.000Z',
    blocks: [
      { type: 'commentary', text: 'progress' },
      { type: 'text', text: 'final' },
    ],
  },
  {
    id: 'current',
    threadId: 't',
    sequence: 3,
    role: 'user',
    createdAt: '2026-10-02T00:00:00.000Z',
    blocks: [{ type: 'text', text: 'active' }],
  },
] as Message[];
describe('canonical native checkpoint promotion', () => {
  it('preserves multi-part message boundaries and excludes the current user turn', () => {
    const lineage = captureNativeCheckpointLineage({
      history,
      currentUserText: 'active',
      messages: [
        { role: 'user', content: 'old' },
        { role: 'assistant', phase: 'commentary', content: 'progress' },
        { role: 'assistant', phase: 'final_answer', content: 'final' },
        { role: 'user', content: 'active' },
      ],
    });
    expect(selectNativeCheckpointMessages(lineage, 2)).toBeUndefined();
    expect(selectNativeCheckpointMessages(lineage, 3)?.map((m) => m.id)).toEqual(['u', 'a']);
    expect(selectNativeCheckpointMessages(lineage, 4)).toBeUndefined();
  });
  it('declines promotion when source projection differs or contains transient tool-chain messages', () => {
    const lineage = captureNativeCheckpointLineage({
      history,
      currentUserText: 'active',
      messages: [{ role: 'user', content: 'different' }],
    });
    expect(lineage).toEqual([]);
    expect(selectNativeCheckpointMessages(lineage, 1)).toBeUndefined();
  });
});
