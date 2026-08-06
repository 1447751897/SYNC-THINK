import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabaseAsync, runMigrations, SqliteBrowserStore } from '@sync-think/storage';
import { RuntimeBrowserWorkflowService } from './runtime-browser-workflow-service.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'sync-think-browser-workflow-service-'));
  tempDirs.push(root);
  const databasePath = join(root, 'sync-think.db');
  await runMigrations(databasePath);
  const connection = await openDatabaseAsync({ path: databasePath });
  const store = new SqliteBrowserStore(connection.raw);
  return {
    connection,
    store,
    service: new RuntimeBrowserWorkflowService({ store }),
  };
}

function createStoppedRecording(store: SqliteBrowserStore, id: string): void {
  store.createRecording({
    id,
    profileId: 'default',
    ownerId: `recording:${id}`,
    expectedProfileRevision: 1,
  });
  store.markRecordingStarted({
    id,
    leaseId: `lease:${id}`,
    pageId: `page:${id}`,
  });
  store.appendRecordingStep({
    recordingId: id,
    step: { kind: 'navigate', url: 'https://example.test/reports?token=removed' },
  });
  store.appendRecordingStep({
    recordingId: id,
    step: {
      kind: 'click',
      locator: { strategy: 'role', role: 'button', name: 'Export' },
    },
  });
  store.beginRecordingStop(id, { stopReason: 'user' });
  store.finishRecording(id, { status: 'stopped', stopReason: 'user' });
}

describe('RuntimeBrowserWorkflowService', () => {
  it('creates and lists a sanitized workflow draft', async () => {
    const f = await fixture();
    try {
      const created = f.service.createDraft({
        profileId: 'default',
        name: 'Monthly report',
        instruction: 'Export the monthly report.',
        startUrl: 'https://example.test/reports?token=secret#section',
        source: 'ai',
      });
      expect(created).toMatchObject({
        task: {
          profileId: 'default',
          name: 'Monthly report',
          startUrl: 'https://example.test/reports',
          source: 'ai',
          status: 'draft',
        },
        draft: { status: 'editing', stepCount: 0, steps: [] },
      });
      expect(f.service.listProfiles()).toMatchObject([
        { id: 'default', isDefault: true, inUse: false },
      ]);
      expect(f.service.listWorkflows({ query: 'monthly' })).toEqual([created.task]);
      expect(JSON.stringify(created)).not.toContain('secret');
    } finally {
      f.connection.raw.close();
    }
  });

  it('returns task, current draft, and published version from one detail query', async () => {
    const f = await fixture();
    try {
      const created = f.service.createDraft({
        profileId: 'default',
        name: 'Export report',
        instruction: 'Export it.',
        startUrl: 'https://example.test/reports',
        source: 'manual',
      });
      createStoppedRecording(f.store, 'workflow-recording');
      f.store.attachWorkflowDraftRecording({
        draftId: created.draft.id,
        recordingId: 'workflow-recording',
      });
      const submitted = f.service.submitDraft({
        draftId: created.draft.id,
        recordingId: 'workflow-recording',
      });
      expect(submitted).toMatchObject({
        task: { status: 'pending_review' },
        draft: { status: 'pending_review', stepCount: 2 },
      });
      const reviewed = f.service.reviewDraft({
        draftId: created.draft.id,
        decision: 'approve',
        note: 'Approved V1.',
      });
      expect(reviewed).toMatchObject({
        task: { status: 'enabled', publishedVersionId: expect.any(String) },
        draft: { status: 'approved' },
        version: { versionNumber: 1, stepCount: 2 },
      });
      expect(f.service.getWorkflow({ taskId: created.task.id })).toMatchObject({
        ...reviewed,
        reviews: [
          {
            draftId: created.draft.id,
            decision: 'approve',
            note: 'Approved V1.',
          },
        ],
        reviewsTruncated: false,
      });

      const revision = f.service.createRevisionDraft({
        taskId: created.task.id,
        expectedTaskRevision: reviewed.task.revision,
      });
      expect(revision).toMatchObject({
        task: {
          id: created.task.id,
          status: 'draft',
          publishedVersionId: reviewed.version!.id,
        },
        draft: { status: 'editing', steps: [], stepCount: 0 },
      });
      createStoppedRecording(f.store, 'workflow-recording-v2');
      f.store.attachWorkflowDraftRecording({
        draftId: revision.draft.id,
        recordingId: 'workflow-recording-v2',
      });
      f.service.submitDraft({
        draftId: revision.draft.id,
        recordingId: 'workflow-recording-v2',
      });
      const reviewedV2 = f.service.reviewDraft({
        draftId: revision.draft.id,
        decision: 'approve',
        note: 'Approved V2.',
      });
      expect(reviewedV2.version).toMatchObject({ versionNumber: 2 });
      expect(f.service.getWorkflow({ taskId: created.task.id })).toMatchObject({
        task: { publishedVersionId: reviewedV2.version!.id },
        version: { versionNumber: 2 },
        reviews: [
          { draftId: created.draft.id, decision: 'approve', note: 'Approved V1.' },
          { draftId: revision.draft.id, decision: 'approve', note: 'Approved V2.' },
        ],
        reviewsTruncated: false,
      });
    } finally {
      f.connection.raw.close();
    }
  });

  it('rejects a pending draft back to an editable task without publishing a version', async () => {
    const f = await fixture();
    try {
      const created = f.service.createDraft({
        profileId: 'default',
        name: 'Needs review',
        instruction: 'Record a complete flow.',
        startUrl: 'https://example.test',
        source: 'manual',
      });
      createStoppedRecording(f.store, 'workflow-reject-recording');
      f.store.attachWorkflowDraftRecording({
        draftId: created.draft.id,
        recordingId: 'workflow-reject-recording',
      });
      f.service.submitDraft({
        draftId: created.draft.id,
        recordingId: 'workflow-reject-recording',
      });
      const rejected = f.service.reviewDraft({
        draftId: created.draft.id,
        decision: 'reject',
        note: 'Add the confirmation step.',
      });
      expect(rejected).toMatchObject({
        task: { status: 'draft' },
        draft: { status: 'rejected', reviewedAt: expect.any(String) },
      });
      expect(rejected.task).not.toHaveProperty('publishedVersionId');
      expect(f.service.getWorkflow({ taskId: created.task.id })).toMatchObject({
        reviews: [
          {
            draftId: created.draft.id,
            decision: 'reject',
            note: 'Add the confirmation step.',
          },
        ],
        reviewsTruncated: false,
      });
    } finally {
      f.connection.raw.close();
    }
  });

  it('reports stable not-found errors for missing tasks and drafts', async () => {
    const f = await fixture();
    try {
      expect(() => f.service.getWorkflow({ taskId: 'missing-task' })).toThrow(
        'browser.workflow-not-found',
      );
      expect(() =>
        f.service.submitDraft({
          draftId: 'missing-draft',
          recordingId: 'missing-recording',
        }),
      ).toThrow('browser.workflow-not-found');
    } finally {
      f.connection.raw.close();
    }
  });
});
