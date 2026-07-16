import { describe, expect, it } from 'vitest';
import { deriveTaskTitleFromPrompt, isUntitledTaskTitle } from './task-title.js';

describe('task title derivation', () => {
  it('recognizes only product-generated placeholder titles', () => {
    expect(isUntitledTaskTitle('新任务')).toBe(true);
    expect(isUntitledTaskTitle('新任务 3')).toBe(true);
    expect(isUntitledTaskTitle('子任务')).toBe(true);
    expect(isUntitledTaskTitle('修复登录流程')).toBe(false);
  });

  it('derives a concise title from the first user requirement', () => {
    expect(
      deriveTaskTitleFromPrompt('请帮我分析现有项目，然后修复登录流程并补充测试。'),
    ).toBe('分析现有项目，然后修复登录流程并补充测试');
  });

  it('removes list markers and caps long titles without splitting surrogate pairs', () => {
    const title = deriveTaskTitleFromPrompt(
      '1. 完整梳理工作区、任务、模型与协作流程，并完成端到端实现、测试和视觉验收',
      24,
    );
    expect(title.startsWith('完整梳理工作区')).toBe(true);
    expect(Array.from(title).length).toBeLessThanOrEqual(24);
    expect(title.endsWith('…')).toBe(true);
  });
});
