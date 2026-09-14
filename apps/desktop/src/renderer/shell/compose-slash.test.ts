import { describe, expect, it } from 'vitest';
import {
  BUILTIN_SLASH_COMMANDS,
  detectSlashQuery,
  filterSlashCommands,
  formatCompactElapsed,
  parseSlashCommand,
  parseComposerModeKeywordHint,
  replaceSlashTokenWithCommand,
  withComposerModeKeywordHint,
  withComposerModeCommand,
  withoutComposerModeCommand,
  resolveSendModelId,
  resolveSystemMessageTone,
  stripSlashToken,
} from './compose-slash.js';

describe('detectSlashQuery', () => {
  it('detects / at start and mid-token query', () => {
    expect(detectSlashQuery('/com', 4)).toEqual({
      slashIndex: 0,
      query: 'com',
      caret: 4,
    });
    expect(detectSlashQuery('先 /pl', 5)).toEqual({
      slashIndex: 2,
      query: 'pl',
      caret: 5,
    });
  });

  it('ignores URLs and completed slash tokens with space', () => {
    expect(detectSlashQuery('https://example.com', 19)).toBeNull();
    expect(detectSlashQuery('/compact ', 9)).toBeNull();
  });

  it('opens menu on bare /', () => {
    expect(detectSlashQuery('/', 1)).toEqual({
      slashIndex: 0,
      query: '',
      caret: 1,
    });
  });
});

describe('filterSlashCommands', () => {
  it('matches the NewMax built-in command order and keeps execute hidden', () => {
    expect(BUILTIN_SLASH_COMMANDS.map((command) => command.id)).toEqual([
      'help',
      'plan',
      'goal',
      'compact',
      'mcp',
    ]);
    expect(BUILTIN_SLASH_COMMANDS.map((command) => command.kind)).toEqual([
      'prefix',
      'prefix',
      'prefix',
      'action',
      'panel',
    ]);
  });

  it('returns all commands for empty query', () => {
    expect(filterSlashCommands('')).toHaveLength(BUILTIN_SLASH_COMMANDS.length);
  });

  it('filters by command prefix and Chinese label', () => {
    const byCmd = filterSlashCommands('com');
    expect(byCmd.map((c) => c.id)).toContain('compact');
    const byLabel = filterSlashCommands('压缩');
    expect(byLabel.map((c) => c.id)).toEqual(['compact']);
  });

  it('runs /compact directly from the palette', () => {
    const compact = BUILTIN_SLASH_COMMANDS.find((c) => c.id === 'compact');
    expect(compact?.kind).toBe('action');
    expect(compact?.command).toBe('/compact');
  });
});

describe('stripSlashToken', () => {
  it('removes the active /query so action can run cleanly', () => {
    const slash = detectSlashQuery('/com', 4)!;
    const result = stripSlashToken('/com', slash);
    expect(result.text).toBe('');
    expect(result.caret).toBe(0);
  });
});

describe('replaceSlashTokenWithCommand', () => {
  it('replaces only the active token, preserves trailing text, and places the caret after one space', () => {
    const slash = detectSlashQuery('/pl keep this', 3)!;

    expect(replaceSlashTokenWithCommand('/pl keep this', slash, '/plan')).toEqual({
      text: '/plan keep this',
      caret: 6,
    });
  });

  it('adds a trailing space when the command ends the draft', () => {
    const slash = detectSlashQuery('/pl', 3)!;

    expect(replaceSlashTokenWithCommand('/pl', slash, '/plan')).toEqual({
      text: '/plan ',
      caret: 6,
    });
  });
});

describe('formatCompactElapsed', () => {
  it('formats sub-10s with one decimal and larger as whole seconds', () => {
    expect(formatCompactElapsed(1000, 3500)).toBe('2.5s');
    expect(formatCompactElapsed(1000, 14_000)).toBe('13s');
  });
});

describe('parseSlashCommand', () => {
  it('parses help requests and the MCP status panel command', () => {
    expect(parseSlashCommand('/help')).toEqual({ kind: 'help' });
    expect(parseSlashCommand('/help 如何切换规划模式')).toEqual({
      kind: 'help-with-request',
      request: '如何切换规划模式',
    });
    expect(parseSlashCommand('/mcp')).toEqual({ kind: 'mcp' });
  });

  it('accepts exact /compact only', () => {
    expect(parseSlashCommand('/compact')).toEqual({ kind: 'compact' });
    expect(parseSlashCommand('  /compact  ')).toEqual({ kind: 'compact' });
  });

  it('rejects trailing text and non-command input', () => {
    expect(parseSlashCommand('/compact 然后继续')).toEqual({
      kind: 'compact-with-trailing',
      trailing: '然后继续',
    });
    expect(parseSlashCommand('请先 /compact')).toEqual({ kind: 'none' });
    expect(parseSlashCommand('/unknown-cmd')).toEqual({ kind: 'unknown', command: '/unknown-cmd' });
  });

  it('parses /plan bare, with-request, and /execute', () => {
    expect(parseSlashCommand('/plan')).toEqual({ kind: 'plan' });
    expect(parseSlashCommand('/plan 完善登录功能')).toEqual({
      kind: 'plan-with-request',
      request: '完善登录功能',
    });
    expect(parseSlashCommand('/execute')).toEqual({ kind: 'execute' });
  });

  it('parses /goal with condition, bare, and clear forms', () => {
    expect(parseSlashCommand('/goal 完成所有测试')).toEqual({
      kind: 'goal-with-condition',
      condition: '完成所有测试',
    });
    expect(parseSlashCommand('  /goal  完成所有测试  ')).toEqual({
      kind: 'goal-with-condition',
      condition: '完成所有测试',
    });
    expect(parseSlashCommand('/goal')).toEqual({ kind: 'goal' });
    expect(parseSlashCommand('/goal clear')).toEqual({ kind: 'goal-clear' });
    expect(parseSlashCommand('/goal CLEAR')).toEqual({ kind: 'goal-clear' });
    // Goal only triggers at the start — mid-text /goal is a normal message.
    expect(parseSlashCommand('请 /goal 继续')).toEqual({ kind: 'none' });
  });

  it('only goal mode for /goal — other input stays normal messages', () => {
    expect(parseSlashCommand('继续目标')).toEqual({ kind: 'none' });
    expect(parseSlashCommand('检查目标状态')).toEqual({ kind: 'none' });
    expect(parseSlashCommand('/goals 列表')).toEqual({ kind: 'unknown', command: '/goals' });
  });
});

describe('resolveSystemMessageTone', () => {
  it('prefers explicit tone over text heuristics', () => {
    expect(resolveSystemMessageTone('info', '上下文压缩失败：测试')).toBe('info');
    expect(resolveSystemMessageTone('error', '普通提示')).toBe('error');
  });

  it('only marks narrow failure prefixes as error', () => {
    expect(resolveSystemMessageTone(undefined, '发送失败: boom')).toBe('error');
    expect(resolveSystemMessageTone(undefined, '发送超时。请稍后重试')).toBe('error');
    expect(resolveSystemMessageTone(undefined, '上下文压缩超时：请稍后重试')).toBe('error');
    expect(resolveSystemMessageTone(undefined, '上一轮工具调用失败后已自动恢复，可继续')).toBe(
      'info',
    );
    expect(resolveSystemMessageTone(undefined, '上下文已压缩：折叠 3 条较早消息')).toBe('info');
  });
});

describe('NewMax composer mode prefixes', () => {
  it('switches Plan and Goal without losing the draft body', () => {
    expect(withComposerModeCommand('检查登录流程', 'plan')).toBe('/plan 检查登录流程');
    expect(withComposerModeCommand('/plan 检查登录流程', 'goal')).toBe(
      '/goal 检查登录流程',
    );
    expect(withoutComposerModeCommand('/goal 检查登录流程', 'goal')).toBe('检查登录流程');
  });

  it('detects the first Plan or Goal intent in ordinary text using the NewMax rules', () => {
    expect(parseComposerModeKeywordHint('请先给我一个规划方案')).toEqual({
      kind: 'plan',
      body: '请先给我一个规划方案',
    });
    expect(parseComposerModeKeywordHint('目标：完成输入框重构')).toEqual({
      kind: 'goal',
      body: '完成输入框重构',
    });
    expect(parseComposerModeKeywordHint('planning mode: inspect the project')).toEqual({
      kind: 'plan',
      body: 'mode: inspect the project',
    });
    expect(parseComposerModeKeywordHint('/plan 已经启用')).toBeNull();
    expect(parseComposerModeKeywordHint('普通消息')).toBeNull();
  });

  it('converts a keyword hint into the matching slash mode without losing its body', () => {
    expect(withComposerModeKeywordHint('计划：检查登录流程')).toBe('/plan 检查登录流程');
    expect(withComposerModeKeywordHint('自主执行，直到测试通过')).toBe(
      '/goal 直到测试通过',
    );
    expect(withComposerModeKeywordHint('普通消息')).toBe('普通消息');
  });
});

describe('resolveSendModelId', () => {
  it('uses override first', () => {
    expect(
      resolveSendModelId({
        modelOverride: 'gpt-5.6-sol',
        track: 'agent',
        targetRef: 'agent-1',
        catalogModelIds: ['gpt-5.6-sol'],
      }),
    ).toBe('gpt-5.6-sol');
  });

  it('replaces a stale override with the first currently available model', () => {
    expect(
      resolveSendModelId({
        modelOverride: 'disabled-grok',
        track: 'model',
        targetRef: 'disabled-grok',
        catalogModelIds: ['gpt-5.6-sol', 'gpt-5.6-terra'],
      }),
    ).toBe('gpt-5.6-sol');
  });

  it('sends model-track targetRef only when it is a catalog model', () => {
    expect(
      resolveSendModelId({
        track: 'model',
        targetRef: 'gpt-5.6-sol',
        catalogModelIds: ['gpt-5.6-sol', 'grok-4.5'],
      }),
    ).toBe('gpt-5.6-sol');
    expect(
      resolveSendModelId({
        track: 'model',
        targetRef: 'deleted-model',
        catalogModelIds: ['gpt-5.6-sol'],
      }),
    ).toBeUndefined();
  });

  it('never sends agent/team targetRef as modelId', () => {
    expect(
      resolveSendModelId({
        track: 'agent',
        targetRef: 'agent-123',
        catalogModelIds: ['gpt-5.6-sol', 'agent-123'],
      }),
    ).toBeUndefined();
    expect(
      resolveSendModelId({
        track: 'team',
        targetRef: 'team-9',
        catalogModelIds: ['gpt-5.6-sol'],
      }),
    ).toBeUndefined();
  });
});
