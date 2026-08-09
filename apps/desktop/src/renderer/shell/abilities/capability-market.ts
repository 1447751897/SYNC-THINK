export type SkillMarketItem = {
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  source: string;
};

export type McpMarketItem = {
  id: string;
  name: string;
  category: string;
  description: string;
  transport: 'local-stdio' | 'remote-http';
  endpoint: string;
  notes: string;
};

function makeSkillSource(input: {
  name: string;
  description: string;
  body: string;
  tools?: string[];
}): string {
  const tools = input.tools?.length
    ? `\nallowed-tools: [${input.tools.map((tool) => JSON.stringify(tool)).join(', ')}]`
    : '';
  return `---
name: ${input.name}
description: ${input.description}
version: 1.0.0${tools}
---

${input.body}
`;
}

export const SKILL_CATEGORIES = [
  '全部',
  '开发工具',
  '文档助手',
  '数据分析',
  '自动化',
  '设计创意',
  '内容发布',
] as const;

export const MCP_CATEGORIES = [
  '全部',
  '开发工具',
  '文件系统',
  '数据库',
  '浏览器',
  '协作',
] as const;

export const SKILL_MARKET: SkillMarketItem[] = [
  {
    id: 'project-bootstrap',
    slug: 'project-bootstrap',
    name: '项目初始化',
    category: '开发工具',
    description: '从需求拆解到目录、规范、测试入口和里程碑，建立可执行的项目起点。',
    source: makeSkillSource({
      name: '项目初始化',
      description: '将产品需求整理为可执行的项目初始化方案。',
      body: '先确认目标与边界，再建立目录、开发规则、里程碑、测试入口和验收清单。',
      tools: ['read-file'],
    }),
  },
  {
    id: 'automation-workflow',
    slug: 'automation-workflow',
    name: '自动化工作流',
    category: '自动化',
    description: '编排 CI/CD、脚本生成、定时任务与 Git Hooks 等重复工作。',
    source: makeSkillSource({
      name: '自动化工作流',
      description: '设计和维护可复用的自动化工作流。',
      body: '标注触发条件、输入输出和失败恢复，再生成最小可验证的自动化步骤。',
      tools: ['read-file'],
    }),
  },
  {
    id: 'frontend-design',
    slug: 'frontend-design',
    name: '前端设计',
    category: '设计创意',
    description: '为页面、组件和产品工作台建立清晰、统一、可落地的视觉规范。',
    source: makeSkillSource({
      name: '前端设计',
      description: '设计高质量且可实现的前端界面。',
      body: '从信息层级、排版、颜色、间距和交互状态出发，输出可实现的设计与验证清单。',
    }),
  },
  {
    id: 'web-to-markdown',
    slug: 'web-to-markdown',
    name: '网页转 Markdown',
    category: '文档助手',
    description: '提取网页正文并整理为干净的 Markdown，保留标题、链接和关键结构。',
    source: makeSkillSource({
      name: '网页转 Markdown',
      description: '把网页正文整理成结构清晰的 Markdown。',
      body: '提取正文层级、列表、链接与代码块，去除导航、广告和重复内容。',
      tools: ['browser'],
    }),
  },
  {
    id: 'data-insight',
    slug: 'data-insight',
    name: '数据洞察',
    category: '数据分析',
    description: '从表格与结构化数据中提取趋势、异常、结论和后续行动。',
    source: makeSkillSource({
      name: '数据洞察',
      description: '分析结构化数据并生成清晰的结论。',
      body: '先检查数据质量和统计口径，再分析趋势、异常、关联和可执行建议。',
    }),
  },
  {
    id: 'publish-x',
    slug: 'publish-x',
    name: '发布到 X/Twitter',
    category: '内容发布',
    description: '准备文案、媒体清单和发布前确认步骤，形成可审核的发布流程。',
    source: makeSkillSource({
      name: '发布到 X/Twitter',
      description: '生成可审核的 X/Twitter 发布计划。',
      body: '先输出最终文案和媒体清单，得到确认后再进入发布步骤。',
      tools: ['browser'],
    }),
  },
];

export const MCP_MARKET: McpMarketItem[] = [
  {
    id: 'filesystem',
    name: 'Workspace Files',
    category: '文件系统',
    description: '读取和管理当前工作区中的文件与目录。',
    transport: 'local-stdio',
    endpoint: 'npx -y @modelcontextprotocol/server-filesystem .',
    notes: '仅授予当前工作区所需的目录范围。',
  },
  {
    id: 'playwright',
    name: 'Playwright Browser',
    category: '浏览器',
    description: '通过 Playwright 检查网页、执行交互并读取页面状态。',
    transport: 'local-stdio',
    endpoint: 'npx -y @playwright/mcp@latest',
    notes: '浏览器自动化 MCP。',
  },
  {
    id: 'github',
    name: 'GitHub',
    category: '协作',
    description: '读取仓库、Issue、Pull Request 和代码评审信息。',
    transport: 'local-stdio',
    endpoint: 'npx -y @modelcontextprotocol/server-github',
    notes: '需要在运行环境中配置对应凭据。',
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    category: '数据库',
    description: '发现数据库结构并执行受控查询。',
    transport: 'local-stdio',
    endpoint: 'npx -y @modelcontextprotocol/server-postgres',
    notes: '连接信息由本地环境提供。',
  },
];
