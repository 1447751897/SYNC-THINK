/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ToolApprovalCard, type PendingToolApproval } from './ToolApprovalCard.js';
afterEach(cleanup);
const request: PendingToolApproval = {
  approvalId: 'approval-a',
  toolName: 'command_execution',
  title: '运行项目测试',
  detail: '验证刚修改的代码',
  command: '"C:/tools/pwsh.exe" -Command "pnpm test"',
  arguments: { cwd: 'D:/private/workspace', processId: 123, source: 'unifiedExecStartup' },
  allowedScopes: ['once', 'session'],
};
function show(overrides: Partial<Parameters<typeof ToolApprovalCard>[0]> = {}) {
  const onApprove = vi.fn(),
    onDeny = vi.fn();
  const props = { approval: request, onApprove, onDeny, ...overrides };
  return { ...render(<ToolApprovalCard {...props} />), props, onApprove, onDeny };
}
describe('Be UI tool approval integration', () => {
  it('keeps parameters closed and only exposes real requested scopes', () => {
    const view = show();
    expect(screen.queryByText('pnpm test')).toBeNull();
    expect(screen.queryByRole('button', { name: '始终允许此应用' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '仅本次允许' }));
    expect(view.onApprove).toHaveBeenCalledWith('once');
    fireEvent.click(screen.getByRole('button', { name: '本会话允许此工具' }));
    expect(view.onApprove).toHaveBeenLastCalledWith('session');
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }));
    expect(view.onDeny).toHaveBeenCalledTimes(1);
  });
  it('previews the actual command without launcher and process metadata', () => {
    const { container } = show();
    const disclosure = screen.getByRole('button', { name: /^查看/ });
    fireEvent.click(disclosure);
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    const details = document.getElementById(disclosure.getAttribute('aria-controls')!)!;
    expect(details.textContent).toContain('pnpm test');
    expect(details.textContent).not.toContain('pwsh.exe');
    expect(details.textContent).not.toContain('private/workspace');
    expect(container.textContent).not.toContain('unifiedExecStartup');
    expect(within(details).getByRole('button', { name: '复制命令' })).toBeTruthy();
  });
  it('renders a proposed replacement as a labelled snippet diff', () => {
    const { container } = show({
      approval: {
        ...request,
        toolName: 'Edit',
        command: undefined,
        path: 'src/count.ts',
        arguments: { old_string: 'export const count = 1;', new_string: 'export const count = 2;' },
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /^查看/ }));
    expect(screen.getByText('拟替换片段')).toBeTruthy();
    expect(container.querySelector('.shell-beui-diff')).toBeTruthy();
    expect(container.textContent).toContain('count = 1');
    expect(container.textContent).toContain('count = 2');
    expect(screen.queryByText('已修改')).toBeNull();
  });
  it.each(['array', 'map'] as const)(
    'previews native Codex %s file changes without transport metadata',
    (shape) => {
      const change = {
        path: 'src/count.ts',
        kind: 'update',
        unifiedDiff: '@@ -1 +1 @@\n-export const count = 1;\n+export const count = 2;',
      };
      const { container } = show({
        approval: {
          ...request,
          toolName: 'file_change',
          command: undefined,
          arguments: {
            threadId: 'transport-thread',
            turnId: 'transport-turn',
            itemId: 'transport-item',
            item: {
              changes:
                shape === 'array' ? [change] : { 'src/count.ts': { ...change, path: undefined } },
            },
          },
        },
      });
      fireEvent.click(screen.getByRole('button', { name: /^查看/ }));
      expect(screen.getByText('拟编辑文件')).toBeTruthy();
      expect(screen.getAllByText('src/count.ts').length).toBeGreaterThan(0);
      expect(container.querySelector('.shell-beui-diff')).toBeTruthy();
      expect(container.textContent).toContain('count = 1');
      expect(container.textContent).toContain('count = 2');
      expect(container.textContent).not.toContain('transport-');
      expect(screen.queryByText('changes')).toBeNull();
    },
  );
  it('shows the screenshot request as a readable summary and hides native protocol fields even when expanded', () => {
    const command =
      "\"C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe\" -Command \"Set-Content -LiteralPath 'D:/temp/codex-approval-probe.txt' -Value 'probe'; Get-Item -LiteralPath 'D:/temp/codex-approval-probe.txt'\"";
    const { container } = show({
      approval: {
        ...request,
        title: 'command_execution',
        detail: command,
        command,
        arguments: {
          kind: 'command',
          startedAtMs: 179049497912,
          environmentId: 'local',
          reason: '需要在项目目录之外写入测试文件。',
          commandActions: [{ type: 'unknown', command }],
          proposedExecpolicyAmendment: ['Set-Content'],
          availableDecisions: ['accept', 'cancel'],
          cwd: 'private-cwd',
          processId: 123,
          source: 'internal-source',
        },
      },
    });
    expect(screen.getByRole('heading', { name: '通过命令写入文件' })).toBeTruthy();
    expect(screen.getByText('申请原因')).toBeTruthy();
    expect(screen.getByText('需要在项目目录之外写入测试文件。')).toBeTruthy();
    expect(screen.getByText('D:/temp/codex-approval-probe.txt')).toBeTruthy();
    expect(container.textContent).not.toContain('powershell.exe');
    expect(container.textContent).not.toContain('command_execution');
    expect(screen.queryByRole('button', { name: '复制命令' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查看命令' }));
    const details = container.querySelector('.shell-beui-approval__details')!;
    expect(details.textContent).toContain('Set-Content');
    expect(details.textContent).toContain('Get-Item');
    for (const value of [
      'startedAtMs',
      '179049497912',
      'environmentId',
      'commandActions',
      'proposedExecpolicyAmendment',
      'availableDecisions',
      'private-cwd',
      'internal-source',
    ])
      expect(container.textContent).not.toContain(value);
    expect(container.querySelector('.shell-beui-approval__parameters')).toBeNull();
    expect(screen.getByRole('button', { name: '本会话允许此工具' }).title).toContain('同一种工具');
  });
  it('localizes business parameters without showing unrelated transport details', () => {
    const { container } = show({
      approval: {
        ...request,
        toolName: 'browser_click',
        title: 'browser_click',
        detail: '需要你的批准',
        command: undefined,
        arguments: {
          url: 'https://example.com/settings',
          selector: '#save',
          environmentId: 'local',
          startedAtMs: 123,
        },
      },
    });
    expect(screen.getByText('目标网址')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '查看操作详情' }));
    expect(screen.getByText('页面元素')).toBeTruthy();
    expect(screen.getByText('#save')).toBeTruthy();
    expect(container.textContent).not.toContain('environmentId');
    expect(container.textContent).not.toContain('browser_click');
  });
  it('shows file targets immediately without mounting a hidden diff', () => {
    const { container } = show({
      approval: {
        ...request,
        toolName: 'Edit',
        title: 'Edit',
        detail: '将修改文件内容',
        command: undefined,
        arguments: {
          file_path: 'src/counter.ts',
          old_string: 'count = 1',
          new_string: 'count = 5',
          replace_all: false,
        },
      },
    });
    expect(screen.getByRole('heading', { name: '编辑文件' })).toBeTruthy();
    expect(screen.getByText('src/counter.ts')).toBeTruthy();
    expect(container.querySelector('.shell-beui-diff')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查看文件变更' }));
    expect(screen.getByText('仅替换一处')).toBeTruthy();
    expect(screen.queryByText('false')).toBeNull();
  });
  it('respects once-only and empty scopes', () => {
    const view = show({ approval: { ...request, allowedScopes: ['once'] } });
    expect(screen.queryByRole('button', { name: '本会话允许此工具' })).toBeNull();
    view.rerender(
      <ToolApprovalCard {...view.props} approval={{ ...request, allowedScopes: [] }} />,
    );
    expect(screen.queryByRole('button', { name: '仅本次允许' })).toBeNull();
    expect(screen.getByRole('button', { name: '拒绝' })).toBeTruthy();
  });
  it('offers persistent permission only for a valid app and a supported scope', () => {
    const view = show({
      approval: {
        ...request,
        toolName: 'mcp__computer-use__computer_click',
        arguments: { app_id: 'Calculator' },
        allowedScopes: ['once', 'always-app'],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: '始终允许此应用' }));
    expect(view.onApprove).toHaveBeenCalledWith('always-app');
    expect(screen.queryByRole('button', { name: '本会话允许此工具' })).toBeNull();
    view.rerender(
      <ToolApprovalCard {...view.props} approval={{ ...view.props.approval, arguments: {} }} />,
    );
    expect(screen.queryByRole('button', { name: '始终允许此应用' })).toBeNull();
  });
  it.each(['approve', 'deny'] as const)(
    'shows real in-flight %s and disables all decisions',
    (decision) => {
      const view = show({ busy: true, submission: { decision, scope: 'once' } });
      expect(screen.getByRole('status').textContent).toBe(
        decision === 'approve' ? '正在提交批准' : '正在提交拒绝',
      );
      expect(screen.queryByText('已批准')).toBeNull();
      for (const button of screen
        .getAllByRole('button')
        .filter((button) => !button.hasAttribute('aria-expanded')))
        expect((button as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: '提交中…' }));
      expect(view.onApprove).not.toHaveBeenCalled();
      expect(view.onDeny).not.toHaveBeenCalled();
    },
  );
  it('keeps the exact failed request retryable instead of pretending approval succeeded', () => {
    const view = show({ error: '运行时连接中断' });
    expect(screen.getByRole('alert').textContent).toContain('运行时连接中断');
    fireEvent.click(screen.getByRole('button', { name: '仅本次允许' }));
    expect(view.onApprove).toHaveBeenCalledWith('once');
  });
  it.each(['approve', 'deny'] as const)(
    'renders an acknowledged %s without actionable permission buttons',
    (decided) => {
      show({ approval: { ...request, decided } });
      expect(screen.getByRole('status').textContent).toBe(
        decided === 'approve' ? '已批准' : '已拒绝',
      );
      expect(screen.queryByRole('button', { name: '仅本次允许' })).toBeNull();
      expect(screen.getByRole('button', { name: /^查看/ })).toBeTruthy();
    },
  );
  it('resets disclosure on the next request and shows the remaining queue count', () => {
    const view = show({ pendingCount: 3 });
    expect(screen.getByText('另有 2 项待处理')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^查看/ }));
    view.rerender(
      <ToolApprovalCard {...view.props} approval={{ ...request, approvalId: 'approval-b' }} />,
    );
    expect(screen.getByRole('button', { name: /^查看/ }).getAttribute('aria-expanded')).toBe(
      'false',
    );
  });
});

describe('editable Skill declarations', () => {
  const approval: PendingToolApproval = { approvalId: 'skill', toolName: 'update_skill', title: '更新 Skill', detail: '版本 1.1.0 · 工具声明：read_file, write_file · 仅解析文本', arguments: { skillMd: '---\nname: example\ndescription: example\nversion: 1.1.0\nallowed-tools: ["read_file", "write_file"]\n---\nBody' }, allowedScopes: ['once'] };
  it('removes a tag without approving and submits the exact exclusion on approval', () => {
    const { onApprove } = show({ approval });
    fireEvent.click(screen.getByRole('button', { name: '移除工具声明 write_file' }));
    expect(onApprove).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '移除工具声明 write_file' })).toBeNull();
    expect(screen.getByRole('button', { name: '移除工具声明 read_file' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '仅本次允许' }));
    expect(onApprove).toHaveBeenCalledWith('once', ['write_file']);
  });
  it('restores declarations and disables removal while submitting', () => {
    const view = show({ approval });
    fireEvent.click(screen.getByRole('button', { name: '移除工具声明 read_file' }));
    fireEvent.click(screen.getByRole('button', { name: '恢复声明' }));
    expect(screen.getByRole('button', { name: '移除工具声明 read_file' })).toBeTruthy();
    view.rerender(<ToolApprovalCard approval={approval} busy onApprove={view.onApprove} onDeny={view.onDeny} />);
    expect((screen.getByRole('button', { name: '移除工具声明 read_file' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('shows an empty declaration and never offers persistent approval for an editable Skill', () => {
    show({ approval: { ...approval, allowedScopes: ['once', 'session'] } });
    fireEvent.click(screen.getByRole('button', { name: '移除工具声明 read_file' }));
    fireEvent.click(screen.getByRole('button', { name: '移除工具声明 write_file' }));
    expect(screen.getByText('未声明工具')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '本会话允许此工具' })).toBeNull();
  });
});
