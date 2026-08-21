import { describe, expect, it } from 'vitest';
import {
  buildKernelRegistry,
  getKernelRegistry,
  resolveKernelAdapter,
  resolveKernelEntry,
} from './registry.js';
import { isVersionSupported } from './version-compat.js';
import { nativeKernelAdapter } from './native-kernel-adapter.js';

/** Mirror of the registry's compat policy, so tests stay machine-agnostic. */
function expectedKnownGood(
  entry: {
    knownGoodVersions: readonly string[];
    minimumSupportedVersion?: string;
    upperExclusiveVersion?: string;
  },
  version: string | null,
): boolean {
  return isVersionSupported(version, {
    verifiedVersions: entry.knownGoodVersions,
    ...(entry.minimumSupportedVersion
      ? { minimumSupportedVersion: entry.minimumSupportedVersion }
      : {}),
    ...(entry.upperExclusiveVersion
      ? { upperExclusiveVersion: entry.upperExclusiveVersion }
      : {}),
  });
}

describe('kernel registry contract', () => {
  it('registers native, claude-code, codex and pi entries with full capability declarations', () => {
    const registry = buildKernelRegistry();
    expect(registry.map((entry) => entry.id)).toEqual([
      'native',
      'claude-code',
      'codex',
      'pi',
    ]);

    const native = registry.find((entry) => entry.id === 'native')!;
    expect(native.kind).toBe('in-process');
    expect(native.capabilities).toEqual(nativeKernelAdapter.capabilities);

    const claudeCode = registry.find((entry) => entry.id === 'claude-code')!;
    expect(claudeCode.kind).toBe('subprocess');
    expect(claudeCode.capabilities).toMatchObject({
      protocols: ['anthropic-messages'],
      permission: 'own',
      permissionBridge: true,
      pause: 'turn',
      compress: 'own',
      usageReport: true,
      // CC has no window override entry → host must cap to its 200k native budget.
      contextWindow: { nativeLimit: 200_000, overridable: false },
    });
    expect(claudeCode.knownGoodVersions).toContain('2.1.222');
    // The binary bundled with the Agent SDK dependency.
    expect(claudeCode.knownGoodVersions).toContain('2.1.238');
    // Range policy: newer 2.x builds must not regress to「版本未验证」.
    expect(claudeCode.minimumSupportedVersion).toBe('2.0.0');
    expect(claudeCode.upperExclusiveVersion).toBe('3.0.0');
    // The SDK ships the CLI, so there is nothing for the user to install and no
    // install command may be offered (it would point at an unused global copy).
    expect(claudeCode.installCommand).toBeUndefined();

    const codex = registry.find((entry) => entry.id === 'codex')!;
    expect(codex.kind).toBe('subprocess');
    expect(codex.capabilities).toMatchObject({
      permissionBridge: true,
      pause: 'turn',
      // app-server accepts per-thread context configuration.
      contextWindow: { nativeLimit: 128_000, overridable: true },
    });
    expect(codex.knownGoodVersions).toContain('0.145.0');
    expect(codex.minimumSupportedVersion).toBe('0.140.0');
    expect(codex.upperExclusiveVersion).toBe('1.0.0');
    expect(resolveKernelAdapter('codex')!.id).toBe('codex');
    // Pi is not wired yet — adapter must stay undefined so the UI renders 未安装.
    expect(resolveKernelAdapter('pi')).toBeUndefined();

    const pi = registry.find((entry) => entry.id === 'pi')!;
    expect(pi.capabilities).toMatchObject({ permission: 'none', pause: 'kill' });
    expect(pi.installCommand).toBe('npm i -g pi');
  });

  it('always resolves native and its in-process adapter', () => {
    const entry = resolveKernelEntry('native');
    expect(entry.id).toBe('native');
    expect(resolveKernelAdapter('native')).toBe(nativeKernelAdapter);
    expect(resolveKernelAdapter(undefined)).toBe(nativeKernelAdapter);
  });

  it('falls back to native for unknown kernel ids', () => {
    expect(resolveKernelEntry('unknown-kernel').id).toBe('native');
    expect(resolveKernelEntry(undefined).id).toBe('native');
  });

  it('external kernels are detected (installed state depends on the machine)', async () => {
    const registry = getKernelRegistry();
    for (const id of ['claude-code', 'codex', 'pi'] as const) {
      const entry = registry.find((candidate) => candidate.id === id)!;
      const detection = await entry.detect();
      expect(detection.kernelId).toBe(id);
      expect(typeof detection.installed).toBe('boolean');
      expect(detection.executablePath === null || typeof detection.executablePath === 'string')
        .toBe(true);
      // knownGood must follow the declared compat range, never an exact pin.
      if (detection.version !== null) {
        expect(detection.knownGood).toBe(expectedKnownGood(entry, detection.version));
      }
      // PATH-probed kernels can only claim installed when an executable resolved.
      // claude-code is exempt: its binary ships inside the Agent SDK dependency,
      // so availability is proven by the resolved version, not by a PATH hit.
      if (id !== 'claude-code') {
        expect(detection.installed ? detection.executablePath !== null : true).toBe(true);
      }
    }
  });

  it('claude-code is always available because the SDK bundles its binary', async () => {
    const detection = await getKernelRegistry()
      .find((entry) => entry.id === 'claude-code')!
      .detect();
    // No machine dependency: installing the workspace installs the kernel.
    expect(detection.installed).toBe(true);
    expect(detection.version).not.toBeNull();
    expect(detection.knownGood).toBe(true);
    // Nothing host-visible to launch, and no install guidance to render.
    expect(detection.executablePath).toBeNull();
    expect(detection.installCommand).toBeUndefined();
  });

  it('detection stays consistent with declared known-good versions anywhere', async () => {
    // Machine-agnostic: whichever versions are present must be reported exactly,
    // and a present version must match the declared knownGood flag.
    const registry = getKernelRegistry();
    for (const id of ['claude-code', 'codex', 'pi'] as const) {
      const entry = registry.find((candidate) => candidate.id === id)!;
      const detection = await entry.detect();
      if (detection.installed) {
        expect(detection.version).not.toBeNull();
        expect(detection.knownGood).toBe(expectedKnownGood(entry, detection.version));
      } else {
        // A missing executable can never claim a version.
        expect(detection.version).toBeNull();
      }
    }
    // Native is the always-available baseline.
    const native = await registry.find((entry) => entry.id === 'native')!.detect();
    expect(native.installed).toBe(true);
    expect(native.knownGood).toBe(true);
  });
});
