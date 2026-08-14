#!/usr/bin/env node
/**
 * SYNC-THINK platform MCP server (Slice 5).
 *
 * A thin stdio MCP server that the external kernel (Claude Code / codex)
 * spawns from `--mcp-config` / `mcp_servers.*`. It does NOT execute tools
 * itself: every `tools/call` is forwarded over a per-run loopback broker to
 * the host runtime, which runs host approval (three-tier) and executes the
 * platform tool in-process. The broker also supplies the tool catalog in the
 * hello handshake, so the catalog lives in exactly one place (the runtime).
 *
 * Transport (env, injected by the runtime into the kernel's mcp config):
 *   ST_BROKER_HOST / ST_BROKER_PORT / ST_BROKER_TOKEN  — loopback broker
 *   ST_MCP_DEBUG=1                                     — log protocol to stderr
 *
 * The MCP wire surface is hand-rolled JSON-RPC 2.0 over newline-delimited
 * stdio, verified against claude 2.1.222 and codex 0.145.0 (2026-08-14):
 * initialize / initialized notification / tools/list / tools/call / ping.
 */
import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { connect } from 'node:net';
import { writeFileSync } from 'node:fs';

// Boot marker for diagnosing kernel-spawned servers (CC captures our stderr).
if (process.env.ST_MCP_MARKER) {
  try {
    writeFileSync(process.env.ST_MCP_MARKER, `booted ${new Date().toISOString()}\n`);
  } catch {
    // Marker path unwritable — ignore.
  }
}

const HOST = process.env.ST_BROKER_HOST ?? '127.0.0.1';
const PORT = Number(process.env.ST_BROKER_PORT ?? '0');
const TOKEN = process.env.ST_BROKER_TOKEN ?? '';
const DEBUG = process.env.ST_MCP_DEBUG === '1';

function log(message) {
  if (DEBUG) process.stderr.write(`[platform-mcp] ${message}\n`);
}

let tools = [];
let broker;
let brokerQueue = [];

function brokerSend(message) {
  if (broker && !broker.destroyed) {
    broker.write(JSON.stringify(message) + '\n');
  } else {
    brokerQueue.push(message);
  }
}

function connectBroker() {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: HOST, port: PORT }, () => {
      log(`connected to broker ${HOST}:${PORT}`);
    });
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (!line.trim()) {
          nl = buffer.indexOf('\n');
          continue;
        }
        let frame;
        try {
          frame = JSON.parse(line);
        } catch {
          nl = buffer.indexOf('\n');
          continue;
        }
        if (frame.type === 'hello-ok') {
          tools = frame.tools ?? [];
          for (const queued of brokerQueue) brokerSend(queued);
          brokerQueue = [];
          resolve();
        } else if (frame.type === 'tool-result') {
          const pending = pendingCalls.get(frame.id);
          if (pending) {
            pendingCalls.delete(frame.id);
            pending(frame);
          }
        }
        nl = buffer.indexOf('\n');
      }
    });
    socket.on('error', (error) => {
      log(`broker error: ${error.message}`);
      reject(error);
    });
    broker = socket;
    brokerSend({ type: 'hello', token: TOKEN });
  });
}

const pendingCalls = new Map();

function respondRaw(id, result) {
  stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function respondContent(id, text, isError = false) {
  stdout.write(
    JSON.stringify({
      jsonrpc: '2.0',
      id,
      result: { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) },
    }) + '\n',
  );
}

async function handleToolsCall(id, params) {
  const name = params?.name;
  const input = params?.arguments ?? {};
  const callId = `mcpcall-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    const result = await new Promise((resolve, reject) => {
      pendingCalls.set(callId, (frame) => {
        if (frame.ok) resolve(frame.content);
        else reject(new Error(frame.error ?? 'platform tool failed'));
      });
      brokerSend({ type: 'tool-call', id: callId, tool: name, input });
      // Broker round-trips are quick; a 90s cap guards against a hung host.
      setTimeout(() => {
        if (pendingCalls.has(callId)) {
          pendingCalls.delete(callId);
          reject(new Error('platform tool timed out waiting for the host'));
        }
      }, 90_000);
    });
    respondContent(id, result);
  } catch (error) {
    respondContent(
      id,
      `platform tool failed: ${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  }
}

const rl = createInterface({ input: stdin, terminal: false });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    log(`unparseable line: ${line.slice(0, 200)}`);
    return;
  }
  if (msg.method === 'initialize') {
    respondRaw(msg.id, {
      protocolVersion: msg.params?.protocolVersion ?? '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'sync-think-platform', version: '0.1.0' },
    });
    // The kernel sends notifications/initialized right after; ignore it.
    return;
  }
  if (msg.method === 'notifications/initialized' || msg.method === 'notifications/cancelled') {
    return;
  }
  if (msg.method === 'tools/list') {
    respondRaw(msg.id, {
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    });
    return;
  }
  if (msg.method === 'tools/call') {
    void handleToolsCall(msg.id, msg.params);
    return;
  }
  if (msg.method === 'ping') {
    respondRaw(msg.id, {});
    return;
  }
  log(`unhandled method: ${msg.method}`);
});

rl.on('close', () => {
  if (broker && !broker.destroyed) broker.destroy();
  process.exit(0);
});

connectBroker().catch((error) => {
  // A missing broker must not crash the kernel — log and keep serving an
  // empty catalog so the kernel still starts (tools will error on call).
  log(`broker unavailable: ${error.message}`);
});
