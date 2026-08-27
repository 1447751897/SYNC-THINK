import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { SkillMarketItemSummary } from '@sync-think/protocol';
import {
  resolveLocalSkillPackage,
  type ResolvedLocalSkillPackage,
} from './local-skill-discovery.js';

interface AuthorSkillPackage extends SkillMarketItemSummary {
  files: Readonly<Record<string, string>>;
}

function skillMd(input: {
  slug: string;
  description: string;
  body: string;
  allowedTools?: readonly string[];
}): string {
  const tools = input.allowedTools?.length
    ? `\nallowed-tools: [${input.allowedTools.map((tool) => JSON.stringify(tool)).join(', ')}]`
    : '';
  return `---
name: ${input.slug}
description: ${input.description}
version: 1.0.0${tools}
---

${input.body.trim()}
`;
}

const AUTHOR_SKILL_PACKAGES: readonly AuthorSkillPackage[] = [
  {
    id: 'project-bootstrap',
    slug: 'project-bootstrap',
    name: '项目初始化',
    category: '开发工具',
    description: '从需求拆解到目录、规范、测试入口和里程碑，建立可执行的项目起点。',
    author: 'SYNC-THINK',
    version: '1.0.0',
    icon: 'folder-cog',
    files: {
      'SKILL.md': skillMd({
        slug: 'project-bootstrap',
        description: '将产品需求整理为可执行、可验收的项目初始化方案。',
        allowedTools: ['read-file'],
        body: `# 项目初始化

先确认目标、边界、技术约束与验收方式，再建立目录、开发规则、里程碑、测试入口和交付清单。

## 工作流

1. 阅读现有仓库结构与约束，不覆盖用户已有改动。
2. 把需求拆成可独立验证的交付项。
3. 为每项补充实现位置、测试方法和完成标准。
4. 使用 references/acceptance-checklist.md 做交付前核对。`,
      }),
      'references/acceptance-checklist.md': `# 项目初始化验收清单

- 目标、非目标和约束已写清楚
- 目录与模块边界能对应需求
- 本地启动、测试和构建命令可执行
- 关键路径有失败态与回滚说明
- 交付结果能由用户独立复验
`,
    },
  },
  {
    id: 'automation-workflow',
    slug: 'automation-workflow',
    name: '自动化工作流',
    category: '自动化',
    description: '编排 CI/CD、脚本生成、定时任务与 Git Hooks 等重复工作。',
    author: 'SYNC-THINK',
    version: '1.0.0',
    icon: 'workflow',
    files: {
      'SKILL.md': skillMd({
        slug: 'automation-workflow',
        description: '设计和维护可观察、可恢复的自动化工作流。',
        allowedTools: ['read-file'],
        body: `# 自动化工作流

先明确触发条件、输入、输出、幂等键、超时和失败恢复，再生成最小可验证的自动化步骤。

交付时必须说明如何观察运行状态、如何重试，以及重复触发是否会产生副作用。`,
      }),
      'references/workflow-contract.md': `# 工作流契约

记录 Trigger、Inputs、Outputs、Idempotency、Timeout、Retry、Observability 和 Rollback。
`,
    },
  },
  {
    id: 'frontend-design',
    slug: 'frontend-design',
    name: '前端设计',
    category: '设计创意',
    description: '为页面、组件和产品工作台建立清晰、统一、可落地的视觉规范。',
    author: 'SYNC-THINK',
    version: '1.0.0',
    icon: 'palette',
    files: {
      'SKILL.md': skillMd({
        slug: 'frontend-design',
        description: '设计高质量且可实现的前端界面。',
        body: `# 前端设计

从用户工作流、信息层级、排版、颜色、间距和交互状态出发，复用项目设计系统并输出可实现的设计与验证清单。

完成前检查桌面和窄窗口、键盘焦点、加载、空态、错误态与 reduced-motion。`,
      }),
      'references/visual-qa.md': `# 视觉验收

- 信息层级可扫描
- 文字在目标窗口清晰可读
- 控件 hover、focus、active、disabled 完整
- 动态内容不推动固定布局
- 浅色与深色主题都通过对比度检查
`,
    },
  },
  {
    id: 'web-to-markdown',
    slug: 'web-to-markdown',
    name: '网页转 Markdown',
    category: '文档助手',
    description: '提取网页正文并整理为干净的 Markdown，保留标题、链接和关键结构。',
    author: 'SYNC-THINK',
    version: '1.0.0',
    icon: 'file-text',
    files: {
      'SKILL.md': skillMd({
        slug: 'web-to-markdown',
        description: '把网页正文整理成结构清晰的 Markdown。',
        allowedTools: ['browser'],
        body: `# 网页转 Markdown

保留正文标题层级、列表、链接、表格和代码块，移除导航、广告、浮层与重复内容。

来源 URL 和抓取时间放在文档开头；不确定的结构保留原文，不自行补写。`,
      }),
      'references/output-shape.md': `# 输出结构

来源、抓取时间、标题、摘要、正文、引用链接。
`,
    },
  },
  {
    id: 'data-insight',
    slug: 'data-insight',
    name: '数据洞察',
    category: '数据分析',
    description: '从表格与结构化数据中提取趋势、异常、结论和后续行动。',
    author: 'SYNC-THINK',
    version: '1.0.0',
    icon: 'chart-no-axes-combined',
    files: {
      'SKILL.md': skillMd({
        slug: 'data-insight',
        description: '分析结构化数据并生成可复核的结论。',
        allowedTools: ['read-file'],
        body: `# 数据洞察

先检查数据质量、字段含义、时间范围和统计口径，再分析趋势、异常、关联和可执行建议。

每个结论都附计算口径或对应数据范围，明确区分事实、推断与建议。`,
      }),
      'references/analysis-checklist.md': `# 分析检查

检查缺失值、重复值、异常值、单位、时区、样本偏差和聚合口径。
`,
    },
  },
  {
    id: 'publish-x',
    slug: 'publish-x',
    name: '发布到 X/Twitter',
    category: '内容发布',
    description: '准备文案、媒体清单和发布前确认步骤，形成可审核的发布流程。',
    author: 'SYNC-THINK',
    version: '1.0.0',
    icon: 'send',
    files: {
      'SKILL.md': skillMd({
        slug: 'publish-x',
        description: '生成可审核的 X/Twitter 发布计划。',
        allowedTools: ['browser'],
        body: `# 发布到 X/Twitter

先输出最终文案、链接、媒体顺序与发布账号，等待用户确认后再执行发布步骤。

发布前复核字符数、链接目标、媒体替代文本和账号身份；发布后返回可点击链接。`,
      }),
      'references/preflight.md': `# 发布前核对

文案、账号、媒体顺序、替代文本、链接目标、发布时间均已确认。
`,
    },
  },
];

function toMarketSummary(item: AuthorSkillPackage): SkillMarketItemSummary {
  return {
    id: item.id,
    slug: item.slug,
    name: item.name,
    category: item.category,
    description: item.description,
    author: item.author,
    version: item.version,
    icon: item.icon,
  };
}

export function listAuthorSkillMarket(): SkillMarketItemSummary[] {
  return AUTHOR_SKILL_PACKAGES.map(toMarketSummary);
}

export function getAuthorSkillMarketItem(id: string): SkillMarketItemSummary | undefined {
  const item = AUTHOR_SKILL_PACKAGES.find((candidate) => candidate.id === id);
  if (!item) return undefined;
  return toMarketSummary(item);
}

/** Materialize the embedded author package so the normal directory installer owns the copy. */
export async function resolveAuthorSkillMarketPackage(
  id: string,
): Promise<ResolvedLocalSkillPackage> {
  const item = AUTHOR_SKILL_PACKAGES.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Skill 市场中不存在该能力：${id}`);

  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'sync-think-market-skill-'));
  const packageDirectory = join(temporaryDirectory, item.slug);
  try {
    for (const [relativePath, content] of Object.entries(item.files)) {
      const parts = relativePath.split('/');
      if (parts.some((part) => !part || part === '.' || part === '..')) {
        throw new Error(`Skill 市场包文件路径无效：${relativePath}`);
      }
      const target = join(packageDirectory, ...parts);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, 'utf8');
    }
    const resolved = await resolveLocalSkillPackage(packageDirectory);
    return {
      ...resolved,
      cleanup: () => {
        resolved.cleanup();
        rmSync(temporaryDirectory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}
