/**
 * Local kernel detection: resolve the executable on PATH / common install dirs,
 * then probe `--version` and parse the output.
 *
 * Patterns reused from the codebase: PATH+PATHEXT resolution mirrors
 * packages/workers/src/process-runner.ts (resolveWindowsExecutable); the
 * spawnSync + stdout-parse probe mirrors apps/desktop runtime-supervisor.ts
 * (nodeMajor). Registry probing (Win32 registry) is deferred.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { delimiter, dirname, extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { KernelId } from '@sync-think/shared';
import { resolveManagedKernelActivation, resolveManagedKernelExecutable } from './managed-kernel.js';

export interface KernelProbeResult {
  /** Resolved executable path, or null when not found on any search path. */
  executablePath: string | null;
  /** Parsed version string, or null when the probe failed / not installed. */
  version: string | null;
}

export interface ResolveCodexExecutableOptions {
  /** Override used by tests; production reads `%LOCALAPPDATA%`. */
  localAppData?: string;
  /** Already-resolved PATH candidate. `undefined` performs the normal lookup. */
  pathExecutable?: string | null;
  /** Version probe injection for deterministic filesystem tests. */
  versionProbe?: (executablePath: string) => string | null;
  /** SYNC-THINK private, atomically activated Codex candidate. */
  managedExecutable?: string | null;
}

/** Common npm/pnpm global bin directories probed in addition to PATH. */
const COMMON_BIN_DIRS = (): string[] => {
  const dirs = new Set<string>();
  const appData = process.env.APPDATA;
  const localAppData = process.env.LOCALAPPDATA;
  const userProfile = process.env.USERPROFILE;
  if (appData) dirs.add(join(appData, 'npm'));
  if (localAppData) dirs.add(join(localAppData, 'pnpm'));
  if (localAppData) dirs.add(join(localAppData, 'pnpm', 'node_modules', '.bin'));
  if (userProfile) {
    dirs.add(join(userProfile, 'node_modules', '.bin'));
    dirs.add(join(userProfile, '.local', 'bin'));
  }
  return [...dirs];
};

/**
 * Resolve a bare command (e.g. `claude`) to an absolute executable path.
 * Searches PATH + PATHEXT like the shell would, then common install dirs.
 */
function resolveExecutableOnSearchPath(command: string): string | null {
  if (existsSync(command)) return command;
  if (extname(command)) {
    // Has an explicit extension but is not an absolute existing path — try PATH only.
  }
  const extensions = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const searchDirs = [
    ...(process.env.PATH || '').split(delimiter).filter(Boolean),
    ...COMMON_BIN_DIRS(),
  ];
  for (const directory of searchDirs) {
    const dir = directory.replace(/^"|"$/g, '');
    if (!dir) continue;
    for (const extension of extensions) {
      const candidate = join(dir, `${command}${extension}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

const CODEX_WINDOWS_SIDECARS = [
  'codex-windows-sandbox-setup.exe',
  'codex-command-runner.exe',
  'codex-code-mode-host.exe',
] as const;

function compareVersions(left: string | null, right: string | null): number {
  const parts = (version: string | null): number[] =>
    version?.match(/\d+/g)?.map((part) => Number.parseInt(part, 10)) ?? [];
  const leftParts = parts(left);
  const rightParts = parts(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function completeCodexBundle(executablePath: string): boolean {
  const directory = dirname(executablePath);
  return CODEX_WINDOWS_SIDECARS.every((sidecar) => existsSync(join(directory, sidecar)));
}

/**
 * Resolve the best Windows Codex runtime.
 *
 * Codex Desktop keeps its current CLI and native helper executables under
 * `%LOCALAPPDATA%\OpenAI\Codex\bin\<runtime-id>`. A stale PATH installation can
 * still win normal command lookup, but without matching sidecars its Windows
 * sandbox fails before a command starts. Prefer a complete sidecar bundle,
 * then rank candidates by version and file freshness.
 */
export function resolveCodexExecutablePath(
  options: ResolveCodexExecutableOptions = {},
): string | null {
  const localAppData = options.localAppData ?? process.env.LOCALAPPDATA;
  const pathExecutable =
    options.pathExecutable === undefined
      ? resolveExecutableOnSearchPath('codex')
      : options.pathExecutable;
  const versionProbe = options.versionProbe ?? probeVersion;
  const managedExecutable =
    options.managedExecutable === undefined
      ? resolveManagedKernelExecutable('codex')
      : options.managedExecutable;
  if (managedExecutable) {
    if (versionProbe(managedExecutable)) return managedExecutable;
    if (resolveManagedKernelActivation('codex')) return managedExecutable;
  }
  const discovered: string[] = [];
  if (localAppData) {
    const managedRoot = join(localAppData, 'OpenAI', 'Codex', 'bin');
    try {
      for (const entry of readdirSync(managedRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const candidate = join(managedRoot, entry.name, 'codex.exe');
        if (existsSync(candidate) && completeCodexBundle(candidate)) discovered.push(candidate);
      }
    } catch {
      // Missing/unreadable app-managed runtime is a normal PATH fallback.
    }
  }
  if (pathExecutable) discovered.push(pathExecutable);

  const seen = new Set<string>();
  const candidates = discovered
    .filter((candidate) => {
      const key = process.platform === 'win32' ? candidate.toLowerCase() : candidate;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((executablePath) => ({
      executablePath,
      version: versionProbe(executablePath),
      completeBundle: completeCodexBundle(executablePath),
      modifiedAt: (() => {
        try {
          return statSync(executablePath).mtimeMs;
        } catch {
          return 0;
        }
      })(),
    }));

  candidates.sort(
    (left, right) =>
      Number(right.completeBundle) - Number(left.completeBundle) ||
      compareVersions(right.version, left.version) ||
      right.modifiedAt - left.modifiedAt,
  );
  return (
    candidates.find((candidate) => candidate.version)?.executablePath ?? pathExecutable ?? null
  );
}

export function resolveExecutablePath(command: string): string | null {
  if (existsSync(command)) return command;
  const pathExecutable = resolveExecutableOnSearchPath(command);
  if (process.platform === 'win32' && command.toLowerCase() === 'codex') {
    return resolveCodexExecutablePath({ pathExecutable });
  }
  if (command.toLowerCase() === 'codex') {
    const managed = resolveManagedKernelExecutable('codex');
    if (managed) return managed;
  }
  if (command.toLowerCase() === 'pi') {
    return resolveManagedKernelExecutable('pi');
  }
  return pathExecutable;
}

/** First semver-looking token in a version string (`2.1.222` from `2.1.222 (Claude Code)`). */
export function extractSemverVersion(output: string): string | null {
  const match = /\d+\.\d+\.\d+/.exec(output);
  return match ? match[0] : null;
}

const PROBE_TIMEOUT_MS = 5000;

export function envWithRuntimeNode(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base };
  const nodeDir = dirname(process.execPath);
  const current = env.PATH ?? env.Path ?? '';
  const alreadyPresent = current
    .split(delimiter)
    .some((entry) => entry.replace(/^"|"$/g, '') && resolve(entry.replace(/^"|"$/g, '')) === resolve(nodeDir));
  if (!alreadyPresent) {
    env.PATH = current ? `${nodeDir}${delimiter}${current}` : nodeDir;
  }
  return env;
}

/**
 * Run `<executablePath> --version` and parse the first semver token.
 * Returns null when the binary is missing, times out, or prints no version.
 *
 * On Windows, npm-global kernels resolve to `.cmd` shims which Node cannot
 * exec directly (EINVAL); they are routed through cmd.exe with the quoted-path
 * pattern from packages/workers process-runner.ts (buildSafeCmdShimCommand).
 * Args are the fixed `--version` — no shell injection surface.
 * npm shims look up `node` on PATH; prepend this Runtime's Node so a newer
 * system Node 24 cannot break a private prefix installed against Node 20.
 */
export function probeVersion(executablePath: string): string | null {
  const isCmdShim = /\.(?:cmd|bat)$/i.test(executablePath);
  const env = envWithRuntimeNode();
  const result = isCmdShim
    ? spawnSync(
        process.env.ComSpec || 'cmd.exe',
        ['/d', '/s', '/c', `"${executablePath}" --version`],
        {
          encoding: 'utf8',
          timeout: PROBE_TIMEOUT_MS,
          windowsHide: true,
          windowsVerbatimArguments: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env,
        },
      )
    : spawnSync(executablePath, ['--version'], {
        encoding: 'utf8',
        timeout: PROBE_TIMEOUT_MS,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      });
  if (result.error || result.status !== 0) return null;
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  return extractSemverVersion(output);
}

/** Probe a kernel by its CLI command. Returns paths + version, never throws. */
export function probeKernel(command: string): KernelProbeResult {
  try {
    if (command.toLowerCase() === 'pi') {
      const managed = resolveManagedKernelActivation('pi');
      if (!managed) return { executablePath: null, version: null };
      return {
        executablePath: managed.executablePath,
        version: probeVersion(managed.executablePath) ?? managed.version,
      };
    }
    const executablePath = resolveExecutablePath(command);
    if (!executablePath) return { executablePath: null, version: null };
    const probed = probeVersion(executablePath);
    if (probed) return { executablePath, version: probed };
    const managed =
      command.toLowerCase() === 'codex' ? resolveManagedKernelActivation('codex') : null;
    if (managed && resolve(managed.executablePath) === resolve(executablePath)) {
      return { executablePath, version: managed.version };
    }
    return { executablePath, version: null };
  } catch {
    return { executablePath: null, version: null };
  }
}

export const KERNEL_COMMANDS: Record<Exclude<KernelId, 'native'>, string> = {
  'claude-code': 'claude',
  codex: 'codex',
  pi: 'pi',
};
