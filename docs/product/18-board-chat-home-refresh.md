# 主页聊天：BoardUI AI Chat 风格改造

日期：2026-09-30

## 参考与现状审阅

- 参考公开预览：BoardUI AI Chat（components/ai-chat，templates/ai-chat）。公开页标注 Pro；本轮基于可见布局独立实现，不拉取收费模板源码。
- 实际基线：WorkbenchVisualFixture 挂载真实 ShellApp；1440×900 下审阅首页，而非 demo 的手绘外壳。
- 已有视觉：白色外底、浅灰面板、蓝色强调、24px 面板圆角、260px 可调整侧栏；支持深色、命名/自定义/壁纸主题。
- 已有结构：工作区顶部标签、会话标签、两列导航、居中高输入框；真实消息、模型/内核、审批、队列、目标/计划、文件/终端/浏览器工作台。
- 保留：品牌、中文导航、智能体独立工作区及其管理规则；会话分组/归档/置顶、菜单、用户保存的布局与主题、全部运行逻辑。
- 调整：主聊天顶部改成面包屑并归入聊天列；侧栏按工作区展开最近会话；输入框采用紧凑胶囊和外置状态栏；消息更轻，右侧工作台与聊天列顶部对齐。
- 方向：开发协作产品的低干扰桌面工作区；视觉变化 4、动效 2、密度 4。避免无意义的动效与空功能按钮。SEO 不适用于本地桌面入口。

## 实现与验收

### 已实现

1. **主页与聊天列**：浅灰圆角工作区、项目/会话面包屑、轻量用户气泡和助手正文；空会话保留真实场景选择与提示，输入固定在底部。
2. **左侧导航**：工作区树替代顶部工作区标签层；活动工作区展开真实最近会话，隐藏工作区按原规则排除；分组、归档、置顶、菜单和运行/未读标记保留。浅/深色按钮更新现有持久化外观设置。
3. **输入区**：Frame 新增可选 pill 呈现；单行高度52px，消息自然多行扩高。模型/语音/发送在胶囊内，Git/权限/Skill/对象/内核/上下文在外置状态栏。空消息发送禁用，运行中的停止及有内容时排队发送保留。
4. **审批与模式**：主聊天的审批卡、计划/目标横条与输入区分离，避开旧高输入框的负边距叠层；保留审批和方案交互。
5. **工作台**：聊天与右侧顶栏对齐，更改/浏览器/终端入口复用既有资源标签；不放伪分享按钮、不强制展开、不覆盖用户保存的尺寸和布局。
6. **响应式**：窗口断点加输入容器断点；聊天列<=520px时输入与模型/发送分行。放大后回到单行胶囊。
7. **加载成本**：工作区表单、首页提示按需加载；保留既有包体预算，没有新增依赖或拉取收费模板。

### 模块与边界

| 模块 | 改动 |
| --- | --- |
| ShellApp.tsx / ChatView.tsx | 真实页面结构、标题、输入区插槽；原执行回调保留 |
| Sidebar.tsx / TopBar.tsx | 工作区树、面包屑、主题按钮、工作区操作 |
| ConversationTabs.tsx | 单会话精简页头，多标签/拆分原能力保留 |
| WorkspaceWorkbench.tsx | 右侧快捷视图、标签复用、保存的布局保留 |
| compose-toolbar.tsx | 成对语音/发送；上下文百分比使用原用量来源 |
| packages/ui-kit/.../NewMaxComposerFrame.tsx | 可选presentation/leadingAction/statusBar；默认布局保持 |
| board-chat.css / shell.css | 主工作区限定样式、审批避让、宽度响应 |
| WorkspaceFormDialog.tsx | 原表单拆成延迟模块，校验/API未改 |
| WorkbenchVisualFixture.tsx | 仅QA补齐确定性Git/工作副本返回 |

本轮未修改智能体自主创建约束、小队/群聊调度、已读数据和运行时接口。智能体独立工作区保持 Frame 默认呈现，不受新样式影响。

### 构建与自动化验证（2026-09-30）

- `pnpm --filter @sync-think/ui-kit build`：通过。
- `pnpm --filter @sync-think/desktop typecheck`：通过。
- `pnpm --filter @sync-think/desktop build`：通过，包含主进程/预加载/生产renderer。
- 最后样式修正后再次运行 `build:shell` 和 `build:shell:qa`：通过。
- 生产初始JS **2,239,321 bytes**，预算 **2,240,000 bytes**；总JS **3,464,046 bytes**。QA单独构建，不进入应用初始加载。
- 主聊天10文件回归：**129/129通过**（当时CSS契约4项）；新增审批避让后4文件再测 **18/18通过**；最终Sidebar/CSS再测 **18/18通过**（CSS契约5项）。
- 智能体独立工作区/协作聊天/展示回归：5文件 **65/65通过**。
- ui-kit全套：24文件 **247/247通过**，包括Frame默认布局和模式切换。
- ShellApp完整测试：**93通过，1失败，共94项**。失败为 `opens the Plan and MCP destinations requested by the conversation composer`；改造前ShellApp源码的临时基线同样复现，未计作通过。证据：`.data/board-chat-preview/baseline-settings-test.json`、`shell-tests-final.json`。
- 修改模块ESLint **0 errors**；ShellApp/ChatView原有hooks区域 **21 warnings**。完整工作区 `git diff --check`通过，仅已有CRLF提示。
- 架构门禁仍报告三个既有循环：AgentAvatarView/AgentWorkspaceAvatar、ModelPickerPanel/compose-toolbar、ToolApprovalCard/tool-approval-presentation。本轮不扩展这些循环，不宣称全仓全绿。

### 真实页面验收

使用CUA操作已构建的真实ShellApp+内存QARuntime，而非静态HTML。未发真实模型请求、触发麦克风权限、提交Git或更改/删除真实用户资料。

- **19项可见行为/几何检查通过**：模型面板、附件/模式菜单、面包屑、Git/浏览器面板入口及复用、主题、工作区切换与隔离、编辑表单、设置、单行/多行输入、三栏对齐、审批不遮挡等。
- 1440×900：单行胶囊52px、审批间隔8px，亮/暗主题三栏代码面板。
- 960×800：三栏共存；输入与动作分行，无窗口横向溢出。
- 768×800：收起侧栏后聊天可用；多行输入扩高94px，发送可用，语音入口保留。
- 验收中修正：旧72px编辑器最小高度、精简页头父级裁剪、审批负边距、窄列工具挤压、新建对话图标占宽。
- 额外观察待独立确认：关闭空草稿标签后仍残留，切换工作区后消失；本轮未修改原关闭处理函数，不把此路径写成通过。

证据目录 `.data/board-chat-preview/`：`light-home.png`、`light-chat-workbench.png`、`dark-chat-workbench.png`、`narrow-chat-workbench.png`、`narrow-multiline.png`、`visual-validation.json`及测试日志。临时基线源文件已移除；基线结果/改造前源码保留在忽略的data目录。

### 查看与验收边界

- 预览 `http://127.0.0.1:4173/qa/index.html?phase3-visual=workbench`，数据为隔离样例，可操作会话、主题和工作台。
- 正式产物在 `apps/desktop/dist/renderer-shell`；本轮没有强制重启用户正在运行的桌面/后端进程。
- 按公开视觉独立实现，不是收费模板源码逐字复制；保留品牌、中文产品内容与审批/执行能力。
- 真实模型、桌面麦克风和跨进程推送未用QA页面作端到端通过声明。
