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

正式 installer 默认使用 `release` signing mode。证书和 timestamp server 未显式配置、签名无效或 timestamp 缺失时，构建或验证立即失败。`unsigned-fixture` 仅用于隔离测试，不得进入正式 channel。

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
5. 将托管 Node 20.20.2 写入 `resources/node/node.exe`。
6. 生成 `resources/app-update.yml`：正式 `release` 精确记录 updater cache identity 与完整 `publisherName`；显式 `unsigned-fixture` 只记录 cache identity。两种模式都禁止 provider URL、Bearer token 或请求 header。
7. 生成 portable `release-manifest.json`。

关键输出：

```text
apps/desktop/release/win-unpacked/SYNC-THINK.exe
apps/desktop/release/win-unpacked/resources/app/dist/main/index.js
apps/desktop/release/win-unpacked/resources/runtime/main.js
apps/desktop/release/win-unpacked/resources/node/node.exe
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

- Desktop executable、main、preload、renderer、Runtime launcher、Runtime main 与 Node binary 均存在。
- `resources/app-update.yml` 必须与选定 signing mode 的期望内容字节级一致：正式 release 为 cache identity + 完整 publisher DN，unsigned fixture 仅为 cache identity；任何额外 provider、URL、Authorization 或 token 字段都失败。
- 托管 Node 为 20.x，且 required native modules 存在。
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
