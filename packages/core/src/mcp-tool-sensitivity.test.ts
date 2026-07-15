import { describe, expect, it } from 'vitest';
import {
  evaluateMcpToolSensitivity,
  isHighRiskMcpToolName,
} from './mcp-tool-sensitivity.js';

describe('mcp-tool-sensitivity (§9.3 / §13)', () => {
  it('flags high-risk tool names', () => {
    expect(isHighRiskMcpToolName('write_file')).toBe(true);
    expect(isHighRiskMcpToolName('shell.exec')).toBe(true);
    expect(isHighRiskMcpToolName('read_file')).toBe(false);
    expect(isHighRiskMcpToolName('list_dir')).toBe(false);
  });

  it('untrusted server is always sensitive', () => {
    const r = evaluateMcpToolSensitivity({
      toolName: 'read_file',
      trusted: false,
      registeredTools: ['read_file'],
    });
    expect(r.sensitive).toBe(true);
    expect(r.reasons).toContain('untrusted-server');
  });

  it('trusted + catalog + low-risk is not sensitive', () => {
    const r = evaluateMcpToolSensitivity({
      toolName: 'read_file',
      trusted: true,
      registeredTools: ['read_file', 'list_dir'],
    });
    expect(r.sensitive).toBe(false);
    expect(r.toolOnCatalog).toBe(true);
  });

  it('unknown tool on non-empty catalog is sensitive', () => {
    const r = evaluateMcpToolSensitivity({
      toolName: 'mystery',
      trusted: true,
      registeredTools: ['read_file'],
    });
    expect(r.sensitive).toBe(true);
    expect(r.reasons).toContain('tool-not-on-catalog');
  });

  it('forceSensitive wins', () => {
    const r = evaluateMcpToolSensitivity({
      toolName: 'read_file',
      trusted: true,
      registeredTools: ['read_file'],
      forceSensitive: true,
    });
    expect(r.sensitive).toBe(true);
    expect(r.action).toBe('mcp.tool.request:read_file');
  });
});
