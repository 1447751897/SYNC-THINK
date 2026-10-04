import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeProvider, type AdapterEvent, type ProviderCallRequest } from '@sync-think/adapters';
import {
  decodeFrames,
  type Frame,
  type BrowserHandoffSummary,
  type ContinueBrowserHandoffResponse,
} from '@sync-think/protocol';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteAppSettingStore,
  SqliteBrowserStore,
  SqliteConversationStore,
  SqliteEventCheckpointStore,
  SqliteGlobalAgentStore,
  SqliteMcpStore,
  SqliteMessageStore,
  SqliteScheduledTaskStore,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
import type {
  AgentId,
  McpServerId,
  ModelId,
  ScheduledTask,
  ScheduledTaskHistoryEntry,
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
import { Runtime } from './runtime.js';

// Independent file: importing the other integration file would register its 57+ tests.
// Only local fixture instances are stopped/reopened; no installed Runtime/daemon/email is used.
const PREFIX = 'sync-think-scheduled-login-';
const PROFILE = 'scheduled-login-non-default';
const ORIGIN = 'https://scheduled-login.fixture.test';
const MAIL = 'scheduled-login-local-mail';
const RECIPIENT = 'fixture-recipient@example.test';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  const results = await Promise.allSettled(
    cleanups
      .splice(0)
      .reverse()
      .map((cleanup) => cleanup()),
  );
  vi.useRealTimers();
  vi.restoreAllMocks();
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (failures.length) throw new AggregateError(failures, 'Scheduled-login fixture cleanup failed');
});
async function waitFor<T>(
  read: () => T | Promise<T>,
  ready: (value: T) => boolean,
  label: string,
): Promise<T> {
  const deadline = performance.now() + 6000;
  let value = await read();
  while (!ready(value)) {
    if (performance.now() >= deadline) throw new Error(label + ': ' + JSON.stringify(value));
    await delay(10);
    value = await read();
  }
  return value;
}
function removeTemp(root: string): void {
  const target = realpathSync.native(root);
  const parent = realpathSync.native(tmpdir());
  if (realpathSync.native(dirname(target)) !== parent || !basename(target).startsWith(PREFIX))
    throw new Error('Refusing unscoped fixture cleanup: ' + target);
  const rel = relative(parent, target);
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith('..\\'))
    throw new Error('Fixture cleanup escaped temp parent');
  rmSync(target, { recursive: true, force: true });
}
function inside(root: string, path: string): string {
  const target = realpathSync.native(resolve(path));
  const rel = relative(realpathSync.native(root), target);
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith('..\\') || rel.startsWith('../'))
    throw new Error('Fixture artifact escaped temp root');
  return target;
}
type Tool = { name: string; args: Record<string, unknown> };
class LoginProvider extends FakeProvider {
  requests: ProviderCallRequest[] = [];
  toolResults: string[] = [];
  emitted: Tool[] = [];
  activeCalls = 0;
  evidence = false;
  reason: 'login' | 'captcha' = 'login';
  private gate?: Promise<void>;
  private releaseGate?: () => void;
  hold(): () => void {
    this.release();
    this.gate = new Promise<void>((done) => {
      this.releaseGate = done;
    });
    return () => this.release();
  }
  release(): void {
    this.releaseGate?.();
    this.gate = undefined;
    this.releaseGate = undefined;
  }
  private reopened = false;
  private resumed = false;
  private step = 0;
  resume(reopen = false): void {
    this.reopened = reopen;
    this.resumed = true;
    this.step = 0;
  }
  override async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.requests.push(request);
    this.activeCalls++;
    try {
      if (this.gate) {
        let onAbort!: () => void;
        const aborted = new Promise<void>((done) => {
          onAbort = done;
        });
        request.signal.addEventListener('abort', onAbort, { once: true });
        try {
          if (!request.signal.aborted) await Promise.race([this.gate, aborted]);
        } finally {
          request.signal.removeEventListener('abort', onAbort);
        }
      }
      if (request.signal.aborted) return;
      this.toolResults.push(
        ...request.messages
          .filter((message) => message.role === 'tool')
          .map((message) => String(message.content)),
      );
      const mail: Tool = {
        name: 'mcp__' + MAIL + '__send_email',
        args: {
          to: RECIPIENT,
          subject: 'Local fixture',
          body: 'Current round report',
          attachments: [],
        },
      };
      const initial: Tool[] = [
        { name: 'browser_open', args: { url: ORIGIN + '/account' } },
        ...(this.evidence
          ? [
              {
                name: 'automation_export_artifact',
                args: {
                  format: 'spreadsheet',
                  fileName: 'login-report.xlsx',
                  title: 'Current login report',
                  columns: ['keyword', 'count'],
                  rows: [['pants', 7]],
                },
              },
              mail,
            ]
          : []),
        {
          name: 'automation_request_login',
          args: {
            reason: this.reason,
            requestedOutcome:
              'Sign in to the selected fixture Profile and verify the account page.',
          },
        },
      ];
      const continuation: Tool[] = [
        ...(this.reopened ? [{ name: 'browser_open', args: { url: ORIGIN + '/account' } }] : []),
        { name: 'browser_read', args: {} },
        ...(this.evidence ? [mail] : []),
        {name: 'automation_report_outcome', args: {status: 'success', reason: 'Selected fixture account and current-round business result verified after live read'}},
      ];
      const tool = (this.resumed ? continuation : initial)[this.step++];
      if (tool) {
        this.emitted.push(tool);
        yield {
          type: 'tool-call',
          toolCall: {
            id: 'login-tool-' + this.requests.length,
            name: tool.name,
            argumentsJson: JSON.stringify(tool.args),
          },
        };
        // An untrusted actor may ask for another mutation in the SAME batch after yielding.
        // Runtime must fence it, not merely rely on provider prose saying it stopped.
        if (tool.name === 'automation_request_login') {
          const mutation = {
            name: 'browser_open',
            args: { url: ORIGIN + '/mutation-after-yield' },
          };
          this.emitted.push(mutation);
          yield {
            type: 'tool-call',
            toolCall: {
              id: 'login-mutation-' + this.requests.length,
              name: mutation.name,
              argumentsJson: JSON.stringify(mutation.args),
            },
          };
        }
        yield { type: 'finished', reason: 'tool-requests' };
      } else {
        yield {
          type: 'assistant-message-delta',
          phase: 'final_answer',
          text: 'Verified the selected account and current-round report.',
        };
        yield { type: 'finished', reason: 'stop' };
      }
    } finally {
      this.activeCalls--;
    }
  }
}
class LoginBrowserWorker implements BrowserWorker {
  readonly kind = 'browser' as const;
  calls: Array<BrowserHostExecuteInput & { profileId: string; ownerId: string }> = [];
  acquired: BrowserLeaseInfo[] = [];
  private leases = new Map<string, BrowserLeaseInfo>();
  async acquireLease(input: { profileId: string; ownerId: string }): Promise<BrowserLeaseInfo> {
    const lease = {
      ...input,
      leaseId: 'login-lease-' + (this.acquired.length + 1),
      pageId: 'login-page-' + (this.acquired.length + 1),
    };
    this.acquired.push(lease);
    this.leases.set(lease.leaseId, lease);
    return lease;
  }
  async inspectLease(id: string): Promise<BrowserLeaseInfo> {
    const lease = this.leases.get(id);
    if (!lease) throw new Error('Missing local fixture lease: ' + id);
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
    this.calls.push({ ...input, profileId: lease.profileId, ownerId: lease.ownerId });
    return {
      ok: true as const,
      ...lease,
      message: 'Local fixture page',
      url: ORIGIN + '/account',
      title: 'Fixture account',
      text: 'Fixture account verified; pants=7.',
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
  async shutdown(options?: { preserveSessions?: boolean }): Promise<void> {
    if (!options?.preserveSessions) this.leases.clear();
  }
}
type ProviderErrorLog = {
  runId?: string;
  failureClass?: string;
  message?: string;
};
async function fixture() {
  // Observe the real boundary without hiding stderr or replacing provider failures.
  // Keep errors across fixture Runtime restarts: scheduled history can overwrite the reason.
  const providerErrors: ProviderErrorLog[] = [];
  const consoleError = console.error.bind(console);
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleError(...args);
    if (
      typeof args[0] === 'string' &&
      args[0].startsWith('[demo-run] provider error') &&
      args[1] &&
      typeof args[1] === 'object'
    ) {
      providerErrors.push({ ...(args[1] as ProviderErrorLog) });
    }
  });
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), PREFIX)));
  const path = join(root, 'login.sqlite');
  let databasePath = path;
  const worker = new LoginBrowserWorker();
  const providers: LoginProvider[] = [];
  const servers: Server[] = [];
  type Connection = Awaited<ReturnType<typeof openDatabaseAsync>>;
  const resources: { connection?: Connection; runtime?: Runtime } = {};
  cleanups.push(async () => {
    try {
      providers.forEach((provider) => provider.release());
      await resources.runtime?.stop();
      await waitFor(
        () => providers.reduce((count, provider) => count + provider.activeCalls, 0),
        (count) => count === 0,
        'Login providers failed to drain',
      );
      for (const server of servers) {
        server.closeAllConnections();
        await new Promise<void>((done, reject) =>
          server.close((error) => (error ? reject(error) : done())),
        );
      }
    } finally {
      resources.connection?.raw.close();
      removeTemp(root);
    }
  });
  await runMigrations(path);
  async function boot() {
    const connection = await openDatabaseAsync({ path: databasePath });
    resources.connection = connection;
    const workspaces = new SqliteWorkspaceStore(connection.raw);
    const conversations = new SqliteConversationStore(connection.raw);
    const agents = new SqliteGlobalAgentStore(connection.raw);
    const browser = new SqliteBrowserStore(connection.raw);
    const settings = new SqliteAppSettingStore(connection.raw);
    const schedules = new SqliteScheduledTaskStore(connection.raw);
    const mcp = new SqliteMcpStore(connection.raw);
    const provider = new LoginProvider();
    providers.push(provider);
    const runtime = new Runtime({
      installId: basename(root),
      allowNoToken: true,
      projectlessDataDirectory: join(root, 'projectless'),
      workspaceStore: workspaces,
      conversationStore: conversations,
      messageStore: new SqliteMessageStore(connection.raw),
      globalAgentStore: agents,
      stateStore: new SqliteEventCheckpointStore(connection.raw),
      scheduledTaskStore: schedules,
      browserStore: browser,
      browserHost: worker,
      browserFallbackWorkingDir: root,
      mcpStore: mcp,
      appSettingStore: settings,
      demoProvider: provider,
    });
    resources.runtime = runtime;
    return {
      connection,
      runtime,
      workspaces,
      conversations,
      agents,
      browser,
      settings,
      schedules,
      mcp,
      provider,
    };
  }
  let state = await boot();
  const workspace = state.workspaces.createWorkspace({
    id: 'login-workspace' as WorkspaceId,
    name: 'Login QA',
    folderPath: root,
  });
  const agent = state.agents.create({
    id: 'login-agent' as AgentId,
    name: 'Login agent',
    defaultModelId: 'fake-mini' as ModelId,
  });
  state.browser.createProfile({ id: PROFILE, name: 'Selected non-default account' });
  state.browser.upsertOriginGrant({
    scopeType: 'workspace',
    scopeId: workspace.id,
    origin: ORIGIN,
    action: 'navigate',
    decision: 'allow',
    approvalId: 'fixture-user',
  });
  state.settings.set('task-scheduler', { enabled: true, maxConcurrent: 2 });
  let sequence = 0;
  const rpc = (type: string, payload: unknown): Promise<Frame> =>
    new Promise((done, reject) => {
      const id = 'login-rpc-' + ++sequence;
      const timeout = setTimeout(() => reject(new Error('RPC timed out: ' + type)), 4000);
      try {
        (
          state.runtime as unknown as {
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
  const ok = async <T>(type: string, payload: unknown): Promise<T> => {
    const frame = await rpc(type, payload);
    expect(frame.error, type + ': ' + JSON.stringify(frame.error)).toBeUndefined();
    return frame.payload as T;
  };
  const history = async (taskId: string) =>
    (
      await ok<{ entries: ScheduledTaskHistoryEntry[] }>('scheduledTask.history', {
        taskId,
        limit: 100,
      })
    ).entries;
  const waiting = async () =>
    (
      await ok<{ handoffs: BrowserHandoffSummary[] }>('browser.handoff.listWaiting', {
        workspaceId: workspace.id,
      })
    ).handoffs;
  async function localMail() {
    const calls: Array<{
      method: string;
      params?: { name?: string; arguments?: Record<string, unknown> };
    }> = [];
    const errors: string[] = [];
    const schema = {
      type: 'object',
      properties: {
        to: { type: 'string' },
        attachments: { type: 'array', items: { type: 'string' } },
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['to'],
    };
    const server = createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (part: string) => {
        body += part;
      });
      request.on('error', (error) => errors.push(error.message));
      request.on('end', () => {
        try {
          const frame = JSON.parse(body) as {
            id?: number | string;
            method: string;
            params?: { name?: string; arguments?: Record<string, unknown> };
          };
          calls.push(frame);
          if (frame.method === 'notifications/initialized') {
            response.writeHead(202);
            response.end();
            return;
          }
          let result: unknown;
          if (frame.method === 'initialize')
            result = {
              protocolVersion: '2025-06-18',
              capabilities: { tools: {} },
              serverInfo: { name: 'login-local-mail', version: '1' },
            };
          else if (frame.method === 'tools/list')
            result = {
              tools: [
                { name: 'send_email', description: 'Local receipt boundary', inputSchema: schema },
              ],
            };
          else if (frame.method === 'tools/call' && frame.params?.name === 'send_email')
            result = {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ messageId: 'fixture-login-confirmed-receipt' }),
                },
              ],
            };
          else throw new Error('Unexpected MCP method: ' + frame.method);
          response.writeHead(200, {
            'content-type': 'application/json',
            'mcp-session-id': 'login-fixture-session',
          });
          response.end(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result }));
        } catch (error) {
          errors.push(String(error));
          response.writeHead(500);
          response.end(JSON.stringify({ error: String(error) }));
        }
      });
    });
    servers.push(server);
    await new Promise<void>((done, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        done();
      });
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture port');
    const record = state.mcp.register({
      id: MAIL as McpServerId,
      name: 'Login local mail',
      transport: 'remote-http',
      endpoint: 'http://127.0.0.1:' + address.port + '/mcp',
      trusted: true,
      timeoutMs: 1000,
      tools: [
        {
          name: 'send_email',
          description: 'Local receipt boundary',
          inputSchemaJson: JSON.stringify(schema),
        },
      ],
    });
    state.agents.update({ agentId: agent.id, mcpServerIds: [record.id] });
    return {
      calls,
      errors,
      sends: () =>
        calls.filter((call) => call.method === 'tools/call' && call.params?.name === 'send_email'),
    };
  }
  async function create(kind: 'model' | 'agent', evidence = false): Promise<ScheduledTask> {
    state.provider.evidence = evidence;
    const draft = (
      await ok<{ task: ScheduledTask }>('scheduledTask.create', {
        name: kind + ' scheduled login',
        instruction: 'Read the selected account and deliver the current report.',
        target: kind === 'model' ? { kind, modelId: 'fake-mini' } : { kind, agentId: agent.id },
        workspaceId: workspace.id,
        rule: { kind: 'every', intervalMinutes: 5 },
        timeZone: 'UTC',
        enabled: false,
        automation: {
          executionMode: 'full-access',
          browser: { profileId: PROFILE },
          ...(evidence
            ? {
                outputs: ['spreadsheet'],
                delivery: { kind: 'gmail', mcpServerId: MAIL, recipient: RECIPIENT },
              }
            : {}),
        },
      })
    ).task;
    return (
      await ok<{ task: ScheduledTask }>('scheduledTask.update', {
        taskId: draft.id,
        patch: { enabled: true },
      })
    ).task;
  }
  async function crashRestart(options?: {
    taskId: string;
    patch?: Parameters<SqliteScheduledTaskStore['update']>[1];
    expire?: boolean;
  }): Promise<void> {
    // Snapshot committed SQLite while the provider is still in flight. The graceful stop
    // changes only the old DB; the new Runtime opens the pre-stop snapshot like a crash.
    const snapshot = join(root, 'crash-recovery.sqlite');
    await state.connection.raw.backup(snapshot);
    await state.runtime.stop();
    await waitFor(
      () => state.provider.activeCalls,
      (count) => count === 0,
      'Old provider drain',
    );
    state.connection.raw.close();
    resources.connection = undefined;
    databasePath = snapshot;
    state = await boot();
    if (options?.patch) state.schedules.update(options.taskId, options.patch);
    if (options?.expire)
      state.connection.raw
        .prepare('UPDATE event SET occurred_at = ?')
        .run(new Date(Date.now() - 10 * 60_000).toISOString());
    state.provider.resume(true);
    state.provider.hold();
    await state.runtime.start();
  }
  async function restart(): Promise<void> {
    const evidence = state.provider.evidence;
    await state.runtime.stop();
    await waitFor(
      () => state.provider.activeCalls,
      (count) => count === 0,
      'Old fixture provider did not stop',
    );
    state.connection.raw.close();
    resources.connection = undefined;
    state = await boot();
    state.provider.evidence = evidence;
  }
  return {
    root,
    workspace,
    agent,
    worker,
    rpc,
    ok,
    history,
    waiting,
    localMail,
    create,
    restart,
    crashRestart,
    providerErrors,
    get runtime() {
      return state.runtime;
    },
    get provider() {
      return state.provider;
    },
    get browser() {
      return state.browser;
    },
    get schedules() {
      return state.schedules;
    },
    get workspaces() {
      return state.workspaces;
    },
    get settings() {
      return state.settings;
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Binding = {
  taskId: string;
  firedAt: string;
  threadId: string;
  conversationId: string;
  fingerprint: string;
};
async function yielded(f: Fixture, task: ScheduledTask) {
  const trigger = await f.ok<{ fired: boolean; reason?: string }>('scheduledTask.trigger', {
    taskId: task.id,
  });
  expect(trigger.fired, trigger.reason).toBe(true);
  const pending = await waitFor(
    async () => ({ handoffs: await f.waiting(), entries: await f.history(task.id) }),
    (value) => value.entries.some((entry) => entry.status !== 'skipped'),
    'Login did not yield or finish',
  );
  expect(
    f.provider.requests.some((request) =>
      request.tools?.some((tool) => tool.name === 'automation_request_login'),
    ),
    'Scheduled model/agent must advertise the actual native login tool',
  ).toBe(true);
  expect(pending.handoffs, JSON.stringify(pending.entries)).toHaveLength(1);
  const handoff = pending.handoffs[0];
  expect(handoff).toMatchObject({
    profileId: PROFILE,
    status: 'waiting_user',
    reason: f.provider.reason,
    revision: 1,
  });
  const failed = pending.entries.find((entry) => entry.status === 'waiting_input');
  expect(failed, JSON.stringify(pending.entries)).toBeDefined();
  expect(failed!.reason).toMatch(/login|登录|waiting.?input/i);
  expect(pending.entries.some((entry) => entry.status === 'success')).toBe(false);
  const command = f.browser.getCommand(handoff.handoffId)!;
  const binding = command.sanitizedArgs.scheduledBinding as Binding;
  expect(binding).toMatchObject({
    taskId: task.id,
    firedAt: failed!.firedAt,
    threadId: command.ownerId,
    conversationId: f.schedules.get(task.id)!.conversationId,
  });
  expect(binding.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(command.profileId).toBe(PROFILE);
  expect(f.worker.acquired.every((lease) => lease.profileId === PROFILE)).toBe(true);
  expect(
    JSON.stringify(f.worker.calls),
    'Mutation after login yield must not reach the worker',
  ).not.toContain('mutation-after-yield');
  expect(f.worker.calls).toHaveLength(1);
  await waitFor(
    () => f.provider.activeCalls,
    (count) => count === 0,
    'Yielded provider remained active',
  );
  return { handoff, binding, failed: failed! };
}
async function resumed(f: Fixture, pending: Awaited<ReturnType<typeof yielded>>) {
  f.provider.resume();
  const result = await f.ok<ContinueBrowserHandoffResponse>('browser.handoff.continue', {
    handoffId: pending.handoff.handoffId,
    expectedRevision: pending.handoff.revision,
  });
  expect(result).toMatchObject({
    status: 'continued',
    handoffId: pending.handoff.handoffId,
    replayed: false,
  });
  const entries = await waitFor(
    () => f.history(pending.binding.taskId),
    (rows) => rows.some((entry) => entry.status === 'success'),
    'Login continuation did not succeed',
  );
  const successful = entries.filter((entry) => entry.status === 'success');
  expect(successful).toHaveLength(1);
  expect(successful[0].firedAt).toBe(pending.binding.firedAt);
  expect(
    entries
      .filter((entry) => entry.status === 'failed')
      .every((entry) => entry.firedAt === pending.binding.firedAt),
  ).toBe(true);
  expect(f.schedules.get(pending.binding.taskId)!.conversationId).toBe(
    pending.binding.conversationId,
  );
  expect(
    f.worker.calls.every(
      (call) => call.ownerId === pending.binding.threadId && call.profileId === PROFILE,
    ),
  ).toBe(true);
  expect(await f.waiting()).toHaveLength(0);
  const before = {
    requests: f.provider.requests.length,
    calls: f.worker.calls.length,
    entries: entries.length,
  };
  const repeated = await f.ok<ContinueBrowserHandoffResponse>('browser.handoff.continue', {
    handoffId: pending.handoff.handoffId,
    expectedRevision: 1,
  });
  expect(repeated).toMatchObject({
    status: 'continued',
    handoffId: pending.handoff.handoffId,
    replayed: true,
  });
  expect(f.provider.requests).toHaveLength(before.requests);
  expect(f.worker.calls).toHaveLength(before.calls);
  expect(await f.history(pending.binding.taskId)).toHaveLength(before.entries);
  return successful[0];
}

describe.each(['model', 'agent'] as const)('%s scheduled login durable continuation', (kind) => {
  it('recovers an ordinary in-flight occurrence with its original Profile, concurrency slot and final history', async () => {
    const f = await fixture();
    f.settings.set('task-scheduler', { enabled: true, maxConcurrent: 1 });
    const task = await f.create(kind);
    f.provider.hold();
    const first = await f.ok<{ fired: boolean }>('scheduledTask.trigger', { taskId: task.id });
    expect(first.fired).toBe(true);
    await waitFor(
      () => f.provider.activeCalls,
      (count) => count === 1,
      'Original run not active',
    );
    const firedAt = f.schedules.get(task.id)!.lastRunAt;
    await f.crashRestart();
    await waitFor(
      () => f.provider.activeCalls,
      (count) => count === 1,
      'Recovered run not active',
    );
    const secondTask = await f.create(kind);
    const denied = await f.ok<{ fired: boolean; reason?: string }>('scheduledTask.trigger', {
      taskId: secondTask.id,
    });
    expect(denied).toMatchObject({ fired: false });
    expect(denied.reason).toMatch(/并发|concurr/i);
    f.provider.release();
    const rows = await waitFor(
      () => f.history(task.id),
      (entries) => entries.some((e) => e.status === 'success'),
      'Recovered occurrence did not write its outcome',
    );
    expect(rows.filter((e) => e.status === 'success')).toEqual([
      expect.objectContaining({ firedAt }),
    ]);
    expect(f.worker.acquired.length).toBeGreaterThan(0);
    expect(f.worker.acquired.every((lease) => lease.profileId === PROFILE)).toBe(true);
    expect(f.providerErrors).toEqual([]);
  });

  it.each(['disabled', 'skills', 'expired'] as const)(
    'reports a visible recovery block rather than running stale state (%s)',
    async (change) => {
      const f = await fixture();
      const task = await f.create(kind);
      f.provider.hold();
      await f.ok('scheduledTask.trigger', { taskId: task.id });
      await waitFor(
        () => f.provider.activeCalls,
        (count) => count === 1,
        'Original scheduled run not active',
      );
      const firedAt = f.schedules.get(task.id)!.lastRunAt;
      await f.crashRestart({
        taskId: task.id,
        ...(change === 'expired'
          ? { expire: true }
          : {
              patch:
                change === 'disabled'
                  ? { enabled: false }
                  : { skillVersionIds: ['new-skill-after-crash'] },
            }),
      });
      const entries = await waitFor(
        () => f.history(task.id),
        (rows) => rows.some((row) => row.status === 'blocked'),
        'Recovery did not record the blocking reason',
      );
      expect(entries.filter((row) => row.status === 'blocked')).toEqual([
        expect.objectContaining({ firedAt, reason: expect.any(String) }),
      ]);
      expect(f.schedules.get(task.id)!.lastResult?.status).toBe('blocked');
      expect(f.provider.requests).toHaveLength(0);
      expect(f.providerErrors).toEqual([]);
    },
  );

  it('yields after a real completed Browser lease, fences later mutation, and double-click continues the same firedAt/thread/Profile exactly once', async () => {
    const f = await fixture();
    f.provider.reason = kind === 'model' ? 'login' : 'captcha';
    const task = await f.create(kind);
    const pending = await yielded(f, task);
    // Keep the public projection assertion visible while probing continuation independently.
    expect(pending.handoff.scheduledTaskId).toBe(task.id);
    await resumed(f, pending);
  });

  it('merges future scheduled admissions while waiting and still resumes the original receipt after skipped history and a timezone edit', async () => {
    // Keep the pending receipt older than the later timezone-edit clock. Real wall time
    // after October 3 made this test travel backwards and invalidate its expectation.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
    try {
      const f = await fixture();
      const task = await f.create(kind);
      const pending = await yielded(f, task);
      const before = f.provider.requests.length;
      vi.setSystemTime(new Date(Date.parse(pending.binding.firedAt) + 60 * 60_000));
      const skipped = await f.ok<{ fired: boolean; reason?: string }>('scheduledTask.trigger', {
        taskId: task.id,
      });
      expect(skipped.fired).toBe(false);
      expect(skipped.reason).toMatch(/waiting|登录|交接/i);
      vi.setSystemTime(new Date(Date.parse(pending.binding.firedAt) + 120 * 60_000));
      const later = await f.ok<{ fired: boolean; reason?: string }>('scheduledTask.trigger', {
        taskId: task.id,
      });
      expect(later.fired).toBe(false);
      expect(later.reason).toMatch(/waiting|登录|交接/i);
      expect(f.provider.requests).toHaveLength(before);
      expect((await f.waiting()).map((handoff) => handoff.handoffId)).toEqual([
        pending.handoff.handoffId,
      ]);
      expect(
        (await f.history(task.id)).some(
          (entry) => entry.status === 'skipped' && entry.firedAt !== pending.binding.firedAt,
        ),
      ).toBe(true);
      expect(f.schedules.get(task.id)?.lastResult?.status).toBe('waiting_input');
      vi.setSystemTime(new Date('2026-10-02T18:00:00Z'));
      await f.ok('scheduledTask.update', {
        taskId: task.id,
        patch: { timeZone: 'Asia/Shanghai', rule: { kind: 'cron', expression: '0 9 * * *' } },
      });
      await resumed(f, pending);
      expect(f.schedules.get(task.id)?.nextRunAt).toBe('2026-10-03T01:00:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    'disabled',
    'workspace',
    'profile',
    'target',
    'instruction',
    'executionMode',
    'skills',
  ] as const)(
    'blocks continuation before consuming the handoff when current %s changed',
    async (change) => {
      const f = await fixture();
      const task = await f.create(kind);
      const pending = await yielded(f, task);
      const before = { requests: f.provider.requests.length, calls: f.worker.calls.length };
      const patch: Record<string, unknown> = {};
      if (change === 'disabled') patch.enabled = false;
      else if (change === 'skills') patch.skillVersionIds = ['changed-skill-version'];
      else if (change === 'workspace') {
        const folder = join(f.root, 'changed-workspace');
        mkdirSync(folder);
        patch.workspaceId = f.workspaces.createWorkspace({
          id: 'login-changed-workspace' as WorkspaceId,
          name: 'Changed scope',
          folderPath: realpathSync.native(folder),
        }).id;
      } else if (change === 'profile') {
        f.browser.createProfile({ id: 'login-changed-profile', name: 'Different account' });
        patch.automation = {
          ...task.automation,
          browser: { ...task.automation!.browser, profileId: 'login-changed-profile' },
        };
      } else if (change === 'target') {
        patch.target =
          kind === 'model'
            ? { kind: 'agent', agentId: f.agent.id }
            : { kind: 'model', modelId: 'fake-mini' };
      } else if (change === 'instruction')
        patch.instruction = 'A different goal; do not silently resume the previous automation.';
      else patch.automation = { ...task.automation, executionMode: 'ask' };
      await f.ok('scheduledTask.update', { taskId: task.id, patch });
      f.provider.resume();
      const frame = await f.rpc('browser.handoff.continue', {
        handoffId: pending.handoff.handoffId,
        expectedRevision: 1,
      });
      expect(
        frame.error,
        'Changed configuration must require user confirmation before any continuation side effect',
      ).toBeDefined();
      expect(frame.error!.message).toMatch(
        change === 'disabled'
          ? /stale-scheduled-task|disabled|停用|禁用|未启用/i
          : /stale-scheduled-task|配置|范围/i,
      );
      expect(f.browser.getCommand(pending.handoff.handoffId)!.state).toBe('waiting_user');
      expect(f.provider.requests).toHaveLength(before.requests);
      expect(f.worker.calls).toHaveLength(before.calls);
      expect((await f.history(task.id)).some((entry) => entry.status === 'success')).toBe(false);
    },
  );

  it('cancel-preserve keeps the real Profile page but never auto-continues, and replayed cancel remains inert', async () => {
    const f = await fixture();
    const pending = await yielded(f, await f.create(kind));
    const command = f.browser.getCommand(pending.handoff.handoffId)!;
    const before = { requests: f.provider.requests.length, calls: f.worker.calls.length };
    const cancelled = await f.ok<{ status: string; replayed: boolean }>('browser.handoff.cancel', {
      handoffId: pending.handoff.handoffId,
      expectedRevision: 1,
      leaseDisposition: 'preserve',
    });
    expect(cancelled).toMatchObject({ status: 'cancelled', replayed: false });
    expect(await f.worker.inspectLease(command.leaseId!)).toMatchObject({
      profileId: PROFILE,
      ownerId: pending.binding.threadId,
      pageId: command.pageId,
    });
    expect(await f.waiting()).toHaveLength(0);
    const again = await f.ok<{ replayed: boolean }>('browser.handoff.cancel', {
      handoffId: pending.handoff.handoffId,
      expectedRevision: 1,
      leaseDisposition: 'preserve',
    });
    expect(again.replayed).toBe(true);
    const continued = await f.rpc('browser.handoff.continue', {
      handoffId: pending.handoff.handoffId,
      expectedRevision: 1,
    });
    expect(continued.error).toBeDefined();
    expect(continued.error!.message + ' ' + continued.error!.code).toMatch(/cancelled|取消/i);
    expect(f.provider.requests).toHaveLength(before.requests);
    expect(f.worker.calls).toHaveLength(before.calls);
    expect(
      (await f.history(pending.binding.taskId)).some((entry) => entry.status === 'success'),
    ).toBe(false);
  });

  it('concurrent double-click consumes the durable handoff once and admits only one resumed run', async () => {
    const f = await fixture();
    const pending = await yielded(f, await f.create(kind));
    f.provider.resume();
    const frames = await Promise.all(
      [0, 1].map(() =>
        f.rpc('browser.handoff.continue', {
          handoffId: pending.handoff.handoffId,
          expectedRevision: 1,
        }),
      ),
    );
    expect(
      frames.map((frame) => frame.error),
      JSON.stringify(frames),
    ).toEqual([undefined, undefined]);
    const decisions = frames.map((frame) => frame.payload as ContinueBrowserHandoffResponse);
    expect(decisions.every((decision) => decision.status === 'continued')).toBe(true);
    expect(decisions.map((decision) => decision.replayed).sort()).toEqual([false, true]);
    const entries = await waitFor(
      () => f.history(pending.binding.taskId),
      (rows) => rows.some((entry) => entry.status === 'success'),
      'Concurrent continuation did not settle',
    );
    expect(entries.filter((entry) => entry.status === 'success')).toHaveLength(1);
    expect(entries.filter((entry) => entry.status === 'success')[0].firedAt).toBe(
      pending.binding.firedAt,
    );
    expect(f.worker.calls).toHaveLength(2); // one original open, one continued read
    expect(f.browser.getCommand(pending.handoff.handoffId)!.state).toBe('completed');
  });

  it('reopens SQLite and a fresh Runtime then reuses the frozen round, real artifact and confirmed mail receipt instead of exporting or sending again', async () => {
    const f = await fixture();
    const connector = await f.localMail();
    const task = await f.create(kind, true);
    const pending = await yielded(f, task);
    const yieldProviderErrors = [...f.providerErrors];
    expect(connector.errors).toEqual([]);
    expect(
      connector.sends(),
      JSON.stringify({
        calls: connector.calls,
        emitted: f.provider.emitted,
        toolResults: f.provider.toolResults,
      }),
    ).toHaveLength(1);
    const args = connector.sends()[0].params!.arguments!;
    expect(args.to).toBe(RECIPIENT);
    const attachments = args.attachments as string[];
    expect(attachments).toHaveLength(1);
    const path = inside(f.root, attachments[0]);
    const bytes = readFileSync(path);
    expect(bytes.length).toBeGreaterThan(100);
    expect(bytes.subarray(0, 4).toString('hex')).toBe('504b0304');
    const hash = createHash('sha256').update(bytes).digest('hex');
    expect(
      f.provider.emitted.filter((tool) => tool.name === 'automation_export_artifact'),
    ).toHaveLength(1);
    const previousProvider = f.provider;
    await f.restart();
    expect(f.provider).not.toBe(previousProvider);
    const restoredHandoffs = await f.waiting();
    expect(restoredHandoffs).toMatchObject([
      { handoffId: pending.handoff.handoffId, profileId: PROFILE },
    ]);
    expect(restoredHandoffs[0].scheduledTaskId).toBe(task.id);
    const frozen = f.settings.get('automation:login:' + task.id + ':' + pending.binding.firedAt)!
      .value as { firedAt: string; waitingLogin: boolean; task: ScheduledTask };
    expect(frozen).toMatchObject({
      firedAt: pending.binding.firedAt,
      waitingLogin: true,
      task: { id: task.id, automation: task.automation },
    });
    const resumeErrorOffset = f.providerErrors.length;
    await resumed(f, pending);
    expect(f.provider.emitted.some((tool) => tool.name === 'automation_export_artifact')).toBe(
      false,
    );
    expect(f.provider.emitted.some((tool) => tool.name === 'mcp__' + MAIL + '__send_email')).toBe(
      true,
    );
    expect(
      connector.sends(),
      'Confirmed send must replay its durable receipt across resumed member/run boundaries',
    ).toHaveLength(1);
    expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(hash);
    expect(connector.errors).toEqual([]);
    expect(
      {
        duringYield: yieldProviderErrors,
        duringRestartAndResume: f.providerErrors.slice(yieldProviderErrors.length),
        duringResume: f.providerErrors.slice(resumeErrorOffset),
      },
      'A deliberate login wait and durable resume must not conceal a provider/context failure behind scheduled history',
    ).toEqual({ duringYield: [], duringRestartAndResume: [], duringResume: [] });
  });

  it('keeps the durable handoff resumable when another scheduled run occupies the only admission slot', async () => {
    const f = await fixture();
    const pending = await yielded(f, await f.create(kind));
    f.settings.set('task-scheduler', { enabled: true, maxConcurrent: 1 });
    const blocker = (
      await f.ok<{ task: ScheduledTask }>('scheduledTask.create', {
        name: 'Local admission blocker',
        instruction: 'Hold the local fixture slot.',
        target: { kind: 'model', modelId: 'fake-mini' },
        workspaceId: f.workspace.id,
        rule: { kind: 'every', intervalMinutes: 30 },
        timeZone: 'UTC',
        enabled: true,
      })
    ).task;
    const release = f.provider.hold();
    try {
      expect(
        (await f.ok<{ fired: boolean }>('scheduledTask.trigger', { taskId: blocker.id })).fired,
      ).toBe(true);
      await waitFor(
        () => f.provider.activeCalls,
        (count) => count > 0,
        'Fixture blocker did not occupy the real Runtime run slot',
      );
      const first = await f.rpc('browser.handoff.continue', {
        handoffId: pending.handoff.handoffId,
        expectedRevision: 1,
      });
      expect(first.error).toBeDefined();
      expect(first.error!.message).toMatch(/并发|capacity|concurr|忙/i);
      expect(
        f.browser.getCommand(pending.handoff.handoffId)!.state,
        'Admission rejection must not consume the one-shot durable login receipt',
      ).toBe('waiting_user');
      expect(f.worker.calls).toHaveLength(1);
      expect(
        (await f.history(pending.binding.taskId)).some((entry) => entry.status === 'success'),
      ).toBe(false);
    } finally {
      release();
    }
    await waitFor(
      () => f.history(blocker.id),
      (entries) => entries.some((entry) => entry.status !== 'skipped'),
      'Fixture blocker did not release its slot',
    );
    await resumed(f, pending);
  });

  it('explicitly resumes a disabled draft-test login without publishing it or executing its next due schedule', async () => {
    const f = await fixture();
    // Deliberately avoid create(), which publishes its draft. UI test-run must
    // keep both the admission snapshot and the current task disabled.
    const task = (
      await f.ok<{ task: ScheduledTask }>('scheduledTask.create', {
        name: kind + ' draft-test login',
        instruction: 'Read the selected account during an explicit draft test-run.',
        target: kind === 'model' ? { kind, modelId: 'fake-mini' } : { kind, agentId: f.agent.id },
        workspaceId: f.workspace.id,
        rule: { kind: 'every', intervalMinutes: 5 },
        timeZone: 'UTC',
        enabled: false,
        automation: { executionMode: 'full-access', browser: { profileId: PROFILE } },
      })
    ).task;
    expect(task.enabled).toBe(false);
    const pending = await yielded(f, task);
    expect(f.schedules.get(task.id)!.enabled).toBe(false);
    const frozen = f.settings.get('automation:login:' + task.id + ':' + pending.binding.firedAt)!
      .value as { task: ScheduledTask; firedAt: string; waitingLogin: boolean };
    expect(frozen).toMatchObject({
      task: { id: task.id, enabled: false },
      firedAt: pending.binding.firedAt,
      waitingLogin: true,
    });
    await resumed(f, pending);
    const completed = f.schedules.get(task.id)!;
    expect(completed.enabled).toBe(false);
    expect(completed.lastResult).toMatchObject({
      status: 'success',
      firedAt: pending.binding.firedAt,
    });
    expect(completed.nextRunAt).toBeTruthy();
    const before = {
      requests: f.provider.requests.length,
      calls: f.worker.calls.length,
      leases: f.worker.acquired.length,
      history: await f.history(task.id),
    };
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(Math.max(Date.now(), Date.parse(completed.nextRunAt!)) + 1000));
      expect(Date.parse(completed.nextRunAt!)).toBeLessThan(Date.now());
      expect(f.schedules.listDue(new Date().toISOString())).toEqual([]);
      await (f.runtime as unknown as { taskSchedulerTick(): Promise<void> }).taskSchedulerTick();
      expect(f.schedules.get(task.id)).toMatchObject({
        enabled: false,
        nextRunAt: completed.nextRunAt,
        lastRunAt: completed.lastRunAt,
      });
      expect(f.provider.requests).toHaveLength(before.requests);
      expect(f.worker.calls).toHaveLength(before.calls);
      expect(f.worker.acquired).toHaveLength(before.leases);
      expect(await f.history(task.id)).toEqual(before.history);
    } finally {
      vi.useRealTimers();
    }
  });
});
