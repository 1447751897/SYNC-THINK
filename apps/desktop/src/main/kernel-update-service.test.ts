import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  createKernelUpdateService,
  resolveKernelInstallerInvocation,
} from './kernel-update-service.js';

function fixtureRoot(): string {
  const root = join(tmpdir(), `sync-think-kernel-update-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function packageExecutable(prefix: string, packageName: string, version: string): string {
  const isClaude = packageName.includes('claude-code');
  const packageRoot = join(prefix, 'node_modules', ...packageName.split('/'));
  mkdirSync(join(packageRoot, 'bin'), { recursive: true });
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: packageName, version }));
  const executable =
    process.platform === 'win32'
      ? isClaude
        ? join(packageRoot, 'bin', 'claude.exe')
        : join(prefix, 'codex.cmd')
      : join(prefix, 'bin', isClaude ? 'claude' : 'codex');
  mkdirSync(join(executable, '..'), { recursive: true });
  writeFileSync(executable, 'fixture');
  return executable;
}

describe('kernel update service', () => {
  it('uses the managed Node npm CLI instead of treating pnpm execpath as npm', () => {
    const root = fixtureRoot();
    try {
      const nodeExecutable = join(root, 'node.exe');
      const npmCli = join(root, 'node_modules', 'npm', 'bin', 'npm-cli.js');
      const pnpmCli = join(root, 'pnpm.cjs');
      mkdirSync(join(root, 'node_modules', 'npm', 'bin'), { recursive: true });
      writeFileSync(nodeExecutable, 'fixture');
      writeFileSync(npmCli, 'fixture');
      writeFileSync(pnpmCli, 'fixture');

      expect(
        resolveKernelInstallerInvocation(nodeExecutable, {
          npm_execpath: pnpmCli,
          PATH: '',
        }),
      ).toEqual({ command: nodeExecutable, prefixArgs: [npmCli] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('checks both vendor packages and reports independent updates', async () => {
    const root = fixtureRoot();
    try {
      const service = createKernelUpdateService({
        rootDir: root,
        installer: { command: 'node', prefixArgs: ['npm-cli.js'] },
        run: async (args) => ({
          exitCode: 0,
          stdout: args.includes('@openai/codex') ? '"0.150.1"' : '"2.1.250"',
          stderr: '',
        }),
      });

      const result = await service.checkForUpdates();

      expect(result.ok).toBe(true);
      expect(result.state.items).toEqual([
        expect.objectContaining({
          kernelId: 'codex',
          latestVersion: '0.150.1',
          phase: 'available',
        }),
        expect.objectContaining({
          kernelId: 'claude-code',
          latestVersion: '2.1.250',
          phase: 'available',
        }),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('installs into a version directory and activates only after verification', async () => {
    const root = fixtureRoot();
    try {
      const service = createKernelUpdateService({
        rootDir: root,
        installer: { command: 'node', prefixArgs: ['npm-cli.js'] },
        run: async (args) => {
          if (args[0] === 'view') return { exitCode: 0, stdout: '"0.150.1"', stderr: '' };
          const prefix = args[args.indexOf('--prefix') + 1]!;
          packageExecutable(prefix, '@openai/codex', '0.150.1');
          return { exitCode: 0, stdout: 'installed', stderr: '' };
        },
      });

      const result = await service.installUpdate('codex');
      const manifest = JSON.parse(readFileSync(join(root, 'active.json'), 'utf8')) as {
        active: { codex: { version: string; executablePath: string } };
      };

      expect(result.ok).toBe(true);
      expect(manifest.active.codex.version).toBe('0.150.1');
      expect(manifest.active.codex.executablePath).toContain(join('versions', 'codex', '0.150.1'));
      expect(existsSync(manifest.active.codex.executablePath)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps the previous active version when installation verification fails', async () => {
    const root = fixtureRoot();
    try {
      const activePath = packageExecutable(
        join(root, 'versions', 'codex', '0.149.0'),
        '@openai/codex',
        '0.149.0',
      );
      writeFileSync(
        join(root, 'active.json'),
        JSON.stringify({
          schemaVersion: 1,
          active: {
            codex: {
              version: '0.149.0',
              packageName: '@openai/codex',
              executablePath: activePath,
            },
          },
        }),
      );
      const service = createKernelUpdateService({
        rootDir: root,
        installer: { command: 'node', prefixArgs: ['npm-cli.js'] },
        run: async (args) =>
          args[0] === 'view'
            ? { exitCode: 0, stdout: '"0.150.1"', stderr: '' }
            : { exitCode: 0, stdout: 'installed without executable', stderr: '' },
      });

      const result = await service.installUpdate('codex');
      const manifest = JSON.parse(readFileSync(join(root, 'active.json'), 'utf8')) as {
        active: { codex: { version: string } };
      };

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe('kernel.update.verify-failed');
      expect(manifest.active.codex.version).toBe('0.149.0');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
