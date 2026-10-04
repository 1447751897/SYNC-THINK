import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteCollaborationStore,
  SqliteConversationStore,
  SqliteMessageStore,
  SqliteGlobalAgentStore,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
import type { AgentId, ModelId, CollaborationSnapshot } from '@sync-think/shared';
import { CollaborationChatHost } from './collaboration-chat-host.js';
import { Runtime } from './runtime.js';

async function fixture() {
  const prefix = resolve(tmpdir(), 'sync-think-group-host-');
  const directory = mkdtempSync(prefix);
  const path = join(directory, 'test.db');
  await runMigrations(path);
  const db = await openDatabaseAsync({ path });
  const agents = new SqliteGlobalAgentStore(db.raw);
  const agentIds = ['a', 'b', 'c'].map(
    (id) =>
      agents.create({
        id: id as AgentId,
        name: id.toUpperCase(),
        defaultModelId: 'fixture' as ModelId,
      }).id,
  );
  const conversations = new SqliteConversationStore(db.raw);
  const repository = new SqliteCollaborationStore(db.raw);
  const host = new CollaborationChatHost(repository, {
    ownerId: 'host-test',
    agents,
    conversations,
    messages: new SqliteMessageStore(db.raw),
    workspaces: new SqliteWorkspaceStore(db.raw),
    execute: async () => ({ output: 'real fixture member' }),
    onChanged: () => {},
  });
  const group = host.command({
    action: 'create',
    kind: 'group',
    clientRequestId: 'new-group',
    title: 'group',
    agentIds,
  }).snapshot!;
  const close = async () => {
    await host.service.stop();
    db.raw.close();
    const target = resolve(directory);
    if (!target.startsWith(prefix) || target === prefix)
      throw new Error('fixture cleanup outside owned directory');
    rmSync(target, { recursive: true, force: true });
  };
  return { host, repository, group, close };
}
describe('group host audience and control boundary', () => {
  it('projects agent-to-agent secrets out of user get/list/activity responses and forbids hidden reference commands', async () => {
    const f = await fixture();
    try {
      const id = f.group.conversation.id;
      let raw = f.repository.read(id)!;
      raw.conversation.room = undefined; // Exercise non-work peer transport with the same host audience rules.
      raw.conversation.policy.allowGroupMessages = true;
      raw.revision++;
      f.repository.save(raw);
      f.host.command({
        action: 'send',
        conversationId: id,
        clientRequestId: 'seed',
        text: 'public request',
        deliveryMode: 'notify',
      });
      const origin = f.repository.read(id)!.messages[0]!.id;
      const hidden = f.host.command(
        {
          action: 'send',
          conversationId: id,
          clientRequestId: 'secret',
          text: 'HOST_SECRET_CANARY',
          visibility: 'private',
          recipientMemberIds: ['agent:b'],
          replyToMessageId: origin,
          deliveryMode: 'notify',
        },
        'agent:a',
      ).snapshot!;
      const secretId = hidden.messages.at(-1)!.id;
      for (const response of [
        f.host.command({ action: 'get', conversationId: id }),
        f.host.command({ action: 'list', workspaceId: f.group.conversation.workspaceId }),
        f.host.command({ action: 'activity', workspaceId: f.group.conversation.workspaceId }),
      ])
        expect(JSON.stringify(response)).not.toContain('HOST_SECRET_CANARY');
      expect(
        JSON.stringify(f.host.command({ action: 'get', conversationId: id }, 'agent:b')),
      ).toContain('HOST_SECRET_CANARY');
      expect(
        JSON.stringify(f.host.command({ action: 'get', conversationId: id }, 'agent:c')),
      ).not.toContain('HOST_SECRET_CANARY');
      expect(() =>
        f.host.command(
          {
            action: 'send',
            conversationId: id,
            clientRequestId: 'steal',
            text: 'answer',
            replyToMessageId: secretId,
          },
          'agent:c',
        ),
      ).toThrow('private_context_forbidden');
      expect(f.repository.read(id)!.messages).toHaveLength(2);
    } finally {
      await f.close();
    }
  });
  it('keeps descriptions durable, user-editable only, and new group coordination enabled', async () => {
    const f = await fixture();
    try {
      expect(f.group.conversation.policy.coordinateDiscussion).toBe(true);
      const cmd = {
        action: 'group-config' as const,
        conversationId: f.group.conversation.id,
        clientRequestId: 'rules',
        description: 'B → C → A',
        expectedRevision: 0,
      };
      expect(() => f.host.command(cmd, 'agent:a')).toThrow('user_action_required');
      f.host.command(cmd);
      expect(f.repository.read(cmd.conversationId)!.conversation.groupDescription).toBe(
        'B → C → A',
      );
      expect(
        f.host.command({ action: 'get', conversationId: cmd.conversationId }).snapshot!.conversation
          .groupConfigurationRevision,
      ).toBe(1);
    } finally {
      await f.close();
    }
  });
  it('rejects every controller tool including read-only and management tools', async () => {
    const runtime = new Runtime({ installId: 'group-tool-guard', allowNoToken: true });
    const internal = runtime as unknown as {
      collaborationThreadScopes: Map<string, unknown>;
      isTaskRoomToolAllowed(run: unknown, name: string): boolean;
      isReadOnlyRunToolAllowed(run: unknown, name: string): boolean;
      isCollaborationControlToolAllowed(run: unknown, name: string): boolean;
    };
    internal.collaborationThreadScopes.set('controller', {
      input: {
        task: { conversationPlanning: true },
        snapshot: { conversation: {} } as CollaborationSnapshot,
      },
    });
    try {
      for (const name of [
        'read_file',
        'write_file',
        'shell',
        'agent_create',
        'collaboration_read_context',
        'collaboration_send_message',
        'collaboration_dispatch_tasks',
        'automation_report_outcome',
      ]) {
        const run = { threadId: 'controller' };
        expect(internal.isTaskRoomToolAllowed(run, name)).toBe(false);
        expect(internal.isReadOnlyRunToolAllowed(run, name)).toBe(false);
        expect(internal.isCollaborationControlToolAllowed(run, name)).toBe(false);
      }
    } finally {
      internal.collaborationThreadScopes.clear();
      await runtime.stop();
    }
  });
});
