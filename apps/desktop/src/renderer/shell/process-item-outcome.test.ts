import { describe, expect, it } from 'vitest';
import type { InlineProcessItem } from './ChatView.js';
import { reconcileProcessItemOutcomes } from './process-item-outcome.js';
const pending: InlineProcessItem = {
  kind: 'tool',
  toolCallId: 'actual',
  name: 'Write',
  argumentsJson: '{}',
  status: 'running',
};
const step = (status: 'running' | 'done' | 'error') => ({
  id: 'actual',
  status,
  label: 'Write',
  verb: 'Edit',
  zh: '写入',
  toolName: 'Write',
  kind: 'write' as const,
  error: status === 'error' ? '审批已失效' : undefined,
});
describe('canonical timeline outcome reconciliation', () => {
  it('settles a restored stale running tool using its exact projected outcome', () => {
    expect(reconcileProcessItemOutcomes([pending], { steps: [step('error')] })).toEqual([
      { ...pending, failed: true, status: 'failed', result: '审批已失效' },
    ]);
  });
  it('preserves prose, tool input and successful output', () => {
    const text: InlineProcessItem = { kind: 'text', text: '保留说明' };
    const completed = {
      ...pending,
      status: 'completed' as const,
      failed: false,
      result: 'written',
    };
    const items = [text, completed];
    expect(reconcileProcessItemOutcomes(items, { steps: [step('done')] })).toBe(items);
  });
  it('never replaces known failure with a success inference', () => {
    expect(
      reconcileProcessItemOutcomes([{ ...pending, failed: true }], { steps: [step('done')] })?.[0],
    ).toMatchObject({ failed: true, status: 'failed' });
  });
  it('does not close an unmatched active tool when only another page is loaded', () => {
    const items = [pending];
    expect(reconcileProcessItemOutcomes(items, { steps: [] })).toBe(items);
  });
  it('ends unreported tools only with an explicit run end', () => {
    expect(
      reconcileProcessItemOutcomes([pending], {
        steps: [],
        completedAt: '2026-09-06T08:00:00Z',
      })?.[0],
    ).toMatchObject({ failed: true, status: 'failed' });
  });
  it('retains the original collection without a process projection', () => {
    const items = [pending];
    expect(reconcileProcessItemOutcomes(items, undefined)).toBe(items);
  });
});
