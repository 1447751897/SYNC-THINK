import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

export type ManagedKernelId = 'codex' | 'claude-code' | 'pi';

interface ManagedKernelRecord {
  version?: unknown;
  packageName?: unknown;
  executablePath?: unknown;
}

const EXPECTED_PACKAGES: Record<ManagedKernelId, string> = {
  codex: '@openai/codex',
  'claude-code': '@anthropic-ai/claude-code',
  pi: '@earendil-works/pi-coding-agent',
};

export function managedKernelRoot(environment: NodeJS.ProcessEnv = process.env): string {
  if (environment.SYNC_THINK_MANAGED_KERNEL_ROOT) {
    return resolve(environment.SYNC_THINK_MANAGED_KERNEL_ROOT);
  }
  if (environment.SYNC_THINK_DB_PATH) {
    return join(dirname(resolve(environment.SYNC_THINK_DB_PATH)), 'kernels');
  }
  if (environment.LOCALAPPDATA) {
    return join(environment.LOCALAPPDATA, 'SYNC-THINK', 'kernels');
  }
  if (process.platform === 'darwin') {
    return join(environment.HOME ?? process.env.HOME ?? process.cwd(), 'Library', 'Application Support', 'SYNC-THINK', 'kernels');
  }
  return resolve(process.cwd(), '.data', 'SYNC-THINK', 'kernels');
}

function insideRoot(root: string, candidate: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const prefix = resolvedRoot.endsWith(sep) ? resolvedRoot : `${resolvedRoot}${sep}`;
  return resolvedCandidate.startsWith(prefix);
}

export function resolveManagedKernelActivation(
  kernelId: ManagedKernelId,
  environment: NodeJS.ProcessEnv = process.env,
): { executablePath: string; version: string } | null {
  const root = managedKernelRoot(environment);
  try {
    const manifest = JSON.parse(readFileSync(join(root, 'active.json'), 'utf8')) as {
      schemaVersion?: unknown;
      active?: Partial<Record<ManagedKernelId, ManagedKernelRecord>>;
    };
    const record = manifest.schemaVersion === 1 ? manifest.active?.[kernelId] : undefined;
    if (
      !record ||
      record.packageName !== EXPECTED_PACKAGES[kernelId] ||
      typeof record.version !== 'string' ||
      typeof record.executablePath !== 'string' ||
      !insideRoot(root, record.executablePath) ||
      !existsSync(record.executablePath)
    ) {
      return null;
    }
    return { executablePath: resolve(record.executablePath), version: record.version };
  } catch {
    return null;
  }
}

export function resolveManagedKernelExecutable(
  kernelId: ManagedKernelId,
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  return resolveManagedKernelActivation(kernelId, environment)?.executablePath ?? null;
}
