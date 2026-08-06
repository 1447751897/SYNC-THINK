import * as Dialog from '@radix-ui/react-dialog';
import type {
  BrowserAutomationSource,
  BrowserAutomationTaskSummary,
  BrowserProfileSummary,
  BrowserWorkflowDraftStatus,
  BrowserWorkflowDraftSummary,
  BrowserWorkflowReviewSummary,
  BrowserWorkflowVersionSummary,
  ExecuteBrowserWorkflowResponse,
  GetBrowserWorkflowResponse,
} from '@sync-think/protocol';
import type { BrowserRecordingStepInput } from '@sync-think/shared';
import {
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  FileCheck2,
  Globe2,
  History,
  ListChecks,
  LoaderCircle,
  MousePointerClick,
  Navigation,
  PencilLine,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  TextCursorInput,
  Workflow,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';

export interface BrowserWorkflowDraftContext {
  taskId: string;
  draftId: string;
  taskName: string;
  startUrl: string;
  source: BrowserAutomationSource;
  status: BrowserWorkflowDraftStatus;
  recordingId?: string;
}

interface BrowserWorkflowPanelProps {
  profile: BrowserProfileSummary;
  refreshToken: number;
  onRecordWorkflow(context: BrowserWorkflowDraftContext): void;
}

type WorkflowFeedback = { kind: 'success' | 'error'; text: string };

export function BrowserWorkflowPanel(props: BrowserWorkflowPanelProps): JSX.Element {
  const { profile, refreshToken, onRecordWorkflow } = props;
  const [tasks, setTasks] = useState<BrowserAutomationTaskSummary[]>([]);
  const [detailsByTaskId, setDetailsByTaskId] = useState<
    Record<string, GetBrowserWorkflowResponse>
  >({});
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string>();
  const [feedback, setFeedback] = useState<WorkflowFeedback>();
  const [createSource, setCreateSource] = useState<BrowserAutomationSource>();
  const [reviewTarget, setReviewTarget] = useState<GetBrowserWorkflowResponse>();
  const [reviewNote, setReviewNote] = useState('');
  const [executeTarget, setExecuteTarget] = useState<GetBrowserWorkflowResponse>();

  const loadTasks = useCallback(
    async (nextQuery = '', preserveFeedback = false) => {
      setLoading(true);
      try {
        const response = await workflowRuntime().browserWorkflow.list({
          profileId: profile.id,
          ...(nextQuery ? { query: nextQuery } : {}),
          limit: 100,
        });
        setTasks(response.tasks);
        const detailResults = await Promise.allSettled(
          response.tasks.map((task) =>
            workflowRuntime().browserWorkflow.get({
              taskId: task.id,
            }),
          ),
        );
        const nextDetails: Record<string, GetBrowserWorkflowResponse> = {};
        detailResults.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            nextDetails[response.tasks[index]!.id] = normalizeWorkflowDetail(result.value);
          }
        });
        setDetailsByTaskId(nextDetails);
        if (!preserveFeedback) setFeedback(undefined);
      } catch (error) {
        setFeedback({ kind: 'error', text: workflowErrorMessage(error) });
      } finally {
        setLoading(false);
      }
    },
    [profile.id],
  );

  useEffect(() => {
    setQuery('');
    setAppliedQuery('');
    setReviewTarget(undefined);
    void loadTasks('', true);
  }, [loadTasks, profile.id, refreshToken]);

  const applySearch = useCallback(() => {
    const nextQuery = query.trim();
    setAppliedQuery(nextQuery);
    void loadTasks(nextQuery);
  }, [loadTasks, query]);

  const openExecute = useCallback(
    async (task: BrowserAutomationTaskSummary) => {
      setBusyAction(`task:${task.id}`);
      try {
        const detail = normalizeWorkflowDetail(
          detailsByTaskId[task.id] ??
            (await workflowRuntime().browserWorkflow.get({ taskId: task.id })),
        );
        setDetailsByTaskId((current) => ({ ...current, [task.id]: detail }));
        if (!detail.version) {
          setFeedback({
            kind: 'error',
            text: '此任务还没有可执行的已发布版本。请先录制并审核发布。',
          });
          return;
        }
        setExecuteTarget(detail);
      } catch (error) {
        setFeedback({ kind: 'error', text: workflowErrorMessage(error) });
      } finally {
        setBusyAction(undefined);
      }
    },
    [detailsByTaskId],
  );

  const openTask = useCallback(
    async (task: BrowserAutomationTaskSummary, intent: 'view' | 'record' | 'revision') => {
      setBusyAction(`task:${task.id}`);
      try {
        const detail = normalizeWorkflowDetail(
          intent === 'revision' || !detailsByTaskId[task.id]
            ? await workflowRuntime().browserWorkflow.get({ taskId: task.id })
            : detailsByTaskId[task.id]!,
        );
        setDetailsByTaskId((current) => ({ ...current, [task.id]: detail }));
        if (intent === 'revision') {
          const response = await workflowRuntime().browserWorkflow.createRevisionDraft({
            taskId: detail.task.id,
            expectedTaskRevision: detail.task.revision,
          });
          const nextDetail = normalizeWorkflowDetail({
            ...detail,
            task: response.task,
            draft: response.draft,
          });
          setTasks((current) =>
            current.map((candidate) =>
              candidate.id === response.task.id ? response.task : candidate,
            ),
          );
          setDetailsByTaskId((current) => ({ ...current, [task.id]: nextDetail }));
          onRecordWorkflow(toWorkflowDraftContext(response.task, response.draft));
          return;
        }
        if (intent === 'record') {
          if (!detail.draft) {
            setFeedback({ kind: 'error', text: '此任务当前没有可继续录制的草稿。' });
            return;
          }
          onRecordWorkflow(toWorkflowDraftContext(detail.task, detail.draft));
          return;
        }
        setReviewTarget(detail);
        setReviewNote('');
      } catch (error) {
        setFeedback({ kind: 'error', text: workflowErrorMessage(error) });
      } finally {
        setBusyAction(undefined);
      }
    },
    [detailsByTaskId, onRecordWorkflow],
  );

  const reviewDraft = useCallback(
    async (decision: 'approve' | 'reject') => {
      const draft = reviewTarget?.draft;
      if (!draft || draft.status !== 'pending_review' || busyAction) return;
      setBusyAction(`review:${decision}`);
      try {
        const response = await workflowRuntime().browserWorkflow.review({
          draftId: draft.id,
          decision,
          ...(reviewNote.trim() ? { note: reviewNote.trim() } : {}),
        });
        setFeedback({
          kind: 'success',
          text:
            decision === 'approve'
              ? `任务「${response.task.name}」已发布为 V${response.version?.versionNumber ?? 1}`
              : `任务「${response.task.name}」已驳回，可重新录制后再次提交`,
        });
        setReviewTarget(undefined);
        setReviewNote('');
        await loadTasks(appliedQuery, true);
      } catch (error) {
        setFeedback({ kind: 'error', text: workflowErrorMessage(error) });
      } finally {
        setBusyAction(undefined);
      }
    },
    [appliedQuery, busyAction, loadTasks, reviewNote, reviewTarget],
  );

  const pendingCount = useMemo(
    () => tasks.filter((task) => task.status === 'pending_review').length,
    [tasks],
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="browser-workflow-panel">
      <div className="shrink-0 border-b border-border bg-elevated px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[220px] flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint"
              size={13}
            />
            <input
              data-testid="browser-workflow-search"
              className="h-8 w-full rounded-md border border-border bg-surface pl-8 pr-2.5 text-[11.5px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
              value={query}
              placeholder="搜索任务名称、目标或网址"
              maxLength={200}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') applySearch();
              }}
            />
          </label>
          <button
            type="button"
            className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[11.5px] font-medium text-text-secondary hover:bg-hover hover:text-text disabled:opacity-45"
            disabled={loading}
            onClick={applySearch}
          >
            <Search size={13} />
            搜索
          </button>
          <button
            type="button"
            data-testid="browser-workflow-create-manual"
            className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[11.5px] font-medium text-text-secondary hover:bg-hover hover:text-text"
            onClick={() => setCreateSource('manual')}
          >
            <Plus size={13} />
            手动创建
          </button>
          <button
            type="button"
            data-testid="browser-workflow-create-ai"
            className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[11.5px] font-medium text-accent-fg hover:opacity-90"
            onClick={() => setCreateSource('ai')}
          >
            <Sparkles size={13} />让 AI 创建
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-[10.5px] text-text-faint">
          <span>
            {tasks.length} 个任务
            {appliedQuery ? ` · 搜索“${appliedQuery}”` : ''}
            {pendingCount > 0 ? ` · ${pendingCount} 个待审核` : ''}
          </span>
          <button
            type="button"
            className="flex items-center gap-1 hover:text-text-secondary disabled:opacity-45"
            disabled={loading}
            onClick={() => void loadTasks(appliedQuery)}
          >
            <RefreshCw className={clsx(loading && 'animate-spin')} size={11} />
            刷新
          </button>
        </div>
        {feedback ? (
          <div
            data-testid="browser-workflow-feedback"
            className={clsx(
              'mt-2 flex min-h-7 items-center justify-between gap-2 rounded-md border px-2.5 py-1 text-[10.5px]',
              feedback.kind === 'error'
                ? 'border-error/30 bg-error/10 text-error'
                : 'border-success/30 bg-success/10 text-success',
            )}
          >
            <span>{feedback.text}</span>
            <button
              type="button"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-hover"
              aria-label="关闭自动化任务提示"
              onClick={() => setFeedback(undefined)}
            >
              <X size={11} />
            </button>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? <WorkflowListSkeleton /> : null}
        {!loading && tasks.length === 0 ? (
          <div className="flex h-full min-h-[300px] flex-col items-center justify-center px-6 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-elevated text-text-faint">
              <Workflow size={20} />
            </div>
            <div className="mt-3 text-[13px] font-medium text-text">
              {appliedQuery ? '没有匹配的自动化任务' : '还没有自动化任务'}
            </div>
            <div className="mt-1 max-w-[390px] text-[11.5px] leading-5 text-text-faint">
              创建草稿后录制浏览器操作，确认步骤并提交审核。审核通过会发布一个不可变的工作流版本。
            </div>
            {!appliedQuery ? (
              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[11.5px] font-medium text-text-secondary hover:bg-hover hover:text-text"
                  onClick={() => setCreateSource('manual')}
                >
                  <PencilLine size={13} />
                  手动创建
                </button>
                <button
                  type="button"
                  className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[11.5px] font-medium text-accent-fg hover:opacity-90"
                  onClick={() => setCreateSource('ai')}
                >
                  <Bot size={13} />让 AI 创建
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {!loading && tasks.length > 0 ? (
          <div className="px-4 py-2" data-testid="browser-workflow-list">
            <div className="grid h-8 grid-cols-[minmax(0,1.3fr)_minmax(180px,1fr)_100px_112px_168px] items-center gap-3 border-b border-border px-2 text-[10.5px] font-medium text-text-faint">
              <span>任务</span>
              <span>目标</span>
              <span>来源</span>
              <span>状态</span>
              <span className="text-right">操作</span>
            </div>
            {tasks.map((task) => (
              <WorkflowTaskRow
                key={task.id}
                task={task}
                detail={detailsByTaskId[task.id]}
                busy={busyAction === `task:${task.id}`}
                onOpen={(intent) => void openTask(task, intent)}
                onExecute={(target) => void openExecute(target)}
              />
            ))}
          </div>
        ) : null}
      </div>

      <WorkflowCreateDialog
        profile={profile}
        source={createSource}
        onOpenChange={(open) => {
          if (!open && !busyAction) setCreateSource(undefined);
        }}
        onCreated={onRecordWorkflow}
      />

      <WorkflowReviewDialog
        detail={reviewTarget}
        note={reviewNote}
        busyAction={busyAction}
        onNoteChange={setReviewNote}
        onOpenChange={(open) => {
          if (!open && !busyAction) {
            setReviewTarget(undefined);
            setReviewNote('');
          }
        }}
        onReview={(decision) => void reviewDraft(decision)}
      />

      <WorkflowExecuteDialog
        detail={executeTarget}
        busy={Boolean(busyAction)}
        onOpenChange={(open) => {
          if (!open && !busyAction) {
            setExecuteTarget(undefined);
          }
        }}
        onResult={(feedback) => {
          setExecuteTarget(undefined);
          setFeedback(feedback);
          void loadTasks(appliedQuery, true);
        }}
      />
    </div>
  );
}

function WorkflowTaskRow(props: {
  task: BrowserAutomationTaskSummary;
  detail?: GetBrowserWorkflowResponse;
  busy: boolean;
  onOpen(intent: 'view' | 'record' | 'revision'): void;
  onExecute(task: BrowserAutomationTaskSummary): void;
}): JSX.Element {
  const { task, detail, busy, onOpen, onExecute } = props;
  const state = workflowTaskState(task, detail?.draft, detail?.version);
  const StateIcon = state.icon;
  const canRecord = task.status === 'draft' && Boolean(detail?.draft);
  const actionIntent =
    task.status === 'pending_review'
      ? 'view'
      : task.status === 'enabled'
        ? 'revision'
        : canRecord
          ? 'record'
          : 'view';
  const actionLabel =
    task.status === 'pending_review'
      ? '审核'
      : task.status === 'enabled'
        ? '录制新版本'
        : canRecord
          ? '继续录制'
          : '查看';
  return (
    <div
      data-testid={`browser-workflow-task-${task.id}`}
      className="grid min-h-[68px] grid-cols-[minmax(0,1.3fr)_minmax(180px,1fr)_100px_112px_168px] items-center gap-3 border-b border-border px-2 last:border-b-0 hover:bg-hover"
    >
      <button type="button" className="min-w-0 text-left" onClick={() => onOpen('view')}>
        <div className="truncate text-[11.5px] font-medium text-text">{task.name}</div>
        <div className="mt-1 flex min-w-0 items-center gap-1 text-[10.5px] text-text-faint">
          <Globe2 size={11} />
          <span className="truncate">{workflowHost(task.startUrl)}</span>
        </div>
      </button>
      <div className="line-clamp-2 min-w-0 text-[10.5px] leading-4 text-text-secondary">
        {task.instruction}
      </div>
      <div className="flex items-center gap-1.5 text-[10.5px] text-text-secondary">
        {task.source === 'ai' ? <Bot size={12} /> : <PencilLine size={12} />}
        {task.source === 'ai' ? 'AI 草稿' : '手动'}
      </div>
      <div className={clsx('min-w-0 text-[10.5px]', state.className)}>
        <div className="flex items-center gap-1.5">
          <StateIcon size={12} />
          <span>{state.label}</span>
        </div>
        <div className="mt-1 truncate text-[10px] text-text-faint">{state.detail}</div>
      </div>
      <div className="flex justify-end gap-1.5">
        {task.status === 'enabled' ? (
          <button
            type="button"
            data-testid={`browser-workflow-execute-${task.id}`}
            className="flex h-7 items-center gap-1 rounded-md bg-accent px-2 text-[10.5px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-45"
            disabled={busy}
            onClick={() => onExecute(task)}
          >
            {busy ? <LoaderCircle className="animate-spin" size={11} /> : <Play size={11} />}
            执行
          </button>
        ) : null}
        <button
          type="button"
          className={clsx(
            'flex h-7 items-center gap-1 rounded-md px-2 text-[10.5px] font-medium disabled:opacity-45',
            task.status === 'pending_review'
              ? 'bg-warning/15 text-warning hover:bg-warning/20'
              : task.status === 'enabled'
                ? 'border border-border bg-surface text-text-secondary hover:bg-elevated hover:text-text'
                : canRecord
                  ? 'border border-border bg-surface text-text-secondary hover:bg-elevated hover:text-text'
                  : 'text-text-secondary hover:bg-elevated hover:text-text',
          )}
          disabled={busy}
          onClick={() => onOpen(actionIntent)}
        >
          {actionLabel}
          {!busy ? <ChevronRight size={11} /> : null}
        </button>
      </div>
    </div>
  );
}

function WorkflowCreateDialog(props: {
  profile: BrowserProfileSummary;
  source?: BrowserAutomationSource;
  onOpenChange(open: boolean): void;
  onCreated(context: BrowserWorkflowDraftContext): void;
}): JSX.Element {
  const { profile, source, onOpenChange, onCreated } = props;
  const [name, setName] = useState('');
  const [instruction, setInstruction] = useState('');
  const [startUrl, setStartUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!source) return;
    setName('');
    setInstruction('');
    setStartUrl('');
    setError(undefined);
  }, [source]);

  const submit = useCallback(async () => {
    if (!source || submitting) return;
    if (!name.trim() || !instruction.trim()) {
      setError('请填写任务名称和目标说明。');
      return;
    }
    if (!isHttpUrl(startUrl.trim())) {
      setError('请输入有效的 HTTP 或 HTTPS 起始网址。');
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      const response = await workflowRuntime().browserWorkflow.createDraft({
        profileId: profile.id,
        name: name.trim(),
        instruction: instruction.trim(),
        startUrl: startUrl.trim(),
        source,
      });
      onOpenChange(false);
      onCreated({
        taskId: response.task.id,
        draftId: response.draft.id,
        taskName: response.task.name,
        startUrl: response.task.startUrl,
        source: response.task.source,
        status: response.draft.status,
        ...(response.draft.recordingId ? { recordingId: response.draft.recordingId } : {}),
      });
    } catch (cause) {
      setError(workflowErrorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  }, [instruction, name, onCreated, onOpenChange, profile.id, source, startUrl, submitting]);

  return (
    <Dialog.Root open={Boolean(source)} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(520px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-surface shadow-2xl focus:outline-none">
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <Dialog.Title className="text-[14px] font-semibold text-text">
                {source === 'ai' ? '让 AI 创建自动化任务' : '手动创建自动化任务'}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-[11.5px] leading-5 text-text-faint">
                {source === 'ai'
                  ? '创建 AI 来源草稿并进入录制工作区。浏览器动作录制完成后，仍由你审核并决定是否发布。'
                  : '定义任务目标与起始站点，然后录制一条可复用的浏览器操作流程。'}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-faint hover:bg-hover hover:text-text"
                aria-label="关闭创建任务"
              >
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>
          <div className="space-y-4 px-5 py-4">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium text-text-secondary">
                任务名称
              </span>
              <input
                data-testid="browser-workflow-name"
                className="h-9 w-full rounded-md border border-border bg-elevated px-3 text-[12px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
                value={name}
                maxLength={120}
                placeholder="例如：提交每周销售报表"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium text-text-secondary">
                目标说明
              </span>
              <textarea
                data-testid="browser-workflow-instruction"
                className="min-h-[92px] w-full resize-y rounded-md border border-border bg-elevated px-3 py-2 text-[12px] leading-5 text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
                value={instruction}
                maxLength={4000}
                placeholder="说明最终要完成什么，以及需要保留哪些关键步骤。"
                onChange={(event) => setInstruction(event.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium text-text-secondary">
                起始网址
              </span>
              <input
                data-testid="browser-workflow-start-url"
                className="h-9 w-full rounded-md border border-border bg-elevated px-3 text-[12px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
                value={startUrl}
                maxLength={2048}
                placeholder="https://example.com"
                onChange={(event) => setStartUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void submit();
                }}
              />
            </label>
            <div className="flex items-center gap-2 rounded-md border border-border bg-elevated px-3 py-2 text-[10.5px] text-text-faint">
              {source === 'ai' ? <Sparkles size={13} /> : <Radio size={13} />}
              使用 Profile「{profile.name}」，录制期间该 Profile 会被独占。
            </div>
            {error ? (
              <div
                data-testid="browser-workflow-create-error"
                className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-[11px] text-error"
              >
                {error}
              </div>
            ) : null}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            <Dialog.Close asChild>
              <button
                type="button"
                className="h-8 rounded-md border border-border px-3 text-[11.5px] font-medium text-text-secondary hover:bg-hover hover:text-text"
                disabled={submitting}
              >
                取消
              </button>
            </Dialog.Close>
            <button
              type="button"
              data-testid="browser-workflow-create-submit"
              className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[11.5px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-45"
              disabled={submitting}
              onClick={() => void submit()}
            >
              {submitting ? (
                <LoaderCircle className="animate-spin" size={13} />
              ) : source === 'ai' ? (
                <Bot size={13} />
              ) : (
                <Radio size={13} />
              )}
              创建并进入录制
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function WorkflowReviewDialog(props: {
  detail?: GetBrowserWorkflowResponse;
  note: string;
  busyAction?: string;
  onNoteChange(value: string): void;
  onOpenChange(open: boolean): void;
  onReview(decision: 'approve' | 'reject'): void;
}): JSX.Element {
  const { detail, note, busyAction, onNoteChange, onOpenChange, onReview } = props;
  const draft = detail?.draft;
  const version = detail?.version;
  const reviewing = draft?.status === 'pending_review';
  const reviews = detail?.reviews ?? [];
  const viewingUnpublishedDraft = Boolean(
    draft && (!version || draft.id !== version.draftId || draft.status !== 'approved'),
  );
  const steps = viewingUnpublishedDraft
    ? (draft?.steps ?? [])
    : (version?.steps ?? draft?.steps ?? []);
  const stepSourceLabel = reviewing
    ? version
      ? `V${version.versionNumber + 1} 待审草稿`
      : '待审核草稿'
    : viewingUnpublishedDraft
      ? version
        ? `V${version.versionNumber + 1} 编辑草稿`
        : '当前草稿'
      : '不可变发布版本';
  return (
    <Dialog.Root open={Boolean(detail)} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[min(760px,calc(100vh-32px))] w-[min(760px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-2xl focus:outline-none">
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-[14px] font-semibold text-text">
                {reviewing ? '审核自动化任务' : '自动化任务详情'}
              </Dialog.Title>
              <Dialog.Description className="mt-1 truncate text-[11.5px] text-text-faint">
                {detail?.task.name}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-faint hover:bg-hover hover:text-text"
                aria-label="关闭任务详情"
              >
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-b border-border bg-elevated px-5 py-4">
              <WorkflowMeta label="起始站点" value={detail?.task.startUrl ?? ''} />
              <WorkflowMeta
                label="来源"
                value={detail?.task.source === 'ai' ? 'AI 创建' : '手动创建'}
              />
              <WorkflowMeta label="状态" value={workflowDetailStatusLabel(detail)} />
              <WorkflowMeta label="步骤" value={`${steps.length} 步`} />
              <div className="col-span-2">
                <WorkflowMeta label="目标说明" value={detail?.task.instruction ?? ''} />
              </div>
            </div>
            <div className="px-5 py-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[11.5px] font-semibold text-text">录制步骤</h3>
                <span className="text-[10.5px] text-text-faint">{stepSourceLabel}</span>
              </div>
              {steps.length > 0 ? (
                <div className="overflow-hidden rounded-md border border-border">
                  {steps.map((step, index) => (
                    <WorkflowStepRow key={index} index={index + 1} step={step} />
                  ))}
                </div>
              ) : (
                <div className="flex min-h-[120px] items-center justify-center rounded-md border border-dashed border-border text-[11px] text-text-faint">
                  暂无可查看步骤
                </div>
              )}
              <WorkflowReviewHistory
                reviews={reviews}
                truncated={detail?.reviewsTruncated ?? false}
              />
              {reviewing ? (
                <label className="mt-4 block">
                  <span className="mb-1.5 block text-[11px] font-medium text-text-secondary">
                    审核备注（可选）
                  </span>
                  <textarea
                    data-testid="browser-workflow-review-note"
                    className="min-h-[72px] w-full resize-y rounded-md border border-border bg-elevated px-3 py-2 text-[11.5px] leading-5 text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
                    value={note}
                    maxLength={2000}
                    placeholder="驳回时可说明需要重新录制的部分。"
                    onChange={(event) => onNoteChange(event.target.value)}
                  />
                </label>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-5 py-3">
            <div className="flex items-center gap-1.5 text-[10.5px] text-text-faint">
              {version ? <ShieldCheck size={12} /> : <CircleAlert size={12} />}
              {version
                ? viewingUnpublishedDraft
                  ? `已发布 V${version.versionNumber} 保持不变，批准后才切换新版本`
                  : '发布版本不会被后续编辑覆盖'
                : reviewing
                  ? '批准后将创建新的不可变版本'
                  : '此草稿可继续录制'}
            </div>
            <div className="flex items-center gap-2">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="h-8 rounded-md border border-border px-3 text-[11.5px] font-medium text-text-secondary hover:bg-hover hover:text-text"
                  disabled={Boolean(busyAction)}
                >
                  关闭
                </button>
              </Dialog.Close>
              {reviewing ? (
                <>
                  <button
                    type="button"
                    data-testid="browser-workflow-reject"
                    className="flex h-8 items-center gap-1.5 rounded-md border border-error/40 bg-error/10 px-3 text-[11.5px] font-medium text-error hover:bg-error/15 disabled:opacity-45"
                    disabled={Boolean(busyAction)}
                    onClick={() => onReview('reject')}
                  >
                    {busyAction === 'review:reject' ? (
                      <LoaderCircle className="animate-spin" size={13} />
                    ) : (
                      <X size={13} />
                    )}
                    驳回重录
                  </button>
                  <button
                    type="button"
                    data-testid="browser-workflow-approve"
                    className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[11.5px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-45"
                    disabled={Boolean(busyAction) || steps.length === 0}
                    onClick={() => onReview('approve')}
                  >
                    {busyAction === 'review:approve' ? (
                      <LoaderCircle className="animate-spin" size={13} />
                    ) : (
                      <Check size={13} />
                    )}
                    批准并发布
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function WorkflowExecuteDialog(props: {
  detail?: GetBrowserWorkflowResponse;
  busy: boolean;
  onOpenChange(open: boolean): void;
  onResult(feedback: WorkflowFeedback): void;
}): JSX.Element {
  const { detail, busy, onOpenChange, onResult } = props;
  const version = detail?.version;
  const steps = version?.steps ?? [];
  const variables = useMemo(() => {
    const names: string[] = [];
    const seen = new Set<string>();
    for (const step of steps) {
      if (step.kind !== 'fill') continue;
      if (step.value.kind !== 'variable') continue;
      const name = step.value.name.trim();
      if (name && !seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
    return names;
  }, [steps]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ExecuteBrowserWorkflowResponse>();
  const [pendingOrigins, setPendingOrigins] = useState<string[] | undefined>();

  useEffect(() => {
    setValues({});
    setRunning(false);
    setResult(undefined);
    setPendingOrigins(undefined);
  }, [detail?.task.id, version?.id]);

  const missing = variables.filter((name) => !(values[name] ?? '').trim());
  const canStart = !running && variables.every((name) => (values[name] ?? '').trim().length > 0);
  const needsApproval = Boolean(pendingOrigins && pendingOrigins.length > 0);

  const run = useCallback(async () => {
    if (!detail || !version) return;
    setRunning(true);
    setResult(undefined);
    try {
      const response = await workflowRuntime().browserWorkflow.execute({
        taskId: detail.task.id,
        ...(variables.length > 0 ? { variables: values } : {}),
      });
      if (response.ok) {
        setResult(response);
        setPendingOrigins(undefined);
        onResult({
          kind: 'success',
          text: `任务「${detail.task.name}」执行完成（${response.executedStepCount}/${response.stepCount} 步）。`,
        });
      } else if (response.missingOrigins?.length) {
        // Keep the dialog open so the approval banner and the
        // "approve & execute" action can appear.
        setResult(undefined);
        setPendingOrigins(response.missingOrigins);
      } else if (response.missingVariables?.length) {
        // Keep the dialog open so the user can fill in the variables.
        setResult(response);
        setPendingOrigins(undefined);
      } else {
        setResult(response);
        setPendingOrigins(undefined);
        onResult({ kind: 'error', text: response.error ?? '执行失败。' });
      }
    } catch (error) {
      onResult({ kind: 'error', text: workflowErrorMessage(error) });
    } finally {
      setRunning(false);
    }
  }, [detail, version, variables, values, onResult]);

  const approveRun = useCallback(async () => {
    if (!detail || !version) return;
    if (!pendingOrigins || pendingOrigins.length === 0) return;
    setRunning(true);
    setResult(undefined);
    try {
      const response = await workflowRuntime().browserWorkflow.approveAndExecute({
        taskId: detail.task.id,
        origins: pendingOrigins,
        ...(variables.length > 0 ? { variables: values } : {}),
      });
      setResult(response);
      if (response.ok) {
        setPendingOrigins(undefined);
        onResult({
          kind: 'success',
          text: `已批准并执行：任务「${detail.task.name}」（${response.executedStepCount}/${response.stepCount} 步）。`,
        });
      } else if (response.missingVariables?.length) {
        // Keep the dialog open so the user can fill in the remaining variables.
        setPendingOrigins(undefined);
      } else {
        onResult({ kind: 'error', text: response.error ?? '执行失败。' });
      }
    } catch (error) {
      onResult({ kind: 'error', text: workflowErrorMessage(error) });
    } finally {
      setRunning(false);
    }
  }, [detail, version, variables, values, pendingOrigins, onResult]);

  return (
    <Dialog.Root open={Boolean(detail)} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[min(720px,calc(100vh-32px))] w-[min(620px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-2xl focus:outline-none">
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-[14px] font-semibold text-text">
                执行自动化任务
              </Dialog.Title>
              <Dialog.Description className="mt-1 truncate text-[11.5px] text-text-faint">
                {detail?.task.name}
                {version ? ` · V${version.versionNumber} · ${version.stepCount} 步` : ''}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-faint hover:bg-hover hover:text-text"
                aria-label="关闭执行对话框"
              >
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {variables.length > 0 ? (
              <div className="mb-4">
                <h3 className="mb-1.5 text-[11.5px] font-semibold text-text">需要填写的变量</h3>
                <p className="mb-3 text-[10.5px] leading-4 text-text-faint">
                  这些输入在录制时被标记为变量，每次执行可以填入不同值。
                </p>
                <div className="space-y-2.5">
                  {variables.map((name) => (
                    <label key={name} className="block">
                      <span className="mb-1 block text-[11px] font-medium text-text-secondary">
                        {name}
                      </span>
                      <input
                        className="h-8 w-full rounded-md border border-border bg-elevated px-3 text-[11.5px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
                        value={values[name] ?? ''}
                        placeholder={`输入 ${name} 的值`}
                        onChange={(event) =>
                          setValues((current) => ({ ...current, [name]: event.target.value }))
                        }
                      />
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mb-4 text-[11.5px] leading-5 text-text-secondary">
                该任务没有变量，将直接按录制内容逐步执行。
              </p>
            )}

            {needsApproval ? (
              <div
                data-testid="browser-workflow-approval-banner"
                className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] leading-5"
              >
                <div className="flex items-center gap-1.5 font-medium text-warning">
                  <ShieldCheck size={13} />
                  此任务需要先获得以下站点授权
                </div>
                <div className="mt-2 space-y-1">
                  {pendingOrigins?.map((origin) => (
                    <div
                      key={origin}
                      className="flex items-center gap-1.5 text-text-secondary"
                    >
                      <Globe2 size={12} className="shrink-0 text-warning" />
                      <span className="truncate">{origin}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[10.5px] leading-4 text-text-faint">
                  批准后，这些站点将记入本任务（Workflow 范围）的授权记录，后续执行无需再次批准。
                </p>
              </div>
            ) : null}

            {steps.length > 0 ? (
              <div>
                <h3 className="mb-1.5 text-[11.5px] font-semibold text-text">将执行的步骤</h3>
                <div className="overflow-hidden rounded-md border border-border">
                  {steps.map((step, index) => (
                    <WorkflowStepRow key={index} index={index + 1} step={step} />
                  ))}
                </div>
              </div>
            ) : null}

            {result ? (
              <div
                data-testid="browser-workflow-execute-result"
                className={clsx(
                  'mt-4 rounded-md border px-3 py-2 text-[11px] leading-5',
                  result.ok
                    ? 'border-success/30 bg-success/10 text-success'
                    : 'border-error/30 bg-error/10 text-error',
                )}
              >
                <div className="font-medium">
                  {result.ok
                    ? `执行完成：${result.executedStepCount}/${result.stepCount} 步`
                    : result.error ?? '执行失败'}
                </div>
                {result.steps.some((step) => !step.ok) ? (
                  <div className="mt-2 space-y-1">
                    {result.steps
                      .filter((step) => !step.ok)
                      .map((step) => (
                        <div key={step.sequence} className="text-[10.5px] opacity-90">
                          第 {step.sequence} 步：{step.error ?? '失败'}
                        </div>
                      ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-5 py-3">
            <div className="text-[10.5px] text-text-faint">
              执行会在持久浏览器页面逐步进行，请在窗口内观察。
            </div>
            <div className="flex items-center gap-2">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="h-8 rounded-md border border-border px-3 text-[11.5px] font-medium text-text-secondary hover:bg-hover hover:text-text"
                  disabled={running}
                >
                  关闭
                </button>
              </Dialog.Close>
              <button
                type="button"
                data-testid={needsApproval ? 'browser-workflow-approve-run' : 'browser-workflow-run'}
                className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[11.5px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-45"
                disabled={!canStart || busy}
                onClick={() => void (needsApproval ? approveRun() : run())}
              >
                {running ? (
                  <LoaderCircle className="animate-spin" size={13} />
                ) : needsApproval ? (
                  <ShieldCheck size={13} />
                ) : (
                  <Play size={13} />
                )}
                {running
                  ? '执行中…'
                  : needsApproval
                    ? '批准并执行'
                    : missing.length > 0
                      ? `需填 ${missing.length} 个变量`
                      : '开始执行'}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function WorkflowStepRow(props: { index: number; step: BrowserRecordingStepInput }): JSX.Element {
  const presentation = workflowStepPresentation(props.step);
  const Icon = presentation.icon;
  return (
    <div className="grid min-h-[52px] grid-cols-[32px_96px_minmax(0,1fr)] items-center gap-3 border-b border-border px-3 last:border-b-0">
      <span className="text-[10.5px] tabular-nums text-text-faint">{props.index}</span>
      <div className="flex items-center gap-2 text-[11px] font-medium text-text">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-elevated text-text-secondary">
          <Icon size={13} />
        </span>
        {presentation.label}
      </div>
      <div className="min-w-0 truncate text-[10.5px] text-text-secondary">
        {presentation.detail}
      </div>
    </div>
  );
}

function WorkflowReviewHistory(props: {
  reviews: BrowserWorkflowReviewSummary[];
  truncated: boolean;
}): JSX.Element {
  return (
    <section className="mt-4 border-t border-border pt-4" aria-label="审核历史">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-[11.5px] font-semibold text-text">
          <History size={13} />
          审核历史
        </h3>
        {props.truncated ? (
          <span className="text-[10px] text-text-faint">仅显示最近 100 条审核记录</span>
        ) : null}
      </div>
      {props.reviews.length > 0 ? (
        <div className="overflow-hidden rounded-md border border-border">
          {props.reviews.map((review, index) => (
            <div
              key={review.id}
              className="grid min-h-[48px] grid-cols-[minmax(112px,auto)_minmax(0,1fr)_auto] items-start gap-3 border-b border-border px-3 py-2 last:border-b-0"
            >
              <div
                className={clsx(
                  'flex items-center gap-1.5 text-[10.5px] font-medium',
                  review.decision === 'approve' ? 'text-success' : 'text-error',
                )}
              >
                {review.decision === 'approve' ? <Check size={12} /> : <X size={12} />}第{' '}
                {index + 1} 次 · {review.decision === 'approve' ? '批准' : '驳回'}
              </div>
              <div className="min-w-0 whitespace-pre-wrap break-words text-[10.5px] leading-4 text-text-secondary">
                {review.note ?? '未填写审核备注'}
              </div>
              <time className="whitespace-nowrap text-[10px] text-text-faint">
                {formatWorkflowReviewTime(review.createdAt)}
              </time>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex min-h-12 items-center justify-center rounded-md border border-dashed border-border text-[10.5px] text-text-faint">
          暂无审核记录
        </div>
      )}
    </section>
  );
}

function WorkflowMeta(props: { label: string; value: string }): JSX.Element {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-medium text-text-faint">{props.label}</div>
      <div className="mt-1 break-words text-[11.5px] leading-5 text-text-secondary">
        {props.value}
      </div>
    </div>
  );
}

function WorkflowListSkeleton(): JSX.Element {
  return (
    <div className="space-y-2 px-6 py-4" aria-label="正在加载自动化任务">
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="h-[68px] animate-pulse rounded-md bg-hover" />
      ))}
    </div>
  );
}

function workflowTaskState(
  task: BrowserAutomationTaskSummary,
  draft?: BrowserWorkflowDraftSummary,
  version?: BrowserWorkflowVersionSummary,
): {
  label: string;
  detail: string;
  className: string;
  icon: typeof Radio;
} {
  if (task.status === 'pending_review') {
    return {
      label: '待审核',
      detail: version
        ? `V${version.versionNumber + 1} 候选 · ${draft?.stepCount ?? 0} 步`
        : `${draft?.stepCount ?? 0} 步`,
      className: 'text-warning',
      icon: CircleAlert,
    };
  }
  if (task.status === 'enabled') {
    return {
      label: '已发布',
      detail: `V${version?.versionNumber ?? 1} · ${version?.stepCount ?? 0} 步`,
      className: 'text-success',
      icon: FileCheck2,
    };
  }
  if (task.status === 'disabled') {
    return {
      label: '已停用',
      detail: version ? `V${version.versionNumber}` : '没有发布版本',
      className: 'text-text-faint',
      icon: CircleAlert,
    };
  }
  if (task.status === 'failed') {
    return {
      label: '运行失败',
      detail: `${task.failureCount} 次失败`,
      className: 'text-error',
      icon: CircleAlert,
    };
  }
  if (draft?.status === 'rejected') {
    return {
      label: '已驳回',
      detail: version ? `V${version.versionNumber + 1} 等待重新录制` : '等待重新录制',
      className: 'text-error',
      icon: RefreshCw,
    };
  }
  return {
    label: version ? '新版本草稿' : '草稿',
    detail: version
      ? `基于 V${version.versionNumber} · ${draft?.stepCount ?? 0} 步`
      : `${draft?.stepCount ?? 0} 步`,
    className: 'text-text-secondary',
    icon: PencilLine,
  };
}

function workflowStepPresentation(step: BrowserRecordingStepInput): {
  label: string;
  detail: string;
  icon: typeof Navigation;
} {
  if (step.kind === 'navigate') {
    return { label: '打开页面', detail: boundedText(step.url), icon: Navigation };
  }
  const locator =
    step.locator.strategy === 'role'
      ? step.locator.name
        ? `${step.locator.role} · ${step.locator.name}`
        : step.locator.role
      : step.locator.value;
  if (step.kind === 'click') {
    return { label: '点击', detail: boundedText(locator), icon: MousePointerClick };
  }
  if (step.kind === 'fill') {
    return {
      label: '填写',
      detail: `${boundedText(locator)} · ${recordingValueLabel(step.value)}`,
      icon: TextCursorInput,
    };
  }
  if (step.kind === 'select') {
    return {
      label: '选择',
      detail: `${boundedText(locator)} · ${recordingValueLabel(step.value)}`,
      icon: ListChecks,
    };
  }
  if (step.kind === 'check') {
    return {
      label: step.checked ? '勾选' : '取消勾选',
      detail: boundedText(locator),
      icon: Check,
    };
  }
  return { label: '按下 Enter', detail: boundedText(locator), icon: Navigation };
}

function workflowDraftStatusLabel(status?: BrowserWorkflowDraftSummary['status']): string {
  if (status === 'pending_review') return '待审核';
  if (status === 'approved') return '已批准';
  if (status === 'rejected') return '已驳回';
  return '编辑中';
}

function recordingValueLabel(
  value: Extract<BrowserRecordingStepInput, { kind: 'fill' | 'select' }>['value'],
): string {
  if (value.kind === 'secret') return '敏感值，运行时填写';
  if (value.kind === 'variable') return `变量 {{${value.name}}}`;
  return boundedText(value.value);
}

function workflowDetailStatusLabel(detail?: GetBrowserWorkflowResponse): string {
  if (!detail) return '';
  const { task, draft, version } = detail;
  if (task.status === 'pending_review') {
    return version ? `待审核 · 已发布 V${version.versionNumber}` : '待审核';
  }
  if (task.status === 'draft') {
    const draftStatus = workflowDraftStatusLabel(draft?.status);
    return version ? `${draftStatus} · 已发布 V${version.versionNumber}` : draftStatus;
  }
  if (task.status === 'enabled') {
    return version ? `已发布 · V${version.versionNumber}` : '已发布';
  }
  if (task.status === 'disabled') {
    return version ? `已停用 · V${version.versionNumber}` : '已停用';
  }
  return version ? `运行失败 · V${version.versionNumber}` : '运行失败';
}

function normalizeWorkflowDetail(detail: GetBrowserWorkflowResponse): GetBrowserWorkflowResponse {
  return {
    ...detail,
    reviews: detail.reviews ?? [],
    reviewsTruncated: detail.reviewsTruncated ?? false,
  };
}

function toWorkflowDraftContext(
  task: BrowserAutomationTaskSummary,
  draft: BrowserWorkflowDraftSummary,
): BrowserWorkflowDraftContext {
  return {
    taskId: task.id,
    draftId: draft.id,
    taskName: task.name,
    startUrl: task.startUrl,
    source: task.source,
    status: draft.status,
    ...(draft.recordingId ? { recordingId: draft.recordingId } : {}),
  };
}

function formatWorkflowReviewTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function workflowHost(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

function boundedText(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function workflowRuntime(): NonNullable<typeof window.syncThink>['runtime'] {
  if (!window.syncThink?.runtime) throw new Error('Runtime bridge unavailable');
  return window.syncThink.runtime;
}

function workflowErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/workflow-not-found|not[-_. ]found/i.test(message)) {
    return '自动化任务或草稿已不存在，请刷新后重试。';
  }
  if (/workflow-conflict|state[-_. ]conflict|not[-_. ]stopped/i.test(message)) {
    return '当前任务状态不允许此操作，请确认录制已停止且包含有效步骤。';
  }
  if (/request timed out: browser\.workflow/i.test(message)) {
    return '自动化任务请求超时，请确认 Runtime 正常后重试。';
  }
  return message || '自动化任务操作失败，请重试。';
}
