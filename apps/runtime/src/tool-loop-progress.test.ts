import { describe, expect, it } from 'vitest';
import { evaluateToolLoopGuard } from './chat-tools.js';
import { NATIVE_TOOL_CALL_BUDGET, NATIVE_OUTPUT_TOKEN_BUDGET, toolLoopBudgetReason } from './tool-loop-budget.js';

describe('progress-aware native tool loop', () => {
  it('uses operation/output budgets rather than productive round counts', () => {
    expect(toolLoopBudgetReason({ toolCallsUsed: NATIVE_TOOL_CALL_BUDGET - 1, outputTokensUsed: NATIVE_OUTPUT_TOKEN_BUDGET - 1 })).toBeUndefined();
    expect(toolLoopBudgetReason({ toolCallsUsed: NATIVE_TOOL_CALL_BUDGET, outputTokensUsed: 0 })).toContain('操作预算');
    expect(toolLoopBudgetReason({ toolCallsUsed: 0, outputTokensUsed: NATIVE_OUTPUT_TOKEN_BUDGET })).toContain('生成预算');
  });

  it('continues beyond eight rounds when each batch makes fresh progress', () => {
    let seen = new Set<string>();
    for (let round = 1; round <= 24; round++) {
      const result = evaluateToolLoopGuard({
        toolLoopRound: round,
        completedResults: [{ toolCallId: String(round), content: JSON.stringify({
          ok: true, path: 'draft.md', content: 'same prefix ' + round + ' same suffix',
        }) }],
        seenFingerprints: seen,
      });
      expect(result.kind).toBe('continue');
      seen = result.seenFingerprints;
    }
  });

  it('recognizes structured plan/catalog changes but not timestamps or reordered keys', () => {
    let seen = new Set<string>();
    for (let round = 1; round <= 6; round++) {
      const result = evaluateToolLoopGuard({ toolLoopRound: round, seenFingerprints: seen,
        completedResults: [{ toolCallId: String(round), content: JSON.stringify({
          ok: true, items: [{ title: 'phase-' + round, status: 'completed' }],
        }) }],
      });
      expect(result).toMatchObject({ kind: 'continue', stagnantRounds: 0 });
      seen = result.seenFingerprints;
    }
    const first = evaluateToolLoopGuard({ toolLoopRound: 7,
      completedResults: [{ toolCallId: 'one', content: '{"ok":true,"items":["same"],"updatedAt":"old","callId":"one"}' }],
    });
    const next = evaluateToolLoopGuard({ toolLoopRound: 8, seenFingerprints: first.seenFingerprints,
      completedResults: [{ toolCallId: 'two', content: '{"items":["same"],"callId":"two","updatedAt":"new","ok":true}' }],
    });
    expect(next.stagnantRounds).toBe(1);
  });

  it('detects changes in the middle of a long document as progress', () => {
    let seen = new Set<string>();
    let stagnantRounds = 0;
    for (let round = 0; round < 8; round++) {
      const result = evaluateToolLoopGuard({
        toolLoopRound: round + 1, seenFingerprints: seen, stagnantRounds,
        completedResults: [{ toolCallId: String(round), content: JSON.stringify({
          ok: true, path: 'draft.md', content: 'a'.repeat(80) + round + 'b'.repeat(80),
        }) }],
      });
      expect(result).toMatchObject({ kind: 'continue', stagnantRounds: 0 });
      seen = result.seenFingerprints;
      stagnantRounds = result.stagnantRounds;
    }
  });

  it('stops three consecutive all-failed batches even with different errors', () => {
    let failedRounds = 0;
    for (let round = 1; round <= 3; round++) {
      const result = evaluateToolLoopGuard({
        toolLoopRound: round, failedRounds,
        completedResults: [1, 2].map((index) => ({ toolCallId: String(index),
          content: JSON.stringify({ ok: false, error: 'failure-' + round + '-' + index }),
        })),
      });
      expect(result.kind).toBe(round === 3 ? 'force_final' : 'continue');
      failedRounds = result.failedRounds;
    }
  });

  it('does not let a first missing-command recovery hint override three failed batches', () => {
    const result = evaluateToolLoopGuard({ toolLoopRound: 3, failedRounds: 2,
      completedResults: [{ toolCallId: 'missing', content: '{"ok":false,"code":"COMMAND_UNAVAILABLE","error":"missing rg"}' }],
    });
    expect(result).toMatchObject({ kind: 'force_final', failedRounds: 3 });
  });

  it('resets consecutive failures after a successful recovery', () => {
    const result = evaluateToolLoopGuard({ toolLoopRound: 12, failedRounds: 2,
      completedResults: [{ toolCallId: 'recovered', content: '{"ok":true,"path":"found.md"}' }],
    });
    expect(result).toMatchObject({ kind: 'continue', failedRounds: 0 });
  });
});
