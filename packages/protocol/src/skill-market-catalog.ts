import type { SkillMarketItemSummary } from './commands.js';

export const AUTHOR_SKILL_MARKET_CATALOG = {
  'project-bootstrap': {
    id: 'project-bootstrap',
    slug: 'project-bootstrap',
    name: '项目初始化',
    category: '开发工具',
    description: '从需求拆解到目录、规范、测试入口和里程碑，建立可执行的项目起点。',
    author: 'SYNC-THINK',
    version: '1.0.0',
    icon: 'folder-cog',
  },
  'automation-workflow': {
    id: 'automation-workflow',
    slug: 'automation-workflow',
    name: '自动化工作流',
    category: '自动化',
    description: '编排 CI/CD、脚本生成、定时任务与 Git Hooks 等重复工作。',
    author: 'SYNC-THINK',
    version: '1.0.0',
    icon: 'workflow',
  },
  'frontend-design': {
    id: 'frontend-design',
    slug: 'frontend-design',
    name: '前端设计',
    category: '设计创意',
    description: '为页面、组件和产品工作台建立清晰、统一、可落地的视觉规范。',
    author: 'SYNC-THINK',
    version: '1.0.0',
    icon: 'palette',
  },
  'web-to-markdown': {
    id: 'web-to-markdown',
    slug: 'web-to-markdown',
    name: '网页转 Markdown',
    category: '文档助手',
    description: '提取网页正文并整理为干净的 Markdown，保留标题、链接和关键结构。',
    author: 'SYNC-THINK',
    version: '1.0.0',
    icon: 'file-text',
  },
  'data-insight': {
    id: 'data-insight',
    slug: 'data-insight',
    name: '数据洞察',
    category: '数据分析',
    description: '从表格与结构化数据中提取趋势、异常、结论和后续行动。',
    author: 'SYNC-THINK',
    version: '1.0.0',
    icon: 'chart-no-axes-combined',
  },
  'publish-x': {
    id: 'publish-x',
    slug: 'publish-x',
    name: '发布到 X/Twitter',
    category: '内容发布',
    description: '准备文案、媒体清单和发布前确认步骤，形成可审核的发布流程。',
    author: 'SYNC-THINK',
    version: '1.0.0',
    icon: 'send',
  },
} as const satisfies Readonly<Record<string, SkillMarketItemSummary>>;

export type AuthorSkillMarketId = keyof typeof AUTHOR_SKILL_MARKET_CATALOG;

export const AUTHOR_SKILL_MARKET_ITEMS: readonly SkillMarketItemSummary[] = Object.values(
  AUTHOR_SKILL_MARKET_CATALOG,
);
