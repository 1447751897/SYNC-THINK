# Local Development

本文档记录 Windows 本地开发、原生依赖和 Electron/Runtime 联调方式。

## 1. 固定工具链

项目固定使用：

```text
Node.js 20.20.2
pnpm 10.28.2
Windows 11 x64
```

版本来源：

- `pnpm-workspace.yaml` 的 `useNodeVersion: 20.20.2`
- 根 `package.json` 的 `packageManager: pnpm@10.28.2`
- 根 `package.json` 的 `engines.node: 20.x`
- `.nvmrc` 的主版本 `20`

不要用 Node 24/25 安装或重建 `better-sqlite3`。pnpm 会按 workspace 配置下载并使用 Node 20.20.2。

## 2. 首次安装

```powershell
corepack enable
corepack prepare pnpm@10.28.2 --activate
pnpm install
```

根级 `pretest`、`pretypecheck`、`prebuild` 会在当前 managed Node 20 目录缺少 pnpm shim 时，串行调用该 Node 自带的 Corepack 创建 shim。这样 Turbo 子任务不会退回系统 Node，也不会在首次运行时并发下载同一 Node 版本。

`pnpm-workspace.yaml` 已允许构建以下原生依赖：

```text
better-sqlite3
electron
esbuild
```

需要重新生成原生绑定时运行：

```powershell
pnpm rebuild better-sqlite3 electron esbuild
```

## 3. 常用验证

```powershell
pnpm test
pnpm typecheck
pnpm build
```

定向验证：

```powershell
pnpm --filter @sync-think/storage test
pnpm --filter @sync-think/runtime test
pnpm --filter @sync-think/desktop test
```

## 4. 启动 Runtime 与 Desktop

开发无 token 模式仅用于本机调试：

```powershell
# Terminal 1
$env:SYNC_THINK_DEV_NO_TOKEN = '1'
pnpm dev:runtime

# Terminal 2
pnpm dev:desktop
```

认证模式下，两个进程必须使用完全相同的 install ID 和 secret：

```powershell
$env:SYNC_THINK_INSTALL_ID = 'dev-local'
$env:SYNC_THINK_PIPE_SECRET = '<local-secret>'
```

Runtime 数据库默认位于：

```text
%LOCALAPPDATA%\SYNC-THINK\sync-think.db
```

测试可通过 `SYNC_THINK_DB_PATH` 指向隔离数据库。不得把 `SYNC_THINK_PIPE_SECRET` 写入日志、数据库、Renderer 状态或诊断导出。

## 5. Electron 构建边界

Electron 保持以下安全设置：

```text
contextIsolation: true
nodeIntegration: false
sandbox: true
strict Content Security Policy
```

Sandbox preload 必须构建为 CommonJS：

```text
apps/desktop/src/preload/index.ts
  -> apps/desktop/dist/preload/index.cjs
```

`apps/desktop/scripts/build-preload.mjs` 负责该转换。不要把 preload 改回直接加载 ESM；Electron sandbox preload 不支持当前 ESM 入口方式。

Renderer 由 `apps/desktop/scripts/build-renderer.mjs` 打包为本地 JS/CSS，CSP 不允许 `unsafe-eval`。

## 6. 联调检查

1. Runtime 日志出现 `pipe ready` 和 `database ready`。
2. Electron footer 显示 `已连接 / durable stream`。
3. 发送消息后出现 `message.appended`、`run.started`、`message.delta`、`run.completed`。
4. 关闭 Electron 不应结束 Runtime PID。
5. Runtime 重启后应从 SQLite checkpoint 续跑；客户端按 cursor 自动重连并补收 durable events。
6. Electron 控制台不得出现 CSP、安全、preload 或 renderer 异常。
