import { createHash } from 'node:crypto';
import {
  parseRunProcessPageRequest,
  type ConversationFileChangeItem,
  type ConversationFileChangesOptions,
  type ConversationFileChangesPage,
} from '@sync-think/protocol';
import type {
  ContentReadScope,
  SqliteConversationContentStore,
  SqliteEventCheckpointStore,
} from '@sync-think/storage';
import { fileChangeSequences, projectRunProcessSnapshot } from './run-process-view.js';
import { projectFileChangeContent } from './file-change-content.js';

interface DirectorySnapshot {
  version: string;
  items: ConversationFileChangeItem[];
  bytes: number;
}
const directories = new WeakMap<SqliteEventCheckpointStore, Map<string, DirectorySnapshot>>();

export function readConversationFileChanges(
  store: SqliteEventCheckpointStore,
  content: SqliteConversationContentStore,
  scope: ContentReadScope,
  options: ConversationFileChangesOptions,
): ConversationFileChangesPage {
  if (!parseRunProcessPageRequest({ section: 'fileChanges', ...options }))
    throw new Error('history.invalid-range');
  return content.captureRunDirectory(scope, (runs) => {
    const key = JSON.stringify(scope);
    const version = createHash('sha256')
      .update(JSON.stringify(['conversation-files-v2', scope, runs]))
      .digest('hex');
    if (options.version && options.version !== version) throw new Error('history.version-changed');
    let cache = directories.get(store);
    if (!cache) {
      cache = new Map();
      directories.set(store, cache);
    }
    let snapshot = cache.get(key);
    cache.delete(key);
    if (snapshot?.version !== version) {
      const byPath = new Map<string, ConversationFileChangeItem>();
      for (const run of runs) {
        const events = store
          .listRunProcessEvents(run.runId)
          .filter((event) => event.workspaceId === scope.workspaceId);
        const changes = projectFileChangeContent(
          projectRunProcessSnapshot(run.runId, events).fileChanges,
          events,
          true,
        );
        const sequences = fileChangeSequences(events);
        for (const change of changes) {
          const item = {
            ...change,
            ...(change.preview ? { preview: change.preview.slice(0, 256) } : {}),
            runId: run.runId,
            sequence: sequences.get(change.toolCallId ?? '') ?? 0,
          };
          const previous = byPath.get(item.path);
          if (!previous || previous.sequence <= item.sequence) byPath.set(item.path, item);
        }
      }
      const items = [...byPath.values()].sort((left, right) =>
        left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
      );
      snapshot = { items, version, bytes: Buffer.byteLength(JSON.stringify(items)) };
    }
    if (snapshot.bytes <= 16 * 1024 * 1024) {
      cache.set(key, snapshot);
      let bytes = [...cache.values()].reduce((total, entry) => total + entry.bytes, 0);
      while (cache.size > 8 || bytes > 16 * 1024 * 1024) {
        const oldest = cache.keys().next().value!;
        bytes -= cache.get(oldest)!.bytes;
        cache.delete(oldest);
      }
    }
    if (options.offset > snapshot.items.length) throw new Error('history.invalid-range');
    const items: ConversationFileChangeItem[] = [];
    let bytes = 2;
    for (
      let index = options.offset;
      index < snapshot.items.length && items.length < (options.limit ?? 40);
      index++
    ) {
      const item = snapshot.items[index]!;
      const size = Buffer.byteLength(JSON.stringify(item)) + 1;
      if (bytes + size > 224 * 1024) {
        if (!items.length) throw new Error('history.item-too-large');
        break;
      }
      items.push(item);
      bytes += size;
    }
    const end = options.offset + items.length;
    return {
      items,
      offset: options.offset,
      total: snapshot.items.length,
      version,
      ...(end < snapshot.items.length ? { nextOffset: end } : {}),
    };
  });
}
