import { COMPONENT_CATALOG } from './catalog.generated.js';

/** Documentation taxonomy is intentional, not inferred from filename substrings.
 * A component belongs to one section; new files remain visible under Unsorted. */
export const COMPONENT_SECTIONS = [
  {
    id: 'conversation',
    title: '对话与输入',
    english: 'Conversation',
    description: '从发起对话到发送指令，组织输入器、会话导航与上下文菜单。',
    members: [
      ['ComposerEditor', 'Prompt Input', '支持多行编辑、键盘提交和上下文引用的对话输入器。'],
      ['ChatView', 'Chat View', '承载消息记录、流式响应与运行过程的主对话界面。'],
      ['CollaborationChatView', 'Collaboration Chat', '展示多智能体协作会话中的发言与协作进展。'],
      [
        'GroupChatFolders',
        'Chat Folders',
        '按用途归类群聊，支持创建、移动、折叠与重命名；不改变后台执行。',
      ],
      ['BotConversationPane', 'Bot Conversation', '面向机器人联系人的独立会话面板。'],
      ['NewConversationDialog', 'New Conversation', '选择模型、智能体或小队，配置并创建新会话。'],
      ['ConversationTabs', 'Conversation Tabs', '管理同一工作区内打开的会话标签。'],
      ['ConversationMinimapRail', 'Conversation Minimap', '通过缩略导航定位长对话中的消息和进展。'],
      ['ScrollToBottomButton', 'Scroll to Bottom', '离开最新消息时提供返回底部的快捷入口。'],
      ['compose-toolbar', 'Composer Toolbar', '输入器中的模型、身份、权限和推理强度选择。'],
      ['WebSearch', 'Web Search', '真实网页搜索、读取轨迹及可展开的来源标记。'],
      ['agent-limits-card', 'Context Limits', '会话上下文用量、构成明细、压缩阈值与额度重置。'],
      ['ComposerAddMenu', 'Attachment Menu', '向输入器添加文件、图片或其他上下文。'],
      ['ComposerMcpMenu', 'MCP Menu', '在输入器中选择可用的 MCP 能力。'],
      ['ComposerSlashMenu', 'Slash Commands', '通过斜杠命令发现并插入快捷操作。'],
      ['ComposerMenuHighlight', 'Menu Highlight', '跟随键盘与鼠标选择移动的菜单高亮层。'],
      ['ComposerModeControls', 'Mode Controls', '在输入器中切换执行模式与相关选项。'],
      ['ComposeRequestQueue', 'Request Queue', '展示等待发送或执行的输入请求队列。'],
      ['TurnSkillControl', 'Turn Skills', '管理当前轮次使用的技能与能力。'],
      ['prompt-enhancement', 'Prompt Enhancement', '在发送前辅助完善用户输入的提示内容。'],
    ],
  },
  {
    id: 'content',
    title: '消息与内容',
    english: 'Response & content',
    description: '让回答、引用、代码、图像与可视化内容清晰可读。',
    members: [
      ['StreamingResponse', 'Streaming Response', '承载逐步生成的回答，并展示对应完成状态。'],
      ['MessageTextContent', 'Message Content', '组织对话消息的正文与文本内容。'],
      ['MarkdownContent', 'Markdown', '统一渲染 Markdown 正文、列表、链接与代码。'],
      ['CodeBlock', 'Code Block', '支持语法高亮、复制、展开和换行的代码展示。'],
      ['CodeBlockSource', 'Code Source', '为代码块提供原始文本与来源展示层。'],
      ['AnswerSources', 'Citations', '展示回答引用的来源及可检查的证据条目。'],
      ['CitationContext', 'Citation Context', '为消息内的引用标记与来源详情共享上下文。'],
      ['ExternalSourceIcon', 'Source Icon', '区分外部来源类型的图标标记。'],
      ['WebTextLink', 'Web Link', '正文中的网页链接与交互入口。'],
      ['MarkdownImageGallery', 'Image Gallery', '组织 Markdown 中的多张图片与阅读布局。'],
      ['ImageLightbox', 'Image Lightbox', '在放大视图中查看图片内容。'],
      ['MermaidChart', 'Mermaid Diagram', '渲染文本定义的流程图和结构图。'],
      ['InlineVisualizationPreview', 'Visualization', '在消息中展示内联可视化内容。'],
      ['HtmlSandbox', 'HTML Sandbox', '在隔离容器中展示 HTML 内容。'],
    ],
  },
  {
    id: 'execution',
    title: '工具与执行',
    english: 'Tools & execution',
    description: '呈现推理进展、工具结果和审批状态，让每一步执行可检查。',
    members: [
      ['ToolApprovalCard', 'Tool Approval', '请求执行前的权限确认，支持详情查看与决策。'],
      ['PlanApprovalCard', 'Plan Approval', '展示执行计划，等待用户审阅和确认。'],
      ['AskQuestionCard', 'Ask Question', '通过选项或补充输入收集模型需要的回答。'],
      ['ToolResult', 'Tool Result', '统一展示工具调用的结果与返回内容。'],
      ['DeferredToolContent', 'Deferred Tool Content', '按需加载工具内容，减少长对话的初始开销。'],
      ['ExecutionProcessBlock', 'Execution Process', '组织一次执行中的步骤、结果和过程细节。'],
      ['ExecutionTimeline', 'Execution Timeline', '按时间线串联说明文本与工具执行步骤。'],
      ['InlineProcessFlow', 'Process Flow', '以紧凑层级展示对话中的执行过程。'],
      ['AgentActivity', 'Agent Activity', '展示智能体活动、状态与运行进展。'],
      ['ComposerApprovalStack', 'Approval Stack', '在输入区集中呈现等待处理的审批。'],
      ['ExpiredToolApprovalNotice', 'Expired Approval', '提示已失效的审批，并提供重新编辑入口。'],
      ['RunProcessLoadNotice', 'Process Notice', '展示运行过程的加载状态与异常提示。'],
      ['DesktopWaitingCard', 'Desktop Waiting', '提示桌面操作等待状态与下一步动作。'],
    ],
  },
  {
    id: 'primitives',
    title: '基础交互',
    english: 'Components',
    description: '按钮、表单、反馈与视觉标记，构成界面的基础交互单元。',
    members: [
      ['CodeBlockButton', 'Button', '带按压反馈的按钮，支持键盘与禁用状态。'],
      ['CopyTextButton', 'Copy Button', '复制文本，并显示成功或失败反馈。'],
      ['ToggleControl', 'Toggle', '用于偏好和配置项的开关控件。'],
      ['SecretInputControl', 'Secret Input', '用于密钥等敏感配置的输入控件。'],
      ['SlidingTabs', 'Sliding Tabs', '通过滑动指示器展示当前分段选择。'],
      ['DsTabBar', 'Tab Bar', '用于页面与内容区域切换的标签栏。'],
      ['Dialog', 'Dialog', '承载确认、提示和文本输入等模态交互。'],
      ['Toast', 'Toast', '以轻量提示反馈操作结果与状态变化。'],
      ['ContextMenu', 'Context Menu', '根据当前对象提供上下文操作菜单。'],
      ['LoadingPixelGrid', 'Loading Indicator', '用于工作状态反馈的像素加载动效。'],
      ['OverlayScrollArea', 'Scroll Area', '为可滚动内容提供一致的滚动交互。'],
      ['GridReveal', 'Grid Reveal', '为网格内容提供渐进呈现效果。'],
      ['BrandLogoMark', 'Brand Mark', '统一展示模型和服务的品牌标识。'],
      ['FileTypeIcon', 'File Icon', '根据文件路径呈现对应类型的图标。'],
      ['AgentAvatarView', 'Avatar', '以文字、图片或机器人形象展示智能体身份。'],
      ['BotAvatarCanvas', 'Bot Avatar', '使用画布渲染机器人头像及动画状态。'],
    ],
  },
  {
    id: 'workspace',
    title: '文件与工作台',
    english: 'Workspace',
    description: '在同一工作区内阅读文件、检查差异、编辑文档与管理 Git。',
    members: [
      ['FilePane', 'File Pane', '承载已打开文件及其编辑和预览状态。'],
      ['WorkspaceFileView', 'Workspace Files', '展示工作区文件内容与相关操作。'],
      ['FileContentPreview', 'File Preview', '按文件类型选择合适的内容预览。'],
      ['FileDiffSurface', 'File Diff', '展示文件变更、差异工具栏和滚动视口。'],
      ['DeferredFileDiff', 'Deferred Diff', '按需加载文件差异，避免一次挂载全部内容。'],
      ['word-diff', 'Word Diff', '标注行内文字级别的新增与删除。'],
      ['GitPanel', 'Git Panel', '集中查看仓库状态、变更和 Git 操作。'],
      ['GitIdentityMenu', 'Git Identity', '选择或配置 Git 提交身份。'],
      ['ComposerGitBar', 'Git Bar', '在会话上下文中显示仓库与 Git 快捷入口。'],
      ['ComposerGitMenu', 'Git Menu', '为输入区提供 Git 上下文菜单。'],
      ['TerminalPane', 'Terminal', '工作区内的终端会话与命令输出。'],
      ['MarkdownDocumentEditor', 'Markdown Editor', '编辑和阅读 Markdown 文档。'],
      ['HtmlFilePreview', 'HTML Preview', '在文件工作区中预览 HTML 页面。'],
      ['ExcalidrawPreview', 'Drawing Editor', '查看和编辑 Excalidraw 设计稿。'],
      ['ExcalidrawDraftPreview', 'Drawing Draft', '展示与保存生成的设计草稿。'],
      ['WorkspaceWorkbench', 'Workbench', '组织工作台面板、标签与可停靠内容。'],
      ['WorkspacePaneHost', 'Pane Host', '管理分屏中的工作区内容与焦点。'],
      ['RightDock', 'Side Dock', '承载右侧文件列表和检查面板。'],
    ],
  },
  {
    id: 'agents',
    title: '智能体与能力',
    english: 'Agents & capabilities',
    description: '管理智能体、小队和能力，连接可用的身份与工具。',
    members: [
      ['AgentLibrary', 'Agent Library', '创建和管理智能体的身份、模型与能力配置。'],
      ['TeamLibrary', 'Team Library', '组织智能体小队及其协作目标。'],
      ['AgentContactsSidebar', 'Agent Contacts', '在侧栏浏览和选择智能体联系人。'],
      ['AbilityCenterPage', 'Capability Center', '浏览和管理技能、工具与可用能力。'],
      ['McpIdentityMark', 'MCP Identity', '在能力界面标记 MCP 服务身份。'],
    ],
  },
  {
    id: 'browser',
    title: '浏览器与接管',
    english: 'Browser',
    description: '从浏览器任务到人工接管，管理网页工作流与运行状态。',
    members: [
      ['BrowserStage', 'Browser Workspace', '承载浏览器工作区与配置管理。'],
      ['BrowserPanel', 'Browser Panel', '展示网页浏览器视图与基础操作。'],
      ['BrowserTaskDashboard', 'Browser Tasks', '集中查看浏览器任务与执行预览。'],
      ['BrowserTaskInfo', 'Task Info', '展示浏览器任务的上下文和状态信息。'],
      ['BrowserWorkflowPanel', 'Browser Workflow', '编辑和运行浏览器操作工作流。'],
      [
        'GroupBrowserAutomation',
        'Group Automation',
        '为群聊绑定浏览器账号、复用操作流程，并管理本群定时监控与登录接力。',
      ],
      ['BrowserHandoffCard', 'Browser Handoff', '在自动化与人工操作之间提供接管提示。'],
      ['ChromeExtensionBridgeCard', 'Extension Bridge', '展示浏览器扩展桥接状态与连接操作。'],
    ],
  },
  {
    id: 'tasks',
    title: '任务与活动',
    english: 'Tasks & activity',
    description: '安排定时任务，选择执行范围，并检查活动与执行记录。',
    members: [
      ['TaskPanel', 'Task Panel', '管理自动化任务、触发条件与执行历史；保留日历与编辑能力。'],
      [
        'AutomationCenter',
        'Automation Center',
        '呈现自动化任务列表、选中配置、执行就绪条件与真实历史。',
      ],
      [
        'AutomationBindings',
        'Automation Bindings',
        '绑定执行权限、Profile、已发布流程、MCP、产物、明确 Gmail 发件工具与验收说明。',
      ],
      ['TaskCalendar', 'Task Calendar', '通过日历查看任务安排。'],
      ['TaskSheet', 'Task Sheet', '在任务详情表单中编辑配置。'],
      ['TaskScopePicker', 'Scope Picker', '选择任务所属的工作区和执行范围。'],
      ['TaskTemporalPicker', 'Schedule Picker', '选择任务执行的时间与周期。'],
      ['WeeklyRuleEditor', 'Weekly Schedule', '配置按周重复的任务时间规则。'],
      ['TaskStatusPanel', 'Task Status', '展示任务执行状态与过程概况。'],
      ['WorkspaceScopeRow', 'Workspace Scope', '以单行控件展示和选择工作区范围。'],
      ['ActivityCenterPage', 'Activity Inbox', '聚合运行活动与需要关注的事件。'],
      ['DaemonCard', 'Daemon Status', '展示后台常驻运行的状态信息。'],
      ['MeetingMinutesDialog', 'Meeting Minutes', '查看与处理会话会议记录。'],
      ['GoalSettingsDialog', 'Goal Settings', '配置目标任务的执行选项。'],
    ],
  },
  {
    id: 'settings',
    title: '设置与模型',
    english: 'Settings',
    description: '配置模型、外观、搜索和内核，让各类设置保持一致。',
    members: [
      ['SettingsPage', 'Settings', '应用设置的主入口与分区容器。'],
      ['PreferencesSettings', 'Appearance Settings', '管理界面主题、外观与个人偏好。'],
      ['SettingsSectionTabs', 'Settings Tabs', '切换设置页中的内容分区。'],
      ['ModelSettings', 'Model Settings', '配置模型供应商、模型列表和使用方式。'],
      ['model-settings-widgets', 'Model Controls', '模型设置页复用的输入和操作控件。'],
      ['ModelListSelect', 'Model Select', '从模型列表中搜索和选择模型。'],
      ['ModelOverflowMenu', 'Model Actions', '提供模型条目的更多操作。'],
      ['ImageGenerationSettings', 'Image Settings', '配置图像生成相关的模型和参数。'],
      ['WebSearchSettings', 'Search Settings', '配置网页搜索相关的能力。'],
      ['ProjectlessDataSetting', 'Global Data', '管理不隶属于项目的全局数据选项。'],
      ['DesktopUpdatePanel', 'App Updates', '检查和展示桌面应用更新状态。'],
      ['KernelUpdatePanel', 'Kernel Updates', '管理运行内核的安装与更新。'],
    ],
  },
  {
    id: 'shell',
    title: '应用框架',
    english: 'App shell',
    description: '定义窗口、侧栏、导航与初次使用体验的应用级结构。',
    members: [
      ['ShellApp', 'App Shell', '连接桌面主导航、会话和工作台的应用根界面。'],
      ['Sidebar', 'Sidebar', '在会话、智能体和应用功能之间导航。'],
      ['TopBar', 'Top Bar', '管理工作区标签与窗口顶部操作。'],
      ['KeepAliveLayer', 'Keep Alive', '切换页面时保留内容状态和已挂载视图。'],
      ['WallpaperReadingLayers', 'Reading Layers', '为壁纸主题上的内容提供阅读层。'],
      ['FirstLaunchGuide', 'Onboarding', '引导首次使用时的必要配置。'],
      ['HomeScenarios', 'Starter Scenarios', '为新对话提供可选的使用场景。'],
      ['TipsCarousel', 'Tips', '轮播展示产品使用提示。'],
    ],
  },
  {
    id: 'legacy',
    title: '历史 UI Kit',
    english: 'Legacy',
    description: '保留源码索引用于迁移参考；旧样式已移除，不属于当前桌面设计。',
    members: [],
  },
  {
    id: 'unsorted',
    title: '待归类',
    english: 'Unsorted',
    description: '新发现的公开组件，尚待补充用途分类。',
    members: [],
  },
] as const;

export type SectionId = (typeof COMPONENT_SECTIONS)[number]['id'];
const metadata = new Map<string, { section: SectionId; title: string; description: string }>();
for (const section of COMPONENT_SECTIONS)
  for (const [name, title, description] of section.members)
    metadata.set(name, { section: section.id, title, description });
const componentOrder = new Map([...metadata.keys()].map((name, index) => [name, index]));
export const DOCUMENTED_COMPONENTS = COMPONENT_CATALOG.map((c) => {
  const meta = c.legacy ? undefined : metadata.get(c.name);
  return {
    ...c,
    id: c.source,
    section: c.legacy ? ('legacy' as const) : (meta?.section ?? ('unsorted' as const)),
    title: meta?.title ?? c.name.replace(/([a-z])([A-Z])/g, '$1 $2'),
    description:
      meta?.description ??
      (c.legacy
        ? '历史 UI Kit 组件；保留公开导出和源码路径作为迁移参考。'
        : '新增组件；可查看公开导出与源码位置，分类说明待补充。'),
  };
}).sort(
  (a, b) =>
    (a.legacy ? Infinity : (componentOrder.get(a.name) ?? Infinity)) -
    (b.legacy ? Infinity : (componentOrder.get(b.name) ?? Infinity)),
);
export type DocumentedComponent = (typeof DOCUMENTED_COMPONENTS)[number];
export const visibleSections = COMPONENT_SECTIONS.filter((s) =>
  DOCUMENTED_COMPONENTS.some((c) => c.section === s.id),
);
export function filterComponents(query: string, section?: SectionId, liveOnly = false) {
  const needle = query.trim().toLowerCase();
  return DOCUMENTED_COMPONENTS.filter(
    (c) =>
      (!section || c.section === section) &&
      (!liveOnly || c.live) &&
      `${c.name} ${c.title} ${c.description} ${c.exports.join(' ')} ${c.source}`
        .toLowerCase()
        .includes(needle),
  );
}
export type LibraryRoute =
  | { view: 'overview' }
  | { view: 'tokens' }
  | { view: 'live' }
  | { view: 'category'; section: SectionId }
  | { view: 'component'; id: string };
export function routeHash(route: LibraryRoute): string {
  return (
    '#ds/' +
    (route.view === 'category'
      ? `category/${route.section}`
      : route.view === 'component'
        ? `component/${encodeURIComponent(route.id)}`
        : route.view)
  );
}
export function readLibraryRoute(hash: string): LibraryRoute {
  const [, type, ...rest] = hash.split('/');
  if (!hash.startsWith('#ds/')) return { view: 'overview' };
  if (type === 'tokens' || type === 'live') return { view: type };
  if (type === 'category' && visibleSections.some((s) => s.id === rest[0]))
    return { view: 'category', section: rest[0] as SectionId };
  try {
    const id = decodeURIComponent(rest.join('/'));
    if (type === 'component' && DOCUMENTED_COMPONENTS.some((c) => c.id === id))
      return { view: 'component', id };
  } catch {
    /* malformed links return to the overview */
  }
  return { view: 'overview' };
}
