import { describe, expect, it } from 'vitest';
import { compareVersions, isVersionSupported } from './version-compat.js';

describe('compareVersions', () => {
  it('orders semver segments numerically, not lexically', () => {
    expect(compareVersions('2.10.0', '2.9.0')! > 0).toBe(true);
    expect(compareVersions('0.145.0', '0.99.0')! > 0).toBe(true);
    expect(compareVersions('2.1.222', '2.1.222')).toBe(0);
  });

  it('treats missing segments as zero', () => {
    expect(compareVersions('2', '2.0.0')).toBe(0);
    expect(compareVersions('2.1', '2.1.0')).toBe(0);
    expect(compareVersions('2.1', '2.0.9')! > 0).toBe(true);
  });

  it('tolerates suffixes and rejects unparseable input', () => {
    expect(compareVersions('2.1.222-beta.1', '2.1.222')).toBe(0);
    expect(compareVersions('unknown', '2.0.0')).toBeNull();
    expect(compareVersions('2.0.0', '')).toBeNull();
  });
});

describe('isVersionSupported', () => {
  const policy = {
    verifiedVersions: ['2.1.222'],
    minimumSupportedVersion: '2.0.0',
    upperExclusiveVersion: '3.0.0',
  };

  it('accepts any detected version inside the declared range', () => {
    // The regression this fixes: a fresh kernel release used to fall out of the
    // exact-pin allowlist and render as「版本未验证」.
    expect(isVersionSupported('2.1.222', policy)).toBe(true);
    expect(isVersionSupported('2.4.0', policy)).toBe(true);
    expect(isVersionSupported('2.10.7', policy)).toBe(true);
    expect(isVersionSupported('2.0.0', policy)).toBe(true);
  });

  it('rejects versions below the minimum and at or above the upper bound', () => {
    expect(isVersionSupported('1.9.9', policy)).toBe(false);
    expect(isVersionSupported('3.0.0', policy)).toBe(false);
    expect(isVersionSupported('4.1.0', policy)).toBe(false);
  });

  it('still accepts explicitly verified versions outside the range', () => {
    expect(
      isVersionSupported('1.0.5', { verifiedVersions: ['1.0.5'], minimumSupportedVersion: '2.0.0' }),
    ).toBe(true);
  });

  it('never claims support without a version or a policy floor', () => {
    expect(isVersionSupported(null, policy)).toBe(false);
    expect(isVersionSupported('unknown', policy)).toBe(false);
    expect(isVersionSupported('1.2.3', { verifiedVersions: [] })).toBe(false);
  });
});
