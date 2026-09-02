import { afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { KernelEvent, KernelRequest } from '@sync-think/shared';
import { startKernelProcess } from './process.js';
import { CodexAppServerKernelAdapter } from './codex-app-server-adapter.js';

const fixturePath = fileURLToPath(
  new URL('./fixtures/codex-app-server-fixture.mjs', import.meta.url),
);

const adapters = new Set<CodexAppServerKernelAdapter>();

afterEach(async () => {
  await Promise.allSettled([...adapters].map((adapter) => adapter.stop()));
  adapters.clear();
});

function createFixtureAdapter(spawns: string[][]): CodexAppServerKernelAdapter {
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

  it('omits the host auto reasoning sentinel and maps off to the app-server none value', async () => {
    const automatic = createFixtureAdapter([]);
    const automaticEvents: KernelEvent[] = [];
    for await (const event of automatic.start(
      makeRequest({ userText: 'effort fixture', reasoningEffort: 'auto' }),
    )) {
      automaticEvents.push(event);
    }
    expect(automaticEvents).toContainEqual({
      type: 'delta',
      text: JSON.stringify({ hasEffort: false }),
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
          reasoning_effort: null,
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

  it('maps Codex turn plan notifications to the shared task checklist tool', async () => {
    const adapter = createFixtureAdapter([]);
    const events: KernelEvent[] = [];
    for await (const event of adapter.start(makeRequest({ userText: 'plan fixture' }))) {
      events.push(event);
    }

    const planCall = events.find(
      (event): event is Extract<KernelEvent, { type: 'tool-call' }> =>
        event.type === 'tool-call' && event.name === 'update_task_plan',
    );
    expect(planCall).toBeTruthy();
    expect(JSON.parse(planCall!.argsJson)).toEqual({
      items: [
        { title: '读取 package.json', status: 'completed' },
        { title: '运行 typecheck', status: 'in_progress' },
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
            { title: '运行 typecheck', status: 'in_progress' },
            { title: '汇总结果', status: 'pending' },
          ],
          completed: 1,
          total: 3,
        },
      }),
      isError: false,
    });
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
});
