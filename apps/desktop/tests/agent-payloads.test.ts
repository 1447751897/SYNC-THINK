import { describe, expect, it } from 'vitest';
import {
  parseGetAgentPayload,
  parseUpdateAgentBindingPayload,
} from '../src/agent-payloads.js';

describe('agent payloads', () => {
  it('parses empty get payload and rejects bad update', () => {
    expect(parseGetAgentPayload({})).toEqual({ agentId: undefined });
    expect(parseGetAgentPayload(null)).toEqual({});
    expect(() =>
      parseUpdateAgentBindingPayload({ defaultModelId: '', fallbackModelIds: [] }),
    ).toThrow();
    const ok = parseUpdateAgentBindingPayload({
      defaultModelId: ' m1 ',
      fallbackModelIds: [' m2 ', 'm3'],
      pauseOnFailure: true,
    });
    expect(ok.defaultModelId).toBe('m1');
    expect(ok.fallbackModelIds).toEqual(['m2', 'm3']);
    expect(ok.pauseOnFailure).toBe(true);
  });

  it('parses credential group and pin (including null pin clear)', () => {
    const ok = parseUpdateAgentBindingPayload({
      defaultModelId: 'm1',
      fallbackModelIds: [],
      defaultCredentialGroupId: 'cg-1',
      pinnedCredentialRefId: 'cr-9',
    });
    expect(ok.defaultCredentialGroupId).toBe('cg-1');
    expect(ok.pinnedCredentialRefId).toBe('cr-9');

    const clear = parseUpdateAgentBindingPayload({
      defaultModelId: 'm1',
      fallbackModelIds: [],
      defaultCredentialGroupId: 'cg-1',
      pinnedCredentialRefId: null,
    });
    expect(clear.pinnedCredentialRefId).toBeNull();
  });
});
