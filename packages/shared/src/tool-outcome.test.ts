import { describe, expect, it } from 'vitest';
import type { Event } from './types/event.js';
import { isToolResultFailure, projectDeniedToolCalls } from './tool-outcome.js';
function event(type: string, sequence: number, payload: Record<string, unknown>): Event {
  return {
    id: ('event-' + sequence) as Event['id'],
    workspaceId: 'workspace' as Event['workspaceId'],
    runId: 'run' as Event['runId'],
    sequence,
    type,
    category: 'tool',
    occurredAt: String(sequence),
    payload: { threadId: 'thread', ...payload },
  } as Event;
}
const call = (
  id: string,
  sequence: number,
  args: Record<string, unknown> = { path: 'file', content: 'body' },
) =>
  event('tool.requested', sequence, {
    toolCall: { id, name: 'Write', argumentsJson: JSON.stringify(args) },
  });
const approval = (args: Record<string, unknown>) =>
  event('tool.approval_requested', 5, {
    approvalId: 'approval',
    toolCallId: 'legacy-permission',
    toolName: 'Write',
    arguments: args,
  });
const deny = (payload: Record<string, unknown> = {}) =>
  event('tool.approval_decided', 6, {
    approvalId: 'approval',
    decision: 'deny',
    reason: 'stale-approval',
    ...payload,
  });
describe('precise tool approval outcomes', () => {
  it('recovers the unique legacy Claude input with reordered object keys', () => {
    expect(
      projectDeniedToolCalls([
        call('actual', 1),
        approval({ content: 'body', path: 'file' }),
        deny(),
      ]).get('actual')?.error,
    ).toContain('失效');
  });
  it('recovers the native Codex itemId even when permission precedes the tool event', () => {
    expect(
      projectDeniedToolCalls([
        approval({ itemId: 'actual' }),
        call('actual', 7),
        event('tool.approval_decided', 8, { approvalId: 'approval', decision: 'deny' }),
      ]).has('actual'),
    ).toBe(true);
  });
  it('rejects ambiguous identical pending inputs instead of guessing', () => {
    expect(
      projectDeniedToolCalls([
        call('first', 1),
        call('second', 2),
        approval({ path: 'file', content: 'body' }),
        deny(),
      ]).size,
    ).toBe(0);
  });
  it('excludes a previously completed same-input call from legacy matching', () => {
    expect([
      ...projectDeniedToolCalls([
        call('old', 1),
        event('tool.completed', 2, { toolCallId: 'old' }),
        call('current', 3),
        approval({ path: 'file', content: 'body' }),
        deny(),
      ]).keys(),
    ]).toEqual(['current']);
  });
  it.each([{ threadId: 'foreign' }, { runId: 'foreign' }])(
    'rejects a mismatched decision scope %#',
    (payload) => {
      const decision = deny(payload);
      if ('runId' in payload) decision.runId = payload.runId as Event['runId'];
      expect(
        projectDeniedToolCalls([
          call('actual', 1),
          approval({ path: 'file', content: 'body' }),
          decision,
        ]).size,
      ).toBe(0);
    },
  );
  it('does not replace the first committed approval with a later conflicting denial', () => {
    expect(
      projectDeniedToolCalls([
        call('actual', 1),
        approval({ path: 'file', content: 'body' }),
        deny({ decision: 'approve' }),
        event('tool.approval_decided', 7, { approvalId: 'approval', decision: 'deny' }),
      ]).size,
    ).toBe(0);
  });
  it('does not serialize arguments when no approval was denied', () => {
    const request = event('tool.requested', 1, { toolCallId: 'actual', toolName: 'Write' });
    Object.defineProperty(request.payload, 'arguments', {
      get() {
        throw new Error('Unexpected argument scan');
      },
    });
    expect(projectDeniedToolCalls([request]).size).toBe(0);
  });
  it('bounds the legacy comparison and preserves explicit native IDs for large inputs', () => {
    const args = { path: 'file', content: 'x'.repeat(262145) };
    const request = approval(args);
    expect(projectDeniedToolCalls([call('actual', 1, args), request, deny()]).size).toBe(0);
    request.payload.toolCallId = 'actual';
    expect(projectDeniedToolCalls([call('actual', 1, args), request, deny()]).has('actual')).toBe(
      true,
    );
  });
  it('does not treat error examples embedded in text as execution metadata', () => {
    expect(isToolResultFailure('Example: {"ok":false}')).toBe(false);
    expect(isToolResultFailure('{"ok":true,"content":"example: ok=false"}')).toBe(false);
    expect(isToolResultFailure('', {}, { failed: true })).toBe(true);
  });
});
