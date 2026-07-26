import { describe, expect, it } from 'vitest';
import type { Event } from '@sync-think/shared';
import {
  buildChatMessagesFromEvents,
  buildCompactSummaryUserPrompt,
  buildLocalCompactSummary,
  collectThreadChatHistory,
  evaluateToolLoopGuard,
  foldLongToolOutputsInMessages,
  foldToolOutputText,
  isChatToolAllowed,
  isMeaningfulCompactReduction,
  mcpToolsToProviderSchemas,
  normalizeChatExecutionMode,
  parseMcpProviderToolName,
  splitHistoryForCompact,
  toolsForExecutionMode,
  wrapModelCompactSummary,
} from './chat-tools.js';

function event(
  partial: Partial<Event> & Pick<Event, 'id' | 'type' | 'sequence' | 'payload'>,
): Event {
  return {
    workspaceId: 'ws_1' as Event['workspaceId'],
    category: 'message',
    occurredAt: '2026-07-23T00:00:00.000Z',
    ...partial,
  } as Event;
}

describe('buildChatMessagesFromEvents', () => {
  it('includes prior user and assistant turns for the same thread', () => {
    const events = [
      event({
        id: 'e1' as Event['id'],
        sequence: 1,
        type: 'message.appended',
        payload: { threadId: 'th_1', role: 'user', text: '第一句' },
      }),
      event({
        id: 'e2' as Event['id'],
        sequence: 2,
        type: 'run.completed',
        payload: { threadId: 'th_1', assistantText: '上一轮回答' },
      }),
      event({
        id: 'e3' as Event['id'],
        sequence: 3,
        type: 'message.appended',
        payload: { threadId: 'th_1', role: 'user', text: '第二句' },
      }),
    ];
    const messages = buildChatMessagesFromEvents(events, 'th_1', '第二句');
    expect(messages.map((m) => `${m.role}:${String(m.content)}`)).toEqual([
      'user:第一句',
      'assistant:上一轮回答',
      'user:第二句',
    ]);
  });

  it('ignores other threads and appends latest user text when missing', () => {
    const events = [
      event({
        id: 'e1' as Event['id'],
        sequence: 1,
        type: 'message.appended',
        payload: { threadId: 'th_other', role: 'user', text: '别人的话' },
      }),
    ];
    const messages = buildChatMessagesFromEvents(events, 'th_1', '当前问题');
    expect(messages).toEqual([{ role: 'user', content: '当前问题' }]);
  });

  it('attaches latest images as multimodal content parts', () => {
    const messages = buildChatMessagesFromEvents([], 'th_1', '看这张图', [
      {
        name: 'shot.png',
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,abc',
      },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe('user');
    expect(messages[0]!.content).toEqual([
      { type: 'text', text: '看这张图' },
      { type: 'image', imageUrl: 'data:image/png;base64,abc' },
    ]);
  });

  it('honors the latest context.compacted boundary when building provider history', () => {
    const events = [
      event({
        id: 'e1' as Event['id'],
        sequence: 1,
        type: 'message.appended',
        payload: { threadId: 'th_1', role: 'user', text: '很早之前的问题' },
      }),
      event({
        id: 'e2' as Event['id'],
        sequence: 2,
        type: 'run.completed',
        payload: { threadId: 'th_1', assistantText: '很早之前的回答' },
      }),
      event({
        id: 'e3' as Event['id'],
        sequence: 3,
        category: 'system',
        type: 'context.compacted',
        payload: {
          threadId: 'th_1',
          summaryText: '[context compact]\nEarlier conversation was compacted.',
        },
      }),
      event({
        id: 'e4' as Event['id'],
        sequence: 4,
        type: 'message.appended',
        payload: { threadId: 'th_1', role: 'user', text: '压缩后的新问题' },
      }),
    ];
    const messages = buildChatMessagesFromEvents(events, 'th_1', '压缩后的新问题');
    expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(String(messages[0]!.content)).toContain('[context compact]');
    expect(messages[1]).toEqual({ role: 'user', content: '压缩后的新问题' });
  });
});

describe('local context compact', () => {
  it('folds older turns into a summary and keeps recent messages', () => {
    const messages = Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      // Long enough that truncating older turns reduces total tokens.
      content: `turn-${index} ${'x'.repeat(800)}`,
      sequence: index + 1,
    }));
    const result = buildLocalCompactSummary({
      messages,
      keepRecent: 4,
    });
    expect(result.foldedCount).toBe(8);
    expect(result.keptMessages).toHaveLength(4);
    expect(result.summaryText).toContain('[context compact]');
    expect(result.afterTokens).toBeLessThan(result.beforeTokens);
  });

  it('marks auto-compact when occupancy exceeds the threshold', () => {
    const long = '字'.repeat(4000);
    const events = [
      event({
        id: 'e1' as Event['id'],
        sequence: 1,
        type: 'message.appended',
        payload: { threadId: 'th_1', role: 'user', text: long },
      }),
      event({
        id: 'e2' as Event['id'],
        sequence: 2,
        type: 'run.completed',
        payload: { threadId: 'th_1', assistantText: long },
      }),
    ];
    const history = collectThreadChatHistory(events, 'th_1', { contextWindow: 2000 });
    expect(history.shouldAutoCompact).toBe(true);
    expect(history.estimatedTokens).toBeGreaterThan(1000);
  });

  it('prefers real usedTokens for the auto-compact threshold', () => {
    const events = [
      event({
        id: 'e1' as Event['id'],
        sequence: 1,
        type: 'message.appended',
        payload: { threadId: 'th_1', role: 'user', text: 'short' },
      }),
    ];
    const low = collectThreadChatHistory(events, 'th_1', {
      contextWindow: 10_000,
      usedTokens: 1000,
    });
    expect(low.shouldAutoCompact).toBe(false);

    const high = collectThreadChatHistory(events, 'th_1', {
      contextWindow: 10_000,
      usedTokens: 7500,
    });
    expect(high.shouldAutoCompact).toBe(true);
  });

  it('rejects non-shrinking local summaries instead of clamping display', () => {
    const messages = Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `t${index}`,
      sequence: index + 1,
    }));
    const result = buildLocalCompactSummary({ messages, keepRecent: 4 });
    // Short turns produce a larger structured summary than the originals.
    expect(result.summaryText).toBe('');
    expect(result.foldedCount).toBe(0);
    expect(result.afterTokens).toBe(result.beforeTokens);
    expect(isMeaningfulCompactReduction(100, 95)).toBe(false);
    expect(isMeaningfulCompactReduction(100, 80)).toBe(true);
  });

  it('skips compact marker system messages when collecting history', () => {
    const events = [
      event({
        id: 'e1' as Event['id'],
        sequence: 1,
        type: 'message.appended',
        payload: { threadId: 'th_1', role: 'user', text: 'hello' },
      }),
      event({
        id: 'e2' as Event['id'],
        sequence: 2,
        type: 'message.appended',
        payload: {
          threadId: 'th_1',
          role: 'system',
          text: '上下文已压缩：折叠 3 条较早消息',
          compact: true,
          tone: 'info',
        },
      }),
    ];
    const history = collectThreadChatHistory(events, 'th_1');
    expect(history.messages.map((m) => m.content)).toEqual(['hello']);
  });

  it('splits history into older (to summarize) and recent (kept verbatim)', () => {
    const messages = Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `turn-${index}`,
      sequence: index + 1,
    }));
    const split = splitHistoryForCompact(messages, 4);
    expect(split.foldedCount).toBe(6);
    expect(split.older).toHaveLength(6);
    expect(split.keptMessages).toHaveLength(4);
    expect(split.keptMessages[0]!.content).toBe('turn-6');
  });

  it('builds Claude/NewMax-style model summary prompt from older turns', () => {
    const prompt = buildCompactSummaryUserPrompt([
      { role: 'user', content: '请实现压缩', sequence: 1 },
      { role: 'assistant', content: '好的，我会按 NewMax 方式做', sequence: 2 },
    ]);
    expect(prompt).toContain('Primary Request and Intent');
    expect(prompt).toContain('请实现压缩');
    expect(prompt).toContain('好的，我会按 NewMax 方式做');
    expect(prompt).toContain('Respond with TEXT ONLY');
  });

  it('wraps model summary with compact boundary and resume instruction', () => {
    const wrapped = wrapModelCompactSummary(
      [
        '1. Primary Request and Intent:',
        '   User asked to align compact with NewMax.',
        '9. Context for Continuing Work:',
        '   Implement model-generated summary path.',
      ].join('\n'),
    );
    expect(wrapped).toContain('[context compact]');
    expect(wrapped).toContain('Primary Request and Intent');
    expect(wrapped).toContain('Continue the conversation from where it left off');
  });

  it('folds long tool outputs with head/tail and keeps recent tool results', () => {
    const long = 'x'.repeat(5000);
    const short = 'ok';
    const foldedOne = foldToolOutputText(long, 2000);
    expect(foldedOne.folded).toBe(true);
    expect(foldedOne.text.length).toBeLessThan(long.length);
    expect(foldedOne.text).toContain('tool output folded');

    const result = foldLongToolOutputsInMessages(
      [
        { role: 'user', content: 'read' },
        { role: 'tool', toolCallId: 't1', content: long },
        { role: 'tool', toolCallId: 't2', content: long },
        { role: 'tool', toolCallId: 't3', content: short },
        { role: 'assistant', content: 'done' },
      ],
      { maxChars: 2000, keepRecent: 1 },
    );
    // Newest tool (t3) kept; older long tools folded.
    expect(result.foldedCount).toBe(2);
    expect(result.charsSaved).toBeGreaterThan(0);
    expect(result.messages[3]).toEqual({ role: 'tool', toolCallId: 't3', content: short });
    expect(String(result.messages[1]!.content)).toContain('tool output folded');
  });
});

describe('chat execution mode tool gating', () => {
  it('normalizes legacy aliases to the three product modes', () => {
    expect(normalizeChatExecutionMode('read-only')).toBe('ask');
    expect(normalizeChatExecutionMode('ask')).toBe('ask');
    expect(normalizeChatExecutionMode(undefined)).toBe('workspace');
    expect(normalizeChatExecutionMode('full')).toBe('full-access');
  });

  it('still exposes mutating tools under ask (they require user approval)', () => {
    const tools = toolsForExecutionMode('ask').map((t) => t.name);
    expect(tools).toEqual(
      expect.arrayContaining(['read_file', 'list_files', 'write_file', 'run_command']),
    );
    expect(isChatToolAllowed('ask', 'write_file')).toBe(true);
    expect(isChatToolAllowed('workspace', 'write_file')).toBe(true);
  });

  it('exposes network tools only when networkEnabled', () => {
    const off = toolsForExecutionMode('workspace').map((t) => t.name);
    expect(off).not.toContain('web_search');
    expect(off).not.toContain('web_fetch');
    expect(isChatToolAllowed('workspace', 'web_search')).toBe(false);

    const on = toolsForExecutionMode('workspace', { networkEnabled: true }).map((t) => t.name);
    expect(on).toEqual(expect.arrayContaining(['web_search', 'web_fetch', 'read_file']));
    expect(isChatToolAllowed('workspace', 'web_search', { networkEnabled: true })).toBe(true);

    const networkOnly = toolsForExecutionMode('workspace', {
      networkEnabled: true,
      includeProjectTools: false,
    }).map((t) => t.name);
    // update_task_plan is a UI-only tool that is always present; browser tools
    // ride on the 联网 switch alongside web_search / web_fetch.
    expect(networkOnly).toEqual([
      'update_task_plan',
      'web_search',
      'web_fetch',
      'browser_open',
      'browser_click',
      'browser_type',
      'browser_read',
      'browser_screenshot',
    ]);
  });

  it('update_task_plan: always exposed, never approval-gated, validates items', async () => {
    const { executeChatPlanTool, chatToolRequiresApproval } = await import('./chat-tools.js');
    // Always in the tool list, even offline / no project.
    const bare = toolsForExecutionMode('ask', { includeProjectTools: false }).map((t) => t.name);
    expect(bare).toContain('update_task_plan');
    // Read-only class: no approval in any mode.
    expect(chatToolRequiresApproval('ask', 'update_task_plan')).toBe(false);
    expect(chatToolRequiresApproval('workspace', 'update_task_plan')).toBe(false);
    expect(isChatToolAllowed('ask', 'update_task_plan')).toBe(true);
    // Valid plan echoes normalized items + progress counts.
    const ok = JSON.parse(
      executeChatPlanTool(
        JSON.stringify({
          items: [
            { title: '分析需求', status: 'completed' },
            { title: '实现功能', status: 'in_progress' },
            { title: '写测试', status: 'pending' },
          ],
        }),
      ),
    );
    expect(ok.ok).toBe(true);
    expect(ok.plan.total).toBe(3);
    expect(ok.plan.completed).toBe(1);
    // Invalid payloads fail gracefully.
    expect(JSON.parse(executeChatPlanTool('not json')).ok).toBe(false);
    expect(JSON.parse(executeChatPlanTool(JSON.stringify({ items: [] }))).ok).toBe(false);
  });

  it('browser_open: network-gated, http(s) only', async () => {
    const { executeChatBrowserTool, chatToolRequiresApproval } = await import('./chat-tools.js');
    // Only exposed with 联网 on.
    const off = toolsForExecutionMode('workspace').map((t) => t.name);
    expect(off).not.toContain('browser_open');
    expect(isChatToolAllowed('workspace', 'browser_open')).toBe(false);
    expect(isChatToolAllowed('workspace', 'browser_open', { networkEnabled: true })).toBe(true);
    // Display-only: never approval-gated.
    expect(chatToolRequiresApproval('ask', 'browser_open')).toBe(false);
    // URL validation.
    expect(JSON.parse(executeChatBrowserTool(JSON.stringify({ url: 'https://example.com' }))).ok).toBe(true);
    expect(JSON.parse(executeChatBrowserTool(JSON.stringify({ url: 'file:///etc/passwd' }))).ok).toBe(false);
    expect(JSON.parse(executeChatBrowserTool(JSON.stringify({ url: 'javascript:alert(1)' }))).ok).toBe(false);
    expect(JSON.parse(executeChatBrowserTool('broken')).ok).toBe(false);
  });

  it('browser command tools: network-gated, never approval-gated', async () => {
    const { chatToolRequiresApproval, CHAT_BROWSER_COMMAND_TOOL_NAMES } = await import(
      './chat-tools.js'
    );
    for (const name of ['browser_click', 'browser_type', 'browser_read', 'browser_screenshot']) {
      expect(CHAT_BROWSER_COMMAND_TOOL_NAMES.has(name)).toBe(true);
      // Hidden without 联网, exposed with it.
      expect(toolsForExecutionMode('workspace').map((t) => t.name)).not.toContain(name);
      expect(
        toolsForExecutionMode('workspace', { networkEnabled: true }).map((t) => t.name),
      ).toContain(name);
      expect(isChatToolAllowed('workspace', name)).toBe(false);
      expect(isChatToolAllowed('workspace', name, { networkEnabled: true })).toBe(true);
      // Operated in front of the user — display-class, no approval card in any mode.
      expect(chatToolRequiresApproval('ask', name)).toBe(false);
      expect(chatToolRequiresApproval('workspace', name)).toBe(false);
    }
    // browser_open is NOT a round-trip command tool.
    expect(CHAT_BROWSER_COMMAND_TOOL_NAMES.has('browser_open')).toBe(false);
  });

  it('validateChatBrowserCommand: click needs selector or x/y', async () => {
    const { validateChatBrowserCommand } = await import('./chat-tools.js');
    const bySelector = validateChatBrowserCommand(
      'browser_click',
      JSON.stringify({ selector: '#submit' }),
    );
    expect(bySelector).toEqual({
      ok: true,
      command: { action: 'browser_click', args: { selector: '#submit' } },
    });
    const byCoords = validateChatBrowserCommand('browser_click', JSON.stringify({ x: 10, y: 20 }));
    expect(byCoords.ok).toBe(true);
    if (byCoords.ok) expect(byCoords.command.args).toEqual({ x: 10, y: 20 });
    // Neither selector nor complete coordinates → clear error.
    expect(validateChatBrowserCommand('browser_click', JSON.stringify({ x: 10 })).ok).toBe(false);
    expect(validateChatBrowserCommand('browser_click', '{}').ok).toBe(false);
    expect(validateChatBrowserCommand('browser_click', 'not json').ok).toBe(false);
  });

  it('validateChatBrowserCommand: type needs selector + bounded text', async () => {
    const { validateChatBrowserCommand } = await import('./chat-tools.js');
    const ok = validateChatBrowserCommand(
      'browser_type',
      JSON.stringify({ selector: 'input[name=q]', text: 'hello' }),
    );
    expect(ok).toEqual({
      ok: true,
      command: { action: 'browser_type', args: { selector: 'input[name=q]', text: 'hello' } },
    });
    expect(validateChatBrowserCommand('browser_type', JSON.stringify({ text: 'x' })).ok).toBe(false);
    expect(
      validateChatBrowserCommand('browser_type', JSON.stringify({ selector: '#a' })).ok,
    ).toBe(false);
    expect(
      validateChatBrowserCommand(
        'browser_type',
        JSON.stringify({ selector: '#a', text: 'x'.repeat(5000) }),
      ).ok,
    ).toBe(false);
  });

  it('validateChatBrowserCommand: read selector optional, screenshot argless', async () => {
    const { validateChatBrowserCommand } = await import('./chat-tools.js');
    const whole = validateChatBrowserCommand('browser_read', '{}');
    expect(whole).toEqual({ ok: true, command: { action: 'browser_read', args: {} } });
    const scoped = validateChatBrowserCommand('browser_read', JSON.stringify({ selector: 'main' }));
    expect(scoped).toEqual({
      ok: true,
      command: { action: 'browser_read', args: { selector: 'main' } },
    });
    const shot = validateChatBrowserCommand('browser_screenshot', '{}');
    expect(shot).toEqual({ ok: true, command: { action: 'browser_screenshot', args: {} } });
    // Non-command tools are rejected outright.
    expect(validateChatBrowserCommand('browser_open', '{}').ok).toBe(false);
    expect(validateChatBrowserCommand('web_fetch', '{}').ok).toBe(false);
  });

  it('appends MCP extra tools and allows mcp__ names', () => {
    const tools = toolsForExecutionMode('workspace', {
      extraTools: [
        {
          name: 'mcp__srv1__echo',
          description: 'echo',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    }).map((t) => t.name);
    expect(tools).toContain('mcp__srv1__echo');
    expect(isChatToolAllowed('workspace', 'mcp__srv1__echo')).toBe(true);
    expect(parseMcpProviderToolName('mcp__srv1__echo')).toEqual({
      mcpServerId: 'srv1',
      toolName: 'echo',
    });
  });

  it('maps MCP server rows into provider schemas with dispatch', () => {
    const { tools, dispatch } = mcpToolsToProviderSchemas(
      [
        {
          id: 'mcp-1',
          name: 'Demo',
          tools: [
            {
              name: 'search',
              description: 'search things',
              inputSchemaJson: '{"type":"object","properties":{"q":{"type":"string"}}}',
            },
          ],
        },
      ],
      { maxTools: 8 },
    );
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toContain('search');
    expect(dispatch.get(tools[0]!.name)).toEqual({
      mcpServerId: 'mcp-1',
      toolName: 'search',
    });
  });
});

describe('evaluateToolLoopGuard', () => {
  it('does not force_final on the first all-unavailable batch', () => {
    const first = evaluateToolLoopGuard({
      toolLoopRound: 1,
      maxToolRounds: 12,
      completedResults: [
        {
          toolCallId: 't1',
          content: JSON.stringify({
            ok: false,
            code: 'COMMAND_UNAVAILABLE',
            command: 'rg',
            error: 'spawn rg ENOENT',
          }),
        },
      ],
    });
    expect(first.kind).toBe('continue');
    expect(first.stagnantRounds).toBe(1);
    expect(first.reason).toMatch(/list_files|read_file/);

    const second = evaluateToolLoopGuard({
      toolLoopRound: 2,
      maxToolRounds: 12,
      completedResults: [
        {
          toolCallId: 't2',
          content: JSON.stringify({
            ok: false,
            code: 'COMMAND_UNAVAILABLE',
            command: 'rg',
            error: 'spawn rg ENOENT',
          }),
        },
      ],
      seenFingerprints: first.seenFingerprints,
      stagnantRounds: first.stagnantRounds,
    });
    expect(second.kind).toBe('force_final');
  });

  it('treats different file paths as progress (not stagnant)', () => {
    const a = evaluateToolLoopGuard({
      toolLoopRound: 1,
      maxToolRounds: 12,
      completedResults: [
        {
          toolCallId: 't1',
          content: JSON.stringify({
            ok: true,
            message: 'File read completed',
            path: 'a.ts',
            content: 'export const a = 1',
          }),
        },
      ],
    });
    expect(a.kind).toBe('continue');
    expect(a.stagnantRounds).toBe(0);

    const b = evaluateToolLoopGuard({
      toolLoopRound: 2,
      maxToolRounds: 12,
      completedResults: [
        {
          toolCallId: 't2',
          content: JSON.stringify({
            ok: true,
            message: 'File read completed',
            path: 'b.ts',
            content: 'export const b = 2',
          }),
        },
      ],
      seenFingerprints: a.seenFingerprints,
      stagnantRounds: a.stagnantRounds,
    });
    expect(b.kind).toBe('continue');
    expect(b.stagnantRounds).toBe(0);
  });
});

describe('network tools', () => {
  it('blocks private hosts and runs web_fetch / web_search via fetchImpl', async () => {
    const { executeChatBuiltInTool } = await import('./chat-tools.js');

    const blocked = await executeChatBuiltInTool({
      toolCall: {
        id: 't1',
        name: 'web_fetch',
        argumentsJson: JSON.stringify({ url: 'http://127.0.0.1/secret' }),
      },
      networkEnabled: true,
    });
    expect(JSON.parse(blocked).ok).toBe(false);

    const fetchImpl = async (input: string | URL) => {
      const url = String(input);
      if (url.includes('api.duckduckgo.com')) {
        return new Response(
          JSON.stringify({
            Heading: 'Example',
            AbstractText: 'An example page',
            AbstractURL: 'https://example.com/',
            RelatedTopics: [{ Text: 'Foo - bar', FirstURL: 'https://example.com/foo' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('<html><body><h1>Hello</h1><p>World</p></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    };

    const search = await executeChatBuiltInTool({
      toolCall: {
        id: 't2',
        name: 'web_search',
        argumentsJson: JSON.stringify({ query: 'example', limit: 3 }),
      },
      networkEnabled: true,
      fetchImpl: fetchImpl as typeof fetch,
    });
    const searchJson = JSON.parse(search) as {
      ok: boolean;
      results: Array<{ url: string }>;
    };
    expect(searchJson.ok).toBe(true);
    expect(searchJson.results.length).toBeGreaterThan(0);

    const page = await executeChatBuiltInTool({
      toolCall: {
        id: 't3',
        name: 'web_fetch',
        argumentsJson: JSON.stringify({ url: 'https://example.com/' }),
      },
      networkEnabled: true,
      fetchImpl: fetchImpl as typeof fetch,
    });
    const pageJson = JSON.parse(page) as { ok: boolean; text: string };
    expect(pageJson.ok).toBe(true);
    expect(pageJson.text).toContain('Hello');
    expect(pageJson.text).toContain('World');

    const disabled = await executeChatBuiltInTool({
      toolCall: {
        id: 't4',
        name: 'web_search',
        argumentsJson: JSON.stringify({ query: 'x' }),
      },
      networkEnabled: false,
    });
    expect(JSON.parse(disabled).ok).toBe(false);
  });
});

describe('chatToolRequiresApproval', () => {
  it('requires approval only for mutating tools under ask', async () => {
    const { chatToolRequiresApproval } = await import('./chat-tools.js');
    expect(chatToolRequiresApproval('ask', 'write_file')).toBe(true);
    expect(chatToolRequiresApproval('ask', 'run_command')).toBe(true);
    expect(chatToolRequiresApproval('ask', 'read_file')).toBe(false);
    expect(chatToolRequiresApproval('workspace', 'write_file')).toBe(false);
  });

  it('gates agent mutations (create/update/archive) outside full-access', async () => {
    const { chatToolRequiresApproval } = await import('./chat-tools.js');
    for (const tool of ['create_agent', 'update_agent', 'archive_agent']) {
      expect(chatToolRequiresApproval('ask', tool)).toBe(true);
      expect(chatToolRequiresApproval('workspace', tool)).toBe(true);
      expect(chatToolRequiresApproval('full-access', tool)).toBe(false);
    }
    // read-only agent tool never needs approval
    expect(chatToolRequiresApproval('ask', 'list_agent_resources')).toBe(false);
  });
});

describe('agent tool schemas', () => {
  it('exposes update_agent and archive_agent alongside create_agent', async () => {
    const { CHAT_AGENT_TOOL_SCHEMAS, CHAT_AGENT_TOOL_NAMES, CHAT_AGENT_MUTATING_TOOL_NAMES } =
      await import('./chat-tools.js');
    const names = CHAT_AGENT_TOOL_SCHEMAS.map((t) => t.name);
    expect(names).toContain('create_agent');
    expect(names).toContain('update_agent');
    expect(names).toContain('archive_agent');
    expect(names).toContain('list_agent_resources');
    expect(CHAT_AGENT_TOOL_NAMES.has('update_agent')).toBe(true);
    expect(CHAT_AGENT_TOOL_NAMES.has('archive_agent')).toBe(true);
    expect(CHAT_AGENT_MUTATING_TOOL_NAMES.has('update_agent')).toBe(true);
    expect(CHAT_AGENT_MUTATING_TOOL_NAMES.has('archive_agent')).toBe(true);
    expect(CHAT_AGENT_MUTATING_TOOL_NAMES.has('list_agent_resources')).toBe(false);
  });
});

describe('summarizeToolCallForApproval — agent mutations', () => {
  it('summarizes update_agent with a changed-field diff', async () => {
    const { summarizeToolCallForApproval } = await import('./chat-tools.js');
    const summary = summarizeToolCallForApproval(
      'update_agent',
      JSON.stringify({
        agent: '产品写手',
        name: '中文产品写手',
        persona: '你是资深中文产品文案专家',
        skillIds: ['sv-1', 'sv-2'],
      }),
    );
    expect(summary.title).toContain('修改智能体');
    expect(summary.title).toContain('产品写手');
    expect(summary.detail).toContain('名称 → 中文产品写手');
    expect(summary.detail).toContain('人设 →');
    expect(summary.detail).toContain('Skill 绑定 → 2 个');
  });

  it('notes when update_agent has no changed fields', async () => {
    const { summarizeToolCallForApproval } = await import('./chat-tools.js');
    const summary = summarizeToolCallForApproval(
      'update_agent',
      JSON.stringify({ agent: 'agent-1' }),
    );
    expect(summary.detail).toContain('未指定任何变更字段');
  });

  it('summarizes archive_agent with restore hint and reason', async () => {
    const { summarizeToolCallForApproval } = await import('./chat-tools.js');
    const summary = summarizeToolCallForApproval(
      'archive_agent',
      JSON.stringify({ agent: '旧写手', reason: '已被新版替代' }),
    );
    expect(summary.title).toContain('归档智能体');
    expect(summary.title).toContain('旧写手');
    expect(summary.detail).toContain('可在智能体库恢复');
    expect(summary.detail).toContain('已被新版替代');
  });
});

describe('chatToolDeniedMessage — agent mutations', () => {
  it('returns per-tool denial guidance without retry', async () => {
    const { chatToolDeniedMessage } = await import('./chat-tools.js');
    expect(chatToolDeniedMessage('workspace', 'update_agent', 'denied')).toContain('修改智能体');
    expect(chatToolDeniedMessage('workspace', 'archive_agent', 'denied')).toContain('归档智能体');
    expect(chatToolDeniedMessage('workspace', 'create_agent', 'denied')).toContain('创建智能体');
    expect(chatToolDeniedMessage('workspace', 'update_agent', 'blocked')).toContain('需要用户先批准');
  });
});

describe('skill tools (capability center)', () => {
  it('exposes skill tools alongside agent tools when agent tools are enabled', async () => {
    const { toolsForExecutionMode, CHAT_SKILL_TOOL_NAMES } = await import('./chat-tools.js');
    const tools = toolsForExecutionMode('workspace', {
      includeProjectTools: false,
      includeAgentTools: true,
    });
    const names = tools.map((t) => t.name);
    for (const name of ['list_skills', 'read_skill', 'create_skill', 'update_skill', 'delete_skill']) {
      expect(names).toContain(name);
      expect(CHAT_SKILL_TOOL_NAMES.has(name)).toBe(true);
    }
    // Not exposed when agent tools are off.
    const withoutAgent = toolsForExecutionMode('workspace', {
      includeProjectTools: false,
      includeAgentTools: false,
    });
    expect(withoutAgent.map((t) => t.name)).not.toContain('create_skill');
  });

  it('gates skill mutations outside full-access; read tools stay free', async () => {
    const { chatToolRequiresApproval } = await import('./chat-tools.js');
    for (const tool of ['create_skill', 'update_skill', 'delete_skill']) {
      expect(chatToolRequiresApproval('ask', tool)).toBe(true);
      expect(chatToolRequiresApproval('workspace', tool)).toBe(true);
      expect(chatToolRequiresApproval('full-access', tool)).toBe(false);
    }
    expect(chatToolRequiresApproval('ask', 'list_skills')).toBe(false);
    expect(chatToolRequiresApproval('ask', 'read_skill')).toBe(false);
  });

  it('summarizes create_skill / update_skill from SKILL.md frontmatter', async () => {
    const { summarizeToolCallForApproval } = await import('./chat-tools.js');
    const skillMd = [
      '---',
      'name: release-notes',
      'description: 生成发布说明',
      'version: 1.2.0',
      'allowed-tools: ["read-file"]',
      '---',
      '',
      '写发布说明时先列变更再列风险。',
    ].join('\n');
    const created = summarizeToolCallForApproval('create_skill', JSON.stringify({ skillMd }));
    expect(created.title).toContain('创建 Skill');
    expect(created.title).toContain('release-notes');
    expect(created.detail).toContain('版本 1.2.0');
    expect(created.detail).toContain('不执行脚本');
    const updated = summarizeToolCallForApproval('update_skill', JSON.stringify({ skillMd }));
    expect(updated.title).toContain('更新 Skill');
  });

  it('summarizes delete_skill with the version id and blocker hint', async () => {
    const { summarizeToolCallForApproval } = await import('./chat-tools.js');
    const summary = summarizeToolCallForApproval(
      'delete_skill',
      JSON.stringify({ skillVersionId: 'sv-123', reason: '已过时' }),
    );
    expect(summary.title).toContain('卸载 Skill');
    expect(summary.detail).toContain('sv-123');
    expect(summary.detail).toContain('已过时');
  });

  it('returns per-tool denial guidance for skill mutations', async () => {
    const { chatToolDeniedMessage } = await import('./chat-tools.js');
    expect(chatToolDeniedMessage('workspace', 'create_skill', 'denied')).toContain('SKILL.md');
    expect(chatToolDeniedMessage('workspace', 'update_skill', 'denied')).toContain('SKILL.md');
    expect(chatToolDeniedMessage('workspace', 'delete_skill', 'denied')).toContain('卸载');
    expect(chatToolDeniedMessage('workspace', 'create_skill', 'blocked')).toContain('需要用户先批准');
  });
});

describe('team tools (team library)', () => {
  it('exposes team tools alongside agent tools when agent tools are enabled', async () => {
    const { toolsForExecutionMode, CHAT_TEAM_TOOL_NAMES, CHAT_AGENT_MUTATING_TOOL_NAMES } =
      await import('./chat-tools.js');
    const tools = toolsForExecutionMode('workspace', {
      includeProjectTools: false,
      includeAgentTools: true,
    });
    const names = tools.map((t) => t.name);
    for (const name of ['list_teams', 'create_team', 'update_team', 'delete_team']) {
      expect(names).toContain(name);
      expect(CHAT_TEAM_TOOL_NAMES.has(name)).toBe(true);
    }
    expect(CHAT_AGENT_MUTATING_TOOL_NAMES.has('create_team')).toBe(true);
    expect(CHAT_AGENT_MUTATING_TOOL_NAMES.has('update_team')).toBe(true);
    expect(CHAT_AGENT_MUTATING_TOOL_NAMES.has('delete_team')).toBe(true);
    expect(CHAT_AGENT_MUTATING_TOOL_NAMES.has('list_teams')).toBe(false);
    // Not exposed when agent tools are off.
    const withoutAgent = toolsForExecutionMode('workspace', {
      includeProjectTools: false,
      includeAgentTools: false,
    });
    expect(withoutAgent.map((t) => t.name)).not.toContain('create_team');
  });

  it('gates team mutations outside full-access; list_teams stays free', async () => {
    const { chatToolRequiresApproval } = await import('./chat-tools.js');
    for (const tool of ['create_team', 'update_team', 'delete_team']) {
      expect(chatToolRequiresApproval('ask', tool)).toBe(true);
      expect(chatToolRequiresApproval('workspace', tool)).toBe(true);
      expect(chatToolRequiresApproval('full-access', tool)).toBe(false);
    }
    expect(chatToolRequiresApproval('ask', 'list_teams')).toBe(false);
    expect(isChatToolAllowed('workspace', 'list_teams')).toBe(true);
    expect(isChatToolAllowed('workspace', 'create_team')).toBe(true);
  });

  it('summarizes create_team with strategy, member count, and mission', async () => {
    const { summarizeToolCallForApproval } = await import('./chat-tools.js');
    const summary = summarizeToolCallForApproval(
      'create_team',
      JSON.stringify({
        name: '交付小队',
        mission: '端到端交付需求',
        strategy: 'parallel',
        members: [{ agent: 'agent-1' }, { agent: 'agent-2', title: '前端负责人' }],
      }),
    );
    expect(summary.title).toContain('创建小队');
    expect(summary.title).toContain('交付小队');
    expect(summary.detail).toContain('策略：并行');
    expect(summary.detail).toContain('成员：2 个');
    expect(summary.detail).toContain('端到端交付需求');
  });

  it('summarizes update_team with a changed-field diff', async () => {
    const { summarizeToolCallForApproval } = await import('./chat-tools.js');
    const summary = summarizeToolCallForApproval(
      'update_team',
      JSON.stringify({
        team: '交付小队',
        name: '全栈交付小队',
        strategy: 'serial',
        members: [{ agent: 'agent-1' }],
      }),
    );
    expect(summary.title).toContain('修改小队');
    expect(summary.title).toContain('交付小队');
    expect(summary.detail).toContain('名称 → 全栈交付小队');
    expect(summary.detail).toContain('策略 → 串行');
    expect(summary.detail).toContain('成员 → 1 个');

    const empty = summarizeToolCallForApproval('update_team', JSON.stringify({ team: 'team-1' }));
    expect(empty.detail).toContain('未指定任何变更字段');
  });

  it('summarizes delete_team with blocker hint and reason', async () => {
    const { summarizeToolCallForApproval } = await import('./chat-tools.js');
    const summary = summarizeToolCallForApproval(
      'delete_team',
      JSON.stringify({ team: '旧小队', reason: '职责已合并' }),
    );
    expect(summary.title).toContain('删除小队');
    expect(summary.title).toContain('旧小队');
    expect(summary.detail).toContain('仍被对话引用');
    expect(summary.detail).toContain('职责已合并');
  });

  it('returns per-tool denial guidance for team mutations', async () => {
    const { chatToolDeniedMessage } = await import('./chat-tools.js');
    expect(chatToolDeniedMessage('workspace', 'create_team', 'denied')).toContain('创建小队');
    expect(chatToolDeniedMessage('workspace', 'update_team', 'denied')).toContain('修改小队');
    expect(chatToolDeniedMessage('workspace', 'delete_team', 'denied')).toContain('删除小队');
    expect(chatToolDeniedMessage('workspace', 'create_team', 'blocked')).toContain('需要用户先批准');
  });
});
