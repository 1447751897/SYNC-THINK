import { describe, expect, it } from 'vitest';
import { createPlatformAgentStoreAdapter } from './platform-agent-store.js';

describe('createPlatformAgentStoreAdapter', () => {
  it('forwards the workspace and exposes only the platform Agent contract', () => {
    const requestedWorkspaces: string[] = [];
    const adapter = createPlatformAgentStoreAdapter({
      listEffective: (workspaceId) => {
        requestedWorkspaces.push(workspaceId);
        return [
          {
            id: 'agent-reviewer',
            name: 'Reviewer',
            avatar: 'avatar.svg',
            description: 'Reviews changes',
            source: 'user',
            availabilityScope: 'workspace',
            defaultModelId: 'model-1',
            skillIds: ['skill-review'],
            mcpServerIds: ['mcp-git'],
            internalRevision: 7,
          },
        ];
      },
    });

    expect(adapter.listEffective('workspace-1')).toEqual([
      {
        id: 'agent-reviewer',
        name: 'Reviewer',
        avatar: 'avatar.svg',
        description: 'Reviews changes',
        source: 'user',
        availabilityScope: 'workspace',
        defaultModelId: 'model-1',
        skillIds: ['skill-review'],
        mcpServerIds: ['mcp-git'],
      },
    ]);
    expect(requestedWorkspaces).toEqual(['workspace-1']);
  });

  it('copies mutable capability arrays across the port', () => {
    const skillIds = ['skill-1'];
    const mcpServerIds = ['mcp-1'];
    const adapter = createPlatformAgentStoreAdapter({
      listEffective: () => [
        {
          id: 'agent-1',
          name: 'Agent',
          avatar: '',
          description: '',
          source: 'builtin',
          availabilityScope: 'global',
          defaultModelId: 'model-1',
          skillIds,
          mcpServerIds,
        },
      ],
    });

    const [projected] = adapter.listEffective('workspace-1');
    expect(projected?.skillIds).not.toBe(skillIds);
    expect(projected?.mcpServerIds).not.toBe(mcpServerIds);
  });
});
