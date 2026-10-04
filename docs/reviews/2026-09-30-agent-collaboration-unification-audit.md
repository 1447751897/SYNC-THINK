# 智能体协作统一改造：DeepSeek Harness 对照审计

> 方向更新（2026-09-30）：用户后续明确选择参考 Multica 整体替换协作子系统，不再以保留本报告中的调度实现为前提。本文源码诊断作为历史研究保留；推荐路线以 D:/projects/SYNC-THINK/docs/reviews/2026-09-30-multica-replacement-research.md 为准。


日期：2026-09-30。状态：研究与改造提案；尚未修改应用执行逻辑或用户设置。

## 0. 结论与证据边界

当前问题不是“缺少多智能体功能”，而是**多条协作入口没有共享同一套策略、预算和可观察的执行语义**。继续添加开关，会让用户更难预测系统行为。

建议保留现有 `CollaborationChatService` 的 DAG、任务尝试、产物合同、拓扑冻结和历史隔离能力，在其上逐步收口统一执行入口。参考 DeepSeek 的角色与职责分离、持久消息、明确任务状态，以及启用团队模式时撤掉重叠工具的做法；不整套替换，也不再另建一个平行的 WorkflowInstance 引擎。

研究基线：
- SYNC-THINK：`cf83a34fe1e38cde293652ab33ea373a7c842081`，加工作区既有 UI 修复。研究期间未改动这些已有改动。
- DeepSeek Harness：`639ed015397290b3745d163aafe02ffee4aa3f84`，提交时间 2026-09-29 17:21:31 +08:00。读取了公开源代码，未安装或执行该项目。
- 设置值来源是用户截图，不是实时读取的设置数据库。
- 结论区分“源码确认”“设计限制”“改造建议”。没有把用户具体历史任务的失败原因当成已复现事实；未做真实付费模型端到端回归。

## 1. DeepSeek Harness 团队到底怎样运行

### 1.1 不是一个能任意递归招募的群聊

它有通用 Subagent 服务和实验性 Agent Teams 两个层次。通用服务适配 fresh、fork、ACP、Codex、Claude Code 等执行方式；Agent Teams 在其上提供有身份、可继续运行的团队成员、任务板与消息。

团队的 Lead 就是当前根会话的 Agent，TeamId 与 Lead SessionId 对应。Lead 可以创建临时 teammate；teammate 可从空上下文开始，也可继承 Lead 已完成的历史前缀。创建记录先持久化为 provisioning，成功后可运行，失败则保留 failed 记录。只有 Lead 可以招募、重新指派和中断成员；成员之间可以发消息、维护自己拥有的任务。

这与本项目的“永久智能体定义”不是一回事：借鉴临时执行成员，不应放开模型自行创建或修改 Agent Library。

### 1.2 一次工作的实际链路

1. 用户明确要求使用 Teams，Lead 分解任务并创建需要的队友。
2. 建立共享任务板，声明依赖和预计修改范围。
3. 成员读取任务当前 revision；依赖完成后，用该 revision 领取任务。
4. 成员工作、与 Lead 或队友通信，最后明确完成任务。
5. Lead 等待必要成员、检查任务板、审查差异并测试，最后答复用户。

任务修改是 CAS：读取的 revision 过期就报错，而不是覆盖他人的状态。任务就绪不自动启动负责人；需要 Lead/成员通过消息等方式唤醒。`inactive` 只代表当前没在执行，不等于成功、完成或失败。中断运行也不会自动释放任务所有权。

### 1.3 消息是持久信箱，不是每次重建一个智能体

消息先写入 Lead Session 日志并 flush，再派送；有稳定消息 ID。正在运行的接收者在步骤边界收到 Steer；inactive 接收者开始新一轮或冷恢复。queued 表示已保存，不应该重复发送。

它保证的是单进程协调下的重试和接收方去重，不是跨进程一致性协议，也不是任意外部副作用的 exactly-once。成员、任务和信箱事件属于内部日志，不直接污染聊天正文。

`wait_agent` 只等待调用之后发生的变化，不负责唤醒成员；若没有其他 running/provisioning 成员，工具会立即提示 noProgress，而不是让所有人互相空等。

### 1.4 最值得借鉴：主动撤掉重叠入口

实验性 Team profile 会关闭普通 `tool-subagent`、`tool-subagent-fork` 和重叠的全局子智能体控制工具，换成一套作用域化的 Team 工具，UI 与工具由同一个 bundle 开关控制。

它仍保留底层 Subagent 服务和 Workflow 所需的 provider，所以不能解读为所有工作流能力被删除。它的文档也承认 Web 中某些预设仍可能重新启用全局控制入口，说明“工具配置不重叠”同样需要持续校验。

### 1.5 不要照搬的边界

- 当前仍是 experimental、opt-in；不是成熟分布式集群调度方案。
- 所有成员共享同一个工作目录，没有自动 worktree 隔离。
- writeScopes 是冲突提示，不是锁；shell、格式化器和代码生成器也不完全受文件版本保护。
- 任务就绪不自动派发，本项目的固定 DAG 自动流水线不应因此退化成手动唤醒。
- 暂不支持嵌套 Team；本项目已有的群聊包含小队、命名空间和分层验收有保留价值。
- 运行时包默认 maxMembers=16，官方 Team profile 覆盖为 8；是曾创建的成员数量上限，不是“最大并行任务数”。

## 2. 截图里的七个设置：真正含义

### 2.1 允许模型对话并发委派给已有智能体：截图开启

对应 `dynamicSubagentsEnabled`，主要暴露/限制 `agent_delegate`。使用的是工作区已激活的现有 Agent，不是创建新定义。关闭后 `agent_run` 普通调用仍存在；它在 admission 中明确将这个开关视为 true，但仍经过数量、深度和 tokenBudget 的准入计算。

群聊/小队的 `collaboration_start_workflow` / `collaboration_dispatch_tasks` 不受这个开关控制。因此它不是全局“允许协作”开关。

### 2.2 Agent 对话允许派发普通任务：截图关闭

对应 `allowAgentTaskDispatch`，实际过滤的是 `TaskCreate`、`TaskUpdate`：维护持久待办清单，而不是给另一个 Agent 派发可执行任务。名称中的“派发”容易误导。建议迁到任务清单权限，改为“允许维护工作区待办”。

### 2.3 允许 Agent 之间直接对话：截图开启

对应 `allowAgentPeerMessaging`。当前全局策略检查旧名 `agent_message`；实际工具是 `collaboration_send_message` / `collaboration_send_direct_message`，真正的 peer 边界来自具体会话 `policy.allowPeerDirect`。

全仓源码引用和纯策略探针均证实：切换该全局值会改变旧工具的允许结果，但不改变两个实际消息工具在该策略函数里的结果。**这不是“所有人都能任意通信”**：Host/Service 仍检查会话、成员身份和 allowPeerDirect。问题是设置开关与用户实际使用的工具脱节。

此外，不建立委派子 Run 不代表没有新模型开销：消息默认 `expectsResponse=true`，会生成 reply 任务并经执行器运行。消息、回复轮次和工作任务需要在 UI 中明确区分。

### 2.4 最大嵌套深度：截图 2

兼容旧的 delegation depth 上限。当前被委派成员在运行入口因 `delegationParentRunId` 被禁止再次委派；填写 2 并不开放两层自治招募。0 仍可阻止准入，不应在迁移中当成普通无效值丢弃。

建议普通设置隐藏该兼容字段；“成员不再扩大范围”成为明确的产品规则。

### 2.5 单个父 Agent 最大子 Agent 数：截图 4

更准确是父 Run 累计创建的子执行次数上限，不是正在同时运行的数量，也不是 Agent Library 新增定义上限。委派成功准入时计数递增，完成不会把它当并发槽释放。

### 2.6 单轮最大自动委派数：截图 3

与上一计数在当前模型委派入口同时递增，`agent_run` 也经过这套限制。在截图值下，根 Run 通常先碰到 3 次限制，4 次上限不是“还剩一个并发名额”。

群聊另有 `maxConcurrent`，实际最多 3，按工作区活跃任务计数；另有消息跳数上限 6、自动消息数上限 12、冻结 DAG 每批 64 节点。这些都不是截图“3”控制的同一个量。

### 2.7 每个任务 Token 预算：截图无限制

对应 `taskTokenBudget=null`。设置数字后，委派准入会计算有效预算；但是消费端覆盖不一致：
- Native 执行的 maxOutputTokens 和 usage 累计终止被 `delegatedReadOnly` 条件包住，可写委派没有同等检查。
- 外部内核的 usage 分支收集并记录用量，未接入这项 delegationTokenBudget 的终止判断。
- 群聊/小队任务没有统一继承这项设置。
- 已接入的 Native 路径也是收到 usage 后终止，不能当成严格预付费硬上限。
- 超预算结果为 failed/budget_exceeded，不是界面所说的自动返回摘要。

因此它目前不是“所有 Agent 任务的可靠成本上限”。截图无限制也只是这项配置，不代表没有超时、模型上下文或其他服务限制。

## 3. 已确认的问题与优先级

### P1：设置、工具目录、Host 权限未使用同一个能力决策

证据：旧 `agent_message` 与真实消息工具脱节；群聊另用 allowPeerDirect。
后果：用户看着开关无法预测最终行为，工具展示也容易与真正拒绝理由不一致。
修复方向：一个 `resolveEffectiveCollaborationPolicy(scope)` 同时供设置预览、工具暴露和执行准入使用；返回有效值与来源，而不只返回布尔值。

### P1：Token 预算覆盖不完整，描述与终止语义不符

证据：Native 仅只读条件、External usage 只记账、团队执行缺少共同预算注入、超限返回 failed。
修复方向：移出只读判断，建立所有适配器统一的 usage ledger 和中止协议；每任务与整个工作流分别计量，保留重试耗费。供应商不支持硬上限时明确标注软停止及可能超用；“总结”若启用需要独立预留额度和不伪造成功的结果类型。

### P2：并发、创建次数、嵌套深度和待办权限混在一个面板

这是概念与兼容债，不宜靠继续改几句说明掩盖。TaskCreate 不是协作派工；depth=2 不是开放递归；计数=3 不是并行3。
修复方向：任务清单权限独立；协作资源页面展示当前实际并行槽、累计任务数、等待原因。

### P2：资源锁粒度太粗，是保守设计的性能代价

Host 将文件任务声明归并到 workspace 整体读写锁，并使用跨工作区的 external-tools 锁。不同文件的写任务也可能排队；一个 workspace 的写还可能阻塞其他 workspace 的外部工具使用。这不是通过把截图数字调大就会消失的问题。

建议保留保守降级，逐步引入可规范化的文件/目录 scope。只对可验证的工具施加细粒度锁；shell、未知 MCP 和未声明外部副作用继续使用粗锁。不能直接照搬 DeepSeek 的“仅提示重叠”来冒充隔离。

### P2：消息默认启动回复，容易形成隐性工作和费用

当前实际消息路径已有持久化、循环预算和可恢复任务，值得保留。但“通知”“需要回答”“派发工作”缺少足够鲜明的用户语义。

建议协议显式区分 notify、request_reply、assign_task。通知不调用模型；回复是会话轮次；只有工作任务参加产物验收与任务依赖。三者共享统一审计、预算和身份来源。

### P2：设置保存缺少错误反馈

SettingsPage 先改本地 state，再 fire-and-forget setSetting；读取错误也被吞掉。此处确认的是代码级风险，未复现用户实际持久化失败。
建议使用服务端修订号、保存中/已保存/失败状态、错误回滚或重试，防止用户将本地视觉状态当作服务端生效事实。

## 4. 现有实现应保留的部分

- 永久定义由用户拥有，创建/修改逐次审批，不让工作任务顺手改角色。
- 模型对话、Agent 私聊、群聊分别保留历史；内部消息不自动污染用户私聊。
- frozen roster、teamSnapshot、topologyRevision 和成员作用域命名空间。
- 小队编译到现有 DAG，并有内部负责人验收交付节点；不占槽等待自己的子节点。
- document/file 产物合同；没有本次 attempt 的正确产物不判成功。
- 重试产生新 attempt；前置失败阻断后续，修复后才恢复。
- 幂等请求、取消、进程恢复、明确的等待原因。
- ADR 0001 的默认只读及继承写权限规则。

旧 `team.startRun` 在当前 Runtime 路径只是创建 TeamRun 记录并发事件，不是本次证据中找到的第三套完整团队 AI 调度器。不要仅因命名相似就宣称它与群聊重复执行。

## 5. 推荐的统一模型：统一内核，不合并所有聊天

### 5.1 六个清晰概念

1. **AgentDefinition**：角色配置，包括模型、技能、工具和权限。
2. **TeamDefinition**：可复用成员与依赖模板，不是正在运行的团队。
3. **CollaborationScope**：本轮执行的来源会话、成员快照、协调员、权限与预算快照；可先作为现有 snapshot 的扩展，不新增一套数据库引擎。
4. **WorkItem / Attempt**：做什么与一次怎么做；重试不抹掉过去。
5. **Message / ReplyTurn**：协作通知或回复，区别于工作交付任务。
6. **Artifact**：实际交付及其工作任务、attempt、来源引用。

### 5.2 一个入口，一条执行链

模型委派、群聊负责人、小队模板均转换为相同的工作合同：

`会话入口 → 意图/成员/权限解析 → 有效策略 → 准入与预算 → 现有 DAG/任务调度 → Native/外部执行适配器 → 用量与产物验收 → 原来源会话回写`

原 `agent_delegate` / `agent_run` 暂作兼容适配器，不再各自维护长期独立的预算、生命周期和结果结构。不是简单删除两工具后让模型改说新名字；需要同步迁移等待/异步回写语义和父会话映射。

### 5.3 两种工作方式，共用执行机制

- **固定流水线**：复用当前冻结 DAG，依赖成功后自动启动。
- **临时协作**：负责人提出一个小型工作图，或在一轮结束后追加一个新工作图；也使用同一准入、预算、任务板和产物验收。

第一阶段继续不做任意成员递归招募和运行中自动改图。若将来引入动态重排，必须新增 ADR，明确 supersede ADR 0003 的相关决定，而非悄悄绕过。

### 5.4 消息与状态

借鉴持久 mailbox 和稳定 messageId。实际“运行中注入/休眠恢复”按 Native、Claude、Codex 适配器能力提供；缺少 Steer 的适配器采用串行下一回复轮次，展示降级原因，不假装支持热注入。

UI 分别显示执行状态、任务状态和交付状态。任务卡提供来源会话、负责人、等待原因、预算、产物、错误、重试次数和消息计数。主聊天以用户问题和最终交付为主，内部轨迹放详情中；用户显式打开的私聊继续独立存在。

## 6. 设置页面如何简化

建议三组，而不是继续堆开关：

### 默认协作方式
- 自动派工：仅手动 / 派发前确认 / 允许自动使用本会话选定的现有成员。
- 成员通信：仅向负责人汇报 / 允许冻结名单内通信。
- 明示“不创建或修改永久智能体定义”；定义管理始终用户逐次确认。

### 资源上限
- 工作区同时执行任务数，另展示会话的更严格限额。
- 每轮工作图最多任务数，与并发数分开。
- 每任务预算、整轮预算、超时；展示预算适用的执行器和软/硬边界。

### 权限与高级兼容
- 默认只读；获准写入限于明确工作范围与工具能力。
- 待办清单编辑移到普通工具权限。
- 隐藏旧嵌套深度，保留兼容读取和迁移说明。
- 每项显示有效值、来源和保存结果。全局上限是硬护栏，工作区/会话只能收紧而不能悄悄放宽。

迁移须保留当前显式设置，包括 null 预算、depth=0 与通信限制；存在冲突时采用更严格值并展示提示，不能静默打开 peer 或写权限。

## 7. 分阶段改造与验收

### 阶段 A：先消除设置失真，不搬迁历史

- 增加全链路能力矩阵测试，覆盖 model/agent/group/team × Native/External × readonly/inherit。
- 用同一有效策略控制真实消息工具；明确全局/会话 peer 优先级。
- 修复预算覆盖和错误描述；保存反馈改为可确认状态。
- 明确待办权限名称；隐藏不代表真实能力的旧深度 UI。
- 验收：同一设置在所有入口行为一致；伪造工具调用仍由 Host 拒绝；失败保存不显示成功。

### 阶段 B：委派入口收口到现有工作任务内核

- 兼容现有工具，统一 work item、attempt、返回路由、预算账本和等待机制。
- 保留消息三种语义、幂等 ID、产物合同、重试/取消协议。
- 旧运行不热转换；新轮次按 executionVersion 路由。保留只读历史兼容和回滚开关。
- 验收：一项工作只执行一次；回复只回原来源；重试费用不丢；多队最终汇总不被消息循环预算吞掉。

### 阶段 C：统一界面与资源隔离

- 同一个任务详情/任务板组件，展示等待原因和有效策略，而非复制多个页面。
- 可验证的写工具按文件/目录细分资源锁；其他操作保守退回粗锁。
- 验收：两个独立 scope 的读任务并行；可验证的不相交写任务按规则并行；相同路径互斥；shell/未知副作用不被错误解锁。

### 必须补充的故障回归

消息持久化后/派送前崩溃；重复发送；消息回复循环；队友 inactive；依赖失败和重试；取消时文件仍在写；缺产物；过期 revision；成员变更；耗尽任务/整轮预算；External 不提供即时 usage；多人共用同一 AgentDefinition；切换内核；进程退出后保留诊断并避免盲目重放外部副作用。

## 8. 本轮验证结果

2026-09-30 执行 runtime 定向回归：
- collaboration-policy.test.ts：7 通过。
- delegation-admission.test.ts：25 通过。
- collaboration-chat-service.test.ts：22 通过。
- 合计 3 个测试文件、54 项通过；不是整个仓库全量测试通过。

另做纯策略探针：allowAgentPeerMessaging=false/true 时，agent_message 的判断改变，而两个真实 collaboration 消息工具在该函数中均返回无拒绝。该探针不代表 Host 的会话权限消失。

未改动运行中的设置、智能体定义、任务记录或聊天历史。新增本报告与配套可视化审计，不宣称统一改造已经实现。

## 9. 源码证据索引

所有项目路径均为本机绝对路径，行号按研究基线。

### SYNC-THINK

- 设置文案与保存：D:/projects/SYNC-THINK/apps/desktop/src/renderer/shell/SettingsPage.tsx:384–535
- 配置与分轨能力：D:/projects/SYNC-THINK/packages/protocol/src/collaboration.ts:1–190
- 实际工具门控：D:/projects/SYNC-THINK/apps/runtime/src/collaboration-policy.ts:122–184
- 普通调用/委派准入：D:/projects/SYNC-THINK/apps/runtime/src/delegation-admission.ts:60–170
- 消息工具及待办定义：D:/projects/SYNC-THINK/apps/runtime/src/chat-tools.ts:368–479、862–915、1848–1881
- Peer 会话边界与粗资源锁：D:/projects/SYNC-THINK/apps/runtime/src/collaboration-chat-host.ts:102–119、359–399
- 消息生成 reply 任务：D:/projects/SYNC-THINK/apps/runtime/src/collaboration-chat-service.ts:169–200
- 并发/锁/等待：D:/projects/SYNC-THINK/apps/runtime/src/collaboration-chat-service.ts:526–566
- 产物验收：D:/projects/SYNC-THINK/apps/runtime/src/collaboration-chat-service.ts:611–652
- peer 策略与循环预算：D:/projects/SYNC-THINK/apps/runtime/src/collaboration-chat-service.ts:858–929
- Native 预算：D:/projects/SYNC-THINK/apps/runtime/src/runtime.ts:20081–20084、20321–20349
- 外部 usage：D:/projects/SYNC-THINK/apps/runtime/src/runtime.ts:21603–21605
- 委派入口、计数与深度：D:/projects/SYNC-THINK/apps/runtime/src/runtime.ts:26977–27046
- 超预算结果：D:/projects/SYNC-THINK/apps/runtime/src/runtime.ts:27106–27159
- TeamRun 记录入口：D:/projects/SYNC-THINK/apps/runtime/src/runtime.ts:9168–9201
- 冻结工作流与产物：D:/projects/SYNC-THINK/docs/adr/0002-collaboration-workflow-delivery.md
- 现有权限/嵌套设计约束：D:/projects/SYNC-THINK/docs/adr/0001-delegated-agent-write-policy.md；D:/projects/SYNC-THINK/docs/adr/0003-user-owned-agent-definitions-and-nested-teams.md

### DeepSeek Harness（固定提交的公开一手源）

仓库：`https://github.com/deepseek-ai/deepseek-harness`
固定提交：`639ed015397290b3745d163aafe02ffee4aa3f84`

在该提交读取：
- packages/experimental/agent-team/README.md：角色、日志、信箱、任务板、共享目录和限制。
- packages/experimental/agent-team/src/task-board.ts：revision CAS、领取/完成/重新指派的权限。
- packages/experimental/agent-team/src/mailbox.ts、journal.ts：持久化、顺序和重试去重。
- packages/experimental/tool-agent-team/src/index.ts：POLICY、wait noProgress、作用域化工具。
- packages/experimental/agent-team-profile/README.md、cordis.patch.yml：禁用重叠工具、profile maxMembers=8、已知 preset 限制。
- packages/subagent/README.md：与普通子智能体服务的层次关系。

本地只读克隆：C:/Users/zhuzhenyu/.codex/visualizations/2026/09/29/01a0eba8-16ae-7d11-9995-6e7f3aeaceb1/deepseek-research/deepseek-harness

