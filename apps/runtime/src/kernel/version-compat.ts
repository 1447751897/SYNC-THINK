/**
 * Kernel version compatibility.
 *
 * Versions themselves are always discovered at runtime (`detect.ts` runs
 * `<kernel> --version` and extracts the semver). What used to be hardcoded was
 * the *verdict*: `knownGood` only accepted an exact pin, so every kernel update
 * immediately regressed the UI to「版本未验证」even though nothing broke.
 *
 * The verdict is now range-based: a kernel is considered good when its detected
 * version is at or above the declared minimum supported version. The exact
 * versions we actually smoke-tested stay recorded (`verifiedVersions`) so a
 * pinned-but-below-minimum build is still accepted, and so release notes keep a
 * trace of what was validated.
 */

/** Semver-ish tuple; missing segments are treated as 0. */
function parseVersion(value: string): [number, number, number] | null {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

/**
 * Compare two version strings.
 * Returns a negative number when `a < b`, 0 when equal, positive when `a > b`,
 * and `null` when either side is unparseable.
 */
export function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

export interface VersionCompatPolicy {
  /**
   * Lowest version we support. Anything at or above this is accepted without a
   * new release, so kernel updates no longer need a code change.
   */
  readonly minimumSupportedVersion?: string;
  /**
   * Exclusive upper bound. Guards against the next breaking major landing
   * silently: `[minimum, upperExclusive)` is the accepted range.
   */
  readonly upperExclusiveVersion?: string;
  /** Exact versions that were smoke-tested; always accepted. */
  readonly verifiedVersions: readonly string[];
}

/**
 * Decide whether a detected version satisfies the policy.
 * An unparseable or missing version is never considered good.
 */
export function isVersionSupported(
  version: string | null,
  policy: VersionCompatPolicy,
): boolean {
  if (version === null) return false;
  if (policy.verifiedVersions.includes(version)) return true;
  const minimum = policy.minimumSupportedVersion;
  if (!minimum) return false;
  const lower = compareVersions(version, minimum);
  if (lower === null || lower < 0) return false;
  if (policy.upperExclusiveVersion) {
    const upper = compareVersions(version, policy.upperExclusiveVersion);
    if (upper === null || upper >= 0) return false;
  }
  return true;
}
