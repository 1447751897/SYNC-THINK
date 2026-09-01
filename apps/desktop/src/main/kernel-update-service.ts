import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import type {
  ManagedKernelUpdateActionResult,
  ManagedKernelUpdateId,
  ManagedKernelUpdateItem,
  ManagedKernelUpdatePhase,
  ManagedKernelUpdateSnapshot,
} from '../kernel-update-contract.js';

const NPM_REGISTRY = 'https://registry.npmjs.org/';
const OUTPUT_LIMIT = 256 * 1024;
const INSTALL_TIMEOUT_MS = 5 * 60_000;

const KERNELS: Record<
  ManagedKernelUpdateId,
  {
    name: string;
    packageName: string;
    windowsBin: (prefix: string) => string;
    unixBin: (prefix: string) => string;
  }
> = {
  codex: {
    name: 'Codex',
    packageName: '@openai/codex',
    windowsBin: (prefix) => join(prefix, 'codex.cmd'),
    unixBin: (prefix) => join(prefix, 'bin', 'codex'),
  },
  'claude-code': {
    name: 'Claude Code',
    packageName: '@anthropic-ai/claude-code',
    windowsBin: (prefix) =>
      join(prefix, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
    unixBin: (prefix) => join(prefix, 'bin', 'claude'),
  },
  pi: {
    name: 'Pi',
    packageName: '@earendil-works/pi-coding-agent',
    windowsBin: (prefix) => join(prefix, 'pi.cmd'),
    unixBin: (prefix) => join(prefix, 'bin', 'pi'),
  },
};

export interface KernelInstallerInvocation {
  command: string;
  prefixArgs: string[];
}

export interface KernelInstallerRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface ActiveKernelRecord {
  version: string;
  packageName: string;
  executablePath: string;
}

interface ActiveKernelManifest {
  schemaVersion: 1;
  active: Partial<Record<ManagedKernelUpdateId, ActiveKernelRecord>>;
}

export interface KernelUpdateServiceOptions {
  rootDir: string;
  installer: KernelInstallerInvocation | null;
  run?: (args: string[]) => Promise<KernelInstallerRunResult>;
  now?: () => Date;
}

export function resolveKernelInstallerInvocation(
  nodeExecutable: string | null,
  environment: NodeJS.ProcessEnv = process.env,
): KernelInstallerInvocation | null {
  const npmScripts = [
    environment.SYNC_THINK_NPM_CLI,
    environment.npm_execpath && /(?:^|[\\/])npm-cli\.js$/i.test(environment.npm_execpath)
      ? environment.npm_execpath
      : undefined,
    nodeExecutable
      ? join(dirname(nodeExecutable), 'node_modules', 'npm', 'bin', 'npm-cli.js')
      : undefined,
  ].filter((value): value is string => Boolean(value));
  if (nodeExecutable) {
    for (const script of npmScripts) {
      if (existsSync(script)) return { command: nodeExecutable, prefixArgs: [script] };
    }
  }
  const executableName = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  for (const entry of (environment.PATH ?? '').split(delimiter).filter(Boolean)) {
    const candidate = join(entry.replace(/^"|"$/g, ''), executableName);
    if (existsSync(candidate)) return { command: candidate, prefixArgs: [] };
  }
  return null;
}

function emptyManifest(): ActiveKernelManifest {
  return { schemaVersion: 1, active: {} };
}

function readManifest(rootDir: string): ActiveKernelManifest {
  try {
    const value = JSON.parse(
      readFileSync(join(rootDir, 'active.json'), 'utf8'),
    ) as ActiveKernelManifest;
    if (value.schemaVersion !== 1 || !value.active || typeof value.active !== 'object') {
      return emptyManifest();
    }
    return value;
  } catch {
    return emptyManifest();
  }
}

function isInsideRoot(rootDir: string, candidate: string): boolean {
  const root = resolve(rootDir);
  const path = resolve(candidate);
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  return path === root || path.startsWith(prefix);
}

function validActiveRecord(
  rootDir: string,
  kernelId: ManagedKernelUpdateId,
  record: ActiveKernelRecord | undefined,
): record is ActiveKernelRecord {
  return Boolean(
    record &&
    record.packageName === KERNELS[kernelId].packageName &&
    /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(record.version) &&
    isInsideRoot(rootDir, record.executablePath) &&
    existsSync(record.executablePath),
  );
}

function parseVersion(output: string): string | null {
  const trimmed = output.trim();
  try {
    const value = JSON.parse(trimmed) as unknown;
    if (typeof value === 'string' && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value)) {
      return value;
    }
  } catch {
    // npm may print a bare version when a custom registry proxy drops JSON formatting.
  }
  const match = trimmed.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/);
  return match?.[0] ?? null;
}

function compareVersion(left: string, right: string): number {
  const parts = (value: string) => value.match(/\d+/g)?.map(Number) ?? [];
  const leftParts = parts(left);
  const rightParts = parts(right);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function installedExecutable(prefix: string, kernelId: ManagedKernelUpdateId): string {
  const config = KERNELS[kernelId];
  return process.platform === 'win32' ? config.windowsBin(prefix) : config.unixBin(prefix);
}

function verifyInstallation(
  prefix: string,
  kernelId: ManagedKernelUpdateId,
  expectedVersion: string,
): boolean {
  const config = KERNELS[kernelId];
  const packagePath = join(
    prefix,
    'node_modules',
    ...config.packageName.split('/'),
    'package.json',
  );
  try {
    const manifest = JSON.parse(readFileSync(packagePath, 'utf8')) as {
      name?: unknown;
      version?: unknown;
    };
    return (
      manifest.name === config.packageName &&
      manifest.version === expectedVersion &&
      existsSync(installedExecutable(prefix, kernelId))
    );
  } catch {
    return false;
  }
}

function writeManifest(rootDir: string, manifest: ActiveKernelManifest): void {
  mkdirSync(rootDir, { recursive: true });
  const path = join(rootDir, 'active.json');
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8' });
  renameSync(temporary, path);
}

function defaultRun(
  installer: KernelInstallerInvocation,
  args: string[],
): Promise<KernelInstallerRunResult> {
  return new Promise((resolveRun) => {
    const child = spawn(installer.command, [...installer.prefixArgs, ...args], {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, npm_config_update_notifier: 'false' },
    });
    let stdout = '';
    let stderr = '';
    const append = (current: string, chunk: Buffer | string): string =>
      `${current}${String(chunk)}`.slice(-OUTPUT_LIMIT);
    child.stdout?.on('data', (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr = append(stderr, chunk);
    });
    const timer = setTimeout(() => child.kill(), INSTALL_TIMEOUT_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolveRun({ exitCode: null, stdout, stderr: append(stderr, error.message) });
    });
    child.on('exit', (exitCode) => {
      clearTimeout(timer);
      resolveRun({ exitCode, stdout, stderr });
    });
  });
}

export function createKernelUpdateService(options: KernelUpdateServiceOptions) {
  const rootDir = resolve(options.rootDir);
  const now = options.now ?? (() => new Date());
  const latest = new Map<ManagedKernelUpdateId, string>();
  const phases = new Map<ManagedKernelUpdateId, ManagedKernelUpdatePhase>();
  const errors = new Map<ManagedKernelUpdateId, string>();
  let checkedAt: string | null = null;
  let busy = false;

  const run = async (args: string[]): Promise<KernelInstallerRunResult> => {
    if (options.run) return options.run(args);
    if (!options.installer) return { exitCode: null, stdout: '', stderr: 'installer missing' };
    return defaultRun(options.installer, args);
  };

  const snapshot = (): ManagedKernelUpdateSnapshot => {
    const manifest = readManifest(rootDir);
    const items = (Object.keys(KERNELS) as ManagedKernelUpdateId[]).map((kernelId) => {
      const config = KERNELS[kernelId];
      const record = manifest.active[kernelId];
      const managedVersion = validActiveRecord(rootDir, kernelId, record) ? record.version : null;
      const latestVersion = latest.get(kernelId) ?? null;
      let phase = phases.get(kernelId) ?? 'idle';
      if (phase === 'idle' && latestVersion) {
        phase =
          managedVersion && compareVersion(managedVersion, latestVersion) >= 0
            ? 'up-to-date'
            : 'available';
      }
      return {
        kernelId,
        name: config.name,
        packageName: config.packageName,
        managedVersion,
        latestVersion,
        phase,
        errorCode: errors.get(kernelId) ?? null,
      } satisfies ManagedKernelUpdateItem;
    });
    return {
      schemaVersion: 1,
      installerAvailable: options.installer !== null,
      checkedAt,
      items,
    };
  };

  const failure = (errorCode: string): ManagedKernelUpdateActionResult => ({
    ok: false,
    state: snapshot(),
    errorCode,
  });

  const checkOne = async (kernelId: ManagedKernelUpdateId): Promise<string | null> => {
    phases.set(kernelId, 'checking');
    errors.delete(kernelId);
    const result = await run([
      'view',
      KERNELS[kernelId].packageName,
      'version',
      '--json',
      '--registry',
      NPM_REGISTRY,
    ]);
    const version = result.exitCode === 0 ? parseVersion(result.stdout) : null;
    if (!version) {
      phases.set(kernelId, 'error');
      errors.set(kernelId, 'kernel.update.check-failed');
      return null;
    }
    latest.set(kernelId, version);
    const record = readManifest(rootDir).active[kernelId];
    phases.set(
      kernelId,
      validActiveRecord(rootDir, kernelId, record) && compareVersion(record.version, version) >= 0
        ? 'up-to-date'
        : 'available',
    );
    return version;
  };

  return {
    getSnapshot: snapshot,
    async checkForUpdates(
      kernelId?: ManagedKernelUpdateId,
    ): Promise<ManagedKernelUpdateActionResult> {
      if (kernelId && !KERNELS[kernelId]) return failure('kernel.update.kernel-invalid');
      if (!options.installer) return failure('kernel.update.installer-missing');
      if (busy) return failure('kernel.update.busy');
      busy = true;
      try {
        const targets = kernelId
          ? [kernelId]
          : (Object.keys(KERNELS) as ManagedKernelUpdateId[]);
        const versions = await Promise.all(targets.map(checkOne));
        checkedAt = now().toISOString();
        const ok = versions.every(Boolean);
        return {
          ok,
          state: snapshot(),
          errorCode: ok ? null : 'kernel.update.check-failed',
        };
      } finally {
        busy = false;
      }
    },
    async installUpdate(kernelId: ManagedKernelUpdateId): Promise<ManagedKernelUpdateActionResult> {
      if (!KERNELS[kernelId]) return failure('kernel.update.kernel-invalid');
      if (!options.installer) return failure('kernel.update.installer-missing');
      if (busy) return failure('kernel.update.busy');
      busy = true;
      try {
        errors.delete(kernelId);
        let version = latest.get(kernelId) ?? null;
        if (!version) version = await checkOne(kernelId);
        if (!version) return failure('kernel.update.check-failed');
        phases.set(kernelId, 'installing');
        const finalPrefix = join(rootDir, 'versions', kernelId, version);
        if (!verifyInstallation(finalPrefix, kernelId, version)) {
          const stagingPrefix = join(rootDir, 'staging', `${kernelId}-${version}-${randomUUID()}`);
          mkdirSync(dirname(stagingPrefix), { recursive: true });
          const install = await run([
            'install',
            '--global',
            '--prefix',
            stagingPrefix,
            `${KERNELS[kernelId].packageName}@${version}`,
            '--registry',
            NPM_REGISTRY,
            '--include=optional',
            '--fetch-timeout=30000',
            '--no-audit',
            '--no-fund',
          ]);
          if (install.exitCode !== 0) {
            phases.set(kernelId, 'error');
            errors.set(kernelId, 'kernel.update.install-failed');
            return failure('kernel.update.install-failed');
          }
          if (!verifyInstallation(stagingPrefix, kernelId, version)) {
            phases.set(kernelId, 'error');
            errors.set(kernelId, 'kernel.update.verify-failed');
            return failure('kernel.update.verify-failed');
          }
          mkdirSync(dirname(finalPrefix), { recursive: true });
          if (!existsSync(finalPrefix)) renameSync(stagingPrefix, finalPrefix);
        }
        if (!verifyInstallation(finalPrefix, kernelId, version)) {
          phases.set(kernelId, 'error');
          errors.set(kernelId, 'kernel.update.verify-failed');
          return failure('kernel.update.verify-failed');
        }
        const manifest = readManifest(rootDir);
        manifest.active[kernelId] = {
          version,
          packageName: KERNELS[kernelId].packageName,
          executablePath: installedExecutable(finalPrefix, kernelId),
        };
        writeManifest(rootDir, manifest);
        phases.set(kernelId, 'installed');
        checkedAt = now().toISOString();
        return { ok: true, state: snapshot(), errorCode: null };
      } finally {
        busy = false;
      }
    },
  };
}

export type KernelUpdateService = ReturnType<typeof createKernelUpdateService>;
