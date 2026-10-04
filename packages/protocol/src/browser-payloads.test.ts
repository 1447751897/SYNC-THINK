import { describe, expect, it } from 'vitest';
import {
  tryParseApproveExecuteBrowserWorkflowPayload,
  tryParseCreateBrowserProfilePayload,
  tryParseExecuteBrowserWorkflowPayload,
  tryParseStartBrowserRecordingPayload,
  tryParseUpdateBrowserWorkflowSchedulePayload,
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

it('accepts bounded non-sensitive workflow schedule parameters and preserves revision', () => {
  const payload = {
    taskId: 'flow-1',
    enabled: true,
    intervalMinutes: 30,
    expectedRevision: 2,
    variables: { keyword: '裤子' },
  };
  expect(tryParseUpdateBrowserWorkflowSchedulePayload(payload)).toEqual(payload);
  for (const variables of [
    { password: 'credential' },
    { cookie: 'session' },
    { token: 'secret' },
    { keyword: 42 },
    { keyword: 'x'.repeat(4001) },
    Object.fromEntries(Array.from({ length: 51 }, (_, i) => ['k' + i, 'value'])),
  ])
    expect(tryParseUpdateBrowserWorkflowSchedulePayload({ ...payload, variables })).toBeUndefined();
});
