import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  ulid,
  type AutomationDefinition,
  type AutomationExecution,
  type AutomationId,
  type AutomationTriggerSource,
  type TaskId,
} from '@sync-think/shared';
import type { SecureStore } from '@sync-think/secure-store';
import type { SqliteAutomationStore } from '@sync-think/storage';
import { nextCronOccurrence } from './automation-schedule.js';

const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;
const WEBHOOK_TIMESTAMP_TOLERANCE_MS = 5 * 60_000;
const DEFAULT_TICK_MS = 5_000;

export interface AutomationTaskResult {
  taskId: TaskId;
}

export interface AutomationServiceOptions {
  store: SqliteAutomationStore;
  secureStore: SecureStore;
  host?: string;
  port?: number;
  tickMs?: number;
  now?: () => Date;
  createTask(input: {
    automation: AutomationDefinition;
    taskInput: string;
    source: AutomationTriggerSource;
    triggerId: string;
    attempt: number;
  }): Promise<AutomationTaskResult>;
  startTask(input: {
    automation: AutomationDefinition;
    taskId: TaskId;
  }): Promise<void>;
  appendSkippedTaskMessage(taskId: TaskId, message: string): Promise<void>;
  getTaskInput(taskId: TaskId): string | undefined;
  getTaskState(
    taskId: TaskId,
    since: string,
  ): 'running' | 'completed' | 'failed';
  emit(
    type: string,
    automation: AutomationDefinition,
    execution?: AutomationExecution,
    detail?: Record<string, unknown>,
  ): void;
}

export interface AutomationWebhookStatus {
  available: boolean;
  baseUrl?: string;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function taskInput(instruction: string, input?: string): string {
  return input?.trim()
    ? `${instruction.trim()}\n\n触发输入：\n${input.trim()}`
    : instruction.trim();
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'automation execution failed';
  return message
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~\-+/=]+/gi, 'Bearer [REDACTED]')
    .slice(0, 1_000);
}

export class AutomationService {
  private readonly now: () => Date;
  private readonly host: string;
  private readonly port: number;
  private readonly tickMs: number;
  private server: Server | undefined;
  private timer: NodeJS.Timeout | undefined;
  private webhookStatus: AutomationWebhookStatus = { available: false };
  private serialized: Promise<unknown> = Promise.resolve();
  private stopped = false;

  constructor(private readonly options: AutomationServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 47_821;
    this.tickMs = Math.max(1_000, options.tickMs ?? DEFAULT_TICK_MS);
  }

  status(): AutomationWebhookStatus {
    return { ...this.webhookStatus };
  }

  webhookUrl(automation: AutomationDefinition): string | undefined {
    return automation.trigger.type === 'webhook' && this.webhookStatus.baseUrl
      ? `${this.webhookStatus.baseUrl}/webhooks/${automation.trigger.path}`
      : undefined;
  }

  async start(): Promise<void> {
    if (this.timer || this.server) return;
    this.stopped = false;
    await this.serialize(async () => {
      const now = this.now();
      for (const automation of this.options.store.list({ includeDisabled: false, limit: 500 })) {
        if (automation.trigger.type !== 'cron') continue;
        const next =
          automation.nextTriggerAt && Date.parse(automation.nextTriggerAt) > now.getTime()
            ? automation.nextTriggerAt
            : nextCronOccurrence(automation.trigger.expression, automation.timezone, now);
        this.options.store.updateTriggerTimes(
          automation.id,
          automation.lastTriggeredAt,
          next,
          now.toISOString(),
        );
      }
      await this.reconcileInternal();
    });
    await this.startWebhookServer();
    this.timer = setInterval(() => void this.serialize(() => this.reconcileInternal()), this.tickMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    const server = this.server;
    this.server = undefined;
    this.webhookStatus = { available: false };
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await this.serialized.catch(() => undefined);
  }

  trigger(
    automationId: AutomationId,
    source: AutomationTriggerSource,
    input?: string,
  ): Promise<AutomationExecution> {
    return this.serialize(() => this.triggerInternal(automationId, source, input));
  }

  private serialize<T>(operation: () => Promise<T> | T): Promise<T> {
    const next = this.serialized.then(operation, operation);
    this.serialized = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async triggerInternal(
    automationId: AutomationId,
    source: AutomationTriggerSource,
    input?: string,
  ): Promise<AutomationExecution> {
    const automation = this.options.store.getRequired(automationId);
    if (!automation.enabled && source !== 'manual') throw new Error('automation.disabled');
    if (source === 'webhook' && automation.trigger.type !== 'webhook') {
      throw new Error('automation.webhook_trigger_mismatch');
    }
    const triggerId = `automation-trigger-${ulid().toLowerCase()}`;
    const value = taskInput(automation.instruction, input);
    const active = this.options.store.countActive(automation.id);
    const shouldSkip =
      automation.concurrencyPolicy === 'skip' && active >= automation.maxConcurrency;
    const shouldQueue =
      automation.concurrencyPolicy !== 'skip' && active >= automation.maxConcurrency;
    const createdTask = await this.options.createTask({
      automation,
      taskInput: value,
      source,
      triggerId,
      attempt: 0,
    });
    let execution = this.options.store.createExecution({
      automationId: automation.id,
      triggerId,
      source,
      status: shouldSkip ? 'skipped' : shouldQueue ? 'queued' : 'running',
      attempt: 0,
      taskId: createdTask.taskId,
      inputDigest: digest(value),
      ...(shouldSkip
        ? {
            errorSummary: '已按并发策略跳过',
            completedAt: this.now().toISOString(),
          }
        : {}),
      ...(!shouldSkip && !shouldQueue ? { startedAt: this.now().toISOString() } : {}),
    });
    const now = this.now();
    this.options.store.updateTriggerTimes(
      automation.id,
      now.toISOString(),
      automation.nextTriggerAt,
      now.toISOString(),
    );
    this.options.emit('automation.triggered', automation, execution, { source });

    if (shouldSkip) {
      await this.options.appendSkippedTaskMessage(
        createdTask.taskId,
        '本次触发已按自动化并发策略跳过，没有复用其他任务的上下文。',
      );
      this.options.emit('automation.execution.skipped', automation, execution);
      return execution;
    }
    if (shouldQueue) {
      this.options.emit('automation.execution.queued', automation, execution);
      return execution;
    }
    execution = await this.startExecution(automation, execution);
    return execution;
  }

  private async startExecution(
    automation: AutomationDefinition,
    execution: AutomationExecution,
  ): Promise<AutomationExecution> {
    if (!execution.taskId) throw new Error('automation.execution_task_missing');
    let running = execution;
    if (running.status !== 'running') {
      running = this.options.store.transitionExecution(running.id, 'running', {
        startedAt: this.now().toISOString(),
      });
    }
    try {
      await this.options.startTask({ automation, taskId: execution.taskId });
      this.options.emit('automation.execution.started', automation, running);
      return running;
    } catch (error) {
      const failed = this.options.store.transitionExecution(running.id, 'failed', {
        errorSummary: safeError(error),
        completedAt: this.now().toISOString(),
      });
      this.options.emit('automation.execution.failed', automation, failed);
      return this.retryIfAllowed(automation, failed);
    }
  }

  private async retryIfAllowed(
    automation: AutomationDefinition,
    failed: AutomationExecution,
  ): Promise<AutomationExecution> {
    if (failed.attempt >= automation.maxRetries || !failed.taskId) return failed;
    const previousInput = this.options.getTaskInput(failed.taskId);
    if (!previousInput) return failed;
    const attempt = failed.attempt + 1;
    const task = await this.options.createTask({
      automation,
      taskInput: previousInput,
      source: failed.source,
      triggerId: failed.triggerId,
      attempt,
    });
    const retry = this.options.store.createExecution({
      automationId: automation.id,
      triggerId: failed.triggerId,
      source: failed.source,
      status: 'running',
      attempt,
      taskId: task.taskId,
      inputDigest: failed.inputDigest,
      startedAt: this.now().toISOString(),
    });
    this.options.emit('automation.execution.retrying', automation, retry, { attempt });
    return this.startExecution(automation, retry);
  }

  private async reconcileInternal(): Promise<void> {
    if (this.stopped) return;
    const now = this.now();
    for (const due of this.options.store.listDue(now.toISOString())) {
      const next = nextCronOccurrence(due.trigger.type === 'cron' ? due.trigger.expression : '', due.timezone, now);
      this.options.store.updateTriggerTimes(due.id, due.lastTriggeredAt, next, now.toISOString());
      await this.triggerInternal(due.id, 'schedule');
    }

    const running = this.options.store.listExecutions({ status: 'running', limit: 500 });
    for (const execution of [...running].reverse()) {
      if (!execution.taskId) continue;
      const state = this.options.getTaskState(
        execution.taskId,
        execution.startedAt ?? execution.createdAt,
      );
      if (state === 'running') continue;
      const automation = this.options.store.get(execution.automationId);
      if (!automation) continue;
      const terminal = this.options.store.transitionExecution(execution.id, state, {
        ...(state === 'failed' ? { errorSummary: '任务执行失败' } : {}),
        completedAt: now.toISOString(),
      });
      this.options.emit(`automation.execution.${state}`, automation, terminal);
      if (state === 'failed') await this.retryIfAllowed(automation, terminal);
    }

    const queued = this.options.store.listExecutions({ status: 'queued', limit: 500 }).reverse();
    for (const execution of queued) {
      const automation = this.options.store.get(execution.automationId);
      if (!automation || this.options.store.countActive(automation.id) >= automation.maxConcurrency) {
        continue;
      }
      await this.startExecution(automation, execution);
    }
  }

  private async startWebhookServer(): Promise<void> {
    const server = createServer((request, response) => void this.handleWebhook(request, response));
    this.server = server;
    await new Promise<void>((resolve) => {
      const onError = () => {
        this.webhookStatus = { available: false };
        resolve();
      };
      server.once('error', onError);
      server.listen(this.port, this.host, () => {
        server.off('error', onError);
        const address = server.address();
        const port = address && typeof address === 'object' ? address.port : this.port;
        this.webhookStatus = {
          available: true,
          baseUrl: `http://${this.host}:${port}`,
        };
        resolve();
      });
    });
  }

  private async handleWebhook(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const send = (status: number, payload: Record<string, unknown>) => {
      if (response.headersSent) return;
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(payload));
    };
    try {
      if (request.method !== 'POST' || !request.url) {
        send(404, { ok: false, error: 'not_found' });
        return;
      }
      const url = new URL(request.url, 'http://127.0.0.1');
      const match = /^\/webhooks\/([a-z0-9][a-z0-9_-]{7,63})$/.exec(url.pathname);
      if (!match) {
        send(404, { ok: false, error: 'not_found' });
        return;
      }
      const automation = this.options.store.getByWebhookPath(match[1]!);
      if (!automation || !automation.enabled || automation.trigger.type !== 'webhook') {
        send(404, { ok: false, error: 'not_found' });
        return;
      }
      const body = await this.readWebhookBody(request, response);
      if (!body) return;
      const timestamp = String(request.headers['x-sync-think-timestamp'] ?? '');
      const signatureHeader = String(request.headers['x-sync-think-signature'] ?? '');
      const timestampMs = Number(timestamp) * 1_000;
      if (
        !/^\d{10}$/.test(timestamp) ||
        !Number.isFinite(timestampMs) ||
        Math.abs(this.now().getTime() - timestampMs) > WEBHOOK_TIMESTAMP_TOLERANCE_MS
      ) {
        send(401, { ok: false, error: 'invalid_timestamp' });
        return;
      }
      const handle = this.options.store.getWebhookSecretHandle(automation.id);
      if (!handle) {
        send(503, { ok: false, error: 'secret_unavailable' });
        return;
      }
      const secret = await this.options.secureStore.retrieveSecret(handle);
      const expected = createHmac('sha256', secret)
        .update(timestamp)
        .update('.')
        .update(body)
        .digest('hex');
      const supplied = signatureHeader.startsWith('sha256=')
        ? signatureHeader.slice('sha256='.length)
        : signatureHeader;
      const expectedBytes = Buffer.from(expected, 'hex');
      const suppliedBytes = /^[a-f0-9]{64}$/i.test(supplied)
        ? Buffer.from(supplied, 'hex')
        : Buffer.alloc(0);
      if (
        expectedBytes.length !== suppliedBytes.length ||
        !timingSafeEqual(expectedBytes, suppliedBytes)
      ) {
        send(401, { ok: false, error: 'invalid_signature' });
        return;
      }
      let input = body.toString('utf8');
      if (String(request.headers['content-type'] ?? '').toLowerCase().includes('application/json')) {
        input = JSON.stringify(JSON.parse(input));
      }
      const execution = await this.trigger(automation.id, 'webhook', input);
      send(202, {
        ok: true,
        executionId: execution.id,
        taskId: execution.taskId,
        status: execution.status,
      });
    } catch (error) {
      send(400, { ok: false, error: safeError(error) });
    }
  }

  private readWebhookBody(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<Buffer | undefined> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      request.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_WEBHOOK_BODY_BYTES) {
          response.writeHead(413, { 'content-type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ ok: false, error: 'payload_too_large' }));
          request.destroy();
          resolve(undefined);
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      request.on('end', () => resolve(Buffer.concat(chunks)));
      request.on('error', reject);
    });
  }
}
