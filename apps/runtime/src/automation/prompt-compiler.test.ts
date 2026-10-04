import { describe, expect, it } from 'vitest';
import { compileAutomationPrompt, prepareAutomationRun } from './index.js';
import type { AutomationReadinessDependencies, AutomationTaskInput } from './index.js';

const task: AutomationTaskInput = {
  id: 'task-1',
  name: 'Evidence task',
  instruction: 'Review current evidence.',
  target: { kind: 'model', modelId: 'model-1' },
  workspaceId: 'workspace-1',
  automation: {
    browser: {
      profileId: 'profile-1',
      workflowTaskId: 'workflow-1',
      variables: { q: 'frozen query' },
    },
    requiredMcpServerIds: ['gmail-1'],
    outputs: ['spreadsheet', 'presentation'],
    delivery: { kind: 'gmail', mcpServerId: 'gmail-1', recipient: 'person@example.com' },
    acceptance: 'Verify three source references and reconcile the totals.',
  },
};
const deps: AutomationReadinessDependencies = {
  firedAt: '2026-10-02T01:00:00.000Z',
  workspaces: [{ id: 'workspace-1', available: true }],
  models: [{ id: 'model-1', available: true }],
  agents: [],
  teams: [],
  browserAvailable: true,
  browserWorkflowReplayAvailable: true,
  browserProfiles: [{ id: 'profile-1', available: true }],
  browserWorkflows: [
    {
      id: 'workflow-1',
      workspaceId: 'workspace-1',
      profileId: 'profile-1',
      enabled: true,
      publishedVersionId: 'version-1',
      publishedVersion: { id: 'version-1', requiredVariables: ['q'] },
    },
  ],
  mcpServers: [
    {
      id: 'gmail-1',
      registered: true,
      connected: true,
      connector: 'gmail',
      tools: [{ name: 'send', available: true, capabilities: ['gmail.send'] }],
    },
  ],
  tools: [
    {
      name: 'automation_export_artifact',
      available: true,
      capabilities: ['spreadsheet', 'presentation'],
    },
  ],
};
function prompt(): string {
  const result = prepareAutomationRun(task, deps);
  if (!result.ready) throw new Error(JSON.stringify(result.issues));
  return result.prompt;
}
describe('Automation prompt compiler public boundary', () => {
  it('returns no runnable prompt for blocked dependencies', () => {
    const result = prepareAutomationRun(task, { ...deps, models: [] });
    expect(result.status).toBe('blocked');
    expect('prompt' in result).toBe(false);
  });
  it('embeds the frozen time, actor, Profile, workflow version and variable values', () => {
    const text = prompt();
    for (const value of [
      '2026-10-02T01:00:00.000Z',
      'model-1',
      'profile-1',
      'version-1',
      'frozen query',
    ])
      expect(text).toContain(value);
    expect(text).toContain('预检后冻结的本轮参数');
  });
  it('uses the exact explicitly bound tools, outputs, recipient and acceptance', () => {
    const text = prompt();
    for (const value of [
      'gmail-1',
      'send',
      'spreadsheet',
      'presentation',
      'automation_export_artifact',
      'person@example.com',
      task.automation!.acceptance!,
    ])
      expect(text).toContain(value);
  });
  it('states replay is not task completion', () =>
    expect(prompt()).toContain('Browserflow 回放完成不等于任务完成'));
  it('requires yielding without repeated login or approval spam', () => {
    expect(prompt()).toContain('waiting_input');
    expect(prompt()).toContain('复用已有登录或审批请求');
    expect(prompt()).toContain('不重复创建');
  });
  it('requires live evidence and a genuine Gmail receipt', () => {
    expect(prompt()).toContain('messageId');
    expect(prompt()).toContain('size、sha256');
    expect(prompt()).toContain('不得伪造发送、邮件 receipt');
  });
  it('separates artifact creation from successful mail delivery', () =>
    expect(prompt()).toContain('有产物而邮件未完成时整体任务仍未完成'));
  it('forbids automatic remote MCP registration and fixture substitution', () => {
    expect(prompt()).toContain('禁止自行注册远程 MCP');
    expect(prompt()).toContain('测试 fixture 不算已生成');
  });
  it('makes no browser or Gmail requirement when neither is configured', () => {
    const result = prepareAutomationRun(
      { ...task, automation: undefined },
      { ...deps, browserAvailable: false, mcpServers: [] },
    );
    if (!result.ready) throw new Error('Expected ready');
    expect(result.prompt).toContain('不强制启动浏览器');
    expect(result.prompt).toContain('不发送邮件');
    expect(result.prompt).not.toContain('【Gmail 交付】');
  });
  it('is deterministic for the same frozen snapshot', () => {
    const result = prepareAutomationRun(task, deps);
    if (!result.ready) throw new Error('Expected ready');
    expect(compileAutomationPrompt(result.snapshot)).toBe(result.prompt);
  });
});

describe('Declared send-tool prompt contract', () => {
  it('freezes and renders the exact toolName for host result matching', () => {
    const result = prepareAutomationRun(
      {
        ...task,
        automation: {
          ...task.automation!,
          delivery: { ...task.automation!.delivery!, toolName: 'send' },
        },
      },
      deps,
    );
    expect(result).toMatchObject({
      ready: true,
      snapshot: { delivery: { toolName: 'send', sendToolNames: ['send'] } },
    });
    if (!result.ready) throw new Error('Expected ready');
    expect(result.prompt).toContain('"toolName": "send"');
    expect(result.prompt).toContain('精确匹配冻结的 toolName');
  });
});


describe('Host-owned attachment transport instructions', () => {
  it('keeps binary attachments out of model context and delegates byte binding to the host', () => {
    const text = prompt();
    expect(text).toContain('宿主自动读取本轮已验证文件并注入真实附件');
    expect(text).toContain('attachments: []');
    expect(text).toContain('attachmentPaths: []');
    expect(text).toContain('不要使用 read_file、run_command 或脚本读取、编码或分块拼接文件的 base64');
  });
  it('does not advertise attachment injection when there is no generated-file requirement', () => {
    const result = prepareAutomationRun(
      { ...task, automation: { ...task.automation!, outputs: [] } },
      deps,
    );
    if (!result.ready) throw new Error('Expected ready');
    expect(result.prompt).not.toContain('宿主自动读取本轮已验证文件并注入真实附件');
  });
});


it('instructs Model/Agent automation to report structured business outcomes rather than treating stop as success', () => {
  const text = prompt();
  expect(text).toContain('automation_report_outcome');
  expect(text).toContain('browser_read');
  expect(text).toContain('最终正文不替代结构化回报');
  expect(text).toContain('automation_request_login');
});
