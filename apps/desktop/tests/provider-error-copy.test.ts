import { describe, expect, it } from 'vitest';
import { formatProviderDiscoveryError, formatRuntimeIpcError } from '../src/renderer/provider-error-copy.js';

describe('formatProviderDiscoveryError', () => {
  it('turns raw Electron fetch failures into an actionable Chinese network message', () => {
    const message = formatProviderDiscoveryError(
      new Error(
        "Error invoking remote method 'runtime:provider-discover': RuntimeResponseError: Provider discovery network error: fetch failed",
      ),
    );

    expect(message).toContain('无法连接模型网关');
    expect(message).toContain('Base URL');
    expect(message).toContain('/models');
    expect(message).not.toContain('Error invoking remote method');
  });

  it('classifies DNS ENOTFOUND separately', () => {
    const message = formatProviderDiscoveryError(
      new Error('Provider discovery network error: fetch failed (ENOTFOUND)'),
    );
    expect(message).toContain('DNS');
    expect(message).toContain('无法解析');
  });

  it('distinguishes timeout, authentication, and rate-limit failures', () => {
    expect(formatProviderDiscoveryError(new Error('Provider discovery timed out'))).toContain(
      '响应超时',
    );
    expect(formatProviderDiscoveryError(new Error('Provider auth failed (401)'))).toContain(
      '密钥或网关授权失败',
    );
    expect(formatProviderDiscoveryError(new Error('Provider rate limited (429)'))).toContain(
      '过于频繁',
    );
  });

  it('strips Electron IPC wrappers around a discover timeout', () => {
    expect(
      formatProviderDiscoveryError(
        new Error(
          "Error invoking remote method 'runtime:provider-discover': RuntimeTransientError: Runtime request timed out: provider.discoverModels",
        ),
      ),
    ).toBe('模型网关响应超时。请检查网络与 Base URL，或稍后重试。');
  });
});

describe('formatRuntimeIpcError', () => {
  it('maps append timeouts to a send-specific Chinese notice', () => {
    expect(
      formatRuntimeIpcError(
        new Error(
          "Error invoking remote method 'runtime:task-append': RuntimeTransientError: Runtime request timed out: task.appendMessage",
        ),
        '发送失败',
      ),
    ).toContain('发送超时');
  });
});
