# SYNC-THINK 协作内核大改造 · 总方案（MASTER PLAN）

- 日期：2026-10-01（Asia/Shanghai）｜版本基线：`COLLABORATION_EXECUTION_VERSION = 6`
- 依据：5 份并行设计文档（`01`~`05`）+ Grok Bot 0.63.0 实测机制（`docs/research/grok-bot/01~07`）
- 阅读顺序：本文 → `01` 现状批判 → `03` turn 重构（核心）→ `02` 上下文/记忆 → `04` 加人/自进化 → `05` 红队失败模式

---

## 0. 结论先行

你说"现有实现很差劲"——**方向是对的，但症结不是"没好代码"，而是架构选错了轴**。

现有实现是一台**"以房间快照为唯一真相的单写者任务队列，外面套了一层聊天皮"**：
人类消息只能唤醒唯一的 coordinator → coordinator 把工作固化成 `CollaborationTask` → worker 以"只读研究员"身份执行 → 产出回交 artifact。**成员连"我不该说话"都无法表达**，除只读咨询外的自主通信被结构性禁止。

Grok Bot 的分歧点不在参数（并发数、预算、`@` 语法），而在**"谁决定下一个发言者"**：
把"本轮轮到谁"做成一次**可幂等的 turn 派发**，成员可以用 `PASS` 显式弃权，服务端逐成员**投影**上下文。

→ **改造的靶心是一件事：把"coordinator 派工"换成"turn 编排"。** 其余（记忆、加人、自进化）都是挂在这根轴上的。

> ⚠️ **动工前必做**：审计期间 `apps/` 正在被并发修改（`collaboration-chat-service.ts` 1185→1189 行、`collaboration-chat-host.ts` 617→626 行，新增 `workflowStartAllowed` / `coordinates`）。**基线没有被冻结**。请先按 `01` 文档第 0 节的 8 个文件 sha256 打 tag，否则"改好了"无法验收。

---

## 1. 三个真正的症结（对应你"很差劲"的三个体感）

### 症结 1：结构上不允许"成员不说话"——所以要么没人答，要么全员答

| 事实 | 证据 |
|---|---|
| 无 `@` 时**默认塞给 coordinator**（唯一路由器） | `collaboration-chat-service.ts:1039-1046` |
| 成员**没有 PASS 语义**：任务一旦派发就必须产出或失败 | 无 `TurnOutcome` 等价物 |
| 环路保护**数的是消息，不是轮次** → 全员弃权不产生消息 → **预算永不增长，无限循环撞不到上限** | `withinLoopBudget` `:1054-1071` |

**后果**：`PASS` 缺失 + 预算按消息计数 = 既不能沉默，也拦不住空转。这是"群里看着热闹但没人干正事"的根因。

### 症结 2：记忆系统齐全，但被两道显式闸门挡在房间之外

| 事实 | 证据 |
|---|---|
| `memory_change`（带 `approvalState`）/ `memory_entry`（带 scope）**表都在** | `packages/storage/src/schema/memory.ts` |
| 房间主路径**显式不读记忆** | `runtime.ts:25050` |
| 房间主路径**显式不写记忆** | `runtime.ts:32350-32355` |
| 且被测试**固化**为预期行为 | `collaboration-workflow.integration.test.ts:144-145` |
| 唯一的自动记忆写入是非房间会话的 240 字符 auto-approve 摘要（无界增长） | 同上 |

**结论**：不是"没有记忆"，是**"记忆没接进 room"**。你投入建好的记忆治理（审批 + 版本 + 回滚）**在群聊里完全没生效**。

### 症结 3：一次成功协作出不了任何可复用资产（自进化为零）

| 事实 | 证据 |
|---|---|
| `create_skill/create_agent/create_team/...` 只对 `model` track 开放，房间内被**目录过滤 + 派发拒绝双闸**关死 | `collaboration-policy.ts`、`chat-tools.ts` |
| `derived` 语义是"改一版"，**没有 `deriveFromRun`**（不能"跑顺一次→存成 skill"） | `04` §3 |
| 记忆读写双禁（见症结 2） | 同上 |

**结论**：Grok Bot 的自进化是"人类沉淀 → bot 落库复用"；我们连"沉淀"这一步的入口都没有。

---

## 2. 硬缺陷 Top 10（全部带代码证据，可直接复现）

| # | 级别 | 现象 | 证据 | 后果 |
|---|---|---|---|---|
| D1 | **P0** | 群内**文件交付默认 100% 立即失败**（host 以 `ask` 模式执行 → claims 全 read → 写文件被拒） | `collaboration-chat-host.ts:522` → `runtime.ts:21355` | 让 bot 在群里产出文件=必然报错 |
| D2 | **P0** | `probeStatus` **生产未接线**："状态待确认、正在核对"是**死文案**；120s 后无法区分"慢任务"与"卡死" | `collaboration-chat-service.ts:870` 初值 `status_unconfirmed` + `:873` `if (this.ports.probeStatus)`；`:894` 的 catch **可**把它推向 `status_delivery_failed` | `observation` 常态**永久停在 `status_unconfirmed`**；UI 常驻"正在核对"，没有任何升级/超时分支（探针装了也只产出 `normal` / `notification_delayed`，仍无"卡死"态） |
| D3 | **P0** | 执行器不落地 → **房间永久锁死**（attempt 只由 promise settle 离开 ACTIVE，`stopping` 也算 ACTIVE，resume 门槛卡在 service:339） | `:339` | 一次崩溃 = 该房间再也起不来 |
| D4 | **P0** | 等待咨询**没有任何期限**：期限只在 `start()` 武装（`:748`），`queued + waitReason='peer_reply'` 的等待者只写 waitReason、**不武装计时器**，也不在并发计数内 | `:710-715` vs `:748` | 一个卡住的同伴可**永久钉住**请求者，UI 只显示"等待回复" |
| D5 | **P1** | 派工静默空转却回 `ok:true`（假成功） | `collaboration-chat-host.ts:293` + `runtime.ts:27455` | UI 说成功，实际没派出去 |
| D6 | **P1** | 加单个 Agent 时**已存在成员不刷新 name/role**（team 路径整行替换，agent 路径只置 `active=true`） | `collaboration-chat-host.ts:552-564` | 协调员**按过期分工派活** |
| D7 | **P1** | 房间内**三套执行生命周期并存**（`collaboration-*` / `orchestration/*` / `delegation-*`），没有唯一真相 | `05` FM-13 | "这个工作在跑没有"无法回答 |
| D8 | **P1** | **三套并发控制互不通气**：房间 `min(3,maxConcurrent)`（按 workspace）、`Scheduler` 对 ready step **无上限**、全局 `taskMaxConcurrent` 默认 2 | `:691`、`scheduler.ts`、`runtime.ts:19002` | 并发超卖/饥饿随机发生 |
| D9 | **P1** | **策略边界三处自相矛盾**：协议 `[1,16]/[1,20]/[1,100]`、运行时 `[1,3]/[1,6]/[1,12]`、准入 `Math.min(3,…)`；protocol 测试 8 个用例**无一条**覆盖这些数值 | `packages/protocol` vs `apps/runtime` | 改一个数会在另一层静默失效 |
| D10 | **P1** | **kernel session key 按 room 而非 room×agent 分片** | `runtime.ts:21897`，与 `ADR-0004:20` 承诺不符 | 同房间不同 agent 可能共用 provider session → 串味 |

补充（同样有证据）：artifact_index **无 token 上限**（饱和实测 27,154 字节，占块 35%）；预算**按字符算而 token 按字节算**（中文实测 3× 偏差：11,922 字符 = 35,644 字节）；`/compact` 与 70% 阈值走 `conversation→task.thread`，**与 room attempt 的 thread 不重合**。

---

## 3. 目标架构：turn 编排（核心，详见 `03`）

```
用户消息 / 成员消息 / 定时器
        │
        ▼
  decideTurn(trigger, snapshot, quota, now)      ← 纯函数，可单测
        │  五级链：@ > 回复继承 > 当前负责人 > 触发条件(4a-4e 有序白名单) > 不派
        ▼
  room_turn (SQLite，持久工作流实体)              ← 新增表
        │  nonce = sha256(decisionMemo)[:32]     ← 同一决策重放必得同一 nonce
        ▼
  RoomTurnScheduler（daemon 内，单写者）          ← 挂在既有"daemon 是唯一调度者"约定下
        │  租约 + fencing + 幂等键（复用 step 表已在生产的形态，抽成 orchestration/lease.ts）
        ▼
  成员执行 → Deliver(outcome, messages[])
        │  outcome = SENT | PASS | SKIPPED | TIMEOUT | CANCELLED | ERROR
        ▼
  投影给每个成员（is_self）→ 结算 → 下一 turn 或 wind-down
```

**与现状最大的三个不兼容点（必须先认账）**

1. **默认结局从"派给 coordinator"变成"不派"** → `queueRoomFollowups` 必须删、`queueSummaries` 收窄。**风险是"静默死锁"**（长时间无人说话），靠不变量 I-4（`no_dispatch`/`held(winding_down)` 也必须武装静默期定时器）兜底。
2. **预算口径从"数消息"改成"数 turn"** → 这是修复症结 1 的关键，但会让既有"按 task 计数"的测试大面积失效（PASS 的 turn 产生 0 消息 / 0 task / 0 attempt）。
3. **并发收敛为"四级槽位单一仲裁者"** → 取代现状三套互不通气的控制。

**四闸阈值（建议值）**：`hop ≤ 6`｜`预算 ≤ 12 turn`｜`期限 30 min`｜`静默期 5 min`。**熔断器只由闸④打开**（①②③是"资源用完"，正确动作是收口而不是熔断）。64 节点上限保留，但**重新划作用域**为"冻结 DAG 平面"，turn 平面另设 32 工作项/epoch。

**PASS 合法性（P1–P4）**：封闭 `pass_reason` + 非人类点名 + 无未结算交付 + `hop ≥ 1`；违规返回 `illegal_pass` 并记 error —— **弃权必须可审计，不能变成任务静默消失的通道**。

---

## 4. 我需要你拍板的 6 个决策点

| # | 决策 | 我的建议 | 理由 |
|---|---|---|---|
| **A1** | 记忆：room 是否**自动读** project/global 级记忆？ | **不自动读，只认显式提升** | Grok Bot 员工实测事故："每个 bot 只有一份 memory 横跨 1:1 与所有群"→ 单 bot 跨群必串味（`06:290`）。OV2 主张显式提升，我采纳 |
| **A2** | 房间内能否创建 skill/agent？ | **只能提议，一律 pending，人审后才创建/启用/绑定** | 对齐 Grok Bot 的 `update_state`（写内容不写边界）。新增 `capability_candidate` + A1–A11 能力矩阵 |
| **A3** | 是否引入 Grok Bot 式"群即 agent"？ | **不。保留"Room 是一等对象"** | 我们已有更好的东西（`room.goal` + `goalRevision` + checkpoint + artifact 版本化）；"群即 agent"是 Grok 为了复用 UI 抽象的取舍，抄它反而丢资产 |
| **A4** | `PASS` 是否允许"整轮无人发言"？ | **允许，但必须可见 + 武装静默期定时器** | 不派 ≠ 卡死；UI 必须显示"本轮无人应答"，而不是假装在跑 |
| **A5** | 是否保留 coordinator 角色？ | **保留为"可配置默认负责人"，但不再是唯一路由器** | 对齐 `2026-10-01` 对齐文档 §4.3；Grok Bot 的 coordinator 是"常规路由"，不是中转站 |
| **A6** | 改造成本最大的两项（D1 文件交付、D3 锁死）先修还是随重构一起修？ | **先独立热修**（P0 止血，1~2 天），再动物理内核 | 它们与 turn 重构无耦合，拖着会让用户在改造期完全无法用群聊 |

---

## 5. 分阶段路线图

### Phase 0 · 冻结基线 + P0 止血（1~2 天）
1. 按 `01` §0 的 8 个 sha256 **打 tag**，冻结审计基线。
2. 修 **D1**（群内文件交付必然失败）、**D2**（接上 `probeStatus`，让"卡死"可见）、**D3**（房间永久锁死）、**D4**（等待咨询无期限，武装计时器）。
3. 修 **D5**（假成功：派工空转必须回真实状态）。
4. 收敛 **D9**（三处策略边界矛盾 → 一份常量 + 补测试）。
> 出口标准：群内能产出文件；崩溃后房间能恢复；等待有上限；不再出现 `ok:true` 却没派出去；"卡死"与"慢"在 UI 上可区分。

### Phase 1 · turn 编排落地（核心，2~3 周）
1. 建表：`room_turn` / `room_turn_decision` / `room_turn_event` / `room_quota`；抽 `orchestration/lease.ts`。
2. 实现 `decideTurn` 纯函数 + 五级链 + 门禁三豁免（mention / wind_down / resume）。
3. **影子模式**（P1）：只写决策不接管，与现状对比**分歧率 < 5%** 再继续。
4. 新房间启用 turn 平面（P2）；旧房间人工升级（P3，在途 attempt 不转换，turn 侧排除有活 legacy attempt 的成员）。
5. 默认开启（P4），`EXECUTION_CAPABILITY_VERSION` 6 → **7**。
> 出口标准：`03` §9 的 63 个验收用例（P0 30 个）全绿；不抢答、单一负责人、并行可证、崩溃恢复、重复投递不重复副作用。

### Phase 2 · 记忆接进 room（1~2 周）
1. `memory_entry` **加 8 列**（`room_id`/`owner_agent_id`/`source_kind`/`confidence`/`superseded_by`/`pinned`…）+ 按 `(scope,task,room,agent,key)` 唯一索引（**修现状"同 key 跨 scope 互顶"**）。
2. 新增 `memory_promotion` 与 `room_brief`（含 `memory_version`/`prose`/`stale`，对齐 `GrokBotTeamContextSummary`）。
3. **5 个写入触发点**；room 摘要**一律 pending 不自动批准**（修现状 `autoApprove:true` 的无界增长）。
4. 注入位置：`confirmed_goal` 之后、当前请求之前；**必须注册为 Context Packet source 才进预算**。
5. 统一预算口径为**字节**：room 块软 32,000 / 硬 48,000 字节；裁剪顺序 `artifact_index → 工作索引 → 最旧历史`，**goal 永不裁**。
6. 压缩分四级：L0 每轮 / L1 room brief 70% / L2 checkpoint 归档 / L3 扩展现有 compact 覆盖 attempt thread；**摘要写 `room_brief`，原文一律不删**。
7. 修 **D7**（三套生命周期收敛为唯一真相）。
> 出口标准：一次成功协作能产出可复用资产；跨 Room 无串味（含 D10 的 session key 修复）。

### Phase 3 · 入群包与自进化（1~2 周）
1. **OnboardingPacket v1**：加入时刻生成一次、随 attempt 注入（**零新表**，落 system 消息），七段：`goal+revision` / `roster+roleSource` / `decisions(强制 sourceMessageId 防幻觉)` / `artifacts(+sha256+isCurrentDeliverable)` / `readScope(crossRoomAccess:false)` / `readReceipts` / `handoff(stageOwner+openTaskIds+doNotRedo)`；≤8k 字符，带 `topologyRevision` 失效判定与 stale 标记。
2. 修 **D6**（`member.role` 快照不刷新 → 协调员按过期分工派活）。
3. **能力沉淀链路**：跑顺一次 → `capability_candidate`（pending）→ 人审 → skill/routine 启用；新增审计事件表。
4. 永久红线：**模型 / 系统提示 / harness / 权限模型不可改**（对齐 Grok Bot 的"改内容不改边界"）。
> 出口标准："新人不犯错"拆成可测四条：N1 不重做 / N2 不越权 / N3 认领正确阶段 / N4 交接可验证。

---

## 6. 不照搬清单（红队 `05` 的反向结论，7+1 条）

| 不照搬 | 理由 |
|---|---|
| 服务端权威编排（Temporal） | 我们是本地优先；用 daemon 单写者 + SQLite 租约/fencing 等价替代 |
| 无回放加人 | Grok Bot 官方与社区**双空白**，实测新人靠同僚交接；我们用显式入群包做得更好 |
| bot 自主改名/自我修改 | 权限边界不能交给模型；只允许提议 + 人审 |
| 跨 1:1 与所有群共享一份 history | 员工实测串味事故；我们必须 room 隔离 |
| 按周配额限流 | 本地 BYO key **没有配额这个天然熔断** → 等价物是"信用卡"，必须自建预算 |
| 全员广播唤醒 | 必然抢答风暴；用触发条件白名单 |
| "每轮全量重发 transcript" | 实测 200–250k tokens/回复，员工自称 "not intended behavior"；我们做投影不做复制 |
| 把多 bot 群聊当主路径 | 反讽点：Grok Bot 员工自己推荐 **one bot + subagents**，而 `subagents` 在 21 个官方文档页里**从未出现** |

**成本纪律（照搬税可量化）**：N=4 / M=200 时，全量投影 89.5M tok ≈ **$283**，增量投影 20.2M ≈ $75（**4.4×**；N=8 时 7.6×）。熔断建议：join 300s（最关键）、人类缺席 900s→暂停并释放并发槽、房间 60min 自动消息 ≤30、同 pair 往返 ≤3、每轮调用 `min(N,4)`、每轮 200k tok / 每群日 2M、`stopping` 强制终止 60s、`@all` 默认 notify 不唤醒。

---

## 7. 必须一起改的 ADR

- **新增 ADR 0005**：显式 supersede `ADR-0004` §12/§64 的派工条款（`workers 不可再派工`、`不为新 room 编译 all-member DAG`）与 capability version 5→7 的描述（代码实际已是 6）。
- **修改 ADR-0004**：`Membership and migration` 段（`member.role` 刷新）、`Isolation and context` 段（记忆接入 room、session key 按 room×agent 分片）。

---

## 8. 证据索引与复现

| 主题 | 文档 | 关键复现手段 |
|---|---|---|
| 现状执行模型 + 20 条缺陷 | [01-current-architecture-critique.md](docs/design/grokbot-overhaul/01-current-architecture-critique.md) | 8 文件 sha256 钉版本 + 符号/行号双锚点 |
| 上下文与记忆差距 | [02-context-memory-gap.md](docs/design/grokbot-overhaul/02-context-memory-gap.md) | 151 条 `file:line` 经脚本校验 100% 通过 |
| **turn 编排重构（核心）** | [03-scheduling-turn-redesign.md](docs/design/grokbot-overhaul/03-scheduling-turn-redesign.md) | 890 行；63 个验收用例；18 项文件改动清单 |
| 动态加人与自进化 | [04-membership-evolution-gap.md](docs/design/grokbot-overhaul/04-membership-evolution-gap.md) | 入群包七段 JSON 规格 + A1–A11 能力矩阵 |
| 失败模式红队 | [05-failure-modes-and-redteam.md](docs/design/grokbot-overhaul/05-failure-modes-and-redteam.md) | 19 条失败模式；成本模型 `.tmp-grok-bot/verify/ov5-cost-model.mjs` 可复算 |
| Grok Bot 机制（对照组） | [GROK-BOT-MECHANISMS.md](GROK-BOT-MECHANISMS.md)、[07-verification-report.md](docs/research/grok-bot/07-verification-report.md) | 红队独立复现，推翻 3 条 |

> 所有设计文档都把行号锚定在 **2026-10-01 11:15~11:20 的快照**上。`apps/` 仍在被并发修改，**动工前请先冻结 revision**，否则文档之间会互相"证伪"。
