import { describe, expect, it } from 'vitest';
import { parsePlanMarkdown } from './plan-markdown.js';

describe('parsePlanMarkdown', () => {
  it('parses numbered steps with checkbox acceptance checks', () => {
    const plan = parsePlanMarkdown(
      '加健康检查端点',
      [
        '目标：新增 /api/health 端点',
        '1. 创建路由文件',
        '   - 位置 src/app/api/health/route.ts',
        '- [ ] GET 返回 200',
        '2. 补充测试',
        '- [x] vitest 通过',
      ].join('\n'),
    );
    expect(plan.title).toBe('加健康检查端点');
    expect(plan.goal).toContain('/api/health');
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0]).toMatchObject({
      id: 'step-1',
      title: '创建路由文件',
      acceptanceChecks: ['GET 返回 200'],
    });
    expect(plan.steps[0].description).toContain('route.ts');
    expect(plan.steps[1].acceptanceChecks).toEqual(['vitest 通过']);
  });

  it('treats level-1/2 headings as structure and level-3+ as steps', () => {
    const plan = parsePlanMarkdown('方案', ['# 总体方案', '## 概述', '### 第一步', '做事情'].join('\n'));
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].title).toBe('第一步');
  });

  it('falls back to a single placeholder step so plan.submit validation passes', () => {
    const plan = parsePlanMarkdown('', '只有一段没有任何结构的说明文字。');
    expect(plan.title).toBe('执行方案');
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].id).toBe('step-1');
  });
});
