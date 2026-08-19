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

源码 UI 闭测重启（不生成安装包）可直接执行：

```powershell
pnpm --filter @sync-think/desktop build
$env:SYNC_THINK_DEV_NO_TOKEN = '1'
$env:SYNC_THINK_INSTALL_ID = 'dev-0001'
pnpm dev:desktop
```

启动日志应依次出现 `pipe ready`、`database ready` 和 `hello accepted`；窗口标题应为 `SYNC-THINK` 且进程保持 Responding。建议把 stdout/stderr 重定向到 `.data/local-restart-<timestamp>/`，便于回看本次闭测。

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

Renderer 由 `apps/desktop/scripts/build-shell.mjs` 打包为本地 JS/CSS（esbuild + Tailwind v4，输出 `dist/renderer-shell/`），CSP 不允许 `unsafe-eval`。颜色 token 由 `pnpm tokens:css` 从 `docs/product/16-shell-design-tokens.json` 生成到 `src/renderer/shell/tokens.css`，构建时被 `shell.css` `@import` 进来。

## 6. 联调检查

1. Runtime 日志出现 `pipe ready` 和 `database ready`。
2. Electron footer 显示 `已连接 / durable stream`。
3. 发送消息后出现 `message.appended`、`run.started`、`message.delta`、`run.completed`。
4. 关闭 Electron 不应结束 Runtime PID。
5. Runtime 重启后应从 SQLite checkpoint 续跑；客户端按 cursor 自动重连并补收 durable events。
6. Electron 控制台不得出现 CSP、安全、preload 或 renderer 异常。

## 7. Browser Worker 本机验证

生产 Runtime 默认在数据库同级创建独立浏览器 Profile：

```text
%LOCALAPPDATA%\SYNC-THINK\browser-profiles\default
```

浏览器发现顺序为：显式覆盖、Microsoft Edge、Google Chrome。需要指定便携版或非标准安装位置时，仅在启动 Runtime 的终端设置：

```powershell
$env:SYNC_THINK_BROWSER_EXECUTABLE = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
```

真实 CDP smoke 会打开一个可见系统浏览器，使用临时 Profile 和本地 HTTP 页面，完成后关闭并清理：

```powershell
$env:SYNC_THINK_BROWSER_SMOKE = '1'
pnpm --filter @sync-think/workers exec vitest run src/browser/browser-host.smoke.test.ts
Remove-Item Env:SYNC_THINK_BROWSER_SMOKE
```

普通 `pnpm test` 默认跳过该 smoke，避免每次回归弹出浏览器。不要把默认 Edge/Chrome 用户数据目录配置为 Sync-Think Profile；登录态必须留在专用 Profile 中。

## 8. Windows 便携发布验证

生成 unsigned portable staging：

```powershell
pnpm release:stage:win
```

对现有 staging 目录执行独立 preflight：

```powershell
pnpm test:release:win
pnpm release:verify:win
```

输出目录：

```text
apps/desktop/release/win-unpacked
```

完整布局、隔离环境变量、packaged identity 双冷启动验收和回滚步骤见 `docs/operations/08-deployment.md`。当前 portable staging 不是最终安装器；packaged smoke 应使用独立 `--user-data-dir` 与数据库路径，并确保不设置 `SYNC_THINK_INSTALL_ID`、`SYNC_THINK_PIPE_SECRET`、`SYNC_THINK_DEV_NO_TOKEN`，由 Desktop 首次生成并安全复用安装身份。开发模式仍可显式设置这些变量进行 fixture 测试。

## 9. Windows NSIS installer 与生命周期 smoke

构建与校验：

```powershell
pnpm test:release:win
pnpm test:installer:win
pnpm release:stage:win
pnpm release:verify:win
pnpm release:installer:win
pnpm release:verify:installer:win
```

执行真实 clean / overlay / version upgrade / uninstall / reinstall smoke，并保留最终实例供人工测试：

```powershell
pnpm release:smoke:installer:win
```

结果位于唯一的 `.data/installer-smoke-<guid>/smoke-result.json`；各阶段日志位于同目录的 `logs/`。成功结果必须同时满足 Runtime ready、package/registry version 正确、identity/ciphertext/database 连续、卸载移除 executable 且保留用户数据、重装恢复。

当前 installer 是 per-user assisted NSIS。完全验证路径必须使用隔离安装目录、`--user-data-dir`、`LOCALAPPDATA` 和 `SYNC_THINK_DB_PATH`；不要把正常用户目录作为 smoke 输入。portable staging 使用 hoisted production deploy tree，并会剪除自有 package 的 `scripts` 与 `release`，避免旧 artifact 递归进入新包。

## 10. Database Governance P0.3 离线维护

默认诊断始终只读：

```powershell
pnpm db:governance --db <database.db>
pnpm db:governance --db <database.db> --deep --json
```

准备精确 manifest 也保持 readonly + query_only，不修改数据库、WAL 或备份：

```powershell
pnpm db:governance `
  --db <database.db> `
  --backups <backups-directory> `
  --event-payload-sidecar <event-payload-sidecar-directory> `
  --deep `
  --prepare-manifest <manifest.json>
```

`--event-payload-sidecar` 只在数据库含外置 Event payload 引用时必需；路径会写入 source manifest 供执行前 stale 校验，但 portable recovery manifest 不依赖原目录。输出会包含 manifest SHA-256 与精确 confirmation token。

准备 Event payload exact backfill dry-run plan 同样保持 readonly + query_only，只写计划 JSON，不修改 Event、sidecar、WAL/SHM 或备份：

```powershell
pnpm db:governance `
  --db <database.db> `
  --event-payload-sidecar <event-payload-sidecar-directory> `
  --minimum-payload-bytes 65536 `
  --prepare-backfill-plan <backfill-plan.json>
```

当前 selector 只包含 `context.packet.built`，projection builder 固定为 `context-packet-query-v1@1`。输出计划包含精确 Event/reference 列表、source/destination/sidecar hashes、容量估算与 plan hash；`--prepare-manifest`、`--prepare-backfill-plan`、`--execute-manifest` 三种模式互斥。此命令不会创建目标 sidecar 目录，也不会执行 backfill。

执行 P0.3 maintenance manifest 前必须完全关闭 Desktop 与 Runtime，并确认没有其他 SQLite writer；三个执行门禁缺一不可：

```powershell
pnpm db:governance `
  --execute-manifest <manifest.json> `
  --confirm "<exact confirmation token>" `
  --maintenance-window `
  --batch-size 500 `
  --audit <audit.json>
```

首次 `Ctrl+C` 仅请求在当前事务批完成后取消并写入 `cancelled` audit；使用同一 manifest、token 与 audit 命令可恢复。旧备份会进入 `<backups>/quarantine/<planId>/`，不会直接删除。

恢复步骤：

1. 保持 Desktop/Runtime 完全关闭，确认数据库没有 writer。
2. 保存维护后数据库及同名 `-wal` / `-shm`（若存在）的事故快照，不覆盖 audit 记录中的 recovery backup。
3. 核对 audit 的 `manifestHash`、`databasePath`、`recoveryBackup.path`、`quickCheck: ok` 与 `recoveryBackup.eventPayloadSidecars` descriptor。
4. 在离线状态下同时恢复 SQLite backup 与同名 `.sidecars` 目录；只在源数据库完全关闭后处理旧 `-wal` / `-shm`，并保持恢复后的 sidecar root 与 Runtime 配置一致。
5. 如需恢复历史备份，按 audit 游标从 `<backups>/quarantine/<planId>/` 移回原 backups 目录，并再次核对 name/size/mtime。
6. 重新启动前对恢复数据库执行只读 quick governance/SQLite integrity 检查，再验证 Runtime `database ready` 与 hello handshake。

P0.3 不执行 `VACUUM`、incremental vacuum 或物理文件压缩。真实大库维护必须单独排期并保留额外外部备份。


### Event payload backfill B2 durable execution

在 Desktop/Runtime 完全关闭、无其他 writer 的离线窗口中执行：

```powershell
pnpm db:governance `
  --execute-backfill-plan <backfill-plan.json> `
  --confirm "APPLY-EVENT-PAYLOAD-BACKFILL:<planId>:<planHash前16位>" `
  --maintenance-window `
  --batch-size 500 `
  --audit <backfill-audit.json>
```

执行器先验证 portable SQLite + sidecar recovery set，再按 blob-first、SQLite compare-and-swap、audit-last 的顺序提交。首次 Ctrl+C 只在批次边界取消；使用同一 plan、token 与 audit 可恢复。

### Event payload backfill B3 exact rollback

```powershell
pnpm db:governance `
  --rollback-backfill-plan <backfill-plan.json> `
  --execution-audit <backfill-audit.json> `
  --confirm "ROLLBACK-EVENT-PAYLOAD-BACKFILL:<planId>:<planHash前16位>" `
  --maintenance-window `
  --batch-size 500 `
  --audit <rollback-audit.json>
```

rollback 从已验证 recovery database 恢复精确 source payload，并要求 execution audit、plan、recovery manifest、sidecar blobs、当前 envelope 与 durable cursor 全部一致。rollback 不删除 backfill 产生的 blob；这些 blob 在回滚后成为 orphan，由 B4 单独标记。

### Event payload sidecar B4 orphan mark/quarantine

只读 mark：

```powershell
pnpm db:governance `
  --db <database.db> `
  --event-payload-sidecar <event-payload-sidecar-directory> `
  --prepare-sidecar-gc <sidecar-gc-manifest.json>
```

离线 quarantine sweep：

```powershell
pnpm db:governance `
  --execute-sidecar-gc <sidecar-gc-manifest.json> `
  --confirm "QUARANTINE-EVENT-PAYLOAD-ORPHANS:<sweepId>:<manifestHash前16位>" `
  --maintenance-window `
  --batch-size 100 `
  --audit <sidecar-gc-audit.json>
```

mark 会完整 hydrate live blobs 并固化 exact orphan identities。sweep 只将 manifest 中的 orphan 移到 `<sidecar-root>/.quarantine/<sweepId>/`，不永久删除；支持取消、恢复和 move/audit crash-window recovery。mark 后新增的合法 managed orphan 不属于旧 manifest，会留在原位等待下一轮 mark。任何数据库/reference/blob 漂移、路径逃逸、symlink/junction/reparse point 或 audit 篡改都会停止执行。

真实主库和历史备份仍只做只读诊断；上述写入命令只在明确安排的离线维护窗口中使用。

### Runtime Event payload sidecar 显式启用

默认关闭。开发或受控验收时可显式设置：

```powershell
$env:SYNC_THINK_EVENT_PAYLOAD_SIDECAR = "1"
# 可选；未设置时由 database path + install ID 派生隔离目录
$env:SYNC_THINK_EVENT_PAYLOAD_SIDECAR_ROOT = "D:\data\sync-think-event-payload-sidecars"
```

当前只会外置达到 64 KiB 的 `context.packet.built`。已有内联记录不会在启动时 backfill；sidecar 缺失或损坏会在 Runtime 打开阶段 fail-closed。启用后必须保持 database、install ID 与 sidecar root 配套；backfill、rollback、GC、retention、archive 和 VACUUM 仍使用独立离线治理命令。

## 11. Database Governance P0.4 Event retention/archive（fixture-only）

只读 prepare 固化 canonical UTC cutoff、`(sequence, id)` high-water fence、protected Event 集、精确候选行、预算、数据库/schema 指纹和 execute/rollback token：

```powershell
pnpm db:governance `
  --db <fixture.db> `
  --prepare-event-archive <archive-manifest.json> `
  --archive-root <archive-root> `
  --retention-cutoff <YYYY-MM-DDTHH:mm:ss.sssZ> `
  --archive-max-rows 10000 `
  --archive-max-bytes 268435456
```

离线执行与恢复都要求 exact token、maintenance window 和 durable audit：

```powershell
pnpm db:governance `
  --execute-event-archive <archive-manifest.json> `
  --confirm "ARCHIVE-EVENT-RETENTION:<archiveId>:<manifestHash-prefix>" `
  --maintenance-window `
  --batch-size 500 `
  --audit <execute-audit.json>

pnpm db:governance `
  --rollback-event-archive <archive-manifest.json> `
  --confirm "ROLLBACK-EVENT-RETENTION:<archiveId>:<manifestHash-prefix>" `
  --maintenance-window `
  --execution-audit <execute-audit.json> `
  --batch-size 500 `
  --audit <rollback-audit.json>
```

执行前先生成并验证 `manifest.json + events.jsonl.gz + segment.json` portable recovery set。execute/rollback 支持批次边界取消与同 audit 恢复，并对 SQLite commit/audit cursor 的崩溃窗口进行对账。任何 schema、checkpoint、protected set、high-water、manifest、segment、audit 或路径安全漂移都会 fail-closed。

## 12. Database Governance P0.4 physical compaction（fixture-only）

只读 prepare：

```powershell
pnpm db:governance `
  --db <fixture-root>/sync-think.db `
  --governance-root <fixture-root> `
  --prepare-compaction <fixture-root>/incremental.json `
  --compaction-operation incremental-vacuum
```

`auto_vacuum=INCREMENTAL` fixture 可执行受 page/time budget 约束的 durable incremental vacuum：

```powershell
pnpm db:governance `
  --execute-incremental-vacuum <fixture-root>/incremental.json `
  --confirm "<exact compaction token>" `
  --maintenance-window `
  --page-budget 1000 `
  --batch-pages 128 `
  --time-budget-ms 5000 `
  --audit <fixture-root>/incremental.audit.json
```

离线压缩使用 `VACUUM INTO` 生成新候选数据库，不覆盖源库：

```powershell
pnpm db:governance `
  --db <fixture-root>/sync-think.db `
  --governance-root <fixture-root> `
  --prepare-compaction <fixture-root>/offline.json `
  --compaction-operation offline-compaction

pnpm db:governance `
  --execute-offline-compaction <fixture-root>/offline.json `
  --confirm "<exact compaction token>" `
  --maintenance-window `
  --output-db <fixture-root>/sync-think.compacted.db `
  --audit <fixture-root>/offline.audit.json
```

候选库必须通过 quick/integrity check，并保持 schema/user version、Event/Checkpoint high-water 与全表 row-count projection；输出 bytes/SHA-256 和 audit 都会重新验证。输出必须位于 governance root 内，symlink/junction/reparse point 会被拒绝。治理执行器不接入 Runtime startup，默认约 16.87 GB 主库和历史备份继续只读。

## 13. Phase 3 本地收口与视觉证据

```powershell
pnpm test:phase3
pnpm capture:phase3
pnpm prepare:update-feed-fixture:win
pnpm test:update-feed:prepared:win
pnpm selftest:phase3
```

`pnpm prepare:update-feed-fixture:win` 会执行根构建、显式 unsigned portable staging 和 schema v3 NSIS installer build；`pnpm test:update-feed:prepared:win` 只消费并严格预检该 fixture。常规入口 `pnpm test:update-feed:win` 会串联两步，从空 `apps/desktop/release` 开始也可复现。

截图与 manifest 输出到 `.data/phase3-visual/current`。该目录只代表本地可复验证据，不替代正式签名、真实私有 feed、真实图片 Provider 或邀请用户闭测。
