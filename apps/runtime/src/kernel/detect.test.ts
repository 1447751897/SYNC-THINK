import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import {
  extractSemverVersion,
  probeKernel,
  probeVersion,
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
});
