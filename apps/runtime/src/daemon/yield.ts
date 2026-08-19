/**
 * 双 tick 让位（spec T5 + Q12）：守护进程是唯一调度者。
 *
 * 桌面 runtime 启动时探测守护进程管道——活着 → 关闭自身调度 tick
 * （任务由守护进程投递驱动）；死了/不在 → 保持现状（自身 tick 照常，
 * 兼容未装守护进程）。启动时静态探测，无运行中竞态。
 *
 * 管道名约定（本票修正 T2 的冲突）：
 *   桌面 runtime 管道：pipePathPortable(installId)
 *   守护进程管道：     pipePathPortable(installId + '-daemon')  ← 独立命名
 * 两个进程可并存（不再 EADDRINUSE），桌面 runtime 探测的是 daemon 管道。
 */

import { connect } from 'node:net';
import { pipePathPortable } from '@sync-think/protocol';

/** 守护进程的命名管道路径（独立于桌面 runtime 管道）。 */
export function daemonPipePath(installId: string): string {
  return pipePathPortable(`${installId}-daemon`);
}

export interface DecideSchedulerHeartbeatInput {
  /** 守护进程管道探测结果（启动时静态探测）。 */
  daemonAlive?: boolean;
  /** worker 模式（守护进程自拉）：永不启动自身 tick。 */
  daemonWorker?: boolean;
}

/**
 * 让位决策（纯函数）：
 * - worker 模式 → 永不启动 tick（唯一调度者 + 短暂执行者）
 * - daemon 活着 → 不启动 tick（让位给守护进程）
 * - daemon 不在 / 探测失败 → 启动 tick（现状行为）
 */
export function decideSchedulerHeartbeat(input: DecideSchedulerHeartbeatInput = {}): boolean {
  if (input.daemonWorker) return false;
  if (input.daemonAlive) return false;
  return true;
}

/** 管道探测函数（注入便于测试；默认 connect + 超时）。 */
export type PipeProbe = (path: string, timeoutMs: number) => Promise<boolean>;

/** 默认探测：connect 成功 = daemon 活着（800ms 超时）。 */
export function defaultPipeProbe(path: string, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(path);
    let settled = false;
    const done = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      if (!socket.destroyed) socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      done(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      done(false);
    });
  });
}

/** 探测守护进程是否活着（默认 800ms 超时）。 */
export async function probeDaemonPipe(
  installId: string,
  probe: PipeProbe = defaultPipeProbe,
  timeoutMs = 800,
): Promise<boolean> {
  return probe(daemonPipePath(installId), timeoutMs);
}

/** 探测桌面 runtime 管道（daemon 选择在线投递/worker 时使用）。 */
export async function probeDesktopPipe(
  installId: string,
  probe: PipeProbe = defaultPipeProbe,
  timeoutMs = 800,
): Promise<boolean> {
  return probe(pipePathPortable(installId), timeoutMs);
}
