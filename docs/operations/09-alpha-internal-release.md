# SYNC-THINK Alpha 内测发布说明

> 版本：`0.1.0-rc.1`（alpha 内测）
> 生成日期：2026-09-01
> 平台：Windows 11 x64

## 1. 本次内测产物

产物位于 `apps/desktop/release/alpha-dist/`：

| 文件 | 说明 |
|---|---|
| `SYNC-THINK-Setup-0.1.0-rc.1-x64.exe` | NSIS 安装包（282,816,400 bytes） |
| `SYNC-THINK-Setup-0.1.0-rc.1-x64.exe.blockmap` | 差分升级块映射（后续自动更新用） |
| `SYNC-THINK-alpha-signer.cer` | **签名证书**（内测用户需导入信任） |
| `installer-manifest.json` | 安装包清单（schema v3，含签名/哈希投影） |

### 安装包哈希

- **SHA-256**：`4033480d99dfcfeb1b8d1e00567e8d7e0ab0f146a5162eeb98bea6c31ad047ac`
- **签名者**：`E=alpha@syncthink.local, O=SYNC-THINK, OU=Internal Testing, CN=SYNC-THINK Alpha Signer`
- **签名指纹**：`504E5A55EB6FE2632C2ED66A593FD0647FCA0B78`
- **时间戳**：DigiCert SHA256 RSA4096 Timestamp Responder 2025 1

## 2. 内测用户安装步骤

### 2.1 安装（不需要导入证书）

**直接双击 `SYNC-THINK-Setup-0.1.0-rc.1-x64.exe` 即可安装**，无需导入任何证书。

由于是内测自签名证书，Windows SmartScreen 会弹「Windows 已保护你的电脑」提示，点击「更多信息」→「仍要运行」即可继续。

> 提示：安装包已经用你的证书签名（含时间戳），文件属性 → 数字签名里能看到签名者；只是因为证书不在系统信任库才显示「未知发布者」。签名本身是完整有效的。

### 2.2 可选：导入证书以消除警告（推荐给团队内部）

如果希望完全消除 SmartScreen 警告，用管理员身份打开 PowerShell 执行一次：

```powershell
Import-Certificate -FilePath '.\SYNC-THINK-alpha-signer.cer' -CertStoreLocation Cert:\LocalMachine\Root
```

> 备选（无需管理员）：双击 `.cer` → 安装证书 → 本地计算机 → 受信任的根证书颁发机构。若双击流程提示选存储，选「将所有的证书都放入下列存储」→「受信任的根证书颁发机构」。

导入后此机器上的 SYNC-THINK 后续所有版本（同一证书签发）都不再弹警告。

### 2.3 验证安装

启动 SYNC-THINK 后，运行时日志应出现 `pipe ready`、`database ready`、`hello accepted`。

## 3. 本版本签名方式说明

本内测版使用 **自签名代码签名证书**（`CN=SYNC-THINK Alpha Signer`），这是 alpha 内测阶段的过渡方案：

- **证书非商业 CA 颁发**，Windows SmartScreen 仍可能提示「无法验证发布者」，导入证书后即消除。
- 已包含 **RFC 3161 时间戳**（DigiCert），签名时间可验证。
- 后续正式公测应升级为**商业代码签名证书**（DigiCert/GlobalSign 等），见 `08-deployment.md` §5.1。

## 4. 证书管理（维护者）

- 私钥/证书位置：`.data/release-alpha/`（**已 gitignore，严禁提交**）
  - `alpha-signer.pfx`：带密码的私钥+证书（发布签名用）
  - `pfx-password.txt`：pfx 密码（权限 600）
  - `alpha-signer.cer`：公钥证书（分发给内测用户）
  - `alpha-key.pem` / `alpha-cert.pem`：openssl 原始材料
- 证书 SHA1：`504E5A55EB6FE2632C2ED66A593FD0647FCA0B78`
- 完整 Subject DN：`E=alpha@syncthink.local, O=SYNC-THINK, OU=Internal Testing, CN=SYNC-THINK Alpha Signer`
- 有效期：自 2026-09-01 起 1095 天

## 5. 重新发布 Alpha 版本的完整命令

```powershell
# 1) 全量构建 + 品牌资产 + 测试
pnpm build
pnpm release:assets:win
pnpm test:brand:win
pnpm test:release:win

# 2) Portable staging（输出到独立目录，避免与运行中实例冲突）
$env:SYNC_THINK_WINDOWS_SIGNING_MODE = 'release'
$env:SYNC_THINK_WINDOWS_PUBLISHER_NAME = 'E=alpha@syncthink.local, O=SYNC-THINK, OU=Internal Testing, CN=SYNC-THINK Alpha Signer'
$env:SYNC_THINK_WINDOWS_EXPECTED_SIGNER_SHA1 = '504E5A55EB6FE2632C2ED66A593FD0647FCA0B78'
$env:SYNC_THINK_WINDOWS_CERTIFICATE_FILE = 'D:\projects\SYNC-THINK\.data\release-alpha\alpha-signer.pfx'
$env:SYNC_THINK_WINDOWS_RFC3161_TIMESTAMP_SERVER = 'http://timestamp.digicert.com'
$env:WIN_CSC_KEY_PASSWORD = (Get-Content .data\release-alpha\pfx-password.txt)
node scripts/windows-portable-release.mjs stage --out apps/desktop/release/win-unpacked-alpha

# 3) 构建签名安装包
node scripts/windows-installer-release.mjs build `
  --prepackaged apps/desktop/release/win-unpacked-alpha `
  --out apps/desktop/release/installer-alpha

# 4) 验证
node scripts/windows-installer-release.mjs verify --out apps/desktop/release/installer-alpha

# 5) 整理分发目录
Copy-Item apps/desktop/release/installer-alpha/SYNC-THINK-Setup-*-x64.exe apps/desktop/release/alpha-dist/
Copy-Item apps/desktop/release/installer-alpha/SYNC-THINK-Setup-*-x64.exe.blockmap apps/desktop/release/alpha-dist/
Copy-Item .data/release-alpha/alpha-signer.cer apps/desktop/release/alpha-dist/SYNC-THINK-alpha-signer.cer
Copy-Item apps/desktop/release/installer-alpha/installer-manifest.json apps/desktop/release/alpha-dist/
```

> 注意：证书来源只能配置一个（`CERTIFICATE_FILE` / `CERTIFICATE_SHA1` / `CERTIFICATE_SUBJECT` / `CSC_LINK` 四选一），不要同时设置。

## 6. 本次发布修复的构建脚本缺陷

`scripts/windows-installer-release.mjs` 的 `inspectWindowsAuthenticodeSignature` 存在 PowerShell 解析 bug：

- **问题**：脚本数组用 `'; '` 连接多行，导致 `[pscustomobject]@{ ... }` 哈希表字面量跨行被 `;` 破坏 → `-Command` 解析错误 → 签名验证总是失败。
- **影响**：`unsigned-fixture` 模式跳过签名验证所以从未暴露；**任何正式签名发布（release 模式）必然触发**。
- **修复**：连接符改为 `'\n'`（保留多行语义）。
- **验证**：修复后签名投影正常返回（Status=Valid、指纹匹配、时间戳完整）。

## 7. 已知限制

- 内测安装包为**手动分发**，尚未配置私有自动更新 feed（`08-deployment.md` §8）。
- 自动更新通道（`latest.yml` + blockmap）已生成但未上传，后续配置私有 HTTPS origin + Bearer 后可启用差分升级。
- 自签名证书仅适用于内测，公测前需替换为商业证书。
