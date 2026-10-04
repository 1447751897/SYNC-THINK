import { WorkbenchPageHeader } from './WorkbenchPageHeader.js';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  Bot,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Cpu,
  FileSpreadsheet,
  Globe,
  History,
  LoaderCircle,
  Mail,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  UsersRound,
  AlertCircle,
  Pause,
  Trash2,
  FolderOpen,
  MessageSquare,
} from 'lucide-react';
import type { ScheduledTask, ScheduledTaskHistoryEntry, WorkspaceId } from '@sync-think/shared';
import type { BrowserHandoffSummary } from '@sync-think/protocol';
import { BrowserHandoffCard } from './BrowserHandoffCard.js';
import {
  automationIssues,
  automationExecutionMode,
  AUTOMATION_PERMISSION_LABELS,
  type AutomationResources,
} from './AutomationBindings.js';

export type AutomationFilter = 'all' | 'scheduled' | 'browser';
const RESULTS = {
  success: '执行成功',
  failed: '执行失败',
  skipped: '已跳过',
  cancelled: '已取消',
  waiting_input: '等待操作',
  blocked: '配置阻塞',
  reconciling: '交付待核对',
} as const;

function ExecutorIcon({ kind }: { kind: ScheduledTask['target']['kind'] }) {
  return kind === 'agent' ? (
    <Bot size={19} />
  ) : kind === 'team' ? (
    <UsersRound size={19} />
  ) : (
    <Cpu size={19} />
  );
}

function AutomationHistory({
  task,
  revision,
  formatTime,
  onOpenConversation,
}: {
  task: ScheduledTask;
  revision: number;
  formatTime(iso?: string): string;
  onOpenConversation?(id: string): void;
}) {
  const [state, setState] = useState<{
    taskId: string;
    entries: ScheduledTaskHistoryEntry[] | null;
    error?: string;
  }>({ taskId: task.id, entries: null });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState({ taskId: task.id, entries: null });
    const api = window.syncThink?.runtime;
    if (!api?.scheduledTaskHistory) {
      setState({ taskId: task.id, entries: null, error: '历史服务待连接' });
      return;
    }
    void api
      .scheduledTaskHistory({ taskId: task.id, limit: 20 })
      .then((result) => {
        if (!cancelled) setState({ taskId: task.id, entries: result.entries });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setState({
            taskId: task.id,
            entries: null,
            error: error instanceof Error ? error.message : String(error),
          });
      });
    return () => {
      cancelled = true;
    };
  }, [task.id, task.updatedAt, task.lastRunAt, revision, retry]);
  const current = state.taskId === task.id ? state : { entries: null, error: undefined };
  return (
    <section className="automation-history" aria-label="执行历史" data-testid="automation-history">
      <header>
        <h3>
          <History size={17} />
          执行历史
        </h3>
        <button
          type="button"
          aria-label="刷新执行历史"
          onClick={() => setRetry((value) => value + 1)}
        >
          <RefreshCw size={14} />
        </button>
      </header>
      <small>所选任务最近 20 次实际记录</small>
      {current.error ? (
        <div role="alert">
          <p>{current.error}</p>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            重试历史
          </button>
        </div>
      ) : current.entries === null ? (
        <p role="status">
          <LoaderCircle size={15} className="shell-process-spin" />
          加载执行记录…
        </p>
      ) : !current.entries.length ? (
        <p className="automation-center__muted">还没有执行记录。测试后在这里查看结果。</p>
      ) : (
        <ol>
          {current.entries.map((entry) => (
            <li key={entry.id} data-status={entry.status}>
              {entry.status === 'success' ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}
              <div>
                <time dateTime={entry.firedAt}>{formatTime(entry.firedAt)}</time>
                <strong>{RESULTS[entry.status]}</strong>
                {entry.summary ? <p>{entry.summary}</p> : null}
                {entry.reason && entry.reason !== entry.summary ? <p>{entry.reason}</p> : null}
                {entry.runId ? <small>Run · {entry.runId}</small> : null}
              </div>
            </li>
          ))}
        </ol>
      )}
      {task.conversationId && onOpenConversation ? (
        <button
          type="button"
          className="automation-center__secondary"
          onClick={() => onOpenConversation(task.conversationId!)}
        >
          打开任务会话
        </button>
      ) : null}
    </section>
  );
}

export function AutomationHandoffs({
  task,
  revision,
  onResolved,
}: {
  task: ScheduledTask;
  revision: number;
  onResolved?(): void;
}) {
  const [handoffs, setHandoffs] = useState<BrowserHandoffSummary[]>([]);
  const [queryError, setQueryError] = useState('');
  const [actionError, setActionError] = useState<{ id: string; message: string }>();
  const [busy, setBusy] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const api = window.syncThink?.runtime;
    setQueryError('');
    if (!api?.listWaitingBrowserHandoffs) return;
    let disposed = false;
    let sequence = 0;
    const load = async () => {
      const request = ++sequence;
      try {
        const result = await api.listWaitingBrowserHandoffs({
          workspaceId: task.workspaceId as WorkspaceId | undefined,
        });
        if (disposed || request !== sequence) return;
        setQueryError('');
        setHandoffs(
          result.handoffs.filter((handoff) => {
            if (task.workspaceId && handoff.workspaceId !== task.workspaceId) return false;
            return (
              handoff.scheduledTaskId === task.id ||
              (!handoff.scheduledTaskId &&
                Boolean(task.conversationId) &&
                handoff.conversationId === task.conversationId)
            );
          }),
        );
      } catch (cause) {
        if (!disposed && request === sequence) {
          setQueryError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    };
    void load();
    const unsubscribe = api.onEvent?.((event) => {
      if (
        event.type.startsWith('browser.handoff.') ||
        (event.type === 'collaboration.updated' &&
          event.payload.conversationId === task.conversationId)
      ) {
        void load();
      }
    });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [task.id, task.workspaceId, task.conversationId, task.updatedAt, revision, refresh]);
  const decide = async (handoff: BrowserHandoffSummary, continuing: boolean) => {
    if (busy) return;
    setBusy(handoff.handoffId);
    setActionError(undefined);
    try {
      const api = window.syncThink?.runtime;
      if (!api?.continueBrowserHandoff || !api.cancelBrowserHandoff) {
        throw new Error('浏览器接管服务待连接');
      }
      const payload = { handoffId: handoff.handoffId, expectedRevision: handoff.revision };
      if (continuing) await api.continueBrowserHandoff(payload);
      else
        await api.cancelBrowserHandoff({
          ...payload,
          leaseDisposition: handoff.onCancel === 'close-page' ? 'release' : 'preserve',
        });
      if (!mounted.current) return;
      setRefresh((value) => value + 1);
      onResolved?.();
    } catch (cause) {
      if (mounted.current)
        setActionError({
          id: handoff.handoffId,
          message: cause instanceof Error ? cause.message : String(cause),
        });
    } finally {
      if (mounted.current) setBusy(undefined);
    }
  };
  if (!window.syncThink?.runtime?.listWaitingBrowserHandoffs) {
    return task.automation?.browser ? (
      <p className="automation-center__muted">浏览器接管服务待连接。</p>
    ) : null;
  }
  if (!handoffs.length && !queryError) return null;
  return (
    <section className="automation-center__handoffs" aria-label="所选任务浏览器接管">
      {queryError ? (
        <div role="alert">
          <p>读取浏览器接管失败：{queryError}</p>
          <button
            type="button"
            className="automation-center__secondary"
            disabled={Boolean(busy)}
            onClick={() => setRefresh((value) => value + 1)}
          >
            重试接管状态
          </button>
        </div>
      ) : null}
      {handoffs.map((handoff) => (
        <div key={handoff.handoffId}>
          <small>
            {handoff.scheduledTaskId ? '定时执行轮次' : '任务群会话'} · Profile{' '}
            {handoff.profileId ?? 'default'} · 原任务尚未完成
          </small>
          <BrowserHandoffCard
            handoff={handoff}
            busy={Boolean(busy)}
            error={actionError?.id === handoff.handoffId ? actionError.message : undefined}
            onContinue={() => void decide(handoff, true)}
            onCancel={() => void decide(handoff, false)}
          />
        </div>
      ))}
      <p className="automation-center__readiness-note">
        继续仅恢复原执行者；登录状态与交付结果仍需实际执行验收。
      </p>
    </section>
  );
}

export function AutomationCenter({
  tasks,
  totalCount,
  selected,
  filter,
  onFilter,
  onSelect,
  loading,
  error,
  actionError,
  busy,
  resources,
  executor,
  executorReady,
  workspaceName,
  workspaceReady,
  ruleSummary,
  formatTime,
  historyRevision,
  onCreate,
  onCalendar,
  onRefresh,
  onEdit,
  onTest,
  onPublish,
  onDelete,
  onOpenConversation,
  onHandoffResolved,
  scopePicker,
}: {
  tasks: readonly ScheduledTask[];
  totalCount: number;
  selected?: ScheduledTask;
  filter: AutomationFilter;
  onFilter(filter: AutomationFilter): void;
  onSelect(id: string): void;
  loading: boolean;
  error: string | null;
  actionError: string | null;
  busy: boolean;
  resources: AutomationResources;
  executor(task: ScheduledTask): ReactNode;
  executorReady(task: ScheduledTask): boolean;
  workspaceName(id?: string): string;
  workspaceReady(task: ScheduledTask): boolean;
  ruleSummary(task: ScheduledTask['rule']): string;
  formatTime(iso?: string): string;
  historyRevision: number;
  onCreate(): void;
  onCalendar(): void;
  onRefresh(): void;
  onEdit(task: ScheduledTask): void;
  onTest(task: ScheduledTask): void;
  onPublish(task: ScheduledTask): void;
  onDelete(task: ScheduledTask): void;
  onOpenConversation?(id: string): void;
  onHandoffResolved?(): void;
  scopePicker?: ReactNode;
}) {
  const detailRef = useRef<HTMLElement>(null);
  const previousSelection = useRef(selected?.id);
  useEffect(() => {
    const changed =
      previousSelection.current !== undefined && previousSelection.current !== selected?.id;
    previousSelection.current = selected?.id;
    const detail = detailRef.current;
    const panelWidth = detail?.closest('.task-panel')?.clientWidth;
    if (changed && detail && panelWidth && panelWidth <= 820) {
      detail.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
    }
  }, [selected?.id]);
  const issues = selected
    ? [
        ...(!executorReady(selected) ? ['执行者待配置'] : []),
        ...(!workspaceReady(selected) ? ['工作区待配置'] : []),
        ...automationIssues(selected.automation, resources, selected.workspaceId),
      ]
    : [];
  const browser = selected?.automation?.browser;
  const profile = resources.profiles.find((item) => item.id === browser?.profileId);
  const workflow = resources.workflows.find((item) => item.id === browser?.workflowTaskId);
  const requiresResources = Boolean(
    browser || selected?.automation?.requiredMcpServerIds?.length || selected?.automation?.delivery,
  );
  const waiting = requiresResources && resources.loading;
  const ready = Boolean(selected) && !waiting && !issues.length;
  const delivery = selected?.automation?.delivery;
  const deliveryServer = resources.servers.find(
    (item) => item.mcpServerId === delivery?.mcpServerId,
  );
  const outputText = selected?.automation?.outputs
    ?.map((output) => (output === 'spreadsheet' ? '表格' : 'PPT'))
    .join(' / ');
  return (
    <section className="automation-center" aria-label="自动化中心">
      <div className="automation-center__layout">
        <main className="automation-center__main">
          <WorkbenchPageHeader
          className="automation-center__header"
          heading={<>

            <div>
              <h1>自动化</h1>
              <p>把时间、浏览器与团队能力，编排成可靠的交付。</p>
            </div>

          </>}
          actions={<>
<div className="automation-center__toolbar">
              <button type="button" className="automation-center__quiet" onClick={onCalendar}>
                <CalendarDays size={17} />
                日历
              </button>
              <button
                type="button"
                className="automation-center__primary"
                data-testid="task-create"
                onClick={onCreate}
              >
                <Plus size={18} />
                新建任务
              </button>
            </div>

          </>}
        />
          <div className="automation-center__filters">
            <div role="group" aria-label="任务类型筛选">
              {(
                [
                  ['all', '全部任务'],
                  ['scheduled', '定时任务'],
                  ['browser', '浏览器任务'],
                ] as const
              ).map(([key, label]) => (
                <button
                  type="button"
                  key={key}
                  aria-pressed={filter === key}
                  onClick={() => onFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="automation-center__scope">
              {scopePicker}
              <button
                type="button"
                aria-label="刷新任务与能力配置"
                onClick={onRefresh}
                disabled={loading}
              >
                <RefreshCw size={16} />
              </button>
            </div>
          </div>
          {error ? (
            <div className="automation-center__notice" role="alert">
              加载失败：{error}
              <button type="button" onClick={onRefresh}>
                重试
              </button>
            </div>
          ) : null}
          {actionError ? (
            <div className="automation-center__notice" role="alert">
              {actionError}
            </div>
          ) : null}
          <div className="automation-center__list" aria-label="自动化任务列表" aria-busy={loading}>
            {loading ? (
              <div className="automation-center__empty" role="status">
                <LoaderCircle className="shell-process-spin" size={19} />
                加载任务…
              </div>
            ) : !tasks.length ? (
              <div className="automation-center__empty" data-testid="task-empty">
                <Clock3 size={26} />
                <h2>
                  {error
                    ? '任务暂未加载，请重试'
                    : totalCount
                      ? '没有符合筛选条件的任务'
                      : '还没有自动化任务'}
                </h2>
                <p>从一条指令开始，绑定执行者与触发计划。新任务先保存为草稿。</p>
                <button type="button" className="automation-center__secondary" onClick={onCreate}>
                  新建自动化任务
                </button>
              </div>
            ) : (
              tasks.map((task) => (
                <div
                  className="automation-center__row"
                  key={task.id}
                  data-selected={selected?.id === task.id}
                >
                  <button
                    type="button"
                    className="automation-center__task-select"
                    aria-label={`查看 ${task.name}`}
                    aria-pressed={selected?.id === task.id}
                    onClick={() => onSelect(task.id)}
                  >
                    <span className="automation-center__task-icon">
                      {task.automation?.browser ? (
                        <Globe size={22} />
                      ) : (
                        <ExecutorIcon kind={task.target.kind} />
                      )}
                    </span>
                    <span className="automation-center__task-name">
                      <strong>{task.name}</strong>
                      <small>
                        {task.enabled ? '已发布' : '草稿 / 已停用'}
                        {task.lastResult ? ` · ${RESULTS[task.lastResult.status]}` : ''}
                      </small>
                    </span>
                    <span className="automation-center__row-executor">{executor(task)}</span>
                    <span className="automation-center__row-rule">
                      <Clock3 size={15} />
                      {ruleSummary(task.rule)}
                    </span>
                    <span className="automation-center__view">查看</span>
                  </button>
                  <button
                    type="button"
                    className="automation-center__row-edit"
                    title="编辑"
                    aria-label={`编辑 ${task.name}`}
                    onClick={() => onEdit(task)}
                  >
                    <Pencil size={16} />
                  </button>
                </div>
              ))
            )}
          </div>
          {selected && !loading ? (
            <article
              className="automation-center__detail"
              ref={detailRef}
              aria-label="选中任务配置"
              data-testid="automation-detail"
            >
              <header>
                <span className="automation-center__task-icon">
                  {browser ? <Globe size={25} /> : <ExecutorIcon kind={selected.target.kind} />}
                </span>
                <div>
                  <h2>
                    {selected.name}
                    <button
                      type="button"
                      title="编辑"
                      aria-label="编辑选中任务"
                      onClick={() => onEdit(selected)}
                    >
                      <Pencil size={17} />
                    </button>
                  </h2>
                  <p>{selected.instruction}</p>
                </div>
                <span className={`automation-center__badge${ready ? ' is-ready' : ''}`}>
                  {waiting
                    ? '检查配置中'
                    : !ready
                      ? '待配置'
                      : selected.enabled
                        ? '已发布'
                        : '草稿'}
                </span>
              </header>
              <dl>
                <div>
                  <dt>
                    <ExecutorIcon kind={selected.target.kind} />
                    执行者
                  </dt>
                  <dd>{executor(selected)}</dd>
                </div>
                <div>
                  <dt>
                    <FolderOpen size={20} />
                    工作区
                  </dt>
                  <dd>{workspaceName(selected.workspaceId)}</dd>
                </div>
                <div>
                  <dt>
                    <ShieldCheck size={20} />
                    执行权限
                  </dt>
                  <dd>
                    {AUTOMATION_PERMISSION_LABELS[automationExecutionMode(selected.automation)]}
                    <small>仅本任务 / 本轮 scope；已声明网站审批，不改变全局设置</small>
                  </dd>
                </div>
                <div>
                  <dt><MessageSquare size={20}/>运行会话</dt>
                  <dd>{selected.automation?.conversation?.mode === 'new' ? '每次运行时新建会话' : selected.automation?.conversation?.mode === 'existing' ? '继续已有会话' : '此任务的专属会话'}<small>{selected.automation?.conversation?.mode === 'new' ? '各轮上下文独立，登录资料保留' : '沿用会话上下文；忙碌时跳过，不并发追加'}</small></dd>
                </div>
                <div>
                  <dt>
                    <Clock3 size={20} />
                    触发
                  </dt>
                  <dd>
                    {ruleSummary(selected.rule)}
                    <small>
                      {selected.timeZone}
                      {selected.nextRunAt ? ` · 下次 ${formatTime(selected.nextRunAt)}` : ''}
                    </small>
                  </dd>
                </div>
                <div>
                  <dt>
                    <Globe size={20} />
                    浏览器
                  </dt>
                  <dd>
                    {browser ? (
                      <>
                        {profile?.name ?? `${browser.profileId} · 待配置`}
                        <small>{workflow?.name ?? (browser.workflowTaskId ? '已发布流程待配置' : '按目标动态操作网页')} · 登录状态以执行为准</small>
                      </>
                    ) : (
                      '未绑定 · 按任务指令执行'
                    )}
                  </dd>
                </div>
                <div>
                  <dt>
                    <FileSpreadsheet size={20} />
                    能力链
                  </dt>
                  <dd>
                    <div className="automation-center__chain" aria-label="采集→整理→产物→交付">
                      <span>
                        采集<small>{browser ? (browser.workflowTaskId ? '复用网页流程' : '动态网页操作') : '任务输入'}</small>
                      </span>
                      <ArrowRight size={14} />
                      <span>
                        整理
                        <small>
                          {selected.automation?.requiredMcpServerIds?.length
                            ? '执行者 + MCP'
                            : '执行者'}
                        </small>
                      </span>
                      <ArrowRight size={14} />
                      <span>
                        产物<small>{outputText || '按验收说明'}</small>
                      </span>
                      <ArrowRight size={14} />
                      <span>
                        交付<small>{delivery ? 'Gmail' : '任务会话'}</small>
                      </span>
                    </div>
                  </dd>
                </div>
              </dl>
              <section className="automation-center__acceptance">
                <h3>执行验收说明</h3>
                <p>
                  {selected.automation?.acceptance ||
                    '尚未填写。请在编辑器中说明采集范围、整理标准、产物与交付成功依据。'}
                </p>
                {delivery ? (
                  <small>
                    连接器 · {deliveryServer?.name ?? delivery.mcpServerId} / 发件工具 ·{' '}
                    {delivery.toolName || '待明确选择'} / 收件人 · {delivery.recipient}
                  </small>
                ) : null}
              </section>
              <footer>
                <p>
                  {waiting
                    ? '正在检查实际绑定配置…'
                    : issues.length
                      ? `${issues.join('；')}。请编辑配置后再测试与发布。`
                      : '能力绑定不代表执行成功。测试将真实运行，产物与交付请结合执行历史验收。'}
                </p>
                <div>
                  <button
                    type="button"
                    title="删除"
                    className="automation-center__quiet"
                    disabled={busy}
                    onClick={() => onDelete(selected)}
                    aria-label="删除选中任务"
                  >
                    <Trash2 size={16} />
                  </button>
                  <button
                    type="button"
                    className="automation-center__secondary"
                    disabled={busy || !ready}
                    onClick={() => onTest(selected)}
                    title="立即触发"
                  >
                    <Play size={15} />
                    立即测试
                  </button>
                  <button
                    type="button"
                    className={
                      selected.enabled
                        ? 'automation-center__secondary'
                        : 'automation-center__primary'
                    }
                    disabled={busy || (!selected.enabled && !ready)}
                    onClick={() => onPublish(selected)}
                    title={selected.enabled ? '停用' : '发布'}
                  >
                    {busy ? (
                      <LoaderCircle size={15} className="shell-process-spin" />
                    ) : selected.enabled ? (
                      <Pause size={15} />
                    ) : (
                      <CheckCircle2 size={15} />
                    )}
                    {selected.enabled ? '停用任务' : '发布'}
                  </button>
                </div>
              </footer>
            </article>
          ) : null}
        </main>
        <aside className="automation-center__readiness" aria-label="执行就绪栏">
          <header>
            <ShieldCheck size={34} />
            <div>
              <h2>
                {!selected
                  ? '配置就绪'
                  : waiting
                    ? '检查配置中'
                    : ready
                      ? '配置就绪'
                      : '待完成配置'}
              </h2>
              <p>
                {!selected
                  ? '选择任务，检查登记与绑定。'
                  : ready
                    ? '配置已绑定，尚未实际执行验证。'
                    : '完成所选任务的能力绑定后再执行。'}
              </p>
            </div>
          </header>
          {selected ? (
            <>
              <AutomationHandoffs
                key={`handoff-${selected.id}`}
                task={selected}
                revision={historyRevision}
                onResolved={onHandoffResolved}
              />
              <h3>配置检查</h3>
              <ul className="automation-center__checks">
                <li>
                  <FolderOpen size={17} />
                  <span>
                    工作区<small>{workspaceName(selected.workspaceId)}</small>
                  </span>
                  <em data-ready={workspaceReady(selected)}>
                    {workspaceReady(selected) ? '已配置' : '待配置'}
                  </em>
                </li>
                <li>
                  <ExecutorIcon kind={selected.target.kind} />
                  <span>执行者</span>
                  <em data-ready={executorReady(selected)}>
                    {executorReady(selected) ? '已选择' : '待配置'}
                  </em>
                </li>
                <li>
                  <ShieldCheck size={17} />
                  <span>
                    执行权限<small>仅本任务 scope</small>
                  </span>
                  <em data-ready>
                    {AUTOMATION_PERMISSION_LABELS[automationExecutionMode(selected.automation)]}
                  </em>
                </li>
                {browser ? (
                  <li>
                    <Globe size={17} />
                    <span>
                      Profile / 流程<small>{profile?.name ?? browser.profileId}</small>
                    </span>
                    <em
                      data-ready={
                        !waiting && !issues.some((issue) => /浏览器|Profile|流程/.test(issue))
                      }
                    >
                      {waiting
                        ? '检查中'
                        : issues.some((issue) => /浏览器|Profile|流程/.test(issue))
                          ? '待配置'
                          : '已绑定'}
                    </em>
                  </li>
                ) : null}
                {(selected.automation?.requiredMcpServerIds ?? [])
                  .filter((id) => id !== delivery?.mcpServerId)
                  .map((id) => {
                    const server = resources.servers.find((item) => item.mcpServerId === id);
                    const available = Boolean(
                      server?.enabled && server.trusted && server.tools.length,
                    );
                    return (
                      <li key={id}>
                        <Cpu size={17} />
                        <span>MCP · {server?.name ?? id}</span>
                        <em data-ready={available}>
                          {resources.loading ? '检查中' : available ? '已登记' : '待配置'}
                        </em>
                      </li>
                    );
                  })}
                {delivery ? (
                  <li>
                    <Mail size={17} />
                    <span>
                      Gmail MCP<small>{deliveryServer?.name ?? delivery.mcpServerId}</small>
                      <small>发件工具 · {delivery.toolName || '待明确选择'}</small>
                    </span>
                    <em data-ready={!waiting && !issues.some((issue) => /Gmail|MCP/.test(issue))}>
                      {waiting
                        ? '检查中'
                        : issues.some((issue) => /Gmail|MCP/.test(issue))
                          ? '待配置'
                          : '已绑定'}
                    </em>
                  </li>
                ) : null}
              </ul>
              {browser || delivery ? (
                <p className="automation-center__readiness-note">
                  Profile 登录、MCP 授权及产物交付尚需实际执行确认；这里只检查登记与绑定。
                </p>
              ) : null}
              <AutomationHistory
                key={selected.id}
                task={selected}
                revision={historyRevision}
                formatTime={formatTime}
                onOpenConversation={onOpenConversation}
              />
            </>
          ) : (
            <p className="automation-center__muted">这里仅展示真实任务配置与执行记录。</p>
          )}
        </aside>
      </div>
    </section>
  );
}
