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
  /**
   * Native context-window semantics. Omitted when the host fully controls the
   * window (native in-process kernel). For subprocess kernels:
   * - `nativeLimit` is the kernel's own window cap (tokens) when left untouched;
   * - `overridable` is true when the host can override the window via CLI/config
   *   (`-c model_context_window=<n>` for Codex, `CLAUDE_CODE_AUTO_COMPACT_WINDOW`
   *   for Claude Code) — then the effective window equals the configured value;
   *   when false the effective window is capped at `nativeLimit`.
   */
  contextWindow?: {
    nativeLimit: number;
    overridable: boolean;
  };
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
  /** Window the kernel itself reported, when the kernel exposes it (absent otherwise). */
  kernelWindow?: number;
  input?: number;
  output?: number;
  cached?: number;
  /** Provider-reported input tokens written into a prompt cache. */
  cachedTokensCreated?: number;
  /** Provider-reported reasoning tokens, when exposed separately. */
  reasoningTokens?: number;
  /** Stable identity for progressive usage reports from the same provider request. */
  requestId?: string;
  /** Provider-native response/message identity, when available. */
  providerResponseId?: string;
  /** Optional provider/model identity used by the host usage accounting. */
  providerId?: string;
  modelId?: string;
}

/** A permission request bridged from the kernel to the host approval card. */
export interface KernelPermissionRequest {
  requestId: string;
  toolId?: string;
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

/**
 * Platform MCP broker address (Slice 5). The runtime owns a loopback broker
 * per kernel run; adapters translate this into the kernel's MCP server
 * registration (`--mcp-config` for Claude Code, `mcp_servers.*` config
 * overrides for codex) and embed the address + token in the server's env.
 *
 * Since the kernel-tool refactor (in-process SDK MCP servers), the
 * claude-code channel receives `sdkMcpServers` instead of a stdio broker:
 * the adapter registers the live in-process servers directly and never
 * spawns the platform MCP server. codex/pi keep the stdio broker path.
 */
export interface PlatformBrokerInfo {
  /** Loopback host the MCP server connects to (always 127.0.0.1). */
  host: string;
  /** Ephemeral port the broker listens on for this run. */
  port: number;
  /** Per-run random token; the MCP server must present it in its hello frame. */
  token: string;
  /** Workspace root the platform file tools are rooted at. */
  workspaceDir: string;
  /** Absolute path to the platform MCP server entry point (spawned by kernel). */
  command: string;
  /** Extra args for the MCP server spawn (entry point args). */
  args: string[];
  /**
   * In-process SDK MCP servers (claude-code channel only). When present the
   * adapter registers these directly and ignores host/port/token/command/args.
   * Keyed by server name; values are non-serializable live SDK server configs
   * (`McpSdkServerConfigWithInstance`). The runtime (which depends on the SDK)
   * produces these; the adapter consumes them as opaque objects.
   */
  sdkMcpServers?: Record<string, unknown>;
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
  /**
   * Images attached to the starting user message. The data URL is the portable
   * payload used by SDK kernels; `filePath`, when present, is a host-validated
   * local image that app-server kernels can forward as a native localImage.
   * The host decides capability routing before images reach an adapter.
   */
  images?: Array<{ name: string; mimeType: string; dataUrl: string; filePath?: string }>;
  /** Host-configured context window capacity (§2.3 ①). */
  contextWindow: number;
  /**
   * Effective window the kernel should honor: `min(configured, nativeLimit)`
   * when the kernel window is not overridable, else the configured value.
   * Adapters use this for injection and for the usage `window` echo.
   */
  effectiveContextWindow: number;
  /** Why the effective window differs from the configured value (observability). */
  contextWindowSource: 'configured' | 'kernel-capped' | 'estimated';
  credential: KernelCredential;
  /** Shared facts + team context injected into the system prompt. */
  systemContext: string;
  /** Platform tools to register with the kernel. */
  platformTools: PlatformToolDefinition[];
  /** Loopback broker for host platform tools (MCP channel). */
  platformBroker?: PlatformBrokerInfo;
  /**
   * Search route selected by the host for this exact model + kernel pairing.
   * `native` lets the harness expose its provider-hosted search tool;
   * `external` injects Sync-Think's configured web-search MCP;
   * `fetch-only` exposes known-URL retrieval but no keyword search.
   */
  webSearchMode?: 'disabled' | 'native' | 'external' | 'fetch-only';
  permissionMode: KernelPermissionMode;
  /**
   * Planning mode: the kernel runs read-only to produce an approvable plan.
   * Adapters restrict their native tools to a read-only allowlist and the host
   * platform MCP catalog is filtered to read-only tools. Hard-blocked in the
   * host tool executor as a second fence (never rely on the prompt alone).
   */
  planningMode?: boolean;
  workspaceDir: string;
  /** Host reasoning effort ('off' | 'low' | 'medium' | 'high' | 'xhigh') for kernels that expose it. */
  reasoningEffort?: string;
  /** Optional kernel-owned conversation session carried across short-lived runs. */
  session?: {
    /** Create may omit the id when the kernel assigns it (Codex thread.started). */
    id?: string;
    mode: 'create' | 'resume';
    /**
     * Optional catch-up transcript injected on resume when other kernels handled
     * turns this kernel's native session never saw (cross-kernel gap). The
     * adapter appends it to the resume prompt/system context.
     */
    catchUp?: string;
  };
}

/**
 * Unified kernel event stream. The render/persistence layers only know this
 * vocabulary; unknown kernel events are ignored + logged, absent event types
 * degrade the UI (mapping principle from the design doc §4.1).
 */
export type KernelEvent =
  | { type: 'session-started'; sessionId: string }
  | {
      type: 'delta';
      text: string;
      /**
       * The kernel declares this text is the user-facing final message (e.g.
       * codex `agentMessage`), not working commentary. The host streams it
       * straight into the answer area instead of buffering it for later
       * classification (§12.17.18 exception). Absent = unclassified.
       */
      final?: boolean;
    }
  | {
      type: 'reasoning';
      text: string;
      /** Starts a new provider reasoning summary section in the process flow. */
      boundary?: boolean;
    }
  | {
      type: 'tool-call';
      toolId: string;
      name: string;
      argsJson: string;
      partial: boolean;
    }
  /** Ephemeral output emitted while a still-running tool is producing data. */
  | { type: 'tool-progress'; toolId: string; output: string }
  | {
      type: 'tool-result';
      toolId: string;
      output: string;
      isError: boolean;
      structuredOutput?: unknown;
    }
  | {
      type: 'permission-request';
      requestId: string;
      toolId?: string;
      toolName: string;
      toolInput: unknown;
    }
  | { type: 'usage'; usage: KernelUsage }
  /**
   * Kernel-owned live context occupancy. Distinct from `usage`, which is the
   * billed provider request. Claude `/context` and Codex `tokenUsage.last`
   * report this; the host must not invent it.
   */
  | {
      type: 'context-occupancy';
      usedTokens: number;
      windowTokens?: number;
      categories?: Array<{ name: string; tokens: number }>;
    }
  /** The kernel exposed a real compaction lifecycle boundary. */
  | { type: 'compaction-started' }
  | { type: 'compaction-failed'; error?: string }
  /** Optional notification that the kernel compacted its own context. */
  | { type: 'compacted' }
  /** Native planning output, normalized by the host into its shared plan card. */
  | { type: 'plan-submitted'; text: string }
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
  /** Display name (kernel selector UI). */
  name: string;
  /** Kernel icon asset key (kernel selector UI). */
  icon: string;
  /** Declared capabilities (drive UI degradation). */
  capabilities: KernelCapabilities;
  /** Human-readable install command shown for missing kernels. */
  installCommand?: string;
  installed: boolean;
  executionSupported?: boolean;
  executionUnavailableReason?: string;
  /** Parsed version string, or null when the probe failed. */
  version: string | null;
  /** Resolved executable path, or null when not found. */
  executablePath: string | null;
  /** true when the version matches a knownGoodVersions entry. */
  knownGood: boolean;
  /** Human-readable install guidance shown in the kernel selector. */
  installHint?: string;
}
