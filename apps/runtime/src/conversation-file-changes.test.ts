import { describe, expect, it, vi } from 'vitest';
import type { Event, RunId } from '@sync-think/shared';
import type {
  ContentReadScope,
  SqliteEventCheckpointStore,
  SqliteConversationContentStore,
} from '@sync-think/storage';
import { readConversationFileChanges } from './conversation-file-changes.js';

const scope = { workspaceId: 'workspace', taskId: 'task', threadId: 'thread' } as ContentReadScope;
function event(id: string, sequence: number, content: string): Event {
  return {
    id,
    workspaceId: scope.workspaceId,
    taskId: scope.taskId,
    runId: 'run' as RunId,
    type: 'tool.completed',
    category: 'tool',
    sequence,
    occurredAt: '2026-09-05T19:00:00Z',
    payload: {
      toolCallId: id,
      toolName: 'write_file',
      arguments: { path: 'shared.txt', content },
      result: { created: true },
    },
  } as unknown as Event;
}
describe('conversation directory snapshots', () => {
  it('reuses immutable pages and invalidates on durable cursor changes', () => {
    let sequence = 2;
    const listRunProcessEvents = vi
      .fn()
      .mockImplementation(() => [event('first', 1, 'first'), event('last', sequence, 'last')]);
    const store = { listRunProcessEvents } as unknown as SqliteEventCheckpointStore;
    const content = {
      captureRunDirectory: (_scope: ContentReadScope, project: (runs: unknown[]) => unknown) =>
        project([{ runId: 'run', sequence, eventId: 'last-' + sequence }]),
    } as unknown as SqliteConversationContentStore;
    const first = readConversationFileChanges(store, content, scope, { offset: 0 });
    expect(first.items[0]?.contentRef?.reference.id).toBe('last');
    expect(
      readConversationFileChanges(store, content, scope, { offset: 0, version: first.version }),
    ).toEqual(first);
    expect(listRunProcessEvents).toHaveBeenCalledTimes(1);
    sequence++;
    expect(() =>
      readConversationFileChanges(store, content, scope, { offset: 0, version: first.version }),
    ).toThrow('version-changed');
    expect(readConversationFileChanges(store, content, scope, { offset: 0 }).version).not.toBe(
      first.version,
    );
    expect(listRunProcessEvents).toHaveBeenCalledTimes(2);
  });
  it('does not project foreign-workspace events attached to a message-owned run', () => {
    const store = {
      listRunProcessEvents: () => [
        event('own', 1, 'own'),
        { ...event('foreign', 2, 'foreign'), workspaceId: 'other' },
      ],
    } as unknown as SqliteEventCheckpointStore;
    const content = {
      captureRunDirectory: (_scope: ContentReadScope, project: (runs: unknown[]) => unknown) =>
        project([{ runId: 'run', sequence: 1, eventId: 'own' }]),
    } as unknown as SqliteConversationContentStore;
    expect(
      readConversationFileChanges(store, content, scope, { offset: 0 }).items[0]?.contentRef
        ?.reference.id,
    ).toBe('own');
  });
});
