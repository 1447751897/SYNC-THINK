import { describe, expect, it } from 'vitest';
import {
  createAsyncEvent,
  createBotPushEvent,
  createFileEvent,
  createGitPushEvent,
  createWebhookEvent,
} from '../src/daemon/external-event-adapters.js';

const route = {
  target: { kind: 'model' as const, modelId: 'model-1' },
  workspaceId: 'workspace-1',
  skillVersionIds: ['skill-1'],
  conversationKey: 'repo:sync-think',
};

describe('external event producer adapters', () => {
  it('maps Git push deliveries to a stable dedupe key and conversation', () => {
    const event = createGitPushEvent({
      ...route,
      deliveryId: 'delivery-123',
      provider: 'github',
      repository: 'acme/sync-think',
      ref: 'refs/heads/main',
      before: 'abc',
      after: 'def',
      commits: [{ id: 'def', message: 'ship it' }],
    });

    expect(event).toMatchObject({
      dedupeKey: 'git:github:delivery-123',
      source: { kind: 'git', name: 'github' },
      conversationKey: 'repo:sync-think',
      metadata: { repository: 'acme/sync-think', ref: 'refs/heads/main', after: 'def' },
    });
  });

  it('sanitizes secrets before a generic webhook payload enters durable storage', () => {
    const event = createWebhookEvent({
      ...route,
      integration: 'build-system',
      deliveryId: 'build-42',
      instruction: '分析构建失败原因',
      payload: {
        build: { id: 42, status: 'failed' },
        authorization: 'Bearer secret',
        nested: { apiKey: 'secret-key', log: 'compile failed' },
      },
    });

    expect(JSON.stringify(event.metadata)).not.toContain('secret');
    expect(event.metadata).toMatchObject({
      build: { id: 42, status: 'failed' },
      nested: { log: 'compile failed' },
    });
  });

  it('creates deterministic file, bot-push and async-job dedupe identities', () => {
    const file = createFileEvent({
      ...route,
      path: 'D:/repo/spec.md',
      action: 'change',
      observedAt: '2026-08-21T00:00:00.000Z',
      fingerprint: 'sha256:abc',
    });
    const bot = createBotPushEvent({
      ...route,
      platform: 'feishu',
      channelId: 'chat-1',
      message: '构建完成',
      idempotencyKey: 'run-1:terminal',
    });
    const asyncJob = createAsyncEvent({
      ...route,
      jobId: 'job-1',
      instruction: '后台整理本周提交',
      payload: { week: 34 },
    });

    expect(file.dedupeKey).toBe('file:D:/repo/spec.md:change:sha256:abc');
    expect(bot).toMatchObject({
      dedupeKey: 'bot:feishu:run-1:terminal',
      source: { kind: 'bot', name: 'feishu' },
      metadata: { direction: 'outbound', channelId: 'chat-1', message: '构建完成' },
    });
    expect(asyncJob.dedupeKey).toBe('async:job-1');
  });
});
