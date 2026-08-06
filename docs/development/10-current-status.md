## 当前状态：2026-08-05 17:44 +08:00 · Browser Automation Studio P1.1 最终收口

### 当前结论

- P1.1 已完成：Runtime Profile 是唯一真源，Profile 会话只返回脱敏摘要，占用中的 Profile 拒绝刷新、清除和删除；右栏已收敛为临时 partition 的“预览”，不参与 AI 自动化或复用 Runtime Profile 登录态。
- 历史 Run 超过 5 分钟恢复 TTL 时，会把该 Run 的活动 Browser command 终结为 `failed/browser.command-recovery-expired`，再写入 `run.paused/recovery_expired`；不会重放 Provider 或继续占用 Profile。
- Handoff Continue 在 `reason=login` 时写入已验证登录摘要；清除成功但缓存重载失败时保留错误提示，不再被成功提示覆盖。
- BrowserHost 不再调用 `storageState()`；origin inventory 由 Runtime 已知 origin、当前 Page 和 Cookie domain 派生并限制为 512 条。registrable domain 使用 `tldts@6.1.86`，裸 IPv6 与 URL 方括号主机名可正确清除，CDP 建连失败时临时 Page 会被回收。

### 最终门禁

- Storage build 通过；Storage `36 files / 380 tests`、Workers `15 files / 117 passed / 3 skipped`、Runtime `70 files / 464 tests`、Desktop `131 files / 868 tests` 全部通过，均按包隔离并使用最多 2 个 test worker。
- `pnpm typecheck`：20/20；`pnpm lint`：11/11；`pnpm lint:tokens`：通过；`pnpm exec turbo run build --force`：11/11、0 cached。
- 本轮相关文件 Prettier 检查与 `git diff --check` 通过；源码中没有 `storageState()` 调用残留。

### 本地闭测实例

- 最新源码 Electron PID `43956`、managed Runtime PID `37228`，CDP `127.0.0.1:9333`；Pipe 握手、`runtime.healthcheck`、database 和 hello 均正常。
- 日志：`.data/local-restart-20260805-125346-browser-profile/desktop-final.stdout.log` 与 `desktop-final.stderr.log`；stderr 只有 DevTools 监听信息和一条 `libpng iCCP` 图片色彩配置警告，没有应用错误。
- 实窗切换到“最终闭测”Profile 后，实时刷新发现 `microsoft.com` 会话；清除返回 origin `https://copilot.microsoft.com` 并删除 1 个 Cookie。随后 UI 空态、SQLite `browser_site_session` 空表和活动 Browser command `0` 保持一致。
- 最终截图：`.data/local-restart-20260805-125346-browser-profile/profile-final-after-clear.png`；1424x861 下 `scrollWidth=clientWidth=1424`、`scrollHeight=clientHeight=861`，无页面级溢出。测试专用 Edge 窗口已关闭，Electron/Runtime 保持运行。
- 工作树继续保持 dirty；未提交、未推送，也未生成 installer、portable 或 release artifact。

### 下一步

1. P1.2：录制专用系统浏览器的语义动作、实时脱敏步骤流与停止后的资源清理。
2. P1.3：把确认后的录制步骤冻结为 WorkflowVersion，并实现确定性回放、失败定位与登录接管恢复。
3. 录制和回放都复用本轮 Profile/Page lease/维护门禁；Cookie、Token 和网站存储正文不得写入 Workflow。

## 当前状态：2026-08-05 14:09 +08:00 · Browser Automation Studio P1.1 收口

### 当前结论

- P1.1 已完成：Runtime Profile 是唯一真源，Browser 页面可创建、重命名、删除非默认 Profile，查看脱敏站点会话，显式刷新，按站点清除 Cookie/LocalStorage/IndexedDB 等数据。
- Profile 被 Run、handoff 或 BrowserHost lease 占用时，刷新、清除和删除均在 Runtime/Main 双侧禁用；默认 Profile 不可删除；危险清除使用单层确认。
- Runtime 刷新命令也有同一占用栅栏；直接 IPC 绕过 UI 时不会读取活动 Profile。
- Edge 143 的 `Storage.getUsageAndQuota` / `Storage.clearDataForOrigin` 固定走 Page target CDP Session；没有现有 Page 时创建临时 Page，避免 Browser target 的 `Internal error`。
- Profile 实时维护命令使用 30 秒预算，`runtime.healthcheck` 仍为 5 秒；冷启动刷新实测约 2.32 秒完成，UI 与 SQLite 摘要保持一致。
- P1.2 尚未开始：专用系统浏览器语义动作录制、实时步骤流、WorkflowVersion 与确定性回放仍是下一阶段工作。

### 本轮实窗证据

- 隔离目录：`.data/local-restart-20260805-125346-browser-profile`；Electron PID `46488`、Runtime PID `19704`、CDP `127.0.0.1:9333`。
- 已验证鼠标切换 Profile、创建/重命名/删除非默认 Profile、默认 Profile 保护、站点清除确认、Page 级 CDP 清除、清除后空态和 SQLite 同步删除。
- 1424x861、1024x720 的浅色/深色页面均无横向溢出或可见文本溢出；截图位于该隔离目录的 `initial.png`、`profile-light-session.png`、`profile-clear-dialog.png`、`profile-dark-1424x861.png`、`profile-dark-1024x720.png`、`profile-light-1024x720.png`，最终保留页为 `profile-light-final-1424x861.png`。

### 当前验证门禁

- `pnpm typecheck`：20/20；`pnpm lint`：11/11；`pnpm lint:tokens`：通过；`pnpm exec turbo run build --force`：11/11、0 cached。
- P1.1 定向/包级测试与 Browser Profile 实窗验收已通过：Workers 15 files / 111 passed / 3 skipped，Runtime 70 files / 460 passed，Desktop 131 files / 866 passed；`git diff --check` 通过。新增 Profile 文件已用 Prettier 格式化；历史文件的基线格式差异未做全仓重排。
- 根 `pnpm test` 在默认并发和 `turbo --concurrency=1` 下各有既有资源时序抖动（Workers/MCP、Runtime lease 时间断言、Desktop updater watchdog）；对应 Workers/Runtime/Desktop 包级受控复跑及失败文件单独复跑均通过。本轮未修改这些无关测试。
- 工作树仍保持 dirty，不提交、不推送、不生成 installer/release artifact。

### 下一步

1. P1.2：录制专用浏览器的语义动作（navigate/click/fill/select/wait 等），实时输出脱敏步骤流并支持停止后清理。
2. 在 P1.2 设计中复用本轮 Profile、Page lease 和维护门禁，不把登录态或 Cookie 正文写入 Workflow。
3. 录制能力通过自动化测试和本地源码重启实窗验收后，再进入 WorkflowVersion/回放实现。

## 当前状态：2026-08-05 10:30 +08:00 · Computer Use 与回复累计缓存用量已修复

### 当前结论

- Computer Use 新增 `desktop_launch_app`，只有 Windows Shell 启动后找到匹配进程映像的可见顶层窗口才返回成功；`run_command` 的退出码不再被当作 GUI 已打开的证据。
- 聊天消息用量现按真实 Provider `requestId` 去重并累计整次回复，不再只显示工具循环最后一次请求；使用统计的旧 Event 也不再按共享 `packetId` 合并。
- 缓存字段缺失与明确 `0` 已分开：缺失显示“未上报”，命中率分母只包含已上报缓存读取的请求；请求状态和费用标签改为“成功 / 失败 / 未结束”与“普通输入费”。
- 用户截图中的两条历史回复已由运行中的 Runtime 复核：4 个工具步骤的回复累计输入 `30,002`、缓存读取 `20,480`、输出 `546`；5 个工具步骤的下一条回复累计输入 `46,422`、缓存读取 `37,376`、输出 `1,045`。此前显示的 `5,632 -> 4,608` 只是两条回复各自最后一次 Provider 请求，单请求下降本身符合中转缓存的 exact-prefix 行为。
- usage sidecar 已升级为 `.data/SYNC-THINK/usage-summary-cache-v2.json`：483,420 bytes、schema V2、high-water rowid 36,041、1,791 条投影事实。近 7 天真实统计为 91 个请求、输入 777,698、缓存读取 496,640、缓存创建 0。
- 当前分支 `feature/newmax-shell-rewrite`、HEAD `9e5ee8d`；改动仍在未提交工作树，未生成 installer、portable 或 release artifact。

### 验证与运行实例

- Runtime：67 files / 454 tests passed；Desktop：130 files / 860 tests passed。双包同时并行时出现既有异步计时抖动，按包隔离复跑全部通过。
- Runtime / Desktop typecheck、lint、design token 检查、Prettier 和 `git diff --check` 通过。
- `pnpm exec turbo run build --force`：11/11 successful、0 cached。
- 当前 Electron PID `23508`、managed Runtime PID `23468`，窗口 Responding；日志 `.data/local-restart-20260805-102720/` 包含 `pipe ready`、`database ready`、`hello accepted`，stderr 只有 DevTools 监听信息。
- 使用统计实窗截图：`.data/local-restart-20260805-102720/usage-settings.png`；当前窗口停留在“设置 → 模型 → 使用统计”，便于继续手测。

### 用户手测

1. 开启 Computer Use，发送“打开本地记事本”。预期执行 `desktop_launch_app`，数秒内出现可见 Notepad 窗口；不应使用 `run_command` 证明成功，也不应等待 120 秒。
2. 在同一对话连续执行两次含工具调用的请求，悬浮每条助手消息底部 Token。标题应为“本次回复累计”，数值应为该回复内全部 Provider 请求之和。
3. 打开“设置 → 模型 → 使用统计”。缓存未上报时显示“未上报”，真实零显示 `0`；状态显示“成功 / 失败 / 未结束”，缓存命中率提示包含上报请求数。
4. 中转站单次缓存读取可以随动态工具结果和前缀变化而下降；应关注整次回复累计值和长期命中率，不要求每个后续请求都单调增加。

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

## 当前状态：2026-08-04 23:19 +08:00 · 使用统计卡死修复已重启待手测

### 当前结论

- 原错误 `Runtime request timed out: runtime.healthcheck` 已定位并修复。问题不是 Runtime 未启动，而是 16.87GB SQLite 上的同步使用统计 SQL 阻塞了 Runtime Pipe 事件循环。
- 统计扫描已从 Runtime 主线程移入只读 Worker，并增加持久增量 sidecar。首次缓存构建完成后，统计页不再重复扫描约 198 万条 Event。
- 当前本地源码实例已从最新强制构建产物重启；未生成 installer、portable 或 release artifact，未提交、未推送。

### 实现与性能

- 数据库：`.data/SYNC-THINK/sync-think.db`，16,873,340,928 bytes，约 1,986,942 条 Event。
- 缓存：`.data/SYNC-THINK/usage-summary-cache-v1.json`，615,785 bytes；high-water rowid 为 1,986,942。
- 首次真实只读扫描约 111,259 ms，主线程心跳持续 11 次；SQLite 文件大小和修改时间在扫描前后保持不变。
- sidecar 增量读取约 216 ms；重启后的真实全量 `usage.summary` 为 182 ms，同时发出的 `runtime.healthcheck` 为 1 ms。
- 全量统计返回 6 个模型、91 个请求、16 类工具和 37 条工具失败；近 7 天没有 `provider.usage` 记录，因此该范围返回 0 属于当前数据事实。

### 验证与运行实例

- Runtime：67 files / 447 tests passed。
- Desktop：129 files / 855 tests passed。
- Runtime / Desktop typecheck passed。
- `pnpm exec turbo run build --force`：11/11 successful，0 cached。
- 当前 Electron PID：11048；Runtime PID：97648；独立 Pipe probe 返回 `ok: true`。
- 日志目录：`.data/restart-usage-summary-fix-20260804-231913`；stdout 已包含 `pipe ready`、`database ready`、`hello accepted`，stderr 为空。

### 用户手测

1. 打开“设置 → 模型 → 使用统计”。
2. 依次切换“24 小时、7 天、30 天、全部”。
3. “全部”应快速显示已有历史统计；24 小时和 7 天可能为空，这是当前数据库时间范围内没有使用记录。
4. 重复关闭并打开统计页，页面应持续快速响应，主界面和其他对话操作不应被卡住。
5. 不应再出现 `runtime.healthcheck` timeout；如仍有异常，保留当前窗口并检查上述重启日志目录。

## 当前状态：2026-08-04 23:57 +08:00 · Browser / Computer Use 调用修复已重启待手测

### 当前结论

- “打开 4399”与 Computer Use 指令不执行的共同根因已经修复。故障发生在 Provider 请求前：多行、引号或多模态消息经过 JSON 序列化后，Context Snapshot 的来源校验无法再匹配原始文本，于是误报 `included source is absent from provider payload`。
- 消息来源现在按结构化内容匹配；上下文一致性错误固定归类为 `protocol`，不再触发模型 fallback 风暴。
- Computer Use 开启后，即使没有项目目录与 Agent tools，Context Status 也会正确包含 Desktop tool schemas。
- 此次修复保留了上一轮使用统计 Worker、增量 sidecar 与 `usage.summary` 300 秒专用预算，没有回退到 Runtime 主线程同步扫描。

### 自动验证

- Runtime 定向测试：6 files / 29 tests passed，覆盖 Context Snapshot、Browser Host、Computer Use、Context Status 与使用统计异步缓存。
- Desktop 定向测试：1 file / 1 test passed，确认仅 `usage.summary` 使用 300 秒预算，普通 `runtime.healthcheck` 仍为 5 秒。
- Runtime / Desktop typecheck passed。
- 目标文件 Prettier 与 `git diff --check` passed。
- `pnpm exec turbo run build --force`：11/11 successful，0 cached。
- 独立 `node scripts/pipe-client.mjs` 返回 `PIPE_SMOKE_OK`，实时 `runtime.healthcheck` 返回 `ok: true`。

### 当前运行实例

- Electron PID：`41004`；Runtime PID：`4444`；两者均处于 Responding 状态。
- 日志目录：`.data/restart-browser-computer-use-fix-20260804-235706`。
- stdout 已包含 `pipe ready`、`database ready`、`hello accepted`；stderr 为空。
- 当前工作树保留本轮与使用统计修复，未提交、未推送；未生成 installer、portable 或 release artifact。

### 用户手测

1. 在对话中开启“联网”，发送：
   ```text
   打开 https://www.4399.com/
   ```
   预期：出现 `browser_open` requested/completed，并打开可见 Browser 页面。
2. 在设置中开启 Computer Use，把当前对话权限设为“完全访问”，发送一个窗口枚举或读取任务。
   预期：执行 `desktop_list_windows`；普通已解析的显示/读取动作不额外审批，敏感或 human-only 动作仍按动作策略进入审批。
3. 再使用带换行、中文引号和英文双引号的 Computer Use 指令。
   预期：不再出现 `included source is absent from provider payload`，Desktop 工具链继续执行。
4. 打开“设置 → 模型 → 使用统计”并切换时间范围。
   预期：页面保持响应，不再出现 `runtime.healthcheck` timeout。

## 当前状态：2026-08-04 · Browser 完全访问与思考耗时已完成实机验证

### 当前结论

- Browser 在“完全访问”对话中不再停在审批等待态。策略需要审批时，Runtime 会自动创建仅当前 Run 有效的 origin grant，不发布审批弹窗事件；非完全访问模式仍按原策略处理。
- Browser 与 Computer Use 都已从 SYNC-THINK 对话界面真实调用成功，不只是单元测试或模拟 Host。
- “正在思考与执行”现在每秒显示已用时间，Run 完成后切换为“思考与执行过程”并冻结最终耗时。
- 最新强制构建产物已经启动，当前实例保持运行供人工测试；未提交、未推送，也未生成发布产物。

### 实机证据

- Browser Run：`9R7WZ6Z1ZGFSV21SDWWB7034MT`。
  - 指令：打开 `https://www.4399.com/`。
  - Microsoft Edge 成功显示 4399 首页。
  - Event 顺序为 `browser.command.started`、`tool.completed`、`run.completed`。
  - `approval_request` 为空，没有 `tool.approval_requested`。
  - SQLite 已持久化 `auto-full-access:9R7WZ6Z1ZGFSV21SDWWB7034MT:call_2SchiiUIwRcaKOHWY06vwYyB` 对应的 Run-scoped grant。
  - 完成态耗时冻结为 `00:10`。
- Computer Use Run：`0D1M07ZM5G32528DA1VS91FGMD`。
  - 指令：列出当前可见窗口并返回 SYNC-THINK 标题。
  - `desktop_list_windows` 真实执行并返回标题 `SYNC-THINK`。
  - Event 顺序为 `desktop.command.started`、`tool.completed`、`run.completed`，审批记录为空。
  - 完成态耗时冻结为 `00:09`。

### 自动验证与运行实例

- Runtime：4 files / 24 tests passed。
- Desktop：4 files / 21 tests passed。
- Runtime / Desktop typecheck passed。
- `pnpm exec turbo run build --force`：11/11 successful，0 cached。
- `pnpm selftest:browser-handoff`：continue、cancel-close-page、cancel-keep-open 全部通过。
- `pnpm selftest:desktop-handoff`：continue、cancel 全部通过。
- 当前开发 session：`83655`；Runtime PID：`61144`；Electron PID：`61212`；窗口标题：`SYNC-THINK`。
- Pipe：`\\.\pipe\sync-think-dev-0001`；数据库：`D:\projects\SYNC-THINK\.data\SYNC-THINK\sync-think.db`。

### 用户手测

1. 把当前对话权限设为“完全访问”，开启 Browser 后发送：
   ```text
   打开 https://www.4399.com/
   ```
   预期：直接打开网页，不出现 Browser 审批弹窗。
2. 开启 Computer Use 后发送：
   ```text
   列出当前可见窗口并告诉我 SYNC-THINK 窗口的标题
   ```
   预期：返回 `SYNC-THINK`，不额外等待审批。
3. 观察运行中的“正在思考与执行 · MM:SS”每秒增长；完成后应变为“思考与执行过程 · MM:SS”，且时间停止增长。

## 当前状态：2026-08-05 19:35 +08:00 · Browser Automation Studio P1.2 代码收口

### 当前结论

- P1.2 语义录制主链已完成：专用系统浏览器、Runtime Profile 独占、durable intent/步骤、实时脱敏步骤流、停止资源清理和冷启动中断恢复均已接线。
- Renderer 只展示“登录状态 / 录制”，未实现的自动化任务不出现；start pending 与未知对账结果保持全局 Profile 锁，异常终态显示具体原因并清理过期成功提示。
- 安全边界固定为单 Page 主 Frame、`navigate/click/fill/select/check/Enter`、200 步和 16 KiB 单步；URL 去除 userinfo/query/hash，敏感输入用秘密占位，binding 使用随机 capture token 和 trusted event。
- 质量审查已修复两个 Runtime 错误路径：lease 获取失败不关闭无关 Profile session；stop 失败不产生 unhandled rejection，并可重试。

### 当前验证

- Storage 定向 `3 files / 73 tests`；Workers BrowserHost `33/33`；Runtime Recording Service `7/7`；Desktop BrowserStage/payload/timeout/wiring `4 files / 38 tests`。
- Workers、Runtime、Desktop typecheck 与 lint 通过；Desktop design token 检查通过；相关文件 Prettier 和 `git diff --check` 通过。
- 包级全量、根级最终门禁、强制 build 和最新源码实窗录制尚待执行；未生成 installer、portable 或 release artifact，未提交、未推送。

### 下一步

1. 运行 Storage、Workers、Runtime、Desktop 包级全量，再运行根级 typecheck、lint、token lint 与强制 build。
2. 重启本地源码 Electron/Runtime，使用真实 Edge 录制 `navigate/click/fill/select/check/Enter`，确认 URL/敏感值脱敏、Page 关闭中断和停止后 Profile 立即可维护。
3. P1.3：把录制草稿冻结为 WorkflowVersion，实现变量/秘密引用、编辑、确定性回放、失败定位和登录 handoff。

## 当前状态：2026-08-05 21:00 +08:00 · Browser Automation Studio P1.2 最终实窗收口

### 当前结论

- P1.2 已完成自动门禁与真实 Edge 闭环。刷新登录状态后 Profile 不再被本次维护锁错误标记为“使用中”，刷新、站点清除、再次录制和删除会按真实占用状态立即恢复。
- 文本输入在 Enter 前仍会排空 debounce，但随后触发的 change 只处理尚未排空的输入，不再产生重复 fill；因此 Enter 后导航可稳定折叠进同一 press 步骤。
- trusted event 边界保持不变。真实 select 验收通过键盘事件完成；脚本直接派发的非 trusted change 继续被拒绝。

### 最终验证

- Storage 基线 `36 files / 384 tests`、Workers `15 files / 124 passed / 3 skipped`、Runtime `74 files / 477 tests`、Desktop `133 files / 897 tests` 全部通过；本轮新增定向为 Profile Service `8/8`、BrowserHost `35/35`。
- 根 `pnpm test --force --concurrency=1` 为 20/20 Turbo tasks、0 cached，最终源码在受控串行资源下全绿。
- 根 `pnpm typecheck --force` 为 20/20、`pnpm lint --force` 为 11/11、design tokens 通过、`pnpm exec turbo run build --force` 为 11/11 且 0 cached；目标文件 Prettier 与 `git diff --check` 通过。
- Pipe probe 返回 `PIPE_SMOKE_OK`，Runtime healthcheck 为 `ok: true`，没有 in-flight Run。

### 真实 Edge 证据

- 隔离目录：`.data/local-restart-20260805-204946-browser-recording-final`；Electron PID `3452`、Runtime PID `33812`、CDP `127.0.0.1:9336`，窗口保持运行供手测。
- 正常录制得到 10 个 durable 步骤，覆盖 `navigate/fill/select/check/click/press`；立即停止在 528 ms 内完成并保留最后一次 fill。Enter 输入仅一条，结果 URL 已折叠进 press。
- 刷新登录状态后站点清除按钮立即可用；清除完成后可再次录制。关闭系统 Edge Page 后终态为 `interrupted/page_closed`，随后 Profile 完整删除。
- SQLite 活动录制为 0、站点摘要为 0，测试密码、敏感富文本、URL userinfo/query/hash 均无明文命中；删除 Profile 的目录、CDP metadata 与 Edge 进程均已清理。
- 三张 1424x861 截图已目视复核，无重叠、截断或页面级溢出；DOM 指标为 `scrollWidth=clientWidth=1424`、`scrollHeight=clientHeight=861`。
- 未生成 installer、portable 或 release artifact，未提交、未推送。

### 下一步

1. P1.3：把确认后的录制草稿冻结为 WorkflowVersion，增加固定值/运行变量/秘密引用、编辑和确定性回放。
2. P1.4/P1.5 继续负责运行历史、失败定位、登录 handoff 与手动启停定时任务；P1.2 草稿本身仍不可调度执行。

## 当前状态：2026-08-05 22:46 +08:00 · Browser Automation Studio P1.3 第一切片最终构建与重启

### 当前结论

- Browser 页默认视图已切换为“自动化任务”，支持手动/AI 创建 Task Draft、进入录制工作区、提交审核、驳回重录和批准发布不可变 `WorkflowVersion`。
- 自动化生命周期真源为 SQLite 的 Task/Draft/Review/Version；批准后的版本不可更新或删除。当前版本冻结的是脱敏语义步骤，尚未接入确定性执行器。
- BrowserHost 已改为 Chrome 优先、Edge 回退；录制页面右下角提供“录制中”浮层、时长、步骤数和“结束录制”按钮。
- 对话模型可以查询真实自动化任务并创建 AI 来源 Draft。`ask` 模式的创建工具需要普通审批，`workspace/full-access` 可直接创建 Draft；发布仍必须由用户在任务页显式批准。

### 当前验证

- 定向验证：Runtime 3 files / 67 tests、Desktop 3 files / 43 tests，Runtime/Desktop typecheck 均通过。
- 包级全量：Storage 36 files / 387 tests；Workers 15 files / 124 passed / 3 skipped；Runtime 76 files / 490 tests；Desktop 135 files / 915 tests。
- 根级门禁：typecheck 20/20、lint 11/11、design tokens、强制 build 11/11（0 cached）和 `git diff --check` 均通过。
- 最新源码已使用隔离目录 `.data/local-restart-20260805-224600-browser-workflow-p13` 重启：Electron PID `8144`、managed Runtime PID `102992`（Node `20.20.2`），窗口可见且 Responding；pipe/database/hello 与独立 `runtime.healthcheck` 均正常，stderr 为空。
- 未生成 installer、portable 或 release artifact；未提交、未推送。

### 后续范围

1. P1.3 后续：步骤编辑、固定值/运行变量/秘密引用绑定，以及已发布 WorkflowVersion 的确定性回放。
2. P1.4：运行历史、逐步日志/截图、失败定位与登录 handoff。
3. P1.5：手动启停的定时任务；条件、循环与 AI 自修复继续留在 P2。

## 当前状态：2026-08-06 09:10 +08:00 · 已拉取远端 P1.3 第一切片并完成实现核查

### 同步事实

- 当前分支 `feature/newmax-shell-rewrite` 已从 `09b02ad` fast-forward 到远端最新 `5239407`（`feat: browser workflow feature and recording hardening`），与 `origin/feature/newmax-shell-rewrite` 的 ahead/behind 为 `0/0`；拉取后工作树干净。
- 本次远端增量涉及 43 个文件，约 `+5476/-139`。主体是 Browser Workflow Task/Draft/Review/Version、Desktop 任务页、聊天工具、录制加固和迁移 `0038_browser_automation_workflow`。

### 当前完成边界

- P1.1 Profile/脱敏登录状态管理和 P1.2 语义录制保持完成；P1.3 只完成第一切片，不是完整自动化闭环。
- 已实现 Task → Draft → Review → immutable WorkflowVersion 生命周期；录制必须已停止、至少一步且 Profile 匹配才能提交。批准会冻结脱敏步骤，SQLite trigger 禁止修改或删除已发布版本。
- Desktop Browser 默认进入“自动化任务”，支持创建任务、绑定录制、提交审核、驳回重录、批准发布和查看 V1；对话工具支持 list/get/create AI Draft，但不暴露审核或发布能力。
- BrowserHost 使用显式 executable → Chrome → Edge 的发现顺序，并在录制页显示计时、步骤数和停止浮层。

### 尚未完成

1. P1.3 后半段：步骤编辑、固定值、运行变量、秘密引用绑定，以及已发布 WorkflowVersion 的确定性执行/回放。当前“已发布”仅表示审核后冻结，不能运行。
2. 现有公开 API 只能创建新 Task + Draft，没有为既有 Task 创建下一版 Draft 的入口；版本号递增逻辑存在，但产品路径目前只能到 V1。
3. P1.4 的运行历史、逐步日志/截图、失败定位、登录 handoff，以及 P1.5 的手动启停定时任务均未开始；条件、循环和 AI 自修复仍在 P2。

### 核查发现的风险与偏差

1. **P0**：`packages/storage/src/production-execution-store.ts:624` 的 `isLocalContentRef()` artifact URI 白名单正则混入 `function mapProviderRow(...)` 文本，导致白名单被意外放宽。继续发布或扩展执行链前应先修复并补 malformed contentRef 回归测试。
2. **P1**：Profile 删除采用 soft delete，但已有 Workflow Task 仍引用该 Profile；任务会从按活动 Profile 过滤的 Desktop 入口消失，且当前没有阻止删除、重绑或归档恢复策略。
3. **P1**：任务页“让 AI 创建”按钮只是打开同一人工表单并写入 `source=ai`，不会调用模型；真正的 AI Draft 创建仅存在于聊天工具，UI 文案和行为需要统一。
4. **P1**：Review note 会写入 SQLite，但 get API 不返回审核历史，驳回备注之后无法查看；聊天工具把 query 描述成支持 URL 搜索，Storage 实际只搜索 name/instruction。
5. 当前证据覆盖单元/组件/接线测试、构建和源码健康启动，但没有记录一次真实 Chrome/Edge 的 Task → 录制 → 提交 → 驳回/批准 → SQLite 复核的 P1.3 端到端实窗验收。

### 验证与运行状态

- 提交 `5239407` 记录的验证为 8 个包共 2479 tests、根 build 11/11；状态文档另记录 Storage 387、Workers 124 passed/3 skipped、Runtime 490、Desktop 915，以及 typecheck 20/20、lint 11/11。本次没有重新运行包级/根级全量门禁。
- 本次定向复跑通过：Storage browser-store `15/15`、Workers BrowserHost `36/36`、Runtime 3 files / `61/61`、Desktop workflow payload/wiring/BrowserStage 3 files / `49/49`。首次直接运行 Runtime 定向测试时，拉取前遗留的旧 `storage/dist` 缺少新方法并导致 4 项失败；按 Turbo 依赖图先执行 `pnpm exec turbo run build --filter=@sync-think/storage`（shared/storage 2/2）后全部通过，说明后续测试应从声明的 task graph 入口运行。
- 上一轮隔离实例的 Electron PID `8144`、Runtime PID `102992` 当前均已退出；当前没有可用于继续手测的最新源码实例。
- 本次没有生成 installer、portable 或 release artifact，也没有修改业务代码。

### 建议继续顺序

1. 先修复 P0 contentRef 正则并补边界测试。
2. 收敛 P1.3 第一切片的产品生命周期：Profile 删除策略、既有任务新 Draft/V2 路径、审核历史、搜索合同和 AI 创建入口。
3. 完成步骤编辑、值绑定和确定性回放，并补真实 Chrome/Edge 端到端实窗验收；之后再进入 P1.4/P1.5。

## 当前状态：2026-08-06 10:04 +08:00 · Browser Automation Studio P1.3 生命周期收口进行中

### 已完成代码

- P0 contentRef 已统一为共享严格合同，Artifact/Production Execution 不再接受空格、花括号 artifact URI 或远程 `file://`。
- Profile 有任何自动化 Task 引用时，Runtime 与 Storage 双层阻止删除并返回稳定错误；Desktop 会关闭确认框并显示保留原因。
- 新增已发布 Task 的 V2 Draft API/IPC/UI：V1 在 V2 编辑和待审期间继续作为 `publishedVersionId`，V2 批准后才切换。
- Workflow get 返回最近 100 条审核历史与截断标记；搜索覆盖任务名称、目标和网址。Desktop 显示审核备注，V2 待审优先显示当前 Draft 步骤，任务标题保持进入详情。

### 当前验证

- 定向：Storage `3 files / 42 tests`、Runtime Workflow/Profile/validation `3 files / 15 tests`、Runtime chat tools `55/55`、Desktop `3 files / 54 tests`。
- 包级：Storage `36 files / 389 tests`、Runtime `76 files / 493 tests`、Desktop `135 files / 926 tests`，全部使用单包单 worker 通过。
- Storage、Runtime、Desktop typecheck 通过；共享 Protocol/Storage/Workers 依赖产物已按 Turbo task graph 强制重建。
- 根级 lint、design token、强制 build、Prettier/diff 最终复核和尚未启动的真实 Chrome/Edge 验收仍是当前任务，不生成 installer。

### 明确边界

1. 当前发布版本仍不能执行；步骤编辑、固定值/运行变量/秘密引用与确定性回放继续属于 P1.3 后续。
2. Task 重绑/归档未实现，因此有关联任务的 Profile 当前必须保留。
3. “让 AI 创建”入口按 Locked 设计保留；模型驱动创建当前由聊天工具完成，任务页入口仍只建立 AI 来源 Draft。

## 当前状态：2026-08-06 10:36 +08:00 · 远端同步与 P1.3 进度复核

### 同步结果

- 已执行 `git fetch --prune origin` 和 `git pull --ff-only origin feature/newmax-shell-rewrite`；远端与本地 HEAD 均为 `5239407ecf6630ebbcf3fb533098ea04ccc5f38f`，ahead/behind 为 `0/0`，拉取结果为 `Already up to date`。
- 当前工作树保留 P1.3 生命周期收口改动：30 个已修改文件、1 个未跟踪文件，tracked diff 约 `+1116/-195`。未跟踪的 `packages/storage/src/local-content-ref.ts` 是当前构建依赖，提交时必须一并纳入。

### 当前完成边界

- 远端 `5239407` 已交付 P1.3 第一切片：Task、Draft、Review、不可变 WorkflowVersion、V1 审核发布，以及 Desktop/Chat 查询和创建 Draft 的入口。
- 当前未提交改动进一步补齐严格 contentRef 合同、Profile 自动化任务引用保护、V1 到 V2 Draft 生命周期、最近 100 条审核历史、URL 搜索与 Desktop V2 审核展示。
- V2 编辑和待审期间继续保留旧 `publishedVersionId`；批准后才创建递增版本并切换指针。模型工具仍不具备审核或发布权限。

### 本次验证

- `pnpm exec turbo run test --force --concurrency=1`：20/20 Turbo tasks、0 cached，耗时 3 分 24 秒；Storage 389、Runtime 493、Desktop 926 等既有包级计数保持通过。
- `pnpm exec turbo run typecheck --force`：20/20、0 cached；`pnpm exec turbo run build --force`：11/11、0 cached；`pnpm exec turbo run lint --force --continue`：11/11、0 cached。
- `pnpm lint:tokens` 与 `git diff --check` 通过。Prettier 仅报告 `docs/product/06-roadmap.md` 的新增内容尚未格式化，本次状态分析未修改该文件。
- 本次未安装依赖、未启动或重启产品实例、未生成 installer/portable/release artifact，也未提交或推送工作树。

### 本地 Edge 实窗验收

- 隔离实例 `.data/local-restart-20260806-101617-browser-workflow-v2` 正在运行，默认 Profile 的 Edge 143 CDP `127.0.0.1:50781` 可通过 `/json/version` 读取，Protocol 为 1.3。
- `P13 V2 生命周期闭测` 已完成 V1 批准、V2 首次录制驳回、同一 V2 Draft 重录后批准。SQLite 保留 V1/V2 两条不可变 Version，最终 Task 为 `enabled`、`published_version_id` 指向 V2；3 次录制均为 `stopped/user`，各自 `step_count=stored_steps=3`。
- Review 顺序为 V1 批准、V2 驳回、V2 批准。截图 `acceptance/02-v2-rejected-detail.png` 显示驳回时旧 V1 仍发布，`acceptance/03-v2-approved-detail.png` 显示最终切换 V2；界面未发现明显遮挡或文本溢出。
- 非默认 Profile `关联保护闭测` 仍有 Task 引用且 `deleted_at IS NULL`。Desktop stderr 记录删除请求稳定返回 `browser.profile-has-workflows`，证明 Host 数据目录删除前的保护已触发；除此之外未见应用异常。

### 剩余工作与风险

1. 把已经通过的 V2 驳回、旧 V1 指针保持、重录再批准实窗路径固化成自动化回归；补超过 100 条 Review 的截断、排序和同时间 tie-break 测试，并处理 Roadmap 的 Prettier 差异。
2. 评估任务列表逐项调用 `getWorkflow` 带来的 N+1 IPC/SQL；明确误建 V2 Draft 的取消/丢弃、任务归档/删除和 Profile 重绑策略。当前公开 API 也没有历史版本列表、按版本查看或回滚入口。
3. P1.3 后半段仍包括步骤编辑、固定值/运行变量/秘密引用绑定与确定性回放。Task 在 V2 编辑期状态为 `draft`，后续执行资格必须明确按发布指针还是 Task 状态判断。
4. P1.4 的运行历史、逐步日志/截图、失败定位和登录 handoff，以及 P1.5 定时任务尚未开始；Chrome 路径尚未单独复测，本次实窗证据来自 Edge 143。

## 当前状态：2026-08-06 10:55 +08:00 · Browser Automation Studio P1.3 生命周期最终收口

### 最终结论

- P0 contentRef 严格合同、Profile 自动化任务引用保护、V1→V2 Draft 生命周期、最近 100 条审核历史、URL 搜索与 Desktop V2 UI 已完成自动门禁和真实 Edge 验收。
- 实窗额外发现并修复新建 Draft 后未录制直接返回时列表不刷新的问题。`BrowserStage` 退出录制工作区会递增 Workflow 刷新令牌并重新读取 Runtime/SQLite；最终源码中“直接返回刷新闭测”无需手点刷新即可出现。
- 当前仍只完成 P1.3 的治理与不可变版本切片。WorkflowVersion 不能执行；步骤编辑、固定值/运行变量/秘密引用绑定和确定性回放仍是后续切片。

### 自动化门禁

- 新增回归测试先在旧实现失败，再由最小刷新修复通过；`BrowserStage.test.tsx` 为 39/39。Desktop 包级为 135 files / 927 tests，typecheck、lint、design token 和 build 均通过。
- 根 `pnpm typecheck --force` 为 20/20、`pnpm lint --force` 为 11/11、`pnpm lint:tokens` 通过、`pnpm exec turbo run build --force` 为 11/11，均为 0 cached。
- 根测试第一次仅在 Workers Terminal 清理 Windows 临时目录时出现已知 `EBUSY`；目标文件复跑 8/8，第二次 `pnpm test --force --concurrency=1` 完整通过 20/20、0 cached。Prettier 和最终 diff check 通过。

### Edge 与 SQLite 证据

- 隔离目录为 `.data/local-restart-20260806-101617-browser-workflow-v2`。`P13 V2 生命周期闭测` 经过 V1 批准、V2 驳回、同一 V2 Draft 重录和批准；V2 批准事务结束时 Task 为 `enabled`，发布指针切到 V2。
- 随后的最终 UI 刷新验收又创建了一个空的下一版 Draft。当前 fixture 中该 Task 因此为 `draft`、revision 9，但 `published_version_id` 仍稳定指向 V2，V1/V2 Version 都未变化。这是“误建修订后缺少取消/丢弃入口”的现成证据，不应直接改 SQLite 恢复状态。
- V2 编辑、首次待审、驳回和第二次待审期间，发布指针始终指向 V1。V1/V2 步骤 SHA-256 分别为 `215cb41d4c906b7ffb46b6d686a95853812e9740b7202f934a1851d66f359ba2` 与 `1473061f46b049c823c6c09e986b2527eafbc3fc18dc3bd4d186f623bb10073b`；V1 未被修改。
- 审核顺序为 V1 批准、V2 驳回、V2 批准；驳回备注和最终批准备注均可在详情查看。有关联 Task 的非默认 Profile 删除后确认框关闭、Profile/Task 保留并显示可行动提示；URL 命中与未命中搜索均通过。
- 截图位于 `acceptance/01-browser-initial.png`、`02-v2-rejected-detail.png`、`03-v2-approved-detail.png`、`04-final-direct-return-refresh.png`。1424x861 的 DOM 指标始终为 `scrollWidth=clientWidth`、`scrollHeight=clientHeight`，未发现重叠、截断或页面级溢出。

### 当前运行实例

- 最终源码实例：Electron PID `23536`、managed Runtime PID `22000`、Electron CDP `127.0.0.1:9342`、Install ID `p13-v2-20260806-101617`。
- Pipe `runtime.healthcheck` 返回 `ok: true`、`inFlightRuns: 0`；`desktop-final.stderr.log` 只有 DevTools 监听信息。实例保持运行供手测。
- 本轮未生成 installer、portable 或 release artifact，未提交、未推送。

### 下一任务

1. P1.3 后续：步骤编辑、固定值/运行变量/秘密引用绑定和已发布 WorkflowVersion 的确定性回放。
2. 在后续设计中明确误建 V2 Draft 的取消/丢弃、任务归档或删除、Profile 重绑与历史版本查看；同时评估任务列表逐项 get 的 N+1 成本。
3. P1.4 再实现运行历史、逐步日志/截图、失败定位和登录 handoff；P1.5 实现手动启停定时任务。
