import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { FakeProvider, type AdapterEvent, type ProviderCallRequest } from '@sync-think/adapters';
import { decodeFrames, type Frame } from '@sync-think/protocol';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteBrowserStore,
  SqliteScheduledTaskStore,
  SqliteConversationStore,
  SqliteMessageStore,
  SqliteCollaborationStore,
  SqliteEventCheckpointStore,
  SqliteGlobalAgentStore,
  SqliteTeamStore,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
import type { AgentId, ModelId, WorkspaceId, ConversationId } from '@sync-think/shared';
import type {
  BrowserWorker,
  BrowserWorkerInput,
  WorkerEvent,
  WorkerToken,
  BrowserLeaseInfo,
} from '@sync-think/workers';
import { Runtime } from './runtime.js';
import { CollaborationChatHost } from './collaboration-chat-host.js';

class LoginProvider extends FakeProvider {
  requests: ProviderCallRequest[] = [];
  loggedIn = false;
  workflowTaskId?: string;
  override async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.requests.push(request);
    const last = request.messages?.at(-1);
    const toolCall = request.messages
      ?.flatMap((message) =>
        message.role === 'assistant' && Array.isArray(message.content)
          ? message.content.flatMap((block) => (block.type === 'tool-call' ? [block.toolCall] : []))
          : [],
      )
      .find((call) => last?.role === 'tool' && call?.id === last.toolCallId);
    const name = toolCall?.name ?? '';
    const call =
      name === 'browser_workflow_execute'
        ? [
            'collaboration_submit_artifact',
            { content: '已复用审批过的操作流程并核对本轮结果。测试平台证据，非真实抖音榜单。' },
          ]
        : name === 'browser_open'
          ? ['browser_read', {}]
          : name === 'browser_read'
            ? last?.role === 'tool' && !String(last.content).includes('请先登录')
              ? [
                  'collaboration_submit_artifact',
                  {
                    content:
                      '搜索结果已核验：衬衫甲，互动量100。测试平台的可读结果，非抖音真实榜单。',
                  },
                ]
              : [
                  'collaboration_request_login',
                  { requestedOutcome: '登录测试平台后继续读取搜索结果' },
                ]
            : !name
              ? this.workflowTaskId
                ? ['browser_workflow_execute', { taskId: this.workflowTaskId }]
                : ['browser_open', { url: 'https://fixture.test/search' }]
              : undefined;
    if (call) {
      yield {
        type: 'tool-call',
        toolCall: {
          id: 'login-probe-' + this.requests.length,
          name: String(call[0]),
          argumentsJson: JSON.stringify(call[1]),
        },
      };
      yield { type: 'finished', reason: 'tool-requests' };
    } else {
      yield {
        type: 'assistant-message-delta',
        phase: 'final_answer',
        text: this.loggedIn ? '已核对真实搜索结果，交付本轮分析。' : '本轮等待登录，目标尚未完成。',
      };
      yield { type: 'finished', reason: 'stop' };
    }
  }
}
class ProfileWorker implements BrowserWorker {
  constructor(private readonly loggedIn: () => boolean) {}
  readonly kind = 'browser' as const;
  calls: BrowserWorkerInput[] = [];
  leases = new Map<string, BrowserLeaseInfo>();
  readGate?: Promise<void>;
  async *exec(input: BrowserWorkerInput, _token: WorkerToken): AsyncIterable<WorkerEvent> {
    this.calls.push(input);
    const lease = {
      leaseId: 'lease-' + input.ownerId,
      pageId: 'page-' + input.ownerId,
      profileId: input.profileId!,
      ownerId: input.ownerId!,
    };
    this.leases.set(lease.leaseId, lease);
    yield {
      type: 'completed',
      output: {
        ok: true,
        message: 'Fixture page',
        ...lease,
        url: 'https://fixture.test/search',
        text: '请先登录后查看搜索结果',
      },
    };
  }
  async acquireLease(input: { profileId: string; ownerId: string }) {
    const lease = { leaseId: 'lease-' + input.ownerId, pageId: 'page-' + input.ownerId, ...input };
    this.leases.set(lease.leaseId, lease);
    return lease;
  }
  async execute(input: { leaseId: string; action: BrowserWorkerInput['action'] }) {
    if (input.action.kind === 'read') await this.readGate;
    const lease = await this.inspectLease(input.leaseId);
    this.calls.push({
      profileId: lease.profileId,
      ownerId: lease.ownerId,
      action: input.action,
      workingDir: '.',
      allowedSites: ['https://fixture.test'],
    });
    return {
      ok: true as const,
      message: 'Fixture page',
      ...lease,
      url: 'https://fixture.test/search',
      title: '测试平台',
      text: this.loggedIn() ? '已登录，搜索结果：衬衫甲，互动量100。' : '请先登录后查看搜索结果',
    };
  }
  async shutdown() {}
  async inspectLease(id: string) {
    const lease = this.leases.get(id);
    if (!lease)
      throw Object.assign(new Error('missing lease'), { code: 'browser.lease-not-found' });
    return lease;
  }
  async recoverLease(lease: BrowserLeaseInfo) {
    this.leases.set(lease.leaseId, lease);
    return lease;
  }
  async releaseLease(id: string) {
    this.leases.delete(id);
  }
}
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'group-browser-automation-'));
  const path = join(root, 'test.db');
  await runMigrations(path);
  const connection = await openDatabaseAsync({ path });
  const workspaces = new SqliteWorkspaceStore(connection.raw);
  const workspace = workspaces.createWorkspace({
    id: 'automation-workspace' as WorkspaceId,
    name: 'QA',
    folderPath: root,
  });
  const agents = new SqliteGlobalAgentStore(connection.raw);
  const agent = agents.create({
    id: 'automation-agent' as AgentId,
    name: '研究员',
    defaultModelId: 'fake-mini' as ModelId,
  });
  const conversations = new SqliteConversationStore(connection.raw);
  const messages = new SqliteMessageStore(connection.raw);
  const repository = new SqliteCollaborationStore(connection.raw);
  const browser = new SqliteBrowserStore(connection.raw);
  browser.createProfile({ id: 'account-a', name: '账号A' });
  browser.createProfile({ id: 'account-b', name: '账号B' });
  const schedules = new SqliteScheduledTaskStore(connection.raw);
  const provider = new LoginProvider();
  const worker = new ProfileWorker(() => provider.loggedIn);
  let runtime: Runtime;
  let host: CollaborationChatHost;
  const createRuntime = () => {
    host = new CollaborationChatHost(repository, {
      ownerId: 'automation-owner',
      conversations,
      messages,
      agents,
      teams: new SqliteTeamStore(connection.raw),
      workspaces,
      execute: (input) => runtime.executeCollaborationTaskForHost(input),
      onChanged: (snapshot) => runtime?.publishCollaborationSnapshot(snapshot),
    });
    runtime = new Runtime({
      installId: 'group-automation-fixture',
      allowNoToken: true,
      projectlessDataDirectory: join(root, 'projectless'),
      workspaceStore: workspaces,
      conversationStore: conversations,
      globalAgentStore: agents,
      stateStore: new SqliteEventCheckpointStore(connection.raw),
      demoProvider: provider,
      browserStore: browser,
      browserHost: worker,
      browserFallbackWorkingDir: root,
      scheduledTaskStore: schedules,
      collaborationChatHost: host,
    });
  };
  createRuntime();
  const rpc = (type: string, payload: unknown): Promise<Frame> =>
    new Promise((resolve) => {
      (
        runtime as unknown as {
          handlers: { onFrame(socket: { write(data: Buffer): boolean }, frame: Frame): void };
        }
      ).handlers.onFrame(
        {
          write: (data) => {
            resolve(decodeFrames(data).frames[0]!);
            return true;
          },
        },
        { id: 'group-qa', kind: 'request', type, payload },
      );
    });
  const group = (name: string) =>
    host.command({
      action: 'create',
      clientRequestId: name,
      kind: 'group',
      title: name,
      workspaceId: workspace.id,
      agentIds: [agent.id],
    }).snapshot!;
  const snapshot = (id: string) => host.command({ action: 'get', conversationId: id }).snapshot!;
  const settle = async (id: string) => {
    for (let n = 0; n < 250; n++) {
      const s = snapshot(id);
      if (
        s.attempts.length &&
        !s.attempts.some((a) =>
          ['running', 'queued', 'waiting_input', 'stopping'].includes(a.status),
        )
      )
        return s;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('group did not settle');
  };
  cleanups.push(async () => {
    await runtime.stop();
    connection.raw.close();
    const target = resolve(root);
    if (
      dirname(target) !== resolve(tmpdir()) ||
      !basename(target).startsWith('group-browser-automation-')
    )
      throw new Error('Unexpected test cleanup target');
    rmSync(target, { recursive: true, force: true });
  });
  return {
    rpc,
    get runtime() {
      return runtime;
    },
    group,
    snapshot,
    settle,
    provider,
    worker,
    browser,
    schedules,
    conversations,
    workspace,
    agent,
    restart: async () => {
      await runtime.stop();
      worker.leases.clear();
      createRuntime();
    },
  };
}
it('binds independent account Profiles, rejects missing Profiles, and preserves group execution permissions', async () => {
  const f = await fixture();
  const a = f.group('shirts');
  const b = f.group('pants');
  const response = await f.rpc('collaboration.command', {
    action: 'policy',
    conversationId: a.conversation.id,
    policy: { browserProfileId: 'account-a', networkEnabled: true },
  });
  expect(response.error).toBeUndefined();
  await f.rpc('collaboration.command', {
    action: 'policy',
    conversationId: b.conversation.id,
    policy: { browserProfileId: 'account-b', networkEnabled: true },
  });
  expect(f.snapshot(a.conversation.id).conversation.policy.browserProfileId).toBe('account-a');
  expect(f.snapshot(b.conversation.id).conversation.policy.browserProfileId).toBe('account-b');
  const invalid = await f.rpc('collaboration.command', {
    action: 'policy',
    conversationId: a.conversation.id,
    policy: { browserProfileId: 'deleted-profile' },
  });
  expect(invalid.error?.message).toContain('profile_not_found');
  expect(f.snapshot(a.conversation.id).conversation.policy.browserProfileId).toBe('account-a');
});
it('yields on login, survives Runtime recreation, continues the same task once, and leaves another group alone', async () => {
  const f = await fixture();
  const a = f.group('shirts');
  const b = f.group('pants');
  const bBefore = f.snapshot(b.conversation.id);
  await f.rpc('collaboration.command', {
    action: 'policy',
    conversationId: a.conversation.id,
    policy: { browserProfileId: 'account-a', networkEnabled: true },
  });
  f.conversations.setExecutionMode(a.conversation.id as ConversationId, 'full-access');
  await f.rpc('collaboration.command', {
    action: 'send',
    conversationId: a.conversation.id,
    clientRequestId: 'first-search',
    intent: 'work',
    text: '查询爆款衬衫',
  });
  const blocked = await f.settle(a.conversation.id);
  expect(
    blocked.attempts.at(-1)?.error?.code,
    JSON.stringify(f.provider.requests.map((request) => request.messages?.slice(-2))),
  ).toBe('browser.login_required');
  expect(f.worker.calls.every((call) => call.profileId === 'account-a')).toBe(true);
  const waiting = await f.rpc('browser.handoff.listWaiting', { conversationId: a.conversation.id });
  const handoff = (waiting.payload as { handoffs: Array<{ handoffId: string }> }).handoffs[0];
  expect(handoff).toBeDefined();
  const other = await f.rpc('browser.handoff.listWaiting', { conversationId: b.conversation.id });
  expect(other.payload).toMatchObject({ handoffs: [] });
  await f.restart();
  const restored = await f.rpc('browser.handoff.listWaiting', {
    conversationId: a.conversation.id,
  });
  expect(restored.payload).toMatchObject({ handoffs: [{ handoffId: handoff.handoffId }] });
  f.provider.loggedIn = true;
  const decision = await f.rpc('browser.handoff.continue', {
    handoffId: handoff.handoffId,
    expectedRevision: 1,
  });
  expect(decision.error).toBeUndefined();
  const done = await f.settle(a.conversation.id);
  expect(done.tasks).toHaveLength(blocked.tasks.length);
  expect(done.tasks[0].id).toBe(blocked.tasks[0].id);
  expect(done.attempts.at(-1)?.status).toBe('succeeded');
  const again = await f.rpc('browser.handoff.continue', {
    handoffId: handoff.handoffId,
    expectedRevision: 1,
  });
  expect(again.payload).toMatchObject({ replayed: true });
  expect(f.snapshot(a.conversation.id).attempts).toHaveLength(done.attempts.length);
  expect(f.snapshot(b.conversation.id)).toEqual(bBefore);
});
it('a bound scheduled task enters the existing group and skips a paused group without false success', async () => {
  const f = await fixture();
  const a = f.group('monitor');
  const before = f.snapshot(a.conversation.id);
  const created = await f.rpc('scheduledTask.create', {
    name: 'shirt-monitor',
    instruction: '查询爆款衬衫',
    target: { kind: 'agent', agentId: f.agent.id },
    rule: { kind: 'every', intervalMinutes: 30 },
    workspaceId: f.workspace.id,
    collaborationConversationId: a.conversation.id,
    enabled: true,
  });
  expect(created.error).toBeUndefined();
  const task = (created.payload as { task: { id: string; conversationId: string } }).task;
  expect(task.conversationId).toBe(a.conversation.id);
  await f.rpc('collaboration.command', {
    action: 'room-pause',
    conversationId: a.conversation.id,
    clientRequestId: 'pause-monitor',
  });
  const paused = await f.rpc('scheduledTask.trigger', { taskId: task.id });
  expect(paused.payload).toMatchObject({ fired: false });
  expect(f.snapshot(a.conversation.id).tasks).toHaveLength(before.tasks.length);
  expect(f.schedules.get(task.id)?.lastResult?.status).toBe('skipped');
});

async function blockedLogin(f: Awaited<ReturnType<typeof fixture>>, name = 'login-room') {
  const group = f.group(name);
  await f.rpc('collaboration.command', {
    action: 'policy',
    conversationId: group.conversation.id,
    policy: { browserProfileId: 'account-a', networkEnabled: true },
  });
  f.conversations.setExecutionMode(group.conversation.id as ConversationId, 'full-access');
  await f.rpc('collaboration.command', {
    action: 'send',
    conversationId: group.conversation.id,
    clientRequestId: name + '-search',
    intent: 'work',
    text: '查询爆款衬衫',
  });
  const snapshot = await f.settle(group.conversation.id);
  const result = await f.rpc('browser.handoff.listWaiting', {
    conversationId: group.conversation.id,
  });
  const handoff = (result.payload as { handoffs: Array<{ handoffId: string }> }).handoffs[0];
  expect(handoff).toBeDefined();
  return { group, snapshot, handoff };
}
it('continuing without actually logging in blocks again instead of claiming completion', async () => {
  const f = await fixture();
  const { group, handoff } = await blockedLogin(f);
  const response = await f.rpc('browser.handoff.continue', {
    handoffId: handoff.handoffId,
    expectedRevision: 1,
  });
  expect(response.error).toBeUndefined();
  const next = await f.settle(group.conversation.id);
  expect(next.attempts.at(-1)?.error?.code).toBe('browser.login_required');
  expect(next.conversation.room?.state).not.toBe('completed');
  const waiting = await f.rpc('browser.handoff.listWaiting', {
    conversationId: group.conversation.id,
  });
  expect((waiting.payload as { handoffs: unknown[] }).handoffs).toHaveLength(1);
});
it('rejects stale login continuation after a Profile change without launching a new attempt', async () => {
  const f = await fixture();
  const { group, snapshot, handoff } = await blockedLogin(f);
  await f.rpc('collaboration.command', {
    action: 'policy',
    conversationId: group.conversation.id,
    policy: { browserProfileId: 'account-b' },
  });
  const result = await f.rpc('browser.handoff.continue', {
    handoffId: handoff.handoffId,
    expectedRevision: 1,
  });
  expect(result.error?.message).toContain('goal or Profile changed');
  expect(f.snapshot(group.conversation.id).attempts).toHaveLength(snapshot.attempts.length);
});
it('keeps explicitly paused groups paused when a login continuation is clicked', async () => {
  const f = await fixture();
  const { group, handoff } = await blockedLogin(f);
  await f.rpc('collaboration.command', {
    action: 'room-pause',
    conversationId: group.conversation.id,
    clientRequestId: 'pause-login',
  });
  const result = await f.rpc('browser.handoff.continue', {
    handoffId: handoff.handoffId,
    expectedRevision: 1,
  });
  expect(result.error?.message).toContain('Resume the group');
  expect(f.snapshot(group.conversation.id).conversation.room?.state).toBe('paused');
});
it('canceling a login handoff never completes or automatically retries the original task', async () => {
  const f = await fixture();
  const { group, snapshot, handoff } = await blockedLogin(f);
  const result = await f.rpc('browser.handoff.cancel', {
    handoffId: handoff.handoffId,
    expectedRevision: 1,
    leaseDisposition: 'preserve',
  });
  expect(result.error).toBeUndefined();
  const waiting = await f.rpc('browser.handoff.listWaiting', {
    conversationId: group.conversation.id,
  });
  expect(waiting.payload).toMatchObject({ handoffs: [] });
  expect(f.snapshot(group.conversation.id).attempts).toHaveLength(snapshot.attempts.length);
  expect(f.snapshot(group.conversation.id).conversation.room?.state).not.toBe('completed');
});
it('scheduled work skips a group waiting for login and rejects cross-workspace binding', async () => {
  const f = await fixture();
  const { group, snapshot } = await blockedLogin(f);
  const payload = {
    name: '监控',
    instruction: '查询衬衫',
    target: { kind: 'agent' as const, agentId: f.agent.id },
    rule: { kind: 'every' as const, intervalMinutes: 30 },
    collaborationConversationId: group.conversation.id,
    workspaceId: f.workspace.id,
  };
  const invalid = await f.rpc('scheduledTask.create', { ...payload, workspaceId: undefined });
  expect(invalid.error?.message).toContain('group_binding_invalid');
  const created = await f.rpc('scheduledTask.create', payload);
  const task = (created.payload as { task: { id: string } }).task;
  const result = await f.rpc('scheduledTask.trigger', { taskId: task.id });
  expect(result.payload).toMatchObject({ fired: false, reason: '等待登录，本轮合并跳过' });
  expect(f.snapshot(group.conversation.id).tasks).toHaveLength(snapshot.tasks.length);
});
it('scheduled work is admitted in its existing group and is recorded as failed when login is required', async () => {
  const f = await fixture();
  const group = f.group('scheduled-live');
  await f.rpc('collaboration.command', {
    action: 'policy',
    conversationId: group.conversation.id,
    policy: { networkEnabled: true, browserProfileId: 'account-a' },
  });
  f.conversations.setExecutionMode(group.conversation.id as ConversationId, 'full-access');
  const created = await f.rpc('scheduledTask.create', {
    name: '查询监控',
    instruction: '查询爆款衬衫',
    target: { kind: 'agent', agentId: f.agent.id },
    rule: { kind: 'every', intervalMinutes: 30 },
    workspaceId: f.workspace.id,
    collaborationConversationId: group.conversation.id,
  });
  const task = (created.payload as { task: { id: string } }).task;
  const result = await f.rpc('scheduledTask.trigger', { taskId: task.id });
  expect(result.payload).toMatchObject({ fired: true });
  const snapshot = await f.settle(group.conversation.id);
  expect(snapshot.tasks).toHaveLength(1);
  expect(f.schedules.get(task.id)?.lastResult?.status).toBe('failed');
  expect(f.schedules.get(task.id)?.conversationId).toBe(group.conversation.id);
});

function publishSearch(f: Awaited<ReturnType<typeof fixture>>) {
  const created = f.browser.createAutomationTaskDraft({
    profileId: 'account-a',
    name: '商品搜索复用',
    instruction: '按输入查询',
    startUrl: 'https://fixture.test/search',
    source: 'manual',
  });
  f.browser.createRecording({
    id: 'search-recording',
    profileId: 'account-a',
    ownerId: 'search-owner',
    expectedProfileRevision: 1,
  });
  f.browser.markRecordingStarted({
    id: 'search-recording',
    leaseId: 'recording-lease',
    pageId: 'recording-page',
  });
  f.browser.appendRecordingStep({
    recordingId: 'search-recording',
    step: { kind: 'navigate', url: 'https://fixture.test/search' },
  });
  f.browser.appendRecordingStep({
    recordingId: 'search-recording',
    step: {
      kind: 'fill',
      locator: { strategy: 'placeholder', value: 'Search' },
      value: { kind: 'variable', name: 'keyword' },
    },
  });
  f.browser.beginRecordingStop('search-recording', { stopReason: 'user' });
  f.browser.finishRecording('search-recording', { status: 'stopped', stopReason: 'user' });
  f.browser.attachWorkflowDraftRecording({
    draftId: created.draft.id,
    recordingId: 'search-recording',
  });
  f.browser.submitWorkflowDraft({ draftId: created.draft.id, recordingId: 'search-recording' });
  f.browser.reviewWorkflowDraft({ draftId: created.draft.id, decision: 'approve' });
  return f.browser.getAutomationTask(created.task.id)!;
}
it('the group reuses one published flow with shirts then pants, without recreating the flow or changing its Profile', async () => {
  const f = await fixture();
  const flow = publishSearch(f);
  const group = f.group('reusable-search');
  f.provider.workflowTaskId = flow.id;
  f.provider.loggedIn = true;
  f.conversations.setExecutionMode(group.conversation.id as ConversationId, 'full-access');
  await f.rpc('collaboration.command', {
    action: 'room-brief',
    conversationId: group.conversation.id,
    clientRequestId: 'generic-search-goal',
    goal: '分析本轮用户指定的商品，交付有证据的报告',
    expectedGoalRevision: group.conversation.room!.goalRevision,
  });
  for (const keyword of ['衬衫', '裤子']) {
    const bound = await f.rpc('collaboration.command', {
      action: 'policy',
      conversationId: group.conversation.id,
      policy: {
        networkEnabled: true,
        browserProfileId: 'account-a',
        browserWorkflowTaskId: flow.id,
        browserWorkflowVariables: { keyword },
      },
    });
    expect(bound.error).toBeUndefined();
    await f.rpc('collaboration.command', {
      action: 'send',
      conversationId: group.conversation.id,
      clientRequestId: 'search-' + keyword,
      intent: 'work',
      text: '查询爆款' + keyword,
    });
    const done = await f.settle(group.conversation.id);
    expect(done.attempts.at(-1)?.status, JSON.stringify(done.attempts.at(-1)?.error)).toBe(
      'succeeded',
    );
  }
  expect(
    f.worker.calls.filter((call) => call.action.kind === 'fill').map((call) => call.action),
  ).toMatchObject([{ text: '衬衫' }, { text: '裤子' }]);
  expect(f.browser.getAutomationTask(flow.id)?.publishedVersionId).toBe(flow.publishedVersionId);
});
it('does not allow the group to bind a published flow from a different account', async () => {
  const f = await fixture();
  const flow = publishSearch(f);
  const group = f.group('wrong-account');
  const response = await f.rpc('collaboration.command', {
    action: 'policy',
    conversationId: group.conversation.id,
    policy: { browserProfileId: 'account-b', browserWorkflowTaskId: flow.id },
  });
  expect(response.error?.message).toContain('workflow-binding-invalid');
  expect(
    f.snapshot(group.conversation.id).conversation.policy.browserWorkflowTaskId,
  ).toBeUndefined();
  expect(f.worker.calls).toHaveLength(0);
});
it('an explicit new goal invalidates an old login handoff', async () => {
  const f = await fixture();
  const { group, snapshot, handoff } = await blockedLogin(f);
  const changed = await f.rpc('collaboration.command', {
    action: 'room-brief',
    conversationId: group.conversation.id,
    clientRequestId: 'new-goal',
    goal: '改为视频规划，不继续商品搜索',
    expectedGoalRevision: snapshot.conversation.room!.goalRevision,
  });
  expect(changed.error).toBeUndefined();
  const response = await f.rpc('browser.handoff.continue', {
    handoffId: handoff.handoffId,
    expectedRevision: 1,
  });
  expect(response.error?.message).toContain('goal or Profile changed');
  expect(f.snapshot(group.conversation.id).attempts).toHaveLength(snapshot.attempts.length);
});

it('a busy monitor tick is merged and cannot erase the admitted round or duplicate its success history', async () => {
  const f = await fixture();
  const group = f.group('busy-monitor');
  f.provider.loggedIn = true;
  let release!: () => void;
  f.worker.readGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await f.rpc('collaboration.command', {
    action: 'policy',
    conversationId: group.conversation.id,
    policy: { networkEnabled: true, browserProfileId: 'account-a' },
  });
  f.conversations.setExecutionMode(group.conversation.id as ConversationId, 'full-access');
  const created = await f.rpc('scheduledTask.create', {
    name: '重复监控',
    instruction: '查询爆款衬衫',
    target: { kind: 'agent', agentId: f.agent.id },
    rule: { kind: 'every', intervalMinutes: 30 },
    workspaceId: f.workspace.id,
    collaborationConversationId: group.conversation.id,
  });
  const task = (created.payload as { task: { id: string } }).task;
  try {
    expect((await f.rpc('scheduledTask.trigger', { taskId: task.id })).payload).toMatchObject({
      fired: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await f.rpc('scheduledTask.trigger', { taskId: task.id });
    expect(second.payload).toMatchObject({
      fired: false,
      reason: '群聊工作尚未完成，本轮合并跳过',
    });
    expect(f.snapshot(group.conversation.id).tasks).toHaveLength(1);
    await f.rpc('scheduledTask.update', { taskId: task.id, patch: { enabled: false } });
    release();
    await f.settle(group.conversation.id);
    expect(f.schedules.get(task.id)?.lastResult?.status).toBe('success');
    expect(
      f.schedules.listHistory(task.id).filter((entry) => entry.status === 'success'),
    ).toHaveLength(1);
    const completedAt = f.schedules.get(task.id)!.lastResult!.firedAt;
    for (let i = 1; i <= 110; i++)
      f.schedules.addHistoryEntry({
        id: 'skip-' + i,
        taskId: task.id,
        status: 'skipped',
        firedAt: new Date(Date.parse(completedAt) + i * 1000).toISOString(),
      });
    await f.rpc('collaboration.command', {
      action: 'policy',
      conversationId: group.conversation.id,
      policy: { maxConcurrent: 2 },
    });
    expect(
      f.schedules.listHistory(task.id, 200).filter((entry) => entry.status === 'success'),
    ).toHaveLength(1);
  } finally {
    release();
  }
});

it('ordinary group discussion does not replay a bound workflow or produce a work artifact', async () => {
  const f = await fixture();
  const flow = publishSearch(f);
  const group = f.group('discussion-only');
  f.provider.workflowTaskId = flow.id;
  f.conversations.setExecutionMode(group.conversation.id as ConversationId, 'full-access');
  await f.rpc('collaboration.command', {
    action: 'policy',
    conversationId: group.conversation.id,
    policy: { networkEnabled: true, browserProfileId: 'account-a', browserWorkflowTaskId: flow.id },
  });
  await f.rpc('collaboration.command', {
    action: 'send',
    conversationId: group.conversation.id,
    clientRequestId: 'hello',
    intent: 'discussion',
    text: '你好，只讨论，不执行',
  });
  const done = await f.settle(group.conversation.id);
  expect(f.worker.calls).toHaveLength(0);
  expect(done.attempts.flatMap((attempt) => attempt.artifacts ?? [])).toHaveLength(0);
});
it('the workflow schedule requires website authorization and preserves both runtime input values and revision checks', async () => {
  const f = await fixture();
  const flow = publishSearch(f);
  const payload = {
    taskId: flow.id,
    enabled: true,
    intervalMinutes: 30,
    variables: { keyword: '衬衫' },
  };
  const missing = await f.rpc('browser.workflow.updateSchedule', payload);
  expect(missing.error?.message).toContain('请先试运行');
  expect(f.browser.getWorkflowSchedule(flow.id)).toBeUndefined();
  f.browser.upsertOriginGrant({
    scopeType: 'workflow',
    scopeId: flow.id,
    origin: 'https://fixture.test',
    action: 'navigate',
    decision: 'allow',
    approvalId: 'fixture-user',
  });
  const first = await f.rpc('browser.workflow.updateSchedule', payload);
  expect(first.error).toBeUndefined();
  expect(first.payload).toMatchObject({
    schedule: { variables: { keyword: '衬衫' }, revision: 1 },
  });
  const changed = await f.rpc('browser.workflow.updateSchedule', {
    ...payload,
    variables: { keyword: '裤子' },
    expectedRevision: 1,
  });
  expect(changed.payload).toMatchObject({
    schedule: { variables: { keyword: '裤子' }, revision: 2 },
  });
  const stale = await f.rpc('browser.workflow.updateSchedule', { ...payload, expectedRevision: 1 });
  expect(stale.error).toBeDefined();
  expect(f.browser.getWorkflowSchedule(flow.id)?.variables).toEqual({ keyword: '裤子' });
});

it('a model scheduling tool binds the trusted active group and cannot cancel another group monitor', async () => {
  const f = await fixture();
  const group = f.group('model-monitor');
  const other = f.group('other-monitor');
  f.provider.loggedIn = true;
  let release!: () => void;
  f.worker.readGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await f.rpc('collaboration.command', {
    action: 'policy',
    conversationId: group.conversation.id,
    policy: { networkEnabled: true, browserProfileId: 'account-a' },
  });
  f.conversations.setExecutionMode(group.conversation.id as ConversationId, 'full-access');
  await f.rpc('collaboration.command', {
    action: 'send',
    conversationId: group.conversation.id,
    clientRequestId: 'schedule-request',
    intent: 'work',
    text: '查询爆款衬衫，并创建定时监控',
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const internal = f.runtime as unknown as {
    demoRuns: Map<string, import('./demo-run.js').DemoRunState>;
    executeTaskScheduleTool(
      ...args: unknown[]
    ): Promise<{ ok: boolean; content?: string; error?: string }>;
  };
  const run = [...internal.demoRuns.values()].find(
    (run) => run.threadId === f.snapshot(group.conversation.id).attempts.at(-1)?.threadId,
  )!;
  expect(run).toBeDefined();
  try {
    const payload = {
      action: 'create',
      name: '模型创建的监控',
      instruction: '查询裤子',
      target: { kind: 'agent', agentId: f.agent.id },
      rule: { kind: 'every', intervalMinutes: 30 },
    };
    const result = await internal.executeTaskScheduleTool(
      run.runId,
      run,
      {
        id: 'model-schedule',
        tool: 'task_schedule',
        input: payload,
        signal: new AbortController().signal,
      },
      'full-access',
    );
    expect(result.ok).toBe(true);
    const created = f.schedules.list().find((task) => task.name === payload.name)!;
    expect(created).toMatchObject({
      conversationId: group.conversation.id,
      workspaceId: f.workspace.id,
    });
    const otherResult = await f.rpc('scheduledTask.create', {
      name: '别的群监控',
      instruction: payload.instruction,
      target: payload.target,
      rule: payload.rule,
      collaborationConversationId: other.conversation.id,
      workspaceId: f.workspace.id,
    });
    const otherId = (otherResult.payload as { task: { id: string } }).task.id;
    const cancel = await internal.executeTaskScheduleTool(
      run.runId,
      run,
      {
        id: 'wrong-cancel',
        tool: 'task_schedule',
        input: { action: 'cancel', taskId: otherId },
        signal: new AbortController().signal,
      },
      'full-access',
    );
    expect(cancel.ok).toBe(false);
    expect(f.schedules.get(otherId)?.enabled).toBe(true);
  } finally {
    release();
    await f.settle(group.conversation.id);
  }
});

it('an enabled periodic monitor starts a new round after its own accepted delivery without replaying old work', async () => {
  const f = await fixture(); f.provider.loggedIn = true;
  const group = f.group('accepted-monitor');
  await f.rpc('collaboration.command', { action: 'policy', conversationId: group.conversation.id, policy: { networkEnabled: true, browserProfileId: 'account-a' } });
  f.conversations.setExecutionMode(group.conversation.id as ConversationId, 'full-access');
  const created = await f.rpc('scheduledTask.create', { name: '周期监控', instruction: '查询爆款衬衫并交付文档', target: { kind: 'agent', agentId: f.agent.id }, rule: { kind: 'every', intervalMinutes: 30 }, workspaceId: f.workspace.id, collaborationConversationId: group.conversation.id, enabled: true });
  const task = (created.payload as { task: { id: string } }).task;
  expect((await f.rpc('scheduledTask.trigger', { taskId: task.id })).payload).toMatchObject({ fired: true });
  const first = await f.settle(group.conversation.id);
  expect(f.schedules.get(task.id)?.lastResult?.status).toBe('success');
  const accepted = await f.rpc('collaboration.command', { action: 'room-complete', conversationId: group.conversation.id, clientRequestId: 'accept-first-monitor-round' });
  expect(accepted.error).toBeUndefined();
  expect(f.snapshot(group.conversation.id).conversation.room?.state).toBe('completed');
  const again = await f.rpc('scheduledTask.trigger', { taskId: task.id });
  expect(again.payload).toMatchObject({ fired: true });
  const second = await f.settle(group.conversation.id);
  expect(second.tasks.length).toBeGreaterThan(first.tasks.length);
  for (const old of first.tasks) expect(second.tasks.find(item => item.id === old.id)?.currentAttemptId).toBe(old.currentAttemptId);
  expect(second.conversation.room?.goalRevision).toBeGreaterThan(first.conversation.room!.goalRevision);
  expect(f.schedules.get(task.id)?.enabled).toBe(true);
  expect(f.schedules.get(task.id)?.lastResult?.status).toBe('success');
});
