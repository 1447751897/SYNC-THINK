# Grok Bot 机制总报告：通信、群聊协同、上下文、记忆、自进化、动态加人

> 调研方式：**逆向本机安装的桌面客户端 + 读取本机真实账户数据 + 抓取官方文档**（三源交叉）
> 被测版本：**Grok Bot 0.63.0**（内部代号 `sand`，作者 SpaceXAI，Electron；`app.asar` 35.8 MB，构建于 2026-09-29）
> 数据快照：2026-10-01 09:55:35 (+08:00)，本机真实账户 `google-oauth2|user_01M09YMBRJX2XZFDBW1983GX9Z`
> 证据分级：`【代码】` 解包产物直接命中 ｜ `【数据】` 本机真实账户记录 ｜ `【文档】` 官方/公开来源 ｜ `【推断】` ｜ `【未证实】`
> 本报告由 6 个工作流 + 1 个独立红队验证合并而成，明细见「证据索引」；红队推翻了 3 条结论，均已按最终判定写入本文。

---

## 0. 一句话结论

**Grok Bot 不是"多个 agent 互相聊天"，而是"一台共享电脑 + 每个 bot 一份私有上下文 + 服务端权威的轮次编排"。**

三句话记住它：

1. **共享的是电脑，不是大脑。** 所有 bot 在同一台持久云主机（`/home/box`）上按 agent UUID 分目录，共享文件系统、浏览器、登录态；但对话、记忆、技能、插件**全部 per-agent**。
2. **群聊是"群本身变成了一个 agent 实体"**（`GrokBotAgentKind.ROOM`），服务端逐成员派发 turn，成员可以用协议级的 `PASS` 拒绝发言——**防抢话靠 PASS，不靠互斥锁**。
3. **"自进化"是人类的资产化 + bot 落库复用，不是模型自我改写。** 0.63.0 唯一新增的自动环节是 bot 拿到 `update_state` 工具，能把外部资产写回自己的 skill/memory/routine；它改的是**内容**，不是**能力边界**。

---

## 1. 关键版本事实（先说清版本，否则会误读旧文档）

| 项 | v0.47.0（仓库旧文档） | **v0.63.0（本报告实测）** |
|---|---|---|
| proto 规模 | "5677+ 类型" | **2048 消息类型 / 71 枚举 / `aiserver.v1.GrokBotService` 249 个 RPC**（244 Unary + 5 Streaming）；`proto.cjs` 实测 1,082,950 字节 |
| 会话种类 | MAIN/DM/SLACK_DM/SLACK_THREAD（无 ROOM/GROUP） | `GrokBotAgentSessionKind` = MAIN=1｜SLACK_DM=2｜SLACK_THREAD=3｜**DM=4**｜**GROUP=5**（编号重排 + 新增 GROUP） |
| 触发规则 | "成员四种触发规则 mention/keyword/message/reaction" | **过度归因**：该联合是 Slack/GitHub/Origin/Teams **集成频道的 match 规则**，不是群成员参与规则 |
| `harnessMayCollect` | "群成员可收集上下文的开关" | **实为语音通话隐私开关**（`!getCursorPrivacyModeEnabled()`） |
| 记忆 RPC | `PutGrokBotMemoryShard` / `ListGrokBotMemoryShards` | **0.63.0 中不存在**；记忆单元是 `GrokBotMemoryFact`，只有 List / Promote 两个 RPC |
| 本地副本 | 4 份 transcript，绿毛仔 46 条 | **7 份 transcript / 174 条**；绿毛仔 **61 条**（seq 1..77，16 个空洞） |
| turn 编排 | "客户端无调用点" | **仍然无调用点**（27 次全在 schema 与服务方法表）✔️ 结论成立 |
| 其它新增 | — | `NOT_TEMPORAL=3`、`CancelGrokBotRoomMemberTurn`、`root_parent_request_id`、`ReplyTarget{…,quote}`、`GrokBotTeamAgent*` 族、`GrokBotHarnessMigration*` 族、`AddGrokBotRoomPeople`（人类成员）、`PromoteGrokBotMemoriesToTeam` |

> ⚠️ 数据是活的：观测期内 09:50→09:55 条目从 166 涨到 174，本机 6 个 replica 的 mtime 集中在应用启动后 5 秒内被重写。所有【数据】数字都绑定快照时刻。

---

## 2. bot 之间怎么通信

### 2.1 两条通道

| 通道 | 协议 | 语义 |
|---|---|---|
| **点对点私信** | `SendGrokBotAgentMessage{from_agent_id, to_agent_id, message_id, text, sent_at_ms}` → `{delivery, target_agent_id, target_name, workflow_id?}` | bot 之间直接发消息，**独立于群聊** |
| **群聊 turn** | `RequestGrokBotRoomMemberTurn` / `Cancel…` / `Deliver…Result` | 服务端逐成员派发轮次，成员上报 `SENT/PASS/…` |

### 2.2 消息怎么进入对方上下文：**投递**，不是共享

同一句话在收发两侧的角色不同（v0.47 实证、v0.63 复核成立）：

```
发送方 bot 的 transcript：  role=assistant   toAgent=对方
接收方 bot 的 transcript：  role=user        fromAgent=对方     ← 逐字一致
```

→ 跨 bot 交流是**显式、窄带、可审计的搬运**：发什么由发送方决定（真实记录里 bot 只打包"要点 + 仓库路径 + 截图 + 约束"，不扔整段闲聊）。人类在环天然成立：群里人类消息对所有成员都是 `role=user`。

### 2.3 谁在编排：服务端（Temporal），客户端只做展示

- 三个 turn RPC 名在 513→567 个客户端产物里共 27 次命中，**全部**落在 protobuf 类型定义与服务方法表，**真实调用点 = 0**。
- 客户端真正实现的是**消费侧**：`WatchGrokBotTranscripts`（ServerTranscriptTail）+ 逐成员 live 投影 `groupTurns[{roomId,isComposingMessage,currentActivity}]`，相位 `reading | working | typing`，以及 `activeGroupMemberId`。
- 因此：**编排在服务端（Temporal 工作流），执行在 host/box，桌面端只做投影与渲染。**
- 旁证：`GrokBotRuntimeCapabilities{durable_identity_enabled, durable_identity_writes_enabled, temporal_creation_enabled, agent_messaging_enabled, server_rooms_enabled}` —— 群房间与 agent 间消息都是**可开关的服务端能力**。

---

## 3. 群聊里怎么协同（谁发言、怎么不吵）

### 3.1 数据模型：群 = `GrokBotAgentKind.ROOM` 的 agent

```
GrokBotAgentKind = UNSPECIFIED | AGENT=1 | ROOM=2
GrokBotAgentHarnessKind = UNSPECIFIED | BOX=1 | TEMPORAL=2
```

群没有独立的"聊天室"概念，它复用 agent 的一切（id、transcript、成员表、未读、路径）。成员关系是**双向**的：`GrokBotAgentDefinition.room_members[]`（我的成员）与 `member_of_rooms[]`（我在哪些群）——所以 bot 真能回答"我在哪个组里"。

### 3.2 一轮群聊的协议全貌

```
服务端 → 成员   RequestGrokBotRoomMemberTurnRequest
                  nonce（幂等令牌）
                  room {id, name, description}        ← 房间级 briefing，每轮都下发
                  member_agent_id（这轮派给谁）
                  peers[] {id, name, description}     ← 同僚名单，让成员知道谁负责什么
                  new_messages[]                      ← 增量消息，不是全量历史
                  deadline_ms / is_winding_down
                  parent_request_id / root_parent_request_id（链路追踪）
成员 → 服务端   DeliverGrokBotRoomMemberTurnResultRequest{outcome, messages[], error}
服务端回执       TurnResultIntake = ACCEPTED=1 | UNKNOWN_NONCE=2 | HOST_UNAVAILABLE=3
```

投递给成员的消息是**逐成员投影**的（既非共享对象，也非同一条记录）：

```
GrokBotRoomMemberTurnMessage
  1 speaker_kind : HUMAN=1 | AGENT=2
  2 speaker_name
  3 is_self      ← 同一条群消息，对发言者是 true，对别人是 false
  4 text
  5 reply_to : ReplyTarget{speaker_kind, speaker_name, is_self, quote}
```

`Quote` 是**内容快照**、没有 `message_id` —— 因为底层根本不存在一份共享消息表。

### 3.3 不吵的三道闸

| 机制 | 枚举 | 作用 |
|---|---|---|
| 成员主动沉默 | `TurnOutcome = SENT=1｜PASS=2｜SKIPPED=3｜TIMEOUT=4｜CANCELLED=5｜ERROR=6` | `PASS` 是正式的"这轮我不说" |
| 派发去重 | `TurnDispatch = ACCEPTED=1｜DUPLICATE=2｜NOT_TEMPORAL=3｜TARGET_NOT_FOUND=4｜TEMPORAL_UNAVAILABLE=5` | `nonce` 幂等；**新增 `NOT_TEMPORAL`：房间轮次只发给 temporal 成员，box 成员收不到** |
| 回执与取消 | `TurnResultIntake`、`CancelGrokBotRoomMemberTurn` | host 不在 → `HOST_UNAVAILABLE`；在途轮次可取消 |

结论：**防抢话靠协议级 PASS + 服务端派发，而不是互斥锁**；成员在群里的发言**并行可证**（live 相位投影），但实测相邻发言间隔 15–33 秒，后发言者能看到同轮先发言者的内容【数据+推断】。

---

## 4. 上下文怎么处理

### 4.1 最反直觉的一条：**桌面端不拼 prompt**

`@anysphere/context`、`context-rpc`、`agent-summarization` 这些依赖在 511 个桌面产物里 **0 命中** —— 它们是**服务端依赖**。桌面端只提供：本地上下文通道（工具执行、附件字节、transcript 副本、box 目录布局）+ 一次性注入（`UserContextInjection` / `SystemContextInjection`）。真正的组装（系统提示 + 记忆 + 技能 + 工具/MCP + 压缩后的历史）发生在服务端 agent runtime，通过 `ConversationMessage` / `RequestContext` 对接。

组装顺序（9 层，详见 02 文档）+ 用户消息侧字段：`UserMessage{text, message_id, rich_text, selected_context, mode, sent_by_agent_id, hook_additional_contexts[]}`；渲染端区分 `visibleText`（给人看）与 `modelText`（给模型）——**两者可以不同**。

### 4.2 压缩：客户端侧证据不足，**不要照抄旧结论**

- `chunk-compact-*.js` **不是 `/compact` 功能**，是 **emojibase 表情数据表**（5225 条，`compact` 关键字 0 命中）。
- `PreCompact` hook 确实存在（输入含 `context_usage_percent` / `context_tokens` / `context_window_size` / `messages_to_compact`），但**只在 `local-exec-daemon` 出现，`main-app` 0 命中**，且同表事件是 `beforeShellExecution` / `afterFileEdit` 这类 **IDE/CLI agent hook** → **归属无法判定**（红队把 02 的"真正的压缩机制"降级为过度归因）。
- `context-folder-*.webp` 是**孤立资源**（0 引用、无 proto、无 i18n 文案）→ **不能**推断存在"挂载上下文目录"功能。
- 【文档】官方口径 "context compounds over time"；Cursor 员工在自家论坛承认"**每轮把完整 transcript 重发给模型**"，且称这 "isn't intended behavior"，用户实测 200–250k tokens/回复，无 compact、无同 bot 新会话。

### 4.3 隔离边界（v0.63.0 复核结论）

- 隔离成立：per-agent transcript、per-agent box 目录、per-agent memory 定义、per-agent 插件作用域（`GrokBotPluginScope{agent_id, session_kind}`）。
- **关键复核（红队仲裁 E13）**：官方员工称"每个 bot 只有一份 conversation/memory，横跨 1:1 与它加入的每个群"。独立判定为**"层次不同"，不矛盾**：跨成员的群文本 43 条 × 6 副本 = **0 命中**（别人的话不会进你的工作记录），但成员副本本身是**单条 seq 序列**，且包含**自己发往群**的条目（`toAgent{kind:"group"}`，如 `d4c37f88` 的 seq37）→ 数据**部分支持**"一份历史"的说法（"Group turns are tagged internally" 有逐字对应物）。
- **`GROUP=5` 目前没有客户端消费者**：唯一映射器 `main-app` `Qqt()` 没有 GROUP 分支（`default: return null`）→ **没有代码把房间消息写进 GROUP session**。
- → 因此旧文档"群聊发言不写入发言者 transcript"必须**降级**为：*只有「其他成员的群消息 + 房间内人类消息」不写入*；**自己发往群的会留在自己的序列里**。

---

## 5. 记忆是什么

### 5.1 记忆单元：`GrokBotMemoryFact`

```
GrokBotMemoryFact { 1 fact_id : string | 2 text : string | 3 learned_at_ms : int64 }
ListGrokBotUserBotMemories{agent_id} → memories: GrokBotMemoryFact[]
PromoteGrokBotMemoriesToTeam{agent_id, fact_ids[]} → {created[], already_in_team[], kept_private_count}
```

用户面板里看到的就是**扁平的 "文本 + 学习日期" 列表**（`main-app` 的 mapper 直传三字段；面板 intro 文案 `"Memories just between you and {botName}"`）——**不含 scope / profile / 来源 agent**。

### 5.2 分层结构（0.63.0 新增 logs 层）

```
GrokBotAgentDefinitionMemoryShard {scope, scope_key, version, box_backfilled, updated_at_ms, folder}
GrokBotMemoryFolder {profile, logs[]}          ← v0.63 新增 logs 层
```

- bot 写入记忆的通道是 `update_state`，带 `tier:"log"` → 落进 `folder.logs[]`。
- `scope` / `scope_key` 的**取值仍属未证实**：全库无枚举/字面量/写入点（`scope_key` 仅 3 次，均为描述符本身），该 RPC 也不暴露它们。
- `version` / `box_backfilled` 在桌面端是**透传字段**（proto 外零引用）→ 语义未证实。

### 5.3 团队级记忆：0.63.0 最大的架构变化

```
GrokBotTeamContextSummary {memory_version, generated_at_ms, prose, summary_model}
GrokBotTeamContextLearnedEntry {fact_id, text, learned_at_ms}   ← 与 MemoryFact 字段同构
GetGrokBotTeamContextSummary{agent_id} → {summary?, stale, skills[], learned[], memory_count}
```

**但提升不是 bot 自主的**（红队复核成立）：`.promoteGrokBotMemoriesToTeam(` 全库唯一调用点在 `main-app.cjs@1899396`，链路为 **renderer 记忆面板（多选 UI）→ main-app → 服务端**；daemon/coordinator 只有描述符、**0 调用点**。`GetGrokBotTeamContextSummary` 在 main-app/preload/renderer **0 命中**。

→ 正确表述：**人类在记忆面板勾选 fact → 提升为团队记忆 → 团队上下文摘要按 `memory_version` 生成**。粒度是 `fact_id`，与 UI 可勾选行一一对应，结构完全自洽。

### 5.4 记忆落在哪（存储链路）

- 桌面端本地是**只读缓存副本**：`%APPDATA%\Grok Bot\sand-client-persistence\`，文件名 = **整串 base32(key)**（字符表 `abcdefghijklmnopqrstuvwxyz234567`，RFC4648 小写无填充；key ≤146 B 用 `.blob`，≥147 B 用 `.kblob`），值**明文 JSON**（`{"schemaVersion":N,"value":…}`，mode `0o600`；**无 Chromium 前缀**——那是 09-11 的一次性迁移源，`.migrated-from-local-storage` 即迁移时间戳）。
- 权威副本在服务端 `aiserver.v1.GrokBotService`；同步四件套 = **generation（uint32 单调世代）+ seq（服务端分配）+ updated_seq（行级 LWW）+ deletes[]（墓碑）**。
- **`CommitGrokBotTranscriptEntries` 在全部发行包中 0 调用点** → 桌面端对 transcript **只读不写**，写入方是 box 侧运行时（本机 asar 不含）。
- 本地副本的裁剪策略【代码】：**每 agent ≤200 条 / 每条 ≤768 KiB / 每账户 ≤24 份 / persistedAt 超 7 天删除**，写盘去抖 2 s，按时间戳 LRU —— 这解释了为什么对话很长但最大的 replica 只有 29 KB。
- **`/home/box/sand-data/agents/<uuid>/store.db` 是未证实项**：全 asar 对该字符串 **0 命中**，只作为 roster 的 `path` 出现；谁建表、schema、`box_backfilled` 置位时机，一概未知。

---

## 6. 自进化 & 实时适配

### 6.1 站边结论

> **人类/模板负责「沉淀」，bot 负责「落库」与「复用」；模型自主权只覆盖"内容"，不覆盖"能力边界"。**

四条硬支撑：

1. 全库**没有任何** RPC 或工具能改模型权重、系统提示、harness 类型或权限。能改的只有 `name / description / title / avatar / skills / memories / routines / plugins / room members`。
2. 所有**对外生效**的修改（建 bot、改 bot、加成员、建 routine、发 skill、录屏教学）在客户端侧全部登记为 **`person` 级**（需人在场）；Auto Review 也在同一层。
3. bot 唯一的"自主写入"通道是 `update_state`，target 只有 `routine | memory | skill`，action 只有 `create | write | resume`；且流程明确要求：装插件必须先弹 **question widget** 征求同意，routine 默认建为 **enabled=false（暂停）**，恢复必须用纯文本问用户。
4. 沉淀物的物理形态是**文档**（`SKILL.md`、markdown `content`、纯文本 memory、recipe JSON），不是代码也不是权重 —— 每次都要模型重读才生效。

### 6.2 能力沉淀链路（真实证据链）

```
人类把任务跑顺
   ↓ 【代码】recipe schema {profile, memory[], skills[], routines[], plugins[], gettingStarted?}
模板/导入 → 塞进 <bot_template_setup_context>
   ↓ 【代码】提示词逐条命令 bot 调用 update_state 写回自身
bot 落库：skill / memory / routine（routine 默认暂停）
   ↓ 【代码】复用：skill 账号级可被各 bot 引用；routine 由 10 类 trigger 触发
下一次任务自动/手动复用
```

关于 routine：

- `routine` 与 `automation` 是**同一物**（类型级：`GrokBotAgentDefinition.routines[]: GrokBotAgentAutomation{automation_id, record_json}`）。
- trigger 是 **10 类联合**：cron / slack / github / origin / microsoftTeams / linear / sentry / pagerduty / email / webhook（官网只举了 2 类）。
- 【文档】官方称"每 bot ≤50 routine、保留最近 20 条运行记录"→ **代码 0 命中，未证实**；proto 里没有 run-history 类型，RPC 只有 List / SetEnabled / Delete。

### 6.3 bot 能不能改"自己"和"同伴"

**能，但只在人设层**：运行时工具 `UpdateAgent` / `CreateAgent` / `SendToAgent` 确实存在，并带专用拒绝码 **`agent-rename/refused`**。也就是说 bot 可以改自己或同伴的 `name` / `description`（= 群聊里的分工说明），但改不了触发规则（`UpdateGrokBotAgentRequest` 里没有触发规则字段）、改不了成员表、改不了权限。

### 6.4 实时适配：靠什么"根据用户情况调整"

- **人设（`description`/`title`）**：创建者/同伴把用户需求扩写成 description → 这是新人"不犯错"的主要来源（见 §7）。
- **记忆**：用户说"以后都这样做"→ 由模型写入 memory（`tier:"log"`），下次进上下文。
- **技能**：稳定流程 → 存成 skill → 账号级复用。
- **群聊行为**：靠每轮的 `peers[]` + `room.description` briefing + 对 `@` 的响应 + 自主 `PASS`，而不是靠"成员触发规则"（旧文档那条是误读）。
- **边界**：自动化触发/审批分流（Auto Review）在 `person` 层，模型不能自己放权。

---

## 7. 群聊已经开始后，怎么加新成员

### 7.1 加人机制

| 操作 | RPC | 语义 |
|---|---|---|
| 建群 | `CreateGrokBotRoom{agent_id, name, description, member_agent_ids[], human_member_user_ids[]}` | human 成员是 0.63.0 新增的第二类 |
| 改 bot 成员 | `SetGrokBotRoomMembers{agent_id, member_agent_ids[]}` | **全量覆盖，无增删语义**（UI 靠 `[...memberIds, newId]` / `filter(x=>x!==removed)`） |
| 加人类 | `AddGrokBotRoomPeople{agent_id, user_ids[]}` | 有人类成员的房间**必须是 server-hosted（temporal）且需要 team 账号**，否则报 `Group chats need a team account that can create server-hosted Bots` |

成员上限实证：**6（无人类）/ 3（有人类）/ 20（人类）**；移除成员时 `memberIds <= 1` 直接拒绝（旧结论成立且更严）。群**不能**作为成员加入另一个群（候选过滤器显式 `!o.isGroup`）。

### 7.2 新人"如何在不知道历史的情况下不犯错"——**不靠历史回放**

协议层只有：`new_messages[]`（增量）+ `peers[{id,name,description}]` + `room{id,name,description}`。整个注册表（约 2070 条描述符）里**没有**回放 RPC、**没有**回放条数/摘要上限字段。

本机实证：

- 新人（优化到起飞仔 / 偷感十足仔）的 kickstart 自我介绍 + widget **只发在它自己的私聊、不在房间**；同文本在房间 transcript **0 命中**。
- 同一份数据里存在 `绿毛仔 → 前端熬夜仔` 的完整 bot↔bot 交接私信（`fromAgent`/`toAgent`，含仓库路径、3 处要改点、附图、协作要求）——**这才是真正的上下文搬运**。
- 新人入群后连续 5 轮不发言也正常（`PASS`/未派发）；被 `@` 时只有被点名者发言。
- 实测该房间 `description = ""`（空）→ **不要指望 `room.description` 承担 briefing 职责**。

**入群时序（最终判定）**：

```
被加入成员表(SetGrokBotRoomMembers 全量覆盖)
   → 服务端下一轮 turn 派发时带上 room + peers[] + new_messages
   → 新人靠：① 创建者写在它 description 里的分工 ② 同僚的显式私信交接
            ③ 每轮增量消息 ④ 不确定就 PASS / 被 @ 才答
   → 历史回放：协议无、UI 无、数据无【未证实存在】
```

---

## 8. 官方宣传 vs 实测（最有价值的一节）

| 主题 | 官方/公开说法 | 实测与员工自家论坛 |
|---|---|---|
| **bot 互发消息** | "bots can message each other directly""you are not the router" | 【文档】Cursor 员工建议改用 **one bot + subagents**：每条 bot-to-bot 消息**烧一次周配额**，且存在 Chief bot 无法主动联系其他 bot 的 known issue。**subagents 在 21 个官方文档页里从未出现** |
| **context 复利** | "context compounds over time" | 员工承认**每轮重发完整 transcript**，"isn't intended behavior"，实测 200–250k tokens/回复，无 compact |
| **群聊协同** | 选 2–6 个 bot，bot 自主决定谁发言 | 协议确实如此（`PASS` + 服务端派发），但派发决策在服务端且客户端不可见 |
| **群聊与记忆** | 群聊是协作面 | 员工："each bot has one conversation and one memory…spans both its 1:1 chat and every group"；实测是"层次不同"（见 §4.3）：别人的话不进你记录，自己发往群的会留 |
| **记忆可共享** | skill 账号级；记忆可提升到团队 | 提升**由人类在面板勾选**触发（客户端唯一调用点），不是 bot 自主 |
| **routine 限额** | 每 bot 50 个 / 保留 20 条 | 代码 0 命中 → **未证实** |
| **skill 无上限** | 官方称无上限 | 代码有 `MAX_BOT_SKILLS` / `tooManySkills`（值为 i18n 占位符，由服务端下发） |
| **中途加人** | 只有一句 "Group membership can be edited later." | **官方与社区双空白**：没有任何补上下文机制说明；实测靠同僚交接（§7.2） |

---

## 9. 可迁移的设计要点（给我们自己的产品）

1. **群 = 一个 agent 实体**，而不是新概念。UI、路由、持久化、未读、通知全部零改动复用 —— 代价是群也要有自己的 transcript 与存储。
2. **隔离上下文 + 显式窄带搬运**，而不是共享黑板。防止上下文污染、责任不清、成本失控；代价是跨 agent 的每次交流都要人/agent 主动打包。
3. **共享环境是协作底座，也是最大的安全取舍**：文件/屏幕/登录态共享 → 交接零摩擦；代价是 bot 之间**没有安全边界**（放进去的东西要假定所有 bot 可见）。做产品必须显式选择并把取舍讲给用户。
4. **`PASS` 是一等公民**：多 agent 群聊最常见的失败模式是全员抢答，协议级"本轮我不说"比事后去重便宜得多。
5. **共享可见状态 + 人类在环 > 纯 agent 互发消息**：可调试、可监督、可信任；官方自己的 Guide 也是把人类团队形状（board / channel / Blocked / roster）套给 AI。
6. **能力要沉淀成资产**：跑顺一次 → skill → routine（先手工、再固化、再自动化）。但**权限边界不能交给模型自主**：够改内容，不够改边界。
7. **新人入群不要指望回放历史**：把"分工 + 同僚 + 增量 + 可沉默"做扎实，比塞历史更便宜也更准。

---

## 10. 证据索引（每份明细文档都在仓库里）

| 问题 | 明细文档 | 红队复核 |
|---|---|---|
| 通信与群聊轮次编排 | [01-communication-and-groupchat.md](docs/research/grok-bot/01-communication-and-groupchat.md) | [07-verification-report.md](docs/research/grok-bot/07-verification-report.md) C9/C11/E14-01 |
| 上下文处理与记忆架构 | [02-context-and-memory.md](docs/research/grok-bot/02-context-and-memory.md) | A1–A5、E14-02（含 1 条降级） |
| 自进化与实时适配 | [03-self-evolution-and-adaptation.md](docs/research/grok-bot/03-self-evolution-and-adaptation.md) | B5–B8c、E14-03 |
| 群聊动态加人与协作拓扑 | [04-dynamic-membership.md](docs/research/grok-bot/04-dynamic-membership.md) | C10、E14-04 |
| 记忆持久化与跨端同步 | [05-memory-persistence-and-sync.md](docs/research/grok-bot/05-memory-persistence-and-sync.md) | D12、E14-05（304→**249** 更正） |
| 官方文档与公开报道 | [06-official-docs-and-public-narrative.md](docs/research/grok-bot/06-official-docs-and-public-narrative.md) | E14-06 |
| 独立验证与交叉仲裁 | [07-verification-report.md](docs/research/grok-bot/07-verification-report.md) | — |

红队**推翻/降级 3 条**（已按最终判定写入本文）：

1. 02 §5.3「群聊发言**不**写入发言者 transcript」→ **降级**（反例：`d4c37f88` seq37 是自己发往群的条目）。
2. 05 §6.3「GrokBotService **304** 个方法」→ **不成立**，实测 **249**。
3. 02 §4.2「`PreCompact` 是真正的压缩机制」→ **过度归因**，归属**无法判定**。

复现工具（临时产物，可安全删除）：

- 解包：`.tmp-grok-bot/extract-asar.mjs` → `.tmp-grok-bot/app/`（v0.63.0 全量源码）
- proto 结构化提取：`.tmp-grok-bot/scripts/proto-extract.mjs` → `proto-all.txt`（2048 类型 / 71 枚举；注：PowerShell 重定向产物为 UTF-16LE，用 UTF-8 读会看到 `\0`）
- 本机数据解码：`.tmp-grok-bot/scripts/decode-persistence.mjs`、`analyze-transcripts.mjs`、`ws5-snapshot.mjs`（对 `%APPDATA%` 全程只读）
- 红队独立脚本 23 个：`.tmp-grok-bot/verify/`

> 工具备注：`proto.cjs` 等产物是**单行压缩**（proto.cjs 仅 5 行 / 1,082,950 字节，绝大部分内容在第 4 行），通用 grep 会漏报；全组统一改用 Node 子串检索（`ws5-ctx.mjs` / `v-tools.mjs`）与「`文件@字节偏移`」定证。

---

## 11. 未证实清单（明确不编造）

1. **服务端编排细节**：`@` 的服务端解析、`PASS` 由谁判定、`deadline_ms` / `is_winding_down` 由谁触发、并发上限 —— 客户端不可见。
2. **box 侧 `store.db`**：创建者、schema、表结构全未知（asar 内 0 命中）；`box_backfilled` 置位时机未知。
3. **`scope` / `scope_key`** 的取值与跨 agent 语义（无枚举、无写入点）。
4. **`PreCompact` 归属**：属 Grok Bot 还是 IDE agent（无法判定）。
5. **模型侧可见上下文**：0.63.0 桌面产物无法判定——员工"一份历史横跨 1:1 与所有群"的说法只能部分印证（见 §4.3）。
6. **新人首轮是否补全积压消息**、回放/摘要上限（协议无字段，无法证实存在或不存在）。
7. **`GROUP=5` 的实际用途**：客户端无消费者（`Qqt()` 无 GROUP 分支），服务端行为未知。
8. **记忆 fact 的写入方**：只有读（List）与提升（Promote）两个 RPC，**没有**"写一条 fact"的 RPC → 抽取逻辑在服务端/box；`sand_memory_dreaming` 默认 false，打开后行为未知。
9. **routine 数量/运行记录上限**、`MAX_BOT_SKILLS` 的具体数值（i18n 占位符，服务端下发）。
10. **`acceptedSequenceHint` 推进条件**、本地 seq 空洞的确切成因（仅有数值观测）。
