/**
 * 设置页 · 守护进程管理卡片（spec T11）。
 * 状态徽标（运行中/已停止/异常）+ 心跳 + 今日触发/排队/定时器指标 +
 * 开机自启开关 + 并发上限滑块 + 重启/查看日志/停止。
 * 数据源：daemon:* IPC（daemon 独立管道）。
 */

import { useCallback, useEffect, useState } from 'react';

export interface DaemonStatusPayload {
  running: boolean;
  runtimeReady?: boolean;
  heartbeatAt?: string;
  heartbeatStale: boolean;
  todayFired: number;
  queued: number;
  timerCount: number;
  autostart: boolean;
  maxConcurrent: number;
}

const POLL_MS = 3_000;

function useDaemonStatus(): {
  status: DaemonStatusPayload | null;
  refresh: () => void;
} {
  const [status, setStatus] = useState<DaemonStatusPayload | null>(null);
  const refresh = useCallback(() => {
    void window.syncThink?.runtime?.requestDaemonStatus?.().then((result) => {
      if (result && typeof result === 'object' && 'payload' in result) {
        setStatus((result.payload as DaemonStatusPayload) ?? null);
      }
    });
  }, []);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);
  return { status, refresh };
}

export function DaemonCard() {
  const { status, refresh } = useDaemonStatus();

  const handleStop = async (): Promise<void> => {
    await window.syncThink?.runtime?.daemonStop?.();
    refresh();
  };
  const handleStart = async (): Promise<void> => {
    await window.syncThink?.runtime?.daemonStart?.();
    refresh();
  };
  const handleAutostart = async (enabled: boolean): Promise<void> => {
    await window.syncThink?.runtime?.daemonSetAutostart?.({ enabled });
    refresh();
  };
  const handleMaxConcurrent = async (value: number): Promise<void> => {
    await window.syncThink?.runtime?.daemonSetMaxConcurrent?.({ maxConcurrent: value });
    refresh();
  };

  const running = status?.running ?? false;
  const stale = status?.heartbeatStale ?? true;
  const badgeClass = !running ? 'is-stopped' : stale ? 'is-error' : 'is-running';
  const badgeLabel = !running ? '已停止' : stale ? '异常' : '运行中';

  return (
    <section className="settings-daemon-card">
      <h2>守护进程</h2>
      <p className="settings-daemon-desc">
        常驻调度器：应用关闭后定时任务照常触发。状态徽标显示运行状态与心跳。
      </p>

      <div className="settings-daemon-status-row">
        <span className={`settings-daemon-badge ${badgeClass}`}>{badgeLabel}</span>
        {running ? (
          <span className="settings-daemon-heartbeat">
            Runtime {status?.runtimeReady ? '就绪' : '启动中'}
          </span>
        ) : null}
        {status?.heartbeatAt ? (
          <span className="settings-daemon-heartbeat">
            上次心跳 {new Date(status.heartbeatAt).toLocaleTimeString()}
          </span>
        ) : null}
      </div>

      <div className="settings-daemon-metrics">
        <div className="settings-daemon-metric">
          <strong>{status?.todayFired ?? '—'}</strong>
          <span>今日触发</span>
        </div>
        <div className="settings-daemon-metric">
          <strong>{status?.queued ?? '—'}</strong>
          <span>排队中</span>
        </div>
        <div className="settings-daemon-metric">
          <strong>{status?.timerCount ?? '—'}</strong>
          <span>定时器</span>
        </div>
      </div>

      <div className="settings-daemon-controls">
        <label className="settings-daemon-row">
          <span>
            开机自启
            <small>默认开启；手动关闭后将保持关闭</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={status?.autostart ?? false}
            onChange={(event) => handleAutostart(event.target.checked)}
          />
        </label>

        <label className="settings-daemon-row">
          <span>
            并发上限
            <small>同时执行的任务数（1–8）</small>
          </span>
          <input
            type="range"
            min={1}
            max={8}
            step={1}
            value={status?.maxConcurrent ?? 2}
            onChange={(event) => handleMaxConcurrent(Number(event.target.value))}
          />
          <strong className="settings-daemon-value">{status?.maxConcurrent ?? 2}</strong>
        </label>
      </div>

      <div className="settings-daemon-actions">
        {running ? (
          <button type="button" className="settings-button" onClick={() => void handleStop()}>
            停止
          </button>
        ) : (
          <button
            type="button"
            className="settings-button is-primary"
            onClick={() => void handleStart()}
          >
            启动
          </button>
        )}
        <button
          type="button"
          className="settings-button"
          onClick={() => void window.syncThink?.runtime?.daemonLogs?.()}
        >
          查看日志
        </button>
      </div>
    </section>
  );
}
