# SYNC-THINK

Local-first、用户可控的多模型 Agent 桌面工作台（Windows）。

> 当前状态：**Alpha 内测**（`0.1.0-rc.2`）。功能与数据格式仍可能变化，不建议作为生产环境使用。

## 下载内测包

从 [GitHub Releases](https://github.com/1447751897/SYNC-THINK/releases) 下载最新的 `SYNC-THINK-Setup-<version>-x64.exe`。

- 平台：Windows 11 x64（Windows 10 / ARM 未验证）
- 安装包**未签名**，Windows SmartScreen 会拦截：点「更多信息」→「仍要运行」
- 安装前建议核对 Release 页给出的 SHA-256：

  ```powershell
  Get-FileHash .\SYNC-THINK-Setup-0.1.0-rc.2-x64.exe -Algorithm SHA256
  ```

- 首次打开：选择一个本地工作区文件夹 → 设置 → 模型 → 添加你自己的 API 密钥。安装包不包含任何开发者密钥。
- 内测阶段没有自动更新，新版本请回 Releases 页手动下载。

更多说明见 Release 附带的 `BETA-TESTER-GUIDE.md`。

## 反馈问题

请在 [Issues](https://github.com/1447751897/SYNC-THINK/issues) 提交，附上版本号、复现步骤，以及从应用内导出的脱敏诊断信息。

## 从源码运行

要求：

- Node.js 20.20.x
- pnpm 10.28+（仓库通过 `packageManager` 字段固定版本，推荐 `corepack enable`）

```bash
pnpm install
pnpm typecheck
pnpm test
```

开发模式：

```bash
# Terminal 1 — Agent Runtime（命名管道服务）
pnpm dev:runtime

# Terminal 2 — Desktop shell
pnpm dev:desktop
```

打包 Windows 安装器（未签名内测包）：

```bash
pnpm build
pnpm release:assets:win
node scripts/windows-portable-release.mjs stage --signing-mode unsigned-fixture --out apps/desktop/release/win-unpacked
node scripts/windows-installer-release.mjs build --signing-mode unsigned-fixture --prepackaged apps/desktop/release/win-unpacked --out apps/desktop/release/installer
node scripts/windows-installer-release.mjs verify --allow-unsigned-fixture --out apps/desktop/release/installer
```

签名发布流程见 `docs/operations/09-alpha-internal-release.md`。

## 仓库结构

```
apps/
  desktop/     Electron 桌面壳（renderer / main / preload）
  runtime/     Agent Runtime（内核适配、会话、工具执行、持久化）
  mcp-server/  平台 MCP server
packages/
  core/ protocol/ shared/ storage/ secure-store/ adapters/ workers/ ui-kit/ test-fixtures/
scripts/       构建、发布、自检脚本
docs/          产品 / 工程 / 运维 / 研究文档（入口：docs/00_START_HERE.md）
```

各上下文的边界与术语见 `CONTEXT-MAP.md`。

## 设计原则

1. 上下文连续性优先
2. 模型路由由用户控制
3. UI 重启不得中断 Runtime
4. 数据库与日志中不存明文密钥

## 参与贡献

- 提 Issue 前先搜索是否已有同类问题；Issue 分流标签说明见 `docs/agents/triage-labels.md`
- 提交 PR 前请确保 `pnpm typecheck && pnpm test` 通过
- 涉及领域概念命名时，遵循对应包 `CONTEXT.md` 中的词汇表

## 许可

[MIT](./LICENSE)
