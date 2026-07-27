import { describe, expect, it } from 'vitest';
import {
  parseBindWorkspaceFolderPayload,
  parseCreateTaskPayload,
  parseCreateWorkspacePayload,
  parseConversationListMessagesPayload,
  parseConversationGetRunProcessPayload,
  parseSubscribeConversationTransientStreamPayload,
  parseUnsubscribeConversationTransientStreamPayload,
} from './command-validation.js';

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
