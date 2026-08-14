/**
 * Kernel registry — the adapter lookup table the host dispatch and the UI both
 * read (design doc §4 / §5.6). Each entry declares capabilities, known-good
 * versions, an optional install command and a lazy adapter factory. External
 * kernel adapters are added in later slices; until then `createAdapter()` is
 * undefined and the kernel appears in the selector as "未接入/未安装".
 */
import type {
  KernelAdapter,
  KernelCapabilities,
  KernelDetectionResult,
  KernelId,
} from '@sync-think/shared';
import { KERNEL_COMMANDS, probeKernel } from './detect.js';
import { nativeKernelAdapter } from './native-kernel-adapter.js';
import { ClaudeCodeKernelAdapter } from './claude-code-adapter.js';
import { CodexKernelAdapter } from './codex-adapter.js';

export interface KernelRegistryEntry {
  id: KernelId;
  /** Display name (kernel selector UI). */
  name: string;
  /** Icon asset key (kernel selector UI). */
  icon: string;
  /** in-process = existing runtime loop; subprocess = spawned harness. */
  kind: 'in-process' | 'subprocess';
  capabilities: KernelCapabilities;
  knownGoodVersions: readonly string[];
  /** Human-readable guided-install command shown for missing kernels. */
  installCommand?: string;
  /** Lazily created adapter; undefined until the kernel is wired. */
  createAdapter?: () => KernelAdapter;
  detect(): Promise<KernelDetectionResult>;
}

function toDetectionResult(
  entry: Pick<
    KernelRegistryEntry,
    'id' | 'name' | 'icon' | 'capabilities' | 'knownGoodVersions' | 'installCommand'
  >,
): KernelDetectionResult {
  const probe = probeKernel(KERNEL_COMMANDS[entry.id as Exclude<KernelId, 'native'>]);
  const version = probe.version;
  return {
    kernelId: entry.id,
    name: entry.name,
    icon: entry.icon,
    capabilities: entry.capabilities,
    ...(entry.installCommand ? { installCommand: entry.installCommand } : {}),
    installed: probe.executablePath !== null && version !== null,
    version,
    executablePath: probe.executablePath,
    knownGood: version !== null && entry.knownGoodVersions.includes(version),
    ...(entry.id === 'pi' && entry.installCommand
      ? { installHint: entry.installCommand }
      : {}),
  };
}

export function buildKernelRegistry(): KernelRegistryEntry[] {
  const claudeCodeEntry: KernelRegistryEntry = {
    id: 'claude-code',
    name: 'Claude Code',
    icon: 'claude-code',
    kind: 'subprocess',
    capabilities: {
      protocols: ['anthropic-messages'],
      permission: 'own',
      permissionBridge: true,
      pause: 'turn',
      compress: 'own',
      usageReport: true,
    },
    knownGoodVersions: ['2.1.222'],
    installCommand: 'npm i -g @anthropic-ai/claude-code',
    // Fresh instance per run — the adapter holds per-run process state.
    createAdapter: () => new ClaudeCodeKernelAdapter(),
    detect: async () => toDetectionResult(claudeCodeEntry),
  };
  const codexEntry: KernelRegistryEntry = {
    id: 'codex',
    name: 'Codex',
    icon: 'codex',
    kind: 'subprocess',
    capabilities: {
      protocols: ['openai-chat', 'openai-responses'],
      permission: 'own',
      permissionBridge: false,
      pause: 'session',
      compress: 'own',
      usageReport: true,
    },
    knownGoodVersions: ['0.145.0'],
    installCommand: 'npm i -g @openai/codex',
    createAdapter: () => new CodexKernelAdapter(),
    detect: async () => toDetectionResult(codexEntry),
  };
  const piEntry: KernelRegistryEntry = {
    id: 'pi',
    name: 'Pi',
    icon: 'pi',
    kind: 'subprocess',
    capabilities: {
      protocols: ['openai-chat', 'anthropic-messages'],
      permission: 'none',
      permissionBridge: false,
      pause: 'kill',
      compress: 'own',
      usageReport: false,
    },
    knownGoodVersions: [],
    installCommand: 'npm i -g pi',
    createAdapter: undefined,
    detect: async () => toDetectionResult(piEntry),
  };

  return [
    {
      id: 'native',
      name: '原生内核',
      icon: 'native',
      kind: 'in-process',
      capabilities: nativeKernelAdapter.capabilities,
      knownGoodVersions: nativeKernelAdapter.knownGoodVersions,
      createAdapter: () => nativeKernelAdapter,
      detect: async () => ({
        kernelId: 'native',
        name: '原生内核',
        icon: 'native',
        capabilities: nativeKernelAdapter.capabilities,
        installed: true,
        version: null,
        executablePath: null,
        knownGood: true,
      }),
    },
    claudeCodeEntry,
    codexEntry,
    piEntry,
  ];
}

let cachedRegistry: KernelRegistryEntry[] | undefined;

/** Singleton registry (built lazily, reused across the runtime). */
export function getKernelRegistry(): KernelRegistryEntry[] {
  if (!cachedRegistry) cachedRegistry = buildKernelRegistry();
  return cachedRegistry;
}

/** Resolve an entry by kernel id; unknown ids fall back to native. */
export function resolveKernelEntry(kernelId?: string): KernelRegistryEntry {
  const registry = getKernelRegistry();
  if (!kernelId || kernelId === 'native') {
    return registry.find((entry) => entry.id === 'native') ?? registry[0];
  }
  return (
    registry.find((entry) => entry.id === kernelId) ??
    registry.find((entry) => entry.id === 'native') ??
    registry[0]
  );
}

/** Resolve the adapter for a kernel id (undefined when not yet wired). */
export function resolveKernelAdapter(kernelId?: string): KernelAdapter | undefined {
  const entry = resolveKernelEntry(kernelId);
  if (!entry.createAdapter) return undefined;
  return entry.createAdapter();
}
