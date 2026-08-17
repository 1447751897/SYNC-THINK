import { describe, expect, it, vi } from 'vitest';
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

function fixtureModeSpawn(mode: string) {
  return (args: string[], env: Record<string, string>, cwd: string) =>
    startKernelProcess({
      command: process.execPath,
      args: [fixturePath, ...args],
      cwd,
      env: { ...env, FIXTURE_MODE: mode },
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
    effectiveContextWindow: 200_000,
    contextWindowSource: 'configured',
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
        // Real codex reports total = input + output, so cached/cache-write are
        // subsets of input_tokens and must not be added again.
        real: 17, // 10 input + 7 output
        window: 200_000,
        input: 10,
        output: 7,
        cached: 5,
        cachedTokensCreated: 3,
        reasoningTokens: 2,
        requestId: expect.stringMatching(/^codex-turn-/),
      },
    });
  });

  it('reports the real Codex thread id as the kernel session identity', async () => {
    const { events } = await runFixture();
    expect(events.find((event) => event.type === 'session-started')).toEqual({
      type: 'session-started',
      sessionId: 'thread_fixture_1',
    });
  });

  it('ignores non-JSON lines and unknown event types, completes on turn.completed', async () => {
    const { events } = await runFixture();
    const terminal = events[events.length - 1];
    expect(terminal).toMatchObject({ type: 'terminal', status: 'completed' });
    // The unknown-event payload must never surface as a delta or a failure.
    expect(events.some((event) => event.type === 'terminal' && event.status === 'failed')).toBe(
      false,
    );
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

  it('keeps transient reconnect diagnostics non-terminal so Codex can recover', async () => {
    const { events } = await runFixture(
      {},
      {
        spawn: fixtureModeSpawn('transient-reconnect-then-success'),
      },
    );

    expect(events.find((event) => event.type === 'delta')).toEqual({
      type: 'delta',
      text: 'recovered after reconnect',
    });
    expect(events.filter((event) => event.type === 'terminal')).toEqual([
      { type: 'terminal', status: 'completed' },
    ]);
    expect(events.find((event) => event.type === 'usage')).toMatchObject({
      type: 'usage',
      usage: { input: 8, output: 4, real: 12 },
    });
  });

  it('flushes a terminal JSON object that is not followed by a newline', async () => {
    const { events } = await runFixture(
      {},
      {
        spawn: fixtureModeSpawn('terminal-without-newline'),
      },
    );

    expect(events.filter((event) => event.type === 'terminal')).toEqual([
      { type: 'terminal', status: 'completed' },
    ]);
    expect(events.find((event) => event.type === 'usage')).toMatchObject({
      type: 'usage',
      usage: { input: 3, output: 2, real: 5 },
    });
  });

  it('turns a non-zero process exit without a protocol terminal into one redacted failure', async () => {
    const adapter = new CodexKernelAdapter({
      spawn: fixtureModeSpawn('exit-without-terminal'),
    });
    const events: KernelEvent[] = [];
    const exits: Array<{ code: number | null; stderrTail: string }> = [];
    adapter.onExit((code, stderrTail) => exits.push({ code, stderrTail }));

    for await (const event of adapter.start(
      makeRequest({
        credential: {
          apiKey: 'sk-fixture-secret-123456789',
          baseUrl: 'http://127.0.0.1:43123/v1',
        },
      }),
    )) {
      events.push(event);
    }

    const terminals = events.filter((event) => event.type === 'terminal');
    expect(terminals).toHaveLength(1);
    expect(terminals[0]).toMatchObject({
      type: 'terminal',
      status: 'failed',
      error: expect.stringContaining('Codex exited with code 9'),
    });
    expect(JSON.stringify({ terminals, exits })).toContain('[REDACTED]');
    expect(JSON.stringify({ terminals, exits })).not.toContain('sk-fixture-secret-123456789');
    expect(exits).toMatchObject([{ code: 9 }]);
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

  it('places controlled global CLI args before exec without replacing run-scoped MCP config', async () => {
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
      {
        spawn: capture.spawn,
        globalArgs: [
          '--disable',
          'plugins',
          '--disable',
          'apps',
          '-c',
          'mcp_servers.node_repl.enabled=false',
        ],
        execArgs: ['--ignore-rules'],
      },
    );

    const args = capture.calls[0].args;
    const execIndex = args.indexOf('exec');
    expect(args.slice(0, execIndex)).toEqual([
      '--ask-for-approval',
      'on-request',
      '--disable',
      'plugins',
      '--disable',
      'apps',
      '-c',
      'mcp_servers.node_repl.enabled=false',
    ]);
    expect(args[execIndex + 1]).toBe('--ignore-rules');
    expect(args.slice(execIndex)).toContain(
      `mcp_servers.sync-think-platform.command='C:/node/node.exe'`,
    );
  });

  it('resumes the requested Codex thread and still sends the prompt over stdin', async () => {
    const capture = captureSpawn();
    await runFixture(
      {
        session: { id: '019fe531-53e9-7e23-8f74-fe3fd400d21e', mode: 'resume' },
      },
      { spawn: capture.spawn },
    );
    const args = capture.calls[0].args;
    const resumeIndex = args.indexOf('resume');
    expect(resumeIndex).toBeGreaterThan(args.indexOf('exec'));
    expect(args[resumeIndex + 1]).toBe('019fe531-53e9-7e23-8f74-fe3fd400d21e');
    expect(args[resumeIndex + 2]).toBe('-');
    expect(args.some((arg) => arg.includes('hello fixture'))).toBe(false);
  });

  it('injects bootstrap context into the first Codex prompt but not resumed prompts', async () => {
    const stdinWrites: string[] = [];
    const spawn = (args: string[], env: Record<string, string>, cwd: string) => {
      const handle = startKernelProcess({
        command: process.execPath,
        args: [fixturePath, ...args],
        cwd,
        env,
      });
      if (handle.child.stdin) {
        const originalWrite = handle.child.stdin.write.bind(handle.child.stdin);
        vi.spyOn(handle.child.stdin, 'write').mockImplementation(((
          chunk: unknown,
          ...rest: unknown[]
        ) => {
          stdinWrites.push(String(chunk));
          return Reflect.apply(originalWrite, handle.child.stdin, [chunk, ...rest]);
        }) as typeof handle.child.stdin.write);
      }
      return handle;
    };

    await runFixture({}, { spawn });
    expect(stdinWrites.join('')).toContain('## AGENTS.md');
    expect(stdinWrites.join('')).toContain('hello fixture');

    stdinWrites.length = 0;
    await runFixture(
      {
        session: { id: '019fe531-53e9-7e23-8f74-fe3fd400d21e', mode: 'resume' },
      },
      { spawn },
    );
    expect(stdinWrites.join('')).toBe('hello fixture\n');
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

  it('pins a per-run model_provider to the resolved baseUrl and injects the key via env_key', async () => {
    const capture = captureSpawn();
    await runFixture(
      {
        credential: {
          baseUrl: 'https://api.deepseek.com/v1',
          apiKey: 'sk-test-secret-1234567890',
          reuseLocalLogin: false,
        },
      },
      { spawn: capture.spawn },
    );
    const { args, env } = capture.calls[0];
    const joined = args.join(' ');
    // The global ~/.codex/config.toml `model_provider = "custom"` (KMKAPI) must
    // be overridden with a per-run provider pointing at the selected upstream.
    // Values are single-quoted TOML literals: on Windows codex is a `.cmd` shim
    // and the cmd.exe shim whitelist rejects `"`, so double-quoted overrides
    // failed the spawn before codex ever ran. See codex-adapter.spawn-args.test.ts.
    const providerMatch = /-c model_provider='(st_[a-f0-9]+)'/.exec(joined);
    expect(providerMatch).not.toBeNull();
    const providerId = providerMatch![1];
    expect(joined).toContain(`model_providers.${providerId}.base_url='https://api.deepseek.com/v1'`);
    expect(joined).toContain(`model_providers.${providerId}.wire_api='responses'`);
    expect(joined).toContain(`model_providers.${providerId}.requires_openai_auth=false`);
    const envKeyMatch = new RegExp(`model_providers\\.${providerId}\\.env_key='(ST_KERNEL_KEY_[A-Za-z0-9]+)'`).exec(joined);
    expect(envKeyMatch).not.toBeNull();
    // The secret rides only in the per-run env var, never on the command line.
    expect(joined).not.toContain('sk-test-secret-1234567890');
    expect(env[envKeyMatch![1]]).toBe('sk-test-secret-1234567890');
    expect(env.OPENAI_API_KEY).toBe('sk-test-secret-1234567890');
    expect(env.OPENAI_BASE_URL).toBeUndefined();

    const captureLocal = captureSpawn();
    await runFixture({ credential: { reuseLocalLogin: true } }, { spawn: captureLocal.spawn });
    const localJoined = captureLocal.calls[0].args.join(' ');
    expect(localJoined).not.toContain('model_provider=');
    expect(captureLocal.calls[0].env.OPENAI_API_KEY).toBeUndefined();
  });

  it('reports usage through the onUsage callback', async () => {
    const adapter = new CodexKernelAdapter({ spawn: fixtureSpawn });
    const usages: Array<{ real: number; cached?: number }> = [];
    adapter.onUsage((usage) => usages.push(usage));
    for await (const event of adapter.start(makeRequest())) {
      if (event.type === 'terminal') break;
    }
    expect(usages.length).toBeGreaterThan(0);
    expect(usages[0]).toMatchObject({
      real: 17,
      cached: 5,
      cachedTokensCreated: 3,
      reasoningTokens: 2,
      requestId: expect.stringMatching(/^codex-turn-/),
    });
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

  it('injects -c model_context_window=<effective> and echoes the effective window in usage', async () => {
    const { calls, spawn } = captureSpawn();
    const adapter = new CodexKernelAdapter({ spawn });
    const events: KernelEvent[] = [];
    for await (const event of adapter.start(
      makeRequest({ effectiveContextWindow: 96_000 }),
    )) {
      events.push(event);
      if (event.type === 'terminal') break;
    }
    const args = calls[0]?.args ?? [];
    const windowIndex = args.indexOf('-c');
    expect(windowIndex).toBeGreaterThan(-1);
    expect(args[windowIndex + 1]).toBe('model_context_window=96000');
    // Codex's own auto-compaction threshold is handed the same window limit so
    // its native mechanism decides when to compact (host never re-compacts).
    expect(args).toContain('model_auto_compact_token_limit=96000');
    const usage = events.find((event) => event.type === 'usage');
    expect(usage && 'usage' in usage ? (usage.usage.window ?? null) : null).toBe(96_000);
  });

  it('injects -c model_reasoning_effort=<effort> when the host sets a reasoning effort', async () => {
    const capture = captureSpawn();
    await runFixture({ reasoningEffort: 'high' }, { spawn: capture.spawn });
    expect(capture.calls[0].args).toContain('model_reasoning_effort=high');
    expect(capture.calls[0].args).toContain('model_reasoning_summary=detailed');

    // 'off' maps to codex's minimal reasoning so providers still emit thinking.
    const captureOff = captureSpawn();
    await runFixture({ reasoningEffort: 'off' }, { spawn: captureOff.spawn });
    expect(captureOff.calls[0].args).toContain('model_reasoning_effort=minimal');

    // Omitted effort → no reasoning override.
    const captureNone = captureSpawn();
    await runFixture({}, { spawn: captureNone.spawn });
    expect(captureNone.calls[0].args.some((arg) => arg.includes('model_reasoning_effort'))).toBe(false);
    expect(captureNone.calls[0].args).toContain('model_reasoning_summary=detailed');
  });

  it('maps codex auto-compaction (compacted + event_msg.context_compacted) to compacted events', async () => {
    const { events } = await runFixture(
      {},
      { spawn: fixtureModeSpawn('auto-compacted') },
    );
    const compacted = events.filter((event) => event.type === 'compacted');
    expect(compacted).toHaveLength(2);
    const terminal = events[events.length - 1];
    expect(terminal).toMatchObject({ type: 'terminal', status: 'completed' });
  });

  it('prefixes the resumed prompt with the catch-up transcript (never the full system context)', async () => {
    let stdinChunks = '';
    const adapter = new CodexKernelAdapter({
      spawn: (args, env, cwd) => {
        const handle = startKernelProcess({
          command: process.execPath,
          args: [fixturePath, ...args],
          cwd,
          env,
        });
        const stdin = handle.child.stdin;
        if (stdin) {
          const originalWrite = stdin.write.bind(stdin);
          const write = vi.spyOn(stdin, 'write');
          write.mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
            stdinChunks += String(chunk);
            return Reflect.apply(originalWrite, stdin, [chunk, ...rest]);
          }) as typeof stdin.write);
        }
        return handle;
      },
    });
    for await (const event of adapter.start(
      makeRequest({
        userText: 'continue the work',
        session: {
          id: 'thread-1',
          mode: 'resume',
          catchUp: '## Cross-kernel session gap\n### User\ngap fact from claude era',
        },
      }),
    )) {
      if (event.type === 'terminal') break;
    }
    expect(stdinChunks).toContain('## Cross-kernel session gap');
    expect(stdinChunks).toContain('gap fact from claude era');
    expect(stdinChunks).toContain('continue the work');
    expect(stdinChunks).not.toContain('AGENTS.md');
  });
});
