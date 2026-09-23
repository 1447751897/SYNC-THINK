import * as Dialog from '@radix-ui/react-dialog';
import { BrowserTaskInfo } from './BrowserTaskInfo.js';
import { useBrowserTaskExecution } from './useBrowserTaskExecution.js';
import { getOwnedBrowserWebview } from './browser-commands.js';
import type {
  BrowserAutomationTaskSummary,
  BrowserProfileSummary,
  BrowserWorkflowLivePage,
} from '@sync-think/protocol';
import { Bot, Circle, Globe2, LoaderCircle, Maximize2, Play, Radio, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  WorkflowCreateDialog,
  type BrowserWorkflowAiTaskRequest,
  type BrowserWorkflowDraftContext,
} from './BrowserWorkflowPanel.js';

export interface BrowserTaskDashboardProps {
  workspaces?: Array<{ workspaceId: string; name: string }>;
  activeWorkspaceId?: string;
  active?: boolean;
  onStartAiTask?(request: BrowserWorkflowAiTaskRequest): void;
}

type RecordingContext = BrowserWorkflowDraftContext & { profileId: string };

export function BrowserTaskDashboard(
  props: BrowserTaskDashboardProps & {
    renderManager(context: RecordingContext | undefined, onBack: () => void): ReactNode;
  },
): JSX.Element {
  const [tasks, setTasks] = useState<BrowserAutomationTaskSummary[]>([]);
  const [profiles, setProfiles] = useState<BrowserProfileSummary[]>([]);
  const [pages, setPages] = useState<BrowserWorkflowLivePage[]>([]);
  const [workspace, setWorkspace] = useState('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [selectedTask, setSelectedTask] = useState<BrowserAutomationTaskSummary>();
  const [expandedRun, setExpandedRun] = useState<string>();
  const [manager, setManager] = useState(false);
  const [recording, setRecording] = useState<RecordingContext>();
  const [createSource, setCreateSource] = useState<'manual' | 'ai'>();
  const [createProfileId, setCreateProfileId] = useState('');
  const [createWorkspaceId, setCreateWorkspaceId] = useState(props.activeWorkspaceId ?? '');
  const execution = useBrowserTaskExecution(() => setRefresh((value) => value + 1));
  const workspaces = props.workspaces ?? [];
  const workspaceName = (id?: string) =>
    workspaces.find((item) => item.workspaceId === id)?.name ??
    (id ? '其他工作区' : '未分配工作区');

  useEffect(() => {
    if (props.active === false || manager) return;
    let disposed = false;
    let polling = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (disposed || polling || document.visibilityState === 'hidden') return;
      polling = true;
      try {
        const response = await window.syncThink!.runtime.browserWorkflow.list({
          limit: 100,
          includeLive: true,
        });
        if (disposed) return;
        setTasks(response.tasks);
        const nextPages = await Promise.all(
          (response.livePages ?? []).map(async (page) => {
            if (!page.embedded || !page.ownerId) return page;
            const guest = getOwnedBrowserWebview(page.ownerId);
            try {
              if (!guest) throw new Error('Page not ready');
              return {
                ...page,
                ...(await window.syncThink!.runtime.captureBrowserPreview({
                  webContentsId: guest.getWebContentsId(),
                })),
              };
            } catch {
              return { ...page, previewError: '正在连接 AI 执行页面' };
            }
          }),
        );
        if (disposed) return;
        setPages((previous) =>
          nextPages.map((page) => {
            const last = previous.find((item) => item.runId === page.runId);
            return page.previewError && last?.imageDataUrl
              ? { ...page, imageDataUrl: last.imageDataUrl, capturedAt: last.capturedAt }
              : page;
          }),
        );
        setError('');
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : '任务列表加载失败');
      } finally {
        polling = false;
        if (!disposed) {
          setLoading(false);
          timer = setTimeout(() => void poll(), 2_000);
        }
      }
    };
    const visibility = () => {
      if (document.visibilityState === 'visible') {
        if (timer) clearTimeout(timer);
        void poll();
      }
    };
    void poll();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [props.active, manager, refresh]);

  useEffect(() => {
    let disposed = false;
    void window
      .syncThink!.runtime.listBrowserProfiles()
      .then((response) => {
        if (disposed) return;
        setProfiles(response.profiles);
        setCreateProfileId((current) =>
          response.profiles.some((profile) => profile.id === current)
            ? current
            : (response.profiles.find((profile) => profile.isDefault)?.id ??
              response.profiles[0]?.id ??
              ''),
        );
      })
      .catch((cause) => {
        if (!disposed) setError(String(cause));
      });
    return () => {
      disposed = true;
    };
  }, [manager, refresh]);

  const taskItems = useMemo(() => {
    const items: Array<
      Pick<
        BrowserAutomationTaskSummary,
        'id' | 'profileId' | 'name' | 'instruction' | 'startUrl' | 'workspaceId' | 'status'
      > & { liveRunId?: string }
    > = [...tasks];
    for (const page of pages) {
      if (items.some((item) => item.id === page.taskId)) continue;
      items.unshift({
        id: page.taskId,
        profileId: page.profileId,
        name: page.name,
        instruction: 'AI 正在操作浏览器',
        startUrl: page.url ?? '',
        workspaceId: page.workspaceId,
        status: 'enabled',
        liveRunId: page.runId,
      });
    }
    return items;
  }, [tasks, pages]);
  const visibleTasks = useMemo(
    () =>
      taskItems.filter(
        (task) =>
          task.profileId === createProfileId &&
          (workspace === 'all' ||
            (workspace === 'unassigned' ? !task.workspaceId : task.workspaceId === workspace)) &&
          `${task.name} ${task.instruction} ${task.startUrl}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
      ),
    [taskItems, workspace, query, createProfileId],
  );
  const expanded = pages.find((page) => page.runId === expandedRun);
  const selectedProfile = profiles.find((profile) => profile.id === selectedTask?.profileId);
  const createProfile = profiles.find((profile) => profile.id === createProfileId);
  const startCreate = (source: 'manual' | 'ai') => {
    setCreateWorkspaceId(
      workspace !== 'all' && workspace !== 'unassigned'
        ? workspace
        : (props.activeWorkspaceId ?? ''),
    );
    setCreateSource(source);
  };
  const record = (profileId: string, context: BrowserWorkflowDraftContext) => {
    setSelectedTask(undefined);
    setRecording({ ...context, profileId });
    setManager(true);
  };

  if (manager)
    return (
      <>
        {props.renderManager(recording, () => {
          setManager(false);
          setRecording(undefined);
          setRefresh((value) => value + 1);
        })}
      </>
    );

  return (
    <div className="browser-dashboard" data-testid="browser-stage">
      <header className="browser-dashboard__chrome">
        <div>
          <Globe2 size={16} />
          <span>浏览器</span>
        </div>
        <label>
          浏览器环境
          <select
            aria-label="浏览器环境 Profile"
            value={createProfileId}
            disabled={!profiles.length}
            onChange={(event) => {
              setCreateProfileId(event.target.value);
              setSelectedTask(undefined);
            }}
          >
            {!profiles.length ? (
              <option value="">正在加载…</option>
            ) : (
              profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))
            )}
          </select>
        </label>
      </header>
      <div className="browser-dashboard__body">
        <aside className="browser-dashboard__tasks">
          <header className="browser-dashboard__task-header">
            <div className="browser-dashboard__heading">
              <h1>浏览器任务</h1>
              <span>{visibleTasks.length}</span>
            </div>
            <select
              aria-label="筛选工作区"
              value={workspace}
              onChange={(event) => {
                setWorkspace(event.target.value);
                setSelectedTask(undefined);
              }}
            >
              <option value="all">全部工作区</option>
              {workspaces.map((item) => (
                <option key={item.workspaceId} value={item.workspaceId}>
                  {item.name}
                </option>
              ))}
              <option value="unassigned">未分配工作区</option>
            </select>
            <label className="browser-dashboard__search">
              <Search size={14} />
              <input
                aria-label="搜索浏览器任务"
                placeholder="搜索任务或网址"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </header>
          <div className="browser-dashboard__task-list" aria-label="浏览器任务列表">
            {loading ? (
              <div className="browser-dashboard__empty">
                <LoaderCircle className="animate-spin" size={18} />
                正在加载任务
              </div>
            ) : null}
            {!loading && visibleTasks.length === 0 ? (
              <div className="browser-dashboard__empty">
                {query ? '没有匹配的任务' : '此范围暂无任务'}
              </div>
            ) : null}
            {visibleTasks.map((task) => {
              const running =
                pages.some((page) => page.taskId === task.id) ||
                execution.pending.includes(task.id);
              return (
                <div
                  className={`browser-dashboard__task${selectedTask?.id === task.id ? ' is-selected' : ''}`}
                  key={task.id}
                >
                  <button
                    className="browser-dashboard__task-main"
                    aria-label={`查看 ${task.name} 的信息`}
                    onClick={() =>
                      task.liveRunId
                        ? setExpandedRun(task.liveRunId)
                        : setSelectedTask(tasks.find((item) => item.id === task.id))
                    }
                  >
                    <div className="browser-dashboard__task-title">
                      <span className={running ? 'is-running' : ''}>
                        <Circle size={7} fill="currentColor" />
                      </span>
                      <strong>{task.name}</strong>
                    </div>
                    <p>{task.startUrl}</p>
                    <div className="browser-dashboard__task-meta">
                      <span>{workspaceName(task.workspaceId)}</span>
                    </div>
                  </button>
                  <button
                    className="browser-dashboard__run"
                    aria-label={`${running ? '正在执行' : '立即执行'} ${task.name}`}
                    disabled={running}
                    onClick={() => void execution.execute(task.id)}
                  >
                    {running ? (
                      <LoaderCircle size={12} className="animate-spin" />
                    ) : (
                      <Play size={12} />
                    )}
                    {running ? '执行中' : '立即执行'}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="browser-dashboard__create">
            <button onClick={() => startCreate('ai')} disabled={!createProfile}>
              <Bot size={14} />让 AI 创建任务
            </button>
          </div>
        </aside>
        <main className="browser-dashboard__monitor">
          <header className="browser-dashboard__monitor-header">
            <div>
              <div className="browser-dashboard__heading">
                <Radio size={17} />
                <h2>正在执行</h2>
                <span>{pages.length}</span>
              </div>
              <p>所有浏览器环境 · 点击画面放大查看</p>
            </div>
            <span className="browser-dashboard__live-label">
              <i className={error ? 'is-stale' : ''} />
              {error ? '连接中断' : '实时预览'}
            </span>
          </header>
          {error ? (
            <div className="browser-dashboard__error" role="alert">
              刷新失败，当前画面可能已过期。{error}
              <button onClick={() => setRefresh((value) => value + 1)}>重试</button>
            </div>
          ) : null}
          {execution.notice ? (
            <div className="browser-dashboard__error" role="alert">
              {execution.notice}
              <button aria-label="关闭执行提示" onClick={execution.clearNotice}>
                <X size={12} />
              </button>
            </div>
          ) : null}
          <div className="browser-dashboard__monitor-body">
            {!pages.length ? (
              <div className="browser-dashboard__idle">
                <div>
                  <Globe2 size={28} />
                </div>
                <h3>{loading ? '正在连接浏览器任务' : '等待任务开始'}</h3>
                <p>
                  运行任务后，执行页面会自动出现在这里。
                  <br />
                  多个浏览器可以同时查看。
                </p>
              </div>
            ) : (
              <div className="browser-dashboard__grid">
                {pages.map((page) => (
                  <button
                    className="browser-dashboard__tile"
                    key={page.runId}
                    aria-label={`放大 ${page.name}`}
                    onClick={() => setExpandedRun(page.runId)}
                  >
                    <div className="browser-dashboard__tile-bar">
                      <Globe2 size={13} />
                      <span>{page.name}</span>
                      <Maximize2 size={14} />
                    </div>
                    <Preview page={page} />
                    <div className="browser-dashboard__tile-footer">
                      <div>
                        <strong>
                          {profiles.find((profile) => profile.id === page.profileId)?.name ??
                            '浏览器'}
                        </strong>
                        <span>{page.url || '正在打开页面'}</span>
                      </div>
                      <span className="is-running">
                        {page.currentStep
                          ? page.stepCount
                            ? `${page.currentStep} / ${page.stepCount} 步`
                            : `第 ${page.currentStep} 步`
                          : '准备中'}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </main>
        {selectedTask ? (
          <BrowserTaskInfo
            key={selectedTask.id}
            task={selectedTask}
            profileName={selectedProfile?.name ?? '浏览器'}
            workspaceName={workspaceName(selectedTask.workspaceId)}
            onClose={() => setSelectedTask(undefined)}
          />
        ) : null}
      </div>
      {execution.dialog}
      <Dialog.Root
        open={Boolean(expandedRun)}
        onOpenChange={(open) => {
          if (!open) setExpandedRun(undefined);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="browser-workflow-dialog__overlay" />
          <Dialog.Content className="browser-dashboard__expanded">
            <header>
              <div>
                <Dialog.Title>{expanded?.name ?? '任务已结束'}</Dialog.Title>
                <Dialog.Description>
                  {expanded
                    ? `${workspaceName(expanded.workspaceId)} · 第 ${expanded.currentStep}${expanded.stepCount ? ` / ${expanded.stepCount}` : ''} 步`
                    : '当前执行已结束。'}
                </Dialog.Description>
              </div>
              <Dialog.Close aria-label="关闭放大预览">
                <X size={18} />
              </Dialog.Close>
            </header>
            {expanded ? (
              <Preview page={expanded} />
            ) : (
              <div className="browser-dashboard__empty">浏览器已退出运行区</div>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {createProfile ? (
        <WorkflowCreateDialog
          contextControls={
            <div className="browser-dashboard__create-context">
              <label>
                所属工作区
                <select
                  aria-label="新任务所属工作区"
                  value={createWorkspaceId}
                  onChange={(event) => setCreateWorkspaceId(event.target.value)}
                >
                  <option value="">未分配工作区</option>
                  {workspaces.map((item) => (
                    <option key={item.workspaceId} value={item.workspaceId}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="browser-dashboard__create-profile">
                浏览器环境<strong>{createProfile.name}</strong>
              </div>
            </div>
          }
          profile={createProfile}
          workspaceId={createWorkspaceId || undefined}
          source={createSource}
          onOpenChange={(open) => {
            if (!open) setCreateSource(undefined);
          }}
          onAiRequested={props.onStartAiTask}
          onCreated={(context) => record(createProfile.id, context)}
        />
      ) : null}
    </div>
  );
}

function Preview({ page }: { page: BrowserWorkflowLivePage }): JSX.Element {
  return (
    <div className="browser-dashboard__preview">
      {page.imageDataUrl ? (
        <img src={page.imageDataUrl} alt={`${page.name} 执行页面`} />
      ) : (
        <div className="browser-dashboard__empty">
          <LoaderCircle size={18} className="animate-spin" />
          <span>{page.previewError || '正在连接执行页面'}</span>
        </div>
      )}
      {page.imageDataUrl && page.previewError ? (
        <span className="browser-dashboard__preview-note">{page.previewError}</span>
      ) : null}
    </div>
  );
}
