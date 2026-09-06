import { describe, expect, it } from 'vitest';
import {
  SKILL_BUDGET_CHARS,
  SKILL_DESC_CUT,
  computeContextBudget,
  formatCharCount,
  residentDescriptionChars,
  scanSkillDescription,
  skillCountsTowardResidentBudget,
  skillScanBadge,
} from './skill-resident-context.js';

describe('skill resident context (NewMax xray)', () => {
  it('counts trimmed frontmatter description characters, not historical usage tokens', () => {
    expect(residentDescriptionChars('  从需求拆解到目录和里程碑。  ')).toBe(13);
    expect(residentDescriptionChars('')).toBe(0);
    expect(residentDescriptionChars(undefined)).toBe(0);
  });

  it('flags missing and truncated descriptions the way NewMax health scan does', () => {
    expect(scanSkillDescription('').issues.map((issue) => issue.code)).toEqual([
      'missing-description',
    ]);
    expect(scanSkillDescription('x'.repeat(SKILL_DESC_CUT)).issues).toEqual([]);
    expect(scanSkillDescription('x'.repeat(SKILL_DESC_CUT + 1)).issues[0]?.code).toBe(
      'description-truncated',
    );
    expect(skillScanBadge('可用的代码审查助手').label).toBe('已扫描');
    expect(skillScanBadge('').label).toBe('缺描述');
    expect(skillScanBadge('x'.repeat(SKILL_DESC_CUT + 8)).label).toBe('描述截断');
  });

  it('sums enabled catalog descriptions against the 15,000 character budget', () => {
    const budget = computeContextBudget([120, 80, 0, 40]);
    expect(budget).toEqual({
      totalChars: 240,
      budgetChars: SKILL_BUDGET_CHARS,
      overBudget: false,
      ratio: 240 / SKILL_BUDGET_CHARS,
    });
    expect(SKILL_BUDGET_CHARS).toBe(15_000);
    expect(formatCharCount(SKILL_BUDGET_CHARS)).toBe('15,000');
  });

  it('keeps globally enabled skills in the global budget and only activated skills in a workspace', () => {
    expect(
      skillCountsTowardResidentBudget({
        enabled: true,
        workspaceActive: false,
        scope: 'global',
      }),
    ).toBe(true);
    expect(
      skillCountsTowardResidentBudget({
        enabled: false,
        workspaceActive: true,
        scope: 'global',
      }),
    ).toBe(false);
    expect(
      skillCountsTowardResidentBudget({
        enabled: true,
        workspaceActive: false,
        scope: 'workspace-a',
      }),
    ).toBe(false);
    expect(
      skillCountsTowardResidentBudget({
        enabled: true,
        workspaceActive: true,
        scope: 'workspace-a',
      }),
    ).toBe(true);
  });
});
