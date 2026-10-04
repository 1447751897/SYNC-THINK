# OV5 · 失败模式红队：这次协作改造会怎么失败

> 角色：**红队**。本文的立场是**证明这次改造会失败**，不是评估它有多好。
> 基准：`docs/reviews/2026-10-01-grok-bot-collaboration-alignment.md`（下称《对齐规格》）拟采用的 Bot / Squad / Room / Work item + 三种通信命令 + 有界路由 + 三层上下文 + 跨群显式交接。
> 事实来源：Grok Bot 0.63.0 逆向（`docs/research/grok-bot/01~07`）+ SYNC-THINK 现有实现（`apps/runtime/src/collaboration-*.ts`、`orchestration/*`、`packages/protocol|shared|storage`）+ 历史故障复盘（`docs/reviews/2026-09-29`、`2026-09-30`）。
> 日期：2026-10-01。**本文不改任何代码**；所有"复现"都是可在现有测试基座上写出来的红灯用例。
>
> **版本基准（重要，引用前请核对）**：本文所有 `apps/runtime/src/collaboration-chat-service.ts` 的行号锚定在 **2026-10-01 11:15 的修订**，SHA-256 `FB6B65F27AA5BF974636A7FF9F19BDB91A992D9F99B807FACD75AA1BCA34F324`（1,190 行 / 62,879 字节）。该文件在本文写作期间（11:12）**被另一个改造任务并发修改过**，行号整体下移约 3 行；我已逐条重锚并复核每个引用仍然存在，**但结论依赖的行为细节请以你自己的当前修订为准**。其余引用基准：`orchestration/scheduler.ts`（2026-09-19）、`packages/protocol/src/collaboration.ts`（2026-09-12）、`packages/shared/src/types/collaboration-chat.ts`、`packages/protocol/src/collaboration-chat.ts`、`packages/storage/src/collaboration-store.ts`、`docs/reviews/2026-09-29`、`2026-09-30`、`2026-10-01`。

## 严重度口径

| 级别 | 含义 |
|---|---|
| **致命** | 会直接产生不可接受后果：烧钱无上界、数据/产物错乱、系统无法收敛、用户无法自救 |
| **高** | 会造成静默错误或可观测的长时间卡死，需要人工介入才能恢复 |
| **中** | 体验与信任损耗，或需要额外排查成本；不会直接损坏数据 |

**标注 `【照搬高代价】` 的条目 = 这一条正是照抄 Grok Bot 架构才会付高昂代价的地方。**

---

## 0. 结论先行

### 0.1 最致命的三条

1. **FM-01 无自然熔断**：Grok Bot 的"每条 bot-to-bot 消息烧一次周配额"在本地自带 API key 下**等价物不是配额，是信用卡，而且没有任何东西会先烧完**。Grok Bot 的浪费是**自限的**（配额耗尽 → 用户被迫发现）；我们的浪费是**静默无界的**。照搬 turn 编排 = 把"用户可感知的配额墙"换成"用户月底才知道的账单"。（见 FM-01/FM-02）
2. **FM-10 等咨询没有期限**：`queued + waitReason='peer_reply'` 的等待者**没有任何计时器**——执行期限只在 `start()` 里武装。一个卡住的同伴任务可以永久钉住请求者，而 UI 上只会显示"等待回复"。（见 FM-10）
3. **FM-13 三套执行生命周期并存**：`collaboration-*`（task/attempt/delivery）、`orchestration/*`（run/step/lease）、`delegation-*`（childRun）各自有状态机、超时与重试。改造会在其上再加 turn 语义，**"这个工作到底在跑没有"将没有唯一真相**，而《对齐规格》要求的"可见投递状态"正好依赖这个真相。（见 FM-13/FM-14）

### 0.2 一张表看完 19 条

| # | 失败模式 | 严重度 | 照搬高代价 | 一句话 |
|---|---|---|---|---|
| FM-01 | 无自然熔断：配额墙变成信用卡 | 致命 | ✅ | 本地没有周配额，只有账单 |
| FM-02 | N×M 成本放大 | 致命 | ✅ | 一句人类意图 × N 个模型调用 |
| FM-03 | 预算覆盖不完整 | 高 | | 只有只读 Native 路径真受预算约束 |
| FM-04 | 全量重发导致 O(M²) 上下文税 | 致命 | ✅ | Grok Bot 实测 200–250k tokens/回复 |
| FM-05 | "全成员投影"退化成"全成员复制" | 高 | ✅ | 投影是纪律，不是默认行为 |
| FM-06 | 礼貌回复/状态广播循环 | 致命 | ✅ | 非任务群默认 `expectsResponse=true` |
| FM-07 | 循环预算按 correlation 重置 | 高 | | 用户每插一句话，预算满血复活 |
| FM-08 | @所有人 风暴 | 高 | ✅ | 接收者上限 32、mention 上限 128 |
| FM-09 | 撤销私聊时过度取消队列 | 中 | | 无差别取消所有 queued attempt |
| FM-10 | 等咨询无期限 → 永久 waiting | 致命 | ✅ | 等待者没有 timer |
| FM-11 | 人不在就卡死并占槽 | 高 | | `waiting_input` 计入 ACTIVE |
| FM-12 | 崩溃后重复副作用/丢 turn | 高 | | turn 新副作用可能绕开幂等键 |
| FM-13 | 三套生命周期并存 | 高 | | 没有唯一真相 |
| FM-13b | `stopping` 卡住 `room-resume` | 高 | | 房间无法恢复，且调度器已解决过同一问题 |
| FM-14 | 假成功与静默丢消息 | 高 | | 有字段，无对账 |
| FM-15 | 设置保存静默失败 | 中 | | 用户以为收紧了，实际没有 |
| FM-16 | 诊断不可导出 | 中 | | 出事无法复盘 |
| FM-17 | 迁移静默放宽权限 | 高 | ✅ | 旧群可能"悄悄能互咨询" |
| FM-18 | 肌肉记忆与回滚 | 高 | | 入口/动词一变，用户不会用 |

（表内 19 条 = FM-01…FM-18 + FM-13b；`【照搬高代价】` 共 8 条。）

---

## 1. 改造落在现有代码上的 6 个承压点

在开始打之前，先承认现状**已经**有不少正确的护栏（这不是客套，是红队必须知道靶子在哪）：

| 已有的护栏 | 位置 | 为什么仍然不够 |
|---|---|---|
| 幂等请求收据 | `collaboration-chat-service.ts:1111-1122`（`duplicate()` + `collaboration.idempotency_conflict`）；`packages/storage/src/collaboration-store.ts:130`（`collaboration_receipt` 表） | 只覆盖命令层，不覆盖 turn 模型新增的外部副作用 |
| 因果链 | `CollaborationMessage.correlationId / causationId / hopCount`（`packages/shared/src/types/collaboration-chat.ts:86-88`） | 有 ID，无端到端对账断言 |
| 投递状态 | `CollaborationDelivery.status = queued\|processing\|processed\|failed\|cancelled`（同文件 :96） | 状态存在，但不保证"有产出" |
| 等待原因 | `CollaborationAttempt.waitReason`（:170，含 `loop_limit`/`peer_reply`/`capacity`） | 原因可见，**期限不可见** |
| 循环预算 | `withinLoopBudget()`（`collaboration-chat-service.ts:1054-1067`）hop≤6、auto≤12 | 按 correlation 计数 → 会重置（FM-07） |
| 起点强制因果 | `collaboration.automatic_causation_required`（:161、:265） | 只防"凭空开口"，不防"回复链" |
| 顾问环检测 | `collaboration.consultation_cycle`（:176-182） | 只沿任务父子链检测（见 FM-06 注） |
| 崩溃恢复不重放 | `recover()` "never replays an execution that may already have written external state"（:633-659）+ `owner_lost` | 仅覆盖 collaboration 执行器；turn 新路径未必接入 |
| 调度器租约/幂等 | `scheduler.ts:76` `DEFAULT_LEASE_DURATION_MS=30_000`、`step-executor.ts:60` "must deduplicate external effects by context.idempotencyKey" | 这是**另一套**引擎，与 collaboration 层不共享状态（FM-13） |
| SQLite 事务纪律 | `collaboration-store.ts:60-77`（`.immediate()` + 快照读）、`connection.ts:45-51`（WAL + busy_timeout=5000） | 单机单进程下够用；跨进程/多窗口仍有 5s 写竞争窗口 |
| 默认全关 | `packages/protocol/src/collaboration.ts:23-31`（`dynamicSubagentsEnabled:false`、`allowAgentTaskDispatch:false`、`allowAgentPeerMessaging:false`） | 安全默认是好事，但改造要"打开"，**打开后的第一分钟就是本文的攻击面** |

**承压点 = 改造把哪些默认值从"关"改成"开"**：这就是全部风险的来源。以下 19 条失败模式按此展开。

---

## 2. ① 配额与成本爆炸（FM-01 ~ FM-03）

### FM-01 【致命】【照搬高代价】无自然熔断：Grok Bot 的"周配额墙"在本地变成"信用卡"

- **Grok Bot 的事实**：员工 mohitjain——"**Each bot-to-bot message burns a weekly-usage turn**；要求在聊天里让 bots 'stay quiet' 只是 **hint**"（`docs/research/grok-bot/06-official-docs-and-public-narrative.md` §4 落差 1）。官方产品的浪费**有硬上界**：配额烧完，用户立刻知道。
- **本地等价物**：没有周配额。唯一的自动上界是 `maxAutoMessages=12`（**每个 correlation**）与 `maxConcurrent=3`。
- **触发条件**：任一多成员房间在"允许自动往返"打开的情况下进入多轮讨论。
- **为什么这比 Grok Bot 更危险**：Grok Bot 的配额是**共享的、可见的、会耗尽的**；本地是**按 token 计费的、不可见的、不会耗尽的**。同一个架构，本地版本的失败模式从"用不了"升级为"账单"。
- **怎么在测试里复现**：
  1. 用模拟提供方（`docs/testing/grok-peer-collaboration-acceptance.md` §自动化与视觉验证 已说明用模拟提供方），给 provider 桩加**调用计数器与 input/output token 累计**。
  2. 建 4 人房间，注入一条用户消息，让全部成员可自动往返，跑 `pnpm --filter @sync-think/runtime exec vitest run collaboration --testTimeout=20000`。
  3. 断言"本次用户轮内模型调用次数 ≤ 4"。
  - **当前必然失败**：上界是 `12 × N = 48` 次/轮（`withinLoopBudget` 只数消息条数，不数调用，也不数 token）。
- **对策（硬约束）**：
  1. 引入**双层预算**：`turnBudget`（每用户轮）+ `sessionDailyBudget`（每群每日）；任一超限 → 立即停止新增回合，房间进入 `paused` 并写系统消息，**不是静默继续**。
  2. 把 `taskTokenBudget` 的默认值从 `null`（`packages/protocol/src/collaboration.ts:28`）改为**非空默认**（建议 200k tokens/任务），"无限制"必须是用户显式选择且带二次确认。
  3. 每次模型调用后累加 ledger，**在调用前**检查（预扣），不能只在收到 usage 后终止（现状 `delegation-admission` 的预算只覆盖部分路径，见 FM-03）。
  4. UI 常驻显示"本轮已用 X / 上限 Y"，并在 80% 时提示。

### FM-02 【致命】【照搬高代价】N×M 成本曲线：一处人类意图被放大 N 倍

- **触发条件**：成员数 N ≥ 3 且线程轮数 M 上升；或"每轮全员轮流"被设为默认。
- **量化**（可复现脚本 `.tmp-grok-bot/verify/ov5-cost-model.mjs`，`node .tmp-grok-bot/verify/ov5-cost-model.mjs`）：

  | 模型 | N=4, M=50 | N=4, M=200 | N=8, M=200 |
  |---|---|---|---|
  | 串行流水线（现有冻结 DAG 的 serial 策略，含 32k 历史 + 180k 上游上限） | 200 次调用 / **$85** | 800 次 / **$341** | 1,600 次 / **$681** |
  | turn 模型 · **全量投影**（每成员重读整房间） | 9.18M in tok / **$31** | 89.5M in tok / **$283** | 319M in tok / **$986** |
  | turn 模型 · **增量投影**（只发 new_messages） | 5.04M in tok / **$19** | 20.2M in tok / **$75** | 41.8M in tok / **$154** |

  （口径：`TOK_PER_CHAR=0.62`、输入 $3/Mtok、输出 $15/Mtok；所有上限按源码实测值代入，即**在限额全部生效的前提下**仍是这个量级。）
- **Grok Bot 锚点换算**：员工实测"week-long threads burn **80–90k tokens/step**"、用户实测"~**200–250k input tokens per reply**"（06 §4 落差 2）。按 4 成员 × 50 轮 × 225k = **45M tokens ≈ $135**（@$3/Mtok）——**这只是一条线程**。
- **怎么在测试里复现**：跑上面的脚本；再把它接进 CI 作为"预算回归"，断言 `full/incremental` 比值在 M=200 时不超过 2×。
- **对策**：
  1. **默认单负责人**：一轮只有一个成员被唤醒，其余静默（现有 `recipients()` 无指定接收者时只投协调员，`:1040`——**保住这个默认**）。
  2. 全员 fan-out 必须是**显式 opt-in**，且带独立预算。
  3. 预算按**每次人类意图**计量并展示，让"人多 = 贵"这件事对用户可见。

### FM-03 【高】预算覆盖不完整（历史问题，改造前必须修）

- **事实**（`docs/reviews/2026-09-30-agent-collaboration-unification-audit.md` §2.7 / §3 P1，我在源码中确认了结构）：
  - Native 执行的 `maxOutputTokens` 与 usage 累计终止被 `delegatedReadOnly` 条件包住 → **可写委派没有同等检查**；
  - 外部内核只记账不终止；
  - 群聊/小队任务不继承 `taskTokenBudget`；
  - 超预算结果是 `failed/budget_exceeded`，不是界面承诺的"自动摘要"。
- **触发条件**：打开可写委派 + 设一个 token 预算 + 让子任务跑外部内核。
- **怎么在测试里复现**：三个用例同一预算值，分别走 Native 只读 / Native 可写 / External，断言三者都在同一预算处停下且结果类型一致。当前三者行为必然不同。
- **对策**：**先统一预算再谈 turn 编排**。改造顺序上，FM-03 是前置项：没有统一 ledger，"每轮预算"只是又一个不一致的开关。

---

## 3. ② 上下文爆炸（FM-04 ~ FM-05）

### FM-04 【致命】【照搬高代价】全量重发 → O(M²) 上下文税

- **Grok Bot 的事实**：员工 deanrie——"**The full transcript gets sent back to the model on every turn**, and there aren't any explicit primitives yet to cut older messages from what the model sees."；"This **isn't intended behavior**."（06 §4 落差 2）。同一帖用户实测 ~200–250k input tokens/回复。
- **本地现状**（不是没有防护，是防护本身就是成本）：
  - `collaboration-workflow.ts:51` `let remaining = 32_000;` → 每次尝试注入的历史上限 32k **字符**；
  - `collaboration-workflow.ts:87-88` 上游产物 JSON 上限 `180_000` 字符，超限直接抛 `collaboration.upstream_context_too_large`；
  - `collaboration-chat-service.ts:722` `attempt.contextSequence = draft.messages.at(-1)?.sequence ?? 0` → **取"当前全部消息"的序号**，不是增量。
  - 32k + 180k 字符 ≈ **130k tokens 的单次调用**。
- **触发条件**：一条线程 M 增长；或前置产物接近 180k 上限（长文档写作正是本项目的目标场景）。
- **怎么在测试里复现**：构造 M=1..200 的消息序列，抓取每次 `buildCollaborationExecutionContext()` 的输出长度，断言"第 M 轮的 prompt 长度不超过第 1 轮的 K 倍"。
- **对策（"投影而非复制"的 5 条硬约束）**：
  1. **单一事实源 + 按需回读**：房间历史只存一份；成员拿到的是**引用 + 可回读工具**，不是副本。
  2. **投影必须携带丢弃计数**：现有 `contextManifest.historyOmitted`（`packages/shared/.../collaboration-chat.ts:196`）就是正确形状——**投影必须能自证它丢了什么**，并写进 attempt 记录。
  3. **产物流转只传引用**：`{id, sha256, bytes, path}`，正文按需读；现有 `CollaborationArtifact` 同时有 `content` 和 `path/storedPath/sha256`——**别在 turn 投影里顺手把 `content` 塞进去**。
  4. **每轮增量**：turn 投影只放 `new_messages`（Grok Bot 的 `RequestGrokBotRoomMemberTurnRequest.new_messages` 字段名就是正确示范，`docs/research/grok-bot/01` §3.1）。
  5. **上下文预算与被投影对象分离**：`user/room/bot` 三层各自有上限，不允许"上游太大就静默截断"——超限要显式失败或显式降级并告知。

### FM-05 【高】【照搬高代价】"全成员投影"退化为"全成员复制"

- **触发条件**：《对齐规格》§4.5 的"加入新成员：给本群目标、成员/职责、决定摘要和产物索引"被实现成"把房间历史整段拼进新成员 prompt"；或"投影"由模型自由裁剪。
- **数据侧证据（本机实测）**：Grok Bot 里群消息**不会**写进成员工作 transcript（跨成员群文本 0 命中，`docs/research/grok-bot/07` §2.5），我们如果改成"每人一份房间副本"，就是**主动做一个 Grok Bot 都没做的更差设计**。
- **怎么在测试里复现**：建群 → 灌 100 条消息 → 加新成员 → 断言新成员首次 prompt 的字符数 ≤ 阈值，且 `contextManifest.messageIds.length + historyOmitted == 房间消息总数`（对账而不是抽样）。
- **对策**：投影函数必须是**纯函数 + 可断言**（输入 snapshot → 输出 manifest + 文本），manifest 里的 `messageIds/artifactIds/historyOmitted` 与实际文本**必须双向对账**；禁止把他人 transcript 直接拼进 prompt。

---

## 4. ③ 循环与放大器（FM-06 ~ FM-09）

### FM-06 【致命】【照搬高代价】礼貌回复循环与状态广播风暴

- **触发条件（精确定位）**：`collaboration-chat-service.ts:171`
  ```ts
  const expectsResponse = command.expectsResponse ?? !(automatic && room);
  ```
  - `automatic = sender.kind !== 'user'`（`:148`）
  - **在任务群（有 `room`）里，bot 的自动消息默认不要求回应（安全）；但在普通群聊（无 `room`）里，bot 的自动消息默认 `expectsResponse=true`** → 生成 reply 任务 → 对方回复又是一条非任务群的自动消息 → 再次 `true`。
  - 唯一的刹车是 `enforceLoopBudget()`（`:213`）→ hop ≤ 6、auto ≤ 12（`:1065-1066`）。
  - 而《对齐规格》§4.3 恰恰要求把普通群聊做成主交互面（"确认、感谢、状态广播默认不唤醒下一轮"）——**规格要求的安全语义与代码默认值相反**。
- **放大器**：`collaboration.consultation_cycle`（`:176-182`）只沿 `parentTaskId` 链检测祖先，**非任务链的 peer 往返不在它的检测范围内**。
- **怎么在测试里复现**：
  1. 建一个**非任务群**（无 `room`），两个成员。
  2. 模拟两个成员都倾向回一句"收到/谢谢"。
  3. 断言"该 correlation 内的自动消息 ≤ 2"。
  - 当前上界 = `min(12 条自动消息, hop ≤ 6)` → 一个 2 人房间最多约 **6–7 条**自动消息、即 6–7 次额外模型调用（`:1065-1066` 两道闸门同时生效，且没有任何测试断言这个数）。
  - 注意放大路径：一条 expectsResponse 的消息会**按接收者逐个建任务**（`:219-236`，每个非用户接收者一个 attempt），所以"12 条消息"在 N 人房间里最坏等于 `12 × N` 个 attempt——这正是 FM-08 的成本来源。
- **对策（硬收敛设计，全部可断言）**：
  1. **默认不回应**：`expectsResponse` 默认 `false`；只有显式 `request_reply` 或 `intent==='work'` 才为 `true`。
  2. **通知不调用模型**：三语义显式化（`notify` / `request_reply` / `assign_task`），`notify` 不产生 attempt（《对齐规格》§4.2 已提出，需要在**协议层**强制而不是靠模型自觉）。
  3. **礼貌短路**：连续 2 条仅含致谢/确认/状态词且**无新信息**（无产物、无决策、无新工具结果）→ 强制静默并记 `suppressed:no_new_information`。
  4. **宽进严出**：hop 上限保持 6，但新增**同 pair 往返上限 3**（A→B→A 三轮后必须由人类或产物推进）。

### FM-07 【高】循环预算按 correlation 计数 → 用户每句话让预算满血复活

- **事实**：`withinLoopBudget()` 只统计 `item.correlationId === message.correlationId` 的消息（`:1061`）；而新 correlationId 在每次无因果的消息上新建（`:209` `correlationId: causation?.correlationId ?? this.id()`）。
- **触发条件**：用户在一个房间里连续发 20 条短消息（真实人类行为），每条都开新 correlation。
- **量化**：N=4 时理论上界 20 × 12 × 4 = **960 次自动模型调用**（对照 .tmp-grok-bot/verify/ov5-cost-model.mjs 输出）。
- **怎么在测试里复现**：连发 20 条用户消息，统计自动消息总数，断言 ≤ 30（而不是 240）。
- **对策**：**滑动窗口 / 令牌桶**替代"每 correlation 配额"：以房间为单位，60 分钟内自动消息 ≤ 30 条、模型调用 ≤ 60 次；人类消息只**部分**补充令牌（例如每条 +2，上限 30），而不是重置。

### FM-08 【高】【照搬高代价】@所有人 风暴

- **事实**：
  - `recipients()` 在**没有指定接收者**时只投协调员（`:1040`）——这是好默认，**必须保住**；
  - 但显式 @ 的边界很宽：`mentions.length <= 128`（`packages/protocol/src/collaboration-chat.ts:60`）、`recipientMemberIds` 上限 32（同文件 `:8` 的 `ids()`）。
  - `@所有人` 在前端是一个伪 ID（`__everyone__`，见 `docs/research/grok-bot/04` §3.4），展开后就是 N 个接收者。
- **触发条件**：一个 8 人房间里成员（或模型）使用 @所有人，且这些消息 `expectsResponse=true`。
- **怎么在测试里复现**：8 人房间注入一条 @所有人 消息，断言模型调用 ≤ 1（公告语义）而不是 8。
- **对策**：
  1. `@所有人` 默认映射为 **`notify`（不唤醒）**，要唤醒必须显式选择"要求所有人回应"，并且**按预算逐个唤醒**（受 FM-01 的轮预算约束）。
  2. 接收者上限按**房间实际成员数**收敛，而不是协议层的 32/128。
  3. 一次人类消息最多触发 `min(N, 4)` 个并发 attempt。

### FM-09 【中】撤销私聊权限时"过度取消"

- **事实**：`revokeQueuedPeerDirectWork()`（`:551-576`）对子会话里**所有** `queued` attempt 无差别取消，错误消息统一写成"群内智能体单聊已关闭，尚未开始的投递已撤销。"——**包含与 peer-direct 无关的排队工作**。
- **触发条件**：父群关闭"允许群内智能体互相咨询"时，子会话恰有一个普通的排队任务。
- **怎么在测试里复现**：构造子会话含 1 个 peer-direct 排队 + 1 个普通排队；关闭权限；断言普通任务**未**被取消且其 `error` 不指向 peer 权限。
- **对策**：取消条件必须带**来源过滤**（`delivery`/`attempt` 上的 peer-direct 标记或 `consultation` 关联），错误码区分 `peer_direct_disabled` 与 `cancel_parent_permission_changed`。

---

## 5. ④ 本地单机 + SQLite 的一致性/崩溃（FM-10 ~ FM-13、FM-13b）

### FM-10 【致命】【照搬高代价】"等咨询"没有期限 → 永久卡在 waiting

- **事实（这是本次红队最硬的一条）**：
  - 执行期限只在**开始执行时**武装：`collaboration-chat-service.ts:748`
    ```ts
    execution.deadline = setTimeout(() => this.requestStop(execution, 'timeout'), task.timeoutSeconds * 1000);
    ```
  - 而"排队中等待"的分支**只写 waitReason，不武装任何计时器**（`:710-715`）：
    ```ts
    if (waitReason) { if (attempt.waitReason === waitReason) return false; attempt.waitReason = waitReason; attempt.updatedAt = this.now(); return true; }
    ```
  - `waitReason='peer_reply'` 的产生条件（`:685`）是"我等待的咨询任务尚未终态"——**等待者自身是 `queued`，不是 ACTIVE，不在 `runningInWorkspace()` 的计数里，也不会超时**。
- **触发条件**：A 咨询 B；B 的任务因为 `capacity`（3 个并发槽被占）或 `dependency`（前置于一个永不成功的任务）**永远不进入 `running`**。此时 B 没有 `start()` → 没有期限；A 等 B → 也没有期限。
- **后果**：房间永远停在"等待成员回复"，无倒计时、无告警、无失败原因。用户只能手动取消/重试。《对齐规格》§5 的必测项"失败与等待如实展示"在这条路径上**必然不通过**。
- **怎么在测试里复现**（可写成纯单测）：
  1. 造 3 个长跑 attempt 占满 `min(3, maxConcurrent)`（`:691`）；
  2. 让 A 发起对 B 的咨询，A 据此进入 `peer_reply`；
  3. 让 B 的任务依赖一个永不成功的任务（`dependency`）；
  4. 推进虚拟时钟 >> `taskTimeoutSeconds`；
  5. 断言 A 的状态不是"永久 waiting"，而是**带原因的终态**（如 `failed/peer_timeout`）。
  - **当前必然失败**：A 仍为 `queued + waitReason='peer_reply'`。
- **对策**：
  1. **join deadline**：`awaitingPeerTaskIds` 非空时武装独立计时器（建议默认 **300s**，可配到 `taskTimeoutSeconds`），到期把等待者标为 `failed`，`CollaborationError{code:'peer_timeout', category:'timeout', retryable:true}`，并把失败原因回写请求者（`:704-706` 已有"咨询成员已移除"的同款回写路径，复用即可）。
  2. **等待也要有 SLA 心跳**：`waitReason` 变化时间入档，超过阈值在 UI 与诊断里标红。
  3. **容量饥饿检测**：`waitReason='capacity'` 持续超过 X 分钟 → 提升为可见告警（当前只是排队）。

### FM-11 【高】人不在就卡死，并且白占并发槽

- **事实**：
  - `ACTIVE = {running, waiting_input, stopping}`（`:93`）→ **等待人类输入的 attempt 仍占用并发名额**（`:692` `running.length >= limit` → 其他人只能排队）。
  - 工具审批有失效机制（`inactive-tool-approval.ts`，`reason:'stale-approval'`），但**"人离开多久就自动降级"没有产品策略**。
- **触发条件**：成员向用户提问（`waiting_input`）后用户去开会 2 小时；期间其他成员全部排队。
- **怎么在测试里复现**：让一个 attempt 进入 `waiting_input`，推进时钟到 `taskTimeoutSeconds`，断言其余排队任务是否被无谓阻塞；并断言存在"人类缺席"策略（当前不存在）。
- **对策**：
  1. **人类缺席策略**：N 分钟（建议 900s）无任何人类动作 → 房间进入 `paused`，**释放并发槽**，写系统消息"等待你确认，已暂停以释放资源"。这比"继续占槽两小时"更好，也比"静默失败"更好。
  2. `waiting_input` 的 attempt **不应计入并发上限**，或按半权计。
  3. 暂停必须是**可恢复**的（现有 `TaskRoom.state = pausing|paused` + checkpoint 已经支持，`:36`）。

### FM-12 【高】崩溃/断电后的重复副作用与丢 turn

- **现状（很好，但覆盖不到新路径）**：`recover()` 明确"**never replays an execution that may already have written external state**"（`:633`），把活动 attempt 标 `interrupted` + `owner_lost`（`category:'recovery', retryable:true`）；调度器侧有 `idempotencyKey` + 30s 租约 + provider reservation（`scheduler.ts:76`、`step-executor.ts:60`、`production-step-executor.test.ts:2675` "replays a completed reservation after recovery without a second Provider call"）。
- **缺口**：turn 模型新增的**外部副作用**（群内转交、跨群交接包投递、自动写文件、调用外部 MCP）如果**不走 collaboration 的 `receipts`、也不走 scheduler 的 `idempotencyKey`**，就没有任一层保护。09-30 审计 §7 已把"进程退出后保留诊断并避免盲目重放外部副作用"列为**必须补充的故障回归**。
- **触发条件**：`execute()` 返回前杀进程（模拟断电）；或同一 `clientRequestId` 在重连后重放。
- **怎么在测试里复现**：
  1. 在 `ports.execute` 内做副作用 → 副作用后立刻抛错/杀进程 → 重启 → 断言副作用执行次数 ≤ 1；
  2. 同一 `clientRequestId` 重复 `send` → 断言只有一条消息、一个 attempt（`duplicate()` 已能保证，需补 turn 路径）。
  3. 现有参考：`collaboration-chat-service.test.ts:218`（"marks active attempts as interrupted during startup recovery"）、`task-room-durability.test.ts:14`（关库重开）。
- **对策**：**统一副作用幂等键**：所有 turn 产生的外部副作用必须携带 `idempotencyKey = hash(conversationId, correlationId, causationId, round)`，且执行器必须"先记录意图、后执行、再确认"；不允许"没有键的副作用"。

### FM-13 【高】三套执行生命周期并存 → 没有唯一真相

- **事实**：
  - `collaboration-*`：`CollaborationAttemptStatus = queued|running|waiting_input|stopping|succeeded|failed|cancelled|interrupted`（`packages/shared/.../collaboration-chat.ts:106-108`）；
  - `orchestration/*`：`RunState = pending|ready|running|paused|awaitingToolApproval|completed|failed|cancelled`，Step 另有 `awaitingApproval`（`scheduler.ts:351-356`、`:672-674`），租约 30s、心跳 1/3 租期（`:259-261`）；
  - `delegation-*`：`childRun` + `delegationTerminationReason = timed_out|budget_exceeded`（`demo-run.ts:94`）。
- **触发条件**：任何一次"改造后"的协作同时经过两条以上路径（例如：turn 触发 → 委派子代理 → 调度器执行）。这是改造后的**常态**，不是边界。
- **后果**：《对齐规格》要求"投递状态可见、等待原因可见"；三套状态机下，"唯一真相"需要靠人脑对齐三张状态表，UI 必然至少有一处说谎。
- **怎么在测试里复现**：同一工作分别走三条路径，断言 UI/查询接口返回的"正在运行数量"与"最终状态"三者一致。当前必然不一致。
- **对策**：
  1. **一个工作一个状态机**（《对齐规格》§5.1 的 WorkItem/Attempt 已经是正确方向）：其余两层降级为**执行器细节**，对上层只暴露 `CollaborationAttemptStatus`。
  2. 任何新增状态必须先在 `packages/shared` 定义映射表，**禁止在 runtime 里新增平行枚举**。
  3. 加一条"状态一致性"测试：对同一 work item，三条路径的投影必须给出同一个 `(status, waitReason)`。

### FM-13b 【高】`stopping` 卡住 `room-resume`：房间无法恢复

- **事实（我已逐行复核）**：
  - `room-pause` 会把所有 ACTIVE attempt 置为 `stopping`（`collaboration-chat-service.ts:335`），并把房间置为 `pausing`/`paused`（`:332`）；
  - `room-resume` 的第一道守卫是（`:339`）：
    ```ts
    if (active.length || room.state === 'pausing') throw new Error('task_room.still_stopping');
    ```
    而 `ACTIVE = {running, waiting_input, stopping}`（`:93`）——**`stopping` 也算"还在跑"**；
  - `stopping` 唯一变成终态的路径是执行器返回（`finishExecution`）；`requestStop` 只会把它再标一次 `stopping`（`:833`）。**没有任何 `stopping` 超时**。
- **触发条件**：执行器忽略 `AbortSignal`（外部内核/未知 MCP 都可能），或进程在停止过程中被挂起 → 该 attempt 永久停在 `stopping` → 房间**永远无法 resume**，用户点了"继续"只会收到 `task_room.still_stopping`。
- **对照（说明这不是"做不到"，而是"这一层没做"）**：同一仓库的调度器引擎**已经**处理了这个场景——`apps/runtime/src/orchestration/scheduler.test.ts:1704` 有用例 "fails and cleans up when a lost lease executor ignores AbortSignal forever"。**collaboration 层缺的正是这套兜底**，这本身就是 FM-13（两套引擎能力不对等）的一个实例。
- **怎么在测试里复现**：注入一个"收到 abort 后永不 resolve"的 `ports.execute` 桩 → 发 `room-pause` → 断言 attempt 进入 `stopping` → 发 `room-resume` → 推进时钟到 `taskTimeoutSeconds × N` → 断言房间能恢复（或至少出现带原因的终态）。
  - **当前必然失败**：`room-resume` 持续抛 `task_room.still_stopping`。
- **对策**：
  1. 给 `stopping` 加**独立的强制终止期限**（建议 60s）：到期把 attempt 标为 `interrupted`（`category:'recovery'`，`retryable:true`），释放 ACTIVE 名额，允许 resume——与调度器已有语义对齐。
  2. `room-resume` 的守卫改为"没有 `running`/`waiting_input`"，`stopping` 不再阻塞恢复（它只是收尾）。
  3. 停止流程必须**有界**：`requestStop` 之后启动看门狗，并把"未能在期限内停止"作为可观测事件上报（接 FM-16 的诊断包）。

---

## 6. ⑤ 可观测性缺失的代价（FM-14 ~ FM-16）

### FM-14 【高】假成功与静默丢消息

- **已有**：`CollaborationDelivery.status`、`CollaborationError{code, category, retryable, traceId}`、`observation:'normal'|'status_unconfirmed'|'notification_delayed'`、`correlationId/causationId`。
- **缺口**：**有字段，没有对账**。"投递=processed"与"确实产生了一条消息/一个产物"之间没有断言；"通知延迟"没有 SLO；`statusTimeoutSeconds=120` 只做一次状态探测（`:855` `delay = statusTimeoutSeconds * 1000`），探测失败之后没有升级路径。
- **更糟的一条（我已独立复核）**：**状态探测在生产装配里根本没有接线**——`apps/runtime/src/persistence.ts` 全文 **0 处** `probeStatus`，而服务端只在 `if (this.ports.probeStatus)`（`collaboration-chat-service.ts:873`）内才会走到 `observation = 'status_unconfirmed'`（`:870`）与观察结果回写（`:888`）。
  → 因此 `observation` 在运行时**恒为 `'normal'`**（执行开始时写死，`:622`/`:724`），"状态待确认"这条路径是**死代码**。
  → **这比"没有升级路径"更严重：用户永远看不到"待确认"，系统永远自称正常。** 这与 01 号文档的 D2 结论一致（其表述为"被钉死在 `status_unconfirmed`"，方向相反但指向同一处死代码——按我这次复核，实际是恒为 `normal`）。
- **触发条件**：provider 静默失败、进程在 `finishExecution` 前被杀、投递成功但 attempt 未创建。
- **怎么在测试里复现**：注入"投递成功但执行器不返回"的桩，推进时钟，断言系统产生**可见的失败**而不是"永远处理中"。
- **对策（最小可观测性契约，见 §9）**：每条链路必须能回答四个问题——**(a) 谁发的、(b) 发给了谁、(c) 现在到哪一步、(d) 若失败为什么**——并且有**对账任务**定期检查"processed 的 delivery 是否都有对应的 attempt 与产出"。

### FM-15 【中】设置保存静默失败（历史问题，改造的放大器）

- **事实**（09-30 审计 §3 P2）：`SettingsPage` 先改本地 state，再 fire-and-forget `setSetting`，读取错误被吞。
- **触发条件**：任何一次设置写入遇到 IPC/磁盘/校验失败；或用户在设置未生效时立刻按"已开启"的预期去建群。
- **为什么在改造中更危险**：《对齐规格》§4.6 要把十来个开关**收敛**成三组；收敛过程中**用户的旧值必须保留**（"现有禁止状态不悄悄变为允许"）。如果保存仍然静默失败，用户会看到"已开启/已收紧"的新界面，而数据库里是旧值——**权限与预算双双失真**。
- **怎么在测试里复现**：让 `setSetting` 失败，断言 UI 显示失败且回滚，而不是显示"已保存"。
- **对策**：服务端修订号 + 保存状态机（saving/saved/failed）+ 失败回滚；**任何策略读取都必须返回"有效值 + 来源"**（09-30 审计 P1 已提出 `resolveEffectiveCollaborationPolicy(scope)`，直接采用）。

### FM-16 【中】出事无法复盘：诊断不可导出

- **触发条件**：用户报"它说通知了但对方没反应"。
- **现状**：`correlationId/causationId` 在数据里，但**没有一键导出**；日志与 SQLite 分散。
- **怎么在测试里复现**：跑一条完整的"用户消息 → 投递 → attempt → 产物"链路，然后**只凭导出包**回答 §10 的 8 个问题；任何一个答不出来即失败。当前没有任何导出入口 → **红**。
- **对策**：提供"导出本轮诊断包"：按 `correlationId` 收集 `message → delivery → attempt → provider 请求摘要 → artifact`，脱敏后输出单个 JSON；并在 `status_unconfirmed` 时自动提示导出。

---

## 7. ⑥ 迁移风险（FM-17 ~ FM-18）

### FM-17 【高】【照搬高代价】迁移静默放宽权限

- **事实（三处叠加）**：
  1. `updatePolicy` 的旧值继承：`allowGroupMessages: draft.conversation.policy.allowGroupMessages ?? draft.conversation.policy.allowPeerDirect`（`collaboration-chat-service.ts:537`）→ 老群若只有 `allowPeerDirect`，会**把私聊权限当作群内通信权限**继承；
  2. 新群默认 `allowGroupMessages: true`、`allowPeerDirect: false`（`DEFAULT_COLLABORATION_CHAT_POLICY`，`packages/shared/.../collaboration-chat.ts:32-35`）→ **群内 bot 互相咨询默认开启**；
  3. 设置层默认却是 `allowAgentPeerMessaging: false`（`packages/protocol/src/collaboration.ts:30`）。
  → **三处默认值互不相同**，迁移时"用户以为关着的"与"实际开着的"必然错位。
- **触发条件**：升级后打开任一老群。
- **怎么在测试里复现**：造一个只有 `allowPeerDirect:false` 的老群记录 → 迁移 → 断言群内对等通信**仍然关闭**（当前会因 `?? allowPeerDirect` 得到 `false`，看似安全；但若老群是 `allowPeerDirect:true`，就会得到 `true`——**私聊权限被翻译成群内广播权限**，这是真实越权）。
- **对策**：
  1. 迁移必须**显式**：`allowGroupMessages` 缺失时取 `false`，并写一条"权限待确认"提示让用户逐群确认（不是静默继承）。
  2. 出一张"旧值 → 新值"对照表（含 `depth=0`、`null` 预算、peer 关闭），并在 CI 里断言"迁移不会把任何 false 变 true"。
  3. 用 `COLLABORATION_EXECUTION_VERSION`（当前 6）路由老房间，**不热转换在途工作**。

### FM-18 【高】用户肌肉记忆与回滚

- **事实**：现有入口与动词已被用户使用：讨论/咨询/分配小工作、任务书、"开始团队工作"、群成员面板的三个开关（`docs/testing/grok-peer-collaboration-acceptance.md` 全篇）。改造若改成 turn 模型并换词（"轮次/派发/交接包"），用户会找不到原来的动作。
- **触发条件**：任何一次 UI 文案或入口重排。
- **怎么在测试里复现**：拿 `docs/testing/grok-peer-collaboration-acceptance.md` 的 5 个手工场景当**回归脚本**——改造后原样再走一遍，任何一步"找不到入口"或"需要看文档才会用"即失败；再加一条自动断言：`executionVersion` 为旧值的历史房间在新版本下仍能完成"讨论 → 咨询 → 交付"闭环。当前无此断言 → **红**。
- **对策**：
  1. 旧入口保留**至少一个版本**的别名与相同落点；
  2. `executionVersion` 双向兼容：老房间按老策略跑，新轮次按新路由；
  3. **回滚开关**：一个 `collaboration.orchestration.model = 'dag' | 'turn'` 的全局开关，能在不迁移数据的前提下回退（09-30 审计 §7 阶段 B 已要求"保留只读历史兼容和回滚开关"）；
  4. 回滚前必须能回答"在途的 turn 会怎样"——原地降级为一次普通 attempt 并标记 `interrupted`，绝不重放。

---

## 8. ⑦ 反向结论：**哪些 Grok Bot 做法我们不应该照搬**

| # | Grok Bot 的做法 | 为什么不能照搬 | 我们应该怎么做 |
|---|---|---|---|
| 1 | **服务端权威编排**：turn 派发全在服务端（`RequestGrokBotRoomMemberTurn` 在客户端 0 调用点，见 `docs/research/grok-bot/01` §5.1） | 我们是本地单机 + SQLite，本地就是权威。把编排放到远端 = 引入不可观测的网络依赖、无法离线、无法 5 秒内解释"为什么没人回" | 编排留在本地进程内；所有状态落 SQLite；网络只用于模型调用 |
| 2 | **无回放加人**：新成员看不到入群前历史（06 §4 落差 4；群历史对它是"加入之后才开始"） | 我们的核心场景是长篇小说创作，新成员必须知道既有设定 | 加入时给"目标 + 成员职责 + 决定摘要 + 产物索引"（《对齐规格》§4.5），并记录实际读过的范围 |
| 3 | **bot 自主改名/自我修改**：`UpdateAgent` 工具 + `agent-rename/refused` 拒绝码（`docs/research/grok-bot/03` §3.3） | 模型自改身份会让审计失效、让用户失去对"谁在干活"的掌控；Grok Bot 自己都要服务端拦一道 | 保持 ADR 0001/0003：定义归用户，逐次审批；工作成员不扩大权限 |
| 4 | **跨 1:1 与所有群共享一份 history**：员工原话"each bot has one conversation and one memory … spans both its 1:1 chat with you and every group"（06 §5.2） | 我们已确认这会串味（同一员工也承认"两个长期项目放在同一个 bot 上必然串味"）；数据侧 Grok Bot 的群消息并不真进成员落盘 transcript（`docs/research/grok-bot/07` §2.5）——**照搬一个连它自己都没真做到的说法最亏** | Room 隔离 + 跨群只走显式交接包，禁止继承另一群全量历史与写入范围 |
| 5 | **Temporal 工作流做编排**：`Dispatch.NOT_TEMPORAL`、`workflow_id`（`docs/research/grok-bot/01` §3.2） | 本地单进程 + SQLite 引入工作流引擎是净负担；我们已有 run/step/lease 调度器 | 复用现有 `orchestration/*`，不新增引擎（09-30 审计已明确"不再另建平行的 WorkflowInstance 引擎"） |
| 6 | **按周配额限流** | 本地没有配额，唯一后果是账单（FM-01）。照搬"等配额耗尽再说"等于**没有熔断** | 自己实现 token/成本预算与硬停；默认有界 |
| 7 | **全员广播式唤醒（每条消息每个成员各跑一轮）** | 成本 O(N)（FM-02），群越大越慢越贵；且只有 Temporal 成员能收 turn（`NOT_TEMPORAL`），我们更没理由全员跑 | 默认单负责人；无 @ 只投协调员；fan-out 显式 opt-in + 预算 |
| 8 | **多 bot 群聊作为协作主路径** | 反讽但关键：Grok Bot 员工自己的实操建议是"**run work in one Command Agent with subagents**"、"prefer fewer bots (one bot + subagents)"，而 `subagents` 在 21 个官方文档页面里**从未出现**（06 §4 落差 1） | 保留群聊用于**可见交接与决策**，但把"并行产出"交给子代理/固定流水线；不要为了"像 Grok Bot"而把多 bot 群聊设成默认工作方式 |

---

## 9. 熔断阈值建议（可直接落成配置 + 断言）

**前置要求**：这些阈值**必须只有一处定义**。当前同一组策略有**三个互相矛盾的来源**（见下方"必须先修的裂缝"），在此之上叠加新阈值只会制造更多谎言。

| 闸门 | 建议值 | 依据 | 触发后行为 |
|---|---|---|---|
| 每 correlation 自动消息 | 12（保留） | 现有 `maxAutoMessages` | 抛出/记 `loop_limit` |
| **每房间 60 分钟自动消息（新增）** | 30 | FM-07：防"用户插话重置" | 静默到窗口结束，UI 显式提示 |
| 同 pair 往返 | **3**（新增） | FM-06 礼貌循环 | 强制静默，记 `suppressed:no_new_information` |
| hop | 6（保留，协议上限从 20 收敛到 6） | 现状硬编码 6 | `collaboration.loop_limit` |
| 每用户轮模型调用 | `min(N, 4)`（新增） | FM-02/FM-08 | 超出的成员转入下一轮或排队 |
| 每轮 token | 200k（新增） | 对照 Grok Bot 实测 200–250k/回复 | 硬停本轮，房间 `paused` + 系统消息 |
| 每房间每日 token | 2M（新增，可配） | FM-01 | 硬停，要求用户显式续期 |
| 单任务 token 预算 | 200k（默认非 null） | `taskTokenBudget` 现为 `null` | `budget_exceeded` 专用结果类型（不是 failed） |
| **等咨询 join deadline（新增）** | 300s | FM-10：等待者当前**无任何 timer** | `failed/peer_timeout` + 回写请求者 |
| 人类缺席 | 900s 无人类动作 → 暂停 | FM-11 | 房间 `paused`、释放并发槽、系统消息 |
| 连续无进展轮次 | 3 轮无新产物/决策/工具结果 → 收尾 | 对照后台子任务 1800s no-progress（`chat-tools.ts:540`） | 静默收尾 + 请求用户确认 |
| 并发执行 | `min(3, maxConcurrent)`（保留） | `:691` | `waitReason='capacity'` |
| 容量饥饿告警 | 排队 > 300s | FM-10 副产物 | 升级为可见告警 |
| 成本熔断 | 单房间单日 $5（按用户配置单价换算） | FM-01 | 硬停并要求确认 |

**必须先修的三处"阈值裂缝"**（否则上表无处安放）：

| 位置 | 值 | 问题 |
|---|---|---|
| `packages/protocol/src/collaboration-chat.ts:15-16` | `maxConcurrent [1,16]`、`maxMessageHops [1,20]`、`maxAutoMessages [1,100]`、`taskTimeoutSeconds [60,7200]`、`statusTimeoutSeconds [15,900]` | IPC 边界允许的值 |
| `apps/runtime/src/collaboration-chat-service.ts:1101-1108`（`validatePolicy`） | `[1,3]`、`[1,6]`、`[1,12]`、`[1,86400]`、`[1,3600]` | 运行时的值，与上面**三处完全不同** |
| `apps/runtime/src/collaboration-chat-service.ts:688` | `Math.min(3, policy.maxConcurrent)` | 第三处硬编码 3，使协议允许的 16 完全无效 |

后果：客户端按协议校验通过 `maxConcurrent=16` 或 `taskTimeoutSeconds=1`，运行时要么抛 `collaboration.invalid_policy`、要么静默按 3 执行；`packages/protocol/src/collaboration-chat.test.ts` 的 8 个用例**没有任何一条**覆盖这些数值边界。**改造的第一步应该是把这三处收敛为一份共享常量 + 一组边界一致性测试**，否则"设置收敛"只会把三个来源变成四个。

---

## 10. 最小可观测性契约（事故时必须能回答的问题）

对**每一条**消息/回合，必须能一次性回答：

| 问题 | 必填字段（已存在则标注） | 现状缺口 |
|---|---|---|
| 谁发的？ | `senderMemberId` + 运行时绑定的身份（禁止模型自填） | 已有 |
| 发给谁？ | `recipientMemberIds` + 展开来源（@ / 继承 / 默认负责人） | 展开来源未记录 |
| 现在到哪一步？ | `delivery.status` → `attempt.status` + `attempt.waitReason` | 三段状态未串成一条链 |
| 等了多久？ | `waitReasonSince` / `heartbeatAt` | **缺失**：只有 `updatedAt` |
| 为什么失败？ | `CollaborationError{code, category, retryable, traceId}` | 已有 |
| 花了多少？ | `usage{tokensIn, tokensOut, costUsd}` per attempt | **缺失**（无法回答"钱花在哪"） |
| 产出在哪？ | `artifact{id, sha256, bytes}` + 是否有产物才算成功 | 已有产物合同 |
| 能复盘吗？ | 按 `correlationId` 一键导出 | **缺失** |

四项**新增**最小要求：`waitReasonSince`、`usage` 账本、`recipientReason`、`correlationId` 导出。

---

## 11. 复现清单（每条失败模式一个红灯用例）

```powershell
# 现有基座（模拟提供方，不烧付费模型）
pnpm --filter @sync-think/runtime exec vitest run collaboration task-room --testTimeout=20000
pnpm --filter @sync-think/protocol exec vitest run src/collaboration-chat.test.ts

# 成本模型（本文所有 N×M 数字的来源，可改参数复算）
node .tmp-grok-bot/verify/ov5-cost-model.mjs
$env:TOK_PER_CHAR=0.5; $env:PRICE_IN=1; node .tmp-grok-bot/verify/ov5-cost-model.mjs
```

建议新增（顺序即修复优先级）：

| 用例 | 断言 | 对应当前行为 |
|---|---|---|
| `turn-cost.spec` | 每用户轮模型调用 ≤ `min(N,4)` | 上界 48 → **红** |
| `turn-cost.spec` | 每轮 token ≤ 200k 且超限后房间 `paused` | 无此断言 → **红** |
| `peer-join-deadline.spec` | A 等 B 超过 300s → `failed/peer_timeout` | 永远 waiting → **红** |
| `reply-storm.spec` | 非任务群 A↔B 自动消息 ≤ 2 | 上界 12 → **红** |
| `budget-reset.spec` | 连发 20 条用户消息后自动消息 ≤ 30 | 上界 240 → **红** |
| `policy-bounds.spec` | protocol 与 runtime 的策略边界常量相等 | 3 处不一致 → **红** |
| `projection-parity.spec` | `manifest.messageIds + historyOmitted == 房间消息数` | 无此断言 → **红** |
| `migration-no-widening.spec` | 迁移不把任何 `false` 变 `true` | `?? allowPeerDirect` 可越权 → **红** |
| `crash-idempotency.spec` | 副作用执行次数 ≤ 1（含 turn 路径） | 仅覆盖旧路径 → **红** |
| `human-absent.spec` | 900s 无人类动作 → `paused` 且释放并发槽 | 无策略 → **红** |
| `revoke-scope.spec` | 关闭 peer direct 只取消 peer 相关排队 | 无差别取消 → **红** |
| `lifecycle-truth.spec` | 三条路径对同一 work item 给出同一 `(status, waitReason)` | 三套状态机 → **红** |

**验收口径**：上面 12 条**全部先红再绿**，才允许把 turn 模型设为默认。任何一条长期为红，都应该把对应能力保持关闭——这正是当前 `dynamicSubagentsEnabled:false` / `allowAgentTaskDispatch:false` / `allowAgentPeerMessaging:false` 三个默认值存在的意义。

---

## 12. 一句话给决策者

**Grok Bot 的协作架构是"用配额和账单换来的协作感"：它靠周配额自限、靠员工口头劝告（"prefer fewer bots"）纠偏、靠 `subagents` 这个从未写进官方文档的后门兜底。** 我们本地没有配额这道墙，却有同样的 fan-out 成本结构；照搬它的编排、分组和"一份历史"，等于**只继承了成本，丢掉了刹车**。要照搬的是它的**协议形状**（增量 `new_messages`、显式 `PASS`、因果链、幂等 nonce、投递状态），不是它的**编排权威与默认值**。

---

## 附：与 01~04 的交叉引用与合并提醒

写这份红队报告期间，`01-current-architecture-critique.md`、`02-context-memory-gap.md`、`03-scheduling-turn-redesign.md`、`04-membership-evolution-gap.md` 也落盘了。**我们独立地撞到了同样的几处硬伤**——这是相互印证，不是重复：

| 同一处硬伤 | 本文条目 | 其他文档的独立发现 |
|---|---|---|
| 策略边界三处不一致（`[1,16]/[1,20]/[1,100]` vs `[1,3]/[1,6]/[1,12]` vs `Math.min(3,…)`） | §9「必须先修的三处阈值裂缝」 | 03 的策略三列表；01 的"`maxConcurrent` 这个设置项对用户是**假的**" |
| `revokeQueuedPeerDirectWork` 无差别取消 | FM-09 | 01（"不区分是否与 peer-direct 有关"） |
| 状态探测在生产未接线 → 假成功 | FM-14 | 01 §D2（D2 记为恒 `status_unconfirmed`；**我复核后认为实际恒为 `normal`**，见 FM-14） |
| `stopping` 阻塞 `room-resume` | FM-13b | 01 §D6（记为"死锁面"） |

**给合并者的两点提醒：**

1. **行号基准不同。** `collaboration-chat-service.ts` 在 11:12 被并发修改过，本文所有行号已重锚到 **11:15 的修订**（SHA-256 见文首），而 `01` 中的行号（如 `:1036` `:687` `:1099` `:1062` `:630-656`）仍指向修改前的修订，整体差约 3 行。**合并时必须统一基准**，否则两份文档会互相"证伪"。
2. **本文的 19 条是"必须先有红灯测试"的清单**（§11），不是"改造完成后再看"的检查表。其中 FM-01/02/04/10 是**可以在实现前就用现有代码复现的**（成本模型、等待无期限、全量重发），建议在评审设计稿之前先跑一遍。
