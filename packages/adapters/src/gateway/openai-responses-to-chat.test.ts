import { describe, it, expect } from 'vitest';
import { openaiResponsesToChat } from './openai-responses-to-chat.js';
import type { OpenAIResponsesRequest } from './wire-types.js';

function base(overrides: Partial<OpenAIResponsesRequest> = {}): OpenAIResponsesRequest {
  return {
    model: 'deepseek-v4-flash',
    input: [{ role: 'user', content: 'hello' }],
    stream: true,
    ...overrides,
  };
}

describe('openaiResponsesToChat', () => {
  it('maps instructions to a system message and targets the resolved model', () => {
    const { body } = openaiResponsesToChat(base({ instructions: 'be brief' }), {
      targetModel: 'deepseek-v4-flash',
    });
    expect(body.model).toBe('deepseek-v4-flash');
    expect(body.messages[0]).toEqual({ role: 'system', content: 'be brief' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hello' });
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it('maps max_output_tokens to max_tokens and keeps temperature', () => {
    const { body } = openaiResponsesToChat(base({ max_output_tokens: 4096, temperature: 0.7 }), {
      targetModel: 'deepseek-v4-flash',
    });
    expect(body.max_tokens).toBe(4096);
    expect(body.temperature).toBe(0.7);
  });

  it('maps responses reasoning.effort to chat reasoning_effort', () => {
    const { body } = openaiResponsesToChat(base({ reasoning: { effort: 'high' } }), {
      targetModel: 'deepseek-v4-flash',
    });
    expect(body.reasoning_effort).toBe('high');
  });

  it('defaults reasoning_effort on for reasoning chat models when Codex omits it', () => {
    const { body } = openaiResponsesToChat(base({}), { targetModel: 'deepseek-v4-flash' });
    expect(body.reasoning_effort).toBe('high');

    const { body: plain } = openaiResponsesToChat(base({}), { targetModel: 'gpt-4o' });
    expect(plain.reasoning_effort).toBeUndefined();
  });

  it('accepts a single content object instead of an array (codex 0.147)', () => {
    const { body } = openaiResponsesToChat(
      base({
        input: [
          { role: 'user', content: { type: 'input_text', text: 'hi' } as never },
        ],
      }),
      { targetModel: 'm' },
    );
    expect(body.messages[0]).toEqual({ role: 'user', content: 'hi' });
  });

  it('flattens developer/system messages into the system slot', () => {
    const { body } = openaiResponsesToChat(
      base({
        input: [
          { role: 'developer', content: 'dev rules' },
          { role: 'system', content: 'sys rules' },
          { role: 'user', content: 'hi' },
        ],
      }),
      { targetModel: 'm' },
    );
    expect(body.messages[0]).toEqual({ role: 'system', content: 'dev rules\n\nsys rules' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('converts user content parts (text + image) into chat parts', () => {
    const { body } = openaiResponsesToChat(
      base({
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: 'see this' },
              { type: 'input_image', image_url: 'https://example.com/a.png' },
            ],
          },
        ],
      }),
      { targetModel: 'm' },
    );
    const user = body.messages[0];
    expect(user.role).toBe('user');
    expect(user.content).toEqual([
      { type: 'text', text: 'see this' },
      { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
    ]);
  });

  it('turns function_call items into assistant tool_calls and function_call_output into tool messages', () => {
    const { body } = openaiResponsesToChat(
      base({
        input: [
          { role: 'user', content: 'list files' },
          {
            type: 'function_call',
            call_id: 'call_1',
            name: 'shell_ls',
            arguments: '{"dir":"."}',
          },
          { type: 'function_call_output', call_id: 'call_1', output: 'file.txt' },
        ],
      }),
      { targetModel: 'm' },
    );
    expect(body.messages[1]).toEqual({
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'shell_ls', arguments: '{"dir":"."}' },
        },
      ],
    });
    expect(body.messages[2]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: 'file.txt' });
  });

  it('re-flattens namespaced function_call items so history stays consistent with tool definitions', () => {
    const { body } = openaiResponsesToChat(
      base({
        input: [
          { role: 'user', content: 'use the platform' },
          {
            type: 'function_call',
            call_id: 'call_ns',
            name: 'platform_context',
            namespace: 'mcp__sync_think_platform',
            arguments: '{}',
          },
          { type: 'function_call_output', call_id: 'call_ns', output: 'ok' },
        ],
      }),
      { targetModel: 'm' },
    );
    expect(body.messages[1]).toEqual({
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'call_ns',
          type: 'function',
          function: { name: 'mcp__sync_think_platform__platform_context', arguments: '{}' },
        },
      ],
    });
  });

  it('maps namespaced custom_tool_call input items the same way', () => {
    const { body } = openaiResponsesToChat(
      base({
        input: [
          { role: 'user', content: 'call it' },
          {
            type: 'custom_tool_call',
            call_id: 'call_c',
            name: 'file_list',
            namespace: 'mcp__sync_think_platform',
            input: '{}',
          },
          { type: 'function_call_output', call_id: 'call_c', output: '[]' },
        ],
      }),
      { targetModel: 'm' },
    );
    const toolCall = (body.messages[1] as { tool_calls?: Array<{ function: { name: string } }> }).tool_calls?.[0];
    expect(toolCall?.function.name).toBe('mcp__sync_think_platform__file_list');
  });

  it('drops orphaned tool calls that have no matching function_call_output in the replay', () => {
    const { body } = openaiResponsesToChat(
      base({
        input: [
          { role: 'user', content: 'go' },
          { type: 'function_call', call_id: 'orphan_1', name: 'platform_context', arguments: '{}' },
          { type: 'function_call', call_id: 'ok_1', name: 'shell_ls', arguments: '{}' },
          { type: 'function_call_output', call_id: 'ok_1', output: 'ok' },
        ],
      }),
      { targetModel: 'm' },
    );
    // Only the answered call survives; the orphaned one is filtered out.
    const assistant = body.messages.find(
      (m) => m.role === 'assistant' && Array.isArray((m as { tool_calls?: unknown }).tool_calls),
    ) as { tool_calls?: Array<{ id: string; function: { name: string } }> };
    expect(assistant.tool_calls).toHaveLength(1);
    expect(assistant.tool_calls?.[0].id).toBe('ok_1');
    expect(assistant.tool_calls?.[0].function.name).toBe('shell_ls');
  });

  it('merges parallel function_call items into one assistant message', () => {
    const { body } = openaiResponsesToChat(
      base({
        input: [
          { role: 'user', content: 'do both' },
          { type: 'function_call', call_id: 'a', name: 'f1', arguments: '{}' },
          { type: 'function_call', call_id: 'b', name: 'f2', arguments: '{}' },
          { type: 'function_call_output', call_id: 'a', output: '1' },
          { type: 'function_call_output', call_id: 'b', output: '2' },
        ],
      }),
      { targetModel: 'm' },
    );
    const assistant = body.messages[1];
    expect(assistant.role).toBe('assistant');
    expect(assistant.tool_calls).toHaveLength(2);
    expect(assistant.tool_calls?.[0].id).toBe('a');
    expect(assistant.tool_calls?.[1].id).toBe('b');
    expect(body.messages[2]).toMatchObject({ role: 'tool', tool_call_id: 'a' });
    expect(body.messages[3]).toMatchObject({ role: 'tool', tool_call_id: 'b' });
  });

  it('converts tools and tool_choice', () => {
    const { body } = openaiResponsesToChat(
      base({
        tools: [{ type: 'function', name: 'f', description: 'desc', parameters: { type: 'object' } }],
        tool_choice: { type: 'function', name: 'f' },
      }),
      { targetModel: 'm' },
    );
    expect(body.tools).toEqual([
      { type: 'function', function: { name: 'f', description: 'desc', parameters: { type: 'object' } } },
    ]);
    expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'f' } });
  });

  it('drops nameless tools that Chat upstreams reject', () => {
    const { body } = openaiResponsesToChat(
      base({
        tools: [
          { type: 'function', name: 'keep' },
          { type: 'function', name: '' },
          { type: 'function', name: '  ' },
        ] as never,
      }),
      { targetModel: 'm' },
    );
    expect(body.tools).toEqual([
      { type: 'function', function: { name: 'keep', parameters: { type: 'object', properties: {} } } },
    ]);
  });

  it('flattens namespace tools into {namespace}__{name} functions and maps them', () => {
    const { body, toolNamespaceMap } = openaiResponsesToChat(
      base({
        tools: [
          { type: 'function', name: 'shell_command' },
          {
            type: 'namespace',
            name: 'mcp__sync_think_platform',
            description: 'Tools in the platform namespace.',
            tools: [
              {
                type: 'function',
                name: 'platform_context',
                description: 'Read the workspace context.',
                parameters: { type: 'object', properties: {} },
              },
              { type: 'function', name: 'file_list' },
            ],
          },
        ] as never,
      }),
      { targetModel: 'm' },
    );
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: { name: 'shell_command', parameters: { type: 'object', properties: {} } },
      },
      {
        type: 'function',
        function: {
          name: 'mcp__sync_think_platform__platform_context',
          description: 'Read the workspace context.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'mcp__sync_think_platform__file_list',
          parameters: { type: 'object', properties: {} },
        },
      },
    ]);
    expect(toolNamespaceMap.get('mcp__sync_think_platform__platform_context')).toEqual({
      fullName: 'mcp__sync_think_platform__platform_context',
      namespace: 'mcp__sync_think_platform',
      name: 'platform_context',
    });
    // Plain (non-namespaced) tools are not in the map.
    expect(toolNamespaceMap.get('shell_command')).toBeUndefined();
  });

  it('clamps overlong flattened namespace names to the 64-char function-name limit', () => {
    const { body, toolNamespaceMap } = openaiResponsesToChat(
      base({
        tools: [
          {
            type: 'namespace',
            name: 'mcp__very_long_namespace_name_here',
            tools: [{ type: 'function', name: 'a_very_long_sub_tool_name_that_would_overflow_the_limit' }],
          },
        ] as never,
      }),
      { targetModel: 'm' },
    );
    const name = (body.tools ?? [])[0];
    expect((name as { function: { name: string } }).function.name).toHaveLength(64);
    expect((name as { function: { name: string } }).function.name).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(toolNamespaceMap.size).toBe(1);
    const entry = [...toolNamespaceMap.values()][0];
    expect(entry.namespace).toBe('mcp__very_long_namespace_name_here');
    expect(entry.name).toBe('a_very_long_sub_tool_name_that_would_overflow_the_limit');
  });

  it('drops nameless sub-tools inside a namespace wrapper', () => {
    const { body, toolNamespaceMap } = openaiResponsesToChat(
      base({
        tools: [
          {
            type: 'namespace',
            name: 'mcp__sync_think_platform',
            tools: [
              { type: 'function', name: '' },
              { type: 'function', name: 'agent_list' },
            ],
          },
        ] as never,
      }),
      { targetModel: 'm' },
    );
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: { name: 'mcp__sync_think_platform__agent_list', parameters: { type: 'object', properties: {} } },
      },
    ]);
    expect(toolNamespaceMap.size).toBe(1);
  });

  it('maps auto/none/required tool choices verbatim', () => {
    expect(openaiResponsesToChat(base({ tool_choice: { type: 'auto' } }), { targetModel: 'm' }).body.tool_choice).toBe('auto');
    expect(openaiResponsesToChat(base({ tool_choice: { type: 'none' } }), { targetModel: 'm' }).body.tool_choice).toBe('none');
    expect(openaiResponsesToChat(base({ tool_choice: { type: 'required' } }), { targetModel: 'm' }).body.tool_choice).toBe(
      'required',
    );
  });

  it('drops previous_response_id (no Chat equivalent) and does not crash', () => {
    const { body } = openaiResponsesToChat(
      base({ previous_response_id: 'resp_abc' }),
      { targetModel: 'm' },
    );
    expect(body.messages[0]).toEqual({ role: 'user', content: 'hello' });
  });
});
