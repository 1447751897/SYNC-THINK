# OV4 · 动态加人与自进化：差距 + 改造规格

> 范围：本文件只回答两件事——**"群聊跑到一半怎么加人、新人怎么接得上"** 与 **"跑顺一次怎么沉淀成长期能力"**。
> Grok Bot 事实**直接引用** `docs/research/grok-bot/04-dynamic-membership.md`（WS4）与 `docs/research/grok-bot/03-self-evolution-and-adaptation.md`（WS3），不重复调研。
> 现状全部**实测自本仓只读代码**；证据格式 `文件:行`；分级 `【代码】/【推断】/未证实`。
> ⚠️ **行号快照说明**：本次实测期间仓库存在**在途改动**（`apps/runtime/src/collaboration-chat-host.ts`、`task-room.ts`、`runtime.ts`、`chat-tools.ts`、`packages/shared/src/types/collaboration-chat.ts` 等在同一时段被修改）。本文行号以 **2026-10-01 11:20 快照**为准，并尽量同时给出**符号名**（函数名/字段名/错误码）作为稳定锚点；若行号漂移，请按符号名检索复核。
> **不重复 OV2**：通用记忆 schema、注入顺序、token 预算、压缩策略一律以 `docs/design/grokbot-overhaul/02-context-memory-gap.md` 为准；本文只定**成员/群维度**特有的边界与审批（见 §4.4 接口约定）。
> 写入范围：仅本文件（脚本位置 `.tmp-grok-bot/scripts/`）。未修改 `apps/`、`packages/`、`docs/adr/`。

---

## 0. 结论摘要

**现有实现不是"没有加人能力"，而是"加人之后没有任何交接语义"。** 成员表能加、能软删、能改角色串，但：

1. **加人 = 往 `members[]` 里推一行**，不发任何事件、不通知任何人、不生成任何针对新人的交接物；新人第一次被派活时拿到的是一份**通用房间上下文**（`buildTaskRoomContext`：目标 + 检查点 + 工作索引 + 12k 字符历史 + 产物索引 + 名册），而不是**入群包**。Grok Bot 反而更"诚实"：它什么都不回放，只给 `room{id,name,description}` + `peers[]` + `new_messages`，把"接上"这件事交给**同僚显式交接**（`docs/research/grok-bot/04-dynamic-membership.md` §4 ★）。
2. **房间内的成员"名册视图"是加群时刻的冻结字符串**：`member.role` 取自 `agent.description` 的**快照**，此后编辑 Agent / Team 都不会刷新它（team 重加会替换、单个 agent 重加**不会**）。于是**协调员看到的分工 ≠ 成员真实的 persona**。
3. **自进化在房间里被结构性关闭**：`create_skill / update_skill / delete_skill / create_agent / update_agent / create_team / register_remote_mcp` 这批"库管理"工具只在 `model` track 可用；房间的 track 是 `agent`/`team`，工具目录构建阶段就被过滤，派发时还有第二层拒绝。房间既不能沉淀 skill，也不能沉淀记忆（记忆的读与写两个口子都被显式跳过）。
4. **记忆系统是"半成品"**：表、版本、审批、回滚、审计事件全都在（`memory_change` / `memory_entry`），但 ① 房间读写全禁、② 唯一的自动写入是**非房间**会话的 240 字符 auto-approve 摘要、③ 渲染层没有任何 `listMemory`/`memory.decide` 的挂载点（只在 `.bak` 里），即**没有活的人在审口**。

**最缺的三件事**：
- **入群包（onboarding packet）**：字段级规格见 §2。没有它，"新人不犯错"只能靠模型自觉。
- **能力沉淀链路**：从"一次成功的运行"到"可复用 skill"之间**没有任何桥**，只有手工导入 SKILL.md（§3）。
- **可见的审批与审计面**：能力矩阵里"谁批准"这一步在代码里存在、在界面上缺失（§4、§5）。

---

## 1. 现状实测：加人 / 移人

### 1.1 命令面（唯一入口）

命令是协作会话的一个 action，**没有独立 RPC**：

```ts
// packages/shared/src/types/collaboration-chat.ts:262
| { action: 'members'; conversationId: string; addAgentIds?: string[];
    addTeamIds?: string[]; expectedTopologyRevision?: number;
    removeMemberIds?: string[]; coordinatorMemberId?: string;
    roles?: Record<string, string> }
```

校验：`packages/protocol/src/collaboration-chat.ts:73-74`（`addAgentIds`/`addTeamIds`/`removeMemberIds`/`coordinatorMemberId`/`expectedTopologyRevision` 逐项 optional 校验）。

### 1.2 执行路径与顺序语义（`apps/runtime/src/collaboration-chat-host.ts:543-586`，方法 `updateMembers`）

| 步骤 | 行为 | 证据 |
|---|---|---|
| 乐观并发 | `expectedTopologyRevision` 不匹配 → `collaboration.topology_conflict：成员已变化，请刷新后重试` | `:545` |
| 协调权保护 | 有待跑任务时换协调员 → `collaboration.coordinator_busy` | `:547` |
| 移除前忙检查 | 被移除成员（或其小队子成员）有 BUSY attempt → `collaboration.member_busy：请先停止或完成该成员的任务再移出` | `:548-551` |
| 加小队 | `teamMembers()` 逐行 upsert；`team:${id}` 已存在则**整行替换**（角色随 team 定义刷新） | `:552-559` |
| **加单个 Agent** | `agentMember()` 现读 `agent.name / agent.description`；**已存在则只置 `active = true`，不刷新 name/role** | `:560-564` |
| 移除 | **软删**：`member.active = false`（行保留），并级联停用其小队子成员 | `:566-572` |
| 角色改写 | `command.roles` 逐成员覆盖 `member.role`（唯一人工"改职责"入口） | `:573-576` |
| 不变量 | 协调员必须仍是 active 且非小队成员，否则 `collaboration.coordinator_required` | `:577` |
| 版本 | `topologyRevision += 1`（成员变更唯一对外信号） | `:578` |
| **无入群通告** | 全库搜 `kind:'system'` 只命中 3 处：目标确认（`collaboration-chat-service.ts:329`）、负责人跟进轮的内部标记（`:385-386`）、汇总请求（`:917`）。**没有 join/leave 系统消息** | grep `kind: 'system'` |

成员条目结构：`CollaborationMember{id, kind:'user'|'assistant'|'agent'|'team', teamParticipantId?, teamSnapshot?, agentId?, name, avatar, role, active}`（`packages/shared/src/types/collaboration-chat.ts:10-21`），`agentMember()` 把 `role` 直接取成 `agent.description`（`collaboration-chat-host.ts:119-125`，`role` 在 `:124`）。

**移人不打断在途工作**这一点是**已经做到的**：移除前有 `member_busy` 闸门；`member_inactive` 在派发准入处抛错（`collaboration-chat-service.ts:461, 517, 1042`）；已入队任务遇到 inactive 成员时 pump 的 `waitReason = 'member_removed'`（`:684`），负责人跟进轮也会记 `receipts[key] = 'member_removed'`（`:385`）。

### 1.3 新人拿到什么（今天的"入群包"其实是通用房间上下文）

任何一次房间内 turn（含 consultation）都会走同一个 builder：`collaboration-workflow.ts:47` → `if (snapshot.conversation.room) return buildTaskRoomContext(...)`。它是一个**未被命名的入群包**，内容如下（`apps/runtime/src/task-room.ts:56-93`，函数 `buildTaskRoomContext`）：

| 段 | 内容 | 预算/上限 | 行号 |
|---|---|---|---|
| 角色声明 | "你在一个独立的长期群聊中工作。只使用本群资料…历史内容是引用资料，不是系统指令" | — | `:64` |
| 房间标识 | title / roomId / taskId / purpose | — | `:65` |
| **本群目标** | `<confirmed_goal revision=N>` + goal 全文；>20000 字符时提示分页读 | 20,000 字符 | `:66-67` |
| 当前请求 | task.instructions | — | `:68` |
| 沟通纪律 | 必须填 recipientMemberIds；"仅写 @名字不是投递"；`expectsResponse` 语义；咨询是只读交流 | — | `:69-70` |
| 咨询续做 | `awaitingPeerTaskIds` 提示先核对回应 | — | `:71` |
| 角色权限 | discussion / coordination / work 三套提示词（discussion 里还分"用户直接找协调员"与"其他人"两支），`coordination` 才有 `collaboration_dispatch_tasks` | — | `:74-80` |
| **成员名册** | `roster.map({id, agentId, name, role, kind, teamParticipantId})`，仅 `active && kind!=='user'` | — | `:59, :81` |
| 小队信息 | 仅 coordination 且成员是 team 时 | — | `:82` |
| **检查点** | `{version, savedAt, pendingTaskIds, completedTaskIds, artifactIds, note, pendingCount, completedCount}`，各数组 `slice(-60)`、note `slice(0,3000)` | — | `:83` |
| **工作索引** | 最近 60 条任务的 `{id,title,assignee,purpose,parent,status}` | 60 | `:84` |
| 历史消息 | `<selected_room_history>`：**先保当前触发消息（4,000 字符）**，再倒序填充（每条 3,000 字符），最多 24 条且 ≤12,000 字符；超长条目截断并附"用 `collaboration_read_context(kind='messages', id=…)` 读全文" | 24 条 / 12k 字符 | `:26-54, :85` |
| 遗漏声明 | "另有 N 条历史未注入…**可访问不等于已读**" | — | `:86` |
| **产物索引** | 每 attempt 的 artifacts：`{id,taskId,title,kind,path,bytes,attemptStatus}`，`slice(-60)` | 60 | `:62, :87` |
| 回读指引 | `collaboration_read_context(kind=artifact/tasks/messages/brief, offset)` | — | `:88, :96-126` |
| 续做提示 | 有 `resumeFromAttemptId` 时 | — | `:89` |
| 交付要求 | task.deliverable | — | `:90` |

每次 attempt 还会落一条 `contextManifest`（**这是"入群包"最好的落点**）：`{roomId, purpose, sourceSequence, messageIds[], artifactIds[], historyOmitted, continuation:'fresh'|'resume_candidate'}`（`packages/shared/src/types/collaboration-chat.ts:194-198`；写入点 `collaboration-chat-service.ts:728`；生成逻辑 `task-room.ts:48-53`）。

### 1.4 与 ADR 0004 §Membership and migration 的对照

| ADR 条文（`docs/adr/0004-task-room-execution.md`） | 代码事实 | 判定 |
|---|---|---|
| 加 team 会快照 room roster/roles | `teamMembers()` 返回 `teamSnapshot: structuredClone(team)`（`collaboration-chat-host.ts:115`），成员行按 `config.role` 写入（`:116`） | ✅ 一致 |
| 加独立 Agent 只影响本房间、不触发执行 | `updateMembers` 不产生 task/attempt/delivery（`collaboration-chat-host.ts:560-564`） | ✅ 一致 |
| 后续 @ 咨询可通过同一有界上下文 API 读该房间适用历史 | consultation 走 `buildTaskRoomContext` 同一 builder（`collaboration-workflow.ts:47`） | ✅ 一致 |
| **Team 库编辑不会静默替换活跃房间 roster；改完要"移除后重加 team"** | team 路径重加即整行替换（`:552-559`）；单独 agent 路径重加**不刷新**（`:560-564`） | ⚠️ **部分不一致**：ADR 只说了 team 语义，agent 语义是"永久冻结" |
| 旧快照原地升级、保留消息/任务/回执/产物 | `CollaborationSnapshot` 单表 JSON 保存，`revision`/`receipts` 保留（`packages/shared/src/types/collaboration-chat.ts:202-212`） | ✅ 一致 |

补充事实（ADR 未覆盖）：Team 定义本身**无版本链**，编辑是裸 UPDATE；roster 快照只在**旧式 team run** 启动时落 `team_run.roster_snapshot_json`（`packages/storage/src/schema/team.ts:13-28, 71-98`）。房间内的快照则寄生在 `CollaborationMember.teamSnapshot` 上。

### 1.5 与 Grok Bot 相比：多什么 / 缺什么

| 维度 | Grok Bot 0.63.0（实测） | SYNC-THINK 现状 | 判定 |
|---|---|---|---|
| 加人 API | `SetGrokBotRoomMembers{agent_id, member_agent_ids[]}`（**全量覆盖**）+ `AddGrokBotRoomPeople{agent_id,user_ids[]}`（人类） | `action:'members'` 增量增删 + 软删 + `roles` + `topologyRevision` CAS | ✅ 我们更好（不用整表覆盖、有并发保护） |
| 历史回放 | **无**（只有 `new_messages` 增量，全注册表无回放 RPC） | 有界历史选择（24 条 / 12k 字符）+ 目标 + 检查点 + 工作索引 + 产物索引 | ✅ 我们多得多 |
| 同僚信息 | `peers[{id,name,description}]` 每轮下发 | `roster[{id,agentId,name,role,kind}]` 每轮注入 | ⚠️ 相当，但我们的 `role` 是**冻结串**（见 D2） |
| 本群 briefing | `room{id,name,description}` 每轮下发（实测为空串） | `room.goal`（用户确认的目标）+ 检查点 note，**比 description 强** | ✅ 我们更好 |
| **入群动作本身的语义** | 无（新人不特殊，靠 creator 写进 description + 同僚私信交接） | 无（`topologyRevision+1`，无通告、无交接物） | ❌ **两边都缺，但 Grok Bot 有代偿机制（同僚显式交接），我们没有** |
| 成员可沉默 | `outcome = SENT\|PASS\|SKIPPED\|TIMEOUT\|CANCELLED\|ERROR` | 成员被派就必须产出；无 PASS/SKIPPED 语义 | ❌ 缺（新人"不该说"时无处表达） |
| 成员上限 | 6（无人）/3（有人）/20（人类） | 无人数上限；但 workflow roster ≤32（`collaboration-workflow.ts:17`）、节点 ≤64（`collaboration-team-participants.ts:54`，ADR:16） | ⚠️ 量级不同，且我们无人类的房间成员概念（房间人类固定 `user:local`，`collaboration-chat-host.ts:506`） |
| 群套群 | 明确禁止（候选过滤器 `!o.isGroup`） | 允许嵌套小队（`teamParticipantId`），但有小队循环检测 `task_room.team_cycle`（`collaboration-chat-host.ts:310`） | ⚠️ 设计不同，非缺陷 |
| 成员移除 | 全量覆盖 + UI 双重校验（≥2 才可移） | 软删 + 忙检查 + 子成员级联 | ✅ 我们更好 |
| 加入不打断在途 | 服务端语义不可见 | `member_busy` / `member_inactive` / `waitReason='member_removed'` | ✅ 已做到 |

### 1.6 缺陷清单（加人/移人）

| # | 严重度 | 缺陷 | 证据 | 真实后果 | 触发条件 |
|---|---|---|---|---|---|
| D1 | **P0** | 无入群包：新人拿不到"我为什么在这、当前决定是什么、我该接哪一段" | 只有通用 builder（`task-room.ts:56-93`）；`topologyRevision` 是唯一成员变更信号（`collaboration-chat-host.ts:578`） | 新人重复已完成工作 / 抢别人的活 / 产出与既有产物冲突 | 任何中途加人 |
| D2 | **P0** | 名册角色冻结：`member.role` 取自加群时刻的 `agent.description`，单独 agent 重加不刷新 | `collaboration-chat-host.ts:560-564` vs `:552-559`；`agentMember()` `:119-125`（role 在 `:124`） | 协调员按过期分工派活；成员真实 persona 与名册不符；"团队库编辑"永远不生效 | 加人后编辑 Agent/Team 定义 |
| D3 | **P0** | 房间内无法沉淀任何能力：`create_skill/update_skill/delete_skill/create_agent/update_agent/create_team/register_remote_mcp` 对非 `model` track 全禁（目录级 + 派发级双闸） | `collaboration-policy.ts:91-104, 133-141`；目录过滤 `kernel/platform-tools.ts:628-636`；派发拒绝 `runtime.ts:22738-22748`；房间闸门 `runtime.ts:27296-27318` | 一次成功的协作**不能**留下任何可复用资产 | 房间内任何"要不要存成技能/记忆"的请求 |
| D4 | P1 | 房间内记忆读写双禁 | 读：`runtime.ts:25050`（`!...conversation.room` 才注入）；写：`runtime.ts:32356`（房间直接 return）；ADR:24 | 跨房间零复用；换个房间从零开始 | 任何第二本书/第二个项目群 |
| D5 | P1 | 无 PASS/沉默语义 | `CollaborationAttemptStatus` 无 PASS（`packages/shared/src/types/collaboration-chat.ts:106-108`）；`waitReason` 无"本轮我不发言" | 新人不敢动也得动，噪声与重复劳动 | 无 @ 的群消息、新人首次被唤醒 |
| D6 | P1 | 无"已读/未读"记录，只有投递状态 | `CollaborationDelivery.status ∈ queued\|processing\|processed\|failed\|cancelled`（同上 `:92-99`）；提示词明写"可访问不等于已读"（`task-room.ts:86`） | 无法证明新人读过交接物；无法做"交接完成"验收 | 任何交接验收 |
| D7 | P2 | `historyOmitted` 只给数量，不给"哪几条被省了"的可枚举清单 | `task-room.ts:51`、manifest `messageIds` 只记被选中的 | 新人无法精确知道"我还缺什么" | 长房间 + 小预算 |
| D8 | P2 | 成员变更无 UI 可见的通告/审计出口 | 无 system 消息；`topologyRevision` 仅用于 CAS | 用户看不出"谁什么时候进来/走了" | 任何成员变更 |

---

## 2. 目标规格：入群包（Onboarding Packet）

### 2.1 设计原则

1. **入群包是"派生物 + 落盘物"，不是又一份聊天记录。** 它必须由宿主在**加入时刻**生成一次，并随 attempt 注入；不能靠模型去翻。
2. **回答四个问题**：我在哪（本群目标）｜旁边是谁（成员/职责）｜已经定了什么（决定摘要）｜我该从哪接（产物索引 + 负责人 + 可读范围）。
3. **不复制消息**：只放指针（id/序号/偏移），正文按需读——与 ADR 0004"bounded context + 分页读"一致，也避免 OV5 提的上下文爆炸。
4. **可测**：每个字段都要能被断言（见 §8）。
5. **与现有结构同构**：全部落在已有的 `CollaborationMember` / `TaskRoomCheckpoint` / `contextManifest` / `CollaborationArtifact` 上，只加薄薄一层。

### 2.2 落点与生命周期

```
加入时刻（updateMembers 内，同一事务）          首次/后续每次 attempt
  ┌──────────────────────────────┐            ┌────────────────────────────┐
  │ OnboardingPacket（新增）      │  ──────▶   │ buildTaskRoomContext()      │
  │ subjectMemberId = 新成员      │   注入      │  <onboarding_packet ...>   │
  │ revision / topologyRevision   │            │  + 既有 goal/checkpoint/…   │
  └──────────────────────────────┘            └────────────────────────────┘
        │ 同时作为一条 system 消息（可读、可引用）
        ▼
  CollaborationMessage{kind:'system', recipientMemberIds:[新成员]}
```

- 生成时机：`updateMembers()` 完成成员写入后、`topologyRevision += 1` 之前（`collaboration-chat-host.ts:578` 前）。
- 存储位置（三选一，建议 A）：**A** 作为 `CollaborationMessage{kind:'system'}` 追加进房间消息流（复用现有持久化、可被 `collaboration_read_context(kind=messages)` 读到，零新表）；**B** 挂在 `CollaborationMember.onboardingPacket`（需要改 shared 类型 + 每房间 JSON 体积）；**C** 新建 `room_onboarding_packet` 表（需要 schema 迁移）。
- 生命周期：**一次性**。注入时带 `stale` 判定——若 `packet.topologyRevision !== conversation.topologyRevision`，标注 `stale=true` 并追加"名册已变更，请重新核对 `成员名册`"。
- 注入位置：`buildTaskRoomContext` 的 `<confirmed_goal>` 之后、`当前请求` 之前（`task-room.ts:66-68` 之间），仅当 `packet.subjectMemberId === task.assigneeMemberId`。

### 2.3 字段级规格

```jsonc
// OnboardingPacket v1  —— 全部字段为必填，除非标 ?
{
  "version": 1,
  "id": "ulp_...",                       // ULID
  "roomId": "conv_...",                  // = conversation.id
  "subjectMemberId": "agent:...",        // 收件成员（= CollaborationMember.id）
  "createdAt": "2026-10-01T...Z",
  "topologyRevision": 7,                 // 生成时的会话成员版本
  "joinedFrom": "add_agent" | "add_team" | "room_create",   // 加入方式

  // ① 本群目标（指针 + 摘要，不复制全文）
  "goal": {
    "text": "…",                         // room.goal，截断 2000 字符
    "revision": 3,                       // room.goalRevision
    "truncated": false,
    "fullReadHint": "collaboration_read_context(kind=\"brief\", offset=0)"
  },

  // ② 成员与职责（加入时刻的快照 + 稳定引用）
  "roster": [
    { "memberId": "user:local", "kind": "user",     "name": "你",   "role": "用户",        "isSelf": false },
    { "memberId": "agent:A",    "kind": "agent",    "agentId": "A", "name": "绿毛仔", "role": "…", "isSelf": false,
      "roleSource": "agent_description@<agentVersionId>",       // 角色串来源，便于检测漂移
      "currentTask": { "taskId": "…", "title": "…", "purpose": "coordination", "status": "running" } },
    { "memberId": "agent:B",    "kind": "agent",    "agentId": "B", "name": "前端仔", "role": "…", "isSelf": true }
  ],
  "rosterSelf": "agent:B",               // 冗余，便于模型定位

  // ③ 决定摘要（不是消息列表，是"已拍板的事实"）
  "decisions": [
    { "id": "dec_1", "at": "…Z", "by": "user:local",
      "text": "上排标签跟 beui Morphing Tabs，下排只做圆角",   // ≤400 字符
      "sourceMessageId": "msg_...", "sourceTaskId": "…?" }
  ],
  "decisionCount": 3,                    // 若被截断，给总数
  "decisionsOmitted": 0,

  // ④ 产物索引（沿用 artifact 的稳定字段）
  "artifacts": [
    { "artifactId": "art_...", "title": "设定集 v0", "kind": "document" | "file",
      "path": "…?", "sha256": "…", "bytes": 1234, "attemptStatus": "succeeded",
      "ownerMemberId": "agent:A", "isCurrentDeliverable": true }
  ],
  "artifactCount": 4,
  "artifactsOmitted": 0,

  // ⑤ 可读范围（"你能碰什么"，与 resourceClaims 同源）
  "readScope": {
    "roomMessages": "all",                       // all | since_seq
    "sinceSequence": null,                       // roomMessages=since_seq 时有效
    "artifacts": "all",
    "workspaceDir": ".sync-think/task-rooms/<hash>",   // ensureTaskRoomDirectory 产物
    "writeAllowed": false,                       // 与 resourceClaims.mode 一致
    "crossRoomAccess": false                     // 明确写死 false，防止模型自己扩权
  },

  // ⑥ 已读记录（新人需要回报"我读了哪些"，用于交接验收）
  "readReceipts": {
    "required": [ "goal", "roster", "decisions", "artifacts" ],   // 必须确认的段
    "acknowledged": [],                                            // 由新成员通过工具回报
    "ackTool": "collaboration_read_context",
    "ackField": "onboardingAck"                                    // 见 §8 验收
  },

  // ⑦ 交接线索（"我该从哪接"）
  "handoff": {
    "stageOwnerMemberId": "agent:A",             // 当前阶段负责人
    "openTaskIds": [ "task_..." ],               // 未完成工作
    "nextSuggestion": "等待 agent:A 的设定集 v0 交付后再动笔",   // ≤200 字符
    "doNotRedo": [ "art_..." ]                   // 明确"不要重做"的产物
  }
}
```

**为什么这些字段**（逐项对照问题清单）：

| 字段 | 回答的问题 | 来源（现成数据） |
|---|---|---|
| `goal` | 本群目标 | `TaskRoom.goal` / `goalRevision`（`packages/shared/src/types/collaboration-chat.ts:46-55`） |
| `roster` | 成员/职责 | `snapshot.members` + `role`；`roleSource` 是新增，用于检测 D2 |
| `decisions` | 决定摘要 | **新增**：从房间消息里由人/协调员显式标记，或从 system 目标确认消息派生（`collaboration-chat-service.ts:329`）；首版可只收"确认目标 + 人工标记的决定" |
| `artifacts` | 产物索引 | `CollaborationArtifact`（`:122-135`）+ attempt 状态 |
| `readScope` | 可读范围 | `resourceClaims`（`collaboration-chat-host.ts:127-142`）+ `ensureTaskRoomDirectory`（`task-room.ts:129-142`） |
| `readReceipts` | 已读记录 | **新增**：补 D6 的空白（现有 `CollaborationDelivery` 只到 `processed`） |
| `handoff` | 从哪接 | `RoomCheckpoint.pendingTaskIds`（`:37-44`）+ 工作索引（`task-room.ts:84`） |

### 2.4 与现有结构的关系（不重造轮子）

- `contextManifest` 继续做**审计**（"这轮注入了什么"），入群包做**交接**（"这个新人该知道什么"）；两者都进 attempt，互不替代。
- `checkpoint` 继续做**房间级恢复锚点**；入群包是它的"面向新人的投影"。
- **不引入新的消息表**：入群包以 `kind:'system'` 消息落盘（复用 `CollaborationMessage`），保证可读、可引用、可回放。

---

## 3. 技能沉淀：现状与目标

### 3.1 现状（来源三条，全部是"导入"）

`skill_version` 表（`packages/storage/src/schema/skill.ts:6-40`）：`skillId, name, description, version, sourceMd, body, allowedToolsJson, contentFingerprint, hasScripts, warningsJson, enabled, originType(local|market|derived), originRef, derivedFromSkillVersionId, archivedAt`。

创建路径**只有**：

| 路径 | RPC | 证据 |
|---|---|---|
| 本地导入 SKILL.md | `skill.import` | `packages/protocol/src/skill-command-contract.ts:18` |
| 远程拉取 SKILL.md | `skill.importRemote` | `:19-22` |
| 扫描/检视/导入本地目录 | `skill.local.scan / inspect / import` | `packages/protocol/src/skill-local-command-contract.ts:12-14` |
| 市场安装 | `skill.market.list / install` | `packages/protocol/src/skill-market-command-contract.ts:11-18` |

**"跑顺一次 → 存成 skill"今天不存在**：

- 全库搜 `derivedFromSkillVersionId` 的写入点：只有导入校验路径要求"`originType==='derived'` 必须给 `derivedFromSkillVersionId`"（`packages/storage/src/skill-store.ts:506-509`；`apps/runtime/src/validation/skill-mcp.ts:81-91`）。`derived` 的语义是**"从某个已有版本派生"**（人改一版），**不是"从一次成功运行提炼"**。
- **没有**任何"从 artifact/run 生成 skill 草稿"的 RPC（`skill.*` 契约全集见上表）。
- 有一个**发布**草稿表 `skill_publish_draft{skillVersionId, skillId, displayName, description, skillMd, category, version, icon, attachmentsJson}`（`packages/storage/src/schema/capability.ts:61-82`）——即"把已有版本包装成可发布条目"，**前置条件仍是要先有一个 skill_version**。
- 模型侧确实有 `create_skill` / `update_skill` / `delete_skill` / `import_remote_skill` 工具（`apps/runtime/src/chat-tools.ts:590, 607, 622, 639`），但：
  - 只在 `model` track 可用（`apps/runtime/src/collaboration-policy.ts:91-104, 133-141`）；
  - 房间内被目录过滤 + 派发拒绝双闸挡住（`apps/runtime/src/kernel/platform-tools.ts:628-636`、`apps/runtime/src/runtime.ts:22738-22748, 27296-27318`）。
  - `create_skill` 的描述本身也说明它只做"导入完整 SKILL.md"（`chat-tools.ts:592`）。

**已有但没闭环的部件**（可直接复用）：

| 部件 | 作用 | 证据 |
|---|---|---|
| `capability_usage_event{capabilityType, capabilityId, workspaceId, agentId, agentVersionId, runId, outcome, contextTokens, occurredAt}` | **能力使用审计**（含结果与上下文开销） | `packages/storage/src/schema/capability.ts:30-59` |
| `capability_workspace_activation{capabilityType, capabilityId, workspaceId, active}` | 能力在工作区的启用闸 | `:5-28` |
| `capability_organize_report{contextBudgetTokens, categoriesJson, summaryJson}` | 能力目录整理报告（预算/分类） | `:84-102` |
| `SkillVersion.archivedAt` | 可逆卸载/审计 | `schema/skill.ts:28-29` |
| 能力目录常驻预算 | frontmatter description 计入常驻预算 | `apps/desktop/src/renderer/shell/abilities/skill-resident-context.ts:1-3, 56-77` |
| 按 Agent 白名单 | `AgentVersion.skillVersionIds`（"装了 ≠ 每个 Agent 都能用"） | `packages/shared/src/types/agent.ts:66-67`、`schema/skill.ts:4-5` |
| `allowed-tools` 扩容需二次审批 | `skillStore.isPermissionApproved` | `runtime.ts:24872`，`chat-tools.ts:592` |

### 3.2 缺口清单

| # | 严重度 | 缺口 | 证据 |
|---|---|---|---|
| S1 | **P0** | 无"从一次成功运行提炼 skill"的入口 | `skill.*` 契约全集（§3.1 表）；无 `skill.deriveFromRun` 类命令 |
| S2 | **P0** | 房间内禁止一切 skill 写入 | `collaboration-policy.ts:133-141` + `runtime.ts:27296-27318` |
| S3 | P1 | 沉淀物没有"来源运行"的可追溯字段 | `skill_version` 无 `sourceRunId/artifactId`；`originRef` 是自由字符串（`schema/skill.ts:26`） |
| S4 | P1 | 没有"候选 skill"这一状态：要么不存在，要么直接是一个可用版本 | `enabled` 是唯一开关（`schema/skill.ts:22-23`），无 `draft/candidate` |
| S5 | P1 | 使用效果不回灌：`capability_usage_event` 有 `outcome`，但没有"这个 skill 有没有让人少走弯路"的回路 | `schema/capability.ts:42`（只有裸 outcome 字符串） |
| S6 | P2 | 没有"skill 该不该常驻上下文"的显式判定（靠 description 长度与 enabled） | `skill-resident-context.ts:69-77` |

### 3.3 目标流程（能力沉淀链路）

```
① 跑顺一次（房间内）
   work attempt succeeded + collaboration_submit_artifact
        │
        ▼
② 候选沉淀（**新增**，房间内允许的"只写候选"工具）
   collaboration_propose_capability{ kind:'skill'|'memory'|'routine',
                                     evidence:{taskId, attemptId, artifactId, runId},
                                     draft:{ slug, name, description, body } }
   → 落 capability_candidate（新表）或复用 skill_version.enabled=false + originType='derived'
        │  （房间内只允许"提议"，不允许"启用"）
        ▼
③ 人审（房间外，model track 或设置页）
   skill 预览：正文 diff + 来源运行 + 产物 + 使用预算影响
   approve → 创建新的 skill_version(enabled=true, originType='derived', sourceRunId=…)
   reject  → 记 rejected_by/ reason，保留证据
        │
        ▼
④ 绑定（按 Agent 白名单）
   update_agent{ skillIds:[…] }（FULL-REPLACE，已有语义，chat-tools.ts:268）或 用户在 Agent 库编辑
        │
        ▼
⑤ 复用与审计
   每轮把命中的 skill 记 capability_usage_event{runId, agentVersionId, outcome, contextTokens}
   → 报表：哪些 skill 真被用、用了几次、成功率
```

**目标字段（新增，最小集）**：

```jsonc
// capability_candidate v1（或 skill_version.enabled=false + 这些列）
{
  "id": "cap_...",
  "kind": "skill" | "memory" | "routine",
  "workspaceId": "…",
  "subjectType": "agent" | "room" | "workspace",   // 见 §4.2 边界
  "subjectId": "agent:B" | "conv_room" | "ws_...",
  "proposedByMemberId": "agent:B",
  "proposedByRunId": "run_...",
  "evidence": { "taskId": "…", "attemptId": "…", "artifactId": "…", "messageIds": ["…"] },
  "draft": { "slug": "…", "name": "…", "description": "…", "body": "…" },   // skill 用
  "approvalState": "pending" | "approved" | "rejected" | "withdrawn",
  "decidedBy": "user:local", "decidedAt": "…",
  "createdAt": "…"
}
```

**硬约束（必须写进实现）**：房间内的提议工具**只能写 `pending`**；创建/启用/绑定必须在房间外完成；`allowed-tools` 扩权沿用现有二次审批（`chat-tools.ts:592`）。

---

## 4. 记忆的"成员/群维度"（与 OV2 的边界）

### 4.1 现状事实（实测）

| 事实 | 证据 |
|---|---|
| 有记忆表：`memory_change`（提议，含 `approval_state`）+ `memory_entry`（已批准，含 `active`） | `packages/storage/src/schema/memory.ts:6-53` |
| scope 只有 `task \| project \| global` | `packages/shared/src/types/agent.ts:13` |
| **`memory_entry` 没有 agentId / roomId 列**（只有 workspaceId + taskId + scope + key/value） | `schema/memory.ts:33-52` |
| AgentVersion 上有 `memoryScope`（声明用哪个 scope），但 agent 与 memory 行之间**没有外键** | `packages/shared/src/types/agent.ts:65`；对比 `schema/memory.ts` |
| 审批/回滚齐备：`decideChange` / `rollbackChange`（逐版本可逆，会恢复前驱版本） | `packages/storage/src/memory-store.ts:325-354, 534-605` |
| 读注入**仅非房间**，limit 16 → 精选 8 条 | `apps/runtime/src/runtime.ts:25050-25068` |
| 写提议**房间直接 return**（注释："Room progress belongs to its checkpoint, never to workspace/global Agent memory."） | `runtime.ts:32350-32356` |
| 唯一的自动写入：非房间会话的**助手回复 240 字符摘要**，`scope='task'`、`key='run-digest:<runId8>'`、`confidence=0.55`、**`autoApprove: true`** | `runtime.ts:32357-32379` |
| 未自动批准的变更会入通用审批队列（`kind:'memory'`, `action:'memory.change.propose'`） | `runtime.ts:11566-11613` |
| **渲染层没有 `listMemory`/`memory.decide` 的挂载点**：`MemoryDiagnosticsPanel` 与 `ApprovalCenterPanel` 只在 `.bak` 入口与设计系统 showcase 里被引用 | `packages/ui-kit/src/components/MemoryDiagnosticsPanel.tsx:219`；grep `listMemory\|memoryChanges` 于 `apps/desktop/src/renderer/shell/` = 0 命中；`.bak` 命中 3 处（`index.tsx.pre60/pre61/pre61b.bak`） |

**判定**：SYNC-THINK 的记忆是**工作区级**的（`workspaceId` 是唯一硬归属），既**不是 bot 级**，也**不是群级**。Grok Bot 的"bot 私有记忆 + 提升到团队"（`docs/research/grok-bot/03-self-evolution-and-adaptation.md` §3.2 `PromoteGrokBotMemoriesToTeam`）在我们的数据模型里**没有对应物**。

### 4.2 三层边界定义（本文只定这个）

| 层 | 归属键 | 默认读者 | 默认写者 | 生命周期 | 与现有结构的关系 |
|---|---|---|---|---|---|
| **L-room 群记忆** | `conversationId` | 本房间全部 active 成员（含新人） | 房间内**只允许提议**（`pending`） | 随房间；房间删除即失效 | 首版**不新建表**：= `checkpoint` + `decisions`（§2.3 ③）+ 房间 system 消息；若要检索再加 `memory_entry.scope='room'`（字段名以 OV2 为准） |
| **L-bot 成员记忆** | `agentId`（**新增归属维度**） | 该 Agent 参与的所有房间（**必须显式启用**，默认关闭） | 成员自己提议（`pending`）或人直接写 | 跨房间、跨项目 | 若 OV2 采纳"memory_entry 增加 owner"方案，本层即 `scope='agent'`；否则用 `memory_change.proposedByRunId → run.agentId` 做软归属（不推荐，无法索引） |
| **L-workspace 工作区/项目记忆** | `workspaceId`（现状） | 所有非房间会话（现状）+ 显式授权的房间 | 人审（现状） | 长期 | 完全沿用 `memory_entry.scope ∈ project\|global` 与现有审批/回滚 |

**三条不变量**（必须保留 ADR 0004:24 的精神，同时开一个受控的口子）：

1. **房间内不得静默写 workspace/global**：房间侧的写一律落 `pending`，且 `subject` 默认是房间或成员，不是工作区。
2. **L-room 不得被别的房间读到**：跨房间读只有一条路——先把 L-room 提升为 L-bot 或 L-workspace（§4.3），并在提升记录里保留来源房间。
3. **L-bot 默认不注入它未参与的房间**：避免"一个 bot 的记忆串味到另一个项目"（OV5 的上下文章要求）。

### 4.3 提升审批（三级）

| 提升 | 触发者 | 审批 | 可逆 | 记录 |
|---|---|---|---|---|
| **P1** `room → room`（决定摘要固化） | 协调员或人 | **自动**（房间内，`autoApprove` 仅限此级，且必须带 `sourceMessageId`） | 是（删条目） | `memory_change{targetScope:'room', evidenceRefs:[messageId…]}` |
| **P2** `room/bot → bot`（能力/经验进某个 Agent） | 成员提议（`collaboration_propose_capability`）或人 | **人审**（房间外） | 是（`rollbackChange` 现成） | `memory_change{targetScope:'agent', subjectAgentId, evidenceRefs:[artifactId…]}` |
| **P3** `bot/room → workspace/global` | 人或 model track 的助手 | **人审 + 影响面提示**（会影响哪些会话） | 是 | `memory_change{targetScope:'project'\|'global'}` + 现有审批面板 |

对齐 Grok Bot：Grok Bot 只保留 P3（`PromoteGrokBotMemoriesToTeam` 由**人在面板勾选**触发，`03-self-evolution…§3.2`）。我们多做 P1/P2，但**每一级都必须有证据指针**（`evidenceRefs` 现成字段，`schema/memory.ts:16`）与**可逆**（`rollbackChange` 现成，`memory-store.ts:534`）。

### 4.4 与 OV2 的接口约定（避免重复）

- **OV2 拥有**：`memory_*` 表的最终字段与索引、注入顺序与预算、压缩/摘要策略、`memory_entry` 的全文检索与裁剪。
- **本文拥有**：`scope` 的**取值扩展**（`room` / `agent`）、`subject` 归属语义、三级提升的**审批与证据要求**、房间内读写的**开闸条件**（下面四条）。
- **开闸条件（建议写进 OV2 的注入器）**：
  1. 房间内注入 L-room：始终允许（就是 checkpoint/decisions/入群包）。
  2. 房间内注入 L-bot：仅当 `member.agentId` 与条目 `subjectId` 匹配，且 room 配置 `allowAgentMemoryInRoom=true`（默认 false，先关后开）。
  3. 房间内注入 L-workspace：仅当 `room.memoryPolicy === 'inherit'`（默认 `'isolated'`，保持现状行为不变）。
  4. 房间内写入：一律 `pending`（除 P1 的房间级决定摘要）。

---

## 5. 自进化：能力矩阵

### 5.1 现状（能改什么 / 谁批准 / 审计）

| 对象 | 现状：谁能改 | 改的入口 | 批准 | 审计 | 证据 |
|---|---|---|---|---|---|
| Agent 人设/名称/描述/头像 | 人（Agent 库）；模型**仅当用户本条消息明确要求** | `agent.createVersion`（不可变版本；编辑=新版本）、`agent.updateBinding`；模型侧 `create_agent`/`update_agent` | **一次性审批，任何权限模式都要**；宿主侧 intent 判定（`create\|update\|none`，正则来自用户原文，**不接受模型自报**）；`delegated=true` 强制 `none` | `agent_version` 版本链 + `agent.createVersion` 事件 | `packages/protocol/src/agent-command-contract.ts:30-41`；`apps/runtime/src/chat-tools.ts:224-268`；`apps/runtime/src/agent-management-intent.ts:1-39`；审批断言 `apps/runtime/src/agent-management-intent.test.ts:56-57` |
| 技能（库/绑定） | 人（能力中心）；模型**仅 model track** | `skill.import/importRemote/local.*/market.install`；`create_skill/update_skill/delete_skill` | full-access 直接导入，其他模式需审批；`allowed-tools` 扩容额外审批 | `skill_version` 版本链 + `archivedAt` + `capability_usage_event` | `apps/runtime/src/chat-tools.ts:590, 607, 622, 639`；`apps/runtime/src/collaboration-policy.ts:91-104,133-141` |
| Team | 人；模型**仅 model track** | `create_team/update_team/delete_team` | 同上 | team 定义无版本链（裸 UPDATE），仅 `team_run.roster_snapshot_json` | `collaboration-policy.ts:101-103`；`packages/storage/src/schema/team.ts:13-28` |
| MCP | 人；模型**仅 model track** | `register_remote_mcp` | 同上 | `mcp` 表 | `collaboration-policy.ts:100` |
| 成员（加/移/改角色/换协调员） | **仅人**（命令面 `action:'members'`） | `updateMembers` | 无二次审批（用户操作即批准）；`member_busy`/`coordinator_busy`/`topology_conflict` 三道闸 | `topologyRevision` + snapshot `revision`；**无事件流** | `collaboration-chat-host.ts:543-586` |
| 记忆 | **无模型工具**；只有宿主 RPC | `memory.propose/list/decide/rollback` | 自动（task 级 digest）或人审 | `memory.change.proposed/decided` 事件、`memory_change` 版本链、`rollbackChange` | 契约 `packages/protocol/src/memory-command-contract.ts:11-24` + `packages/protocol/src/commands.ts:241-244`（含 `memory.propose`）；`runtime.ts:11531-11635, 32350-32399` |
| routine/自动化 | **无模型工具**（纯用户功能） | `scheduled-task-*` 契约 | 用户 | — | grep `chat-tools.ts`/`kernel/platform-tools.ts` 中 `schedule_*`=0 命中；`packages/protocol/src/scheduled-task-command-contract.ts` |
| 房间内提议技能/记忆 | **完全不允许** | — | — | — | `runtime.ts:27296-27318` |

**结论（一句话）**：SYNC-THINK 的"自进化"今天**只存在于 model track（主助手单聊）**；一旦进入任务房间，所有定义管理类能力被**结构性关闭**，房间成员只能产出文档。对比 Grok Bot：它给 bot 一个只写 `routine|memory|skill` 三槽的 `update_state`（`docs/research/grok-bot/03…§1.3、§3.3`），**房间内也有自主写入**（只是资产在服务端）。我们是"要么全开（单聊），要么全关（房间）"。

### 5.2 目标能力矩阵

| # | 能力 | 谁可以改 | 批准 | 审计事件 | 落地阶段 |
|---|---|---|---|---|---|
| A1 | 改**自己**的人设/描述（persona/description） | 成员自己提议 | **人审**（不自动） | `agent.definition.proposed` → `approval.requested` → `agent.definition.applied` | P1 |
| A2 | 改**同伴**的人设 | 仅人在 UI；模型一律**禁止**（保留现有 intent 闸门） | 人 | 同上 | 保持 |
| A3 | 增/改 **skill**（提议） | 房间成员（`collaboration_propose_capability`） | **人审** | `capability.candidate.proposed/decided` | P0 |
| A4 | 启用/绑定 skill 到 Agent | 人 / model track | 人审 + `allowed-tools` 扩权二次审批 | `skill.version.created` / `agent.version.created` | P1 |
| A5 | 写/改**自己**的记忆（L-bot） | 成员自己提议 | 人审（P2） | `memory.change.proposed/decided` | P1 |
| A6 | 写**群**记忆（L-room 决定摘要） | 协调员/人 | 自动（带 `sourceMessageId`） | `memory.change.proposed(autoApprove)` | P1 |
| A7 | 提升记忆到 workspace/global | 人 / model track | 人审 + 影响面提示 | 现有 `memory.change.*` | P2 |
| A8 | 改**触发条件**（routine/automation） | 人；房间成员可**提议** | 人审；**默认 paused**（对齐 Grok Bot `update_state target "routine"` 要求 `enabled=false`） | `routine.candidate.proposed` / `routine.enabled` | P2 |
| A9 | 装插件 / 扩权（MCP、allowed-tools） | 人；房间成员可**提议** | **必须先问再动**（对齐 Grok Bot：不许同轮偷跑） | `plugin.install.requested/applied` | P2 |
| A10 | 加/移成员、换协调员 | **仅人** | 用户操作即批准；保留 `member_busy` 等闸门 | **新增** `collaboration.member.changed` 事件（补 D8） | P0 |
| A11 | 改模型/系统提示/harness/权限模型 | **任何人都不行**（保留现状） | — | — | 永久红线 |

### 5.3 审计最小集（事件类型）

```
collaboration.member.changed     { roomId, action:'add'|'remove'|'role'|'coordinator', memberId, byMemberId, topologyRevision }
collaboration.onboarding.created { roomId, subjectMemberId, packetId, topologyRevision }
capability.candidate.proposed    { candidateId, kind, subjectType, subjectId, proposedByMemberId, runId, evidence }
capability.candidate.decided     { candidateId, decision, decidedBy }
agent.definition.proposed/applied{ agentId, fromVersionId, toVersionId, fields[], byMemberId }
memory.change.proposed/decided   { changeId, targetScope, subjectType?, subjectId?, autoApprove }   // 已有雏形
routine.candidate.proposed       { automationsDraftId, enabled:false }
plugin.install.requested/applied { serverId, requestedByMemberId }
```
每条事件都要能被"谁、何时、凭什么证据、谁批的"四问答上——这是 Grok Bot 的 `person` 级登记（`docs/research/grok-bot/03…§0` 事实 2）给我们的最小对齐。

---

## 6. 阶段负责人交接 + 新成员不打断在途工作

### 6.1 现状的交接语义（已具备的部分）

- **一个工作项 = 一个负责人**：`CollaborationTask{assigneeMemberId, purpose, deliverable, returnTo, dependsOnTaskIds}`（`packages/shared/src/types/collaboration-chat.ts:136-164`）。
- **同一阶段内的交接 = 派新任务**：协调员用 `collaboration_dispatch_tasks`（仅 `purpose==='coordination'` 可用，`runtime.ts:27311`），成员不得再派工（worker 的 `dispatch` 被拒）。
- **咨询式交接**：`collaboration_send_message{expectsResponse:true}` → 只读 consultation → 源 attempt 释放资源并挂 `awaitingPeerTaskIds`，等对方 attempt 结束后**在同一任务上续做**（ADR 0004 amendment：66-69；`packages/shared/src/types/collaboration-chat.ts:190-192`）。
- **串行/依赖**：`compileCollaborationWorkflow` 默认按 `strategy==='serial'` 串成 `stage-N` 链（`collaboration-workflow.ts:19-42`），依赖失败有 `waitReason='dependency_failed'`（`…collaboration-chat.ts:170`）。
- **失败/移除的可观测性**：`waitReason` 含 `dependency_failed / resource_busy / capacity / member_removed / loop_limit / room_paused / peer_reply`（同上）。

**缺**：
- H1（P0）没有"阶段负责人"这个**一等对象**：谁是当前阶段 owner 只能从 `task.assigneeMemberId` 反推；`handoff.stageOwnerMemberId` 需要由宿主算出并写进入群包（§2.3 ⑦）。
- H2（P1）没有**交接物**：交接=一条任务指令，没有"交接清单"（已完成/已知坑/不要重做）。
- H3（P1）没有"接活确认"：新成员是否读过入群包/产物**不可验证**（D6）。

### 6.2 目标：交接两件套

```jsonc
// HandoffNote v1 —— 由当前 owner 在交出阶段时提交（工具：collaboration_handoff）
{
  "roomId": "…", "fromMemberId": "agent:A", "toMemberId": "agent:B",
  "taskId": "…", "artifactId": "…",                 // 交出时已交付的产物
  "done":    [ "设定集 v0 已交付（art_…）" ],          // ≤5 条，每条 ≤200 字符
  "open":    [ "第 3 章未写；主角动机待确认" ],
  "doNotRedo": [ "art_…" ],                          // 与新成员入群包的 doNotRedo 同源
  "knownPitfalls": [ "上排标签有 transform 卡顿，别用测量布局" ],
  "acceptance": "B 在下一个 attempt 里至少引用 art_… 与 1 条 knownPitfalls",
  "createdAt": "…"
}
```
- `collaboration_handoff` 只允许**当前 assignee** 调用；写入 `CollaborationMessage{kind:'system'}` + 新成员入群包。
- 交接完成的判定：接手方在下一个 attempt 的 `contextManifest` 里出现 `handoffNoteId`，且其产出引用了 `doNotRedo` 之外的产物（见 §8.2）。

### 6.3 加入不打断在途工作的四条不变量

| # | 不变量 | 现状 | 要做的事 |
|---|---|---|---|
| I1 | **不抢在途工作**：加入不得改变任何 running/queued attempt 的 assignee | ✅ 已满足（`updateMembers` 不碰 tasks） | 加断言测试 |
| I2 | **不重派已完成**：新成员不得被派去重做 `checkpoint.completedTaskIds` / `doNotRedo` 覆盖的产物 | ❌ 无机制 | 入群包 `doNotRedo` + 派发前校验（`collaboration_dispatch_tasks` 加一条拒绝：目标产物已在 `doNotRedo` 中） |
| I3 | **不打断协调权**：有待跑任务时换协调员仍被拒 | ✅ `coordinator_busy`（`collaboration-chat-host.ts:547`） | 保持；把错误文案升级为"有 N 项在途工作" |
| I4 | **可回滚加入**：入群包与成员行加 `topologyRevision`，移除即整体失效 | ⚠️ 部分（软删 + CAS） | 入群包 `stale` 判定（§2.2）+ 移除时把相关 packet 标记 `revoked` |

---

## 7. 改造清单（分阶段）

### P0（"新人能用"最小闭环）

| # | 改动 | 文件/表 | 说明 |
|---|---|---|---|
| P0-1 | 新增 `OnboardingPacket` 类型 + 生成器 `buildOnboardingPacket(snapshot, member)` | `packages/shared/src/types/collaboration-chat.ts`、`apps/runtime/src/task-room.ts` | §2.3 字段 |
| P0-2 | `updateMembers` 在加成员/加团队后生成入群包（system 消息 + 挂到成员行） | `apps/runtime/src/collaboration-chat-host.ts:552-564, 578` | 同一事务 |
| P0-3 | `buildTaskRoomContext` 注入 `<onboarding_packet>`，带 `stale` 判定 | `apps/runtime/src/task-room.ts:56-93` | 仅当收件人是该成员 |
| P0-4 | 新增 `collaboration.member.changed` 事件 + 成员变更的 UI 提示 | `apps/runtime/src/collaboration-chat-service.ts`、桌面 shell | 补 D8 |
| P0-5 | **修复角色冻结**：`addAgentIds` 命中已存在成员时刷新 `name/role/avatar`（与 team 路径一致），并在 `roleSource` 记 agentVersionId | `collaboration-chat-host.ts:560-564` | 修 D2 |
| P0-6 | 新增房间内"提议"工具 `collaboration_propose_capability`（只写 `pending`） | `apps/runtime/src/chat-tools.ts`（新 schema）、`runtime.ts:27296-27318`（房间白名单） | §3.3 ② |
| P0-7 | 房间内允许**只读**的记忆注入开关（默认 `isolated`，行为不变） | `runtime.ts:25050` | §4.4 开闸条件 3 |
| P0-8 | 新增 `capability_candidate` 表（或 `skill_version.enabled=false` + 证据列） | `packages/storage/src/schema/`（新文件）+ 迁移 | §3.3 |

### P1（交付质量与可验证）

| # | 改动 |
|---|---|
| P1-1 | `HandoffNote` + `collaboration_handoff` 工具（§6.2） |
| P1-2 | 入群包 `readReceipts`：`collaboration_read_context` 支持 `onboardingAck` 参数，回报已确认段 |
| P1-3 | 三级记忆提升（P1/P2/P3）+ 证据指针校验（§4.3） |
| P1-4 | 恢复/新建**记忆与能力审批面板**挂载点（`MemoryDiagnosticsPanel` 现只在 `.bak`） |
| P1-5 | 派发前 `doNotRedo` 校验（I2） |
| P1-6 | `decisions[]` 的来源：目标确认 + 人工标记决定（复用 `kind:'system'` 消息） |

### P2（长期成长）

| # | 改动 |
|---|---|
| P2-1 | `capability_usage_event` 回灌报表（哪些 skill 真有效） |
| P2-2 | routine/自动化提议 + 默认 paused（A8） |
| P2-3 | 插件/MCP 扩权的"先问再动"（A9，对齐 Grok Bot `WA` 指令） |
| P2-4 | 房间级 skill 建议：入群包带 `suggestedSkills[]`（只建议不绑定） |

---

## 8. 可测验收标准

### 8.1 入群包（结构 + 行为）

V1. `updateMembers{addAgentIds:[B]}` 后，同一快照里存在**恰好一条** `OnboardingPacket{subjectMemberId:'agent:B', topologyRevision: N+1}`，且 `room.messages` 里出现一条 `kind:'system'`、`recipientMemberIds:['agent:B']` 的消息。
V2. 未参与的房间成员（A）在下一个 attempt 的注入文本里**不含** `subjectMemberId:'agent:B'` 的 packet（`buildTaskRoomContext` 输出断言）。
V3. packet 必填字段全部非空：`goal.text / roster(≥1 且含 isSelf) / readScope.crossRoomAccess===false / handoff.stageOwnerMemberId / readReceipts.required.length>0`。
V4. `goal.text` > 2000 字符时 `truncated===true` 且 `fullReadHint` 存在；`collaboration_read_context(kind='brief')` 能取到全文。
V5. **staleness**：生成 packet 后再 `updateMembers`（`topologyRevision` 变化），下一个 attempt 注入的 packet `stale===true`，且注入文本含"名册已变更"。
V6. 预算守卫：packet 序列化后 ≤ **8,000 字符**（超出则按 `decisions → artifacts → roster` 顺序截断并写 `*Omitted` 计数）；注入后 `contextManifest` 增加 `onboardingPacketId`。
V7. 幂等：同一 `topologyRevision` 下重复触发不产生第二条 packet（receipts 去重）。

### 8.2 "新成员不犯错"（可测定义）

把"不犯错"拆成**四条可断言的行为**，每条都要有正/反测试：

| 断言 | 测法 | 反例（必须失败） |
|---|---|---|
| **N1 不重做**：新成员的首个 attempt 不得对 `doNotRedo` 里的 artifact 触发 `collaboration_submit_artifact` 覆盖同名产物 | 让 fake provider 在首轮就尝试提交同名 artifact → 期望被拒（错误码 `collaboration.artifact_already_current`） | 不注入 packet 时同一脚本必须能提交成功（证明闸门来自 packet） |
| **N2 不越权**：新成员首个 attempt 内 `readScope` 之外的动作被拒 | 注入 `writeAllowed:false`，脚本调用 `write_file` → 期望 `task_room.directory_outside_workspace` 或权限拒绝 | `writeAllowed:true` 场景应放行 |
| **N3 认领正确阶段**：新成员首个产出必须引用 `handoff.stageOwnerMemberId` 或 `openTaskIds` 中至少一项 | 断言首个 artifact 的 `contextRefs` 与 attempt 的 `contextManifest.messageIds` 命中 | 若模型产出与该阶段无关内容（用 fixed fixture 模拟），验收脚本必须标记失败 |
| **N4 交接可验证**：`handoffNote.knownPitfalls` 至少 1 条被接手方在下一步引用（写入 `contextRefs` 或消息文本匹配） | 组装 `HandoffNote` + 接手 attempt，断言引用命中率 ≥ 1/条 | 不注入 `HandoffNote` 时命中率应为 0 |

**整体指标（可入库看板）**：
- `redundant_work_rate` = 被判"与既有产物重复"的 artifact 数 / 总 artifact 数（目标：引入入群包后下降 ≥50%）。
- `handoff_ack_rate` = 首轮 attempt 中 `readReceipts.acknowledged` 覆盖 `required` 的比例（目标 ≥90%）。
- `stale_role_incidents` = `roleSource` 与当前 agentVersion 不一致且被派活的次数（目标 0，修 D2 后）。

### 8.3 技能沉淀 / 记忆提升

- C1：房间内调用 `collaboration_propose_capability{kind:'skill'}` → 产生 `capability_candidate{approvalState:'pending'}`，且**不产生** `skill_version`（断言表行数不变）。
- C2：房间内调用 `create_skill`/`update_skill` → 返回拒绝文案（`collaboration-policy.ts:133-141` 的既有错误串）而非静默成功。
- C3：人在房间外 approve 候选 → 生成 `skill_version{originType:'derived', enabled:true}`，`evidence.runId/artifactId` 落库可查。
- C4：reject → `approvalState='rejected'`，`skill_version` 仍为 0 行。
- M1：房间内写记忆 → 只产生 `pending` change，`memory_entry` 不变（沿用现有 `decideChange` 语义，`memory-store.ts:325-354`）。
- M2：`room → bot` 提升被拒（除非人批）；批准后可被**另一个房间**读到（正向断言注入文本包含该条）。
- M3：`rollbackChange` 后条目回到提升前版本（复用现有实现，`memory-store.ts:534-605`）。

### 8.4 能力矩阵与审计

- A1：`create_agent` 在房间中**仅当**用户原文匹配 `agentManagementIntent` 才出现在工具目录；`delegated=true` 的 run 里**永不出现**（`agent-management-intent.ts:10`）。
- A2：`collaboration.member.changed` 事件数与 `updateMembers` 成功次数一致（含 `add/remove/role/coordinator` 四种 action）。
- A3：审计四问可答：任取一条 A1–A9 动作，事件里能查到 `byMemberId / 证据 id / approvalId / decidedAt`。

---

## 9. 风险与"不照搬"清单

| # | 不照搬 Grok Bot 的做法 | 理由 |
|---|---|---|
| 1 | **不回放历史**（Grok Bot 无回放） | 我们有本地 SQLite 与分页读，成本可控；回放有界历史（24 条/12k）正是我们的优势，应保留并把它升级为入群包 |
| 2 | **不做全量覆盖成员表**（`SetGrokBotRoomMembers`） | 已经用增量 + 软删 + CAS，更好；保持 |
| 3 | **不允许房间内静默写资产** | Grok Bot 的 `update_state target "skill"` 按 setup 提示词要求"quietly"完成（`docs/research/grok-bot/03…§3.3`），审计性差；我们强制 `pending` |
| 4 | **不把 routine 建成启用态** | 对齐 Grok Bot 的 `enabled=false` 默认（`03…@707692`），但我们要**人审**而不是"纯文本问一句" |
| 5 | **不引入服务端权威编排**（本地优先） | OV3 已定本地等价物；本节所有新增都落在本地 SQLite + 事件 |
| 6 | **不让模型自报 intent** | 沿用宿主正则判定（`agent-management-intent.ts`），任何"我打算改人设"的自述都无效 |

**主要风险**：
- 入群包与 `checkpoint`/`contextManifest` 三份派生数据若不同步会产生"叙事不一致"——因此 packet 必须**由同一快照一次生成**，且带 `topologyRevision` 做失效判定。
- `decisions[]` 若靠模型总结会产生幻觉 → 首版只允许"用户确认目标 + 人/协调员显式标记"，并强制 `sourceMessageId`。

---

## 10. 未证实清单

1. **记忆审批在界面上到底有没有活口**：`MemoryDiagnosticsPanel`/`ApprovalCenterPanel` 只在 `.bak` 入口与设计系统 showcase 被引用；未找到当前 shell 的挂载点，但**不排除**通过其它动态入口（设置页/活动中心）暴露 → 标注未证实，改造前需一次人工确认。
2. **房间的 `track` 取值**：`create()` 按 team/agent 写 `target.track`（`collaboration-chat-host.ts:524-526`）；房间运行时的实际 `run.track` 未逐路径验证（影响 D3 的精确措辞：是 'team' 还是 'agent'，两者都在 `!= 'model'` 之外，结论不变）。
3. **`capability_usage_event` 是否真被写入**：表与索引存在（`schema/capability.ts:30-59`），未找到生产路径的写入点（只在测试与迁移里出现）→ 审计能力可能同样是"半成品"。
4. **`skill_publish_draft` 的使用方**：表存在，未确认 UI/流程是否接入。
5. **Grok Bot 侧"新人首轮是否补全积压"**：`docs/research/grok-bot/04…§12.1` 已标未证实；本文件的入群包设计**不依赖**该结论。
6. **`member.role` 冻结是否会导致实际派工错误**：已证"名册串不刷新"（D2），但"因此派错活"的具体事故样本未采集（推断）。
7. **在途改动的影响**：本文件实测期间 `apps/runtime/src/{collaboration-chat-host,task-room,runtime,chat-tools}.ts` 与 `packages/shared/src/types/collaboration-chat.ts` 正在被修改；若这些改动涉及成员/上下文/工具面，本文的"现状"结论与行号需在改造开工前**再复核一次**。

---

*本文件只读分析 `apps/`、`packages/`、`docs/adr/`，未修改任何既有文件。复现命令模式：`grep -n "updateMembers\|topologyRevision" apps/runtime/src/collaboration-chat-host.ts`、`grep -n "AGENT_LIBRARY_TOOLS" apps/runtime/src/collaboration-policy.ts`、`grep -rn "listMemory" apps/desktop/src/renderer/`。*
