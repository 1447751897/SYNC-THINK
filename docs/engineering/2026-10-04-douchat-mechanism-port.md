# DouChat → SYNC-THINK：机制探索与接入方案

日期：2026-10-04。状态：**完成本轮源码探索；未实现机制迁移，未替换或重构产品页面。**

> 后续决定（2026-10-04）：用户已将移植搁置，继续优化 SYNC-THINK 自有群聊。本文保留为历史研究，不作为当前实施计划；不启动上述移植切片。

## 1. 范围与结论

用户需要的是：把 DouChat 的团队沟通、工作流、成员档案和记忆接入 SYNC-THINK；保留原来的页面、聊天、智能体/小队、模型/内核、权限与数据。无需 DouChat 账号、托管决策服务或独立桌面入口。

结论：可行。采用“移植纯机制 + 适配现有执行宿主”，不是整应用移植。现有 collaboration 服务已经有投递、交接、咨询、依赖、持久化尝试和恢复；主要缺口在会话决策、结构化档案、消息可见性和记忆归属。单独增加五个编辑标签不会带来这些能力。

上轮独立桌面路线已撤回：关闭了错误预览窗口，撤销了根目录 local:* 脚本及对应启动器。vendor/douchat-local 保留为源码参考及历史预览数据保存位置，不是产品入口。原 SYNC-THINK 的页面没有被这次导入覆盖；本轮也没有修改业务代码、清理用户已有改动、重启应用或迁移真实数据。

### 对照版本与证据口径

- 上游固定提交：`8dfe9715ff12cc8f03d028610c8e0cf1cb018ae4`，版本 0.1.23；不把它描述成永久的“最新版本”。
- Git 源码对照目录：[上游 checkout](C:/Users/ZHUZHE~1/AppData/Local/Temp/codex-douchat-review-5f93b4e1)。已检查 Git：受跟踪文件没有本地修改，只有历史研究的未跟踪测试配置。
- 下文主要纯机制/存储文件已逐字节核对，与 [vendor 参考目录](D:/projects/SYNC-THINK/vendor/douchat-local) 相同。vendor 的运行时和本地化默认设置存在上一轮修改；上游运行时行为以固定提交的 Git 文件为准。
- SYNC-THINK 结论针对当前工作区源码，保留其已有未提交改动。测试是模拟执行与临时数据库，不是真实模型验收。

## 2. 一个 DouChat 团队实际怎样运行

流程是：人类消息 → 明确寻址/会话连续性 → 隔离的控制器决策 → 成员执行或任务依赖图 → 公开回复/私有投递 → 判断继续、完成、等待人类或局部恢复。

1. **先确定该叫谁。** 新版工作流中，消息开头唯一有效 @ 可以直达成员并跳过首次控制器调用。没有明确寻址时，把上一轮请求和唯一响应者等连续性证据交给决策层；不是固定“永远叫负责人”，也不是无条件续接上一个人。
2. **控制器不等于负责人在群里说话。** 决策调用不启用工具、不加载成员人格全文或私有记忆；它只拿公开上下文、角色/能力元数据和私有投递信封。输出包括 none/single/parallel/sequential、成员、任务依赖、等待用户等结构。服务端还会校验成员、消息引用、图和能力要求。
3. **执行成员才拥有自己的上下文和工具。** 单聊、群/话题成员、控制器的会话键分开；新版图任务还在成员键下加 workflow/task 维度，避免跨任务混用执行历史。
4. **成员可以交接，不靠全员轮流表演。** 公开 @ 或有效的私有请求可触发定向交接；inform 只传信息，不唤醒。是否需要开场、多人贡献或最终整合，由实际任务决定。
5. **复杂任务是有界 DAG。** 前置成功才启动后续节点；同一实际成员互斥；取消/失败时不继续解锁新节点。上游图最多 32 节点、最多 4 个活跃节点。group.ts 的默认执行预算是 16，但实际 main/runtime.ts 调用传入 maxTurns=128；移植时应同时核对默认常量与实际调用。
6. **恢复不是重跑所有人。** journal 保存决策与成员调用结果，完成的槽位复用；被中断且可能产生外部副作用的成员槽位不自动重放。旧工作流按 schedulingVersion 保留原寻址/执行语义。

例：视觉策划与技术可行性分析可先并行；代码渲染依赖策划；质检依赖代码结果；必要时再整合。只有被调度的成员执行，前置失败后面的成员不会凭空拿“成功结果”继续。

源码定位：
- [group.ts](D:/projects/SYNC-THINK/vendor/douchat-local/src/shared/bot/group.ts)：groupConversationContinuity、directGroupDecision、runGroupConversation、groupDecisionPrompt。
- [groupTasks.ts](D:/projects/SYNC-THINK/vendor/douchat-local/src/shared/bot/groupTasks.ts)：validateGroupTasks / executeGroupTaskGraph。
- [privateMessages.ts](D:/projects/SYNC-THINK/vendor/douchat-local/src/shared/bot/privateMessages.ts)：parsePrivateReply / privateContext。
- [groupWorkflow.ts](D:/projects/SYNC-THINK/vendor/douchat-local/src/main/groupWorkflow.ts)：GroupWorkflowJournal。
- [上游运行时](C:/Users/ZHUZHE~1/AppData/Local/Temp/codex-douchat-review-5f93b4e1/src/main/runtime.ts)：3495/3524 工作流版本；3708 成员任务会话键；3826–3885 执行及 journal 接线。

## 3. 截图里的档案编辑，不只是五个文本框

- SOUL.md：性格与行为；IDENTITY.md：明确身份、职责；BOOTSTRAP.md：引导指令。IDENTITY 的明确身份优先，联系人显示名只作未定义字段的回退。引导文件在该版本是提示内容，**不是只执行一次的初始化器，也不自动开启工具/后台任务**。
- 自定义系统文件会进入成员的实际提示装配；USER.md/MEMORY.md 被排除在普通人设拼接之外。
- 自定义页中的用户资料/记忆只读，展示此用户与此智能体的记录；写入走独立记忆协议。上游代码还有 TOOLS/AGENTS/HEARTBEAT 等编辑项，其存在不等于宿主自动执行其中命令。
- Markdown 档案落盘为权威来源，首次从旧 JSON 初始化；临时文件 + rename 与批次 journal 处理写入/中断；UI 提交 expectedSystemFiles，宿主拒绝旧快照覆盖新编辑。
- 除手动编辑外，上游还支持受控的对话内档案变更：须有当前人类指令证据及 previous 内容匹配，而不是让成员随意改其他智能体身份。

SYNC-THINK 接口与运行时定位：
- [GlobalAgent](D:/projects/SYNC-THINK/packages/shared/src/types/team.ts) / [定义存储](D:/projects/SYNC-THINK/packages/storage/src/global-agent-store.ts)：现有 persona，无分文件档案与修订字段。
- [桌面 payload](D:/projects/SYNC-THINK/apps/desktop/src/team-payloads.ts) / [编辑器](D:/projects/SYNC-THINK/apps/desktop/src/renderer/shell/AgentLibrary.tsx)：现有“能力 → 人设指令”，约 1569/1727 行，是 UI 承载位置；保留原组件和布局。
- [runtime.ts](D:/projects/SYNC-THINK/apps/runtime/src/runtime.ts)：26270/26543 读取定义并绑定到本次 run；9513 的 buildRunAgentInstructions 是共同提示装配点；23382 外部内核、32897 原生执行均调用它。
- 外部内核的 resolveKernelConversationSession（23124）已有 contextHash 变化 → catchUp 更新路径。档案修订应参与此上下文，而不是只改表单后继续复用旧内核人设。

建议：扩展现有定义/存储/协议，使用单一权威存储与 revision 冲突校验；兼容旧 persona，明确新旧优先级及显式清空语义。每次新 run 固定档案快照，下条消息读新版本，不在执行一半时悄悄替换身份。若用 SQLite 为权威、Markdown 为导出，这是适配方案，不应宣称逐字照搬了上游落盘实现。

## 4. 记忆：分库存储不等于永远不共享

基础层分为主人共享资料、主人 × 单智能体记忆、主人 × 群记忆。记录有事实 key、证据、修订和历史；记住/纠正/忘记由宿主校验当前人类消息，写入主人共享层须有明确的跨智能体共享意图。私聊记忆还维护有界摘要及按日历史文件；该路径用分词/关键词匹配检索，不必为了这次移植先引入向量数据库。

**重要补充：这个提交还有“同主人内部共享”分支。** internalMemorySnapshot 会在本机验证只有主人与自己智能体的内部会话中，检索同账号其他智能体、群的记忆与相关会话片段，按相关性和预算提供给成员。外部、远程/共享群不走这条分支；群内外 audience 变更会切换记忆视图。因此“上游群永远读不到单聊记忆”的说法不准确。

这与 SYNC-THINK ADR 0004 的任务群隔离存在真实政策差异。建议把内部共享作为用户可见、可关闭的普通会话策略；默认保持任务群隔离，跨任务引用须显式选择。此处是接入建议，**不是已实现功能，也不是对上游默认行为的描述**。本轮没有决定废除既有任务室隔离规则。

现有 [memory-store.ts](D:/projects/SYNC-THINK/packages/storage/src/memory-store.ts) 以 workspace/task 和 task/project/global 管理已批准记忆，没有 agentId/groupId/audienceId；[personalization-context.ts](D:/projects/SYNC-THINK/apps/runtime/src/personalization-context.ts) 是全局用户信息，不是单体记忆。runtime.ts 的 25992 分支已避免给任务群自动装配项目记忆。应保留原记忆审批/撤销链，增加归属维度与受控读取，别替换它或把五份文件统一塞进全局 prompt。

源码：[userMemoryStore.ts](D:/projects/SYNC-THINK/vendor/douchat-local/src/main/userMemoryStore.ts)、[userMemoryFile.ts](D:/projects/SYNC-THINK/vendor/douchat-local/src/main/userMemoryFile.ts)、[groupMemoryStore.ts](D:/projects/SYNC-THINK/vendor/douchat-local/src/main/groupMemoryStore.ts)、[内部共享](C:/Users/ZHUZHE~1/AppData/Local/Temp/codex-douchat-review-5f93b4e1/src/main/internalMemory.ts)、上游 runtime.ts 2393–2415/2604。

## 5. 沟通：收件人、唤醒、可见性是三个维度

SYNC-THINK 已有 notify/handoff/consult：通知不启动执行；交接启动目标；咨询等待并回到请求者。已有显式成员/提及、回复目标路由、工作续接和幂等回执。

当前 send（[service](D:/projects/SYNC-THINK/apps/runtime/src/collaboration-chat-service.ts) 167–174）的默认路由顺序是明确收件人/提及 → 明确回复作者 → 唯一未结束生产任务成员 → 协调员。它没有 DouChat 那种“上一轮已结束的唯一响应者 + 新话题/追问判断”。这个补丁应在任务准入之前，不是 UI 上换一个按钮。

另外，[消息类型](D:/projects/SYNC-THINK/packages/shared/src/types/collaboration-chat.ts) 98–125 没有 private audience 字段；[task-room.ts](D:/projects/SYNC-THINK/apps/runtime/src/task-room.ts) 37–65 根据序号和 kind 选历史，并不按收件人过滤正文。因此**给 B 发消息 ≠ 只有 B 可以读**。现有成员私聊子会话是另一个能力，也不自动等于同群的私有投递。

上游 privateContext 限定投递正文只给发送者/接收者；控制器只看信封。其流式解析会暂扣不完整私有标记，正文不进公开回复。接入应同时覆盖持久化/read、context、事件流、工作日志/进度、侧栏预览及搜索/导出；只在模型 prompt 里写“别泄露”不够。私有投递开启前必须完成这一整条可见性链。

## 6. 适配边界与落地顺序

### 复用的底座

- 投递/咨询/交接、实际执行者身份、命令回执和持久化 attempts。
- 依赖成功判断、停止/超时、进程中断标记与显式恢复；不再安装第二个 journal/调度服务。
- 权限、资源锁、原生/外部内核、当前模型设置和本地数据，无 DouChat 登录/云服务依赖。
- 现有小队可作为群成员，小队内部使用带命名空间的成员 ID 和 teamSnapshot；保留 [collaboration-team-participants.ts](D:/projects/SYNC-THINK/apps/runtime/src/collaboration-team-participants.ts)，不把它无条件压成上游扁平 roster。

### 需要明确适配的差异

- 上游成员生成的文本成果可成为任务结果；SYNC-THINK 的正式生产任务要求 document/file 交付。普通回答走 discussion，只有明确工作意图/获准工作流进入 production。@ 和人设不产生写权限。
- 现有 host.command/service.send 是同步命令。建议增加持久化的异步决策阶段，先回执保存消息，再执行控制器；按触发消息/决策阶段去重，落地前重新校验成员、上下文和暂停/取消状态，不在 SQLite transaction 中等模型。
- 现有全局/房间预算保留：最多 64 个展开节点、工作区并行至多 3；上游的 4/128 不直接成为新默认。
- 现有 service 861–864 对非正式 task 的同房间同成员回复互斥；生产 task 主要依赖资源 claims。这不是上游“同成员所有图节点互斥”，须补按房间/成员的互斥，且不锁死同一智能体在其他房间的工作。
- 上游可选举 leader 并更新会话负责人；现有 host 在未结束工作期间阻止正式协调权转移。首版区分单轮执行负责人和永久协调员，接管必须有可审计且一致的状态转换。

### 建议四个增量切片（每片都有运行时验收）

1. **档案贯通**：类型/存储/协议 → 原编辑区 → 共用提示装配 → 私聊/群成员/外部内核下条消息生效。旧 persona/模型/权限/历史保留；并发保存冲突可见。
2. **普通群会话决策**：独立无工具 GroupDecisionPort，复用现有模型/内核；使用单独的控制器提示装配，成员的 persona/全局 personalization/私有记忆不自动进入控制器。外部 CLI 的独立会话、工作目录和工具禁用需实际验证；明确 @、回复、连续追问、新话题、none/等待人类；决策进入现有 discussion 执行，不强制交文件、不无端全员响应。
3. **私有投递 + 分作用域记忆**：先补宿主全链路 audience 过滤，再启用私有 request/inform；记忆增加 owner/agent/group/audience 与修订，明确内部共享开关。控制器不拿私有正文/成员记忆。
4. **协作图与恢复**：把上游决策图映射到现有任务/交付与小队展开；同成员互斥、失败依赖不解锁、完成节点不重做、取消/重启不重复外部动作。

不得把第二片的公开协作演示当作第三片的隐私验收；不得把之前独立 DouChat 窗口的测试当作 SYNC-THINK 的移植验收。

相关约束：[ADR0003](D:/projects/SYNC-THINK/docs/adr/0003-user-owned-agent-definitions-and-nested-teams.md)、[ADR0004](D:/projects/SYNC-THINK/docs/adr/0004-task-room-execution.md)、[ADR0005](D:/projects/SYNC-THINK/docs/adr/0005-conversational-work-handoffs.md)、[ADR0006](D:/projects/SYNC-THINK/docs/adr/0006-collaboration-workspace-binding.md)。本轮未修改这些决策。

## 7. 本轮基线验证与后续验收

已用项目管理的 Node 20.20.2、Vitest 2.1.9 运行当前源码的模拟测试；fixture 是临时数据库/内存仓库/脚本执行器，未调用真实模型。

- collaboration-peer-messaging：17；task-room：26；conversational-handoff：10。**3 文件 53 测试通过**。
- memory-store：6；team-model：18。**2 文件 24 测试通过**。
- personalization-context：**2 测试通过**。上述共 6 个文件、79 个通过断言，不重复计算重试。
- collaboration-runtime-execution：**未进入断言执行**；Windows esbuild 转换 runtime.ts 时删除临时文件返回 Access is denied，换独立临时目录和单 worker 重试仍复现。此套件不计入通过，未为研究修改源码或依赖规避问题。
- 初次从根目录跑路径过滤额外匹配了旧备份/worktrees，导致这些副本缺依赖；随后改在各包根目录并限制 --dir src，最终基线只统计目标 checkout 的结果。未删除旧副本。

可重跑：在 D:/projects/SYNC-THINK/apps/runtime，以管理 Node 执行 D:/projects/SYNC-THINK/node_modules/vitest/vitest.mjs，`run src/collaboration-peer-messaging.test.ts src/task-room.test.ts src/collaboration-conversational-handoff.test.ts --dir src --pool=forks --maxWorkers=2 --minWorkers=1 --testTimeout=15000`。存储包在 D:/projects/SYNC-THINK/packages/storage 同样限定 src，只选 memory-store/team-model。

JSON 证据：[runtime](C:/Users/zhuzhenyu/AppData/Local/Temp/sync-think-douchat-exploration-20261004/runtime-baseline.json)、[storage](C:/Users/zhuzhenyu/AppData/Local/Temp/sync-think-douchat-exploration-20261004/storage-baseline.json)、[上下文及环境限制](C:/Users/zhuzhenyu/AppData/Local/Temp/sync-think-douchat-exploration-20261004/context-baseline-retry.json)。

实施后的验收入口只在**原 SYNC-THINK**：编辑身份且沿用旧会话验证 → @只唤醒目标/追问留给合适成员/新话题重路由 → notify 静默与 consult 回流 → 私有正文不出现在第三方模型上下文或公共日志 → 同智能体两群不串记忆 → 明确开启内部共享的普通聊天与任务群隔离分别验证 → 依赖失败/停止/重启保留结果并避免重复动作。

当前这些新增能力尚未落地，基线通过只证明现有底座在本轮选定测试中可复用。
