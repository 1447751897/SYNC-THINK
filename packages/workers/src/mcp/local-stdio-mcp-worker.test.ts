import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  expandStdioEndpoint,
  LocalStdioMcpWorker,
  parseLocalStdioCommand,
} from './local-stdio-mcp-worker.js';
import { collect } from '../support.js';

describe('parseLocalStdioCommand', () => {
  it('parses node -e commands', () => {
    const p = parseLocalStdioCommand('node -e "console.log(1)"');
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.command).toBe('node');
      expect(p.args[0]).toBe('-e');
      expect(p.args[1]).toBe('console.log(1)');
    }
  });

  it('refuses fake/http endpoints', () => {
    expect(parseLocalStdioCommand('fake://x').ok).toBe(false);
    expect(parseLocalStdioCommand('https://evil').ok).toBe(false);
  });

  it('refuses shell metacharacters', () => {
    expect(parseLocalStdioCommand('node -e x & calc').ok).toBe(false);
  });

  it('refuses non-allowlisted binaries', () => {
    expect(parseLocalStdioCommand('python -c print(1)').ok).toBe(false);
  });

  it('expands Claude-style MCP env commands before the allowlist', () => {
    expect(expandStdioEndpoint('MCP_GITHUB_COMMAND', {}).ok).toBe(false);
    expect(
      parseLocalStdioCommand('MCP_GITHUB_COMMAND', {
        MCP_GITHUB_COMMAND: 'npx -y @modelcontextprotocol/server-github',
      }),
    ).toEqual({
      ok: true,
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
    });
    expect(parseLocalStdioCommand('uvx heygen-mcp')).toEqual({
      ok: true,
      command: 'uvx',
      args: ['heygen-mcp'],
    });
  });
});

describe('LocalStdioMcpWorker', () => {
  const token = { token: 't', allowedRoot: process.cwd(), timeoutMs: 15_000 };

  it('spawns real node process and captures stdout with untrusted audit', async () => {
    const w = new LocalStdioMcpWorker();
    const events = await collect(
      w.exec(
        {
          workingDir: process.cwd(),
          endpoint: 'node -e "process.stdout.write("MCP_SPAWN_OK")"',
          transport: 'local-stdio',
          policy: { maxOutputBytes: 4096, timeoutMs: 10_000, trusted: false },
          mcpServerId: 'mcp-real-1',
          action: { kind: 'spawn-probe', toolName: 'spawn-probe' },
          now: '2026-07-12T10:00:00.000Z',
        },
        token,
      ),
    );
    const completed = events.find((e) => e.type === 'completed');
    expect(completed).toBeTruthy();
    if (completed?.type === 'completed') {
      const out = completed.output as unknown as {
        ok: boolean;
        simulated: boolean;
        spawned: boolean;
        exitCode: number | null;
        contentTrust: string;
        preview: string;
        audit: { note: string };
      };
      expect(out.simulated).toBe(false);
      expect(out.spawned).toBe(true);
      expect(out.ok).toBe(true);
      expect(out.exitCode).toBe(0);
      expect(out.contentTrust).toBe('untrusted');
      expect(out.preview).toMatch(/MCP_SPAWN_OK/);
      expect(out.audit.note).toMatch(/real-spawn/);
    }
  }, 20_000);

  it('times out and kills long-running process', async () => {
    const w = new LocalStdioMcpWorker();
    const events = await collect(
      w.exec(
        {
          workingDir: process.cwd(),
          endpoint: 'node -e "setTimeout(()=>{}, 60000)"',
          transport: 'local-stdio',
          policy: { maxOutputBytes: 1024, timeoutMs: 400, trusted: false },
          action: { kind: 'spawn-probe' },
        },
        { ...token, timeoutMs: 5_000 },
      ),
    );
    const failed = events.find((e) => e.type === 'failed');
    expect(failed?.type === 'failed' && failed.failureClass === 'timeout').toBe(true);
    const completed = events.find((e) => e.type === 'completed');
    if (completed?.type === 'completed') {
      const out = completed.output as unknown as { timedOut: boolean; spawned: boolean; simulated: boolean };
      expect(out.timedOut).toBe(true);
      expect(out.spawned).toBe(true);
      expect(out.simulated).toBe(false);
    }
  }, 20_000);

  it('refuses fake endpoint without spawning', async () => {
    const w = new LocalStdioMcpWorker();
    const events = await collect(
      w.exec(
        {
          workingDir: process.cwd(),
          endpoint: 'fake://nope',
          transport: 'local-stdio',
          policy: { maxOutputBytes: 1024, timeoutMs: 2000, trusted: false },
          action: { kind: 'spawn-probe' },
        },
        token,
      ),
    );
    expect(events.some((e) => e.type === 'failed')).toBe(true);
    const completed = events.find((e) => e.type === 'completed');
    expect(completed).toBeTruthy();
    if (completed?.type === 'completed') {
      const out = completed.output as unknown as { spawned: boolean; simulated: boolean; refuseReason?: string };
      expect(out.spawned).toBe(false);
      expect(out.simulated).toBe(false);
      expect(String(out.refuseReason || '')).toMatch(/fake|URL|endpoint/i);
    }
  });

  it('does not spawn when cancellation wins before the worker start fence', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-mcp-cancel-before-'));
    const marker = join(dir, 'spawned.txt');
    const fixturePath = fileURLToPath(
      new URL('./fixtures/cancellable-process.mjs', import.meta.url),
    );
    const controller = new AbortController();
    controller.abort(new Error('run.cancelled'));
    try {
      const events = await collect(
        new LocalStdioMcpWorker().exec(
          {
            workingDir: process.cwd(),
            endpoint: `node "${fixturePath}" "${marker}"`,
            transport: 'local-stdio',
            policy: { maxOutputBytes: 1024, timeoutMs: 500, trusted: false },
            action: { kind: 'spawn-probe' },
          },
          { ...token, signal: controller.signal, beforeStart: () => true },
        ),
      );
      expect(existsSync(marker)).toBe(false);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'failed',
          failureClass: 'acceptance',
          error: expect.objectContaining({ code: 'worker.aborted' }),
        }),
      );
      expect(events.find((event) => event.type === 'completed')).toMatchObject({
        output: { spawned: false, ok: false },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('kills an already spawned process when the execution signal is cancelled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-mcp-cancel-after-'));
    const marker = join(dir, 'spawned.txt');
    const fixturePath = fileURLToPath(
      new URL('./fixtures/cancellable-process.mjs', import.meta.url),
    );
    const controller = new AbortController();
    try {
      const eventsPromise = collect(
        new LocalStdioMcpWorker().exec(
          {
            workingDir: process.cwd(),
            endpoint: `node "${fixturePath}" "${marker}"`,
            transport: 'local-stdio',
            policy: { maxOutputBytes: 1024, timeoutMs: 5_000, trusted: false },
            action: { kind: 'spawn-probe' },
          },
          { ...token, signal: controller.signal, beforeStart: () => true },
        ),
      );
      const deadline = Date.now() + 3_000;
      while (!existsSync(marker)) {
        if (Date.now() >= deadline) throw new Error('worker process did not write marker');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const pid = Number(readFileSync(marker, 'utf8'));
      controller.abort(new Error('run.cancelled'));
      const events = await eventsPromise;
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'failed', failureClass: 'acceptance' }),
      );
      expect(events.find((event) => event.type === 'completed')).toMatchObject({
        output: { spawned: true, ok: false, timedOut: false },
      });
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 10_000);
});

describe('LocalStdioMcpWorker call-tool (JSON-RPC)', () => {
  const token = { token: 't', allowedRoot: process.cwd(), timeoutMs: 20_000 };
  const fixturePath = fileURLToPath(new URL('./fixtures/mini-mcp-server.mjs', import.meta.url));
  const ep = 'node "' + fixturePath + '"';

  it('calls echo tool via real MCP JSON-RPC', async () => {
    const w = new LocalStdioMcpWorker();
    const events = await collect(
      w.exec(
        {
          workingDir: process.cwd(),
          endpoint: ep,
          transport: 'local-stdio',
          policy: { maxOutputBytes: 16_384, timeoutMs: 12_000, trusted: false },
          mcpServerId: 'mcp-jsonrpc-1',
          action: {
            kind: 'call-tool',
            toolName: 'echo',
            toolArguments: { text: 'HELLO_MCP' },
          },
          now: '2026-07-12T12:00:00.000Z',
        },
        token,
      ),
    );
    const completed = events.find((e) => e.type === 'completed');
    expect(completed).toBeTruthy();
    if (completed?.type === 'completed') {
      const out = completed.output as unknown as {
        ok: boolean;
        simulated: boolean;
        spawned: boolean;
        jsonRpcOk?: boolean;
        protocol?: string;
        toolResultText?: string;
        preview: string;
        contentTrust: string;
        audit: { note: string };
      };
      expect(out.simulated).toBe(false);
      expect(out.spawned).toBe(true);
      expect(out.ok).toBe(true);
      expect(out.jsonRpcOk).toBe(true);
      expect(out.protocol).toBe('mcp-jsonrpc');
      expect(out.toolResultText || out.preview).toMatch(/ECHO:HELLO_MCP/);
      expect(out.contentTrust).toBe('untrusted');
      expect(out.audit.note).toMatch(/real-jsonrpc/);
    }
  }, 25_000);

  it('refuses fake endpoint for call-tool without spawn', async () => {
    const w = new LocalStdioMcpWorker();
    const events = await collect(
      w.exec(
        {
          workingDir: process.cwd(),
          endpoint: 'fake://nope',
          policy: { maxOutputBytes: 1024, timeoutMs: 2000, trusted: false },
          action: { kind: 'call-tool', toolName: 'echo' },
        },
        token,
      ),
    );
    const completed = events.find((e) => e.type === 'completed');
    expect(completed?.type === 'completed').toBe(true);
    if (completed?.type === 'completed') {
      const out = completed.output as unknown as {
        spawned: boolean;
        refuseReason?: string;
        ok: boolean;
      };
      expect(out.spawned).toBe(false);
      expect(out.ok).toBe(false);
      expect(out.refuseReason).toBeTruthy();
    }
  });
});



describe('LocalStdioMcpWorker list-tools (JSON-RPC tools/list)', () => {
  const token = { token: 't', allowedRoot: process.cwd(), timeoutMs: 20_000 };
  const fixturePath = fileURLToPath(new URL('./fixtures/mini-mcp-server.mjs', import.meta.url));
  const ep = 'node "' + fixturePath + '"';

  it('lists tools via real MCP JSON-RPC tools/list', async () => {
    const w = new LocalStdioMcpWorker();
    const events = await collect(
      w.exec(
        {
          workingDir: process.cwd(),
          endpoint: ep,
          transport: 'local-stdio',
          policy: { maxOutputBytes: 65_536, timeoutMs: 12_000, trusted: false },
          mcpServerId: 'mcp-list-1',
          action: { kind: 'list-tools', maxTools: 32 },
          now: '2026-07-12T12:00:00.000Z',
        },
        token,
      ),
    );
    const completed = events.find((e) => e.type === 'completed');
    expect(completed?.type === 'completed').toBe(true);
    if (completed?.type === 'completed') {
      const out = completed.output as unknown as {
        ok: boolean;
        simulated: boolean;
        spawned: boolean;
        jsonRpcOk: boolean;
        protocol: string;
        toolCount: number;
        tools: Array<{ name: string; description: string; inputSchemaJson?: string }>;
        contentTrust: string;
        audit: { note: string };
      };
      expect(out.simulated).toBe(false);
      expect(out.spawned).toBe(true);
      expect(out.ok).toBe(true);
      expect(out.jsonRpcOk).toBe(true);
      expect(out.protocol).toBe('mcp-jsonrpc');
      expect(out.toolCount).toBeGreaterThanOrEqual(3);
      const names = (out.tools || []).map((t) => t.name).sort();
      expect(names).toEqual(expect.arrayContaining(['echo', 'ping', 'write_file']));
      expect(out.contentTrust).toBe('untrusted');
      expect(out.audit.note).toMatch(/tools\/list|real-jsonrpc/);
      const echo = (out.tools || []).find((t) => t.name === 'echo');
      expect(echo?.description).toMatch(/Echo/i);
      expect(echo?.inputSchemaJson).toMatch(/text/);
    }
  }, 30_000);

  it('refuses fake endpoint for list-tools without spawn', async () => {
    const w = new LocalStdioMcpWorker();
    const events = await collect(
      w.exec(
        {
          workingDir: process.cwd(),
          endpoint: 'fake://nope',
          policy: { maxOutputBytes: 1024, timeoutMs: 2000, trusted: false },
          action: { kind: 'list-tools' },
        },
        token,
      ),
    );
    const completed = events.find((e) => e.type === 'completed');
    expect(completed?.type === 'completed').toBe(true);
    if (completed?.type === 'completed') {
      const out = completed.output as unknown as {
        spawned: boolean;
        refuseReason?: string;
        ok: boolean;
        toolCount?: number;
        tools?: unknown[];
      };
      expect(out.spawned).toBe(false);
      expect(out.ok).toBe(false);
      expect(out.refuseReason).toBeTruthy();
      expect(out.toolCount === 0 || out.toolCount === undefined || Array.isArray(out.tools)).toBe(true);
    }
  });
});
