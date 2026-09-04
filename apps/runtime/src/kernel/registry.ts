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
import { ClaudeSdkKernelAdapter } from './claude-sdk-adapter.js';
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

/**
 * Detection for kernels whose binary ships inside an SDK dependency.
 *
 * There is no PATH lookup and no "not installed" state to guide the user out
 * of: if the dependency resolves, the kernel is usable. A null version means a
 * broken install (missing/unreadable manifest), which we surface as
 * not-installed so the selector does not offer a kernel that cannot start.
 */
async function bundledDetectionResult(
  entry: Pick<
    KernelRegistryEntry,
    | 'id'
    | 'name'
    | 'icon'
    | 'capabilities'
    | 'knownGoodVersions'
    | 'minimumSupportedVersion'
    | 'upperExclusiveVersion'
  >,
  adapter: KernelAdapter,
): Promise<KernelDetectionResult> {
  const version = await adapter.detectVersion();
  return {
    kernelId: entry.id,
    name: entry.name,
    icon: entry.icon,
    capabilities: entry.capabilities,
    installed: version !== null,
    version,
    // Bundled binaries have no host-visible executable to display.
    executablePath: null,
    knownGood: isVersionSupported(version, {
      verifiedVersions: entry.knownGoodVersions,
      ...(entry.minimumSupportedVersion
        ? { minimumSupportedVersion: entry.minimumSupportedVersion }
        : {}),
      ...(entry.upperExclusiveVersion
        ? { upperExclusiveVersion: entry.upperExclusiveVersion }
        : {}),
    }),
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
      // Claude Code now accepts the host-configured model window (up to 1M).
      // The adapter forwards it as CLAUDE_CODE_AUTO_COMPACT_WINDOW.
      contextWindow: { nativeLimit: 1_000_000, overridable: true },
    },
    knownGoodVersions: ['2.1.222', '2.1.238'],
    // Accept the whole 2.x line; 3.0 must be re-validated before it is trusted.
    minimumSupportedVersion: '2.0.0',
    upperExclusiveVersion: '3.0.0',
    // No install command: the Agent SDK dependency ships the CLI binary, so a
    // globally installed `claude` is neither required nor consulted.
    // Fresh instance per run — the adapter holds per-run session state.
    createAdapter: () => new ClaudeSdkKernelAdapter(),
    detect: async () => bundledDetectionResult(claudeCodeEntry, new ClaudeSdkKernelAdapter()),
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
    installCommand: '应用私有目录',
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
