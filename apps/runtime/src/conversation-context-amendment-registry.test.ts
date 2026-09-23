import { describe, expect, it } from 'vitest';
import { ConversationContextAmendmentRegistry } from './conversation-context-amendment-registry.js';

describe('conversation context amendment registry', () => {
  it('replaces and reads thread-scoped exclusions', () => {
    const registry = new ConversationContextAmendmentRegistry();

    registry.replace('thread-a', ['source-a', 'source-b']);
    registry.replace('thread-b', ['source-c']);

    expect(registry.getExcludedSourceIds('thread-a')).toEqual(['source-a', 'source-b']);
    expect(registry.getExcludedSourceIds('thread-b')).toEqual(['source-c']);
  });

  it('isolates stored values from caller mutation', () => {
    const registry = new ConversationContextAmendmentRegistry();
    const sourceIds = ['source-a'];
    registry.replace('thread-a', sourceIds);

    sourceIds.push('source-b');
    registry.getExcludedSourceIds('thread-a').push('source-c');

    expect(registry.getExcludedSourceIds('thread-a')).toEqual(['source-a']);
  });

  it('clears one thread without affecting another', () => {
    const registry = new ConversationContextAmendmentRegistry();
    registry.replace('thread-a', ['source-a']);
    registry.replace('thread-b', ['source-b']);

    registry.clear('thread-a');

    expect(registry.getExcludedSourceIds('thread-a')).toEqual([]);
    expect(registry.getExcludedSourceIds('thread-b')).toEqual(['source-b']);
  });
});
