/*
 * frontend-preview.js — the demo page: third-party components evaluated against the
 * CURRENT SYNC-THINK.
 *
 * Two rules keep this honest, and both exist because the previous attempt got it wrong:
 *
 *   1. The real UI is never hand-replicated. Whenever the question is "what does this look
 *      like in SYNC-THINK", the answer comes from the app's own build: the 现状 tab embeds
 *      the real QA shell (`/?phase3-visual=…`), and the code comparison's "现有" side is
 *      rendered with CodeBlock.tsx's real markup and styled by the app's own compiled
 *      shell.css. Nothing here draws a fake SYNC-THINK shell.
 *   2. The evaluation sections say what they are. The avatar tab is a size/state/motion
 *      matrix at the real call-site sizes, not a screenshot of the app.
 *
 * Page chrome (fp-*) is the only thing authored here, and it consumes the app's real
 * --color-* tokens, so it follows the app's own theme.
 */
(function () {
  'use strict';

  var BotAvatars = window.BotAvatars;
  var Legacy = window.LegacySvgAvatar;
  var CodeBlocks = window.CodeBlocks;
  if (!BotAvatars || !Legacy || !CodeBlocks) return;

  var nav = document.getElementById('fp-nav');
  var top = document.getElementById('fp-top');
  var body = document.getElementById('fp-body');

  /* ── the real visual cases, from Phase3VisualFixture.tsx ─────────────────── */
  var REAL_CASES = [
    ['connection-and-code', '连接状态与代码块'],
    ['inline-process-hierarchy', '执行过程信息层级'],
    ['long-trace-open', '长执行轨迹（展开）'],
    ['long-trace-closed', '长执行轨迹（收起）'],
    ['streaming-text', '流式文本'],
    ['streaming-follow', '流式跟随'],
    ['workspace-file', '工作区文件'],
    ['execution-auto-disclosure', '自动展开策略'],
    ['welcome', '欢迎页'],
    ['composer-slash-open', '斜杠菜单'],
    ['composer-context', '上下文环'],
    ['task-status-panel', '任务状态面板'],
    ['sliding-tabs', '滑动页签'],
    ['diagnostics', '诊断'],
    ['connection-settings', '连接设置'],
    ['kernel-update-panel', '内核更新']
  ];

  var ui = {
    section: 'consistency',
    theme: 'dark',
    liveCase: 'connection-and-code',
    codeView: 'both'
  };

  /* ══════════════════════════════════════════════════════════════════════════
   *  data — root cause: what the token layer does and does not define
   *
   *  Read from docs/product/16-shell-design-tokens.json (the declared single source of
   *  truth) and scripts/generate-shell-tokens.mjs. `utilities: true` groups are emitted
   *  into `@theme`, so Tailwind v4 mints utilities from them; `utilities: false` groups
   *  land in plain `:root` and can only be reached with a hand-written var().
   * ══════════════════════════════════════════════════════════════════════════ */

  var TOKEN_GROUPS = [
    { id: 'website', prefix: '--web-', utilities: false, total: 60, size: 31, motion: 1, scope: 'website', means: '公开网站，与桌面 shell 无关' },
    { id: 'fonts', prefix: '--font-', utilities: true, total: 3, size: 0, motion: 0, scope: 'shell', means: '字体族（sans / serif / mono）' },
    { id: 'surfaces', prefix: '--color-', utilities: true, total: 6, size: 0, motion: 0, scope: 'shell', means: '表面色阶' },
    { id: 'panels', prefix: '--color-', utilities: true, total: 9, size: 0, motion: 0, scope: 'shell', means: '舞台子表面' },
    { id: 'tabs', prefix: '--shell-tab-', utilities: false, total: 4, size: 0, motion: 0, scope: 'shell', means: '给「页签」这一个组件专用的视觉原语' },
    { id: 'motion', prefix: '--motion-', utilities: false, total: 2, size: 0, motion: 2, scope: 'shell', means: '整个 shell 只有这两个动效 token' },
    { id: 'composer', prefix: '--composer-', utilities: false, total: 59, size: 31, motion: 12, scope: 'component', means: '**一个组件**私有的完整契约：自带 padding / 高度 / 圆角 / 行高 / 时长' },
    { id: 'preference-palettes', prefix: '--preference-color-', utilities: false, total: 36, size: 0, motion: 0, scope: 'shell', means: '配色偏好预览用的源色板' },
    { id: 'borders', prefix: '--color-', utilities: true, total: 2, size: 0, motion: 0, scope: 'shell', means: '描边' },
    { id: 'text', prefix: '--color-', utilities: true, total: 4, size: 0, motion: 0, scope: 'shell', means: '文字色' },
    { id: 'accent', prefix: '--color-', utilities: true, total: 6, size: 0, motion: 0, scope: 'shell', means: '强调色' },
    { id: 'states', prefix: '--color-', utilities: true, total: 7, size: 0, motion: 0, scope: 'shell', means: '交互态（hover / active / focus-ring…）' },
    { id: 'status', prefix: '--color-', utilities: true, total: 4, size: 0, motion: 0, scope: 'shell', means: '语义状态色' },
    { id: 'avatar', prefix: '--color-avatar-', utilities: true, total: 9, size: 0, motion: 0, scope: 'shell', means: '头像配色' },
    { id: 'syntax', prefix: '--color-syntax-', utilities: true, total: 5, size: 0, motion: 0, scope: 'shell', means: '代码高亮' },
    { id: 'shadow', prefix: '--color-', utilities: true, total: 1, size: 0, motion: 0, scope: 'shell', means: '只有 modal 一处阴影 token' },
    { id: 'capability', prefix: '--color-cap-', utilities: true, total: 53, size: 0, motion: 0, scope: 'feature', means: '能力中心**整块功能**自己的调色板，文件里带 TODO 要求合并回 --color-*' },
    { id: 'brand', prefix: '--color-brand-', utilities: true, total: 15, size: 0, motion: 0, scope: 'shell', means: '厂商品牌色' },
    { id: 'radius', prefix: '--radius-', utilities: true, total: 5, size: 5, motion: 0, scope: 'shell', means: 'shell 全部圆角词汇：card / row / compose / shell / modal' },
    { id: 'layout', prefix: '--', utilities: true, total: 1, size: 1, motion: 0, scope: 'shell', means: 'sidebar-width，唯一一个布局 token' }
  ];

  var SCOPE_LABEL = {
    website: ['不适用于桌面', 'fp-pill--rename'],
    shell: ['桌面 shell', 'fp-pill--keep'],
    component: ['单组件私有', 'fp-pill--loss'],
    feature: ['单功能私有', 'fp-pill--loss']
  };

  /* ══════════════════════════════════════════════════════════════════════════
   *  data — per-control-family inventory
   *
   *  Built from a read-only audit of apps/desktop/src/renderer/** and
   *  packages/ui-kit/src/**. Every row carries the file:line it was read from. The
   *  numeric columns are the point: they are what "the same component looks different"
   *  means concretely.
   * ══════════════════════════════════════════════════════════════════════════ */

  var SWITCH_FAMILIES = [
    ['ToggleControl + .settings-toggle', 'ToggleControl.tsx:12 · shell.css:24525', '4 处', '34×18 · 圆角 9px · 滑块 14px', '120ms linear', 'is-checked 类', 'role=switch + aria-checked'],
    ['… + .model-toggle', 'ModelSettings.tsx:6464 · shell.css:27406', '1 处', '34×20 · 圆角 999px · 滑块 16px', '180ms', 'is-checked / data-state', '同上'],
    ['… + .settings-preference-toggle', 'PreferencesSettings.tsx:1184 · shell.css:21448', '1 处', '34×18 · 圆角 999px · 滑块 14px', '120ms cubic-bezier', 'is-checked 类', '同上'],
    ['… + .settings-about-toggle', 'DesktopUpdatePanel.tsx:500 · shell.css:24773', '1 处', '34×20 · 圆角 999px · 滑块 16px', '180ms', 'is-checked 类', '同上'],
    ['… + .ability-enable-switch', 'AbilityCenterPage.tsx:1870 · shell.css:38280', '2 处', '34×20 · 圆角 999px · 滑块 12px · <b>带描边</b>', '140ms（3 个属性）', "data-enabled='1'", '同上'],
    ['… + .settings-bot-switch', 'BotConversationPane.tsx:336 · shell.css:23066', '1 处', '38×22 · 圆角 11px · 滑块 16px', '220ms cubic-bezier', "aria-checked='true'", '同上（<b>唯一的绿色</b>）'],
    ['原生 checkbox + CSS 轨道', 'TaskPanel.tsx:1571 · shell.css:13028', '1 处', '34×19 · 圆角 999px · 滑块 15px', "150ms，动的是 <b>left</b> 不是 transform", "data-on='1' + :checked", '原生 checkbox'],
    ['原生 checkbox（5 个包裹层）', 'TaskStatusPanel:248 · ExecutionProcessBlock:957 · CollaborationChatView:170 · AbilityCenterPage:4578 · TeamLibrary:719', '5 处', '<b>没有统一尺寸</b>：15px / 浏览器默认 / Tailwind 默认', '无', ':checked', '原生'],
    ['手写轨道 + role=switch', 'AbilityCenterPage.tsx:2603 / AgentLibrary.tsx:2436', '4 处', '28×16 · 圆角 999px · 滑块 12px', '140ms', "data-checked='1'", '<b>同一套 markup，一处 aria-checked 一处 aria-pressed</b>'],
    ['… Think 开关', 'InlineProcessFlow.tsx:1142 · shell.css:7917', '1 处', '28×16 · 圆角 <b>8px</b> · 滑块 12px', '120ms', 'is-checked 类', 'role=switch + aria-checked'],
    ['文字切换按钮（不是开关）', 'SettingsPage.tsx:1627 · shell.css:22544', '1 处', '高 32px 按钮 · 圆角 16px', '140ms + 按下 scale(.98)', 'is-enabled 类', '<b>无任何开关语义</b>'],
    ['圆形指示器代替 checkbox', 'model-settings-widgets.tsx:204 · shell.css:28542', '1 处', '16×16 · 圆角 <b>999px（圆形）</b>', '无', '.is-checked 行类', '原生（输入被裁切）'],
    ['日历筛选 checkbox', 'TaskCalendar.tsx:263 · task-calendar.css:370', '3 处', '13×13 · 圆角 3px · ::after ✓', '无', 'per-kind 用不同颜色', '原生']
  ];

  var TAB_FAMILIES = [
    ['SlidingTabs（JS 测量 + 滑动 pill）', 'SlidingTabs.tsx:18', '9 处', '圆角 <b>7/8/9/15/16/18/999px</b>；按钮高 25/28/30px；字号 9/9.5/10.5/12/13px', '250ms cubic-bezier', '<b>组件内没有键盘；9 个调用点里只有 1 个自己补了方向键</b>', 'role=tablist 或 group（prop 决定）'],
    ['DsTabBar（React 状态指示器）', 'DsTabBar.tsx:25', '9 处（含 SettingsSectionTabs）', '圆角 <b>64px</b>；容器 28/32/36px；按钮 24/26/30px', '240ms cubic-bezier', '<b>唯一有完整键盘</b>：方向键 + Home/End + 跳过 disabled', 'role=tablist + role=tab + roving tabIndex'],
    ['ConversationTabs（会话页签）', 'ConversationTabs.tsx:462', '1 处', 'Tailwind h-10 gap-[3px] p-1；页签宽 58–172px', '无', '只有 dnd-kit', '<b>是 div[data-active]，没有 role/aria-selected</b>'],
    ['WorkspaceWorkbench 页签', 'WorkspaceWorkbench.tsx:483 · shell.css:41374', '1 处', '宽 172 · 高 28 · 圆角 12px · 字号 13px', 'var(--shell-motion-fast)', '无', 'role=tab + aria-selected，<b>但没有 tablist</b>'],
    ['TopBar 项目页签', 'TopBar.tsx:829', '1 处', '壳层样式 + aria-pressed 图标按钮（:727/:743）', '无', '手写 pointer/key', 'role=tab + aria-selected'],
    ['CollaborationChatView pill', 'CollaborationChatView.tsx:158 · collaboration-chat.css:10', '1 处', 'min-height 28 · padding 0 10 · 圆角 999px · 字号 11px', '无', '无', 'role=tablist + role=tab', '<b>var() 里带硬编码兜底色 #343434</b>'],
    ['约 25 组 aria-pressed 分段控件', 'AgentLibrary:1146 · BrowserStage:501 · ModelSettings:5727 · TaskCalendar:313 · WeeklyRuleEditor:103 · PreferencesSettings:316 …', '约 70 处属性', '高度 24–36px；圆角 <b>5/6/7/9/10/11/999px</b>；字号 9–13px', '0 / 80 / 120 / 130 / 140 / 150ms 各不相同', '<b>没有一组实现方向键</b>', 'role=group，无 tab 语义'],
    ['ui-kit ModeSwitch 等', 'packages/ui-kit/src/components/ModeSwitch.tsx:84', '<b>0 处</b>', '<b>找不到任何 CSS</b>', '—', '只有 disabled', '<b>桌面 shell 完全引用不到</b>']
  ];

  var CASCADE_HAZARDS = [
    ['.ability-hub__catalog-tabs', 'shell.css:5093 / 5102 / 37715 / 39350', '<b>同一个类名 4 套互相冲突的数字</b>，结果取决于级联顺序'],
    ['.ability-hub__scope-pill', 'shell.css:38190 / 45879', '两套：27px/9.5px 与 30px/13px'],
    ['.ability-hub__category-row button', 'shell.css:37662 / 37855 / 39406', '三套'],
    ['.usage-tabs', 'shell.css:5107 / 29731', '两套'],
    ['.settings-connection-tabs', 'shell.css:5113 / 21810', '两套；同处还定义了 <code>.shell-agent-tabs</code> / <code>.shell-agent-subtabs</code> 但找不到任何调用点']
  ];

  var A11Y_GAPS = [
    '绝大多数开关没有 <code>:focus-visible</code>：<code>.settings-toggle</code>、<code>.settings-preference-toggle</code>、<code>.ability-enable-switch</code>、<code>SlidingTabs</code> 的子项、以及几乎所有 <code>aria-pressed</code> 分组都没有。',
    '<code>SlidingTabs</code> 9 个调用点里 8 个没有键盘导航，也没有 roving <code>tabIndex</code>。',
    '整个仓库找不到 <code>role="tabpanel"</code> / <code>aria-controls</code> 的配对（只有 ModelSettings.tsx:2666 一个裸的 tabpanel）。',
    '降低动效只覆盖了 <code>.model-toggle</code> 一处；<code>SlidingTabs</code> 的 pill 和 <code>DsTabBar</code> 的指示器都没有。'
  ];

  /* text inputs — condensed from the same audit. 224 tags across 60 files, 12 families. */
  var INPUT_FAMILIES = [
    ['<code>st-field-input</code>', 'shell.css:75', '14 处', '无 height · padding 7px 10px · 圆角 8px · 13px', '描边 + 2px <code>accent-soft</code>', '<b>无</b>'],
    ['ui-kit 的 <code>st-*</code> 输入', 'packages/ui-kit/src/components/*.tsx', '<b>56 处</b>', '<b>全部是浏览器默认</b>（566 个 st-* 类名，0 个有定义）', '<b>无</b>', '<b>无</b>'],
    ['偏好设置 · 个性化', 'shell.css:21605', '3 处', '高 32 · padding 8px 11px · 圆角 10px · 12.5px', '描边 + 3px 12%', '有'],
    ['设置 · 数字输入', 'shell.css:20325', '4 处', '高 34 · padding 0 9px · 圆角 8px · 13px · 右对齐', '<b>无</b>', '<b>无</b>'],
    ['设置 · 连接器表单', 'shell.css:23530', '4 处', '高 34 · padding 0 10px · 圆角 8px · 12px', '描边 + 2px 12%', '<b>无</b>'],
    ['设置 · Bot 表单', 'shell.css:23197', '7 处', '高 36 · padding 0 10px · 圆角 8px · 12px', '描边 + 2px 12%', '<b>无</b>'],
    ['设置 · 联网搜索', 'shell.css:22081', '3 处', '高 31 · padding 0 9px · 圆角 8px · 11.5px', '描边 + 2px 30%', '<b>无</b>'],
    ['设置 · 用量/计费', 'shell.css:29760 / 30103', '7 处', '高 32 · 圆角 8px · 12px', '仅 placeholder', '有'],
    ['任务编辑器', 'shell.css:12716 · task-surfaces.css:320', '18 处', 'min-height 34 · padding 8px 12px · 圆角 10px', '描边 + 3px accent-soft', '<b>无</b>'],
    ['能力中心表单', 'shell.css:7164 / 40265', '22 处', '高 35 · padding 9px 10px · 圆角 9px · 11px', '描边 + 3px 绿 8%', '<b>无</b>'],
    ['协作面板', 'collaboration-chat.css:10', '9 处', 'padding 7px · 圆角 8px · 12px', '<b>整份文件没有任何 focus 规则</b>', '<b>无</b>'],
    ['搜索胶囊（15 个包裹层）', 'settings-search · settings-provider-search · shell-tab-manager__search · shell-library-search · shell-agent-search · ability-hub__search · agent-bind-search · model-import-dialog__search · capability-center__search …', '约 20 处', '高 <b>28–36px</b> · 圆角 <b>7–17px</b> · 7 种背景 token', '<b>4 种 focus 写法，2 处完全没有</b>', '15 个里只有 8 个有'],
    ['Composer（一个控件五种实现）', 'ComposerEditor.tsx:961 · :971 · Phase3VisualFixture:790 · Compose.tsx:530 · ComposeRequestQueue.tsx:69', '5 处', '圆角 <b>20 / 12 / 8px</b> 三种 · min-height <b>36 / 44 / 62 / 72px</b>', '生产那套（CodeMirror）<b>没有 focus ring</b>', '有'],
    ['Tailwind 工具类输入', 'BrowserStage · BrowserWorkflowPanel · Sidebar · TeamLibrary · NewConversationDialog', '17 处', '<code>h-6/7/8/9</code> = 24/28/32/36px · <code>rounded/rounded-md/rounded-lg</code>', '<b>只有 border 变色，没有 ring</b>（唯一这样的一族）', '17 个里 5 个没有'],
    ['浏览器 · 工作流 / 扩展卡 / 地址栏', 'shell.css:36560 / 37006 / 1898 · browser-dashboard.css:585', '6 处', '高 29/32/100% · 圆角 <b>7px 0 0 7px（不对称）</b> / 8px / 0', '无 / 2px 10% / <b>无</b>', '<b>无</b>'],
    ['智能体 / 模型', 'shell.css:44388 / 44247 / 27827', '6 处', '高 34 · 圆角 <code>--radius-row</code> · 高 32 · 圆角 <b>17px</b>', '仅描边变色', '<b>无</b>']
  ];
  /* buttons — condensed from the same audit */
  var BUTTON_FAMILIES = [
    ['capability-button', 'shell.css:5820', '能力中心', '高 32px · 圆角 9px · 字重 <b>650</b>', '—'],
    ['settings-data-button', 'shell.css:23792', '设置 · 数据面板', '高 28px · 圆角 <b>64px（全胶囊）</b> · 字重 500', '—'],
    ['browser-workflow__button', 'shell.css:36589', '浏览器工作流', '高 32px · 圆角 8px · 字重 <b>560</b>', '—'],
    ['task-sheet__button', 'task-surfaces.css:129', '任务表', '高 36px · 圆角 <code>--radius-row</code>', '—'],
    ['settings-button', 'shell.css:41131', '设置 · 通用', '<code>padding 6px 14px</code> · 圆角 8px', '—'],
    ['shell-browser-handoff__button', 'shell.css:5284', '浏览器交接卡', '高 32px · 圆角 8px', '—'],
    ['shell-desktop-waiting__button', 'shell.css:5398', '桌面等待卡', '<b>与上一行几乎逐值相同，但另起了一个类</b>', '—'],
    ['ui-kit 的 75 个 <code>st-*</code> 按钮类', 'packages/ui-kit/src/components/*.tsx', 'ui-kit 全部组件', '<b>全仓找不到任何 CSS 定义</b>；只有 2 个类能解析到样式', '渲染成浏览器默认按钮'],
    ['Tailwind 工具类按钮', 'BrowserStage.tsx · BrowserWorkflowPanel.tsx · Sidebar.tsx · TeamLibrary.tsx · TopBar.tsx', '约 <b>76 个</b>', '<code>h-8/h-7/h-5</code> + <code>px-3/px-2.5</code> + <code>rounded-md</code> + <code>text-[11.5px]</code>', '第 4 种样式机制'],
    ['无 className 的裸按钮', 'AbilityCenterPage(21) · MarkdownDocumentEditor(13) · SettingsPage(11) · ModelSettings(11) · BrowserPanel(11) · AgentLibrary(11)', '约 <b>199 个</b>', '没有自己的类，完全靠祖先选择器（如 <code>.ability-hub button</code>）', '改祖先就影响一片'],
    ['非 button 的 <code>role="button"</code>', 'AgentLibrary:2215 · Sidebar:673 · TeamLibrary:429 · TopBar:899 · ui-kit TraceList:308', '5 处', '各写各的', '键盘/焦点行为要自己保证']
  ];
  /* selects / dropdowns — condensed from the same audit */
  var SELECT_FAMILIES = [
    ['原生 &lt;select&gt; · 主 shell', 'shell.css 里 <b>12 组互不相关的后代选择器</b>', '<b>22 处</b>', '高 28/32/34/35/37px · 圆角 6/8/9/10/12px · 字号 10/10.5/11/12px', '三种焦点写法混用：<code>outline</code> / <code>box-shadow</code> / 只改 <code>border-color</code>'],
    ['原生 &lt;select&gt; · Tailwind', 'BrowserStage.tsx:1358 · TeamLibrary.tsx:403/624', '3 处', '高 28px 与 36px · 圆角 6px 与 8px · 字号 10.5px 与 13px', '只有 <code>focus:border-accent</code>，没有 ring'],
    ['原生 &lt;select&gt; · 浏览器面板', 'browser-dashboard.css:58', '3 处', '高 33px · 圆角 7px · 字号 12px', '<code>outline 2px</code>'],
    ['原生 &lt;select&gt; · 协作', 'collaboration-chat.css:10', '2 处', '圆角 8px · 字号 12px', '<b>无</b>；且是全仓唯一在 <code>var()</code> 里塞硬编码兜底色的地方（<code>#383838</code> / <code>#171717</code>）'],
    ['ModelListSelect', 'ModelListSelect.tsx:78 · shell.css:26107', '6 处', '触发器高 34 · 圆角 <b>17px</b>（另有 32px/12px 的覆盖）· 字号 13px', '菜单 <code>model-settings-menu-in</code> · 有 Escape/外部点击 · <b>无方向键</b>'],
    ['ImageApiProviderSelect', 'ImageGenerationSettings.tsx:1552 · shell.css:28140', '2 处', '<b>触发器几何与 ModelListSelect 逐字节相同</b>（34 / 17px / 13px），但组件和类名完全无关', '菜单绝对定位、<b>没有 max-height、没有动画</b>'],
    ['ModelOverflowMenu', 'ModelOverflowMenu.tsx:13 · shell.css:26051', '5 处', '菜单 圆角 12px · 条目高 32px · 字号 12px', '<code>0 12px 40px</code> · 有 Escape/外部点击 · 自带两步确认'],
    ['TaskScopePicker（Radix）', 'TaskScopePicker.tsx:7 · task-calendar.css:454', '2 处', '触发器 min 36px · 圆角 <code>--radius-row</code>(8px) · 字号 12px', 'Radix 提供完整键盘；菜单圆角 <code>--radius-card</code>(12px)'],
    ['TaskPanel SelectBox（Radix）', 'TaskPanel.tsx:896 · shell.css:13297 → task-surfaces.css:381', '6 处', '触发器 min 34px · 菜单圆角 12px · 条目 8px · 字号 13px', '<b>同一组菜单被两个 CSS 文件先后改了两遍</b>；触发器只有 <code>aria-label</code>，没有 <code>aria-haspopup</code>'],
    ['.shell-menu 家族（Radix）', 'compose-toolbar.tsx:364/442/496/603/726 · shell.css:14056', '9 处', '基础圆角 12px；<b>模型三件套被覆盖成 18px、去边框</b>、宽度 248/260/164px', '<code>--composer-menu-shadow</code>(六层) · 有搜索样式但<b>无人使用</b>'],
    ['NewMax composer 三件套', 'ComposerAddMenu:105 · SlashMenu:278 · McpMenu:36', '6 处', '圆角 18px · 无边框 · <code>--composer-menu-*</code> 一整套', '<b>唯一真正能搜索的列表</b>（Add 菜单）· Slash 有完整方向键 · Mcp <b>没有键盘导航</b>'],
    ['一次性绝对定位菜单 ×11', 'BrowserPanel:865 · FilePane:584 · RightDock:731 · WorkspaceWorkbench:551 · HomeScenarios:273 · TaskStatusPanel:481 · AgentLibrary:1220 · ExcalidrawPreview:579 …', '11 处', '圆角 <b>10px / 12px / 18px 混用</b>；条目高 30–45px', '阴影三种来源混用：字面量 / <code>--shadow-floating</code> / <code>--composer-menu-shadow</code>'],
    ['ui-kit 的选择器层', 'packages/ui-kit/src/components/*.tsx（约 <b>470 个 st-* 类名</b>）', '<b>0 处</b>', '<b>找不到任何 CSS</b> —— 渲染成浏览器默认样式', '其中 <code>ModelPathPicker</code> 是全仓功能最全的选择器（三栏板 + 搜索 + Escape + 外部关闭），却<b>一个视觉定义都没有</b>']
  ];

  /* ── helpers ─────────────────────────────────────────────────────────────── */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function frag() {
    return document.createDocumentFragment();
  }
  function option(value, label) {
    var o = el('option', null, label);
    o.value = value;
    return o;
  }
  function pill(kind, text) {
    return el('span', 'fp-pill fp-pill--' + kind, text);
  }
  var VERDICT = {
    same: ['一致', 'keep'], keep: ['不用改', 'keep'], rename: ['改名', 'rename'],
    loss: ['丢能力', 'loss'], swap: ['换引擎', 'rename'], replace: ['要替换', 'loss'],
    adapt: ['要改', 'rename']
  };
  function verdict(kind) {
    var v = VERDICT[kind] || VERDICT.keep;
    return pill(v[1], v[0]);
  }
  function table(headers, rows) {
    var t = el('table', 'fp-map');
    var thead = el('thead');
    var htr = el('tr');
    headers.forEach(function (h) {
      htr.appendChild(el('th', null, h));
    });
    thead.appendChild(htr);
    t.appendChild(thead);
    var tbody = el('tbody');
    rows.forEach(function (row) {
      var tr = el('tr');
      row.forEach(function (cell, index) {
        var td = el('td');
        if (index === 0) td.textContent = cell;
        else if (cell && cell.__verdict) {
          td.appendChild(verdict(cell.__verdict));
          td.appendChild(document.createTextNode(' '));
          var span = el('span');
          span.innerHTML = cell.html || '';
          td.appendChild(span);
        } else {
          td.innerHTML = cell;
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    t.appendChild(tbody);
    return t;
  }
  function card(title, lead, hot) {
    var c = el('div', 'fp-card' + (hot ? ' fp-card--hot' : ''));
    if (title) c.appendChild(el('h2', null, title));
    if (lead) {
      var p = el('p', 'fp-lead');
      p.innerHTML = lead;
      c.appendChild(p);
    }
    return c;
  }

  /* ══════════════════════════════════════════════════════════════════════════
   *  data
   * ══════════════════════════════════════════════════════════════════════════ */

  var AVATAR_MAP = [
    ['AgentAvatarView.tsx', { __verdict: 'adapt', html: '唯一出口（32 处引用）。只动「带 <code>gen:v1:</code> 前缀的程序化头像」这条分支，图片头像与文字头像两条不动。' }],
    ['avatar-gen.ts', { __verdict: 'adapt', html: '形态/配色常量扩到 18 × 13，或保留映射表。已落库的 seed 不需要迁移。' }],
    ['布局盒', { __verdict: 'adapt', html: '<b>画布必须留 1.5 倍空间</b>：跳跃占头部 100 单位里的 26 个单位，影子要落地板。布局盒仍是 <code>size</code>，但多出来的合成层面积在侧栏密集列表里要留意。' }],
    ['agentAvatarState.ts', { __verdict: 'loss', html: '九个状态里只有 <code>idle / working / sleeping</code> 有对应动效；授权等待、失败、刚完成在头像上完全看不出来。' }],
    ['授权', { __verdict: 'adapt', html: 'libraries.dev 是付费库。这里的几何是原创近似，<b>不是</b>它的代码或素材；上线前要买授权再替换实现。' }]
  ];

  var CODE_MAP = [
    ['CodeBlock.tsx（243 行）', { __verdict: 'replace', html: '整个文件被 beUI 的 <code>code-block.tsx</code> + <code>agent-code.tsx</code> + <code>lib/ease.ts</code> + <code>lib/utils.ts</code> 取代。' }],
    ['MarkdownContent.tsx:13', { __verdict: 'adapt', html: '改 import。' }],
    ['MarkdownContent.tsx:155-181', { __verdict: 'adapt', html: '适配层：<code>streaming: boolean</code> → <code>status</code>；<code>readingState</code> 无对应物。' }],
    ['MarkdownContent.tsx:422 / 439 / 447 / 471', { __verdict: 'adapt', html: '4 处调用点改传参。' }],
    ['InlineProcessFlow.tsx:38 / 356', { __verdict: 'replace', html: '要重写：用了 <code>identity</code> / <code>collapsible={false}</code> / <code>showStatus={false}</code> / <code>copyLabel</code>，beUI 这四个都没有。' }],
    ['ExecutionProcessBlock.tsx', { __verdict: 'keep', html: '文件 diff 卡片，自己的 <code>.hljs</code> 表面。不改，但换完会和新的代码块长得不一样。' }],
    ['HtmlSandbox.tsx:119-182', { __verdict: 'keep', html: '复用 <code>.shell-md-code__lang / __actions / __action</code>。' }],
    ['ExcalidrawDraftPreview.tsx:608,617', { __verdict: 'keep', html: '复用 <code>.shell-md-code__action</code>。' }],
    ['DeferredToolContent.tsx:229,233', { __verdict: 'keep', html: '复用 <code>.shell-md-code__actions / __wrap</code>。' }],
    ['shell.css', { __verdict: 'keep', html: '<b>不能直接删</b>：上面四个表面还在引用这套类名。' }],
    ['CodeBlock.test.tsx 等 3 个测试', { __verdict: 'adapt', html: '断言写死了 <code>.shell-md-code</code> / <code>.hljs-keyword</code> / <code>__collapse</code>。' }],
    ['package.json', { __verdict: 'adapt', html: '加 <code>shiki</code>。<code>motion</code> / <code>clsx</code> / <code>lucide-react</code> / <code>tailwindcss</code> 都已经在了。' }]
  ];

  var CODE_MATRIX = [
    ['code', 'code', { __verdict: 'keep', html: '一致。' }],
    ['language（36 种）', 'language（6 种）', { __verdict: 'loss', html: 'beUI 只预载 bash / diff / json / text / tsx / typescript。传范围外的语言 shiki 会抛错，token 永远到不了 —— 不是降级，是不亮。' }],
    ['filename', 'filename', { __verdict: 'keep', html: 'beUI 收 ReactNode，更宽。' }],
    ['streaming: boolean', "status: 'streaming' | 'complete'", { __verdict: 'rename', html: '改名，调用方要跟着改。' }],
    ['streamingLabel', '—', { __verdict: 'loss', html: '写死英文 "Writing" / "Ready"，没有中文化入口。' }],
    ['showStatus', '—', { __verdict: 'loss', html: '关不掉状态药丸（InlineProcessFlow 现在就是关掉的）。' }],
    ['collapsible + 展开/收起', '—', { __verdict: 'loss', html: '没有折叠，超 12 行的文件永远是一个 280px 滚动框。' }],
    ['2000 行预览上限', '—', { __verdict: 'loss', html: '没有上限，2400 行全量进 DOM。' }],
    ['maxHeight（默认 280）', 'maxHeight（默认 280）', { __verdict: 'keep', html: '默认值一模一样。' }],
    ['wrapControl + useToolOutputWrap', 'wrap（纯 prop）', { __verdict: 'loss', html: '没有折行开关，也没有跨块共享偏好。' }],
    ['highlightLines', 'highlightLines', { __verdict: 'keep', html: '一致。' }],
    ['copyLabel / CopyTextButton', 'copyable / onCopy', { __verdict: 'rename', html: '文案不可定制；但复制反馈 beUI 更好（motion 按压 + 1600ms）。' }],
    ['identity（顶条插槽）', '—', { __verdict: 'loss', html: '没有插槽，InlineProcessFlow 靠它显示 payload 类型。' }],
    ['readingState', '—', { __verdict: 'loss', html: '虚拟列表行重挂载后丢滚动位置。' }],
    ['读者向上滚 → 暂停跟随', '无（每次渲染强制到底）', { __verdict: 'loss', html: '行为退化。' }],
    ['highlight.js', 'shiki', { __verdict: 'rename', html: '换来真正的双主题：light / dark 两套颜色同时挂在同一个 span 上。' }]
  ];

  /* ══════════════════════════════════════════════════════════════════════════
   *  section: 现状 · 真实组件
   * ══════════════════════════════════════════════════════════════════════════ */

  function liveSrc() {
    return (
      '/qa/index.html?phase3-visual=' +
      encodeURIComponent(ui.liveCase) +
      '&theme=' +
      ui.theme +
      '&motion=full'
    );
  }

  function buildLive() {
    var wrap = frag();
    var c = card(
      '现状 · 真实组件',
      '下面是 <b>SYNC-THINK 自己的 shell 构建</b>，不是仿写的：它由 <code>pnpm --filter @sync-think/desktop build:shell:qa</code> 产出，入口是 <code>qa-entry.tsx</code> → <code>Phase3VisualFixture.tsx</code>，渲染的是真实的 <code>MarkdownContent</code> / <code>InlineProcessFlow</code> / <code>ChatView</code> 等组件，样式来自真实的 <code>shell.css</code>。<br />任何「接进去长什么样」的问题都以这里为准。',
      true
    );
    var controls = el('div', 'fp-controls');
    var caseLabel = el('label');
    caseLabel.appendChild(el('span', null, '场景'));
    var caseSel = el('select');
    REAL_CASES.forEach(function (pair) {
      caseSel.appendChild(option(pair[0], pair[1] + ' · ' + pair[0]));
    });
    caseSel.value = ui.liveCase;
    caseLabel.appendChild(caseSel);
    controls.appendChild(caseLabel);
    var openLink = el('a', 'fp-btn', '在新标签打开');
    openLink.href = liveSrc();
    openLink.target = '_blank';
    openLink.rel = 'noreferrer';
    openLink.style.textDecoration = 'none';
    controls.appendChild(openLink);
    var note = el('span');
    note.innerHTML = '主题跟随右上角的明暗开关（<code>?theme=</code>）';
    controls.appendChild(note);
    c.appendChild(controls);

    var frame = el('iframe', 'fp-frame');
    frame.title = 'SYNC-THINK 真实 shell';
    frame.src = liveSrc();
    c.appendChild(frame);

    caseSel.addEventListener('change', function () {
      ui.liveCase = caseSel.value;
      frame.src = liveSrc();
      openLink.href = liveSrc();
    });
    wrap.appendChild(c);
    return wrap;
  }

  /* ══════════════════════════════════════════════════════════════════════════
   *  section: 智能体头像
   * ══════════════════════════════════════════════════════════════════════════ */

  var av = {
    mode: 'new',
    followScene: true,
    state: 'default',
    shape: 'auto',
    color: 'auto',
    scale: 1,
    speed: 1,
    paused: false,
    interactive: true,
    slots: [],
    tickPose: null
  };

  var SHAPE_TO_LEGACY = {
    clover: 'blob', flower: 'cloud', triangle: 'wedge', square: 'squircle', blob: 'blob',
    ghost: 'pebble', circle: 'squircle', drop: 'teardrop', star: 'wedge', droid: 'tablet',
    mech: 'tablet', alien: 'cloud', hexagon: 'hex', cat: 'blob', cloud: 'cloud',
    pill: 'tablet', pebble: 'pebble', puddle: 'pebble'
  };
  var LIB_TO_LEGACY_STATE = { default: 'idle', working: 'working', sleeping: 'sleeping' };

  function hexToRgb(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function nearestLegacyColor(hex) {
    var target = hexToRgb(hex);
    var best = 'blue';
    var bestD = Infinity;
    Object.keys(Legacy.COLOR_HEX).forEach(function (id) {
      var c = hexToRgb(Legacy.COLOR_HEX[id]);
      var d = Math.pow(c[0] - target[0], 2) + Math.pow(c[1] - target[1], 2) + Math.pow(c[2] - target[2], 2);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    });
    return best;
  }
  function colorIdForHex(hex) {
    var found = 'sky';
    BotAvatars.PALETTE.forEach(function (c) {
      if (c.hex.toLowerCase() === String(hex).toLowerCase()) found = c.id;
    });
    return found;
  }
  function avatarNode(id, size, state, extra) {
    var node = el('span', 'av');
    node.setAttribute('data-av', '');
    node.dataset.id = id;
    node.dataset.size = String(size);
    node.dataset.state = state;
    if (extra) node.dataset[extra] = '1';
    return node;
  }
  function mountAvatar(node, scope) {
    if (node.dataset.mounted) return null;
    node.dataset.mounted = '1';
    var canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    var old = el('span', 'av__old');
    node.appendChild(canvas);
    node.appendChild(old);
    var slot = {
      node: node,
      id: node.dataset.id || '',
      baseSize: Number(node.dataset.size || 40),
      sceneState: node.dataset.state || 'default',
      shapeLock: node.dataset.shapeLock || '',
      canvas: canvas,
      old: old,
      inst: null,
      lastOldKey: ''
    };
    slot.inst = BotAvatars.create(canvas, {
      size: slot.baseSize,
      state: slot.sceneState,
      seed: slot.id || 'agent'
    });
    if (!node.dataset.noPoke) {
      node.style.cursor = 'pointer';
      node.title = '点一下试试 — 转体跳跃';
      node.addEventListener('click', function () {
        slot.inst.poke();
      });
    }
    scope.slots.push(slot);
    renderAvatarSlot(slot);
    return slot;
  }
  function resolveFace(slot) {
    if (slot.shapeLock) {
      var lockedHex = BotAvatars.DEFAULT_COLOR[slot.shapeLock] || '#35B8FF';
      return { shape: slot.shapeLock, colorId: colorIdForHex(lockedHex), color: lockedHex, auto: false };
    }
    var derived = BotAvatars.deriveFace(slot.id || 'agent');
    var shape = av.shape === 'auto' ? derived.shape : av.shape;
    var colorId = av.color === 'auto' ? derived.color : av.color;
    return {
      shape: shape,
      colorId: colorId,
      color: BotAvatars.COLOR_HEX[colorId],
      auto: av.shape === 'auto' && av.color === 'auto'
    };
  }
  function renderAvatarSlot(slot) {
    var face = resolveFace(slot);
    var size = Math.max(12, Math.round(slot.baseSize * av.scale));
    var state = av.followScene ? slot.sceneState : av.state;
    slot.inst.setFace({ shape: face.shape, color: face.color, interactive: av.interactive });
    slot.inst.setState(state);
    slot.inst.setOptions({ size: size, speed: av.speed });
    slot.node.style.setProperty('--av-size', size + 'px');

    var legacyShape;
    var legacyColor;
    if (face.auto) {
      var legacyFace = Legacy.deriveAvatarFace(slot.id || 'agent');
      legacyShape = legacyFace.shape;
      legacyColor = legacyFace.color;
    } else {
      legacyShape = SHAPE_TO_LEGACY[face.shape] || 'blob';
      legacyColor = nearestLegacyColor(face.color);
    }
    var legacyState = LIB_TO_LEGACY_STATE[state] || 'idle';
    var key = legacyShape + '|' + legacyColor + '|' + legacyState + '|' + size;
    if (key !== slot.lastOldKey) {
      slot.lastOldKey = key;
      slot.old.innerHTML = Legacy.avatarSvg(legacyShape, legacyColor, legacyState, size);
    }
    slot.node.style.setProperty('--avatar-glow', face.color);
    var host = slot.node.closest('.agent-card__avatar');
    if (host) host.style.setProperty('--avatar-glow', face.color);
  }
  function renderAllAvatars(scope) {
    scope.slots.forEach(renderAvatarSlot);
    scope.slots.forEach(function (slot) {
      slot.inst.setOptions({ paused: av.paused || av.mode === 'old' });
    });
  }

  var CALL_SITES = [
    { where: 'AgentLibrary.tsx:2298', what: '智能体库卡片', size: 56, faces: 1, wrapped: true },
    { where: 'AgentLibrary.tsx:2233', what: '智能体库列表行', size: 38, faces: 1 },
    { where: 'Sidebar.tsx:974', what: '侧栏会话身份（小队叠放）', size: 40, faces: 3 },
    { where: 'ChatView.tsx:6942', what: '消息头', size: 32, faces: 1 },
    { where: 'ChatView.tsx:7796', what: '委派芯片', size: 22, faces: 1 },
    { where: 'InlineProcessFlow 执行过程行', what: '过程行', size: 22, faces: 1 },
    { where: 'TeamLibrary.tsx:71', what: '小队成员', size: 30, faces: 4 }
  ];

  function buildAvatars() {
    var wrap = frag();

    var controls = el('div', 'fp-controls');
    var seg = el('div', 'fp-seg');
    [['new', '新 · 动效'], ['old', '旧 · 现有 SVG'], ['split', '并排']].forEach(function (pair) {
      var b = el('button', null, pair[1]);
      b.type = 'button';
      b.dataset.value = pair[0];
      if (pair[0] === av.mode) b.classList.add('is-on');
      seg.appendChild(b);
    });
    controls.appendChild(seg);

    var stateSel = el('select');
    BotAvatars.LIB_STATES.forEach(function (s) {
      stateSel.appendChild(option(s, BotAvatars.LIB_STATE_LABEL[s] + ' · ' + s));
    });
    stateSel.value = av.state;
    var stateLabel = el('label');
    stateLabel.appendChild(el('span', null, '状态'));
    stateLabel.appendChild(stateSel);
    controls.appendChild(stateLabel);

    var shapeSel = el('select');
    shapeSel.appendChild(option('auto', '自动（按 agent id 派生）'));
    BotAvatars.SHAPES.forEach(function (s) {
      shapeSel.appendChild(option(s.id, s.label + ' · ' + s.id));
    });
    var shapeLabel = el('label');
    shapeLabel.appendChild(el('span', null, '形态'));
    shapeLabel.appendChild(shapeSel);
    controls.appendChild(shapeLabel);

    var swatches = el('span', 'fp-swatches');
    var autoSwatch = el('button', 'fp-swatch is-on');
    autoSwatch.type = 'button';
    autoSwatch.title = '自动（按 agent id 派生）';
    autoSwatch.style.background = 'conic-gradient(#35b8ff,#2fcb7a,#ffd32b,#ff8c42,#dc48ff,#35b8ff)';
    autoSwatch.dataset.value = 'auto';
    swatches.appendChild(autoSwatch);
    BotAvatars.PALETTE.forEach(function (c) {
      var b = el('button', 'fp-swatch');
      b.type = 'button';
      b.title = c.label;
      b.style.background = c.hex;
      b.dataset.value = c.id;
      swatches.appendChild(b);
    });
    var colorLabel = el('label');
    colorLabel.appendChild(el('span', null, '配色'));
    colorLabel.appendChild(swatches);
    controls.appendChild(colorLabel);

    var sizeOut = el('b', null, '1.00');
    var sizeInput = el('input');
    sizeInput.type = 'range';
    sizeInput.min = '60';
    sizeInput.max = '170';
    sizeInput.value = '100';
    var sizeLabel = el('label');
    sizeLabel.appendChild(el('span', null, '尺寸 ×'));
    sizeLabel.appendChild(sizeOut);
    sizeLabel.appendChild(sizeInput);
    controls.appendChild(sizeLabel);

    var speedOut = el('b', null, '1.00');
    var speedInput = el('input');
    speedInput.type = 'range';
    speedInput.min = '0';
    speedInput.max = '200';
    speedInput.value = '100';
    var speedLabel = el('label');
    speedLabel.appendChild(el('span', null, '速度 ×'));
    speedLabel.appendChild(speedOut);
    speedLabel.appendChild(speedInput);
    controls.appendChild(speedLabel);

    var pauseBtn = el('button', 'fp-btn', '暂停动效');
    pauseBtn.type = 'button';
    controls.appendChild(pauseBtn);

    var followLabel = el('label', 'fp-chk');
    var followBox = el('input');
    followBox.type = 'checkbox';
    followBox.checked = av.followScene;
    followLabel.appendChild(followBox);
    followLabel.appendChild(document.createTextNode('跟随场景状态'));
    controls.appendChild(followLabel);

    var interLabel = el('label', 'fp-chk');
    var interBox = el('input');
    interBox.type = 'checkbox';
    interBox.checked = av.interactive;
    interLabel.appendChild(interBox);
    interLabel.appendChild(document.createTextNode('视觉跟随'));
    controls.appendChild(interLabel);

    seg.addEventListener('click', function (event) {
      var btn = event.target.closest('button[data-value]');
      if (!btn) return;
      av.mode = btn.dataset.value;
      document.documentElement.dataset.mode = av.mode;
      Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) {
        b.classList.toggle('is-on', b === btn);
      });
      renderAllAvatars(av);
    });
    stateSel.addEventListener('change', function () {
      av.state = stateSel.value;
      av.followScene = false;
      followBox.checked = false;
      renderAllAvatars(av);
    });
    shapeSel.addEventListener('change', function () {
      av.shape = shapeSel.value;
      renderAllAvatars(av);
    });
    swatches.addEventListener('click', function (event) {
      var btn = event.target.closest('button[data-value]');
      if (!btn) return;
      av.color = btn.dataset.value;
      Array.prototype.forEach.call(swatches.querySelectorAll('button'), function (b) {
        b.classList.toggle('is-on', b === btn);
      });
      renderAllAvatars(av);
    });
    sizeInput.addEventListener('input', function () {
      av.scale = Number(sizeInput.value) / 100;
      sizeOut.textContent = av.scale.toFixed(2);
      renderAllAvatars(av);
    });
    speedInput.addEventListener('input', function () {
      av.speed = Number(speedInput.value) / 100;
      speedOut.textContent = av.speed.toFixed(2);
      renderAllAvatars(av);
    });
    pauseBtn.addEventListener('click', function () {
      av.paused = !av.paused;
      pauseBtn.textContent = av.paused ? '继续动效' : '暂停动效';
      renderAllAvatars(av);
    });
    followBox.addEventListener('change', function () {
      av.followScene = followBox.checked;
      renderAllAvatars(av);
    });
    interBox.addEventListener('change', function () {
      av.interactive = interBox.checked;
      renderAllAvatars(av);
    });

    wrap.appendChild(controls);

    var interCard = card(
      '交互演示 — 视觉跟随 + 点击反馈',
      '这两个是库自带的核心交互：<b>鼠标在页面上移动</b>，每个头像都会转头、转眼珠去看指针（1 个身位内权重 1，3 个身位外 0）；<b>点击任意头像</b>，它会做一次带转体的跳跃。右边读数是这个头像每一帧的真实姿态。',
      true
    );
    var inter = el('div', 'fp-interactive');
    var stage = el('div');
    stage.style.cssText = 'display:flex;flex-direction:column;align-items:center';
    var probe = avatarNode('pose-probe', 128, 'default', 'noPoke');
    stage.appendChild(probe);
    var out = {};
    var readout = el('div', 'fp-readout');
    [
      ['yaw', 'yaw'], ['pitch', 'pitch'], ['roll', 'roll'], ['lookX', 'lookX'], ['lookY', 'lookY'],
      ['blink L/R', 'blink'], ['呼吸', 'breath'], ['权重 def/wrk/slp', 'w']
    ].forEach(function (pair) {
      var row = el('div', 'fp-readout__row');
      row.appendChild(el('span', null, pair[0]));
      var code = el('code', null, '—');
      out[pair[1]] = code;
      row.appendChild(code);
      readout.appendChild(row);
    });
    stage.appendChild(readout);
    inter.appendChild(stage);
    var hint = el('div', 'fp-hint');
    hint.innerHTML =
      '<p>左右移动鼠标看 <code>yaw</code> / <code>lookX</code>，上下移动看 <code>pitch</code>。停一会儿不动，它会自己张望（<code>gaze</code> 每 2.6–4.4 秒换一次注视点）。</p><p style="margin-top:8px">点它一下 —— 每次都是不同的转向。</p>';
    inter.appendChild(hint);
    interCard.appendChild(inter);
    wrap.appendChild(interCard);

    var DEG = Math.PI / 180;
    function fmt(v, dp) {
      return Number(v).toFixed(dp === undefined ? 2 : dp);
    }
    av.tickPose = function () {
      var slot = null;
      for (var i = 0; i < av.slots.length; i += 1) {
        if (av.slots[i].node === probe) slot = av.slots[i];
      }
      if (!slot || !slot.inst.pose || !document.body.contains(probe)) return;
      var p = slot.inst.pose.pose;
      out.yaw.textContent = fmt(p.yaw / DEG, 1) + '°';
      out.pitch.textContent = fmt(p.pitch / DEG, 1) + '°';
      out.roll.textContent = fmt(p.roll / DEG, 1) + '°';
      out.lookX.textContent = fmt(p.lookX);
      out.lookY.textContent = fmt(p.lookY);
      out.blink.textContent = fmt(p.blinkL) + ' / ' + fmt(p.blinkR);
      out.breath.textContent = fmt(p.breath);
      out.w.textContent = p.w
        .map(function (x) {
          return fmt(x);
        })
        .join(' / ');
    };

    var callCard = card(
      '真实调用点',
      '尺寸取自 <code>AgentAvatarView</code> 在各组件里的实际调用。第一行用的是 <code>AgentLibrary.tsx</code> 里真实的 <code>agent-card__avatar</code> 包裹层和它真实的辉光样式 —— 不是仿写的容器。'
    );
    CALL_SITES.forEach(function (site) {
      var row = el('div', 'fp-callsite');
      var holder;
      if (site.wrapped) {
        holder = el('span', 'agent-card__avatar');
      } else {
        holder = el('span');
        holder.style.cssText = 'display:grid;place-items:center';
      }
      if (site.faces > 1) {
        var stack = el('span', 'fp-callsite__faces');
        for (var i = 0; i < site.faces; i += 1) {
          stack.appendChild(avatarNode('agent-' + i, site.size, i === 0 ? 'working' : 'default'));
        }
        holder.appendChild(stack);
      } else {
        holder.appendChild(avatarNode('agent-coder', site.size, 'working'));
      }
      row.appendChild(holder);
      var copy = el('div');
      copy.appendChild(el('div', 'fp-callsite__where', site.where));
      copy.appendChild(el('div', 'fp-callsite__what', site.what + ' · ' + site.size + 'px'));
      row.appendChild(copy);
      callCard.appendChild(row);
    });
    wrap.appendChild(callCard);

    var stateCard = card(
      '库只有三种状态，而 SYNC-THINK 在建模九种',
      '三个状态之间是<b>权重混合</b>过渡（约 1.2s），不是硬切。'
    );
    var notes = {
      default: '视线游走 + 每 2.6–4.4s 换一个注视点，随机眨眼/二次眨眼/眼球扫视，约 8s 跳一次，每第三次带一整圈转体',
      working: '连续弹跳（0.68s 一次），身体前倾 5°，每三次更高并转体，偶尔「笑」到眯眼',
      sleeping: '低头 16°、侧倾 6°，呼吸拉到 3.6–4.8s，每 4–8s 点一次头'
    };
    var grid = el('div', 'fp-grid-cells');
    BotAvatars.LIB_STATES.forEach(function (s) {
      var cell = el('div', 'fp-cell');
      cell.appendChild(avatarNode('state-' + s, 64, s));
      cell.appendChild(el('b', null, BotAvatars.LIB_STATE_LABEL[s] + ' · ' + s));
      cell.appendChild(el('span', null, notes[s]));
      grid.appendChild(cell);
    });
    stateCard.appendChild(grid);
    wrap.appendChild(stateCard);

    var gapCard = card(
      '状态映射与缺口',
      '没有任何一个状态是临时编出来的动效。缺口就是缺口：要么接受退化，要么在接入层自己补一套（那就不是「用他们的动效」了）。'
    );
    var gaps = [];
    Object.keys(BotAvatars.SYNC_THINK_STATE_MAP).forEach(function (s) {
      var row = BotAvatars.SYNC_THINK_STATE_MAP[s];
      gaps.push([s, row.lib + (row.exact ? '' : '（退化）'), row.note]);
    });
    gapCard.appendChild(table(['SYNC-THINK 状态', '实际使用的库状态', '说明'], gaps));
    wrap.appendChild(gapCard);

    var shapeCard = card(
      '形态总览 — 18 种（库的全集）',
      '鼠标在页面上移动时它们会一起看你。天线类的形态（droid / mech）会画到身体轮廓之外。'
    );
    var shapeGrid = el('div', 'fp-grid-cells');
    BotAvatars.SHAPES.forEach(function (s) {
      var cell = el('div', 'fp-cell');
      var node = avatarNode('shape-demo', 56, 'default', 'shapeLock');
      node.dataset.shapeLock = s.id;
      cell.appendChild(node);
      cell.appendChild(el('b', null, s.label));
      cell.appendChild(el('span', null, s.id));
      shapeGrid.appendChild(cell);
    });
    shapeCard.appendChild(shapeGrid);
    wrap.appendChild(shapeCard);

    var sizeCard = card(
      '尺寸标尺',
      '全部是 <code>working</code> 态（连续弹跳），用来判断哪个尺寸上动效还能看、哪个尺寸上只剩噪音。注意画布是布局盒的 1.5 倍 —— 跳跃需要头顶空间。'
    );
    var sizeRow = el('div', 'fp-size-row');
    [22, 26, 30, 34, 38, 40, 46, 56].forEach(function (size) {
      var cell = el('div', 'fp-size-cell');
      cell.appendChild(avatarNode('agent-coder', size, 'working'));
      cell.appendChild(el('b', null, size + 'px'));
      sizeRow.appendChild(cell);
    });
    sizeCard.appendChild(sizeRow);
    wrap.appendChild(sizeCard);

    return wrap;
  }

  /* ══════════════════════════════════════════════════════════════════════════
   *  section: 代码块
   * ══════════════════════════════════════════════════════════════════════════ */

  var TS_SAMPLE = [
    '// 流式生成中：这段代码会一个字一个字地出现',
    "import { highlightCodeLines, languageFromPath } from './code-highlight.js';",
    "import { useDeferredValue, useMemo, useRef, useState } from 'react';",
    '',
    'export interface CodeBlockProps {',
    '  code: string;',
    '  language?: string;',
    '  filename?: string;',
    '  streaming?: boolean;',
    '  highlightLines?: readonly number[];',
    '  maxHeight?: number;',
    '}',
    '',
    'const PREVIEW_LINE_LIMIT = 2000;',
    '',
    'export function CodeBlock({',
    '  code,',
    '  language,',
    '  filename,',
    '  streaming = false,',
    '  highlightLines,',
    '  maxHeight = 280,',
    '}: CodeBlockProps) {',
    '  // useDeferredValue 让 DOM 比流式缓冲区晚一个提交',
    '  const deferredCode = useDeferredValue(code);',
    '  const writing = streaming || deferredCode !== code;',
    "  const resolvedLanguage = language || languageFromPath(filename) || 'text';",
    '  const { lines, totalLines, source } = useMemo(() => {',
    "    const allLines = deferredCode.replace(/\\r\\n/g, '\\n').split('\\n');",
    '    const visible = allLines.slice(0, PREVIEW_LINE_LIMIT);',
    "    return { lines: visible, totalLines: allLines.length, source: visible.join('\\n') };",
    '  }, [deferredCode]);',
    '  const highlighted = useMemo(',
    '    () => highlightCodeLines(source, resolvedLanguage),',
    '    [source, resolvedLanguage],',
    '  );',
    '  const focusedLines = useMemo(() => new Set(highlightLines), [highlightLines]);',
    '  const followingRef = useRef(true);',
    '  const viewportRef = useRef<HTMLDivElement>(null);',
    '',
    '  // 只有读者没有往上滚时才自动跟随',
    '  useEffect(() => {',
    '    const viewport = viewportRef.current;',
    '    if (viewport && writing && followingRef.current) {',
    '      viewport.scrollTop = viewport.scrollHeight;',
    '    }',
    '  }, [deferredCode, writing]);',
    '',
    '  const canExpand = totalLines > 12;',
    '  return (',
    '    <div className="shell-md-code shell-agent-code" data-writing={String(writing)}>',
    '      <div className="shell-md-code__bar">{filename ?? resolvedLanguage}</div>',
    '      <div ref={viewportRef} className="shell-md-code__viewport">',
    '        {lines.map((line, index) => (',
    '          <span key={index} data-code-line={index + 1}>',
    '            {highlighted ? highlighted[index] : line}',
    '          </span>',
    '        ))}',
    '      </div>',
    '    </div>',
    '  );',
    '}'
  ].join('\n');

  var JSON_TOOL = [
    '{',
    '  "tool": "terminal.exec",',
    '  "status": "completed",',
    '  "exitCode": 0,',
    '  "durationMs": 1284,',
    '  "command": "pnpm --filter @sync-think/desktop typecheck",',
    '  "stdout": [',
    '    "> tsc --noEmit",',
    '    "Found 0 errors in 812 files."',
    '  ],',
    '  "artifacts": [',
    '    { "path": "apps/desktop/src/renderer/shell/CodeBlock.tsx", "bytes": 8683 }',
    '  ]',
    '}'
  ].join('\n');

  var DIFF_SAMPLE = [
    'diff --git a/CodeBlock.tsx b/CodeBlock.tsx',
    '--- a/CodeBlock.tsx',
    '+++ b/CodeBlock.tsx',
    '@@ -61,9 +61,7 @@ export function CodeBlock({',
    '-  const deferredCode = useDeferredValue(code);',
    '-  const writing = streaming || deferredCode !== code;',
    '+  const tokens = useAgentCodeTokens(code, language);',
    '+  const writing = status === "streaming";',
    '   const resolvedLanguage = language || languageFromPath(filename) || "text";',
    '-  const highlighted = useMemo(',
    '-    () => highlightCodeLines(source, resolvedLanguage),',
    '-    [source, resolvedLanguage],',
    '-  );',
    '+  const highlighted = useMemo(() => new Set(highlightLines), [highlightLines]);',
    '   const followingRef = useRef(true);'
  ].join('\n');

  var PY_SAMPLE = [
    'from dataclasses import dataclass',
    '',
    '@dataclass(frozen=True)',
    'class RetryPolicy:',
    '    """退避重试：beUI 的 AgentCodeLanguage 里没有 python。"""',
    '    attempts: int = 3',
    '    base_delay: float = 0.4',
    '',
    '    def delay_for(self, attempt: int) -> float:',
    '        if attempt <= 0:',
    '            raise ValueError("attempt must be positive")',
    '        return self.base_delay * (2 ** (attempt - 1))'
  ].join('\n');

  function longFile(lines) {
    var out = ['// 自动生成 ' + lines + ' 行：用来暴露折叠与预览上限的差异'];
    for (var i = 2; i <= lines; i += 1) {
      if (i % 24 === 0) out.push('');
      else if (i % 24 === 1) out.push('export function handler' + i + '(input: Payload): Result {');
      else if (i % 24 === 23) out.push('}');
      else if (i % 3 === 0) out.push('  const value' + i + ' = compute(' + i + ', "label' + i + '");');
      else if (i % 3 === 1) out.push('  if (value' + (i - 1) + ' === null) return fallback(' + i + ');');
      else out.push('  return { ok: true, index: ' + i + ', tags: ["a", "b"] };');
    }
    return out.join('\n');
  }

  var SCENARIOS = {
    stream: {
      label: '流式消息里的 fenced code（主场景）',
      language: 'typescript',
      filename: 'CodeBlock.tsx',
      code: TS_SAMPLE,
      stream: true,
      old: { collapsible: true, showStatus: true, wrapControl: true, maxHeight: 280 },
      beui: { showLineNumbers: true, maxHeight: 280 }
    },
    tool: {
      label: '工具调用结果（identity / 无状态 / 不折叠）',
      language: 'json',
      code: JSON_TOOL,
      stream: false,
      old: {
        collapsible: false,
        showStatus: false,
        maxHeight: 240,
        identity: '<span class="shell-tool-result__label">JSON · 执行结果</span>'
      },
      beui: { showLineNumbers: true, maxHeight: 240 }
    },
    focus: {
      label: '指定行高亮（diff 评审）',
      language: 'diff',
      filename: 'CodeBlock.tsx',
      code: DIFF_SAMPLE,
      stream: false,
      highlightLines: [5, 6, 7, 13],
      old: { collapsible: true, showStatus: false, maxHeight: 280 },
      beui: { showLineNumbers: true, maxHeight: 280 }
    },
    long: {
      label: '长文件（1300 行：折叠）',
      language: 'typescript',
      filename: 'generated/handlers.ts',
      code: longFile(1300),
      stream: false,
      old: { collapsible: true, showStatus: false, maxHeight: 280 },
      beui: { showLineNumbers: true, maxHeight: 280 }
    },
    huge: {
      label: '超长文件（2400 行：触发 2000 行上限）',
      language: 'typescript',
      filename: 'generated/bundle.ts',
      code: longFile(2400),
      stream: false,
      old: { collapsible: true, showStatus: false, maxHeight: 280 },
      beui: { showLineNumbers: true, maxHeight: 280 }
    },
    unsupported: {
      label: 'beUI 不支持的语言（python）',
      language: 'python',
      filename: 'retry_policy.py',
      code: PY_SAMPLE,
      stream: false,
      old: { collapsible: false, showStatus: false, maxHeight: 280 },
      beui: { showLineNumbers: true, maxHeight: 280 }
    }
  };

  var codeScope = { code: null };

  function buildCode() {
    var wrap = frag();
    var controls = el('div', 'fp-controls');

    var viewSeg = el('div', 'fp-seg');
    [['both', '并排'], ['old', '只看现有'], ['new', '只看 beUI']].forEach(function (pair) {
      var b = el('button', null, pair[1]);
      b.type = 'button';
      b.dataset.value = pair[0];
      if (pair[0] === ui.codeView) b.classList.add('is-on');
      viewSeg.appendChild(b);
    });
    controls.appendChild(viewSeg);

    var sceneSel = el('select');
    Object.keys(SCENARIOS).forEach(function (key) {
      sceneSel.appendChild(option(key, SCENARIOS[key].label));
    });
    var sceneLabel = el('label');
    sceneLabel.appendChild(el('span', null, '场景'));
    sceneLabel.appendChild(sceneSel);
    controls.appendChild(sceneLabel);

    var streamBtn = el('button', 'fp-btn fp-btn--primary', '开始流式输出');
    streamBtn.type = 'button';
    controls.appendChild(streamBtn);
    var scrollBtn = el('button', 'fp-btn', '模拟读者向上滚动');
    scrollBtn.type = 'button';
    controls.appendChild(scrollBtn);
    var resetBtn = el('button', 'fp-btn', '重置');
    resetBtn.type = 'button';
    controls.appendChild(resetBtn);
    wrap.appendChild(controls);

    var note = el('div', 'fp-warn');
    note.style.marginTop = '0';
    note.style.marginBottom = '14px';
    note.innerHTML =
      '左侧用的是 <code>CodeBlock.tsx</code> 的真实 class 名（<code>shell-md-code</code> / <code>shell-agent-code__line</code>…），样式来自应用自己的 <code>shell.css</code>，外面套的是真实的 <code>.shell-md</code> 作用域 —— 所以它就是应用里那个代码块，不是仿写的。';
    wrap.appendChild(note);

    var arenaCard = card(
      '并排实机对比',
      '同一段代码、同一个流式节奏。点「开始流式输出」，再点「模拟读者向上滚动」让它接着流 —— 这是两边行为差异最明显的地方：现有版本会尊重你把滚动条往上拉，beUI 每次渲染都会把你拽回底部。',
      true
    );
    var arena = el('div', 'fp-arena');
    arena.dataset.view = ui.codeView;
    var sideOld = el('div', 'fp-side fp-side--old');
    sideOld.appendChild(el('h3', null, '现有 · CodeBlock.tsx · highlight.js · 真实 shell.css'));
    var mountOld = el('div', 'shell-md');
    sideOld.appendChild(mountOld);
    var statsOld = el('p', 'fp-stats');
    sideOld.appendChild(statsOld);
    arena.appendChild(sideOld);
    var sideNew = el('div', 'fp-side fp-side--new');
    sideNew.appendChild(el('h3', null, '候选 · beui/code-block · shiki'));
    var mountNew = el('div');
    sideNew.appendChild(mountNew);
    var statsNew = el('p', 'fp-stats');
    sideNew.appendChild(statsNew);
    arena.appendChild(sideNew);
    arenaCard.appendChild(arena);
    wrap.appendChild(arenaCard);

    var matrixCard = card(
      '能力对照 — 逐个 prop',
      '左边是 <code>CodeBlockProps</code> 的实际字段，右边是 beUI 的。标红的行是换完会丢掉的能力。'
    );
    matrixCard.appendChild(table(['现有 prop', 'beUI 对应', '结论'], CODE_MATRIX));
    wrap.appendChild(matrixCard);

    codeScope.code = {
      arena: arena,
      mountOld: mountOld,
      mountNew: mountNew,
      statsOld: statsOld,
      statsNew: statsNew,
      sceneSel: sceneSel,
      streamBtn: streamBtn,
      old: null,
      beui: null,
      buffer: 0,
      timer: null,
      scenario: 'stream'
    };
    var c = codeScope.code;

    function stopStream() {
      if (c.timer) window.clearInterval(c.timer);
      c.timer = null;
      streamBtn.textContent = '开始流式输出';
    }
    function paintStats() {
      var o = c.old ? c.old.stats : { retokenized: 0, chunks: 0 };
      var n = c.beui ? c.beui.stats : { retokenized: 0, chunks: 0, cacheHits: 0, prefixReuses: 0 };
      statsOld.innerHTML =
        '重新分词 <b class="hot">' + o.retokenized + '</b> 次 · 流式提交 <b>' + o.chunks +
        '</b> 次 · 跟随 <b>' + (c.old && c.old.following ? '开' : '已被读者暂停') + '</b>';
      statsNew.innerHTML =
        '重新分词 <b class="good">' + n.retokenized + '</b> 次 · 前缀复用 <b class="good">' +
        n.prefixReuses + '</b> 次 · 缓存命中 <b>' + n.cacheHits + '</b> 次 · 跟随 <b>始终强制到底</b>' +
        (c.beui && !c.beui.supported ? ' · <b class="hot">shiki 无此语言语法：高亮永远不会出现</b>' : '');
    }
    function renderBoth(code, streaming) {
      c.old.render(code, streaming);
      c.beui.render(code, streaming);
      paintStats();
    }
    function mountScenario() {
      stopStream();
      var scene = SCENARIOS[c.scenario];
      mountOld.textContent = '';
      mountNew.textContent = '';
      c.old = CodeBlocks.createSyncThink({
        code: '',
        language: scene.language,
        filename: scene.filename,
        highlightLines: scene.highlightLines,
        maxHeight: scene.old.maxHeight,
        collapsible: scene.old.collapsible,
        showStatus: scene.old.showStatus,
        wrapControl: scene.old.wrapControl,
        identity: scene.old.identity
      });
      mountOld.appendChild(c.old.root);
      c.beui = CodeBlocks.createBeui({
        code: '',
        language: scene.language,
        filename: scene.filename,
        showLineNumbers: scene.beui.showLineNumbers,
        highlightLines: scene.highlightLines,
        maxHeight: scene.beui.maxHeight
      });
      mountNew.appendChild(c.beui.root);
      if (scene.stream) {
        c.buffer = 0;
        renderBoth('', true);
      } else {
        c.buffer = scene.code.length;
        renderBoth(scene.code, false);
      }
    }
    function stepStream() {
      var scene = SCENARIOS[c.scenario];
      if (!scene.stream) return;
      c.buffer = Math.min(scene.code.length, c.buffer + 26);
      var done = c.buffer >= scene.code.length;
      renderBoth(scene.code.slice(0, c.buffer), !done);
      if (done) stopStream();
    }
    c.mountScenario = mountScenario;
    c.renderBoth = renderBoth;
    c.stepStream = stepStream;
    c.stopStream = stopStream;

    streamBtn.addEventListener('click', function () {
      var scene = SCENARIOS[c.scenario];
      if (!scene.stream) {
        streamBtn.textContent = '这个场景不是流式的';
        window.setTimeout(function () {
          streamBtn.textContent = '开始流式输出';
        }, 1200);
        return;
      }
      if (c.buffer >= scene.code.length) {
        c.buffer = 0;
        renderBoth('', true);
      }
      stopStream();
      streamBtn.textContent = '暂停流式输出';
      c.timer = window.setInterval(stepStream, 32);
    });
    scrollBtn.addEventListener('click', function () {
      if (c.old) {
        c.old.viewport.scrollTop = 0;
        c.old.following = false;
      }
      if (c.beui) c.beui.viewport.scrollTop = 0;
      paintStats();
    });
    resetBtn.addEventListener('click', mountScenario);
    sceneSel.addEventListener('change', function () {
      c.scenario = sceneSel.value;
      mountScenario();
    });
    viewSeg.addEventListener('click', function (event) {
      var btn = event.target.closest('button[data-value]');
      if (!btn) return;
      ui.codeView = btn.dataset.value;
      arena.dataset.view = ui.codeView;
      Array.prototype.forEach.call(viewSeg.querySelectorAll('button'), function (b) {
        b.classList.toggle('is-on', b === btn);
      });
    });

    return wrap;
  }

  /* ══════════════════════════════════════════════════════════════════════════
   *  section: 替换面地图
   * ══════════════════════════════════════════════════════════════════════════ */

  function buildMap() {
    var wrap = frag();
    var a = card(
      '智能体头像 — 替换面',
      '候选：<a href="https://libraries.dev/bots" target="_blank" rel="noreferrer">libraries.dev/bots</a>，对照 <code>AgentAvatarView.tsx</code> + <code>avatar-gen.ts</code>。'
    );
    a.appendChild(table(['位置', '动作', '说明'], AVATAR_MAP));
    wrap.appendChild(a);

    var b = card(
      '代码块 — 替换面',
      '候选：<a href="https://beui.dev/components/agents/code-block" target="_blank" rel="noreferrer">beui.dev/components/agents/code-block</a>，对照 <code>CodeBlock.tsx</code>。'
    );
    b.appendChild(table(['位置', '动作', '说明'], CODE_MAP));
    var warn = el('div', 'fp-warn');
    warn.innerHTML =
      '<b>最容易踩的坑：</b><code>ExecutionProcessBlock</code>（文件 diff 卡片）、<code>HtmlSandbox</code>、<code>ExcalidrawDraftPreview</code>、<code>DeferredToolContent</code> 四处<b>没有 import CodeBlock</b>，而是各自复用了 <code>.shell-md-code__lang / __actions / __action / __wrap</code>。beUI 的组件用的是 Tailwind utility，<b>不会</b>产出这些类名 —— 换完之后要么保留旧 CSS 让两套视觉语言并存，要么把这四处一起改。';
    b.appendChild(warn);
    wrap.appendChild(b);

    var dep = card('依赖差量', '两个候选加起来要新装的东西。');
    var depWarn = el('div', 'fp-warn');
    depWarn.style.marginTop = '0';
    depWarn.innerHTML =
      '<b>头像（libraries.dev）</b>：零依赖，纯 canvas，无 WebGL。<br /><br />' +
      '<b>代码块（beUI）</b>：<code>motion</code> ✅ 已有（13.2.0）、<code>clsx</code> ✅ 已有、<code>lucide-react</code> ✅ 已有、<code>tailwindcss</code> ✅ 已有（<code>shell.css</code> 第一行就是 <code>@import \'tailwindcss\'</code>）；只有 <code>shiki</code> ❌ 要新装，<code>tailwind-merge</code> 可选。<br /><br />' +
      '<b>两个候选的实现都是原创近似</b>，不是它们的代码或素材 —— 两者都是付费产品，上线前要先买授权再替换实现。<br /><br />' +
      '<b>本页的代码高亮是替身</b>：真实两边分别是 highlight.js 和 shiki，都没法在这个页面里加载，所以共用同一个极简分词器。对比的是表面和机制，引擎替换的成本就是上面这一段。';
    dep.appendChild(depWarn);
    wrap.appendChild(dep);
    return wrap;
  }

  /* ══════════════════════════════════════════════════════════════════════════
   *  section: UI 一致性
   * ══════════════════════════════════════════════════════════════════════════ */

  function buildConsistency() {
    var wrap = frag();

    var root = card(
      '根因：token 层定义了颜色，没定义「控件长什么样」',
      '这不是「有人偷懒」的问题，是<b>词汇缺失</b>。桌面 shell 的 token 几乎全是颜色；决定一个控件外观的尺寸、间距、圆角、字号、动效，<b>shell 侧基本没有词汇</b>，所以每个组件只能自己拍数字。两个组件都「需要一个下拉框」时，它们没有可以达成一致的 token，于是必然长得不一样。',
      true
    );

    var shellTokens = TOKEN_GROUPS.filter(function (g) {
      return g.scope === 'shell';
    }).reduce(function (a, g) {
      return a + g.total;
    }, 0);
    var facts = el('div');
    facts.innerHTML =
      '<ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.9;color:var(--fp-muted)">' +
      '<li>token 总数 <b>291</b>，其中桌面 shell 只有 <b>' + shellTokens + '</b> 个；剩下 60 个是公开网站的 <code>--web-*</code>。</li>' +
      '<li>shell 的非颜色几何词汇一共 <b>11 个</b>：圆角 5（<code>card / row / compose / shell / modal</code>）、布局 1（<code>sidebar-width</code>）、动效 2、字体族 3。</li>' +
      '<li>唯一的<b>间距刻度</b>（<code>space-1…12</code>）、唯一的 <code>control-height: 46px</code>、唯一的 <code>radius: 6px</code>、<code>transition</code>、<code>focus-width</code> —— <b>全部在 <code>--web-*</code> 里</b>，且 <code>utilities:false</code>，桌面 shell 拿不到。</li>' +
      '<li>反过来：<code>--composer-*</code> 一个组件占了 <b>59 个</b> token（31 个尺寸 + 12 个动效），<code>--color-cap-*</code> 一个功能占了 <b>53 个</b>。也就是说：<b>没有全局刻度，但允许单组件自己铸一套</b>。</li>' +
      '<li>结果就是 <code>radius</code> 有 5 个 token，可同屏还能看到 <code>6/7/8/9/10/11/12/14/16px</code> 一堆硬编码圆角。</li>' +
      '</ul>';
    root.appendChild(facts);
    wrap.appendChild(root);

    var tableCard = card(
      'token 分组实况',
      '来自 <code>docs/product/16-shell-design-tokens.json</code>。<code>utilities:true</code> 的分组进 <code>@theme</code>，Tailwind 会据此生成 utility；<code>false</code> 的只落在普通 <code>:root</code>，只能用 <code>var()</code> 手写引用 —— 这也是组件更愿意自己拍数字的原因之一。'
    );
    var rows = TOKEN_GROUPS.map(function (g) {
      var scope = SCOPE_LABEL[g.scope];
      return [
        g.prefix + '\n(' + g.id + ')',
        String(g.total),
        g.size ? String(g.size) : '—',
        g.motion ? String(g.motion) : '—',
        { __verdict: g.scope === 'shell' ? 'keep' : 'loss', html: scope[0] },
        g.means
      ];
    });
    tableCard.appendChild(
      table(['前缀', 'token 数', '尺寸', '动效', '归属', '说明'], rows)
    );
    wrap.appendChild(tableCard);

    var lintCard = card(
      '而且唯一那道闸门，测错了地方',
      '仓库里已经有 <code>scripts/check-design-tokens.mjs</code>（<code>pnpm lint:tokens</code>），报 <b>31 条违规</b>，退出码 1。<b>但把 31 条逐条读完之后：17 条是假警报，14 条是真的，而真实问题它有 94% 看不见。</b>',
      true
    );
    var lintBody = el('div');
    lintBody.innerHTML =
      '<div style="font-family:var(--fp-mono);font-size:11.5px;background:var(--color-hover);border-radius:8px;padding:10px 12px;line-height:1.8">' +
      '17 条 <b>shell.css 全部是注释里的文字</b>被当成代码命中了：<br />' +
      '&nbsp;&nbsp;shell.css:31724-31727&nbsp;&nbsp;/* spec copied from NewMax DsTabBar… --ds-radius-pill --ds-on-surface … */<br />' +
      '&nbsp;&nbsp;shell.css:25081&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;/* 浅色 #ffffff、深色是 #2a2d2b … */<br />' +
      '&nbsp;&nbsp;shell.css:42628&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;/* --ds-turn-review-card-surface / --ds-plan-result-card-surface */<br />' +
      '&nbsp;&nbsp;<i>…脚本不剥离多行注释，所以设计文档式的引用全被当成了违规</i><br /><br />' +
      '14 条 <b>真正的违规全在一个文件</b>：avatar-gen.ts 的 14 个裸 hex —— 而它恰好和 <code>tokens.css</code> 里的 <code>--color-avatar-1..8</code> 重复。' +
      '</div>' +
      '<p class="fp-lead" style="margin-top:12px">更关键的是它的<b>扫描范围</b>：</p>' +
      '<ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.9;color:var(--fp-muted)">' +
      '<li>只读 <code>shell.css</code>，<b>不读 <code>tokens.css</code></b>，也不读任何其它 CSS（<code>collaboration-chat.css</code> 的 46 个裸色全部漏掉）。</li>' +
      '<li>只遍历 <code>shell/</code> 顶层，<b><code>readdirSync</code> 不递归</b> —— 漏掉 <code>shell/theme/</code>（226+84+36 个）、<code>mermaid/</code>（191 个）、<code>visualization/</code>（43 个）、<code>terminal/</code>（28 个）。</li>' +
      '<li><b>完全不看 <code>packages/ui-kit</code></b>。</li>' +
      '<li><b>完全没有 <code>rgb() / rgba() / hsl()</code> 的正则</b> —— 这类写法一条都查不到。</li>' +
      '<li>声明块识别用的是 <code>^\\s*\\.dark…\\{</code>，因此<b>任何 <code>.dark</code> 开头的组件规则里的裸 hex 都会被静默跳过</b>。</li>' +
      '<li>结果：范围内共 <b>647 处裸色字面量，它看见 37 处</b>。</li>' +
      '</ul>' +
      '<p class="fp-lead" style="margin-top:12px">而且它<b>只管颜色</b>：z-index（190 个手挑的值）、弹窗圆角、阴影、间距、字号、动效，一条都不在检查范围内 —— 全是这次真正出问题的地方。</p>';
    lintCard.appendChild(lintBody);
    wrap.appendChild(lintCard);

    var colourCard = card(
      '配色：现在有 ' + '12' + ' 套「颜色真相」',
      '这是「配色逻辑不统一」的完整答案。10 套在运行时同时生效，2 套是死的。'
    );
    var colourRows = [
      ['① tokens.css', 'shell/tokens.css（<code>@theme</code> 122 + <code>.dark</code> 107）', '声明层', '就是它本身'],
      ['② token JSON', 'docs/product/16-shell-design-tokens.json → 生成脚本', '源头', '与 ① 同步（生成关系）'],
      ['③ NewMax 命名主题表', 'shell/theme/newmax-named-themes.ts（<b>226</b> 个字面量）', '9 套命名主题 × 明暗', '<b>直接写了 <code>--color-icon: #6b6b6b</code>，与 ① 的 <code>#7e7f7e</code> 冲突</b>'],
      ['④ NewMax 运行时引擎', 'newmax-theme-engine.ts(84) → apply-newmax-appearance.ts', '生成 <code>--ds-*</code> 再映射到 33 个 <code>--color-*</code>', '<b>写成 <code>&lt;html&gt;</code> 内联样式，优先级压过 ① 和 <code>.dark</code></b>'],
      ['⑤ 图片/壁纸色板', 'shell/theme/newmax-image-palettes.ts（36）', '6 套', '喂给 ④'],
      ['⑥ 偏好引擎内联写入', 'preferences-store.ts:512-560', '33 个 <code>--color-*</code> + 4 个 <code>--shell-*</code>', '与 ① 写同一批自定义属性'],
      ['⑦ Mermaid 主题', 'mermaid/*.ts（191 个）', '一套平行色板', '主题判断读 <code>.dark</code>'],
      ['⑧ 可视化 iframe 色板', 'visualization/ui-kit.ts（43）', '自带约 25 个 <code>--ds-*</code>', '<b>独立注入沙箱文档，键的是 <code>data-theme</code> 不是 <code>.dark</code></b>'],
      ['⑨ 终端 ANSI 色板', 'shell/terminal/xterm-theme.ts（28）', '2 × 12 色', '先读 <code>--color-*</code>，再退 <code>--ds-*</code>，最后退裸 hex'],
      ['⑩ 头像色板（两套）', 'tokens <code>--color-avatar-1..8</code> + avatar-gen.ts 的 10 个固定 hex', '8 + 10', '<b>同一功能两套来源；后者没有暗色版本</b>'],
      ['⑪ ui-kit 字面量', 'AgentWorkspace / Compose / MessageBubble 里的 <code>#64748b</code>', '1 个值 × 6 处', '<b>不在 tokens.css 里，而 ui-kit 自己没有样式表</b>'],
      ['⑫ ui-kit 遗留主题控制器', 'ui-kit/src/theme.ts + AppShell.tsx:162', '0 个颜色', '已声明为死代码']
    ];
    colourCard.appendChild(table(['来源', '位置', '规模', '与 ① 的关系'], colourRows));
    var colourNotes = el('div');
    colourNotes.innerHTML =
      '<ul style="margin:12px 0 0;padding-left:18px;font-size:12px;line-height:1.9;color:var(--fp-muted)">' +
      '<li><b>同一个 token 运行时有两个值</b>：<code>--color-icon</code> 在 <code>tokens.css:45</code> 是 <code>#7e7f7e</code>，在 <code>newmax-named-themes.ts:23</code> 是 <code>#6b6b6b</code> —— 后者赢，因为它是内联样式。</li>' +
      '<li><b>五个主题开关同时活着</b>：<code>.dark</code> class、<code>data-theme</code>、<code>data-color-theme</code>、<code>data-image-theme</code>、<code>data-image-theme-effect</code>，外加 <code>prefers-color-scheme</code>，再加一个已死的 <code>data-st-theme</code>。而可视化 iframe 键的是 <code>data-theme</code>，shell 自己的 CSS 键的是 <code>.dark</code>。</li>' +
      '<li>shell 里另有 <b>5 套 token 命名空间</b>（<code>--cap-*</code> / <code>--color-cap-*</code> / <code>--task-*</code> / <code>--model-*</code> / <code>--composer-*</code>）指向同一套 <code>--color-*</code>。</li>' +
      '</ul>';
    colourCard.appendChild(colourNotes);
    wrap.appendChild(colourCard);

    var overlayCard = card(
      '弹层：没有 <code>&lt;dialog&gt;</code>，z-index 190 个手挑的数字',
      '全仓<b>没有一个原生 <code>&lt;dialog&gt;</code> 元素</b>，19 个手写 <code>role="dialog"</code> 里<b>只有一个做了焦点捕获</b>（<code>DesktopUpdatePanel.tsx</code>），其余都只是写了 <code>aria-modal="true"</code> 而没有真的把焦点关住 —— 全仓搜 <code>inert</code> / <code>focus-trap</code> 均为 0。'
    );
    var overlayNotes = el('div');
    overlayNotes.innerHTML =
      '<ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.9;color:var(--fp-muted)">' +
      '<li><b>z-index：<code>shell.css</code> 里 190 个手挑值、54 个不同数字</b>（1–120，外加 1500/1501、9000/9001、9100/9101、10000/10001、10040/10041、10100、12000、13000、2147483647）。<b>没有任何一套 z-index 刻度</b>。</li>' +
      '<li>已经撞车：<code>12000</code> 同时是图片灯箱、Mermaid 灯箱、图片主题编辑器；<code>50</code> 同时是能力弹窗、库抽屉、浏览器工作流弹窗；<code>91</code> 同时是两个 NewMax 弹窗。</li>' +
      '<li><b>弹窗圆角：token 层定义了 5 个，弹层 CSS 另硬编码了至少 9 个</b>（8/10/12/13/14/16/18/20px 和 999px）。最典型：<code>Dialog.tsx</code> 用 <code>rounded-(--radius-card)</code>，而视觉上几乎一样的 <code>settings-about-dialog</code> 用字面量 <code>14px</code>。</li>' +
      '<li><b>弹窗阴影：12 个手写字面量</b>（<code>0 8px 24px</code> / <code>0 10px 32px</code> / <code>0 18px 54px</code> / <code>0 20px 60px</code> / <code>0 22px 65px</code> / <code>0 24px 64px</code> / <code>0 24px 72px</code> / <code>0 28px 70px</code> / <code>0 28px 78px</code> …）与 3 处使用 <code>var(--color-modal-shadow)</code> 并存。这个 token 存在，但<b>多数弹窗不用它</b>。</li>' +
      '<li>结构性缺口：Escape / 外部点击 / 焦点捕获 / 降低动效，四处弹层四种情况，没有统一契约。</li>' +
      '</ul>';
    overlayCard.appendChild(overlayNotes);
    wrap.appendChild(overlayCard);

    var deadCard = card(
      '还有一套死掉但看起来活着的东西',
      '<code>packages/ui-kit</code> 里有一整套自己的组件（WorkspaceNav / Compose / MessageBubble / 各 Panel…），外加一个 theme 控制器。<b>它的样式表已经删了</b>：'
    );
    var dead = el('div');
    dead.innerHTML =
      '<div style="font-family:var(--fp-mono);font-size:11.5px;background:var(--color-hover);border-radius:8px;padding:10px 12px;line-height:1.8">' +
      'packages/ui-kit/src/theme.ts:1-14<br />' +
      '// DEPRECATED — do not wire anything new to this.<br />' +
      '// …toggles a `data-st-theme` attribute that the deleted<br />' +
      '// packages/ui-kit/src/styles/ stylesheets used to key off. Those<br />' +
      '// stylesheets are gone (2026-08-18 shell switchover), so setting the<br />' +
      '// attribute now changes nothing visually. It survives only because<br />' +
      '// AppShell.tsx still calls applyTheme()…' +
      '</div>' +
      '<p class="fp-lead" style="margin-top:12px">独立核对过：<code>packages/ui-kit/src</code> 下<b>一个 <code>.css</code> 文件都没有</b>，<code>package.json</code> 也没有 styles 入口，全仓搜不到任何 <code>st-*</code> 选择器定义。也就是说 ui-kit 里那些开关、页签、复选框<b>全都是没有样式的</b>，而桌面 shell 也确实一个都没引用（只引了 4 个不含控件的组件和一个类型）。</p>';
    deadCard.appendChild(dead);
    wrap.appendChild(deadCard);

    /* ── per-control-family inventory ─────────────────────────────────────── */

    var intro = card(
      '逐控件清单：同一个控件到底有几个实现',
      '下面两张表来自对 <code>apps/desktop/src/renderer/**</code> 与 <code>packages/ui-kit/src/**</code> 的只读审计。每一行都带 <code>file:line</code> 出处；数字列才是重点 —— 「同一个组件两边视觉不一样」具体差在哪，就是这些数字。',
      true
    );
    wrap.appendChild(intro);

    var switchCard = card(
      '开关 / 复选：' + SWITCH_FAMILIES.length + ' 个实现，干同一件事',
      '其中最刺眼的一组：<code>.settings-about-toggle</code> 的源码注释自己写着它 <b>"deliberately identical to <code>.model-toggle</code>"</b> —— 也就是<b>故意复制了一份</b>，只为了让「模型页」和「关于页」各有一个自己的类名。'
    );
    switchCard.appendChild(
      table(['实现族', '出处', '调用点', '尺寸 / 圆角 / 滑块', '动效', '状态通道', 'ARIA'], SWITCH_FAMILIES)
    );
    var swNotes = el('div');
    swNotes.innerHTML =
      '<ul style="margin:12px 0 0;padding-left:18px;font-size:12px;line-height:1.9;color:var(--fp-muted)">' +
      '<li><b>轨道宽度就有 4 种</b>：28 / 34 / 38 / 44px（44 那个是访客文档的 <code>.viz-switch</code>）。</li>' +
      '<li><b>滑块动效既有 transform 也有 left</b>：只有 <code>.task-editor__switch</code> 动 <code>left</code>。</li>' +
      '<li><b>状态通道有 5 种</b>：<code>is-checked</code> 类、<code>data-state</code>、<code>data-enabled</code>、<code>data-on</code>、<code>data-checked</code>、<code>aria-checked</code> 属性选择器。</li>' +
      '<li><b>同一个页面里两种开关</b>：设置页的连接器启用，一处用 <code>role=switch</code> 的开关（:1392），另一处用文字按钮（:1627）。</li>' +
      '<li><b>同一套 markup 两种 ARIA</b>：<code>role=switch + aria-checked</code>（AbilityCenterPage:2603）与 <code>aria-pressed</code>（AgentLibrary:2436）。</li>' +
      '<li><code>.viz-switch</code> 是<b>坏的</b>：44×24 的框，但没有 <code>:checked</code>、没有滑块、没有轨道底色 —— 作者写完没接上。</li>' +
      '</ul>';
    switchCard.appendChild(swNotes);
    wrap.appendChild(switchCard);

    var tabCard = card(
      '页签 / 分段控件：' + TAB_FAMILIES.length + ' 个实现，' + '其中两个「正式」的还同时用在同一页',
      '同一种「一排互斥选项 + 滑动指示器」，圆角从 <b>5px 到 999px</b>，动效从 <b>0ms 到 250ms</b>，键盘支持有的全有、有的全无。'
    );
    tabCard.appendChild(
      table(['实现族', '出处', '调用点', '几何', '动效', '键盘', 'ARIA'], TAB_FAMILIES)
    );
    var tabNotes = el('div');
    tabNotes.innerHTML =
      '<ul style="margin:12px 0 0;padding-left:18px;font-size:12px;line-height:1.9;color:var(--fp-muted)">' +
      '<li><code>SlidingTabs</code>（250ms）和 <code>DsTabBar</code>（240ms、圆角 64px）是两套「正式」实现，却<b>同时出现在同一个文件</b>（<code>ModelSettings.tsx</code> 的 :2654/:3594 与 :5697）和<b>同一个页面</b>（<code>SettingsPage.tsx</code> 的 :594/:1229 与 :1439）。</li>' +
      '<li><code>SlidingTabs</code> 自己只有 9 行定位逻辑，几何<b>全部由调用点的 CSS 各写一遍</b> —— 这是 6 套几何的来源。</li>' +
      '<li>会话页签（<code>ConversationTabs</code>）是<b>唯一一个连 <code>role="tab"</code> 都没有</b>的，用 <code>div[data-active]</code>。</li>' +
      '</ul>';
    tabCard.appendChild(tabNotes);
    wrap.appendChild(tabCard);

    var hazardCard = card(
      '级联隐患：同一个类名被定义多次',
      '这些不是「变体」，是<b>同一个选择器在不同位置被写了多套数字</b>，最终外观取决于级联顺序 —— 改一处不知道会不会影响另一处。'
    );
    hazardCard.appendChild(table(['选择器', '定义位置', '情况'], CASCADE_HAZARDS));
    wrap.appendChild(hazardCard);

    var selectCard = card(
      '选择框 / 下拉：' + SELECT_FAMILIES.length + ' 个实现族，其中 5 个都在做「选模型」',
      '这是最严重的一族。<b>原生 <code>&lt;select&gt;</code> 就有 22 个</b>（外加 ui-kit 里 16 个死掉的），styled by 12 组互不相关的后代选择器，<b>没有共同基类</b>。'
    );
    selectCard.appendChild(
      table(['实现族', '出处', '调用点', '几何', '焦点 / 行为'], SELECT_FAMILIES)
    );
    var selectNotes = el('div');
    selectNotes.innerHTML =
      '<ul style="margin:12px 0 0;padding-left:18px;font-size:12px;line-height:1.9;color:var(--fp-muted)">' +
      '<li>同屏在用的<b>触发器圆角有 8 种</b>（6/7/8/9/10/11/12/17px），<b>菜单圆角 7 种</b>（7/8/10/11/12/16/18px），<b>高度 10 种</b>（24/28/30/32/33/34/35/36/37/48px），<b>字号 8 种</b>（8.5–13px）。</li>' +
      '<li>菜单阴影有 <b>8 个手写字面量</b>，外加 3 个 token —— 而 <code>--composer-menu-shadow</code> 本身在浅色和深色下还是两套。</li>' +
      '<li><b>两个组件的触发器几何逐字节相同</b>（<code>ModelListSelect</code> 与 <code>ImageApiProviderSelect</code>：高 34 / 圆角 17px / 字号 13px），却没有任何共享代码或类名。</li>' +
      '<li><b>「选模型」有 5 个实现</b>：<code>ModelListSelect</code>、<code>.shell-menu</code> 的模型级联、<code>ImageApiProviderSelect</code>（同构）、<code>.agent-model-select</code>、ui-kit 的 <code>ModelPathPicker</code>。</li>' +
      '<li><b>max-height 有五套策略</b>：固定值（230/250/420/440px）、视口相对（<code>60vh</code>、<code>calc(100vh - 32px)</code>）、Radix 推导、JS 内联计算、以及<b>完全没有</b>。</li>' +
      '<li>CSS 注释自己承认在互相凑：<code>/* Explicitly match the input background so select and input look alike. */</code>、<code>/* Match the readonly-input look used for the name/endpoint fields. */</code></li>' +
      '<li>能力中心那条链<b>被从两个方向各写了一遍</b>：<code>.capability-form-field select</code> 设 padding，<code>.capability-select-wrap select</code> 再改一遍。</li>' +
      '</ul>';
    selectCard.appendChild(selectNotes);
    wrap.appendChild(selectCard);

    var buttonCard = card(
      '按钮：899 个 &lt;button&gt;，7 套「主按钮 + 次级按钮」，4 种样式机制',
      '这是数量最大的一族。<b>同一个「主按钮 + 次级按钮」的活儿有 7 套实现</b>，而且其中两套（浏览器交接卡 / 桌面等待卡）数值几乎一样，只是各自起了一个类名。'
    );
    buttonCard.appendChild(
      table(['实现族', '出处', '用在哪', '关键数值', '备注'], BUTTON_FAMILIES)
    );
    var buttonNotes = el('div');
    buttonNotes.innerHTML =
      '<ul style="margin:12px 0 0;padding-left:18px;font-size:12px;line-height:1.9;color:var(--fp-muted)">' +
      '<li>渲染层共 <b>899 个 <code>&lt;button&gt;</code></b>（92 个文件），ui-kit 另有 <b>129 个</b>。</li>' +
      '<li><b>约 199 个完全没有 <code>className</code></b>，另有 <b>76 个只用 Tailwind 工具类</b>、没有任何可复用的类名 —— 也就是说 <b>约 275 / 899 ≈ 31% 的按钮没有「组件身份」</b>。那 199 个靠祖先选择器活着（<code>.ability-hub button</code>、<code>.newmax-skill-create__menu button</code>…），<b>改一处祖先样式会波及一片按钮</b>，这正是「改一个地方、另一个地方跟着变」的机制。</li>' +
      '<li><b>「主按钮 + 次级 + 危险」被实现了 9 遍</b>。其中 <code>shell-browser-handoff__button</code> 与 <code>shell-desktop-waiting__button</code> 是<b>逐值相同的重复对</b>（高 32 / padding 0 12 / 圆角 8 / 12px / 600），连 CSS 自己在 <code>:5588</code> 都把两者合并了。</li>' +
      '<li>图标按钮三份复制：<code>capability-icon-button</code>（30×30）· <code>agent-icon-button</code>（30×30）· <code>model-enabled-list__header &gt; button</code>（28×28）—— 尺寸几乎一样，<b>唯一区别是各自读不同的 token 命名空间</b>。</li>' +
      '<li><b>禁用态透明度 7 个取值</b>：0.35 / 0.4 / 0.45 / 0.46 / 0.48 / 0.5 / 0.55，还有若干族<b>根本没有禁用样式</b>。</li>' +
      '<li><b>焦点环 5 种互不兼容的写法</b>：<code>outline 2px var(--color-focus-ring)</code>、<code>outline 2px color-mix(accent 65%)</code>、<code>color-mix(accent 64%)</code> + offset 1px、只有 <code>box-shadow</code> 没有 outline、<b>以及完全没有</b>。后者包括 capability-button（在三个容器之外时）、browser-workflow__button、settings-button、settings-gateway-button、agent-icon-button、task-panel__icon-btn、ability-dialog__footer 等十几处。用键盘 Tab 走一遍，高亮样式会变。</li>' +
      '<li><b>同一个概念有 5 套 token 命名空间</b>：<code>--cap-*</code>、<code>--color-cap-*</code>、<code>--task-*</code>、<code>--model-*</code>、<code>--composer-*</code> —— 它们底下都指向同一套 <code>--color-*</code>，但组件各读各的。<b>这就是「配色逻辑不统一」的具体形态。</b></li>' +
      '<li>ui-kit 的 129 个按钮里，113 个引用的类名<b>在仓库里没有任何 CSS 定义</b>。</li>' +
      '</ul>';
    buttonCard.appendChild(buttonNotes);
    wrap.appendChild(buttonCard);

    var inputCard = card(
      '输入框：224 个标签，' + INPUT_FAMILIES.length + ' 个实现族',
      '单独的「一行文本输入」就有 <b>11 种以上实现</b>：<b>8 种高度</b>（31/32/34/35/36px 加浏览器默认）、<b>5 种圆角</b>（7/8/9/10/17px）、<b>6 种焦点写法</b>。'
    );
    inputCard.appendChild(
      table(['实现族', '出处', '调用点', '几何', '焦点', '占位符'], INPUT_FAMILIES)
    );
    var inputNotes = el('div');
    inputNotes.innerHTML =
      '<ul style="margin:12px 0 0;padding-left:18px;font-size:12px;line-height:1.9;color:var(--fp-muted)">' +
      '<li><b>15 个几乎一样的「搜索胶囊」包裹层</b>，内部 input 全都是 <code>border:0;background:transparent</code> —— 差异<b>全在包裹层</b>：4 种 focus 写法（<code>0 0 0 1px</code> / <code>outline 2px</code>+offset / 只变描边 / 描边+3px ring），<b>2 个连 focus 都没有</b>，7 种不同背景 token。</li>' +
      '<li><b><code>ability-hub__search</code> 和 <code>agent-bind-search</code> 各自被定义了两次</b>，数值互相冲突（前者 width/min-height/radius/background 全不同；后者两套高度、两套圆角、两个焦点环）。</li>' +
      '<li><b>Composer 一个控件五种实现</b>：生产用的是 CodeMirror contenteditable，另外还有隐藏兼容 textarea、只给 QA fixture 用的 <code>shell-compose__input</code>、ui-kit 里没样式的 <code>st-compose__input</code>、以及队列编辑框。圆角 20/12/8px，min-height 36/44/62/72px。</li>' +
      '<li><b>全仓没有任何 <code>[aria-invalid]</code> 样式</b> —— 也就是说有地方给输入框加了 <code>aria-invalid</code>，但<b>视觉上什么都不会发生</b>。校验失败在界面上看不出来。</li>' +
      '<li><b>20 个族里有 10 个没有 placeholder 规则</b>；<code>collaboration-chat.css</code> 整份文件<b>没有一条 focus 规则</b>，而且把深色兜底色硬编码进了 <code>var()</code>（<code>var(--color-border,#383838)</code>）。</li>' +
      '</ul>';
    inputCard.appendChild(inputNotes);
    wrap.appendChild(inputCard);

    var a11yCard = card('顺带暴露的可达性缺口', '统一控件的时候这些会一并解决，所以先记下来。');
    var a11yList = el('ul');
    a11yList.style.cssText = 'margin:0;padding-left:18px;font-size:12px;line-height:1.9;color:var(--fp-muted)';
    A11Y_GAPS.forEach(function (text) {
      var li = el('li');
      li.innerHTML = text;
      a11yList.appendChild(li);
    });
    a11yCard.appendChild(a11yList);
    wrap.appendChild(a11yCard);

    /* ── the plan ─────────────────────────────────────────────────────────── */

    var planCard = card(
      '所以修法是：先补刻度，再建 primitive，最后迁调用点',
      '不是引入第三方组件库 —— 那只会增加第三套视觉语言。四个步骤，每一步都能独立验证。',
      true
    );
    var steps = [
      ['① 补刻度', '在 <code>16-shell-design-tokens.json</code> 里给 <b>shell 侧</b>加五组刻度：<code>--space-*</code>（把 website 那套 12 级提上来共用）、<code>--size-control-*</code>（高度档）、<code>--radius-*</code>（补齐 pill / control / input）、<code>--text-*</code>（字号档）、<code>--motion-*</code>（时长 + 缓动，现在全 shell 只有 2 个）。<br /><b>产出</b>：<code>pnpm tokens:css</code>；这一步不动任何组件，零风险。'],
      ['② 修门禁', '<code>check-design-tokens.mjs</code>：剥离多行注释（消掉 17 条假警报）、递归扫描 <code>shell/theme</code>·<code>mermaid</code>·<code>visualization</code>·<code>terminal</code>、纳入 <code>packages/ui-kit</code> 与其余 CSS、补上 <code>rgb()/rgba()/hsl()</code> 正则、修掉「任何 <code>.dark</code> 规则都跳过」的漏洞。<br/><b>然后把尺寸 / 圆角 / 字号 / 动效也纳入检查</b> —— 这才是这次真正的问题所在。<br /><b>产出</b>：一份可信的违规清单（预期会从 31 跳到数百），把它作为基线冻结，只允许下降。'],
      ['③ 建 primitive', '在 <code>renderer/shell/primitives/</code> 下建 <code>Select</code> / <code>Input</code> / <code>Button</code> / <code>Checkbox</code> / <code>Switch</code> / <code>Tabs</code> / <code>Dialog</code> / <code>Menu</code>，<b>只消费第 ① 步的刻度</b>，状态补齐到「hover / active / focus-visible / disabled / loading」五态，键盘与 ARIA 一次做对（直接拿 <code>DsTabBar</code> 的键盘模型和 Radix 的焦点捕获）。<br /><b>产出</b>：一个 <code>primitive</code> 页签，把新控件和现有 13 种开关、9 种页签并排放在真实 shell 里比。'],
      ['④ 迁调用点', '按「调用点少 → 多、风险低 → 高」分批：先 30 个一次性的下拉（收益立竿见影、互不牵连），再 ~70 个 <code>aria-pressed</code> 分组，最后 899 个按钮里那 199 个裸按钮和 76 个 Tailwind 按钮。<br />每批同时删掉对应的重复 CSS 与 <code>packages/ui-kit</code> 里没有引用的死组件。<br /><b>产出</b>：每批一个截图 diff + <code>lint:tokens</code> 数字下降。']
    ];
    steps.forEach(function (pair) {
      var block = el('div');
      block.style.cssText =
        'border-left:2px solid color-mix(in srgb, var(--color-accent) 45%, transparent);padding:0 0 0 14px;margin:0 0 16px';
      var h = el('div');
      h.style.cssText = 'font-size:13px;font-weight:600;margin-bottom:5px';
      h.textContent = pair[0];
      var p = el('div');
      p.style.cssText = 'font-size:12px;line-height:1.85;color:var(--fp-muted)';
      p.innerHTML = pair[1];
      block.appendChild(h);
      block.appendChild(p);
      planCard.appendChild(block);
    });
    var planNote = el('div');
    planNote.className = 'fp-warn';
    planNote.style.marginTop = '4px';
    planNote.innerHTML =
      '<b>第 ① 步和第 ② 步不依赖「统一到哪个基准」这个决定</b>，现在就能开工。第 ③ 步才需要先定基准：<br />' +
      '<b>选项 A（推荐）</b>：以现有最好的两处为蓝本提炼 —— <code>settings-data-button</code>（28px / 圆角 64px pill / 五态齐全 / 焦点环用 <code>--color-focus-ring</code>）和 <code>DsTabBar</code>（唯一有完整键盘、圆角 64px、240ms）。好处是迁移量最小。<br />' +
      '<b>选项 B</b>：重新设计一套刻度再全量迁移。好处是不背历史包袱，代价是几乎每个调用点都要动。';
    planCard.appendChild(planNote);
    wrap.appendChild(planCard);

    return wrap;
  }

  /* ══════════════════════════════════════════════════════════════════════════
   *  shell
   * ══════════════════════════════════════════════════════════════════════════ */

  var SECTIONS = [
    { id: 'consistency', label: 'UI 一致性' },
    { id: 'live', label: '现状 · 真实组件' },
    { id: 'avatars', label: '智能体头像' },
    { id: 'code', label: '代码块' },
    { id: 'map', label: '替换面地图' }
  ];

  var poseTimer = null;

  function clearScope() {
    av.slots.forEach(function (slot) {
      try {
        slot.inst.destroy();
      } catch (error) {
        /* a torn-down avatar must not block the switch */
      }
    });
    av.slots = [];
    av.tickPose = null;
    if (poseTimer) window.clearInterval(poseTimer);
    poseTimer = null;
    if (codeScope.code && codeScope.code.timer) window.clearInterval(codeScope.code.timer);
    codeScope = { code: null };
  }

  function buildSection() {
    if (ui.section === 'consistency') return buildConsistency();
    if (ui.section === 'live') return buildLive();
    if (ui.section === 'avatars') return buildAvatars();
    if (ui.section === 'code') return buildCode();
    return buildMap();
  }

  function render() {
    document.documentElement.classList.toggle('dark', ui.theme === 'dark');
    document.documentElement.classList.toggle('light', ui.theme !== 'dark');

    nav.textContent = '';
    var brand = el('div', 'fp-brand');
    brand.appendChild(el('i'));
    brand.appendChild(el('span', null, 'SYNC-THINK'));
    nav.appendChild(brand);
    SECTIONS.forEach(function (s) {
      var b = el('button', 'fp-navbtn' + (ui.section === s.id ? ' is-on' : ''), s.label);
      b.type = 'button';
      b.dataset.section = s.id;
      b.addEventListener('click', function () {
        if (ui.section === s.id) return;
        ui.section = s.id;
        render();
      });
      nav.appendChild(b);
    });
    var foot = el('div', 'fp-navfoot');
    foot.innerHTML =
      '真实组件来自 <code>build:shell:qa</code>；<br />本页样式用的是应用自己的 <code>shell.css</code> 和 <code>--color-*</code> token。';
    nav.appendChild(foot);

    top.textContent = '';
    var head = el('div');
    head.appendChild(el('h1', null, '前端替换预演'));
    head.appendChild(
      el('p', null, '第三方组件接进 SYNC-THINK 会替换掉哪里、会丢什么。真实 UI 一律取应用自己的构建，不在这里重画。')
    );
    top.appendChild(head);
    var right = el('div', 'fp-right');
    var themeBtn = el('button', 'fp-btn', ui.theme === 'dark' ? '切换浅色' : '切换深色');
    themeBtn.type = 'button';
    themeBtn.addEventListener('click', function () {
      ui.theme = ui.theme === 'dark' ? 'light' : 'dark';
      render();
    });
    right.appendChild(themeBtn);
    top.appendChild(right);

    clearScope();
    body.textContent = '';
    body.appendChild(buildSection());
    var nodes = body.querySelectorAll('.av[data-av]');
    for (var i = 0; i < nodes.length; i += 1) mountAvatar(nodes[i], av);
    renderAllAvatars(av);
    if (ui.section === 'avatars' && av.tickPose) {
      poseTimer = window.setInterval(av.tickPose, 120);
    }
    if (ui.section === 'code' && codeScope.code) codeScope.code.mountScenario();
  }

  render();

  window.__FP__ = {
    get section() {
      return ui.section;
    },
    setSection: function (id) {
      ui.section = id;
      render();
    },
    get theme() {
      return ui.theme;
    },
    setTheme: function (t) {
      ui.theme = t;
      render();
    },
    get liveCase() {
      return ui.liveCase;
    },
    setLiveCase: function (id) {
      ui.liveCase = id;
      render();
    },
    get av() {
      return av;
    },
    get codeScope() {
      return codeScope;
    },
    scenarios: SCENARIOS,
    realCases: REAL_CASES,
    render: render
  };
})();
