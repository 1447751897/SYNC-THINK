import type { SkillMarketItemSummary } from '@sync-think/protocol';
import { AUTHOR_SKILL_MARKET_ITEMS } from '@sync-think/protocol/skill-market-catalog';

export type SkillMarketItem = SkillMarketItemSummary;

export type McpMarketItem = {
  id: string;
  name: string;
  category: string;
  description: string;
  transport: 'local-stdio' | 'remote-http';
  endpoint: string;
  notes: string;
};

export const SKILL_CATEGORIES = [
  '全部',
  '开发工具',
  '文档助手',
  '数据分析',
  '自动化',
  '设计创意',
  '内容发布',
] as const;

export const MCP_CATEGORIES = ['全部', '开发工具', '文件系统', '数据库', '浏览器', '协作'] as const;

/** Compatibility fallback for older Runtime bridges; current data comes from Runtime. */
export const SKILL_MARKET: SkillMarketItem[] = AUTHOR_SKILL_MARKET_ITEMS.map((item) => ({
  ...item,
}));

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
