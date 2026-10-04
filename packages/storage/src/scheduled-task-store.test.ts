// 定时任务存储：历史记录（0046 迁移）——add/list/回填 summary/倒序限制。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabaseAsync } from './connection.js';
import { runMigrations } from './scripts/migrate.js';
import { SqliteScheduledTaskStore } from './scheduled-task-store.js';
import type { ScheduledTask, ScheduledTaskAutomation, ScheduledTaskTarget, TaskRule } from '@sync-think/shared';
import { initialNextRunAt } from '@sync-think/shared/task-schedule';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-scheduled-task-store-'));
  tempDirs.push(dir);
  return join(dir, 'sync-think.db');
}

async function openStore() {
  const dbPath = makeDbPath();
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  const store = new SqliteScheduledTaskStore(connection.raw);
  const task: ScheduledTask = store.create({
    id: 'task_1',
    name: '每日巡检',
    instruction: '检查未提交改动',
    target: { kind: 'model', modelId: 'm1' },
    rule: { kind: 'every', intervalMinutes: 60 },
    timeZone: 'UTC',
    enabled: true,
    now: '2026-08-18T00:00:00.000Z',
  });
  return { store, task, dbPath, raw: connection.raw, close: () => connection.raw.close() };
}

describe('SqliteScheduledTaskStore 历史记录', () => {
  it('addHistoryEntry 写入后按 firedAt 倒序返回', async () => {
    const { store, task, close } = await openStore();
    try {
      store.addHistoryEntry({
        id: 'h1',
        taskId: task.id,
        status: 'success',
        firedAt: '2026-08-18T08:00:00.000Z',
        runId: 'r1',
        now: '2026-08-18T08:00:00.000Z',
      });
      store.addHistoryEntry({
        id: 'h2',
        taskId: task.id,
        status: 'failed',
        firedAt: '2026-08-18T09:00:00.000Z',
        reason: '供应商超时',
        now: '2026-08-18T09:00:00.000Z',
      });
      const history = store.listHistory(task.id);
      expect(history).toHaveLength(2);
      // 倒序：h2（09:00）在前
      expect(history[0]).toMatchObject({ id: 'h2', status: 'failed', reason: '供应商超时' });
      expect(history[1]).toMatchObject({ id: 'h1', status: 'success', runId: 'r1' });
    } finally {
      close();
    }
  });

  it('updateHistorySummary 回填摘要并截断到 200 字', async () => {
    const { store, task, close } = await openStore();
    try {
      store.addHistoryEntry({
        id: 'h3',
        taskId: task.id,
        status: 'success',
        firedAt: '2026-08-18T08:00:00.000Z',
        now: '2026-08-18T08:00:00.000Z',
      });
      store.updateHistorySummary('h3', '未发现新的未提交改动，仓库状态正常');
      const [entry] = store.listHistory(task.id);
      expect(entry?.summary).toBe('未发现新的未提交改动，仓库状态正常');

      const longText = '长'.repeat(300);
      store.updateHistorySummary('h3', longText);
      const [updated] = store.listHistory(task.id);
      expect(updated?.summary).toHaveLength(200);
    } finally {
      close();
    }
  });

  it('listHistory 按 limit 限制条数，且不混入其他任务', async () => {
    const { store, task, close } = await openStore();
    try {
      for (let i = 0; i < 5; i += 1) {
        store.addHistoryEntry({
          id: `h${i}`,
          taskId: task.id,
          status: 'success',
          firedAt: `2026-08-18T0${i}:00:00.000Z`,
          now: `2026-08-18T0${i}:00:00.000Z`,
        });
      }
      const other = store.create({
        id: 'task_2',
        name: '其他任务',
        instruction: 'x',
        target: { kind: 'model', modelId: 'm1' },
        rule: { kind: 'every', intervalMinutes: 60 },
        timeZone: 'UTC',
        enabled: true,
        now: '2026-08-18T00:00:00.000Z',
      });
      store.addHistoryEntry({
        id: 'other_h',
        taskId: other.id,
        status: 'success',
        firedAt: '2026-08-18T10:00:00.000Z',
        now: '2026-08-18T10:00:00.000Z',
      });

      const limited = store.listHistory(task.id, 3);
      expect(limited).toHaveLength(3);
      // 最新 3 条：h4, h3, h2
      expect(limited[0]?.id).toBe('h4');
      expect(limited[2]?.id).toBe('h2');

      const all = store.listHistory(task.id, 20);
      expect(all).toHaveLength(5);
      expect(all.some((h) => h.taskId === 'task_2')).toBe(false);
    } finally {
      close();
    }
  });

  it('删除任务不影响历史查询（按 taskId 隔离）', async () => {
    const { store, task, close } = await openStore();
    try {
      store.addHistoryEntry({
        id: 'hx',
        taskId: task.id,
        status: 'skipped',
        firedAt: '2026-08-18T08:00:00.000Z',
        reason: '会话忙',
        now: '2026-08-18T08:00:00.000Z',
      });
      expect(store.delete(task.id)).toBe(true);
      // 历史保留（历史是只读审计数据）
      const history = store.listHistory(task.id);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ status: 'skipped', reason: '会话忙' });
    } finally {
      close();
    }
  });
});

describe('weekly task persistence', () => {
  it('round-trips the complete range and allows switching to specific weekdays', async () => {
    const { store, task, close } = await openStore();
    try {
      const rule: ScheduledTask['rule'] = {
        kind: 'weekly',
        selection: { mode: 'range', start: 5, end: 1 },
        time: '18:30',
        startDate: '2027-01-04',
      };
      store.update(task.id, { rule, timeZone: 'Asia/Shanghai' });
      expect(store.get(task.id)?.rule).toEqual(rule);
      const edited: ScheduledTask['rule'] = { ...rule, selection: { mode: 'days', days: [1, 3] } };
      store.update(task.id, { rule: edited });
      expect(store.list().find((item) => item.id === task.id)?.rule).toEqual(edited);
    } finally {
      close();
    }
  });
});

it('keeps result idempotency after more than a page of later skipped ticks', async () => {
  const { store, task, close } = await openStore();
  try {
    store.addHistoryEntry({
      id: 'completed',
      taskId: task.id,
      status: 'success',
      firedAt: '2026-08-18T08:00:00.000Z',
    });
    for (let i = 1; i <= 110; i++)
      store.addHistoryEntry({
        id: 'skip-' + i,
        taskId: task.id,
        status: 'skipped',
        firedAt: new Date(Date.parse('2026-08-18T08:00:00.000Z') + i * 1000).toISOString(),
      });
    expect(store.listHistory(task.id, 100).some((entry) => entry.id === 'completed')).toBe(false);
    expect(store.hasHistoryResult(task.id, '2026-08-18T08:00:00.000Z', 'success')).toBe(true);
    expect(store.hasHistoryResult(task.id, '2026-08-18T08:00:00.000Z', 'failed')).toBe(false);
  } finally {
    close();
  }
});


describe('scheduled task automation persistence', () => {
  it('round-trips explicit capability bindings independently of the instruction', async () => {
    const { store, close } = await openStore();
    try {
      const automation = {
        browser: { profileId: 'profile-1', workflowTaskId: 'workflow-1', variables: { report: 'daily' } },
        outputs: ['spreadsheet', 'presentation'] as Array<'spreadsheet' | 'presentation'>,
        requiredMcpServerIds: ['reports-mcp'],
        delivery: { kind: 'gmail' as const, mcpServerId: 'gmail-mcp', recipient: 'reports@example.com' },
        acceptance: '检查来源和附件',
      };
      store.create({ id: 'automated', name: '报告', instruction: '生成报告，不代表已发送',
        target: { kind: 'model', modelId: 'model-1' }, rule: { kind: 'every', intervalMinutes: 60 },
        timeZone: 'Asia/Shanghai', enabled: true, automation,
      });
      expect(store.get('automated')?.automation).toEqual({ executionMode: 'workspace', ...automation });
    } finally { close(); }
  });
});


const automationTargets: ScheduledTaskTarget[] = [
  { kind: 'agent', agentId: 'agent-1' },
  { kind: 'model', modelId: 'model-1' },
  { kind: 'team', teamId: 'team-1' },
];

describe('automation save/update target matrix', () => {
  it.each(automationTargets)('preserves legacy tasks and saves/replaces bindings for $kind', async (target) => {
    const { store, close } = await openStore();
    try {
      const input = { id: 'automation-target', name: '任务', instruction: 'browser spreadsheet gmail remain free-form',
        target, rule: { kind: 'every' as const, intervalMinutes: 60 }, timeZone: 'America/New_York',
        enabled: true, workspaceId: 'workspace-1', skillVersionIds: ['skill-1'], nextRunAt: '2026-11-01T06:30:00.000Z' };
      const legacy = store.create(input);
      expect(legacy).not.toHaveProperty('automation');
      const configs: ScheduledTaskAutomation[] = [
        { executionMode: 'ask' },
        { executionMode: 'workspace' },
        { executionMode: 'full-access' },
        { outputs: ['spreadsheet'], requiredMcpServerIds: ['reports-mcp'] },
        { browser: { profileId: 'profile-1' } },
        { browser: { profileId: 'profile-1', workflowTaskId: 'workflow-1', variables: { query: '公开报告' } },
          delivery: { kind: 'gmail', mcpServerId: 'gmail-mcp', recipient: 'reports@example.com' }, acceptance: '核对来源' },
      ];
      for (const [i, automation] of configs.entries()) {
        const created = store.create({ ...input, id: 'create-' + i, automation });
        expect(store.get(created.id)?.automation).toEqual({ executionMode: 'workspace', ...automation });
        expect(store.update(legacy.id, { automation })?.automation).toEqual({ executionMode: 'workspace', ...automation });
        expect(store.get(legacy.id)).toMatchObject({ ...input, automation });
        expect(store.list().find((item) => item.id === legacy.id)?.automation).toEqual({ executionMode: 'workspace', ...automation });
        expect(store.listDue('2026-11-01T06:30:00.000Z').find((item) => item.id === legacy.id)?.automation).toEqual({ executionMode: 'workspace', ...automation });
        expect(store.update(legacy.id, { name: 'edited-' + i })?.automation).toEqual({ executionMode: 'workspace', ...automation });
        // Reset the unrelated name before the next exact input assertion.
        store.update(legacy.id, { name: input.name });
      }
      expect(store.update(legacy.id, { automation: {} })?.automation).toEqual({ executionMode: 'workspace' });
      expect(store.update(legacy.id, { automation: null })).not.toHaveProperty('automation');
      expect(store.get(legacy.id)).not.toHaveProperty('automation');
      expect(store.update(legacy.id, { name: 'after-clear' })).not.toHaveProperty('automation');
      expect(store.get(legacy.id)?.instruction).toBe(input.instruction);
    } finally { close(); }
  });

  it('survives reopening the SQLite file and detaches normalized values from caller mutation', async () => {
    const { store, task, dbPath, close } = await openStore();
    const automation: ScheduledTaskAutomation = { browser: { profileId: 'profile-1', variables: { report: 'daily' } },
      outputs: ['spreadsheet', 'spreadsheet', 'presentation'], requiredMcpServerIds: ['mcp-1', 'mcp-1'] };
    try {
      store.update(task.id, { automation });
      automation.browser!.variables!.report = 'mutated';
    } finally { close(); }
    const reopened = await openDatabaseAsync({ path: dbPath });
    try {
      expect(new SqliteScheduledTaskStore(reopened.raw).get(task.id)?.automation).toEqual({
        executionMode: 'workspace', browser: { profileId: 'profile-1', variables: { report: 'daily' } },
        outputs: ['spreadsheet', 'presentation'], requiredMcpServerIds: ['mcp-1'],
      });
    } finally { reopened.raw.close(); }
  });

  it.each([
    ['password key', { browser: { profileId: 'p1', variables: { PASSWORD: 'fake' } } }],
    ['cookie key', { browser: { profileId: 'p1', variables: { sessionCookie: 'fake' } } }],
    ['token key', { browser: { profileId: 'p1', variables: { access_token: 'fake' } } }],
    ['secret key', { browser: { profileId: 'p1', variables: { secretKey: 'fake' } } }],
    ['too many fields', { browser: { profileId: 'p1', variables: Object.fromEntries(Array.from({ length: 51 }, (_, i) => ['v' + i, 'x'])) } }],
    ['oversized value', { browser: { profileId: 'p1', variables: { query: 'x'.repeat(4001) } } }],
    ['blank profile', { browser: { profileId: ' ' } }],
    ['bad email', { delivery: { kind: 'gmail', mcpServerId: 'mcp-1', recipient: 'invalid' } }],
    ['bad output', { outputs: ['pdf'] }],
    ['bad execution mode', { executionMode: 'unrestricted' }],
    ['unknown structure', { instruction: 'send mail' }],
  ])('rejects invalid %s atomically on create/update', async (_name, invalid) => {
    const { store, task, close } = await openStore();
    try {
      const automation = invalid as unknown as ScheduledTaskAutomation;
      const valid = { outputs: ['spreadsheet'] as const };
      store.update(task.id, { automation: { outputs: [...valid.outputs] } });
      const before = store.get(task.id);
      expect(() => store.update(task.id, { name: 'changed', automation })).toThrow('scheduledTask.automation_invalid');
      expect(store.get(task.id)).toEqual(before);
      expect(() => store.create({ id: 'invalid-task', name: 'invalid', instruction: 'noop',
        target: task.target, rule: task.rule, timeZone: task.timeZone, enabled: true, automation }))
        .toThrow('scheduledTask.automation_invalid');
      expect(store.get('invalid-task')).toBeUndefined();
    } finally { close(); }
  });

  it('rejects invalid persisted bindings instead of silently dispatching an unconstrained task', async () => {
    const { store, task, raw, close } = await openStore();
    try {
      raw.prepare('UPDATE scheduled_task SET automation_json = ?, next_run_at = ? WHERE id = ?')
        .run(JSON.stringify({ browser: { profileId: 'p1', variables: { cookie: 'fake' } } }), '2026-10-02T00:00:00Z', task.id);
      expect(() => store.get(task.id)).toThrow('scheduledTask.automation_invalid');
      expect(() => store.listDue('2026-11-01T06:30:00.000Z')).toThrow('scheduledTask.automation_invalid');
    } finally { close(); }
  });

  const zoneRules: Array<{ rule: TaskRule; timeZone: string; now: string; expected: string }> = [
    { rule: { kind: 'cron', expression: '0 9 * * *' }, timeZone: 'Asia/Shanghai', now: '2026-10-02T00:00:00Z', expected: '2026-10-02T01:00:00.000Z' },
    { rule: { kind: 'cron', expression: '0 9 * * *' }, timeZone: 'America/New_York', now: '2026-10-02T00:00:00Z', expected: '2026-10-02T13:00:00.000Z' },
    { rule: { kind: 'weekly', selection: { mode: 'days', days: [7] }, time: '09:00', startDate: '2026-11-01' },
      timeZone: 'America/New_York', now: '2026-11-01T05:00:00Z', expected: '2026-11-01T14:00:00.000Z' },
    { rule: { kind: 'every', intervalMinutes: 60, windowStart: '09:00', windowEnd: '18:00' },
      timeZone: 'Asia/Shanghai', now: '2026-10-02T00:00:00Z', expected: '2026-10-02T01:00:00.000Z' },
  ];
  it.each(zoneRules)('leaves $timeZone $rule.kind trigger semantics unchanged', async ({ rule, timeZone, now, expected }) => {
    const { store, task, close } = await openStore();
    try {
      const legacy = store.update(task.id, { rule, timeZone })!;
      expect(initialNextRunAt(legacy, new Date(now))).toBe(expected);
      const automated = store.update(task.id, { automation: { browser: { profileId: 'profile-1' } } })!;
      expect(automated.rule).toEqual(rule);
      expect(initialNextRunAt(automated, new Date(now))).toBe(expected);
      expect(store.update(task.id, { enabled: false })?.automation).toEqual(automated.automation);
    } finally { close(); }
  });
});


it('persists automation:null clearing across reopen and never promotes old tasks to workspace mode', async () => {
  const { store, task, dbPath, close } = await openStore();
  try {
    store.update(task.id, { automation: { executionMode: 'full-access', browser: { profileId: 'profile-1' } } });
    expect(store.get(task.id)?.automation?.executionMode).toBe('full-access');
    store.update(task.id, { automation: null });
  } finally { close(); }
  const reopened = await openDatabaseAsync({ path: dbPath });
  try {
    const stored = new SqliteScheduledTaskStore(reopened.raw).get(task.id)!;
    expect(stored).not.toHaveProperty('automation');
    expect(stored).not.toHaveProperty('executionMode');
  } finally { reopened.raw.close(); }
});


describe('explicit delivery tool persistence', () => {
  it.each(automationTargets)('creates and updates the exact chosen tool for $kind without server-name inference', async (target) => {
    const { store, task, close } = await openStore();
    try {
      const delivery = { kind: 'gmail' as const, mcpServerId: 'arbitrary-server', recipient: 'reports@example.com', toolName: 'custom_send_report_v2' };
      const automation = { delivery };
      const created = store.create({ id: 'tool-bound', name: '报告', instruction: 'send using the chosen tool', target,
        rule: task.rule, timeZone: task.timeZone, enabled: true, automation });
      expect(created.automation?.delivery).toEqual(delivery);
      expect(store.get(created.id)?.automation?.delivery).toEqual(delivery);
      const replacement = { ...delivery, toolName: 'selected_mail_dispatcher' };
      expect(store.update(created.id, { automation: { delivery: replacement } })?.automation?.delivery).toEqual(replacement);
      expect(store.update(created.id, { name: 'renamed' })?.automation?.delivery?.toolName).toBe('selected_mail_dispatcher');
      const legacy = { kind: 'gmail' as const, mcpServerId: 'gmail-looking-server', recipient: 'reports@example.com' };
      expect(store.update(created.id, { automation: { delivery: legacy } })?.automation?.delivery).toEqual(legacy);
      expect(store.get(created.id)?.automation?.delivery).not.toHaveProperty('toolName');
    } finally { close(); }
  });

  it('keeps explicit tool bindings across SQLite reopen', async () => {
    const { store, task, dbPath, close } = await openStore();
    const delivery = { kind: 'gmail' as const, mcpServerId: 'connector-1', recipient: 'reports@example.com', toolName: 'exact_tool_identifier' };
    try { store.update(task.id, { automation: { delivery } }); }
    finally { close(); }
    const reopened = await openDatabaseAsync({ path: dbPath });
    try { expect(new SqliteScheduledTaskStore(reopened.raw).get(task.id)?.automation?.delivery).toEqual(delivery); }
    finally { reopened.raw.close(); }
  });

  it.each(['', ' ', 'send email', null, 1])('rejects invalid toolName %j without partially saving create/update', async (toolName) => {
    const { store, task, close } = await openStore();
    try {
      const before = store.get(task.id);
      const automation = { delivery: { kind: 'gmail', mcpServerId: 'mcp-1', recipient: 'reports@example.com', toolName } } as unknown as ScheduledTaskAutomation;
      expect(() => store.update(task.id, { name: 'changed', automation })).toThrow('scheduledTask.automation_invalid');
      expect(store.get(task.id)).toEqual(before);
      expect(() => store.create({ id: 'invalid-tool', name: 'invalid', instruction: 'noop', target: task.target,
        rule: task.rule, timeZone: task.timeZone, enabled: true, automation })).toThrow('scheduledTask.automation_invalid');
      expect(store.get('invalid-tool')).toBeUndefined();
    } finally { close(); }
  });
});


describe('scheduled waiting and reconciliation history', () => {
  it.each(['waiting_input', 'blocked', 'reconciling'] as const)('round-trips %s separately from failure', async(status)=>{
    const {store,task,close}=await openStore();
    try {store.addHistoryEntry({id:'waiting-history',taskId:task.id,status,firedAt:'2026-10-02T01:00:00.000Z',reason:'Specific next step'});
      expect(store.listHistory(task.id)).toEqual([expect.objectContaining({status,reason:'Specific next step'})]);
    } finally {close();}
  });
});
