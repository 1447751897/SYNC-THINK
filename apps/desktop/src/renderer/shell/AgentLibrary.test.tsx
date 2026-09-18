/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { GlobalAgent, Team, TeamMember } from '@sync-think/shared';
import { AgentLibrary } from './AgentLibrary.js';
import { DialogProvider } from './Dialog.js';

vi.mock('./compose-toolbar.js', () => ({
  ModelPickerMenu: () => null,
  ModelTrigger: ({ label, onClick }: { label: string; onClick(): void }) => (
    <button type="button" onClick={onClick}>
      {label}
    </button>
  ),
}));

const agent: GlobalAgent = {
  id: 'agent-alpha' as GlobalAgent['id'],
  name: 'Agent Alpha',
  avatar: 'A',
  persona: 'Keep the interface consistent.',
  description: '',
  defaultModelId: 'model-alpha' as GlobalAgent['defaultModelId'],
  fallbackModelIds: [],
  skillIds: [],
  mcpServerIds: [],
  reasoningEffort: 'auto',
  writePolicy: 'read-only',
  archived: false,
  createdAt: '2026-08-08T00:00:00.000Z',
  updatedAt: '2026-08-08T00:00:00.000Z',
};

/**
 * The library renders exactly one layout per `data-view`: dense rows in list
 * view (the default) and cards in grid view. Both carry `.agent-card`, so a
 * single lookup helper covers the two.
 */
function cardByName(name: string): HTMLElement {
  const card = screen.getByText(name).closest('.agent-card');
  expect(card).toBeTruthy();
  return card as HTMLElement;
}

function switchView(label: '列表视图' | '网格视图') {
  fireEvent.click(screen.getByRole('button', { name: label }));
}

function renderLibrary(
  onStartConversation = vi.fn(),
  extraProps: Partial<ComponentProps<typeof AgentLibrary>> = {},
) {
  return {
    onStartConversation,
    ...render(
      <DialogProvider>
        <AgentLibrary
          agents={[agent]}
          models={[
            {
              modelId: 'model-alpha',
              displayName: 'Model Alpha',
              providerName: 'Provider Alpha',
            },
          ]}
          onRefresh={vi.fn()}
          onStartConversation={onStartConversation}
          {...extraProps}
        />
      </DialogProvider>,
    ),
  };
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'syncThink');
  vi.clearAllMocks();
});

describe('AgentLibrary shared visual structure', () => {
  it('keeps an empty description in the card layout and selects the card when editing', () => {
    renderLibrary();

    const card = cardByName('Agent Alpha');
    expect(card.querySelector('.agent-card__description')?.getAttribute('data-empty')).toBe('1');
    expect(card.classList.contains('agent-card--selected')).toBe(false);

    fireEvent.click(card);

    expect(card.classList.contains('agent-card--selected')).toBe(true);
    expect(document.querySelector('.agent-dialog')).toBeTruthy();
    expect(document.querySelector('[data-testid="agent-detail-drawer"]')).toBeTruthy();
    expect(document.querySelector('.agent-dialog__body')).toBeTruthy();
    expect(document.querySelector('.agent-meta-grid')).toBeTruthy();
  });

  it('starts a conversation without opening the edit dialog', () => {
    const onStartConversation = vi.fn();
    renderLibrary(onStartConversation);

    // The dense row exposes the primary action as an icon button.
    const action = document.querySelector<HTMLButtonElement>('.agent-card__row-action--primary');
    expect(action).toBeTruthy();
    fireEvent.click(action!);

    expect(onStartConversation).toHaveBeenCalledWith('agent-alpha');
    expect(document.querySelector('.agent-dialog')).toBeNull();
  });

  it('searches and filters agents and offers a compact list view', () => {
    const beta = {
      ...agent,
      id: 'agent-beta' as GlobalAgent['id'],
      name: 'Agent Beta',
      description: 'Handles release planning.',
      defaultModelId: 'model-beta' as GlobalAgent['defaultModelId'],
    };
    renderLibrary(undefined, {
      agents: [agent, beta],
      models: [
        { modelId: 'model-alpha', displayName: 'Model Alpha', providerName: 'Provider Alpha' },
        { modelId: 'model-beta', displayName: 'Model Beta', providerName: 'Provider Beta' },
      ],
    });

    expect(screen.getAllByRole('button', { name: /开始对话/ })).toHaveLength(2);

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索智能体' }), {
      target: { value: 'release' },
    });
    expect(screen.queryByText('Agent Alpha')).toBeNull();
    expect(screen.getByText('Agent Beta')).toBeTruthy();

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索智能体' }), {
      target: { value: '' },
    });
    // The sliding scope tabs replace the old model dropdown: the seeded agents
    // have no availabilityScope (defaults to global), so filtering to
    // 指定工作区 hides both, and 全部 brings them back.
    fireEvent.click(screen.getByRole('button', { name: /指定工作区/ }));
    expect(screen.queryByText('Agent Alpha')).toBeNull();
    expect(screen.queryByText('Agent Beta')).toBeNull();

    fireEvent.click(within(screen.getByRole('group', { name: '范围筛选' })).getByRole('button', { name: /全部/ }));
    expect(screen.getByText('Agent Alpha')).toBeTruthy();
    expect(screen.getByText('Agent Beta')).toBeTruthy();

    // List is the default; switching to grid swaps the mounted layout.
    expect(document.querySelector('.agent-grid')?.getAttribute('data-view')).toBe('list');
    expect(document.querySelector('.agent-card__row')).toBeTruthy();
    expect(document.querySelector('.agent-card__main')).toBeNull();

    switchView('网格视图');
    expect(document.querySelector('.agent-grid')?.getAttribute('data-view')).toBe('grid');
    expect(document.querySelector('.agent-card__main')).toBeTruthy();
    expect(document.querySelector('.agent-card__row')).toBeNull();

    switchView('列表视图');
    expect(document.querySelector('.agent-grid')?.getAttribute('data-view')).toBe('list');
    expect(screen.getByRole('button', { name: '列表视图' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('filters by write policy and by status from the filter row', () => {
    const writable = {
      ...agent,
      id: 'agent-beta' as GlobalAgent['id'],
      name: 'Agent Beta',
      writePolicy: 'inherit' as const,
    };
    renderLibrary(undefined, { agents: [agent, writable] });

    // Both filter groups contain a 「全部」 chip, so scope every query to the
    // group under test.
    const policy = within(screen.getByRole('group', { name: '写入策略筛选' }));
    const status = within(screen.getByRole('group', { name: '状态筛选' }));

    // agent-alpha defaults to read-only, agent-beta inherits.
    fireEvent.click(policy.getByRole('button', { name: /继承当前会话/ }));
    expect(screen.queryByText('Agent Alpha')).toBeNull();
    expect(screen.getByText('Agent Beta')).toBeTruthy();

    fireEvent.click(policy.getByRole('button', { name: /^只读/ }));
    expect(screen.getByText('Agent Alpha')).toBeTruthy();
    expect(screen.queryByText('Agent Beta')).toBeNull();

    fireEvent.click(policy.getByRole('button', { name: /^全部/ }));
    expect(screen.getByText('Agent Alpha')).toBeTruthy();
    expect(screen.getByText('Agent Beta')).toBeTruthy();

    // The seeded model catalog resolves, so 可用 keeps both and 不可用 drops both.
    fireEvent.click(status.getByRole('button', { name: /^不可用/ }));
    expect(screen.queryByText('Agent Alpha')).toBeNull();
    expect(screen.queryByText('Agent Beta')).toBeNull();

    fireEvent.click(status.getByRole('button', { name: /^可用/ }));
    expect(screen.getByText('Agent Alpha')).toBeTruthy();
    expect(screen.getByText('Agent Beta')).toBeTruthy();
  });

  it('sorts the library from the sort menu', () => {
    const beta = {
      ...agent,
      id: 'agent-beta' as GlobalAgent['id'],
      name: 'Agent Beta',
      updatedAt: '2026-08-09T00:00:00.000Z',
    };
    renderLibrary(undefined, { agents: [agent, beta] });

    // Default is 按最近活跃: beta's updatedAt is newer, so it leads.
    const names = () =>
      [...document.querySelectorAll('.agent-card__name')].map((n) => n.textContent);
    expect(names()).toEqual(['Agent Beta', 'Agent Alpha']);

    fireEvent.click(screen.getByRole('button', { name: /按最近活跃/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: '按名称' }));
    expect(names()).toEqual(['Agent Alpha', 'Agent Beta']);
  });

  it('labels a missing model without exposing its internal id as the model name', () => {
    const missingModelAgent = {
      ...agent,
      defaultModelId: 'model-removed-from-catalog' as GlobalAgent['defaultModelId'],
    };
    renderLibrary(undefined, { agents: [missingModelAgent], models: [] });

    expect(screen.getByText('模型不可用')).toBeTruthy();
    expect(screen.queryByText('model-removed-from-catalog')).toBeNull();

    fireEvent.click(cardByName('Agent Alpha'));
    expect(screen.getAllByText('模型不可用').length).toBeGreaterThan(1);
    expect(screen.queryByText('model-removed-from-catalog')).toBeNull();
  });

  it('closes the agent drawer with Escape', () => {
    renderLibrary();
    fireEvent.click(cardByName('Agent Alpha'));

    expect(screen.getByTestId('agent-detail-drawer')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByTestId('agent-detail-drawer')).toBeNull();
  });
});

describe('AgentLibrary tabbed detail drawer', () => {
  const team: Team = {
    id: 'team-alpha' as Team['id'],
    name: 'Team Alpha',
    avatar: 'T',
    mission: '',
    strategy: 'serial',
    members: [
      {
        agentId: 'agent-alpha' as TeamMember['agentId'],
        memberOrder: 0,
        role: 'member',
        title: '',
        dependsOn: [],
      },
    ],
    createdAt: '2026-08-08T00:00:00.000Z',
    updatedAt: '2026-08-08T00:00:00.000Z',
  };



  function openDrawer() {
    fireEvent.click(cardByName('Agent Alpha'));
    expect(screen.getByTestId('agent-detail-drawer')).toBeTruthy();
  }

  it('shows the overview tab by default with read-only info', () => {
    renderLibrary();
    openDrawer();

    const overview = screen.getByTestId('agent-drawer-overview');
    expect(overview).toBeTruthy();
    expect(within(overview).getByText('所在小队')).toBeTruthy();
    expect(within(overview).getByText('未加入小队')).toBeTruthy();
    expect(within(overview).getByText('使用模型')).toBeTruthy();
    expect(within(overview).getByText('Model Alpha')).toBeTruthy();
    expect(within(overview).getByText('Keep the interface consistent.')).toBeTruthy();
    expect(within(overview).getByRole('button', { name: '复制 ID' })).toBeTruthy();
    expect(within(overview).getByRole('button', { name: '未绑定 · 去能力' })).toBeTruthy();
    // 概览不出现可编辑控件
    expect(overview.querySelector('input')).toBeNull();
    expect(overview.querySelector('textarea')).toBeNull();
  });

  it('jumps from the overview empty skill state into the abilities tab', () => {
    renderLibrary();
    openDrawer();

    fireEvent.click(screen.getByRole('button', { name: '未绑定 · 去能力' }));
    expect(screen.getByTestId('agent-drawer-abilities')).toBeTruthy();
    expect(screen.getByTestId('agent-ability-subtab-skills').getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('configures workspace activation from the main library row', async () => {
    const setGlobalAgentWorkspaceActivation = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, 'syncThink', {
      configurable: true,
      value: {
        runtime: {
          listSkills: vi.fn().mockResolvedValue({ skills: [] }),
          listMcpServers: vi.fn().mockResolvedValue({ servers: [] }),
          listGlobalAgentWorkspaceActivations: vi.fn().mockResolvedValue({ activations: [] }),
          setGlobalAgentWorkspaceActivation,
        },
      },
    });
    renderLibrary(undefined, {
      agents: [{ ...agent, availabilityScope: 'workspace' }],
      teams: [team],
      workspaces: [
        {
          workspaceId: 'workspace-1' as never,
          name: '工作区 一',
          folderPath: 'D:/workspace-one',
          createdAt: '',
          updatedAt: '',
        } as never,
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: '配置 Agent Alpha 的激活工作区' }));
    expect(screen.getByTestId('agent-workspace-menu-agent-alpha')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /工作区 一/ }));

    await waitFor(() => {
      expect(setGlobalAgentWorkspaceActivation).toHaveBeenCalledWith({
        agentId: 'agent-alpha',
        workspaceId: 'workspace-1',
        active: true,
      });
    });
    expect(screen.getByTestId('agent-workspace-menu-agent-alpha')).toBeTruthy();
  });

  it('removes the legacy work tab and effect path from the detail drawer', () => {
    renderLibrary();
    openDrawer();

    expect(screen.queryByTestId('agent-drawer-tab-work')).toBeNull();
    expect(screen.queryByText('生效路径')).toBeNull();
  });

  it('shows shared MCP identity logos in the binding catalog', async () => {
    Object.defineProperty(window, 'syncThink', {
      configurable: true,
      value: {
        runtime: {
          listSkills: vi.fn().mockResolvedValue({ skills: [] }),
          listMcpServers: vi.fn().mockResolvedValue({
            servers: [
              {
                mcpServerId: 'mcp-context7',
                name: 'context7',
                endpoint: 'https://mcp.context7.com/mcp',
                tools: [{ name: 'resolve-library-id' }],
                trusted: true,
              },
              {
                mcpServerId: 'mcp-postgres',
                name: 'PostgreSQL',
                endpoint: 'npx -y @modelcontextprotocol/server-postgres',
                tools: [],
                trusted: true,
              },
            ],
          }),
        },
      },
    });
    renderLibrary();
    openDrawer();

    fireEvent.click(screen.getByTestId('agent-drawer-tab-abilities'));
    fireEvent.click(screen.getByTestId('agent-ability-subtab-mcp'));

    expect(await screen.findByTestId('mcp-icon-context7')).toBeTruthy();
    expect(screen.getByTestId('mcp-icon-postgres')).toBeTruthy();
  });

  it('edits skills, MCP servers and persona in the abilities tab', () => {
    renderLibrary();
    openDrawer();

    fireEvent.click(screen.getByTestId('agent-drawer-tab-abilities'));
    // 子 tab 默认是 skills;切到 persona 才有 textarea
    fireEvent.click(screen.getByTestId('agent-ability-subtab-persona'));
    const abilities = screen.getByTestId('agent-drawer-abilities');
    expect(abilities.querySelector('textarea')).toBeTruthy();

    const persona = abilities.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(persona, { target: { value: '新的人设指令' } });
    expect(persona.value).toBe('新的人设指令');
  });

  it('defaults a new agent to inheriting the current conversation', () => {
    renderLibrary();
    fireEvent.click(screen.getByRole('button', { name: /新建智能体/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /新建空白智能体/ }));

    const policy = screen.getByRole('group', { name: '委派写入权限' });
    expect(
      within(policy).getByRole('button', { name: /继承当前会话/ }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('edits avatar, name, description, models and reasoning in the settings tab', () => {
    renderLibrary();
    openDrawer();

    fireEvent.click(screen.getByTestId('agent-drawer-tab-settings'));
    const settings = screen.getByTestId('agent-drawer-settings');
    expect(settings.querySelector('input')).toBeTruthy();
    expect(settings.querySelector('select')).toBeNull();
    expect(settings.querySelector('textarea')).toBeNull();

    const nameInput = settings.querySelector('input[placeholder="前端小张"]') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '新名称' } });
    expect(nameInput.value).toBe('新名称');

    const reasoning = within(settings).getByRole('group', { name: '推理强度' });
    expect(
      within(reasoning).getByRole('button', { name: '自动' }).getAttribute('aria-pressed'),
    ).toBe('true');
    fireEvent.click(within(reasoning).getByRole('button', { name: '高' }));
    expect(within(reasoning).getByRole('button', { name: '高' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('filters skills with a capsule search and toggles a custom checkbox', async () => {
    Object.defineProperty(window, 'syncThink', {
      configurable: true,
      value: {
        runtime: {
          listSkills: vi.fn().mockResolvedValue({
            skills: [
              {
                skillVersionId: 'sv-1',
                name: 'Frontend',
                description: 'UI work',
                version: '1.0',
              },
              {
                skillVersionId: 'sv-2',
                name: 'Backend',
                description: 'API work',
                version: '2.0',
              },
            ],
          }),
          listMcpServers: vi.fn().mockResolvedValue({ servers: [] }),
        },
      },
    });
    renderLibrary();
    openDrawer();
    fireEvent.click(screen.getByTestId('agent-drawer-tab-abilities'));

    const frontend = await screen.findByRole('checkbox', { name: /Frontend/ });
    expect(frontend.getAttribute('aria-checked')).toBe('false');
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索 Skill' }), {
      target: { value: 'Back' },
    });
    expect(screen.queryByRole('checkbox', { name: /Frontend/ })).toBeNull();
    const backend = screen.getByRole('checkbox', { name: /Backend/ });
    fireEvent.click(backend);
    expect(backend.getAttribute('aria-checked')).toBe('true');
    await waitFor(() => {
      expect(screen.queryByRole('checkbox', { name: /Frontend/ })).toBeNull();
    });
  });
});
