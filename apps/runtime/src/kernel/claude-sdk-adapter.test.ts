/**
 * Claude SDK adapter tests.
 *
 * The CLI-era suite spawned a fake `claude` process and asserted on argv +
 * stdin frames. With the SDK the equivalent seam is the `query` call: tests
 * assert on the resolved `Options` (what the host asked the kernel to do) and
 * drive a scripted `SDKMessage` sequence (what the kernel answered). No child
 * process is involved, so the fixture binaries are gone.
 */
import { describe, expect, it } from 'vitest';
import type {
  CanUseTool,
  Options,
  PermissionResult,
  Query,
  SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { KernelEvent, KernelPermissionRequest, KernelRequest } from '@sync-think/shared';
import { ClaudeSdkKernelAdapter, stripAnthropicV1Suffix } from './claude-sdk-adapter.js';

/** Captured invocation of the SDK entry point. */
interface QueryCapture {
  options: Options;
  prompt: unknown;
}

/**
 * Build a fake `query` that replays a scripted message sequence.
 *
 * `script` may yield SDKMessages directly, or call the captured `canUseTool`
 * to exercise the permission bridge exactly the way the real SDK does.
 */
function fakeQuery(
  script: (ctx: {
    canUseTool: CanUseTool;
    options: Options;
    signal: AbortSignal;
  }) => AsyncIterable<SDKMessage>,
  capture?: QueryCapture[],
  controls?: Pick<Partial<Query>, 'getContextUsage'>,
) {
  return ((params: { prompt: unknown; options?: Options }) => {
    const options = params.options ?? {};
    capture?.push({ options, prompt: params.prompt });
    const signal = options.abortController?.signal ?? new AbortController().signal;
    const iterator = script({
      canUseTool: options.canUseTool!,
      options,
      signal,
    })[Symbol.asyncIterator]();

    const handle: Partial<Query> = {
      next: () => iterator.next(),
      return: (value?: unknown) =>
        iterator.return?.(value) ?? Promise.resolve({ done: true, value: undefined }),
      throw: (error?: unknown) => iterator.throw?.(error) ?? Promise.reject(error),
      [Symbol.asyncIterator]() {
        return this as AsyncGenerator<SDKMessage, void>;
      },
      interrupt: async () => undefined,
      close: () => undefined,
      getContextUsage:
        controls?.getContextUsage ??
        (async () => {
          throw new Error('getContextUsage unavailable');
        }),
    };
    return handle as Query;
  }) as never;
}

function makeRequest(overrides: Partial<KernelRequest> = {}): KernelRequest {
  return {
    kernelId: 'claude-code',
    model: 'claude-sonnet-4-5',
    providerModelId: 'claude-sonnet-4-5',
    userText: 'hello sdk',
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

const assistantWithToolUse = (): SDKMessage =>
  ({
    type: 'assistant',
    parent_tool_use_id: null,
    uuid: 'uuid-1',
    session_id: 'sdk-session-1',
    message: {
      id: 'msg_fixture_1',
      model: 'claude-sonnet-4-5',
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_1', name: 'fixture_tool', input: { arg: 'value' } }],
      usage: {
        input_tokens: 10,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 50,
        output_tokens: 5,
      },
    },
  }) as unknown as SDKMessage;

const textDelta = (text: string): SDKMessage =>
  ({
    type: 'stream_event',
    parent_tool_use_id: null,
    uuid: 'uuid-delta',
    session_id: 'sdk-session-1',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text } },
  }) as unknown as SDKMessage;

const systemInit = (sessionId = 'sdk-session-1'): SDKMessage =>
  ({
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    uuid: 'uuid-init',
  }) as unknown as SDKMessage;

const resultSuccess = (overrides: Record<string, unknown> = {}): SDKMessage =>
  ({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'done',
    uuid: 'uuid-result',
    session_id: 'sdk-session-1',
    ...overrides,
  }) as unknown as SDKMessage;

const usageMessageStart = (): SDKMessage =>
  ({
    type: 'stream_event',
    parent_tool_use_id: null,
    uuid: 'uuid-message-start',
    session_id: 'sdk-session-1',
    event: {
      type: 'message_start',
      message: {
        id: 'msg_fixture_1',
        model: 'claude-sonnet-4-5',
        usage: {
          input_tokens: 10,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 50,
          output_tokens: 0,
        },
      },
    },
  }) as unknown as SDKMessage;

const usageMessageDelta = (): SDKMessage =>
  ({
    type: 'stream_event',
    parent_tool_use_id: null,
    uuid: 'uuid-message-delta',
    session_id: 'sdk-session-1',
    event: {
      type: 'message_delta',
      usage: { output_tokens: 7 },
    },
  }) as unknown as SDKMessage;

const usageMessageStop = (): SDKMessage =>
  ({
    type: 'stream_event',
    parent_tool_use_id: null,
    uuid: 'uuid-message-stop',
    session_id: 'sdk-session-1',
    event: { type: 'message_stop' },
  }) as unknown as SDKMessage;

/** Drive the adapter to completion, auto-approving any permission request. */
async function collect(
  adapter: ClaudeSdkKernelAdapter,
  request: KernelRequest = makeRequest(),
  options: { autoApprove?: boolean } = {},
) {
  const events: KernelEvent[] = [];
  const permissions: KernelPermissionRequest[] = [];
  adapter.onPermissionRequest((permission) => {
    permissions.push(permission);
    if (options.autoApprove !== false) {
      setTimeout(() => adapter.respondPermission(permission.requestId, { allow: true }), 5);
    }
  });
  for await (const event of adapter.start(request)) {
    events.push(event);
    if (event.type === 'terminal') break;
  }
  return { events, permissions };
}

describe('ClaudeSdkKernelAdapter', () => {
  it('translates assistant text, tool calls and usage into KernelEvents', async () => {
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* () {
        yield systemInit();
        yield textDelta('fixture assistant text');
        yield assistantWithToolUse();
        yield resultSuccess();
      }),
    });

    const { events } = await collect(adapter);

    expect(events.find((event) => event.type === 'delta')).toMatchObject({
      type: 'delta',
      text: 'fixture assistant text',
    });
    expect(events.find((event) => event.type === 'tool-call')).toMatchObject({
      type: 'tool-call',
      name: 'fixture_tool',
      toolId: 'toolu_1',
      partial: false,
      argsJson: '{"arg":"value"}',
    });
    expect(events.find((event) => event.type === 'usage')).toMatchObject({
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
    expect(events.at(-1)).toMatchObject({ type: 'terminal', status: 'completed' });
  });

  it('waits for the completed raw message usage and preserves Claude cache reads', async () => {
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* () {
        yield usageMessageStart();
        yield assistantWithToolUse();
        yield usageMessageDelta();
        yield usageMessageStop();
        yield resultSuccess();
      }),
    });

    const { events } = await collect(adapter);
    const usageEvents = events.filter((event) => event.type === 'usage');

    expect(usageEvents).toEqual([
      {
        type: 'usage',
        usage: {
          real: 167,
          window: 200_000,
          input: 160,
          output: 7,
          cached: 50,
          cachedTokensCreated: 100,
          requestId: 'msg_fixture_1',
          providerResponseId: 'msg_fixture_1',
          modelId: 'claude-sonnet-4-5',
        },
      },
    ]);
  });

  it('falls back to result modelUsage when raw usage events are unavailable', async () => {
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* () {
        yield resultSuccess({
          modelUsage: {
            'claude-sonnet-4-5': {
              inputTokens: 12,
              outputTokens: 8,
              cacheReadInputTokens: 70,
              cacheCreationInputTokens: 5,
              contextWindow: 200_000,
            },
          },
        });
      }),
    });

    const { events } = await collect(adapter);
    expect(events.find((event) => event.type === 'usage')).toEqual({
      type: 'usage',
      usage: {
        real: 95,
        window: 200_000,
        input: 87,
        output: 8,
        cached: 70,
        cachedTokensCreated: 5,
        requestId: 'uuid-result:claude-sonnet-4-5',
        providerResponseId: 'uuid-result',
        modelId: 'claude-sonnet-4-5',
        kernelWindow: 200_000,
      },
    });
  });

  it('reports the Claude session from system/init', async () => {
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* () {
        yield systemInit('fixture-session-1');
        yield resultSuccess();
      }),
    });
    const { events } = await collect(adapter);
    expect(events).toContainEqual({ type: 'session-started', sessionId: 'fixture-session-1' });
  });

  it('suppresses the whole-message text echo once deltas streamed', async () => {
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* () {
        yield textDelta('streamed once');
        yield {
          type: 'assistant',
          parent_tool_use_id: null,
          uuid: 'u',
          session_id: 's',
          message: {
            id: 'msg_1',
            role: 'assistant',
            content: [{ type: 'text', text: 'streamed once' }],
          },
        } as unknown as SDKMessage;
        yield resultSuccess();
      }),
    });
    const { events } = await collect(adapter);
    expect(events.filter((event) => event.type === 'delta')).toHaveLength(1);
  });

  it('emits the whole-message text when no deltas streamed', async () => {
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* () {
        yield {
          type: 'assistant',
          parent_tool_use_id: null,
          uuid: 'u',
          session_id: 's',
          message: {
            id: 'msg_1',
            role: 'assistant',
            content: [{ type: 'text', text: 'whole message only' }],
          },
        } as unknown as SDKMessage;
        yield resultSuccess();
      }),
    });
    const { events } = await collect(adapter);
    expect(events.filter((event) => event.type === 'delta')).toEqual([
      { type: 'delta', text: 'whole message only' },
    ]);
  });

  it('maps thinking deltas to reasoning events', async () => {
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* () {
        yield {
          type: 'stream_event',
          parent_tool_use_id: null,
          uuid: 'u',
          session_id: 's',
          event: {
            type: 'content_block_delta',
            delta: { type: 'thinking_delta', thinking: 'pondering' },
          },
        } as unknown as SDKMessage;
        yield resultSuccess();
      }),
    });
    const { events } = await collect(adapter);
    expect(events).toContainEqual({ type: 'reasoning', text: 'pondering' });
  });

  it('announces a tool at content_block_start and finalizes its streamed arguments', async () => {
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* () {
        yield {
          type: 'stream_event',
          parent_tool_use_id: null,
          uuid: 'u-tool-start',
          session_id: 's',
          event: {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'tool_use', id: 'toolu_live', name: 'Bash', input: {} },
          },
        } as unknown as SDKMessage;
        yield {
          type: 'stream_event',
          parent_tool_use_id: null,
          uuid: 'u-tool-args',
          session_id: 's',
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: '{"command":"sleep 1"}' },
          },
        } as unknown as SDKMessage;
        yield {
          type: 'stream_event',
          parent_tool_use_id: null,
          uuid: 'u-tool-stop',
          session_id: 's',
          event: { type: 'content_block_stop', index: 0 },
        } as unknown as SDKMessage;
        yield resultSuccess();
      }),
    });

    const { events } = await collect(adapter);
    expect(events.filter((event) => event.type === 'tool-call')).toEqual([
      {
        type: 'tool-call',
        toolId: 'toolu_live',
        name: 'Bash',
        argsJson: '{}',
        partial: true,
      },
      {
        type: 'tool-call',
        toolId: 'toolu_live',
        name: 'Bash',
        argsJson: '{"command":"sleep 1"}',
        partial: false,
      },
    ]);
  });

  it('keeps the complete assistant arguments when they arrive before content_block_stop', async () => {
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* () {
        yield {
          type: 'stream_event',
          parent_tool_use_id: null,
          uuid: 'u-tool-start-truncated',
          session_id: 's',
          event: {
            type: 'content_block_start',
            index: 1,
            content_block: {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'fixture_tool',
              input: {},
            },
          },
        } as unknown as SDKMessage;
        yield {
          type: 'stream_event',
          parent_tool_use_id: null,
          uuid: 'u-tool-args-truncated',
          session_id: 's',
          event: {
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'input_json_delta', partial_json: '{"arg":"' },
          },
        } as unknown as SDKMessage;
        yield assistantWithToolUse();
        yield {
          type: 'stream_event',
          parent_tool_use_id: null,
          uuid: 'u-tool-stop-truncated',
          session_id: 's',
          event: { type: 'content_block_stop', index: 1 },
        } as unknown as SDKMessage;
        yield resultSuccess();
      }),
    });

    const { events } = await collect(adapter);
    expect(events.filter((event) => event.type === 'tool-call')).toEqual([
      {
        type: 'tool-call',
        toolId: 'toolu_1',
        name: 'fixture_tool',
        argsJson: '{}',
        partial: true,
      },
      {
        type: 'tool-call',
        toolId: 'toolu_1',
        name: 'fixture_tool',
        argsJson: '{"arg":"value"}',
        partial: false,
      },
    ]);
  });

  it('projects a replayed assistant tool_use block only once', async () => {
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* () {
        yield assistantWithToolUse();
        yield assistantWithToolUse(); // replayed while resuming a tool loop
        yield resultSuccess();
      }),
    });
    const { events } = await collect(adapter);
    expect(events.filter((event) => event.type === 'tool-call')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'usage')).toHaveLength(1);
  });

  it('maps tool_result blocks on user messages to tool-result events', async () => {
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* () {
        yield {
          type: 'user',
          parent_tool_use_id: null,
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_1',
                content: [{ type: 'text', text: 'tool output' }],
                is_error: false,
              },
            ],
          },
        } as unknown as SDKMessage;
        yield resultSuccess();
      }),
    });
    const { events } = await collect(adapter);
    expect(events).toContainEqual({
      type: 'tool-result',
      toolId: 'toolu_1',
      output: 'tool output',
      isError: false,
    });
  });

  it('bridges permission requests and resumes after respondPermission', async () => {
    let decision: PermissionResult | null = null;
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* ({ canUseTool }) {
        decision = await canUseTool('Bash', { command: 'ls' }, {
          signal: new AbortController().signal,
          toolUseID: 'toolu_bash',
          requestId: 'perm-1',
        } as Parameters<CanUseTool>[2]);
        yield resultSuccess();
      }),
    });

    const { permissions } = await collect(adapter);

    expect(permissions).toHaveLength(1);
    expect(permissions[0]).toMatchObject({
      requestId: 'perm-1',
      toolName: 'Bash',
      toolInput: { command: 'ls' },
    });
    expect(decision).toEqual({ behavior: 'allow' });
  });

  it('passes an updated tool input through the allow branch', async () => {
    let decision: PermissionResult | null = null;
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* ({ canUseTool }) {
        decision = await canUseTool('Bash', { command: 'rm -rf /' }, {
          signal: new AbortController().signal,
          toolUseID: 'toolu_bash',
          requestId: 'perm-edit',
        } as Parameters<CanUseTool>[2]);
        yield resultSuccess();
      }),
    });
    adapter.onPermissionRequest((permission) => {
      setTimeout(
        () =>
          adapter.respondPermission(permission.requestId, {
            allow: true,
            updatedInput: { command: 'ls' },
          }),
        5,
      );
    });
    for await (const event of adapter.start(makeRequest())) {
      if (event.type === 'terminal') break;
    }
    expect(decision).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } });
  });

  it('carries the host message on the deny branch', async () => {
    let decision: PermissionResult | null = null;
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* ({ canUseTool }) {
        decision = await canUseTool('Bash', { command: 'ls' }, {
          signal: new AbortController().signal,
          toolUseID: 'toolu_bash',
          requestId: 'perm-deny',
        } as Parameters<CanUseTool>[2]);
        yield resultSuccess();
      }),
    });
    adapter.onPermissionRequest((permission) => {
      setTimeout(
        () => adapter.respondPermission(permission.requestId, { allow: false, message: 'nope' }),
        5,
      );
    });
    for await (const event of adapter.start(makeRequest())) {
      if (event.type === 'terminal') break;
    }
    expect(decision).toEqual({ behavior: 'deny', message: 'nope' });
  });

  it('bridges EnterPlanMode instead of imposing a host tool-name blacklist', async () => {
    let decision: PermissionResult | null = null;
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* ({ canUseTool }) {
        decision = await canUseTool('EnterPlanMode', {}, {
          signal: new AbortController().signal,
          toolUseID: 'toolu_EnterPlanMode',
          requestId: 'perm-EnterPlanMode',
        } as Parameters<CanUseTool>[2]);
        yield resultSuccess();
      }),
    });

    const { permissions } = await collect(adapter, makeRequest());

    expect(permissions.map((permission) => permission.toolName)).toEqual(['EnterPlanMode']);
    expect(decision).toMatchObject({ behavior: 'allow' });
  });

  it('bridges native ExitPlanMode and AskUserQuestion through the permission callback', async () => {
    // Kernel-native planning (docs/engineering/06): both tools surface as
    // permission requests the host resolves via the plan card / ask card.
    const decisions: Array<PermissionResult | null> = [];
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* ({ canUseTool }) {
        for (const tool of ['ExitPlanMode', 'AskUserQuestion']) {
          decisions.push(
            await canUseTool(tool, { plan: '# 方案' }, {
              signal: new AbortController().signal,
              toolUseID: `toolu_${tool}`,
              requestId: `perm-${tool}`,
            } as Parameters<CanUseTool>[2]),
          );
        }
        yield resultSuccess();
      }),
    });

    const { permissions } = await collect(adapter, makeRequest({ planningMode: true }));

    expect(permissions.map((permission) => permission.toolName)).toEqual([
      'ExitPlanMode',
      'AskUserQuestion',
    ]);
    for (const decision of decisions) {
      expect(decision).toMatchObject({ behavior: 'allow' });
    }
  });

  it('uses SDK-native plan mode without replacing Claude tool policy', async () => {
    const captures: QueryCapture[] = [];
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* () {
        yield resultSuccess();
      }, captures),
    });

    await collect(adapter, makeRequest({ planningMode: true, permissionMode: 'full-access' }));

    const options = captures[0].options;
    // full-access must never bypass permissions on a planning run, else Claude
    // executes ExitPlanMode/AskUserQuestion without consulting canUseTool.
    expect(options.permissionMode).toBe('plan');
    expect(options.allowDangerouslySkipPermissions).toBeUndefined();
    expect(options.allowedTools).toBeUndefined();
    expect(options.disallowedTools).toBeUndefined();
  });

  it('acknowledges the dangerous skip flag only for a real full-access run', async () => {
    const captures: QueryCapture[] = [];
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* () {
        yield resultSuccess();
      }, captures),
    });

    await collect(adapter, makeRequest({ permissionMode: 'full-access' }));

    expect(captures[0].options.permissionMode).toBe('bypassPermissions');
    expect(captures[0].options.allowDangerouslySkipPermissions).toBe(true);
    expect(captures[0].options.disallowedTools).toBeUndefined();
  });

  it('uses Claude native search only for native-search routes', async () => {
    const captures: QueryCapture[] = [];
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* () {
        yield resultSuccess();
      }, captures),
    });

    await collect(adapter, makeRequest({ webSearchMode: 'native' }));
    await collect(adapter, makeRequest({ webSearchMode: 'external' }));
    await collect(adapter, makeRequest({ webSearchMode: 'disabled' }));

    expect(captures[0].options.disallowedTools).toBeUndefined();
    expect(captures[1].options.disallowedTools).toEqual(['WebSearch']);
    expect(captures[2].options.disallowedTools).toEqual(['WebSearch', 'WebFetch']);
  });

  it('runs the SDK transport against the atomically activated private Claude CLI', async () => {
    const captures: QueryCapture[] = [];
    const executable = 'D:\\SYNC-THINK\\kernels\\claude-code\\2.1.250\\claude.exe';
    const adapter = new ClaudeSdkKernelAdapter({
      resolveExecutable: () => executable,
      query: fakeQuery(async function* () {
        yield resultSuccess();
      }, captures),
    });

    await collect(adapter);

    expect(captures[0].options.pathToClaudeCodeExecutable).toBe(executable);
  });

  it('maps workspace permission mode to dontAsk', async () => {
    const captures: QueryCapture[] = [];
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* () {
        yield resultSuccess();
      }, captures),
    });
    await collect(adapter, makeRequest({ permissionMode: 'workspace' }));
    expect(captures[0].options.permissionMode).toBe('dontAsk');
  });

  it('reports usage through the onUsage callback', async () => {
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* () {
        yield assistantWithToolUse();
        yield resultSuccess();
      }),
    });
    const usages: Array<{ real: number }> = [];
    adapter.onUsage((usage) => usages.push(usage));
    await collect(adapter);
    expect(usages).toHaveLength(1);
    expect(usages[0].real).toBe(165);
  });

  it('creates the requested Claude session and overrides both Anthropic token variables', async () => {
    const captures: QueryCapture[] = [];
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* () {
        yield resultSuccess();
      }, captures),
    });

    const previousForcedTtl = process.env.FORCE_PROMPT_CACHING_5M;
    process.env.FORCE_PROMPT_CACHING_5M = '1';
    try {
      await collect(
        adapter,
        makeRequest({
          credential: {
            apiKey: 'gateway-ticket',
            baseUrl: 'http://127.0.0.1:43123/anthropic',
          },
          session: { id: '4c793e96-7a25-4c15-94dd-19e4f9b2c7ef', mode: 'create' },
        }),
      );
    } finally {
      if (previousForcedTtl === undefined) delete process.env.FORCE_PROMPT_CACHING_5M;
      else process.env.FORCE_PROMPT_CACHING_5M = previousForcedTtl;
    }

    const options = captures[0].options;
    expect(options.sessionId).toBe('4c793e96-7a25-4c15-94dd-19e4f9b2c7ef');
    expect(options.resume).toBeUndefined();
    // Explicit provider credentials must not load user/project settings: those
    // settings can run hooks or override the endpoint before this request.
    expect(options.settingSources).toEqual([]);
    expect(options.env).toMatchObject({
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:43123/anthropic',
      ANTHROPIC_API_KEY: 'gateway-ticket',
      ANTHROPIC_AUTH_TOKEN: 'gateway-ticket',
      ENABLE_PROMPT_CACHING_1H: '1',
    });
    expect(options.env).not.toHaveProperty('FORCE_PROMPT_CACHING_5M');
    // env REPLACES the subprocess environment, so PATH must survive.
    expect(
      (options.env as Record<string, string>).PATH ?? (options.env as Record<string, string>).Path,
    ).toBeTruthy();
  });

  it('forwards the host-configured window so Claude auto-compacts at that budget', async () => {
    const captures: QueryCapture[] = [];
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* () {
        yield resultSuccess();
      }, captures),
    });

    await collect(
      adapter,
      makeRequest({
        contextWindow: 400_000,
        effectiveContextWindow: 400_000,
      }),
    );

    expect(captures[0].options.env).toMatchObject({
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: '400000',
      CLAUDE_CODE_MAX_CONTEXT_TOKENS: '400000',
    });
  });

  it('clamps the Claude window env to the 100k–1M range the CLI accepts', async () => {
    const captures: QueryCapture[] = [];
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* () {
        yield resultSuccess();
      }, captures),
    });

    await collect(
      adapter,
      makeRequest({
        contextWindow: 2_000_000,
        effectiveContextWindow: 2_000_000,
      }),
    );
    expect(captures[0].options.env).toMatchObject({
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1000000',
      CLAUDE_CODE_MAX_CONTEXT_TOKENS: '1000000',
    });

    captures.length = 0;
    await collect(
      adapter,
      makeRequest({
        contextWindow: 12_000,
        effectiveContextWindow: 12_000,
      }),
    );
    expect(captures[0].options.env).toMatchObject({
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: '100000',
      CLAUDE_CODE_MAX_CONTEXT_TOKENS: '100000',
    });
  });

  it('keeps local Claude settings available when reusing the local login', async () => {
    const captures: QueryCapture[] = [];
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* () {
        yield resultSuccess();
      }, captures),
    });
    const previousForcedTtl = process.env.FORCE_PROMPT_CACHING_5M;
    process.env.FORCE_PROMPT_CACHING_5M = '1';
    try {
      await collect(adapter);
    } finally {
      if (previousForcedTtl === undefined) delete process.env.FORCE_PROMPT_CACHING_5M;
      else process.env.FORCE_PROMPT_CACHING_5M = previousForcedTtl;
    }
    expect(captures[0].options.settingSources).toBeUndefined();
    const env = captures[0].options.env as Record<string, string>;
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ENABLE_PROMPT_CACHING_1H).toBe('1');
    expect(env).not.toHaveProperty('FORCE_PROMPT_CACHING_5M');
  });

  it('resumes an existing Claude session without pinning a replacement id', async () => {
    const captures: QueryCapture[] = [];
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* () {
        yield resultSuccess();
      }, captures),
    });

    await collect(
      adapter,
      makeRequest({ session: { id: '1c84d60d-4280-45f5-b8ae-d03a1c827018', mode: 'resume' } }),
    );

    expect(captures[0].options.resume).toBe('1c84d60d-4280-45f5-b8ae-d03a1c827018');
    expect(captures[0].options.sessionId).toBeUndefined();
  });

  it('injects the cross-kernel catch-up on resume instead of the full system context', async () => {
    const captures: QueryCapture[] = [];
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* () {
        yield resultSuccess();
      }, captures),
    });

    await collect(
      adapter,
      makeRequest({
        systemContext: '## FULL SYSTEM CONTEXT',
        session: {
          id: '1c84d60d-4280-45f5-b8ae-d03a1c827018',
          mode: 'resume',
          catchUp: '## Cross-kernel session gap\n### User\ngap fact from codex era',
        },
      }),
    );

    const systemPrompt = captures[0].options.systemPrompt as {
      type: string;
      preset: string;
      append?: string;
    };
    // The preset must survive: `append` extends Claude's own prompt rather than
    // replacing it (this is what --append-system-prompt did on the CLI).
    expect(systemPrompt).toMatchObject({ type: 'preset', preset: 'claude_code' });
    expect(systemPrompt.append).toContain('## Cross-kernel session gap');
    expect(systemPrompt.append).toContain('gap fact from codex era');
    expect(systemPrompt.append).not.toContain('FULL SYSTEM CONTEXT');
  });

  it('injects the full system context when creating a session', async () => {
    const captures: QueryCapture[] = [];
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* () {
        yield resultSuccess();
      }, captures),
    });
    await collect(adapter, makeRequest({ systemContext: '## FULL SYSTEM CONTEXT' }));
    expect(captures[0].options.systemPrompt).toMatchObject({
      type: 'preset',
      preset: 'claude_code',
      append: '## FULL SYSTEM CONTEXT',
    });
  });

  it('registers the platform MCP server in-memory without writing a token to disk', async () => {
    const captures: QueryCapture[] = [];
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* () {
        yield resultSuccess();
      }, captures),
    });

    await collect(
      adapter,
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
    );

    const options = captures[0].options;
    expect(options.strictMcpConfig).toBeUndefined();
    const server = options.mcpServers?.['sync-think-platform'] as {
      type: string;
      command: string;
      args: string[];
      env: Record<string, string>;
    };
    expect(server).toMatchObject({
      type: 'stdio',
      command: 'C:/node/node.exe',
      args: ['D:/mcp/platform-mcp-server.mjs'],
    });
    expect(server.env).toEqual({
      ST_BROKER_HOST: '127.0.0.1',
      ST_BROKER_PORT: '49152',
      ST_BROKER_TOKEN: 'tok-cc-1',
      ST_WORKSPACE_DIR: 'C:/ws',
    });
  });

  it('fails immediately when Claude reports a non-retriable authentication error', async () => {
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* () {
        yield {
          type: 'system',
          subtype: 'api_retry',
          attempt: 1,
          max_retries: 5,
          retry_delay_ms: 1000,
          error_status: 401,
          error: 'authentication_failed',
          uuid: 'u',
          session_id: 's',
        } as unknown as SDKMessage;
        yield resultSuccess();
      }),
    });

    const { events } = await collect(adapter);
    expect(events.at(-1)).toMatchObject({
      type: 'terminal',
      status: 'failed',
      error: expect.stringContaining('401'),
    });
  });

  it('keeps retrying a transient api_retry instead of failing the run', async () => {
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* () {
        yield {
          type: 'system',
          subtype: 'api_retry',
          attempt: 1,
          max_retries: 5,
          retry_delay_ms: 1000,
          error_status: 503,
          error: 'overloaded',
          uuid: 'u',
          session_id: 's',
        } as unknown as SDKMessage;
        yield resultSuccess();
      }),
    });
    const { events } = await collect(adapter);
    expect(events.at(-1)).toMatchObject({ type: 'terminal', status: 'completed' });
  });

  it('maps a compact boundary to the compacted event', async () => {
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* () {
        yield {
          type: 'system',
          subtype: 'compact_boundary',
          compact_metadata: { trigger: 'auto', pre_tokens: 150_000 },
          uuid: 'u',
          session_id: 's',
        } as unknown as SDKMessage;
        yield resultSuccess();
      }),
    });
    const { events } = await collect(adapter);
    expect(events).toContainEqual({ type: 'compacted' });
  });

  it('reports Claude /context occupancy after a successful turn', async () => {
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(
        async function* () {
          yield systemInit();
          yield resultSuccess();
        },
        undefined,
        {
          getContextUsage: async () => ({
            categories: [
              { name: 'System prompt', tokens: 12_000, color: 'blue' },
              { name: 'Tools', tokens: 37_000, color: 'orange' },
              { name: 'Messages', tokens: 8_234, color: 'green' },
              { name: 'Free space', tokens: 142_766, color: 'gray' },
            ],
            totalTokens: 57_234,
            maxTokens: 200_000,
            rawMaxTokens: 200_000,
            percentage: 29,
            gridRows: [],
            model: 'claude-sonnet-4-5',
            memoryFiles: [],
            mcpTools: [],
            agents: [],
            isAutoCompactEnabled: true,
            apiUsage: null,
          }),
        },
      ),
    });

    const { events } = await collect(adapter);
    expect(events).toContainEqual({
      type: 'context-occupancy',
      usedTokens: 57_234,
      windowTokens: 200_000,
      categories: [
        { name: 'System prompt', tokens: 12_000 },
        { name: 'Tools', tokens: 37_000 },
        { name: 'Messages', tokens: 8_234 },
      ],
    });
  });

  it('keeps compact metadata occupancy when /context is unavailable', async () => {
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* () {
        yield {
          type: 'system',
          subtype: 'compact_boundary',
          compact_metadata: { trigger: 'auto', pre_tokens: 150_000, post_tokens: 42_000 },
          uuid: 'u',
          session_id: 's',
        } as unknown as SDKMessage;
        yield resultSuccess();
      }),
    });
    const { events } = await collect(adapter);
    expect(events).toContainEqual({
      type: 'context-occupancy',
      usedTokens: 42_000,
    });
  });

  it('extracts a readable failure from nested Claude result payloads', async () => {
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* () {
        yield {
          type: 'result',
          subtype: 'error_during_execution',
          is_error: true,
          errors: [JSON.stringify({ error: { message: 'Nested Claude gateway failure' } })],
          uuid: 'u',
          session_id: 's',
        } as unknown as SDKMessage;
      }),
    });
    const { events } = await collect(adapter);
    expect(events.filter((event) => event.type === 'terminal')).toEqual([
      { type: 'terminal', status: 'failed', error: 'Nested Claude gateway failure' },
    ]);
  });

  it('turns an SDK stream failure into one redacted terminal event', async () => {
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* () {
        yield systemInit();
        throw new Error('spawn failed with key sk-ant-fixture-secret-123456789');
      }),
    });
    const exits: Array<{ code: number | null; stderrTail: string }> = [];
    adapter.onExit((code, stderrTail) => exits.push({ code, stderrTail }));

    const { events } = await collect(
      adapter,
      makeRequest({
        credential: {
          apiKey: 'sk-ant-fixture-secret-123456789',
          baseUrl: 'http://127.0.0.1:43123/anthropic',
        },
      }),
    );

    const terminals = events.filter((event) => event.type === 'terminal');
    expect(terminals).toHaveLength(1);
    expect(terminals[0]).toMatchObject({ type: 'terminal', status: 'failed' });
    expect(JSON.stringify({ terminals, exits })).not.toContain('sk-ant-fixture-secret-123456789');
    expect(JSON.stringify({ terminals, exits })).toContain('[REDACTED]');
  });

  it('completes when the SDK stream ends without a result message', async () => {
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* () {
        yield systemInit();
        yield textDelta('truncated');
      }),
    });
    const { events } = await collect(adapter);
    expect(events.at(-1)).toMatchObject({ type: 'terminal', status: 'completed' });
  });

  it('emits exactly one terminal even when a result is followed by a stream failure', async () => {
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* () {
        yield resultSuccess();
        throw new Error('late failure after the turn completed');
      }),
    });
    const events: KernelEvent[] = [];
    for await (const event of adapter.start(makeRequest())) events.push(event);
    expect(events.filter((event) => event.type === 'terminal')).toHaveLength(1);
  });

  it('ignores unknown SDK message types instead of failing the run', async () => {
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* () {
        yield { type: 'a_message_type_from_the_future', uuid: 'u' } as unknown as SDKMessage;
        yield { type: 'status', uuid: 'u' } as unknown as SDKMessage;
        yield resultSuccess();
      }),
    });
    const { events } = await collect(adapter);
    expect(events.at(-1)).toMatchObject({ type: 'terminal', status: 'completed' });
  });

  it('cancel() aborts the query and ends the stream', async () => {
    let aborted = false;
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* ({ signal }) {
        yield systemInit();
        signal.addEventListener('abort', () => {
          aborted = true;
        });
        // Block until aborted, the way a real in-flight turn would.
        await new Promise<void>((resolve) => {
          if (signal.aborted) return resolve();
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
      }),
    });

    const iterator = adapter.start(makeRequest())[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.done).toBe(false);

    await adapter.cancel();

    let ended = false;
    for (let i = 0; i < 50; i++) {
      const next = await iterator.next();
      if (next.done || next.value?.type === 'terminal') {
        ended = true;
        break;
      }
    }
    expect(ended).toBe(true);
    expect(aborted).toBe(true);
  });

  it('cancel() releases a pending permission wait with a deny', async () => {
    let decision: PermissionResult | null = null;
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* ({ canUseTool, signal }) {
        yield systemInit();
        decision = await canUseTool('Bash', { command: 'sleep 100' }, {
          signal,
          toolUseID: 'toolu_bash',
          requestId: 'perm-cancel',
        } as Parameters<CanUseTool>[2]);
        yield resultSuccess();
      }),
    });

    const seen: KernelPermissionRequest[] = [];
    adapter.onPermissionRequest((permission) => seen.push(permission));

    const iterator = adapter.start(makeRequest())[Symbol.asyncIterator]();
    await iterator.next(); // session-started
    await iterator.next(); // permission-request
    expect(seen).toHaveLength(1);

    await adapter.cancel();

    expect(decision).toEqual({ behavior: 'deny', message: 'run cancelled' });
  });

  it('forwards attached images as base64 image blocks', async () => {
    const captures: QueryCapture[] = [];
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* () {
        yield resultSuccess();
      }, captures),
    });

    await collect(
      adapter,
      makeRequest({
        userText: '看图',
        images: [
          {
            name: 'shot.png',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,QUJDRA==',
          },
        ],
      }),
    );

    const prompt = captures[0].prompt as AsyncIterable<{
      type: string;
      message: { role: string; content: unknown[] };
    }>;
    const messages: Array<{ type: string; message: { role: string; content: unknown[] } }> = [];
    for await (const message of prompt) messages.push(message);
    const user = messages.find((message) => message.type === 'user');
    expect(user).toBeTruthy();
    const content = user!.message.content as Array<Record<string, unknown>>;
    expect(content[0]).toMatchObject({ type: 'text', text: '看图' });
    expect(content[1]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'QUJDRA==' },
    });
  });

  it('drops images with non-image data URLs silently', async () => {
    const captures: QueryCapture[] = [];
    const adapter = new ClaudeSdkKernelAdapter({
      query: fakeQuery(async function* () {
        yield resultSuccess();
      }, captures),
    });

    await collect(
      adapter,
      makeRequest({
        userText: '看图',
        images: [{ name: 'x.png', mimeType: 'image/png', dataUrl: 'sync-think-image://media/x' }],
      }),
    );

    const prompt = captures[0].prompt as AsyncIterable<{
      type: string;
      message: { role: string; content: unknown[] };
    }>;
    const messages: Array<{ type: string; message: { role: string; content: unknown[] } }> = [];
    for await (const message of prompt) messages.push(message);
    const content = messages[0]!.message.content as Array<Record<string, unknown>>;
    expect(content).toHaveLength(1);
    expect(content[0]).toMatchObject({ type: 'text', text: '看图' });
  });

  it('detectVersion reports the CLI version bundled with the SDK', async () => {
    const adapter = new ClaudeSdkKernelAdapter();
    const version = await adapter.detectVersion();
    // The SDK ships its own binary, so this never depends on a PATH install.
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('stripAnthropicV1Suffix', () => {
  it('rewrites the DeepSeek OpenAI-style root to its Anthropic prefix', () => {
    expect(stripAnthropicV1Suffix('https://api.deepseek.com/v1')).toBe(
      'https://api.deepseek.com/anthropic',
    );
  });

  it('keeps a non-DeepSeek anthropic root untouched', () => {
    expect(stripAnthropicV1Suffix('https://api.unity2.ai')).toBe('https://api.unity2.ai');
  });

  it('strips a trailing slash and /v1 for generic providers', () => {
    expect(stripAnthropicV1Suffix('https://example.com/v1/')).toBe('https://example.com');
  });
});
