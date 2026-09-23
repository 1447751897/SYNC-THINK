import { describe, expect, it } from 'vitest';
import {
  parseCreateScheduledTaskPayload,
  parseUpdateScheduledTaskPayload,
} from './team-payloads.js';

const rule = {
  kind: 'weekly',
  selection: { mode: 'range', start: 5, end: 1 },
  time: '18:30',
  startDate: '2026-09-22',
};
describe('weekly task IPC payloads', () => {
  it('preserves weekly selection, date and time on create and edit', () => {
    expect(
      parseCreateScheduledTaskPayload({
        name: 'Weekly',
        instruction: 'Review',
        target: { kind: 'model', modelId: 'm' },
        rule,
        timeZone: 'Asia/Shanghai',
      }).rule,
    ).toEqual(rule);
    expect(parseUpdateScheduledTaskPayload({ taskId: 'task', patch: { rule } }).patch.rule).toEqual(
      rule,
    );
  });
  it.each([
    { time: '25:00' },
    { startDate: '2026-02-30' },
    { selection: { mode: 'days', days: [] } },
    { selection: { mode: 'range', start: 1, end: 8 } },
  ])('rejects invalid weekly updates %j', (patch) => {
    expect(() =>
      parseUpdateScheduledTaskPayload({ taskId: 'task', patch: { rule: { ...rule, ...patch } } }),
    ).toThrow();
  });
});
