import { memo, useEffect, useRef, useState } from 'react';
import { ChevronDown, Circle, CircleCheck, CircleDot, History, RefreshCw } from 'lucide-react';
import type { ConversationId } from '@sync-think/shared';
import type {
  TaskPlanHistoryPage,
  TaskPlanHistoryPayload,
  TaskPlanHistoryReadOptions,
} from '@sync-think/protocol';

type ReadHistory = (payload: TaskPlanHistoryPayload) => Promise<TaskPlanHistoryPage>;
type HistoryView = {
  page: TaskPlanHistoryPage;
  options: TaskPlanHistoryReadOptions;
  runOffsets: Array<{ beforeSequence?: number; beforeRunId?: string }>;
  itemOffsets: number[];
};
const runStatus = {
  running: '原轮次仍在运行',
  completed: '原轮次已结束',
  failed: '原轮次失败',
  cancelled: '原轮次已取消',
  paused: '原轮次已暂停',
  superseded: '已进入后续轮次',
};
const itemStatus = {
  pending: '记录时待办',
  in_progress: '记录时进行中',
  completed: '记录时已完成',
};

function sourceLabel(
  run: NonNullable<TaskPlanHistoryPage['selected']> | TaskPlanHistoryPage['runs'][number],
): string {
  return run.kernelId === 'codex'
    ? 'Codex'
    : run.kernelId === 'claude-code' || run.source === 'claude'
      ? 'Claude Code'
      : run.kernelId === 'native'
        ? 'Native'
        : '原生计划';
}

function recordedAt(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : value;
}

export const TaskPlanHistoryPanel = memo(function TaskPlanHistoryPanel({
  conversationId,
  readHistory,
}: {
  conversationId: ConversationId;
  readHistory?: ReadHistory;
}) {
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState<HistoryView>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const pending = useRef(false);
  useEffect(() => {
    generation.current += 1;
    pending.current = false;
    setExpanded(false);
    setView(undefined);
    setError('');
    setBusy(false);
    return () => {
      generation.current += 1;
      pending.current = false;
    };
  }, [conversationId]);

  if (!readHistory) return null;
  const load = async (
    options: TaskPlanHistoryReadOptions,
    runOffsets: HistoryView['runOffsets'] = [],
    itemOffsets: number[] = [],
  ) => {
    if (pending.current) return;
    const currentGeneration = ++generation.current;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const page = await readHistory({ conversationId, ...options });
      if (generation.current !== currentGeneration) return;
      if (options.runId && page.selected?.runId !== options.runId)
        throw new Error('history.plan-not-found');
      setView({ page, options, runOffsets, itemOffsets });
    } catch (reason) {
      if (generation.current !== currentGeneration) return;
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(
        message.includes('history.version-changed')
          ? '历史记录已更新，请刷新后重新查看。'
          : '读取历史任务失败：' + message,
      );
    } finally {
      if (generation.current === currentGeneration) {
        pending.current = false;
        setBusy(false);
      }
    }
  };
  const selected = view?.page.selected;
  return (
    <section
      className="shell-task-history"
      aria-label="原生任务历史"
      data-testid="task-plan-history"
    >
      <div className="shell-task-history__header">
        <button
          type="button"
          className="shell-task-history__toggle"
          aria-label="历史任务"
          aria-expanded={expanded}
          onClick={() => {
            if (expanded) {
              generation.current += 1;
              pending.current = false;
              setBusy(false);
              setExpanded(false);
            } else {
              setExpanded(true);
              void load({ offset: 0 });
            }
          }}
        >
          <History size={14} aria-hidden="true" />
          历史任务
          <ChevronDown
            size={13}
            aria-hidden="true"
            className="shell-composer-task-panel__chevron"
            data-expanded={expanded ? 'true' : 'false'}
          />
        </button>
        {expanded ? (
          <button
            type="button"
            className="shell-task-history__refresh"
            aria-label="刷新历史任务"
            title="刷新历史任务"
            disabled={busy}
            onClick={() =>
              void load(
                {
                  beforeSequence: view?.options.beforeSequence,
                  beforeRunId: view?.options.beforeRunId,
                  runId: selected?.runId,
                  offset: 0,
                },
                view?.runOffsets,
              )
            }
          >
            <RefreshCw size={13} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {expanded ? (
        <div className="shell-task-history__body" aria-busy={busy}>
          <p className="shell-task-history__notice">
            原生清单的只读快照，不代表当前执行；关闭此面板不会删除任务。
          </p>
          {error ? (
            <p role="alert" className="shell-task-history__error">
              {error}
            </p>
          ) : null}
          {busy ? (
            <p role="status" className="shell-task-history__notice">
              正在读取历史任务…
            </p>
          ) : null}
          {view ? (
            <>
              {view.page.runs.length ? (
                <div className="shell-task-history__controls">
                  <select
                    aria-label="选择历史任务轮次"
                    disabled={busy}
                    value={selected?.runId ?? ''}
                    onChange={(event) =>
                      void load(
                        {
                          beforeSequence: view.options.beforeSequence,
                          beforeRunId: view.options.beforeRunId,
                          runId: event.target.value,
                          offset: 0,
                        },
                        view.runOffsets,
                      )
                    }
                  >
                    {view.page.runs.map((run) => (
                      <option key={run.runId} value={run.runId}>
                        {recordedAt(run.updatedAt)} · {sourceLabel(run)} · {run.title}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <p className="shell-task-history__notice">这一页没有已确认的原生任务记录。</p>
              )}
              {selected ? (
                <>
                  <div className="shell-task-history__metadata">
                    <span>
                      {sourceLabel(selected)} · {runStatus[selected.status]}
                    </span>
                    <span title={selected.runId}>轮次 {selected.runId.slice(0, 10)}</span>
                    <span>
                      {selected.completed}/{selected.total} 项完成
                    </span>
                  </div>
                  {selected.total === 0 ? (
                    <p className="shell-task-history__notice">此轮已明确清空任务清单。</p>
                  ) : (
                    <div
                      className="shell-composer-task-panel__list shell-task-history__list"
                      role="list"
                      aria-label="历史任务项"
                    >
                      {selected.items.map((item, index) => {
                        const Icon =
                          item.status === 'completed'
                            ? CircleCheck
                            : item.status === 'in_progress'
                              ? CircleDot
                              : Circle;
                        return (
                          <div
                            className="shell-composer-task-panel__item"
                            role="listitem"
                            key={item.id ?? selected.offset + index}
                          >
                            <Icon size={16} aria-hidden="true" />
                            <div className="shell-composer-task-panel__content">
                              <span className="shell-composer-task-panel__title">{item.title}</span>
                              {item.description ? (
                                <span className="shell-composer-task-panel__description">
                                  {item.description}
                                </span>
                              ) : null}
                              <span className="shell-task-history__recorded-status">
                                {itemStatus[item.status]}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {selected.offset > 0 || selected.nextOffset !== undefined ? (
                    <div className="shell-task-history__pagination">
                      <span>
                        第 {selected.offset + 1}–{selected.offset + selected.items.length} 项，共{' '}
                        {selected.total} 项
                      </span>
                      <button
                        type="button"
                        disabled={busy || view.itemOffsets.length === 0}
                        onClick={() =>
                          void load(
                            {
                              ...view.options,
                              runId: selected.runId,
                              offset: view.itemOffsets.at(-1)!,
                              version: selected.version,
                            },
                            view.runOffsets,
                            view.itemOffsets.slice(0, -1),
                          )
                        }
                      >
                        上一页任务
                      </button>
                      <button
                        type="button"
                        disabled={busy || selected.nextOffset === undefined}
                        onClick={() =>
                          void load(
                            {
                              ...view.options,
                              runId: selected.runId,
                              offset: selected.nextOffset!,
                              version: selected.version,
                            },
                            view.runOffsets,
                            [...view.itemOffsets, selected.offset],
                          )
                        }
                      >
                        下一页任务
                      </button>
                    </div>
                  ) : null}
                </>
              ) : null}
              {view.runOffsets.length || view.page.nextBeforeSequence !== undefined ? (
                <div className="shell-task-history__pagination">
                  <button
                    type="button"
                    disabled={busy || view.runOffsets.length === 0}
                    onClick={() =>
                      void load(
                        { ...view.runOffsets.at(-1), offset: 0 },
                        view.runOffsets.slice(0, -1),
                      )
                    }
                  >
                    较新轮次
                  </button>
                  <button
                    type="button"
                    disabled={busy || view.page.nextBeforeSequence === undefined}
                    onClick={() =>
                      void load(
                        {
                          beforeSequence: view.page.nextBeforeSequence,
                          beforeRunId: view.page.nextBeforeRunId,
                          offset: 0,
                        },
                        [
                          ...view.runOffsets,
                          {
                            beforeSequence: view.options.beforeSequence,
                            beforeRunId: view.options.beforeRunId,
                          },
                        ],
                      )
                    }
                  >
                    更早轮次
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
});
