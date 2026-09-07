# 仓库清理与安装包瘦身审计报告（删除前清单）

日期：2026-09-07 · 分支：`codex/integrate-local-newmax` @ `a40c2a7` · 版本：`0.1.0-beta.1`

本报告只列证据与建议，**未执行任何删除**。判断依据：`git ls-files`、源码 import 引用图（689 个非测试源文件）、各包 `package.json` 依赖 grep、`pnpm deploy --prod` 实际产物体积（重新 stage 到 `apps/desktop/release/win-unpacked-audit`，870 MB）。

---

## 0. 磁盘现状（全仓约 40 GB，其中 git 跟踪内容不到 50 MB）

| 路径 | 体积 | 性质 | git 跟踪 |
|---|---|---|---|
| `.data/SYNC-THINK/` | 38 GB | 运行时数据（backups 26 GB / kernels 11 GB / db 533 MB），daemon 正在写 | 否 |
| `.data/update-install-e2e-*`、`.data/local-restart-*` | 8.5 GB（47 份） | 8 月初 e2e 测试残留副本 | 否 |
| `.turbo/` | 2.8 GB | turbo 构建缓存 | 否 |
| `.claude/worktrees/` | 728 MB（12 个） | 子代理隔离 worktree 残留 | 否 |
| `apps/desktop/release/` | ~1.4 GB | 打包产物（public 300 MB + installer 215 MB + win-unpacked-audit 870 MB + 6 个空壳 win-unpacked*） | 否 |
| `SYNC-THINK-beta1-public.zip` + `beta-share/` | 296 + 300 MB | 今日打的网盘分发包 | 否 |
| `.electron-*`（6 个目录） | ~70 MB | 7–9 月手工调试用 Electron 用户数据 | 否 |
| `userdata-backup-20260907/` | 48 MB | 今日卸载旧版前备份的用户数据 | 否 |
| `.tmp-*`、`_tmp_*`、`.newmax-*.log`、`.shots`、`.zcode`、`.restart-app.ps1`、`.tmp-audit/` | <2 MB | 探针脚本/日志/截图/本次审计脚本 | 否 |

---

## A. 建议删除 —— 磁盘垃圾（不进 git，零功能影响）

| # | 路径 | 体积 | 理由 | 风险 |
|---|---|---|---|---|
| A1 | `.data/update-install-e2e-*`（46 份）、`.data/local-restart-20260805-*` | 8.5 GB | `selftest-windows-update-install-e2e.mjs` 每次运行生成一份独立数据目录，未自动清理；均为 8/3–8/5 产物 | 低 |
| A2 | `.claude/worktrees/agent-*`（12 个） | 728 MB | 已结束的子代理 worktree；对应分支 `worktree-agent-*` 多数停在 `189c0b5` 无独立提交。需 `git worktree remove --force` + `git branch -D` | 低（先 `git log <base>..分支` 确认无未合并提交） |
| A3 | `.electron-gpu-test/`、`.electron-manual-test-*`、`.electron-scroll-*`、`.electron-user-data/` | ~70 MB | 手工调试 Electron userData，已 gitignore | 低 |
| A4 | `.tmp-run/`、`.tmp-running-*`、`.tmp-scroll-*`、`_tmp_5928_*`、`.tmp-audit/` | ~1 MB | 滚动条调试探针；`.tmp-audit` 为本次审计临时脚本 | 低 |
| A5 | `.newmax-dev-desktop.log`、`.newmax-runtime-test.log`、`.newmax-storage-test.log`、`.shots/`、`.zcode/`、`.restart-app.ps1` | <1 MB | 日志/截图/一次性脚本，已 gitignore | 低 |
| A6 | `apps/desktop/release/win-unpacked`、`win-unpacked-alpha`、`win-unpacked-v0.1.0-rc.1*`、`win-unpacked-update-e2e-upgrade`、`win-unpacked-beta1`、`win-unpacked-audit` | 108 KB × 6 + 870 MB | 前 6 个只剩 `default_app.asar` 空壳（`win-unpacked` 被某进程锁定可能删不掉）；`win-unpacked-audit` 是本次审计重新 stage 的完整包 | 低 |
| A7 | `.turbo/` | 2.8 GB | 纯缓存，下次 build 重建（首次慢 1–2 分钟） | 低 |
| A8 | `apps/cli/`、`apps/mcp-server/{dist,node_modules,tsconfig.tsbuildinfo}` | 小 | git 只跟踪 `apps/mcp-server/platform-mcp-server.mjs`；`apps/cli` 整体未跟踪且无源码，但 `pnpm-workspace` 的 `apps/*` 会把它们当包扫描 | 低（保留 `platform-mcp-server.mjs`） |

**不建议动**：`.data/SYNC-THINK/`（运行中 daemon 的数据；`backups/` 26 GB 应由应用内保留策略处理）、`userdata-backup-20260907/`（待新版确认可用后再删）、`beta-share/` + zip（待上传网盘）。

---

## B. 建议从 git 移除 —— 误跟踪的非源码文件

| # | 路径 | 文件数 | 理由 | 风险 |
|---|---|---|---|---|
| B1 | `Sync-Think/conversations/conv-1784715248707/images/*.png` + `Sync-Think/docs/` | 54 | 某次对话截图被提交（4.8 MB）；`.gitignore` 已有 `/Sync-Think/conversations/` 但文件在规则加入前已被跟踪；仓库内无引用 | 低 |
| B2 | `.playwright-mcp/page-2026-07-20T*.yml` | 6 | Playwright MCP 页面快照，无引用 | 低 |
| B3 | `.desktop-governance-p04-sidecar.meta.json` | 1 | 8/2 一次 sidecar 运行元数据，指向已不存在的旧路径 `D:\projects\SYNC-THINK\.data\...` | 低 |
| B4 | `scripts/tmp-*.mjs`（9 个） | 9 | `tmp-` 一次性探针；root `package.json` scripts 无引用；仅 `tmp-goal-e2e` 在 `docs/development/10-current-status.md` 被提及一次 | 低（可先移到 `docs/examples/`） |

---

## C. 死代码 —— 旧一代 renderer 与零引用依赖

### C1. `apps/desktop/src/renderer/` 根目录的 M1/M2 时代模块（约 27 个文件）

生产 bundle 只从 `shell/shell-entry.tsx`（QA 用 `qa-entry.tsx`）打包（`build-shell.mjs:38`）。下列文件不被任何非测试源码引用，只被同名 `apps/desktop/tests/*.test.ts` 和 `scripts/selftest-m1-soft-regression.mjs` / `selftest-m2.mjs` 使用：

```
append-message-error.ts  beginner-workspace.ts  browser-profiles.ts  child-tasks.ts
collaboration-intent.ts  compose-models.ts  continuum-evidence.ts  left-instrument-switch.ts
m1-dogfood-draft.ts  m1-dogfood-fill-board.ts  m1-evidence-bundle.ts  m1-exit-chip-action.ts
m1-exit-evidence.ts  m1-exit-path.ts  m1-external-focus.ts  m1-handtest-doc-diff.ts
m1-handtest-paste.ts  m1-hardgate-strip.ts  m1-next-action.ts  m1-obs-layout.ts
m1-soft-regression.ts  m1-soft-snapshot.ts  m2-workspace.ts  provider-error-copy.ts
recent-conversations.ts  runtime-view-state.ts
```

- **保留**：`workspace-catalog.ts` 被 `shell/compose-skill-selection.ts` 引用；`shell/RightRail.tsx` 被 `product-shell-nav.ts` 引用（需一并判断 `product-shell-nav.ts` 是否仍活着）。
- `tsc` 仍会编译它们到 `dist/renderer/*.js`（17 MB，含 4.5 MB 旧 `index.js.map`），不进最终运行路径——纯构建时间与仓库噪音。
- 风险：**中**。删除前需同步删除对应 `tests/*.test.ts`，并让 `selftest:m1-soft` / `selftest:m2` 两个 root script 退役。属产品决策：M1/M2 里程碑验收脚本是否保留。

### C2. 零引用依赖

| 包 | 依赖 | 证据 | 建议 |
|---|---|---|---|
| `apps/desktop` | `@radix-ui/react-avatar`、`react-collapsible`、`react-context-menu`、`react-scroll-area`、`react-select`、`react-switch`、`react-tabs`、`react-tooltip` | desktop + ui-kit 源码零 import | 移除（devDependencies） |
| `apps/desktop` | `rehype-highlight` | 零 import（实际直连 `highlight.js`） | 移除 |
| `packages/core` | `xstate`、`@sync-think/protocol`、`@sync-think/storage`、`@sync-think/secure-store`、`@sync-think/adapters` | core/src 只 import `@sync-think/shared` | 移除；`xstate` 是 dependencies，安装包少 2.6 MB |
| `packages/adapters`、`packages/workers` | `@sync-think/protocol` | 零 import | 移除 |
| `packages/ui-kit` | `@testing-library/dom`、`react-dom` | 零 import | 待复核（`react-dom` 可能是 peer） |
| `apps/desktop` | `jsdom` | vitest 环境用 | **保留** |

---

## D. 安装包体积与安装速度

实测：安装器 224 MB（NSIS normal 压缩），**解包落盘 ~860 MB**（`portableBytes: 899,762,600`）。安装慢的根因是解压写入 860 MB，不是下载。

| 组件 | 体积 | 占比 | 说明 |
|---|---|---|---|
| `resources/runtime/node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe` | **319 MB** | 37% | Claude Agent SDK 附带的 Claude Code 原生二进制 |
| Electron 33 运行时（exe 181 MB + locales 41 MB + dll/pak） | ~270 MB | 31% | `locales/` 41 MB 可裁到 zh/en |
| `resources/node/`（Node 20.20.2 + npm） | 85 MB | 10% | npm 用于运行时安装托管内核 |
| `resources/runtime/node_modules` 其余 | ~140 MB | 16% | 飞书 SDK 29 MB（一个 17 MB `.d.ts`）、drizzle-orm 13 MB、better-sqlite3 12 MB（含 8.9 MB `sqlite3.c`）、IM SDK ~15 MB |
| `resources/app/` | 58 MB | 7% | playwright-core 13 MB、excalidraw-vendor 8 MB |

### 瘦身方案（按收益排序）

| # | 方案 | 预计减少（解包） | 难度 | 说明 |
|---|---|---|---|---|
| D1 | **不打包 `claude-agent-sdk-win32-x64`，改由托管内核按需下载** | **-319 MB（-37%）** | 中 | `claude-sdk-adapter.ts:328` 已优先用 `resolveManagedKernelExecutable('claude-code')`，`.data/SYNC-THINK/kernels/active.json` 指向托管 `claude-code 2.1.258`；SDK 内置 exe 只是兜底。需决策首次启动是否允许「无 Claude 内核」 |
| D2 | `pnpm deploy` 后剪掉 `.d.ts`、`*.map`、`src/`、`deps/*.c`、README/CHANGELOG | -40～60 MB | 低 | `pruneOwnedPayload`（`windows-portable-release.mjs:478`）已有骨架，扩展 `OWNED_PRUNE_NAMES` |
| D3 | Electron `locales/` 只留 `zh-CN.pak`、`en-US.pak` | -38 MB | 低 | stage 复制 `electronDist` 时过滤 |
| D4 | `compression: normal → maximum` | 安装器 -30～50 MB，解包不变 | 低 | 下载更快但解压更慢，对「安装慢」无帮助，不建议 |
| D5 | IM 桥接 SDK 改按需安装/拆插件 | -50 MB | 高 | 架构级，暂不建议 |
| D6 | 移除 `xstate`；审视 `playwright-core` 是否需随 desktop 发布 | -2.6 / -13 MB | 低 / 中 | |

执行 D1+D2+D3 后预计解包 **860 MB → ~450 MB**，安装器 224 → ~130 MB。

---

## E. 一处需知晓的差异

`apps/desktop/release/installer/` 当前的安装器（10:12 生成，224 MB，sha `eb43fd…`）与上午 09:2x 打包放进 `public/`、`beta-share/`、zip 的那份（313 MB，sha `3a120d…`）**不是同一文件**——中途有进程用相同命令重新打了一次。`public/index.html` 的哈希对应 313 MB 那份。建议对外只发一份，并重跑 `assemble-beta-public.mjs` 让下载页哈希与实际文件一致。

---

## 建议执行顺序

1. **A（磁盘垃圾）**：可立即执行，释放约 13 GB，零功能影响。
2. **B（误跟踪文件）**：`git rm --cached` + 提交，仓库瘦 5 MB。
3. **C2（零引用依赖）**：改 `package.json` → `pnpm install` → `pnpm typecheck && pnpm test` 验证。
4. **D2 + D3（打包剪裁）**：改 stage 脚本，重新 stage/verify 看体积。
5. **C1 + D1**：需产品决策，确认后再做。
