import { describe, expect, it } from 'vitest';
import { matchesToolName, normalizeToolName } from './tool-name.js';

describe('normalizeToolName', () => {
  it('keeps bare host tool names untouched', () => {
    expect(normalizeToolName('TaskCreate')).toBe('TaskCreate');
    expect(normalizeToolName('update_task_plan')).toBe('update_task_plan');
  });

  it('strips the platform MCP prefix used by Claude / Codex app-server', () => {
    expect(normalizeToolName('mcp__sync-think-platform__TaskCreate')).toBe('TaskCreate');
    expect(normalizeToolName('mcp__sync_think_platform__TaskUpdate')).toBe('TaskUpdate');
  });

  it('takes the last separator so server ids containing __ still resolve', () => {
    expect(normalizeToolName('mcp__my__server__TaskList')).toBe('TaskList');
  });

  it('returns the original name when the shape is degenerate', () => {
    expect(normalizeToolName('mcp__')).toBe('mcp__');
    expect(normalizeToolName('mcp__server__')).toBe('mcp__server__');
    expect(normalizeToolName('mcp__onlyserver')).toBe('onlyserver');
    expect(normalizeToolName('tool')).toBe('tool');
  });
});

describe('matchesToolName', () => {
  const names = new Set(['update_task_plan', 'TaskCreate', 'TaskUpdate', 'TaskList']);

  it('matches both bare and MCP-prefixed forms', () => {
    expect(matchesToolName('TaskCreate', names)).toBe(true);
    expect(matchesToolName('mcp__sync-think-platform__TaskCreate', names)).toBe(true);
  });

  it('does not match unrelated tools', () => {
    expect(matchesToolName('Read', names)).toBe(false);
    expect(matchesToolName('mcp__sync-think-platform__file_read', names)).toBe(false);
  });
});
