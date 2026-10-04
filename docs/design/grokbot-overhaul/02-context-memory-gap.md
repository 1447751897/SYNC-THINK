# OV2 · 上下文与记忆：现状差距 + 改造规格

> 主题：把 SYNC-THINK 现状的 **上下文装配 / 记忆 / 会话** 与 Grok Bot 实测机制逐条对齐，给出可落地的改造规格。
> 产出物：本文件 + `.tmp-grok-bot/scripts/ov2-context-budget.mjs`（实测脚本）+ `.tmp-grok-bot/scripts/ov2-pin-anchors.mjs`（版本锚定）+ `.tmp-grok-bot/scripts/ov2-anchors.json`（锚点快照）。

## 0. 方法与版本基准

### 0.1 证据分级

| 标记 | 含义 |
|---|---|
| 【代码】 | 直接读源码得到的事实，附 `文件:行` |
| 【数据】 | 用脚本对真实代码/真实产物测量得到的数字 |
| 【推断】 | 由代码/数据推出、但未被直接实现或测试确认 |
| 【未证实】 | 无证据，明确留白 |

### 0.2 ⚠️ 并发编辑警告（重要）

分析期间 `apps/runtime/src/` **正在被并发修改**。实测时间线：

- `apps/runtime/src/task-room.ts` 在本次分析中被改过：10:21 时是 133 行的旧版（`remaining = 12_000` 全局预算、单条 `slice(0, 12_000)`），11:13 后变成 143 行的新版（新增逐条 `include(message, limit)` 配额与截断提示语）。【数据】`ov2-context-budget.mjs` 输出第 5 节。
- `apps/runtime/src/runtime.ts` 在几分钟内多次出现 32,426 / 33,565 / 33,566 行的中间态。

**因此本文件所有 `文件:行` 均以下表哈希为准**（由 `.tmp-grok-bot/scripts/ov2-pin-anchors.mjs` 在 `2026-10-01T03:14:43Z` 一次性抓取）。若行号漂移，请以函数名 + 锚点表（附录 A）重新定位。

| 文件 | sha256:16 | 行数 |
|---|---|---|
| `apps/runtime/src/task-room.ts` | `241CF6F8CAF453CD` | 143 |
| `apps/runtime/src/collaboration-workflow.ts` | `AF46993130B1406E` | 101 |
| `apps/runtime/src/runtime.ts` | `B141BDA15F83452F` | 33566 |
| `apps/runtime/src/context-snapshot.ts` | `E86290388CAC8F63` | 261 |
| `apps/runtime/src/context-message-history.ts` | `7D57D53468960AE2` | 226 |
| `apps/runtime/src/chat-tools.ts` | `DE05123E22EE71ED` | 3848 |
| `apps/runtime/src/collaboration-chat-service.ts` | `FB6B65F27AA5BF97` | 1190 |
| `packages/core/src/context-packet.ts` | `A4FAD2ED2A343624` | 763 |
| `packages/storage/src/memory-store.ts` | `DA8E01D037D84437` | 607 |
| `packages/storage/src/schema/memory.ts` | `687A880233762DA0` | 76 |

### 0.3 复现方式

```powershell
# 实测一次 room turn 的上下文块构成（导入的是 live TS 源码，不是 dist）
node_modules\.bin\tsx.cmd .tmp-grok-bot\scripts\ov2-context-budget.mjs

# 重新锚定所有 文件:行（并发编辑后行号漂移时用）
node .tmp-grok-bot\scripts\ov2-pin-anchors.mjs

# 校验本文件里全部 文件:行 引用是否仍然落在有效行、且内容匹配
node .tmp-grok-bot\scripts\ov2-verify-citations.mjs
```

**引用书写约定**（`ov2-verify-citations.mjs` 按此约定解析裸文件名）：

| 裸写法 | 实际路径 |
|---|---|
| `runtime.ts` / `task-room.ts` / `context-snapshot.ts` / `chat-tools.ts` / `collaboration-*.ts` | `apps/runtime/src/…` |
| `context-packet.ts` | `packages/core/src/context-packet.ts` |
| `memory-store.ts` / `schema/memory.ts` | `packages/storage/src/…` |
| `memory-command-contract.ts` | `packages/protocol/src/…` |
| `06-official-docs-and-public-narrative.md` 等 `0N-*.md` | `docs/research/grok-bot/…` |
| `0004-task-room-execution.md` | `docs/adr/…` |

**校验状态**：`ov2-verify-citations.mjs` 对本文件报 `151/151 引用可解析，范围越界=0，内容不符=0`（校验时间与 §0.2 快照同批）。该脚本同时是"实施前先校验锚点"的工具。

---

## 1. 现状装配还原：一次 room turn 到底给模型发了什么

### 1.1 仓库里存在**三套互不相通**的上下文装配

| # | 路径 | 触发 | 组装点 | 是否读记忆 | 每轮预算 |
|---|---|---|---|---|---|
| P1 | **Context Packet**（app 层聊天） | 普通对话/Agent 对话 | `Runtime.prepareRunBinding` → `selectContextSources({tokenBudget: 8_000})`【代码】`apps/runtime/src/runtime.ts:25211-25221` | ✅ 读 | 8,000 tokens（软） |
| P2 | **Room 上下文块**（task room） | 群聊里的一次 attempt | `buildTaskRoomContext`【代码】`apps/runtime/src/task-room.ts:56` | ❌ **明确不读** | 无 token 预算，见 §1.2 |
| P3 | **Kernel system context**（外部内核 claude-code/codex） | 外部内核 run | `buildKernelSystemContext`【代码】`apps/runtime/src/runtime.ts:22407` | ❌（只有一段文字说明） | 无 |

**P1 与 P2 的分叉点是 `runtime.ts:25050`**：

```ts
if (this.memoryStore && !this.collaborationThreadScopes.get(input.threadId)?.input.snapshot.conversation.room) {
```

即：**任务群（room）被显式排除在 Context Packet 的记忆装配之外**。【代码】`apps/runtime/src/runtime.ts:25050`

### 1.2 room turn 的完整装配顺序（实测 `buildTaskRoomContext`）

room 模块整体被当成**一个** project-context 块塞进系统提示词【代码】`apps/runtime/src/runtime.ts:21344-21345`：

```ts
prepared.run.projectContextPromptBlocks = [...(prepared.run.projectContextPromptBlocks ?? []),
  buildCollaborationExecutionContext(input.snapshot, input.task, input.attempt, ...)];
```
其中 `snapshot.conversation.room` 存在时走 `buildTaskRoomContext`【代码】`apps/runtime/src/collaboration-workflow.ts:46-47`。

块内顺序（`task-room.ts:63-92`，按数组序）：

| # | 段 | 来源 | 条数/字节上限 | 截断策略 | 代码 |
|---|---|---|---|---|---|
| 1 | 固定隔离声明 | 字面量 | 固定 ~120 字 | — | `task-room.ts:64` |
| 2 | 群聊标题 + roomId/taskId/purpose | conversation / task | 无上限 | — | `task-room.ts:65` |
| 3 | `<confirmed_goal>` | `room.goal` | **20,000 字符** | 硬 slice + 提示语 | `task-room.ts:66-67` |
| 4 | 当前请求 | `task.instructions` | **无上限** | 无 | `task-room.ts:68` |
| 5 | 群内沟通规则（2 段） | 字面量 | 固定 | — | `task-room.ts:69-70` |
| 6 | 咨询继续提示 | `attempt.awaitingPeerTaskIds` | 无上限（task id 列表） | 无 | `task-room.ts:71` |
| 7 | 咨询应答角色提示 | `task.consultation` | 固定 | — | `task-room.ts:72` |
| 8 | 角色提示（discussion / coordination / work 三选一） | `task.purpose` | 固定（discussion 分支较长） | — | `task-room.ts:74-80` |
| 9 | 当前可用成员 roster | `snapshot.members`（active 且非 user） | **无上限** | 全量 JSON | `task-room.ts:81` |
| 10 | 负责小队 | `actor.teamSnapshot`，仅 coordination | 无上限 | 全量 JSON | `task-room.ts:82` |
| 11 | 检查点 | `room.checkpoint` | 3 个数组各 **60** 条；note **3,000 字符** | `slice(-60)` / `slice(0,3000)` | `task-room.ts:83` |
| 12 | 工作索引 | `tasks.filter(isRoomWork)` | **60** 条 | `slice(-60)` | `task-room.ts:84` |
| 13 | `<selected_room_history>` | 选中消息 | **12,000 字符总预算 / ≤24 条 / 触发消息 ≤4,000 / 其他单条 ≤3,000 / 单条下限 180** | 逐条配额 + 截断提示语 | `task-room.ts:26-54, 85` |
| 14 | 省略计数提示 | `manifest.historyOmitted` | 固定 | — | `task-room.ts:86` |
| 15 | `<artifact_index>` | 全 room 所有 attempt 的 artifacts | **60** 条（含 `path`/`title` 全文） | `slice(-60)` | `task-room.ts:62, 87` |
| 16 | 回读指引（2 段） | 字面量 | 固定 | — | `task-room.ts:88-89` |
| 17 | 续做提示 | `attempt.resumeFromAttemptId` | 固定 | — | `task-room.ts:89` |
| 18 | 交付要求 | `task.deliverable` | 无上限 | — | `task-room.ts:90` |
| 19 | 工作区隔离声明 | 字面量 | 固定 | — | `task-room.ts:91` |

**历史选择算法**（`roomContextSelection`，`task-room.ts:26-54`）：

1. 触发边界冻结：只取 `sequence <= attempt.contextSequence` 且 `kind !== 'system'` 的消息【代码】`task-room.ts:27`。
2. 触发消息（`task.originMessageId`）**先无条件入选**，配额 4,000 字符【代码】`task-room.ts:41`。
3. 其余按 sequence **从新到旧** 扫描，每条配额 3,000 字符，`selected.size >= 24` 停止【代码】`task-room.ts:42-45`。
4. 单条可用配额 `min(limit, remaining)`；`budget < 180` 直接跳过该条【代码】`task-room.ts:33-34`。
5. 被截断的消息会**内联一条回读提示**（含总字符数与 `collaboration_read_context` 调用样式）【代码】`task-room.ts:35-36`。
6. 输出按 sequence 升序重排【代码】`task-room.ts:46`。

### 1.3 这个块在系统提示词里的位置

`ContextSnapshotBuilder.build` 的拼接顺序是固定的【代码】`apps/runtime/src/context-snapshot.ts:179-181`：

```
systemPrompt = [ System instructions, Agent / Team instructions, Project context, Compact summary ].join('\n\n')
```

- room 块属于 **Project context**（`projectContextPromptBlocks`）【代码】`runtime.ts:31214`、`runtime.ts:31219`。
- `Agent / Team instructions` 由 `buildRunAgentInstructions` 生成【代码】`runtime.ts:9444-9506`，内含：Agent 身份 + **persona**【代码】`runtime.ts:9457-9477`、个性化设置、help mode、**绑定的 Skill 正文**【代码】`runtime.ts:9478-9484`、collaboration 提示【代码】`runtime.ts:9446-9447`。
- 该 `systemPrompt` **就是真实发给 provider 的内容**：`requestExtras = snapshot.providerRequest`【代码】`runtime.ts:31432`。
- 分段 token 估算由 `estimateTextTokens = ceil(Buffer.byteLength(text,'utf8') / 4)` 给出【代码】`apps/runtime/src/context-snapshot.ts:81-84`。

### 1.4 会话消息（messages）那一侧

- 原生内核每轮重建：`buildChatProviderMessages`【代码】`runtime.ts:26323`。
- 历史读取上界：按页 100 条、最多 100 页，累计粗估 token ≥ `contextWindow * 1.25` 或越过 compact 边界即停【代码】`runtime.ts:26303-26319`。
- 最终裁剪：`selectRecentMessagesWithinBudget(messages, floor(contextWindow * 0.82))`【代码】`runtime.ts:26379-26382`、`context-snapshot.ts:108-127`。
- compact 边界之前的历史被过滤掉【代码】`context-message-history.ts:164-171`。

### 1.5 context manifest 现状 vs ADR-0004 承诺

ADR-0004 承诺 attempt 记录「room、触发边界、选中的 message IDs、artifact 引用、省略计数、continuation candidate」【代码】`docs/adr/0004-task-room-execution.md:23`。

实测 `roomContextSelection(...).manifest` 的键（脚本第 2 节）：

```json
["artifactIds","continuation","historyOmitted","messageIds","purpose","roomId","sourceSequence"]
```

| ADR 承诺 | 实际 | 结论 |
|---|---|---|
| room | `roomId` | ✅ |
| 触发边界 | `sourceSequence`（= `attempt.contextSequence`） | ✅ |
| 选中的 message IDs | `messageIds` | ✅ |
| artifact 引用 | `artifactIds`（`slice(-60)`） | ✅ |
| 省略计数 | `historyOmitted` | ✅ |
| continuation candidate | `continuation`（`resume_candidate` / `fresh`） | ✅ |

**但 manifest 缺四类关键信息**：

1. **没有 token/字节预算与实际占用**——无法回答"这一轮为什么这么贵"。
2. **没有逐条 source kind**（goal / checkpoint / roster / history / artifact 各自的占比），与 Context Packet 的 `ContextSourceRef{id,kind,tokenEstimate}`【代码】`packages/core/src/context-packet.ts:19` 不兼容。
3. **没有 truncation 记录**——历史被逐条截断、goal 被 slice，均不入 manifest；而 Context Packet 侧是有 `truncations[]` 的【代码】`context-packet.ts:734`。
4. **只在 claim 时冻结一次**：`attempt.contextManifest = roomContextSelection(...).manifest`【代码】`collaboration-chat-service.ts:728`；之后 `buildTaskRoomContext` 会**再算一次**选择（`task-room.ts:58`），两次结果共享同一输入所以一致，但**工具回读（`collaboration_read_context`）不会回写 manifest**，`historyOmitted` 永远是首轮值。

### 1.6 现状缺陷清单（编号供后续引用）

| # | 缺陷 | 证据 | 严重度 |
|---|---|---|---|
| **C1** | **room 完全不读也不写记忆**：两道显式闸门 | 【代码】`runtime.ts:25050`（读）、`runtime.ts:32350-32355`（写）；并被测试固化：`expect(memoryReads).not.toHaveBeenCalled()`【代码】`collaboration-workflow.integration.test.ts:144-145` | 高 |
| **C2** | **预算按"字符"算，token 按"字节/4"算**，中文场景 3× 偏差 | 【代码】`task-room.ts:30`（`remaining = 12_000` 作用于 `String.length`）vs `context-snapshot.ts:81-84`（`Buffer.byteLength`）；【数据】场景 D：预算命中 11,922 字符 = **35,644 字节** | 高 |
| **C3** | **artifact_index 无 token 上限**，饱和时是最大单层 | 【代码】`task-room.ts:62, 87`（仅 `slice(-60)`，含 `path` 全文）；【数据】场景 C：27,154 字节（占整块 35%） | 高 |
| **C4** | **confirmed_goal 硬编码 20,000 字符**，占比与 artifacts 相当 | 【代码】`task-room.ts:66`；【数据】场景 C：20,046 字节 | 中 |
| **C5** | **整个 room 块没有 token 预算/溢出策略**：超过 `12,000`（历史）+ 各 `slice(-60)` 后没有任何再裁剪 | 【代码】`task-room.ts:56-92` 全无预算参数 | 高 |
| **C6** | **room 轮次不被自动压缩覆盖**：`/compact` 与阈值判定基于 `conversation.taskId → task.threadId`【代码】`runtime.ts:10671, 10692-10696`，而 room attempt 跑在 `attempt.threadId ?? "conversationId:taskId"`【代码】`runtime.ts:21308` | 【代码】+【推断】两条 thread 不重合 ⇒ `shouldAutoCompact`【代码】`context-snapshot.ts:253` 判定的是**另一条 thread 的占用** | 高 |
| **C7** | **记忆 entry_key 未按 scope 命名空间隔离**：`deactivateActive` 只匹配 `workspace_id + entry_key + active=1`【代码】`memory-store.ts:486-493`；索引也非唯一【代码】`schema/memory.ts:50` | 同名 key 的 task 级与 project 级条目会互相顶掉 | 中 |
| **C8** | **run-digest 自动批准**：每个 run 都 `autoApprove: true` 写入一条 `run-digest:<ulid 前10位>`【代码】`runtime.ts:32350-32390`，无去重、无上限 | 记忆表单调膨胀，靠 `listActiveEntries(limit:16)`【代码】`runtime.ts:25053-25057` 兜住注入端，但存储端无界 | 中 |

---

## 2. 三层对照：SYNC-THINK vs Grok Bot

### 2.1 层级映射

| 层 | SYNC-THINK 现状 | Grok Bot 0.63.0 |
|---|---|---|
| **Bot 层**（"我是谁"） | `GlobalAgent` / `AgentVersion`：persona、developerInstructions、`skillVersionIds`、`mcpServerIds`、`memoryScope`、权限、模型【代码】`packages/storage/src/agent-store.ts:64, 99`；注入点 `runtime.ts:9457-9484` | `GrokBotAgentDefinition{ sessions[], room_members[], memory_shards[], routines[], recipe_skills[], mcp_settings, mcp_servers[] }`【代码】`docs/research/grok-bot/02-context-and-memory.md:24` |
| **Room 层** | `conversation.room`：goal(+revision)、checkpoint、state；成员 roster；tasks；attempts；artifacts；**按 room 哈希的 cwd** | **群聊有自己的 transcript**（`isGroup:true` 的独立 agent 实体）【数据】`02-context-and-memory.md:317, 341, 359-360`；但 group turn 只下发 `room{id,name,description} + peers[] + new_messages[]`【代码】`02:116` |
| **Turn 层** | `task` + `attempt`：purpose 角色提示、instructions、`awaitingPeerTaskIds`、`contextSequence` 边界、`contextManifest` | `RequestGrokBotRoomMemberTurnRequest{ room, member_agent_id, peers[], new_messages[]{speaker_kind, speaker_name, is_self, text, reply_to}, is_winding_down, deadline_ms, ... }`【代码】`02:116` |
| **Agent 记忆** | ✅ 有表（`memory_entry`），❌ room 不用 | ✅ `memory_shards[]` 嵌在 per-agent definition 内，`folder{profile, logs[]}`【代码】`02:130-152` |
| **团队记忆** | ❌ 无 | ⚠️ 有，但**必须显式提升**：`PromoteGrokBotMemoriesToTeam{agent_id, fact_ids[]}` → `{created[], already_in_team[], kept_private_count}`【代码】`02:163-164` |
| **团队上下文摘要** | ❌ 无 | ✅ `GrokBotTeamContextSummary{ memory_version, generated_at_ms, prose, summary_model }` + `learned[]{fact_id,text,learned_at_ms}` + `skills[]`【代码】`02:166-168` |

### 2.2 逐项差异表

| 维度 | SYNC-THINK | Grok Bot | 差距判定 |
|---|---|---|---|
| **transcript 归属** | **per-room**（消息在 `conversation` 上，attempt 按 `contextSequence` 冻结边界） | **per-agent**，且跨 1:1 与所有群共享同一份历史 | 【Grok 劣势】员工原话：「Each bot has one conversation and one memory, and that single history spans both its 1:1 chat with you and every group it is a member of... its saved memories belong to the bot, not to a chat」【代码】`06-official-docs-and-public-narrative.md:290`。**我们不要抄这一点** |
| **群消息投影** | 每条消息带 `senderMemberId`，模型看到全部作者的 room 历史 | 逐成员投影 + `is_self` 标记自己【代码】`02:116`，但渲染端**零读取点**（`is_self` 在 proto+daemon+coordinator 各仅 2 处类型定义）【代码】`02:361, 442` | 现状等价；`is_self` 的价值在 Grok 侧未兑现 |
| **增量 vs 全量** | ✅ 增量：`contextSequence` 冻结 + 12k 字符滑窗 + `historyOmitted` 提示 | ❌ **每轮重发完整 transcript**（员工承认 "The full transcript gets sent back to the model on every turn... isn't intended behavior"）【代码】`06:277, 279` | **我们已领先**，但要防退化 |
| **PASS / 不发言** | 无显式 PASS；讨论轮由 `task.purpose='discussion'` + 无 `expectsResponse` 的消息不唤醒 | 协议有 `is_winding_down` / `deadline_ms`，但 PASS 语义在解密产物中未见实现【未证实】 | 均无语义化 PASS |
| **记忆写入** | ✅ 有 `memory.propose` RPC + 审批【代码】`packages/protocol/src/memory-command-contract.ts:11-28`；❌ room 被排除；❌ 自动 run-digest 是 `autoApprove:true` | 用户显式 "Add Memories" 按钮；模板初始化时**要求 agent 自己写**（`update_state target "memory" action "write" tier "log"`）【代码】`02:180-181` | 结构相近，**触发点不同**（我们缺"人类显式记住这条"的入口与 agent 自主写） |
| **记忆提升** | ❌ 无 bot→team 通道 | ✅ fact 级显式提升 + `kept_private_count`【代码】`02:163-164, 206` | **必须补**，且要人类批准 |
| **记忆注入位置** | P1 路径：作为 `project-memory` source 进入 Project context【代码】`runtime.ts:25058-25083`，格式 `Project memory [scope] · date key: value`【代码】`runtime.ts:25074-25077` | 【推断】系统提示之后、工具描述之前【代码】`02:188` | 位置可对齐 |
| **压缩** | ✅ `PreCompact` 对等物存在：`conversation.compact` + `COMPACT_KEEP_RECENT_MESSAGES=8` + 70% 阈值【代码】`chat-tools.ts:2439-2454`、`context-snapshot.ts:4`；❌ 不覆盖 room thread（C6） | `PreCompactRequestQuery{ trigger, context_usage_percent, context_tokens, context_window_size, message_count, messages_to_compact, is_first_compaction }`【代码】`02:244-260`；摘要写回 `ConversationMessage.conversation_summary`，**不写 memory_shard**【代码】`02:285-290` | 机制对等；**我们的覆盖范围有洞** |
| **原始数据保留** | 保留（compact 只按 `compactedAt` 过滤注入）【代码】`context-message-history.ts:164-171` | 保留（最老 `seq=1` 仍在，按 `epochHint` 重放）【代码】`02:290` | ✅ 一致，保持 |

### 2.3 结论：三层该装什么

- Grok 的 `per-agent transcript` 是**反面教材**（跨群串味的根因，`06:290-292`），不是目标。我们要的是 **per-room transcript + per-agent memory + 显式提升到 room/team**。
- Grok 的 `GrokBotTeamContextSummary{memory_version, prose}` 值得抄**形状**：一个带版本号的、模型生成的散文简报 + 结构化 learned[]。
- Grok 的 group turn 请求体**故意不包含**该成员的记忆/技能/transcript【代码】`02:118`——但它也没提供替代通道，导致"新加群成员看不到加入前历史"（`06:300`，【推断】）。我们必须在 room 边界内**主动注入 room 记忆**。

---

## 3. 记忆现状与最小可用方案

### 3.1 SYNC-THINK 已经有什么

| 资产 | 位置 | 说明 |
|---|---|---|
| `memory_change` 表 | 【代码】`packages/storage/src/schema/memory.ts:6-29` | `workspace_id, task_id, target_scope, additions_json, modifications_json, deprecations_json, evidence_refs_json, confidence, unresolved_ambiguity, approval_state, proposed_by_run_id, created_at, decided_at` |
| `memory_entry` 表 | 【代码】`schema/memory.ts:33-52` | `workspace_id, task_id, scope, entry_key, entry_value, source_change_id, active, created_at, updated_at`；索引 `(workspace_id, entry_key)` **非唯一** |
| `diagnostic_record` 表 | 【代码】`schema/memory.ts:56-74` | 擦洗后的诊断证据 |
| 存储 API | 【代码】`memory-store.ts:256-607` | `proposeChange` / `decideChange` / `rollbackChange` / `listChanges` / `listActiveEntries` / `searchEntries` |
| RPC | 【代码】`packages/protocol/src/memory-command-contract.ts:11-28` | `memory.list` / `memory.propose` / `memory.decide` / `memory.rollback`；桌面桥 `apps/desktop/src/main/memory-handlers.ts:27` |
| 注入实现 | 【代码】`packages/core/src/context-packet.ts:165-222` | `resolveProjectMemorySources`：`maxEntries` 默认 8（clamp 0..32）、summary 96 字符、排序 = scope rank 优先再 newest-first、密钥样式擦洗 |
| 提升/回滚 | 【代码】`memory-store.ts:476-528`（key LWW）/ `534+`（rollback，保留版本可逆） | `rollbackChange` 只允许对 approved 操作 |
| 审批桥 | 【代码】`runtime.ts:12674-12702` | `approval.kind === 'memory'` 的批准/驳回会镜像到 `memory.decide` |

**MemoryScope 取值**：`'task' | 'project' | 'global'`【代码】`packages/shared/src/types/agent.ts:13`。

### 3.2 两道闸门：room 完全不参与记忆

```ts
// 读：runtime.ts:25050
if (this.memoryStore && !this.collaborationThreadScopes.get(input.threadId)?.input.snapshot.conversation.room) { ... }

// 写：runtime.ts:32350-32355
private maybeProposeRunMemory(...) {
  // Room progress belongs to its checkpoint, never to workspace/global Agent memory.
  if (!this.memoryStore || this.collaborationThreadScopes.get(run.threadId)?.input.snapshot.conversation.room) return;
```

并被集成测试固化【代码】`collaboration-workflow.integration.test.ts:144-145`：

```ts
expect(memoryReads).not.toHaveBeenCalled();
expect(memoryProposals).not.toHaveBeenCalled();
```

ADR-0004 是有意这么设计的【代码】`docs/adr/0004-task-room-execution.md:24`：「Rooms do not automatically load project-wide memory or propose run digests to global/project memory... book-specific canon belongs in the room brief and artifacts」。

**所以准确的结论不是"没有记忆"，而是**：记忆子系统已建好（表/RPC/审批/回滚/注入器/擦洗），但**room 这条主执行路径完全绕开它**，room 的"记忆"实际只有 `room.goal` + `room.checkpoint` 两个字段【代码】`task-room.ts:7-8, 16-23`。

### 3.3 缺口清单

| # | 缺口 | 影响 |
|---|---|---|
| M-1 | room 级事实无处存放 | checkpoint 只有 id 列表 + 一个 3,000 字符 note，无法存"这本书的设定是 X" |
| M-2 | 无 agent-in-room 记忆 | 同一 Agent 在 room A 学到的东西，room B 完全不可见，也不可声明"这是 room A 专属" |
| M-3 | 无 bot→team/room 提升通道 | 对应 Grok `PromoteGrokBotMemoriesToTeam` 的能力完全缺失 |
| M-4 | 无 room briefing（散文化简报） | 长 room 每轮都在重复拼 checkpoint + work index + artifact index，没有"已压缩的既成事实层" |
| M-5 | `entry_key` 未按 scope 命名空间隔离 | task/project 同名 key 互相顶掉（C7） |
| M-6 | run-digest 自动批准 + 无去重 | 存储端无界增长（C8） |
| M-7 | agent 无自主写记忆的工具 | 模型只能"读到"记忆，不能表达"请记住" |

### 3.4 最小可用记忆方案（M1–M5）

设计原则：**复用现有表与 RPC，不新造子系统**；写入必须过审批；注入必须进预算；room 之间默认隔离。

#### M1 · 数据结构

**① 扩展 `memory_entry`（新增列，向后兼容）**

```sql
ALTER TABLE memory_entry ADD COLUMN room_id       TEXT;              -- NULL = 非 room 专属
ALTER TABLE memory_entry ADD COLUMN owner_agent_id TEXT;             -- NULL = 非 agent 专属
ALTER TABLE memory_entry ADD COLUMN source_kind   TEXT NOT NULL DEFAULT 'manual';
      -- 取值: 'manual' | 'run-digest' | 'room-checkpoint' | 'promotion' | 'agent-note'
ALTER TABLE memory_entry ADD COLUMN confidence    REAL NOT NULL DEFAULT 0.5;
ALTER TABLE memory_entry ADD COLUMN superseded_by TEXT;              -- 指向顶替它的 memory_entry.id
ALTER TABLE memory_entry ADD COLUMN pinned        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memory_entry ADD COLUMN injected_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memory_entry ADD COLUMN last_injected_at TEXT;
```

**② 修 C7 —— key 命名空间 + 唯一性**

```sql
-- 替换现有非唯一索引 memory_entry_key_idx
CREATE UNIQUE INDEX memory_entry_scoped_key_idx
  ON memory_entry(workspace_id, scope, COALESCE(task_id,''), COALESCE(room_id,''), COALESCE(owner_agent_id,''), entry_key)
  WHERE active = 1;
```
同时把 `applyApprovedChange` 的 `deactivateActive(key)` 改为按 `(workspace_id, scope, task_id, room_id, owner_agent_id, entry_key)` 匹配【改自 `memory-store.ts:486-493`】。

**③ 新增 `memory_promotion` 表（bot/room → team/project 提升审计）**

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PK | ulid |
| `workspace_id` | TEXT NOT NULL | |
| `source_entry_ids_json` | TEXT NOT NULL | 被提升的 `memory_entry.id[]` |
| `room_id` | TEXT | 来源 room（可空） |
| `owner_agent_id` | TEXT | 来源 agent（可空） |
| `target_scope` | TEXT NOT NULL | `'room' \| 'project' \| 'global'` |
| `approval_state` | TEXT NOT NULL DEFAULT 'pending' | `pending \| approved \| rejected` |
| `decided_by` | TEXT | 人类账号 |
| `created_at` / `decided_at` | TEXT | |
| `kept_private_count` | INTEGER NOT NULL DEFAULT 0 | 对应 Grok 同名字段语义 |

**④ 新增 `room_brief`（对应 `GrokBotTeamContextSummary`）**

| 字段 | 类型 | 说明 |
|---|---|---|
| `room_id` | TEXT PK | 一 room 一行 |
| `memory_version` | INTEGER NOT NULL | 每次 brief 重算 +1，对应 Grok `memory_version` |
| `generated_at` | TEXT NOT NULL | |
| `prose` | TEXT NOT NULL | 模型生成的散文简报 |
| `summary_model` | TEXT | 生成用模型 |
| `source_watermark` | TEXT | 生成时所依据的最大 message sequence |
| `stale` | INTEGER NOT NULL DEFAULT 0 | 对应 `GetGrokBotTeamContextSummaryResponse.stale` |

`room_brief` 支持"brief 未变则每轮只发 briefing 不发全量 checkpoint/索引"，这是 §5 压缩方案的基础。

**⑤ 新增 `MemoryScope` 取值**：`'room'`（`packages/shared/src/types/agent.ts:13` 扩为 `'task' | 'room' | 'project' | 'global'`）。`'room'` 必须带 `room_id`。

#### M2 · 写入触发（谁在什么条件下写）

| 触发 | 写入者 | 条件 | scope / key 形态 | 审批 |
|---|---|---|---|---|
| **W1 room 事实** | 宿主（runtime），不是模型 | `checkpointRoom` 被调用且 goal revision 变化 **或** 有新 artifact 交付【挂钩点 `task-room.ts:11-24`、`collaboration-chat-service.ts:728` 附近】 | `scope='room'`, `room_id`, `key='room:<roomId>:artifact:<artifactId>'` | 自动 approved（确定性事实，可信） |
| **W2 room 运行摘要** | 宿主 | room attempt 成功结束；摘要 ≤240 字符 | `scope='room'`, `room_id`, `key='room-digest:<runId 前10位>'` | `autoApprove: false` → pending（**替换现状 C8 的 true**） |
| **W3 agent 自主"记住"** | 模型（新工具 `memory_note`） | 模型显式调用，参数 `{key, value, scope: 'room'\|'agent'}` | `scope='room'`, `room_id` + `owner_agent_id` | pending → 人类在面板批准 |
| **W4 人类显式添加** | 用户 | UI "记住这条" | 由用户选 scope | approved（人类即批准者） |
| **W5 提升** | 用户勾选 fact → `memory.promote` | 见 M5 | 写 `memory_promotion` | pending → 人类批准 |

**关键约束**：room A 的写入**永不**自动变成 `project`/`global`。跨 room 可见性只能通过 W5 显式提升获得。这直接对冲 Grok 的失败模式（`06:290-292`）。

#### M3 · 注入位置与顺序

在 room 块内插入两个新段，**位置固定在 `<confirmed_goal>` 之后、`当前请求` 之前**（`task-room.ts:66` 与 `:68` 之间）：

```
1  固定隔离声明
2  群聊标题 + roomId/taskId/purpose
3  <confirmed_goal>                        ← 现有
4  <room_brief version=N>prose</room_brief> ← 新增（M1④，压缩后才有；无则整段省略）
5  <room_memory>…</room_memory>            ← 新增：scope='room' 的 active 条目
6  <agent_memory>…</agent_memory>          ← 新增：scope='room' 且 owner_agent_id=本 agent
7  当前请求
...
```

段内排序（复用 `resolveProjectMemorySources` 的排序器【代码】`context-packet.ts:182-196`，但换优先级）：

| 优先级 | 条件 | 排序键 |
|---|---|---|
| 1 | `pinned = 1` | 最新在前 |
| 2 | `scope='room'` 且 `room_id` 匹配 | `updated_at DESC` |
| 3 | `scope='room'` 且 `owner_agent_id` = 本 agent | `updated_at DESC` |
| 4 | `scope='project'` | `updated_at DESC` |
| 5 | `scope='global'` | `updated_at DESC` |

**条数与字节上限**：`room_memory` ≤ 8 条 / ≤ 1,200 字节；`agent_memory` ≤ 5 条 / ≤ 800 字节；单条 value 摘要 ≤ 96 字符（沿用 `summaryMaxChars` 默认【代码】`context-packet.ts:169`）。密钥样式擦洗沿用 `scrubSecretLike`【代码】`context-packet.ts:155-159`】。

**注入必须进预算**：把这三个新段注册为 Context Packet source（`kind: 'room-brief' | 'room-memory' | 'agent-memory'`），使其获得 `tokenEstimate` 并可被 `selectContextSources` 裁剪——**不要**像现状那样直接字符串拼接绕过预算。

#### M4 · 去重与冲突

| 规则 | 做法 | 依据 |
|---|---|---|
| **同 key 顶替** | `deactivateActive` 后插入新 active 行，旧行保留（`active=0` + `superseded_by`） | 沿用【代码】`memory-store.ts:486-528` |
| **命名空间** | key 唯一性包含 `scope + task_id + room_id + owner_agent_id` | 修 C7 |
| **run-digest 去重** | 写入前按 `(room_id, sha256(value))` 查重；命中则只 bump `updated_at` | 修 C8 |
| **跨 scope 冲突** | 窄 scope 优先（room > project > global）；同 scope 内 newest wins | 与 `SCOPE_RANK` 思路一致【代码】`context-packet.ts:149-153`，但把 `task` 换成 `room` 并加入 agent 维度 |
| **冲突显式化** | 同 key 在不同 scope 同时 active 时，注入按上表**两条都发**，各自带 `[scope]` 前缀，让模型看到分歧而不是被静默合并 | 现状已有 `Project memory [scope]` 前缀【代码】`runtime.ts:25076` |
| **可逆** | 沿用 `rollbackChange`【代码】`memory-store.ts:534+` | |

#### M5 · 提升机制（bot/room → 团队，需要人类批准）

对应 Grok `PromoteGrokBotMemoriesToTeam{agent_id, fact_ids[]} → {created[], already_in_team[], kept_private_count}`【代码】`02:163-164`。

- **新 RPC**：`memory.promote`，payload `{ roomId?, agentId?, entryIds: string[], targetScope: 'room'|'project'|'global' }`。
- **流程**：人类在记忆面板勾选 fact（UI 形态参考 Grok 的多选 `has(K.factId) && !$.has(K.factId)`【代码】`02:182`）→ 生成 `memory_promotion`（`pending`）→ 复用现有审批桥【代码】`runtime.ts:12674-12702` 走人类批准 → 批准后：原条目保留且 `pinned=1`，并按 `target_scope` 插入新 `memory_entry`（`source_change_id` 指向 promotion）。
- **返回语义对齐**：`{ created[], already_in_team[], kept_private_count }`——`already_in_team` = 目标 scope 已存在等价 value；`kept_private_count` = 未勾选而保持私有（room 专属）的条目数【代码】`02:164`。
- **必须人类批准**：room → project/global 的提升会突破 ADR-0004 的 room 隔离边界，属于不可自动化的权限变更。

### 3.5 与 OV3 / OV4 的可组合契约

| 对接方 | 契约 | 理由 |
|---|---|---|
| **OV3（自进化/实时适配）** | ① 记忆条目必须带 `source_kind` + `evidence_refs_json`，OV3 可用它判断"这条经验从哪次执行来"② 新增 `memory_note` 工具时，其 schema 必须同时暴露给 native 与 kernel 两条路径（`buildRunAgentInstructions` / `buildKernelSystemContext`）③ OV3 若要"从失败中学习"，写入口只能用 W2/W3，**不得**新增绕过审批的直写 | 避免再造一个 C8 |
| **OV4（动态加人/拓扑）** | ① 新成员加入时，room 块第 4 段（`<room_brief>`）必须已存在，否则新成员看不到加入前历史（Grok 的 gap，`06:300`）② 成员移除时，其 `owner_agent_id` 命名的 `agent_memory` 条目**不删**，`room_memory` 保留 ③ 拓扑变更（`topologyRevision`）必须 bump `room_brief.memory_version`，使 brief 标记 `stale` | 复用 `stale` 字段【代码】`02:166` |
| **OV1（架构批判）** | 本文档的 C1–C8 可直接作为其缺陷清单输入；**分歧点**：OV1 若主张"room 也应自动读 `project` 级记忆"，本文档的立场是**只在 W5 显式提升后可见**（依据 `06:290-292` 的 Grok 事故） | 需 Lead 仲裁 |

---

## 4. 跨 Room 污染：逐项判定

前提：同一个 Agent（`agentId`）同时属于 room A 与 room B，两者的 workspace 可以相同也可以不同。

| 项 | 会/不会串味 | 证据 |
|---|---|---|
| **persona / developerInstructions** | ⚠️ **共享，但这是设计意图**（"Agent 定义可复用"）【代码】`docs/adr/0004-task-room-execution.md:24`。persona 从 `GlobalAgent` 读取并整体注入 `agentIdentityPrompt`【代码】`runtime.ts:9457-9477`、`demo-run.ts:621` | 若 persona 里写了 room A 的设定，会串到 room B。ADR 明确要求"book-specific canon 放 room brief，不放 persona"【代码】`ADR-0004:24` |
| **Skill（`skillVersionIds` → 正文）** | ⚠️ **共享**：`buildRunAgentInstructions` 把绑定 Skill 正文整体拼进 `Agent / Team instructions`【代码】`runtime.ts:9478-9484`。Skill 是 agent 级绑定，不分 room | 与 persona 同类风险 |
| **MCP server / 工具配置** | ⚠️ **共享**（agent 级 `mcpServerIds`）【代码】`demo-run.ts:646-647`；但 room 内有额外过滤器 `isTaskRoomToolAllowed`【代码】`runtime.ts:31272`、`runtime.ts:31414` 与 read-only 白名单【代码】`runtime.ts:21352` | 工具可见性按 room 收窄，配置本身共享 |
| **记忆** | ✅ **不串味（当前）**：room 完全不读不写记忆【代码】`runtime.ts:25050`、`32350-32355` + 测试固化 `collaboration-workflow.integration.test.ts:144-145` | **但代价是 room 没有记忆可用**——这正是本方案的改造目标 |
| **room 消息历史** | ✅ **不串味，且被测试固化**：`roomContextSelection` 只读 `snapshot.messages`（该 conversation 的消息）【代码】`task-room.ts:27`；集成测试断言第二本书的提示里 `not.toContain('回声十秒')`【代码】`collaboration-workflow.integration.test.ts:142-143`；单测断言两 room 不混 `buildTaskRoomContext(a) not.toContain('只写小说B')`【代码】`apps/runtime/src/task-room.test.ts:59-66` | 强 |
| **room goal / checkpoint / artifacts / tasks** | ✅ **不串味**：全部挂在 `snapshot.conversation.room` 与 `snapshot.tasks/attempts` 上，按 conversation 隔离【代码】`task-room.ts:11-24, 57-62`；manifest 有 `roomId`【代码】`task-room.ts:49` | 强 |
| **工作目录 cwd** | ✅ **不串味**：`ensureTaskRoomDirectory(root, conversation.id)`，路径为 `<root>/.sync-think/task-rooms/<sha256(roomId)[:32]>`【代码】`runtime.ts:26761, 26768`、`task-room.ts:129-142` | 强（含符号链接越界检查） |
| **provider thread / kernel session** | ⚠️ **跨 room 不串，room 内会串**：session key = `${KERNEL_SESSION_SETTING_PREFIX}.${kernelId}.${resolveConversationIdForThread(threadId) ?? threadId}`【代码】`runtime.ts:21897-21899`；room 下 `resolveConversationForThread` 返回 room 自己的 conversation【代码】`runtime.ts:18706-18707`】 | ⇒ key 里的 scope 是 **room**，不含 `agentId` / `taskId`。**同一 room 内所有成员/所有 attempt 共用同一个 claude-code / codex session**，且 `resolveKernelConversationSession` 只在 workspace 不匹配时重建【代码】`runtime.ts:22167-22181`。这与 ADR-0004「A provider thread belongs to one room work item」【代码】`ADR-0004:20` **不符** |
| **外部内核串行队列** | ⚠️ 同上：`externalKernelSessionQueue.enqueue(this.kernelConversationSessionKey(kernelId, initialRun))`【代码】`runtime.ts:21412-21414` ⇒ 同一 room 内成员串行排队，跨 room 并行 | 队列 key 与 session key 同源 |
| **Context Snapshot 缓存** | ✅ **按 thread 隔离**：`contextSnapshotCache.get(threadId, modelId, kernelId)`【代码】`runtime.ts:9592`、`conversation-context-snapshot-cache.ts:4-22`；room attempt thread 含 taskId ⇒ 跨 room 不同 | 强 |
| **compact 边界缓存** | ✅ 按 thread：`this.compactBoundaryCache.get(run.threadId)`【代码】`runtime.ts:26326` | 强 |
| **native 内核的 provider 会话** | ✅ **每 attempt 独立 thread**：`threadId = attempt.threadId ?? "${conversationId}:${taskId}"`【代码】`runtime.ts:21308`；消息从 `messageStore.listMessages(threadId)` 读【代码】`runtime.ts:26336` | room 内不同 task 也不同 thread（除非 continuation 复用 `attempt.threadId`【代码】`collaboration-chat-service.ts:778`，这是有意的续做语义） |
| **room 级 run 资源/并发** | ✅ 按 workspace 与 resourceClaims 裁决【代码】`collaboration-chat-service.ts:687-697` | 跨 room 是排队而非污染 |

**小结**：

- **跨 room 真正会串的只有三样**：`persona`、`Skill 正文`、`MCP 工具配置`——全部是 agent 级定义，且是 ADR 有意的"可复用"部分。
- **跨 room 唯一会串的运行时状态是 provider kernel session 的 key 粒度**：它按 room 而非按 "room × agent" 分片。这是一个**待修缺陷**（见 §6.2 规格 S-6）。
- **记忆当前不串味，是因为它根本不进 room**。一旦按 §3.4 引入 room 记忆，必须在 M3 的注入过滤里强制 `room_id` 匹配，否则会立刻引入 Grok 式的跨群串味（`06:290-292`）。

---

## 5. 预算与压缩

### 5.1 实测：一次 room turn 的房间块有多大

【数据】`node_modules\.bin\tsx.cmd .tmp-grok-bot\scripts\ov2-context-budget.mjs`（导入 live 源码，非 dist）：

| 场景 | 房间块字节 | 估 tokens = 字节/4 | 占 128k | 选中历史 | 省略 | 产物引用 |
|---|---|---|---|---|---|---|
| A 空 room 首轮（地板） | 2,297 | 575 | 0.4% | 1 条 / 20 字符 | 0 | 0 |
| B 真实工作群（8 成员 / 60 消息 / 25 任务 / 12 产物） | 26,452 | 6,613 | 5.2% | 16 条 / 11,924 字符 | 44 | 12 |
| C 饱和上界（goal 20k / 400×4k 消息 / 80 任务 / 80 产物） | **77,616** | **19,404** | 15.2% | 4 条 / 11,924 字符 | 396 | 60 |
| D 中文工作群（41 条中文 + 触发消息 3000 汉字） | 43,339 | **10,835** | 8.5% | 24 条 / **11,922 字符 = 35,644 字节** | 17 | 5 |

分层字节（同一次测量）：

| 层 | 场景 B | 场景 C | 场景 D |
|---|---|---|---|
| 固定角色提示 | 1,558 | 1,559 | 1,558 |
| `<confirmed_goal>` | 3,046 | **20,046** | 646 |
| `<selected_room_history>` | 12,867 | 12,333 | **36,969** |
| `<artifact_index>` | 3,049 | **27,154** | 1,289 |
| 工作索引 | 4,007 | 8,416 | 1,607 |
| 检查点 | 1,131 | 5,303 | 638 |
| roster | 670 | 2,680 | 508 |
| 省略提示 | 124 | 125 | 124 |

**读法**：

1. **饱和时 artifact_index 是最大单层（27,154 字节 ≈ 6,800 tokens）**，因为它只按 60 条裁剪、每条带完整 `path`【代码】`task-room.ts:62`。→ 缺陷 C3。
2. **confirmed_goal 可达 20,046 字节 ≈ 5,000 tokens**。→ 缺陷 C4。
3. **C2 被场景 D 量化**：历史预算命中 11,922 **字符**，但中文下等于 35,644 **字节**——比 ASCII 场景（12,600 字节）**多 2.8×**。因为预算用 `String.length`【代码】`task-room.ts:30, 33-38`，而 token 估算用 `Buffer.byteLength/4`【代码】`context-snapshot.ts:81-84`。
4. **上表只是"房间块"**。真实一轮还要叠加：`System instructions`（productBoundaryPrompt，含多个输出契约与工具指引，`runtime.ts:31183-31200`）、`Agent / Team instructions`（persona + 全部 Skill 正文，`runtime.ts:9444-9506`）、roster/MCP 工具 schema JSON（`runtime.ts:31320, 31382`）、会话消息（≤ 0.82×window，`runtime.ts:26379-26382`）。

> ⚠️ **不编造总 token 数**：上面第 4 项没有实测数字，因为需要真实 workspace 的 Skill/MCP/工具目录才能测。**方法**：在 `buildDefaultProviderContextSnapshot` 返回处读取 `snapshot.status.sections[]`【代码】`context-snapshot.ts:203-214`——它已经按 `system/agent/project/summary/messages/tools` 六段给出 token 估算。**建议**：把该分段的 `project` 段再细分为"room 各层"，即可得到真实占比；这也是 §6 规格 S-3 的一部分。

### 5.2 Grok Bot 的失败模式对照

| Grok 侧事实 | 出处 |
|---|---|
| 「**The full transcript gets sent back to the model on every turn**, and there aren't any explicit primitives yet to cut older messages from what the model sees.」 | 【代码】`docs/research/grok-bot/06-official-docs-and-public-narrative.md:277` |
| 用户实测「~**200–250k input tokens per reply**」+「Grok Bot weekly burn is mostly **context tax, not work**」 | 【代码】`06:281` |
| 员工 kevinn 确认「each turn re-reads the bot's full chat history—so week-long threads burn **80–90k tokens/step**」，建议「**+ fresh chat per task**、把状态放 Profile/Notion」 | 【代码】`06:281` |
| 「**No in-place compact for a Grok Bot chat**—auto-summary near the limit still lets busy threads refill.」唯一 workaround = handoff file → Duplicate → Hide | 【代码】`06:282` |
| 官方宣称「context compounds」被员工定性为「**isn't intended behavior**」 | 【代码】`06:275, 279` |
| 我们的对策依据：Grok 的压缩结果是 `ConversationMessage.conversation_summary`，**不写 memory_shard**；原始消息保留 | 【代码】`02:285-290` |

**我们与它的差别**：现状已有 `contextSequence` 冻结 + 12k 字符滑窗 + `historyOmitted` 计数（§1.2），**不是**"每轮全量重发"。风险不在历史，而在**三个无预算的索引层**（artifact_index / work index / goal）会随 room 寿命线性增长，最终复现同一失败模式。

### 5.3 建议的硬上限与压缩策略

#### 硬上限（per room turn，单位统一为 **字节**，再按 /4 折算 token）

| 层 | 现状 | 建议硬上限 | 理由 |
|---|---|---|---|
| 固定角色提示 | ~1,558 字节 | 2,000 字节 | 已达标 |
| `confirmed_goal` | 20,000 字符 | **6,000 字节** + 分页指引 | 现状可达 5,000 tokens（C4） |
| `room_brief`（新） | — | **3,000 字节** | 压缩层的载体 |
| `room_memory`（新） | — | 1,200 字节 / 8 条 | §3.4 M3 |
| `agent_memory`（新） | — | 800 字节 / 5 条 | §3.4 M3 |
| 当前请求 | 无上限 | 4,000 字节（超出转 artifact） | 防单条撑爆 |
| roster | 无上限 | 32 条 / 4,000 字节 | 与 team 上限一致【代码】`collaboration-workflow.ts:17` |
| 检查点 | 3×60 条 + 3,000 字符 | 3×40 条 + 1,000 字节 | |
| 工作索引 | 60 条 | **30 条** | 现状饱和 8,416 字节 |
| `<artifact_index>` | 60 条（含 path） | **30 条、去掉 `path`、`title` ≤ 120 字符** | 现状饱和 27,154 字节（C3）；`path` 可由 `read_context` 取 |
| `<selected_room_history>` | 12,000 **字符** / ≤24 条 | 12,000 **字节** / ≤24 条；触发消息 ≤4,000 字节 | 修 C2 |
| **room 块合计** | 饱和 77,616 字节 | **软 32,000 字节（≈8,000 tokens）/ 硬 48,000 字节（≈12,000 tokens）** | 预留 128k 窗口给工具 schema + persona/Skill + 会话 |

**裁剪顺序（溢出时从先到后丢）**：
`artifact_index` → 工作索引 → `selected_room_history` 中最旧的条目 → roster 的 `teamParticipantId`/`agentId` → 检查点已完成列表。
**永不裁剪**：固定隔离声明、`confirmed_goal`、`<room_brief>`、当前请求、`pinned=1` 的记忆条目（与 `PROTECTED_SOURCE_KINDS`【代码】`context-packet.ts:44-49` 同构）。

> 实现建议：不要另写一套裁剪器。把上述每一层注册为 `ContextSourceRef{id, kind, tokenEstimate}`，交给 `selectContextSources({candidates, tokenBudget})`【代码】`context-packet.ts:535-590` 处理——它已经实现了"protected 永不静默丢弃 + 可压缩项先出局 + soft truncate + truncations 记录"。

#### 压缩触发点

| 级 | 触发条件 | 动作 | 写回位置 |
|---|---|---|---|
| **L0 每轮** | 每 turn 固定执行 | 按上表裁剪，超预算走 `selectContextSources` | 无（只影响本轮注入） |
| **L1 room brief 重算** | `estimatedUsedTokens / contextWindow >= 0.7`（沿用 `CONTEXT_COMPACT_THRESHOLD`【代码】`context-snapshot.ts:4`】）**或** `historyOmitted >= 200` **或** `memory_entry`(room) 新增 ≥ 20 条 | 用模型把 `goal + checkpoint + artifact 标题 + 最近 N 条消息` 压成 ≤3,000 字节散文，写 `room_brief`，`memory_version += 1` | **`room_brief.prose`**（不是 memory_entry——对齐 Grok：摘要不写 memory shard【代码】`02:289`） |
| **L2 checkpoint 归档** | `pendingTaskIds.length + completedTaskIds.length > 200` | 已完成列表折叠为计数 + 归档到 artifacts | `room.checkpoint`（字段内） |
| **L3 会话压缩** | 现有 `conversation.compact`（手动 / 自动 70%） | **扩展到 room attempt thread**（修 C6）：`conversation.compact` 增加可选 `attemptId`，命中时用 `attempt.threadId` 计算占用 | 现有 compact 边界（`compactedAt` 过滤注入【代码】`context-message-history.ts:164-171`】）

**压缩触发点必须可观测**：现状已有 `context.compaction_skipped` 事件【代码】`runtime.ts:10722, 10767`】；L1/L2 需要同等事件（`room.brief.rebuilt` / `room.checkpoint.archived`），否则无法验证压缩是否真的发生。

#### 摘要后原始数据保留策略

**全部保留，只裁剪注入**：

- `snapshot.messages`、`attempt.output`、`attempt.artifacts[].content` **不因压缩而删除**——`readTaskRoomContext` 永远能回读【代码】`task-room.ts:96-126`】。
- 与 Grok 一致：压缩只产生一个指针/摘要结构，原文留在权威存储【代码】`02:290`】。
- 与现状一致：compact 只按 `compactedAt` 过滤注入【代码】`context-message-history.ts:164-171`】，不删消息。
- 明确禁止：把"压缩"实现成对 `messages` 的 `DELETE`。

---

## 6. 改造规格与迁移

### 6.1 目标：一次 room turn 的上下文装配顺序（分层 + 来源 + 预算）

```
┌─ systemPrompt ────────────────────────────────────────────────────────────┐
│ [1] System instructions           来源: productBoundaryPrompt 等           │
│                                   预算: 不设（产品级固定）                  │
│ [2] Agent / Team instructions     来源: persona + personalization +        │
│                                         Skill 正文 + collaboration 提示     │
│                                   预算: 沿用现有（Skill 正文 ≤2400 字符/个）│
│ [3] Project context               来源: 见下方 room 块 + P1 的 project     │
│     sources（goal/acceptance/                                            │
│     memory/skill/mcp）                                                   │
│ [4] Compact summary               来源: run.compactSummary                 │
├─ room 块（属于 [3]，本方案的改造重点）─────────────────────────────────────┤
│ R1  固定隔离声明                  固定                          2,000 字节 │
│ R2  room 标识                     conversation/task             不计       │
│ R3  <confirmed_goal>              room.goal                    6,000 字节 │
│ R4  <room_brief version=N>        room_brief.prose             3,000 字节 │
│ R5  <room_memory>                 memory_entry(scope=room)     1,200 字节 │
│ R6  <agent_memory>                memory_entry(room×agent)       800 字节 │
│ R7  当前请求                      task.instructions            4,000 字节 │
│ R8  沟通/角色/咨询提示            字面量 + attempt 状态          2,000 字节 │
│ R9  roster                        活跃成员 ≤32                 4,000 字节 │
│ R10 检查点                        room.checkpoint        3×40 条 + 1,000B │
│ R11 工作索引                      tasks(isRoomWork) ≤30        4,000 字节 │
│ R12 <selected_room_history>       触发边界内消息 ≤12,000 字节             │
│ R13 省略计数 + 回读指引           固定                          1,000 字节 │
│ R14 <artifact_index>              最近 30 条（无 path）        6,000 字节 │
│     ── 合计：软 32,000 / 硬 48,000 字节（≈8,000 / 12,000 tokens）          │
├─ messages ────────────────────────────────────────────────────────────────┤
│ [5] 会话消息                      来源: 该 attempt thread                  │
│                                   预算: 0.82 × contextWindow（现有）       │
├─ tools ───────────────────────────────────────────────────────────────────┤
│ [6] 工具 schema                  来源: toolsForExecutionMode + MCP         │
│                                   预算: 现有 maxTools=16 / schema 800 字符 │
└───────────────────────────────────────────────────────────────────────────┘
```

### 6.2 结构化改造清单（接口/表/字段级）

| ID | 变更 | 位置 | 类型 |
|---|---|---|---|
| **S-1** | `roomContextSelection` / `buildTaskRoomContext` 增加 `budget` 参数，返回 `{ text, sources: ContextSourceRef[], truncations[] }` 而不是裸 string | `apps/runtime/src/task-room.ts:26, 56` | 接口（破坏性，需同步改 3 处调用：`collaboration-workflow.ts:47`、`collaboration-chat-service.ts:728`、`task-room.test.ts`） |
| **S-2** | 逐层预算常量集中导出（`ROOM_LAYER_BUDGETS`），替换散落的字面量 `12_000 / 20_000 / 3_000 / 60 / 4_000 / 3_000` | `task-room.ts:30, 41, 44, 66, 83, 84, 87` | 常量 |
| **S-3** | `contextManifest` 扩展：新增 `tokenEstimate`、`bytes`、`layers[]{id, bytes, tokens, truncated}`、`truncations[]`、`memoryEntryIds[]` | `task-room.ts:48-53`；类型 `packages/shared/src/types/collaboration-chat.ts:192` | 类型/字段 |
| **S-4** | 字节预算替换字符预算：所有 `String.length` 判定改为 `Buffer.byteLength(x,'utf8')` | `task-room.ts:30, 33-38` | 逻辑（修 C2） |
| **S-5** | `artifact_index` 去掉 `path`，`title` 截 120 字符，条数 60→30 | `task-room.ts:62, 87` | 逻辑（修 C3） |
| **S-6** | kernel session key 加入 agent 维度：`${prefix}.${kernelId}.${conversationId}.${assigneeMemberId}` | `runtime.ts:21897-21899` | 逻辑（修 §4 的 room 内 session 串味；**需确认续做语义**：continuation 必须命中同一 member 才 resume） |
| **S-7** | `conversation.compact` payload 增加 `attemptId?`；runtime 命中时用 `attempt.threadId` 计算占用与边界 | `runtime.ts:10671-10696`、`validation/team-conversation.ts:739` | 接口（修 C6） |
| **S-8** | 新增表 `memory_promotion`、`room_brief`（字段见 §3.4 M1③④） | `packages/storage/src/schema/memory.ts`（新文件 `room-brief.ts` 更佳） | 表 |
| **S-9** | `memory_entry` 新增 8 列 + 唯一索引（见 §3.4 M1①②） | `schema/memory.ts:33-52`；`memory-store.ts:486-527` | 表/逻辑（修 C7） |
| **S-10** | `MemoryScope` 增加 `'room'` | `packages/shared/src/types/agent.ts:13` | 类型 |
| **S-11** | 新 RPC `memory.promote`，返回 `{created[], already_in_team[], kept_private_count}` | `packages/protocol/src/memory-command-contract.ts:11-28`；runtime handler 邻近 `runtime.ts:11537-11635` | 接口 |
| **S-12** | 新工具 `memory_note`（模型可调用，写 pending），native 与 kernel 两条路径都要暴露 | `chat-tools.ts` 工具表 + `runtime.ts:21352` 白名单 + `buildKernelSystemContext` | 接口 |
| **S-13** | 移除 room 读/写的两道闸门，改为 scope 过滤：读 `scope IN ('room' AND room_id=本room, 'project','global')`，写 `scope='room'` | `runtime.ts:25050`、`runtime.ts:32350-32355` | 逻辑（**核心改动**） |
| **S-14** | run-digest 改为 `autoApprove: false` + 按 value 哈希去重 | `runtime.ts:32350-32390` | 逻辑（修 C8） |
| **S-15** | `room_brief` 重算事件 `room.brief.rebuilt` + checkpoint 归档事件 | runtime 事件表 | 可观测性 |

### 6.3 迁移步骤（有序）

1. **只加不改**：新增 `room_brief`、`memory_promotion` 表与 `memory_entry` 新列（全部 nullable / 有默认值），加唯一索引前先跑一次去重数据修复。**验收：`packages/storage/src/migrate.test.ts` 通过 + 新表 DDL 快照入库**（现有迁移测试列表在 `migrate.test.ts:1016` 一带已有 `0003_memory_diagnostics` 先例）。
2. **修 C7/C8 的数据**：合并同 `(workspace, scope, task, room, agent, key)` 的重复 active 行（保留 `updated_at` 最新，其余置 `active=0` 并写 `superseded_by`）；`run-digest:` 前缀条目按 value 哈希去重。**验收：迁移前后 `listActiveEntries` 返回条数单调不增，且无内容丢失（旧行仍在）**。
3. **S-4/S-5/S-2**：先只改预算口径与 artifact_index（纯收窄，行为可预期）。**验收：§5.3 上限表逐项断言**。
4. **S-1/S-3**：`buildTaskRoomContext` 返回结构化结果 + manifest 扩展。**验收：`contextManifest.layers[]` 字节和 == 块字节数**。
5. **S-13 读闸门**：room 开始注入 `room_memory` / `agent_memory` / `project` 记忆。**验收：跨 room 注入隔离测试**（见 §6.4）。
6. **S-14 写闸门**：room run-digest 改为 pending。**验收：room 完成后 `memory_change.approval_state === 'pending'`**。
7. **S-8/L1**：room_brief 重算 + 注入。**验收：压缩事件与 brief 版本递增**。
8. **S-6/S-7**：session key 粒度与 compact 覆盖。**验收：同 room 两成员不同 session id；room 触发 `/compact` 命中 attempt thread**。
9. **S-11/S-12**：提升 RPC + `memory_note` 工具。**验收：审批桥端到端**。

### 6.4 验收测试点（可直接写成用例）

**A. 装配与预算**

1. `room 块字节数 <= 48_000`：构造 400 条 4k 消息 + 80 任务 + 80 产物的饱和 room，断言 `Buffer.byteLength(buildTaskRoomContext(...)) <= 48_000`。（现状实测 77,616——本用例当前**必红**）
2. `中文预算按字节生效`：41 条中文消息 + 3,000 汉字触发消息，断言注入历史的 `Buffer.byteLength <= 12_000`。（现状实测 35,644——当前**必红**）
3. `artifact_index 不含 path 且 <= 30 条`：断言 `JSON.parse(<artifact_index>).length <= 30` 且每项无 `path` 键。
4. `manifest 分层字节自洽`：`sum(layers[].bytes) === Buffer.byteLength(block)`。
5. `manifest 记录截断`：当 goal 被裁剪时 `truncations` 含 `{sourceId:'goal', reason:'goal-limit'}`。

**B. 记忆注入与隔离**

6. `跨 room 记忆隔离`：room A 写 `scope='room', room_id='A'` 的条目；`buildTaskRoomContext(B)` 断言 `<room_memory>` 中不含该 value。（对应 `06:290-292` 的 Grok 事故）
7. `未提升不可见`：room A 的条目提升到 `project` 前，room B 的 `<room_memory>` 与 `<agent_memory>` 都不含它；提升并批准后，room B 的 project 记忆源含它。
8. `owner_agent_id 过滤`：agent X 在 room A 写的条目不出现在 agent Y 于 room A 的 `<agent_memory>`。
9. `room 轮次确实读记忆`：替换 `collaboration-workflow.integration.test.ts:144-145` 的两条负向断言为正向——`expect(memoryReads).toHaveBeenCalled()`。
10. `密钥擦洗`：写入 `value: 'api_key=sk-abcdefghijklmnop'`，断言注入文本不含 `sk-`（沿用 `scrubSecretLike`【代码】`context-packet.ts:155-159`】）。
11. `room 不自动升级 scope`：room run 完成后，断言不存在 `scope IN ('project','global')` 且 `source_kind='run-digest'` 的新条目。

**C. 写入触发与审批**

12. `room run-digest 为 pending`：断言 `approval_state === 'pending'` 且 `approval` 表出现 `kind='memory'` 记录。
13. `审批镜像`：批准该 approval 后 `memory_entry` 出现 active 行（复用现有桥【代码】`runtime.ts:12674-12702`】）。
14. `promote 返回语义`：对 3 条 fact 调用 `memory.promote`，其中 1 条已存在于目标 scope ⇒ 断言 `created.length === 2 && already_in_team.length === 1`，且 `kept_private_count` 等于未勾选的 room 条目数。
15. `promote 未批准不生效`：pending 状态下目标 scope 查不到条目。
16. `去重`：同一 value 连续写两次 ⇒ `memory_entry` active 行数 +1（不是 +2）。

**D. 压缩**

17. `L1 触发`：构造 `historyOmitted >= 200` 的 room，跑一轮后断言 `room_brief.memory_version` 递增且 `prose` ≤ 3,000 字节。
18. `L1 不删原文`：brief 生成后 `readTaskRoomContext({kind:'messages'})` 仍能按 offset 读到全部原始消息。
19. `L3 覆盖 room`：对 room 发出 `conversation.compact {attemptId}`，断言返回的 `threadId === attempt.threadId` 且 `beforeTokens > 0`。（现状：解析到 `conversation.taskId → task.threadId`，**必红**）
20. `压缩可观测`：断言事件流出现 `room.brief.rebuilt` / `context.compaction_skipped`。

**E. session 与并发**

21. `同 room 不同成员不同 session`：room 内两个成员各跑一轮（kernel=claude-code），断言两次持久化的 session key 不同。（现状相同——**必红**）
22. `跨 room 不同 session`：room A 与 room B 的 key 不同（现状已成立，防回归）。

### 6.5 与其他 OV 的边界

| 事项 | 归属 |
|---|---|
| room 角色提示文案、purpose 语义 | 不在本文档范围（OV1/通信线） |
| 群成员动态增删的**执行**逻辑 | OV4（本文档只提供 `room_brief.stale` 与记忆 re-scope 契约） |
| 自进化的**策略**（什么时候改 Skill/persona） | OV3（本文档只提供 `source_kind` / `evidence_refs` 契约） |
| Context Packet（P1 路径）的 8,000 预算是否调整 | 本文档不动；仅在 room 路径引入同类预算 |

---

## 7. 未证实 / 风险 / 开放问题

| # | 项 | 状态 |
|---|---|---|
| U-1 | room 对话的 `conversation.taskId` 是否被设置 | 【未证实】。若为 `undefined`，`conversation.compact` 会在 `runtime.ts:10671` 直接返回 `compacted:false` ⇒ C6 从"压缩错 thread"升级为"**/compact 对 room 完全空转**"。需在实现 S-7 前先确认 |
| U-2 | 一次 room turn 的**总** token（含 system/agent/tools/messages） | 【未证实】，方法见 §5.1 末尾。不做估算以免编造 |
| U-3 | `Skill 正文` 是否真的按 2,400 字符截断 | 【代码】`context-packet.ts:278` 默认 `bodyMaxChars=2400`，但 `maxSkills` 默认 `Infinity`【代码】`context-packet.ts:276-277` ⇒ 绑定 N 个 Skill 时总量随 N 线性增长 |
| U-4 | Grok Bot 的 `scope` / `scope_key` 取值 | 【未证实】——`02:195-207` 明确写"0.63.0 桌面端产物中没有任何字面量取值"，仅有强约束（per-agent 默认 + fact 级显式提升）。**不要**照抄其 scope 词汇，我们用自己的 `MemoryScope` |
| U-5 | Grok 的 `box_backfilled` 语义 | 【未证实】`05:560, 804`：字段在桌面端零引用，是透传字段 |
| U-6 | `06:281` 的 200–250k / 80–90k 数字是**用户帖子实测**，非官方 benchmark | 引用时保留出处，不当作容量规划依据 |
| R-1 | 并发编辑风险 | 本次分析期间 `apps/runtime/src/{runtime,task-room}.ts` 被并发修改（§0.2）。任何基于本文档的实施必须先重新锚定行号 |
| R-2 | S-6（session key 加 agent 维度）会改变现有 resume 行为 | 现有 `resolveKernelConversationSession` 的 workspace 匹配逻辑【代码】`runtime.ts:22167-22181` 与 `resumeFromAttemptId` 续做语义【代码】`collaboration-chat-service.ts:797` 耦合，需配套测试 21/22 |
| R-3 | 打开 room 记忆注入会**立刻**引入跨 room 风险 | 缓解：S-13 必须与测试 6/7/8 同批次合入；不得先开注入再补隔离 |

---

## 附录 A · 锚点表（`ov2-anchors.json` 摘要）

| 锚点 | 位置 |
|---|---|
| `roomContextSelection` 定义 | `apps/runtime/src/task-room.ts:26` |
| 历史总预算 `12_000` | `task-room.ts:30` |
| 触发消息配额 `4_000` | `task-room.ts:41` |
| 其余消息配额 `3_000` / 最小 `180` | `task-room.ts:44, 34` |
| 条数上限 `24` | `task-room.ts:43` |
| goal `slice(0, 20_000)` | `task-room.ts:66` |
| checkpoint note `3_000` / 三数组 `-60` | `task-room.ts:83` |
| 工作索引 `-60` | `task-room.ts:84` |
| 单条消息输出 `12_000` | `task-room.ts:85` |
| artifact_index `-60` | `task-room.ts:62, 87` |
| `buildTaskRoomContext` / `readTaskRoomContext` / `ensureTaskRoomDirectory` | `task-room.ts:56 / 96 / 129` |
| room 分支 | `apps/runtime/src/collaboration-workflow.ts:46-47` |
| 非 room 分支预算 `32_000` | `collaboration-workflow.ts:51` |
| room 块挂载点 | `apps/runtime/src/runtime.ts:21344-21345` |
| attempt thread id | `runtime.ts:21308` |
| `buildRunAgentInstructions`（persona/Skill） | `runtime.ts:9444-9506` |
| `resolveConversationForThread` | `runtime.ts:18702-18713` |
| kernel session key | `runtime.ts:21897-21899` |
| kernel session 解析 | `runtime.ts:22156-22184` |
| `buildKernelSystemContext` + `## Persistent memory` | `runtime.ts:22407 / 22445` |
| **记忆读闸门** | `runtime.ts:25050` |
| 记忆候选构造 | `runtime.ts:25058-25083` |
| `selectContextSources({tokenBudget: 8_000})` | `runtime.ts:25211-25221` |
| `projectContextPromptBlocks`（P1） | `runtime.ts:25572-25579` |
| `buildChatProviderMessages` | `runtime.ts:26323` |
| 会话裁剪 `0.82 × window` | `runtime.ts:26379-26382` |
| `resolveChatWorkspaceRoot` + room 目录 | `runtime.ts:26754-26772` |
| compact 入口 / 阈值闸门 | `runtime.ts:10671-10696 / 10718` |
| compact 摘要 prompt 覆盖 | `runtime.ts:11090` |
| **记忆写闸门** | `runtime.ts:32350-32355` |
| run-digest 自动批准 | `runtime.ts:32350-32390` |
| 审批→记忆镜像 | `runtime.ts:12674-12702` |
| 真实 provider 请求取用 snapshot | `runtime.ts:31432` |
| systemPrompt 拼装顺序 | `apps/runtime/src/context-snapshot.ts:179-181` |
| `CONTEXT_COMPACT_THRESHOLD = 0.7` | `context-snapshot.ts:4` |
| token 估算 = `byteLength/4` | `context-snapshot.ts:81-84` |
| `selectRecentMessagesWithinBudget` | `context-snapshot.ts:108-127` |
| compact 边界过滤 | `apps/runtime/src/context-message-history.ts:164-171` |
| `contextManifest` 冻结 | `apps/runtime/src/collaboration-chat-service.ts:728` |
| `contextSequence` 冻结 | `collaboration-chat-service.ts:722` |
| memory 正/负向断言 | `apps/runtime/src/collaboration-workflow.integration.test.ts:142-145` |
| 两 room 不混 | `apps/runtime/src/task-room.test.ts:59-66` |
| `memory_change` / `memory_entry` / `diagnostic_record` DDL | `packages/storage/src/schema/memory.ts:6 / 33 / 56` |
| `applyApprovedChange` / `deactivateActive` | `packages/storage/src/memory-store.ts:476 / 486` |
| `proposeChange` / `decideChange` / `rollbackChange` | `memory-store.ts:259 / 325 / 534` |
| `listActiveEntries` | `memory-store.ts:390-415` |
| `resolveProjectMemorySources` | `packages/core/src/context-packet.ts:165-222` |
| `PROTECTED_SOURCE_KINDS` | `context-packet.ts:44-49` |
| `selectContextSources` | `context-packet.ts:535-590` |
| `buildContextPacket` | `context-packet.ts:704-744` |
| `MemoryScope` | `packages/shared/src/types/agent.ts:13` |
| `MemoryCommandContract` | `packages/protocol/src/memory-command-contract.ts:11-28` |
| `agent_context_thread` / `context_epoch` store | `packages/storage/src/agent-context-store.ts:44-114`（**当前无 room 调用点，见 U-1 相关**） |

## 附录 B · Grok Bot 侧引用出处

| 事实 | 出处 |
|---|---|
| 桌面端不拼 prompt；`GrokBotAgentDefinition` 含 `memory_shards[]` | `docs/research/grok-bot/02-context-and-memory.md:13, 24` |
| `memory_shards` 字段全表（scope/scope_key/version/box_backfilled/updated_at_ms/folder） | `02:130-139` |
| `GrokBotMemoryFolder{profile, logs[]}` + tier `"log"` | `02:143-152` |
| `GrokBotMemoryFact{fact_id,text,learned_at_ms}` | `02:158` |
| `PromoteGrokBotMemoriesToTeam` 请求/响应字段 | `02:163-164` |
| `GrokBotTeamContextSummary{memory_version,generated_at_ms,prose,summary_model}` | `02:167` |
| 记忆写入时机（模板/UI/提升/自主） | `02:176-184` |
| 记忆注入位置（推断：系统提示后、工具描述前） | `02:188` |
| scope/scope_key 取值【未证实】 | `02:195-207` |
| room turn 请求体不含成员记忆/技能/transcript | `02:116-118` |
| `is_self` 协议存在但零读取点 | `02:361, 442` |
| 群聊独立 transcript / 发言不进成员工作 transcript | `02:309-318, 359-360` |
| `PreCompact` 触发输入字段 | `02:244-260` |
| 摘要写回 `conversation_summary`，**不写 memory_shard**；原文保留 | `02:285-290` |
| 客户端投机摘要配置 70%【线索，未证实作用于 Grok Bot】 | `02:297-299` |
| `PutGrokBotMemoryShard` 在 0.63.0 已不存在 | `05:265, 825` |
| `box_backfilled` 为透传字段【未证实语义】 | `05:560, 804` |
| box 侧 `store.db` schema 未知 | `05:542-560, 802` |
| 「每轮重发完整 transcript」+「不是预期行为」 | `06:277-280` |
| 200–250k tokens/回复；80–90k tokens/step | `06:281` |
| 无 in-place compact，workaround = Duplicate + Hide | `06:282` |
| **「记忆属于 bot 而非 chat」，单 bot 跨群必串味** | `06:290-292` |
| 新加群成员看不到加入前历史（推断） | `06:300` |
| 客户端无 compact 原语（`/compact`、`autoCompact`、`compactContext` 全 0 命中） | `07-verification-report.md:780` |
