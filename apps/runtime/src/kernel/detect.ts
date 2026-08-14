/**
 * Local kernel detection: resolve the executable on PATH / common install dirs,
 * then probe `--version` and parse the output.
 *
 * Patterns reused from the codebase: PATH+PATHEXT resolution mirrors
 * packages/workers/src/process-runner.ts (resolveWindowsExecutable); the
 * spawnSync + stdout-parse probe mirrors apps/desktop runtime-supervisor.ts
 * (nodeMajor). Registry probing (Win32 registry) is deferred.
 */
import { existsSync } from 'node:fs';
import { delimiter, extname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { KernelId } from '@sync-think/shared';

export interface KernelProbeResult {
  /** Resolved executable path, or null when not found on any search path. */
  executablePath: string | null;
  /** Parsed version string, or null when the probe failed / not installed. */
  version: string | null;
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
export function resolveExecutablePath(command: string): string | null {
  if (existsSync(command)) return command;
  if (extname(command)) {
    // Has an explicit extension but is not an absolute existing path — try PATH only.
  }
  const extensions = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .filter(Boolean);
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

/** First semver-looking token in a version string (`2.1.222` from `2.1.222 (Claude Code)`). */
export function extractSemverVersion(output: string): string | null {
  const match = /\d+\.\d+\.\d+/.exec(output);
  return match ? match[0] : null;
}

const PROBE_TIMEOUT_MS = 5000;

/**
 * Run `<executablePath> --version` and parse the first semver token.
 * Returns null when the binary is missing, times out, or prints no version.
 *
 * On Windows, npm-global kernels resolve to `.cmd` shims which Node cannot
 * exec directly (EINVAL); they are routed through cmd.exe with the quoted-path
 * pattern from packages/workers process-runner.ts (buildSafeCmdShimCommand).
 * Args are the fixed `--version` — no shell injection surface.
 */
export function probeVersion(executablePath: string): string | null {
  const isCmdShim = /\.(?:cmd|bat)$/i.test(executablePath);
  const result = isCmdShim
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${executablePath}" --version`], {
        encoding: 'utf8',
        timeout: PROBE_TIMEOUT_MS,
        windowsHide: true,
        windowsVerbatimArguments: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    : spawnSync(executablePath, ['--version'], {
        encoding: 'utf8',
        timeout: PROBE_TIMEOUT_MS,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
  if (result.error || result.status !== 0) return null;
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  return extractSemverVersion(output);
}

/** Probe a kernel by its CLI command. Returns paths + version, never throws. */
export function probeKernel(command: string): KernelProbeResult {
  try {
    const executablePath = resolveExecutablePath(command);
    if (!executablePath) return { executablePath: null, version: null };
    return { executablePath, version: probeVersion(executablePath) };
  } catch {
    return { executablePath: null, version: null };
  }
}

export const KERNEL_COMMANDS: Record<Exclude<KernelId, 'native'>, string> = {
  'claude-code': 'claude',
  codex: 'codex',
  pi: 'pi',
};
