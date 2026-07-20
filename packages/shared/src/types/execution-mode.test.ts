import { describe, expect, it } from 'vitest';
import {
  approvalRoutingFromLegacyApprovalMode,
  executionModeFromLegacyApprovalMode,
  executionModeLabelZh,
  legacyApprovalModeFromExecutionMode,
  normalizeExecutionMode,
  resolveExecutionMode,
} from './execution-mode.js';

describe('execution-mode', () => {
  it('normalizes codex-style aliases', () => {
    expect(normalizeExecutionMode('read only')).toBe('read-only');
    expect(normalizeExecutionMode('workspace-write')).toBe('workspace');
    expect(normalizeExecutionMode('danger-full-access')).toBe('full-access');
    expect(normalizeExecutionMode('nope')).toBe('workspace');
  });

  it('maps legacy approval modes onto the three execution modes', () => {
    expect(executionModeFromLegacyApprovalMode('request')).toBe('workspace');
    expect(executionModeFromLegacyApprovalMode('delegate')).toBe('workspace');
    expect(executionModeFromLegacyApprovalMode('custom')).toBe('workspace');
    expect(executionModeFromLegacyApprovalMode('full')).toBe('full-access');
    expect(approvalRoutingFromLegacyApprovalMode('delegate')).toBe('delegate-agent');
    expect(approvalRoutingFromLegacyApprovalMode('request')).toBe('user');
  });

  it('projects execution modes back to legacy approval modes for wire compat', () => {
    expect(legacyApprovalModeFromExecutionMode('read-only')).toBe('request');
    expect(legacyApprovalModeFromExecutionMode('workspace')).toBe('request');
    expect(legacyApprovalModeFromExecutionMode('workspace', 'delegate-agent')).toBe('delegate');
    expect(legacyApprovalModeFromExecutionMode('full-access')).toBe('full');
  });

  it('resolves task > project > install > legacy > default', () => {
    expect(
      resolveExecutionMode({
        taskMode: 'full-access',
        projectMode: 'read-only',
        installMode: 'workspace',
        legacyApprovalMode: 'request',
      }),
    ).toEqual({ mode: 'full-access', source: 'task' });

    expect(
      resolveExecutionMode({
        projectMode: 'read-only',
        legacyApprovalMode: 'full',
      }),
    ).toEqual({ mode: 'read-only', source: 'project' });

    expect(resolveExecutionMode({ legacyApprovalMode: 'delegate' })).toEqual({
      mode: 'workspace',
      source: 'legacy-approval',
    });

    expect(resolveExecutionMode({})).toEqual({ mode: 'workspace', source: 'default' });
  });

  it('labels modes in Chinese', () => {
    expect(executionModeLabelZh('full-access')).toBe('完全访问');
    expect(executionModeLabelZh('workspace')).toBe('工作区');
    expect(executionModeLabelZh('read-only')).toBe('只读');
  });
});
