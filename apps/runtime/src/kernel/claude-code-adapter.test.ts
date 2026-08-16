import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { KernelEvent, KernelPermissionRequest, KernelRequest } from '@sync-think/shared';
import { ClaudeCodeKernelAdapter } from './claude-code-adapter.js';
import { startKernelProcess } from './process.js';

const fixturePath = fileURLToPath(
  new URL('./fixtures/claude-stream-json-fixture.mjs', import.meta.url),
);

/** Spawn the fixture claude instead of the real binary. */
function fixtureSpawn(args: string[], env: Record<string, string>, cwd: string) {
  return startKernelProcess({
    command: process.execPath,
    args: [fixturePath, ...args],
    cwd,
    env,
  });
}

function fixtureModeSpawn(mode: string) {
  return (args: string[], env: Record<string, string>, cwd: string) =>
    startKernelProcess({
      command: process.execPath,
      args: [fixturePath, ...args],
      cwd,
      env: { ...env, FIXTURE_MODE: mode },
    });
}

function makeRequest(overrides: Partial<KernelRequest> = {}): KernelRequest {
  return {
    kernelId: 'claude-code',
    model: 'claude-sonnet-4-5',
    providerModelId: 'claude-sonnet-4-5',
    userText: 'hello fixture',
    contextWindow: 200_000,
    effectiveContextWindow: 200_000,
    contextWindowSource: 'configured',
    credential: { reuseLocalLogin: true },
    systemContext: '## CLAUDE.md\n\nfixture facts',
    platformTools: [],
    permissionMode: 'ask',
    workspaceDir: process.cwd(),
    ...overrides,
  };
}

async function runFixture(overrides: Partial<KernelRequest> = {}) {
  const adapter = new ClaudeCodeKernelAdapter({ spawn: fixtureSpawn });
  const events: KernelEvent[] = [];
  const permissions: KernelPermissionRequest[] = [];
  adapter.onPermissionRequest((request) => {
    permissions.push(request);
    // Auto-approve after a tick so the stream can resume.
    setTimeout(() => adapter.respondPermission(request.requestId, { allow: true }), 30);
  });
  for await (const event of adapter.start(makeRequest(overrides))) {
    events.push(event);
    if (event.type === 'terminal') break;
  }
  return { events, permissions, adapter };
}

describe('ClaudeCodeKernelAdapter', () => {
  it('translates assistant text, tool calls and usage into KernelEvents', async () => {
    const { events } = await runFixture();

    const delta = events.find((event) => event.type === 'delta');
    expect(delta).toMatchObject({ type: 'delta', text: 'fixture assistant text' });

    const toolCall = events.find((event) => event.type === 'tool-call');
    expect(toolCall).toMatchObject({
      type: 'tool-call',
      name: 'fixture_tool',
      partial: false,
    });
    expect(
      toolCall && 'argsJson' in toolCall ? (toolCall as { argsJson: string }).argsJson : '',
    ).toBe('{"arg":"value"}');

    const usage = events.find((event) => event.type === 'usage');
    expect(usage).toMatchObject({
      type: 'usage',
      usage: {
        real: 165, // 10 input + 100 cache-create + 50 cache-read + 5 output
        window: 200_000,
        input: 160,
        output: 5,
        cached: 50,
        cachedTokensCreated: 100,
        requestId: 'msg_fixture_1',
        providerResponseId: 'msg_fixture_1',
      },
    });
  });

  it('ignores unknown stream events and completes on result success', async () => {
    const { events } = await runFixture();
    const terminal = events[events.length - 1];
    expect(terminal).toMatchObject({ type: 'terminal', status: 'completed' });
  });

  it('reports the Claude session after system/init confirms it', async () => {
    const { events } = await runFixture({
      session: { id: '4c793e96-7a25-4c15-94dd-19e4f9b2c7ef', mode: 'create' },
    });

    expect(events).toContainEqual({
      type: 'session-started',
      sessionId: 'fixture-session-1',
    });
  });

  it('bridges permission requests and resumes after respondPermission', async () => {
    const { permissions } = await runFixture();
    expect(permissions).toHaveLength(1);
    expect(permissions[0]).toMatchObject({
      requestId: 'perm-1',
      toolName: 'Bash',
      reason: 'can_use_tool',
    });
  });

  it('denies host-unsupported built-in tools without surfacing an approval card', async () => {
    const stdinLines: string[] = [];
    const permissions: KernelPermissionRequest[] = [];
    const baseSpawn = fixtureModeSpawn('builtin-deny-probe');
    const adapter = new ClaudeCodeKernelAdapter({
      spawn: (args, env, cwd) => {
        const handle = baseSpawn(args, env, cwd);
        const stdin = handle.child.stdin;
        if (stdin) {
          const originalWrite = stdin.write.bind(stdin);
          vi.spyOn(stdin, 'write').mockImplementation(((
            chunk: unknown,
            ...rest: unknown[]
          ) => {
            stdinLines.push(String(chunk));
            return Reflect.apply(originalWrite, stdin, [chunk, ...rest]);
          }) as typeof stdin.write);
        }
        return handle;
      },
    });
    adapter.onPermissionRequest((request) => permissions.push(request));

    for await (const event of adapter.start(makeRequest())) {
      if (event.type === 'terminal') break;
    }

    // The host-unsupported built-in never surfaces a permission card.
    expect(permissions).toHaveLength(0);
    const denyLine = stdinLines
      .map((line) => {
        try {
          return JSON.parse(line) as {
            type?: string;
            response?: { request_id?: string; response?: { behavior?: string } };
          };
        } catch {
          return undefined;
        }
      })
      .find((obj) => obj?.type === 'control_response');
    expect(denyLine).toMatchObject({
      type: 'control_response',
      response: {
        request_id: 'perm-builtin-1',
        response: { behavior: 'deny' },
      },
    });
  });

  it('forces a non-bypass permission mode and disallows native plan tools during planning mode', async () => {
    let spawnedArgs: string[] = [];
    const adapter = new ClaudeCodeKernelAdapter({
      spawn: (args, env, cwd) => {
        spawnedArgs = [...args];
        return fixtureSpawn(args, env, cwd);
      },
    });
    adapter.onPermissionRequest((request) => {
      setTimeout(() => adapter.respondPermission(request.requestId, { allow: true }), 30);
    });

    for await (const event of adapter.start(
      makeRequest({ planningMode: true, permissionMode: 'full-access' }),
    )) {
      if (event.type === 'terminal') break;
    }

    // full-access must never bypass permissions on a planning run, else Claude
    // would execute EnterPlanMode/AskUserQuestion without the host bridge.
    // `default` is Claude's standard ask-each-time mode (there is no `manual`).
    expect(spawnedArgs[spawnedArgs.indexOf('--permission-mode') + 1]).toBe('default');
    const disallowed = spawnedArgs[spawnedArgs.indexOf('--disallowedTools') + 1];
    expect(disallowed).toContain('EnterPlanMode');
    expect(disallowed).toContain('ExitPlanMode');
    expect(disallowed).toContain('AskUserQuestion');
  });

  it('reports usage through the onUsage callback', async () => {
    const adapter = new ClaudeCodeKernelAdapter({ spawn: fixtureSpawn });
    const usages: Array<{ real: number }> = [];
    adapter.onUsage((usage) => usages.push(usage));
    adapter.onPermissionRequest((request) => {
      setTimeout(() => adapter.respondPermission(request.requestId, { allow: true }), 30);
    });
    for await (const event of adapter.start(makeRequest())) {
      if (event.type === 'terminal') break;
    }
    expect(usages.length).toBeGreaterThan(0);
    expect(usages[0].real).toBe(165);
  });

  it('projects a replayed assistant tool_use block only once', async () => {
    const adapter = new ClaudeCodeKernelAdapter({
      spawn: fixtureModeSpawn('duplicate-assistant-tool-use'),
    });
    const events: KernelEvent[] = [];
    adapter.onPermissionRequest((request) => {
      setTimeout(() => adapter.respondPermission(request.requestId, { allow: true }), 30);
    });

    for await (const event of adapter.start(makeRequest())) {
      events.push(event);
      if (event.type === 'terminal') break;
    }

    expect(events.filter((event) => event.type === 'tool-call')).toHaveLength(1);
  });

  it('creates the requested Claude session and overrides both Anthropic token variables', async () => {
    let spawnedArgs: string[] = [];
    let spawnedEnv: Record<string, string> = {};
    const stdinLines: string[] = [];
    const adapter = new ClaudeCodeKernelAdapter({
      spawn: (args, env, cwd) => {
        spawnedArgs = [...args];
        spawnedEnv = { ...env };
        const handle = fixtureSpawn(args, env, cwd);
        const stdin = handle.child.stdin;
        if (stdin) {
          const originalWrite = stdin.write.bind(stdin);
          const write = vi.spyOn(stdin, 'write');
          write.mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
            stdinLines.push(String(chunk));
            return Reflect.apply(originalWrite, stdin, [chunk, ...rest]);
          }) as typeof stdin.write);
        }
        return handle;
      },
    });
    adapter.onPermissionRequest((request) => {
      setTimeout(() => adapter.respondPermission(request.requestId, { allow: true }), 30);
    });

    for await (const event of adapter.start(
      makeRequest({
        credential: {
          apiKey: 'gateway-ticket',
          baseUrl: 'http://127.0.0.1:43123/anthropic',
        },
        session: { id: '4c793e96-7a25-4c15-94dd-19e4f9b2c7ef', mode: 'create' },
      }),
    )) {
      if (event.type === 'terminal') break;
    }

    expect(spawnedArgs).toContain('--session-id');
    expect(spawnedArgs).not.toContain('--resume');
    expect(spawnedArgs).toContain('--print');
    expect(spawnedArgs).toContain('--setting-sources=');
    expect(spawnedArgs[spawnedArgs.indexOf('--session-id') + 1]).toBe(
      '4c793e96-7a25-4c15-94dd-19e4f9b2c7ef',
    );
    expect(spawnedEnv).toMatchObject({
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:43123/anthropic',
      ANTHROPIC_API_KEY: 'gateway-ticket',
      ANTHROPIC_AUTH_TOKEN: 'gateway-ticket',
    });
    const userEvent = stdinLines
      .map((line) => {
        try {
          return JSON.parse(line) as { type?: string; session_id?: string };
        } catch {
          return undefined;
        }
      })
      .find((line) => line?.type === 'user');
    expect(userEvent?.session_id).toBe('4c793e96-7a25-4c15-94dd-19e4f9b2c7ef');
  });

  it('strips a trailing /v1 from the base URL for the CLI (CLI appends /v1/messages itself)', async () => {
    let spawnedEnv: Record<string, string> = {};
    const adapter = new ClaudeCodeKernelAdapter({
      spawn: (args, env, cwd) => {
        spawnedEnv = { ...env };
        return fixtureSpawn(args, env, cwd);
      },
    });
    adapter.onPermissionRequest((request) => {
      setTimeout(() => adapter.respondPermission(request.requestId, { allow: true }), 30);
    });

    for await (const event of adapter.start(
      makeRequest({
        credential: {
          apiKey: 'deepseek-key',
          baseUrl: 'https://api.deepseek.com/v1',
        },
      }),
    )) {
      if (event.type === 'terminal') break;
    }

    // DeepSeek serves the Anthropic-compatible API under /anthropic; the CLI
    // composes {ANTHROPIC_BASE_URL}/v1/messages, so the provider's OpenAI-style
    // /v1 root must become https://api.deepseek.com/anthropic.
    expect(spawnedEnv.ANTHROPIC_BASE_URL).toBe('https://api.deepseek.com/anthropic');
    expect(spawnedEnv.ANTHROPIC_API_KEY).toBe('deepseek-key');
  });

  it('keeps a non-DeepSeek anthropic root untouched for the CLI', async () => {
    let spawnedEnv: Record<string, string> = {};
    const adapter = new ClaudeCodeKernelAdapter({
      spawn: (args, env, cwd) => {
        spawnedEnv = { ...env };
        return fixtureSpawn(args, env, cwd);
      },
    });
    adapter.onPermissionRequest((request) => {
      setTimeout(() => adapter.respondPermission(request.requestId, { allow: true }), 30);
    });

    for await (const event of adapter.start(
      makeRequest({
        credential: {
          apiKey: 'unity-key',
          baseUrl: 'https://api.unity2.ai',
        },
      }),
    )) {
      if (event.type === 'terminal') break;
    }

    expect(spawnedEnv.ANTHROPIC_BASE_URL).toBe('https://api.unity2.ai');
  });

  it('resumes an existing Claude session without creating a replacement session id', async () => {
    let spawnedArgs: string[] = [];
    const adapter = new ClaudeCodeKernelAdapter({
      spawn: (args, env, cwd) => {
        spawnedArgs = [...args];
        return fixtureSpawn(args, env, cwd);
      },
    });
    adapter.onPermissionRequest((request) => {
      setTimeout(() => adapter.respondPermission(request.requestId, { allow: true }), 30);
    });

    for await (const event of adapter.start(
      makeRequest({
        session: { id: '1c84d60d-4280-45f5-b8ae-d03a1c827018', mode: 'resume' },
      }),
    )) {
      if (event.type === 'terminal') break;
    }

    expect(spawnedArgs).toContain('--resume');
    expect(spawnedArgs).not.toContain('--session-id');
    expect(spawnedArgs[spawnedArgs.indexOf('--resume') + 1]).toBe(
      '1c84d60d-4280-45f5-b8ae-d03a1c827018',
    );
  });

  it('injects the cross-kernel catch-up on resume instead of the full system context', async () => {
    const stdinLines: string[] = [];
    const adapter = new ClaudeCodeKernelAdapter({
      spawn: (args, env, cwd) => {
        const handle = fixtureSpawn(args, env, cwd);
        const stdin = handle.child.stdin;
        if (stdin) {
          const originalWrite = stdin.write.bind(stdin);
          const write = vi.spyOn(stdin, 'write');
          write.mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
            stdinLines.push(String(chunk));
            return Reflect.apply(originalWrite, stdin, [chunk, ...rest]);
          }) as typeof stdin.write);
        }
        return handle;
      },
    });
    adapter.onPermissionRequest((request) => {
      setTimeout(() => adapter.respondPermission(request.requestId, { allow: true }), 30);
    });

    for await (const event of adapter.start(
      makeRequest({
        systemContext: '## FULL SYSTEM CONTEXT',
        session: {
          id: '1c84d60d-4280-45f5-b8ae-d03a1c827018',
          mode: 'resume',
          catchUp: '## Cross-kernel session gap\n### User\ngap fact from codex era',
        },
      }),
    )) {
      if (event.type === 'terminal') break;
    }

    const init = stdinLines
      .map((line) => {
        try {
          return JSON.parse(line) as {
            type?: string;
            request?: { subtype?: string; appendSystemPrompt?: string };
          };
        } catch {
          return undefined;
        }
      })
      .find((line) => line?.type === 'control_request' && line.request?.subtype === 'initialize');
    expect(init?.request?.appendSystemPrompt).toContain('## Cross-kernel session gap');
    expect(init?.request?.appendSystemPrompt).toContain('gap fact from codex era');
    expect(init?.request?.appendSystemPrompt).not.toContain('FULL SYSTEM CONTEXT');
  });

  it('keeps local Claude settings available only when reusing the local login', async () => {
    let spawnedArgs: string[] = [];
    const adapter = new ClaudeCodeKernelAdapter({
      spawn: (args, env, cwd) => {
        spawnedArgs = [...args];
        return fixtureSpawn(args, env, cwd);
      },
    });
    adapter.onPermissionRequest((request) => {
      setTimeout(() => adapter.respondPermission(request.requestId, { allow: true }), 30);
    });

    for await (const event of adapter.start(makeRequest())) {
      if (event.type === 'terminal') break;
    }

    expect(spawnedArgs).toContain('--print');
    expect(spawnedArgs).not.toContain('--setting-sources=');
  });

  it('fails immediately when Claude reports a non-retriable authentication error', async () => {
    const adapter = new ClaudeCodeKernelAdapter({ spawn: fixtureSpawn });
    const events: KernelEvent[] = [];

    for await (const event of adapter.start(
      makeRequest({ userText: 'fixture authentication failure' }),
    )) {
      events.push(event);
      if (event.type === 'terminal') break;
    }
    await adapter.stop();

    expect(events.at(-1)).toMatchObject({
      type: 'terminal',
      status: 'failed',
      error: expect.stringContaining('401'),
    });
  });

  it('flushes a terminal JSON object that is not followed by a newline', async () => {
    const adapter = new ClaudeCodeKernelAdapter({
      spawn: fixtureModeSpawn('terminal-without-newline'),
    });
    const events: KernelEvent[] = [];

    for await (const event of adapter.start(makeRequest())) {
      events.push(event);
    }

    expect(events.filter((event) => event.type === 'terminal')).toEqual([
      { type: 'terminal', status: 'completed' },
    ]);
  });

  it('turns a non-zero process exit without a protocol terminal into one redacted failure', async () => {
    const adapter = new ClaudeCodeKernelAdapter({
      spawn: fixtureModeSpawn('exit-without-terminal'),
    });
    const events: KernelEvent[] = [];
    const exits: Array<{ code: number | null; stderrTail: string }> = [];
    adapter.onExit((code, stderrTail) => exits.push({ code, stderrTail }));

    for await (const event of adapter.start(
      makeRequest({
        credential: {
          apiKey: 'sk-ant-fixture-secret-123456789',
          baseUrl: 'http://127.0.0.1:43123/anthropic',
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
      error: expect.stringContaining('Claude Code exited with code 7'),
    });
    expect(JSON.stringify({ terminals, exits })).toContain('[REDACTED]');
    expect(JSON.stringify({ terminals, exits })).not.toContain('sk-ant-fixture-secret-123456789');
    expect(exits).toMatchObject([{ code: 7 }]);
  });

  it('extracts a readable failure from nested Claude result payloads', async () => {
    const adapter = new ClaudeCodeKernelAdapter({
      spawn: fixtureModeSpawn('nested-result-error'),
    });
    const events: KernelEvent[] = [];

    for await (const event of adapter.start(makeRequest())) {
      events.push(event);
    }

    expect(events.filter((event) => event.type === 'terminal')).toEqual([
      {
        type: 'terminal',
        status: 'failed',
        error: 'Nested Claude gateway failure',
      },
    ]);
  });

  it('detectVersion probes the local claude (installed state depends on machine)', async () => {
    const adapter = new ClaudeCodeKernelAdapter();
    const version = await adapter.detectVersion();
    expect(version === null || typeof version === 'string').toBe(true);
  });

  it('registers the platform MCP server via --mcp-config + --strict-mcp-config', async () => {
    const calls: string[][] = [];
    const adapter = new ClaudeCodeKernelAdapter({
      spawn: (args, env, cwd) => {
        calls.push(args);
        return fixtureSpawn(args, env, cwd);
      },
    });
    adapter.onPermissionRequest((request) => {
      setTimeout(() => adapter.respondPermission(request.requestId, { allow: true }), 30);
    });
    const events: KernelEvent[] = [];
    for await (const event of adapter.start(
      makeRequest({
        platformBroker: {
          host: '127.0.0.1',
          port: 49152,
          token: 'tok-cc-1',
          workspaceDir: 'C:/ws',
          command: 'C:/node/node.exe',
          args: ['D:/mcp/platform-mcp-server.mjs'],
        },
      }),
    )) {
      events.push(event);
      if (event.type === 'terminal') break;
    }
    const args = calls[0];
    expect(args).toContain('--mcp-config');
    expect(args).toContain('--strict-mcp-config');
    const configPath = args[args.indexOf('--mcp-config') + 1];
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      mcpServers: Record<string, { env: Record<string, string> }>;
    };
    expect(config.mcpServers['sync-think-platform'].env.ST_BROKER_TOKEN).toBe('tok-cc-1');
    await adapter.stop();
    expect(existsSync(configPath)).toBe(false);
  }, 15_000);

  it('cancel() terminates the kernel process tree and ends the stream', async () => {
    const adapter = new ClaudeCodeKernelAdapter({ spawn: fixtureSpawn });
    const iterator = adapter.start(makeRequest()) as AsyncGenerator<KernelEvent>;
    // Start consuming, then cancel mid-stream.
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
