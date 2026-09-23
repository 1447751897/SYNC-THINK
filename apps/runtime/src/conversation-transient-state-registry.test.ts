import { describe, expect, it } from 'vitest';
import { ConversationTransientStateRegistry } from './conversation-transient-state-registry.js';

describe('ConversationTransientStateRegistry', () => {
  it('starts each thread at sequence zero', () => {
    const registry = new ConversationTransientStateRegistry<string, { text: string }>();

    expect(registry.latestSequence('thread-a')).toBe(0);
    expect(registry.latestSequence('thread-b')).toBe(0);
  });

  it('advances sequences independently per thread', () => {
    const registry = new ConversationTransientStateRegistry<string, { text: string }>();

    expect(registry.advanceSequence('thread-a')).toBe(1);
    expect(registry.advanceSequence('thread-a')).toBe(2);
    expect(registry.advanceSequence('thread-b')).toBe(1);
  });

  it('stores the active snapshot without changing its stream sequence', () => {
    const registry = new ConversationTransientStateRegistry<string, { text: string }>();
    const snapshot = { text: 'answer' };

    registry.advanceSequence('thread-a');
    registry.setSnapshot('thread-a', snapshot);

    expect(registry.getSnapshot('thread-a')).toBe(snapshot);
    expect(registry.latestSequence('thread-a')).toBe(1);
  });

  it('preserves the snapshot while advancing the stream sequence', () => {
    const registry = new ConversationTransientStateRegistry<string, { text: string }>();
    const snapshot = { text: 'answer' };
    registry.setSnapshot('thread-a', snapshot);

    registry.advanceSequence('thread-a');

    expect(registry.getSnapshot('thread-a')).toBe(snapshot);
  });

  it('removes only the snapshot and retains the latest sequence', () => {
    const registry = new ConversationTransientStateRegistry<string, { text: string }>();
    registry.advanceSequence('thread-a');
    registry.setSnapshot('thread-a', { text: 'answer' });

    expect(registry.deleteSnapshot('thread-a')).toBe(true);
    expect(registry.deleteSnapshot('thread-a')).toBe(false);
    expect(registry.getSnapshot('thread-a')).toBeUndefined();
    expect(registry.latestSequence('thread-a')).toBe(1);
  });

  it('does not remove a snapshot owned by another run', () => {
    const registry = new ConversationTransientStateRegistry<string, { runId: string }>();
    registry.setSnapshot('thread-a', { runId: 'run-a' });

    expect(registry.deleteSnapshotIf('thread-a', (snapshot) => snapshot.runId === 'run-b')).toBe(false);
    expect(registry.getSnapshot('thread-a')).toEqual({ runId: 'run-a' });
    expect(registry.deleteSnapshotIf('thread-a', (snapshot) => snapshot.runId === 'run-a')).toBe(true);
    expect(registry.getSnapshot('thread-a')).toBeUndefined();
  });

  it('keeps snapshots and stream sequences isolated for concurrent runs on one thread', () => {
    const registry = new ConversationTransientStateRegistry<string, { runId: string; text: string }>();

    expect(registry.advanceSequence('thread-a', 'run-a')).toBe(1);
    expect(registry.advanceSequence('thread-a', 'run-b')).toBe(1);
    registry.setSnapshot('thread-a', { runId: 'run-a', text: 'A' }, 'run-a');
    registry.setSnapshot('thread-a', { runId: 'run-b', text: 'B' }, 'run-b');

    expect(registry.latestSequence('thread-a', 'run-a')).toBe(1);
    expect(registry.latestSequence('thread-a', 'run-b')).toBe(1);
    expect(registry.getSnapshot('thread-a', 'run-a')).toEqual({ runId: 'run-a', text: 'A' });
    expect(registry.getSnapshot('thread-a', 'run-b')).toEqual({ runId: 'run-b', text: 'B' });
    expect(registry.deleteSnapshotIf('thread-a', (snapshot) => snapshot.runId === 'run-a', 'run-b')).toBe(false);
    expect(registry.getSnapshot('thread-a', 'run-a')).toEqual({ runId: 'run-a', text: 'A' });
  });
});
