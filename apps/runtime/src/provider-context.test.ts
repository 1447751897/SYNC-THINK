import { describe, expect, it } from 'vitest';
import type {
  Event,
  MessageAttachment,
  MessageId,
  TaskId,
  WorkspaceId,
} from '@sync-think/shared';
import { compileProviderContext, resolveSyncThinkSurface } from './provider-context.js';

function event(
  sequence: number,
  type: string,
  payload: Record<string, unknown>,
  messageId?: string,
  taskId?: string,
): Event {
  return {
    id: `event-${sequence}` as Event['id'],
    workspaceId: 'workspace-context' as WorkspaceId,
    taskId: taskId as TaskId | undefined,
    messageId: messageId as MessageId | undefined,
    category: type === 'message.appended' ? 'message' : 'run',
    type,
    sequence,
    occurredAt: `2026-07-18T00:00:0${sequence}.000Z`,
    payload,
  };
}

describe('provider context compilation', () => {
  it('keeps a recent historical image on the original user turn', () => {
    const attachment: MessageAttachment = {
      id: 'image-history-1',
      kind: 'image',
      name: 'reference.png',
      mimeType: 'image/png',
      size: 128,
      sha256: 'a'.repeat(64),
      managedRef: 'D:\\managed\\reference.png',
      readOnly: true,
    };
    const events = [
      event(
        1,
        'message.appended',
        {
          threadId: 'thread-current',
          role: 'user',
          text: '请参考这张图',
          attachments: [attachment],
        },
        'message-image',
      ),
      event(2, 'run.completed', {
        threadId: 'thread-current',
        assistantText: '我已经看到了。',
      }),
      event(
        3,
        'message.appended',
        { threadId: 'thread-current', role: 'user', text: '继续按刚才图片修改' },
        'message-current',
      ),
    ];

    const result = compileProviderContext({
      events,
      threadId: 'thread-current',
      latestUserMessageId: 'message-current',
      latestUserText: '继续按刚才图片修改',
      surface: 'conversation',
    });

    expect(result.messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: '请参考这张图' },
        { type: 'image', imageRef: 'image-history-1' },
      ],
    });
    expect(result.messages.at(-1)).toEqual({
      role: 'user',
      content: '继续按刚才图片修改',
    });
    expect(result.history.imageAttachments).toEqual([attachment]);
  });

  it('injects the SYNC-THINK platform identity and exact scoped identities', () => {
    const result = compileProviderContext({
      events: [],
      threadId: 'thread-current',
      latestUserMessageId: 'message-current',
      latestUserText: '我现在在哪个平台？',
      surface: 'group',
      permissionMode: 'full',
      project: {
        id: 'workspace-context',
        name: 'SYNC-THINK 重构',
        folderBound: true,
      },
      task: {
        id: 'task-context',
        title: '实现平台感知',
        goal: '让 Agent 明确知道当前应用环境',
        status: 'active',
        acceptanceCriteria: ['回答必须明确提到 SYNC-THINK'],
      },
      agent: {
        id: 'agent-version-architect',
        name: 'Architect',
        role: '系统架构师',
        developerInstructions: '先识别边界，再给出方案。',
      },
      group: {
        id: 'group-platform',
        name: '全栈特攻队',
        leadAgentVersionId: 'agent-version-architect',
        members: [
          {
            agentVersionId: 'agent-version-architect',
            name: 'Architect',
            responsibility: '拆分任务并统一总结',
          },
        ],
      },
    });

    expect(result.systemPrompt).toContain('SYNC-THINK');
    expect(result.systemPrompt).toContain('local-first Agent desktop workspace');
    expect(result.systemPrompt).toContain('SYNC-THINK 重构');
    expect(result.systemPrompt).toContain('实现平台感知');
    expect(result.systemPrompt).toContain('Architect');
    expect(result.systemPrompt).toContain('全栈特攻队');
    expect(result.systemPrompt).toContain('完全访问');
    expect(result.systemPrompt).not.toContain('C:\\');
    expect(result.messages).toEqual([{ role: 'user', content: '我现在在哪个平台？' }]);
  });

  it('sends canonical prior user and assistant turns in chronological order', () => {
    const events = [
      event(
        1,
        'message.appended',
        { threadId: 'thread-current', role: 'user', text: '第一问' },
        'message-1',
      ),
      event(2, 'run.completed', {
        threadId: 'thread-current',
        assistantText: '第一答',
      }),
      event(
        3,
        'message.appended',
        { threadId: 'thread-other', role: 'user', text: '其他任务内容' },
        'message-other',
      ),
      event(
        4,
        'message.appended',
        { threadId: 'thread-current', role: 'user', text: '第二问' },
        'message-2',
      ),
    ];

    const result = compileProviderContext({
      events,
      threadId: 'thread-current',
      latestUserMessageId: 'message-2',
      latestUserText: '第二问',
      surface: 'conversation',
    });

    expect(result.messages).toEqual([
      { role: 'user', content: '第一问' },
      { role: 'assistant', content: '第一答' },
      { role: 'user', content: '第二问' },
    ]);
    expect(JSON.stringify(result)).not.toContain('其他任务内容');
    expect(result.history.includedEventIds).toEqual(['event-1', 'event-2', 'event-4']);
  });

  it('keeps the latest turn and newest history when the history budget is bounded', () => {
    const events = Array.from({ length: 8 }, (_, index) =>
      event(
        index + 1,
        'message.appended',
        {
          threadId: 'thread-current',
          role: 'user',
          text: `turn-${index + 1}-${'x'.repeat(40)}`,
        },
        `message-${index + 1}`,
      ),
    );

    const result = compileProviderContext({
      events,
      threadId: 'thread-current',
      latestUserMessageId: 'message-8',
      latestUserText: `turn-8-${'x'.repeat(40)}`,
      surface: 'conversation',
      maxHistoryTokens: 30,
    });

    expect(result.messages.at(-1)).toEqual({
      role: 'user',
      content: `turn-8-${'x'.repeat(40)}`,
    });
    expect(result.history.excludedEventIds.length).toBeGreaterThan(0);
    expect(result.history.includedEventIds).toContain('event-8');
  });

  it('retains the recent image turn even when its text would exceed the history budget', () => {
    const attachment: MessageAttachment = {
      id: 'image-budget-1',
      kind: 'image',
      name: 'important.png',
      mimeType: 'image/png',
      size: 10,
      managedRef: 'D:\\managed\\important.png',
      readOnly: true,
    };
    const result = compileProviderContext({
      events: [
        event(
          1,
          'message.appended',
          {
            threadId: 'thread-current',
            role: 'user',
            text: 'x'.repeat(10_000),
            attachments: [attachment],
          },
          'message-image-budget',
        ),
        event(2, 'run.completed', { threadId: 'thread-current', assistantText: '收到' }),
      ],
      threadId: 'thread-current',
      latestUserText: '继续',
      latestUserMessageId: 'message-next',
      surface: 'conversation',
      maxHistoryTokens: 4,
    });

    expect(result.history.includedEventIds).toContain('event-1');
    expect(result.history.imageAttachments).toEqual([attachment]);
  });
});

describe('SYNC-THINK surface resolution', () => {
  it('prefers a group surface over automation and fallback surfaces', () => {
    const events = [
      event(1, 'automation.task-triggered', { automationId: 'automation-1' }, undefined, 'task-1'),
    ];

    expect(
      resolveSyncThinkSurface({
        events,
        taskId: 'task-1',
        hasGroup: true,
        fallback: 'project',
      }),
    ).toBe('group');
  });

  it('uses automation only when the current task has an automation event', () => {
    const events = [
      event(1, 'automation.task-triggered', { automationId: 'automation-1' }, undefined, 'task-1'),
    ];

    expect(
      resolveSyncThinkSurface({
        events,
        taskId: 'task-1',
        hasGroup: false,
        fallback: 'conversation',
      }),
    ).toBe('automation');
    expect(
      resolveSyncThinkSurface({
        events,
        taskId: 'task-2',
        hasGroup: false,
        fallback: 'external',
      }),
    ).toBe('external');
  });

  it('keeps the requested fallback when no group or automation applies', () => {
    expect(
      resolveSyncThinkSurface({
        events: [],
        taskId: 'task-1',
        hasGroup: false,
        fallback: 'project',
      }),
    ).toBe('project');
  });
});
