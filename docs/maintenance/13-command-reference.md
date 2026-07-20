# Command Reference

最后更新：2026-07-18

## 1. 环境

```text
Node.js: 20.x（见 .nvmrc / package.json engines）
pnpm: 10.28.2
工作目录: 仓库根目录
```

`better-sqlite3` 是原生模块。切换 Node 大版本后必须重新安装/重建依赖；不要用 Node 24 加载为 Node 20 构建的二进制。

## 2. 开发与验证

| 命令 | 用途 |
| --- | --- |
| `pnpm dev:runtime` | 启动独立 Runtime watch 进程 |
| `pnpm dev:desktop` | 构建并启动 Electron Desktop |
| `pnpm test` | 运行全部 workspace 测试 |
| `pnpm typecheck` | 运行全部 TypeScript 类型检查 |
| `pnpm build` | 构建全部 workspace 包 |
| `pnpm lint` | 运行 lint；当前仍有 ESLint 9 flat-config 存量债务，不应误报为通过 |
| `pnpm selftest:m1-soft` | 运行 M1 完整回归脚本 |
| `pnpm selftest:m1-soft:quick` | 运行 M1 快速回归 |
| `pnpm selftest:m2` | 运行 M2 确定性编排退出演示 |

聚焦单包示例：

```powershell
pnpm --filter @sync-think/runtime test
pnpm --filter @sync-think/desktop test
pnpm --filter @sync-think/ui-kit test
pnpm --filter @sync-think/cli test
```

当受限执行环境禁止 Turbo 派生进程读取 pnpm 所在的用户目录时，使用以下等覆盖逐包门禁：

```powershell
pnpm -r --workspace-concurrency=1 --if-present test
pnpm -r --workspace-concurrency=1 --if-present typecheck
pnpm -r --workspace-concurrency=1 --if-present build
```

未打包 Desktop 的 1280×720 隔离实窗 QA：

```powershell
$env:SYNC_THINK_DEV_WINDOW_WIDTH = '1280'
$env:SYNC_THINK_DEV_WINDOW_HEIGHT = '720'
$env:SYNC_THINK_DEV_USER_DATA_PATH = 'D:\projects\SYNC-THINK\.tmp-runtime-qa\electron-user-data'
$env:SYNC_THINK_DEV_DISABLE_HARDWARE_ACCELERATION = '1'
pnpm dev:desktop
```

这些参数在正式打包版中被忽略；不得用 `--no-sandbox` 代替真实实窗权限。

## 3. SYNC-THINK CLI

Runtime 必须先启动。开发态使用根脚本：

```powershell
pnpm cli -- tools
pnpm cli -- call sync_think.project.list
pnpm cli -- call sync_think.task.list --json '{"workspaceId":"..."}'
pnpm cli -- call sync_think.agent.create --input-file .\agent.json
pnpm mcp
```

构建后的二进制等价语法：

```text
sync-think tools
sync-think call <tool-or-command> [--json <json> | --input-file <path>] [--confirm <token>]
sync-think mcp
```

环境变量：

| 变量 | 作用 | 默认 |
| --- | --- | --- |
| `SYNC_THINK_INSTALL_ID` | 选择 Runtime 命名管道实例 | `dev-0001` |
| `SYNC_THINK_PIPE_SECRET` | 启用时用于 Runtime 双向握手 | 未设置 |
| `SYNC_THINK_DB_PATH` | 测试或隔离运行时覆盖 SQLite 路径 | `%LOCALAPPDATA%\SYNC-THINK\sync-think.db` |
| `SYNC_THINK_WEBHOOK_HOST` | Automation Webhook 监听地址 | `127.0.0.1` |
| `SYNC_THINK_WEBHOOK_PORT` | Automation Webhook 监听端口 | `47821` |

## 4. 应用工具

| 工具 | 行为 | 首次是否确认 |
| --- | --- | --- |
| `sync_think.project.list` | 列出项目元数据 | 否 |
| `sync_think.project.create` | 创建未绑定文件夹的项目 | 是 |
| `sync_think.task.list` | 列出项目任务 | 否 |
| `sync_think.task.create` | 创建任务和对话 | 否 |
| `sync_think.subtask.delegate` | 为精确 AgentVersion 创建带隔离包的子任务 | 否 |
| `sync_think.handoff.record` | 在当前任务事件流记录一次定向 Agent 交接 | 否 |
| `sync_think.task.open` | 查看任务 | 否 |
| `sync_think.agent.list` | 列出 AgentVersion 与模型绑定 | 否 |
| `sync_think.agent.create` | 创建 Agent | 是 |
| `sync_think.agent.update` | 创建 Agent 的下一不可变版本 | 是 |
| `sync_think.group.list` | 列出固定/临时群聊 | 否 |
| `sync_think.group.get` | 查看群聊成员职责 | 否 |
| `sync_think.group.create` | 创建群聊 | 是 |
| `sync_think.group.update` | 修改群聊配置 | 是 |
| `sync_think.group.member.add` | 添加成员 | 是 |
| `sync_think.group.member.remove` | 移除成员 | 是 |
| `sync_think.group.member.update_responsibility` | 修改成员职责 | 是 |
| `sync_think.group.set_lead` | 更换唯一主智能体 | 是 |
| `sync_think.group.task.create` | 创建绑定群聊的任务 | 否 |
| `sync_think.provider.list` | 列出 Provider/密钥分组/模型元数据，不返回密钥 | 否 |
| `sync_think.context.inspect` | 查看任务有效上下文与权限元数据 | 否 |

`sync-think call` 也接受 Runtime 原生命令名，但外部集成应优先使用稳定的 `sync_think.*` 工具名。

## 5. 配置确认

CLI 首次调用配置工具会返回：

```json
{
  "status": "confirmation_required",
  "confirmationToken": "...",
  "payloadKeys": ["name"],
  "summary": "...",
  "expiresAt": "..."
}
```

检查预览后，用完全相同的 command 和 payload 再调用：

```powershell
pnpm cli -- call sync_think.agent.create --input-file .\agent.json --confirm <token>
```

MCP 工具把令牌放入同一 arguments 对象的 `_confirmationToken` 字段。Runtime 会在读取后立即消费令牌；令牌默认 5 分钟过期，并绑定 caller surface、命令和 payload digest。修改任何参数都需要重新预览。

Desktop 中用户明确点击的保存/创建操作不走第二次确认，因为该点击本身就是交互确认；它仍经过 Runtime 校验、授权、事件和 Store。

## 6. 自动化命令

Automation 当前使用 Runtime 原生命令；Desktop 已接通全部命令，CLI 也可用 `sync-think call <command>` 调试：

| 命令 | 用途 |
| --- | --- |
| `automation.create` | 创建 Cron 或 Webhook 自动化；Webhook 会返回一次性密钥 |
| `automation.update` | 以 expectedVersion 替换配置，必要时轮换 Webhook 密钥 |
| `automation.delete` | 软删除自动化并移除对应安全密钥 |
| `automation.get` | 读取定义、Runtime 状态和最近执行 |
| `automation.list` | 按项目/启用状态列出自动化 |
| `automation.trigger` | 手动触发并创建独立任务 |
| `automation.execution.list` | 查询自动化运行历史 |

Cron 使用五字段格式，时区使用 IANA 名称。Webhook 地址为
`http://<SYNC_THINK_WEBHOOK_HOST>:<port>/webhooks/<path>`，请求通过
`X-Sync-Think-Signature: sha256=<hex>` 携带请求体 HMAC-SHA256；密钥只在创建或轮换响应中出现一次。

## 7. 当前边界

- Desktop、CLI、MCP 与内置 Agent 已复用同一 Runtime Command Gateway；CLI/MCP 已能管理项目、任务、Agent、群聊并检查 Provider/上下文。
- `apps/cli` workspace package 与 `pnpm-lock.yaml` importer 已同步，可在干净环境按锁文件安装。
- 群聊任务已执行显式成员 subtask/handoff 与主智能体总结；群聊配置仍必须经 Runtime 确认边界。
- Automation 原生命令与 Desktop 页面已完成；当前 21 个稳定 `sync_think.*` 工具清单不包含自动化配置命令，CLI 仍可用原生命令调试。
- 头像上传是 Desktop 本地文件 IPC，不暴露给模型、CLI 或 MCP。
- Browser/UIA 工具仍不在当前应用工具清单内。
