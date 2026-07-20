import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { AGENT_PERMISSION_DISABLED } from '@sync-think/shared';
import { AgentWorkspace } from '../src/components/AgentWorkspace.js';

afterEach(() => cleanup());

const css = readFileSync(resolve(process.cwd(), 'src/styles/components.css'), 'utf8');

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
  it('creates an Agent from an inline form without using window.prompt', async () => {
    const onCreateAgent = vi.fn(async () => 'agent-new');
    const prompt = vi.spyOn(window, 'prompt');
    render(<AgentWorkspace binding={binding} models={models} onCreateAgent={onCreateAgent} />);

    fireEvent.click(screen.getByTestId('agent-workspace-new'));
    expect(screen.getByTestId('agent-workspace-create-form')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('智能体名称'), { target: { value: '发布助手' } });
    fireEvent.change(screen.getByLabelText('智能体角色'), { target: { value: 'release' } });
    fireEvent.change(screen.getByLabelText('智能体描述'), {
      target: { value: '负责发布检查与结果汇总' },
    });
    fireEvent.change(screen.getByLabelText('固定指令'), {
      target: { value: '检查版本、测试与发布记录。' },
    });
    fireEvent.change(screen.getByLabelText('支持的任务并发数'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: '创建智能体' }));

    await waitFor(() =>
      expect(onCreateAgent).toHaveBeenCalledWith({
        name: '发布助手',
        role: 'release',
        description: '负责发布检查与结果汇总',
        developerInstructions: '检查版本、测试与发布记录。',
        maxConcurrency: 5,
      }),
    );
    expect(prompt).not.toHaveBeenCalled();
    prompt.mockRestore();
  });

  it('keeps the create draft visible and shows the Runtime creation error', () => {
    render(
      <AgentWorkspace
        binding={null}
        models={models}
        error="请先导入模型源并配置可用模型"
        onCreateAgent={async () => null}
      />,
    );

    fireEvent.click(screen.getByTestId('agent-workspace-new'));
    expect(screen.getByTestId('agent-workspace-create-form')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('请先导入模型源');
  });

  it('uses the Figma profile actions and grouped ability editor without Agent approval UI', () => {
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
          description: '负责统筹任务。',
          developerInstructions: 'Plan before acting.',
          inputContract: 'Task context',
          outputContract: 'Verified result',
          maxConcurrency: 3,
          memoryScope: 'project',
          approvalMode: 'request',
        }}
        onSaveDefinition={vi.fn()}
        onStartTask={vi.fn()}
        onJoinGroup={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '编辑智能体' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '开始任务' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '加入群聊' })).toBeTruthy();
    fireEvent.click(screen.getByTestId('agent-workspace-tab-instructions'));
    for (const heading of ['身份', '工作能力', '工作指令', '能力上限', '执行设置']) {
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    }
    expect(screen.queryByText('输入与输出')).toBeNull();
    expect(screen.queryByLabelText('输入契约')).toBeNull();
    expect(screen.queryByLabelText('输出契约')).toBeNull();
    expect(screen.queryByLabelText('记忆范围')).toBeNull();
    expect(screen.queryByTestId('agent-workspace-tab-tools')).toBeNull();
    expect(screen.queryByRole('heading', { name: '审查与产物' })).toBeNull();
    expect(screen.queryByRole('heading', { name: '工具权限' })).toBeNull();
    expect(screen.queryByLabelText('智能体批准模式')).toBeNull();
    expect(screen.queryByText('批准模式')).toBeNull();
  });

  it('materializes legacy capability defaults and saves an explicit disabled category', () => {
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
          outputContract: 'Verified result',
          maxConcurrency: 3,
          memoryScope: 'task',
          approvalMode: 'full',
          permissions: { file: [], command: [], browser: [], desktop: [], network: [] },
        }}
        onSaveDefinition={onSaveDefinition}
      />,
    );

    fireEvent.click(screen.getByTestId('agent-workspace-tab-instructions'));
    const browserCapability = screen.getByLabelText('允许浏览器能力') as HTMLInputElement;
    expect(browserCapability.checked).toBe(true);
    fireEvent.click(browserCapability);
    fireEvent.click(screen.getByTestId('agent-definition-save'));

    expect(onSaveDefinition).toHaveBeenCalledWith(
      expect.objectContaining({
        permissions: {
          file: ['*'],
          command: ['*'],
          browser: [AGENT_PERMISSION_DISABLED],
          desktop: ['*'],
          network: ['*'],
        },
      }),
    );
  });

  it('shows agent list and detail tabs; runtime board uses 分组→供应商→模型', () => {
    const onSave = vi.fn();
    render(<AgentWorkspace binding={binding} models={models} onSave={onSave} />);

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

  it('keeps Agent detail tab underline on a fixed baseline across tab changes', () => {
    expect(css).toMatch(
      /\.st-agent-ws__tabs\s*\{[^}]*height: 40px[^}]*align-items: stretch[^}]*border-bottom: 1px solid var\(--st-color-border\)/s,
    );
    expect(css).toMatch(
      /\.st-agent-ws__tab\s*\{[^}]*height: 40px[^}]*border-bottom: 0[^}]*font-weight: 600/s,
    );
    expect(css).toMatch(/\.st-agent-ws__tab::after\s*\{[^}]*bottom: -1px[^}]*height: 2px/s);
  });

  it('switches overview quick action to runtime tab', () => {
    render(<AgentWorkspace binding={binding} models={models} />);
    fireEvent.click(screen.getByText('配置运行时'));
    expect(screen.getByTestId('agent-workspace-panel-runtime')).toBeTruthy();
  });

  it('shows persisted group responsibilities and opens real related tasks', () => {
    const onOpenTask = vi.fn();
    render(
      <AgentWorkspace
        binding={binding}
        models={models}
        relatedTasks={[
          { taskId: 'task-2', title: '修复登录', status: '进行中' },
          { taskId: 'task-1', title: '整理方案', status: '已完成' },
        ]}
        groupMemberships={[
          {
            groupId: 'group-1',
            name: '发布小队',
            responsibility: '统筹、委派与最终总结',
            isLead: true,
          },
        ]}
        onOpenTask={onOpenTask}
      />,
    );

    expect(screen.getByText('最近任务')).toBeTruthy();
    expect(screen.getByText('所在群聊')).toBeTruthy();
    expect(screen.getByText('发布小队')).toBeTruthy();
    expect(screen.getByText('统筹、委派与最终总结')).toBeTruthy();
    expect(screen.getByText('主智能体')).toBeTruthy();
    expect(screen.queryByText(/后续接入/)).toBeNull();

    fireEvent.click(screen.getByTestId('agent-workspace-tab-tasks'));
    fireEvent.click(screen.getByRole('button', { name: '打开任务 修复登录' }));
    expect(onOpenTask).toHaveBeenCalledWith('task-2');
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
    fireEvent.change(screen.getByLabelText('工作指令'), {
      target: { value: 'Plan, execute, then review.' },
    });
    fireEvent.click(screen.getByTestId('agent-definition-save'));
    expect(onSaveDefinition).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: binding.agentId,
        expectedVersion: 2,
        developerInstructions: 'Plan, execute, then review.',
        inputContract: 'Task context',
        outputContract: 'Reviewed artifact',
        memoryScope: 'task',
      }),
    );

    fireEvent.click(screen.getByTestId('agent-workspace-tab-versions'));
    expect(screen.getAllByTestId(/agent-version-/)).toHaveLength(2);
    expect(screen.getByTestId('agent-version-av1').textContent).toContain('av1');
    expect(screen.getByTestId('agent-version-av1').textContent).toMatch(/指令|输出契约|记忆范围/);
  });

  it('preserves operational fields while editing visible Agent identity fields', () => {
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
    fireEvent.click(screen.getByTestId('agent-definition-save'));

    expect(onSaveDefinition).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Coordinates execution and review.',
        visualIdentity: { icon: 'workflow', color: '#227755' },
        mcpToolAllowlist: ['read_file'],
        permissions: complete.permissions,
        reviewBehavior: complete.reviewBehavior,
        artifactRules: complete.artifactRules,
      }),
    );

    fireEvent.click(screen.getByTestId('agent-workspace-tab-versions'));
    const current = screen.getByTestId(`agent-version-${binding.agentVersionId}`);
    expect(current.getAttribute('data-changes')).toMatch(
      /defaultModelId|defaultCredentialGroupId|pinnedCredentialRefId|pauseOnFailure|fallbackModelIds|skillVersionIds|mcpServerIds|mcpToolAllowlist/,
    );
  });

  it('saves maximum task concurrency in a new Agent version', () => {
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
      maxConcurrency: 4,
      memoryScope: 'task' as const,
      approvalMode: 'full' as const,
    };
    render(
      <AgentWorkspace
        binding={binding}
        models={models}
        definition={definition}
        versions={[
          {
            ...definition,
            agentVersionId: 'av0',
            version: 1,
            maxConcurrency: 2,
            createdAt: '2026-07-17T00:00:00.000Z',
          },
          {
            ...definition,
            createdAt: '2026-07-18T00:00:00.000Z',
          },
        ]}
        onSaveDefinition={onSaveDefinition}
      />,
    );

    fireEvent.click(screen.getByTestId('agent-workspace-tab-instructions'));
    const input = screen.getByTestId('agent-definition-max-concurrency') as HTMLInputElement;
    expect(input.value).toBe('4');
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.click(screen.getByTestId('agent-definition-save'));
    expect(onSaveDefinition).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 2,
        maxConcurrency: 9,
      }),
    );

    fireEvent.click(screen.getByTestId('agent-workspace-tab-versions'));
    expect(screen.getByTestId('agent-version-av1').getAttribute('data-changes')).toContain(
      'maxConcurrency',
    );
  });

  it('picks and saves a managed avatar with the next Agent version', async () => {
    const onSaveDefinition = vi.fn();
    const onPickAvatar = vi.fn().mockResolvedValue({
      avatarPath: 'avatars/agent-avatar.png',
      avatarUrl: 'data:image/png;base64,cGl4ZWw=',
    });
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
          memoryScope: 'task',
          approvalMode: 'full',
          visualIdentity: { icon: 'bot', color: '#0d9488' },
        }}
        onPickAvatar={onPickAvatar}
        onSaveDefinition={onSaveDefinition}
      />,
    );

    fireEvent.click(screen.getByTestId('agent-workspace-tab-instructions'));
    fireEvent.click(screen.getByTestId('agent-definition-avatar-pick'));
    await waitFor(() => {
      expect(
        screen.getByTestId('agent-definition-avatar-preview').querySelector('img')?.src,
      ).toContain('data:image/png;base64,cGl4ZWw=');
    });
    fireEvent.click(screen.getByTestId('agent-definition-save'));

    expect(onPickAvatar).toHaveBeenCalledTimes(1);
    expect(onSaveDefinition).toHaveBeenCalledWith(
      expect.objectContaining({
        visualIdentity: {
          icon: 'bot',
          color: '#0d9488',
          avatarPath: 'avatars/agent-avatar.png',
          avatarUrl: 'data:image/png;base64,cGl4ZWw=',
        },
      }),
    );
  });

  it('renders online, busy, and offline states with stable Agent accent colors', () => {
    const agents = [
      {
        agentId: binding.agentId,
        name: 'Online Agent',
        role: 'planner',
        version: 2,
        statusLabel: '在线',
        visualIdentity: { icon: 'bot', color: '#0d9488' },
      },
      {
        agentId: 'agent-busy',
        name: 'Busy Agent',
        role: 'executor',
        version: 1,
        statusLabel: '忙碌中',
        taskCount: 1,
        visualIdentity: { icon: 'bot', color: '#2563eb' },
      },
      {
        agentId: 'agent-offline',
        name: 'Offline Agent',
        role: 'reviewer',
        version: 3,
        statusLabel: '离线',
        visualIdentity: { icon: 'bot', color: '#dc2626' },
      },
    ];
    const { rerender } = render(
      <AgentWorkspace binding={binding} models={models} agents={agents} />,
    );

    for (const [agentId, status, color] of [
      [binding.agentId, '在线', '#0d9488'],
      ['agent-busy', '忙碌中', '#2563eb'],
      ['agent-offline', '离线', '#dc2626'],
    ] as const) {
      const card = screen.getByTestId(`agent-workspace-card-${agentId}`);
      expect(card.getAttribute('data-status')).toBe(status);
      expect(card.textContent).toContain(status);
      expect(
        card
          .querySelector<HTMLElement>('.st-agent-ws__avatar')
          ?.style.getPropertyValue('--st-agent-color'),
      ).toBe(color);
    }

    rerender(<AgentWorkspace binding={binding} models={models} agents={agents} />);
    expect(
      screen
        .getByTestId('agent-workspace-card-agent-busy')
        .querySelector<HTMLElement>('.st-agent-ws__avatar')
        ?.style.getPropertyValue('--st-agent-color'),
    ).toBe('#2563eb');
  });

  it('filters the friend directory by online, busy, and offline status', () => {
    const agents = [
      {
        agentId: binding.agentId,
        name: 'Online Agent',
        role: 'planner',
        version: 2,
        statusLabel: '在线',
      },
      {
        agentId: 'agent-busy',
        name: 'Busy Agent',
        role: 'executor',
        version: 1,
        statusLabel: '忙碌中',
      },
      {
        agentId: 'agent-offline',
        name: 'Offline Agent',
        role: 'reviewer',
        version: 3,
        statusLabel: '离线',
      },
    ];
    render(<AgentWorkspace binding={binding} models={models} agents={agents} />);

    expect(screen.getByRole('tab', { name: /全部/ }).textContent).toContain('3');
    expect(screen.getByRole('tab', { name: /在线/ }).textContent).toContain('1');
    expect(screen.getByRole('tab', { name: /忙碌/ }).textContent).toContain('1');
    expect(screen.getByRole('tab', { name: /离线/ }).textContent).toContain('1');

    fireEvent.click(screen.getByRole('tab', { name: /忙碌/ }));
    expect(screen.getByTestId('agent-workspace-card-agent-busy')).toBeTruthy();
    expect(screen.queryByTestId(`agent-workspace-card-${binding.agentId}`)).toBeNull();
    expect(screen.queryByTestId('agent-workspace-card-agent-offline')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /离线/ }));
    expect(screen.getByTestId('agent-workspace-card-agent-offline')).toBeTruthy();
    expect(screen.queryByTestId('agent-workspace-card-agent-busy')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /在线/ }));
    expect(screen.getByTestId(`agent-workspace-card-${binding.agentId}`)).toBeTruthy();
    expect(screen.queryByTestId('agent-workspace-card-agent-offline')).toBeNull();
  });

  it.skip('requires an exact backup reviewer for reassignment and clears it for pause or abort', () => {
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

    const save = screen.getByTestId('agent-definition-save') as HTMLButtonElement;
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
    fireEvent.click(screen.getByTestId('agent-definition-save'));
    expect(onSaveDefinition).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reviewBehavior: expect.not.objectContaining({ backupAgentVersionId: expect.anything() }),
      }),
    );
  });

  it.skip('blocks a stale exact backup reviewer that is no longer in the reviewer catalog', () => {
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
    const staleBackup = screen.getByTestId('agent-definition-review-backup') as HTMLSelectElement;
    const save = screen.getByTestId('agent-definition-save') as HTMLButtonElement;
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
