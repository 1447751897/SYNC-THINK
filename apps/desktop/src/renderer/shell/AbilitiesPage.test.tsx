/**
 * @vitest-environment jsdom
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AbilitiesPage } from './AbilitiesPage.js';
import {
  SKILL_DESC_CUT,
  formatCharCount,
  residentDescriptionChars,
} from './abilities/skill-resident-context.js';

class PointerEventPolyfill extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? 'mouse';
    this.isPrimary = init.isPrimary ?? true;
  }
}

const nativePointerEvent = window.PointerEvent;

beforeAll(() => {
  Object.defineProperty(window, 'PointerEvent', {
    configurable: true,
    writable: true,
    value: PointerEventPolyfill,
  });
});

afterAll(() => {
  Object.defineProperty(window, 'PointerEvent', {
    configurable: true,
    writable: true,
    value: nativePointerEvent,
  });
});

// AbilitiesPage uses the app dialog for the Skill delete confirmation; the
// dialog provider lives above it in the real tree, so tests stub it here.
vi.mock('./Dialog.js', () => ({
  useDialog: () => ({
    confirm: vi.fn().mockResolvedValue(true),
    alert: vi.fn().mockResolvedValue(undefined),
  }),
}));

const marketSkills = [
  {
    id: 'project-bootstrap',
    slug: 'project-bootstrap',
    name: '项目初始化',
    category: '开发工具',
    description: '从需求拆解到目录、规范、测试入口和里程碑。',
    author: 'SYNC-THINK',
    version: '1.0.0',
    installCount: 128,
  },
  {
    id: 'automation-workflow',
    slug: 'automation-workflow',
    name: '自动化工作流',
    category: '自动化',
    description: '编排 CI/CD、脚本生成、定时任务与 Git Hooks。',
    author: 'SYNC-THINK',
    version: '1.0.0',
    installCount: 96,
  },
];

const runtime = {
  listSkills: vi.fn(),
  listSkillMarket: vi.fn(),
  installSkillMarket: vi.fn(),
  importSkill: vi.fn(),
  importRemoteSkill: vi.fn(),
  skillLocalScan: vi.fn(),
  skillLocalInspect: vi.fn(),
  skillLocalImport: vi.fn(),
  pickFolder: vi.fn(),
  pickSkillZip: vi.fn(),
  pathForFile: vi.fn(),
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
  listCapabilityWorkspaceActivations: vi.fn(),
  setCapabilityWorkspaceActive: vi.fn(),
  saveSkillPublishDraft: vi.fn(),
  submitSkillPublishDraft: vi.fn(),
  previewCapabilityOrganize: vi.fn(),
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  window.localStorage.clear();
  runtime.listSkills.mockReset().mockResolvedValue({ skills: [] });
  runtime.listSkillMarket.mockReset().mockResolvedValue({ items: marketSkills });
  runtime.installSkillMarket.mockReset();
  runtime.importSkill.mockReset();
  runtime.importRemoteSkill.mockReset();
  runtime.skillLocalScan.mockReset().mockRejectedValue(new Error('local scan not configured'));
  runtime.skillLocalInspect.mockReset();
  runtime.skillLocalImport.mockReset();
  runtime.pickFolder.mockReset();
  runtime.pickSkillZip.mockReset();
  runtime.pathForFile.mockReset();
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
  runtime.listCapabilityWorkspaceActivations.mockReset().mockResolvedValue({ activations: [] });
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
  it('opens the real Skill editor from a navigation request and replays only for a new key', async () => {
    const { rerender } = render(
      <AbilitiesPage
        initialView="create-skill"
        navigationKey="create-skill-1"
        onGoToAgents={vi.fn()}
      />,
    );

    const editor = await screen.findByRole('dialog', { name: '创建 Skill' });
    expect(screen.getByTestId('skill-md-input')).toBeTruthy();
    expect(screen.getByTestId('import-skill-submit')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭 Skill 编辑' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '创建 Skill' })).toBeNull());

    rerender(
      <AbilitiesPage
        initialView="create-skill"
        navigationKey="create-skill-1"
        onGoToAgents={vi.fn()}
      />,
    );
    expect(screen.queryByRole('dialog', { name: '创建 Skill' })).toBeNull();

    rerender(
      <AbilitiesPage
        initialView="create-skill"
        navigationKey="create-skill-2"
        onGoToAgents={vi.fn()}
      />,
    );
    expect(await screen.findByRole('dialog', { name: '创建 Skill' })).toBeTruthy();
    expect(editor.textContent).toContain('每次保存都会创建一个不可变的新版本');
  });

  it('imports a complete local Skill folder and refreshes the catalog', async () => {
    const skill = {
      skillVersionId: 'sv-1',
      skillId: 'skill-review',
      name: 'review',
      description: 'Review carefully',
      version: '0.1.0',
      originType: 'local' as const,
      originRef: 'C:\\skills\\review\\SKILL.md',
      allowedTools: [],
      contentFingerprint: 'abc12345',
      hasScripts: true,
      warnings: [],
      createdAt: '2026-07-26T00:00:00.000Z',
    };
    runtime.pickFolder.mockResolvedValue({ canceled: false, path: 'C:\\skills\\review' });
    runtime.skillLocalInspect.mockResolvedValue({
      sourcePath: 'C:\\skills\\review',
      sourceType: 'folder',
      skills: [
        {
          folderName: 'review',
          name: 'review',
          description: 'Review carefully',
          skillDirectory: 'C:\\skills\\review',
          skillMdPath: 'C:\\skills\\review\\SKILL.md',
          hasScripts: true,
        },
      ],
    });
    runtime.skillLocalImport.mockResolvedValue({
      skill,
      deduped: false,
      path: skill.originRef,
      sourcePath: 'C:\\skills\\review',
      installedPaths: ['C:\\Users\\test\\.sync-think\\skills\\review'],
      skillNames: ['review'],
      imports: [{ skill, deduped: false }],
      conflictNames: [],
      scope: { type: 'global' },
    });
    runtime.skillLocalScan
      .mockRejectedValueOnce(new Error('initial scan skipped'))
      .mockResolvedValue({
        directory: 'C:\\Users\\test\\.sync-think\\skills',
        candidates: [],
        exists: true,
        watching: true,
        sources: [],
      });
    runtime.listSkills.mockResolvedValueOnce({ skills: [] }).mockResolvedValueOnce({
      skills: [skill],
    });
    const changed = vi.fn();

    render(<AbilitiesPage onGoToAgents={vi.fn()} onCatalogChanged={changed} />);
    await waitFor(() => expect(runtime.listSkills).toHaveBeenCalledWith({ limit: 500 }));
    fireEvent.click(screen.getByTestId('skill-tab-mine'));
    await waitFor(() => expect(screen.getByText('还没有 Skill')).toBeTruthy());
    fireEvent.click(screen.getByTestId('open-skill-import'));
    fireEvent.click(screen.getByRole('menuitem', { name: '导入' }));
    fireEvent.click(screen.getByRole('button', { name: '选择文件夹' }));
    await screen.findByTitle('C:\\skills\\review');
    fireEvent.change(screen.getByPlaceholderText('为你的 Skill 起个名字'), {
      target: { value: '代码审查工作流' },
    });
    fireEvent.change(screen.getByPlaceholderText('简要描述这个 Skill 的功能和用途'), {
      target: { value: '显示层描述，不改写 SKILL.md' },
    });
    fireEvent.click(screen.getByTestId('skill-local-import-submit'));

    await waitFor(() =>
      expect(runtime.skillLocalImport).toHaveBeenCalledWith({
        path: 'C:\\skills\\review',
        scope: { type: 'global' },
      }),
    );
    await waitFor(() => expect(screen.getByText('代码审查工作流')).toBeTruthy());
    expect(screen.getByText('显示层描述，不改写 SKILL.md')).toBeTruthy();
    expect(window.localStorage.getItem('sync-think.skill-metadata.v1')).toContain('代码审查工作流');
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('shows an actionable error instead of an empty library when list fails', async () => {
    runtime.listSkills.mockRejectedValue(new Error('pipe unavailable'));
    render(<AbilitiesPage onGoToAgents={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('能力库加载失败')).toBeTruthy());
    expect(screen.getByText('pipe unavailable')).toBeTruthy();
  });

  it('imports a Skill ZIP into the selected workspace', async () => {
    const skill = {
      skillVersionId: 'sv-zip',
      skillId: 'skill-zip',
      name: 'zip-review',
      description: 'Review from a ZIP.',
      version: '1.2.0',
      originType: 'local' as const,
      originRef: 'D:\\workspace\\.claude\\skills\\zip-review\\SKILL.md',
      allowedTools: [],
      contentFingerprint: 'zip-fingerprint',
      hasScripts: false,
      warnings: [],
      createdAt: '2026-08-10T00:00:00.000Z',
      enabled: true,
    };
    runtime.pickSkillZip.mockResolvedValue({
      canceled: false,
      path: 'D:\\downloads\\zip-review.zip',
    });
    runtime.skillLocalInspect.mockResolvedValue({
      sourcePath: 'D:\\downloads\\zip-review.zip',
      sourceType: 'zip',
      skills: [
        {
          folderName: 'zip-review',
          name: skill.name,
          description: skill.description,
          skillDirectory: 'D:\\temp\\zip-review',
          skillMdPath: 'D:\\temp\\zip-review\\SKILL.md',
          hasScripts: false,
        },
      ],
    });
    runtime.skillLocalImport.mockResolvedValue({
      skill,
      deduped: false,
      path: skill.originRef,
      sourcePath: 'D:\\downloads\\zip-review.zip',
      installedPaths: ['D:\\workspace\\.claude\\skills\\zip-review'],
      skillNames: [skill.name],
      imports: [{ skill, deduped: false }],
      conflictNames: [],
      scope: { type: 'workspace', workspaceId: 'workspace-1' },
    });
    runtime.skillLocalScan
      .mockRejectedValueOnce(new Error('initial scan skipped'))
      .mockResolvedValue({
        directory: 'C:\\Users\\test\\.sync-think\\skills',
        candidates: [],
        exists: true,
        watching: true,
        sources: [],
      });
    runtime.listSkills.mockResolvedValueOnce({ skills: [] }).mockResolvedValue({ skills: [skill] });

    render(
      <AbilitiesPage
        activeWorkspaceId="workspace-1"
        workspaces={[
          {
            workspaceId: 'workspace-1' as import('@sync-think/shared').WorkspaceId,
            name: 'SYNC-THINK',
            folderPath: 'D:\\workspace',
            createdAt: '2026-08-26T00:00:00.000Z',
            updatedAt: '2026-08-26T00:00:00.000Z',
          },
        ]}
        onGoToAgents={vi.fn()}
      />,
    );
    await waitFor(() => expect(runtime.listSkills).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('open-skill-import'));
    fireEvent.click(screen.getByRole('menuitem', { name: '导入' }));
    fireEvent.click(screen.getByRole('button', { name: '选择 ZIP 文件' }));
    await screen.findByTitle('D:\\downloads\\zip-review.zip');
    fireEvent.change(screen.getByPlaceholderText('为你的 Skill 起个名字'), {
      target: { value: skill.name },
    });
    fireEvent.change(screen.getByPlaceholderText('简要描述这个 Skill 的功能和用途'), {
      target: { value: skill.description },
    });
    fireEvent.click(screen.getByTestId('skill-local-import-submit'));

    await waitFor(() =>
      expect(runtime.skillLocalImport).toHaveBeenCalledWith({
        path: 'D:\\downloads\\zip-review.zip',
        scope: { type: 'workspace', workspaceId: 'workspace-1' },
      }),
    );
    expect(await screen.findByText(/已导入 Skill/)).toBeTruthy();
    expect(await screen.findByText(skill.name)).toBeTruthy();
  });

  it('installs one Skill into multiple NewMax-style locations and persists its icon', async () => {
    const skill = {
      skillVersionId: 'sv-multi-location',
      skillId: 'skill-multi-location',
      name: 'multi-location',
      description: 'Install in two locations.',
      version: '1.0.0',
      originType: 'local' as const,
      originRef: 'D:\\workspace\\.claude\\skills\\multi-location\\SKILL.md',
      allowedTools: [],
      contentFingerprint: 'multi-location-fingerprint',
      hasScripts: false,
      warnings: [],
      createdAt: '2026-08-26T00:00:00.000Z',
      enabled: true,
    };
    runtime.pickFolder.mockResolvedValue({
      canceled: false,
      path: 'D:\\downloads\\multi-location',
    });
    runtime.skillLocalInspect.mockResolvedValue({
      sourcePath: 'D:\\downloads\\multi-location',
      sourceType: 'folder',
      skills: [
        {
          folderName: 'multi-location',
          name: skill.name,
          description: skill.description,
          skillDirectory: 'D:\\downloads\\multi-location',
          skillMdPath: 'D:\\downloads\\multi-location\\SKILL.md',
          hasScripts: false,
        },
      ],
    });
    runtime.skillLocalImport.mockImplementation(
      async (payload: {
        path: string;
        scope: { type: 'global' } | { type: 'workspace'; workspaceId: string };
      }) => ({
        skill,
        deduped: false,
        path: skill.originRef,
        sourcePath: payload.path,
        installedPaths: [skill.originRef],
        skillNames: [skill.name],
        imports: [{ skill, deduped: false }],
        conflictNames: [],
        scope: payload.scope,
      }),
    );
    runtime.skillLocalScan.mockResolvedValue({
      directory: 'C:\\Users\\test\\.sync-think\\skills',
      candidates: [],
      exists: true,
      watching: true,
      sources: [],
    });
    runtime.listSkills.mockResolvedValue({ skills: [skill] });

    render(
      <AbilitiesPage
        activeWorkspaceId="workspace-1"
        workspaces={[
          {
            workspaceId: 'workspace-1' as import('@sync-think/shared').WorkspaceId,
            name: 'SYNC-THINK',
            folderPath: 'D:\\workspace',
            createdAt: '2026-08-26T00:00:00.000Z',
            updatedAt: '2026-08-26T00:00:00.000Z',
          },
        ]}
        onGoToAgents={vi.fn()}
      />,
    );
    await waitFor(() => expect(runtime.listSkills).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('open-skill-import'));
    fireEvent.click(screen.getByRole('menuitem', { name: '导入' }));
    fireEvent.click(screen.getByRole('button', { name: '选择文件夹' }));
    await screen.findByTitle('D:\\downloads\\multi-location');
    fireEvent.change(screen.getByPlaceholderText('为你的 Skill 起个名字'), {
      target: { value: skill.name },
    });
    fireEvent.change(screen.getByPlaceholderText('简要描述这个 Skill 的功能和用途'), {
      target: { value: skill.description },
    });
    fireEvent.click(screen.getByRole('button', { name: '选择 Emoji 图标' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '使用 ✨ 图标' }));
    fireEvent.click(screen.getByRole('button', { name: /^SYNC-THINK$/ }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /全局/ }));
    fireEvent.click(screen.getByTestId('skill-local-import-submit'));

    await waitFor(() => expect(runtime.skillLocalImport).toHaveBeenCalledTimes(2));
    expect(runtime.skillLocalImport).toHaveBeenNthCalledWith(1, {
      path: 'D:\\downloads\\multi-location',
      scope: { type: 'workspace', workspaceId: 'workspace-1' },
    });
    expect(runtime.skillLocalImport).toHaveBeenNthCalledWith(2, {
      path: 'D:\\downloads\\multi-location',
      scope: { type: 'global' },
    });
    expect(window.localStorage.getItem('sync-think.skill-metadata.v1')).toContain('✨');
  });

  it('keeps the local import dialog open and shows a contextual package error', async () => {
    runtime.pickSkillZip.mockResolvedValue({ canceled: false, path: 'D:\\downloads\\broken.zip' });
    runtime.skillLocalInspect.mockRejectedValue(
      new Error(
        "Error invoking remote method 'runtime:skill-local-inspect': RuntimeResponseError: ZIP 解压失败：文件损坏",
      ),
    );

    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    await waitFor(() => expect(runtime.listSkills).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('open-skill-import'));
    fireEvent.click(screen.getByRole('menuitem', { name: '导入' }));
    fireEvent.click(screen.getByRole('button', { name: '选择 ZIP 文件' }));

    const error = await screen.findByRole('alert');
    expect(error.textContent).toContain('ZIP 解压失败：文件损坏');
    expect(error.textContent).not.toContain('Error invoking remote method');
    expect(error.textContent).not.toContain('RuntimeResponseError');
    expect(screen.getByRole('dialog', { name: '导入 Skill' })).toBeTruthy();
  });

  it('keeps the Skill save action visible without relying on hover', async () => {
    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    await waitFor(() => expect(runtime.listSkills).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('open-skill-import'));
    fireEvent.click(screen.getByRole('menuitem', { name: '创建 Skill' }));

    const save = screen.getByTestId('import-skill-submit') as HTMLButtonElement;
    expect(save.textContent).toContain('保存');
    expect(save.disabled).toBe(false);
    expect(save.classList.contains('capability-button--primary')).toBe(true);
  });

  it('rejects an oversized local Skill before reading it into Renderer memory', async () => {
    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    await waitFor(() => expect(runtime.listSkills).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('open-skill-import'));
    fireEvent.click(screen.getByRole('menuitem', { name: '创建 Skill' }));
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

  it('uses NewMax row actions and edits display metadata without rewriting Skill source', async () => {
    const skill = {
      skillVersionId: 'sv-metadata-edit',
      skillId: 'skill-metadata-edit',
      name: 'metadata-edit',
      description: 'Original SKILL.md description',
      version: '1.0.0',
      allowedTools: [],
      contentFingerprint: 'metadata-edit-fingerprint',
      hasScripts: false,
      warnings: [],
      enabled: true,
      originType: 'local' as const,
      originRef: 'C:\\skills\\metadata-edit\\SKILL.md',
      createdAt: '2026-08-26T00:00:00.000Z',
    };
    runtime.listSkills.mockResolvedValue({ skills: [skill] });
    const onGoToAgents = vi.fn();

    render(<AbilitiesPage onGoToAgents={onGoToAgents} />);
    fireEvent.click(screen.getByTestId('skill-tab-mine'));
    await screen.findByText(skill.name);

    fireEvent.click(screen.getByRole('button', { name: `使用 ${skill.name}` }));
    expect(onGoToAgents).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: `编辑 ${skill.name}` }));
    expect(screen.getByRole('dialog', { name: '编辑 Skill' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Skill 名称'), {
      target: { value: '自定义显示名称' },
    });
    fireEvent.change(screen.getByLabelText('Skill 描述'), {
      target: { value: '仅保存在显示元数据中' },
    });
    fireEvent.change(screen.getByLabelText('Skill 图标'), { target: { value: '🚀' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText('自定义显示名称')).toBeTruthy();
    expect(screen.getByText('仅保存在显示元数据中')).toBeTruthy();
    expect(window.localStorage.getItem('sync-think.skill-metadata.v1')).toContain('🚀');
    expect(runtime.importSkill).not.toHaveBeenCalled();
    expect(runtime.getSkill).not.toHaveBeenCalled();
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

  it('shows brand MCP icons and refuses an unresolved GitHub env command', async () => {
    const context7 = {
      mcpServerId: 'mcp-context7',
      name: 'context7',
      transport: 'remote-http' as const,
      endpoint: 'https://mcp.context7.com/mcp',
      tools: [
        { name: 'resolve-library-id', description: 'Resolve a library.' },
        { name: 'query-docs', description: 'Query docs.' },
      ],
      trusted: true,
      enabled: true,
      maxOutputBytes: 1_000_000,
      timeoutMs: 30_000,
      notes: '',
      createdAt: '2026-08-09T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
    };
    const github = {
      mcpServerId: 'mcp-github',
      name: 'GitHub',
      transport: 'local-stdio' as const,
      endpoint: 'MCP_GITHUB_COMMAND',
      tools: [],
      trusted: true,
      enabled: false,
      maxOutputBytes: 1_000_000,
      timeoutMs: 30_000,
      notes: '',
      createdAt: '2026-08-09T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
    };
    runtime.listMcpServers.mockResolvedValue({ servers: [context7, github] });

    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    fireEvent.click(screen.getByTestId('abilities-section-mcp'));
    fireEvent.click(screen.getByTestId('mcp-tab-mine'));
    await screen.findByText('context7');

    expect(screen.getByTestId('mcp-icon-context7').getAttribute('src')).toContain('context7.com');
    expect(screen.getByTestId('mcp-icon-github')).toBeTruthy();
    expect(screen.getByText('2 个工具')).toBeTruthy();
    expect(screen.getByText('命令未配置')).toBeTruthy();
    expect(document.querySelector('[data-mcp-callable="1"]')?.textContent).toContain('context7');
    expect(document.querySelector('[data-mcp-callable="0"]')?.textContent).toContain('GitHub');
  });

  it('does not show the Skill activation-path note in MCP management', async () => {
    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    fireEvent.click(screen.getByTestId('abilities-section-mcp'));
    fireEvent.click(screen.getByTestId('mcp-tab-mine'));

    await waitFor(() => expect(runtime.listMcpServers).toHaveBeenCalledWith({ limit: 100 }));
    expect(screen.queryByText('Skill 有两条生效路径')).toBeNull();
  });

  it('renders MCP in the shared ability hub and provides visible Skill navigation', async () => {
    render(<AbilitiesPage onGoToAgents={vi.fn()} />);

    fireEvent.click(screen.getByTestId('abilities-section-mcp'));

    const page = screen.getByTestId('abilities-page');
    expect(page.classList.contains('ability-hub')).toBe(true);
    expect(screen.getByRole('heading', { name: 'MCP 管理' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '注册 MCP' })).toBeTruthy();
    expect(screen.queryByLabelText('能力类型')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Skill 管理' }));
    expect(screen.getByRole('heading', { name: 'Skill 管理' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'MCP 管理' })).toBeTruthy();
  });

  it('filters MCP market cards by category and search', async () => {
    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    fireEvent.click(screen.getByTestId('abilities-section-mcp'));

    expect(screen.getByText('Workspace Files')).toBeTruthy();
    expect(screen.getByText('Playwright Browser')).toBeTruthy();
    const allCategories = screen.getByRole('button', { name: '全部' });
    const browserCategory = screen.getByRole('button', { name: '浏览器' });
    expect(allCategories.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(browserCategory);
    expect(browserCategory.getAttribute('aria-pressed')).toBe('true');
    expect(allCategories.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByText('Workspace Files')).toBeNull();
    expect(screen.getByText('Playwright Browser')).toBeTruthy();

    fireEvent.change(screen.getByRole('textbox', { name: '搜索 MCP' }), {
      target: { value: 'PostgreSQL' },
    });
    expect(screen.getByText('没有匹配的 MCP')).toBeTruthy();
    fireEvent.click(allCategories);
    expect(screen.getByText('PostgreSQL')).toBeTruthy();
  });

  it('uses TD-041 global enablement for registered MCP servers', async () => {
    const server = {
      mcpServerId: 'mcp-toggle',
      name: 'Toggle MCP',
      transport: 'local-stdio',
      endpoint: 'node toggle-mcp.mjs',
      tools: [{ name: 'toggle_tool', description: 'Toggle fixture tool.' }],
      trusted: true,
      enabled: true,
      maxOutputBytes: 1_000_000,
      timeoutMs: 30_000,
      notes: '',
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    };
    runtime.listMcpServers.mockResolvedValue({ servers: [server] });
    runtime.setMcpServerEnabled.mockResolvedValue({ server: { ...server, enabled: false } });

    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    fireEvent.click(screen.getByTestId('abilities-section-mcp'));
    fireEvent.click(screen.getByTestId('mcp-tab-mine'));
    const allStatuses = screen.getByRole('button', { name: /全部状态/ });
    const enabledStatus = screen.getByRole('button', { name: /已启用/ });
    expect(allStatuses.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(enabledStatus);
    expect(enabledStatus.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(await screen.findByRole('switch', { name: '停用 Toggle MCP' }));

    await waitFor(() =>
      expect(runtime.setMcpServerEnabled).toHaveBeenCalledWith({
        mcpServerId: 'mcp-toggle',
        enabled: false,
      }),
    );
    expect(screen.queryByText('激活到工作区')).toBeNull();
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
    fireEvent.click(screen.getByRole('menuitem', { name: '创建 Skill' }));
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
    runtime.installSkillMarket.mockResolvedValue({
      item: marketSkills[1],
      skill: installed,
      deduped: false,
      installedPaths: ['C:\\Users\\test\\.sync-think\\skills\\automation-workflow'],
    });
    runtime.listSkills.mockResolvedValue({ skills: [] });

    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    const automationCard = await screen.findByRole('button', { name: /自动化工作流/ });
    fireEvent.click(
      automationCard.closest('article')!.querySelector<HTMLButtonElement>('.is-use')!,
    );

    await waitFor(() =>
      expect(runtime.installSkillMarket).toHaveBeenCalledWith({
        marketSkillId: 'automation-workflow',
      }),
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
    fireEvent.click((await screen.findByText('market-skill')).closest('button')!);

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
    fireEvent.click((await screen.findByText('local-skill')).closest('button')!);

    // 用户自己的 skill：编辑与删除按钮都保留
    expect(screen.getByRole('button', { name: '编辑' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '删除 Skill' })).toBeTruthy();
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
    fireEvent.click((await screen.findByText('path-skill')).closest('button')!);

    expect(
      screen.getByText(
        'Compose 需工作区激活；Agent / Team 按自身绑定注入；全局停用会阻断两条路径。',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/所在工作区是否激活不影响默认注入/)).toBeNull();
  });

  it('installs a complete author package through the Runtime market contract', async () => {
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
    runtime.installSkillMarket.mockResolvedValue({
      item: marketSkills[0],
      skill: remoteSkill,
      deduped: false,
      installedPaths: ['C:\\Users\\test\\.sync-think\\skills\\project-bootstrap'],
    });

    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    // 市场 tab → 打开带 sourceUrl 的条目 → 安装
    fireEvent.click(screen.getByRole('tab', { name: /Skill 市场/ }));
    const card = await screen.findByRole('button', { name: /项目初始化/ });
    fireEvent.click(card);
    fireEvent.click(screen.getByRole('button', { name: /安装 Skill/ }));

    await waitFor(() =>
      expect(runtime.installSkillMarket).toHaveBeenCalledWith({
        marketSkillId: 'project-bootstrap',
      }),
    );
  });

  it('uses a NewMax-style workspace menu and updates activation without reloading the catalog', async () => {
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
    runtime.listCapabilityGovernance.mockResolvedValue({
      workspaceId: 'default-workspace',
      windowDays: 45,
      skills: [
        {
          skill,
          workspaceActive: true,
          usage: {
            capabilityType: 'skill',
            capabilityId: skill.skillVersionId,
            callCount: 8,
            successCount: 8,
            failedCount: 0,
            cancelledCount: 0,
            problemCount: 0,
            contextTokens: 100,
          },
        },
      ],
      mcpServers: [],
    });
    runtime.listCapabilityWorkspaceActivations.mockImplementation(
      ({ workspaceId }: { workspaceId: string }) =>
        Promise.resolve({
          activations: [
            {
              workspaceId,
              capabilityType: 'skill',
              capabilityId: skill.skillVersionId,
              active: workspaceId === 'default-workspace',
            },
          ],
        }),
    );
    runtime.setCapabilityWorkspaceActive.mockResolvedValue({});

    render(
      <AbilitiesPage
        activeWorkspaceId="default-workspace"
        workspaces={[
          {
            workspaceId: 'default-workspace' as import('@sync-think/shared').WorkspaceId,
            name: 'SYNC-THINK',
            folderPath: 'D:\\workspace',
            createdAt: '2026-08-09T00:00:00.000Z',
            updatedAt: '2026-08-09T00:00:00.000Z',
          },
          {
            workspaceId: 'data-workspace' as import('@sync-think/shared').WorkspaceId,
            name: 'data-sync-root',
            folderPath: 'D:\\data-sync-root',
            createdAt: '2026-08-09T00:00:00.000Z',
            updatedAt: '2026-08-09T00:00:00.000Z',
          },
        ]}
        onGoToAgents={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('skill-tab-mine'));
    const trigger = await screen.findByTestId('skill-workspace-activation-sv-governed');
    expect(trigger.textContent).toContain('SYNC-THINK');
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });

    expect(await screen.findByText('激活到工作区')).toBeTruthy();
    const allWorkspaces = screen.getByRole('switch', {
      name: '激活全部工作区',
    });
    const currentWorkspace = screen.getByRole('switch', { name: 'SYNC-THINK 工作区' });
    const dataWorkspace = screen.getByRole('switch', { name: 'data-sync-root 工作区' });
    expect(allWorkspaces.getAttribute('aria-checked')).toBe('false');
    expect(currentWorkspace.getAttribute('aria-checked')).toBe('true');
    expect(dataWorkspace.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(allWorkspaces);

    await waitFor(() =>
      expect(runtime.setCapabilityWorkspaceActive).toHaveBeenCalledWith({
        workspaceId: 'data-workspace',
        capabilityType: 'skill',
        capabilityId: 'sv-governed',
        active: true,
      }),
    );
    expect(allWorkspaces.getAttribute('aria-checked')).toBe('true');
    expect(dataWorkspace.getAttribute('aria-checked')).toBe('true');
    expect(runtime.listSkills).toHaveBeenCalledTimes(1);

    runtime.setCapabilityWorkspaceActive.mockRejectedValueOnce(new Error('activation failed'));
    await waitFor(() => expect((dataWorkspace as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(dataWorkspace);
    expect(await screen.findByText('更新失败，已恢复原状态')).toBeTruthy();
    expect(dataWorkspace.getAttribute('aria-checked')).toBe('true');
    expect(runtime.listSkills).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    await waitFor(() => expect(screen.queryByText('激活到工作区')).toBeNull());
  });

  it('shows active workspace names when the selected workspace is inactive', async () => {
    const skill = {
      skillVersionId: 'sv-active-other-workspace',
      skillId: 'skill-active-other-workspace',
      name: 'active-other-workspace',
      description: 'A Skill active in another workspace.',
      version: '1.0.0',
      allowedTools: [],
      contentFingerprint: 'active-other-workspace-fingerprint',
      hasScripts: false,
      warnings: [],
      createdAt: '2026-08-09T00:00:00.000Z',
      enabled: true,
    };
    const workspaces = [
      {
        workspaceId: 'active-workspace' as import('@sync-think/shared').WorkspaceId,
        name: 'Active Workspace',
        folderPath: 'D:\\active-workspace',
        createdAt: '2026-08-09T00:00:00.000Z',
        updatedAt: '2026-08-09T00:00:00.000Z',
      },
      {
        workspaceId: 'selected-workspace' as import('@sync-think/shared').WorkspaceId,
        name: 'Selected Workspace',
        folderPath: 'D:\\selected-workspace',
        createdAt: '2026-08-09T00:00:00.000Z',
        updatedAt: '2026-08-09T00:00:00.000Z',
      },
    ];
    runtime.listSkills.mockResolvedValue({ skills: [skill] });
    runtime.listCapabilityGovernance.mockResolvedValue({
      workspaceId: 'selected-workspace',
      windowDays: 45,
      skills: [
        {
          skill,
          workspaceActive: false,
          activeWorkspaceNames: ['Active Workspace'],
          usage: {
            capabilityType: 'skill',
            capabilityId: skill.skillVersionId,
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

    render(
      <AbilitiesPage
        activeWorkspaceId="selected-workspace"
        workspaces={workspaces}
        onGoToAgents={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('skill-tab-mine'));

    const trigger = await screen.findByTestId(
      'skill-workspace-activation-sv-active-other-workspace',
    );
    expect(trigger.textContent).toContain('Active Workspace');
    expect(trigger.textContent).not.toContain('未激活');
  });

  it('keeps a global workspace change consistent while its writes are still in flight', async () => {
    const skill = {
      skillVersionId: 'sv-global-batch',
      skillId: 'skill-global-batch',
      name: 'global-batch-skill',
      description: 'A Skill active in every workspace.',
      version: '1.0.0',
      allowedTools: [],
      contentFingerprint: 'global-batch-fingerprint',
      hasScripts: false,
      warnings: [],
      createdAt: '2026-08-09T00:00:00.000Z',
      enabled: true,
    };
    const workspaces = ['cuitaliao', 'sync-think', 'MoreAT', 'Sub2api'].map((workspaceId) => ({
      workspaceId: workspaceId as import('@sync-think/shared').WorkspaceId,
      name: workspaceId,
      folderPath: `D:\\${workspaceId}`,
      createdAt: '2026-08-09T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
    }));
    const activeByWorkspace = new Map<string, boolean>(
      workspaces.map(({ workspaceId }) => [workspaceId, true]),
    );
    const secondWrite = deferred<{
      activation: { workspaceId: string; capabilityId: string; active: boolean };
    }>();
    let writeCount = 0;

    runtime.listSkills.mockResolvedValue({ skills: [skill] });
    runtime.listCapabilityGovernance.mockResolvedValue({
      workspaceId: 'cuitaliao',
      windowDays: 45,
      skills: [
        {
          skill,
          workspaceActive: true,
          usage: {
            capabilityType: 'skill',
            capabilityId: skill.skillVersionId,
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
    runtime.listCapabilityWorkspaceActivations.mockImplementation(
      ({ workspaceId }: { workspaceId: string }) =>
        Promise.resolve({
          activations: [
            {
              workspaceId,
              capabilityType: 'skill',
              capabilityId: skill.skillVersionId,
              active: activeByWorkspace.get(workspaceId) ?? false,
            },
          ],
        }),
    );
    runtime.setCapabilityWorkspaceActive.mockImplementation(
      (request: { workspaceId: string; capabilityId: string; active: boolean }) => {
        writeCount += 1;
        activeByWorkspace.set(request.workspaceId, request.active);
        const response = {
          activation: {
            workspaceId: request.workspaceId,
            capabilityId: request.capabilityId,
            active: request.active,
          },
        };
        return writeCount === 2 ? secondWrite.promise : Promise.resolve(response);
      },
    );

    render(
      <AbilitiesPage
        activeWorkspaceId="cuitaliao"
        workspaces={workspaces}
        onGoToAgents={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('skill-tab-mine'));
    const trigger = await screen.findByTestId('skill-workspace-activation-sv-global-batch');
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    const allWorkspaces = await screen.findByRole('switch', { name: '激活全部工作区' });
    await waitFor(() =>
      expect(runtime.listCapabilityWorkspaceActivations).toHaveBeenCalledTimes(workspaces.length),
    );

    fireEvent.click(allWorkspaces);
    await waitFor(() => expect(runtime.setCapabilityWorkspaceActive).toHaveBeenCalledTimes(2));
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    secondWrite.resolve({
      activation: {
        workspaceId: 'sync-think',
        capabilityId: skill.skillVersionId,
        active: false,
      },
    });
    await waitFor(() =>
      expect(runtime.setCapabilityWorkspaceActive).toHaveBeenCalledTimes(workspaces.length),
    );

    expect(runtime.listCapabilityWorkspaceActivations).toHaveBeenCalledTimes(workspaces.length);
    expect(allWorkspaces.getAttribute('aria-checked')).toBe('false');
    for (const workspace of workspaces) {
      expect(
        screen
          .getByRole('switch', { name: `${workspace.name} 工作区` })
          .getAttribute('aria-checked'),
      ).toBe('false');
    }
  });

  it('keeps the installed Skill list mounted during a background catalog refresh', async () => {
    const skill = {
      skillVersionId: 'sv-scroll-stable',
      skillId: 'skill-scroll-stable',
      name: 'scroll-stable-skill',
      description: 'The list must not jump during background refresh.',
      version: '1.0.0',
      allowedTools: [],
      contentFingerprint: 'scroll-stable-fingerprint',
      hasScripts: false,
      warnings: [],
      createdAt: '2026-08-09T00:00:00.000Z',
      enabled: true,
    };
    const intervalSpy = vi.spyOn(window, 'setInterval');
    runtime.listSkills.mockResolvedValue({ skills: [skill] });
    runtime.skillLocalScan.mockResolvedValue({
      directory: 'C:\\Users\\test\\.sync-think\\skills',
      candidates: [],
      exists: true,
      watching: true,
      sources: [],
    });

    render(<AbilitiesPage onGoToAgents={vi.fn()} />);
    fireEvent.click(screen.getByTestId('skill-tab-mine'));
    await screen.findByText(skill.name);
    await waitFor(() => expect(runtime.listSkills).toHaveBeenCalledTimes(2));
    const intervalTick = intervalSpy.mock.calls.find(([, timeout]) => timeout === 30_000)?.[0];
    expect(intervalTick).toBeTypeOf('function');

    const scroll = document.querySelector<HTMLElement>('.ability-hub__scroll--installed')!;
    scroll.scrollTop = 240;
    const delayedCatalog = deferred<{ skills: (typeof skill)[] }>();
    runtime.listSkills.mockReturnValueOnce(delayedCatalog.promise);

    act(() => {
      if (typeof intervalTick === 'function') intervalTick();
    });
    await waitFor(() => expect(runtime.listSkills).toHaveBeenCalledTimes(3));

    expect(screen.getByText(skill.name)).toBeTruthy();
    expect(document.querySelector('.ability-hub__scroll--installed')).toBe(scroll);
    expect(scroll.scrollTop).toBe(240);

    delayedCatalog.resolve({ skills: [skill] });
    await waitFor(() => expect(screen.getByText(skill.name)).toBeTruthy());
    expect(document.querySelector('.ability-hub__scroll--installed')).toBe(scroll);
    expect(scroll.scrollTop).toBe(240);
  });

  it('renders globally disabled Skills as stopped while keeping the enable switch available', async () => {
    const skill = {
      skillVersionId: 'sv-paused',
      skillId: 'skill-paused',
      name: 'paused-skill',
      description: 'A globally disabled Skill.',
      version: '1.0.0',
      allowedTools: [],
      contentFingerprint: 'paused-fingerprint',
      hasScripts: false,
      warnings: [],
      createdAt: '2026-08-09T00:00:00.000Z',
      enabled: false,
    };
    runtime.listSkills.mockResolvedValue({ skills: [skill] });
    runtime.listCapabilityGovernance.mockResolvedValue({
      workspaceId: 'default-workspace',
      windowDays: 45,
      skills: [
        {
          skill,
          workspaceActive: true,
          usage: {
            capabilityType: 'skill',
            capabilityId: skill.skillVersionId,
            callCount: 1,
            successCount: 1,
            failedCount: 0,
            cancelledCount: 0,
            problemCount: 0,
            contextTokens: 0,
          },
        },
      ],
      mcpServers: [],
    });
    runtime.setSkillEnabled.mockResolvedValue({ skill: { ...skill, enabled: true } });

    render(
      <AbilitiesPage
        activeWorkspaceId="default-workspace"
        workspaces={[
          {
            workspaceId: 'default-workspace' as import('@sync-think/shared').WorkspaceId,
            name: 'SYNC-THINK',
            folderPath: 'D:\\workspace',
            createdAt: '2026-08-09T00:00:00.000Z',
            updatedAt: '2026-08-09T00:00:00.000Z',
          },
        ]}
        onGoToAgents={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('skill-tab-mine'));

    const name = await screen.findByText('paused-skill');
    const row = name.closest('article');
    expect(row?.getAttribute('data-enabled')).toBe('0');
    expect(row?.classList.contains('is-disabled')).toBe(true);
    expect(screen.getAllByText('已停用').length).toBeGreaterThanOrEqual(2);

    const workspaceTrigger = screen.getByTestId('skill-workspace-activation-sv-paused');
    expect(workspaceTrigger.textContent).toContain('已停用');
    expect((workspaceTrigger as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole('button', { name: '使用 paused-skill' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    const enableSwitch = screen.getByRole('switch', { name: '启用 paused-skill' });
    expect((enableSwitch as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(enableSwitch);
    await waitFor(() =>
      expect(runtime.setSkillEnabled).toHaveBeenCalledWith({
        skillVersionId: 'sv-paused',
        enabled: true,
      }),
    );
  });

  it('counts unused Skill frontmatter descriptions for resident context, not historical tokens', async () => {
    const idleDescription = '从需求拆解到目录和里程碑。';
    const disabledDescription = '不会进入全局预算的停用 Skill。';
    const truncatedDescription = 'x'.repeat(SKILL_DESC_CUT + 1);
    const idle = {
      skillVersionId: 'sv-idle',
      skillId: 'skill-idle',
      name: 'idle-skill',
      description: idleDescription,
      version: '1.0.0',
      allowedTools: [],
      contentFingerprint: 'idle-fingerprint',
      hasScripts: false,
      warnings: [],
      createdAt: '2026-08-09T00:00:00.000Z',
      enabled: true,
    };
    const disabled = {
      skillVersionId: 'sv-disabled-budget',
      skillId: 'skill-disabled-budget',
      name: 'disabled-budget-skill',
      description: disabledDescription,
      version: '1.0.0',
      allowedTools: [],
      contentFingerprint: 'disabled-budget-fingerprint',
      hasScripts: false,
      warnings: [],
      createdAt: '2026-08-09T00:00:00.000Z',
      enabled: false,
    };
    const truncated = {
      skillVersionId: 'sv-truncated',
      skillId: 'skill-truncated',
      name: 'truncated-skill',
      description: truncatedDescription,
      version: '1.0.0',
      allowedTools: [],
      contentFingerprint: 'truncated-fingerprint',
      hasScripts: false,
      warnings: [],
      createdAt: '2026-08-09T00:00:00.000Z',
      enabled: true,
    };
    const unusedUsage = (capabilityId: string) => ({
      capabilityType: 'skill' as const,
      capabilityId,
      callCount: 0,
      successCount: 0,
      failedCount: 0,
      cancelledCount: 0,
      problemCount: 0,
      contextTokens: 0,
    });
    runtime.listSkills.mockResolvedValue({ skills: [idle, disabled, truncated] });
    runtime.listCapabilityGovernance.mockResolvedValue({
      workspaceId: 'default-workspace',
      windowDays: 45,
      skills: [
        { skill: idle, workspaceActive: false, usage: unusedUsage(idle.skillVersionId) },
        { skill: disabled, workspaceActive: true, usage: unusedUsage(disabled.skillVersionId) },
        { skill: truncated, workspaceActive: true, usage: unusedUsage(truncated.skillVersionId) },
      ],
      mcpServers: [],
    });

    render(
      <AbilitiesPage
        activeWorkspaceId="default-workspace"
        workspaces={[
          {
            workspaceId: 'default-workspace' as import('@sync-think/shared').WorkspaceId,
            name: 'SYNC-THINK',
            folderPath: 'D:\\workspace',
            createdAt: '2026-08-09T00:00:00.000Z',
            updatedAt: '2026-08-09T00:00:00.000Z',
          },
        ]}
        onGoToAgents={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('skill-tab-mine'));
    await screen.findByText('idle-skill');

    const widget = screen.getByTestId('skill-resident-context');
    const globalChars =
      residentDescriptionChars(idleDescription) + residentDescriptionChars(truncatedDescription);
    expect(widget.textContent).toContain(`${formatCharCount(globalChars)} 字符`);
    expect(widget.textContent).toContain('建议上限约 15,000（估算）');
    expect(widget.textContent).not.toMatch(/(?:^|[^\d,])0 字符/);
    expect(screen.getAllByText('已扫描').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('描述截断')).toBeTruthy();
    expect(
      screen.getByText('有问题').closest('.ability-stat')?.querySelector('strong')?.textContent,
    ).toBe('1');

    fireEvent.click(screen.getByTestId('skill-scope-default-workspace'));
    await waitFor(() =>
      expect(screen.getByTestId('skill-resident-context').textContent).toContain(
        `${formatCharCount(residentDescriptionChars(truncatedDescription))} 字符`,
      ),
    );
    expect(screen.getByTestId('skill-resident-context').textContent).not.toContain(
      `${formatCharCount(globalChars)} 字符`,
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
    fireEvent.click((await screen.findByText('publishable-skill')).closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: '发布' }));

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

  it('deletes a Skill from its NewMax-style management drawer', async () => {
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
    fireEvent.click(screen.getByText('review').closest('button')!);

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
