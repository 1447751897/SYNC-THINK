/**
 * 活动摘要与停滞分级：面板头部靠这两个投影回答「现在在做什么」和
 * 「这是卡住了还是还在跑」。
 */
import { describe, expect, it } from 'vitest';
import type { InlineProcessItem } from './ChatView.js';
import {
  activityFingerprint,
  deriveCurrentActivity,
  deriveStallState,
  formatCommandLine,
  formatElapsedZh,
  friendlyToolName,
  toolInputSummary,
  toolStatusOf,
  toolVisualKind,
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
    expect(activity).toMatchObject({ kind: 'thinking', label: '思考中' });
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
    expect(friendlyToolName('mcp.playwright.browser_click')).toBe('Browser Click');
  });

  it('strips the MCP wire prefix so kernel-invoked platform tools keep their label', () => {
    expect(friendlyToolName('mcp__sync-think-platform__read_file')).toBe('读取文件');
    expect(friendlyToolName('mcp__playwright__browser_click')).toBe('Browser Click');
  });

  it('classifies tool rows into stable visual kinds', () => {
    expect(toolVisualKind('read_file')).toBe('read');
    expect(toolVisualKind('apply_patch')).toBe('write');
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

  it('infers status from legacy fields when status is absent', () => {
    expect(toolStatusOf({ ...completedRead, status: undefined } as never)).toBe('completed');
    expect(
      toolStatusOf({ ...runningCommand, status: undefined, failed: true } as never),
    ).toBe('failed');
    expect(
      toolStatusOf({ ...runningCommand, status: undefined, result: undefined } as never),
    ).toBe('running');
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
