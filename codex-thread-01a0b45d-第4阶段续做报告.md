# Codex 线程续做报告 — 第 4 阶段「外部内核协作工具通道」

> 承接 `codex-thread-01a0b45d-进度报告.md`。本轮完成第 4 阶段未完成清单中的第 1 项（Kernel/MCP 外部协作工具注册）与第 4 项前半（整仓构建与运行时验证）。
> 日期：2026-09-21

---

## 一、本轮完成的核心工作：external kernel 协作工具通道补齐

### 缺口（本轮开始时）

| 通道 | 状态（本轮前） | 状态（本轮后） |
|---|---|---|
| native（模型/Agent 直连）目录 | ✅ 已注入 `CHAT_COLLABORATION_TOOL_SCHEMAS`（chat-tools.ts:1750） | 不变 |
| native 执行 | ✅ `executeChatAgentTool` → `executeChatCollaborationTool` | 不变 |
| **external kernel 目录（claude-code/codex/pi）** | ❌ `buildPlatformMcpToolDefinitions` 未注入；registry 13 个 server 无协作 server | **✅ 已补齐** |
| **external kernel 执行分发** | ⚠️ 经 `CHAT_AGENT_TOOL_NAMES` 已可达，但目录缺失使工具从未暴露 | **✅ 链路已锁定测试** |

### 代码改动（6 个文件）

1. **`apps/runtime/src/chat-tools.ts`** — 新增 `CHAT_COLLABORATION_TOOL_NAMES` 常量（协作工具名集合）。
2. **`apps/runtime/src/kernel/platform-tools.ts`** — `PlatformToolCatalogOptions` 新增 `collaborationEnabled`；`buildPlatformMcpToolDefinitions` 在该开关 + conversationTrack 存在时注入协作工具（与 native 目录同门槛）。
3. **`apps/runtime/src/kernel/mcp-servers/collaboration-server.ts`**（新文件）— `collaboration` server，含 `collaboration_send_message` / `collaboration_dispatch_tasks`；approval `outside-full-access`（与平台目录分类器一致），非 planningDenied（与 native 语义一致）。
4. **`apps/runtime/src/kernel/mcp-servers/registry.ts`** — 注册 `collaboration` server，condition = `collaborationEnabled`；`KernelMcpServerConditions` 新增该字段。
5. **`apps/runtime/src/runtime.ts`** — 2 处传入 `collaborationEnabled: this.isCollaborationConversationForThread(run.threadId)`（registry 条件注入 + legacy catalog 对齐，保证目录与执行校验一致）。
6. **测试锁定**（见下）。

### 执行链（现状，已验证）

```
claude-code  → SDK MCP（in-process）─┐
codex / pi   → stdio broker ─────────┴→ handlePlatformMcpToolCall（catalog 校验 + 审批分类器）
                                          → executeHostPlatformTool → CHAT_AGENT_TOOL_NAMES 命中
                                          → executeChatAgentTool → executeChatCollaborationTool
                                          → CollaborationChatHost.command（成员身份注入 + 落库）
```

协作会话三种 kind 的身份推导均已核对成立：`model` 会话 → `assistant:main`（成员存在）；`direct`/`group` → `agent:<协调者>`（成员存在）。

---

## 二、验证结果矩阵

| 验证项 | 结果 |
|---|---|
| 整仓 typecheck（22 任务） | ✅ 全绿（本轮改动后 runtime 单包复跑 exit 0） |
| 整仓 build（13 任务） | ✅ 13/13 成功；desktop renderer-shell / preload / runtime dist 均为最新产物（15:12-15:13） |
| 协作测试套件（8 文件） | ✅ **141 tests 全过**（含本轮新增 4 个锁定测试） |
| 新增锁定测试 | ✅ ① registry：协作 server 仅协作会话加载（external+native 可见性）② platform-tools：legacy catalog 注入与 track 门槛 ③ collaboration-runtime-execution：external kernel host 工具入口 → 协作执行器落库（含 SDK schema 桥接验证） |
| 整包 runtime 测试（265 文件） | 2019 passed / 8 failed —— 8 项经**对照实验**证明为预存在失败（见下） |
| 真实 codex 通道（selftest:codex-persistent） | 11/12 项通过；`tools` 项失败与本改动**零交集**（见下） |

### 预存在失败定性（8 项，非本轮引入）

失败文件：`conversation-transient-stream.test.ts`（6）、`conversation-content.test.ts`（1）、`platform-host-tools.test.ts`（1）。
**对照实验**：临时禁用全部协作路径（registry condition → `false`、runtime 两处 → `false`）后复跑 → **同一 8 项原样失败**；实验完全回滚（与备份逐字节一致）。
这 3 个测试文件 git 干净（= 9-18 版本，未跟随本线程 182 批重构更新），失败点在 delegation / transient replay / OCR 暴露条件——属本线程重构遗留的测试-源码错配。

### codex selftest「tools」项的排除依据

- 该脚本使用**静态 `PLATFORM_MCP_TOOL_DEFINITIONS`** + 直接 `executePlatformTool`，**不经** run 级目录构建、**不经** registry selection —— 与本轮改动代码路径零交集。
- 失败现象：模型把工具调用输出为文本（`to=mcp__sync-think-platform__file_write code:...`），产生 0 个结构化 toolCall；stderr 伴随 codex app-server 内部错误 `OutputTextDelta without active item`。
- 结论：codex 0.155.0 app-server 的事件流问题 + 模型未发起结构化调用，非本仓库改动所致。
- 其他 11 项（会话/持久化/同进程复用/resume/内存延续）全部通过 ✓。

---

## 三、副作用核验

- selftest workspace 为 `mkdtempSync` 临时目录；**不使用**用户数据库（`sync-think.db-wal` 的变化来自运行中的应用 daemon）。
- 实验备份 `registry.ts.bak` / `runtime.ts.bak` 位于 `.tmp/backup/`（临时目录内，可清理）。
- 期间「文件删除」告警（daemon-autostart 等 3 个测试文件）已逐一核验：文件完好、git 状态干净，为监控虚报。

---

## 四、剩余事项（留给后续）

1. **Electron GUI 实机验收**（本轮未做，需在应用内手动操作）：
   - 用「最新构建产物」启动（避免旧 Renderer）：注意 `.tmp/build.log` 中已验证 renderer-shell 产物为 15:12 构建。
   - 场景：创建协作会话（含 model/direct/group 三种）→ 将会话内核切换为 claude-code 或 codex → 要求模型调用 `collaboration_send_message`/`collaboration_dispatch_tasks` → 观察消息落库与审批卡行为。
2. **PLAN.md 第二阶段**（未开始）：群内单聊开关、规划版本关联、失败分支与消息恢复收口、活动中心聚合。
3. **预存在的 8 个测试失败**：建议单独排查（delegation 只读 allowlist / transient replay 序列 / OCR 暴露断言），与本协作任务独立。
4. **805 项未提交改动**：仍建议尽早提交保护性快照（本轮新增改动已包含其中）。

---

## 五、本轮改动文件清单

- `apps/runtime/src/chat-tools.ts`（+常量）
- `apps/runtime/src/kernel/platform-tools.ts`（+选项与注入）
- `apps/runtime/src/kernel/mcp-servers/collaboration-server.ts`（新增）
- `apps/runtime/src/kernel/mcp-servers/registry.ts`（+注册与条件字段）
- `apps/runtime/src/runtime.ts`（2 处传参）
- `apps/runtime/src/kernel/mcp-servers/registry.test.ts`（+锁定测试）
- `apps/runtime/src/kernel/platform-tools.test.ts`（+锁定测试）
- `apps/runtime/src/collaboration-runtime-execution.test.ts`（+host 分派锁定测试）

---

## 六、构建启动与验收（2026-09-21 下午）

### ⚠️ 修复了一个关键的「旧进程坑」

首次启动 dev 应用后检查发现：**数据库迁移停留在 0058**，协作所需的 `collaboration_kind` 列与 7 张 `collaboration_*` 表**均不存在**。

**根因**：机器上有一个 **2026-09-20 20:17 启动的常驻 managed-daemon / managed-runtime**（PID 35748/36820/35844，installId `dev-0001`），加载的是**当时的旧 dist**。新启动的 Electron 复用了这个旧 runtime（`sync-think-managed-runtime=dev-0001`），因此：
- 新编译的代码（含协作迁移与本轮改动）**完全没有生效**；
- 这正是「启动旧 Renderer」坑的同类——**runtime/daemon 也是常驻的**。

**处置**：停掉 Electron 与旧 daemon/runtime（含其子进程 codex app-server / platform-mcp-server）→ 干净重启。
**结果**：新 runtime（pid 26836，15:33）启动时自动完成 DB 备份 → 迁移到 **0061**：
- `0059_collaboration_chat`（7 张协作表全部创建）
- `0060_conversation_collaboration_kind`（列已就位）
- `collaboration_conversation / member / message / delivery / task / attempt / receipt` ✓
- 15 个可用 Agent ✓，已有协作会话 0 个（此前因迁移缺失从未创建成功）

> 教训：**每次更新代码后必须重启应用（或停掉 managed daemon）**，否则 Electron 会静默复用旧 runtime。

### 启动方式（已执行）

```bash
pnpm build            # 13/13 成功
pnpm dev:desktop      # 生产 shell；user-data 隔离于 .data/desktop-userdata-dev
```

### 已知环境问题（不阻塞、如实记录）

1. **模型 `gpt-5.6-luna`（provider CuiTaLiao-GPT，api.cuitaliao.top）返回 404**
   —— 15:27~15:30 三次调用均失败（`Provider Responses call rejected (404)`）。**验收前请先切换到可用模型**（如 DeepSeek `deepseek-flash` / KMKAPI-GPT 系列）。
2. **transient stream 协议错误**（`RuntimeProtocolError`，订阅响应缺字段/类型不符）
   —— 与前述 8 项预存在测试失败同源（本线程重构遗留），影响实时流显示；协作界面有 `collaboration.updated` 事件 + 10s 轮询兜底。
3. `backups/` 目录现存放 4 份 16~17GB 的迁移前备份（含今天新增），注意磁盘占用（~68GB），旧的可自行清理。

### 验收步骤

**A. 协作会话基础流程（native，验证迁移后协作可用）**
1. 侧栏悬停「智能体对话」轨道 → 点 `+` → 弹窗选「智能体单聊」→ 选一个 Agent → 「继续」
2. 会话内发一条消息 → 观察消息出现在协作流、协调者开始响应
3. 点「创建任务」→ 填「任务标题 / 任务说明」→ 「开始执行」→ 观察任务卡状态流转（排队中 → 执行中 → 已完成）
4. 点任务卡 → 任务详情（清单 / 结果 / 记录）；可试「停止当前任务」「重新执行」

**B. 群聊 + 并行（可选）**
- 「智能体群聊」需勾选 ≥2 个 Agent；观察多任务并行、任务卡独立

**C. 外部内核通道（本轮改动相关）**
- 说明：协作会话的执行当前固定走 native（`executeCollaborationTaskForHost` 不传 kernelId），**UI 暂无「协作会话 + codex/claude-code」入口**；本轮补齐的是该通道本身（协议 + registry + 执行器），由测试锁定。
- 可操作验证（不回归）：开一个**模型对话** → 模型选择器切到 **codex 内核** → 发消息（如让它用 file_write 写文件）→ 观察工具调用/审批正常，说明新增 server 未影响既有通道。
- 自动化复跑（现场可执行）：
  ```bash
  pnpm --filter @sync-think/runtime exec vitest run --testTimeout=15000 --minWorkers=1 --maxWorkers=1 \
    src/kernel/mcp-servers/registry.test.ts src/kernel/platform-tools.test.ts \
    src/collaboration-runtime-execution.test.ts src/collaboration-chat-service.test.ts
  ```

