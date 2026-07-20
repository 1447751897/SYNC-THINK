import { describe, expect, it } from 'vitest';
import type { RunId } from '@sync-think/shared';
import {
  createDemoProviderRequest,
  createDemoRun,
  parseDemoRuns,
  resolveApplicationToolsEnabled,
  serializeDemoRuns,
} from './demo-run.js';

describe('provider request context binding', () => {
  it('materializes historical images on their original turn and current images on the latest turn', () => {
    const run = createDemoRun('run-images' as RunId, 'thread-images', '继续修改', {
      providerContext: {
        systemPrompt: 'platform.name: SYNC-THINK',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: '参考图片' },
              { type: 'image', imageRef: 'image-history' },
            ],
          },
          { role: 'assistant', content: '已看到。' },
          { role: 'user', content: '继续修改' },
        ],
        history: {
          includedEventIds: ['event-image'],
          excludedEventIds: [],
          tokenEstimate: 300,
        },
      },
      attachments: [
        {
          id: 'image-current',
          kind: 'image',
          name: 'current.png',
          mimeType: 'image/png',
          size: 128,
          managedRef: 'D:\\managed\\current.png',
          readOnly: true,
        },
      ],
    });

    const request = createDemoProviderRequest(run, undefined, undefined, [
      {
        type: 'image',
        imageRef: 'image-history',
        imageUrl: 'data:image/png;base64,SElTVE9SWQ==',
      },
      {
        type: 'image',
        imageRef: 'image-current',
        imageUrl: 'data:image/png;base64,Q1VSUkVOVA==',
      },
    ]);

    expect(request.messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: '参考图片' },
        {
          type: 'image',
          imageRef: 'image-history',
          imageUrl: 'data:image/png;base64,SElTVE9SWQ==',
        },
      ],
    });
    expect(request.messages.at(-1)).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: '继续修改' },
        {
          type: 'image',
          imageRef: 'image-current',
          imageUrl: 'data:image/png;base64,Q1VSUkVOVA==',
        },
      ],
    });
  });

  it('sends the frozen SYNC-THINK prompt and canonical task history to the adapter', () => {
    const run = createDemoRun('run-context' as RunId, 'thread-current', '第二问', {
      latestUserMessageId: 'message-2',
      providerContext: {
        systemPrompt: 'platform.name: SYNC-THINK\ntask.id: task-current',
        messages: [
          { role: 'user', content: '第一问' },
          { role: 'assistant', content: '第一答' },
          { role: 'user', content: '第二问' },
        ],
        history: {
          includedEventIds: ['event-1', 'event-2'],
          excludedEventIds: ['event-other-task'],
          tokenEstimate: 24,
        },
      },
    });

    const restored = parseDemoRuns(serializeDemoRuns(new Map([[run.runId, run]])))[0]!;
    const request = createDemoProviderRequest(restored);

    expect(request.systemPrompt).toContain('platform.name: SYNC-THINK');
    expect(request.messages).toEqual([
      { role: 'user', content: '第一问' },
      { role: 'assistant', content: '第一答' },
      { role: 'user', content: '第二问' },
    ]);
    expect(JSON.stringify(request)).not.toContain('event-other-task');
  });

  it('round-trips the in-app application tool state and sends schemas to capable models', () => {
    const run = createDemoRun('run-tools' as RunId, 'thread-tools', '创建一个任务', {
      applicationToolsEnabled: true,
      providerTurn: 2,
    });

    const restored = parseDemoRuns(serializeDemoRuns(new Map([[run.runId, run]])))[0]!;
    const request = createDemoProviderRequest(restored);

    expect(restored.applicationToolsEnabled).toBe(true);
    expect(restored.providerTurn).toBe(2);
    expect(request.idempotencyKey).toBe('run-tools:application-turn-3');
    expect(request.tools?.map((tool) => tool.name)).toContain('sync_think.task.create');
    expect(request.tools?.map((tool) => tool.name)).toContain('sync_think.group.create');
    expect(request.tools?.some((tool) => /secret|api[_-]?key/i.test(tool.name))).toBe(false);
  });

  it('registers only the task-scoped execution tools persisted on the Run', () => {
    const run = createDemoRun('run-tools' as never, 'thread-tools', 'inspect files', {
      applicationToolsEnabled: true,
      executionRoot: 'D:\\worktrees\\task-tools',
      executionToolNames: ['read_file', 'git_status'],
    });
    const request = createDemoProviderRequest(run);
    expect(request.tools?.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['sync_think.task.create', 'read_file', 'git_status']),
    );
    expect(request.tools?.map((tool) => tool.name)).not.toContain('write_file');
  });

  it('enables built-in application tools for compatible protocols even when catalogs only confirm text', () => {
    expect(
      resolveApplicationToolsEnabled({
        protocol: 'openai-responses',
        capabilities: ['text'],
        capabilitiesConfirmed: false,
        modelId: 'gpt-imported-from-ccswitch',
      }),
    ).toBe(true);
    expect(
      resolveApplicationToolsEnabled({
        protocol: 'openai-responses',
        capabilities: ['text'],
        capabilitiesConfirmed: true,
        modelId: 'gpt-explicitly-confirmed',
      }),
    ).toBe(true);
  });
});
