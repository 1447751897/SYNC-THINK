import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  AutomationDefinition,
  AutomationExecution,
  AutomationExecutionId,
  AutomationId,
  TaskId,
} from '@sync-think/shared';
import type { SecureStore } from '@sync-think/secure-store';
import type { SqliteAutomationStore } from '@sync-think/storage';
import { AutomationService } from './automation-service.js';

class MemoryAutomationStore {
  readonly definitions = new Map<AutomationId, AutomationDefinition>();
  readonly executions: AutomationExecution[] = [];
  readonly handles = new Map<AutomationId, string>();

  list() {
    return [...this.definitions.values()];
  }
  listDue() {
    return [];
  }
  get(id: AutomationId) {
    return this.definitions.get(id);
  }
  getRequired(id: AutomationId) {
    const value = this.get(id);
    if (!value) throw new Error('not found');
    return value;
  }
  getByWebhookPath(path: string) {
    return [...this.definitions.values()].find(
      (value) => value.trigger.type === 'webhook' && value.trigger.path === path,
    );
  }
  getWebhookSecretHandle(id: AutomationId) {
    return this.handles.get(id);
  }
  updateTriggerTimes(id: AutomationId, lastTriggeredAt?: string, nextTriggerAt?: string) {
    const current = this.getRequired(id);
    this.definitions.set(id, {
      ...current,
      ...(lastTriggeredAt ? { lastTriggeredAt } : {}),
      ...(nextTriggerAt ? { nextTriggerAt } : {}),
    });
  }
  countActive(id: AutomationId) {
    return this.executions.filter(
      (execution) => execution.automationId === id && execution.status === 'running',
    ).length;
  }
  createExecution(input: Omit<AutomationExecution, 'id' | 'createdAt'> & { now?: string }) {
    const execution: AutomationExecution = {
      ...input,
      id: `execution-${this.executions.length + 1}` as AutomationExecutionId,
      createdAt: input.now ?? '2026-07-18T00:00:00.000Z',
    };
    this.executions.push(execution);
    return execution;
  }
  transitionExecution(
    id: AutomationExecutionId,
    status: AutomationExecution['status'],
    input: { errorSummary?: string; startedAt?: string; completedAt?: string } = {},
  ) {
    const index = this.executions.findIndex((execution) => execution.id === id);
    const current = this.executions[index]!;
    const next = { ...current, ...input, status };
    this.executions[index] = next;
    return next;
  }
  listExecutions(input: { automationId?: AutomationId; status?: AutomationExecution['status'] }) {
    return this.executions.filter(
      (execution) =>
        (!input.automationId || execution.automationId === input.automationId) &&
        (!input.status || execution.status === input.status),
    );
  }
}

const services: AutomationService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.stop();
});

function definition(
  overrides: Partial<AutomationDefinition> = {},
): AutomationDefinition {
  return {
    id: 'automation-1' as AutomationId,
    name: '自动检查',
    workspaceId: 'workspace-1' as never,
    target: { type: 'agent', agentVersionId: 'agent-1' as never },
    instruction: '检查状态',
    approvalMode: 'full',
    trigger: { type: 'cron', expression: '0 9 * * *' },
    timezone: 'Asia/Shanghai',
    concurrencyPolicy: 'skip',
    maxConcurrency: 1,
    maxRetries: 0,
    enabled: true,
    webhookSecretConfigured: false,
    version: 1,
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
    ...overrides,
  };
}

function serviceFixture(
  store: MemoryAutomationStore,
  options: { failStarts?: number; port?: number } = {},
) {
  const createdTasks: string[] = [];
  const skipped: string[] = [];
  let remainingFailures = options.failStarts ?? 0;
  const service = new AutomationService({
    store: store as unknown as SqliteAutomationStore,
    secureStore: {
      retrieveSecret: async () => 'webhook-secret',
    } as unknown as SecureStore,
    port: options.port ?? 0,
    tickMs: 60_000,
    now: () => new Date('2026-07-18T00:00:00.000Z'),
    createTask: async () => {
      const taskId = `task-${createdTasks.length + 1}`;
      createdTasks.push(taskId);
      return { taskId: taskId as TaskId };
    },
    startTask: async () => {
      if (remainingFailures > 0) {
        remainingFailures--;
        throw new Error('transient start failure');
      }
    },
    appendSkippedTaskMessage: async (_taskId, message) => {
      skipped.push(message);
    },
    getTaskInput: () => '检查状态',
    getTaskState: () => 'running',
    emit: () => undefined,
  });
  services.push(service);
  return { service, createdTasks, skipped };
}

describe('AutomationService', () => {
  it('creates an isolated task even when the concurrency policy skips execution', async () => {
    const store = new MemoryAutomationStore();
    const automation = definition();
    store.definitions.set(automation.id, automation);
    store.executions.push({
      id: 'running-1' as AutomationExecutionId,
      automationId: automation.id,
      triggerId: 'trigger-running',
      source: 'manual',
      status: 'running',
      attempt: 0,
      taskId: 'task-running' as TaskId,
      inputDigest: 'a'.repeat(64),
      createdAt: '2026-07-18T00:00:00.000Z',
    });
    const { service, createdTasks, skipped } = serviceFixture(store);

    const execution = await service.trigger(automation.id, 'manual');
    expect(execution).toMatchObject({ status: 'skipped', taskId: 'task-1' });
    expect(createdTasks).toEqual(['task-1']);
    expect(skipped[0]).toContain('没有复用其他任务的上下文');
  });

  it('retries a failed start with a new task and the same trigger lineage', async () => {
    const store = new MemoryAutomationStore();
    const automation = definition({ maxRetries: 1 });
    store.definitions.set(automation.id, automation);
    const { service, createdTasks } = serviceFixture(store, { failStarts: 1 });

    const execution = await service.trigger(automation.id, 'manual');
    expect(execution).toMatchObject({ status: 'running', attempt: 1, taskId: 'task-2' });
    expect(createdTasks).toEqual(['task-1', 'task-2']);
    expect(store.executions.map((item) => item.status)).toEqual(['failed', 'running']);
    expect(store.executions[0]?.triggerId).toBe(store.executions[1]?.triggerId);
  });

  it('accepts only fresh HMAC-signed loopback webhooks', async () => {
    const store = new MemoryAutomationStore();
    const automation = definition({
      trigger: { type: 'webhook', path: 'wh_test_webhook' },
      webhookSecretConfigured: true,
    });
    store.definitions.set(automation.id, automation);
    store.handles.set(automation.id, 'secret-handle');
    const { service, createdTasks } = serviceFixture(store);
    await service.start();
    const baseUrl = service.status().baseUrl!;
    const timestamp = String(Math.floor(Date.parse('2026-07-18T00:00:00.000Z') / 1_000));
    const body = JSON.stringify({ action: 'check' });
    const signature = createHmac('sha256', 'webhook-secret')
      .update(timestamp)
      .update('.')
      .update(body)
      .digest('hex');

    const rejected = await fetch(`${baseUrl}/webhooks/wh_test_webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sync-think-timestamp': timestamp,
        'x-sync-think-signature': '0'.repeat(64),
      },
      body,
    });
    expect(rejected.status).toBe(401);

    const accepted = await fetch(`${baseUrl}/webhooks/wh_test_webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sync-think-timestamp': timestamp,
        'x-sync-think-signature': `sha256=${signature}`,
      },
      body,
    });
    expect(accepted.status).toBe(202);
    expect(await accepted.json()).toMatchObject({ ok: true, taskId: 'task-1' });
    expect(createdTasks).toEqual(['task-1']);
  });

  it('degrades cleanly when the webhook port is occupied and recovers after restart', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const address = blocker.address();
    if (!address || typeof address === 'string') throw new Error('test port unavailable');

    const store = new MemoryAutomationStore();
    const { service } = serviceFixture(store, { port: address.port });
    await service.start();
    expect(service.status()).toEqual({ available: false });
    await service.stop();
    await new Promise<void>((resolve, reject) =>
      blocker.close((error) => (error ? reject(error) : resolve())),
    );

    await service.start();
    expect(service.status()).toMatchObject({
      available: true,
      baseUrl: `http://127.0.0.1:${address.port}`,
    });
  });
});
