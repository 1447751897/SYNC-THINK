## 当前状态：2026-08-03 · Phase 3 与自动 binary rollback 本地收口

### 已完成

- **自动 binary rollback**：Desktop 已完成 rollback recovery store、coordinator、watchdog、updater 与启动接线；recovery root 统一为 `%LOCALAPPDATA%\sync-think-updater\recovery`，NSIS 会把当前版本 installer 自归档到 `installers\<version>\installer.exe`。
- **Rollback 验证**：Desktop 127 files / 849 tests、Desktop typecheck/build、PowerShell 5.1 watchdog healthy/attempt-fence 真实 smoke，以及 `unsigned-fixture` NSIS installer 真实编译均通过。正式签名 installer 的真实 rollback E2E 仍等待外部发布证据。
- **Windows 发布与更新**：portable/installer 定向测试共 22 项通过；Generic feed 9 项单元测试及真实 Electron HTTPS 8 场景通过。正式 release 对 Authenticode signer、完整 publisher DN、独立 signer SHA-1 pin 与 RFC 3161 timestamp 保持 fail-closed；unsigned fixture 必须显式启用。
- **差分真实安装**：正式入口 `pnpm test:update-install:win` 已通过隔离 unsigned fixture 的 `0.0.1 → 0.0.2` `quitAndInstall`。证据位于 `.data/update-install-e2e-20260802T174113/smoke-result.json`：2 次 blockmap 请求、7 次 Range 请求、7 次 HTTP 206；完整 installer `135491101` bytes，实际传输 `504941` bytes，节省 `134986160` bytes，未出现完整 HTTP 200 回退；Runtime、install identity、secret handle、metadata、ciphertext 与 SQLite 连续性均通过。
- **Database Governance P0.4**：sidecar/backfill/recovery/rollback/GC、Event retention/archive、incremental vacuum 与 offline `VACUUM INTO` compaction 已完成；定向门禁 5 files / 51 tests。治理执行器未接 Runtime startup，所有写入验收仅使用临时 fixture。
- **Phase 3 聚合门禁**：`pnpm selftest:phase3` 通过 Desktop contracts 12 files / 86 tests、release/visual contracts 29 tests、Desktop typecheck/build、Generic feed Electron E2E、image provider build、无凭证时显式 skipped 的 live image acceptance，以及 Electron `capturePage()` 7-case 视觉矩阵。结构化结果为 `passed-with-external-evidence-pending`，视觉证据位于 `.data/phase3-visual/current`。
- **根仓最终门禁**：`pnpm test` 20/20 Turbo tasks、`pnpm typecheck` 20/20、`pnpm build` 11/11、`pnpm lint` 11/11 与 `git diff --check` 全部通过。Desktop 最新全量计数为 127 files / 849 tests；本轮全仓日志位于 `.data/prepush-gates-20260803-083215`。
- **测试接线修复**：Diagnostics export wiring 断言改为格式无关正则，避免 Prettier 换行导致假失败；Generic feed E2E 为所有场景生成并显式传入最小有效 gzip blockmap，与生产 fail-closed 语义一致。

### 当前人工测试实例

- **隔离目录**：`D:\projects\SYNC-THINK\.data\manual-phase3-20260802-015614`
- **进程**：launcher PID `102824`；Electron PID `9296`；managed Runtime PID `50712`（Node `20.20.2`）。
- **运行状态**：`SYNC-THINK` 窗口可见、`Responding=True`；日志已出现 `pipe ready`、`database ready`、`hello accepted`，stderr 为空。
- **隔离数据**：数据库 `D:\projects\SYNC-THINK\.data\manual-phase3-20260802-015614\sync-think.db`；配置的 secure key 路径为 `D:\projects\SYNC-THINK\.data\manual-phase3-20260802-015614\secure.key`。当前使用 Windows DPAPI，且该空白测试身份尚未写入 Provider secret，因此不会生成 legacy `secure.key` 文件。
- **日志**：`desktop.stdout.log` 与 `desktop.stderr.log` 均位于上述隔离目录。
- **真实数据边界**：默认数据库 `D:\projects\SYNC-THINK\.data\SYNC-THINK\sync-think.db` 在启动前后均为 `16873340928` bytes，UTC 修改时间保持 `2026-08-02T13:22:54.0208111Z`，未被触碰。

### 尚待外部条件或独立后续范围

1. 正式 Authenticode 发布证书与真实 RFC 3161 timestamp provider。
2. 使用正式签名 installer 完成一次真实 `0.0.1 → 0.0.2` 安装升级与自动 rollback E2E。
3. 在真实 private origin/CDN 完成授权、cohort/rollout、cache invalidation 与撤回演练。
4. 使用真实图片 Provider 凭证完成生成、预览、Reviewer、返工与重启恢复人工验收。
5. 组织 5–20 位邀请用户 Windows 闭测并收集反馈。
6. 自动 binary rollback 的本地实现、NSIS unsigned fixture 编译与 watchdog smoke 已完成；正式签名 installer 的真实 rollback E2E 仍属于外部证据。

### 工作树

- 分支：`feature/newmax-shell-rewrite`。
- 累计修改仍在同一工作树中，未执行 reset、clean、覆盖式 checkout 或全仓格式化。
- 累计改动纳入当前分支提交治理；具体提交与推送状态以 Git 记录为准。

## Image P0.3 checkpoint（2026-08-01）

- 第二切片已实现：同批图片候选归组、多版本摘要投影、并列画廊、durable 选择链路复用。
- 定向测试：Runtime production executor、Storage artifact/orchestration、UI ArtifactVersionsPanel、Desktop preview wiring 均通过。
- 下一步：完成全量门禁与独立数据库桌面手测；随后进入 Image P0.3 下一切片（候选生成入口与真实 Provider 端到端验收增强）。

## Agent Thread / Context Epoch / Provider Cache 与 Token Usage（2026-08-01）

- Scheduler 为每个任务中的执行 workstream 建立稳定 AgentContextThread；同一 Step retry 复用线程，Reviewer 按 target Step + reviewer AgentVersion 隔离，rework 复用目标执行线程，不把其他 Agent transcript 混入。
- Production Executor 根据 provider/model/context window 在 AgentContextThread 下获取或创建 ContextEpoch；模型边界变化形成可追踪 epoch，Provider prompt cache key 绑定 provider/model/thread/epoch。
- OpenAI/Anthropic Adapter 统一投影 tokensIn、tokensOut、cache hit、cache write、reasoning 与 total tokens；Runtime 以 request/thread/epoch/purpose 持久汇总，缓存正文仍只存在 Provider 侧。
- Review reject 只把结构化 ReviewDecision 传给 rework prompt，不依赖完整 Reviewer transcript；Artifact parent lineage 与 Agent Thread 分别表达产物血缘和执行上下文。
- 已补齐 storage migration/store、adapter usage/cache、scheduler thread 复用和 production executor usage lineage 测试。

---

## 本轮进度（2026-08-02 · 16.87GB 默认数据库启动 OOM 收尾）

- **当时分支状态**：`feature/newmax-shell-rewrite`，保留全部前序未提交改动；该记录对应 2026-08-02 的历史检查点。
- **根因链已闭环**：默认开发数据库 `.data/SYNC-THINK/sync-think.db` 为 16,873,283,584 bytes，约 1,986,934 条 Event。此前启动依次暴露三个大库阻塞点：
  1. 启动迁移在无实际 schema 变化时仍复制整库备份；
  2. Task version 修复路径全量扫描 Event；
  3. 未完成对话恢复与手动压缩通过 `resolveLatestCompactBoundary()` 调用 `listAllEvents(0)`，把全局 Event 与 `payload_json` 物化进 V8 堆并触发 OOM。
- **本轮实现**：
  - `SqliteEventCheckpointStore.listEventsByTask(taskId)` 显式通过 `event_task_idx` 按 `sequence, id` 读取单个 Task 的 durable Event。
  - `RuntimeStateStore` 暴露可选 Task-scoped 查询能力；生产 SQLite store 走索引路径，legacy/test store 保留全局回退。
  - 上下文状态恢复和 `conversation.compact` 均优先读取当前 Task，不再物化约 198 万条全局 Event。
  - Storage 测试覆盖跨 Task 隔离、全局 telemetry 排除、空结果及 `EXPLAIN QUERY PLAN` 使用 `event_task_idx`；Runtime 集成测试把 `listAllEvents` 替换为抛错并验证状态读取与压缩仍成功。
- **真实默认数据库启动验证**：
  - 日志目录：`.data/manual-task-indexed-context-20260802-160502`。
  - 2026-08-02 16:05:02 启动，日志于 16:05:07 前写出 `pipe ready`、`database ready`、`hello accepted`，启动链路在约 5 秒内完成。
  - SYNC-THINK 主窗口已加载任务列表、已有对话入口与聊天工作台；Electron 主进程 `Responding=True`。
  - Runtime PID 41120 在 35 秒稳定采样中工作集 131.5MB → 131.9MB、Private 143.2MB → 143.4MB，没有持续堆增长。
  - 日志未出现 `ETIMEDOUT`、pipe timeout、heap limit、OOM、exit code 134。
  - migration 备份数启动前后均为 76，未再次复制 16.87GB 数据库。
- **自动验证（本轮修复后的最近结果）**：Runtime 62 files / 423 tests；Storage 相关 4 files / 91 tests；Desktop Runtime 管理 2 files / 8 tests；Storage/Runtime/Desktop typecheck；`pnpm build` 11/11；`git diff --check` 均通过。
- **待用户人工测试**：打开已有任务和历史消息、恢复之前未完成的 Computer Use 对话、新建普通对话发送消息、在长对话触发上下文压缩，并持续观察 Runtime 没有卡死或内存陡增。
- **当时下一步建议**：人工路径通过后，继续当前路线图中 Desktop/Browser durable waiting、审批与恢复链路的剩余 UI/集成收口。

## 本轮进度：2026-08-02 · Runtime Event payload allowlist 外置写入完成

- **默认行为**：Runtime sidecar 默认关闭；未显式启用时 Event payload 继续内联，现有数据库行为不变。
- **白名单与阈值**：仅 `context.packet.built` 可外置，默认阈值为序列化后 UTF-8 64 KiB；查询投影固定复用 Storage builder `context-packet-query-v1@1`。
- **身份隔离**：默认 sidecar root 同时绑定解析后的 database path 与 install ID；可通过受控配置显式覆盖根目录。
- **恢复与故障语义**：重启后自动 hydrate；missing/corrupt blob 在 Runtime 打开阶段 fail-closed；历史内联记录和无关 orphan blob 不迁移、不删除。
- **启动边界**：Runtime startup 不运行 backfill、rollback、GC、quarantine、retention 或 VACUUM。
- **验证结果**：Persistence 2 files / 10 tests、Runtime 全量 63 files / 436 tests、Runtime typecheck/lint 通过；根级 typecheck/build 与隔离 Desktop 重启紧随本记录执行。
- **下一任务**：实现 fixture-only 的 exact retention/archive manifest、portable archive/recovery set、durable executor、cancel/resume 与 rollback。
