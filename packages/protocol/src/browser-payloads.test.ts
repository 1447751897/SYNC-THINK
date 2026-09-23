import { describe, expect, it } from 'vitest';
import {
  tryParseApproveExecuteBrowserWorkflowPayload,
  tryParseCreateBrowserProfilePayload,
  tryParseExecuteBrowserWorkflowPayload,
  tryParseStartBrowserRecordingPayload,
} from './browser-payloads.js';

describe('shared browser payload parsing', () => {
  it('normalizes browser profile and recording payloads', () => {
    expect(tryParseCreateBrowserProfilePayload({ name: ' Work ' })).toEqual({ name: 'Work' });
    expect(
      tryParseStartBrowserRecordingPayload({
        profileId: 'profile-1',
        expectedProfileRevision: 2,
        startUrl: ' https://example.test/path ',
      }),
    ).toEqual({
      profileId: 'profile-1',
      expectedProfileRevision: 2,
      startUrl: 'https://example.test/path',
    });
  });

  it('applies one workflow variable boundary to execute and approve paths', () => {
    const exactName = 'n'.repeat(512);
    const exactValue = 'v'.repeat(4_000);
    expect(
      tryParseExecuteBrowserWorkflowPayload({
        taskId: 'task-1',
        variables: { [exactName]: exactValue },
      }),
    ).toEqual({ taskId: 'task-1', variables: { [exactName]: exactValue } });
    expect(
      tryParseExecuteBrowserWorkflowPayload({
        taskId: 'task-1',
        variables: { ['n'.repeat(513)]: 'value' },
      }),
    ).toBeUndefined();
    expect(
      tryParseApproveExecuteBrowserWorkflowPayload({
        taskId: 'task-1',
        origins: ['https://example.test'],
        variables: { name: 'v'.repeat(4_001) },
      }),
    ).toBeUndefined();
  });
});
