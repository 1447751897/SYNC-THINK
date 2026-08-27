import { describe, expect, it } from 'vitest';
import { buildPersonalizationInstructions } from './personalization-context.js';

describe('buildPersonalizationInstructions', () => {
  it('omits an empty profile', () => {
    expect(buildPersonalizationInstructions(null)).toBeUndefined();
  });

  it('projects all personalization fields into stable system instructions', () => {
    const result = buildPersonalizationInstructions({
      name: '小林',
      workDescription: 'TypeScript 桌面应用工程师',
      globalPrompt: '请用中文回答，代码注释使用英文。',
    });

    expect(result).toContain('Preferred user name: 小林');
    expect(result).toContain('User work context:\nTypeScript 桌面应用工程师');
    expect(result).toContain('Global user instructions (apply to every conversation):');
    expect(result).toContain('请用中文回答，代码注释使用英文。');
  });
});
