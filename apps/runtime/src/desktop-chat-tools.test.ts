import { describe, expect, it } from 'vitest';
import { ErrorCode } from '@sync-think/shared';
import type { DesktopWorker, WorkerEvent, WorkerToken } from '@sync-think/workers';
import {
  CHAT_DESKTOP_MUTATING_TOOL_NAMES,
  CHAT_DESKTOP_TOOL_SCHEMAS,
  assessChatDesktopToolRisk,
  executeChatDesktopTool,
  prepareChatDesktopTool,
} from './desktop-chat-tools.js';

class RecordingDesktopWorker implements DesktopWorker {
  readonly kind = 'desktop' as const;
  calls: Array<{ input: Parameters<DesktopWorker['exec']>[0]; token: WorkerToken }> = [];

  async *exec(
    input: Parameters<DesktopWorker['exec']>[0],
    token: WorkerToken,
  ): AsyncIterable<WorkerEvent> {
    this.calls.push({ input, token });
    yield {
      type: 'completed',
      output: { ok: true, message: 'ok', result: { kind: 'action-completed' } },
    };
  }
}

describe('desktop chat tools', () => {
  it('exposes the bounded UIA observation and semantic action surface', () => {
    expect(CHAT_DESKTOP_TOOL_SCHEMAS.map((tool) => tool.name)).toEqual([
      'desktop_list_windows',
      'desktop_inspect_window',
      'desktop_resolve_selector',
      'desktop_read_element',
      'desktop_focus_element',
      'desktop_invoke_element',
      'desktop_set_value',
    ]);
    expect([...CHAT_DESKTOP_MUTATING_TOOL_NAMES]).toEqual([
      'desktop_focus_element',
      'desktop_invoke_element',
      'desktop_set_value',
    ]);
  });

  it('classifies desktop actions with a fail-closed risk model and safe approval projection', () => {
    const target = {
      window: { processId: 42, nativeWindowHandle: '0x1234', title: 'Fixture' },
      snapshotRevision: 'snapshot-1',
      accessibilityRevision: 'accessibility-1',
      elementIndex: 3,
    };
    const prepare = (name: string, args: Record<string, unknown>) => {
      const prepared = prepareChatDesktopTool(name, JSON.stringify(args));
      expect(prepared).toBeTruthy();
      return prepared!;
    };

    expect(assessChatDesktopToolRisk(prepare('desktop_list_windows', {}))).toMatchObject({
      level: 'observe',
    });
    expect(assessChatDesktopToolRisk(prepare('desktop_focus_element', { target }))).toMatchObject({
      level: 'display',
    });

    const unknownSetValue = assessChatDesktopToolRisk(
      prepare('desktop_set_value', { target, value: 'approval secret' }),
    );
    expect(unknownSetValue).toMatchObject({ level: 'sensitive' });
    expect(JSON.stringify(unknownSetValue.approvalArguments)).not.toContain('approval secret');
    expect(JSON.stringify(unknownSetValue.approvalArguments)).not.toContain('0x1234');
    expect(JSON.stringify(unknownSetValue.approvalArguments)).not.toContain('snapshot-1');
    expect(unknownSetValue.approvalArguments).toMatchObject({
      action: 'set-value',
      valueLength: 'approval secret'.length,
    });

    expect(
      assessChatDesktopToolRisk(prepare('desktop_set_value', { target, value: 'new value' }), {
        index: 3,
        name: 'Password',
        automationId: 'PasswordBox',
        controlType: 'Edit',
        processId: 42,
        enabled: true,
        offscreen: false,
        isPassword: true,
        supportedPatterns: ['Value'],
      }),
    ).toMatchObject({
      level: 'human-only',
      humanOnlyAction: 'access-or-create-secret',
    });

    expect(
      assessChatDesktopToolRisk(prepare('desktop_invoke_element', { target }), {
        index: 3,
        name: 'Delete account',
        automationId: 'DeleteAccountButton',
        controlType: 'Button',
        processId: 42,
        enabled: true,
        offscreen: false,
        isPassword: false,
        supportedPatterns: ['Invoke'],
      }),
    ).toMatchObject({
      level: 'human-only',
      humanOnlyAction: 'irreversible-deletion',
    });

    expect(
      assessChatDesktopToolRisk(prepare('desktop_invoke_element', { target }), {
        index: 3,
        name: 'Apply',
        automationId: 'ApplyButton',
        controlType: 'Button',
        processId: 42,
        enabled: true,
        offscreen: false,
        isPassword: false,
        supportedPatterns: ['Invoke'],
      }),
    ).toMatchObject({ level: 'display' });
  });

  it('does not start a worker when the plugin is disabled', async () => {
    const worker = new RecordingDesktopWorker();
    const result = JSON.parse(
      await executeChatDesktopTool({
        capabilityEnabled: false,
        toolCall: { id: 'd1', name: 'desktop_list_windows', argumentsJson: '{}' },
        worker,
      }),
    ) as { ok: boolean; code: string };

    expect(result).toEqual({
      ok: false,
      code: ErrorCode.DESKTOP_CAPABILITY_DISABLED,
      error: 'Computer Use plugin is disabled.',
    });
    expect(worker.calls).toHaveLength(0);
  });

  it('maps a set-value call to the isolated DesktopWorker without putting text in argv', async () => {
    const worker = new RecordingDesktopWorker();
    const target = {
      window: { processId: 42, nativeWindowHandle: '0x1234', title: 'Fixture' },
      snapshotRevision: 'snapshot-1',
      accessibilityRevision: 'accessibility-1',
      elementIndex: 3,
    };
    const result = JSON.parse(
      await executeChatDesktopTool({
        capabilityEnabled: true,
        workspaceRoot: process.cwd(),
        toolCall: {
          id: 'd2',
          name: 'desktop_set_value',
          argumentsJson: JSON.stringify({ target, value: 'secret via stdin' }),
        },
        worker,
      }),
    ) as { ok: boolean };

    expect(result.ok).toBe(true);
    expect(worker.calls).toHaveLength(1);
    expect(worker.calls[0]!.input.action).toEqual({
      kind: 'set-value',
      target,
      value: 'secret via stdin',
    });
  });

  it('omits blank optional desktop fields before strict host validation', async () => {
    const worker = new RecordingDesktopWorker();
    const target = {
      window: {
        processId: 42,
        nativeWindowHandle: '0x1234',
        title: '',
        appId: '   ',
      },
      snapshotRevision: 'snapshot-1',
      accessibilityRevision: 'accessibility-1',
    };
    const result = JSON.parse(
      await executeChatDesktopTool({
        capabilityEnabled: true,
        toolCall: {
          id: 'd3',
          name: 'desktop_resolve_selector',
          argumentsJson: JSON.stringify({
            target,
            selector: { automationId: 'TextEditor', name: '', controlType: 'Document' },
          }),
        },
        worker,
      }),
    ) as { ok: boolean };

    expect(result.ok).toBe(true);
    expect(worker.calls).toHaveLength(1);
    expect(worker.calls[0]!.input.action).toEqual({
      kind: 'resolve-selector',
      target: {
        ...target,
        window: { processId: 42, nativeWindowHandle: '0x1234' },
      },
      selector: { automationId: 'TextEditor', controlType: 'Document' },
    });
  });

  it('still rejects a selector whose identifying fields are all blank', async () => {
    const worker = new RecordingDesktopWorker();
    const result = JSON.parse(
      await executeChatDesktopTool({
        capabilityEnabled: true,
        toolCall: {
          id: 'd4',
          name: 'desktop_resolve_selector',
          argumentsJson: JSON.stringify({
            target: {
              window: { processId: 42, nativeWindowHandle: '0x1234' },
              snapshotRevision: 'snapshot-1',
              accessibilityRevision: 'accessibility-1',
            },
            selector: { automationId: '', name: '', controlType: 'Document' },
          }),
        },
        worker,
      }),
    ) as { ok: boolean; code: string };

    expect(result.ok).toBe(false);
    expect(result.code).toBe(ErrorCode.DESKTOP_PROTOCOL_MALFORMED);
    expect(worker.calls).toHaveLength(0);
  });

  it('rejects malformed targets before starting the host', async () => {
    const worker = new RecordingDesktopWorker();
    const result = JSON.parse(
      await executeChatDesktopTool({
        capabilityEnabled: true,
        toolCall: {
          id: 'd5',
          name: 'desktop_read_element',
          argumentsJson: JSON.stringify({ target: { elementIndex: -1 } }),
        },
        worker,
      }),
    ) as { ok: boolean; code: string };

    expect(result.ok).toBe(false);
    expect(result.code).toBe(ErrorCode.DESKTOP_PROTOCOL_MALFORMED);
    expect(worker.calls).toHaveLength(0);
  });
});
