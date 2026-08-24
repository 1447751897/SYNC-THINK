/**
 * Registry → SDK server construction regression: every in-process SDK server
 * must be registered with `alwaysLoad: true`.
 *
 * SDK 0.3.x defers non-alwaysLoad tools behind its tool search; without the
 * flag the model never sees `mcp__<server>__<tool>` in its tool list — the
 * observed symptom was ask_user_question "not showing up" on claude-code even
 * in full-access mode. NewMax's ask-user server does the same.
 */
import { describe, expect, it, vi } from 'vitest';
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>();
  return { ...actual, createSdkMcpServer: vi.fn(actual.createSdkMcpServer) };
});

import {
  buildSdkMcpServers,
  selectKernelMcpRun,
  setKernelMcpServerConditions,
} from '../src/kernel/mcp-servers/registry.js';

describe('registry SDK server alwaysLoad', () => {
  it('registers every server with alwaysLoad: true', () => {
    const createSpy = vi.mocked(createSdkMcpServer);
    createSpy.mockClear();
    setKernelMcpServerConditions({});
    const selection = selectKernelMcpRun({});
    const servers = buildSdkMcpServers(selection.servers, async () => 'ok', z);
    expect(Object.keys(servers).length).toBeGreaterThanOrEqual(1);
    expect(createSpy).toHaveBeenCalled();
    for (const call of createSpy.mock.calls) {
      expect(call[0]?.alwaysLoad, 'every SDK server must be alwaysLoad').toBe(true);
    }
  });
});
