import { describe, expect, it, vi } from 'vitest';
import type { ThreadId, WorkspaceId } from '@sync-think/shared';
import {
  DelegationAdmissionService,
  type DelegationAdmissionRequest,
} from './delegation-admission.js';
import {
  DEFAULT_COLLABORATION_SETTINGS,
  type AgentCatalogCandidate,
} from './collaboration-policy.js';

const threadId = 'thread-a' as ThreadId;
const workspaceId = 'workspace-a' as WorkspaceId;
const candidate: AgentCatalogCandidate = {
  id: 'reviewer', name: 'Reviewer', avatar: '🔎', source: 'builtin',
  skillIds: ['review', '7'], mcpServerIds: ['git'], writePolicy: 'inherit',
};
const request: DelegationAdmissionRequest = {
  threadId, toolName: 'agent_run',
  argumentsJson: JSON.stringify({ task: ' Review changes ', agentId: ' reviewer ' }),
};

function fixture(settings: unknown = undefined, candidates = [candidate]) {
  const calls: string[] = [];
  const getSettings = vi.fn(() => { calls.push('settings'); return settings; });
  const getCatalog = vi.fn((_threadId: string) => {
    calls.push('catalog');
    return { workspaceId, candidates };
  });
  return {
    service: new DelegationAdmissionService({ getSettings, getCatalog }),
    calls, getSettings, getCatalog,
  };
}

describe('DelegationAdmissionService', () => {
  it.each([
    ['{', 'invalid JSON arguments'],
    ['', 'task is required'],
    ['null', 'task is required'],
    ['[]', 'task is required'],
    ['1', 'task is required'],
    ['{"task":"  "}', 'task is required'],
    ['{"task":4}', 'task is required'],
  ])('validates %s before reading host state', (argumentsJson, error) => {
    const f = fixture();
    expect(f.service.prepare({ ...request, argumentsJson })).toEqual({
      ok: false, response: { ok: false, error: `agent_delegate: ${error}.` },
    });
    expect(f.calls).toEqual([]);
  });

  it.each([
    { toolName: 'agent_delegate', reason: 'disabled' },
    { toolName: 'delegate_agent', reason: 'disabled' },
    { track: 'agent' as const, reason: 'track' },
    { track: 'team' as const, reason: 'track' },
    { depth: 2, childCount: 4, autoDelegationsThisTurn: 3, reason: 'depth' },
    { childCount: 4, autoDelegationsThisTurn: 3, reason: 'children' },
    { autoDelegationsThisTurn: 3, reason: 'turn-limit' },
  ])('rejects $reason before ID and catalog resolution', ({ reason, ...overrides }) => {
    const f = fixture();
    expect(f.service.prepare({
      ...request, ...overrides, argumentsJson: '{"task":"review"}',
    })).toEqual({
      ok: false,
      response: {
        ok: false, error: `agent_delegate: delegation rejected (${reason}).`,
        limits: DEFAULT_COLLABORATION_SETTINGS,
      },
    });
    expect(f.calls).toEqual(['settings']);
  });

  it('requires an explicit existing Agent before querying the workspace', () => {
    const f = fixture();
    expect(f.service.prepare({ ...request, argumentsJson: '{"task":"review","agentId":" "}' }))
      .toEqual({
        ok: false, response: {
          ok: false, code: 'AGENT_ID_REQUIRED',
          error: 'agent_delegate: agentId is required. Call list_available_agents first and choose an existing Agent.',
        },
      });
    expect(f.calls).toEqual(['settings']);
  });

  it('reports only the effective workspace catalog without substituting a different Agent', () => {
    const f = fixture();
    expect(f.service.prepare({
      ...request, argumentsJson: '{"task":" review ","agentId":"inactive"}',
    })).toEqual({
      ok: false, response: {
        ok: false, code: 'AGENT_UNAVAILABLE', workspaceId,
        error: `agent_delegate: Agent inactive is not active in workspace ${workspaceId}.`,
        availableAgents: [{ id: 'reviewer', name: 'Reviewer', source: 'builtin' }],
        suggestedDraft: {
          task: 'review',
          reason: '没有找到当前工作区已激活的指定 Agent；请先创建或激活一个已有 Agent。',
        },
      },
    });
    expect(f.getCatalog.mock.calls).toEqual([[threadId]]);
  });

  it.each([
    { requiredSkillIds: ['missing'] },
    { requiredToolIds: ['missing'] },
  ])('enforces requested capabilities %j', (capabilities) => {
    const f = fixture();
    expect(f.service.prepare({ ...request, argumentsJson: JSON.stringify({
      task: 'review', agentId: 'reviewer', ...capabilities,
    }) })).toEqual({
      ok: false, response: {
        ok: false, code: 'AGENT_CAPABILITY_MISMATCH', agentId: 'reviewer',
        error: 'agent_delegate: the selected Agent does not satisfy the requested capabilities.',
        availableAgents: [{ id: 'reviewer', name: 'Reviewer' }],
      },
    });
  });

  it.each([{ archived: true }, { enabled: false }])('excludes ineligible candidates %j', (flags) => {
    const f = fixture(undefined, [{ ...candidate, ...flags }]);
    expect(f.service.prepare(request)).toMatchObject({
      ok: false, response: { code: 'AGENT_CAPABILITY_MISMATCH' },
    });
  });

  it('returns normalized background admission with the Agent presentation and write policy', () => {
    const f = fixture();
    expect(f.service.prepare(request)).toEqual({
      ok: true, task: 'Review changes', parallelGroup: undefined, background: true,
      timeoutSeconds: 7_200, statusNotificationTimeoutSeconds: 120,
      taskTokenBudget: null, workspaceId, candidate,
      assignment: {
        kind: 'existing', agentId: 'reviewer', score: 101,
        reason: '命中已存在 Agent 的硬能力条件，并按任务文本完成候选排序。',
      },
    });
    expect(f.calls).toEqual(['settings', 'catalog']);
  });

  it.each(['agent_delegate', 'delegate_agent'])('preserves foreground policy for %s', (toolName) => {
    const f = fixture({ dynamicSubagentsEnabled: true, taskTokenBudget: 1_000 });
    expect(f.service.prepare({ ...request, toolName, argumentsJson: JSON.stringify({
      task: 'review', agentId: 'reviewer', tokenBudget: 2_000,
      timeoutSeconds: 10_000, parallelGroup: ' ' + 'x'.repeat(90) + ' ',
      requiredSkillIds: ['review', 7], requiredToolIds: ['git'],
    }) })).toMatchObject({
      ok: true, background: false, taskTokenBudget: 1_000, timeoutSeconds: 3_600,
      parallelGroup: 'x'.repeat(80), candidate,
    });
  });

  it('reads fresh host settings and activation on each call', () => {
    const f = fixture();
    expect(f.service.prepare(request).ok).toBe(true);
    f.getCatalog.mockReturnValueOnce({ workspaceId, candidates: [] });
    expect(f.service.prepare(request)).toMatchObject({
      ok: false, response: { code: 'AGENT_UNAVAILABLE', availableAgents: [] },
    });
    f.getSettings.mockReturnValueOnce({ maxChildrenPerParent: 1 });
    expect(f.service.prepare({ ...request, childCount: 1 })).toMatchObject({
      ok: false, response: { error: 'agent_delegate: delegation rejected (children).' },
    });
    expect(f.getCatalog).toHaveBeenCalledTimes(2);
  });

  it('propagates host read failures without treating them as invalid arguments', () => {
    const f = fixture();
    const error = new Error('storage read failed');
    f.getSettings.mockImplementationOnce(() => { throw error; });
    expect(() => f.service.prepare(request)).toThrow(error);
    expect(f.getCatalog).not.toHaveBeenCalled();
    f.getCatalog.mockImplementationOnce(() => { throw error; });
    expect(() => f.service.prepare(request)).toThrow(error);
  });
});
