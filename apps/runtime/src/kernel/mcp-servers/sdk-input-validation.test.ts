/**
 * SDK input-validation regression: the in-process SDK servers must carry real
 * zod schemas so `validateToolInput` parses arguments at call time.
 *
 * Regression context: a fake zod-like marker (parse/safeParse only) passed the
 * SDK's registration check but blew up the moment the model actually called a
 * tool — `l._parse is not a function` on claude-code when the model invoked
 * `mcp__platform__ask_user_question`. Real zod schemas parse and enforce.
 */
import { describe, expect, it } from 'vitest';
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import {
  buildSdkMcpServers,
  selectKernelMcpRun,
  setKernelMcpServerConditions,
} from './registry.js';
import { jsonSchemaToZodShape } from './schema-bridge.js';

describe('SDK in-process tool input validation', () => {
  it('validateToolInput accepts valid arguments through a real zod schema', async () => {
    const server = createSdkMcpServer({
      name: 'probe',
      version: '1.0.0',
      alwaysLoad: true,
      tools: [
        {
          name: 'echo',
          description: 'echo test',
          inputSchema: jsonSchemaToZodShape(z, {
            type: 'object',
            required: ['text'],
            properties: {
              text: { type: 'string', description: 'the text' },
              count: { type: 'integer' },
            },
          }) as never,
          handler: async () => ({ content: [{ type: 'text', text: 'OK' }] }),
        },
      ],
    });
    const instance = server.instance as unknown as {
      _registeredTools: Record<string, { inputSchema: unknown }>;
      validateToolInput: (
        tool: { inputSchema: unknown },
        args: unknown,
        name: string,
      ) => Promise<unknown>;
    };
    const tool = instance._registeredTools['echo'];
    expect(tool).toBeDefined();
    // Valid input passes.
    const parsed = await instance.validateToolInput(tool, { text: 'hello', count: 2 }, 'echo');
    expect(parsed).toEqual({ text: 'hello', count: 2 });
    // Missing required field is rejected.
    await expect(instance.validateToolInput(tool, { count: 2 }, 'echo')).rejects.toThrow();
    // Wrong type is rejected.
    await expect(instance.validateToolInput(tool, { text: 42 }, 'echo')).rejects.toThrow();
  });

  it('registry-built servers pass the same validation on the platform ask tool', async () => {
    setKernelMcpServerConditions({});
    const selection = selectKernelMcpRun({});
    const servers = buildSdkMcpServers(selection.servers, async () => 'ok', z);
    const platform = servers['platform'];
    expect(platform).toBeDefined();
    const instance = platform.instance as unknown as {
      _registeredTools: Record<string, { inputSchema: unknown }>;
      validateToolInput: (
        tool: { inputSchema: unknown },
        args: unknown,
        name: string,
      ) => Promise<unknown>;
    };
    const ask = instance._registeredTools['ask_user_question'];
    expect(ask).toBeDefined();
    // The registry ask tool carries a real zod schema — valid call passes.
    const parsed = await instance.validateToolInput(
      ask,
      {
        questions: [
          {
            id: 'q1',
            question: '选哪个？',
            options: [{ label: 'A' }, { label: 'B' }],
          },
        ],
      },
      'ask_user_question',
    );
    expect(parsed).toBeTruthy();
    // Invalid (missing question text) is rejected, not silently passed.
    await expect(
      instance.validateToolInput(
        ask,
        { questions: [{ id: 'q1', options: [] }] },
        'ask_user_question',
      ),
    ).rejects.toThrow();
  });
});
