import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
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
  const isPi = packageName.includes('pi-coding-agent');
  const packageRoot = join(prefix, 'node_modules', ...packageName.split('/'));
  mkdirSync(join(packageRoot, 'bin'), { recursive: true });
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: packageName, version }));
  const executable =
    process.platform === 'win32'
      ? isClaude
        ? join(packageRoot, 'bin', 'claude.exe')
        : join(prefix, isPi ? 'pi.cmd' : 'codex.cmd')
      : join(prefix, 'bin', isClaude ? 'claude' : isPi ? 'pi' : 'codex');
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
          stdout: args.includes('@openai/codex')
            ? '"0.150.1"'
            : args.includes('@earendil-works/pi-coding-agent')
              ? '"1.2.3"'
              : '"2.1.250"',
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
        expect.objectContaining({
          kernelId: 'pi',
          latestVersion: '1.2.3',
          phase: 'available',
        }),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('can check a single private kernel without querying the others', async () => {
    const root = fixtureRoot();
    try {
      const viewed: string[] = [];
      const service = createKernelUpdateService({
        rootDir: root,
        installer: { command: 'node', prefixArgs: ['npm-cli.js'] },
        run: async (args) => {
          viewed.push(String(args[1]));
          return { exitCode: 0, stdout: '"0.84.4"', stderr: '' };
        },
      });

      const result = await service.checkForUpdates('pi');

      expect(result.ok).toBe(true);
      expect(viewed).toEqual(['@earendil-works/pi-coding-agent']);
      expect(result.state.items.find((item) => item.kernelId === 'pi')).toEqual(
        expect.objectContaining({ latestVersion: '0.84.4', phase: 'available' }),
      );
      expect(result.state.items.find((item) => item.kernelId === 'codex')?.latestVersion).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not treat the npm math library pi as an activated coding kernel', async () => {
    const root = fixtureRoot();
    try {
      const prefix = join(root, 'versions', 'pi', '2.0.5');
      const executable = packageExecutable(prefix, 'pi', '2.0.5');
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
      const service = createKernelUpdateService({
        rootDir: root,
        installer: { command: 'node', prefixArgs: ['npm-cli.js'] },
      });

      expect(service.getSnapshot().items.find((item) => item.kernelId === 'pi')).toEqual(
        expect.objectContaining({ managedVersion: null, phase: 'idle' }),
      );
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

  it('installs Pi into the same private prefix layout as Codex', async () => {
    const root = fixtureRoot();
    try {
      const service = createKernelUpdateService({
        rootDir: root,
        installer: { command: 'node', prefixArgs: ['npm-cli.js'] },
        run: async (args) => {
          if (args[0] === 'view') return { exitCode: 0, stdout: '"1.2.3"', stderr: '' };
          const prefix = args[args.indexOf('--prefix') + 1]!;
          packageExecutable(prefix, '@earendil-works/pi-coding-agent', '1.2.3');
          return { exitCode: 0, stdout: 'installed', stderr: '' };
        },
      });

      const result = await service.installUpdate('pi');
      const manifest = JSON.parse(readFileSync(join(root, 'active.json'), 'utf8')) as {
        active: { pi: { version: string; packageName: string; executablePath: string } };
      };

      expect(result.ok).toBe(true);
      expect(manifest.active.pi).toEqual(
        expect.objectContaining({
          version: '1.2.3',
          packageName: '@earendil-works/pi-coding-agent',
        }),
      );
      expect(manifest.active.pi.executablePath).toContain(join('versions', 'pi', '1.2.3'));
      expect(existsSync(manifest.active.pi.executablePath)).toBe(true);
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

  it('converts installer exceptions into a terminal error state', async () => {
    const root = fixtureRoot();
    try {
      const service = createKernelUpdateService({
        rootDir: root,
        installer: { command: 'node', prefixArgs: ['npm-cli.js'] },
        run: async (args) => {
          if (args[0] === 'view') return { exitCode: 0, stdout: '"0.150.1"', stderr: '' };
          throw new Error('network unavailable');
        },
      });

      const result = await service.installUpdate('codex');

      expect(result).toMatchObject({
        ok: false,
        errorCode: 'kernel.update.install-failed',
      });
      expect(result.state.items.find((item) => item.kernelId === 'codex')).toEqual(
        expect.objectContaining({
          phase: 'error',
          errorCode: 'kernel.update.install-failed',
        }),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('installs different kernels at the same time without a global lock', async () => {
    const root = fixtureRoot();
    try {
      let releaseCodex: (() => void) | undefined;
      const codexGate = new Promise<void>((resolve) => {
        releaseCodex = resolve;
      });
      const started: string[] = [];
      const service = createKernelUpdateService({
        rootDir: root,
        installer: { command: 'node', prefixArgs: ['npm-cli.js'] },
        run: async (args) => {
          if (args[0] === 'view') {
            return {
              exitCode: 0,
              stdout: args.includes('@openai/codex') ? '"0.150.1"' : '"2.1.250"',
              stderr: '',
            };
          }
          const spec = args.find((arg) => arg.includes('@')) ?? '';
          started.push(spec);
          if (spec.startsWith('@openai/codex@')) await codexGate;
          const prefix = args[args.indexOf('--prefix') + 1]!;
          packageExecutable(
            prefix,
            spec.startsWith('@openai/codex@') ? '@openai/codex' : '@anthropic-ai/claude-code',
            spec.startsWith('@openai/codex@') ? '0.150.1' : '2.1.250',
          );
          return { exitCode: 0, stdout: 'installed', stderr: '' };
        },
      });

      const codex = service.installUpdate('codex');
      await vi.waitFor(() => expect(started.some((spec) => spec.startsWith('@openai/codex@'))).toBe(true));
      const claude = service.installUpdate('claude-code');
      await vi.waitFor(() =>
        expect(started.some((spec) => spec.startsWith('@anthropic-ai/claude-code@'))).toBe(true),
      );
      releaseCodex?.();

      const [codexResult, claudeResult] = await Promise.all([codex, claude]);
      const manifest = JSON.parse(readFileSync(join(root, 'active.json'), 'utf8')) as {
        active: { codex: { version: string }; 'claude-code': { version: string } };
      };

      expect(codexResult.ok).toBe(true);
      expect(claudeResult.ok).toBe(true);
      expect(manifest.active.codex.version).toBe('0.150.1');
      expect(manifest.active['claude-code'].version).toBe('2.1.250');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a second install of the same kernel while the first is still running', async () => {
    const root = fixtureRoot();
    try {
      let releaseCodex: (() => void) | undefined;
      const codexGate = new Promise<void>((resolve) => {
        releaseCodex = resolve;
      });
      let installs = 0;
      const service = createKernelUpdateService({
        rootDir: root,
        installer: { command: 'node', prefixArgs: ['npm-cli.js'] },
        run: async (args) => {
          if (args[0] === 'view') return { exitCode: 0, stdout: '"0.150.1"', stderr: '' };
          installs += 1;
          await codexGate;
          const prefix = args[args.indexOf('--prefix') + 1]!;
          packageExecutable(prefix, '@openai/codex', '0.150.1');
          return { exitCode: 0, stdout: 'installed', stderr: '' };
        },
      });

      const first = service.installUpdate('codex');
      await vi.waitFor(() => expect(installs).toBe(1));
      await expect(service.installUpdate('codex')).resolves.toMatchObject({
        ok: false,
        errorCode: 'kernel.update.busy',
      });
      releaseCodex?.();
      await expect(first).resolves.toMatchObject({ ok: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
