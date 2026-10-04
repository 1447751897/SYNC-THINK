# OV1 · 现状架构批判：SYNC-THINK 多智能体协作的真实执行模型与缺陷清单

- 任务：`task-7`（OV1 现状架构批判）
- 日期：2026-10-01（Asia/Shanghai）
- 立场：用户已明确要求**推翻现有实现**。本文不为现有设计辩护；凡有代码证据的缺陷一律直说。
- 严重度：`P0` = 功能或可靠性已经断裂，必须立刻修/重写；`P1` = 稳定造成错误结果或停摆；`P2` = 体验、扩展性、可运营性问题。
- 证据分级：【代码】= 本仓库可复核的源码行；【数据】= 持久化数据/测试夹具；【推断】= 由代码结构推出但未运行验证；【未证实】= 无法从本地证据判定。

## 0. 版本钉子（必须先读）

审计期间 **`apps/` 正在被并发修改**，本文的行号只在下列快照上成立（hash 于 2026-10-01 11:16:04 计算，**以 sha256 为权威锚点**，mtime 仅供参考——审计中已观察到同一文件的行内容在 mtime 未变的情况下发生差异）：

| 文件 | sha256（前 16 位） | 最后修改 |
|---|---|---|
| `apps/runtime/src/collaboration-chat-service.ts` | `fb6b65f27aa5bf97` | 2026-10-01 11:12:12 |
| `apps/runtime/src/collaboration-chat-host.ts` | `d15b20d7ae2a15bb` | 2026-10-01 11:12:37 |
| `apps/runtime/src/task-room.ts` | `241cf6f8caf453cd` | 2026-10-01 11:13:02 |
| `apps/runtime/src/runtime.ts` | `b141bda15f83452f` | 2026-10-01 11:12:37 |
| `apps/runtime/src/persistence.ts` | `7a608f7cfbe267ae` | 2026-09-28 22:36:16 |
| `apps/runtime/src/collaboration-workflow.ts` | `af46993130b1406e` | 2026-09-30 23:59:03 |
| `packages/storage/src/collaboration-store.ts` | `816b0834d689e884` | 2026-09-20 23:10:52 |
| `packages/shared/src/types/collaboration-chat.ts` | `1dcda6bab815974b` | 2026-10-01 11:11:21 |

- 我在 11:11 读到的 `collaboration-chat-service.ts` 是 1185 行，11:12 后被改到 1189 行；`collaboration-chat-host.ts` 从 617 行改到 626 行。**本文所有行号已按上表快照重新校对**；若文件继续变化，请以"符号名 + 行号"双锚点复核（附录 A）。
- 这次并发修改已经在改本文批评的对象（例如新增 `CollaborationTask.workflowStartAllowed`，`packages/shared/src/types/collaboration-chat.ts:138`、`collaboration-chat-service.ts:233`、`runtime.ts:27311`）。因此**"要推翻的现状"本身没有被冻结**，任何重写立项都应先把 revision 冻住（见附录 C）。

## 1. 一句话结论

**现有实现不是"多智能体协作"，而是一个"以房间快照为唯一真相的单写者任务队列，外面套了一层聊天皮"**：人类消息只能唤醒一个路由器（coordinator），coordinator 派工时把工作固化成 `CollaborationTask`，每个 task 由一个以"只读研究员"身份运行的 worker 执行，产出必须回交 artifact；成员之间除"只读咨询"以外的任何自主通信都被结构性禁止。
它与 Grok Bot 的根本分歧不在参数（并发数、预算、@ 语法），而在**"谁决定下一个发言者"**：Grok Bot 把编排放在服务端的 turn 编排器里，把"本轮轮到谁"作为一次可幂等的 RPC 派发给成员，并允许成员用 `PASS` 显式弃权；SYNC-THINK 把编排放在客户端 runtime 里，用"@优先 → 回复作者 → 唯一负责人 → coordinator"的确定性规则决定唤醒对象，成员连"我不该说话"都无法表达。

---

## 2. 执行模型还原

### 2.1 参与对象与持久层

| 对象 | 定义位置（校对时） | 说明 |
|---|---|---|
| `CollaborationConversation` + `TaskRoom` | `packages/shared/src/types/collaboration-chat.ts:56-68`、`:36-55` | 房间 = 一个长期目标；`room.state` 是该目标的执行生命周期 |
| `CollaborationMember` | `:10-21` | `user` / `assistant` / `agent` / `team`；小队内部成员带 `teamParticipantId` |
| `CollaborationMessage` | `:73-91` | 共享消息表：`correlationId` / `causationId` / `hopCount` / `sequence` / `expectsResponse` / `mentions` |
| `CollaborationDelivery` | `:92-99` | 每条消息 × 每个收件人一条投递记录：`queued/processing/processed/failed/cancelled` |
| `CollaborationTask` | `:136-163` | `kind: task|reply|summary`；房间内另有 `purpose: discussion|work|coordination`；`workflowStartAllowed`（新，`:138`） |
| `CollaborationAttempt` | `:165-201` | 每次执行一个 attempt；`waitReason`（`:170`）表达"卡在哪" |
| 持久化 | `packages/storage/src/collaboration-store.ts:68-135` | 整个快照一个事务读写；每类实体一张 JSON 行表 |

房间快照是全量对象（`:202-212`）。**没有事件溯源、没有增量日志、没有 turn 概念。**

### 2.2 主调用链：用户在群里发一句话

1. **渲染层** `apps/desktop/src/renderer/shell/CollaborationChatView.tsx:202-220` `send()`
   - `outbound = serializeAgentMentions(draft)`（`collaboration-mentions.ts:17-29`）→ `recipients` **只来自编辑器内联 token**；手打 `@名字` 不产生收件人。
   - `command({ action:'send', clientRequestId, text, intent, mentions, recipientMemberIds: recipients, replyToMessageId })`（`CollaborationChatView.tsx:212`）。
2. **IPC/RPC** `apps/desktop/src/main/runtime-client.ts:814` → frame `collaboration.command` → `runtime.ts:2720-2723` → `runtime.ts:19573-19620` `handleCollaborationCommand` → `collaborationChatHost.command(...)`（`runtime.ts:19598` 一带）。
   - 渲染层在写命令前做版本门禁（`use-collaboration-chat.ts:88`，要求 `executionVersion === 5`）；超时后**不重发**，而是 `get` 查 receipt（`:94-100`）。
3. **Host 分支** `collaboration-chat-host.ts:182-348`
   - `case 'send'` → `service.send(command, actorMemberId, undefined, execution)`（`:252`）；渲染层调用时 `actorMemberId === undefined`，即"人类身份"。
   - `get`/`list`/`activity` 直接返回，**不触发调度**（`:251`、`:214-219`）。
4. **Service.send** `collaboration-chat-service.ts:137-242`（由 `mutate` 包成单事务）
   - `sender` = 唯一 `kind==='user' && active` 成员（`:1160-1164`）。
   - 幂等：`duplicate(...)`（`:147`），键 `send:<clientRequestId>`（`:1111-1122`）。
   - 路由（`:162-170`）：
     `targets = recipientMemberIds?.length ? 那些 : mentions?.map(memberId)`（`:162`）；
     `replyTarget` = 被回复消息的作者（与发送者不同且 active，`:163-164`）；
     `pending` = 处于 `queued|running|waiting_input` 的非咨询 `task` 的执行者（仅"人类新话题且非 work 意图"时计算，`:165-168`）；
     `routed = targets ?? [replyTarget] ?? (pending.length===1 ? pending : undefined)`（`:169`）；
     `recipients = this.recipients(draft, sender, routed)` → **routed 为空时默认 `[coordinatorMemberId]`**（`:1039-1046`，默认在 `:1040`）。
   - 咨询环路校验（`:172-178`）。
   - work 意图门槛（`:179-185`）：`work = room && intent==='work'`（`:179`）；agent 不得声明 work（`:180`）；房间非 running 时 `task_room.resume_required`（`:181`）；首次 work 写 `room.goal` 并置 `state='running'`（`:183`）。
   - `@` 校验（`:186-197`）：mention 必须在 `recipients` 内、偏移递增、`text.slice(start,end)===label`，否则整条消息抛 `collaboration.invalid_mention`（`:193`）。
   - 消息信封（`:198-212`）：`correlationId = causation?.correlationId ?? 新id`，`causationId = causation?.id`，`hopCount = causation ? causation.hopCount+1 : 0`（`:211`），`sequence` 自增（`appendMessage`，`:1012-1022`）。
   - 自动消息预算：`enforceLoopBudget`（`:213`、`:1069-1071`）。
   - 新增标记：`room && !automatic && intent==='chat' && recipient 是 coordinator` → `task.workflowStartAllowed = true`（`:233`）。**只有被路由到 coordinator 的那条讨论任务才携带"可以开工"的授权。**
   - 房间内同 Agent 去重发生在**消息写入之后**（`:215-218` 的 `recipients = recipients.filter(...)`，而消息本体已在 `:198-213` 用未去重的 `recipients` 构造完毕）→ 见 D14。
   - 逐收件人建任务（`:219-236`）：`expectsResponse=false` 或收件人是 user → 直接写一条 `processed` 投递（`:221`），**不唤醒**；否则 `addTask(...)`。
     房间内的 purpose 判定（校对时修订版，`:224-232`）：
     `coordinates = work && (收件人是 team || (收件人是 coordinator && 群里还有别的活跃非用户成员))`；
     `purpose = work ? (coordinates ? 'coordination' : 'work') : 'discussion'`，`kind = work ? 'task' : 'reply'`；
     只有 `work && !coordinates` 才挂 document 交付合同（`:231`）。
     即"用户明确要求开工 + 路由到协调员 + 群里有其他成员"会得到一个**协调任务**（无交付物，靠 coordinator 自己派工收口）。
5. **调度** `schedulePump(workspaceId)`（`:240`、`:1145-1152`）→ `setImmediate` → `pump()`（`:581-598`）：列出该 workspace 全部房间的 `queued` attempt，**轮转**逐个 `claim()`。
6. **准入 claim**（`:671-739`，单事务）
   - `waitReason` 顺序：`room_paused` → `member_removed` → `peer_reply` → `dependency_failed` → `dependency` → `capacity` → `resource_busy`（`:683-700`）。
   - **容量**：`limit = Math.min(3, policy.maxConcurrent)`（`:691`），统计口径是整个 workspace（`:690`、`:1073-1088`）。
   - 通过后写 `running / ownerId / startedAt / contextSequence / resourceClaims / contextManifest`（`:717-732`），投放置 `processing`（`:731`）。
   - `dependency_failed` 与"咨询被撤回"在此**不发执行**直接判失败（`:701-709`）。
7. **执行 start**（`:741-766`）→ `ports.execute` → `CollaborationRunStarter.start`（`collaboration-chat-host.ts:56-58`）→ `runtime.ts:21304-21383` `executeCollaborationTaskForHost`
   - `threadId = attempt.threadId ?? ${conversationId}:${taskId}`（`:21308`）→ 同一 task 的所有 attempt 复用同一 provider thread。
   - `readOnly` = 非 task 或全部 claim 为 read（`:21331`）。
   - 注入上下文：房间走 `buildTaskRoomContext`（`task-room.ts:56-94`），非房间走 `buildCollaborationExecutionContext`（`collaboration-workflow.ts:46-99`）。
   - `purpose==='coordination'` 强制 `readOnly`（`:21347` 一带，`delegatedReadOnly = true` 在 `:21350`）；readOnly 时收敛工具目录（`:21349-21353`）。
   - **文件交付在只读时直接失败**（`:21355`）→ 见 D1。
   - `executeKernelRun(runId)`（`:21363` 一带），进度回灌 `acceptProgress`（`:600-631`）。
8. **收尾 finishExecution**（`:768-825`）：超时/暂停/关停/取消/错误/咨询等待/缺交付物/成功；写 `task_result` 与投递（`:942-960`）；房间更新 `workStatus` 与 checkpoint（`:817-821`）；`queueSummaries`（`:902-940`）→ 房间走 `queueRoomFollowups`（`:369-396`）。
9. **再唤醒**（`:369-396`）：按 `rootTaskId` 找 `purpose==='coordination'` 的根；当该组**全部** attempt 终态时，给根任务执行者插入 `system` 消息 + 一个 `purpose='coordination'` 的 follow-up（"负责人检查成员成果"，`:391`），receipt `room-followup:<root>:<signature>` 保证一次（`:380-382`）；预算不足 → `room.state='paused'`（`:389`）；全组终态 → `room.state='review'`（`:394`）。

### 2.3 状态机

#### 房间状态机（`TaskRoomState`，`packages/shared/src/types/collaboration-chat.ts:36`）

```
discussion ──(send intent=work / dispatch / start-workflow)──▶ running
running ──(全部 room work 终态)──▶ review ──(room-complete)──▶ completed
running/review ──(room-pause)──▶ pausing ──(所有 ACTIVE attempt 落地)──▶ paused
任意 ──(自动消息预算耗尽 queueRoomFollowups:389)──▶ paused
任意 ──(崩溃后 recover():651)──▶ paused（附 note）
paused ──(room-resume)──▶ running | discussion      （:338-353，重置 autoContinueAfterSequence）
completed ──(room-brief)──▶ discussion              （:328）
```

关键约束：
- `room-resume` 要求 **`active.length === 0` 且 `state !== 'pausing'`**（`collaboration-chat-service.ts:339`，`task_room.still_stopping`）。`active` 包含 `stopping`（`:93`、`:322`）→ 见 D6。
- `room-complete` 要求没有 `queued|failed|interrupted` 的非咨询工作（`:355`）。
- `room-brief` 用乐观 revision 校验（`:324`），并要求先暂停（`:325`，注意 `||` 与 `&&` 优先级：`active.length || (queued && running)`）。

#### Attempt 状态机

```
queued ──claim──▶ running ──┬─▶ succeeded ──(本 attempt 发起过咨询)──▶ 同 task 新 attempt(waitReason=peer_reply)
                            ├─▶ failed（timeout / result.error / deliverable_missing:808）
                            ├─▶ cancelled（cancel / stopping）
                            ├─▶ interrupted（pause / shutdown，:782）
                            └─▶ stopping ──▶ cancelled | interrupted
queued ──claim 判定──▶ failed（dependency_failed / consultation_unavailable，:701-709）
```

- `waiting_input` 是**死状态**：`CollaborationProgress.status` 有 `'waiting_input'`（`:39`），但全仓（含生产装配）**没有任何写入点**；`executeCollaborationTaskForHost` 只发 `status:'running'`（`runtime.ts:21361` 一带）。见 D13。
- attempt 只能通过 `finishExecution`（`:768`）离开运行集，而它只在 `ports.execute` 的 promise 落地时被调用（`:751-758`）。见 D5。

#### Task 状态机（隐式）

只有 `workStatus`：`open → in_progress → in_review | waiting → done`（`:723`、`:818`、`:358`）。"任务卡在哪"需要交叉读 `attempt.status` + `attempt.waitReason` + `task.workStatus` 三个字段。

### 2.4 唤醒与收敛规则表

| 触发 | 被唤醒者 | 代码（校对时） |
|---|---|---|
| 人类消息 + `@A @B` | A、B 各建一个 `reply` 任务（并行、互不可见） | `:162`、`:219-236` |
| 人类消息，无 @，恰好 1 个未终态任务 | 那个任务的执行者 | `:165-169` |
| 人类消息，无 @，0 或多个未终态任务 | coordinator（并可能带上 `workflowStartAllowed`） | `:1040`、`:233` |
| 人类"回复"某条消息 | 被回复消息的作者 | `:163-164` |
| 人类 `intent='work'` | 收件人建 `task`；若收件人是 team 或"coordinator + 群里还有别的成员"则是 `coordination`（无交付物），否则是 `work`（document 交付合同） | `:179-185`、`:224-232` |
| agent 发消息且 `expectsResponse` 缺省 | **不唤醒任何人**（房间内自动消息默认通知） | `:171` |
| worker 任务完成 | coordinator 获得一次 follow-up 检查任务 | `:369-396` |
| 全部 room work 终态 | 无自动动作，停在 `review` 等人类验收 | `:394` |
| 自动消息预算耗尽 | 房间 `paused`，等人类点"继续" | `:389` |

---

## 3. 角色 / 权限模型的代价（逐条）

### 3.1 coordinator 唯一且是唯一路由器

- 实现：`recipients()` 默认 `[coordinatorMemberId]`（`:1039-1046`）；`purpose='coordination'` 只在两处产生——`send` 的 `coordinates` 判定（`:224-230`，收件人是 team 或"coordinator 且群里还有别的成员"）与 `queueRoomFollowups` 的 follow-up（`:391`）；派工工具只对 `purpose==='coordination'` 开放（`runtime.ts:27313`、`:27304-27320`）。
- **排除的场景**：
  1. "让 B 直接问 C 要一个数据"——B 只能发 `expectsResponse` 咨询，且 C 的回答**不能变成工作**（咨询未回落前 `submit_artifact`/`dispatch` 被硬拦：`runtime.ts:27349-27354` 一带）。
  2. "A 发现问题，直接把有界工作交给 B"——必须回 coordinator 转一手；coordinator 不在 running/waiting_input 时**无法派工**（`collaboration-chat-host.ts:289-293`）。
  3. "多人对同一问题的持续讨论"——没有轮次概念，每条消息独立建任务，讨论退化成并行各说各话。
  4. 小队内部自主分工——`teamParticipantId` 成员不得再派发（`task-room.ts:80` 的 prompt + `runtime.ts:27313` 的 purpose 门槛 + `collaboration-workflow.ts:93`）。

### 3.2 workers 不可再派工

- 实现：房间内 `isTaskRoomToolAllowed` 禁用 `agent_run / agent_delegate / agent_send_message / agent_send_task / collaboration_send_direct_message`（`runtime.ts:27299`）；`collaboration_dispatch_tasks` 仅 `purpose==='coordination'`（`:27313`）。
- **代价**：现实协作里"执行中才发现需要另一个专家/另一份材料"是常态。唯一出口是"结束本轮 → 宿主唤醒 coordinator → coordinator 再派工"，即**至少多一个完整模型回合**，且受 12 条自动消息预算限制（`:1065-1066`）。发现问题的上下文在交接时已经丢掉。

### 3.3 `allowGroupMessages` vs `allowPeerDirect`

- 实现：`groupMessageAllowed`（`:1048-1052`）允许 user、coordinator、自己、`recipient.teamParticipantId === sender.id`，或 `policy.allowGroupMessages ?? policy.allowPeerDirect`；私聊是另一条链路（`collaboration-chat-host.ts:444-486`、`:587-618`），受父群 `allowPeerDirect` 控制（`:235-241`、`:595` 一带）。
- **代价**：这个拆分（2026-10-01 amendment，`docs/adr/0004-task-room-execution.md:59-71`）解决的是"关私聊别误伤群内咨询"，但**没有解决**"成员之间能不能自己开始一段协作"。群内对等通信仍只有 `expectsResponse` 二值：`true` = 建只读咨询任务；`false` = 记录一条永远不会唤醒对方的文本。**不存在"我请你做一件小事"这条中间态。**

### 3.4 `recipients` 无 @ 时默认进 coordinator

- 实现：`:1039-1046`；`workflowStartAllowed` 只在收件人是 coordinator 时挂上（`:233`）。
- **代价**：
  1. 手打 `@名字` 无效（只有编辑器 token 才算），用户以为点名了，实际消息进了 coordinator。
  2. 恰好 1 个未终态任务时消息改投那个执行者（`:165-169`）——**同一句话在不同时刻去不同的人**；更糟的是：这条任务**不带 `workflowStartAllowed`**（`:233` 要求收件人是 coordinator），于是"开工"这句话在路由改投时**静默失去授权**，模型只能按 `task-room.ts:77` 的 prompt 回复"请提示用户点击开始团队工作"。
  3. coordinator 是单点：被移除后 `queueRoomFollowups` 只写 `receipts[...]='member_removed'` 就静默跳过（`:385`），房间不暂停、不报警。

---

## 4. 并发 / 串行真相

### 4.1 串行点

| 串行点 | 位置 | 作用域 | 后果 |
|---|---|---|---|
| `pump()` 的 `pumping` 标志 | `collaboration-chat-service.ts:582`、`:128` | 进程内单 service | 一次只有一个准入循环 |
| 每次 `mutate` 的 SQLite 事务 | `collaboration-store.ts:71-73`、`collaboration-chat-service.ts:1124-1143` | 全库写锁 | 所有命令串行落盘 |
| 容量上限 `min(3, maxConcurrent)` | `:691`；上界 `:1102` | **workspace** | 全部房间合计最多 3 个 attempt 同时在跑 |
| `resource_busy`（非 task 同类消息） | `:693-696` | 同房间同成员 | 同一成员的 `reply` 串行 |
| 资源 claims 冲突 | `:697-700`；claims 生成 `collaboration-chat-host.ts:136-141` | workspace 内 | 文件交付任务共享 `external-tools` 写锁 → 全 workspace 文件交付串行 |
| `external-tools` 键无 room 后缀 | `collaboration-chat-host.ts:140` | workspace 内所有房间 | 两个房间只要都写文件就不能并行 |

### 4.2 并行点

- 同一 workspace 最多 3 个 attempt 真正并行（不同房间/不同成员/claims 不冲突）。
- 房间内**同一 Agent 可被派多个 work 任务并并行执行**：`resource_busy` 只对 `task.kind !== 'task'` 生效（`:693`）。document 交付的 claim 是 `read`（`collaboration-chat-host.ts:136`），不冲突 → 同一智能体并发处理同一房间的多份工作，各自一个 provider thread。

### 4.3 64 节点 / 预算耗尽后的行为

| 闸门 | 阈值 | 位置 | 越界行为 |
|---|---|---|---|
| 编译工作流节点数 | ≤32 | `collaboration-workflow.ts:17` | 抛 `collaboration.invalid_workflow_size` |
| 小队展开后节点数 | ≤64 | `collaboration-team-participants.ts:54` | 抛 `collaboration.workflow_too_large` |
| 单次 dispatch 任务数 | ≤64 | `collaboration-chat-service.ts:260` | 抛 `collaboration.workflow_too_large` |
| 自动派工累计节点 | ≤64 | `collaboration-chat-host.ts:301-305` | 抛 `task_room.automatic_work_limit`（**只回给模型，不改房间状态**） |
| 自动消息条数 | ≤12 | `collaboration-chat-service.ts:1066` | follow-up 路径 → `room.state='paused'`（`:389`）；`send/dispatch` 路径 → 抛 `collaboration.loop_limit`（`:1070`） |
| 消息跳数 | ≤6 | `:1065` | 抛 `collaboration.loop_limit`，**但房间内 hopCount 恒为 1（见 D7），实际永不触发** |

### 4.4 "必须人点一下"的死路清单

1. **预算耗尽 → 房间 paused**，只能 `room-resume`（`:338-353`）。
2. **restart → 房间 paused**（`recover()`，`:651`）。
3. **授权随路由漂移**：只有在"无 @ 且路由到 coordinator"的讨论任务上才允许 `collaboration_start_workflow`（`:233`、`runtime.ts:27311`）；一旦消息被改投给某个 worker，用户说"开工"只会得到"请点击开始团队工作"（`task-room.ts:77`）。
4. **agent 不能重试**：`cancel/retry/retry-message` 全部要求人类身份（`collaboration-chat-host.ts:324-332`），UI 只提供人工"重新投递/重试"（`CollaborationChatView.tsx:222-231`、`:302`）。
5. **`stopping` 卡死 → 房间永久不可 resume**（`:339` + `:93`，见 D5/D6）。
6. **restart 后只有 queued、没有 running 的房间不会自愈**：启动只调 `recover()`（`persistence.ts:277`），**没有任何地方调用 `pump()`**；`get/list` 也不触发（`collaboration-chat-host.ts:251`、`:214-219`）。见 D4。
7. **coordinator 被移除 → 静默停止自动推进**（`:385`）。

---

## 5. 消息与因果

### 5.1 表结构

`packages/shared/src/types/collaboration-chat.ts:73-99`。要点：

- `sequence` 房间内单调自增（`collaboration-chat-service.ts:1012-1022`）。
- `correlationId` 由根话题共享（`:208` 一带）；`causationId` 为直接因果父（`:209` 一带）；`hopCount = causation.hopCount + 1`（`:211`）。
- `expectsResponse` 决定是否唤醒（`:171`、`:219-221`）。
- `mentions` 人类侧带 offset，agent 侧只有 memberId+label（`:200-202` 一带）。
- `deliveries` 与消息分离（`:1024-1029`）。
- **没有**：阅读状态、收件人侧投影、优先级、TTL、PASS/弃权、每消息预算。

### 5.2 幂等键

| 命令 | 机制 | 位置 |
|---|---|---|
| `send`/`dispatch`/`retry`/`retry-message`/`room-*` | `receipts[action:clientRequestId] = {fingerprint, reference}`；指纹不符抛 `collaboration.idempotency_conflict` | `:1111-1122` |
| agent 工具调用 | `clientRequestId = tool:${runId}:${toolCallId}` | `runtime.ts:27342` |
| `get`/`list`/`activity`/`direct`/`promote-*` | **无** | `collaboration-chat-host.ts:183-223`、`:343` |
| `members` / `policy` | **无 requestId** | `:333-342`、`:542-585` |
| 投递结果侧 | 无独立 nonce，只有 receipt 表 | 对比 Grok Bot 双向 nonce（`docs/research/grok-bot/01-communication-and-groupchat.md:776`） |

### 5.3 回复继承

- `replyToMessageId` → 收件人 = 原作者（active 时）（`:163-164`）。
- agent 侧默认 `replyToMessageId = scope.input.task.originMessageId`（`runtime.ts:27384` 一带），所以"回复谁"经常退化成"回复本任务的触发消息"。
- 人类回复一条 agent 消息 → `expectsResponse` 默认 `true`（`:171`）→ 立刻建任务唤醒那个 agent。

### 5.4 `@` 校验

- 服务端校验在 `:186-197`，只对"人类侧带 offset 的 mentions"生效；agent 侧用 `recipientMemberIds`，**不做文本校验**。
- 失败一律抛 `collaboration.invalid_mention`（`:193`），整条消息不落库。
- 收件人不存在/已停用 → `collaboration.member_inactive`（`:1042` 一带），同样整条消息失败。
- 因此"@ 语义可靠"只在一个前提下成立：发送方是桌面渲染层且 mention token 与成员表一致。agent 写 "@某人" 不会投递（`chat-tools.ts:379`），模型极易犯。

---

## 6. 可观测性

### 6.1 已经有的（要保留）

- 消息级投递标签：已排队 / 处理中 / 已送达·不触发回复 / 已回复 / 等待成员回复 / 消息处理失败 / 已取消 / 本群已暂停（`CollaborationChatView.tsx:288`、`:301`）。
- 任务级等待原因（`CollaborationChatView.tsx:33`）：`capacity / dependency / dependency_failed / resource_busy / member_removed / peer_reply / room_paused / loop_limit`。
- 失败可重投：`retry-message` + "重新投递"（`:227-231`、`:302`）。
- 全局活动面板：`activity`（`collaboration-chat-host.ts:191-213`）。
- 房间检查点（`task-room.ts:11-24`）与人读状态条 `TaskRoomBar`。
- 事件推送 `collaboration.updated` + 10s 兜底轮询（`runtime.ts:21385-21398`、`use-collaboration-chat.ts:77-83`）。

### 6.2 假成功 / 假状态

1. **`dispatch` 静默空转却返回 `ok:true`**（D3）：`collaboration-chat-host.ts:293`（房间）/ `:320`（非房间）提前返回当前快照；`runtime.ts:27453-27455` 又把该快照里**上一批**子任务当成"本次入队"回给模型，并附言"任务已入队，调度器将自动推进"。
2. **"状态待确认，正在核对运行情况"是空话**（D2）：生产装配**未传** `probeStatus`（`persistence.ts:253-276`），`observeStatus` 的 `if (this.ports.probeStatus)` 永不进入（`collaboration-chat-service.ts:873-883`），`observation` 被钉死在 `status_unconfirmed`（`:870`）。UI 文案 `CollaborationChatView.tsx:362`。
3. **`deliverResult` 一写就是 `processed`**（`:958`）：结果消息刚落库就标记"已处理"，UI 显示"已回复"；而收件人的下一次上下文选择总预算 12k 字符、最多 24 条、低预算时整条丢弃（`task-room.ts:30-45`），**不保证被读到**。
4. **`expectsResponse=false` 的消息同样被记 `processed`**（`:221`），UI 显示"已送达·不触发回复"；真实语义是"永远不会唤醒对方，且可能永远不进对方上下文"。
5. **`waiting_input` 无写入方**（D13）：等人类批准的运行在持久层仍是 `running`，UI 显示"执行中"。

---

## 7. 缺陷清单（20 条）

> 严重度映射：P0 = H（阻断/不可用）；P1 = H/M（稳定错误或停摆）；P2 = M/L。
> 每条格式：编号｜严重度｜现象｜代码证据｜触发条件｜真实后果｜修复代价。

### D1｜P0｜群内文件交付合同 100% 立即失败

- 现象：任务对话框提供"文件交付 + 路径"（`CollaborationChatView.tsx:415` 及同段表单），但默认权限下任何 file 交付任务都在模型启动前被判权限失败。
- 证据：房间创建写死 `executionMode:'ask'`（`collaboration-chat-host.ts:522`）→ `resourceClaims()` 的 `readOnly` 含 `conversation?.executionMode === 'ask'`（`:136`）→ 全部 claim 变 `read` → `executeCollaborationTaskForHost` 判 `readOnly=true`（`runtime.ts:21331`）→ 命中 `:21355` 直接返回 `collaboration.file_delivery_readonly`。
- 触发：群聊里"创建任务"选文件交付（默认权限）。
- 后果：用户许诺"改工作区文件"的协作场景整体不可用；任务立刻 failed，错误文案把责任推给"智能体或会话为只读"，而真正的开关在右上角权限选择（`CollaborationChatView.tsx:392-394`）。
- 修复代价：小（让 `resourceClaims` 尊重 file 交付 + 房间默认权限），但需要产品决策。

### D2｜P0｜状态观察器在生产未接线，"核对运行情况"是死文案

- 现象：任何 attempt 静默超过 `statusTimeoutSeconds`（默认 120s）被标记 `status_unconfirmed`，UI 显示"状态待确认，正在核对运行情况"，但系统没有核对能力，也不会因此做任何事。
- 证据：默认 120s（`packages/shared/src/types/collaboration-chat.ts:34`）；定时器 `collaboration-chat-service.ts:850-858`；默认值 `:870`；只有 `if (this.ports.probeStatus)`（`:873`）才可能改变；生产装配未传（`persistence.ts:253-276`，对比 `runtime.ts:2495` 只给 delegation 接了 probe）；UI `CollaborationChatView.tsx:362`。
- 触发：任何执行超过 120s 无 progress（等审批、长工具调用、真挂起）。
- 后果：正常慢任务与真卡死不可区分；除 7200s 硬超时外没有归因，`status_delivery_failed` 分支永不触发。
- 修复代价：小（接通或删除这套伪装）。

### D3｜P1｜派工静默空转被报成"任务已入队"

- 现象：coordinator 在同一回合第二次 `collaboration_dispatch_tasks`（或对同一父任务重复派工），宿主直接返回当前快照而不是错误；runtime 把**上一批**任务当作本次结果返回。
- 证据：`collaboration-chat-host.ts:293`（房间）、`:320`（非房间）、`runtime.ts:27453-27455`。
- 触发：模型一次派工后又补一次（很常见：先派 2 个再补第 3 个）。
- 后果：后补的工作彻底丢失，模型与用户都以为已安排；没有任何 UI 信号。
- 修复代价：小。

### D4｜P1｜启动不 pump：重启后残留 queued 工作可能永久"排队中"

- 现象：进程启动只 `recover()`，从不 `pump()`；pump 只由命令或执行结束驱动。
- 证据：`persistence.ts:277`；`recover()` 不 pump（`collaboration-chat-service.ts:634-660`）；唯一入口 `schedulePump`（`:1145-1152`）只被 `send/dispatch/roomCommand/cancel/retry/retryMessage/updatePolicy/finishExecution` 调用；`get`（`collaboration-chat-host.ts:251`）与 `list/activity`（`:214-219`）都不触发。
- 触发：关停时该 workspace 有"只有 queued、没有 running"的房间（多房间共享 3 个名额时常见），重启后用户不再发命令。
- 后果：房间显示 running/排队中但永不推进。
- 修复代价：很小（启动时对每个 workspace `schedulePump`）。

### D5｜P1｜执行器不落地 ⇒ 房间永久锁死（无硬 fence）

- 现象：attempt 只有在 `ports.execute` 的 promise 落地后才会离开 ACTIVE；`stopping` 也算 ACTIVE。执行器不响应 abort 时该 attempt 永远停在 `stopping`，占用 1/3 全 workspace 产能，且房间永远无法 resume。
- 证据：唯一出口 `finishExecution`（`:768-825`）由 `.then(...)` 触发（`:751-758`）；`requestStop` 只把状态改 `stopping` 后 `abort()`（`:827-848`）；`runningInWorkspace` 明确保留 live execution（`:1073-1088`，注释"Retain locks until the executor has actually returned"）；`room-resume` 门槛 `:339`；唯一逃生口是重启后的 `recover()`（`:634-660`）。
- 触发：任一执行器 promise 不 settle。测试自己就用"永不 resolve 的 promise"建模（`task-room-durability.test.ts` 的 restart 夹具）。
- 后果：房间永久"停止中"、"继续本群工作"永远不可用；3 个这种 attempt 就能让整个 workspace 停止接活。
- 修复代价：中（执行侧硬 fence/子进程 kill + 超时后强制终态化）。

### D6｜P1｜agent 不能重试自己的失败，任何失败都要人点

- 现象：`cancel / retry / retry-message` 一律 `collaboration.user_action_required`。
- 证据：`collaboration-chat-host.ts:324-332`；UI `CollaborationChatView.tsx:222-231`、`:302`。
- 触发：任意 delivery 失败、任意 attempt failed/interrupted。
- 后果：无人值守必然停摆；agent 知道怎么补救也不能动。ADR 把它写成特性（`docs/adr/0004-task-room-execution.md:35`），与"长期自主任务群"目标冲突。
- 修复代价：小到中（给 coordinator 有界 retry + 次数上限）。

### D7｜P1｜自动推进的预算模型是坏的：hopCount 恒为 1，护栏只剩 12 条消息

- 现象：房间续推的 `hopCount` 永远 ≈1，6 跳限制形同虚设；唯一真实护栏是 12 条自动消息，用尽即暂停房间。
- 证据：`queueRoomFollowups` 用 `origin.hopCount + 1`，`origin` 是根任务的**原始人类消息**（`:388`）；`deliverResult` 同构（`:956`）；`queueSummaries` 同构（`:919`）；而 `send` 的 `causation` 默认回落到任务触发消息（`runtime.ts:27384`）。对比 `enforceLoopBudget` 读的正是 hopCount（`:1065`、`:1070`）。
- 触发：任何房间自动续推。
- 后果：(a) 深度失控只靠 12 条兜住；(b) 真触发 hop 限制时抛 tool error，coordinator 无路可走，房间随即落 `review`，人类必须介入——"自动收敛"没有实现。
- 修复代价：小（hopCount 改成真实因果父），但要重审预算语义。

### D8｜P1｜路由不可预测：手打 @ 无效，授权随路由漂移

- 现象：`@名字` 只有从编辑器选择器插入 token 才有效（`collaboration-mentions.ts:17-29`）；无收件人时默认 coordinator（`:1040`），但恰好只有一个未终态任务时改投该执行者（`:165-169`）；而"可以开工"的授权 `workflowStartAllowed` **只在收件人是 coordinator 时才挂上**（`:233`）。
- 证据：同上 + `runtime.ts:27311`（工具门禁读该字段）+ `task-room.ts:75-77`（两种情况给模型两套矛盾指令）。
- 触发：用户手打 `@张三 你看下`；房间里只剩 1 个活跃任务时发"开工吧"。
- 后果：**漏答**（消息进了 coordinator，用户以为张三收到了）；**错答**（协调指令落到 worker）；**授权静默失效**（同一句话因为路由不同而能/不能开工）。这是"抢答/漏答"最主要的现实来源——当前实现根本不会广播，问题不在抢答，在**投错人**与**授权漂移**。
- 修复代价：小（手打 @ 解析 + 路由回执 + 授权与路由解耦），但要做对需要成员名唯一性处理。

### D9｜P1｜全局并发被硬编码为 3

- 现象：`maxConcurrent` 在策略校验里被限制在 1..3（`:1102`），准入再取 `Math.min(3, policy.maxConcurrent)`，统计口径是**整个 workspace**（`:691`、`:1073-1088`）。
- 触发：任何超过 3 个可运行节点的图，或同 workspace 多房间。
- 后果：64 节点上限在实践中变成"3 路串行 + 7200s 超时"；一个等人的运行最多占 1/3 产能 2 小时；`maxConcurrent` 这个设置项是**假的**（不能 >3）。
- 修复代价：小（放开上限、作用域可配置），但需要真正的写入隔离配合。

### D10｜P1｜worker 无自主通信与再派工 ⇒ "发现即分工"能力为零

- 现象：房间内 worker 的工具表被硬禁用 `agent_*` 与私聊；派工只给 coordinator，且必须挂在"正在运行的 coordination attempt"上。
- 证据：`runtime.ts:27299`、`:27313`、`collaboration-chat-host.ts:289-293`。
- 触发：worker 执行中发现需要另一份材料/另一位专家。
- 后果：必须"结束本轮 → 宿主唤醒 coordinator → coordinator 再派工"，多一个完整模型回合，原始细节已丢。这正是 Grok Bot 用"成员可直接联系成员 + 显式 PASS"解决的问题。
- 修复代价：**大（架构级）**——见第 9 节。

### D11｜P1｜"已回复/已送达"把投递当作完成

- 现象：`deliverResult` 在结果消息落库时立刻写 `processed`（`:958`）；`expectsResponse=false` 的消息也立刻 `processed`（`:221`）；UI 据此显示"已回复"/"已送达·不触发回复"（`CollaborationChatView.tsx:288`）。
- 触发：任何 task_result、任何通知类消息。
- 后果：**假成功**。收件人是否真的会看到，取决于它后续是否被唤醒、以及 `roomContextSelection` 的 12k 字符/24 条预算（`task-room.ts:30-45`，预算不足时整条消息被丢弃，`historyOmitted` 只记数量不记原因）。用户看到"已回复"，实际可能永远没有下文。
- 修复代价：中（读回执，或至少区分"已入站/已进上下文/已读"）。

### D12｜P1｜非房间（legacy workflow）路径的静默丢单与 32 节点上限

- 现象：`compileCollaborationWorkflow` 编 DAG 时超过 32 人直接抛错（`collaboration-workflow.ts:17`）；`start-workflow` / `dispatch` 的重复调用被静默吞掉（`collaboration-chat-host.ts:265`、`:278`、`:320`）。
- 触发：小队人数多，或模型重复调用。
- 后果：模型以为起了工作流，实际返回当前快照；32 人以上团队无法启动。旧路径仍可达（非房间的 group/direct）。
- 修复代价：小（明确错误 + 分批），但旧路径应在新内核里废弃。

### D13｜P2｜`waiting_input` 是死状态，等审批的运行被显示成"执行中"

- 现象：该状态只在读取侧使用，**全仓无写入点**。
- 证据：`packages/shared/src/types/collaboration-chat.ts:106-108`；读取侧 `runtime.ts:27350` 一带、`collaboration-chat-host.ts:36/259/291`；真正等待发生在 `await this.requestChatToolApproval(...)`（`runtime.ts:20942`）。
- 后果：UI 无法区分"在干活"与"等你点批准"；配合 D2，120s 后变成"状态待确认"。
- 修复代价：小。

### D14｜P2｜@/收件人与实际投递可在同一房间内不一致

- 现象：房间内同 Agent 去重发生在 `appendMessage` **之后**（`:198-213` 已写入 `recipientMemberIds`，`:215-218` 才过滤），被去掉的收件人既无 delivery 也无 task。
- 触发：房间里同一 Agent 以两个成员身份存在（既是独立 Agent 又是小队成员）。
- 后果：消息头显示"→ A、B"，B 永远收不到，也没有投递记录可解释。
- 修复代价：小（先规范化 recipients 再落消息）。

### D15｜P2｜已批准的多步计划退化为"coordinator 单 agent 串行"

- 现象：`dispatchApprovedPlan` 给每个 plan step 都指派 `coordinator.id`（`collaboration-chat-host.ts:163`），并用 `dependsOnTaskIds: [上一步]` 串行化（`:171`）；且不设 `deliverable`。
- 触发：在协作会话里审批多步计划（`runtime.ts:10307`）。
- 后果：审批计划这条入口完全无视成员分工，退化成单人顺序写文档；因为无 `deliverable`，`finishExecution` 的交付校验（`:806-808`）被跳过，"任务完成"不要求任何产物。
- 修复代价：小到中（step 映射到成员），但先要决定"计划"与"任务图"谁是权威。

### D16｜P2｜跨群/跨项目协作在协议层不存在

- 现象：对等私聊只允许**同一个父群**的活跃成员（`collaboration-chat-host.ts:235-241`、`:444-486`、`:595` 一带）；房间上下文明确禁止跨群资料（`task-room.ts:64` 一带）。
- 后果：Grok Bot 的"带显式分享包的跨群交接"没有对应物；跨项目只能靠人复述。
- 修复代价：中（新增分享/交接对象），属于必须新增。

### D17｜P2｜快照全量读写：每条进度更新都是 O(整个房间)

- 现象：每次 `mutate` = 全量读（5 张表 + receipts）+ 两次 `structuredClone` + `stableJson` 双份序列化 + 全量行 UPSERT + `onChanged(copy(snapshot))`；进度节流只有 120ms（约 8 次/秒）。
- 证据：`collaboration-chat-service.ts:1124-1143`（两次 `copy`）、`:600-631`（进度落库）、`collaboration-run-progress.ts:31-56`（120ms 在 `:40`）、`collaboration-store.ts:90-135`（保存）、`:137-159`（读取）、`:94`（`stableJson` 比较）。
- 触发：长回答流式输出 + 大房间（数百条消息、64 个任务）。
- 后果：写放大与 GC 压力随历史线性增长，表现为整机卡顿而非明确报错。
- 修复代价：中（增量落库 + 进度字段单独列）。

### D18｜P2｜没有失败归因维度，也没有"谁负责"

- 现象：`CollaborationError` 只有 `category` + `retryable` 布尔 + 自由文本（`packages/shared/src/types/collaboration-chat.ts:109-115`）。
- 对照：Grok Bot 有 `TurnFailureCode`（TIMEOUT/USAGE_LIMIT/RATE_LIMIT/TEAM_POLICY_UNAVAILABLE/UNPAID_INVOICE）与 `TurnFailureAccount`（OWNER/ACTING_USER）（`docs/research/grok-bot/01-communication-and-groupchat.md:785`）。
- 后果：停摆时无法自动区分额度/限流/策略/责任，无法做运维统计与自动退避。
- 修复代价：小（加枚举），需要产品定义口径。

### D19｜P2｜工具目录与角色守卫双轨，且只在 readOnly 时收敛

- 现象：role 由 prompt（`task-room.ts:74-80`）和运行时守卫（`runtime.ts:27296-27320`）两处定义；工具目录只在 `readOnly` 时按 `isCollaborationControlToolAllowed` 过滤（`runtime.ts:21349-21353`）。非 readOnly 的 file 任务（切到 workspace 权限后）worker 会**看到** `collaboration_dispatch_tasks`，调用后才被拒。
- 后果：模型试错、错误难懂；prompt 与守卫任一不同步就出现"能做但被拒"或反向漏洞。
- 修复代价：小（统一到一处能力决策）。

### D20｜P2｜升级即停摆：迁移把所有旧群置为 paused，并撤销子会话全部 queued 工作

- 现象：构造函数里所有非房间 group 会话被就地加 room 并 `state='paused'`（`collaboration-chat-host.ts:62-84`，`createTaskRoom` 在 `:66`），有旧 task 的房间写 note 要求人工核对；`revokePeerDirectChildren` → `revokeQueuedPeerDirectWork` 取消子会话中**所有** `queued` attempt 与 delivery，不区分是否与 peer-direct 有关（`collaboration-chat-service.ts:551-578`）。
- 触发：升级后首次启动。
- 后果：用户升级完发现所有群都停了；子会话里排队的工作被无差别撤销，理由却写"群内智能体单聊已关闭"。
- 修复代价：小（缩小撤销范围 + 迁移提示），迁移策略需重新设计。

---

## 8. 与 Grok Bot 的根本分歧

| 维度 | Grok Bot 0.63.0（本地样本实证） | SYNC-THINK 现状（本文快照） |
|---|---|---|
| 谁决定下一个发言者 | 服务端 turn 编排器（Temporal），以 `RequestGrokBotRoomMemberTurn` 派发 | 客户端 runtime 的确定性规则：@ → 回复作者 → 唯一负责人 → coordinator |
| 成员的表达权 | `TurnOutcome` 含 `PASS`，"我不说话"是协议一等公民 | 无 PASS；`expectsResponse=false` 只是"不唤醒"，不是可被编排层理解的表态 |
| 一次派发的语义 | turn 请求/结果分离成两个 RPC，`nonce` 双向幂等，`deadline` 与 `is_winding_down` 分离 | 一条消息 = 一个 task = 一次执行；只有发送侧幂等；收尾只有一个超时 |
| 上下文 | 逐成员投影（`is_self`/`speaker_kind`/引用快照 `quote`）+ 增量 `new_messages[]` | 共享消息表 + 每次重挑 12k 字符/24 条窗口 |
| 并发与防抢话 | 允许并行，靠协议层 PASS + UI 相位粘滞；`groupTurns`/`activeGroupMemberId` 可观测 | 用 capacity=3 的全局名额 + 任务所有权回避抢话 |
| 失败与责任 | `TurnFailureCode` + `TurnFailureAccount` 显式枚举 | `category` + `retryable` 布尔 |
| 身份 | 持久 Bot 身份是产品主体，房间由服务端托管（`server_rooms_enabled`） | 房间是产品主体，Bot 只是房间内的成员快照 |

**一句话**：Grok Bot 把"协作"建模为**编排层调度的轮次**，成员是**有发言权的参与者**；SYNC-THINK 把"协作"建模为**协调员派发的任务队列**，成员是**被唤醒的执行器**。所有具体差距（无 PASS、无跨群、无自主联络、无成员投影、假投递状态）都是这一个选择的下游结果。

---

## 9. 结论：哪些可修，哪些必须重写

**核心架构选择**：房间快照 = 唯一真相，coordinator = 唯一路由器，成员 = 一次性执行器；消息只是任务派生的记录。

**可修（保留骨架）**
1. D1 文件交付只读判定、D3 静默空转、D4 启动 pump、D13 `waiting_input`、D14 收件人一致性、D15 已批准计划映射、D19 单一能力决策、D20 迁移范围——局部改动，1~3 天量级。
2. D2 状态观察、D6 agent 重试、D7 hop 预算、D8 路由可预测性 + 授权解耦、D9 并发上限、D11 投递语义、D17 快照性能、D18 失败归因——需要接口调整，可复用现有 `attempt/delivery/receipt` 骨架。
3. D5 硬 fence（执行侧超时后强制终态化 + 房间可解锁）是可靠性必修项，必须与 D6 一起做，否则每次卡死都要重启应用。

**必须重写（架构级）**
1. **唤醒/发言决策内核**：从"@ → 回复作者 → 唯一负责人 → coordinator"改为"编排器为每个候选成员生成一次轮次请求，成员显式返回产出或 PASS"。没有 PASS，就永远会有抢答、漏答、以及"不该说话的人被唤醒烧 token"。
2. **上下文装配**：从"共享消息表 + 12k 窗口"改为"每成员投影 + 增量新消息 + 引用快照"；否则成员永远不知道自己是谁、还有谁、上一条是谁说的、为什么轮到自己（`task-room.ts:81` 现在只能把 roster 塞进 prompt）。
3. **投递语义**：从"消息 = 任务 = 执行"改为"turn 请求 / turn 结果 / 取消"三态分离 + 双向幂等 + `delivered` 与 `completed` 分开（当前 `deliverResult` 一写就是 `processed`）。
4. **角色模型**：worker 的再派工与同侪联络必须放开**有界**的口子（向上汇报 + 横向咨询 + 需审批的再派工），否则 D10 无解；这需要同步修订 ADR 0004，不能静默扩大权限。
5. **跨群交接对象**：新增"分享包"（目的/问题/允许分享的摘要/产物引用/回传群），而不是放开全部历史。

**明确保留（不要在重写中丢掉）**：房间级持久隔离与检查点（`task-room.ts:11-24`）、产物内容寻址版本化（`collaboration-artifacts.ts:17-37`）、receipt 幂等表（`collaboration-chat-service.ts:1111-1122`）、投递/等待状态的 UI 表达（`CollaborationChatView.tsx:288-302`）、执行版本门禁（`use-collaboration-chat.ts:88`）。这些是现有实现里真正的资产。

---

## 附录 A · 复核锚点（符号 + 行号，只用 grep/read）

| 结论 | 锚点 |
|---|---|
| 无 @ 默认进 coordinator | `private recipients(` → `collaboration-chat-service.ts:1039`（默认值 `:1040`） |
| 恰好一个未终态任务时改投 | `const pending = sender.kind` → `:165`；`const routed =` → `:169` |
| 开工授权只在 coordinator 收件人 | `task.workflowStartAllowed = true` → `:233`；门禁 `runtime.ts:27311` |
| 文件交付只读失败 | `file_delivery_readonly` → `runtime.ts:21355`；房间默认权限 `collaboration-chat-host.ts:522` |
| probeStatus 未装配 | `new CollaborationChatHost` → `persistence.ts:253`；`probeStatus: (id)` → `runtime.ts:2495` |
| 启动只 recover | `collaborationChatHost.service.recover()` → `persistence.ts:277` |
| 容量硬上限 3 | `Math.min(3` → `collaboration-chat-service.ts:691`；`[policy.maxConcurrent, 1, 3]` → `:1102` |
| resume 要求无 ACTIVE | `still_stopping` → `:339`；`ACTIVE` 定义 → `:93` |
| 静默空转 | `return { snapshot: current }` → `collaboration-chat-host.ts:293`、`:320` |
| 假"任务已入队" | `任务已入队` → `runtime.ts:27455`（该分支起点 `:27453`） |
| hopCount 由 origin 派生 | `hopCount: origin.hopCount + 1` → `collaboration-chat-service.ts:388`（另见 `:919`、`:956`） |
| waiting_input 无写入 | 全仓 grep `status: 'waiting_input'` → 只读侧 |
| 迁移即暂停 | `snapshot.conversation.room = createTaskRoom(` → `collaboration-chat-host.ts:66` |
| 队列预算耗尽即暂停 | `自动推进已达本轮额度` → `collaboration-chat-service.ts:389` |

## 附录 B · 未证实 / 需要实测

1. **【未证实】** provider 层是否真的会在 abort 后必定 settle。本文只证明"结构上没有硬 fence"。建议实测：注入忽略 signal 的假执行器，验证 `room-resume` 是否永久 `still_stopping`。
2. **【未证实】** 同一 task 的多次 attempt 是否真的把历史带进模型上下文（`threadId` 由 taskId 决定，但 `prepareRunBinding` 是否加载历史消息未逐行核对）。若复用，"咨询后续做一轮是干净上下文"的说法不成立；建议 OV2 从 `native-run-state-persistence`/`messageStore` 侧确认。
3. **【推断】** D17 写放大在真实房间规模下的耗时；建议用 500 条消息 + 64 任务的快照做 `mutate` 基准。
4. **【未证实】** D20 中 `revokeQueuedPeerDirectWork` 在真实升级数据上的命中范围。

## 附录 C · 审计期间发现的工程风险：现状没有被冻结

- 事实：审计开始的 11:11 到 11:16 之间，`collaboration-chat-service.ts`（1185→1189 行）、`collaboration-chat-host.ts`（617→626 行）、`collaboration-task-room.ts`（127→142 行）、`runtime.ts` 均被并发修改（mtime 见第 0 节；`git status` 显示这些文件处于 worktree-modified 状态）。
- 影响：
  1. 本文的行号只在第 0 节快照上成立；任何按本文施工的人都应先 `git stash`/打 tag 或至少确认 hash。
  2. 本次并发修改已经动到本文批评的核心，至少三处：
     (a) 新增 `workflowStartAllowed` 并放宽"讨论轮可以开工"（`packages/shared/src/types/collaboration-chat.ts:138`、`collaboration-chat-service.ts:233`、`runtime.ts:27311`、`task-room.ts:75-76`）；
     (b) `send` 新增 `coordinates` 判定，使"用户要求开工 + 收件人是协调员 + 群里有别的成员"产生协调任务而非工作合同（`collaboration-chat-service.ts:224-231`）；
     (c) 房间上下文选择改为按条截断（origin ≤4000 字符、其余 ≤3000、总预算 12k、上限 24 条、预算不足整条丢弃），`task-room.ts:30-45`。
     也就是说：**"要推翻的基线"在被审计的同时被部分修补，D8/D10/D11 的细节会随修订漂移。**
  3. 重写立项必须先冻结基线：请 Lead 决定以哪个 commit/hash 作为"现状"，并把本文的缺陷编号映射到该基线；否则验收时无法证明"改好了"。
- 建议：把本文第 0 节的 8 个 hash 记入 overhaul 的设计文档作为 `baseline`，所有对比与验收都相对它执行。
