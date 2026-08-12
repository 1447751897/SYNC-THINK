/**
 * Unit tests for proxy URL resolution (no live network).
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  parseProxyUrl,
  resolveOutboundProxy,
  proxyLogLabel,
  createProxyAwareFetch,
  clearOutboundProxyCache,
} from './proxy-fetch.js';

describe('parseProxyUrl', () => {
  it('parses host:port', () => {
    expect(parseProxyUrl('127.0.0.1:7897')).toEqual({
      host: '127.0.0.1',
      port: 7897,
      url: 'http://127.0.0.1:7897',
    });
  });

  it('parses full http URL', () => {
    expect(parseProxyUrl('http://127.0.0.1:7897')).toEqual({
      host: '127.0.0.1',
      port: 7897,
      url: 'http://127.0.0.1:7897',
    });
  });

  it('returns null for empty', () => {
    expect(parseProxyUrl('')).toBeNull();
    expect(parseProxyUrl('   ')).toBeNull();
  });
});

describe('resolveOutboundProxy', () => {
  const keys = [
    'SYNC_THINK_HTTP_PROXY',
    'HTTPS_PROXY',
    'https_proxy',
    'HTTP_PROXY',
    'http_proxy',
    'ALL_PROXY',
    'all_proxy',
  ];
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    for (const k of keys) delete saved[k];
    // resolveOutboundProxy now caches per-process; reset between cases.
    clearOutboundProxyCache();
  });

  function stash() {
    for (const k of keys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  }

  it('prefers SYNC_THINK_HTTP_PROXY over HTTPS_PROXY', () => {
    stash();
    process.env.HTTPS_PROXY = 'http://1.1.1.1:8080';
    process.env.SYNC_THINK_HTTP_PROXY = 'http://127.0.0.1:7897';
    const p = resolveOutboundProxy();
    expect(p.source).toBe('env');
    expect(p.host).toBe('127.0.0.1');
    expect(p.port).toBe(7897);
  });

  it('proxyLogLabel is secret-free', () => {
    stash();
    process.env.HTTPS_PROXY = 'http://127.0.0.1:7897';
    const label = proxyLogLabel(resolveOutboundProxy());
    expect(label).toContain('127.0.0.1:7897');
    expect(label).toContain('env');
  });

  it('createProxyAwareFetch returns a function', () => {
    stash();
    process.env.HTTPS_PROXY = 'http://127.0.0.1:7897';
    const fetchImpl = createProxyAwareFetch(resolveOutboundProxy());
    expect(typeof fetchImpl).toBe('function');
  });
});

