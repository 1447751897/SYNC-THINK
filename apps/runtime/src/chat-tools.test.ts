import { describe, expect, it } from 'vitest';
import type { Event } from '@sync-think/shared';
import {
  buildChatMessagesFromEvents,
  isChatToolAllowed,
  normalizeChatExecutionMode,
  toolsForExecutionMode,
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
    expect(networkOnly).toEqual(['web_search', 'web_fetch']);
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
});
