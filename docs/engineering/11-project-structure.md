# Project Structure

最后更新：2026-07-18

本文档描述当前模块边界和关键请求流。产品与行为真源仍以 `docs/superpowers/specs/` 中已批准规格为准。

## 1. 顶层目录

```text
SYNC-THINK/
  apps/
    desktop/       Electron main、preload、React Renderer
    runtime/       独立 Runtime、命名管道、命令网关、编排
    cli/           sync-think CLI 与 stdio MCP 薄适配器
  packages/
    shared/        跨包领域类型和无运行时依赖常量
    protocol/      命名管道帧、命令、应用工具合同、版本协商
    core/          纯领域规则、上下文选择、权限和合并算法
    storage/       SQLite schema、migration、Store、事务
    adapters/      Provider 协议适配与流式标准化
    secure-store/  凭证密文与 DPAPI 抽象
    workers/       File、Terminal、Git 等隔离执行器
    ui-kit/        可复用 React 产品组件与样式
    test-fixtures/ 跨包测试夹具
  scripts/         开发启动、自检和诊断脚本
  docs/            需求、决策、路线图、状态与规格
```

## 2. 模块职责

| 模块 | 负责 | 不负责 |
| --- | --- | --- |
| `apps/desktop` | Electron 安全边界、IPC/preload、页面装配、用户交互 | 直接读写 SQLite、持有 Provider 明文密钥 |
| `apps/runtime` | 唯一命令写入口、校验/授权、上下文编译、事件、调度 | 产品页面状态、CLI 参数解析 |
| `apps/cli` | CLI 参数、JSON 输出、stdio MCP、Runtime 会话连接 | 业务规则、独立数据库路径、第二套授权 |
| `packages/protocol` | 所有入口共享的命令与帧合同 | 执行业务或持久化 |
| `packages/core` | 可测试的纯领域决策 | I/O、Electron、SQLite |
| `packages/storage` | SQLite 数据真源和事务 | Renderer 展示逻辑、外部协议 |
| `packages/adapters` | OpenAI/Anthropic 等 Provider 请求与事件归一 | Agent/项目权限决策 |
| `packages/workers` | 受限本地工具执行和逃逸防护 | 任意 Shell 或绕过 Runtime 授权 |
| `packages/ui-kit` | 复用产品组件、交互状态和视觉 token | 直接调用 Runtime 或持久化 |

## 3. 关键请求流

### 3.1 对话与上下文

```text
Renderer -> preload/main -> Runtime command
         -> 当前 project/task/thread/Agent/group 查询
         -> compileProviderContext（SYNC-THINK 信封 + 当前 thread 历史）
         -> Provider adapter -> 流式事件/Artifact
         -> SQLite event/store -> Desktop 投影
```

关键文件：

- `apps/runtime/src/provider-context.ts`：平台身份、Agent 指令和 thread 历史编译。
- `apps/runtime/src/demo-run.ts`：把编译结果真正发送给 Provider，并随 checkpoint 恢复。
- `packages/core/src/context-packet.ts`：Manifest/预算选择规则。
- `packages/shared/src/types/context.ts`：上下文来源类型。

同一任务的历史按事件 sequence 排序；只读取请求中的 `threadId`。跨任务内容必须通过显式父任务引用或后续批准的记忆/文件来源进入。

### 3.2 应用命令网关

```text
Desktop UI ----\
CLI ------------+-> named pipe -> Runtime Command Gateway
stdio MCP ------/                    -> confirmation -> validation/authorization
                                      -> domain service -> Store/Event -> response
```

关键文件：

- `packages/protocol/src/commands.ts`：Runtime 命令 payload/response。
- `packages/protocol/src/application-tools.ts`：外部 `sync_think.*` 工具映射与确认分类。
- `apps/runtime/src/command-validation.ts`：命令输入校验。
- `apps/runtime/src/command-confirmation.ts`：外部配置操作 preview/confirm。
- `apps/cli/src/runtime-command-client.ts`：认证命名管道客户端。
- `apps/cli/src/cli.ts`、`mcp-server.ts`：CLI/MCP 适配。

### 3.3 Agent、应用工具与群聊协作

```text
Desktop/CLI/MCP -> Runtime -> AgentStore / GroupStore -> SQLite
                                      -> immutable AgentVersion / versioned GroupDefinition

Provider tool call -> application-tool loop -> Runtime Command Gateway
                   -> result/confirmation card -> next Provider turn

group task -> lead decomposition -> isolated member subtask/handoff
           -> task event stream -> lead final summary
```

- `packages/storage/src/agent-store.ts`：AgentVersion 与运行时模型绑定。
- `packages/storage/src/group-store.ts`：群聊、唯一主智能体、成员职责和版本 CAS。
- `packages/storage/src/schema/group.ts`：群聊表结构。
- `apps/runtime/src/group-collaboration.ts`：主智能体、成员步骤、handoff 和最终总结的协作计划。
- `apps/runtime/src/orchestration/production-step-executor.ts`：主智能体 `single/delegate` 决策、成员隔离包、精确工具白名单与 Step Provider 上下文。
- `apps/runtime/src/provider-context.ts`：对话、项目、群聊、自动化和外部 surface 的平台信封与当前 thread 历史。
- `apps/runtime/src/demo-run.ts`：内置 application-tool turn、结果回传和循环边界。
- `apps/desktop/src/renderer/talk-workspace.tsx`：Talk 导航、群聊资料、Skill & MCP、自动化与设置。
- `apps/desktop/src/renderer/agent-profile-projection.ts`：从 Agent、任务事件和群聊真源投影最近任务、历史版本和群聊职责。
- `apps/desktop/src/main/window-size.ts`：仅开发态的受校验窗口尺寸、隔离 userData 和软件渲染 QA 边界；正式打包版禁用。
- `packages/ui-kit/src/components/AgentWorkspace.tsx`：好友/Agent 资料和编辑。

GroupDefinition 是可持久化配置；实际 subtask/handoff、成员执行和主智能体总结由 Runtime 编排，并写入当前任务事件流。Store 和 UI 不生成伪执行结果。

### 3.4 自动化

```text
Desktop/Runtime command -> AutomationStore -> cron scheduler / loopback webhook
                                           -> HMAC + concurrency + retry
                                           -> new task -> Agent/group execution
                                           -> execution history + task event stream
```

- `apps/runtime/src/automation-schedule.ts`：五字段 Cron 与 IANA 时区的下一触发时间。
- `apps/runtime/src/automation-service.ts`：调度、Webhook、HMAC、并发、重试和任务启动。
- `packages/storage/src/automation-store.ts`：AutomationDefinition 与 Execution 真源。
- `packages/storage/src/schema/automation.ts`：自动化领域表结构。
- `apps/desktop/src/automation-payloads.ts`：Desktop IPC 严格输入边界。

每次触发都创建新任务，不复用其他任务的对话历史。Webhook 只监听 loopback；密钥保存在 Secure Store，只在创建或轮换时显示一次。

## 4. 文件放置规则

1. 新命令先在 `packages/protocol` 定义，再由 Runtime 实现；Desktop、CLI、MCP 只做适配。
2. 领域不变量优先放 `packages/core`；数据库约束和事务放 `packages/storage`。
3. Renderer 不导入 `better-sqlite3`、`node:fs`、secure-store 或 Runtime 内部模块。
4. 密钥只以 CredentialRef 穿过业务层；应用工具、上下文、事件和诊断不返回 secret。
5. 群聊交流必须归属 task/subtask/handoff/review/final summary 事件，禁止独立的无界 Agent 聊天通道。
6. 新页面优先装配既有 `ui-kit`，页面专属状态留在 Desktop Renderer；不要把 Runtime 请求写进展示组件。

## 5. 当前结构缺口

- Browser Worker 与网页授权执行尚未实现。
- Windows UI Automation Worker 与人工接管回退尚未实现。
- 图像生成完整管线、视觉审查闭环、安装器、签名和自动更新尚未实现。
- Talk V8 双主题双尺寸 Electron 实窗门禁已完成，仅剩最终生产 Runtime/Desktop 在线重启。
