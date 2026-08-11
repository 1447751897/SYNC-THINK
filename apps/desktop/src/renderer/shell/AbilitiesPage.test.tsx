/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AbilitiesPage } from './AbilitiesPage.js';

// AbilitiesPage uses the app dialog for the Skill delete confirmation; the
// dialog provider lives above it in the real tree, so tests stub it here.
vi.mock('./Dialog.js', () => ({
  useDialog: () => ({
    confirm: vi.fn().mockResolvedValue(true),
    alert: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Give the project-bootstrap market entry a remote sourceUrl so the
// remote-install branch can be exercised without network access.
vi.mock('./abilities/capability-market.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./abilities/capability-market.js')>();
  return {
    ...actual,
    SKILL_MARKET: actual.SKILL_MARKET.map((item) =>
      item.slug === 'project-bootstrap'
        ? { ...item, sourceUrl: 'https://example.test/skills/project-bootstrap/SKILL.md' }
        : item,
    ),
  };
});

const runtime = {
  listSkills: vi.fn(),
  importSkill: vi.fn(),
  importRemoteSkill: vi.fn(),
  deleteSkill: vi.fn(),
  setSkillEnabled: vi.fn(),
  getSkill: vi.fn(),
  fetchSkillMd: vi.fn(),
  listMcpServers: vi.fn(),
  registerMcpServer: vi.fn(),
  registerRemoteMcpServer: vi.fn(),
  refreshMcpTools: vi.fn(),
  setMcpServerEnabled: vi.fn(),
  deleteMcpServer: vi.fn(),
  listCapabilityGovernance: vi.fn(),
  setCapabilityWorkspaceActive: vi.fn(),
  saveSkillPublishDraft: vi.fn(),
  submitSkillPublishDraft: vi.fn(),
  previewCapabilityOrganize: vi.fn(),
};

beforeEach(() => {
  runtime.listSkills.mockReset().mockResolvedValue({ skills: [] });
  runtime.importSkill.mockReset();
  runtime.importRemoteSkill.mockReset();
  runtime.deleteSkill.mockReset().mockResolvedValue({ deleted: true, skillVersionId: 'sv-1' });
  runtime.setSkillEnabled.mockReset();
  runtime.getSkill.mockReset();
  runtime.fetchSkillMd.mockReset();
  runtime.listMcpServers.mockReset().mockResolvedValue({ servers: [] });
  runtime.registerMcpServer.mockReset();
  runtime.registerRemoteMcpServer.mockReset();
  runtime.refreshMcpTools.mockReset();
  runtime.setMcpServerEnabled.mockReset();
  runtime.deleteMcpServer.mockReset().mockResolvedValue({ deleted: true, mcpServerId: 'mcp-x' });
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
    runtime.listSkills.mockResolvedValueOnce({ skills: [] }).mockResolvedValueOnce({
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

  it('imports a remote Skill URL and moves the user to the installed version', async () => {
    const skill = {
      skillVersionId: 'sv-remote',
      skillId: 'skill-remote',
      name: 'remote-review',
      description: 'Review a remote change.',
      version: '1.2.0',
      originType: 'market' as const,
      originRef: 'https://example.test/SKILL.md',
      allowedTools: [],
      contentFingerprint: 'remote-fingerprint',
      hasScripts: false,
      warnings: [],
      createdAt: '2026-08-10T00:00:00.000Z',
      enabled: true,
    };
    runtime.importRemoteSkill.mockResolvedValue({ skill, deduped: false });
    runtime.listSkills.mockResolvedValueOnce({ skills: [] }).mockResolvedValue({ skills: [skill] });

    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    await waitFor(() => expect(runtime.listSkills).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('open-skill-import'));
    fireEvent.click(screen.getByRole('button', { name: /远端导入/ }));
    fireEvent.change(screen.getByTestId('skill-remote-url-input'), {
      target: { value: skill.originRef },
    });
    fireEvent.click(screen.getByTestId('skill-remote-import-submit'));

    await waitFor(() =>
      expect(runtime.importRemoteSkill).toHaveBeenCalledWith({ url: skill.originRef }),
    );
    expect(await screen.findByText(/已导入远端 Skill/)).toBeTruthy();
    expect(await screen.findByRole('heading', { name: skill.name })).toBeTruthy();
  });

  it('keeps the remote Skill dialog open and shows a contextual download error', async () => {
    runtime.importRemoteSkill.mockRejectedValue(
      new Error(
        "Error invoking remote method 'runtime:skill-import-remote': RuntimeResponseError: 远端内容返回 404",
      ),
    );

    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    await waitFor(() => expect(runtime.listSkills).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('open-skill-import'));
    fireEvent.click(screen.getByRole('button', { name: /远端导入/ }));
    fireEvent.change(screen.getByTestId('skill-remote-url-input'), {
      target: { value: 'https://example.test/missing/SKILL.md' },
    });
    fireEvent.click(screen.getByTestId('skill-remote-import-submit'));

    const error = await screen.findByRole('alert');
    expect(error.textContent).toContain('远端内容返回 404');
    expect(error.textContent).not.toContain('Error invoking remote method');
    expect(error.textContent).not.toContain('RuntimeResponseError');
    expect(screen.getByTestId('skill-remote-url-input')).toBeTruthy();
  });

  it('keeps the Skill save action visible without relying on hover', async () => {
    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    await waitFor(() => expect(runtime.listSkills).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('open-skill-import'));
    fireEvent.click(screen.getByRole('button', { name: /本地创建/ }));

    const save = screen.getByTestId('import-skill-submit') as HTMLButtonElement;
    expect(save.textContent).toContain('保存');
    expect(save.disabled).toBe(false);
    expect(save.classList.contains('capability-button--primary')).toBe(true);
  });

  it('rejects an oversized local Skill before reading it into Renderer memory', async () => {
    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    await waitFor(() => expect(runtime.listSkills).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('open-skill-import'));
    fireEvent.click(screen.getByRole('button', { name: /本地创建/ }));
    const text = vi.fn();
    fireEvent.change(screen.getByTestId('skill-file-input'), {
      target: { files: [{ name: 'oversized.md', size: 512_001, text }] },
    });

    expect((await screen.findByRole('alert')).textContent).toContain('文件超过 512,000 字节限制');
    expect(text).not.toHaveBeenCalled();
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

  it('does not show the Skill activation-path note in MCP management', async () => {
    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    fireEvent.click(screen.getByTestId('abilities-section-mcp'));
    fireEvent.click(screen.getByTestId('mcp-tab-mine'));

    await waitFor(() => expect(runtime.listMcpServers).toHaveBeenCalledWith({ limit: 100 }));
    expect(screen.queryByText('Skill 有两条生效路径')).toBeNull();
  });

  it('registers a remote MCP with a one-time secret and shows only auth status', async () => {
    const secret = 'key-only-entered-once';
    const server = {
      mcpServerId: 'mcp-remote',
      name: 'Remote Search',
      transport: 'remote-http' as const,
      endpoint: 'https://mcp.example.test/rpc',
      tools: [{ name: 'search', description: 'Search remote documents.' }],
      trusted: false,
      enabled: true,
      maxOutputBytes: 1_000_000,
      timeoutMs: 30_000,
      notes: '',
      authConfigured: true,
      authScheme: 'bearer' as const,
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    };
    runtime.listMcpServers
      .mockResolvedValueOnce({ servers: [] })
      .mockResolvedValue({ servers: [server] });
    runtime.registerRemoteMcpServer.mockResolvedValue({
      server,
      updated: false,
      endpoint: server.endpoint,
      authConfigured: true,
      discovered: true,
    });

    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    fireEvent.click(screen.getByTestId('abilities-section-mcp'));
    await waitFor(() => expect(runtime.listMcpServers).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('mcp-register-open'));
    fireEvent.change(screen.getByTestId('mcp-name-input'), {
      target: { value: server.name },
    });
    fireEvent.change(screen.getByTestId('mcp-transport-select'), {
      target: { value: 'remote-http' },
    });
    fireEvent.change(screen.getByTestId('mcp-endpoint-input'), {
      target: { value: server.endpoint },
    });

    const submit = screen.getByTestId('mcp-register-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    const keyInput = screen.getByTestId('mcp-api-key-input') as HTMLInputElement;
    expect(keyInput.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: '显示服务 Key' }));
    expect(keyInput.type).toBe('text');
    fireEvent.change(keyInput, { target: { value: secret } });
    fireEvent.change(screen.getByDisplayValue('API Key'), {
      target: { value: 'bearer' },
    });
    fireEvent.click(submit);

    await waitFor(() =>
      expect(runtime.registerRemoteMcpServer).toHaveBeenCalledWith({
        name: server.name,
        transport: 'remote-http',
        endpoint: server.endpoint,
        notes: '',
        trusted: false,
        apiKey: secret,
        authScheme: 'bearer',
        discoverTools: true,
      }),
    );
    expect(await screen.findByText('已配置 Bearer Token')).toBeTruthy();
    expect(await screen.findByText('search')).toBeTruthy();
    expect(screen.queryByText(secret)).toBeNull();
    expect(screen.queryByDisplayValue(secret)).toBeNull();
  });

  it('reports partial MCP registration when tool discovery fails', async () => {
    const server = {
      mcpServerId: 'mcp-discovery-failed',
      name: 'Unreachable MCP',
      transport: 'remote-http' as const,
      endpoint: 'https://mcp.example.test/unreachable',
      tools: [{ name: 'preserved_tool', description: 'Previously discovered.' }],
      trusted: false,
      enabled: true,
      maxOutputBytes: 1_000_000,
      timeoutMs: 30_000,
      notes: '',
      authConfigured: true,
      authScheme: 'api-key' as const,
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    };
    runtime.listMcpServers
      .mockResolvedValueOnce({ servers: [] })
      .mockResolvedValue({ servers: [server] });
    runtime.registerRemoteMcpServer.mockResolvedValue({
      server,
      updated: true,
      endpoint: server.endpoint,
      authConfigured: true,
      discovered: false,
      discoveryError: '远端 MCP 请求失败：HTTP 401',
    });

    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    fireEvent.click(screen.getByTestId('abilities-section-mcp'));
    fireEvent.click(screen.getByTestId('mcp-register-open'));
    fireEvent.change(screen.getByTestId('mcp-name-input'), { target: { value: server.name } });
    fireEvent.change(screen.getByTestId('mcp-transport-select'), {
      target: { value: 'remote-http' },
    });
    fireEvent.change(screen.getByTestId('mcp-endpoint-input'), {
      target: { value: server.endpoint },
    });
    fireEvent.change(screen.getByTestId('mcp-api-key-input'), {
      target: { value: 'one-time-key' },
    });
    fireEvent.click(screen.getByTestId('mcp-register-submit'));

    const error = await screen.findByRole('alert');
    expect(error.textContent).toContain('MCP 配置已更新，但工具发现失败');
    expect(error.textContent).toContain('HTTP 401');
    expect(await screen.findByText('preserved_tool')).toBeTruthy();
    expect(screen.queryByText('已更新 MCP：Unreachable MCP')).toBeNull();
  });

  it('keeps the Skill editor open while save is in flight', async () => {
    let resolveImport!: (value: unknown) => void;
    runtime.importSkill.mockReturnValue(
      new Promise((resolve) => {
        resolveImport = resolve;
      }),
    );
    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    await waitFor(() => expect(runtime.listSkills).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('open-skill-import'));
    fireEvent.click(screen.getByRole('button', { name: /本地创建/ }));
    fireEvent.click(screen.getByTestId('import-skill-submit'));

    expect(await screen.findByText('保存中')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeTruthy();
    const close = screen.getByRole('button', { name: '关闭 Skill 编辑' }) as HTMLButtonElement;
    expect(close.disabled).toBe(true);

    resolveImport({
      skill: {
        skillVersionId: 'sv-saving',
        skillId: 'skill-saving',
        name: 'my-skill',
        description: '描述这个 Skill 的作用',
        version: '1.0.0',
        allowedTools: [],
        contentFingerprint: 'saving-fingerprint',
        hasScripts: false,
        warnings: [],
        createdAt: '2026-08-10T00:00:00.000Z',
      },
      deduped: false,
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps the MCP registration dialog open while its Key is being saved', async () => {
    const server = {
      mcpServerId: 'mcp-saving',
      name: 'Saving MCP',
      transport: 'remote-http' as const,
      endpoint: 'https://mcp.example.test/saving',
      tools: [{ name: 'saved_tool', description: 'Saved tool.' }],
      trusted: false,
      enabled: true,
      maxOutputBytes: 1_000_000,
      timeoutMs: 30_000,
      notes: '',
      authConfigured: true,
      authScheme: 'api-key' as const,
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    };
    let resolveRegister!: (value: unknown) => void;
    runtime.registerRemoteMcpServer.mockReturnValue(
      new Promise((resolve) => {
        resolveRegister = resolve;
      }),
    );
    runtime.listMcpServers
      .mockResolvedValueOnce({ servers: [] })
      .mockResolvedValue({ servers: [server] });

    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    fireEvent.click(screen.getByTestId('abilities-section-mcp'));
    fireEvent.click(screen.getByTestId('mcp-register-open'));
    fireEvent.change(screen.getByTestId('mcp-name-input'), { target: { value: server.name } });
    fireEvent.change(screen.getByTestId('mcp-transport-select'), {
      target: { value: 'remote-http' },
    });
    fireEvent.change(screen.getByTestId('mcp-endpoint-input'), {
      target: { value: server.endpoint },
    });
    fireEvent.change(screen.getByTestId('mcp-api-key-input'), {
      target: { value: 'saving-key' },
    });
    fireEvent.click(screen.getByTestId('mcp-register-submit'));

    expect(await screen.findByText('保存中')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('heading', { name: '注册 MCP' })).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: '关闭 MCP 注册' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    resolveRegister({
      server,
      updated: false,
      endpoint: server.endpoint,
      authConfigured: true,
      discovered: true,
    });
    expect(await screen.findByRole('heading', { name: server.name })).toBeTruthy();
  });

  it('lets the user add only a Key after AI registered remote MCP metadata', async () => {
    const secret = 'configure-after-ai-registration';
    const server = {
      mcpServerId: 'mcp-ai-registered',
      name: 'AI Registered MCP',
      transport: 'remote-http' as const,
      endpoint: 'https://mcp.example.test/ai-registered',
      tools: [],
      trusted: false,
      enabled: true,
      maxOutputBytes: 1_000_000,
      timeoutMs: 30_000,
      notes: 'Registered by AI without receiving the secret.',
      authConfigured: false,
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    };
    const configured = {
      ...server,
      authConfigured: true,
      authScheme: 'api-key' as const,
      tools: [{ name: 'lookup', description: 'Lookup remote data.' }],
    };
    runtime.listMcpServers
      .mockResolvedValueOnce({ servers: [server] })
      .mockResolvedValue({ servers: [configured] });
    runtime.registerRemoteMcpServer.mockResolvedValue({
      server: configured,
      updated: true,
      endpoint: configured.endpoint,
      authConfigured: true,
      discovered: true,
    });

    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    fireEvent.click(screen.getByTestId('abilities-section-mcp'));
    fireEvent.click(screen.getByTestId('mcp-tab-mine'));
    fireEvent.click(await screen.findByRole('button', { name: /AI Registered MCP/ }));
    fireEvent.click(await screen.findByTestId('mcp-configure-key'));

    const name = screen.getByTestId('mcp-name-input') as HTMLInputElement;
    const transport = screen.getByTestId('mcp-transport-select') as HTMLSelectElement;
    const endpoint = screen.getByTestId('mcp-endpoint-input') as HTMLInputElement;
    expect(name.readOnly).toBe(true);
    expect(name.value).toBe(server.name);
    expect(transport.disabled).toBe(true);
    expect(endpoint.readOnly).toBe(true);
    expect(endpoint.value).toBe(server.endpoint);

    fireEvent.change(screen.getByTestId('mcp-api-key-input'), {
      target: { value: secret },
    });
    fireEvent.click(screen.getByTestId('mcp-register-submit'));

    await waitFor(() =>
      expect(runtime.registerRemoteMcpServer).toHaveBeenCalledWith({
        name: server.name,
        transport: 'remote-http',
        endpoint: server.endpoint,
        notes: server.notes,
        trusted: false,
        apiKey: secret,
        authScheme: 'api-key',
        discoverTools: true,
      }),
    );
    expect(await screen.findByText('已配置 API Key')).toBeTruthy();
    expect(screen.queryByText(secret)).toBeNull();
  });

  it('echoes a stored MCP Key when reopening the configuration dialog', async () => {
    const server = {
      mcpServerId: 'mcp-key-echo',
      name: 'Key Echo MCP',
      transport: 'remote-http' as const,
      endpoint: 'https://mcp.example.test/key-echo',
      tools: [],
      trusted: true,
      enabled: true,
      maxOutputBytes: 1_000_000,
      timeoutMs: 30_000,
      notes: '',
      authConfigured: true,
      authScheme: 'api-key' as const,
      authKey: 'stored-service-key',
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    };
    runtime.listMcpServers.mockResolvedValue({ servers: [server] });

    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    fireEvent.click(screen.getByTestId('abilities-section-mcp'));
    fireEvent.click(screen.getByTestId('mcp-tab-mine'));
    fireEvent.click(await screen.findByRole('button', { name: /Key Echo MCP/ }));
    fireEvent.click(await screen.findByTestId('mcp-configure-key'));

    const keyInput = screen.getByTestId('mcp-api-key-input') as HTMLInputElement;
    expect(keyInput.value).toBe('stored-service-key');
    expect(keyInput.type).toBe('password');
    expect(screen.queryByText('Key 由 Runtime 安全保存，列表和日志不会回显。')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '显示服务 Key' }));
    expect(keyInput.type).toBe('text');
    expect(keyInput.value).toBe('stored-service-key');
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
      name: 'automation-workflow',
      description: 'Automate workflows.',
      version: '1.0.0',
      originType: 'market' as const,
      originRef: 'market://skills/automation-workflow',
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
    // 自动化工作流（无 sourceUrl）走内置模板安装分支。
    fireEvent.click(screen.getAllByRole('button', { name: '安装' })[1]!);

    await waitFor(() =>
      expect(runtime.importSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          originType: 'market',
          originRef: 'market://skills/automation-workflow',
        }),
      ),
    );
  });

  it('hides edit and delete actions for market Skills (read-only installs)', async () => {
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
    runtime.listSkills.mockResolvedValue({ skills: [marketSkill] });

    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    fireEvent.click(screen.getByTestId('skill-tab-mine'));
    fireEvent.click(await screen.findByRole('button', { name: /market-skill/ }));

    // 详情抽屉：市场 skill 无「编辑」按钮，也无危险删除按钮（只读安装）
    expect(screen.queryByRole('button', { name: '编辑' })).toBeNull();
    expect(screen.queryByRole('button', { name: /删除/ })).toBeNull();
    // 列表行操作区也无删除按钮（title=删除 Skill）
    expect(screen.queryByTitle('删除 Skill')).toBeNull();
    expect(document.querySelector('.capability-row-actions__danger')).toBeNull();
  });

  it('keeps edit and delete actions for user-created Skills', async () => {
    const localSkill = {
      skillVersionId: 'sv-local',
      skillId: 'skill-local',
      name: 'local-skill',
      description: 'A local Skill.',
      version: '1.0.0',
      originType: 'local' as const,
      allowedTools: [],
      contentFingerprint: 'local-fingerprint',
      hasScripts: false,
      warnings: [],
      createdAt: '2026-08-09T00:00:00.000Z',
      enabled: true,
    };
    runtime.listSkills.mockResolvedValue({ skills: [localSkill] });

    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    fireEvent.click(screen.getByTestId('skill-tab-mine'));
    fireEvent.click(await screen.findByRole('button', { name: /local-skill/ }));

    // 用户自己的 skill：编辑与删除按钮都保留
    expect(screen.getByRole('button', { name: '编辑' })).toBeTruthy();
    expect(document.querySelector('.capability-row-actions__danger')).toBeTruthy();
  });

  it('keeps the Skill effect-path explanation concise in the detail drawer', async () => {
    const skill = {
      skillVersionId: 'sv-path',
      skillId: 'skill-path',
      name: 'path-skill',
      description: 'A path skill.',
      version: '1.0.0',
      allowedTools: ['read-file'],
      contentFingerprint: 'path-fingerprint',
      hasScripts: false,
      warnings: [],
      createdAt: '2026-08-09T00:00:00.000Z',
      enabled: true,
    };
    runtime.listSkills.mockResolvedValue({ skills: [skill] });

    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    fireEvent.click(screen.getByTestId('skill-tab-mine'));
    fireEvent.click(await screen.findByRole('button', { name: /path-skill/ }));

    expect(
      screen.getByText(
        'Compose 需工作区激活；Agent / Team 按自身绑定注入；全局停用会阻断两条路径。',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/所在工作区是否激活不影响默认注入/)).toBeNull();
  });

  it('installs a market Skill from its remote sourceUrl when present', async () => {
    const remoteSkill = {
      skillVersionId: 'sv-remote-market',
      skillId: 'skill-remote-market',
      name: 'remote-market-skill',
      description: 'Installed from remote.',
      version: '2.0.0',
      originType: 'market' as const,
      originRef: 'market://skills/remote-market-skill',
      allowedTools: [],
      contentFingerprint: 'remote-market-fingerprint',
      hasScripts: false,
      warnings: [],
      createdAt: '2026-08-09T00:00:00.000Z',
      enabled: true,
    };
    runtime.importRemoteSkill.mockResolvedValue({ skill: remoteSkill, deduped: false });

    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    // 市场 tab → 打开带 sourceUrl 的条目 → 安装
    fireEvent.click(screen.getByRole('tab', { name: /Skill 市场/ }));
    const card = await screen.findByRole('button', { name: /项目初始化/ });
    fireEvent.click(card);
    fireEvent.click(screen.getByRole('button', { name: /安装 Skill/ }));

    await waitFor(() =>
      expect(runtime.importRemoteSkill).toHaveBeenCalledWith({
        url: 'https://example.test/skills/project-bootstrap/SKILL.md',
        originRef: 'market://skills/project-bootstrap',
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

  it('keeps the previous MCP catalog visible when refresh fails', async () => {
    const server = {
      mcpServerId: 'mcp-refresh-failed',
      name: 'Preserved MCP',
      transport: 'remote-http' as const,
      endpoint: 'https://mcp.example.test/preserved',
      tools: [{ name: 'preserved_tool', description: 'Keep this tool.' }],
      trusted: false,
      maxOutputBytes: 1_000_000,
      timeoutMs: 30_000,
      notes: '',
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
      enabled: true,
    };
    runtime.listMcpServers.mockResolvedValue({ servers: [server] });
    runtime.refreshMcpTools.mockResolvedValue({
      ok: false,
      toolCount: 1,
      previousToolCount: 1,
      tools: server.tools,
      refuseReason: '远端 MCP 请求失败：HTTP 401',
    });

    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    fireEvent.click(screen.getByTestId('abilities-section-mcp'));
    fireEvent.click(screen.getByTestId('mcp-tab-mine'));
    fireEvent.click(await screen.findByRole('button', { name: /Preserved MCP/ }));
    expect(await screen.findByText('preserved_tool')).toBeTruthy();
    fireEvent.click(screen.getByTestId('mcp-detail-refresh'));

    const error = await screen.findByRole('alert');
    expect(error.textContent).toContain('刷新 MCP 工具失败');
    expect(error.textContent).toContain('HTTP 401');
    expect(screen.getByText('preserved_tool')).toBeTruthy();
    expect(screen.queryByText('已发现 1 个 MCP 工具')).toBeNull();
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

  it('deletes a Skill from the governance list row', async () => {
    runtime.listSkills.mockResolvedValue({
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
    runtime.listCapabilityGovernance.mockResolvedValue({
      workspaceId: 'default-workspace',
      windowDays: 45,
      skills: [
        {
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
          workspaceActive: true,
          usage: {
            capabilityType: 'skill',
            capabilityId: 'sv-1',
            callCount: 0,
            successCount: 0,
            failedCount: 0,
            cancelledCount: 0,
            problemCount: 0,
            contextTokens: 0,
          },
        },
      ],
      mcpServers: [],
    });

    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    await waitFor(() => expect(runtime.listSkills).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('skill-tab-mine'));
    await waitFor(() => expect(screen.getByText('review')).toBeTruthy());

    const deleteButton = screen.getByTitle('删除 Skill');
    expect(deleteButton).toBeTruthy();
    fireEvent.click(deleteButton);

    await waitFor(() =>
      expect(runtime.deleteSkill).toHaveBeenCalledWith({ skillVersionId: 'sv-1' }),
    );
    expect(await screen.findByText(/已删除：review/)).toBeTruthy();
  });

  it('renders MCP connection info as a labeled card grid with status chips', async () => {
    const server = {
      mcpServerId: 'mcp-conn',
      name: 'Conn MCP',
      transport: 'remote-http' as const,
      endpoint: 'https://mcp.example.com',
      tools: [{ name: 'ping', description: 'Ping.' }],
      trusted: true,
      authConfigured: true,
      authScheme: 'api-key' as const,
      timeoutMs: 30000,
      maxOutputBytes: 131072,
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    };
    runtime.listMcpServers.mockResolvedValue({ servers: [server] });

    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    fireEvent.click(screen.getByTestId('abilities-section-mcp'));
    fireEvent.click(screen.getByTestId('mcp-tab-mine'));
    fireEvent.click(await screen.findByRole('button', { name: /Conn MCP/ }));

    // 连接信息为卡片网格 + 状态徽标
    const cards = document.querySelectorAll('.capability-detail-card');
    expect(cards.length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByText('https://mcp.example.com').length).toBeGreaterThanOrEqual(1);
    const chips = document.querySelectorAll('.capability-status-chip');
    expect(chips.length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/已配置 API Key/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('可信来源').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('30,000 ms').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/131k bytes/).length).toBeGreaterThanOrEqual(1);
  });

  it('collapses MCP tool descriptions by default and expands on click', async () => {
    const server = {
      mcpServerId: 'mcp-tools',
      name: 'Tools MCP',
      transport: 'local-stdio' as const,
      endpoint: 'stdio://tools-mcp',
      tools: [
        {
          name: 'lookup',
          description:
            'A very long tool description that exceeds the single-line clamp and should be truncated with an ellipsis in the collapsed state.',
        },
      ],
      trusted: true,
      authConfigured: false,
      timeoutMs: 15000,
      maxOutputBytes: 65536,
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    };
    runtime.listMcpServers.mockResolvedValue({ servers: [server] });

    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    fireEvent.click(screen.getByTestId('abilities-section-mcp'));
    fireEvent.click(screen.getByTestId('mcp-tab-mine'));
    fireEvent.click(await screen.findByRole('button', { name: /Tools MCP/ }));

    // 初始折叠：描述一行截断（data-expanded=0），chevron 未旋转
    const desc = (await screen.findByText(/very long tool description/)).closest(
      '.capability-mcp-tool-item__desc',
    ) as HTMLElement;
    expect(desc.getAttribute('data-expanded')).toBe('0');

    // 点击行头展开
    fireEvent.click(screen.getByRole('button', { name: /lookup/ }));
    expect(desc.getAttribute('data-expanded')).toBe('1');

    // 再点收起
    fireEvent.click(screen.getByRole('button', { name: /lookup/ }));
    expect(desc.getAttribute('data-expanded')).toBe('0');
  });

  it('deletes a registered MCP server from the detail drawer', async () => {
    const server = {
      mcpServerId: 'mcp-del',
      name: 'Delete Me MCP',
      transport: 'local-stdio' as const,
      endpoint: 'stdio://delete-me',
      tools: [{ name: 'ping', description: 'Ping.' }],
      trusted: false,
      authConfigured: false,
      timeoutMs: 15000,
      maxOutputBytes: 65536,
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    };
    runtime.listMcpServers.mockResolvedValue({ servers: [server] });

    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    fireEvent.click(screen.getByTestId('abilities-section-mcp'));
    fireEvent.click(screen.getByTestId('mcp-tab-mine'));
    fireEvent.click(await screen.findByRole('button', { name: /Delete Me MCP/ }));

    // 详情抽屉有删除按钮（data-testid）
    const deleteButton = screen.getByTestId('mcp-detail-delete');
    expect(deleteButton).toBeTruthy();
    fireEvent.click(deleteButton);

    // 确认弹窗 → 确认后调用 deleteMcpServer，抽屉关闭并出现删除提示
    await waitFor(() =>
      expect(runtime.deleteMcpServer).toHaveBeenCalledWith({ mcpServerId: 'mcp-del' }),
    );
    expect(await screen.findByText(/已删除 MCP：Delete Me MCP/)).toBeTruthy();
  });
});
