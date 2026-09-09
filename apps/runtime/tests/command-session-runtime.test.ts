import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AdapterEvent, ProviderAdapter, ProviderCallRequest } from '@sync-think/adapters';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteConversationStore,
  SqliteEventCheckpointStore,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
import type { ModelId, RunId, WorkspaceId } from '@sync-think/shared';
import { createDemoRun, type DemoRunState } from '../src/demo-run.js';
import { Runtime } from '../src/runtime.js';
import type { CommandSessionStore } from '../src/command-sessions.js';

class CommandPollingProvider implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  calls = 0;
  sessionId = '';
  resultStatuses: string[] = [];

  async discoverModels() {
    return ['fake-mini'];
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    const step = this.calls++;
    const lastResult = request.messages.filter((message) => message.role === 'tool').at(-1);
    if (lastResult && typeof lastResult.content === 'string') {
      const payload = JSON.parse(lastResult.content);
      const result = payload.session ?? payload;
      if (result.sessionId) this.sessionId = result.sessionId;
      if (result.status) this.resultStatuses.push(result.status);
    }
    let name: string;
    let args: object;
    if (step < 7) {
      name = 'read_file';
      args = { path: `input-${step}.txt` };
    } else if (step === 7) {
      name = 'run_command';
      args = {
        command: process.execPath,
        args: ['-e', 'setInterval(() => {}, 1000)'],
        background: true,
      };
    } else if (step < 19) {
      name = 'read_command';
      args = { sessionId: this.sessionId, waitMs: 20 };
    } else if (step === 19) {
      name = 'stop_command';
      args = { sessionId: this.sessionId };
    } else {
      yield { type: 'text-delta', text: 'Command stopped after all requested waits.' };
      yield { type: 'finished', reason: 'stop' };
      return;
    }
    // A forced final turn removes tools. Catch premature loop-budget exhaustion.
    expect(request.tools?.some((tool) => tool.name === name)).toBe(true);
    yield {
      type: 'tool-call',
      toolCall: { id: `call-${step}`, name, argumentsJson: JSON.stringify(args) },
    };
    yield { type: 'finished', reason: 'tool-requests' };
  }
}

interface Harness {
  demoRuns: Map<string, DemoRunState>;
  commandSessions: CommandSessionStore;
  executeKernelRun(runId: RunId): Promise<void>;
}

describe('Runtime command session ownership', () => {
  it('reclaims a background command when Runtime shuts down', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sync-think-command-shutdown-'));
    const runtime = new Runtime({ installId: 'command-shutdown-test', allowNoToken: true });
    const harness = runtime as unknown as Harness;
    const scope = { threadId: 'thread-shutdown', workspaceRoot: root };
    try {
      const result = await harness.commandSessions.start(
        scope,
        {
          command: process.execPath,
          args: ['-e', 'process.stdout.write(String(process.pid)); setInterval(() => {}, 1000)'],
          background: true,
        },
        { runId: 'run-shutdown', callId: 'start' },
      );
      let pid = 0;
      await vi.waitFor(
        async () => {
          pid =
            Number((await harness.commandSessions.read(scope, result.sessionId, 100)).stdout) ||
            pid;
          expect(pid).toBeGreaterThan(0);
        },
        { timeout: 5_000 },
      );
      await runtime.stop();
      await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), { timeout: 5_000 });
      await expect(harness.commandSessions.read(scope, result.sessionId, 0)).rejects.toThrow(
        'not found',
      );
    } finally {
      await runtime.stop();
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('keeps waiting at the work-round limit and stops the same command', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sync-think-command-runtime-'));
    const databasePath = join(root, 'runtime.db');
    await runMigrations(databasePath);
    const connection = await openDatabaseAsync({ path: databasePath });
    const workspaceStore = new SqliteWorkspaceStore(connection.raw);
    const conversationStore = new SqliteConversationStore(connection.raw);
    const stateStore = new SqliteEventCheckpointStore(connection.raw);
    const workspaceId = 'workspace-commands' as WorkspaceId;
    workspaceStore.createWorkspace({
      id: workspaceId,
      name: 'Commands',
      folderPath: root,
      allowedRoots: [root],
    });
    const task = workspaceStore.createTask({
      workspaceId,
      title: 'Commands',
      goal: 'Wait for long commands',
    });
    const conversation = conversationStore.create({
      target: { track: 'model', modelId: 'fake-mini' as ModelId },
      workspaceId,
      title: 'Commands',
    });
    conversationStore.bindTask(conversation.id, task.taskId);
    const provider = new CommandPollingProvider();
    const runtime = new Runtime({
      installId: 'command-runtime-test',
      allowNoToken: true,
      workspaceId,
      checkpointRunId: 'runtime-command-test' as RunId,
      stateStore,
      workspaceStore,
      conversationStore,
      demoProvider: provider,
    });
    const harness = runtime as unknown as Harness;
    const runId = 'run-command-test' as RunId;
    try {
      for (let index = 0; index < 7; index++)
        await writeFile(join(root, `input-${index}.txt`), `unique input ${index}`);
      harness.demoRuns.set(
        runId,
        createDemoRun(runId, task.threadId, 'Run a long command and wait', { kernelId: 'native' }),
      );
      await harness.executeKernelRun(runId);
      expect(provider.calls).toBe(21);
      expect(provider.resultStatuses.filter((status) => status === 'running')).toHaveLength(12);
      expect(provider.resultStatuses.at(-1)).toBe('cancelled');
      expect(
        harness.commandSessions.list({ threadId: task.threadId, workspaceRoot: root }),
      ).toMatchObject([{ sessionId: provider.sessionId, status: 'cancelled' }]);
      expect(stateStore.listEventsByRun(runId).some((event) => event.type === 'run.failed')).toBe(
        false,
      );
      expect(
        stateStore.listEventsByRun(runId).some((event) => event.type === 'run.completed'),
      ).toBe(true);
    } finally {
      await runtime.stop();
      connection.raw.close();
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});
