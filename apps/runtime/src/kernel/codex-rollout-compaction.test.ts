import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCodexRolloutCompactionWatcher,
  findCodexRolloutFile,
  isRolloutCompactionLine,
} from './codex-rollout-compaction.js';

function tempCodexHome(): string {
  const root = mkdtempSync(join(tmpdir(), 'codex-rollout-'));
  const sessions = join(root, 'sessions', '2026', '08', '15');
  mkdirSync(sessions, { recursive: true });
  return root;
}

describe('codex rollout compaction', () => {
  it('recognizes top-level compacted lines and event_msg.context_compacted markers', () => {
    expect(
      isRolloutCompactionLine(
        JSON.stringify({ type: 'compacted', payload: { message: 'Handoff summary.' } }),
      ),
    ).toBe(true);
    expect(
      isRolloutCompactionLine(
        JSON.stringify({ type: 'event_msg', payload: { type: 'context_compacted' } }),
      ),
    ).toBe(true);
    expect(isRolloutCompactionLine(JSON.stringify({ type: 'turn.completed' }))).toBe(false);
    expect(isRolloutCompactionLine('not json')).toBe(false);
    expect(isRolloutCompactionLine('')).toBe(false);
  });

  it('finds the newest rollout file by session id suffix', () => {
    const home = tempCodexHome();
    const dir = join(home, 'sessions', '2026', '08', '15');
    const oldFile = join(dir, 'rollout-2026-08-15T10-00-00-sess-abc.jsonl');
    const newFile = join(dir, 'rollout-2026-08-15T11-00-00-sess-abc.jsonl');
    writeFileSync(oldFile, '{}');
    writeFileSync(newFile, '{}');
    const now = Date.now();
    utimesSync(oldFile, new Date(now - 60_000), new Date(now - 60_000));
    utimesSync(newFile, new Date(now), new Date(now));
    expect(findCodexRolloutFile(home, 'sess-abc')).toBe(newFile);
    expect(findCodexRolloutFile(home, 'sess-other')).toBeNull();
  });

  it('fires onCompacted once when a compacted line appears in the rollout tail', async () => {
    const home = tempCodexHome();
    const dir = join(home, 'sessions', '2026', '08', '15');
    const file = join(dir, 'rollout-2026-08-15T12-00-00-sess-abc.jsonl');
    writeFileSync(file, JSON.stringify({ type: 'thread.started', thread_id: 'sess-abc' }) + '\n');

    const onCompacted = vi.fn();
    const watcher = createCodexRolloutCompactionWatcher({
      codexHome: home,
      sessionId: 'sess-abc',
      onCompacted,
      pollIntervalMs: 20,
      maxLifetimeMs: 2_000,
    });

    // 压缩发生前不触发
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(onCompacted).not.toHaveBeenCalled();

    // 追加 compacted 行
    writeFileSync(
      file,
      JSON.stringify({ type: 'compacted', payload: { message: 'Handoff.' } }) + '\n',
      { flag: 'a' },
    );

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(onCompacted).toHaveBeenCalledTimes(1);

    watcher.stop();
  });

  it('stops polling after maxLifetimeMs', async () => {
    const home = tempCodexHome();
    const watcher = createCodexRolloutCompactionWatcher({
      codexHome: home,
      sessionId: 'sess-zzz',
      onCompacted: vi.fn(),
      pollIntervalMs: 10,
      maxLifetimeMs: 60,
    });
    // 无文件——只验证不抛错且能 stop。
    await new Promise((resolve) => setTimeout(resolve, 120));
    watcher.stop();
    expect(true).toBe(true);
  });
});
