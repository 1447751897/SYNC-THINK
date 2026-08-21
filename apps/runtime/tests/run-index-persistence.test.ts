import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabaseAsync, SqliteRunIndexStore } from '@sync-think/storage';
import { ulid, type EventId, type WorkspaceId } from '@sync-think/shared';
import { openPersistentRuntime } from '../src/persistence.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function newInstallId(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function makeDir(): { dir: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-run-index-'));
  tempDirs.push(dir);
  return { dir, dbPath: join(dir, 'sync-think.db') };
}

async function openSession(dir: string, dbPath: string, installId: string) {
  return openPersistentRuntime({
    dbPath,
    installId,
    allowNoToken: true,
    secureStoreKeyPath: join(dir, 'secure-store', 'test-key.bin'),
  });
}

/** Commits a durable event through the Runtime's own persistence path. */
function commitEvent(
  session: Awaited<ReturnType<typeof openPersistentRuntime>>,
  input: {
    type: string;
    runId: string;
    occurredAt: string;
    payload: Record<string, unknown>;
    workspaceId?: string;
  },
): void {
  const runtime = session.runtime as unknown as {
    persistProjectedEvent: (draft: unknown, runs: Map<string, unknown>) => unknown;
    demoRuns: Map<string, unknown>;
    workspaceId: string;
  };
  runtime.persistProjectedEvent(
    {
      id: ulid() as EventId,
      workspaceId: (input.workspaceId ?? runtime.workspaceId) as WorkspaceId,
      runId: input.runId,
      category: 'run',
      type: input.type,
      occurredAt: input.occurredAt,
      payload: input.payload,
    },
    new Map(runtime.demoRuns),
  );
}

async function readIndex(dbPath: string) {
  const connection = await openDatabaseAsync({ path: dbPath });
  const store = new SqliteRunIndexStore(connection.raw);
  return { store, close: () => connection.raw.close() };
}

describe('run_index projection through the persistent runtime', () => {
  it('records a run lifecycle from started through completed', async () => {
    const { dir, dbPath } = makeDir();
    const session = await openSession(dir, dbPath, newInstallId('run-index-lifecycle'));
    try {
      commitEvent(session, {
        type: 'run.started',
        runId: 'run-lifecycle',
        occurredAt: '2026-08-21T00:00:00.000Z',
        payload: { threadId: 'conv-1', kernelId: 'codex', modelId: 'gpt-5' },
      });
      commitEvent(session, {
        type: 'run.completed',
        runId: 'run-lifecycle',
        occurredAt: '2026-08-21T00:00:30.000Z',
        payload: { threadId: 'conv-1', reason: 'stop' },
      });
    } finally {
      await session.close();
    }

    const { store, close } = await readIndex(dbPath);
    try {
      const entry = store.get('run-lifecycle');
      expect(entry?.state).toBe('completed');
      expect(entry?.source).toBe('chat');
      expect(entry?.conversationId).toBe('conv-1');
      expect(entry?.kernelId).toBe('codex');
      expect(entry?.startedAt).toBe('2026-08-21T00:00:00.000Z');
      expect(entry?.finishedAt).toBe('2026-08-21T00:00:30.000Z');
    } finally {
      close();
    }
  });

  it('scrubs a provider secret out of the failure message', async () => {
    const { dir, dbPath } = makeDir();
    const session = await openSession(dir, dbPath, newInstallId('run-index-scrub'));
    try {
      commitEvent(session, {
        type: 'run.started',
        runId: 'run-secret',
        occurredAt: '2026-08-21T00:00:00.000Z',
        payload: { threadId: 'conv-1' },
      });
      // The kernel terminal boundary emits raw provider text, so the read model
      // is responsible for scrubbing rather than trusting the emitter.
      commitEvent(session, {
        type: 'run.failed',
        runId: 'run-secret',
        occurredAt: '2026-08-21T00:00:10.000Z',
        payload: {
          threadId: 'conv-1',
          errorMessage: 'auth rejected token sk-liveSECRET0123456789 upstream',
        },
      });
    } finally {
      await session.close();
    }

    const { store, close } = await readIndex(dbPath);
    try {
      const entry = store.get('run-secret');
      expect(entry?.state).toBe('failed');
      expect(entry?.errorMessage).toBeDefined();
      expect(entry?.errorMessage).not.toContain('sk-liveSECRET');
      expect(entry?.errorMessage).toContain('[REDACTED]');
      expect(entry?.failureClass).toBe('unknown');
    } finally {
      close();
    }
  });

  it('closes out runs left running by a previous Runtime on next open', async () => {
    const { dir, dbPath } = makeDir();
    const first = await openSession(dir, dbPath, newInstallId('run-index-crash-a'));
    try {
      // No terminal event: this simulates a Runtime that died mid-run.
      commitEvent(first, {
        type: 'run.started',
        runId: 'run-orphan',
        occurredAt: '2026-08-21T00:00:00.000Z',
        payload: { threadId: 'conv-1', kernelId: 'codex' },
      });
    } finally {
      await first.close();
    }

    const beforeRead = await readIndex(dbPath);
    try {
      expect(beforeRead.store.get('run-orphan')?.state).toBe('running');
    } finally {
      beforeRead.close();
    }

    const second = await openSession(dir, dbPath, newInstallId('run-index-crash-b'));
    try {
      const entry = (
        second.runtime as unknown as { runIndexStore: SqliteRunIndexStore }
      ).runIndexStore.get('run-orphan');
      expect(entry?.state).toBe('failed');
      expect(entry?.failureClass).toBe('interrupted');
      expect(entry?.finishedAt).toBeDefined();
    } finally {
      await second.close();
    }
  });

  it('does not rewrite a run that already reached a terminal state', async () => {
    const { dir, dbPath } = makeDir();
    const first = await openSession(dir, dbPath, newInstallId('run-index-terminal-a'));
    try {
      commitEvent(first, {
        type: 'run.started',
        runId: 'run-done',
        occurredAt: '2026-08-21T00:00:00.000Z',
        payload: { threadId: 'conv-1' },
      });
      commitEvent(first, {
        type: 'run.completed',
        runId: 'run-done',
        occurredAt: '2026-08-21T00:00:05.000Z',
        payload: { threadId: 'conv-1' },
      });
    } finally {
      await first.close();
    }

    const second = await openSession(dir, dbPath, newInstallId('run-index-terminal-b'));
    try {
      const entry = (
        second.runtime as unknown as { runIndexStore: SqliteRunIndexStore }
      ).runIndexStore.get('run-done');
      expect(entry?.state).toBe('completed');
      expect(entry?.failureClass).toBeUndefined();
    } finally {
      await second.close();
    }
  });

  it('lists runs newest first across sources', async () => {
    const { dir, dbPath } = makeDir();
    const session = await openSession(dir, dbPath, newInstallId('run-index-list'));
    try {
      commitEvent(session, {
        type: 'run.started',
        runId: 'run-chat',
        occurredAt: '2026-08-21T00:00:01.000Z',
        payload: { threadId: 'conv-1' },
      });
      commitEvent(session, {
        type: 'run.started',
        runId: 'run-external',
        occurredAt: '2026-08-21T00:00:02.000Z',
        payload: { threadId: 'conv-2', externalEventId: 'evt-1' },
      });
    } finally {
      await session.close();
    }

    const { store, close } = await readIndex(dbPath);
    try {
      const page = store.list();
      expect(page.entries.map((entry) => entry.runId)).toEqual(['run-external', 'run-chat']);
      expect(page.entries[0]?.source).toBe('external');
      expect(page.entries[0]?.externalEventId).toBe('evt-1');
    } finally {
      close();
    }
  });

  it('leaves non-run events out of the read model', async () => {
    const { dir, dbPath } = makeDir();
    const session = await openSession(dir, dbPath, newInstallId('run-index-noise'));
    try {
      commitEvent(session, {
        type: 'run.started',
        runId: 'run-only',
        occurredAt: '2026-08-21T00:00:00.000Z',
        payload: { threadId: 'conv-1' },
      });
      commitEvent(session, {
        type: 'tool.completed',
        runId: 'run-only',
        occurredAt: '2026-08-21T00:00:01.000Z',
        payload: { threadId: 'conv-1' },
      });
    } finally {
      await session.close();
    }

    const { store, close } = await readIndex(dbPath);
    try {
      expect(store.list().entries).toHaveLength(1);
      // The tool event must not have advanced or duplicated the run row.
      expect(store.get('run-only')?.state).toBe('running');
    } finally {
      close();
    }
  });
});
