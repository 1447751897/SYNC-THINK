import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { openDatabaseAsync, runMigrations, SqliteCollaborationStore, SqliteWorkspaceStore, SqliteConversationStore, SqliteGlobalAgentStore } from '@sync-think/storage';
import { XorDevBackend } from '@sync-think/secure-store';
import type { AgentId, ModelId } from '@sync-think/shared';
import { CollaborationChatHost } from './collaboration-chat-host.js';
import { openPersistentRuntime } from './persistence.js';

it('a scheduled worker never recovers or pauses another process live group run', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'collaboration-worker-isolation-'));
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw Error('outside temp');
  const path = join(directory, 'state.db'); await runMigrations(path);
  const db = await openDatabaseAsync({ path });
  const repository = new SqliteCollaborationStore(db.raw);
  const workspaces = new SqliteWorkspaceStore(db.raw);
  const conversations = new SqliteConversationStore(db.raw);
  const agents = new SqliteGlobalAgentStore(db.raw);
  const workspace = workspaces.createWorkspace({ name: 'live', folderPath: directory });
  const agent = agents.create({ id: 'writer' as AgentId, name: 'writer', defaultModelId: 'fake-mini' as ModelId });
  const host = new CollaborationChatHost(repository, { ownerId: 'same-install', conversations, agents, workspaces, onChanged() {}, execute: () => Promise.resolve({ output: '' }) });
  try {
    const room = host.command({ action: 'create', clientRequestId: 'room', kind: 'group', title: 'live', workspaceId: workspace.id, agentIds: [agent.id] }).snapshot!;
    host.command({ action: 'dispatch', conversationId: room.conversation.id, clientRequestId: 'work', tasks: [{ assigneeMemberId: room.conversation.coordinatorMemberId!, purpose: 'coordination', title: 'live run', instructions: 'work' }] });
    await host.service.stop();
    const snapshot = repository.read(room.conversation.id)!; snapshot.revision++;
    snapshot.attempts[0].status = 'running'; snapshot.attempts[0].ownerId = 'same-install'; snapshot.attempts[0].output = 'live progress';
    snapshot.conversation.room!.state = 'running'; repository.save(snapshot);
    const before = repository.read(room.conversation.id)!;
    const worker = await openPersistentRuntime({ dbPath: path, installId: 'same-install', daemonWorker: true, secureStoreBackend: new XorDevBackend(join(directory, 'vault')) });
    try { await worker.runtime.start(); expect(repository.read(room.conversation.id)).toEqual(before); }
    finally { await worker.close(); }
    expect(repository.read(room.conversation.id)).toEqual(before);
    const managed = await openPersistentRuntime({ dbPath: path, installId: 'same-install', secureStoreBackend: new XorDevBackend(join(directory, 'vault')) });
    try {
      expect(repository.read(room.conversation.id)!.attempts[0]).toMatchObject({ status: 'interrupted', error: { code: 'owner_lost' } });
      expect(repository.read(room.conversation.id)!.conversation.room!.state).toBe('paused');
    } finally { await managed.close(); }
  } finally { await host.service.stop(); db.raw.close(); rmSync(directory, { recursive: true, force: true }); }
}, 20000);
