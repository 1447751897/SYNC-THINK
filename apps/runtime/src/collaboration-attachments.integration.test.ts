import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { FakeProvider, type AdapterEvent, type ProviderCallRequest } from '@sync-think/adapters';
import { decodeFrames, type Frame } from '@sync-think/protocol';
import { openDatabaseAsync, runMigrations, SqliteCollaborationStore, SqliteConversationStore, SqliteEventCheckpointStore, SqliteGlobalAgentStore, SqliteWorkspaceStore } from '@sync-think/storage';
import type { AgentId, CollaborationSnapshot, ModelId } from '@sync-think/shared';
import { Runtime } from './runtime.js';
import { CollaborationChatHost } from './collaboration-chat-host.js';
class AttachmentProvider extends FakeProvider {
  requests: ProviderCallRequest[] = [];
  override async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.requests.push(request);
    yield { type: 'assistant-message-delta', phase: 'final_answer', text: '已收到图片和音频文件。' };
    yield { type: 'finished', reason: 'stop' };
  }
}
it.each([false, true])('persists actual user attachments, forwards images, and retries without re-importing removed sources (projectless=%s)', async projectless => {
  const directory = realpathSync.native(mkdtempSync(join(tmpdir(), 'group-media-e2e-')));
  const path = join(directory, 'state.db'); await runMigrations(path);
  const db = await openDatabaseAsync({ path });
  const workspaces = new SqliteWorkspaceStore(db.raw);
  const root = join(directory, 'project'); mkdirSync(root);
  const workspace = workspaces.createWorkspace({ name: '视频生成', folderPath: root });
  const agents = new SqliteGlobalAgentStore(db.raw);
  const agent = agents.create({ id: 'director' as AgentId, name: '视觉导演', defaultModelId: 'fake-mini' as ModelId });
  const conversations = new SqliteConversationStore(db.raw);
  const repository = new SqliteCollaborationStore(db.raw);
  const provider = new AttachmentProvider();
  const host: CollaborationChatHost = new CollaborationChatHost(repository, { ownerId: 'media-test', conversations, workspaces, agents,
    execute: input => runtime.executeCollaborationTaskForHost(input), onChanged() {} });
  const runtime: Runtime = new Runtime({ installId: 'media-test', allowNoToken: true, projectlessDataDirectory: join(directory, 'projectless'),
    workspaceStore: workspaces, conversationStore: conversations, globalAgentStore: agents, collaborationChatHost: host,
    stateStore: new SqliteEventCheckpointStore(db.raw), demoProvider: provider });
  const request = (payload: unknown): Frame => {
    let response: Frame | undefined;
    (runtime as unknown as { handleCollaborationCommand(socket: object, frame: Frame): void }).handleCollaborationCommand(
      { write(bytes: Buffer) { response = decodeFrames(bytes).frames[0]; } }, { id: 'media-rpc', kind: 'request', type: 'collaboration.command', payload });
    return response!;
  };
  try {
    const created = request({ action: 'create', clientRequestId: 'create', kind: 'group', title: '视频小队', ...(projectless ? {} : { workspaceId: workspace.id }), agentIds: [agent.id] });
    expect(created.error).toBeUndefined();
    const room = (created.payload as { snapshot: CollaborationSnapshot }).snapshot;
    const source = join(directory, 'song.mp3'); writeFileSync(source, 'actual audio bytes');
    const command = { action: 'send', conversationId: room.conversation.id, clientRequestId: 'media-send', text: '',
      images: [{ id: 'cover-id', name: 'cover.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }],
      files: [{ path: source, name: 'song.mp3', mimeType: 'audio/mpeg' }] };
    expect(request(command).error).toBeUndefined();
    await vi.waitFor(() => expect(repository.read(room.conversation.id)?.attempts.every(a => a.status === 'succeeded')).toBe(true), { timeout: 10000 });
    expect(provider.requests.length).toBeGreaterThan(0);
    expect(JSON.stringify(provider.requests)).toContain('data:image/png;base64,');
    expect(provider.requests[0].systemPrompt).toContain('song.mp3');
    const persisted = repository.read(room.conversation.id)!;
    const message = persisted.messages.find(m => m.senderMemberId === 'user:local')!;
    expect(message.blocks.map(b => b.type)).toEqual(['image', 'file']);
    const image = message.blocks[0].payload as { stagingPath: string };
    const file = message.blocks[1].payload as { path: string };
    expect(readFileSync(image.stagingPath).length).toBe(8);
    const effectiveRoot = provider.requests[0].systemPrompt!.match(/^Project folder: (.+)$/m)![1];
    expect(readFileSync(join(effectiveRoot, file.path), 'utf8')).toBe('actual audio bytes');
    rmSync(source);
    expect(request(command).error).toBeUndefined();
    expect(repository.read(room.conversation.id)!.messages.filter(m => m.senderMemberId === 'user:local')).toHaveLength(1);
    expect(request({ ...command, text: 'changed request' }).error?.message).toContain('idempotency_conflict');
  } finally { await runtime.stop(); db.raw.close(); rmSync(directory, { recursive: true, force: true }); }
}, 15000);
