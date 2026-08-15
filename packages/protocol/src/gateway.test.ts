import { describe, expect, it } from 'vitest';
import {
  OPEN_GATEWAY_SETTING_KEY,
  isOpenGatewayEnabled,
  normalizeOpenGatewaySetting,
  openGatewayBaseUrls,
} from './gateway.js';

describe('normalizeOpenGatewaySetting', () => {
  it('defaults to disabled with auto-assigned port for any non-object value', () => {
    for (const value of [undefined, null, 'on', 42, [], true]) {
      expect(normalizeOpenGatewaySetting(value)).toEqual({ enabled: false, port: 0 });
    }
  });

  it('only enables for an explicit boolean true', () => {
    expect(isOpenGatewayEnabled({ enabled: true })).toBe(true);
    expect(isOpenGatewayEnabled({ enabled: 'true' })).toBe(false);
    expect(isOpenGatewayEnabled({ enabled: 1 })).toBe(false);
  });

  it('treats port 0, empty and missing as OS auto-assign', () => {
    expect(normalizeOpenGatewaySetting({ enabled: true, port: 0 }).port).toBe(0);
    expect(normalizeOpenGatewaySetting({ enabled: true, port: '' }).port).toBe(0);
    expect(normalizeOpenGatewaySetting({ enabled: true }).port).toBe(0);
  });

  it('refuses privileged, out-of-range and non-integer ports by falling back to auto-assign', () => {
    // A gateway that needs admin rights is a non-starter, so 80/443 fall back.
    expect(normalizeOpenGatewaySetting({ enabled: true, port: 80 }).port).toBe(0);
    expect(normalizeOpenGatewaySetting({ enabled: true, port: 1023 }).port).toBe(0);
    expect(normalizeOpenGatewaySetting({ enabled: true, port: 65536 }).port).toBe(0);
    expect(normalizeOpenGatewaySetting({ enabled: true, port: 8788.5 }).port).toBe(0);
    expect(normalizeOpenGatewaySetting({ enabled: true, port: '9001' }).port).toBe(0);
    expect(normalizeOpenGatewaySetting({ enabled: true, port: 1024 }).port).toBe(1024);
    expect(normalizeOpenGatewaySetting({ enabled: true, port: 65535 }).port).toBe(65535);
  });

  it('keeps a legacy explicit port untouched', () => {
    expect(normalizeOpenGatewaySetting({ enabled: true, port: 8788 })).toEqual({
      enabled: true,
      port: 8788,
    });
  });

  it('drops the legacy defaultProviderId entirely (ticket-based routing)', () => {
    expect(
      normalizeOpenGatewaySetting({ enabled: true, port: 9001, defaultProviderId: '  prov-a ' }),
    ).toEqual({ enabled: true, port: 9001 });
    expect(
      normalizeOpenGatewaySetting({ enabled: true, port: 9001, defaultProviderId: '   ' }),
    ).not.toHaveProperty('defaultProviderId');
    expect(
      normalizeOpenGatewaySetting({ enabled: true, port: 9001, defaultProviderId: 7 }),
    ).not.toHaveProperty('defaultProviderId');
  });

  it('keeps the persisted setting key stable', () => {
    expect(OPEN_GATEWAY_SETTING_KEY).toBe('gateway.open-protocol');
  });
});

describe('openGatewayBaseUrls', () => {
  it('composes the dialect entrypoints each client expects', () => {
    // Anthropic clients append /v1/messages themselves; OpenAI clients expect
    // the /v1 root to already be part of the base URL.
    expect(openGatewayBaseUrls('127.0.0.1', 8788)).toEqual({
      anthropicBaseUrl: 'http://127.0.0.1:8788/anthropic',
      openaiBaseUrl: 'http://127.0.0.1:8788/openai/v1',
    });
  });
});
