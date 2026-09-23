import { describe, expect, it } from 'vitest';
import type { ContextSnapshot } from './context-snapshot.js';
import { ConversationContextSnapshotCache } from './conversation-context-snapshot-cache.js';

function snapshot(modelId: string, kernelId?: string): ContextSnapshot {
  return {
    providerRequest: { systemPrompt: '', messages: [] },
    status: {
      modelId,
      ...(kernelId !== undefined ? { kernelId } : {}),
      contextWindow: 1,
      modelContextWindow: 1,
      contextWindowSource: 'model-default',
      estimatedUsedTokens: 0,
      usageRatio: 0,
      compactThreshold: 0.7,
      shouldAutoCompact: false,
      sections: [],
    },
    sources: [],
  };
}

describe('conversation context snapshot cache', () => {
  it('isolates snapshots by thread, model, and normalized kernel', () => {
    const cache = new ConversationContextSnapshotCache();
    const native = snapshot('model-a');
    const claude = snapshot('model-a', ' claude-code ');
    const otherModel = snapshot('model-b');

    cache.set('thread-a', native);
    cache.set('thread-a', claude);
    cache.set('thread-a', otherModel);

    expect(cache.get('thread-a', 'model-a')).toBe(native);
    expect(cache.get('thread-a', 'model-a', 'claude-code')).toBe(claude);
    expect(cache.get('thread-a', 'model-b')).toBe(otherModel);
    expect(cache.get('thread-b', 'model-a')).toBeUndefined();
    expect(cache.get('thread-a', undefined)).toBeUndefined();
    expect(cache.countForThread('thread-a')).toBe(3);
  });

  it('invalidates one thread without disturbing another and supports full clears', () => {
    const cache = new ConversationContextSnapshotCache();
    cache.set('thread-a', snapshot('model-a'));
    cache.set('thread-b', snapshot('model-a'));

    cache.deleteThread('thread-a');
    expect(cache.hasThread('thread-a')).toBe(false);
    expect(cache.hasThread('thread-b')).toBe(true);

    cache.clear();
    expect(cache.hasThread('thread-b')).toBe(false);
  });
});
