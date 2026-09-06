import { lstatSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ContentReference,
  Message,
  RunId,
  TaskId,
  ThreadId,
  WorkspaceId,
} from '@sync-think/shared';
import { openDatabaseAsync } from './connection.js';
import { runMigrations } from './scripts/migrate.js';
import { SqliteEventCheckpointStore, type EventDraft } from './runtime-state-store.js';
import { SqliteMessageStore } from './message-store.js';
import { SqliteAssistantTimelineStore } from './assistant-timeline-store.js';
import { SqliteConversationContentStore } from './conversation-content-store.js';
import { EventPayloadSidecarStore } from './event-payload-sidecar.js';

const scope = {
  workspaceId: 'workspace-a' as WorkspaceId,
  taskId: 'task-a' as TaskId,
  threadId: 'thread-a' as ThreadId,
};
const resources: Array<{ directory: string; close: () => void }> = [];
const now = '2026-09-05T13:00:00.000Z';
const runId = 'run-a' as RunId;
afterEach(() => {
  for (const resource of resources.splice(0)) {
    resource.close();
    const resolved = realpathSync(resource.directory);
    if (
      lstatSync(resource.directory).isSymbolicLink() ||
      dirname(resolved) !== realpathSync(tmpdir()) ||
      !basename(resolved).startsWith('sync-think-content-test-')
    )
      throw new Error('Unexpected test cleanup path');
    rmSync(resolved, { recursive: true, force: true });
  }
});

async function fixture(output = 'complete output') {
  const directory = mkdtempSync(join(tmpdir(), 'sync-think-content-test-'));
  const dbPath = join(directory, 'content.db');
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  resources.push({ directory, close: () => connection.raw.close() });
  connection.raw
    .prepare('INSERT INTO workspace (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(scope.workspaceId, 'Content fixture', now, now);
  connection.raw
    .prepare(
      'INSERT INTO task (id, workspace_id, title, goal, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(
      scope.taskId,
      scope.workspaceId,
      'Content fixture',
      'Verify exact scoped content',
      now,
      now,
    );
  const events = new SqliteEventCheckpointStore(connection.raw);
  const draft = (id: string, type: string, payload: Record<string, unknown>): EventDraft =>
    ({
      id,
      workspaceId: scope.workspaceId,
      taskId: scope.taskId,
      runId,
      category: type.startsWith('run.') ? 'run' : 'tool',
      type,
      occurredAt: now,
      payload,
    }) as unknown as EventDraft;
  events.commitTransition({
    events: [
      draft('start', 'run.started', { threadId: scope.threadId }),
      draft('output', 'tool.completed', {
        threadId: scope.threadId,
        toolCallId: 'call-a',
        result: output,
      }),
    ],
  });
  connection.raw
    .prepare('INSERT INTO thread (id, task_id, created_at) VALUES (?, ?, ?)')
    .run(scope.threadId, scope.taskId, now);
  return {
    directory,
    connection,
    events,
    draft,
    reader: new SqliteConversationContentStore(connection.raw),
    timeline: new SqliteAssistantTimelineStore(connection.raw),
  };
}

const eventRef: ContentReference = { source: 'event', id: 'output', path: ['result'] };
describe('scoped deferred conversation content', () => {
  it('reads a scoped run directory through covering cursors and a partial start index', async () => {
    const test = await fixture();
    const prepare = vi.spyOn(test.connection.raw, 'prepare');
    try {
      expect(test.reader.captureRunDirectory(scope, (runs) => runs)).toEqual([
        { runId, sequence: 2, eventId: 'output' },
      ]);
      const statement = prepare.mock.calls.find(([sql]) => sql.includes('WITH scoped_runs'))![0];
      const plan = test.connection.raw
        .prepare('EXPLAIN QUERY PLAN ' + statement)
        .all(scope.workspaceId, scope.taskId, scope.threadId, scope.threadId, scope.workspaceId);
      expect(JSON.stringify(plan)).toContain('event_conversation_start_idx');
      expect(JSON.stringify(plan)).toContain('event_run_cursor_idx');
      expect(() =>
        test.reader.captureRunDirectory(
          { ...scope, threadId: 'other-thread' as ThreadId },
          (runs) => runs,
        ),
      ).toThrow('content.not-found');
    } finally {
      prepare.mockRestore();
    }
  });
  it('includes message-owned runs but excludes unrelated runs and workspaces', async () => {
    const test = await fixture();
    const events = new SqliteEventCheckpointStore(test.connection.raw);
    events.commitTransition({
      events: ['message-owned', 'unrelated'].map((id) => ({
        id,
        runId: id as RunId,
        workspaceId: scope.workspaceId,
        category: 'tool',
        type: 'tool.completed',
        occurredAt: now,
        payload: {},
      })) as [EventDraft, ...EventDraft[]],
    });
    test.connection.raw
      .prepare(
        "INSERT INTO message (id, thread_id, run_id, role, sequence, blocks_json, created_at) VALUES (?, ?, ?, 'assistant', 1, '[]', ?)",
      )
      .run('message', scope.threadId, 'message-owned', now);
    expect(test.reader.captureRunDirectory(scope, (runs) => runs.map((run) => run.runId))).toEqual([
      'message-owned',
      runId,
    ]);
    expect(() =>
      test.reader.captureRunDirectory(
        { ...scope, workspaceId: 'other-workspace' as WorkspaceId },
        (runs) => runs,
      ),
    ).toThrow('content.not-found');
  });
  it('compares scoped source versions and rejects a changed side or cross-thread read', async () => {
    const test = await fixture();
    const write = (content: string) =>
      test.connection.raw.prepare('UPDATE event SET payload_json = ? WHERE id = ?').run(
        JSON.stringify({
          threadId: scope.threadId,
          previousContent: 'before\n',
          argumentsJson: JSON.stringify({ content }),
        }),
        'output',
      );
    write('after\n');
    const options = {
      before: { reference: { source: 'event' as const, id: 'output', path: ['previousContent'] } },
      after: {
        reference: { source: 'event' as const, id: 'output', path: ['argumentsJson', 'content'] },
      },
      limit: 1,
    };
    const first = test.reader.readDiff(scope, options);
    expect(first).toMatchObject({ added: 1, removed: 1, nextOffset: 1 });
    expect(
      test.reader.readDiff(scope, { ...options, version: first.version, offset: 1 }).rows[0].text,
    ).toBe('after');
    write('newer\n');
    expect(() =>
      test.reader.readDiff(scope, { ...options, version: first.version, offset: 1 }),
    ).toThrow('content.version-changed');
    expect(() =>
      test.reader.readDiff({ ...scope, threadId: 'other' as ThreadId }, options),
    ).toThrow('content.not-found');
  });
  it('selects an owned field through encoded tool arguments without exposing prototype paths', async () => {
    const test = await fixture();
    const output = '完整历史文件🙂'.repeat(1000);
    test.connection.raw.prepare('UPDATE event SET payload_json = ? WHERE id = ?').run(
      JSON.stringify({
        threadId: scope.threadId,
        argumentsJson: JSON.stringify({ content: output }),
        previousContent: 'old',
      }),
      'output',
    );
    expect(
      test.reader.read(scope, {
        reference: { source: 'event', id: 'output', path: ['argumentsJson', 'content'] },
        offset: output.length - 100,
        limit: 256,
      }).text,
    ).toBe(output.slice(-100));
    expect(
      test.reader.read(scope, {
        reference: { source: 'event', id: 'output', path: ['previousContent'] },
      }).text,
    ).toBe('old');
    expect(() =>
      test.reader.read(scope, {
        reference: { source: 'event', id: 'output', path: ['argumentsJson', '__proto__'] },
      }),
    ).toThrow('content.invalid-reference');
  });
  it('resolves persisted sidecar content without exposing its filesystem path', async () => {
    const test = await fixture();
    const output = 'sidecar-private-body🙂'.repeat(2000);
    const sidecar = new EventPayloadSidecarStore(join(test.directory, 'sidecars'));
    const events = new SqliteEventCheckpointStore(test.connection.raw, {
      sidecar,
      minimumBytes: 128,
      shouldExternalize: () => true,
      project: (event) => ({ threadId: event.payload.threadId }),
    });
    events.commitTransition({
      events: [
        {
          id: 'sidecar-output' as EventDraft['id'],
          workspaceId: scope.workspaceId,
          taskId: scope.taskId,
          runId,
          category: 'tool',
          type: 'tool.completed',
          occurredAt: now,
          payload: { threadId: scope.threadId, result: output },
        } as EventDraft,
      ],
    });
    const reference: ContentReference = { source: 'event', id: 'sidecar-output', path: ['result'] };
    const chunk = new SqliteConversationContentStore(test.connection.raw, sidecar).read(scope, {
      reference,
      offset: output.length - 300,
      limit: 512,
    });
    expect(chunk.text).toBe(output.slice(-300));
    expect(JSON.stringify(chunk)).not.toContain(test.directory);
    expect(() =>
      new SqliteConversationContentStore(test.connection.raw, sidecar).read(
        { ...scope, threadId: 'other' as ThreadId },
        { reference },
      ),
    ).toThrow('content.not-found');
    expect(() => test.reader.read(scope, { reference })).toThrow();
  });
  it('reads a multi-megabyte Unicode result in bounded, lossless, versioned chunks', async () => {
    const output = '首段🙂\n"完整结果"\u0001'.repeat(90000);
    const test = await fixture(output);
    const pieces: string[] = [];
    let offset = 0;
    let version: string | undefined;
    while (true) {
      const chunk = test.reader.read(scope, { reference: eventRef, offset, limit: 32768, version });
      version ??= chunk.version;
      expect(chunk.version).toBe(version);
      expect(chunk.utf8Bytes).toBe(Buffer.byteLength(output));
      expect(chunk.offset).toBe(offset);
      expect(Buffer.byteLength(JSON.stringify(chunk))).toBeLessThan(256 * 1024);
      pieces.push(chunk.text);
      if (chunk.nextOffset === undefined) break;
      expect(chunk.nextOffset).toBeGreaterThan(offset);
      offset = chunk.nextOffset;
    }
    expect(pieces.join('')).toBe(output);
  });

  it('does not expose another task, thread or workspace through an otherwise valid reference', async () => {
    const test = await fixture();
    for (const other of [
      { ...scope, workspaceId: 'other-workspace' as WorkspaceId },
      { ...scope, taskId: 'other-task' as TaskId },
      { ...scope, threadId: 'other-thread' as ThreadId },
    ])
      expect(() => test.reader.read(other, { reference: eventRef })).toThrow('content.not-found');
    expect(() =>
      test.reader.read(scope, { reference: { ...eventRef, path: ['run', 'userText'] } }),
    ).toThrow('content.invalid-reference');
  });

  it('reads only owned message fields and preserves structured JSON exactly as a readable value', async () => {
    const test = await fixture();
    const structured = { result: { count: 2, files: ['中文.txt', 'a.txt'] } };
    test.connection.raw
      .prepare(
        "INSERT INTO message (id, thread_id, role, sequence, blocks_json, created_at) VALUES (?, ?, 'assistant', 1, ?, ?)",
      )
      .run(
        'message-a',
        scope.threadId,
        JSON.stringify([{ type: 'tool-result', payload: structured }]),
        now,
      );
    const reference: ContentReference = {
      source: 'message',
      id: 'message-a',
      path: ['blocks', 0, 'payload'],
    };
    const chunk = test.reader.read(scope, { reference });
    expect(chunk.format).toBe('json');
    expect(JSON.parse(chunk.text)).toEqual(structured);
    expect(() =>
      test.reader.read({ ...scope, threadId: 'other' as ThreadId }, { reference }),
    ).toThrow('content.not-found');
  });

  it('rejects stale timeline versions rather than mixing pages from different outputs', async () => {
    const test = await fixture();
    const original = 'x'.repeat(50000);
    test.timeline.upsertSegments(
      runId,
      [
        {
          id: 'segment-a',
          sequence: 1,
          value: { id: 'segment-a', kind: 'tool', output: original },
        },
      ],
      now,
    );
    const reference: ContentReference = {
      source: 'timeline',
      id: 'segment-a',
      runId,
      path: ['output'],
    };
    const first = test.reader.read(scope, { reference, limit: 256 });
    test.timeline.upsertSegments(
      runId,
      [
        {
          id: 'segment-a',
          sequence: 1,
          value: { id: 'segment-a', kind: 'tool', output: 'y' + original.slice(1) },
        },
      ],
      now,
    );
    expect(() =>
      test.reader.read(scope, { reference, offset: first.nextOffset, version: first.version }),
    ).toThrow('content.version-changed');
    expect(test.reader.read(scope, { reference }).text.startsWith('y')).toBe(true);
  });

  it('never splits surrogate pairs and rejects malformed ranges and inherited paths', async () => {
    const output = 'x'.repeat(255) + '🙂完整' + 'x'.repeat(500);
    const test = await fixture(output);
    const first = test.reader.read(scope, { reference: eventRef, limit: 256 });
    expect(first.nextOffset).toBe(255);
    expect(
      test.reader
        .read(scope, { reference: eventRef, offset: 255, limit: 256 })
        .text.startsWith('🙂'),
    ).toBe(true);
    for (const options of [
      { offset: 256 },
      { offset: -1 },
      { offset: 1.5 },
      { offset: 9999 },
      { limit: 32769 },
      { limit: 0 },
      { version: 'bad' },
    ]) {
      expect(() => test.reader.read(scope, { reference: eventRef, ...options })).toThrow(
        /content.invalid/,
      );
    }
    expect(() =>
      test.reader.read(scope, { reference: { ...eventRef, path: ['result', '__proto__'] } }),
    ).toThrow('content.invalid-reference');
    expect(test.reader.read(scope, { reference: eventRef, offset: output.length }).text).toBe('');
  });
});

const legacyMarker = '\n[... content truncated for durable storage ...]';
function legacyMessage(text: string): Message {
  return {
    id: ('asst-' + runId) as Message['id'],
    threadId: scope.threadId,
    runId,
    role: 'assistant',
    sequence: 1,
    createdAt: now,
    blocks: [{ type: 'text', text: text.slice(0, 180) + legacyMarker }],
  };
}

describe('legacy assistant prose recovery', () => {
  it.each(['root', 'run'])(
    'recovers exact terminal %s prose with an immutable scoped source without rewriting the message',
    async (location) => {
      const test = await fixture();
      const text = '旧历史完整回答🙂'.repeat(10000) + 'END_OF_LEGACY';
      const message = legacyMessage(text);
      const messages = new SqliteMessageStore(test.connection.raw);
      messages.append(message);
      test.events.commitTransition({
        events: [
          test.draft('legacy-terminal', 'run.completed', {
            threadId: scope.threadId,
            ...(location === 'root'
              ? { assistantText: text }
              : {
                  run: {
                    runId,
                    threadId: scope.threadId,
                    assistantText: text,
                    userText: 'PRIVATE_USER',
                  },
                }),
          }),
        ],
      });
      const projected = test.reader.recoverLegacyMessage(message);
      const reference = projected.blocks[0].contentRef?.reference;
      expect(reference).toEqual({
        source: 'event-prose',
        id: 'legacy-terminal',
        path: location === 'root' ? ['assistantText'] : ['run', 'assistantText'],
      });
      expect(projected.blocks[0].contentRef).toMatchObject({
        utf16Length: text.length,
        utf8Bytes: Buffer.byteLength(text),
        format: 'text',
      });
      const first = test.reader.read(scope, { reference: reference! });
      const tail = test.reader.read(scope, {
        reference: reference!,
        offset: text.length - 13,
        version: first.version,
      });
      expect(tail.text).toBe('END_OF_LEGACY');
      expect(messages.getMessage(message.id)?.blocks).toEqual(message.blocks);
      expect(
        test.reader.recoverLegacyMessage({ ...message, id: 'intermediate-round' as Message['id'] }),
      ).toEqual({ ...message, id: 'intermediate-round' });
    },
  );
  it('preserves truncated history when the source is absent or mismatched and enforces terminal uniqueness', async () => {
    const test = await fixture();
    const message = legacyMessage('old'.repeat(1000));
    new SqliteMessageStore(test.connection.raw).append(message);
    expect(test.reader.recoverLegacyMessage(message)).toEqual(message);
    test.events.commitTransition({
      events: [
        test.draft('wrong', 'run.completed', {
          threadId: scope.threadId,
          assistantText: 'different'.repeat(1000),
        }),
      ],
    });
    expect(test.reader.recoverLegacyMessage(message)).toEqual(message);
    expect(() =>
      test.events.commitTransition({
        events: [
          test.draft('later', 'run.completed', {
            threadId: scope.threadId,
            assistantText: 'old'.repeat(1000),
          }),
        ],
      }),
    ).toThrow();
    expect(test.reader.recoverLegacyMessage(message)).toEqual(message);
  });
  it('sanitizes embedded images before describing the recovered source and rejects private or non-terminal paths', async () => {
    const test = await fixture();
    const text = 'answer'.repeat(1000) + 'data:image/png;base64,' + 'A'.repeat(5000) + '结尾';
    const expected =
      'answer'.repeat(1000) + '[embedded image omitted from durable process details]' + '结尾';
    const message = legacyMessage(text);
    new SqliteMessageStore(test.connection.raw).append(message);
    test.events.commitTransition({
      events: [
        test.draft('sanitized', 'run.failed', {
          threadId: scope.threadId,
          assistantText: text,
          run: { threadId: scope.threadId, userText: 'PRIVATE' },
        }),
      ],
    });
    const reference = test.reader.recoverLegacyMessage(message).blocks[0].contentRef!.reference;
    const source = test.reader.read(scope, { reference });
    expect(source.text).toBe(expected);
    expect(source.utf16Length).toBe(expected.length);
    expect(() =>
      test.reader.read(scope, {
        reference: {
          source: 'event-prose',
          id: 'sanitized',
          path: ['run', 'userText'],
        } as ContentReference,
      }),
    ).toThrow('invalid-reference');
    expect(() =>
      test.reader.read(scope, {
        reference: {
          source: 'event-prose',
          id: 'output',
          path: ['assistantText'],
        } as ContentReference,
      }),
    ).toThrow('not-found');
  });
  it('does not attach a source belonging to another thread or a forged run binding', async () => {
    const test = await fixture();
    const message = legacyMessage('answer'.repeat(1000));
    new SqliteMessageStore(test.connection.raw).append(message);
    test.events.commitTransition({
      events: [
        test.draft('other-thread', 'run.completed', {
          threadId: 'thread-other',
          assistantText: 'answer'.repeat(1000),
        }),
      ],
    });
    expect(test.reader.recoverLegacyMessage(message)).toEqual(message);
    expect(() =>
      test.reader.read(scope, {
        reference: {
          source: 'event-prose',
          id: 'other-thread',
          path: ['assistantText'],
        } as ContentReference,
      }),
    ).toThrow('not-found');
    expect(
      test.reader.recoverLegacyMessage({ ...message, runId: 'different-run' as RunId }),
    ).toEqual({ ...message, runId: 'different-run' });
  });
});

it('recovers old compacted canonical text, thinking and tool references before falling back to terminal text', async () => {
  const test = await fixture();
  const text = 'canonical answer'.repeat(20000);
  const thinking = 'canonical thought'.repeat(10000);
  const output = 'canonical tool'.repeat(10000);
  const source = [
    { id: 'answer', sequence: 2, kind: 'text', phase: 'final_answer', status: 'completed', text },
    { id: 'thinking', sequence: 0, kind: 'thinking', status: 'completed', text: thinking },
    {
      id: 'tool',
      sequence: 1,
      kind: 'tool',
      toolCallId: 'tool-call',
      name: 'read_file',
      status: 'completed',
      output,
    },
  ];
  test.timeline.upsertSegments(
    runId,
    source.map((value) => ({ id: value.id, sequence: value.sequence, value })),
  );
  const message = legacyMessage(text);
  message.blocks.unshift({
    type: 'commentary',
    payload: {
      assistantTimeline: source.map((segment) => ({
        ...segment,
        ...(segment.text ? { text: segment.text.slice(0, 180) + legacyMarker } : {}),
        ...(segment.output ? { output: segment.output.slice(0, 180) + legacyMarker } : {}),
      })),
    },
  });
  new SqliteMessageStore(test.connection.raw).append(message);
  const recovered = test.reader.recoverLegacyMessage(message);
  const timeline = (
    recovered.blocks[0].payload as { assistantTimeline: Array<Record<string, unknown>> }
  ).assistantTimeline;
  expect(timeline[0].textRef).toMatchObject({
    reference: { source: 'timeline', runId, id: 'answer', path: ['text'] },
    utf16Length: text.length,
  });
  expect(timeline[1].textRef).toMatchObject({
    reference: { source: 'timeline', runId, id: 'thinking', path: ['text'] },
    utf16Length: thinking.length,
  });
  expect(timeline[2].outputRef).toMatchObject({
    reference: { source: 'timeline', runId, id: 'tool', path: ['output'] },
    utf16Length: output.length,
  });
  expect(recovered.blocks[1].contentRef?.reference).toMatchObject({
    source: 'timeline',
    id: 'answer',
  });
  expect(
    (message.blocks[0].payload as { assistantTimeline: unknown }).assistantTimeline,
  ).not.toEqual(timeline);
});

describe('prepared full-source reads', () => {
  it('prepares a source once for consecutive chunks and invalidates on same-connection changes', async () => {
    const text = 'complete source'.repeat(10000);
    const test = await fixture(text);
    const prepare = vi.spyOn(
      test.reader as unknown as { readSource(scope: unknown, reference: unknown): unknown },
      'readSource',
    );
    const first = test.reader.read(scope, { reference: eventRef });
    test.reader.read(scope, {
      reference: eventRef,
      offset: first.nextOffset,
      version: first.version,
    });
    expect(prepare).toHaveBeenCalledTimes(1);
    test.connection.raw
      .prepare('UPDATE event SET payload_json = ? WHERE id = ?')
      .run(JSON.stringify({ threadId: scope.threadId, result: 'changed' }), 'output');
    expect(() => test.reader.read(scope, { reference: eventRef, version: first.version })).toThrow(
      'version-changed',
    );
    expect(test.reader.read(scope, { reference: eventRef }).text).toBe('changed');
  });
  it('invalidates cached data for external commits and a commit racing a cached read', async () => {
    const test = await fixture('first');
    const writer = await openDatabaseAsync({ path: join(test.directory, 'content.db') });
    try {
      const first = test.reader.read(scope, { reference: eventRef });
      writer.raw
        .prepare('UPDATE event SET payload_json = ? WHERE id = ?')
        .run(JSON.stringify({ threadId: scope.threadId, result: 'second' }), 'output');
      expect(() =>
        test.reader.read(scope, { reference: eventRef, version: first.version }),
      ).toThrow('version-changed');
      expect(test.reader.read(scope, { reference: eventRef }).text).toBe('second');
      const original = (
        test.reader as unknown as { assertScope(scope: unknown): void }
      ).assertScope.bind(test.reader);
      vi.spyOn(
        test.reader as unknown as { assertScope(scope: unknown): void },
        'assertScope',
      ).mockImplementationOnce((current) => {
        original(current);
        writer.raw
          .prepare('UPDATE event SET payload_json = ? WHERE id = ?')
          .run(JSON.stringify({ threadId: scope.threadId, result: 'third' }), 'output');
      });
      expect(test.reader.read(scope, { reference: eventRef }).text).toBe('third');
    } finally {
      writer.raw.close();
    }
  });
  it('never publishes uncommitted cached content after an outer transaction rolls back', async () => {
    const test = await fixture('original');
    test.reader.read(scope, { reference: eventRef });
    expect(() =>
      test.connection.raw.transaction(() => {
        test.connection.raw
          .prepare('UPDATE event SET payload_json = ? WHERE id = ?')
          .run(JSON.stringify({ threadId: scope.threadId, result: 'uncommitted' }), 'output');
        expect(test.reader.read(scope, { reference: eventRef }).text).toBe('uncommitted');
        throw new Error('rollback fixture');
      })(),
    ).toThrow('rollback fixture');
    expect(test.reader.read(scope, { reference: eventRef }).text).toBe('original');
  });
  it('rechecks source ownership after mutation instead of serving a previously cached private result', async () => {
    const test = await fixture('private');
    test.reader.read(scope, { reference: eventRef });
    test.connection.raw
      .prepare('UPDATE event SET payload_json = ? WHERE id = ?')
      .run(JSON.stringify({ threadId: 'other-thread', result: 'private' }), 'output');
    expect(() => test.reader.read(scope, { reference: eventRef })).toThrow('not-found');
  });
});

it('invalidates prepared sources after same-connection schema changes', async () => {
  const test = await fixture('content');
  const load = vi.spyOn(
    test.reader as unknown as { readSource(scope: unknown, reference: unknown): unknown },
    'readSource',
  );
  test.reader.read(scope, { reference: eventRef });
  test.connection.raw.exec('CREATE TABLE cache_schema_fixture (id INTEGER)');
  test.reader.read(scope, { reference: eventRef });
  expect(load).toHaveBeenCalledTimes(2);
});

it('does not rescan or downgrade already referenced canonical message previews', async () => {
  const test = await fixture();
  const text = 'canonical'.repeat(1000);
  const message = legacyMessage(text);
  const reference = {
    reference: { source: 'timeline', runId, id: 'answer', path: ['text'] },
    utf16Length: text.length,
    utf8Bytes: Buffer.byteLength(text),
    format: 'text',
  };
  message.blocks[0].payload = { contentRef: reference };
  message.blocks.unshift({
    type: 'commentary',
    payload: {
      assistantTimeline: [
        {
          id: 'answer',
          kind: 'text',
          phase: 'final_answer',
          sequence: 1,
          text: text.slice(0, 180) + legacyMarker,
          textRef: reference,
        },
      ],
    },
  });
  new SqliteMessageStore(test.connection.raw).append(message);
  const prepare = vi.spyOn(test.connection.raw, 'prepare');
  expect(test.reader.recoverLegacyMessage(message)).toBe(message);
  expect(prepare).not.toHaveBeenCalled();
});
