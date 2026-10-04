import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import { FakeProvider, type AdapterEvent, type ProviderCallRequest } from '@sync-think/adapters';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteCollaborationStore,
  SqliteConversationStore,
  SqliteEventCheckpointStore,
  SqliteGlobalAgentStore,
  SqliteMessageStore,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
import type { AgentId, ModelId } from '@sync-think/shared';
import { Runtime } from './runtime.js';
import { CollaborationChatHost } from './collaboration-chat-host.js';

class GroupProvider extends FakeProvider {
  contributions: string[] = [];
  routingCalls = 0;
  override async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    const prompt = request.systemPrompt ?? '';
    const serialized = JSON.stringify(request);
    let answer: string;
    if (prompt.includes('You are the routing controller of this group')) {
      this.routingCalls++;
      expect(request.tools ?? []).toEqual([]);
      expect(serialized).not.toContain('PRIVATE_NATIVE_CANARY');
      answer = '{"mode":"sequential","memberIds":["agent:b","agent:c","agent:a"]}';
    } else {
      const member = prompt.match(/当前贡献成员ID：([^\n]+)/)?.[1];
      expect(member).toBeTruthy();
      this.contributions.push(member!);
      const names = request.tools?.map((t) => t.name) ?? [];
      expect(names).toContain('collaboration_read_context');
      expect(names).not.toContain('write_file');
      expect(names).not.toContain('collaboration_start_workflow');
      if (member === 'agent:b') {
        expect(serialized).toContain('PRIVATE_NATIVE_CANARY');
        answer = 'B_REAL_PROPOSAL';
      } else if (member === 'agent:c') {
        expect(prompt).toContain('B_REAL_PROPOSAL');
        expect(serialized).not.toContain('PRIVATE_NATIVE_CANARY');
        answer = 'C_REAL_REVIEW';
      } else {
        expect(member).toBe('agent:a');
        expect(prompt).toContain('C_REAL_REVIEW');
        expect(serialized).not.toContain('PRIVATE_NATIVE_CANARY');
        answer = 'A_REAL_SUMMARY';
      }
    }
    yield { type: 'assistant-message-delta', phase: 'final_answer', text: answer };
    yield { type: 'finished', reason: 'stop' };
  }
}

it('runs tool-free routing and ordered real native turns against SQLite with audience-projected context', async () => {
  const prefix = resolve(tmpdir(), 'group-native-planning-');
  const directory = mkdtempSync(prefix);
  const path = join(directory, 'test.db');
  await runMigrations(path);
  const db = await openDatabaseAsync({ path });
  const workspaces = new SqliteWorkspaceStore(db.raw);
  const workspace = workspaces.createWorkspace({ name: 'native group', folderPath: directory });
  const agents = new SqliteGlobalAgentStore(db.raw);
  for (const id of ['a', 'b', 'c'])
    agents.create({
      id: id as AgentId,
      name: id.toUpperCase(),
      defaultModelId: 'fake-mini' as ModelId,
      writePolicy: 'read-only',
    });
  const conversations = new SqliteConversationStore(db.raw);
  const repository = new SqliteCollaborationStore(db.raw);
  const messages = new SqliteMessageStore(db.raw);
  const provider = new GroupProvider();
  const errors: unknown[] = [];
  const host: CollaborationChatHost = new CollaborationChatHost(repository, {
    ownerId: 'native-group',
    conversations,
    agents,
    workspaces,
    messages,
    onChanged: () => {},
    onError: (error) => errors.push(error),
    execute: (input) => runtime.executeCollaborationTaskForHost(input),
  });
  const runtime: Runtime = new Runtime({
    installId: 'native-group-test',
    allowNoToken: true,
    workspaceStore: workspaces,
    conversationStore: conversations,
    messageStore: messages,
    globalAgentStore: agents,
    stateStore: new SqliteEventCheckpointStore(db.raw),
    collaborationChatHost: host,
    demoProvider: provider,
  });
  try {
    const group = host.command({
      action: 'create',
      kind: 'group',
      title: 'native group',
      workspaceId: workspace.id,
      clientRequestId: 'create',
      agentIds: ['a', 'b', 'c'],
      coordinatorAgentId: 'a',
    }).snapshot!;
    const conversationId = group.conversation.id;
    host.command({
      action: 'group-config',
      conversationId,
      clientRequestId: 'description',
      expectedRevision: 0,
      description: 'B先建议，C基于B的实际观点审查，A最后归纳。',
    });
    host.command({
      action: 'send',
      conversationId,
      clientRequestId: 'private',
      text: 'PRIVATE_NATIVE_CANARY',
      recipientMemberIds: ['agent:b'],
      visibility: 'private',
      deliveryMode: 'notify',
    });
    host.command({
      action: 'send',
      conversationId,
      clientRequestId: 'discussion',
      text: '按本群描述依次讨论。',
      intent: 'discussion',
    });
    await vi.waitFor(
      async () => {
        await host.service.pump(workspace.id);
        expect(errors, String(errors)).toEqual([]);
        const snapshot = repository.read(conversationId)!;
        expect(snapshot.tasks).toHaveLength(4);
        expect(
          snapshot.attempts.every((a) => a.status === 'succeeded'),
          JSON.stringify(
            snapshot.attempts.map((a) => ({ status: a.status, error: a.error, output: a.output })),
          ),
        ).toBe(true);
      },
      { timeout: 8000, interval: 20 },
    );
    expect(provider.routingCalls).toBe(1);
    expect(provider.contributions).toEqual(['agent:b', 'agent:c', 'agent:a']);
    const snapshot = host.command({ action: 'get', conversationId }).snapshot!;
    expect(
      snapshot.messages.filter((m) => m.visibility !== 'private').map((m) => m.blocks[0]?.text),
    ).toEqual(['按本群描述依次讨论。', 'B_REAL_PROPOSAL', 'C_REAL_REVIEW', 'A_REAL_SUMMARY']);
    expect(snapshot.tasks.some((t) => t.workflowStartAllowed)).toBe(false);
    expect(snapshot.attempts[0]!.output).toBe('');
    expect(
      new Set(snapshot.deliveries.map((d) => d.messageId + ':' + d.recipientMemberId)).size,
    ).toBe(snapshot.deliveries.length);
  } finally {
    await runtime.stop();
    db.raw.close();
    const target = resolve(directory);
    if (!target.startsWith(prefix) || target === prefix)
      throw new Error('fixture path outside owned directory');
    rmSync(target, { recursive: true, force: true });
  }
}, 15000);
