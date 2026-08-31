import { describe, expect, it } from 'vitest';
import { COMPUTER_USE_APPROVAL_POLICY_SETTING_KEY } from '@sync-think/protocol/tool-approval';
import {
  ToolApprovalPolicy,
  persistentComputerUseAppOf,
} from './tool-approval-policy.js';

class MemorySettingStore {
  readonly values = new Map<string, unknown>();

  get(key: string) {
    if (!this.values.has(key)) return undefined;
    return { key, value: this.values.get(key), updatedAt: '2026-08-31T00:00:00.000Z' };
  }

  set(key: string, value: unknown) {
    this.values.set(key, value);
    return { key, value, updatedAt: '2026-08-31T00:00:00.000Z' };
  }
}

describe('ToolApprovalPolicy', () => {
  it('remembers session approval only for the same conversation and tool name', () => {
    const policy = new ToolApprovalPolicy();

    expect(
      policy.remember({
        conversationId: 'conversation-a',
        toolName: 'file_write',
        arguments: { path: 'README.md' },
        scope: 'session',
      }),
    ).toEqual({ remembered: true });

    expect(
      policy.isAllowed({
        conversationId: 'conversation-a',
        toolName: 'file_write',
        arguments: { path: 'docs/next.md' },
      }),
    ).toBe(true);
    expect(
      policy.isAllowed({
        conversationId: 'conversation-b',
        toolName: 'file_write',
        arguments: { path: 'README.md' },
      }),
    ).toBe(false);
    expect(
      policy.isAllowed({
        conversationId: 'conversation-a',
        toolName: 'file_delete',
        arguments: { path: 'README.md' },
      }),
    ).toBe(false);
  });

  it('persists a validated Computer Use app and restores it for other app actions', () => {
    const settings = new MemorySettingStore();
    const first = new ToolApprovalPolicy(settings);

    expect(
      first.remember({
        conversationId: 'conversation-a',
        toolName: 'mcp__computer-use__computer_click',
        arguments: { app_id: '  calculator.exe  ' },
        scope: 'always-app',
      }),
    ).toEqual({
      remembered: true,
      persistentApp: { field: 'app_id', value: 'calculator.exe' },
    });
    expect(settings.values.get(COMPUTER_USE_APPROVAL_POLICY_SETTING_KEY)).toEqual({
      version: 1,
      alwaysAllowedApps: [{ field: 'app_id', value: 'calculator.exe' }],
    });

    const restored = new ToolApprovalPolicy(settings);
    expect(
      restored.isAllowed({
        conversationId: 'conversation-b',
        toolName: 'mcp__computer-use__computer_type',
        arguments: { app_id: 'calculator.exe', text: '42' },
      }),
    ).toBe(true);
    expect(
      restored.isAllowed({
        conversationId: 'conversation-b',
        toolName: 'mcp__computer-use__computer_type',
        arguments: { app_id: 'notepad.exe', text: '42' },
      }),
    ).toBe(false);
  });

  it('rejects always-app memory when the tool arguments have no valid app identity', () => {
    const settings = new MemorySettingStore();
    const policy = new ToolApprovalPolicy(settings);

    expect(
      policy.remember({
        conversationId: 'conversation-a',
        toolName: 'mcp__computer-use__computer_click',
        arguments: {},
        scope: 'always-app',
      }),
    ).toEqual({ remembered: false });
    expect(settings.values.size).toBe(0);
  });

  it('never reuses or records remembered approval for a human-only request', () => {
    const settings = new MemorySettingStore();
    const policy = new ToolApprovalPolicy(settings);
    const ordinaryRequest = {
      conversationId: 'conversation-a',
      toolName: 'desktop_set_value',
      arguments: { target: 'password-field' },
    };

    expect(policy.remember({ ...ordinaryRequest, scope: 'session' })).toEqual({
      remembered: true,
    });
    expect(
      policy.isAllowed({
        ...ordinaryRequest,
        risk: {
          level: 'human-only',
          reasonCodes: ['human-only-target'],
          humanOnlyAction: 'access-or-create-secret',
        },
      }),
    ).toBe(false);
    expect(
      policy.remember({
        ...ordinaryRequest,
        scope: 'always-app',
        risk: {
          level: 'human-only',
          reasonCodes: ['human-only-target'],
          humanOnlyAction: 'access-or-create-secret',
        },
      }),
    ).toEqual({ remembered: false });
    expect(settings.values.size).toBe(0);
  });

  it('accepts only the NewMax remembered scope for each ordinary request', () => {
    const settings = new MemorySettingStore();
    const policy = new ToolApprovalPolicy(settings);
    const computerUseRequest = {
      conversationId: 'conversation-a',
      toolName: 'mcp__computer-use__computer_click',
      arguments: { app_id: 'calculator.exe' },
    };
    const ordinaryRequest = {
      conversationId: 'conversation-a',
      toolName: 'write_file',
      arguments: { path: 'README.md' },
    };

    expect(policy.remember({ ...computerUseRequest, scope: 'session' })).toEqual({
      remembered: false,
    });
    expect(policy.remember({ ...ordinaryRequest, scope: 'always-app' })).toEqual({
      remembered: false,
    });
    expect(policy.remember({ ...ordinaryRequest, scope: 'session' })).toEqual({
      remembered: true,
    });
    expect(policy.remember({ ...computerUseRequest, scope: 'always-app' })).toEqual({
      remembered: true,
      persistentApp: { field: 'app_id', value: 'calculator.exe' },
    });
  });
});

describe('persistentComputerUseAppOf', () => {
  it('matches NewMax Windows app_id and macOS bundle-id gates exactly', () => {
    expect(
      persistentComputerUseAppOf('mcp__computer-use__computer_click', {
        app_id: ' calc.exe ',
      }),
    ).toEqual({ field: 'app_id', value: 'calc.exe' });
    expect(
      persistentComputerUseAppOf('mcp__computer-use__click', {
        app: ' com.apple.TextEdit ',
      }),
    ).toEqual({ field: 'app', value: 'com.apple.TextEdit' });
    expect(
      persistentComputerUseAppOf('mcp__computer-use__click', {
        app: 'TextEdit',
      }),
    ).toBeNull();
  });
});
