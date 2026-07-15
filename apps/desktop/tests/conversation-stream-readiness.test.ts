import { describe, expect, it } from 'vitest';
import {
  classifyStreamFailure,
  projectConversationStreamReadiness,
  scrubFailureText,
} from '../src/renderer/conversation-stream-readiness.js';

describe('scrubFailureText', () => {
  it('redacts api-key-like tokens', () => {
    expect(scrubFailureText('bad sk-abcdefghijklmnopqrstuvwxyz1234 token')).toMatch(/sk-\*\*\*/);
    expect(scrubFailureText('Bearer abcdefghijklmnopqrstuvwxyz012345')).toMatch(/Bearer \*\*\*/);
    expect(scrubFailureText('api_key=supersecretvalue99')).toMatch(/api_key=\*\*\*/);
  });
});

describe('classifyStreamFailure', () => {
  it('classifies rate limit', () => {
    const r = classifyStreamFailure('429 Too Many Requests · rate limit');
    expect(r.kind).toBe('rate-limit');
    expect(r.code).toBe('stream.rate-limit');
    expect(r.ctaAction).toBe('jump-agent');
  });

  it('classifies auth', () => {
    const r = classifyStreamFailure('401 unauthorized invalid api key');
    expect(r.kind).toBe('auth');
    expect(r.ctaAction).toBe('jump-providers');
  });

  it('classifies timeout', () => {
    const r = classifyStreamFailure('gateway timeout ETIMEDOUT');
    expect(r.kind).toBe('timeout');
    expect(r.ctaAction).toBe('jump-trace');
  });

  it('classifies model not found', () => {
    const r = classifyStreamFailure('model not found: gpt-nope');
    expect(r.kind).toBe('model-not-found');
    expect(r.ctaAction).toBe('jump-providers');
  });

  it('classifies network', () => {
    const r = classifyStreamFailure('fetch failed ECONNREFUSED');
    expect(r.kind).toBe('network');
    expect(r.ctaAction).toBe('jump-providers');
  });

  it('classifies cancelled and offline opts', () => {
    expect(classifyStreamFailure(null, { cancelled: true }).kind).toBe('cancelled');
    expect(classifyStreamFailure(null, { offline: true }).ctaAction).toBe('reconnect');
  });
});

describe('projectConversationStreamReadiness', () => {
  it('empty when offline and no task', () => {
    const r = projectConversationStreamReadiness({
      connectionState: 'offline',
      streamState: 'idle',
      hasActiveTask: false,
      messageCount: 0,
    });
    expect(r.level).toBe('empty');
    expect(r.badge).toBe('离线');
    expect(r.checks.find((c) => c.id === 'runtime')?.ok).toBe('0');
    expect(r.checks.find((c) => c.id === 'task')?.ok).toBe('0');
    expect(r.title).toMatch(/Runtime 暂不可用|文件夹|任务/);
    expect(r.showReconnectCta).toBe(true);
    expect(r.reconnectCtaLabel).toMatch(/重新连接/);
    expect(r.showFailureCta).toBe(false);
  });

  it('offline surfaces failure code and reconnect CTA', () => {
    const r = projectConversationStreamReadiness({
      connectionState: 'offline',
      streamState: 'idle',
      hasActiveTask: true,
      messageCount: 0,
      connectFailureCode: 'runtime.unavailable',
      connectRetryable: true,
    });
    expect(r.showReconnectCta).toBe(true);
    expect(r.badge).toBe('离线');
    expect(r.title).toMatch(/Runtime 暂不可用/);
    expect(r.title).toMatch(/进程不可用/);
    expect(r.subtitle).toMatch(/runtime\.unavailable/);
    expect(r.note).toMatch(/重新连接/);
    expect(r.reconnectCtaHint).toMatch(/上次/);
    expect(r.checks.find((c) => c.id === 'runtime')?.detail).toMatch(/进程不可用/);
    expect(r.showFailureCta).toBe(false);
  });

  it('non-retryable failure still offers manual retry CTA', () => {
    const r = projectConversationStreamReadiness({
      connectionState: 'offline',
      streamState: 'idle',
      hasActiveTask: false,
      messageCount: 0,
      connectFailureCode: 'runtime.authentication-failed',
      connectRetryable: false,
    });
    expect(r.showReconnectCta).toBe(true);
    expect(r.reconnectCtaLabel).toMatch(/仍要重试/);
    expect(r.note).toMatch(/不可自动重试/);
  });

  it('online hides reconnect CTA', () => {
    const r = projectConversationStreamReadiness({
      connectionState: 'online',
      streamState: 'idle',
      hasActiveTask: true,
      messageCount: 0,
      modelOptionCount: 3,
      multiProvider: true,
    });
    expect(r.showReconnectCta).toBe(false);
    expect(r.level).toBe('ready');
    expect(r.badge).toBe('可开始');
    expect(r.showFailureCta).toBe(false);
  });

  it('ready / 可开始 when online + task + no messages', () => {
    const r = projectConversationStreamReadiness({
      connectionState: 'online',
      streamState: 'idle',
      hasActiveTask: true,
      messageCount: 0,
      modelOptionCount: 3,
      multiProvider: true,
    });
    expect(r.level).toBe('ready');
    expect(r.badge).toBe('可开始');
    expect(r.checks.find((c) => c.id === 'models')?.ok).toBe('1');
    expect(r.checks.find((c) => c.id === 'multi')?.ok).toBe('1');
    expect(r.title).toMatch(/开始/);
  });

  it('streaming level with model id', () => {
    const r = projectConversationStreamReadiness({
      connectionState: 'online',
      streamState: 'streaming',
      hasActiveTask: true,
      messageCount: 2,
      modelId: 'gpt-4o-mini',
      modelOptionCount: 2,
    });
    expect(r.level).toBe('streaming');
    expect(r.badge).toBe('生成中');
    expect(r.streaming).toBe(true);
    expect(r.subtitle).toMatch(/gpt-4o-mini/);
    expect(r.note).toMatch(/Esc/);
    expect(r.showReconnectCta).toBe(false);
    expect(r.showFailureCta).toBe(false);
  });

  it('failed level surfaces error summary + recovery CTA', () => {
    const r = projectConversationStreamReadiness({
      connectionState: 'online',
      streamState: 'failed',
      hasActiveTask: true,
      messageCount: 1,
      errorSummary: 'timeout',
    });
    expect(r.level).toBe('failed');
    expect(r.badge).toMatch(/超时|失败/);
    expect(r.subtitle).toMatch(/timeout/);
    expect(r.checks.find((c) => c.id === 'stream')?.ok).toBe('0');
    expect(r.showFailureCta).toBe(true);
    expect(r.failure?.kind).toBe('timeout');
    expect(r.failureCtaAction).toBe('jump-trace');
    expect(r.failureCode).toBe('stream.timeout');
    expect(r.note).toMatch(/重试|轨迹|诊断|模型/);
  });

  it('rate-limit failure jumps to agent fallback', () => {
    const r = projectConversationStreamReadiness({
      connectionState: 'online',
      streamState: 'failed',
      hasActiveTask: true,
      messageCount: 2,
      errorSummary: '429 rate limit exceeded',
    });
    expect(r.showFailureCta).toBe(true);
    expect(r.failure?.kind).toBe('rate-limit');
    expect(r.failureCtaAction).toBe('jump-agent');
    expect(r.failureCtaLabel).toMatch(/Fallback/);
    expect(r.title).toMatch(/限流|配额/);
  });

  it('auth failure scrubs key-like tokens and opens providers', () => {
    const r = projectConversationStreamReadiness({
      connectionState: 'online',
      streamState: 'failed',
      hasActiveTask: true,
      messageCount: 1,
      errorSummary: '401 unauthorized sk-abcdefghijklmnopqrstuvwxyz1234',
    });
    expect(r.failure?.kind).toBe('auth');
    expect(r.failureCtaAction).toBe('jump-providers');
    expect(r.subtitle).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
    expect(r.subtitle).toMatch(/sk-\*\*\*/);
    expect(r.failureCtaHint).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
  });

  it('paused and cancelled are distinct soft states', () => {
    const paused = projectConversationStreamReadiness({
      connectionState: 'online',
      streamState: 'paused',
      hasActiveTask: true,
      messageCount: 1,
    });
    expect(paused.level).toBe('paused');
    expect(paused.badge).toBe('已暂停');
    expect(paused.showFailureCta).toBe(false);

    const cancelled = projectConversationStreamReadiness({
      connectionState: 'online',
      streamState: 'cancelled',
      hasActiveTask: true,
      messageCount: 1,
    });
    expect(cancelled.level).toBe('partial');
    expect(cancelled.badge).toBe('已取消');
    expect(cancelled.checks.find((c) => c.id === 'stream')?.detail).toBe('已取消');
    expect(cancelled.showFailureCta).toBe(true);
    expect(cancelled.failureCtaAction).toBe('retry-compose');
  });

  it('partial when online without task', () => {
    const r = projectConversationStreamReadiness({
      connectionState: 'online',
      streamState: 'idle',
      hasActiveTask: false,
      messageCount: 0,
      eventHistoryCount: 5,
    });
    expect(r.level).toBe('partial');
    expect(r.checks.find((c) => c.id === 'messages')?.ok).toBe('partial');
  });
});
