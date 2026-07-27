import type { ProviderMessage, ProviderToolSchema } from '@sync-think/adapters';
import { describe, expect, it } from 'vitest';
import { ContextSnapshotBuilder, selectRecentMessagesWithinBudget } from './context-snapshot.js';

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
      projectContext: ['Project folder: D:/repo', 'Task goal: ship S5', 'Acceptance: request matches UI'],
      compactSummary: 'Earlier work summary',
      messages,
      tools,
      sources: [
        { id: 'task-goal:t1', kind: 'task-goal', section: 'project', disposition: 'included', content: 'Task goal: ship S5' },
        { id: 'acceptance:t1', kind: 'acceptance-criteria', section: 'project', disposition: 'included', content: 'Acceptance: request matches UI' },
        { id: 'memory:m1', kind: 'project-memory', section: 'project', disposition: 'audit-only' },
        { id: 'skill:s1', kind: 'skill-definition', section: 'agent', disposition: 'included', content: 'SKILL BODY' },
        { id: 'tool:read_file', kind: 'tool-schema', section: 'tools', disposition: 'included', toolName: 'read_file' },
      ],
    });

    expect(snapshot.providerRequest.systemPrompt).toContain('SYSTEM BASE');
    expect(snapshot.providerRequest.systemPrompt).toContain('Task goal: ship S5');
    expect(snapshot.providerRequest.systemPrompt).toContain('Acceptance: request matches UI');
    expect(snapshot.providerRequest.systemPrompt).toContain('SKILL BODY');
    expect(snapshot.providerRequest.messages).toEqual(messages);
    expect(snapshot.providerRequest.tools).toEqual(tools);
    expect(snapshot.status.sections.map((section) => section.type)).toEqual([
      'system', 'agent', 'project', 'summary', 'messages', 'tools',
    ]);
    expect(snapshot.status.estimatedUsedTokens).toBe(
      snapshot.status.sections.reduce((sum, section) => sum + section.tokens, 0),
    );
    expect(snapshot.status.usageRatio).toBe(snapshot.status.estimatedUsedTokens / 1000);
    expect(snapshot.sources.find((source) => source.id === 'memory:m1')?.disposition).toBe('audit-only');
    expect(JSON.stringify(snapshot.status)).not.toContain('SYSTEM BASE');
    expect(JSON.stringify(snapshot.status)).not.toContain('reasoning');
  });

  it('rejects included sources that do not exist in the provider payload', () => {
    expect(() => new ContextSnapshotBuilder().build({
      modelId: 'model-1',
      contextWindow: 1000,
      systemInstructions: [],
      agentInstructions: [],
      projectContext: [],
      messages: [],
      tools: [],
      sources: [
        { id: 'task-goal:t1', kind: 'task-goal', section: 'project', disposition: 'included', content: 'missing goal' },
      ],
    })).toThrow(/included source/i);
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
