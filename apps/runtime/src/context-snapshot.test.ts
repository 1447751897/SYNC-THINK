import type { ProviderMessage, ProviderToolSchema } from '@sync-think/adapters';
import { describe, expect, it } from 'vitest';
import {
  ContextSnapshotBuilder,
  LANGUAGE_FOLLOW_PROMPT,
  selectRecentMessagesWithinBudget,
} from './context-snapshot.js';

describe('LANGUAGE_FOLLOW_PROMPT', () => {
  it('asks the model to follow the user message language for thinking and replies', () => {
    expect(LANGUAGE_FOLLOW_PROMPT).toContain('same language as the user');
    expect(LANGUAGE_FOLLOW_PROMPT).toContain('Chinese');
    expect(LANGUAGE_FOLLOW_PROMPT).toContain('English');
    expect(LANGUAGE_FOLLOW_PROMPT).toContain('用户用中文就用中文');
    expect(LANGUAGE_FOLLOW_PROMPT).toContain('用英文就用英文');
  });
});

describe('ContextSnapshotBuilder', () => {
  it('builds one provider snapshot and a matching status projection', () => {
    const tools: ProviderToolSchema[] = [
      { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } },
    ];
    const messages: ProviderMessage[] = [
      { role: 'user', content: '之前的问题' },
      { role: 'assistant', content: '之前的回答' },
      { role: 'user', content: '当前问题' },
    ];
    const snapshot = new ContextSnapshotBuilder().build({
      modelId: 'model-1',
      contextWindow: 1000,
      systemInstructions: ['SYSTEM BASE'],
      agentInstructions: ['AGENT PERSONA', 'SKILL BODY'],
      projectContext: [
        'Project folder: D:/repo',
        'Task goal: ship S5',
        'Acceptance: request matches UI',
      ],
      compactSummary: 'Earlier work summary',
      messages,
      tools,
      sources: [
        {
          id: 'task-goal:t1',
          kind: 'task-goal',
          section: 'project',
          disposition: 'included',
          content: 'Task goal: ship S5',
        },
        {
          id: 'acceptance:t1',
          kind: 'acceptance-criteria',
          section: 'project',
          disposition: 'included',
          content: 'Acceptance: request matches UI',
        },
        { id: 'memory:m1', kind: 'project-memory', section: 'project', disposition: 'audit-only' },
        {
          id: 'skill:s1',
          kind: 'skill-definition',
          section: 'agent',
          disposition: 'included',
          content: 'SKILL BODY',
        },
        {
          id: 'tool:read_file',
          kind: 'tool-schema',
          section: 'tools',
          disposition: 'included',
          toolName: 'read_file',
        },
      ],
    });

    expect(snapshot.providerRequest.systemPrompt).toContain('SYSTEM BASE');
    expect(snapshot.providerRequest.systemPrompt).toContain('Task goal: ship S5');
    expect(snapshot.providerRequest.systemPrompt).toContain('Acceptance: request matches UI');
    expect(snapshot.providerRequest.systemPrompt).toContain('SKILL BODY');
    expect(snapshot.providerRequest.messages).toEqual(messages);
    expect(snapshot.providerRequest.tools).toEqual(tools);    expect(snapshot.status.sections.map((section) => section.type)).toEqual([
      'system',
      'agent',
      'project',
      'summary',
      'messages',
      'tools',
    ]);
    expect(snapshot.status.estimatedUsedTokens).toBe(
      snapshot.status.sections.reduce((sum, section) => sum + section.tokens, 0),
    );
    expect(snapshot.status.usageRatio).toBe(snapshot.status.estimatedUsedTokens / 1000);
    expect(snapshot.sources.find((source) => source.id === 'memory:m1')?.disposition).toBe(
      'audit-only',
    );
    expect(JSON.stringify(snapshot.status)).not.toContain('SYSTEM BASE');
    expect(JSON.stringify(snapshot.status)).not.toContain('reasoning');
  });

  it('rejects included sources that do not exist in the provider payload', () => {
    try {
      new ContextSnapshotBuilder().build({
        modelId: 'model-1',
        contextWindow: 1000,
        systemInstructions: [],
        agentInstructions: [],
        projectContext: [],
        messages: [],
        tools: [],
        sources: [
          {
            id: 'task-goal:t1',
            kind: 'task-goal',
            section: 'project',
            disposition: 'included',
            content: 'missing goal',
          },
        ],
      });
      throw new Error('expected context snapshot invariant failure');
    } catch (error) {
      expect(error).toMatchObject({
        name: 'ContextSnapshotInvariantError',
        failureClass: 'protocol',
      });
      expect(error).toHaveProperty('message', expect.stringMatching(/included source/i));
    }
  });

  it('matches multiline quoted message sources against structured string content', () => {
    const userText = [
      '使用 Computer Use 操作标题包含“SYNC THINK Desktop Handoff Fixture [manual]”的窗口。',
      '先枚举并检查窗口，再解析 automationId 为 InputText、controlType 为 Edit 的元素，',
      '最后把值设置为 "manual-test"。',
    ].join('\n');

    expect(() =>
      new ContextSnapshotBuilder().build({
        modelId: 'model-1',
        contextWindow: 1000,
        systemInstructions: [],
        agentInstructions: [],
        projectContext: [],
        messages: [{ role: 'user', content: userText }],
        tools: [],
        sources: [
          {
            id: 'message:multiline',
            kind: 'message-excerpt',
            section: 'messages',
            disposition: 'included',
            content: userText,
          },
        ],
      }),
    ).not.toThrow();
  });

  it('matches message sources against text parts in multimodal content', () => {
    const userText = '打开 https://www.4399.com/\n然后读取页面标题。';

    expect(() =>
      new ContextSnapshotBuilder().build({
        modelId: 'model-1',
        contextWindow: 1000,
        systemInstructions: [],
        agentInstructions: [],
        projectContext: [],
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: userText },
              { type: 'image', imageUrl: 'data:image/png;base64,fixture' },
            ],
          },
        ],
        tools: [],
        sources: [
          {
            id: 'message:multimodal',
            kind: 'message-excerpt',
            section: 'messages',
            disposition: 'included',
            content: userText,
          },
        ],
      }),
    ).not.toThrow();
  });

  it('uses the same estimate for the 70 percent compact threshold', () => {
    const snapshot = new ContextSnapshotBuilder().build({
      modelId: 'model-1',
      contextWindow: 10,
      systemInstructions: ['12345678901234567890'],
      agentInstructions: [],
      projectContext: [],
      messages: [{ role: 'user', content: '12345678901234567890' }],
      tools: [],
      sources: [],
    });
    expect(snapshot.status.shouldAutoCompact).toBe(
      snapshot.status.estimatedUsedTokens / snapshot.status.contextWindow >= 0.7,
    );
  });
});

describe('selectRecentMessagesWithinBudget', () => {
  it('selects the newest complete messages by token budget instead of a fixed count', () => {
    const messages: ProviderMessage[] = [
      { role: 'user', content: 'old '.repeat(100) },
      { role: 'assistant', content: 'middle' },
      { role: 'user', content: 'newest' },
    ];
    expect(selectRecentMessagesWithinBudget(messages, 8)).toEqual([
      { role: 'assistant', content: 'middle' },
      { role: 'user', content: 'newest' },
    ]);
  });
});
