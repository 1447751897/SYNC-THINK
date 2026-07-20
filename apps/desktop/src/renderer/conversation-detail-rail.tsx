import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock3,
  FileCode2,
  FileImage,
  FileJson2,
  FileText,
  Files,
  LoaderCircle,
  Globe2,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type { AgentPermissions, ApprovalMode } from '@sync-think/shared';
import type {
  ConversationLogEvent,
  ConversationLogStage,
  ConversationLogState,
  ConversationLogTurn,
} from './conversation-log-projection.js';

export type TaskProgressState = ConversationLogState | 'not-started';

export interface TaskProgressSummary {
  runId?: string;
  state: TaskProgressState;
  completedSteps: number;
  totalSteps: number;
  durationMs?: number;
}

export interface TaskProgressStep {
  id: string;
  title: string;
  state: TaskProgressState;
  agentName?: string;
}

export interface TaskProgressParticipant {
  id: string;
  name: string;
  role?: string;
  responsibility?: string;
  modelLabel?: string;
  state: TaskProgressState;
  color?: string;
  avatarUrl?: string;
}

export interface TaskProgressChildTask {
  taskId: string;
  title: string;
  status: TaskProgressState;
  summary?: string;
  assignee?: string;
  integrationStatus?: 'clean' | 'pending-integration' | 'integrated' | 'conflicted' | 'kept-parent';
  conflictFiles?: readonly string[];
}

export interface TaskExecutionAccessDetails {
  approvalMode: ApprovalMode;
  executionMode: 'none' | 'local_serial' | 'managed_worktree';
  executionState: string;
  executionPath?: string;
  baseRef?: string;
  browserIdentityName?: string;
  effectiveToolNames: readonly string[];
  capabilityCeiling: AgentPermissions;
}

export interface TaskBrowserIdentityOption {
  id: string;
  name: string;
  isDefault?: boolean;
}

export interface TaskArtifactDirectoryItem {
  id: string;
  name: string;
  mimeType: string;
  latestVersion?: number;
  selectedVersion?: number;
  producerName?: string;
  modelLabel?: string;
  createdAt?: string;
  state?: 'ready' | 'conflict' | 'failed' | 'pending';
}

const STATE_LABELS: Record<TaskProgressState, string> = {
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  paused: '已暂停',
  cancelled: '已取消',
  waiting: '等待中',
  unknown: '未记录',
  'not-started': '尚未开始',
};

function stateLabel(state: TaskProgressState): string {
  return STATE_LABELS[state] ?? state;
}

function executionModeLabel(mode: TaskExecutionAccessDetails['executionMode']): string {
  if (mode === 'managed_worktree') return '本地 · 独立任务副本';
  if (mode === 'local_serial') return '本地 · 项目目录';
  return '仅对话';
}

function executionBaseLabel(baseRef?: string): string | undefined {
  if (!baseRef) return undefined;
  return baseRef === 'HEAD' ? '创建任务时的当前版本' : baseRef;
}

export function TaskAccessEnvironment(props: {
  details: TaskExecutionAccessDetails;
  permissionMode: ApprovalMode;
  permissionBusy?: boolean | undefined;
  onPermissionModeChange?: ((mode: ApprovalMode) => void | Promise<void>) | undefined;
  browserIdentities?: readonly TaskBrowserIdentityOption[] | undefined;
  selectedBrowserIdentityId?: string | null | undefined;
  browserIdentityBusy?: boolean | undefined;
  onBrowserIdentityChange?: ((identityId: string) => void | Promise<void>) | undefined;
  onManageBrowserIdentities?: (() => void) | undefined;
}) {
  return (
    <details className="st-task-access">
      <summary id="rail-task-access">
        <span><SlidersHorizontal aria-hidden="true" size={13} />运行设置</span>
        <small>{executionModeLabel(props.details.executionMode)}</small>
      </summary>
      <div className="st-task-access__controls" aria-labelledby="rail-task-access">
        <label>
          <span><ShieldCheck aria-hidden="true" size={13} />操作权限</span>
          <select
            aria-label="当前任务操作权限"
            value={props.permissionMode}
            disabled={props.permissionBusy}
            onChange={(event) => void props.onPermissionModeChange?.(event.target.value as ApprovalMode)}
          >
            <option value="request">请求批准</option>
            <option value="delegate">替我审批</option>
            <option value="full">完全访问</option>
            <option value="custom">自定义</option>
          </select>
        </label>
        <label>
            <span><Globe2 aria-hidden="true" size={13} />浏览器身份</span>
            <span className="st-task-access__select-row">
              <select
                aria-label="当前任务浏览器身份"
                value={props.selectedBrowserIdentityId ?? props.browserIdentities?.[0]?.id ?? ''}
                disabled={props.browserIdentityBusy || !props.browserIdentities?.length}
                onChange={(event) => void props.onBrowserIdentityChange?.(event.target.value)}
              >
                {!props.browserIdentities?.length ? <option value="">未配置</option> : null}
                {(props.browserIdentities ?? []).map((identity) => (
                  <option key={identity.id} value={identity.id}>
                    {identity.name}{identity.isDefault ? '（默认）' : ''}
                  </option>
                ))}
              </select>
              {props.onManageBrowserIdentities ? (
                <button type="button" aria-label="管理浏览器身份" title="管理浏览器身份" onClick={props.onManageBrowserIdentities}>
                  <Settings2 aria-hidden="true" size={13} />
                </button>
              ) : null}
            </span>
          </label>
      </div>
      <dl className="st-task-access__facts">
        <div><dt>环境</dt><dd>{executionModeLabel(props.details.executionMode)}</dd></div>
        {executionBaseLabel(props.details.baseRef) ? (
          <div><dt>来源</dt><dd>{executionBaseLabel(props.details.baseRef)}</dd></div>
        ) : null}
      </dl>
    </details>
  );
}

export function formatRailDuration(value?: number): string {
  if (value === undefined || !Number.isFinite(value) || value < 0) return '--';
  const totalSeconds = Math.floor(value / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatRailTime(value?: string): string {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function StateGlyph(props: { state: TaskProgressState; size?: number }) {
  const size = props.size ?? 13;
  if (props.state === 'completed') return <CheckCircle2 aria-hidden="true" size={size} />;
  if (props.state === 'running') {
    return <LoaderCircle aria-hidden="true" className="st-rail-spin" size={size} />;
  }
  if (props.state === 'failed') return <AlertCircle aria-hidden="true" size={size} />;
  return <Circle aria-hidden="true" size={size} />;
}

export function ConversationTaskProgress(props: {
  projectName?: string;
  ownerLabel?: string;
  summary: TaskProgressSummary;
  steps: readonly TaskProgressStep[];
  participants: readonly TaskProgressParticipant[];
  childTasks?: readonly TaskProgressChildTask[];
  onOpenTask?: (taskId: string) => void;
  onResolveChildIntegration?: (
    taskId: string,
    strategy: 'accept-child' | 'keep-parent',
  ) => void;
  integrationBusyTaskId?: string | null;
  accessDetails?: TaskExecutionAccessDetails | null;
  permissionMode?: ApprovalMode;
  permissionBusy?: boolean | undefined;
  onPermissionModeChange?: ((mode: ApprovalMode) => void | Promise<void>) | undefined;
  browserIdentities?: readonly TaskBrowserIdentityOption[] | undefined;
  selectedBrowserIdentityId?: string | null | undefined;
  browserIdentityBusy?: boolean | undefined;
  onBrowserIdentityChange?: ((identityId: string) => void | Promise<void>) | undefined;
  onManageBrowserIdentities?: (() => void) | undefined;
}) {
  const [childrenOpen, setChildrenOpen] = useState(true);
  const ownerLabel =
    props.ownerLabel ?? (props.participants.map((participant) => participant.name).join('、') || '--');
  return (
    <div className="st-conversation-progress" data-state={props.summary.state}>
      <section className="st-conversation-progress__properties" aria-labelledby="rail-properties">
        <h3 id="rail-properties">属性</h3>
        <dl>
          <div>
            <dt>状态</dt>
            <dd data-state={props.summary.state}>
              <StateGlyph state={props.summary.state} />
              {stateLabel(props.summary.state)}
            </dd>
          </div>
          <div><dt>负责人</dt><dd>{ownerLabel}</dd></div>
          <div><dt>项目</dt><dd>{props.projectName ?? '--'}</dd></div>
        </dl>
      </section>
      <dl className="st-conversation-progress__summary" aria-label="本轮摘要">
        <div>
          <dt>本轮进度</dt>
          <dd>
            {props.summary.completedSteps} / {props.summary.totalSteps}
          </dd>
        </div>
        <div>
          <dt>已用时</dt>
          <dd>{formatRailDuration(props.summary.durationMs)}</dd>
        </div>
      </dl>

      {props.accessDetails && props.permissionMode ? (
        <TaskAccessEnvironment
          details={props.accessDetails}
          permissionMode={props.permissionMode}
          permissionBusy={props.permissionBusy}
          onPermissionModeChange={props.onPermissionModeChange}
          browserIdentities={props.browserIdentities}
          selectedBrowserIdentityId={props.selectedBrowserIdentityId}
          browserIdentityBusy={props.browserIdentityBusy}
          onBrowserIdentityChange={props.onBrowserIdentityChange}
          onManageBrowserIdentities={props.onManageBrowserIdentities}
        />
      ) : null}

      <section className="st-conversation-progress__steps" aria-labelledby="rail-progress-steps">
        <h3 id="rail-progress-steps">本轮任务</h3>
        {props.steps.length > 0 ? (
          <ol>
            {props.steps.map((step, index) => (
              <li
                key={step.id}
                data-state={step.state}
                title={step.agentName}
                aria-label={`${index + 1}. ${step.title} · ${stateLabel(step.state)}${step.agentName ? ` · ${step.agentName}` : ''}`}
              >
                <span className="st-conversation-progress__number">{index + 1}</span>
                <StateGlyph state={step.state} />
                <span>
                  <strong>{step.title}</strong>
                  {step.agentName ? <small>{step.agentName}</small> : null}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="st-conversation-rail-empty">主智能体分配工作后，会在这里显示本轮任务。</p>
        )}
      </section>

      {props.participants.length > 0 ? (
        <section
          className="st-conversation-progress__participants"
          aria-labelledby="rail-progress-participants"
        >
          <h3 id="rail-progress-participants">参与智能体</h3>
          <ul>
            {props.participants.map((participant) => (
              <li
                key={participant.id}
                data-state={participant.state}
                aria-label={`${participant.name} · ${stateLabel(participant.state)}${participant.modelLabel ? ` · ${participant.modelLabel}` : ''}`}
              >
                <span
                  className="st-conversation-progress__avatar"
                  style={{ ['--st-agent-color' as string]: participant.color ?? '#64748b' }}
                >
                  {participant.avatarUrl ? (
                    <img src={participant.avatarUrl} alt="" />
                  ) : (
                    <Bot aria-hidden="true" size={14} />
                  )}
                </span>
                <span>
                  <strong title={participant.name}>{participant.name}</strong>
                  <small>{participant.responsibility ?? participant.role ?? '智能体'}</small>
                  {participant.modelLabel ? (
                    <em title={participant.modelLabel}>{participant.modelLabel}</em>
                  ) : null}
                </span>
                <StateGlyph state={participant.state} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="st-conversation-progress__children" aria-labelledby="rail-progress-children">
        <button
          type="button"
          className="st-conversation-progress__section-heading"
          aria-expanded={childrenOpen}
          aria-controls="rail-progress-child-list"
          onClick={() => setChildrenOpen((open) => !open)}
        >
          <span><h3 id="rail-progress-children">子任务</h3>{props.childTasks?.length ? <em>{props.childTasks.length}</em> : null}</span>
          {childrenOpen ? <ChevronDown aria-hidden="true" size={14} /> : <ChevronRight aria-hidden="true" size={14} />}
        </button>
        {childrenOpen && props.childTasks?.length ? (
          <ul id="rail-progress-child-list">
            {props.childTasks.map((child) => (
              <li
                key={child.taskId}
                data-state={child.status}
                data-integration={child.integrationStatus ?? 'none'}
              >
                <button type="button" onClick={() => props.onOpenTask?.(child.taskId)}>
                  <StateGlyph state={child.status} />
                  <span>
                    <strong>{child.title}</strong>
                    <small>{[child.assignee, stateLabel(child.status)].filter(Boolean).join(' · ')}</small>
                  </span>
                  <ChevronRight aria-hidden="true" size={14} />
                </button>
                {child.integrationStatus === 'conflicted' ? (
                  <div className="st-conversation-progress__integration" role="alert">
                    <small>
                      改动集成冲突
                      {child.conflictFiles?.length ? ` · ${child.conflictFiles.length} 个文件` : ''}
                    </small>
                    <div>
                      <button
                        type="button"
                        disabled={props.integrationBusyTaskId === child.taskId}
                        onClick={() => props.onResolveChildIntegration?.(child.taskId, 'accept-child')}
                      >
                        采用子任务
                      </button>
                      <button
                        type="button"
                        disabled={props.integrationBusyTaskId === child.taskId}
                        onClick={() => props.onResolveChildIntegration?.(child.taskId, 'keep-parent')}
                      >
                        保留父任务
                      </button>
                    </div>
                  </div>
                ) : child.integrationStatus === 'integrated' ? (
                  <small className="st-conversation-progress__integration-status">改动已自动集成</small>
                ) : null}
              </li>
            ))}
          </ul>
        ) : childrenOpen ? (
          <p className="st-conversation-rail-empty">主智能体创建子任务后，会在这里显示并可直接打开。</p>
        ) : null}
      </section>
    </div>
  );
}

function ArtifactIcon(props: { mimeType: string }) {
  if (props.mimeType.startsWith('image/')) return <FileImage aria-hidden="true" size={16} />;
  if (props.mimeType.includes('json')) return <FileJson2 aria-hidden="true" size={16} />;
  if (
    props.mimeType.includes('typescript') ||
    props.mimeType.includes('javascript') ||
    props.mimeType.includes('html') ||
    props.mimeType.includes('css')
  ) {
    return <FileCode2 aria-hidden="true" size={16} />;
  }
  return <FileText aria-hidden="true" size={16} />;
}

export function TaskArtifactDirectory(props: {
  items: readonly TaskArtifactDirectoryItem[];
  onOpenArtifact: (artifactId: string) => void;
}) {
  if (props.items.length === 0) {
    return (
      <div className="st-conversation-rail-empty st-conversation-rail-empty--centered">
        <Files aria-hidden="true" size={20} />
        <strong>尚无文件与产物</strong>
        <span>任务生成的文件与产物会出现在这里。</span>
      </div>
    );
  }

  return (
    <div className="st-task-artifact-directory">
      <header>
        <strong>文件与产物</strong>
        <span>{props.items.length}</span>
      </header>
      <ul>
        {props.items.map((item) => (
          <li key={item.id} data-state={item.state ?? 'ready'}>
            <button type="button" onClick={() => props.onOpenArtifact(item.id)}>
              <span className="st-task-artifact-directory__icon">
                <ArtifactIcon mimeType={item.mimeType} />
              </span>
              <span className="st-task-artifact-directory__copy">
                <strong>{item.name}</strong>
                <small>
                  {item.latestVersion ? `v${item.latestVersion}` : '等待版本'}
                  {item.selectedVersion ? ` · 当前 v${item.selectedVersion}` : ''}
                </small>
                {item.producerName || item.modelLabel ? (
                  <em>{[item.producerName, item.modelLabel].filter(Boolean).join(' · ')}</em>
                ) : null}
              </span>
              <span className="st-task-artifact-directory__meta">
                <time>{formatRailTime(item.createdAt)}</time>
                <ChevronRight aria-hidden="true" size={13} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RailDialog(props: {
  title: string;
  subtitle?: string;
  returnFocusRef?: MutableRefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;
  const closeAndRestoreFocus = () => {
    onCloseRef.current();
    props.returnFocusRef?.current?.focus();
  };

  useEffect(() => {
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeAndRestoreFocus();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ].filter((element) => !element.hasAttribute('hidden'));
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [props.returnFocusRef]);

  return createPortal(
    <div
      className="st-conversation-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        closeAndRestoreFocus();
      }}
    >
      <div
        ref={dialogRef}
        className="st-conversation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="st-conversation-dialog__header">
          <span>
            <strong id={titleId}>{props.title}</strong>
            {props.subtitle ? <small>{props.subtitle}</small> : null}
          </span>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="关闭"
            onClick={closeAndRestoreFocus}
          >
            <X aria-hidden="true" size={16} />
          </button>
        </header>
        <div className="st-conversation-dialog__body">{props.children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function TaskArtifactDialog(props: {
  artifactName: string;
  returnFocusRef?: MutableRefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <RailDialog
      title={props.artifactName}
      subtitle="文件与产物"
      returnFocusRef={props.returnFocusRef}
      onClose={props.onClose}
    >
      <div className="st-task-artifact-dialog__content">{props.children}</div>
    </RailDialog>
  );
}

function uniqueAgents(turn: ConversationLogTurn): number {
  return new Set(
    turn.stages.flatMap((stage) => (stage.agentVersionId ? [stage.agentVersionId] : [])),
  ).size;
}

function turnStateLabel(state: ConversationLogTurn['state']): string {
  return stateLabel(state);
}

type ConversationLogFilter = 'all' | 'agent' | 'tools' | 'system' | 'errors';

function conversationLogEventKind(event: ConversationLogEvent): Exclude<ConversationLogFilter, 'all'> {
  const type = event.type.toLocaleLowerCase();
  if (/failed|error|blocked|rejected/.test(type)) return 'errors';
  if (
    type.startsWith('tool.') ||
    type.startsWith('mcp.') ||
    type.startsWith('application.tool') ||
    type.startsWith('execution.tool') ||
    /command|shell|file\.|git\.|browser\.|desktop\./.test(type)
  ) {
    return 'tools';
  }
  if (
    type.startsWith('message.') ||
    type.startsWith('step.') ||
    type.startsWith('review.') ||
    type.startsWith('subtask.') ||
    type.startsWith('group.')
  ) {
    return 'agent';
  }
  return 'system';
}

function ConversationLogStageView(props: {
  stage: ConversationLogStage;
  filter: ConversationLogFilter;
  newestFirst: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const visibleEvents = useMemo(() => {
    const filtered = props.stage.events.filter(
      (event) => props.filter === 'all' || conversationLogEventKind(event) === props.filter,
    );
    return props.newestFirst ? [...filtered].reverse() : filtered;
  }, [props.filter, props.newestFirst, props.stage.events]);
  if (props.filter !== 'all' && visibleEvents.length === 0) return null;
  return (
    <section className="st-conversation-log-stage" data-state={props.stage.state}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${props.stage.agentName} · ${props.stage.title} · ${stateLabel(props.stage.state)}${props.stage.modelLabel ? ` · ${props.stage.modelLabel}` : ''}`}
        title={[
          props.stage.agentName,
          props.stage.responsibility ?? props.stage.role,
          props.stage.modelLabel,
          stateLabel(props.stage.state),
        ]
          .filter(Boolean)
          .join(' · ')}
        onClick={() => setOpen((value) => !value)}
      >
        <span
          className="st-conversation-log-stage__avatar"
          style={{ ['--st-agent-color' as string]: props.stage.color ?? '#64748b' }}
        >
          {props.stage.avatarUrl ? (
            <img src={props.stage.avatarUrl} alt="" />
          ) : (
            <Bot aria-hidden="true" size={15} />
          )}
        </span>
        <span className="st-conversation-log-stage__copy">
          <strong title={props.stage.agentName}>{props.stage.agentName}</strong>
          <small>{props.stage.title}</small>
          <em title={props.stage.modelLabel}>
            {[props.stage.responsibility ?? props.stage.role, props.stage.modelLabel]
              .filter(Boolean)
              .join(' · ')}
          </em>
        </span>
        <span className="st-conversation-log-stage__state">
          <StateGlyph state={props.stage.state} />
          <small>{formatRailDuration(props.stage.durationMs)}</small>
          {open ? (
            <ChevronDown aria-hidden="true" size={14} />
          ) : (
            <ChevronRight aria-hidden="true" size={14} />
          )}
        </span>
      </button>
      {open ? (
        <ol id={panelId} className="st-conversation-log-stage__events">
          {visibleEvents.map((event) => (
            <ConversationLogEventView key={event.id} event={event} />
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function ConversationLogEventView(props: { event: ConversationLogEvent }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLLIElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setDetailsOpen((value) => !value);
    }
  };
  return (
    <li
      data-kind={conversationLogEventKind(props.event)}
      tabIndex={0}
      role="button"
      aria-expanded={detailsOpen}
      onClick={() => setDetailsOpen((value) => !value)}
      onKeyDown={onKeyDown}
    >
      <time>{formatRailTime(props.event.occurredAt)}</time>
      <span>{props.event.summary}</span>
      <ChevronRight aria-hidden="true" size={12} />
      {detailsOpen && props.event.details.length > 0 ? (
        <dl onClick={(event) => event.stopPropagation()}>
          {props.event.details.map((detail, index) => (
            <div key={`${detail.label}-${index}`} data-label={detail.label}>
              <dt>{detail.label}</dt>
              <dd>{detail.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </li>
  );
}

function ConversationLogDialog(props: {
  turn: ConversationLogTurn;
  returnFocusRef: MutableRefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<ConversationLogFilter>('all');
  const [newestFirst, setNewestFirst] = useState(false);
  const filterOptions: ReadonlyArray<{ id: ConversationLogFilter; label: string }> = [
    { id: 'all', label: '全部' },
    { id: 'agent', label: 'Agent' },
    { id: 'tools', label: '工具' },
    { id: 'system', label: '系统' },
    { id: 'errors', label: '异常' },
  ];
  return (
    <RailDialog
      title={`第 ${props.turn.index} 轮对话日志`}
      subtitle={`${formatRailTime(props.turn.startedAt)} - ${formatRailTime(props.turn.endedAt)} · ${turnStateLabel(props.turn.state)} · ${formatRailDuration(props.turn.durationMs)}`}
      returnFocusRef={props.returnFocusRef}
      onClose={props.onClose}
    >
      <div className="st-conversation-log-dialog__metadata" aria-label="本轮执行概览">
        <span data-state={props.turn.state}><StateGlyph state={props.turn.state} />{turnStateLabel(props.turn.state)}</span>
        <span>{uniqueAgents(props.turn)} Agent</span>
        <span>{props.turn.modelCallCount} 次模型调用</span>
        <span>{props.turn.toolCallCount} 次工具调用</span>
        <span>{formatRailDuration(props.turn.durationMs)}</span>
        {props.turn.artifactCount > 0 ? <span>{props.turn.artifactCount} 个产物</span> : null}
        {props.turn.errorCount > 0 ? (
          <span data-state="failed">{props.turn.errorCount} 个异常</span>
        ) : null}
      </div>
      <div className="st-conversation-log-dialog__stage-strip" aria-label="Agent 阶段概览">
        {props.turn.stages.map((stage) => (
          <span
            key={stage.id}
            data-state={stage.state}
            title={`${stage.agentName} · ${stage.title}`}
            style={{ ['--st-stage-color' as string]: stage.color ?? '#64748b' }}
          />
        ))}
      </div>
      <section className="st-conversation-log-dialog__request">
        <span>用户消息</span>
        <p>{props.turn.userMessage}</p>
      </section>
      <div className="st-conversation-log-dialog__toolbar">
        <div role="group" aria-label="日志类型">
          {filterOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              data-active={filter === option.id ? '1' : '0'}
              aria-pressed={filter === option.id}
              onClick={() => setFilter(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={newestFirst}
          onClick={() => setNewestFirst((value) => !value)}
        >
          {newestFirst ? '最新在前' : '时间顺序'}
        </button>
      </div>
      <section className="st-conversation-log-dialog__stages" aria-label="Agent 阶段日志">
        <header>
          <strong>执行阶段</strong>
          <span>{props.turn.stages.length}</span>
        </header>
        {props.turn.stages.map((stage) => (
          <ConversationLogStageView
            key={stage.id}
            stage={stage}
            filter={filter}
            newestFirst={newestFirst}
          />
        ))}
      </section>
      {props.turn.finalResponse ? (
        <section className="st-conversation-log-dialog__response">
          <span>最终回复</span>
          <p>{props.turn.finalResponse}</p>
        </section>
      ) : null}
    </RailDialog>
  );
}

export function ConversationExecutionLogs(props: { turns: readonly ConversationLogTurn[] }) {
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const selectedTurn = props.turns.find((turn) => turn.id === selectedTurnId);
  const visibleTurns = useMemo(() => [...props.turns].reverse(), [props.turns]);

  if (visibleTurns.length === 0) {
    return (
      <div className="st-conversation-rail-empty st-conversation-rail-empty--centered">
        <Clock3 aria-hidden="true" size={20} />
        <strong>尚无对话日志</strong>
        <span>发送第一条消息后，这里会记录本轮执行详情。</span>
      </div>
    );
  }

  return (
    <div className="st-conversation-execution-logs">
      <header>
        <strong>执行记录</strong>
        <span>{props.turns.length}</span>
      </header>
      <ol>
        {visibleTurns.map((turn) => (
          <li key={turn.id}>
            <button
              type="button"
              className="st-conversation-log-row"
              data-state={turn.state}
              onClick={(event) => {
                returnFocusRef.current = event.currentTarget;
                setSelectedTurnId(turn.id);
              }}
            >
              <span className="st-conversation-log-row__head">
                <strong>第 {turn.index} 轮</strong>
                <time>{formatRailTime(turn.startedAt)}</time>
              </span>
              <span className="st-conversation-log-row__message">{turn.userMessage}</span>
              <span className="st-conversation-log-row__meta">
                <em data-state={turn.state}>{turnStateLabel(turn.state)}</em>
                <span>{uniqueAgents(turn)} Agent</span>
                <span>{turn.modelCallCount} 次调用</span>
                <span>{formatRailDuration(turn.durationMs)}</span>
                {turn.artifactCount > 0 ? <span>{turn.artifactCount} 个产物</span> : null}
                {turn.errorCount > 0 ? (
                  <span className="st-conversation-log-row__error">{turn.errorCount} 个异常</span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {selectedTurn ? (
        <ConversationLogDialog
          turn={selectedTurn}
          returnFocusRef={returnFocusRef}
          onClose={() => {
            setSelectedTurnId(null);
            returnFocusRef.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}
