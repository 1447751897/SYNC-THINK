import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { KernelEvent, KernelRequest } from '@sync-think/shared';
import { startKernelProcess } from './process.js';
import { CodexAppServerKernelAdapter } from './codex-app-server-adapter.js';
import { commandSilenceNotice } from './persistent-terminal-command.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KernelStartupError } from './kernel-diagnostics.js';

const fixturePath = fileURLToPath(
  new URL('./fixtures/codex-app-server-fixture.mjs', import.meta.url),
);

const adapters = new Set<CodexAppServerKernelAdapter>();

afterEach(async () => {
  await Promise.allSettled([...adapters].map((adapter) => adapter.stop()));
  adapters.clear();
});

function createFixtureAdapter(
  spawns: string[][],
  deps: { commandSilenceReminderMs?: number } = {},
): CodexAppServerKernelAdapter {
  const adapter = new CodexAppServerKernelAdapter({
    spawn: (args, env, cwd) => {
      spawns.push(args);
      return startKernelProcess({
        command: process.execPath,
        args: [fixturePath, ...args],
        cwd,
        env,
      });
    },
    commandSilenceReminderMs: deps.commandSilenceReminderMs,
  });
  adapters.add(adapter);
  return adapter;
}

function makeRequest(overrides: Partial<KernelRequest> = {}): KernelRequest {
  return {
    kernelId: 'codex',
    model: 'gpt-5',
    providerModelId: 'gpt-5',
    userText: 'hello fixture',
    contextWindow: 128_000,
    effectiveContextWindow: 128_000,
    contextWindowSource: 'configured',
    credential: { reuseLocalLogin: true },
    systemContext: 'fixture system context',
    platformTools: [],
    permissionMode: 'ask',
    workspaceDir: process.cwd(),
    ...overrides,
  };
}

describe('CodexAppServerKernelAdapter', () => {
  it.each(['spawn', 'initialize'])(
    'reports %s failures as local startup errors with redacted details',
    async (stage) => {
      const secret = 'fixture-startup-secret';
      const adapter = new CodexAppServerKernelAdapter({
        spawn: (_args, env, cwd) => {
          if (stage === 'spawn') throw new Error('invalid launch arguments ' + secret);
          return startKernelProcess({
            command: process.execPath,
            args: ['-e', 'console.error("invalid local config ' + secret + '");process.exit(23)'],
            cwd,
            env,
          });
        },
      });
      adapters.add(adapter);
      const run = async () => {
        for await (const _event of adapter.start(makeRequest({ credential: { apiKey: secret } }))) {
        }
      };
      const error = await run().catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(KernelStartupError);
      expect(error).toMatchObject({ failureClass: 'protocol' });
      expect((error as Error).message).toContain('Codex 本地内核启动失败：');
      expect((error as Error).message).toContain('[REDACTED]');
      expect((error as Error).message).not.toContain(secret);
    },
  );

  it.skipIf(process.platform !== 'win32')(
    'loads the editing catalog through a real .cmd launcher with spaces and Unicode paths',
    async () => {
      const directory = mkdtempSync(join(tmpdir(), 'sync-think codex 中文 '));
      const shim = join(directory, 'codex.cmd');
      // The wrapper has the same argv forwarding as the managed npm installation.
      writeFileSync(shim, '@"' + process.execPath + '" "' + fixturePath + '" %*\r\n');
      const spawns: string[][] = [];
      const adapter = new CodexAppServerKernelAdapter({
        spawn: (args, env, cwd) => {
          spawns.push(args);
          return startKernelProcess({ command: shim, args, env, cwd });
        },
      });
      adapters.add(adapter);
      vi.stubEnv('TEMP', directory);
      vi.stubEnv('TMP', directory);
      try {
        const events: KernelEvent[] = [];
        for await (const event of adapter.start(
          makeRequest({
            model: 'host-model',
            providerModelId: 'deepseek-flash',
            credential: { apiKey: 'fixture', baseUrl: 'http://127.0.0.1/v1' },
            userText: 'editing config fixture',
          }),
        ))
          events.push(event);
        expect(events).toContainEqual({ type: 'terminal', status: 'completed' });
        const value = JSON.parse(
          events
            .filter(
              (event): event is Extract<KernelEvent, { type: 'delta' }> => event.type === 'delta',
            )
            .map((event) => event.text)
            .join(''),
        );
        expect(value.catalogPath).toContain('sync-think codex 中文 ');
        expect(value.catalog.models[0]).toMatchObject({
          slug: 'deepseek-flash',
          apply_patch_tool_type: 'freeform',
        });
        expect(spawns).toHaveLength(2);
      } finally {
        await adapter.stop();
        vi.unstubAllEnvs();
        rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    },
  );

  it.each(['failed', 'declined', 'completed'])(
    'preserves command item identity and %s outcome without an exit code',
    async (status) => {
      const adapter = createFixtureAdapter([]);
      const permissions: Array<{ requestId: string; toolId?: string }> = [];
      adapter.onPermissionRequest((permission) => {
        permissions.push(permission);
        adapter.respondPermission(permission.requestId, { allow: false });
      });
      const events: KernelEvent[] = [];
      for await (const event of adapter.start(
        makeRequest({ userText: 'command outcome fixture:' + status }),
      ))
        events.push(event);
      expect(permissions).toContainEqual(
        expect.objectContaining({ requestId: 'permission-command', toolId: 'command-outcome' }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'tool-result',
          toolId: 'command-outcome',
          isError: status !== 'completed',
        }),
      );
    },
  );

  it.each([true, false])(
    'keeps native plan tools available on create and resume (localLogin=%s)',
    async (localLogin) => {
      const adapter = createFixtureAdapter([]);
      const credential = localLogin
        ? { reuseLocalLogin: true }
        : { baseUrl: 'http://127.0.0.1:12345/v1', apiKey: 'fixture-only-key' };
      for (const session of [
        { mode: 'create' as const },
        { mode: 'resume' as const, id: 'thread-app-fixture' },
      ]) {
        const events: KernelEvent[] = [];
        for await (const event of adapter.start(
          makeRequest({ userText: 'native plan availability fixture', credential, session }),
        ))
          events.push(event);
        expect(events).toContainEqual({ type: 'terminal', status: 'completed' });
        const content = events
          .filter(
            (event): event is Extract<KernelEvent, { type: 'delta' }> => event.type === 'delta',
          )
          .map((event) => event.text)
          .join('');
        expect(JSON.parse(content)).toEqual({ planEnabled: true });
      }
    },
  );

  it('lets app-server choose its configured model for the codex-default sentinel', async () => {
    const adapter = createFixtureAdapter([]);
    const events: KernelEvent[] = [];

    for await (const event of adapter.start(
      makeRequest({ model: 'codex-default', providerModelId: '' }),
    )) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: 'terminal', status: 'completed' });
  });

  it('reuses one app-server process for consecutive turns on the same thread', async () => {
    const spawns: string[][] = [];
    const adapter = createFixtureAdapter(spawns);

    const first: KernelEvent[] = [];
    for await (const event of adapter.start(makeRequest())) first.push(event);
    const second: KernelEvent[] = [];
    for await (const event of adapter.start(
      makeRequest({
        userText: 'second turn',
        session: { id: 'thread-app-fixture', mode: 'resume' },
      }),
    )) {
      second.push(event);
    }

    expect(spawns).toHaveLength(1);
    expect(first).toContainEqual({ type: 'session-started', sessionId: 'thread-app-fixture' });
    // agentMessage stays unclassified (no `final` flag): mid-turn messages
    // are classified at a tool or terminal boundary, while the host streams
    // the tokens as a provisional answer.
    expect(first).toContainEqual({ type: 'delta', text: 'answer 1' });
    expect(second).toContainEqual({ type: 'delta', text: 'answer 2' });
    expect(second).toContainEqual({ type: 'terminal', status: 'completed' });
  });

  it('restarts app-server when the per-run platform broker changes', async () => {
    const spawns: string[][] = [];
    const adapter = createFixtureAdapter(spawns);
    const broker = (port: number, token: string): NonNullable<KernelRequest['platformBroker']> => ({
      host: '127.0.0.1',
      port,
      token,
      workspaceDir: process.cwd(),
      command: process.execPath,
      args: ['platform-mcp-server.mjs'],
    });

    for await (const _event of adapter.start(
      makeRequest({ platformBroker: broker(41_001, 'broker-turn-1') }),
    )) {
      void _event;
      // Consume the first turn so the resident process is eligible for reuse.
    }
    const resumed: KernelEvent[] = [];
    for await (const event of adapter.start(
      makeRequest({
        userText: 'second broker turn',
        platformBroker: broker(41_002, 'broker-turn-2'),
        session: { id: 'thread-app-fixture', mode: 'resume' },
      }),
    )) {
      resumed.push(event);
    }

    // A Codex app-server process owns the stdio MCP child it started. Reusing
    // it with a new ephemeral broker leaves that child connected to the dead
    // previous socket, which used to make every later tool call wait 90s.
    expect(spawns).toHaveLength(2);
    expect(resumed).toContainEqual({ type: 'session-started', sessionId: 'thread-app-fixture' });
    expect(resumed).toContainEqual({ type: 'terminal', status: 'completed' });
  });

  it('enables Codex live search only for native-search routes', async () => {
    const native = createFixtureAdapter([]);
    const nativeEvents: KernelEvent[] = [];
    for await (const event of native.start(
      makeRequest({ userText: 'web search fixture', webSearchMode: 'native' }),
    )) {
      nativeEvents.push(event);
    }
    expect(nativeEvents).toContainEqual({
      type: 'delta',
      text: JSON.stringify({ webSearch: 'live' }),
    });

    const fallback = createFixtureAdapter([]);
    const fallbackEvents: KernelEvent[] = [];
    for await (const event of fallback.start(
      makeRequest({ userText: 'web search fixture', webSearchMode: 'external' }),
    )) {
      fallbackEvents.push(event);
    }
    expect(fallbackEvents).toContainEqual({
      type: 'delta',
      text: JSON.stringify({ webSearch: 'disabled' }),
    });
  });

  it('maps completed reasoning items from body, summary and content parts', async () => {
    const adapter = createFixtureAdapter([]);
    const events: KernelEvent[] = [];
    for await (const event of adapter.start(makeRequest({ userText: 'reasoning fixture' }))) {
      events.push(event);
    }

    const reasoning = events.filter((event) => event.type === 'reasoning');
    // 全文优先于摘要：只读 summary 会把「详细思考」降级成一行标题。
    // 不同 reasoning item 之间必须有段落分隔——它们是独立的思考段，
    // 直接拼接会把 `**标题A**` 和 `**标题B**` 融成一行。
    expect(reasoning).toEqual([
      { type: 'reasoning', text: '完整正文' },
      { type: 'reasoning', text: '\n\n', boundary: true },
      { type: 'reasoning', text: '只有摘要' },
      { type: 'reasoning', text: '\n\n', boundary: true },
      { type: 'reasoning', text: '内容部件正文' },
    ]);
  });

  it('separates streamed reasoning summary indexes and items with paragraph breaks', async () => {
    const adapter = createFixtureAdapter([]);
    const events: KernelEvent[] = [];
    for await (const event of adapter.start(
      makeRequest({ userText: 'streamed reasoning fixture' }),
    )) {
      events.push(event);
    }

    const reasoning = events
      .filter((event): event is Extract<KernelEvent, { type: 'reasoning' }> => {
        return event.type === 'reasoning';
      })
      .map((event) => event.text);
    // Current app-server builds can advance summaryIndex without emitting a
    // summaryPartAdded notification. Both that boundary and a new reasoning
    // item must remain visible in the host's single thinking flow.
    expect(reasoning.join('')).toBe('**分析**正文A\n\n**验证**\n\n**新思考**');
    expect(events.filter((event) => event.type === 'reasoning' && event.boundary)).toHaveLength(2);
  });

  it('keeps the raw reasoning stream disabled for the Codex-style Think view', async () => {
    const adapter = createFixtureAdapter([]);
    const events: KernelEvent[] = [];
    for await (const event of adapter.start(makeRequest({ userText: 'raw reasoning fixture' }))) {
      events.push(event);
    }

    expect(events.filter((event) => event.type === 'reasoning')).toEqual([]);
  });

  it('terminates an active iterator when the app-server is stopped', async () => {
    const adapter = createFixtureAdapter([]);
    const events: KernelEvent[] = [];
    const consume = (async () => {
      for await (const event of adapter.start(makeRequest({ userText: 'hang fixture' }))) {
        events.push(event);
      }
    })();

    while (!events.some((event) => event.type === 'delta')) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await adapter.stop();
    await consume;

    expect(events).toContainEqual({ type: 'delta', text: 'answer 1' });
    expect(events).toContainEqual({
      type: 'terminal',
      status: 'failed',
      error: 'Codex app-server stopped',
    });
  });

  it('forwards staged attachments as official app-server localImage inputs', async () => {
    const adapter = createFixtureAdapter([]);
    const events: KernelEvent[] = [];
    for await (const event of adapter.start(
      makeRequest({
        userText: '看图',
        images: [
          {
            name: 'shot.png',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,QUJDRA==',
            filePath: fixturePath,
          },
        ] as unknown as KernelRequest['images'],
      }),
    )) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: 'delta', text: 'local image forwarded' });
    expect(events).toContainEqual({ type: 'terminal', status: 'completed' });
  });

  it('keeps inline image input as a fallback when no local path is available', async () => {
    const adapter = createFixtureAdapter([]);
    const events: KernelEvent[] = [];
    for await (const event of adapter.start(
      makeRequest({
        userText: 'inline image',
        images: [
          {
            name: 'shot.png',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,QUJDRA==',
          },
        ],
      }),
    )) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: 'delta', text: 'inline image forwarded' });
  });

  it('drops images whose data URL is not a data:image payload', async () => {
    const adapter = createFixtureAdapter([]);
    const events: KernelEvent[] = [];
    for await (const event of adapter.start(
      makeRequest({
        userText: '看图',
        images: [{ name: 'x.png', mimeType: 'image/png', dataUrl: 'sync-think-image://media/x' }],
      }),
    )) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: 'delta', text: 'answer 1' });
  });

  it('passes full access to both the Codex thread and turn policies', async () => {
    const adapter = createFixtureAdapter([]);
    const events: KernelEvent[] = [];
    for await (const event of adapter.start(
      makeRequest({ userText: 'permission fixture', permissionMode: 'full-access' }),
    )) {
      events.push(event);
    }

    expect(events).toContainEqual({
      type: 'delta',
      text: JSON.stringify({
        threadApprovalPolicy: 'never',
        threadSandboxPolicy: { type: 'dangerFullAccess' },
        turnApprovalPolicy: 'never',
        turnSandboxPolicy: { type: 'dangerFullAccess' },
      }),
    });
  });

  it('resolves the host auto sentinel to an explicit effort and maps off to none', async () => {
    const automatic = createFixtureAdapter([]);
    const automaticEvents: KernelEvent[] = [];
    for await (const event of automatic.start(
      makeRequest({ userText: 'effort fixture', reasoningEffort: 'auto' }),
    )) {
      automaticEvents.push(event);
    }
    // 'auto' must not fall through to `null`: the app-server would then read the
    // user's global ~/.codex/config.toml effort (tuned for another vendor).
    expect(automaticEvents).toContainEqual({
      type: 'delta',
      text: JSON.stringify({ hasEffort: true, effort: 'medium' }),
    });

    const disabled = createFixtureAdapter([]);
    const disabledEvents: KernelEvent[] = [];
    for await (const event of disabled.start(
      makeRequest({ userText: 'effort fixture', reasoningEffort: 'off' }),
    )) {
      disabledEvents.push(event);
    }
    expect(disabledEvents).toContainEqual({
      type: 'delta',
      text: JSON.stringify({ hasEffort: true, effort: 'none' }),
    });
  });

  it('uses Codex native collaboration modes and explicitly resets plan mode', async () => {
    const adapter = createFixtureAdapter([]);
    const planned: KernelEvent[] = [];
    for await (const event of adapter.start(
      makeRequest({
        userText: 'collaboration fixture',
        planningMode: true,
        reasoningEffort: 'high',
      }),
    )) {
      planned.push(event);
    }
    expect(planned).toContainEqual({
      type: 'delta',
      text: JSON.stringify({
        mode: 'plan',
        settings: {
          model: 'gpt-5',
          reasoning_effort: 'high',
          developer_instructions: null,
        },
      }),
    });

    const executed: KernelEvent[] = [];
    for await (const event of adapter.start(
      makeRequest({
        userText: 'collaboration fixture',
        session: { id: 'thread-app-fixture', mode: 'resume' },
      }),
    )) {
      executed.push(event);
    }
    expect(executed).toContainEqual({
      type: 'delta',
      text: JSON.stringify({
        mode: 'default',
        settings: {
          model: 'gpt-5',
          // No host effort ⇒ the adapter sends its own explicit default instead of
          // `null`, which would let the app-server read the user's global config.
          reasoning_effort: 'medium',
          developer_instructions: null,
        },
      }),
    });
  });

  it('maps the canonical native plan item to a shared plan submission event', async () => {
    const adapter = createFixtureAdapter([]);
    const events: KernelEvent[] = [];
    for await (const event of adapter.start(
      makeRequest({ userText: 'native plan fixture', planningMode: true }),
    )) {
      events.push(event);
    }
    expect(events).toContainEqual({
      type: 'plan-submitted',
      text: '# 原生方案\n\n1. 读取\n2. 验证',
    });
    expect(events).not.toContainEqual({ type: 'delta', text: '非规范增量' });
  });

  it('maps contextCompaction items to one real lifecycle', async () => {
    const adapter = createFixtureAdapter([]);
    const events: KernelEvent[] = [];
    for await (const event of adapter.start(
      makeRequest({ userText: 'compaction lifecycle fixture' }),
    )) {
      events.push(event);
    }
    expect(events.filter((event) => event.type === 'compaction-started')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'compacted')).toHaveLength(1);
  });

  it('reports a failed native compaction before the turn failure', async () => {
    const adapter = createFixtureAdapter([]);
    const events: KernelEvent[] = [];
    for await (const event of adapter.start(
      makeRequest({ userText: 'compaction failure fixture' }),
    )) {
      events.push(event);
    }
    expect(events).toContainEqual({ type: 'compaction-started' });
    expect(events).toContainEqual({
      type: 'compaction-failed',
      error: 'context compaction failed',
    });
    expect(events).toContainEqual({
      type: 'terminal',
      status: 'failed',
      error: 'context compaction failed',
    });
  });

  it('maps thread token usage into kernel occupancy', async () => {
    const adapter = createFixtureAdapter([]);
    const events: KernelEvent[] = [];
    for await (const event of adapter.start(makeRequest({ userText: 'token usage fixture' }))) {
      events.push(event);
    }
    expect(events).toContainEqual({
      type: 'context-occupancy',
      usedTokens: 42_000,
      windowTokens: 272_000,
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'usage',
        usage: expect.objectContaining({
          input: 42_000,
          cached: 38_000,
          window: 272_000,
        }),
      }),
    );
  });

  it.each([false, true])(
    'maps Codex turn plan notifications to the shared task checklist tool (detailed=%s)',
    async (detailed) => {
      const adapter = createFixtureAdapter([]);
      const events: KernelEvent[] = [];
      for await (const event of adapter.start(
        makeRequest({ userText: detailed ? 'detailed plan fixture' : 'plan fixture' }),
      )) {
        events.push(event);
      }

      const planCall = events.find(
        (event): event is Extract<KernelEvent, { type: 'tool-call' }> =>
          event.type === 'tool-call' && event.name === 'update_plan',
      );
      expect(planCall).toBeTruthy();
      expect(JSON.parse(planCall!.argsJson)).toEqual({
        items: [
          { title: '读取 package.json', status: 'completed' },
          {
            title: '运行 typecheck',
            ...(detailed
              ? { description: '检查 runtime 与 desktop 的类型错误\n记录失败文件' }
              : {}),
            status: 'in_progress',
          },
          { title: '汇总结果', status: 'pending' },
        ],
      });
      expect(events).toContainEqual({
        type: 'tool-result',
        toolId: planCall!.toolId,
        output: JSON.stringify({
          ok: true,
          plan: {
            items: [
              { title: '读取 package.json', status: 'completed' },
              {
                title: '运行 typecheck',
                ...(detailed
                  ? { description: '检查 runtime 与 desktop 的类型错误\n记录失败文件' }
                  : {}),
                status: 'in_progress',
              },
              { title: '汇总结果', status: 'pending' },
            ],
            completed: 1,
            total: 3,
          },
        }),
        isError: false,
      });
    },
  );

  it('maps native fileChange items to file_change tool events with paths', async () => {
    const adapter = createFixtureAdapter([]);
    const events: KernelEvent[] = [];
    for await (const event of adapter.start(makeRequest({ userText: 'file change fixture' }))) {
      events.push(event);
    }

    const started = events.find(
      (event): event is Extract<KernelEvent, { type: 'tool-call' }> =>
        event.type === 'tool-call' && event.name === 'file_change',
    );
    expect(started).toBeTruthy();
    expect(JSON.parse(started!.argsJson)).toEqual({
      changes: [
        { path: 'README.md', kind: 'update', diff: '-old\n+new' },
        { path: 'codex-edit-test.txt', kind: 'add', diff: '+hello' },
      ],
    });
    expect(events).toContainEqual({
      type: 'tool-result',
      toolId: started!.toolId,
      output: JSON.stringify({
        ok: true,
        status: 'completed',
        changes: [
          { path: 'README.md', kind: 'update', diff: '-old\n+new' },
          { path: 'codex-edit-test.txt', kind: 'add', diff: '+hello' },
        ],
      }),
      isError: false,
    });
  });

  it('maps completed-only snake_case file_change maps to file_change paths', async () => {
    const adapter = createFixtureAdapter([]);
    const events: KernelEvent[] = [];
    for await (const event of adapter.start(makeRequest({ userText: 'file change map fixture' }))) {
      events.push(event);
    }

    const calls = events.filter(
      (event): event is Extract<KernelEvent, { type: 'tool-call' }> =>
        event.type === 'tool-call' && event.name === 'file_change',
    );
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(calls.at(-1)!.argsJson).changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'codex-edit-test.txt', kind: 'delete' }),
        expect.objectContaining({ path: 'codex-edit-test-2.txt', kind: 'add' }),
      ]),
    );
    const result = events.find(
      (event) =>
        event.type === 'tool-result' &&
        event.toolId === 'exec-6422071b-c6ec-40b1-bd23-24f0e5cedc6d',
    );
    expect(result).toMatchObject({
      type: 'tool-result',
      isError: false,
    });
    expect(JSON.parse((result as { output: string }).output).changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'codex-edit-test.txt', kind: 'delete' }),
        expect.objectContaining({ path: 'codex-edit-test-2.txt', kind: 'add' }),
      ]),
    );
  });

  it('forwards command outputDelta as live tool progress before the result', async () => {
    const adapter = createFixtureAdapter([]);
    const events: KernelEvent[] = [];
    for await (const event of adapter.start(makeRequest({ userText: 'progress fixture' }))) {
      events.push(event);
    }

    const startedIndex = events.findIndex(
      (event) => event.type === 'tool-call' && event.toolId === 'cmd-progress',
    );
    const progressIndex = events.findIndex((event) => event.type === 'tool-progress');
    const resultIndex = events.findIndex(
      (event) => event.type === 'tool-result' && event.toolId === 'cmd-progress',
    );
    expect(startedIndex).toBeGreaterThanOrEqual(0);
    expect(progressIndex).toBeGreaterThan(startedIndex);
    expect(resultIndex).toBeGreaterThan(progressIndex);
    expect(events[progressIndex]).toMatchObject({
      type: 'tool-progress',
      toolId: 'cmd-progress',
      output: 'progress line 1\n',
    });
  });

  it('keeps a silent server item running until explicit cancellation', async () => {
    const adapter = createFixtureAdapter([], { commandSilenceReminderMs: 40 });
    const events: KernelEvent[] = [];
    const consume = (async () => {
      for await (const event of adapter.start(
        makeRequest({ userText: 'command hang fixture:persistent' }),
      )) {
        events.push(event);
      }
    })();
    await vi.waitFor(
      () => {
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'tool-progress',
            toolId: 'cmd-hang',
            output: commandSilenceNotice(),
          }),
        );
      },
      { timeout: 1_000 },
    );
    expect(events.some((event) => event.type === 'terminal' && event.status === 'failed')).toBe(
      false,
    );
    expect(
      events.some(
        (event) => event.type === 'tool-result' && event.toolId === 'cmd-hang' && event.isError,
      ),
    ).toBe(false);
    await adapter.cancel();
    await consume;
  });

  it.each(['Start-Sleep -Seconds 180', 'pnpm build', 'node custom-worker.js'])(
    'lets a silent command finish after the reminder: %s',
    async (command) => {
      const adapter = createFixtureAdapter([], { commandSilenceReminderMs: 40 });
      const events: KernelEvent[] = [];
      for await (const event of adapter.start(
        makeRequest({ userText: 'command silence fixture:' + command }),
      ))
        events.push(event);
      expect(events).toContainEqual({ type: 'terminal', status: 'completed' });
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'tool-result',
          toolId: 'cmd-silent',
          isError: false,
        }),
      );
      expect(events.some((event) => event.type === 'tool-result' && event.isError)).toBe(false);
      expect(events.filter((event) => event.type === 'tool-progress')).toHaveLength(1);
      const call = events.find(
        (event) => event.type === 'tool-call' && event.toolId === 'cmd-silent',
      );
      expect(call?.type === 'tool-call' && JSON.parse(call.argsJson)).toMatchObject({
        command,
        description: '执行静默命令并等待完成',
        processId: 'process-silent',
        source: 'unifiedExecStartup',
      });
    },
  );

  it('keeps an unrecognized silent command running until explicit cancellation', async () => {
    const adapter = createFixtureAdapter([], { commandSilenceReminderMs: 40 });
    const events: KernelEvent[] = [];
    const consume = (async () => {
      for await (const event of adapter.start(
        makeRequest({ userText: 'command hang fixture:short' }),
      ))
        events.push(event);
    })();
    try {
      await vi.waitFor(() =>
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'tool-progress',
            toolId: 'cmd-hang',
          }),
        ),
      );
      expect(events.some((event) => event.type === 'terminal')).toBe(false);
      expect(events.some((event) => event.type === 'tool-result')).toBe(false);
    } finally {
      await adapter.cancel();
      await consume;
    }
  });
});

describe('Codex editing capabilities and native instruction preservation', () => {
  it.each([true, false])(
    'preserves native base instructions on create and resume (local=%s)',
    async (local) => {
      const adapter = createFixtureAdapter([]);
      for (const session of [
        { mode: 'create' as const },
        { mode: 'resume' as const, id: 'thread-app-fixture' },
      ]) {
        const events: KernelEvent[] = [];
        for await (const event of adapter.start(
          makeRequest({
            userText: 'editing config fixture',
            session,
            credential: local
              ? { reuseLocalLogin: true }
              : { apiKey: 'fixture', baseUrl: 'http://127.0.0.1/v1' },
          }),
        ))
          events.push(event);
        const value = JSON.parse(
          events
            .filter((e): e is Extract<KernelEvent, { type: 'delta' }> => e.type === 'delta')
            .map((e) => e.text)
            .join(''),
        );
        expect(value).toMatchObject({
          model: 'gpt-5',
          developerInstructions: 'fixture system context',
        });
        expect(value.baseInstructions).toBeUndefined();
        expect(value.catalog).toBeUndefined();
      }
    },
  );
  it('enables native apply_patch for unknown provider models and cleans its isolated catalog', async () => {
    const { existsSync } = await import('node:fs');
    const spawns: string[][] = [];
    const adapter = createFixtureAdapter(spawns);
    const paths: string[] = [];
    for (const session of [
      { mode: 'create' as const },
      { mode: 'resume' as const, id: 'thread-app-fixture' },
    ]) {
      const events: KernelEvent[] = [];
      for await (const event of adapter.start(
        makeRequest({
          model: 'host-model-id',
          providerModelId: 'deepseek-flash',
          userText: 'editing config fixture',
          session,
          credential: { apiKey: 'fixture', baseUrl: 'http://127.0.0.1/v1' },
        }),
      ))
        events.push(event);
      const value = JSON.parse(
        events
          .filter((e): e is Extract<KernelEvent, { type: 'delta' }> => e.type === 'delta')
          .map((e) => e.text)
          .join(''),
      );
      expect(value.model).toBe('deepseek-flash');
      expect(value.catalog.models[0]).toMatchObject({
        slug: 'deepseek-flash',
        apply_patch_tool_type: 'freeform',
        context_window: 128000,
      });
      expect(value.catalog.models[0].base_instructions).toContain('apply_patch');
      expect(value.developerInstructions).toBe('fixture system context');
      if (session.mode === 'resume')
        expect(value.baseInstructions).toBe(value.catalog.models[0].base_instructions);
      else expect(value.baseInstructions).toBeUndefined();
      expect(existsSync(value.catalogPath)).toBe(true);
      paths.push(value.catalogPath);
    }
    expect(spawns).toHaveLength(2); // native metadata discovery, then configured app-server
    expect(paths[0]).toBe(paths[1]);
    await adapter.stop();
    expect(existsSync(paths[0])).toBe(false);
  });
});
