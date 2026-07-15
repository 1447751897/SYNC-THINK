import { describe, expect, it } from 'vitest';
import { formatProviderDiscoveryError } from '../src/renderer/provider-error-copy.js';

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
});
