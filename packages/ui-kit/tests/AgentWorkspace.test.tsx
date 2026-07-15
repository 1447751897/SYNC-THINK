import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AgentWorkspace } from '../src/components/AgentWorkspace.js';

afterEach(() => cleanup());

const models = [
  {
    modelId: 'm1',
    label: 'gpt-mini',
    providerName: 'KMKAPI-CODEX',
    providerId: 'p1',
    providerModelId: 'gpt-mini',
    surface: 'codex' as const,
  },
  {
    modelId: 'm2',
    label: 'sonnet',
    providerName: 'Unity2.Ai',
    providerId: 'p2',
    providerModelId: 'claude-sonnet-4',
    surface: 'claude' as const,
  },
];

const binding = {
  agentId: 'agent-default-conversation',
  agentVersionId: 'av1',
  version: 2,
  name: '默认助手',
  role: 'generalist',
  defaultModelId: 'm1',
  fallbackModelIds: [] as string[],
  pauseOnFailure: true,
  defaultCredentialGroupId: 'credential-group-unassigned',
  pinnedCredentialRefId: null as string | null,
  skillVersionIds: [] as string[],
  mcpServerIds: [] as string[],
};

describe('AgentWorkspace', () => {
  it('shows agent list and detail tabs; runtime board uses 分组→供应商→模型', () => {
    const onSave = vi.fn();
    render(
      <AgentWorkspace binding={binding} models={models} onSave={onSave} />,
    );

    expect(screen.getByTestId('agent-workspace')).toBeTruthy();
    expect(screen.getByTestId('agent-workspace-detail-name').textContent).toContain('默认助手');
    expect(
      screen.getByTestId(`agent-workspace-card-${binding.agentId}`).getAttribute('data-active'),
    ).toBe('1');

    fireEvent.click(screen.getByTestId('agent-workspace-tab-runtime'));
    expect(screen.getByTestId('agent-workspace-panel-runtime')).toBeTruthy();
    expect(screen.getByTestId('agent-default-model')).toBeTruthy();
    expect(screen.getByTestId('agent-fallback-board')).toBeTruthy();
    // default + fallback boards both expose 分组→供应商→模型
    expect(screen.getAllByText('1 · 分组').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/2 · 供应商/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/3 · 模型/).length).toBeGreaterThanOrEqual(2);

    // m2 lives under Claude surface — switch 分组 first
    fireEvent.click(screen.getByTestId('agent-default-model-surface-claude'));
    fireEvent.click(screen.getByTestId('agent-default-model-model-m2'));
    // hierarchical fallback: add m1 via fallback board (default is m2 after change)
    fireEvent.click(screen.getByTestId('agent-fallback-board-model-m1'));
    fireEvent.click(screen.getByTestId('agent-save'));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultModelId: 'm2',
        fallbackModelIds: expect.arrayContaining(['m1']),
      }),
    );
  });

  it('switches overview quick action to runtime tab', () => {
    render(<AgentWorkspace binding={binding} models={models} />);
    fireEvent.click(screen.getByText('配置运行时'));
    expect(screen.getByTestId('agent-workspace-panel-runtime')).toBeTruthy();
  });

  it('edits the complete definition as a new version and shows exact version history', () => {
    const onSaveDefinition = vi.fn();
    render(
      <AgentWorkspace
        binding={binding}
        models={models}
        definition={{
          agentId: binding.agentId,
          agentVersionId: binding.agentVersionId,
          version: binding.version,
          name: binding.name,
          role: binding.role,
          developerInstructions: 'Plan before acting.',
          inputContract: 'Task context',
          outputContract: 'Reviewed artifact',
          memoryScope: 'project',
          approvalMode: 'request',
          policyId: 'policy-1',
        }}
        versions={[
          {
            agentId: binding.agentId,
            agentVersionId: 'av0',
            version: 1,
            name: binding.name,
            role: binding.role,
            developerInstructions: 'Act carefully.',
            inputContract: 'Task context',
            outputContract: 'Artifact',
            memoryScope: 'task',
            approvalMode: 'request',
            createdAt: '2026-07-13T00:00:00.000Z',
          },
          {
            agentId: binding.agentId,
            agentVersionId: binding.agentVersionId,
            version: 2,
            name: binding.name,
            role: binding.role,
            developerInstructions: 'Plan before acting.',
            inputContract: 'Task context',
            outputContract: 'Reviewed artifact',
            memoryScope: 'project',
            approvalMode: 'request',
            policyId: 'policy-1',
            createdAt: '2026-07-14T00:00:00.000Z',
          },
        ]}
        onSaveDefinition={onSaveDefinition}
      />,
    );

    fireEvent.click(screen.getByTestId('agent-workspace-tab-instructions'));
    fireEvent.change(screen.getByLabelText('开发者指令'), {
      target: { value: 'Plan, execute, then review.' },
    });
    fireEvent.change(screen.getByLabelText('输出契约'), {
      target: { value: 'Accepted artifact and evidence' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存为新版本' }));
    expect(onSaveDefinition).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: binding.agentId,
        expectedVersion: 2,
        developerInstructions: 'Plan, execute, then review.',
        outputContract: 'Accepted artifact and evidence',
      }),
    );

    fireEvent.click(screen.getByTestId('agent-workspace-tab-versions'));
    expect(screen.getAllByTestId(/agent-version-/)).toHaveLength(2);
    expect(screen.getByTestId('agent-version-av1').textContent).toContain('av1');
    expect(screen.getByTestId('agent-version-av1').textContent).toMatch(/指令|输出契约|记忆范围/);
  });

  it('edits all nested AgentVersion fields and includes runtime bindings in history diffs', () => {
    const onSaveDefinition = vi.fn();
    const complete = {
      agentId: binding.agentId,
      agentVersionId: binding.agentVersionId,
      version: binding.version,
      name: binding.name,
      description: 'Coordinates execution.',
      visualIdentity: { icon: 'workflow', color: '#227755' },
      role: binding.role,
      developerInstructions: 'Plan before acting.',
      inputContract: 'Task context',
      outputContract: 'Reviewed artifact',
      memoryScope: 'project' as const,
      approvalMode: 'request' as const,
      mcpToolAllowlist: ['read_file'],
      permissions: {
        file: ['workspace:read'],
        command: ['pnpm test'],
        browser: ['localhost'],
        desktop: [],
        network: ['api.example.test'],
      },
      reviewBehavior: {
        role: 'executor-reviewer' as const,
        maxIterations: 2,
        onLimitReached: 'pause' as const,
      },
      artifactRules: {
        retainVersions: true,
        requireReview: true,
        defaultStatus: 'candidate' as const,
      },
    };
    render(
      <AgentWorkspace
        binding={binding}
        models={models}
        definition={complete}
        versions={[
          {
            ...complete,
            agentVersionId: 'av0',
            version: 1,
            defaultModelId: 'm1',
            defaultCredentialGroupId: 'group-a',
            pinnedCredentialRefId: null,
            pauseOnFailure: true,
            fallbackModelIds: [],
            skillVersionIds: [],
            mcpServerIds: [],
            createdAt: '2026-07-13T00:00:00.000Z',
          },
          {
            ...complete,
            defaultModelId: 'm2',
            defaultCredentialGroupId: 'group-b',
            pinnedCredentialRefId: 'credential-b',
            pauseOnFailure: false,
            fallbackModelIds: ['m1'],
            skillVersionIds: ['skill-v2'],
            mcpServerIds: ['mcp-files'],
            mcpToolAllowlist: ['read_file', 'write_file'],
            createdAt: '2026-07-14T00:00:00.000Z',
          },
        ]}
        onSaveDefinition={onSaveDefinition}
      />,
    );

    fireEvent.click(screen.getByTestId('agent-workspace-tab-instructions'));
    fireEvent.change(screen.getByTestId('agent-definition-description'), {
      target: { value: 'Coordinates execution and review.' },
    });
    fireEvent.change(screen.getByTestId('agent-definition-mcp-tools'), {
      target: { value: 'read_file, write_file' },
    });
    fireEvent.change(screen.getByTestId('agent-definition-review-max-iterations'), {
      target: { value: '3' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存为新版本' }));

    expect(onSaveDefinition).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Coordinates execution and review.',
        visualIdentity: { icon: 'workflow', color: '#227755' },
        mcpToolAllowlist: ['read_file', 'write_file'],
        permissions: complete.permissions,
        reviewBehavior: {
          role: 'executor-reviewer',
          maxIterations: 3,
          onLimitReached: 'pause',
        },
        artifactRules: complete.artifactRules,
      }),
    );

    fireEvent.click(screen.getByTestId('agent-workspace-tab-versions'));
    const current = screen.getByTestId(`agent-version-${binding.agentVersionId}`);
    expect(current.getAttribute('data-changes')).toMatch(
      /defaultModelId|defaultCredentialGroupId|pinnedCredentialRefId|pauseOnFailure|fallbackModelIds|skillVersionIds|mcpServerIds|mcpToolAllowlist/,
    );
  });

  it('requires an exact backup reviewer for reassignment and clears it for pause or abort', () => {
    const onSaveDefinition = vi.fn();
    const definition = {
      agentId: binding.agentId,
      agentVersionId: binding.agentVersionId,
      version: binding.version,
      name: binding.name,
      role: binding.role,
      developerInstructions: 'Plan before acting.',
      inputContract: 'Task context',
      outputContract: 'Reviewed artifact',
      memoryScope: 'project' as const,
      approvalMode: 'request' as const,
      reviewBehavior: {
        role: 'reviewer' as const,
        maxIterations: 2,
        onLimitReached: 'pause' as const,
      },
    };
    render(
      <AgentWorkspace
        binding={binding}
        models={models}
        definition={definition}
        allAgentVersions={[
          {
            agentVersionId: binding.agentVersionId,
            agentId: binding.agentId,
            agentName: 'Primary reviewer',
            version: 2,
            reviewerCapable: true,
          },
          {
            agentVersionId: 'backup-reviewer-v4',
            agentId: 'agent-backup',
            agentName: 'Backup reviewer',
            version: 4,
            reviewerCapable: true,
            title: 'Independent review',
          },
          {
            agentVersionId: 'executor-v1',
            agentId: 'agent-executor',
            agentName: 'Executor',
            version: 1,
            reviewerCapable: false,
          },
        ]}
        onSaveDefinition={onSaveDefinition}
      />,
    );

    fireEvent.click(screen.getByTestId('agent-workspace-tab-instructions'));
    fireEvent.change(screen.getByTestId('agent-definition-review-on-limit'), {
      target: { value: 'reassign' },
    });
    const backup = screen.getByTestId('agent-definition-review-backup') as HTMLSelectElement;
    expect(backup.textContent).toContain('Backup reviewer');
    expect(backup.textContent).toContain('v4');
    expect(backup.textContent).toContain('backup-reviewer-v4');
    expect(backup.textContent).not.toContain('Primary reviewer');
    expect(backup.textContent).not.toContain('Executor');

    const save = screen.getByRole('button', { name: '保存为新版本' }) as HTMLButtonElement;
    expect(backup.getAttribute('aria-invalid')).toBe('true');
    expect(backup.getAttribute('aria-describedby')).toBe('agent-definition-review-backup-error');
    expect(screen.getByTestId('agent-definition-review-backup-error').getAttribute('role')).toBe(
      'alert',
    );
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(onSaveDefinition).not.toHaveBeenCalled();
    fireEvent.change(backup, { target: { value: 'backup-reviewer-v4' } });
    expect(backup.getAttribute('aria-invalid')).toBe('false');
    expect(screen.queryByTestId('agent-definition-review-backup-error')).toBeNull();
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(onSaveDefinition).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reviewBehavior: expect.objectContaining({
          onLimitReached: 'reassign',
          backupAgentVersionId: 'backup-reviewer-v4',
        }),
      }),
    );

    fireEvent.change(screen.getByTestId('agent-definition-review-on-limit'), {
      target: { value: 'pause' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存为新版本' }));
    expect(onSaveDefinition).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reviewBehavior: expect.not.objectContaining({ backupAgentVersionId: expect.anything() }),
      }),
    );
  });

  it('blocks a stale exact backup reviewer that is no longer in the reviewer catalog', () => {
    const onSaveDefinition = vi.fn();
    render(
      <AgentWorkspace
        binding={binding}
        models={models}
        definition={{
          agentId: binding.agentId,
          agentVersionId: binding.agentVersionId,
          version: binding.version,
          name: binding.name,
          role: binding.role,
          developerInstructions: 'Plan before acting.',
          inputContract: 'Task context',
          outputContract: 'Reviewed artifact',
          memoryScope: 'project',
          approvalMode: 'request',
          reviewBehavior: {
            role: 'reviewer',
            maxIterations: 2,
            onLimitReached: 'reassign',
            backupAgentVersionId: 'retired-reviewer-v1',
          },
        }}
        allAgentVersions={[
          {
            agentVersionId: 'backup-reviewer-v4',
            agentId: 'agent-backup',
            agentName: 'Backup reviewer',
            version: 4,
            reviewerCapable: true,
          },
        ]}
        onSaveDefinition={onSaveDefinition}
      />,
    );

    fireEvent.click(screen.getByTestId('agent-workspace-tab-instructions'));
    const staleBackup = screen.getByTestId(
      'agent-definition-review-backup',
    ) as HTMLSelectElement;
    const save = screen.getByRole('button', { name: '保存为新版本' }) as HTMLButtonElement;
    expect(staleBackup.value).toBe('retired-reviewer-v1');
    expect(staleBackup.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByTestId('agent-definition-review-backup-error').textContent).toMatch(
      /exact.*AgentVersion|有效.*AgentVersion/,
    );
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(onSaveDefinition).not.toHaveBeenCalled();
  });
});
