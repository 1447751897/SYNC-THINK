import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabaseAsync, SqliteDesktopStore, runMigrations } from '@sync-think/storage';
import type {
  DesktopUserInputMonitor,
  DesktopWorker,
  WorkerEvent,
  WorkerToken,
} from '@sync-think/workers';
import { RuntimeDesktopController } from './runtime-desktop-controller.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function createStore(): Promise<{ store: SqliteDesktopStore; close(): void }> {
  const root = mkdtempSync(join(tmpdir(), 'sync-think-runtime-desktop-'));
  tempDirs.push(root);
  const path = join(root, 'sync-think.db');
  await runMigrations(path);
  const connection = await openDatabaseAsync({ path });
  return { store: new SqliteDesktopStore(connection.raw), close: () => connection.raw.close() };
}

class RecordingDesktopWorker implements DesktopWorker {
  readonly kind = 'desktop' as const;
  calls: Array<{ input: Parameters<DesktopWorker['exec']>[0]; token: WorkerToken }> = [];
  beforeExec?: () => void;

  async *exec(
    input: Parameters<DesktopWorker['exec']>[0],
    token: WorkerToken,
  ): AsyncIterable<WorkerEvent> {
    this.calls.push({ input, token });
    this.beforeExec?.();
    yield {
      type: 'completed',
      output: { ok: true, message: 'ok', result: { kind: 'action-completed' } },
    };
  }
}

class FailingDesktopWorker implements DesktopWorker {
  readonly kind = 'desktop' as const;
  calls = 0;
  async *exec(): AsyncIterable<WorkerEvent> {
    this.calls += 1;
    yield {
      type: 'failed',
      failureClass: 'acceptance',
      error: { code: 'desktop.action-failed', message: 'fixture failure' },
    };
  }
}

class BlockingDesktopWorker implements DesktopWorker {
  readonly kind = 'desktop' as const;
  calls = 0;
  started!: () => void;
  readonly startedPromise = new Promise<void>((resolve) => {
    this.started = resolve;
  });

  async *exec(
    _input: Parameters<DesktopWorker['exec']>[0],
    token: WorkerToken,
  ): AsyncIterable<WorkerEvent> {
    this.calls += 1;
    this.started();
    await new Promise<void>((resolve) => {
      if (token.signal?.aborted) return resolve();
      token.signal?.addEventListener('abort', () => resolve(), { once: true });
    });
    yield {
      type: 'failed',
      failureClass: 'permission',
      error: { code: 'desktop.cancelled', message: 'aborted' },
    };
  }
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    capabilityEnabled: true,
    workspaceId: 'workspace-1',
    runId: 'run-1',
    ownerId: 'thread-1',
    idempotencyKey: 'desktop:run-1:tool-1',
    capabilityToken: 'desktop:run-1:tool-1',
    workspaceRoot: process.cwd(),
    toolName: 'desktop_list_windows',
    argumentsJson: '{}',
    ...overrides,
  };
}

const target = {
  window: { processId: 42, nativeWindowHandle: '0x1234', title: 'Fixture' },
  snapshotRevision: 'snapshot-1',
  accessibilityRevision: 'accessibility-1',
  elementIndex: 3,
};

describe('RuntimeDesktopController', () => {
  it('enforces the risk approval matrix and learns trusted metadata from selector resolution', async () => {
    const fixture = await createStore();
    try {
      const worker: DesktopWorker = {
        kind: 'desktop',
        async *exec(input) {
          if (input.action.kind === 'resolve-selector') {
            yield {
              type: 'completed',
              output: {
                ok: true,
                message: 'resolved',
                result: {
                  kind: 'element-resolved',
                  target,
                  element: {
                    index: 3,
                    name: 'Apply',
                    automationId: 'ApplyButton',
                    controlType: 'Button',
                    processId: 42,
                    enabled: true,
                    offscreen: false,
                    isPassword: false,
                    supportedPatterns: ['Invoke'],
                  },
                },
              },
            };
            return;
          }
          yield {
            type: 'completed',
            output: { ok: true, message: 'ok', result: { kind: 'action-completed' } },
          };
        },
      };
      const controller = new RuntimeDesktopController({ worker, store: fixture.store });
      const invokeArgs = JSON.stringify({ target });

      expect(
        controller.evaluatePermission({
          executionMode: 'workspace',
          toolName: 'desktop_launch_app',
          argumentsJson: JSON.stringify({ application: 'notepad.exe' }),
        }),
      ).toMatchObject({ decision: 'allow', risk: { level: 'display' } });
      expect(
        controller.evaluatePermission({
          executionMode: 'ask',
          toolName: 'desktop_launch_app',
          argumentsJson: JSON.stringify({ application: 'notepad.exe' }),
        }),
      ).toMatchObject({ decision: 'approval-required', risk: { level: 'display' } });
      expect(
        controller.evaluatePermission({
          executionMode: 'full-access',
          toolName: 'desktop_launch_app',
          argumentsJson: JSON.stringify({ application: 'D:\\Tools\\custom.exe' }),
        }),
      ).toMatchObject({ decision: 'approval-required', risk: { level: 'sensitive' } });

      expect(
        controller.evaluatePermission({
          executionMode: 'workspace',
          toolName: 'desktop_invoke_element',
          argumentsJson: invokeArgs,
        }),
      ).toMatchObject({ decision: 'approval-required', risk: { level: 'sensitive' } });
      expect(
        controller.evaluatePermission({
          executionMode: 'full-access',
          toolName: 'desktop_invoke_element',
          argumentsJson: invokeArgs,
        }),
      ).toMatchObject({ decision: 'approval-required', risk: { level: 'sensitive' } });

      await controller.execute(
        baseInput({
          idempotencyKey: 'desktop:run-1:resolve-1',
          capabilityToken: 'desktop:run-1:resolve-1',
          toolName: 'desktop_resolve_selector',
          argumentsJson: JSON.stringify({
            target: {
              window: target.window,
              snapshotRevision: target.snapshotRevision,
              accessibilityRevision: target.accessibilityRevision,
            },
            selector: { automationId: 'ApplyButton', controlType: 'Button' },
          }),
        }),
      );

      expect(
        controller.evaluatePermission({
          executionMode: 'workspace',
          toolName: 'desktop_invoke_element',
          argumentsJson: invokeArgs,
        }),
      ).toMatchObject({ decision: 'allow', risk: { level: 'display' } });
      expect(
        controller.evaluatePermission({
          executionMode: 'ask',
          toolName: 'desktop_invoke_element',
          argumentsJson: invokeArgs,
        }),
      ).toMatchObject({ decision: 'approval-required', risk: { level: 'display' } });
    } finally {
      fixture.close();
    }
  });

  it('does not carry resolved selector trust across a Runtime controller restart', async () => {
    const fixture = await createStore();
    try {
      const worker: DesktopWorker = {
        kind: 'desktop',
        async *exec(input) {
          if (input.action.kind === 'resolve-selector') {
            yield {
              type: 'completed',
              output: {
                ok: true,
                message: 'resolved',
                result: {
                  kind: 'element-resolved',
                  target,
                  element: {
                    index: 3,
                    name: 'Input value',
                    automationId: 'InputText',
                    controlType: 'Edit',
                    processId: 42,
                    enabled: true,
                    offscreen: false,
                    isPassword: false,
                    supportedPatterns: ['Value'],
                  },
                },
              },
            };
            return;
          }
          yield {
            type: 'completed',
            output: { ok: true, message: 'ok', result: { kind: 'action-completed' } },
          };
        },
      };
      const firstController = new RuntimeDesktopController({ worker, store: fixture.store });
      await firstController.execute(
        baseInput({
          idempotencyKey: 'desktop:run-1:resolve-before-restart',
          capabilityToken: 'desktop:run-1:resolve-before-restart',
          toolName: 'desktop_resolve_selector',
          argumentsJson: JSON.stringify({
            target: {
              window: target.window,
              snapshotRevision: target.snapshotRevision,
              accessibilityRevision: target.accessibilityRevision,
            },
            selector: { automationId: 'InputText', controlType: 'Edit' },
          }),
        }),
      );
      const setValueArguments = JSON.stringify({ target, value: 'fixture value' });
      expect(
        firstController.evaluatePermission({
          executionMode: 'full-access',
          toolName: 'desktop_set_value',
          argumentsJson: setValueArguments,
        }),
      ).toMatchObject({ decision: 'allow', risk: { level: 'display' } });

      const restartedController = new RuntimeDesktopController({ worker, store: fixture.store });
      expect(
        restartedController.evaluatePermission({
          executionMode: 'full-access',
          toolName: 'desktop_set_value',
          argumentsJson: setValueArguments,
        }),
      ).toMatchObject({
        decision: 'approval-required',
        risk: { level: 'sensitive', reasonCodes: ['target-metadata-unavailable'] },
      });
      const result = JSON.parse(
        await restartedController.execute(
          baseInput({
            idempotencyKey: 'desktop:run-1:set-after-restart',
            capabilityToken: 'desktop:run-1:set-after-restart',
            executionMode: 'full-access',
            toolName: 'desktop_set_value',
            argumentsJson: setValueArguments,
          }),
        ),
      ) as { code: string };
      expect(result.code).toBe('desktop.approval-required');
      expect(
        fixture.store.getCommandByIdempotencyKey('desktop:run-1:set-after-restart'),
      ).toBeUndefined();
    } finally {
      fixture.close();
    }
  });

  it('requires a real approval for human-only desktop actions even in full-access mode', async () => {
    const fixture = await createStore();
    try {
      const worker: DesktopWorker = {
        kind: 'desktop',
        async *exec(input) {
          if (input.action.kind === 'resolve-selector') {
            yield {
              type: 'completed',
              output: {
                ok: true,
                message: 'resolved',
                result: {
                  kind: 'element-resolved',
                  target,
                  element: {
                    index: 3,
                    name: 'Delete account',
                    automationId: 'DeleteAccountButton',
                    controlType: 'Button',
                    processId: 42,
                    enabled: true,
                    offscreen: false,
                    isPassword: false,
                    supportedPatterns: ['Invoke'],
                  },
                },
              },
            };
            return;
          }
          yield {
            type: 'completed',
            output: { ok: true, message: 'ok', result: { kind: 'action-completed' } },
          };
        },
      };
      const controller = new RuntimeDesktopController({ worker, store: fixture.store });
      await controller.execute(
        baseInput({
          idempotencyKey: 'desktop:run-1:resolve-delete',
          capabilityToken: 'desktop:run-1:resolve-delete',
          toolName: 'desktop_resolve_selector',
          argumentsJson: JSON.stringify({
            target: {
              window: target.window,
              snapshotRevision: target.snapshotRevision,
              accessibilityRevision: target.accessibilityRevision,
            },
            selector: { automationId: 'DeleteAccountButton', controlType: 'Button' },
          }),
        }),
      );

      const invokeInput = baseInput({
        idempotencyKey: 'desktop:run-1:delete',
        capabilityToken: 'desktop:run-1:delete',
        executionMode: 'full-access',
        toolName: 'desktop_invoke_element',
        argumentsJson: JSON.stringify({ target }),
      });
      const blocked = JSON.parse(await controller.execute(invokeInput)) as { code: string };
      expect(blocked.code).toBe('desktop.approval-required');
      expect(fixture.store.getCommandByIdempotencyKey('desktop:run-1:delete')).toBeUndefined();

      const approved = JSON.parse(
        await controller.execute({ ...invokeInput, approval: { approvalId: 'approval-1' } }),
      ) as { ok: boolean };
      expect(approved.ok).toBe(true);
    } finally {
      fixture.close();
    }
  });

  it('persists the durable command and intent before invoking the worker', async () => {
    const fixture = await createStore();
    try {
      const worker = new RecordingDesktopWorker();
      let intentPersisted = false;
      worker.beforeExec = () => {
        const command = fixture.store.getCommandByIdempotencyKey('desktop:run-1:tool-1');
        expect(command?.state).toBe('running');
        expect(intentPersisted).toBe(true);
      };
      const controller = new RuntimeDesktopController({ worker, store: fixture.store });
      const result = JSON.parse(
        await controller.execute({
          ...baseInput(),
          beforeExecute: (intent) => {
            expect(intent.commandId).toBeTruthy();
            expect(intent.action.kind).toBe('list-windows');
            intentPersisted = true;
          },
        }),
      ) as { ok: boolean; commandId: string };

      expect(result.ok).toBe(true);
      expect(result.commandId).toBeTruthy();
      expect(fixture.store.getCommand(result.commandId)?.state).toBe('completed');
    } finally {
      fixture.close();
    }
  });

  it('persists only a digest and length for set-value text', async () => {
    const fixture = await createStore();
    try {
      const worker = new RecordingDesktopWorker();
      const controller = new RuntimeDesktopController({
        worker,
        store: fixture.store,
        userInputMonitor: { sample: () => 100 },
      });
      const secretValue = 'not-for-durable-storage';
      await controller.execute(
        baseInput({
          toolName: 'desktop_set_value',
          argumentsJson: JSON.stringify({ target, value: secretValue }),
          approval: { approvalId: 'approval-set-value' },
        }),
      );

      const command = fixture.store.getCommandByIdempotencyKey('desktop:run-1:tool-1');
      expect(JSON.stringify(command?.sanitizedArgs)).not.toContain(secretValue);
      expect(command?.sanitizedArgs).toMatchObject({
        kind: 'set-value',
        valueLength: secretValue.length,
      });
      expect(command?.sanitizedArgs.valueDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(worker.calls[0]?.input.action).toMatchObject({ value: secretValue });
    } finally {
      fixture.close();
    }
  });

  it('replays a completed command without invoking the worker twice', async () => {
    const fixture = await createStore();
    try {
      const worker = new RecordingDesktopWorker();
      const controller = new RuntimeDesktopController({ worker, store: fixture.store });
      const first = JSON.parse(await controller.execute(baseInput())) as { commandId: string };
      const replay = JSON.parse(await controller.execute(baseInput())) as {
        commandId: string;
        replayed: boolean;
      };

      expect(replay).toMatchObject({ commandId: first.commandId, replayed: true });
      expect(worker.calls).toHaveLength(1);
    } finally {
      fixture.close();
    }
  });

  it('does not retry a persisted failed command', async () => {
    const fixture = await createStore();
    try {
      const worker = new FailingDesktopWorker();
      const controller = new RuntimeDesktopController({ worker, store: fixture.store });
      const first = JSON.parse(await controller.execute(baseInput())) as { code: string };
      const replay = JSON.parse(await controller.execute(baseInput())) as { code: string };

      expect(first.code).toBe('desktop.action-failed');
      expect(replay.code).toBe('desktop.action-failed');
      expect(worker.calls).toBe(1);
    } finally {
      fixture.close();
    }
  });

  it('aborts a mutating action and waits for inspection when user input changes', async () => {
    const fixture = await createStore();
    try {
      let tick = 100;
      const monitor: DesktopUserInputMonitor = { sample: () => tick };
      const worker = new BlockingDesktopWorker();
      const controller = new RuntimeDesktopController({
        worker,
        store: fixture.store,
        userInputMonitor: monitor,
        inputPollIntervalMs: 5,
      });
      const execution = controller.execute(
        baseInput({
          toolName: 'desktop_invoke_element',
          argumentsJson: JSON.stringify({ target }),
          approval: { approvalId: 'approval-user-input' },
        }),
      );
      await worker.startedPromise;
      tick = 101;
      const result = JSON.parse(await execution) as {
        ok: boolean;
        code: string;
        commandId: string;
      };

      expect(result).toMatchObject({ ok: false, code: 'desktop.user-input-detected' });
      expect(fixture.store.getCommand(result.commandId)).toMatchObject({
        state: 'waiting_user',
        errorCode: 'desktop.user-input-detected',
      });
    } finally {
      fixture.close();
    }
  });

  it('does not require the user-input monitor for observation tools', async () => {
    const fixture = await createStore();
    try {
      const monitor: DesktopUserInputMonitor = {
        sample: () => {
          throw new Error('must not sample');
        },
      };
      const worker = new RecordingDesktopWorker();
      const controller = new RuntimeDesktopController({
        worker,
        store: fixture.store,
        userInputMonitor: monitor,
      });

      const result = JSON.parse(await controller.execute(baseInput())) as { ok: boolean };
      expect(result.ok).toBe(true);
      expect(worker.calls).toHaveLength(1);
    } finally {
      fixture.close();
    }
  });

  it('blocks a late-disabled capability before reserving a command', async () => {
    const fixture = await createStore();
    try {
      const worker = new RecordingDesktopWorker();
      const controller = new RuntimeDesktopController({ worker, store: fixture.store });
      const result = JSON.parse(
        await controller.execute(baseInput({ capabilityEnabled: false })),
      ) as { code: string };

      expect(result.code).toBe('desktop.capability-disabled');
      expect(worker.calls).toHaveLength(0);
      expect(fixture.store.getCommandByIdempotencyKey('desktop:run-1:tool-1')).toBeUndefined();
    } finally {
      fixture.close();
    }
  });
});
