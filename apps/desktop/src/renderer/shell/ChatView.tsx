import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bot,
  Brain,
  Check,
  Copy,
  FileCode2,
  FileWarning,
  FolderOpen,
  Globe,
  ImagePlus,
  Lock,
  PanelRight,
  Puzzle,
  RefreshCw,
  SendHorizonal,
  Share2,
  Shield,
  Square,
  Terminal,
  X,
  Zap,
} from 'lucide-react';
import type { Conversation, Event, RunId, TaskId } from '@sync-think/shared';
import type { WorkspaceSummary } from '@sync-think/protocol';
import { projectConversation } from '../m0-projection.js';
import type { ModelOption } from './NewConversationDialog.js';
import {
  addAttachment,
  buildMessageWithAttachments,
  computeTextareaHeight,
  detectMentionQuery,
  fileNameFromPath,
  isImageFile,
  messageImagesFromAttachments,
  readFileAsDataUrl,
  removeAttachment,
  stripMentionToken,
  type ComposeAttachment,
  type MentionQuery,
  type MessageImage,
} from './compose-mention.js';
import { compressImageDataUrl } from './image-compress.js';
import {
  ContextRing,
  estimateContextWindow,
  ModelPickerMenu,
  ModelTrigger,
  PermissionMenu,
  ReasoningMenu,
  REASONING_LABELS,
  type PermissionMode,
  type ReasoningEffort,
} from './compose-toolbar.js';
import { ExecutionProcessBlock, FileChangesCard } from './ExecutionProcessBlock.js';
import { formatTokenUsage, projectExecutionProcess } from './execution-process.js';
import { MarkdownContent } from './MarkdownContent.js';
import { RightRail } from './RightRail.js';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  /** Extended thinking / reasoning channel (never mixed into text). */
  reasoningText?: string;
  /** Local image previews attached to this bubble (optimistic / UI only). */
  images?: MessageImage[];
  timestamp: string;
  streaming?: boolean;
  runId?: string;
}

interface PendingToolApproval {
  approvalId: string;
  runId?: string;
  toolCallId?: string;
  toolName: string;
  title: string;
  detail: string;
  path?: string;
  command?: string;
  decided?: 'approve' | 'deny';
}

export type { PermissionMode, ReasoningEffort };

interface ChatViewProps {
  conversation: Conversation;
  modelName: string;
  models: readonly ModelOption[];
  workspaces?: readonly WorkspaceSummary[];
  /** Shell-level durable event history (connect snapshot + live events). */
  eventHistory: readonly Event[];
  onTitleUpdated: (title: string) => void;
  /** Fired after permission mode is persisted so the shell can refresh the conversation list. */
  onConversationUpdated?: () => void;
}

function bridge() {
  return (window as any).syncThink?.runtime;
}

const PERMISSION_LABELS: Record<PermissionMode, string> = {
  ask: '询问批准',
  workspace: '为我批准',
  'full-access': '完全访问',
};
const PERMISSION_ICONS: Record<PermissionMode, typeof Shield> = {
  ask: Lock,
  workspace: Shield,
  'full-access': Zap,
};

export function ChatView({
  conversation,
  modelName,
  models,
  workspaces = [],
  eventHistory,
  onTitleUpdated,
  onConversationUpdated,
}: ChatViewProps) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(
    (conversation.executionMode as PermissionMode) || 'workspace',
  );
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('auto');
  const [modelOverride, setModelOverride] = useState<string>('');
  const [netEnabled, setNetEnabled] = useState(true);
  const [railOpen, setRailOpen] = useState(false);
  const [railTab, setRailTab] = useState<'tasks' | 'changes'>('changes');
  const [selectedChangePath, setSelectedChangePath] = useState<string | undefined>(undefined);
  /** Resolved thread for this conversation (from bound task). */
  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  /** Optimistic user bubbles not yet present in durable event history. */
  const [pendingUserMessages, setPendingUserMessages] = useState<ChatMessage[]>([]);
  const [localErrors, setLocalErrors] = useState<ChatMessage[]>([]);
  /** Active @-mention query (null = picker closed). */
  const [mention, setMention] = useState<MentionQuery | null>(null);
  const [mentionFiles, setMentionFiles] = useState<
    Array<{ path: string; name: string; kind: 'file' | 'dir' }>
  >([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionLoading, setMentionLoading] = useState(false);
  /** Selected @-files / images shown as chips (NewMax style). */
  const [attachments, setAttachments] = useState<ComposeAttachment[]>([]);
  /** Which compose menu is open (exclusive). */
  const [menu, setMenu] = useState<'permission' | 'reasoning' | 'model' | null>(null);
  /** Click-to-preview lightbox for message / chip images. */
  const [lightbox, setLightbox] = useState<MessageImage | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const composeRef = useRef<HTMLDivElement>(null);
  const mentionListRef = useRef<HTMLDivElement>(null);
  const permissionBtnRef = useRef<HTMLButtonElement>(null);
  const reasoningBtnRef = useRef<HTMLButtonElement>(null);
  const modelBtnRef = useRef<HTMLButtonElement>(null);
  const [mentionPopStyle, setMentionPopStyle] = useState<React.CSSProperties | null>(null);

  // Reset local compose state when switching conversations.
  useEffect(() => {
    setInput('');
    setSending(false);
    setPendingUserMessages([]);
    setLocalErrors([]);
    setMention(null);
    setMentionFiles([]);
    setAttachments([]);
    setMenu(null);
    setPermissionMode((conversation.executionMode as PermissionMode) || 'workspace');
  }, [conversation.id, conversation.executionMode]);

  // Resolve threadId from the bound task so we can project history for this conversation.
  useEffect(() => {
    let cancelled = false;
    const api = bridge();
    const taskId = conversation.taskId as TaskId | undefined;

    if (!api?.openTask || !taskId) {
      setThreadId(undefined);
      return;
    }

    void api
      .openTask({ taskId })
      .then((response: { task?: { threadId?: string } }) => {
        if (cancelled) return;
        const resolved = response?.task?.threadId;
        setThreadId(typeof resolved === 'string' && resolved.length > 0 ? resolved : undefined);
      })
      .catch(() => {
        if (!cancelled) setThreadId(undefined);
      });

    return () => {
      cancelled = true;
    };
  }, [conversation.id, conversation.taskId]);

  // Project durable history for this thread into chat messages.
  const projected = useMemo(() => {
    if (!threadId) {
      return {
        messages: [] as ChatMessage[],
        streaming: false,
        activeRunId: undefined as string | undefined,
      };
    }
    const projection = projectConversation(eventHistory, threadId, conversation.taskId);
    const messages: ChatMessage[] = projection.messages
      .filter(
        (message) =>
          message.text.trim().length > 0 ||
          Boolean(message.reasoningText?.trim()) ||
          message.streaming,
      )
      .map((message) => ({
        id: message.id,
        role: message.role,
        text: message.text,
        reasoningText: message.reasoningText,
        timestamp: message.occurredAt ?? '',
        streaming: message.streaming,
        runId: message.runId,
      }));
    const streaming = projection.stream.state === 'streaming';
    const activeRunId =
      (streaming ? projection.stream.runId : undefined) ||
      [...messages].reverse().find((message) => message.streaming && message.runId)?.runId;
    return {
      messages,
      streaming,
      activeRunId,
    };
  }, [conversation.taskId, eventHistory, threadId]);

  // Pending tool approvals for「询问批准」(from tool.approval_requested events).
  const pendingApprovals = useMemo(() => {
    if (!threadId) return [] as PendingToolApproval[];
    const byId = new Map<string, PendingToolApproval>();
    const ordered = [...eventHistory].sort((a, b) => a.sequence - b.sequence);
    for (const event of ordered) {
      const eventThread =
        typeof event.payload.threadId === 'string' ? event.payload.threadId : undefined;
      if (eventThread && eventThread !== threadId) continue;
      if (event.type === 'tool.approval_requested') {
        const approvalId =
          typeof event.payload.approvalId === 'string' ? event.payload.approvalId : event.id;
        byId.set(approvalId, {
          approvalId,
          runId: typeof event.payload.runId === 'string' ? event.payload.runId : event.runId,
          toolCallId:
            typeof event.payload.toolCallId === 'string' ? event.payload.toolCallId : undefined,
          toolName:
            typeof event.payload.toolName === 'string' ? event.payload.toolName : 'tool',
          title:
            typeof event.payload.title === 'string'
              ? event.payload.title
              : `需要批准：${String(event.payload.toolName ?? 'tool')}`,
          detail: typeof event.payload.detail === 'string' ? event.payload.detail : '',
          path: typeof event.payload.path === 'string' ? event.payload.path : undefined,
          command: typeof event.payload.command === 'string' ? event.payload.command : undefined,
        });
      } else if (event.type === 'tool.approval_decided') {
        const approvalId =
          typeof event.payload.approvalId === 'string' ? event.payload.approvalId : undefined;
        if (!approvalId) continue;
        const existing = byId.get(approvalId);
        if (existing) {
          existing.decided =
            event.payload.decision === 'approve' || event.payload.decision === 'deny'
              ? event.payload.decision
              : existing.decided;
        }
      }
    }
    // Only show unresolved approvals.
    return [...byId.values()].filter((item) => !item.decided);
  }, [eventHistory, threadId]);

  const [decidingApprovalId, setDecidingApprovalId] = useState<string | null>(null);

  const handleToolApproval = useCallback(
    async (approvalId: string, decision: 'approve' | 'deny') => {
      const api = bridge();
      if (!api?.decideToolApproval || decidingApprovalId) return;
      setDecidingApprovalId(approvalId);
      try {
        await api.decideToolApproval({ approvalId, decision });
      } catch (error) {
        setLocalErrors((prev) => [
          ...prev,
          {
            id: `err-appr-${Date.now()}`,
            role: 'system',
            text: `处理批准失败: ${error instanceof Error ? error.message : String(error)}`,
            timestamp: new Date().toISOString(),
          },
        ]);
      } finally {
        setDecidingApprovalId(null);
      }
    },
    [decidingApprovalId],
  );

  // Drop optimistic bubbles once the same user text lands in durable history.
  useEffect(() => {
    if (pendingUserMessages.length === 0) return;
    const durableUserTexts = new Set(
      projected.messages.filter((message) => message.role === 'user').map((message) => message.text),
    );
    setPendingUserMessages((prev) => prev.filter((message) => !durableUserTexts.has(message.text)));
  }, [pendingUserMessages.length, projected.messages]);

  // Clear "sending" once the run leaves the streaming state (or fails via local error).
  useEffect(() => {
    if (!sending && !stopping) return;
    if (!projected.streaming && pendingUserMessages.length === 0) {
      // Keep a tiny grace window so a just-started run isn't cleared before run.started arrives.
      const timer = window.setTimeout(() => {
        setSending(false);
        setStopping(false);
      }, 120);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [pendingUserMessages.length, projected.streaming, sending, stopping]);

  const messages = useMemo(() => {
    return [...projected.messages, ...pendingUserMessages, ...localErrors];
  }, [localErrors, pendingUserMessages, projected.messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending, projected.streaming]);

  const sendUserText = useCallback(
    async (text: string, images: MessageImage[] = []) => {
      const api = bridge();
      if (!api || (!text.trim() && images.length === 0) || sending) return;

      setSending(true);
      const tempId = `temp-${Date.now()}`;
      setPendingUserMessages((prev) => [
        ...prev,
        {
          id: tempId,
          role: 'user',
          text,
          images: images.length > 0 ? images : undefined,
          timestamp: new Date().toISOString(),
        },
      ]);

      try {
        const prep = await api.sendConversationMessage({
          conversationId: conversation.id,
          text,
        });
        if (typeof prep.threadId === 'string' && prep.threadId.length > 0) {
          setThreadId(prep.threadId);
        }
        const response = await api.appendMessage({
          threadId: prep.threadId,
          expectedTaskVersion: prep.taskVersion,
          role: 'user',
          text: text.trim()
            ? text
            : images.length > 0
              ? images.map((img) => `[图片] ${img.name}`).join('\n')
              : text,
          modelId: modelOverride || undefined,
          reasoningEffort: reasoningEffort === 'auto' ? undefined : reasoningEffort,
          networkEnabled: netEnabled || undefined,
          images:
            images.length > 0
              ? images.map((img) => ({
                  name: img.name || 'image',
                  mimeType: img.mimeType || 'image/png',
                  dataUrl: img.url,
                }))
              : undefined,
        });
        setPendingUserMessages((prev) =>
          prev.map((message) =>
            message.id === tempId
              ? { ...message, id: response.messageId, images: images.length > 0 ? images : message.images }
              : message,
          ),
        );
        onTitleUpdated(prep.conversationTitle || response.taskTitle || conversation.title || '');
      } catch (err) {
        setSending(false);
        setPendingUserMessages((prev) => prev.filter((message) => message.id !== tempId));
        setLocalErrors((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: 'system',
            text: `发送失败: ${(err as Error).message}`,
            timestamp: new Date().toISOString(),
          },
        ]);
      } finally {
        inputRef.current?.focus();
      }
    },
    [
      conversation.id,
      conversation.title,
      modelOverride,
      netEnabled,
      onTitleUpdated,
      reasoningEffort,
      sending,
    ],
  );

  const handleRegenerate = useCallback(
    async (assistantMessageId: string) => {
      if (sending) return;
      const idx = messages.findIndex((m) => m.id === assistantMessageId);
      if (idx <= 0) return;
      // Find nearest previous user message (NewMax: regenerate last turn).
      let userText = '';
      for (let i = idx - 1; i >= 0; i -= 1) {
        if (messages[i]?.role === 'user') {
          userText = messages[i]!.text;
          break;
        }
      }
      if (!userText.trim()) return;
      await sendUserText(userText);
    },
    [messages, sendUserText, sending],
  );

  const openChangeInRail = useCallback((path: string) => {
    setSelectedChangePath(path);
    setRailTab('changes');
    setRailOpen(true);
  }, []);

  const boundWorkspace = conversation.workspaceId
    ? workspaces.find((workspace) => workspace.workspaceId === conversation.workspaceId)
    : undefined;
  const projectFolder = boundWorkspace?.folderPath?.trim();
  const hasProjectFolder = Boolean(projectFolder);

  // Position the @ picker as a fixed portal above the compose box so parent
  // overflow:hidden (chat column / page flex) cannot clip it.
  useLayoutEffect(() => {
    if (!mention) {
      setMentionPopStyle(null);
      return;
    }
    const update = () => {
      const el = composeRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.min(r.width, 520);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const gap = 8;
      const maxH = Math.min(260, Math.max(120, r.top - gap - 8));
      setMentionPopStyle({
        position: 'fixed',
        left,
        width,
        bottom: window.innerHeight - r.top + gap,
        maxHeight: maxH,
        zIndex: 10000,
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [mention]);

  // Load project files when an @-mention is active.
  useEffect(() => {
    if (!mention) {
      setMentionFiles([]);
      setMentionLoading(false);
      return;
    }
    if (!projectFolder) {
      setMentionFiles([]);
      setMentionLoading(false);
      return;
    }
    const api = bridge();
    if (!api?.listProjectFiles) {
      setMentionFiles([]);
      return;
    }
    let cancelled = false;
    setMentionLoading(true);
    const handle = window.setTimeout(() => {
      void api
        .listProjectFiles({ root: projectFolder, query: mention.query, maxEntries: 40 })
        .then((result: { files?: Array<{ path: string; name: string; kind: 'file' | 'dir' }> }) => {
          if (cancelled) return;
          setMentionFiles(result.files ?? []);
          setMentionIndex(0);
          setMentionLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          setMentionFiles([]);
          setMentionLoading(false);
        });
    }, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [mention, projectFolder]);

  const closeMention = useCallback(() => {
    setMention(null);
    setMentionFiles([]);
    setMentionIndex(0);
  }, []);

  const resizeComposeInput = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    computeTextareaHeight(el, 56, 220);
  }, []);

  useLayoutEffect(() => {
    resizeComposeInput();
  }, [input, resizeComposeInput]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || sending) return;
    const outbound = buildMessageWithAttachments(input, attachments);
    const images = messageImagesFromAttachments(attachments);
    setInput('');
    setAttachments([]);
    closeMention();
    window.requestAnimationFrame(() => resizeComposeInput());
    await sendUserText(outbound, images);
  }, [attachments, closeMention, input, resizeComposeInput, sendUserText, sending]);

  /** NewMax: selecting a file becomes an attachment chip, not inline @path text. */
  const selectMentionFile = useCallback(
    (file: { path: string; name?: string; kind: 'file' | 'dir' }) => {
      const attachment: ComposeAttachment = {
        path: file.path,
        name: file.name || fileNameFromPath(file.path),
        kind: file.kind,
      };
      setAttachments((prev) => addAttachment(prev, attachment));
      if (mention) {
        const stripped = stripMentionToken(input, mention);
        setInput(stripped.text);
        window.requestAnimationFrame(() => {
          const el = inputRef.current;
          if (!el) return;
          el.focus();
          el.setSelectionRange(stripped.caret, stripped.caret);
          computeTextareaHeight(el, 56, 220);
        });
      } else {
        inputRef.current?.focus();
      }
      closeMention();
    },
    [closeMention, input, mention],
  );

  const addImageFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter(isImageFile);
    if (list.length === 0) return;
    const nextItems: ComposeAttachment[] = [];
    for (const file of list.slice(0, 8)) {
      try {
        const rawUrl = await readFileAsDataUrl(file);
        // Compress before staging so provider requests stay reasonable.
        const compressed = await compressImageDataUrl(rawUrl, {
          mimeType: file.type || 'image/png',
        });
        nextItems.push({
          path: `image:${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name}`,
          name: file.name || 'image',
          kind: 'image',
          previewUrl: compressed.dataUrl,
          mimeType: compressed.mimeType,
          sizeBytes: Math.floor(
            (compressed.dataUrl.length - compressed.dataUrl.indexOf(',') - 1) * 0.75,
          ),
        });
      } catch {
        /* skip unreadable file */
      }
    }
    if (nextItems.length === 0) return;
    setAttachments((prev) => {
      let next = [...prev];
      for (const item of nextItems) next = addAttachment(next, item);
      return next;
    });
  }, []);

  const handleImageInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) void addImageFiles(files);
      e.target.value = '';
    },
    [addImageFiles],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length === 0) return;
      e.preventDefault();
      void addImageFiles(files);
    },
    [addImageFiles],
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only clear when leaving the compose shell itself.
    if (e.currentTarget === e.target) setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) void addImageFiles(files);
    },
    [addImageFiles],
  );

  const updateMentionFromCaret = useCallback((text: string, caret: number) => {
    const next = detectMentionQuery(text, caret);
    setMention(next);
    if (!next) {
      setMentionFiles([]);
      setMentionIndex(0);
    }
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setInput(value);
      updateMentionFromCaret(value, e.target.selectionStart ?? value.length);
    },
    [updateMentionFromCaret],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // @-picker navigation takes priority while open.
      if (mention) {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeMention();
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setMentionIndex((i) =>
            mentionFiles.length === 0 ? 0 : (i + 1) % mentionFiles.length,
          );
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setMentionIndex((i) =>
            mentionFiles.length === 0
              ? 0
              : (i - 1 + mentionFiles.length) % mentionFiles.length,
          );
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          const selected = mentionFiles[mentionIndex];
          if (selected) {
            e.preventDefault();
            selectMentionFile(selected);
            return;
          }
        }
      }

      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        void handleSend();
      }
    },
    [
      closeMention,
      handleSend,
      mention,
      mentionFiles,
      mentionIndex,
      selectMentionFile,
    ],
  );

  const setPermission = useCallback(
    (next: PermissionMode) => {
      const prev = permissionMode;
      if (next === prev) return;
      setPermissionMode(next);
      const api = bridge();
      if (!api?.setConversationExecutionMode) return;
      void api
        .setConversationExecutionMode({
          conversationId: conversation.id,
          executionMode: next,
        })
        .then(() => {
          onConversationUpdated?.();
        })
        .catch((error: unknown) => {
          setPermissionMode(prev);
          setLocalErrors((errs) => [
            ...errs,
            {
              id: `err-perm-${Date.now()}`,
              role: 'system',
              text: `权限切换失败: ${error instanceof Error ? error.message : String(error)}`,
              timestamp: new Date().toISOString(),
            },
          ]);
        });
    },
    [conversation.id, onConversationUpdated, permissionMode],
  );

  const handleStop = useCallback(async () => {
    const api = bridge();
    const runId = projected.activeRunId;
    if (!api?.cancelRun || !runId || stopping) return;
    setStopping(true);
    try {
      await api.cancelRun({ runId: runId as RunId });
      setSending(false);
    } catch (error) {
      setLocalErrors((prev) => [
        ...prev,
        {
          id: `err-stop-${Date.now()}`,
          role: 'system',
          text: `停止失败: ${error instanceof Error ? error.message : String(error)}`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setStopping(false);
    }
  }, [projected.activeRunId, stopping]);

  const activeModelId = modelOverride || conversation.targetRef || '';
  const activeModel = modelOverride
    ? models.find((m) => m.modelId === modelOverride)?.displayName ?? modelOverride
    : modelName;

  // Context usage: sum tokens from latest provider.usage in this thread (approx).
  const contextUsed = useMemo(() => {
    let used = 0;
    for (const event of eventHistory) {
      if (event.type !== 'provider.usage') continue;
      const eventThread =
        typeof event.payload.threadId === 'string' ? event.payload.threadId : undefined;
      if (threadId && eventThread && eventThread !== threadId) continue;
      const inn =
        typeof event.payload.tokensIn === 'number'
          ? event.payload.tokensIn
          : typeof event.payload.inputTokens === 'number'
            ? event.payload.inputTokens
            : 0;
      const out =
        typeof event.payload.tokensOut === 'number'
          ? event.payload.tokensOut
          : typeof event.payload.outputTokens === 'number'
            ? event.payload.outputTokens
            : 0;
      used = Math.max(used, inn + out);
    }
    // Rough local estimate from visible text when no usage yet.
    if (used === 0) {
      const chars = messages.reduce((n, m) => n + m.text.length, 0) + input.length;
      used = Math.round(chars / 4);
    }
    return used;
  }, [eventHistory, input.length, messages, threadId]);

  const contextLimit = estimateContextWindow(activeModelId || activeModel);

  const PermIcon = PERMISSION_ICONS[permissionMode];
  const showTyping = sending || projected.streaming;
  const canStop = Boolean(projected.activeRunId) && (sending || projected.streaming);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* ─── Chat column ───────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden bg-page">
        {/* Header */}
        <div className="flex h-11 shrink-0 items-center border-b border-border bg-surface px-4">
          <span className="flex-1 truncate text-[13px] font-medium text-text">
            {conversation.title || modelName || '对话'}
          </span>
          {activeModel && (
            <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-[11px] text-text-faint">
              {activeModel}
            </span>
          )}
          <span
            className={`ml-2 max-w-[220px] truncate rounded-full border px-2 py-0.5 text-[11px] ${
              hasProjectFolder
                ? 'border-border text-text-faint'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
            }`}
            title={
              hasProjectFolder
                ? `项目目录：${projectFolder}`
                : '未绑定项目文件夹：模型看不到本地目录，也无法 list_files/read_file'
            }
          >
            {hasProjectFolder ? `📁 ${projectFolder}` : '未绑定项目文件夹'}
          </span>
          {/* Right rail toggle */}
          <button
            className={`ml-2 flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
              railOpen
                ? 'bg-accent-soft text-accent-text'
                : 'text-text-faint hover:bg-hover hover:text-text'
            }`}
            onClick={() => setRailOpen((v) => !v)}
            title={railOpen ? '收起右栏' : '展开 Changes'}
          >
            <PanelRight size={14} />
          </button>
        </div>
        {!hasProjectFolder ? (
          <div className="border-b border-amber-500/25 bg-amber-500/10 px-4 py-2 text-[12px] leading-relaxed text-amber-800 dark:text-amber-200">
            当前对话没有绑定本地项目文件夹，所以 AI 不能读取工作区目录。
            请先在顶栏选择/打开项目（带真实文件夹路径），再新建对话；或从该项目 Tab 下发起对话。
          </div>
        ) : null}

        {/* ─── Messages ───────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-0 py-6">
          {messages.length === 0 && !showTyping && (
            <div className="flex h-full items-center justify-center">
              <span className="text-[13px] text-text-faint">
                {conversation.taskId
                  ? '历史消息加载中，或发送消息开始对话'
                  : '发送消息开始对话'}
              </span>
            </div>
          )}
          <div className="mx-auto flex max-w-[680px] flex-col gap-6 px-4">
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                eventHistory={eventHistory}
                threadId={threadId}
                regenerating={sending}
                onRegenerate={() => void handleRegenerate(msg.id)}
                onOpenChange={openChangeInRail}
                onExpandRail={() => {
                  setRailTab('changes');
                  setRailOpen(true);
                }}
                onOpenImage={setLightbox}
              />
            ))}
            {pendingApprovals.map((approval) => (
              <ToolApprovalCard
                key={approval.approvalId}
                approval={approval}
                busy={decidingApprovalId === approval.approvalId}
                onApprove={() => void handleToolApproval(approval.approvalId, 'approve')}
                onDeny={() => void handleToolApproval(approval.approvalId, 'deny')}
              />
            ))}
            {showTyping &&
              !messages.some((message) => message.streaming) &&
              pendingApprovals.length === 0 && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* ─── Compose (NewMax-style) ─────────────────────────────────── */}
        <div className="shrink-0 px-4 pb-4 pt-2">
          <div className="mx-auto max-w-[720px]">
            <div
              className={`shell-compose relative ${dragOver ? 'is-dragover' : ''}`}
              ref={composeRef}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              {/* @ file picker — portal so chat column overflow cannot clip it */}
              {mention &&
                mentionPopStyle &&
                typeof document !== 'undefined' &&
                createPortal(
                  <div
                    ref={mentionListRef}
                    className="shell-mention-pop shell-mention-pop--portal"
                    style={mentionPopStyle}
                    data-testid="compose-mention-pop"
                    role="listbox"
                  >
                    {!hasProjectFolder ? (
                      <div className="shell-mention-pop__empty">
                        未绑定项目文件夹，无法 @ 引用本地文件
                      </div>
                    ) : mentionLoading ? (
                      <div className="shell-mention-pop__empty">搜索文件…</div>
                    ) : mentionFiles.length === 0 ? (
                      <div className="shell-mention-pop__empty">
                        {mention.query ? '无匹配文件' : '输入以过滤项目文件'}
                      </div>
                    ) : (
                      mentionFiles.map((file, index) => (
                        <button
                          key={`${file.kind}:${file.path}`}
                          type="button"
                          role="option"
                          aria-selected={index === mentionIndex}
                          className={`shell-mention-pop__item ${
                            index === mentionIndex ? 'is-active' : ''
                          }`}
                          onMouseEnter={() => setMentionIndex(index)}
                          onMouseDown={(ev) => {
                            ev.preventDefault();
                            selectMentionFile(file);
                          }}
                        >
                          <span className="shell-mention-pop__icon">
                            {file.kind === 'dir' ? (
                              <FolderOpen size={13} />
                            ) : (
                              <FileCode2 size={13} />
                            )}
                          </span>
                          <span className="shell-mention-pop__path" title={file.path}>
                            {file.path}
                          </span>
                          <span className="shell-mention-pop__kind">
                            {file.kind === 'dir' ? '目录' : '文件'}
                          </span>
                        </button>
                      ))
                    )}
                  </div>,
                  document.body,
                )}

              {/* Attachment chips (NewMax: selected @ files / images become chips) */}
              {attachments.length > 0 && (
                <div className="shell-compose__chips" data-testid="compose-attachments">
                  {attachments.map((file) => (
                    <div
                      key={file.path}
                      className="shell-attach-chip"
                      title={file.path}
                      data-kind={file.kind}
                    >
                      {file.kind === 'image' && file.previewUrl ? (
                        <button
                          type="button"
                          className="shell-attach-chip__thumb"
                          title="点击查看"
                          onClick={() =>
                            setLightbox({
                              id: file.path,
                              name: file.name,
                              url: file.previewUrl!,
                              mimeType: file.mimeType,
                            })
                          }
                        >
                          <img src={file.previewUrl} alt={file.name} />
                        </button>
                      ) : (
                        <span className="shell-attach-chip__icon">
                          {file.kind === 'dir' ? (
                            <FolderOpen size={14} />
                          ) : (
                            <FileCode2 size={14} />
                          )}
                        </span>
                      )}
                      <span className="shell-attach-chip__name">{file.name}</span>
                      <button
                        type="button"
                        className="shell-attach-chip__remove"
                        title="移除"
                        onClick={() =>
                          setAttachments((prev) => removeAttachment(prev, file.path))
                        }
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <textarea
                ref={inputRef}
                className="shell-compose__input"
                placeholder={
                  hasProjectFolder
                    ? '有什么我能帮你的吗？输入 @ 引用文件，可粘贴/上传图片'
                    : '有什么我能帮你的吗？可粘贴或上传图片'
                }
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onClick={(e) =>
                  updateMentionFromCaret(
                    e.currentTarget.value,
                    e.currentTarget.selectionStart ?? 0,
                  )
                }
                onSelect={(e) =>
                  updateMentionFromCaret(
                    e.currentTarget.value,
                    e.currentTarget.selectionStart ?? 0,
                  )
                }
                rows={1}
                disabled={sending}
              />

              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                className="shell-compose__file-input"
                onChange={handleImageInputChange}
                tabIndex={-1}
              />

              {/* Bottom toolbar */}
              <div className="shell-compose__bar">
                <div className="shell-compose__bar-left">
                  {/* Permission menu */}
                  <div className="shell-compose__tool-wrap">
                    <button
                      ref={permissionBtnRef}
                      type="button"
                      className="shell-compose__tool"
                      data-active={menu === 'permission' || permissionMode !== 'workspace' ? '1' : '0'}
                      onClick={() =>
                        setMenu((m) => (m === 'permission' ? null : 'permission'))
                      }
                      title={`权限：${PERMISSION_LABELS[permissionMode]}`}
                    >
                      <PermIcon size={15} />
                      <span className="shell-compose__tool-label">
                        {PERMISSION_LABELS[permissionMode]}
                      </span>
                    </button>
                    <PermissionMenu
                      open={menu === 'permission'}
                      value={permissionMode}
                      anchorEl={permissionBtnRef.current}
                      onClose={() => setMenu(null)}
                      onChange={setPermission}
                    />
                  </div>

                  {/* Network */}
                  <button
                    type="button"
                    className="shell-compose__tool"
                    data-active={netEnabled ? '1' : '0'}
                    onClick={() => setNetEnabled((v) => !v)}
                    title={netEnabled ? '联网已开（点击关闭）' : '联网已关（点击开启）'}
                  >
                    <Globe size={15} />
                  </button>

                  {/* Reasoning menu — fixed full ladder */}
                  <div className="shell-compose__tool-wrap">
                    <button
                      ref={reasoningBtnRef}
                      type="button"
                      className="shell-compose__tool"
                      data-active={menu === 'reasoning' || reasoningEffort !== 'auto' ? '1' : '0'}
                      onClick={() =>
                        setMenu((m) => (m === 'reasoning' ? null : 'reasoning'))
                      }
                      title={`推理强度：${REASONING_LABELS[reasoningEffort]}`}
                    >
                      <Brain size={15} />
                      <span className="shell-compose__tool-label">
                        {REASONING_LABELS[reasoningEffort]}
                      </span>
                    </button>
                    <ReasoningMenu
                      open={menu === 'reasoning'}
                      value={reasoningEffort}
                      anchorEl={reasoningBtnRef.current}
                      onClose={() => setMenu(null)}
                      onChange={setReasoningEffort}
                    />
                  </div>

                  {/* Image upload */}
                  <button
                    type="button"
                    className="shell-compose__tool"
                    title="上传图片"
                    disabled={sending}
                    onClick={() => imageInputRef.current?.click()}
                  >
                    <ImagePlus size={15} />
                  </button>

                  {/* Skill placeholder (P6) */}
                  <button
                    type="button"
                    className="shell-compose__tool"
                    title="Skill（即将支持）"
                    disabled
                  >
                    <Puzzle size={15} />
                  </button>
                </div>

                <div className="shell-compose__bar-right">
                  {/* Two-level model picker */}
                  <div className="shell-compose__tool-wrap">
                    <ModelTrigger
                      label={activeModel || '选择模型'}
                      open={menu === 'model'}
                      buttonRef={modelBtnRef}
                      onClick={() => setMenu((m) => (m === 'model' ? null : 'model'))}
                    />
                    <ModelPickerMenu
                      open={menu === 'model'}
                      models={models}
                      selectedModelId={modelOverride}
                      defaultLabel={modelName || '默认模型'}
                      anchorEl={modelBtnRef.current}
                      onClose={() => setMenu(null)}
                      onPick={setModelOverride}
                    />
                  </div>

                  {/* Context window ring */}
                  <ContextRing used={contextUsed} limit={contextLimit} />

                  {/* Send / Stop */}
                  {canStop ? (
                    <button
                      type="button"
                      className="shell-compose__send is-stop"
                      onClick={() => void handleStop()}
                      disabled={stopping}
                      title="停止生成"
                      data-testid="compose-stop"
                    >
                      <Square size={12} fill="currentColor" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="shell-compose__send"
                      onClick={() => void handleSend()}
                      disabled={(!input.trim() && attachments.length === 0) || sending}
                      title="发送 (Enter)"
                      data-testid="compose-send"
                    >
                      <SendHorizonal size={15} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* end chat column */}

      {/* ─── Right Rail ──────────────────────────────────────────────── */}
      {railOpen && (
        <RightRail
          conversationId={conversation.id}
          eventHistory={eventHistory}
          threadId={threadId}
          activeTab={railTab}
          selectedChangePath={selectedChangePath}
          onTabChange={setRailTab}
          onSelectChangePath={setSelectedChangePath}
          onClose={() => setRailOpen(false)}
        />
      )}

      {lightbox && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="shell-lightbox"
              role="dialog"
              aria-modal="true"
              aria-label={lightbox.name || '图片预览'}
              onClick={() => setLightbox(null)}
            >
              <button
                type="button"
                className="shell-lightbox__close"
                title="关闭"
                onClick={() => setLightbox(null)}
              >
                <X size={18} />
              </button>
              <img
                className="shell-lightbox__img"
                src={lightbox.url}
                alt={lightbox.name || '预览'}
                onClick={(e) => e.stopPropagation()}
              />
              {lightbox.name ? (
                <div className="shell-lightbox__caption">{lightbox.name}</div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({
  message,
  eventHistory,
  threadId,
  regenerating,
  onRegenerate,
  onOpenChange,
  onExpandRail,
  onOpenImage,
}: {
  message: ChatMessage;
  eventHistory: readonly Event[];
  threadId?: string;
  regenerating?: boolean;
  onRegenerate?: () => void;
  onOpenChange?: (path: string) => void;
  onExpandRail?: () => void;
  onOpenImage?: (image: MessageImage) => void;
}) {
  const isUser = message.role === 'user';
  const isError = message.role === 'system';
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);

  const usage = useMemo(() => {
    if (message.role !== 'assistant') return undefined;
    const view = projectExecutionProcess(eventHistory, {
      threadId,
      runId: message.runId,
    });
    return formatTokenUsage(view.tokensIn, view.tokensOut);
  }, [eventHistory, message.role, message.runId, threadId]);

  const handleCopy = useCallback(async () => {
    if (!message.text.trim()) return;
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore */
    }
  }, [message.text]);

  const handleShare = useCallback(async () => {
    if (!message.text.trim()) return;
    try {
      await navigator.clipboard.writeText(message.text);
      setShared(true);
      window.setTimeout(() => setShared(false), 1400);
    } catch {
      /* ignore */
    }
  }, [message.text]);

  if (isUser) {
    const images = message.images ?? [];
    return (
      <div className="shell-msg shell-msg--user group relative flex justify-end">
        <div className="shell-user-bubble max-w-[78%] rounded-2xl rounded-br-sm bg-accent px-4 py-3 text-[13.5px] leading-relaxed text-white shadow-sm">
          {images.length > 0 ? (
            <div className="shell-msg-images shell-msg-images--user">
              {images.map((img) => (
                <button
                  key={img.id}
                  type="button"
                  className="shell-msg-image-btn"
                  title={img.name || '点击查看'}
                  onClick={() => onOpenImage?.(img)}
                >
                  <img src={img.url} alt={img.name || '图片'} />
                </button>
              ))}
            </div>
          ) : null}
          {message.text ? (
            <div className="whitespace-pre-wrap break-words">{message.text}</div>
          ) : null}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="shell-msg group relative flex justify-start">
        <div className="max-w-[80%] rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-[12.5px] text-red-600 dark:border-red-900/40 dark:bg-red-900/15 dark:text-red-400">
          {message.text}
        </div>
      </div>
    );
  }

  // AI message — thinking + process + file changes + markdown + NewMax-style footer
  return (
    <div className="shell-msg shell-msg--assistant group relative flex items-start gap-3">
      <div className="shell-ai-avatar mt-0.5">
        <Bot size={13} />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <ReasoningBlock
          text={message.reasoningText}
          streaming={Boolean(message.streaming && !message.text.trim())}
        />
        <ExecutionProcessBlock
          events={eventHistory}
          threadId={threadId}
          runId={message.runId}
          forceExpanded={Boolean(message.streaming)}
          onOpenChange={onOpenChange}
        />
        <FileChangesCard
          events={eventHistory}
          threadId={threadId}
          runId={message.runId}
          onOpenChange={onOpenChange}
          onExpandRail={onExpandRail}
        />
        {message.text ? (
          <MarkdownContent text={message.text} streaming={Boolean(message.streaming)} />
        ) : message.streaming && !message.reasoningText?.trim() ? (
          <TypingDots inline />
        ) : null}

        {!message.streaming && message.text.trim() ? (
          <div className="shell-msg-footer">
            <div className="shell-msg-footer__actions">
              <button
                type="button"
                className="shell-msg-footer__btn"
                onClick={() => void handleCopy()}
                title="复制"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                <span>{copied ? '已复制' : '复制'}</span>
              </button>
              <button
                type="button"
                className="shell-msg-footer__btn"
                onClick={onRegenerate}
                disabled={regenerating}
                title="重新生成"
              >
                <RefreshCw size={13} className={regenerating ? 'shell-process-spin' : ''} />
                <span>重新生成</span>
              </button>
              <button
                type="button"
                className="shell-msg-footer__btn"
                onClick={() => void handleShare()}
                title="分享（先复制 Markdown）"
              >
                <Share2 size={13} />
                <span>{shared ? '已复制' : '分享'}</span>
              </button>
            </div>
            {usage ? <span className="shell-msg-footer__usage">{usage}</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── Depth thinking / reasoning block (NewMax-style) ─────────────────────────

function ReasoningBlock({
  text,
  streaming,
}: {
  text?: string;
  streaming?: boolean;
}) {
  const content = (text ?? '').trim();
  const [open, setOpen] = useState(Boolean(streaming));

  useEffect(() => {
    // While only thinking (no final answer yet), keep expanded; collapse after answer arrives.
    if (streaming) setOpen(true);
  }, [streaming]);

  if (!content && !streaming) return null;

  return (
    <div className={`shell-reasoning ${open ? 'is-open' : ''}`} data-streaming={streaming ? '1' : '0'}>
      <button
        type="button"
        className="shell-reasoning__toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Brain size={13} className="shell-reasoning__icon" />
        <span className="shell-reasoning__title">
          {streaming ? '深度思考中…' : '深度思考'}
        </span>
        <span className="shell-reasoning__chev" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open ? (
        <div className="shell-reasoning__body">
          {content ? (
            <pre className="shell-reasoning__text">{content}</pre>
          ) : (
            <div className="shell-reasoning__placeholder">正在思考…</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ─── Tool approval card（询问批准） ───────────────────────────────────────────

function ToolApprovalCard({
  approval,
  busy,
  onApprove,
  onDeny,
}: {
  approval: PendingToolApproval;
  busy?: boolean;
  onApprove(): void;
  onDeny(): void;
}) {
  const isWrite = approval.toolName === 'write_file';
  const Icon = isWrite ? FileWarning : Terminal;
  return (
    <div
      className="shell-approval-card"
      data-testid={`tool-approval-${approval.approvalId}`}
      data-tool={approval.toolName}
    >
      <div className="shell-approval-card__head">
        <span className="shell-approval-card__icon">
          <Icon size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="shell-approval-card__title">{approval.title}</div>
          <div className="shell-approval-card__subtitle">
            询问批准 · 需要你确认后才会执行
          </div>
        </div>
      </div>
      {(approval.path || approval.command || approval.detail) && (
        <div className="shell-approval-card__body">
          {approval.path ? (
            <div className="shell-approval-card__meta">
              <span className="shell-approval-card__meta-key">路径</span>
              <code className="shell-approval-card__meta-val">{approval.path}</code>
            </div>
          ) : null}
          {approval.command ? (
            <div className="shell-approval-card__meta">
              <span className="shell-approval-card__meta-key">命令</span>
              <code className="shell-approval-card__meta-val">{approval.command}</code>
            </div>
          ) : null}
          {approval.detail ? (
            <div className="shell-approval-card__detail">{approval.detail}</div>
          ) : null}
        </div>
      )}
      <div className="shell-approval-card__actions">
        <button
          type="button"
          className="shell-approval-card__btn is-deny"
          disabled={busy}
          onClick={onDeny}
        >
          <X size={13} />
          拒绝
        </button>
        <button
          type="button"
          className="shell-approval-card__btn is-approve"
          disabled={busy}
          onClick={onApprove}
        >
          <Check size={13} />
          {busy ? '处理中…' : '批准执行'}
        </button>
      </div>
    </div>
  );
}

// ─── Typing Indicator ─────────────────────────────────────────────────────────

function TypingDots({ inline = false }: { inline?: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 ${inline ? '' : 'pt-3'}`}>
      {[0, 1, 2].map((i) => (
        <span key={i} className="shell-typing-dot" style={{ animationDelay: `${i * 160}ms` }} />
      ))}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-start gap-3">
      <div className="shell-ai-avatar mt-0.5">
        <Bot size={13} />
      </div>
      <TypingDots />
    </div>
  );
}
