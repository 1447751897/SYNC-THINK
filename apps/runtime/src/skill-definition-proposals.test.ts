import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeProvider, OpenAIResponsesAdapter, type ProviderToolCall } from '@sync-think/adapters';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteWorkspaceStore,
  SqliteGlobalAgentStore,
  SqliteSkillStore,
  SqliteTeamStore,
  SqliteApprovalStore,
  SqliteEventCheckpointStore,
} from '@sync-think/storage';
import type { AgentId, ModelId, WorkspaceId, Event, RunId, TaskId, ThreadId } from '@sync-think/shared';
import { Runtime } from './runtime.js';
import type { DemoRunState } from './demo-run.js';
import {
  chatToolRequiresApproval,
  toolsForExecutionMode,
  evaluateToolLoopGuard,
} from './chat-tools.js';
import { selectKernelMcpRun, setKernelMcpServerConditions } from './kernel/mcp-servers/registry.js';
import type { PlatformMcpToolCall } from './kernel/mcp-broker.js';

const skillTools = [
  'list_skills',
  'read_skill',
  'create_skill',
  'update_skill',
  'delete_skill',
  'import_remote_skill',
];
const skillMutations = ['create_skill', 'update_skill', 'delete_skill', 'import_remote_skill'];
const skillMd = (version = '1.0.0') =>
  [
    '---',
    'name: repo-to-agent-test',
    'description: 提炼仓库角色和能力',
    'version: ' + version,
    '---',
    '# 仓库分析',
    '先读取证据，再整理多个角色和 Skill。',
  ].join('\n');
const call = (name: string, args: object, id = name): ProviderToolCall => ({
  id,
  name,
  argumentsJson: JSON.stringify(args),
});
interface Internals {
  prepareRunBinding(input: object): { run: DemoRunState };
  demoRuns: Map<RunId, DemoRunState>;
  executeChatSkillTool(input: { run: DemoRunState; toolCall: ProviderToolCall }): Promise<string>;
  executeChatAgentTool(input: { run: DemoRunState; toolCall: ProviderToolCall }): Promise<string>;
  recordDefinitionApproval(run: DemoRunState, toolCall: ProviderToolCall): void;
  executeKernelRun(runId: RunId): Promise<void>;
  requestChatToolApproval(input: object): Promise<{ decision: string; approvalId?: string }>;
  requestPlatformToolApproval(
    runId: RunId,
    threadId: string,
    toolCall: PlatformMcpToolCall,
  ): Promise<'approve' | 'deny'>;
  executePlatformMcpToolCall(
    runId: RunId,
    run: DemoRunState,
    root: string,
    toolCall: PlatformMcpToolCall,
    args: string,
  ): Promise<{ ok: boolean; content?: string; error?: string }>;
  platformMcpRuns: { setCatalog(runId: RunId, tools: unknown): void };
  toolApprovalPolicy: { isAllowed(input: object): boolean };
  publishEvent(event: Event): void;
  resolveChatExecutionMode(threadId: string): string;
  isTaskRoomToolAllowed(run: DemoRunState, name: string): boolean;
  collaborationThreadScopes: Map<string, unknown>;
  goalExecutionState: { bindRunRevision(runId: string, revision: string): void };
  demoRunAbortRegistry: { abort(runId: RunId): void };
}
async function fixture(provider = new FakeProvider(), options: { track?: 'agent' | 'model'; goalBudgeted?: boolean; bindThread?: boolean } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'sync-think-skill-proposals-'));
  const dbPath = join(directory, 'test.db');
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  const workspaceStore = new SqliteWorkspaceStore(connection.raw);
  const workspace = workspaceStore.createWorkspace({
    id: 'workspace-skills' as WorkspaceId,
    name: '技能测试',
    folderPath: directory,
  });
  if (options.bindThread) workspaceStore.createTask({ id: 'task-skills' as TaskId, threadId: 'skill-thread' as ThreadId, workspaceId: workspace.id, title: 'Budgeted child fixture', goal: 'Finish within the assigned budget' });
  const agents = new SqliteGlobalAgentStore(connection.raw);
  const agent = agents.create({
    id: 'agent-skill-user' as AgentId,
    name: '全能助手',
    defaultModelId: 'fake-mini' as ModelId,
  });
  const skills = new SqliteSkillStore(connection.raw);
  const approvals = new SqliteApprovalStore(connection.raw);
  const teams = new SqliteTeamStore(connection.raw);
  const runtime = new Runtime({
    installId: 'skill-proposals',
    allowNoToken: true,
    workspaceStore,
    globalAgentStore: agents,
    skillStore: skills,
    approvalStore: approvals,
    teamStore: teams,
    stateStore: new SqliteEventCheckpointStore(connection.raw),
    demoProvider: provider,
  });
  const internal = runtime as unknown as Internals;
  vi.spyOn(internal, 'resolveChatExecutionMode').mockReturnValue('full-access');
  const { run } = internal.prepareRunBinding({
    runId: 'skill-proposal',
    threadId: 'skill-thread',
    userText: '把刚才的技能登记并绑定给助手，不启动小队工作',
    globalAgentId: agent.id,
    track: options.track ?? 'agent',
    definitionProposalsAllowed: true,
  });
  internal.demoRuns.set(run.runId, run);
  if (options.goalBudgeted) internal.goalExecutionState.bindRunRevision(String(run.runId), 'budgeted-goal-revision');
  return {
    runtime,
    internal,
    run,
    agents,
    agent,
    skills,
    approvals,
    teams,
    workspace,
    close: async () => {
      await runtime.stop();
      connection.raw.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
afterEach(() => {
  setKernelMcpServerConditions({});
  vi.restoreAllMocks();
});

describe('user-owned Skill proposals', () => {

  it('imports and binds five members after more than eight productive native rounds', async () => {
    class LongSkillBuilder extends FakeProvider {
      round = 0;
      seedVersions: string[] = [];
      version = '';
      override async *call(request: Parameters<FakeProvider['call']>[0]) {
        const round = this.round++;
        expect(request.toolChoice).not.toBe('none');
        const latest = request.messages?.filter((m) => m.role === 'tool').at(-1)?.content;
        const result = typeof latest === 'string' ? JSON.parse(latest) : undefined;
        if (round > 0) expect(result.ok).toBe(true);
        if (round === 11) this.version = result.skill.skillVersionId;
        let toolCall: ProviderToolCall | undefined;
        if (round < 10) toolCall = call('read_skill', { skillVersionId: this.seedVersions[round] }, 'read-' + round);
        if (round === 10) toolCall = call('create_skill', { skillMd: skillMd() }, 'register');
        if (round >= 11 && round <= 15) toolCall = call('update_agent', {
          agent: round === 11 ? 'agent-skill-user' : 'role-' + (round - 10), skillIds: [this.version],
        }, 'bind-' + round);
        if (toolCall) {
          yield { type: 'tool-call' as const, toolCall };
          yield { type: 'finished' as const, reason: 'tool-requests' as const };
        } else {
          yield { type: 'text-delta' as const, text: 'Skill 已登记并绑定五个成员。' };
          yield { type: 'finished' as const, reason: 'stop' as const };
        }
      }
    }
    const provider = new LongSkillBuilder();
    const f = await fixture(provider);
    try {
      for (let index = 0; index < 10; index++) provider.seedVersions.push(f.skills.importVersion({
        name: 'evidence-' + index, description: '已有能力证据', version: '1.0.0',
        sourceMd: 'evidence-' + index, body: 'evidence-' + index, contentFingerprint: 'evidence-' + index,
      }).id);
      for (let index = 2; index <= 5; index++) f.agents.create({
        id: ('role-' + index) as AgentId, name: '角色' + index, defaultModelId: 'fake-mini' as ModelId,
      });
      const approval = vi.spyOn(f.internal, 'requestChatToolApproval').mockResolvedValue({ decision: 'approve', approvalId: 'fresh-confirmation' });
      const start = vi.spyOn(f.teams, 'startRun');
      await f.internal.executeKernelRun(f.run.runId);
      expect(provider.round).toBe(17);
      expect(approval.mock.calls.map(([value]) => (value as { toolCall: ProviderToolCall }).toolCall.name)).toEqual(['create_skill', ...Array(5).fill('update_agent')]);
      expect(f.skills.listVersions()).toHaveLength(11);
      for (const member of f.agents.list()) expect(member.skillIds).toEqual([provider.version]);
      expect(start).not.toHaveBeenCalled();
    } finally { await f.close(); }
  });

  it('does not mistake folded identical previews of changing long results for stagnation', async () => {
    class LongResultReader extends FakeProvider {
      round = 0;
      override async *call(request: Parameters<FakeProvider['call']>[0]) {
        expect(request.toolChoice).not.toBe('none');
        if (this.round++ < 8) {
          yield { type: 'tool-call' as const, toolCall: call('read_skill', { skillVersionId: 'evidence' }, 'read-' + this.round) };
          yield { type: 'finished' as const, reason: 'tool-requests' as const };
        } else {
          yield { type: 'text-delta' as const, text: '资料已读取。' };
          yield { type: 'finished' as const, reason: 'stop' as const };
        }
      }
    }
    const provider = new LongResultReader();
    const f = await fixture(provider);
    try {
      let revision = 0;
      vi.spyOn(f.internal, 'executeChatSkillTool').mockImplementation(async () => JSON.stringify({
        ok: true, sourceMd: 'a'.repeat(8_000) + (++revision) + 'b'.repeat(8_000),
      }));
      await f.internal.executeKernelRun(f.run.runId);
      expect(provider.round).toBe(9);
      expect(revision).toBe(8);
    } finally { await f.close(); }
  });

  it('enforces the operation budget within a batch before requesting mutation approval', async () => {
    class BudgetBuilder extends FakeProvider {
      round = 0;
      results: unknown[] = [];
      override async *call(request: Parameters<FakeProvider['call']>[0]) {
        if (this.round++ === 0) {
          for (let index = 0; index < 129; index++) yield { type: 'tool-call' as const, toolCall: call('list_skills', {}, 'read-' + index) };
          yield { type: 'tool-call' as const, toolCall: call('create_skill', { skillMd: skillMd() }, 'over-budget-mutation') };
          yield { type: 'finished' as const, reason: 'tool-requests' as const };
          return;
        }
        expect(request.toolChoice).toBe('none');
        this.results = request.messages?.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content as string)) ?? [];
        expect(request.messages?.at(-1)?.content).toContain('操作预算');
        yield { type: 'text-delta' as const, text: '登记和绑定待续做。' };
        yield { type: 'finished' as const, reason: 'stop' as const };
      }
    }
    const provider = new BudgetBuilder();
    const f = await fixture(provider, { goalBudgeted: true });
    try {
      const approval = vi.spyOn(f.internal, 'requestChatToolApproval');
      await f.internal.executeKernelRun(f.run.runId);
      expect(provider.results).toHaveLength(130);
      expect(provider.results.slice(128)).toEqual([
        expect.objectContaining({ ok: false, code: 'EXECUTION_BUDGET_EXHAUSTED' }),
        expect.objectContaining({ ok: false, code: 'EXECUTION_BUDGET_EXHAUSTED' }),
      ]);
      expect(approval).not.toHaveBeenCalled();
      expect(f.skills.listVersions()).toHaveLength(0);
    } finally { await f.close(); }
  });

  it.each(['create_skill', 'agent_delegate'])('stops %s side effects when generated tokens are exhausted without raising normal provider output caps', async (toolName) => {
    class TokenBudgetBuilder extends FakeProvider {
      round = 0;
      firstOutputReserve?: number;
      override async *call(request: Parameters<FakeProvider['call']>[0]) {
        if (this.round++ === 0) {
          this.firstOutputReserve = request.maxOutputTokens;
          yield { type: 'usage' as const, tokensIn: 20, tokensOut: 64_000 };
          yield { type: 'tool-call' as const, toolCall: call(toolName, { skillMd: skillMd() }, 'first') };
          if (toolName === 'agent_delegate') yield { type: 'tool-call' as const, toolCall: call(toolName, {}, 'second') };
          yield { type: 'finished' as const, reason: 'tool-requests' as const };
          return;
        }
        expect(request.toolChoice).toBe('none');
        expect(request.messages?.at(-1)?.content).toContain('生成预算');
        expect(request.maxOutputTokens).toBe(2_048);
        const last = request.messages?.filter((m) => m.role === 'tool').at(-1)?.content;
        expect(JSON.parse(last as string)).toMatchObject({ ok: false, code: 'EXECUTION_BUDGET_EXHAUSTED' });
        yield { type: 'text-delta' as const, text: '登记待续做。' };
        yield { type: 'finished' as const, reason: 'stop' as const };
      }
    }
    const provider = new TokenBudgetBuilder();
    const f = await fixture(provider, { goalBudgeted: true });
    try {
      const approval = vi.spyOn(f.internal, 'requestChatToolApproval');
      await f.internal.executeKernelRun(f.run.runId);
      expect(provider.round).toBe(2);
      // 128k fixture: the default output reserve is 6%, capped at 8192.
      expect(provider.firstOutputReserve).toBe(7680);
      expect(approval).not.toHaveBeenCalled();
      expect(f.skills.listVersions()).toHaveLength(0);
    } finally { await f.close(); }
  });

  it.each(['agent', 'team', 'model'] as const)(
    'keeps Skill tools stable on native and external %s direct chats',
    (track) => {
      setKernelMcpServerConditions({
        hasAgentStore: true,
        hasTeamStore: true,
        hasSkillStore: true,
      });
      const native = toolsForExecutionMode('full-access', {
        conversationTrack: track,
        includeAgentTools: true,
        agentManagementIntent: 'none',
        allowAgentDefinitionProposals: true,
      }).map((t) => t.name);
      const external = selectKernelMcpRun({
        kernelId: 'codex',
        conversationTrack: track,
        agentManagementIntent: 'none',
        allowAgentDefinitionProposals: true,
      }).externalTools.map((t) => t.name);
      for (const names of [native, external])
        for (const name of skillTools) expect(names).toContain(name);
    },
  );
  it.each(['ask', 'workspace', 'full-access'] as const)(
    'requires fresh save confirmation in %s',
    (mode) => {
      for (const name of skillMutations) expect(chatToolRequiresApproval(mode, name)).toBe(true);
      for (const name of ['list_skills', 'read_skill'])
        expect(chatToolRequiresApproval(mode, name)).toBe(false);
    },
  );
  it.each(['background', 'delegated', 'planning'] as const)(
    'rejects Skill mutations from %s even if directly invoked',
    async (scope) => {
      const f = await fixture();
      try {
        if (scope === 'background') f.run.definitionProposalsAllowed = false;
        if (scope === 'delegated') f.run.delegationParentRunId = 'parent' as RunId;
        if (scope === 'planning') f.run.planningMode = true;
        const toolCall = call('create_skill', { skillMd: skillMd() });
        f.internal.recordDefinitionApproval(f.run, toolCall);
        const result = JSON.parse(await f.internal.executeChatSkillTool({ run: f.run, toolCall }));
        expect(result.ok).toBe(false);
        expect(f.skills.listVersions()).toHaveLength(0);
      } finally {
        await f.close();
      }
    },
  );
  it.each(['native', 'external'] as const)(
    'never reuses remembered %s Skill-save approval',
    async (channel) => {
      const f = await fixture();
      const controller = new AbortController();
      try {
        const remembered = vi
          .spyOn(f.internal.toolApprovalPolicy, 'isAllowed')
          .mockReturnValue(true);
        const published = vi.spyOn(f.internal, 'publishEvent');
        const toolCall = call('create_skill', { skillMd: skillMd() });
        const waiting =
          channel === 'native'
            ? f.internal.requestChatToolApproval({
                runId: f.run.runId,
                threadId: f.run.threadId,
                executionMode: 'full-access',
                toolCall,
                signal: controller.signal,
              })
            : f.internal.requestPlatformToolApproval(f.run.runId, f.run.threadId, {
                id: toolCall.id,
                tool: toolCall.name,
                input: JSON.parse(toolCall.argumentsJson),
                signal: controller.signal,
              });
        expect(remembered).not.toHaveBeenCalled();
        expect(
          published.mock.calls.find(([event]) => event.type === 'tool.approval_requested')?.[0]
            .payload.allowedScopes,
        ).toEqual(['once']);
        controller.abort();
        const result = await waiting;
        expect(typeof result === 'string' ? result : result.decision).toBe('deny');
      } finally {
        controller.abort();
        await f.close();
      }
    },
  );
  it('binds only real approved Skill versions and consumes the exact save grant once', async () => {
    const f = await fixture();
    try {
      const toolCall = call('create_skill', { skillMd: skillMd() });
      expect(
        JSON.parse(await f.internal.executeChatSkillTool({ run: f.run, toolCall })).error,
      ).toContain('fresh_confirmation_required');
      f.internal.recordDefinitionApproval(f.run, toolCall);
      const altered = { ...toolCall, argumentsJson: JSON.stringify({ skillMd: skillMd('2.0.0') }) };
      expect(
        JSON.parse(await f.internal.executeChatSkillTool({ run: f.run, toolCall: altered })).ok,
      ).toBe(false);
      const saved = JSON.parse(await f.internal.executeChatSkillTool({ run: f.run, toolCall }));
      expect(saved.ok).toBe(true);
      expect(
        JSON.parse(await f.internal.executeChatSkillTool({ run: f.run, toolCall })).error,
      ).toContain('fresh_confirmation_required');
      const binding = call('update_agent', {
        agent: f.agent.id,
        skillIds: [saved.skill.skillVersionId],
      });
      expect(
        JSON.parse(await f.internal.executeChatAgentTool({ run: f.run, toolCall: binding })).ok,
      ).toBe(false);
      f.internal.recordDefinitionApproval(f.run, binding);
      const bound = JSON.parse(
        await f.internal.executeChatAgentTool({ run: f.run, toolCall: binding }),
      );
      expect(bound.ok).toBe(true);
      expect(f.agents.get(f.agent.id)?.skillIds).toEqual([saved.skill.skillVersionId]);
      const missing = call(
        'update_agent',
        { agent: f.agent.id, skillIds: ['invented-skill-version'] },
        'missing',
      );
      f.internal.recordDefinitionApproval(f.run, missing);
      expect(
        JSON.parse(await f.internal.executeChatAgentTool({ run: f.run, toolCall: missing })).ok,
      ).toBe(false);
      const blockedDelete = call('delete_skill', { skillVersionId: saved.skill.skillVersionId });
      f.internal.recordDefinitionApproval(f.run, blockedDelete);
      expect(
        JSON.parse(await f.internal.executeChatSkillTool({ run: f.run, toolCall: blockedDelete }))
          .ok,
      ).toBe(false);
      expect(f.skills.listVersions()).toHaveLength(1);
      expect(f.internal.isTaskRoomToolAllowed(f.run, 'collaboration_start_workflow')).toBe(false);
    } finally {
      await f.close();
    }
  });
  it('preserves old pinned versions on update and blocks binding while permission approval is pending', async () => {
    const f = await fixture();
    try {
      const create = call('create_skill', { skillMd: skillMd() });
      f.internal.recordDefinitionApproval(f.run, create);
      const old = JSON.parse(
        await f.internal.executeChatSkillTool({ run: f.run, toolCall: create }),
      ).skill.skillVersionId;
      const bind = call('update_agent', { agent: f.agent.id, skillIds: [old] });
      f.internal.recordDefinitionApproval(f.run, bind);
      await f.internal.executeChatAgentTool({ run: f.run, toolCall: bind });
      const update = call('update_skill', { skillMd: skillMd('2.0.0') });
      f.internal.recordDefinitionApproval(f.run, update);
      const next = JSON.parse(
        await f.internal.executeChatSkillTool({ run: f.run, toolCall: update }),
      ).skill.skillVersionId;
      expect(next).not.toBe(old);
      expect(f.skills.listVersions()).toHaveLength(2);
      expect(f.agents.get(f.agent.id)?.skillIds).toEqual([old]);
      f.approvals.enqueue({
        workspaceId: f.workspace.id,
        kind: 'skill-permission',
        action: 'skill.permission-upgrade',
        summary: '权限待确认',
        humanOnly: true,
        mode: 'request',
        gate: 'human',
        metadata: { skillVersionId: next },
      });
      const pending = call(
        'update_agent',
        { agent: f.agent.id, skillIds: [next] },
        'pending-binding',
      );
      f.internal.recordDefinitionApproval(f.run, pending);
      const result = JSON.parse(
        await f.internal.executeChatAgentTool({ run: f.run, toolCall: pending }),
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('not approved');
      expect(f.agents.get(f.agent.id)?.skillIds).toEqual([old]);
    } finally {
      await f.close();
    }
  });
  it.each(['approve', 'deny'] as const)(
    'external Skill import obeys %s and requires separate agent-binding confirmation',
    async (decision) => {
      const f = await fixture();
      try {
        setKernelMcpServerConditions({ hasAgentStore: true, hasSkillStore: true });
        f.internal.platformMcpRuns.setCatalog(
          f.run.runId,
          selectKernelMcpRun({
            kernelId: 'codex',
            conversationTrack: 'agent',
            agentManagementIntent: 'none',
            allowAgentDefinitionProposals: true,
          }).externalTools,
        );
        const approval = vi
          .spyOn(f.internal, 'requestPlatformToolApproval')
          .mockResolvedValue(decision);
        const args = { skillMd: skillMd() };
        const result = await f.internal.executePlatformMcpToolCall(
          f.run.runId,
          f.run,
          '.',
          {
            id: 'external-import',
            tool: 'create_skill',
            input: args,
            signal: new AbortController().signal,
          },
          JSON.stringify(args),
        );
        expect(result.ok).toBe(decision === 'approve');
        expect(approval).toHaveBeenCalledTimes(1);
        expect(f.skills.listVersions()).toHaveLength(decision === 'approve' ? 1 : 0);
        if (decision === 'approve') {
          const version = JSON.parse(result.content!).skill.skillVersionId;
          const binding = { agent: f.agent.id, skillIds: [version] };
          const bound = await f.internal.executePlatformMcpToolCall(
            f.run.runId,
            f.run,
            '.',
            {
              id: 'external-bind',
              tool: 'update_agent',
              input: binding,
              signal: new AbortController().signal,
            },
            JSON.stringify(binding),
          );
          expect(bound.ok, JSON.stringify(bound)).toBe(true);
          expect(approval).toHaveBeenCalledTimes(2);
          expect(f.agents.get(f.agent.id)?.skillIds).toEqual([version]);
        }
      } finally {
        await f.close();
      }
    },
  );
  it('completes list → import → read → approved resources → binding in the real private native loop', async () => {
    class SkillBuilder extends FakeProvider {
      round = 0;
      version = '';
      trace: unknown[] = [];
      override async *call(request: Parameters<FakeProvider['call']>[0]) {
        for (const name of skillTools) expect(request.tools?.map((t) => t.name)).toContain(name);
        const text = request.messages?.filter((m) => m.role === 'tool').at(-1)?.content;
        const last = typeof text === 'string' ? JSON.parse(text) : undefined;
        this.trace.push(last);
        const round = this.round++;
        if (round === 2) this.version = last.skill.skillVersionId;
        if (round > 0) expect(last.ok).toBe(true);
        let toolCall: ProviderToolCall | undefined;
        if (round === 0) toolCall = call('list_skills', {});
        if (round === 1) toolCall = call('create_skill', { skillMd: skillMd() });
        if (round === 2) toolCall = call('read_skill', { skillVersionId: this.version });
        if (round === 3) toolCall = call('list_agent_resources', {});
        if (round === 4) {
          expect(
            last.approvedSkills.some(
              (s: { skillVersionId: string }) => s.skillVersionId === this.version,
            ),
            JSON.stringify(last),
          ).toBe(true);
          for (const [index, target] of [
            'agent-skill-user',
            'role-2',
            'role-3',
            'role-4',
            'role-5',
          ].entries()) {
            yield {
              type: 'tool-call' as const,
              toolCall: call(
                'update_agent',
                { agent: target, skillIds: [this.version] },
                'bind-role-' + index,
              ),
            };
          }
          yield { type: 'finished' as const, reason: 'tool-requests' as const };
          return;
        }
        if (toolCall) {
          yield { type: 'tool-call' as const, toolCall };
          yield { type: 'finished' as const, reason: 'tool-requests' as const };
        } else {
          yield { type: 'text-delta' as const, text: 'Skill 已登记并绑定，未启动工作。' };
          yield { type: 'finished' as const, reason: 'stop' as const };
        }
      }
    }
    const provider = new SkillBuilder();
    const f = await fixture(provider);
    try {
      for (let index = 2; index <= 5; index++)
        f.agents.create({
          id: ('role-' + index) as AgentId,
          name: '角色' + index,
          defaultModelId: 'fake-mini' as ModelId,
        });
      const approval = vi
        .spyOn(f.internal, 'requestChatToolApproval')
        .mockResolvedValue({ decision: 'approve', approvalId: 'fresh-skill-confirmation' });
      const start = vi.spyOn(f.teams, 'startRun');
      await f.internal.executeKernelRun(f.run.runId);
      expect(provider.round, JSON.stringify(provider.trace)).toBe(6);
      expect(approval).toHaveBeenCalledTimes(6);
      expect(
        approval.mock.calls.map(
          ([value]) => (value as { toolCall: ProviderToolCall }).toolCall.name,
        ),
      ).toEqual(['create_skill', ...Array(5).fill('update_agent')]);
      expect(f.skills.listVersions()).toHaveLength(1);
      for (const member of f.agents.list()) expect(member.skillIds).toEqual([provider.version]);
      expect(start).not.toHaveBeenCalled();
      const next = f.internal.prepareRunBinding({
        runId: 'after-binding',
        threadId: 'next-skill-thread',
        userText: '继续分析',
        globalAgentId: f.agent.id,
        track: 'agent',
      }).run;
      expect(next.skillVersionIds).toContain(provider.version);
    } finally {
      await f.close();
    }
  });
});

it('counts structured Skill/Agent/catalog results as progress but not identical repeats', () => {
  let seen: ReadonlySet<string> | undefined;
  let stagnant = 0;
  const results = [
    { ok: true, skills: [] },
    { ok: true, skill: { skillVersionId: 'sv-1', name: 'repo-to-agent' } },
    {
      ok: true,
      skill: { skillVersionId: 'sv-1', name: 'repo-to-agent' },
      sourceMd: 'registered source',
    },
    { ok: true, approvedSkills: [{ skillVersionId: 'sv-1' }], existingAgents: [{ id: 'agent-1' }] },
    { ok: true, agent: { id: 'agent-1', skillIds: ['sv-1'] } },
  ];
  for (const [index, result] of results.entries()) {
    const guard = evaluateToolLoopGuard({
      toolLoopRound: index + 1,
      completedResults: [{ toolCallId: 'call-' + index, content: JSON.stringify(result) }],
      seenFingerprints: seen,
      stagnantRounds: stagnant,
    });
    expect(guard.kind).toBe('continue');
    expect(guard.stagnantRounds).toBe(0);
    seen = guard.seenFingerprints;
    stagnant = guard.stagnantRounds;
  }
  for (let index = 0; index < 3; index++) {
    const guard = evaluateToolLoopGuard({
      toolLoopRound: index + 6,
      completedResults: [
        { toolCallId: 'different-call-' + index, content: JSON.stringify(results.at(-1)) },
      ],
      seenFingerprints: seen,
      stagnantRounds: stagnant,
    });
    expect(guard.kind).toBe(index === 2 ? 'force_final' : 'continue');
    seen = guard.seenFingerprints;
    stagnant = guard.stagnantRounds;
  }
});

describe('Skill proposal boundary regressions', () => {
  it('does not advertise native Skill tools without a Skill store', () => {
    const tools = toolsForExecutionMode('full-access', {
      conversationTrack: 'agent',
      includeAgentTools: true,
      includeSkillTools: false,
      agentManagementIntent: 'none',
      allowAgentDefinitionProposals: true,
    });
    for (const name of skillTools) expect(tools.map((t) => t.name)).not.toContain(name);
    expect(tools.map((t) => t.name)).toContain('update_agent');
  });
  it.each(['human-reply', 'human-work', 'peer-reply'] as const)(
    'allows definitions only on actual user chat replies: %s',
    async (scenario) => {
      const f = await fixture();
      try {
        f.run.track = 'team';
        const sender = scenario === 'peer-reply' ? 'agent:peer' : 'user:local';
        f.internal.collaborationThreadScopes.set(f.run.threadId, {
          taskKind: scenario === 'human-work' ? 'task' : 'reply',
          input: {
            task: { originMessageId: 'origin' },
            snapshot: {
              members: [{ id: sender, kind: scenario === 'peer-reply' ? 'agent' : 'user' }],
              messages: [
                {
                  id: 'origin',
                  senderMemberId: sender,
                  kind: 'chat',
                  blocks: [{ type: 'text', text: '把刚才的技能登记一下' }],
                },
              ],
            },
          },
        });
        const toolCall = call('create_skill', { skillMd: skillMd() });
        f.internal.recordDefinitionApproval(f.run, toolCall);
        const result = JSON.parse(await f.internal.executeChatSkillTool({ run: f.run, toolCall }));
        expect(result.ok).toBe(scenario === 'human-reply');
        expect(f.skills.listVersions()).toHaveLength(scenario === 'human-reply' ? 1 : 0);
      } finally {
        await f.close();
      }
    },
  );
  it('a Skill capability question stays read-only and does not ask for save approval', async () => {
    class Inspector extends FakeProvider {
      round = 0;
      override async *call(request: Parameters<FakeProvider['call']>[0]) {
        expect(request.tools?.map((t) => t.name)).toContain('create_skill');
        if (this.round++ === 0) {
          yield { type: 'tool-call' as const, toolCall: call('list_skills', {}) };
          yield { type: 'finished' as const, reason: 'tool-requests' as const };
        } else {
          yield { type: 'text-delta' as const, text: '支持登记与绑定 Skill，保存前确认。' };
          yield { type: 'finished' as const, reason: 'stop' as const };
        }
      }
    }
    const f = await fixture(new Inspector());
    try {
      f.run.userText = '你现在可以登记 Skill 吗？先告诉我就行';
      const approval = vi.spyOn(f.internal, 'requestChatToolApproval');
      await f.internal.executeKernelRun(f.run.runId);
      expect(approval).not.toHaveBeenCalled();
      expect(f.skills.listVersions()).toHaveLength(0);
      expect(f.agents.get(f.agent.id)?.skillIds).toEqual([]);
    } finally {
      await f.close();
    }
  });
  it('native denial stops import and does not bind or retry', async () => {
    class DeniedBuilder extends FakeProvider {
      round = 0;
      override async *call(request: Parameters<FakeProvider['call']>[0]) {
        if (this.round++ === 0) {
          yield {
            type: 'tool-call' as const,
            toolCall: call('create_skill', { skillMd: skillMd() }),
          };
          yield { type: 'finished' as const, reason: 'tool-requests' as const };
        } else {
          const last = request.messages?.filter((m) => m.role === 'tool').at(-1)?.content;
          expect(typeof last === 'string' ? JSON.parse(last).deniedBy : undefined).toBe('user');
          yield { type: 'text-delta' as const, text: '登记已停止，未修改绑定。' };
          yield { type: 'finished' as const, reason: 'stop' as const };
        }
      }
    }
    const provider = new DeniedBuilder();
    const f = await fixture(provider);
    try {
      const approval = vi
        .spyOn(f.internal, 'requestChatToolApproval')
        .mockResolvedValue({ decision: 'deny' });
      await f.internal.executeKernelRun(f.run.runId);
      expect(provider.round).toBe(2);
      expect(approval).toHaveBeenCalledTimes(1);
      expect(f.skills.listVersions()).toHaveLength(0);
      expect(f.agents.get(f.agent.id)?.skillIds).toEqual([]);
    } finally {
      await f.close();
    }
  });
  it('late external approval after cancellation never imports a Skill', async () => {
    const f = await fixture();
    const controller = new AbortController();
    try {
      setKernelMcpServerConditions({ hasAgentStore: true, hasSkillStore: true });
      f.internal.platformMcpRuns.setCatalog(
        f.run.runId,
        selectKernelMcpRun({
          kernelId: 'codex',
          conversationTrack: 'agent',
          agentManagementIntent: 'none',
          allowAgentDefinitionProposals: true,
        }).externalTools,
      );
      vi.spyOn(f.internal, 'requestPlatformToolApproval').mockImplementation(async () => {
        controller.abort();
        return 'approve';
      });
      const args = { skillMd: skillMd() };
      const result = await f.internal.executePlatformMcpToolCall(
        f.run.runId,
        f.run,
        '.',
        { id: 'late-import', tool: 'create_skill', input: args, signal: controller.signal },
        JSON.stringify(args),
      );
      expect(result.ok).toBe(false);
      expect(f.skills.listVersions()).toHaveLength(0);
    } finally {
      await f.close();
    }
  });
});

describe('Skill declaration edits through the actual approval lifecycle', () => {
  it.each(['native', 'external'] as const)('persists the human-narrowed source for %s execution', async mode => {
    const f = await fixture();
    const internal = f.internal as unknown as { activeToolApprovals: import('./active-tool-approval.js').ActiveToolApprovalLifecycle; handleConversationDecideToolApproval(socket: unknown, frame: unknown): void };
    try {
      const args = { skillMd: skillMd().replace('version: 1.0.0', 'version: 1.0.0\nallowed-tools: ["read_file", "write_file"]') };
      const signal = new AbortController().signal;
      const native = call('create_skill', args, 'narrowed');
      let waiting: Promise<unknown>;
      if (mode === 'native') waiting = f.internal.requestChatToolApproval({ runId: f.run.runId, threadId: f.run.threadId, toolCall: native, signal });
      else {
        setKernelMcpServerConditions({ hasAgentStore: true, hasSkillStore: true });
        f.internal.platformMcpRuns.setCatalog(f.run.runId, selectKernelMcpRun({ kernelId: 'codex', conversationTrack: 'agent', agentManagementIntent: 'none', allowAgentDefinitionProposals: true }).externalTools);
        waiting = f.internal.executePlatformMcpToolCall(f.run.runId, f.run, '.', { id: 'narrowed', tool: 'create_skill', input: args, signal }, JSON.stringify(args));
      }
      await vi.waitFor(() => expect(internal.activeToolApprovals.size).toBe(1));
      const approvalId = internal.activeToolApprovals.firstId()!;
      const socket = { write: vi.fn() };
      internal.handleConversationDecideToolApproval(socket, { id: 'human', payload: { approvalId, decision: 'approve', scope: 'once', excludedSkillTools: ['write_file'] } });
      const result = await waiting;
      expect(socket.write).toHaveBeenCalled();
      if (mode === 'native') {
        expect(result).toMatchObject({ decision: 'approve' });
        f.internal.recordDefinitionApproval(f.run, native);
        expect(JSON.parse(await f.internal.executeChatSkillTool({ run: f.run, toolCall: native })).ok).toBe(true);
        expect(JSON.parse(await f.internal.executeChatSkillTool({ run: f.run, toolCall: native })).ok).toBe(false); // One shot.
      } else expect(result).toMatchObject({ ok: true });
      expect(f.skills.listVersions()).toHaveLength(1);
      const stored = f.skills.listVersions()[0]!;
      expect(stored.allowedTools).toEqual(['read_file']);
      expect(stored.sourceMd).toContain('allowed-tools: ["read_file"]');
      expect(stored.sourceMd).not.toContain('write_file');
    } finally { await f.close(); }
  });
  it('keeps the original request pending when the caller names a tool outside the proposal', async () => {
    const f = await fixture();
    const internal = f.internal as unknown as { activeToolApprovals: import('./active-tool-approval.js').ActiveToolApprovalLifecycle; handleConversationDecideToolApproval(socket: unknown, frame: unknown): void };
    try {
      const native = call('create_skill', { skillMd: skillMd().replace('version: 1.0.0', 'version: 1.0.0\nallowed-tools: ["read_file"]') });
      const waiting = f.internal.requestChatToolApproval({ runId: f.run.runId, threadId: f.run.threadId, toolCall: native, signal: new AbortController().signal });
      const original = native.argumentsJson;
      const approvalId = internal.activeToolApprovals.firstId()!;
      internal.handleConversationDecideToolApproval({ write: vi.fn() }, { id: 'invalid', payload: { approvalId, decision: 'approve', excludedSkillTools: ['shell-exec'] } });
      expect(internal.activeToolApprovals.size).toBe(1);
      expect(native.argumentsJson).toBe(original);
      expect(f.skills.listVersions()).toHaveLength(0);
      internal.handleConversationDecideToolApproval({ write: vi.fn() }, { id: 'deny', payload: { approvalId, decision: 'deny' } });
      expect(await waiting).toMatchObject({ decision: 'deny' });
    } finally { await f.close(); }
  });
});


describe('unbudgeted native root task continuation', () => {
  it.each(['model', 'agent'] as const)('finishes a %s task beyond 64k aggregate output, resumes reasoning-only truncation, and executes an approved mutation once', async (track) => {
    class LongRootTask extends FakeProvider {
      round = 0;
      version = '';
      override async *call(request: Parameters<FakeProvider['call']>[0]) {
        const round = this.round++;
        expect(request.toolChoice).not.toBe('none');
        expect(request.messages?.some(m => m.role === 'user' && typeof m.content === 'string' && m.content.includes('把刚才的技能登记'))).toBe(true);
        if (round === 0) {
          expect(request.maxOutputTokens).toBe(7680);
          yield { type: 'usage' as const, tokensIn: 20, tokensOut: 63_900 };
          yield { type: 'tool-call' as const, toolCall: call('list_skills', {}, 'evidence') };
          yield { type: 'finished' as const, reason: 'tool-requests' as const };
        } else if (round === 1) {
          yield { type: 'usage' as const, tokensIn: 20, tokensOut: 200 };
          yield { type: 'tool-call' as const, toolCall: call('create_skill', { skillMd: skillMd() }, 'register-once') };
          yield { type: 'finished' as const, reason: 'tool-requests' as const };
        } else if (round === 2) {
          const result = JSON.parse(request.messages?.filter(m => m.role === 'tool').at(-1)?.content as string);
          expect(result.ok).toBe(true);
          this.version = result.skill.skillVersionId;
          expect(request.maxOutputTokens).toBe(7680);
          yield { type: 'usage' as const, tokensIn: 20, tokensOut: 2048, reasoningTokens: 2048 };
          yield { type: 'finished' as const, reason: 'length' as const };
        } else {
          expect(round).toBe(3);
          expect(request.maxOutputTokens).toBe(15360);
          expect(request.messages?.filter(m => m.role === 'system' && typeof m.content === 'string' && m.content.includes('[宿主任务续接]'))).toHaveLength(1);
          const result = JSON.parse(request.messages?.filter(m => m.role === 'tool').at(-1)?.content as string);
          expect(result).toMatchObject({ ok: true, skill: { skillVersionId: this.version } });
          yield { type: 'text-delta' as const, text: 'Skill 已登记，交付完成。' };
          yield { type: 'finished' as const, reason: 'stop' as const };
        }
      }
    }
    const provider = new LongRootTask();
    const f = await fixture(provider, { track });
    try {
      const events: Event[] = [];
      vi.spyOn(f.internal, 'publishEvent').mockImplementation(event => { events.push(event); });
      const approval = vi.spyOn(f.internal, 'requestChatToolApproval').mockResolvedValue({ decision: 'approve', approvalId: 'fresh-confirmation' });
      await f.internal.executeKernelRun(f.run.runId);
      expect(provider.round).toBe(4);
      expect(approval).toHaveBeenCalledTimes(1);
      expect(f.skills.listVersions()).toHaveLength(1);
      expect(events.filter(e => e.type === 'run.continuing')).toHaveLength(1);
      expect(events.filter(e => e.type === 'run.failed')).toHaveLength(0);
      expect(events.filter(e => e.type === 'run.completed')).toHaveLength(1);
      expect(events.filter(e => e.type.startsWith('run.')).every(e => e.runId === f.run.runId)).toBe(true);
    } finally { await f.close(); }
  });

  it('allows more than 128 productive root operations without forcing a premature summary', async () => {
    class ProductiveRoot extends FakeProvider {
      round = 0;
      override async *call(request: Parameters<FakeProvider['call']>[0]) {
        expect(request.toolChoice).not.toBe('none');
        if (this.round++ < 130) {
          yield { type: 'tool-call' as const, toolCall: call('list_skills', {}, 'read-' + this.round) };
          yield { type: 'finished' as const, reason: 'tool-requests' as const };
        } else {
          yield { type: 'text-delta' as const, text: '已完成全部核验。' };
          yield { type: 'finished' as const, reason: 'stop' as const };
        }
      }
    }
    const provider = new ProductiveRoot();
    const f = await fixture(provider);
    try {
      let revision = 0;
      vi.spyOn(f.internal, 'executeChatSkillTool').mockImplementation(async () => JSON.stringify({ ok: true, evidence: ++revision }));
      await f.internal.executeKernelRun(f.run.runId);
      expect(provider.round).toBe(131);
      expect(revision).toBe(130);
    } finally { await f.close(); }
  });

  it('stops repeated empty truncated responses instead of charging for an infinite retry loop', async () => {
    class EmptyRoot extends FakeProvider {
      round = 0;
      override async *call() {
        this.round++;
        yield { type: 'finished' as const, reason: 'length' as const };
      }
    }
    const provider = new EmptyRoot();
    const f = await fixture(provider);
    try {
      const events: Event[] = [];
      vi.spyOn(f.internal, 'publishEvent').mockImplementation(event => { events.push(event); });
      await f.internal.executeKernelRun(f.run.runId);
      expect(provider.round).toBe(3);
      expect(events.filter(e => e.type === 'run.continuing')).toHaveLength(2);
      const failure = events.find(e => e.type === 'run.failed');
      expect(failure?.payload).toMatchObject({ failureClass: 'output_limit', errorMessage: expect.stringContaining('没有新增进展') });
      expect(events.some(e => e.type === 'run.completed')).toBe(false);
    } finally { await f.close(); }
  });

  it('keeps cancellation effective during automatic continuation', async () => {
    class CancelRoot extends FakeProvider {
      round = 0;
      cancel?: () => void;
      override async *call(request: Parameters<FakeProvider['call']>[0]) {
        if (this.round++ === 0) {
          yield { type: 'text-delta' as const, text: '已读取证据。' };
          yield { type: 'finished' as const, reason: 'length' as const };
        } else {
          this.cancel!();
          expect(request.signal?.aborted).toBe(true);
          yield { type: 'finished' as const, reason: 'length' as const };
        }
      }
    }
    const provider = new CancelRoot();
    const f = await fixture(provider);
    try {
      provider.cancel = () => f.internal.demoRunAbortRegistry.abort(f.run.runId);
      await f.internal.executeKernelRun(f.run.runId);
      expect(provider.round).toBe(2);
    } finally { await f.close(); }
  });
});


describe('truncated native tool proposals', () => {
  it('does not execute or replay an unadmitted tool proposal from an incomplete response', async () => {
    class TruncatedTool extends FakeProvider {
      round = 0;
      override async *call(request: Parameters<FakeProvider['call']>[0]) {
        if (this.round++ === 0) {
          yield { type: 'text-delta' as const, text: '资料已读取，准备登记。' };
          yield { type: 'tool-call' as const, toolCall: call('create_skill', { skillMd: skillMd() }, 'truncated-proposal') };
          yield { type: 'finished' as const, reason: 'length' as const };
        } else {
          expect(request.messages?.some(m => Array.isArray(m.content) && m.content.some(block => block.type === 'tool-call'))).toBe(false);
          expect(request.messages?.some(m => m.role === 'assistant' && m.content === '资料已读取，准备登记。')).toBe(true);
          yield { type: 'text-delta' as const, text: '已核对现有结果。' };
          yield { type: 'finished' as const, reason: 'stop' as const };
        }
      }
    }
    const provider = new TruncatedTool();
    const f = await fixture(provider);
    try {
      const events: Event[] = [];
      vi.spyOn(f.internal, 'publishEvent').mockImplementation(event => { events.push(event); });
      const approval = vi.spyOn(f.internal, 'requestChatToolApproval');
      await f.internal.executeKernelRun(f.run.runId);
      expect(provider.round).toBe(2);
      expect(approval).not.toHaveBeenCalled();
      expect(f.skills.listVersions()).toHaveLength(0);
      expect(events.some(e => e.type === 'run.completed')).toBe(true);
      expect(events.some(e => e.type === 'run.failed')).toBe(false);
    } finally { await f.close(); }
  });
});


describe('Responses gateway to native continuation', () => {
  it('continues real parsed SSE truncation in the same run without admitting partial writes', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      bodies.push(JSON.parse(init!.body as string));
      const first = bodies.length === 1;
      const response = first ? {
        status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' },
        output: [{ type: 'function_call', call_id: 'partial-write', name: 'create_skill', arguments: '{"skillMd":' }],
        usage: { input_tokens: 20, output_tokens: 2048, output_tokens_details: { reasoning_tokens: 2048 } },
      } : { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '剩余核验已完成。' }] }] };
      return new Response('data: ' + JSON.stringify({ type: first ? 'response.incomplete' : 'response.completed', response }) + '\n\n', {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });
    class GatewayRoot extends FakeProvider {
      adapter = new OpenAIResponsesAdapter({ fetchImpl });
      override async *call(request: Parameters<FakeProvider['call']>[0]) {
        yield* this.adapter.call({ ...request, protocol: 'openai-responses', baseUrl: 'https://gateway.fixture.test/v1', modelId: 'deepseek-flash', apiKey: 'fixture-token' });
      }
    }
    const f = await fixture(new GatewayRoot(), { track: 'model' });
    try {
      const events: Event[] = [];
      vi.spyOn(f.internal, 'publishEvent').mockImplementation(event => { events.push(event); });
      const approval = vi.spyOn(f.internal, 'requestChatToolApproval');
      await f.internal.executeKernelRun(f.run.runId);
      expect(bodies).toHaveLength(2);
      expect(bodies[0]?.max_output_tokens).toBe(7680);
      expect(bodies[1]?.max_output_tokens).toBe(15360);
      expect(JSON.stringify(bodies[1]?.input)).not.toContain('partial-write');
      expect(JSON.stringify(bodies[1])).toContain('[宿主任务续接]');
      expect(JSON.stringify(bodies[1])).toContain('把刚才的技能登记');
      expect(approval).not.toHaveBeenCalled();
      expect(f.skills.listVersions()).toHaveLength(0);
      expect(events.filter(e => e.type === 'run.continuing')).toHaveLength(1);
      expect(events.filter(e => e.type === 'run.completed')).toHaveLength(1);
      expect(events.some(e => e.type === 'run.failed')).toBe(false);
    } finally { await f.close(); }
  });

  it.each(['goal', 'delegated'] as const)('does not auto-continue an explicitly budgeted %s run', async boundary => {
    class BudgetedTruncation extends FakeProvider {
      round = 0;
      override async *call() {
        this.round++;
        yield { type: 'text-delta' as const, text: '已保留部分分析。' };
        yield { type: 'finished' as const, reason: 'length' as const };
      }
    }
    const provider = new BudgetedTruncation();
    const f = await fixture(provider, { goalBudgeted: boundary === 'goal', bindThread: boundary === 'delegated' });
    try {
      if (boundary === 'delegated') {
        f.run.delegationParentRunId = 'budgeted-parent' as RunId;
        f.run.delegationTokenBudget = 10_000;
      }
      const events: Event[] = [];
      vi.spyOn(f.internal, 'publishEvent').mockImplementation(event => { events.push(event); });
      await f.internal.executeKernelRun(f.run.runId);
      expect(provider.round).toBe(1);
      expect(events.some(e => e.type === 'run.continuing')).toBe(false);
      expect(events.find(e => e.type === 'run.failed')?.payload).toMatchObject({ failureClass: 'output_limit' });
    } finally { await f.close(); }
  });
});
