import { describe, expect, it } from 'vitest';
import {
  parseGetAgentPayload,
  parseGetBotChannelConfigPayload,
  parseCheckWechatBotQrPayload,
  parseImportSkillPayload,
  parseListSkillsPayload,
  parseSaveBotChannelConfigPayload,
  parseUpdateAgentBindingPayload,
} from '../src/agent-payloads.js';

describe('agent payloads', () => {
  it('parses empty get payload and rejects bad update', () => {
    expect(parseGetAgentPayload({})).toEqual({ agentId: undefined });
    expect(parseGetAgentPayload(null)).toEqual({});
    expect(() =>
      parseUpdateAgentBindingPayload({ defaultModelId: '', fallbackModelIds: [] }),
    ).toThrow();
    const ok = parseUpdateAgentBindingPayload({
      defaultModelId: ' m1 ',
      fallbackModelIds: [' m2 ', 'm3'],
      pauseOnFailure: true,
    });
    expect(ok.defaultModelId).toBe('m1');
    expect(ok.fallbackModelIds).toEqual(['m2', 'm3']);
    expect(ok.pauseOnFailure).toBe(true);
  });

  it('parses credential group and pin (including null pin clear)', () => {
    const ok = parseUpdateAgentBindingPayload({
      defaultModelId: 'm1',
      fallbackModelIds: [],
      defaultCredentialGroupId: 'cg-1',
      pinnedCredentialRefId: 'cr-9',
    });
    expect(ok.defaultCredentialGroupId).toBe('cg-1');
    expect(ok.pinnedCredentialRefId).toBe('cr-9');

    const clear = parseUpdateAgentBindingPayload({
      defaultModelId: 'm1',
      fallbackModelIds: [],
      defaultCredentialGroupId: 'cg-1',
      pinnedCredentialRefId: null,
    });
    expect(clear.pinnedCredentialRefId).toBeNull();
  });

  it('normalizes exact Skill metadata ids and enforces the Agent allowlist bound', () => {
    expect(
      parseListSkillsPayload({ skillVersionIds: [' skill-b ', 'skill-b', 'skill-a'] }),
    ).toEqual({
      limit: undefined,
      skillVersionIds: ['skill-b', 'skill-a'],
    });
    expect(() =>
      parseListSkillsPayload({
        skillVersionIds: Array.from({ length: 65 }, (_, index) => `skill-${index}`),
      }),
    ).toThrow(/list-skills/);
  });

  it('preserves market and derived Skill lineage on import', () => {
    expect(
      parseImportSkillPayload({
        skillMd: '---\nname: market-skill\n---\nBody',
        originType: 'derived',
        originRef: ' market://skills/market-skill ',
        derivedFromSkillVersionId: ' version-market ',
        skillId: ' skill-market ',
      }),
    ).toEqual({
      skillMd: '---\nname: market-skill\n---\nBody',
      originType: 'derived',
      originRef: 'market://skills/market-skill',
      derivedFromSkillVersionId: 'version-market',
      skillId: 'skill-market',
    });
    expect(() =>
      parseImportSkillPayload({
        skillMd: '---\nname: market-skill\n---\nBody',
        originType: 'derived',
      }),
    ).toThrow(/import-skill/);
  });

  it('normalizes all bot-channel credentials at the Electron IPC boundary', () => {
    expect(parseGetBotChannelConfigPayload({ platform: 'wecom' })).toEqual({
      platform: 'wecom',
    });
    expect(
      parseSaveBotChannelConfigPayload({
        platform: 'dingtalk',
        enabled: true,
        testConnection: true,
        clientId: ' ding-client ',
        clientSecret: ' ding-secret ',
      }),
    ).toEqual({
      platform: 'dingtalk',
      enabled: true,
      testConnection: true,
      clientId: 'ding-client',
      clientSecret: 'ding-secret',
    });
    expect(() => parseGetBotChannelConfigPayload({ platform: 'unknown' })).toThrow();
    expect(() =>
      parseSaveBotChannelConfigPayload({ platform: 'telegram', enabled: 'yes' }),
    ).toThrow();
  });

  it('accepts a bounded WeChat QR status request and rejects a missing code', () => {
    expect(
      parseCheckWechatBotQrPayload({
        qrcode: ' login-code ',
        baseUrl: ' https://ilinkai.weixin.qq.com ',
      }),
    ).toEqual({
      qrcode: 'login-code',
      baseUrl: 'https://ilinkai.weixin.qq.com',
    });
    expect(() => parseCheckWechatBotQrPayload({ qrcode: '' })).toThrow();
  });
});
