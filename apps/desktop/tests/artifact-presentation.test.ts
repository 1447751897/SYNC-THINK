import { describe, expect, it } from 'vitest';
import {
  artifactDisplayName,
  isUserFacingArtifact,
} from '../src/renderer/artifact-presentation.js';

describe('artifact presentation', () => {
  it('keeps only meaningful deliverables from a group collaboration run', () => {
    const candidates = [
      { name: 'Step output decision', stepTitle: '主智能体分析并分解任务' },
      { name: 'Skipped group member one', stepTitle: '视觉验收官' },
      { name: 'Skipped group member two', stepTitle: '质量守护官' },
      { name: 'Tool trace final', stepTitle: '主智能体检查并总结结果' },
      { name: 'Step output final', stepTitle: '主智能体检查并总结结果' },
      { name: 'design.md', stepTitle: '实现设计稿' },
    ];

    expect(candidates.filter(isUserFacingArtifact).map((item) => artifactDisplayName(item))).toEqual([
      '最终结果',
      'design.md',
    ]);
  });

  it('retains a selected or merged generic output because it became an explicit deliverable', () => {
    expect(isUserFacingArtifact({ name: 'Step output legacy', selected: true })).toBe(true);
    expect(isUserFacingArtifact({ name: 'Review outcome legacy', merged: true })).toBe(true);
  });
});
