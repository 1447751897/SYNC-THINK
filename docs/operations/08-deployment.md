# Windows Deployment

本文是 SYNC-THINK Windows 分发、签名、更新发布与故障恢复的运维基线。正式 release 默认执行 Authenticode 与 RFC 3161 timestamp 的 fail-closed 校验；未签名包只允许作为显式 `unsigned-fixture` 测试产物。NSIS differential package 已启用，installer manifest 与 Generic feed 同时记录 installer/blockmap 的字节数和摘要。

## 1. 当前发布基线

- 目标平台：Windows 11 x64。
- Desktop：Electron Windows distribution。
- Runtime：携带 production dependency tree。
- 托管 Node：workspace 固定版本 `20.20.2`。
- Native modules：至少包含 `better_sqlite3.node` 与 `koffi.node`。
- Portable 输出：`apps/desktop/release/win-unpacked`。
- Installer 输出：`apps/desktop/release/installer/SYNC-THINK-Setup-<version>-x64.exe`。
- Differential 元数据：与 installer 同名的 `.exe.blockmap`。
- Installer identity：`appId=com.syncthink.desktop`，per-user assisted NSIS。
- 用户状态保存在 Electron `userData` 下；升级不得删除 Install ID、safeStorage 密文或 SQLite 数据。
- Updater 只在 Main process 中运行，使用 Generic provider、显式下载/安装、HTTPS/Bearer、`allowDowngrade=false`、`disableWebInstaller=true`，并启用 differential download。

正式 installer 默认使用 `release` signing mode。证书和 timestamp server 未显式配置、签名无效或 timestamp 缺失时，构建或验证立即失败。`unsigned-fixture` 仅用于隔离测试与 **0.1.0-beta.1 公开无签名 Beta**；不得把它标成已签名正式包，也不得给它配置公开自动更新源。

## 2. Windows portable staging

完整 staging：

```powershell
pnpm release:stage:win
```

`release:stage:win` 的前置生命周期依次执行：

```text
pnpm build
pnpm release:assets:win
pnpm test:brand:win
pnpm test:release:win
```

staging 负责：

1. 从 Electron Windows distribution 生成受控 release 目录。
2. 将 `electron.exe` 重命名为 `SYNC-THINK.exe`，并用 `resedit` 写入 Windows icon group。
3. 收集 Desktop、Runtime 和 production dependencies；输出必须位于 `apps/desktop/release/<child>` fence 内。
4. 将 Runtime 写入 `resources/runtime`，入口为 `resources/runtime/main.js`。
5. 将完整托管 Node 20.20.2 目录写入 `resources/node`，至少包含 `node.exe` 与 `node_modules/npm/bin/npm-cli.js`；前者运行 Runtime，后者安装应用私有 Codex/Claude Code。
6. 生成 `resources/app-update.yml`：正式 `release` 精确记录 updater cache identity 与完整 `publisherName`；显式 `unsigned-fixture` 只记录 cache identity。两种模式都禁止 provider URL、Bearer token 或请求 header。
7. 生成 portable `release-manifest.json`。

关键输出：

```text
apps/desktop/release/win-unpacked/SYNC-THINK.exe
apps/desktop/release/win-unpacked/resources/app/dist/main/index.js
apps/desktop/release/win-unpacked/resources/runtime/main.js
apps/desktop/release/win-unpacked/resources/node/node.exe
apps/desktop/release/win-unpacked/resources/node/node_modules/npm/bin/npm-cli.js
apps/desktop/release/win-unpacked/resources/app-update.yml
apps/desktop/release/win-unpacked/release-manifest.json
```

## 3. Portable 验证

```powershell
pnpm release:assets:win
pnpm release:verify:assets:win
pnpm test:brand:win
pnpm release:verify:win
```

验证项包括：

- Desktop executable、main、preload、renderer、Runtime launcher、Runtime main、Node binary 与 npm CLI 均存在。
- `resources/app-update.yml` 必须与选定 signing mode 的期望内容字节级一致：正式 release 为 cache identity + 完整 publisher DN，unsigned fixture 仅为 cache identity；任何额外 provider、URL、Authorization 或 token 字段都失败。
- 托管 Node 为 20.x、npm CLI 可供应用私有内核更新使用，且 required native modules 存在。
- release 不包含 `.env*`、SQLite `.db/.db-*`、token、secret 或用户数据。
- `release-manifest.json` 的文件集合、字节数和 SHA-256 与磁盘一致。
- packaged PNG/ICO 与 executable icon group 一致。

所有 release 输出必须位于 `apps/desktop/release/<child>`。不得将 Desktop `dist`、workspace 根目录或其他任意路径作为清理目标；路径 fence 失败时返回 `release.output_unsafe`。

## 4. Portable smoke

smoke 必须使用独立 user data 和数据库路径，不复用真实用户目录：

```powershell
$smokeRoot = 'D:\tmp\sync-think-portable-smoke'
$env:LOCALAPPDATA = Join-Path $smokeRoot 'localappdata'
$env:SYNC_THINK_DB_PATH = Join-Path $smokeRoot 'runtime-data\sync-think.db'
$env:SYNC_THINK_CHAT_IMAGE_STAGING = Join-Path $smokeRoot 'chat-image-staging'
$env:SYNC_THINK_CHAT_MESSAGE_IMAGES = Join-Path $smokeRoot 'message-images'
$env:SYNC_THINK_INSTALL_ID = $null
$env:SYNC_THINK_PIPE_SECRET = $null
$env:SYNC_THINK_DEV_NO_TOKEN = $null

& '.\apps\desktop\release\win-unpacked\SYNC-THINK.exe' `
  --user-data-dir=(Join-Path $smokeRoot 'user-data')
```

验收：

1. `SYNC-THINK` 进程能正常启动。
2. Runtime entry 和托管 Node executable 均来自 packaged resources。
3. 日志出现 `pipe ready`、`database ready`、`hello accepted`。
4. 首次启动生成 Runtime identity metadata 和 safeStorage ciphertext。
5. 使用相同 `--user-data-dir` 重启后，Install ID、secret handle、metadata SHA-256 和 ciphertext SHA-256 保持不变。
6. diagnostics 只暴露 `pipeSecretConfigured: true` 等状态，不输出 secret 原文。

secret 仅由 Desktop Main 注入 managed Runtime，不进入 manifest、Renderer、命令行或 feed metadata。

### 4.1 私有 Vendor 内核验收

首次使用向导与关于页共用同一个应用私有安装服务。安装根位于 Runtime 数据库同级的 `kernels/versions`，不写系统 npm prefix。每次安装验证 package name、精确版本和预期 executable，最后原子切换 `kernels/active.json`；失败时保留上一 active 版本和本机/bundled 回退。

安装成功后 Main 向 Runtime 发送 `kernel.recycle`。Codex 空闲 resident app-server 立即回收，活跃实例等当前 turn 释放后回收；Claude 下一轮创建新 SDK adapter。验收必须在一个安装前已经存在的对话中继续发送消息，确认原生 thread/session ID 保持不变、执行版本切换到新私有版本。不得用“新建对话成功”替代该项。

## 5. Authenticode NSIS installer

### 5.1 正式 release

正式构建必须显式选择一个证书来源，并显式配置 RFC 3161 timestamp server：

```powershell
$env:SYNC_THINK_WINDOWS_SIGNING_MODE = 'release'
$env:SYNC_THINK_WINDOWS_PUBLISHER_NAME = 'CN=SYNC-THINK Software, O=YOUR ORGANIZATION, C=CN'
$env:SYNC_THINK_WINDOWS_EXPECTED_SIGNER_SHA1 = '<40-HEX-THUMBPRINT>'
$env:SYNC_THINK_WINDOWS_CERTIFICATE_SHA1 = '<40-HEX-THUMBPRINT>'
$env:SYNC_THINK_WINDOWS_RFC3161_TIMESTAMP_SERVER = 'https://TIMESTAMP_SERVER'
pnpm release:installer:win
pnpm release:verify:installer:win
```

证书来源必须且只能配置一个：

- `SYNC_THINK_WINDOWS_CERTIFICATE_SHA1`
- `SYNC_THINK_WINDOWS_CERTIFICATE_SUBJECT`
- `SYNC_THINK_WINDOWS_CERTIFICATE_FILE`
- `WIN_CSC_LINK` / `CSC_LINK`

PFX 密码通过 `WIN_CSC_KEY_PASSWORD` 或 `CSC_KEY_PASSWORD` 注入。密码、token 和证书内容不得写入 `electron-builder.json`、installer manifest、feed metadata 或日志。CLI 也可显式传入 `--signing-mode`、`--certificate-sha1`、`--certificate-subject`、`--certificate-file`、`--expected-signer-sha1`、`--publisher-name` 和 `--timestamp-server`。`SYNC_THINK_WINDOWS_CERTIFICATE_SHA1` 只负责构建时证书选择；`SYNC_THINK_WINDOWS_EXPECTED_SIGNER_SHA1` 与 `SYNC_THINK_WINDOWS_PUBLISHER_NAME` 是构建后和离线验证的独立 trust pin。

release 验证为 fail-closed：

- electron-builder 强制 code signing，签名哈希算法为 SHA-256。
- `Get-AuthenticodeSignature` 返回的 installer 状态必须为 `Valid`。
- 必须存在 signer certificate；SHA-1 必须与独立 expected signer pin 精确匹配，SignerCertificate.Subject 必须与完整 publisher DN 精确匹配，不接受 substring。
- 必须存在 `TimeStamperCertificate`，且 manifest 声明 timestamp required。
- manifest 中的签名投影必须与磁盘重新检查的结果一致。
- 证书源缺失、证书源冲突、timestamp server 缺失/非法、签名无效或 timestamp 缺失均中止发布。

### 5.2 显式 unsigned fixture

仅在隔离 smoke、synthetic fixture 或 CI 单元测试中使用：

```powershell
node scripts/windows-installer-release.mjs build `
  --signing-mode unsigned-fixture `
  --out apps/desktop/release/installer-fixture

node scripts/windows-installer-release.mjs verify `
  --allow-unsigned-fixture `
  --out apps/desktop/release/installer-fixture
```

schema v3 的 unsigned manifest 默认会被 verifier 拒绝，必须显式提供 `--allow-unsigned-fixture`。schema v2 仅保留 programmatic read compatibility；正式 build 和 CLI verify 均要求当前 schema v3。

### 5.3 Differential package 与 installer manifest

`apps/desktop/electron-builder.json` 设置 `nsis.differentialPackage=true`。每个 installer 必须有且只有一个配对 blockmap：

```text
SYNC-THINK-Setup-<version>-x64.exe
SYNC-THINK-Setup-<version>-x64.exe.blockmap
installer-manifest.json
```

installer manifest schema v3 记录：

- installer 与 blockmap 的相对路径、bytes、SHA-256。
- installer 的 Authenticode signer/timestamp 非秘密投影。
- signing mode、timestamp requirement、timestamp server、certificate source 类型和完整 publisherName 投影。
- portable 输入体积、installer + blockmap 总体积、压缩差值与构建时长。
- `differentialPackage: true` 以及 installer/blockmap 一一配对关系。

支持的 compression 为 `store`、`normal`、`maximum`，默认 `normal`。

## 6. Installer 与真实更新 continuity

installer 启动 smoke：

```powershell
pnpm release:smoke:installer:win
```

该 smoke 使用 `.data/installer-smoke-<guid>` 隔离根目录，验证安装、启动与 Runtime ready；不得指向真实用户的 `LOCALAPPDATA`、`userData` 或数据库。

真实 electron-updater `quitAndInstall()` differential continuity 已于 **2026-08-04** 通过正式组合入口复验：

```powershell
pnpm test:update-install:win
```

最新证据：

```text
D:\projects\MYSELF\SYNC-THINK\.data\update-install-e2e-20260804T064953\smoke-result.json
```

该证据确认：

- base `0.0.1` 只发出一次 install request，静默安装 `0.0.2`；package 与 Windows uninstall registry 版本均为 `0.0.2`。
- 升级后 managed Runtime 以 `0.0.2` 重启并 ready；Install ID、secret handle、identity metadata、ciphertext 与 SQLite 数据库保持连续。
- `latest.yml` 和两个 blockmap 使用 HTTPS + Bearer 返回 HTTP 200；installer 只发生 7 个 Range 请求并全部返回 HTTP 206。
- 完整 target installer 为 `130425065` bytes，实际 installer 响应为 `556013` bytes，节省 `129869052` bytes；没有观察到 installer HTTP 200 完整下载回退。
- 安装前当前版本保持可用，`automaticRollbackAttempted=false`。
- watchdog-ready、target relaunch、health marker 与 `healthy` outcome 已落盘；结束后安装目录、卸载注册表、相关进程、handoff 和 native updater cache backup 均为 0。

该证据中的目标版本正常启动，因此没有触发 automatic rollback。它使用显式 `unsigned-fixture`，用于证明真实 quit/install/restart、差分传输和本机连续性；它不替代正式证书、真实 RFC 3161 timestamp provider 或真实 private origin/CDN 验收。脚本只在一次性闭测机或可清理的隔离 Windows runner 上运行。

当前内部无签名闭测 installer：

```text
apps/desktop/release/installer/SYNC-THINK-Setup-0.0.1-x64.exe
bytes: 130425094
sha256: 9154fca844eb8855453f549998cb23dd005ce769051a40b96f72d9a542bf83fe
manifest: schemaVersion=3, signing.mode=unsigned-fixture
```

## 7. 升级期间的数据与版本语义

- 安装方式为 per-user，不执行 machine-wide 用户数据迁移。
- 保持相同 `appId`，从而保持 Electron `userData`、Install ID、safeStorage 与 SQLite 路径连续。
- 安装前不删除当前版本；下载或准备安装失败时，当前版本继续可用。
- `autoInstallOnAppQuit=false`，只有显式安装动作调用 `quitAndInstall()`。
- `quitAndInstall()` 前先验证并冻结上一 healthy installer，写入 durable rollback intent，并启动独立 watchdog；准备失败时不进入安装。
- Controller failure evidence 明确记录 `currentVersionPreserved: true` 与 `automaticRollbackAttempted: false`；watchdog 的真实结果单独写入 rollback outcome。
- 下载完成后若 `beforeInstall` 或安装准备失败，可从 error 状态重试同一已下载版本。
- 不在同一 user data 上并行运行 portable 与 installed app。

## 8. Private Generic feed 与 channel policy

运行时配置：

| 变量                          | 用途                    | 约束                                                                               |
| ----------------------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| `SYNC_THINK_UPDATE_FEED_URL`  | Generic provider 根 URL | 正式环境必须为 HTTPS；HTTP 仅允许 loopback；不得包含 credential、query 或 fragment |
| `SYNC_THINK_UPDATE_CHANNEL`   | channel，默认 `latest`  | 1-32 个受限字符                                                                    |
| `SYNC_THINK_UPDATE_TOKEN`     | 可选 Bearer token       | 只保存在 Main process；拒绝 CR/LF                                                  |
| `SYNC_THINK_UPDATE_ALLOW_DEV` | 本地 fixture 开关       | 仅显式 `1` 时允许 unpackaged fixture                                               |

发布 private channel 时要求 blockmap 和授权策略：

```js
await writeWindowsGenericUpdateFeed({
  outputDir: FEED_DIR,
  artifactPath: INSTALLER_PATH,
  blockmapPath: INSTALLER_PATH + '.blockmap',
  version: '0.0.2',
  channel: 'closed-beta',
  requireBlockmap: true,
  channelPolicy: {
    audience: 'private',
    requiresAuthorization: true,
    rolloutPercent: 10,
    minimumSupportedVersion: '0.0.1',
    allowedVersions: ['0.0.2'],
    withdrawnVersions: [],
  },
});
```

feed metadata 记录 installer 与 blockmap 的 bytes、SHA-512、SHA-256，并要求 blockmap URL 等于 installer URL 加 `.blockmap`。`private` audience 必须设置 `requiresAuthorization: true`。当前发布版本若在 `withdrawnVersions` 中，或不在非空 `allowedVersions` 中，生成和验证都会失败。

`rolloutPercent`、`minimumSupportedVersion`、`allowedVersions` 和 `withdrawnVersions` 是发布治理元数据。实际 cohort/授权 enforcement 由私有 feed 服务执行，静态文件本身不做按设备分流。

### 8.1 私有闭测顺序

1. 在受控 release runner 构建并验证 signed/timestamped installer 与 blockmap。
2. 将 installer、blockmap 和 channel metadata 上传到带 HTTPS + Bearer 的 private origin。
3. 由服务端按 Install ID allowlist 或稳定 cohort 执行 `rolloutPercent`。
4. 先做下载验证，再做真实 quit/install/restart，最后核对 app version、Runtime hello 与 identity continuity。
5. 保存 installer manifest、feed verifier 输出、smoke result 和脱敏 diagnostics；不保存 token、Authorization header、证书密码或真实 userData。
6. 观察启动失败率、更新失败率、签名/timestamp 失败和 hash mismatch 后再扩大 rollout。

专项门禁：

```powershell
pnpm test:update-feed:win
```

该命令先执行根构建、显式 `unsigned-fixture` portable staging 和 schema v3 NSIS installer build，再运行 Generic feed 单元测试和 Electron updater driver E2E。已有受验证 fixture 时可运行 `pnpm test:update-feed:prepared:win` 跳过重建。fixture server 仅监听 `127.0.0.1`，使用隔离 app/userData/cache，不访问真实用户数据。

### 8.2 撤回版本

1. 冻结 rollout，并保留当时的 installer、blockmap、manifest 和 feed metadata 作为诊断证据。
2. 将问题版本加入目标 channel 的 `withdrawnVersions`。
3. 将 channel 的 active version 指向上一个正常版本或新的修复版本；同步更新 `allowedVersions`。
4. 重新生成并运行 `verifyWindowsGenericUpdateFeed()`，确认当前 active version 未被撤回且所有 hash/size 匹配。
5. 原子发布新的 channel metadata，然后 purge/invalidate CDN metadata cache；installer 和 blockmap 应使用不可变版本化 URL。
6. 持续观察客户端 check/download/install 错误码和 recovery evidence。

`allowDowngrade=false`，因此撤回不会自动把已安装客户端降级。对已安装问题版本，应发布更高版本修复包；确需回到旧版本时，使用经验证的上一正常 installer 执行人工恢复。

## 9. Diagnostics / recovery runbook

### 9.1 证据位置与内容

Updater Controller 在内存保留最近 20 条失败证据；Electron driver 将同样的脱敏结构持久化到：

```text
<userData>/diagnostics/desktop-updater-recovery.json
```

写入采用串行队列、临时文件加 rename，最多保留 20 条。持久化失败不会覆盖原始 updater 错误，也不会阻断当前版本继续运行。

每条 evidence 包含：

- action 与 failed phase。
- current/available version、channel、稳定 error code、retryable。
- differential download、auto-install、downgrade 等 driver 状态。
- `currentVersionPreserved: true`。
- `automaticRollbackAttempted: false`。

证据不得包含 Bearer token、Authorization header、证书密码、pipe secret、带 credential/query 的 feed URL 或用户内容。

automatic rollback 使用独立、非 `userData` 的恢复根：

```text
%LOCALAPPDATA%\sync-think-updater\recovery
|- installers\<version>\installer.exe
|- healthy-releases\<version>.json
|- intents\<intentId>.json
|- health\<intentId>.json
|- attempts\<intentId>.json
|- outcomes\<intentId>.json
`- watchdog\update-rollback-watchdog.ps1
```

正式模式下 healthy installer 和 rollback 前复验都要求有效 Authenticode、RFC 3161 timestamp、bytes、SHA-512 与 signer thumbprint 一致。unsigned installer 仅在隔离 update fixture 显式开启。

### 9.2 故障处置

1. 不删除当前安装和 userData；先确认当前版本仍能启动。
2. 收集 installer manifest、feed metadata、installer/blockmap hash 与 recovery evidence。
3. 按 failed phase 区分 check、download、install/provider 失败，并记录稳定 error code。
4. 对 hash 或 blockmap mismatch，停止 rollout，验证 origin/CDN 内容并清理 updater cache 后重试。
5. 对已下载但安装准备失败的包，从 error 状态重试安装；不要重新覆盖 userData。
6. 对签名或 timestamp 错误，撤回 feed，重新签名并生成更高版本修复包。
7. 检查 recovery root 中 active intent、health marker、attempt fence 与 outcome；`rolled-back` 表示 watchdog 已调用上一 healthy installer，`rejected` 或 `rollback-failed` 需要人工介入。
8. 恢复后核对 app version、registry version、Runtime hello、Install ID、secret handle、metadata/ciphertext 和数据库存在性。

### 9.3 旧版本保留与恢复边界

- 在 `quitAndInstall()` 真正接管前，当前版本文件和 userData 保持可用。
- NSIS 安装成功时将产生该版本的 installer 原子归档；显式用户卸载会删除 recovery root，升级替换过程则保留。
- packaged Desktop 在 managed Runtime `hello` 成功后登记当前版本为 healthy，并为匹配 active intent 写入 target health marker。
- 安装前 coordinator 对上一 healthy installer 的路径、bytes、SHA-512、签名、timestamp 与 signer pin 重新校验，写入 intent 后启动独立 PowerShell watchdog。
- target 在 deadline 前产出匹配 intent/version 的 health marker 时 outcome 为 `healthy`；超时后 watchdog 先用 durable create-new attempt fence 阻止重复回滚，再复验上一 installer 并静默启动。
- 缺少上一 healthy installer 时记录 `unavailable`，不会伪装为已 armed；path/hash/signature/timestamp/signer 漂移会 fail-closed 并记录 `rejected`。
- 发布侧仍应同步撤回问题版本并发布更高版本修复包；自动回滚不是 feed 治理、诊断保留或人工恢复预案的替代品。
- 人工恢复必须使用已验证 installer，并在操作前保留 diagnostics 与 userData 备份。

## 10. Known limitations

- automatic binary rollback 的本地 store/coordinator/watchdog/NSIS archive 与 PowerShell 5.1 smoke 已完成；正式签名 installer 的真实故障目标升级与自动回滚 E2E 仍待发布环境证据。
- recovery evidence 仅在本机 `<userData>/diagnostics` 保留最近 20 条，没有集中上传、跨机器关联或服务端聚合。
- blockmap 已进入 build/manifest/feed 门禁，并执行 gzip、JSON 与最小 schema 校验；隔离 E2E 已证明可走 Range/206 差分路径，但 electron-updater 在差分条件不满足或差分失败时仍可能回退到完整 installer。
- 2026-08-04 的隔离 update-install 证据属于 unsigned fixture；它可证明 blockmap/Range/206 差分路径、watchdog/自动拉起与 continuity，但不能替代正式证书、真实 timestamp provider 和真实 private origin/CDN 验收。
- channel policy 已生成并验证；`rolloutPercent`、设备 cohort、授权和 cache invalidation 仍由 private feed 服务实现。
- 尚未使用正式发布证书和真实 timestamp provider 完成端到端发布验收。

## 11. 收口检查表

- [x] NSIS installer 名称、图标、快捷方式与 per-user 安装语义。
- [x] installer compression 默认 `normal`。
- [x] Main-only Generic updater、HTTPS/Bearer 与显式下载/安装。
- [x] 真实 `quitAndInstall()` `0.0.1 -> 0.0.2` continuity。
- [x] differential package、installer/blockmap bytes/hash 门禁、blockmap gzip/JSON/schema 校验与隔离 Range/206 传输证据。
- [x] release signing/timestamp fail-closed 与显式 unsigned fixture mode。
- [x] private channel policy、allowed/withdrawn version 治理。
- [x] updater failure evidence、旧版本保留与 diagnostics/recovery runbook。
- [x] Desktop updater driver 使用 differential download，并持久化 bounded recovery evidence。
- [x] automatic binary rollback 本地链路：installer 自归档、durable intent/health/outcome、独立 watchdog 与 one-shot attempt fence。
- [ ] 使用正式发布证书和真实 RFC 3161 timestamp provider 完成一次端到端验收。
- [ ] 使用正式签名 installer 完成故障目标版本的 automatic rollback E2E。
- [ ] 在 private feed 服务中完成 cohort/rollout enforcement 与 CDN cache invalidation 自动化。

## 12. 本地源码重启验证（不生成安装包）

UI 改动在本地源码实例验证时，先执行 `pnpm --filter @sync-think/desktop build`，再用 `pnpm dev:desktop` 启动 Electron。启动环境使用 `SYNC_THINK_DEV_NO_TOKEN=1` 和固定的本地 `SYNC_THINK_INSTALL_ID`；不运行 installer/portable/release 流程，也不复用签名发布产物。（`SYNC_THINK_SHELL` 开关已于 2026-08-18 随旧渲染层删除，不再需要设置。）

最小验收证据是：Electron 窗口可见且 `Responding=True`，Runtime 日志包含 `pipe ready`、`database ready`、`hello accepted`，并且测试操作只写入本地开发数据库。

## 13. 0.1.0-beta.1 公开无签名 Beta

这一版给陌生人做公开下载，**不是**已签名正式发布。测试者从你的域名或网盘取包，本机安装，使用他们自己的模型密钥。

### 13.1 构建

不要走默认 `pnpm release:stage:win` / `pnpm release:installer:win`：它们默认 `release` 签名模式，没有证书会失败。

```powershell
pnpm build
pnpm release:assets:win
node scripts/windows-portable-release.mjs stage --signing-mode unsigned-fixture
node scripts/windows-installer-release.mjs build --signing-mode unsigned-fixture
node scripts/windows-installer-release.mjs verify --allow-unsigned-fixture
node scripts/assemble-beta-public.mjs
```

产物：

```text
apps/desktop/release/installer/SYNC-THINK-Setup-0.1.0-beta.1-x64.exe
apps/desktop/release/installer/SYNC-THINK-Setup-0.1.0-beta.1-x64.exe.blockmap
apps/desktop/release/installer/installer-manifest.json
apps/desktop/release/public/index.html
apps/desktop/release/public/BETA-TESTER-GUIDE.md
apps/desktop/release/public/SYNC-THINK-Setup-0.1.0-beta.1-x64.exe
```

`installer-manifest.json` 的 `signing.mode` 必须是 `unsigned-fixture`。验证必须确认包内没有 `.env*`、`.db`、token 或开发者 userData。当前公开夹产物是含精简开头页的重发包：317,718,294B，SHA-256 `49d3bd8ecf98a8ab28b178c86371a34350c0c13c5145b571848f953052556d33`。

### 13.2 上传

把 `apps/desktop/release/public/` **整夹**上传到现有域名或网盘，保持 `index.html` 与 exe 同级。不要配置 `SYNC_THINK_UPDATE_FEED_URL` / `SYNC_THINK_UPDATE_TOKEN`。无签名公开自动更新会被冒充。

测试者机器不得设置 `SYNC_THINK_DEV_NO_TOKEN` 或固定 `SYNC_THINK_INSTALL_ID`。

### 13.3 SmartScreen 与回滚

测试者若看到「Windows 已保护你的 PC」，按下载页「更多信息 → 仍要运行」。哈希不一致则停用该文件。

`appId` 仍是 `com.syncthink.desktop`。本轮无更新源：出问题就卸新包并保留 userData，或改发上一内部 `0.0.1` unsigned 包。买到 Authenticode 后再打更高版本签名包并另开 HTTPS feed。

## 本地开发窗口成套切换准备 · 2026-09-06

目标为本机 dev-0001 / D:/projects/SYNC-THINK，不发布 installer 或更新 channel。用户已要求构建并重启；备份/验证完成前保持业务窗口和 Runtime 运行，历史物理清理不属于本次操作。

- 已确认旧 Runtime PID 33492（Node 20.20.2），守护进程 PID 19720；Desktop 主进程 PID 52872，由 scripts/dev-desktop.mjs 启动。实际 healthcheck 返回 inFlightRuns=0、eventSequence=1993640；后续停写前再次确认，不能用这一观察代替停机时状态。
- 数据源为 .data/SYNC-THINK/sync-think.db，约 17.01GB，D 盘约 50.86GiB。采用仓库 backupDatabase / SQLite Online Backup，而非复制正在写入的 db 文件；新增独立时间戳备份，不轮转/删除旧备份。
- 本轮先生成备份并执行 SQLite integrity_check，记录字节数、SHA-256、事件/检查点高水位、全表行数和迁移记录。失败时保持业务实例，不执行迁移或切换。
- 当前 dist 已被候选构建覆盖，运行中旧进程的精确源码/二进制快照尚未捕获。切换前必须明确一个可启动、与升级前数据兼容的回退构建及恢复步骤，不能仅凭相同 package version 声称可回到完全相同的旧版本。
- 0052/0053/0054 仍待成套验证；预留迁移自己的备份空间和余量。备份不等于迁移成功，开发测试不等于真实 native/Claude/Codex 和整窗验收。正式停写/切换与结果会追加到此节。

### 切换前证据与停写（2026-09-06）

- 第一份备份：.data/SYNC-THINK/backups/2026-09-06T00-09-16-646Z.backup.db，17,007,509,504B；SHA-256 af1e15c01694bfed3b786db0629c90055fa67902063f56830d8a061c8e5c1ef8。00:18:10Z 完成 integrity_check=ok 和82表计数；清单位于 .data/optimization-rollout-20260906/pre-upgrade-backup.json。
- 独立回退源码：同目录 rollback-source-1e1427a，Git完整提交1e1427af1f52467db7055f58d0e2c581783f21fd。offline/frozen/ignore-scripts 安装和11项构建成功；复制已核对同版本的本机 better-sqlite3 11.10.0 Node20二进制，SHA-256 1eeaea9a4acb37a35d5057ab76b9ca923b6684df019b1316717f1ea6d9eff1a1。没有修改 Git工作区/提交/分支。
- 01:00:53Z 旧存储对第一备份只读读出检查点1993540、100条尾事件及高水位1993640，核对960条message、34项task、31个conversation；独立空库worker启动和关闭成功。证据 rollback-verification.json；这不是旧 Desktop、整库业务执行恢复或精确原运行构建的证明。
- 01:02Z CloseMainWindow 正常退出 Desktop52872；health确认无进行中运行、事件高水位1993644，daemon.stop返回ok，确认两个受管进程均退出后才迁移。cutover-before.json记录现场；初备份高水位1993640不是最终切换点。
- 01:02:49Z PID9968运行原 runMigrations；保留自动生成的停写后一致性备份，迁移0052/0053/0054。没有增加跳过备份开关，没有复制正在写入的数据库，也没有为了空间删除旧备份。迁移前D盘34.69GiB，预留第二份17GB备份和索引空间。

### 成套切换结果与真实窗口边界（2026-09-06）

- 01:12:37Z 三项迁移全部提交，连同自动备份耗时587.771秒。迁移前后事件高水位1993644，message960/task34/conversation31保持；投影表与四个被核对的索引存在。详见 migration-result.json。此量级升级应有独立维护进度，不宜依赖120秒启动ready等待掩盖耗时。
- 最终停写点备份：.data/SYNC-THINK/backups/2026-09-06T01-02-49-596Z.backup.db，17,007,509,504B，SHA-256 f69d645f849258a4d2973acf1958ea4a8f2bf0ac45e77906cf9c92059345a13d。01:18:29Z 旧存储只读核对0051、检查点1993540、104条尾事件/高水位1993644和三项业务计数；第二备份未重复全库integrity_check，第一份的完整校验不可混称第二份结果。证据 cutover-backup-verification.json。
- 新 Runtime PID31156；daemon PID78144，由常驻监督进程82368管理（同入口标记，不按两个daemon标记就判定孤儿）。01:24:01Z hello + healthcheck成功，inFlightRuns=0 / eventSequence1993644。最终常规 scripts/dev-desktop.mjs 启动器60552，Desktop77300，09:20:17+08启动、可见窗口标题SYNC-THINK且Responding=true。不是仅重开旧Renderer。
- Browser plugin not available，使用现有 Playwright Electron API、生产renderer-shell/index.html和真实本机数据。1426x863下设置打开/关闭及草稿不变通过，page/console errors=0；有一个既有allowpopups开发警告，未宣称其已解决。独立探针未发送提示或调用实际模型，首轮截屏仍在历史加载，不能据此说历史验收通过。
- 第二轮等待到6条真实历史消息，零页面错误，但等待composer-task-panel失败。已保留失败证据，而非将整个窗口流程标绿。只读重放当前会话206条事件证明：1993435处有5项旧清单；1993436的后续Codex run.started使当前reducer清空非Claude计划；1993540终态仍为null。旧成功事件尚在，不是重启删除数据；旧清单也不是本次新内核生成的证明。需要历史任务回看/当前计划边界的产品闭环，见审查18.15。
- QA产生的Electron窗口已退出，正常开发窗口保留；自有74904已关闭，其余已退出的QA助手没有作为业务实例留存。未物理清理历史、未安装更新包/签名/发布channel，也未完成native/Claude/Codex完整矩阵或旧Desktop/业务执行回退。
- 回退步骤：先停止新Desktop及执行所有者并确认无进行中运行；保存新版本开始后的数据，再将最终停写点备份恢复到明确目标（不要让旧代码直接读新delta检查点）；使用已固定且独立构建的1e1427a基线。完整业务恢复/旧Desktop应在隔离门禁中继续验证，不自动恢复用户旧工具执行。

### 失效审批补丁成套重启（2026-09-06）

- 本批只是源代码构建更新：最终11项构建通过，首屏JS1,912,981B/全部2,731,399B。0052/0053/0054已在前批迁移，此次没有新增迁移、重复17GB备份或数据清理；原验证备份和独立回退源保持。
- 正常关闭Desktop77300；Runtime31156健康且inFlight0后daemon.stop返回ok，核对原Desktop/Runtime/daemon/supervisor/launcher均退出。以Node20和dev-0001启动普通scripts/dev-desktop.mjs，launcher53896、Desktop77880响应正常。
- 2026-09-06T02:44:02Z hello/health成功，Runtime66672，inFlight0、eventSequence1993653；02:47:11Z只读message960/task34/conversation31及5个既有迁移对象保持。证据.data/expired-approval-restart-before.json、restart-health.log及rollout-result.json（同expired-approval-前缀）。
- 新Main/Preload/Renderer/Runtime已随成套启动加载。隔离实际ChatView/SQLite/Runtime/Main图片边界已实测，IPC传输为模拟；普通业务窗口仅核对进程、标题、健康和数据保持，不冒充真实Electron IPC及内核审批矩阵通过。
- 未发布installer，未执行旧Desktop/全业务恢复回退。继续按原六方向验收，详见审查18.16。

### 原生任务历史补丁成套重启（2026-09-06）

- 本次为源码构建更新，工作区11项构建全部通过（0缓存）；首屏JS1,920,099B、全部2,738,517B。没有新迁移、重复17GB备份、业务数据清理或installer发布；既有0052/0053/0054与上批备份、独立回退源保持。
- 重启前确认Desktop77880标题SYNC-THINK且响应，Runtime66672健康/inFlight0；CloseMainWindow正常退出后再次health确认0，daemon.stop返回ok，核对旧Runtime/daemon83896/supervisor50920/launcher53896均退出。未按等待超时强杀。
- 普通Node20 scripts/dev-desktop.mjs + dev-0001 启动器85488，Desktop85260、受管Runtime68032（daemon63652、监督进程17228）。04:26:10Z hello/health成功、新conversation.taskPlanHistory能力存在，inFlight0、eventSequence1993657。窗口标题/Responding正常。
- 只读message960/task34/conversation31及5个既有迁移对象保持；新业务pipe历史API读出原run JHF8GQ16Y13N6WZ9N9Q07W2D2Y的5项清单，与只读原始重放一致。普通业务窗口没有逐页交互冒充实测；完整实际Electron IPC交互另在隔离合成SQLite中通过，含成套重启恢复。
- 最终4202项全量、Runtime/Desktop lint与diff-check通过，Desktop18个既有Hook提示保留。记录.data/task-plan-history-restart-before.json、restart-health.log、rollout-result.json（均同task-plan-history-前缀）及Electron验收记录；详见审查18.17。真实三内核生命周期、正式更新/旧Desktop和整库业务恢复回退门禁继续保留。

### 原生 Codex 工具启用补丁成套重启（2026-09-06）

- Runtime受管Codex创建/续接显式tools.update_plan.enabled=true；保持全局配置与goals。三内核真实原生任务/详细说明/下一轮记忆/Runtime对象重开通过，旧失败Codex保持原sessionId恢复；自检分项误报修复。真实权限/图片/取消等完整矩阵仍待验。
- Runtime195文件/1462全量、31定向、lint和工作区11项构建通过（10缓存）。其它四包沿用未变基线，累计4210而非本批五包全量重跑；JS首屏1,920,099B/全部2,738,517B不变。没有新迁移、重复17GB备份、业务历史清理或installer。
- Desktop85260正常CloseMainWindow退出，Runtime68032健康/inFlight0后daemon.stop成功，旧daemon63652、监督17228与launcher85488退出已核对。普通Node20启动器81184开启Desktop90236；新监督83628/daemon12620/Runtime86068。
- 2026-09-06T05:29:37Z hello/health成功，inFlight0、eventSequence1993662；只读业务960message/34task/31conversation及5个迁移对象保持，新业务pipe仍读出原5项历史。普通业务窗口只核对标题/响应/健康与pipe，不冒充实际Electron点击新任务。记录.data/kernel-live-restart-before.json、kernel-live-business-health.log及kernel-live-rollout-result.json。
- 既有完整备份与独立旧存储回退源保留；完整旧Desktop/整库业务恢复、正式发布和三内核剩余门禁继续按原六方向推进。详见审查18.18和TD078。


### 原生审批登记与运行关闭补丁成套重启（2026-09-06）

- 原生权限请求登记失败时deny且不建waiter；Runtime关闭等待Native/外部完整执行收尾，并禁止关停后目标续轮。6项回归先红后绿、Runtime197文件/1468项全量、lint和11项构建（10缓存）通过。15个实际三内核审批场景独立验收通过，不是Electron审批点击或全生命周期全绿。
- 首屏JS1,920,099B、全部2,738,517B不变；无新迁移、依赖、清理、installer和重复17GB备份。既有0052/0053/0054与已核验备份、回退源保留。
- 重启前06:40:24Z业务Runtime86068健康且inFlight0；核对Desktop90236的标题、路径和响应后CloseMainWindow，daemon.stop之前再次确认无活动运行；旧Desktop90236/Runtime86068/launcher81184退出。没有根据超时强杀业务进程。
- 普通Node20启动器40432打开Desktop92580；2026-09-06T06:41:58Z新Runtime39392 hello/health成功、inFlight0、eventSequence1993672；Desktop标题SYNC-THINK、Responding=true。只读message960/task34/conversation31与5个既有迁移对象保持；实际新pipe读取原5项历史并与旧结果相等。
- 记录.data/kernel-approval-restart-before.json、kernel-approval-rollout-result.json、kernel-approval-acceptance-summary.json及对应启动/测试日志。全目标仍在原六方向中，图片/执行中取消/实际Electron、整窗多窗、正式更新/旧Desktop与全库业务恢复回退继续验证；见审查18.19、TD079。

### 真实窗口审批与原请求关联补丁成套重启（2026-09-06）

- 修复待审批误判stall、普通user缺runId及旧NULL行保守只读关联，分离checking/installing状态。Storage501/Runtime1469/Desktop2089三包全量4059项、lint、diff-check与工作区11项构建通过（7缓存）；其它两包未变基线175项沿用，累计4234。JS首屏1,920,706B/全部2,739,124B，各+607B。
- 真实生产Electron三内核4场景/内核，共12项通过；同一个真实旧失败数据库升级后的草稿合并与原文恢复通过。Renderer/CSS/Preload/Runtime构建指纹与最终产物一致；18项既有Hook提示保留。详情审查18.20，不替代其它模型/图片/执行中取消或正式更新门禁。
- 08:17:18Z旧Runtime39392健康/inFlight0；Desktop92580正常CloseMainWindow并等待退出，再次health0后daemon.stop，旧39392/84720/40432退出核对通过。Node20 scripts/dev-desktop.mjs、dev-0001普通隐藏启动器94792启动Desktop94292/Runtime94336。
- 08:19:20Z（北京时间16:19）标题SYNC-THINK、Responding、hello/health成功，inFlight0、eventSequence1993680。只读业务message960/task34/conversation31及5个迁移对象保持；实际业务pipe返回原5项历史，与原只读源一致，单次含连接读取320.614ms，不是暖态或p95。
- 无业务模型请求、新迁移、清理、重复17GB备份或installer。0052/0053/0054、原已验证备份及回退源保持。新的restart-before、rollout-result与acceptance-summary在仓库外QA根，同kernel-window-前缀；不覆盖上批证据。完整旧Desktop/业务库恢复和正式更新回退继续保留。
