import { describe, expect, it } from 'vitest';
import {
  parseCreateBrowserWorkflowDraftPayload,
  parseGetBrowserWorkflowPayload,
  parseListBrowserWorkflowsPayload,
  parseReviewBrowserWorkflowDraftPayload,
  parseSubmitBrowserWorkflowDraftPayload,
} from './browser-workflow.js';

describe('Browser workflow command validation', () => {
  it('accepts bounded list, detail, create, submit, and review payloads', () => {
    expect(
      parseListBrowserWorkflowsPayload({
        profileId: 'profile-1',
        status: 'pending_review',
        query: ' monthly report ',
        limit: 50,
      }),
    ).toEqual({
      profileId: 'profile-1',
      status: 'pending_review',
      query: 'monthly report',
      limit: 50,
    });
    expect(parseGetBrowserWorkflowPayload({ taskId: 'task-1' })).toEqual({
      taskId: 'task-1',
    });
    expect(
      parseCreateBrowserWorkflowDraftPayload({
        profileId: 'profile-1',
        name: ' Monthly report ',
        instruction: ' Export the report and download it. ',
        startUrl: ' https://example.test/reports?secret=removed ',
        source: 'ai',
      }),
    ).toEqual({
      profileId: 'profile-1',
      name: 'Monthly report',
      instruction: 'Export the report and download it.',
      startUrl: 'https://example.test/reports?secret=removed',
      source: 'ai',
    });
    expect(
      parseSubmitBrowserWorkflowDraftPayload({
        draftId: 'draft-1',
        recordingId: 'recording-1',
      }),
    ).toEqual({ draftId: 'draft-1', recordingId: 'recording-1' });
    expect(
      parseReviewBrowserWorkflowDraftPayload({
        draftId: 'draft-1',
        decision: 'reject',
        note: ' Please record the final confirmation step. ',
      }),
    ).toEqual({
      draftId: 'draft-1',
      decision: 'reject',
      note: 'Please record the final confirmation step.',
    });
  });

  it('rejects extra keys, invalid enums, oversized text, unsafe URLs, and empty notes', () => {
    expect(parseListBrowserWorkflowsPayload({ status: 'running' })).toBeUndefined();
    expect(parseListBrowserWorkflowsPayload({ query: 'x'.repeat(257) })).toBeUndefined();
    expect(parseGetBrowserWorkflowPayload({ taskId: 'task 1' })).toBeUndefined();
    expect(
      parseCreateBrowserWorkflowDraftPayload({
        profileId: 'profile-1',
        name: '',
        instruction: 'Do something',
        startUrl: 'file:///C:/secret.txt',
        source: 'manual',
      }),
    ).toBeUndefined();
    expect(
      parseSubmitBrowserWorkflowDraftPayload({
        draftId: 'draft-1',
        recordingId: 'recording-1',
        extra: true,
      }),
    ).toBeUndefined();
    expect(
      parseReviewBrowserWorkflowDraftPayload({
        draftId: 'draft-1',
        decision: 'approve',
        note: '   ',
      }),
    ).toBeUndefined();
  });
});
