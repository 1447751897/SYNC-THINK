import { BROWSER_RECORDING_MAX_URL_CHARS } from '@sync-think/shared';
import { describe, expect, it } from 'vitest';
import {
  parseApproveExecuteBrowserWorkflowPayload,
  parseCreateBrowserWorkflowDraftPayload,
  parseCreateBrowserWorkflowRevisionDraftPayload,
  parseExecuteBrowserWorkflowPayload,
  parseGetBrowserWorkflowPayload,
  parseListBrowserWorkflowsPayload,
  parseReviewBrowserWorkflowDraftPayload,
  parseSubmitBrowserWorkflowDraftPayload,
} from './browser-workflow-payloads.js';

describe('Desktop Browser Workflow IPC payloads', () => {
  it('normalizes valid workflow payloads', () => {
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
        startUrl: ' https://example.test/reports?secret=kept-until-runtime ',
        source: 'ai',
      }),
    ).toEqual({
      profileId: 'profile-1',
      name: 'Monthly report',
      instruction: 'Export the report and download it.',
      startUrl: 'https://example.test/reports?secret=kept-until-runtime',
      source: 'ai',
    });
    expect(
      parseCreateBrowserWorkflowRevisionDraftPayload({
        taskId: 'task-1',
        expectedTaskRevision: 3,
      }),
    ).toEqual({ taskId: 'task-1', expectedTaskRevision: 3 });
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
    expect(parseExecuteBrowserWorkflowPayload({ taskId: 'task-1' })).toEqual({
      taskId: 'task-1',
    });
    expect(
      parseExecuteBrowserWorkflowPayload({
        taskId: 'task-1',
        variables: { keyword: ' cat names ' },
      }),
    ).toEqual({ taskId: 'task-1', variables: { keyword: ' cat names ' } });
    expect(
      parseApproveExecuteBrowserWorkflowPayload({
        taskId: 'task-1',
        origins: [' https://yucoder.cn ', 'https://example.test/', 'https://yucoder.cn'],
      }),
    ).toEqual({
      taskId: 'task-1',
      origins: ['https://yucoder.cn', 'https://example.test/'],
    });
    expect(
      parseApproveExecuteBrowserWorkflowPayload({
        taskId: 'task-1',
        origins: ['https://yucoder.cn'],
        variables: { keyword: 'cat' },
      }),
    ).toEqual({
      taskId: 'task-1',
      origins: ['https://yucoder.cn'],
      variables: { keyword: 'cat' },
    });
  });

  it('accepts exact boundaries and optional list filters', () => {
    const exactId = 'i'.repeat(256);
    const urlPrefix = 'https://example.test/';
    const exactUrl = `${urlPrefix}${'a'.repeat(BROWSER_RECORDING_MAX_URL_CHARS - urlPrefix.length)}`;

    expect(parseListBrowserWorkflowsPayload({})).toEqual({});
    expect(parseListBrowserWorkflowsPayload({ limit: 1 })).toEqual({ limit: 1 });
    expect(
      parseCreateBrowserWorkflowDraftPayload({
        profileId: exactId,
        name: 'n'.repeat(120),
        instruction: 'i'.repeat(4_000),
        startUrl: exactUrl,
        source: 'manual',
      }),
    ).toEqual({
      profileId: exactId,
      name: 'n'.repeat(120),
      instruction: 'i'.repeat(4_000),
      startUrl: exactUrl,
      source: 'manual',
    });
    expect(
      parseReviewBrowserWorkflowDraftPayload({
        draftId: exactId,
        decision: 'approve',
        note: 'n'.repeat(2_000),
      }),
    ).toEqual({
      draftId: exactId,
      decision: 'approve',
      note: 'n'.repeat(2_000),
    });
  });

  it('rejects extra keys, malformed identifiers, enums, and unsafe pagination', () => {
    expect(() => parseListBrowserWorkflowsPayload(undefined)).toThrow();
    expect(() => parseListBrowserWorkflowsPayload({ status: 'running' })).toThrow();
    expect(() => parseListBrowserWorkflowsPayload({ query: 'x'.repeat(201) })).toThrow();
    expect(() => parseListBrowserWorkflowsPayload({ limit: 0 })).toThrow();
    expect(() => parseListBrowserWorkflowsPayload({ limit: 101 })).toThrow();
    expect(() => parseGetBrowserWorkflowPayload({ taskId: 'task 1' })).toThrow();
    expect(() =>
      parseCreateBrowserWorkflowRevisionDraftPayload({
        taskId: 'task-1',
        expectedTaskRevision: 0,
      }),
    ).toThrow();
    expect(() =>
      parseSubmitBrowserWorkflowDraftPayload({
        draftId: 'draft-1',
        recordingId: 'recording-1',
        extra: true,
      }),
    ).toThrow();
    expect(() => parseExecuteBrowserWorkflowPayload(undefined)).toThrow();
    expect(() => parseExecuteBrowserWorkflowPayload({ taskId: 'task 1' })).toThrow();
    expect(() =>
      parseExecuteBrowserWorkflowPayload({ taskId: 'task-1', variables: { keyword: 42 } }),
    ).toThrow();
    expect(() =>
      parseApproveExecuteBrowserWorkflowPayload({ taskId: 'task-1', origins: [] }),
    ).toThrow();
    expect(() =>
      parseApproveExecuteBrowserWorkflowPayload({ taskId: 'task-1', origins: ['ftp://x.test'] }),
    ).toThrow();
    expect(() =>
      parseApproveExecuteBrowserWorkflowPayload({
        taskId: 'task-1',
        origins: ['https://yucoder.cn'],
        variables: { keyword: 42 },
      }),
    ).toThrow();
    expect(() =>
      parseApproveExecuteBrowserWorkflowPayload({
        taskId: 'task-1',
        origins: ['https://yucoder.cn'],
        extra: true,
      }),
    ).toThrow();
  });

  it('rejects empty or oversized text and unsupported URLs', () => {
    const validPrefix = 'https://example.test/';
    const overlongUrl = `${validPrefix}${'a'.repeat(
      BROWSER_RECORDING_MAX_URL_CHARS - validPrefix.length + 1,
    )}`;
    for (const startUrl of [
      'file:///C:/secret.txt',
      'ftp://example.test/file',
      'bad url',
      overlongUrl,
    ]) {
      expect(() =>
        parseCreateBrowserWorkflowDraftPayload({
          profileId: 'profile-1',
          name: 'Task',
          instruction: 'Do something',
          startUrl,
          source: 'manual',
        }),
      ).toThrow();
    }
    expect(() =>
      parseCreateBrowserWorkflowDraftPayload({
        profileId: 'profile-1',
        name: '',
        instruction: 'Do something',
        startUrl: 'https://example.test',
        source: 'manual',
      }),
    ).toThrow();
    expect(() =>
      parseReviewBrowserWorkflowDraftPayload({
        draftId: 'draft-1',
        decision: 'approve',
        note: '   ',
      }),
    ).toThrow();
  });
});
