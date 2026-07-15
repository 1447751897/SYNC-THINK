import type {
  AgentVersionId,
  McpServerId,
  SkillVersionId,
} from '@sync-think/shared';
import { describe, expect, it } from 'vitest';
import {
  resolveCapabilityAccess,
  type CapabilityGrant,
  type CapabilityScopeRef,
} from './capability-authorization.js';

const agentVersionId = 'agent-version-reader' as AgentVersionId;
const otherAgentVersionId = 'agent-version-other' as AgentVersionId;
const serverId = 'mcp-files' as McpServerId;
const skillVersionId = 'skill-version-files-v1' as SkillVersionId;

const scopeChain: CapabilityScopeRef[] = [
  { scope: 'user', scopeId: 'user-local' },
  { scope: 'workspace', scopeId: 'workspace-alpha' },
  { scope: 'project', scopeId: 'project-alpha' },
  { scope: 'task', scopeId: 'task-alpha' },
  { scope: 'run', scopeId: 'run-alpha' },
];

function mcpGrant(overrides: Partial<CapabilityGrant> = {}): CapabilityGrant {
  return {
    grantId: 'grant-mcp-files',
    version: 1,
    scope: 'project',
    scopeId: 'project-alpha',
    agentVersionId,
    target: 'mcp',
    serverId,
    tools: ['read_file'],
    revoked: false,
    ...overrides,
  } as CapabilityGrant;
}

describe('resolveCapabilityAccess', () => {
  it('allows an exact AgentVersion to use an authorized MCP tool in its scope chain', () => {
    expect(
      resolveCapabilityAccess({
        agentVersionId,
        scopeChain,
        serverId,
        toolName: 'read_file',
        grants: [mcpGrant()],
      }),
    ).toEqual({ allowed: true });
  });

  it('denies by default and rejects grants outside the exact scope chain', () => {
    const request = {
      agentVersionId,
      scopeChain,
      serverId,
      toolName: 'read_file',
    } as const;

    expect(resolveCapabilityAccess({ ...request, grants: [] })).toEqual({
      allowed: false,
      reason: 'not-authorized',
    });
    expect(
      resolveCapabilityAccess({
        ...request,
        grants: [mcpGrant({ scopeId: 'project-forged' })],
      }),
    ).toEqual({ allowed: false, reason: 'scope-not-authorized' });
    expect(
      resolveCapabilityAccess({
        ...request,
        scopeChain: [scopeChain[2]!, scopeChain[1]!],
        grants: [mcpGrant()],
      }),
    ).toEqual({ allowed: false, reason: 'scope-not-authorized' });
  });

  it('requires the exact AgentVersion rather than a related Agent identity', () => {
    expect(
      resolveCapabilityAccess({
        agentVersionId: otherAgentVersionId,
        scopeChain,
        serverId,
        toolName: 'read_file',
        grants: [mcpGrant()],
      }),
    ).toEqual({ allowed: false, reason: 'agent-not-authorized' });
  });

  it('distinguishes MCP server and tool mismatches and supports whole-server grants', () => {
    expect(
      resolveCapabilityAccess({
        agentVersionId,
        scopeChain,
        serverId: 'mcp-shell' as McpServerId,
        toolName: 'read_file',
        grants: [mcpGrant()],
      }),
    ).toEqual({ allowed: false, reason: 'server-not-authorized' });
    expect(
      resolveCapabilityAccess({
        agentVersionId,
        scopeChain,
        serverId,
        toolName: 'write_file',
        grants: [mcpGrant()],
      }),
    ).toEqual({ allowed: false, reason: 'tool-not-authorized' });
    expect(
      resolveCapabilityAccess({
        agentVersionId,
        scopeChain,
        serverId,
        toolName: 'write_file',
        grants: [mcpGrant({ tools: undefined })],
      }),
    ).toEqual({ allowed: true });
  });

  it('authorizes only the exact immutable SkillVersion', () => {
    const grant: CapabilityGrant = {
      grantId: 'grant-skill-files',
      version: 1,
      scope: 'task',
      scopeId: 'task-alpha',
      agentVersionId,
      target: 'skill',
      skillVersionId,
      revoked: false,
    };

    expect(
      resolveCapabilityAccess({ agentVersionId, scopeChain, skillVersionId, grants: [grant] }),
    ).toEqual({ allowed: true });
    expect(
      resolveCapabilityAccess({
        agentVersionId,
        scopeChain,
        skillVersionId: 'skill-version-files-v2' as SkillVersionId,
        grants: [grant],
      }),
    ).toEqual({ allowed: false, reason: 'skill-not-authorized' });
  });

  it('uses only the highest immutable grant version so revocation is immediate', () => {
    const granted = mcpGrant({ version: 1, revoked: false });
    const revoked = mcpGrant({ version: 2, revoked: true });

    expect(
      resolveCapabilityAccess({
        agentVersionId,
        scopeChain,
        serverId,
        toolName: 'read_file',
        grants: [revoked, granted],
      }),
    ).toEqual({ allowed: false, reason: 'revoked' });
  });

  it('fails closed for unknown scope values', () => {
    expect(
      resolveCapabilityAccess({
        agentVersionId,
        scopeChain: [
          { scope: 'toString' as CapabilityScopeRef['scope'], scopeId: 'project-alpha' },
        ],
        serverId,
        toolName: 'read_file',
        grants: [mcpGrant({ scope: 'toString' as CapabilityGrant['scope'] })],
      }),
    ).toEqual({ allowed: false, reason: 'not-authorized' });
  });

  it('does not fall back when the highest grant version is ambiguous', () => {
    expect(
      resolveCapabilityAccess({
        agentVersionId,
        scopeChain,
        serverId,
        toolName: 'read_file',
        grants: [
          mcpGrant({ version: 2, revoked: false }),
          mcpGrant({ version: 2, revoked: true }),
          mcpGrant({ version: 1, revoked: false }),
        ],
      }),
    ).toEqual({ allowed: false, reason: 'not-authorized' });
  });
});
