import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type ClipboardEvent,
  type DragEvent,
} from 'react';
import {
  executionModeLabelZh,
  executionModeSummaryZh,
  type ApprovalMode,
  type ExecutionMode,
  type MessageAttachment,
  type ParticipationMode,
  type ProviderSurface,
} from '@sync-think/shared';
import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
  FolderOpen,
  FileText,
  Image,
  Paperclip,
  FolderKanban,
  Globe2,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Square,
  Users,
  X,
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
  supportsVision?: boolean;
}

export interface ComposeAttachment extends MessageAttachment {
  previewUrl?: string;
}

/** Compact teammate identity for Compose @-switcher (Multica-style). */
export interface ComposeAgentOption {
  agentId: string;
  /** Exact immutable runtime target used by group-chat @ mentions. */
  agentVersionId?: string;
  name: string;
  role?: string;
  color?: string;
  icon?: string;
  /** Optional short model line, e.g. "grok-4.5". */
  modelLabel?: string;
}

/** Existing collaboration team available from the Compose participant picker. */
export interface ComposeGroupOption {
  groupId: string;
  name: string;
  leadName: string;
  memberCount: number;
  color?: string;
  icon?: string;
}

export interface ComposeWorkspaceOption {
  workspaceId: string;
  name: string;
  folderPath?: string;
}

export interface ComposeBrowserIdentityOption {
  id: string;
  name: string;
  isDefault?: boolean;
}

export interface ComposePermissionDetails {
  approvalMode: ApprovalMode;
  executionMode: 'none' | 'local_serial' | 'managed_worktree';
  executionState: string;
  executionPath?: string;
  baseRef?: string;
  browserIdentityName?: string;
  effectiveToolNames: readonly string[];
  capabilityCeiling: {
    file: readonly string[];
    command: readonly string[];
    browser: readonly string[];
    desktop: readonly string[];
    network: readonly string[];
  };
}

export interface ComposeSendOptions {
  /** Explicit Run model override. Absent / undefined → Agent default. */
  modelId?: string;
  /** Exact Agent selected by an @ mention in the current group chat. */
  agentVersionId?: string;
  attachments?: MessageAttachment[];
}

export interface ComposeDraft {
  text: string;
  attachments: readonly ComposeAttachment[];
}

export interface ComposeProps {
  mode: ParticipationMode;
  /**
   * Fired on submit. Second arg carries Run overrides (modelId).
   * Back-compat: callers that only need text may ignore the second parameter.
   */
  onSend: (text: string, options?: ComposeSendOptions) => void | boolean | Promise<void | boolean>;
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
  /** Optional group-member-only list used by @ mentions. */
  mentionAgents?: readonly ComposeAgentOption[];
  selectedAgentId?: string | null;
  onAgentChange?: (agentId: string) => void;
  /** Existing teams are selectable but intentionally not creatable from Compose. */
  groups?: readonly ComposeGroupOption[];
  selectedGroupId?: string | null;
  onGroupChange?: (groupId: string) => void | Promise<void>;
  participantBusy?: boolean;
  /** Open the full Agent workspace / drawer. */
  onOpenAgentCenter?: () => void;
  /** Project context and switcher live beside Agent/model selection. */
  workspaces?: readonly ComposeWorkspaceOption[];
  selectedWorkspaceId?: string | null;
  onWorkspaceChange?: (workspaceId: string) => void;
  onCreateWorkspace?: () => void | Promise<void>;
  onCreateWorkspaceFromFolder?: () => void | Promise<void>;
  workspaceActionBusy?: boolean;
  /**
   * Codex three-mode execution authority for the current conversation task.
   * Accepts ExecutionMode values; legacy ApprovalMode aliases still render during migration.
   */
  permissionMode?: ExecutionMode | ApprovalMode;
  permissionBusy?: boolean;
  onPermissionModeChange?: (mode: ExecutionMode) => void | Promise<void>;
  permissionDetails?: ComposePermissionDetails | null;
  browserIdentities?: readonly ComposeBrowserIdentityOption[];
  selectedBrowserIdentityId?: string | null;
  browserIdentityBusy?: boolean;
  onBrowserIdentityChange?: (identityId: string) => void | Promise<void>;
  /** Desktop attachment bridge. Files are imported as immutable managed snapshots. */
  onPickAttachments?: (kind: 'files' | 'folder') => Promise<readonly ComposeAttachment[]>;
  onImportFiles?: (files: readonly File[]) => Promise<readonly ComposeAttachment[]>;
  onBindAttachmentFolder?: (attachment: ComposeAttachment) => void | Promise<void>;
  defaultModelId?: string | null;
  /** Draft scope. Changing this key restores the draft for the selected task. */
  draftKey?: string | null;
  draft?: ComposeDraft;
  onDraftChange?: (draft: ComposeDraft) => void;
}

export type ComposeSendReadinessLevel = 'ready' | 'partial' | 'blocked' | 'streaming' | 'empty';

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
  const agentOk = input.agentDefaultSet === undefined ? true : Boolean(input.agentDefaultSet);
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

function toComposeExecutionMode(mode: ExecutionMode | ApprovalMode | string): ExecutionMode {
  if (mode === 'read-only' || mode === 'workspace' || mode === 'full-access') return mode;
  if (mode === 'full') return 'full-access';
  // request / delegate / custom all map onto the daily workspace sandbox.
  return 'workspace';
}

function permissionModeLabel(mode: ExecutionMode | ApprovalMode | string): string {
  return executionModeLabelZh(toComposeExecutionMode(mode));
}

function permissionModeDescription(mode: ExecutionMode | ApprovalMode | string): string {
  return executionModeSummaryZh(toComposeExecutionMode(mode));
}

function executionModeLabel(mode: ComposePermissionDetails['executionMode']): string {
  if (mode === 'managed_worktree') return '隔离工作树';
  if (mode === 'local_serial') return '本地目录（串行）';
  return '仅对话';
}

function executionCapabilityLabels(toolNames: readonly string[]): string[] {
  const labels = new Set<string>();
  for (const name of toolNames) {
    if (name === 'read_file' || name === 'list_files') labels.add('读取项目文件');
    else if (name === 'write_file') labels.add('修改项目文件');
    else if (name === 'run_command') labels.add('执行命令');
    else if (name === 'git_status' || name === 'git_diff') labels.add('查看 Git 变更');
    else if (name === 'browser_navigate' || name === 'browser_extract') labels.add('浏览网页');
    else if (name === 'browser_click' || name === 'browser_fill') labels.add('操作网页');
    else if (name === 'desktop_list_windows' || name === 'desktop_snapshot') {
      labels.add('查看桌面应用');
    } else if (name === 'desktop_invoke' || name === 'desktop_fill') {
      labels.add('操作桌面应用');
    } else labels.add('扩展工具');
  }
  return [...labels];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasExactMention(text: string, agentName: string): boolean {
  return new RegExp(
    `(^|[\\s])@${escapeRegExp(agentName)}(?=$|[\\s,，。！？!?;；:：])`,
    'u',
  ).test(text);
}

function resolveMentionedAgent(
  text: string,
  agents: readonly ComposeAgentOption[],
  pickedAgentVersionId: string | null,
): ComposeAgentOption | undefined {
  const picked = pickedAgentVersionId
    ? agents.find((agent) => agent.agentVersionId === pickedAgentVersionId)
    : undefined;
  if (picked && hasExactMention(text, picked.name)) return picked;
  return [...agents]
    .filter((agent) => agent.agentVersionId && hasExactMention(text, agent.name))
    .sort((left, right) => right.name.length - left.name.length)[0];
}

export function Compose(props: ComposeProps) {
  const [val, setVal] = useState('');
  const [internalModelId, setInternalModelId] = useState<string | null>(null);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [pickedMentionAgentVersionId, setPickedMentionAgentVersionId] = useState<string | null>(
    null,
  );
  const [attachments, setAttachments] = useState<ComposeAttachment[]>([]);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [permissionDetailsOpen, setPermissionDetailsOpen] = useState(false);
  const agentMenuRef = useRef<HTMLDivElement | null>(null);
  const workspaceMenuRef = useRef<HTMLDivElement | null>(null);
  const attachmentMenuRef = useRef<HTMLDivElement | null>(null);
  const dragDepthRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setVal(props.draft?.text ?? '');
    setAttachments([...(props.draft?.attachments ?? [])]);
    setAttachmentError(null);
    setMentionQuery(null);
    setPickedMentionAgentVersionId(null);
  }, [props.draftKey]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = '0px';
    const contentHeight = Math.max(56, textarea.scrollHeight);
    const height = Math.min(200, contentHeight);
    textarea.style.height = `${height}px`;
    textarea.style.overflowY = contentHeight > 200 ? 'auto' : 'hidden';
  }, [props.draftKey, val]);

  const updateDraftText = (next: string) => {
    setVal(next);
    props.onDraftChange?.({ text: next, attachments });
  };

  const updateDraftAttachments = (
    next: ComposeAttachment[] | ((current: ComposeAttachment[]) => ComposeAttachment[]),
  ) => {
    setAttachments((current) => {
      const resolved = typeof next === 'function' ? next(current) : next;
      props.onDraftChange?.({ text: val, attachments: resolved });
      return resolved;
    });
  };

  const modelsProvided = props.models !== undefined;
  const models = props.models ?? [];
  const isControlled = props.selectedModelId !== undefined;
  const selectedModelId = isControlled ? (props.selectedModelId ?? null) : internalModelId;

  const agents = props.agents ?? [];
  const mentionAgents = props.mentionAgents ?? agents;
  const hasDedicatedMentionAgents = props.mentionAgents !== undefined;
  const showAgentPicker = agents.length > 0 && Boolean(props.onAgentChange);
  const showMentionPicker = mentionAgents.length > 0;
  const groups = props.groups ?? [];
  const showGroupPicker = groups.length > 0 && Boolean(props.onGroupChange);
  const showParticipantPicker = showAgentPicker || showGroupPicker;
  const selectedAgent =
    agents.find((agent) => agent.agentId === props.selectedAgentId) ?? agents[0] ?? null;
  const selectedGroup = groups.find((group) => group.groupId === props.selectedGroupId) ?? null;
  const selectedParticipantColor = safeAgentColor(selectedGroup?.color ?? selectedAgent?.color);
  const workspaces = props.workspaces ?? [];
  const showWorkspacePicker =
    (workspaces.length > 0 && Boolean(props.onWorkspaceChange)) ||
    Boolean(props.onCreateWorkspace || props.onCreateWorkspaceFromFolder);
  const selectedWorkspace =
    workspaces.find((workspace) => workspace.workspaceId === props.selectedWorkspaceId) ??
    workspaces[0] ??
    null;

  const showModelRow = modelsProvided;
  const hasModels = models.length > 0;
  const defaultLabel = props.defaultModelLabel ?? '智能体默认（自动）';

  const mentionMatches = useMemo(() => {
    if (mentionQuery == null) return [];
    const q = mentionQuery.trim().toLowerCase();
    if (!q) return mentionAgents.slice(0, 8);
    return mentionAgents
      .filter(
        (agent) =>
          agent.name.toLowerCase().includes(q) || (agent.role ?? '').toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [mentionAgents, mentionQuery]);

  useEffect(() => {
    if (!agentMenuOpen && !workspaceMenuOpen && !attachmentMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!agentMenuRef.current?.contains(event.target as Node)) {
        setAgentMenuOpen(false);
      }
      if (!workspaceMenuRef.current?.contains(event.target as Node)) {
        setWorkspaceMenuOpen(false);
      }
      if (!attachmentMenuRef.current?.contains(event.target as Node)) {
        setAttachmentMenuOpen(false);
      }
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAgentMenuOpen(false);
        setWorkspaceMenuOpen(false);
        setAttachmentMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [agentMenuOpen, workspaceMenuOpen, attachmentMenuOpen]);

  const effectiveModel = models.find(
    (model) => model.modelId === (selectedModelId ?? props.defaultModelId),
  );
  const imageModelBlocked =
    attachments.some((attachment) => attachment.kind === 'image') &&
    effectiveModel?.supportsVision === false;

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
    if (imageModelBlocked) {
      return {
        message: '当前模型未确认支持图片，请切换到视觉模型',
        action: null,
        tone: 'warn' as const,
      };
    }
    return null;
  }, [
    props.connectionState,
    props.hasActiveTask,
    props.agentDefaultSet,
    props.streaming,
    modelsProvided,
    hasModels,
    selectedModelId,
    imageModelBlocked,
  ]);

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

  const pickGroup = (groupId: string) => {
    setAgentMenuOpen(false);
    setMentionQuery(null);
    void props.onGroupChange?.(groupId);
  };

  const pickWorkspace = (workspaceId: string) => {
    props.onWorkspaceChange?.(workspaceId);
    setWorkspaceMenuOpen(false);
    setMentionQuery(null);
  };

  const runWorkspaceAction = (action: (() => void | Promise<void>) | undefined) => {
    setWorkspaceMenuOpen(false);
    setMentionQuery(null);
    void action?.();
  };

  const applyMentionPick = (agent: ComposeAgentOption) => {
    const el = textareaRef.current;
    const current = val;
    const caret = el?.selectionStart ?? current.length;
    const before = current.slice(0, caret);
    const after = current.slice(caret);
    const at = before.lastIndexOf('@');
    if (at < 0) {
      if (!hasDedicatedMentionAgents) pickAgent(agent.agentId);
      return;
    }
    const next = `${before.slice(0, at)}@${agent.name} ${after}`;
    updateDraftText(next);
    if (hasDedicatedMentionAgents) {
      setPickedMentionAgentVersionId(agent.agentVersionId ?? null);
      setAgentMenuOpen(false);
      setMentionQuery(null);
    } else {
      pickAgent(agent.agentId);
    }
    window.setTimeout(() => {
      const node = textareaRef.current;
      if (!node) return;
      const pos = at + agent.name.length + 2;
      node.focus();
      node.setSelectionRange(pos, pos);
    }, 0);
  };

  const mergeAttachments = (incoming: readonly ComposeAttachment[]) => {
    setAttachmentError(null);
    updateDraftAttachments((current) => {
      const next = [...current];
      for (const attachment of incoming) {
        if (
          next.some(
            (entry) =>
              entry.id === attachment.id || (entry.sha256 && entry.sha256 === attachment.sha256),
          )
        ) {
          continue;
        }
        if (next.length >= 10) {
          setAttachmentError('一次最多添加 10 个附件');
          break;
        }
        next.push(attachment);
      }
      return next;
    });
  };

  const pickAttachments = async (kind: 'files' | 'folder') => {
    if (!props.onPickAttachments || attachmentBusy) return;
    setAttachmentMenuOpen(false);
    setAttachmentBusy(true);
    setAttachmentError(null);
    try {
      mergeAttachments(await props.onPickAttachments(kind));
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : '附件导入失败');
    } finally {
      setAttachmentBusy(false);
    }
  };

  const importFiles = async (files: readonly File[]) => {
    if (!props.onImportFiles || files.length === 0 || attachmentBusy) return;
    setAttachmentBusy(true);
    setAttachmentError(null);
    try {
      mergeAttachments(await props.onImportFiles(files));
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : '附件导入失败');
    } finally {
      setAttachmentBusy(false);
    }
  };

  const sendCurrentValue = () => {
    if ((!val.trim() && attachments.length === 0) || sendBlocked) return;
    const submittedValue = val;
    const submittedAttachments = attachments;
    const modelId = selectedModelId || undefined;
    const mentionedAgent = resolveMentionedAgent(
      submittedValue,
      mentionAgents,
      pickedMentionAgentVersionId,
    );
    try {
      const result = props.onSend(submittedValue, {
        modelId,
        ...(submittedAttachments.length
          ? {
              attachments: submittedAttachments.map(
                ({ previewUrl: _previewUrl, ...attachment }) => attachment,
              ),
            }
          : {}),
        ...(mentionedAgent?.agentVersionId
          ? { agentVersionId: mentionedAgent.agentVersionId }
          : {}),
      });
      if (result && typeof (result as PromiseLike<void | boolean>).then === 'function') {
        void Promise.resolve(result).then(
          (succeeded) => {
            if (succeeded !== false) {
              if (val === submittedValue && attachments === submittedAttachments) {
                props.onDraftChange?.({ text: '', attachments: [] });
              }
              if (val === submittedValue) setVal('');
              if (attachments === submittedAttachments) setAttachments([]);
              setMentionQuery(null);
              setPickedMentionAgentVersionId(null);
            }
          },
          () => undefined,
        );
        return;
      }
      if (result !== false) {
        props.onDraftChange?.({ text: '', attachments: [] });
        setVal('');
        setAttachments([]);
        setMentionQuery(null);
        setPickedMentionAgentVersionId(null);
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
    updateDraftText(value);
    if (pickedMentionAgentVersionId) {
      const picked = mentionAgents.find(
        (agent) => agent.agentVersionId === pickedMentionAgentVersionId,
      );
      if (!picked || !hasExactMention(value, picked.name)) setPickedMentionAgentVersionId(null);
    }
    if (!showMentionPicker) {
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

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0 || !props.onImportFiles) return;
    event.preventDefault();
    void importFiles(files);
  };

  const onDrop = (event: DragEvent<HTMLFormElement>) => {
    if (props.onImportFiles) event.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0 || !props.onImportFiles) return;
    void importFiles(files);
  };

  const hasDraggedFiles = (event: DragEvent<HTMLFormElement>): boolean =>
    Array.from(event.dataTransfer.types ?? []).includes('Files');

  const showMentionMenu = mentionQuery != null && showMentionPicker;

  return (
    <form
      onSubmit={onSubmit}
      className="st-compose"
      aria-label="Message compose"
      data-mode={props.mode}
      data-streaming={props.streaming ? '1' : '0'}
      data-has-models={showModelRow ? (hasModels ? '1' : '0') : undefined}
      data-has-agents={showParticipantPicker ? '1' : '0'}
      data-has-workspaces={showWorkspacePicker ? '1' : '0'}
      data-has-attachments={attachments.length > 0 ? '1' : '0'}
      data-drag-active={dragActive ? '1' : '0'}
      onDragEnter={(event) => {
        if (!props.onImportFiles || !hasDraggedFiles(event)) return;
        event.preventDefault();
        dragDepthRef.current += 1;
        setDragActive(true);
      }}
      onDragLeave={(event) => {
        if (!props.onImportFiles || !hasDraggedFiles(event)) return;
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setDragActive(false);
      }}
      onDragOver={(event) => {
        if (!props.onImportFiles || !hasDraggedFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={onDrop}
    >
      {dragActive ? (
        <div className="st-compose__drop-target" role="status">
          <Image aria-hidden="true" size={19} strokeWidth={1.8} />
          <strong>松开以添加到当前对话</strong>
        </div>
      ) : null}
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

      {attachments.length > 0 ? (
        <div className="st-compose__attachments" aria-label="待发送附件">
          {attachments.map((attachment) => (
            <article
              key={attachment.id}
              className="st-compose__attachment"
              data-kind={attachment.kind}
            >
              {attachment.previewUrl ? (
                <img src={attachment.previewUrl} alt="" />
              ) : attachment.kind === 'folder' ? (
                <FolderOpen aria-hidden="true" size={16} />
              ) : (
                <FileText aria-hidden="true" size={16} />
              )}
              <span>
                <strong>{attachment.name}</strong>
                <small>
                  {attachment.kind === 'folder'
                    ? '本轮只读'
                    : `${attachment.kind === 'image' ? '图片' : '文件'} · ${Math.max(1, Math.ceil(attachment.size / 1024))} KB`}
                </small>
              </span>
              {attachment.kind === 'folder' && props.onBindAttachmentFolder ? (
                <button
                  type="button"
                  className="st-compose__attachment-bind"
                  onClick={() => void props.onBindAttachmentFolder?.(attachment)}
                >
                  绑定项目
                </button>
              ) : null}
              <button
                type="button"
                className="st-compose__attachment-remove"
                aria-label={`移除附件 ${attachment.name}`}
                onClick={() =>
                  updateDraftAttachments((current) =>
                    current.filter((entry) => entry.id !== attachment.id),
                  )
                }
              >
                <X aria-hidden="true" size={13} />
              </button>
            </article>
          ))}
        </div>
      ) : null}
      {attachmentError ? (
        <div className="st-compose__attachment-error" role="alert">
          {attachmentError}
        </div>
      ) : null}
      <div className="st-compose__input-wrap">
        <textarea
          ref={textareaRef}
          aria-label="消息输入"
          className="st-compose__input"
          placeholder={
            props.placeholder ??
            (selectedGroup
              ? `@${selectedGroup.name} · 描述你希望小队完成的工作…`
              : selectedAgent
                ? '描述你希望完成的工作…'
                : '输入指令、粘贴上下文，或继续当前任务…')
          }
          value={val}
          onChange={(e) => onTextareaChange(e.target.value, e.target.selectionStart ?? 0)}
          onKeyDown={onTextareaKeyDown}
          onPaste={onPaste}
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
          {props.permissionMode && props.onPermissionModeChange ? (
            <div className="st-compose__permission-wrap">
              <label className="st-compose__permission" data-testid="compose-permission-control">
                <ShieldCheck size={13} strokeWidth={1.9} aria-hidden="true" />
                <select
                  aria-label="当前对话操作权限"
                  value={toComposeExecutionMode(props.permissionMode)}
                  disabled={props.streaming || props.permissionBusy}
                  onChange={(event) =>
                    void props.onPermissionModeChange?.(event.target.value as ExecutionMode)
                  }
                >
                  <option value="read-only">只读</option>
                  <option value="workspace">工作区</option>
                  <option value="full-access">完全访问</option>
                </select>
              </label>
              {props.permissionDetails ? (
                <button
                  type="button"
                  className="st-compose__permission-details-trigger"
                  aria-label="查看当前任务有效权限"
                  aria-expanded={permissionDetailsOpen}
                  onClick={() => setPermissionDetailsOpen((open) => !open)}
                >
                  <Settings2 size={13} aria-hidden="true" />
                </button>
              ) : null}
              {permissionDetailsOpen && props.permissionDetails ? (
                <div
                  className="st-compose__permission-details"
                  role="dialog"
                  aria-label="当前任务有效权限"
                >
                  <header>
                    <strong>当前任务访问范围</strong>
                    <button
                      type="button"
                      aria-label="关闭权限详情"
                      onClick={() => setPermissionDetailsOpen(false)}
                    >
                      <X size={13} aria-hidden="true" />
                    </button>
                  </header>
                  <dl>
                    <div>
                      <dt>执行模式</dt>
                      <dd>
                        {permissionModeLabel(
                          props.permissionMode ?? props.permissionDetails.approvalMode,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>执行位置</dt>
                      <dd>{executionModeLabel(props.permissionDetails.executionMode)}</dd>
                    </div>
                    {props.permissionDetails.baseRef ? (
                      <div>
                        <dt>基准分支</dt>
                        <dd>{props.permissionDetails.baseRef}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>浏览器身份</dt>
                      <dd>{props.permissionDetails.browserIdentityName ?? '未选择'}</dd>
                    </div>
                  </dl>
                  <section>
                    <strong>执行规则</strong>
                    <p>
                      {permissionModeDescription(
                        props.permissionMode ?? props.permissionDetails.approvalMode,
                      )}
                    </p>
                  </section>
                  <section>
                    <strong>本次可用能力</strong>
                    <div className="st-compose__permission-chips">
                      {props.permissionDetails.effectiveToolNames.length ? (
                        executionCapabilityLabels(props.permissionDetails.effectiveToolNames).map(
                          (label) => <span key={label}>{label}</span>,
                        )
                      ) : (
                        <small>当前没有执行能力</small>
                      )}
                    </div>
                  </section>
                </div>
              ) : null}
            </div>
          ) : null}
          {props.browserIdentities?.length && props.onBrowserIdentityChange ? (
            <label className="st-compose__permission st-compose__browser-identity">
              <Globe2 size={13} strokeWidth={1.9} aria-hidden="true" />
              <select
                aria-label="当前任务浏览器身份"
                value={props.selectedBrowserIdentityId ?? props.browserIdentities[0]?.id ?? ''}
                disabled={props.streaming || props.browserIdentityBusy}
                onChange={(event) => void props.onBrowserIdentityChange?.(event.target.value)}
              >
                {props.browserIdentities.map((identity) => (
                  <option key={identity.id} value={identity.id}>
                    {identity.name}
                    {identity.isDefault ? '（默认）' : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {showWorkspacePicker ? (
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
                aria-label={`切换项目，当前 ${selectedWorkspace?.name ?? '未选择'}`}
                aria-describedby={
                  selectedWorkspace?.folderPath ? 'st-compose-workspace-path-tooltip' : undefined
                }
                disabled={props.streaming || props.workspaceActionBusy}
                onClick={() => {
                  setAgentMenuOpen(false);
                  setMentionQuery(null);
                  setWorkspaceMenuOpen((open) => !open);
                }}
              >
                <FolderKanban size={14} strokeWidth={1.8} aria-hidden="true" />
                <span className="st-compose__workspace-trigger-text">
                  {selectedWorkspace?.name ?? '选择项目'}
                </span>
                <ChevronDown size={13} strokeWidth={1.8} aria-hidden="true" />
                {selectedWorkspace?.folderPath ? (
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
                  {props.onCreateWorkspace || props.onCreateWorkspaceFromFolder ? (
                    <div className="st-compose__workspace-actions">
                      {props.onCreateWorkspace ? (
                        <button
                          type="button"
                          data-testid="compose-workspace-create-blank"
                          disabled={props.workspaceActionBusy}
                          onClick={() => runWorkspaceAction(props.onCreateWorkspace)}
                        >
                          <Plus size={15} strokeWidth={1.8} aria-hidden="true" />
                          <span>
                            <strong>新建空白项目</strong>
                            <small>稍后再绑定工作区</small>
                          </span>
                        </button>
                      ) : null}
                      {props.onCreateWorkspaceFromFolder ? (
                        <button
                          type="button"
                          data-testid="compose-workspace-create-folder"
                          disabled={props.workspaceActionBusy}
                          onClick={() => runWorkspaceAction(props.onCreateWorkspaceFromFolder)}
                        >
                          <FolderOpen size={15} strokeWidth={1.8} aria-hidden="true" />
                          <span>
                            <strong>使用现有文件夹</strong>
                            <small>创建并立即绑定工作区</small>
                          </span>
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {workspaces.map((workspace) => {
                    const selected = workspace.workspaceId === selectedWorkspace?.workspaceId;
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
          {showParticipantPicker ? (
            <div
              className="st-compose__agent-picker"
              ref={agentMenuRef}
              data-open={agentMenuOpen ? '1' : '0'}
            >
              <button
                type="button"
                className="st-compose__agent-trigger"
                data-testid="compose-agent-trigger"
                aria-haspopup="listbox"
                aria-expanded={agentMenuOpen}
                disabled={props.streaming || props.participantBusy}
                title="切换智能体或小队"
                onClick={() => {
                  setWorkspaceMenuOpen(false);
                  setMentionQuery(null);
                  setAgentMenuOpen((open) => !open);
                }}
              >
                <span
                  className="st-compose__agent-avatar"
                  data-kind={selectedGroup ? 'group' : 'agent'}
                  style={{ '--st-compose-agent-color': selectedParticipantColor } as CSSProperties}
                >
                  {selectedGroup ? (
                    <Users size={13} strokeWidth={1.9} aria-hidden="true" />
                  ) : (
                    <Bot size={13} strokeWidth={1.9} aria-hidden="true" />
                  )}
                </span>
                <span className="st-compose__agent-trigger-text">
                  @{selectedGroup?.name ?? selectedAgent?.name ?? '选择参与者'}
                </span>
                <ChevronDown size={13} strokeWidth={1.8} aria-hidden="true" />
              </button>
              {agentMenuOpen ? (
                <div
                  className="st-compose__agent-menu"
                  data-testid="compose-agent-menu"
                  role="listbox"
                  aria-label="智能体与小队列表"
                >
                  {showAgentPicker ? (
                    <div className="st-compose__participant-section">
                      <span className="st-compose__participant-heading">智能体</span>
                      {agents.map((agent) => {
                        const color = safeAgentColor(agent.color);
                        const selected = !selectedGroup && agent.agentId === selectedAgent?.agentId;
                        return (
                          <button
                            key={agent.agentId}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            className="st-compose__agent-option"
                            data-testid={`compose-agent-option-${agent.agentId}`}
                            data-selected={selected ? '1' : '0'}
                            disabled={props.participantBusy}
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
                    </div>
                  ) : null}
                  {showGroupPicker ? (
                    <div className="st-compose__participant-section">
                      <span className="st-compose__participant-heading">小队</span>
                      {groups.map((group) => {
                        const color = safeAgentColor(group.color);
                        const selected = group.groupId === selectedGroup?.groupId;
                        return (
                          <button
                            key={group.groupId}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            className="st-compose__agent-option st-compose__group-option"
                            data-testid={`compose-group-option-${group.groupId}`}
                            data-selected={selected ? '1' : '0'}
                            disabled={props.participantBusy}
                            onClick={() => pickGroup(group.groupId)}
                          >
                            <span
                              className="st-compose__agent-avatar"
                              data-kind="group"
                              style={{ '--st-compose-agent-color': color } as CSSProperties}
                            >
                              <Users size={13} strokeWidth={1.9} aria-hidden="true" />
                            </span>
                            <span className="st-compose__agent-option-copy">
                              <strong>{group.name}</strong>
                              <small>
                                主智能体 {group.leadName} · {group.memberCount} 名成员
                              </small>
                            </span>
                            {selected ? (
                              <Check size={14} strokeWidth={2} aria-hidden="true" />
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
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
          {props.onPickAttachments ? (
            <div className="st-compose__attachment-picker" ref={attachmentMenuRef}>
              <button
                type="button"
                className="st-compose__attach"
                aria-label="添加附件"
                title="添加图片、文件或文件夹"
                disabled={props.streaming || attachmentBusy}
                onClick={() => setAttachmentMenuOpen((open) => !open)}
              >
                <Paperclip aria-hidden="true" size={16} />
              </button>
              {attachmentMenuOpen ? (
                <div className="st-compose__attachment-menu">
                  <button type="button" onClick={() => void pickAttachments('files')}>
                    <Image aria-hidden="true" size={15} />
                    图片或文件
                  </button>
                  <button type="button" onClick={() => void pickAttachments('folder')}>
                    <FolderOpen aria-hidden="true" size={15} />
                    文件夹（本轮只读）
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
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
              disabled={sendBlocked || (!val.trim() && attachments.length === 0)}
            >
              <ArrowUp aria-hidden="true" size={17} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
