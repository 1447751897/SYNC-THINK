/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { BrowserProfileSummary } from '@sync-think/protocol';
import {
  AutomationBindings,
  automationIssues,
  type AutomationBinding,
  type AutomationResources,
} from './AutomationBindings.js';
import { TaskPanel } from './TaskPanel.js';
import { changeTaskControl } from './task-select-test-utils.js';
const profile: BrowserProfileSummary = {
  id: 'work',
  name: '淘宝工作账号',
  revision: 1,
  isDefault: false,
  inUse: false,
  siteCount: 0,
  createdAt: '',
  updatedAt: '',
};
const resources: AutomationResources = {
  profiles: [profile],
  workflows: [],
  servers: [],
  errors: {},
  loading: false,
};
function Form({ initial = {} }: { initial?: AutomationBinding }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <AutomationBindings
        value={value}
        onChange={setValue}
        resources={resources}
        onReload={vi.fn()}
      />
      <output data-testid="binding">{JSON.stringify(value)}</output>
    </>
  );
}
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'syncThink');
});
describe('unified task configuration', () => {
  it('allows a Profile-only task and still blocks a missing explicitly bound workflow', () => {
    expect(automationIssues({ browser: { profileId: 'work' } }, resources)).toEqual([]);
    expect(automationIssues({ browser: { profileId: 'missing' } }, resources)).toContain(
      '浏览器 Profile 待配置',
    );
    expect(
      automationIssues({ browser: { profileId: 'work', workflowTaskId: 'deleted' } }, resources),
    ).toContain('已发布浏览器流程待配置');
  });
  it('shows optional dynamic browser execution, with no workflow variables for a Profile-only binding', () => {
    render(<Form initial={{ browser: { profileId: 'work' } }} />);
    expect(screen.getByRole('combobox', { name: '已发布浏览器流程' }).textContent).toContain(
      '按目标动态执行',
    );
    expect(screen.queryByLabelText('变量 1 名称')).toBeNull();
    expect(screen.queryByText('已发布浏览器流程待配置')).toBeNull();
    expect(document.querySelector('select')).toBeNull();
  });
  it('creates and binds an actual Profile while preserving unrelated outputs and permission', async () => {
    const createBrowserProfile = vi.fn(async () => ({
      profile: { ...profile, id: 'new-account', name: '淘宝账号二' },
    }));
    Object.defineProperty(window, 'syncThink', {
      configurable: true,
      value: { runtime: { createBrowserProfile } },
    });
    render(<Form initial={{ outputs: ['spreadsheet'], executionMode: 'workspace' }} />);
    fireEvent.click(screen.getByRole('button', { name: /新建 Profile/ }));
    fireEvent.change(screen.getByLabelText('Profile 名称'), { target: { value: '淘宝账号二' } });
    fireEvent.click(screen.getByRole('button', { name: '创建并绑定' }));
    await waitFor(() =>
      expect(JSON.parse(screen.getByTestId('binding').textContent!)).toEqual({
        outputs: ['spreadsheet'],
        executionMode: 'workspace',
        browser: { profileId: 'new-account' },
      }),
    );
    expect(createBrowserProfile).toHaveBeenCalledWith({ name: '淘宝账号二' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('combobox', { name: '浏览器 Profile' }).textContent).toContain(
      '淘宝账号二',
    );
  });
  it('returns a failed Profile creation to the same draft with an actionable error', async () => {
    Object.defineProperty(window, 'syncThink', {
      configurable: true,
      value: {
        runtime: {
          createBrowserProfile: vi.fn(async () => {
            throw Error('连接断开');
          }),
        },
      },
    });
    render(<Form initial={{ outputs: ['presentation'] }} />);
    fireEvent.click(screen.getByRole('button', { name: /新建 Profile/ }));
    fireEvent.change(screen.getByLabelText('Profile 名称'), { target: { value: '测试' } });
    fireEvent.click(screen.getByRole('button', { name: '创建并绑定' }));
    expect((await screen.findByRole('alert')).textContent).toContain('连接断开');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(JSON.parse(screen.getByTestId('binding').textContent!)).toEqual({
      outputs: ['presentation'],
    });
  });
  it('drops old workflow parameters when switching to dynamic execution', () => {
    render(
      <Form
        initial={{
          browser: {
            profileId: 'work',
            workflowTaskId: 'old-flow',
            variables: { keyword: '衬衫' },
          },
        }}
      />,
    );
    changeTaskControl(screen.getByLabelText('已发布浏览器流程'), { target: { value: '' } });
    expect(JSON.parse(screen.getByTestId('binding').textContent!).browser).toEqual({
      profileId: 'work',
    });
  });
  it.each(['model', 'agent', 'team'] as const)(
    'preserves the complete draft across steps and saves a %s task without a workspace',
    async (kind) => {
      const createScheduledTask = vi.fn(async (input: unknown) => ({
        task: { ...(input as object), id: 'saved' },
      }));
      Object.defineProperty(window, 'syncThink', {
        configurable: true,
        value: {
          runtime: {
            listScheduledTasks: vi.fn(async () => ({ tasks: [] })),
            listBrowserProfiles: vi.fn(async () => ({ profiles: [profile] })),
            browserWorkflow: { list: vi.fn(async () => ({ tasks: [] })) },
            listMcpServers: vi.fn(async () => ({ servers: [] })),
            createScheduledTask,
            updateScheduledTask: vi.fn(),
          },
        },
      });
      render(
        <TaskPanel
          agents={[{ id: 'agent-a', name: '采集员', enabled: true } as never]}
          teams={[{ id: 'team-a', name: '商品小队' } as never]}
          models={[{ modelId: 'model-a', displayName: '模型 A', providerName: 'provider' }]}
          workspaces={[]}
          skills={[]}
        />,
      );
      fireEvent.click(await screen.findByRole('button', { name: '新建任务' }));
      fireEvent.change(screen.getByLabelText('任务名称'), { target: { value: '每日商品汇总' } });
      fireEvent.change(screen.getByLabelText('执行内容'), {
        target: { value: '查询爆款，去重后输出表格' },
      });
      fireEvent.keyDown(screen.getByRole('button', { name: '执行者类型' }), { key: 'ArrowDown' });
      fireEvent.click(
        screen.getByRole('menuitemradio', {
          name: { model: '直接模型', agent: '智能体', team: '小队' }[kind],
        }),
      );
      fireEvent.click(screen.getByRole('button', { name: /能力与交付/ }));
      await waitFor(() =>
        expect(screen.getByLabelText('浏览器 Profile').hasAttribute('disabled')).toBe(false),
      );
      changeTaskControl(screen.getByLabelText('浏览器 Profile'), { target: { value: 'work' } });
      fireEvent.click(screen.getByLabelText('表格'));
      fireEvent.click(screen.getByRole('button', { name: /验收与权限/ }));
      fireEvent.change(screen.getByLabelText('表格最少数据行数'), { target: { value: '20' } });
      fireEvent.change(screen.getByLabelText('必需列（逗号分隔）'), {
        target: { value: '商品,来源' },
      });
      fireEvent.click(screen.getByRole('button', { name: /目标与执行/ }));
      expect((screen.getByLabelText('任务名称') as HTMLInputElement).value).toBe('每日商品汇总');
      fireEvent.click(screen.getByRole('button', { name: /验收与权限/ }));
      fireEvent.click(screen.getByTestId('task-save'));
      await waitFor(() => expect(createScheduledTask).toHaveBeenCalledOnce());
      expect(createScheduledTask.mock.calls[0]![0]).toMatchObject({
        name: '每日商品汇总',
        enabled: false,
        target: { kind },
        automation: {
          browser: { profileId: 'work' },
          outputs: ['spreadsheet'],
          acceptanceChecks: { minimumRows: 20, requiredColumns: ['商品', '来源'] },
        },
      });
      expect(createScheduledTask.mock.calls[0]![0]).not.toHaveProperty('workspaceId');
    },
  );
});
