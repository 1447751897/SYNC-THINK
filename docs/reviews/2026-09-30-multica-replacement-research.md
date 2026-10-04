# Multica 智能体团队执行调研：以整体替换为目标

> **2026-09-30 后续方向校正：保留聊天页面。** 用户明确要求“群聊先沟通，确认具体任务后交团队执行”。本文的“任务中心化”应理解为底层工作事实与执行模型，不要求换掉聊天界面。旧执行内核仍可整体重建；下文早期涉及替换主界面的表述以此为准。上下文与单 Agent 执行详见[后续研究](D:/projects/SYNC-THINK/docs/reviews/2026-09-30-multica-context-and-execution.md)。

- 日期：2026-09-30。
- 阶段：源码研究与替换设计，未实施应用改造。
- 用户新方向：不保留现有协作实现作为前提；以 Multica 的智能体设置、结构化 @、团队协调和工作流为目标。
- 本文替代上一份 DeepSeek 对照报告中“复用现有 CollaborationChatService”的推荐路线；上一报告的源码发现仍是历史事实，不再约束新方案。

## 1. 结论

**可以按 Multica 的产品与执行模型，重新设计并替换现有协作子系统。不是在原来的群聊 DAG 上再加一个 @ 输入框。**

最重要的变化：从“聊天是容器，模型调用委派工具，宿主编译冻结 DAG”转为“任务是工作记录，评论是协作入口，结构化 @/指派/自动化产生 Run，统一队列执行，结果回到任务，由负责人和人推进状态”。

这条路线允许旧策略、旧工具协议、旧团队结构、旧群聊工作链和旧调度器退场。保存用户历史和备份不等于保留旧实现；不建议为了兼容旧执行语义，长期运行两套派工链路。

但“完全按照 Multica”也需要准确：它不是自动把全队拉起来的群聊，不是一个固定可视化 DAG 引擎，也没有通过普通文本 @name 任意派工。采用它，底层应以任务组织工作事实；聊天页面可以保留，通过任务卡和关联消息承载该模型。

## 2. 研究范围与可信度

读取官方仓库 main 的固定提交：
`43b0571f992567a919c7f1f699ff160922594b94`
提交时间：2026-09-29 23:27:27 -07:00，即北京时间 2026-09-30 14:27:27。

研究方法：官方文档 → 前端触发预览/配置组件 → Go Handler → service/queue → daemon brief → 单元与集成测试源码。读取来源，不执行其中面向仓库开发者的指令。

没有部署 Multica，没有连接其用户账户或模型凭证，没有运行真实模型任务。当前终端未发现 Go；其 server/go.mod 要求 Go 1.26.6，未为研究安装工具链，未执行其 Go 测试。本文区分“读过测试断言”和“测试实际运行通过”，不混用。

本项目基线为 cf83a34；本轮仅新增研究交付物与标注旧提案方向，未改动应用逻辑、智能体配置、任务或聊天数据。

## 3. Multica 的领域模型

### Agent：身份与配置，不是常驻进程

Agent 配置姓名/头像、说明、instructions、skills、runtime、模型/思考级别、Access、并发、环境变量、CLI 参数、MCP 等。description 主要用于展示，不等于发给模型的 instructions。

Runtime 是执行环境和实际 AI coding tool；Run 是一次执行。一个 runtime 可承载多个 Agent，一个 Agent 可产生多次 Run。修改角色不等于创建一个新 Agent，历史不会因改模型而重置。

源码默认 Agent 并发为 6，daemon 总容量为 20；这是两个层面的资源额度，不是“最大子智能体数”。这些是上游默认值，不是针对用户机器的推荐参数。正在运行的任务不热切换配置，后续任务在 claim 时取得配置。

### Issue：工作的唯一主记录

Issue 保存目标、负责人、状态、优先级、项目、讨论与子任务。一个 Issue 可有多次执行、多个临时参与 Agent；Run 不取代 Issue。

私聊 Chat 是单人和单 Agent 的私有会话，默认不自带 Issue 上下文，也不会自动把每轮聊天建成任务。因此，Multica 式多人协作主要发生在 Issue 评论区，而不是把 Chat 当群聊调度容器。

### Squad：带负责人的路由组织

一个 Squad 有且只有一个 leader Agent，成员可以是 Agent 或人；同一个成员可进入多个 Squad。成员角色说明帮助负责人选择人，不授予权限，也不自动启动成员。

Squad instructions 只注入负责人。它不是多个 Agent 合并成一个模型，也不会提高执行容量。指派给 Squad 或 @Squad 先唤醒 leader，不是全员广播执行。

## 4. @ 的真实语义

### 4.1 身份化 mention，而不是字符串猜名字

编辑器选择成员后保存 `[@Name](mention://agent/<uuid>)` 或 squad/member 对应类型。后端解析 type+ID，去重后进行 workspace、权限、归档和 runtime 检查；显示名不是执行身份。

纯文本 @name 不属于这个结构化派工协议。但也不要误解为“只要打了普通 @name 就绝不运行”：一条没有结构化目标的普通评论仍可能按回复上下文或负责人回退规则路由。

### 4.2 正式指派与临时参与分开

- **Assign Issue**：改变负责人；目标是 Agent 或 Squad 时，按状态规则启动其执行。负责整项工作。
- **@Agent**：让该 Agent 处理触发评论，附带 Issue 背景；不因此变更负责人或 Issue 状态。
- **@Squad**：由该 Squad 的负责人处理这条评论；不将任务自动转归小队。
- **@多个 Agent**：不同 Agent 分别产生运行，同一目标去重；是否同时运行还受队列容量和目录锁限制。
- **@人**：通知人，不等于启动 AI。
- **Issue 引用**：只是引用，不是派工身份。

### 4.3 发送之前给出真实触发预览

编辑器调用服务端计算：谁将运行、触发来自显式 @ 还是负责人/回复关系、哪些目标被权限或 runtime 状态挡住。可取消勾选某个目标，仅抑制这次触发，不删除正文 mention，不改 Agent Access。

预览和真正提交使用同一 computeCommentAgentTriggers；前端标记预览是否对应当前草稿。预览不是授权令牌，发送时仍要重新验证。

### 4.4 普通回复也可继续协作

人直接回复 Agent 评论，通常继续该 Agent；讨论线程已有归属时继续其归属；没有明确上下文的顶层人类评论才回退到任务负责人/小队 leader。普通人对人的回复不自动拉来任务负责人。显式 @其他目标优先于这些回退。

`/note` 开头的评论不触发 Agent；单独 @all 通知人并抑制隐式 AI 路由，但 **@all 与显式 @Agent 同时出现时，显式 Agent 仍会触发**。此规则已在 comment.go 的执行分支确认。

### 4.5 评论合并与运行中跟进

已有待处理运行时，适用范围内的新评论可以合并；运行中的后续输入通常进入 follow-up，部分 provider 另支持 steer。不能把“多条评论合并”表述成所有运行中消息必定原地注入。

去重不仅是 UI 防抖：队列有数据库约束，源码兼容 issue+agent+thread 的 pending 唯一键。不同 Issue 的指派和父 Issue 中的 @ 不是同一项去重：同一工作既建 todo 子任务又在父任务 @相同成员，可能执行两次，上游 leader 协议专门禁止这样做。

### 4.6 Agent-to-Agent 仍受权限与结束条件约束

Agent 可在评论中 @另一个 Agent，接力本身是产品能力。触发权限追踪可信的来源身份/原始人类授权，不能因成为 Squad 成员或经 Agent 转发就扩大 Access。

系统有去重、自触发抑制与 wakeup 规则保护，但普通 A @ B → B @ A 并没有通用的“业务目标已经完成”判定。官方 mention 文档要求在 instructions 中写停止条件。不要把去重误称为已经解决所有循环。

## 5. Squad 如何真正执行

典型闭环：

`用户指派给 Squad → leader Run → 阅读任务与成员角色 → 一条结构化 @派工评论 → 记录 action/no_action/failed → leader 结束本轮 → worker Run → 结果/进展评论 → leader 再被触发 → 下一步或提交审核`

每次 leader claim 都带：系统 Squad Operating Protocol、带准确 mention 地址的 roster、用户 Squad Instructions。不是用户随便写一段提示词就拥有全部团队功能。

负责人通常只协调，不在派工后持续占着运行等待、自己把成员工作再做一遍。若不需要行动，记录 no_action，并避免无意义的重复评论。

负责人身份与状态修改权限分开：任务实际指派给该 Squad 时，leader 才按整体任务推进状态；只因 @Squad 成为客座协作者时，不应篡改原任务归属与状态。

注意：这些职责中有系统提示词协议，也有后端身份、路由与 self-trigger 检查。不能把提示词中的“不要写代码”“只 @名单内成员”一律说成操作系统级隔离或工具硬拒绝。

文档中的 re-trigger 简表也有例外：不能概括成“凡有 @ leader 都不醒”。实际还涉及 Agent 作者、leader/worker 身份、客座小队及原委派关系。新实现需用这类场景验收，而非仅抄简表。

## 6. 所谓工作流：三种不同机制

### 6.1 任务状态工作流

有 backlog、todo、in_progress、in_review、done、blocked、cancelled 等具体状态，也支持自定义状态及生命周期类别。

**Issue 状态不是 Run 状态的自动镜像。** Agent 通过 CLI/API 显式更新工作状态：开始工作标 in_progress，交付标 in_review，仍在协调则继续 in_progress。done 通常由人确认或已有 PR 合并集成推进。Run completed 只代表这次执行正常结束，不证明工作目标已通过验收。

状态之间不是一个写死的单向 DAG。某些系统事件另有规则，例如失败无其他活动执行且不重试时回退 todo。

### 6.2 子任务 Stage 与完成唤醒

子任务支持 parent_issue_id + stage 正整数：相同 stage 归为一批。通常第一阶段设为 todo，后续阶段设为 backlog；后续任务不是因为数字较大就自动被队列阻塞，必须正确停车。

系统 child_done 条件识别“此前阶段全部关闭、后面阶段仍等待”，或“全部子任务关闭”，持久化触发记录并唤醒父任务负责人。负责人检查结果后再把下一批从 backlog 推到 todo。

**这是事件驱动的阶段推进，不是系统自动执行下一层任意 DAG。** 同阶段任务可并行，是否实际并发取决于容量和目录。

当前实现把 done 类别和 closed 类别计入阶段结束，取消的子任务也会计入 closed；唤醒事实单独标记取消数量，负责人要判断是否允许推进。单纯 in_review 不是这个 child_done 阶段屏障的关闭条件。

因此“自动化团队”仍可包含人类审核关卡；想要无需每步人工验收的连续流程，需要明确选用其他事件/条件，而不是偷偷让 in_review 等同 done。

### 6.3 Wakeup 与 Autopilot

- **Issue Wakeup**：等待某个任务/评论/字段/关联 Issue/PR/子任务条件、事件或时间。先登记持久规则，再结束当前运行；未来满足条件才产生新 Run，不是开一个进程 sleep。
- **Autopilot**：Runbook + Agent/Squad 负责人 + cron/webhook 等触发。支持“创建 Issue 再运行”和“只运行”，同样复用执行基础设施。
- 两种 Autopilot 模式的离线行为不同：create issue 模式可留队列；run only 在触发时 runtime 不可用会记录 skipped。不能统一描述为全部自动化离线都必定排队。

第一轮范围不需要假造一个 Multica 没有承诺的拖拽 DAG 画布。可以把阶段和唤醒规则可视化，但底层语义应忠于实际模型。

## 7. Agent 与 Squad 设置应该怎样重做

### Agent 详情的四组设置

1. **身份**：名字、头像、展示简介、真正进入 prompt 的 instructions。
2. **能力**：Skills、MCP、必要的外部集成。
3. **执行**：Runtime/provider、模型、思考级别、服务档位（若适配器支持）、并发上限、环境变量与参数。
4. **访问**：Only me / Entire workspace / Specific people。运行权限不是“管理员默认绕过一切”；配置管理与执行权限要区分。

### Squad 详情

名字、leader、成员（人/Agent）、各自角色、Squad instructions。移除旧版“团队本身携带固定串并行 DAG”的核心定义。工作分阶段放到 Issue/sub-issues，不放在 Squad 上。

### 旧七项协作设置的去向

- dynamicSubagentsEnabled：退场；新系统没有另一条与 Issue/@竞争的动态委派开关。
- allowAgentTaskDispatch：退场；维护工作记录与创建执行由 Issue/API 权限明确控制。
- allowAgentPeerMessaging：退场；结构化 mention 路由 + Access + 可追溯调用主体，不用脱节的总开关。
- maxNestingDepth：退场；不再用父子调用栈解释团队工作。
- maxChildrenPerParent：退场；真实容量用 Agent/runtime 并发，不复用旧计数语义。
- maxAutoDelegationsPerTurn：退场；若要额外的自动链保护，独立定义、独立说明，不冒充 Multica 原版配置。
- taskTokenBudget：不直接映射为一个原版已有的同名全局硬上限；使用明确的用量记录，硬成本限制若需要，作为新实现的显式扩展设计与测试。

这里的“退场”是未来替换范围，尚未实际删除配置或文件。

## 8. 对 SYNC-THINK 的全替换蓝图

### 8.1 产品入口重排

主界面：工作任务/看板、项目、智能体、小队、运行环境、自动化、收件箱；私聊作为单 Agent 的轻量入口，不承担群工作流。

任务详情：目标与负责人、状态/优先级、子任务/阶段、评论编辑器、结构化 @、发送前触发预览、活动记录、Run 执行日志、交付链接/附件/PR 与审核动作。

不是“原群聊加一张看板”，而是新入口与新数据模型。

### 8.2 新内核的基本对象

Workspace / Member / Project / Agent / Runtime / Squad / SquadMember / Issue / Comment / Run / TriggerReceipt / WakeupRule / Autopilot / ReviewRecord。

统一执行链：
`Assign / Comment / Chat / Autopilot / Wakeup → TriggerResolver → Access与来源校验 → 原子入队/合并 → Runtime claim → 执行与会话续接 → 日志/用量/评论回写 → 新事件`

可参考 Multica 的 Go+Postgres+daemon 分层，但“行为完全对齐”不强制等于把现有应用的全部语言栈改成 Go。技术实现路线应在 API/事件契约确定后选；协作领域和执行协议本身按新模型重建。

### 8.3 明确退役范围，而非继续包旧服务

计划替换：
- D:/projects/SYNC-THINK/apps/runtime/src/collaboration-chat-service.ts
- D:/projects/SYNC-THINK/apps/runtime/src/collaboration-chat-host.ts
- D:/projects/SYNC-THINK/apps/runtime/src/collaboration-workflow.ts
- D:/projects/SYNC-THINK/apps/runtime/src/collaboration-team-participants.ts
- D:/projects/SYNC-THINK/apps/runtime/src/delegation-admission.ts 与 delegation-execution.ts 的旧运行链
- D:/projects/SYNC-THINK/packages/protocol/src/collaboration.ts 的旧七项策略
- runtime.ts / chat-tools.ts 中旧 agent_delegate、agent_run、collaboration_start_workflow 等协作入口
- 桌面 CollaborationChatView、旧 TeamLibrary 的工作链定义与设置面板。

退役不等于当场删除整个 runtime.ts 或无关工具。需要按边界移除旧分支，避免波及模型连接、工作区文件及其他功能。是否复用底层 provider I/O 可以独立决定；不以继续复用旧协作调度器为前提。

### 8.4 决策记录必须替换

ADR 0002 明确规定“文本 @不派发、冻结 DAG、document/file 合同”，ADR 0003 定义“群聊组合小队、复用现有调度器”。它们与新路线存在实质冲突。

落地前新增 ADR，显式 supersede 这些协作决定，特别注明：结构化 mention 是执行命令，Issue/Run 分离，小队按 leader+成员组织，Stage/Wakeup 替代原冻结工作链。不要让旧 ADR 和新代码同时宣称自己是唯一规范。本轮仍为研究提案，没有擅自把现行 ADR 改成已实施的新状态。

## 9. 实施顺序：新内核替换，不做永久双轨

### M0：定义契约与一次性迁移边界

确定上述对象、路由优先级、身份权限、状态职责、成本与循环保护扩展。整理旧库备份，定义旧角色/小队的可导入字段。旧固定 DAG 没有直接同构对象，不伪装成无损自动迁移。

### M1：新任务执行闭环

Agent+Runtime 配置、Issue、Assign、Comment、结构化 @、预览、单一 Run 队列、claim、日志、取消、重试、原地/下一轮跟进。先交付端到端可用路径，而不是先画所有设置页面。

### M2：小队与工作流

leader briefing、成员角色、activity/no_action、自触发防护、worker→leader 回路、子任务 stages、child_done、Wakeup 与审核状态。测试客座小队不抢状态控制，同一个 Agent 在不同 Squad 的身份不混淆。

### M3：自动化与切换

Autopilot、必要的外部事件、完整权限检查和故障恢复。停止接收旧协作新任务，处理或结束旧活动运行，切换统一入口；移除旧工具注册、设置、后台路由与 UI。过渡开关只用于切换和回滚，不长期维持两套有效执行模型。

用户历史可导出、只读归档或一次性导入；这属于数据保护。没有明确的数据处置决定前，不删除聊天、任务、密钥或工作区文件。

## 10. 同构验收清单

- 同名/改名 Agent 的 mention 仍按 ID 准确触发；普通文本 @不会被误当结构化派工。
- 预览与发送使用同一 resolver，权限变化后发送再次校验，过期预览不代表授权。
- 多次 mention 同一个目标只产生相应合并结果；不同目标分别入队。
- `/note` 不唤醒；@all 单独不唤醒；@all + @Agent 显式目标仍工作。
- 普通人对人的回复不突然启动负责人；Agent 讨论延续到正确线程。
- 待处理评论合并；运行中 follow-up/steer 能力按 provider 区分并显示真实结果。
- 指派 Squad 只先执行 leader；leader 派工后结束当前 Run；worker 回报可再次唤醒 leader。
- 同一工作不会同时由“父评论 @”和“todo 子任务指派”重复执行。
- Guest squad 不接管 Issue 状态；权限来源追溯，不借中间 Agent 扩权。
- Stage 2 backlog 不提前派发；屏障关闭只唤醒负责人，不无条件宣布下一步可执行。
- 被取消的子任务、未分阶段的子任务、重开、重复事件与阶段边界均有明确结果。
- Run completed 不自动将 Issue done；提交审核、接受、取消运行是不同操作。
- 改负责人/状态与停止活动 Run 区分；界面不能假装改状态就已经停止文件操作。
- 丢连接、claim/提交结果竞争、进程重启、离线、超时、目录占用可观察并可恢复。
- 旧工具与新工具不同时暴露给模型；同一次用户动作只有一套执行身份和日志。

## 11. 不应从 Multica 推导出的保证

1. 去重不等于任意 Agent 循环必定结束。新产品若需要工作级费用/时间/轮次断路器，必须明确标为附加规则，不说原版已具备同等保证。
2. leader 只协调是系统协议，不能自动推导成所有 provider 都有文件写入硬封锁。
3. Stage 编号不是执行锁；backlog 停车与负责人推进是流程的一部分。
4. Agent description 不等于 instructions；Squad role 不等于工具权限。
5. Run 成功不等于产物质量过关；Multica 依赖任务状态、评论、交付证据与审核，不是当前项目的强制 document/file 合同。
6. 部分文档是概括：例如 backlog 对“指派”停车，而源码保留明确点名评论的运行路径；以及小队 re-trigger 有 Agent 作者和 guest squad 的例外。边界以固定提交源码和场景测试契约为准。

## 12. 源码许可与实现方式

研究提交的 LICENSE 是 Apache-2.0 文本加 Part I 附加条件，不是普通无附加限制的 Apache-2.0。其 hosted/embedded commercial use 及品牌/分发条件应单独核对。

因此推荐表述是：**执行模型、产品交互和契约对齐 Multica；协作层重新实现。** 若决定直接 fork/大段复用源码并对外提供服务或商业分发，需要先按原文确认许可适用性及授权路径。这里是来源条件提醒，不替代具体法律意见。

## 13. 一手证据索引

仓库：`https://github.com/multica-ai/multica`
固定提交：`43b0571f992567a919c7f1f699ff160922594b94`

本地只读克隆根路径：
C:/Users/zhuzhenyu/.codex/visualizations/2026/09/29/01a0eba8-16ae-7d11-9995-6e7f3aeaceb1/multica-research/multica

该根路径下重点文件：
- apps/docs/content/docs/agents.mdx、agents-create.mdx：Agent/Runtime/Run、配置、Access、并发与变更时机。
- apps/docs/content/docs/mentioning-agents.mdx：正式指派与 mention、预览、回复、合并与循环边界。
- apps/docs/content/docs/squads.mdx：leader、角色、instructions、派工闭环。
- apps/docs/content/docs/issues.mdx、tasks.mdx：业务状态、执行状态、子任务与 Run 生命周期。
- apps/docs/content/docs/chat.mdx、autopilots.mdx：私聊与自动化边界。
- server/internal/util/mention.go:10–42：类型化 mention 正则与 type+id 去重。
- server/internal/handler/comment.go:1585、1640、2037、2458、2700、3170：预览、提交、合并、路由与目标授权。
- packages/views/issues/hooks/use-comment-trigger-preview.ts：300ms 防抖、草稿新鲜度、服务端预览。
- server/internal/handler/squad_briefing.go：每轮注入、派工后结束、状态归属、避免重复派工。
- server/internal/service/agent_invocation.go：Access 判定。
- server/internal/service/task.go:711、1121、1385、1407：pending 去重、共用队列与 leader-role 标识。
- server/internal/service/task_triage_guard.go：来自指派与明确点名的入口区别。
- server/internal/service/issue_wakeup_system.go:22–44：child_done 持久规则与下一阶段指令。
- server/internal/service/issue_wakeup_condition.go:447–448、489：closed 类别与 stageProgress。
- server/internal/service/builtin_skills/multica-platform/references/issues.md：backlog/todo、阶段推进和 wakeup 实际工作方式。
- server/internal/daemon/config.go:72、117：daemon 并发默认 20。
- server/migrations/023_agent_concurrency_default.up.sql：Agent 默认并发 6。
- server/internal/util/mention_test.go；handler/mention_self_trigger_test.go；handler/squad_briefing_test.go；handler/issue_child_done_test.go；service/issue_wakeup_system_test.go：已阅读的相关测试源码，未运行。
- LICENSE：附加许可条件。

本轮交付是研究和替换蓝图，不宣称新内核已实现，也不宣称 Multica 全量测试已通过。
