import { ErrorCode } from '@sync-think/shared';
import { describe, expect, it } from 'vitest';
import {
  parseDesktopWaitingResult,
  projectDesktopWaitingCommandSummary,
  projectDesktopWaitingTarget,
} from './desktop-waiting-projection.js';

const command = {
  id: 'command-1',
  workspaceId: 'workspace-1',
  runId: 'run-1',
  ownerId: 'thread-1',
  toolName: 'computer_use',
  action: 'click',
  sanitizedArgs: {
    target: { window: { processId: 42, title: 'Fixture settings' } },
  },
  createdAt: '2026-09-20T10:00:00.000Z',
  updatedAt: '2026-09-20T10:01:00.000Z',
};

describe('parseDesktopWaitingResult', () => {
  it.each([ErrorCode.DESKTOP_USER_INPUT_DETECTED, ErrorCode.DESKTOP_COMMAND_INSPECTION_REQUIRED])(
    'accepts the durable waiting code %s',
    (code) => {
      expect(parseDesktopWaitingResult(JSON.stringify({ commandId: 'command-1', code }))).toEqual({
        commandId: 'command-1',
        code,
      });
    },
  );

  it.each([
    '',
    'not-json',
    '[]',
    '{}',
    '{"commandId":1,"code":"desktop.user-input-detected"}',
    '{"commandId":"command-1","code":"desktop.command-failed"}',
  ])('rejects non-waiting result %j', (value) => {
    expect(parseDesktopWaitingResult(value)).toBeUndefined();
  });
});

describe('projectDesktopWaitingTarget', () => {
  it('exposes only normalized public window identity', () => {
    expect(
      projectDesktopWaitingTarget({
        target: {
          window: {
            processId: 42,
            title: '  Fixture settings  ',
            appId: '  fixture.settings  ',
            nativeWindowHandle: 'secret-handle',
          },
          snapshotRevision: 'secret-snapshot',
        },
        value: 'secret-value',
      }),
    ).toEqual({ processId: 42, title: 'Fixture settings', appId: 'fixture.settings' });
  });

  it('bounds public labels and rejects invalid process ids', () => {
    const target = projectDesktopWaitingTarget({
      target: { window: { processId: -1, title: 't'.repeat(600), appId: 'a'.repeat(300) } },
    });
    expect(target).toEqual({ title: 't'.repeat(512), appId: 'a'.repeat(256) });
  });

  it.each([
    {},
    { target: null },
    { target: [] },
    { target: {} },
    { target: { window: [] } },
    { target: { window: { processId: 0, title: '  ', appId: '' } } },
  ])('omits invalid or empty target %j', (value) => {
    expect(projectDesktopWaitingTarget(value)).toBeUndefined();
  });
});

describe('projectDesktopWaitingCommandSummary', () => {
  it('prefers the owner thread task and does not query the run fallback', () => {
    let runQueries = 0;
    const summary = projectDesktopWaitingCommandSummary(command, {
      findTaskByThreadId: () => ({ id: 'task-owner', workspaceId: 'workspace-1' }),
      findRun: () => {
        runQueries += 1;
        return { taskId: 'task-run' };
      },
      findTask: () => ({ id: 'task-run', workspaceId: 'workspace-1' }),
    });

    expect(summary).toEqual({
      commandId: 'command-1',
      workspaceId: 'workspace-1',
      taskId: 'task-owner',
      runId: 'run-1',
      toolName: 'computer_use',
      action: 'click',
      target: { processId: 42, title: 'Fixture settings' },
      reason: 'restart-inspection',
      errorCode: ErrorCode.DESKTOP_COMMAND_INSPECTION_REQUIRED,
      status: 'waiting_user',
      canContinue: true,
      canCancel: true,
      createdAt: '2026-09-20T10:00:00.000Z',
      updatedAt: '2026-09-20T10:01:00.000Z',
    });
    expect(runQueries).toBe(0);
  });

  it('falls back to the run task and maps user-input waiting', () => {
    const summary = projectDesktopWaitingCommandSummary(
      { ...command, errorCode: ErrorCode.DESKTOP_USER_INPUT_DETECTED },
      {
        findTaskByThreadId: () => undefined,
        findRun: () => ({ taskId: 'task-run' }),
        findTask: () => ({ id: 'task-run', workspaceId: 'workspace-1' }),
      },
    );

    expect(summary.taskId).toBe('task-run');
    expect(summary.reason).toBe('user-input-detected');
  });

  it('does not expose a task from another workspace', () => {
    const summary = projectDesktopWaitingCommandSummary(
      { ...command, errorCode: 'desktop.custom-attention' },
      {
        findTaskByThreadId: () => ({ id: 'task-owner', workspaceId: 'workspace-2' }),
        findRun: () => ({ taskId: 'task-run' }),
        findTask: () => ({ id: 'task-run', workspaceId: 'workspace-2' }),
      },
    );

    expect(summary.taskId).toBeUndefined();
    expect(summary.reason).toBe('attention-required');
    expect(summary.errorCode).toBe('desktop.custom-attention');
  });
});
