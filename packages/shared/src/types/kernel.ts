/**
 * Multi-kernel contract types.
 *
 * Design baseline: docs/engineering/06-multi-kernel-architecture.md §4 (定稿).
 * These are pure types shared by the protocol layer (command payloads), the
 * runtime (adapters / run dispatch) and the desktop shell (kernel selector UI).
 *
 * Concept notes (from the design doc):
 * - A **kernel** is a full harness that runs the agent loop on its own
 *   (protocol adaptation, tool loop, context management, permissions, I/O).
 *   claude.exe / codex / pi / SYNC-THINK's own runtime are all kernels.
 * - SYNC-THINK is the **host**: it spawns kernels, translates their events into
 *   the unified event stream, persists history and injects platform tools.
 *   It never touches the kernel's own compression / retry / tool loop.
 */

/** Kernel identity used across protocol payloads, the registry and the UI. */
export type KernelId = 'native' | 'claude-code' | 'codex' | 'pi' | (string & {});

/** Host-side permission tier mapped onto each kernel's own permission system. */
export type KernelPermissionMode = 'full-access' | 'ask' | 'workspace';

/**
 * Declared kernel capabilities. These drive UI degradation and the permission
 * strategy — they are part of the contract, not post-hoc annotations.
 */
export interface KernelCapabilities {
  /** Native wire protocols the kernel speaks (used for credential/baseUrl routing). */
  protocols: Array<'anthropic-messages' | 'openai-chat' | 'openai-responses'>;
  /** 'own' = the kernel has its own permission system; 'none' = fully trusting. */
  permission: 'own' | 'none';
  /** true when permission requests can be bridged to the host approval card. */
  permissionBridge: boolean;
  /**
   * Pause semantics:
   * - 'executor' = executor-level pause/resume (native)
   * - 'turn'     = stop only the current turn (Claude Code, Esc semantics)
   * - 'session'  = pausing closes the session (Codex, Ctrl+C semantics)
   * - 'kill'     = kill the process tree, no resume (Pi)
   */
  pause: 'executor' | 'turn' | 'session' | 'kill';
  /** 'own' = the kernel compresses its own context; 'none' = host must not rely on it. */
  compress: 'own' | 'none';
  /** Whether the kernel reports usage events to the host. */
  usageReport: boolean;
}

/**
 * Normalized usage report. The minimal contract is { real, window }; input /
 * output / cached splits are aligned to the coarsest granularity each kernel
 * reports (missing fields stay undefined — the host never estimates).
 */
export interface KernelUsage {
  /** Real token consumption reported by the kernel. */
  real: number;
  /** Echoed context window the host configured for this run. */
  window: number;
  input?: number;
  output?: number;
  cached?: number;
  /** Optional provider/model identity used by the host usage accounting. */
  providerId?: string;
  modelId?: string;
}

/** A permission request bridged from the kernel to the host approval card. */
export interface KernelPermissionRequest {
  requestId: string;
  toolName: string;
  toolInput: unknown;
  reason?: string;
}

/** Host decision sent back to the kernel via the permission bridge. */
export interface KernelPermissionDecision {
  allow: boolean;
  /** For allow: the possibly-updated tool input the kernel must use. */
  updatedInput?: unknown;
  /** For deny: the message shown to the model. */
  message?: string;
}

/**
 * Credential material injected into a kernel spawn. Secrets never leave the
 * kernel adapter scope and never enter events/logs (scrub on the way out).
 */
export interface KernelCredential {
  /** Provider base URL (e.g. a relay-station Messages/OpenAI endpoint). */
  baseUrl?: string;
  /** Plaintext secret resolved from the host credential store. */
  apiKey?: string;
  /** true = prefer the kernel's local login state (OAuth) over injected keys. */
  reuseLocalLogin?: boolean;
}

/** Host platform-tool definition injected into a kernel (via MCP this round). */
export interface PlatformToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/** Everything the host hands a kernel before it starts a run. */
export interface KernelRequest {
  kernelId: KernelId;
  /** Internal catalog model id. */
  model: string;
  /** Provider-facing model string the kernel should use. */
  providerModelId: string;
  /** User message that starts this run (one run = one user turn). */
  userText: string;
  /** Host-configured context window capacity (§2.3 ①). */
  contextWindow: number;
  credential: KernelCredential;
  /** Shared facts + team context injected into the system prompt. */
  systemContext: string;
  /** Platform tools to register with the kernel. */
  platformTools: PlatformToolDefinition[];
  permissionMode: KernelPermissionMode;
  workspaceDir: string;
}

/**
 * Unified kernel event stream. The render/persistence layers only know this
 * vocabulary; unknown kernel events are ignored + logged, absent event types
 * degrade the UI (mapping principle from the design doc §4.1).
 */
export type KernelEvent =
  | { type: 'delta'; text: string }
  | { type: 'reasoning'; text: string }
  | {
      type: 'tool-call';
      toolId: string;
      name: string;
      argsJson: string;
      partial: boolean;
    }
  | { type: 'tool-result'; toolId: string; output: string; isError: boolean }
  | {
      type: 'permission-request';
      requestId: string;
      toolName: string;
      toolInput: unknown;
    }
  | { type: 'usage'; usage: KernelUsage }
  /** Optional notification that the kernel compacted its own context. */
  | { type: 'compacted' }
  | { type: 'terminal'; status: 'completed' | 'failed'; error?: string };

/**
 * KernelAdapter — the uniform contract every kernel implements (design doc §4).
 *
 * `native` is a special case: it runs in-process (the existing runtime loop) and
 * the host dispatch bypasses `start()` for it, so zero behavior is changed.
 * Subprocess kernels implement `start()` and translate their protocol events.
 */
export interface KernelAdapter {
  readonly id: KernelId;
  /** Display name (kernel selector UI). */
  readonly name: string;
  /** Kernel icon asset key (kernel selector UI). */
  readonly icon: string;
  readonly capabilities: KernelCapabilities;
  /** Versions the adapter has been tested against (yellow-bar hint on mismatch). */
  readonly knownGoodVersions: readonly string[];
  /** Probe the locally installed version, or null when not installed. */
  detectVersion(): Promise<string | null>;
  /** Spawn + inject config, return the normalized event stream. */
  start(request: KernelRequest): AsyncIterable<KernelEvent>;
  stop(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  cancel(): Promise<void>;
  /** Process exit callback (code + stderr tail). */
  onExit(callback: (code: number | null, stderrTail: string) => void): void;
  /** Permission bridge (only kernels with capabilities.permissionBridge = true). */
  onPermissionRequest(callback: (request: KernelPermissionRequest) => void): void;
  respondPermission(requestId: string, decision: KernelPermissionDecision): void;
  /** Usage bridge (only kernels with capabilities.usageReport = true). */
  onUsage(callback: (usage: KernelUsage) => void): void;
}

/** Result of a local kernel detection sweep (PATH + common install paths). */
export interface KernelDetectionResult {
  kernelId: KernelId;
  installed: boolean;
  /** Parsed version string, or null when the probe failed. */
  version: string | null;
  /** Resolved executable path, or null when not found. */
  executablePath: string | null;
  /** true when the version matches a knownGoodVersions entry. */
  knownGood: boolean;
  /** Human-readable install guidance shown in the kernel selector. */
  installHint?: string;
}
