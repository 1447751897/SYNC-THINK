import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabaseAsync, runMigrations, SqliteBrowserStore } from '@sync-think/storage';
import type { BrowserAction, BrowserHostLike, BrowserLeaseInfo } from '@sync-think/workers';
import { BrowserWorkflowRunner } from './runtime-browser-workflow-runner.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'sync-think-browser-workflow-runner-'));
  tempDirs.push(root);
  const databasePath = join(root, 'sync-think.db');
  await runMigrations(databasePath);
  const connection = await openDatabaseAsync({ path: databasePath });
  const store = new SqliteBrowserStore(connection.raw);
  return { connection, store };
}

function createStoppedRecording(
  store: SqliteBrowserStore,
  id: string,
  extraSteps: Parameters<SqliteBrowserStore['appendRecordingStep']>[0]['step'][] = [],
): void {
  store.createRecording({
    id,
    profileId: 'default',
    ownerId: `recording:${id}`,
    expectedProfileRevision: 1,
  });
  store.markRecordingStarted({ id, leaseId: `lease:${id}`, pageId: `page:${id}` });
  store.appendRecordingStep({
    recordingId: id,
    step: { kind: 'navigate', url: 'https://example.test/reports' },
  });
  store.appendRecordingStep({
    recordingId: id,
    step: { kind: 'click', locator: { strategy: 'css', value: 'button.export' } },
  });
  for (const step of extraSteps) {
    store.appendRecordingStep({ recordingId: id, step });
  }
  store.beginRecordingStop(id, { stopReason: 'user' });
  store.finishRecording(id, { status: 'stopped', stopReason: 'user' });
}

async function publishWorkflow(
  store: SqliteBrowserStore,
  name = 'Export report',
  extraSteps: Parameters<SqliteBrowserStore['appendRecordingStep']>[0]['step'][] = [],
): Promise<{ taskId: string; versionId: string; profileId: string }> {
  // Create a profile row (migration seeds 'default').
  const draft = store.createAutomationTaskDraft({
    profileId: 'default',
    name,
    instruction: 'Export it.',
    startUrl: 'https://example.test/reports',
    source: 'manual',
  });
  createStoppedRecording(store, 'workflow-recording', extraSteps);
  store.attachWorkflowDraftRecording({ draftId: draft.draft.id, recordingId: 'workflow-recording' });
  store.submitWorkflowDraft({ draftId: draft.draft.id, recordingId: 'workflow-recording' });
  const reviewed = store.reviewWorkflowDraft({
    draftId: draft.draft.id,
    decision: 'approve',
    note: 'Approved',
  });
  return {
    taskId: draft.task.id,
    versionId: reviewed.version!.id,
    profileId: 'default',
  };
}

function makeFakeHost(executed: BrowserAction[]): BrowserHostLike {
  return {
    async acquireLease(input: {
      profileId: string;
      ownerId: string;
      mode?: 'command' | 'recording';
    }): Promise<BrowserLeaseInfo> {
      return {
        leaseId: `lease:${input.ownerId}`,
        pageId: `page:${input.ownerId}`,
        profileId: input.profileId,
        ownerId: input.ownerId,
      };
    },
    async inspectLease(leaseId: string): Promise<BrowserLeaseInfo> {
      throw new Error(`unexpected inspectLease ${leaseId}`);
    },
    async execute(input: { leaseId: string; action: BrowserAction }): Promise<{
      ok: true;
      message: string;
      url: string;
      title: string;
      leaseId: string;
      pageId: string;
      profileId: string;
      ownerId: string;
    }> {
      executed.push(input.action);
      const url =
        input.action.kind === 'navigate'
          ? input.action.url
          : 'https://example.test/reports';
      return {
        ok: true,
        message: `${input.action.kind} completed`,
        url,
        title: input.action.kind,
        leaseId: input.leaseId,
        pageId: `page:${input.leaseId}`,
        profileId: 'default',
        ownerId: 'owner',
      };
    },
    async releaseLease(leaseId: string): Promise<void> {
      void leaseId;
    },
    async shutdown(): Promise<void> {
      // no-op
    },
  };
}

describe('BrowserWorkflowRunner', () => {
  it('rejects a missing version', async () => {
    const f = await fixture();
    const runner = new BrowserWorkflowRunner({ store: f.store, host: makeFakeHost([]) });
    await expect(
      runner.replay({
        workflowVersionId: 'missing',
        taskId: 'task',
        profileId: 'default',
        workspaceId: 'ws',
        ownerId: 'owner',
        capabilityToken: 'tok',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('Browser Workflow Version does not exist');
    f.connection.raw.close();
  });

  it('requires workflow-scope grants before replaying', async () => {
    const f = await fixture();
    const workflow = await publishWorkflow(f.store);
    const runner = new BrowserWorkflowRunner({ store: f.store, host: makeFakeHost([]) });
    // No grant yet -> replay must throw permission error.
    await expect(
      runner.replay({
        workflowVersionId: workflow.versionId,
        taskId: workflow.taskId,
        profileId: workflow.profileId,
        workspaceId: 'ws',
        ownerId: 'owner',
        capabilityToken: 'tok',
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      code: 'browser.workflow-origin-grant-required',
      failureClass: 'permission',
    });
    f.connection.raw.close();
  });

  it('replays all steps on the persistent page lease after a grant', async () => {
    const f = await fixture();
    const workflow = await publishWorkflow(f.store);
    const executed: BrowserAction[] = [];
    const runner = new BrowserWorkflowRunner({ store: f.store, host: makeFakeHost(executed) });

    // Record a workflow-scope allow grant for the target origin.
    f.store.upsertOriginGrant({
      scopeType: 'workflow',
      scopeId: workflow.taskId,
      origin: 'https://example.test',
      action: 'navigate',
      decision: 'allow',
      approvalId: 'approval:test',
    });

    const result = await runner.replay({
      workflowVersionId: workflow.versionId,
      taskId: workflow.taskId,
      profileId: workflow.profileId,
      workspaceId: 'ws',
      ownerId: 'owner',
      capabilityToken: 'tok',
      signal: new AbortController().signal,
    });

    expect(result.ok).toBe(true);
    expect(result.stepCount).toBe(2);
    expect(result.executedStepCount).toBe(2);
    expect(result.steps.map((step) => step.ok)).toEqual([true, true]);
    expect(executed).toHaveLength(2);
    expect(executed[0]).toMatchObject({ kind: 'navigate', url: 'https://example.test/reports' });
    expect(executed[1]).toMatchObject({ kind: 'click', selector: 'button.export' });
    f.connection.raw.close();
  });

  it('records approval for missing origins', async () => {
    const f = await fixture();
    const workflow = await publishWorkflow(f.store);
    const runner = new BrowserWorkflowRunner({ store: f.store, host: makeFakeHost([]) });
    const permission = runner.checkPermissions(workflow.versionId, workflow.taskId);
    expect(permission.allowed).toBe(false);
    expect(permission.missingOrigins).toEqual(['https://example.test']);

    runner.recordApproval(workflow.taskId, permission.missingOrigins, 'approval:test');
    const after = runner.checkPermissions(workflow.versionId, workflow.taskId);
    expect(after.allowed).toBe(true);
    f.connection.raw.close();
  });

  it('rejects replay when a referenced variable has no value', async () => {
    const f = await fixture();
    const workflow = await publishWorkflow(f.store, 'Variable export', [
      {
        kind: 'fill',
        locator: { strategy: 'placeholder', value: 'Search' },
        value: { kind: 'variable', name: 'keyword' },
      },
    ]);
    const runner = new BrowserWorkflowRunner({ store: f.store, host: makeFakeHost([]) });
    // Grant the origin so the permission gate passes and the test reaches the
    // variable gate (permission is checked first, which is the intended order).
    f.store.upsertOriginGrant({
      scopeType: 'workflow',
      scopeId: workflow.taskId,
      origin: 'https://example.test',
      action: 'navigate',
      decision: 'allow',
      approvalId: 'approval:test',
    });
    await expect(
      runner.replay({
        workflowVersionId: workflow.versionId,
        taskId: workflow.taskId,
        profileId: workflow.profileId,
        workspaceId: 'ws',
        ownerId: 'owner',
        capabilityToken: 'tok',
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      code: 'browser.workflow-variables-required',
      failureClass: 'acceptance',
    });
    f.connection.raw.close();
  });

  it('fills variable-marked inputs with provided values during replay', async () => {
    const f = await fixture();
    const workflow = await publishWorkflow(f.store, 'Variable export', [
      {
        kind: 'fill',
        locator: { strategy: 'placeholder', value: 'Search' },
        value: { kind: 'variable', name: 'keyword' },
      },
    ]);
    const executed: BrowserAction[] = [];
    const runner = new BrowserWorkflowRunner({ store: f.store, host: makeFakeHost(executed) });
    f.store.upsertOriginGrant({
      scopeType: 'workflow',
      scopeId: workflow.taskId,
      origin: 'https://example.test',
      action: 'navigate',
      decision: 'allow',
      approvalId: 'approval:test',
    });
    const result = await runner.replay({
      workflowVersionId: workflow.versionId,
      taskId: workflow.taskId,
      profileId: workflow.profileId,
      workspaceId: 'ws',
      ownerId: 'owner',
      capabilityToken: 'tok',
      signal: new AbortController().signal,
      variables: { keyword: 'cat names' },
    });
    expect(result.ok).toBe(true);
    expect(result.steps).toHaveLength(3);
    expect(executed).toHaveLength(3);
    expect(executed[2]).toMatchObject({
      kind: 'fill',
      selector: '[placeholder="Search"]',
      text: 'cat names',
    });
    f.connection.raw.close();
  });
});
