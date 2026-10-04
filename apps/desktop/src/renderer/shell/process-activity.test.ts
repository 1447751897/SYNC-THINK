/**
 * 活动摘要与停滞分级：面板头部靠这两个投影回答「现在在做什么」和
 * 「这是卡住了还是还在跑」。
 */
import { describe, expect, it } from 'vitest';
import type { InlineProcessItem } from './ChatView.js';
import {
  activityFingerprint,
  commandArgumentsWithoutDescription,
  commandDisplayFromArguments,
  commandDescriptionFromArguments,
  deriveCurrentActivity,
  deriveStallState,
  formatCommandLine,
  formatCommandSummary,
  formatElapsedZh,
  unwrapShellCommand,
  friendlyToolName,
  summarizeProcessActions,
  groupConsecutiveProcessTools,
  toolInputSummary,
  toolStatusOf,
  toolVisualKind,
  isImageGenerationActivity,
  generatedImageModelsFromProcessItems,
} from './process-activity.js';

const runningCommand: InlineProcessItem = {
  kind: 'tool',
  toolCallId: 'tool-run',
  name: 'run_command',
  argumentsJson: '{"command":"pnpm","args":["-s","test"]}',
  status: 'running',
  startedAt: '2026-08-17T10:00:00.000Z',
};
const completedRead: InlineProcessItem = {
  kind: 'tool',
  toolCallId: 'tool-read',
  name: 'read_file',
  argumentsJson: '{"path":"a.txt"}',
  result: 'ok',
  status: 'completed',
};

describe('deriveCurrentActivity', () => {
  it('returns nothing for a finished run', () => {
    expect(deriveCurrentActivity([runningCommand], { streaming: false })).toBeUndefined();
  });

  it('names the running tool with its key argument', () => {
    const activity = deriveCurrentActivity([completedRead, runningCommand], { streaming: true });
    expect(activity?.kind).toBe('tool');
    expect(activity?.label).toBe('运行命令 pnpm -s test');
    expect(activity?.toolCallId).toBe('tool-run');
    expect(activity?.since).toBe('2026-08-17T10:00:00.000Z');
  });

  it('prefers a running tool even when later commentary already arrived', () => {
    // 工具执行期间模型可能已经吐出后续说明；「在做什么」的答案仍是那个工具。
    const activity = deriveCurrentActivity(
      [runningCommand, { kind: 'commentary', text: '稍后我会汇总', status: 'streaming' }],
      { streaming: true },
    );
    expect(activity?.kind).toBe('tool');
    expect(activity?.toolCallId).toBe('tool-run');
  });

  it('reports thinking while reasoning streams', () => {
    const activity = deriveCurrentActivity(
      [{ kind: 'reasoning', text: '在想', status: 'streaming' }],
      { streaming: true },
    );
    expect(activity).toMatchObject({ kind: 'thinking', label: '正在思考中' });
  });

  it('uses a stable thinking label instead of the latest reasoning line', () => {
    const activity = deriveCurrentActivity(
      [
        {
          kind: 'reasoning',
          text: '**Planning task tool discovery**\nInspecting task plan tool metadata',
          status: 'streaming',
        },
      ],
      { streaming: true },
    );
    expect(activity).toMatchObject({
      kind: 'thinking',
      label: '正在思考中',
    });
  });

  it('keeps a generic thinking label while waiting for the next model step', () => {
    const activity = deriveCurrentActivity(
      [
        completedRead,
        { kind: 'reasoning', text: 'Planning task tool discovery', status: 'completed' },
      ],
      { streaming: true },
    );
    expect(activity).toMatchObject({
      kind: 'thinking',
      label: '正在思考中',
    });
  });

  it.each(['', '中文推理细节', '**Planning**\nCoordinates x=415 and y=805', 'x=464, with a radius of 92.'])('keeps reasoning content out of the activity label: %s', text => {
    expect(deriveCurrentActivity([{ kind: 'reasoning', text, status: 'streaming' }], { streaming: true }))
      .toMatchObject({ kind: 'thinking', label: '正在思考中' });
  });

  it('uses the same generic label when reasoning resumes after a tool completes', () => {
    expect(deriveCurrentActivity([
      { kind: 'reasoning', text: 'Coordinates x=415 and y=805', status: 'completed' }, completedRead,
    ], { streaming: true })).toMatchObject({ kind: 'thinking', label: '正在思考中' });
  });

  it('reports answering while text streams', () => {
    const activity = deriveCurrentActivity([{ kind: 'text', text: '好', status: 'streaming' }], {
      streaming: true,
    });
    expect(activity).toMatchObject({ kind: 'answering', label: '正在回复' });
  });

  it('surfaces the latest run status row', () => {
    const activity = deriveCurrentActivity(
      [{ kind: 'status', statusType: 'retry', label: '正在重新连接 2/3' }],
      { streaming: true },
    );
    expect(activity).toMatchObject({ kind: 'status', label: '正在重新连接 2/3' });
  });

  it('falls back to waiting when the run streams with nothing in flight', () => {
    // 首 token 之前和一轮结束后：以前这个阶段完全没有文案。
    expect(deriveCurrentActivity([], { streaming: true })).toMatchObject({
      kind: 'waiting',
      label: '等待模型响应',
    });
    expect(deriveCurrentActivity([completedRead], { streaming: true })).toMatchObject({
      kind: 'waiting',
    });
  });

  it('truncates a long argument summary but keeps the informative tail', () => {
    const activity = deriveCurrentActivity(
      [
        {
          ...runningCommand,
          argumentsJson: JSON.stringify({
            command: 'pnpm',
            args: ['-s', 'test', '--filter=@sync-think/desktop', '--reporter=verbose'],
          }),
        },
      ],
      { streaming: true },
    );
    // 可执行文件名信息量最低，被截掉的必须是头部而不是尾部。
    expect(activity!.label.startsWith('运行命令 …')).toBe(true);
    expect(activity!.label).toContain('--reporter=verbose');
  });
});

describe('formatCommandLine', () => {
  it('joins the executable with its argv — the only thing that says what is running', () => {
    expect(formatCommandLine('pnpm', ['-s', 'test'])).toBe('pnpm -s test');
  });

  it('quotes arguments containing spaces', () => {
    expect(formatCommandLine('node', ['-e', 'console.log(1)', 'a b'])).toBe(
      'node -e console.log(1) "a b"',
    );
  });

  it('degrades to the bare command when argv is absent or not an array', () => {
    expect(formatCommandLine('pnpm')).toBe('pnpm');
    expect(formatCommandLine('  pnpm  ', 'not-an-array')).toBe('pnpm');
  });

  it('ignores non-string argv entries', () => {
    expect(formatCommandLine('git', ['status', 3, null, '--short'] as never)).toBe(
      'git status --short',
    );
  });
});

describe('commandDisplayFromArguments', () => {
  it.each([
    [
      { command: 'pnpm', args: ['--filter', 'desktop', 'test'], cwd: '/workspace' },
      { code: 'pnpm --filter desktop test', language: 'bash' },
    ],
    [
      { arguments: { cmd: '/bin/bash -lc "git status --short"' } },
      { code: 'git status --short', language: 'bash' },
    ],
    [
      { script: 'Get-Date', shell: 'pwsh' },
      { code: 'Get-Date', language: 'powershell' },
    ],
    [{ command: 'cmd.exe /c "dir /b"' }, { code: 'dir /b', language: 'text' }],
    [
      { command: 'powershell.exe -File task.ps1' },
      { code: 'powershell.exe -File task.ps1', language: 'powershell' },
    ],
  ])('formats a complete command without transport metadata', (args, expected) => {
    expect(commandDisplayFromArguments(JSON.stringify(args))).toEqual(expected);
  });
  it('does not substitute cwd or process identity for a missing script', () => {
    expect(commandDisplayFromArguments('{"cwd":"D:/project","processId":123}')).toBeUndefined();
  });
});

describe('unwrapShellCommand', () => {
  it('drops the Windows PowerShell carrier so the real command is what shows', () => {
    expect(
      unwrapShellCommand(
        '"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command \'git status --short\'',
      ),
    ).toBe('git status --short');
  });

  it('skips PowerShell switches sitting between the shell and -Command', () => {
    expect(
      unwrapShellCommand(
        'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "pnpm -s test"',
      ),
    ).toBe('pnpm -s test');
  });

  it('drops the POSIX login-shell carrier', () => {
    expect(unwrapShellCommand('/bin/bash -lc "pnpm --filter @sync-think/desktop test"')).toBe(
      'pnpm --filter @sync-think/desktop test',
    );
    expect(unwrapShellCommand("sh -c 'ls -la'")).toBe('ls -la');
  });

  it('drops the cmd.exe carrier', () => {
    expect(unwrapShellCommand('cmd.exe /c "dir /b"')).toBe('dir /b');
  });

  it('leaves a command without a carrier untouched', () => {
    expect(unwrapShellCommand('pnpm -s test')).toBe('pnpm -s test');
    expect(unwrapShellCommand('rg packages/shared/src/*.ts')).toBe('rg packages/shared/src/*.ts');
  });

  it('keeps the original text when a shell name appears but carries no payload flag', () => {
    expect(unwrapShellCommand('bash script.sh')).toBe('bash script.sh');
    expect(unwrapShellCommand('cmd.exe /k')).toBe('cmd.exe /k');
  });

  it('unwraps doubled single quotes inside a PowerShell payload', () => {
    expect(unwrapShellCommand("powershell.exe -Command 'Write-Output ''hi'''")).toBe(
      "Write-Output 'hi'",
    );
  });

  it('still truncates a payload that stays too long after unwrapping', () => {
    const summary = formatCommandSummary(`powershell.exe -Command '${'a'.repeat(400)}'`);
    expect(summary.length).toBeLessThanOrEqual(120);
    expect(summary.startsWith('aaa')).toBe(true);
    expect(summary.endsWith('…')).toBe(true);
  });

  it('collapses a multi-line script payload into a single line', () => {
    const summary = formatCommandSummary(
      'powershell.exe -Command "node -e \\"\nconst fs = require(\'fs\');\n  const p = 1;\n\\""',
    );
    expect(summary).not.toContain('\n');
    expect(summary).toContain("const fs = require('fs'); const p = 1;");
  });
});

describe('deriveStallState', () => {
  const base = 1_000_000;

  it('stays active with no activity at all', () => {
    expect(deriveStallState({ lastProgressAt: base, now: base + 600_000 }).level).toBe('active');
  });

  it('is patient with a running tool because long builds are normal', () => {
    const activity = { kind: 'tool' as const, label: '运行命令 pnpm build' };
    expect(deriveStallState({ activity, lastProgressAt: base, now: base + 30_000 }).level).toBe(
      'active',
    );
    expect(deriveStallState({ activity, lastProgressAt: base, now: base + 130_000 }).level).toBe(
      'slow',
    );
    const stalled = deriveStallState({ activity, lastProgressAt: base, now: base + 310_000 });
    expect(stalled.level).toBe('stalled');
    expect(stalled.hint).toBe('长时间无输出');
  });

  it('is strict when nothing is running — that is the suspicious case', () => {
    const activity = { kind: 'waiting' as const, label: '等待模型响应' };
    expect(deriveStallState({ activity, lastProgressAt: base, now: base + 5_000 }).level).toBe(
      'active',
    );
    expect(deriveStallState({ activity, lastProgressAt: base, now: base + 20_000 }).level).toBe(
      'slow',
    );
    expect(deriveStallState({ activity, lastProgressAt: base, now: base + 70_000 }).level).toBe(
      'stalled',
    );
  });

  it('never reports a negative idle window', () => {
    const activity = { kind: 'waiting' as const, label: '等待模型响应' };
    expect(deriveStallState({ activity, lastProgressAt: base, now: base - 5_000 }).idleMs).toBe(0);
  });
});

describe('activityFingerprint', () => {
  it('changes when a running tool reports new progress', () => {
    const before = activityFingerprint([runningCommand]);
    const after = activityFingerprint([
      { ...runningCommand, progressBytes: 2048, progressLine: 'compiling ui-kit' },
    ]);
    expect(after).not.toBe(before);
  });

  it('changes when a tool flips to completed', () => {
    const before = activityFingerprint([runningCommand]);
    const after = activityFingerprint([{ ...runningCommand, status: 'completed', result: 'ok' }]);
    expect(after).not.toBe(before);
  });

  it('changes when streaming text grows', () => {
    const before = activityFingerprint([{ kind: 'text', text: 'ab', status: 'streaming' }]);
    const after = activityFingerprint([{ kind: 'text', text: 'abc', status: 'streaming' }]);
    expect(after).not.toBe(before);
  });

  it('is stable when nothing visible changed', () => {
    expect(activityFingerprint([runningCommand, completedRead])).toBe(
      activityFingerprint([runningCommand, completedRead]),
    );
  });
});

describe('shared tool naming', () => {
  it('maps known tools and humanizes unknown ones', () => {
    expect(friendlyToolName('run_command')).toBe('运行命令');
    expect(friendlyToolName('command_execution')).toBe('命令执行');
    expect(toolVisualKind('command_execution')).toBe('command');
    expect(friendlyToolName('mcp.playwright.browser_click')).toBe('Browser Click');
  });

  it('strips the MCP wire prefix so kernel-invoked platform tools keep their label', () => {
    expect(friendlyToolName('mcp__sync-think-platform__read_file')).toBe('读取文件');
    expect(friendlyToolName('mcp__playwright__browser_click')).toBe('Browser Click');
    expect(friendlyToolName('generate_image')).toBe('生成图片');
    expect(friendlyToolName('mcp__image-generation__generate_image')).toBe('生成图片');
    expect(friendlyToolName('search_capability')).toBe('capability-broker · search capability');
    expect(friendlyToolName('mcp__capability-broker__use_capability')).toBe(
      'capability-broker · use capability',
    );
  });

  it('builds a NewMax imageModelBySrc map from generate_image process results', () => {
    const models = generatedImageModelsFromProcessItems([
      {
        kind: 'tool',
        toolCallId: 'tool-image',
        name: 'generate_image',
        argumentsJson: '{"prompt":"角色卡"}',
        status: 'completed',
        result: ['模型：gpt-image-2', '', '![生成的图片](sync-think-image://generated/a.png)'].join(
          '\n',
        ),
      },
    ]);
    expect(models.get('sync-think-image://generated/a.png')).toBe('gpt-image-2');
  });

  it('treats use_capability with a prompt as image generation', () => {
    expect(
      isImageGenerationActivity({
        name: 'mcp__capability-broker__use_capability',
        argumentsJson: JSON.stringify({ ref: 'cap_1', arguments: { prompt: '湖边小屋' } }),
      }),
    ).toBe(true);
    expect(
      isImageGenerationActivity({
        name: 'mcp__capability-broker__search_capability',
        argumentsJson: JSON.stringify({ query: '图片生成' }),
      }),
    ).toBe(false);
  });

  it('classifies tool rows into stable visual kinds', () => {
    expect(toolVisualKind('read_file')).toBe('read');
    expect(toolVisualKind('apply_patch')).toBe('write');
    expect(toolVisualKind('file_change')).toBe('write');
    expect(toolVisualKind('list_files')).toBe('list');
    expect(toolVisualKind('run_command')).toBe('command');
    expect(toolVisualKind('git_status')).toBe('git');
    expect(toolVisualKind('browser_click')).toBe('browser');
    expect(toolVisualKind('search_query')).toBe('search');
    expect(toolVisualKind('mcp__custom-server__custom_tool')).toBe('mcp');
    expect(toolVisualKind('custom_tool')).toBe('other');
  });

  it('summarizes the key argument', () => {
    expect(toolInputSummary(runningCommand as never)).toBe('pnpm -s test');
  });

  it('reads command intent from provider-specific metadata fields', () => {
    const argumentsJson = JSON.stringify({
      purpose: '检查提交差异',
      command: 'git diff HEAD --stat',
    });
    expect(commandDescriptionFromArguments(argumentsJson)).toBe('检查提交差异');
    expect(commandArgumentsWithoutDescription(argumentsJson)).toBe(
      JSON.stringify({ command: 'git diff HEAD --stat' }),
    );
    expect(toolInputSummary({ kind: 'tool', name: 'run_command', argumentsJson } as never)).toBe(
      'git diff HEAD --stat',
    );
  });

  it('shows the real command instead of the shell install path for a carried command', () => {
    const item = {
      kind: 'tool',
      name: 'command_execution',
      argumentsJson: JSON.stringify({
        command:
          '"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command \'rg --files packages/shared/src\'',
        cwd: 'D:\\projects\\SYNC-THINK',
      }),
    };
    expect(toolInputSummary(item as never)).toBe('rg --files packages/shared/src');
  });

  it('infers status from legacy fields when status is absent', () => {
    expect(toolStatusOf({ ...completedRead, status: undefined } as never)).toBe('completed');
    expect(toolStatusOf({ ...runningCommand, status: undefined, failed: true } as never)).toBe(
      'failed',
    );
    expect(toolStatusOf({ ...runningCommand, status: undefined, result: undefined } as never)).toBe(
      'running',
    );
  });

  it('treats a structured ok:false result as failed even when the transport completed', () => {
    expect(
      toolStatusOf({
        ...completedRead,
        status: 'completed',
        result: JSON.stringify({
          ok: false,
          code: 'browser.command-persist-failed',
          error: 'Browser command idempotency key was reused with different input.',
        }),
      } as never),
    ).toBe('failed');
  });

  it('formats elapsed windows in Chinese units', () => {
    expect(formatElapsedZh(8_000)).toBe('8秒');
    expect(formatElapsedZh(68_000)).toBe('1分8秒');
    expect(formatElapsedZh(3_700_000)).toBe('1小时1分40秒');
    expect(formatElapsedZh(-5)).toBe('0秒');
  });
});

describe('summarizeProcessActions', () => {
  it('omits empty categories and unique-counts explored files', () => {
    expect(
      summarizeProcessActions([
        completedRead,
        { ...completedRead, toolCallId: 'tool-read-2', argumentsJson: '{"path":"b.txt"}' },
        { ...completedRead, toolCallId: 'tool-read-dup', argumentsJson: '{"path":"a.txt"}' },
        runningCommand,
        {
          kind: 'tool',
          toolCallId: 'tool-write',
          name: 'write_file',
          argumentsJson: '{"path":"out.ts"}',
          status: 'completed',
        },
        {
          kind: 'tool',
          toolCallId: 'tool-search',
          name: 'grep',
          argumentsJson: '{"pattern":"InlineProcessFlow"}',
          status: 'completed',
        },
      ]),
    ).toBe('探索了 2 个文件，编辑了 1 个文件，搜索了 1 次');
  });

  it('returns nothing when the timeline has no tools', () => {
    expect(
      summarizeProcessActions([{ kind: 'reasoning', text: '在想', status: 'completed' }]),
    ).toBeUndefined();
  });
});

describe('groupConsecutiveProcessTools', () => {
  it('groups single calls as well as consecutive tool runs', () => {
    const commentary: InlineProcessItem = { kind: 'commentary', text: '先看环境' };
    const thinking: InlineProcessItem = {
      kind: 'reasoning',
      text: '接着检查',
      status: 'completed',
    };
    const blocks = groupConsecutiveProcessTools([
      commentary,
      completedRead,
      { ...completedRead, toolCallId: 'tool-read-2', argumentsJson: '{"path":"b.txt"}' },
      thinking,
      runningCommand,
    ]);

    expect(blocks).toHaveLength(4);
    expect(blocks[0]).toMatchObject({ kind: 'item', item: commentary });
    expect(blocks[1]).toMatchObject({
      kind: 'tools',
      summary: '探索了 2 个文件',
    });
    expect(blocks[2]).toMatchObject({ kind: 'item', item: thinking });
    expect(blocks[3]).toMatchObject({
      kind: 'tools',
      entries: [{ index: 4, item: runningCommand }],
    });
  });

  it('keeps isolated single-call groups in order around narrative, Think and status rows', () => {
    const narrative: InlineProcessItem = { kind: 'commentary', text: '检查现有流程' };
    const thinking: InlineProcessItem = { kind: 'reasoning', text: '检查调度', status: 'completed' };
    const status: InlineProcessItem = {
      kind: 'status', statusType: 'compaction', label: '正在压缩上下文',
    };
    const tools = [completedRead, runningCommand, {
      ...completedRead, toolCallId: 'read-after-status', argumentsJson: '{"path":"b.txt"}',
    }];
    const blocks = groupConsecutiveProcessTools([
      narrative, tools[0], thinking, tools[1], status, tools[2],
    ]);

    expect(blocks.map((block) => block.kind)).toEqual([
      'item', 'tools', 'item', 'tools', 'item', 'tools',
    ]);
    [1, 3, 5].forEach((index, toolIndex) => {
      expect(blocks[index]).toMatchObject({ entries: [{ index, item: tools[toolIndex] }] });
    });
    expect(blocks[1]).toMatchObject({ summary: '探索了 1 个文件' });
  });

  it('keeps the group key stable when a second tool arrives after a single call', () => {
    const single = groupConsecutiveProcessTools([completedRead]);
    const extended = groupConsecutiveProcessTools([completedRead, runningCommand]);

    expect(single[0]).toMatchObject({ kind: 'tools', key: 'tool-run:tool-read' });
    expect(extended[0]).toMatchObject({ kind: 'tools', key: 'tool-run:tool-read' });
  });

  it('splits consecutive runs when a status row sits between tools', () => {
    const status: InlineProcessItem = {
      kind: 'status',
      statusType: 'compaction',
      label: '正在压缩上下文',
    };
    const blocks = groupConsecutiveProcessTools([
      completedRead,
      { ...completedRead, toolCallId: 'tool-read-2', argumentsJson: '{"path":"b.txt"}' },
      status,
      runningCommand,
      { ...runningCommand, toolCallId: 'tool-run-2', status: 'completed', result: 'ok' },
    ]);

    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatchObject({ kind: 'tools', summary: '探索了 2 个文件' });
    expect(blocks[1]).toMatchObject({ kind: 'item', item: status });
    expect(blocks[2]).toMatchObject({ kind: 'tools', summary: '运行了 1 个命令' });
  });
});

describe('approval wait activity', () => {
  it.each([true, false])(
    'prioritizes an actual approval waiter over tool progress (streaming=%s)',
    (streaming) => {
      expect(
        deriveCurrentActivity([runningCommand], { streaming, waitingForApproval: true }),
      ).toEqual({ kind: 'approval', label: '等待你的批准' });
    },
  );

  it('does not classify time waiting for user approval as stalled model output', () => {
    expect(
      deriveStallState({
        activity: { kind: 'approval', label: '等待你的批准' },
        lastProgressAt: 1000,
        now: 601000,
      }),
    ).toEqual({ level: 'active', idleMs: 600000 });
  });
});

it("groups web research separately without reordering intervening file tools or chat",()=>{const search={kind:"tool" as const,name:"web_search",toolCallId:"search",argumentsJson:'{"query":"today"}',status:"completed" as const};const blocks=groupConsecutiveProcessTools([search,{...search,name:"web_fetch",toolCallId:"fetch"},completedRead,{kind:"commentary",text:"continue"}, {...search,name:"open",argumentsJson:'{"path":"story.md"}',toolCallId:"file"},search]);expect(blocks.map(b=>b.kind)).toEqual(["web","tools","item","tools","web"]);expect(blocks[0]).toMatchObject({entries:[{item:{toolCallId:"search"}},{item:{toolCallId:"fetch"}}]});});
