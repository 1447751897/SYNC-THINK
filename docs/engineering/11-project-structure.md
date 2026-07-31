# Project Structure

更新时间：2026-07-30

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
|  |- ui-kit/           共享 React 组件与样式生成
|  `- workers/          File/Terminal/Git/Browser/Desktop/MCP 隔离执行边界
|- scripts/             本地启动、自检、构建辅助和诊断脚本
`- docs/                产品、工程、开发、运维与交接真源
```

`apps/cli` 与 `apps/mcp-server` 当前只有历史构建输出/本地依赖，不在根 pnpm workspace 的 11 个活动包中；新源码不要放入这些目录，除非先恢复其正式 package 边界。

## 2. Desktop 边界

| 层 | 关键入口 | 职责 |
| --- | --- | --- |
| Main | `apps/desktop/src/main/index.ts` | BrowserWindow、Runtime supervisor、IPC 校验、sender 生命周期和本机文件/进程能力编排 |
| Main services | `project-content-search.ts`、`project-file-editor.ts`、`project-terminal.ts`、`project-terminal-registry.ts` | 搜索、文件读写/监听、命令解析/cwd 校验、终端会话唯一性 |
| Preload | `apps/desktop/src/preload/index.ts` | 在 sandbox/contextIsolation 下暴露最小 typed bridge，转发 terminal 事件并返回 disposer |
| IPC contract | `apps/desktop/src/workspace-tools-contract.ts`、`renderer/global.d.ts` | Renderer 可见 payload/result/event 类型；不得暴露 Node 或 secret |
| Renderer shell | `apps/desktop/src/renderer/shell/ShellApp.tsx` | 顶层目录、Workspace/会话状态、Pane 快照提交和各页面装配 |
| Pane model | `pane-layout.ts`、`WorkspacePaneHost.tsx`、`ConversationTabs.tsx` | 递归布局、焦点、Tab 资源、恢复/迁移和最多两路 ChatView 挂载 |
| Resource views | `ChatView.tsx`、`FilePane.tsx`、`TerminalPane.tsx` | 对话、文件编辑、终端三类 Pane 内容；临时状态留在 Renderer |
| Compose Skill | `TurnSkillControl.tsx`、`compose-skill-selection.ts`、`compose-toolbar.tsx` | 解析 Agent/Team 有效 owner、懒取 metadata、维护当前会话临时选择和稳定菜单表达 |
| Terminal renderer | `terminal-session-store.ts`、`xterm-vendor-loader.ts`、`xterm-vendor.ts` | 会话事件归并、命令竞态处理和 xterm 按需加载/主题同步 |
| File dock | `RightDock.tsx` | 文件树、文件名搜索、内容搜索和命中打开/定位 |

Main 或 Preload 发生变化后必须完整重启 Electron；只刷新 Renderer 不会注册新的 IPC handler，也不会替换旧 preload。

## 3. Runtime 与共享包

- `apps/runtime` 是独立生命周期的真 Agent Runtime：命名管道、持久事件/检查点、Provider 调用、计划/DAG、审批、恢复和工具循环都在这里。
- `packages/storage` 是 SQLite 真源访问层；durable 消息、事件、Agent/Skill/Policy/Artifact 等进入对应 store，不从 Renderer localStorage 反推。
- `packages/protocol` 只放跨进程稳定合同与校验；仅 Renderer 使用的 Electron IPC 类型放在 Desktop contract，避免把 Electron 能力扩散到 Runtime 协议。
- `packages/protocol/src/skill-selection.ts` 规范化每轮 SkillVersion ID；`packages/core/src/run-skill-selection.ts` 负责 allowlist 子集、归档和审批规则，保持无 I/O、可单测。
- `packages/storage` 的 Skill list 查询只投影 metadata；完整正文只由 Runtime 通过精确 SkillVersion ID 读取，不进入 Renderer 目录响应。
- `packages/workers` 负责最小权限执行。`terminal/terminal-worker.ts` 定义命令能力与输出上限，`process-runner.ts` 负责 spawn、流式读取、超时/取消和进程树清理。
- `packages/workers/src/browser/browser-host.ts` 负责系统浏览器发现/启动、CDP、Profile Session、Page lease、同 Page 队列与具体 Playwright 动作；`browser-worker.ts` 只把 capability token、路径与事件合同接到共享 Host。
- `apps/runtime/src/browser/runtime-browser-controller.ts` 把聊天 `browser_*` 参数映射为 Worker action，维护 P0.2 owner 临时 origin 集合，并保证 Runtime 的脱敏意图回调先于 Worker。正式 durable grant/command 状态仍属于 P0.3。
- `packages/core` 保持无 I/O 的领域规则；`packages/adapters` 隔离 Provider 差异；`packages/ui-kit` 只承载可复用产品组件，不持有 Desktop 业务生命周期。

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

### 浏览器 Worker（P0.1/P0.2）

```text
Provider browser_* tool call
  -> RuntimeBrowserController 参数校验 + owner 临时 origin grant
  -> Runtime 先持久化脱敏 browser.command.started
  -> PersistentBrowserWorker capability/fence/path 校验
  -> shared BrowserHost
  -> one Profile process / one owner Page lease / per-Page serial queue
  -> playwright-core connectOverCDP
  -> visible system Edge/Chrome
  -> 完整结果回当前 Provider；脱敏摘要进入 durable tool.completed
  -> browser_open 的脱敏 URL 供 Renderer webview 预览
```

Renderer 的 `browser.command_requested -> submitBrowserResult` 仅为旧 Runtime 迁移兼容；新 Runtime 不发布该请求。Profile 登录态位于 Runtime 数据目录 `browser-profiles/<profileId>`，不进入 Renderer、SQLite 或默认系统浏览器 Profile。

## 5. 数据与恢复边界

| 数据 | 真源/生命周期 |
| --- | --- |
| 任务、消息、Run、Step、Agent/Skill/Policy、Artifact、审计 | Runtime + SQLite durable store |
| 已启动 Run 的 Skill 选择 | durable event/checkpoint 保存精确 ID + fingerprint；正文继续以不可变 SkillVersion 为真源 |
| Workspace Pane 树、比例、焦点、资源 Tab、terminal cwd | 版本化 Renderer UI preference |
| 当前会话的 Skill 临时选择 | 当前 `ChatView`/欢迎页 Renderer state；成功或失败后保持，切换有效 Agent/Team owner 时恢复新默认，模型直聊为 `[]`；不写入布局偏好 |
| 文件磁盘正文 | 项目目录；保存时以 mtime/size 做并发校验 |
| 未保存文件草稿 | 当前 Renderer Session，按 workspaceId + path 隔离 |
| terminal 输出、历史、运行态、命令输入 | 当前 Renderer Session |
| terminal 子进程 | Main/Worker 当前生命周期；Renderer 销毁和应用退出时 abort |
| 浏览器 Profile/Cookie | Runtime 数据目录中的专用系统浏览器 Profile；不复制进 SQLite/Renderer |
| Browser Session/Page lease | 当前 Runtime/BrowserHost 生命周期；P0.2 origin grant 仅在内存，P0.3 前不具备重启恢复 |

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
