import type {
  CapabilityUsageSummary,
  McpServerSummary,
  SkillVersionSummary,
} from '@sync-think/protocol';
import type { McpMarketItem, SkillMarketItem } from './capability-market.js';

export type SkillFamily = {
  skillId: string;
  latest: SkillVersionSummary;
  versions: SkillVersionSummary[];
};

export const EMPTY_USAGE: CapabilityUsageSummary = {
  capabilityType: 'skill',
  capabilityId: '',
  callCount: 0,
  successCount: 0,
  failedCount: 0,
  cancelledCount: 0,
  problemCount: 0,
  contextTokens: 0,
};

export function groupSkillVersions(skills: readonly SkillVersionSummary[]): SkillFamily[] {
  const grouped = new Map<string, SkillVersionSummary[]>();
  for (const skill of skills) {
    const versions = grouped.get(skill.skillId) ?? [];
    versions.push(skill);
    grouped.set(skill.skillId, versions);
  }
  return [...grouped.entries()]
    .map(([skillId, versions]) => {
      const sorted = [...versions].sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      );
      const enabled = sorted.find((skill) => skill.enabled);
      return {
        skillId,
        latest: enabled ?? sorted[0]!,
        versions: sorted,
      };
    })
    .sort((left, right) => left.latest.name.localeCompare(right.latest.name, 'zh-CN'));
}

export function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function formatRelativeDate(value?: string): string {
  if (!value) return '从未';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '从未';
  const diffDays = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '昨天';
  if (diffDays < 30) return `${diffDays} 天前`;
  return formatDate(value);
}

export function formatTokens(value: number): string {
  if (value < 1_000) return value.toLocaleString('zh-CN');
  return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
}

export function skillOriginLabel(skill: SkillVersionSummary): string {
  if (skill.originType === 'market') return '市场安装';
  if (skill.originType === 'derived') return '本地派生';
  return '本地创建';
}

export function marketSkillInstalled(
  item: SkillMarketItem,
  families: readonly SkillFamily[],
): SkillVersionSummary | undefined {
  const originRef = `market://skills/${item.id}`;
  return families.find((family) => {
    const skill = family.latest;
    if (skill.originRef === originRef) return true;
    const values = [skill.name, skill.skillId, skill.skillVersionId]
      .map((value) => value.trim().toLocaleLowerCase())
      .filter(Boolean);
    return [item.name, item.slug, item.id]
      .map((value) => value.trim().toLocaleLowerCase())
      .some((needle) => values.some((value) => value === needle || value.endsWith(`:${needle}`)));
  })?.latest;
}

export function marketMcpInstalled(
  item: McpMarketItem,
  servers: readonly McpServerSummary[],
): McpServerSummary | undefined {
  return servers.find(
    (server) => server.name.trim().toLocaleLowerCase() === item.name.toLocaleLowerCase(),
  );
}

export function nextPatchVersion(value: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(value.trim());
  if (!match) return '1.0.1';
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}${match[4] ?? ''}`;
}

export function replaceSkillFrontmatter(
  source: string,
  fields: { name: string; description: string; version: string },
): string {
  const normalized = source.replace(/^\uFEFF/, '').trim();
  const body = normalized.startsWith('---')
    ? normalized.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
    : normalized;
  return `---
name: ${fields.name.trim()}
description: ${fields.description.trim()}
version: ${fields.version.trim()}
---

${body.trim() || '在这里编写 Skill 的详细执行指令。'}
`;
}

export function newSkillTemplate(): string {
  return `---
name: my-skill
description: 描述这个 Skill 的作用
version: 1.0.0
---

在这里编写 Skill 的详细执行指令。
`;
}
