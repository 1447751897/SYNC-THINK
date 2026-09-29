import bilibiliIcon from './assets/connectors/bilibili.png';
import captchaIcon from './assets/connectors/captcha.png';
import douyinIcon from './assets/connectors/douyin.png';
import instagramIcon from './assets/connectors/instagram.png';
import kuaishouIcon from './assets/connectors/kuaishou.png';
import lemon8Icon from './assets/connectors/lemon8.png';
import linkedinIcon from './assets/connectors/linkedin.png';
import mixedLinkIcon from './assets/connectors/mixed-link.png';
import neteaseMusicIcon from './assets/connectors/netease-music.png';
import pipixiaIcon from './assets/connectors/pipixia.png';
import qichachaIcon from './assets/connectors/qichacha.png';
import redditIcon from './assets/connectors/reddit.png';
import sora2Icon from './assets/connectors/sora-2.png';
import telegramIcon from './assets/connectors/telegram.png';
import tempMailIcon from './assets/connectors/temp-mail.png';
import threadsIcon from './assets/connectors/threads.png';
import tiktokIcon from './assets/connectors/tiktok.png';
import toutiaoIcon from './assets/connectors/toutiao.png';
import wechatChannelsIcon from './assets/connectors/wechat-channels.png';
import wechatOfficialIcon from './assets/connectors/wechat-official.png';
import wechatSearchIcon from './assets/connectors/wechat-search.png';
import weiboIcon from './assets/connectors/weibo.png';
import xTwitterIcon from './assets/connectors/x-twitter.png';
import xiaohongshuIcon from './assets/connectors/xiaohongshu.png';
import xiguaIcon from './assets/connectors/xigua.png';
import youtubeIcon from './assets/connectors/youtube.png';
import zhihuIcon from './assets/connectors/zhihu.png';

export type IntegrationCategory =
  | 'recommended'
  | 'design'
  | 'code-ci'
  | 'issues'
  | 'docs'
  | 'customer-voice'
  | 'analytics'
  | 'monitoring'
  | 'communication';

export type ConnectorConnectionMode = 'mcp' | 'oauth';

/**
 * Everything the OAuth broker needs to turn "click 授权连接" into a working
 * MCP server, without the catalog ever touching user credentials.
 *
 * `providerId` keys into the runtime provider registry
 * (`apps/runtime/src/oauth/providers.ts`); `scopes` is what gets requested at
 * authorize time; `mcpEndpoint` is what we register once a token exists.
 */
export interface OAuthProviderBinding {
  providerId: string;
  scopes: string;
  mcpEndpoint?: string;
  /** Google-style providers need the offline grant to return a refresh token. */
  accessTypeOffline?: boolean;
}

export interface ManagedConnectorCatalogItem {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  category?: IntegrationCategory;
  initials?: string;
  accent?: string;
  connectionMode?: ConnectorConnectionMode;
  oauth?: OAuthProviderBinding;
}

export interface IntegrationCatalogItem {
  id: string;
  name: string;
  description: string;
  category: IntegrationCategory;
  initials: string;
  accent: string;
  connectionMode?: ConnectorConnectionMode;
  oauth?: OAuthProviderBinding;
}

// Row-major order mirrors the three-column catalog at the reference width.
export const SYNC_THINK_CONNECTOR_CATALOG: readonly ManagedConnectorCatalogItem[] = [
  { id: 'douyin', name: '抖音', icon: douyinIcon },
  { id: 'tiktok', name: 'TikTok', icon: tiktokIcon },
  { id: 'qichacha', name: '企查查', icon: qichachaIcon },
  { id: 'instagram', name: 'Instagram', icon: instagramIcon },
  { id: 'xiaohongshu', name: '小红书', icon: xiaohongshuIcon },
  { id: 'weibo', name: '微博', icon: weiboIcon },
  { id: 'youtube', name: 'YouTube', icon: youtubeIcon },
  { id: 'kuaishou', name: '快手', icon: kuaishouIcon },
  { id: 'zhihu', name: '知乎', icon: zhihuIcon },
  { id: 'bilibili', name: '哔哩哔哩', icon: bilibiliIcon },
  { id: 'linkedin', name: 'LinkedIn', icon: linkedinIcon },
  { id: 'reddit', name: 'Reddit', icon: redditIcon },
  { id: 'wechat-official', name: '微信公众号', icon: wechatOfficialIcon },
  { id: 'pipixia', name: '皮皮虾', icon: pipixiaIcon },
  { id: 'sora-2', name: 'Sora 2', icon: sora2Icon },
  { id: 'lemon8', name: 'Lemon8', icon: lemon8Icon },
  { id: 'netease-music', name: '网易云音乐', icon: neteaseMusicIcon },
  { id: 'wechat-channels', name: '微信视频号', icon: wechatChannelsIcon },
  { id: 'x-twitter', name: 'X（Twitter）', icon: xTwitterIcon },
  { id: 'threads', name: 'Threads', icon: threadsIcon },
  { id: 'telegram', name: 'Telegram', icon: telegramIcon },
  { id: 'captcha', name: '验证码识别', icon: captchaIcon },
  { id: 'toutiao', name: '今日头条', icon: toutiaoIcon },
  { id: 'xigua', name: '西瓜视频', icon: xiguaIcon },
  { id: 'wechat-search', name: '微信搜一搜', icon: wechatSearchIcon },
  { id: 'temp-mail', name: '临时邮箱', icon: tempMailIcon },
  { id: 'mixed-link', name: '混合链接解析', icon: mixedLinkIcon },
];

/**
 * External app catalog. Entries carrying `connectionMode: 'oauth'` are driven
 * by the runtime OAuth broker: the card opens the browser, the loopback
 * callback receives the code, and a token is exchanged for a callable MCP
 * server. Entries without it fall back to the manual remote-MCP flow.
 *
 * The catalog holds provider metadata only — provider id, requested scopes and
 * an optional default MCP endpoint. OAuth client id/secret are the user's, and
 * are stored separately per provider (see `oauth.clientConfig.save`).
 */
export const SYNC_THINK_INTEGRATION_CATALOG: readonly IntegrationCatalogItem[] = [
  {
    id: 'github',
    name: 'GitHub',
    description: '浏览仓库、Issue 和 Pull Request',
    category: 'code-ci',
    initials: 'GH',
    accent: '#24292f',
    connectionMode: 'oauth',
    oauth: {
      providerId: 'github',
      scopes: 'repo read:org read:user',
      mcpEndpoint: 'https://api.githubcopilot.com/mcp/',
    },
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    description: '查看项目、合并请求和流水线',
    category: 'code-ci',
    initials: 'GL',
    accent: '#fc6d26',
    connectionMode: 'oauth',
    oauth: { providerId: 'gitlab', scopes: 'read_api read_user' },
  },
  {
    id: 'gitee',
    name: 'Gitee 码云',
    description: '管理仓库、Issue 和 Pull Request',
    category: 'code-ci',
    initials: 'Ge',
    accent: '#c71d23',
    connectionMode: 'oauth',
    oauth: { providerId: 'gitee', scopes: 'projects issues pull_requests user_info' },
  },
  {
    id: 'linear',
    name: 'Linear',
    description: '跟踪 Issue、项目和迭代周期',
    category: 'issues',
    initials: 'Li',
    accent: '#5e6ad2',
    connectionMode: 'oauth',
    oauth: {
      providerId: 'linear',
      scopes: 'read write',
      mcpEndpoint: 'https://mcp.linear.app/mcp',
    },
  },
  {
    id: 'jira',
    name: 'Jira',
    description: '搜索和更新团队工作项',
    category: 'issues',
    initials: 'Ji',
    accent: '#1868db',
    connectionMode: 'oauth',
    oauth: { providerId: 'atlassian', scopes: 'read:jira-work write:jira-work offline_access' },
  },
  {
    id: 'notion',
    name: 'Notion',
    description: '搜索页面、文档和数据库',
    category: 'docs',
    initials: 'No',
    accent: '#111111',
    connectionMode: 'oauth',
    oauth: { providerId: 'notion', scopes: '', mcpEndpoint: 'https://mcp.notion.com/mcp' },
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    description: '搜索文件并读取团队文档',
    category: 'docs',
    initials: 'GD',
    accent: '#4285f4',
    connectionMode: 'oauth',
    oauth: {
      providerId: 'google',
      scopes: 'https://www.googleapis.com/auth/drive.readonly',
      accessTypeOffline: true,
    },
  },
  {
    id: 'google-docs',
    name: 'Google Docs',
    description: '读取文档正文、评论和协作建议',
    category: 'docs',
    initials: 'Doc',
    accent: '#1a73e8',
    connectionMode: 'oauth',
    oauth: {
      providerId: 'google',
      scopes:
        'https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/drive.readonly',
      accessTypeOffline: true,
    },
  },
  {
    id: 'slack',
    name: 'Slack',
    description: '读取频道并发送工作消息',
    category: 'communication',
    initials: 'S',
    accent: '#611f69',
    connectionMode: 'oauth',
    oauth: { providerId: 'slack', scopes: 'channels:read channels:history chat:write users:read' },
  },
  {
    id: 'discord',
    name: 'Discord',
    description: '读取服务器频道并发送消息',
    category: 'communication',
    initials: 'Dc',
    accent: '#5865f2',
    connectionMode: 'oauth',
    oauth: { providerId: 'discord', scopes: 'identify guilds guilds.messages.read' },
  },
  {
    id: 'microsoft-teams',
    name: 'Microsoft Teams',
    description: '读取频道并发送团队消息',
    category: 'communication',
    initials: 'T',
    accent: '#6264a7',
    connectionMode: 'oauth',
    oauth: { providerId: 'microsoft', scopes: 'offline_access ChannelMessage.Read.All' },
  },
  {
    id: 'figma',
    name: 'Figma',
    description: '读取设计文件、组件和设计令牌',
    category: 'design',
    initials: 'Fg',
    accent: '#f24e1e',
    connectionMode: 'oauth',
    oauth: {
      providerId: 'figma',
      scopes: 'file_read',
      mcpEndpoint: 'https://mcp.figma.com/mcp',
    },
  },
  {
    id: 'vercel',
    name: 'Vercel',
    description: '查看部署、日志和预览地址',
    category: 'code-ci',
    initials: 'V',
    accent: '#111111',
    connectionMode: 'oauth',
    oauth: { providerId: 'vercel', scopes: 'read' },
  },
  {
    id: 'sentry',
    name: 'Sentry',
    description: '读取错误并整理异常问题',
    category: 'monitoring',
    initials: 'Se',
    accent: '#362d59',
    connectionMode: 'oauth',
    oauth: { providerId: 'sentry', scopes: 'event:read project:read' },
  },
  {
    id: 'datadog',
    name: 'Datadog',
    description: '查询指标、日志和告警',
    category: 'monitoring',
    initials: 'D',
    accent: '#632ca6',
    connectionMode: 'oauth',
    oauth: { providerId: 'datadog', scopes: '' },
  },
  {
    id: 'gmail',
    name: 'Gmail',
    description: '读取邮件线程并生成草稿回复',
    category: 'communication',
    initials: 'G',
    accent: '#ea4335',
    connectionMode: 'oauth',
    oauth: {
      providerId: 'google',
      scopes:
        'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose',
      accessTypeOffline: true,
    },
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    description: '读取日程并查找空闲时间',
    category: 'communication',
    initials: 'GC',
    accent: '#4285f4',
    connectionMode: 'oauth',
    oauth: {
      providerId: 'google',
      scopes:
        'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events',
      accessTypeOffline: true,
    },
  },
  {
    id: 'clickup',
    name: 'ClickUp',
    description: '读取任务并更新状态',
    category: 'issues',
    initials: 'CU',
    accent: '#7b68ee',
    connectionMode: 'oauth',
    oauth: { providerId: 'clickup', scopes: '' },
  },
];

export const INTEGRATION_CATEGORY_LABELS: Readonly<Record<IntegrationCategory, string>> = {
  recommended: '推荐',
  design: '设计',
  'code-ci': '代码与 CI',
  issues: '问题与规划',
  docs: '文档与知识',
  'customer-voice': '客户反馈',
  analytics: '分析',
  monitoring: '监控',
  communication: '通信',
};
