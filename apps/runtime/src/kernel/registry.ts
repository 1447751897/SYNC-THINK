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
import { isVersionSupported } from './version-compat.js';
import { nativeKernelAdapter } from './native-kernel-adapter.js';
import { ClaudeCodeKernelAdapter } from './claude-code-adapter.js';
import { CodexAppServerKernelAdapter } from './codex-app-server-adapter.js';

export interface KernelRegistryEntry {
  id: KernelId;
  /** Display name (kernel selector UI). */
  name: string;
  /** Icon asset key (kernel selector UI). */
  icon: string;
  /** in-process = existing runtime loop; subprocess = spawned harness. */
  kind: 'in-process' | 'subprocess';
  capabilities: KernelCapabilities;
  /** Exact versions we smoke-tested; always accepted. */
  knownGoodVersions: readonly string[];
  /**
   * Lowest version considered compatible. Detected versions at or above this
   * count as known-good, so routine kernel updates no longer surface as
   * 「版本未验证」without a code change.
   */
  minimumSupportedVersion?: string;
  /**
   * Exclusive upper bound (usually the next major). Keeps a breaking kernel
   * release from being silently accepted before it is validated.
   */
  upperExclusiveVersion?: string;
  /** Human-readable guided-install command shown for missing kernels. */
  installCommand?: string;
  /** Lazily created adapter; undefined until the kernel is wired. */
  createAdapter?: () => KernelAdapter;
  detect(): Promise<KernelDetectionResult>;
}

function toDetectionResult(
  entry: Pick<
    KernelRegistryEntry,
    | 'id'
    | 'name'
    | 'icon'
    | 'capabilities'
    | 'knownGoodVersions'
    | 'minimumSupportedVersion'
    | 'upperExclusiveVersion'
    | 'installCommand'
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
    knownGood: isVersionSupported(version, {
      verifiedVersions: entry.knownGoodVersions,
      ...(entry.minimumSupportedVersion
        ? { minimumSupportedVersion: entry.minimumSupportedVersion }
        : {}),
      ...(entry.upperExclusiveVersion
        ? { upperExclusiveVersion: entry.upperExclusiveVersion }
        : {}),
    }),
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
      // No CLI/config entry to override the window; CC auto-compacts on its own
      // 200k native budget, so the host must trim to min(configured, 200k).
      contextWindow: { nativeLimit: 200_000, overridable: false },
    },
    knownGoodVersions: ['2.1.222'],
    // Accept the whole 2.x line; 3.0 must be re-validated before it is trusted.
    minimumSupportedVersion: '2.0.0',
    upperExclusiveVersion: '3.0.0',
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
      // Codex speaks only the OpenAI Responses dialect: the Chat wire API was
      // removed upstream in 2026-02. Declaring
      // openai-chat here would make kernelNeedsGateway skip the bridge for
      // Chat-only upstreams (e.g. DeepSeek) and Codex would then miss provider
      // reasoning (thinking is not exposed over the Chat wire).
      protocols: ['openai-responses'],
      permission: 'own',
      permissionBridge: true,
      pause: 'turn',
      compress: 'own',
      usageReport: true,
      // app-server accepts per-thread context configuration; nativeLimit is
      // informational when the host supplies a smaller configured window.
      contextWindow: { nativeLimit: 128_000, overridable: true },
    },
    knownGoodVersions: ['0.145.0'],
    // Codex is pre-1.0; the CLI protocol has been stable since 0.140.
    minimumSupportedVersion: '0.140.0',
    upperExclusiveVersion: '1.0.0',
    installCommand: 'npm i -g @openai/codex',
    createAdapter: () => new CodexAppServerKernelAdapter(),
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
      name: 'Sync-Think',
      icon: 'native',
      kind: 'in-process',
      capabilities: nativeKernelAdapter.capabilities,
      knownGoodVersions: nativeKernelAdapter.knownGoodVersions,
      createAdapter: () => nativeKernelAdapter,
      detect: async () => ({
        kernelId: 'native',
        name: 'Sync-Think',
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
