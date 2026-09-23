import { describe, expect, it } from 'vitest';
import {
  parseConversationRunCancelPayload,
  parseRunGraphPayload,
  parseRunMutationPayload,
} from './run-control-payloads.js';

const scope = {
  workspaceId: 'workspace-1',
  taskId: 'task-1',
  runId: 'run-1',
};

describe('Run control payload validation', () => {
  it('preserves the existing shape-overloaded cancel payload', () => {
    expect(parseConversationRunCancelPayload({ runId: 'run-1' })).toEqual({ runId: 'run-1' });
    expect(
      parseConversationRunCancelPayload({ ...scope, expectedTaskVersion: 3 }),
    ).toMatchObject({ ...scope, expectedTaskVersion: 3 });
  });

  it('accepts exact graph and mutation scopes', () => {
    expect(parseRunGraphPayload(scope)).toEqual(scope);
    expect(parseRunMutationPayload({ ...scope, expectedTaskVersion: 3 })).toEqual({
      ...scope,
      expectedTaskVersion: 3,
    });
  });

  it('rejects incomplete graph and mutation scopes', () => {
    expect(() => parseRunGraphPayload({ runId: 'run-1' })).toThrow(/Invalid run-graph/);
    expect(() => parseRunMutationPayload({ ...scope, expectedTaskVersion: -1 })).toThrow(
      /Invalid run-mutation/,
    );
  });

  it('preserves cancel validation while rejecting secret-like scoped mutations', () => {
    expect(() => parseConversationRunCancelPayload({ runId: '' })).toThrow(/Invalid cancel-run/);
    expect(() =>
      parseRunMutationPayload({ ...scope, expectedTaskVersion: 3, accessToken: 'plaintext' }),
    ).toThrow(/secret-like|Invalid run-mutation/);
  });
});
