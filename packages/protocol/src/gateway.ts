/**
 * Open gateway (开放网关) — protocol contract.
 *
 * The gateway is a loopback HTTP shim that lets a kernel speak its native wire
 * dialect while the actual upstream speaks the other one: Claude Code
 * (Anthropic Messages) can drive a gpt-5.x relay, and Codex (OpenAI Chat) can
 * drive an Anthropic relay. It is a pure protocol-format converter.
 *
 * Routing is **ticket-based, never name-based**: when a run starts, the runtime
 * registers a per-run ticket holding the exact provider baseUrl / protocol /
 * secret / provider-facing model id the user picked in the conversation input,
 * and hands the kernel the ticket id as its API key. Two providers exposing the
 * same model name therefore can never be confused, and the settings page never
 * has to choose a provider.
 *
 * External terminal clients (a `claude` / `codex` CLI pointed at the gateway)
 * have no run context; they resolve model names by scanning the model catalog
 * (provider sort order breaks ties). No default-provider setting is exposed.
 */

export const OPEN_GATEWAY_SETTING_KEY = 'gateway.open-protocol' as const;

/** Legacy default loopback port; port 0 now means "let the OS assign one". */
export const OPEN_GATEWAY_DEFAULT_PORT = 8788;

/** Inbound dialect prefixes served by the gateway. */
export const OPEN_GATEWAY_ANTHROPIC_PATH = '/anthropic' as const;
export const OPEN_GATEWAY_OPENAI_PATH = '/openai' as const;

export interface OpenGatewaySetting {
  /** Master switch; when false the runtime never binds a listener. */
  enabled: boolean;
  /**
   * Loopback port. 0 = auto-assigned by the OS (the effective port is reported
   * back through `gateway.status`). Valid explicit values are 1024-65535.
   */
  port: number;
}

export const OPEN_GATEWAY_DEFAULT_SETTING: OpenGatewaySetting = {
  enabled: false,
  port: 0,
};

function normalizePort(value: unknown): number {
  // 0 / missing / malformed → 0 = OS auto-assign. Keeps the settings page free
  // of a provider choice and the runtime free of privileged (<1024) binds.
  if (value === 0 || value === null || value === undefined || value === '') return 0;
  if (typeof value !== 'number' || !Number.isInteger(value)) return 0;
  // Privileged ports are refused outright: the gateway must never need admin.
  if (value < 1024 || value > 65535) return 0;
  return value;
}

/** Pure normalizer for the persisted setting value (tolerates legacy shapes). */
export function normalizeOpenGatewaySetting(value: unknown): OpenGatewaySetting {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...OPEN_GATEWAY_DEFAULT_SETTING };
  }
  const raw = value as { enabled?: unknown; port?: unknown; defaultProviderId?: unknown };
  return {
    enabled: raw.enabled === true,
    port: normalizePort(raw.port),
    // Legacy `defaultProviderId` is intentionally dropped: routing is ticket-
    // based inside the app and catalog-scan for external clients.
  };
}

export function isOpenGatewayEnabled(value: unknown): boolean {
  return normalizeOpenGatewaySetting(value).enabled;
}

/** Why the gateway is not currently serving (surfaced verbatim in settings). */
export type OpenGatewayFailureReason = 'port-in-use' | 'bind-failed' | 'disabled';

/** Inbound → upstream dialect family. */
export type OpenGatewayUpstreamProtocol =
  | 'openai-chat'
  | 'openai-responses'
  | 'anthropic-messages';

/**
 * The most recent upstream a run actually routed through the gateway. Lets the
 * settings card show a read-only `上游：{provider}（{format}）` line that follows
 * whatever the user picked in the conversation input — never a stored choice.
 */
export interface OpenGatewayUpstreamInfo {
  providerId: string;
  providerName: string;
  protocol: OpenGatewayUpstreamProtocol;
  /** Provider-facing model id sent to the upstream. */
  model: string;
}

/** `gateway.status` response: what the settings section renders. */
export interface OpenGatewayStatusResponse {
  enabled: boolean;
  /** true only when a listener is bound right now. */
  running: boolean;
  /** Bound port (may differ from the setting if the user just changed it). */
  port: number;
  host: string;
  /** Base URL an external Anthropic-dialect client should use. */
  anthropicBaseUrl?: string;
  /** Base URL an external OpenAI-dialect client should use. */
  openaiBaseUrl?: string;
  /** Base URL for the model list (`GET /v1/models`). */
  modelsBaseUrl?: string;
  /**
   * Long-lived token for external clients. Per-run kernel traffic uses
   * single-run tickets instead, which are never exposed here.
   */
  externalToken?: string;
  /** Most recent ticket-based upstream, for the read-only upstream line. */
  lastUpstream?: OpenGatewayUpstreamInfo;
  failure?: OpenGatewayFailureReason;
  /** Human-readable detail for the failure (never contains secrets). */
  failureDetail?: string;
}

/** Compose the dialect base URLs a client should be pointed at. */
export function openGatewayBaseUrls(
  host: string,
  port: number,
): { anthropicBaseUrl: string; openaiBaseUrl: string } {
  const root = `http://${host}:${port}`;
  return {
    anthropicBaseUrl: `${root}${OPEN_GATEWAY_ANTHROPIC_PATH}`,
    openaiBaseUrl: `${root}${OPEN_GATEWAY_OPENAI_PATH}/v1`,
  };
}
