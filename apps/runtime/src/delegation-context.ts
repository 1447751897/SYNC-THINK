import type { DelegatedRunRecord } from '@sync-think/shared';

const STATUS_LABELS: Record<DelegatedRunRecord['status'], string> = {
  running: '仍在运行',
  completed: '已完成',
  failed: '执行失败',
  cancelled: '已由用户停止',
  timed_out: '已超时停止',
};

/** Keep active children visible; the query tool provides complete history/results. */
export function formatDelegatedRunContext(
  records: readonly DelegatedRunRecord[],
): string | undefined {
  if (!records.length) return undefined;
  const ordered = [...records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const active = ordered.filter((record) => record.status === 'running');
  const recent = ordered.filter((record) => record.status !== 'running').slice(0, 8);
  const selected = [...active, ...recent];
  return [
    '[后台智能体状态（Runtime 已确认）]',
    ...selected.map(
      (record) =>
        `- ${record.name}：${STATUS_LABELS[record.status]}；` +
        `${record.toolCount} 项工具调用；${record.result?.trim() ? '已返回最终报告' : '未返回最终报告'}；childRunId: ${record.childRunId}`,
    ),
    ...(selected.length < records.length
      ? [`另有 ${records.length - selected.length} 个历史任务未列出。`]
      : []),
    '调用 agent_run_status 查询任务状态或读取最终报告；不要重复启动正在运行的任务。',
    '回答后续问题时以此状态为准；已停止、失败或超时的任务不得描述为仍在运行。',
  ].join('\n');
}
