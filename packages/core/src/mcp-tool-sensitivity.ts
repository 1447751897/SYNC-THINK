/**
 * MCP tool call sensitivity gate (§9.3 + §13 + §19).
 *
 * Soft craft: no real process spawn. Used before enqueueing Approval Center
 * items of kind `mcp-permission`. Untrusted output and high-risk tool names
 * always require a human under request mode.
 */

export interface McpToolSensitivityInput {
  toolName: string;
  /** Server trusted flag from registry; default false (untrusted). */
  trusted?: boolean;
  /** Registered tool names on the server (empty = unknown catalog). */
  registeredTools?: readonly string[];
  /** Explicit force (UI / test). */
  forceSensitive?: boolean;
}

export interface McpToolSensitivityResult {
  sensitive: boolean;
  reasons: string[];
  /** Chinese one-liner for status bars. */
  labelZh: string;
  /** Suggested approval action slug. */
  action: string;
  /** Whether the tool name is on the server catalog when catalog is non-empty. */
  toolOnCatalog: boolean;
}

const HIGH_RISK =
  /(?:^|[_\-./:])(write|delete|remove|rm|unlink|drop|exec|execute|shell|bash|cmd|run|spawn|send|mail|email|message|publish|payment|purchase|pay|secret|credential|token|api[_-]?key|export|upload|sudo|chmod|chown|format|destroy)(?:$|[_\-./:])/i;

export function isHighRiskMcpToolName(toolName: string): boolean {
  const name = String(toolName ?? "").trim();
  if (!name) return true;
  return HIGH_RISK.test(name);
}

/**
 * Decide if an MCP tool *invocation request* is sensitive and should enter
 * the Approval Center under default request mode.
 */
export function evaluateMcpToolSensitivity(
  input: McpToolSensitivityInput,
): McpToolSensitivityResult {
  const toolName = String(input.toolName ?? "").trim() || "unknown";
  const action = `mcp.tool.request:${toolName}`;
  const trusted = Boolean(input.trusted);
  const catalog = (input.registeredTools ?? [])
    .map((t) => String(t).trim())
    .filter(Boolean);
  const toolOnCatalog =
    catalog.length === 0 ? true : catalog.some((t) => t === toolName);
  const reasons: string[] = [];

  if (input.forceSensitive) reasons.push("forceSensitive");
  if (!trusted) reasons.push("untrusted-server");
  if (isHighRiskMcpToolName(toolName)) reasons.push("high-risk-tool-name");
  if (catalog.length > 0 && !toolOnCatalog) reasons.push("tool-not-on-catalog");

  const sensitive = reasons.length > 0;

  let labelZh: string;
  if (!sensitive) {
    labelZh = `MCP 工具安全 · ${toolName} · trusted`;
  } else {
    const zhBits: string[] = [];
    if (reasons.includes("untrusted-server")) zhBits.push("非可信源");
    if (reasons.includes("high-risk-tool-name")) zhBits.push("高风险工具名");
    if (reasons.includes("tool-not-on-catalog")) zhBits.push("不在目录");
    if (reasons.includes("forceSensitive")) zhBits.push("强制敏感");
    labelZh = `MCP 敏感调用 · ${toolName} · ${zhBits.join(" · ")}`;
  }

  return { sensitive, reasons, labelZh, action, toolOnCatalog };
}
