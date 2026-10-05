# Windows 安装器后台进程关闭修复验证

## 现场与范围

2026-10-05（Asia/Shanghai）反馈 rc.9 安装时提示应用关闭失败。只读检查发现安装目录 `D:\tools\sync-think` 中仍有两个 daemon 进程和一个 Runtime 进程；桌面窗口已不在进程列表。普通桌面退出按设计保留后台执行服务，更新/卸载是单独的生命周期边界。

旧 electron-builder 26.15.3 的关闭模板使用目录字符串前缀扫描和逐项终止，缺少本项目后台所有权/重启关系、安装器自身保护及精确入口过滤。现场证明后台进程仍在；未重放旧安装器的失败过程，不将某一种竞争或权限原因认定为唯一根因。

## 改动

- `apps/desktop/build/installer.nsh`：接入 `customCheckAppRunning`，在旧版本卸载/新文件覆盖之前检查并关闭指定安装的进程；等待完成后继续，超时或检查失败走重试/取消，取消返回失败码。
- `apps/desktop/build/installer-processes.ps1`：精确匹配当前安装的桌面可执行文件，以及 bundled Node + 完整 daemon/Runtime 入口参数；忽略同前缀目录、无关 Node 命令、安装器和卸载器。
- 保护安装器及其祖先进程；终止前重新核验 PID 创建时间及目标身份；按根进程树停止，避免先终止守护子进程再被外层拉起；连续检查确认退出。
- NSIS 将 helper 明确解包到插件目录；安装路径以 `\.` 结尾传入，避免 Windows 命令行的尾部反斜杠吞掉引号。路径作为 `-File` 的数据参数传递，不拼接成 PowerShell 源码。
- `scripts/windows-installer-processes.test.mjs`：增加纯快照、真实隔离进程树及真实 NSIS 成功/失败流程测试，并接入根包安装器回归命令。

## 验证

- 安装器进程、已有 hook、解包、签名/清单回归 **27/27 通过**，没有跳过项目。
- 隔离进程树实测：停止自动重启子进程的 daemon 树和 orphan Runtime，保留安装器、相邻安装目录和无关 Node 命令；等待后无 respawn。
- NSIS 实测：后台关闭后进入替换段；无效根目录引起关闭失败时退出码为 2，替换段不执行，隔离 Runtime 不被终止。
- 本地安装包构建和清单/差分文件校验通过；未对真实用户安装进行自动覆盖，也未终止现场的后台任务。

## 本地修复包

- 路径：`apps/desktop/release/rc.9-installer-fix/installer/SYNC-THINK-Setup-0.1.0-rc.9-x64.exe`。
- 安装包 222215218 字节；SHA-256：`2d7ffcaf2ab86d0145fc49a7b089a22ac5aa56fc496044cc929e9db4f4b04dab`。
- 使用已发布 rc.9 的便携 payload，只重建安装器；没有重新打入当前账号授权开发代码。
- **仅供本地验证，未覆盖线上 rc.9 同版本产物；正式线上修复应使用新版本号。**
- 原始证据保留于 `apps/desktop/release/rc.9-installer-fix/evidence/`。

人工验证：取消旧安装器，启动上述本地修复包，确认关闭提示后等待后台服务退出并继续安装。安装前先结束或保存正在执行的任务；此步骤会关闭该安装的后台服务，但不删除会话数据库与用户配置。

## 追加：NSIS 启动时临时文件错误（2026-10-05）

现场截图为 `Error writing temporary file. Make sure your temp folder is valid.`，与进入替换流程后的应用关闭提示是两个不同阶段。NSIS 在执行自定义安装脚本前即使用 Windows 临时目录；因此已有 `customCheckAppRunning` 关闭修复不负责修复此阶段。

本轮只读检查与隔离验证：

- 当前进程 `TEMP`/`TMP` 为 `C:\Users\ZHUZHE~1\AppData\Local\Temp`。检查时 C 盘约有 **17.4 GiB** 空闲，不能再把此次错误直接归因于磁盘已满。
- 用户 Temp 的短路径、长路径均存在；普通文件写入及 32/64 位 Windows 临时文件 API 探测成功，尚未确定 NSIS 特定失败的底层权限/系统原因，不做全盘清理或全局 ACL 改写。
- 使用缓存 NSIS 3.0.4.1 编译的无安装行为探针：默认 C 盘 TEMP 退出码为 **2**，未写入 `.onInit` 完成标记；**同一探针 EXE** 仅将子进程 `TEMP`/`TMP` 切换为 D 盘独立目录后退出码为 **0**，成功初始化 `$TEMP` 和 `$PLUGINSDIR`。不运行真实安装段、不触碰用户已装应用。
- 原修复包 SHA-256 仍为 `2d7ffcaf2ab86d0145fc49a7b089a22ac5aa56fc496044cc929e9db4f4b04dab`，未发现相对构建清单的内容损坏。

补充入口：

- 源文件 `apps/desktop/build/run-installer.cmd`；安装器构建阶段将其复制为输出目录中的 `Run-Installer.cmd`。
- 已补入本地目录 `apps/desktop/release/rc.9-installer-fix/installer/Run-Installer.cmd`。保持该目录内恰好一个 `SYNC-THINK-Setup-*-x64.exe`，双击 CMD 后启动同目录安装包，并将本次安装进程的临时目录设为同目录 `.installer-temp`（当前位于 D 盘）。
- `setlocal` 只影响本次启动及其子进程，不写用户/系统环境变量；不附加静默安装参数、不主动结束用户后台任务，也不删除全局临时文件。安装段仍由用户在安装向导中确认。
- 真实 NSIS 隔离探针验证目录包含空格/单引号的场景、临时目录生效、退出码 0/17 的透传、缺少/多个安装包时拒绝启动；另验证构建脚本自动附带入口。
- 完整安装器回归 **33/33 通过**。本次没有执行真实用户安装，也没有将本地修复发布为线上新版本。CMD 是临时目录问题的已验证绕行入口，直接双击原 EXE 仍使用系统默认临时目录。

证据新增于 `apps/desktop/release/rc.9-installer-fix/evidence/temp-startup/`。人工步骤：取消错误对话框，双击 `installer/Run-Installer.cmd`，确认出现安装向导；先保存正在执行的工作，再自行确认安装。若再次出现临时文件错误，保留具体错误信息继续核查系统策略，不将探针通过等同于完整安装已通过。

## 追加：rc.8 → rc.9 的旧卸载器迁移（2026-10-05）

用户通过独立临时目录入口进入安装后，仍收到“应用关闭失败”。现场进程快照仅见本地修复包的安装器；已安装注册表项仍为 **0.1.0-rc.8**，安装目录为 `D:\tools\sync-think`。在该目录执行新 helper 的只读 Check 返回 `exitCode=0`、空 remaining。用户随后取消了安装器；没有捕获本次旧卸载器的精确返回码，故不把某个文件锁、权限或进程竞争推断为已确认的唯一原因。

发现并修复前一轮遗漏的链路：

- 新安装器检查结束后，electron-builder 的 `uninstallOldVersion` 默认仍从注册表选择 **已安装 rc.8 自带的卸载器**。仅修改新包的关闭 hook，不会修复旧卸载器的路径/进程前缀扫描。
- 模板把旧卸载器连续返回非零码也展示为 `appCannotBeClosed`，实际故障可能位于卸载器启动或文件迁移，并非还有应用进程。
- `scripts/windows-installer-migration.mjs` 在锁定的 electron-builder 26.15.3 模板中替换这一处调用：仅对注册版本精确为 rc.8 / rc.9 的同应用既有布局，使用 **本次构建生成的当前卸载器**，旧版本目录仍从原注册表读取。其它版本保持原选择行为。
- 保留 `/KEEP_APP_DATA`、`--updated`、`/currentuser`（或原 allusers 分支）、原子移动/恢复旧文件的流程；没有添加用户数据删除或覆盖失败后强行继续的行为。
- 当前卸载器启动失败时不回退到已知旧版扫描器；返回错误并停止替换。
- 安装器区分检查错误（例如目录无效、PowerShell 启动/检查失败）和真实的目标进程存在：只有 Check 的状态 10 才进入关闭流程；其它非零状态直接报告检查详情，不再当成后台运行反复 Stop。
- `apps/desktop/build/installer.nsh` 增加阶段日志，记录检查/关闭结果、选择的卸载器、旧版目录、退出码，保存到 `%LOCALAPPDATA%\SYNC-THINK\installer-logs\installer.log`。日志保持追加并保存调用前的 NSIS 错误标志与内部寄存器；安装详情面板也显示卸载阶段。

新增回归不是仅测试 PowerShell 分类器：使用 **真实 NSIS 生成/执行卸载器 + 固定版本的 uninstallOldVersion 重试循环 + un.atomicRMDir/un.restoreFiles**，以唯一 HKCU 测试键和 workspace 临时目录构造升级现场。

- rc.8（包含真实隔离 Runtime）、rc.9：本次构建的卸载器执行、旧卸载器不执行、旧文件原子迁移完成后才到达替换段；确认目录含空格/单引号时参数仍正确，保留数据/更新参数到达子卸载器。
- 其它版本：仍使用登记的卸载器，验证迁移选择没有扩大到未知版本。
- 卸载器返回非零码：日志保留实际退出码、旧文件保持、替换段不执行；不回退执行旧扫描器。
- 检查无效安装目录：记录 Check 失败、没有调用 Stop、没有终止 Runtime。

新产物与最终测试结果保留在 **rc.9-installer-fix2** 的 evidence 目录。使用已发布 rc.9 的便携 payload，只重建安装器，不包含工作区的账号/授权开发改动。原 fix1 与线上同版本产物均不覆盖。本轮没有对 `D:\tools\sync-think` 自动卸载或覆盖；真实安装仍由用户确认。

本次最终验证：安装器回归 **38/38 通过**，无跳过；fix2 构建成功，用时 42289 ms，构建后清单校验成功。EXE 222216248 字节，SHA-256：`6e24f03c80bc43b6f856a3982ac6583f7401a6c41c41da384f7c57dde1e0d1f7`。使用入口为 `apps/desktop/release/rc.9-installer-fix2/installer/Run-Installer.cmd`。

## 最终现场验证：完整性标签与真实 rc.10 安装（2026-10-05）

### 已确认的根因（修正前述推断）

先前的隔离回归不足以证明正常用户目录下的真实安装成功。工作区根目录带继承的 `Low Mandatory Level (OI)(CI)(NW)`；本地生成的 EXE 继承该标签。实际运行的 NSIS 进程完整性 RID 为 **4096（Low）**，启动它的 Node/PowerShell 为 **8192（Medium）**。NSIS 在正常 C 盘用户临时目录调用 `GetTempFileNameW` 返回 0 / Win32 错误 **5（拒绝访问）**；改用工作区 D 盘 TEMP 后虽能启动，但对正常安装目录的卸载仍退出 2。

把 **哈希完全相同、字节未修改**的 fix2 EXE 流式写入正常权限的发布目录，在默认 C 盘 TEMP 中运行：实际 rc.8 → rc.9 成功、退出 0、原数据库 SHA-256 不变。正常目录中的真实 NSIS 探针也成功写入 C 盘 AppData。这是完整性标签的对照实证，不是重新猜测用户 TEMP 损坏或 PE 提取损坏。

该标签属于本机 NTFS 文件元数据，不随 HTTPS 上传的安装器字节自动传到用户下载文件。未据此宣称所有线上用户都具有同一根因；后台占用、旧卸载器和失败诊断的修复与此分开验证。未调整工作区根 ACL、系统安全设置、全局 TEMP，也未请求提权。直接提升单个文件标签返回拒绝访问，最终方案采用新文件流式交付。

### 交付与回归改动

- `windows-file-integrity.ps1` 只读取 `LABEL_SECURITY_INFORMATION`，不读取审计 SACL、不改权限。
- `windows-installer-distribution.mjs` 检查本地 EXE 和输出父目录；Low 产物导出到明确指定的正常目录，默认导出到正常 `%LOCALAPPDATA%\SYNC-THINK-Releases` 下的唯一新目录。只复制发行 EXE、blockmap、清单和可选 CMD；新文件使用 `wx`，不覆盖已有版本，不复制 NTFS 安全描述符。
- 构建脚本返回实际正常交付目录，再校验哈希、清单及完整性；只读 CLI 校验对 Low EXE 明确失败。双击正常目录的 EXE 即可，不依赖 CMD 绕行。
- 新的真实 NSIS 回归在正常 AppData 下显式构造 Low 构建子目录，确认 Low 检查失败、字节相同的导出包用默认正常 TEMP 启动并写入正常目录；验证默认导出入口、不覆盖旧输出、低权限父目录拒绝和原目录标签保持不变。
- smoke 脚本把目标目录改为正常 AppData，检查真实权限边界；修正守护进程把 Runtime 日志重定向到单独日志、PID 位于数据库父目录的测试假设。保留桌面/Runtime 真正 hello 就绪断言。

### 真机测试（非仅模拟）

操作前完整备份 `D:\tools\sync-think`、实际用户数据和安装注册表，主 EXE/数据库原件与备份哈希一致。数据库备份约 58 MB，完整用户目录约 4.6 GB。备份与原始测试失败日志保留，没有清理。

1. Low 工作区 fix2 包：真实安装失败，退出 2，原 rc.8 和数据库保持；保留 `live-fix2-result.json`。
2. 相同 fix2 包正常目录：rc.8 → rc.9 成功，退出 0，数据库保持。
3. 正常目录诊断包：已安装 rc.9 的真实 bundled Runtime、daemon/supervisor 正在运行时覆盖成功，退出 0；安装 helper 仅关闭本安装，开发 Runtime/daemon PID 22372、66648、31148 均保持运行。
4. **最终 rc.10 EXE**：正常目录全新安装成功、版本 0.1.0-rc.10，退出 0；真实卸载退出 0，应用 EXE 移除，测试数据库哈希保持。临时隔离安装注册表已恢复，快捷方式原字节也已恢复。
5. 恢复备份中的**原始 rc.8 完整安装**（校验 EXE 与原备份一致），启动 rc.8 bundled Runtime/daemon，再用最终 rc.10 EXE 升级：退出 0、真实目录版本 rc.10、原用户数据库 SHA-256 不变、开发进程前后 PID 一致。rc.9 目录移至明确测试备份路径保留，未删除。
6. rc.10 安装后用隔离数据启动实际桌面，Sky 读取到完整首页 DOM 和真实窗口，Runtime 单独日志含 `pipe ready`、`database ready`、`hello accepted`。最初测试只等待 desktop stdout 而误报 ready=false，原始失败记录保留；修正后的 smoke 启动函数重新执行通过（`desktop-rc10-harness-proof.json`）。没有把错误检测结果隐藏或删掉。
7. 实际 rc.10 桌面、Runtime、daemon 都在运行时，再执行同一最终 EXE 覆盖安装：退出 0、真实版本 rc.10、原用户数据库保持。进程关闭阶段日志可逐个核验。

安装器最终回归 **44/44**，无跳过；版本/发布链回归 **36/36**，无跳过。完整应用测试没有在本轮重跑；仅在已发布非账号 rc.9 源码上重建桌面及安装器，不把此前存在失败的全项目测试称为全绿。

最终交付：`D:\tools\SYNC-THINK-Releases\0.1.0-rc.10\SYNC-THINK-Setup-0.1.0-rc.10-x64.exe`，SHA-256 `85fe59263d219773cf62a0ae192ff78238833955590ad4925a883f98e4a20396`，大小 222221071 字节。构建输出与正常目录字节相同，完整性为 implicit Medium (8192)。最终构建来源逐项对比 e9d4372：3235 个原文件完全匹配、仅 7 个已批准发布相关文件改变、没有遗漏或其它变化；新增文件仅安装器修复/测试脚本。账号登录/OAuth 开发源码未复制，正式 app 不含 cloud-account-handlers。

现场证据目录：`D:\projects\SYNC-THINK\.data\installer-live-20261005`。其中 `live-rc8-to-rc10-result.json`、`live-clean-rc10-result.json`、`live-rc10-running-desktop-result.json`、`desktop-rc10-harness-proof.json`、`rc10-source-evidence.json` 和实际 installer.log 共同证明真实安装，不仅是路径分类单测。是否已线上激活以 `docs/releases/0.1.0-rc.10.md` 与激活证据为准，不把本地产物准备好当成发布完成。


追加回归记录：为默认正常交付路径新增清理断言后，首次全套出现 43/44，失败仅在测试清理路径的短路径/长路径规范化比较，不在安装器执行。保留 `regression-default-export-cleanup-path-failure.log`，改为先对许可父目录执行 `realpath` 后做边界检查，没有放宽删除边界。再跑完整套件 **44/44**，无跳过。最终发布 EXE 字节未因测试修正改变。
