import { describe, expect, it } from 'vitest';
import { isAgentConversation } from './conversation-surface.js';

describe('conversation surface ownership', () => {
  it.each(['agent', 'team'] as const)('routes legacy %s chats to the agent space', track => {
    expect(isAgentConversation({ track })).toBe(true);
  });
  it.each(['direct', 'group'] as const)('routes %s even when legacy track metadata says model', collaborationKind => {
    expect(isAgentConversation({ track: 'model', collaborationKind })).toBe(true);
  });
  it('keeps both normal and agent-enabled model conversations in the workbench', () => {
    expect(isAgentConversation({ track: 'model' })).toBe(false);
    expect(isAgentConversation({ track: 'model', collaborationKind: 'model' })).toBe(false);
  });
});
