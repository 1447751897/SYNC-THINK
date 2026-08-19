// 定时任务存储：历史记录（0046 迁移）——add/list/回填 summary/倒序限制。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabaseAsync } from './connection.js';
import { runMigrations } from './scripts/migrate.js';
import { SqliteScheduledTaskStore } from './scheduled-task-store.js';
import type { ScheduledTask } from '@sync-think/shared';

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
  return { store, task, close: () => connection.raw.close() };
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
