/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  ChatPlanRevision,
  Conversation,
  ConversationPlanSummary,
  Event,
  GlobalAgent,
  Team,
} from '@sync-think/shared';
import { ChatView } from './ChatView.js';
import { ToastProvider, resetToastStoreForTests } from './Toast.js';

const runtime = {
  appendMessage: vi.fn(),
  compactConversation: vi.fn(),
  cancelRun: vi.fn(),
  conversationAskPending: vi.fn(),
  conversationPlanApprove: vi.fn(),
  conversationPlanGet: vi.fn(),
  conversationPlanSubmit: vi.fn(),
  getGoal: vi.fn(),
  getSettings: vi.fn(),
  getSkill: vi.fn(),
  listMcpServers: vi.fn(),
  listConversationMessages: vi.fn(),
  listSkills: vi.fn(),
  openTask: vi.fn(),
  readTaskPlanHistory: vi.fn(),
  rebindConversationTarget: vi.fn(),
  goalPause: vi.fn(),
  goalResume: vi.fn(),
  setGoal: vi.fn(),
  sendConversationMessage: vi.fn(),
  setConversationInteractionMode: vi.fn(),
};

function conversation(id: string, targetRef = 'agent-a'): Conversation {
  return {
    id,
    track: 'agent',
    targetRef,
    title: 'Skill test',
    executionMode: 'full-access',
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
  } as Conversation;
}

const agents = [
  { id: 'agent-a', name: 'Agent A', skillIds: ['skill-a', 'skill-b'] },
  { id: 'agent-b', name: 'Agent B', skillIds: [] },
] as unknown as GlobalAgent[];

const skillCatalog = {
  skills: [
    {
      skillVersionId: 'skill-a',
      skillId: 'family-a',
      name: 'review',
      description: 'Review this turn',
      version: '1.0.0',
      allowedTools: [],
      contentFingerprint: 'fingerprint-a',
      hasScripts: false,
      warnings: [],
      createdAt: '2026-07-29T00:00:00.000Z',
    },
    {
      skillVersionId: 'skill-b',
      skillId: 'family-b',
      name: 'research',
      description: 'Research the next turn',
      version: '2.0.0',
      allowedTools: [],
      contentFingerprint: 'fingerprint-b',
      hasScripts: false,
      warnings: [],
      createdAt: '2026-07-29T00:00:01.000Z',
    },
  ],
};

const planRevision: ChatPlanRevision = {
  id: 'revision-a',
  conversationId: 'conversation-plan-surface' as ChatPlanRevision['conversationId'],
  revision: 1,
  plan: {
    title: '对齐 NewMax 输入框',
    goal: '将审批移动到输入框表面',
    scope: ['apps/desktop'],
    assumptions: [],
    decisions: [],
    steps: [
      {
        id: 'step-a',
        title: '接入审批栈',
        description: '将方案卡接到 Composer 上方',
        expectedFiles: ['ChatView.tsx'],
        acceptanceChecks: ['审批不再出现在消息流'],
      },
    ],
    risks: [],
    finalAcceptanceChecks: ['定向测试通过'],
  },
  state: 'draft',
  createdAt: '2026-08-31T00:00:00.000Z',
};

const planSummary: ConversationPlanSummary = {
  planId: 'plan-a',
  conversationId: planRevision.conversationId,
  currentRevision: 1,
  state: 'draft',
  latest: planRevision,
  revisions: [planRevision],
};

const legacyPlanReviewAsk = {
  askId: 'ask-plan-review',
  threadId: 'thread-a',
  runId: 'run-plan-review',
  createdAt: '2026-08-31T00:00:00.000Z',
  questions: [
    {
      id: 'plan-review-question',
      question: '是否执行该方案？',
      detail: '# 对齐 NewMax 输入框\n\n1. 接入统一 Composer（验收：只出现一张审批卡）',
      intent: { kind: 'plan-review', approve: '确认执行' },
      options: [{ label: '确认执行' }, { label: '拒绝' }],
    },
  ],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

function renderChat(
  current: Conversation,
  models = [{ modelId: 'model-a', displayName: 'Model A', providerName: 'Provider' }],
  initialSkillVersionIds?: readonly string[],
  eventHistory: Event[] = [],
  seedComposerText?: string,
) {
  return render(
    <ToastProvider>
      <ChatView
        conversation={current}
        modelName="Model A"
        models={models}
        agents={agents}
        teams={[]}
        eventHistory={eventHistory}
        onTitleUpdated={vi.fn()}
        onConversationUpdated={vi.fn()}
        initialSkillVersionIds={initialSkillVersionIds}
        seedComposerText={seedComposerText}
      />
    </ToastProvider>,
  );
}

async function toggleSkill(skillVersionId: string, expectedCount: number) {
  fireEvent.click(screen.getByTestId('turn-skill-trigger'));
  fireEvent.click(await screen.findByTestId(`composer-skill-option-${skillVersionId}`));
  expect(screen.getByTestId('turn-skill-trigger').textContent?.trim()).toBe(
    expectedCount > 0 ? String(expectedCount) : '',
  );
}

async function waitForInitialMessages() {
  await waitFor(() => expect(runtime.listConversationMessages).toHaveBeenCalledTimes(1));
  await act(async () => Promise.resolve());
}

beforeEach(() => {
  runtime.appendMessage.mockReset().mockResolvedValue({ messageId: 'message-a', taskVersion: 1 });
  runtime.compactConversation.mockReset().mockResolvedValue({
    compacted: true,
    beforeTokens: 1200,
    afterTokens: 400,
    foldedCount: 3,
  });
  runtime.cancelRun.mockReset().mockResolvedValue({});
  runtime.conversationAskPending.mockReset().mockResolvedValue({ ask: undefined });
  runtime.conversationPlanApprove.mockReset().mockResolvedValue({});
  runtime.conversationPlanGet.mockReset().mockResolvedValue({ plan: undefined });
  runtime.conversationPlanSubmit.mockReset().mockResolvedValue({ plan: planSummary });
  runtime.getGoal.mockReset().mockResolvedValue({ goal: null, evaluatorConfigured: false });
  runtime.getSettings.mockReset().mockResolvedValue({ settings: {} });
  runtime.goalPause.mockReset().mockResolvedValue({});
  runtime.goalResume.mockReset().mockResolvedValue({});
  runtime.setGoal.mockReset().mockResolvedValue({
    goal: {
      conversationId: 'conversation-goal-risk',
      condition: '执行 rm -rf ./generated 后重建',
      status: 'active',
    },
    evaluatorConfigured: false,
  });
  runtime.getSkill.mockReset();
  runtime.listConversationMessages.mockReset().mockResolvedValue({
    messages: [],
    hasMore: false,
  });
  runtime.listSkills.mockReset().mockResolvedValue(skillCatalog);
  runtime.listMcpServers.mockReset().mockResolvedValue({ servers: [] });
  runtime.openTask.mockReset().mockResolvedValue({ task: { threadId: 'thread-a' } });
  runtime.readTaskPlanHistory.mockReset();
  runtime.rebindConversationTarget.mockReset().mockResolvedValue({ conversation: {} });
  runtime.sendConversationMessage.mockReset().mockResolvedValue({
    threadId: 'thread-a',
    taskVersion: 0,
    conversationTitle: 'Skill test',
  });
  runtime.setConversationInteractionMode.mockReset().mockResolvedValue({});
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: { runtime },
  });
});

afterEach(() => {
  cleanup();
  resetToastStoreForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'syncThink');
});

describe('ChatView turn Skill draft', () => {
  it('does not mount or request historical task lists', async () => {
    renderChat({ ...conversation('conversation-current-tasks'), taskId: 'task-a' } as Conversation);
    await waitFor(() => expect(runtime.listConversationMessages).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: '历史任务' })).toBeNull();
    expect(screen.queryByTestId('task-plan-history')).toBeNull();
    expect(runtime.readTaskPlanHistory).not.toHaveBeenCalled();
  });

  it('measures the toolbar and collapses permission before Skill', async () => {
    let outerWidth = 460;
    let resizeToolbar: ResizeObserverCallback | undefined;
    class ResizeObserverMock implements ResizeObserver {
      readonly callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }
      disconnect = vi.fn();
      observe = vi.fn((target: Element) => {
        if ((target as HTMLElement).dataset.testid === 'compose-toolbar') {
          resizeToolbar = this.callback;
        }
      });
      unobserve = vi.fn();
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.dataset.testid === 'compose-toolbar' ? outerWidth : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.dataset.testid === 'compose-permission-control') return 80;
      if (this.dataset.testid === 'compose-skill-control') return 40;
      if (this.parentElement?.classList.contains('shell-compose__bar-left')) return 40;
      if (this.parentElement?.classList.contains('shell-compose__bar-right')) {
        if (this.querySelector('.shell-compose__model-btn')) return 120;
        if (this.classList.contains('shell-compose__ctx')) return 22;
        if (this.dataset.action) return 36;
        return 40;
      }
      return 0;
    });

    renderChat(conversation('conversation-toolbar-collapse'));
    const toolbar = screen.getByTestId('compose-toolbar');
    const permission = screen.getByTestId('compose-permission-control');
    const skill = screen.getByTestId('compose-skill-control');
    expect(toolbar.dataset.collapseLevel).toBe('0');

    const permissionButton = screen.getByTitle('权限：完全访问');
    fireEvent.click(permissionButton);
    expect(screen.getByText('权限模式')).toBeTruthy();

    outerWidth = 380;
    await act(async () => {
      resizeToolbar?.([], {} as ResizeObserver);
      await Promise.resolve();
    });
    expect(toolbar.dataset.collapseLevel).toBe('1');
    expect(permission.hidden).toBe(true);
    expect(skill.hidden).toBe(false);
    expect(permissionButton.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('权限模式')).toBeNull();

    fireEvent.click(screen.getByTestId('compose-add-trigger'));
    const addMenu = await screen.findByTestId('compose-add-menu');
    expect(within(addMenu).getByText('询问批准')).toBeTruthy();
    expect(within(addMenu).getByText('为我批准')).toBeTruthy();
    expect(within(addMenu).getByText('完全访问')).toBeTruthy();

    outerWidth = 330;
    await act(async () => {
      resizeToolbar?.([], {} as ResizeObserver);
      await Promise.resolve();
    });
    expect(toolbar.dataset.collapseLevel).toBe('2');
    expect(skill.hidden).toBe(true);
  });

  it('surfaces the configured planning model and reasoning in Plan mode', async () => {
    runtime.getSettings.mockResolvedValue({
      settings: {
        'plan-act': {
          enabled: true,
          planModelId: 'planner',
          planReasoningEffort: 'high',
        },
      },
    });
    renderChat(
      {
        ...conversation('conversation-plan-model'),
        interactionMode: 'plan',
      } as Conversation,
      [
        { modelId: 'model-a', displayName: 'Model A', providerName: 'Provider' },
        { modelId: 'planner', displayName: 'Planner Pro', providerName: 'Provider' },
      ],
    );

    const trigger = await screen.findByTitle('切换规划模型，思考强度：高');
    expect(trigger.getAttribute('data-model-mode')).toBe('plan');
    expect(trigger.textContent).toContain('Planner Pro');
    expect(trigger.textContent).toContain('高');
  });

  it('keeps unscoped checklists out of conversations without a task or thread binding', async () => {
    const events = [
      {
        id: 'run-started',
        workspaceId: 'workspace-a',
        runId: 'run-a',
        category: 'run',
        type: 'run.started',
        sequence: 1,
        occurredAt: '2026-08-30T00:00:00.000Z',
        payload: {},
      },
      {
        id: 'plan-requested',
        workspaceId: 'workspace-a',
        runId: 'run-a',
        category: 'tool',
        type: 'tool.requested',
        sequence: 2,
        occurredAt: '2026-08-30T00:00:01.000Z',
        payload: {
          toolCall: {
            id: 'plan-a',
            name: 'update_task_plan',
            argumentsJson: JSON.stringify({
              items: [
                { title: '检查无任务会话', status: 'in_progress' },
                { title: '记录验证结果', status: 'pending' },
              ],
            }),
          },
        },
      },
    ] as unknown as Event[];

    renderChat(conversation('conversation-without-task'), undefined, undefined, events);

    expect(await screen.findByTestId('compose-input')).toBeTruthy();
    expect(screen.queryAllByText('检查无任务会话')).toHaveLength(0);
    expect(screen.queryAllByText('记录验证结果')).toHaveLength(0);
  });

  it('uses the shared NewMax editor for the active conversation', () => {
    renderChat(conversation('conversation-tall-composer'));
    const input = screen.getByTestId('compose-input') as HTMLTextAreaElement;

    expect(screen.getByTestId('conversation-composer-editor').contains(input)).toBe(true);
    expect(input.rows).toBe(1);
    expect(input.style.minHeight).toBe('36px');
    expect(input.style.maxHeight).toBe('200px');
    const composer = input.closest('.shell-compose');
    expect(composer?.getAttribute('data-layout')).toBe('tall');
    expect(composer?.classList.contains('shell-compose--tall')).toBe(false);
  });

  it('maps the compose shortcuts to the @ and / palettes', async () => {
    renderChat(conversation('conversation-shortcuts'));
    const input = screen.getByTestId('compose-input') as HTMLTextAreaElement;
    const editor = screen.getByRole('textbox', { name: '消息' });

    fireEvent.change(input, { target: { value: '@', selectionStart: 1 } });
    expect(input.value).toBe('@');
    const addMenu = await screen.findByTestId('compose-add-menu');
    expect(within(addMenu).getByText('附加文件')).toBeTruthy();
    expect(within(addMenu).getByText('规划模式')).toBeTruthy();
    expect(within(addMenu).getByText('目标模式')).toBeTruthy();
    expect(within(addMenu).getByText('会议纪要')).toBeTruthy();
    expect(within(addMenu).getByText('联网搜索')).toBeTruthy();
    expect(within(addMenu).getByText('工作区文件')).toBeTruthy();
    expect(screen.queryByText('来源与上下文')).toBeNull();
    expect(screen.queryByText('上传图片')).toBeNull();

    fireEvent.click(screen.getByTestId('turn-skill-trigger'));
    expect(input.value).toBe('@ /');
    const slashMenu = await screen.findByTestId('compose-slash-pop');
    expect(within(slashMenu).getByRole('option', { selected: true }).textContent).toContain(
      '/help',
    );

    fireEvent.keyDown(editor, { key: 'ArrowDown' });
    expect(within(slashMenu).getByRole('option', { selected: true }).textContent).toContain(
      '/plan',
    );
  });

  it('detects a slash query from the editor DOM value in the same input event', async () => {
    renderChat(conversation('conversation-current-selection-value'));
    const input = screen.getByTestId('compose-input') as HTMLTextAreaElement;

    fireEvent.change(input, {
      target: { value: '/pl keep this', selectionStart: 3, selectionEnd: 3 },
    });

    const menu = await screen.findByTestId('compose-slash-pop');
    expect(within(menu).getByText('/plan')).toBeTruthy();
    expect(input.value).toBe('/pl keep this');
  });

  it('uses the shared NewMax add menu and applies Plan from the focused composer', async () => {
    renderChat(conversation('conversation-add-menu'));
    const input = screen.getByTestId('compose-input') as HTMLTextAreaElement;

    fireEvent.click(screen.getByTestId('compose-add-trigger'));
    const menu = await screen.findByTestId('compose-add-menu');
    expect(menu.getAttribute('data-placement')).toBe('above');
    expect(within(menu).getByText('规划模式')).toBeTruthy();
    expect(within(menu).getByText('会议纪要')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '消息' }));

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(input.value).toBe('/plan '));
    expect(input.selectionStart).toBe(6);
    await waitFor(() =>
      expect(screen.getByTestId('compose-add-menu').getAttribute('data-motion-state')).toBe(
        'exiting',
      ),
    );
    await waitFor(() => expect(screen.queryByTestId('compose-add-menu')).toBeNull());
  });

  it('keeps bare Help focused and sends a Help request through the native contract', async () => {
    renderChat(conversation('conversation-help'));
    const input = screen.getByTestId('compose-input') as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: '/help', selectionStart: 5 } });
    fireEvent.click(screen.getByTestId('compose-send'));

    await waitFor(() => expect(input.value).toBe('/help '));
    await waitFor(() => expect(input.selectionStart).toBe(6));
    expect(screen.getByRole('button', { name: '退出帮助模式' })).toBeTruthy();
    expect(runtime.appendMessage).not.toHaveBeenCalled();

    fireEvent.change(input, {
      target: { value: '/help 如何进入规划模式', selectionStart: 16 },
    });
    fireEvent.click(screen.getByTestId('compose-send'));

    await waitFor(() => expect(runtime.appendMessage).toHaveBeenCalledTimes(1));
    expect(runtime.sendConversationMessage).toHaveBeenCalledWith({
      conversationId: 'conversation-help',
      text: '如何进入规划模式',
    });
    expect(runtime.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: '如何进入规划模式', helpMode: true }),
    );
  });

  it('applies a slash command in place with a trailing space and closes the palette', async () => {
    renderChat(conversation('conversation-slash-command'));
    const input = screen.getByTestId('compose-input') as HTMLTextAreaElement;

    fireEvent.change(input, {
      target: { value: '/pl keep this', selectionStart: 3 },
    });
    const menu = await screen.findByTestId('compose-slash-pop');
    const menuStyle = menu.getAttribute('style');
    fireEvent.click(within(menu).getByText('/plan'));

    await waitFor(() => expect(input.value).toBe('/plan keep this'));
    await waitFor(() => expect(input.selectionStart).toBe(6));
    await waitFor(() =>
      expect(screen.getByTestId('compose-slash-pop').getAttribute('data-motion-state')).toBe(
        'exiting',
      ),
    );
    expect(screen.getByTestId('compose-slash-pop').getAttribute('style')).toBe(menuStyle);
    await waitFor(() => expect(screen.queryByTestId('compose-slash-pop')).toBeNull());
  });

  it('executes Compact immediately when selected from the slash menu', async () => {
    renderChat(conversation('conversation-compact-action'));
    const input = screen.getByTestId('compose-input') as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: '/', selectionStart: 1 } });
    const menu = await screen.findByTestId('compose-slash-pop');
    fireEvent.click(within(menu).getByText('/compact'));

    await waitFor(() => expect(runtime.compactConversation).toHaveBeenCalledTimes(1));
    expect(input.value).toBe('');
    expect(runtime.appendMessage).not.toHaveBeenCalled();
  });

  it('opens the actual MCP status panel immediately when selected', async () => {
    renderChat(conversation('conversation-mcp-panel'));
    const input = screen.getByTestId('compose-input') as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: '/', selectionStart: 1 } });
    const menu = await screen.findByTestId('compose-slash-pop');
    fireEvent.click(within(menu).getByText('/mcp'));

    const mcpMenu = await screen.findByTestId('composer-mcp-menu');
    await waitFor(() => expect(runtime.listMcpServers).toHaveBeenCalledWith({ limit: 100 }));
    expect(input.value).toBe('');
    expect(runtime.appendMessage).not.toHaveBeenCalled();

    const menuStyle = mcpMenu.getAttribute('style');
    fireEvent.click(screen.getByRole('button', { name: '关闭 MCP 状态' }));
    await waitFor(() =>
      expect(screen.getByTestId('composer-mcp-menu').getAttribute('data-motion-state')).toBe(
        'exiting',
      ),
    );
    expect(screen.getByTestId('composer-mcp-menu').getAttribute('style')).toBe(menuStyle);
    await waitFor(() => expect(screen.queryByTestId('composer-mcp-menu')).toBeNull());
  });

  it('opens the MCP status panel when the command is sent directly', async () => {
    renderChat(conversation('conversation-mcp-command'));
    const input = screen.getByTestId('compose-input') as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: '/mcp', selectionStart: 4 } });
    fireEvent.click(screen.getByTestId('compose-send'));

    expect(await screen.findByTestId('composer-mcp-menu')).toBeTruthy();
    await waitFor(() => expect(runtime.listMcpServers).toHaveBeenCalledWith({ limit: 100 }));
    expect(input.value).toBe('');
    expect(runtime.appendMessage).not.toHaveBeenCalled();
  });

  it('rejects slash commands after existing text and closes the palette', async () => {
    renderChat(conversation('conversation-slash-position'));
    const input = screen.getByTestId('compose-input') as HTMLTextAreaElement;

    fireEvent.change(input, {
      target: { value: 'keep /pl', selectionStart: 8 },
    });
    const menu = await screen.findByTestId('compose-slash-pop');
    fireEvent.click(within(menu).getByText('/plan'));

    expect(input.value).toBe('keep /pl');
    expect(await screen.findByText('斜杠命令只能出现在输入开头')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId('compose-slash-pop').getAttribute('data-motion-state')).toBe(
        'exiting',
      ),
    );
    await waitFor(() => expect(screen.queryByTestId('compose-slash-pop')).toBeNull());
  });

  it('hides an unmatched slash palette after the Skill catalog resolves', async () => {
    runtime.listSkills.mockResolvedValue({ skills: [] });
    renderChat(conversation('conversation-slash-empty'));
    const input = screen.getByTestId('compose-input') as HTMLTextAreaElement;

    fireEvent.change(input, {
      target: { value: '/zzzz', selectionStart: 5 },
    });

    await waitFor(() => expect(runtime.listSkills).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId('compose-slash-pop')).toBeNull());
    expect(input.value).toBe('/zzzz');
  });

  it('renders the persisted Skill name inline with the user message', async () => {
    runtime.listConversationMessages.mockResolvedValue({
      messages: [
        {
          id: 'user-with-skill',
          threadId: 'thread-a',
          role: 'user',
          blocks: [
            {
              type: 'text',
              text: '检查这个方案',
              payload: {
                skillVersionIds: ['skill-a'],
                skills: [{ skillVersionId: 'skill-a', name: 'review' }],
              },
            },
          ],
          createdAt: '2026-07-29T00:00:00.000Z',
          sequence: 1,
        },
      ],
      hasMore: false,
    });
    renderChat(conversation('conversation-message-skill'));

    const skill = await screen.findByTestId('message-skill-list');
    expect(skill.textContent).toBe('review');
    expect(skill.parentElement?.textContent).toContain('review检查这个方案');
  });

  it('requests slash Skills for the current workspace and only renders the returned active set', async () => {
    runtime.listSkills.mockResolvedValue({ skills: [skillCatalog.skills[0]] });
    renderChat({
      ...conversation('conversation-workspace'),
      workspaceId: 'workspace-a',
    } as Conversation);

    fireEvent.click(screen.getByTestId('turn-skill-trigger'));
    expect(await screen.findByTestId('composer-skill-option-skill-a')).toBeTruthy();
    expect(screen.queryByTestId('composer-skill-option-skill-b')).toBeNull();
    expect(runtime.listSkills).toHaveBeenCalledWith({
      limit: 500,
      workspaceId: 'workspace-a',
    });
  });

  it('keeps the keyboard-active slash item visible while moving through a scrolled menu', async () => {
    renderChat(conversation('conversation-keyboard-scroll'));
    const editor = screen.getByRole('textbox', { name: '消息' });
    fireEvent.click(screen.getByTestId('turn-skill-trigger'));
    await screen.findByTestId('compose-slash-pop');
    const list = screen.getByTestId('composer-slash-scroll');
    const options = within(list).getAllByRole('option');
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 72 });
    Object.defineProperty(list, 'scrollTop', { configurable: true, value: 0, writable: true });
    options.forEach((option, index) => {
      Object.defineProperty(option, 'offsetTop', { configurable: true, value: index * 38 });
      Object.defineProperty(option, 'offsetHeight', { configurable: true, value: 34 });
    });

    for (let index = 0; index < 5; index += 1) {
      fireEvent.keyDown(editor, { key: 'ArrowDown' });
    }

    await waitFor(() => expect(list.scrollTop).toBeGreaterThan(0));
    const active = options.find((option) => option.getAttribute('aria-selected') === 'true');
    expect(active).toBeTruthy();
    expect(active!.offsetTop).toBeGreaterThanOrEqual(list.scrollTop);
    expect(active!.offsetTop + active!.offsetHeight).toBeLessThanOrEqual(
      list.scrollTop + list.clientHeight,
    );
  });

  it('shows the exact selected Skill names above the input and only the selected count below', async () => {
    renderChat(conversation('conversation-selected-skill'));

    await toggleSkill('skill-b', 1);

    const summary = await screen.findByTestId('composer-editor-inline-tokens');
    expect(summary.textContent).toContain('research');
    expect(summary.textContent).not.toContain('review');
    expect(screen.queryByTestId('compose-selected-skills')).toBeNull();
    expect(screen.getAllByRole('button', { name: '移除 Skill research' })).toHaveLength(1);
    expect(screen.getByTestId('turn-skill-trigger').textContent?.trim()).toBe('1');
    expect(screen.getByTestId('turn-skill-trigger').textContent).not.toContain('/8');
  });

  it('removes an individual selected Skill from its composer chip', async () => {
    renderChat(conversation('conversation-remove-selected-skill'));

    await toggleSkill('skill-b', 1);
    fireEvent.click(await screen.findByRole('button', { name: '移除 Skill research' }));

    expect(screen.queryByTestId('composer-editor-inline-tokens')).toBeNull();
    expect(screen.getByTestId('turn-skill-trigger').textContent?.trim()).toBe('');
  });

  it('shows NewMax Goal and Plan banners without duplicate toolbar badges', async () => {
    runtime.getGoal.mockResolvedValue({
      evaluatorConfigured: true,
      goal: {
        conversationId: 'conversation-modes',
        condition: '完成所有验证',
        status: 'active',
        startedAt: '2026-08-28T00:00:00.000Z',
        turnCount: 1,
        tokensIn: 0,
        tokensOut: 0,
      },
    });
    renderChat({ ...conversation('conversation-modes'), interactionMode: 'plan' } as Conversation);

    const plan = await screen.findByTestId('composer-plan-banner');
    expect(plan.textContent).toContain('规划模式');
    const planPill = screen.getByRole('button', { name: '退出规划模式' });
    expect(planPill.textContent).toContain('规划');

    fireEvent.click(planPill);
    await waitFor(() =>
      expect(runtime.setConversationInteractionMode).toHaveBeenCalledWith({
        conversationId: 'conversation-modes',
        interactionMode: 'execute',
      }),
    );
    const goalBanner = await screen.findByTestId('composer-goal-banner');
    fireEvent.click(within(goalBanner).getByRole('button', { name: '暂停目标' }));
    await waitFor(() =>
      expect(runtime.goalPause).toHaveBeenCalledWith({
        conversationId: 'conversation-modes',
      }),
    );
  });

  it('locks the editor while an active Goal runs but keeps transition controls available', async () => {
    runtime.getGoal.mockResolvedValue({
      evaluatorConfigured: true,
      goal: {
        conversationId: 'conversation-active-goal',
        condition: '完成所有验证',
        status: 'active',
        startedAt: '2026-08-28T00:00:00.000Z',
        turnCount: 1,
        tokensIn: 0,
        tokensOut: 0,
      },
    });
    renderChat(conversation('conversation-active-goal'));

    const banner = await screen.findByTestId('composer-goal-banner');
    const input = screen.getByTestId('compose-input') as HTMLTextAreaElement;
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toBe('暂停目标后输入');
    expect(screen.getByTestId('conversation-composer-editor').dataset.goalRunning).toBe('true');
    expect((screen.getByTestId('compose-voice') as HTMLButtonElement).disabled).toBe(true);

    const add = screen.getByTestId('compose-add-trigger') as HTMLButtonElement;
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    expect(await screen.findByTestId('compose-add-menu')).toBeTruthy();

    fireEvent.click(within(banner).getByRole('button', { name: '暂停目标' }));
    await waitFor(() =>
      expect(runtime.goalPause).toHaveBeenCalledWith({
        conversationId: 'conversation-active-goal',
      }),
    );
  });

  it('keeps a restored Goal draft visible but disables its send action', async () => {
    runtime.getGoal.mockResolvedValue({
      evaluatorConfigured: true,
      goal: {
        conversationId: 'conversation-active-goal-draft',
        condition: '完成所有验证',
        status: 'active',
        startedAt: '2026-08-28T00:00:00.000Z',
        turnCount: 1,
        tokensIn: 0,
        tokensOut: 0,
      },
    });
    renderChat(
      conversation('conversation-active-goal-draft'),
      undefined,
      undefined,
      [],
      '恢复后仍保留的草稿',
    );

    await screen.findByTestId('composer-goal-banner');
    const input = screen.getByTestId('compose-input') as HTMLTextAreaElement;
    await waitFor(() => expect(input.value).toBe('恢复后仍保留的草稿'));
    expect(input.disabled).toBe(true);
    expect(screen.queryByTestId('compose-send')).toBeNull();
    expect((screen.getByTestId('compose-voice') as HTMLButtonElement).disabled).toBe(true);
    expect(runtime.sendConversationMessage).not.toHaveBeenCalled();
  });

  it('pauses an active Goal before cancelling its Run when switching to Plan', async () => {
    const current = {
      ...conversation('conversation-goal-to-plan'),
      workspaceId: 'workspace-a',
      taskId: 'task-a',
    } as Conversation;
    runtime.getGoal.mockResolvedValue({
      evaluatorConfigured: true,
      goal: {
        conversationId: current.id,
        condition: '完成所有验证',
        status: 'active',
        startedAt: '2026-08-28T00:00:00.000Z',
        turnCount: 1,
        tokensIn: 0,
        tokensOut: 0,
      },
    });
    const events = [
      {
        id: 'goal-run-started',
        workspaceId: 'workspace-a',
        taskId: 'task-a',
        runId: 'run-goal-a',
        category: 'run',
        type: 'run.started',
        sequence: 1,
        occurredAt: '2026-08-31T00:00:00.000Z',
        payload: { threadId: 'thread-a' },
      },
    ] as unknown as Event[];
    renderChat(current, undefined, undefined, events);

    await screen.findByTestId('composer-goal-banner');
    await screen.findByTestId('compose-stop');
    act(() => {
      window.dispatchEvent(
        new CustomEvent('shell-toggle-plan-mode', {
          detail: { conversationId: current.id },
        }),
      );
    });

    await waitFor(() => expect(runtime.cancelRun).toHaveBeenCalledWith({ runId: 'run-goal-a' }));
    expect(runtime.goalPause.mock.invocationCallOrder[0]).toBeLessThan(
      runtime.cancelRun.mock.invocationCallOrder[0]!,
    );
    await waitFor(() =>
      expect((screen.getByTestId('compose-input') as HTMLTextAreaElement).value).toBe('/plan '),
    );
  });

  it('does not enter Plan when cancelling the active Goal Run fails', async () => {
    const current = {
      ...conversation('conversation-goal-plan-cancel-failure'),
      workspaceId: 'workspace-a',
      taskId: 'task-a',
    } as Conversation;
    runtime.getGoal.mockResolvedValue({
      evaluatorConfigured: true,
      goal: {
        conversationId: current.id,
        condition: '完成所有验证',
        status: 'active',
        startedAt: '2026-08-28T00:00:00.000Z',
        turnCount: 1,
        tokensIn: 0,
        tokensOut: 0,
      },
    });
    runtime.cancelRun.mockRejectedValueOnce(new Error('cancel failed'));
    const events = [
      {
        id: 'goal-run-started-failure',
        workspaceId: 'workspace-a',
        taskId: 'task-a',
        runId: 'run-goal-failure',
        category: 'run',
        type: 'run.started',
        sequence: 1,
        occurredAt: '2026-08-31T00:00:00.000Z',
        payload: { threadId: 'thread-a' },
      },
    ] as unknown as Event[];
    renderChat(current, undefined, undefined, events);

    await screen.findByTestId('compose-stop');
    act(() => {
      window.dispatchEvent(
        new CustomEvent('shell-toggle-plan-mode', {
          detail: { conversationId: current.id },
        }),
      );
    });

    expect(await screen.findByText('暂停目标失败: cancel failed')).toBeTruthy();
    expect((screen.getByTestId('compose-input') as HTMLTextAreaElement).value).toBe('');
    expect(runtime.setConversationInteractionMode).not.toHaveBeenCalled();
  });

  it('converts an ordinary Plan suggestion with Shift+Tab and exposes the mode pill', async () => {
    renderChat(conversation('conversation-plan-keyword'));
    const input = screen.getByTestId('compose-input') as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: '计划：检查登录流程', selectionStart: 9 } });
    expect((await screen.findByTestId('composer-mode-keyword-hint')).textContent).toContain(
      '创建规划',
    );

    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    await waitFor(() => expect(input.value).toBe('/plan 检查登录流程'));
    expect(screen.queryByTestId('composer-mode-keyword-hint')).toBeNull();
    expect(screen.getByRole('button', { name: '退出规划模式' })).toBeTruthy();
  });

  it('confirms a risky Goal shortcut before starting it and preserves the draft on return', async () => {
    renderChat(conversation('conversation-goal-risk'));
    const input = screen.getByTestId('compose-input') as HTMLTextAreaElement;
    const draft = '/goal 执行 rm -rf ./generated 后重建';

    fireEvent.change(input, { target: { value: draft, selectionStart: draft.length } });
    fireEvent.click(screen.getByTestId('compose-send'));

    expect(await screen.findByRole('dialog', { name: '高风险操作' })).toBeTruthy();
    expect(runtime.setGoal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '返回修改' }));
    expect(screen.queryByRole('dialog', { name: '高风险操作' })).toBeNull();
    expect(input.value).toBe(draft);

    fireEvent.click(screen.getByTestId('compose-send'));
    fireEvent.click(await screen.findByRole('button', { name: '仍然继续' }));

    await waitFor(() => expect(runtime.setGoal).toHaveBeenCalledTimes(1));
    expect(runtime.setGoal).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation-goal-risk',
        condition: '执行 rm -rf ./generated 后重建',
        maxGoalRounds: 10,
        maxGoalTokens: 1_000_000,
      }),
    );
  });

  it('renders a draft plan only in the compact Composer approval stack', async () => {
    runtime.conversationPlanGet.mockResolvedValue({ plan: planSummary });
    renderChat(conversation('conversation-plan-surface'));

    const card = await screen.findByTestId('plan-approval-card');
    expect(card.getAttribute('data-variant')).toBe('composer');
    expect(card.closest('[data-kind="plan"]')).not.toBeNull();
    expect(screen.queryByTestId('plan-approval-message')).toBeNull();
  });

  it('clears the previous plan card immediately when switching conversations', async () => {
    const nextPlan = deferred<{ plan: ConversationPlanSummary | undefined }>();
    runtime.conversationPlanGet.mockImplementation(
      ({ conversationId }: { conversationId: string }) =>
        conversationId === 'conversation-plan-surface'
          ? Promise.resolve({ plan: planSummary })
          : nextPlan.promise,
    );
    const view = renderChat(conversation('conversation-plan-surface'));
    expect(await screen.findByTestId('plan-approval-card')).toBeTruthy();

    view.rerender(
      <ToastProvider>
        <ChatView
          conversation={conversation('conversation-without-plan')}
          modelName="Model A"
          models={[{ modelId: 'model-a', displayName: 'Model A', providerName: 'Provider' }]}
          agents={agents}
          teams={[]}
          eventHistory={[]}
          onTitleUpdated={vi.fn()}
          onConversationUpdated={vi.fn()}
        />
      </ToastProvider>,
    );

    expect(
      screen.queryByTestId('plan-approval-card')?.closest('[data-state="exiting"]') ?? null,
    ).not.toBeNull();
    nextPlan.resolve({ plan: undefined });
  });

  it('ignores an old conversation plan lookup that resolves after navigation', async () => {
    const previousPlan = deferred<{ plan: ConversationPlanSummary | undefined }>();
    runtime.conversationPlanGet.mockImplementation(
      ({ conversationId }: { conversationId: string }) =>
        conversationId === 'conversation-plan-stale'
          ? previousPlan.promise
          : Promise.resolve({ plan: undefined }),
    );
    const view = renderChat(conversation('conversation-plan-stale'));
    await waitFor(() => expect(runtime.conversationPlanGet).toHaveBeenCalledTimes(1));

    view.rerender(
      <ToastProvider>
        <ChatView
          conversation={conversation('conversation-plan-current')}
          modelName="Model A"
          models={[{ modelId: 'model-a', displayName: 'Model A', providerName: 'Provider' }]}
          agents={agents}
          teams={[]}
          eventHistory={[]}
          onTitleUpdated={vi.fn()}
          onConversationUpdated={vi.fn()}
        />
      </ToastProvider>,
    );
    await waitFor(() => expect(runtime.conversationPlanGet).toHaveBeenCalledTimes(2));
    await act(async () => {
      previousPlan.resolve({ plan: planSummary });
      await previousPlan.promise;
    });

    expect(screen.queryByTestId('plan-approval-card')).toBeNull();
  });

  it('clears the previous Goal banner immediately when switching conversations', async () => {
    const nextGoal = deferred<{
      goal: null;
      evaluatorConfigured: boolean;
    }>();
    runtime.getGoal.mockImplementation(({ conversationId }: { conversationId: string }) =>
      conversationId === 'conversation-goal-active'
        ? Promise.resolve({
            goal: {
              conversationId,
              condition: '仅属于旧对话的目标',
              status: 'active',
              startedAt: '2026-09-01T00:00:00.000Z',
              turnCount: 0,
              tokensIn: 0,
              tokensOut: 0,
              roundsStarted: 1,
            },
            evaluatorConfigured: false,
          })
        : nextGoal.promise,
    );
    const view = renderChat(conversation('conversation-goal-active'));
    expect(await screen.findByTestId('composer-goal-banner')).toBeTruthy();

    view.rerender(
      <ToastProvider>
        <ChatView
          conversation={conversation('conversation-without-goal')}
          modelName="Model A"
        models={[{ modelId: 'model-a', displayName: 'Model A', providerName: 'Provider' }]}
        agents={agents}
        teams={[]}
        eventHistory={[]}
          onTitleUpdated={vi.fn()}
          onConversationUpdated={vi.fn()}
        />
      </ToastProvider>,
    );

    expect(
      screen.queryByTestId('composer-goal-banner')?.closest('[data-mode-state="exiting"]') ?? null,
    ).not.toBeNull();
    nextGoal.resolve({ goal: null, evaluatorConfigured: false });
  });

  it('hides the legacy plan-review Ask after it becomes the canonical Plan card', async () => {
    runtime.conversationAskPending.mockResolvedValue({ ask: legacyPlanReviewAsk });
    runtime.conversationPlanGet.mockResolvedValue({ plan: undefined });
    runtime.conversationPlanSubmit.mockResolvedValue({ plan: planSummary });
    renderChat({
      ...conversation('conversation-plan-surface'),
      workspaceId: 'workspace-a',
      taskId: 'task-a',
    } as Conversation);

    await waitFor(() => expect(runtime.conversationPlanSubmit).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('plan-approval-card')).toBeTruthy();
    expect(screen.queryByTestId('ask-plan-review-card')).toBeNull();
    expect(screen.getByTestId('conversation-composer-editor')).toBeTruthy();
  });

  it('keeps the approved plan visible until mode persistence and execution both settle', async () => {
    const modeSwitch = deferred<Record<string, never>>();
    runtime.conversationPlanGet.mockResolvedValue({ plan: planSummary });
    runtime.setConversationInteractionMode.mockReturnValueOnce(modeSwitch.promise);
    renderChat(conversation('conversation-plan-surface'));

    fireEvent.click(await screen.findByRole('button', { name: '批准并执行' }));
    await waitFor(() => expect(runtime.conversationPlanApprove).toHaveBeenCalledTimes(1));

    expect(screen.getByTestId('plan-approval-card')).toBeTruthy();
    expect(runtime.sendConversationMessage).not.toHaveBeenCalled();

    modeSwitch.resolve({});
    await waitFor(() => expect(runtime.sendConversationMessage).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('plan-approval-card')).toBeNull());
  });

  it('clears a bare Plan preview without changing mode or sending a turn', async () => {
    renderChat(conversation('conversation-plan-only'));
    const input = screen.getByTestId('compose-input') as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: '/plan', selectionStart: 5 } });
    fireEvent.click(screen.getByTestId('compose-send'));

    await waitFor(() => expect(input.value).toBe(''));
    expect(runtime.setConversationInteractionMode).not.toHaveBeenCalled();
    expect(runtime.appendMessage).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('composer-plan-banner')).toBeNull());
  });

  it('persists plan mode before sending a prefixed request without the command token', async () => {
    renderChat(conversation('conversation-plan-request'));
    const input = screen.getByTestId('compose-input') as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: '/plan 检查当前项目', selectionStart: 12 } });
    fireEvent.click(screen.getByTestId('compose-send'));

    await waitFor(() => expect(runtime.appendMessage).toHaveBeenCalledTimes(1));
    expect(runtime.setConversationInteractionMode).toHaveBeenCalledWith({
      conversationId: 'conversation-plan-request',
      interactionMode: 'plan',
    });
    expect(runtime.sendConversationMessage).toHaveBeenCalledWith({
      conversationId: 'conversation-plan-request',
      text: '检查当前项目',
    });
    expect(runtime.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: '检查当前项目' }),
    );
    expect(runtime.setConversationInteractionMode.mock.invocationCallOrder[0]).toBeLessThan(
      runtime.sendConversationMessage.mock.invocationCallOrder[0]!,
    );
  });

  it('starts Agent Compose empty and keeps an explicit selection after append succeeds', async () => {
    renderChat(conversation('conversation-a'));
    await waitForInitialMessages();
    expect(screen.getByTestId('turn-skill-trigger').textContent?.trim()).toBe('');
    expect(runtime.listSkills).not.toHaveBeenCalled();

    await toggleSkill('skill-b', 1);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Review this' } });
    fireEvent.click(screen.getByTestId('compose-send'));

    await waitFor(() =>
      expect(runtime.appendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ skillVersionIds: ['skill-b'], text: 'Review this' }),
      ),
    );
    expect(runtime.sendConversationMessage).toHaveBeenCalledWith({
      conversationId: 'conversation-a',
      text: 'Review this',
    });
    expect(screen.getByTestId('turn-skill-trigger').textContent?.trim()).toBe('1');
    expect(runtime.getSkill).not.toHaveBeenCalled();
  });

  it('retains the selection when append fails so the user can retry', async () => {
    runtime.appendMessage.mockRejectedValueOnce(new Error('append failed'));
    renderChat(conversation('conversation-a'));
    await waitForInitialMessages();
    expect(screen.getByTestId('turn-skill-trigger').textContent?.trim()).toBe('');
    await toggleSkill('skill-a', 1);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Retry this' } });
    fireEvent.click(screen.getByTestId('compose-send'));

    expect(await screen.findByText('发送失败: append failed')).toBeTruthy();
    expect(screen.getByTestId('turn-skill-trigger').textContent?.trim()).toBe('1');
  });

  it('keeps a temporary adjustment made while an append is pending', async () => {
    const pending = deferred<{ messageId: string; taskVersion: number }>();
    runtime.appendMessage.mockReturnValueOnce(pending.promise);
    renderChat(conversation('conversation-a'));
    expect(screen.getByTestId('turn-skill-trigger').textContent?.trim()).toBe('');
    await toggleSkill('skill-b', 1);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Review this' } });
    fireEvent.click(screen.getByTestId('compose-send'));
    await waitFor(() => expect(runtime.appendMessage).toHaveBeenCalledTimes(1));
    expect(runtime.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ skillVersionIds: ['skill-b'] }),
    );

    await toggleSkill('skill-b', 0);

    await act(async () => {
      pending.resolve({ messageId: 'message-a', taskVersion: 1 });
      await pending.promise;
    });
    expect(screen.getByTestId('turn-skill-trigger').textContent?.trim()).toBe('');
  });

  it('resets the Compose draft when the conversation or identity changes', async () => {
    const view = renderChat(conversation('conversation-a'));
    expect(screen.getByTestId('turn-skill-trigger').textContent?.trim()).toBe('');

    fireEvent.click(screen.getByTestId('compose-identity'));
    fireEvent.click(await screen.findByTestId('identity-option-agent-agent-b'));
    await waitFor(() => expect(runtime.rebindConversationTarget).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('turn-skill-trigger').textContent?.trim()).toBe('');

    view.rerender(
      <ToastProvider>
        <ChatView
          conversation={conversation('conversation-b')}
          modelName="Model A"
          models={[{ modelId: 'model-a', displayName: 'Model A', providerName: 'Provider' }]}
          agents={agents}
          teams={[]}
          eventHistory={[]}
          onTitleUpdated={vi.fn()}
          onConversationUpdated={vi.fn()}
        />
      </ToastProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('turn-skill-trigger').textContent?.trim()).toBe(''),
    );
  });

  it('keeps a Team selection when the coordinator changes', async () => {
    const sharedAgents = [
      { id: 'agent-a', name: 'Agent A', skillIds: ['skill-a', 'skill-b'] },
      { id: 'agent-b', name: 'Agent B', skillIds: ['skill-a', 'skill-b'] },
    ] as unknown as GlobalAgent[];
    const current = {
      ...conversation('conversation-team', 'team-a'),
      track: 'team',
    } as Conversation;
    const team = {
      id: 'team-a',
      coordinatorAgentId: 'agent-a',
      members: [{ agentId: 'agent-a' }, { agentId: 'agent-b' }],
    } as unknown as Team;
    const view = render(
      <ToastProvider>
        <ChatView
          conversation={current}
          modelName="Model A"
          models={[{ modelId: 'model-a', displayName: 'Model A', providerName: 'Provider' }]}
          agents={sharedAgents}
          teams={[team]}
          eventHistory={[]}
          onTitleUpdated={vi.fn()}
          onConversationUpdated={vi.fn()}
        />
      </ToastProvider>,
    );
    await toggleSkill('skill-b', 1);

    view.rerender(
      <ToastProvider>
        <ChatView
          conversation={current}
          modelName="Model A"
          models={[{ modelId: 'model-a', displayName: 'Model A', providerName: 'Provider' }]}
          agents={sharedAgents}
          teams={[{ ...team, coordinatorAgentId: sharedAgents[1]!.id }]}
          eventHistory={[]}
          onTitleUpdated={vi.fn()}
          onConversationUpdated={vi.fn()}
        />
      </ToastProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('turn-skill-trigger').textContent?.trim()).toBe('1'),
    );
  });

  it('keeps the Compose selection when only the model override changes', async () => {
    renderChat(conversation('conversation-a'), [
      { modelId: 'model-a', displayName: 'Model A', providerName: 'Provider' },
      { modelId: 'model-b', displayName: 'Model B', providerName: 'Provider' },
    ]);
    expect(screen.getByTestId('turn-skill-trigger').textContent?.trim()).toBe('');
    await toggleSkill('skill-a', 1);

    fireEvent.click(screen.getByTitle(/切换模型/));
    const provider = await screen.findByTestId('model-provider-Provider');
    provider.focus();
    fireEvent.keyDown(provider, { key: 'ArrowRight' });
    fireEvent.click(await screen.findByText('Model B'));

    await waitFor(() =>
      expect(screen.getByTestId('turn-skill-trigger').textContent?.trim()).toBe('1'),
    );
  });

  it('regenerates with an explicit empty selection without clearing the compose draft', async () => {
    runtime.listConversationMessages.mockResolvedValue({
      messages: [
        {
          id: 'user-old',
          threadId: 'thread-a',
          role: 'user',
          blocks: [{ type: 'text', text: 'Original prompt' }],
          createdAt: '2026-07-29T00:00:00.000Z',
          sequence: 1,
        },
        {
          id: 'assistant-old',
          threadId: 'thread-a',
          role: 'assistant',
          blocks: [{ type: 'text', text: 'Original answer' }],
          createdAt: '2026-07-29T00:00:01.000Z',
          sequence: 2,
        },
      ],
      hasMore: false,
    });
    renderChat(conversation('conversation-a'));
    await screen.findByText('Original answer');
    await toggleSkill('skill-b', 1);

    fireEvent.click(screen.getByTitle('重新生成'));
    await waitFor(() =>
      expect(runtime.appendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ skillVersionIds: [], text: 'Original prompt' }),
      ),
    );
    expect(screen.getByTestId('turn-skill-trigger').textContent?.trim()).toBe('1');
  });

  it('uses and keeps a welcome-page override when the new conversation mounts', async () => {
    renderChat(conversation('conversation-a'), undefined, ['skill-b']);
    await waitForInitialMessages();
    expect(screen.getByTestId('turn-skill-trigger').textContent?.trim()).toBe('1');

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Continue this' } });
    fireEvent.click(screen.getByTestId('compose-send'));

    await waitFor(() =>
      expect(runtime.appendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ skillVersionIds: ['skill-b'], text: 'Continue this' }),
      ),
    );
    expect(screen.getByTestId('turn-skill-trigger').textContent?.trim()).toBe('1');
  });
});
