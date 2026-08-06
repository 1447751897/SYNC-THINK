## Resume checkpoint（2026-08-05 17:44 · Browser Automation Studio P1.1 最终收口）

- 当前分支 `feature/newmax-shell-rewrite`，P1.1 改动仍在未提交工作树；不要 reset、clean、覆盖式 checkout 或全仓格式化。
- Runtime Profile 是唯一真源。Browser 页面已支持 Profile 创建、重命名、非默认删除、脱敏站点会话清单、实时刷新、按站点清除和清除后 SQLite 摘要同步。
- Profile 站点摘要只保存域名、状态、计数和时间戳；Cookie 名值、Token、LocalStorage/IndexedDB 正文留在 Runtime 的 `browser-profiles/<profileId>`，不进入 Renderer、日志或审计投影。
- 占用栅栏覆盖 Run、handoff、Page lease 和 lease 释放排空窗口；占用时 UI 与 Runtime 都拒绝刷新/清除/删除。默认 Profile 永久保留。
- `RuntimeBrowserProfileService.listSiteSessions({ refresh: true })` 在调用 BrowserHost 前再次检查 command/lease，占用时返回 `browser.profile_in_use`，不要移除这层 Runtime 守卫。
- Edge 143 兼容性要求：Storage 查询/清除必须使用 Page target CDP Session；没有 Page 时由维护服务创建并关闭临时 Page。Profile 刷新、清除、删除 IPC 使用 30 秒预算，普通 healthcheck 仍为 5 秒。
- BrowserHost origin inventory 最多 512 条，由 Runtime 已知 origin、当前 Page 和 Cookie domain 派生；registrable domain 使用 `tldts@6.1.86`。裸 IPv6 站点键（如 `::1`）与 URL 方括号主机名都必须可清除；CDP 建连失败时临时 Page 必须回收。
- 最新源码实例：Electron `43956`、Runtime `37228`、CDP `127.0.0.1:9333`，Pipe healthcheck 正常。证据目录 `.data/local-restart-20260805-125346-browser-profile`，最终截图 `profile-final-after-clear.png`；实窗刷新/清除后 UI 与 SQLite 均为空，测试专用 Edge 已关闭。
- 最终门禁：Storage 36 files / 380 tests、Workers 15 files / 117 passed / 3 skipped、Runtime 70 files / 464 tests、Desktop 131 files / 868 tests；typecheck 20/20、lint 11/11、design tokens、强制 build 11/11（0 cached）、Prettier 与 `git diff --check` 全部通过。
- 根测试在默认并发和全仓串行下会偶发既有 Workers/MCP、Runtime lease 时间或 Desktop updater watchdog 时序失败；对应包级受控复跑和失败文件单独复跑通过，P1.1 代码未触碰这些测试路径。
- 下一任务是 P1.2：语义动作录制、实时步骤流和停止后的资源清理；不要提前把 Workflow 回放或定时任务标为已完成。

## Resume checkpoint（2026-08-04 · 内部无签名闭测链全绿）

- 分支 `feature/newmax-shell-rewrite`，HEAD `5cc35a1`；累计改动仍在未提交工作树，禁止 reset、clean、覆盖式 checkout 和全仓格式化。
- 标准 `pnpm test:update-install:win` 已从源码重建并通过真实 `0.0.1 -> 0.0.2`，证据为 `.data/update-install-e2e-20260804T064953/smoke-result.json`。7 次 Range 全为 206，只传输 `556013 / 130425065` bytes，自动拉起和身份/密钥/SQLite 连续性通过。
- watchdog 使用隐藏 detached `cmd.exe` 托管 PowerShell 5.1；安装只在 ready marker 出现后继续，relaunch fence 与 installer-exit fallback 防止目标版本无人拉起。正式签名规则保持 fail-closed，unsigned 只允许显式 fixture。
- 清理合同要求安装目录和对应卸载注册表键同时消失；最新运行的相关进程、handoff、native cache backup 均为 0。
- 默认内部 installer：`apps/desktop/release/installer/SYNC-THINK-Setup-0.0.1-x64.exe`，`130425094` bytes，SHA-256 `9154fca844eb8855453f549998cb23dd005ce769051a40b96f72d9a542bf83fe`，schema v3 `unsigned-fixture`。
- 最终门禁：根 test/typecheck/lint/build 全绿，portable 14/14，Phase 3 release/visual 41/41，`selftest:phase3` 9 步通过。当前只剩正式证书/timestamp、正式签名 rollback、真实 private feed/图片 Provider 与邀请用户反馈。

## Resume checkpoint（2026-08-03 · Phase 3 本地收口复核）

- 分支：`feature/newmax-shell-rewrite`；HEAD `5cc35a1` 与远端跟踪分支一致，相对 `origin/main` 领先 16 个提交；本轮修复仍位于未提交工作树。
- packaged identity 锁现在覆盖完整异步创建/secret-store 落盘窗口，并发首次启动回归 8/8；Desktop 全量恢复为 127 files / 849 tests。
- 全仓并发门禁已稳定：Desktop 使用 15 秒测试框架预算，Desktop Host 正常路径使用 10 秒 capability 预算，Runtime 260-frame bounded replay 保持零节拍；根 `pnpm test` 为 20/20 Turbo tasks。
- portable production payload 已移除 Tailwind build-only 依赖并增加 verifier fence；production packages 从 294 降为 262，现代 injected pnpm deploy 连续通过。
- update-feed 自检已自包含：`pnpm test:update-feed:win` 从根构建开始准备 unsigned portable + schema v3 installer；`pnpm test:update-feed:prepared:win` 只复用已验证 fixture。缺失/legacy/篡改/签名模式错误均有稳定 preflight。
- `pnpm selftest:phase3` 完整 9 步通过：Desktop 12 files / 87 tests、release/visual 33 tests、Generic feed 9/9、Electron HTTPS 8 场景、image provider build、无凭证显式 skip 和 7-case 视觉抓取；状态为 `passed-with-external-evidence-pending`。
- 最终冻结安装通过；Turbo 强制测试 20/20 tasks、0 cached，typecheck 20/20、build 11/11、lint 11/11 与 `git diff --check` 均通过。
- 自动 binary rollback 的 recovery store、coordinator、PowerShell watchdog、NSIS installer 自归档和 Runtime hello health marker 已在本地实现；正式签名 installer 的故障注入 rollback E2E 仍待外部发布证据。
- 后续只剩正式证书/timestamp、正式签名升级/rollback、真实 private feed/CDN、真实图片 Provider 凭证与 5-20 位邀请用户闭测。

以下 2026-08-02 checkpoint 保留为历史交接证据。

## Resume checkpoint（2026-08-02 · 全部本地工程任务收口）

- 分支：`feature/newmax-shell-rewrite`；累计修改仍位于同一未提交工作树。禁止 reset、clean、覆盖式 checkout 和全仓格式化。
- Windows 发布链：portable/installer 22 tests、Generic feed 9 tests 与真实 Electron HTTPS 8 场景通过；正式 signing/timestamp 保持 fail-closed，unsigned fixture 必须显式选择。
- Differential install：`pnpm test:update-install:win` 已通过；`.data/update-install-e2e-20260802T174113/smoke-result.json` 记录 `0.0.1 → 0.0.2`、2 个 blockmap 请求、7 个 Range/HTTP 206、完整包 `135491101` bytes、传输 `504941` bytes、节省 `134986160` bytes、无完整下载回退，以及 Runtime/identity/SQLite 连续性。
- Database Governance P0.4：sidecar/backfill/recovery/rollback/GC、Event retention/archive、incremental vacuum 与 offline `VACUUM INTO` compaction 完成；5 files / 51 tests 通过；治理执行器不接 Runtime startup。
- 最终门禁：`pnpm selftest:phase3` 为 `passed-with-external-evidence-pending`；Desktop contracts 12/86、release/visual 29、Generic feed E2E、image provider build 和 7-case Electron 截图通过；根仓 test/typecheck/build/lint 分别 20/20、20/20、11/11、11/11，`git diff --check` 通过。
- 最终人工测试实例：`D:\projects\SYNC-THINK\.data\manual-phase3-20260802-015614`；launcher `102824`、Electron `9296`、Runtime `50712`；窗口可见且响应，pipe/database/hello 正常，stderr 为空。
- 隔离数据库：`D:\projects\SYNC-THINK\.data\manual-phase3-20260802-015614\sync-think.db`。配置的 legacy key 路径为同目录 `secure.key`；当前 Windows DPAPI 空白身份未写 Provider secret，因此文件尚未生成。
- 默认真实数据库 `D:\projects\SYNC-THINK\.data\SYNC-THINK\sync-think.db` 保持 `16873340928` bytes 与原 UTC 修改时间，未触碰。
- 后续仅剩外部条件：正式证书/timestamp、正式签名真实升级与自动 rollback E2E、真实 private feed/CDN 演练、真实图片 Provider 凭证验收、5–20 位邀请用户闭测。
- 工作树状态：**未提交、未推送**。

## 2026-08-01 Image P0.3 第一切片交接

### 已完成

1. 图片生成配置严格限定为 size `auto / 1024x1024 / 1024x1536 / 1536x1024`、quality `auto / low / medium / high`、count 整数 `1-4`。
2. 配置已贯通 Plan revision、Desktop IPC、SQLite migration `0033_image_generation_config`、approved/rework Step、Runtime 和 Images Adapter；merge Step 禁止图片配置。
3. legacy `NULL` 或未配置 Step 使用 `auto / auto / 1`。Storage decoder、SQLite CHECK、IPC 与 Adapter 网络前守卫共同拒绝非法值和额外字段。
4. count 大于 1 时，每张图片分别落盘并创建独立 candidate ArtifactVersion；metadata 包含 imageSize、imageQuality、requestedImageCount、imageCount 与 imageIndex。
5. completed reservation replay 不重复调用 Provider 或 GeneratedImageStore；SQLite 不保存 API key、base64、完整 prompt 或 Provider 原始响应。
6. Plan 编辑器已提供图片生成开关、尺寸、质量和候选数量；execution 切换为 merge 时删除配置，read-only/busy 状态禁用控件。

### 当前验证

- Storage：24 文件 / 263 项通过。
- Desktop：109 文件 / 766 项通过，含严格 IPC payload 13 项。
- UI Kit：21 文件 / 234 项通过，PlanRevisionPanel 7 项。
- Runtime：Production Executor 27 项通过；全量并发中的既有 MCP 子进程退出检测曾抖动一次，单独重跑通过。
- 根仓 test 20/20 tasks、typecheck 20/20、lint 11/11、design tokens、build 11/11 与 diff check 已通过。首次根仓并发测试中 Storage 进程异常退出；Storage 单独 263 项通过后，根仓完整复跑通过。
- 已用独立数据库隐藏控制台重启：Electron PID `64660` 可见且响应；managed Runtime PID `77124` 使用 Node `20.20.2`，pipe/database/hello 正常、stderr 为空。数据库：`D:\tmp\sync-think-image-p03-20260801-191713\sync-think.db`；日志：`D:\tmp\sync-think-image-p03-restart-20260801-191713`。

### 人工验收

1. 新建或打开 collaboration 任务并创建 Plan。
2. 在 execution Step 启用图片生成，确认默认值是 `auto / auto / 1`。
3. 修改为 `1024x1536 / high / 3`，保存新版本并重新打开，确认配置仍然存在。
4. 把该 Step 切换为 merge，确认图片配置消失；再切回 execution 并启用，确认重新从默认值初始化。
5. 审批 Plan 后执行，确认 Provider 请求使用冻结参数，并形成 3 个 candidate ArtifactVersion；在产物与执行图中检查 3 张图片。
6. 重启后返回同一 Run，确认 completed reservation 直接恢复结果，没有重复生成图片。

### 下一任务：Image P0.3 第二切片

1. 为同一 Step 的多个 candidate 提供并列比较视图。
2. 支持用户选择一个 candidate 成为 selected，同时保留其余候选和可检查 metadata。
3. 保持选择操作 durable、可恢复且不触发 Provider 重放。
4. 后续再接视觉 Reviewer 评分/反馈与有界返工。

## 2026-08-01 Image P0.2 交接

### 已完成

1. Main 使用随机不透明 token 为受控图片 Artifact 签发 `sync-think-image://artifact/<token>` preview grant；Renderer 永不接触本地 `contentRef`。
2. 注册与读取均校验 generated-images 根目录 realpath、扩展名、MIME、魔数、25 MiB 上限和 SHA-256；token 默认 5 分钟 TTL、256 项容量，并使用 `no-store/nosniff`。
3. Preload/Renderer 已接入严格 preview IPC。Artifact 版本卡显示 loading/error/图片、MIME、字节与自然尺寸；Execution Graph 在对应 Step 显示最新 ready candidate 缩略图。
4. Task/Run 切换复用 generation gate，旧列表或 preview 响应不会覆盖当前作用域；冷重启后由 Renderer 重新请求 grant。
5. 根仓 test/typecheck/lint/tokens/build/diff 门禁通过；未接触原 16.8 GB 开发数据库。
6. 隐藏控制台重启验收通过：Electron PID `91032` 可见且响应；managed Runtime PID `55316` 使用 Node `20.20.2`，pipe/database/hello 正常且 stderr 为空。独立数据库：`D:\tmp\sync-think-image-p02-20260801-182547\sync-think.db`；日志：`D:\tmp\sync-think-image-p02-restart-20260801-182547`。当前 Electron 窗口保留供人工测试。

### 人工验收

1. 打开包含 image ArtifactVersion 的 Task/Run，进入右侧 **产物**：应先出现加载态，再显示图片、MIME、字节和尺寸，candidate/selected 状态仍可见。
2. 切换到 **执行图**：产出图片的 Step 应显示同一版本缩略图、版本号、MIME 与状态。
3. 快速切换 Task/Run 再返回：当前任务不应被前一个任务的延迟图片响应覆盖。
4. 冷重启后重新进入该 Task：图片应通过新 grant 再次加载，界面与错误中均不出现本地文件路径。

### 下一任务：Image P0.3

1. 将 size/quality/count 作为严格结构化 Step 配置接入 Images Adapter；保持 count 有界。
2. 引入视觉 Reviewer 与可检查评分/反馈，不复用文本 Reviewer 的假设。
3. 支持多候选比较、选择和有界返工，确保 Provider 调用与 ArtifactVersion replay 继续幂等。

## 2026-08-01 Run fallback fence 交接

### 已完成

1. `DemoRunState.attemptedModelIds` 成为每个 Run 的 durable 已尝试模型真源，创建、rebind、serialize/parse 全链路保持有序去重。
2. Provider priority fallback 与 Agent fallback 共用该集合；已失败模型不再被跨层重新选择，候选耗尽后进入 `paused / fallback_exhausted`。
3. 旧 checkpoint 没有 `attemptedModelIds` 时，以当前 `modelId` 初始化，避免升级后立即回到当前失败模型。
4. 新增 `alpha → beta → gamma → alpha` 回归，断言每个模型最多调用一次、最终暂停并停止新增 fallback transition。
5. 自动门禁已通过：Runtime 62 文件 / 408 项、Core 17 文件 / 167 项、Desktop 107 文件 / 750 项、根仓串行 20/20 tasks、typecheck、lint、design tokens、build 和 diff check。

### 数据与启动边界

- `D:\projects\SYNC-THINK\.data\SYNC-THINK\sync-think.db` 约 16.8 GB，保留原状；不要删除、覆盖、迁移或把它用于本轮启动验收。
- 后续数据库修复必须单独执行：先额外备份，再精确识别 runaway Run，事务删除异常记录，使用 `VACUUM INTO` 生成新文件，核验引用后人工切换。
- 当前工作树包含累计 Browser/Desktop/UIA/Image/fallback 修改，不要 reset/clean、checkout 覆盖、全仓格式化，也不要自动 stage/commit/push。
- 本轮隐藏启动已通过：launcher PID `89944`、Electron PID `98252`、managed Runtime PID `83416`；Runtime Node `20.20.2`，pipe/database/hello 正常，stderr 为空。独立 DB：`D:\tmp\sync-think-fallback-fence-20260801-173753\sync-think.db`；日志：`D:\tmp\sync-think-restart-20260801-173753`。保留当前 Electron 窗口供人工测试。

### 下一任务：Image P0.2

1. Renderer 增加图片 Artifact 卡片与候选/成功/失败状态。
2. 复用 `sync-think-image://`，只预览 Runtime-owned、已校验的本地产物。
3. 补 Main/Preload/Renderer 协议测试与真实 Electron 窗口验收。

## 2026-08-01 Image P0.1 交接

### 已完成

1. `openai-images` 使用专用 typed `generateImages()`，不复用文本 Conversation `call()`。
2. Provider base64 只在 Adapter/Executor 当前调用作用域存在；Runtime 校验后写入 `<runtime-data>/artifacts/generated-images`，SQLite 仅持久化 `contentRef/contentHash/mimeType/byteLength`。
3. Production execution reservation 已覆盖图片结果；completed reservation 可在重启后直接 replay，不重复读取凭证、不重复请求 Provider、不重复落盘。
4. Scheduler 已将图片结果物化为 `ArtifactVersion(candidate)`。首切片固定 `count = 1`，prompt 由 Step title + instructions 组成。
5. Images Step 当前跳过文本 Reviewer/Rework；仅 URL 响应被拒绝，避免把外部短期链接当 durable Artifact。

### 下一任务：Image P0.2

1. 在 Renderer 增加图片 Artifact 卡片，显示生成中、成功、失败和候选状态。
2. 复用现有 `sync-think-image://` 安全协议读取 Runtime-owned 文件，不向 Renderer 暴露任意本地文件读取能力。
3. 在任务/Run 过程视图展示 `ArtifactVersion` 图片预览、MIME、尺寸/字节和版本状态，并提供可检查的错误态。
4. 为 Renderer、Main/Preload 协议和真实 Electron 窗口补齐测试；完成后隐藏控制台重启 Desktop/managed Runtime 供人工验收。
5. P0.2 完成后进入 P0.3：结构化 size/quality/count、视觉 Reviewer、多候选比较和有界返工。

### 验证与人工测试边界

- 自动门禁：根仓串行测试 20/20 tasks；Runtime 61 文件 / 405 项；Desktop 107 文件 / 750 项；typecheck、lint、design tokens、build 通过。
- 当前 UI 尚无专用生成图画廊；若已有 Production Run 编辑入口，可把 Step 绑定到 `openai-images` 模型并以 instructions 作为提示词，执行后检查 Runtime 数据目录和 SQLite candidate ArtifactVersion。
- 完整的可视化点选验收应在 P0.2 完成后进行。

## Resume checkpoint (2026-08-01 — DesktopWorker P0.10 / P0 handoff E2E complete)

- Branch: `feature/newmax-shell-rewrite`; Browser、Desktop UIA P0.1-P0.10、Runtime/Renderer、WPF fixture 和文档改动仍位于同一未提交工作树。不要 clean、reset、checkout 覆盖或全仓格式化。
- Formal acceptance command: `pnpm selftest:desktop-handoff`. It runs isolated Continue and Cancel scenarios; `node scripts/selftest-desktop-handoff-e2e.mjs continue|cancel|all` is also supported.
- The command switches to managed Node 20, builds the repository WPF fixture into a temporary artifacts directory, isolates SQLite/secure key/LOCALAPPDATA/Electron user data/workspace/state/screenshots, and drives the real chat UI plus local OpenAI-compatible Provider.
- The real tool chain is `desktop_list_windows → desktop_inspect_window → desktop_resolve_selector → desktop_set_value`; SetValue targets `automationId=InputText, controlType=Edit` and uses real UIA `ValuePattern.SetValue`.
- The fixture blocks inside its TextChanged mutation handler. A User32 Shift key event changes `GetLastInputInfo`, aborting the mutating Worker/Host and persisting `waiting_user / desktop.user-input-detected`.
- After a full Desktop/managed Runtime cold restart, the Renderer restores the durable waiting card from SQLite. Continue ends as `completed / user-confirmed`; Cancel ends as `failed / desktop.command-cancelled / acceptance`.
- Both paths assert fixture `invocationCount=1` and `completedCount=1`; neither the original UIA SetValue nor Provider requests replay across restart or resolution.
- Selector trust remains Runtime-local. A new Controller on the same SQLite does not inherit the old resolve cache; an old mutating target is sensitive/approval-required again, and no command is reserved before approval.
- Safe projection remains mandatory for started/waiting events and cards: no input value, nativeWindowHandle, snapshot/accessibility revision, elementIndex, targetIdentity, or ownerId.
- Verification baseline: Desktop handoff E2E 2/2; Workers 100 passed / 3 skipped; Runtime 60 files / 398 tests; Desktop 107 files / 750 tests; root serial tests 20/20; typecheck, lint, root build 11/11, WPF Release build, and `git diff --check` passed.
- Hidden-console restart passed at `D:\tmp\sync-think-restart-20260801-162722`: Electron `SYNC-THINK` is visible/responding; managed Runtime uses Node 20.20.2; pipe/database/hello are healthy; stderr is empty.
- DesktopWorker P0 is complete. Await manual acceptance; the next Phase 3 development item is the image-generation pipeline and visual-review loop.

## Resume checkpoint (2026-08-01 — DesktopWorker P0.9 action-risk approval complete)

- Branch: `feature/newmax-shell-rewrite`; Browser、Desktop UIA P0.1-P0.9、Runtime/Renderer 和文档改动仍位于同一未提交工作树。不要 clean、reset、checkout 覆盖或全仓格式化。
- Risk levels are `observe` / `display` / `sensitive` / `human-only` / `prohibited`. Final policy: observe auto-runs in every mode; display requires approval only in ask; sensitive and human-only require approval in ask/workspace/full-access; prohibited is always blocked.
- `full-access` only skips approval for an ordinary display action whose target was resolved and trusted in the current Runtime process. It does not bypass sensitive/human-only, and it does not enable the Computer Use plugin.
- Successful `desktop_resolve_selector` calls populate a Runtime-only, maximum-512 metadata cache from `DesktopElementTarget` to `DesktopElementSnapshot`. This cache is intentionally short-lived and disappears on Runtime cold restart; unresolved invoke/set-value therefore remains sensitive.
- UIA `CurrentIsPassword` is part of the element snapshot and accessibility revision. Password read/set-value is `human-only / access-or-create-secret`; delete/payment/publish/external-send/permission-change/out-of-scope-export semantics map to corresponding human-only actions.
- `RuntimeDesktopController` re-checks risk and approval before durable reserve and Worker execution. Missing approval produces an approval request only; deny leaves Worker calls and desktop command rows unchanged.
- Approval and command lifecycle payloads are safe projections. Do not add plaintext value, valueDigest, nativeWindowHandle, snapshot/accessibility revision, elementIndex, targetIdentity, or ownerId.
- Verification baseline: Runtime targeted 4 files / 72 tests; Workers targeted 2 files / 18 tests; Workers full 100 passed / 3 skipped; Runtime full and Desktop 107 files / 750 tests passed; root serial full test 20/20 tasks, typecheck, lint, root build 11/11, and `git diff --check` passed. Hidden-console restart log: `D:\tmp\sync-think-restart-20260801-153021`; managed Runtime pipe/database/hello healthy, stderr empty, Electron responsive.
- **Next implementation task:** real WPF fixture + user-input interruption + Runtime/Desktop cold restart + waiting-card restoration + Continue/Cancel E2E. Re-resolve selectors after every Runtime cold restart.

## Resume checkpoint (2026-08-01 — DesktopWorker P0.8 waiting_user resolution complete)

- Branch: `feature/newmax-shell-rewrite`; Browser、Desktop UIA P0.1-P0.8、Runtime/Renderer 和文档改动仍位于同一未提交工作树。不要 clean、reset、checkout 覆盖或全仓格式化。
- P0.7 的持久等待查询和安全卡片仍是真源入口；P0.8 新增 `desktop.command.continue` / `desktop.command.cancel`，并加入 Protocol Feature negotiation、Runtime 路由、Desktop IPC 与 Renderer 操作按钮。
- Continue 语义固定为“用户已人工处理”：`waiting_user → completed`，结果为 `resolution: user-confirmed`；它不重新调用 Desktop Worker，不重放原 UIA 动作，也不恢复原始敏感参数。
- Cancel 语义固定为终结等待：`waiting_user → failed`，错误 `desktop.command-cancelled`，`failureClass: acceptance`。
- 两种请求都携带卡片的 `updatedAt` 作为 `expectedUpdatedAt`。记录已变化时返回 `desktop.command-conflict`；正确请求可幂等重放，Storage 保证新 `updatedAt` 单调增长。
- Renderer 提交期间同时锁定 Continue/Cancel；成功与失败后都重新查询 durable waiting list。`desktop.command.waiting_user/continued/cancelled` 事件只触发重查，不能直接作为界面真源。
- Lifecycle 与 waiting summary 仍使用脱敏投影：不得加入 value、digest、nativeWindowHandle、targetIdentity、ownerId、snapshot/accessibility revision 或 elementIndex。
- Verification baseline: Storage、Protocol、Runtime、Desktop 全量测试通过（Desktop 107 files / 750 tests）；Shared/Protocol/Storage build、Runtime/Desktop typecheck 和 lint 通过；root build 11/11、`git diff --check` 通过。隐藏控制台重启日志：`D:\tmp\sync-think-restart-20260801-143907`，pipe/database/hello 正常、两侧 stderr 为空、Electron 窗口可响应。
- **Next implementation task:** Desktop action risk classification/approval policy；随后用真实 WPF fixture 完成用户输入中断、Runtime/Desktop 冷重启、Continue/Cancel 的人工接管 E2E。P0.8 仍不是完整 DesktopWorker P0 收口。

## Resume checkpoint (2026-07-31 — DesktopWorker P0.6 durable command/input fence complete)

- Branch: `feature/newmax-shell-rewrite`; Browser P0.4/P0.5、Desktop UIA P0.1-P0.6、Runtime/Renderer 与文档改动都仍在同一未提交工作树。不要 clean、reset、checkout 覆盖或全仓格式化。
- Architecture remains: optional Computer Use plugin → Runtime Desktop controller → `IsolatedDesktopWorker` → short-lived Desktop Host → Windows UIA COM. Plugin disable still means no schema/prompt/command reserve/Worker/User32 reader/Host.
- New durable boundary: migration `0031_desktop_command` and `SqliteDesktopStore` reserve command/intent before side effects. Completed commands replay stored results; failed commands do not auto-retry; unknown in-flight commands recover as `waiting_user` + `desktop.command-inspection-required`.
- New user-input fence: mutating focus/invoke/set-value actions sample and poll read-only User32 `GetLastInputInfo`; a changed tick aborts the Worker/Host and persists `waiting_user` + `desktop.user-input-detected`. Observation/read actions do not start this monitor.
- UIA COM isolation is unchanged. User32 is a narrow read-only Runtime/Workers boundary for human-input detection only; it never simulates input. Monitor unavailability fails closed with `desktop.input-monitor-unavailable`.
- `desktop_set_value` persists only value length + SHA-256 digest; plaintext remains in memory and travels through Host stdin, never argv or durable event payloads.
- Verification baseline: Storage migration/store 55 passed; Workers Desktop targeted 30 passed; Runtime Desktop/chat targeted 62 passed; Shared/Storage/Workers/Runtime/Desktop typecheck, Shared/Storage/Workers/Runtime lint, Runtime/Desktop build, and diff checks passed.
- **Next implementation task:** expose persisted `waiting_user` through Runtime/Desktop/Renderer with Continue/Cancel, then add sensitive/high-risk action classification and a real WPF fixture handoff acceptance loop. P0.6 is not yet the complete human-handoff UI.

## Resume checkpoint (2026-07-31 — Browser Worker P0/P0.5 complete)

- Branch: `feature/newmax-shell-rewrite`; the complete P0.4/P0.5 implementation and BrowserHost restart-recovery work remain uncommitted. Do not clean, reset, or overwrite the working tree.
- Formal acceptance command: `pnpm selftest:browser-handoff` (or `node scripts/selftest-browser-handoff-e2e.mjs all`). It runs isolated Continue, Cancel close-page, and Cancel keep-open scenarios against a scripted local Provider and an installed system Edge/Chrome.
- All three scenarios passed across real Desktop/Runtime cold restarts. The same browser target survives while waiting; the durable card returns after restart; the Provider's first turn and `browser_open` are not replayed; Continue completes the same checkpoint; both Cancel modes fail the Run/Step with `browser.handoff-cancelled`.
- Final lifecycle is verified: close-page closes immediately, keep-open remains visible while the second Desktop is alive, and every resolved scenario closes CDP/browser plus Profile metadata when Desktop finally exits.
- `cancel-keep-open` required one final production fix: every Cancel with a persisted lease now recovers and validates the lease after cold restart, even when it will not be released immediately, so BrowserHost still owns final shutdown cleanup.
- Desktop now asks the managed Runtime to shut down over IPC and waits for Runtime cleanup before quitting. Timeout fallback terminates only Runtime; the detached system browser is preserved only for unresolved durable handoffs and is otherwise closed explicitly through CDP.
- Verification baseline: Browser handoff E2E 3/3; Workers 70 passed / 3 skipped; Desktop 721 passed; Runtime 369 passed; Protocol 53 passed; Storage 251 passed; Shared 21 passed; relevant build/typecheck/lint, Prettier, and `git diff --check` passed.
- Known non-blocking test noise: Playwright Electron's first `app.close()` can occasionally return Windows `0xC0000005`; recovery and final browser/metadata cleanup still pass.
- Roadmap state: Browser Worker P0.1-P0.5 is complete. The next Phase 3 item is Windows UI Automation Worker plus human-handoff fallback.

## Resume checkpoint (2026-07-27 — S5 cross-machine handoff)

- Branch: `feature/newmax-shell-rewrite`; pull the latest remote commit before continuing.
- S3 cursor replay/checkpoint tail recovery: complete.
- S4 run-local process projection: complete.
- S5 Runtime context status, six-section breakdown, 70% compact truth, ContextRing and browser-safe Protocol parser: implemented and all automated gates green.
- The ordinary model/no-bound-Agent crash is fixed by sharing `buildRunAgentInstructions`.
- **Blocking next task:** cache-miss `getOrBuildConversationContextSnapshot` still assembles simplified system/project/tools context instead of sharing the full real Provider request construction. Fix this with TDD before declaring S5 complete.
- Keep `ContextSnapshotBuilder` strict: do not weaken the “included source exists in Provider payload” invariant and do not rely on a `'You are'` sentinel.
- Electron was rebuilt and launched, but final ContextRing visual QA was interrupted by user Esc and remains pending.
- Current automated baseline: Runtime 52 files / 334 tests; Desktop 78 files / 579 tests; root test/typecheck 20/20 tasks; root build 11/11 tasks; `git diff --check` passed.
- Windows Runtime tests use `$env:TEMP='D:\tmp\sync-think-s4'; $env:TMP=$env:TEMP`.

## Resume checkpoint (2026-07-12)

- M1 Providers panel + secure store: done.
- Real OpenAI-compatible discovery: done (protocol-routed).
- Next: Agents binding / live call streaming / Manifest.
- Do not rework Workspace/Conversation shells.
- Observe: add real baseURL+key in Providers → expect non-fake model IDs.

# Handoff Guide

## 1. 必读顺序

新对话开始后，先完整读取：

1. `docs/superpowers/specs/2026-07-11-sync-think-product-design.md`
2. `docs/development/10-current-status.md`
3. `docs/development/11-implementation-plan.md`
4. `docs/development/03-feature-changelog.md`
5. `AI_DEVELOPMENT_RULES.md`

不要要求用户重新解释已锁定需求，不要初始化 Git。

## 2. 当前交接结论

M0 已关闭（2026-07-12）。M1 进行中：

- Workspace IA：已落地
- Conversation 完整历史 / 流式投影 / cancel：已落地
- **Providers / Credentials 注册 + SecureStore + Desktop 可观测面板：已落地**

已完成（Providers 切片）：

1. SqliteProviderStore + secure storeHandle（无明文 key）。
2. Runtime `provider.create|list|discoverModels|addModels`。
3. FakeProvider discovery（3 demo models）。
4. ui-kit ProvidersPanel + Desktop 左栏集成。
5. Trace：Provider 已添加 / 模型发现。

## 3. 下一任务

默认继续 M1 workstreams（implementation plan §4）：

1. Agents：绑定优先级 run > workflow > agent default > fallback。
2. 真实 OpenAI-compatible / Anthropic adapter（替换 demo discovery）。
3. Context Packet / Manifest 可检查。
4. Memory / Diagnostics。
5. 可选：native folder picker。

M1 非目标不得提前实现。

## 4. 环境陷阱

1. 原生 `better-sqlite3` 按项目 Node 20 ABI 构建。真实 Runtime 必须使用 Node 20。
2. 真实验收前必须重建相关包（尤其 `@sync-think/ui-kit`）。
3. 认证、协议和权限失败不得自动重试；只有 structured transient 失败可有限退避。
4. secrets、原始连接错误和 Event payload 不得进入 Renderer 或诊断日志。
5. Provider list 响应禁止携带 apiKey / storeHandle。
6. Workspace 命令依赖 `workspaceStore`；Provider 命令依赖 `providerStore + secureStore`。

## 5. 当前验证基线

```text
ui-kit：21/21
desktop：54/54
runtime：32/32
desktop/runtime typecheck：pass
M0：closed
M1：in progress (Providers panel observable; Agents/Manifest next)
```

## 6. 用户可观测验收（Providers）

1. 启动：`pnpm dev:runtime` + `pnpm dev:desktop`（或 `node scripts/dev-desktop.mjs`）。
2. 左栏底部 **Providers** → **添加**。
3. 名称：`Fake Gateway`；Base URL：`https://fake.example/v1`；协议：OpenAI Chat；Key：任意非空；勾选发现。
4. 保存后：状态条提示密钥入安全存储 + 发现模型；卡片显示 3 个 fake 模型；密钥掩码显示。
5. 右侧 Run trace 可见 Provider 已添加。

## 7. 当前清理基线

```text
临时 patch 脚本已删除
```

## Image P0.3 第二切片交接（2026-08-01）

- 同批候选通过临时 rtifactGroupKey 归入一个 Artifact，多张图片是多个 ArtifactVersion。
- 选择继续走 rtifact.selectVersion 与 rtifact_selection；刷新/冷启动后从 selectedVersionId 恢复。
- Renderer 只使用 imageGeneration 安全摘要和 opaque preview URL。
- 手测关注：三候选同时可见、选择后其余显示未采用、重启后选择保持、文本 Artifact 的 compare/merge 不回归。

## 2026-08-01 Agent Context / Team 交接

- 每个参与任务的 Agent 使用独立 `AgentContextThread`；同一 Agent 在其他任务中使用其他 Thread，不隐式共享完整对话正文。
- Reviewer 要求原 Agent 返工时，创建带 `parentEpochId` 的新 `ContextEpoch`，复用冻结任务目标、上一次产物与 Reviewer feedback，不重放无关历史。
- Provider usage 以请求/turn 为粒度关联 agentContextThreadId 与 contextEpochId，记录 prompt/cache read/cache write/reasoning/output/total token 投影；缓存 key 与 Provider 能力绑定，不把 secret 或完整 prompt 持久化到 UI 投影。

## 2026-08-02 Runtime sidecar allowlist 交接

### 已完成

1. `openPersistentRuntime()` 支持默认关闭的 `eventPayloadSidecar: { enabled: true }`。
2. 仅达到 64 KiB 的 `context.packet.built` 外置，并复用 `context-packet-query-v1@1`。
3. 默认路径绑定 database path/install ID；历史 inline 兼容，重启 hydrate，missing/corrupt blob fail-closed。
4. 主入口可用 `SYNC_THINK_EVENT_PAYLOAD_SIDECAR=1` 启用，并可用 `SYNC_THINK_EVENT_PAYLOAD_SIDECAR_ROOT` 覆盖根目录。
5. Runtime 全量 63 files / 436 tests 通过；本切片不提交、不推送。

### 下一任务

实现 retention/archive 离线治理：先 exact readonly manifest 和 portable archive/recovery set，再实现 durable executor、批次 cancel/resume、rollback 与 replay/projection consistency；只使用临时 fixture，不接 Runtime startup。

## Resume checkpoint（2026-08-05 19:35 · Browser Automation Studio P1.2 代码收口）

- 当前分支 `feature/newmax-shell-rewrite`、HEAD `9e5ee8d`；P1.1/P1.2 与此前累计改动仍在未提交工作树，禁止 reset、clean、覆盖式 checkout 或全仓格式化。
- P1.2 已实现 `browser.recording.{list,get,start,stop}`、迁移 `0037_browser_recording`、每 Profile 独占 recording lease、主 Frame 语义步骤、实时快照轮询、停止清理和冷启动 `interrupted` 恢复。
- 录制步骤只支持 `navigate/click/fill/select/check/Enter`；最多 200 步、单步 16 KiB。URL 去除 userinfo/query/hash，密码/OTP/支付/文件/contenteditable 保存秘密占位，binding 通过随机 capture token 与 trusted event 防伪造。
- start 请求发出即全局锁定 Profile 切换和维护；30 秒请求超时不会自动解锁，Renderer 会通过 `recording.list` 对账。仅 Runtime 明确返回无活动录制时解除，未知状态保持 fail-closed。
- Host acquireLease 被拒绝时只终结本次 intent，不关闭无关 Profile session；stop 失败会清理进程内去重句柄，允许同一 recording 重试且没有 unhandled rejection。
- 当前定向证据：Storage 3 files / 73 tests、Workers BrowserHost 33/33、Runtime Recording Service 7/7、Desktop 录制/接线 4 files / 38 tests；Workers/Runtime/Desktop typecheck 与 lint、design token、`git diff --check` 已通过。
- 尚未完成本轮包级全量、根级 typecheck/lint/token lint/强制 build 与最新源码实窗录制；这些是继续任务的直接下一步。不要生成 installer、提交或推送。
- P1.3 才负责把确认后的草稿冻结为 WorkflowVersion，增加固定值/运行变量/秘密引用、编辑、确定性回放、失败定位和登录 handoff；不要把当前录制草稿描述为可重复任务。

## Resume checkpoint（2026-08-05 21:00 · Browser Automation Studio P1.2 最终实窗收口）

- 当前分支 `feature/newmax-shell-rewrite`、HEAD `9e5ee8d`；累计改动继续保留在未提交工作树，不要 reset、clean、覆盖式 checkout、全仓格式化、打包、提交或推送。
- `RuntimeBrowserProfileService.listSiteSessions(refresh=true)` 必须在 `profileGate.runExclusive()` 释放后再生成 Profile summary。锁内生成会把本次刷新自身投影成 `inUse: true`，Renderer 随后会永久禁用刷新、清除、删除和再次录制。
- 外部 command、durable recording 与 Page lease 仍必须返回稳定错误码 `browser.profile_in_use`，不得为修复自身假锁而绕过这些门禁。
- DOM recorder 的文本 change 只排空仍存在的 debounce timer；Enter 已排空后，blur/change 不得重复记录 fill，否则后续 navigate 无法折叠进 press。select 的 trusted change 仍始终记录。
- 最终包级证据：Storage 36/384、Workers 15 files / 124 passed / 3 skipped、Runtime 74/477、Desktop 133/897；根 typecheck 20/20、lint 11/11、design tokens、强制 build 11/11（0 cached）、Prettier 与 `git diff --check` 通过。
- 根 `pnpm test --force --concurrency=1` 也以 20/20 Turbo tasks、0 cached 通过；保持受控串行可避免已知资源时序抖动。
- 最终实窗证据位于 `.data/local-restart-20260805-204946-browser-recording-final`。正常录制为 10 步且覆盖六类动作；站点刷新/清除后可再次录制；关页得到 `interrupted/page_closed`；Profile 删除后目录、metadata、Edge 进程、站点摘要和活动录制均为空，敏感值无 SQLite 命中。
- Electron `3452`、Runtime `33812`、CDP `127.0.0.1:9336` 保持运行；Pipe healthcheck 正常。一次性验收脚本必须使用 workspace managed Node `20.20.2`，以匹配 `better-sqlite3` 的 ABI；select 验收使用键盘事件，程序化 `selectOption()` 的非 trusted change 被安全边界拒绝是预期行为。
- 下一任务是 P1.3 WorkflowVersion、变量/秘密引用、编辑和确定性回放。运行历史、失败定位、登录 handoff 与定时任务分别留在 P1.4/P1.5。

## Resume checkpoint（2026-08-05 22:46 · Browser Automation Studio P1.3 第一切片最终收口）

- 当前分支 `feature/newmax-shell-rewrite`、HEAD `09b02ad`；累计未提交改动必须继续保留，禁止 reset、clean、覆盖式 checkout、全仓格式化、打包、提交或推送。
- 迁移 `0038_browser_automation_workflow` 与 `SqliteBrowserStore` 已实现 Task/Draft/Review/WorkflowVersion。Task 新建同时创建 Draft；submit 只接受 stopped、非空且 Profile 匹配的录制；reject 可重录；approve 发布递增且不可变的版本。
- Runtime 新增 `runtime-browser-workflow-service.ts` 和 `browser.workflow.{list,get,createDraft,submit,review}`；Desktop Main/Preload、`browser-workflow-payloads.ts`、`BrowserWorkflowPanel.tsx` 与 `BrowserStage.tsx` 已接线。
- Browser 页面默认“自动化任务”；列表支持搜索、手动/AI Draft、录制、提交、审核、驳回重录与查看发布版本。敏感输入保持占位，已发布版本不展示尚未实现的运行/调度按钮。
- 对话工具为 `browser_workflow_list/get/create_draft`。list/get 只读；create_draft 在 ask 模式走普通审批，在 workspace/full-access 直接创建，但强制 `source=ai` 且不提供 submit/review/publish 工具。
- BrowserHost 发现顺序为显式 executable、Chrome、Edge；录制 Page 右下角 closed Shadow DOM 浮层通过 `control-stop` binding 停止录制，浮层点击不进入步骤流。
- 当前只关闭 P1.3 的治理第一切片。固定值、运行变量、秘密引用编辑与确定性回放仍未完成；P1.4/P1.5 继续负责运行历史、失败定位、登录 handoff 与定时任务。
- 最终证据：Storage 36 files / 387 tests；Workers 15 files / 124 passed / 3 skipped；Runtime 76 files / 490 tests；Desktop 135 files / 915 tests；根 typecheck 20/20、lint 11/11、design tokens、强制 build 11/11（0 cached）与 `git diff --check` 通过。
- 最新源码已使用隔离目录 `.data/local-restart-20260805-224600-browser-workflow-p13` 启动：Electron PID `8144`、managed Runtime PID `102992`（Node `20.20.2`），窗口可见且响应；pipe/database/hello 与独立 healthcheck 正常，stderr 为空。未打包、未提交、未推送。
