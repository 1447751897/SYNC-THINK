import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { openDatabaseAsync, runMigrations, SqliteCollaborationStore, SqliteGlobalAgentStore, SqliteWorkspaceStore, SqliteTeamStore, SqliteConversationStore } from '@sync-think/storage';
import type { AgentId, ModelId } from '@sync-think/shared';
import { CollaborationChatHost } from './collaboration-chat-host.js';
import type { CollaborationExecutionInput } from './collaboration-chat-service.js';
import { submitCollaborationArtifact } from './collaboration-artifacts.js';
async function until(ready: () => boolean) {
  for (let i = 0; i < 200; i++) { if (ready()) return; await new Promise(done => setTimeout(done, 5)); }
  throw Error('room durability test did not settle');
}
it('persists a paused room through closing/reopening SQLite and resumes only its interrupted attempt', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'room-durability-'));
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw Error('cleanup outside temp');
  const path = join(directory, 'state.db'); await runMigrations(path);
  let connection = await openDatabaseAsync({ path });
  const stores = () => ({ repository: new SqliteCollaborationStore(connection.raw), conversations: new SqliteConversationStore(connection.raw), agents: new SqliteGlobalAgentStore(connection.raw), workspaces: new SqliteWorkspaceStore(connection.raw), teams: new SqliteTeamStore(connection.raw) });
  let current = stores();
  const workspace = current.workspaces.createWorkspace({ name: 'two books', folderPath: directory });
  const agent = current.agents.create({ id: 'writer' as AgentId, name: '作者', defaultModelId: 'fake-mini' as ModelId });
  let host = new CollaborationChatHost(current.repository, { ...current, ownerId: 'before-restart', onChanged() {}, execute: input => new Promise(done => {
    input.onProgress({ threadId: 'thread:' + input.task.id, output: '暂停前半章' });
    input.signal.addEventListener('abort', () => done({ output: '' }), { once: true });
  }) });
  try {
    const a = host.command({ action: 'create', kind: 'group', clientRequestId: 'A', title: 'A', workspaceId: workspace.id, agentIds: [agent.id] }).snapshot!;
    const b = host.command({ action: 'create', kind: 'group', clientRequestId: 'B', title: 'B', workspaceId: workspace.id, agentIds: [agent.id] }).snapshot!;
    const id = a.conversation.id;
    host.command({ action: 'send', conversationId: id, clientRequestId: 'write-a', text: '只写 A', intent: 'work' });
    await until(() => current.repository.read(id)!.attempts[0]?.output === '暂停前半章');
    host.command({ action: 'room-pause', conversationId: id, clientRequestId: 'pause-a' });
    await until(() => current.repository.read(id)!.conversation.room!.state === 'paused');
    const before = current.repository.read(id)!;
    await host.service.stop(); connection.raw.close();
    connection = await openDatabaseAsync({ path }); current = stores();
    const executions: CollaborationExecutionInput[] = [];
    host = new CollaborationChatHost(current.repository, { ...current, ownerId: 'after-restart', onChanged() {}, async execute(input) {
      executions.push(input); return { output: 'A 交付', artifacts: [submitCollaborationArtifact({ task: input.task, attempt: input.attempt, content: '# A\n完成的首章' })] };
    } });
    host.service.recover(); await host.service.pump();
    expect(executions).toHaveLength(0);
    expect(current.repository.read(id)!.conversation.room!.checkpoint).toEqual(before.conversation.room!.checkpoint);
    const resume = { action: 'room-resume' as const, conversationId: id, clientRequestId: 'resume-a' };
    host.command(resume); host.command(resume);
    await until(() => current.repository.read(id)!.conversation.room!.state === 'review');
    const after = current.repository.read(id)!;
    expect(executions).toHaveLength(1); expect(after.attempts).toHaveLength(2);
    expect(after.attempts[0].output).toBe('暂停前半章'); expect(after.attempts[0].status).toBe('interrupted');
    expect(after.attempts[1].resumeFromAttemptId).toBe(before.attempts[0].id);
    expect(after.attempts[1].threadId).toBe(before.attempts[0].threadId);
    expect(after.conversation.room!.checkpoint.artifactIds).toHaveLength(1);
    expect(current.repository.read(b.conversation.id)!.tasks).toHaveLength(0);
  } finally {
    await host.service.stop(); connection.raw.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
