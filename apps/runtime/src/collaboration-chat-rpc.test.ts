import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeFrames, type Frame } from '@sync-think/protocol';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteConversationStore,
  SqliteEventCheckpointStore,
  SqliteGlobalAgentStore,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
import type { AgentId, ModelId, WorkspaceId } from '@sync-think/shared';
import { Runtime } from './runtime.js';

async function fixture(withHost = true) {
  const directory = mkdtempSync(join(tmpdir(), 'sync-think-collaboration-rpc-'));
  const connection = await (async () => {
    const path = join(directory, 'test.db');
    await runMigrations(path);
    return openDatabaseAsync({ path });
  })();
  const workspaceStore = new SqliteWorkspaceStore(connection.raw);
  const workspace = workspaceStore.createWorkspace({ id: 'rpc-workspace' as WorkspaceId, name: 'RPC' });
  const agents = new SqliteGlobalAgentStore(connection.raw);
  const agent = agents.create({ id: 'rpc-agent' as AgentId, name: '研究员', defaultModelId: 'fixture-model' as ModelId });
  const conversationStore = new SqliteConversationStore(connection.raw);
  const runtime = new Runtime({
    installId: 'collaboration-rpc-fixture',
    allowNoToken: true,
    stateStore: new SqliteEventCheckpointStore(connection.raw),
    workspaceStore,
    conversationStore,
    ...(withHost
      ? {
          collaborationChatHost: new (await import('./collaboration-chat-host.js')).CollaborationChatHost(
            new (await import('@sync-think/storage')).SqliteCollaborationStore(connection.raw),
            { ownerId: 'rpc', conversations: conversationStore, agents, workspaces: workspaceStore,
              execute: async ({ task }) => ({ output: task.title }), onChanged: () => {} },
          ),
        }
      : {}),
  });
  const request = (payload: unknown): Promise<Frame> => new Promise((resolve) => {
    (runtime as unknown as { handlers: { onFrame(socket: { write(data: Buffer): boolean }, frame: Frame): void } }).handlers.onFrame(
      { write: (data) => { resolve(decodeFrames(data).frames[0]!); return true; } },
      { id: 'rpc-1', kind: 'request', type: 'collaboration.command', payload },
    );
  });
  const close = async () => { await runtime.stop(); connection.raw.close(); rmSync(directory, { recursive: true, force: true }); };
  return { workspace, agent, request, close };
}

describe('collaboration command RPC boundary', () => {
  it('returns an explicit error when collaboration is not configured', async () => {
    const f = await fixture(false);
    try {
      const response = await f.request({ action: 'get', conversationId: 'missing' });
      expect(response.error?.message).toBe('Collaboration chat is not configured');
    } finally { await f.close(); }
  });

  it('rejects malformed collaboration payloads at the pipe boundary', async () => {
    const f = await fixture();
    try {
      const response = await f.request({ action: 'dispatch', conversationId: 'missing', tasks: [] });
      expect(response.error?.message).toContain('Invalid payload');
    } finally { await f.close(); }
  });

  it('creates and reads a direct collaboration conversation through Runtime', async () => {
    const f = await fixture();
    try {
      const created = await f.request({ action: 'create', clientRequestId: 'create-1', kind: 'direct', title: '研究', workspaceId: f.workspace.id, agentIds: [f.agent.id] });
      expect(created.error).toBeUndefined();
      const conversationId = (created.payload as { snapshot: { conversation: { id: string } } }).snapshot.conversation.id;
      const read = await f.request({ action: 'get', conversationId });
      expect((read.payload as { snapshot: { conversation: { id: string } } }).snapshot.conversation.id).toBe(conversationId);
      const dispatched = await f.request({ action: 'dispatch', clientRequestId: 'dispatch-1', conversationId,
        tasks: [{ assigneeMemberId: `agent:${f.agent.id}`, title: '查询资料', instructions: '整理三条要点' }] });
      expect(dispatched.error).toBeUndefined();
      expect((dispatched.payload as { snapshot: { tasks: unknown[] } }).snapshot.tasks).toHaveLength(1);
    } finally { await f.close(); }
  });

  it('creates a direct conversation with the selected agent as coordinator', async () => {
    const f = await fixture();
    try {
      const created = await f.request({ action: 'create', clientRequestId: 'create-2', kind: 'group', title: '群组', workspaceId: f.workspace.id, agentIds: [f.agent.id, f.agent.id + '-other'] });
      // The fixture only provisions one effective agent, so exercise the
      // direct path directly and assert its stable coordinator identity.
      expect(created.error?.message).toContain('agent_unavailable');
      const direct = await f.request({ action: 'create', clientRequestId: 'create-3', kind: 'direct', title: '单聊', workspaceId: f.workspace.id, agentIds: [f.agent.id] });
      const snapshot = (direct.payload as { snapshot: { conversation: { coordinatorMemberId: string } } }).snapshot;
      expect(snapshot.conversation.coordinatorMemberId).toBe(`agent:${f.agent.id}`);
    } finally { await f.close(); }
  });
});
