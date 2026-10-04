import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { FakeProvider, type ProviderCallRequest, type AdapterEvent } from '@sync-think/adapters';
import { openDatabaseAsync, runMigrations, SqliteEventCheckpointStore, SqliteConversationStore, SqliteCollaborationStore, SqliteGlobalAgentStore, SqliteWorkspaceStore, SqliteTeamStore } from '@sync-think/storage';
import type { AgentId, TeamId, ModelId, WorkspaceId } from '@sync-think/shared';
import { Runtime } from './runtime.js';
import { CollaborationChatHost } from './collaboration-chat-host.js';

class SourceProvider extends FakeProvider {
  rounds = new Map<string, number>();
  checks: string[] = [];
  override async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    const prompt = request.systemPrompt ?? '';
    const task = prompt.match(/taskId=([^；\n]+)/)?.[1] ?? request.idempotencyKey;
    const round = this.rounds.get(task) ?? 0; this.rounds.set(task, round + 1);
    const current = String(request.messages.filter(m => m.role === 'user').at(-1)?.content ?? '');
    const names = request.tools?.map(t => t.name) ?? [];
    const result = String(request.messages.filter(m => m.role === 'tool').at(-1)?.content ?? '');
    expect(prompt).toContain('不是本轮必须执行的清单');
    let tool: { name: string; args: object } | undefined;
    if (current.startsWith('只分析给定仓库')) {
      if (!prompt.includes('本群已启用联网读取')) {
        expect(names).not.toContain('web_fetch');
        expect(names).toContain('collaboration_report_blocker');
        if (!round) tool = { name: 'collaboration_report_blocker', args: { reason: '当前群聊联网读取未开启，尚未取得公开源码', nextStep: '打开群聊联网读取，然后核对并继续' } };
        else { expect(result).toContain('"status":"blocked"'); this.checks.push('blocked'); }
      } else {
        expect(names).toContain('web_fetch');
        const draft = { assigneeMemberId: 'agent:writer', title: '源码功能分析', instructions: '[源码读取]只根据 README 分析功能', deliverable: { kind: 'document', title: '功能分析', ...(round === 0 ? { path: 'analysis.md' } : {}) } };
        if (round < 2) {
          if (round === 1) { expect(result).toContain('tasks[0].deliverable.path'); expect(result).toContain('omit path'); this.checks.push('corrected-parameter'); }
          tool = { name: 'collaboration_dispatch_tasks', args: { tasks: [draft] } };
        } else { expect(result).toContain('"ok":true'); this.checks.push('dispatched-writer-only'); }
      }
    } else if (current.startsWith('[源码读取]')) {
      expect(names).toContain('web_fetch'); expect(names).not.toContain('write_file');
      if (!round) tool = { name: 'web_fetch', args: { url: 'https://raw.githubusercontent.com/owner/repository/main/README.md' } };
      else if (round === 1) { expect(result).toContain('视频热榜监测'); this.checks.push('read-real-tool-source'); tool = { name: 'collaboration_submit_artifact', args: { content: '# 功能分析\nREADME 说明此项目提供视频热榜监测，部署需求待另行核对。' } }; }
      else expect(result).toContain('"ok":true');
    } else if (current.startsWith('先读取本群工作索引')) {
      if (!round) tool = { name: 'collaboration_read_context', args: { kind: 'tasks' } };
      else { expect(result).toContain('功能分析'); this.checks.push('reviewed-artifact'); }
    } else throw new Error('Unexpected automatic team stage: ' + current);
    if (tool) { yield { type: 'tool-call', toolCall: { id: task + ':' + round, name: tool.name, argumentsJson: JSON.stringify(tool.args) } }; yield { type: 'finished', reason: 'tool-requests' }; }
    else { yield { type: 'assistant-message-delta', phase: 'final_answer', text: '本轮状态已核对。' }; yield { type: 'finished', reason: 'stop' }; }
  }
}
it.each([false, true])('keeps a saved serial workflow advisory and propagates room networkEnabled=%s', async enabled => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'collab-source-')));
  const path = join(directory, 'test.db'); await runMigrations(path);
  const connection = await openDatabaseAsync({ path });
  const workspaces = new SqliteWorkspaceStore(connection.raw);
  const workspace = workspaces.createWorkspace({ id: 'source-workspace' as WorkspaceId, name: '仓库分析', folderPath: directory });
  const agents = new SqliteGlobalAgentStore(connection.raw);
  for (const id of ['leader', 'expert', 'writer']) agents.create({ id: id as AgentId, name: id, defaultModelId: 'fake-mini' as ModelId, writePolicy: 'read-only' });
  const teams = new SqliteTeamStore(connection.raw);
  teams.create({ id: 'source-team' as TeamId, name: '旧串行参考', mission: '通常先选项目，再审查，再产出，最后部署；只是职责说明', strategy: 'serial', coordinatorAgentId: 'leader' as AgentId, members: ['leader', 'expert', 'writer'].map((id, i) => ({ agentId: id as AgentId, role: id, title: id, memberOrder: i, dependsOn: i ? [(['leader', 'expert'][i - 1]) as AgentId] : [] })) });
  const conversations = new SqliteConversationStore(connection.raw);
  const repository = new SqliteCollaborationStore(connection.raw);
  const provider = new SourceProvider();
  const host: CollaborationChatHost = new CollaborationChatHost(repository, { ownerId: 'source-test', conversations, agents, teams, workspaces, execute: input => runtime.executeCollaborationTaskForHost(input), onChanged: () => {} });
  const runtime: Runtime = new Runtime({ installId: 'source-test', allowNoToken: true, workspaceStore: workspaces, conversationStore: conversations, globalAgentStore: agents, teamStore: teams, stateStore: new SqliteEventCheckpointStore(connection.raw), collaborationChatHost: host, demoProvider: provider });
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('# 视频热榜监测\n从公开数据监测榜单。', { status: 200, headers: { 'content-type': 'text/plain' } }));
  try {
    const room = host.command({ action: 'create', clientRequestId: 'create', kind: 'group', title: '给定仓库', workspaceId: workspace.id, agentIds: [], teamId: 'source-team' }).snapshot!;
    expect(() => host.command({ action: 'policy', conversationId: room.conversation.id, policy: { networkEnabled: true } }, room.conversation.coordinatorMemberId)).toThrow('user_action_required');
    host.command({ action: 'policy', conversationId: room.conversation.id, policy: { networkEnabled: enabled } });
    host.command({ action: 'start-workflow', conversationId: room.conversation.id, clientRequestId: 'start', goal: '只分析给定仓库 https://github.com/owner/repository 的 README，交付一份功能分析；不选项目、不部署。' });
    await vi.waitFor(() => {
      const snapshot = repository.read(room.conversation.id)!;
      expect(snapshot.conversation.room!.state).toBe(enabled ? 'review' : 'blocked');
      expect(snapshot.tasks.every(t => ['succeeded', 'failed'].includes(snapshot.attempts.find(a => a.id === t.currentAttemptId)!.status))).toBe(true);
    }, { timeout: 10000 });
    const snapshot = repository.read(room.conversation.id)!;
    expect(snapshot.tasks.some(t => t.assigneeMemberId === 'agent:expert')).toBe(false);
    expect(snapshot.conversation.room!.state).not.toBe('completed');
    if (enabled) {
      expect(provider.checks).toEqual(expect.arrayContaining(['corrected-parameter', 'dispatched-writer-only', 'read-real-tool-source', 'reviewed-artifact']));
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(snapshot.attempts.flatMap(a => a.artifacts ?? [])).toHaveLength(1);
      expect(snapshot.tasks.filter(t => t.purpose === 'work')).toHaveLength(1);
      expect(snapshot.attempts.some(a => a.tools.some(tool => ['command_execution', 'write_file'].includes(tool.name)))).toBe(false);
    } else {
      expect(fetch).not.toHaveBeenCalled();
      expect(snapshot.attempts.at(-1)?.error).toMatchObject({ code: 'work_blocked', message: '当前群聊联网读取未开启，尚未取得公开源码', nextStep: '打开群聊联网读取，然后核对并继续' });
      expect(snapshot.messages.some(m => m.kind === 'task_result')).toBe(true);
    }
  } finally { fetch.mockRestore(); await runtime.stop(); connection.raw.close(); rmSync(directory, { recursive: true, force: true }); }
});
