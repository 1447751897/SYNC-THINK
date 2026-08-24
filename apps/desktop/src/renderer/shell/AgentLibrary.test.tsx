/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { Conversation, GlobalAgent, Team, TeamMember } from '@sync-think/shared';
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
  archived: false,
  createdAt: '2026-08-08T00:00:00.000Z',
  updatedAt: '2026-08-08T00:00:00.000Z',
};

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
  vi.clearAllMocks();
});

describe('AgentLibrary shared visual structure', () => {
  it('keeps an empty description in the card layout and selects the card when editing', () => {
    renderLibrary();

    const card = screen.getByText('Agent Alpha').closest('.shell-library-card');
    expect(card).toBeTruthy();
    expect(
      card?.querySelector('.shell-library-card__description')?.getAttribute('data-empty'),
    ).toBe('1');
    expect(card?.classList.contains('shell-library-card--selected')).toBe(false);

    fireEvent.click(card!);

    expect(card?.classList.contains('shell-library-card--selected')).toBe(true);
    expect(document.querySelector('.shell-library-drawer--agent')).toBeTruthy();
    expect(document.querySelector('[data-testid="agent-detail-drawer"]')).toBeTruthy();
    expect(document.querySelector('.shell-library-drawer__body')).toBeTruthy();
    expect(document.querySelectorAll('.shell-library-field').length).toBeGreaterThan(0);
  });

  it('starts a conversation without opening the edit dialog', () => {
    const onStartConversation = vi.fn();
    renderLibrary(onStartConversation);

    const action = document.querySelector<HTMLButtonElement>('.shell-library-card__action');
    expect(action).toBeTruthy();
    fireEvent.click(action!);

    expect(onStartConversation).toHaveBeenCalledWith('agent-alpha');
    expect(document.querySelector('.shell-library-drawer--agent')).toBeNull();
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

    expect(screen.getAllByRole('button', { name: '开始对话' })).toHaveLength(2);

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索智能体' }), {
      target: { value: 'release' },
    });
    expect(screen.queryByText('Agent Alpha')).toBeNull();
    expect(screen.getByText('Agent Beta')).toBeTruthy();

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索智能体' }), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: '按模型筛选' }), {
      target: { value: 'model-alpha' },
    });
    expect(screen.getByText('Agent Alpha')).toBeTruthy();
    expect(screen.queryByText('Agent Beta')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '列表视图' }));
    expect(document.querySelector('.shell-library-grid')?.getAttribute('data-view')).toBe('list');
    expect(screen.getByRole('button', { name: '列表视图' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('labels a missing model without exposing its internal id as the model name', () => {
    const missingModelAgent = {
      ...agent,
      defaultModelId: 'model-removed-from-catalog' as GlobalAgent['defaultModelId'],
    };
    renderLibrary(undefined, { agents: [missingModelAgent], models: [] });

    expect(screen.getByText('模型不可用')).toBeTruthy();
    expect(screen.queryByText('model-removed-from-catalog')).toBeNull();

    fireEvent.click(screen.getByText('Agent Alpha').closest('.shell-library-card')!);
    expect(screen.getAllByText('模型不可用').length).toBeGreaterThan(1);
    expect(screen.queryByText('model-removed-from-catalog')).toBeNull();
  });

  it('closes the agent drawer with Escape', () => {
    renderLibrary();
    fireEvent.click(screen.getByText('Agent Alpha').closest('.shell-library-card')!);

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

  const assignedConversation = {
    id: 'conversation-1',
    track: 'agent',
    targetRef: 'agent-alpha',
    workspaceId: 'workspace-1',
    title: 'Agent Alpha 的对话',
    executionMode: 'full-access',
    createdAt: '2026-08-08T00:00:00.000Z',
    updatedAt: '2026-08-08T00:00:00.000Z',
  } as unknown as Conversation;

  function openDrawer() {
    fireEvent.click(screen.getByText('Agent Alpha').closest('.shell-library-card')!);
    expect(screen.getByTestId('agent-detail-drawer')).toBeTruthy();
  }

  it('shows the overview tab by default with read-only info', () => {
    renderLibrary();
    openDrawer();

    const overview = screen.getByTestId('agent-drawer-overview');
    expect(overview).toBeTruthy();
    expect(within(overview).getByText('所在小队')).toBeTruthy();
    expect(within(overview).getByText('使用模型')).toBeTruthy();
    expect(within(overview).getByText('Model Alpha')).toBeTruthy();
    expect(within(overview).getByText('Keep the interface consistent.')).toBeTruthy();
    expect(within(overview).getByText('包含 Skill（0）')).toBeTruthy();
    // 概览不出现可编辑控件
    expect(overview.querySelector('input')).toBeNull();
    expect(overview.querySelector('textarea')).toBeNull();
  });

  it('switches to the work tab and opens an assigned conversation', () => {
    const onOpenConversation = vi.fn();
    renderLibrary(undefined, {
      teams: [team],
      conversations: [assignedConversation],
      workspaces: [
        {
          workspaceId: 'workspace-1' as never,
          name: '工作区 一',
          createdAt: '',
          updatedAt: '',
        } as never,
      ],
      onOpenConversation,
    });
    openDrawer();

    // 概览展示所属小队（teams 已传入）
    expect(screen.getByText(/Team Alpha/)).toBeTruthy();

    fireEvent.click(screen.getByTestId('agent-drawer-tab-work'));
    expect(screen.getByTestId('agent-drawer-work')).toBeTruthy();
    // 工作区行存在,初始折叠 → 对话尚未渲染
    const wsRow = screen.getByTestId('agent-work-workspace-workspace-1');
    expect(wsRow).toBeTruthy();

    // 展开工作区 → 对话行出现
    fireEvent.click(wsRow);
    expect(screen.getByTestId('agent-work-open-conversation-1')).toBeTruthy();

    fireEvent.click(screen.getByTestId('agent-work-open-conversation-1'));
    expect(onOpenConversation).toHaveBeenCalledWith('conversation-1');
  });

  it('shows the empty state in the work tab when no conversations are assigned', () => {
    renderLibrary();
    openDrawer();

    fireEvent.click(screen.getByTestId('agent-drawer-tab-work'));
    expect(screen.getByTestId('agent-drawer-work')).toBeTruthy();
    expect(screen.getByText(/暂无已分配对话/)).toBeTruthy();
  });

  it('hides orphan conversations without a workspace from the work tab', () => {
    // conv-orphan has no workspaceId — the stage cannot locate it, so it must
    // not be listed (it would show an unopenable "未命名对话" row).
    const orphan = {
      id: 'conv-orphan',
      track: 'agent',
      targetRef: 'agent-alpha',
      title: '',
      executionMode: 'full-access',
      createdAt: '2026-08-08T00:00:00.000Z',
      updatedAt: '2026-08-08T00:00:00.000Z',
    } as unknown as Conversation;
    renderLibrary(undefined, { conversations: [orphan] });
    openDrawer();

    fireEvent.click(screen.getByTestId('agent-drawer-tab-work'));
    expect(screen.getByTestId('agent-drawer-work')).toBeTruthy();
    expect(screen.getByText(/暂无已分配对话/)).toBeTruthy();
    expect(screen.queryByText(/未命名对话/)).toBeNull();
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

  it('edits avatar, name, description, models and reasoning in the settings tab', () => {
    renderLibrary();
    openDrawer();

    fireEvent.click(screen.getByTestId('agent-drawer-tab-settings'));
    const settings = screen.getByTestId('agent-drawer-settings');
    expect(settings.querySelector('input')).toBeTruthy();
    expect(settings.querySelector('select')).toBeTruthy();
    expect(settings.querySelector('textarea')).toBeNull();

    const nameInput = settings.querySelector('input[placeholder="前端小张"]') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '新名称' } });
    expect(nameInput.value).toBe('新名称');
  });
});
