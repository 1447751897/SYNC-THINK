# 侧栏多工作区会话导航

日期：2026-09-30

## 确认的问题

- 主聊天窗格同时渲染顶部会话标签与左侧会话树，出现重复选择入口。
- Shell 原先只向 Sidebar 提供当前工作区的会话；非当前工作区只是切换按钮。全局 recentOpen 也未记录每个工作区的展开状态。
- 原有分组读写绑定当前工作区，直接扩展侧栏展示会造成分组操作作用域错误。

## 行为约定

1. 主聊天不再显示顶部会话标签；保留面包屑以及文件、终端、浏览器、审查资源标签。侧栏负责常规会话切换。
2. 各工作区的会话、分组、归档按归属 ID 组织，可同时展开；展开/折叠不切换当前聊天。
3. 点击会话时先切换其所属工作区，再激活该会话，沿用工作区窗格布局和工作台路由。未发送草稿走本地激活路径，不访问运行时查询。
4. 点击某工作区的加号在该工作区创建本地草稿，首次发送时才保存真实会话。
5. 分组创建、重命名、折叠、删除和移动均写入归属工作区；批量选择保持当前工作区作用域。
6. 展开状态以 workspace ID 写入 localStorage 键 sync-think.sidebar.workspace-expansion.v1。已有显式折叠状态保留；新出现的当前工作区默认展开。归档自身的展开状态暂为当前侧栏实例内状态。
7. 隐藏工作区沿用现有隐藏规则；智能体/群聊会话继续留在智能体空间。
8. 分屏和高级窗格会话管理保留；管理器按需加载，不增加首屏资源预算。关闭窗格会话与删除历史是两种独立操作。

## 代码落点

- apps/desktop/src/renderer/shell/ShellApp.tsx：全工作区会话目录、作用域分组回调、跨工作区导航与本地草稿路由。
- apps/desktop/src/renderer/shell/Sidebar.tsx：独立工作区树、作用域回调和活动提示。
- apps/desktop/src/renderer/shell/sidebar-workspace-expansion.ts：展开状态容错读写。
- apps/desktop/src/renderer/shell/ConversationTabs.tsx：隐藏主聊天会话标签，保留资源与分屏动作。
- apps/desktop/src/renderer/shell/PaneConversationManager.tsx：按需加载的高级会话管理。
- apps/desktop/src/renderer/shell/board-chat.css：新工作区树包装结构的缩进与标题样式。

## 验收

- 同时展开 A/B，收起 A 时 B 保持展开；展开不改变面包屑和当前会话。
- 点击 B 会话，工作区、面包屑和会话归属一致；返回 A 后既有会话和工作台保持。
- B 的分组/归档不会混入 A，操作 B 分组不覆盖 A 数据。
- 重挂载后每个工作区的展开状态保持；存储损坏或不可用时侧栏仍能工作。
- 未发送草稿可以从侧栏切回；移出窗格不删除会话；资源标签与会话分屏拖放仍正常。

QA 隔离夹具：WorkbenchVisualFixture 的 navigation=workspaces 参数，仅使用内存数据，不修改用户工作区。验证截图与测试报告保存在 .data/sidebar-workspace-navigation。
