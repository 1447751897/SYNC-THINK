# Handoff Guide

最后更新：2026-07-19

## 0. 2026-07-19 最新交接

规格 `docs/superpowers/specs/2026-07-19-mention-task-progress-log-design.md` 已完成：群聊自动协作使用精确 `@` 消息，本轮任务与低层工具日志分离，右栏和工作记录减负，空白占位任务可安全丢弃，父子任务可折叠并双向跳转。普通完全访问对话、策略优先级、Provider 中止关闭和 Windows Desktop Worker 也已完成回归修复。

最新验证基线：Desktop **453**、Storage **233**、UI Kit **250**（另有 2 个既有 skipped）、Runtime **287**、Workers **53** 全部通过；Runtime/Workers typecheck 和 12 个 workspace 包串行 build 通过。根 Turbo build 在受限环境会因子进程 `realpath C:\Users\zhuzhenyu` 返回 `EPERM`，不要把它误判为源码或 TypeScript 构建失败。

当前剩余动作只有：启动最新 Runtime/Electron，并由用户在真实桌面验收 `@` 消息、本轮任务、Multica 式日志、空任务清理和父子任务导航。不要回退到旧右栏、旧群聊生命周期卡或把工具调用重新显示成任务步骤。

## 1. 必读顺序

新对话开始后，按顺序读取：

1. `docs/superpowers/specs/2026-07-18-agent-aware-talk-workspace-design.md`
2. `docs/development/10-current-status.md`
3. `docs/development/11-implementation-plan.md`
4. `docs/product/06-roadmap.md`
5. `docs/engineering/11-project-structure.md`
6. `AI_DEVELOPMENT_RULES.md`

不要要求用户重新解释已锁定需求，不要回退现有工作区改动。当前分支为
`feature/project-folder-binding`，工作区包含 Talk V8 的大量未提交实现。

## 2. 当前交接结论

M0、M1、M2 已关闭；Phase 3 进行中。Talk V8 本轮代码功能已完成：

1. 全局导航、对话任务、项目、好友、群聊、自动化、模型源、Skill & MCP、设置。
2. SYNC-THINK 平台身份信封、当前 thread 真实历史和跨任务隔离。
3. Runtime Command Gateway、21 个 `sync_think.*` 工具、CLI、stdio MCP。
4. 内置 Agent application-tool 多轮调用和配置确认卡。
5. 持久群聊、唯一主智能体、成员职责、subtask/handoff、成员执行和主智能体总结。
6. Cron/Webhook 自动化、HMAC、并发、重试、独立任务和运行历史。
7. Agent 状态、最大并发、PNG/JPEG/WebP 头像上传、消息头像、最近任务、历史版本和群聊归属投影。
8. 对话任务页已使用独立 Figma Talk 工作区，不再通过旧 `AppShell` 呈现任务；所有 Runtime 功能继续接线。
9. 任务右栏已收敛为真实 Run 进度、紧凑产物目录和每用户消息一轮的分 Agent 执行日志；审批是任务头工具弹窗，子任务/归档保留在任务树和任务头。
10. 对话已支持真实思考态与即时 delta、带边框消息正文、任务/群聊稳定身份、真实最新摘要和 13-18px 持久字号；群组与 Agent 受管头像并发加载不会互相覆盖。
11. 产品页 fidelity 已完成：任务点击不再置顶、对话阅读宽度扩大、项目使用真实对话组合、好友支持内联创建和分组能力编辑，群聊/自动化/模型源/Skill & MCP 使用统一全高目录/详情页面。
12. 独立审查的三个 Important 已关闭：项目设置可访问、空项目不残留旧任务或误建、首个 Agent 可从已导入模型源创建且错误可见。

不要把上述能力重新标为“占位”或“后续范围”。

## 3. 当前验证基线

```text
最新 Desktop: 62 files / 419 tests PASS
最新 UI Kit: 21 files / 239 tests PASS
最新全仓 test: 21/21 tasks PASS（Node 20，串行强制，0 cache）
其中 Storage: 22 files / 224 tests PASS；Runtime: 46 files / 265 tests PASS
最新全仓 typecheck: 21/21 tasks PASS（强制，0 cache）
最新全仓 build: 12/12 tasks PASS（强制，0 cache）
最新 Electron main/preload/renderer: 已生成
Electron visual QA: 1440×900 + 1280×720, light/dark PASS
Renderer Console: No Issues; pre-DevTools stderr empty; only DevTools-internal diagnostics after opening it
此前 Node 20 全仓基线: 189 files / 1399 tests PASS（最终 Talk 页面改动前）
```

本次已使用最新构建只重启 Desktop Electron；新根进程 `70140`，窗口标题 `SYNC-THINK`，
`Responding=True`，启动 stderr 为空。用户明确自行进行新任务页视觉验收，因此上面的历史
Electron visual QA 仍不能作为本轮对话样式、流式思考态和字号滑块的视觉验收证据。

任务详情右栏的规格和实施计划分别位于：

- `docs/superpowers/specs/2026-07-18-conversation-detail-rail-design.md`
- `docs/superpowers/plans/2026-07-18-conversation-detail-rail.md`

本轮通过受管 pnpm 环境使用 Node 20.20.2 完成全仓强制回归，Storage **22 files / 224 real SQLite tests** 与 Runtime **46 files / 265 tests** 均已真实执行。Desktop Electron 使用同一 Node 20 启动器重启；生产 Runtime 与 QA Runtime 按本轮 UI 改造边界保持运行，未迁移数据或重启服务。

## 4. 仅剩当前门禁

1. 用户在最新 Electron 中完成 Figma 1:1 视觉接受，重点检查任务目录、项目、好友、群聊、自动化、模型源和 Skill & MCP。
2. 若后续改动 Runtime/Storage，再单独重启生产 Runtime；本轮仅 UI/交互 fidelity，不应为视觉验收中断当前真实服务。

最新实窗已在 1440×900 与 1280×720 检查任务、项目、好友、群聊、自动化、模型源、Skill & MCP 和设置的浅/深主题，并验证全局导航折叠、主题切换、无溢出和 DevTools Console `No Issues`。过程中发现并修复了非任务页 0px Grid 空白回归。

生产 Runtime 会在 migration 前写入：

```text
%LOCALAPPDATA%\SYNC-THINK\backups\
```

受限执行环境必须显式允许该目录读写。不要关闭备份、移动生产数据库或改用空测试库来伪造生产重启通过。

当前生产 Runtime PID `43748`、QA Runtime PID `51248` 与最新 Electron PID `70140` 均存活。最新 Electron 由 Node 20 启动，窗口标题 `SYNC-THINK`、`Responding=True`，启动 stderr 为空。

## 5. 启动与验证

```powershell
$env:SYNC_THINK_DEV_NO_TOKEN = '1'
pnpm dev:runtime
pnpm dev:desktop
```

仅未打包开发版可用的实窗 QA 参数：

```powershell
$env:SYNC_THINK_DEV_WINDOW_WIDTH = '1280'
$env:SYNC_THINK_DEV_WINDOW_HEIGHT = '720'
$env:SYNC_THINK_DEV_USER_DATA_PATH = 'D:\projects\SYNC-THINK\.tmp-runtime-qa\electron-user-data'
$env:SYNC_THINK_DEV_DISABLE_HARDWARE_ACCELERATION = '1'
```

正式打包版会忽略这些参数；不要把 `--no-sandbox` 作为替代方案。

当前系统默认 Node 24 与 `better-sqlite3` 的 Node 20 ABI 不兼容。必要时直接使用：

```text
C:\Users\zhuzhenyu\AppData\Local\pnpm\nodejs\20.20.2\node.exe
```

验证命令见 `docs/maintenance/13-command-reference.md`。不要把 Node 24 的原生模块错误误判为代码回归。

## 6. 后续 Phase 3 范围

Talk V8 门禁关闭后，Phase 3 仍有独立产品范围：

- Browser Worker 与网页授权执行；
- Windows UI Automation Worker 与人工接管；
- 图像生成与视觉审查完整管线；
- 安装器、代码签名、自动更新和闭测分发。

这些范围不属于当前 Talk V8 功能重启门禁，不应混入本轮修复。
