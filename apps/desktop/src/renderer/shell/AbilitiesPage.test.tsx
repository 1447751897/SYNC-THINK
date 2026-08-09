/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AbilitiesPage } from './AbilitiesPage.js';

const runtime = {
  listSkills: vi.fn(),
  importSkill: vi.fn(),
  deleteSkill: vi.fn(),
  setSkillEnabled: vi.fn(),
  getSkill: vi.fn(),
  fetchSkillMd: vi.fn(),
  listMcpServers: vi.fn(),
  registerMcpServer: vi.fn(),
  refreshMcpTools: vi.fn(),
  setMcpServerEnabled: vi.fn(),
  listCapabilityGovernance: vi.fn(),
  setCapabilityWorkspaceActive: vi.fn(),
  saveSkillPublishDraft: vi.fn(),
  submitSkillPublishDraft: vi.fn(),
  previewCapabilityOrganize: vi.fn(),
};

beforeEach(() => {
  runtime.listSkills.mockReset().mockResolvedValue({ skills: [] });
  runtime.importSkill.mockReset();
  runtime.deleteSkill.mockReset().mockResolvedValue({ deleted: true, skillVersionId: 'sv-1' });
  runtime.setSkillEnabled.mockReset();
  runtime.getSkill.mockReset();
  runtime.fetchSkillMd.mockReset();
  runtime.listMcpServers.mockReset().mockResolvedValue({ servers: [] });
  runtime.registerMcpServer.mockReset();
  runtime.refreshMcpTools.mockReset();
  runtime.setMcpServerEnabled.mockReset();
  runtime.listCapabilityGovernance.mockReset().mockResolvedValue({
    workspaceId: 'default-workspace',
    windowDays: 45,
    skills: [],
    mcpServers: [],
  });
  runtime.setCapabilityWorkspaceActive.mockReset().mockResolvedValue({});
  runtime.saveSkillPublishDraft.mockReset();
  runtime.submitSkillPublishDraft.mockReset();
  runtime.previewCapabilityOrganize.mockReset().mockResolvedValue({
    report: {
      workspaceId: 'default-workspace',
      generatedAt: '2026-08-09T00:00:00.000Z',
      windowDays: 45,
      contextBudgetTokens: 15_000,
      summary: {
        capabilityCount: 0,
        unusedCount: 0,
        inactiveCount: 0,
        problematicCount: 0,
        contextWarningCount: 0,
        highContextCount: 0,
      },
      categories: {
        unused: [],
        inactive: [],
        problematic: [],
        contextWarning: [],
        highContext: [],
      },
    },
  });
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: { runtime },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AbilitiesPage', () => {
  it('imports pasted SKILL.md and refreshes the catalog', async () => {
    const source = '---\nname: review\nversion: 0.1.0\n---\n\nReview carefully.';
    runtime.importSkill.mockResolvedValue({
      skill: {
        skillVersionId: 'sv-1',
        skillId: 'skill-review',
        name: 'review',
        description: 'Review carefully',
        version: '0.1.0',
        allowedTools: [],
        contentFingerprint: 'abc12345',
        hasScripts: false,
        warnings: [],
        createdAt: '2026-07-26T00:00:00.000Z',
      },
      deduped: false,
    });
    runtime.listSkills
      .mockResolvedValueOnce({ skills: [] })
      .mockResolvedValueOnce({
        skills: [
          {
            skillVersionId: 'sv-1',
            skillId: 'skill-review',
            name: 'review',
            description: 'Review carefully',
            version: '0.1.0',
            allowedTools: [],
            contentFingerprint: 'abc12345',
            hasScripts: false,
            warnings: [],
            createdAt: '2026-07-26T00:00:00.000Z',
          },
        ],
      });
    const changed = vi.fn();

    render(<AbilitiesPage onGoToAgents={vi.fn()} onCatalogChanged={changed} />);
    await waitFor(() => expect(runtime.listSkills).toHaveBeenCalledWith({ limit: 500 }));
    fireEvent.click(screen.getByTestId('skill-tab-mine'));
    await waitFor(() => expect(screen.getByText('能力库还是空的')).toBeTruthy());
    fireEvent.click(screen.getByTestId('open-skill-import'));
    fireEvent.click(screen.getByRole('button', { name: /本地创建/ }));
    fireEvent.change(screen.getByTestId('skill-md-input'), { target: { value: source } });
    fireEvent.click(screen.getByTestId('import-skill-submit'));

    await waitFor(() => expect(runtime.importSkill).toHaveBeenCalledWith({ skillMd: source }));
    await waitFor(() => expect(screen.getAllByText('review').length).toBeGreaterThan(0));
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('shows an actionable error instead of an empty library when list fails', async () => {
    runtime.listSkills.mockRejectedValue(new Error('pipe unavailable'));
    render(<AbilitiesPage onGoToAgents={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('能力库加载失败')).toBeTruthy());
    expect(screen.getByText('pipe unavailable')).toBeTruthy();
  });

  it('keeps installed Skill descriptions in the identity copy column', async () => {
    runtime.listSkills.mockResolvedValue({
      skills: [
        {
          skillVersionId: 'sv-review',
          skillId: 'skill-review',
          name: 'code-review',
          description: '按严重程度发现缺陷，并给出可执行的修改建议',
          version: '0.1.0',
          allowedTools: ['read-file'],
          contentFingerprint: 'abc12345',
          hasScripts: false,
          warnings: [],
          createdAt: '2026-07-26T00:00:00.000Z',
        },
      ],
    });

    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    fireEvent.click(screen.getByTestId('skill-tab-mine'));

    const description = await screen.findByText('按严重程度发现缺陷，并给出可执行的修改建议');
    expect(description.tagName).toBe('SMALL');
    expect(description.parentElement?.classList.contains('ability-installed-row__copy')).toBe(true);
  });

  it('registers an MCP server from the shared management surface', async () => {
    const server = {
      mcpServerId: 'mcp-filesystem',
      name: 'Workspace Files',
      transport: 'local-stdio',
      endpoint: 'node filesystem-server.mjs',
      tools: [{ name: 'read_file', description: 'Read a workspace file.' }],
      trusted: true,
      maxOutputBytes: 1_000_000,
      timeoutMs: 30_000,
      notes: 'Workspace-only filesystem tools.',
      createdAt: '2026-08-09T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
    };
    runtime.listMcpServers
      .mockResolvedValueOnce({ servers: [] })
      .mockResolvedValue({ servers: [server] });
    runtime.registerMcpServer.mockResolvedValue({ server, updated: false });

    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    fireEvent.click(screen.getByTestId('abilities-section-mcp'));
    await waitFor(() => expect(runtime.listMcpServers).toHaveBeenCalledWith({ limit: 100 }));

    fireEvent.click(screen.getByTestId('mcp-register-open'));
    fireEvent.change(screen.getByTestId('mcp-name-input'), {
      target: { value: server.name },
    });
    fireEvent.change(screen.getByPlaceholderText('填写 MCP 启动命令'), {
      target: { value: server.endpoint },
    });
    fireEvent.click(screen.getByText('标记为可信来源'));
    fireEvent.click(screen.getByTestId('mcp-register-submit'));

    await waitFor(() =>
      expect(runtime.registerMcpServer).toHaveBeenCalledWith({
        name: server.name,
        transport: 'local-stdio',
        endpoint: server.endpoint,
        notes: '',
        trusted: true,
      }),
    );
    expect(await screen.findByText('read_file')).toBeTruthy();
    expect(await screen.findByText(/已注册 MCP/)).toBeTruthy();
  });

  it('keeps the activation-code entry and exposes the local channel placeholder', async () => {
    render(<AbilitiesPage onGoToAgents={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Skill 激活码' }));

    expect(await screen.findByText('Skill 激活码渠道筹备中')).toBeTruthy();
  });

  it('installs a market Skill with stable origin metadata', async () => {
    const installed = {
      skillVersionId: 'sv-market',
      skillId: 'skill-market',
      name: 'project-bootstrap',
      description: 'Bootstrap a project.',
      version: '1.0.0',
      originType: 'market' as const,
      originRef: 'market://skills/project-bootstrap',
      allowedTools: [],
      contentFingerprint: 'market-fingerprint',
      hasScripts: false,
      warnings: [],
      createdAt: '2026-08-09T00:00:00.000Z',
      enabled: true,
    };
    runtime.importSkill.mockResolvedValue({ skill: installed, deduped: false });
    runtime.listSkills.mockResolvedValue({ skills: [installed] });

    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    fireEvent.click(screen.getAllByRole('button', { name: '安装' })[0]!);

    await waitFor(() =>
      expect(runtime.importSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          originType: 'market',
          originRef: 'market://skills/project-bootstrap',
        }),
      ),
    );
  });

  it('creates a derived Skill version when editing a market Skill', async () => {
    const marketSkill = {
      skillVersionId: 'sv-market',
      skillId: 'skill-market',
      name: 'market-skill',
      description: 'A market Skill.',
      version: '1.0.0',
      originType: 'market' as const,
      originRef: 'market://skills/project-bootstrap',
      allowedTools: [],
      contentFingerprint: 'market-fingerprint',
      hasScripts: false,
      warnings: [],
      createdAt: '2026-08-09T00:00:00.000Z',
      enabled: true,
    };
    const source = `---
name: market-skill
description: A market Skill.
version: 1.0.0
---

Follow the market workflow.`;
    const editedSource = `---
name: market-skill
description: A derived Skill.
version: 1.0.1
---

Follow the edited workflow.`;
    const derivedSkill = {
      ...marketSkill,
      skillVersionId: 'sv-derived',
      description: 'A derived Skill.',
      version: '1.0.1',
      originType: 'derived' as const,
      derivedFromSkillVersionId: 'sv-market',
    };
    runtime.listSkills.mockResolvedValue({ skills: [marketSkill] });
    runtime.getSkill.mockResolvedValue({ skill: marketSkill, sourceMd: source });
    runtime.importSkill.mockResolvedValue({ skill: derivedSkill, deduped: false });

    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    fireEvent.click(screen.getByTestId('skill-tab-mine'));
    fireEvent.click(await screen.findByRole('button', { name: /market-skill/ }));
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    fireEvent.change(await screen.findByTestId('skill-md-input'), {
      target: { value: editedSource },
    });
    fireEvent.click(screen.getByTestId('import-skill-submit'));

    await waitFor(() =>
      expect(runtime.importSkill).toHaveBeenLastCalledWith({
        skillMd: editedSource,
        originType: 'derived',
        originRef: 'market://skills/project-bootstrap',
        derivedFromSkillVersionId: 'sv-market',
        skillId: 'skill-market',
      }),
    );
  });

  it('updates global enablement and workspace activation independently', async () => {
    const skill = {
      skillVersionId: 'sv-governed',
      skillId: 'skill-governed',
      name: 'governed-skill',
      description: 'A governed Skill.',
      version: '1.0.0',
      allowedTools: [],
      contentFingerprint: 'governed-fingerprint',
      hasScripts: false,
      warnings: [],
      createdAt: '2026-08-09T00:00:00.000Z',
      enabled: true,
    };
    runtime.listSkills.mockResolvedValue({ skills: [skill] });
    runtime.setSkillEnabled.mockResolvedValue({});
    runtime.setCapabilityWorkspaceActive.mockResolvedValue({});

    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    fireEvent.click(screen.getByTestId('skill-tab-mine'));
    const globalToggle = await screen.findByRole('switch', {
      name: '停用 governed-skill',
    });
    fireEvent.click(globalToggle);

    await waitFor(() =>
      expect(runtime.setSkillEnabled).toHaveBeenCalledWith({
        skillVersionId: 'sv-governed',
        enabled: false,
      }),
    );
    fireEvent.click(screen.getByTestId('skill-workspace-activation-sv-governed'));

    await waitFor(() =>
      expect(runtime.setCapabilityWorkspaceActive).toHaveBeenCalledWith({
        workspaceId: 'default-workspace',
        capabilityType: 'skill',
        capabilityId: 'sv-governed',
        active: true,
      }),
    );
  });

  it('refreshes MCP tools from both the list row and the detail drawer', async () => {
    const server = {
      mcpServerId: 'mcp-refresh',
      name: 'Refreshable MCP',
      transport: 'local-stdio' as const,
      endpoint: 'node refreshable-mcp.mjs',
      tools: [],
      trusted: true,
      maxOutputBytes: 1_000_000,
      timeoutMs: 30_000,
      notes: 'Refreshable tools.',
      createdAt: '2026-08-09T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
      enabled: true,
    };
    const refreshedServer = {
      ...server,
      tools: [{ name: 'refresh_tool', description: 'A refreshed tool.' }],
    };
    runtime.listMcpServers
      .mockResolvedValueOnce({ servers: [server] })
      .mockResolvedValue({ servers: [refreshedServer] });
    runtime.refreshMcpTools.mockResolvedValue({
      server: refreshedServer,
      toolCount: refreshedServer.tools.length,
    });

    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    fireEvent.click(screen.getByTestId('abilities-section-mcp'));
    fireEvent.click(screen.getByTestId('mcp-tab-mine'));
    await screen.findByText('Refreshable MCP');

    fireEvent.click(screen.getByTestId('mcp-row-refresh-mcp-refresh'));
    await waitFor(() =>
      expect(runtime.refreshMcpTools).toHaveBeenCalledWith({
        mcpServerId: 'mcp-refresh',
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /Refreshable MCP/ }));
    expect(await screen.findByText('refresh_tool')).toBeTruthy();
    fireEvent.click(screen.getByTestId('mcp-detail-refresh'));

    await waitFor(() => expect(runtime.refreshMcpTools).toHaveBeenCalledTimes(2));
  });

  it('opens a read-only organize report with the configured context budget', async () => {
    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    fireEvent.click(screen.getByTestId('skill-tab-mine'));
    fireEvent.click(screen.getByRole('button', { name: '一键整理' }));

    await waitFor(() =>
      expect(runtime.previewCapabilityOrganize).toHaveBeenCalledWith({
        workspaceId: 'default-workspace',
        contextBudgetTokens: 15_000,
      }),
    );
    expect(await screen.findByText('能力整理报告')).toBeTruthy();
  });

  it('saves a local publish draft and keeps submission as a local placeholder', async () => {
    const skill = {
      skillVersionId: 'sv-publish',
      skillId: 'skill-publish',
      name: 'publishable-skill',
      description: 'A publishable Skill.',
      version: '1.0.0',
      allowedTools: [],
      contentFingerprint: 'publish-fingerprint',
      hasScripts: false,
      warnings: [],
      createdAt: '2026-08-09T00:00:00.000Z',
      enabled: true,
    };
    const source = `---
name: publishable-skill
description: A publishable Skill.
version: 1.0.0
---

Publish this workflow.`;
    runtime.listSkills.mockResolvedValue({ skills: [skill] });
    runtime.getSkill.mockResolvedValue({ skill, sourceMd: source });
    runtime.saveSkillPublishDraft.mockResolvedValue({
      draft: {
        id: 'draft-publish',
        skillVersionId: skill.skillVersionId,
        skillId: skill.skillId,
        displayName: skill.name,
        description: skill.description,
        skillMd: source,
        category: '开发工具',
        version: skill.version,
        icon: 'sparkles',
        attachments: [],
        status: 'draft',
        createdAt: '2026-08-09T00:00:00.000Z',
        updatedAt: '2026-08-09T00:00:00.000Z',
      },
    });
    runtime.submitSkillPublishDraft.mockResolvedValue({
      draft: {
        id: 'draft-publish',
        skillVersionId: skill.skillVersionId,
        skillId: skill.skillId,
        displayName: skill.name,
        description: skill.description,
        skillMd: source,
        category: '开发工具',
        version: skill.version,
        icon: 'sparkles',
        attachments: [],
        status: 'submitted',
        createdAt: '2026-08-09T00:00:00.000Z',
        updatedAt: '2026-08-09T00:00:00.000Z',
      },
      message: '市场审核渠道暂未接入',
    });

    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    fireEvent.click(screen.getByTestId('skill-tab-mine'));
    await screen.findByText('publishable-skill');
    fireEvent.click(screen.getByTestId('open-skill-import'));
    fireEvent.click(screen.getByRole('button', { name: /发布到市场/ }));

    await screen.findByRole('button', { name: '保存草稿' });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() =>
      expect(runtime.saveSkillPublishDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          skillVersionId: 'sv-publish',
          skillId: 'skill-publish',
        }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: '提交审核' }));

    await waitFor(() =>
      expect(runtime.submitSkillPublishDraft).toHaveBeenCalledWith({
        id: 'draft-publish',
      }),
    );
    expect(await screen.findByText(/市场审核渠道暂未接入/)).toBeTruthy();
  });
});
