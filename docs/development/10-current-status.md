## 当前状态：2026-08-04 19:47 +08:00 · Prompt Cache 与使用统计 UI 本地收口

### 当前结论

- GPT-5.6+ 请求已统一发送稳定 `prompt_cache_key` 与 `prompt_cache_options: { mode: "implicit", ttl: "30m" }`；旧模型继续使用稳定 key，只对官方兼容型号发送 `prompt_cache_retention: "24h"`。
- 当前中转不接受内容级 `prompt_cache_breakpoint`，闭测采用兼容的 implicit 策略；Force-final 保留 system 与 tools，只设置 `tool_choice: "none"`，避免最后一轮破坏可复用前缀。
- 不把“缓存创建持续升高”作为优化目标。GPT-5.6+ 的缓存写入会单独计费；健康指标是稳定前缀后续产生高缓存读取。中转上报 `cache_write_tokens=0`，但后续读取命中证明缓存已经建立。
- 使用统计 UI 已改为模型与供应商合并列、普通输入/缓存读取/缓存创建/输出四类互斥 Token、常显缓存命中率和逐行费用展开；原有白色详情复选框已移除。
- 当前本地源码实例为 Electron PID `40980`、managed Runtime PID `23228`，CDP `127.0.0.1:9333`、pipe/database/hello 均正常；日志位于 `.data/local-restart-20260804-194224/`，没有应用错误。
- 本轮未生成 installer、portable 或 release artifact；提交与推送状态以 Git 记录为准。

### 缓存与实窗证据

- 同一 `gpt-5.6-luna` 会话在 tools 前缀稳定后，事件 sequence `35830` 为输入 `3102`、缓存读取 `2560`、缓存创建 `0`，命中率 `82.5%`；sequence `35836` 为输入 `3141`、缓存读取 `2560`、缓存创建 `0`，命中率 `81.5%`。
- sequence `35824` 的 tools 配置发生变化，因此该轮读取为 `0`；随后两轮在相同工具定义下恢复高命中，符合 exact-prefix 缓存规则。
- 最新构建在真实数据库上加载 22 条近 7 天请求；1024x720 下 body `scrollWidth=clientWidth=1024`，统计区无越界元素，表格使用内部纵向滚动，费用展开行 `scrollWidth=clientWidth=740`。
- 最终截图：`.data/cache-ui-live-1024x720.png`、`.data/cache-ui-live-expanded.png`；此前的浅色复核为 `.data/cache-ui-light.png`。

### 最终验证

- `pnpm test`：20/20 Turbo tasks；Desktop 128 files / 854 tests，Runtime 65 files / 442 tests。
- `pnpm typecheck`：20/20；`pnpm lint`：11/11；`pnpm build`：11/11。
- `pnpm lint:tokens`、Prettier 检查与 `git diff --check` 均通过。

## 当前状态：2026-08-04 18:20 +08:00 · Token 计价与两处用量 UI 已收口

### 当前结论

- `tokensIn` 统一定义为包含缓存读取和缓存创建的 Provider 总输入；普通输入、缓存读取、缓存创建、输出是四个互斥计价桶，总费用不会重复计算缓存 Token。
- 使用统计请求表和聊天“本轮回复”悬浮卡均已拆分展示上述 Token；请求详情同时展示四项费用。
- Anthropic Adapter 已修正总输入归一化，OpenAI 既有用量契约保持不变。
- 当前本地源码实例：Electron PID `45416`、managed Runtime PID `14032`，pipe/database/hello 正常，stderr 为空；日志位于 `.data/local-restart-20260804-180305/`。
- 本轮未生成 installer、portable 或 release artifact，工作树仍未提交、未推送。

### 实窗证据

- 近 7 天统计页成功加载真实历史请求；一条 `gpt-5.6-sol` 请求显示总计 `22.6k`、普通输入 `3.7k`、缓存读取 `16.9k`、缓存创建 `0`、输出 `2.0k`。
- 同一请求详情显示输入费 `$0.018660`、缓存读取费 `$0.506880`、缓存创建费 `$0.000000`、输出费 `$0.023424`，合计 `$0.548964`，列表显示 `$0.549`。
- `gpt-5.6-sol` 当前自定义 cache-read 单价为 `$30/M`，高于普通输入 `$5/M`，因此缓存命中高时费用由缓存读取费主导；这是现有定价配置值，不是重复计费。

### 验证

- 定向：Shared usage `2/2`、Runtime pricing/run process `8/8`、Anthropic `11/11`、ModelSettings `12/12`、ChatView usage hover `1/1`。
- 包级全量：Shared `23/23`、Protocol `55/55`、Adapters `79/79`；Runtime 全量 `440/441` 的唯一 MCP 子进程启动超时在串行复跑时 `10/10` 通过；Desktop 全量的两个 update watchdog/rollback 时序超时在串行复跑时 `9/9` 通过。
- Shared、Protocol、Adapters、Runtime、Desktop typecheck、lint、build 均通过；Desktop shell 在复选框样式修复后再次 build，`git diff --check` 通过。

## 收口复核：2026-08-04 15:05 +08:00 · 内部无签名闭测链全绿

### 当前结论

- 分支仍为 `feature/newmax-shell-rewrite`，HEAD `5cc35a1`；累计修改保留在未提交工作树，未合并、未提交、未推送、未发布。
- 内部 `unsigned-fixture` 已完成从构建、HTTPS Generic feed、差分下载、真实 `quitAndInstall()`、watchdog ready、目标自动拉起、健康登记到严格卸载清理的闭环。正式 release 仍对 Authenticode、RFC 3161、publisher DN 与独立 signer pin 保持 fail-closed。
- 当前没有本地工程阻塞；Phase 3 状态为 `passed-with-external-evidence-pending`。下一阶段可直接使用无签名包组织内部闭测，正式签名与真实外部服务证据独立补齐。

### 最终证据

- 标准命令 `pnpm test:update-install:win` 通过，证据目录 `.data/update-install-e2e-20260804T064953`：`0.0.1 -> 0.0.2`、install request 1 次、Runtime 重启、identity/safeStorage/metadata/ciphertext/SQLite 连续。
- 差分下载为 2 次 blockmap、7 次 Range、7 次 HTTP 206；完整 installer `130425065` bytes，仅传输 `556013` bytes，节省 `129869052` bytes，没有整包 HTTP 200 回退。
- recovery snapshot 含 watchdog-ready、relaunch、health 与 `healthy` outcome；目标正常启动，因此 `automaticRollbackAttempted=false`。结束后安装目录、卸载注册表、相关进程、handoff、native cache backup 全为 0。
- 默认内部 installer：`apps/desktop/release/installer/SYNC-THINK-Setup-0.0.1-x64.exe`，`130425094` bytes，SHA-256 `9154fca844eb8855453f549998cb23dd005ce769051a40b96f72d9a542bf83fe`；schema v3、`signing.mode=unsigned-fixture`、hash 与 manifest 一致。
- 全量门禁：根测试 20/20 tasks（Desktop 127 files / 852 tests）、typecheck 20/20、lint 11/11、build 11/11、portable 14/14、Phase 3 release/visual 41/41；`pnpm selftest:phase3` 全部 9 步通过。

### 后续外部工作

1. 获取正式 Authenticode 代码签名证书与 RFC 3161 timestamp provider。
2. 使用正式签名 installer 做故障目标版本的 automatic rollback E2E。
3. 验证真实 private feed/CDN、真实图片 Provider，并组织 5-20 位邀请用户反馈。

## 收口复核：2026-08-03 11:34 +08:00 · Phase 3 本地工程门禁恢复

### 当前结论

- 当前分支 `feature/newmax-shell-rewrite` 的 HEAD 为 `5cc35a1`，与 `origin/feature/newmax-shell-rewrite` 一致，相对 `origin/main` 领先 16 个提交。
- 09:41 审计发现的 packaged identity 竞态、根测试并发抖动、portable deploy `EPERM`、update-feed 隐式 fixture 和文档漂移均已在当前工作树处理。
- Phase 3 本地功能与工程门禁现已收口；聚合状态为 `passed-with-external-evidence-pending`。Phase 3 产品阶段仍等待正式发布证据和邀请用户闭测，因此不等同于公开发布就绪。

### 本轮修复

1. packaged identity 锁覆盖完整异步创建与 secret-store 落盘；100 ms 写入窗口下并发首次启动只产生一套 install ID / pipe secret，回归 8/8。
2. Desktop 测试框架预算统一为 15 秒；Desktop Host 正常/畸形 fixture 的 capability 预算为 10 秒，20 ms 超时负例保持不变；Runtime 260-frame bounded replay fixture 改为零节拍。
3. `@tailwindcss/cli` 与 `tailwindcss` 移到 Desktop devDependencies；portable production packages 从 294 降至 262，verifier 拒绝 Tailwind package 和 `.bin/tailwindcss*` 进入生产载荷。
4. update-feed 新增显式 fixture 准备步骤和 preflight 合同；`pnpm test:update-feed:win` 可从空 release 目录重建 portable + schema v3 unsigned NSIS installer，再执行 Generic feed 与 Electron HTTPS E2E。
5. Windows updater 临时目录清理增加有界重试；缺失、legacy、篡改或签名模式错误的 installer fixture 均返回稳定错误和准备命令。

### 最新验证

- Desktop 全量：127 files / 849 tests；Runtime transient 定向：8/8；根 `pnpm test`：20/20 Turbo tasks。
- portable staging 连续两次通过；unsigned installer 为 `130561014` bytes；发布合同 40/40。
- 从空 `apps/desktop/release` 执行 `pnpm test:update-feed:win` 通过 Generic feed 9/9 和 Electron HTTPS 8 场景，包括真实 installer 下载与 checksum mismatch。
- `pnpm selftest:phase3` 于 11:25 开始并在 335.6 秒后通过全部 9 步：Desktop contracts 12 files / 87 tests、release/visual contracts 33 tests、Desktop typecheck/build、fixture prepare、Generic feed E2E、image provider build、无凭证显式 skip 与 Electron 7-case 视觉矩阵。
- 最终门禁已于文档同步后复跑：`pnpm install --frozen-lockfile` 通过；`pnpm exec turbo run test --force` 为 20/20 tasks、0 cached；`pnpm typecheck` 20/20；`pnpm build` 11/11；`pnpm lint` 11/11；`git diff --check` 通过。强制测试计数为 Desktop 127 files / 849 tests、Runtime 63 files / 436 tests。

### 仅剩外部证据

1. 正式 Authenticode 发布证书与 RFC 3161 timestamp provider。
2. 正式签名 installer 的真实升级与故障注入自动 rollback E2E。
3. 真实 private origin/CDN 的授权、cohort、cache invalidation 与撤回演练。
4. 真实图片 Provider 凭证下的生成、预览、Reviewer、返工与重启恢复验收。
5. 5-20 位邀请用户 Windows 闭测与反馈记录。

### 外部证据启动预检（2026-08-03 11:53 +08:00）

- 首个执行目标按路线图确定为正式 Authenticode + RFC 3161 installer build/verify，然后才进入正式签名升级与故障注入 rollback E2E。
- 当前 Process/User/Machine 环境均未配置 Windows signing mode、publisher DN、独立 signer pin、证书来源或 RFC 3161 timestamp server；现有 release resolver 返回稳定阻断码 `installer.signing_certificate_missing`。
- `Cert:\CurrentUser\My` 与 `Cert:\LocalMachine\My` 中符合“未过期 + 带私钥 + Code Signing EKU”的证书数量为 0；仓库内没有 PFX/P12/CER/CRT，GitHub 仓库也没有 Actions workflow、secret、variable 或 environment 可作为受控 release runner 配置来源。
- private feed URL/channel/token 与 live image API key/reviewer model 同样尚未配置；本轮仅检查存在性，没有读取或落盘任何 secret 值。
- 下一执行门禁需要先在受控机器导入正式代码签名证书，或提供受控 PFX/远程签名来源，并配置完整 publisher DN、独立 expected signer SHA-1 与 RFC 3161 timestamp URL。配置就绪后直接运行 `pnpm release:installer:win` 与 `pnpm release:verify:installer:win`，再继续 signed update/rollback E2E。

以下 09:41 内容保留为修复前审计快照，便于追溯问题发现与处置路径。

## 同步复核：2026-08-03 09:41 +08:00 · 已拉取最新代码，Phase 3 仍有本地红项

### 同步事实

- 当前分支 `feature/newmax-shell-rewrite` 已从 `c57c81d` fast-forward 到远端最新 `5cc35a1`（`feat: complete phase 3 desktop and runtime foundations`）；拉取前工作树干净，未产生 merge commit。
- 本次远端增量为 1 个提交、265 个文件、`+57065/-7795`；当前分支相对 `origin/main` 领先 16 个提交，且是当前最新的远端分支。
- 增量主体覆盖 Desktop/Runtime/Workers/Storage：Browser handoff、Windows UIA/Computer Use、图片生成与视觉 Reviewer、Windows installer/updater/automatic rollback、诊断导出、数据库治理与 Phase 3 验收脚本。

### 阶段结论

- Phase 0、Phase 1、Phase 2 仍可视为已关闭。
- Phase 3 的主要本地功能主体已经落地，尤其是 Browser Worker、Desktop Worker、图片 durable 管线、差分 updater、automatic rollback 和 Database Governance fixture-only 能力。
- Phase 3 目前不能标记为“本地门禁全绿”或“可发布”：存在 1 个稳定功能回归、根测试并发抖动、portable staging 失败和文档漂移；正式证书、真实 private feed、真实图片凭证与邀请用户闭测也仍未完成。

### 本机复核结果

- 环境：`pnpm install --frozen-lockfile` 成功；pnpm 生命周期使用托管 Node `20.20.2` / pnpm `10.28.2`。
- 通过：`pnpm typecheck` 20/20、`pnpm build` 11/11、`pnpm lint` 11/11、`git diff --check`。
- 通过：Storage 36 files / 374 tests；Workers 单包 15 files / 100 tests，另有 3 个显式 browser smoke skipped。
- 通过：Desktop 排除已确认失败文件后 126 files / 841 tests；automatic rollback 定向 8 files / 40 tests。
- Runtime 全量为 62 files / 435 tests passed、1 test failed；失败的 transient replay 文件随后定向复跑 8/8 通过，归类为并发时序抖动。
- 未通过：`packaged-install-identity.test.ts` 定向复跑稳定为 7 passed / 1 failed。两个并发首次启动调用产生了不同 install ID / pipe secret。
- 未通过：根 `pnpm test` 两次均在 Workers 的 `DesktopHostClient` 成功握手用例失败；1 秒 capability timeout 在全仓并发负载下被击穿，但该文件定向 4/4、Workers 单包 100/100 通过。
- 未通过：`pnpm selftest:phase3` 完成 Desktop contracts 12 files / 87 tests、release/visual contracts 29 tests、Desktop typecheck/build 后，在 Generic feed 阶段中止。首次为 Windows 临时目录清理 `ENOTEMPTY`；定向 9/9 通过后，完整 E2E 又因缺少 installer fixture 中止。
- 未通过：尝试生成 `unsigned-fixture` portable 两次均在 pnpm shared-lockfile deploy 写入 `tailwindcss.ps1` 时返回 `EPERM`，因此没有生成 installer，也没有重跑真实 Generic feed Electron E2E、visual capture 和最终 Phase 3 汇总。

### 已确认阻塞与风险

1. **P0 - Packaged install identity 并发锁提前释放**：`resolveDesktopRuntimeIdentity()` 在 `try/finally` 中直接返回 `createPackagedIdentity()` Promise，`finally` 会在创建完成前删除 lock；第二个调用可进入并生成另一身份。此问题影响 pipe credential、升级与回滚连续性，必须先修复。
2. **P0 - 发布构建不可从当前干净检出稳定复现**：portable staging 的现代 pnpm deploy 连续两次 `EPERM`；Phase 3 Generic feed E2E 还隐式依赖预先存在的 `apps/desktop/release/installer/SYNC-THINK-Setup-0.0.1-x64.exe`。
3. **P1 - 测试门禁时序不稳定**：Workers 1 秒 host timeout 与 Runtime transient replay 5 秒等待在包级/定向测试通过，但全仓并发会失败。根测试当前不能作为稳定绿门禁。
4. **P1 - 文档漂移**：Roadmap、Handoff、Deployment 和 Changelog 仍把 automatic binary rollback 写成未实现；`TD-034` 正文已被实际提交为问号字符；部分历史“下一任务”也已被后续实现反超。
5. **外部证据**：正式 Authenticode/RFC 3161、正式签名升级与 rollback、真实 private origin/CDN、真实图片 Provider、5-20 位邀请用户闭测仍待完成。

### 建议继续顺序

1. 修复 packaged identity 锁生命周期并补充稳定并发回归，先恢复 Desktop 127 files / 849 tests 全绿。
2. 调整 process-host / transient replay 测试的调度预算或隔离策略，恢复根 `pnpm test` 可重复通过。
3. 定位 pnpm deploy `EPERM`，让 unsigned portable + installer 可从干净检出生成，并使 `selftest:phase3` 自包含前置产物或显式 preflight。
4. 修正文档漂移与 `TD-034` 编码损坏，再复跑 test/typecheck/build/lint/selftest:phase3。
5. 本地门禁全绿后，再进入证书、私有 feed、真实图片凭证和邀请用户闭测。

### 工作树与清理

- 本轮失败 staging 生成的 `apps/desktop/release` 已按受控路径删除；被生成命令改写的 `icon.png` / `icon.ico` 已恢复为 `5cc35a1` 版本。
- 未修改业务代码；本状态快照是本轮唯一计划保留的工作树改动。

## 当前状态：2026-08-03 · Phase 3 与自动 binary rollback 本地收口

### 已完成

- **自动 binary rollback**：Desktop 已完成 rollback recovery store、coordinator、watchdog、updater 与启动接线；recovery root 统一为 `%LOCALAPPDATA%\sync-think-updater\recovery`，NSIS 会把当前版本 installer 自归档到 `installers\<version>\installer.exe`。
- **Rollback 验证**：Desktop 127 files / 849 tests、Desktop typecheck/build、PowerShell 5.1 watchdog healthy/attempt-fence 真实 smoke，以及 `unsigned-fixture` NSIS installer 真实编译均通过。正式签名 installer 的真实 rollback E2E 仍等待外部发布证据。
- **Windows 发布与更新**：portable/installer 定向测试共 22 项通过；Generic feed 9 项单元测试及真实 Electron HTTPS 8 场景通过。正式 release 对 Authenticode signer、完整 publisher DN、独立 signer SHA-1 pin 与 RFC 3161 timestamp 保持 fail-closed；unsigned fixture 必须显式启用。
- **差分真实安装**：正式入口 `pnpm test:update-install:win` 已通过隔离 unsigned fixture 的 `0.0.1 → 0.0.2` `quitAndInstall`。证据位于 `.data/update-install-e2e-20260802T174113/smoke-result.json`：2 次 blockmap 请求、7 次 Range 请求、7 次 HTTP 206；完整 installer `135491101` bytes，实际传输 `504941` bytes，节省 `134986160` bytes，未出现完整 HTTP 200 回退；Runtime、install identity、secret handle、metadata、ciphertext 与 SQLite 连续性均通过。
- **Database Governance P0.4**：sidecar/backfill/recovery/rollback/GC、Event retention/archive、incremental vacuum 与 offline `VACUUM INTO` compaction 已完成；定向门禁 5 files / 51 tests。治理执行器未接 Runtime startup，所有写入验收仅使用临时 fixture。
- **Phase 3 聚合门禁**：`pnpm selftest:phase3` 通过 Desktop contracts 12 files / 87 tests、release/visual contracts 33 tests、Desktop typecheck/build、unsigned portable/installer fixture prepare、Generic feed Electron E2E、image provider build、无凭证时显式 skipped 的 live image acceptance，以及 Electron `capturePage()` 7-case 视觉矩阵。结构化结果为 `passed-with-external-evidence-pending`，视觉证据位于 `.data/phase3-visual/current`。
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

## 当前状态：2026-08-04 · Run 恢复与 Prompt Cache 收口

- 历史对话 Run 的冷启动恢复已增加 5 分钟活动 TTL。超龄 Run 写入 `run.paused/recovery_expired` 并移出执行投影，审计历史保留，Provider 外呼保持为 0。
- Provider fallback 增加 Run 级连续失败计数：同一 Provider 第二次端点级失败后熔断剩余同源模型，避免按每个模型各等待 120 秒。
- 任务对话、工作流 Step、OpenAI Responses、OpenAI Chat 与 Anthropic Messages 的 Provider-managed Prompt Cache 已统一接线；缓存正文不进入 SQLite。
- GPT-5.6+ 使用稳定 key 与 `prompt_cache_options { mode: implicit, ttl: 30m }`，但不发送已确认会使当前中转站返回 502 的内容级 `prompt_cache_breakpoint`；旧 OpenAI 模型继续使用稳定 key，并只在兼容型号上发送 retention；Anthropic 使用原生 ephemeral cache control。
- 缓存读写 usage 均进入现有 `provider.usage` 投影；实际命中量仍由 Provider 返回，低于最小前缀或不支持缓存的中转实现会返回 0。
- 请求体对照确认：同一 `gpt-5.6-sol` 的 baseline、key-only、key+options、developer-no-breakpoint 均为 HTTP 200；只有加入 `prompt_cache_breakpoint` 时返回 HTTP 502。Force-final 现保留 system/tools，只发送 `tool_choice: none`。
- 本地源码实例验证通过：Electron PID 18264、Runtime PID 2744、Pipe 健康、窗口响应、stderr 为空。`gpt-5.6-sol` 第三轮命中 8704/8932 输入 tokens；`gpt-5.5` 两轮各命中 3584 tokens；`usage.summary` 近一天聚合显示总命中 15872 tokens，并正确显示两个模型与 `KMKAPI-CODEX`。
- 验证通过：Adapters 8 files / 79 tests、Core 17 files / 180 tests、Runtime 5 files / 49 tests、Desktop chat-stream 1 file / 6 tests；Adapters/Core/Runtime/Desktop 类型检查通过，Adapters/Core/Runtime/Desktop 构建通过，Prettier 与 `git diff --check` 通过。本轮未生成安装包。
- 最新闭环补测使用独立 `gpt-5.6-luna` 对话：联网 tools 形态前两轮均为 0；切换到固定无联网 tools 后首轮预热为 0，随后两轮分别读取 `2560/3102` 与 `2560/3141` 输入 Token，约 82% 命中。中转两轮都上报 `cache_write_tokens=0`，因此 UI 继续显示真实创建量 0，并以读取量/命中率作为主要健康指标。
- 使用统计 UI 已改为模型/供应商合并列、四类 Token 常显、命中率摘要与逐行费用展开；1424x861、1024x720 以及浅深主题均完成实窗检查。下一步只需完成最终全量门禁和本地源码重启，不生成安装包。
