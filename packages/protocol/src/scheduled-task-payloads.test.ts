import { describe, expect, it } from 'vitest';
import {
  tryParseCreateScheduledTaskPayload,
  tryParseUpdateScheduledTaskPayload,
  parseScheduledTaskAutomation,
  tryParseScheduledTaskAutomation,
} from './scheduled-task-payloads.js';

const base = {
  name: '每日报告',
  instruction: '根据公开数据生成报告',
  target: { kind: 'agent', agentId: 'agent-1' },
  rule: { kind: 'every', intervalMinutes: 60 },
  timeZone: 'Asia/Shanghai',
};

describe('scheduled task automation payloads', () => {
  it('parses explicit bindings without treating instruction as settings', () => {
    const automation = {
      browser: {
        profileId: 'profile-1',
        workflowTaskId: 'flow-1',
        variables: { query: '公开数据' },
      },
      requiredMcpServerIds: ['sheets-mcp'],
      outputs: ['spreadsheet', 'spreadsheet', 'presentation'],
      delivery: { kind: 'gmail', mcpServerId: 'gmail-mcp', recipient: 'reports@example.com' },
      acceptance: '附件包含来源与日期',
    };
    expect(tryParseCreateScheduledTaskPayload({ ...base, automation })).toEqual({
      ...base,
      automation: {
        ...automation,
        executionMode: 'workspace',
        outputs: ['spreadsheet', 'presentation'],
      },
    });
  });
});

const targets = [
  { kind: 'agent', agentId: 'agent-1' },
  { kind: 'model', modelId: 'model-1' },
  { kind: 'team', teamId: 'team-1' },
] as const;
const configurations = [
  undefined,
  { executionMode: 'ask' },
  { executionMode: 'workspace' },
  { executionMode: 'full-access' },
  { outputs: ['spreadsheet'], requiredMcpServerIds: ['sheets-mcp'] },
  { browser: { profileId: 'profile-1' } },
  {
    browser: {
      profileId: 'profile-1',
      workflowTaskId: 'flow-1',
      variables: { query: '公开数据', empty: '' },
    },
  },
];

for (const target of targets) {
  describe(target.kind + ' create/update contract', () => {
    it.each(configurations)('preserves optional bindings: %j', (automation) => {
      const payload = { ...base, target, ...(automation ? { automation } : {}) };
      const expectedAutomation = automation
        ? { executionMode: 'workspace', ...automation }
        : undefined;
      expect(tryParseCreateScheduledTaskPayload(payload)).toEqual({
        ...payload,
        ...(expectedAutomation ? { automation: expectedAutomation } : {}),
      });
      const patch = automation ? { automation } : { name: '新名称' };
      expect(tryParseUpdateScheduledTaskPayload({ taskId: 'task-1', patch })).toEqual({
        taskId: 'task-1',
        patch: { ...patch, ...(expectedAutomation ? { automation: expectedAutomation } : {}) },
      });
    });
  });
}

const invalidAutomations: Array<[string, unknown]> = [
  ['array', []],
  ['free-form instruction', '打开浏览器并发送邮件'],
  ['unknown instruction field', { instruction: '发送邮件' }],
  ['unknown root field', { profileId: 'profile-1' }],
  ['unknown browser field', { browser: { profileId: 'p1', password: 'value' } }],
  ['browser without profile', { browser: { workflowTaskId: 'flow-1' } }],
  ['blank profile', { browser: { profileId: '  ' } }],
  ['invalid profile type', { browser: { profileId: 1 } }],
  ['empty workflow', { browser: { profileId: 'p1', workflowTaskId: '' } }],
  ['blank MCP id', { requiredMcpServerIds: [' '] }],
  ['MCP ids not an array', { requiredMcpServerIds: 'mcp-1' }],
  ['MCP id not a string', { requiredMcpServerIds: [1] }],
  ['variables not a record', { browser: { profileId: 'p1', variables: [] } }],
  ['variable value not a string', { browser: { profileId: 'p1', variables: { query: 1 } } }],
  ['blank variable name', { browser: { profileId: 'p1', variables: { ' ': 'value' } } }],
  [
    '51 variable names',
    {
      browser: {
        profileId: 'p1',
        variables: Object.fromEntries(Array.from({ length: 51 }, (_, i) => ['v' + i, 'x'])),
      },
    },
  ],
  [
    '4001 character value',
    { browser: { profileId: 'p1', variables: { query: 'x'.repeat(4001) } } },
  ],
  ['unknown output', { outputs: ['pdf'] }],
  ['outputs not an array', { outputs: 'spreadsheet' }],
  [
    'unknown delivery kind',
    { delivery: { kind: 'smtp', mcpServerId: 'mcp', recipient: 'a@example.com' } },
  ],
  ['missing delivery MCP', { delivery: { kind: 'gmail', recipient: 'a@example.com' } }],
  [
    'blank delivery MCP',
    { delivery: { kind: 'gmail', mcpServerId: '', recipient: 'a@example.com' } },
  ],
  ['bad recipient', { delivery: { kind: 'gmail', mcpServerId: 'mcp', recipient: 'not-email' } }],
  [
    'multi recipient',
    { delivery: { kind: 'gmail', mcpServerId: 'mcp', recipient: 'a@example.com,b@example.com' } },
  ],
  [
    'unknown delivery field',
    { delivery: { kind: 'gmail', mcpServerId: 'mcp', recipient: 'a@example.com', sent: true } },
  ],
  ['acceptance object', { acceptance: { done: true } }],
  ...['password', 'Cookie', 'accessToken', 'CLIENT_SECRET'].map((key): [string, unknown] => [
    'sensitive key ' + key,
    { browser: { profileId: 'p1', variables: { [key]: 'test-value' } } },
  ]),
];

describe('automation validation', () => {
  it.each(invalidAutomations)(
    'rejects %s at shared/create/update boundaries',
    (_name, automation) => {
      expect(tryParseScheduledTaskAutomation(automation)).toBeUndefined();
      expect(tryParseCreateScheduledTaskPayload({ ...base, automation })).toBeUndefined();
      expect(
        tryParseUpdateScheduledTaskPayload({ taskId: 'task-1', patch: { automation } }),
      ).toBeUndefined();
    },
  );
  it('allows exactly 50 non-sensitive fields and 4000 characters, detached from input', () => {
    const variables = Object.fromEntries(
      Array.from({ length: 50 }, (_, i) => ['v' + i, 'x'.repeat(4000)]),
    );
    const input = {
      browser: { profileId: 'p1', variables },
      outputs: ['spreadsheet', 'spreadsheet', 'presentation'],
      requiredMcpServerIds: ['mcp-1', 'mcp-1'],
    };
    const parsed = tryParseScheduledTaskAutomation(input)!;
    expect(parsed).toEqual({
      executionMode: 'workspace',
      browser: { profileId: 'p1', variables },
      outputs: ['spreadsheet', 'presentation'],
      requiredMcpServerIds: ['mcp-1'],
    });
    variables.v0 = 'changed';
    expect(parsed.browser?.variables?.v0).toHaveLength(4000);
  });
  it('leaves a free-form request as instruction with no inferred browser/output/email settings', () => {
    const payload = {
      ...base,
      instruction: '使用 profile-1 和 Gmail 发送 spreadsheet 到 reports@example.com',
    };
    expect(tryParseCreateScheduledTaskPayload(payload)).toEqual(payload);
    expect(tryParseCreateScheduledTaskPayload(payload)).not.toHaveProperty('automation');
  });
  it('supports null clearing, empty replacement and omission preservation', () => {
    expect(
      tryParseUpdateScheduledTaskPayload({ taskId: 'task-1', patch: { automation: {} } }),
    ).toEqual({ taskId: 'task-1', patch: { automation: { executionMode: 'workspace' } } });
    expect(
      tryParseUpdateScheduledTaskPayload({ taskId: 'task-1', patch: { automation: null } }),
    ).toEqual({ taskId: 'task-1', patch: { automation: null } });
    expect(tryParseCreateScheduledTaskPayload({ ...base, automation: null })).toBeUndefined();
    expect(parseScheduledTaskAutomation(undefined)).toBeUndefined();
    expect(parseScheduledTaskAutomation(null)).toBeUndefined();
    expect(parseScheduledTaskAutomation({})).toEqual({ executionMode: 'workspace' });
    expect(parseScheduledTaskAutomation).toBe(tryParseScheduledTaskAutomation);
    expect(tryParseCreateScheduledTaskPayload({ ...base, ignored: 'unknown' })).toBeUndefined();
    expect(
      tryParseUpdateScheduledTaskPayload({ taskId: 'task-1', patch: { ignored: true } }),
    ).toBeUndefined();
  });
  it.each([
    [{ kind: 'at', runAt: '2026-11-01T01:30:00-04:00' }, 'America/New_York'],
    [
      {
        kind: 'every',
        intervalMinutes: 60,
        firstRunAt: '2026-10-02T00:00:00Z',
        windowStart: '09:00',
        windowEnd: '18:00',
      },
      'Asia/Shanghai',
    ],
    [
      { kind: 'random', minTimes: 1, maxTimes: 3, windowStart: '09:00', windowEnd: '18:00' },
      'Asia/Tokyo',
    ],
    [
      {
        kind: 'weekly',
        selection: { mode: 'range', start: 5, end: 1 },
        time: '18:30',
        startDate: '2026-11-01',
      },
      'America/Los_Angeles',
    ],
    [{ kind: 'cron', expression: '30 9 * * 1-5' }, 'Europe/London'],
  ])('preserves legacy rule and timezone without coercion: %j %s', (rule, timeZone) => {
    const payload = { ...base, rule, timeZone };
    expect(tryParseCreateScheduledTaskPayload(payload)).toEqual(payload);
    expect(
      tryParseUpdateScheduledTaskPayload({ taskId: 'task-1', patch: { rule, timeZone } }),
    ).toEqual({ taskId: 'task-1', patch: { rule, timeZone } });
  });
});

describe('scheduled task rule boundary', () => {
  it.each([
    { kind: 'every', intervalMinutes: '60' },
    { kind: 'every', intervalMinutes: 4 },
    { kind: 'at', runAt: 123 },
    { kind: 'cron', expression: 123 },
    {
      kind: 'weekly',
      selection: { mode: 'days', days: [0] },
      time: '09:00',
      startDate: '2026-10-02',
    },
    { kind: 'random', minTimes: 3, maxTimes: 1, windowStart: '09:00', windowEnd: '18:00' },
    { kind: 'every', intervalMinutes: 60, browser: { profileId: 'p1' } },
  ])('rejects malformed/unknown structural rule fields: %j', (rule) => {
    expect(tryParseCreateScheduledTaskPayload({ ...base, rule })).toBeUndefined();
    expect(
      tryParseUpdateScheduledTaskPayload({ taskId: 'task-1', patch: { rule } }),
    ).toBeUndefined();
  });
});

it.each([{ requiredMcpServerIds: new Array(1) }, { outputs: new Array(1) }])(
  'rejects sparse arrays rather than normalizing missing entries as valid bindings',
  (automation) => {
    expect(parseScheduledTaskAutomation(automation)).toBeUndefined();
  },
);

describe('task-scoped execution mode', () => {
  it.each(['ask', 'workspace', 'full-access'] as const)(
    'accepts explicitly selected %s only for this automation',
    (executionMode) => {
      const automation = { executionMode, browser: { profileId: 'p1' } };
      expect(parseScheduledTaskAutomation(automation)).toEqual(automation);
      expect(tryParseCreateScheduledTaskPayload({ ...base, automation })?.automation).toEqual(
        automation,
      );
      expect(
        tryParseUpdateScheduledTaskPayload({ taskId: 'task-1', patch: { automation } })?.patch
          .automation,
      ).toEqual(automation);
    },
  );
  it('defaults a present automation to workspace but leaves instruction-only legacy tasks untouched', () => {
    expect(parseScheduledTaskAutomation({})).toEqual({ executionMode: 'workspace' });
    expect(tryParseCreateScheduledTaskPayload(base)).not.toHaveProperty('automation');
  });
  it.each(['danger', '', null, true, 1])(
    'rejects unsupported execution mode %j',
    (executionMode) => {
      expect(parseScheduledTaskAutomation({ executionMode })).toBeUndefined();
    },
  );
});

describe('explicit delivery tool binding', () => {
  it('preserves the selected tool identifier without guessing it from server names', () => {
    const delivery = {
      kind: 'gmail',
      mcpServerId: 'arbitrary-server',
      recipient: 'reports@example.com',
      toolName: 'custom_send_report_v2',
    };
    const automation = { delivery };
    const normalized = { executionMode: 'workspace', delivery };
    expect(parseScheduledTaskAutomation(automation)).toEqual(normalized);
    expect(tryParseCreateScheduledTaskPayload({ ...base, automation })?.automation).toEqual(
      normalized,
    );
    expect(
      tryParseUpdateScheduledTaskPayload({ taskId: 'task-1', patch: { automation } })?.patch
        .automation,
    ).toEqual(normalized);
  });
});

it.each(['', '   ', 'send email', 'send\nemail', null, 42, ['send_email']])(
  'rejects invalid delivery.toolName %j at every protocol boundary',
  (toolName) => {
    const automation = {
      delivery: { kind: 'gmail', mcpServerId: 'mcp-1', recipient: 'reports@example.com', toolName },
    };
    expect(parseScheduledTaskAutomation(automation)).toBeUndefined();
    expect(tryParseCreateScheduledTaskPayload({ ...base, automation })).toBeUndefined();
    expect(
      tryParseUpdateScheduledTaskPayload({ taskId: 'task-1', patch: { automation } }),
    ).toBeUndefined();
  },
);

it('preserves legacy delivery omission and normalizes only a provided exact tool identifier', () => {
  const delivery = {
    kind: 'gmail',
    mcpServerId: 'gmail-looking-name',
    recipient: 'reports@example.com',
  };
  expect(parseScheduledTaskAutomation({ delivery })?.delivery).toEqual(delivery);
  expect(parseScheduledTaskAutomation({ delivery })?.delivery).not.toHaveProperty('toolName');
  expect(
    parseScheduledTaskAutomation({ delivery: { ...delivery, toolName: '  selected.tool_v2  ' } })
      ?.delivery?.toolName,
  ).toBe('selected.tool_v2');
  expect(
    parseScheduledTaskAutomation({ delivery: { ...delivery, toolDisplayName: 'Gmail send' } }),
  ).toBeUndefined();
});
