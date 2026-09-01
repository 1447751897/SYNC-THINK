import { describe, expect, it } from 'vitest';
import { MAX_SKILL_SELECTION_ITEMS } from '@sync-think/protocol';
import {
  parseBindWorkspaceFolderPayload,
  parseCreateTaskPayload,
  parseCreateWorkspacePayload,
  parseConversationListMessagesPayload,
  parseConversationGetRunProcessPayload,
  parseSubscribeConversationTransientStreamPayload,
  parseUnsubscribeConversationTransientStreamPayload,
  parseAppendMessagePayload,
  parseImportSkillPayload,
  parseImportRemoteSkillPayload,
  parseRegisterRemoteMcpPayload,
  parseListSkillsPayload,
} from './command-validation.js';

describe('Skill metadata list validation', () => {
  it('normalizes exact immutable ids independently from the per-turn selection limit', () => {
    expect(
      parseListSkillsPayload({
        skillVersionIds: [' skill-b ', 'skill-b', 'skill-a'],
      })?.skillVersionIds,
    ).toEqual(['skill-b', 'skill-a']);
    expect(
      parseListSkillsPayload({
        skillVersionIds: Array.from({ length: 64 }, (_, index) => `skill-${index}`),
      })?.skillVersionIds,
    ).toHaveLength(64);
  });

  it('rejects malformed or oversized exact metadata queries', () => {
    expect(parseListSkillsPayload({ skillVersionIds: [''] })).toBeUndefined();
    expect(
      parseListSkillsPayload({
        skillVersionIds: Array.from({ length: 65 }, (_, index) => `skill-${index}`),
      }),
    ).toBeUndefined();
  });
});

describe('Skill import lineage validation', () => {
  const skillMd = '---\nname: market-skill\n---\nBody';

  it('accepts bounded market and derived lineage metadata', () => {
    expect(
      parseImportSkillPayload({
        skillMd,
        originType: 'market',
        originRef: ' market://skills/market-skill ',
      }),
    ).toMatchObject({
      skillMd,
      originType: 'market',
      originRef: 'market://skills/market-skill',
    });
    expect(
      parseImportSkillPayload({
        skillMd,
        originType: 'derived',
        originRef: 'market://skills/market-skill',
        derivedFromSkillVersionId: ' market-version ',
        skillId: ' skill-market ',
      }),
    ).toMatchObject({
      originType: 'derived',
      derivedFromSkillVersionId: 'market-version',
      skillId: 'skill-market',
    });
  });

  it('rejects incomplete derived metadata and unknown fields', () => {
    expect(parseImportSkillPayload({ skillMd, originType: 'derived' })).toBeUndefined();
    expect(parseImportSkillPayload({ skillMd, extra: true })).toBeUndefined();
  });
});

describe('remote capability validation', () => {
  it('normalizes remote Skill and MCP payloads without exposing alternate key fields', () => {
    expect(
      parseImportRemoteSkillPayload({
        url: 'https://example.test/SKILL.md',
        originRef: ' source://remote-skill ',
      }),
    ).toMatchObject({
      url: 'https://example.test/SKILL.md',
      originRef: 'source://remote-skill',
    });
    expect(
      parseRegisterRemoteMcpPayload({
        name: ' Remote MCP ',
        endpoint: 'https://mcp.example.test/rpc',
        apiKey: 'secret-value',
      }),
    ).toMatchObject({
      name: 'Remote MCP',
      endpoint: 'https://mcp.example.test/rpc',
      apiKey: 'secret-value',
    });
  });

  it('rejects non-http URLs, conflicting key aliases, and unknown fields', () => {
    expect(parseImportRemoteSkillPayload({ url: 'file:///tmp/SKILL.md' })).toBeUndefined();
    expect(
      parseRegisterRemoteMcpPayload({
        name: 'Remote MCP',
        endpoint: 'https://mcp.example.test/rpc',
        key: 'first',
        apiKey: 'second',
      }),
    ).toBeUndefined();
    expect(
      parseRegisterRemoteMcpPayload({
        name: 'Remote MCP',
        endpoint: 'https://mcp.example.test/rpc',
        unknown: true,
      }),
    ).toBeUndefined();
  });
});

describe('append message per-turn Skill validation', () => {
  const base = {
    threadId: 'thread-1',
    expectedTaskVersion: 0,
    role: 'user' as const,
    text: 'hello',
  };

  it('normalizes empty, duplicate, and bounded exact selections', () => {
    expect(parseAppendMessagePayload({ ...base, skillVersionIds: [] })?.skillVersionIds).toEqual(
      [],
    );
    expect(
      parseAppendMessagePayload({
        ...base,
        skillVersionIds: [' skill-b ', 'skill-b', 'skill-a'],
      })?.skillVersionIds,
    ).toEqual(['skill-b', 'skill-a']);
  });

  it('rejects malformed or oversized selections', () => {
    expect(parseAppendMessagePayload({ ...base, skillVersionIds: [''] })).toBeUndefined();
    expect(
      parseAppendMessagePayload({
        ...base,
        skillVersionIds: Array.from(
          { length: MAX_SKILL_SELECTION_ITEMS + 1 },
          (_, index) => `skill-${index}`,
        ),
      }),
    ).toBeUndefined();
  });

  it('accepts a boolean help mode flag and rejects malformed values', () => {
    expect(parseAppendMessagePayload({ ...base, helpMode: true })?.helpMode).toBe(true);
    expect(parseAppendMessagePayload({ ...base, helpMode: false })?.helpMode).toBe(false);
    expect(parseAppendMessagePayload({ ...base, helpMode: 'true' })).toBeUndefined();
  });
});

const validTask = {
  workspaceId: 'workspace-criteria-validation',
  title: 'Bound criteria',
  goal: 'Reject oversized acceptance criteria before persistence',
};

describe('create Task acceptance criteria validation', () => {
  it.each([
    { acceptanceCriteria: Array.from({ length: 65 }, (_, index) => `criterion-${index}`) },
    { acceptanceCriteria: ['x'.repeat(4_001)] },
    { acceptanceCriteria: Array.from({ length: 17 }, () => 'x'.repeat(4_000)) },
    { acceptanceCriteria: ['   '] },
  ])('rejects an out-of-bounds payload %#', ({ acceptanceCriteria }) => {
    expect(parseCreateTaskPayload({ ...validTask, acceptanceCriteria })).toBeUndefined();
  });

  it('returns normalized bounded criteria and allows an empty list', () => {
    expect(
      parseCreateTaskPayload({ ...validTask, acceptanceCriteria: ['  must pass  '] }),
    ).toMatchObject({ acceptanceCriteria: ['must pass'] });
    expect(parseCreateTaskPayload({ ...validTask, acceptanceCriteria: [] })).toMatchObject({
      acceptanceCriteria: [],
    });
  });
});

describe('conversation transient stream payload validation', () => {
  it('accepts bounded thread-local cursors and rejects unknown or invalid fields', () => {
    expect(parseSubscribeConversationTransientStreamPayload({ threadId: 'thread-1' })).toEqual({
      threadId: 'thread-1',
      afterStreamSequence: undefined,
    });
    expect(
      parseSubscribeConversationTransientStreamPayload({
        threadId: 'thread-1',
        afterStreamSequence: 42,
      }),
    ).toEqual({ threadId: 'thread-1', afterStreamSequence: 42 });
    expect(
      parseSubscribeConversationTransientStreamPayload({
        threadId: 'thread-1',
        afterStreamSequence: -1,
      }),
    ).toBeUndefined();
    expect(
      parseSubscribeConversationTransientStreamPayload({ threadId: 'thread-1', extra: true }),
    ).toBeUndefined();
    expect(
      parseUnsubscribeConversationTransientStreamPayload({ streamId: 'transient-1' }),
    ).toEqual({ streamId: 'transient-1' });
    expect(
      parseUnsubscribeConversationTransientStreamPayload({ streamId: 'transient-1', extra: true }),
    ).toBeUndefined();
  });
});

describe('conversation list messages payload validation', () => {
  it('accepts valid pagination and rejects unknown or invalid fields', () => {
    expect(parseConversationListMessagesPayload({ conversationId: 'conv-1' })).toEqual({
      conversationId: 'conv-1',
      beforeSequence: undefined,
      limit: undefined,
    });
    expect(
      parseConversationListMessagesPayload({
        conversationId: 'conv-1',
        beforeSequence: 0,
        limit: 100,
      }),
    ).toMatchObject({ beforeSequence: 0, limit: 100 });
    expect(parseConversationListMessagesPayload({ conversationId: 'conv-1', limit: 0 })).toBeUndefined();
    expect(parseConversationListMessagesPayload({ conversationId: 'conv-1', limit: 101 })).toBeUndefined();
    expect(parseConversationListMessagesPayload({ conversationId: 'conv-1', beforeSequence: -1 })).toBeUndefined();
    expect(parseConversationListMessagesPayload({ conversationId: 'conv-1', extra: true })).toBeUndefined();
  });
});

describe('conversation get run process payload validation', () => {
  it('accepts one bounded run id and rejects unknown fields', () => {
    expect(parseConversationGetRunProcessPayload({ runId: 'run-1' })).toEqual({ runId: 'run-1' });
    expect(parseConversationGetRunProcessPayload({ runId: '' })).toBeUndefined();
    expect(parseConversationGetRunProcessPayload({ runId: 'run-1', extra: true })).toBeUndefined();
  });
});

describe('optional project folder payload validation', () => {
  it('accepts a project without a folder and normalizes an optional folder', () => {
    expect(parseCreateWorkspacePayload({ name: '  Project Atlas  ' })).toEqual({
      name: 'Project Atlas',
      folderPath: undefined,
      allowedRoots: undefined,
    });
    expect(
      parseCreateWorkspacePayload({ name: 'Atlas', folderPath: ' D:/projects/atlas ' }),
    ).toMatchObject({ name: 'Atlas', folderPath: 'D:/projects/atlas' });
  });

  it('validates explicit folder binding before it reaches storage', () => {
    expect(
      parseBindWorkspaceFolderPayload({
        workspaceId: ' workspace-atlas ',
        folderPath: ' D:/projects/atlas ',
      }),
    ).toEqual({
      workspaceId: 'workspace-atlas',
      folderPath: 'D:/projects/atlas',
      allowedRoots: undefined,
    });
    expect(
      parseBindWorkspaceFolderPayload({ workspaceId: 'workspace-atlas', folderPath: '  ' }),
    ).toBeUndefined();
    expect(
      parseBindWorkspaceFolderPayload({ workspaceId: '', folderPath: 'D:/projects/atlas' }),
    ).toBeUndefined();
  });
});
