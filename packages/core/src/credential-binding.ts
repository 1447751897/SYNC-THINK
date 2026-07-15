import type { CredentialGroupId, CredentialRefId } from '@sync-think/shared';

/**
 * Credential selection — product design §5.4.
 *
 * Precedence:
 * 1. Run-level exact credential (when allowed)
 * 2. Agent pinned credential (cannot switch within group)
 * 3. First credential in Agent credential group
 * 4. Provider primary for the target model provider
 *
 * Constraints:
 * - When a real group is bound, selection stays inside that group unless the
 *   user explicitly pins (or run-overrides) a credential — but only while the
 *   target model still belongs to that group's provider.
 * - Credential must support the chosen model: its group must belong to the
 *   target provider. Cross-provider model fallback re-routes keys; it never
 *   reuses another provider's secret. Silent model substitution remains banned.
 */

export const UNASSIGNED_CREDENTIAL_GROUP_ID = 'credential-group-unassigned' as CredentialGroupId;

export type CredentialResolutionSource =
  | 'runOverride'
  | 'agentPin'
  | 'agentGroup'
  | 'providerPrimary'
  | 'none';

export interface CredentialRefLike {
  id: CredentialRefId | string;
  credentialGroupId: CredentialGroupId | string;
}

export interface ResolveCredentialRefInput<T extends CredentialRefLike = CredentialRefLike> {
  runCredentialRefId?: string | null;
  pinnedCredentialRefId?: string | null;
  defaultCredentialGroupId?: string | null;
  /** Target model provider — credentials must belong to this provider when set. */
  providerId?: string | null;
  /** When group is bound, run override must belong to that group (unless false). */
  enforceGroupForRunOverride?: boolean;
  getCredentialRef: (id: string) => T | undefined;
  getFirstCredentialInGroup: (groupId: string) => T | undefined;
  getPrimaryCredentialRef?: (providerId: string) => T | undefined;
  /** Optional: resolve credential_group → provider for provider affinity checks. */
  getProviderIdForCredentialGroup?: (groupId: string) => string | undefined;
  unassignedGroupId?: string;
}

export interface CredentialRefResolution<T extends CredentialRefLike = CredentialRefLike> {
  status: 'resolved' | 'unresolved';
  credential?: T;
  source: CredentialResolutionSource;
  /** Group used for routing when known. */
  credentialGroupId?: string;
  reason?:
    | 'missing'
    | 'run_out_of_group'
    | 'pin_missing'
    | 'group_empty'
    | 'no_provider_primary'
    | 'provider_mismatch';
}

function isRealGroup(groupId: string | null | undefined, unassigned: string): groupId is string {
  const g = String(groupId ?? '').trim();
  return g.length > 0 && g !== unassigned;
}

function credentialMatchesProvider<T extends CredentialRefLike>(
  cred: T,
  targetProviderId: string | undefined,
  getProviderIdForCredentialGroup?: (groupId: string) => string | undefined,
): boolean {
  if (!targetProviderId) return true;
  if (!getProviderIdForCredentialGroup) return true;
  const owner = getProviderIdForCredentialGroup(String(cred.credentialGroupId));
  // Unknown mapping: do not block (older stores); known mismatch: reject.
  if (owner === undefined || owner === null || String(owner).trim() === '') return true;
  return String(owner) === targetProviderId;
}

function groupMatchesProvider(
  groupId: string,
  targetProviderId: string | undefined,
  getProviderIdForCredentialGroup?: (groupId: string) => string | undefined,
): boolean {
  if (!targetProviderId) return true;
  if (!getProviderIdForCredentialGroup) return true;
  const owner = getProviderIdForCredentialGroup(groupId);
  if (owner === undefined || owner === null || String(owner).trim() === '') return true;
  return String(owner) === targetProviderId;
}

/**
 * Resolve which credential ref should open the next model stream.
 * Pure function — no I/O, no secrets.
 */
export function resolveCredentialRef<T extends CredentialRefLike>(
  input: ResolveCredentialRefInput<T>,
): CredentialRefResolution<T> {
  const unassigned = input.unassignedGroupId ?? UNASSIGNED_CREDENTIAL_GROUP_ID;
  const groupId = String(input.defaultCredentialGroupId ?? '').trim() || undefined;
  const groupBound = isRealGroup(groupId, unassigned);
  const enforceGroup = input.enforceGroupForRunOverride !== false;
  const targetProviderId = String(input.providerId ?? '').trim() || undefined;
  const mapGroup = input.getProviderIdForCredentialGroup;

  const runId = String(input.runCredentialRefId ?? '').trim();
  if (runId) {
    const runCred = input.getCredentialRef(runId);
    if (runCred) {
      const outOfGroup =
        groupBound &&
        enforceGroup &&
        String(runCred.credentialGroupId) !== groupId;
      const providerOk = credentialMatchesProvider(runCred, targetProviderId, mapGroup);
      if (!outOfGroup && providerOk) {
        return {
          status: 'resolved',
          credential: runCred,
          source: 'runOverride',
          credentialGroupId: String(runCred.credentialGroupId),
        };
      }
      // Reject out-of-group or wrong-provider run override; fall through.
    }
  }

  const pinId = String(input.pinnedCredentialRefId ?? '').trim();
  if (pinId) {
    const pin = input.getCredentialRef(pinId);
    if (!pin) {
      return {
        status: 'unresolved',
        source: 'none',
        reason: 'pin_missing',
        credentialGroupId: groupId,
      };
    }
    if (credentialMatchesProvider(pin, targetProviderId, mapGroup)) {
      // Pin is exact within its provider; runtime must not switch keys in-group.
      return {
        status: 'resolved',
        credential: pin,
        source: 'agentPin',
        credentialGroupId: String(pin.credentialGroupId),
      };
    }
    // Cross-provider model fallback: pin does not authorize foreign keys.
  }

  if (groupBound && groupMatchesProvider(groupId, targetProviderId, mapGroup)) {
    const first = input.getFirstCredentialInGroup(groupId);
    if (!first) {
      return {
        status: 'unresolved',
        source: 'none',
        reason: 'group_empty',
        credentialGroupId: groupId,
      };
    }
    if (credentialMatchesProvider(first, targetProviderId, mapGroup)) {
      return {
        status: 'resolved',
        credential: first,
        source: 'agentGroup',
        credentialGroupId: groupId,
      };
    }
  }

  if (targetProviderId && input.getPrimaryCredentialRef) {
    const primary = input.getPrimaryCredentialRef(targetProviderId);
    if (primary) {
      return {
        status: 'resolved',
        credential: primary,
        source: 'providerPrimary',
        credentialGroupId: String(primary.credentialGroupId),
      };
    }
    return {
      status: 'unresolved',
      source: 'none',
      reason: 'no_provider_primary',
      credentialGroupId: groupId,
    };
  }

  return { status: 'unresolved', source: 'none', reason: 'missing', credentialGroupId: groupId };
}
