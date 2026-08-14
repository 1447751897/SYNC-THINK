/**
 * Platform MCP broker (Slice 5).
 *
 * The runtime owns one loopback broker per kernel run. The external kernel
 * spawns the platform MCP server (apps/mcp-server/platform-mcp-server.mjs)
 * from its mcp config; the server connects back here, authenticates with a
 * per-run token, receives the tool catalog in the hello handshake, and
 * forwards every tools/call. The broker routes each call to a host handler
 * that runs the three-tier approval and executes the tool in-process.
 *
 * Wire protocol (newline-delimited JSON over 127.0.0.1:<port>):
 *   MCP server → runtime:  {type:'hello', token}
 *   runtime → MCP server:  {type:'hello-ok', tools: PlatformMcpToolDefinition[]}
 *   MCP server → runtime:  {type:'tool-call', id, tool, input}
 *   MCP server → runtime:  {type:'tool-cancel', id}
 *   runtime → MCP server:  {type:'tool-result', id, ok, content|error}
 *
 * Security: binds 127.0.0.1 only; the token is a per-run CSPRNG value carried
 * only in the kernel's mcp config env (never logged).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Socket } from 'node:net';

export interface PlatformMcpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /**
   * 'never' = executes without a card in every mode.
   * 'ask-mode' = raises the approval card only when the run is in 'ask' mode
   * (mirrors the native path: workspace/full-access trust workspace-scoped
   * mutations, ask pauses on a card).
   */
  approval: 'never' | 'ask-mode' | 'outside-full-access';
}

export interface PlatformMcpToolCall {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  /**
   * Aborted when the kernel-side MCP server cancels or times out this call, or
   * when the broker closes. Host handlers must stop before any side effect.
   */
  signal: AbortSignal;
}

export interface PlatformMcpToolResult {
  ok: boolean;
  content?: string;
  error?: string;
}

export interface KernelMcpBrokerOptions {
  workspaceDir: string;
  tools: readonly PlatformMcpToolDefinition[];
  onToolCall(call: PlatformMcpToolCall): Promise<PlatformMcpToolResult>;
}

export interface KernelMcpBroker {
  /** Loopback address the MCP server connects to (port 0 → ephemeral). */
  host: string;
  port: number;
  token: string;
  close(): Promise<void>;
}

const HELLO_TIMEOUT_MS = 10_000;
const FRAME_BYTE_CAP = 1 << 20; // 1 MiB per frame guard.

/**
 * Start a platform MCP broker. Resolves once the loopback listener is bound
 * (port known), so the caller can embed host/port/token into the kernel's mcp
 * config before the kernel spawns the MCP server.
 */
export function startKernelMcpBroker(options: KernelMcpBrokerOptions): Promise<KernelMcpBroker> {
  const token = randomBytes(24).toString('base64url');
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    void handleConnection(socket, token, options, sockets);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('platform mcp broker failed to bind loopback'));
        return;
      }
      server.removeListener('error', reject);
      resolve({
        host: '127.0.0.1',
        port: address.port,
        token,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            // Do not wait on half-open kernel sockets — force-close them.
            server.unref();
            for (const socket of sockets) socket.destroy();
            sockets.clear();
          }),
      });
    });
  });
}

function handleConnection(
  socket: Socket,
  token: string,
  options: KernelMcpBrokerOptions,
  sockets: Set<Socket>,
): void {
  sockets.add(socket);
  // Every in-flight call for this connection; aborted on cancel or teardown so
  // a host handler can never apply a side effect the kernel already gave up on.
  const inFlight = new Map<string, AbortController>();
  socket.on('close', () => {
    sockets.delete(socket);
    for (const controller of inFlight.values()) controller.abort();
    inFlight.clear();
  });

  let authenticated = false;
  let buffer = '';
  // Per-connection serialization chain for tool calls.
  let queue: Promise<void> = Promise.resolve();
  const timeout = setTimeout(() => socket.destroy(), HELLO_TIMEOUT_MS);

  socket.on('data', (chunk) => {
    buffer += chunk.toString();
    if (buffer.length > FRAME_BYTE_CAP) {
      socket.destroy();
      return;
    }
    let nl = buffer.indexOf('\n');
    while (nl >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line.trim()) {
        nl = buffer.indexOf('\n');
        continue;
      }
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(line) as Record<string, unknown>;
      } catch {
        nl = buffer.indexOf('\n');
        continue;
      }
      if (!authenticated) {
        if (frame.type === 'hello' && frame.token === token) {
          authenticated = true;
          clearTimeout(timeout);
          writeFrame(socket, {
            type: 'hello-ok',
            tools: options.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
            })),
          });
        } else {
          socket.destroy();
        }
        nl = buffer.indexOf('\n');
        continue;
      }
      if (frame.type === 'tool-cancel') {
        const cancelId = typeof frame.id === 'string' ? frame.id : '';
        inFlight.get(cancelId)?.abort();
        nl = buffer.indexOf('\n');
        continue;
      }
      if (frame.type === 'tool-call') {
        const callId = typeof frame.id === 'string' ? frame.id : randomUUID();
        const controller = new AbortController();
        inFlight.set(callId, controller);
        const call: PlatformMcpToolCall = {
          id: callId,
          tool: typeof frame.tool === 'string' ? frame.tool : '',
          input:
            frame.input && typeof frame.input === 'object' && !Array.isArray(frame.input)
              ? (frame.input as Record<string, unknown>)
              : {},
          signal: controller.signal,
        };
        // Serialize per connection (= per run): the native loop runs one tool at
        // a time, so two mutations/approvals must not race here either.
        queue = queue
          .then(() => (controller.signal.aborted ? undefined : options.onToolCall(call)))
          .then((result) => {
            inFlight.delete(callId);
            if (!result) return;
            writeFrame(socket, { type: 'tool-result', id: callId, ...result });
          })
          .catch((error) => {
            inFlight.delete(callId);
            writeFrame(socket, {
              type: 'tool-result',
              id: callId,
              ok: false,
              error: error instanceof Error ? error.message : 'platform tool failed',
            });
          });
      }
      nl = buffer.indexOf('\n');
    }
  });

  socket.on('error', () => {
    // Socket teardown; nothing to surface.
  });
}

function writeFrame(socket: Socket, payload: Record<string, unknown>): void {
  if (!socket.destroyed) socket.write(JSON.stringify(payload) + '\n');
}
