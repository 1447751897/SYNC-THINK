/**
 * 守护进程管理（spec T11）：状态快照 + 心跳判定。
 *
 * 供设置页管理卡片消费：running（管道探测）/ heartbeatStale（心跳超 5s 即
 * 异常）/ 今日触发 / 排队 / 定时器数 / 自启注册 / 并发上限。
 * 纯函数部分（快照构造、心跳判定）可独立测试。
 */

import type { DaemonStatus } from './core.js';

/** 心跳超时阈值（5s，spec Q7）。 */
export const HEARTBEAT_STALE_MS = 5_000;

export interface DaemonStatusPayload {
  running: boolean;
  /** Runtime child has completed startup (IPC ready signal or compatibility probe). */
  runtimeReady: boolean;
  heartbeatAt?: string;
  /** 心跳超 5s 未更新（或从未心跳）→ 异常。 */
  heartbeatStale: boolean;
  todayFired: number;
  queued: number;
  timerCount: number;
  /** 计划任务自启是否已注册。 */
  autostart: boolean;
  /** 并发上限（1–8，默认 2）。 */
  maxConcurrent: number;
}

/** 心跳是否过期（超过 5s 未更新 / 从未心跳）。 */
export function isHeartbeatStale(
  heartbeatAt: Date | string | undefined,
  now: Date = new Date(),
): boolean {
  if (!heartbeatAt) return true;
  const timestamp = typeof heartbeatAt === 'string' ? Date.parse(heartbeatAt) : heartbeatAt.getTime();
  if (!Number.isFinite(timestamp)) return true;
  return now.getTime() - timestamp > HEARTBEAT_STALE_MS;
}

/** 构造设置页消费的状态快照（纯函数）。 */
export function buildDaemonStatusPayload(
  status: DaemonStatus,
  extras: {
    running: boolean;
    runtimeReady?: boolean;
    autostartRegistered?: boolean;
    maxConcurrent?: number;
    now?: Date;
  },
): DaemonStatusPayload {
  const now = extras.now ?? new Date();
  return {
    running: extras.running,
    runtimeReady: extras.runtimeReady ?? false,
    ...(status.heartbeatAt ? { heartbeatAt: status.heartbeatAt } : {}),
    heartbeatStale: isHeartbeatStale(status.heartbeatAt, now),
    todayFired: status.todayFired,
    queued: status.queued,
    timerCount: status.timerCount,
    autostart: extras.autostartRegistered ?? false,
    maxConcurrent: extras.maxConcurrent ?? 2,
  };
}
