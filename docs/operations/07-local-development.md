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

## 3. Renderer 构建与验证

### 3.1 构建模式

默认 `pnpm --filter @sync-think/desktop build` / `build:shell` 生成生产构建，不从环境中的 `NODE_ENV` 推断模式。

| 模式     | 命令                                                | 输出目录                            |
| -------- | --------------------------------------------------- | ----------------------------------- |
| 生产     | `pnpm --filter @sync-think/desktop build`           | `apps/desktop/dist/renderer-shell`  |
| 开发     | `pnpm --filter @sync-think/desktop build:shell:dev` | `.data/renderer-builds/development` |
| 视觉验收 | `pnpm --filter @sync-think/desktop build:shell:qa`  | `.data/renderer-builds/qa`          |

- `pnpm dev:desktop` 默认启动生产 Renderer。显式开发 Renderer 使用 `pnpm --filter @sync-think/desktop dev:renderer`，启动前重建开发页面；只有未打包的 Main 接受固定开发目录。原有 loopback 开发服务器校验保持不变。
- `pnpm capture:phase3` 构建独立 QA 入口后采集视觉矩阵。`phase3-visual` 查询参数只在 QA 入口生效，生产入口不加载视觉替身。
- Shell 使用本地 ESM 分块；设置、工作台、智能体、小队、浏览器、能力、任务和活动中心按需加载。preload 仍是沙箱兼容的 CJS，xterm/Mermaid/Excalidraw 仍由已有 vendor loader 按需加载。
- 生产模式压缩 JS/CSS、不生成 sourcemap；开发模式保留 sourcemap。`build-manifest.json` 记录入口静态依赖闭包、动态模块及体积；当前预算为首屏 JS 2,100,000 bytes、全部 Shell JS 3,000,000 bytes，不含另行加载的 vendor 和字体。超限时构建失败，不覆盖原构建。
- `--outdir` 只允许 `.data/renderer-builds` 下的子目录，用于隔离验证。构建先写独立 staging，完成后替换目标生成目录，拒绝根目录/越界/junction 路径，移除旧 chunk 和 sourcemap，避免跨模式残留。
- Windows release 在 staging 前和验证时检查生产 manifest；只在待发布副本中移除未使用的 `dist/renderer` TypeScript 输出（含 QA fixture），保留本地类型检查产物与用户数据。
- 模块加载失败提供局部恢复；重试使用构建生成的本地 chunk 映射和递增地址，绕开已失败模块的缓存，不刷新主窗口。构建期间已打开的开发窗口仍应在构建完成后重新打开，特别是旧页面尚未读取的 hash chunk 已被替换时。

### 3.2 常用验证

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

Windows 后台会话与审批断连真实验收：

```powershell
pnpm selftest:codex-persistent
pnpm selftest:approval-reconnect
```

`selftest:approval-reconnect` 使用隔离数据库、Electron userData、`LOCALAPPDATA` 和本地脚本 Provider，依次执行 approve/deny。脚本会在审批出现后完整关闭并重开 Desktop，断言 Runtime PID 未变化、同一 approvalId 被恢复、请求/决策各持久化一次、approve 副作用只执行一次且 deny 不产生副作用；证据保存在 `.data/tool-approval-reconnect-e2e-*/`。

## 4. 启动 Runtime 与 Desktop

开发无 token 模式仅用于本机调试。公开 Beta 测试者的安装包会自己生成 Install ID 和 pipe secret，**不得**在测试者机器上设置 `SYNC_THINK_DEV_NO_TOKEN` 或固定 `SYNC_THINK_INSTALL_ID`。

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

启动日志应依次出现 `pipe ready`、`database ready` 和 `hello accepted`；窗口标题应为 `SYNC-THINK` 且进程保持 Responding。Runtime 冷启动 readiness 预算为 120 秒，启动完成还会经私有 IPC 发出 ready 信号。

Runtime 子进程的 stdout/stderr 与 spawn、ready、error、exit 生命周期会追加到数据库同级的 `runtime-<installId>.log`；daemon 自身仍写 `daemon.log`。排查大库冷启动或 Runtime code 1 时先查看这两个文件的尾部，日志缺失不影响应用继续重试。

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

Codex/Claude Code 私有内核默认保存在数据库同级 `kernels/`，生产由 Desktop 自动把该路径作为 `SYNC_THINK_MANAGED_KERNEL_ROOT` 传给 Runtime。本地排查更新器时可显式隔离：

```powershell
$env:SYNC_THINK_MANAGED_KERNEL_ROOT = 'D:\tmp\sync-think-kernels'
$env:SYNC_THINK_NPM_CLI = 'C:\path\to\node_modules\npm\bin\npm-cli.js'
```

`SYNC_THINK_NPM_CLI` 只用于开发环境覆盖。便携包从 `resources/node/node_modules/npm/bin/npm-cli.js` 自动解析；关于页升级写入应用私有目录，不修改系统 npm prefix 或用户全局 Claude/Codex。

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

## 14. Native 增量运行状态的验证与版本回滚

2026-09-05 新 Runtime 可以恢复旧的完整 run，也可以恢复 version=1 的 runStateDelta。增量只减少新写入的重复状态，不压缩/删除已有 event 或 checkpoint。旧 Runtime 没有增量解码能力，部署时应同步更新 Runtime 和 Desktop；单纯回退二进制不是此格式的可靠降级方法。

开发验证入口：

```powershell
pnpm --filter @sync-think/runtime test src/run-state-delta.test.ts src/demo-run-persistence.test.ts src/native-run-state-persistence.test.ts
pnpm --filter @sync-think/runtime test --maxWorkers=1 --minWorkers=1
pnpm --filter @sync-think/storage test --maxWorkers=1 --minWorkers=1
pnpm --filter @sync-think/protocol test
```

新增真实文件 SQLite 测试通过 Runtime 的实际提交/恢复逻辑验证 128 事件检查点、模型回退、跨运行瞬态状态、连接关闭后新 Runtime 恢复，以及 event/checkpoint/外层 UnitOfWork 失败回滚；测试不启动 IPC 或占用扩展端口。既有 Runtime 全量测试仍有固定 17373 端口冲突日志，端口隔离治理另行推进，不停止用户 Runtime 来迁就测试。

上线与回滚门槛：

1. 记录当前 Runtime/窗口版本、数据库路径、剩余空间和活动运行；等待活动运行结束或按应用支持的方式暂停，确认停写边界。
2. 使用 SQLite 一致性备份方式保存升级前数据库并验证完整性，不只复制仍在写入的 `.db` 文件。记录事件/检查点高水位、备份路径和原版本；把迁移 0052/0053 与格式变化的验证纳入同一上线清单。
3. 新版本启动后，在独立验收会话验证 Native 长输出/工具/回退与重启恢复，再验证 Claude Code/Codex 原生任务的顺序、说明、终态和待审批状态；开发合成样本不替代真实内核矩阵。
4. 需要降级时先停止新版写入，保留新版工作库及 WAL/SHM 或其一致性备份供核查，再在独立路径恢复已验证的升级前备份给旧版。升级后产生的新记录保留在新版备份中，不声称旧版会自动识别或保留这些记录。
5. 本批未增加增量转完整记录导出命令；不要临时删改 delta、改 hash 或移除状态字段来绕过恢复错误。物理回收继续走既有治理 dry-run、备份和单独确认流程。

## 15. 工具完整内容读取与诊断（2026-09-05）

- 工具卡展开后自动拼接完整输出并直接显示；超长结果只做本地截断提示，复制取已拼齐全文。助手正文仍可按需点“读取完整内容”分段阅读。此版没有流式完整导出按钮。
- 若提示内容已更新，当前片段是旧快照；点击“从头读取”重新取得版本。临时错误用“重试读取”，切换会话后旧请求不提交到新会话。
- 核对 Desktop/Runtime 均为同一构建，并支持 conversation.readContent。接口通过当前 conversation 绑定读取原 event/message/timeline 与 sidecar，不接受任意本地文件路径。
- 排查 content.not-found 时检查会话/任务/线程绑定与原记录是否存在；检查 sidecar 是否随备份一起恢复。不要通过改大 IPC 帧上限、跳过来源校验、删除版本参数或重造一份任务清单掩盖问题。
- 本批无数据库迁移。部署仍执行第 14 节的一致性备份、0052/0053 与增量格式回滚门槛；历史清理保持 dry-run/维护确认，清理原记录或 sidecar 可能使既有完整内容引用失效。
- 页面复核：展开带预览的工具卡确认没有完整读取；点击后检查前后段/重试/切换会话；820×740 检查分页按钮完整可见、文本独立滚动。完整发布验收还要覆盖真实 Claude Code/Codex/Native，而非仅使用隔离组件 fixture。

## 16. 文件差异分页与原文读取（2026-09-05 审查续记）

- 聊天展开文件卡或右侧审阅选中文件时，仅显示预览入口。点击“读取差异”取得附近一页，用“文件开头/上一页/下一页”逐页阅读；万行文件不一次挂载全部差异。
- 超长行通过“本行已缩略 · 读取完整行内容”进入对应修改前/后来源，再点击“读取完整内容”；有版本分段保持原文偏移。修改前/后也可独立读取。现有复制入口复制预览或当前片段，没有全文件流式导出。
- “文件快照已更新”时旧页保留，续页停用；“重新读取差异”获取新版本。临时失败使用“重试差异”。切换会话后旧页不进入新会话；审阅必须从原会话打开。
- 只有替换片段、缺少历史快照或写前快照已截短时，不展示推测出来的完整差异；复杂变更超出精细预算会明确按整段替换呈现。未知行数显示“按需计算”，不代表零变更。
- Desktop/Runtime 都需支持 conversation.readFileDiff；接口只接受受限历史来源或小内联文本，不接受任意磁盘路径。诊断 content.not-found 检查原会话、线程与源事件，version-changed 应重新读取，勿去掉摘要或作用域校验。
- 页面复核：新建空文件/删除/普通修改；600 行密集短文本、万行单点修改、1.2M 单行；初始零次完整读取、分页/重试/版本变化、切换会话；1280×900 聊天与 820×740 审阅检查行号、键盘滚动、按钮和独立文本滚动。用真实 Claude Code/Codex/Native 做最终矩阵，隔离 fixture 不替代上线验收。
- 本批没有新迁移，实际业务进程尚未切换。部署/重启继续遵守第 14 节的活动运行、备份、0052/0053、成套版本与增量格式回滚门槛；物理清理仍是单独确认维护操作。

## 17. 总过程分页的开发验证与当前发布门槛（2026-09-05 审查续记）

- 当前单轮过程分页已接入，整合尚未收尾：默认会话汇总审阅仍混用了最后一轮游标。完成独立会话文件目录与多轮/同路径/重启验证前，不把本批构建切换到业务窗口。
- 单轮复核：5000 个不同工具步骤与 120 个文件；展开执行过程或文件卡，确认每页至多 40 项、总数不缩水；依次前后翻页，完整参数仍可打开，清洁页仍显示全程失败数。
- 读取期间追加事件：旧版本续页提示更新并保留当前页，“重新读取”取得新版本；临时错误再次翻页可重试。会话切换取消旧消费者，错误会话被拒绝，真实 Runtime 重启后同源版本可继续。
- 审阅 820×740：页控位于展开区域内，列表有界；行号/符号/正文处于同一行。检查返回同一工具时保留展开意图，进入另一工具时不套用原状态。
- 单项 history.item-too-large 与会话目录来源错配属于尚待治理的问题，不通过增加帧上限、去掉版本/来源校验、删除旧轮或默认预取全部页规避。原第 14 节备份、0052/0053 和成套更新/回滚门槛保持。

## 18. 会话目录与单轮分页开发验收（2026-09-05 审查续记）

17 节的会话汇总来源缺口已由 TD-070 补齐。当前改动仍在开发工作树，业务 Runtime PID 33492 未切换；先做完整发布前门禁，不以此记录当作已上线。

1. 同一会话创建两轮文件变动，总数超过 40，且两轮操作同一路径。进入工作区文件页，默认“所有文件”不请求对话目录；选择“对话文件”自动拼齐整个会话清单，不显示“下一页文件”。
2. 清单应覆盖两轮文件且无遗漏；点击“审阅会话文件”进入会话范围，单条消息“审阅文件”仍是本轮范围，二者标签不互相覆盖。会话审阅标题为“最近一次变动”，表示该路径最后一次操作的前后快照，而不是累计净差异。独立审阅同样一次列出全部文件。
3. 不展开差异时正文读取次数保持 0；点击“读取差异”验证确切历史内容。新变动追加后读取失败保留已加载内容；“重新读取文件”从新版本开头重新拼齐。
4. 注入临时读取失败后内容保留且可重试；切换会话不接纳旧响应；检查 820px 和键盘操作。关闭并重新打开 Runtime/数据库后可重开已保存的会话审阅标签。
5. 新建文档立即在 `notes/未命名文档.md` 落盘（空正文，重名递增），打开后状态为“已保存”，编辑后显示“保存”；聊天单轮文件卡仍可分页。
5. 发布需要一致性备份与空间检查，再应用 0052/0053/0054 并成套构建、切换 Desktop/Runtime；记录更新/回滚和 Claude/Codex/Native 矩阵。0054 新建索引仍会消耗磁盘和构建时间，独立小库通过不是业务大库时间承诺。

验证命令沿用项目 test 脚本（Desktop 默认 15 秒超时）；Desktop 全量可使用 --maxWorkers=2 --minWorkers=2。直接 exec vitest 的默认 5 秒与项目脚本不同，本轮曾触发既有浏览器桥测试超时。最新全量结果与隔离 UI 截图见审查 18.9；物理历史清理仍是另行确认的维护操作。

## 19. 未知大事件与 Pi 执行门控验收

1. 使用独立数据库/唯一管道构造合法 tool.completed：短命令、失败结果、超过 1MiB 的未知 vendor 字段。检查实时和回放均有该事件，过程保留失败状态，且展示引用的字节/UTF-16 长度与完整公共来源一致。不要提高帧上限。
2. 在实际步骤卡与内联过程中展开“事件详情”：展开后自动读取并拼接完整内容，不再出现“读取完整内容 / 上一段 / 下一段”。关闭并重新打开 Runtime/数据库可按原版本继续。完整来源包含 vendor 结束标记，不含私有 Run 正文或增量；错误会话、版本和代理对中间 offset 应拒绝。
3. Pi 未安装时允许准备安装；安装完成保留版本并显示“执行尚未接通”，菜单禁用且没有可用绿色高亮。已保存 Pi 的会话和新对话发送草稿均保留，不创建空会话、不写消息或 Run。直接向 Runtime 提交 Pi 也应在副作用前返回原因。
4. 恢复保留 Pi 的暂停/阻塞目标，状态和计数不变；Native、Claude Code、Codex 的正常选择继续可用。这里只验证门控，真实执行能力另按内核矩阵验收；不新增 Pi 适配器。
5. 检查 820px：菜单原因可读、步骤阅读器可翻段、页面无横向溢出。保存浏览器异常日志和实际 IPC 请求，不以快照/源码字符串测试替代交互。
6. 当前发布前置条件仍是一致性备份、容量评估、0052/0053/0054 成套迁移与 Desktop/Runtime 切换，以及真实内核/更新/回滚矩阵；此批只运行隔离服务并关闭自有资源。业务历史没有回收。

最终脚本结果为 Runtime 192/1416、Desktop 250/2032、Storage 46/470、Protocol 21/95、Shared 13/53。隔离基准：3.20MB 事件投影为 21,848B，20 次投影 p95 7.47ms；完整来源暖段 p95 21.90ms，最大内容 JSON 43,881B。每段仍解析/哈希源，非整窗/业务库指标。日志、截图和遗留项见审查 18.10。

## 20. 长正文原文与完整操作开发验收

1. 独立 SQLite/唯一管道创建超过 1MiB 的 canonical text/thinking 与守卫内约 200KB 用户正文。检查默认消息/锚点页只返回预览与精确来源，原存储不变，八条 200KB 正文不再多次缩页；大元数据仍执行原帧预算缩页。
2. 发送单次巨大 textDelta + timeline：交付有界 process 帧，不重复巨大根字段。重连 snapshot 也有界；结束并重开 Runtime/数据库后，按原版本读取来源尾部。跨会话及版本/非法偏移必须拒绝。
3. 实际 ChatView 初次显示、刷新、展开思考时完整读取计数为 0。点击“读取完整内容”后显示“原文分段”，前后段带版本，当前段折行且有界；生成中的正文只显示预览。503 保留旧段并支持重试。
4. 消息“复制”读取整份回答，不能只复制预览；对源码与剪贴板检查长度、结尾、SHA-256，单独记录 Windows 的 LF→CRLF 转换。重新生成发送完整原始用户文本；源失败不发送，切换会话取消晚到结果，连续点击不并发重复读取。
5. 检查 1100px 与 820px、无页面横向溢出、当前正文节点/高度有界、过程无新增打字光标；预览中的交互嵌入不执行。当前结果 Runtime 192/1421、Desktop 252/2051、Storage 46/470、Protocol 21/95、Shared 13/53，构建与 lint 通过，Desktop 19 个既有 Hook 提示。
6. 这些是开发夹具门禁，不替代业务库容量/备份、0052/0053/0054 成套发布、实际内核与更新回滚矩阵。没有 canonical 来源的旧正文、超限用户输入和其它响应元数据预算继续独立验收。原文分页还会重复解析/哈希完整源，不是常量开销读取。

本批日志和截图入口见审查 18.11；没有重启业务 Runtime 或迁移业务库。自有 UI 测试服务应在记录证据后关闭，并仅清理经路径校验的自身临时 SQLite 目录；DYMud0 遗留不在本批清理范围。

## 21. 旧消息恢复与原文缓存验收

1. 在独立数据库构造两类旧最终消息：移除旧 canonical metadata/兼容块引用但保留完整 timeline；或只留下 text-only 截短块，同时保留唯一终态全文。实际消息页应恢复正确来源，保持旧 blocks 不变。没有可验证来源时保留截短标记，不生成假全文。
2. 检查新消息已有引用时零恢复 SQL；旧段 kind/sequence/phase/前缀错配不恢复；event-prose 仅允许终态的 assistantText / run.assistantText，跨会话、私有字段、非终态均拒绝。
3. 同一来源连续翻段只准备一次；同连接/外连接更新、DDL 及读中发生提交应重新读取或报版本变化。外层事务读到的未提交正文在回滚后不得进入缓存。检查 8 项/16MiB 字符串估算、超大绕过和原始 UTF-16 单元。
4. 实际 ChatView 打开旧消息，默认不发 readContent RPC；点击完整内容、翻段、完整复制并核对哈希，820px 不溢出。单独说明 Windows 剪贴板换行转换；原文恢复仍有底层 Worker 核验成本。
5. 唯一管道关闭并重新打开 Runtime/数据库后按旧版本续读；数据改变后旧版本拒绝。不同 thread/run 绑定不得因缓存复用而读到旧私有数据。
6. 本批 Runtime 192/1423、Desktop 252/2051、Storage 47/485、Shared 14/56、Protocol 21/95 全量通过；两个来源的隔离同源缓存 p95 0.243/0.294ms，事务绕过约 20.605/23.049ms。完整复制交互各一次约 216/210ms，不是整窗或内核 p95。

证据、测试抢跑修复和剩余边界见审查 18.12。只关闭本批自有服务，不切换业务 Runtime；备份、容量、0052/0053/0054、真实内核与更新回滚仍属于最终发布门禁。

## 22. 输入提交与失败草稿验收

1. 在隔离库构造合法线程，发送短消息，确认用户消息、任务版本和消息事件同提交；历史正文与输入相同。用汉字加 ASCII 余数构造恰好 262144 字节的 blocks JSON，确认无损保存，并保留 100,000 UTF-16 入口上限。
2. 发送 90,000–100,000 个汉字，或合法长度但 JSON 转义后超预算的文本，确认收到明确拒绝、任务版本/消息/事件不变、运行准入和执行均未调用。技能快照与文本必须一同计入预算。
3. 注入 createFinalMessage 写错及消息写入后的任务版本写错，确认返回 storage.write_failed 且事务回滚；不要将既有旧运行的提前取消包含在本批原子性声明里。
4. 页面测试：成套更新后打开任意测试会话，短消息可发送/回显。粘贴超过字节预算的中文正文，发送失败后输入保持原样；发送等待时编辑新稿再拒绝提交，新稿保持、点击“恢复未发送草稿”追加原稿和去重附件。
5. 页面异常边界：按真实 ShellApp 的 conversation.id key 卸载/重建 ChatView，等待提交时切换会话，拒绝旧提交后新会话不显示旧稿；返回原会话可恢复。再验证先返回原会话、后拒绝旧提交，当前新编辑保持且恢复入口实时出现。验证 820/1100px、键盘可操作恢复按钮、没有横向溢出。草稿快照仅当前窗口进程生命周期内保存，重启不属于本项持久化验收。
6. 本批全量 4125 项、构建/typecheck/lint 通过；Desktop 保留 19 个既有 Hook 提示。真实 ChatView/合成 IPC/生产 CSS 证据为 append-draft-remount-evidence.json 与 append-draft-keyed-820.png，见审查 18.13；不是业务窗口/内核验收。

业务 PID 33492 本批未切换；0052/0053/0054、容量检查、一致性备份/恢复、Desktop+Runtime 更新与回滚仍需成套执行。只关闭自有验证服务，业务历史未清理。

## 23. 插队提交边界验证（2026-09-06）

- 定向命令：pnpm --filter @sync-think/runtime exec vitest run src/append-message-boundary.test.ts；最终21项通过。pnpm --filter @sync-think/runtime test 最终193文件/1444项通过，pnpm build 为11项构建通过。
- 真实 SQLite 故障注入位于隔离夹具，不对业务库模拟写失败。失败时旧运行/审批/历史/版本/检查点保持；成功后旧 partial 排在新 user 前，决定只发一次，异步期间其它运行不丢失。
- 业务窗口需补：待处理需求的插队成功保留原执行轨迹；超限插队不打断原运行；有效审批与重启失效分别有明确结果。协议集成回归不是实际 native/Claude/Codex 验收。
- 本次本机切换、双备份和独立回退基线证据见部署文档“本地开发窗口成套切换”，保留原 dev-0001 和数据库位置。

## 24. 失效审批与原请求恢复验收

1. 使用隔离审批请求和真实SQLite，断开原等待后调用listPendingToolApprovals；检查最近20条expired摘要、完整expiredCount、stale-approval原因，摘要中无工具参数/命令/授权范围。再次列表/决定返回同一失效事实。普通手动deny不归类为expired。
2. 在相同thread/run下准备唯一user消息，核对requestMessageId；缺失/多个user不猜测。前端不为每张失效卡预读正文或图片。
3. 编辑区先输入新稿，再点“重新编辑原请求”：读取准确消息的完整正文、原图和技能，保留当前内容；UI没有批准按钮，恢复本身不调用appendMessage或决定接口。仅显式发送新请求；提醒原运行可能已有部分副作用。
4. Main图像IPC校验conversationId/messageId/runId/imageId及原user归属，仅使用存储引用；测试错run、错image、路径穿越、缺图/空图/超预算、读取句柄释放。525000B原始读取和700000字符dataURL限制；前端最多8图，不抓取图片URL。
5. 读取挂起时重复点击、继续编辑、切换会话，确认无旧稿污染；任何原文/图片错误都保持当前草稿。检查820/1100px浅/深色和资源/控制台错误；真实内核矩阵与合成IPC实测分开记录。
6. Node20路径置于PATH后运行：pnpm --filter @sync-think/desktop exec vitest run src/main/approval-request-images.test.ts src/renderer/shell/ChatView.tool-approval-reconnect.test.tsx src/renderer/shell/approval-request-recovery.test.ts；以及Runtime approval-recovery、tool-approval-read-model和Storage message-store回归。
7. 本批全量4164项、最终22项定向、11项构建通过。Storage并发压力首轮既有回滚测试超时/EBUSY，串行完整488通过，失败证据保留；不要用扩大超时掩盖资源问题。实测详情和边界见审查18.16及.data/expired-approval-rendered-qa.json。

## 25. 原生任务历史回看验收

1. 打开已有成功原生清单、随后开始空轮次的会话，点击编辑区上方“历史任务”。当前面板保持当前轮次语义；历史默认最近已确认清单，完整说明来自原生记录。旧记录缺description时不补写。历史in_progress显示“记录时进行中”，不自动恢复执行。
2. 准备45项详细任务与12个有确认记录的轮次：内容40→5→40、轮次10→2→10往返；同sequence且大小写不同runId的历史保持确定顺序。显式清空有独立提示，失败/仅请求无成功快照；Claude跨轮TaskUpdate保留原ID与描述。
3. 切换会话、关闭面板、刷新或读取挂起时重复点击，确认旧响应不污染新会话，初始不预读全部历史。来源版本变更后续页明确报错，刷新重新读取；单项超224KiB显示错误，不截断伪装完整。旧页读取失败仍保持已读内容。
4. 检查820/1280px、浅/深色及原生滚动条；正常关闭Desktop与执行所有者，确认无进行中运行后重启，历史应从持久事件恢复。关闭历史面板不删除任务或事件。
5. Node20置于PATH后定向执行：pnpm --filter @sync-think/shared exec vitest run src/task-plan-history.test.ts；pnpm --filter @sync-think/storage exec vitest run src/native-task-plan-history.test.ts；pnpm --filter @sync-think/runtime exec vitest run tests/conversation-content.test.ts src/task-plan-history-page.test.ts；pnpm --filter @sync-think/desktop exec vitest run src/renderer/shell/TaskPlanHistoryPanel.test.tsx。完整4202项、11项构建及lint已通过，Desktop18项既有Hook提示仍在。
6. 自动实测 .data/task-plan-history-electron-qa.mjs 使用现有Playwright Electron和生产Main/Preload/Renderer/Runtime/Worker，隔离profile/installId/SQLite；运行前核对构建和目标路径，正常停掉自己的实例再清理自己的夹具。Browser plugin not available；此脚本没有发送模型请求，真实三内核任务/审批/图片矩阵另验。
7. 业务核对只读源与新pipe API，原5项清单一致；单连接首次历史投影约92ms、10次暖读0.062–0.173ms、实际业务pipe单次约359ms，各自测量范围不同，均不作为整窗p95。冷miss仍在Worker重放该任务的过滤历史，缓存16MiB仅JSON估计，不等于完整进程堆预算。详情见审查18.17与task-plan-history前缀证据。

## 26. 三内核真实原生计划与会话续接验收

1. 在隔离Workspace/SQLite/installId中使用实际配置的上游模型，不预置成功计划事件；经生产Runtime的task.appendMessage发送。Native要求update_task_plan，Claude要求原生TaskCreate/TaskUpdate或TodoWrite，Codex要求原生update_plan；每项均带完整说明，状态分别completed/in_progress/pending。核对真实成功事件、当前任务和conversation.taskPlanHistory，不以模型回答“已创建”判定通过。
2. Codex创建和恢复会话必须显式tools.update_plan.enabled=true。对本机0.152.0，未配置时真实上游目录缺update_plan；features.goals=false不是修复，仅移除目标工具。当前实现只启用计划工具，保留goals和用户全局配置；错误试验日志留档。
3. 原会话下一轮不调用工具，要求回复独立口令；关闭并重开Runtime后核对历史清单完整一致，再要求原口令。明确区分同Node进程内Runtime对象重开、真实app-server进程重启和业务Desktop/Runtime成套重启。另重开修复前失败的原Codex会话，确认sessionId不变且可创建计划。
4. 手动窗口路径：模型菜单选择Codex → 请求“使用原生update_plan创建3项任务，每项写具体说明” → 当前清单出现描述与状态 → 新空轮次后点“历史任务”回看。Claude Code同样验证原生任务ID与描述；已有记录没有description时保持原样，不编造。
5. pnpm selftest:codex-persistent默认要求工具写读、成功终态、用量、同thread同/新进程续接与原口令。需要验证思考摘要时显式设置E2E_EXPECT_REASONING=1；没有reasoning不单独判成持久化失败，自定义首轮提示的工具项为not-requested。分项失败仍非零退出。
6. 本机一次性真实链路脚本为.data/kernel-live-runtime-qa.mjs（参数native/claude-code/codex），固定使用本机只读提供商元数据和现有密钥引用，真实模型调用会计费；移植前先核对源库、模型与路径。仅写隔离库，透明loopback观测不保存认证头或请求正文，实际扩展Host使用port0避免占用业务17373。它不是渲染UI、整窗性能或完整权限矩阵测试。旧会话脚本kernel-live-existing-codex.mjs只指向其先前失败的自有夹具。
7. 本批Runtime1462全量、31项定向及11项构建通过；三个实际内核各3轮和旧Codex恢复通过。详情审查18.18；审批/失效/图片/工具失败/取消/断连、其它模型/提供商与异常进程重启另验。临时QA目录保留，不对旧拒绝的清理动作换工具重试。


## 27. 真实审批、取消与独立Runtime进程退出验收

- 2026-09-06本批修复审批登记失败的隐形等待和关闭时运行收尾晚于数据库关闭；实现与证据见审查18.19、TD079。无需新迁移、依赖或生产权限配置变更。
- 可移植回归：Node20环境运行 `pnpm --filter @sync-think/runtime test tests/kernel-permission-durability.test.ts tests/kernel-run-shutdown.test.ts`。前者使用真实SQLite拒绝审批事件的trigger，后者用门闩证明关闭等待完整收尾；不是实际内核调用的替代证明。
- 本机一次性真实验收：`.data/kernel-live-approval-process-qa.mjs` 与 `.data/kernel-live-approval-owner.mjs`。依赖当前只读业务provider/model句柄、已安装内核、DPAPI和固定机器路径；不是通用启动脚本，不直接复制到他人环境。每场景独立会话/SQLite/工作区，浏览器扩展端口0，透明上游只记录目录与输入标记匹配，不记录凭证。
- 真实Native/Claude/Codex各5个场景通过；owner子进程正常关闭或精确句柄强制终止后等待真实exit再启动新PID。Codex使用工作区/TEMP之外的自有文件目标触发原生执行批准，事件名command_execution；平台重复文件工具仍省略。15项仅覆盖上述条件，不代表所有模型、权限模式或执行中取消。
- 核心区分：run.paused是等待中，不是最终结束；显式run.cancel产生持久deny，Native reason=run-aborted、外部内核=run-cancelled；真正失去等待者的历史审批返回expired/stale-approval。重复决定返回最初结果；迟到批准不执行。
- 首轮全量的3个旧模拟器挂起已按AbortSignal契约修正；MCP子进程断言随后定向/全量重跑通过，未修改MCP生产逻辑。最终Runtime1468项全量、lint和11项构建通过，结果在kernel-approval-*日志。

### 页面复核步骤（真实Electron完整矩阵仍待完成）

1. 打开：普通SYNC-THINK聊天页，选择要核验的Native/Claude Code/Codex内核。
2. 前置：独立测试会话、ask模式、无既有会话放行；使用自有测试目录。按内核选择确实需要批准的操作，不假设所有工作区写入都弹卡。
3. 操作：产生审批卡后只关闭/重开Desktop窗口（保留Runtime），核对原待审批项仍可回显；批准一次后核对精确文件内容与终态。
4. 输入：使用每轮不同文件名和固定短文本；另起测试请求分别拒绝、在待审批时取消，确认没有目标文件、没有迟到批准执行。
5. 预期：等待、明确拒绝、已失效状态不混淆；历史或失效项恢复原请求只进入草稿，必须显式发送。
6. 边界：独立测试Runtime进程异常退出/重开后核对过期提示和原请求恢复；不要用有业务活动的Runtime作强制退出夹具。补做图片恢复、当前草稿保护、跨会话隔离和执行中取消，不将此前合成IPC测试冒充本页实测。

## 28. 真实Electron审批、旧原请求恢复与测试隔离（2026-09-06）

- 仓库外证据根：C:/Users/ZHUZHE~1/AppData/Local/Temp/sync-think-optimization-qa-EvfgKK。kernel-window-live-qa.mjs按native / claude-code / codex执行；kernel-window-legacy-recovery.mjs直接复用原失败旧库。以Node20运行，使用现有Playwright Electron；Browser plugin not available。
- 实际生产Main/Preload/Renderer+daemon/Runtime、隔离SQLite/profile/installId、真实已配置deepseek-v4-flash。外部内核复制已安装版本到fixture/kernels，manifest路径及Runtime变量同根，核对入口哈希；业务manifest不动。仅复用系统保护的vault引用，前后核对原vault哈希，不持久化明文。
- 注意Main从数据库目录解析kernels，而Runtime支持环境覆盖。夹具混用两根会触发真实首次安装，不能把它解释为picker检查状态错误。所有最终外部内核夹具统一目录，没有修改检测API或生产权限以跳过安装。复制的内核、失败夹具、截图和日志保留在仓库外。
- Electron关闭验证等待主进程真实exit；daemon可能继承stdout管道，Playwright app.close等待管道结束不等于Desktop仍在运行。最终收尾先对精确自有安装ID请求daemon.stop，再退出Desktop；业务Runtime不参与强制退出测试。
- 最终Storage501/Runtime1469/Desktop2089全量4059项、Runtime/Desktop lint、11项构建通过；Protocol113/Shared62沿用，累计4234但非本批五包全量。JS首屏1,920,706B/全部2,739,124B；18项既有Hook警告保留。

### 页面复核步骤

1. 在独立ask测试会话选Native/Claude Code/Codex，用每次不同的自有文件路径发起需要批准的原生写入。等待65秒应显示“等待你的批准”，而不是长时间无输出；待批时文件不存在。
2. 只关闭Desktop再打开，保留Runtime；核对同审批ID，点击批准后才出现目标文件及精确内容。另起会话分别点拒绝和待批时点停止，目标文件均不产生，停止对应run.cancelled。
3. 仅对隔离自有Runtime测试异常退出，等待确切PID退出后重连新PID；旧卡显示已失效。点击“重新编辑原请求”，原文进入草稿且不新增user/run、不执行文件操作；用户显式发送才创建新请求。
4. 在原失败OQHDG1数据上先输入“保留本次新草稿”再恢复，逻辑正文应为现有草稿、两换行、原全文；原NULL run_id不回填。自动验证逐.cm-line取逻辑行，避免innerText对空行额外换行造成假失败。
5. 核对1280px与820px浅/深色、无横溢出和页面/控制台错误。最终12个真实窗口场景及旧源恢复均通过；深色class切换不代表偏好持久化，图片/执行中取消等仍独立待验。
6. 接下来补终态事实：请求未执行的文件不应显示“已更改”，expired后局部步骤不应继续显示运行中。当前已记录复现和双侧投影入口，尚未混称已修复。
