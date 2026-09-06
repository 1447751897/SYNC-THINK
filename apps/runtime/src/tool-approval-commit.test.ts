import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteAppSettingStore,
  SqliteEventCheckpointStore,
  SqliteUnitOfWork,
  type EventDraft,
} from '@sync-think/storage';
import type { WorkspaceId } from '@sync-think/shared';
import { commitToolApprovalDecision } from './tool-approval-commit.js';
import { ToolApprovalPolicy } from './tool-approval-policy.js';

const tempDirs: string[] = [];
const sessionRequest = {
  conversationId: 'conversation-a',
  toolName: 'write_file',
  arguments: { path: 'README.md' },
};
const appRequest = {
  conversationId: 'conversation-a',
  toolName: 'mcp__computer-use__computer_click',
  arguments: { app_id: 'calculator.exe' },
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tempDirs.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('commitToolApprovalDecision', () => {
  it('activates session authorization only after the decision has committed', () => {
    const policy = new ToolApprovalPolicy();
    const persistDecision = vi.fn(() => {
      expect(policy.isAllowed(sessionRequest)).toBe(false);
      throw new Error('decision write failed');
    });
    expect(() =>
      commitToolApprovalDecision({
        policy,
        request: sessionRequest,
        decision: 'approve',
        scope: 'session',
        persistDecision,
      }),
    ).toThrow('decision write failed');
    expect(policy.isAllowed(sessionRequest)).toBe(false);
    expect(
      commitToolApprovalDecision({
        policy,
        request: sessionRequest,
        decision: 'approve',
        scope: 'session',
        persistDecision: () => 'committed',
      }),
    ).toBe('committed');
    expect(policy.isAllowed(sessionRequest)).toBe(true);
  });

  it.each(['decision', 'settings', 'success'] as const)(
    'commits the persistent app grant and decision atomically: %s',
    async (failure) => {
      const root = mkdtempSync(join(tmpdir(), 'sync-think-approval-commit-'));
      tempDirs.push(root);
      const path = join(root, 'test.db');
      await runMigrations(path);
      const connection = await openDatabaseAsync({ path });
      try {
        const settings = new SqliteAppSettingStore(connection.raw);
        const policy = new ToolApprovalPolicy(settings);
        const store = new SqliteEventCheckpointStore(connection.raw);
        const transaction = new SqliteUnitOfWork(connection.raw);
        const draft: EventDraft = {
          id: 'decision-id' as EventDraft['id'],
          workspaceId: 'workspace-a' as WorkspaceId,
          type: 'tool.approval_decided',
          category: 'approval',
          occurredAt: '2026-09-05T04:00:00.000Z',
          payload: { approvalId: 'approval-a', decision: 'approve', scope: 'always-app' },
        };
        if (failure === 'settings') {
          const write = settings.set.bind(settings);
          vi.spyOn(settings, 'set').mockImplementation((...args) => {
            write(...args);
            throw new Error('settings write failed');
          });
        }
        const commit = () =>
          commitToolApprovalDecision({
            policy,
            request: appRequest,
            decision: 'approve',
            scope: 'always-app',
            runTransaction: (work) => transaction.run(work),
            persistDecision: () => {
              const result = store.commitTransition({ events: [draft] }).events[0]!;
              if (failure === 'decision') throw new Error('decision write failed');
              return result;
            },
          });
        if (failure === 'success') {
          expect(commit()).toMatchObject({ id: 'decision-id' });
        } else {
          expect(commit).toThrow(`${failure} write failed`);
        }
        expect(policy.isAllowed(appRequest)).toBe(failure === 'success');
        expect(store.listToolApprovalEvents({ approvalId: 'approval-a' })).toHaveLength(
          failure === 'success' ? 1 : 0,
        );
      } finally {
        connection.raw.close();
      }
    },
  );

  it('rejects persistent authorization without a shared transaction', () => {
    const settings = { get: () => undefined, set: vi.fn() };
    const persistDecision = vi.fn();
    expect(() =>
      commitToolApprovalDecision({
        policy: new ToolApprovalPolicy(settings),
        request: appRequest,
        decision: 'approve',
        scope: 'always-app',
        persistDecision,
      }),
    ).toThrow('transaction');
    expect(settings.set).not.toHaveBeenCalled();
    expect(persistDecision).not.toHaveBeenCalled();
  });
});
