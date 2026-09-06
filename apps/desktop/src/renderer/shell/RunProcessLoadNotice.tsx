import { RefreshCw } from 'lucide-react';
import type { RunProcessLoadFailure } from './run-process-history-loader.js';

const FAILURE_LABELS: Record<RunProcessLoadFailure['kind'], string> = {
  connection: '执行过程读取中断，正文已保留',
  busy: '执行过程读取繁忙，正文已保留',
  unavailable: '执行过程详情暂不可用，正文已保留',
  invalid: '执行过程返回异常，正文已保留',
  unknown: '执行过程读取失败，正文已保留',
};

export function RunProcessLoadNotice({
  runId,
  failure,
  onRetry,
}: {
  runId: string;
  failure?: RunProcessLoadFailure;
  onRetry(runId: string): void;
}) {
  if (!failure) return null;
  return (
    <div
      className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-text-faint"
      role="status"
      data-testid="run-process-load-notice"
    >
      <span>
        {FAILURE_LABELS[failure.kind]}
        {failure.retrying ? ` · 正在重试（${failure.attempts}/3）` : ''}
      </span>
      {!failure.retrying ? (
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-text-secondary hover:bg-elevated hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          onClick={() => onRetry(runId)}
          aria-label="重新加载执行过程"
        >
          <RefreshCw size={12} aria-hidden="true" />
          重新加载
        </button>
      ) : null}
    </div>
  );
}
