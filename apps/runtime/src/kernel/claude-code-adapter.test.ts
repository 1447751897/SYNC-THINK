import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import type {
  KernelEvent,
  KernelPermissionRequest,
  KernelRequest,
} from '@sync-think/shared';
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

function makeRequest(overrides: Partial<KernelRequest> = {}): KernelRequest {
  return {
    kernelId: 'claude-code',
    model: 'claude-sonnet-4-5',
    providerModelId: 'claude-sonnet-4-5',
    userText: 'hello fixture',
    contextWindow: 200_000,
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
    expect(toolCall && 'argsJson' in toolCall ? (toolCall as { argsJson: string }).argsJson : '').toBe(
      '{"arg":"value"}',
    );

    const usage = events.find((event) => event.type === 'usage');
    expect(usage).toMatchObject({
      type: 'usage',
      usage: {
        real: 165, // 10 input + 100 cache-create + 50 cache-read + 5 output
        window: 200_000,
        input: 160,
        output: 5,
        cached: 50,
      },
    });
  });

  it('ignores unknown stream events and completes on result success', async () => {
    const { events } = await runFixture();
    const terminal = events[events.length - 1];
    expect(terminal).toMatchObject({ type: 'terminal', status: 'completed' });
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

  it('detectVersion probes the local claude (installed state depends on machine)', async () => {
    const adapter = new ClaudeCodeKernelAdapter();
    const version = await adapter.detectVersion();
    expect(version === null || typeof version === 'string').toBe(true);
  });

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
