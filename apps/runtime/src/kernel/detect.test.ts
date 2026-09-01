import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import {
  extractSemverVersion,
  probeKernel,
  probeVersion,
  resolveCodexExecutablePath,
  resolveExecutablePath,
} from './detect.js';

/** Windows can transiently hold a handle on an executed .cmd shim; retry cleanup. */
function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

describe('extractSemverVersion', () => {
  it('extracts the first semver token from typical kernel --version outputs', () => {
    expect(extractSemverVersion('2.1.222 (Claude Code)')).toBe('2.1.222');
    expect(extractSemverVersion('codex-cli 0.145.0')).toBe('0.145.0');
    expect(extractSemverVersion('pi 1.2.3\n')).toBe('1.2.3');
  });

  it('returns null when no semver token exists', () => {
    expect(extractSemverVersion('unknown command')).toBeNull();
    expect(extractSemverVersion('')).toBeNull();
  });
});

describe('resolveExecutablePath', () => {
  it('resolves a bare command through PATH + PATHEXT', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-kernel-detect-'));
    try {
      const shim = join(dir, 'kernelfixture.cmd');
      writeFileSync(shim, '@echo off\r\necho 9.9.9\r\n', 'utf8');
      const originalPath = process.env.PATH;
      process.env.PATH = `${dir}${delimiter}${originalPath ?? ''}`;
      try {
        const resolved = resolveExecutablePath('kernelfixture');
        // Windows paths are case-insensitive; PATHEXT may return .CMD vs .cmd.
        expect(resolved?.toLowerCase()).toBe(shim.toLowerCase());
        expect(probeVersion(resolved!)).toBe('9.9.9');
      } finally {
        if (originalPath === undefined) delete process.env.PATH;
        else process.env.PATH = originalPath;
      }
    } finally {
      removeDir(dir);
    }
  });

  it('returns null for a missing command', () => {
    const originalPath = process.env.PATH;
    process.env.PATH = join(tmpdir(), 'sync-think-empty-bin');
    try {
      expect(resolveExecutablePath('definitely-not-a-real-kernel-xyz')).toBeNull();
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
    }
  });
});

describe('resolveCodexExecutablePath', () => {
  it('prefers the newer app-managed runtime with all Windows helper binaries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-codex-detect-'));
    try {
      const localAppData = join(dir, 'Local');
      const managed = join(localAppData, 'OpenAI', 'Codex', 'bin', 'runtime-new');
      const oldPathDir = join(dir, 'Programs', 'OpenAI', 'Codex', 'bin');
      const oldExecutable = join(oldPathDir, 'codex.exe');
      const managedExecutable = join(managed, 'codex.exe');
      mkdirSync(managed, { recursive: true });
      mkdirSync(oldPathDir, { recursive: true });
      for (const file of [
        managedExecutable,
        join(managed, 'codex-windows-sandbox-setup.exe'),
        join(managed, 'codex-command-runner.exe'),
        join(managed, 'codex-code-mode-host.exe'),
        oldExecutable,
      ]) {
        writeFileSync(file, '', { encoding: 'utf8', flag: 'w+' });
      }

      const resolved = resolveCodexExecutablePath({
        localAppData,
        pathExecutable: oldExecutable,
        versionProbe: (candidate) => (candidate === managedExecutable ? '0.149.0' : '0.147.0'),
      });

      expect(resolved?.toLowerCase()).toBe(managedExecutable.toLowerCase());
    } finally {
      removeDir(dir);
    }
  });

  it('prefers a complete app-managed runtime over a newer PATH binary without helpers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-codex-detect-'));
    try {
      const localAppData = join(dir, 'Local');
      const managed = join(localAppData, 'OpenAI', 'Codex', 'bin', 'runtime-complete');
      const pathDir = join(dir, 'Path');
      const pathExecutable = join(pathDir, 'codex.exe');
      const managedExecutable = join(managed, 'codex.exe');
      mkdirSync(managed, { recursive: true });
      mkdirSync(pathDir, { recursive: true });
      for (const file of [
        managedExecutable,
        join(managed, 'codex-windows-sandbox-setup.exe'),
        join(managed, 'codex-command-runner.exe'),
        join(managed, 'codex-code-mode-host.exe'),
        pathExecutable,
      ]) {
        writeFileSync(file, '', { encoding: 'utf8', flag: 'w+' });
      }

      const resolved = resolveCodexExecutablePath({
        localAppData,
        pathExecutable,
        versionProbe: (candidate) => (candidate === managedExecutable ? '0.149.0' : '0.150.0'),
      });

      expect(resolved?.toLowerCase()).toBe(managedExecutable.toLowerCase());
    } finally {
      removeDir(dir);
    }
  });
});

describe('probeKernel', () => {
  it('probes a fake kernel command and reports path + version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-kernel-probe-'));
    try {
      const shim = join(dir, 'fakek.cmd');
      writeFileSync(shim, '@echo off\r\necho fakek 3.2.1\r\n', 'utf8');
      const originalPath = process.env.PATH;
      process.env.PATH = `${dir}${delimiter}${originalPath ?? ''}`;
      try {
        const result = probeKernel('fakek');
        expect(result.executablePath?.toLowerCase()).toBe(shim.toLowerCase());
        expect(result.version).toBe('3.2.1');
      } finally {
        if (originalPath === undefined) delete process.env.PATH;
        else process.env.PATH = originalPath;
      }
    } finally {
      removeDir(dir);
    }
  });

  it('never throws for a missing kernel', () => {
    expect(() => probeKernel('definitely-not-installed-kernel')).not.toThrow();
    expect(probeKernel('definitely-not-installed-kernel')).toEqual({
      executablePath: null,
      version: null,
    });
  });

  it('treats a verified private Pi record as installed even when --version fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'sync-think-pi-detect-'));
    const originalRoot = process.env.SYNC_THINK_MANAGED_KERNEL_ROOT;
    try {
      const executable = join(root, 'versions', 'pi', '0.84.4', 'pi.cmd');
      mkdirSync(join(root, 'versions', 'pi', '0.84.4'), { recursive: true });
      writeFileSync(executable, '@echo off\r\nexit /b 1\r\n');
      writeFileSync(
        join(root, 'active.json'),
        JSON.stringify({
          schemaVersion: 1,
          active: {
            pi: {
              version: '0.84.4',
              packageName: '@earendil-works/pi-coding-agent',
              executablePath: executable,
            },
          },
        }),
      );
      process.env.SYNC_THINK_MANAGED_KERNEL_ROOT = root;

      const result = probeKernel('pi');
      expect(result.executablePath?.toLowerCase()).toBe(executable.toLowerCase());
      expect(result.version).toBe('0.84.4');
    } finally {
      if (originalRoot === undefined) delete process.env.SYNC_THINK_MANAGED_KERNEL_ROOT;
      else process.env.SYNC_THINK_MANAGED_KERNEL_ROOT = originalRoot;
      removeDir(root);
    }
  });
});
