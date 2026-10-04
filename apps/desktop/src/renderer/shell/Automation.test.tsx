import { changeTaskControl, taskOption } from './task-select-test-utils.js';
/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Conversation, GlobalAgent, ScheduledTask, Team } from '@sync-think/shared';
import type {
  BrowserProfileSummary,
  BrowserAutomationTaskSummary,
  McpServerSummary,
  BrowserHandoffSummary,
} from '@sync-think/protocol';
import { TaskPanel } from './TaskPanel.js';
import { MCP_CATALOG_LIMIT } from './mcp-catalog-loader.js';
import {
  AutomationBindings,
  type AutomationResources,
  type AutomationBinding,
} from './AutomationBindings.js';
import { useState } from 'react';
import { createCalendarPreviewRuntime } from './design-system/fixtures/calendar.js';

const profile: BrowserProfileSummary = {
  id: 'profile-work',
  name: '工作 Profile',
  revision: 1,
  isDefault: true,
  inUse: false,
  siteCount: 1,
  createdAt: '2026-09-30T00:00:00Z',
  updatedAt: '2026-09-30T00:00:00Z',
};
const workflow: BrowserAutomationTaskSummary = {
  id: 'flow-published',
  name: '已审核的采集流程',
  profileId: profile.id,
  instruction: '采集页面',
  startUrl: 'https://example.com',
  source: 'manual',
  status: 'enabled',
  revision: 1,
  publishedVersionId: 'version-1',
  successCount: 0,
  failureCount: 0,
  createdAt: profile.createdAt,
  updatedAt: profile.updatedAt,
};
const gmail: McpServerSummary = {
  mcpServerId: 'mcp-gmail',
  name: 'Gmail',
  transport: 'remote-http',
  endpoint: 'https://example.com/mcp',
  tools: [
    {
      name: 'gmail_send_message',
      description: 'Send an email',
      inputSchemaJson: JSON.stringify({
        type: 'object',
        properties: { to: { type: 'string' }, subject: { type: 'string' } },
        required: ['to'],
      }),
    },
  ],
  enabled: true,
  trusted: true,
  maxOutputBytes: 10000,
  timeoutMs: 30000,
  notes: '',
  createdAt: profile.createdAt,
  updatedAt: profile.updatedAt,
};
const scheduled: ScheduledTask = {
  id: 'scheduled-1',
  name: '资料整理',
  instruction: '整理实际工作区资料',
  target: { kind: 'model', modelId: 'model-one' },
  rule: { kind: 'every', intervalMinutes: 60 },
  timeZone: 'Asia/Shanghai',
  enabled: false,
  createdAt: profile.createdAt,
  updatedAt: profile.updatedAt,
};
const browserTask: ScheduledTask = {
  ...scheduled,
  id: 'browser-1',
  name: '页面采集',
  automation: {
    browser: { profileId: profile.id, workflowTaskId: workflow.id },
    requiredMcpServerIds: [gmail.mcpServerId],
    outputs: ['spreadsheet'],
    delivery: {
      kind: 'gmail',
      mcpServerId: gmail.mcpServerId,
      toolName: 'gmail_send_message',
      recipient: 'reader@example.com',
    },
    acceptance: '采集→整理→产物→交付；核对表格文件与 Gmail 发送回执。',
  },
};
const resources: AutomationResources = {
  profiles: [profile],
  workflows: [workflow],
  servers: [gmail],
  errors: {},
  loading: false,
};
const agent: GlobalAgent = {
  id: 'agent-one' as GlobalAgent['id'],
  name: '研究助手',
  avatar: '🧭',
  persona: '',
  description: '',
  defaultModelId: 'model-one' as GlobalAgent['defaultModelId'],
  fallbackModelIds: [],
  skillIds: [],
  mcpServerIds: [],
  reasoningEffort: '',
  archived: false,
  createdAt: profile.createdAt,
  updatedAt: profile.updatedAt,
};
const team: Team = {
  id: 'team-one' as Team['id'],
  name: '研究小队',
  avatar: '',
  mission: '',
  strategy: 'serial',
  members: [{ agentId: agent.id, memberOrder: 0, role: '', title: '', dependsOn: [] }],
  createdAt: profile.createdAt,
  updatedAt: profile.updatedAt,
};

function setup(
  overrides: Record<string, unknown> = {},
  initialTasks: ScheduledTask[] = [scheduled, browserTask],
) {
  let tasks = initialTasks;
  const runtime = {
    listScheduledTasks: vi.fn(async () => ({ tasks })),
    listBrowserProfiles: vi.fn(async () => ({ profiles: [profile] })),
    browserWorkflow: {
      list: vi.fn(async () => ({
        tasks: [
          workflow,
          {
            ...workflow,
            id: 'draft-flow',
            name: '未发布流程',
            publishedVersionId: undefined,
            status: 'draft',
          },
        ],
      })),
    },
    listMcpServers: vi.fn(async () => ({ servers: [gmail] })),
    scheduledTaskHistory: vi.fn(async ({ taskId }: { taskId: string }) => ({
      entries: [
        {
          id: `${taskId}-history`,
          taskId,
          status: 'success',
          firedAt: profile.updatedAt,
          summary: `${taskId} 的真实执行摘要`,
          runId: 'run-existing',
        },
      ],
    })),
    listWaitingBrowserHandoffs: vi.fn(async () => ({ handoffs: [] })),
    continueBrowserHandoff: vi.fn(async () => ({})),
    cancelBrowserHandoff: vi.fn(async () => ({})),
    createScheduledTask: vi.fn(async () => ({ task: scheduled })),
    updateScheduledTask: vi.fn(
      async ({ taskId, patch }: { taskId: string; patch: Partial<ScheduledTask> }) => {
        tasks = tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task));
        return { task: tasks.find((task) => task.id === taskId) };
      },
    ),
    triggerScheduledTask: vi.fn(async () => ({ fired: true, task: scheduled })),
    deleteScheduledTask: vi.fn(async () => ({ deleted: true })),
    ...overrides,
  };
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    writable: true,
    value: { runtime },
  });
  return runtime;
}
function panel(initialView: 'calendar' | 'center' = 'center') {
  return render(
    <TaskPanel
      initialView={initialView}
      agents={[agent]}
      teams={[team]}
      models={[{ modelId: 'model-one', displayName: '工作模型', providerName: 'provider' }]}
      skills={[]}
      workspaces={[]}
    />,
  );
}
async function selectBrowser() {
  fireEvent.click(await screen.findByRole('button', { name: '查看 页面采集' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '立即测试' }).hasAttribute('disabled')).toBe(false),
  );
}
function newTask() {
  fireEvent.click(screen.getByTestId('task-create'));
  changeTaskControl(screen.getByPlaceholderText('如：每日代码巡检'), {
    target: { value: '新采集任务' },
  });
  changeTaskControl(screen.getByPlaceholderText(/检查仓库/), {
    target: { value: '采集并整理结果' },
  });
}
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'syncThink');
});

describe('Automation center', () => {
  it('saves a fresh-chat destination on an existing task without losing browser bindings', async () => {
    const api = setup(); panel(); await selectBrowser();
    fireEvent.click(screen.getByRole('button', { name: '编辑选中任务' }));
    fireEvent.keyDown(screen.getByRole('button', { name: '运行会话' }), { key: 'ArrowDown', code: 'ArrowDown' });
    fireEvent.click(screen.getByRole('menuitem', { name: '每次运行时新建会话' }));
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(api.updateScheduledTask).toHaveBeenCalledWith(expect.objectContaining({
      taskId: browserTask.id, patch: expect.objectContaining({ automation: { ...browserTask.automation, conversation: { mode: 'new' } } }),
    })));
  });
  it('creates a draft in a selected existing chat and adopts its real executor', async () => {
    const selected = { id: 'writer-chat', title: '已有写作上下文', track: 'model', targetRef: 'model-one', createdAt: profile.createdAt, updatedAt: profile.updatedAt, executionMode: 'workspace', interactionMode: 'execute' } as Conversation;
    const api = setup({ listConversations: vi.fn(async () => ({ conversations: [selected] })) });
    panel(); await screen.findByRole('button', { name: '查看 资料整理' }); newTask();
    fireEvent.keyDown(screen.getByRole('button', { name: '运行会话' }), { key: 'ArrowDown', code: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('menuitem', { name: /已有写作上下文/ }));
    fireEvent.keyDown(screen.getByRole('button', { name: '任务归属' }), { key: 'ArrowDown', code: 'ArrowDown' });
    fireEvent.click(screen.getByRole('menuitemradio', { name: '全局任务 不隶属工作区' }));
    fireEvent.click(screen.getByRole('button', { name: '创建任务' }));
    await waitFor(() => expect(api.createScheduledTask).toHaveBeenCalledWith(expect.objectContaining({
      enabled: false, target: { kind: 'model', modelId: 'model-one' }, automation: expect.objectContaining({ conversation: { mode: 'existing', conversationId: 'writer-chat' } }),
    })));
  });
  it('lets the user clear existing structured checks while preserving outputs, prose and unrelated bindings', async () => {
    const automation: AutomationBinding = {
      ...browserTask.automation,
      outputs: ['spreadsheet', 'presentation'],
      acceptanceChecks: {
        minimumRows: 8,
        requiredColumns: ['标题'],
        dateColumn: '日期',
        sourceUrlColumn: '来源',
        minimumSlides: 5,
      },
    };
    const api = setup({}, [{ ...browserTask, automation }]);
    panel();
    await selectBrowser();
    fireEvent.click(screen.getByRole('button', { name: '编辑选中任务' }));
    fireEvent.click(screen.getByRole('button', { name: /验收与权限/ }));
    expect((screen.getByLabelText('表格最少数据行数') as HTMLInputElement).value).toBe('8');
    expect((screen.getByLabelText('PPT 最少页数') as HTMLInputElement).value).toBe('5');
    fireEvent.click(screen.getByRole('button', { name: '清除结构化验收' }));
    for (const label of [
      '表格最少数据行数',
      '必需列（逗号分隔）',
      '日期列（按本轮本地日期核对）',
      '来源 URL 列',
      'PPT 最少页数',
    ]) {
      expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe('');
    }
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(api.updateScheduledTask).toHaveBeenCalledOnce());
    expect(api.updateScheduledTask.mock.calls[0]?.[0].patch.automation).toEqual({
      ...automation,
      acceptanceChecks: undefined,
    });
    expect(api.triggerScheduledTask).not.toHaveBeenCalled();
  });

  it('does not save hidden checks for a disabled format and provides an explicit clear action', async () => {
    const automation: AutomationBinding = {
      ...browserTask.automation,
      outputs: [],
      acceptanceChecks: { minimumRows: 8 },
    };
    const api = setup({}, [{ ...browserTask, automation }]);
    panel();
    await selectBrowser();
    fireEvent.click(screen.getByRole('button', { name: '编辑选中任务' }));
    fireEvent.click(screen.getByRole('button', { name: /验收与权限/ }));
    expect(screen.queryByLabelText('表格最少数据行数')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    expect((await screen.findByRole('alert')).textContent).toContain('表格输出');
    expect(api.updateScheduledTask).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '清除结构化验收' }));
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(api.updateScheduledTask).toHaveBeenCalledOnce());
    const savedAutomation: AutomationBinding | undefined =
      api.updateScheduledTask.mock.calls[0]?.[0].patch.automation;
    expect(savedAutomation?.acceptanceChecks).toBeUndefined();
  });

  it('blocks incomplete comma-separated columns, keeps editing text, and saves the normalized explicit checks', async () => {
    const api = setup();
    panel();
    await selectBrowser();
    fireEvent.click(screen.getByRole('button', { name: '编辑选中任务' }));
    fireEvent.click(screen.getByRole('button', { name: /验收与权限/ }));
    changeTaskControl(screen.getByLabelText('必需列（逗号分隔）'), { target: { value: '标题,' } });
    expect((screen.getByLabelText('必需列（逗号分隔）') as HTMLInputElement).value).toBe('标题,');
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    expect((await screen.findByRole('alert')).textContent).toContain('列名');
    expect(api.updateScheduledTask).not.toHaveBeenCalled();
    changeTaskControl(screen.getByLabelText('必需列（逗号分隔）'), {
      target: { value: ' 标题,日期，来源 ' },
    });
    changeTaskControl(screen.getByLabelText('日期列（按本轮本地日期核对）'), {
      target: { value: ' 日期 ' },
    });
    changeTaskControl(screen.getByLabelText('来源 URL 列'), { target: { value: ' 来源 ' } });
    changeTaskControl(screen.getByLabelText('表格最少数据行数'), { target: { value: '8' } });
    fireEvent.click(screen.getByLabelText('演示文稿 / PPT'));
    changeTaskControl(screen.getByLabelText('PPT 最少页数'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(api.updateScheduledTask).toHaveBeenCalledOnce());
    expect(api.updateScheduledTask.mock.calls[0]?.[0].patch.automation).toEqual({
      ...browserTask.automation,
      outputs: ['spreadsheet', 'presentation'],
      acceptanceChecks: {
        minimumRows: 8,
        requiredColumns: ['标题', '日期', '来源'],
        dateColumn: '日期',
        sourceUrlColumn: '来源',
        minimumSlides: 5,
      },
    });
    expect(api.triggerScheduledTask).not.toHaveBeenCalled();
  });

  it.each([
    ['表格最少数据行数', '0'],
    ['表格最少数据行数', '-1'],
    ['表格最少数据行数', '1.5'],
    ['表格最少数据行数', 'abc'],
    ['表格最少数据行数', '1e3'],
    ['表格最少数据行数', '9007199254740992'],
    ['PPT 最少页数', '0'],
    ['PPT 最少页数', '-1'],
    ['PPT 最少页数', '1.5'],
    ['PPT 最少页数', 'abc'],
  ])('blocks saving invalid %s %s and permits explicitly clearing it', async (label, invalid) => {
    const api = setup();
    panel();
    await selectBrowser();
    fireEvent.click(screen.getByRole('button', { name: '编辑选中任务' }));
    fireEvent.click(screen.getByRole('button', { name: /验收与权限/ }));
    if (label === 'PPT 最少页数') fireEvent.click(screen.getByLabelText('演示文稿 / PPT'));
    const input = screen.getByLabelText(label) as HTMLInputElement;
    changeTaskControl(input, { target: { value: invalid } });
    expect(input.value).toBe(invalid);
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    expect((await screen.findByRole('alert')).textContent).toContain('正整数');
    expect(api.updateScheduledTask).not.toHaveBeenCalled();
    changeTaskControl(input, { target: { value: '' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(api.updateScheduledTask).toHaveBeenCalledOnce());
    const savedAutomation: AutomationBinding | undefined =
      api.updateScheduledTask.mock.calls[0]?.[0].patch.automation;
    expect(savedAutomation?.acceptanceChecks).toBeUndefined();
    expect(api.triggerScheduledTask).not.toHaveBeenCalled();
  });

  it.each([
    ['waiting_input', '等待操作'],
    ['blocked', '配置阻塞'],
    ['reconciling', '交付待核对'],
    ['cancelled', '已取消'],
  ])(
    'keeps %s distinct from failure and skipping in the existing task list and history sheet',
    async (status, label) => {
      const reason = '本轮具体原因';
      const api = setup({
        listScheduledTasks: vi.fn(async () => ({
          tasks: [
            {
              ...scheduled,
              lastRunAt: profile.updatedAt,
              lastResult: { status, firedAt: profile.updatedAt, reason },
            },
          ],
        })),
        scheduledTaskHistory: vi.fn(async () => ({
          entries: [
            {
              id: 'sheet-history',
              taskId: scheduled.id,
              status,
              firedAt: profile.updatedAt,
              summary: '运行摘要',
              reason,
            },
          ],
        })),
      });
      panel('calendar');
      fireEvent.click(await screen.findByRole('button', { name: '列表' }));
      const lastResult = await screen.findByRole('button', { name: new RegExp('上次.*' + label) });
      expect(lastResult.textContent).toContain(reason);
      expect(lastResult.textContent).not.toContain('✗');
      fireEvent.click(lastResult);
      const history = await screen.findByTestId('task-history');
      expect(await within(history).findByText(label)).toBeTruthy();
      expect(within(history).getByText('运行摘要')).toBeTruthy();
      expect(within(history).getByText(reason)).toBeTruthy();
      expect(api.triggerScheduledTask).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['waiting_input', '等待操作', '请完成登录'],
    ['blocked', '配置阻塞', '缺少指定连接器'],
    ['reconciling', '交付待核对', '回执尚未核对'],
  ])(
    'shows %s distinctly from failure and preserves its concrete reason beside the summary',
    async (status, label, reason) => {
      const entries = [
        {
          id: 'pending-history',
          taskId: scheduled.id,
          status,
          firedAt: profile.updatedAt,
          summary: '本轮执行摘要',
          reason,
        },
      ];
      const api = setup({
        listScheduledTasks: vi.fn(async () => ({
          tasks: [{ ...scheduled, lastResult: { status, firedAt: profile.updatedAt, reason } }],
        })),
        scheduledTaskHistory: vi.fn(async () => ({ entries })),
      });
      panel();
      const taskButton = await screen.findByRole('button', { name: '查看 资料整理' });
      expect(taskButton.textContent).toContain(label);
      const history = await screen.findByTestId('automation-history');
      expect(await within(history).findByText(label)).toBeTruthy();
      expect(within(history).getByText('本轮执行摘要')).toBeTruthy();
      expect(within(history).getByText(reason)).toBeTruthy();
      expect(within(history).queryByText('执行失败')).toBeNull();
      expect(api.triggerScheduledTask).not.toHaveBeenCalled();
    },
  );

  it('opens the accepted list/detail/readiness layout and fetches real registries including disabled drafts', async () => {
    const api = setup();
    panel();
    expect(await screen.findByRole('button', { name: '查看 资料整理' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '自动化中心' })).toBeTruthy();
    expect(screen.getByTestId('automation-detail').textContent).toContain(scheduled.instruction);
    expect(screen.getByRole('complementary', { name: '执行就绪栏' })).toBeTruthy();
    expect(api.listScheduledTasks).toHaveBeenCalledWith({ includeDisabled: true });
    expect(api.listBrowserProfiles).toHaveBeenCalledWith({});
    expect(api.browserWorkflow.list).toHaveBeenCalledWith({});
    expect(api.listMcpServers).toHaveBeenCalledWith({ limit: MCP_CATALOG_LIMIT });
  });

  it('labels registry binding as configuration ready rather than live execution ready', async () => {
    setup();
    panel();
    await selectBrowser();
    const rail = screen.getByRole('complementary', { name: '执行就绪栏' });
    expect(await within(rail).findByRole('heading', { name: '配置就绪' })).toBeTruthy();
    expect(within(rail).queryByRole('heading', { name: '执行就绪' })).toBeNull();
    expect(rail.textContent).toContain('尚未实际执行验证');
    expect(rail.textContent).toContain('这里只检查登记与绑定');
  });

  it('scrolls a newly selected detail into reach only in a narrow task panel', async () => {
    setup();
    panel();
    await screen.findByRole('button', { name: '查看 页面采集' });
    const taskPanel = screen.getByTestId('task-panel');
    const detail = screen.getByTestId('automation-detail');
    const scroll = vi.fn();
    Object.defineProperty(detail, 'scrollIntoView', { value: scroll, configurable: true });
    Object.defineProperty(taskPanel, 'clientWidth', { value: 1200, configurable: true });
    fireEvent.click(screen.getByRole('button', { name: '查看 页面采集' }));
    expect(scroll).not.toHaveBeenCalled();
    Object.defineProperty(taskPanel, 'clientWidth', { value: 390, configurable: true });
    fireEvent.click(screen.getByRole('button', { name: '查看 资料整理' }));
    await waitFor(() =>
      expect(scroll).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' }),
    );
    expect(detail.textContent).toContain(scheduled.name);
  });

  it('filters all / scheduled / browser without introducing records', async () => {
    setup();
    panel();
    await screen.findByRole('button', { name: '查看 页面采集' });
    fireEvent.click(screen.getByRole('button', { name: '浏览器任务' }));
    expect(screen.queryByRole('button', { name: '查看 资料整理' })).toBeNull();
    expect(screen.getByTestId('automation-detail').textContent).toContain('页面采集');
    fireEvent.click(screen.getByRole('button', { name: '定时任务' }));
    expect(screen.queryByRole('button', { name: '查看 页面采集' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '全部任务' }));
    expect(screen.getAllByRole('button', { name: /^查看 / })).toHaveLength(2);
  });

  it('renders model / agent / team executors and binds browser collection to that executor', async () => {
    setup({}, [
      scheduled,
      { ...browserTask, target: { kind: 'agent', agentId: agent.id } },
      {
        ...scheduled,
        id: 'team-task',
        name: '小队任务',
        target: { kind: 'team', teamId: team.id },
      },
    ]);
    panel();
    await screen.findByRole('button', { name: '查看 页面采集' });
    expect(screen.getByRole('button', { name: '查看 资料整理' }).textContent).toContain(
      '直接模型 · 工作模型',
    );
    expect(screen.getByRole('button', { name: '查看 页面采集' }).textContent).toContain(
      '智能体 · 研究助手',
    );
    expect(screen.getByRole('button', { name: '查看 小队任务' }).textContent).toContain(
      '小队 · 研究小队',
    );
  });

  it('shows the configured chain, acceptance, registry names and only actual history', async () => {
    const api = setup();
    panel();
    await selectBrowser();
    const detail = screen.getByTestId('automation-detail');
    expect(within(detail).getByLabelText('采集→整理→产物→交付')).toBeTruthy();
    expect(detail.textContent).toContain(browserTask.automation?.acceptance);
    expect(detail.textContent).toContain(profile.name);
    expect(detail.textContent).toContain(workflow.name);
    expect(await screen.findByText('browser-1 的真实执行摘要')).toBeTruthy();
    expect(api.scheduledTaskHistory).toHaveBeenCalledWith({ taskId: browserTask.id, limit: 20 });
    expect(screen.queryByText(/成功率/)).toBeNull();
  });

  it('publishes a stored draft with enabled:true and allows disabling it again', async () => {
    const api = setup();
    panel();
    await selectBrowser();
    fireEvent.click(screen.getByRole('button', { name: '发布' }));
    await waitFor(() =>
      expect(api.updateScheduledTask).toHaveBeenCalledWith({
        taskId: browserTask.id,
        patch: { enabled: true },
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: '停用任务' }));
    await waitFor(() =>
      expect(api.updateScheduledTask).toHaveBeenCalledWith({
        taskId: browserTask.id,
        patch: { enabled: false },
      }),
    );
  });

  it('supports repeated task triggers and reloads the selected task history each time', async () => {
    const api = setup();
    panel();
    await selectBrowser();
    const initialHistoryCalls = api.scheduledTaskHistory.mock.calls.filter(
      ([payload]) => payload.taskId === browserTask.id,
    ).length;
    fireEvent.click(screen.getByRole('button', { name: '立即测试' }));
    await waitFor(() => expect(api.triggerScheduledTask).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '立即测试' }).hasAttribute('disabled')).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: '立即测试' }));
    await waitFor(() => expect(api.triggerScheduledTask).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        api.scheduledTaskHistory.mock.calls.filter(([payload]) => payload.taskId === browserTask.id)
          .length,
      ).toBeGreaterThanOrEqual(initialHistoryCalls + 2),
    );
    expect(api.triggerScheduledTask).toHaveBeenLastCalledWith({ taskId: browserTask.id });
    expect(api.updateScheduledTask).not.toHaveBeenCalled();
  });

  it('keeps an unfired test reason visible instead of showing success', async () => {
    setup({ triggerScheduledTask: vi.fn(async () => ({ fired: false, reason: 'run_busy' })) });
    panel();
    await selectBrowser();
    fireEvent.click(screen.getByRole('button', { name: '立即测试' }));
    expect((await screen.findByRole('alert')).textContent).toContain('run_busy');
  });

  it('blocks test and publication for missing profiles / workflows / MCP without claiming connectivity', async () => {
    const api = setup({
      listBrowserProfiles: vi.fn(async () => ({ profiles: [] })),
      listMcpServers: vi.fn(async () => ({ servers: [] })),
    });
    panel();
    fireEvent.click(await screen.findByRole('button', { name: '查看 页面采集' }));
    await screen.findByText('browser-1 的真实执行摘要');
    expect(screen.getByRole('button', { name: '发布' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '立即测试' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('automation-detail').textContent).toContain('待配置');
    expect(api.triggerScheduledTask).not.toHaveBeenCalled();
  });

  it('shows empty state and does not invent a task or history', async () => {
    setup({}, []);
    panel();
    expect((await screen.findByTestId('task-empty')).textContent).toContain('还没有自动化任务');
    expect(screen.queryByTestId('automation-history')).toBeNull();
    expect(screen.queryByTestId('automation-detail')).toBeNull();
  });

  it('shows loading and retries the actual failed task list request', async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce(new Error('RPC 暂不可用'))
      .mockResolvedValue({ tasks: [scheduled] });
    setup({ listScheduledTasks: list });
    panel();
    expect(screen.getByRole('status').textContent).toContain('加载任务');
    expect((await screen.findByRole('alert')).textContent).toContain('RPC 暂不可用');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('button', { name: '查看 资料整理' })).toBeTruthy();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('offers retry for actual history errors and shows cancelled status correctly', async () => {
    const history = vi
      .fn()
      .mockRejectedValueOnce(new Error('历史读取错误'))
      .mockResolvedValue({
        entries: [
          {
            id: 'cancel-history',
            taskId: scheduled.id,
            status: 'cancelled',
            firedAt: profile.updatedAt,
            reason: '用户取消',
          },
        ],
      });
    setup({ scheduledTaskHistory: history }, [scheduled]);
    panel();
    expect((await screen.findByRole('alert')).textContent).toContain('历史读取错误');
    fireEvent.click(screen.getByRole('button', { name: '重试历史' }));
    expect(await screen.findByText('已取消')).toBeTruthy();
    expect(screen.getByText('用户取消')).toBeTruthy();
  });

  it('never leaks stale history when switching selected tasks during an in-flight request', async () => {
    let resolveOld: (value: {
      entries: Array<{
        id: string;
        taskId: string;
        status: 'success';
        firedAt: string;
        summary: string;
      }>;
    }) => void = () => {};
    setup({
      scheduledTaskHistory: vi.fn(({ taskId }: { taskId: string }) =>
        taskId === scheduled.id
          ? new Promise((resolve) => {
              resolveOld = resolve;
            })
          : Promise.resolve({
              entries: [
                {
                  id: 'new-history',
                  taskId,
                  status: 'success',
                  firedAt: profile.updatedAt,
                  summary: '当前选中任务结果',
                },
              ],
            }),
      ),
    });
    panel();
    await selectBrowser();
    expect(await screen.findByText('当前选中任务结果')).toBeTruthy();
    resolveOld({
      entries: [
        {
          id: 'old-history',
          taskId: scheduled.id,
          status: 'success',
          firedAt: profile.updatedAt,
          summary: '旧任务过期结果',
        },
      ],
    });
    await waitFor(() => expect(screen.queryByText('旧任务过期结果')).toBeNull());
  });

  it('creates a disabled draft with the exact browser / outputs / MCP / Gmail / acceptance contract', async () => {
    const api = setup();
    panel();
    await screen.findByRole('button', { name: '查看 资料整理' });
    newTask();
    await waitFor(() =>
      expect(screen.getByLabelText('浏览器 Profile').hasAttribute('disabled')).toBe(false),
    );
    if (screen.queryByRole('button', { name: /能力与交付/ })) fireEvent.click(screen.getByRole('button', { name: /能力与交付/ }));
    changeTaskControl(screen.getByLabelText('浏览器 Profile'), { target: { value: profile.id } });
    changeTaskControl(screen.getByLabelText('已发布浏览器流程'), { target: { value: workflow.id } });
    expect(screen.queryByRole('menuitemradio', { name: '未发布流程' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '添加流程变量' }));
    changeTaskControl(screen.getByLabelText('变量 1 名称'), { target: { value: 'query' } });
    changeTaskControl(screen.getByLabelText('变量 1 值'), { target: { value: '设计趋势' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Gmail 已登记工具/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: '表格' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '演示文稿 / PPT' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '通过 Gmail 交付' }));
    changeTaskControl(screen.getByLabelText('Gmail MCP'), { target: { value: gmail.mcpServerId } });
    changeTaskControl(screen.getByLabelText('Gmail 发件工具'), {
      target: { value: 'gmail_send_message' },
    });
    changeTaskControl(screen.getByLabelText('收件人'), { target: { value: 'reader@example.com' } });
    if (screen.queryByRole('button', { name: /验收与权限/ })) fireEvent.click(screen.getByRole('button', { name: /验收与权限/ }));
    changeTaskControl(screen.getByLabelText('执行验收说明'), {
      target: { value: '采集→整理→产物→交付，核对两个文件及发送回执' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建任务' }));
    await waitFor(() =>
      expect(api.createScheduledTask).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: false,
          name: '新采集任务',
          target: { kind: 'agent', agentId: agent.id },
          automation: {
            executionMode: 'workspace',
            browser: {
              profileId: profile.id,
              workflowTaskId: workflow.id,
              variables: { query: '设计趋势' },
            },
            requiredMcpServerIds: [gmail.mcpServerId],
            outputs: ['spreadsheet', 'presentation'],
            delivery: {
              kind: 'gmail',
              mcpServerId: gmail.mcpServerId,
              toolName: 'gmail_send_message',
              recipient: 'reader@example.com',
            },
            acceptance: '采集→整理→产物→交付，核对两个文件及发送回执',
          },
        }),
      ),
    );
  });

  it.each(['ask', 'workspace', 'full-access'] as const)(
    'serializes %s permission only in the newly created disabled task contract',
    async (mode) => {
      const api = setup();
      panel();
      await screen.findByRole('button', { name: '查看 资料整理' });
      newTask();
      changeTaskControl(screen.getByLabelText('执行权限'), { target: { value: mode } });
      fireEvent.click(screen.getByRole('button', { name: '创建任务' }));
      await waitFor(() =>
        expect(api.createScheduledTask).toHaveBeenCalledWith(
          expect.objectContaining({ enabled: false, automation: { executionMode: mode } }),
        ),
      );
      expect(api.updateScheduledTask).not.toHaveBeenCalled();
    },
  );

  it('updates bindings without silently publishing the task or altering its executor/rule', async () => {
    const api = setup();
    panel();
    await selectBrowser();
    fireEvent.click(screen.getByRole('button', { name: '编辑选中任务' }));
    changeTaskControl(screen.getByLabelText('执行验收说明'), {
      target: { value: '核对表格与交付回执' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() =>
      expect(api.updateScheduledTask).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: browserTask.id,
          patch: expect.objectContaining({
            target: browserTask.target,
            rule: browserTask.rule,
            automation: { ...browserTask.automation, acceptance: '核对表格与交付回执' },
          }),
        }),
      ),
    );
    const patch = api.updateScheduledTask.mock.calls[0]?.[0].patch;
    expect(patch).not.toHaveProperty('enabled');
  });

  it('surfaces partial registry errors while retaining other actual configuration lists', async () => {
    setup({
      listMcpServers: vi.fn(async () => {
        throw new Error('MCP 列表错误');
      }),
    });
    panel();
    await screen.findByRole('button', { name: '查看 资料整理' });
    newTask();
    fireEvent.click(screen.getByRole('button', { name: /能力与交付/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('MCP 列表错误');
    expect(taskOption(profile.name, '浏览器 Profile')).toBeTruthy();
  });

  it('validates incomplete Gmail delivery before create RPC', async () => {
    const api = setup();
    panel();
    await screen.findByRole('button', { name: '查看 资料整理' });
    newTask();
    fireEvent.click(screen.getByRole('button', { name: /能力与交付/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: '通过 Gmail 交付' }));
    fireEvent.click(screen.getByRole('button', { name: '创建任务' }));
    expect((await screen.findByRole('alert')).textContent).toContain('有效收件人');
    expect(api.createScheduledTask).not.toHaveBeenCalled();
  });

  it('requires an explicit selected tool even when the server has one compatible send tool and a recipient', async () => {
    const withoutTool = {
      ...browserTask,
      automation: {
        ...browserTask.automation,
        delivery: {
          kind: 'gmail' as const,
          mcpServerId: gmail.mcpServerId,
          recipient: 'reader@example.com',
        },
      },
    };
    const api = setup({}, [withoutTool]);
    panel();
    await screen.findByRole('button', { name: '查看 页面采集' });
    await screen.findByText('browser-1 的真实执行摘要');
    expect(screen.getByRole('button', { name: '发布' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '立即测试' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('automation-detail').textContent).toContain(
      'Gmail 发件工具待明确选择',
    );
    fireEvent.click(screen.getByRole('button', { name: '编辑选中任务' }));
    expect((screen.getByLabelText('Gmail 发件工具') as HTMLElement).getAttribute('data-value')).toBe('');
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    expect((await screen.findByRole('alert')).textContent).toContain('明确发件工具');
    expect(api.updateScheduledTask).not.toHaveBeenCalled();
  });

  it('updates the exact selected toolName while preserving recipient, connector and disabled draft state', async () => {
    const alternate = { ...gmail.tools[0]!, name: 'send_selected_v2' };
    const api = setup({
      listMcpServers: vi.fn(async () => ({
        servers: [{ ...gmail, tools: [...gmail.tools, alternate] }],
      })),
    });
    panel();
    await selectBrowser();
    expect(screen.getByTestId('automation-detail').textContent).toContain('gmail_send_message');
    fireEvent.click(screen.getByRole('button', { name: '编辑选中任务' }));
    changeTaskControl(screen.getByLabelText('Gmail 发件工具'), {
      target: { value: alternate.name },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() =>
      expect(api.updateScheduledTask).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: browserTask.id,
          patch: expect.objectContaining({
            automation: expect.objectContaining({
              delivery: {
                kind: 'gmail',
                mcpServerId: gmail.mcpServerId,
                toolName: alternate.name,
                recipient: 'reader@example.com',
              },
            }),
          }),
        }),
      ),
    );
    expect(api.updateScheduledTask.mock.calls[0]?.[0].patch).not.toHaveProperty('enabled');
  });

  it('does not silently rebind a removed tool to another live send tool', async () => {
    const removed = {
      ...browserTask,
      automation: {
        ...browserTask.automation,
        delivery: {
          kind: 'gmail' as const,
          mcpServerId: gmail.mcpServerId,
          toolName: 'removed_send',
          recipient: 'reader@example.com',
        },
      },
    };
    setup({}, [removed]);
    panel();
    await screen.findByRole('button', { name: '查看 页面采集' });
    await screen.findByText('browser-1 的真实执行摘要');
    expect(screen.getByRole('button', { name: '发布' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '编辑选中任务' }));
    expect((screen.getByLabelText('Gmail 发件工具') as HTMLElement).getAttribute('data-value')).toBe(
      'removed_send',
    );
    expect(
      taskOption('removed_send · 待配置', 'Gmail 发件工具').hasAttribute('data-disabled'),
    ).toBe(true);
  });

  it('blocks saving an old draft-only tool binding and directs the user to an applicable connector', async () => {
    const draftTool = {
      ...gmail.tools[0]!,
      inputSchemaJson: JSON.stringify({
        type: 'object',
        properties: { draftId: { type: 'string' } },
        required: ['draftId'],
      }),
    };
    const api = setup(
      { listMcpServers: vi.fn(async () => ({ servers: [{ ...gmail, tools: [draftTool] }] })) },
      [browserTask],
    );
    panel();
    await screen.findByRole('button', { name: '查看 页面采集' });
    await screen.findByText('browser-1 的真实执行摘要');
    expect(screen.getByRole('button', { name: '立即测试' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '编辑选中任务' }));
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    expect((await screen.findByRole('alert')).textContent).toContain('draftId');
    expect(screen.getByRole('alert').textContent).toContain('适用 connector');
    expect(api.updateScheduledTask).not.toHaveBeenCalled();
  });

  it('preserves the calendar and returns to the automation center without duplicating its editor', async () => {
    setup();
    panel();
    await screen.findByRole('button', { name: '查看 资料整理' });
    fireEvent.click(screen.getByRole('button', { name: '日历' }));
    expect(screen.getByRole('button', { name: '月' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '自动化中心' })).toBeNull();
    expect(screen.queryByRole('region', { name: '自动化中心' })).toBeNull();
    expect(screen.getAllByTestId('task-create')).toHaveLength(1);
  });
});

describe('Automation binding form', () => {
  it('keeps table, PPT and Gmail examples as prose rather than activating formats or delivery', () => {
    render(<Form initial={{}} />);
    const acceptance = '完成任务并说明结论；表格、PPT 或发到 Gmail 只是示例。';
    fireEvent.change(screen.getByLabelText('执行验收说明'), { target: { value: acceptance } });
    const binding = JSON.parse(screen.getByTestId('binding-value').textContent ?? '{}');
    expect(binding).toEqual({ acceptance });
    for (const label of ['表格', '演示文稿 / PPT', '通过 Gmail 交付']) {
      expect((screen.getByLabelText(label) as HTMLInputElement).checked).toBe(false);
    }
    expect(screen.queryByLabelText('表格最少数据行数')).toBeNull();
    expect(screen.queryByLabelText('PPT 最少页数')).toBeNull();
    expect(screen.getByText('验收以任务目标为准，不限定文件格式，也不要求外部发送。')).toBeTruthy();
    expect(screen.getByText('可选 · 文件格式与数据检查').closest('fieldset')?.hidden).toBe(true);
  });

  it('offers only output-specific optional checks without inventing defaults or turning prose into hard checks', () => {
    render(<Form initial={{ acceptance: '自然语言验收说明' }} />);
    expect(screen.queryByLabelText('表格最少数据行数')).toBeNull();
    expect(screen.queryByLabelText('PPT 最少页数')).toBeNull();
    fireEvent.click(screen.getByLabelText('表格'));
    for (const label of [
      '表格最少数据行数',
      '必需列（逗号分隔）',
      '日期列（按本轮本地日期核对）',
      '来源 URL 列',
    ]) {
      expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe('');
    }
    expect(screen.queryByLabelText('PPT 最少页数')).toBeNull();
    expect(
      JSON.parse(screen.getByTestId('binding-value').textContent ?? '{}').acceptanceChecks,
    ).toBeUndefined();
    expect(screen.getByText(/自然语言说明不属于结构化硬检查/)).toBeTruthy();
    changeTaskControl(screen.getByLabelText('表格最少数据行数'), { target: { value: '12' } });
    changeTaskControl(screen.getByLabelText('必需列（逗号分隔）'), {
      target: { value: ' 标题, 日期，来源链接 ' },
    });
    changeTaskControl(screen.getByLabelText('日期列（按本轮本地日期核对）'), {
      target: { value: ' 日期 ' },
    });
    changeTaskControl(screen.getByLabelText('来源 URL 列'), { target: { value: ' 来源链接 ' } });
    fireEvent.click(screen.getByLabelText('演示文稿 / PPT'));
    expect((screen.getByLabelText('PPT 最少页数') as HTMLInputElement).value).toBe('');
    changeTaskControl(screen.getByLabelText('PPT 最少页数'), { target: { value: '6' } });
    expect(
      JSON.parse(screen.getByTestId('binding-value').textContent ?? '{}').acceptanceChecks,
    ).toEqual({
      minimumRows: 12,
      requiredColumns: ['标题', '日期', '来源链接'],
      dateColumn: '日期',
      sourceUrlColumn: '来源链接',
      minimumSlides: 6,
    });
    expect(screen.getByText(/核对本轮运行的本地日期/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('表格'));
    expect(screen.queryByLabelText('必需列（逗号分隔）')).toBeNull();
    expect(
      JSON.parse(screen.getByTestId('binding-value').textContent ?? '{}').acceptanceChecks,
    ).toEqual({ minimumSlides: 6 });
    fireEvent.click(screen.getByLabelText('演示文稿 / PPT'));
    expect(
      JSON.parse(screen.getByTestId('binding-value').textContent ?? '{}').acceptanceChecks,
    ).toBeUndefined();
    expect(JSON.parse(screen.getByTestId('binding-value').textContent ?? '{}').acceptance).toBe(
      '自然语言验收说明',
    );
  });

  it('defaults permissions to workspace and keeps full-access task-scoped with declared-site and Gmail limits', () => {
    render(<Form initial={{}} />);
    expect((screen.getByLabelText('执行权限') as HTMLElement).getAttribute('data-value')).toBe('workspace');
    changeTaskControl(screen.getByLabelText('执行权限'), { target: { value: 'full-access' } });
    expect(JSON.parse(screen.getByTestId('binding-value').textContent ?? '{}').executionMode).toBe(
      'full-access',
    );
    expect(screen.getByText(/网站审批仅限流程已声明站点/).textContent).not.toContain('Gmail');
    fireEvent.click(screen.getByLabelText('通过 Gmail 交付'));
    expect(screen.getByText(/网站审批仅限流程已声明站点/).textContent).toContain(
      'Gmail 仍仅使用指定连接器',
    );
    expect(screen.getByText(/网站审批仅限流程已声明站点/).textContent).toContain(
      '不修改智能体或全局设置',
    );
    changeTaskControl(screen.getByLabelText('执行权限'), { target: { value: 'ask' } });
    expect(screen.getByText(/无人值守执行可能停在待审批状态/)).toBeTruthy();
  });

  function Form({
    initial,
    inventory = resources,
  }: {
    initial: AutomationBinding;
    inventory?: AutomationResources;
  }) {
    const [value, setValue] = useState(initial);
    return (
      <>
        <AutomationBindings
          value={value}
          onChange={setValue}
          resources={inventory}
          onReload={() => {}}
        />
        <output data-testid="binding-value">{JSON.stringify(value)}</output>
      </>
    );
  }
  it('offers actual registered send tools and leaves selection explicit rather than auto-selecting', () => {
    const draft = {
      name: 'gmail_send_draft',
      description: 'Send an existing draft',
      inputSchemaJson: JSON.stringify({
        type: 'object',
        properties: { draftId: { type: 'string' } },
        required: ['draftId'],
      }),
    };
    const read = {
      name: 'gmail_list_inbox',
      description: 'List inbox',
      readOnly: true,
      inputSchemaJson: JSON.stringify({ type: 'object', properties: {} }),
    };
    render(
      <Form
        initial={{
          delivery: {
            kind: 'gmail',
            mcpServerId: gmail.mcpServerId,
            recipient: 'reader@example.com',
          },
        }}
        inventory={{ ...resources, servers: [{ ...gmail, tools: [...gmail.tools, draft, read] }] }}
      />,
    );
    expect((screen.getByLabelText('Gmail 发件工具') as HTMLElement).getAttribute('data-value')).toBe('');
    expect(taskOption('gmail_send_message', 'Gmail 发件工具')).toBeTruthy();
    expect(
      screen
        .getByRole('menuitemradio', { name: 'gmail_send_draft · 需适用 connector' })
        .hasAttribute('data-disabled'),
    ).toBe(true);
    expect(screen.queryByRole('menuitemradio', { name: 'gmail_list_inbox' })).toBeNull();
    changeTaskControl(screen.getByLabelText('Gmail 发件工具'), {
      target: { value: 'gmail_send_message' },
    });
    expect(JSON.parse(screen.getByTestId('binding-value').textContent ?? '{}').delivery).toEqual({
      kind: 'gmail',
      mcpServerId: gmail.mcpServerId,
      toolName: 'gmail_send_message',
      recipient: 'reader@example.com',
    });
  });

  it('clears toolName on server change even when the second server has an identically named tool', () => {
    const second = { ...gmail, mcpServerId: 'gmail-two', name: 'Gmail secondary' };
    render(
      <Form
        initial={browserTask.automation ?? {}}
        inventory={{ ...resources, servers: [gmail, second] }}
      />,
    );
    changeTaskControl(screen.getByLabelText('Gmail MCP'), { target: { value: second.mcpServerId } });
    const delivery = JSON.parse(screen.getByTestId('binding-value').textContent ?? '{}').delivery;
    expect(delivery.mcpServerId).toBe(second.mcpServerId);
    expect(delivery.recipient).toBe('reader@example.com');
    expect(delivery.toolName).toBeUndefined();
    expect((screen.getByLabelText('Gmail 发件工具') as HTMLElement).getAttribute('data-value')).toBe('');
  });

  it.each([
    [
      'draftId-only',
      JSON.stringify({
        type: 'object',
        properties: { draftId: { type: 'string' } },
        required: ['draftId'],
      }),
    ],
    [
      'native raw',
      JSON.stringify({
        type: 'object',
        properties: { raw: { type: 'string' } },
        required: ['raw'],
      }),
    ],
    [
      'nested recipient',
      JSON.stringify({
        type: 'object',
        properties: { message: { type: 'object', properties: { to: { type: 'string' } } } },
      }),
    ],
    [
      'numeric recipient',
      JSON.stringify({ type: 'object', properties: { to: { type: 'number' } } }),
    ],
    [
      'required draft plus recipient',
      JSON.stringify({
        type: 'object',
        properties: { to: { type: 'string' }, draftId: { type: 'string' } },
        required: ['draftId'],
      }),
    ],
    ['unknown schema', undefined],
    ['malformed schema', '{'],
  ] as const)(
    'marks %s send formats as requiring an applicable connector instead of accepting a send name',
    (_name, schema) => {
      const tool = { ...gmail.tools[0]!, inputSchemaJson: schema };
      render(
        <Form
          initial={browserTask.automation ?? {}}
          inventory={{ ...resources, servers: [{ ...gmail, tools: [tool] }] }}
        />,
      );
      expect(
        taskOption('gmail_send_message · 需适用 connector', 'Gmail 发件工具')
          .hasAttribute('data-disabled'),
      ).toBe(true);
      expect(
        screen.getAllByText(/请先配置支持直属收件人 payload 的适用 connector/).length,
      ).toBeGreaterThan(0);
    },
  );

  it('accepts direct string-array recipients but still stores only the single declared address', () => {
    const tool = {
      ...gmail.tools[0]!,
      name: 'gmail_send_recipients',
      inputSchemaJson: JSON.stringify({
        type: 'object',
        properties: { recipients: { type: 'array', items: { type: 'string' } } },
      }),
    };
    render(
      <Form
        initial={{
          delivery: {
            kind: 'gmail',
            mcpServerId: gmail.mcpServerId,
            recipient: 'reader@example.com',
          },
        }}
        inventory={{ ...resources, servers: [{ ...gmail, tools: [tool] }] }}
      />,
    );
    expect(taskOption(tool.name, 'Gmail 发件工具').hasAttribute('data-disabled')).toBe(false);
    changeTaskControl(screen.getByLabelText('Gmail 发件工具'), { target: { value: tool.name } });
    expect(JSON.parse(screen.getByTestId('binding-value').textContent ?? '{}').delivery).toEqual({
      kind: 'gmail',
      mcpServerId: gmail.mcpServerId,
      toolName: tool.name,
      recipient: 'reader@example.com',
    });
  });

  it('removes a browser binding explicitly and keeps the other capabilities intact', () => {
    render(<Form initial={browserTask.automation ?? {}} />);
    changeTaskControl(screen.getByLabelText('浏览器 Profile'), { target: { value: '' } });
    const value = JSON.parse(screen.getByTestId('binding-value').textContent ?? '{}');
    expect(value.browser).toBeUndefined();
    expect(value.delivery.recipient).toBe('reader@example.com');
    expect(value.outputs).toEqual(['spreadsheet']);
  });
  it('retains and permits removal of an orphan MCP id rather than silently losing stored bindings', () => {
    render(<Form initial={{ requiredMcpServerIds: ['orphan-server'] }} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /orphan-server/ }));
    expect(
      JSON.parse(screen.getByTestId('binding-value').textContent ?? '{}').requiredMcpServerIds,
    ).toEqual([]);
  });
});

describe('Automation calendar fixture normalization', () => {
  it('normalizes automation:null to undefined and preserves an omitted automation patch', async () => {
    const api = createCalendarPreviewRuntime({
      agentId: 'agent-fixture',
      modelId: 'model-fixture',
      teamId: 'team-fixture',
      workspaceId: 'workspace-fixture',
    });
    const { tasks } = await api.listScheduledTasks();
    const taskId = tasks[0]!.id;
    const automation: AutomationBinding = {
      executionMode: 'workspace',
      delivery: {
        kind: 'gmail',
        mcpServerId: gmail.mcpServerId,
        toolName: 'gmail_send_message',
        recipient: 'reader@example.com',
      },
    };
    await api.updateScheduledTask({ taskId, patch: { automation } });
    const preserved = await api.updateScheduledTask({ taskId, patch: { name: 'Renamed fixture' } });
    expect(preserved.task.automation).toEqual(automation);
    const cleared = await api.updateScheduledTask({ taskId, patch: { automation: null } });
    expect(cleared.task.automation).toBeUndefined();
    expect(
      (await api.listScheduledTasks()).tasks.find((task) => task.id === taskId)?.automation,
    ).toBeUndefined();
  });
});

const loginHandoff = (patch: Partial<BrowserHandoffSummary> = {}): BrowserHandoffSummary => ({
  handoffId: 'scheduled-login',
  scheduledTaskId: browserTask.id,
  profileId: profile.id,
  workspaceId: 'login-workspace' as BrowserHandoffSummary['workspaceId'],
  runId: 'login-run' as BrowserHandoffSummary['runId'],
  revision: 1,
  siteOrigin: 'https://example.test',
  reason: 'login',
  requestedOutcome: '确认所选任务账户登录',
  onCancel: 'keep-open',
  status: 'waiting_user',
  canContinue: true,
  canCancel: true,
  createdAt: profile.createdAt,
  updatedAt: profile.updatedAt,
  ...patch,
});

describe('Restored scheduled-task calendar preserves automation capabilities', () => {
  it('opens existing task details and edits the persisted browser/MCP/output/delivery bindings', async () => {
    const api = setup({}, [browserTask]);
    panel('calendar');
    fireEvent.click(await screen.findByRole('button', { name: '页面采集 · 已停用' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑任务' }));
    expect((screen.getByLabelText('任务名称') as HTMLInputElement).value).toBe(browserTask.name);
    fireEvent.click(screen.getByRole('button', { name: /能力与交付/ }));
    expect(screen.getByRole('heading', { name: '自动化能力绑定' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() =>
      expect(api.updateScheduledTask).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: browserTask.id,
          patch: expect.objectContaining({ automation: browserTask.automation }),
        }),
      ),
    );
    expect(api.updateScheduledTask.mock.calls[0]?.[0].patch).not.toHaveProperty('enabled');
  });

  it('keeps login handoffs accessible in the old task sheet and continues the exact task revision', async () => {
    const handoff = loginHandoff();
    let pending = true;
    const api = setup(
      {
        listWaitingBrowserHandoffs: vi.fn(async () => ({
          handoffs: pending
            ? [handoff, loginHandoff({ handoffId: 'foreign', scheduledTaskId: 'other' })]
            : [],
        })),
        continueBrowserHandoff: vi.fn(async () => {
          pending = false;
          return { status: 'continued', handoffId: handoff.handoffId, replayed: false };
        }),
      },
      [browserTask],
    );
    panel('calendar');
    fireEvent.click(await screen.findByRole('button', { name: '页面采集 · 已停用' }));
    expect(await screen.findByTestId('browser-handoff-scheduled-login')).toBeTruthy();
    expect(screen.queryByTestId('browser-handoff-foreign')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '我已完成，继续' }));
    await waitFor(() =>
      expect(api.continueBrowserHandoff).toHaveBeenCalledWith({
        handoffId: handoff.handoffId,
        expectedRevision: 1,
      }),
    );
    await waitFor(() => expect(screen.queryByTestId('browser-handoff-scheduled-login')).toBeNull());
    expect(screen.queryByRole('region', { name: '自动化中心' })).toBeNull();
  });
});

describe('Automation selected-task browser handoffs', () => {
  it.each(['model', 'agent'] as const)(
    'shows durable %s scheduled handoffs and excludes unrelated task/workspace/room records',
    async (kind) => {
      const chosen = {
        ...browserTask,
        workspaceId: 'login-workspace',
        conversationId: 'chosen-room',
        target:
          kind === 'agent' ? { kind: 'agent' as const, agentId: agent.id } : browserTask.target,
      };
      const api = setup(
        {
          listWaitingBrowserHandoffs: vi.fn(async () => ({
            handoffs: [
              loginHandoff(),
              loginHandoff({
                handoffId: 'other-task',
                scheduledTaskId: 'different-task',
                conversationId: chosen.conversationId,
              }),
              loginHandoff({
                handoffId: 'other-workspace',
                workspaceId: 'foreign-workspace' as BrowserHandoffSummary['workspaceId'],
              }),
              loginHandoff({
                handoffId: 'other-room',
                scheduledTaskId: undefined,
                conversationId: 'foreign-room',
              }),
            ],
          })),
        },
        [chosen],
      );
      panel();
      expect(await screen.findByTestId('browser-handoff-scheduled-login')).toBeTruthy();
      expect(screen.queryByTestId('browser-handoff-other-task')).toBeNull();
      expect(screen.queryByTestId('browser-handoff-other-workspace')).toBeNull();
      expect(screen.queryByTestId('browser-handoff-other-room')).toBeNull();
      expect(api.listWaitingBrowserHandoffs).toHaveBeenCalledWith({
        workspaceId: chosen.workspaceId,
      });
      expect(screen.getByRole('region', { name: '所选任务浏览器接管' }).textContent).toContain(
        '定时执行轮次',
      );
      expect(screen.getByRole('region', { name: '所选任务浏览器接管' }).textContent).toContain(
        '原任务尚未完成',
      );
    },
  );

  it('matches a team task group by its conversationId without substituting another group', async () => {
    const chosen = {
      ...browserTask,
      workspaceId: 'login-workspace',
      target: { kind: 'team' as const, teamId: team.id },
      conversationId: 'team-room',
    };
    setup(
      {
        listWaitingBrowserHandoffs: vi.fn(async () => ({
          handoffs: [
            loginHandoff({
              handoffId: 'group-login',
              scheduledTaskId: undefined,
              conversationId: chosen.conversationId,
            }),
            loginHandoff({
              handoffId: 'foreign-group',
              scheduledTaskId: undefined,
              conversationId: 'other-room',
            }),
          ],
        })),
      },
      [chosen],
    );
    panel();
    expect(await screen.findByTestId('browser-handoff-group-login')).toBeTruthy();
    expect(screen.queryByTestId('browser-handoff-foreign-group')).toBeNull();
    expect(screen.getByRole('region', { name: '所选任务浏览器接管' }).textContent).toContain(
      '任务群会话',
    );
  });

  it('continues the exact revision and refreshes task/history instead of declaring login success', async () => {
    let waiting = true;
    const api = setup(
      {
        listWaitingBrowserHandoffs: vi.fn(async () => ({
          handoffs: waiting ? [loginHandoff()] : [],
        })),
        continueBrowserHandoff: vi.fn(async () => {
          waiting = false;
          return {};
        }),
      },
      [browserTask],
    );
    panel();
    const button = await screen.findByRole('button', { name: '我已完成，继续' });
    const taskCalls = api.listScheduledTasks.mock.calls.length;
    const historyCalls = api.scheduledTaskHistory.mock.calls.length;
    fireEvent.click(button);
    await waitFor(() => expect(screen.queryByTestId('browser-handoff-scheduled-login')).toBeNull());
    expect(api.continueBrowserHandoff).toHaveBeenCalledWith({
      handoffId: 'scheduled-login',
      expectedRevision: 1,
    });
    await waitFor(() =>
      expect(api.listScheduledTasks.mock.calls.length).toBeGreaterThan(taskCalls),
    );
    await waitFor(() =>
      expect(api.scheduledTaskHistory.mock.calls.length).toBeGreaterThan(historyCalls),
    );
    expect(api.triggerScheduledTask).not.toHaveBeenCalled();
    expect(screen.queryByText('登录成功')).toBeNull();
  });

  it.each([
    ['keep-open', 'preserve'],
    ['close-page', 'release'],
  ] as const)(
    'cancels %s with the existing lease disposition and refreshes history',
    async (onCancel, leaseDisposition) => {
      let waiting = true;
      const api = setup(
        {
          listWaitingBrowserHandoffs: vi.fn(async () => ({
            handoffs: waiting ? [loginHandoff({ onCancel })] : [],
          })),
          cancelBrowserHandoff: vi.fn(async () => {
            waiting = false;
            return {};
          }),
        },
        [browserTask],
      );
      panel();
      const button = await screen.findByRole('button', {
        name: onCancel === 'close-page' ? '取消并关闭页面' : '取消本次操作',
      });
      const historyCalls = api.scheduledTaskHistory.mock.calls.length;
      fireEvent.click(button);
      await waitFor(() =>
        expect(api.cancelBrowserHandoff).toHaveBeenCalledWith({
          handoffId: 'scheduled-login',
          expectedRevision: 1,
          leaseDisposition,
        }),
      );
      await waitFor(() =>
        expect(screen.queryByTestId('browser-handoff-scheduled-login')).toBeNull(),
      );
      await waitFor(() =>
        expect(api.scheduledTaskHistory.mock.calls.length).toBeGreaterThan(historyCalls),
      );
    },
  );

  it('keeps the real card after an action rejection and permits retry', async () => {
    const proceed = vi.fn().mockRejectedValueOnce(new Error('页面仍待验证')).mockResolvedValue({});
    setup(
      {
        listWaitingBrowserHandoffs: vi.fn(async () => ({ handoffs: [loginHandoff()] })),
        continueBrowserHandoff: proceed,
      },
      [browserTask],
    );
    panel();
    fireEvent.click(await screen.findByRole('button', { name: '我已完成，继续' }));
    expect((await screen.findByRole('alert')).textContent).toContain('页面仍待验证');
    expect(screen.getByTestId('browser-handoff-scheduled-login')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '我已完成，继续' }));
    await waitFor(() => expect(proceed).toHaveBeenCalledTimes(2));
  });

  it('retries a failed durable-handoff query without fabricating a pending card', async () => {
    setup(
      {
        listWaitingBrowserHandoffs: vi
          .fn()
          .mockRejectedValueOnce(new Error('接管查询断开'))
          .mockResolvedValue({ handoffs: [loginHandoff()] }),
      },
      [browserTask],
    );
    panel();
    expect((await screen.findByRole('alert')).textContent).toContain('接管查询断开');
    expect(screen.queryByTestId('browser-handoff-scheduled-login')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试接管状态' }));
    expect(await screen.findByTestId('browser-handoff-scheduled-login')).toBeTruthy();
  });

  it('discards an old selected-task query that resolves after selection changes', async () => {
    let resolveOld: (value: { handoffs: BrowserHandoffSummary[] }) => void = () => {};
    const pending = new Promise<{ handoffs: BrowserHandoffSummary[] }>((resolve) => {
      resolveOld = resolve;
    });
    setup(
      {
        listWaitingBrowserHandoffs: vi
          .fn()
          .mockReturnValueOnce(pending)
          .mockResolvedValue({ handoffs: [] }),
      },
      [browserTask, scheduled],
    );
    panel();
    await screen.findByRole('button', { name: '查看 资料整理' });
    fireEvent.click(screen.getByRole('button', { name: '查看 资料整理' }));
    resolveOld({ handoffs: [loginHandoff()] });
    await waitFor(() =>
      expect(screen.getByTestId('automation-detail').textContent).toContain(scheduled.name),
    );
    expect(screen.queryByTestId('browser-handoff-scheduled-login')).toBeNull();
  });
  it.each(['continue', 'cancel'] as const)(
    'executes a group actor %s through the exact RPC and refreshes task/history',
    async (decision) => {
      const chosen: ScheduledTask = {
        ...browserTask,
        target: { kind: 'team', teamId: team.id },
        conversationId: 'team-room',
      };
      const pending = loginHandoff({
        scheduledTaskId: undefined,
        conversationId: chosen.conversationId,
      });
      let waiting = true;
      const api = setup(
        {
          listWaitingBrowserHandoffs: vi.fn(async () => ({ handoffs: waiting ? [pending] : [] })),
          continueBrowserHandoff: vi.fn(async () => {
            waiting = false;
            return {};
          }),
          cancelBrowserHandoff: vi.fn(async () => {
            waiting = false;
            return {};
          }),
        },
        [chosen],
      );
      panel();
      const button = await screen.findByRole('button', {
        name: decision === 'continue' ? '我已完成，继续' : '取消本次操作',
      });
      const taskCalls = api.listScheduledTasks.mock.calls.length;
      const historyCalls = api.scheduledTaskHistory.mock.calls.length;
      fireEvent.click(button);
      const expected = { handoffId: pending.handoffId, expectedRevision: pending.revision };
      if (decision === 'continue') {
        await waitFor(() => expect(api.continueBrowserHandoff).toHaveBeenCalledWith(expected));
        expect(api.cancelBrowserHandoff).not.toHaveBeenCalled();
      } else {
        await waitFor(() =>
          expect(api.cancelBrowserHandoff).toHaveBeenCalledWith({
            ...expected,
            leaseDisposition: 'preserve',
          }),
        );
        expect(api.continueBrowserHandoff).not.toHaveBeenCalled();
      }
      await waitFor(() =>
        expect(screen.queryByTestId('browser-handoff-scheduled-login')).toBeNull(),
      );
      await waitFor(() =>
        expect(api.listScheduledTasks.mock.calls.length).toBeGreaterThan(taskCalls),
      );
      await waitFor(() =>
        expect(api.scheduledTaskHistory.mock.calls.length).toBeGreaterThan(historyCalls),
      );
      expect(api.triggerScheduledTask).not.toHaveBeenCalled();
      expect(screen.queryByText('登录成功')).toBeNull();
    },
  );
});
