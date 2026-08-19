# Project Structure

更新时间：2026-08-05

本文档提供当前仓库的模块地图与文件放置规则。产品边界以已批准设计文档为准，技术取舍以 `04-tech-decisions.md` 为准。

## 1. 仓库地图

```text
SYNC-THINK/
|- apps/
|  |- desktop/          Electron Main / Preload / React Renderer
|  `- runtime/          独立 Node.js Agent Runtime 与命名管道服务
|- packages/
|  |- adapters/         Provider 协议适配器
|  |- core/             上下文、模型解析与领域规则
|  |- protocol/         Desktop/CLI 与 Runtime 的共享命令和事件合同
|  |- secure-store/     OS-backed 凭证存储
|  |- shared/           跨包类型与纯工具
|  |- storage/          SQLite schema、迁移和各领域 store
|  |- test-fixtures/    合同与集成测试夹具
|  |- ui-kit/           遗留 React 组件（仅剩 type-only 引用，样式已删）
|  `- workers/          File/Terminal/Git/Browser/Desktop/MCP 隔离执行边界
|- scripts/             本地启动、自检、构建辅助和诊断脚本
`- docs/                产品、工程、开发、运维与交接真源
```

`apps/cli` 与 `apps/mcp-server` 当前只有历史构建输出/本地依赖，不在根 pnpm workspace 的 11 个活动包中；新源码不要放入这些目录，除非先恢复其正式 package 边界。

## 2. Desktop 边界

| 层                | 关键入口                                                                                                               | 职责                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Main              | `apps/desktop/src/main/index.ts`                                                                                       | BrowserWindow、Runtime supervisor、IPC 校验、sender 生命周期和本机文件/进程能力编排                                   |
| Main services     | `project-content-search.ts`、`project-file-editor.ts`、`project-terminal.ts`、`project-terminal-registry.ts`           | 搜索、文件读写/监听、命令解析/cwd 校验、终端会话唯一性                                                                |
| Updater/recovery  | `desktop-updater.ts`、`electron-updater-driver.ts`、`desktop-update-recovery-store.ts`、`desktop-update-rollback-*.ts` | Main-only feed 控制、bounded failure evidence、healthy installer 登记、rollback intent/health/outcome 与独立 watchdog |
| Preload           | `apps/desktop/src/preload/index.ts`                                                                                    | 在 sandbox/contextIsolation 下暴露最小 typed bridge，转发 terminal 事件并返回 disposer                                |
| IPC contract      | `apps/desktop/src/workspace-tools-contract.ts`、`browser-workflow-payloads.ts`、`renderer/global.d.ts`                 | Renderer 可见 payload/result/event 类型；Browser Workflow 变更需额外严格校验，不得暴露 Node 或 secret                 |
| Renderer shell    | `apps/desktop/src/renderer/shell/ShellApp.tsx`                                                                         | 顶层目录、Workspace/会话状态、Pane 快照提交和各页面装配                                                               |
| Pane model        | `pane-layout.ts`、`WorkspacePaneHost.tsx`、`ConversationTabs.tsx`                                                      | 递归布局、焦点、Tab 资源、恢复/迁移和最多两路 ChatView 挂载                                                           |
| Resource views    | `ChatView.tsx`、`FilePane.tsx`、`TerminalPane.tsx`                                                                     | 对话、文件编辑、终端三类 Pane 内容；临时状态留在 Renderer                                                             |
| Compose Skill     | `TurnSkillControl.tsx`、`compose-skill-selection.ts`、`compose-toolbar.tsx`                                            | 解析 Agent/Team 有效 owner、懒取 metadata、维护当前会话临时选择和稳定菜单表达                                         |
| Terminal renderer | `terminal-session-store.ts`、`xterm-vendor-loader.ts`、`xterm-vendor.ts`                                               | 会话事件归并、命令竞态处理和 xterm 按需加载/主题同步                                                                  |
| File dock         | `RightDock.tsx`                                                                                                        | 文件树、文件名搜索、内容搜索和命中打开/定位                                                                           |

Main 或 Preload 发生变化后必须完整重启 Electron；只刷新 Renderer 不会注册新的 IPC handler，也不会替换旧 preload。

## 3. Runtime 与共享包

- `apps/runtime` 是独立生命周期的真 Agent Runtime：命名管道、持久事件/检查点、Provider 调用、计划/DAG、审批、恢复和工具循环都在这里。
- `packages/storage` 是 SQLite 真源访问层；durable 消息、事件、Agent/Skill/Policy/Artifact 等进入对应 store，不从 Renderer localStorage 反推。
- `packages/protocol` 只放跨进程稳定合同与校验；仅 Renderer 使用的 Electron IPC 类型放在 Desktop contract，避免把 Electron 能力扩散到 Runtime 协议。
- `packages/protocol/src/skill-selection.ts` 规范化每轮 SkillVersion ID；`packages/core/src/run-skill-selection.ts` 负责 allowlist 子集、归档和审批规则，保持无 I/O、可单测。
- `packages/storage` 的 Skill list 查询只投影 metadata；完整正文只由 Runtime 通过精确 SkillVersion ID 读取，不进入 Renderer 目录响应。
- `packages/workers` 负责最小权限执行。`terminal/terminal-worker.ts` 定义命令能力与输出上限，`process-runner.ts` 负责 spawn、流式读取、超时/取消和进程树清理。
- `packages/workers/src/browser/browser-host.ts` 负责系统浏览器发现/启动、CDP、Profile Session、Page lease、同 Page 队列、Profile 站点数据查询/清除与具体 Playwright 动作；浏览器候选顺序为显式 executable、Chrome、Edge；registrable domain 由 `tldts` Public Suffix List 解析，Storage 操作固定走 Page target CDP，不读取 `storageState()`；`browser-worker.ts` 只把 capability token、路径与事件合同接到共享 Host。
- `apps/runtime/src/browser/runtime-browser-controller.ts` 把聊天 `browser_*` 参数映射为 Worker action，使用 `SqliteBrowserStore` 持久化 origin grant、command 与人工 handoff，并保证 Runtime 的脱敏意图先于 Worker 副作用；Page lease 与浏览器进程仍由 `BrowserHost` 管理。
- `packages/core` 保持无 I/O 的领域规则；`packages/adapters` 隔离 Provider 差异；`packages/ui-kit` 自 2026-08-18 起只剩旧渲染层遗留组件，Desktop 侧仅有 type-only 引用，不再提供样式或主题控制器。
- 颜色/字体/圆角 token 的唯一真源是 `docs/product/16-shell-design-tokens.json`；`pnpm tokens:css`（`scripts/generate-shell-tokens.mjs`）生成 `apps/desktop/src/renderer/shell/tokens.css`，由 `shell.css` `@import`。生成物禁止手改；`scripts/check-design-tokens.mjs` 拦裸 hex。

## 4. Workspace 工具调用链

### 内容搜索

```text
RightDock
  -> preload searchProjectContent
  -> Main IPC payload/sender 校验
  -> project-content-search (`rg --json` 或 Node fallback)
  -> 相对路径 + 行/列 + preview
  -> ShellApp 在焦点 Pane 打开 FilePane，并传 transient location
```

### 文件编辑

```text
FilePane
  -> preload read/write/watchProjectFile
  -> Main project-file-editor
  -> realpath 边界 + mtime/size 乐观并发 + 同目录临时文件 rename
  -> watch 事件返回 Renderer
  -> 干净文件刷新；脏文件显示显式冲突选择
```

### 终端 Pane

```text
TerminalPane / terminal-session-store
  -> preload start/cancelProjectTerminal
  -> Main ProjectTerminalRegistry 预留 senderId + terminalId
  -> parse command / 校验项目内 cwd
  -> TerminalProcessWorker -> process-runner -> child process
  -> stdout/stderr/completed/cancelled/failed IPC event
  -> session store 按 command identity 更新 xterm 与状态
```

### 每轮 Skill 选择

```text
TurnSkillControl 打开菜单
  -> 根据 Agent 或 Team coordinator 解析有效装备 ID
  -> preload/runtime skill.list({ skillVersionIds }) 精确查询，只返回 metadata
  -> task.appendMessage(skillVersionIds: 精确 ID[])
  -> Runtime 规范化并校验 allowlist/存在/归档/审批
  -> 按精确 ID 加载正文并进入 Context selection
  -> 同一 included 集合生成 Provider prompt、Manifest 与 frozen Run snapshot
  -> fallback/rebind/retry/restart 按冻结 ID 恢复

自动 Team Run
  -> 每个 Step 已冻结自身 agentVersionId
  -> Runtime 读取该 AgentVersion.skillVersionIds
  -> Provider 调用前校验存在/归档/审批并解析正文
  -> 只注入该成员自己的 Skill，Artifact metadata 记录实际 ID
```

### 浏览器 Worker（P0）

```text
Provider browser_* tool call
  -> RuntimeBrowserController 参数校验 + durable owner/origin grant
  -> Runtime 先持久化脱敏 browser.command.started
  -> PersistentBrowserWorker capability/fence/path 校验
  -> shared BrowserHost
  -> one Profile process / one owner Page lease / per-Page serial queue
  -> playwright-core connectOverCDP
  -> visible system Edge/Chrome
  -> 完整结果回当前 Provider；脱敏摘要进入 durable tool.completed
  -> browser_open 的脱敏 URL 供 Renderer 结果与审计展示
```

Renderer 的 `browser.command_requested -> submitBrowserResult` 仅为旧 Runtime 迁移兼容；新 Runtime 不发布该请求。Profile 的 Cookie 与站点存储正文位于 Runtime 数据目录 `browser-profiles/<profileId>`，不进入 Renderer、SQLite 或默认系统浏览器 Profile；SQLite 只保存 Profile 元数据和脱敏站点会话摘要。

Browser Automation Studio 的 Profile 管理链路：

```text
BrowserStage
  -> preload/Main 严格 IPC payload
  -> Runtime browser.profile.*
  -> RuntimeBrowserProfileService
  -> SqliteBrowserStore（Profile 元数据 + 脱敏站点摘要 + 已知 origin + 非终态 command/handoff fence）
  -> BrowserHost / Playwright BrowserContext / loopback CDP
  -> runtimeDataRoot/browser-profiles/<profileId>（Cookie 与站点存储真源）
```

`apps/runtime/src/browser/runtime-browser-profile-service.ts` 只管理 Profile 元数据、会话投影和删除栅栏；页面自动化命令继续由 `runtime-browser-controller.ts` 管理。`packages/workers/src/browser/browser-host.ts` 提供不返回秘密值的站点数据查询/清理原语，并把 Profile 查询、恢复、清除、删除与 Lease admission 串行化。Renderer 不读取 Profile 目录、不直接调用 Electron session Cookie API，也不再把 BrowserStage `<webview>` partition 当作 Profile 真源。

Browser Automation Studio 的录制链路：

```text
BrowserStage 录制视图
  -> preload/Main browser.recording.{list,get,start,stop}
  -> RuntimeBrowserRecordingService
  -> SqliteBrowserStore（recording intent、状态机、最多 200 条脱敏步骤）
  -> BrowserHost recording Profile claim + exact Page lease
  -> Playwright 主 Frame DOM 语义事件
  -> append/replace-last 串行写入与 Renderer 800 ms 快照轮询
  -> stop/page-close/runtime-restart 终态 -> 关闭 exact Page -> 释放 lease
```

`packages/shared/src/types/browser-recording.ts` 是状态、步骤和上限合同；迁移 `0037_browser_recording` 是 durable 真源。`apps/runtime/src/browser/runtime-browser-recording-service.ts` 负责 intent-before-side-effect、停止幂等、mutation 排空和冷启动 `interrupted` 恢复；`packages/workers/src/browser/browser-host.ts` 负责单 Page 主 Frame 捕获、稳定定位器候选、URL/敏感值脱敏、随机 capture token 与 Profile 独占。P1.2 不创建 WorkflowVersion，也不执行录制步骤。

Browser Automation Studio 的任务与审核链路：

```text
BrowserWorkflowPanel / BrowserStage Draft recording context
  -> Desktop browser-workflow-payloads strict validation
  -> Runtime browser.workflow.{list,get,createDraft,submit,review}
  -> RuntimeBrowserWorkflowService
  -> SqliteBrowserStore
       browser_automation_task
       browser_workflow_draft
       browser_workflow_review
       immutable browser_workflow_version
```

对话工具 `browser_workflow_list/get/create_draft` 复用同一 Runtime service；模型只能查询或创建 `source=ai` 的 Draft。Renderer 的“批准并发布”是唯一发布入口，execution mode 不替代 Review。迁移 `0038_browser_automation_workflow` 和 SQLite update/delete trigger 是 WorkflowVersion 的不可变真源；确定性执行器尚未接入。

### Windows 更新与自动 rollback

```text
Settings/About updater action
  -> trusted Renderer IPC
  -> DesktopUpdateController action/phase fence
  -> electron-updater Main-only HTTPS/Bearer driver
  -> beforeInstall: DesktopUpdateRollbackCoordinator.prepareInstall
  -> verify previous healthy installer + write durable intent
  -> detached PowerShell watchdog
  -> shutdownDesktopServices -> quitAndInstall
  -> target managed Runtime hello -> matching health marker
  -> healthy outcome，或 deadline 后 one-shot previous installer rollback
```

NSIS `apps/desktop/build/installer.nsh` 负责把每个已安装版本的 installer 原子归档到 `%LOCALAPPDATA%\sync-think-updater\recovery\installers\<version>`。`scripts/windows-portable-release.mjs`、`windows-installer-release.mjs`、`windows-generic-update-feed.mjs` 及对应 selftest 负责构建与离线验证；发布脚本不得接触 Renderer secret 或真实 userData。

## 5. 数据与恢复边界

| 数据                                                      | 真源/生命周期                                                                                                                     |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 任务、消息、Run、Step、Agent/Skill/Policy、Artifact、审计 | Runtime + SQLite durable store                                                                                                    |
| 已启动 Run 的 Skill 选择                                  | durable event/checkpoint 保存精确 ID + fingerprint；正文继续以不可变 SkillVersion 为真源                                          |
| Workspace Pane 树、比例、焦点、资源 Tab、terminal cwd     | 版本化 Renderer UI preference                                                                                                     |
| 当前会话的 Skill 临时选择                                 | 当前 `ChatView`/欢迎页 Renderer state；成功或失败后保持，切换有效 Agent/Team owner 时恢复新默认，模型直聊为 `[]`；不写入布局偏好  |
| 文件磁盘正文                                              | 项目目录；保存时以 mtime/size 做并发校验                                                                                          |
| 未保存文件草稿                                            | 当前 Renderer Session，按 workspaceId + path 隔离                                                                                 |
| terminal 输出、历史、运行态、命令输入                     | 当前 Renderer Session                                                                                                             |
| terminal 子进程                                           | Main/Worker 当前生命周期；Renderer 销毁和应用退出时 abort                                                                         |
| 浏览器 Profile/Cookie                                     | Runtime 数据目录中的专用系统浏览器 Profile；SQLite 只保存 Profile 元数据与脱敏站点摘要，不保存 Cookie/Token/存储正文              |
| Browser origin grant、command 与人工 handoff              | SQLite durable store；重启后按 revision/ownership fence 恢复，不重放未知副作用                                                    |
| Browser Session/Page lease                                | 当前 Runtime/BrowserHost 生命周期；durable handoff 只保存恢复所需的有界 lease checkpoint，继续前重新验证 ownership                |
| Browser recording                                         | SQLite durable intent、终态与脱敏语义步骤；活动捕获、Page 与 lease 只在 Runtime/BrowserHost 生命周期中存在                        |
| Browser Automation Task/Draft/Review/WorkflowVersion      | SQLite durable store；Draft 可返工，Review 追加记录，已发布 WorkflowVersion 由 trigger 保证不可更新/删除                          |
| 生成图片正文                                              | Runtime 受控 GeneratedImageStore；SQLite/Renderer 只保存 contentRef/hash 和 opaque preview 投影                                   |
| Updater failure evidence                                  | `<userData>/diagnostics/desktop-updater-recovery.json`，最多 20 条脱敏记录                                                        |
| Automatic rollback                                        | `%LOCALAPPDATA%\sync-think-updater\recovery` 下的 installer、healthy release、intent、health、attempt 与 outcome；不进入 Renderer |

布局偏好不得存储文件正文、terminal 输出、流式帧、错误态、会话级临时 Skill 选择或旧进程“仍在运行”的声明。Run event/checkpoint 也不得复制完整 `SKILL.md` 正文。

## 6. 文件放置规则

1. 新 Electron OS 能力：Main service + Main IPC 校验 + Preload bridge + Renderer type，不能只在 Renderer 实现。
2. 新 Runtime 命令/事件：先放 `packages/protocol` 合同与校验，再接 Runtime handler 和 Desktop client。
3. 新可恢复业务状态：进入 `packages/storage` 和 Runtime 投影；localStorage 只用于版本化 UI preference。
4. 新 Pane 资源：先扩展 `pane-layout.ts` 的资源联合类型/解析/上限，再实现 view 和 Tab 表达，并写迁移/恢复测试。
5. 新本地执行能力：进入 `packages/workers`，显式声明 capability、路径/参数边界、超时、取消和输出上限。
6. 重型 Renderer 依赖：独立 bundle 并按需加载；进入首屏前必须记录性能与回滚决策。
7. 行为变化同步更新 changelog/current status；架构或依赖变化同步更新 tech decisions 与本页。
8. 新的每轮上下文附件必须先定义 `undefined`/空/非空语义、Runtime 权威校验、冻结与恢复边界；Renderer 目录默认只取 metadata。
9. Windows 发布能力进入 `scripts/windows-*.mjs` 与 `apps/desktop/build`，必须区分正式 fail-closed 模式和显式 unsigned fixture，并让聚合 selftest 自包含准备步骤。
