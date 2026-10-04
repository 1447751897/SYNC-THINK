import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { FakeProvider, type ProviderCallRequest, type AdapterEvent } from '@sync-think/adapters';
import { openDatabaseAsync, runMigrations, SqliteConversationStore, SqliteEventCheckpointStore, SqliteGlobalAgentStore, SqliteWorkspaceStore } from '@sync-think/storage';
import type { AgentId, ModelId, WorkspaceId } from '@sync-think/shared';
import { Runtime } from './runtime.js';
import type { DemoRunState } from './demo-run.js';
import type { CollaborationExecutionInput } from './collaboration-chat-service.js';

class BrowserProbeProvider extends FakeProvider {
  requests: ProviderCallRequest[] = [];
  outputs: string[] = [];
  constructor(private readonly calls: Array<{ name: string; args: object }>) { super(); }
  override async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.requests.push(request);
    const last = request.messages?.filter(m => m.role === 'tool').at(-1);
    if (last?.role === 'tool') this.outputs.push(String(last.content));
    const call = this.calls[this.requests.length - 1];
    if (call) {
      yield { type: 'tool-call', toolCall: { id: 'probe-' + this.requests.length, name: call.name, argumentsJson: JSON.stringify(call.args) } };
      yield { type: 'finished', reason: 'tool-requests' };
    } else {
      yield { type: 'assistant-message-delta', phase: 'final_answer', text: '核验结束' };
      yield { type: 'finished', reason: 'stop' };
    }
  }
}
async function browserFixture(available: boolean, provider: BrowserProbeProvider, executionMode?: string) {
  const directory = mkdtempSync(join(tmpdir(), 'collaboration-browser-'));
  const path = join(directory, 'test.db'); await runMigrations(path);
  const connection = await openDatabaseAsync({ path });
  const workspaceStore = new SqliteWorkspaceStore(connection.raw);
  workspaceStore.createWorkspace({ id: 'browser-workspace' as WorkspaceId, name: 'BGM调研', folderPath: directory });
  const agents = new SqliteGlobalAgentStore(connection.raw);
  const agent = agents.create({ id: 'browser-agent' as AgentId, name: '采集解析', persona: '只处理商品标题；必须配置 category_list、cookies 和 webhook，缺一即停。', defaultModelId: 'fake-mini' as ModelId });
  const conversations = new SqliteConversationStore(connection.raw);
  if (executionMode) conversations.create({ id: 'browser-room' as import('@sync-think/shared').ConversationId, target: { track: 'agent', agentId: agent.id }, workspaceId: 'browser-workspace' as WorkspaceId, title: '音乐调研', collaborationKind: 'group', executionMode });
  const runtime = new Runtime({ ...(executionMode ? { conversationStore: conversations } : {}), installId: 'browser-probe', allowNoToken: true, workspaceStore, globalAgentStore: agents, stateStore: new SqliteEventCheckpointStore(connection.raw), demoProvider: provider });
  Object.defineProperty(runtime, 'useEmbeddedBrowser', { value: true });
  const controller = { recordPermissionDecision: vi.fn(), listWaitingHandoffs: () => [], evaluatePermission: vi.fn(() => ({ decision: 'allow' })), execute: vi.fn(async (input: { toolName: string }) => JSON.stringify({ ok: true, url: 'https://example.com/chart', text: input.toolName === 'browser_read' ? '音乐榜 2026-10-01 曲目甲' : undefined })) };
  // Browser Worker is the boundary stub; admission, provider catalogs and native tool routing remain real.
  if (available) Object.defineProperty(runtime, 'browserController', { value: controller });
  const now = new Date().toISOString();
  const input: CollaborationExecutionInput = {
    snapshot: { conversation: { id: 'browser-room', workspaceId: 'browser-workspace', kind: 'group', title: '音乐调研', coordinatorMemberId: 'agent:browser-agent', createdAt: now, policy: { allowPeerDirect: false, maxConcurrent: 3, maxMessageHops: 6, maxAutoMessages: 12, taskTimeoutSeconds: 120, statusTimeoutSeconds: 120, networkEnabled: true }, room: { version: 1, state: 'running', goal: '公开研究曲目，不配置商品采集，不外发', goalRevision: 1, goalOrigin: 'user', sourceSequence: 0, checkpoint: { version: 1, savedAt: now, completedTaskIds: [], pendingTaskIds: [], artifactIds: [], note: '' } } }, members: [{ id: 'agent:browser-agent', kind: 'agent', agentId: String(agent.id), name: '采集解析', avatar: '', role: '采集', active: true }], messages: [], deliveries: [], tasks: [], attempts: [], revision: 0, receipts: {} },
    task: { id: 'browser-task', rootTaskId: 'browser-task', originMessageId: 'user-message', assigneeMemberId: 'agent:browser-agent', title: '读取公开音乐榜', instructions: '读取公开音乐榜；不连接账户，不配置商品采集', expectedOutput: '', dependsOnTaskIds: [], contextRefs: [], resourceClaims: [{ key: 'external-tools', mode: 'read' }], returnTo: { conversationId: 'browser-room', replyToMessageId: 'user-message' }, timeoutSeconds: 120, currentAttemptId: 'browser-attempt', kind: 'task', purpose: 'coordination', goalRevision: 1, createdAt: now },
    attempt: { id: 'browser-attempt', taskId: 'browser-task', number: 1, status: 'running', threadId: 'browser-thread', runId: 'browser-run', startedAt: now, updatedAt: now, contextSequence: 0, output: '', resourceClaims: [], tools: [], checklist: [] },
    signal: new AbortController().signal, onProgress: () => {},
  };
  return { runtime, input, controller, close: async () => { await runtime.stop(); connection.raw.close(); rmSync(directory, { recursive: true, force: true }); } };
}

it('lets a network-enabled read-only group open and read a rendered public page through the native loop', async () => {
  const provider = new BrowserProbeProvider([{ name: 'browser_open', args: { url: 'https://example.com/chart' } }, { name: 'browser_read', args: {} }]);
  const f = await browserFixture(true, provider);
  try {
    const result = await f.runtime.executeCollaborationTaskForHost(f.input);
    expect(result.error).toBeUndefined();
    const names = provider.requests[0].tools?.map(t => t.name) ?? [];
    expect(names).toEqual(expect.arrayContaining(['browser_open', 'browser_read']));
    expect(names).not.toEqual(expect.arrayContaining(['browser_click']));
    expect(names).not.toContain('browser_type'); expect(names).not.toContain('browser_screenshot'); expect(names).not.toContain('write_file');
    expect(f.controller.execute.mock.calls.map(([v]) => v.toolName)).toEqual(['browser_open', 'browser_read']);
    expect(f.controller.execute.mock.calls.every(([v]) => !(v as { worker?: unknown }).worker)).toBe(true);
    expect(provider.outputs.join('\n')).toContain('音乐榜 2026-10-01');
    expect(provider.requests[0].systemPrompt).toContain('当前用户请求和已确认群聊目标');
    expect(provider.requests[0].systemPrompt).not.toContain('Follow this persona / system instructions exactly');
    expect(provider.requests[0].systemPrompt).toContain('只处理商品标题');
  } finally { await f.close(); }
});
it.each([false, true])('does not offer rendered reading without both networking and Browser Worker (network=%s)', async network => {
  const provider = new BrowserProbeProvider([{ name: 'browser_read', args: {} }]);
  const f = await browserFixture(!network, provider); f.input.snapshot.conversation.policy.networkEnabled = network;
  try {
    const result = await f.runtime.executeCollaborationTaskForHost(f.input); expect(result.error).toBeUndefined();
    const names = provider.requests[0].tools?.map(t => t.name) ?? [];
    expect(names).not.toContain('browser_open'); expect(names).not.toContain('browser_read');
    expect(f.controller.execute).not.toHaveBeenCalled();
    expect(provider.outputs.join('\n')).toContain('仅允许读取');
    if (network) { expect(provider.requests[0].systemPrompt).toContain('Rendered browser reading is unavailable'); expect(provider.requests[0].systemPrompt).not.toContain('ALWAYS browser_open'); }
  } finally { await f.close(); }
});
it('keeps stateful browser operations blocked even if a group model fabricates a call', async () => {
  const provider = new BrowserProbeProvider([{ name: 'browser_click', args: { selector: '#send' } }, { name: 'browser_type', args: { selector: '#message', text: 'send' } }, { name: 'browser_screenshot', args: {} }]);
  const f = await browserFixture(true, provider);
  try { await f.runtime.executeCollaborationTaskForHost(f.input); expect(f.controller.execute).not.toHaveBeenCalled(); expect(provider.outputs.length).toBeGreaterThan(0); expect(provider.outputs.every(v => v.includes('仅允许读取'))).toBe(true); }
  finally { await f.close(); }
});
it('does not loosen browser admission or persona for ordinary delegated children', async () => {
  const provider = new BrowserProbeProvider([]); const f = await browserFixture(true, provider);
  try {
    const internal = f.runtime as unknown as { prepareRunBinding(input: object): { run: DemoRunState }; buildDefaultProviderContextSnapshot(run: DemoRunState, options: object): { providerRequest: { systemPrompt: string; tools?: Array<{ name: string }> } } };
    const { run } = internal.prepareRunBinding({ runId: 'plain-run', threadId: 'plain-child', track: 'agent', globalAgentId: 'browser-agent', userText: 'research', networkEnabled: true }); run.delegatedReadOnly = true;
    const request = internal.buildDefaultProviderContextSnapshot(run, { messages: [{ role: 'user', content: 'research' }], toolsEnabled: true, networkEnabled: true, executionMode: 'full-access' }).providerRequest;
    expect(request.tools?.map(t => t.name)).not.toContain('browser_read'); expect(request.tools?.map(t => t.name)).not.toContain('browser_open');
    expect(request.systemPrompt).toContain('Follow this persona / system instructions exactly');
  } finally { await f.close(); }
});

it('publishes waiting_input for group origin approval and restores running after a one-shot decision', async () => {
  const provider = new BrowserProbeProvider([{ name: 'browser_open', args: { url: 'https://example.com/chart' } }]);
  const f = await browserFixture(true, provider);
  const progress: Array<{ status?: string }> = [];
  f.input.onProgress = value => progress.push(value);
  f.controller.evaluatePermission.mockReturnValue({ decision: 'approval-required' });
  const internal = f.runtime as unknown as { activeToolApprovals: import('./active-tool-approval.js').ActiveToolApprovalLifecycle; emitToolApprovalDecided(input: object): unknown };
  const execution = f.runtime.executeCollaborationTaskForHost(f.input);
  try {
    await vi.waitFor(() => expect(internal.activeToolApprovals.size).toBe(1));
    expect(progress.at(-1)?.status).toBe('waiting_input');
    expect(f.controller.execute).not.toHaveBeenCalled();
    const approvalId = internal.activeToolApprovals.firstId()!;
    const approval = internal.activeToolApprovals.get(approvalId)!;
    internal.activeToolApprovals.settle(approvalId, 'approve', () => internal.emitToolApprovalDecided({ approvalId, threadId: approval.threadId, runId: approval.runId, decision: 'approve', toolCallId: approval.toolCall.id, toolName: approval.toolCall.name }));
    expect((await execution).error).toBeUndefined();
    expect(progress.some((value, index) => value.status === 'waiting_input' && progress.slice(index + 1).some(next => next.status === 'running'))).toBe(true);
    expect(f.controller.execute).toHaveBeenCalledTimes(1);
  } finally { internal.activeToolApprovals.settleAll('deny'); await execution; await f.close(); }
});

it('respects a group full-access choice for public-page approval without exposing write tools', async () => {
  const provider = new BrowserProbeProvider([{ name: 'browser_open', args: { url: 'https://example.com/chart' } }]);
  const f = await browserFixture(true, provider, 'full-access');
  f.controller.evaluatePermission.mockReturnValue({ decision: 'approval-required' });
  try {
    const result = await f.runtime.executeCollaborationTaskForHost(f.input); expect(result.error).toBeUndefined();
    expect(f.controller.execute).toHaveBeenCalledTimes(1);
    expect(f.controller.recordPermissionDecision).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'browser_open' }), 'allow', expect.stringContaining('auto-full-access'));
    const names = provider.requests[0].tools?.map(tool => tool.name) ?? [];
    expect(names).not.toContain('write_file'); expect(names).not.toContain('run_command'); expect(names).not.toContain('browser_type');
  } finally { await f.close(); }
});

it('the external-kernel browser permission and execution use the group-selected Profile, not the default account', async () => {
 const f=await browserFixture(true,new BrowserProbeProvider([]),'full-access');
 try {
  f.input.snapshot.conversation.policy.browserProfileId='account-a';
  const internal=f.runtime as unknown as {demoRuns:Map<string,DemoRunState>;collaborationThreadScopes:Map<string,unknown>;executeExternalKernelBrowserTool(...args:unknown[]):Promise<{ok:boolean}>};
  const run={runId:'external-profile-run',threadId:'browser-thread'} as DemoRunState;
  internal.demoRuns.set(String(run.runId),run);internal.collaborationThreadScopes.set(run.threadId,{input:f.input,taskKind:'task'});
  const input={url:'https://example.com/chart'};
  const response=await internal.executeExternalKernelBrowserTool(run.runId,run,'.',{id:'profile-open',tool:'browser_open',input,signal:new AbortController().signal},JSON.stringify(input),'full-access');
  expect(response.ok).toBe(true);expect(f.controller.evaluatePermission).toHaveBeenCalledWith(expect.objectContaining({profileId:'account-a'}));expect(f.controller.execute).toHaveBeenCalledWith(expect.objectContaining({profileId:'account-a'}));
 }finally{await f.close();}
});


it.each(['model', 'agent'] as const)('prioritizes the local data kit in %s chat context without altering user formats or browser permissions', async track => {
 const provider = new BrowserProbeProvider([]); const f = await browserFixture(false, provider);
 try {
  const internal = f.runtime as unknown as { prepareRunBinding(input: object): { run: DemoRunState }; buildDefaultProviderContextSnapshot(run: DemoRunState, options: object): { providerRequest: { systemPrompt: string } } };
  const {run} = internal.prepareRunBinding({runId:'data-'+track,threadId:'data-thread-'+track,track,...(track==='agent'?{globalAgentId:'browser-agent'}:{modelId:'fake-mini'}),userText:'请展示给定数据的表格与柱形图'});
  const context = internal.buildDefaultProviderContextSnapshot(run,{messages:[{role:'user',content:run.userText}],toolsEnabled:false,networkEnabled:false,executionMode:'ask'}).providerRequest;
  expect(context.systemPrompt).toContain('Data display preference (SYNC-THINK local BoardUI data components)');
  expect(context.systemPrompt).toContain('explicit user formats');
  expect(context.systemPrompt).toContain('application/json');
  expect(context.systemPrompt).toContain('AI design draft output contract (html)');
 } finally {await f.close();}
});
it('prioritizes the same data kit for a team member execution without adding browser access', async()=>{
 const provider = new BrowserProbeProvider([]);const f = await browserFixture(false,provider);f.input.snapshot.conversation.policy.networkEnabled=false;
 try{await f.runtime.executeCollaborationTaskForHost(f.input);expect(provider.requests[0].systemPrompt).toContain('Data display preference (SYNC-THINK local BoardUI data components)');expect(provider.requests[0].tools?.map(t=>t.name)).not.toContain('browser_open');}finally{await f.close();}
});
