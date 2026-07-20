import { describe, expect, it } from 'vitest';
import {
  isAutoApprovedByExecutionMode,
  resolveEffectiveExecution,
} from './execution-mode-policy.js';

const ALL_TOOLS = [
  'read_file',
  'list_files',
  'write_file',
  'run_command',
  'git_status',
  'git_diff',
  'browser_navigate',
  'browser_extract',
  'desktop_list_windows',
] as const;

describe('resolveEffectiveExecution', () => {
  it('defaults to workspace mode and keeps local tools when a root exists', () => {
    const effective = resolveEffectiveExecution({
      workspaceRoot: 'D:/proj',
      candidateToolNames: ALL_TOOLS,
    });
    expect(effective.mode).toBe('workspace');
    expect(effective.legacyApprovalMode).toBe('request');
    expect(effective.filesystem).toBe('write-workspace');
    expect(effective.network).toBe('ask');
    expect(effective.approval).toBe('ask-protected');
    expect(effective.toolNames).toEqual([...ALL_TOOLS]);
    expect(effective.labelZh).toBe('工作区');
  });

  it('maps legacy full approval mode to full-access without approvals', () => {
    const effective = resolveEffectiveExecution({
      legacyApprovalMode: 'full',
      workspaceRoot: 'D:/proj',
      candidateToolNames: ALL_TOOLS,
    });
    expect(effective.mode).toBe('full-access');
    expect(effective.legacyApprovalMode).toBe('full');
    expect(effective.filesystem).toBe('unrestricted');
    expect(effective.network).toBe('allow');
    expect(effective.approval).toBe('never');
    expect(effective.toolNames).toEqual([...ALL_TOOLS]);
  });

  it('maps legacy delegate to workspace + delegate routing', () => {
    const effective = resolveEffectiveExecution({
      legacyApprovalMode: 'delegate',
      workspaceRoot: 'D:/proj',
      candidateToolNames: ['write_file', 'run_command'],
    });
    expect(effective.mode).toBe('workspace');
    expect(effective.approvalRouting).toBe('delegate-agent');
    expect(effective.legacyApprovalMode).toBe('delegate');
  });

  it('read-only keeps inspection tools only', () => {
    const effective = resolveEffectiveExecution({
      taskMode: 'read-only',
      workspaceRoot: 'D:/proj',
      candidateToolNames: ALL_TOOLS,
    });
    expect(effective.mode).toBe('read-only');
    expect(effective.filesystem).toBe('read');
    expect(effective.network).toBe('deny');
    expect(effective.toolNames).toEqual([
      'read_file',
      'list_files',
      'git_status',
      'git_diff',
      'browser_extract',
    ]);
  });

  it('drops local tools when workspace root is missing outside full-access', () => {
    const workspace = resolveEffectiveExecution({
      taskMode: 'workspace',
      candidateToolNames: ALL_TOOLS,
    });
    expect(workspace.toolNames).toEqual([]);
    expect(workspace.hasWorkspaceRoot).toBe(false);

    const full = resolveEffectiveExecution({
      taskMode: 'full-access',
      candidateToolNames: ALL_TOOLS,
    });
    expect(full.toolNames).toEqual([...ALL_TOOLS]);
  });

  it('intersects delegated allowlists', () => {
    const effective = resolveEffectiveExecution({
      taskMode: 'workspace',
      workspaceRoot: 'D:/proj',
      candidateToolNames: ALL_TOOLS,
      allowedTools: ['read_file', 'run_command', 'missing_tool'],
    });
    expect(effective.toolNames).toEqual(['read_file', 'run_command']);
  });

  it('prefers explicit task mode over legacy approval mode', () => {
    const effective = resolveEffectiveExecution({
      taskMode: 'read-only',
      legacyApprovalMode: 'full',
      workspaceRoot: 'D:/proj',
      candidateToolNames: ALL_TOOLS,
    });
    expect(effective.mode).toBe('read-only');
    expect(effective.source).toBe('task');
  });
});

describe('isAutoApprovedByExecutionMode', () => {
  it('never asks under full-access when the tool is available', () => {
    expect(isAutoApprovedByExecutionMode('full-access', { toolAvailable: true })).toBe(true);
    expect(isAutoApprovedByExecutionMode('full', { toolAvailable: true })).toBe(true);
  });

  it('asks for protected/out-of-boundary workspace actions', () => {
    expect(
      isAutoApprovedByExecutionMode('workspace', {
        insideModeBoundary: true,
        toolAvailable: true,
      }),
    ).toBe(true);
    expect(
      isAutoApprovedByExecutionMode('workspace', {
        insideModeBoundary: false,
        toolAvailable: true,
      }),
    ).toBe(false);
  });

  it('does not auto-approve writes in read-only', () => {
    expect(
      isAutoApprovedByExecutionMode('read-only', {
        insideModeBoundary: true,
        toolAvailable: true,
      }),
    ).toBe(false);
  });
});
