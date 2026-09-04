import { describe, it, expect } from 'vitest';
import { verifyClientHello, computeHmac, type Hello } from './handshake.js';
import { DEFAULT_FEATURES, PROTOCOL_VERSION } from './version.js';

describe('client hello verification', () => {
  const base: Hello = {
    protocolVersion: PROTOCOL_VERSION,
    appVersion: '0.0.1',
    installId: 'dev-0001',
    nonce: 'n',
    features: ['task.appendMessage', 'runtime.healthcheck', 'runtime.subscribeEvents'],
  };

  it('uses protocol version 2 for paged event replay', () => {
    expect(PROTOCOL_VERSION).toBe(2);
  });

  it('advertises the durable Browser recording command family', () => {
    expect(DEFAULT_FEATURES).toContain('browser.recording');
  });

  it('advertises pending tool approval reconciliation', () => {
    expect(DEFAULT_FEATURES).toContain('conversation.listPendingToolApprovals');
  });

  it('advertises the web search provider configuration commands', () => {
    expect(DEFAULT_FEATURES).toEqual(
      expect.arrayContaining([
        'webSearch.providers.list',
        'webSearch.providers.save',
        'webSearch.providers.reorder',
        'webSearch.providers.test',
      ]),
    );
  });

  it('agrees feature intersection on valid hello', () => {
    const r = verifyClientHello(base, { expectedInstallId: 'dev-0001', allowNoToken: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.agreedFeatures).toContain('task.appendMessage');
  });

  it('rejects version mismatch', () => {
    const r = verifyClientHello(
      { ...base, protocolVersion: 9999 },
      { expectedInstallId: 'dev-0001', allowNoToken: true },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('protocol.version_mismatch');
  });

  it('rejects wrong installId', () => {
    const r = verifyClientHello(base, { expectedInstallId: 'OTHER', allowNoToken: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('protocol.auth_rejected');
  });

  it('requires token unless allowNoToken', () => {
    const r = verifyClientHello(base, { expectedInstallId: 'dev-0001' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('protocol.auth_rejected');
  });

  it('rejects an arbitrary token when the Runtime secret is not configured', () => {
    const r = verifyClientHello(
      { ...base, token: 'attacker-controlled-token' },
      { expectedInstallId: 'dev-0001' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('protocol.auth_rejected');
  });

  it('checks HMAC token when secret present', () => {
    const good = computeHmac('secret', base.nonce, base.installId);
    const r = verifyClientHello(
      { ...base, token: good },
      { expectedInstallId: 'dev-0001', expectedSecret: 'secret' },
    );
    expect(r.ok).toBe(true);
    const r2 = verifyClientHello(
      { ...base, token: 'bad' },
      { expectedInstallId: 'dev-0001', expectedSecret: 'secret' },
    );
    expect(r2.ok).toBe(false);
  });
});
