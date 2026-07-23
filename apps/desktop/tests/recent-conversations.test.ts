import { describe, expect, it } from 'vitest';
import {
  buildRecentConversationsModel,
  inferTalkTrack,
  trackCreateLabel,
} from '../src/renderer/recent-conversations.js';

describe('recent-conversations', () => {
  it('projects model, agent and team as nested sections without date buckets', () => {
    const model = buildRecentConversationsModel({
      items: [
        {
          id: 'agent-new',
          workspaceId: 'w',
          title: '重构登录',
          track: 'agent',
          updatedAt: '2026-07-22T10:00:00.000Z',
        },
        {
          id: 'model',
          workspaceId: 'w',
          title: '模型直聊',
          track: 'model',
          updatedAt: '2026-07-22T11:00:00.000Z',
        },
        {
          id: 'agent-pinned',
          workspaceId: 'w',
          title: '固定方案',
          track: 'agent',
          pinned: true,
          updatedAt: '2026-06-01T09:00:00.000Z',
        },
      ],
    });

    expect(model.sections.map((section) => section.label)).toEqual([
      '模型对话',
      '智能体对话',
      '小队对话',
    ]);
    expect(model.sections[1]?.items.map((item) => item.id)).toEqual([
      'agent-pinned',
      'agent-new',
    ]);
    expect(model.sections[1]?.pinnedCount).toBe(1);
    expect(model.sections[2]?.items).toEqual([]);
  });

  it('keeps search across all nested sections and sorts only within each section', () => {
    const model = buildRecentConversationsModel({
      query: '官网',
      items: [
        {
          id: 'agent',
          workspaceId: 'w',
          title: '检查样式',
          subtitle: '官网',
          track: 'agent',
        },
        {
          id: 'team',
          workspaceId: 'w',
          title: '官网交付',
          track: 'team',
        },
        {
          id: 'model',
          workspaceId: 'w',
          title: '无关对话',
          track: 'model',
        },
      ],
    });

    expect(model.filteredCount).toBe(2);
    expect(model.sections[0]?.items).toHaveLength(0);
    expect(model.sections[1]?.items[0]?.id).toBe('agent');
    expect(model.sections[2]?.items[0]?.id).toBe('team');
  });

  it('infers legacy team track from collaboration mode', () => {
    expect(inferTalkTrack({ participationMode: 'collaboration' })).toBe('team');
    expect(inferTalkTrack({ participationMode: 'conversation' })).toBe('agent');
    expect(inferTalkTrack({ explicitTrack: 'model' })).toBe('model');
    expect(trackCreateLabel('model')).toMatch(/模型/);
  });
});
