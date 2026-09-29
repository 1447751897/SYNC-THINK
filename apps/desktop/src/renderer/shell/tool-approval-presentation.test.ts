import { describe, it, expect } from 'vitest';
import { approvalPresentation } from './tool-approval-presentation.js';
const base = {
  approvalId: 'a',
  toolName: 'command_execution',
  title: 'command_execution',
  detail: '',
};
describe('readable tool approval projection', () => {
  it('does not invent a literal path from variables or quoted code', () => {
    for (const command of [
      "Set-Content -LiteralPath $target -Value 'hello'",
      "Write-Output 'Set-Content -LiteralPath D:/fake.txt'",
      'Get-Content -LiteralPath "$env:TEMP/file.txt"',
    ]) {
      expect(approvalPresentation({ ...base, command }).targets).toEqual([]);
    }
  });
  it('preserves distinct paths, spaces and literal dollar characters', () => {
    const command =
      "Set-Content -LiteralPath 'D:/中文目录/first file.txt' -Value '$value'; Get-Item -LiteralPath 'D:/中文目录/first file.txt'; Get-Item -LiteralPath 'D:/$literal/file.txt'";
    expect(approvalPresentation({ ...base, command }).targets).toEqual([
      { label: '涉及路径', value: 'D:/中文目录/first file.txt\nD:/$literal/file.txt' },
    ]);
  });
  it('keeps the exact command and avoids guessing the reason', () => {
    const command = 'git status --short';
    const view = approvalPresentation({ ...base, command, detail: command });
    expect(view.command?.code).toBe(command);
    expect(view.reason).toBeUndefined();
    expect(view.description).toBeUndefined();
    expect(view.title).toBe('执行命令');
  });
  it('uses the kernel reason separately from the action description', () => {
    const view = approvalPresentation({
      ...base,
      reason: '需要连接测试服务',
      arguments: {
        command: 'curl example.com',
        description: '检查服务连接',
        justification: 'older reason',
      },
    });
    expect(view.reason).toBe('需要连接测试服务');
    expect(view.description).toBe('检查服务连接');
  });
  it('does not expose object metadata through a generic detail string', () => {
    const view = approvalPresentation({
      ...base,
      toolName: 'custom_tool',
      title: 'custom_tool',
      detail: '{"startedAtMs":123}',
      arguments: { unknownMetadata: { internal: 'value' }, constructor: 'hidden' },
    });
    expect(view.description).toBeUndefined();
    expect(view.parameters).toEqual([]);
    expect(view.hasDetails).toBe(false);
  });
});
