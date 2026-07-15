import { describe, expect, it } from 'vitest';
import {
  resolveCredentialRef,
  UNASSIGNED_CREDENTIAL_GROUP_ID,
} from './credential-binding.js';

type Cred = { id: string; credentialGroupId: string; label: string };

const gA = 'group-a';
const gB = 'group-b';
const a1: Cred = { id: 'cred-a1', credentialGroupId: gA, label: 'a1' };
const a2: Cred = { id: 'cred-a2', credentialGroupId: gA, label: 'a2' };
const b1: Cred = { id: 'cred-b1', credentialGroupId: gB, label: 'b1' };
const primary: Cred = { id: 'cred-primary', credentialGroupId: gA, label: 'primary' };
const primaryB: Cred = { id: 'cred-primary-b', credentialGroupId: gB, label: 'primary-b' };

const catalog = new Map<string, Cred>([
  [a1.id, a1],
  [a2.id, a2],
  [b1.id, b1],
  [primary.id, primary],
  [primaryB.id, primaryB],
]);

const byGroup = new Map<string, Cred[]>([
  [gA, [a1, a2]],
  [gB, [b1]],
]);

/** group-a → provider A; group-b → provider B */
const groupOwner = new Map<string, string>([
  [gA, 'provider-a'],
  [gB, 'provider-b'],
]);

function lookup() {
  return {
    getCredentialRef: (id: string) => catalog.get(id),
    getFirstCredentialInGroup: (groupId: string) => byGroup.get(groupId)?.[0],
    getPrimaryCredentialRef: (providerId: string) =>
      providerId === 'provider-b' ? primaryB : primary,
    getProviderIdForCredentialGroup: (groupId: string) => groupOwner.get(groupId),
  };
}

describe('resolveCredentialRef §5.4', () => {
  it('prefers run override, then pin, then group first, then provider primary', () => {
    const base = lookup();

    expect(
      resolveCredentialRef({
        ...base,
        runCredentialRefId: a2.id,
        pinnedCredentialRefId: a1.id,
        defaultCredentialGroupId: gA,
        providerId: 'provider-a',
      }),
    ).toMatchObject({ status: 'resolved', source: 'runOverride', credential: a2 });

    expect(
      resolveCredentialRef({
        ...base,
        pinnedCredentialRefId: a2.id,
        defaultCredentialGroupId: gA,
        providerId: 'provider-a',
      }),
    ).toMatchObject({ status: 'resolved', source: 'agentPin', credential: a2 });

    expect(
      resolveCredentialRef({
        ...base,
        defaultCredentialGroupId: gB,
        providerId: 'provider-b',
      }),
    ).toMatchObject({ status: 'resolved', source: 'agentGroup', credential: b1 });

    expect(
      resolveCredentialRef({
        ...base,
        defaultCredentialGroupId: UNASSIGNED_CREDENTIAL_GROUP_ID,
        providerId: 'provider-a',
      }),
    ).toMatchObject({ status: 'resolved', source: 'providerPrimary', credential: primary });
  });

  it('does not leave a bound group for unpinned selection (no silent primary steal)', () => {
    const base = lookup();
    const emptyGroup = resolveCredentialRef({
      ...base,
      defaultCredentialGroupId: 'group-empty',
      providerId: 'provider-a',
      getFirstCredentialInGroup: () => undefined,
      getProviderIdForCredentialGroup: (id) =>
        id === 'group-empty' ? 'provider-a' : groupOwner.get(id),
    });
    expect(emptyGroup.status).toBe('unresolved');
    expect(emptyGroup.reason).toBe('group_empty');
    expect(emptyGroup.credential).toBeUndefined();
  });

  it('rejects run override outside bound group and falls through to pin/group', () => {
    const base = lookup();
    const r = resolveCredentialRef({
      ...base,
      runCredentialRefId: b1.id,
      defaultCredentialGroupId: gA,
      providerId: 'provider-a',
    });
    expect(r).toMatchObject({ status: 'resolved', source: 'agentGroup', credential: a1 });
  });

  it('pin is exact even when group has other keys', () => {
    const base = lookup();
    const r = resolveCredentialRef({
      ...base,
      pinnedCredentialRefId: a2.id,
      defaultCredentialGroupId: gA,
      providerId: 'provider-a',
    });
    expect(r.source).toBe('agentPin');
    expect(r.credential?.id).toBe(a2.id);
  });

  it('cross-provider model fallback drops stale run credential and uses target provider primary', () => {
    const base = lookup();
    // Run still holds provider-A key after model falls back to provider-B.
    const r = resolveCredentialRef({
      ...base,
      runCredentialRefId: a1.id,
      defaultCredentialGroupId: UNASSIGNED_CREDENTIAL_GROUP_ID,
      providerId: 'provider-b',
    });
    expect(r.status).toBe('resolved');
    expect(r.source).toBe('providerPrimary');
    expect(r.credential?.id).toBe(primaryB.id);
  });

  it('cross-provider rebind ignores pin and group that belong to another provider', () => {
    const base = lookup();
    const r = resolveCredentialRef({
      ...base,
      runCredentialRefId: a1.id,
      pinnedCredentialRefId: a2.id,
      defaultCredentialGroupId: gA,
      providerId: 'provider-b',
    });
    expect(r.status).toBe('resolved');
    expect(r.source).toBe('providerPrimary');
    expect(r.credential?.id).toBe(primaryB.id);
  });
});
