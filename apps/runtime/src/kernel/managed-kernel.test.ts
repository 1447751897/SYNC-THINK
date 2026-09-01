import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveManagedKernelExecutable } from './managed-kernel.js';

function fixtureRoot(): string {
  return mkdtempSync(join(tmpdir(), 'sync-think-managed-kernel-'));
}

describe('resolveManagedKernelExecutable', () => {
  it('resolves a verified app-private active executable', () => {
    const root = fixtureRoot();
    try {
      const executable = join(root, 'versions', 'codex', '0.150.1', 'codex.cmd');
      mkdirSync(join(root, 'versions', 'codex', '0.150.1'), { recursive: true });
      writeFileSync(executable, '@echo off\r\n');
      writeFileSync(
        join(root, 'active.json'),
        JSON.stringify({
          schemaVersion: 1,
          active: {
            codex: {
              version: '0.150.1',
              packageName: '@openai/codex',
              executablePath: executable,
            },
          },
        }),
      );

      expect(
        resolveManagedKernelExecutable('codex', {
          SYNC_THINK_MANAGED_KERNEL_ROOT: root,
        }),
      ).toBe(executable);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('resolves a verified private Pi executable', () => {
    const root = fixtureRoot();
    try {
      const executable = join(root, 'versions', 'pi', '1.2.3', 'pi.cmd');
      mkdirSync(join(root, 'versions', 'pi', '1.2.3'), { recursive: true });
      writeFileSync(executable, '@echo off\r\n');
      writeFileSync(
        join(root, 'active.json'),
        JSON.stringify({
          schemaVersion: 1,
          active: {
            pi: {
              version: '1.2.3',
              packageName: '@earendil-works/pi-coding-agent',
              executablePath: executable,
            },
          },
        }),
      );

      expect(
        resolveManagedKernelExecutable('pi', {
          SYNC_THINK_MANAGED_KERNEL_ROOT: root,
        }),
      ).toBe(executable);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects executable paths outside the private kernel root', () => {
    const root = fixtureRoot();
    const outside = fixtureRoot();
    try {
      const executable = join(outside, 'claude.exe');
      writeFileSync(executable, 'fixture');
      writeFileSync(
        join(root, 'active.json'),
        JSON.stringify({
          schemaVersion: 1,
          active: {
            'claude-code': {
              version: '2.1.250',
              packageName: '@anthropic-ai/claude-code',
              executablePath: executable,
            },
          },
        }),
      );

      expect(
        resolveManagedKernelExecutable('claude-code', {
          SYNC_THINK_MANAGED_KERNEL_ROOT: root,
        }),
      ).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects the npm math library pi as a coding-agent executable', () => {
    const root = fixtureRoot();
    try {
      const executable = join(root, 'versions', 'pi', '2.0.5', 'pi.cmd');
      mkdirSync(join(root, 'versions', 'pi', '2.0.5'), { recursive: true });
      writeFileSync(executable, '@echo off\r\n');
      writeFileSync(
        join(root, 'active.json'),
        JSON.stringify({
          schemaVersion: 1,
          active: {
            pi: {
              version: '2.0.5',
              packageName: 'pi',
              executablePath: executable,
            },
          },
        }),
      );

      expect(
        resolveManagedKernelExecutable('pi', {
          SYNC_THINK_MANAGED_KERNEL_ROOT: root,
        }),
      ).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
