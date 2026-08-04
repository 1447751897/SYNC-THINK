## 2026-08-04：内部无签名闭测发布链最终收口

### Fixed

- Windows rollback watchdog 改由隐藏 detached `cmd.exe` 托管 PowerShell 5.1，使用裁剪后的环境变量传递受控路径；增加 ready marker、目标可执行文件投影、one-shot relaunch fence，并在 installer 退出后兜底拉起目标版本。
- Chromium network service 首次崩溃时，update-install probe 只对一次 `desktop.update.check-failed` 做有界重试；watchdog ready 的 fail-closed 等待预算从 5 秒调整为 15 秒，避免全仓负载下的假超时。
- update-install 清理命令对已退出 Runtime 保持幂等，并严格等待安装目录和对应卸载注册表键同时消失；handoff、native updater cache 备份和 watchdog 进程均纳入零残留检查。

### Verification

- `pnpm test:update-install:win` 从源码重建 portable 与两套 schema v3 `unsigned-fixture` installer 后通过真实 `0.0.1 -> 0.0.2`：单次安装、自动拉起、identity/safeStorage/metadata/ciphertext/SQLite 连续，2 次 blockmap、7 次 Range/HTTP 206、完整包 `130425065` bytes、实际传输 `556013` bytes、无整包 HTTP 200 回退。证据：`.data/update-install-e2e-20260804T064953/smoke-result.json`。
- recovery snapshot 包含 watchdog-ready、relaunch、target health 与 `healthy` outcome，`automaticRollbackAttempted=false`；测试结束后安装目录、卸载注册表、相关进程、handoff 和 cache backup 全部为 0。
- 默认内部闭测 installer 为 `apps/desktop/release/installer/SYNC-THINK-Setup-0.0.1-x64.exe`，`130425094` bytes，SHA-256 `9154fca844eb8855453f549998cb23dd005ce769051a40b96f72d9a542bf83fe`，manifest schema v3、`signing.mode=unsigned-fixture`。
- 最终门禁：`pnpm test` 20/20 tasks（Desktop 127 files / 852 tests）、`pnpm typecheck` 20/20、`pnpm lint` 11/11、`pnpm build` 11/11、portable contract 14/14、Phase 3 release/visual contract 41/41；`pnpm selftest:phase3` 9 步通过并保持 `passed-with-external-evidence-pending`。

### Remaining external evidence

- 正式 Authenticode/RFC 3161、正式签名故障注入 rollback E2E、真实 private feed/CDN、真实图片 Provider 凭证及 5-20 位邀请用户反馈；内部无签名闭测不依赖这些外部条件。

## 2026-08-03：Phase 3 本地门禁稳定性与发布自检收口

### Fixed

- 修复 packaged 首次启动身份锁在异步身份落盘完成前提前释放的问题；并发初始化现在只生成一套 install ID / pipe secret，并用延迟 secret-store 写入稳定复现竞态。
- Desktop 测试统一使用 15 秒框架预算；Windows Desktop Host 的正常/畸形握手 fixture 使用 10 秒 capability 预算，20 ms 超时负例保持不变；Runtime bounded replay fixture 改为零节拍，保留 260-frame 窗口语义而不制造无意义 timer 压力。
- 将 `@tailwindcss/cli` 与 `tailwindcss` 限定为 Desktop build-time devDependencies，production deploy 从 294 个包降至 262 个包；portable verifier 同时拒绝 Tailwind build-only package 和 `.bin/tailwindcss*` 进入发布载荷。
- Windows 临时目录清理增加有界重试，消除 Electron/updater 句柄刚释放时的 `ENOTEMPTY` 抖动。

### Changed

- `pnpm test:update-feed:win` 现在从零执行根构建、显式 `unsigned-fixture` portable staging、schema v3 NSIS installer build，再运行 Generic feed 合同与真实 Electron HTTPS E2E；已有 fixture 可通过 `pnpm test:update-feed:prepared:win` 复用。
- `pnpm selftest:phase3` 增加独立 `prepare-update-feed-fixture` 步骤和 installer preflight 合同，缺失、legacy、篡改或非 `unsigned-fixture` 产物都会返回稳定错误和准备命令。

### Verification

- packaged identity 并发回归 8/8，Desktop 全量 127 files / 849 tests，Runtime transient 定向 8/8，根测试 20/20 Turbo tasks 均已通过。
- portable staging 连续两次通过；production packages 为 262，unsigned NSIS installer 为 `130561014` bytes，manifest schema v3 验证通过。
- 删除既有 `apps/desktop/release` 后，`pnpm test:update-feed:win` 可自行重建并通过 Generic feed 9/9 与 Electron HTTPS 8 场景，包括真实 installer 下载和 checksum mismatch。
- `pnpm selftest:phase3` 于 2026-08-03 完整通过 9 个步骤：Desktop contracts 12 files / 87 tests、release/visual contracts 33 tests、Generic feed、image provider build、无凭证显式 skip 和 Electron 7-case 视觉矩阵；聚合状态为 `passed-with-external-evidence-pending`。
- 最终 `pnpm install --frozen-lockfile` 通过；`pnpm exec turbo run test --force` 为 20/20 tasks、0 cached；`pnpm typecheck` 20/20、`pnpm build` 11/11、`pnpm lint` 11/11，`git diff --check` 通过。

### Remaining external evidence

- 正式 Authenticode 证书与 RFC 3161 timestamp、正式签名升级/自动 rollback E2E、真实 private feed/CDN 演练、真实图片 Provider 凭证验收，以及 5-20 位邀请用户 Windows 闭测。

## 2026-08-02：全部本地工程任务最终收口

- 完整通过 `pnpm selftest:phase3`：Desktop contracts 12 files / 86 tests、release/visual contracts 29 tests、Desktop typecheck/build、Generic feed Electron HTTPS E2E、image provider build 与 7-case Electron 视觉矩阵；无真实图片凭证时 live acceptance 显式 skipped，聚合状态为 `passed-with-external-evidence-pending`。
- 完整复跑根仓 `pnpm test`、`pnpm typecheck`、`pnpm build`、`pnpm lint` 和 `git diff --check`：Turbo 任务分别 20/20、20/20、11/11、11/11；Desktop 123 files / 836 tests、Runtime 63 files / 436 tests、Storage 36 files / 374 tests。
- 修复 `diagnostics-export-wiring.test.ts` 的格式脆弱字符串断言，并为 Generic feed Electron E2E 的所有场景生成、复制和显式传入最小有效 gzip blockmap，使 fixture 与生产 blockmap fail-closed 规则保持一致。
- 用全新 install id、SQLite 与 secure-store 路径启动可见 Desktop：隔离目录 `.data/manual-phase3-20260802-015614`，Electron PID `9296`、managed Runtime PID `50712`；pipe/database/hello 正常，stderr 为空，默认 `16873340928` bytes 数据库未触碰。
- 当前分支 `feature/newmax-shell-rewrite` 的累计修改仍未提交、未推送；当时剩余项包括正式证书/timestamp、真实 private feed/CDN、真实图片凭证、邀请用户与自动 binary rollback。自动 rollback 本地实现已在后续远端增量中补齐，正式签名 E2E 仍属于外部证据。

## 2026-08-02 · Phase 3 本地发布链与 Database Governance P0.4 收口

### Added

- Windows portable release 增加完整 publisher DN bootstrap；正式 installer 增加独立 expected signer SHA-1 与 publisher trust pin。
- Generic feed 增加 blockmap gzip 解压、JSON 解析和最小 schema fail-closed 校验；旧完整下载仅保留显式 `allowLegacyFullDownload` fixture 模式。
- 隔离 unsigned update-install E2E 记录 blockmap 请求、installer Range、HTTP 206、served/saved bytes、真实 NSIS 重启和 install identity 连续性。
- Database Governance P0.4 完成 fully-global low-value Event retention/archive、portable recovery segment、durable execute/rollback、cancel/resume、crash-window reconciliation、incremental vacuum 与 offline `VACUUM INTO` compaction。

### Changed

- `resources/app-update.yml` 改为 signing-mode 精确内容：正式 release 只允许 cache identity + 完整 publisherName，unsigned fixture 只允许 cache identity；verifier 使用字节级比较拒绝额外 provider、URL、Authorization 或 token。
- Authenticode 离线验证不再把 installer manifest 当作信任根；外部 signer/publisher pin 缺失、选择证书与 signer pin 不一致、SignerCertificate.Subject 非完整精确匹配都会失败。
- Database Governance 文档从“待实现 retention/compaction”更新为已完成 fixture-only 门禁；执行器继续不接 Runtime startup，默认约 16.87 GB 主库和历史备份保持只读。

### Verification

- Windows 发布脚本：portable/installer 22 tests 与 Generic feed 9 tests 通过；真实 unsigned portable/installer/blockmap fixture build + verify 通过。
- `pnpm test:update-install:win` 通过真实 `0.0.1 → 0.0.2` NSIS 安装复验：2 个 blockmap 请求、7 个 installer Range/HTTP 206、`135491101` bytes 完整包仅传输 `504941` bytes，节省 `134986160` bytes，且没有完整 installer HTTP 200 回退。证据位于 `.data/update-install-e2e-20260802T174113/smoke-result.json`。
- Database Governance 定向 5 files / 51 tests 通过，覆盖 archive round trip、rollback、cancel/resume、drift/tamper/path fence、incremental vacuum 与 offline compaction。
- 全仓测试、Phase 3 selftest 与最终隔离 Desktop 重启在本轮后续门禁中重新执行。

## 2026-08-02 · Database Governance P0.4 B4

### Added

- Event payload sidecar exact orphan mark manifest 与 quarantine sweep executor。
- 精确 confirmation token、maintenance window、durable audit、batch cursor、cancel/resume 与 crash-window recovery。
- 空计划、新增未标记 orphan、late junction、live/reference/blob drift、manifest/audit tamper 等负向覆盖。

### Changed

- Sidecar GC 复核全部已存在目录祖先，拒绝 symlink/junction/reparse point；audit bytes、状态和时间戳必须与 manifest cursor 精确一致。
- Governance CLI 增加 `--prepare-sidecar-gc` 与 `--execute-sidecar-gc`，sweep 只移动精确文件到 quarantine，不执行永久删除。

## 2026-08-02 · Database Governance P0.4 B2/B3

- 新增 durable Event payload backfill executor：blob-first、SQLite compare-and-swap、audit-last、portable SQLite + sidecar recovery set、批次边界 cancel/resume 与 crash-window 对账。
- 新增 recovery-backed exact rollback CLI 与 durable rollback audit；rollback 不直接删除 backfill blob，回滚后 orphan 交由 B4 exact mark/quarantine 处理。

## 2026-08-02 — Database Governance P0.4 第二切片 B1：Exact Event payload backfill dry-run

### 新增

- 新增 `event-payload-backfill.ts`：在单个 SQLite 只读事务快照中生成 V1 exact plan，固化 selector/projection builder、Database Maintenance fingerprint、精确 Event/reference 列表、sidecar manifest、容量估算与完整 plan hash。
- 新增 `context-packet-query-v1@1` projection builder；当前只允许 `context.packet.built`，默认阈值 64 KiB，仅保留固定 query-safe 标量字段。
- 新增 plan integrity/freshness 校验、JSON read/write，以及纯内存 `planEventPayloadSidecarWrite()`，确保 dry-run 与未来真实写入复用同一 hash/gzip/path/envelope 逻辑。
- 治理 CLI 新增 `--prepare-backfill-plan <plan.json>`、`--minimum-payload-bytes` 和必填 `--event-payload-sidecar`；与 `--prepare-manifest`、`--execute-manifest` 互斥。

### 安全边界

- 本子项只写计划 JSON；不更新 Event、不创建 sidecar 目录、不触碰 WAL/SHM、备份或真实 Runtime。
- freshness fence 会拒绝 Event 原地修改、新增匹配 Event、sidecar 引用集合漂移、destination reference 漂移、Database Maintenance fingerprint 变化与计划字段篡改。
- 第二切片 B 仍未完成；下一项为 durable batch cursor/cancel-resume，之后是 rollback 与 orphan mark/sweep。

### 验证

- 专项：6 files / 37 tests passed。
- Storage：typecheck、lint 通过；31 files / 315 tests passed。
- 临时 CLI fixture：1 个候选，SQLite 逻辑减量 6855 bytes、预计新增 sidecar 111 bytes，且未创建 sidecar 目录；fixture 已精确清理。
- 根级 typecheck 20/20、build 11/11、`git diff --check` 通过，仅有既存 CRLF→LF 提示。
- 最新隔离 Desktop：install ID `dev-governance-p04-backfill-plan-20260802-202443`，Launcher `43820`、Electron `54812`、Runtime `34924`；窗口响应，pipe/database/hello ready，stderr 为空。

## 2026-08-02 — Database Governance P0.4 第二切片 A：portable recovery set

### 新增

- 新增 `event-payload-backup.ts`：按 Event ID 排序捕获 sidecar 引用，生成 reference hash、唯一 blob 精确清单、引用计数和 portable `event-payload-sidecars.manifest.json`。
- recovery set 同时保存 native SQLite backup 与独立 `.sidecars` 目录；恢复验证会在 readonly SQLite 上执行 `quick_check(1)`、逻辑 fingerprint 比对，并从恢复数据库重扫引用、逐 blob hydrate、校验 hash 与长度。
- 治理 CLI 的只读 `--prepare-manifest` 支持可选 `--event-payload-sidecar <path>`。

### 变更

- Database Maintenance manifest/audit 升级到 V2，audit 记录 portable sidecar verification descriptor。
- 恢复集先在唯一 staging DB/目录中完整验证，再 rename 到固定路径；中途失败仅清理经过 path fence 的精确 staging/final 路径并写 failed audit。
- cancelled/failed resume 与 completed fast-return 前都会重新验证 SQLite + sidecar 恢复集；恢复点损坏不再被既有 audit 状态掩盖。
- Runtime 仍未启用 sidecar；真实主库和历史备份未修改。

### 验证

- 专项：3 files / 21 tests passed；Storage typecheck passed。
- Storage 全量：30 files / 308 tests；Storage lint/typecheck 通过。
- 根级 typecheck 20/20、build 11/11、`git diff --check` 通过，仅有既存 CRLF→LF 提示。
- 最新隔离 Desktop：install ID `dev-governance-p04-recovery-set-20260802-193044`，Launcher `17896`、Electron `25288`、Runtime `104628`；窗口响应，pipe/database/hello ready，stderr 为空。

## 2026-08-02 — Database Governance P0.4 第一切片：Event payload sidecar 协议

### 新增

- 新增 `packages/storage/src/event-payload-sidecar.ts`：V1 envelope、content-addressed gzip blob、SHA-256 去重、临时文件 + fsync + rename 写入，以及严格 hydrate 校验。
- 新增 Storage 测试覆盖默认内联兼容、大 payload 外置与 projection、内容去重、缺少 sidecar fail-closed、文件损坏检测。

### 变更

- `SqliteEventCheckpointStore` 可选接收 `sidecar/minimumBytes/shouldExternalize/project`；写入命中策略时在 `payload_json` 保存引用，所有 Event 列表 API 读取时还原完整 payload。
- `$syncThinkPayload` 设为 payload 保留字段；V1 复用现有 `payload_json`，未增加数据库 migration。
- 默认行为保持内联，Runtime 尚未激活外置写入；真实主库与备份未修改。

### 验证

- Storage Prettier、typecheck、lint 通过。
- Storage 全量：29 files / 299 tests passed。
- 根级 typecheck 20/20、build 11/11、`git diff --check` 通过。
- 最新隔离 Desktop 已启动：Launcher `98756`、Electron `17896`、Runtime `72624`；窗口响应，pipe/database/hello ready，stderr 为空。

## 2026-08-02 · Database Governance P0.3：精确 manifest、可恢复执行与备份 quarantine

- 新增 `database-maintenance-executor.ts`：从 P0.1 的共享候选语义生成 versioned exact manifest，记录 source fingerprint、稳定 `schemaHash`、完整 Event IDs、备份 name/size/mtime、protected 摘要、inspection hash、manifest SHA-256 与精确 confirmation token。
- 执行前依次校验 manifest 完整性、非截断候选、显式离线维护窗口、精确 token、writable connection、stale fingerprint 与 `quick_check(1)`；任何条件不满足均在恢复备份/DELETE 前停止。
- 使用 `better-sqlite3 backup()` 创建一致性 recovery backup，再通过只读连接验证 `quick_check`、schema hash、Event/Checkpoint count 与 max sequence。没有把物理 page count 或 backup 目标 schema cookie 误当作逻辑等价条件。
- Event 默认每 500 条、最大 5000 条单独事务删除；每个 exact ID 在 DELETE 时再次套用 candidate selector。候选后续变成受保护 Event 时 fail-closed，已删除 ID 在 crash resume 中按 already-absent 幂等处理。
- durable audit 在每批提交后原子写入，记录 recovery backup、游标、删除/缺失与 quarantine 计数；首次 Ctrl+C 只请求批次边界取消，cancelled/failed audit 可恢复，并拒绝 post-manifest 新 Event 或 protected schema/Checkpoint 变化。
- 历史备份不删除，按 manifest 精确身份移动到 `<backups>/quarantine/<planId>/`；源/目标 name、size、mtime 变化或状态歧义均停止执行。
- `pnpm db:governance` 默认继续 readonly + query_only；新增 `--prepare-manifest` 只读准备模式，以及必须同时提供 `--execute-manifest`、精确 `--confirm`、`--maintenance-window` 才可进入的执行模式，另支持 `--batch-size`、`--audit` 与 `--json`。
- 验证通过：专项 3 files / 16 tests；Storage 全量 28 files / 294 tests；Storage typecheck；根级 typecheck 20/20、build 11/11。隔离 CLI fixture 实际完成 1 条 telemetry 删除、verified recovery backup 与 completed audit。
- 当前约 16.87 GB 主库和 76 个历史备份保持原状；P0.3 尚未在真实数据上执行，也没有把维护动作接入 Runtime 启动路径。
- 最终根级门禁在最新源码上复跑通过：typecheck `20/20`、build `11/11`、`git diff --check` 无错误；最新构建已使用独立数据库重启，隔离身份 `dev-governance-p03-final-20260802-181957`，Electron PID `26856`、Runtime PID `103748`，窗口响应且日志 stderr 为空。

## 2026-08-02 · Database Governance P0.2：Checkpoint cadence、原子 fallback 与可恢复 replay

- Runtime 新增集中式 Checkpoint policy：默认每 128 个 durable Event 创建一次 Checkpoint；`run.completed`、`run.failed`、`run.cancelled`、`run.paused` 四种终态始终强制写入，恢复后从最近 Checkpoint 的真实 sequence 继续 cadence。
- 稀疏 Checkpoint 不再依赖逐事件快照保存执行游标；推进 Run 的非终态 durable Event 会携带精简 `payload.run` 投影，Event replay 可恢复 `nextAdapterEventIndex` 等状态，同时继续移除 Skill 正文、Context Snapshot、图片 data URL 与 MCP dispatch。
- fallback continuation 现在把 `run.fallback.selected` 与对应 `context.packet.built` 放进同一个 SQLite transaction；只有提交成功后才更新内存投影和发布事件。
- continuation 增加当前 projected Run 的 `modelId + packetId` fence；相同 fallback 已落库时直接复用 continuation，不再重复追加 Event。
- SQLite 回归确认单次 fallback 只生成 1 条 `run.fallback.selected`，Context Packet 总计 2 条（初始 + fallback），两条 fallback transition Event sequence 相邻，短 Run 只在终态生成 1 个 Checkpoint。
- 验证通过：Checkpoint policy 8/8；核心专项 4 files / 22 tests；Runtime 全量 63 files / 431 tests；根级 typecheck 20/20、build 11/11 与 `git diff --check`。P0.2 不删除、迁移、压缩或 VACUUM 当前约 16.87 GB 主库及 76 个历史备份。
- 最新构建已重启供人工测试：Electron main PID `13804`，managed Runtime PID `52428`；pipe/database/hello ready，窗口可见且响应，stderr 为空；日志位于 `.desktop-governance-p02.out.log` / `.desktop-governance-p02.err.log`。

## 2026-08-02 · Database Governance P0.1：只读诊断、Codex 分层参考与安全 dry-run

- 新增 `database-governance.ts`：输出 v1 数据库报告、文件/WAL/page/freelist、表行数、Event/Checkpoint 范围、备份预算、findings 和 v1 dry-run maintenance plan。
- quick 模式通过 `event_task_idx`、`event_ws_seq_idx`、`checkpoint_run_seq_idx` 做窄索引统计，并以最多 4096 个均匀 rowid 采样定位主导事件类型；不读取/解析 `payload_json`。
- deep 模式把 category/type/scope/payload bytes 合并为一次 SQL 聚合；物理 `dbstat` 额外受 `--physical` 控制，避免 411 万页数据库的页枚举进入默认路径。
- dry-run 只把完全无作用域的低价值 telemetry/diagnostic 列为候选；所有 durable Event、Checkpoint 和最新迁移备份保持 protected。P0.1 没有 DELETE、UPDATE、VACUUM、文件移动或备份删除代码。
- 新增根命令 `pnpm db:governance`，默认打开 readonly + query_only 连接；支持 `--db`、`--backups`、`--deep`、`--physical`、`--json`、`--backup-keep` 与 `--backup-max-bytes`。
- 真实开发库 quick 结果：Event 1,986,942、taskless 1,986,820、Checkpoint 1,986,492、备份 76/100.93 GiB；4096 样本中 `context.packet.built` 与 `run.fallback.selected` 各约 49.1%。
- Codex 本机只读观察确认：thread SQLite 是小型查询投影，完整上下文位于按日期分区的 rollout JSONL；归档物理移动文件；logs/goals/memories 拆库；WAL、migration、backfill、partial index 与 logical cleanup/physical compaction 分离。
- 新增 4 项专项测试，覆盖 candidate/protected 分类、dry-run 零写入、quick 无 payload/dbstat 扫描、readonly query_only 和 Checkpoint 真源保护。
- 收尾验证通过：Storage 26 files / 282 tests、数据库治理专项 4/4、根级 typecheck 20/20、根级 build 11/11；Desktop 最新构建冷重启后 pipe/database/hello ready，真实 quick 复核仍为 Event 1,986,942、Checkpoint 1,986,492、备份 76，且未执行任何数据或文件变更。

## 2026-08-02 · Windows Distribution P0.3.4：differential update 与 publisher trust pin

- `pnpm test:update-install:win` 使用真实 packaged Desktop、electron-updater 与 NSIS 完成隔离 `0.0.1 → 0.0.2` 安装，并验证 blockmap/Range/206、served bytes 小于完整 installer、重启后的 package/registry version 与 install identity/SQLite 连续性。
- 正式 portable 与 installer 发布要求完整 publisherName；installer 额外要求独立 expected signer SHA-1，构建时证书选择器与离线 trust pin 职责分离。
- unsigned fixture 显式忽略机器中残留的正式签名环境变量，避免本地/CI fixture 被外部环境污染。

## 2026-08-02 · Windows Distribution P0.3.3：HTTPS 真实 NSIS 下载 E2E 与更新控制台重设计

- `设置 → 关于` 的 updater 区域重设计为“桌面发布通道”控制台：清晰呈现当前/目标版本、channel、SHA-512、检查/下载时间、三阶段流程、下载进度和稳定错误提示；当前唯一可执行动作保持唯一主按钮。
- 更新控制台新增 idle、available、downloading、downloaded、disabled 与 checksum mismatch 共 6 项 Renderer 测试，并补齐窄窗口响应式与 reduced-motion 行为；feed URL、token、header 与本地下载路径仍不进入 Renderer。
- updater driver E2E 从 loopback HTTP 升级为受控 HTTPS。测试启动时生成短期自签证书，只在 electron-updater 专用 session 中接受 `127.0.0.1 + 精确证书`；其他证书判断继续拒绝，不使用全局 TLS 降级环境变量。
- 新增真实 NSIS 下载场景：通过 HTTPS + Bearer 请求下载现有 `107893840` bytes installer，验证 progress、downloaded、缓存大小与 SHA-512；原 7 个版本/channel/hash 场景继续保留，当前为 8/8。
- 本切片关闭“受控 HTTPS + 真实 installer 下载”门禁；下一步仍是隔离安装根上的真实 `quitAndInstall()`、应用重启后版本/身份/数据库连续性，以及 Authenticode、失败回滚与闭测发布清单。

## 2026-08-02 · Windows Distribution P0.3.2：Generic feed E2E、版本矩阵与 SHA-512 验收

- 新增确定性的 Windows Generic feed metadata 生成/校验模块，固定输出 channel `.yml`、单一 NSIS `.exe`、size、SHA-512、legacy path/hash 和 release date，并拒绝非法 SemVer、channel 与越界 artifact path。
- 新增真实 Electron loopback E2E：当前 Desktop updater driver 携带 Main-only Bearer header 请求 feed，覆盖同版、低版、高版、非法版本和 channel mismatch。
- 正确 SHA-512 的完整 installer fixture 可产生 progress/downloaded 并落入隔离 updater cache；篡改 SHA-512 的下载被 `ERR_CHECKSUM_MISMATCH` 拒绝。
- Controller 将 channel metadata 缺失、无效 metadata/version 和 checksum mismatch 映射为稳定、无秘密的 Renderer 错误码，不暴露 URL、header、下载路径或 Provider 原始错误。
- 新增 `pnpm test:update-feed:win`；专项验证为 Desktop 13/13、feed 4/4、Electron E2E 7/7。真实 HTTPS feed、真实 NSIS 重启安装、Authenticode、差分更新和自动回滚仍未关闭。

## 2026-08-02 · Windows Distribution P0.3：私有 updater 控制面与安全投影

- 引入 `electron-updater@6.8.9`，新增 Main-only 私有 feed 配置解析、Generic provider driver、手动检查/下载/安装控制器和稳定状态机；未配置 feed 时默认不访问网络。
- feed 只接受 HTTPS 或 loopback HTTP，禁止 URL 内凭据、query/fragment；channel 和 token 做长度/字符/CRLF/空白校验，Bearer token 不进入 Renderer、日志、发布 manifest 或 updater bootstrap 文件。
- 新增 `desktop:update-*` Main/Preload IPC 与安全状态订阅，所有 invoke handler 继续执行 trusted renderer source assertion；Renderer 仅获得 bounded `DesktopUpdateSnapshot`。
- `设置 → 关于` 新增当前版本、通道、检查更新、下载进度与“重启并安装”入口，移除硬编码开发版本；错误只显示稳定本地化文案。
- 安装前等待 managed Runtime 与 Desktop 服务受控退出；关闭自动下载、退出自动安装、降级、Web installer 和 differential download，真实 feed E2E 完成前保持完整 installer 下载。
- portable staging 生成只含 `updaterCacheDirName` 的 `resources/app-update.yml`，发布 verifier 对缺失配置 fail-closed；新增 controller、UI、source wiring 和 portable release 回归测试。
- 真实 Desktop 重启捕获并修复 electron-updater CommonJS/NodeNext ESM named export 兼容问题，driver 改用 default import；隔离 Desktop 与 managed Runtime 已通过 pipe/database/hello 冷启动。
- 本切片只关闭 updater 控制面与安全投影子项；Authenticode、真实私有 feed/下载校验 E2E、版本兼容、差分包、自动失败回滚和闭测清单继续保持 open。

## 2026-08-02 · Windows Distribution P0.3：品牌图标与 production deploy 稳定性

- 新增确定性 Windows 品牌资产管线：以 `apps/desktop/build/icon.svg` 为真源，生成 512px PNG 与包含 16-256px 九档尺寸的 ICO，并提供 `release:assets:win`、`release:verify:assets:win`、`test:brand:win`。
- Desktop `BrowserWindow`、portable `SYNC-THINK.exe`、NSIS installer/uninstaller 与快捷方式统一使用同一品牌资产；portable EXE 通过 `resedit` 写入真实 icon group。
- `release:stage:win` 增加品牌资产生成/校验，portable layout 与 installer verifier 同步校验 packaged `build/icon.ico` 和 `build/icon.png`，electron-builder 显式配置 `win.icon`、`installerIcon` 与 `uninstallerIcon`。
- production deploy 从 pnpm legacy deploy 切换为 `node-linker=hoisted + inject-workspace-packages=true` 的现代 deploy，并要求经过 release child fence 的绝对目标，消除 Runtime package 旁的嵌套 `.bin` sidecar 与后续 smoke 的 `EPERM`。
- 正式 installer 更新为 `107893840` bytes，SHA-256 `02091882666B30D5B69EC50ADF250A2C9264D50F788C8BC348F28CD019CBF942`；品牌 4/4、portable 6/6、installer 7/7、root build 11/11、双 verifier 与完整 lifecycle smoke 均通过。
- Windows Distribution P0.3 已完成压缩、品牌图标与 production deploy 子项；剩余 Authenticode、私有 updater feed、differential package、失败回滚和闭测发布清单。

## 2026-08-02 · Windows Distribution P0.3：installer 压缩与 artifact 体积优化

- installer build CLI 新增严格 `--compression store|normal|maximum`，默认值读取 electron-builder 配置；非法模式使用稳定 `installer.compression_invalid` 错误拒绝。
- `installer-manifest.json` 升级为 schema v2，新增 compression、portable source bytes、build duration 与 artifact reduction 指标；verifier 会拒绝旧 schema、非法压缩模式、无效源体积/耗时和被篡改的 size metrics。
- 在独立 release 子目录实测 `normal` 与 `maximum`：两者均把约 519 MB portable 压缩为约 107.18 MB installer，输出只差 1 byte，因此正式配置从 `store` 切换到 `normal`，保持较低复杂度且不牺牲实测体积。
- 正式 unsigned artifact 更新为 `107177118` bytes，SHA-256 `FE30B55FC4FF49300511A658B19E1E6041CA20784E14F89405A4D43F80D40985`；相对上一 `521182347` bytes artifact 减少约 `79.436%`。
- 新压缩包已通过 portable 6/6、installer 7/7、root build 11/11、manifest verify，以及 clean / overlay / 真实版本 upgrade / uninstall / reinstall 完整 smoke。
- P0.3 体积/压缩子项关闭；Authenticode、品牌图标、私有 updater feed、差分包和闭测发布清单继续保持 open。

## 2026-08-01 · Windows Distribution P0.2：NSIS installer 与安装生命周期验收

- 引入 `electron-builder@26.15.3` 和固定 NSIS 配置：`appId=com.syncthink.desktop`、per-user assisted、可选安装目录、桌面/开始菜单快捷方式；卸载默认保留 userData、Install ID、safeStorage 密文和 SQLite 数据。
- 新增 installer build/verify manifest 与 6 项脚本测试；正式 unsigned artifact 为 `SYNC-THINK-Setup-0.0.1-x64.exe`，大小 `521182347` bytes，SHA-256 `2D34A128F1F21DEE0130D95BF12F54D329A7902D404C780D97D30289F09F5469`。
- portable staging 新增严格 `--version` 覆盖并同步 payload package version，用真正的 `0.0.2-smoke` 应用验证升级；Windows direct Node invocation 使用受控 `cmd.exe /d /s /c pnpm.cmd` fallback。
- 修复 owned release 递归打包：production deploy 后剪除自有 package 的 `release` 与 `scripts`，forbidden scan 同步拒绝，避免旧 installer/portable 被再次打进 staging。
- 新增 `scripts/windows-installer-smoke.ps1` 与根命令 `release:smoke:installer:win`；每次使用唯一隔离根，自动执行 clean、overlay、upgrade、uninstall、reinstall，并输出结构化 `smoke-result.json`。
- 真实自动 smoke 全通过：`0.0.1 → 0.0.2-smoke` 的 package/registry version 正确，身份、密文和数据库持续一致；卸载移除 executable 并保留用户数据，重装恢复同一身份。
- smoke 脚本兼容 Windows PowerShell 5.1，并处理空日志、运行态 SQLite 文件锁和启动阶段失败的精确进程清理，不递归删除已有 smoke 根目录。
- 验证通过：release 6/6、installer 6/6、Desktop focused 10/10、Desktop typecheck、build 11/11、portable/installer verify、全仓串行 20/20 tasks 与 diff check。Windows Distribution P0.2 关闭，后续进入签名、品牌图标、私有更新 feed、差分包和体积优化。

## 2026-08-01 · Windows Distribution P0.2：packaged install identity 与 pipe credential

- 新增 packaged install identity：首次启动生成稳定 install ID 与高熵 pipe secret，metadata 使用 lock、临时文件和原子 rename 落盘，并发初始化只产生一份身份。
- pipe secret 通过 Electron `safeStorage` 与现有 SecureStore 加密保存；metadata、日志、Renderer、SQLite 与 release manifest 都不包含明文 secret。
- Desktop Runtime client 与 managed Runtime child 统一使用同一内存 identity；packaged 强制 token authentication，development 保留显式环境变量覆盖与 `dev-0001` no-token 默认值。
- metadata 损坏或 secret 解密失败使用稳定错误码并 fail-closed，不自动生成新 secret，避免身份静默轮换与 Runtime 认证漂移。
- 两轮真实 packaged 冷启动通过：install ID、secret handle、metadata/ciphertext SHA-256 全部稳定复用；pipe/database/hello 正常，无认证、解密、EADDRINUSE 或 secret 日志泄漏。
- 验证通过：Desktop 111 files / 776 tests，identity/supervisor/release targeted 15 项，Desktop typecheck，release tests 4/4，root build 11/11，release verify 与 `git diff --check`。
- P0.2 仍保持 open；下一切片是 Windows 安装器封装，以及干净安装、覆盖升级、卸载和用户数据保留 smoke。

## 2026-08-01 · Windows Distribution P0.1：unsigned portable staging 与 preflight

- 新增 `scripts/windows-portable-release.mjs` 与根命令 `release:stage:win` / `release:verify:win`，把 Windows Electron distribution、Desktop production 依赖、Runtime production 依赖和 managed Node 20.20.2 组装为自包含 `win-unpacked`。
- staging 输出严格限制在 `apps/desktop/release/<child>`；release 根、Desktop dist 与逃逸路径会被拒绝。自有源码、测试、脚本和 Turbo/TypeScript 开发内容在发布树中清除。
- 发布 preflight 校验 Desktop executable/main/preload/renderer、Runtime launcher/main、Node 20、`better_sqlite3.node` 与 `koffi.node`，并扫描 `.env*`、SQLite 数据文件及自有源码/测试目录。
- 生成 `release-manifest.json`，当前记录 11 个关键文件的大小与 SHA-256。新增 4 项 release script 单测，覆盖输出路径 fence、敏感/开发文件扫描、manifest 和缺失布局诊断。
- 真实隔离冷启动通过：`SYNC-THINK.exe` 使用发布目录内 `resources/runtime/main.js` 与 `resources/node/node.exe`，pipe/database/带 secret hello 均正常，窗口可见且响应，未发现原生模块 ABI 错误。
- 新增 `docs/operations/08-deployment.md` 并补充本地开发命令。当前仍是 unsigned portable staging；下一切片为 packaged identity / pipe credential 持久化和 Windows 安装器。

## 2026-08-01 · Image P0.3：视觉 Reviewer、选择冻结与有界图片返工

- migration `0035_review_image_selection_freeze` 新增不可变选择投影；原始 Reviewer assignment 继续保存完整候选集合。多候选未选择时 Scheduler 暂停 Run、保持 Reviewer ready，并在任何 Provider reservation 前返回选择要求。
- Runtime 新增安全 vision 读取：仅允许受控 generated-images 根内的 PNG/JPEG/WebP 普通文件，执行 realpath、扩展名、MIME、魔数、1..25 MiB 和 SHA-256 双重校验；图片 data URL 仅存在于 Provider 请求内存。
- vision Reviewer 使用 text + image 多模态 message；`contentRef`、generated-image root 和本机路径不会进入 Provider prompt。非 vision Reviewer或文件替换/hash 漂移均零 Provider 调用并以 acceptance failure 收口。
- reject 后的图片 rework 继承原目标 Step 的冻结 `imageGeneration`，输出归回原 Artifact 并记录 parent version；严格图片返工允许生成多个新候选，随后再次走 durable selection gate。
- 新增端到端闭环：首次两候选 → 选择 → Reviewer reject → 两个返工候选 → 再选择 → 再次 reject → `maxIterations=1` 达限暂停；验证 image/reviewer Provider 调用均有界且不派生额外 rework。
- 最终验证：Runtime 目标回归 82/82、Storage 相关回归 75/75、GeneratedImageStore 10/10、Storage 全量 268/268、MCP 单独回归 10/10；根仓 test 20/20 tasks（Runtime 62 文件 / 421 项）、typecheck 20/20、lint 11/11、design tokens、build 11/11 与 `git diff --check` 全部通过。根仓测试使用 `pnpm pretest` 与 `pnpm exec turbo run test --concurrency=1`。
- 最新构建已用隔离 Install ID `dev-p03-vision-0802-001027` 重启：Electron PID `101384`、managed Runtime PID `94480`，窗口可见且响应；pipe `\\.\pipe\sync-think-dev-p03-vision-0802-001027`、数据库 `C:\Users\ZHUZHE~1\AppData\Local\Temp\sync-think-dev-p03-vision-0802-001027\sync-think.db` 与 hello handshake 正常。

## 2026-08-01 · Image P0.3 第一切片：严格结构化生成参数

- Shared 新增严格 `ImageGenerationConfig`：尺寸限定为 `auto / 1024x1024 / 1024x1536 / 1536x1024`，质量限定为 `auto / low / medium / high`，候选数量限定为整数 `1-4`，并提供统一默认值与运行时守卫。
- 图片参数已贯通 Plan revision、严格 Desktop IPC、SQLite migration `0033_image_generation_config`、approved Step/Rework Step、Production Runtime 与 OpenAI-compatible Images Adapter；merge Step 携带图片配置会被拒绝。
- approved Plan 冻结参数后，Runtime 按冻结的 size/quality/count 调用 Provider。旧数据或未配置 Step 继续兼容 `auto / auto / 1`；Adapter 在发出网络请求前再次拒绝非法配置。
- 多候选执行会把每张图片分别落盘并创建独立 `ArtifactVersion(candidate)`，metadata 记录尺寸、质量、请求数量、实际数量和图片序号；completed reservation replay 不重复调用 Provider 或写文件。
- Plan 编辑器增加图片生成开关、尺寸、质量和候选数量控件；切换为 merge 时真正删除图片配置，read-only/busy 状态禁用全部相关控件。
- 验证已通过：根仓测试 20/20 tasks（Runtime 62 文件 / 408 项、Storage 24 文件 / 263 项、Desktop 109 文件 / 766 项、UI Kit 21 文件 / 234 项）、typecheck 20/20、lint 11/11、design tokens、build 11/11 与 diff check。首次根仓并发测试中 Storage 进程异常退出，Storage 单独全量 263 项通过，随后根仓完整复跑通过。
- 使用全新独立 SQLite 隐藏控制台重启成功：Electron PID `64660`，窗口 `SYNC-THINK` 可见且响应；managed Runtime PID `77124` 使用 Node `20.20.2`，pipe/database/hello 正常且 stderr 为空。数据库为 `D:\tmp\sync-think-image-p03-20260801-191713\sync-think.db`，日志为 `D:\tmp\sync-think-image-p03-restart-20260801-191713`。
- 下一切片为 Image P0.3 第二切片：多候选比较与选择；随后接入视觉 Reviewer 和有界返工。

## 2026-08-01 · Image P0.2：Renderer Artifact 卡片与安全预览

- 新增 Main 内图片 preview registry：只接受 Runtime-owned generated-images 根目录中的绝对路径，realpath 后校验目录边界、扩展名、MIME、魔数、25 MiB 上限与 SHA-256，并在每次协议读取时重新验证。
- Main 通过严格 `runtime:artifact-image-preview` IPC 按 ArtifactVersion 查询并签发随机不透明 grant；Renderer 只收到 `sync-think-image://artifact/<token>`、MIME、字节和 hash，不接触 `contentRef`。token 默认 5 分钟 TTL、256 项容量，超限淘汰最旧。
- `sync-think-image://` 增加 `artifact` host，拒绝空 token、带路径分隔的 token 和未知 host；图片响应使用 `Cache-Control: private, no-store` 与 `X-Content-Type-Options: nosniff`，原 message media 路径继续限定在 `media` host。
- Renderer 为合法 PNG/JPEG/WebP ArtifactVersion 并发请求 preview，投影 loading/ready/error，使用 scope generation gate 防止 Task/Run 切换后的陈旧响应覆盖。Artifact 卡展示图片、MIME、字节和自然尺寸，Execution Graph Step 展示最新 ready candidate 缩略图。
- 新增 registry、payload、Main/Preload/Renderer wiring、Run 图投影与 UI 状态测试。根仓测试 20/20 tasks（Desktop 758、Runtime 408、UI Kit 231）、typecheck 20/20、lint 11/11、design tokens、build 11/11 与 diff check 通过。
- Image P0.2 完成；下一切片为 P0.3 结构化生成参数、视觉 Reviewer、多候选比较和有界返工。

## 2026-08-01 · Runtime：Provider/Agent fallback 跨层循环修复

- `DemoRunState` 新增 durable `attemptedModelIds`，Run 创建、模型 rebind、checkpoint 序列化与恢复均保持有序去重的已尝试模型集合；旧 checkpoint 从当前 `modelId` 兼容初始化。
- Provider priority fallback 与 Agent fallback 统一跳过本 Run 已尝试模型；候选耗尽时持久化 `run.paused / fallback_exhausted`，continuation 入口额外拒绝重复目标。
- 保留既有绑定语义：非 Agent default/chain 模型不擅自进入 Agent fallback，空 fallback 配置仍返回 `no_fallback_configured`。
- 新增跨层循环回归：`alpha → beta → gamma` 后 Agent fallback 指回 `alpha`，验证每个模型最多调用一次、最终暂停且不会继续写第三次 fallback transition。
- 验证：Core model-binding 18 项、Runtime demo-run fallback 2 项、fallback-walk 6 项；Runtime 62 文件 / 408 项、Core 17 文件 / 167 项、Desktop 107 文件 / 750 项及根仓串行 20/20 tasks 通过；typecheck、lint、design tokens、build 与 diff check 门禁通过。
- 既有约 16.8 GB 开发数据库不在本切片处理；启动验收改用独立 SQLite。下一产品切片仍为 Image P0.2 Renderer 图片 Artifact 卡片与安全预览。
- 隐藏启动验收通过：Electron PID `98252` 可见且响应；managed Runtime PID `83416` 使用 Node `20.20.2`，pipe/database/hello 正常、stderr 为空；独立数据库与日志位于 `D:\tmp\sync-think-fallback-fence-20260801-173753`、`D:\tmp\sync-think-restart-20260801-173753`。

## 2026-08-01 · Image P0.1：OpenAI-compatible 生图 durable 管线

- Provider Adapter 新增 typed `generateImages()`；`OpenAIImagesAdapter` 调用 `POST /images/generations`，携带 Bearer 凭证与 `Idempotency-Key`，强制请求 `b64_json`，并完成 401/403、429、timeout、5xx/network 与 protocol 错误分类。
- Images 响应只接受可持久化 base64；支持 PNG/JPEG/WebP 魔数，限制 prompt、图片数量、单图和总大小，仅远程 URL 的响应直接失败。错误与 revised prompt 经过 secret scrub。
- Runtime 新增 `GeneratedImageStore`：图片写入受控 `artifacts/generated-images` 根目录，scope 与文件名均由 SHA-256 派生，使用临时文件 + rename，并验证路径边界、已存在文件内容及幂等复用。
- Production execution output 扩展为 inline `content` 与本地 `contentRef + contentHash` 严格二选一；引用只允许本地绝对路径、安全 file URL 或内部 artifact URL，引用图片必须携带小写 SHA-256。
- `ProductionStepExecutor` 已为 `openai-images` 接入 durable reserve、typed Provider 调用、Runtime 落盘、complete/replay 和 Scheduler candidate ArtifactVersion；已完成 reservation 的 Step 重启后不会再次调用 Provider。
- Runtime 注册改为将 `openai-images` 绑定到专用 Images Adapter，并向 production executor 注入 Runtime-owned image store；API Key、base64、完整 prompt、远程 URL 和原始 Provider 响应不持久化。
- 验证：Adapter 14 项、Image Store 5 项、Execution Store 9 项、Production Executor 27 项定向通过；Adapters 68 项、Runtime 405 项、Desktop 750 项、Core 164 项及根仓串行 20/20 tasks 通过；typecheck、lint、design tokens、build 与 diff check 门禁通过。
- 下一切片为 Image P0.2 Renderer 图片 Artifact 卡片/安全预览；P0.3 再实现视觉 Reviewer、多候选比较和有界返工。Phase 3 保持进行中。

## 2026-08-01 · DesktopWorker P0.10：真实 WPF 冷重启人工接管 E2E 收口

- 新增仓库内 WPF fixture 与正式命令 `pnpm selftest:desktop-handoff`，支持 Continue、Cancel 和两路径串行验收；fixture 通过独立临时 artifacts 构建，不在仓库生成 `bin/obj`。
- E2E 从真实聊天 UI 触发 Provider 的 list/inspect/resolve/set-value 工具链，并对 `InputText` 执行真实 UIA `ValuePattern.SetValue`。
- WPF mutation handler 在执行期间阻塞，测试通过 User32 键盘事件改变 `GetLastInputInfo`，验证 mutating action 被中断并持久化为 `waiting_user / desktop.user-input-detected`。
- Desktop 与 managed Runtime 冷重启后，Renderer 从同一 SQLite 恢复等待卡片；Continue 终结为 `completed / user-confirmed`，Cancel 终结为 `failed / desktop.command-cancelled / acceptance`。
- 两条路径均验证原 UIA 动作只发生一次，Provider 请求不因冷重启或用户决定重放；lifecycle event 和等待卡片继续遵守敏感字段安全投影。
- 新增 selector trust 冷重启单测：同一 SQLite 上的新 Runtime Controller 不继承旧进程解析元数据，旧 target 重新按 sensitive 要求审批，审批前不 reserve command。
- 验证：`pnpm selftest:desktop-handoff` 2/2；Workers 100 passed / 3 skipped；Runtime 398 tests；Desktop 750 tests；根仓串行测试 20/20；typecheck、lint、build 11/11、WPF Release build 与 diff check 全部通过。
- 启动验收：隐藏控制台重启后 Electron `SYNC-THINK` 可见且响应，managed Runtime Node 20.20.2 的 pipe/database/hello 正常、stderr 为空；日志位于 `D:\tmp\sync-think-restart-20260801-162722`。
- DesktopWorker P0.1-P0.10 至此完成；下一阶段任务转向图像生成完整管线与视觉审查闭环。

## 2026-08-01 · DesktopWorker P0.9：动作风险分级与 Runtime 审批策略

- Desktop 动作统一分类为 `observe`、`display`、`sensitive`、`human-only`、`prohibited`，分类上下文不足时 fail-closed。
- 最终审批矩阵：observe 在 ask/workspace/full-access 自动执行；display 仅 ask 审批；sensitive 与 human-only 在所有模式都审批；prohibited 始终阻止。full-access 只免除可信、已解析普通 display 动作的审批。
- Runtime 在 `desktop_resolve_selector` 成功后维护最多 512 项的短生命周期 `DesktopElementTarget → DesktopElementSnapshot` 元数据缓存。冷重启后缓存失效；未解析 invoke/set-value 继续按 sensitive 审批。
- UIA `CurrentIsPassword` 已进入元素快照和 accessibility revision。密码字段 read/set-value 归类为 `human-only / access-or-create-secret`；删除、支付、发布、外发、权限变更和越界导出等高风险语义映射为对应 human-only action。
- `RuntimeDesktopController` 在 durable command reserve 和 Worker 执行前二次强制风险与审批检查。缺少审批时不 reserve command、不调用 Worker；deny 路径保持零 Worker 调用和零 command 增量。
- `tool.approval_requested` 与 `desktop.command.started` 使用安全投影，不包含明文 value、valueDigest、nativeWindowHandle、snapshot/accessibility revision、elementIndex、targetIdentity 或 ownerId。
- Runtime 集成测试覆盖 full-access 下未解析 sensitive 的 deny、密码字段 human-only 的 approve、普通已解析 display 自动执行，以及审批后用户输入中断 fence。Runtime 定向 4 文件 / 72 项、Workers 定向 2 文件 / 18 项、Workers 全量 100 passed / 3 skipped、Runtime 全量和 Desktop 107 文件 / 750 项均通过；typecheck、lint、根仓 build 11/11 与 diff check 通过。
- 启动验收：已隐藏控制台重启 Desktop 与 managed Runtime；pipe/database/hello 正常、stderr 为空、Electron 窗口可响应，日志位于 `D:\tmp\sync-think-restart-20260801-153021`。
- 后续：真实 WPF fixture 的用户输入中断、Runtime/Desktop 冷重启、waiting card 恢复及 Continue/Cancel E2E。

## 2026-08-01 · DesktopWorker P0.8：waiting_user Continue/Cancel resolution

- Protocol 新增 `desktop.command.continue` / `desktop.command.cancel` 命令、类型与 Feature negotiation；等待摘要增加 `canContinue/canCancel`。
- Storage 新增持久 resolution：Continue 将 `waiting_user` 终结为 `completed` 并记录 `resolution: user-confirmed`，只确认用户已人工处理，不重新执行原 UIA 动作；Cancel 将其终结为 `failed`，错误为 `desktop.command-cancelled`、分类为 `acceptance`。
- Continue/Cancel 都要求 `expectedUpdatedAt` 乐观并发栅栏；记录已变化时稳定返回 `desktop.command-conflict`，成功请求支持幂等重放，时间戳保持单调。
- Runtime 增加严格 payload 校验、命令路由和 durable `desktop.command.continued/cancelled` 事件；事件仍只携带安全投影，不泄漏正文、digest、native handle、target identity、owner 或 revision/index。
- Desktop Main/Preload/Renderer 已接通两种动作。等待卡片提交时同时锁定按钮；Renderer 成功或失败都重新查询 durable waiting list，生命周期事件只触发重查，SQLite/Runtime 投影继续是真源。
- 自动化验证覆盖真实 Runtime 管道、Continue/Cancel 状态转移、重放、stale fence、严格校验、事件脱敏，以及 Renderer 提交/锁定/冲突刷新。Storage、Protocol、Runtime、Desktop 全量测试通过，Desktop 为 107 文件 / 750 项；相关 build/typecheck/lint 通过，根仓 `pnpm build` 11/11 成功且 `git diff --check` 通过。
- 启动验收：隐藏控制台重启后 Runtime pipe/database/hello 正常，两侧 stderr 为空，无 orchestration recovery 异常，Electron 窗口可响应；日志位于 `D:\tmp\sync-think-restart-20260801-143907`。
- 后续：Desktop 动作风险分级，以及真实 WPF fixture + Runtime/Desktop 冷重启后的用户输入中断、Continue/Cancel 恢复 E2E。

## 2026-08-01 · DesktopWorker P0.7：持久等待态只读投影与恢复迁移修复

- 修复 Runtime 启动恢复期间的 `step.execution_fence invalid`：新增 migration `0032_scheduler_fencing_repair`，允许 `failed/completed` Step 保留最终 `execution_owner_id/execution_attempt` 诊断信息，同时继续强制清除终态 lease，避免历史 Run 恢复时报 `[runtime] orchestration recovery failed`。
- Storage 新增按 workspace/run 查询持久 `waiting_user` Desktop command；Runtime 新增 `desktop.command.listWaiting`，只返回窗口标题/appId/PID、动作、原因、状态和时间等安全摘要，不投影输入值、native handle、target identity、owner、digest 或 revision/elementIndex。
- 用户输入中断持久化完成后发布 durable `desktop.command.waiting_user` 事件。该事件只触发 Renderer 重查，界面数据始终来自 Runtime 的持久安全投影。
- Desktop Main/Preload 新增只读 list-waiting IPC；Renderer 在当前 task/run 下显示等待卡片，支持 reconnect、事件触发刷新、请求 generation fence 和查询失败重试，reload 或 Desktop 重启后仍可恢复显示。
- 本切片刻意不暴露 Continue/Cancel；等待卡片明确提示系统没有自动重放未知桌面副作用。下一切片继续实现 Continue/Cancel、高风险动作分级和真实端到端恢复。
- 验证：Storage 24 文件 / 256 项、Protocol 8 文件 / 55 项、Runtime 全量测试/typecheck/lint、Desktop 107 文件 / 742 项与 typecheck 均通过；根仓 `pnpm build` 11/11 成功，`git diff --check` 通过；正式重启后 migration `0032_scheduler_fencing_repair` 已应用，Runtime pipe/database/hello 正常，日志未再出现 `orchestration recovery failed`。

## 2026-08-01 · Provider fallback：`run.paused` 终态与文本回退过滤

- Desktop 流式状态新增 `run.paused` 终态处理：`fallback_exhausted` 后会清理 `activeRunId`、停止 streaming、移除残留 draft，并在聊天区显示可理解的暂停提示，不再停留在“准备中 / 深度思考中”。
- 暂停提示会带出模型、错误类型和 Provider 失败摘要；例如 `grok-4.5` 连续 HTTP 503 后提示用户稍后重试或切换模型。
- Core/Runtime 新增文本回退兼容过滤：同 Provider priority fallback 与 Agent `fallbackModelIds` 都会跳过图片、视频、embedding、TTS/语音等非文本模型；Provider discovery 不再把所有模型硬标为 `text`。
- 新增覆盖：Core capability probe、Desktop chat stream、Runtime fallback walk；确认 `grok-imagine-*` 即便历史能力标签错误包含 `text`，也不会进入文本 fallback 调用链。
- 验证：Core typecheck/test/build 通过（17 文件 / 164 项）；Runtime typecheck/lint/test/build 通过（60 文件 / 387 项，fallback 定向 5/5）；Desktop typecheck/test/build 通过（103 文件 / 728 项）；`git diff --check` 通过。

## 2026-07-31 · DesktopWorker P0.6：durable command 与用户输入中断 fence

- 新增 SQLite migration `0031_desktop_command` 与 `SqliteDesktopStore`。Desktop 工具在 Worker 副作用前持久化 command/intent，支持 request digest、幂等键冲突检测、approved/running/completed/failed/waiting_user 状态和结果重放。
- Runtime 新增 `RuntimeDesktopController`：Computer Use capability 在 reserve 前 fail-closed；已完成命令直接重放，失败命令不自动重试，旧的非终态命令转为 `waiting_user` + `desktop.command-inspection-required`，避免重启后盲目重复桌面副作用。
- focus/invoke/set-value 等可变更动作执行前采样 Windows `GetLastInputInfo`，执行中每 40ms 检查用户键鼠输入；检测到变化会 abort 并终止短生命周期 Host，command 持久化为 `waiting_user`，稳定返回 `desktop.user-input-detected`。观察/读取工具不启用该监控。
- `GetLastInputInfo` 仅作为 Runtime/Workers 内的窄范围只读 User32 边界，不模拟输入，也不改变“UIA COM 只能位于独立 Desktop Host”的架构约束；非 Windows 或监控不可用时以 `desktop.input-monitor-unavailable` fail-closed。
- `desktop_set_value` 的正文仍只经 Host stdin 传输；durable command/event 仅保存长度和 SHA-256 digest，不保存明文。Worker 与 User32 reader 均延迟创建，插件关闭时不会加载或启动。
- 验证：Storage migration/store 55 passed；Workers Desktop 定向 30 passed；Runtime Desktop/chat 定向 62 passed；Shared/Storage/Workers/Runtime/Desktop typecheck、Shared/Storage/Workers/Runtime lint、Runtime/Desktop build 与 `git diff --check` 通过。
- 下一切片：把持久 `waiting_user` 投影到 Runtime/Desktop/Renderer，增加 Continue/Cancel，再完成敏感/高风险动作分级和真实人工接管闭环。

## 2026-07-31 · DesktopWorker P0.5：内置 Computer Use 插件与 Runtime capability gate

- 新增内置 `computer-use` 插件注册表，复用现有 `app_setting` 保存 `plugin.computer-use = { enabled }`，默认关闭；未启用时 Runtime 不向 Provider 暴露 `desktop_*` schema、不加入 Computer Use prompt，也不会实例化 Worker 或启动 Desktop Host。
- 插件启用后，聊天工具循环提供 `desktop_list_windows`、`desktop_inspect_window`、`desktop_resolve_selector`、`desktop_read_element`、`desktop_focus_element`、`desktop_invoke_element`、`desktop_set_value` 七个 UIA 工具，并继续沿用 exact window、双 revision、element index 与 bounded inspect fence。
- 插件开关与权限模式保持独立：插件决定“有没有桌面能力”；`execution_mode` 决定“启用后是否审批”。`ask` 只审批 focus/invoke/set-value，观察/读取自动执行；`workspace` 与 `full-access` 下普通桌面动作自动执行。`full-access` 不会自动启用插件。
- Runtime 在 schema 生成、工具 allowlist 和实际 dispatch 前重复读取 capability；模型生成工具调用后若用户关闭插件，稳定返回 `desktop.capability-disabled`，且不会先弹审批或启动 Host。Desktop 工具不依赖项目目录，因此可在无 workspace 的对话中使用。
- 设置页“插件”分区已上线 Computer Use 开关，支持持久状态加载、保存失败回滚和权限语义说明。Renderer 通过 browser-safe `@sync-think/protocol/plugins` 子路径导入插件常量，避免浏览器 bundle 跟进 Protocol barrel 的 Node built-ins。
- 验证：Protocol 55 passed；Runtime Desktop/chat/plugin 定向 54 passed；Desktop SettingsPage 4 passed；Shared/Protocol/Workers/Runtime/Desktop typecheck、Runtime/Desktop lint、Runtime/Desktop build 均通过。
- 当前切片只完成可选能力暴露与普通审批语义，不等于 durable Desktop command / 人工接管闭环。下一切片是持久 command/intent、用户输入中断 fence、`waiting_user`、Continue/Cancel 与敏感/高风险动作分类。

## 2026-07-31 · Windows UI Automation Worker P0.1：独立 Host 与真实 UIA Root probe

- 用户确认采用“独立短生命周期 Node DesktopWorker Host + Koffi 3.1.4 + Windows UIA COM”，.NET sidecar 作为 ABI/COM/打包成本过高时的触发式降级，WinAppCLI 只作开发期 oracle。
- 新增版本化 Desktop contract 和独立 JSONL/stdio Host：包含 ready/response 握手、父 PID 监控、beforeStart fence、realpath capability root、AbortSignal、硬超时/进程树终止、输出限幅、原生错误清洗与稳定失败分类。
- 首版 schema 已加入 exact Window identity、snapshot/accessibility revision 和短生命周期 element index；probe/list/inspect/read/focus/invoke/set-value 均有输入约束，但当前真实驱动只实现 probe，未实现动作明确返回 `desktop.action-unsupported`。
- 固定生产依赖 `koffi@3.1.4`，真实 Host 完成 `CoInitializeEx -> CoCreateInstance(CUIAutomation) -> GetRootElement -> Release -> CoUninitialize`；编译产物在项目 managed Node 20.20.2/N-API 9 上真实 smoke 返回 `rootAvailable=true`，系统 Node 24.14.1/N-API 10 也通过。SetValue 正文将通过 stdin 进入 Host，不暴露在命令行。
- 新增 `IsolatedDesktopWorker` 并保留 Fake 回退；Desktop 定向 20/20、Workers 全量 82 passed / 3 skipped，typecheck、lint、build、Prettier 和 `git diff --check` 通过。
- 当前只完成 P0.1 Host/probe。下一切片是可见顶层窗口发现、bounded UIA inspect 和 revision 生成；OCR、通用截图定位、任意坐标点击/拖拽不进入 P0。
- 技术证据与选型记录：`docs/superpowers/specs/2026-07-31-windows-uia-worker-spike.md`。

## 2026-07-31 · Browser Worker P0/P0.5：真实 Desktop/Runtime 重启接管验收完成

- 新增正式验收命令 `pnpm selftest:browser-handoff`（等价于 `node scripts/selftest-browser-handoff-e2e.mjs all`），使用隔离临时数据库、Electron user-data、脚本化本地 OpenAI-compatible Provider 与系统 Edge/Chrome，串行执行 Continue、Cancel close-page、Cancel keep-open 三条路径。
- 三条路径均验证真实 Desktop/Runtime 冷重启：等待接管期间同一 CDP target 保留；重启后 durable 卡片恢复；Provider 首轮请求与 `browser_open` 不重放；Continue 从同一 Step checkpoint 完成；两种 Cancel 都以 `browser.handoff-cancelled` 失败 Run/Step，并分别关闭或暂时保留页面。
- Continue 或 Cancel 解析后，第二次 Desktop 退出会关闭已接管的系统浏览器并删除 Profile-local CDP metadata。`cancel-keep-open` 实测暴露冷启动 BrowserHost 未恢复 lease 的缺口；Runtime 现会在所有带 lease 的 Cancel 路径先恢复并校验 lease，使页面在 Runtime 存活期间保持打开、最终 shutdown 仍能完整清理。
- Desktop 管理 Runtime 退出改为 IPC 优雅关闭，等待 `session.close()` 完成后再退出 Electron；超时仅终止 Runtime 自身，不再通过进程树误杀需要跨重启保留的系统浏览器。系统 Edge/Chrome 以 detached/unref 方式启动，但无等待接管时仍由 BrowserHost 通过 CDP 显式关闭。
- 真实 E2E 结果：`PASS continue`、`PASS cancel-close-page`、`PASS cancel-keep-open`。完整回归：Workers 70 passed / 3 skipped，Desktop 721 passed，Runtime 369 passed，Protocol 53 passed，Storage 251 passed，Shared 21 passed；相关 package build、typecheck、lint、Prettier 与 `git diff --check` 全部通过。
- 已知测试现象：Playwright Electron 首次 `app.close()` 偶尔返回 Windows `0xC0000005`，但 Runtime 已进入优雅退出、handoff 浏览器正确保留、第二次启动可恢复且最终进程/metadata 均清理；当前记录为调试关闭噪声，不阻塞 P0.5 验收。
- 结论：Browser Worker P0.1-P0.5 已完成，Phase 3 下一主项转入 Windows UI Automation Worker 与人工接管回退。

## 2026-07-31 · Browser Worker P0.5：Durable Human Handoff 与 Desktop Continue/Cancel

- Browser handoff 已持久化为 revision-bound `waiting_user` 状态；登录、验证码、支付、设备确认等人工检查点可在 Runtime/Desktop 重启后继续查询，不再受 Renderer 固定超时影响。
- Runtime 新增 `browser.handoff.listWaiting/continue/cancel`。Continue 重新校验 Page/Profile/lease owner 后从同一 Step checkpoint 恢复，不重放 `browser_open`；Cancel 失败 Run/Step，并按 `keep-page` 或 `close-page` 生命周期策略处置 lease。
- Desktop Main/Preload/Renderer 已接入 handoff IPC，并新增 durable 接管卡片、查询失败 Retry、Runtime 重连恢复、Continue/Cancel 共享 busy lock 与操作失败提示。
- Renderer 只接收安全摘要，不显示或保存 lease/page/profile/owner、Cookie 与页面秘密；事件仅作为刷新信号，durable query 才是 UI 真源。
- 修复 Windows 临时目录 8.3/长路径差异导致的 Terminal 测试不稳定；实机冷重启发现持久 activity cursor 可能领先于回滚后的 Runtime 事件历史，Desktop 现会原子归零游标、清空旧活动快照并从 0 重新订阅，避免持续 `protocol.unexpected_request`。
- 验证：Desktop handoff 4 文件 / 21 项、activity cursor 2 文件 / 11 项、Desktop 全量 101 文件 / 716 项；Runtime handoff 4 文件 / 42 项；Runtime 全量 57 文件 / 367 项，Storage 全量 23 文件 / 251 项；根仓 typecheck/lint/build、顺序全仓测试与 `git diff --check` 均通过。
- 边界：真实系统 Edge/Chrome 人工端到端 smoke 仍待执行，因此 P0.5 和 Browser Worker 路线图主项暂不关闭。

## 2026-07-31 · Browser Worker P0.4：Team Step 精确权限、Page lease 隔离与审计元数据

- Production Step 已按冻结 `AgentVersion.permissions.browser` 动态暴露并执行 `browser_open/click/type/read/screenshot`；默认持久化 Runtime 已把 Browser Controller 接入 Production executor。
- Team Step 的站点授权只使用精确 `agent-version` scope，并同时受冻结 origin 快照约束；Run/Workspace coordinator grant 不再能替成员越权。
- 每个 Step 使用稳定 owner `step:<runId>:<stepId>:<agentVersionId>`。同一 Team 可共享 Profile 登录态，但不同成员/Step 使用独立 Page lease；Provider 参数中没有 `leaseId` 寻址能力。
- Browser 成功结果、普通输出 Artifact、Tool Trace Artifact 与单次 trace metadata 均携带 acting AgentVersion、Step、owner、Profile、lease、page、origin 和 command ID。
- Browser 审批载荷已脱敏：导航仅保留 origin/path，输入仅保留 selector、字符数和 SHA-256，不把 URL query/hash 或输入正文写入审批详情。
- 验证：定向测试 33/33，Runtime 56 文件 / 360 项；根仓 typecheck 20/20、lint 11/11、build 11/11、test 20/20，`git diff --check` 通过。
- 边界：P0.5 durable `waiting_user` 与人工接管仍待实现，因此 Browser Worker 路线图主项继续保持未完成。

## 2026-07-30 · Browser Worker P0.1/P0.2：系统浏览器 Host 与 Runtime 真执行链

- **系统浏览器 Host**：新增 `BrowserHost`，发现显式浏览器路径或系统 Edge/Chrome，以 loopback 动态 CDP 端口启动可见外部进程，并通过 `playwright-core.connectOverCDP` 接管独立持久 Profile；不下载或打包 Playwright Chromium。
- **Profile 与 Tab 生命周期**：一个活跃 Profile 只创建一个 Browser Session；同一 `profileId + ownerId` 复用一个 Page lease，不同 owner 使用不同 Page。同 Page 命令严格串行，不同 Page 保留并行；release/acquire 竞态按 Promise 身份校验，旧 release 不会删除新的 owner lease；Runtime shutdown 显式关闭受管 Page/浏览器。
- **受限动作**：真实 Worker 支持 navigate/click/fill/read/wait/screenshot；origin 以精确 `URL.origin` 校验，并同时用 BrowserContext 首请求 route 与 CDP Fetch 响应阶段拦截阻断未授权 `target=_blank` 和 3xx Location，确保被拒 origin 在真实 Edge smoke 中请求计数为 0。截图与 Profile 目录均做 lexical path、realpath 与 junction/symlink 三层防越界。
- **Runtime 真链路**：全部聊天 `browser_*` 已从 Renderer `<webview>` 请求-响应回路迁到 Runtime Browser Controller/Worker。外部副作用前先持久化脱敏 `browser.command.started`；`browser_open` 完成结果仍提供去查询串 URL 给右栏预览；真实路径不再发布 `browser.command_requested`。
- **隐私边界**：填写正文和 URL query 不进入意图事件；完整 Browser Worker 结果只供当前 Provider 工具轮使用。SQLite `tool.completed` 只保留脱敏 URL、结果元数据、正文/链接/按钮/输入数量与截图引用；失败时仅保存固定错误摘要、错误码和 failureClass，不复制 Playwright 原始错误、网页正文、selector、URL path/query/hash 或页面秘密。
- **默认数据目录**：生产 Profile 根目录为 `dirname(sync-think.db)/browser-profiles`；可用 `SYNC_THINK_BROWSER_EXECUTABLE` 指定 Edge/Chrome。`playwright-core` 是唯一新增依赖，不包含浏览器二进制。
- **验证**：Browser 聚焦 15/15（含 Host 级硬期限、release/acquire 竞态、Profile junction/dangling link 拒绝），真实 Edge CDP smoke 2/2（基础动作 + 未授权 302/popup 目标请求计数为 0）；Workers 全量 67/67、typecheck/lint/build；Runtime Browser 工具链 2/2、单 worker 全量 56 文件/354 项、typecheck/lint/build；`git diff --check` 退出码 0。Desktop 旧桥兼容仍沿用上一轮 13/13、typecheck/build 证据，本次未改 Desktop 路径。
- **明确限制**：本次只完成 P0.1/P0.2。origin grant 当前按 owner 内存保存且由成功 `browser_open` 临时建立；命令/授权持久化、敏感动作审批与幂等恢复属于 P0.3，Team Step 属于 P0.4，持久 `waiting_user` 与人工接管属于 P0.5。路线图主项保持未完成。

## 2026-07-29 · NewMax P2：Agent Skill 默认继承、会话覆盖与自动 Step 隔离

- **协议语义**：`task.appendMessage` 增加可选 `skillVersionIds?: string[]`。`undefined` 保持旧客户端兼容并继承 Agent allowlist，`[]` 表示本轮明确不加载 Skill，非空数组只接受 trim、按首次出现去重后的最多 8 个精确不可变 SkillVersion ID。
- **Runtime 权威边界**：本轮选择必须是有效 Agent allowlist 的子集，并在用户消息落库与 Run 启动前完成存在、未归档和权限已批准校验；Renderer 校验只改善体验，不承担授权。
- **上下文同源**：Runtime 只按最终选中的精确 ID 加载完整 Skill。Context Packet、Provider system prompt、Context Manifest、fallback/rebind/retry 和恢复共用同一冻结快照；被 Context 选择排除或截断的 Skill 不会从第二条路径进入 Provider。
- **持久化边界**：Run event/checkpoint 只保存 SkillVersion ID、fingerprint 等完整性信息，不复制 `SKILL.md` 正文。Runtime 重启后从不可变 Skill store 重新加载并核对 fingerprint，Agent 后续换绑不会改写历史 Run。
- **Desktop 交互**：新增 `TurnSkillControl`。Agent 对话默认启用自身装备列表，Team 对话默认启用 coordinator（缺失时首成员）的装备列表；模型直聊显示 `0/8` 并禁用。菜单首次打开才按有效 owner allowlist 的精确 SkillVersion ID 调用 metadata-only `skill.list`，Renderer 不调用 `skill.get`；支持 loading/error/retry/empty、多选和清空，最多选择 8 个。
- **会话生命周期**：Composer 只保存当前会话的临时缩减或恢复，不修改 Agent Library。append 成功和失败都保持当前选择；切换到不同 Agent/Team 或有效 owner 时恢复新 owner 默认值，切到模型时恢复 `0/8`，只切换模型 override 不清空 Agent/Team Skill。欢迎页首条消息把临时覆盖交给新会话；重新生成显式发送 `[]`，避免意外继承旧 Run 的 Skill。
- **自动化小队**：DAG 中每个 Step 直接读取自身冻结 `agentVersionId` 的 `skillVersionIds`，在 Provider 调用前校验并注入对应 Skill 正文；不同成员互不借用 coordinator 或其他成员的 Skill，Artifact metadata 记录实际版本。用户只需在 Agent Library 一次性配置角色能力，自动执行时无需逐 Step 重选。
- **状态修复**：欢迎页 Agent/Team 草稿切模型只更新模型 override，不再把目标 owner 改成模型 ID；Team coordinator 即使与旧 owner 装备相同 Skill ID，也会按 owner 身份变化恢复默认值；目录等价刷新不会覆盖当前会话的临时选择。
- **自动化**：Desktop Skill 聚焦 4 文件 / 47 项、Runtime 自动 Step/冻结恢复聚焦 27/27、Runtime 单 worker 全量 54 文件 / 348 项通过；根 test 任务汇总 20/20，强制 typecheck 20/20、lint 11/11、build 11/11 均 0 cache，`git diff --check` 通过。首次强制根 test 在高负载下仅有租约时钟预设先过期，单文件复跑 8/8、Runtime 串行全量 348/348，未放宽断言。
- **独立复审**：复用唯一 P2 复审智能体确认上轮 Owner、coordinator scope 与文档三项问题均已修复，最终 P0/P1/P2 发现为 0；另补 Team 欢迎页切模型仍保持 owner/default Skill 的组合回归。
- **Electron 实窗**：最新版 Electron/Runtime 在浅色 1440x900 验证 Team 默认 `1/8`、切换到 `gpt-5.6-sol` 后仍为 `1/8`、菜单显示 `code-review @0.1.0` 与“当前会话临时设置”，模型直聊为禁用 `0/8`；深色 1280x720 的页面/菜单/Compose 均无横纵或内部溢出，alert、console warning/error、pageerror、请求失败和新 stderr 均为 0。临时 QA 小队已删除，窗口恢复浅色 1440x900。
- **明确限制**：本切片不增加自动 Skill 推荐、项目/任务临时附件、脚本执行、MCP 选择或市场；Composer 只能缩小 Agent 已装备 allowlist，不能扩大权限。

## 2026-07-28 · NewMax P1：项目内容搜索与终端 Pane

- **内容搜索**：文件 Dock 增加“文件名 / 内容”分段模式；正文搜索采用 literal smart-case、300ms 防抖、5 秒期限、最多 200 条和 2 MiB/文件上限。主路径通过 `rg --json` 结构化读取，缺少 `rg` 或启动失败时使用同语义 Node fallback；两条路径统一跳过 symlink/junction、二进制文件、VCS/vendor/build 与本项目临时数据目录。
- **结果定位**：结果携带相对路径、行、列、单行预览与匹配文本；点击后在当前焦点 Pane 打开文件并定位到命中位置。行列只属于瞬时界面状态，不进入 Workspace 布局快照。
- **终端 Pane**：terminal 成为与 conversation/file 并列的一等 Tab；`@xterm/xterm` 通过独立 vendor bundle 按需加载，支持 ANSI 输出、命令历史、运行、停止、清空、`Ctrl+C` 和受约束的相对 `cd`。
- **进程边界**：命令先解析为 executable + argv，再以 `shell:false` 交给 `TerminalProcessWorker`。Main 用 `senderId + terminalId` 原子注册表保证同会话单命令，并在取消、Renderer 销毁和应用退出时等待父子进程清理；POSIX 终止独立进程组，Windows 等待 `taskkill /t /f` 并保留兜底。
- **状态边界**：Workspace 快照只保存 terminal Tab 身份与相对 cwd；输出、历史、运行态和未提交命令只在 Renderer Session。应用重启后恢复空闲 Tab/cwd，但不会伪装旧进程仍存活。
- **审查修复**：覆盖快速命令事件早于 IPC reply、旧 reply 清空新输入、并发启动占位、Renderer 校验期间销毁、搜索新查询取消旧查询、`rg` 部分文件锁定 code 2、双引擎排除目录与 `--no-ignore` 一致性、xterm 加载重试和浅深主题同步等竞态/边界。
- **自动化**：P1 聚焦 Desktop 9 文件 / 71 项；Terminal Worker 8/8；Pane + Shell 42/42。最终全仓强制 test 20/20 tasks（0 cache）、typecheck 20/20 tasks（0 cache）、lint 11/11 tasks、build 11/11 tasks（0 cache）全部通过。
- **Electron 实窗**：内容搜索命中 `ProjectTerminalRegistry` 并定位到 `12:14`；延迟双段输出、停止父子进程、历史、清空、`cd apps/desktop`、Workspace 往返和冷重启恢复均通过。浅色 1440×900、深色 1280×720 均无页面溢出、alert 或终端三区重叠，xterm 背景随主题同步。
- **明确限制**：当前是受控命令终端，不是 PTY；不包含交互 stdin、shell completion、持久 PowerShell/cmd 或应用重启后的进程续接。引入 `node-pty` 需重新走技术选择与打包/权限门禁。

## 2026-07-28 · NewMax P0：递归工作区、流式合批与可编辑文件

- 工作区主舞台由单一/双聊天状态升级为版本化递归 Pane 树；支持横向/纵向嵌套分屏、20%–80% 比例、鼠标拖动、键盘调整、Pane 焦点与每 Pane 独立 Tab 条，并从旧对话 Tab 偏好一次性迁移。
- Pane 快照按 Workspace 写入本地 UI preferences；对话与文件资源可恢复，文件正文、未保存草稿、loading/error、transient cursor 不进入快照。任意深度布局仍最多同时挂载 2 个 `ChatView`，避免重复 transient subscription。
- transient text/reasoning frame 进入 Renderer 后用 `requestAnimationFrame` 合批；成功仍只写最终 assistant message，失败/取消则把已产生的部分正文持久化后再发布终态，重启后不再丢掉用户已经看到的半段回答。
- 新增受 Workspace root 约束的文件服务：读取返回 `mtimeMs/size`，保存携带 expected metadata 并通过同目录临时文件 + rename 原子替换；绝对路径、路径穿越与 symlink/junction 越界均拒绝。
- 文件监听使用父目录 `fs.watch`、100ms 事件合并与 5 秒轮询兜底，并按 Renderer sender 自动释放。干净文件外部变化自动刷新；脏文件进入“加载磁盘版本 / 覆盖磁盘版本”冲突条。
- 文件编辑器使用现有 React + `<textarea>`，未新增重型依赖；支持 `Ctrl+S`、保存状态、内存草稿恢复、关闭脏文件/Pane 二次确认，以及文件标签未保存圆点。脏状态按 `workspaceId + path` 隔离，同名文件不会跨工作区串状态。
- 验证：文件/Pane/流式聚焦 10 文件 / 70 项通过；脏状态集成 4 文件 / 34 项通过；Desktop 全量 87 文件 / 633 项、Runtime 全量 52 文件 / 337 项；全仓强制 test 20/20 tasks（0 cache，串行规避 Windows 进程测试资源竞争）、typecheck 20/20 tasks、build 11/11 tasks 通过。
- Electron 实窗：1440×900 浅色窗口完成文件树打开、未保存圆点、`Ctrl+S` 写盘、Tab/Workspace 草稿恢复、干净外改自动刷新、脏外改冲突、加载/覆盖磁盘版本和关闭确认；横向双 Pane 键盘从 50% 调到 55%，Workspace 往返与 Electron 重启均恢复 2 Pane/55%。检查结束后关闭新增 Pane 与测试文件，文档横纵溢出均为 0。

## 2026-07-28 · 递归 Pane P0 边界审查修复

- Pane 布局提交改为基于最新 Workspace 快照的函数式更新；延迟完成的新建/复制不会覆盖期间发生的分屏、重排，也不会把旧 Workspace 对话写入当前导航状态。
- 恢复或激活深层 Pane 树时最多挂载两路 `ChatView`，焦点 Pane 优先，额外 Pane/Tab 与布局快照完整保留。
- 快照解析与 legacy 迁移拒绝 `__proto__`、`constructor`、`prototype` 保留键，并用 own-property 判断阻断原型链误命中。
- 每 Pane 明确限制 100 个 Tab；达到上限时保留活动 Tab 与最新 99 个其他 Tab，内存、迁移、写盘与恢复使用同一规则。
- Pane 增加键盘 `focus` 捕获；从 Pane 新建对话直接继承该 Pane 的 track/target，不依赖尚未提交的全局导航状态。
- 仅 talk stage、无 draft、无 settings 遮罩且实际挂载的活动 Pane 会被标记已读。
- TDD 聚焦验证：Pane layout、WorkspacePaneHost、ConversationTabs、ShellApp、UI preferences 共 5 文件 / 51 项通过；Desktop 全量 85 文件 / 623 项、typecheck 与 `git diff --check` 通过。

## 2026-07-28 · 会话上下文性能 S6 第二切片：可见过程预取与锚点收敛

- 历史 run process 查询已收敛到可见/overscan 消息窗口，离屏查询不再发起，离屏失败重试 timer 会取消。
- 修复向上分页锚点：保留触发加载前的原始 scrollTop，再叠加 scrollHeight 增量；动态高度变化只补偿完全位于视口上方的消息。
- 新增几何回归覆盖分页原偏移、动态高度补偿边界；S6 第二切片聚焦测试 13/13 通过。

## 2026-07-28 · 会话上下文性能 S6 首切片：动态高度消息 Windowing

- ChatView durable 历史消息改为视口窗口渲染，使用动态高度测量、上下 overscan 与 spacer，1000 条消息的挂载范围保持常数级。
- streaming assistant、optimistic user、本地错误和审批卡仍稳定挂载在尾部，不受历史窗口切换影响。
- `ResizeObserver` 校准 Markdown/过程/图片等动态高度，并对视口上方测量差补偿 scrollTop；scroll 状态通过 requestAnimationFrame 合并。
- 新增纯算法测试覆盖 1000 条有界窗口、动态高度几何与空/单消息边界；Desktop typecheck、79 文件全量测试及全仓 11/11 build 通过。
- 下一切片：实窗验收分页锚点/自动滚底/代码与图片交互，并让历史 run process 预取跟随可见窗口。

## 2026-07-28 · 会话上下文性能 S5 完成：Context Truth 同源收口

- `conversation.getContextStatus` 的 cache-miss 路径不再使用简化 system prompt 和空 tools；它与真实 Provider 调用共用默认上下文快照构造器。
- cache-miss 按 thread 解析 workspace folder、execution mode、Agent/Skill/MCP 和工具能力，system/agent/project/tools breakdown 与下一次真实请求一致。
- 保留 compact 的独立 `systemPromptOverride`，不会把摘要专用请求污染到普通会话上下文缓存。
- 新增 cache-miss → 首次 Provider 请求一致性回归；Runtime 52 文件/335 项测试通过。
- `dev:runtime:pipe-test` 改为无副作用的 handshake + healthcheck，不再从 cursor 0 全库 replay 或写入测试消息，历史库规模不再造成启动 smoke 假超时。

- 新增 `ContextSnapshotBuilder` 与 `conversation.getContextStatus`；Provider 请求和 Runtime status 统一输出 system/agent/project/summary/messages/tools 六类 token 构成，Renderer 不再使用 chars/4、provider.usage 或本地 context window 推导。
- compact 阈值改由 Runtime `usageRatio >= compactThreshold(0.7)` 判定；manual/auto compact 完成后，Renderer token 状态继续只读取 Runtime status。
- ContextRing 已接入 Runtime tooltip，可展示 prompt/source/reasoning 分项、使用率、阈值和各来源构成，不暴露隐藏 reasoning 文本或完整 Provider context。
- Protocol 增加 browser-safe `conversation-context-status` export，Desktop bundle 不再引入 Node-only `pipe` / `handshake` 依赖。
- 修复普通 model 会话没有绑定 Agent 时，status 路径因 `included source is absent from provider payload: agent-instructions` 导致失败的问题；默认 Agent 指令现与真实 Provider 调用共享 `buildRunAgentInstructions`。
- 自动化基线：Runtime 52 文件/334 项、Desktop 78 文件/579 项；全仓 test/typecheck 20/20 tasks、build 11/11 tasks、`git diff --check` 全部通过。
- S5 尚未最终关闭：cache-miss status 重建仍需与真实 Provider system/project/tools 构造完整同源；Electron ContextRing 最终实窗验收也因 Computer Use 被中断而待完成。

## 2026-07-27 · 会话上下文性能 S4 完成：Run-local Process Projection

- Storage 新增 `listEventsByRun(runId)`；Protocol/Runtime 新增 `conversation.getRunProcess` 与 `RunProcessView`，历史过程不再依赖 Desktop 全局事件窗口重新投影。
- Desktop Main/Preload/Renderer bridge 对 `runId` 做严格 payload 校验；ChatView 以 `Map<runId, RunProcessView>` 缓存历史与当前过程，并用 conversation generation 阻止旧异步响应污染新会话。
- 历史过程查询瞬时失败后以 500ms 起步、最大 8 秒的指数退避自动重试；成功、切换对话和卸载都会清理重试状态。
- transient stream 新增 `process` frame/snapshot；工具事件只更新对应 run，terminal 携带最终过程；Runtime 文本/reasoning snapshot 更新与重连恢复不会丢失已有 process。
- `MessageBubble` 只接收单个 `processView`，并通过 `memo()` 与稳定 callback 保持历史气泡引用稳定；ExecutionProcessBlock、FileChangesCard、RightRail 不再扫描原始事件或调用旧 projector。
- 读/写步骤标题直接包含路径；command、generic、list_files 的单行长输出也同时按行数和字符数截断。
- MCP requested/called/refused 在生产事件缺少 toolCallId 时按共同 `actionDigest` 聚合；called/refused 与 run terminal 会把步骤最终收敛为 done/error，不遗留 running。
- 新增 30 步投影、run Map 对象隔离、Desktop 生产接线、payload、transient reducer、重连 snapshot、历史查询重试与持久命令回归测试；旧 transient sequence 测试已纳入新增 process frame。
- 验证：Protocol 5 文件/20 项、Storage 22 文件/246 项、Runtime 48 文件/319 项、Desktop 77 文件/567 项；全仓 test/typecheck 20/20 tasks、build 11/11 tasks 全部通过。

## 2026-07-27 · 会话上下文性能 S3 完成：Cursor Replay + Checkpoint Tail Recovery

- Desktop 全局订阅收敛为轻量 `message` / `run` activity，并在 `app.getPath('userData')/runtime-activity-cursor.json` 持久化单调 cursor；即使 replay 页没有命中 category，也会保存页面进度，重启不再从 0 回放。
- Desktop activity `eventHistory` 固定保留最近 2048 条，按 event ID 去重并以 `(sequence, id)` 稳定排序；同 sequence 的遗留事件不会被误删。
- Runtime 从 checkpoint projection + checkpoint 后的 SQLite event page 恢复，常驻事件窗口限制为最近 2048 条；message backfill 使用独立分页 cursor，不再依赖启动时加载全库事件。
- durable event replay 直接读取 Store cursor page，不再扫描 Runtime 内存历史；replay/live handoff 继续受 event 数量与 frame byte budget 双重约束。
- Storage 新增 `getLatestEventCursor()`、严格有界的 `(sequence, id)` `listEventPage()` 与迁移 `0029_event_global_cursor`（`event(sequence, id)`）；遗留重复 sequence 可安全跨页，且无遗漏、无重复。
- 新增 Desktop cursor 持久化/万条 replay 有界内存测试、Runtime checkpoint-tail/分页 replay 测试，并补齐 migration 回归断言。
- 验证：全仓 test 20/20 tasks（Desktop 74 文件/549 项、Runtime 45 文件/310 项、Storage 22 文件/245 项）、typecheck 20/20 tasks、build 11/11 tasks 全部通过。

## 2026-07-27 · 会话上下文性能 S2 完成：Non-durable Delta + Active Snapshot

- Desktop `RuntimePipeClient`、`RuntimeSession`、Main IPC、Preload 与 ChatView 已完整接入 thread-scoped transient stream；当前会话以 transient text/reasoning frame 更新助手草稿，durable terminal 负责 final message 收敛。
- Runtime 停止持久化 `message.delta` / `message.reasoning_delta`；output chunk 只更新内存 active run、thread-local replay 和 live subscribers，下一条 durable 边界才携带最新 checkpoint。
- transient subscribe response 增加 active-run snapshot；cursor 超前或 replay 窗口淘汰时，Desktop 直接恢复完整 text/reasoning 草稿，不再依赖 durable delta 回填。
- terminal 会清理 active snapshot，并保持“先写 final assistant message、后发布 `run.completed`”顺序；失败/取消也继续发布 durable terminal 和 transient terminal。
- 新增 1000 chunk SQLite 收敛验收：0 条 durable delta、1 条 `run.completed`，durable event 总量保持常数级；覆盖 live/replay/reset/snapshot/reconnect/thread 隔离。
- 验证：Protocol 4 文件/18 项、Runtime 44 文件/306 项、Desktop 73 文件/543 项全部通过；全仓 build 11/11 通过。

- 全仓验证通过：typecheck 20/20 tasks、test 20/20 tasks、build 11/11 tasks。
- ChatView 按 sequence 消费全部新增事件，不再假设 `run.completed` 是 `eventHistory` 最后一项；兼容 `reasoningDelta` / `textDelta` / `delta`。
- 新增会话/请求 generation 隔离，晚到的旧 `listConversationMessages` 响应不能覆盖当前会话或较新的终态刷新。
- 流事件按 runId 分离并按事件顺序应用，旧 run 终态与新 run delta 同批到达时不会串接草稿。
- 分页 prepend 增加 durable message id 去重，并继续按 thread-local sequence 排序。
- Runtime 在发布 `run.completed` 前先持久化 final assistant message，消除终态刷新与 Message Store 写入竞态。
- 新增 Chat stream 3 项回归测试；Desktop 72 文件 / 537 项、Runtime 43 文件 / 299 项测试通过。

## 2026-07-27 · 会话上下文性能 S1 完成：分页 ChatView

- **ChatView 不再扫描全库事件构建消息列表**；改为调用 `listConversationMessages` 分页读取最近 50 条。
- 旧事件 backfill 在 Runtime 恢复时自动执行，进度持久化到 `app_setting`，可重跑幂等。
- 流式输出（`message.delta` / `message.reasoning_delta`）通过局部 `streamingMessage` 状态实时更新，不触发全历史重算。
- `run.completed` / `run.failed` / `run.cancelled` 终态时清空流式状态并刷新最新页，最终消息自动来自 Message Store。
- 向上滚动到顶部时触发分页加载（`beforeSequence` cursor），prepend 更早消息并保持滚动位置。
- `eventHistory` 仍供执行过程、待批准卡片、上下文圆环使用，但不再用于构建消息文本。
- Desktop 全量测试 534/534，typecheck/build 通过。
- S1 全部切片完成：Message Store → 分页协议 → final message 写入 → 旧事件回填 → ChatView 分页加载。

## 2026-07-27 · 会话上下文性能 S1 final message 写入

- Runtime `task.appendMessage` 现在把最终用户/系统/工具文本写入 `SqliteMessageStore`（thread 内 `nextSequence`）。
- `run.completed` 把助手终态写入 durable message（稳定 id `asst-${runId}`，幂等）；空回复不写。
- `message.attachImages` 在已有最终文本消息上 `updateBlocks` 合并 image `storageRef` blocks，不写 data URL。
- Message Store 新增 `nextSequence` / `updateBlocks`；真实 SQLite 与 Runtime 集成测试覆盖用户+图片+助手终态后的 `conversation.listMessages` 分页。
- 旧事件 backfill 与 ChatView 分页切换仍待做；现有 eventHistory UI 路径保持兼容。

## 2026-07-27 · 会话上下文性能 S1 数据层

- 新增 `0028_message_pagination`：以 `UNIQUE(thread_id, sequence)` 保证 thread 内稳定顺序，并增加 `run_id` 索引；遗留重复 sequence 会使迁移原子失败，不静默删改历史消息。
- 新增并导出 `SqliteMessageStore`：共享 `Message`/品牌 ID 写入与读取、同 ID 同内容幂等、冲突检测、thread 校验，以及默认 50/max 100 的 exclusive cursor 分页（SQL DESC、返回 ASC）。
- message blocks 增加数量、JSON 深度和 256 KiB UTF-8 上界；图片 `storageRef` 可往返，任何嵌套 `data:image/` 均拒绝持久化。
- 真实 SQLite 测试覆盖分页顺序/游标/thread 隔离、图片 blocks、幂等与冲突、非法输入、迁移索引和查询计划。
- S1 数据层 + 查询全链路完成：`conversation.listMessages` 已接通 shared/protocol、Runtime 持久库查询与 Desktop main/preload/renderer bridge；默认最新 50 条、最大 100、exclusive `beforeSequence`，按 thread 隔离且返回升序消息。
- ChatView 切换到分页消息源、旧事件回填和滚动加载仍待实施；本片不修改 UI，也不扫描 `eventHistory`。

## 2026-07-27 · 会话上下文性能 S0 基线与保护

- Runtime durable delta payload 不再嵌入不断增长的完整 `run` / reasoning 快照；运行恢复状态仍由 checkpoint/内存中的 `nextRun` 维护。
- 新增 1000 个 text/reasoning delta 的确定性 payload 字节上界，防止事件体积退化为 O(D²)。
- 新增 durable event/checkpoint 禁止 `data:image/` 的保护；本轮 provider 可使用 data URL，但不会进入持久化 payload。
- Desktop `RuntimeSession` 顺序 replay 改为数组原地追加，避免逐事件展开复制导致 O(N²)；增加 10,000 顺序事件数组身份测试。
- S0 完成时尚未实施 S1 message store；性能测试使用结构、计数和字节上界，不使用过紧墙钟阈值。

## 2026-07-26 · 审查 11 项复核 + 智能体库 P2 收口

- **审查报告 11 项复核**：对照工作树确认 1–11 均已落地（首轮不传欢迎页 modelId、Run 快照 fallback、Skill/MCP 进请求、空数组覆盖、删智能体归档、模型必选、rg 真实执行、工具 fingerprint、重启恢复选中、气泡身份展示）；相关 vitest 41/41 绿
- **智能体库 P2**：
  - 编辑表单分区：基本信息 / 模型 / Skill / MCP
  - 支持配置 `fallbackModelIds`、`skillIds`、`mcpServerIds` 并写入 create/update
  - 卡片展示备用数 / Skill 数 / MCP 数
  - 删除：有对话引用时归档并弹提示；小队成员拒绝删除时中文提示
- **小队库**：
  - 保存要求至少 1 名成员；错误可读
  - Runtime 删除小队时检查对话引用，有引用则拒绝（避免静默丢身份）
- **对话管理 / Compose**：搜索、归档区、删除确认、@文件 chips 链路已存在，本轮只核对无缺口
- 验证：desktop typecheck；shell-state + compose-mention + chat-tools + persona 相关测试；构建重启

## 2026-07-25 · 从服务商拉取导入弹窗 + 测试连接

- `provider.discoverModels` 支持 `persist: false` 预览模式：只探测供应商、返回 `discoveredIds` / `latencyMs`，不写入本地目录
- 模型详情底部对齐 NewMax：
  - `+ 添加模型`（手动）
  - 绿色文字「从服务商拉取模型列表」→ 打开导入弹窗多选
  - 全宽「测试连接」→ T1 探测，结果在按钮下方显示 `连接成功 · Nms`
- 导入弹窗：搜索 ID/显示名；已添加默认勾选；取消勾选更新后立即从优先级列表移除并重排；无数量上限
- 「完成」门闩：密钥草稿先提交；若未测过或 Base URL/密钥变更则先测试，通过后才关闭
- 验证：protocol/runtime/desktop typecheck；Desktop 测试；构建重启

## 2026-07-25 · 模型优先级拖拽不闪 + 密钥图三对齐 + 向后 fallback

- **拖拽跳动修复**：`setModelPriorities` 成功后改为局部 merge models，禁止全量 `load()` 与成功 Toast，避免详情滚回顶部
- **密钥 UI 对齐 NewMax 图三**：
  - 去掉 `primary` 标签与铅笔编辑入口
  - 整行掩码输入框 + 框内眼睛
  - 点眼睛显示明文并可直接编辑；失焦仅暂存草稿
  - 点击「完成」强制 `discoverModels` 测试连接；通过后才写入 secure-store 并关闭
  - 多行密钥仍支持，但不显示任何 label
- **供应商内 fallback（向后 walk）**：
  - `resolveProviderPriorityFallback`：从当前失败模型在 priority 链上的位置只向后走
  - 例：主 5.6 / 备 5.5 / 备 5.4；对话用 5.5 失败 → 5.4，不回 5.6
  - Runtime `tryContinueWithFallback` 先走供应商链，再走 Agent `fallbackModelIds`
  - 新增 resolution source：`providerFallback`
- 测试：core model-binding；Desktop ModelSettings 密钥/草稿；构建与重启验收

## 2026-07-25 · 模型密钥回显编辑与 NewMax 视觉收口

- 新增按 `credentialRefId` 的受控密钥链路：
  - `provider.revealCredential`：短时回显单条已保存密钥（默认 10 秒）
  - `provider.updateCredential`：按密钥 ID 更新标签/轮换密钥
  - Storage 增加 `getCredentialRefForProvider` / `updateCredentialRef`，禁止跨供应商误操作
- Desktop 桥接：Main 校验来源后转发 Runtime；密钥替换仍由主进程读取剪贴板，Renderer 元数据 payload 不携带 `apiKey`
- 模型设置页：
  - 每条已添加密钥均可点眼睛显示/隐藏，并支持编辑标签与替换密钥
  - 切换供应商、失焦、窗口隐藏、卸载时立即清除明文
  - 模型发现/手填收进原位「添加模型」展开区
  - 去掉 Provider 选中左侧绿色竖线；Responses 改为普通设置行
- 测试：storage 233/233；Desktop 63/63 文件、425/425 用例；protocol/runtime/desktop typecheck；runtime + desktop build；应用重启后 `hello accepted`

## 2026-07-24 · 对话过程总折叠与代码放大

- Assistant 每轮新增高于“深度思考/工具步骤/文件变更”的总过程层：执行中自动展开，完成后自动折叠；摘要直接显示深度思考、工具步骤数与文件变更数，避免大量过程卡平铺占满消息流。
- 总过程展开后仍保留二级细节：深度思考、各工具步骤及 Changes 均可独立查看；工具步骤在总层中改为更紧凑的嵌套行。
- 代码块增加：长代码展开/收起、全屏放大查看、`80%–160%` 字号缩放、复制、ESC/遮罩关闭；短代码仍保持紧凑。
- 文件工具标题直接显示路径，例如 `读取文件 · src/config.ts`、`写入文件 · docs/roadmap.md`，无需先展开才能知道目标；读取结果仍可在步骤内直接看到，写入/编辑内容继续进入文件变更预览。
- 过程投影补齐 `edit_file` 映射、`new_string` 预览和严格 run 隔离，避免无 run 事件串到其他回答的过程组。
- 验证：Desktop typecheck；Markdown/过程投影聚焦测试 15/15；Desktop build；`git diff --check`。

- 继续以用户最新八张 NewMax 截图为唯一结构基准，完成使用统计全过程：
  - 时间范围改为 `24h / 近 7 天 / 近 30 天 / 全部` 分段选择器
  - 四项 KPI 改为四张独立卡片，卡间 `12px`；顶部、二级 Tab 与表格节奏按截图收紧
  - 供应商表补齐请求数、总 Token、总费用、请求成功率、工具成功率、平均延迟
  - 模型表补齐请求数、总 Token、总费用与单次均费
  - 工具页补齐总调用/成功/失败/成功率、模型级统计、工具明细与最近失败记录
- 定价配置按 NewMax 的八列表格实现：模型 ID、显示名、币种、输入/M、输出/M、缓存读/M、缓存建/M、操作；支持添加、编辑、删除并持久化到 `app_setting['model-pricing']`。
- 初次使用展示截图中的 Claude 定价基线；用户保存后完全以本机配置为准。费用按输入、输出、缓存读、缓存建分别估算，并按 USD/CNY 分币种展示，不伪造汇率。
- Runtime 从 durable tool requested/completed 事件重建成功/失败；新工具结果额外标记失败和错误摘要，但继续保持既有 `tool.completed` 事件契约，避免破坏历史投影。
- 验证：protocol/runtime/desktop typecheck；Runtime 246/246；Desktop 399/399；全仓 build 11/11；`git diff --check`。测试需将 TEMP 指向 D 盘（本机 C 盘临时目录仅余约 36MB）。

## 2026-07-24 · NewMax 模型设置与使用统计对齐

- 以用户提供的 NewMax 截图为唯一页面结构基准，不再自行发明模型管理后台布局：
  - 设置分类栏 + 启用模型栏 + Provider 详情栏
  - 文本/图像/视频/语音/使用统计媒体 Tabs
  - 启用模型首项标记“默认”，支持启停与真实顺序调整；停用项进入独立折叠区
  - Provider 详情保留名称、Base URL、API 格式、多密钥、模型优先级、模型发现/手填与 Vision Fallback / Plan & Act
- 使用统计改为 NewMax 结构：
  - 顶部 4 项：总请求、总费用、总 Token、缓存 Token
  - 二级 Tabs：请求日志、供应商统计、模型统计、工具统计、定价配置
  - 请求日志支持时间范围、模型筛选、状态筛选、详情开关；表字段为时间/供应商/模型/Token/费用/延迟/状态
  - `usage.summary` 从 durable `provider.usage`、run 终态与 `tool.requested` 重建真实请求日志、延迟、供应商/模型/工具聚合；没有真实价格或缓存用量时显示 `—`，不伪造数据
- 供应商密钥继续遵守 Renderer 安全边界：表单值先写系统剪贴板，由主进程读取后送 Runtime；Renderer/preload 元数据类型不携带 `apiKey`
- 验证：protocol/runtime/desktop typecheck；Provider 安全边界 15/15；Provider Runtime 命令 5/5；Desktop build

- **根因 A（消息发送后图片消失）**：图片只存在 renderer optimistic state；durable `message.appended` 只有文本，投影按文本清理 pending 后图片立即消失，重开对话也无法恢复
- **根因 B（当前模型看不到图片）**：实际协议为 `openai-responses`，Responses adapter 把多模态 `content[]` 压成纯文本，静默丢弃 image part
- **修复**：
  - Desktop staging 后把图片复制到应用管理的 `message-images` 目录，事件只保存轻量 `storageRef`，不保存任意路径或 base64
  - 新增 `message.images-attached` durable event；投影按真实 `messageId` 关联图片，不再按文本去重
  - 自定义安全协议 `sync-think-image://media/<ref>` 为消息气泡和 lightbox 提供重开后图片
  - OpenAI Responses 序列化 `input_text + input_image`；OpenAI Chat/Anthropic 原多模态路径保持
  - Demo run 改存 staging ref，provider 调用前才解析 data URL，避免图片 base64 在每个 delta/event/checkpoint 中重复膨胀
  - 图片总数限制为 8；读取失败给可见错误；发送失败恢复附件
- 验证：adapters 多模态 18/18；runtime staging 1/1；desktop event history / compose 29/29；protocol/adapters/runtime/desktop typecheck；`git diff --check`

- 设置视觉不再以“NewMax-style”自行设计，改为以用户提供的 NewMax 截图为结构基准：
  - 居中 `1064×720` 上限设置窗口、约 `188px` 左栏、克制遮罩/圆角/阴影
  - 左栏含“设置 / Ctrl ,”、搜索框与 NewMax 同层级分类入口；未接能力只保留入口并明确未接，不伪造功能
  - 右侧固定页标题、内容区与右下角“完成”；ESC、遮罩和右上角 × 均可关闭
  - 通用页改为“通用 / 个性化”分段、标题+说明+右侧开关的设置行、底部三档权限模式；移除自创的大卡片墙
  - 主题页压缩为 NewMax 式紧凑外观选项
  - 模型页增加文本/图像/视频/语音/使用统计 Tabs；文本页改为“启用模型列表 + Provider 详情”三栏关系，首个启用项显示默认；使用统计移入模型页 Tab
- 设置 Modal 打开时，主侧栏“设置”入口同步保持选中；Provider 修改后触发 Shell catalog 刷新，关闭设置后模型选择器不再停留旧目录
- 动画开关继续控制全局动画，同时完整尊重 `prefers-reduced-motion`
- 验证：Desktop typecheck；shell build；产品壳聚焦测试 27/27；`git diff --check`

- **`runtime.unavailable` 根因与修复**：
  - Desktop 过去直接使用 PATH 中的 `node.exe`；当前系统为 Node 24，而 Runtime 的 `better-sqlite3` 按 Node 20 构建，子进程会在打开 named pipe 前退出
  - supervisor 现在搜索并校验 Node 20（支持 `SYNC_THINK_NODE_BIN`、release `resources/node`、pnpm managed Node 与 PATH），找不到时返回明确失败，不再启动错误 ABI 的 Runtime
  - 健康 Runtime 默认复用；仅 `SYNC_THINK_RUNTIME_FORCE_RESTART=1` 时回收重启，避免重复 Runtime 抢占 pipe 导致 `EADDRINUSE`
  - release 入口预留 `resources/runtime/main.js` 与 `resources/node/node(.exe)`，打包时必须随应用分发
- **设置弹窗（NewMax 对齐）**：
  - 使用 Radix Dialog，原生支持 ESC、遮罩关闭、焦点管理和无障碍语义
  - 改为大尺寸居中 application sheet：独立标题栏、左侧分类导航、右侧内容区，聊天保持在模糊遮罩后
  - 尺寸约束 `min(1080×760, viewport-72px)`；窄窗口自动贴近全屏；模型双栏页保留独立滚动
  - 动画开关继续控制全局 transition/animation；关闭后 Modal 瞬开瞬关
- 验证：desktop typecheck/build；runtime-session/runtime-connection/shell-state 聚焦测试 16/16；冷启动确认 Desktop 自动选择 Node 20 且 Runtime pipe 可用

- **目标**：设置 → 模型 可完整导入与管理模型源；使用统计可查请求/token
- **数据层（0026）**：
  - `provider.enabled` / `provider.sort_order`
  - `model.priority` / `model.credential_ref_id`
  - `app_setting` KV（`vision-fallback` / `plan-act`）
  - store：`reorderProviders` / `addCredentialRef` / `removeCredentialRef` / `setModelPriorities` / `removeModel`
- **协议 + Runtime**：
  - `provider.reorder` / `addCredential` / `removeCredential` / `setModelPriorities` / `removeModel`
  - `settings.get` / `settings.set`
  - `usage.summary`（从 provider.usage 事件聚合，补 displayName）
  - create/update 的 `apiKey` 经主进程 clipboard 中转写入安全存储；Renderer/preload 元数据不携带密钥
- **Desktop bridge**：main/preload/global.d 全量透传上述命令
- **设置 UI（新壳）**：
  - 双栏模型源：左列表（启停 + 排序）/ 右详情（端点、API 格式、多密钥、模型优先级、发现/手填）
  - 全局 Vision Fallback + Plan & Act
  - 使用统计页：24h / 近 7 天 / 近 30 天 / 全部时间
  - 停用供应商从对话模型选择器隐藏
- 验证：storage 232/232；protocol/storage/runtime/desktop typecheck；shell+runtime rebuild；Desktop 热重启 hello accepted

## 2026-07-23 · 联网开关真正生效（web_search / web_fetch）

- **原状**：Compose 地球图标只改本地 `netEnabled` 状态，不进 Runtime
- **修复**：
  - `appendMessage.networkEnabled` → `DemoRunState` → 本轮暴露 `web_search` / `web_fetch`
  - 无项目文件夹也可仅用联网工具；system prompt 说明开关状态
  - `web_fetch` 禁私网/本地主机；`web_search` 用 DuckDuckGo Instant Answer（免 Key MVP）
- 验证：chat-tools 单测；protocol/runtime/desktop rebuild

## 2026-07-23 · Vision 静默丢图诊断

- **现象**：图片已落 staging，但模型仍称「看不到图」时难以判断是解析失败还是 provider 未吃到 image parts
- **修复**：
  - Desktop 落盘 staging 时 log `staged chat image`（path/bytes）
  - Runtime resolve 失败逐项 warn；全部失败明确「model will only see text」
  - 发往 provider 前核对 `run.images` vs 末条 user 的 image parts 数量
- 验证：staging 可读 + pipe ready；runtime/desktop rebuild

## 2026-07-23 · C 盘满导致 Runtime SQLITE_FULL + 数据目录迁 D

- **现象**：发图后 `database or disk is full` / append 失败；C: 仅剩约 14MB
- **处理**：清理 `SYNC-THINK/backups`（约 3GB）与部分 Temp；DB 复制到 `D:/projects/MYSELF/SYNC-THINK/.data/SYNC-THINK/`
- **代码**：managed Runtime 默认把 `SYNC_THINK_DB_PATH` / `SYNC_THINK_CHAT_IMAGE_STAGING` 指到 monorepo `.data`，避免再被 C: 塞满拖死

## 2026-07-23 · 图片 pipe 1MB 上限：磁盘 staging + 发送前压缩

- **根因**：named pipe 帧 `MAX_FRAME_BYTES = 1 MiB`；截图 data URL base64 常 2–3MB+，`task.appendMessage` 无法把图送到 Runtime，模型只看到文本
- **修复**：
  - Desktop 主进程把图片写入 `%LOCALAPPDATA%/SYNC-THINK/chat-image-staging/`，pipe 只传 `stagingPath`
  - Runtime 读 staging 文件再组多模态 content
  - 渲染层发送前 canvas 压缩（长边≤1600，JPEG）降低 provider 体积
- 验证：runtime chat-image-staging 单测；desktop/runtime rebuild + 热重启

## 2026-07-23 · 修复图片仍被模型当「路径」：Runtime 热重启 + 消息拼装

- **根因 A**：Desktop 重建后旧 Runtime 仍占 named pipe，supervisor 见 pipe 通就复用 → 新多模态代码未加载
- **根因 B**：用户正文里夹了「附件图片：- xxx.png」文本，模型按文件路径理解
- **修复**：
  - supervisor 每次 Desktop 会话首次连接强制回收 orphan Runtime（PID 文件 + taskkill），再拉起最新 `runtime/dist/main.js`
  - `buildMessageWithAttachments` 不再写「附件图片」文本 footer；图片只走 `images[]`
  - `buildChatMessagesFromEvents` 有图时强制把末条 user 升级为多模态 content
- 验证：rebuild runtime/desktop；冷启动后发图应不再出现「路径不存在」

## 2026-07-23 · 图片多模态真正下发 + 拖拽上传

- **下发**：`appendMessage.images[]`（data URL）→ `DemoRunState.images` → `buildChatMessagesFromEvents` 多模态 content → OpenAI `image_url` / Anthropic `image.source`
- **持久化策略**：图片不写进 durable event 大 blob（只当前 run 使用）；历史轮次仍以文本「附件图片」说明
- **Compose**：支持拖入图片到输入区（拖拽高亮）；原有选图/粘贴保留
- 验证：chat-tools + stream-chat 单测；protocol/runtime/desktop build

## 2026-07-23 · 启动卡住修复 + 推理菜单纯文字

- **根因**：Desktop 只连 named pipe，不会自动拉起 Runtime；重建/冷启动若未先跑 `pnpm dev:runtime`，侧栏长期「加载中…」，点击像没反应
- **修复**：
  - 主进程 `runtime-supervisor`：pipe 不通时自动 spawn `apps/runtime/dist/main.js` 并等待就绪
  - Shell 启动用 `startRuntimeConnection` 可重试（给 Runtime 起服时间）
  - 退出时 stop 托管 Runtime
- **推理菜单**：去掉图标与说明，仅文字档位（自动/关闭/低/中/高/超高/极限）
- **Release 说明**：正式版同样必须内置/随启 Runtime；仅打包 Electron 壳仍会连不上。supervisor 是正确方向
- 验证：desktop typecheck + shell build

## 2026-07-23 · Compose 图片上传 + 自适应高度 + 固定推理全档

- **推理强度**：固定全阶梯 自动/关闭/低/中/高/超高/极限（不再按模型筛选）；权限/推理菜单项加左侧图标，减少「空列表感」
- **输入框自适应**：textarea 随内容增高（约 56–220px），对齐 NewMax
- **图片上传**：底栏 ImagePlus；支持选择多图、剪贴板粘贴；chip 缩略图；消息气泡内可点开 lightbox 大图
- 说明：图片目前为本地预览 + 文本侧车说明，尚未走多模态 provider 上传
- 验证：compose-toolbar / compose-mention 单测；shell build

## 2026-07-23 · 推理强度按模型动态档位（已回退为固定全档）

- 曾短暂按 modelId 启发式裁剪档位；用户要求先固定全档 + 超高/极限，故取消筛选

## 2026-07-23 · 桌面默认启动新壳（renderer-shell）

- **根因**：`electron .` 未设 `SYNC_THINK_SHELL=1` 时加载旧任务板 `dist/renderer`，看起来像「一夜回到解放前」
- **修复**：主进程默认加载 `renderer-shell`；`SYNC_THINK_SHELL=0|false|legacy` 才回旧壳
- 验证：rebuild main + 重启

## 2026-07-23 · 推理强度真正下发 + 深度思考块

- **Compose 推理强度**：`appendMessage.reasoningEffort` 经 runtime `prepareRunBinding` → `DemoRunState` → `ProviderCallRequest` 下发到 OpenAI/Anthropic/Responses adapter
- **Adapter**：`reasoning_effort` / Anthropic `thinking.budget_tokens`；解析 `reasoning_content` / thinking_delta / responses reasoning 为 `reasoning-delta` 事件
- **投影**：`message.reasoning_delta` 与 `run.completed.reasoningText`；不与正文混写
- **UI**：助手消息上方可折叠「深度思考」块（有数据才显示；思考中默认展开）
- 验证：adapters reasoning + stream-chat；runtime demo-run.reasoning；desktop event-history；typecheck/build

## 2026-07-23 · 修复 Compose 菜单/@ 被 overflow 裁切

- **根因**：聊天列 / 页面 flex 容器 `overflow-hidden`，菜单与 @ 列表向上弹出时只露出一截，看起来像「只有一项」
- **修复**：权限/推理/模型菜单、@ 文件列表改为 `createPortal` + `position: fixed` 锚定触发器；点击外部关闭时忽略触发按钮自身
- 验证：desktop typecheck + shell build

## 2026-07-23 · Compose 菜单/模型选择对齐 NewMax

- **权限 / 推理**：点击弹出菜单（标题+说明+勾选），不再点击循环
- **模型**：厂商 → 模型 两级选择（搜索、返回、当前模型），去掉原生 select 平铺
- **@**：仅输入 `@` 触发引用，底栏不再放 @ 按钮
- **上下文环**：按当前模型估算窗口上限 + 已用 tokens（usage 事件或本地字符粗估）
- 验证：desktop typecheck + shell build

## 2026-07-23 · Compose 输入栏对齐 NewMax（附件 chip + 底栏工具）

- **@ 选中**：不再插入 `@path` 文本，改为上方附件 chip（文件名 + 移除）
- **发送**：正文 +「引用文件」列表一并交给模型
- **底栏工具**（对照 NewMax 图标语义）：
  - 盾牌 = 权限三档
  - 地球 = 联网开关
  - 大脑 = 推理强度（自动/低/中/高）
  - 拼图 = Skill 占位
  - @ = 打开文件引用
  - 右侧模型选择 + 上下文环占位 + 圆形发送
- 验证：compose-mention 测试；desktop typecheck + build

## 2026-07-23 · 执行步骤 UI 对齐 NewMax 工具卡

- **去掉外层「执行过程 · N 步」大框**，每步独立卡片
- 标题中文：`读取文件` / `执行命令` / `列出文件` + 状态勾选
- 展开体字段：`Path` / `Command` / `Output`（像 NewMax 详情）
- 运行中与最近两步默认展开，其余可点开
- 验证：desktop typecheck + shell build

## 2026-07-23 · P2 Compose @ 文件引用

- **主进程** `desktop:list-project-files`：在绑定项目根目录下遍历文件（跳过 node_modules/dist/.git 等），支持模糊过滤 + 数量/深度上限
- **Compose**：输入 `@` 弹出文件选择器；↑↓ 选择 / Enter·Tab 插入 / Esc 关闭；插入为 `@相对路径 `
- **未绑定项目**：弹出层提示需先绑定文件夹
- 验证：compose-mention + project-files 单测；desktop typecheck + build

## 2026-07-23 · P2 对话管理：侧栏搜索 + 归档区

- **搜索**：最近对话顶部搜索框，本地过滤标题 / 目标显示名 / targetRef
- **归档区**：`listConversations({ includeArchived: true })`；侧栏底部可折叠「归档」；菜单支持取消归档
- 验证：shell-state 测试；desktop typecheck + shell build

## 2026-07-23 · 「询问批准」改为确认卡（非直接禁写）

- **语义修正**：`ask` 不再隐藏/硬拒 `write_file`/`run_command`；模型仍可请求，runtime 挂起并 emit `tool.approval_requested`
- **用户确认**：消息流出现批准卡（路径/命令 + 批准/拒绝）；`conversation.decideToolApproval` 继续或拒绝工具循环
- **workspace / full-access**：仍自动执行项目内写/命令
- 验证：chat-tools 测试更新；protocol/runtime/desktop 构建

## 2026-07-23 · P1 收尾：权限三档生效 + 停止生成

- **权限持久化**：Compose 权限 pill 切换时调用 `setConversationExecutionMode` 落库，失败回滚本地态
- **权限生效**：runtime 按 `conversation.executionMode` 裁剪内置工具；`ask/read-only` 仅只读工具，`write_file/run_command` 本地拒绝并返回中文提示；system prompt 同步声明权限档
- **停止生成**：流式中 Compose 发送钮变停止，调用 `run.cancel`；demo run 持有 `AbortController`，取消时中止 provider 流与工具循环
- 验证：chat-tools 4/4；storage/runtime/desktop 构建通过

## 2026-07-23 · 文件变更 UI 精修（对齐 NewMax 编辑器感）

- **消息内卡片**：去掉嵌套边框，扁平行 + chevron 展开；单文件默认展开，多文件列表优先
- **代码预览**：highlight.js 按扩展名高亮；软 gutter（无竖线）；行高/字号贴近编辑器
- **右栏 Changes**：加宽 360px；文件列表 + 编辑器顶栏（文件名/路径/A|M|D）+ 全高预览
- 验证：desktop typecheck + shell build；execution-process 6/6

## 2026-07-23 · 文件变更内联内容预览（对齐 NewMax）

- **根因**：`write_file` 的 tool result 只有 `{created, bytes}`，投影层把 preview 写成「已写入」；真正正文在 `arguments.content`，且常只出现在 `tool.requested`
- **修复**：
  - `projectExecutionProcess` 从 write 参数提取正文，跨 requested→completed 缓存 content
  - `fileChanges.preview` / 步骤 preview 改为文件正文（带行数截断）
  - `FileChangesCard` 默认在路径下内联带行号的代码预览
  - 右栏 Changes 同步用 `CodePreview` 展示正文
- 验证：execution-process 6/6

## 2026-07-23 · 冷启动不再等全量事件回放

- **根因**：`RuntimeSession.connect()` 会 `await subscribeEvents(0)` 把历史事件全部 catch-up 完才返回；Shell 又在 `connect().then(refresh)` 之后才 `listConversations`，所以打开应用要等很久侧栏才有对话
- **修复**：
  - `connect()` 只等 pipe/hello + healthcheck，事件回放改后台追赶
  - 事件去重改为 `Set` O(1)，顺序追加避免每条事件全量 merge
  - Shell 显示「加载中…」状态，连接成功后立刻刷对话列表
- 验证：`runtime-session` 2/2、desktop typecheck + full desktop build

## 2026-07-23 · 执行过程默认直出路径 + 右栏去掉过程

- **过程步骤默认可见**：`Read/List/Edit/Bash` 后直接显示路径或命令，无需点开；附一行结果摘要
- **输出预览改为可选**：「查看输出」才展开全文，避免默认刷屏
- **文件变更卡片**默认列出全部改动文件
- **右栏去掉「过程」Tab**，避免与对话内执行过程重复；右栏只保留 Changes / 任务
- 验证：desktop typecheck、shell 构建、execution-process 5/5

## 2026-07-23 · 执行过程明细 / 消息底栏 / 文件变更 Changes（对齐 NewMax）

- **执行过程明细卡**：步骤标题中英混合（`Read · path` / `Bash · cmd`）；可点开看路径、命令、输出预览、exit code；相邻同操作合并 `×N`
- **消息底栏**：助手消息底部固定「复制 / 重新生成 / 分享」；分享先复制 Markdown；有 `provider.usage` 时显示 token
- **文件变更卡片**：聚合本轮 `write_file` 为「已更改 N 个文件」；支持展开全部 / 侧栏查看
- **右栏 Changes Tab**：文件列表 + 预览；从消息卡片或过程路径点入自动打开
- 验证：desktop typecheck；shell 构建；聚焦测试 **15/15**

## 2026-07-23 · 聊天多轮上下文 + 工作区文件工具

- **根因 A（看不到上下文）**：聊天 run 只发「当前这一句」`userText`，没有把同 thread 的历史 user/assistant 轮次喂给模型
- **根因 B（读不到目录）**：聊天路径既没注册 `list_files/read_file` 等内置工具，也没在模型请求 tool-call 后本地执行；且仅当对话所属 workspace 绑定了真实 `folderPath` 才可启用文件工具
- **修复**：
  - `buildChatMessagesFromEvents` 从 durable events 组装多轮上下文
  - 绑定项目文件夹时注入 `CHAT_BUILT_IN_TOOL_SCHEMAS`，并在 `tool-requests` 后本地执行工具再回灌模型
  - 未绑定文件夹时 system prompt 明确告知不可读本地目录；ChatView 顶部显示「未绑定项目文件夹」警告
- 验证：runtime/desktop typecheck；chat-tools + demo-run **8/8**；shell 重建

## 2026-07-23 · 新壳消息悬停操作条 + 对话内执行过程块

- **悬停操作条**：用户/助手消息悬停显示「复制」按钮（NewMax 式轻量浮层），复制成功显示「已复制」
- **对话内执行过程**：助手消息上方可折叠「执行过程 · N 步」；从 eventHistory 投影 tool requested/completed/failed；相邻同标签合并 `×N`；流式时默认展开
- 新增 `execution-process.ts` / `ExecutionProcessBlock.tsx`；单测 3/3；shell 构建通过

## 2026-07-23 · 新壳消息 Markdown + 代码高亮（对齐 NewMax）

- **助手消息**改为 GFM Markdown 渲染（标题/列表/引用/表格/任务列表/链接），不再纯文本 `pre-wrap`
- **代码块**：语言标签 + 一键复制 + highlight.js 语法着色；行内 code 单独样式
- **流式**：输出中显示光标；用户消息保持纯文本密气泡（更接近 NewMax）
- 新增 `shell/MarkdownContent.tsx` + 样式 token 化（深浅色）；单测 3/3 通过
- 依赖：desktop 增加 `react-markdown` / `remark-gfm` / `rehype-highlight` / `highlight.js`

## 2026-07-23 · 新壳重进对话恢复历史消息

- **根因**：ChatView 打开时清空本地消息，只监听实时 `message.delta` / `run.completed`，从不加载 connect snapshot / 事件历史；`Conversation` 摘要也未暴露 `taskId`，无法解析 thread。
- **修复**：
  - `Conversation` / `toConversationSummary` 带出 `taskId`
  - ShellApp 维护 shell 级 `eventHistory`（connect snapshot + live `onEvent`）
  - ChatView 用 `openTask` 解析 `threadId`，再以 `projectConversation(eventHistory, threadId)` 投影用户/助手消息
  - 发送仍走乐观本地气泡，等 durable history 落地后自动去重
- 验证：desktop typecheck + 新壳构建；实窗重开已有对话应看到历史消息。

## 2026-07-23 · P1.1 对话↔任务绑定（数据层）

- **迁移 0025 `conversation_task_binding`**：`conversation` 表新增可空 `task_id` 列 + `conversation_task_idx` 索引；对话首条消息惰性创建的 task 将绑定于此（一对话一 task）。
- **`SqliteConversationStore.bindTask()`**：幂等绑定——已绑同 task 直接返回，绑不同 task 抛错，守住「一对话一 task」不变量；`ConversationRecord`/`get`/`SELECT` 均带出 `taskId`。
- **测试**：team-model 新增 bindTask 幂等/拒绝用例；migrate / artifact-store / reviewer-rework 的迁移序断言同步到 0025。storage 全量 **232/232**、`tsc` + 构建通过（Node 20 运行 vitest）。
- **说明（下一片 P1.2 前需定）**：runtime 侧「首条消息惰性建 task」尚未接——现有 `createTask` 必须绑定 workspace 且硬编码 `participation_mode='conversation'`，而对话可为「未归类」（无 workspace）。需先定：未归类对话的 task 落在哪个 workspace（收件箱/默认），以及 track→participation_mode 映射（当前二者正交、无映射）。

## 2026-07-23 · 新壳侧栏微调：⋯ 悬停菜单 + 可收起面板

- **行操作改悬停 ⋯ 菜单**：会话行去掉右键 ContextMenu，改为悬停/置顶时浮现的 `⋯`（MoreHorizontal）按钮，点击打开 Radix DropdownMenu（重命名 / 置顶 / 归档 / 删除），对齐 NewMax 交互；菜单打开时按钮保持可见，点击不误触打开对话。置顶态单独常显图钉。
- **侧栏可收起**：`ShellNavState.sidebarCollapsed` + `toggleSidebar` reducer；展开态标题栏有收起按钮，收起后为 52px 图标轨（一级导航图标 + 展开按钮）。
- 验证：shell-state 测试 **7/7**、desktop `tsc --noEmit`、新壳构建通过；bundle 含 `conversation-menu-trigger` / `sidebar-toggle`。

## 2026-07-22 · 新壳 P0 完成：选择弹窗 / 标题 / 顶栏项目 Tab / 右键菜单

- **P0.1 标题**：侧栏与会话头不再显示裸 targetRef；模型对话经 Provider 目录解析显示名，未命中兜底「模型对话」。
- **P0.2 新建选择弹窗**：三个 ＋ 打开 Radix Dialog；模型按厂商两级分组 + 搜索；智能体/小队列表带空态「去库创建」跳转；选中即建并打开。
- **P0.3 顶栏项目 Tab**：「全部」+ 项目 Tab（悬停显示路径）+「＋打开文件夹」（pickFolder→createWorkspace）；对话按项目过滤，新对话归属当前项目；无项目时「未归类」正常可用。
- **P0.4 右键菜单**：会话行 Radix ContextMenu：重命名（prompt）/ 置顶 / 归档 / 删除（二次确认）；删除/归档当前会话时清除选中态。
- 验证：shell-state 测试 **6/6**、desktop `tsc --noEmit`、新壳构建通过；实窗验收通过（P0.1–P0.3 用户已确认，P0.4 本条随附）。
- 规格状态更新：`2026-07-22-full-roadmap-newmax-parity.md` P0 标记完成，下一阶段 P1（聊天核心）。

## 2026-07-22 · 可变 Agent/小队真表 + 一等对话 + NewMax 壳重写启动

- **数据模型（迁移 0024）**：新增可变 `agent` / `team` / `team_member` / `team_run` / `conversation` 五表；`agent` 由旧 `agent_version` 链每个 agentId 的最新版本一次性种子；未发布的 `team_template*` 三表 DROP。编辑即 UPDATE，无版本链；唯一历史是小队开跑时冻结进 `team_run.roster_snapshot_json` 的成员快照（进行中 Run 不受后续编辑影响）。
- **权限唯一旋钮**：`conversation.execution_mode` 是产品里唯一权限面；agent / team_member 表不含任何权限列。置顶（pinnedAt）为 DB 真源，替代本机 UI 偏好置顶。
- **协议与 Runtime**：新增 18 条命令（globalAgent 4 + team 6 + conversation 8），含 payload 严格校验、事件发布、错误映射；`upgradeTrack` 仅允许 model→agent/team。Desktop main IPC / preload 桥 / global.d.ts 全链接通。
- **新渲染层骨架**（`src/renderer/shell/`，Tailwind v4 + Radix + lucide）：NewMax 风格 design tokens（深浅色跟随系统）、最近对话三分组侧栏（各组独立 +、置顶、树状层级）、舞台切换；`SYNC_THINK_SHELL=1` 加载新壳，旧 renderer 并行保留至功能对齐。
- 规格：`docs/superpowers/specs/2026-07-22-mutable-team-model-and-shell-rewrite.md`（Locked）。
- 验证：storage **231/231**（含新模型 11 项与迁移断言更新）、runtime 聚焦 **11/11**、protocol **16/16**、desktop shell **5/5** + `tsc --noEmit`、全仓 `pnpm build` **11/11**。

## 2026-07-23 · 最近对话层级与置顶

- 左栏取消 `模型 / 智能体 / 小队` 平铺切换与 `今天 / 昨天 / 近 7 天 / 更早` 日期分组，改为 `最近对话 → 模型对话 / 智能体对话 / 小队对话 → 会话` 的可折叠层级。
- 每个对话类型标题右侧提供独立 `+`；新建后固定归入对应类型，Compose 不再承担对象类型切换。
- 会话行新增置顶/取消置顶，置顶项只在所属类型内提到前面，不跨类型重排；折叠状态、置顶和兼容期 track 元数据保存在本机 UI 偏好。
- 左栏视觉收敛为 NewMax 式安静密度：弱化品牌、分隔与大按钮，统一深浅色 token、hover/focus/选中态，并保留键盘可达与减少动画支持。
- 本轮不更换 Electron + React 技术栈：现有栈足以实现目标视觉，换栈不能替代信息架构、组件层级和 token 设计。
- 验证：Desktop 聚焦测试 **28/28**、typecheck、Desktop build 通过。

- 规格锁定：`docs/superpowers/specs/2026-07-22-newmax-shell-nav-agent-model.md`（权限只跟对话、Agent 默认 Skill 进项目可用、子任务默认嵌本对话、分屏 P0/P1、统筹代审等）。
- Desktop 主导航改为 NewMax 式一级：`对话 / 项目 / 智能体 / 小队 / 能力 / 设置`；对话下增加三轨 `模型对话 / 智能体对话 / 小队对话`。
- 新增 `product-shell-nav.ts` 投影主舞台、右栏产品 Tab、Compose talk target 与升级规则；遗留 left-instrument 仅作抽屉兼容映射。
- Compose 增加对象选择器骨架：`模型 | 智能体 | 小队`，与左侧 talk track 双向同步；权限仍为对话级三档，不给 Agent 再配权限。
- 分屏能力写入规格：P0 右栏弱分屏，P1 双对话分屏与项目「对话|文件」分屏。
- 验证：Desktop 导航相关 **26/26**；UI Kit Compose **33/33**；`@sync-think/ui-kit` build；`@sync-think/desktop` `tsc --noEmit` + build 通过。

## 2026-07-16 · 对话优先工作区与自动协作升级

- 左侧项目树不再常驻显示绑定目录或“未绑定文件夹”副标题；完整目录只在项目 hover / focus tooltip 中出现。
- Compose 新增项目入口和项目菜单，项目、Agent、模型统一在输入区切换；切换项目会恢复该项目最近任务，没有任务时明确引导新建。
- 新建任务直接生成内部占位标题，不再弹命名框；首条用户消息会在同一个 CAS 事务中自动推导标题与目标，避免消息成功但命名丢失。
- 任务头移除重复的当前队友、模型摘要和手动 `对话 / 协作 / 自动` 切换；底层 participation mode、不可变计划版本与审批闸仍保留。
- 对话会识别显式多 Agent / 小队 / 分工 / 并行意图以及多阶段复杂任务，在原对话页自动升级到 collaboration，并按已配置的精确 AgentVersion 生成可编辑计划；计划仍需用户批准后才执行，不静默替换模型。
- Desktop 旧的 Automatic CTA 源码契约已更新为对话升级契约；Runtime 临时目录清理在已复现路径加入 Windows 原生重试，Runtime 集成测试预算调整为 15 秒以覆盖全仓并行负载。
- 验证：根 `pnpm test` **20/20 tasks**，Desktop **356/356**，Runtime **225/225**；`pnpm typecheck` **20/20 tasks**；`pnpm build` **11/11 tasks**；`git diff --check` 通过。
- 视觉验收：静态 Renderer 在 **1440×900** 与 **1280×720** 均无横向溢出，任务头、Compose、项目菜单和左右轨无重叠；浏览器预览实测新建任务无命名弹窗。
- 已知门禁债务：根 `pnpm lint` 在读取源码前因缺少 ESLint 9 `eslint.config.*` 全包失败，本轮不将 lint 记为通过，也不在交互改版中扩大全仓 lint 配置范围。

## 2026-07-16 · 本地工具执行纵切与桌面折叠轨修复

- File Worker 已支持受限读文件、列目录和原子写文件；Terminal Worker 以命令 capability allowlist、固定 `cwd`、无 Shell、超时/取消和输出限幅执行；Git Worker 以固定 argv 提供 `status / diff / log / branch`。
- File、Terminal、Git 在执行前同时校验词法路径和真实路径，拒绝 `..`、绝对路径及 symlink/junction 逃逸；文件删除继续禁用，Windows `.cmd/.bat` 仅通过严格包装执行并拒绝变量展开、引号和连接元字符。
- Production Executor 已接入 `read_file / list_files / write_file / run_command / git_status / git_diff` 工具循环；仅对已绑定项目目录、声明 `tool-calling` 的模型和普通执行 Step 开放。
- 动态工具调用复用 Scheduler 审批策略：请求先持久化并进入 `awaitingApproval`，批准后以同一 Step 和幂等键恢复；`0023_provider_execution_checkpoint` 单独保存循环检查点。
- OpenAI Responses、OpenAI Chat Completions 和 Anthropic Messages 已支持工具 schema、流式工具调用与结果回传；任务最终产出正文 Artifact 和 JSON 工具轨迹 Artifact，密钥不进入 Renderer、提示词、日志或工具轨迹。
- 桌面主操作文案收敛为“准备协作计划”，移除右轨重复 CTA；折叠右轨固定为仅图标控制，不再把标题和说明压成竖排文字。
- 验证：根 `pnpm test` **20/20 tasks**、`pnpm typecheck` **20/20 tasks**、`pnpm build` **11/11 tasks**；静态桌面 1440×900 与最小宽度 1280×720 无横向溢出、控件重叠或按钮文字溢出。
- 已知门禁债务：默认 `pnpm lint` 未适配 ESLint 9 flat config；以 legacy 配置兼容运行后，4 个包通过、7 个包仍有存量空接口/规则插件/正则与旧测试 lint 错误，本轮不将 lint 记为通过。
- 当前边界：Browser Worker、Windows UIA Worker、图像生成完整管线、安装器/签名/自动更新仍未实现，Phase 3 仅为部分完成。

## 2026-07-16 · 对话中的 Agent 成为可见协作者

- 任务顶部结构位从误导性的 `决策 / 记忆 / 上下文` 改为 `工作区 / 任务 / 对话`。
- M1/M2 完成后，开发验收用的 `M1 验证` 工作台退出普通产品界面；历史投影与证据未删除。
- 助手消息恢复 Agent 身份，但不恢复厚重消息卡：左侧圆形头像、名称、流式状态与右侧无框 Markdown 正文组成一条轻量队友消息。
- 消息从 `run.started.agentVersionId` 解析精确不可变 AgentVersion；历史消息可区分不同 Agent，旧消息有当前绑定 Agent 回退。
- Agent 图标支持 `bot / workflow / planner / executor / image / reviewer` 等 Lucide 映射、Emoji 和名称首字回退，颜色仅作为辅助身份信号。
- 点击头像或名称可打开对应智能体中心；模型、凭证与 Run 元信息继续留在 Trace / Manifest。
- 验证：UI Kit **215/215**、Desktop **323/323**、全仓强制 test **20/20（0 cache）**、typecheck **20/20**、build **11/11**；Electron 重启与头像跳转实窗通过，stderr 0 bytes。

## 2026-07-15 · M1 dogfood 门槛改为一天并关闭 M1

- 用户明确将 M1 dogfood 门槛从 3 个真实日期改为 **1 个真实使用日**；自动化和脚手架仍不计数。
- 新增 `m1-dogfood-policy.ts` 作为 Desktop 单一真源，产品默认 `M1_DOGFOOD_REQUIRED_DAYS = 1`；退出证据、手测、退出路径、快照、证据包、状态栏等统一使用该策略。
- 既有 `docs/development/dogfood/2026-07-12.md` 是有效真实记录，当前从 1/3 更新为 **1/1**；外网手测保持 **18/18**，M1 正式完成。
- 当前里程碑文案统一为“外网 18/18 · dogfood 1/1 · M1 已完成”；辅助导出仍保持 `claimsM1Closed=false`，即辅助组件本身不能篡改里程碑。
- TDD RED：关键退出投影 5 项按预期失败；完成审计再捕获“仅 dogfood 达标误报 M1 完成”边界 1 项。最终 GREEN：Desktop **318/318**、UI Kit **213/213**、全仓强制 test **20/20（0 cache）**、typecheck **20/20**、build **11/11**、M1 full GREEN、M2 **5/5**。

## 2026-07-15 · 当前里程碑状态投影与过期文案清理

- Desktop 手测投影以 `14-external-gateway-handtest.md` 为外网完成真源：文档 `18/18` 时外网待证归零，状态进入 `awaiting-dogfood`，只显示 dogfood `1/3` 与剩余 2 个真实日期。
- 验证区“当前里程碑状态”改为动态投影，明确 M2 协作/自动模式、CC Switch 完整导入已经完成；移除“当前禁用”“勿启动 M2”等过期声明。
- 退出路径、dogfood 草稿、证据包、会话就绪条及 Provider / Agent / 审批 / Memory 面板统一为“外网 18/18，M1 仍等待真实 dogfood”。
- 证据包 footer 按真实手测计数输出；`18/18` 显示“已完成”，不再反向提示仍需完成同一门槛。
- 实窗追加审计发现并清理外网聚焦卡、证据包标题、回归提示、差异空态、soft 快照、手测粘贴稿与 dogfood 草稿中的二级旧副本；`18/18` 后不再提供重复外网验收 CTA。
- 验证：首轮 Desktop 定向 **48/48**、UI Kit 定向 **75/75**，追加 dogfood-only 投影定向 **53/53**；Desktop 全量 **316/316**、UI Kit 全量 **213/213**；typecheck **20/20**、build **11/11**、M1 quick GREEN、M2 selftest **5/5**。
- 实窗：最终 Electron 可访问文本只显示“外网手测 18/18 已完成 → dogfood 1/3”“M2 已完成”，未再出现“勿启动 / 当前禁用 / 外网手测仍缺”等过期状态。
- 边界：没有新增 dogfood 日期；M1 仍为 **1/3** 并保持 open，总目标继续 active。

## 2026-07-15 · M2 多智能体编排纵切完成

### 已交付

- 不可变 `AgentVersion` 与 `PlanRevision`，精确版本 pin，Task participation mode 持久化。
- 持久 DAG 调度、稳定 Step ID、并行隔离快照、暂停 / 恢复 / 取消和冷恢复。
- 服务端审批策略、最严格作用域解析、Skill/MCP 精确授权与 human-only 边界。
- Reviewer evidence、有界 rework、`review.limit-reached` 暂停和不可变 ArtifactVersion。
- Artifact 三方比较、显式 Merge Step、冲突暂停、left/right/manual 解决与已解决历史。
- Desktop 计划编辑、执行图、审批、产物和 Agent 工作区；Automatic 模式计划只读并可重启恢复。
- 确定性 `selftest:m2`，覆盖精确退出序列、版本数量、唯一终态、安全证据和 Runtime 重启恢复。

### P1 审查

- ApprovalCenter 保存一条规则时保留同策略的全部后续规则。
- 持久 Runtime 使用 Windows DPAPI；XOR 仅限显式测试配置或旧凭据迁移。
- Provider 创建、轮换和 CC Switch 导入补偿边界新增持久事件失败覆盖，数据库不会引用已删除的新密钥 handle。
- 本轮审查未发现 M2 阻断项。

### 验证与状态

- M2 selftest **5/5**；Provider compensation **6/6**；全仓强制 test **20/20 tasks，0 cache**；typecheck **20/20**；build **11/11**。
- M1 六项退出标准完成最终审计；M1 full 与四组聚焦复核全绿；路线图已同步为“M2 完成、M1 dogfood 1/3”。
- Electron 1426×893 浅色和 1266×761 深色通过，无溢出、错误覆盖层或 console warning/error。
- **M2 完成**。M1 外网 18/18，但 dogfood 仍 **1/3**；总目标继续保持 active。

## 2026-07-13 · M1 真实外网、Fallback、取消、恢复与安全验收

- 完成 `14-external-gateway-handtest.md` 18/18：CC Switch 导入的 Provider / 密钥分组 / 模型可直接运行且可编辑。
- 真实 `grok-4.5`、`gpt-5.6-sol` 调用成功；Unity2.Ai Claude 无额度返回 503，按外部可用性处理。
- 真实 Fallback 从 Claude Haiku 切至 `gpt-5.5`，链位、Manifest、Trace 与唯一终态均正确。
- 真实取消持久化为 `run.cancelled`，Composer 恢复，无重复完成；记录网关批量增量限制，不虚构部分输出。
- 冷重启恢复与 11-secret / 255-file 安全扫描通过；证据导出无明文凭据。
- 边界：外网门槛已通过；dogfood **1/3**，M1 仍 open，等待真实日期累计。

## 2026-07-12 · Codex 式消息流 + 紧凑 Composer

- 助手消息改为无边框 Markdown 阅读流，支持 GFM 列表、代码、表格、引用与链接；不执行原始 HTML。
- 对话正文不再重复显示 `SYNC-THINK`、模型 UUID、Run ID；运行观测仍保留在 Trace / Manifest。
- 用户消息保留右侧紧凑气泡；Composer 移除模式、工作区、模型数量与 readiness 面板。
- Composer 左下保留分组 → 供应商 → 模型入口，右下使用图标发送 / 停止；异常时只显示一条可行动阻塞提示。
- Runtime / 任务 / 模型 blocker 现在参与真实发送门禁；异步发送失败保留原输入草稿，成功后才清空。
- Agent 默认模型显示真实 `providerModelId`（例如 `grok-4.5`），未知 UUID 不再截断展示。
- 验证：UI Kit 192、Desktop 267、根测试 20/20 tasks、typecheck 20/20、build 11/11；Electron 1425×894 与约 1266×761 实窗通过。
- 边界：**M1 仍 open**；外网手测 0/18、dogfood 0/3；不启动 M2。

## 2026-07-16 — Multica 参考的新人桌面工作区

- 左栏由图标工具条升级为带文字的产品导航：任务、智能体、模型源、审批；记忆保留为次级入口。
- 任务区新增明确 `新建任务`，本地文件夹与嵌套任务行为不变。
- 任务头新增负责 Agent 和运行模型；Context 槽收敛为单一 `下一步`。
- 右栏默认显示用户可理解的任务进度、负责人和产物；原 Trace/Manifest/执行图/审批/版本工具进入 `执行详情`。
- 健康对话移除常驻 readiness 仪表，异常仅显示紧凑恢复条。
- 全新用户/空任务状态改为三步上手，不再暴露 Runtime 检查清单。
- `AppShell` 新增兼容的 `traceTitle` / `traceAriaLabel`，`WorkspaceNav` 新增兼容的 `hideBrand`；默认行为不变。
- 验证：Desktop 334、UI Kit 216、root test/typecheck/build 全绿；1427×894、1366×768、1280×720 Electron QA 通过。

## 2026-07-12 · soft #65 · Provider 可编辑 + CC Switch 导入

- `provider.update`：名称 / baseUrl / 协议 / 发现开关 / 标签；可选 apiKey 轮换。
- `provider.previewCcSwitchImport` + `provider.importCcSwitch`：本机 CC Switch SQLite 预览→确认；密钥入 secure store；TD-009 合规。
- UI：Providers 面板「编辑」「从 CC Switch 导入」。
- M1 仍 open（外网手测 0/18 + dogfood 0/3）。

## 2026-07-12 · soft #64 · Codex 式左栏工具抽屉 + Provider 错误中文化

- Desktop 左栏：常驻工作区/任务树，四工具改为 Lucide 图标工具条，底部固定紧凑 Runtime 状态。
- 工具详情：Provider / Agent / 记忆 / 审批共用覆盖式 dialog 抽屉；支持 toggle/replace/Esc/backdrop/close/jump-open。
- UI Kit：`WorkspaceNav` 新增兼容默认行为的 `hideFooter`；AppShell nav 改为内部滚动所有权与明确 stacking context。
- CSS：抽屉 `clamp(336px, 28vw, 420px)`，不改变 Locked 三栏 grid；移除永久仪器卡片与多重滚动。
- Provider UX：新增 `provider-error-copy.ts`，把 fetch/timeout/auth/rate-limit/non-JSON/404 转为可行动中文。
- 现场诊断：`www.kamenking.top` DNS 不可解析，发现请求未到达网关；需确认真实域名及 Base URL 是否包含 `/v1`。
- 测试：Desktop 261、UI Kit 177、根级 715 tests、typecheck、build、M1 quick soft 通过。
- 边界：**M1 仍 open**；外网手测 0/18、dogfood 0/3；不启动 M2。

## 2026-07-12 · soft #63 · Codex 式主工作台减负 + Runtime replay 修复

- `m1-obs-layout`：新增 product workspace disclosure 语义；中心验证工作台默认折叠、跳转自动展开、展开体限高滚动。
- Desktop：产品态启用 `hideReadiness`，去除 Workspace/AppShell/Mode/Continuum/Manifest/Trace 重复自检块；业务内容与 Locked 三栏 IA 保留。
- ui-kit：`WorkspaceNav` 新增已测试的 `hideReadiness`。
- Runtime：`appendEvent` 在持久模式走 `SqliteEventCheckpointStore.commitTransition`，统一全事件序列来源，修复 replay 重复/逆序导致的 `runtime.protocol-error`。
- Storage：`listTasks` 同时间排序 tie-break 从随机 ULID 改为插入 `rowid`。
- 测试：根级 707 tests、typecheck、build、M1 quick soft、Electron 真实截图全部通过。
- 边界：**M1 仍 open**；外网手测 0/18、dogfood 0/3；不启动 M2。

## 2026-07-12 · soft #61+#62 · 硬门槛条 + 左侧仪器切换 + Skill 导入 UX

- 新增 `apps/desktop/src/renderer/m1-hardgate-strip.ts` + `tests/m1-hardgate-strip.test.ts`
- 新增 `apps/desktop/src/renderer/left-instrument-switch.ts` + `tests/left-instrument-switch.test.ts`
- `index.tsx`：主路径顶部硬门槛条；左侧 tab 切换；Skill import preflight 中文错误
- `AgentBindingPanel`：填入示例 · 错误贴近导入区 · 失败保留草稿
- CSS：左侧单面板布局 · hardgate 条 · import error 高亮
- soft full GREEN · Electron PID 17820 · **M1 仍 open**

## 2026-07-12 · soft #60 · M1 观测布局减负（主路径轨）

- 新增 `apps/desktop/src/renderer/m1-obs-layout.ts` + `tests/m1-obs-layout.test.ts`
- `index.tsx`：主路径轨（下一步 / 外网聚焦 / 退出路径）置顶；次要 soft 观测默认折叠于 `m1-obs-secondary`
- flash 次要面板时自动展开；CSS `.st-demo-m1-rail` / `.st-demo-m1-more`
- softCraftRound **60** · soft full GREEN · Electron PID 61620
- 仍不关 M1、不开 M2

## 2026-07-12 · soft craft #59 · 外网聚焦贯通 next / exit / evidence（M1 仍 open）

- next-action：`buildExternalHandtestAction` · CTA `focus-external` / `jump-external-item` / `copy-external-runsheet` · 跳转含 compose
- exit-path：步骤 `external-focus-assist`（kind `external-focus`）在外网逐项前
- evidence-bundle：可选 `externalFocusMarkdown` · TOC「外网聚焦运行单」· 摘要「含外网聚焦」
- UI：主条/路径金色高亮 · softCraftRound **59** · Electron PID 14100
- 测试：next 17 · exit 15 · evidence 11 · soft full GREEN
- **不关 M1 · 不开 M2**

## 2026-07-12 · soft craft #58 · 手测「下一外网项」聚焦条

- 新增 `m1-external-focus.ts`：按清单顺序聚焦首个外网待证项 + 队列 + 外网运行单粘贴
- UI：`m1-external-focus` 聚焦条（跳面板 / 开文档 / 复制运行单 / 筛选外网）
- softCraftRound **58**；单测 9/9；soft full GREEN
- **不** 关 M1；**不** 启动 M2

## 2026-07-12 · soft #57 · 下一步合入 dogfood 补填板

- `m1-next-action.ts`：fill 输入；`buildWriteDogfoodAction`；CTA `open-dogfood-fill` / `copy-dogfood-fill`；`isM1NextDogfoodFillAction`
- `index.tsx`：接线 + handler 闪补填板；`data-cta-action` / `data-fill-level`；softCraftRound → **57**
- CSS：补填类下一步蓝色边
- 单测 14 项；**不关 M1**

## 2026-07-12 · soft #56 · 退出路径合入 dogfood 补填板

- `m1-exit-path.ts`：输入 fill 信号；硬步 `dogfood-fill-assist`（kind `dogfood-fill`）；CTA `open-dogfood-fill` / `copy-dogfood-fill`
- `index.tsx`：board + 两处 paste + 证据包路径 + 点击处理；softCraftRound → **56**
- CSS：补填步蓝色高亮
- 单测 11 项；**不关 M1**；草稿仍不计有效日

## 2026-07-12 · soft #55 · 证据包并入 dogfood 多日补填

- `formatM1EvidenceBundle` 可选 `dogfoodFillMarkdown`；TOC 新增 `dogfood-fill`
- 导出自动合入多日补填板；摘要「含补填/无补填」；preview 可附补填
- 单测扩展；softCraftRound → **55**
- **不关 M1**；草稿仍不计有效日

## 2026-07-12 · soft #54 · dogfood 多日补填板

- 新增 `apps/desktop/src/renderer/m1-dogfood-fill-board.ts`：多日窗口缺文件、scaffold/draft/real 分级、主 CTA、粘贴板、密钥 scrub
- UI：M1 退出区「dogfood 补填」卡（chips + 主按钮 + 可点行 + 复制多日补填）
- 单测 9 项；softCraftRound → **54**；soft pack 纳入 fill-board
- **不关 M1**；不把粘贴草稿算有效日

## 2026-07-12 · soft craft #53 · 本机领先差异可点跳 + 退出路径合入

- **范围**：M1 硬门槛辅助（不关 M1）
- **改动**：
  - `m1-handtest-doc-diff.ts`：行级 CTA（打开文档 / 跳转 / 双动作）、主行动 `primaryCta`、`planM1HandtestDocDiffCta`
  - `m1-exit-path.ts`：输入 `liveAheadCount`/`docAheadCount` → 步骤 `doc-live-ahead`
  - UI：差异主按钮 + 可点差异行 + 高亮手测清单项；CSS 简洁 CTA
  - softCraftRound **53**
- **测试**：doc-diff 6/6 · exit-path 7/7 · soft full GREEN · dual 4/4 · tsc/build 通过
- **边界**：不自动勾文档 · 不写 dogfood · claimsM1Closed=false · 勿启 M2

## 2026-07-12 · soft craft #52 · 证据包并入文档↔本机差异

- `m1-evidence-bundle.ts`：可选 `docDiffMarkdown` · TOC `doc-diff` · 导出含「## 文档↔本机差异」
- 一键导出自动合入 `formatM1HandtestDocDiffPaste`（#51）
- 单测 **9/9**（含无差异 / 无路径 / 无草稿边界）
- 不变量：`claimsM1Closed=false` · 无密钥 · 不自动勾手测 · 不写 dogfood · 不关 M1 · 不启 M2

## 2026-07-12 · soft craft #51 · 文档↔本机差异板

- 新增 `apps/desktop/src/renderer/m1-handtest-doc-diff.ts`：`projectM1HandtestDocDiff` / attention 列表 / 粘贴稿 / secret-free
- 单测 `tests/m1-handtest-doc-diff.test.ts` **3/3**
- UI：手测对照上方差异板（本机领先/文档领先/外网待证/对齐）+ **复制文档差异**
- soft catalog suite `handtest-doc-diff`；runner softCraftRound=51
- 不变量：只读 · 不自动勾 · 无密钥 · 不写 dogfood · 不关 M1 · 不启 M2

## 2026-07-12 · soft craft #50 · 手测文档逐项勾选徽章

- 新增 `apps/desktop/src/m1-handtest-doc-parse.ts`：`parseHandtestDocMarkdown` / `mapHandtestDocBoxesToItems` / secret-free 检查
- 单测 `tests/m1-handtest-doc-parse.test.ts` **5/5**
- Main IPC `desktop:m1-exit-evidence` 成功路径返回 `handtestBoxes`（修 TS6133 未使用变量）
- Preload + `global.d.ts` + 渲染层：徽章 **文档✓ / 文档□ / 文档—**（`data-doc-checked`）
- soft 回归 catalog suite `handtest-doc-parse`；runner softCraftRound=50
- 不变量：只读文档 · 不自动勾 · 无密钥 · 不写 dogfood · 不关 M1 · 不启 M2

## 2026-07-12 · soft craft #49 · 证据包并入退出路径

- `m1-evidence-bundle.ts`：可选 `exitPathMarkdown` · TOC `exit-path` · 导出含「## 退出路径」
- 一键导出自动合入 `formatM1ExitPathPaste`（#48）
- 单测 **8/8**（含无路径 / 无草稿边界）
- 不变量：`claimsM1Closed=false` · 无密钥 · 不自动勾手测 · 不写 dogfood · 不关 M1 · 不启 M2

## 2026-07-12 · soft craft #48 · M1 退出路径板

- 新增 `apps/desktop/src/renderer/m1-exit-path.ts`：`projectM1ExitPath` / `formatM1ExitPathPaste` / `isM1ExitPathStepActionable` / `exitPathLooksSecretFree`
- 单测 `tests/m1-exit-path.test.ts` **6/6**
- UI：退出路径卡（手测对照上方）· 顶栏「复制退出路径」· 步骤 CTA（开文档 / 复制草稿与证据包 / 跳转 Providers·Agent·Compose）
- soft 回归 catalog 增加 suite `exit-path`
- `navigateToInstrument` 支持 `compose`（聚焦输入 · 不自动发送）
- 不变量：`claimsM1Closed=false` · 进度 ≤99% · 无密钥 · 不自动勾手测 · 不写 dogfood · 不关 M1 · 不启 M2

## 2026-07-12 · soft craft #47 · M1 证据包一键导出

- 新增 `apps/desktop/src/renderer/m1-evidence-bundle.ts`：`formatM1EvidenceBundle` / `projectM1EvidenceBundlePreview` / `M1_EVIDENCE_BUNDLE_SECTIONS`
- 退出证据区证据包卡 + 「导出证据包」/「一键导出」；手测区快捷「证据包」
- 永远 `claimsM1Closed=false`；不含密钥；不自动勾手测/不写 dogfood/不关 M1
- 单测 `tests/m1-evidence-bundle.test.ts` 7/7；回归 catalog 登记 evidence-bundle

## 2026-07-12 · soft craft #46 · soft 回归筛选 + 行跳转

- `filterM1SoftRegressionRows` / `countM1SoftRegressionFilter`：全部/缺口/外网/auto红
- `resolveM1SoftRegressionRowAction`：打开手测/dogfood、跳转 Providers/Agent/轨迹、重连、复制矩阵
- UI：筛选芯片 + 可点行 CTA；`data-filter` / `data-action`
- 单测 8/8；**不**关 M1、**不**自动勾手测、**不**启动 M2

## 2026-07-12 · soft craft #45 · M1 soft 回归矩阵（自动 vs 手测）

- 新增 `apps/desktop/src/renderer/m1-soft-regression.ts`：纯函数矩阵 + markdown 导出 + 密钥 scrub
- UI：退出证据区紧凑回归板 + 复制按钮；手测区「回归矩阵」入口
- 脚本：`scripts/selftest-m1-soft-regression.mjs`；根脚本 `selftest:m1-soft` / `selftest:m1-soft:quick`
- 单测：`tests/m1-soft-regression.test.ts`（6）
- **不**关 M1、**不**自动勾手测、**不**启动 M2

## 2026-07-12 · soft #44 · 生成失败恢复 CTA

- `classifyStreamFailure` / `scrubFailureText`：失败类别中文 + 密钥打码
- 会话就绪条失败恢复按钮：Providers / Fallback / 轨迹 / 诊断 / 聚焦 Compose
- 可观测：`conversation-stream-failure` · `data-failure-kind` · `data-cta-action`
- 测试：stream readiness **18/18**；dual **4/4**
- **不**关闭 M1 · **不**启动 M2 · **不**自动重发

## 2026-07-12 · soft #43 · dogfood 计分加固

- 新增 `apps/desktop/src/m1-dogfood-score.ts`：粘贴草稿 / 待你确认 不计有效 dogfood 日
- 退出证据按日板：`草稿` 态 + 计分原因 + `data-draft-count`
- 主进程 `listDogfoodDayReports` 带回 `isPasteAssist` / `reasons` / `statusHint`
- 测试：`m1-dogfood-score.test.ts` 等 39 项相关通过；dual 4/4
- **不**关闭 M1 · **不**启动 M2

## 2026-07-12 · soft #42 · 复制 dogfood 日记草稿

- 渲染：`formatM1DogfoodDayDraft` + 退出证据/手测「复制 dogfood 草稿」
- 测试：dogfood-draft 4；dual 4/4
- **不自动写盘 · 不算有效日 · M1 仍 open · 未启动 M2**

## 2026-07-12 · soft #41 · 手测进度粘贴稿 + 外网/缺口筛选

- 渲染：`formatM1HandtestPaste` / 筛选全部·缺口·外网 / 复制手测进度按钮
- 测试：handtest-paste 4；dual 4/4
- **M1 仍 open** · **未启动 M2**

## 2026-07-12 · soft #40 · dogfood 按日打开 + 手测分区进度

- 主进程：`dogfood-day` 白名单 + `isValidDogfoodDayDate` + 路径约束
- 渲染：退出证据 dogfood 行可点打开；手测对照分区板（pre/A/B/C/D）
- 测试：open-doc 7 · section-board 3；dual 4/4
- **M1 仍 open** · **未启动 M2**

## 2026-07-12 · soft · dogfood 按日明细 + 聚焦刷新（#39）

- 主进程 listDogfoodDayReports；IPC 返回 dogfoodDays
- 退出证据 UI 按日 有效/脚手架
- 窗口 focus/visible 自动重读手测与 dogfood
- 测试：exit 11/11 · load 3/3 · dual 4/4
- **不**关闭 M1 / **不**启动 M2

## 2026-07-12 · soft · 复制 soft 快照（#38）

- `formatM1SoftSnapshot` 生成可贴 Markdown（无密钥、不关 M1）
- 退出证据 / 手测对照：复制 soft 快照按钮 + 反馈条
- 测试：snapshot 4/4 · dual 4/4
- **不**关闭 M1 / **不**启动 M2

## 2026-07-12 · soft · 退出证据芯片可行动 + 打开反馈（#37）

- 退出证据芯片：handtest/dogfood 打开文档；soft/dual 刷新
- 打开结果反馈条（ok/warn/error + basename）
- 手测对照头：打开手测文档 / 今日 dogfood
- 测试：chip-action 7/7 · M1 套件 37 · dual 4/4
- **不**关闭 M1 / **不**启动 M2

## 2026-07-12 · soft · 「下一步」主 CTA 可行动（#36）

- offline → 重新连接 Runtime
- 外网手测 → 系统打开 14-external-gateway-handtest.md
- dogfood → 打开/创建今日日记
- 主进程白名单 IPC，禁止任意路径
- 测试：next 10/10 · open-doc 4/4 · dual 4/4
- **不**关闭 M1 / **不**启动 M2

## 2026-07-12 · soft · Runtime 手动重连 CTA（#35）

- 对话流就绪条 / 空对话：离线时「重新连接 Runtime」
- 记录 `lastConnectFailure`（code + retryable）并投影中文提示
- 事件监听与 connect 生命周期拆分，避免重连丢订阅
- 测试：stream 9/9 · runtime 5/5 · dual 4/4
- **不**关闭 M1 / **不**启动 M2

## 2026-07-12 · soft · M1「下一步」主行动条

- 新增 `apps/desktop/src/renderer/m1-next-action.ts`：`projectM1NextAction` / `isM1NextActionJumpable`
- 任务头 CTA：`m1-next-action`（soft/hard 分闸 + 跳转或刷新）
- 测试 **9/9**；dual **4/4**；**不关 M1**

## 2026-07-12 · soft · 手测项点击跳转面板

- `resolveM1HandtestItemJump` / `isM1HandtestItemJumpable`；投影项带 jumpTarget
- 手测列表可点行 → `navigateToInstrument` 闪烁对应面板
- 测试 8/8；dual 4/4；**不关 M1**

## 2026-07-12 · soft · 手测对照清单 live 投影

- 新增 `apps/desktop/src/renderer/m1-handtest-checklist.ts`：`M1_HANDTEST_ITEMS`（18）+ `projectM1HandtestChecklist`
- 任务头 UI：`m1-handtest-checklist` 列表 + `m1-known-limits` 已知限制；本机/外网闸门分色
- 测试：`tests/m1-handtest-checklist.test.ts` **5/5**；dual **4/4**
- 边界：soft 可观测；**不关 M1 / 不开 M2**；文档勾选仍需人手

## 2026-07-12 · soft · M1 退出证据进度条

- 新增 `projectM1ExitEvidenceProgress` / IPC `desktop:m1-exit-evidence`（只读 docs handtest + dogfood）
- 任务头「退出证据」：soft / dual / 手测 x/y / dogfood n/3 + 刷新
- 单测 8/8；dual 4/4；**不关 M1**

## 2026-07-12 · soft · 会话芯片跨面板跳转

- `resolveM1SessionChipJump` / `isM1SessionChipJumpable`；芯片附 `jumpTarget`/`jumpHint`
- 可跳芯片按钮：`m1-session-chip-jump-*` → scroll + `data-nav-flash`；Manifest/轨迹会先展开轨迹栏
- 单测 7/7；dual 4/4；**不关 M1**

## 2026-07-12 · soft · 会话就绪 Memory 芯片

- `projectM1SessionReadiness` 增加 memory 字段与芯片；ready 要求 memoryOk
- desktop 会话条接线 memoryEntries/changes/diagnostics
- dual 网关复测 4/4；**不关 M1**

## 2026-07-12 · soft · Memory/Diagnostics 就绪纯投影

- 新增 `projectMemoryDiagnosticsReadiness` / `MemoryDiagnosticsReadiness*`
- Memory 就绪条统一投影；根节点 data-level；12/12 测；**不关 M1**

## 2026-07-12 · soft · 批准中心闸门就绪纯投影

- 新增导出：`projectApprovalGateReadiness` / `ApprovalGateReadiness*`（`ApprovalCenterPanel.tsx`）
- 批准闸门条统一投影；根节点 data-level；单测 13/13；**不关 M1**

## 2026-07-12 · soft · Agent 能力就绪纯投影

- 新增导出：`projectAgentCapabilityReadiness` / `AgentCapabilityReadiness*`（`packages/ui-kit/src/components/AgentBindingPanel.tsx`）
- Agent 能力就绪条改为统一投影；根节点 `data-testid="agent-binding-panel"` + `data-level`
- 单测 27/27；**不关 M1**

## 2026-07-12 · Compose 发送就绪纯投影（M1 soft）

- `packages/ui-kit/src/components/Compose.tsx`：`projectComposeSendReadiness` + form data-level
- 测试：`Compose.test.tsx` projector 套件
- 边界：soft craft，**不关 M1 / 不开 M2**

## 2026-07-12 · Providers 多模型就绪纯投影（M1 soft）

- `packages/ui-kit/src/components/ProvidersPanel.tsx`：`projectProvidersReadiness` + badge/note/data-level
- 测试：`ProvidersPanel.test.tsx` projector 套件；dual 网关 4/4 复测
- 边界：soft craft，**不关 M1 / 不开 M2**；外网手测与 dogfood 仍缺

## 2026-07-12 · WorkspaceNav 工作区导航就绪投影（M1 soft）

- `packages/ui-kit/src/components/WorkspaceNav.tsx`：`projectWorkspaceNavReadiness` + 6-check 就绪条 + filtering 档
- `packages/ui-kit/src/styles/components.css`：partial/filtering 色边
- 测试：`packages/ui-kit/tests/WorkspaceNav.test.tsx`
- 边界：soft craft，**不关 M1 / 不开 M2**

## 2026-07-12 · AppShell 工作区布局就绪条（M1 soft）

- `packages/ui-kit/src/components/AppShell.tsx`：`projectAppShellReadiness` + 就绪条 UI；`hideReadiness`；`data-level`
- `packages/ui-kit/src/styles/components.css`：`st-app-shell__readiness*` 含折叠 compact 竖排
- 测试：`packages/ui-kit/tests/AppShell.test.tsx` readiness 套件
- 边界：soft craft，**不关 M1 / 不开 M2**

## 2026-07-12 · 对话流 empty/stream 统一可观测（soft · M1 open）

## 2026-07-12 · 参与模式就绪条（soft · M1 仍 open）

- soft craft：`projectModeReadiness` + `mode-switch-readiness`；四档 m1/mixed/m2-open/locked
- 自测：ModeSwitch 10/10；dual 4/4；builds GREEN
- 下一优先：外网网关 UI 手测 / dogfood；**勿关 M1、勿开 M2**

## 2026-07-12 · Manifest 可检查就绪条（soft · M1 仍 open）

- soft craft：`projectManifestReadiness` + `manifest-readiness` 八项 checks；amended/inspectable 分档
- 自测：ManifestPanel 22/22；builds GREEN
- 下一优先：外网网关 UI 手测 / dogfood；**勿关 M1、勿开 M2**

- desktop：`conversation-stream-readiness.ts` 纯投影
- 对话列 stream 条 + 空对话卡片同源；六项 checks；Run 摘要中文状态
- 样式：`st-conversation-readiness*`

## 2026-07-12 · ContinuumRail 连续体就绪条（soft · M1 open）

- ui-kit：`ContinuumRail` 增加 `projectContinuumReadiness` 与就绪条（空/结构位/绑定/有证据/流式）
- desktop：无任务真 empty；有任务 scaffoldOnly 结构位；接 streaming
- 样式：`st-continuum__readiness*`

## 2026-07-12 · AppShell 运行轨迹中文 + 工作区结构条（soft · M1 open）

## 2026-07-12 · TraceList 运行轨迹就绪条（soft · M1 open）

- ui-kit：`TraceList` 增加 `projectTraceReadiness` 与就绪条（空/部分/有轨迹/流式）
- desktop：去掉伪 waiting 轨迹条目，接 `hasActiveTask` / `streaming` / 真 empty
- 样式：`st-trace__readiness*` 对齐其它 M1 就绪条

## 2026-07-12 · 第 16 次 soft craft · Compose 发送就绪条 + dual 网关复测

### Compose 发送就绪条

- 发送区 soft 可观测：模型/绑定来源/Runtime/任务/跨 Provider/输入
- desktop 接线 connectionState / hasActiveTask / agentDefaultSet
- dual 网关自动化复测通过（仍非外网 UI 证据）

## 2026-07-12 · 第 15 次 soft craft · 会话就绪条接入 Agent/审批

### 会话就绪条 · Agent / 审批

- `projectM1SessionReadiness` 增加 agent / approval chips 与 soft ready 条件
- desktop 任务头接线：`agentBinding` + `approvalPendingCount`

## 2026-07-12 · 第 14 次 soft craft · Agent 能力就绪条

### Agent 能力就绪条（UI 可观测）

- `AgentBindingPanel`：顶部 readiness strip（模型 / fallback / 凭证 / Skill / MCP / dirty）
- 样式：与 Approval/Memory readiness 统一，Agent 六项三列
- 测试：empty / partial / ready + dirty 翻转

### 非目标本轮

- 未关 M1；未开 M2；未做外网网关证据

- AppShell：运行轨迹中文 + 折叠不暂停提示
- WorkspaceNav：§15.2 工作区结构就绪条 + Runtime 中文连接态
- **M1 仍 open**

## 2026-07-12 · 批准中心 + Memory 闸门就绪条（soft · M1 open）

- UI：ApprovalCenterPanel / MemoryDiagnosticsPanel 增加与 Providers 同风格的中文就绪条与空态卡片
- 可观测：仅限真人闸、待审 attention、MemoryChange 链路说明、§23.2 已知限制计数
- 测试：Approval 6/6、Memory 6/6；desktop rebuild + Electron 重启
- **M1 仍 open**（外网手测 + dogfood 未完成）

## 2026-07-12 · 任务头 M1 会话就绪条（M1 soft）

- Continuum 下全局「会话就绪」芯片条（对齐 Providers soft 门槛）
- `m1-session-readiness.ts` 纯投影 + 单元测试
- 连接状态「已连接 · 持久事件流」
- **不关 M1**；**不进 M2**

## 2026-07-12 · Providers 多模型就绪条（M1 soft）

- Providers 顶部「多模型就绪」：≥2 Provider / ≥3 模型 / 密钥遮罩 / 协议种类
- 中文计数与 discovery meta；soft 门槛文案与「不关 M1」说明
- 测试：ProvidersPanel 6/6
- **不关 M1**；**不进 M2**

## 2026-07-12 · Compose/消息气泡中文可观测（M1 soft）

- Compose 默认占位与 a11y 中文化；取消流式 aria 中文化
- MessageBubble 流式/角色中文 aria；desktop meta「流式中」
- 测试：Compose 18 / MessageBubble 4
- **不关 M1**；**不进 M2**

## 2026-07-12 · Manifest 解析阶梯（M1 soft）

- **UI** Manifest 详情：解析阶梯与 §5.3 绑定优先级对齐；Fallback 链位可观测
- **文案** 凭证解析中文化；`agentFallback` → Fallback
- **修复** 补 `credentialResolutionLabel`（此前引用未定义会编译失败）
- **测试** ManifestPanel 15/15
- **范围** soft craft；不关闭 M1；不启动 M2

## 2026-07-12 · Agent 绑定优先级可观测（§5.3）

- Agent 面板顶部 precedence ladder：本轮覆盖 / 工作流(M2) / Agent 默认 / Fallback
- 与 Compose 本轮覆盖语义对齐，便于 M1 退出标准 #2 界面举证
- **M1 仍 open**

## 2026-07-12 · Continuum/Mode 中文可观测 + dogfood 脚手架

- ContinuumRail 中文 kind + empty；ModeSwitch 中文标签 + M1 禁用协作/自动
- desktop 任务头挂 ModeSwitch；线程标签中文化
- dogfood/2026-07-12.md 脚手架
- **M1 仍 open**

## 2026-07-12 · Compose 多模型 chips + Trace 中文标签

- Compose：compose-model-chips 快速切换本轮模型；摘要「本轮覆盖 / Agent 默认」；agentFallbackCount / multiProvider 可观测
- TraceList：类别中文（模型调用 / 恢复 / …），data-category 仍为英文
- desktop：绑定 fallback 数量与跨 Provider 提示；会话条中文化
- 测试：Compose 17 · TraceList 2 · builds GREEN
- **M1 仍 open**（无外网 UI 手测 / dogfood 证据不关闭）

## 2026-07-12 · Diagnostics 可行动恢复 + 已知限制（§23.2 #9/#12）

- 新增 `packages/ui-kit/src/diagnostics/recovery.ts`：failureClass → 中文标签 / 是否可重试 / 恢复步骤 / 建议跳转
- MemoryDiagnosticsPanel：诊断可展开恢复指南；固定「已知限制」区（协议、能力启发式、MCP 发现≠执行、密钥、M1 退出）
- ProvidersPanel：顶部协议与 Provider 限制说明
- desktop：诊断「前往」滚动到对应左栏并短暂高亮
- 门禁脚本：`scripts/selftest-dual-gateway.mjs`
- **M1 仍 open**（无外网 UI 手测 / dogfood 证据不关闭）

## 2026-07-12 · Provider 协议持久化 + 发现失败 Diagnostics（M1 soft）

- DB：`provider.protocol` + migration `0007_provider_protocol`
- 发现：按持久化协议路由；响应带 protocol / addedIds / previousModelCount
- 失败：scrubbed diagnostics + UI 刷新可观测
- UI：协议徽章；发现状态条增强
- 测试：storage 69 · provider-commands 5 · ProvidersPanel 4 · desktop build GREEN
- M1 仍 open（外网手测 / dogfood）

## 本轮进度：2026-07-12 · MCP 刷新目录可观测 + 自测闭环

- UI：MCP 工具名 chips + 空目录提示
- 测试：refresh 后 peek tool-schema；AgentBinding 14 条
- 文档：新增固定大白话自测 `13-plain-selftest-log.md`
- M1 仍 open

## 本轮进度：2026-07-12 · MCP tools/list 刷新目录（§9.3 discovery · soft）

### 变更

- **新增** `mcp.tools.refresh`：local-stdio 真 JSON-RPC `tools/list` 发现工具 Schema 并写入 MCP 注册表
- **新增** workers `list-tools` action + `extractToolsList`（限幅 / untrusted / 审计 · 不执行工具）
- **事件** `mcp.tools_refreshed`（catalog delta：added/removed）
- **UI** AgentBindingPanel「刷新工具目录」+ Desktop 状态条可观测
- **desktop** IPC/preload/renderer 贯通；修复 renderer 类型导入使 build GREEN
- **测试** runtime mcp-commands 增至 7 条；ui-kit AgentBinding 13 条

### 不在本切片

- 外网网关手测、dogfood ≥3 天、M2 工作流图
- 刷新后自动改 Agent 白名单（**禁止**静默 allowlist）

## 本轮进度：2026-07-12 · MCP JSON-RPC 真工具调用（§9.3/§13/§14）

### 变更

- **新增** `mcp.tool.call`：白名单 + 敏感闸 + 审批后真 JSON-RPC tools/call（非模拟）
- **新增** workers `jsonrpc-stdio` 帧编解码 + mini-mcp fixture（echo/ping/write_file）
- **扩展** `approval.decide` 响应可选 `mcpToolCall`（execute-on-approve）
- **UI** AgentBindingPanel「真工具调用」；renderer 状态条与审批结果可观测
- **测试** runtime 2 条 e2e（allowlist 拒绝 / 入队批准执行 / trusted auto ping / fake 拒绝）

### 不在本切片

- 外网网关手测、dogfood、多 Agent 工作流图（M2）

### 2026-07-12 · MCP 真 spawn 探测骨架（soft，M1 仍 open）

- 新增 `LocalStdioMcpWorker`：local-stdio 真进程探测（超时/限幅/untrusted/审计）
- 新增命令 `mcp.spawn.probe` / 事件 `mcp.spawn_probed`
- Desktop UI：Agent「真 spawn 探测」+ 可观测状态条
- 路径边界：`mcp.policy.probe` 仍模拟；`mcp.tool.request` 仍只入审批队

## 2026-07-12 · Skill 批准后自动白名单绑定（§9.1 / §9.3 → §13）

- soft：`approval.decide` 对 skill-permission 批准 → 默认 Agent skillVersionIds 自动绑定
- 导入仍不白名单；拒绝不绑定；可替换 previousSkillVersionId
- 响应 `skillAllowlist`；UI 状态条「已写入 Skill 白名单」+ 刷新 Agent
- 测试：runtime skill-commands 2 · approval 5 · desktop rebuild
- **不关闭 M1**

## 2026-07-12 · MCP 敏感工具调用 → 审批中心入队（§9.3 → §13）

- soft：`mcp.tool.request` 敏感度闸门 + enqueue kind=`mcp-permission`（永不 spawn）
- core：`evaluateMcpToolSensitivity`；trusted 低风险可 auto-approve 不入队
- UI：Agent 模拟工具名 +「请求工具审批」；审批中心「MCP 权限」；状态条中文
- 测试：core 5 / runtime mcp-commands 3 · approval 5 / ui-kit 10 / desktop rebuild
- **不关闭 M1**

## 2026-07-12 · Memory → 审批中心双向桥接（§10.4 → §13）

- soft：pending `memory.propose` enqueue Approval Center（kind=`memory`）
- 双向镜像：`approval.decide` ↔ `memory.decide`（metadata.memoryChangeId）
- 响应 `approvalRequest`；autoApprove 不入队
- UI：Memory/审批状态条中文 + 事件双向刷新
- 测试：runtime memory-commands 4 · approval-commands 5 · desktop rebuild
- **不关闭 M1**

## 2026-07-12 · Skill 升级自动入队审批中心（§9.3 → §13）

- soft：`skill.import` 在 permissionDiff.requiresReapproval 时 enqueue `skill-permission`
- 响应 `reapprovalRequest`；事件 `approval.requested`；UI 状态条 + 审批中心刷新
- 导入仍不自动白名单；人批队列可观测
- 测试：runtime skill-commands 2 · approval-commands 5 · desktop rebuild
- **不关闭 M1**

## 2026-07-12 · 审批中心骨架（§13 / §15.1-8）

- soft：approval-policy + approval_request 持久化 + runtime 四命令 + ApprovalCenterPanel
- 模式 request|delegate|full|custom；human-only 不可被 delegate/full 绕过
- UI 左栏可观测：策略试算、演示入队、待审批准/拒绝、状态条大白话
- 测试：core 12 / storage approval 4 + migrate 11 / runtime approval-commands 5 / ui-kit 4
- **不关闭 M1**

## 2026-07-12 · Skill 升级权限 diff / 需重新批准（§9.3）

- soft：`diffSkillPermissions` + `skill.import.permissionDiff`
- 同名升级新增 tools/scripts → requiresReapproval；首次导入不强制
- UI 状态条可观测「需重新批准」；导入仍不自动白名单
- 测试：core 69 / storage skill 4 / runtime skill-commands 2 / ui-kit AgentBinding 9
- **不关闭 M1**

## 2026-07-12 · MCP 进程策略探测骨架（§9.3）

- soft：`mcp.policy.probe` + FakeMcpWorker；输出限幅 / 超时 / untrusted / 审计 note
- storage 钳位与 workers policy 对齐（256B～1MB，100ms～120s）
- UI：超时/输出上限字段 +「探测策略」可观测状态条（不 spawn）
- 测试：storage 62 / workers 18 / runtime mcp-commands 2 / ui-kit AgentBinding 9；相关 build/typecheck GREEN
- **不关闭 M1**

## 2026-07-12 · MCP 授权骨架（§9.3）

- soft：`mcp.register` / `mcp.list` + Agent `mcpServerIds` allowlist；登记不 spawn
- Context Packet 注入 `tool-schema`；Manifest 可观测「mcp N · 入包 M」
- 测试：storage 61 / core 64 / ui-kit 62 / desktop 69；mcp-commands PASS
- **不关闭 M1**

## 2026-07-12 · Skill 正文注入 Context Packet

- soft：allowlist Skill 以 `skill-definition` 进入 Context Packet / peek
- Manifest 可观测「入包 N」；清空白名单后不再注入
- 测试：core 59 / runtime 57 / ui-kit 58
- **不关闭 M1**

## 2026-07-12 · Skill 导入 + Agent 白名单

- soft：`skill.import` / `skill.list` + Agent `skillVersionIds` allowlist；导入不执行脚本；Manifest peek 可观测

## 2026-07-12 · UI 偏好记忆（§15.2）

- desktop：theme / 轨迹折叠 / 对话布局 localStorage 持久化
- AppShell 受控折叠写回偏好；折叠不暂停 Run
- 测试：ui-kit 55 / desktop 69；build GREEN
- **不关闭 M1**

## 2026-07-12 · 单列对话布局（Locked IA §28）

- ui-kit：`MessageBubble.layout` + 单列阅读样式（全宽、角色左侧描边）
- desktop：任务头「分栏 / 单列」开关；localStorage 记忆偏好
- 测试：ui-kit 54 / desktop 64；build GREEN
- **不关闭 M1**

## 2026-07-12 · Manifest 版本可观测（§10.3）

- protocol：peek 响应增加 agentVersion / skillVersionIds / policyId
- runtime：`resolveAgentManifestMeta`；prepare/peek/packet.built/fallback 贯通；修复 amend tsc
- ui-kit / desktop：Manifest proof 展示版本；投影与 re-peek 映射
- 测试：runtime 56 / ui-kit 51 / desktop 64 / core 47；相关 build GREEN
- **不关闭 M1**

## 2026-07-12 · context.packet.amend

- Manifest 可修订：强制排除非受保护上下文来源（§10.3）
- 受保护来源（§20.9）拒绝排除并回报 refusedProtectedIds
- peek / 下次 Run / fallback 的 selection 均应用 thread 修订
- UI：排除按钮、受保护 chip、修订状态条、恢复自动

相关：`docs/development/12-test-log.md` 同日条目；M1 仍 open。

## 2026-07-12 · context.packet.peek

- 只读预览下一次 Context Packet / Manifest（无需发消息、不写 durable 事件）
- Manifest 面板「预览上下文」按钮；desktop IPC 全链路
- 与 §10.4 回滚联动：approve → peek 含项目记忆；rollback → peek 清除

## 2026-07-12 — Memory 回滚可逆（§10.4）

类型：功能 / TDD / UI / Runtime / Storage

- storage：批准版本保留；`rollbackChange` 恢复未回滚前驱；状态 `rolled_back`
- protocol：`memory.rollback` + Rollback* 类型；DEFAULT_FEATURES
- runtime：命令处理 + 事件 `memory.change.rolled_back`
- ui-kit：Memory **变更历史** + **回滚** 按钮（仅已通过）
- desktop：IPC / preload / renderer 接线与可观测状态条

相关：`docs/development/12-test-log.md` 同日条目；M1 仍 open。

## 2026-07-12 — M1: Real OpenAI-compatible model discovery

## 2026-07-12 — Agent 持久化绑定

- storage: `SqliteAgentStore` 不可变 `agent_version` 行
- runtime: 从 agent store 解析绑定；`agent.get` / `agent.updateBinding`
- ui: 左侧 `AgentBindingPanel`（default / ordered fallback / pauseOnFailure）
- 协议 features: `agent.get`, `agent.updateBinding`

### Added

- `packages/adapters/src/openai/discover-models.ts`: live `GET {baseUrl}/models` with Bearer auth, secret scrubbing, failure classification.
- `OpenAIChatAdapter` with real `discoverModels`; `OpenAIResponsesAdapter.discoverModels` no longer returns `[]`.
- Runtime `discoveryByProtocol` registry; production `main.ts` injects openai-chat/responses/images adapters.
- Provider command tests for real (mocked HTTP) model ids and auth-failure scrubbing.
- Renderer observability: discovery-in-progress status and sample real model ids.

### Notes

- Demo chat stream still uses FakeProvider until Agents/run binding.
- CC Switch full import remains M1 non-goal.
- Secrets still never enter DB/list/export/logs.

# Feature Changelog

## 2026-07-12 - M1 Providers / Credentials 可观测面板

类型：功能 / TDD / UI / Runtime / Security

相关文件：

```text
packages/storage/src/provider-store.ts
packages/protocol/src/commands.ts
apps/runtime/src/{runtime.ts,persistence.ts,command-validation.ts}
apps/runtime/tests/provider-commands.test.ts
apps/desktop/src/{provider-payloads.ts,main/index.ts,preload/index.ts}
apps/desktop/src/renderer/{index.tsx,m0-projection.ts,global.d.ts,renderer.css}
packages/ui-kit/src/components/ProvidersPanel.tsx
packages/ui-kit/src/styles/components.css
packages/ui-kit/tests/ProvidersPanel.test.tsx
docs/development/{10-current-status,03-feature-changelog}.md
docs/handoff/05-handoff-guide.md
```

变更说明：

1. Provider 注册：手动 name + baseURL + protocol + apiKey；密钥仅经 create hop 写入 SecureStore。
2. 列表/UI 永不回显明文 key；表单提交后立即清空密码字段；列表掩码显示密钥存在性。
3. 支持 FakeProvider 模型发现（create 时 supportsDiscovery）与手动 addModels。
4. Desktop 左栏 Workspace 下方挂载 ProvidersPanel；连接 Runtime 后自动 list。
5. Trace 可观测：`provider.created` / `provider.models_discovered` 人类摘要。
6. 补齐 preload/global.d.ts/IPC 与 `selectTraceEvents`（含 workspace-global provider 审计事件）。

TDD 证据：

```text
@sync-think/ui-kit：7 files / 21 tests
@sync-think/desktop：10 files / 54 tests
@sync-think/runtime：8 files / 32 tests（含 provider-commands）
build/typecheck：ui-kit + desktop + runtime pass
```

后续注意：

1. 真实 OpenAI/Anthropic adapter 与 Agent 绑定尚未完成。
2. 不初始化 Git。

---

## 2026-07-12 - M1 Conversation full history + observability UX

类型：功能 / TDD / UI / Runtime

相关文件：

```text
apps/desktop/src/renderer/{m0-projection.ts,index.tsx,renderer.css,runtime-view-state.ts,global.d.ts}
apps/desktop/tests/event-history.test.ts
apps/desktop/src/{main/index.ts,preload/index.ts}
packages/ui-kit/src/components/{Compose.tsx,MessageBubble.tsx}
packages/ui-kit/src/styles/components.css
packages/ui-kit/tests/Compose.test.tsx
packages/protocol/src/commands.ts
apps/runtime/src/{runtime.ts,command-validation.ts,demo-run.ts}
apps/runtime/tests/demo-run.test.ts
docs/development/{10-current-status,03-feature-changelog}.md
docs/handoff/05-handoff-guide.md
```

变更说明：

1. Conversation 投影重写为完整交错历史（多轮 user/assistant 保留；流式 assistant bubble；stream state idle/streaming/completed/failed/cancelled）。
2. Trace 改为 thread 作用域人类可读摘要（最多 24 条），不再仅 raw event type。
3. 中央可观测状态条：连接态、任务/thread/version、模型、生成中/失败/取消。
4. Compose 支持 streaming Cancel；Runtime 落地 `run.cancel` + `run.cancelled` 事件；Desktop bridge 透传。
5. MessageBubble 支持 streaming 光标；右栏 Run pulse 随 stream state 变化。

TDD 证据：

```text
@sync-think/desktop test：9 files / 51 tests passed
@sync-think/ui-kit test：6 files / 19 tests passed
@sync-think/runtime demo-run：6/6（含 cancel）
desktop/runtime typecheck：pass
```

后续注意：

1. Providers / Credentials / Agents / Context Packet 尚未开始。
2. 创建工作区仍为绝对路径 prompt。
3. 不初始化 Git。

---## 2026-07-12 - M1 Workspace IA Desktop UI + bridge

类型：功能 / TDD / UI

相关文件：

```text
packages/ui-kit/src/components/{WorkspaceNav.tsx,workspace-nav-model.ts}
packages/ui-kit/src/styles/components.css
packages/ui-kit/tests/{WorkspaceNav,workspace-nav-model}.test.*
apps/desktop/src/workspace-payloads.ts
apps/desktop/src/main/index.ts
apps/desktop/src/preload/index.ts
apps/desktop/src/renderer/{index.tsx,global.d.ts,workspace-catalog.ts,renderer.css}
apps/desktop/tests/{workspace-payloads,workspace-catalog}.test.ts
docs/development/{10-current-status,03-feature-changelog}.md
docs/handoff/05-handoff-guide.md
```

变更说明：

1. Desktop bridge 扩展 workspace/task 命令：create/list/open/search，Main 校验 payload 后转发 Runtime。
2. ui-kit 新增 signature 左栏 `WorkspaceNav`：文件夹→嵌套任务、inline 筛选、last-open resume pulse、空态单一 CTA、continuum spine、token-only 样式。
3. Renderer 替换硬编码 demo 树：连接后加载真实 workspace/task；打开任务切换 thread 并写 last-open；创建工作区/任务 prompt 流；聊天绑定 active thread。
4. 纯逻辑 TDD：nav model、payload validation、catalog 选择。

TDD 证据：

```text
@sync-think/ui-kit test：6 files / 17 tests passed
@sync-think/desktop test：9 files / 46 tests passed
@sync-think/ui-kit build + desktop typecheck：pass
```

后续注意：

1. Conversation 完整历史 UX / cancel stream 仍未做。
2. Providers / Credentials / Agents 尚未开始。
3. 创建工作区目前用 prompt 输入绝对路径（尚未系统文件夹选择器）。
4. 不初始化 Git。

---## 2026-07-12 - M1 启动：Workspace IA 存储与 Runtime 命令

类型：功能 / TDD / 协议

相关文件：

```text
packages/storage/src/{path-allowlist,workspace-store}.ts
packages/storage/src/{path-allowlist,workspace-store}.test.ts
packages/protocol/src/commands.ts
packages/shared/src/types/errors.ts
apps/runtime/src/{runtime,command-validation,persistence}.ts
apps/runtime/tests/workspace-commands.test.ts
docs/development/{10-current-status,03-feature-changelog,11-implementation-plan}.md
docs/product/06-roadmap.md
docs/handoff/05-handoff-guide.md
```

变更说明：

1. 进入 M1（多模型对话 Alpha）；复述退出标准与非目标。
2. 实现 workspace 路径 allowlist：绝对路径规范化、root 嵌套校验、空列表首次 onboarding。
3. 实现 `SqliteWorkspaceStore`：workspace create/list；task create/list/open/search；嵌套 parent task；默认 thread；last-open memory。
4. 协议与 Runtime 新增 `workspace.create/list`、`task.create/list/open/search`；persistent Runtime 注入 workspaceStore。
5. 新增错误码 `workspace.not_found`。

TDD 证据：

```text
storage：path-allowlist 8 + workspace-store 6 + 既有 = 32/32
runtime：workspace-commands 1 + 既有 = 29/29
runtime typecheck：pass
shared/protocol/storage build：pass
```

后续注意：

1. Desktop 左栏与 bridge 尚未接线；下一步优先 Workspace IA UI。
2. Providers/Agents/Context 尚未开始。
3. 不初始化 Git。

---

本文档记录开发过程中新增、变更、删除的功能与重要项目变更。

## 功能变更记录

### 2026-07-12 - M0 Renderer reload 修复与生命周期收口

类型：修复 / 安全 / 验收 / 收口

相关文件：

```text
apps/desktop/src/main/renderer-security.ts
apps/desktop/src/main/index.ts
apps/desktop/tests/renderer-security.test.ts
docs/development/{03-feature-changelog,10-current-status,11-implementation-plan}.md
docs/handoff/05-handoff-guide.md
docs/product/06-roadmap.md
```

变更说明：

1. 定位真实 Electron `page.reload()` / `location.reload()` 超时根因：导航守卫无条件拦截 `will-navigate`。
2. 改为仅允许受信 Renderer 位置（packaged exact file 或 dev loopback origin）导航/重定向；外链与新窗口继续拒绝。
3. 归一 `pathToFileURL` 与 Chromium file URL 编码（`%7E` vs `~`），避免合法 file URL 被判为不信任。
4. TDD：security RED 3 失败 -> GREEN；desktop full 41/41。
5. 最新构建真实验收：reload、UI restart、Runtime restart、SQLite sequence 证据全部通过。
6. 根强制门禁 `test/typecheck/build --force` 通过；M0 关闭，M1 仍未授权。

验证方式：

```text
pnpm --filter @sync-think/desktop test -> 41 passed
pnpm test --force / typecheck --force / build --force -> pass
real process acceptance (CDP location.reload + UI/Runtime restart) -> ALL_PASS
SQLite: run.started=1 provider.usage=1 run.completed=1 sequence 1..9
```

后续注意：

1. 未获用户明确授权前不得进入 M1。
2. 不初始化 Git。

### 2026-07-11 - Phase 0 技术推荐与实施计划（文档）

类型：新增（文档/计划）

相关文件：

- `docs/engineering/04-tech-decisions.md`
- `docs/development/11-implementation-plan.md`
- `docs/development/10-current-status.md`
- `docs/development/14-decision-log.md`

变更说明：

1. 完成产品设计 §24 共 11 项技术 spike（TD-004–014）的方案对比与推荐。
2. 完成 M0–M3 里程碑实施计划与确认后前 10 项工程任务。
3. 仍无业务代码实现。

影响范围：

1. 确认后将按推荐绑定存储/凭证/协议/UI 原语等实现选型。
2. 工程启动顺序以 implementation plan §9 为准。

验证方式：

```text
文档审阅；等待用户确认清单
```

后续注意：

1. 未确认前不得把 Recommended 当作已锁定依赖写入 package.json（可讨论不可安装绑定）。

类型：新增（文档/流程）

相关文件：

- `AI_DEVELOPMENT_RULES.md`
- `docs/00_START_HERE.md`
- `docs/README.md`
- `docs/product/01-requirements-clarification.md`
- `docs/product/06-roadmap.md`
- `docs/product/15-frontend-design.md`
- `docs/product/15-frontend-design-tokens.json`
- `docs/engineering/02-development-principles.md`
- `docs/engineering/04-tech-decisions.md`
- `docs/development/10-current-status.md`
- `docs/development/14-decision-log.md`
- `docs/superpowers/specs/2026-07-11-sync-think-product-design.md`（已有权威设计）

变更说明：

1. 完成 `/zno-init`，将已批准产品设计落盘为可执行项目文档。
2. 用户确认文档；确认 V3 仅锁定信息架构。
3. 前端质量标准升级为可获奖级，Claude 主导页面原创设计（Continuum Bench）。
4. 尚未开始业务代码实现。

影响范围：

1. 后续所有 UI 实现必须遵循升级后的前端设计标准。
2. 工程下一步进入 Phase 0 spike 与实施计划，而不是直接堆功能。

验证方式：

```text
文档审阅；无运行时验证（无应用代码）
```

后续注意：

1. §24 spike 未完成前不要绑定具体驱动/凭证库/UIA 库。
2. UI 实现禁止直接复用 V3 原型视觉。

### 2026-07-11 - M0 工程骨架 9 个包落地（代码 + 60 单测）

类型：新增（代码/工程）

相关文件：

```text
package.json / pnpm-workspace.yaml / turbo.json / tsconfig.base.json
.prettierrc.json / .eslintrc.cjs / .nvmrc
apps/desktop/{package.json,tsconfig.json}
apps/desktop/src/main/index.ts, preload/index.ts, renderer/{index.html,renderer.css,index.tsx}
apps/runtime/{package.json,tsconfig.json,src/{index.ts,runtime.ts,main.ts,healthcheck.ts,pipe/server.ts},tests/*}
packages/shared/src/{index.ts,types/*}
packages/protocol/src/{index.ts,version.ts,framing.ts,handshake.ts,commands.ts,events.ts,pipe.ts},*.test.ts
packages/secure-store/src/{index.ts,types.ts,store.ts,scrub.ts,backends/*},store.test.ts
packages/storage/src/{index.ts,connection.ts,backup.ts,fts.ts,schema/*,scripts/migrate.ts},{migrate,backup,schema-cols}.test.ts
packages/adapters/src/{index.ts,types.ts,events.ts,fake/fake-provider.ts,openai-responses-adapter.ts,openai/README.md},fake-provider.test.ts
packages/workers/src/{index.ts,types.ts,support.ts,desktop/browser/file/terminal/git/*-worker.ts},types.test.ts
packages/ui-kit/{package.json,vitest.config.ts,tsconfig.json,tests/setup.ts,scripts/generate-css.mjs,src/{index.ts,theme.ts,styles/{index.css,components.css},components/*}},tests/*.tsx
packages/test-fixtures/src/{index.ts,provider/{battery,sse-recordings}.ts,skill/skills.ts,ccswitch/imports.ts}
scripts/{dev-desktop.mjs,pipe-client.mjs}
```

变更说明：

1. 完成 M0.1–M0.5 全部 9 个不需要 native 绑定的包骨架 + 60 个单测（含安全：secure-store 明文不落盘、CredentialRef 无明文列、adapter 不泄漏 API Key、workers 路径穿越防护 + 站点白名单）。
2. 实装协议双端：命名管道服务器 + Hello 握手 + HMAC + version + 能力协商；FakeProvider 流式 + AdapterEvent 统一；Runtime 进程能起并 handshake 回包。
3. Continuum UI Kit 完整浅深双主题 token 化（从 `15-frontend-design-tokens.json` 生成 CSS 变量）+ 签名组件 AppShell/ContinuumRail/MessageBubble/TraceList/Compose/ModeSwitch + reduced-motion 兜底，jsdom 测试覆盖。
4. Electron main 预留 safeStorage broker（contextBridge + contextIsolation + nodeIntegration: false）；/preload + /renderer 已成型但二进制未编译无法启动。

仍受阻断：better-sqlite3 / electron / esbuild 三个原生模块因本机未装 VS Build Tools 无法编译，故 storage 实跑、dev:desktop 启动、runtime 事件流端到端暂不能跑（决策 DEC-20260711-004）。

影响范围：

1. M0 实跑链路待用户装好工具链即可一键贯通，无返工。

验证方式：

```text
node node_modules/typescript/bin/tsc -b packages apps  -> 全绿
node node_modules/vitest/vitest.mjs run --root <pkg>   -> 60 个单测通过（shared 4 / protocol 13 / secure-store 7 / storage 12 *
adapters 5 / workers 7 / ui-kit 9 / runtime 3；storage 直连 better-sqlite3 的用例暂跳过等 native）
SYNC_THINK_DEV_NO_TOKEN=1 pnpm dev:runtime            -> Runtime 进程启动并可握手
pnpm dev:runtime:pipe-test                           -> 应看到 Hello ok 与 healthcheck 回包
```

- storage 的 12 个是纯逻辑 (migration planner / backup / schema columns)，better-sqlite3 live 调用尚未联跑。

后续注意：

1. 装 VS Build Tools 后必须 `pnpm rebuild better-sqlite3 electron esbuild`，AI 再补 storage live / runtime subscribeEvents / checkpoint-restore / dev:desktop 启动验证。
2. 不要把 storage 改 libsql；用户已否决，TD-004 维持。

### 2026-07-11 - M0 runtime pipe commands, desktop launch chain, and native blocker isolation

Type: change / implementation / verification

Related files:

```text
package.json
pnpm-lock.yaml
scripts/dev-desktop.mjs
scripts/pipe-client.mjs
apps/runtime/src/runtime.ts
apps/runtime/tests/commands.test.ts
apps/desktop/package.json
apps/desktop/scripts/build-renderer.mjs
apps/desktop/src/main/index.ts
apps/desktop/src/renderer/index.tsx
apps/desktop/src/renderer/renderer.css
apps/desktop/tests/build-assets.test.ts
packages/test-fixtures/package.json
packages/test-fixtures/src/provider/battery.ts
packages/test-fixtures/tsconfig.json
packages/storage/src/migrate.test.ts
packages/ui-kit/src/styles/components.css
packages/core/src/index.ts
```

Change summary:

1. Fixed the Turbo test graph by removing the `test-fixtures -> adapters -> test-fixtures` cycle.
2. Implemented M0 Runtime pipe command handling for `runtime.subscribeEvents`, `runtime.unsubscribeEvents`, and `task.appendMessage`.
3. Added task-version mismatch protection and event streaming to subscribed clients.
4. Added checkpoint snapshot export/import to prove restart-state reconstruction at the Runtime logic layer.
5. Added storage live migration/FTS test coverage, guarded so it runs when `better-sqlite3` native binding exists and is skipped when the local toolchain is missing.
6. Repaired desktop build assets with esbuild and fixed root `dev:desktop` launch cwd/dependency resolution.
7. Repaired root `dev:runtime:pipe-test` by adding needed root dev tooling/dependency links and enhancing the pipe smoke client to append a message and receive a runtime event.
8. Repaired Electron postinstall/download locally; desktop smoke now starts and stays alive until intentionally killed by the smoke script.

Verification:

```text
pnpm test      -> pass; 64 tests passed; 1 storage live test skipped due missing better-sqlite3 native binding
pnpm typecheck -> pass; 20 turbo tasks successful
pnpm build     -> pass; 11 turbo tasks successful
runtime pipe smoke -> PASS; PIPE_SMOKE_OK
desktop smoke -> PASS; process still running after 8 seconds with no Electron load error
```

Remaining limitation:

```text
Visual Studio C++ Build Tools are still missing, so better-sqlite3 cannot compile for Node v24.14.1.
The storage live test is present but skipped until the native binding can be installed.
```

### 2026-07-11 - M0 native、持久化恢复与真实 Electron 链路贯通

类型：修复 / 实现 / 安全 / 验证

相关文件：

```text
package.json
pnpm-workspace.yaml
packages/protocol/src/events.ts
packages/protocol/src/handshake.ts
packages/storage/src/scripts/migrate.ts
packages/storage/src/runtime-state-store.ts
packages/storage/src/{migrate,runtime-state-store}.test.ts
apps/runtime/src/{main,persistence,runtime,demo-run,command-validation}.ts
apps/runtime/tests/{commands,demo-run,persistence,pipe,secret-persistence}.test.ts
apps/desktop/src/main/{index,runtime-client}.ts
apps/desktop/src/preload/index.ts
apps/desktop/src/renderer/{index.html,index.tsx,renderer.css}
apps/desktop/scripts/{build-preload,build-renderer}.mjs
apps/desktop/tests/{runtime-client,build-assets}.test.ts
packages/ui-kit/src/components/AppShell.tsx
packages/ui-kit/src/styles/components.css
packages/ui-kit/tests/AppShell.test.tsx
scripts/ensure-managed-pnpm.mjs
docs/operations/07-local-development.md
```

变更说明：

1. 固定 Node 20.20.2 / pnpm 10.28.2，恢复 `better-sqlite3`、Electron 与 esbuild 原生依赖；SQLite migration、FTS、WAL 与 backup 真跑。
2. 修复 migration 的 `taskId`/`task_id` 错误，并用 immediate transaction 保证失败迁移不留下部分 DDL 或迁移记录。
3. 增加 SQLite-backed Event/Checkpoint store；事件与 checkpoint 原子提交，持久化失败返回脱敏 `storage.write_failed`。
4. Runtime 默认使用 `%LOCALAPPDATA%\SYNC-THINK\sync-think.db`，重启后恢复 thread version、event sequence 和未完成 FakeProvider Run。
5. FakeProvider durable stream 覆盖 `run.started`、usage、delta 与 completed；UI 断开不终止 Run，Runtime 重启按 adapter event index 续跑且不重复 durable output。
6. 修复 Electron sandbox preload，固定输出 `dist/preload/index.cjs`；main 通过认证 named pipe 接入 Runtime。
7. 修复 StrictMode 并发连接时 `runtime.subscribeEvents` 越过 `__hello` 的竞态，阻止未认证首帧导致的 `EPIPE`。
8. RuntimePipeClient 现在隔离 stale socket、自动重连、恢复逻辑订阅，并通过 cursor 接收 missed durable events。
9. 修复订阅响应与首个 live event 同包时的丢事件窗口；客户端先投递 replay，再投递待绑定 live events，并按 sequence 去重。
10. 修复 Runtime secret 未配置时任意非空 token 可被接受的问题；token 必需模式现在同时要求服务端 secret 和正确 HMAC。
11. Renderer 加入 strict CSP，禁止 `unsafe-eval`、object、base 和 form action；真实 Electron 控制台无 warning/error。
12. 根级门禁在 managed Node 20 目录串行启用 pnpm Corepack shim，避免 Turbo 首次并发下载 Node 产生 `EEXIST/ENOENT`。
13. Continuum shell 完成浅/深主题、轨迹折叠/恢复、Lucide 图标和响应式视觉校准。

TDD 证据：

```text
RED: concurrent connect -> Runtime connection closed / EPIPE
GREEN: concurrent requests wait for authenticated hello

RED: transient disconnect -> subscription lost
GREEN: stale socket isolation + logical subscription restore

RED: active subscription does not reconnect without a command
GREEN: background reconnect with capped exponential backoff

RED: cursor subscription omits durable history
GREEN: atomic replayedEvents response + listener delivery

RED: response + first live event in one pipe chunk drops the event
GREEN: pending stream buffer preserves the handoff

RED: built renderer has no CSP
GREEN: strict local-only CSP, no Electron security warning

RED: arbitrary token accepted when Runtime secret is absent
GREEN: token-required mode rejects unconfigured Runtime authentication
```

真实进程验证：

```text
Electron footer -> 已连接 / durable stream
UI_RESTART_JOB -> Electron 结束后 Runtime PID 保持；新 Electron 重放完整 user/delta/completed 历史
RUNTIME_RESTART_JOB -> Runtime PID 66552 强制结束；PID 63244 从同一 SQLite 恢复
自动重连 -> 新 Runtime 记录 hello accepted；UI 收到剩余 delta 与 run.completed
SQLite -> run.started=1, provider.usage=1, run.completed=1, sequence 严格递增, activeDemoRuns=0
POST_RECOVERY_APPEND -> 恢复后可继续追加并完成第三条消息
Renderer -> strict CSP 生效；无 console warning/error；无横向溢出
Fresh gates -> test 20/20 tasks + 86 tests; typecheck 20/20; build 11/11; all cache bypass
Cleanup -> SYNC-THINK Runtime/Electron processes=0; named pipes=0
```

后续注意：

1. 预审查门禁通过后，独立安全/恢复审查重新打开 M0；完成状态暂不成立。
2. 未获得下一里程碑授权前，不进入 M1 真实 Provider/Agent/Context 功能。

### 2026-07-11 - M0 独立审查修复、Renderer 快照层与交接

类型：修复 / 安全 / 恢复 / TDD / 交接

相关文件：

```text
packages/protocol/src/{handshake,events}.ts
packages/storage/src/runtime-state-store.ts
apps/runtime/src/{runtime,demo-run}.ts
apps/desktop/src/event-history.ts
apps/desktop/src/runtime-bridge-contract.ts
apps/desktop/src/main/{renderer-security,runtime-client,runtime-session,index}.ts
apps/desktop/src/preload/index.ts
apps/desktop/src/renderer/{global.d,m0-projection,runtime-connection,runtime-view-state,index}.tsx/ts
apps/desktop/tests/{renderer-security,event-history,runtime-session,runtime-connect-error,runtime-connection,build-assets}.test.ts
docs/development/{03-feature-changelog,10-current-status,11-implementation-plan}.md
docs/handoff/05-handoff-guide.md
```

变更说明：

1. Pipe 升级为双向 challenge/proof 认证，并加入 fresh nonce replay 防护、统一认证失败和非重试分类。
2. replay 升为固定 high-watermark 的有界拉式分页，保留 categories 与 reconnect committed cursor。
3. `message.appended + run.started` 与 final checkpoint 在单个 immediate transaction 中原子提交。
4. Electron 仅信任明确 loopback 开发 origin 或 packaged 精确 file URL；IPC 同时验证 sender 身份和 URL；导航、重定向及新窗口全部阻止。
5. 从 main/preload/Renderer 移除 secure-store bridge；Renderer 不再接触 secret。
6. main 唯一 Runtime subscription 建立 sequence snapshot；Renderer 将 snapshot/live 排序去重并确定性重建 M0 消息、版本、assistant 和 trace。
7. hydration 前 Compose 禁用；transient 初始连接使用可取消有限退避，认证/协议/权限失败不重试。
8. forward/send 异常不再终止 durable subscription；Runtime health/error bridge 只暴露脱敏结构化字段。

TDD 与审查证据：

```text
Electron security target：5/5 passed
Renderer recovery focused：19/19 passed
Desktop full：7 files / 39 tests passed
Desktop typecheck/build：passed
每个主要任务均完成规格审查 -> 代码质量审查；最终两阶段均通过
```

真实进程状态：

1. 重建 `@sync-think/runtime` 后，raw 两阶段认证 challenge/runtime proof/client proof 全部通过。
2. 真实 Electron 在线，Compose 消息持久化并收到完整 FakeProvider assistant，console warning/error 为 0。
3. 随后的真实 Renderer `page.reload()` 在 30 秒内未完成；根因尚未定位。
4. 因此本轮未重新完成最新构建下的 UI restart、Runtime restart 与 root `--force` 三项门禁，M0 仍保持打开。

后续注意：

1. 下一对话必须先按 `docs/handoff/05-handoff-guide.md` 系统定位 reload timeout，并以 RED -> GREEN 修复。
2. 真实 Provider 跨进程计费/副作用幂等不是 M0 保证，应在最终限制中明确保留。
3. M0 关闭前不得进入 M1。

## 2026-07-12 — M1 模型绑定 / live stream / Manifest

- core: `resolveModelBinding` 优先级 + pause-on-no-fallback；`buildContextPacket`
- adapters: OpenAI Chat Completions SSE streaming + 错误分类 scrub
- runtime: 绑定注册 model、SecureStore 取钥 live call、`context.packet.built`
- desktop: trace 展示 Manifest / resolutionSource
- docs: `12-test-log.md` 固定大白话测试日志

## 2026-07-12 — Compose 模型选择器（Run override）

- ui-kit Compose：本轮模型下拉、`onSend(text, { modelId? })`、run override / agent default 可观测标签
- desktop：`buildComposeModelOptions` 扁平化注册模型；发送时带 `modelId`
- 不改 Runtime 绑定真源；沿用 resolveModelBinding + Manifest 事件

## 2026-07-12 · Memory/Diagnostics 面板 + 系统文件夹选择器

- UI：左侧 `MemoryDiagnosticsPanel`（持久记忆 / 待审变更 / 诊断）
- Desktop IPC：`memory.list` / `memory.decide` / `diagnostics.list` / `desktop:pick-folder`
- 创建工作区改用系统文件夹对话框
- secrets 仍不进入诊断与 Renderer
- `m1-obs-layout`：新增 product workspace disclosure 语义；中心验证工作台默认折叠、跳转自动展开、展开体限高滚动。
- Desktop：产品态启用 `hideReadiness`，去除 Workspace/AppShell/Mode/Continuum/Manifest/Trace 重复自检块；业务内容与 Locked 三栏 IA 保留。
- ui-kit：`WorkspaceNav` 新增已测试的 `hideReadiness`。
- Runtime：`appendEvent` 在持久模式走 `SqliteEventCheckpointStore.commitTransition`，统一全事件序列来源，修复 replay 重复/逆序导致的 `runtime.protocol-error`。
- Storage：`listTasks` 同时间排序 tie-break 从随机 ULID 改为插入 `rowid`。
- 测试：根级 707 tests、typecheck、build、M1 quick soft、Electron 真实截图全部通过。
- 边界：**M1 仍 open**；外网手测 0/18、dogfood 0/3；不启动 M2。

## 2026-07-31：DesktopWorker P0.2 窗口发现与 bounded UIA inspect

- 新增 Win32 顶层窗口发现：`EnumWindows + IsWindowVisible + GetWindowTextW + GetWindowThreadProcessId + DWMWA_CLOAKED`。
- `DesktopWindowListResult` 新增强制 `truncated` 字段，最多返回 256 个窗口。
- 新增 exact window fence：inspect 前后校验 HWND/PID/可选 title，稳定错误码为 `desktop.window-stale`。
- 新增真实 UIA Control View 遍历，支持深度、节点数和 UTF-8 文本字节上限，并正确释放 COM/BSTR 引用。
- 元素快照新增真实 Name、AutomationId、ControlType、ProcessId、Enabled、Offscreen、Bounds 与 Invoke/Value Pattern 探测结果。
- 新增确定性 `desktop-a11y-v1:<sha256>` 与 `desktop-snapshot-v1:<sha256>` revision。
- 新增 driver backend 注入测试、window-list response schema 测试和真实 Node 20 compiled Host smoke。
- 验证：Workers `86 passed / 3 skipped`，typecheck、lint、build、Prettier 与 `git diff --check` 通过。

## 2026-07-31：DesktopWorker P0.3 exact selector resolution

- Desktop Host contract 新增 `resolve-selector`、`DesktopSnapshotTarget` 与 `element-resolved` result。
- selector 采用两种互斥的精确策略：`automationId` 优先（可选 `controlType`），否则必须提供 `name + controlType`；不做 fuzzy match 或隐式 fallback。
- resolution 会按请求中的 tree limits 重新 bounded inspect exact window，并在匹配前校验 `snapshotRevision + accessibilityRevision`。
- 新增稳定错误码：`desktop.snapshot-stale`、`desktop.selector-not-found`、`desktop.selector-ambiguous`。
- 唯一匹配返回 exact window、双 revision、`elementIndex` 与对应元素快照，为后续 read/focus/Invoke/SetValue 提供短生命周期引用。
- 新增 contract 与 driver 测试，覆盖 automationId、name+controlType、not-found、ambiguous 和 stale revision。
- 真实 WPF fixture compiled Host smoke 通过：12 个节点中 `ApplyButton` 唯一解析为 `elementIndex=4`，Invoke Pattern 可见。
- 验证：Workers `92 passed / 3 skipped`，Shared/Workers typecheck、Workers lint/build、Prettier 与 `git diff --check` 通过。

## 2026-07-31：DesktopWorker P0.4 最小 UIA 语义动作

- 新增 `read-element`、`focus-element`、`invoke-element`、`set-value` Host contract，并为四类动作统一接入 bounded tree limits 与严格 schema 校验。
- 每次动作针对 exact window 重新 bounded inspect，在同一 COM apartment 中保留短生命周期 element lease；Driver 校验双 revision 和 `elementIndex` 后才允许执行 UIA 方法。
- `read-element` 使用 Value Pattern 或 fenced Name/Text；Focus 使用 `SetFocus`，Invoke 只使用 Invoke Pattern，SetValue 检查只读后使用 Value Pattern，正文继续通过 Host stdin JSONL 传输。
- 新增稳定错误码覆盖元素不存在、disabled、offscreen、Pattern 不支持、Value 只读和原生动作失败；不引入坐标、SendInput、剪贴板、OCR 或模糊回退。
- lease 结束后释放目标 Element、Pattern、Walker、Automation、BSTR 和 COM apartment，避免跨请求保存原生元素指针。
- 真实 WPF compiled Host smoke 通过：读取 `initial`、Focus、写入并读回 `p04-smoke`、Invoke `ApplyButton`，最终读取 `ResultText=applied:p04-smoke`。
- 验证：Workers `97 passed / 3 skipped`，Shared/Workers typecheck、Workers lint/build、目标文件 Prettier 与 `git diff --check` 通过。
- 当前只完成 DesktopWorker Host 最小语义动作；下一切片是 Runtime durable command、审批/用户中断 fence、`waiting_user` 人工接管和 Continue / Cancel 恢复接线。

## 2026-08-01 — Image P0.3 第二切片：多候选并列比较与 durable 选择

- 图片生成多输出现在归入一个 Artifact 的多个 immutable ArtifactVersion，而不是创建多个独立 Artifact。
- Artifact list 安全投影候选序号、总数、尺寸、质量和字节数；完整 metadata 与本地路径仍留在 Runtime/Main。
- Desktop 图片候选画廊支持“选择此候选 / 当前候选 / 未采用”，并隐藏不适用的文本 diff、左右 picker 与 merge。
- Provider reservation replay 会重新派生临时分组键，避免重复 Provider 调用并保持相同物化语义。

### 2026-08-01 · Agent Thread / Context Epoch、Provider Cache 与 Token Usage

- Scheduler 为 execution/rework/reviewer workstream 分配稳定且隔离的 AgentContextThread；retry 复用，Reviewer 不继承前端 Agent transcript，rework 回到目标执行线程。
- Production Executor 按 provider/model/context window 管理 ContextEpoch，并使用 provider/model/thread/epoch 构造稳定 prompt cache identity。
- OpenAI/Anthropic usage 统一持久化 input/output、cache hit/cache write、reasoning 和 total token；Runtime 可按 request/thread/epoch/purpose 汇总，缓存内容不落本地数据库。
- Reviewer reject 只持久传递结构化 ReviewDecision；完整 transcript 与 Artifact parent lineage 不混作上下文真源。

## 2026-08-02：大数据库 Task-scoped 上下文边界读取与真实启动验证

- 默认 16.87GB 开发数据库的第三个启动阻塞点定位为上下文 compact boundary 的全局 Event 扫描：未完成对话恢复会在 Runtime pipe 就绪后读取约 198 万条 Event 及其 payload，导致 V8 heap OOM 和 Runtime exit code 134。
- Storage 新增 `listEventsByTask(taskId)`，SQL 强制使用 `event_task_idx`，只按稳定顺序读取当前 Task 的 durable Event，不包含全局 telemetry 或其他 Task。
- Runtime 的上下文状态恢复与手动 `conversation.compact` 均优先走 Task-scoped 索引查询；仅为 legacy/test store 保留旧的全局回退。
- 新增 Storage 查询计划测试与 Runtime 集成测试，确保大库维护路径不会调用 `listAllEvents`。
- 使用真实 `.data/SYNC-THINK/sync-think.db` 验证：约 5 秒完成 Runtime/Database/Hello 启动链路；35 秒采样 Runtime 工作集仅增长 0.4MB；Electron 主窗口响应并显示任务列表与聊天工作台；日志无 pipe timeout/OOM；备份数保持 76。
- 证据日志：`.data/manual-task-indexed-context-20260802-160502/desktop.stdout.log` 与 `desktop.stderr.log`。

## 2026-08-02 · Runtime Event payload sidecar allowlist

- Runtime 新增默认关闭的 Event payload sidecar 选项与环境变量入口。
- 仅对达到 64 KiB 的 `context.packet.built` 使用 `context-packet-query-v1@1` 外置；其他 Event 和小 payload 保持内联。
- 默认 sidecar 目录绑定 database path 与 install ID；重启 hydrate，missing/corrupt blob fail-closed。
- Runtime 启动不触发 backfill、rollback、GC、quarantine 或其他数据库治理动作。
- 新增默认关闭、白名单、阈值、projection、身份隔离、legacy inline、startup no-governance、restart hydrate 与 blob 故障测试。

## 2026-08-04 · 历史 Run 恢复熔断与全协议 Prompt Cache

- Runtime 冷启动只自动恢复最近 5 分钟内仍有活动的对话 Run；超龄 Run 保留审计记录并转为 `run.paused/recovery_expired`，不再发起 Provider 请求。
- 同一 Provider 连续两次出现 timeout、transient、rate-limit 或 auth 失败后打开 Run 级熔断，跳过剩余同源模型；跨 Provider 的用户配置 fallback 仍可继续。
- 桌面任务对话现在按 Provider、内部模型和 Thread 生成稳定缓存键，不再使用每轮变化的 Run ID；工作流 Step 继续使用 AgentContextThread/ContextEpoch 隔离缓存身份。
- OpenAI Responses 与 Chat Completions 同时支持缓存键、cache read/write usage；GPT-5.6 及后续模型使用稳定 `prompt_cache_key` 与 `prompt_cache_options { mode: implicit, ttl: 30m }`，不发送当前中转站会以 502 拒绝的内容级 `prompt_cache_breakpoint`；旧模型保留稳定 key，并只在兼容型号上发送 retention。
- Anthropic Messages 在稳定 system、tools 和最近历史消息上写入原生 `cache_control`，继续解析 cache read/create usage。
- 修复暂停通知源码中的问号字面量，新增过期恢复、缓存请求体、usage 与 Provider 熔断回归测试。
- 本地源码重启后完成真实中转验证：`gpt-5.6-sol` 去除 breakpoint 后连续三次 `run.completed`，第三次输入 8932 tokens、缓存命中 8704；`gpt-5.5` 两轮均完成并各命中 3584。`usage.summary` 投影近一天总缓存命中 15872 tokens，其中 5.6 为 8704、5.5 为 7168，模型与 Provider 显示正常。
- 本轮只构建并重启本地源码实例，未生成 installer、portable 或 release artifact。

## 2026-08-04 · Token 计价拆分与用量明细修复

- 新增统一 Token 拆分规则：Provider `tokensIn` 作为包含缓存读写的总输入，普通输入按 `tokensIn - cacheRead - cacheWrite` 计算；缓存明细异常超过总输入时会被裁剪，避免负数与重复计费。
- Runtime 费用投影新增普通输入、缓存读取、缓存创建、输出四个互斥费用分项；总费用只汇总这四项一次，请求日志可展开查看六位小数明细。
- Anthropic usage 归一化修正为“普通输入 + cache read + cache creation = 总输入”，与 OpenAI 和项目 `ProviderUsage` 契约一致。
- 使用统计请求表固定显示普通输入、缓存读取、缓存创建、输出与命中率；模型和供应商合并为双层信息列，顶部摘要使用同一拆分口径并把核心缓存指标改为命中率。
- 移除失控的“详情记录”复选框，费用拆分改为每行 Chevron 按需展开；请求表固定最小宽度 720px，在 1024x720 窗口中不再出现无意义横向滚动角块。
- 聊天消息“本轮回复”悬浮卡新增总 Token、普通输入、缓存读取、缓存创建和输出五行；Runtime run process 单独投影缓存读写字段。
- 实际数据验证：一条 `gpt-5.6-sol` 请求显示总计 `22.6k`、普通输入 `3.7k`、缓存读取 `16.9k`、缓存创建 `0`、输出 `2.0k`；费用分项 `$0.018660 + $0.506880 + $0.000000 + $0.023424 = $0.548964`，列表按四位小数显示 `$0.549`。
- Shared、Protocol、Adapters、Runtime、Desktop 定向测试、类型检查、lint 和 build 通过；全量并发中的 MCP/watchdog 时序用例单独串行复跑为 `10/10` 与 `9/9` 通过。仅重启本地源码实例，未生成安装包。

## 2026-08-04 · Prompt Cache 与使用统计最终闭环

- Force-final 请求保留原 system 与 tools，仅通过 `tool_choice: none` 禁止继续工具调用，避免最后一轮因为 Prompt 前缀突变丢失缓存；OpenAI Chat、Responses 与 Anthropic Messages 均已覆盖。
- 同一 `gpt-5.6-luna` 对话的实时闭环验证显示：切换 tools 配置后的首轮为预热 miss，随后两轮分别读取 `2560/3102` 与 `2560/3141` 输入 Token，命中率约 82%；中转继续返回缓存创建 0，因此不合成不存在的 write usage。
- 使用统计深浅主题、1424x861 与 1024x720 均完成实窗检查；请求表默认态、费用展开态与消息 Token 悬浮明细均可读且无布局溢出。
- 本轮继续只使用本地源码构建与 Runtime/SQLite 实测，没有生成 installer、portable 或 release artifact。
