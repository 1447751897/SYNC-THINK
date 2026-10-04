import { describe, it, expect } from 'vitest';
import {
  parseScheduledTaskRunContext,
  type ScheduledTaskRunContext,
} from './scheduled-task-run-context.js';
const context: ScheduledTaskRunContext = {
  version: 1,
  threadId: 'thread-1',
  firedAt: '2026-10-02T01:00:00Z',
  task: {
    id: 'task-1',
    name: 'Fixture',
    instruction: 'Inspect',
    target: { kind: 'model', modelId: 'model-1' },
    rule: { kind: 'every', intervalMinutes: 5 },
    timeZone: 'Asia/Shanghai',
    enabled: true,
    conversationId: 'conversation-1',
    createdAt: '2026-10-02T00:00:00Z',
    updatedAt: '2026-10-02T00:00:00Z',
  },
};
describe('durable scheduled context boundary', () => {
  it('deeply freezes only the host snapshot after exact thread identity check', () => {
    const parsed = parseScheduledTaskRunContext(context, 'thread-1')!;
    expect(parsed).toEqual(context);
    expect(parsed.task).not.toBe(context.task);
    expect(parseScheduledTaskRunContext(context, 'other-thread')).toBeUndefined();
  });
  it.each([
    { version: 2 },
    { firedAt: 'not-a-date' },
    { daemonDispatched: 'yes' },
    { threadId: '' },
    { task: { ...context.task, timeZone: 'Bad/Zone' } },
    { task: { ...context.task, target: { kind: 'agent' } } },
    { task: { ...context.task, automation: { acceptanceChecks: { minimumRows: 2 } } } },
  ])('rejects malformed recovery state %j', (patch) => {
    expect(parseScheduledTaskRunContext({ ...context, ...patch }, 'thread-1')).toBeUndefined();
  });
  it('retains valid weekly and zero-minimum random rules rather than dropping recovery identity', () => {
    expect(
      parseScheduledTaskRunContext(
        {
          ...context,
          task: {
            ...context.task,
            rule: {
              kind: 'weekly',
              selection: { mode: 'days', days: [1, 5] },
              time: '09:00',
              startDate: '2026-10-02',
            },
          },
        },
        'thread-1',
      ),
    ).toBeDefined();
    expect(
      parseScheduledTaskRunContext(
        {
          ...context,
          task: {
            ...context.task,
            rule: {
              kind: 'random',
              windowStart: '09:00',
              windowEnd: '18:00',
              minTimes: 0,
              maxTimes: 3,
              atLeastOnce: false,
            },
          },
        },
        'thread-1',
      ),
    ).toBeDefined();
  });
});
