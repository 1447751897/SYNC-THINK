import { HUMAN_ONLY_ACTIONS, type AgentVersionId, type ApprovalMode } from '@sync-think/shared';
import { describe, expect, it } from 'vitest';
import { resolveActionDecision, resolveScopedPolicy } from './scoped-policy.js';

describe('scoped policy', () => {
  it('selects the most restrictive applicable approval mode', () => {
    expect(
      resolveScopedPolicy([
        { scope: 'workspace', scopeId: 'workspace-1', approvalMode: 'full' },
        { scope: 'agent', scopeId: 'agent-1', approvalMode: 'request' },
      ]),
    ).toMatchObject({ approvalMode: 'request' });
  });

  it('keeps the most restrictive matching per-action rule', () => {
    const resolved = resolveScopedPolicy([
      {
        scope: 'workspace',
        scopeId: 'workspace-1',
        approvalMode: 'custom',
        rules: [{ action: 'shell.exec', approvalMode: 'delegate' }],
      },
      {
        scope: 'agent',
        scopeId: 'agent-1',
        approvalMode: 'custom',
        rules: [{ action: 'shell.exec', approvalMode: 'request' }],
      },
    ]);

    expect(resolved.rules).toEqual([{ action: 'shell.exec', approvalMode: 'request' }]);
    expect(
      resolveActionDecision({
        action: 'shell.exec',
        approvalMode: resolved.approvalMode,
        rules: resolved.rules,
      }),
    ).toMatchObject({ decision: 'human-required', approvalMode: 'request' });
  });

  it('allows every action in full access while retaining sensitive-action audit metadata', () => {
    expect(HUMAN_ONLY_ACTIONS).toHaveLength(7);
    for (const action of HUMAN_ONLY_ACTIONS) {
      expect(resolveActionDecision({ action, approvalMode: 'full' })).toMatchObject({
        action,
        decision: 'allowed',
        humanOnly: true,
      });
    }
  });

  it.each(['delegate', 'custom'] satisfies ApprovalMode[])(
    'keeps sensitive actions human-required in %s mode',
    (approvalMode) => {
      for (const action of HUMAN_ONLY_ACTIONS) {
        expect(resolveActionDecision({ action, approvalMode })).toMatchObject({
          action,
          decision: 'human-required',
          humanOnly: true,
        });
      }
    },
  );

  it('uses a matching custom rule and otherwise requires a human', () => {
    const rules = [{ action: 'browser.navigate', approvalMode: 'full' as const }];

    expect(
      resolveActionDecision({
        action: 'browser.navigate',
        approvalMode: 'custom',
        rules,
      }),
    ).toMatchObject({ decision: 'allowed', approvalMode: 'full' });
    expect(
      resolveActionDecision({
        action: 'shell.exec',
        approvalMode: 'custom',
        rules,
      }),
    ).toMatchObject({ decision: 'human-required', approvalMode: 'custom' });
  });

  it('fails closed when a policy or matching rule has an unknown approval mode', () => {
    const unknown = 'unknown-mode' as ApprovalMode;
    const resolved = resolveScopedPolicy([
      {
        scope: 'workspace',
        scopeId: 'workspace-1',
        approvalMode: unknown,
        rules: [{ action: 'shell.exec', approvalMode: unknown }],
      },
    ]);

    expect(resolved).toEqual({
      approvalMode: 'request',
      rules: [{ action: 'shell.exec', approvalMode: 'request' }],
    });
    expect(
      resolveActionDecision({
        action: 'shell.exec',
        approvalMode: 'full',
        rules: [{ action: 'shell.exec', approvalMode: unknown }],
      }),
    ).toMatchObject({ decision: 'allowed', approvalMode: 'full' });
  });

  it('returns normalized rules in stable action order regardless of input order', () => {
    const forward = resolveScopedPolicy([
      {
        scope: 'workspace',
        scopeId: 'workspace-1',
        approvalMode: 'custom',
        rules: [
          { action: ' shell.exec ', approvalMode: 'full' },
          { action: 'browser.navigate', approvalMode: 'delegate' },
        ],
      },
      {
        scope: 'agent',
        scopeId: 'agent-1',
        approvalMode: 'custom',
        rules: [{ action: 'shell.exec', approvalMode: 'request' }],
      },
    ]);
    const reversed = resolveScopedPolicy([
      {
        scope: 'agent',
        scopeId: 'agent-1',
        approvalMode: 'custom',
        rules: [{ action: 'shell.exec', approvalMode: 'request' }],
      },
      {
        scope: 'workspace',
        scopeId: 'workspace-1',
        approvalMode: 'custom',
        rules: [
          { action: 'browser.navigate', approvalMode: 'delegate' },
          { action: ' shell.exec ', approvalMode: 'full' },
        ],
      },
    ]);

    expect(forward.rules).toEqual([
      { action: 'browser.navigate', approvalMode: 'delegate' },
      { action: 'shell.exec', approvalMode: 'request' },
    ]);
    expect(reversed.rules).toEqual(forward.rules);
  });

  it('resolves one exact persisted delegate AgentVersion and fails closed on conflict', () => {
    const resolved = resolveScopedPolicy([
      {
        scope: 'workspace',
        scopeId: 'workspace-1',
        approvalMode: 'custom',
        rules: [
          {
            action: 'shell.exec',
            approvalMode: 'delegate',
            delegateAgentVersionId: 'agent-version-approval-1' as AgentVersionId,
          },
        ],
      },
    ]);

    expect(resolved.rules).toEqual([
      {
        action: 'shell.exec',
        approvalMode: 'delegate',
        delegateAgentVersionId: 'agent-version-approval-1',
      },
    ]);
    expect(
      resolveActionDecision({
        action: 'shell.exec',
        approvalMode: resolved.approvalMode,
        rules: resolved.rules,
      }),
    ).toMatchObject({
      decision: 'delegate-required',
      delegateAgentVersionId: 'agent-version-approval-1',
    });

    const conflicting = resolveScopedPolicy([
      ...resolved.rules.map((rule) => ({
        scope: 'workspace' as const,
        scopeId: 'workspace-1',
        approvalMode: 'custom' as const,
        rules: [rule],
      })),
      {
        scope: 'task' as const,
        scopeId: 'task-1',
        approvalMode: 'custom' as const,
        rules: [
          {
            action: 'shell.exec',
            approvalMode: 'delegate' as const,
            delegateAgentVersionId: 'agent-version-approval-2' as AgentVersionId,
          },
        ],
      },
    ]);
    const conflictedDecision = resolveActionDecision({
      action: 'shell.exec',
      approvalMode: conflicting.approvalMode,
      rules: conflicting.rules,
    });
    expect(conflictedDecision).toMatchObject({ decision: 'human-required' });
    expect(conflictedDecision).not.toHaveProperty('delegateAgentVersionId');
  });
});
