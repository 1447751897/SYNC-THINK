import { describe, expect, it } from 'vitest';
import { ConfigurationCommandConfirmationGate } from './command-confirmation.js';

describe('ConfigurationCommandConfirmationGate', () => {
  it('requires a single-use token bound to command, caller, and payload', () => {
    let now = 1_000;
    let sequence = 0;
    const gate = new ConfigurationCommandConfirmationGate({
      now: () => now,
      tokenFactory: () => `token-${++sequence}`,
    });
    const input = {
      command: 'agent.create' as const,
      callerSurface: 'mcp' as const,
      payload: { name: 'Planner', apiKey: 'must-not-appear' },
    };

    const first = gate.evaluate(input);
    expect(first.kind).toBe('preview');
    if (first.kind !== 'preview') throw new Error('expected preview');
    expect(first.preview).toMatchObject({
      status: 'confirmation_required',
      command: 'agent.create',
      callerSurface: 'mcp',
      confirmationToken: 'token-1',
      payloadKeys: ['apiKey', 'name'],
    });
    expect(JSON.stringify(first.preview)).not.toContain('must-not-appear');

    const confirmed = gate.evaluate({
      ...input,
      confirmationToken: first.preview.confirmationToken,
    });
    expect(confirmed).toMatchObject({ kind: 'execute', confirmed: true });
    expect(
      gate.evaluate({ ...input, confirmationToken: first.preview.confirmationToken }),
    ).toMatchObject({
      kind: 'reject',
      reason: 'unknown-token',
    });

    const changed = gate.evaluate(input);
    if (changed.kind !== 'preview') throw new Error('expected preview');
    expect(
      gate.evaluate({
        ...input,
        payload: { ...input.payload, name: 'Changed' },
        confirmationToken: changed.preview.confirmationToken,
      }),
    ).toMatchObject({ kind: 'reject', reason: 'payload-mismatch' });

    const crossSurface = gate.evaluate(input);
    if (crossSurface.kind !== 'preview') throw new Error('expected preview');
    expect(
      gate.evaluate({
        ...input,
        callerSurface: 'cli',
        confirmationToken: crossSurface.preview.confirmationToken,
      }),
    ).toMatchObject({ kind: 'reject', reason: 'caller-mismatch' });

    now += 5 * 60_000 + 1;
    const expired = gate.evaluate(input);
    if (expired.kind !== 'preview') throw new Error('expected preview');
    now += 5 * 60_000 + 1;
    expect(
      gate.evaluate({ ...input, confirmationToken: expired.preview.confirmationToken }),
    ).toMatchObject({ kind: 'reject', reason: 'expired-token' });
  });

  it('bypasses desktop actions and ordinary task commands', () => {
    const gate = new ConfigurationCommandConfirmationGate();
    expect(
      gate.evaluate({
        command: 'agent.create',
        callerSurface: 'desktop',
        payload: { name: 'Planner' },
      }),
    ).toEqual({ kind: 'execute', confirmed: false });
    expect(
      gate.evaluate({
        command: 'task.create',
        callerSurface: 'agent',
        payload: { workspaceId: 'workspace-1', title: 'Task' },
      }),
    ).toEqual({ kind: 'execute', confirmed: false });
  });
});
