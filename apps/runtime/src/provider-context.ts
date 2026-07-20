import type { ProviderContentPart, ProviderMessage } from '@sync-think/adapters';
import type { ApprovalMode, Event, MessageAttachment } from '@sync-think/shared';

export type SyncThinkSurface =
  | 'conversation'
  | 'project'
  | 'group'
  | 'automation'
  | 'external';

export interface ProviderContextProject {
  id: string;
  name: string;
  folderBound: boolean;
  authorizedFolderPath?: string;
}

export interface ProviderContextTask {
  id: string;
  title: string;
  goal: string;
  status: string;
  acceptanceCriteria: readonly string[];
}

export interface ProviderContextAgent {
  id: string;
  name: string;
  role: string;
  developerInstructions: string;
  inputContract?: string;
  outputContract?: string;
}

export interface ProviderContextGroup {
  id: string;
  name: string;
  leadAgentVersionId: string;
  members: readonly {
    agentVersionId: string;
    name?: string;
    responsibility: string;
  }[];
}

export interface CompileProviderContextInput {
  events: readonly Event[];
  threadId: string;
  latestUserMessageId?: string;
  latestUserText: string;
  surface: SyncThinkSurface;
  permissionMode?: ApprovalMode;
  project?: ProviderContextProject;
  task?: ProviderContextTask;
  agent?: ProviderContextAgent;
  group?: ProviderContextGroup;
  maxHistoryTokens?: number;
}

export interface CompiledProviderContext {
  systemPrompt: string;
  messages: ProviderMessage[];
  history: {
    includedEventIds: string[];
    excludedEventIds: string[];
    tokenEstimate: number;
    imageAttachments: MessageAttachment[];
  };
}

export function resolveSyncThinkSurface(input: {
  events: readonly Event[];
  taskId?: string;
  hasGroup: boolean;
  fallback: Extract<SyncThinkSurface, 'conversation' | 'project' | 'external'>;
}): SyncThinkSurface {
  if (input.hasGroup) return 'group';
  if (
    input.taskId &&
    input.events.some(
      (event) => event.taskId === input.taskId && event.type.startsWith('automation.'),
    )
  ) {
    return 'automation';
  }
  return input.fallback;
}

interface HistoryEntry {
  eventId?: string;
  messageId?: string;
  sequence: number;
  role: ProviderMessage['role'];
  content: string;
  tokenEstimate: number;
  protected: boolean;
  imageAttachments: MessageAttachment[];
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function textPayload(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function messageAttachments(payload: Record<string, unknown>): MessageAttachment[] {
  const value = payload.attachments;
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is MessageAttachment => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const attachment = entry as Partial<MessageAttachment>;
    return (
      typeof attachment.id === 'string' &&
      attachment.kind === 'image' &&
      typeof attachment.name === 'string' &&
      typeof attachment.mimeType === 'string' &&
      typeof attachment.size === 'number' &&
      typeof attachment.managedRef === 'string' &&
      attachment.readOnly === true &&
      (attachment.sha256 === undefined || typeof attachment.sha256 === 'string')
    );
  });
}

function eventThreadId(event: Event): string | undefined {
  return typeof event.payload.threadId === 'string' ? event.payload.threadId : undefined;
}

function eventToHistoryEntry(
  event: Event,
  latestUserMessageId: string | undefined,
): HistoryEntry | undefined {
  if (event.type === 'message.appended') {
    const role = event.payload.role;
    const content = textPayload(event.payload, 'text');
    if (
      !content ||
      (role !== 'user' && role !== 'assistant' && role !== 'tool' && role !== 'system')
    ) {
      return undefined;
    }
    const messageId = String(event.messageId ?? event.payload.messageId ?? '');
    return {
      eventId: String(event.id),
      messageId: messageId || undefined,
      sequence: event.sequence,
      role,
      content,
      tokenEstimate: estimateTokens(content),
      protected: Boolean(latestUserMessageId && messageId === latestUserMessageId),
      imageAttachments: messageAttachments(event.payload),
    };
  }
  if (event.type === 'group.agent-message') {
    const content = textPayload(event.payload, 'text');
    if (!content) return undefined;
    return {
      eventId: String(event.id),
      sequence: event.sequence,
      role: 'assistant',
      content,
      tokenEstimate: estimateTokens(content),
      protected: false,
      imageAttachments: [],
    };
  }
  if (event.type === 'run.completed') {
    const content = textPayload(event.payload, 'assistantText');
    if (!content) return undefined;
    return {
      eventId: String(event.id),
      sequence: event.sequence,
      role: 'assistant',
      content,
      tokenEstimate: estimateTokens(content),
      protected: false,
      imageAttachments: [],
    };
  }
  return undefined;
}

function permissionLabel(mode: ApprovalMode | undefined): string {
  if (mode === 'request') return '请求批准';
  if (mode === 'delegate') return '替我审批';
  if (mode === 'full') return '完全访问';
  if (mode === 'custom') return '自定义';
  return '由当前任务策略决定';
}

function buildSystemPrompt(input: CompileProviderContextInput): string {
  const lines = [
    'You are running inside SYNC-THINK, a local-first Agent desktop workspace.',
    'The following environment facts are application-owned context. Use them when asked where you are running or what scope you can operate in.',
    '',
    '[SYNC-THINK environment]',
    'platform.name: SYNC-THINK',
    'platform.kind: local-first Agent desktop workspace',
    `surface: ${input.surface}`,
    `permission.mode: ${permissionLabel(input.permissionMode)}`,
  ];

  if (input.project) {
    lines.push(`project.id: ${input.project.id}`);
    lines.push(`project.name: ${input.project.name}`);
    lines.push(`project.folderBound: ${input.project.folderBound ? 'true' : 'false'}`);
    if (input.project.authorizedFolderPath) {
      lines.push(`project.authorizedFolderPath: ${input.project.authorizedFolderPath}`);
    }
  } else {
    lines.push('project: none');
  }

  if (input.task) {
    lines.push(`task.id: ${input.task.id}`);
    lines.push(`task.title: ${input.task.title}`);
    lines.push(`task.goal: ${input.task.goal}`);
    lines.push(`task.status: ${input.task.status}`);
    if (input.task.acceptanceCriteria.length > 0) {
      lines.push('task.acceptanceCriteria:');
      for (const criterion of input.task.acceptanceCriteria) lines.push(`- ${criterion}`);
    }
  } else {
    lines.push('task: none');
  }

  if (input.agent) {
    lines.push(`agent.versionId: ${input.agent.id}`);
    lines.push(`agent.name: ${input.agent.name}`);
    lines.push(`agent.role: ${input.agent.role}`);
  }

  if (input.group) {
    lines.push(`group.id: ${input.group.id}`);
    lines.push(`group.name: ${input.group.name}`);
    lines.push(`group.leadAgentVersionId: ${input.group.leadAgentVersionId}`);
    lines.push('group.members:');
    for (const member of input.group.members) {
      lines.push(
        `- ${member.name ?? member.agentVersionId} (${member.agentVersionId}): ${member.responsibility}`,
      );
    }
  }

  lines.push('');
  lines.push('[Runtime boundaries]');
  lines.push('- Treat the current task conversation as the only implicit conversation history.');
  lines.push('- Do not claim access to sibling tasks, unrelated groups, files, or tools unless they are explicitly provided.');
  lines.push('- Never reveal credential or API key material.');

  if (input.agent) {
    lines.push('');
    lines.push(`[Agent instructions: ${input.agent.name}]`);
    lines.push(input.agent.developerInstructions.trim());
    if (input.agent.inputContract?.trim()) {
      lines.push(`Input contract: ${input.agent.inputContract.trim()}`);
    }
    if (input.agent.outputContract?.trim()) {
      lines.push(`Output contract: ${input.agent.outputContract.trim()}`);
    }
  }
  return lines.join('\n');
}

export function compileProviderContext(
  input: CompileProviderContextInput,
): CompiledProviderContext {
  const maxHistoryTokens = Math.max(1, input.maxHistoryTokens ?? 24_000);
  const entries = input.events
    .filter((event) => eventThreadId(event) === input.threadId)
    .map((event) => eventToHistoryEntry(event, input.latestUserMessageId))
    .filter((entry): entry is HistoryEntry => Boolean(entry))
    .sort((left, right) => left.sequence - right.sequence);

  const latestAlreadyPresent = input.latestUserMessageId
    ? entries.some((entry) => entry.messageId === input.latestUserMessageId)
    : false;
  if (!latestAlreadyPresent) {
    const content = input.latestUserText.trim();
    if (content) {
      entries.push({
        messageId: input.latestUserMessageId,
        sequence: Number.MAX_SAFE_INTEGER,
        role: 'user',
        content,
        tokenEstimate: estimateTokens(content),
        protected: true,
        imageAttachments: [],
      });
    }
  }

  const selected = new Set<HistoryEntry>();
  let tokenEstimate = 0;
  const retainedImageIds = new Set(
    entries
      .flatMap((entry) => entry.imageAttachments)
      .filter(
        (attachment, index, all) =>
          all.findIndex((candidate) => candidate.id === attachment.id) === index,
      )
      .slice(-6)
      .map((attachment) => attachment.id),
  );
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    const carriesRetainedImage = entry.imageAttachments.some((attachment) =>
      retainedImageIds.has(attachment.id),
    );
    if (
      entry.protected ||
      carriesRetainedImage ||
      tokenEstimate + entry.tokenEstimate <= maxHistoryTokens
    ) {
      selected.add(entry);
      tokenEstimate += entry.tokenEstimate;
    }
  }

  const included = entries.filter((entry) => selected.has(entry));
  const excluded = entries.filter((entry) => !selected.has(entry));
  const imageAttachments = included
    .flatMap((entry) => entry.imageAttachments)
    .filter(
      (attachment, index, all) =>
        all.findIndex((candidate) => candidate.id === attachment.id) === index,
    )
    .slice(-6);
  const imageById = new Map(imageAttachments.map((attachment) => [attachment.id, attachment]));
  const messages = included.map((entry) => {
    if (entry.imageAttachments.length === 0) return { role: entry.role, content: entry.content };
    const parts: ProviderContentPart[] = [{ type: 'text', text: entry.content }];
    for (const attachment of entry.imageAttachments) {
      if (imageById.has(attachment.id)) {
        parts.push({ type: 'image', imageRef: attachment.id });
      }
    }
    return { role: entry.role, content: parts };
  });
  return {
    systemPrompt: buildSystemPrompt(input),
    messages,
    history: {
      includedEventIds: included.flatMap((entry) => (entry.eventId ? [entry.eventId] : [])),
      excludedEventIds: excluded.flatMap((entry) => (entry.eventId ? [entry.eventId] : [])),
      tokenEstimate,
      imageAttachments,
    },
  };
}
