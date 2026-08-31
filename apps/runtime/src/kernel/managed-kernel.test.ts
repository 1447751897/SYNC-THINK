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
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
