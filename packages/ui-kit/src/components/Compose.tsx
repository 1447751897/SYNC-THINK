import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import type { ParticipationMode, ProviderSurface } from '@sync-think/shared';
import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
  FolderKanban,
  RefreshCw,
  Settings2,
  Square,
  Users,
} from 'lucide-react';
import { ModelPathPicker } from './ModelPathPicker.js';

// Compose — multi-line input with teammate (Agent) picker, model override, and send.
// Model selection is a Run override (§5.3). Agent selection is the conversation owner.

export interface ComposeModelOption {
  modelId: string;
  /** Short line shown in the selector, e.g. "OpenAI · gpt-4o-mini". */
  label: string;
  providerName?: string;
  providerModelId?: string;
  providerId?: string;
  surface?: ProviderSurface;
  protocol?: string;
}

/** Compact teammate identity for Compose @-switcher (Multica-style). */
export interface ComposeAgentOption {
  agentId: string;
  name: string;
  role?: string;
  color?: string;
  icon?: string;
  /** Optional short model line, e.g. "grok-4.5". */
  modelLabel?: string;
}

export interface ComposeWorkspaceOption {
  workspaceId: string;
  name: string;
  folderPath?: string;
}

export interface ComposeSendOptions {
  /** Explicit Run model override. Absent / undefined → Agent default. */
  modelId?: string;
}

export interface ComposeProps {
  mode: ParticipationMode;
  /**
   * Fired on submit. Second arg carries Run overrides (modelId).
   * Back-compat: callers that only need text may ignore the second parameter.
   */
  onSend: (
    text: string,
    options?: ComposeSendOptions,
  ) => void | boolean | Promise<void | boolean>;
  placeholder?: string;
  disabled?: boolean;
  /** When true, shows a cancel control for the active stream. */
  streaming?: boolean;
  onCancel?: () => void;
  cancelDisabled?: boolean;
  /**
   * Registered catalog models available for this Run override.
   * When omitted, the model row is hidden (legacy callers).
   * When provided as empty array, show empty-registry hint.
   */
  models?: readonly ComposeModelOption[];
  /**
   * Controlled selection. `null` / empty → Agent default (no run override).
   * When uncontrolled, Compose keeps an internal selection starting at null.
   */
  selectedModelId?: string | null;
  onModelChange?: (modelId: string | null) => void;
  /** Label for the auto / agent-default option. */
  defaultModelLabel?: string;
  /** Number of Agent fallback models (observability only). */
  agentFallbackCount?: number;
  /** When true, show multi-provider continuity hint. */
  multiProvider?: boolean;
  /**
   * Soft observability: Runtime connection for send-ready strip.
   * Does not change send gating (parent still owns `disabled`).
   */
  connectionState?: 'online' | 'connecting' | 'offline' | string;
  /** Soft observability: whether a task is open. */
  hasActiveTask?: boolean;
  /** Soft observability: Agent default model is configured. */
  agentDefaultSet?: boolean;
  /** Optional compact recovery action shown only when Runtime is unavailable. */
  onReconnect?: () => void;
  /** Optional compact recovery action shown when no model can be resolved. */
  onConfigureModel?: () => void;
  /** Teammate list for Compose-level Agent switch. */
  agents?: readonly ComposeAgentOption[];
  selectedAgentId?: string | null;
  onAgentChange?: (agentId: string) => void;
  /** Open the full Agent workspace / drawer. */
  onOpenAgentCenter?: () => void;
  /** Project context and switcher live beside Agent/model selection. */
  workspaces?: readonly ComposeWorkspaceOption[];
  selectedWorkspaceId?: string | null;
  onWorkspaceChange?: (workspaceId: string) => void;
  /**
   * Talk target kind (Locked NewMax shell): model | agent | team.
   * Permission stays conversation-scoped; this only switches who you talk to.
   */
  talkTargetKind?: 'model' | 'agent' | 'team';
  onTalkTargetKindChange?: (kind: 'model' | 'agent' | 'team') => void;
  /** Optional team templates when talkTargetKind === 'team'. */
  teams?: readonly ComposeTeamOption[];
  selectedTeamId?: string | null;
  onTeamChange?: (teamId: string) => void;
}

export interface ComposeTeamOption {
  teamId: string;
  name: string;
  memberSummary?: string;
}


export type ComposeSendReadinessLevel =
  | 'ready'
  | 'partial'
  | 'blocked'
  | 'streaming'
  | 'empty';

export interface ComposeSendReadiness {
  level: ComposeSendReadinessLevel;
  badge: string;
  textOk: boolean;
  connectionOk: boolean;
  connectionState: string;
  taskResolvedOk: boolean;
  taskKnown: boolean;
  modelsOk: boolean;
  multiOk: boolean;
  agentOk: boolean;
  overrideOk: boolean;
  sourceTag: string;
  modelCount: number;
  note: string;
}

export interface ComposeSendReadinessInput {
  text?: string | null;
  connectionState?: string | null;
  hasActiveTask?: boolean;
  agentDefaultSet?: boolean;
  multiProvider?: boolean;
  streaming?: boolean;
  disabled?: boolean;
  /** When models array is provided (even empty), model gate is active. */
  modelsProvided?: boolean;
  hasModels?: boolean;
  modelCount?: number;
  selectedModelId?: string | null;
}

/**
 * Pure projector for tests + UI — Compose send readiness (§5 multi-model turn).
 * Soft observability only; does not close M1.
 */
export function projectComposeSendReadiness(
  input: ComposeSendReadinessInput,
): ComposeSendReadiness {
  const textOk = Boolean((input.text ?? '').trim());
  const connectionState = input.connectionState ?? 'unknown';
  const connectionOk = connectionState === 'online';
  const taskKnown = input.hasActiveTask !== undefined;
  const taskResolvedOk = taskKnown ? Boolean(input.hasActiveTask) : true;
  const modelsProvided = Boolean(input.modelsProvided);
  const hasModels = Boolean(input.hasModels);
  const modelsOk = !modelsProvided || hasModels;
  const multiOk = Boolean(input.multiProvider);
  const agentOk =
    input.agentDefaultSet === undefined ? true : Boolean(input.agentDefaultSet);
  const overrideOk = Boolean(input.selectedModelId);
  const streaming = Boolean(input.streaming);
  const blocked = Boolean(input.disabled) && !streaming;
  const modelCount = Math.max(0, Number(input.modelCount ?? 0) || 0);

  let level: ComposeSendReadinessLevel = 'partial';
  if (streaming) level = 'streaming';
  else if (blocked) level = 'blocked';
  else if (!modelsOk && !textOk) level = 'empty';
  else if (
    !blocked &&
    modelsOk &&
    taskResolvedOk &&
    (connectionOk || connectionState === 'unknown')
  )
    level = textOk ? 'ready' : 'partial';
  else level = 'partial';

  const badge =
    level === 'streaming'
      ? '流式中'
      : level === 'blocked'
        ? '暂不可发送'
        : level === 'ready'
          ? '可发送'
          : level === 'empty'
            ? '等待配置'
            : '准备中';

  const sourceTag = overrideOk ? '本轮覆盖' : 'Agent 默认';
  const notes: string[] = [];
  if (streaming) notes.push('Esc 可取消流式');
  else if (blocked) {
    if (taskKnown && !taskResolvedOk) notes.push('先打开任务');
    else if (connectionState === 'offline') notes.push('Runtime 未连接');
    else if (connectionState === 'connecting') notes.push('Runtime 连接中');
    else if (!modelsOk) notes.push('尚无注册模型');
    else notes.push('等待可发送条件');
  } else if (!textOk) notes.push('输入内容后发送 · Ctrl+Enter');
  else notes.push('发送后写入轨迹与 Manifest');

  return {
    level,
    badge,
    textOk,
    connectionOk,
    connectionState,
    taskResolvedOk,
    taskKnown,
    modelsOk,
    multiOk,
    agentOk,
    overrideOk,
    sourceTag,
    modelCount,
    note: notes.join(' · '),
  };
}

function safeAgentColor(value: string | undefined): string {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#64748b';
}

export function Compose(props: ComposeProps) {
  const [val, setVal] = useState('');
  const [internalModelId, setInternalModelId] = useState<string | null>(null);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const agentMenuRef = useRef<HTMLDivElement | null>(null);
  const workspaceMenuRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const modelsProvided = props.models !== undefined;
  const models = props.models ?? [];
  const isControlled = props.selectedModelId !== undefined;
  const selectedModelId = isControlled
    ? (props.selectedModelId ?? null)
    : internalModelId;

  const agents = useMemo(() => props.agents ?? [], [props.agents]);
  const teams = props.teams ?? [];
  const talkTargetKind = props.talkTargetKind ?? 'agent';
  const showTalkTargetSwitch = Boolean(props.onTalkTargetKindChange);
  const showAgentPicker =
    talkTargetKind === 'agent' && agents.length > 0 && Boolean(props.onAgentChange);
  const showTeamPicker =
    talkTargetKind === 'team' && teams.length > 0 && Boolean(props.onTeamChange);
  const selectedAgent =
    agents.find((agent) => agent.agentId === props.selectedAgentId) ?? agents[0] ?? null;
  const selectedTeam =
    teams.find((team) => team.teamId === props.selectedTeamId) ?? teams[0] ?? null;
  const selectedAgentColor = safeAgentColor(selectedAgent?.color);
  const workspaces = props.workspaces ?? [];
  const showWorkspacePicker = workspaces.length > 0 && Boolean(props.onWorkspaceChange);
  const selectedWorkspace =
    workspaces.find((workspace) => workspace.workspaceId === props.selectedWorkspaceId) ??
    workspaces[0] ??
    null;

  const showModelRow = modelsProvided;
  const hasModels = models.length > 0;
  const defaultLabel =
    props.defaultModelLabel ??
    (talkTargetKind === 'model' ? '当前模型' : '智能体默认（自动）');

  const mentionMatches = useMemo(() => {
    if (mentionQuery == null) return [];
    const q = mentionQuery.trim().toLowerCase();
    if (!q) return agents.slice(0, 8);
    return agents
      .filter(
        (agent) =>
          agent.name.toLowerCase().includes(q) ||
          (agent.role ?? '').toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [agents, mentionQuery]);

  useEffect(() => {
    if (!agentMenuOpen && !workspaceMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!agentMenuRef.current?.contains(event.target as Node)) {
        setAgentMenuOpen(false);
      }
      if (!workspaceMenuRef.current?.contains(event.target as Node)) {
        setWorkspaceMenuOpen(false);
      }
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAgentMenuOpen(false);
        setWorkspaceMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [agentMenuOpen, workspaceMenuOpen]);

  const blocker = useMemo(() => {
    if (props.streaming) return null;
    if (props.connectionState === 'offline') {
      return { message: '本地服务未连接', action: 'reconnect' as const, tone: 'warn' as const };
    }
    if (props.connectionState === 'connecting') {
      return { message: '正在连接本地服务…', action: null, tone: 'hint' as const };
    }
    if (props.hasActiveTask === false) {
      return {
        message: '先创建或选择一个任务，即可开始输入',
        action: null,
        tone: 'hint' as const,
      };
    }
    if (modelsProvided && !hasModels) {
      return { message: '还没有可用模型', action: 'configure' as const, tone: 'warn' as const };
    }
    if (props.agentDefaultSet === false && !selectedModelId) {
      return {
        message: '智能体还没有默认模型',
        action: 'configure' as const,
        tone: 'warn' as const,
      };
    }
    return null;
  },
    [
      props.connectionState,
      props.hasActiveTask,
      props.agentDefaultSet,
      props.streaming,
      modelsProvided,
      hasModels,
      selectedModelId,
    ],
  );

  const sendBlocked = Boolean(props.disabled || blocker);

  const setSelected = (next: string | null) => {
    if (!isControlled) setInternalModelId(next);
    props.onModelChange?.(next);
  };

  const pickAgent = (agentId: string) => {
    props.onAgentChange?.(agentId);
    setAgentMenuOpen(false);
    setMentionQuery(null);
  };

  const pickWorkspace = (workspaceId: string) => {
    props.onWorkspaceChange?.(workspaceId);
    setWorkspaceMenuOpen(false);
    setMentionQuery(null);
  };

  const applyMentionPick = (agent: ComposeAgentOption) => {
    const el = textareaRef.current;
    const current = val;
    const caret = el?.selectionStart ?? current.length;
    const before = current.slice(0, caret);
    const after = current.slice(caret);
    const at = before.lastIndexOf('@');
    if (at < 0) {
      pickAgent(agent.agentId);
      return;
    }
    const next = `${before.slice(0, at)}@${agent.name} ${after}`;
    setVal(next);
    pickAgent(agent.agentId);
    window.setTimeout(() => {
      const node = textareaRef.current;
      if (!node) return;
      const pos = at + agent.name.length + 2;
      node.focus();
      node.setSelectionRange(pos, pos);
    }, 0);
  };

  const sendCurrentValue = () => {
    if (!val.trim() || sendBlocked) return;
    const submittedValue = val;
    const modelId = selectedModelId || undefined;
    try {
      const result = props.onSend(submittedValue, { modelId });
      if (result && typeof (result as PromiseLike<void | boolean>).then === 'function') {
        void Promise.resolve(result).then(
          (succeeded) => {
            if (succeeded !== false) {
              setVal((current) => (current === submittedValue ? '' : current));
              setMentionQuery(null);
            }
          },
          () => undefined,
        );
        return;
      }
      if (result !== false) {
        setVal('');
        setMentionQuery(null);
      }
    } catch {
      // Keep the draft. The parent owns the actionable send error.
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    sendCurrentValue();
  };

  const onTextareaChange = (value: string, caret: number) => {
    setVal(value);
    if (!showAgentPicker) {
      setMentionQuery(null);
      return;
    }
    const before = value.slice(0, caret);
    const match = before.match(/(^|[\s\n])@([^\s@]*)$/);
    if (match) {
      setMentionQuery(match[2] ?? '');
      setAgentMenuOpen(false);
    } else {
      setMentionQuery(null);
    }
  };

  const onTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery != null && mentionMatches.length > 0) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMentionQuery(null);
        return;
      }
      if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        applyMentionPick(mentionMatches[0]!);
        return;
      }
    }
    if (event.key === 'Escape' && props.streaming && props.onCancel && !props.cancelDisabled) {
      event.preventDefault();
      props.onCancel();
      return;
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      sendCurrentValue();
    }
  };

  const showMentionMenu = mentionQuery != null && showAgentPicker;

  return (
    <form
      onSubmit={onSubmit}
      className="st-compose"
      aria-label="Message compose"
      data-mode={props.mode}
      data-streaming={props.streaming ? '1' : '0'}
      data-talk-target={talkTargetKind}
      data-has-models={showModelRow ? (hasModels ? '1' : '0') : undefined}
      data-has-agents={showAgentPicker ? '1' : '0'}
      data-has-teams={showTeamPicker ? '1' : '0'}
      data-has-workspaces={showWorkspacePicker ? '1' : '0'}
    >
      {blocker ? (
        <div
          className="st-compose__blocker"
          data-testid="compose-blocker"
          data-tone={blocker.tone}
          role="status"
        >
          {blocker.tone === 'warn' ? (
            <CircleAlert aria-hidden="true" size={14} strokeWidth={1.8} />
          ) : null}
          <span>{blocker.message}</span>
          {blocker.action === 'reconnect' && props.onReconnect ? (
            <button type="button" onClick={props.onReconnect} aria-label="重新连接本地服务">
              <RefreshCw aria-hidden="true" size={13} strokeWidth={1.8} />
              重连
            </button>
          ) : blocker.action === 'configure' && props.onConfigureModel ? (
            <button type="button" onClick={props.onConfigureModel} aria-label="配置模型">
              <Settings2 aria-hidden="true" size={13} strokeWidth={1.8} />
              配置
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="st-compose__input-wrap">
        <textarea
          ref={textareaRef}
          aria-label="消息输入"
          className="st-compose__input"
          placeholder={
            props.placeholder ??
            (talkTargetKind === 'team' && selectedTeam
              ? `小队 ${selectedTeam.name} · 描述要分工完成的工作…`
              : talkTargetKind === 'model'
                ? '直接与模型对话…'
                : selectedAgent
                  ? `@${selectedAgent.name} · 描述你希望完成的工作…`
                  : '输入指令、粘贴上下文，或继续当前任务…')
          }
          value={val}
          onChange={(e) => onTextareaChange(e.target.value, e.target.selectionStart ?? 0)}
          onKeyDown={onTextareaKeyDown}
          disabled={props.disabled && !props.streaming}
        />
        {showMentionMenu ? (
          <div
            className="st-compose__mention-menu"
            data-testid="compose-mention-menu"
            role="listbox"
            aria-label="选择智能体"
          >
            {mentionMatches.length === 0 ? (
              <p className="st-compose__mention-empty">没有匹配的智能体</p>
            ) : (
              mentionMatches.map((agent, index) => {
                const color = safeAgentColor(agent.color);
                return (
                  <button
                    key={agent.agentId}
                    type="button"
                    role="option"
                    aria-selected={index === 0}
                    className="st-compose__mention-item"
                    data-testid={`compose-mention-${agent.agentId}`}
                    onClick={() => applyMentionPick(agent)}
                  >
                    <span
                      className="st-compose__agent-avatar"
                      style={{ '--st-compose-agent-color': color } as CSSProperties}
                    >
                      <Bot size={13} strokeWidth={1.9} aria-hidden="true" />
                    </span>
                    <span className="st-compose__mention-copy">
                      <strong>@{agent.name}</strong>
                      <small>{agent.role || agent.modelLabel || '智能体'}</small>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        ) : null}
      </div>
      <div className="st-compose__toolbar">
        <div className="st-compose__model-control">
          {showTalkTargetSwitch ? (
            <div
              className="st-compose__talk-target"
              data-testid="compose-talk-target"
              role="tablist"
              aria-label="对话对象"
            >
              {(
                [
                  { id: 'model' as const, label: '模型' },
                  { id: 'agent' as const, label: '智能体' },
                  { id: 'team' as const, label: '小队' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="tab"
                  className="st-compose__talk-target-item"
                  data-testid={`compose-talk-target-${opt.id}`}
                  data-active={talkTargetKind === opt.id ? '1' : '0'}
                  aria-selected={talkTargetKind === opt.id}
                  disabled={props.streaming}
                  onClick={() => props.onTalkTargetKindChange?.(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          ) : null}
          {showWorkspacePicker && selectedWorkspace ? (
            <div
              className="st-compose__workspace-picker"
              ref={workspaceMenuRef}
              data-open={workspaceMenuOpen ? '1' : '0'}
            >
              <button
                type="button"
                className="st-compose__workspace-trigger"
                data-testid="compose-workspace-trigger"
                aria-haspopup="listbox"
                aria-expanded={workspaceMenuOpen}
                aria-label={`切换项目，当前 ${selectedWorkspace.name}`}
                aria-describedby={
                  selectedWorkspace.folderPath ? 'st-compose-workspace-path-tooltip' : undefined
                }
                disabled={props.streaming}
                onClick={() => {
                  setAgentMenuOpen(false);
                  setMentionQuery(null);
                  setWorkspaceMenuOpen((open) => !open);
                }}
              >
                <FolderKanban size={14} strokeWidth={1.8} aria-hidden="true" />
                <span className="st-compose__workspace-trigger-text">{selectedWorkspace.name}</span>
                <ChevronDown size={13} strokeWidth={1.8} aria-hidden="true" />
                {selectedWorkspace.folderPath ? (
                  <span
                    id="st-compose-workspace-path-tooltip"
                    className="st-compose__workspace-tooltip"
                    role="tooltip"
                  >
                    {selectedWorkspace.folderPath}
                  </span>
                ) : null}
              </button>
              {workspaceMenuOpen ? (
                <div
                  className="st-compose__workspace-menu"
                  data-testid="compose-workspace-menu"
                  role="listbox"
                  aria-label="项目列表"
                >
                  {workspaces.map((workspace) => {
                    const selected = workspace.workspaceId === selectedWorkspace.workspaceId;
                    return (
                      <button
                        key={workspace.workspaceId}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className="st-compose__workspace-option"
                        data-selected={selected ? '1' : '0'}
                        data-testid={`compose-workspace-option-${workspace.workspaceId}`}
                        title={workspace.folderPath}
                        onClick={() => pickWorkspace(workspace.workspaceId)}
                      >
                        <FolderKanban size={15} strokeWidth={1.8} aria-hidden="true" />
                        <span className="st-compose__workspace-option-copy">
                          <strong>{workspace.name}</strong>
                          <small>{workspace.folderPath ?? '未绑定文件夹'}</small>
                        </span>
                        {selected ? <Check size={14} strokeWidth={2} aria-hidden="true" /> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
          {showTeamPicker && selectedTeam ? (
            <div className="st-compose__team-chip" data-testid="compose-team-chip">
              <Users size={14} strokeWidth={1.8} aria-hidden="true" />
              <span>{selectedTeam.name}</span>
              {selectedTeam.memberSummary ? (
                <small>{selectedTeam.memberSummary}</small>
              ) : null}
            </div>
          ) : null}
          {showAgentPicker ? (
            <div className="st-compose__agent-picker" ref={agentMenuRef} data-open={agentMenuOpen ? '1' : '0'}>
              <button
                type="button"
                className="st-compose__agent-trigger"
                data-testid="compose-agent-trigger"
                aria-haspopup="listbox"
                aria-expanded={agentMenuOpen}
                disabled={props.streaming}
                title="切换负责智能体"
                onClick={() => {
                  setWorkspaceMenuOpen(false);
                  setMentionQuery(null);
                  setAgentMenuOpen((open) => !open);
                }}
              >
                <span
                  className="st-compose__agent-avatar"
                  style={{ '--st-compose-agent-color': selectedAgentColor } as CSSProperties}
                >
                  <Bot size={13} strokeWidth={1.9} aria-hidden="true" />
                </span>
                <span className="st-compose__agent-trigger-text">
                  @{selectedAgent?.name ?? '智能体'}
                </span>
                <ChevronDown size={13} strokeWidth={1.8} aria-hidden="true" />
              </button>
              {agentMenuOpen ? (
                <div
                  className="st-compose__agent-menu"
                  data-testid="compose-agent-menu"
                  role="listbox"
                  aria-label="智能体列表"
                >
                  {agents.map((agent) => {
                    const color = safeAgentColor(agent.color);
                    const selected = agent.agentId === selectedAgent?.agentId;
                    return (
                      <button
                        key={agent.agentId}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className="st-compose__agent-option"
                        data-testid={`compose-agent-option-${agent.agentId}`}
                        data-selected={selected ? '1' : '0'}
                        onClick={() => pickAgent(agent.agentId)}
                      >
                        <span
                          className="st-compose__agent-avatar"
                          style={{ '--st-compose-agent-color': color } as CSSProperties}
                        >
                          <Bot size={13} strokeWidth={1.9} aria-hidden="true" />
                        </span>
                        <span className="st-compose__agent-option-copy">
                          <strong>{agent.name}</strong>
                          <small>
                            {agent.role || '智能体'}
                            {agent.modelLabel ? ` · ${agent.modelLabel}` : ''}
                          </small>
                        </span>
                        {selected ? (
                          <Check size={14} strokeWidth={2} aria-hidden="true" />
                        ) : null}
                      </button>
                    );
                  })}
                  {props.onOpenAgentCenter ? (
                    <button
                      type="button"
                      className="st-compose__agent-manage"
                      data-testid="compose-agent-manage"
                      onClick={() => {
                        setAgentMenuOpen(false);
                        props.onOpenAgentCenter?.();
                      }}
                    >
                      <Settings2 size={13} strokeWidth={1.8} aria-hidden="true" />
                      管理智能体
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {showModelRow ? (
            hasModels ? (
              <div className="st-compose__model-select-wrap">
                <ModelPathPicker
                  id="st-compose-model"
                  data-testid="compose-model-path"
                  models={models}
                  value={selectedModelId}
                  onChange={setSelected}
                  disabled={props.streaming}
                  allowDefault
                  defaultLabel={defaultLabel}
                  size="sm"
                />
              </div>
            ) : (
              <span className="st-compose__model-empty" data-testid="compose-model-empty">
                暂无模型
              </span>
            )
          ) : null}
        </div>
        <div className="st-compose__actions">
          {props.streaming && props.onCancel ? (
            <button
              type="button"
              className="st-compose__cancel"
              aria-label="停止生成"
              title="停止生成（Esc）"
              disabled={props.cancelDisabled}
              onClick={() => props.onCancel?.()}
            >
              <Square aria-hidden="true" size={13} fill="currentColor" strokeWidth={1.8} />
            </button>
          ) : (
            <button
              type="submit"
              className="st-compose__send"
              aria-label="发送"
              title="发送（Ctrl+Enter）"
              disabled={sendBlocked || !val.trim()}
            >
              <ArrowUp aria-hidden="true" size={17} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
