import { describe, expect, it } from 'vitest';
import type { KernelEvent } from '@sync-think/shared';
import { evaluateCodexVerification } from './codex-verification.js';

const completedTurn = (text: string): KernelEvent[] => [
  { type: 'session-started', sessionId: 'native-session' },
  { type: 'delta', text },
  { type: 'usage', usage: { real: 12, window: 100 } },
  { type: 'terminal', status: 'completed' },
];

const evidence = () => ({
  first: completedTurn('hi from codex'),
  second: completedTurn('memory-token'),
  third: completedTurn('memory-token'),
  memoryToken: 'memory-token',
  spawnPids: [101, 202],
  sameProcessSpawnCount: 1,
  toolFlow: true,
});

describe('Codex live verification verdict', () => {
  it('accepts verified persistence without inventing a reasoning requirement', () => {
    const result = evaluateCodexVerification(evidence());
    expect(result.ok).toBe(true);
    expect(result.reasoningObserved).toBe(false);
    expect(result.checks.reasoning).toBe('not-required');
    expect(result.failures).toEqual([]);
  });

  it('keeps explicit reasoning verification strict', () => {
    const input = { ...evidence(), requireReasoning: true };
    expect(evaluateCodexVerification(input).failures).toEqual(['reasoning']);
    input.first.splice(1, 0, { type: 'reasoning', text: 'Observed summary' });
    expect(evaluateCodexVerification(input).ok).toBe(true);
  });

  it('does not report unrequested tool flow as verified', () => {
    const result = evaluateCodexVerification({ ...evidence(), toolFlow: undefined });
    expect(result.ok).toBe(true);
    expect(result.checks.tools).toBe('not-requested');
    expect(evaluateCodexVerification({ ...evidence(), toolFlow: false }).failures).toEqual([
      'tools',
    ]);
  });

  it('rejects lost memory and a different native session', () => {
    const input = evidence();
    input.second = completedTurn('different-answer');
    input.third[0] = { type: 'session-started', sessionId: 'other-session' };
    expect(evaluateCodexVerification(input).failures).toEqual([
      'sameProcessMemory',
      'reopenedSession',
    ]);
  });

  it('rejects missing or failed terminal and missing usage', () => {
    const input = evidence();
    input.first = input.first.filter((event) => event.type !== 'usage');
    input.second.pop();
    input.third[input.third.length - 1] = { type: 'terminal', status: 'failed', error: 'fixture' };
    expect(evaluateCodexVerification(input).failures).toEqual([
      'firstUsage',
      'secondCompleted',
      'thirdCompleted',
    ]);
  });

  it('rejects process reuse failures and absent initial session identity', () => {
    const input = evidence();
    input.sameProcessSpawnCount = 2;
    input.spawnPids = [101, 202, 303];
    input.first = input.first.filter((event) => event.type !== 'session-started');
    const result = evaluateCodexVerification(input);
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      'initialSession',
      'sameProcessSession',
      'sameProcessReuse',
      'reopenedSession',
      'reopenedProcess',
    ]);
  });
});
