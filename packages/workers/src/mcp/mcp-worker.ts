import type { Worker, WorkerEvent, WorkerJobInput, WorkerJobOutput, WorkerToken } from '../types.js';
import {
  checkMcpTimeout,
  enforceMcpOutputLimit,
  formatMcpPolicyLabel,
  normalizeMcpProcessPolicy,
  previewMcpOutput,
  type McpAuditRecord,
  type McpProcessPolicy,
} from './mcp-policy.js';

export interface McpToolCallAction {
  kind: 'call-tool' | 'probe-policy';
  toolName?: string;
  /**
   * Simulated process stdout/stderr for policy testing.
   * Real spawn is intentionally not performed in this skeleton.
   */
  simulatedOutput?: string;
  /** Simulated wall-clock ms for timeout checks. */
  simulatedElapsedMs?: number;
}

export interface McpWorkerInput extends WorkerJobInput {
  action: McpToolCallAction;
  policy: Partial<McpProcessPolicy> | McpProcessPolicy;
  mcpServerId?: string;
  transport?: string;
  now?: string;
}

export interface McpWorkerOutput extends WorkerJobOutput {
  contentTrust: 'trusted' | 'untrusted';
  truncated: boolean;
  timedOut: boolean;
  rawBytes: number;
  keptBytes: number;
  policyLabel: string;
  preview: string;
  audit: McpAuditRecord;
}

export interface McpWorker extends Worker<McpWorkerInput> {
  readonly kind: 'mcp';
}

const DEFAULT_TOKEN_TIMEOUT = 30_000;

/**
 * Fake MCP worker (§9.3 / §14).
 * Does NOT spawn processes or open network sockets.
 * Enforces size limit, timeout, untrusted marking, and audit records on simulated output.
 */
export class FakeMcpWorker implements McpWorker {
  readonly kind = 'mcp' as const;

  async *exec(input: McpWorkerInput, token: WorkerToken): AsyncIterable<WorkerEvent> {
    const basePolicy = normalizeMcpProcessPolicy(input.policy);
    const policy = normalizeMcpProcessPolicy({
      ...basePolicy,
      // WorkerToken timeout is a hard outer bound when tighter than server policy.
      timeoutMs: Math.min(basePolicy.timeoutMs, Math.max(100, token.timeoutMs || DEFAULT_TOKEN_TIMEOUT)),
    });
    const toolName = String(input.action.toolName || 'probe').trim() || 'probe';
    const simulated =
      typeof input.action.simulatedOutput === 'string'
        ? input.action.simulatedOutput
        : '[fake-mcp] ' + toolName + ' deferred — no real process spawn';
    const elapsed =
      typeof input.action.simulatedElapsedMs === 'number' ? input.action.simulatedElapsedMs : 0;

    const timeout = checkMcpTimeout(elapsed, policy.timeoutMs);
    if (timeout.timedOut) {
      const enforced = enforceMcpOutputLimit(simulated, policy, {
        mcpServerId: input.mcpServerId,
        toolName,
        transport: input.transport,
        timedOut: true,
        now: input.now,
      });
      const message =
        'MCP tool timed out after ' + timeout.elapsedMs + 'ms (limit ' + timeout.timeoutMs + 'ms)';
      yield {
        type: 'stderr',
        text: '[mcp-policy] timeout · ' + formatMcpPolicyLabel(policy) + ' · ' + enforced.audit.note,
      };
      yield {
        type: 'failed',
        failureClass: 'timeout',
        error: {
          code: 'worker.timeout',
          message,
        },
      };
      return;
    }

    const enforced = enforceMcpOutputLimit(simulated, policy, {
      mcpServerId: input.mcpServerId,
      toolName,
      transport: input.transport,
      timedOut: false,
      now: input.now,
    });

    yield {
      type: 'stdout',
      text: enforced.text,
    };
    if (enforced.truncated || enforced.contentTrust === 'untrusted') {
      yield {
        type: 'stderr',
        text: '[mcp-policy] ' + enforced.audit.note,
      };
    }

    const output: McpWorkerOutput = {
      ok: true,
      message: enforced.truncated
        ? 'MCP output truncated to ' + enforced.keptBytes + 'B'
        : 'MCP policy probe ok (no real spawn)',
      contentTrust: enforced.contentTrust,
      truncated: enforced.truncated,
      timedOut: false,
      rawBytes: enforced.rawBytes,
      keptBytes: enforced.keptBytes,
      policyLabel: formatMcpPolicyLabel(policy),
      preview: previewMcpOutput(enforced.text),
      audit: enforced.audit,
    };
    yield { type: 'completed', output };
  }
}

export {
  checkMcpTimeout,
  enforceMcpOutputLimit,
  formatMcpPolicyLabel,
  normalizeMcpProcessPolicy,
  previewMcpOutput,
  mcpContentTrust,
  DEFAULT_MCP_MAX_OUTPUT_BYTES,
  DEFAULT_MCP_TIMEOUT_MS,
} from './mcp-policy.js';
export type {
  McpProcessPolicy,
  McpAuditRecord,
  McpOutputEnforcementResult,
} from './mcp-policy.js';

export {
  LocalStdioMcpWorker,
  parseLocalStdioCommand,
} from './local-stdio-mcp-worker.js';
export type {
  LocalStdioMcpWorkerInput,
  LocalStdioMcpWorkerOutput,
  LocalStdioSpawnAction,
} from './local-stdio-mcp-worker.js';

export { extractToolsList, extractToolCallText } from './jsonrpc-stdio.js';
export type { McpDiscoveredTool } from './jsonrpc-stdio.js';
