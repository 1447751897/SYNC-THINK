import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { KernelEvent, KernelRequest } from '@sync-think/shared';
import { CodexKernelAdapter } from './codex-adapter.js';
import { startKernelProcess } from './process.js';

const fixturePath = fileURLToPath(
  new URL('./fixtures/codex-exec-jsonl-fixture.mjs', import.meta.url),
);

/** Spawn the fixture codex instead of the real binary. */
function fixtureSpawn(args: string[], env: Record<string, string>, cwd: string) {
  return startKernelProcess({
    command: process.execPath,
    args: [fixturePath, ...args],
    cwd,
    env,
    stdin: 'ignore',
  });
}

/** Capture spawn args + env through the seam while still running the fixture. */
function captureSpawn() {
  const calls: Array<{ args: string[]; env: Record<string, string> }> = [];
  const spawn = (args: string[], env: Record<string, string>, cwd: string) => {
    calls.push({ args, env });
    return fixtureSpawn(args, env, cwd);
  };
  return { calls, spawn };
}

function makeRequest(overrides: Partial<KernelRequest> = {}): KernelRequest {
  return {
    kernelId: 'codex',
    model: 'gpt-5',
    providerModelId: 'gpt-5',
    userText: 'hello fixture',
    contextWindow: 200_000,
    credential: { reuseLocalLogin: true },
    systemContext: '## AGENTS.md\n\nfixture facts',
    platformTools: [],
    permissionMode: 'ask',
    workspaceDir: process.cwd(),
    ...overrides,
  };
}

async function runFixture(overrides: Partial<KernelRequest> = {}, adapterDeps = {}) {
  const adapter = new CodexKernelAdapter({
    spawn: fixtureSpawn,
    ...adapterDeps,
  });
  const events: KernelEvent[] = [];
  for await (const event of adapter.start(makeRequest(overrides))) {
    events.push(event);
    if (event.type === 'terminal') break;
  }
  return { events, adapter };
}

describe('CodexKernelAdapter', () => {
  it('translates agent_message → delta, command_execution → tool timeline, reasoning, usage', async () => {
    const { events } = await runFixture();

    const delta = events.find((event) => event.type === 'delta');
    expect(delta).toMatchObject({ type: 'delta', text: 'fixture answer text' });

    const toolCall = events.find((event) => event.type === 'tool-call');
    expect(toolCall).toMatchObject({
      type: 'tool-call',
      toolId: 'call_fixture_1',
      name: 'command_execution',
      partial: false,
    });
    expect(
      toolCall && 'argsJson' in toolCall ? (toolCall as { argsJson: string }).argsJson : '',
    ).toBe('{"command":"echo hello"}');

    const toolResult = events.find((event) => event.type === 'tool-result');
    expect(toolResult).toMatchObject({
      type: 'tool-result',
      toolId: 'call_fixture_1',
      output: 'hello\n',
      isError: false,
    });

    const reasoning = events.find((event) => event.type === 'reasoning');
    expect(reasoning).toMatchObject({ type: 'reasoning', text: 'thinking fixture' });

    const usage = events.find((event) => event.type === 'usage');
    expect(usage).toMatchObject({
      type: 'usage',
      usage: {
        real: 25, // 10 input + 5 cached + 3 cache-write + 7 output
        window: 200_000,
        input: 18,
        output: 7,
        cached: 5,
      },
    });
  });

  it('ignores non-JSON lines and unknown event types, completes on turn.completed', async () => {
    const { events } = await runFixture();
    const terminal = events[events.length - 1];
    expect(terminal).toMatchObject({ type: 'terminal', status: 'completed' });
    // The unknown-event payload must never surface as a delta or a failure.
    expect(
      events.some((event) => event.type === 'terminal' && event.status === 'failed'),
    ).toBe(false);
  });

  it('maps turn.failed with a JSON-wrapped nested error to a failed terminal', async () => {
    const { events } = await runFixture(
      {},
      {
        spawn: (args: string[], env: Record<string, string>, cwd: string) =>
          startKernelProcess({
            command: process.execPath,
            args: [fixturePath, ...args],
            cwd,
            env: { ...env, FIXTURE_FAIL: '1' },
            stdin: 'ignore',
          }),
      },
    );
    const terminal = events[events.length - 1];
    expect(terminal).toMatchObject({
      type: 'terminal',
      status: 'failed',
      error: 'Unsupported value: max',
    });
  });

  it('maps host permission tiers to static approval policy + sandbox', async () => {
    // full-access → never + danger-full-access
    const captureA = captureSpawn();
    await runFixture({ permissionMode: 'full-access' }, { spawn: captureA.spawn });
    expect(captureA.calls).toHaveLength(1);
    const argsA = captureA.calls[0].args;
    expect(argsA).toContain('--ask-for-approval');
    expect(argsA[argsA.indexOf('--ask-for-approval') + 1]).toBe('never');
    expect(argsA[argsA.indexOf('-s') + 1]).toBe('danger-full-access');

    // ask → on-request + workspace-write
    const captureB = captureSpawn();
    await runFixture({ permissionMode: 'ask' }, { spawn: captureB.spawn });
    const argsB = captureB.calls[0].args;
    expect(argsB[argsB.indexOf('--ask-for-approval') + 1]).toBe('on-request');
    expect(argsB[argsB.indexOf('-s') + 1]).toBe('workspace-write');

    // workspace → untrusted + workspace-write
    const captureC = captureSpawn();
    await runFixture({ permissionMode: 'workspace' }, { spawn: captureC.spawn });
    const argsC = captureC.calls[0].args;
    expect(argsC[argsC.indexOf('--ask-for-approval') + 1]).toBe('untrusted');
    expect(argsC[argsC.indexOf('-s') + 1]).toBe('workspace-write');
  });

  it('passes provider model via args and the prompt over stdin (never argv)', async () => {
    const capture = captureSpawn();
    await runFixture({ providerModelId: 'gpt-5.2' }, { spawn: capture.spawn });
    const args = capture.calls[0].args;
    expect(args).toContain('--model');
    expect(args[args.indexOf('--model') + 1]).toBe('gpt-5.2');
    expect(args).toContain('--skip-git-repo-check');
    // User text must not cross the command line (cmd.exe shim + process list).
    expect(args.some((arg) => arg.includes('hello fixture'))).toBe(false);
  });

  it('registers the platform MCP server via single-quoted mcp_servers overrides', async () => {
    const capture = captureSpawn();
    await runFixture(
      {
        platformBroker: {
          host: '127.0.0.1',
          port: 49152,
          token: 'tok-123',
          workspaceDir: 'C:/ws',
          command: 'C:/node/node.exe',
          args: ['D:/mcp/platform-mcp-server.mjs'],
        },
      },
      { spawn: capture.spawn },
    );
    const args = capture.calls[0].args;
    const joined = args.join(' ');
    expect(joined).toContain(`mcp_servers.sync-think-platform.command='C:/node/node.exe'`);
    expect(joined).toContain(`env.ST_BROKER_TOKEN='tok-123'`);
    expect(joined).toContain(`env.ST_BROKER_PORT='49152'`);
    // No double quotes anywhere: they would be rejected by the cmd shim.
    expect(joined).not.toContain('"');
  });

  it('injects credentials via env only when local login is not reused', async () => {
    const capture = captureSpawn();
    await runFixture(
      {
        credential: {
          baseUrl: 'https://relay.example/v1',
          apiKey: 'sk-test-secret-1234567890',
          reuseLocalLogin: false,
        },
      },
      { spawn: capture.spawn },
    );
    const env = capture.calls[0].env;
    expect(env.OPENAI_API_KEY).toBe('sk-test-secret-1234567890');
    expect(env.OPENAI_BASE_URL).toBe('https://relay.example/v1');

    const captureLocal = captureSpawn();
    await runFixture({ credential: { reuseLocalLogin: true } }, { spawn: captureLocal.spawn });
    expect(captureLocal.calls[0].env.OPENAI_API_KEY).toBeUndefined();
    expect(captureLocal.calls[0].env.OPENAI_BASE_URL).toBeUndefined();
  });

  it('reports usage through the onUsage callback', async () => {
    const adapter = new CodexKernelAdapter({ spawn: fixtureSpawn });
    const usages: Array<{ real: number; cached?: number }> = [];
    adapter.onUsage((usage) => usages.push(usage));
    for await (const event of adapter.start(makeRequest())) {
      if (event.type === 'terminal') break;
    }
    expect(usages.length).toBeGreaterThan(0);
    expect(usages[0]).toMatchObject({ real: 25, cached: 5 });
  });

  it('detectVersion probes the local codex (installed state depends on machine)', async () => {
    const adapter = new CodexKernelAdapter();
    const version = await adapter.detectVersion();
    expect(version === null || typeof version === 'string').toBe(true);
  });

  it('cancel() terminates the kernel process tree and ends the stream', async () => {
    const adapter = new CodexKernelAdapter({ spawn: fixtureSpawn });
    const iterator = adapter.start(makeRequest()) as AsyncGenerator<KernelEvent>;
    const first = await iterator.next();
    expect(first.done).toBe(false);
    await adapter.cancel();
    // Queued events drain first; the stream must end (done or terminal) promptly.
    let ended = false;
    for (let i = 0; i < 50; i++) {
      const next = await iterator.next();
      if (next.done || next.value?.type === 'terminal') {
        ended = true;
        break;
      }
    }
    expect(ended).toBe(true);
  });
});
