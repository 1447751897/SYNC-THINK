import { describe, expect, it } from 'vitest';
import type { ScheduledTask } from '@sync-think/shared';
import { chooseDispatchPath, composeTaskCommand } from './dispatch.js';

function task(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'task-1',
    name: '报告',
    instruction: '生成报告；本消息没有声称已生成或发送',
    target: { kind: 'model', modelId: 'model-1' },
    rule: { kind: 'every', intervalMinutes: 60 },
    timeZone: 'Asia/Shanghai',
    enabled: true,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

describe('scheduled task automation dispatch contract', () => {
  it('carries explicit expected bindings without changing instruction or claiming delivery', () => {
    const automation: NonNullable<ScheduledTask['automation']> = {
      browser: {
        profileId: 'profile-1',
        workflowTaskId: 'workflow-1',
        variables: { query: '公开数据' },
      },
      requiredMcpServerIds: ['reports-mcp'],
      outputs: ['spreadsheet', 'presentation'],
      delivery: { kind: 'gmail', mcpServerId: 'gmail-mcp', recipient: 'reports@example.com' },
      acceptance: '附件有来源与日期',
    };
    const scheduled = task({ automation });
    const command = composeTaskCommand(scheduled);
    expect(command).toEqual({
      taskId: scheduled.id,
      instruction: scheduled.instruction,
      target: scheduled.target,
      skillVersionIds: [],
      workspaceId: undefined,
      automation: { executionMode: 'workspace', ...automation },
    });
    expect(command.automation).not.toBe(automation);
  });
});

const targets: ScheduledTask['target'][] = [
  { kind: 'agent', agentId: 'agent-1' },
  { kind: 'model', modelId: 'model-1' },
  { kind: 'team', teamId: 'team-1' },
];
const configs: Array<ScheduledTask['automation']> = [
  undefined,
  { executionMode: 'ask' },
  { executionMode: 'workspace' },
  { executionMode: 'full-access' },
  { outputs: ['spreadsheet'], requiredMcpServerIds: ['reports-mcp'] },
  { browser: { profileId: 'profile-1' } },
  {
    browser: {
      profileId: 'profile-1',
      workflowTaskId: 'workflow-1',
      variables: { query: '公开数据' },
    },
  },
];
for (const target of targets) {
  describe(target.kind + ' dispatch bindings', () => {
    it.each(configs)('preserves legacy fields with optional automation: %j', (automation) => {
      const scheduled = task({
        target,
        skillVersionIds: ['skill-1'],
        workspaceId: 'workspace-1',
        ...(automation ? { automation } : {}),
      });
      expect(composeTaskCommand(scheduled)).toEqual({
        taskId: scheduled.id,
        instruction: scheduled.instruction,
        target,
        skillVersionIds: ['skill-1'],
        workspaceId: 'workspace-1',
        ...(automation ? { automation: { executionMode: 'workspace', ...automation } } : {}),
      });
    });
  });
}

describe('dispatch validation and compatibility', () => {
  it.each([
    null,
    { browser: { profileId: '' } },
    { browser: { profileId: 'p1', workflowTaskId: ' ' } },
    { browser: { profileId: 'p1', variables: { accessToken: 'fake' } } },
    { browser: { profileId: 'p1', variables: { query: 'x'.repeat(4001) } } },
    {
      browser: {
        profileId: 'p1',
        variables: Object.fromEntries(Array.from({ length: 51 }, (_, i) => ['v' + i, 'x'])),
      },
    },
    { requiredMcpServerIds: [''] },
    { executionMode: 'unrestricted' },
    { outputs: ['pdf'] },
    { delivery: { kind: 'gmail', mcpServerId: 'mcp-1', recipient: 'invalid' } },
    { instructions: 'run browser and send mail' },
  ])('rejects invalid structured settings before dispatch: %j', (automation) => {
    expect(() =>
      composeTaskCommand(
        task({ automation: automation as unknown as NonNullable<ScheduledTask['automation']> }),
      ),
    ).toThrow('scheduledTask.automation_invalid');
  });
  it('leaves instruction-only browser/output/mail requests unstructured and unchanged', () => {
    const instruction =
      'profile-1 打开网站，生成 spreadsheet，再通过 gmail 发到 reports@example.com';
    const command = composeTaskCommand(task({ instruction }));
    expect(command.instruction).toBe(instruction);
    expect(command).not.toHaveProperty('automation');
    expect(command).not.toHaveProperty('outputs');
    expect(command).not.toHaveProperty('delivery');
  });
  it('normalizes and detaches structured values while retaining expected-capability semantics', () => {
    const automation: NonNullable<ScheduledTask['automation']> = {
      browser: { profileId: 'profile-1', variables: { query: 'daily' } },
      outputs: ['spreadsheet', 'spreadsheet'],
      requiredMcpServerIds: ['mcp-1', 'mcp-1'],
    };
    const command = composeTaskCommand(task({ automation }));
    expect(command.automation?.outputs).toEqual(['spreadsheet']);
    expect(command.automation?.requiredMcpServerIds).toEqual(['mcp-1']);
    command.automation!.browser!.variables!.query = 'changed';
    expect(automation.browser?.variables?.query).toBe('daily');
    expect(command).not.toHaveProperty('status');
    expect(command.automation).not.toHaveProperty('delivered');
  });
  it('retains desktop/worker routing independently of optional bindings', () => {
    expect(chooseDispatchPath(true)).toEqual({ kind: 'dispatched' });
    expect(chooseDispatchPath(false)).toEqual({ kind: 'spawn-worker' });
  });
});

it.each(targets)(
  'passes the explicitly selected delivery tool for $kind without inference',
  (target) => {
    const delivery = {
      kind: 'gmail' as const,
      mcpServerId: 'arbitrary-server',
      recipient: 'reports@example.com',
      toolName: 'custom_send_report_v2',
    };
    expect(
      composeTaskCommand(task({ target, automation: { delivery } })).automation?.delivery,
    ).toEqual(delivery);
    const legacy = {
      kind: 'gmail' as const,
      mcpServerId: 'gmail-looking-server',
      recipient: 'reports@example.com',
    };
    expect(
      composeTaskCommand(task({ target, automation: { delivery: legacy } })).automation?.delivery,
    ).not.toHaveProperty('toolName');
  },
);
