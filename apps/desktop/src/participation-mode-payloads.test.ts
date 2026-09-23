import { describe, expect, it } from 'vitest';
import { parseModeSetPayload } from './participation-mode-payloads.js';

describe('Participation Mode payload validation', () => {
  it.each(['conversation', 'collaboration', 'automatic'] as const)(
    'accepts %s mode with optimistic task version fencing',
    (mode) => {
      expect(
        parseModeSetPayload({
          taskId: '01J00000000000000000000001',
          mode,
          expectedTaskVersion: 4,
        }),
      ).toEqual({ taskId: '01J00000000000000000000001', mode, expectedTaskVersion: 4 });
    },
  );

  it('rejects invalid modes and versions', () => {
    expect(() =>
      parseModeSetPayload({ taskId: 'task-1', mode: 'manual', expectedTaskVersion: 4 }),
    ).toThrow(/Invalid mode-set payload/);
    expect(() =>
      parseModeSetPayload({ taskId: 'task-1', mode: 'automatic', expectedTaskVersion: -1 }),
    ).toThrow(/Invalid mode-set payload/);
  });

  it('rejects renderer authority claims and secret-like fields', () => {
    expect(() =>
      parseModeSetPayload({
        taskId: 'task-1',
        mode: 'automatic',
        expectedTaskVersion: 4,
        approvedPlan: true,
      }),
    ).toThrow(/Invalid mode-set payload/);
    expect(() =>
      parseModeSetPayload({
        taskId: 'task-1',
        mode: 'collaboration',
        expectedTaskVersion: 4,
        accessToken: 'plaintext',
      }),
    ).toThrow(/secret-like|Invalid mode-set payload/);
  });
});
