import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeProvider, type AdapterEvent, type ProviderCallRequest } from '@sync-think/adapters';
import {
  openDatabaseAsync, runMigrations, SqliteCollaborationStore, SqliteConversationStore,
  SqliteEventCheckpointStore, SqliteGlobalAgentStore, SqliteWorkspaceStore,
} from '@sync-think/storage';
import type { AgentId, CollaborationSnapshot, ConversationId, KernelRequest, ModelId, WorkspaceId } from '@sync-think/shared';
import type { DemoRunState } from './demo-run.js';
import type { CollaborationExecutionInput } from './collaboration-chat-service.js';
import { CollaborationChatHost } from './collaboration-chat-host.js';
import { Runtime } from './runtime.js';
import { ensureTaskRoomDirectory } from './task-room.js';

class WorkspaceProvider extends FakeProvider {
  script: Array<{ name: string; args: object }> = [];
  requests: ProviderCallRequest[] = [];
  results: string[] = [];
  onRequest?: () => Promise<void>;

  override async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    const round = this.requests.length;
    this.requests.push(request);
    const last = request.messages.at(-1);
    if (last?.role === 'tool') this.results.push(String(last.content));
    if (!round) await this.onRequest?.();
    const tool = this.script[round];
    if (tool) {
      yield { type: 'tool-call', toolCall: { id: 'workspace-tool-' + round, name: tool.name, argumentsJson: JSON.stringify(tool.args) } };
    } else {
      yield { type: 'assistant-message-delta', phase: 'final_answer', text: '已核对工作区。' };
    }
    yield { type: 'finished', reason: tool ? 'tool-requests' : 'stop' };
  }
}

async function fixture() {
  const directory = realpathSync.native(mkdtempSync(join(tmpdir(), 'collaboration-workspace-')));
  const path = join(directory, 'state.db');
  await runMigrations(path);
  const db = await openDatabaseAsync({ path });
  const workspaces = new SqliteWorkspaceStore(db.raw);
  const folders = ['project-a', 'project-b'].map(name => join(directory, name));
  const projects = folders.map((folderPath, index) => {
    mkdirSync(join(folderPath, 'assets'), { recursive: true });
    writeFileSync(join(folderPath, 'assets', 'track.txt'), '素材来自项目 ' + index);
    return workspaces.createWorkspace({ name: '项目 ' + index, folderPath });
  });
  const agents = new SqliteGlobalAgentStore(db.raw);
  const agent = agents.create({ id: 'workspace-writer' as AgentId, name: '视觉导演', defaultModelId: 'fake-mini' as ModelId, writePolicy: 'inherit' });
  const conversations = new SqliteConversationStore(db.raw);
  const provider = new WorkspaceProvider();
  const host = new CollaborationChatHost(new SqliteCollaborationStore(db.raw), {
    ownerId: 'workspace-binding-test', conversations, agents, workspaces,
    execute: async () => ({ output: '' }), onChanged() {},
  });
  const runtime = new Runtime({
    installId: 'workspace-binding-test', allowNoToken: true,
    projectlessDataDirectory: join(directory, 'projectless'),
    workspaceStore: workspaces, conversationStore: conversations, globalAgentStore: agents,
    stateStore: new SqliteEventCheckpointStore(db.raw), collaborationChatHost: host, demoProvider: provider,
  });
  let sequence = 0;
  function createRoom(workspaceId?: WorkspaceId) {
    return host.command({ action: 'create', clientRequestId: 'room-' + ++sequence,
      kind: 'group', title: '视频制作', workspaceId, agentIds: [agent.id] }).snapshot!;
  }
  async function execute(room: CollaborationSnapshot, script: WorkspaceProvider['script'], kind: 'discussion' | 'file' | 'document' = 'discussion') {
    const now = new Date().toISOString();
    const id = 'workspace-assignment-' + ++sequence;
    const actor = room.conversation.coordinatorMemberId!;
    const task: CollaborationExecutionInput['task'] = {
      id, rootTaskId: id, originMessageId: 'request-' + id, assigneeMemberId: actor,
      title: '使用工作区素材', instructions: '核对当前工作区已有素材并按要求交付。', expectedOutput: '',
      dependsOnTaskIds: [], contextRefs: [], resourceClaims: [],
      returnTo: { conversationId: room.conversation.id, replyToMessageId: 'request-' + id },
      timeoutSeconds: 120, currentAttemptId: 'attempt-' + id, createdAt: now,
      kind: kind === 'discussion' ? 'reply' : 'task', purpose: kind === 'discussion' ? 'discussion' : 'work',
      ...(kind === 'file' ? { deliverable: { kind: 'file' as const, title: '制作方案', path: 'plan.md' } }
        : kind === 'document' ? { deliverable: { kind: 'document' as const, title: '制作方案' } } : {}),
    };
    const attempt: CollaborationExecutionInput['attempt'] = {
      id: task.currentAttemptId, taskId: id, number: 1, status: 'running', threadId: 'thread-' + id,
      startedAt: now, updatedAt: now, contextSequence: 0, output: '', resourceClaims: [], tools: [], checklist: [],
    };
    const snapshot = structuredClone(room);
    snapshot.tasks.push(task);
    snapshot.attempts.push(attempt);
    snapshot.revision++;
    host.repository.save(snapshot);
    if (kind !== 'discussion') conversations.setExecutionMode(room.conversation.id as ConversationId, 'full-access');
    provider.script = script;
    provider.requests = [];
    provider.results = [];
    let kernelRequest: KernelRequest | undefined;
    const externalKernelRequests: KernelRequest[] = [];
    provider.onRequest = async () => {
      const internal = runtime as unknown as {
        demoRuns: Map<string, DemoRunState>;
        buildKernelRequestForRun(run: DemoRunState): Promise<KernelRequest>;
      };
      const run = [...internal.demoRuns.values()].find(run => run.threadId === attempt.threadId)!;
      kernelRequest = await internal.buildKernelRequestForRun(run);
      for (const kernelId of ['codex', 'claude-code']) {
        externalKernelRequests.push(await internal.buildKernelRequestForRun({ ...run, kernelId }));
      }
    };
    const result = await runtime.executeCollaborationTaskForHost({ snapshot, task, attempt, signal: new AbortController().signal, onProgress() {} });
    return { result, kernelRequest, externalKernelRequests, requests: [...provider.requests], results: [...provider.results], task, attempt };
  }
  return { directory, folders, projects, workspaces, conversations, host, createRoom, execute,
    close: async () => { await runtime.stop(); db.raw.close(); rmSync(directory, { recursive: true, force: true }); } };
}

describe('group workspace binding', () => {
  it('reads existing project assets and uses the bound workspace for native and external kernel requests', async () => {
    const f = await fixture();
    try {
      const a = f.createRoom(f.projects[0].id);
      const b = f.createRoom(f.projects[1].id);
      const anotherA = f.createRoom(f.projects[0].id);
      // A pre-existing room directory must not override the persisted project binding.
      writeFileSync(join(ensureTaskRoomDirectory(f.folders[0], a.conversation.id), 'legacy-draft.md'), '原群聊草稿');
      const claimKeys: string[] = [];
      for (const [room, index] of [[a, 0], [b, 1], [anotherA, 0]] as const) {
        expect(room.conversation.workspaceId).toBe(f.projects[index].id);
        const conversation = f.conversations.get(room.conversation.id)!;
        expect(conversation.workspaceId).toBe(f.projects[index].id);
        expect(f.workspaces.getTask(conversation.taskId!)?.workspaceId).toBe(f.projects[index].id);
        const executed = await f.execute(room, [
          { name: 'list_files', args: { path: 'assets' } },
          { name: 'read_file', args: { path: 'assets/track.txt' } },
        ]);
        expect(executed.result.error).toBeUndefined();
        expect(executed.results[0]).toContain('track.txt');
        expect(executed.results[1]).toContain('素材来自项目 ' + index);
        expect(executed.requests[0].systemPrompt).toContain('Project folder: ' + f.folders[index]);
        expect(executed.kernelRequest?.workspaceDir).toBe(f.folders[index]);
        expect(executed.kernelRequest?.systemContext).toContain('Project folder: ' + f.folders[index]);
        expect(executed.externalKernelRequests.map(request => request.kernelId)).toEqual(['codex', 'claude-code']);
        for (const request of executed.externalKernelRequests) {
          expect(request.workspaceDir).toBe(f.folders[index]);
          expect(request.systemContext).toContain('Project folder: ' + f.folders[index]);
        }
        claimKeys.push(f.host.resourceClaims(room, executed.task)[0].key);
        expect(executed.requests[0].tools?.some(tool => tool.name === 'write_file')).toBe(false);
      }
      expect(claimKeys[0]).toBe(claimKeys[2]);
      expect(claimKeys[0]).not.toBe(claimKeys[1]);
    } finally { await f.close(); }
  });

  it('updates the contracted project file while storing immutable versions inside the current room', async () => {
    const f = await fixture();
    try {
      const room = f.createRoom(f.projects[0].id);
      writeFileSync(join(f.folders[0], 'plan.md'), '旧方案');
      const executed = await f.execute(room, [
        { name: 'read_file', args: { path: 'plan.md' } },
        { name: 'write_file', args: { path: 'plan.md', content: '使用 assets 中已有音频的新方案' } },
        { name: 'collaboration_submit_artifact', args: {} },
      ], 'file');
      expect(executed.result.error).toBeUndefined();
      expect(executed.results[0]).toContain('旧方案');
      const otherRoom = f.createRoom(f.projects[0].id);
      const writerClaim = f.host.resourceClaims(room, executed.task)[0];
      const readerClaim = f.host.resourceClaims(otherRoom, { ...executed.task, kind: 'reply', purpose: 'discussion' })[0];
      expect(writerClaim.mode).toBe('write');
      expect(readerClaim.mode).toBe('read');
      expect(writerClaim.key).toBe(readerClaim.key);
      expect(readFileSync(join(f.folders[0], 'plan.md'), 'utf8')).toBe('使用 assets 中已有音频的新方案');
      const artifact = executed.result.artifacts?.[0];
      expect(artifact?.path).toBe('plan.md');
      expect(artifact?.storedPath).toBeTruthy();
      expect(relative(ensureTaskRoomDirectory(f.folders[0], room.conversation.id), artifact!.storedPath!)).toMatch(/^\.artifacts[\\/]/);
      writeFileSync(join(f.folders[0], 'plan.md'), '后续方案');
      expect(readFileSync(artifact!.storedPath!, 'utf8')).toBe('使用 assets 中已有音频的新方案');
    } finally { await f.close(); }
  });

  it('rejects an unchanged file from the bound project instead of treating it as a new room file', async () => {
    const f = await fixture();
    try {
      const room = f.createRoom(f.projects[0].id);
      writeFileSync(join(f.folders[0], 'plan.md'), '已有项目方案');
      const executed = await f.execute(room, [{ name: 'collaboration_submit_artifact', args: {} }], 'file');
      expect(executed.result.error).toBeUndefined();
      expect(executed.results[0]).toContain('collaboration.artifact_unchanged');
      expect(executed.result.artifacts).toEqual([]);
      expect(readFileSync(join(f.folders[0], 'plan.md'), 'utf8')).toBe('已有项目方案');
    } finally { await f.close(); }
  });

  it('keeps document archives separate for rooms sharing a project', async () => {
    const f = await fixture();
    try {
      const storedPaths: string[] = [];
      for (const content of ['甲群方案', '乙群方案']) {
        const room = f.createRoom(f.projects[0].id);
        const executed = await f.execute(room, [{ name: 'collaboration_submit_artifact', args: { content } }], 'document');
        expect(executed.result.error).toBeUndefined();
        const storedPath = executed.result.artifacts?.[0]?.storedPath;
        expect(storedPath).toBeTruthy();
        expect(relative(ensureTaskRoomDirectory(f.folders[0], room.conversation.id), storedPath!)).toMatch(/^\.artifacts[\\/]/);
        expect(readFileSync(storedPath!, 'utf8')).toBe(content);
        storedPaths.push(storedPath!);
      }
      expect(storedPaths[0]).not.toBe(storedPaths[1]);
    } finally { await f.close(); }
  });

  it('retains managed storage for a group created without a workspace', async () => {
    const f = await fixture();
    try {
      const room = f.createRoom();
      expect(f.conversations.get(room.conversation.id)?.workspaceId).toBeUndefined();
      const executed = await f.execute(room, [{ name: 'collaboration_submit_artifact', args: { content: '独立群聊方案' } }], 'document');
      expect(executed.result.error).toBeUndefined();
      const root = executed.kernelRequest?.workspaceDir;
      expect(root).toBeTruthy();
      expect(root).not.toContain('task-rooms');
      expect(relative(join(f.directory, 'projectless'), root!)).not.toMatch(/^\.\./);
      const storedPath = executed.result.artifacts?.[0]?.storedPath;
      expect(storedPath).toBeTruthy();
      expect(readFileSync(storedPath!, 'utf8')).toBe('独立群聊方案');
    } finally { await f.close(); }
  });
});
