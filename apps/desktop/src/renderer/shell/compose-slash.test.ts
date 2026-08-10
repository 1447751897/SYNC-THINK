import { describe, expect, it } from 'vitest';
import {
  BUILTIN_SLASH_COMMANDS,
  detectSlashQuery,
  filterSlashCommands,
  formatCompactElapsed,
  parseSlashCommand,
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
  it('returns all commands for empty query', () => {
    expect(filterSlashCommands('')).toHaveLength(BUILTIN_SLASH_COMMANDS.length);
  });

  it('filters by command prefix and Chinese label', () => {
    const byCmd = filterSlashCommands('com');
    expect(byCmd.map((c) => c.id)).toContain('compact');
    const byLabel = filterSlashCommands('压缩');
    expect(byLabel.map((c) => c.id)).toEqual(['compact']);
  });

  it('inserts /compact as a prefix command (execute only on send)', () => {
    const compact = BUILTIN_SLASH_COMMANDS.find((c) => c.id === 'compact');
    expect(compact?.kind).toBe('prefix');
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

describe('formatCompactElapsed', () => {
  it('formats sub-10s with one decimal and larger as whole seconds', () => {
    expect(formatCompactElapsed(1000, 3500)).toBe('2.5s');
    expect(formatCompactElapsed(1000, 14_000)).toBe('13s');
  });
});

describe('parseSlashCommand', () => {
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
    expect(parseSlashCommand('/plan')).toEqual({ kind: 'unknown', command: '/plan' });
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
    expect(resolveSystemMessageTone(undefined, '上下文压缩超时：请稍后重试')).toBe('error');
    expect(
      resolveSystemMessageTone(undefined, '上一轮工具调用失败后已自动恢复，可继续'),
    ).toBe('info');
    expect(resolveSystemMessageTone(undefined, '上下文已压缩：折叠 3 条较早消息')).toBe(
      'info',
    );
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
