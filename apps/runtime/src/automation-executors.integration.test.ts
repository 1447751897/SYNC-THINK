import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  existsSync,
  writeFileSync,
  readdirSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createConnection } from 'node:net';
import * as fsAsync from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeProvider, type AdapterEvent, type ProviderCallRequest } from '@sync-think/adapters';
import {
  decodeFrames,
  encodeFrame,
  pipePathPortable,
  PROTOCOL_VERSION,
  type Frame,
} from '@sync-think/protocol';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteAppSettingStore,
  SqliteBrowserStore,
  SqliteCollaborationStore,
  SqliteConversationStore,
  SqliteEventCheckpointStore,
  SqliteGlobalAgentStore,
  SqliteMcpStore,
  SqliteMessageStore,
  SqliteScheduledTaskStore,
  SqliteTeamStore,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
import type {
  AgentId,
  KernelAdapter,
  KernelEvent,
  KernelRequest,
  McpServerId,
  ModelId,
  ScheduledTask,
  ScheduledTaskAutomation,
  ScheduledTaskHistoryEntry,
  ScheduledTaskTarget,
  TeamId,
  WorkspaceId,
} from '@sync-think/shared';
import type {
  BrowserHostExecuteInput,
  BrowserLeaseInfo,
  BrowserWorker,
  BrowserWorkerInput,
  WorkerEvent,
  WorkerToken,
} from '@sync-think/workers';
import { CollaborationChatHost } from './collaboration-chat-host.js';
import { Runtime } from './runtime.js';
import * as daemonDispatchClient from './daemon/dispatch-client.js';

// Configuration enters through RPC; exports, final history and connector calls are the observables.
type Automation = ScheduledTaskAutomation;
type ProbeTool = { name: string; args: Record<string, unknown> };
// The external filesystem seam still performs real reads; one test pauses attachment I/O.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});
type AutomationTask = ScheduledTask & { automation?: Automation };
type TriggerResult = { task: AutomationTask; fired: boolean; reason?: string };
const TEMP_PREFIX = 'sync-think-automation-executors-';
const PROFILE = 'automation-account-not-default';
const ORIGIN = 'https://automation.fixture.test';
const MEMBER = 'automation-member';
const MCP_ID = 'automation-connector';
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  const results = await Promise.allSettled(
    cleanups
      .splice(0)
      .reverse()
      .map((cleanup) => cleanup()),
  );
  const errors = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (errors.length) throw new AggregateError(errors, 'Automation fixture cleanup failed');
});

async function waitFor<T>(
  read: () => T | Promise<T>,
  ready: (value: T) => boolean,
  label: string,
): Promise<T> {
  const deadline = performance.now() + 6000;
  let value = await read();
  while (!ready(value)) {
    if (performance.now() >= deadline) throw new Error(`${label}: ${JSON.stringify(value)}`);
    await delay(10);
    value = await read();
  }
  return value;
}

function scopedPath(root: string, path: string): string {
  const requested = resolve(path);
  const target = existsSync(requested)
    ? realpathSync.native(requested)
    : join(realpathSync.native(dirname(requested)), basename(requested));
  const inside = relative(realpathSync.native(root), target);
  if (
    !inside ||
    isAbsolute(inside) ||
    inside === '..' ||
    inside.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
  ) {
    throw new Error(
      `Path outside automation fixture: target=${target}; root=${realpathSync.native(root)}; relative=${inside}`,
    );
  }
  return target;
}

function removeFixture(root: string): void {
  const target = realpathSync.native(root);
  if (
    dirname(target) !== realpathSync.native(tmpdir()) ||
    !basename(target).startsWith(TEMP_PREFIX)
  ) {
    throw new Error(`Unexpected recursive cleanup target: ${target}`);
  }
  rmSync(target, { recursive: true, force: true });
}

class ProbeProvider extends FakeProvider {
  autoReportOutcome = true;
  requests: ProviderCallRequest[] = [];
  toolResults: string[] = [];
  emittedTools: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
  mode:
    | 'plain'
    | 'browser'
    | 'workflow'
    | 'mcp'
    | 'claim'
    | 'export'
    | 'export-file'
    | 'mail'
    | 'export-mail' = 'plain';
  workTools?: (request: ProviderCallRequest) => readonly ProbeTool[];
  beforeWorkTool?: (request: ProviderCallRequest, index: number, tool: ProbeTool) => Promise<void>;
  dispatchMembers?: string[];
  mailServerId = MCP_ID;
  mailRecipient = 'recipient@example.test';
  mailEmptyAttachments = false;
  fileContractPath = 'pants.xlsx';
  workflowTaskId?: string;
  claimedPath = '';
  private gate?: Promise<void>;
  private releaseGate?: () => void;
  activeCalls = 0;

  hold(): () => void {
    this.release();
    this.gate = new Promise<void>((resolveGate) => {
      this.releaseGate = resolveGate;
    });
    return () => this.release();
  }
  release(): void {
    this.releaseGate?.();
    this.releaseGate = undefined;
    this.gate = undefined;
  }

  override async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.requests.push(request);
    const requestNumber = this.requests.length;
    this.activeCalls++;
    try {
      if (this.gate) {
        const gate = this.gate;
        let abort!: () => void;
        const aborted = new Promise<void>((resolveAbort) => {
          abort = resolveAbort;
        });
        request.signal.addEventListener('abort', abort, { once: true });
        try {
          if (!request.signal.aborted) await Promise.race([gate, aborted]);
        } finally {
          request.signal.removeEventListener('abort', abort);
        }
      }
      if (request.signal.aborted) return;
      const lastUser = request.messages.reduce(
        (last, message, index) => (message.role === 'user' ? index : last),
        -1,
      );
      const current = request.messages.slice(lastUser + 1);
      const calls = current.flatMap((message) =>
        message.role === 'assistant' && Array.isArray(message.content)
          ? message.content.flatMap((block) => (block.type === 'tool-call' ? [block.toolCall] : []))
          : [],
      );
      const completed = current.filter((message) => message.role === 'tool');
      for (const message of completed) this.toolResults.push(String(message.content));
      const completedNames = completed.map(
        (message) => calls.find((call) => call?.id === message.toolCallId)?.name,
      );
      const prompt = request.systemPrompt ?? '';
      const coordination = prompt.includes('purpose=coordination');
      const followUp = prompt.includes('先读取本群工作索引');
      let tool: { name: string; args: Record<string, unknown> } | undefined;
      if (
        coordination &&
        !followUp &&
        completedNames.filter((name) => name === 'collaboration_dispatch_tasks').length < 2
      ) {
        // Two different tool-call ids, same actor + dispatch key: one durable child.
        tool = {
          name: 'collaboration_dispatch_tasks',
          args: {
            tasks: (this.dispatchMembers ?? [MEMBER]).map((memberId) => ({
              key: this.dispatchMembers ? 'one-report-' + memberId : 'one-report',
              assigneeMemberId: 'agent:' + memberId,
              title: this.dispatchMembers
                ? 'Automation evidence ' + memberId
                : 'Automation evidence',
              instructions:
                'Collect automation fixture evidence and submit the report.' +
                (this.dispatchMembers ? ' Actor=' + memberId : ''),
              deliverable:
                this.mode === 'export-file'
                  ? { kind: 'file', path: this.fileContractPath, title: 'Automation evidence' }
                  : { kind: 'document', title: 'Automation evidence' },
            })),
          },
        };
      } else if (!coordination) {
        const planned = this.workTools?.(request);
        if (planned && completed.length < planned.length) {
          tool = planned[completed.length];
          await this.beforeWorkTool?.(request, completed.length, tool);
        } else if (planned) {
          if (
            prompt.includes('purpose=work') &&
            !completedNames.includes('collaboration_submit_artifact')
          ) {
            tool = {
              name: 'collaboration_submit_artifact',
              args: { content: '# Actual automation test evidence' },
            };
          }
        } else if (
          this.mode === 'workflow' &&
          !completedNames.includes('browser_workflow_execute')
        ) {
          tool = { name: 'browser_workflow_execute', args: { taskId: this.workflowTaskId } };
        } else if (this.mode === 'workflow' && !completedNames.includes('browser_open')) {
          tool = { name: 'browser_open', args: { url: ORIGIN + '/search' } };
        } else if (this.mode === 'workflow' && !completedNames.includes('browser_read')) {
          tool = { name: 'browser_read', args: {} };
        } else if (this.mode === 'browser' && !completedNames.includes('browser_open')) {
          tool = { name: 'browser_open', args: { url: `${ORIGIN}/search` } };
        } else if (this.mode === 'browser' && !completedNames.includes('browser_read')) {
          tool = { name: 'browser_read', args: {} };
        } else if (
          this.mode === 'mcp' &&
          !completedNames.some((name) => name?.startsWith('mcp__'))
        ) {
          tool = {
            name: `mcp__${MCP_ID}__export_report`,
            args: { keyword: 'pants', fileName: 'report.csv' },
          };
        } else if (
          (this.mode === 'export' || this.mode === 'export-mail' || this.mode === 'export-file') &&
          completedNames.filter((name) => name === 'automation_export_artifact').length <
            (this.mode === 'export-file' ? 1 : 2)
        ) {
          const first = !completedNames.includes('automation_export_artifact');
          tool = {
            name: 'automation_export_artifact',
            args: first
              ? {
                  format: 'spreadsheet',
                  fileName: 'pants.xlsx',
                  title: 'Fixture evidence',
                  columns: ['keyword', 'count'],
                  rows: [['pants', 7]],
                }
              : {
                  format: 'presentation',
                  fileName: 'pants.pptx',
                  title: 'Fixture evidence',
                  slides: [{ title: 'Pants report', bullets: ['Fixture source: pants count=7.'] }],
                },
          };
        } else if (
          (this.mode === 'mail' || this.mode === 'export-mail') &&
          completedNames.filter((name) => name?.endsWith('__send_email')).length < 2
        ) {
          tool = {
            name: `mcp__${this.mailServerId}__send_email`,
            args: {
              to: this.mailRecipient,
              subject: 'Automation fixture',
              body: 'Fixture evidence: pants count=7.',
              ...(this.mode === 'export-mail'
                ? {
                    attachments: this.mailEmptyAttachments
                      ? []
                      : officeReceipts(completed.map((message) => String(message.content))).map(
                          (receipt) => receipt.path,
                        ),
                  }
                : {}),
            },
          };
        } else if (
          prompt.includes('purpose=work') &&
          !completedNames.includes('collaboration_submit_artifact')
        ) {
          tool = {
            name: 'collaboration_submit_artifact',
            args: { content: '# Automation evidence\nFixture result: pants, count=7.' },
          };
        }
      }
      if (!tool && !this.workTools && this.autoReportOutcome &&
        !prompt.includes('purpose=') && request.tools?.some(item => item.name === 'automation_report_outcome') &&
        !completedNames.includes('automation_report_outcome')) {
        tool = {name: 'automation_report_outcome', args: {status: 'success', reason: 'Fixture business evidence verified.'}};
      }
      if (tool) {
        this.emittedTools.push({ id: `automation-tool-${requestNumber}`, ...tool });
        yield {
          type: 'tool-call',
          toolCall: {
            id: `automation-tool-${requestNumber}`,
            name: tool.name,
            argumentsJson: JSON.stringify(tool.args),
          },
        };
        yield { type: 'finished', reason: 'tool-requests' };
      } else {
        yield {
          type: 'assistant-message-delta',
          phase: 'final_answer',
          text:
            this.mode === 'claim'
              ? `Automation accepted. Spreadsheet and presentation delivered: ${this.claimedPath}. count=0.`
              : 'Automation fixture evidence: pants, count=7. Completed.',
        };
        yield { type: 'finished', reason: 'stop' };
      }
    } finally {
      this.activeCalls--;
    }
  }
}

class ProfileProbeWorker implements BrowserWorker {
  readonly kind = 'browser' as const;
  calls: BrowserWorkerInput[] = [];
  acquired: Array<{ profileId: string; ownerId: string }> = [];
  private leases = new Map<string, BrowserLeaseInfo>();
  async acquireLease(input: { profileId: string; ownerId: string }): Promise<BrowserLeaseInfo> {
    this.acquired.push(input);
    const lease = {
      ...input,
      leaseId: `lease-${this.acquired.length}`,
      pageId: `page-${this.acquired.length}`,
    };
    this.leases.set(lease.leaseId, lease);
    return lease;
  }
  async inspectLease(id: string): Promise<BrowserLeaseInfo> {
    const lease = this.leases.get(id);
    if (!lease) throw new Error(`Missing fixture lease: ${id}`);
    return lease;
  }
  async recoverLease(lease: BrowserLeaseInfo): Promise<BrowserLeaseInfo> {
    this.leases.set(lease.leaseId, lease);
    return lease;
  }
  async releaseLease(id: string): Promise<void> {
    this.leases.delete(id);
  }
  async execute(input: BrowserHostExecuteInput) {
    const lease = await this.inspectLease(input.leaseId);
    this.calls.push({
      action: input.action,
      profileId: lease.profileId,
      ownerId: lease.ownerId,
      workingDir: input.projectRoot ?? '.',
      allowedSites: [...input.allowedSites],
    });
    return {
      ok: true as const,
      message: 'Fixture page',
      ...lease,
      url: `${ORIGIN}/search`,
      title: 'Automation fixture',
      text: 'Fixture result: pants, count=7.',
    };
  }
  async *exec(input: BrowserWorkerInput, _token: WorkerToken): AsyncIterable<WorkerEvent> {
    const lease = await this.acquireLease({
      profileId: input.profileId ?? 'default',
      ownerId: input.ownerId ?? 'fixture-owner',
    });
    yield {
      type: 'completed',
      output: await this.execute({
        leaseId: lease.leaseId,
        action: input.action,
        allowedSites: input.allowedSites ?? [ORIGIN],
        projectRoot: input.workingDir,
        timeoutMs: 1000,
      }),
    };
  }
  async shutdown(): Promise<void> {
    this.leases.clear();
  }
}

async function fixture({ realRpc = false, kernelAdapterResolver }: { realRpc?: boolean; kernelAdapterResolver?: ConstructorParameters<typeof Runtime>[0]['kernelAdapterResolver'] } = {}) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), TEMP_PREFIX)));
  const resources: {
    connection?: Awaited<ReturnType<typeof openDatabaseAsync>>;
    runtime?: Runtime;
    host?: CollaborationChatHost;
  } = {};
  const provider = new ProbeProvider();
  const worker = new ProfileProbeWorker();
  const servers: Server[] = [];
  cleanups.push(async () => {
    provider.release();
    try {
      await resources.host?.service.stop();
      await resources.runtime?.stop();
      await waitFor(
        () => provider.activeCalls,
        (count) => count === 0,
        'Provider failed to drain',
      );
      for (const server of servers) {
        server.closeAllConnections();
        await new Promise<void>((done, reject) =>
          server.close((error) => (error ? reject(error) : done())),
        );
      }
    } finally {
      resources.connection?.raw.close();
      removeFixture(root);
    }
  });
  const path = scopedPath(root, join(root, 'automation.sqlite'));
  await runMigrations(path);
  const connection = await openDatabaseAsync({ path });
  resources.connection = connection;
  const workspaces = new SqliteWorkspaceStore(connection.raw);
  const workspace = workspaces.createWorkspace({
    id: 'automation-workspace' as WorkspaceId,
    name: 'Automation QA',
    folderPath: root,
  });
  const agents = new SqliteGlobalAgentStore(connection.raw);
  const leader = agents.create({
    id: 'automation-leader' as AgentId,
    name: 'Automation leader',
    defaultModelId: 'fake-mini' as ModelId,
  });
  const member = agents.create({
    id: MEMBER as AgentId,
    name: 'Automation member',
    defaultModelId: 'fake-mini' as ModelId,
  });
  const teams = new SqliteTeamStore(connection.raw);
  const team = teams.create({
    id: 'automation-team' as TeamId,
    name: 'Automation team',
    coordinatorAgentId: leader.id,
    members: [
      { agentId: leader.id, role: 'coordinator' },
      { agentId: member.id, role: 'researcher' },
    ],
  });
  const conversations = new SqliteConversationStore(connection.raw);
  const messages = new SqliteMessageStore(connection.raw);
  const repository = new SqliteCollaborationStore(connection.raw);
  const schedules = new SqliteScheduledTaskStore(connection.raw);
  const browser = new SqliteBrowserStore(connection.raw);
  browser.createProfile({ id: PROFILE, name: 'Isolated non-default account' });
  const mcp = new SqliteMcpStore(connection.raw);
  const settings = new SqliteAppSettingStore(connection.raw);
  settings.set('task-scheduler', { enabled: true, maxConcurrent: 2 });
  const host: CollaborationChatHost = new CollaborationChatHost(repository, {
    ownerId: 'automation-fixture-owner',
    conversations,
    messages,
    agents,
    teams,
    workspaces,
    execute: (input) => runtime.executeCollaborationTaskForHost(input),
    onChanged: (snapshot) => resources.runtime?.publishCollaborationSnapshot(snapshot),
  });
  resources.host = host;
  const runtime: Runtime = new Runtime({
    installId: basename(root),
    allowNoToken: true,
    projectlessDataDirectory: join(root, 'projectless'),
    workspaceStore: workspaces,
    conversationStore: conversations,
    messageStore: messages,
    globalAgentStore: agents,
    teamStore: teams,
    stateStore: new SqliteEventCheckpointStore(connection.raw),
    scheduledTaskStore: schedules,
    collaborationChatHost: host,
    browserStore: browser,
    browserHost: worker,
    browserFallbackWorkingDir: root,
    mcpStore: mcp,
    appSettingStore: settings,
    demoProvider: provider,
    kernelAdapterResolver,
  });
  resources.runtime = runtime;
  let requestNumber = 0;
  const inProcessRpc = (type: string, payload: unknown): Promise<Frame> =>
    new Promise((done, reject) => {
      const id = `automation-rpc-${++requestNumber}`;
      const timeout = setTimeout(() => reject(new Error(`RPC timed out: ${type}`)), 3000);
      try {
        (
          runtime as unknown as {
            handlers: { onFrame(socket: { write(data: Buffer): boolean }, frame: Frame): void };
          }
        ).handlers.onFrame(
          {
            write(data) {
              for (const frame of decodeFrames(data).frames)
                if (frame.id === id && frame.kind === 'response') {
                  clearTimeout(timeout);
                  done(frame);
                }
              return true;
            },
          },
          { id, kind: 'request', type, payload },
        );
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  if (realRpc) await runtime.start();
  const pipeRpc = (type: string, payload: unknown): Promise<Frame> =>
    new Promise((done, reject) => {
      const id = 'automation-wire-rpc-' + ++requestNumber;
      const socket = createConnection(pipePathPortable(basename(root)));
      let remaining: Buffer = Buffer.alloc(0);
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error('Pipe RPC timed out: ' + type));
      }, 6000);
      socket.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      const helloId = id + '-hello';
      socket.once('connect', () =>
        socket.write(
          encodeFrame({
            id: helloId,
            kind: 'request',
            type: '__hello',
            payload: {
              protocolVersion: PROTOCOL_VERSION,
              appVersion: 'automation-integration-fixture',
              installId: basename(root),
              nonce: id,
              features: [],
            },
          }),
        ),
      );

      socket.on('data', (data) => {
        try {
          const decoded = decodeFrames(Buffer.concat([remaining, data]));
          remaining = decoded.remaining;
          const hello = decoded.frames.find((frame) => frame.id === helloId);
          if (hello) {
            if (hello.error) {
              clearTimeout(timeout);
              socket.destroy();
              reject(new Error(JSON.stringify(hello.error)));
              return;
            }
            socket.write(encodeFrame({ id, kind: 'request', type, payload }));
          }
          const response = decoded.frames.find(
            (frame) => frame.id === id && frame.kind === 'response',
          );
          if (response) {
            clearTimeout(timeout);
            socket.destroy();
            done(response);
          }
        } catch (error) {
          clearTimeout(timeout);
          socket.destroy();
          reject(error);
        }
      });
    });
  const rpc = realRpc ? pipeRpc : inProcessRpc;
  const ok = async <T>(type: string, payload: unknown): Promise<T> => {
    const frame = await rpc(type, payload);
    expect(frame.error, `${type}: ${JSON.stringify(frame.error)}`).toBeUndefined();
    return frame.payload as T;
  };
  const history = async (taskId: string): Promise<ScheduledTaskHistoryEntry[]> =>
    (
      await ok<{ entries: ScheduledTaskHistoryEntry[] }>('scheduledTask.history', {
        taskId,
        limit: 100,
      })
    ).entries;
  const target = (kind: ScheduledTaskTarget['kind']): ScheduledTaskTarget =>
    kind === 'model'
      ? { kind, modelId: 'fake-mini' }
      : kind === 'agent'
        ? { kind, agentId: member.id }
        : { kind, teamId: team.id };
  const create = async (
    kind: ScheduledTaskTarget['kind'],
    automation?: Automation,
    enabled = false,
  ) =>
    (
      await ok<{ task: AutomationTask }>('scheduledTask.create', {
        name: `${kind} automation`,
        instruction: 'Collect fixture evidence: pants, count=7.',
        target: target(kind),
        rule: { kind: 'every', intervalMinutes: 30 },
        timeZone: 'UTC',
        workspaceId: workspace.id,
        enabled,
        ...(automation ? { automation } : {}),
      })
    ).task;
  return {
    root,
    connection,
    runtime,
    host,
    provider,
    worker,
    workspace,
    agents,
    leader,
    member,
    teams,
    team,
    conversations,
    messages,
    repository,
    schedules,
    browser,
    mcp,
    settings,
    servers,
    rpc,
    ok,
    history,
    target,
    create,
  };
}

it('persists disabled model automation through the real create/update/publish frame handlers', async () => {
  const f = await fixture();
  const automation: Automation = {
    executionMode: 'workspace',
    acceptance: 'Fixture evidence contains count=7.',
  };
  const created = await f.create('model', automation);
  expect(created.enabled).toBe(false);
  expect(created.automation).toEqual(automation);
  const updated = await f.ok<{ task: AutomationTask }>('scheduledTask.update', {
    taskId: created.id,
    patch: {
      automation: {
        executionMode: 'workspace',
        acceptance: 'Fixture evidence contains pants and count=7.',
      },
    },
  });
  expect(updated.task.automation?.acceptance).toBe('Fixture evidence contains pants and count=7.');
  expect(updated.task.enabled).toBe(false);
  const published = await f.ok<{ task: AutomationTask }>('scheduledTask.update', {
    taskId: created.id,
    patch: { enabled: true },
  });
  expect(published.task.enabled).toBe(true);
  expect(
    (
      await f.ok<{ tasks: AutomationTask[] }>('scheduledTask.list', { includeDisabled: true })
    ).tasks.find((task) => task.id === created.id),
  ).toEqual(published.task);
  expect(f.provider.requests).toHaveLength(0);
  expect(await f.history(created.id)).toEqual([]);
});

type Fixture = Awaited<ReturnType<typeof fixture>>;
describe('scheduled conversation destination', () => {
  it.each(['task','new'] as const)('executes two real rounds with %s conversation policy', async mode => {
    const f=await fixture();
    const task=await f.create('model',{executionMode:'workspace',conversation:{mode}});
    const ids:string[]=[];
    for(let round=1;round<=2;round++) {
      const result=await f.ok<TriggerResult>('scheduledTask.trigger',{taskId:task.id});
      expect(result.fired,result.reason).toBe(true);
      const rows=await terminalHistory(f,task.id,round);
      expect(rows.filter(row=>row.status==='success')).toHaveLength(round);
      ids.push(f.schedules.get(task.id)!.conversationId!);
    }
    expect(new Set(ids).size).toBe(mode==='new'?2:1);
    for(const id of ids)expect(f.conversations.get(id as import('@sync-think/shared').ConversationId)?.workspaceId).toBe(f.workspace.id);
  });
  it('continues a chosen existing conversation without creating a replacement',async()=>{
    const f=await fixture();
    const conversation=f.conversations.create({target:{track:'model',modelId:'fake-mini' as ModelId},workspaceId:f.workspace.id,title:'已有工作会话'});
    const task=await f.create('model',{executionMode:'workspace',conversation:{mode:'existing',conversationId:conversation.id}});
    expect(task.conversationId).toBe(conversation.id);
    const result=await f.ok<TriggerResult>('scheduledTask.trigger',{taskId:task.id});
    expect(result.fired,result.reason).toBe(true);
    expect((await terminalHistory(f,task.id,1))[0].status).toBe('success');
    expect(f.schedules.get(task.id)?.conversationId).toBe(conversation.id);
    expect(f.conversations.get(conversation.id)?.title).toBe('已有工作会话');
  });
  it.each(['task', 'new'] as const)('runs team schedules in durable groups with %s policy', async mode => {
    const f = await fixture();
    const task = await f.create('team', { conversation: { mode } });
    const ids: string[] = [];
    for (let round = 1; round <= 2; round++) {
      const trigger = await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: task.id });
      expect(trigger.fired, trigger.reason).toBe(true);
      await settledGroup(f, task.id);
      await terminalHistory(f, task.id, round);
      ids.push(f.schedules.get(task.id)!.conversationId!);
    }
    expect(new Set(ids).size).toBe(mode === 'new' ? 2 : 1);
    for (const id of ids) expect(f.host.command({ action: 'get', conversationId: id }).snapshot?.conversation.room).toBeDefined();
  });
  it('continues a selected real team room and rejects conflicting group bindings', async () => {
    const f = await fixture();
    const room = f.host.command({ action: 'create', clientRequestId: 'fixture-existing-schedule-room', kind: 'group', workspaceId: f.workspace.id,
      teamId: f.team.id, title: '已有小队会话', agentIds: [], coordinatorAgentId: f.leader.id,
    }).snapshot!;
    const task = await f.create('team', { conversation: { mode: 'existing', conversationId: room.conversation.id } });
    const trigger = await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: task.id });
    expect(trigger.fired, trigger.reason).toBe(true);
    await settledGroup(f, task.id);
    expect(f.schedules.get(task.id)?.conversationId).toBe(room.conversation.id);
    const invalid = await f.rpc('scheduledTask.create', { name: '冲突绑定', instruction: 'fixture',
      target: f.target('team'), workspaceId: f.workspace.id, rule: { kind: 'every', intervalMinutes: 30 },
      enabled: false, collaborationConversationId: room.conversation.id, automation: { conversation: { mode: 'new' } },
    });
    expect(invalid.error).toBeDefined();
  });
  it('rejects a workspace mismatch and does not silently replace an archived target',async()=>{
    const f=await fixture();
    const wrong=f.conversations.create({target:{track:'model',modelId:'fake-mini' as ModelId},title:'其他范围'});
    const invalid=await f.rpc('scheduledTask.create',{name:'错误范围',instruction:'fixture',target:f.target('model'),rule:{kind:'every',intervalMinutes:30},workspaceId:f.workspace.id,enabled:false,automation:{conversation:{mode:'existing',conversationId:wrong.id}}});
    expect(invalid.error).toBeDefined();
    const selected=f.conversations.create({target:{track:'model',modelId:'fake-mini' as ModelId},workspaceId:f.workspace.id,title:'待归档会话'});
    const task=await f.create('model',{conversation:{mode:'existing',conversationId:selected.id}});
    f.conversations.setArchived(selected.id,true);
    const before=f.provider.requests.length;
    const trigger=await f.ok<TriggerResult>('scheduledTask.trigger',{taskId:task.id});
    expect(trigger.fired).toBe(false);expect(trigger.reason).toMatch(/归档/);
    expect(f.provider.requests.length).toBe(before);
    expect(f.schedules.get(task.id)?.conversationId).toBe(selected.id);
  });
});
type FlowDetail = {
  task: {
    id: string;
    status: string;
    revision: number;
    profileId: string;
    publishedVersionId?: string;
  };
  draft: { id: string; status: string; revision: number; stepCount: number };
  version?: { id: string; versionNumber: number; stepCount: number };
};
const MATRIX = (['model', 'agent', 'team'] as const).flatMap((kind) =>
  [false, true].map((hasBrowser) => ({ kind, hasBrowser })),
);

function stoppedRecording(f: Fixture, id: string, profileId = PROFILE): void {
  const profile = f.browser.getProfile(profileId)!;
  f.browser.createRecording({
    id,
    profileId,
    ownerId: `recording:${id}`,
    expectedProfileRevision: profile.revision,
  });
  f.browser.markRecordingStarted({
    id,
    leaseId: `recording-lease:${id}`,
    pageId: `recording-page:${id}`,
  });
  f.browser.appendRecordingStep({
    recordingId: id,
    step: { kind: 'navigate', url: `${ORIGIN}/search` },
  });
  f.browser.appendRecordingStep({
    recordingId: id,
    step: {
      kind: 'fill',
      locator: { strategy: 'placeholder', value: 'Search' },
      value: { kind: 'variable', name: 'keyword' },
    },
  });
  f.browser.beginRecordingStop(id, { stopReason: 'user' });
  f.browser.finishRecording(id, { status: 'stopped', stopReason: 'user' });
}

async function publishedFlow(f: Fixture): Promise<FlowDetail> {
  const draft = await f.ok<FlowDetail>('browser.workflow.createDraft', {
    profileId: PROFILE,
    name: 'Reusable automation search',
    instruction: 'Search using the supplied keyword.',
    startUrl: `${ORIGIN}/search`,
    source: 'manual',
  });
  const recordingId = `recording-${draft.task.id}`;
  stoppedRecording(f, recordingId);
  f.browser.attachWorkflowDraftRecording({ draftId: draft.draft.id, recordingId });
  await f.ok<FlowDetail>('browser.workflow.save', { draftId: draft.draft.id, recordingId });
  await f.ok<FlowDetail>('browser.workflow.submit', { draftId: draft.draft.id, recordingId });
  const reviewed = await f.ok<FlowDetail>('browser.workflow.review', {
    draftId: draft.draft.id,
    decision: 'approve',
    note: 'Fixture approval',
  });
  f.browser.upsertOriginGrant({
    scopeType: 'workflow',
    scopeId: draft.task.id,
    origin: ORIGIN,
    action: 'navigate',
    decision: 'allow',
    approvalId: 'fixture-user',
  });
  return reviewed;
}

async function publishTask(
  f: Fixture,
  kind: ScheduledTaskTarget['kind'],
  automation?: Automation,
): Promise<AutomationTask> {
  const draft = await f.create(kind, automation);
  expect(draft.enabled).toBe(false);
  const result = await f.ok<{ task: AutomationTask }>('scheduledTask.update', {
    taskId: draft.id,
    patch: { enabled: true },
  });
  expect(result.task.enabled).toBe(true);
  return result.task;
}

async function terminalHistory(
  f: Fixture,
  taskId: string,
  count: number,
): Promise<ScheduledTaskHistoryEntry[]> {
  return waitFor(
    () => f.history(taskId),
    (entries) => entries.filter((entry) => entry.status !== 'skipped').length >= count,
    `No terminal history for ${taskId}`,
  );
}

async function settledGroup(f: Fixture, taskId: string) {
  const task = (
    await f.ok<{ tasks: AutomationTask[] }>('scheduledTask.list', { includeDisabled: true })
  ).tasks.find((row) => row.id === taskId)!;
  expect(task.conversationId, 'Team schedule must bind its real group').toBeTruthy();
  const group = f.host.command({ action: 'get', conversationId: task.conversationId! }).snapshot!;
  expect(
    group.conversation.room,
    'A legacy Team conversation is not the CollaborationChatHost queue',
  ).toBeDefined();
  return waitFor(
    () => f.host.command({ action: 'get', conversationId: group.conversation.id }).snapshot!,
    (snapshot) =>
      snapshot.tasks.length > 0 &&
      snapshot.tasks.every((work) => {
        const attempt = snapshot.attempts.find((row) => row.id === work.currentAttemptId);
        return (
          !!attempt && ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(attempt.status)
        );
      }),
    'Group queue failed to settle',
  );
}

// The same six public seams are exercised independently for durable configuration,
// execution, and preflight. A persistence regression must not hide a Profile/run regression.
describe.each(MATRIX)('$kind / Browser=$hasBrowser', ({ kind, hasBrowser }) => {
  it('creates disabled, updates automation, and publishes enabled without starting a run', async () => {
    const f = await fixture();
    const flow = hasBrowser ? await publishedFlow(f) : undefined;
    const initial: Automation = {
      executionMode: 'workspace',
      requiredMcpServerIds: [],
      outputs: [],
      acceptance: 'Fixture result contains count=7.',
      ...(flow
        ? {
            browser: {
              profileId: PROFILE,
              workflowTaskId: flow.task.id,
              variables: { keyword: 'shirts' },
            },
          }
        : {}),
    };
    const updatedAutomation: Automation = {
      ...initial,
      acceptance: 'Fixture result contains pants and count=7.',
      ...(flow
        ? {
            browser: {
              profileId: PROFILE,
              workflowTaskId: flow.task.id,
              variables: { keyword: 'pants' },
            },
          }
        : {}),
    };
    const draft = await f.create(kind, initial);
    expect(draft).toMatchObject({
      enabled: false,
      target: f.target(kind),
      workspaceId: f.workspace.id,
    });
    expect.soft(draft.automation, 'create must preserve the automation envelope').toEqual(initial);
    const updated = await f.ok<{ task: AutomationTask }>('scheduledTask.update', {
      taskId: draft.id,
      patch: {
        name: 'Updated automation',
        instruction: 'Updated fixture evidence request.',
        automation: updatedAutomation,
      },
    });
    expect(updated.task).toMatchObject({
      name: 'Updated automation',
      instruction: 'Updated fixture evidence request.',
      enabled: false,
    });
    expect
      .soft(updated.task.automation, 'update must persist automation, not just echo a patch')
      .toEqual(updatedAutomation);
    const published = await f.ok<{ task: AutomationTask }>('scheduledTask.update', {
      taskId: draft.id,
      patch: { enabled: true },
    });
    expect(published.task.enabled).toBe(true);
    const listed = (
      await f.ok<{ tasks: AutomationTask[] }>('scheduledTask.list', { includeDisabled: true })
    ).tasks.find((task) => task.id === draft.id)!;
    expect.soft(listed.automation).toEqual(updatedAutomation);
    expect
      .soft(
        (f.schedules.get(draft.id) as AutomationTask).automation,
        'SQLite read must agree with the wire response',
      )
      .toEqual(updatedAutomation);
    expect(await f.history(draft.id)).toEqual([]);
    expect(f.provider.requests).toHaveLength(0);
    expect(f.worker.calls).toHaveLength(0);
  });

  it('runs twice, skips a busy duplicate, records actual history, and preserves executor/Profile identity', async () => {
    const f = await fixture();
    f.provider.mode = hasBrowser ? 'browser' : 'plain';
    const automation: Automation = {
      executionMode: 'full-access',
      ...(hasBrowser ? { browser: { profileId: PROFILE } } : {}),
    };
    const draft = await f.create(kind, automation);
    const revisedAutomation: Automation = { ...automation };
    await f.ok('scheduledTask.update', {
      taskId: draft.id,
      patch: { automation: revisedAutomation },
    });
    const published = await f.ok<{ task: AutomationTask }>('scheduledTask.update', {
      taskId: draft.id,
      patch: { enabled: true },
    });
    expect(published.task.enabled).toBe(true);
    const release = f.provider.hold();
    try {
      const first = await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: draft.id });
      expect(first.fired, first.reason).toBe(true);
      if (kind === 'team') {
        expect(first.task.conversationId).toBeTruthy();
        const snapshot = f.repository.read(first.task.conversationId!);
        expect(
          snapshot?.conversation.room,
          'Scheduled Team work must enter the native durable group queue',
        ).toBeDefined();
        expect(
          snapshot!.members.filter((member) => member.active).map((member) => member.agentId),
        ).toEqual(expect.arrayContaining([f.leader.id, f.member.id]));
        expect(snapshot!.tasks.filter((task) => task.purpose === 'coordination')).toHaveLength(1);
      }
      const started = await waitFor(
        async () => ({ calls: f.provider.requests.length, history: await f.history(draft.id) }),
        (value) => value.calls > 0 || value.history.some((entry) => entry.status === 'failed'),
        'Runtime did not start the fixture Provider',
      );
      expect(started.calls, JSON.stringify(started.history)).toBeGreaterThan(0);
      const busy = await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: draft.id });
      expect(busy.fired).toBe(false);
      expect(busy.reason).toMatch(/忙|尚未完成|并发|busy|in.flight|合并跳过/i);
      const skipped = await f.history(draft.id);
      expect(skipped).toHaveLength(1);
      expect(skipped[0]).toMatchObject({
        taskId: draft.id,
        status: 'skipped',
        reason: busy.reason,
      });
      expect(f.provider.requests).toHaveLength(1);
    } finally {
      release();
    }
    const firstDone = await terminalHistory(f, draft.id, 1);
    expect(
      firstDone.filter((entry) => entry.status === 'success'),
      JSON.stringify(firstDone),
    ).toHaveLength(1);
    if (kind === 'team') {
      const firstGroup = await settledGroup(f, draft.id);
      expect(firstGroup.tasks.filter((task) => task.purpose === 'work')).toHaveLength(1);
      expect(
        firstGroup.attempts.every((attempt) => attempt.status === 'succeeded'),
        JSON.stringify(firstGroup.attempts),
      ).toBe(true);
    }
    const beforeSecond = f.provider.requests.length;
    const second = await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: draft.id });
    expect(second.fired, second.reason).toBe(true);
    const done = await terminalHistory(f, draft.id, 2);
    const successes = done.filter((entry) => entry.status === 'success');
    expect(successes, JSON.stringify(done)).toHaveLength(2);
    expect(done.filter((entry) => entry.status === 'skipped')).toHaveLength(1);
    expect(new Set(done.map((entry) => entry.id)).size).toBe(3);
    expect(new Set(successes.map((entry) => entry.firedAt)).size).toBe(2);
    expect(f.provider.requests.length).toBeGreaterThan(beforeSecond);
    const latest = (await f.ok<{ tasks: AutomationTask[] }>('scheduledTask.list', {})).tasks.find(
      (task) => task.id === draft.id,
    )!;
    expect(latest.lastResult?.status).toBe('success');
    expect(latest.conversationId).toBe(second.task.conversationId);
    expect(latest.automation).toEqual(revisedAutomation);
    if (kind !== 'team') {
      expect(successes.every((entry) => !!entry.runId)).toBe(true);
      expect(new Set(successes.map((entry) => entry.runId)).size).toBe(2);
      expect(successes.every((entry) => entry.summary?.includes('count=7'))).toBe(true);
      expect(f.conversations.get(latest.conversationId!)?.track).toBe(kind);
    } else {
      const group = await settledGroup(f, draft.id);
      const work = group.tasks.filter((task) => task.purpose === 'work');
      expect(work).toHaveLength(2); // repeated dispatch actor calls are not extra jobs
      expect(work.every((task) => task.assigneeMemberId === `agent:${MEMBER}`)).toBe(true);
      const artifacts = group.attempts.flatMap((attempt) => attempt.artifacts ?? []);
      expect(artifacts).toHaveLength(2);
      for (const artifact of artifacts) {
        expect(artifact.storedPath).toBeTruthy();
        const path = scopedPath(f.root, artifact.storedPath!);
        expect(realpathSync.native(path)).toBe(path);
        expect(readFileSync(path, 'utf8')).toBe(artifact.content);
      }
    }
    if (hasBrowser) {
      expect(
        f.worker.calls.length,
        'Browser behavior must reach the worker, not just a Provider phrase',
      ).toBeGreaterThan(0);
      expect(f.worker.acquired.every((lease) => lease.profileId === PROFILE)).toBe(true);
      expect(f.worker.calls.every((call) => call.profileId === PROFILE)).toBe(true);
      expect(f.worker.calls.filter((call) => call.action.kind === 'navigate')).toHaveLength(2);
      expect(f.worker.calls.filter((call) => call.action.kind === 'read')).toHaveLength(2);
    } else {
      expect(f.worker.calls).toEqual([]);
      expect(f.worker.acquired).toEqual([]);
    }
    // Reading history again must not create duplicate terminal records.
    expect((await f.history(draft.id)).map((entry) => entry.id)).toEqual(
      done.map((entry) => entry.id),
    );
  });

  it('blocks a missing required MCP before Provider/Browser/group execution and returns the reason on trigger', async () => {
    const f = await fixture();
    const automation: Automation = {
      requiredMcpServerIds: ['missing-automation-mcp'],
      ...(hasBrowser ? { browser: { profileId: PROFILE } } : {}),
    };
    const task = await publishTask(f, kind, automation);
    const result = await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: task.id });
    expect.soft(result.fired, 'Capability preflight must reject the trigger itself').toBe(false);
    expect.soft(result.reason).toMatch(/missing-automation-mcp/);
    expect.soft(result.reason).toMatch(/MCP|mcp|连接|能力|缺少|不存在|未配置/);
    if (result.fired) await terminalHistory(f, task.id, 1); // drain an incorrectly admitted run; do not treat it as success
    const history = await f.history(task.id);
    expect(history.length).toBeGreaterThan(0);
    expect(history.every((entry) => entry.status === 'blocked')).toBe(true);
    expect(history.some((entry) => entry.reason?.includes('missing-automation-mcp'))).toBe(true);
    expect(f.provider.requests).toHaveLength(0);
    expect(f.worker.calls).toHaveLength(0);
    expect(f.repository.list(f.workspace.id).flatMap((snapshot) => snapshot.tasks)).toEqual([]);
  });
});

it('round-trips the complete optional automation envelope in SQLite without producing output or sending mail while disabled', async () => {
  const f = await fixture();
  const flow = await publishedFlow(f);
  const automation: Automation = {
    executionMode: 'workspace',
    browser: {
      profileId: PROFILE,
      workflowTaskId: flow.task.id,
      variables: { keyword: 'shirts', language: 'zh' },
    },
    requiredMcpServerIds: [MCP_ID],
    outputs: ['spreadsheet', 'presentation'],
    delivery: {
      kind: 'gmail',
      mcpServerId: 'gmail-fixture-only',
      recipient: 'recipient@example.test',
    },
    acceptance:
      'Verify count=7 and inspect both generated documents before marking the run successful.',
  };
  const task = await f.create('agent', automation);
  expect(task.automation).toEqual(automation);
  const updated: Automation = {
    ...automation,
    browser: { ...automation.browser!, variables: { keyword: 'pants' } },
    delivery: { ...automation.delivery!, recipient: 'updated@example.test' },
  };
  await f.ok('scheduledTask.update', { taskId: task.id, patch: { automation: updated } });
  const reopened = await openDatabaseAsync({
    path: scopedPath(f.root, join(f.root, 'automation.sqlite')),
  });
  try {
    expect(
      (new SqliteScheduledTaskStore(reopened.raw).get(task.id) as AutomationTask).automation,
    ).toEqual(updated);
  } finally {
    reopened.raw.close();
  }
  expect(f.provider.requests).toEqual([]);
  expect(f.worker.calls).toEqual([]);
  expect(await f.history(task.id)).toEqual([]);
});

// Reuse the existing flow-test recording/store APIs; authoring commands still go
// through Runtime frames, including actor retries and the published revision fence.
it('creates/saves/submits/reviews/publishes a flow, rejects stale revisions, and prevents repeated actor calls from publishing extra versions', async () => {
  const f = await fixture();
  const first = await publishedFlow(f);
  expect(first).toMatchObject({
    task: { status: 'enabled', profileId: PROFILE },
    draft: { status: 'approved', stepCount: 2 },
    version: { versionNumber: 1 },
  });
  const duplicateReview = await f.ok<FlowDetail>('browser.workflow.review', {
    draftId: first.draft.id,
    decision: 'approve',
    note: 'Fixture approval',
  });
  expect(duplicateReview.version?.id).toBe(first.version!.id);
  const revision = await f.ok<FlowDetail>('browser.workflow.createRevisionDraft', {
    taskId: first.task.id,
    expectedTaskRevision: first.task.revision,
  });
  expect(revision.task).toMatchObject({ status: 'draft', publishedVersionId: first.version!.id });
  const stale = await f.rpc('browser.workflow.createRevisionDraft', {
    taskId: first.task.id,
    expectedTaskRevision: first.task.revision,
  });
  expect(stale.error?.message).toContain('browser.workflow-conflict');
  const recordingId = 'automation-revision-two';
  stoppedRecording(f, recordingId);
  f.browser.attachWorkflowDraftRecording({ draftId: revision.draft.id, recordingId });
  const saved = await f.ok<FlowDetail>('browser.workflow.save', {
    draftId: revision.draft.id,
    recordingId,
  });
  expect(saved.draft).toMatchObject({ status: 'editing', stepCount: 2 });
  const submitted = await f.ok<FlowDetail>('browser.workflow.submit', {
    draftId: revision.draft.id,
    recordingId,
  });
  const submittedAgain = await f.ok<FlowDetail>('browser.workflow.submit', {
    draftId: revision.draft.id,
    recordingId,
  });
  expect(submittedAgain).toEqual(submitted);
  await f.ok<FlowDetail>('browser.workflow.review', {
    draftId: revision.draft.id,
    decision: 'reject',
    note: 'Revise the capture',
  });
  await f.ok<FlowDetail>('browser.workflow.save', { draftId: revision.draft.id, recordingId });
  const second = await f.ok<FlowDetail>('browser.workflow.publish', {
    draftId: revision.draft.id,
    recordingId,
  });
  expect(second.version).toMatchObject({ versionNumber: 2, stepCount: 2 });
  expect(second.version!.id).not.toBe(first.version!.id);
  const repeatedPublish = await f.rpc('browser.workflow.publish', {
    draftId: revision.draft.id,
    recordingId,
  });
  expect(repeatedPublish.error?.message).toContain('browser.workflow-conflict');
  const detail = await f.ok<FlowDetail>('browser.workflow.get', { taskId: first.task.id });
  expect(detail.version).toMatchObject({ id: second.version!.id, versionNumber: 2 });
  expect(detail.task.publishedVersionId).toBe(second.version!.id);
  expect(f.provider.requests).toHaveLength(0);
});

async function httpConnector(
  f: Fixture,
  id = MCP_ID,
  mailReceipt?: string,
  byteAttachments = false,
  beforeSend?: () => Promise<void>,
) {
  type Call = {
    method: string;
    params?: { name?: string; arguments?: Record<string, unknown> };
    session?: string;
  };
  const tools = [
    {
      name: 'export_report',
      description: 'Export fixture dataset',
      inputSchemaJson: JSON.stringify({
        type: 'object',
        properties: { keyword: { type: 'string' }, fileName: { type: 'string' } },
        required: ['keyword', 'fileName'],
      }),
    },
    {
      name: 'send_email',
      description: 'Local fixture Gmail send boundary; no external email',
      inputSchemaJson: JSON.stringify({
        type: 'object',
        properties: {
          to: { type: 'string' },
          attachments: byteAttachments
            ? {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    filename: { type: 'string' },
                    contentBase64: { type: 'string' },
                    mimeType: { type: 'string' },
                  },
                  required: ['filename', 'contentBase64', 'mimeType'],
                },
              }
            : { type: 'array', items: { type: 'string' } },
          subject: { type: 'string' },
          body: { type: 'string' },
        },
        required: byteAttachments ? ['to', 'attachments'] : ['to'],
      }),
    },
  ];
  const liveTools = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: JSON.parse(tool.inputSchemaJson) as Record<string, unknown>,
  }));
  const calls: Call[] = [];
  const errors: string[] = [];
  const outputPath = scopedPath(f.root, join(f.root, 'report.csv'));
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('error', (error) => errors.push(error.message));
    request.on('end', async () => {
      try {
        const frame = JSON.parse(body) as {
          id?: string | number;
          method: string;
          params?: Call['params'];
        };
        calls.push({
          method: frame.method,
          params: frame.params,
          session: request.headers['mcp-session-id'] as string | undefined,
        });
        if (frame.method === 'notifications/initialized') {
          response.writeHead(202);
          response.end();
          return;
        }
        let result: unknown;
        if (frame.method === 'initialize') {
          result = {
            protocolVersion: '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'automation-local-only', version: '1' },
          };
        } else if (frame.method === 'tools/list') {
          result = { tools: liveTools };
        } else if (frame.method === 'tools/call' && frame.params?.name === 'export_report') {
          if (
            frame.params.arguments?.keyword !== 'pants' ||
            frame.params.arguments?.fileName !== 'report.csv'
          )
            throw new Error('Unexpected connector arguments');
          writeFileSync(outputPath, 'keyword,count\npants,7\n');
          result = {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ path: outputPath, keyword: 'pants', count: 7 }),
              },
            ],
          };
        } else if (frame.method === 'tools/call' && frame.params?.name === 'send_email') {
          await beforeSend?.();
          // No SMTP, Gmail, or external endpoint; only an explicit local receipt.
          result = {
            content: [
              {
                type: 'text',
                text: mailReceipt
                  ? JSON.stringify({ messageId: mailReceipt })
                  : 'HTTP 200; fixture accepted request but has no message/send identifier.',
              },
            ],
          };
        } else {
          throw new Error(
            `Unexpected local MCP method/tool: ${frame.method}/${frame.params?.name}`,
          );
        }
        response.writeHead(200, {
          'content-type': 'application/json',
          'mcp-session-id': 'automation-session',
        });
        response.end(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result }));
      } catch (error) {
        errors.push(String(error));
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: String(error) }));
      }
    });
  });
  f.servers.push(server);
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      done();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing loopback fixture address');
  const record = f.mcp.register({
    id: id as McpServerId,
    name: 'Local-only automation connector',
    transport: 'remote-http',
    endpoint: `http://127.0.0.1:${address.port}/mcp`,
    trusted: true,
    timeoutMs: 1000,
    tools,
  });
  return { record, liveTools, calls, errors, outputPath };
}

it.each(['model', 'agent'] as const)(
  '%s schedule executes a registered MCP tool through the actual local HTTP pipeline, with real output bytes',
  async (kind) => {
    const f = await fixture();
    const connector = await httpConnector(f);
    // An Agent owns its ordinary allowlist. Model capability binding must come from
    // the schedule itself; neither case edits frozen run state or mocks tool dispatch.
    if (kind === 'agent')
      f.agents.update({ agentId: f.member.id, mcpServerIds: [connector.record.id] });
    f.provider.mode = 'mcp';
    const task = await publishTask(f, kind, {
      executionMode: 'full-access',
      requiredMcpServerIds: [connector.record.id],
    });
    const trigger = await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: task.id });
    expect(trigger.fired, trigger.reason).toBe(true);
    const done = await terminalHistory(f, task.id, 1);
    expect(done[0], JSON.stringify(done)).toMatchObject({ status: 'success', taskId: task.id });
    expect(connector.errors).toEqual([]);
    expect(connector.calls.map((call) => call.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
      'initialize',
      'notifications/initialized',
      'tools/call',
    ]);
    expect(connector.calls.at(-1)).toMatchObject({
      session: 'automation-session',
      params: {
        name: 'export_report',
        arguments: { keyword: 'pants', fileName: 'report.csv' },
      },
    });
    expect(f.provider.requests[0].tools?.map((tool) => tool.name)).toContain(
      `mcp__${MCP_ID}__export_report`,
    );
    expect(
      f.provider.toolResults.some(
        (result) => result.includes('"ok":true') && result.includes('report.csv'),
      ),
    ).toBe(true);
    expect(existsSync(connector.outputPath)).toBe(true);
    expect(readFileSync(realpathSync.native(connector.outputPath), 'utf8')).toBe(
      'keyword,count\npants,7\n',
    );
    expect((f.schedules.get(task.id) as AutomationTask).automation?.requiredMcpServerIds).toEqual([
      connector.record.id,
    ]);
  },
);

it.each(['model', 'agent', 'team'] as const)(
  '%s schedule fails instead of accepting Provider claims about nonexistent spreadsheet/presentation output',
  async (kind) => {
    const f = await fixture();
    f.provider.mode = 'claim';
    f.provider.claimedPath = scopedPath(f.root, join(f.root, 'never-generated.xlsx'));
    const task = await publishTask(f, kind, {
      executionMode: 'full-access',
      outputs: ['spreadsheet', 'presentation'],
    });
    const trigger = await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: task.id });
    expect(trigger.fired, trigger.reason).toBe(true);
    const done = await terminalHistory(f, task.id, 1);
    expect(f.provider.requests.length).toBeGreaterThan(0);
    expect(existsSync(f.provider.claimedPath)).toBe(false);
    expect(done.filter((entry) => entry.status === 'success')).toEqual([]);
    expect(done[0]).toMatchObject({ status: 'failed' });
    expect(done[0].reason).toMatch(/文件|产物|交付|output|artifact|spreadsheet|presentation/i);
    expect(f.schedules.get(task.id)?.lastResult?.status).toBe('failed');
  },
);

it.each(['model', 'agent', 'team'] as const)(
  '%s schedule reconciles when mail delivery has no connector send receipt, even if the Provider says delivered',
  async (kind) => {
    const f = await fixture();
    const connector = await httpConnector(f, 'gmail-fixture-only');
    if (kind === 'agent')
      f.agents.update({ agentId: f.member.id, mcpServerIds: [connector.record.id] });
    f.provider.mode = 'mail';
    f.provider.mailServerId = connector.record.id;
    const task = await publishTask(f, kind, {
      executionMode: 'full-access',
      delivery: {
        kind: 'gmail',
        mcpServerId: connector.record.id,
        recipient: 'recipient@example.test',
      },
    });
    const trigger = await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: task.id });
    expect(trigger.fired, trigger.reason).toBe(true);
    const done = await terminalHistory(f, task.id, 1);
    expect(done.filter((entry) => entry.status === 'success')).toEqual([]);
    expect(done[0]).toMatchObject({ status: 'reconciling' });
    expect(done[0].reason).toMatch(/邮件|回执|发送|delivery|receipt/i);
    expect(connector.calls.filter((call) => call.method === 'tools/call')).toHaveLength(1);
    expect(connector.calls.some((call) => call.method === 'tools/list')).toBe(true);
    expect(f.provider.requests.length).toBeGreaterThan(0);
  },
);

it.each(['model', 'agent', 'team'] as const)(
  '%s schedule blocks a missing Browser Profile rather than silently using default',
  async (kind) => {
    const f = await fixture();
    f.provider.mode = 'browser';
    const task = await publishTask(f, kind, {
      executionMode: 'full-access',
      browser: { profileId: 'missing-account-profile' },
    });
    const result = await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: task.id });
    expect(result.fired).toBe(false);
    expect(result.reason).toMatch(/profile|Profile|浏览器|账号/i);
    expect(result.reason).toMatch(/missing-account-profile|不存在|找不到|not.found|missing/i);
    expect(f.provider.requests).toHaveLength(0);
    expect(f.worker.calls).toHaveLength(0);
    expect((await f.history(task.id)).every((entry) => entry.status === 'blocked')).toBe(true);
  },
);

it.each(['model', 'agent', 'team'] as const)(
  '%s schedule replays the published workflow with updated variables and the bound non-default Profile',
  async (kind) => {
    const f = await fixture();
    const flow = await publishedFlow(f);
    f.provider.mode = 'workflow';
    f.provider.workflowTaskId = flow.task.id;
    const task = await publishTask(f, kind, {
      executionMode: 'full-access',
      browser: {
        profileId: PROFILE,
        workflowTaskId: flow.task.id,
        variables: { keyword: 'shirts' },
      },
    });
    const first = await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: task.id });
    expect(first.fired, first.reason).toBe(true);
    const firstDone = await terminalHistory(f, task.id, 1);
    expect(firstDone[0], JSON.stringify(firstDone)).toMatchObject({ status: 'success' });
    await f.ok('scheduledTask.update', {
      taskId: task.id,
      patch: {
        automation: {
          executionMode: 'full-access',
          browser: {
            profileId: PROFILE,
            workflowTaskId: flow.task.id,
            variables: { keyword: 'pants' },
          },
        },
      },
    });
    const second = await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: task.id });
    expect(second.fired, second.reason).toBe(true);
    const done = await terminalHistory(f, task.id, 2);
    expect(
      done.every((entry) => entry.status === 'success'),
      JSON.stringify(done),
    ).toBe(true);
    expect(f.worker.calls.length).toBeGreaterThan(0);
    expect(f.worker.calls.every((call) => call.profileId === PROFILE)).toBe(true);
    expect(
      f.worker.calls.filter((call) => call.action.kind === 'fill').map((call) => call.action),
    ).toMatchObject([{ text: 'shirts' }, { text: 'pants' }]);
    const workflowRuns = f.browser.listWorkflowRuns(flow.task.id);
    expect(workflowRuns).toHaveLength(2);
    expect(workflowRuns.every((run) => run.status === 'succeeded')).toBe(true);
    expect(f.browser.getAutomationTask(flow.task.id)?.publishedVersionId).toBe(flow.version!.id);
  },
);

it('a legacy Team schedule without automation still creates its own native group and dispatches a real member', async () => {
  const f = await fixture();
  const task = await publishTask(f, 'team');
  expect(task.automation).toBeUndefined();
  expect(task.conversationId).toBeUndefined();
  const result = await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: task.id });
  expect(result.fired, result.reason).toBe(true);
  const done = await terminalHistory(f, task.id, 1);
  expect(done[0], JSON.stringify(done)).toMatchObject({ status: 'success' });
  const group = await settledGroup(f, task.id);
  expect(group.members.filter((member) => member.active).map((member) => member.agentId)).toEqual(
    expect.arrayContaining([f.leader.id, f.member.id]),
  );
  const memberWork = group.tasks.filter((work) => work.purpose === 'work');
  expect(memberWork).toHaveLength(1);
  expect(memberWork[0].assigneeMemberId).toBe(`agent:${MEMBER}`);
  expect(group.attempts.flatMap((attempt) => attempt.artifacts ?? [])).toHaveLength(1);
  const secondTask = await publishTask(f, 'team');
  await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: secondTask.id });
  await terminalHistory(f, secondTask.id, 1);
  expect((await settledGroup(f, secondTask.id)).conversation.id).not.toBe(group.conversation.id);
});

it.each([false, true])(
  'Team daemon dispatch completes exactly once and releases its pending/concurrency slot (automation=%s)',
  async (withAutomation) => {
    const f = await fixture();
    const completion = vi
      .spyOn(daemonDispatchClient, 'sendTaskCompletionToDaemon')
      .mockResolvedValue(true);
    // This is the existing external daemon boundary only: no group/task/Provider execution is mocked.
    const probe = f.runtime as unknown as {
      scheduledTaskDispatches: { pendingTaskIds(): string[] };
    };
    const config: Automation | undefined = withAutomation
      ? { executionMode: 'full-access' }
      : undefined;
    const first = await publishTask(f, 'team', config);
    const second = await publishTask(f, 'team', config);
    // The public setting, not a fabricated registry count, makes slot leakage observable.
    f.settings.set('task-scheduler', { enabled: true, maxConcurrent: 1 });
    const dispatch = (task: AutomationTask) =>
      f.ok<{ taskId: string; accepted: boolean; reason?: string }>('task.dispatch', {
        taskId: task.id,
        instruction: task.instruction,
        target: task.target,
        skillVersionIds: [],
        workspaceId: f.workspace.id,
      });
    const release = f.provider.hold();
    try {
      const ack = await dispatch(first);
      expect(ack).toMatchObject({ taskId: first.id, accepted: true });
      const start = await waitFor(
        async () => ({ calls: f.provider.requests.length, history: await f.history(first.id) }),
        (value) => value.calls > 0 || value.history.some((entry) => entry.status === 'failed'),
        'Daemon group did not start',
      );
      expect(start.calls, JSON.stringify(start.history)).toBeGreaterThan(0);
      expect(probe.scheduledTaskDispatches.pendingTaskIds()).toEqual([first.id]);
      expect(completion).not.toHaveBeenCalled();
      const duplicate = await dispatch(first);
      const held = f.repository.read(f.schedules.get(first.id)!.conversationId!)!;
      expect(
        duplicate.accepted,
        JSON.stringify({
          room: held.conversation.room?.state,
          attempts: held.attempts.map((attempt) => ({ status: attempt.status, id: attempt.id })),
        }),
      ).toBe(false);
      expect(duplicate.reason).toMatch(/并发|忙|尚未完成|busy|in.flight/i);
      const atCapacity = await dispatch(second);
      expect(atCapacity.accepted).toBe(false);
      expect(atCapacity.reason).toMatch(/并发|concurr|capacity/i);
      expect(f.provider.requests).toHaveLength(1);
    } finally {
      release();
    }
    const firstHistory = await terminalHistory(f, first.id, 1);
    expect(firstHistory.filter((entry) => entry.status === 'success')).toHaveLength(1);
    await settledGroup(f, first.id);
    await waitFor(
      () => completion.mock.calls.length,
      (count) => count >= 1,
      'Missing Team daemon completion',
    );
    expect(completion).toHaveBeenCalledTimes(1);
    expect(completion.mock.calls[0][1]).toMatchObject({ taskId: first.id, status: 'success' });
    expect(probe.scheduledTaskDispatches.pendingTaskIds()).toEqual([]);
    const later = await dispatch(second);
    expect(later.accepted, later.reason).toBe(true); // proves the group slot was released
    const secondHistory = await terminalHistory(f, second.id, 1);
    expect(secondHistory.filter((entry) => entry.status === 'success')).toHaveLength(1);
    await settledGroup(f, second.id);
    await waitFor(
      () => completion.mock.calls.length,
      (count) => count >= 2,
      'Second Team daemon completion missing',
    );
    expect(completion).toHaveBeenCalledTimes(2);
    expect(completion.mock.calls[1][1]).toMatchObject({ taskId: second.id, status: 'success' });
    expect(probe.scheduledTaskDispatches.pendingTaskIds()).toEqual([]);
  },
);

it.each(['model', 'agent', 'team'] as const)(
  '%s disabled schedule rejects daemon dispatch without creating a run',
  async (kind) => {
    const f = await fixture();
    const task = await f.create(kind);
    const frame = await f.rpc('task.dispatch', {
      taskId: task.id,
      instruction: task.instruction,
      target: task.target,
      skillVersionIds: [],
    });
    expect(frame.type).toBe('task.dispatch.ack');
    expect(frame.error).toBeUndefined();
    expect(frame.payload).toMatchObject({ taskId: task.id, accepted: false });
    expect((frame.payload as { reason: string }).reason).toMatch(/停用|disabled/i);
    expect(f.provider.requests).toHaveLength(0);
    expect(await f.history(task.id)).toEqual([]);
    expect(f.worker.calls).toHaveLength(0);
  },
);

type OfficeReceipt = {
  format: 'spreadsheet' | 'presentation';
  path: string;
  size: number;
  sha256: string;
};
function officeReceipts(results: string[]): OfficeReceipt[] {
  const receipts = new Map<string, OfficeReceipt>();
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 8 || value === null || value === undefined) return;
    if (typeof value === 'string') {
      try {
        visit(JSON.parse(value), depth + 1);
      } catch {
        /* Non-JSON tool explanation carries no receipt. */
      }
    } else if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
    } else if (typeof value === 'object') {
      const row = value as Record<string, unknown>;
      if (
        ['spreadsheet', 'presentation'].includes(String(row.format)) &&
        typeof row.path === 'string' &&
        typeof row.size === 'number' &&
        typeof row.sha256 === 'string'
      ) {
        receipts.set(row.path, row as OfficeReceipt);
      }
      Object.values(row).forEach((item) => visit(item, depth + 1));
    }
  };
  results.forEach((result) => visit(result));
  return [...receipts.values()];
}

it.each(['workspace', 'full-access'] as const)(
  'Team %s automation passes frozen scope into member file claims without changing the group permission',
  async (executionMode) => {
    const f = await fixture();
    f.provider.mode = 'export-file';
    const task = await publishTask(f, 'team', {
      executionMode,
      outputs: ['spreadsheet'],
    });
    expect(f.agents.get(f.member.id)?.writePolicy).toBe('inherit');
    expect((await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: task.id })).fired).toBe(
      true,
    );
    await terminalHistory(f, task.id, 1);
    const group = await settledGroup(f, task.id);
    expect(f.conversations.get(group.conversation.id)?.executionMode).toBe('ask');
    for (const work of group.tasks.filter((item) => item.purpose === 'coordination')) {
      expect(work.resourceClaims.every((claim) => claim.mode === 'read')).toBe(true);
    }
    for (const request of f.provider.requests.filter((item) =>
      item.systemPrompt?.includes('purpose=coordination'),
    )) {
      expect(request.tools?.map((tool) => tool.name)).not.toContain('write_file');
    }
    const child = group.tasks.find((work) => work.deliverable?.kind === 'file')!;
    expect(child, JSON.stringify(group.attempts)).toBeDefined();
    const canonical = process.platform === 'win32' ? f.root.toLowerCase() : f.root;
    expect(child.resourceClaims).toEqual([
      { key: 'workspace:' + canonical, mode: 'write' },
      { key: 'external-tools', mode: 'write' },
    ]);
    const attempt = group.attempts.find((item) => item.id === child.currentAttemptId)!;
    expect(attempt.error?.code).not.toBe('collaboration.file_delivery_readonly');
    const memberCalls = f.provider.requests.filter((request) =>
      request.systemPrompt?.includes('purpose=work'),
    );
    expect(memberCalls.length).toBeGreaterThan(0);
    expect(memberCalls[0].tools?.map((tool) => tool.name)).toContain('automation_export_artifact');
    const receipts = officeReceipts(f.provider.toolResults);
    expect(receipts).toHaveLength(1);
    const bytes = readFileSync(scopedPath(f.root, receipts[0].path));
    expect(bytes.subarray(0, 4).toString('hex')).toBe('504b0304');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(receipts[0].sha256);
    expect(attempt.status, JSON.stringify(attempt.error)).toBe('succeeded');
    expect(attempt.artifacts).toEqual([
      expect.objectContaining({
        kind: 'file',
        taskId: child.id,
        attemptId: attempt.id,
        path: 'pants.xlsx',
        bytes: receipts[0].size,
        sha256: receipts[0].sha256,
      }),
    ]);
    const evidence = f.settings.get(
      'automation:receipt:' + task.id + ':' + f.schedules.get(task.id)!.lastRunAt,
    )?.value;
    expect(evidence).toMatchObject({
      outputs: [
        {
          format: 'spreadsheet',
          path: receipts[0].path,
          bytes: receipts[0].size,
          sha256: receipts[0].sha256,
        },
      ],
    });
    expect((await f.history(task.id))[0]).toMatchObject({ status: 'success' });
    // The same Agents in an unbound room must not inherit this round, including full-access.
    const unbound = await publishTask(f, 'team');
    expect((await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: unbound.id })).fired).toBe(
      true,
    );
    expect((await terminalHistory(f, unbound.id, 1))[0].status).toBe('failed');
    const isolated = await settledGroup(f, unbound.id);
    expect(isolated.conversation.id).not.toBe(group.conversation.id);
    const isolatedChild = isolated.tasks.find((work) => work.deliverable?.kind === 'file')!;
    expect(isolatedChild.resourceClaims.every((claim) => claim.mode === 'read')).toBe(true);
    expect(
      isolated.attempts.find((item) => item.id === isolatedChild.currentAttemptId)?.error?.code,
    ).toBe('collaboration.file_delivery_readonly');
    expect(officeReceipts(f.provider.toolResults)).toHaveLength(1);
    const otherRoot = join(f.root, 'other-workspace');
    mkdirSync(otherRoot);
    const otherWorkspace = new SqliteWorkspaceStore(f.connection.raw).createWorkspace({
      name: 'Separate unbound workspace',
      folderPath: realpathSync.native(otherRoot),
    });
    const otherTask = await publishTask(f, 'team');
    await f.ok('scheduledTask.update', {
      taskId: otherTask.id,
      patch: { workspaceId: otherWorkspace.id },
    });
    expect(
      (await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: otherTask.id })).fired,
    ).toBe(true);
    expect((await terminalHistory(f, otherTask.id, 1))[0].status).toBe('failed');
    const other = await settledGroup(f, otherTask.id);
    expect(other.conversation.workspaceId).toBe(otherWorkspace.id);
    const otherChild = other.tasks.find((work) => work.deliverable?.kind === 'file')!;
    expect(otherChild.resourceClaims.every((claim) => claim.mode === 'read')).toBe(true);
    expect(
      other.attempts.find((item) => item.id === otherChild.currentAttemptId)?.error?.code,
    ).toBe('collaboration.file_delivery_readonly');
    expect(officeReceipts(f.provider.toolResults)).toHaveLength(1);
  },
);

it.each([
  { path: 'nested/pants.xlsx', error: undefined },
  { path: '../pants.xlsx', error: 'collaboration.artifact_outside_workspace' },
  { path: 'other.xlsx', error: 'collaboration.artifact_contract_mismatch' },
  { path: 'C:/outside/pants.xlsx', error: 'collaboration.artifact_path_invalid' },
])('scheduled file export respects the room-bound contract path $path', async ({ path, error }) => {
  const f = await fixture();
  f.provider.mode = 'export-file';
  f.provider.fileContractPath = path;
  const task = await publishTask(f, 'team', {
    executionMode: 'workspace',
    outputs: ['spreadsheet'],
  });
  expect((await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: task.id })).fired).toBe(
    true,
  );
  const history = await terminalHistory(f, task.id, 1);
  const group = await settledGroup(f, task.id);
  const child = group.tasks.find((work) => work.deliverable?.kind === 'file')!;
  if (error) {
    expect(history[0].status).toBe('failed');
    expect(f.provider.toolResults.join('\n')).toContain(error);
    expect(officeReceipts(f.provider.toolResults)).toEqual([]);
    expect(
      group.attempts.find((item) => item.id === child.currentAttemptId)?.artifacts ?? [],
    ).toEqual([]);
    expect(existsSync(join(f.root, 'pants.xlsx'))).toBe(false);
  } else {
    expect(history[0].status).toBe('success');
    const receipts = officeReceipts(f.provider.toolResults);
    expect(receipts).toHaveLength(1);
    expect(receipts[0].path.endsWith(join('nested', 'pants.xlsx'))).toBe(true);
    expect(group.attempts.find((item) => item.id === child.currentAttemptId)?.artifacts).toEqual([
      expect.objectContaining({ path, sha256: receipts[0].sha256, bytes: receipts[0].size }),
    ]);
  }
});

it.each([undefined, 'ask'] as const)(
  'Team file delivery stays read-only without a writable scheduled scope (executionMode=%s)',
  async (executionMode) => {
    const f = await fixture();
    f.provider.mode = 'export-file';
    const task = await publishTask(
      f,
      'team',
      executionMode ? { executionMode, outputs: ['spreadsheet'] } : undefined,
    );
    expect((await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: task.id })).fired).toBe(
      true,
    );
    expect((await terminalHistory(f, task.id, 1))[0].status).toBe('failed');
    const group = await settledGroup(f, task.id);
    const child = group.tasks.find((work) => work.deliverable?.kind === 'file')!;
    expect(child.resourceClaims.every((claim) => claim.mode === 'read')).toBe(true);
    expect(group.attempts.find((item) => item.id === child.currentAttemptId)?.error?.code).toBe(
      'collaboration.file_delivery_readonly',
    );
    expect(officeReceipts(f.provider.toolResults)).toEqual([]);
    expect(
      f.provider.requests.filter((request) => request.systemPrompt?.includes('purpose=work')),
    ).toEqual([]);
  },
);

it('Team file claims and Office evidence use the frozen mode, with task edits applying only to the next round', async () => {
  const f = await fixture();
  f.provider.mode = 'export-file';
  const task = await publishTask(f, 'team', {
    executionMode: 'workspace',
    outputs: ['spreadsheet'],
  });
  const release = f.provider.hold();
  try {
    expect((await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: task.id })).fired).toBe(
      true,
    );
    await waitFor(
      () => f.provider.requests.length,
      (count) => count > 0,
      'Coordinator did not enter the frozen round',
    );
    await f.ok('scheduledTask.update', {
      taskId: task.id,
      patch: { automation: { executionMode: 'ask', outputs: ['spreadsheet'] } },
    });
    expect(f.schedules.get(task.id)?.automation?.executionMode).toBe('ask');
  } finally {
    release();
  }
  expect((await terminalHistory(f, task.id, 1))[0].status).toBe('success');
  const first = await settledGroup(f, task.id);
  const child = first.tasks.find((work) => work.deliverable?.kind === 'file')!;
  expect(child.resourceClaims.every((claim) => claim.mode === 'write')).toBe(true);
  expect(officeReceipts(f.provider.toolResults)).toHaveLength(1);
  expect((await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: task.id })).fired).toBe(
    true,
  );
  const nextHistory = await terminalHistory(f, task.id, 2);
  expect(nextHistory.filter((item) => item.status === 'failed')).toHaveLength(1);
  const second = await settledGroup(f, task.id);
  const next = second.tasks.find(
    (work) => work.deliverable?.kind === 'file' && work.id !== child.id,
  )!;
  expect(next.resourceClaims.every((claim) => claim.mode === 'read')).toBe(true);
  expect(second.attempts.find((item) => item.id === next.currentAttemptId)?.error?.code).toBe(
    'collaboration.file_delivery_readonly',
  );
  expect(officeReceipts(f.provider.toolResults)).toHaveLength(1);
});

it.each(['workspace', 'full-access'] as const)(
  'Team %s automation does not expose or execute Office export for a read-only member',
  async (executionMode) => {
    const f = await fixture();
    await f.ok('globalAgent.update', { agentId: f.member.id, writePolicy: 'read-only' });
    expect(f.agents.get(f.member.id)?.writePolicy).toBe('read-only');
    // A document contract reaches the Provider instead of short-circuiting at the file fence.
    f.provider.mode = 'export';
    const task = await publishTask(f, 'team', {
      executionMode,
      outputs: ['spreadsheet', 'presentation'],
    });
    expect((await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: task.id })).fired).toBe(
      true,
    );
    await terminalHistory(f, task.id, 1);
    await settledGroup(f, task.id);
    const memberCalls = f.provider.requests.filter((request) =>
      request.systemPrompt?.includes('purpose=work'),
    );
    expect(memberCalls.length).toBeGreaterThan(0);
    for (const request of memberCalls) {
      expect(request.tools?.map((tool) => tool.name)).not.toContain('automation_export_artifact');
    }
    // The adversarial Provider still requests hidden tools: the execution guard must agree.
    expect(f.provider.emittedTools.some((tool) => tool.name === 'automation_export_artifact')).toBe(
      true,
    );
    expect(officeReceipts(f.provider.toolResults)).toEqual([]);
    expect((await f.history(task.id))[0].status).toBe('failed');
    expect(f.conversations.get(f.schedules.get(task.id)!.conversationId!)?.executionMode).toBe(
      'ask',
    );
  },
);

it.each(['model', 'agent', 'team'] as const)(
  '%s schedule accepts actual XLSX/PPTX tool receipts, checks the bytes, and does not reuse last-round artifacts as fresh evidence',
  async (kind) => {
    const f = await fixture();
    f.provider.mode = 'export';
    const task = await publishTask(f, kind, {
      executionMode: 'full-access',
      outputs: ['spreadsheet', 'presentation'],
      acceptance:
        'The spreadsheet has pants count=7, and the presentation cites the same fixture evidence.',
    });
    const first = await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: task.id });
    expect(first.fired, first.reason).toBe(true);
    const firstHistory = await terminalHistory(f, task.id, 1);
    expect(firstHistory[0], JSON.stringify(firstHistory)).toMatchObject({ status: 'success' });
    const receipts = officeReceipts(f.provider.toolResults);
    expect(receipts.map((receipt) => receipt.format).sort()).toEqual([
      'presentation',
      'spreadsheet',
    ]);
    for (const receipt of receipts) {
      const path = scopedPath(f.root, receipt.path);
      const bytes = readFileSync(path);
      expect(bytes.length).toBe(receipt.size);
      expect(bytes.subarray(0, 4).toString('hex')).toBe('504b0304');
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(receipt.sha256);
      expect(bytes.includes(Buffer.from('[Content_Types].xml'))).toBe(true);
      expect(bytes.includes(Buffer.from('pants'))).toBe(true);
      expect(
        bytes.includes(
          Buffer.from(
            receipt.format === 'spreadsheet' ? 'xl/workbook.xml' : 'ppt/presentation.xml',
          ),
        ),
      ).toBe(true);
    }
    expect(
      f.provider.requests.some((request) =>
        request.tools?.some((tool) => tool.name === 'automation_export_artifact'),
      ),
    ).toBe(true);
    // Existing valid files and identical Provider prose must not satisfy a new round.
    f.provider.mode = 'claim';
    f.provider.claimedPath = receipts.map((receipt) => receipt.path).join(', ');
    const second = await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: task.id });
    expect(second.fired, second.reason).toBe(true);
    const allHistory = await terminalHistory(f, task.id, 2);
    expect(allHistory.filter((entry) => entry.status === 'success')).toHaveLength(1);
    const failed = allHistory.find((entry) => entry.status === 'failed');
    expect(failed?.reason).toMatch(/文件|产物|交付|output|artifact/i);
    expect(receipts.every((receipt) => existsSync(scopedPath(f.root, receipt.path)))).toBe(true);
  },
);

it.each([true, false])(
  'local Gmail MCP receipt evidence is required and repeated actor calls do not resend (receipt=%s)',
  async (hasReceipt) => {
    const f = await fixture();
    const connector = await httpConnector(
      f,
      'gmail-fixture-only',
      hasReceipt ? 'fixture-message-id-1' : undefined,
    );
    f.provider.mode = 'mail';
    f.provider.mailServerId = connector.record.id;
    f.agents.update({ agentId: f.member.id, mcpServerIds: [connector.record.id] });
    const task = await publishTask(f, 'agent', {
      executionMode: 'full-access',
      delivery: {
        kind: 'gmail',
        mcpServerId: connector.record.id,
        recipient: 'recipient@example.test',
      },
    });
    const result = await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: task.id });
    expect(result.fired, result.reason).toBe(true);
    const history = await terminalHistory(f, task.id, 1);
    expect(history[0].status, JSON.stringify(history)).toBe(hasReceipt ? 'success' : 'reconciling');
    if (!hasReceipt) expect(history[0].reason).toMatch(/回执|核对|邮件|receipt/i);
    expect(connector.errors).toEqual([]);
    const sendCalls = connector.calls.filter((call) => call.method === 'tools/call');
    expect(sendCalls).toHaveLength(1); // two Provider actor calls, one actual connector request
    expect(sendCalls[0]).toMatchObject({
      params: { name: 'send_email', arguments: { to: 'recipient@example.test' } },
    });
    expect(
      f.provider.requests.some((request) =>
        request.tools?.some((tool) => tool.name === 'mcp__gmail-fixture-only__send_email'),
      ),
    ).toBe(true);
  },
);

it.each(['model', 'agent', 'team'] as const)(
  '%s schedule freezes its Profile for the in-flight round and applies edits only to the next round',
  async (kind) => {
    const f = await fixture();
    const nextProfile = f.browser.createProfile({
      id: 'automation-second-account',
      name: 'Next-round fixture account',
    });
    f.provider.mode = 'browser';
    const task = await publishTask(f, kind, {
      executionMode: 'full-access',
      browser: { profileId: PROFILE },
    });
    const release = f.provider.hold();
    try {
      const first = await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: task.id });
      expect(first.fired, first.reason).toBe(true);
      await waitFor(
        () => f.provider.requests.length,
        (count) => count > 0,
        'Frozen round did not reach Provider',
      );
      await f.ok('scheduledTask.update', {
        taskId: task.id,
        patch: {
          automation: { executionMode: 'full-access', browser: { profileId: nextProfile.id } },
        },
      });
      const busy = await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: task.id });
      expect(busy.fired).toBe(false);
    } finally {
      release();
    }
    const firstDone = await terminalHistory(f, task.id, 1);
    expect(
      firstDone.some((entry) => entry.status === 'success'),
      JSON.stringify(firstDone),
    ).toBe(true);
    expect(f.worker.calls.length).toBeGreaterThan(0);
    expect(f.worker.calls.every((call) => call.profileId === PROFILE)).toBe(true);
    const split = f.worker.calls.length;
    const second = await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: task.id });
    expect(second.fired, second.reason).toBe(true);
    const done = await terminalHistory(f, task.id, 2);
    expect(done.filter((entry) => entry.status === 'success')).toHaveLength(2);
    expect(f.worker.calls.length).toBeGreaterThan(split);
    expect(f.worker.calls.slice(split).every((call) => call.profileId === nextProfile.id)).toBe(
      true,
    );
  },
);

it('normalizes omitted executionMode to workspace in the persisted task and admitted run contract', async () => {
  const f = await fixture();
  const task = await publishTask(f, 'model', { browser: { profileId: PROFILE } });
  expect(task.automation).toEqual({ executionMode: 'workspace', browser: { profileId: PROFILE } });
  const trigger = await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: task.id });
  expect(trigger.fired, trigger.reason).toBe(true);
  await terminalHistory(f, task.id, 1);
  expect((f.schedules.get(task.id) as AutomationTask).automation?.executionMode).toBe('workspace');
  const currentInstruction = String(
    f.provider.requests[0].messages.filter((message) => message.role === 'user').at(-1)?.content,
  );
  expect(currentInstruction).toMatch(/"executionMode"\s*:\s*"workspace"/);
});

// Not claimed by this suite: real browser login/captcha/download behavior;
// real provider/kernel availability/fallback; Gmail OAuth/SMTP delivery;
// scheduler wall-clock/DST/random/catch-up; a general semantic business-acceptance
// evaluator; filesystem alias/ZIP corruption attacks (the exporter has dedicated
// tests); and crash/restart recovery of receipts/active group leases.

it.each(['model', 'agent', 'team'] as const)(
  '%s exports real Office files then sends their current-round paths through Gmail MCP exactly once',
  async (kind) => {
    const f = await fixture();
    const connector = await httpConnector(f, 'gmail-fixture-only', 'fixture-confirmed-message');
    f.provider.mode = 'export-mail';
    f.provider.mailServerId = connector.record.id;
    if (kind === 'agent')
      f.agents.update({ agentId: f.member.id, mcpServerIds: [connector.record.id] });
    const registeredBefore = f.mcp.get(connector.record.id);
    const task = await publishTask(f, kind, {
      executionMode: 'full-access',
      outputs: ['spreadsheet', 'presentation'],
      delivery: {
        kind: 'gmail',
        mcpServerId: connector.record.id,
        recipient: 'recipient@example.test',
        toolName: 'send_email',
      },
      acceptance: 'Inspect the real pants count=7 files and require a connector send receipt.',
    });
    const trigger = await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: task.id });
    expect(trigger.fired, trigger.reason).toBe(true);
    const done = await terminalHistory(f, task.id, 1);
    expect(done[0], JSON.stringify(done)).toMatchObject({ status: 'success' });
    expect(connector.errors).toEqual([]);
    expect(connector.calls.some((call) => call.method === 'tools/list')).toBe(true);
    expect(
      f.mcp.get(connector.record.id),
      'Read-only connection probes must not mutate registry metadata',
    ).toEqual(registeredBefore);
    const receipts = officeReceipts(f.provider.toolResults);
    expect(receipts.map((receipt) => receipt.format).sort()).toEqual([
      'presentation',
      'spreadsheet',
    ]);
    const sends = connector.calls.filter(
      (call) => call.method === 'tools/call' && call.params?.name === 'send_email',
    );
    expect(sends).toHaveLength(1);
    expect(sends[0].params?.arguments).toMatchObject({
      to: 'recipient@example.test',
      attachments: expect.arrayContaining(receipts.map((receipt) => receipt.path)),
    });
    expect(sends[0].params!.arguments!.attachments as unknown[]).toHaveLength(2);
    for (const receipt of receipts) {
      const bytes = readFileSync(scopedPath(f.root, receipt.path));
      expect(bytes.length).toBe(receipt.size);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(receipt.sha256);
    }
    const actorAttempts = f.provider.emittedTools.filter(
      (tool) => tool.name === 'mcp__gmail-fixture-only__send_email',
    );
    expect(actorAttempts).toHaveLength(2);
    expect(new Set(actorAttempts.map((tool) => tool.id)).size).toBe(2);
    expect(actorAttempts[0].args).toEqual(actorAttempts[1].args);
    expect(f.schedules.get(task.id)?.lastResult?.status).toBe('success');
  },
);

it('native scheduled mail injects verified Office bytes before the connector sees required contentBase64, even when the model sends empty attachments', async () => {
  const f = await fixture();
  const connector = await httpConnector(f, 'gmail-bytes-fixture', 'fixture-bytes-receipt', true);
  f.provider.mode = 'export-mail';
  f.provider.mailServerId = connector.record.id;
  f.provider.mailEmptyAttachments = true;
  const task = await publishTask(f, 'model', {
    executionMode: 'workspace',
    outputs: ['spreadsheet', 'presentation'],
    delivery: {
      kind: 'gmail',
      mcpServerId: connector.record.id,
      recipient: 'recipient@example.test',
      toolName: 'send_email',
    },
  });
  expect((await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: task.id })).fired).toBe(
    true,
  );
  expect((await terminalHistory(f, task.id, 1))[0].status).toBe('success');
  const actorCalls = f.provider.emittedTools.filter(
    (tool) => tool.name === 'mcp__gmail-bytes-fixture__send_email',
  );
  expect(actorCalls).toHaveLength(2);
  expect(
    actorCalls.every(
      (tool) => Array.isArray(tool.args.attachments) && tool.args.attachments.length === 0,
    ),
  ).toBe(true);
  const sends = connector.calls.filter(
    (call) => call.method === 'tools/call' && call.params?.name === 'send_email',
  );
  expect(sends).toHaveLength(1);
  const attachments = sends[0].params!.arguments!.attachments as Array<{
    filename: string;
    contentBase64: string;
    mimeType: string;
  }>;
  const receipts = officeReceipts(f.provider.toolResults);
  expect(attachments).toHaveLength(2);
  for (const receipt of receipts) {
    const attachment = attachments.find((item) => item.filename === basename(receipt.path))!;
    expect(attachment).toBeDefined();
    const bytes = Buffer.from(attachment.contentBase64, 'base64');
    expect(bytes).toEqual(readFileSync(scopedPath(f.root, receipt.path)));
    expect(bytes.length).toBe(receipt.size);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(receipt.sha256);
    expect(attachment.mimeType).toMatch(/officedocument/);
  }
  expect(connector.errors).toEqual([]);
  const schema = f.provider.requests
    .flatMap((request) => request.tools ?? [])
    .find((tool) => tool.name === 'mcp__gmail-bytes-fixture__send_email')!.inputSchema;
  expect(schema).toMatchObject({
    properties: {
      attachments: { minItems: 1, items: { required: ['filename', 'contentBase64', 'mimeType'] } },
    },
  });
});

it('MCP preflight uses live registered-tool intersection without advertising injected live-only tools or rewriting the registry', async () => {
  const f = await fixture();
  const connector = await httpConnector(f);
  connector.liveTools.push({
    name: 'injected_live_only',
    description: 'Not registered for this executor',
    inputSchema: { type: 'object' },
  });
  const before = f.mcp.get(connector.record.id);
  const task = await publishTask(f, 'model', {
    executionMode: 'full-access',
    requiredMcpServerIds: [connector.record.id],
  });
  const result = await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: task.id });
  expect(result.fired, result.reason).toBe(true);
  const done = await terminalHistory(f, task.id, 1);
  expect(done[0]).toMatchObject({ status: 'success' });
  expect(connector.calls.some((call) => call.method === 'tools/list')).toBe(true);
  expect(
    f.provider.requests.flatMap((request) => request.tools?.map((tool) => tool.name) ?? []),
  ).not.toContain('mcp__automation-connector__injected_live_only');
  expect(f.mcp.get(connector.record.id)).toEqual(before);
});

it('Gmail preflight rejects registered send_email without recipient schema before executing the Provider', async () => {
  const f = await fixture();
  const connector = await httpConnector(f, 'gmail-fixture-only', 'fixture-confirmed-message');
  f.mcp.register({
    ...connector.record,
    tools: connector.record.tools.map((tool) =>
      tool.name === 'send_email' ? { ...tool, inputSchemaJson: undefined } : tool,
    ),
  });
  const task = await publishTask(f, 'model', {
    executionMode: 'full-access',
    delivery: {
      kind: 'gmail',
      mcpServerId: connector.record.id,
      recipient: 'recipient@example.test',
    },
  });
  const result = await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: task.id });
  expect(result.fired).toBe(false);
  expect(result.reason).toMatch(/Gmail|send|邮件|schema|收件/i);
  expect(f.provider.requests).toEqual([]);
  expect(connector.calls.filter((call) => call.method === 'tools/call')).toEqual([]);
  expect((await f.history(task.id)).every((entry) => entry.status === 'blocked')).toBe(true);
});

it.each([false, true])(
  'a terminal daemon Team round clears pending even without a duplicate dispatch (automation=%s)',
  async (withAutomation) => {
    const f = await fixture();
    const completion = vi
      .spyOn(daemonDispatchClient, 'sendTaskCompletionToDaemon')
      .mockResolvedValue(true);
    const probe = f.runtime as unknown as {
      scheduledTaskDispatches: { pendingTaskIds(): string[] };
    };
    const task = await publishTask(
      f,
      'team',
      withAutomation ? { executionMode: 'full-access' } : undefined,
    );
    const release = f.provider.hold();
    try {
      const ack = await f.ok<{ accepted: boolean }>('task.dispatch', {
        taskId: task.id,
        instruction: task.instruction,
        target: task.target,
        skillVersionIds: [],
      });
      expect(ack.accepted).toBe(true);
      await waitFor(
        () => f.provider.requests.length,
        (count) => count > 0,
        'Daemon Team has no actual run',
      );
      expect(probe.scheduledTaskDispatches.pendingTaskIds()).toEqual([task.id]);
      expect(completion).not.toHaveBeenCalled();
    } finally {
      release();
    }
    const done = await terminalHistory(f, task.id, 1);
    expect(done[0]).toMatchObject({ status: 'success' });
    const group = await settledGroup(f, task.id);
    expect(group.tasks.filter((work) => work.purpose === 'work')).toHaveLength(1);
    await waitFor(
      () => completion.mock.calls.length,
      (count) => count >= 1,
      'Terminal group omitted daemon completion',
    );
    expect(completion).toHaveBeenCalledTimes(1);
    expect(completion.mock.calls[0][1]).toMatchObject({ taskId: task.id, status: 'success' });
    expect(probe.scheduledTaskDispatches.pendingTaskIds()).toEqual([]);
  },
);

describe('scheduled automation security regressions', () => {
  it.each(['team', 'model', 'workspace'] as const)(
    'rebinds an existing Team schedule after changing its %s instead of reusing the previous group',
    async (change) => {
      const f = await fixture();
      const task = await publishTask(f, 'team', { executionMode: 'full-access' });
      expect((await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: task.id })).fired).toBe(
        true,
      );
      await terminalHistory(f, task.id, 1);
      const original = await settledGroup(f, task.id);
      const oldWorkIds = original.tasks.map((work) => work.id);
      let expectedWorkspace = f.workspace.id;
      let expectedTeam = f.team.id;
      let target: ScheduledTaskTarget = f.target('team');
      if (change === 'team') {
        const leader = f.agents.create({
          id: 'automation-replacement-leader' as AgentId,
          name: 'Replacement leader',
          defaultModelId: 'fake-mini' as ModelId,
        });
        const replacement = f.teams.create({
          id: 'automation-replacement-team' as TeamId,
          name: 'Replacement team',
          coordinatorAgentId: leader.id,
          members: [
            { agentId: leader.id, role: 'coordinator' },
            { agentId: f.member.id, role: 'researcher' },
          ],
        });
        target = { kind: 'team', teamId: replacement.id };
        expectedTeam = replacement.id;
      } else if (change === 'model') {
        target = f.target('model');
      } else {
        const nextRoot = scopedPath(f.root, join(f.root, 'replacement-scope'));
        mkdirSync(nextRoot);
        expectedWorkspace = new SqliteWorkspaceStore(f.connection.raw).createWorkspace({
          id: 'automation-replacement-workspace' as WorkspaceId,
          name: 'Replacement scope',
          folderPath: realpathSync.native(nextRoot),
        }).id;
      }
      await f.ok('scheduledTask.update', {
        taskId: task.id,
        patch: { target, workspaceId: expectedWorkspace },
      });
      const fired = await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: task.id });
      expect(fired.fired, fired.reason).toBe(true);
      await terminalHistory(f, task.id, 2);
      const current = (
        await f.ok<{ tasks: AutomationTask[] }>('scheduledTask.list', {
          includeDisabled: true,
        })
      ).tasks.find((row) => row.id === task.id)!;
      expect(
        current.conversationId,
        'Previous roster/scope must not execute a retargeted schedule',
      ).not.toBe(original.conversation.id);
      expect(f.conversations.get(current.conversationId!)!).toMatchObject({
        workspaceId: expectedWorkspace,
        track: change === 'model' ? 'model' : 'team',
        targetRef: change === 'model' ? 'fake-mini' : expectedTeam,
      });
      expect(
        f.host
          .command({ action: 'get', conversationId: original.conversation.id })
          .snapshot!.tasks.map((work) => work.id),
      ).toEqual(oldWorkIds);
      if (change !== 'model') {
        const next = await settledGroup(f, task.id);
        const expectedAgents = f.teams
          .get(expectedTeam)!
          .members.map((member) => member.agentId)
          .sort();
        expect(
          next.members
            .filter((member) => member.kind === 'agent' && member.active)
            .map((member) => member.agentId)
            .sort(),
        ).toEqual(expectedAgents);
      }
    },
  );
});

it('a new-goal manual child of a historical scheduled task cannot reactivate its frozen automation capabilities', async () => {
  const f = await fixture();
  f.provider.mode = 'export';
  const task = await publishTask(f, 'team', {
    executionMode: 'full-access',
    outputs: ['spreadsheet', 'presentation'],
  });
  expect((await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: task.id })).fired).toBe(
    true,
  );
  expect((await terminalHistory(f, task.id, 1))[0].status).toBe('success');
  const group = await settledGroup(f, task.id);
  const historicalParent = group.tasks.find((work) => work.purpose === 'coordination')!;
  expect(historicalParent).toBeDefined();
  await f.ok('scheduledTask.update', { taskId: task.id, patch: { enabled: false } });
  await f.ok('collaboration.command', {
    action: 'room-brief',
    conversationId: group.conversation.id,
    clientRequestId: 'new-manual-goal',
    goal: 'Write a manual document without the previous automation contract.',
    expectedGoalRevision: group.conversation.room!.goalRevision,
  });
  const changed = f.host.command({
    action: 'get',
    conversationId: group.conversation.id,
  }).snapshot!;
  expect(changed.conversation.room!.goalRevision).toBeGreaterThan(
    group.conversation.room!.goalRevision,
  );
  f.provider.mode = 'plain';
  const before = f.provider.requests.length;
  const release = f.provider.hold();
  try {
    const response = await f.rpc('collaboration.command', {
      action: 'dispatch',
      conversationId: group.conversation.id,
      clientRequestId: 'manual-dispatch-historical-parent',
      parentTaskId: historicalParent.id,
      tasks: [
        {
          assigneeMemberId: 'agent:' + f.member.id,
          title: 'Manual new-goal work',
          instructions: 'Manual new-goal document; do not resume the previous automated export.',
          deliverable: { kind: 'document', title: 'Manual new-goal work' },
        },
      ],
    });
    if (response.error) {
      // Rejecting an old-goal parent is also a valid capability fence.
      expect(response.error.message).toContain('task_room.goal_changed');
      expect(f.provider.requests).toHaveLength(before);
      return;
    }
    const calls = await waitFor(
      () => f.provider.requests.slice(before),
      (requests) => requests.length > 0,
      'Manual child did not reach the real Runtime provider boundary',
    );
    const manual = f.host
      .command({ action: 'get', conversationId: group.conversation.id })
      .snapshot!.tasks.find((work) => work.title === 'Manual new-goal work')!;
    expect(manual.goalRevision).toBe(changed.conversation.room!.goalRevision);
    expect(
      calls[0].tools?.map((tool) => tool.name),
      'A historical scheduled ancestor must not grant automation export to a new-goal manual turn',
    ).not.toContain('automation_export_artifact');
  } finally {
    release();
  }
  await settledGroup(f, task.id);
});

describe.each(MATRIX)(
  '$kind / Browser=$hasBrowser due taskSchedulerTick',
  ({ kind, hasBrowser }) => {
    it('uses SQLite due selection, ignores drafts/future deadlines, executes once and advances nextRunAt before a second tick', async () => {
      const f = await fixture();
      const flow = hasBrowser ? await publishedFlow(f) : undefined;
      f.provider.mode = hasBrowser ? 'workflow' : 'plain';
      f.provider.workflowTaskId = flow?.task.id;
      const draft = await f.create(kind, {
        executionMode: 'full-access',
        ...(flow
          ? {
              browser: {
                profileId: PROFILE,
                workflowTaskId: flow.task.id,
                variables: { keyword: 'tick-pants' },
              },
            }
          : {}),
      });
      // The private heartbeat entry is an explicitly authorized test seam. All
      // selection/admission/execution/history still use real Runtime and SQLite.
      const scheduler = f.runtime as unknown as { taskSchedulerTick(): Promise<void> };
      const past = new Date(Date.now() - 60_000).toISOString();
      await f.ok('scheduledTask.update', { taskId: draft.id, patch: { nextRunAt: past } });
      expect(f.schedules.get(draft.id)).toMatchObject({ enabled: false, nextRunAt: past });
      expect(f.schedules.listDue(new Date().toISOString())).toEqual([]);
      await scheduler.taskSchedulerTick();
      expect(f.provider.requests).toEqual([]);
      expect(f.worker.calls).toEqual([]);
      expect(f.worker.acquired).toEqual([]);
      expect(await f.history(draft.id)).toEqual([]);
      expect(f.repository.list(f.workspace.id)).toEqual([]);
      expect(f.schedules.get(draft.id)?.conversationId).toBeUndefined();

      const future = new Date(Date.now() + 60 * 60_000).toISOString();
      await f.ok('scheduledTask.update', {
        taskId: draft.id,
        patch: { enabled: true, nextRunAt: future },
      });
      expect(f.schedules.get(draft.id)).toMatchObject({ enabled: true, nextRunAt: future });
      expect(f.schedules.listDue(new Date().toISOString())).toEqual([]);
      await scheduler.taskSchedulerTick();
      expect(f.provider.requests).toEqual([]);
      expect(f.worker.calls).toEqual([]);
      expect(f.worker.acquired).toEqual([]);
      expect(await f.history(draft.id)).toEqual([]);
      expect(f.repository.list(f.workspace.id)).toEqual([]);
      expect(f.schedules.get(draft.id)?.conversationId).toBeUndefined();

      await f.ok('scheduledTask.update', { taskId: draft.id, patch: { nextRunAt: past } });
      const due = f.schedules.listDue(new Date().toISOString());
      expect(due.map((task) => task.id)).toEqual([draft.id]);
      expect(due[0]).toMatchObject({ enabled: true, nextRunAt: past, target: f.target(kind) });
      const startedAt = Date.now();
      const realRandom = Math.random;
      // Math.random also supplies ULID entropy. Only fix heartbeat jitter;
      // returning zero for encodeRandom would collide real SQLite event ids.
      const jitter = vi.spyOn(Math, 'random').mockImplementation(() => {
        const stack = new Error().stack ?? '';
        return stack.includes('taskSchedulerTick') && !stack.includes('encodeRandom')
          ? 0
          : realRandom();
      });
      try {
        await scheduler.taskSchedulerTick();
      } finally {
        jitter.mockRestore();
      }
      const history = await terminalHistory(f, draft.id, 1);
      expect(history, JSON.stringify(history)).toHaveLength(1);
      expect(history[0], JSON.stringify(history)).toMatchObject({
        taskId: draft.id,
        status: 'success',
      });
      expect(Date.parse(history[0].firedAt)).toBeGreaterThanOrEqual(startedAt);
      expect(f.provider.requests.length).toBeGreaterThan(0);
      const executed = (
        await f.ok<{ tasks: AutomationTask[] }>('scheduledTask.list', { includeDisabled: true })
      ).tasks.find((task) => task.id === draft.id)!;
      expect(executed.lastRunAt).toBe(history[0].firedAt);
      expect(executed.lastResult).toMatchObject({ status: 'success', firedAt: history[0].firedAt });
      expect(executed.nextRunAt).toBeTruthy();
      expect(Date.parse(executed.nextRunAt!)).toBeGreaterThan(Date.now());
      expect(Date.parse(executed.nextRunAt!)).toBeGreaterThan(Date.parse(past));
      expect(f.schedules.listDue(new Date().toISOString())).toEqual([]);
      if (kind === 'team') {
        const group = await settledGroup(f, draft.id);
        expect(group.conversation.id).toBe(executed.conversationId);
        expect(group.conversation.room).toBeDefined();
        expect(
          group.receipts['send:scheduled:' + draft.id + ':' + history[0].firedAt],
        ).toBeTruthy();
        expect(
          group.members.filter((member) => member.active).map((member) => member.agentId),
        ).toEqual(expect.arrayContaining([f.leader.id, f.member.id]));
        const work = group.tasks.filter((task) => task.purpose === 'work');
        expect(work).toHaveLength(1);
        expect(work[0].assigneeMemberId).toBe('agent:' + f.member.id);
        expect(
          group.attempts.every((attempt) => attempt.status === 'succeeded'),
          JSON.stringify(group.attempts),
        ).toBe(true);
      } else {
        expect(history[0].runId).toBeTruthy();
        expect(history[0].summary).toContain('count=7');
        expect(f.conversations.get(executed.conversationId!)).toMatchObject({
          track: kind,
          targetRef: kind === 'model' ? 'fake-mini' : f.member.id,
        });
      }
      if (flow) {
        const runs = f.browser.listWorkflowRuns(flow.task.id);
        expect(runs).toHaveLength(1);
        expect(runs[0]).toMatchObject({ status: 'succeeded', versionId: flow.version!.id });
        expect(f.worker.calls.length).toBeGreaterThan(0);
        expect(f.worker.calls.every((call) => call.profileId === PROFILE)).toBe(true);
        expect(f.worker.acquired.every((lease) => lease.profileId === PROFILE)).toBe(true);
        expect(
          f.worker.calls.filter((call) => call.action.kind === 'fill').map((call) => call.action),
        ).toMatchObject([{ text: 'tick-pants' }]);
      } else {
        expect(f.worker.calls).toEqual([]);
        expect(f.worker.acquired).toEqual([]);
      }

      const beforeRepeat = {
        requests: f.provider.requests.length,
        calls: f.worker.calls.length,
        leases: f.worker.acquired.length,
      };
      await scheduler.taskSchedulerTick();
      expect(f.schedules.get(draft.id)?.nextRunAt).toBe(executed.nextRunAt);
      expect(f.schedules.get(draft.id)?.lastRunAt).toBe(history[0].firedAt);
      expect(await f.history(draft.id)).toEqual(history);
      expect(f.provider.requests).toHaveLength(beforeRepeat.requests);
      expect(f.worker.calls).toHaveLength(beforeRepeat.calls);
      expect(f.worker.acquired).toHaveLength(beforeRepeat.leases);
      if (flow) expect(f.browser.listWorkflowRuns(flow.task.id)).toHaveLength(1);
      if (kind === 'team') {
        const repeated = await settledGroup(f, draft.id);
        expect(repeated.tasks.filter((task) => task.purpose === 'work')).toHaveLength(1);
        expect(
          Object.keys(repeated.receipts).filter((key) =>
            key.startsWith('send:scheduled:' + draft.id + ':'),
          ),
        ).toHaveLength(1);
      }
    });
  },
);

// Derive dates from the actual admitted timestamp. Opposite date-line zones differ by one day.
const BUSINESS_TIME_ZONE = 'Pacific/Kiritimati';
function freezeBusinessClock(): void {
  const now = Date.now();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
}
function businessDate(firedAt: string, timeZone = BUSINESS_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(firedAt));
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  return value('year') + '-' + value('month') + '-' + value('day');
}
function previousBusinessDate(firedAt: string): string {
  return businessDate(new Date(Date.parse(firedAt) - 86_400_000).toISOString());
}
const BUSINESS_CHECKS: NonNullable<Automation['acceptanceChecks']> = {
  minimumRows: 2,
  requiredColumns: ['keyword', 'date', 'sourceURL'],
  dateColumn: 'date',
  sourceUrlColumn: 'sourceURL',
  minimumSlides: 2,
};
function businessSheet(
  sourceUrl: string,
  localDate: string,
  fileName = 'accepted.xlsx',
): ProbeTool {
  return {
    name: 'automation_export_artifact',
    args: {
      format: 'spreadsheet',
      fileName,
      title: 'Actual fixture rows',
      columns: ['keyword', 'date', 'sourceURL'],
      rows: [
        ['pants', localDate, sourceUrl + '/source/a'],
        ['shirt', localDate, sourceUrl + '/source/b'],
      ],
    },
  };
}
function businessSlides(fileName = 'accepted.pptx'): ProbeTool {
  return {
    name: 'automation_export_artifact',
    args: {
      format: 'presentation',
      fileName,
      title: 'Actual fixture slides',
      slides: [
        { title: 'Pants', bullets: ['Actual fixture row: pants'] },
        { title: 'Shirt', bullets: ['Actual fixture row: shirt'] },
      ],
    },
  };
}
function businessMail(serverId: string): ProbeTool {
  return {
    name: 'mcp__' + serverId + '__send_email',
    args: {
      to: 'recipient@example.test',
      subject: 'Local-only business acceptance',
      body: 'Actual Office bytes',
      attachments: [],
    },
  };
}
async function publishBusinessTask(
  f: Fixture,
  kind: ScheduledTaskTarget['kind'],
  serverId: string,
) {
  const draft = await f.create(kind, {
    executionMode: 'workspace',
    outputs: ['spreadsheet', 'presentation'],
    acceptanceChecks: BUSINESS_CHECKS,
    delivery: {
      kind: 'gmail',
      mcpServerId: serverId,
      toolName: 'send_email',
      recipient: 'recipient@example.test',
    },
  });
  return (
    await f.ok<{ task: AutomationTask }>('scheduledTask.update', {
      taskId: draft.id,
      patch: { enabled: true, timeZone: BUSINESS_TIME_ZONE },
    })
  ).task;
}
function toolPayloads(results: readonly string[]): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 8) return;
    if (typeof value === 'string') {
      try {
        visit(JSON.parse(value), depth + 1);
      } catch {}
    } else if (Array.isArray(value)) value.forEach((item) => visit(item, depth + 1));
    else if (value && typeof value === 'object') {
      rows.push(value as Record<string, unknown>);
      for (const key of ['content', 'text', 'result', 'toolResultText', 'connectorResult'])
        visit((value as Record<string, unknown>)[key], depth + 1);
    }
  };
  results.forEach((result) => visit(result, 0));
  return rows;
}
function fixtureGate() {
  let release!: () => void;
  const promise = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  cleanups.push(async () => release());
  return { promise, release };
}

const BUSINESS_REJECTIONS = [
  {
    name: 'insufficient rows',
    check: 'minimumRows',
    code: 'automation_acceptance.minimum_rows_unmet',
  },
  { name: 'old local date', check: 'dateColumn', code: 'automation_acceptance.date_mismatch' },
  {
    name: 'missing source column',
    check: 'sourceUrlColumn',
    code: 'automation_acceptance.source_url_column_missing',
  },
  {
    name: 'empty source URL',
    check: 'sourceUrlColumn',
    code: 'automation_acceptance.source_url_invalid',
  },
  {
    name: 'non-HTTP source URL',
    check: 'sourceUrlColumn',
    code: 'automation_acceptance.source_url_invalid',
  },
  {
    name: 'missing required column',
    check: 'requiredColumns',
    code: 'automation_acceptance.required_columns_missing',
  },
  {
    name: 'insufficient slides',
    check: 'minimumSlides',
    code: 'automation_acceptance.minimum_slides_unmet',
  },
] as const;
function rejectedBusinessTool(
  name: (typeof BUSINESS_REJECTIONS)[number]['name'],
  sourceUrl: string,
  localDate: string,
  oldDate: string,
): ProbeTool {
  if (name === 'insufficient slides') {
    const tool = businessSlides('rejected-slides.pptx');
    tool.args.slides = [{ title: 'Only one slide', bullets: ['Actual rejected input'] }];
    return tool;
  }
  const tool = businessSheet(sourceUrl, localDate, 'rejected.xlsx');
  if (name === 'insufficient rows') tool.args.rows = [['pants', localDate, sourceUrl + '/a']];
  if (name === 'old local date')
    tool.args.rows = [
      ['pants', oldDate, sourceUrl + '/a'],
      ['shirt', oldDate, sourceUrl + '/b'],
    ];
  if (name === 'missing source column') {
    tool.args.columns = ['keyword', 'date'];
    tool.args.rows = [
      ['pants', localDate],
      ['shirt', localDate],
    ];
  }
  if (name === 'empty source URL')
    tool.args.rows = [
      ['pants', localDate, ''],
      ['shirt', localDate, sourceUrl + '/b'],
    ];
  if (name === 'non-HTTP source URL')
    tool.args.rows = [
      ['pants', localDate, 'ftp://127.0.0.1/a'],
      ['shirt', localDate, 'javascript:void(0)'],
    ];
  if (name === 'missing required column') tool.args.columns = ['topic', 'date', 'sourceURL'];
  return tool;
}
const BUSINESS_FAILURE_MATRIX = (['model', 'agent', 'team'] as const).flatMap((kind) =>
  BUSINESS_REJECTIONS.map((rejection) => ({ kind, ...rejection })),
);
it.each(BUSINESS_FAILURE_MATRIX)(
  '$kind real RPC rejects $name before writing receipts/files or sending mail',
  async ({ kind, name, check, code }) => {
    freezeBusinessClock();
    const f = await fixture({ realRpc: true });
    const connector = await httpConnector(f, 'business-local-mail', 'business-local-receipt', true);
    if (kind !== 'model')
      f.agents.update({ agentId: f.member.id, mcpServerIds: [connector.record.id] });
    let firedAt = '',
      localDate = '';
    let invalid: ProbeTool;
    f.provider.workTools = () => {
      invalid = rejectedBusinessTool(
        name,
        connector.record.endpoint,
        localDate,
        previousBusinessDate(firedAt),
      );
      return [invalid, businessMail(connector.record.id)];
    };
    const task = await publishBusinessTask(f, kind, connector.record.id);
    const release = f.provider.hold();
    const trigger = await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: task.id });
    expect(trigger.fired, trigger.reason).toBe(true);
    expect(trigger.task.lastRunAt).toBeTruthy();
    firedAt = trigger.task.lastRunAt!;
    localDate = businessDate(firedAt, task.timeZone);
    vi.setSystemTime(Date.parse(firedAt) + 2 * 86_400_000);
    release();
    const history = await terminalHistory(f, task.id, 1);
    expect(history[0]).toMatchObject({ status: 'failed', firedAt });
    expect(toolPayloads(f.provider.toolResults)).toContainEqual(
      expect.objectContaining({
        ok: false,
        code: 'automation.acceptance_failed',
        checks: expect.arrayContaining([
          expect.objectContaining({ check, status: 'failed', code }),
        ]),
      }),
    );
    expect(officeReceipts(f.provider.toolResults)).toEqual([]);
    expect(
      readdirSync(f.root, { recursive: true }).some((file) =>
        String(file).endsWith(String(invalid!.args.fileName)),
      ),
    ).toBe(false);
    expect(
      connector.calls.filter(
        (call) => call.method === 'tools/call' && call.params?.name === 'send_email',
      ),
    ).toEqual([]);
    expect(connector.errors).toEqual([]);
  },
);

function officeXml(bytes: Buffer): Map<string, string> {
  const entries = new Map<string, string>();
  let offset = 0;
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    const compression = bytes.readUInt16LE(offset + 8),
      size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26),
      extraLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const start = offset + 30 + nameLength + extraLength;
    const content = bytes.subarray(start, start + size);
    expect([0, 8]).toContain(compression);
    entries.set(name, (compression === 8 ? inflateRawSync(content) : content).toString('utf8'));
    offset = start + size;
  }
  expect(entries.has('[Content_Types].xml')).toBe(true);
  return entries;
}
function assertOfficeBytes(f: Fixture, receipts: OfficeReceipt[], localDate: string) {
  expect(receipts.map((receipt) => receipt.format).sort()).toEqual(['presentation', 'spreadsheet']);
  for (const receipt of receipts) {
    const bytes = readFileSync(scopedPath(f.root, receipt.path));
    expect(bytes.length).toBe(receipt.size);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(receipt.sha256);
    const xml = officeXml(bytes);
    if (receipt.format === 'spreadsheet') {
      const sheet = xml.get('xl/worksheets/sheet1.xml')!;
      expect(sheet).toContain('pants');
      expect(sheet).toContain('shirt');
      expect(sheet).toContain(localDate);
      expect(sheet).toContain('http://127.0.0.1:');
      expect(sheet.match(/<row\b/g)).toHaveLength(3); // Header + two actual data rows.
    } else {
      expect(xml.get('ppt/slides/slide1.xml')).toContain('Pants');
      expect(xml.get('ppt/slides/slide2.xml')).toContain('Shirt');
      expect(
        [...xml.keys()].filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)),
      ).toHaveLength(2);
    }
  }
}

it.each(['model', 'agent', 'team'] as const)(
  '%s real RPC corrects rejected input in the frozen round, sends actual XLSX/PPTX bytes once, and rejects old receipts in a new round',
  async (kind) => {
    freezeBusinessClock();
    const f = await fixture({ realRpc: true });
    const connector = await httpConnector(f, 'business-local-mail', 'business-retry-receipt', true);
    if (kind !== 'model')
      f.agents.update({ agentId: f.member.id, mcpServerIds: [connector.record.id] });
    const sheetGate = fixtureGate(),
      slidesGate = fixtureGate();
    let reached = 0,
      firedAt = '',
      localDate = '';
    f.provider.workTools = () => [
      rejectedBusinessTool(
        'insufficient rows',
        connector.record.endpoint,
        localDate,
        previousBusinessDate(firedAt),
      ),
      businessMail(connector.record.id),
      businessSheet(connector.record.endpoint, localDate),
      rejectedBusinessTool(
        'insufficient slides',
        connector.record.endpoint,
        localDate,
        previousBusinessDate(firedAt),
      ),
      businessMail(connector.record.id),
      businessSlides(),
      businessMail(connector.record.id),
      businessMail(connector.record.id),
    ];
    f.provider.beforeWorkTool = async (_request, index) => {
      if (index === 2) {
        reached = 1;
        await sheetGate.promise;
      }
      if (index === 5) {
        reached = 2;
        await slidesGate.promise;
      }
    };
    const task = await publishBusinessTask(f, kind, connector.record.id);
    expect(task.automation?.acceptanceChecks).toEqual(BUSINESS_CHECKS);
    const release = f.provider.hold();
    const trigger = await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: task.id });
    expect(trigger.fired, trigger.reason).toBe(true);
    expect(trigger.task.lastRunAt).toBeTruthy();
    firedAt = trigger.task.lastRunAt!;
    localDate = businessDate(firedAt, task.timeZone);
    release();
    await waitFor(
      () => reached,
      (value) => value === 1,
      'Rejected spreadsheet did not reach correction',
    );
    expect(officeReceipts(f.provider.toolResults)).toEqual([]);
    expect(connector.calls.filter((call) => call.method === 'tools/call')).toEqual([]);
    expect(
      readdirSync(f.root, { recursive: true }).some((file) =>
        String(file).endsWith('rejected.xlsx'),
      ),
    ).toBe(false);
    // Live task edits and clock drift must not change the admitted contract or its local date.
    await f.ok('scheduledTask.update', {
      taskId: task.id,
      patch: {
        timeZone: 'Pacific/Honolulu',
        automation: {
          ...task.automation,
          acceptanceChecks: { ...BUSINESS_CHECKS, minimumRows: 3 },
        },
      },
    });
    vi.setSystemTime(Date.parse(firedAt) + 2 * 86_400_000);
    sheetGate.release();
    await waitFor(
      () => reached,
      (value) => value === 2,
      'Rejected slides did not reach correction',
    );
    expect(officeReceipts(f.provider.toolResults).map((receipt) => receipt.format)).toEqual([
      'spreadsheet',
    ]);
    expect(connector.calls.filter((call) => call.method === 'tools/call')).toEqual([]);
    expect(
      readdirSync(f.root, { recursive: true }).some((file) =>
        String(file).endsWith('rejected-slides.pptx'),
      ),
    ).toBe(false);
    expect(toolPayloads(f.provider.toolResults)).toContainEqual(
      expect.objectContaining({
        code: 'automation.acceptance_failed',
        checks: expect.arrayContaining([
          expect.objectContaining({ check: 'minimumSlides', status: 'failed' }),
        ]),
      }),
    );
    slidesGate.release();
    const history = await terminalHistory(f, task.id, 1);
    expect(history[0]).toMatchObject({ status: 'success', firedAt });
    const receipts = officeReceipts(f.provider.toolResults);
    assertOfficeBytes(f, receipts, localDate);
    const sends = connector.calls.filter(
      (call) => call.method === 'tools/call' && call.params?.name === 'send_email',
    );
    expect(sends).toHaveLength(1);
    const attachments = sends[0].params!.arguments!.attachments as Array<{
      filename: string;
      contentBase64: string;
      mimeType: string;
    }>;
    expect(attachments).toHaveLength(2);
    for (const receipt of receipts) {
      const attachment = attachments.find((item) => item.filename === basename(receipt.path))!;
      expect(Buffer.from(attachment.contentBase64, 'base64')).toEqual(
        readFileSync(scopedPath(f.root, receipt.path)),
      );
      expect(attachment.mimeType).toMatch(/officedocument/);
    }
    expect(toolPayloads(f.provider.toolResults)).toContainEqual(
      expect.objectContaining({ messageId: 'business-retry-receipt' }),
    );
    expect(connector.errors).toEqual([]);
    await waitFor(
      () => f.provider.activeCalls,
      (value) => value === 0,
      'Accepted provider failed to settle',
    );
    f.provider.beforeWorkTool = undefined;
    f.provider.workTools = () => [
      {
        ...businessMail(connector.record.id),
        args: {
          ...businessMail(connector.record.id).args,
          attachments: receipts.map((receipt) => receipt.path),
        },
      },
    ];
    vi.setSystemTime(Date.parse(firedAt) + 3 * 86_400_000);
    const nextTrigger = await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: task.id });
    expect(nextTrigger.fired, nextTrigger.reason).toBe(true);
    const nextHistory = await terminalHistory(f, task.id, 2);
    expect(nextHistory.filter((entry) => entry.firedAt === firedAt)).toHaveLength(1);
    expect(
      nextHistory.filter((entry) => entry.firedAt === nextTrigger.task.lastRunAt),
    ).toHaveLength(1);
    expect(nextHistory.filter((entry) => entry.status === 'success')).toHaveLength(1);
    const next = nextHistory.find((entry) => entry.firedAt !== firedAt)!;
    expect(next).toMatchObject({ status: 'failed', firedAt: nextTrigger.task.lastRunAt });
    expect(next.id).not.toBe(history[0].id);
    expect(next.reason).toMatch(/文件|产物|本轮|artifact|output/i);
    expect(
      connector.calls.filter(
        (call) => call.method === 'tools/call' && call.params?.name === 'send_email',
      ),
    ).toHaveLength(1);
    for (const receipt of receipts) expect(existsSync(scopedPath(f.root, receipt.path))).toBe(true);
  },
);

it('team real RPC races two actors awaiting actual attachments but performs exactly one connector send', async () => {
  freezeBusinessClock();
  const f = await fixture({ realRpc: true });
  const connectorGate = fixtureGate();
  const connector = await httpConnector(
    f,
    'business-concurrent-mail',
    'business-concurrent-receipt',
    true,
    () => connectorGate.promise,
  );
  const second = f.agents.create({
    id: 'automation-second-sender' as AgentId,
    name: 'Second automation sender',
    defaultModelId: 'fake-mini' as ModelId,
  });
  for (const member of [f.member, second])
    f.agents.update({ agentId: member.id, mcpServerIds: [connector.record.id as McpServerId] });
  await f.ok('team.update', {
    teamId: f.team.id,
    members: [
      { agentId: f.leader.id, role: 'coordinator' },
      { agentId: f.member.id, role: 'researcher' },
      { agentId: second.id, role: 'researcher' },
    ],
  });
  f.provider.dispatchMembers = [f.member.id, second.id];
  const mailGate = fixtureGate(),
    attachmentGate = fixtureGate();
  const actors = new Set<string>();
  let localDate = '';
  const actor = (request: ProviderCallRequest) =>
    JSON.stringify(request.messages).includes('Actor=' + second.id) ? second.id : f.member.id;
  f.provider.workTools = (request) =>
    actor(request) === second.id
      ? [businessMail(connector.record.id)]
      : [
          businessSheet(connector.record.endpoint, localDate),
          businessSlides(),
          businessMail(connector.record.id),
        ];
  f.provider.beforeWorkTool = async (request, _index, tool) => {
    if (tool.name === businessMail(connector.record.id).name) {
      actors.add(actor(request));
      await mailGate.promise;
    }
  };
  const task = await publishBusinessTask(f, 'team', connector.record.id);
  const release = f.provider.hold();
  const trigger = await f.ok<TriggerResult>('scheduledTask.trigger', { taskId: task.id });
  expect(trigger.fired, trigger.reason).toBe(true);
  localDate = businessDate(trigger.task.lastRunAt!, task.timeZone);
  const current = (
    await f.ok<{ tasks: AutomationTask[] }>('scheduledTask.list', { includeDisabled: true })
  ).tasks.find((row) => row.id === task.id)!;
  await f.ok('collaboration.command', {
    action: 'policy',
    conversationId: current.conversationId!,
    policy: { maxConcurrent: 3 },
  });
  release();
  await waitFor(
    () => [...actors].sort(),
    (value) => value.length === 2,
    'Two distinct public team actors did not reach the mail boundary',
  );
  expect([...actors].sort()).toEqual([f.member.id, second.id].sort());
  const receipts = officeReceipts(f.provider.toolResults);
  assertOfficeBytes(f, receipts, localDate);
  const paths = new Set(receipts.map((receipt) => receipt.path));
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  let attachmentReads = 0;
  vi.mocked(fsAsync.readFile).mockImplementation((async (
    ...args: Parameters<typeof fsAsync.readFile>
  ) => {
    const bytes = await actual.readFile(...args);
    if (paths.has(String(args[0])) && attachmentReads < 2) {
      attachmentReads++;
      await attachmentGate.promise;
    }
    return bytes;
  }) as typeof fsAsync.readFile);
  cleanups.push(async () => {
    vi.mocked(fsAsync.readFile).mockImplementation(actual.readFile);
  });
  mailGate.release();
  await waitFor(
    () => attachmentReads,
    (count) => count === 2,
    'Both mail actors must await real attachment reads before either can claim delivery',
  );
  const sends = () =>
    connector.calls.filter(
      (call) => call.method === 'tools/call' && call.params?.name === 'send_email',
    );
  expect(sends()).toHaveLength(0);
  const mailCalls = f.provider.emittedTools.filter(
    (tool) => tool.name === businessMail(connector.record.id).name,
  );
  expect(mailCalls).toHaveLength(2);
  expect(new Set(mailCalls.map((tool) => tool.id)).size).toBe(2);
  attachmentGate.release();
  await waitFor(
    sends,
    (calls) => calls.length > 0,
    'Claimed send did not reach the local connector',
  );
  await waitFor(
    () => toolPayloads(f.provider.toolResults),
    (rows) =>
      rows.some((row) => typeof row.error === 'string' && row.error.includes('本次未重复发件')),
    'Losing actor did not observe the public claim conflict',
  );
  expect(sends()).toHaveLength(1);
  expect((await f.history(task.id)).some((entry) => entry.status === 'success')).toBe(false);
  connectorGate.release();
  const history = await terminalHistory(f, task.id, 1);
  expect(history[0].status).toBe('success');
  expect(sends()).toHaveLength(1);
  const attachments = sends()[0].params!.arguments!.attachments as Array<{
    filename: string;
    contentBase64: string;
  }>;
  expect(attachments).toHaveLength(2);
  for (const receipt of receipts)
    expect(
      Buffer.from(
        attachments.find((item) => item.filename === basename(receipt.path))!.contentBase64,
        'base64',
      ),
    ).toEqual(readFileSync(scopedPath(f.root, receipt.path)));
  expect(toolPayloads(f.provider.toolResults)).toContainEqual(
    expect.objectContaining({ messageId: 'business-concurrent-receipt' }),
  );
  expect(connector.errors).toEqual([]);
});


describe('scheduled Model/Agent business outcome through public RPC', () => {
  it.each(['model', 'agent'] as const)('%s browser-only normal stop without an explicit outcome or live read is blocked', async kind => {
    const f = await fixture();
    f.provider.autoReportOutcome = false;
    const task = await f.create(kind, {
      executionMode: 'full-access', browser: {profileId: PROFILE}, requiredMcpServerIds: [], outputs: [],
      acceptance: 'The isolated page must confirm the requested business action.',
    });
    expect(await f.ok('scheduledTask.trigger', {taskId: task.id})).toMatchObject({fired: true});
    const history = await waitFor(() => f.history(task.id), entries => entries.length === 1, 'Business outcome did not settle');
    expect(history[0]).toMatchObject({status: 'blocked', reason: expect.stringContaining('结构化')});
    expect((await f.ok<{tasks: ScheduledTask[]}>('scheduledTask.list', {includeDisabled: true})).tasks.find(item => item.id === task.id)?.lastResult?.status).toBe('blocked');
  });
});


describe('structured scheduled automation outcomes', () => {
  const browserContract: Automation = {executionMode: 'full-access', browser: {profileId: PROFILE}, outputs: [], requiredMcpServerIds: []};
  const readPage: ProbeTool[] = [{name: 'browser_open', args: {url: ORIGIN + '/search'}}, {name: 'browser_read', args: {}}];
  const report = (status: 'success' | 'failed' | 'blocked', reason = 'Structured business result'): ProbeTool => ({name: 'automation_report_outcome', args: {status, reason}});
  it.each(['model', 'agent'] as const)('%s respects explicit failed/blocked outcomes even when final prose says Completed', async kind => {
    const f = await fixture();
    for (const status of ['failed', 'blocked'] as const) {
      f.provider.workTools = () => [report(status, 'Requested action was not submitted: ' + status)];
      const task = await f.create(kind, browserContract);
      expect(await f.ok('scheduledTask.trigger', {taskId: task.id})).toMatchObject({fired: true});
      const history = await waitFor(() => f.history(task.id), entries => entries.length === 1, 'Structured negative outcome');
      expect(history[0]).toMatchObject({status, reason: 'Requested action was not submitted: ' + status});
      expect(history[0]!.summary).toContain('Completed');
      expect(f.provider.toolResults.some(text => { try { return JSON.parse(text).ok === true && JSON.parse(text).outcome?.status === status; } catch { return false; } })).toBe(true);
    }
  });
  it.each(['model', 'agent'] as const)('%s requires BOTH a successful report and a host-observed live read, scoped to each run', async kind => {
    const f = await fixture();
    const task = await f.create(kind, browserContract);
    for (const [tools, status, reason] of [
      [[report('success')], 'blocked', 'browser_read'],
      [readPage, 'blocked', '结构化'],
      [[...readPage, report('success')], 'success', undefined],
      [[report('success')], 'blocked', 'browser_read'],
    ] as const) {
      const before = (await f.history(task.id)).length;
      f.provider.workTools = () => tools;
      expect(await f.ok('scheduledTask.trigger', {taskId: task.id})).toMatchObject({fired: true});
      const entries = await waitFor(() => f.history(task.id), entries => entries.length === before + 1, 'Per-run browser evidence');
      expect(entries[0]!.status).toBe(status);
      if (reason) expect(entries[0]!.reason).toContain(reason);
    }
    expect(f.worker.calls.filter(call => call.action.kind === 'read')).toHaveLength(2);
    expect(f.worker.calls.every(call => call.profileId === PROFILE)).toBe(true);
    expect(f.provider.requests.every(request => request.tools?.some(tool => tool.name === 'automation_report_outcome'))).toBe(true);
  });
  it('rejects malformed reports and actor-supplied forged browser receipts', async () => {
    const f = await fixture();
    for (const args of [{status: 'success', reason: ''}, {status: 'done', reason: 'Done'}, {status: 'success', reason: 'Claimed', browserRead: {url: ORIGIN}}]) {
      f.provider.workTools = () => [{name: 'automation_report_outcome', args}];
      const task = await f.create('model', browserContract);
      expect(await f.ok('scheduledTask.trigger', {taskId: task.id})).toMatchObject({fired: true});
      const history = await waitFor(() => f.history(task.id), entries => entries.length === 1, 'Invalid report must not pass');
      expect(history[0]!.status).toBe('blocked');
    }
    expect(f.provider.toolResults.filter(text => {try {return JSON.parse(text).ok === false;} catch {return false;}})).toHaveLength(3);
  });
  it('does not treat unsuccessful browser_read or browser_open alone as a live read receipt', async () => {
    const f = await fixture();
    const original = f.worker.execute.bind(f.worker);
    vi.spyOn(f.worker, 'execute').mockImplementation(async input => {
      const result = await original(input);
      return input.action.kind === 'read' ? {...result, ok: false as unknown as true, text: 'Not read'} : result;
    });
    f.provider.workTools = () => [...readPage, report('success')];
    const task = await f.create('model', browserContract);
    expect(await f.ok('scheduledTask.trigger', {taskId: task.id})).toMatchObject({fired: true});
    const history = await waitFor(() => f.history(task.id), entries => entries.length === 1, 'Failed browser read');
    expect(history[0]).toMatchObject({status: 'blocked', reason: expect.stringContaining('browser_read')});
  });
  it('preserves verified artifact acceptance, but an explicit failure overrides even completed output', async () => {
    const f = await fixture();
    const exportTool: ProbeTool = {name: 'automation_export_artifact', args: {format: 'spreadsheet', fileName: 'outcome.xlsx', title: 'Real evidence', columns: ['count'], rows: [[7]]}};
    for (const [tools, status] of [[[exportTool], 'success'], [[exportTool, report('failed', 'Business action still failed')], 'failed']] as const) {
      f.provider.workTools = () => tools;
      const task = await f.create('model', {executionMode: 'full-access', outputs: ['spreadsheet']});
      expect(await f.ok('scheduledTask.trigger', {taskId: task.id})).toMatchObject({fired: true});
      const history = await waitFor(() => f.history(task.id), entries => entries.length === 1, 'Artifact compatibility');
      expect(history[0]!.status).toBe(status);
    }
  });
});


class OutcomeKernelFixture implements KernelAdapter {
  readonly id = 'codex'; readonly name = 'Offline outcome kernel'; readonly icon = 'fixture'; readonly knownGoodVersions = ['fixture'];
  readonly capabilities = {protocols: ['openai-chat' as const], permission: 'none' as const, permissionBridge: false, pause: 'session' as const, compress: 'none' as const, usageReport: false};
  requests: KernelRequest[] = []; results: string[] = [];
  tools: ProbeTool[] = [];
  async detectVersion() { return 'fixture'; }
  async stop() {} async pause() {} async resume() {} async cancel() {}
  onExit() {} onPermissionRequest() {} respondPermission() {} onUsage() {}
  async *start(request: KernelRequest): AsyncIterable<KernelEvent> {
    this.requests.push(request);
    const broker = request.platformBroker!;
    expect(broker).toBeDefined();
    const socket = createConnection({host: broker.host, port: broker.port});
    let unread = ''; const frames: Record<string, unknown>[] = []; const waiting: Array<(frame: Record<string, unknown>) => void> = [];
    socket.on('data', data => {
      unread += data.toString(); let newline: number;
      while ((newline = unread.indexOf('\n')) >= 0) {
        const frame = JSON.parse(unread.slice(0, newline)); unread = unread.slice(newline + 1);
        const done = waiting.shift(); if (done) done(frame); else frames.push(frame);
      }
    });
    const next = () => new Promise<Record<string, unknown>>((done, reject) => {
      const ready = frames.shift(); if (ready) {done(ready); return;}
      const timeout = setTimeout(() => reject(new Error('Isolated kernel broker did not respond')), 3000);
      waiting.push(frame => {clearTimeout(timeout); done(frame);});
    });
    try {
      await new Promise<void>((done, reject) => {socket.once('connect', done); socket.once('error', reject);});
      socket.write(JSON.stringify({type: 'hello', token: broker.token}) + '\n');
      expect((await next()).type).toBe('hello-ok');
      for (const [index, tool] of this.tools.entries()) {
        const id = 'external-tool-' + index;
        const name = 'mcp__' + (tool.name.startsWith('browser_') ? 'browser' : 'browser-workflow') + '__' + tool.name;
        yield {type: 'tool-call', toolId: id, name, argsJson: JSON.stringify(tool.args), partial: false};
        socket.write(JSON.stringify({type: 'tool-call', id, tool: tool.name, input: tool.args}) + '\n');
        const response = await next();
        expect(response.ok, JSON.stringify(response)).toBe(true);
        const output = String(response.content); this.results.push(output);
        yield {type: 'tool-result', toolId: id, output, structuredOutput: JSON.parse(output), isError: false};
      }
      yield {type: 'delta', text: 'External kernel completed normally.', final: true};
      yield {type: 'terminal', status: 'completed'};
    } finally {socket.destroy();}
  }
}

function installLargeCalendarPage(f: Fixture): void {
  const original = f.worker.execute.bind(f.worker);
  vi.spyOn(f.worker, 'execute').mockImplementation(async input => ({...await original(input),
    viewport: {width: 1440, height: 900, devicePixelRatio: 2}, text: 'Real rendered page content '.repeat(3000),
    controls: Array.from({length: 80}, (_, index) => ({name: index === 60 ? '' : 'Control ' + index, tag: 'button', role: 'button', selector: index === 60 ? '#topbar > button.calendar:nth-child(3)' : '#control-' + index, x: 1370, y: 35, inViewport: index >= 45})),
  }));
}
function assertCalendarContent(text: string): void {
  const page = JSON.parse(text);
  expect(text.length).toBeLessThanOrEqual(8000);
  expect(page.viewport).toEqual({width: 1440, height: 900, devicePixelRatio: 2});
  expect(page.controls).toEqual(expect.arrayContaining([expect.objectContaining({name: '', selector: '#topbar > button.calendar:nth-child(3)', inViewport: true})]));
  expect(page.controlCount).toBe(80);
}

it('native public scheduled trigger supplies bounded calendar locators to the model and persists only controlCount', async () => {
  const f = await fixture(); installLargeCalendarPage(f);
  f.provider.workTools = () => [{name: 'browser_open', args: {url: ORIGIN + '/search'}}, {name: 'browser_read', args: {}}, {name: 'automation_report_outcome', args: {status: 'success', reason: 'Action verified on live fixture page'}}];
  const task = await f.create('model', {executionMode: 'full-access', browser: {profileId: PROFILE}, outputs: []});
  expect(await f.ok('scheduledTask.trigger', {taskId: task.id})).toMatchObject({fired: true});
  const history = await waitFor(() => f.history(task.id), entries => entries.length === 1, 'Native calendar projection');
  expect(history[0]!.status).toBe('success');
  const readResult = f.provider.requests.flatMap(request => request.messages.filter(message => message.role === 'tool').map(message => String(message.content))).find(text => {try {return JSON.parse(text).projection === 'browser_read.v1';} catch {return false;}})!;
  assertCalendarContent(readResult);
  const process = await f.ok<{process: {steps: Array<{toolName: string; preview?: string}>}}>('conversation.getRunProcess', {runId: history[0]!.runId});
  const audit = process.process.steps.find(step => step.toolName === 'browser_read')!.preview!;
  expect(JSON.parse(audit).controlCount).toBe(80);
  expect(audit).not.toContain('calendar:nth-child');
  expect(audit).not.toContain('Real rendered page content');
});

it('external kernel public scheduled trigger shares bounded browser JSON and structured business outcome routing', async () => {
  const kernel = new OutcomeKernelFixture();
  const f = await fixture({kernelAdapterResolver: () => kernel}); installLargeCalendarPage(f);
  f.agents.update({agentId: f.member.id, defaultKernelId: 'codex'});
  kernel.tools = [{name: 'browser_open', args: {url: ORIGIN + '/search'}}, {name: 'browser_read', args: {}}, {name: 'automation_report_outcome', args: {status: 'failed', reason: 'Business action was not submitted'}}];
  const task = await f.create('agent', {executionMode: 'full-access', browser: {profileId: PROFILE}, outputs: []});
  expect(await f.ok('scheduledTask.trigger', {taskId: task.id})).toMatchObject({fired: true});
  const history = await waitFor(() => f.history(task.id), entries => entries.length === 1, 'External outcome fixture');
  expect(history[0]).toMatchObject({status: 'failed', reason: 'Business action was not submitted'});
  expect(kernel.requests).toHaveLength(1); expect(f.provider.requests).toHaveLength(0);
  assertCalendarContent(kernel.results[1]!);
  const process = await f.ok<{process: {steps: Array<{toolName: string; preview?: string}>}}>('conversation.getRunProcess', {runId: history[0]!.runId});
  const audit = process.process.steps.find(step => step.toolName.endsWith('__browser_read'))!.preview!;
  expect(JSON.parse(audit).controlCount).toBe(80);
  expect(audit).not.toContain('calendar:nth-child');
});

// Public scheduledTask RPC: output truncation must not settle the task.
it('scheduled task continues a length-truncated round and validates the actual spreadsheet', async () => {
  const f = await fixture({realRpc: true});
  f.provider.mode = 'export-file';
  const original = f.provider.call.bind(f.provider);
  const requests: ProviderCallRequest[] = [];
  vi.spyOn(f.provider, 'call').mockImplementation(async function* (request) {
    requests.push(request);
    if (requests.length === 1) {
      yield { type: 'reasoning-delta', text: 'Already identified the required spreadsheet structure.' };
      yield { type: 'usage', tokensIn: 100, tokensOut: 8192, reasoningTokens: 8192 };
      yield { type: 'finished', reason: 'length' };
      return;
    }
    yield* original(request);
  });
  const task = await publishTask(f, 'model', { executionMode: 'full-access', outputs: ['spreadsheet'] });
  expect(await f.ok('scheduledTask.trigger', { taskId: task.id })).toMatchObject({ fired: true });
  const entries = await terminalHistory(f, task.id, 1);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ status: 'success' });
  expect(requests.length).toBeGreaterThan(1);
  expect(requests[1]!.tools?.some(tool => tool.name === 'automation_export_artifact')).toBe(true);
  const receipts = officeReceipts(f.provider.toolResults);
  expect(receipts.some(receipt => receipt.format === 'spreadsheet' && existsSync(receipt.path))).toBe(true);
  expect(f.schedules.get(task.id)?.lastResult?.runId).toBe(entries[0]!.runId);
});

it('scheduled task keeps productive truncated rounds running beyond a fixed retry count', async () => {
  const f = await fixture(); f.provider.mode = 'export-file';
  const original = f.provider.call.bind(f.provider); const requests: ProviderCallRequest[] = [];
  vi.spyOn(f.provider, 'call').mockImplementation(async function* (request) {
    requests.push(request);
    if (requests.length <= 6) {
      yield { type: 'text-delta', text: 'Verified a new portion of the report: ' + requests.length + '.\n' };
      yield { type: 'usage', tokensIn: 100, tokensOut: 16000 };
      yield { type: 'finished', reason: 'length' }; return;
    }
    yield* original(request);
  });
  const task = await publishTask(f, 'model', { executionMode: 'full-access', outputs: ['spreadsheet'] });
  await f.ok('scheduledTask.trigger', { taskId: task.id });
  const entries = await terminalHistory(f, task.id, 1);
  expect(entries).toHaveLength(1); expect(entries[0]).toMatchObject({status: 'success'});
  expect(requests.length).toBeGreaterThan(6);
  expect(JSON.stringify(requests[6]!.messages)).toContain('Verified a new portion of the report: 1.');
  expect(f.provider.emittedTools.filter(tool => tool.name === 'automation_export_artifact')).toHaveLength(1);
});

it('scheduled task stops reasoning-only empty retries with a visible unfinished reason', async () => {
  const f = await fixture(); const requests: ProviderCallRequest[] = [];
  vi.spyOn(f.provider, 'call').mockImplementation(async function* (request) {
    requests.push(request);
    yield { type: 'reasoning-delta', text: 'Repeated analysis without delivery.' };
    yield { type: 'usage', tokensIn: 100, tokensOut: 8192, reasoningTokens: 8192 };
    yield { type: 'finished', reason: 'length' };
  });
  const task = await publishTask(f, 'model', { executionMode: 'full-access', outputs: ['spreadsheet'] });
  await f.ok('scheduledTask.trigger', {taskId: task.id});
  const entries = await terminalHistory(f, task.id, 1);
  expect(entries[0]).toMatchObject({status: 'failed'});
  expect(entries[0]!.reason).toMatch(/长度上限.*没有新增进展/);
  expect(requests).toHaveLength(3);
  expect(requests[1]!.messages.some(message => typeof message.content === 'string' && message.content.includes('Repeated analysis without delivery.'))).toBe(true);
  const history = await f.ok<{messages: Array<{role: string; blocks: Array<{type: string; payload?: Record<string, unknown>}>}>}>('conversation.listMessages', {conversationId: f.schedules.get(task.id)!.conversationId});
  expect(history.messages.filter(message => message.role === 'assistant')).toHaveLength(1);
  expect(history.messages.find(message => message.role === 'assistant')!.blocks.some(block => block.type === 'error' && block.payload?.terminalState === 'failed')).toBe(true);
});

it('scheduled task requests missing delivery instead of settling a premature stop', async () => {
  const f = await fixture(); f.provider.mode = 'export-file';
  const original = f.provider.call.bind(f.provider); let rounds = 0;
  vi.spyOn(f.provider, 'call').mockImplementation(async function* (request) {
    if (++rounds === 1) { yield { type: 'text-delta', text: 'Analysis finished; the spreadsheet is not generated yet.' }; yield {type: 'finished', reason: 'stop'}; return; }
    yield* original(request);
  });
  const task = await publishTask(f, 'model', {executionMode: 'full-access', outputs: ['spreadsheet']});
  await f.ok('scheduledTask.trigger', {taskId: task.id});
  const entries = await terminalHistory(f, task.id, 1);
  expect(entries).toHaveLength(1); expect(entries[0]).toMatchObject({status: 'success'});
  expect(officeReceipts(f.provider.toolResults).some(receipt => receipt.format === 'spreadsheet' && existsSync(receipt.path))).toBe(true);
  expect(f.provider.emittedTools.filter(tool => tool.name === 'automation_export_artifact')).toHaveLength(1);
});

it('scheduled task cancellation aborts automatic continuation without another request', async () => {
  const f = await fixture(); let rounds = 0; let activeRunId = '';
  let secondStarted!: () => void;
  const started = new Promise<void>(resolve => {secondStarted = resolve;});
  vi.spyOn(f.provider, 'call').mockImplementation(async function* (request) {
    if (++rounds === 1) {
      yield {type: 'text-delta', text: 'Partial work retained.'};
      yield {type: 'finished', reason: 'length'}; return;
    }
    activeRunId = request.idempotencyKey;
    secondStarted();
    if (!request.signal.aborted) await new Promise<void>(resolve => request.signal.addEventListener('abort', () => resolve(), {once: true}));
  });
  const task = await publishTask(f, 'model', {executionMode: 'full-access', outputs: ['spreadsheet']});
  await f.ok('scheduledTask.trigger', {taskId: task.id});
  await started;
  await f.ok('run.cancel', {runId: activeRunId});
  const entries = await terminalHistory(f, task.id, 1);
  expect(entries[0]).toMatchObject({status: 'cancelled'});
  expect(rounds).toBe(2);
});

it('scheduled task recovers a gateway output-length rejection and still delivers', async () => {
  const f = await fixture(); f.provider.mode = 'export-file'; const original = f.provider.call.bind(f.provider);
  const requests: ProviderCallRequest[] = [];
  vi.spyOn(f.provider, 'call').mockImplementation(async function* (request) {
    requests.push(request);
    if (requests.length === 1) {yield {type: 'reasoning-delta', text: 'Partial analysis'}; yield {type: 'finished', reason: 'length'}; return;}
    if (requests.length === 2) {yield {type: 'error', failureClass: 'unknown', message: 'max_tokens must not exceed 8192'}; return;}
    yield* original(request);
  });
  const task = await publishTask(f, 'model', {executionMode: 'full-access', outputs: ['spreadsheet']});
  await f.ok('scheduledTask.trigger', {taskId: task.id});
  const entries = await terminalHistory(f, task.id, 1);
  expect(entries[0]).toMatchObject({status: 'success'});
  expect(requests[1]!.maxOutputTokens).toBeGreaterThan(requests[0]!.maxOutputTokens!);
  expect(requests[2]!.maxOutputTokens).toBe(requests[0]!.maxOutputTokens);
});


it.each(['model', 'agent'] as const)('%s real RPC exports a spreadsheet with an empty unused slides array exactly once', async (kind) => {
  const f = await fixture({realRpc: true});
  f.provider.workTools = () => [{name: 'automation_export_artifact', args: {
    format: 'spreadsheet', fileName: 'empty-slides.xlsx', title: '兼容空占位',
    columns: ['事项', '数量'], rows: [['真实导出', 7]], slides: [],
  }}];
  const task = await publishTask(f, kind, {executionMode: 'full-access', outputs: ['spreadsheet']});
  expect(await f.ok('scheduledTask.trigger', {taskId: task.id})).toMatchObject({fired: true});
  const entries = await terminalHistory(f, task.id, 1);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({status: 'success'});
  const receipt = officeReceipts(f.provider.toolResults).find(item => item.format === 'spreadsheet');
  expect(receipt).toBeDefined();
  const bytes = readFileSync(receipt!.path);
  expect(bytes.subarray(0, 2).toString()).toBe('PK');
  expect(bytes.length).toBe(receipt!.size);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(receipt!.sha256);
  expect(f.provider.emittedTools.filter(tool => tool.name === 'automation_export_artifact')).toHaveLength(1);
});
