import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type {
  Worker,
  WorkerEvent,
  WorkerJobInput,
  WorkerJobOutput,
  WorkerToken,
} from '../types.js';
import {
  enforceMcpOutputLimit,
  formatMcpPolicyLabel,
  normalizeMcpProcessPolicy,
  previewMcpOutput,
  type McpAuditRecord,
  type McpProcessPolicy,
} from './mcp-policy.js';
import {
  encodeJsonRpcMessage,
  extractToolCallText,
  extractToolsList,
  isJsonRpcResponse,
  JsonRpcStdioParser,
  type McpDiscoveredTool,
} from './jsonrpc-stdio.js';

/**
 * Real local-stdio MCP process host (§9.3 / §14).
 *
 * - spawn-probe: short-lived process, no JSON-RPC (stdout capture only)
 * - call-tool: MCP JSON-RPC initialize → tools/call → kill (real tool path)
 * - list-tools: MCP JSON-RPC initialize → tools/list → kill (discovery only)
 * - Enforces timeout, max output bytes, untrusted default, audit
 * - Remote-http and fake:// endpoints are refused
 */

export interface LocalStdioSpawnAction {
  kind: 'spawn-probe' | 'call-tool' | 'list-tools';
  toolName?: string;
  /** JSON object arguments for tools/call (call-tool only). */
  toolArguments?: Record<string, unknown>;
  /** Optional stdin payload (UTF-8). Closed after write. Used by spawn-probe. */
  stdinText?: string;
  /** Max tools to keep from tools/list (list-tools only). */
  maxTools?: number;
}

export interface LocalStdioMcpWorkerInput extends WorkerJobInput {
  action: LocalStdioSpawnAction;
  policy: Partial<McpProcessPolicy> | McpProcessPolicy;
  /** Registered endpoint, e.g. `node path/to/server.js --flag`. */
  endpoint: string;
  transport?: string;
  mcpServerId?: string;
  now?: string;
}

export interface LocalStdioMcpWorkerOutput extends WorkerJobOutput {
  contentTrust: 'trusted' | 'untrusted';
  truncated: boolean;
  timedOut: boolean;
  rawBytes: number;
  keptBytes: number;
  policyLabel: string;
  preview: string;
  audit: McpAuditRecord;
  /** Always false for this worker path — process was actually spawned (or refused). */
  simulated: false;
  spawned: boolean;
  exitCode: number | null;
  signal: string | null;
  elapsedMs: number;
  command: string;
  args: string[];
  refuseReason?: string;
  /** Present when action.kind === 'call-tool'. */
  toolName?: string;
  toolResultText?: string;
  jsonRpcOk?: boolean;
  protocol?: 'none' | 'mcp-jsonrpc';
  /** Present when action.kind === 'list-tools'. */
  tools?: McpDiscoveredTool[];
  toolCount?: number;
}

export interface LocalStdioMcpWorker extends Worker<LocalStdioMcpWorkerInput> {
  readonly kind: 'mcp';
}

const DEFAULT_TOKEN_TIMEOUT = 30_000;

/** Split a simple command line without shell metacharacters. */
export function parseLocalStdioCommand(
  endpoint: string,
): { ok: true; command: string; args: string[] } | { ok: false; reason: string } {
  const raw = String(endpoint ?? '').trim();
  if (!raw) return { ok: false, reason: 'endpoint 为空' };
  const lower = raw.toLowerCase();
  if (
    lower.startsWith('fake://') ||
    lower.startsWith('stdio://') ||
    lower.startsWith('http://') ||
    lower.startsWith('https://')
  ) {
    return {
      ok: false,
      reason: 'endpoint 不是可启动的本地命令（fake/stdio/http URL 请用策略模拟探测）',
    };
  }
  if (lower.startsWith('remote-http') || lower.includes('://')) {
    return { ok: false, reason: '仅支持 local-stdio 可执行命令行，拒绝 URL 型 endpoint' };
  }
  // Disallow shell metacharacters outside quotes (spawn without shell).
  const unquoted = raw.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
  if (/[;&|<>$`\n\r]/.test(unquoted)) {
    return { ok: false, reason: 'endpoint contains shell metacharacters outside quotes' };
  }
  const parts = raw.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((p) => p.replace(/^"|"$/g, '')) ?? [];
  if (parts.length === 0 || !parts[0]) {
    return { ok: false, reason: '无法解析 command' };
  }
  const command = parts[0];
  const args = parts.slice(1);
  // Soft allowlist for M1 skeleton: node/npx and common echo helpers only.
  const base = command.replace(/^.*[\\/]/, '').toLowerCase();
  const allowed = new Set(['node', 'node.exe', 'npx', 'npx.cmd', 'echo', 'cmd', 'cmd.exe']);
  if (!allowed.has(base)) {
    return {
      ok: false,
      reason: `M1 spawn 白名单未包含命令 "${base}"（当前允许 node/npx/echo/cmd）`,
    };
  }
  return { ok: true, command, args };
}

const killRequests = new WeakMap<ChildProcessWithoutNullStreams, Promise<void>>();

function killTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  const existing = killRequests.get(child);
  if (existing) return existing;

  const request = new Promise<void>((resolve) => {
    try {
      if (process.platform === 'win32') {
        const pid = child.pid;
        if (typeof pid !== 'number' || pid <= 0) {
          child.kill();
          resolve();
          return;
        }
        try {
          const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
            shell: false,
            windowsHide: true,
            stdio: 'ignore',
          });
          let settled = false;
          const directKill = () => {
            try {
              if (child.exitCode === null && child.signalCode === null) {
                child.kill('SIGKILL');
              }
            } catch {
              // The process already exited.
            }
          };
          const timeout = setTimeout(() => {
            try {
              killer.kill();
            } catch {
              // The taskkill helper already exited.
            }
            directKill();
            finish();
          }, 2_000);
          timeout.unref();
          const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve();
          };
          killer.once('error', () => {
            directKill();
            finish();
          });
          killer.once('close', (code) => {
            if (code !== 0 || (child.exitCode === null && child.signalCode === null)) {
              directKill();
            }
            finish();
          });
        } catch {
          child.kill();
          resolve();
        }
        return;
      }
      child.kill('SIGKILL');
      resolve();
    } catch {
      resolve();
    }
  });
  killRequests.set(child, request);
  return request;
}

function refuseOutput(
  input: LocalStdioMcpWorkerInput,
  policy: McpProcessPolicy,
  toolName: string,
  transport: string,
  reason: string,
): LocalStdioMcpWorkerOutput {
  return {
    ok: false,
    message: reason,
    contentTrust: 'untrusted',
    truncated: false,
    timedOut: false,
    rawBytes: 0,
    keptBytes: 0,
    policyLabel: formatMcpPolicyLabel(policy),
    preview: '',
    audit: {
      at: input.now || new Date().toISOString(),
      mcpServerId: input.mcpServerId,
      toolName,
      transport,
      trusted: policy.trusted,
      contentTrust: 'untrusted',
      maxOutputBytes: policy.maxOutputBytes,
      timeoutMs: policy.timeoutMs,
      rawBytes: 0,
      keptBytes: 0,
      truncated: false,
      timedOut: false,
      note: 'refuse · no-spawn · ' + reason,
    },
    simulated: false,
    spawned: false,
    exitCode: null,
    signal: null,
    elapsedMs: 0,
    command: '',
    args: [],
    refuseReason: reason,
    toolName,
    protocol:
      input.action.kind === 'call-tool' || input.action.kind === 'list-tools'
        ? 'mcp-jsonrpc'
        : 'none',
    jsonRpcOk: false,
    tools: input.action.kind === 'list-tools' ? [] : undefined,
    toolCount: input.action.kind === 'list-tools' ? 0 : undefined,
  };
}

function startRefusal(token: WorkerToken): string | undefined {
  if (token.signal?.aborted) return 'worker execution was cancelled before spawn';
  if (token.beforeStart) {
    try {
      if (!token.beforeStart()) return 'worker execution fence was rejected before spawn';
    } catch {
      return 'worker execution fence was rejected before spawn';
    }
  }
  if (token.signal?.aborted) return 'worker execution was cancelled before spawn';
  return undefined;
}

export class LocalStdioMcpWorker implements LocalStdioMcpWorker {
  readonly kind = 'mcp' as const;

  async *exec(input: LocalStdioMcpWorkerInput, token: WorkerToken): AsyncIterable<WorkerEvent> {
    const basePolicy = normalizeMcpProcessPolicy(input.policy);
    const policy = normalizeMcpProcessPolicy({
      ...basePolicy,
      timeoutMs: Math.min(
        basePolicy.timeoutMs,
        Math.max(100, token.timeoutMs || DEFAULT_TOKEN_TIMEOUT),
      ),
    });
    const toolName =
      String(
        input.action.toolName || (input.action.kind === 'call-tool' ? 'unknown' : 'spawn-probe'),
      ).trim() || 'spawn-probe';
    const transport = String(input.transport || 'local-stdio').trim() || 'local-stdio';
    const actionKind = input.action.kind || 'spawn-probe';

    const parsed = parseLocalStdioCommand(input.endpoint);
    if (!parsed.ok) {
      yield {
        type: 'stderr',
        text: '[mcp] refuse · ' + parsed.reason,
      };
      const out = refuseOutput(input, policy, toolName, transport, parsed.reason);
      yield {
        type: 'failed',
        failureClass: 'permission',
        error: { code: 'worker.permission', message: parsed.reason },
      };
      yield { type: 'completed', output: out };
      return;
    }

    if (actionKind === 'call-tool') {
      yield* this.execCallTool(input, policy, parsed, toolName, transport, token);
      return;
    }

    if (actionKind === 'list-tools') {
      yield* this.execListTools(input, policy, parsed, transport, token);
      return;
    }

    yield* this.execSpawnProbe(input, policy, parsed, toolName, transport, token);
  }

  private async *execSpawnProbe(
    input: LocalStdioMcpWorkerInput,
    policy: McpProcessPolicy,
    parsed: { command: string; args: string[] },
    toolName: string,
    transport: string,
    token: WorkerToken,
  ): AsyncIterable<WorkerEvent> {
    const started = Date.now();
    yield {
      type: 'stderr',
      text:
        '[mcp-spawn] starting · ' +
        parsed.command +
        (parsed.args.length ? ' ' + parsed.args.join(' ') : '') +
        ' · ' +
        formatMcpPolicyLabel(policy),
    };

    const refusal = startRefusal(token);
    if (refusal) {
      yield {
        type: 'failed',
        failureClass: 'acceptance',
        error: { code: 'worker.aborted', message: refusal },
      };
      yield {
        type: 'completed',
        output: refuseOutput(input, policy, toolName, transport, refusal),
      };
      return;
    }

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(parsed.command, parsed.args, {
        cwd: input.workingDir,
        env: {
          ...process.env,
          SYNC_THINK_MCP_SPAWN: '1',
        },
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'spawn failed';
      yield {
        type: 'failed',
        failureClass: 'unknown',
        error: { code: 'worker.spawn-failed', message },
      };
      return;
    }

    const maxBytes = policy.maxOutputBytes;
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let truncatedLive = false;
    let timedOut = false;
    let aborted = false;
    let exitCode: number | null = null;
    let signal: string | null = null;

    const appendLimited = (chunk: Buffer, which: 'out' | 'err') => {
      const text = chunk.toString('utf8');
      const bytes = Buffer.byteLength(text, 'utf8');
      if (which === 'out') {
        if (stdoutBytes >= maxBytes) {
          truncatedLive = true;
          return;
        }
        stdout += text;
        stdoutBytes += bytes;
        if (stdoutBytes > maxBytes) truncatedLive = true;
      } else {
        stderr += text;
        stderrBytes += Buffer.byteLength(text, 'utf8');
        if (stderrBytes > maxBytes) truncatedLive = true;
      }
    };

    child.stdout.on('data', (c: Buffer) => appendLimited(c, 'out'));
    child.stderr.on('data', (c: Buffer) => appendLimited(c, 'err'));

    if (typeof input.action.stdinText === 'string' && input.action.stdinText.length > 0) {
      try {
        child.stdin.write(input.action.stdinText, 'utf8');
      } catch {
        // ignore
      }
    }
    try {
      child.stdin.end();
    } catch {
      // ignore
    }

    const timeoutMs = policy.timeoutMs;
    const timer = setTimeout(() => {
      timedOut = true;
      void killTree(child);
    }, timeoutMs);
    const onAbort = () => {
      aborted = true;
      clearTimeout(timer);
      void killTree(child);
    };
    token.signal?.addEventListener('abort', onAbort, { once: true });
    if (token.signal?.aborted) onAbort();

    await new Promise<void>((resolve) => {
      child.on('error', (err) => {
        stderr += (stderr ? '\n' : '') + String(err.message || err);
        resolve();
      });
      child.on('close', (code, sig) => {
        exitCode = typeof code === 'number' ? code : null;
        signal = sig ? String(sig) : null;
        resolve();
      });
    });
    clearTimeout(timer);
    token.signal?.removeEventListener('abort', onAbort);

    const elapsedMs = Date.now() - started;
    const combined = stdout + (stderr ? (stdout ? '\n' : '') + stderr : '');
    const enforced = enforceMcpOutputLimit(combined, policy, {
      mcpServerId: input.mcpServerId,
      toolName,
      transport,
      timedOut,
      now: input.now,
    });

    if (aborted) {
      const output: LocalStdioMcpWorkerOutput = {
        ok: false,
        message: 'MCP spawn was cancelled',
        contentTrust: enforced.contentTrust,
        truncated: enforced.truncated || truncatedLive,
        timedOut: false,
        rawBytes: enforced.rawBytes,
        keptBytes: enforced.keptBytes,
        policyLabel: formatMcpPolicyLabel(policy),
        preview: previewMcpOutput(enforced.text),
        audit: { ...enforced.audit, note: enforced.audit.note + ' 路 real-spawn 路 aborted' },
        simulated: false,
        spawned: true,
        exitCode,
        signal,
        elapsedMs,
        command: parsed.command,
        args: parsed.args,
        protocol: 'none',
      };
      yield {
        type: 'failed',
        failureClass: 'acceptance',
        error: { code: 'worker.aborted', message: output.message },
      };
      yield { type: 'completed', output };
      return;
    }
    if (timedOut) {
      yield {
        type: 'stderr',
        text: '[mcp-spawn] timeout · ' + elapsedMs + 'ms · real-spawn',
      };
      const output: LocalStdioMcpWorkerOutput = {
        ok: false,
        message: 'MCP spawn timed out after ' + elapsedMs + 'ms',
        contentTrust: enforced.contentTrust,
        truncated: enforced.truncated || truncatedLive,
        timedOut: true,
        rawBytes: enforced.rawBytes,
        keptBytes: enforced.keptBytes,
        policyLabel: formatMcpPolicyLabel(policy),
        preview: previewMcpOutput(enforced.text),
        audit: {
          ...enforced.audit,
          note: enforced.audit.note + ' · real-spawn · timed-out',
        },
        simulated: false,
        spawned: true,
        exitCode,
        signal,
        elapsedMs,
        command: parsed.command,
        args: parsed.args,
        protocol: 'none',
      };
      yield {
        type: 'failed',
        failureClass: 'timeout',
        error: { code: 'worker.timeout', message: output.message || 'timeout' },
      };
      yield { type: 'completed', output };
      return;
    }

    if (enforced.truncated || enforced.contentTrust === 'untrusted' || truncatedLive) {
      yield {
        type: 'stderr',
        text: '[mcp-spawn] ' + enforced.audit.note + ' · real-spawn',
      };
    }
    if (enforced.text) {
      yield { type: 'stdout', text: enforced.text };
    }

    const ok = exitCode === 0;
    const output: LocalStdioMcpWorkerOutput = {
      ok,
      message: ok
        ? 'MCP spawn probe ok (real process · no JSON-RPC tools yet)'
        : 'MCP spawn exited with code ' + String(exitCode),
      contentTrust: enforced.contentTrust,
      truncated: enforced.truncated || truncatedLive,
      timedOut: false,
      rawBytes: enforced.rawBytes,
      keptBytes: enforced.keptBytes,
      policyLabel: formatMcpPolicyLabel(policy),
      preview: previewMcpOutput(enforced.text),
      audit: {
        ...enforced.audit,
        note: enforced.audit.note + ' · real-spawn · exit=' + String(exitCode),
      },
      simulated: false,
      spawned: true,
      exitCode,
      signal,
      elapsedMs,
      command: parsed.command,
      args: parsed.args,
      protocol: 'none',
    };
    yield { type: 'completed', output };
  }

  /**
   * Full MCP JSON-RPC tool call: initialize → notifications/initialized → tools/call.
   * Process is killed after response or timeout. Output is size-limited and untrusted by default.
   */
  private async *execCallTool(
    input: LocalStdioMcpWorkerInput,
    policy: McpProcessPolicy,
    parsed: { command: string; args: string[] },
    toolName: string,
    transport: string,
    token: WorkerToken,
  ): AsyncIterable<WorkerEvent> {
    const started = Date.now();
    const toolArgs =
      input.action.toolArguments && typeof input.action.toolArguments === 'object'
        ? input.action.toolArguments
        : {};

    yield {
      type: 'stderr',
      text:
        '[mcp-tool] starting · ' +
        toolName +
        ' · ' +
        parsed.command +
        (parsed.args.length ? ' ' + parsed.args.join(' ') : '') +
        ' · ' +
        formatMcpPolicyLabel(policy),
    };

    const refusal = startRefusal(token);
    if (refusal) {
      yield {
        type: 'failed',
        failureClass: 'acceptance',
        error: { code: 'worker.aborted', message: refusal },
      };
      yield {
        type: 'completed',
        output: refuseOutput(input, policy, toolName, transport, refusal),
      };
      return;
    }

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(parsed.command, parsed.args, {
        cwd: input.workingDir,
        env: {
          ...process.env,
          SYNC_THINK_MCP_SPAWN: '1',
          SYNC_THINK_MCP_TOOL: toolName,
        },
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'spawn failed';
      yield {
        type: 'failed',
        failureClass: 'unknown',
        error: { code: 'worker.spawn-failed', message },
      };
      return;
    }

    const parser = new JsonRpcStdioParser(policy.maxOutputBytes);
    let rawStdoutBytes = 0;
    let stderrText = '';
    let timedOut = false;
    let aborted = false;
    let exitCode: number | null = null;
    let signal: string | null = null;
    let parseError: string | null = null;
    const pending = new Map<
      number | string,
      { resolve: (v: unknown) => void; reject: (e: Error) => void }
    >();
    let nextId = 1;
    let closed = false;

    const onMessage = (msg: unknown) => {
      if (!isJsonRpcResponse(msg)) return;
      const id = (msg as { id: number | string | null }).id;
      if (id === null || id === undefined) return;
      const waiter = pending.get(id);
      if (waiter) {
        pending.delete(id);
        waiter.resolve(msg);
      }
    };

    child.stdout.on('data', (chunk: Buffer) => {
      rawStdoutBytes += chunk.length;
      if (rawStdoutBytes > policy.maxOutputBytes * 4) {
        // hard ceiling before parser blow-up
        parseError = 'stdout exceeded hard ceiling';
        void killTree(child);
        return;
      }
      try {
        const msgs = parser.push(chunk);
        for (const m of msgs) onMessage(m);
      } catch (err) {
        parseError = err instanceof Error ? err.message : String(err);
        void killTree(child);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const t = chunk.toString('utf8');
      if (stderrText.length < policy.maxOutputBytes) {
        stderrText += t;
      }
    });

    const request = (method: string, params?: unknown): Promise<unknown> => {
      const id = nextId++;
      const frame = encodeJsonRpcMessage({
        jsonrpc: '2.0',
        id,
        method,
        params: params ?? {},
      });
      return new Promise((resolve, reject) => {
        if (closed) {
          reject(new Error('MCP process already closed'));
          return;
        }
        pending.set(id, { resolve, reject });
        try {
          child.stdin.write(frame);
        } catch (err) {
          pending.delete(id);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    };

    const notify = (method: string, params?: unknown) => {
      try {
        child.stdin.write(
          encodeJsonRpcMessage({
            jsonrpc: '2.0',
            method,
            params: params ?? {},
          }),
        );
      } catch {
        // ignore
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      for (const [, w] of pending) {
        w.reject(new Error('MCP JSON-RPC timed out'));
      }
      pending.clear();
      void killTree(child);
    }, policy.timeoutMs);
    const onAbort = () => {
      aborted = true;
      clearTimeout(timer);
      for (const [, waiter] of pending) {
        waiter.reject(new Error('MCP execution aborted'));
      }
      pending.clear();
      void killTree(child);
    };
    token.signal?.addEventListener('abort', onAbort, { once: true });
    if (token.signal?.aborted) onAbort();

    const closePromise = new Promise<void>((resolve) => {
      child.on('error', (err) => {
        stderrText += (stderrText ? '\n' : '') + String(err.message || err);
        closed = true;
        for (const [, w] of pending) w.reject(err);
        pending.clear();
        resolve();
      });
      child.on('close', (code, sig) => {
        exitCode = typeof code === 'number' ? code : null;
        signal = sig ? String(sig) : null;
        closed = true;
        for (const [, w] of pending) {
          w.reject(new Error('MCP process closed before response'));
        }
        pending.clear();
        resolve();
      });
    });

    let toolResultText = '';
    let jsonRpcOk = false;
    let failMessage = '';

    try {
      const initResp = (await request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'sync-think-runtime', version: '0.0.1' },
      })) as { result?: unknown; error?: { message?: string } };

      if (initResp.error) {
        throw new Error('initialize failed: ' + String(initResp.error.message || 'error'));
      }
      notify('notifications/initialized', {});

      const callResp = (await request('tools/call', {
        name: toolName,
        arguments: toolArgs,
      })) as { result?: unknown; error?: { message?: string; code?: number } };

      if (callResp.error) {
        jsonRpcOk = false;
        toolResultText = 'JSON-RPC error: ' + String(callResp.error.message || 'error');
        failMessage = toolResultText;
      } else {
        jsonRpcOk = true;
        toolResultText = extractToolCallText(callResp.result);
      }
    } catch (err) {
      failMessage = err instanceof Error ? err.message : String(err);
      if (parseError) failMessage = parseError + ' · ' + failMessage;
      jsonRpcOk = false;
    } finally {
      try {
        child.stdin.end();
      } catch {
        // ignore
      }
      // Give a short grace then kill residual process
      if (!closed) {
        setTimeout(() => {
          if (!closed) void killTree(child);
        }, 200).unref?.();
      }
    }

    // Wait briefly for process exit (or timeout already killed)
    await Promise.race([
      closePromise,
      new Promise<void>((r) => setTimeout(r, Math.min(1500, policy.timeoutMs))),
    ]);
    clearTimeout(timer);
    token.signal?.removeEventListener('abort', onAbort);
    if (!closed) {
      await killTree(child);
      await Promise.race([
        closePromise,
        new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
      ]);
    }
    const pendingKill = killRequests.get(child);
    if (pendingKill) await pendingKill;

    const elapsedMs = Date.now() - started;
    const combined =
      toolResultText + (stderrText ? (toolResultText ? '\n' : '') + '[stderr] ' + stderrText : '');
    const enforced = enforceMcpOutputLimit(combined, policy, {
      mcpServerId: input.mcpServerId,
      toolName,
      transport,
      timedOut,
      now: input.now,
    });

    if (timedOut) {
      yield {
        type: 'stderr',
        text: '[mcp-tool] timeout · ' + elapsedMs + 'ms · real-jsonrpc',
      };
      const output: LocalStdioMcpWorkerOutput = {
        ok: false,
        message: 'MCP tool call timed out after ' + elapsedMs + 'ms',
        contentTrust: enforced.contentTrust,
        truncated: enforced.truncated,
        timedOut: true,
        rawBytes: enforced.rawBytes,
        keptBytes: enforced.keptBytes,
        policyLabel: formatMcpPolicyLabel(policy),
        preview: previewMcpOutput(enforced.text),
        audit: {
          ...enforced.audit,
          note: enforced.audit.note + ' · real-jsonrpc · timed-out · tool=' + toolName,
        },
        simulated: false,
        spawned: true,
        exitCode,
        signal,
        elapsedMs,
        command: parsed.command,
        args: parsed.args,
        toolName,
        toolResultText: enforced.text,
        jsonRpcOk: false,
        protocol: 'mcp-jsonrpc',
      };
      yield {
        type: 'failed',
        failureClass: 'timeout',
        error: { code: 'worker.timeout', message: output.message || 'timeout' },
      };
      yield { type: 'completed', output };
      return;
    }

    if (aborted) {
      failMessage = 'MCP tool call was cancelled';
      jsonRpcOk = false;
    }
    const ok = jsonRpcOk && !failMessage && !aborted;
    if (!ok) {
      yield {
        type: 'stderr',
        text: '[mcp-tool] fail · ' + (failMessage || 'unknown') + ' · real-jsonrpc',
      };
    } else {
      yield {
        type: 'stderr',
        text: '[mcp-tool] ok · ' + toolName + ' · real-jsonrpc · ' + enforced.audit.note,
      };
    }
    if (enforced.text) {
      yield { type: 'stdout', text: enforced.text };
    }

    const output: LocalStdioMcpWorkerOutput = {
      ok,
      message: ok
        ? 'MCP tool call ok (real JSON-RPC · untrusted content)'
        : failMessage || 'MCP tool call failed',
      contentTrust: enforced.contentTrust,
      truncated: enforced.truncated,
      timedOut: false,
      rawBytes: enforced.rawBytes,
      keptBytes: enforced.keptBytes,
      policyLabel: formatMcpPolicyLabel(policy),
      preview: previewMcpOutput(enforced.text),
      audit: {
        ...enforced.audit,
        note:
          enforced.audit.note +
          ' · real-jsonrpc · tool=' +
          toolName +
          ' · jsonRpcOk=' +
          String(jsonRpcOk),
      },
      simulated: false,
      spawned: true,
      exitCode,
      signal,
      elapsedMs,
      command: parsed.command,
      args: parsed.args,
      toolName,
      toolResultText: enforced.text,
      jsonRpcOk,
      protocol: 'mcp-jsonrpc',
    };
    if (!ok) {
      yield {
        type: 'failed',
        failureClass: aborted ? 'acceptance' : 'unknown',
        error: {
          code: aborted ? 'worker.aborted' : 'worker.tool-failed',
          message: output.message || 'tool failed',
        },
      };
    }
    yield { type: 'completed', output };
  }

  /**
   * MCP JSON-RPC tool discovery: initialize → notifications/initialized → tools/list.
   * Process is killed after response or timeout. Catalog is size-limited and untrusted.
   * Does NOT execute tools.
   */
  private async *execListTools(
    input: LocalStdioMcpWorkerInput,
    policy: McpProcessPolicy,
    parsed: { command: string; args: string[] },
    transport: string,
    token: WorkerToken,
  ): AsyncIterable<WorkerEvent> {
    const started = Date.now();
    const toolName = 'tools/list';
    const maxTools =
      typeof input.action.maxTools === 'number' && Number.isFinite(input.action.maxTools)
        ? Math.max(1, Math.min(200, Math.floor(input.action.maxTools)))
        : 64;

    yield {
      type: 'stderr',
      text:
        '[mcp-list] starting · tools/list · ' +
        parsed.command +
        (parsed.args.length ? ' ' + parsed.args.join(' ') : '') +
        ' · ' +
        formatMcpPolicyLabel(policy),
    };

    const refusal = startRefusal(token);
    if (refusal) {
      yield {
        type: 'failed',
        failureClass: 'acceptance',
        error: { code: 'worker.aborted', message: refusal },
      };
      yield {
        type: 'completed',
        output: refuseOutput(input, policy, toolName, transport, refusal),
      };
      return;
    }

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(parsed.command, parsed.args, {
        cwd: input.workingDir,
        env: {
          ...process.env,
          SYNC_THINK_MCP_SPAWN: '1',
          SYNC_THINK_MCP_LIST: '1',
        },
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'spawn failed';
      yield {
        type: 'failed',
        failureClass: 'unknown',
        error: { code: 'worker.spawn-failed', message },
      };
      return;
    }

    const parser = new JsonRpcStdioParser(policy.maxOutputBytes);
    let rawStdoutBytes = 0;
    let stderrText = '';
    let timedOut = false;
    let aborted = false;
    let exitCode: number | null = null;
    let signal: string | null = null;
    let parseError: string | null = null;
    const pending = new Map<
      number | string,
      { resolve: (v: unknown) => void; reject: (e: Error) => void }
    >();
    let nextId = 1;
    let closed = false;

    const onMessage = (msg: unknown) => {
      if (!isJsonRpcResponse(msg)) return;
      const id = (msg as { id: number | string | null }).id;
      if (id === null || id === undefined) return;
      const waiter = pending.get(id);
      if (waiter) {
        pending.delete(id);
        waiter.resolve(msg);
      }
    };

    child.stdout.on('data', (chunk: Buffer) => {
      rawStdoutBytes += chunk.length;
      if (rawStdoutBytes > policy.maxOutputBytes * 4) {
        parseError = 'stdout exceeded hard ceiling';
        void killTree(child);
        return;
      }
      try {
        const msgs = parser.push(chunk);
        for (const m of msgs) onMessage(m);
      } catch (err) {
        parseError = err instanceof Error ? err.message : String(err);
        void killTree(child);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const t = chunk.toString('utf8');
      if (stderrText.length < policy.maxOutputBytes) {
        stderrText += t;
      }
    });

    const request = (method: string, params?: unknown): Promise<unknown> => {
      const id = nextId++;
      const frame = encodeJsonRpcMessage({
        jsonrpc: '2.0',
        id,
        method,
        params: params ?? {},
      });
      return new Promise((resolve, reject) => {
        if (closed) {
          reject(new Error('MCP process already closed'));
          return;
        }
        pending.set(id, { resolve, reject });
        try {
          child.stdin.write(frame);
        } catch (err) {
          pending.delete(id);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    };

    const notify = (method: string, params?: unknown) => {
      try {
        child.stdin.write(
          encodeJsonRpcMessage({
            jsonrpc: '2.0',
            method,
            params: params ?? {},
          }),
        );
      } catch {
        // ignore
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      for (const [, w] of pending) {
        w.reject(new Error('MCP JSON-RPC timed out'));
      }
      pending.clear();
      void killTree(child);
    }, policy.timeoutMs);

    const onAbort = () => {
      aborted = true;
      clearTimeout(timer);
      for (const [, waiter] of pending) {
        waiter.reject(new Error('MCP execution aborted'));
      }
      pending.clear();
      void killTree(child);
    };
    token.signal?.addEventListener('abort', onAbort, { once: true });
    if (token.signal?.aborted) onAbort();

    const closePromise = new Promise<void>((resolve) => {
      child.on('error', (err) => {
        stderrText += (stderrText ? '\n' : '') + String(err.message || err);
        closed = true;
        for (const [, w] of pending) w.reject(err);
        pending.clear();
        resolve();
      });
      child.on('close', (code, sig) => {
        exitCode = code;
        signal = sig;
        closed = true;
        for (const [, w] of pending) {
          w.reject(new Error('MCP process closed before response'));
        }
        pending.clear();
        resolve();
      });
    });

    let tools: McpDiscoveredTool[] = [];
    let jsonRpcOk = false;
    let failMessage = '';
    let toolResultText = '';

    try {
      const initResp = (await request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'sync-think-runtime', version: '0.0.1' },
      })) as { result?: unknown; error?: { message?: string } };

      if (initResp.error) {
        throw new Error('initialize failed: ' + String(initResp.error.message || 'error'));
      }
      notify('notifications/initialized', {});

      const listResp = (await request('tools/list', {})) as {
        result?: unknown;
        error?: { message?: string; code?: number };
      };

      if (listResp.error) {
        jsonRpcOk = false;
        toolResultText = 'JSON-RPC error: ' + String(listResp.error.message || 'error');
        failMessage = toolResultText;
      } else {
        jsonRpcOk = true;
        tools = extractToolsList(listResp.result, {
          maxTools,
          maxSchemaBytes: Math.min(16_384, policy.maxOutputBytes),
        });
        toolResultText = tools.map((t) => t.name).join(',');
      }
    } catch (err) {
      failMessage = err instanceof Error ? err.message : String(err);
      if (parseError) failMessage = parseError + ' · ' + failMessage;
      jsonRpcOk = false;
    } finally {
      try {
        child.stdin.end();
      } catch {
        // ignore
      }
      if (!closed) {
        setTimeout(() => {
          if (!closed) void killTree(child);
        }, 200).unref?.();
      }
    }

    await Promise.race([
      closePromise,
      new Promise<void>((r) => setTimeout(r, Math.min(1500, policy.timeoutMs))),
    ]);
    clearTimeout(timer);
    token.signal?.removeEventListener('abort', onAbort);
    if (!closed) {
      await killTree(child);
      await Promise.race([
        closePromise,
        new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
      ]);
    }
    const pendingKill = killRequests.get(child);
    if (pendingKill) await pendingKill;

    const elapsedMs = Date.now() - started;
    const combined =
      toolResultText + (stderrText ? (toolResultText ? '\n' : '') + '[stderr] ' + stderrText : '');
    const enforced = enforceMcpOutputLimit(combined, policy, {
      mcpServerId: input.mcpServerId,
      toolName,
      transport,
      timedOut,
      now: input.now,
    });

    if (timedOut) {
      yield {
        type: 'stderr',
        text: '[mcp-list] timeout · ' + elapsedMs + 'ms · real-jsonrpc',
      };
      const output: LocalStdioMcpWorkerOutput = {
        ok: false,
        message: 'MCP tools/list timed out after ' + elapsedMs + 'ms',
        contentTrust: enforced.contentTrust,
        truncated: enforced.truncated,
        timedOut: true,
        rawBytes: enforced.rawBytes,
        keptBytes: enforced.keptBytes,
        policyLabel: formatMcpPolicyLabel(policy),
        preview: previewMcpOutput(enforced.text),
        audit: {
          ...enforced.audit,
          note: enforced.audit.note + ' · real-jsonrpc · tools/list · timed-out',
        },
        simulated: false,
        spawned: true,
        exitCode,
        signal,
        elapsedMs,
        command: parsed.command,
        args: parsed.args,
        toolName,
        toolResultText: enforced.text,
        jsonRpcOk: false,
        protocol: 'mcp-jsonrpc',
        tools: [],
        toolCount: 0,
      };
      yield {
        type: 'failed',
        failureClass: 'timeout',
        error: { code: 'worker.timeout', message: output.message || 'timeout' },
      };
      yield { type: 'completed', output };
      return;
    }

    if (aborted) {
      failMessage = 'MCP tools/list was cancelled';
      jsonRpcOk = false;
      tools = [];
    }
    const ok = jsonRpcOk && !failMessage && !aborted;
    if (!ok) {
      yield {
        type: 'stderr',
        text: '[mcp-list] fail · ' + (failMessage || 'unknown') + ' · real-jsonrpc',
      };
    } else {
      yield {
        type: 'stderr',
        text: '[mcp-list] ok · tools=' + tools.length + ' · real-jsonrpc · ' + enforced.audit.note,
      };
    }
    if (enforced.text) {
      yield { type: 'stdout', text: enforced.text };
    }

    const output: LocalStdioMcpWorkerOutput = {
      ok,
      message: ok
        ? 'MCP tools/list ok (real JSON-RPC · ' + tools.length + ' tools · untrusted)'
        : failMessage || 'MCP tools/list failed',
      contentTrust: enforced.contentTrust,
      truncated: enforced.truncated,
      timedOut: false,
      rawBytes: enforced.rawBytes,
      keptBytes: enforced.keptBytes,
      policyLabel: formatMcpPolicyLabel(policy),
      preview: previewMcpOutput(enforced.text),
      audit: {
        ...enforced.audit,
        note:
          enforced.audit.note +
          ' · real-jsonrpc · tools/list · count=' +
          tools.length +
          ' · jsonRpcOk=' +
          String(jsonRpcOk),
      },
      simulated: false,
      spawned: true,
      exitCode,
      signal,
      elapsedMs,
      command: parsed.command,
      args: parsed.args,
      toolName,
      toolResultText: enforced.text,
      jsonRpcOk,
      protocol: 'mcp-jsonrpc',
      tools,
      toolCount: tools.length,
    };
    if (!ok) {
      yield {
        type: 'failed',
        failureClass: aborted ? 'acceptance' : 'unknown',
        error: {
          code: aborted ? 'worker.aborted' : 'worker.list-failed',
          message: output.message || 'list failed',
        },
      };
    }
    yield { type: 'completed', output };
  }
}
