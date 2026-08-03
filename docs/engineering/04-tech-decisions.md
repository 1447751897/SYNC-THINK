## TD-031：Phase 3 视觉证据与 Windows 发布链采用本地门禁/外部证据分层（2026-08-02）

- **决策**：本地自动化只证明可在仓库内复现的契约、构建、feed、截图和恢复证据；正式证书、真实私有服务、Provider 凭证与邀请用户结果必须作为独立外部证据，不以 fixture 结果冒充完成。
- **视觉方案**：使用项目现有 Electron `BrowserWindow.capturePage()`，不引入 Playwright/Puppeteer；通过仅测试可达的 query fixture 复用真实 React 组件，固定 viewport/theme/zoom/reduced-motion，并用 manifest 复核 case、尺寸、字节数与 SHA-256。Hash 用于同次产物完整性，不宣称跨机器像素完全一致。
- **发布方案**：正式 Windows release 对证书来源、SHA-256 和 RFC 3161 timestamp fail-closed；installer 与 `.exe.blockmap` 必须配对进入 manifest/feed。Generic feed 的 audience、授权、rollout、最低版本、允许/撤回版本策略均由生成与消费两端验证。
- **恢复边界**：Updater 失败时保留当前已安装版本，原子写入最多 20 条脱敏 recovery evidence；当前不自动 binary rollback。恢复优先采用撤回 feed、重试、发布更高修复版本或人工安装已验证旧版本。
- **回滚**：视觉 fixture 可从 shell entry 移除且不影响生产导航；发布策略可回退到上一稳定 manifest/feed，但不得关闭签名校验来“修复”正式发布。

## TD-032：Database Governance retention 与 physical compaction 保持显式离线（2026-08-02）

1. Event retention selector 只选择 fully-global low-value telemetry，使用 canonical UTC cutoff 与 `(sequence, id)` high-water fence；task/run/step/message scoped、durable identity、protected Event 与 high-water 之后的记录始终排除。
2. prepare 只读并在 SQLite query-only 连接上生成 exact hashed manifest。execute 前先发布 `manifest.json + events.jsonl.gz + segment.json` portable recovery set，execute/rollback 都要求 exact token、maintenance window、durable audit 与 source fence。
3. execute/rollback 使用批次事务、compare-and-swap/精确 INSERT、批次边界 cancel/resume，并对“数据库提交成功但 audit cursor 尚未推进”的崩溃窗口进行对账。
4. 逻辑 retention 与物理 compaction 分离。incremental vacuum 仅允许 `auto_vacuum=INCREMENTAL` fixture，并受 page/time budget 限制；offline compaction 使用 `VACUUM INTO` 生成新候选库，不原地覆盖源库。
5. compaction manifest 固化 schema/user version、Event/Checkpoint high-water、全表 row-count projection、page/freelist/bytes/hash。候选库必须通过 quick/integrity check；governance root、manifest、audit 与 output 均拒绝路径逃逸、symlink、junction 和 reparse point。
6. Runtime startup 永不自动执行 backfill、rollback、mark/sweep、retention、archive、incremental vacuum 或 offline compaction；默认约 16.87 GB 主库与历史备份继续只读。

## TD-Database-Governance-P0.4-B4：sidecar orphan 只隔离不删除（2026-08-02）

1. GC 采用 mark/sweep 两阶段，mark 是 readonly/query_only 精确快照；sweep 只接受 manifest hash 派生的精确 token，并要求离线 maintenance window。
2. sweep 只移动 manifest 中的 blob 到 `.quarantine/<sweepId>/`，不永久删除；mark 后新增的合法 managed blob 不进入旧 sweep，下一轮重新 mark。
3. 数据库 fingerprint、live-reference manifest、blob 内容身份、audit cursor/bytes/status/timestamps 与目录链均 fail-closed；symlink、junction、reparse point 和路径逃逸均拒绝。
4. Runtime startup 永不自动执行 backfill、rollback、mark、sweep、archive、VACUUM 或 compaction。

## TD-Database-Governance-P0.4-B2：payload backfill 采用 blob-first + SQLite CAS + audit-last（2026-08-02）

1. 先将 content-addressed sidecar blob 写入并校验，再在单个 SQLite transaction 内按 `id + rowid + 原 payload_json` compare-and-swap 更新 envelope，最后推进 durable audit cursor。
2. blob-only crash 留下的 orphan 不在 backfill 中删除，由 B4 exact mark/quarantine 独立治理；SQLite commit/audit-lag crash 通过数据库状态与 durable cursor 对账恢复。
3. 执行前必须生成并验证 portable SQLite + sidecar recovery set。completed/resume 都重新验证 plan、source fence、recovery manifest 与 blobs。
4. 默认 CLI 保持只读；execute 与 rollback 仅在 exact token + maintenance window 下存在，并支持批次边界 cancel/resume。

## TD-030 实施更新：数据库增长治理、Codex 本地状态分层与安全维护边界（2026-08-02）

**状态：已采用；P0.1-P0.4 的只读诊断、写入放大修复、可回滚执行器、sidecar/backfill/rollback/GC、retention/archive 与 physical compaction 均已实现。**

### 调研证据

- 官方 Codex Manual 公开说明：任务可 resume/fork/compact，长任务会自动 compact；每个 subagent 使用独立 agent thread，主任务只收集其摘要；本地状态位于 `CODEX_HOME`。官方资料不公开 SQLite 内部 schema，因此下列数据库细节属于本机 2026-08-02 版本的只读观察。
- 本机 Codex 将正文与查询投影分层：`state_5.sqlite` 主文件约 1.36 MiB，保存 144 条 thread 元数据、`rollout_path`、preview、tokens、archive/pin/source/model/cwd 等投影；完整 144 个任务正文位于 append-only `rollout-*.jsonl`，合计约 880.33 MiB。
- 119 个活跃 rollout 按 `sessions/YYYY/MM/DD` 分区，25 个归档 rollout 物理移动到 `archived_sessions`；SQLite 的 archived flag 与文件目录 144/144 一致。归档是生命周期变化，不是把正文复制回主状态库。
- rollout 记录由 `session_meta`、`turn_context`、`event_msg`、`response_item`、`world_state`、`compacted` 等追加记录组成；compact 通过新的 compacted/context_compacted 边界表达，不覆写历史文件。
- Codex 按关注点拆库：`state_5.sqlite`、`logs_2.sqlite`、`goals_1.sqlite`、`memories_1.sqlite` 分离，均使用 WAL、SQL migration 和 incremental auto-vacuum。State DB 另有 backfill_state；thread 查询使用 archive/cwd/recency/visible/pinned 等组合或 partial index。
- `logs_2.sqlite` 当前约 196.57 MiB，但 logs 行数为 0、freelist 为 50,251/50,322 页，并存在阻断新日志写入的 trigger；这表明“停止增长/逻辑清理”与“物理压缩”被分离，物理文件不会在普通启动路径强制 VACUUM。

### SYNC-THINK 决策

1. Event/Checkpoint 继续作为 durable audit 与恢复真源；P0.1 不删除、改写、VACUUM 或迁移现有数据。
2. 诊断与执行严格分离。`pnpm db:governance` 默认使用 SQLite readonly + query_only，输出 versioned report 与 dry-run maintenance plan；执行动作必须进入后续独立工具和显式确认门禁。
3. quick 模式只做覆盖索引计数、PRAGMA、备份元数据和最多 4096 个均匀 rowid 样本，不读取 Event payload；`--deep` 才执行一次按 category/type/payload size 的完整 SQL 聚合；`--physical` 才枚举 dbstat 物理页。
4. 大库维护不得进入 Runtime 启动路径。WAL checkpoint、备份淘汰、Event retention、Checkpoint cadence 修复、incremental vacuum/VACUUM 均需要维护窗口、回滚点和独立验收。
5. taskless 不等于 global，也不等于可删除。只有 Task/Run/Step/Message 全部无归属、属于低价值 telemetry/diagnostic 且未命中 protected marker 的 Event，才可进入 dry-run 候选；Task/Run/Message、审批、Artifact、Context、Browser/Desktop waiting_user、recovery/checkpoint 始终受保护。
6. 参考 Codex 的“正文日志 + 查询投影”方向，但不立即迁移 SYNC-THINK Event 真源。后续若拆分，先建立 projection/backfill/version/rollback 协议，再考虑把高体积上下文载荷移出主查询库。
7. P0.2 将 Runtime Checkpoint cadence 固定为每 128 个 durable Event 一次；`run.completed`、`run.failed`、`run.cancelled`、`run.paused` 四种终态始终强制 Checkpoint。该策略从最近 Checkpoint 的真实 Event sequence 延续，不因 Runtime 重启重置节奏。
8. 稀疏 Checkpoint 后，所有推进 Run 游标的非终态 durable Event 必须携带精简 `payload.run` 投影，使 Event replay 能恢复 `nextAdapterEventIndex` 等执行游标；投影继续剥离 Skill 正文、Context Snapshot、图片 data URL 与 MCP dispatch 等非持久内容。
9. fallback continuation 的 `run.fallback.selected` 与对应 `context.packet.built` 必须在同一个 SQLite transaction 中原子提交；提交前以当前 Run 的 `modelId + packetId` 做 continuation fence，阻止同一 fallback 被重复追加。
10. P0.2 只阻止未来写入继续放大，不删除、迁移、压缩、VACUUM 或覆盖当前约 16.87 GB 主库及 76 个历史备份；历史数据治理进入 P0.3 独立可回滚执行器。
11. P0.3 的执行输入是不可变、SHA-256 校验的精确 manifest：固定 selector version、源数据库 fingerprint、完整 Event ID、备份 name/size/mtime、protected 摘要与 inspection hash；候选被截断、hash/token 不匹配或数据库 stale 时一律停止。
12. 恢复点使用 SQLite native backup 创建一致性副本，并通过只读 `quick_check(1)`、稳定 `schemaHash`、Event/Checkpoint count 与 max sequence 复核；物理 `schema_version/page_count` 不作为 backup 等价条件，因为 backup 目标的 schema cookie 与页面布局允许不同。
13. CLI 默认路径继续 readonly + query_only。只有 `--execute-manifest`、精确 `--confirm` token、`--maintenance-window` 三项同时存在，才会打开 writable connection；普通 `pnpm db:governance` 与 `--prepare-manifest` 永不写数据库。
14. Event 删除按 manifest exact IDs 分批事务执行，默认 500、最大 5000；DELETE 时再次应用同一 protected selector。候选若在 manifest 后变成 approval/artifact/context/run/task/browser/desktop/recovery 等受保护事件，执行器 fail-closed。
15. 每批提交后原子覆盖 durable audit，记录恢复备份、游标、删除/缺失计数与 quarantine 进度；首次 Ctrl+C 仅在当前事务批完成后取消。cancelled/failed audit 可幂等恢复，resume 同时拒绝 post-manifest 新 Event 或 Checkpoint/schema 变化。
16. 旧迁移备份不直接删除，只移动到 `<backups>/quarantine/<planId>/`；移动前后均校验 name/size/mtime，支持 crash 后按 audit 恢复。
17. P0.3 的 rollback 以 verified recovery backup 为依据，不提供在线自动覆盖。恢复必须先完全关闭 Desktop/Runtime，先保存维护后数据库与 WAL/SHM 的事故快照，再以 recovery backup 替换数据库并按 audit 将 quarantine 文件移回；真实 16.87 GB 主库和 76 个历史备份尚未执行 P0.3。
18. P0.4 第一切片采用 content-addressed gzip sidecar，而不是第二个 WAL SQLite 正文库：原始 UTF-8 JSON 的 SHA-256 同时作为内容身份和固定路径 `v1/sha256/<prefix>/<sha256>.json.gz`，相同正文天然去重。
19. SQLite `event.payload_json` 复用现有列保存 V1 引用 envelope 与小型 `projection`，不新增 migration；envelope 固定记录 version、storage、codec、compression、SHA-256、原始/压缩字节数和跨平台相对路径，`$syncThinkPayload` 成为保留字段。
20. 写入顺序固定为 blob-before-Event：sidecar 先写唯一临时文件、`fsync`、原子 rename 并完整回读校验，之后 Event 才进入 SQLite transaction。SQLite 事务失败允许留下无引用 blob，后续以 mark/sweep 治理；绝不先提交可能缺失的引用。
21. Event 读取 API 对 envelope 自动 hydrate，并严格验证版本、codec、compression、路径、压缩字节数、解压字节数、SHA-256 与 JSON object。未配置 sidecar、文件缺失、损坏或引用非法均 fail-closed，不降级返回 projection 冒充完整 payload。
22. `SqliteEventCheckpointStore` 的外置策略保持显式 opt-in，可配置最小字节阈值、Event selector 与 projection builder；未配置时全部沿用原内联行为，旧数据库和现有调用方无需迁移。
23. 第一切片尚未接入 `openPersistentRuntime()`。在 sidecar-aware backup manifest、一致性 restore、exact backfill、durable cursor/cancel-resume 和 rollback 验证完成前，真实 Runtime 不产生外置正文。
24. P0.4 第二切片先把 Database Maintenance manifest/audit 升级到 V2：manifest 固化 sidecar source root、按 Event ID 排序的 reference hash、唯一 blob 精确清单、每个 blob 的引用数与长度；同一正文只进入恢复集一次。
25. recovery set 同时包含 native SQLite backup 与独立 `<planId>.backup.db.sidecars`。创建时先写唯一 staging DB/sidecar，逐项 hydrate 并验证 SQLite logical fingerprint、portable sidecar manifest、reference hash、blob hash/size，再发布固定路径；失败只清理经过 path fence 的本轮精确恢复路径并写入 failed audit。
26. resume 与 completed audit 都必须重新验证完整 recovery set，不能让既有 completed 状态掩盖后续缺失或损坏；恢复目录不依赖原 sidecar root 继续存在。
27. `--prepare-manifest` 新增可选 `--event-payload-sidecar <path>`，供维护工具显式指定正文根目录；Runtime 仍未启用 sidecar。
28. exact backfill 的第一阶段只生成 V1 dry-run plan：固定 selector version、projection builder ID/version、Database Maintenance source fingerprint、source selection hash、source sidecar reference hash、destination reference hash 与完整 plan hash。
29. 当前 selector 仅允许 `context.packet.built` 且默认阈值为 64 KiB；query-safe projection 只保留固定标量字段，不把 `summaries`、`includedSources` 等大正文复制回 SQLite 计划。
30. 每个候选 Event 精确记录 ID/rowid/category/type/sequence/occurredAt、原 payload SHA-256/UTF-8 bytes、projection、目标 content-addressed reference、envelope bytes 与逻辑 SQLite 减量；容量汇总同时区分引用累计、去重后唯一 bytes、预计新增 bytes 与复用既有 blob。
31. dry-run 扫描在一个 SQLite 只读事务快照内完成；`--prepare-backfill-plan` 使用 `readonly + query_only + fileMustExist`，只允许写 plan JSON，不创建 sidecar root，不修改 Event、WAL、备份，也不执行真实 backfill。
32. 执行前 stale fence 必须重验计划结构/hash、精确 Event selection、destination references、sidecar reference set 与 Database Maintenance fingerprint；任一 Event 原地变化、新增匹配 Event、sidecar 漂移或计划字段篡改均 fail-closed。
33. 下一子项是 durable batch cursor/cancel-resume；之后依次实现 rollback 与 orphan mark/sweep。以上门禁完成前，`openPersistentRuntime()` 不启用外置写入。
34. 长期 retention/archive budget、incremental vacuum 与离线物理压缩继续后置；真实 16.87 GB 主库和 76 个历史备份保持只读观察状态。

### 本机诊断结论

- 主库 16.87 GB（命令按 GiB 显示 15.71 GiB），Event 1,986,942，taskless Event 1,986,820，Checkpoint 1,986,492；76 个迁移备份合计约 100.93 GiB。
- 4096 条有界样本中，`context.packet.built` 2013 条（49.1%）与 `run.fallback.selected` 2013 条（49.1%）占主导；两者均有 Run 等作用域，因此当前不会被 telemetry 候选规则选中。
- 这与既有 fallback 循环事故一致：异常循环同时放大 Context Packet、fallback Event 与近逐 Event Checkpoint。P0.2 应先修复/验证写入 cadence 和 lineage，再设计可回滚的数据修复执行器。

## TD-013 实施更新：Windows NSIS installer 与生命周期 smoke（2026-08-01）

1. Windows P0.2 installer 固定使用 `electron-builder@26.15.3` 的 NSIS target，`appId=com.syncthink.desktop`、x64、per-user assisted、允许修改安装目录，并创建桌面与开始菜单快捷方式。
2. 卸载器默认只移除程序、注册项和指向该安装目录的快捷方式；Electron `userData`、packaged install identity、safeStorage 密文和外部 SQLite 必须保留，重装后复用。
3. installer 输入只允许来自受控 portable release 子目录，输出必须是另一个 `apps/desktop/release/<child>`。production deploy 使用 hoisted 物理依赖树；owned package 的 `scripts` 与 `release` 必须剪除并进入 forbidden scan，防止 artifact 递归打包。
4. 升级 smoke 必须修改真实 payload 的 `resources/app/package.json` version，而不是只覆盖 installer display version；版本覆盖接受严格 semver，并继续受 release child path fence 约束。
5. installer manifest 必须记录并校验 target、platform、arch、version、artifact 相对路径、字节数、SHA-256 和签名状态；P0.2 当前 `signed=false`。
6. 正式生命周期验收固定为 clean install、same-version overlay、new-version upgrade、uninstall preserve、reinstall restore；每阶段验证 Runtime ready、package/registry version、身份、密文和数据库连续。
7. smoke 每次使用唯一 `.data/installer-smoke-<guid>`，只操作精确 installer、install directory、PID 和 shortcut target；不递归删除已有根目录，也不接触正常用户数据。
8. P0.2 明确保留边界：unsigned、Electron 默认图标、`differentialPackage=false`、`compression=store`。P0.3 再接入 Authenticode、品牌资源、electron-updater 私有 feed、差分更新与 artifact 体积优化。

## TD-006 实施更新：packaged install identity 与 pipe credential（2026-08-01）

1. packaged Desktop 的安装身份真源固定为 Electron main：首次启动生成 `install-<UUID>` 和 32-byte base64url pipe secret，后续启动必须从同一 `userData` 复用；Renderer、preload 与 Runtime 均不得独立生成或覆盖身份。
2. `runtime-identity.json` 只保存 schema version、install ID、opaque secret-store handle 与 createdAt。pipe secret 通过 Electron `safeStorage` 加密，再由现有 `@sync-think/secure-store` 写入 `secure-store/runtime-identity/<handle>.safe-storage`。
3. 首次初始化采用进程锁、过期锁回收、临时文件与原子 rename；并发启动只能产生一个身份。metadata 损坏或解密失败必须返回稳定错误码并 fail-closed，不自动轮换 secret。
4. Desktop Runtime client 与 managed Runtime supervisor 接收同一个内存 identity。子 Runtime 环境显式覆盖 install ID、pipe secret、no-token，并删除继承的旧 secret 与 `ELECTRON_RUN_AS_NODE`。
5. packaged 模式固定 `allowNoToken=false`；development 保留显式环境变量覆盖，无覆盖时继续使用 `dev-0001` 与 no-token，且不创建 packaged identity 文件。
6. 日志只允许记录 install ID、source、allowNoToken 与 `pipeSecretConfigured`；secret 明文不得进入日志、Renderer、preload、SQLite、manifest、诊断导出或命令参数。
7. 正式验收必须包含同一 `userData` 的两轮完整冷启动，并证明 install ID、secret handle 与密文文件稳定复用，同时 pipe/database/hello 成功且无认证、解密或地址占用错误。
8. 本切片不包含 Windows installer。P0.2 只有在干净安装、覆盖升级、卸载与用户数据保留 smoke 完成后才可关闭。

# Tech Decisions

本文档记录开发过程中涉及的技术选型、原因、取舍和后续影响。任何重要依赖、框架、服务、架构方案变化都必须记录。

产品架构边界以 `docs/superpowers/specs/2026-07-11-sync-think-product-design.md` 为准。
标记为 **Locked for planning** 的栈方向已在产品设计中确认；TD-004–014 已于 2026-07-11 由用户确认采用（“全部接受推荐，计划确认”）。

## 1. 技术栈总览

| 分类              | 选型                                                           | 用途                          | 选择原因                                                  | 状态                |
| ----------------- | -------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------- | ------------------- |
| 桌面壳            | Electron                                                       | Windows 闭测桌面 UI           | 跨平台迁移路径、生态成熟；产品设计已否决 Tauri/WinUI 首发 | Locked for planning |
| UI                | React + TypeScript                                             | 主工作台与各中心页            | 与 Electron 生态匹配；利于复杂状态 UI                     | Locked for planning |
| Runtime           | 独立 Node.js + TypeScript 进程                                 | 编排、上下文、Provider、策略  | UI 重启不杀 Run；可被未来 CLI 复用                        | Locked for planning |
| 真源存储          | SQLite + FTS5                                                  | 任务/事件/定义/搜索           | local-first、单文件、可备份迁移                           | Locked for planning |
| SQLite 访问       | `better-sqlite3` + Drizzle ORM + drizzle-kit                   | 同步驱动、类型化 schema、迁移 | 见 TD-004                                                 | 已采用              |
| 状态表达          | XState v5 + 自研 event/checkpoint store                        | Run/Step 生命周期             | 见 TD-011                                                 | 已采用              |
| UI↔Runtime        | Electron main bridge + 认证 named pipe + JSONL 帧              | 本地协议                      | 见 TD-006                                                 | 已采用              |
| 浏览器自动化      | Playwright Worker                                              | 授权网页操作                  | 成熟、可隔离                                              | Locked for planning |
| Windows 桌面控制  | 自研 Worker + `koffi` 调 UIA COM；失败回退人工                 | 桌面自动化                    | 见 TD-007                                                 | 已采用              |
| MCP               | 官方 TypeScript SDK                                            | 工具协议                      | 标准；授权在 Runtime                                      | Locked for planning |
| Provider          | OpenAI-compatible + Anthropic-compatible 适配器                | 模型/图像调用                 | API-first 闭测覆盖面                                      | Locked for planning |
| 凭证              | Electron `safeStorage`（DPAPI）封装 + CredentialRef            | API Key 等                    | 见 TD-005                                                 | 已采用              |
| 视觉系统          | 自定义 token + 原创组件；Radix 仅作无样式行为原语；Lucide 图标 | 可获奖级工作台                | 见 TD-003 / TD-012                                        | 已采用              |
| 测试              | Vitest + Playwright(test 仅 E2E 后期)                          | 单测/合同/集成                | 见 TD-014                                                 | 已采用              |
| 分发              | electron-builder NSIS + 代码签名 + electron-updater 私有 feed  | 闭测                          | 见 TD-013                                                 | 已采用              |
| 包管理 / monorepo | pnpm workspace + Turborepo                                     | 多包构建                      | 见实施计划                                                | 已采用              |

## 2. 已确认决策

### TD-001: 应用架构 = Desktop UI + 独立 Local Agent Runtime

日期：2026-07-11
状态：已采用
用户确认：产品设计阶段批准

选择：双长生命周期进程（Electron UI + 独立 Node Runtime）；高风险工具用短生命周期 Worker。

否决：单进程桌面应用；Tauri 首发；WinUI 3 首发。

### TD-002: 规划级技术栈锁定

日期：2026-07-11
状态：已采用（规划级）
用户确认：产品设计 + `/zno-init` 文档确认

选择：Electron / React+TS / Node Runtime / SQLite / XState 表达 + 事件检查点 / Playwright / MCP TS SDK / OpenAI+Anthropic 适配器。

### TD-003: 前端视觉标准 = V3 锁 IA，视觉可获奖级原创

日期：2026-07-11
状态：已采用
用户确认：文档确认时明确授权

选择：IA 锁 V3；视觉/组件/动效/记忆点由 Claude 主导；Continuum Bench；禁止换皮与组件库默认皮肤。

---

## 3. Phase 0 Spikes — 方案对比与结论（已确认采用）

> 用户于 2026-07-11 回复「全部接受推荐，计划确认」。下列选型均为 **已采用**。

### TD-004: SQLite 驱动与迁移框架

日期：2026-07-11
状态：已采用
用户确认：2026-07-11「全部接受推荐，计划确认」

技术需求：

```text
Electron 打包兼容；Runtime 进程高频读写；事件追加与检查点；FTS；迁移可回滚备份；TypeScript 友好。
```

约束：

```text
Windows 闭测；单人维护；模块化单体；密钥不进 DB 明文；迁移失败要只读诊断模式。
```

| 方案                                      | 优点                                                                 | 缺点                                                      | 性能               | 维护   |
| ----------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------- | ------------------ | ------ |
| A. better-sqlite3 + Drizzle + drizzle-kit | 同步 API 简单可靠；Electron 广泛使用；Drizzle 轻、SQL 贴近、迁移清晰 | native 模块需 electron rebuild；异步场景要自己包装 worker | 本地嵌入式最优之一 | 中低   |
| B. libsql / @libsql/client（本地文件）    | 与 turso 生态接近；有潜力                                            | 本地桌面收益有限；多一层抽象                              | 好，但非刚需       | 中     |
| C. node:sqlite（官方实验）/ sql.js        | 无/少 native 痛点                                                    | 成熟度/API/FTS/打包与性能边界不适合作为真源首选           | sql.js 偏弱        | 风险高 |

推荐方案：

```text
A. better-sqlite3 + Drizzle ORM + drizzle-kit
FTS5 用手写 SQL migration 管理；所有访问经 storage 包，禁止业务直接 new Database。
```

推荐理由：

1. 同步驱动适合 Runtime 事务与检查点语义。
2. Drizzle 比重型 ORM 更可控，迁移可审。
3. 行业对 Electron + better-sqlite3 路径最熟，踩坑资料多。

性能影响：主线程/ Runtime 内同步 SQL 需控制事务粒度；大导出走流式/分页。
维护成本：需配置 electron-builder / @electron/rebuild。
风险与回退：native 编译失败时短期可评估 libsql 本地文件；schema 层用 Drizzle 隔离可换驱动。

需要用户确认：是否接受 better-sqlite3 + Drizzle 作为存储栈？

---

### TD-005: Windows 安全凭证存储

日期：2026-07-11
状态：已采用
用户确认：2026-07-11「全部接受推荐，计划确认」

技术需求：

```text
API Key 等密钥 OS 级保护；DB 只存 CredentialRef；可备份/迁移策略明确；Renderer 永不持有明文。
```

约束：

```text
Windows 优先；后续 macOS Keychain / Linux libsecret 可换实现；禁止自建可逆“应用密码”糊弄。
```

| 方案                             | 优点                             | 缺点                                     | 风险 |
| -------------------------------- | -------------------------------- | ---------------------------------------- | ---- |
| A. Electron safeStorage（DPAPI） | 官方、少依赖、跟用户登录会话绑定 | 与机器/用户配置相关；重装/换机需导出策略 | 中低 |
| B. keytar（系统凭据管理器）      | 经典；跨平台抽象                 | 原生依赖维护波动；打包更烦               | 中   |
| C. 仅 SQLCipher/应用层加密文件   | 全自控                           | 主密钥存放问题转移到另一层；易做错       | 高   |

推荐方案：

```text
A. 在 Runtime（或受控 main 辅助模块）封装 secure-store：
  - 使用 Electron safeStorage 加密 secret payload
  - SQLite 只存 CredentialRef { id, provider, label, ciphertext meta, createdAt... }
  - 明文仅在调用 Provider 前短时内存存在，用后清零意图
  - 导出备份：默认不含密钥；可选“加密导出”需用户口令（Phase 3）
  - 迁移：版本化 envelope；失败则拒绝启动写入并进诊断
```

推荐理由：官方路径、依赖最少、符合 local-first 与“密钥不进 DB 明文”。
风险与回退：若 Runtime 完全独立进程难以直接用 Electron safeStorage，则通过 **仅 main 可访问的 secret broker IPC/pipe 方法** 取用，或 Phase 0 验证后改 keytar。
需要用户确认：是否接受 safeStorage + CredentialRef 模型？

---

### TD-006: 命名管道协议、事件流、认证、版本协商

日期：2026-07-11
状态：已采用
用户确认：2026-07-11「全部接受推荐，计划确认」

技术需求：

```text
UI 与 Runtime 可靠通信；流式事件；本机用户边界；安装身份校验；协议可演进。
```

| 方案                                               | 优点                        | 缺点                             |
| -------------------------------------------------- | --------------------------- | -------------------------------- |
| A. Windows named pipe + 长度前缀 JSON / JSONL 事件 | 符合设计文档；本机 ACL 可控 | 需自研帧与重连                   |
| B. localhost WebSocket/HTTP                        | 调试容易                    | 端口占用、误暴露、防火墙干扰     |
| C. 仅 Electron IPC（无独立 Runtime 管道）          | 简单                        | 破坏“Runtime 可独立/UI 可死”边界 |

推荐方案：

```text
A. 分层：
  1) Electron main ↔ Renderer：contextBridge + 严格 IPC（无 Node integration）
  2) main（或 thin connector）↔ Runtime：\\.\pipe\sync-think-<installId>
  3) 帧：请求/响应用 length-prefixed JSON；服务端推送用 JSONL event stream 或多路复用 id
  4) 握手：protocolVersion, appVersion, installId, process nonce, HMAC/token 文件仅用户可读
  5) 能力协商：features[]；不兼容则 UI 只读提示升级/重启 Runtime
  6) 背压：事件订阅按 cursor；大 payload 走 artifact 引用而非管道塞文件
```

推荐理由：对齐产品架构；避免 localhost 误暴露；版本协商可测。
风险：自研协议成本；Phase 0 必须做崩溃重连与半包测试。
需要用户确认：是否接受 named pipe + 双层桥（IPC + pipe）？

---

### TD-007: Windows UI Automation 驱动、进程边界与回退

日期：2026-07-11
细化日期：2026-07-31
状态：已采用
用户确认：2026-07-11 接受 UIA 主方向；2026-07-31 确认具体驱动与降级方案

技术需求：

```text
授权桌面自动化；结构化语义动作优先；可观察、可取消、可失败隔离；
原生崩溃或不可取消 COM 调用不得阻塞 Electron 或主 Runtime。
```

选择：

```text
独立短生命周期 Node DesktopWorker Host
+ Koffi 3.1.4
+ Windows UI Automation COM
+ versioned JSONL/stdio 单请求协议
```

约束：

1. UIA COM 只能运行在独立 Host，不进入 Renderer 或主 Runtime 线程。
2. Host 必须绑定父 PID，接受 capability root、durable beforeStart fence、AbortSignal、硬超时、进程树终止和输出限幅。
3. 动作使用 discovery 返回的 exact `DesktopWindowIdentity`；element index 绑定 `snapshotRevision` 与 `accessibilityRevision`，陈旧或歧义状态必须失败，不猜测操作。
4. P0 只实现 bounded inspect、selector resolution、read、SetFocus、InvokePattern 与 ValuePattern.SetValue；不包含 OCR、通用截图定位、任意坐标点击、拖拽、UAC/UIPI 绕过或安全桌面控制。
5. 用户人工输入、窗口/权限变化、Pattern 不支持、超时或 Host 崩溃时进入可审计人工接管；敏感动作继续经过 Runtime 审批和 durable command fence。
6. SetValue 等正文通过 stdin/协议传入 Host，不进入 argv；原生异常只返回固定、脱敏的稳定错误码。

触发式降级：

- 如果 BSTR/VARIANT/SAFEARRAY、COM apartment、事件缓存、内存/句柄审计或 Electron 打包稳定性无法在 P0 门槛内通过，停止扩大 Koffi ABI 包装并切换小型 .NET sidecar。
- Microsoft WinAppCLI 只作为开发期 fixture/oracle，不作为生产依赖；robotjs/nut.js 和坐标宏不作为主路径。

当前实施状态（2026-08-01）：

- P0.1-P0.4 已完成独立 Host、真实 UIA probe、窗口发现、bounded inspect、exact selector resolution，以及 read/focus/Invoke/SetValue 最小语义动作。
- P0.5 已完成内置可选 Computer Use 插件、Runtime Desktop capability adapter、七个聊天工具、设置页开关和 execution-mode 审批语义。插件默认关闭；关闭时不暴露 schema、不注入 prompt、不实例化 Worker、不启动 Host。
- P0.6 已完成 durable Desktop command/intent 和用户输入中断 fence：副作用前持久化，completed 可重放，未知 in-flight 重启后进入 `waiting_user` 而不自动重放；用户键鼠输入使动作中止并返回 `desktop.user-input-detected`。
- Runtime/Workers 允许窄范围只读调用 User32 `GetLastInputInfo`，仅用于检测人工输入时间戳。它不模拟输入、不持有 UIA COM 对象，也不改变 UIA COM 只能位于独立 Desktop Host 的边界；监控不可用必须 fail-closed。
- P0.7 已完成持久 `waiting_user` 的安全只读投影；P0.8 已完成 Continue/Cancel resolution、`expectedUpdatedAt` 乐观并发栅栏、Desktop IPC/Renderer 交互和 durable lifecycle 重查。
- Continue 的定义是确认人工处理并把 command 终结为 completed，不重新执行 Worker 或重放原 UIA 动作；Cancel 将 command 终结为 failed。Renderer 无论请求成功或冲突都必须重新读取 durable list。
- capability 与权限是正交维度：插件开关决定是否具备桌面能力，`execution_mode` 决定启用后是否审批；`full-access` 不隐式启用插件。
- 高风险动作分类与真实 WPF fixture + Runtime/Desktop 冷重启人工接管 E2E 仍属于后续切片；在它们完成前不能把 DesktopWorker P0 记作完整。
- 详细实测与逆向证据见 `docs/superpowers/specs/2026-07-31-windows-uia-worker-spike.md`。

---

### TD-008: SKILL.md 兼容子集

日期：2026-07-11
状态：已采用
用户确认：2026-07-11「全部接受推荐，计划确认」

技术需求：

```text
兼容现有 SKILL.md 目录结构；导入规范化 Manifest；脚本不静默执行。
```

推荐兼容子集（v1）：

```text
必须：
  - 目录内 SKILL.md（YAML frontmatter + Markdown body）
  - frontmatter: name, description, version?(semver/string)
  - 可选：license, metadata, compatibility, allowed-tools 类字段（能识别则映射，不能则报告）
  - 资源文件：references/, scripts/, assets/ 原样收录但默认不可执行

导入行为：
  1. 计算内容 hash / 完整性
  2. 生成 SkillVersion Manifest（内部模型）
  3. 声明的 tools/MCP/permissions 进入待批准 diff
  4. scripts 仅当声明 execution + 用户批准 + 依赖检查后才可被 Worker 调用
  5. 无法识别字段：warnings[]，不猜测执行

conformance fixtures：
  - minimal-skill
  - skill-with-scripts-denied-by-default
  - skill-permission-diff-on-upgrade
  - broken-frontmatter
  - path-traversal-attempt
```

备选：只支持内部 JSON Manifest — 否决，失去生态兼容。
需要用户确认：是否接受上述 SKILL.md v1 子集与“脚本默认不执行”？

---

### TD-009: CC Switch 配置导入

日期：2026-07-11
状态：已采用
用户确认：2026-07-11「全部接受推荐，计划确认」

技术需求：

```text
用户明确批准的导入；预览后保存；不依赖 CC Switch 常驻；不猜模糊字段；密钥进入 secure store。
```

推荐策略：

```text
1. 只读取“稳定/文档化/可观察”的本地配置面（版本化 adapter）：
   - 常见路径与导出文件格式在 Phase 0 用夹具锁定
   - 每个 CC Switch 版本一个 importer adapter；未知版本 → 安全失败 + 手动 Provider 引导
2. 映射到内部模型：Provider / CredentialGroup / Model / protocol hints
3. UI 三步：选择来源 → 预览 diff（可取消单项）→ 确认写入
4. 密钥：预览可显示掩码；确认后写入 safeStorage；日志无密钥
5. 不支持字段进 report，不默认填充危险值
6. 导入后不要求 CC Switch 继续运行
```

备选：运行时反向依赖 CC Switch — 否决。
需要用户确认：是否接受“版本化 importer + 预览确认 + 安全失败”？

---

### TD-010: Provider 兼容夹具矩阵

日期：2026-07-11
状态：已采用
用户确认：2026-07-11「全部接受推荐，计划确认」

推荐矩阵（合同测试，不用真实密钥也可跑 mock）：

| 协议面                  | 必测场景                                                    |
| ----------------------- | ----------------------------------------------------------- |
| OpenAI Responses        | 流式文本、工具调用、错误码、超时                            |
| OpenAI Chat Completions | 流式 SSE、多轮 messages、stop、rate limit                   |
| OpenAI Images           | 创建、参数回显、失败                                        |
| Anthropic Messages      | 流式、tools、system、max_tokens 边界                        |
| Gateway quirks          | 非标准 base path、额外 header、模型列表缺失、伪 OpenAI 字段 |

架构：

```text
packages/adapters/*
  - 统一内部事件：text-delta, tool-call, tool-result, usage, error, image-ready
  - Fixture replay + 可选 live probe（用户显式开启）
  - 能力探测结果仅建议，用户确认后入库
```

需要用户确认：是否接受“先夹具合同测试，再 live probe”的适配策略？

---

### TD-011: XState 持久边界与 DAG 调度恢复

日期：2026-07-11
状态：已采用
用户确认：2026-07-11「全部接受推荐，计划确认」

| 方案                                           | 优点                     | 缺点                        |
| ---------------------------------------------- | ------------------------ | --------------------------- |
| A. XState v5 表状态 + SQLite 事件/检查点为真源 | 可视化状态清晰；恢复可测 | 需自研 persist 层           |
| B. 纯手写状态机                                | 无依赖                   | 复杂 DAG/重试易腐           |
| C. 外部工作流引擎                              | 能力强                   | 过重、偏离 local 模块化单体 |

推荐方案：

```text
A.
  - Run/Step 生命周期用 XState 描述（内存执行）
  - 真源是 append-only Event + Checkpoint 表
  - 重启：replay 到最近 checkpoint + 续放事件；外部副作用靠 idempotency key
  - DAG：Step 依赖边存 DB；调度器选 ready steps；并行用隔离 artifact snapshot
  - XState 快照可缓存，但不是唯一真源
```

需要用户确认：是否接受“XState 表达 + 事件真源”而不是把 XState 快照当唯一 DB？

---

### TD-012: React 原语、图标、token 架构

日期：2026-07-11
状态：已采用
用户确认：2026-07-11「全部接受推荐，计划确认」
服从：TD-003 可获奖级原创

| 方案                                                                         | 优点         | 缺点                 |
| ---------------------------------------------------------------------------- | ------------ | -------------------- |
| A. 自研设计系统 + Radix 无样式原语 + Lucide + CSS variables from tokens.json | 完全品牌可控 | 组件工作量大         |
| B. MUI / Ant Design 全套                                                     | 快           | 同质化，难达可获奖级 |
| C. shadcn 直接默认风格                                                       | 较快         | 仍像模板，需大量重写 |

推荐方案：

```text
A. Continuum UI Kit
  - tokens: docs/product/15-frontend-design-tokens.json → 生成 CSS variables
  - 行为原语：Radix（Dialog/Popover/Tabs/Focus）可选引入
  - 外观：100% 自研（Button/Message/Trace/ContinuumRail/...）
  - 图标：Lucide（可替换子集）
  - 禁止：Ant/MUI 默认主题；大圆角营销卡
  - 状态：TanStack Query 仅当需要服务端/Runtime 查询缓存；聊天流用自研 store
  - 路由：主工作台状态以任务为中心；设置类可用轻量路由
```

需要用户确认：是否接受“Radix 行为 + 自研皮肤 + Lucide”，拒绝厚主题组件库？

---

### TD-013: 签名、更新器、崩溃报告、内测分发

日期：2026-07-11
状态：已采用
用户确认：2026-07-11「全部接受推荐，计划确认」

| 方案                                                                 | 优点           | 缺点               |
| -------------------------------------------------------------------- | -------------- | ------------------ |
| A. electron-builder NSIS + 代码签名 + electron-updater 私有静态 feed | 成熟、闭测够用 | 签名证书成本/流程  |
| B. Squirrel.Windows                                                  | 旧路径         | 生态转向 builder   |
| C. 仅手动 zip                                                        | 零基建         | 升级体验差、难签名 |

推荐方案：

```text
A. Phase 3：
  - electron-builder 打 NSIS
  - Authenticode 签名（证书由你准备）
  - electron-updater + 私有 HTTPS feed / GitHub private releases
  - 崩溃报告：本地优先 + 可选上传；默认剥离路径/密钥/消息正文
  - 诊断包：用户显式导出，强制 secret scrub
  - 内测：邀请链接/安装包直发，5-20 人
```

需要用户确认：是否接受 electron-builder + 私有更新源？证书与账号后续再配置。

---

### TD-014: 测试框架（附带 spike，支撑 TDD）

日期：2026-07-11
状态：已采用
用户确认：2026-07-11「全部接受推荐，计划确认」

推荐：

```text
Vitest：unit/contract/integration
测试目录与 packages 共置
Phase 3 再引入端到端（Playwright 测 UI 或 Spectron 替代方案评估）
关键强制：状态机、权限、上下文编译、适配器夹具、路径/注入安全
```

---

### TD-015: NewMax P0 工作区、文件编辑与流式持久边界

日期：2026-07-28
状态：已采用
用户确认：2026-07-28「可以，开始吧」

背景：现有双聊天分屏、ChatView 内只读文件预览和逐 frame Renderer 更新无法组成可恢复工作台；同时不能牺牲 Sync-Think 已有的路径约束、transient replay 和 SQLite Message Store 边界。

采用方案：

```text
Workspace UI：
  - 版本化递归二叉 Pane 树（horizontal / vertical），Pane 内统一 conversation/file tabs
  - localStorage 按 Workspace 保存布局快照，并从旧 openTabs/selected 偏好迁移
  - ratio clamp 20%–80%；每 Pane 最多 100 Tabs；任意深度最多挂载 2 个 ChatView

Streaming：
  - transient text/reasoning frame 在 Renderer 以 requestAnimationFrame 合批
  - delta 不写 durable event；成功只写最终 assistant message
  - failed/cancelled 在终态前写入已生成的部分 assistant 正文

File editing：
  - Main 进程重新验证 root 内路径与 realpath；拒绝绝对路径、穿越和链接越界
  - read 返回 mtimeMs + size；write 使用 expected metadata、显式 force 与同目录原子替换
  - 父目录 fs.watch + 100ms 合并 + 5 秒轮询兜底；订阅随 Renderer 生命周期释放
  - P0 使用 textarea；草稿只保留 Renderer 内存 Session，布局快照仅保存相对路径
```

理由与影响：

- 递归 Pane 满足工作区扩展性，但 `ChatView` 挂载上限保留当前 transient subscription 的性能约束；文件 Pane 不占聊天订阅配额。
- localStorage 是当前最小变更，因为 Workspace 协议与存储层尚未暴露完整 UI preferences；快照版本化和旧键双写保留回滚路径。
- mtime 与 size 是轻量乐观并发，不依赖新增编辑器或文件数据库；冲突必须由用户显式选择，避免静默覆盖。
- 未保存正文不进入 durable SQLite 或布局偏好，避免恢复出一份脱离磁盘真值的隐藏副本；代价是应用进程退出后草稿不恢复，此边界需要持续在 UI 与文档中保持明确。
- 后续若引入 Monaco/CodeMirror、持久草稿或递归 Workspace watcher，必须重新走依赖、性能与数据真源技术门禁。

---

### TD-016: Workspace 内容搜索与受控终端 Pane

日期：2026-07-28
状态：已采用
用户确认：2026-07-28「按照你说的来」

技术需求：项目磁盘正文搜索；Pane 内 ANSI 终端输出、停止和恢复；复用既有路径边界与 `TerminalProcessWorker`；重型前端能力不进入首屏主包。

内容搜索方案：

| 方案                             | 优点                                     | 缺点                                       | 结论          |
| -------------------------------- | ---------------------------------------- | ------------------------------------------ | ------------- |
| `rg --json` + 有界 Node fallback | 大仓库快；结果结构化；未安装 `rg` 仍可用 | 需要维护双引擎一致性                       | 采用          |
| 纯 Node 递归扫描                 | 零外部命令                               | 大仓库 CPU/IO 更高                         | 仅作 fallback |
| 把工作区正文镜像到 SQLite FTS    | 查询快、可排序                           | 复制磁盘真值；watch/index/migration 成本高 | 本切片不采用  |

终端方案：

| 方案                             | 优点                                                             | 缺点                                             | 结论           |
| -------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------ | -------------- |
| `@xterm/xterm` + 既有受控 Worker | ANSI/滚动/键盘体验成熟；复用 `shell:false`、超时、取消和输出上限 | 不是持久 PTY；需独立 vendor bundle               | 采用           |
| React `<pre>` 日志面板           | 依赖最小                                                         | ANSI、选择、终端滚动和可访问性体验弱             | 不采用         |
| `node-pty` + `@xterm/xterm`      | 完整 PowerShell/cmd 交互                                         | 新增原生模块、打包/签名/进程恢复与权限面显著扩大 | 后续独立 spike |

采用边界：

```text
Search:
  - rg literal smart-case 主路径；5 秒、200 条、2 MiB/文件上限
  - shell:false；查询使用独立 argv；symlink/vendor/binary 跳过
  - fallback 不持久化索引或正文

Terminal:
  - xterm vendor 单独构建，用户打开终端时才加载 JS
  - Main 负责 session/command 唯一性、Renderer 销毁清理和 IPC 事件
  - TerminalProcessWorker 流式产生 stdout/stderr，命令仍为 executable + argv
  - 布局只持久化 terminalId/cwd；输出和运行状态只在 Renderer Session
```

性能：搜索结果和终端输出均限幅；终端 JS 不进入首屏 shell bundle。
安全：不通过 shell 拼接查询或命令；cwd 与真实路径必须位于 Workspace root；每次人工命令只给 Worker 精确 executable allowlist。
维护与回滚：移除 terminal tab 类型、vendor 构建与新 IPC 即可回退；文件/对话 Pane 快照保持兼容。
后续门禁：引入 `node-pty`、持久 shell、终端恢复或工作区 FTS 索引时重新走技术选择。

---

### TD-017: Agent Skill 默认继承、临时覆盖与懒上下文装载

日期：2026-07-29
状态：已采用
用户确认：2026-07-29「继续后续任务开发」；后续确认「小队里面智能体自动化工作不应再逐个配置」

技术需求：Agent Library 是 Skill 的一次性配置真源。Agent/Team 对话默认启用有效所有者已装备的 Skill，Composer 只承担临时取消/调整；自动化 Run 中每个 Step 自动读取自身精确 AgentVersion 的 Skill。正文仍按需加载，fallback、rebind 和恢复不得因后续编辑而漂移。

方案对比：

| 方案                                                                                    | 优点                                                     | 缺点                                                                    | 结论         |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------- | ------------ |
| Agent 配置默认生成精确选择；Composer 临时覆盖；Runtime 校验并冻结；目录 metadata 懒加载 | 配置一次即可复用；仍可见、可取消；恢复可复现；不新增依赖 | 需要区分“持久配置默认值”和“当前会话临时覆盖”                            | 采用         |
| 每轮默认空选，由用户重新勾选                                                            | 单轮上下文最小                                           | 重复配置，Team 自动执行语义断裂，容易出现界面选了但自动 Step 没带 Skill | 废弃         |
| 自动推荐 + 项目/任务临时附件                                                            | 能覆盖更多场景                                           | 推荐可信度、作用域、权限和持久化边界显著扩大                            | 后续独立设计 |

采用合同：

```text
AppendMessagePayload.skillVersionIds:
  undefined -> 旧客户端继承有效 Agent allowlist
  []        -> 本轮明确不加载 Skill
  [ids]     -> trim、按首次出现去重、最多 8 个精确不可变版本

Runtime:
  effective Agent owner -> allowlist 子集/存在/未归档/审批校验
  -> 按精确 ID 加载正文 -> Context selection
  -> Provider prompt + Manifest + frozen Run snapshot
  -> fallback/rebind/retry/recovery 继续使用冻结 ID

Durable state:
  event/checkpoint 保存 ID + fingerprint，不复制 SKILL.md 正文
  restart 从不可变 Skill store 重新加载并校验 fingerprint

Desktop default:
  Agent -> 自身已配置 SkillVersion IDs
  Team  -> coordinator；缺失时首成员的 SkillVersion IDs
  model -> []
  send success/failure -> 保持当前选择
  switch Agent/Team -> 新 owner 默认值

Automated Step:
  frozen step.agentVersionId -> 该 AgentVersion.skillVersionIds
  -> Provider 调用前校验与有界正文解析
  -> 只注入该成员自己的 system prompt
  -> Artifact metadata 记录实际 skillVersionIds
```

性能：`skill.list` 使用 metadata-only SQL；Composer 只有打开菜单才请求目录；Renderer 从不为选择菜单调用 `skill.get`。完整正文只为本轮最终选择加载，未选中或被 Context 排除的 Skill 不进入 Provider。

安全与一致性：Renderer 只能缩小 allowlist，Runtime 是最终权限边界；选择不执行脚本、不增加工具或 MCP 权限。Context Packet 的 `skill-definition`、Provider prompt、Manifest ID 与 Run 快照必须来自同一次选择结果，不允许第二条旁路注入。

交互与回滚：Agent/Team 初始选择来自有效 owner 配置，成功与失败都保持；切换 Agent/Team 时使用新 owner 默认值，模型直聊显式发送 `[]`。仅切换模型 override 不改变 Agent Skill。欢迎页首条消息把临时覆盖交给新建对话。回滚可恢复默认空选，但旧 `undefined` 兼容路径继续可用。

自动化边界：Team Composer 的 coordinator 规则只决定用户当前与谁对话时的默认显示；DAG Step 始终以自身已冻结的 `agentVersionId` 为权威。Skill 正文不会执行脚本，也不会增加 Worker、Tool 或 MCP 授权；任一配置版本缺失、归档或审批失效时在 Provider 调用前失败。

---

### TD-018: 外部系统浏览器 + 持久 Profile + Playwright CDP Browser Worker

日期：2026-07-30
状态：已采用
用户确认：2026-07-30「可以」；此前已明确选择方案 B

技术需求：把现有 Renderer `<webview>` 从自动化执行链路中移除，改由长驻 Runtime 管理可见的系统 Edge/Chrome。浏览器登录态需要按 Profile 持久保存；不同对话/Step 使用独立 Tab；同一 Tab 的动作不能互相穿插；遇到登录、验证码、支付或其他人工卡点时，Run 必须能够持久暂停并由用户继续。

方案对比：

| 方案                                                              | 优点                                                                                       | 缺点                                                                     | 结论                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | -------------------------------- |
| Renderer `<webview>` 执行 JavaScript                              | 已有原型，接线短                                                                           | 依赖 UI 存活和一个全局活动页；登录态、Tab 所有权、恢复与最小权限边界薄弱 | 从真实执行路径移除，只保留预览壳 |
| 系统 Edge/Chrome + 独立 Profile + `playwright-core` 通过 CDP 接管 | 浏览器真实可见；复用用户熟悉的系统浏览器；不下载浏览器内核；Profile、Tab、人工接管边界清楚 | 需管理外部进程、CDP 端口和浏览器版本兼容                                 | 采用                             |
| Playwright 自带 Chromium + `launchPersistentContext`              | Playwright 版本匹配最稳定                                                                  | 安装体积明显增加；与“使用系统浏览器”目标不符                             | 不采用                           |

采用合同：

```text
Agent / Team Step
  -> Runtime（先持久化意图、校验站点与动作权限）
  -> shared BrowserHost
  -> BrowserWorker restricted API
  -> playwright-core / CDP
  -> visible Edge or Chrome + dedicated Profile directory

Process:
  one active browser process per profileId
  profile root defaults to dirname(sync-think.db)/browser-profiles
  executable discovery prefers explicit override, then Edge, then Chrome
  CDP binds to 127.0.0.1 on a dynamically reserved port

Tabs:
  lease owner = conversation/run/step identity
  one owner lease maps to one Page
  commands on one lease are serialized
  different leases may execute concurrently
  release/close and browser shutdown are explicit lifecycle operations

Actions:
  navigate / click / fill / read / wait / screenshot
  selectors and returned text are bounded
  screenshots live under <project>/.sync-think/screenshots
  Renderer <webview> may mirror the final URL but never executes the command
```

分片边界：P0.1 只交付 Browser Host、系统浏览器发现/启动、CDP、Profile、Tab lease 和受限动作；P0.2 把聊天 `browser_*` 真正接到 Worker；P0.3 增加命令/授权持久化与重启恢复；P0.4 接 Team Step；P0.5 增加持久 `waiting_user` 与继续/取消交互。只有 P0.1-P0.5 全部完成后，路线图中的“Browser Worker 与网页授权执行”才可勾选完成。

性能：一个 Profile 复用一个浏览器进程；同 Tab 串行避免状态竞争，不同 Tab 保留并行度；使用 `playwright-core`，不下载或打包 Playwright 浏览器二进制。读取正文和截图结果必须限幅。

安全与恢复：CDP 仅监听 loopback；Profile ID 和截图路径不能越过受控根目录；站点允许列表以 URL origin 为边界并在 Runtime 再校验；新域、敏感动作与人类专属动作不能由网页内容自行授权。Runtime/Worker 重启后的幂等、授权恢复与人工卡点由 P0.3/P0.5 完成前，不声称闭环已交付。

维护与回滚：移除 Browser Host 和 `playwright-core` 即可回到现有 `<webview>` 原型；Profile 目录是独立数据，不与默认浏览器 Profile 混用。旧 `conversation.submitBrowserResult` 协议在 P0.2 迁移期间保留兼容，确认没有调用方后再单独删除。

---

### TD-019: OpenAI-compatible Images durable 产物边界

日期：2026-08-01

状态：已采用

用户确认：按 Phase 3 推荐路线继续开发

背景：Images API 返回的是二进制产物，不适合复用文本 Conversation event，也不应把大体积 base64、短期远程 URL、完整 prompt 或 Provider 原始响应写入 durable SQLite。

选择：

1. Provider Adapter 使用独立 typed `generateImages()`。`openai-images` 由专用 Adapter 调用 `POST /images/generations`；文本 `call()` 与既有 `image-ready` event 保持不变。
2. P0.1 强制请求并只接受 `b64_json` durable output；仅 URL 响应 fail-closed。Adapter 负责数量、prompt、单图大小、MIME 魔数、超时和 Provider 错误分类。
3. Provider base64 只存在于当前调用作用域。Runtime-owned `GeneratedImageStore` 在受控根目录内按 SHA-256 scope/content hash 落盘，使用临时文件 + rename，路径与文件名不使用 prompt、Run/Step 标题。
4. Durable execution output 使用严格二选一：inline `content`，或本地 `contentRef + contentHash`。引用产物必须是允许的本地/内部 URL 且携带小写 SHA-256。
5. 图片执行顺序固定为 reserve → Provider → Runtime 落盘 → complete；completed reservation replay 时不得再次读取凭证、调用 Provider 或重复存储。unknown in-flight 继续阻止自动重放外部副作用。
6. Scheduler 将每张图物化为 `ArtifactVersion(candidate)`；SQLite 只保存引用、hash、MIME、字节数和必要生成元数据，不保存 API Key、base64、完整 prompt、远程 URL、revised prompt 或原始响应。

分片边界：P0.1 只完成 Provider、落盘、durable replay 与 candidate Artifact；P0.2 负责 Renderer 安全图片预览和过程视图；P0.3 再增加结构化生成参数、视觉 Reviewer、多候选比较及有界返工。Phase 3 在三个切片全部完成前保持进行中。

性能与恢复：每次最多 4 张、单图最多 25 MiB，并设置总量上限；相同内容复用 hash 文件。恢复依赖 SQLite reservation 与 Runtime-owned 文件，Renderer 不直接读取任意文件路径。

风险与回滚：若 Provider 不支持 base64，则当前切片返回 protocol failure，不降级持久化外部 URL。回滚可移除 `generateImages()` 注册和 image store 注入，不影响文本 Provider 路径及既有 inline Artifact。

---

### TD-020: Durable per-Run fallback attempt fence

日期：2026-08-01

状态：已采用

背景：Provider priority fallback 与 Agent fallback 原先分别判断候选。Provider 链耗尽后，Agent fallback 可能重新选择本 Run 已失败的模型，形成跨层循环，持续调用 Provider 并写入 event/checkpoint；仅在进程内记忆无法覆盖重启恢复。

选择：

1. `DemoRunState` 持久化有序去重的 `attemptedModelIds`，Run 创建时加入初始模型，每次模型 rebind 前加入目标模型。
2. checkpoint 序列化/恢复必须保留尝试顺序；旧 checkpoint 缺少字段时，以当前 `modelId` 初始化，保证向后兼容且不立即重试当前模型。
3. Provider priority 与 Agent fallback 使用同一个 attempted set。候选解析必须跳过全部已尝试模型，不按 fallback 层分别清空。
4. 所有可用候选均已尝试时，Run 进入 durable `paused / fallback_exhausted`，不继续生成 fallback transition。continuation 持久化入口仍需检查重复目标，作为纵深保险。
5. 保留原绑定边界：失败模型既不是 Agent default、也不在 Agent fallback chain 时，不擅自切入 Agent fallback；没有 fallback 配置时仍使用 `no_fallback_configured`。

验证与恢复：回归必须覆盖 Provider 链后由 Agent fallback 指回初始模型、进程内每个模型最多调用一次、最终有界暂停、无第三个 fallback transition、序列化顺序保留和旧 checkpoint 恢复。

数据边界：历史 runaway Run 数据不在运行时修复中自动删除。数据库清理必须走独立备份、精确事务删除、`VACUUM INTO`、引用核验和人工切换流程。

---

### TD-021: Main-scoped opaque Artifact image preview grants

日期：2026-08-01

状态：已采用

背景：图片 Artifact 的 durable 真源是 Runtime-owned 本地文件。把 `contentRef` 或任意 `file://` 能力暴露给 Renderer 会扩大本地文件读取面；只在注册时校验也不能发现文件替换、symlink/junction 变化或 grant 长期滞留。

选择：

1. Renderer 只提交 `workspaceId/taskId/runId/artifactVersionId`。Main 从 Runtime 获取完整 ArtifactVersion 后执行授权，不接受 Renderer 提供的路径、MIME 或 hash。
2. 允许根目录固定为当前 managed Runtime 数据库同级的 `artifacts/generated-images`。Main 与 managed Runtime 必须共享同一数据库路径解析逻辑。
3. preview registry 只接受绝对路径，并在 realpath 后校验目录边界、允许扩展名、MIME、PNG/JPEG/WebP 魔数、25 MiB 上限和小写 SHA-256。symlink/junction 越界 fail-closed。
4. 成功授权返回随机不透明 `sync-think-image://artifact/<token>`；token 不编码路径或 Artifact ID，默认 TTL 5 分钟、容量 256，超限淘汰最旧。Renderer 响应不包含 `contentRef`。
5. protocol 每次读取都重新执行完整文件校验，发现过期、替换、越界或 hash 不一致即返回 404；成功响应使用 `private, no-store` 与 `nosniff`。
6. Renderer 只为带受控引用且 MIME 为 PNG/JPEG/WebP 的版本请求 grant，并使用 Task/Run generation gate 丢弃陈旧响应。冷重启不恢复 token，而是从 durable ArtifactVersion 重新授权。

边界：本决策只覆盖本地生成图片的安全预览，不赋予 Renderer 通用文件读取能力，也不改变 browser screenshot 与 chat media 的既有独立 host 语义。

验证：registry 单测覆盖路径、MIME/魔数/hash、容量、TTL、文件替换和 symlink 越界；另有严格 payload、Main/Preload/Renderer wiring、Run 图投影及 UI loading/error/opaque URL 测试。

---

### TD-022: Approved Step 冻结严格图片生成配置

日期：2026-08-01

状态：已采用

背景：P0.1 的图片执行固定为单候选默认参数。P0.3 需要让用户配置尺寸、质量和候选数量，同时避免 Renderer 临时值、宽松 JSON、Provider 默认差异或重启恢复改变已经批准的执行语义。

选择：

1. Shared 使用封闭 `ImageGenerationConfig`：size 仅允许 `auto / 1024x1024 / 1024x1536 / 1536x1024`，quality 仅允许 `auto / low / medium / high`，count 仅允许整数 `1-4`。
2. execution Step 可选携带该配置；merge Step 必须拒绝。Plan diff、深拷贝、Desktop IPC 和 Core 校验都保留严格三字段语义，不接收缺字段或额外字段。
3. migration `0033_image_generation_config` 以 nullable JSON 保存 approved Step 配置，并结合严格 decoder 与 SQLite CHECK 约束枚举和整数范围。Reviewer Step 写 `NULL`，Rework Step 复制目标 Step 的冻结配置。
4. approved Step 是 Runtime 的唯一执行真源。legacy `NULL` 和未配置 Step 使用 `auto / auto / 1`；Adapter 在网络请求前再次执行相同守卫。
5. count 对应一次有界 Provider 请求中的候选数。每张返回图片分别落盘并创建独立 `ArtifactVersion(candidate)`，metadata 记录冻结参数、请求/实际数量和索引。
6. reservation 完成后 replay 只恢复已持久化输出，不重复读取凭证、调用 Provider 或写文件；SQLite 继续不保存 API key、base64、完整 prompt 或 Provider 原始响应。

分片边界：本决策只完成参数编辑、冻结、持久化和执行。P0.3 第二切片负责多候选比较与选择；视觉 Reviewer 和有界返工继续作为后续切片。

验证：Shared/Core/Adapter guard、migration/decoder/CHECK、approved/rework 持久化、Desktop IPC、Plan 编辑器、多图片落盘/ArtifactVersion/replay 均有自动化覆盖。

---

### TD-023: 冻结图片 Reviewer 选择、Runtime-only 视觉载荷与有界返工

日期：2026-08-01

状态：已采用

背景：同一图片 Artifact 可以包含多个候选版本。视觉 Reviewer 必须只评审当前轮明确选择且在调度时冻结的版本；如果直接读取可变 ArtifactSelection、把本地 contentRef 发送给 Provider，或让图片返工走普通文本输出规则，会造成重启后评审对象漂移、本地路径泄漏和无界返工。

选择：

1. 原始 `review_step_artifact` assignment 继续保存该 Reviewer 可评审的完整候选集合并保持不可变。migration `0035_review_image_selection_freeze` 新增独立 `review_step_artifact_selection` 投影，按 gate/run/reviewer/artifact 冻结本轮唯一选择；insert 必须落在原 assignment 范围内，update/delete 由 SQLite trigger 永久拒绝。
2. Scheduler 在 claim Reviewer 前调用 selection gate。单一图片版本可直接冻结；同 Artifact 存在多个图片候选且尚未选择时，Run 进入可恢复 `paused`、Reviewer 保持 `ready`，记录 `review.image-selection-required` 与 `run.paused`，且不创建 Provider reservation。用户选择后再次调度才写入冻结投影。
3. Production Executor 只从冻结投影构造 Reviewer context。视觉 Provider 调用前由 Runtime-owned GeneratedImageStore 执行绝对路径、realpath 根边界、普通文件、1..25 MiB、PNG/JPEG/WebP MIME/扩展名/魔数和 SHA-256 校验，并在读取后再次确认路径；symlink/junction 越界、替换或 hash 漂移均 fail-closed。
4. 图片字节只在 Runtime 内存中转换为 data URL，并以 `[{type:'text'}, {type:'image'}]` 多模态 user message 发送。`contentRef`、generated-image root 与本机路径不进入 Provider prompt、ReviewEvidence 或 Renderer；Reviewer Agent 缺少 vision capability 时在 Provider reservation 前以 acceptance failure 结束。
5. Reviewer 输出继续使用严格结构化 ReviewOutcome。reject 时只消费持久化的结构化 decision，不依赖 reviewer transcript；图片 rework 继承目标 Step 的冻结 `imageGeneration`，新版本归回原 Artifact，`parentVersionIds` 指向当前轮所选版本。
6. 同一图片 rework 可以生成多个严格 generated-image candidate；普通文本多输出、文本/图片混合输出或跨多个已选图片 Artifact 的返工均 fail-closed。新候选再次经过同一 selection gate，形成“选择 → 视觉评审 → 返工候选 → 再选择”的有界循环。
7. `maxIterations` 与 `onLimitReached='pause'` 继续复用既有 Gate 语义。达到上限后写入 `limit-reached` 并暂停 Run，不再派生下一 rework；Provider 调用次数因此可由候选生成轮数与 Reviewer 轮数确定性约束。

验证：migration object/trigger、freeze 不可变、选择暂停与恢复、Runtime 图片读取安全、vision payload、无 vision/文件替换零 Provider 调用、多候选只发送所选版本，以及 reject → rework → reselection → 达限暂停均有自动化覆盖。

---

## 4. 确认清单（已全部勾选）

- [x] TD-004 better-sqlite3 + Drizzle
- [x] TD-005 safeStorage + CredentialRef
- [x] TD-006 named pipe + IPC 双层桥
- [x] TD-007 DesktopWorker 接口先；koffi+UIA 后
- [x] TD-008 SKILL.md v1 子集，脚本默认不执行
- [x] TD-009 CC Switch 版本化 importer + 预览
- [x] TD-010 Provider 夹具矩阵
- [x] TD-011 XState 表达 + 事件真源
- [x] TD-012 Radix 行为 + 自研皮肤 + Lucide
- [x] TD-013 electron-builder + 私有更新
- [x] TD-014 Vitest
- [x] TD-015 递归 Pane + transient 合批 + 受约束文件编辑
- [x] TD-016 `rg` + fallback 内容搜索、lazy xterm + 受控 Worker 终端
- [x] TD-017 Agent 默认继承 + 每轮精确覆盖 + 自动 Step 成员隔离 + metadata 懒加载
- [x] TD-018 系统 Edge/Chrome + 持久 Profile + Playwright CDP Browser Worker
- [x] TD-019 OpenAI-compatible Images typed Adapter + Runtime-owned durable Artifact
- [x] TD-020 Durable per-Run fallback attempt fence
- [x] TD-021 Main-scoped opaque Artifact image preview grants
- [x] TD-022 Approved Step 冻结严格图片生成配置
- [x] TD-023 冻结图片 Reviewer 选择 + Runtime-only vision + 有界图片返工

确认语：全部接受推荐，计划确认（2026-07-11）

---

## 5. 决策记录模板

### TD-XXX: 决策标题

日期：
状态：提议中/推荐中/已采用/已废弃
用户确认：

背景 / 选择 / 备选 / 影响 / 性能 / 风险与回退

### TD-007 实施更新：DesktopWorker P0.2（2026-07-31）

P0.2 继续采用已确认的短生命周期 Node Host + `koffi@3.1.4` 方案，没有触发 .NET sidecar 降级条件：

1. Win32 负责顶层窗口发现与 HWND/PID/title identity fence；UIA COM 只负责从 exact HWND 获取并遍历 Control View。
2. UIA 树必须在深度、节点数和文本字节三层限制内读取；达到任一限制即返回 `truncated=true`，不扩展为无界 inspect。
3. 后续元素动作不得仅依赖进程内 COM 指针；跨 Host 使用 `window identity + snapshotRevision + accessibilityRevision + elementIndex`，revision 必须可以确定性复算。
4. HWND/PID/可选 title 在 inspect 前后不一致时返回 `desktop.window-stale`，不得猜测相似窗口或退化为坐标点击。
5. P0.2 只完成发现和读取树；selector resolution、read/focus/Invoke/SetValue 与 Runtime durable handoff 仍按后续切片实施。

### TD-007 实施更新：DesktopWorker P0.3 selector fence（2026-07-31）

P0.3 在既有短生命周期 Node Host 与确定性 revision 基础上采用以下约束：

1. selector 只允许 `automationId (+ optional controlType)` 或 `name + controlType` 两种精确形态；存在 AutomationId 时不得悄悄回退到 Name。
2. Host 不缓存跨进程 COM 元素指针。每次 resolution 必须对 exact window 以调用方提供的同一 tree limits 重新 inspect，并复算双 revision。
3. `snapshotRevision` 或 `accessibilityRevision` 任一不一致即返回 `desktop.snapshot-stale`；零匹配和多匹配分别返回 `desktop.selector-not-found` 与 `desktop.selector-ambiguous`，不执行启发式猜测。
4. 成功结果同时返回 `DesktopElementTarget` 与匹配元素快照；后续动作只接受这个带 exact window、双 revision 和 elementIndex 的短生命周期 target。
5. 本切片不实现元素动作；read/focus/Invoke/SetValue 继续单独通过 Pattern、stale fence 和真实应用 smoke 验收。

### TD-007 实施更新：DesktopWorker P0.4 semantic action fence（2026-07-31）

P0.4 延续已确认的短生命周期 Node Host + Koffi UIA COM 方案，没有触发 .NET sidecar 降级条件：

1. `read-element`、`focus-element`、`invoke-element`、`set-value` 每次都以调用方提供的 tree limits 对 exact window 重新 bounded inspect，并在任何副作用前校验 `snapshotRevision`、`accessibilityRevision` 与 `elementIndex`。
2. backend 在同一 COM apartment 中完成 inspect 并只保留 exact target element 的短生命周期 lease；Driver 完成 revision fence 后才能调用动作，`finally` 必须释放 Element、Pattern、Walker、Automation、BSTR 和 COM apartment。
3. 读取优先使用 Value Pattern；缺少 Value Pattern 时只允许返回 fenced 元素的 Name/Text，不引入 OCR、坐标或非确定性文本推断。
4. Focus 只调用 `SetFocus`，Invoke 只调用 Invoke Pattern，SetValue 只调用可写 Value Pattern；disabled、offscreen、Pattern 不支持和只读值均以稳定错误码失败，不执行隐式降级。
5. Host 动作结果仍是一次性 `action-completed` 或 `element-read`；inspect/resolve target 不作为 durable command 或 observation。Runtime 层必须在后续切片中负责持久化、审批、重试和人工接管。
6. managed Node `20.20.2` compiled Host 已通过 WPF fixture 的 read/focus/SetValue/Invoke/read 真实 smoke，因此继续保留原生 Host 路线，不启用 .NET/native sidecar。

### TD-007 实施更新：DesktopWorker P0.5 内置 Computer Use 插件（2026-07-31）

P0.5 将 P0.1-P0.4 的核心 UIA 引擎包装为内置、默认关闭的可选能力，而不是在插件层复制第二套桌面自动化实现：

```text
Computer Use built-in plugin
→ Runtime Desktop Capability Adapter
→ IsolatedDesktopWorker
→ short-lived Desktop Host
→ Windows UI Automation COM
```

决策与约束：

1. 插件状态复用 `app_setting` 的 `plugin.computer-use`，只有显式 `{ enabled: true }` 才启用；当前不新增插件数据库表，也不引入运行时下载插件。
2. 禁用时 Runtime 不向 Provider 提供任何 `desktop_*` schema，不注入 Computer Use prompt，并在 Worker 实例化前失败，因此不会启动 Desktop Host。
3. 启用时只暴露七个受限 UIA 工具：窗口枚举、bounded inspect、exact selector resolution、元素读取、SetFocus、InvokePattern 与 ValuePattern.SetValue；继续禁止 OCR、剪贴板、SendInput、模糊 selector 和坐标回退。
4. 插件开关与 `execution_mode` 正交：前者决定能力是否存在；后者决定能力启用后的审批。`ask` 只审批 focus/invoke/set-value，读取类动作自动执行；`workspace` 与 `full-access` 下普通 Desktop 动作自动执行。`full-access` 不自动开启插件。
5. Runtime 必须在 schema 生成、allowlist 和实际 dispatch 时读取最新 capability。模型生成调用后若设置已关闭，返回稳定 `desktop.capability-disabled`，且 capability gate 必须先于审批与 Worker 构造。
6. Desktop 能力不以项目目录为前提；无 workspace 的普通对话也可在插件启用后使用桌面工具。
7. Renderer 只通过 browser-safe `@sync-think/protocol/plugins` 子路径读取插件常量；不得改回 Protocol 根 barrel，避免把 `node:os`、`node:crypto` 等 Node-only 依赖带入浏览器构建。
8. 本切片不是 durable Desktop command / 人工接管闭环。下一阶段需补持久 command/intent、用户输入中断 fence、`waiting_user`、Continue/Cancel、敏感动作分级和真实端到端恢复。

### TD-007 实施更新：DesktopWorker P0.6 durable command / input fence（2026-07-31）

1. Desktop mutating action 必须在 Worker 副作用前 reserve durable command；相同幂等键的异参请求失败，completed 结果可重放，failed 不自动重试。
2. Runtime 重启发现未知 running command 时进入 `waiting_user`，不推测原动作是否完成，也不自动重放。
3. focus/invoke/set-value 通过只读 `GetLastInputInfo` tick 监控人工输入；变化时 abort Worker/Host 并持久化 `desktop.user-input-detected`。监控不可用 fail-closed。
4. `set-value` 正文不进入 durable storage/event/argv；只保存长度与 digest，正文仅在执行内存和 Host stdin 中短暂存在。

### TD-007 实施更新：DesktopWorker P0.7 waiting_user projection（2026-08-01）

1. `waiting_user` 列表由 SQLite/Runtime 安全摘要提供，支持 workspace/run 过滤和 task 映射；Renderer 不从 lifecycle event 直接构造卡片。
2. Main/Preload 只提供受控 list-waiting IPC；ChatView 在 reconnect、Runtime event 或查询失败重试时重新读取 durable state，并使用 generation fence 防止旧响应覆盖新状态。
3. 投影禁止包含 value、digest、native handle、target identity、owner 与 revision/index；卡片明确未知副作用没有被自动重放。

### TD-007 实施更新：DesktopWorker P0.8 waiting_user resolution（2026-08-01）

1. 新增 `desktop.command.continue` / `desktop.command.cancel`，并纳入 Protocol Feature negotiation。请求只接受 `commandId + expectedUpdatedAt`，时间必须为毫秒精度 UTC ISO，禁止多余字段。
2. Continue 只代表用户确认已经人工处理：`waiting_user → completed`，持久结果记录 `resolution: user-confirmed` 与 source timestamp；不得重新调用 Worker、恢复 Provider 工具循环或重放原 UIA 动作。
3. Cancel 代表用户终结等待：`waiting_user → failed`，稳定错误为 `desktop.command-cancelled`，分类为 `acceptance`。
4. `expectedUpdatedAt` 是乐观并发栅栏；记录已变化时返回 `desktop.command-conflict`。正确的重复请求可以返回 replayed，Storage 必须让新时间戳单调递增。
5. Runtime 只有在持久 resolution 成功后发布 `desktop.command.continued/cancelled`；事件继续使用脱敏 task binding/safe summary。Renderer 将 waiting/continued/cancelled 都视为重新查询信号。
6. Renderer 提交时同时锁定两种按钮，并在成功或失败后重新查询 durable list。SQLite/Runtime projection 始终是 UI 真源。
7. 该决策只解决等待 command 的终结。下一切片先实现动作风险分级/审批策略，再完成真实 WPF fixture 的用户输入中断、Runtime/Desktop 冷重启和 Continue/Cancel E2E。

### TD-007 实施更新：DesktopWorker P0.9 action-risk approval（2026-08-01）

1. Desktop 动作风险固定为 `observe`、`display`、`sensitive`、`human-only`、`prohibited`；分类证据不足时 fail-closed，不以 execution mode 推断动作本身风险。
2. 最终审批策略固定为：observe 全模式自动；display 仅 ask 审批；sensitive 与 human-only 全模式审批；prohibited 全模式阻止。`full-access` 只跳过可信 display 审批，不绕过 sensitive/human-only，也不自动启用 Computer Use 插件。
3. 已解析普通元素的 display 判定依赖当前 Runtime 进程内的 `DesktopElementTarget → DesktopElementSnapshot` 短生命周期缓存，容量上限 512。缓存不进入 SQLite，冷重启后必须重新 inspect/resolve；未解析 mutating target 按 sensitive 处理。
4. UIA `CurrentIsPassword` 必须进入元素快照与 accessibility revision。密码 read/set-value 固定为 `human-only / access-or-create-secret`；删除、支付、发布、外发、权限变更和越界导出等语义必须升级为 human-only。
5. Controller 是最终强制边界：在 durable reserve 和 Worker 调用前重新判定风险、模式与 approval credential。缺少审批时不得 reserve command 或执行 Worker；prohibited 不进入审批队，直接返回阻止结果。
6. `tool.approval_requested` 和 `desktop.command.started` 只允许安全投影，禁止 value、valueDigest、nativeWindowHandle、snapshot/accessibility revision、elementIndex、targetIdentity 与 ownerId。
7. 本决策不持久化 selector trust，也不完成真实应用重启验收。下一切片必须用真实 WPF fixture 验证用户输入中断、Runtime/Desktop 冷重启、waiting card 恢复及 Continue/Cancel 全路径。

### TD-007 实施更新：DesktopWorker P0.10 cold-restart handoff E2E（2026-08-01）

1. DesktopWorker P0 的正式验收必须使用仓库内真实 WPF fixture 和真实 UIA Pattern，不以 mock driver 或仅进程内 Controller 测试替代。固定入口为 `pnpm selftest:desktop-handoff`。
2. 测试 fixture 的 mutating handler 可被确定性阻塞；测试端通过 User32 键盘事件改变 `GetLastInputInfo`，验证 Runtime 的只读用户输入 fence，而不把输入模拟能力加入产品 Computer Use 工具面。
3. `waiting_user` 的恢复真源固定为 SQLite。第一轮 Desktop/Runtime 关闭后，第二轮必须从 durable command 重建卡片；旧 Renderer event、旧 Provider 请求和旧进程内 selector cache 均不得作为恢复依赖。
4. Continue/Cancel 是对已发生未知副作用的人工终结，不是动作重试。正式 E2E 必须断言 fixture mutation 只执行一次，且 Provider tool loop 不因冷重启或 resolution 重放。
5. Selector trust 不持久化。Runtime 冷重启后，旧 target 必须重新按元数据不足处理并要求审批；审批前不得 reserve 新 command。
6. E2E 的数据库和 UI 断言必须同时覆盖安全投影，避免 value、native handle、双 revision、element index、target identity 或 owner 泄漏到 lifecycle event 与等待卡片。
7. Continue/Cancel 两条真实冷重启路径均通过后，DesktopWorker P0.1-P0.10 视为完成；后续扩展不得弱化插件默认关闭、exact selector、revision fence、风险审批和未知副作用不重放边界。

### TD-022 实施更新：图片多候选复用 ArtifactVersion 与 ArtifactSelection（2026-08-01）

- 一次图片生成 Step 对应一个 Artifact；同批多张候选保存为该 Artifact 的不可变 ArtifactVersion。
- `artifactGroupKey` 仅在 Step completion / Runtime replay 物化期间派生，用于把同批输出归组，不写入 Artifact 或 ArtifactVersion 持久字段。
- 用户当前候选继续复用 durable `artifact_selection`、operation ID 幂等和 task version 乐观并发，不新增第二套用户选择状态。
- Renderer 只接收有限的 imageGeneration 摘要与 `sync-think-image://artifact/<token>` 预览 URL，不暴露 `contentRef` 或完整 metadata。
- 图片候选使用并列画廊与互斥选择；文本 Artifact 保留 compare、merge 和 diff 交互。

### TD-017 实施更新：AgentContextThread / ContextEpoch / Provider Usage（2026-08-01）

- 每个 Task 内按 `taskId + agentVersionId + workstreamKey` 建立稳定 AgentContextThread。普通执行使用 `step:<stepId>`，Reviewer 使用 `review:<targetStepId>:<reviewerAgentVersionId>`；retry 复用，Agent/角色之间保持隔离。
- 同一 Thread 在 Provider、模型、reasoning 或 context-window 边界变化时创建 ContextEpoch；epoch 通过 `parentEpochId` 保留 lineage，fallback 不把不同模型的缓存身份混用。
- Provider prompt cache key 固定绑定 `providerId:modelId:agentContextThreadId:contextEpochId`，retention 可请求 24h；应用只保存 key、Thread/Epoch 和 usage，缓存正文仍由 Provider 管理。
- 每个 Provider request 持久化 request-level usage，并投影 input/output、cache hit/cache write、reasoning、total token，以及 task/run/step/thread/epoch/provider/model/purpose 维度。
- Reviewer reject 只把结构化 ReviewDecision 注入 rework prompt，不复制完整 Reviewer transcript；产物血缘继续由 ArtifactVersion parent lineage 表达。

### TD-024 实施更新：Windows installer 使用 normal 压缩与 manifest v2 体积证据（2026-08-02）

1. 正式 NSIS installer 固定使用 electron-builder `compression=normal`。同一 portable 输入下，`maximum` 与 `normal` 只差 1 byte，没有足以支撑更激进配置的可重复体积收益。
2. `store` 只保留为受控对比参数，不再作为正式发布默认值；正式 artifact 从约 521 MB 降至约 107 MB。
3. installer manifest 升级为 schema v2，必须记录 compression、portable source bytes、builder duration、artifact bytes、reduction bytes/percent 和 SHA-256；verifier 对指标重新计算，拒绝陈旧或篡改 manifest。
4. `differentialPackage` 继续关闭，必须与 electron-updater 私有 feed、下载校验、版本兼容和失败回滚一起实现，避免提前产生没有消费链路的差分 artifact。

### TD-025 实施更新：Windows 品牌资产真源与现代 production deploy（2026-08-02）

1. `apps/desktop/build/icon.svg` 是 Windows 品牌资产的可编辑真源；`icon.png` 与九档尺寸 `icon.ico` 必须由 `scripts/windows-brand-assets.mjs` 确定性派生，并通过 hash、尺寸和 ICO directory 测试。
2. Desktop `BrowserWindow` 使用 PNG；Windows executable、NSIS installer、uninstaller 与快捷方式使用同一 ICO，避免不同发布表面出现不一致品牌资源。
3. portable staging 在 executable 重命名后通过 `resedit` 写入完整 icon group。仅把 ICO 复制到 `resources/app/build` 不视为 executable 品牌接线完成。
4. production deploy 固定使用 pnpm 现代 injected workspace deploy：`node-linker=hoisted`、`inject-workspace-packages=true`、workspace root cwd 与经过 release child fence 的绝对目标。
5. 禁止回退到 legacy deploy；该模式在 Windows 会按 filtered package cwd 额外派生 `apps/.../node_modules/.bin` sidecar，污染 workspace 并使后续 staging/smoke 触发 `EPERM`。
6. executable 和 installer 的品牌资源写入必须发生在 Authenticode 签名前；当前 artifact 仍为 unsigned，后续签名流程需对最终已写入图标的二进制执行签名和校验。

### TD-026 实施更新：Windows 私有 updater 控制面与安全投影（2026-08-02）

1. Windows updater 默认关闭。只有 Main 成功解析显式 `SYNC_THINK_UPDATE_FEED_URL` 后才创建 driver；开发构建还必须设置 `SYNC_THINK_UPDATE_ALLOW_DEV=1`，避免本地启动意外访问更新网络。
2. 正式 feed 只接受 HTTPS；HTTP 仅允许 `localhost`、`127.0.0.1` 或 `::1`。feed URL 禁止 username/password、query 与 fragment；channel 使用有限字符集，token 拒绝空白、CR/LF 与超长值。
3. feed URL、token、`Authorization`、下载文件路径和 Provider 原始错误只存在于 Desktop Main。Renderer 仅获得 schema-versioned `DesktopUpdateSnapshot` 与稳定错误码，所有 updater invoke channel 继续经过 trusted renderer source assertion。
4. 更新流程固定为用户手动检查、手动下载、手动重启安装：`autoDownload=false`、`autoInstallOnAppQuit=false`、`allowDowngrade=false`、`disableWebInstaller=true`。并发动作和非法 phase 由 controller fence 拒绝。
5. 当前固定 `disableDifferentialDownload=true` 并使用完整 installer。differential package 必须等待真实私有 feed、metadata/installer 校验、版本兼容和失败恢复 E2E 通过后单独启用。
6. 安装动作必须先调用统一 `shutdownDesktopServices()`，中止搜索和终端、释放文件 watch、断开 Runtime client 并等待 managed Runtime 停止；清理失败时不调用 `quitAndInstall()`。
7. portable `resources/app-update.yml` 只保存 `updaterCacheDirName: sync-think-updater`，满足 electron-updater cache bootstrap；provider、URL、channel、token 和 header 不进入该文件、builder publish 配置或 release manifest。
8. 本切片完成控制面、状态投影、配置约束和安装前退出边界，但不代表 P0.3 更新链路整体完成。Authenticode、真实私有 feed E2E、下载/签名校验验收、版本兼容矩阵、差分包、自动失败回滚及闭测发布清单仍为后续发布门禁。

### TD-027 实施更新：Windows Generic feed E2E 与安全错误分类（2026-08-02）

1. Generic feed fixture 使用与 electron-updater 兼容的 channel `.yml`，固定包含严格 SemVer、单一 Windows `.exe`、size、SHA-512、legacy path/hash 与 ISO release date；fixture verifier 必须重新计算 artifact size/hash 并拒绝越界文件名。
2. updater 集成验收必须启动真实 Electron 子进程并加载产品 `createElectronUpdaterDriver`，不得只以 mock controller 或独立 metadata parser 代替；HTTP 只绑定 `127.0.0.1`，每个场景使用隔离 userData、LOCALAPPDATA 和 updater cache。
3. 基础版本矩阵固定覆盖当前版本相等、更高、更低、非法 SemVer 和 channel 文件不匹配；`allowDowngrade=false` 下低版必须保持 not-available。
4. 完整 installer 下载继续保持 `disableDifferentialDownload=true`；E2E 同时验证 progress/downloaded、缓存文件 SHA-512，以及错误 SHA-512 被 electron-updater 拒绝且不产生 downloaded 状态。
5. Provider 原始错误仍只存在于 Main。仅把已知错误 code 投影为 `desktop.update.channel-unavailable`、`desktop.update.metadata-invalid` 与 `desktop.update.checksum-mismatch`；未知错误继续使用阶段级稳定 fallback。
6. 本地 loopback E2E 是真实 driver 和下载完整性门禁，不等同于发布完成。真实私有 HTTPS feed、真实受控 NSIS 的退出/重启安装、Authenticode、differential package 与自动失败回滚仍需独立验收。

### TD-028 实施更新：Updater HTTPS fixture、证书边界与真实 NSIS 下载（2026-08-02）

1. updater 集成门禁从 loopback HTTP 升级为 loopback HTTPS；测试证书必须在运行时短期生成，server 只绑定 `127.0.0.1`，测试结束后临时目录自动清理。
2. electron-updater 使用独立 `electron-updater` session，因此证书验证 hook 只安装到该 partition；放行条件固定为 feed host 精确等于 `127.0.0.1` 且证书 PEM 数据精确匹配。其他 hostname/certificate 组合返回拒绝，禁止设置 `NODE_TLS_REJECT_UNAUTHORIZED=0` 或修改产品 TLS 策略。
3. E2E 除 2 MiB 确定性 fixture 外，必须下载真实 NSIS artifact，验证 HTTPS、Bearer、metadata、progress、downloaded、缓存字节数和 SHA-512。metadata 可使用更高测试版本驱动下载，但不得把 fixture feed/token/certificate 放入产品配置或 Renderer。
4. `设置 → 关于` 的 updater UI 采用单一发布通道控制台：同时呈现版本差异、通道与完整性事实、三阶段流程和当前动作；只有当前合法动作使用主按钮，disabled/error 状态保持可解释且不泄露 provider 细节。
5. 本决策只关闭真实 installer 的 HTTPS 下载与缓存验收；`quitAndInstall()`、真实安装后重启版本/身份/数据库连续性必须在独立安装根中实施，并继续受 Desktop shutdown fence 保护。

### TD-029 实施更新：真实 `quitAndInstall()` 与 differential update E2E（2026-08-02）

1. E2E 必须启动真实 packaged Desktop、electron-updater driver 与 NSIS installer，完成隔离目录中的 `0.0.1 → 0.0.2` 安装和 Runtime 重启，不以 mock `quitAndInstall()` 代替。
2. base/target portable 和 installer 都由受控发布脚本生成；target 只修改 packaged version 与对应 release manifest 文件投影，并再次通过 portable verifier。
3. Desktop shutdown fence 必须等待 managed Runtime、handoff 与持久状态收口；feed URL/token/header 仅注入 Main，不持久化到 Renderer 或发布元数据。
4. E2E 固化一次 install request，并验证 base ready、update available/downloaded、install requested、upgrade ready、package/registry version、Install ID、safeStorage handle、identity metadata/ciphertext 与 SQLite 连续性。
5. differential 证据必须包含 blockmap 请求、installer Range header、HTTP 206、无完整 installer 200 回退、served bytes 大于 0 且小于完整 target installer；结果写入隔离 `.data/update-install-e2e-<timestamp>/smoke-result.json`。
6. unsigned fixture 证据只关闭本地安装与差分链路；正式 Authenticode、真实 RFC 3161 provider、private origin/CDN 与邀请用户闭测继续作为外部证据。

### TD-033：Windows signer/publisher trust pin 与 blockmap 内容校验（2026-08-02）

1. `SYNC_THINK_WINDOWS_CERTIFICATE_SHA1` 只作为构建时证书选择器；`SYNC_THINK_WINDOWS_EXPECTED_SIGNER_SHA1` 与完整 `SYNC_THINK_WINDOWS_PUBLISHER_NAME` 是构建后和离线验证的独立 trust pin。
2. Authenticode signer subject 必须与完整 publisher DN 精确相等，thumbprint 必须与独立 pin 精确相等；installer 与 manifest 即使被一致替换，也不得绕过外部 trust pin。
3. 正式 portable 的 `app-update.yml` 仅允许 updater cache identity + 完整 publisherName；unsigned fixture 仅允许 cache identity。verifier 使用字节级期望内容并拒绝额外 provider、URL、Authorization 或 token 字段。
4. Generic feed 默认要求配对 blockmap，并在 hash/size 之外执行 gzip 解压、JSON 解析与最小 schema fail-closed 校验。旧完整下载只可通过显式 `allowLegacyFullDownload` fixture 模式启用。

## TD-014 实施更新：Runtime Event payload 外置写入边界（2026-08-02）

1. Runtime 外置写入必须显式 opt-in，默认数据库继续保存完整内联 payload。
2. 第一阶段 allowlist 只有 `context.packet.built`，阈值固定默认 64 KiB，并按序列化 UTF-8 字节数判断。
3. Runtime 不维护私有 projection；统一复用 Storage 的 `context-packet-query-v1@1` builder，避免在线写入与离线 backfill 产生双重语义。
4. 默认 sidecar root 使用 database path 与 install ID 的 SHA-256 派生身份，防止不同数据库或安装身份误共享 blob namespace。
5. 外置 envelope 仍由 SQLite Event row 提供 source-of-truth identity；读取必须完整校验并 hydrate，缺失或损坏时 fail-closed。
6. Runtime startup 只打开写入/hydrate 能力，不运行 backfill、rollback、orphan sweep、retention、archive 或 VACUUM；所有治理执行器保持显式离线命令。

### TD-034?Windows ?? binary rollback?installer ??????????? watchdog?2026-08-02?

1. ?? NSIS ??????installer ???????? `%LOCALAPPDATA%/SYNC-THINK/update-recovery/installers/<version>/`?Desktop ???????????? managed Runtime `hello` ??????????????? healthy release?
2. healthy release ??????????? installer ???????SHA-512??????signer thumbprint ?????????????????? recovery root?hash/bytes ??? Authenticode signer/timestamp ???unsigned fixture ????????????
3. `quitAndInstall()` ????? rollback intent?????? watchdog?intent ?? previous/target version???? intent token?prior installer ???health marker?deadline ? attempt fence??????token?hash?bytes ??????? fail-closed?????? installer?
4. ??????????? intent target ?????managed Runtime `hello` ?????? marker?watchdog ????? intent token + target version ? marker?????? intent ?????? previous installer????????? `automaticRollbackAttempted=true`?
5. watchdog ?? Main ????? PowerShell helper ??????? executable ??? argv?`shell:false`?????? Renderer ???feed token ?????????? installer ???? NSIS ?????????????????safeStorage ? SQLite ????
6. ????? prior installer ????????????????? `unavailable` ??????????????healthy installer ?????????? intent ? attempt fence ?????????????
7. E2E ?????? packaged `0.0.1 ? 0.0.2` ?????target ??????? marker?watchdog ?? `0.0.1`???? registry/app version?Runtime hello?install identity?secret?SQLite ??????????????
