import { ulid, type ExternalEventEnvelope, type ScheduledTaskTarget } from '@sync-think/shared';

export interface ExternalEventRoute {
  target: ScheduledTaskTarget;
  workspaceId?: string;
  skillVersionIds?: string[];
  conversationKey?: string;
  title?: string;
}

const SECRET_KEY = /^(authorization|proxy-authorization|token|access_token|refresh_token|secret|password|cookie|set-cookie|signature|api[-_]?key)$/i;

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[truncated]';
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.length > 8_000 ? `${value.slice(0, 8_000)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item, depth + 1));
  if (!value || typeof value !== 'object') return String(value ?? '');
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 200)) {
    if (SECRET_KEY.test(key)) continue;
    result[key] = sanitize(item, depth + 1);
  }
  return result;
}

function metadata(value: unknown): Record<string, unknown> {
  const cleaned = sanitize(value);
  return cleaned && typeof cleaned === 'object' && !Array.isArray(cleaned)
    ? (cleaned as Record<string, unknown>)
    : { value: cleaned };
}

function base(
  route: ExternalEventRoute,
  input: Pick<ExternalEventEnvelope, 'dedupeKey' | 'source' | 'instruction'> & {
    metadata?: Record<string, unknown>;
  },
): ExternalEventEnvelope {
  return {
    id: `evt-${ulid()}`,
    dedupeKey: input.dedupeKey,
    source: input.source,
    instruction: input.instruction,
    target: route.target,
    ...(route.workspaceId ? { workspaceId: route.workspaceId } : {}),
    skillVersionIds: route.skillVersionIds ?? [],
    ...(route.conversationKey ? { conversationKey: route.conversationKey } : {}),
    ...(route.title ? { title: route.title } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

export function createWebhookEvent(
  input: ExternalEventRoute & {
    integration: string;
    deliveryId: string;
    instruction: string;
    payload: unknown;
  },
): ExternalEventEnvelope {
  return base(input, {
    dedupeKey: `webhook:${input.integration}:${input.deliveryId}`,
    source: { kind: 'webhook', name: input.integration },
    instruction: input.instruction,
    metadata: metadata(input.payload),
  });
}

export function createGitPushEvent(
  input: ExternalEventRoute & {
    provider: string;
    deliveryId: string;
    repository: string;
    ref: string;
    before?: string;
    after: string;
    commits?: unknown[];
    instruction?: string;
  },
): ExternalEventEnvelope {
  return base(input, {
    dedupeKey: `git:${input.provider}:${input.deliveryId}`,
    source: { kind: 'git', name: input.provider },
    instruction: input.instruction ?? '检查这次 Git push，概括变更并指出需要处理的风险。',
    metadata: metadata({
      repository: input.repository,
      ref: input.ref,
      before: input.before,
      after: input.after,
      commits: input.commits ?? [],
    }),
  });
}

export function createFileEvent(
  input: ExternalEventRoute & {
    path: string;
    action: 'rename' | 'change' | 'create' | 'delete';
    observedAt: string;
    fingerprint: string;
    instruction?: string;
  },
): ExternalEventEnvelope {
  return base(input, {
    dedupeKey: `file:${input.path}:${input.action}:${input.fingerprint}`,
    source: { kind: 'file' },
    instruction: input.instruction ?? '检查文件变化，并根据当前会话目标处理需要更新的内容。',
    metadata: metadata({
      path: input.path,
      action: input.action,
      observedAt: input.observedAt,
      fingerprint: input.fingerprint,
    }),
  });
}

export function createBotPushEvent(
  input: ExternalEventRoute & {
    platform: string;
    channelId: string;
    message: string;
    idempotencyKey: string;
    instruction?: string;
  },
): ExternalEventEnvelope {
  return base(input, {
    dedupeKey: `bot:${input.platform}:${input.idempotencyKey}`,
    source: { kind: 'bot', name: input.platform },
    instruction:
      input.instruction ??
      '使用已配置的 push_to_bot 能力，把事件数据中的消息投递到指定频道。',
    metadata: metadata({
      direction: 'outbound',
      channelId: input.channelId,
      message: input.message,
    }),
  });
}

export function createAsyncEvent(
  input: ExternalEventRoute & {
    jobId: string;
    instruction: string;
    payload?: unknown;
  },
): ExternalEventEnvelope {
  return base(input, {
    dedupeKey: `async:${input.jobId}`,
    source: { kind: 'async' },
    instruction: input.instruction,
    ...(input.payload === undefined ? {} : { metadata: metadata(input.payload) }),
  });
}
