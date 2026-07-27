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
