import { describe, expect, it } from 'vitest';
import { deriveTaskTitleFromPrompt } from './task-title.js';
import {
  looksLikeOpaqueId,
  resolveRunIndexDisplayTitle,
  resolveRunIndexHumanTitle,
  resolveRunIndexModelLabel,
} from './run-index-title.js';

describe('run index display titles', () => {
  it('rejects Sync-Think ids that users cannot read', () => {
    expect(looksLikeOpaqueId('1BH6F4YC5ST8SWWW10TB4QNQNVKZSRZ')).toBe(true);
    expect(looksLikeOpaqueId('conv-01HZXK4Q9R')).toBe(true);
    expect(looksLikeOpaqueId('gpt-5.2')).toBe(false);
    expect(looksLikeOpaqueId('分析登录流程')).toBe(false);
  });

  it('prefers the conversation title over a stored id or placeholder', () => {
    expect(
      resolveRunIndexDisplayTitle({
        storedTitle: '1BH6F4YC5ST8SWWW10TB4QNQNVKZSRZ',
        conversationTitle: '分析登录流程',
        source: 'chat',
      }),
    ).toBe('分析登录流程');
    expect(
      resolveRunIndexHumanTitle({
        storedTitle: '新对话',
        conversationTitle: '新对话',
        source: 'chat',
      }),
    ).toBeUndefined();
  });

  it('derives a short title from the triggering prompt', () => {
    const prompt = '请帮我分析现有项目，然后修复登录流程并补充测试。';
    expect(
      resolveRunIndexDisplayTitle({
        triggerText: prompt,
        source: 'chat',
      }),
    ).toBe(deriveTaskTitleFromPrompt(prompt));
  });

  it('falls back to a source label instead of a run id', () => {
    expect(resolveRunIndexDisplayTitle({ source: 'chat' })).toBe('对话');
    expect(resolveRunIndexDisplayTitle({ source: 'scheduled' })).toBe('定时任务');
    expect(resolveRunIndexHumanTitle({ source: 'chat' })).toBeUndefined();
  });

  it('hides opaque model ids and keeps provider names', () => {
    expect(
      resolveRunIndexModelLabel({
        modelId: '1BH6F4YC5ST8SWWW10TB4QNQNVKZSRZ',
      }),
    ).toBeUndefined();
    expect(
      resolveRunIndexModelLabel({
        modelId: '1BH6F4YC5ST8SWWW10TB4QNQNVKZSRZ',
        providerModelId: 'gpt-5.2',
      }),
    ).toBe('gpt-5.2');
  });
});
