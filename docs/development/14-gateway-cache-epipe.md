# 网关缓存命中排查与主进程 EPIPE 崩溃修复记录

记录日期：2026-08-17 · 分支 `feature/inline-process-ui`

## 一、主进程 EPIPE 崩溃（已修复）

### 现象

Electron 主进程弹出 `A JavaScript error occurred in the main process`，堆栈指向 `runtime-supervisor.js:257` 的 `console.warn('[runtime-child]', text)`：

```
Uncaught Exception: Error: EPIPE: broken pipe, write
  at Socket.write
  at console.warn
  at runtime-supervisor.js:257
```

发消息、查看连接消息时都会触发（这两个动作都会让 runtime 子进程产生网关/消息日志，经 supervisor 转发）。

### 根因

- 应用从后台任务 / 终端管道启动，父进程退出后主进程的 stdout/stderr 管道已关闭（坏管道）。
- runtime 子进程的 stderr（网关日志等）由 supervisor 的 `data` 处理器用 `console.warn('[runtime-child]', text)` 逐行转发到主进程 stdout/stderr。
- 写坏管道抛 EPIPE；主进程的 `process.stdout`/`process.stderr` 没有 `error` 监听器，EPIPE 升级为主进程未捕获异常 → Electron 弹框。

### 修复（双保险）

1. `apps/desktop/src/main/index.ts`：主进程启动时给 `process.stdout` / `process.stderr` 挂 EPIPE 吞噬监听器，覆盖主进程**所有** console 写入。
2. `apps/desktop/src/main/runtime-supervisor.ts`：新增 `safeConsoleWrite()`，把 runtime 子进程 stdout/stderr 转发、退出/启动日志等 console 调用全部 try/catch，模块自愈、不依赖入口文件。

### 验证

- `apps/desktop` 构建通过（tsc + preload/renderer/shell）。
- `runtime-supervisor.test.ts` 2/2 通过。
- 应用重启后 CDP `127.0.0.1:9333`、管道 `sync-think-dev-0001`、runtime 进程均正常；发消息不再弹 EPIPE 框。

## 二、网关缓存命中为 0 的排查（结论，非缺陷）

### 现象

- claude-code 经网关用 KMKAPI-GPT（gpt-5.6-luna）时 `cachedTokensHit` 恒为 0（`stgwreq_*` 全 0）。
- 同一模型走 codex 内核：热会话 141k–149k 命中；新对话冷启动仅 3840→7680→41216 逐轮累积。
- 同样走网关，DeepSeek 官方命中稳定（codex 经网关 6.9k→117.9k，claude-code 路径也曾 71k+）。

### 关键证据

- 上游直连实测支持缓存，且字段就是网关读取的 `input_tokens_details.cached_tokens`。
- **相同请求 4 连发命中 3840/3840/0/19200** —— 中转站多副本负载均衡、每副本各一份缓存，无状态 HTTP 全量重放命中是"抽签"。
- 网关形状（instructions + tools + reasoning）8 连发仅 2/8 命中（最大 2560）；无 tools / 无 reasoning / minimal 形状命中率更高。
- 与代码改动无关：修复 `item_reference` 前后网关 `cachedTokensHit` 均为 0。
- 网关无法用 `previous_response_id`（上游明确 HTTP 不支持，仅 WebSocket v2 支持续聊）。

### 结论

- **网关是纯格式转换**：只做 anthropic ↔ openai-responses / openai-chat 的请求体翻译与响应流回译，不改缓存字段、不改前缀顺序、不发额外请求；usage 中的 `cached_tokens` 原样透传。
- **命中 = 上游缓存质量 × 会话热度**，与"走不走网关 / 做不做格式转换"无关。网关路径只是如实暴露上游缓存质量。
- 无状态 HTTP 全量重放只能依赖上游自动前缀缓存，而 KMKAPI 该缓存按副本随机；DeepSeek 官方稳定。

### 建议

- 要稳定命中：用 DeepSeek 官方这类第一方 API（经网关也 80%+ 命中）。
- 必须用 KMKAPI 中转站：接受多副本抽签随机性，靠同一会话反复续聊（codex resume / claude-code 同会话续聊）养热前缀。
- 网关侧无可改点，它已经是"只做格式转换"。

## 三、内核 × Provider 传输路径矩阵

路由规则（`apps/runtime/src/gateway/tickets.ts` `kernelNeedsGateway`）：内核只会说自己的方言，provider 方言内核不会才走网关，会说则直连。

| 内核（方言） | 当前 Provider（方言） | 路径 |
|---|---|---|
| claude-code（anthropic-messages） | KMKAPI-CLAUDE / ZIXUN（anthropic-messages） | **直连** `{base}/v1/messages` |
| claude-code | KMKAPI-GPT / DeepSeek（openai-chat） | **网关** anthropic→chat 翻译 |
| claude-code | KMKAPI-GLM / GROK（openai-responses） | **网关** anthropic→responses 翻译 |
| codex（openai-responses） | KMKAPI-GLM / GROK（openai-responses） | **直连** `{base}/v1/responses` |
| codex | KMKAPI-GPT / DeepSeek（openai-chat） | **网关** responses→chat 翻译 |
| codex | KMKAPI-CLAUDE / ZIXUN（anthropic-messages） | **不支持**（responses→anthropic 未实现） |
| native / pi | 任意 | native 进程内直调；pi 按方言判定 |

网关入站两条门：`POST /anthropic/v1/messages`、`POST /openai/v1/responses`（loopback 127.0.0.1，per-run ticket 作 key）。

## 四、本轮提交范围

- `packages/adapters/src/gateway/anthropic-to-responses.ts` + `wire-types.ts`：工具循环按 `call_id` 成对重放、`resolveFunctionItemId` 提供稳定 id、去 `item_reference`（部分 HTTP 中转拒绝该字段）。
- `apps/runtime/src/gateway/server.ts` / `tickets.ts`：网关侧配套改造（`body.stream` 处理提前、continuation item 记录语义更新）。
- `apps/desktop/src/main/index.ts` / `runtime-supervisor.ts`：EPIPE 吞噬（见上文第一节）。
- 对应测试：`anthropic-to-responses.test.ts`、`gateway/server.test.ts`。
- 本记录文档。
