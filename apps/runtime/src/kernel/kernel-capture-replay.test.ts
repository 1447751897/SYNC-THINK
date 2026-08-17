import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { KernelEvent, KernelRequest } from '@sync-think/shared';
import { ClaudeCodeKernelAdapter } from './claude-code-adapter.js';
import { CodexKernelAdapter } from './codex-adapter.js';
import { startKernelProcess } from './process.js';

const claudeFixture = fileURLToPath(
  new URL('./fixtures/claude-partial-capture-fixture.mjs', import.meta.url),
);
const codexFixture = fileURLToPath(
  new URL('./fixtures/codex-mcp-capture-fixture.mjs', import.meta.url),
);

function makeRequest(kernelId: string, overrides: Partial<KernelRequest> = {}): KernelRequest {
  return {
    kernelId,
    model: 'capture-model',
    providerModelId: 'capture-model',
    userText: 'replay the captured turn',
    contextWindow: 200_000,
    effectiveContextWindow: 200_000,
    contextWindowSource: 'configured',
    credential: { reuseLocalLogin: true },
    systemContext: '',
    platformTools: [],
    permissionMode: 'workspace',
    workspaceDir: process.cwd(),
    ...overrides,
  };
}

async function collect(
  adapter: {
    start(request: KernelRequest): AsyncIterable<KernelEvent>;
    cancel(): Promise<void>;
  },
  request: KernelRequest,
): Promise<KernelEvent[]> {
  const events: KernelEvent[] = [];
  for await (const event of adapter.start(request)) {
    events.push(event);
    if (event.type === 'terminal') break;
  }
  await adapter.cancel().catch(() => undefined);
  return events;
}

describe('kernel adapters against real captured CLI streams', () => {
  it('maps claude 2.1.222 partial text, reasoning and the echoed tool_result exactly once', async () => {
    const adapter = new ClaudeCodeKernelAdapter({
      spawn: (args, env, cwd) =>
        startKernelProcess({ command: process.execPath, args: [claudeFixture, ...args], cwd, env }),
    });
    const events = await collect(adapter, makeRequest('claude-code'));

    // Text arrives as stream_event deltas; the whole-message echo must not
    // duplicate it (this run streamed exactly one text delta: "alpha").
    const deltas = events.filter((event) => event.type === 'delta');
    expect(deltas).toEqual([{ type: 'delta', text: 'alpha' }]);

    // Thinking becomes diagnostic reasoning, never chat text.
    const reasoning = events.filter((event) => event.type === 'reasoning');
    expect(reasoning.length).toBeGreaterThan(0);

    // Tool arguments come from the complete assistant message (never partial JSON).
    const toolCall = events.find((event) => event.type === 'tool-call');
    expect(toolCall).toMatchObject({
      type: 'tool-call',
      toolId: 'toolu_VHGuuy3wlJam7wNSw5zWpu',
      name: 'Read',
      partial: false,
    });
    expect(JSON.parse((toolCall as { argsJson: string }).argsJson).file_path).toContain('note.txt');

    // The echoed user tool_result closes the timeline (string content form).
    const toolResult = events.find((event) => event.type === 'tool-result');
    expect(toolResult).toMatchObject({
      type: 'tool-result',
      toolId: 'toolu_VHGuuy3wlJam7wNSw5zWpu',
      isError: false,
    });
    expect((toolResult as { output: string }).output).toContain('alpha');

    expect(events.at(-1)).toMatchObject({ type: 'terminal', status: 'completed' });
  }, 20_000);

  it('keeps the real codex MCP identity and does not double-count cached input', async () => {
    const adapter = new CodexKernelAdapter({
      spawn: (args, env, cwd) =>
        startKernelProcess({
          command: process.execPath,
          args: [codexFixture, ...args],
          cwd,
          env,
          stdin: 'ignore',
        }),
    });
    const events = await collect(adapter, makeRequest('codex'));

    const toolCall = events.find((event) => event.type === 'tool-call');
    expect(toolCall).toMatchObject({
      type: 'tool-call',
      name: 'mcp__codex__list_mcp_resource_templates',
      partial: false,
    });

    const usage = events.find((event) => event.type === 'usage') as
      | { type: 'usage'; usage: { real: number; input?: number; output?: number; cached?: number } }
      | undefined;
    // Captured turn.completed: input 142300 (cached 121344 is a subset), output 653.
    expect(usage?.usage).toMatchObject({ input: 142300, output: 653, cached: 121344 });
    expect(usage?.usage.real).toBe(142300 + 653);
  });
});
