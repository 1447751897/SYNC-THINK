import { describe, expect, it, afterEach } from 'vitest';
import { connect, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import { FakeProvider } from '@sync-think/adapters';
import { openDatabaseAsync, SqliteAgentStore } from '@sync-think/storage';
import { openPersistentRuntime } from '../src/persistence.js';
import type { StepExecutor } from '../src/orchestration/step-executor.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore lock
    }
  }
});

async function connectRuntime(installId: string): Promise<Socket> {
  const sock = connect(pipePathPortable(installId));
  await new Promise<void>((resolve, reject) => {
    sock.once('connect', resolve);
    sock.once('error', reject);
  });
  return sock;
}

function createFrameReader(sock: Socket) {
  const queued: Frame[] = [];
  const waiters: Array<{ count: number; resolve: (f: Frame[]) => void; reject: (e: unknown) => void }> = [];
  let pending = Buffer.alloc(0);
  const drain = () => {
    while (waiters.length > 0 && queued.length >= waiters[0]!.count) {
      const waiter = waiters.shift()!;
      waiter.resolve(queued.splice(0, waiter.count));
    }
  };
  sock.on('data', (chunk: Buffer) => {
    try {
      const decoded = decodeFrames(Buffer.concat([pending, chunk]));
      pending = decoded.remaining;
      queued.push(...decoded.frames);
      drain();
    } catch (e) {
      while (waiters.length > 0) waiters.shift()!.reject(e);
    }
  });
  sock.on('error', (e) => {
    while (waiters.length > 0) waiters.shift()!.reject(e);
  });
  sock.on('close', () => {
    while (waiters.length > 0) waiters.shift()!.reject(new Error('socket closed'));
  });
  return {
    read(count: number) {
      if (queued.length >= count) return Promise.resolve(queued.splice(0, count));
      return new Promise<Frame[]>((resolve, reject) => waiters.push({ count, resolve, reject }));
    },
  };
}

async function writeAndRead(sock: Socket, reader: ReturnType<typeof createFrameReader>, frame: Frame) {
  const next = reader.read(1);
  sock.write(encodeFrame(frame));
  return (await next)[0]!;
}

async function hello(sock: Socket, reader: ReturnType<typeof createFrameReader>, installId: string) {
  const resp = await writeAndRead(sock, reader, {
    id: 'hello',
    kind: 'request',
    type: '__hello',
    payload: {
      protocolVersion: 2,
      appVersion: '0.0.1',
      installId,
      nonce: randomBytes(8).toString('hex'),
      features: [
        'approval.list',
        'approval.evaluate',
        'approval.enqueue',
        'approval.decide',
        'policy.save',
        'workspace.create',
      ],
    },
  });
  expect(resp.payload).toMatchObject({ ok: true });
}

async function withRuntime(
  fn: (ctx: {
    sock: Socket;
    reader: ReturnType<typeof createFrameReader>;
    workspaceId: string;
    dbPath: string;
  }) => Promise<void>,
  options: { stepExecutor?: StepExecutor } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-approval-cmd-'));
  tempDirs.push(dir);
  const installId = 'appr-' + randomBytes(4).toString('hex');
  const dbPath = join(dir, 'db.sqlite');
  const session = await openPersistentRuntime({
    installId,
    dbPath,
    secureStoreKeyPath: join(dir, 'key.bin'),
    demoProvider: new FakeProvider(),
    allowNoToken: true,
    stepExecutor: options.stepExecutor,
  });
  try {
    await session.runtime.start();
    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    await hello(sock, reader, installId);
    const wsResp = await writeAndRead(sock, reader, {
      id: 'ws-1',
      kind: 'request',
      type: 'workspace.create',
      payload: { folderPath: dir, name: 'approval-test' },
    });
    expect(wsResp.error).toBeUndefined();
    const workspaceId = (wsResp.payload as { workspaceId: string }).workspaceId;
    await fn({ sock, reader, workspaceId, dbPath });
    sock.destroy();
  } finally {
    await session.close();
  }
}

describe('approval commands (section 13)', () => {
  it('evaluates human-only as require-human even in full mode', async () => {
    await withRuntime(async ({ sock, reader }) => {
      const resp = await writeAndRead(sock, reader, {
        id: 'ev-1',
        kind: 'request',
        type: 'approval.evaluate',
        payload: { mode: 'full', action: 'payment-or-purchase', insideExplicitPolicy: true, delegateAvailable: true },
      });
      expect(resp.error).toBeUndefined();
      const p = resp.payload as { gate: string; humanOnly: boolean; labelZh: string };
      expect(p.gate).toBe('require-human');
      expect(p.humanOnly).toBe(true);
      expect(p.labelZh.length).toBeGreaterThan(0);
    });
  });

  it('lists human-only actions and empty queue', async () => {
    await withRuntime(async ({ sock, reader, workspaceId }) => {
      const resp = await writeAndRead(sock, reader, {
        id: 'list-1',
        kind: 'request',
        type: 'approval.list',
        payload: { workspaceId },
      });
      expect(resp.error).toBeUndefined();
      const p = resp.payload as { items: unknown[]; pendingCount: number; humanOnlyActions: string[]; modes: string[] };
      expect(p.pendingCount).toBe(0);
      expect(p.items).toEqual([]);
      expect(p.humanOnlyActions).toContain('irreversible-deletion');
      expect(p.modes).toContain('request');
    });
  });

  it('enqueues require-human tool and human decides', async () => {
    await withRuntime(async ({ sock, reader, workspaceId }) => {
      const enq = await writeAndRead(sock, reader, {
        id: 'enq-1',
        kind: 'request',
        type: 'approval.enqueue',
        payload: { workspaceId, action: 'shell.exec', kind: 'tool', summary: 'Run tests', mode: 'request' },
      });
      expect(enq.error).toBeUndefined();
      const ep = enq.payload as { enqueued: boolean; autoApproved: boolean; item?: { id: string; action: string }; evaluation: { gate: string } };
      expect(ep.enqueued).toBe(true);
      expect(ep.autoApproved).toBe(false);
      expect(ep.evaluation.gate).toBe('require-human');
      expect(ep.item?.action).toBe('shell.exec');

      const list = await writeAndRead(sock, reader, {
        id: 'list-2',
        kind: 'request',
        type: 'approval.list',
        payload: { workspaceId, state: 'pending' },
      });
      expect((list.payload as { pendingCount: number }).pendingCount).toBe(1);

      const dec = await writeAndRead(sock, reader, {
        id: 'dec-1',
        kind: 'request',
        type: 'approval.decide',
        payload: { id: ep.item!.id, decision: 'approved' },
      });
      expect(dec.error).toBeUndefined();
      const dp = dec.payload as { item: { state: string; decidedBy?: string } };
      expect(dp.item.state).toBe('approved');
      expect(dp.item.decidedBy).toBe('human');
    });
  });

  it('derives approval from persisted policy and ignores client authority hints', async () => {
    await withRuntime(async ({ sock, reader, workspaceId }) => {
      const forged = await writeAndRead(sock, reader, {
        id: 'enq-forged-auto',
        kind: 'request',
        type: 'approval.enqueue',
        payload: { workspaceId, action: 'read-file', kind: 'tool', mode: 'full', insideExplicitPolicy: true },
      });
      expect(forged.error).toBeUndefined();
      expect(forged.payload).toMatchObject({
        enqueued: true,
        autoApproved: false,
        evaluation: { gate: 'require-human', mode: 'request' },
      });

      const saved = await writeAndRead(sock, reader, {
        id: 'policy-full-read',
        kind: 'request',
        type: 'policy.save',
        payload: {
          workspaceId,
          scopeType: 'workspace',
          scopeId: workspaceId,
          approvalMode: 'full',
          rules: [{ action: 'read-file', approvalMode: 'full' }],
        },
      });
      expect(saved.error).toBeUndefined();

      const enq = await writeAndRead(sock, reader, {
        id: 'enq-server-auto',
        kind: 'request',
        type: 'approval.enqueue',
        payload: {
          workspaceId,
          action: 'read-file',
          kind: 'tool',
          mode: 'request',
          insideExplicitPolicy: false,
          delegateAvailable: false,
        },
      });
      expect(enq.error).toBeUndefined();
      const ep = enq.payload as {
        enqueued: boolean;
        autoApproved: boolean;
        evaluation: { gate: string; mode: string };
      };
      expect(ep.autoApproved).toBe(true);
      expect(ep.enqueued).toBe(false);
      expect(ep.evaluation).toMatchObject({ gate: 'auto-approve', mode: 'full' });
    });
  });

  it('does not accept a client assertion that a delegate Agent is available', async () => {
    await withRuntime(async ({ sock, reader, workspaceId }) => {
      const resp = await writeAndRead(sock, reader, {
        id: 'ev-forged-delegate',
        kind: 'request',
        type: 'approval.evaluate',
        payload: {
          workspaceId,
          action: 'shell.exec',
          mode: 'delegate',
          delegateAvailable: true,
          insideExplicitPolicy: true,
        },
      });
      expect(resp.error).toBeUndefined();
      expect(resp.payload).toMatchObject({
        gate: 'require-human',
        mode: 'request',
        humanOnly: false,
      });
    });
  });

  it('allows only the exact persisted delegate AgentVersion and never delegates human-only', async () => {
    await withRuntime(async ({ sock, reader, workspaceId, dbPath }) => {
      const defaultAgent = await writeAndRead(sock, reader, {
        id: 'delegate-default-agent',
        kind: 'request',
        type: 'agent.get',
        payload: {},
      });
      const defaultSummary = defaultAgent.payload as {
        agent: { agentVersionId: string; defaultModelId: string };
      };
      const external = await openDatabaseAsync({ path: dbPath });
      const agents = new SqliteAgentStore(external.raw);
      const configuredDelegate = agents.createAgent({
        agentId: 'agent-approval-delegate' as never,
        name: 'Approval delegate',
        role: 'approval',
        developerInstructions: 'Review delegated actions.',
        inputContract: 'Approval request',
        outputContract: 'Approval decision',
        defaultModelId: defaultSummary.agent.defaultModelId as never,
      });
      const wrongDelegate = agents.updateDefinition({
        agentId: configuredDelegate.agentId,
        role: 'approval',
      });
      external.raw.close();

      const savePolicy = async (
        id: string,
        action: string,
        delegateAgentVersionId?: string,
      ) =>
        writeAndRead(sock, reader, {
          id,
          kind: 'request',
          type: 'policy.save',
          payload: {
            workspaceId,
            policyId: `policy-${action}`,
            scopeType: 'workspace',
            scopeId: workspaceId,
            approvalMode: 'full',
            rules: [
              {
                action,
                approvalMode: 'delegate',
                ...(delegateAgentVersionId ? { delegateAgentVersionId } : {}),
              },
            ],
          },
        });
      const enqueue = async (id: string, action: string, kind: string = 'tool') =>
        writeAndRead(sock, reader, {
          id,
          kind: 'request',
          type: 'approval.enqueue',
          payload: { workspaceId, action, kind, summary: action },
        });
      const decideAsDelegate = async (
        id: string,
        approvalId: string,
        delegateAgentVersionId: string,
      ) =>
        writeAndRead(sock, reader, {
          id,
          kind: 'request',
          type: 'approval.decide',
          payload: {
            id: approvalId,
            decision: 'approved',
            decidedBy: 'delegate',
            delegateAgentVersionId,
          },
        });

      expect(
        (
          await savePolicy(
            'delegate-policy-wrong-role',
            'filesystem.write',
            defaultSummary.agent.agentVersionId,
          )
        ).error,
      ).toBeDefined();
      expect(
        (
          await savePolicy(
            'delegate-policy-exact',
            'shell.exec',
            configuredDelegate.id,
          )
        ).error,
      ).toBeUndefined();
      const exact = await enqueue('delegate-enqueue-exact', 'shell.exec');
      expect(exact.payload).toMatchObject({
        enqueued: true,
        evaluation: { gate: 'require-delegate' },
        item: { delegateAgentVersionId: configuredDelegate.id },
      });
      const exactApprovalId = (exact.payload as { item: { id: string } }).item.id;

      const wrongActor = await writeAndRead(sock, reader, {
        id: 'delegate-decide-human-actor',
        kind: 'request',
        type: 'approval.decide',
        payload: { id: exactApprovalId, decision: 'approved' },
      });
      expect(wrongActor.error).toBeDefined();

      const wrong = await decideAsDelegate(
        'delegate-decide-wrong',
        exactApprovalId,
        wrongDelegate.id,
      );
      expect(wrong.error).toBeDefined();
      const approved = await decideAsDelegate(
        'delegate-decide-exact',
        exactApprovalId,
        configuredDelegate.id,
      );
      expect(approved.error).toBeUndefined();
      expect(approved.payload).toMatchObject({
        item: {
          state: 'approved',
          decidedBy: 'delegate',
          delegateAgentVersionId: configuredDelegate.id,
        },
      });
      const delegateAudit = await openDatabaseAsync({ path: dbPath });
      const delegateEvent = delegateAudit.raw
        .prepare(
          "SELECT payload_json FROM event WHERE type = 'approval.decided' ORDER BY sequence DESC LIMIT 1",
        )
        .get() as { payload_json: string };
      expect(JSON.parse(delegateEvent.payload_json)).toMatchObject({
        approvalId: exactApprovalId,
        decidedBy: 'delegate',
        delegateAgentVersionId: configuredDelegate.id,
      });
      delegateAudit.raw.close();

      expect(
        (await savePolicy('delegate-policy-unconfigured', 'browser.navigate')).error,
      ).toBeUndefined();
      const unconfigured = await enqueue(
        'delegate-enqueue-unconfigured',
        'browser.navigate',
      );
      const unconfiguredId = (unconfigured.payload as { item: { id: string } }).item.id;
      expect(
        (
          await decideAsDelegate(
            'delegate-decide-unconfigured',
            unconfiguredId,
            configuredDelegate.id,
          )
        ).error,
      ).toBeDefined();

      const humanOnly = await enqueue(
        'delegate-enqueue-human-only',
        'payment-or-purchase',
        'human-only',
      );
      const humanOnlyId = (humanOnly.payload as { item: { id: string } }).item.id;
      expect(
        (
          await decideAsDelegate(
            'delegate-decide-human-only',
            humanOnlyId,
            configuredDelegate.id,
          )
        ).error,
      ).toBeDefined();
    });
  });

  it('human-only always enqueues even in full mode', async () => {
    await withRuntime(async ({ sock, reader, workspaceId }) => {
      const enq = await writeAndRead(sock, reader, {
        id: 'enq-ho',
        kind: 'request',
        type: 'approval.enqueue',
        payload: {
          workspaceId,
          action: 'irreversible-deletion',
          kind: 'human-only',
          mode: 'full',
          insideExplicitPolicy: true,
          summary: 'Delete production data',
        },
      });
      expect(enq.error).toBeUndefined();
      const ep = enq.payload as {
        enqueued: boolean;
        autoApproved: boolean;
        evaluation: { humanOnly: boolean; gate: string };
        item?: { humanOnly: boolean };
      };
      expect(ep.evaluation.humanOnly).toBe(true);
      expect(ep.evaluation.gate).toBe('require-human');
      expect(ep.enqueued).toBe(true);
      expect(ep.autoApproved).toBe(false);
      expect(ep.item?.humanOnly).toBe(true);
    });
  });

  it('resumes one stable protected Step once after concurrent approval replay', async () => {
    let executions = 0;
    let resolveExecuted!: () => void;
    const executed = new Promise<void>((resolve) => {
      resolveExecuted = resolve;
    });
    const executor: StepExecutor = {
      getActionRequest() {
        return {
          kind: 'tool',
          action: 'shell.exec',
          summary: 'Run protected tests',
          details: { command: 'pnpm test' },
        };
      },
      async execute() {
        executions += 1;
        resolveExecuted();
        return {};
      },
    };

    await withRuntime(async ({ sock, reader, workspaceId }) => {
      const task = await writeAndRead(sock, reader, {
        id: 'protected-task',
        kind: 'request',
        type: 'task.create',
        payload: { workspaceId, title: 'Protected task', goal: 'Approve once' },
      });
      const taskId = (task.payload as { taskId: string }).taskId;
      expect(
        (
          await writeAndRead(sock, reader, {
            id: 'protected-mode',
            kind: 'request',
            type: 'task.setParticipationMode',
            payload: { taskId, mode: 'collaboration', expectedTaskVersion: 0 },
          })
        ).error,
      ).toBeUndefined();
      const agent = await writeAndRead(sock, reader, {
        id: 'protected-agent',
        kind: 'request',
        type: 'agent.get',
        payload: {},
      });
      const agentVersionId = (
        agent.payload as { agent: { agentVersionId: string } }
      ).agent.agentVersionId;
      const draft = await writeAndRead(sock, reader, {
        id: 'protected-plan',
        kind: 'request',
        type: 'plan.draft',
        payload: {
          taskId,
          expectedTaskVersion: 1,
          title: 'Protected plan',
          steps: [
            {
              id: 'protected-command-step',
              title: 'Protected command',
              instructions: 'Execute only after approval',
              agentVersionId,
              dependsOn: [],
            },
          ],
        },
      });
      expect(draft.error).toBeUndefined();
      const approved = await writeAndRead(sock, reader, {
        id: 'protected-plan-approve',
        kind: 'request',
        type: 'plan.approve',
        payload: {
          planId: (draft.payload as { planId: string }).planId,
          revision: 1,
        },
      });
      expect(approved.error).toBeUndefined();
      const runId = (approved.payload as { run: { id: string } }).run.id;

      let approvalId = '';
      for (let attempt = 0; attempt < 40 && !approvalId; attempt += 1) {
        const listed = await writeAndRead(sock, reader, {
          id: `protected-list-${attempt}`,
          kind: 'request',
          type: 'approval.list',
          payload: { workspaceId, taskId, state: 'pending' },
        });
        const items = (listed.payload as { items: Array<{ id: string; runId?: string }> }).items;
        approvalId = items.find((item) => item.runId === runId)?.id ?? '';
      }
      expect(approvalId).not.toBe('');
      expect(executions).toBe(0);

      const responses = reader.read(2);
      for (const id of ['protected-decide-a', 'protected-decide-b']) {
        sock.write(
          encodeFrame({
            id,
            kind: 'request',
            type: 'approval.decide',
            payload: { id: approvalId, decision: 'approved' },
          }),
        );
      }
      const decisions = await responses;
      expect(decisions.map((response) => response.error)).toEqual([undefined, undefined]);
      expect(decisions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            payload: expect.objectContaining({
              item: expect.objectContaining({ state: 'approved' }),
            }),
          }),
        ]),
      );

      await executed;
      let state = '';
      for (let attempt = 0; attempt < 40 && state !== 'completed'; attempt += 1) {
        const current = await writeAndRead(sock, reader, {
          id: `protected-graph-${attempt}`,
          kind: 'request',
          type: 'run.getGraph',
          payload: { workspaceId, taskId, runId },
        });
        state = (current.payload as { run?: { state?: string } }).run?.state ?? '';
      }
      expect(state).toBe('completed');
      expect(executions).toBe(1);
    }, { stepExecutor: executor });
  });
});
