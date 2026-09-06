/** NewMax skill xray: resident catalog cost is frontmatter description chars. */
export const SKILL_DESC_CUT = 0x600;
export const SKILL_BUDGET_CHARS = 0x3a98;

export type SkillScanIssueCode = 'missing-description' | 'description-truncated';

export interface SkillScanIssue {
  code: SkillScanIssueCode;
  message: string;
}

export interface SkillDescriptionScan {
  descriptionLength: number;
  issues: SkillScanIssue[];
}

export interface ContextBudget {
  totalChars: number;
  budgetChars: number;
  overBudget: boolean;
  ratio: number;
}

export function residentDescriptionChars(description: string | undefined): number {
  return String(description ?? '').trim().length;
}

export function scanSkillDescription(description: string | undefined): SkillDescriptionScan {
  const descriptionLength = residentDescriptionChars(description);
  const issues: SkillScanIssue[] = [];
  if (descriptionLength === 0) {
    issues.push({
      code: 'missing-description',
      message: 'SKILL.md 缺 frontmatter description，模型的技能目录里几乎看不到它，只能靠手动选用',
    });
  } else if (descriptionLength > SKILL_DESC_CUT) {
    issues.push({
      code: 'description-truncated',
      message: `description 共 ${descriptionLength.toLocaleString('zh-CN')} 字符，超过 ${SKILL_DESC_CUT} 截断线。超过的部分模型可能读不到`,
    });
  }
  return { descriptionLength, issues };
}

export function skillScanBadge(description: string | undefined): { ok: boolean; label: string } {
  const { issues } = scanSkillDescription(description);
  if (issues.some((issue) => issue.code === 'missing-description')) {
    return { ok: false, label: '缺描述' };
  }
  if (issues.some((issue) => issue.code === 'description-truncated')) {
    return { ok: false, label: '描述截断' };
  }
  return { ok: true, label: '已扫描' };
}

export function computeContextBudget(
  descriptionLengths: readonly number[],
  budgetChars = SKILL_BUDGET_CHARS,
): ContextBudget {
  const totalChars = descriptionLengths.reduce((sum, value) => sum + Math.max(0, value), 0);
  return {
    totalChars,
    budgetChars,
    overBudget: totalChars > budgetChars,
    ratio: budgetChars > 0 ? totalChars / budgetChars : 0,
  };
}

export function skillCountsTowardResidentBudget(input: {
  enabled: boolean;
  workspaceActive: boolean;
  scope: string;
}): boolean {
  if (!input.enabled) return false;
  if (input.scope === 'global') return true;
  return input.workspaceActive;
}

export function formatCharCount(value: number): string {
  return value.toLocaleString('zh-CN');
}
