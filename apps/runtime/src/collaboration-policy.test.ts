import { describe, expect, it } from 'vitest';
import {
  capabilitiesForConversationTrack,
  DEFAULT_COLLABORATION_SETTINGS,
  DELEGATED_READONLY_TOOLS,
  evaluateDynamicDelegation,
  isCollaborationToolAllowed,
  isDelegatedReadOnlyTool,
  normalizeCollaborationSettings,
  resolveAgentAssignment,
  resolveCollaborationToolDenial,
} from './collaboration-policy.js';

describe('conversation collaboration policy', () => {
  it('allows dynamic children only from model conversations', () => {
    expect(capabilitiesForConversationTrack('model').canCreateDynamicSubagent).toBe(false);
    expect(
      capabilitiesForConversationTrack('model', {
        ...DEFAULT_COLLABORATION_SETTINGS,
        dynamicSubagentsEnabled: true,
      }).canCreateDynamicSubagent,
    ).toBe(true);
    expect(capabilitiesForConversationTrack('agent').canCreateDynamicSubagent).toBe(false);
    expect(capabilitiesForConversationTrack('team').canCreateDynamicSubagent).toBe(false);
  });

  it('keeps Agent and Team conversations out of the Agent Library tools', () => {
    expect(isCollaborationToolAllowed({ track: 'model', toolName: 'create_agent' })).toBe(true);
    expect(isCollaborationToolAllowed({ track: 'agent', toolName: 'create_agent' })).toBe(false);
    expect(isCollaborationToolAllowed({ track: 'team', toolName: 'create_team' })).toBe(false);
    expect(isCollaborationToolAllowed({ track: 'agent', toolName: 'TaskCreate' })).toBe(false);
    expect(
      isCollaborationToolAllowed({
        track: 'agent',
        toolName: 'TaskCreate',
        settings: { ...DEFAULT_COLLABORATION_SETTINGS, allowAgentTaskDispatch: true },
      }),
    ).toBe(true);
  });

  it('explains why a collaboration tool is denied instead of one generic refusal', () => {
    const enabled = { ...DEFAULT_COLLABORATION_SETTINGS, dynamicSubagentsEnabled: true };
    expect(
      resolveCollaborationToolDenial({ track: 'model', toolName: 'agent_delegate', settings: enabled }),
    ).toBeNull();
    expect(
      resolveCollaborationToolDenial({ track: 'model', toolName: 'agent_delegate' }),
    ).toMatchObject({ reason: 'disabled' });
    expect(
      resolveCollaborationToolDenial({ track: 'agent', toolName: 'agent_delegate', settings: enabled }),
    ).toMatchObject({ reason: 'track' });
    expect(
      resolveCollaborationToolDenial({ track: 'agent', toolName: 'TaskCreate' }),
    ).toMatchObject({ reason: 'disabled' });
    expect(
      resolveCollaborationToolDenial({
        track: 'agent',
        toolName: 'TaskCreate',
        settings: { ...DEFAULT_COLLABORATION_SETTINGS, allowAgentTaskDispatch: true },
      }),
    ).toBeNull();
  });

  it('preserves unlimited token budget and clamps malformed limits', () => {
    const settings = normalizeCollaborationSettings({
      maxNestingDepth: 99,
      maxChildrenPerParent: -1,
      taskTokenBudget: null,
    });
    expect(settings.taskTokenBudget).toBeNull();
    expect(settings.maxNestingDepth).toBe(8);
    expect(settings.maxChildrenPerParent).toBe(0);
    expect(settings.allowAgentTaskDispatch).toBe(
      DEFAULT_COLLABORATION_SETTINGS.allowAgentTaskDispatch,
    );
  });

  it('stops delegation at depth, parent-child and per-turn limits', () => {
    const settings = {
      ...DEFAULT_COLLABORATION_SETTINGS,
      dynamicSubagentsEnabled: true,
      maxNestingDepth: 1,
    };
    expect(
      evaluateDynamicDelegation({
        track: 'model',
        settings,
        state: { depth: 1, childCount: 0, autoDelegationsThisTurn: 0 },
      }),
    ).toMatchObject({ allowed: false, reason: 'depth', taskTokenBudget: null });
    expect(
      evaluateDynamicDelegation({
        track: 'model',
        settings: { ...settings, maxNestingDepth: 4, maxChildrenPerParent: 1 },
        state: { depth: 0, childCount: 1, autoDelegationsThisTurn: 0 },
      }),
    ).toMatchObject({ allowed: false, reason: 'children' });
    expect(
      evaluateDynamicDelegation({
        track: 'agent',
        settings,
        state: { depth: 0, childCount: 0, autoDelegationsThisTurn: 0 },
      }),
    ).toMatchObject({ allowed: false, reason: 'track' });
  });

  it('reuses a matching catalog agent and otherwise creates a run-local profile', () => {
    const existing = resolveAgentAssignment(
      { task: '审查登录模块异常处理', requiredSkillIds: ['review'] },
      [
        { id: 'agent-reviewer', name: '代码审查员', persona: '负责异常处理审查', skillIds: ['review'] },
        { id: 'agent-other', name: '设计师', skillIds: ['design'] },
      ],
    );
    expect(existing).toMatchObject({ kind: 'existing', agentId: 'agent-reviewer' });

    const temporary = resolveAgentAssignment(
      { task: '分析供应链合同', requiredSkillIds: ['contract'] },
      [{ id: 'agent-reviewer', name: '代码审查员', skillIds: ['review'] }],
    );
    expect(temporary.kind).toBe('temporary');
    expect(temporary.temporaryProfile?.task).toBe('分析供应链合同');
  });
  it('lets a delegated child run only built-in read-only tools or explicit readOnly MCP tools', () => {
    expect(isDelegatedReadOnlyTool('read_file')).toBe(true);
    expect(isDelegatedReadOnlyTool('git_diff')).toBe(true);
    expect(DELEGATED_READONLY_TOOLS.has('web_fetch')).toBe(true);
    expect(isDelegatedReadOnlyTool('write_file')).toBe(false);
    expect(isDelegatedReadOnlyTool('run_command')).toBe(false);
    expect(isDelegatedReadOnlyTool('TaskCreate')).toBe(false);
    // MCP tools use the mcp__<server>__<tool> shape and stay refused unless the
    // server schema explicitly declared readOnly: true.
    expect(isDelegatedReadOnlyTool('mcp__demo__deploy_probe')).toBe(false);
    expect(isDelegatedReadOnlyTool('mcp__demo__deploy_probe', false)).toBe(false);
    expect(isDelegatedReadOnlyTool('mcp__demo__read_probe', true)).toBe(true);
  });
});
