## 当前状态：多智能体协作第二阶段通信与管理闭环已完成（2026-09-21）

### 本轮续接结果

- 原线程第 4 阶段的外部 Kernel 协作工具通道、构建、迁移和第一阶段自动化验收已确认完成；本轮继续 `PLAN.md` 第二阶段。
- 已完成群内智能体关联单聊开关、父群消息引用、策略关闭撤销排队投递、成员与父群权限复核、消息级失败重试、真实 SQLite 任务重试修复、规划批准自动生成任务以及活动中心跨会话协作任务投影。
- 关联单聊已有消息和执行历史在关闭开关后保留；运行中的任务继续，后续发送/分派/重试被拒绝。Runtime 启动时会清理策略关闭期间遗留的排队子会话工作。
- 批准正式规划时，Runtime 使用稳定请求 ID 将指定 revision 的步骤幂等转换为顺序依赖的协作任务。任务保存 `planId / revision / stepId`，当前计划步骤没有执行者字段，因此统一交给会话协调成员；批准响应返回任务 ID，Desktop 据此跳过普通执行轮，避免重复执行。
- 模型协作会话的协调任务保持会话 `modelId` 与 model track；智能体单聊/群聊继续绑定实际执行成员的 Agent 配置。
- 长历史和 Runtime 重启恢复继续复用现有持久协作快照、`contextSequence`、attempt 状态和 `recover()`，没有新增第二套存储。
- 定向验证：Runtime 60 项、Desktop 28 项、Protocol 3 项、Protocol/Runtime/Desktop 类型检查和 Shared/Protocol 构建通过；966 文件架构门禁及 13/13 包整仓构建通过。Desktop initial/total JS 为 2,135,889 / 3,008,252 字节。Electron PID `58868` 与 managed Runtime PID `3340` 已于 21:33 使用最新产物干净启动，二者均正常响应，启动错误日志为空。

## 历史状态：高内聚、低耦合架构重构阶段已完成（第一百八十二批）

### 阶段收口审计（2026-09-20）

- 最初审查中的 P0/P1 性能与竞态、R-1～R-6 重复边界、D-1～D-19 已确认死代码/兼容入口以及 B-1～B-4 可复现缺陷均已关闭或明确保留；生产依赖图无循环，956 个源码文件受架构门禁约束。P2/P3 巨型文件继续存在，但已具备独立用例、投影、注册表、Repository、窄端口和 Main 注册边界，不再以继续拆空或任意行数作为本阶段完成条件。
- 累计 340 个 Runtime/Desktop 调用点复用专属边界，移除 49 个门面转换/适配方法、43 个原始状态容器（含 1 个纯写入死状态），合并 1 份重复协调模块；`runtime.ts` 当前 32,439 行。后续只在真实变更热点、缺陷或性能证据出现时渐进拆分。
- 最终门禁：第 182 批 54 项定向回归、Runtime 类型检查、210/210 架构测试、956 文件扫描、13/13 包构建、全仓 typecheck 22/22 task 和 `git diff --check` 通过；Electron PID `67332` 保持响应，未为纯架构改动重启。
- 非本阶段阻塞的独立债务：全仓 lint 11/13 task 通过，未修改的基线文件仍有 7 个 error（Core 1、Desktop 6）和 22 个 warning；全仓 test 19/22 task 后由 Storage rollback 临时库 `EBUSY` 停止，失败文件串行加长超时复跑为 8/9 通过、1 项仍在 Windows 删除临时备份库时被占用。这两项应作为独立质量任务处理，避免与架构拆分混改。

### 续接记录（2026-09-20，第一百八十二批 Kernel Conversation Session Repository 解耦）

- 新增 `KernelConversationSessionRepository`，集中外部 Kernel 会话记录的持久格式解析、字段归一化、设置仓读穿缓存、保存替换和带期望 session ID 的条件删除；返回前一记录，让 Runtime 继续拥有 Gateway continuation 的释放编排。
- Runtime 的会话加载、保存和清除 3 个调用点改用 Repository，删除原始 `kernelConversationSessions` Map 与门面内解析函数；持久 key、tombstone、fingerprint 和续接语义保持不变。文件由 32,512 行降至 32,439 行。
- Repository 9 项、Kernel session gap 12 项、external kernel run 33 项，共 54 项定向回归通过；Runtime 类型检查、lint/format、210 项架构测试、956 文件扫描和 13 包整仓构建通过。Desktop initial/total JS 保持 2,108,851 / 2,978,620 字节，Electron PID `67332` 未重启并保持响应。
- 本批完成后停止新增拆分批次；最终完成度审计已确认最初高内聚/低耦合强制项关闭，剩余巨型门面瘦身只按后续真实变更或性能证据渐进处理。

### 续接记录（2026-09-20，第一百八十一批 Goal Execution State Registry 解耦）

- 新增 `GoalExecutionStateRegistry`，集中 Goal 内存缓存、Run→目标修订绑定与待续轮标记；`takeRunRevision` 将原分步 get/delete 收敛为一次性领取，缓存替换与不同会话待续状态保持隔离。
- Runtime 的 Goal 加载/保存、usage 归属、暂停/清除、续轮调度和终态判断等 17 个调用点改用注册表，删除 `activeGoals`、`goalRunRevisions`、`pendingGoalTurns` 三份裸状态；设置仓持久化、Token/轮次限制和模型执行仍由既有边界负责。文件由 32,510 行增至 32,512 行。
- Registry 与内核准入共 9 项、Runtime 类型检查、lint/format、209 项架构测试、955 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 保持 2,108,851 / 2,978,620 字节，Electron PID `67332` 未重启。

### 续接记录（2026-09-20，第一百八十批 Thread Version Projection 解耦）

- 新增 `ThreadVersionProjection`，集中持久 thread/task 版本的当前值、事件重放单调推进、checkpoint 全量替换、只读视图与事务投影副本；`snapshotWith` 返回隔离副本，避免预提交版本污染活动投影。
- Runtime 的 checkpoint 创建/恢复、OCC 校验、任务版本推进和事件事务等 36 个调用点改用投影边界，删除原始 `threadVersions` Map；checkpoint 字段名、错误文案和持久格式保持不变。追加消息并发边界测试同步改用注册表，文件由 32,486 行增至 32,510 行。
- Projection 与追加消息边界共 27 项、Runtime 类型检查、lint/format、208 项架构测试、954 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 保持 2,108,851 / 2,978,620 字节，Electron PID `67332` 未重启。

### 续接记录（2026-09-20，第一百七十九批 Conversation Transient State Registry 解耦）

- 新增 `ConversationTransientStateRegistry`，以单一 thread 条目共同拥有单调 stream sequence 与可选活动快照；快照删除保留序列，快照写入和序列推进互不覆盖，保持终态后重订阅 cursor 与活动 Run 快照语义。
- Runtime 的订阅恢复、帧发布、文本/工具/委派投影和终态清理等 19 个调用点改用注册表，删除 snapshot/sequence 两份并行 Map；replay 队列、投影构造和广播协议仍由 Runtime 负责。同步修正瞬态集成测试中残留的旧订阅私有字段接线。显式注册表字段使文件由 32,485 行微增至 32,486 行。
- Registry 与瞬态投影共 9 项、Runtime 类型检查、lint/format、207 项架构测试、953 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 保持 2,108,851 / 2,978,620 字节，Electron PID `67332` 保持运行。

### 续接记录（2026-09-20，第一百七十八批 Owned Subscription Registry 解耦）

- 新增泛型 `OwnedSubscriptionRegistry`，集中 stream ID 登记、查找、删除、按连接所有者批量清理、可变遍历与关闭清空；订阅对象保持原引用，继续支持 Runtime 原有 cursor/phase 原位推进语义。
- Runtime 的持久事件订阅与会话瞬态订阅共 13 个调用点改用两个注册表实例，客户端断线由两段重复循环收敛为连接所有者清理；事件 replay、过滤、帧发送和瞬态阶段规则仍留在 Runtime。删除两份原始 Map 后，显式泛型字段使文件由 32,482 行微增至 32,485 行。
- Registry 4 项、Runtime 类型检查、lint/format、206 项架构测试、952 文件扫描、`git diff --check` 和 13 包整仓构建通过；Desktop initial/total JS 保持 2,108,851 / 2,978,620 字节，Electron PID `67332` 保持运行。

### 续接记录（2026-09-20，第一百七十七批共享 Refresh Coordinator 解耦）

- 将 Desktop 既有 `RefreshCoordinator` 提升到 Shared，统一 generation、等待者、运行状态和尾随刷新算法；通过 `deferStart` / `rejectPendingOnFailure` 显式保留 Desktop 同任务合并与 Runtime eager/失败全体返回两种既有时序。
- ShellApp 改为直接引用 Shared 并删除 Desktop 重复模块；Runtime 本地 Skill 刷新改用共享协调器，删除 requested/applied generation 与 in-flight Promise 三份状态，文件从 32,496 行降至 32,482 行。
- 共享协调器 5 项、Shared/Runtime/Desktop 类型检查、改动文件 lint/format、205 项架构测试、951 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 为 2,108,851 / 2,978,620 字节，Electron PID `67332` 保持响应。

### 续接记录（2026-09-20，第一百七十六批 MCP Auth Config Repository 解耦）

- 新增 `McpAuthConfigRepository`，集中 MCP 授权配置的 ID/字段归一化、设置仓读穿缓存、明文 Key 保存、旧 SecureStore handle 兼容迁移和删除占位语义；返回副本避免调用方修改缓存。
- MCP 注册、列表、能力治理、工具刷新、聊天登记与删除等 16 个调用点改用 Repository；删除 Runtime 的原始 Map 和 3 个配置辅助方法，SecureStore 密钥读取与 MCP 注册回滚仍由 Runtime 编排，文件从 32,565 行降至 32,496 行。
- Repository/摘要共 11 项、Runtime 类型检查、改动文件 lint/format、204 项架构测试、951 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 为 2,108,693 / 2,978,462 字节，Electron PID `67332` 保持响应。

### 续接记录（2026-09-20，第一百七十五批 Local Skill Watch Registry 解耦）

- 新增 `LocalSkillWatchRegistry`，集中本地 Skill 文件 watcher 的目录归一化、去重登记、活动查询与批量清理；即使单个 cleanup 抛错，也会继续释放其余 watcher 并在完成后抛回首个错误。
- Runtime 只负责选择 Skill 来源并创建 watcher，扫描响应、重启和关闭等 7 个调用点改用注册表；删除 `localSkillWatchCleanup` 与 `localSkillWatchedDirectories` 两份裸状态，文件从 32,580 行降至 32,565 行。
- Registry 5 项、Runtime 类型检查、改动文件 lint/format、203 项架构测试、950 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 为 2,108,693 / 2,978,462 字节，Electron PID `67332` 保持响应。

### 续接记录（2026-09-20，第一百七十四批 Completed Delegated Run Registry 解耦）

- 新增泛型 `CompletedDelegatedRunRegistry`，将委派子 Run 的终态快照与终态枚举合并为一个记录，支持状态先到、快照/状态共同保存、一次性领取和后台遗弃清理。
- 完成、失败、取消、超时、后台释放、前台 `agent_delegate` 领取及瞬态投影统一调用注册表；删除 Runtime 两个并行 Map，领取由分步 get/delete 改为原子 `take`，文件从 32,586 行降至 32,580 行。
- Registry/委派成功失败取消/执行控制器/终态事件投影共 48 项、Runtime 类型检查、改动文件 lint/format、202 项架构测试、949 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 为 2,108,693 / 2,978,462 字节，Electron PID `67332` 保持响应。

### 续接记录（2026-09-20，第一百七十三批 Active Run Registry 解耦）

- 新增 `ActiveRunRegistry`，集中活动 Run 的去重登记、完成、包含判断、数量/ID 快照与测试清理；ID 快照隔离内部 Set 引用。
- 健康检查、追加消息抢占、外部事件/定时任务清理、Goal 续轮和两类 Run 执行改用注册表；删除 Runtime 的 `inFlight` Set 与 `recordInFlight` / `forgetInFlight` 中转方法，文件从 32,594 行降至 32,586 行。
- Registry/健康检查/原生 Run/追加消息/外部 Kernel/关闭/守护进程完成共 73 项、Runtime 类型检查、改动文件 lint/format、201 项架构测试、948 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 为 2,108,693 / 2,978,462 字节，Electron PID `67332` 保持响应。

### 续接记录（2026-09-20，第一百七十二批 Keyed Turn Queue 解耦）

- 新增 `KeyedTurnQueue`，集中同 key 串行、不同 key 并行、幂等释放、尾节点条件清理和关闭等待；模块不依赖 Runtime、Kernel 或持久化实现。
- 外部 Kernel 会话继续由 Runtime 决定持久会话 key，但排队和释放交给队列；删除 `externalKernelSessionTails` Map 与 `enqueueExternalKernelSession` 私有方法，文件从 32,627 行降至 32,594 行。
- 队列/外部 Kernel/关闭回归共 41 项、Runtime 类型检查、改动文件 lint/format、200 项架构测试、947 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 为 2,108,693 / 2,978,462 字节，Electron PID `67332` 保持响应。

### 续接记录（2026-09-20，第一百七十一批 Kernel Tool Progress Registry 解耦）

- 新增 `KernelToolProgressRegistry`，集中按 Run/Tool 累计 UTF-8 输出字节、保留最新非空行、清理完成工具/Run，并以不可变方式把实时进度投影到运行中的工具段。
- Runtime 继续负责 Kernel 事件分派和瞬态帧发布，删除 `kernelToolProgressByRun` 嵌套 Map 与纯转发 `withKernelToolProgress`；9 个调用点直接使用窄 API，文件从 32,653 行降至 32,627 行。
- Registry/Kernel 适配器/外部 Kernel 主链共 71 项、Runtime 类型检查、改动文件 lint/format、199 项架构测试、946 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 为 2,108,693 / 2,978,462 字节，Electron PID `67332` 保持响应。

### 续接记录（2026-09-20，第一百七十批 AbortController Registry 解耦）

- 新增 `AbortControllerRegistry`，集中按 key 创建、替换、中止、条件删除和关闭时批量中止；`deleteIf` 保证旧请求的 `finally` 不会误删同 key 的新控制器。
- 普通 Run 与提示词优化分别持有独立注册表实例，Runtime 删除 `demoRunAborts`、`promptEnhancementAborts` 两个 Map，15 个创建/取消/清理调用点迁到窄 API；文件从 32,661 行降至 32,653 行。
- Registry/提示词优化/追加消息/Kernel 关闭与外部 Kernel 取消回归 36 项、Runtime 类型检查、改动文件 lint/format、198 项架构测试、945 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 为 2,108,693 / 2,978,462 字节，Electron PID `67332` 保持响应。

### 续接记录（2026-09-20，第一百六十九批 External Event Execution Registry 解耦）

- 新增 `ExternalEventExecutionRegistry`，统一事件租约、Run 反向索引和清理监听去重；重复接管投递只刷新租约且不重复挂载清理，Run 完成时三个索引由一个操作共同释放。
- Runtime 继续负责持久执行记录、心跳计时器、终态判断和守护进程完成帧，只通过注册表读取/推进内存生命周期；删除 `externalEventExecutions`、`externalEventIdByRun`、`externalEventCleanupRuns` 三个容器，文件从 32,662 行降至 32,661 行。
- Registry 单元 4 项、真实外部事件启动/去重投递集成 1 项、Runtime 类型检查、改动文件 lint/format、197 项架构测试、944 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 为 2,108,693 / 2,978,462 字节，Electron PID `67332` 保持响应。

### 续接记录（2026-09-20，第一百六十八批 In-flight Promise 生命周期解耦）

- 新增 `InFlightPromiseRegistry`，统一 Promise 登记、成功/失败自动释放、当前数量观测和关闭时 `allSettled` 等待；模块不知道 Runtime 或具体任务类型。
- Runtime 为后台任务、Kernel 执行和守护进程完成回执分别持有注册表实例，删除 `backgroundTasks`、`activeKernelRuns`、`daemonCompletionPromises` 三个 Set 及重复清理样板；保留 `trackBackgroundTask` 作为分发层语义入口，文件从 32,676 行降至 32,662 行。
- Registry 与 Kernel 关闭回归 8 项、Runtime 类型检查、改动文件 lint/format、196 项架构测试、943 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 为 2,108,693 / 2,978,462 字节，Electron PID `67332` 保持响应。

### 续接记录（2026-09-20，第一百六十七批 Scheduled Task Run Registry 解耦）

- 新增泛型 `ScheduledTaskRunRegistry`，统一定时任务 Run 的活动并发计数和终态回填元数据；执行结束与元数据消费保持两个独立阶段，既保留守护进程等待语义，也避免历史回填提前丢失。
- Runtime 只在任务准备、并发判断、执行结束和终态回填时调用注册表；删除 `taskRuns` Set 与 `scheduledTaskRuns` Map，6 个调用点迁到窄 API，文件从 32,679 行降至 32,676 行。
- Registry/分发/历史摘要单元 12 项、Runtime 类型检查、改动文件 lint/format、195 项架构测试、942 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 为 2,108,693 / 2,978,462 字节，Electron PID `67332` 保持响应。

### 续接记录（2026-09-20，第一百六十六批 Platform MCP Run Registry 解耦）

- 新增泛型 `PlatformMcpRunRegistry`，统一外部内核 Run 的冻结工具目录、调用结果重放和 Capability Broker 生命周期；同一 replay key 的并发调用共享 Promise，成功结果保留，失败结果释放供重试，Run 终态一次清理三类状态。
- Runtime 只组合工具目录、重放 key、真实执行函数和 Broker factory；删除 `platformMcpCatalogByRun`、`platformMcpResultsByRun`、`capabilityBrokerByRun` 三个 Map，并把 Ask/外部内核工具测试迁到 `setCatalog` API。文件从 32,702 行降至 32,679 行。
- Registry 单元 4 项、Ask/外部内核工具回归 14 项、Runtime 类型检查、改动文件 lint/format、194 项架构测试、941 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 为 2,108,693 / 2,978,462 字节，Electron PID `67332` 保持响应。

### 续接记录（2026-09-20，第一百六十五批 Assistant Timeline 变更跟踪解耦）

- 新增 `AssistantTimelineChangeTracker`，集中按 Run/Segment 保存已提交指纹、筛选新增/变更段、强制写入旁路和终态释放；`selectChanged` 不修改状态，只有 Store 成功后才 `commit`，因此普通写入失败后同内容仍可重试。
- Runtime 继续负责时间线内容清洗、SQLite 写入、严格模式与错误日志，但不再持有嵌套指纹 Map；架构门禁禁止 `assistantTimelineFingerprintsByRun` 回流。`runtime.ts` 保持 32,702 行，本批收口状态所有权而不扩张到时间线投影或 Store。
- 同步修复前序 Run/Kernel 注册表抽取遗留的白盒测试：注册表新增只读 `count()`，失败事务测试不再读取已删除 Map。Tracker 单元 4 项、时间线/追加消息/注册表回归 34 项、Runtime 类型检查、改动文件 lint/format、193 项架构测试、940 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 为 2,108,693 / 2,978,462 字节，Electron PID `67332` 保持响应。

### 续接记录（2026-09-20，第一百六十四批 Capability Usage Recorder 解耦）

- 新增 `CapabilityUsageRecorder` 与最小事件写入端口，集中 Skill/MCP 用量 key 的进程内幂等判定；写入成功后才登记 key，Store 异常时保留后续重试能力，模块不依赖 Runtime、Demo Run 或 SQLite 类型。
- MCP 调用和 Provider Context 中的 Skill/MCP 用量继续由 Runtime 组合 workspace/run 字段，但原始 Set 与 Store 写入判重已移出门面；架构门禁禁止 `recordedCapabilityUsageKeys` 和旧 `appendCapabilityUsageOnce` 回流。`runtime.ts` 保持 32,702 行，本批目标是状态所有权收口而非行数压缩。
- Recorder 单元 3 项、Capability Governance 集成 1 项、Runtime 类型检查、改动文件 lint/format、192 项架构测试、939 文件扫描和 13 包整仓构建通过；Capability Store 8 项中 7 项通过，唯一既有失败是迁移期望仍截止 `0055`、当前仓库实际含 `0056`–`0058`，不在本批调用链内。Desktop initial/total JS 为 2,108,693 / 2,978,462 字节，Electron PID `67332` 保持响应。

### 续接记录（2026-09-20，第一百六十三批 Durable Tool Approval Ledger 解耦）

- 新增 `DurableToolApprovalLedger`，统一选择 Event Store 权威投影或无 Store 时的内存回退，并集中 approval/thread/run 作用域筛选；模块只依赖 Shared Event 和既有纯读模型。
- 审批事件记录、失活审批读取和待审批列表改为调用 ledger；删除 Runtime 的回退 Map 与两个中转私有方法，分页恢复测试也迁移到 ledger API，文件从 32,723 行降至 32,702 行。
- Ledger 单元 3 项、审批恢复/事件分页集成 13 项、Runtime 类型检查、改动文件 lint/format、191 项架构测试、938 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 为 2,108,693 / 2,978,462 字节。

### 续接记录（2026-09-20，第一百六十二批会话上下文纯写入状态清理）

- 审计确认 `contextRunByThread` 在前序上下文快照缓存解耦后只剩 `set/delete/clear`，无任何读取消费者；继续保留会造成重复状态和错误的生命周期暗示。
- 删除 Runtime 的 Map 定义及模型窗口更新、消息失效、Provider 请求三处维护写入；增加架构规则禁止该纯写入状态回流，文件从 32,742 行降至 32,723 行。
- Context Status/Compact 与外部 Kernel 回归 47 项、Runtime 类型检查、改动文件 lint/format、190 项架构测试、937 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 为 2,108,693 / 2,978,462 字节。

### 续接记录（2026-09-20，第一百六十一批 Compact 边界缓存解耦）

- 新增 `ConversationCompactBoundaryCache`，通过最小事件加载端口集中 Compact 边界缓存、按事件序列恢复、线程过滤、摘要有效性判断和引用隔离；模块不依赖 Runtime 或 Store。
- Compact 成功写入只记录边界，Provider 消息构建只读取边界；Runtime 保留 Task/Workspace 事件来源组合，删除 `latestCompactByThread` Map 与恢复私有方法，文件从 32,760 行降至 32,742 行。
- 缓存单元 4 项、Context Status/Compact 与外部 Kernel 回归 47 项、Runtime 类型检查、改动文件 lint/format、189 项架构测试、937 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 为 2,108,693 / 2,978,462 字节。

### 续接记录（2026-09-20，第一百六十批会话上下文修订注册表解耦）

- 新增 `ConversationContextAmendmentRegistry`，集中线程级排除来源的替换、读取和清理，并通过输入/输出拷贝隔离数组引用；模块不依赖 Runtime 或 Context 选择实现。
- Context Packet Amend、Context Status/Peek 和真实 Provider 请求改为调用注册表；删除 Runtime 的 `threadContextAmendments` Map，文件从 32,761 行降至 32,760 行。
- 注册表单元 3 项、Context Amend 1 项、Context Status 14 项、Runtime 类型检查、改动文件 lint/format、188 项架构测试、936 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 为 2,108,693 / 2,978,462 字节。

### 续接记录（2026-09-20，第一百五十九批定时任务投递注册表解耦）

- 新增 `ScheduledTaskDispatchRegistry`，集中守护进程投递任务的预注册、未启动回滚、Run 绑定、终态领取和关闭快照；模块不依赖 Runtime、网络或持久化实现。
- `task.dispatch`、Scheduled Run 创建/清理和 Runtime 关闭中止改为调用注册表；删除 Runtime 的 `dispatchedTasks` Set 与 `taskIdByRun` Map，文件从 32,769 行降至 32,761 行。
- 注册表单元 4 项、守护进程完成/中止/协议回归 23 项、Runtime 类型检查、改动文件 lint/format、187 项架构测试、935 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 为 2,108,693 / 2,978,462 字节。

### 续接记录（2026-09-20，第一百五十八批正式方案修订注册表解耦）

- 新增 `FormalPlanRevisionRegistry`，通过只读 Event 端口集中正式方案修订号的内存缓存、事件日志倒序恢复、有效值过滤、提交记录和 Run 清理；模块不依赖 Runtime 或 Store 实现。
- 平台 `plan_submit`、Claude 原生方案提交、规划终态校验和两条 Run 清理路径统一调用注册表；删除 Runtime 原始修订 Map 和事件回放私有方法，文件从 32,779 行降至 32,769 行。
- 注册表单元 4 项、外部 Kernel 计划回归 33 项、未提交终态回归 1 项、Runtime 类型检查、改动文件 lint/format、186 项架构测试、934 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 为 2,108,693 / 2,978,462 字节。
- 同时运行完整 `conversation-transient-stream` 套件时，26 项中 3 个既有委派用例因只读工具断言、MCP Store 错误路径和 5 秒预算超时失败；本批关联的规划终态用例已单独复跑通过，失败不在正式方案注册表调用链上。

### 续接记录（2026-09-20，第一百五十七批挂起问询注册表解耦）

- 新增 `PendingAskRegistry`，独占 askId 注册、一次性领取、按会话查询最新问询、删除和按 Run 批量取消；模块只依赖 Protocol/Shared 类型，不依赖 Runtime、Store 或事件实现。
- Conversation Ask 回答/取消、平台工具问询、Claude 原生 Ask 桥接与 Run 终态收尾改为调用注册表；Runtime 删除原始 `pendingAsks` Map 和内联遍历，文件从 32,796 行降至 32,779 行。
- 注册表单元 4 项、平台问询/Claude Ask 回归 54 项、Runtime 类型检查、改动文件 lint/format、185 项架构测试、933 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 为 2,108,693 / 2,978,462 字节。

### 续接记录（2026-09-20，第一百五十六批 Policy Scope 服务解耦）

- 新增 `PolicyScopeService`，通过 Workspace/Task/Agent/Policy 最小查询端口集中保存作用域验证、适用作用域组合、Task 策略存在性和 Approval 基础作用域校验；模块不依赖 Runtime 或 Storage 实现。
- Policy Save/List、Participation Mode 和服务端 Approval 解析改为调用该服务，Runtime 继续拥有命令事务、事件与审批执行；删除保存/列表/存在性及三类 require 共六个私有方法，文件从 32,892 行降至 32,796 行。
- 服务单元 5 项、Policy/Approval 集成 21 项、Runtime 类型检查、改动文件 lint/format、184 项架构测试、932 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 为 2,108,693 / 2,978,462 字节。

### 续接记录（2026-09-20，第一百五十五批 Run/Kernel 持久注册表解耦）

- 新增 `RunKernelRegistry`，通过最小 Settings 端口独占 runId→kernelId 的懒加载、损坏值过滤、内存合并、幂等记录和最佳努力持久化；事件日志回填不会产生多余设置写入。
- 会话消息查询只提供 Event Store 回填并读取 Kernel 标签，Run 创建入口只记录映射；Runtime 删除两个 Map/load 字段和两个私有生命周期方法，文件从 32,927 行降至 32,892 行。
- 注册表 3 项、消息分页/最终消息 2 项和重启持久化 10 项、Runtime 类型检查、改动文件 lint/format、183 项架构测试、931 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 保持 2,108,693 / 2,978,462 字节。

### 续接记录（2026-09-20，第一百五十四批会话上下文快照缓存解耦）

- 新增 `ConversationContextSnapshotCache`，独占 thread→model/kernel 嵌套索引、复合键规范化、读取、写入、单线程失效和全量清理；Runtime 不再暴露缓存 Map 结构或自行拼接键。
- Context Status 预览与真实 Provider 请求共享同一缓存对象；持久消息写入继续同时失效快照和 Run 上下文，模型窗口更新继续全量清理。删除 Runtime 私有 setter/key 方法，测试改为通过窄观测接口验证缓存状态。
- 缓存单元 2 项与 Context Status 集成 14 项、Runtime 类型检查、改动文件 lint/format、182 项架构测试、930 文件扫描和 13 包整仓构建通过；`runtime.ts` 从 32,946 行降至 32,927 行，Desktop initial/total JS 保持 2,108,693 / 2,978,462 字节。

### 续接记录（2026-09-20，第一百五十三批 CC Switch 导入路径策略解耦）

- 新增纯 `cc-switch-import-path`，集中显式数据库路径裁剪、Storage 默认路径回退和缺少用户目录错误；Storage 继续独占默认路径的环境/平台计算，Runtime 只组合两者。
- Preview 与 Import 两个入口复用同一策略，Runtime 删除私有 `resolveCcSwitchDbPath`；3 项路径策略和 6 项 Provider 密钥补偿集成测试覆盖显式/默认/缺失路径与导入提交后的失败补偿边界。
- Runtime 类型检查、改动文件 lint/format、181 项架构测试、929 文件扫描和 13 包整仓构建通过；`runtime.ts` 从 32,953 行降至 32,946 行，Desktop initial/total JS 保持 2,108,693 / 2,978,462 字节。

### 续接记录（2026-09-20，第一百五十二批 Artifact 文本内容策略解耦）

- 新增纯 `artifact-content-policy`，统一 Artifact 快照比较与三方合并可接受的文本 MIME；Runtime 的比较/合并用例直接消费领域判断，删除私有 `isTextArtifactMime`。
- 策略覆盖 `text/*`、JSON/XML/JavaScript 及二进制、PDF、复合 `+json`、SVG 和空值边界；既有 Artifact 命令集成测试继续覆盖作用域、稳定比较、不可合并状态、干净合并、冲突回滚和恢复。
- 策略 11 项与 Artifact 集成 10 项、Runtime 类型检查、改动文件 lint/format、180 项架构测试、928 文件扫描和 13 包整仓构建通过；`runtime.ts` 从 32,961 行降至 32,953 行，Desktop initial/total JS 保持 2,108,693 / 2,978,462 字节。

### 续接记录（2026-09-20，第一百五十一批提示词优化协议与模型选择解耦）

- 新增 Protocol `prompt-enhancement-payloads`，统一 enhance/cancel 的裁剪、长度和类型校验；Desktop 只把共享解析失败适配为 IPC 错误，Runtime 直接消费安全解析结果，不再维护第二套规则。
- 新增纯 `prompt-enhancement-model-selection`，集中启用 Provider 过滤、catalog/upstream ID 匹配、首个可用模型和 demo fallback 规则；Runtime 保留流式调用、取消控制和响应写入，删除两个私有解析/选择方法，文件从 32,989 行降至 32,961 行。
- Protocol/Runtime/Desktop 定向 13 项、三包类型检查、改动文件 lint/format、179 项架构测试、927 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 保持 2,108,693 / 2,978,462 字节。上一批误置于循环内的重复门禁已移出，第一百五十批真实架构测试数修正为 178 项。

### 续接记录（2026-09-20，第一百五十批 Provider Discovery 路由解耦）

- 新增 `provider-discovery-routing` 纯路由模块，集中“协议专用适配器优先、默认适配器兜底”的选择规则；Runtime 的 Provider、模型探测、图像生成、Run 调用和视觉描述入口通过显式目录与 fallback 组合，不再保留私有 `resolveDiscoveryAdapter`。
- 新增协议命中、默认回退和无适配器三项行为覆盖，AST 门禁禁止 Discovery 路由回流到 Runtime。当前 `runtime.ts` 实测 32,989 行；Discovery/Provider 定向 8 项、Runtime 类型检查、改动文件 lint、178 项架构测试和 925 文件架构扫描通过。
- 13 包整仓构建通过（Desktop initial/total JS 为 2,108,693 / 2,978,462 字节）；无依赖、迁移或业务数据操作，Electron PID `67332` 保持运行。

### 续接记录（2026-09-20，第一百四十九批 Provider 按 ID 查询投影解耦）

- `provider-catalog-projection` 新增 `projectProviderSummaryById`，统一完成按 Provider ID 的目录查找和公开摘要投影；Runtime 只组合 `providerStore.listProviders()` 与纯投影，不再保留私有 `providerSummaryById` 方法。
- 新增投影回归覆盖命中与缺失 ID，AST 门禁禁止 Provider 按 ID 查询回流到 Runtime 门面。当前 `runtime.ts` 实测 32,958 行；Provider 投影定向 6 项、Runtime 类型检查、改动文件 lint、177 项架构测试和 924 文件架构扫描通过。
- 13 包整仓构建通过，Desktop initial/total JS 保持 2,108,693 / 2,978,462 字节；本批无依赖、迁移、业务数据操作或应用重启，Electron PID `67332` 保持响应。

### 续接记录（2026-09-20，第一百四十八批定时任务历史摘要选择解耦）

- 新增纯 `scheduled-task-history-summary`，只负责从按新到旧排列的消息中选择首条非空助手文本，并组合/清理文本块；它不读取 Message Store、不写 Scheduled Task Store，也不拥有摘要长度上限。
- `runtime.ts` 保留最近 50 条读取和 Store 回填组合，原私有 `fillTaskHistorySummary` 已删除，文件从 32,965 行降至 32,952 行。200 字截断继续唯一由 `SqliteScheduledTaskStore.updateHistorySummary` 执行并有独立回归覆盖。
- Runtime/Storage 定向 8 项、Runtime 类型检查、改动文件 lint、176 项架构测试、924 文件架构扫描和 13 包整仓构建通过。Desktop initial/total JS 保持 2,108,693 / 2,978,462 字节；本批无依赖、迁移、业务数据操作或应用重启，Electron PID `67332` 保持响应。

### 续接记录（2026-09-20，第一百四十七批平台 Agent Store 适配解耦）

- 新增 `kernel/platform-agent-store`，将有效 Agent 记录裁剪为 `PlatformToolContext.agentStore` 的最小只读合同，并复制 Skill/MCP 数组，防止平台工具通过返回值反向修改 Store 记录。
- `runtime.ts` 只负责把 `SqliteGlobalAgentStore` 注入适配器，原私有 `toPlatformAgentStore` 已删除，文件从 32,983 行降至 32,965 行。Agent 激活范围、归档、持久化和 `agent_list` 输出语义保持原边界。
- 新适配器与平台工具定向 17 项、Runtime 类型检查、改动文件 lint、175 项架构测试、923 文件架构扫描和 13 包整仓构建通过。Desktop initial/total JS 保持 2,108,693 / 2,978,462 字节；本批无依赖、迁移、业务数据操作或应用重启，Electron PID `67332` 保持响应。

### 续接记录（2026-09-20，第一百四十六批桌面等待命令投影收口）

- `desktop-waiting-projection` 现统一拥有等待命令的任务归属、公开目标、错误原因和 Protocol DTO 投影；只通过三个窄查询端口读取 owner thread task、run 和 run task，不依赖 Runtime、Store 或宿主实现。
- `runtime.ts` 的列表响应和 continue/cancel 生命周期事件直接复用同一投影，原私有 `toDesktopWaitingCommandSummary` 已删除，文件从 33,013 行降至 32,983 行。Desktop Controller、Store 查询、命令 Mutation、事件持久化和发布仍留在 Runtime 用例边界。
- Runtime 定向 23 项、Runtime 类型检查、改动文件 lint、174 项架构测试、922 文件架构扫描和 13 包整仓构建通过。Desktop initial/total JS 保持 2,108,693 / 2,978,462 字节；本批无依赖、迁移、业务数据操作或应用重启，Electron PID `67332` 保持响应。

### 续接记录（2026-09-20，第一百四十五批长对话消息 DOM 窗口化）

- 新增独立 `use-message-virtual-window`，超过 80 条已展示历史后按滚动视口、900px overscan 和动态实测行高计算挂载范围；`ChatView` 只渲染窗口内消息并用上下 spacer 保持完整滚动几何，既有 50 条分页与 12 条首屏尾窗语义保持不变。
- 对话导航目标会临时强制挂载，滑动定位、用户打断或历史锚点恢复后立即释放；代码块展开与内部滚动状态按会话/消息进入 240 项有界缓存，离屏卸载再挂载不会丢失阅读状态。中间缺口、过期请求丢弃、失败重试和旧页游标继续通过原入口工作。
- 消息窗口、长线程预算、历史导航、Minimap、Markdown 与代码块定向 82 项、Desktop 类型检查、改动文件 lint（0 error，16 条既有 Hook warning）、173 项架构测试、922 文件架构扫描和 13 包整仓构建通过。Desktop initial/total JS 为 2,108,693 / 2,978,462 字节；整包 Desktop lint 仍被既有 `MarkdownImageGallery`/主题引擎 6 个错误阻断。本批无依赖、迁移、业务数据操作或应用重启，Electron PID `67332` 保持响应。

### 续接记录（2026-09-20，第一百四十四批 MCP Server 摘要与认证读取解耦）

- 新增 `mcp-server-summary`，集中 MCP Server 公开字段、工具数组复制和认证展示规则；投影接收一次性认证快照，不再隐式读取 Runtime 设置。
- MCP 注册、启停、工具刷新、能力治理、聊天工具及只读查询入口改为直接组合纯投影，`SkillQueryContext` 只暴露认证事实读取端口；`runtime.ts` 删除私有转换方法，从 33,046 行降至 33,013 行。认证持久化、SecureStore 迁移、Store Mutation 和事件仍在原用例边界。
- 新投影、MCP 命令、远端能力和治理定向 21 项、Runtime 类型检查与 lint、172 项架构测试、921 文件架构扫描和 13 包整仓构建通过。Desktop initial/total JS 保持 2,104,581 / 2,974,350 字节；无依赖变更、迁移、业务数据操作或应用重启，Electron PID `67332` 保持响应。

### 续接记录（2026-09-20，第一百四十三批 Skill 版本摘要与 Runtime 解耦）

- 新增 `skill-version-summary`，集中 Skill 公开字段裁剪、可变数组复制和旧 YAML 块标记描述修复；仅在遇到旧标记时通过窄 `sourceMd` resolver 读取完整记录。
- Skill 导入、启停、能力治理及查询入口改为直接组合纯投影，`SkillQueryContext` 删除 Runtime 投影回调；`runtime.ts` 删除私有转换方法和专属类型导入，从 33,080 行降至 33,046 行。Store 查询、Mutation、事件与错误协议仍在原用例边界。
- 新投影、Skill 命令和能力治理定向 7 项、Runtime 类型检查与 lint、172 项架构测试、920 文件架构扫描和 13 包整仓构建通过。Desktop initial/total JS 保持 2,104,581 / 2,974,350 字节；无依赖变更、迁移、业务数据操作或应用重启，Electron PID `67332` 保持响应。

### 续接记录（2026-09-20，第一百四十二批 Workspace 摘要投影归入 Summaries）

- Runtime 既有 `summaries.ts` 新增 Workspace 记录到协议摘要的纯投影，集中解析 icon、排序和隐藏偏好；列表与更新两个入口改为直接复用。
- 只读查询处理器直接依赖纯投影，`QueryContext` 删除映射回调；`runtime.ts` 删除私有转换方法和三个偏好解析值导入，从 33,103 行降至 33,080 行。Workspace Store、Mutation、错误协议和帧写入仍在原用例边界。
- 纯摘要、工作区命令与上下文定向 17 项、Runtime 类型检查与 lint、172 项架构测试、919 文件架构扫描和 13 包整仓构建通过。Desktop initial/total JS 保持 2,104,581 / 2,974,350 字节；无依赖变更、迁移、业务数据操作或应用重启，Electron PID `67332` 保持响应。

### 续接记录（2026-09-20，第一百四十一批 Approval 请求摘要投影归入 Summaries）

- Runtime 既有 `summaries.ts` 新增 Approval 请求纯投影；审批列表、入队/决策、Memory 镜像、Skill/MCP 重审批与编排 gate 共 8 个调用点改为直接复用。
- 投影继续只从 metadata 暴露非空 `delegateAgentVersionId`，其它内部 metadata 不进入协议摘要；`runtime.ts` 删除私有转换方法，从 33,131 行降至 33,103 行。审批评估、状态机、持久化、镜像和事件发布仍在原用例层。
- 纯摘要、审批命令与恢复定向 26 项、Runtime 类型检查与 lint、172 项架构测试、919 文件架构扫描和 13 包整仓构建通过。Desktop initial/total JS 保持 2,104,581 / 2,974,350 字节；无依赖变更、迁移、业务数据操作或应用重启。

### 续接记录（2026-09-20，第一百四十批 Memory/Diagnostics 摘要投影归入 Summaries）

- Runtime 既有 `summaries.ts` 新增 Memory 变更、持久 Memory 条目与诊断记录三类纯投影；7 个 Memory/Diagnostics 命令及审批镜像调用点改为直接复用。
- Memory additions/modifications/deprecations/evidence 与诊断 detail 现在复制隔离，避免响应对象反向修改 Store 记录；`runtime.ts` 删除三个私有转换方法及专属类型导入，从 33,182 行降至 33,131 行。存储 Mutation、审批镜像、事件发布和错误协议仍在用例层。
- 纯摘要、Memory 命令与项目上下文定向 16 项、Runtime 类型检查与 lint、172 项架构测试、919 文件架构扫描和 13 包整仓构建通过。Desktop initial/total JS 保持 2,104,581 / 2,974,350 字节；无依赖变更、迁移、业务数据操作或应用重启。

### 续接记录（2026-09-20，第一百三十九批能力治理摘要投影归入 Summaries）

- Runtime 既有 `summaries.ts` 新增工作区激活、能力用量、Skill 发布草稿和能力整理报告四类纯投影；10 个能力治理命令调用点改为直接复用。
- 发布附件只暴露 `name/size`，整理报告的分类数组和计数对象复制隔离；`runtime.ts` 删除四个私有转换方法，从 33,252 行降至 33,182 行。查询、排序、Mutation、错误协议和 Socket 响应仍在用例层，架构门禁禁止旧私有方法恢复。
- 纯摘要与能力治理定向 10 项、Runtime 类型检查与 lint、172 项架构测试、919 文件架构扫描和 13 包整仓构建通过。Desktop initial/total JS 保持 2,104,581 / 2,974,350 字节；无依赖变更、迁移、业务数据操作或应用重启。

### 续接记录（2026-09-20，第一百三十八批 Agent 版本摘要投影归入 Summaries）

- Runtime 既有 `summaries.ts` 新增 `AgentVersionRecord` 到绑定摘要与完整定义摘要的纯投影；7 个 Agent 查询、更新、版本与 Skill 审批绑定调用点改为直接复用。
- fallback、Skill/MCP allowlist、工具白名单、权限、视觉身份、审查行为和产物规则均复制隔离；`Runtime` 删除两个私有转换方法，Store Mutation、事件发布和 Socket 响应继续留在用例层。架构门禁禁止旧私有方法恢复。
- 纯摘要 5 项、Agent/Workspace 集成 6 项、Runtime 类型检查与 lint、172 项架构测试、919 文件架构扫描和 13 包整仓构建通过。Desktop initial/total JS 保持 2,104,581 / 2,974,350 字节；无依赖变更、迁移、业务数据操作或应用重启，Electron PID `67332` 保持响应。

### 续接记录（2026-09-20，第一百三十七批目录摘要投影归入 Summaries）

- Runtime 既有 `summaries.ts` 新增 Global Agent、Team、Team Run 与 Conversation 四类记录到共享 DTO 的纯投影；28 个 UI 命令和聊天工具调用点改为直接复用，成员依赖、fallback、Skill/MCP 数组均复制隔离。
- `runtime.ts` 删除四个私有摘要方法及仅为其存在的记录/DTO类型导入，从 32,222 行降至 32,142 行；Store 查询、Mutation、错误协议和 Socket/工具响应仍在各用例层。架构门禁禁止旧私有摘要恢复。
- 纯摘要 3 项、Agent/Team/Conversation/Workspace 集成 15 项、Runtime 类型检查与改动文件 lint、172 项架构测试、919 文件架构扫描和 13 包整仓构建通过。Desktop initial/total JS 保持 2,104,581 / 2,973,350 字节；无依赖变更、迁移、业务数据操作或应用重启。

### 续接记录（2026-09-20，第一百三十六批 Provider Catalog 响应投影抽离）

- Runtime 新增纯 `provider-catalog-projection`，集中 `ModelRecord` 的 contextWindow/视觉字段投影和 `ProviderCatalogEntry` 的凭据扁平化、surface 推断、嵌套模型转换；12 个 Provider 命令调用点直接复用。
- `runtime.ts` 删除 `toProviderSummary` / `toModelSummary` 两个私有方法，从 32,283 行降至 32,222 行；Store 读取、凭据写入、命令错误和 Socket 响应仍由 Runtime 用例层拥有。架构门禁禁止旧私有投影恢复。
- 纯投影 5 项、Provider 集成 13 项、Runtime 类型检查与改动文件 lint、171 项架构测试、919 文件架构扫描和 13 包整仓构建通过。Desktop initial/total JS 保持 2,104,581 / 2,973,350 字节；无依赖变更、迁移、业务数据操作或应用重启。

### 续接记录（2026-09-20，第一百三十五批能力全局开关语义收口）

- Ability Center 的 Skill 与 MCP 全局启停改为复用 `ToggleControl`，删除两份重复的 switch role、aria、状态属性、禁用与目标值计算；异步 Mutation、busy、缓存失效和错误展示仍由能力页拥有。
- 工作区激活菜单的两个整行复合开关保留原 DOM、`aria-busy/title` 和内嵌轨道。架构门禁只对白名单静态类 `skill-workspace-menu__row` 放行，并有正向测试；其它能力页直接 switch 会被拦截。
- 定向 45 项、Desktop 类型检查与改动文件 lint、170 项架构测试、918 文件架构扫描和 13 包整仓构建通过。Website 约 1,493 KiB，Desktop initial/total JS 为 2,104,581 / 2,973,350 字节；无依赖变更、迁移、业务数据操作或应用重启。

### 续接记录（2026-09-20，第一百三十四批 Preferences 开关语义收口）

- Preferences 的字体、托盘和快捷键开关改为复用 `ToggleControl`，删除局部 button/role/aria/disabled/取反逻辑；外层文字、禁用外观、持久化与快捷键注册状态仍由 Preferences 拥有。
- 原 `<i>` thumb 等价替换为共享 `<span>` 并同步收窄宿主 CSS 选择器，没有为单个标签差异增加共享组件参数。Preferences 加入直接 switch 防回流门禁；Think 与原生 checkbox 的不同事件/控件语义继续独立。
- 定向 10 项、Desktop 类型检查与改动文件 lint、170 项架构测试、918 文件架构扫描和 13 包整仓构建通过。Website 约 1,493 KiB，Desktop initial/total JS 为 2,104,581 / 2,974,401 字节；无依赖变更、迁移、业务数据操作或应用重启。

### 续接记录（2026-09-20，第一百三十三批设置开关共享边界扩展）

- Web Search Provider、Desktop 自动更新和 Bot 通道启停删除各自直接 switch button，改为复用 `ToggleControl`；共享边界现覆盖 Model、Settings、Connector、Web Search、Update 与 Bot 六类设置表面。
- Web Search 保存路径显式接收组件请求的目标布尔值，不再从闭包中的旧 Provider 状态反推；未配置时仅拦截启用请求。Preferences 的 `<i>` thumb/label 组合与执行过程的阻止冒泡开关保留原实现，不为本批扩大共享接口。
- 定向 75 项、Desktop 类型检查与改动文件 lint、170 项架构测试、918 文件架构扫描和 13 包整仓构建通过。Website 约 1,493 KiB，Desktop initial/total JS 为 2,104,581 / 2,974,467 字节；无依赖变更、迁移、业务数据操作或应用重启。

### 续接记录（2026-09-20，第一百三十二批开关交互语义单源化）

- Renderer 新增受控、无状态的 `ToggleControl`，统一 `role="switch"`、可访问名称、选中/禁用状态和反向切换回调；Model 设置、通用设置及连接器设置改为组合该原语。
- 各宿主继续拥有原 CSS 类和业务状态；共享组件同时投影 `data-state` / `data-enabled`，因此模型、设置和能力连接器的既有视觉选择器保持不变。架构门禁禁止两个设置宿主恢复直接 switch button。
- 定向 112 项、Desktop 类型检查与改动文件 lint（0 error，1 条既有 Hook warning）、170 项架构测试、918 文件架构扫描和 13 包整仓构建通过。Website 约 1,493 KiB，Desktop initial/total JS 为 2,104,581 / 2,974,886 字节；无依赖变更、迁移、业务数据操作或应用重启。

### 续接记录（2026-09-20，第一百三十一批测试专用 Composer API 退役）

- 删除仅被测试引用的 `applyMention`、`extractMentionPaths` 与 `coerceReasoningEffort` 三个生产导出，并移除对应旧 inline mention/coercion 测试；当前附件 chip 的 `stripMentionToken`、文件引用输出和固定思考档位保持不变。
- 架构门禁只在 `compose-mention` / `compose-toolbar` 两个已确认所有者中禁止三项旧 helper 恢复，避免测试再次反向扩大生产 API；审计新增 D-19 并关闭。
- Composer 定向 36 项、Desktop 类型检查与改动文件 lint、169 项架构测试、917 文件架构扫描和 13 包整仓构建通过。Website 约 1,493 KiB，Desktop initial/total JS 保持 2,104,581 / 2,974,874 字节，说明旧 helper 先前已被 tree-shake；无依赖变更、迁移、业务数据操作或应用重启。

### 续接记录（2026-09-20，第一百三十批 Telegram 双实现退役）

- 删除零生产调用的 `TelegramBotClient`、旧 Telegram-only 配置/handler、长轮询、typing/reply 和专属会话执行链；Bot 通道只保留 `BotChannelGatewayManager`、`TelegramGateway` 与通用 `executeBotConversationTurn`，生产实现减少 601 行，另删除 85 行封闭旧测试。
- 生产帧路由、启动恢复和关闭继续走统一 Gateway；`BotChannelConfigStore` 保留旧 `tokenHandle`、`proxyUrl`、身份字段迁移并已有回归。架构门禁禁止旧 client 文件及 Runtime 旧生命周期成员恢复，审计 R-3 已关闭。
- Bot 通道定向 24 项、Runtime 类型检查与改动文件 lint、168 项架构测试、917 文件架构扫描和 13 包整仓构建通过。Website 约 1,493 KiB，Desktop initial/total JS 保持 2,104,581 / 2,974,874 字节；无依赖变更、迁移、业务数据操作或应用重启。

### 续接记录（2026-09-20，第一百二十九批 Renderer MCP 目录共享读取边界）

- Renderer 新增 `mcp-catalog-loader`，统一 100 条目录请求，并按 Runtime bridge 实例复用成功快照、合并并发请求；失败不缓存，代次失效会让旧在途响应重新读取，避免失效前数据回写。
- Ability Center、Agent Library、Composer MCP 菜单和设置连接页改走该边界。MCP 注册、删除、启停、工具刷新和能力页手动刷新明确失效缓存；各页面继续独立拥有 loading/error、筛选与乐观状态。架构门禁禁止生产 Shell 绕过加载器直接调用 `listMcpServers`，审计 P0-2 的 Skill/MCP 两类目录重复读取均已关闭。
- 定向 251 项、Desktop 类型检查与改动文件 lint、167 项架构测试、918 文件架构扫描和 13 包整仓构建通过。Website 约 1,493 KiB，Desktop initial/total JS 为 2,104,581 / 2,974,874 字节；无依赖变更、迁移、业务数据操作或应用重启。

### 续接记录（2026-09-20，第一百二十八批密钥输入表现与宿主策略解耦）

- Renderer 新增无状态 `SecretInputControl`，统一 password/text 类型切换、Eye/EyeOff 图标、title/aria-label 和按钮禁用传递；Model、Image Generation 与 Bot 设置直接复用同一表现层。
- 三种生命周期继续留在宿主：Model 仅按当前输入复位显隐，Image 继续负责已存凭据掩码与异步 reveal，Bot 继续由通道草稿统一管理显隐集合。两个 Provider 包装器改名为 `ModelSecretInput` / `ImageSecretInput`，架构门禁禁止三宿主恢复模糊的局部 `SecretInput`。
- 定向 123 项、Desktop 类型检查与改动文件 lint（0 error，1 条既有 Hook warning）、166 项架构测试、917 文件架构扫描和 13 包整仓构建通过。Website 约 1,492 KiB，Desktop initial/total JS 为 2,104,098 / 2,974,283 字节；无依赖变更、迁移、业务数据操作或应用重启。

### 续接记录（2026-09-20，第一百二十七批能力页 legacy Skill 表面退役）

- 删除零生产消费者的 `SkillSurface`，并同步删除其独占的旧分类栏、统计面板、治理筛选、治理说明、开关/统计卡组件及本地/市场/治理列表 CSS；当前 NewMax Skill Hub、详情抽屉和工作区激活控件保持原实现。
- 能力页测试移除只查询旧危险按钮 CSS 类的空断言，继续以真实“编辑/删除”入口验证市场 Skill 只读行为。架构门禁禁止 `SkillSurface` 导出恢复；窄 lazy entry 仍只暴露 `AbilitiesPage`。
- 能力页 43 项、Desktop 类型检查与改动文件 lint、165 项架构测试、916 文件架构扫描和 13 包整仓构建通过。Website 约 1,492 KiB，Desktop initial/total JS 保持 2,104,098 / 2,974,434 字节，证明旧导出此前已被 tree-shake；无依赖变更、迁移、业务数据操作或应用重启。

### 续接记录（2026-09-20，第一百二十六批二进制字节缩放单一真源）

- Shared 新增纯 `scaleBinaryBytes` 与 `BINARY_BYTE_UNITS`，统一 1024 进位和最大单位截断；BrowserStage、ArtifactVersionsPanel、数据库治理 CLI 删除各自的缩放循环。
- 三个宿主继续拥有原展示策略：BrowserStage 使用 B/KB/MB 与动态小数，Artifact UI 使用 B/KiB/MiB 与一位小数，数据库 CLI 使用 B/KiB/MiB/GiB/TiB 与两位小数。共享事实不接管界面文案或精度。
- 定向 64 项、Shared/Desktop/UI Kit/Storage 类型检查与改动文件 lint、164 项架构测试、916 文件架构扫描和 13 包整仓构建通过。Website 约 1,492 KiB，Desktop initial/total JS 为 2,104,098 / 2,974,434 字节；无依赖变更、迁移、业务数据操作或应用重启。

### 续接记录（2026-09-20，第一百二十五批能力页兼容入口退役）

- 删除 Renderer Shell 根目录的 `AbilitiesPage.tsx` 兼容转发；Shell 类型和能力页测试直接依赖 `abilities/AbilityCenterPage`，领域实现不再经无语义的上层别名。运行时加载改走同目录 `AbilityCenterPage.lazy` 窄入口，只暴露实际页面组件。
- 直接动态导入实现模块会把零消费者 legacy `SkillSurface` 一并打入 chunk，实测 total JS 增加约 12.7 KiB；窄入口保留 tree-shaking 后恢复到上一批附近。架构门禁禁止旧根路径恢复，也禁止 Shell 绕过窄入口动态加载完整实现；`SkillSurface` 源码清理作为独立后续项，不扩张本批。
- 能力页/Shell 定向 123 项、Desktop 类型检查与改动文件 lint（0 error，2 条既有 Hook warning）、163 项架构测试、915 文件架构扫描和 13 包整仓构建通过。Website 约 1,492 KiB，Desktop initial/total JS 为 2,103,809 / 2,973,984 字节；无依赖变更、迁移、业务数据操作或应用重启。

### 续接记录（2026-09-20，第一百二十四批紧凑数字展示策略显式化）

- Renderer 新增纯 `compact-number` 展示模块，以共享缩放/舍入机制承载两个明确策略：能力详情继续在千位后按原阈值取 1 位或整数且不切换 M，Provider 用量继续按 K/M 各保留 1 位；原有所有边界文本保持不变。
- 能力页不再从混合业务辅助模块导入模糊的 `formatTokens`，Provider 汇总也删除私有同名实现；字节上限现在显式使用“能力指标”格式策略，不再被错误命名为 token。架构门禁禁止 Renderer Shell 恢复局部 `formatTokens`。
- 定向 49 项、Desktop 类型检查与改动文件 lint、162 项架构测试、915 文件架构扫描和 13 包整仓构建通过。Website 约 1,492 KiB，Desktop initial/total JS 为 2,103,779 / 2,973,954 字节；无依赖变更、迁移、业务数据操作或应用重启。

### 续接记录（2026-09-20，第一百二十三批技能市场摘要单一真源）

- Protocol 新增浏览器安全的 `@sync-think/protocol/skill-market-catalog` 子路径，成为六个作者技能包 id、slug、名称、分类、描述、作者、版本和图标的唯一传输摘要真源；Runtime 技能市场包直接展开对应摘要，仅继续拥有完整可安装文件和物化逻辑。
- Renderer 的旧桥兼容回退改为从 Protocol 摘要派生，删除六份简化内联 `SKILL.md` 和重复元数据；正常运行时仍以 Runtime `listSkillMarket()` RPC 返回为权威。架构门禁禁止 Runtime 重新内联摘要字段及 Renderer 恢复静态市场数组或 `makeSkillSource`。
- 定向 46 项、Protocol/Runtime/Desktop 类型检查与改动文件 lint、161 项架构测试、914 文件架构扫描和 13 包整仓构建通过。Website 约 1,492 KiB，Desktop initial/total JS 为 2,103,646 / 2,973,901 字节；无依赖变更、迁移、业务数据操作或应用重启。

### 续接记录（2026-09-20，第一百二十二批 Renderer vendor 脚本生命周期单源化）

- Renderer 新增 `vendor-script-loader`，统一 Mermaid、Xterm、Excalidraw 延迟脚本的全局导出快路、并发 Promise、既有节点复用、load/error 监听清理、失败节点移除与重试；通用 stylesheet 辅助统一 Xterm/Excalidraw 的幂等 CSS 注入。
- 三个 vendor 文件只保留类型、资源路径、全局读取器与各自错误文案。Xterm 仍在每次入口先确保样式，Excalidraw 仍仅在首次真实加载前准备样式；构建产物路径和错误文本不变。架构门禁禁止三个适配器重新持有 `vendorPromise` 或直接创建脚本，审计 R-6 的 vendor loader 子项已关闭。
- 定向 14 项、Desktop 类型检查与改动文件 lint、160 项架构测试、913 文件架构扫描和 13 包整仓构建通过。Website 约 1,492 KiB，Desktop initial/total JS 为 2,103,646 / 2,975,138 字节；无依赖变更、迁移、业务数据操作或应用重启。

### 续接记录（2026-09-20，第一百二十一批生成图像 MIME 校验单源化）

- Shared 新增 Node 专用 `@sync-think/shared/node-image-validation`，集中 PNG/JPEG/WebP MIME 解析、文件扩展名匹配、文件头识别和声明 MIME 一致性判断；Runtime 生成图像读取、Desktop artifact 预览与 OpenAI Images Adapter 三条生产链删除重复实现。
- 共享层只返回类型、布尔值或 `undefined`；Runtime/Desktop 继续拥有原 `generated_image.*` / `artifact_image_preview.*` 错误码，文件系统所有者继续负责 `realpath`、大小、哈希和替换竞态校验。架构门禁禁止四个旧局部函数恢复，审计 R-6 的图像 MIME 子项已关闭。
- 定向 43 项、Shared/Adapters/Runtime/Desktop 类型检查、改动文件 lint、159 项架构测试、912 文件架构扫描和 13 包整仓构建通过。Website 约 1,493 KiB，Desktop initial/total JS 保持 2,104,273 / 2,975,765 字节；无依赖变更、迁移、业务数据操作或应用重启。

### 续接记录（2026-09-20，第一百二十批通用对象结构守卫单源化）

- Shared 新增浏览器安全的 `@sync-think/shared/value-validation` 子路径，以唯一 `isRecord(value)` 判定非空、非数组的普通对象；Protocol、Desktop、Runtime、Storage、Workers 共 28 处局部副本已迁移，现有宿主解析、错误和字段规则保持不变。
- Runtime 生产步骤执行器中更强的 `Record<string, JsonValue>` 守卫改名为 `isJsonRecord` 并继续就地保留，避免把 JSON 递归值语义错误收窄为通用对象判断。架构门禁禁止 Shared 之外重新声明通用 `isRecord`；审计 R-6 的该子项已关闭。
- 定向 209 项、五个消费层与 Shared 类型检查、改动文件 lint、158 项架构测试、911 文件架构扫描和 13 包整仓构建通过。Website 约 1,493 KiB，Desktop initial/total JS 为 2,104,273 / 2,975,765 字节；无依赖变更、迁移、业务数据操作或应用重启。

### 续接记录（2026-09-20，第一百一十九批 ASCII 控制字符规则单源化）

- Shared 新增浏览器安全的 `hasAsciiControlCharacter`，统一 C0 控制字符与 DEL 判定；Protocol Browser payload 与 Storage Browser 持久化边界删除逐字副本并直接复用。规则位于 Shared 根入口，不依赖 Node 或宿主错误协议。
- 架构规则将 Shared 标记为唯一所有者，Protocol/Storage 及后续源码若重新声明同名函数会直接失败。首次测试因 Shared `dist` 尚未重建而暴露工作区包消费顺序，构建 Shared 后原样复跑全部通过，确认真实包入口可用；R-6 的该子项已关闭，`isRecord` 等其它重复项仍待后续批次。
- Shared/Protocol/Storage 定向 20 项、三包类型检查与 lint、157 项架构测试、910 文件架构扫描和 13 包整仓构建通过。Website 约 1,493 KiB，Desktop initial/total JS 保持 2,104,315 / 2,975,807 字节；无依赖变更、迁移、业务数据操作或应用重启。

### 续接记录（2026-09-20，第一百一十八批 Node 路径包含规则单源化）

- 新增 Node 专用 `@sync-think/shared/node-paths` 子路径，以 `isPathWithinRoot(root, candidate)` 统一 Windows 盘符/UNC 与 POSIX 绝对路径的纯词法包含判断；Windows 路径要求完整盘符或 UNC 根，避免 `/path` 借用当前盘符造成跨风格误判。该子路径不从 Shared 浏览器入口导出，Renderer bundle 不会引入 `node:path`。
- Desktop Main、Runtime、Storage 与 Workers 已删除各自的 `isPathInside` / `isWithin` 算法并接入共享边界；文件、终端、浏览器和图片模块仍在各自基础设施层执行 `realpath`、符号链接或 junction 校验，共享函数不访问文件系统。架构规则禁止四层 Node 源码重新声明本地路径包含函数；审计 R-5 已关闭。
- 定向 136 项、五包类型检查、改动文件 ESLint、156 项架构测试、909 文件架构扫描及 13 包整仓构建通过。Website 约 1,493 KiB，Desktop initial/total JS 保持 2,104,315 / 2,975,807 字节；Desktop 全包 lint 的独立既有阻断仍为 `MarkdownImageGallery` 2 条 Hook 顺序错误和 `newmax-theme-engine` 4 条检查错误（另有 22 条 warning），本批未触碰。无迁移、业务数据操作或应用重启。

### 续接记录（2026-09-20，第一百一十七批 Browser payload 共享校验边界）

- 新增浏览器安全的 `@sync-think/protocol/browser-payloads` 子路径，集中 Browser Profile、Recording、Workflow 共 18 个 payload 的字段白名单、规范化、ID/文本/URL/分页/变量边界。Runtime 三个 validation 文件改为纯别名导出，Desktop 三个文件只保留原 `Invalid … payload` 抛错适配与 Profile 空载荷兼容。
- 六个宿主实现由 864 行重复规则收敛为 364 行共享真源和 178 行适配器，净减少 322 行生产解析代码；Workflow execute/approve 现在统一执行 Runtime 既有的变量名 512、值 4000 字符上限。架构规则禁止六个适配器重新声明校验函数，独立 Protocol 子路径避免 Browser bundle 引入根入口的 Node-only 实现。
- Protocol/Desktop/Runtime 定向 115 项、三层类型检查、定向 ESLint、155 项架构测试、908 文件架构扫描和 13 包整仓构建通过。Website 约 1,493 KiB，Desktop initial/total JS 保持 2,104,315 / 2,975,807 字节；审计 R-2 已关闭，无迁移、业务数据操作或应用重启。下一批继续处理范围较窄的共享校验，路径越界算法统一另作一批。

### 续接记录（2026-09-20，第一百一十六批 Renderer 重复执行投影清理）

- 删除 Renderer 零生产调用的 `projectExecutionProcess` 事件投影及两份封闭测试，共移除 1,932 行；过程事件到 `RunProcessView` 的投影现在只由 Runtime `run-process-view` 负责，Renderer 继续消费 Protocol 的已投影对象。
- 生产仍使用的计数、耗时、消息时间和模型名称格式化迁入 79 行 `run-display-format`，并以 5 项纯函数测试覆盖；`process-item-outcome` 改用 Protocol `RunProcessView`，不再借用本地重复类型。接线测试显式禁止旧投影模块恢复。
- Desktop/Runtime 定向 116 项、Desktop 类型检查、定向 ESLint（0 error，16 条既有 Hook warning）、154 项架构测试、907 文件架构扫描和 13 包整仓构建通过。Website 约 1,493 KiB，Desktop initial/total JS 为 2,104,315 / 2,975,807 字节；审计 R-1 已关闭，无新增依赖、迁移、业务数据操作或应用重启。下一批继续处理可独立验证的共享校验边界，不进入长消息虚拟化专项。

### 续接记录（2026-09-20，第一百一十五批用量汇总有界响应）

- `usage.summary` 新增 `includeRequests` / `requestLimit` 查询合同，服务端默认最多返回最近 500 条明细并拒绝超过 1000 条的请求；聚合总数、Token、费用与模型行始终覆盖完整查询范围。只需要累计值的任务用量和聊天 Provider 今日/30 天浮窗改为纯聚合读取，设置页明确提示“已加载最近 N 条，共 M 条”。
- Runtime 在一次请求遍历中同时完成明细装饰、总量累计和 provider/model 费用索引，模型行不再逐行 `requests.filter`，响应投影从 O(rows × requests) 收敛为 O(rows + requests)。Worker/sidecar 的大事件扫描边界保持不变，今日窗口按本地零点计算并复用 5 分钟范围缓存。
- 定向 89 项、Protocol/Runtime/Desktop 类型检查、定向 ESLint（0 error，17 条既有 Hook warning）、154 项架构测试、907 文件架构扫描和 13 包整仓构建通过。Website 约 1,493 KiB，Desktop initial/total JS 为 2,104,340 / 2,975,832 字节；审计 P1-4 已关闭，无新增依赖、迁移、业务数据操作或应用重启，Electron PID `67332` 保持运行。下一批继续选择边界明确的重复实现或路径校验项；P1-2 长消息虚拟化仍保留为专项交互任务。

### 续接记录（2026-09-20，第一百一十四批 Renderer 可见性轮询边界）

- 新增共享 `useVisiblePolling`：用单一文档可见性订阅结合 `KeepAliveLayer` 激活状态，隐藏窗口或保活后台页不再发起周期请求；递归定时器保证同一读取不重叠，失败按倍数退避，恢复可见或资源 ID 变化时立即读取。
- ChatView Goal、设置页守护进程和机器人通道三处固定 interval 已迁移。Goal 保留 active 2 秒/非 active 30 秒刷新语义；机器人切换通道不再重启七通道全量请求，也不会用后台结果覆盖正在输入的凭据，周期读取失败改为可见错误；微信扫码的用户触发短时轮询保持独立。
- 定向 107 项、Desktop 类型检查、改动文件 lint、154 项架构测试、907 文件架构扫描和 13 包整仓构建通过。Website 约 1,493 KiB，Desktop initial/total JS 为 2,104,316 / 2,975,682 字节；审计 P1-3 已关闭，无新增依赖、迁移或业务数据操作，Electron PID `67332` 保持运行且未重启。下一批优先处理边界更明确的 P1-4 用量汇总复杂度；P1-2 长消息虚拟化保留为专项交互任务。

### 续接记录（2026-09-20，第一百一十三批会话目录稳定游标分页）

- Protocol、Main 和 Runtime 的 `conversation.list` 支持可选 `cursor` / `limit` 与 `nextCursor`；Storage 通过完整侧栏排序键执行 keyset 分页，页大小限制 1–200。旧无分页调用继续返回完整数组，不影响内部数据管理等既有消费者。
- `conversation-catalog-loader` 以 100 条为一页汇总 Shell 完整目录，负责游标推进、跨页去重和重复游标保护；Shell 只消费最终快照。因此侧栏、归档、跨工作区活动、深链与布局裁剪行为保持，单个 Runtime Frame / IPC 载荷获得硬上限。全目录总工作量仍随会话数线性增长，后续只有在实际指标需要时才引入按需 UI 加载，避免本批改变产品行为。
- Protocol/Storage/Runtime/Main/Desktop 定向 192 项、四层类型检查、定向 ESLint（0 error，2 条既有 Hook warning）、154 项架构测试、906 文件架构扫描和 13 包整仓构建通过。Website 约 1,493 KiB，Desktop initial/total JS 为 2,103,381 / 2,974,374 字节；P1-1 的三项整改已完成，无新增依赖、迁移或业务数据操作，Electron PID `67332` 保持运行且未重启。

### 续接记录（2026-09-20，第一百一十二批 Shell 刷新合并与快照降频）

- `RefreshCoordinator` 现在拥有 Shell 目录刷新调度：同一任务内请求共享一轮读取；当前轮运行时到达的新请求只追加一轮尾随刷新，且等待尾随结果，避免既重复拉取六类目录又把修改后的调用者交给旧快照。
- `shell-boot-snapshot` 新增 250ms 尾随写入器，只保留最后一份成功目录数据并在 Shell 卸载时冲刷；`ShellApp` 不再在每次刷新成功后立即同步序列化整份快照。原子提交、失败保留旧目录和 Toast 语义不变。审计 P1-1 的 in-flight 合并与写盘降频已完成，分页在第一百一十三批完成。
- 协调器/快照/Shell 86 项、Desktop 类型检查、定向 ESLint（0 error，2 条既有 Hook warning）、154 项架构测试、905 文件架构扫描和 13 包整仓构建通过。Website 约 1,493 KiB，Desktop initial/total JS 为 2,103,028 / 2,974,021 字节；无新增依赖、迁移或业务数据操作，Electron PID `67332` 保持运行且未重启。

### 续接记录（2026-09-20，第一百一十一批本地 Skill 扫描异步化）

- `local-skill-discovery` 的启用插件来源发现、目录递归、`SKILL.md` 读取、stat 和 realpath 去重均改用异步文件 API；`skill.local.scan` 通过 Runtime 后台任务响应，单次扫描不再独占 socket 事件循环。
- Runtime 扫描缓存新增代次/in-flight 协调，扫描期间的新刷新不会被旧结果覆盖；文件 watcher 的刷新进入统一后台任务集合，来源列表随扫描缓存并由响应摘要、watcher 共用。安装复制和落库事务保持原同步原子边界，本批未扩大到 Skill 写路径。
- 定向 14 项、Runtime 类型检查、定向 ESLint、154 项架构测试、904 文件无环扫描和 13 包整仓构建通过；事件循环回归确认 timer 可在 40 文件扫描完成前运行。Runtime 全量为 1810/1815，5 条独立既有失败单线程仍可复现（进程分页 1、委派规则 3、宿主工具目录 1），不在本批修改范围。Website 约 1,493 KiB，Desktop initial/total JS 为 2,101,896 / 2,972,889 字节；审计 P0-1 已关闭，Electron PID `67332` 保持运行且未重启。

### 续接记录（2026-09-20，第一百一十批设置页用量统计重挂载缓存）

- `provider-usage-summary` 现在按时间范围维护 5 分钟成功快照与 in-flight 请求，且可同步读取新鲜缓存；`UsageSettings` 重挂载时直接用该快照初始化，关闭再打开设置不再重复加载相同统计。24 小时、7 天、30 天和全部范围相互隔离。
- 手动刷新和价格保存继续强制绕过 TTL，错误不写入成功缓存；聊天页既有 30 天 Provider 汇总复用同一基础设施。选择窄数据缓存而非 `forceMount` 整个设置弹窗，避免隐藏 Radix 模态继续保留焦点、事件和其它页面状态。审计 P0-3 已关闭。
- 用量缓存 4 项、ModelSettings 50 项、ChatView 用量 21 项、Desktop 类型检查、定向 ESLint（0 error，1 条既有 Hook warning）、154 项架构测试、904 文件无环扫描和 13 包整仓构建通过。Website 约 1,493 KiB，Desktop initial/total JS 为 2,101,896 / 2,972,889 字节；无新增依赖、迁移或业务数据操作，Electron PID `67332` 保持运行且未重启。

### 续接记录（2026-09-20，第一百零九批 Renderer Skill 目录共享加载边界）

- 新增 `skill-catalog-loader`，以 Runtime bridge 实例和全局/工作区作用域隔离缓存，统一 500 条请求、并发合并、成功快照和失效代次；失败不缓存，Mutation 期间完成的旧请求会自动转入新代次重读。
- Shell 快照、空态 Composer、ChatView 斜杠菜单、`TurnSkillControl`、`AbilityCenterPage` 与 `AgentLibrary` 六个生产消费者均通过该边界读取；Shell 刷新、能力页重新进入和手动刷新仍可强制请求，能力写操作统一失效。AST 门禁保证生产 Shell 只有该加载器能直接调用 `listSkills`；本批完成 P0-2 的 Skill 子项，MCP 子项已在第一百二十九批完成。
- 共享加载器 6 项、相关 UI 189 项、Desktop 类型检查、定向 ESLint（0 error，18 条既有 Hook warning）、154 项架构测试、904 文件无环扫描和 13 包整仓构建通过。Website 约 1,493 KiB，Desktop initial/total JS 为 2,101,496 / 2,972,339 字节；无新增依赖、迁移或业务数据操作，Electron PID `67332` 保持运行且未重启。

### 续接记录（2026-09-20，第一百零八批能力页后台固定轮询移除）

- `KeepAliveLayer` 通过可见性上下文向被冻结的保活子树发布激活状态；`AbilityCenterPage` 只在首次进入或重新进入能力页时扫描本地 Skill，不再注册 30 秒固定轮询。隐藏页不再持续发起一次磁盘扫描和四类目录 IPC，页面 DOM 与滚动位置保持。
- 手动重新扫描、能力 Mutation 后目录刷新及错误提示保持；审计 P0-1 的持续后台轮询部分已关闭。`skillLocalScan({ refresh: true })` 的单次 Runtime 扫描仍是同步文件遍历，异步化留作独立后续项。
- KeepAlive 4 项、Abilities 43 项、Shell 定向集成 1 项、Desktop 类型检查、定向 ESLint、153 项架构测试、903 文件无环扫描和 13 包整仓构建通过。Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,856 / 2,971,573 字节；无新增依赖、迁移或业务数据操作，Electron PID `67332` 保持运行且未重启。

### 续接记录（2026-09-20，第一百零七批 Task Status Git 轮询移除）

- 生产调用图确认 `TaskStatusPanel` 当前只挂载于 `Phase3VisualFixture`/QA 入口；Main/Preload 中的 Git 能力由该面板按需消费，正式 `ChatView` 不挂载它。
- 移除面板的 5 秒 `setInterval`，保留挂载、window focus 与 Git Mutation 成功后的刷新；即使后续接入生产，也不再持续派生 Git 子进程。审计 B-4 已关闭。
- Task Status 14 项、Desktop 类型检查、定向 ESLint、153 项架构测试、903 文件无环扫描和 13 包整仓构建通过。Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,643 / 2,971,344 字节；无新增依赖、迁移或业务数据操作，Electron PID `67332` 保持运行且未重启。

### 续接记录（2026-09-20，第一百零六批 Shell 刷新错误隔离）

- `ShellApp.refresh()` 改为六个目录读取全部成功后才提交 `ShellData`、启动快照与布局裁剪；任一 RPC 失败保留当前目录，避免半更新状态。
- 刷新边界内部捕获 bridge/RPC/投影错误，返回显式 `ShellRefreshResult`；启动流据此切换 ready/error，其他后台入口以去重 Toast 告知而不再产生 unhandled rejection。审计 B-3 已关闭；P1-1 的合并/写盘已在第一百一十二批完成，目录分页仍待后续。
- `ShellApp` 79 项、Desktop 类型检查、定向 ESLint（0 error，保留既有 2 条 Hook warning）、153 项架构测试、903 文件无环扫描和 13 包整仓构建通过。Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,643 / 2,971,344 字节；无新增依赖、迁移或业务数据操作，Electron PID `67332` 保持运行且未重启。

### 续接记录（2026-09-20，第一百零五批 Activity 刷新竞态与本地 Skill 扫描错误）

- `ActivityCenterPage` 为全量刷新增加请求代次守卫，只有最新过滤条件对应的响应可以更新列表、计数、游标、错误和 loading；刷新代次变化时丢弃在途旧分页结果，卸载时使所有响应失效。审计 B-1 已关闭。
- `AbilityCenterPage` 为本地 Skill 扫描建立独立错误状态，失败时保留现有候选并在“我的 Skill”展示原因与“重新扫描”；成功扫描清除提示，不再静默展示陈旧列表，也不污染目录加载/编辑弹窗错误。审计 B-2 已关闭。
- Activity 11 项、Abilities 43 项、Desktop 类型检查、定向 ESLint、153 项架构测试、903 文件无环扫描和 13 包整仓构建通过。Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,382 / 2,971,083 字节；无新增依赖、迁移或业务数据操作，Electron PID `67332` 保持运行且未重启。

### 续接记录（2026-09-20，第一百零四批 Renderer 根目录旧投影清理）

- 删除 `beginner-workspace`、`browser-profiles`、`child-tasks`、`collaboration-intent`、`compose-models`、`continuum-evidence`、`left-instrument-switch`、`recent-conversations`、`runtime-view-state` 九个生产零引用模块及八个同名封闭测试，共删除 17 个文件；连同混合测试清理共移除 1,856 行、补入 7 行。
- 事件历史冷启动测试改为直接覆盖现有 `mergeEventHistory` 与 `projectM0EventHistory`，保留多轮消息、Manifest 和 taskVersion 恢复断言；Runtime 连接控制器与生产 Shell 构建资产测试继续覆盖当前实现。审计 D-17 已关闭。
- Runtime 连接/事件历史 29 项、生产构建资产 1 项、Desktop 类型检查、153 项架构测试、903 文件无环扫描和 13 包整仓构建通过。Website 约 1,492 KiB，Desktop initial/total JS 保持 2,100,382 / 2,970,315 字节；无新增依赖、迁移或业务数据操作，Electron PID `67332` 保持运行且未重启。

### 续接记录（2026-09-20，第一百零三批 M1/M2 Renderer 验收脚手架退役）

- 删除 19 个只由历史验收测试互相引用的 M1/M2 Renderer 模块、18 个专属测试和旧 `selftest-m1-soft` 脚本，共删除 38 个文件、移除 9,854 行；Desktop 的生产 TypeScript 输入不再编译这套里程碑展示模型。
- `m1-open-doc`、handtest 文档解析、dogfood 证据加载/评分及其 Main/IPC 测试继续保留；M2 自检只移除零生产消费者的 `m2-workspace` 阶段，真实 orchestration payload、Shared/Core/Storage/Runtime/UI Kit 六阶段门禁保持。
- 保留链路 38 项、Desktop 类型检查、M2 六阶段 274 项、153 项架构测试、912 文件无环扫描和 13 包整仓构建通过。Website 约 1,492 KiB，Desktop initial/total JS 保持 2,100,382 / 2,970,315 字节；无新增依赖、迁移或业务数据操作，Electron PID `67332` 保持运行且未重启。D-14 的 M1/M2 部分已完成，9 个非里程碑旧 Renderer 根模块留给下一批逐项确认。

### 续接记录（2026-09-20，第一百零二批 Settings 旧机器人对话实现清理）

- 删除 `SettingsPage` 未挂载的 `LegacyBotConversationPane`、旧通道目录、空 Telegram 配置和专属导入，共减少 224 行；审计 D-2 已关闭。
- 当前设置页继续只挂载独立 `BotConversationPane`，机器人凭据、连接和 Bot Channel wiring 不变；Desktop initial/total JS 分别减少 7 / 4,845 字节。
- Desktop 类型检查、Settings/Bot 61 项、定向 ESLint、153 项架构测试、931 文件无环扫描和 13 包整仓构建通过。Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,382 / 2,970,315 字节；无新增依赖、迁移或业务数据操作，Electron PID `67332` 保持运行且未重启。

### 续接记录（2026-09-20，第一百零一批 RightDock 旧 WorkspacePanel 清理）

- 删除 `RightDock` 内零引用的旧 `WorkspacePanel`，连同仅服务于它的 Git 分支/变更/提交展示状态和递交文件树辅助闭环，共减少 538 行；审计 D-3 已关闭。
- 当前文件与 Review 工作台继续由 `WorkspaceFilesPanel`、`ReviewPanel`、`WorkspaceWorkbench` 承担；底层 Git IPC 和 Task Status 消费保持，未改变现有工作区能力。
- Desktop 类型检查、RightDock/Workbench/文件树/延迟 Diff 39 项、定向 ESLint、153 项架构测试、931 文件无环扫描和 13 包整仓构建通过。Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,389 / 2,975,160 字节；无新增依赖、迁移或业务数据操作，Electron PID `67332` 保持运行且未重启。

### 续接记录（2026-09-20，第一百批旧 RightRail 与任务历史面板清理）

- 删除无生产入口的旧 `RightRail`；当前右侧文件/Review 工作台继续由 `RightDock` 与 `WorkspaceWorkbench` 提供，进程展示仍只在消息内消费统一 `RunProcessView`。
- 删除只被自身测试引用的 `TaskPlanHistoryPanel` 及测试；`ComposerTaskPanel`、`TaskPanel`、`TaskStatusPanel` 保持当前任务 UI 唯一路径。审计 D-1、D-4 已关闭，共删除 716 行旧实现/测试连接代码；D-3 的 `WorkspacePanel` 连带提交树辅助函数留到独立下一批。
- Desktop 类型检查、Desktop 32 项、UI Kit 6 项、定向 ESLint、153 项架构测试、931 文件无环扫描和 13 包整仓构建通过。Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,389 / 2,975,160 字节；无新增依赖、迁移或业务数据操作，Electron PID `67332` 保持运行且未重启。

### 续接记录（2026-09-20，第九十九批 Main 与 Runtime 零引用辅助面清理）

- Main 删除未调用的 `connectToRuntime` / `probeFrameRoundtrip`，保留内部连接生命周期与类型化 Runtime 客户端；消息图片删除旧 `file://` URL 辅助，只保留 `sync-think-image://` 暴露。
- Runtime 删除 Capability Broker 宽泛工具名判断、Chat Tools 未消费的只读白名单和旧 ENOENT 提示生成器；实际执行仍使用更窄的 `isUseCapabilityToolName`、变更工具集合与当前真实失败提示。审计 D-5 至 D-8 已关闭。
- Desktop/Runtime 类型检查、消息图片/Main 12 项、Capability/Chat Tools 75 项、定向 ESLint、153 项架构测试、933 文件无环扫描和 13 包整仓构建通过。Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,389 / 2,975,160 字节；无新增依赖、迁移或业务数据操作，Electron PID `67332` 保持运行且未重启。

### 续接记录（2026-09-20，第九十八批零引用执行入口与 Renderer 状态清理）

- Runtime 删除未调用的 `registerAutostart` / `unregisterAutostart`，Desktop supervisor 继续独占实际注册/移除；在用的状态查询与命令构造器保留。
- Desktop 删除 Terminal Session 死全局单例和旧 Composer 菜单路径，显式 Store 工厂、宿主 kill、现有模式/溢出/添加菜单行为不变；Workers 临时超时调试脚本已删除。审计 D-9、D-10、D-11、D-15 已关闭，净删除 214 行受版本控制的死代码。
- Runtime/Desktop/Workers 类型检查、Daemon 3 项、Terminal/Composer 43 项、定向 ESLint、153 项架构测试、933 文件无环扫描和 13 包整仓构建通过。Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,389 / 2,975,160 字节；无新增依赖、迁移或业务数据操作，Electron PID `67332` 保持运行且未重启。

### 续接记录（2026-09-20，第九十七批 Core 审核策略兼容层清理）

- 删除 Core `rework-policy` 纯转发模块、重复测试及公开入口导出，Shared `review-policy` 现为审核/返工规则唯一权威边界；旧 `dist` 残留生成物也已清除。
- M2 自检把 Shared review 测试设为独立首阶段并更新六阶段顺序断言，架构门禁禁止旧 Core 路径恢复。Artifact legacy conflict 测试仅同步现有 `0056`—`0058` 迁移名称，迁移和运行逻辑不变。
- Shared/Core 类型检查、Shared 13 项、Core 205 项、Artifact 17 项、M2 六阶段 284 项、定向 ESLint、153 项架构测试、933 文件无环扫描和 13 包整仓构建通过。Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,445 / 2,975,216 字节；无新增依赖、迁移或业务数据操作，Electron PID `67332` 保持响应且未重启。

### 续接记录（2026-09-20，第九十六批 Desktop Waiting 安全投影边界）

- Runtime 新增纯 `desktop-waiting-projection`，识别等待用户/等待检查两类工具结果，并从脱敏命令参数生成只含 `processId/title/appId` 的公开目标摘要。
- `runtime.ts` 净减少 44 行，仍负责 Desktop 命令持久化、任务归属、事件顺序和查询/继续/取消生命周期；架构门禁禁止新投影反向依赖 Runtime 状态或基础设施，Browser 子域保持独立。
- Runtime 类型检查、纯投影 16 项、真实 Computer Use 集成 13 项、定向 ESLint、152 项架构测试、934 文件无环扫描和 13 包整仓构建通过。Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,445 / 2,975,216 字节；本批无依赖、迁移或业务数据操作，当前 Electron PID `67332` 保持运行且未重启。

### 续接记录（2026-09-20，第九十五批 ChatView 会话滚动位置边界）

- Desktop Shell 新增 `conversation-scroll-position`，拥有会话位置内存/本地持久化、存储异常容错、可见消息锚点捕获和滚动恢复几何；缓存继续无上限，以保持跨会话重挂载阅读位置。
- ChatView 只在既有保存/恢复时机调用模块，净减少 116 行；导航、消息窗口、历史页和流式跟随状态仍由原边界负责。架构规则禁止新模块依赖 ChatView、宿主通信或基础设施。
- Desktop 类型检查、滚动模块 4 项及滚动/历史/跳转集成 19 项、定向 ESLint（0 error，保留既有 16 条 Hook warning）、151 项架构测试、933 文件无环扫描和 13 包整仓构建通过。Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,445 / 2,975,216 字节；本批无依赖、迁移或业务数据操作，当前 Electron PID `67332` 保持运行且未重启。

### 续接记录（2026-09-20，第九十四批计划步骤图验证边界）

- Shared 新增纯 `orchestration-plan-graph`，返回重复步骤、Merge 依赖不足、自依赖、重复/缺失依赖和依赖环的确定性结构化问题，不感知数据库或异常传输。
- `orchestration-store` 只负责把该问题映射为原有调用输入错误或持久数据错误；解码、错误路径/文案/优先级、SQLite 与事务均保持。架构夹具验证 Shared 对 Runtime/Storage 的反向依赖会被既有门禁拒绝。
- Shared/Storage 类型检查、纯图验证 7 项、编排存储 27 项、定向 ESLint、150 项架构测试、932 文件无环扫描和 13 包整仓实际重建通过。Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,447 / 2,975,218 字节；本批无依赖、迁移或业务数据操作，当前 Electron PID `67332` 保持运行且未重启。

### 续接记录（2026-09-20，第九十三批计划修订差异算法边界）

- Shared 新增纯 `orchestration-plan-diff`，统一计划步骤快照克隆、无序依赖比较、稳定字段变化顺序，以及新增/移除/修改差异生成。
- `orchestration-store` 仅组合该规则完成计划修订和持久 diff 完整性校验；SQLite 输入校验、反序列化、事务、版本冲突和事件写入保持在 Storage，数据库结构及行为不变。
- Shared/Storage 类型检查、纯差异 3 项、编排存储 27 项、定向 ESLint、149 项架构测试、931 文件无环扫描和 13 包整仓构建通过。Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,447 / 2,975,218 字节；本批无依赖、迁移或业务数据操作，当前 Electron PID `67332` 保持运行且未重启。

### 续接记录（2026-09-20，第九十二批 ChatView 运行身份与 Kernel 投影边界）

- Desktop 新增纯 `run-identity-projection`，一次扫描 `run.started` 事件，同时恢复运行绑定的全局 Agent 身份与 Kernel；顶层字段和嵌套 durable run 快照均保持兼容。
- ChatView 通过单个 `useMemo` 消费组合结果，并兼容重导出原函数，净减少 42 行；架构门禁禁止新叶子反向依赖 ChatView、Main/Preload 或基础设施。
- Desktop 类型检查、身份/Kernel/委派 UI 相关 54 项、149 项架构测试、930 文件无环扫描、定向 ESLint（0 error，保留既有 Hook warning）和 13 包整仓构建通过。Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,447 / 2,975,218 字节；本批无依赖、迁移或业务数据操作，当前 Electron PID `67332` 保持运行且未重启。

### 续接记录（2026-09-20，第九十一批跨 Kernel 会话 Transcript 投影边界）

- Runtime 新增纯 `kernel-session-transcript`，拥有内容文本化、恢复/gap transcript、持久消息可移植投影、字节边界和当前用户消息识别；仅依赖 Shared `Message` 与本地最小消息结构。
- `runtime.ts` 净减少 160 行并兼容重导出既有公开函数；原生 Kernel 会话恢复、路由、凭据和会话失效状态机仍由 Runtime 负责。架构门禁禁止新叶子反向依赖 Runtime、DemoRun、Adapter 或基础设施。
- Runtime 类型检查、transcript/恢复/准入相关 22 项、148 项架构测试、929 文件无环扫描、定向 ESLint和 13 包整仓构建通过。Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,591 / 2,975,362 字节；本批无依赖、迁移或业务数据操作，当前 Electron PID `67332` 保持运行且未重启。

### 续接记录（2026-09-20，第九十批 Goal 轮次协议与任务清单投影边界）

- Runtime 新增纯 `goal-turn` 与 `task-plan-context`：前者负责 Goal 状态标记、轮次提示和默认上限，后者负责清单事件投影与模型文本；原公开函数由 `runtime.ts` 兼容重导出。
- `runtime.ts` 净减少 116 行，仅继续协调目标生命周期、持久化、自动续跑和 Token 结算；架构规则禁止两个叶子模块反向依赖 Runtime 状态、DemoRun 或基础设施。
- Runtime 类型检查、目标/清单/执行准入相关 23 项、147 项架构测试、928 文件无环扫描、定向 ESLint和 13 包整仓构建通过。Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,591 / 2,975,362 字节；本批无依赖、迁移或业务数据操作，当前 Electron PID `67332` 保持运行且未重启。

### 续接记录（2026-09-20，第八十九批委派旧消息兼容读取与实时卡片持久化分离）

- 委派消息块解析迁入纯 `delegation-message-projection`；旧消息兼容读取由 `DelegationLegacyMessageHistory` 单独负责，实时 `DelegationMessageHistory` 只保留卡片读取与写入。
- `DelegationService` 在组合层分别注入两个边界，旧会话仍按现有消息格式和精确 child run 查询恢复，实时卡片合并、延迟持久化与终态行为不变；架构规则阻止三个叶子模块反向依赖门面、执行用例或基础设施。
- Runtime 类型检查、委派历史相关 32 项、145 项架构测试、926 文件无环扫描、定向 ESLint和 13 包整仓构建通过。Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,591 / 2,975,362 字节；本批无依赖、迁移或业务数据操作，当前 Electron PID `67332` 保持运行且未重启。

### 续接记录（2026-09-20，第八十八批生产执行预留共享契约与生命周期端口）

- 生产执行结果、fence、reservation 与 MCP intent DTO 迁入 Shared，Storage 继续兼容重导出；预留事务实现和持久格式不变。
- Runtime 新增五方法执行预留生命周期端口，生产步骤执行器移除最后一个具体 Storage 类型及全部 Storage 包导入；架构门禁禁止任何 Storage 依赖回流。
- Shared/Storage/Runtime 编译、执行预留事务 9 项、生产执行器 33 项、143 项架构测试、924 文件无环扫描、定向 ESLint和 13 包整仓实际重建通过。Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,591 / 2,975,362 字节；本批无依赖、迁移或业务数据操作，未重启当前应用。

### 续接记录（2026-09-20，第八十七批生产步骤执行器 Agent Context 生命周期端口）

- 生产步骤执行端口新增单方法 Agent Context epoch 生命周期能力，复用共享输入/输出契约；执行器移除 `SqliteAgentContextStore` 具体类型。
- 组合根继续注入现有 Context Store，epoch 复用/轮换和 prompt cache key 行为不变；架构门禁禁止具体 Agent Context 存储类型回流。
- Runtime 类型检查、生产执行器 33 项、142 项架构测试、923 文件无环扫描、定向 ESLint和 13 包整仓构建通过。Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,591 / 2,975,362 字节；本批无依赖、迁移或业务数据操作，未重启当前应用。

### 续接记录（2026-09-20，第八十六批生产步骤执行器 Skill 授权与正文端口）

- 生产步骤执行端口新增 Skill 准入元数据、提示词正文和权限批准查询，执行器移除 `SqliteSkillStore` 具体类型；存储实现仍由组合根结构化适配。
- Skill allowlist、启用/归档状态、批准校验和正文投影行为不变；架构门禁禁止具体 Skill 存储类型回流。
- Runtime 类型检查、生产执行器 33 项、141 项架构测试、923 文件无环扫描、定向 ESLint和 13 包整仓构建通过。Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,591 / 2,975,362 字节；本批无依赖、迁移或业务数据操作，未重启当前应用。

### 续接记录（2026-09-20，第八十五批生产步骤执行器 Provider 最小投影端口）

- 生产步骤执行端口新增模型、Provider 与凭据路由最小投影，执行器移除 `SqliteProviderStore` 具体类型；现有 Provider 存储继续由组合根结构化适配。
- `describe-image` 改用中立 `CatalogModelSource`，不再依赖 Storage `ModelRecord`，并纳入运行时基础设施隔离门禁；视觉能力和手动覆盖行为保持。
- Runtime 类型检查、相关 84 项、140 项架构测试、923 文件无环扫描、定向 ESLint和 13 包整仓构建通过。Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,591 / 2,975,362 字节；本批无依赖、迁移或业务数据操作，未重启当前应用。

### 续接记录（2026-09-20，第八十四批生产步骤执行器 Agent 最小投影端口）

- 生产步骤执行端口新增 AgentVersion 最小投影，仅承载模型绑定、浏览器权限、Skill 白名单和系统提示词字段；执行器移除 `SqliteAgentStore` 具体类型及其返回类型推导。
- 组合根继续注入现有 Agent 存储，精确版本查询与运行行为不变；架构门禁禁止具体 Agent 存储类型回流。
- Runtime 类型检查、生产执行器 33 项、138 项架构测试、923 文件无环扫描、定向 ESLint和 13 包整仓构建通过。Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,591 / 2,975,362 字节；本批无依赖、迁移或业务数据操作，未重启当前应用。

### 续接记录（2026-09-20，第八十三批生产步骤执行器 Workspace 最小投影端口）

- 生产步骤执行端口新增 Task/Workspace 最小投影，只暴露 `workspaceId` 与 `folderPath`；执行器不再以 `SqliteWorkspaceStore` 或完整存储记录作为依赖。
- 持久化组合根继续注入现有实现，工具工作目录、浏览器 handoff 与 fence 行为不变；架构门禁禁止具体 Workspace 存储类型回流。
- Runtime 类型检查、生产执行器 33 项、137 项架构测试、923 文件无环扫描、定向 ESLint和 13 包整仓构建通过。Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,591 / 2,975,362 字节；本批无依赖、迁移或业务数据操作，未重启当前应用。

### 续接记录（2026-09-20，第八十二批生产步骤执行器 Run 状态端口）

- 新增 `ProductionStepExecutionRuns`，把生产步骤执行期间的 `getRun` / `getGraph` 读取从 `SqliteOrchestrationStore` 具体类型中抽离；持久化组合根继续注入同一实例，运行行为不变。
- 端口纳入调度核心架构边界，并增加防回流规则，禁止端口依赖存储实现或执行器重新引用具体编排存储类型。其余生产执行器存储参数仍按后续独立用例逐步收窄。
- Runtime 类型检查、生产执行器 33 项、136 项架构测试、923 文件无环扫描、定向 ESLint和 13 包整仓构建通过。Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,591 / 2,975,362 字节；本批无依赖、迁移或业务数据操作，未重启当前应用。

### 续接记录（2026-09-20，第八十一批 ChatView 消息合并边界）

- 新增纯 `conversation-message-merge`，接管持久消息排序、旧终态回填排序、乐观气泡去重和持久/乐观/流式消息的稳定虚拟序号合并；ChatView 只提供当前作用域状态。
- 新模块只依赖 `conversation-types`，不依赖 React、ChatView、IPC、Main/Preload 或基础设施；历史分页覆盖与消息页合并继续由 `conversation-history-pages` 独立拥有。
- Desktop 类型检查、消息/历史导航相关 15 项测试、定向 ESLint（0 error）、135 项架构测试、922 文件无环扫描和 13 包整仓构建通过。Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,591 / 2,975,362 字节；本批无依赖、迁移或业务数据操作，未重启当前应用。

### 续接记录（2026-09-20，第八十批生产源码依赖环门禁）

- 新增 `architecture-dependency-graph`，以 TypeScript AST 构建 921 个生产源文件的依赖图，覆盖静态/类型/动态导入、相对路径与工作区包入口，并用强连通分量检测依赖环；已接入 `lint:architecture` 和根构建 prebuild。
- 首次扫描仅发现 `protocol/commands.ts ↔ run-process-page.ts` 一个既有环。`ConversationGetRunProcessPayload` 已迁入拥有解析职责的 `run-process-page`，`commands` 保留兼容类型重导出，公共 Protocol API 不变。
- 新增 4 项依赖图测试；Protocol 构建和 Run Process 4 项回归、134 项架构测试、921 文件无环扫描、定向 ESLint 与 13 包整仓构建通过。Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节；本批无依赖、迁移或业务数据操作，未重启当前应用。

### 续接记录（2026-09-20，第七十九批 Desktop/UI Kit 兼容层清理）

- Desktop 的 ChatView、ShellApp、Composer 菜单和对应测试已直接消费 `@sync-think/ui-kit`；删除 `ComposerModeBanner`、`ComposerTaskPanel` 与 `NewMaxComposerFrame` 三个仅重导出的本地兼容壳。
- 架构规则禁止 Desktop 重新导入旧本地模块，Website 与 Desktop 共享同一 UI Kit 公开入口；组件实现、交互、动效时长和 CSS 契约不变。
- Desktop 类型检查、相关 40 项测试、UI Kit 12 项测试、定向 ESLint（0 error）、130 项架构测试、921 文件架构扫描和 13 包整仓构建通过。Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节；本批无依赖、迁移或业务数据操作，未重启当前应用。

### 续接记录（2026-09-20，第七十八批消息图片附件边界）

- `message.attachImages` 已纳入既有 Protocol `conversation-command-contract`，Conversation Write handler 在宿主完成图片落盘后通过 `requestConversation` 发布附件持久引用；已迁移的类型化命令共 212 项。
- 图片暂存、消息写入、文件持久化、附件事件和本地 URL 返回顺序不变。Main 组合根已删除最后一个业务命令的通用 transport 端口；全 Main 审计仅余两处 `runtime.healthcheck` 基础设施探测，以及 RuntimeClient 内部类型化适配实现。
- Protocol 构建、Desktop 类型检查、Conversation Write/合同相关 11 项、Runtime 图片持久化集成 1 项、定向 ESLint、130 项架构测试与 924 文件架构扫描通过。
- 本批无依赖、迁移或业务数据操作，未重启当前应用。整仓构建、差异检查和 transport 范围审计均已完成。

### 续接记录（2026-09-20，第七十七批 Kernel Recycle 生命周期入口）

- `kernel.recycle` 已纳入既有 Protocol `kernel-command-contract`，新增 `KernelRecyclePayload` 并由 RuntimeClient `requestKernel` 类型化调用；已迁移的类型化命令共 211 项。
- 本批只收口私有内核安装/更新后的 Main → Runtime 内部调用，不新增 Renderer IPC，不改变安装、探测、重启或有租约会话的延迟回收策略。Main 通用 Runtime 传输仅余 `message.attachImages`。
- Protocol 构建、Desktop 类型检查、Desktop 相关 6 项测试、Runtime 回收状态机 10 项、定向 ESLint、130 项架构测试与 924 文件架构扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移或业务数据操作；未重启当前应用。下一批迁移消息图片附件并审计 Main 的通用传输余量。

### 续接记录（2026-09-20，第七十六批数据管理边界）

- 新增 Protocol `data-management-command-contract`，关联空间统计、导出、导入、备份、压缩和两类清理共 7 项请求/响应；已迁移的类型化命令共 210 项。
- Desktop 新增纯 `data-management-payloads` 与 Main `data-management-handlers`，Main 组合根删除八组直接注册并通过窄端口保留保存/打开对话框、系统路径打开和默认文件名生成。托盘打开数据目录的旁路也改用 `requestDataManagement`；Runtime 继续拥有 SQLite/文件内容、备份一致性、冲突处理和清理事务。
- Protocol 构建、Desktop 类型检查、相关 23 项测试、Protocol 数据解析 2 项、Runtime 数据服务 5 项、定向 ESLint、130 项架构测试与 924 文件架构扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移或业务数据操作；未重启当前应用。Main 通用 Runtime 传输仅余 `kernel.recycle` 与 `message.attachImages`，下一批先迁移 Kernel Recycle。

### 续接记录（2026-09-20，第七十五批 Web Search Provider 管理边界）

- 新增 Protocol `web-search-provider-command-contract`，关联 Provider 列表、保存、排序和连接测试 4 项请求/响应；已迁移的类型化命令共 203 项。
- Desktop 新增 Main `web-search-provider-handlers`，Main 组合根删除四组直接注册；Preload 复用共享通道常量。既有 Protocol 解析器继续作为唯一载荷校验源，配置持久化、密钥存储、路由、网络测试和错误脱敏仍由 Runtime 拥有。
- Protocol 构建、Desktop 类型检查、相关 11 项测试、Runtime Web Search 回归 21 项、定向 ESLint、128 项架构测试与 921 文件架构扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移或业务数据操作；未重启当前应用。下一批独立迁移数据管理命令，并保留 Main 文件选择/落盘的宿主适配职责。

### 续接记录（2026-09-20，第七十四批 Provider CC Switch 预览与导入边界）

- 新增 Protocol `provider-cc-switch-command-contract`，关联数据库预览和选定来源导入 2 项请求/响应；已迁移的类型化命令共 199 项。
- Desktop 新增纯 `provider-cc-switch-payloads` 与 Main `provider-cc-switch-handlers`，Main 组合根删除两组直接注册；Preload 复用共享通道常量。数据库读取、Provider 映射、安全存储、失败补偿和事件持久化仍由 Runtime 拥有，原有数据库路径与来源 ID 校验语义保持。
- Protocol 构建、Desktop 类型检查、相关 11 项测试、Runtime CC Switch 补偿回归 2 项、定向 ESLint、126 项架构测试与 919 文件架构扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移或业务数据操作；未重启当前应用。下一批迁移 Web Search Provider 管理 4 项命令，数据管理随后独立处理。

### 续接记录（2026-09-20，第七十三批 Provider Balance 边界）

- 新增 Protocol `provider-balance-command-contract`，关联只读余额查询请求/响应；已迁移的类型化命令共 197 项。
- Desktop 新增纯 `provider-balance-payloads` 与 Main `provider-balance-handlers`，Main 组合根删除直接注册；Preload 复用共享通道常量。端点支持判断、凭据读取、网络访问、诊断和响应归一化仍由 Runtime 拥有，CC Switch 保持独立职责。
- Protocol 构建、Desktop 类型检查、相关 17 项测试、Runtime Provider 回归 7 项、定向 ESLint、124 项架构测试与 916 文件架构扫描通过。Runtime 测试中的 17374 端口占用来自当前运行中的浏览器扩展宿主，不影响断言；既有全 Desktop lint 阻塞保持不变。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移或业务数据操作；未重启当前应用。下一批独立迁移 CC Switch 预览与导入边界。

### 续接记录（2026-09-20，第七十二批 Provider Discovery 与 Capability Probing 边界）

- 新增 Protocol `provider-discovery-command-contract`，关联目录发现、创建前临时探测、能力探测和能力确认 4 项请求/响应；已迁移的类型化命令共 196 项。
- Desktop 新增纯 `provider-discovery-payloads` 与 Main `provider-discovery-handlers`，Main 组合根删除四组直接注册；临时探测密钥继续经注入的剪贴板端口和统一 8 KiB 校验交接，Renderer payload 不携带明文。发现/能力执行和状态写入仍由 Runtime 拥有，模型管理、余额和 CC Switch 保持独立职责。
- Protocol 构建、Desktop 类型检查、相关 34 项测试、Runtime Provider 回归 7 项、定向 ESLint、122 项架构测试与 913 文件架构扫描通过。Runtime 测试中的 17374 端口占用来自当前运行中的浏览器扩展宿主，不影响断言；既有全 Desktop lint 阻塞保持不变。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移或业务数据操作；未重启当前应用。下一批独立迁移 Provider Balance，CC Switch 继续留后。

### 续接记录（2026-09-20，第七十一批 Provider Model Management 边界）

- 新增 Protocol `provider-model-command-contract`，关联模型新增、优先级排序、元数据更新和删除 4 项请求/响应；已迁移的类型化命令共 192 项。
- Desktop 新增纯 `provider-model-payloads` 与 Main `provider-model-handlers`，Main 组合根删除四组直接注册；Preload 复用共享通道常量。模型持久化和上下文缓存失效仍由 Runtime 拥有，发现、能力探测、余额和 CC Switch 保持独立职责。
- Protocol 构建、Desktop 类型检查、相关 22 项测试、Runtime Provider 生命周期回归 7 项、定向 ESLint、120 项架构测试与 910 文件架构扫描通过。Runtime 测试中的 17374 端口占用来自当前运行中的浏览器扩展宿主，不影响断言。全 Desktop lint 仍受既有 `MarkdownImageGallery.tsx` 条件 Hook 与主题引擎 `@ts-nocheck`/未使用符号共 6 个错误阻塞。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移或业务数据操作；未重启当前应用。下一批独立迁移 Provider Discovery & Capability Probing，余额与 CC Switch 继续留后。

### 续接记录（2026-09-20，第七十批 Provider Credentials 生命周期边界）

- 新增 Protocol `provider-credential-command-contract`，关联凭据新增、移除、清空、查看和更新 5 项请求/响应；已迁移的类型化命令共 188 项。
- Desktop 新增纯 `provider-credential-payloads` 与 Main `provider-credential-handlers`，Main 组合根删除五组直接注册；新增/轮换密钥继续经注入的剪贴板端口和统一 8 KiB 校验交接，查看是唯一显式返回明文的短生命周期 hop。Provider Catalog、模型和发现/探测保持独立职责。
- Protocol 构建、Desktop 类型检查、相关 29 项测试、Runtime Provider/安全存储补偿回归 13 项、定向 ESLint、118 项架构测试与 907 文件架构扫描通过。Runtime 测试中的 17374 端口占用来自当前运行中的浏览器扩展宿主，不影响断言。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移、Runtime 行为或业务数据操作；未重启当前应用。下一批独立迁移 Provider Model Management，发现/探测、余额与 CC Switch 继续留后。

### 续接记录（2026-09-20，第六十九批 Provider Catalog 生命周期边界）

- 新增 Protocol `provider-catalog-command-contract`，关联 Provider 创建、更新、列表、排序和删除 5 项请求/响应；已迁移的类型化命令共 183 项。
- Desktop 新增纯 `provider-catalog-payloads`、共享 `provider-payload-validation` 与 Main `provider-catalog-handlers`，Main 组合根删除五组直接注册；创建/轮换凭据继续通过注入的剪贴板端口交接，凭据、模型和发现/探测保持独立职责。
- Protocol 构建、Desktop 类型检查、相关 27 项测试、Runtime Provider/安全存储补偿回归 12 项、定向 ESLint、116 项架构测试与 904 文件架构扫描通过。Runtime 测试中的 17374 端口占用来自当前运行中的浏览器扩展宿主，不影响断言。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移、Runtime 行为或业务数据操作；未重启当前应用。下一批独立迁移 Provider Credentials 生命周期，模型与发现/探测继续留后。

### 续接记录（2026-09-20，第六十八批执行参与模式边界）

- 新增 Protocol `participation-mode-command-contract`，关联 `task.setParticipationMode` 请求/响应；已迁移的类型化命令共 178 项。
- Desktop 新增纯 `participation-mode-payloads` 与 Main `participation-mode-handlers`，Main 组合根删除直接注册；Preload 复用共享通道常量。Task 目录和执行策略继续保持独立职责。
- Desktop 类型检查、相关 28 项测试、Runtime 参与模式/OCC/事务回归 17 项、定向 ESLint、114 项架构测试与 900 文件架构扫描通过。Runtime 测试中的 17374 端口占用来自当前运行中的浏览器扩展宿主，不影响断言。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移或业务数据操作；未重启当前应用。下一批从 Provider 生命周期中选择一个有限子域继续迁移。

### 续接记录（2026-09-20，第六十七批 Artifact 生命周期边界）

- 新增 Protocol `artifact-command-contract`，关联列表、版本读取、比较、选择、合并、冲突列表和冲突解决 7 项命令；已迁移的类型化命令共 177 项。
- Desktop 新增纯 `artifact-payloads` 与 Main `artifact-handlers`，Main 组合根删除七组直接注册。图片预览通过注入的 `registerImagePreview` 宿主端口完成本地签名，不把 Electron 或具体 registry 带入 Artifact 应用边界。
- Desktop 类型检查、相关 38 项测试、Runtime Artifact 10 项、定向 ESLint、112 项架构测试与 897 文件架构扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移、Runtime 行为或业务数据操作；未重启当前应用。下一批可独立处理 `task.setParticipationMode` 执行参与策略，再转向 Provider 生命周期。

### 续接记录（2026-09-20，第六十六批 Run Graph 与执行控制边界）

- 新增 Protocol `run-control-command-contract`，关联 Graph 查询、pause、resume 和 cancel 4 项命令；已迁移的类型化命令共 170 项。
- 新增纯 `run-control-payloads` 和 Main `run-control-handlers`，接管普通会话 cancel、Graph、编排 pause/resume/cancel 共 5 个 IPC channel；两个 cancel 入口共享 `run.cancel` 线协议，但联合请求/响应显式建模，Runtime 继续按载荷形状区分会话流取消与带 scope/OCC 的编排取消。
- 新增 13 项注册测试、4 项载荷测试、2 项 wiring 测试及编译期正反例；Desktop 相关 33 项、Runtime Run 回归 3 项、Protocol 构建、Desktop 类型检查、定向 lint、110 项架构测试和 894 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移、Runtime 行为或业务数据操作；未重启当前应用。下一批可处理 Artifact 查询、选择、合并与冲突解决 7 项命令。

### 续接记录（2026-09-20，第六十五批 Plan 生命周期边界）

- 新增 Protocol `plan-command-contract`，关联 Plan 草稿、修订、revision 列表和批准 4 项请求/响应；已迁移的类型化命令共 166 项。
- 新增纯 `plan-payloads` 和 Main `plan-handlers`，接管 4 个 IPC channel；Plan 解析从 Mode/Plan/Run/Artifact/Policy/Agent 聚合文件移出，通用复杂度与敏感字段检查抽入 `orchestration-payload-validation`。来源校验 → 连接 → 解析 → 请求顺序和错误文本保持；Run 控制及参与模式未并入。
- 新增 11 项注册测试、4 项载荷测试、2 项 wiring 测试及编译期正反例；Desktop 相关 31 项、Runtime Plan 回归 14 项、Protocol 构建、Desktop 类型检查、定向 lint、108 项架构测试和 891 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移、Runtime 行为或业务数据操作；未重启当前应用。下一批可独立处理 Run Graph 与 pause/resume/cancel 4 项命令。

### 续接记录（2026-09-20，第六十四批 Task 目录生命周期边界）

- 新增 Protocol `task-command-contract`，关联 Task 创建、列表、打开、搜索、归档和取消归档 6 项请求/响应；已迁移的类型化命令共 162 项。
- 新增纯 `task-payloads` 和 Main `task-handlers`，接管 6 个 IPC channel；原 Workspace/Task 混合文件完成拆分，共享通道表供 Preload/Main 复用。来源校验 → 连接 → 解析 → 请求顺序、验收条件边界、树级归档参数和版本围栏保持；`task.setParticipationMode` 未并入目录生命周期。
- 新增 15 项注册测试、4 项载荷测试、2 项 wiring 测试及编译期正反例；Desktop 相关 22 项、Runtime 目录回归 3 项、Protocol 构建、Desktop 类型检查、定向 lint、106 项架构测试和 887 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移、Runtime 行为或业务数据操作；未重启当前应用。下一批可独立处理 Plan 生命周期 4 项命令，执行参与模式继续保持独立。

### 续接记录（2026-09-20，第六十三批 Workspace 生命周期边界）

- 新增 Protocol `workspace-command-contract`，关联 Workspace 创建、文件夹绑定、列表、更新和删除 5 项请求/响应；已迁移的类型化命令共 156 项。
- 新增纯 `workspace-lifecycle-payloads` 和 Main `workspace-handlers`，接管 5 个 IPC channel；Workspace 解析从原 Workspace/Task 混合文件移出，共享通道表供 Preload/Main 复用，更新安装探针也改走 `requestWorkspace`。Task 解析和命令未改。
- 新增 13 项注册测试、5 项载荷测试、2 项 wiring 测试及编译期正反例；Desktop 相关 23 项、Runtime Workspace 回归 3 项、Protocol 构建、Desktop 类型检查、定向 lint、104 项架构测试和 885 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移、Runtime 行为或业务数据操作；未重启当前应用。下一批可独立处理 Task 目录生命周期 6 项命令，执行参与模式保持独立。

### 续接记录（2026-09-20，第六十二批 Prompt Enhancement / Design Generation 边界）

- 新增 Protocol `prompt-design-command-contract`，关联提示词优化、优化取消和设计生成 3 项请求/响应；已迁移的类型化命令共 151 项。
- 新增纯 `prompt-design-payloads` 和 Main `prompt-design-handlers`，接管 3 个 IPC channel；共享通道表供 Preload/Main 复用，Prompt 解析从 Main 移出，Design 继续复用 Protocol 严格解析器。来源校验 → 连接 → 解析 → 请求顺序及按命令超时保持。
- 新增 9 项注册测试、5 项载荷测试、2 项 wiring 测试及编译期正反例；Desktop 相关 17 项、Protocol 回归 5 项、Runtime 管道回归 3 项、Desktop 类型检查、定向 lint、102 项架构测试和 882 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移、Runtime 行为或业务数据操作；未重启当前应用。下一批可独立处理 Workspace 生命周期 5 项命令。

### 续接记录（2026-09-20，第六十一批 Capability Governance 生命周期边界）

- 新增 Protocol `capability-governance-command-contract`，关联工作区能力激活列表/写入、治理列表、发布草稿保存/列表/详情/提交和整理预览/最近报告 9 项请求/响应；已迁移的类型化命令共 148 项。
- 新增 Main `capability-governance-handlers`，接管 9 个 IPC channel，并复用既有纯 `capability-payloads`、共享通道表和来源校验 → 连接 → 解析 → 请求顺序。激活状态、治理规则、草稿持久化和整理报告生成仍由 Runtime 拥有。
- 新增 21 项注册测试、2 项 wiring 测试及编译期正反例；Desktop 相关 28 项、Runtime 治理集成 1 项、Protocol 构建、Desktop 类型检查、定向 lint、100 项架构测试和 879 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移、Runtime 行为或业务数据操作；未重启当前应用。下一批可独立处理 Prompt Enhancement / Design Generation 注册边界。

### 续接记录（2026-09-20，第六十批 Bot Channel 生命周期边界）

- 新增 Protocol `bot-channel-command-contract`，关联配置读取、保存、连接测试和微信二维码请求/检查 5 项请求/响应；已迁移的类型化命令共 139 项。
- 新增 Desktop `bot-channel-payloads` 和 Main `bot-channel-handlers`，接管 5 个 IPC channel；平台分支、凭据字段修剪、域/渲染模式、字段长度、二维码校验和来源校验 → 连接 → 解析 → 请求顺序保持。对应解析器从 `agent-payloads` 移出，既有载荷测试导入同步指向 Agent、Skill 和 Bot 各自边界。
- 新增 13 项注册测试、2 项 wiring 测试及编译期正反例；Desktop 相关 22 项、Runtime Bot 回归 21 项、Protocol 构建、Desktop 类型检查、定向 lint、98 项架构测试和 877 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移、Runtime 行为或业务数据操作；未重启当前应用。下一批可独立处理 Capability Governance 生命周期边界。

### 续接记录（2026-09-20，第五十九批 MCP 工具策略与执行边界）

- 新增 Protocol `mcp-tool-command-contract`，关联策略预检、工具软请求、进程探测、实际调用和目录刷新 5 项请求/响应；已迁移的类型化命令共 134 项。
- 新增 Desktop `mcp-tool-payloads` 和 Main `mcp-tool-handlers`，接管 5 个 IPC channel；对应解析器从 `agent-payloads` 移出，作用域、审批参数、输出预算、目录上限和来源校验 → 连接 → 解析 → 请求顺序保持。实际调用和目录刷新继续使用 RuntimeClient 的 130 秒命令超时策略；Runtime 授权、审批、进程/HTTP 执行和目录持久化不变。
- 新增 13 项注册测试、3 项 wiring 测试及编译期正反例；Desktop 相关 17 项、Runtime MCP 回归 11 项、Protocol 构建、Desktop 类型检查、定向 lint、96 项架构测试和 874 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移、Runtime 行为或业务数据操作；未重启当前应用。下一批可独立处理 Bot Channel 生命周期边界。

### 续接记录（2026-09-20，第五十八批 MCP 注册表生命周期边界）

- 新增 Protocol `mcp-registry-command-contract`，关联本地注册、远程注册、列表、启停和删除 5 项请求/响应；已迁移的类型化命令共 129 项。
- 新增 Desktop `mcp-registry-payloads` 和 Main `mcp-registry-handlers`，接管 5 个 IPC channel；对应解析器从 `agent-payloads` 移出，URL、凭据别名、工具摘要、字段校验和来源校验 → 连接 → 解析 → 请求顺序保持。远程注册继续使用 RuntimeClient 的 130 秒命令超时策略；策略探测、工具请求/调用和刷新未并入本批。
- 新增 13 项注册测试、2 项 wiring 测试及编译期正反例；Desktop 相关 16 项、Runtime MCP 回归 15 项、Protocol 构建、Desktop 类型检查、定向 lint、94 项架构测试和 871 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移、Runtime 行为或业务数据操作；未重启当前应用。下一批可独立处理 MCP 工具执行与策略边界。

### 续接记录（2026-09-20，第五十七批已安装 Skill 生命周期注册边界）

- 新增 Protocol `skill-command-contract`，关联文本导入、远程导入、列表、详情、删除和启用状态 6 项请求/响应；已迁移的类型化命令共 124 项。
- 新增 Desktop `skill-payloads` 和 Main `skill-handlers`，接管 6 个 IPC channel；对应解析器从 `agent-payloads` 移出，远程导入 30 秒超时、URL/来源字段校验、列表去重和来源校验 → 连接 → 解析 → 请求顺序保持。不可变版本、内容寻址、权限重审批、引用阻止删除和工作区激活仍由 Runtime 拥有，MCP 未并入该边界。
- 新增 15 项注册测试、2 项 wiring 测试及编译期正反例；Desktop 相关 18 项、Runtime Skill 回归 5 项、Protocol 构建、Desktop 类型检查、定向 lint、92 项架构测试和 868 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移、Runtime 行为或业务数据操作；未重启当前应用。下一批可独立处理 MCP 注册表生命周期边界。

### 续接记录（2026-09-20，第五十六批 Skill Market 注册边界）

- 新增 Protocol `skill-market-command-contract`，关联 Skill 市场列表和安装 2 项请求/响应；已迁移的类型化命令共 118 项。
- 新增 Desktop `skill-market-payloads` 和 Main `skill-market-handlers`，接管 2 个 IPC channel；安装解析器从 `team-payloads` 移出，ID 修剪、空列表载荷和来源校验 → 连接 → 解析 → 请求顺序保持。内置市场目录、完整包物化、冲突处理、导入和事件发布仍由 Runtime 拥有，已安装 Skill 管理未并入该边界。
- 新增 6 项注册测试、2 项 wiring 测试及编译期正反例；Desktop 相关 9 项、Runtime 市场回归 2 项、Protocol 构建、Desktop 类型检查、定向 lint、90 项架构测试和 865 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移、Runtime 行为或业务数据操作；未重启当前应用。下一批可独立处理已安装 Skill 生命周期注册边界。

### 续接记录（2026-09-20，第五十五批 Skill Local 注册边界）

- 新增 Protocol `skill-local-command-contract`，关联本地 Skill 扫描、检查和导入 3 项请求/响应；已迁移的类型化命令共 116 项。
- 新增 Desktop `skill-local-payloads` 和 Main `skill-local-handlers`，接管 3 个 IPC channel；对应解析器从 `team-payloads` 移出，空扫描载荷、路径修剪、全局/工作区 scope、覆盖参数和来源校验 → 连接 → 解析 → 请求顺序保持。目录发现、ZIP 解包、安装、缓存/watch 和事件发布仍由 Runtime 拥有，Skill Market 未并入该边界。
- 新增 9 项注册测试、2 项 wiring 测试及编译期正反例；Desktop 相关 12 项、Runtime 本地 Skill 回归 11 项、Protocol 构建、Desktop 类型检查、定向 lint、88 项架构测试和 862 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移、Runtime 行为或业务数据操作；未重启当前应用。下一批可独立处理 Skill Market 注册边界。

### 续接记录（2026-09-20，第五十四批 Goal 生命周期注册边界）

- 新增 Protocol `goal-command-contract`，关联目标设置、读取、清除、暂停和恢复 5 项请求/响应，并补齐 `GoalPauseResponse`；已迁移的类型化命令共 113 项。
- 新增 Desktop `goal-payloads` 和 Main `goal-handlers`，接管 5 个 IPC channel；有效载荷归一化和来源校验 → 连接 → 解析 → 请求顺序保持，无效载荷在 Desktop 边界终止。目标轮次、Token 预算、连续阻塞判定和自动续跑仍由 Runtime 拥有，Skill Local 未并入该边界。
- 新增 10 项注册测试、2 项 wiring 测试及编译期正反例；Desktop 相关 13 项、Runtime Goal 回归 9 项、Protocol 构建、Desktop 类型检查、定向 lint、86 项架构测试和 859 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移、Runtime 行为或业务数据操作；未重启当前应用。下一批可独立处理 Skill Local 注册边界。

### 续接记录（2026-09-20，第五十三批 Activity Center 注册边界）

- 新增 Protocol `activity-command-contract`，关联运行列表、外部事件列表和重试锚点解析 3 项请求/响应；已迁移的类型化命令共 108 项。
- 新增 Desktop Main `activity-handlers`，接管 3 个 IPC channel，并复用既有过滤 parser 与来源校验 → 连接 → 解析 → 请求顺序；Main 入口删除直接注册。活动投影、分页、敏感 lease 隔离和重试资格判定仍由 Runtime 拥有，Goal 生命周期未并入该边界。
- 新增 7 项注册测试、2 项 wiring 测试及编译期正反例；Desktop 相关 10 项、Runtime Activity 集成 15 项、Protocol 构建、Desktop 类型检查、定向 lint、84 项架构测试和 856 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移、Runtime 行为或业务数据操作；未重启当前应用。下一批可独立处理 Goal 注册边界。

### 续接记录（2026-09-20，第五十二批 Scheduled Task 注册边界）

- 新增 Protocol `scheduled-task-command-contract`，关联任务创建、列表、更新、删除、立即触发和历史查询 6 项请求/响应；补齐创建、更新、删除的命名响应类型，已迁移的类型化命令共 105 项。
- 新增 Desktop Main `scheduled-task-handlers`，接管 6 个 IPC channel，并复用既有严格 payload parser 与来源校验 → 连接 → 解析 → 请求顺序；Main 入口删除直接注册。规则计算、持久化、触发执行和历史记录仍由 Runtime 拥有，Activity Center 未并入该边界。
- 新增 11 项注册测试、2 项 wiring 测试及编译期正反例；Desktop 相关 14 项、Runtime 调度回归 52 项、Protocol 构建、Desktop 类型检查、定向 lint、82 项架构测试和 854 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移、Runtime 行为或业务数据操作；未重启当前应用。下一批可独立处理 Activity Center 注册边界。

### 续接记录（2026-09-20，第五十一批 Conversation Ask 注册边界）

- 扩展 Protocol `conversation-command-contract`，补齐问询回答、取消和待处理查询 3 项请求/响应关联；已迁移的类型化命令共 99 项。
- 新增 Desktop Main `conversation-ask-handlers`，接管 Ask 生命周期 3 个 IPC channel，并复用既有严格 payload parser 与来源校验 → 连接 → 解析 → 请求顺序；Main 入口删除直接注册。待处理问询状态、回答结算和持久事件仍由 Runtime 拥有，Scheduled Task 未并入该边界。
- 新增 8 项注册测试、2 项 wiring 测试及编译期正反例；Desktop 相关 54 项、Protocol 构建、Desktop 类型检查、定向 lint、80 项架构测试和 852 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移、Runtime 行为或业务数据操作；未重启当前应用。下一批可独立处理 Scheduled Task 注册边界。

### 续接记录（2026-09-20，第五十批 Conversation Plan 注册边界）

- 扩展 Protocol `conversation-command-contract`，补齐计划提交、读取、批准、修订和取消 5 项请求/响应关联；已迁移的类型化命令共 96 项。
- 新增 Desktop Main `conversation-plan-handlers`，接管 Plan 生命周期 5 个 IPC channel，并复用既有严格 payload parser 与来源校验 → 连接 → 解析 → 请求顺序；Main 入口删除直接注册。不可变 revision、批准前置条件、Run/Graph 创建与原子持久化仍由 Runtime 拥有，Ask 未并入该边界。
- 新增 10 项注册测试、2 项 wiring 测试及编译期正反例；Desktop 相关 65 项、Runtime Plan 集成 14 项、Protocol 构建、Desktop 类型检查、定向 lint、80 项架构测试和 851 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移、Runtime 行为或业务数据操作；未重启当前应用。下一批可独立处理 Conversation Ask 注册边界。

### 续接记录（2026-09-20，第四十九批 Conversation 路由注册边界）

- 扩展 Protocol `conversation-command-contract`，补齐执行模式、交互模式、上下文窗口覆盖、轨道升级和目标重绑 5 项请求/响应关联；已迁移的类型化命令共 91 项。
- 新增 Desktop Main `conversation-routing-handlers`，接管 5 个 IPC channel，并复用既有严格 payload parser 与来源校验 → 连接 → 解析 → 请求顺序；Main 入口删除直接注册。路由兼容性、轨道切换、模型/Agent/Team 目标验证和状态持久化仍由 Runtime 拥有，Plan 与 Ask 未并入该边界。
- 新增 10 项注册测试、2 项 wiring 测试及编译期正反例；Desktop 相关 56 项、Runtime 路由/上下文/Goal 回归 29 项、Protocol 构建、Desktop 类型检查、定向 lint、80 项架构测试和 850 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移、Runtime 行为或业务数据操作；未重启当前应用。下一批可独立处理 Conversation Plan 注册边界。

### 续接记录（2026-09-19，第四十八批 Conversation 目录注册边界）

- 扩展 Protocol `conversation-command-contract`，补齐 `conversation.list/create/rename/setPinned/setArchived/delete` 6 项请求/响应关联；已迁移的类型化命令共 86 项。
- 新增 Desktop Main `conversation-management-handlers`，接管对话目录生命周期 6 个 IPC channel，并复用既有严格 payload parser 与来源校验 → 连接 → 解析 → 请求顺序；Main 入口删除直接注册。托盘最近会话查询同步改用 `requestConversation`，目录持久化、引用约束和事件语义仍由 Runtime 拥有。
- 新增 11 项注册测试、2 项 wiring 测试及编译期正反例；Desktop 相关 57 项、Runtime Team/Conversation 集成 10 项、Protocol 构建、Desktop 类型检查、定向 lint、80 项架构测试和 849 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移、Runtime 行为或业务数据操作；未重启当前应用。下一批可独立处理 Conversation 路由与模式设置。

### 续接记录（2026-09-19，第四十七批 Team 注册边界）

- 新增 Protocol `team-command-contract`，关联团队列表、创建、更新、删除、启动运行和设置运行状态 6 项请求/响应；`RuntimePipeClient.requestTeam` 成为 Team 目录与运行控制域的类型化入口，已迁移的类型化命令共 80 项。
- 新增 Desktop Main `team-handlers`，接管 6 个 IPC channel，并复用既有严格 payload parser 与来源校验 → 连接 → 解析 → 请求顺序；Main 入口删除直接注册。成员依赖、协调者、Team Run 创建与状态机仍由 Runtime 拥有，Conversation 未并入该边界。
- 新增 11 项注册测试、2 项 wiring 测试及编译期正反例；Desktop 相关 57 项、Runtime Team/Conversation 集成 10 项、Protocol 构建、Desktop 类型检查、定向 lint、80 项架构测试和 848 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移、Runtime 行为或业务数据操作；未重启当前应用。下一批可继续拆分剩余 Conversation 管理注册。

### 续接记录（2026-09-19，第四十六批 Global Agent 注册边界）

- 新增 Protocol `global-agent-command-contract`，关联列表、创建、更新、删除、工作区激活列表和激活写入 6 项请求/响应；`RuntimePipeClient.requestGlobalAgent` 成为可变全局智能体域的类型化入口，已迁移的类型化命令共 74 项。
- 新增 Desktop Main `global-agent-handlers`，接管 6 个 IPC channel，并复用既有严格 payload parser 与来源校验 → 连接 → 解析 → 请求顺序；Main 入口删除直接注册。Agent 定义、引用约束、工作区激活持久化和事件语义仍由 Runtime 拥有，Team 未并入该边界。
- 补齐 `DeleteGlobalAgentResponse`，将 Runtime 已存在的“有对话引用时软归档”结果贯穿 Preload 与 Renderer，页面不再维护临时类型断言。Desktop 相关 73 项、Runtime Global Agent/Team 集成 11 项、Protocol 构建、Desktop 类型检查、定向 lint、78 项架构测试和 846 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移、Runtime 行为或业务数据操作；未重启当前应用。下一批可独立处理 Team 注册边界。

### 续接记录（2026-09-19，第四十五批 Agent 创建与版本注册边界）

- 扩展 Protocol `agent-command-contract`，补齐 `agent.create`、`agent.listVersions` 和 `agent.createVersion` 的请求/响应关联；`RuntimePipeClient.requestAgent` 现覆盖 Agent 读取、绑定、创建与版本管理共 6 项命令，已迁移的类型化命令共 68 项。
- Desktop Main `agent-handlers` 接管剩余 3 个 Agent IPC channel，统一复用严格 payload parser 和来源校验 → 连接 → 解析 → 请求顺序；Main 入口删除对应直接注册。Agent 定义验证、不可变版本持久化、乐观并发和事件语义仍由 Runtime 拥有，Global Agent 与 Team 未并入该边界。
- Agent 注册、wiring、payload 与编译期合同相关 Desktop 33 项、Runtime Agent 命令 2 项通过；Protocol 构建、Desktop 类型检查、定向 lint、76 项架构测试和 844 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移、Runtime 行为或业务数据操作；未重启当前应用。下一批可独立处理 Global Agent 或 Team 注册边界。

### 续接记录（2026-09-19，第四十四批 Agent Catalog 注册边界）

- 新增 Protocol `agent-command-contract`，关联 Agent 获取、绑定更新和列表 3 项请求/响应类型；`RuntimePipeClient.requestAgent` 成为 Agent 目录域的类型化入口，已迁移的类型化命令共 65 项。
- 新增 Desktop Main `agent-handlers`，接管 3 个 IPC channel。模块复用既有 Agent/Orchestration payload parser，并通过宿主端口获得注册、来源校验、连接和传输；Main 入口删除直接注册并只负责装配。默认 Agent、模型/凭据/Skill/MCP 绑定验证和版本存储保持 Runtime 所有权。
- 新增 7 项注册测试、2 项 wiring 测试及编译期正反例；Desktop payload/注册相关 29 项、Runtime Agent 命令 2 项通过。Protocol/Desktop 类型检查、定向 lint、76 项架构测试和 844 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移、Runtime 行为或业务数据操作；未重启当前应用。下一批再处理 Agent 创建/版本管理等剩余 Main 传输边界。

### 续接记录（2026-09-19，第四十三批 Usage 注册边界）

- 新增 Protocol `usage-command-contract`，关联 `usage.summary` 的过滤请求与聚合响应；`RuntimePipeClient.requestUsage` 成为使用统计域的类型化入口，已迁移的类型化命令共 62 项。
- 新增 Desktop Main `usage-handlers`，接管统计查询 IPC。模块复用既有严格 payload parser，并通过宿主端口获得注册、来源校验、连接和传输；Main 入口删除直接注册并只负责装配。300 秒首建缓存超时继续由 RuntimeClient 命令策略提供，统计缓存与聚合保持 Runtime 所有权。
- 新增 4 项注册测试、2 项 wiring 测试及编译期正反例；Desktop payload/超时/注册相关 21 项、Runtime Usage 回归 3 项通过。Protocol/Desktop 类型检查、定向 lint、74 项架构测试和 842 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移、Runtime 行为或业务数据操作；未重启当前应用。下一批继续横向迁移剩余 Main 传输边界。

### 续接记录（2026-09-19，第四十二批 Policy 注册边界）

- 新增 Protocol `policy-command-contract`，关联策略保存和列表 2 项请求/响应类型；`RuntimePipeClient.requestPolicy` 成为作用域策略域的类型化入口，已迁移的类型化命令共 61 项。
- 新增 Desktop Main `policy-handlers`，接管 2 个 IPC channel。模块复用既有严格 payload parser，并通过宿主端口获得注册、来源校验、连接和传输；Main 入口删除直接注册并只负责装配。策略作用域验证、版本持久化、事件事务和最终策略解析保持 Runtime 所有权。
- 新增 6 项注册测试、2 项 wiring 测试及编译期正反例；Desktop payload/注册相关 22 项、Runtime Policy 命令 13 项通过。Protocol/Desktop 类型检查、定向 lint、72 项架构测试和 840 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移、Runtime 行为或业务数据操作；未重启当前应用。下一批继续横向迁移剩余 Main 传输边界。

### 续接记录（2026-09-19，第四十一批 Settings 注册边界）

- 新增 Protocol `settings-command-contract`，关联配置读取和写入 2 项请求/响应类型；`RuntimePipeClient.requestSettings` 成为应用配置域的类型化入口，已迁移的类型化命令共 59 项。
- 新增 Desktop Main `settings-handlers`，接管 2 个 IPC channel。模块复用既有严格 payload parser，并通过宿主端口获得注册、来源校验、连接和传输；Main 入口删除直接注册并只负责装配。配置存储、时间戳和开放网关配置后的后台重绑定保持 Runtime 所有权。
- 新增 6 项注册测试、2 项 wiring 测试及编译期正反例；Desktop 定向 9 项通过。Protocol/Desktop 类型检查、定向 lint、70 项架构测试和 838 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移、Runtime 行为或业务数据操作；未重启当前应用。下一批继续横向迁移 Policy 等剩余 Main 传输边界。

### 续接记录（2026-09-19，第四十批 Kernel Discovery 注册边界）

- 新增 Protocol `kernel-command-contract`，关联 `kernel.detect` 的空请求与检测响应；`RuntimePipeClient.requestKernel` 成为内核发现域的类型化入口，已迁移的类型化命令共 57 项。
- 新增 Desktop Main `kernel-handlers`，接管只读检测 IPC。模块通过宿主端口获得注册、来源校验、连接和传输；Main 入口删除直接注册并只负责装配。内核注册表扫描保持 Runtime 所有权，桌面安装、更新和运行生命周期中的 `kernel.recycle` 均保持原边界。
- 新增 3 项注册测试、2 项 wiring 测试及编译期正反例；Desktop 定向 6 项通过。Protocol/Desktop 类型检查、定向 lint、68 项架构测试和 836 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移、Runtime 行为或业务数据操作；未重启当前应用。下一批继续横向迁移剩余 Main 传输边界。

### 续接记录（2026-09-19，第三十九批 Open Gateway 注册边界）

- 新增 Protocol `gateway-command-contract`，关联 Gateway 状态、日志查询和清空日志 3 项请求/响应类型；`RuntimePipeClient.requestGateway` 成为开放网关域的类型化入口，已迁移的类型化命令共 56 项。
- 新增 Desktop Main `gateway-handlers`，接管 3 个 IPC channel。模块通过宿主端口获得注册、来源校验、连接和传输；Main 入口删除三段直接注册并只负责装配。日志查询继续将宽松输入交给 Runtime 归一化，OpenGatewayManager、状态聚合与日志环形缓冲保持 Runtime 所有权。
- 新增 7 项注册测试、6 项 wiring 测试及编译期正反例；Desktop 定向 14 项、Runtime Gateway 32 项通过。Protocol/Desktop 类型检查、定向 lint、66 项架构测试和 834 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移或业务数据操作；未重启当前应用。下一批继续横向迁移剩余 Main 传输边界。

### 续接记录（2026-09-19，第三十八批 Diagnostics 注册边界）

- 新增 Protocol `diagnostics-command-contract`，关联 `diagnostics.list` 的请求/响应类型；`RuntimePipeClient.requestDiagnostics` 成为诊断域的类型化入口，已迁移的类型化命令共 53 项。
- 新增 Desktop Main `diagnostics-handlers`，接管诊断列表 IPC。页面查询通过独立注册模块装配，桌面诊断导出中的 Runtime 查询也改用同一类型化入口；导出文件组装、脱敏、崩溃记录和保存流程保持原位。
- 新增 4 项注册测试、2 项 wiring 测试及编译期正反例；Desktop 诊断页面/导出相关 18 项、Runtime Memory/Diagnostics 回归 10 项通过。Protocol/Desktop 类型检查、定向 lint、64 项架构测试和 832 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移或业务数据操作；未重启当前应用。下一批继续迁移剩余 Main 传输边界。

### 续接记录（2026-09-19，第三十七批 Context Packet 注册边界）

- 新增 Protocol `context-packet-command-contract`，把 Context Packet 的 peek 和 amend 2 项命令分别关联到请求/响应类型；`RuntimePipeClient.requestContextPacket` 成为上下文包域的类型化入口，已迁移的类型化命令共 52 项。
- 新增 Desktop Main `context-packet-handlers`，接管 2 个 IPC channel。模块只依赖既有严格 payload parser 与类型契约，通过宿主端口获得注册、来源校验、连接和传输；Main 入口删除两段直接注册并只负责装配。上下文包生成、线程范围覆盖和受保护来源策略保持 Runtime 所有权。
- 新增 6 项注册测试、3 项 wiring/合同测试及编译期正反例；Context Packet 注册相关 Desktop 10 项通过。Protocol/Desktop 类型检查、定向 lint、62 项架构测试和 830 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移或业务数据操作；未重启当前应用。下一批横向迁移 Diagnostics 或其他剩余 Main 传输边界。

### 续接记录（2026-09-19，第三十六批 Memory 注册边界）

- 新增 Protocol `memory-command-contract`，把 Memory 的列表、决定和回滚 3 项命令分别关联到请求/响应类型；`RuntimePipeClient.requestMemory` 成为 Memory 域的类型化入口，已迁移的类型化命令共 50 项。
- 新增 Desktop Main `memory-handlers`，接管 3 个 IPC channel。模块只依赖既有严格 payload parser 与类型契约，通过宿主端口获得注册、来源校验、连接和传输；Main 入口删除三段直接注册并只负责装配。Memory 策略、持久化和回滚语义保持 Runtime 所有权。
- 新增 7 项注册测试、4 项 wiring/合同测试及编译期正反例；Memory payload/注册相关 Desktop 13 项通过。Protocol/Desktop 类型检查、定向 lint、60 项架构测试和 828 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移或业务数据操作；未重启当前应用。下一批横向迁移 Context Packet 等剩余 Main 传输边界。

### 续接记录（2026-09-19，第三十五批 Approval Center 注册边界）

- 新增 Protocol `approval-command-contract`，把 Approval Center 的列表、评估、入队和决定 4 项命令分别关联到请求/响应类型；`RuntimePipeClient.requestApproval` 成为审批域的类型化入口，已迁移的类型化命令共 47 项。
- 新增 Desktop Main `approval-handlers`，接管 4 个 IPC channel。模块只依赖既有严格 payload parser 与类型契约，通过宿主端口获得注册、来源校验、连接和传输；Main 入口删除四段直接注册并只负责装配。审批策略、持久化事务和状态机保持 Runtime 所有权。
- 新增 8 项注册测试、5 项 wiring/合同测试及编译期正反例；Approval payload/注册相关 Desktop 27 项、Runtime Approval Center/恢复回归 19 项通过。Protocol/Desktop 类型检查、定向 lint、58 项架构测试和 826 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移或业务数据操作；未重启当前应用。下一批横向迁移 Memory 或 Context Packet 等剩余 Main 传输边界。

### 续接记录（2026-09-19，第三十四批 Browser Extension 注册边界）

- 新增 Protocol `browser-extension-command-contract`，把状态、重启、重置配对和打开扩展目录 4 项命令分别关联到空请求与响应类型；扩展连接状态线协议由 Protocol 提供，Desktop 展示合同改为复用该类型。`RuntimePipeClient.requestBrowserExtension` 成为扩展域的类型化入口，已迁移的类型化命令共 43 项。
- 新增 Desktop Main `browser-extension-handlers`，接管 4 个 IPC channel。模块通过宿主端口获得注册、来源校验、连接和传输；Main 入口删除四段直接注册并只负责装配。保留来源校验 → 连接 → 请求顺序，Runtime 扩展宿主、配对文件、WebSocket 与 Renderer 归一化逻辑保持原边界。
- 新增 7 项注册测试、5 项 wiring/合同测试及编译期正反例；Desktop 扩展相关 58 项、Runtime 扩展集成 5 项通过。Protocol/Desktop 类型检查、定向 lint、56 项架构测试和 824 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移或业务数据操作；未重启当前应用。下一批横向迁移 Approval Queue 等剩余 Main 传输边界。

### 续接记录（2026-09-19，第三十三批 Desktop Waiting Commands 注册边界）

- 新增 Protocol `desktop-command-contract`，把等待命令列表、继续和取消 3 项命令分别关联到请求/响应类型；`RuntimePipeClient.requestDesktopCommand` 成为 Desktop Command 域的类型化入口。至此已迁移的类型化命令共 39 项。
- 新增 Desktop Main `desktop-command-handlers`，接管 3 个 IPC channel。模块只依赖严格 payload parser 与类型契约，通过宿主端口获得注册、来源校验、连接和传输；Main 入口删除三段直接注册并只负责装配。保留来源校验 → 连接 → 解析 → 请求顺序，以及 `expectedUpdatedAt` 的乐观并发保护。
- 新增 7 项注册测试和 Desktop Command 编译期正反例；Desktop 相关 26 项、Runtime 等待命令集成 13 项通过。Protocol/Desktop 类型检查、定向 lint、54 项架构测试和 822 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移或业务数据操作；未重启当前应用。下一批横向迁移 Browser Extension 等剩余 Main 传输边界。

### 续接记录（2026-09-19，第三十二批 Browser Handoff 注册边界）

- 新增 Protocol browser-handoff-command-contract，把等待列表、继续和取消 3 项命令分别关联到请求/响应类型；RuntimePipeClient.requestBrowserHandoff 成为 Handoff 域的类型化入口，保留 revision 与 lease disposition 契约。
- 新增 Desktop Main browser-handoff-handlers，接管 3 个 IPC channel。模块只依赖 Handoff payload parser 与类型契约，通过宿主端口获得注册、来源校验、连接和传输；Main 入口删除三段直接注册并只负责装配。保留来源校验 → 连接 → 解析 → 请求顺序。
- 新增 7 项注册测试、3 项 payload 测试和 Handoff 编译期正反例；旧 wiring 测试同步到新注册边界。Desktop Handoff/BrowserStage 联合回归 80 项、Runtime Handoff 集成 4 项通过。Protocol/Desktop 类型检查、定向 lint、52 项架构测试和 820 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移或业务数据操作；未重启当前应用。下一批横向迁移 Desktop Waiting Commands 等剩余 Main 传输边界。

### 续接记录（2026-09-19，第三十一批 Browser Workflow 注册边界）

- 新增 Protocol `browser-workflow-command-contract`，把列表、详情、创建草稿、创建修订草稿、提交、审查、执行和批准执行 8 项命令分别关联到请求/响应类型；`RuntimePipeClient.requestBrowserWorkflow` 成为 Workflow 域的类型化入口，Profile、Recording 与 Workflow 保持独立合同。
- 新增 Desktop Main `browser-workflow-handlers`，接管 8 个 IPC channel。模块只依赖 Workflow payload parser 与类型契约，通过宿主端口获得注册、来源校验、连接和传输；Main 入口删除八段直接注册并只负责装配。保留来源校验 → 连接 → 解析 → 请求顺序，以及 execute/approveAndExecute 的既有长超时策略。
- 新增 12 项注册测试和 Workflow 编译期正反例；wiring 测试补齐此前遗漏的 execute/approveAndExecute。BrowserStage、注册、payload、wiring、timeout 与 RuntimeClient 合同共 84 项相关回归通过。Protocol/Desktop 类型检查、定向 lint、50 项架构测试和 818 文件扫描通过。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移或业务数据操作；未重启当前应用。下一批横向迁移 Browser Handoff 等剩余 Main 传输边界。

### 续接记录（2026-09-19，第三十批 Browser Recording 注册边界）

- 新增 Protocol `browser-recording-command-contract`，把录制列表、详情、开始和停止 4 项命令分别关联到请求/响应类型；`RuntimePipeClient.requestBrowserRecording` 成为录制域的类型化入口，Profile 与 Recording 不共用宽泛的 Browser 合同。
- 新增 Desktop Main `browser-recording-handlers`，接管 4 个 IPC channel。模块只依赖 Recording payload parser 与类型契约，通过宿主端口获得注册、来源校验、连接和传输；Main 入口删除四段直接注册并只负责装配。保留来源校验 → 连接 → 解析 → 请求顺序，以及 start/stop 的既有 30 秒超时策略。
- 新增 8 项注册测试和 Recording 编译期正反例；BrowserStage、注册、payload、wiring、timeout 与 RuntimeClient 合同共 73 项相关回归通过。Protocol/Desktop 类型检查、定向 lint、48 项架构测试和 816 文件扫描通过；门禁阻止新模块依赖 Electron/RuntimeClient/Storage，也阻止 4 项命令回退到无类型传输。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移或业务数据操作；未重启当前应用。下一批按独立边界迁移 Browser Workflow，避免把 Profile、Recording 和 Workflow 合并为通用 Browser 注册层。

### 续接记录（2026-09-19，第二十九批 Browser Profile 注册边界）

- 新增 Protocol `browser-profile-command-contract`，把 Profile 列表、创建、重命名、删除、站点会话列表和清理 6 项命令分别关联到请求/响应类型；`RuntimePipeClient.requestBrowserProfile` 成为该域的类型化入口，原通用 `request` 继续服务尚未迁移的命令。
- 新增 Desktop Main `browser-profile-handlers`，接管 6 个 IPC channel。模块只依赖 Profile payload parser 与类型契约，通过宿主端口获得注册、来源校验、连接和传输；Main 入口删除解析器直连并只负责装配。保留来源校验 → 连接 → 解析 → 请求顺序，以及 listSiteSessions、clearSiteSession、delete 的现有 30 秒超时策略。
- 新增 10 项注册测试和 Profile 编译期正反例；Profile 注册、payload、timeout、RuntimeClient 合同及 BrowserStage 共 63 项相关回归通过。Protocol/Desktop 类型检查、定向 lint、46 项架构测试和 814 文件扫描通过；门禁阻止新模块依赖 Electron/RuntimeClient/Storage，也阻止 6 项命令回退到无类型传输。
- 13 包整仓构建通过，Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。本批无依赖、迁移或业务数据操作；未重启当前应用。下一批按相同边界迁移 Browser Recording 的 4 项注册与类型合同。

### 续接记录（2026-09-19，第二十八批 Composer 共享展示组件）

- `ComposerModeBanner` 与 `ComposerTaskPanel` 从 Desktop Shell 迁入 `@sync-think/ui-kit`，与上批 `NewMaxComposerFrame` 形成 Composer 展示簇。共享实现只拥有 Plan/Goal 展示、局部按钮回调、任务展开/收起和按 scope 的 dismiss 状态，不接触发送、Run、持久化或宿主 API。
- 两个组件使用 `ComposerGoalStatus` / `ComposerTaskProjection` 窄展示 DTO；现有 Protocol `GoalStatus` 和 Desktop `TodoProjection` 通过结构类型直接兼容，没有把 Protocol 或 Desktop 投影模块反向带入 UI 包。Desktop 同名路径保留兼容重导出，Website 直接从 `ui-kit` 导入，过渡 `website-demo-surface` 再减少两项。
- 新增共享包 8 项行为测试，架构门禁由单组件扩展为三组件统一约束。`ui-kit` 24 文件 245 项、Desktop 定向 4 文件 40 项、Website 19 项回归通过；三包类型检查、定向 lint、44 项架构测试和 812 文件扫描通过。
- Website 构建约 1,492 KiB；13 包整仓构建通过，Desktop initial/total JS 为 2,100,451 / 2,975,222 字节，预算未调整。本批无新依赖、迁移或业务数据操作；未重启当前应用，因此运行窗口仍使用上一批启动产物。

### 续接记录（2026-09-19，第二十七批首个共享 UI 组件簇）

- `NewMaxComposerFrame` 及 Popover/Banner 动效状态从 Desktop Shell 迁入 `@sync-think/ui-kit`。组件继续只拥有布局、插槽与挂载保留，不接管发送、队列、Run 或官网演示状态；CSS 类名、DOM、150/220/240ms 时长和 reduced-motion 行为保持。
- Desktop 原路径缩为 `ui-kit` 兼容重导出，现有 ChatView、ShellApp 与菜单无需同步改路径；`website-demo-surface` 不再转发该组件，Website 两个演示入口直接声明并消费共享包。Website 新增显式 workspace 依赖，锁文件未改变第三方版本。
- 新增共享包 4 项动效测试和 1 项架构规则测试；`ui-kit` 22 文件 237 项、Desktop 4 文件 29 项、Website 19 项自动化回归通过（浏览器套件按既有环境变量跳过），三包类型检查及定向 lint 通过。42 项架构测试与 810 文件扫描通过。
- Website 构建约 1,492 KiB；13 包整仓构建通过，Desktop initial/total JS 为 2,100,455 / 2,975,226 字节，预算未调整。本批无数据库迁移、未操作业务库、未重启应用。下一批可选择第二个无宿主副作用的展示组件簇；Desktop 展示接口及源码构建输入仍需渐进收缩。

### 续接记录（2026-09-19，第二十六批内置浏览器回执传输边界）

- 新增 Runtime `renderer-browser-command-bridge`，拥有内置 WebView 命令等待者登记、一次结算、未知/重复回执拒绝和停机批量取消。Runtime 继续构造/发布瞬时 `browser.command_requested` 事件及协议响应帧；桥不持久化浏览器参数，也移除了等待 Map 中从未读取的 Run/Thread/Tool 元数据。
- 新增 Desktop Main `conversation-browser-handlers`，接管 `conversation.submitBrowserResult` 的来源校验、连接、96,000 字符结果/2,000 字符错误上限解析和类型化请求。`ConversationCommandContract` 从 14 项扩展到 15 项。
- 保留“先登记等待者再发布事件”、Worker 原有 1–120 秒超时、成功/失败字段透传、首次回执消费、未知或重复回执 `accepted: false`，以及停机时中文取消错误。Browser Controller、Worker 动作、Profile/Recording/Workflow RPC 未迁移。
- 新增 8 项桥与 Main 注册测试；Runtime 浏览器链路 21 项、Desktop Main 注册 59 项，共 80 项回归通过。两侧类型检查、定向 ESLint、41 项架构测试、809 文件扫描和整仓 13 包构建通过；Desktop initial/total JS 保持 2,098,962 / 2,973,733 字节。
- 本批未新增依赖或迁移、未操作业务库、未重启应用。下一批横向推进 Website 共享 UI 边界；其余 Browser RPC、其他 Main 注册与兼容重导出继续分批。

### 续接记录（2026-09-19，第二十五批 Runtime 首发模型与凭据装配）

- 新增 `initial-run-model-binding`，统一首发 Run 的显式/Agent 默认模型解析、Provider 模型 ID 映射、Plan/Act 覆盖、Provider 元数据、凭据引用优先级和上下文窗口元数据。`prepareRunBinding` 只提供 Agent 与目录事实并消费结果，继续拥有 Skill、上下文包和 Run 创建。
- 模块只依赖 Core/Shared 契约和窄目录端口，不读取 secret、Storage 或 Runtime。真实密钥仍在 Provider 调用前通过 SecureStore 句柄读取；凭据选择 helper 同时供 fallback 重绑定复用，但回退候选、事件与持久化边界未迁移。
- 保留 run override → Agent pin → Agent group → Provider primary 的凭据顺序、Provider 亲和性、显式模型优先、Plan/Act 最终覆盖、`fake-mini`/无 SecureStore 回退，以及非法模型窗口元数据使用 128k 估算值。
- 新增 8 项纯用例测试；真实凭据调用、Plan/Act、消息启动和回退链共 61 项回归通过。Runtime 类型检查、定向 ESLint、40 项架构测试、807 文件扫描和整仓 13 包构建通过；Desktop initial/total JS 保持 2,098,962 / 2,973,733 字节。
- 本批未新增依赖或迁移、未操作业务库、未重启应用。下一批横向推进浏览器/传输注册边界；Website 共享 UI、其余 RPC 与兼容重导出继续分批。

### 续接记录（2026-09-19，第二十四批 Desktop Main 工具审批注册）

- 新增 `conversation-approval-handlers`，集中注册工具审批决定和 pending 查询两项 IPC。模块拥有运行时参数解析与调用顺序，只依赖来源校验、连接和类型化请求端口；Main 入口只负责 Electron 与 RuntimePipeClient 装配。
- 保留既有“来源校验 → 连接 → 参数解析/请求”顺序、默认 `once` scope、拒绝只允许 `once`、可选 Run 过滤和错误身份传播。审批业务状态、持久化与授权策略仍归 Runtime。
- `ConversationCommandContract` 从 12 项扩展到 14 项；架构规则同时阻止审批 handler 反向依赖 Electron/基础设施，以及两项审批命令退回无类型 `request`。
- 新增 7 项审批注册回归；4 个 Main 注册文件共 55 项测试、Desktop 类型检查、定向 ESLint、39 项架构测试、806 文件扫描和整仓 13 包构建通过。Desktop initial/total JS 为 2,098,962 / 2,973,733 字节，预算未调整。
- 本批未新增依赖或迁移、未操作业务库、未重启应用。下一批横向推进 Runtime 首发模型/凭据装配边界；浏览器/传输注册、Website 共享 UI 和其余 RPC 继续分批。

### 续接记录（2026-09-19，第二十三批 Renderer 运行订阅生命周期）

- 新增 `use-conversation-transient-subscription`，拥有会话 transient 订阅建立、scope generation、防迟到事件、ready 失败和清理/退订。ChatView 只注入当前游标、开始/失败/事件/清理回调，继续拥有帧队列、展示合并、终态刷新和委派卡片合并。
- Hook 的物理订阅只依赖 `enabled/scopeKey/threadId/subscribe`；高频游标和最新事件回调用 ref 读取，展示回调变化、模型或内核选择不会重订阅。会话切换先清理展示队列并退订旧流，旧 listener 和迟到 ready rejection 由 generation 丢弃。
- reset snapshot、durable fallback、process/terminal 即时 flush、断线后游标续接和已有终态刷新逻辑保持。新 Hook 纳入 Shell 控制器架构门禁，不得导入 ChatView、Main/Preload 或基础设施。
- 新增 5 项 Hook 生命周期测试；流式队列、内核选择、委派、终态、进程历史和用量共 142 项回归通过。Desktop 类型检查、定向 ESLint（0 error，保留 ChatView 既有 16 warning）、39 项架构规则、805 文件扫描和整仓 13 包构建通过。
- Desktop initial/total JS 为 2,098,962 / 2,973,733 字节，既有预算未调整。本批未新增依赖或迁移、未操作业务库、未重启应用。下一批横向推进 Main 审批查询/决策注册边界；首发模型/凭据、浏览器/传输注册和 Website 共享 UI 继续分批。

### 续接记录（2026-09-19，第二十二批 Runtime 活跃工具审批生命周期）

- 新增 `active-tool-approval`，统一拥有活跃审批的精简等待记录、按 Run 查询、列表投影和一次性结算；Runtime 只注入审批决策持久化、提交后记录和广播端口。等待记录不再保存未被读取的 workspaceRoot、聊天消息、整轮工具列表、已完成结果和工具轮次。
- 用户决策继续保持“授权准备/决定原子提交 → 记录已提交事件 → 移除等待项并唤醒 → 广播”的顺序；提交失败不消费等待项。Run 取消与 Abort 保持“先移除 → 记录取消决定 → 唤醒”以防重复结算，新消息替换旧 Run 仍在外层事务提交后才拒绝旧等待者。
- 三类来源（聊天工具、平台工具、内核权限桥）统一登记同一审批记录；pending 列表的会话/Run 过滤与时间排序迁入控制器。非活动审批恢复、授权范围策略、持久授权事务和协议错误映射保持独立边界。
- 新增 6 项生命周期测试；审批/追加边界、工具/内核及真实 RPC 共 167 项回归通过。Runtime 类型检查、定向 ESLint、38 项架构规则、804 文件扫描和整仓 13 包构建通过；Desktop JS 保持 2,098,355 / 2,973,126 字节。
- 本批未新增依赖或迁移、未操作业务库、未重启应用。下一批横向推进 Renderer 运行订阅生命周期；首发模型/凭据、浏览器/传输注册和其余 RPC 继续分批。

### 续接记录（2026-09-19，第二十一批 Renderer 会话导航控制器）

- 新增 `use-conversation-navigation-controller`，统一管理 minimap 目标页加载、最新目标令牌、导航意图版本和可重新瞄准的滑动动画。ChatView 只注入当前消息查询、around-message 加载、render window 目标、置底释放和 programmatic-scroll 写入。
- 保留已加载目标不发请求、未加载目标只取锚点页、较新请求独占 loading 清理、滚轮/键盘/触摸取消滑动、reduced-motion 即时定位和布局修正时不重启动画。scope-keyed loading 在会话切换的同一渲染即隐藏，旧意图失效；分页合并、缓存、滚动锚点和 minimap 几何保持原实现。
- 目录 Loader、目录 Hook 和交互控制器共同纳入 Shell 控制器架构门禁，不得反向导入 ChatView、Main/Preload 或基础设施。新增 5 项 Hook 测试；7 文件 52 项导航/历史回归、Desktop 类型检查、定向 ESLint（0 error，保留 ChatView 既有 16 warning）、37 项架构规则、803 文件扫描、git diff 检查和整仓 13 包构建通过。
- Desktop initial/total JS 为 2,098,355 / 2,973,126 字节，既有预算未调整。本批未新增依赖或迁移、未操作业务库、未重启应用。下一批横向转向 Runtime 活跃审批生命周期；运行订阅、首发模型/凭据、浏览器和其余 RPC 继续分批。

### 续接记录（2026-09-19，第二十批会话 transient 订阅生命周期）

- `runtime:conversation-subscribe-transient` 与 `runtime:conversation-unsubscribe-transient` 已迁入 `conversation-transient-handlers`。模块拥有参数解析、订阅/取消顺序、frame/reset 路由和每 sender 一次性的销毁清理；Main 只注入 sender ID、可信 URL 发送、销毁监听、连接与 RuntimeSession 端口。
- 保留订阅前来源校验、解析和连接顺序；取消订阅不额外建立连接。同一 sender 多订阅只注册一次 `destroyed` 监听，销毁时清理全部 transient 订阅并释放登记，后续相同 ID 可重新注册。缺失 snapshot 仍保持字段缺省。
- 新增 9 项 transient 注册回归；与 query/write 注册合计 48 项通过。Desktop 类型检查、定向 ESLint、34 项架构规则、802 文件架构扫描、git diff 检查和整仓 13 包构建通过；Desktop JS 保持 2,097,748 / 2,972,519 字节。
- 本批未新增依赖或迁移、未操作业务库、未重启应用。下一批横向转向 Renderer 会话导航控制器，继续保留 keyed remount、历史锚点与跨会话隔离；审批、浏览器和其他 RPC 留作独立批次。

### 续接记录（2026-09-19，第十九批会话写操作注册）

- Desktop Main 的 `runtime:append-message`、`runtime:conversation-send-message` 和 `runtime:conversation-compact` 已迁入 `conversation-write-handlers`。新模块拥有参数解析和写请求顺序，只依赖来源校验、连接、图片暂存/持久化、附件补写及类型化传输端口，不直接依赖 Electron、RuntimePipeClient、入口或 Storage。
- append 保留先连接、再暂存大图、提交消息、持久化图片并补写 `message.attachImages` 的原顺序；没有存活图片时不补写事件。sendMessage 保留空正文/原始空白，compact 保留显式 120 秒等待；连接、传输和附件失败继续原样传播。
- 新增 10 项写注册回归，并与 29 项查询注册、1 项编译期传输契约共同验证，共 40 项通过。Desktop 类型检查、定向 ESLint、34 项架构规则、801 文件架构扫描、git diff 检查和整仓 13 包构建通过；Desktop JS 保持 2,097,748 / 2,972,519 字节。
- 本批未新增依赖或迁移、未操作业务库、未重启应用。下一批抽离会话 transient 订阅注册和 sender 生命周期适配；审批、浏览器和其他业务域 RPC 继续分开推进。

### 续接记录（2026-09-19，第十八批旧委派报告精确查询）

- 委派历史查询现区分任务列表和单报告：带 `childRunId` 的报告请求先通过持久仓库主键精确读取并校验 `threadId`，命中后不再加载该会话的旧消息或其他持久报告；只有持久状态缺失时才进入旧消息兼容路径。
- MessageStore 新增 `findDelegatedMessage(threadId, childRunId)`，在 SQLite 中按线程和嵌套 `delegatedAgents.childRunId` 定位最新消息，只反序列化一个候选。MessageHistory 负责旧卡片解析；HistoryQuery 只消费 `getStored/getLegacy` 窄端口，Service 负责装配，模块职责未反向耦合。
- 保留持久状态优先、跨会话不泄露、running 记录校正/持久修复、报告每段 8,000 字符、列表 50 项及原排序。列表路径本批保持完整合并，未引入新索引、迁移或缓存。
- Runtime 4 文件 26 项、Storage 2 文件 25 项，共 51 项回归通过；Storage/Runtime 类型检查、定向 ESLint、34 项架构测试、800 文件扫描、git diff 检查和整仓 13 包构建通过。Desktop JS 保持 2,097,748 / 2,972,519 字节。
- 本批未操作业务库、未重启应用。下一批横向推进 R7：把剩余会话写操作的 Main 注册从入口文件分组，保留来源校验、运行时解析、连接顺序和等待策略。

### 续接记录（2026-09-19，第十七批 Storage 事务协调）

- 委派事件投影现分为两个入口：`projectEvents` 供独立历史修复使用并自行保证批量原子性；`projectEventsInTransaction` 供事件/checkpoint 协调器调用，不再在外层事务中创建嵌套事务。事件、委派读模型和 checkpoint 的原子提交语义保持。
- `SqliteEventCheckpointStore` 通过 `DelegatedRunEventProjection` 窄接口调用投影；生产持久化装配只创建一个 `SqliteDelegatedRunStore`，同时用于事件投影和 Runtime 委派查询/修复，移除每次提交时临时构造 Store 的隐式依赖。无第三方依赖和数据库迁移。
- 新增 2 项故障注入测试：投影参与者可看到未提交事件但失败后事件整体回滚；独立批量重放第二条失败时第一条也不落库。相关 Storage 10 项、Runtime 持久化/历史集成 13 项、Storage/Runtime 类型检查、定向 ESLint、34 项架构测试与整仓 13 包构建通过；Desktop JS 保持 2,097,748 / 2,972,519 字节。
- Storage 全量共 522 项，495 项通过、27 项既有基线失败：26 项迁移冻结断言尚未加入工作树已有的 `0056–0058`，另 1 项为 Windows 备份文件 `EBUSY`。本批未修改这些测试或迁移，避免扩大任务；对应事务/持久化路径均已独立通过。
- 本批未操作业务库、未重启应用。下一批优化旧委派历史查询的读取范围，保持旧消息兼容、持久状态优先、运行态修复、列表 50 项和报告 8,000 字符分页契约。

### 续接记录（2026-09-19，第十六批 Website 演示所有权）

- Website 现拥有演示入口、能力入口、状态会话、工具栏/工作台包装、样式、单元测试和构建脚本；相关文件从 Desktop 迁入 `apps/website/src/demo` 与 `apps/website/scripts`。Desktop 只保留 `website-demo-surface.ts`，显式导出官网实际使用的真实桌面组件与类型。
- Website 源码不再通过相对路径遍历 Desktop 组件，构建器把 `@sync-think/desktop-demo-surface` 映射到展示接口；架构门禁阻止重新直连 Desktop 内部或让该接口反向依赖 Website。构建仍从源码打包真实组件，因此 Turbo 暂时保留 Desktop 源码输入，尚未形成完全独立的共享 UI 包。
- Website package 现在明确声明 React、lucide、esbuild、Tailwind CLI、Protocol/Shared 等原先从 Desktop 隐式借用的依赖，并新增自身 TypeScript 门禁。锁文件已同步，未新增第三方版本。
- Website 8 项 Node 测试通过、2 文件 11 项状态测试通过；类型检查、脚本 lint、33 项架构测试和单包构建通过。最终整仓 13 包构建全部通过；Website 演示 JS 仍为约 1,490 KiB，Desktop initial/total JS 为 2,097,748 / 2,972,519 字节，既有预算均未调整。
- 本地 Edge/Playwright 验证官网加载、首屏、iframe、场景切换和控制台。主路径通过；静态服务未运行账号后端，`/api/auth/get-session` 返回预期 404。完整旧交互套件首次取消 skip 后发现 5 个现有断言与当前 UI 不一致（文件 diff/队列控件及能力页跨标签），迁移前源码已具有相同行为，本批未扩大范围修复。截图位于系统临时目录 `sync-think-website-phase16.png`。
- 下一批转向 Storage 事务协调与旧历史查询，继续横向推进。仍待：Website 真正共享 UI 包、首发模型/凭据、活跃审批、浏览器/传输注册、ChatView 订阅/导航、其他 RPC、全仓依赖环和兼容重导出清理。

### 续接记录（2026-09-19，第十四、十五批模型选择与审批恢复）

- 模型回退选择迁入 model-fallback-selection，只消费候选模型、运行快照和目录/Agent 只读端口。保留同供应商前向优先链、失败计数与熔断、Agent 快照回退、已尝试模型排除及耗尽暂停；Runtime 保留能力投影、watchdog 特例、重新绑定、上下文 Manifest 和原子事件提交。
- 上下文预览/压缩使用的默认模型选择迁入 conversation-model-routing，保留 model/agent/team 路径、协调者优先与首成员回退，每次读取当前目录。首次运行的模型装配、凭据绑定和模型探测尚未整体迁移。
- 重复审批与过期孤立请求迁入 inactive-tool-approval，通过 read/expire 两端口完成。已有决定直接回放，孤立请求须持久化拒绝后才返回 expired；写入失败继续报错并允许重试。历史审批摘要解析归入 tool-approval-read-model；活跃审批、权限范围、等待回调和授权事务保持原归属。
- 新增 23 项 Runtime 测试。8 文件 57 项模型/审批回归及 1 文件 14 项上下文集成回归通过，包含真实 Runtime 的回退链、带图回退、供应商熔断、审批重启恢复与持久化失败场景。报告 .data/phase14-runtime-tests.json、.data/phase14-context-tests.json。
- Runtime 类型检查、独立模块/测试定向 ESLint、32 项架构测试与 git diff --check 通过；架构门禁检查 799 个源文件。13 包构建成功（Runtime 重建、其余 12 包缓存命中），Desktop JS 保持 initial 2,097,748 / total 2,972,519 字节。
- 本轮未新增依赖或数据库迁移，未操作业务库、未重启应用。验证使用测试适配器和临时数据库，未请求付费模型；当前运行进程仍待重启加载。
- 下一批优先转向 Website 演示/共享 UI 的依赖边界，避免持续深入单一 Runtime 领域。其余待办：首发模型/凭据装配、活跃审批生命周期、浏览器/传输注册、ChatView 订阅/导航、Storage 事务协调/旧历史查询、其他业务域 RPC、全仓依赖环和兼容重导出清理。

### 续接记录（2026-09-19，第十二、十三批草稿、提交与会话 IPC）

- 本轮按用户要求推进多个有限边界：抽出 useComposeDraftRecovery（失败草稿/附件恢复和清理）、submitConversationMessage（准备/提交及图片回执），再从 Main 抽出 9 项只读会话查询注册。ChatView 保留乐观消息、标题、焦点和错误展示；由 9,540 行减少到 9,413 行。
- 草稿沿用现有工作区/会话隔离存储，保留新编辑和 keyed remount 恢复；提交使用准备结果的准确 thread/version。Main 查询保留来源检查、参数解析、连接顺序和错误传播，通过宿主端口独立测试。
- RPC 命令/参数/返回值关联从 3 项扩展到 12 项，含 9 项查询、prepare、append、compact；编译期负例覆盖错误范围和必需参数。sendMessage 补 IPC 形状解析，空文本和原始空白保持；非法 modelId 类型提前拒绝。compact 原 120 秒传输等待设置保持。
- Renderer 5 文件 93 项、Main/解析器 3 文件 73 项回归全部通过，共新增 47 项运行测试；报告 .data/phase12-tests.json、.data/phase13-tests.json。新增夹具的附件 ID 和时间线范围已按既有协议纠正。
- Desktop 类型检查、新模块/解析器定向 ESLint、28 项架构规则测试通过；门禁扫描 796 个源文件。13 包构建全部成功（全部重新执行），Desktop initial JS 2,097,748、total JS 2,972,519 字节，未放宽预算。
- 本轮没有新增迁移或操作业务库，没有重启当前应用进程；构建产物已更新，当前运行窗口尚未重新加载。验证范围为自动化测试、类型/架构检查和构建，不含付费模型请求及重启后的人工验收。
- 下一批优先转向 Runtime 模型路由/审批边界，避免继续深入单一 ChatView 任务。剩余还包括：运行订阅/导航、Storage 事务协调与旧历史查询优化、其他业务域 RPC/Main 注册、Website 共享 UI 包、全仓依赖环和兼容重导出清理。详见 docs/engineering/cohesion-refactor-2026-09-19.md 的后续迁移边界表。

### 续接记录（2026-09-19，第十一批上下文压缩生命周期）

- useConversationCompaction 统一自动/手动请求与宿主进度，拥有会话级请求锁、宿主 operationId、进度和消失期限；只通过 compact、刷新状态及错误通知回调接入宿主。ChatView 保留消息准备、append、附件回显及草稿恢复。
- 修复跨会话结果/锁串扰和旧 RPC 覆盖较新宿主进度；已观察到的活动压缩超过 15 秒后仍接受匹配终态。原生内核和阈值规则保持，自动判断使用本次发送选定内核。刷新异常不阻断发送，也不留下锁。
- 新增 Hook 18 项、ChatView 发送集成 3 项及架构规则 1 项。最终 16 个文件 186 项回归全部通过，覆盖冻结内核、失败恢复、会话切换、正文、历史/滚动、用量、队列和 Skill。报告 .data/phase11-final-tests.json。
- 联合回归首轮暴露历史导航测试的等待时序：请求调用数增加时，失败 finally 尚未恢复按钮；单独运行通过。现改为等待原“加载中间消息”按钮恢复可用，保留原错误/旧响应断言，联合复测全绿。
- Desktop 类型检查、定向 ESLint、24 项架构测试、git diff --check 通过；门禁检查 793 个源文件。13 包构建成功（Desktop/Website 重建、11 包缓存命中），initial JS 2,097,227、total JS 2,971,998 字节，原预算保持。
- 未新增依赖/迁移、未操作用户业务库、未重启应用。下一批拆分发送后的草稿恢复及附件合并/清理职责，保留更新输入、跨会话与 keyed remount 的恢复语义；运行订阅和导航仍另行分批。

### 续接记录（2026-09-19，第十批正文读取与会话隔离）

- 上批 5 项完整正文操作基线失败已处理。测试夹具改为按消息引用和分段位置响应，适配已有自动读取行为；保留分段完整性、失败重试、重复点击去重、会话切换后禁止复制/重发的断言。
- 额外修复两个实际缺陷：MessageTextContent 的读取结果按来源身份绑定，避免替换源等待/失败期间显示旧全文；ChatView 在派生列表前按历史范围筛选页面，避免旧消息以新会话 ID 发起读取。原有布局副作用清理保留，但不再作为读取隔离的唯一保护。
- 新增 7 项回归。14 个测试文件共 144 项全部通过，涵盖正文、复制/重新生成、历史分页、缓存恢复、过程历史、滚动锚点、队列、Skill 和终态。报告在 .data/phase10-tests.json；23 项架构测试、Desktop 类型检查、定向 ESLint 和 git diff --check 通过。
- 13 包构建成功（Desktop/Website 重建、11 包缓存命中）；架构门禁检查 792 个源文件。Desktop initial JS 2,096,139、total JS 2,970,910 字节，预算保持原值。
- 未新增依赖或迁移、未操作用户业务库、未重启应用；未执行原生桌面人工验收。下一批继续 R3 的发送生命周期拆分，优先隔离上下文压缩与发送恢复，保留这批会话/来源归属约束。

### 续接记录（2026-09-19，第九批聊天发送与队列边界）

- useComposeRequestQueue 拥有排队草稿、每会话发送锁、失败状态和自动续发；通过注入的 sendUserText 调用发送，不依赖 ChatView 或宿主通信实现。compose-send-request 只组装协议请求，附件落盘、上下文压缩、乐观消息和错误恢复仍由 ChatView 编排。
- 保留 FIFO、线程就绪门禁、失败后手动重试和会话切换隔离；队列使用发送时选中的模型，附件/Skill/推理/网络/内核选项继续沿用草稿快照。
- 新增 11 项回归通过。完整定向回归 113 项：108 通过、5 失败；失败均为 ChatView.kernel 的完整正文复制/重新生成用例。用本批修改前的 ChatView 同目录临时副本复测，得到相同 5 项失败；临时源码已删除，报告在 .data/phase9-baseline-tests.json 和 .data/phase9-current-tests.json。未将该回归集记为全绿。
- 架构测试 23 项、Desktop 类型检查、新文件 ESLint 和 13 包构建通过；门禁检查 792 个源文件。Desktop initial JS 2,096,009、total JS 2,970,780 字节，预算保持原值。
- 未新增迁移、未重启应用。本批完成 R3 的队列与请求组装边界；下一批先定位上述 5 项正文操作基线失败，再推进发送生命周期、运行订阅和导航拆分。

### 续接记录（2026-09-19，第八批卡片投影与广播边界）

- delegation-projection 接收窄数据契约，负责父工具行匹配、头像/状态/工具日志、用量字段和重连快照计算，不依赖 Runtime、DemoRunState、状态服务或执行器。
- Runtime 保留原编排：读取事实 → 构造卡片 → 采用权威状态 → 合并卡片 → 更新计时/保存终态卡片 → 广播 → 按父任务归属更新快照。工具名集合移到协作策略，派发和卡片匹配共享定义。
- 本批 150 项验证通过（Runtime 129、架构规则 21），新增 20 项纯投影测试、2 项真实 Runtime 广播测试和 1 项架构测试。覆盖晚到卡片继续广播、新轮快照不被覆盖、终态不回退、头像优先级、工具归属与日志预算。
- 13 包构建通过（Runtime 重建、其余 12 包缓存命中）；门禁检查 790 个源文件，独立投影模块/新增测试 ESLint、git diff --check 通过，Desktop JS 仍为 2,969,826 字节。
- 未新增迁移、未重启应用。本批属于行为保持的职责拆分，未声称完成视觉人工验收。下一批建议推进 R3：拆分 ChatView 的消息发送与队列职责，保留草稿、附件、队列续发和会话切换行为。

### 续接记录（2026-09-19，第七批消息历史与查询）

- DelegationMessageHistory 管理卡片缓存、父消息元数据和旧消息解析；DelegationHistoryQuery 通过记录端口合并事实、校正运行状态并分页。DelegationService 保留状态写入和兼容入口，Runtime 调用顺序保持不变。
- 修复父消息延迟落库时 releaseParent 提前丢弃卡片：配置消息存储的宿主保留待写入数据，下次写入成功后释放；写入异常继续保留缓存。未添加后台重试队列。
- 128 项验证通过（Runtime 108、架构规则 20），新增 19 项 Runtime 测试和 4 项架构测试。SQLite 故障注入覆盖失败回滚、晚到兄弟任务、重复重试、关闭重开及父正文保留。
- 13 包构建通过（Runtime 重建，其余 12 包缓存命中）；架构门禁检查 789 个源文件。相关独立模块/测试 ESLint、git diff --check 通过，Desktop JS 仍为 2,969,826 字节。
- 未新增迁移、未重启应用；旧历史查询仍沿用现有读取方式，本批没有增加查询索引或批量回填。下一批建议分离 Runtime 的委派卡片投影构造与广播编排，保持父工具行归属、头像、用量和晚到子任务的会话快照隔离。

### 续接记录（2026-09-19，第六批准入与智能体选择）

- DelegationAdmissionService 负责委派参数解析、预算校验和 Agent 选择，仅依赖中立契约、既有策略和两个只读宿主端口。Runtime 提供当前设置和 listEffective 工作区目录，继续管理写权限、父子身份、启动事务与执行。
- 保留错误优先级：JSON/任务校验 → 设置与额度 → Agent ID → 工作区有效目录 → 能力匹配。agent_run 仅沿用原动态开关豁免，层级/数量/轮次限制继续生效。
- 本批 155 项验证通过（Runtime 139、架构规则 16），包含新增 25 项准入测试。真实 SQLite 断言覆盖拒绝后零启动、零委派记录、父计数不变，以及落盘失败回滚后重试。
- 根构建 13 包通过（Runtime 重新构建，其余 12 包缓存命中），门禁检查 787 个源文件；Desktop JS 总量保持 2,969,826 字节。新模块/测试 ESLint、git diff --check 通过。
- 未新增迁移，未重启应用；当前进程需重启后加载这些改动。下一批优先拆分父消息卡片的兼容写入与历史读取，保留晚到子任务合并、分页与旧数据恢复语义。

### 续接记录（2026-09-19，第五批委派执行生命周期）

- Runtime 中的后台/同步委派计时、取消监听和清理已移到 DelegationExecutionController；控制器通过六个窄端口操作宿主，启动和终态事务仍留在 Runtime。
- 时限策略集中，原默认/上限保持不变。修复预先取消信号的注册时序；终态后迟到进度不续期；Runtime 关闭等待子执行器清理。
- 本批 151 项验证通过（Runtime 136、架构规则 15），包含 23 项新增生命周期/时限测试和 4 项架构测试；13 个包构建通过，Desktop JS 总量仍为 2,969,826 字节。
- 新模块/测试 ESLint 和 git diff --check 通过。未新增迁移、未重启应用；测试中的浏览器扩展端口占用提示不影响执行/关闭断言。
- 下一批建议拆分 executeDynamicAgentDelegation 的准入、参数解析和 Agent 选择，保持权限、启动事务和事件顺序。

### 续接记录（2026-09-19，第四批委派事件原子投影）

- 委派状态在事件提交阶段更新，与事件、checkpoint 共用 SQLite 事务。临时广播不再写持久状态；状态快照保留真实工具数和完整终态报告。
- agent_run / agent_delegate 在执行前保存 run.started；新增启动故障注入确认：无孤儿执行器、无额外委派计数、重试只执行一次。
- 新事件可重放修复丢失的读模型；旧 running 记录读取到终态事件后持久校正，不再每次查询重复修复。
- 138 项定向验证通过：Runtime 99、Storage 19、Shared 9、架构规则 11；门禁检查 784 个源文件。未新增迁移、未重启应用。
- 13 个包全量构建通过，Desktop JS 总量仍为 2,969,826 字节。独立委派模块和新增测试的 ESLint、git diff --check 通过。
- 父消息卡片的兼容写入仍是独立步骤；旧数据缺失全部身份线索时保留明确边界。详见重构记录。下一批建议抽离 Runtime 的委派启动/停止/超时编排。

### 续接记录（2026-09-19，第三批审查/返工策略迁移）

- 结论校验、产物血缘、返工上限和审查通过后的状态决策迁到 Shared 的三个纯策略模块；Storage 保留事务、租约 fencing、幂等重放与 SQL。
- 本批 286 项验证通过，包含 32 项新增纯策略测试和 4 项新增 SQLite 测试；转交事件失败时证据、备用审查员标记和派生步骤一起回滚。
- 13 个包全量构建通过；Desktop 包体仍为 2,969,826 字节。架构门禁检查 782 个源文件，新增策略与测试的 ESLint 通过。
- 旧迁移列表测试补齐已有 0056–0058，没有新增迁移。当前应用未重启、用户业务库未修改；浏览器扩展端口占用的测试日志与验证边界见重构记录。
- 下一批优先推进 R1/R4/R5：将委派读模型更新并入事件事务，验证事件提交/投影失败后的恢复；Runtime、ChatView 和其余 RPC 的职责拆分继续按清单分批进行。

### 续接记录（2026-09-19，第二批调度契约迁移）

- 调度参数、审批记录、上下文记录和领域错误已迁到 Shared；Storage 保留兼容导出，Scheduler/端口/StepExecutor 消除直接和内联 Storage 类型依赖。
- 架构规则拆成独立可测试模块，覆盖动态导入、require、相对路径；`pnpm test:architecture` 11 项通过。
- 本批 238 项验证通过，13 个包全量构建通过，Desktop 包体仍为 2,969,826 字节。原事务、租约、幂等与审批流程的测试通过。
- 后续 R6 推进 review/rework 决策抽离，R2/R3/R7/R8 的其他模块迁移继续按既定清单进行。本批未重启应用。

### 续接记录（2026-09-19，高内聚、低耦合修复）

- 委派任务已使用独立服务/持久读模型；完成兄弟卡片、取消状态、长历史查询、真实工具数和报告分段读取均已覆盖回归。
- 抽离聊天类型/缓存、Windows UIA 契约；调度器依赖四个窄接口；三类聊天 RPC 使用关联参数/结果的类型契约；共享终态规则消除两端投影分歧。
- Website 构建输入已包含跨包源码和设计 token；新增架构 AST 门禁接入根构建。Desktop UTF-8 构建保持预算不变，生产总 JS 2,969,826 字节。
- 定向回归 571 项通过。当前应用未重启，真实业务库未执行本批迁移；旧进程仍运行前一版代码。
- 具体实现、验证和后续迁移范围见 [重构落地记录](../engineering/cohesion-refactor-2026-09-19.md)。Runtime/ChatView 的剩余职责、完整 RPC 表及 review/rework 事务拆分仍需分批推进。

### 续接记录（2026-09-19，后台智能体停止状态闭环）

- 真实业务库已经保存代码审查子任务 `cancelled`、6 项工具调用、无最终报告；此前问题不是取消失败，而是卡片只显示状态图标，且下一轮模型上下文忽略父消息中的 `delegatedAgents` 元数据，导致模型沿用旧 `running` 文本并猜测了错误的子任务 ID。
- 卡片摘要现在直接显示中文状态；取消且无最终报告时，详情明确显示任务由用户停止、执行记录已保留。停止 IPC 失败会显示错误提示。
- 普通模型上下文会注入 Runtime 已确认的后台智能体状态；Codex / Claude 原生续接会话把同一状态纳入宿主上下文哈希，即使父消息仅原地更新、序号不变，也会在下一轮收到上下文更新。
- 定向回归 Runtime 41/41、Desktop 23/23，Runtime/Desktop 类型检查通过。Playwright 真实历史页验证显示“已取消”和停止说明，工具记录仍在，页面与控制台错误 0。
- 已重建并启动最新 development 版本：Runtime PID `23220`，桌面端保持运行。

### 续接记录（2026-09-19，后台智能体未返回工具命令可见）

- 子智能体工具日志不再让参数和输出争抢同一份顺序预算。现在按 8KB 输入、4KB 输出分别控制，并根据剩余调用数逐行预留；因此前序长输出不会再把后续 `command_execution` 的命令和工作目录折叠成“另有 N 项工具调用未返回”。
- 在既有 80 项安全上限内，每个工具调用都会保留真实工具名和输入，即使输出尚未返回；输入/输出截断分别展示说明。超过 80 项时才使用“超出显示上限”占位，语义与实际原因一致。
- 定向回归通过：Runtime 3/3、Desktop 92/92；Protocol 重建后 Runtime/Desktop TypeScript 检查均通过，`git diff --check` 通过。
- 重建并切换到最新运行版本：Runtime PID `60008`、Electron PID `12820`；Runtime 健康检查 `inFlightRuns=0`，Desktop 新连接握手成功。此前已持久化为单个占位行的旧消息没有原始明细可供前端重建；新执行及后续持久化记录按新规则显示。

### 续接记录（2026-09-19，图片图库与命令执行面板）

- 消息图片现在使用图一式的紧凑方形附件缩略图（80×80），独立排列在文本气泡上方；点击后进入统一 `ImageLightbox`，多图可左右切换，支持键盘方向键、缩放、适应窗口/宽度、直接复制图片和下载原图。Composer 中的图片附件预览也复用该图库。
- 自动生成的「引用文件」尾部现在从用户正文中拆出为紧凑的可点击文件附件行；卡片只显示文件名，路径继续保留在发送给模型的文本、悬停提示和打开行为中。图片附件行按实际数量收缩，两张图片不再预留第三列；消息行底部留白也已收紧。
- 工作区智能体列表现在统一从 Runtime 实时激活状态读取：`agent_list` 与 `list_available_agents` 都按当前 `workspaceId` 返回启用、未归档且全局可用或已在该工作区激活的智能体。外部 Codex/Claude 收到明确路由规则，不再扫描 `AGENTS.md`、项目文件或日志。只读核对当前数据库，Cuitaliao 工作区应返回 15 个可用智能体；Runtime 已重启为 PID `65320` 并与现有桌面窗口重新握手。
- 所有工具执行详情现在统一为“输入 → 原始工具 → 输出”面板；命令工具保留命令、工作目录、进程号和来源元数据，其它文件、搜索、写入和 MCP 工具也使用同一套输入/输出卡片。
- 定向回归：`ImageLightbox.test.tsx` 4/4、`InlineProcessFlow.test.tsx` 70/70、`ChatView.terminal-error.test.tsx` 8/8；Desktop TypeScript 检查通过；开发 Renderer 构建成功。
- 独立 Electron Playwright 烟雾检查通过：标题 `SYNC-THINK`、页面非空、控制台错误 0；截图保存在 `C:\Users\zhuzhenyu\AppData\Local\Temp\sync-think-ui-smoke.png`。当前业务 Electron 已重启，Runtime 继续保持运行。
- Desktop 全量测试发现 12 个既有文件共 40 项失败，集中在模型设置、ChatView kernel、ShellApp、WorkspaceFileVisualFixture、响应式布局和无障碍契约；本次新增与改动相关用例均为绿色，未把这些基线失败归因到图片/命令 UI。
- 生产 Shell 构建被体积门禁拦截：`3,068,733 / 3,060,000`，超出 `8,733` 字节；未调整门禁，当前通过 `dev:renderer` 启动并加载 `.data/renderer-builds/development` 最新产物。

### 续接记录（2026-09-18，图片执行过程可见性）

- 对齐本机 NewMax 1.1.14：图片始终先落盘；视觉模型继续使用原生图片输入，明确文本模型才进入备用视觉模型转写或 `describe_image` / `ocr_image` 路径，不用普通文件读取伪装识图。
- 新增持久化 `context.image.prepared`：过程卡展示图片路径、MIME、目标模型和 `Codex localImage` / Claude image block / 转写 / 待调用识图工具等真实路由；实时流与历史回放一致，「继续上一条未完成的回答」复用图片时也走相同发送链路。
- 定向验证 Runtime 53 项、Desktop 25 项通过；Runtime/Desktop 类型检查和 Runtime 构建通过。Playwright 独立 Electron 烟雾检查页面非空、切换可用、控制台错误为 0。
- 当前业务 Electron PID `31448` 保持运行；Runtime 已由守护进程重启为 PID `50888` 并自动重连。

### 续接记录（2026-09-18，读图续答修复）

- 定位到「继续上一条未完成的回答」路径只发送 `继续上一条未完成的回答。`，没有把上一条用户消息的图片带回 Runtime；历史图片因此不再进入视觉模型上下文，容易表现为继续了错误的旧任务。
- `ChatView` 现在从中断助手消息之前的最近用户消息取得图片；持久化 `sync-think-image://` 引用通过现有受限图片恢复 IPC 转为 data URL，再随续答请求发送。恢复失败时阻止空上下文续答并显示错误。
- 回归：`ChatView.terminal-error.test.tsx` 8/8 通过，覆盖图片恢复、`appendMessage.images` 转发和既有失败/重试行为；Desktop TypeScript 检查通过。
- 当前桌面窗口和 Runtime 继续保持运行；本次只重启 Renderer/Desktop 以加载前端修复，不改变 Runtime 数据。

### 续接记录（2026-09-18）

- 修复底部 Compose 模型菜单被面板覆盖：模型/供应商/思考强度 portal 层级提升到 `10000`；智能体库「可用范围」拆为独立行，并按真实工作区名称展示筛选项。
- 定向回归共 46/46 通过，Desktop 类型检查和 lint 通过；开发 Renderer 已重建并启动，Electron PID `39552`、Runtime PID `8812`，最新 `hello accepted` 为 `2026-09-18T14:47:06.122Z`。
- 智能体库筛选条已接入现有 `SlidingTabs`：可用范围、写入策略、状态切换会让选中指示器平滑滑动，同时保留原筛选和 `aria-pressed` 语义；定向测试 18/18、Desktop TypeScript 检查通过。重启桌面窗口后再做一次真实页面手测。
- 已从 `origin/codex/integrate-local-newmax` 快进到 `e5a67d1`，保留工作区未跟踪的设计/临时文件；没有覆盖或清理这些文件。
- `pnpm install --frozen-lockfile` 已完成（锁文件无需更新；注册表元数据探测因当前网络解析失败但不影响已安装依赖）。
- `pnpm build` 的 12 个包构建成功，Desktop Shell 在体积门禁停止：`totalJsBytes=3,064,541`，上限 `3,060,000`，超出 `4,541` 字节；没有修改门禁配置。
- 启动“卡住”的根因已定位：React 与 Runtime 实际已就绪，旧浏览器工作区的 Electron `webview` guest surface 因仅隐藏祖先而继续覆盖当前舞台。失活工作区现在直接隐藏 `webview`，不卸载组件、不丢失浏览状态。
- 回归测试 `BrowserPanel.test.tsx` 15/15 通过，Desktop TypeScript 检查通过；Windows 实窗已验证默认对话页、右侧浏览器工作台和“智能体”页切换，旧网页不再遮挡，Runtime 有新的 `hello accepted` 记录。
- 生产产物因既有体积门禁未替换旧 Renderer，已改用不调整预算的 `build:shell:dev` 生成开发 Renderer，并通过 `dev:renderer` 重新启动 Desktop；当前 launcher PID `42008`、Electron PID `15432`、Runtime PID `8812` 均在运行，最新 `hello accepted` 为 `2026-09-18T14:15:01.479Z`。后续独立处理 Shell 体积门禁，不把 4,541 字节超额与本次显示修复混合。

### 最新指定范围（2026-09-06）

- 本次只按用户新要求移除历史任务 UI、隐藏整单完成快照、固定左侧消息导航；前一轮广泛优化仍然停止，不恢复整体目标。
- 任务状态继续来自原生事件和持久化快照，不删除历史数据、不新增任务系统；当前未完成清单仍保留已完成子项与进度。
- 导航定位到聊天列而非随 Composer 高度缩放的消息区；展开、收起与任务完成均保持坐标，窄屏内容预留轨道空间。
- 88 项定向测试、Desktop 构建通过；三种窗口尺寸的实际组件/生产 CSS 验证通过，每例 60 个刻度位移 0px、无页面/控制台错误。没有新增真实模型请求。
- Desktop 全量 258 个文件、2122 项测试通过；定向 ESLint 无错误，保留 16 项既有 ChatView Hook 提示。本次指定范围完成后停止，其余优化继续待办。
- 北京时间 19:23 已正常重开业务窗口：Desktop 73884，标题 SYNC-THINK、响应正常；Runtime 19836 保持运行且 health 正常、inFlightRuns=0。本次仅刷新桌面，没有强制终止 Runtime。

## 前批状态：修复完成 · 按用户要求停止

### 最后交付（2026-09-06，09:54Z / 北京时间17:54）

- 用户要求“先做完这一个然后停止”；本批仅收尾未执行文件误报与失效审批步骤状态。交付后停止继续开发，其余六方向保留为待办，等待用户下一次明确安排；整体方案尚未全部完成。
- Runtime与Renderer只从成功写入结果生成文件变更；请求、拒绝、取消、失效、失败及读取不再计作已改文件。保留真实成功结果，不从dirty git或普通命令文字推断本轮修改。
- Claude原生toolUseID、Codex itemId与审批RPC requestId分开；修正失败元数据与Codex空exitCode的declined状态。新事件、只读历史、分页投影、恢复时间线及完成动作汇总统一结果语义。
- 四包全量4190项通过：Shared72 / Storage502 / Runtime1497 / Desktop2119。11项工作区构建、lint及diff-check通过，Desktop18项既有Hook提示保留；首屏JS1,921,629B、全部2,740,047B。
- 已有三内核12个真实案例的原数据库只读回放通过，完整与过滤事件投影一致；生产Electron对隔离副本的12项历史显示检查通过，页面/控制台error为0，不新增user请求或run.started。不是本批重新调用模型；旧Native失效canonical没有工具行，保留这一事实，验证失效提示/非流式及无伪文件卡，不声称补齐缺行。
- 09:54:34Z正常成套重启到Desktop90660 / Runtime91248 / launcher95776；标题/响应、hello/health正常，inFlight0。业务960消息/34任务/31会话、5个既有迁移对象及原5项任务历史保持；无新迁移、清理或installer发布。
- 证据见审查18.21及仓库外process-outcome-*报告；所有初始回放与夹具断言失败保留。未开展图片、其它性能预算、导航压力、能力扩展或正式更新等后续工作。

## 前批记录：三内核真实窗口审批与原请求恢复已验证

### 最新进展（2026-09-06，08:19Z / 北京时间16:19）

- 修复等待批准误判无进展、普通user消息缺runId关联；旧NULL行通过同run连续事务事件做保守只读匹配，不回填历史、不猜相近原文。已安装内核检查更新与实际安装状态分开。
- 三包全量Storage501/Runtime1469/Desktop2089，共4059项通过；未变Protocol113/Shared62沿用，累计4234但非五包全量。lint、diff-check、工作区11项构建通过，Desktop18项既有Hook提示保留。JS首屏1,920,706B/全部2,739,124B，各+607B。
- 真实生产Electron+SQLite+现有deepseek-v4-flash，Native/Claude/Codex各4个实际按钮场景，共12项通过：重开窗口同审批批准、拒绝、待批停止、异常Runtime重开后expired与原文恢复；未批准无写入、恢复不自动发送。Native65秒等待不误报stall，820/1280px浅深色和页面/控制台健康通过。
- 旧失败OQHDG1数据库原user行直接升级验证通过：精确原messageId可恢复，保留现有草稿，原NULL run_id不回填，运行计数不增加。不是换新数据。初始夹具Main/Runtime内核目录不同导致实际安装，已通过隔离复制真实版本统一目录；未修改业务内核目录或伪造检测。
- 08:19:20Z成套重启到Desktop94292/Runtime94336/launcher94792；hello/health正常、inFlight0、eventSequence1993680。业务960消息/34任务/31会话、5个迁移对象与原5项历史保持。无新迁移、清理、重复备份或installer。
- 下一批优先修复新观察：未执行的文件请求仍被历史过程统计为已改文件，失效后局部步骤仍显示运行中。图片/能力、执行中取消/工具失败、通用预算/冷峰值/去重/导出、万条左导航/阅读锚点、整窗多窗/资源职责、正式更新和完整回退仍按原六方向继续。
- 详见审查18.20、TD080、本地开发28节及仓库外kernel-window-acceptance-summary.json；实际截图、初始失败与最终验证均保留。

## 前批记录：三内核真实审批与关闭收尾已验证

### 最新进展（2026-09-06，06:41Z / 北京时间14:41）

- 修复原生审批登记失败仍挂内存waiter：本次请求明确deny并返回；修复Runtime关闭未等待Native/外部完整执行收尾导致数据库已关闭仍读会话。关闭后新运行/目标续轮不启动。
- 6项SQLite故障与关闭门闩先红后绿；Runtime197文件/1468项全量、47项相关、19项关闭兼容、6项终检、lint和工作区11项构建通过。其它四包沿用未变基线，累计4216，不是本批五包全量重跑。
- 实际Native write_file、Claude原生Write、Codex原生exec_command/command_execution，各5个场景，共15项通过：pipe重连批准/重复决定、拒绝、待审批取消、正常关闭独立Runtime进程重开、强制终止精确自有Runtime后新PID同库重开。未批准/取消/失效均不写入；run-cancelled/run-aborted与stale-approval不同。
- 06:41:58Z新Desktop92580/Runtime39392/launcher40432成套运行；旧90236/86068/81184已退出。标题/响应、hello/health正常、inFlight0、eventSequence1993672。业务message960/task34/conversation31、5个既有迁移对象和原5项任务历史保持。
- JS首屏1,920,099B/全部2,738,517B不变；无迁移、清理、重复17GB备份或installer。原备份与独立回退证据保留。
- 严格边界：上述真实审批使用生产pipe/实际内核/独立Runtime进程，不是Electron按钮点击；仅现有deepseek-v4-flash。早期Native同会话连续写入出现没有工具调用的成功文字，最新输入实际已转发；新会话分场景通过不代表该模型可靠性问题消失。失败夹具和日志保留。
- 仍按原六方向继续：真实Electron审批与原请求/图片、执行中取消/工具失败；其它响应预算、冷峰值、去重/导出；万条左导航/阅读锚点；完整能力入口；整窗多窗及正式更新回退；资源/职责拆分。详见审查18.19、TD079、本地开发27节和kernel-approval-acceptance-summary.json。

## 前批记录：三内核真实原生计划已验证

### 最新进展（2026-09-06，05:29Z / 北京时间13:29）

- 修复实质缺口：Codex0.152.0实际工具目录缺update_plan，模型会直接回答已创建而无计划事件。受管创建/续接显式tools.update_plan.enabled=true后恢复原生工具与回显；不改全局配置、不关闭goals、不另造MCP计划。无效goals开关试验已撤销并留证。
- 实际Native/Claude Code2.1.252/Codex0.152.0，使用现有deepseek-v4-flash上游，3内核×3轮真实计划/完整描述与状态/下一轮记忆/Runtime对象重开后历史和记忆均通过。旧失败Codex原sessionId续接也正常创建计划。不是模拟内核或仅预置事件。
- Codex持久化自检修复无reasoning文本的误报：分项门禁与显式E2E_EXPECT_REASONING=1；实际同thread跨2个app-server进程复跑通过。真实审批、图片、失败、取消、断连和异常进程重启仍独立待验。
- Runtime195文件/1462项全量、31项定向、lint、11项构建通过；其它四包沿用上批基线，累计4210但非本批五包全量重跑。JS首屏1,920,099B/全部2,738,517B不变，Desktop18项既有Hook提示保留。
- 已成套重启到Desktop90236/Runtime86068（launcher81184）；05:29:37Z健康、inFlight0、eventSequence1993662。业务960消息/34任务/31会话与5个迁移对象保持，原5项历史从新pipe仍可读；无新迁移、清理、重复备份或installer。
- 完整六方向继续：三内核其余生命周期矩阵；响应预算/去重/导出和冷峰值；万条左导航与阅读锚点；整窗多窗堆/公平性、资源职责；正式更新和完整回退。详见审查18.18、TD078、本地开发26节与kernel-live验收记录。

## 前批记录：原生任务历史已回显并成套重启

### 最新进展（2026-09-06，04:26Z / 北京时间12:26）

- 已定位原5项清单消失的原因：后续Codex轮次按本地规则清空当前投影，成功原生事件仍在。新增独立只读“历史任务”，不把旧进行中任务冒充当前执行。原始描述完整保留；旧5项事件本身没有描述，不凭空补写。
- 成功原生结果确认快照，支持Claude跨轮状态与显式清空；10轮目录、40项/224KiB内容分页、确定性复合游标、版本续读与会话隔离。按需只读Worker读取，缓存4项/16MiB JSON估计；不是堆硬上限，冷过滤历史峰值仍需后续验证。
- 最终Shared62/Protocol113/Storage493/Runtime1454/Desktop2080，共4202项全量通过；11项构建、Runtime/Desktop lint、diff-check通过，Desktop18项既有Hook警告保留。首屏JS1,920,099B、全部2,738,517B，较前批各+7118B，预算通过。
- 真实生产Electron Main/Preload/Renderer与Runtime/Worker、隔离SQLite夹具实测分页、轮次、清空、切会话、820/1280px浅深色与成套重启恢复；页面/控制台错误和警告0。最终5次暖IPC5.5–7.4ms，不是p95。未发送真实模型请求，三内核生命周期独立验收。
- 普通业务窗口已重启到Desktop85260/Runtime68032，启动器85488。04:26:10Z健康、inFlight0、eventSequence1993657；真实业务pipe返回原5项，与只读源一致。业务message960/task34/conversation31及5个迁移对象保持；无新迁移、重复备份、业务清理或installer发布。
- 原六方向继续：真实Native/Claude/Codex任务与审批矩阵；通用响应预算/去重/导出；万条左导航与阅读锚点；整窗多窗堆/公平性与资源职责；正式更新/旧Desktop和完整业务恢复回退。历史入口本批已完成，不以本批测试替代整体目标。
- 详情：审查18.17、TD077、本地开发25节、部署文档和.data/task-plan-history-rollout-result.json。

## 前批记录：失效审批恢复已落地并成套重启

### 最新进展（2026-09-06，02:47Z）

- P0失效审批闭环已补齐：Runtime列表返回最近20条持久失效摘要及总数，旧按钮首次/重复点击明确返回expired；不返回工具参数或旧授权。相同thread/run下用message_run_idx定位唯一原始user消息，歧义时不猜测。
- ChatView展示失效原因和“重新编辑原请求”；按需恢复完整原文、图片和技能，合并保留现有草稿。只在用户核对并显式发送后创建新请求，不自动重放工具。原图经Main受限IPC读取，校验消息归属和大小，不开放任意URL/路径或放宽CSP。
- 本批全量Runtime1450、Desktop2075、Storage488、Protocol95、Shared56，共4164项通过；Storage首轮并行压测时既有回滚测试超时/EBUSY，原样串行重跑全量通过，失败日志保留。最终22项定向重跑、Runtime/ Desktop lint和工作区11项构建通过；Desktop18个既有Hook提示未混称修复。
- 实际ChatView + 生产CSS + SQLite/Runtime读模型/Main图片边界、合成IPC实测：原文/图片/技能恢复、当前草稿保护、显式发送、缺图失败、会话隔离及820/1100px浅/深色通过，最终页面错误/资源失败0。不是实际Electron IPC或真实内核执行矩阵。
- 本机已成套重启：旧Desktop77300/Runtime31156退出，新Desktop77880响应正常、Runtime66672；02:44:02Z hello/health成功，inFlightRuns=0、eventSequence1993653。02:47:11Z只读核对message960/task34/conversation31及5个既有迁移对象保持。本次无新迁移、清理或installer发布。
- 最终生产首屏JS1,912,981B、全部2,731,399B（较前批各+6630B），预算通过。上一批17GB备份及回退证据保留，详情审查18.16、TD076和本地开发24节。
- 原六方向继续推进：当前/历史原生任务回看；实际Native/Claude/Codex审批、图片、失败和重启；其它响应预算与去重/导出；万条左导航/阅读状态；整窗多窗/资源职责；正式更新回退。该批通过不等于整体优化完成。

## 前批记录：已成套重启，历史任务边界待收口

### 最新进展（2026-09-06）

- 旧运行取消移到新消息事务成功之后：准备/落库失败保留旧运行和审批；旧 partial history、新消息、版本、审批决定及事件同事务。异步准备后重读版本与新鲜投影，避免覆盖并发变化。
- 最终 Runtime 193文件/1444项全量通过；21项定向 SQLite 故障注入通过；Runtime typecheck/build/lint 与工作区11项构建通过。其它包沿用前批绿色，累计基线4140，不是本批全量重跑4140。
- 17,007,509,504B SQLite Online Backup 已完整校验（integrity_check=ok、SHA-256、82表计数）；独立 Git1e1427a 构建通过，旧存储只读读取该备份与空库 worker 启动/关闭通过。未宣称精确旧二进制、旧 Desktop 或整库业务恢复验证。
- 2026-09-06T01:12:37Z 完成0052/0053/0054迁移和最终停写点备份，耗时587.771秒；消息960/task34/conversation31保持。当前普通Desktop77300已打开，Runtime31156，01:24:01Z hello/health成功、inFlightRuns=0。不是仅重开旧Renderer，亦不是installer发布。
- 实际生产壳设置往返通过；第二轮等待到6条历史消息，但任务卡等待失败。只读206事件证明旧5项清单仍在，后续Codex run.started按当前reducer清空非Claude计划，最终投影null。不是数据库丢失，也不是实际新内核任务创建证明。需补当前/历史任务回看边界；两轮页面错误0，存在既有allowpopups警告。
- 六方向范围保持：审批失效读模型/重新请求、其它响应预算与去重/导出、万条左导航、实际内核/整窗多窗、资源/职责，以及更新回退。此批不删除历史，不增加生产依赖或新迁移。
- 详情：审查18.14–18.15、TD075、本地开发23节和部署文档。下一步优先任务历史/失效审批UI及实际内核矩阵；成套窗口基本可用不等于全部目标或正式更新/回退完成。

## 前批记录：输入落库边界与失败草稿已验证

### 最新进展：超限不执行，写入失败不再假成功

- Runtime 在运行准入前按真实 blocks JSON 校验 256KiB UTF-8 预算，连同技能快照计入，保留原 100,000 UTF-16 单元入口；合法最大字节正文不截短。
- 普通 append 的消息、任务版本及新事件同 UnitOfWork 提交，消息/后续版本写入失败回滚并报错。助手兼容降级保持原语义；旧运行 supersede 提前取消仍待故障注入/原子性补充。
- 失败后恢复原输入；有新编辑时保留新稿并支持追加恢复。整合检查补齐 ShellApp 的按会话 key 重建：窗口级隔离缓存跨卸载保留，返回前后才收到失败都可恢复，消费后释放；窗口重启不持久化。
- 全量 Runtime 193/1429、Desktop 253/2058、Storage 47/487、Shared 14/56、Protocol 21/95，共 4125 项通过。构建/typecheck/lint 通过，Desktop 19 个既有 Hook 提示；首屏 JS 1,906,351B、全部 2,724,769B，预算通过。
- 实际 ChatView + 合成 IPC + 生产 CSS 验证自动恢复、新编辑、会话返回和 820/1100px 无溢出，页面错误 0。早期 export 回归与未编译 CSS 夹具问题均保留日志并已修正，最终完整重跑绿色。
- 2026-09-05T23:21:12Z 只读：业务 PID 33492 未切换、projection 表和 0052/0053/0054 仍缺失；23:20:14Z D 盘约 50.86GiB。自有 61580/32360/63820 和 Edge 已关闭，没有业务窗口重启/备份/迁移/清理。
- 下步补旧运行取消提交边界、失效审批原因/重新请求（已定位前端忽略回包），继续泛化响应、去重/导出、万条左导航、实际内核/整窗多窗及成套发布。详情审查 18.13，完整目标保持进行中。
- 上批旧正文引用恢复与 8 项/16MiB 来源缓存证据仍见审查 18.12；本批不改变该能力或增加数据库迁移。

### 前批进展：长正文不再只剩兼容预览

- canonical text/thinking 贯通持久来源引用、兼容块、实时有界帧及重连快照；普通消息按原 message 字段读取。保持 256KiB 存储和 1MiB 帧上限，不新增表。
- 真实 ChatView 默认零完整读取，点击后以折行原文分段；复制和重新生成读取完整来源，校验版本/长度/连续性，失败不使用预览，会话切换取消，避免重复拼接兼容正文。
- 全量 Runtime 192/1421、Desktop 252/2051、Storage 46/470、Protocol 21/95、Shared 13/53 通过；构建/lint 通过，Desktop 19 个既有 Hook 提示。生产首屏 JS 1,904,595B、全部 2,723,013B，预算通过。
- 独立真实 ChatView/SQLite/Worker 验证 3,200,029B 回答与 198,026B 提示；完整复制约 1.8 秒/74 段，换行归一后 SHA-256 与源一致，重发提示直接一致。当前段 240px/一个 code 子节点，820px 无溢出、读取失败可重试；并非整窗或真实内核基准。
- 日志本地时间 2026-09-06 05:44–05:45，只读业务库仍无 projection 表与 0052/0053/0054；业务 PID 33492 未切换，D 盘当次约 49.91GiB。没有业务重启、迁移、备份或物理清理。
- 审查 18.11 记录本批证据及边界。接下来处理 legacy 无 canonical 来源、泛化非工具/元数据全响应预算、来源去重/导出，再继续万条导航/阅读状态、审批重新发起、隔离/职责、整窗与多窗，最后一致性备份和真实内核成套发布矩阵。目标仍在进行中。

### 前批进展：未知大事件不丢失，安装不再等同执行

- 未知大展示 payload 使用 48KiB 预算与精确 event-display 来源引用；原始记录保留，公共 Run 字段统一过滤，嵌套键和字段顺序不再挤掉路由/失败信息。实时、回放、过程和两种工具卡贯通，点击后分段读取，不提高 1MiB 上限。
- Pi executionSupported 与 installed 独立；允许准备安装，执行菜单禁用并说明原因，保留版本。旧会话/首轮草稿不丢失，Runtime 在持久化消息、准备运行和目标启动/恢复前拦截，暂停/阻塞状态不变；没有新建 Pi 适配器。
- 全量 Runtime 192/1416、Desktop 250/2032、Storage 46/470、Protocol 21/95、Shared 13/53 通过。构建/lint 通过，Desktop 保留 19 个既有 Hook 提示。生产首屏 JS 1,900,249B、全部 2,718,667B，预算通过。
- 隔离 3.20MB 事件投影为 21,848B，20 次 p95 7.47ms；完整展示来源仍为 3,200,352B，20 次 Worker 暖段 p95 21.90ms、最大内容 JSON 43,881B。真实工具卡/ChatView 验证零自动读取、版本续段、Pi 草稿保留、820px 无溢出。并非整窗或真实内核指标，完整来源逐段解析/哈希成本仍存在。
- 日志本地时间 2026-09-06 04:35–04:39，只读业务库仍无 native_task_plan_projection、0052/0053/0054；业务 PID 33492 未切换，D 盘约 51.44GiB。本批自有测试服务均关闭，没有部署、业务迁移或物理清理。
- 审查 18.10 记录根因、先红后绿、性能与剩余边界。接下来继续普通长正文/非工具完整展示及全响应预算、去重/导出、万条导航、审批重新发起、资源隔离、整窗堆/多窗公平性，以及备份迁移和真实内核发布矩阵；目标保持进行中。

### 前批进展：会话汇总来源与游标已补齐

- 默认目录来自完整会话持久来源，单轮与会话审阅标签隔离；同路径按工具事件顺序保留最近变动。40 项/224KiB 双预算和 8 项/16MiB JSON 缓存，只有可见目录读取。
- 真实管道 131 文件跨重启续页、实际 UI 两轮 200 文件完整覆盖、40 当前行、503 重试、820px 无溢出通过；20 次暖页 p95 0.87ms、最大帧 17,634B，两个独立首读约 126/474ms。迁移 0054 查询计划/测试已通过，业务库尚未应用。

### 文件差异批次结果（前批基线）

- 第九批工具与文件差异按需链路已贯通实时/历史投影、只读 Worker、会话作用域 RPC、IPC、聊天文件卡及右侧审阅；完整原始内容留存。先前 1.2M 文件差异超帧已修复，原始根因、实现及边界见审查 18.5–18.7。
- 差异默认 80 行/页、最多 160 行，每行 512 单元；版本变化保留旧页、重新读取，前后原文可逐段读取。复杂中段明确按整段替换展示；缺失/截短快照与替换片段不伪造完整文件。密集短行旧降级路径和四位行号换行已补回归并修复。
- Edge 真实 FileChangesCard/ReviewPanel + 独立 SQLite/Worker 验证：初始展开零次完整请求、万行仅挂 80 行、完整长行片段仅 1 文本节点、版本保护、重试、跨会话拒绝及 820 宽无溢出。三文件过程帧 26,359B；20 次暖请求 p95 约 0.45–10.50ms，不是整窗或真实内核指标。
- 最终全量 Runtime 188/1395、Desktop 247/2017、Storage 46/467、Protocol 19/92、Shared 11/46 通过；构建/typecheck/lint/tokens/diff 通过，Desktop 保留 19 个既有 Hook 提示。生产首屏 JS 1,890,701B、全部 2,709,119B，通过预算。
- 日志本地时间 2026-09-06 01:19:23 只读检查：业务 Runtime PID 33492 仍从 2026-09-05 10:01:44 运行；实际库 native_task_plan_projection 表数 0，D 盘当次约 51.45GiB 可用。本批未部署用户窗口、迁移实际库或物理清理历史。
- 仍需继续：总帧预算/未知字段与普通长正文、源记录反复解析/哈希、底层大结果去重与流式导出；万条导航/阅读状态、Pi 能力门控、失效审批重新发起、测试资源隔离/职责整理、整窗堆/多窗公平性，以及一致性备份、0052/0053、成套部署与真实内核验收。工具/差异单链路通过不等同于完整目标完成。
- 已完成开发验证：审批按域索引读取、孤儿审批持久失效、原生任务快照跨重启读取与事件事务更新、文件差异摘要限长但完整内容保留。
- 第二批已修正正常审批写失败的一致性；保存代码块跨生成完成的展开和横纵阅读状态；设置目录/搜索统一隐藏未实现入口，保留有效旧链接。
- 第三批：任务冷恢复交给只读 Worker，快照安装使用短事务/源游标校验；任务工具元数据只解析一次，Run 过程采用精简事件投影与有界版本缓存。
- 第四批：Renderer 历史过程请求共用 3 个真实在途槽位，跨 keyed 切换保持额度；可见轮次优先，连接/繁忙错误最多 3 次尝试，失败显示单轮手动恢复，正文保留。
- 第五批：导航几何缓存/增量行高与二分定位、可见性直接调度、稳定缺省目录和 memo 刻度；仅目标行布局预热，稳定帧收敛，用户输入可取消跳转。
- 第六批：显式生产/开发/QA 构建与独立目录、高亮注册表统一、8 个页面按需模块、真正绕过失败缓存的局部重试、生产体积预算和发布副本排除重复 Renderer/QA 模块。首屏 JS 闭包约 1.87MB、Shell 全部 JS 约 2.68MB。
- 第七批：完整轻量历史目录、只读 Worker 锚点页与 IPC 已接入；跨页不拉中间正文，明确显示未加载区间，权威页合并修正过期行，缓存裁剪同步游标，用户输入取消旧请求，读取浮层不挤动正文。代码展开与横向阅读位置跨页保持。
- 第七批证据：Desktop 全量 242 files / 1999 tests，最后 27 项目标回归；Runtime 相关 46 项、Storage 消息读取 11 项、Runtime/Desktop 构建通过。定向 ESLint 无 error，17 个既有 Hook 提示保留；tokens 与差异检查通过。
- 第七批实际 ChatView 独立样本：2000 条目录、50 条初始正文，正文约 339–360 ms、完整目录约 605–614 ms、GC 后约 13.7MiB；10000 条单次目录仍约 5 秒且有 5000 刻度。与此前全部正文挂载的测试口径不同，不作直接同比或整窗性能承诺。Edge 与独立 Electron 验证跨页、明确缺口、代码状态和滚轮取消。
- 第八批：Native 非终态/fallback/重试状态采用首个完整快照与带摘要校验的增量，完整检查点保留；检查点后/重启后重新建立基线。真实 SQLite event/checkpoint 失败及外层 UnitOfWork 回滚不推进 journal，跨运行瞬态检查点不造成错误恢复。轻量过程/任务/审批投影去除恢复增量，展示元数据保持。
- 第八批最终验证：Runtime 全量 185 files / 1376 tests、Storage 45 files / 459 tests、Protocol 17 files / 88 tests、Desktop 相关 75 项、新增专项 20 项通过；Runtime 构建、定向 ESLint 和差异检查通过。固定端口 17373 的既有测试日志问题仍在，新持久化测试不占该端口。
- 第八批同机文件 SQLite 三次对照：132 个事件并保留第 128 条完整检查点，累计文本/工具状态字节各减少约 96.62%/96.11%；整轮写入约 675–685/915–961ms（旧约 973–1006/1033–1128ms）。不是整窗或真实内核吞吐；检查点恢复工具样本约 48–54ms，强制无检查点全重放约 880–892ms，比旧方式慢。每活动运行保留独立基线，不宣称堆减少。20000 条稳定工具记录追加计算由约 238–247ms 降为 40–43ms。
- 第八批格式上线边界：新 Runtime 读取旧完整记录，旧 Runtime 不识别新增量。部署前一致性备份并验证恢复，降级先保留新版数据、再恢复旧版兼容备份；步骤见本地开发第 14 节。未部署用户窗口、未迁移/清理真实历史。
- 早期证据保留：第六批 Desktop 1974 项（2 Worker）、20 项发布/QA 脚本测试、完整 Desktop 构建通过；第三批 Storage 456 项/Runtime 1341 项证据保持。第六批定向生产 ESLint 0 error / 2 个既有 ShellApp 依赖提示，差异检查通过；第五批默认并发 Worker 意外退出记录继续保留，测试资源配置仍待治理。
- Edge 隔离真实组件页面验证了代码完成前后状态与横纵位置相同、设置搜索不带出隐藏项；1280×900 和 820×740 无相关控制台错误。这不是实际业务库或完整窗口的性能/E2E 证明。
- 完整历史 Run 的隔离文件重放：任务冷恢复含 Worker 启动约 288 ms，Run 冷过程约 102 ms，暖读取小于 0.25 ms；冷读期间主线程 5 ms 定时器最大间隔约 7 ms。该证据不代表整页或全库性能。
- 第五批最终源码各 3 次采样：500/2000 消息最大跳转帧间隔约 11–16/35–46ms（前批约 230/1004ms），滚动矩形读取为 0；80 条成对问答中的代码展开和两轴阅读状态跨跳转/调窗保持。开发包初次就绪约 1.59–2.34/3.66–4.04 秒、GC 后堆约 31/93–94MiB，生产构建后继续评估首屏与内存。
- 第六批同源码开发/生产对照各 3 次：2000 消息开发约 2.35–2.39 秒/91MiB，生产约 2.02–2.08 秒/61MiB；生产 500 消息约 0.74–0.87 秒/20MiB。采用新一轮连续帧采样，2000 消息最大约 28ms，滚动矩形读取仍为 0；首次挂载仍有约 1.47 秒长任务。该样本是独立实际 ChatView，不是整窗/业务库/真实流式 p95。
- Electron 实际沙箱中验证设置/智能体动态模块、失败重试与关闭重开恢复、820×740 布局，以及生产、开发、QA 三种入口。只连接合成 bridge，不将此表述为用户业务窗口已验收。
- 业务改动尚未加载到用户当前窗口；实际数据库未应用 0052/0053/0054 迁移，也未做历史清理。
- 第七批 2026-09-05 19:05 检查：Runtime 仍为 PID 33492、10:01:44 启动；只读确认实际库仍无 native_task_plan_projection 表，D 盘当次约 38.43GiB 可用。最终迁移前重新检查、备份并按计划部署，历史物理清理仍为单独确认的维护操作。
- 第八批末次 2026-09-05 20:46:51 检查同一 Runtime 未重启，实际库仍无 native_task_plan_projection，D 盘约 38.42GiB 可用。方案 Canvas 已更新并编译/SSR 验证；这不是业务窗口已加载新功能。

### 后续按完整方案推进

1. 会话文件目录与单轮分页整合已通过开发验证。继续超大单项/未知字段、普通长正文的全响应预算、底层去重/流式导出、超大会话首次逐 Run 投影与堆峰值。
2. 完整目录和锚点读取已接入；继续万条目录的刻度密度/键盘访问与分段状态保持，检查多栏/隐藏页后台预取公平性。当前不会一次加载所有正文，但持续阅读后的挂载数仍会增长。
3. Pi 执行保护与其余能力入口一致性；补齐持久失效审批的页面说明与重新发起流程。
4. 在已完成的构建/高亮/按需模块基础上继续完整窗口、包体和真实发布验证；当前预算不包括独立 vendor 与字体。
5. 完整页面性能/E2E、进一步职责拆分、诊断与测试端口隔离。
6. 备份/空间检查后迁移实际库并重启最终构建，做真实内核与页面验收。历史归档/物理回收仍遵守 dry-run 和维护确认边界。

完整证据、剩余项和页面步骤：`docs/reviews/2026-09-05-codebase-audit.md` 第 10–18 节。当前不是整个优化目标完成状态。

## 历史状态：2026-09-01 · NewMax Composer/Plan/Goal 与设计稿能力收口

### 实现结果

- 空态与正式对话 Composer 共用本机 NewMax 的 frame、CodeMirror 6 编辑器、模式 Banner、对象选择器、Slash/MCP/加号动作表和稳定动作槽；Plan/Goal 正式模式、审批卡与进度任务清单保持独立事件域。
- `/plan <需求>`、`/goal <目标>`、`/execute` 的持久化顺序与本机 NewMax 对齐；任务清单兼容真实 Codex `toolCall.argumentsJson`，按 `toolCallId` 和当前 thread/task 隔离，首次快照自动展开，下一轮开始时清空。
- 浏览器 Profile/录制/Workflow 审核执行、AI 创建草稿、电脑操作、网络和通用设置均接入真实 Runtime 合同；AI 设计稿支持 `design-html` 解析、交互预览、源码、复制、下载、项目保存和系统浏览器打开。
- Runtime 将统一 `design-html` 输出合同注入普通 Provider 与外部 Kernel：完整自包含文档、唯一 fence、1 MiB 上限、可见/可访问内容，以及预览、浏览器打开和保存的事实边界均由提示与 Renderer 双重约束。
- 会话切换使用有界缓存与 NewMax 风格骨架屏，提示词优化通过真实 Provider/IPC 闭环接入并支持取消、Esc、旧响应保护；私有内核状态由 Runtime 广播后即时回显。

### 当前验证

- Runtime 设计稿合同、上下文状态、外部 Kernel 规划/恢复回归共 `43` 项通过；Runtime/Desktop typecheck 通过。
- 设计稿、提示词优化、浏览器定向测试和 BrowserStage 回归已通过；最终根级测试 `20/20` tasks（Desktop `221 files / 1770 tests`、Runtime `172 files / 1260 tests`）通过，typecheck `20/20`、lint `11/11`（0 error）、build `11/11` 和 `git diff --check` 通过。

## 当前状态：2026-08-27 · Skill 管理 NewMax 对齐完成并运行最新构建

### 实现结果

- 已从本机 NewMax 1.1.14 的 ASAR、preload API、Renderer 组件和真实窗口核对 Skill 实现，不再沿用旧能力中心推测结构。
- Skill 页面现使用 NewMax 的独立双页签结构、市场三列卡片、“我的 Skill”五区统计/工作区/筛选/七列表格，以及只有“导入 / 创建 Skill”的创建菜单。
- 导入弹窗支持文件夹、ZIP 和拖放，按 NewMax 提供 Emoji/本地图标、名称、描述和多安装位置；Runtime 逐位置复制完整 Skill 目录，处理根级 ZIP、单包装目录、多 Skill 包、部分失败与覆盖冲突。
- Runtime 自动识别工作区 `.claude/skills`、设置中明确启用且已缓存的 Claude 插件 Skill、全局 `.sync-think/skills` 和用户 `.claude/skills`，登记到“我的 Skill”并 watch 变化；工作区和项目级插件来源自动激活。
- 同名本地 Skill 内容发生变化时会创建新的不可变 SkillVersion；同一真实目录被多个工作区或插件来源引用时合并来源并保留全部工作区激活关系。
- 列表行操作已与 NewMax 对齐为使用、编辑、共享。400px 编辑弹窗只保存展示名称、描述与图标；导入和编辑都不会改写实体 `SKILL.md`。
- Skill 市场已从 Renderer 静态展示数据切换为 Runtime 作者目录；当前 6 个作者能力均可通过统一安装命令复制完整包到 `<home>/.sync-think/skills/<slug>`，附属 `references/` 文件会随包保留并登记。
- 市场安装和全局启停会直接使用 Runtime 返回值更新当前页面；全局开关具备即时反馈和失败回滚，不再要求用户手动刷新。
- Skill 管理字体和密度已按 NewMax 实窗值复核：Inter/Noto 13px 基准、五张等宽 84px 统计卡、60px 表格行、28 × 16px 无框开关，中文与英文说明不再通过缩放或低对比度呈现。
- “已激活工作区”现为 NewMax 同参数的 320px 锚定菜单，可逐工作区或通过“全局”批量切换；列表独立滚动，更新即时生效且失败回滚，不刷新整页。
- “全局”批量切换不再被执行中的半完成服务端快照覆盖；本地 Skill 的 30 秒扫描使用静默目录更新，页面不会切换回 loading，当前弹层、筛选和列表滚动位置保持不变。
- 全局停用 Skill 会弱化整行并在名称/工作区两处显示“已停用”，同时保留右侧重新启用入口。Compose `/` 通过 Runtime 的当前工作区查询，只展示全局启用且在该工作区激活的 Skill。

### 当前验证

- Runtime 本地目录测试 9/9、Desktop 能力中心测试 32/32；根级单并发全仓测试 `20/20`、`0 cached`，其中 Desktop 全量 `172 files / 1396 tests`、Runtime 全量 `151 files / 1144 tests`。根级 typecheck `20/20`、lint `11/11`（0 error）、设计令牌和 `git diff --check` 通过。
- 强制全量构建 `11/11`、`0 cached`。真实 Electron 扫描到 38 个本地候选并登记 41 个 Skill，recursive watch 正常；导入实测覆盖文件夹/ZIP、全局+工作区双位置、冲突覆盖、完整附属文件复制、原文逐字节保持与展示元数据。
- 页面实测无控制台错误、横向溢出或表格重叠；导入弹窗宽 480px，元数据编辑弹窗宽 400px。截图与机器可读结果位于 `C:\Users\ZHUZHE~1\AppData\Local\Temp\sync-think-skill-newmax-qa\`。
- 当前最终构建实例正在运行：Electron PID `40404` 已重载最终 Renderer，managed daemon PID `37092` 监督的 Runtime PID 为 `11016`；Runtime healthcheck 为 `ok` 且 `inFlightRuns=0`。
- 本轮聚焦验证：作者市场包测试 2/2、Desktop 能力中心测试 32/32；最终全仓串行测试 `20/20`（Runtime `153 files / 1152 tests`）、强制 typecheck `20/20`、lint `11/11`（0 error）、设计令牌和强制 build `11/11` 均通过。Electron 实窗通过 Runtime bridge 返回 6 个市场包和 126 个 SkillVersion 记录，“我的 Skill”按当前版本口径显示 118 行；CDP 截图与计算样式检查无告警、重叠或横向溢出。
  ﻿## 当前状态：2026-08-26 · 原生图片输入与 Codex 思考流已修复

### 实现结果

- 已绑定工作区的对话图片会写入 `<workspace>/.sync-think/conversations/<conversationId>/images/`；未绑定工作区时使用应用全局暂存目录。消息历史另存一份不含绝对路径的预览副本，持久层只保存 opaque `storageRef`。
- Codex 内核通过 app-server `localImage` 读取可信本地文件；Claude SDK 继续使用原生 base64 image block。视觉模型直接看原图，文本模型才获得 OCR/图片描述 fallback。
- Codex reasoning summary 的 item/summary/part 边界已映射为稳定段落，执行面板不再把思考标题与正文拼接。
- Workspace Files 与本机 NewMax 的真实范围一致：默认“所有文件”，可切到“对话文件”；文件预览、编辑和审阅由 Workbench 资源标签承载。

### 当前验证

- 真实 Codex app-server 图片回路已通过：直接读取用户 PNG，未调用 OCR 或其他工具，并正确识别人物。
- 全仓测试、typecheck、lint、token 检查和正式 build 全绿；最终 Desktop 构建已在 Electron 实窗复核，daemon/Runtime 心跳正常。

## 当前状态：2026-08-25 · 图片背景、阅读层与模型菜单 NewMax 对齐完成

### 实现结果

- 图片壁纸下的 conversation minimap 轨道保持透明，去掉半透明胶囊、模糊和描边；导航短横线独立提供浅色/深色背景下的对比度、悬停和活动态。
- 壁纸只进入主 Pane；侧栏、工作区标签轨道、会话标签轨道和页面 gutter 使用从图片提取的四级实体表面。顶部使用 `320px` smootherstep 过渡，正文中心使用渐进模糊与阅读高光，不再使用整壳铺图和半透明 chrome。
- Compose 左下角 `+` 插入 `@` 并打开上下文面板，Skill 图标插入 `/` 并打开命令/Skill 面板；`@` 面板保留工作区文件选择并提供图片上传入口。
- 模型选择器改为内容自适应宽度和稳定边框；ChatView 使用真实按钮作为 Radix trigger，独立组件使用 body 坐标虚拟锚点，背景切换后菜单、Provider 子菜单和模型键盘导航保持可用。
- 助手 Markdown 保持无卡片正文；表格改为透明无外框、轻行分隔、横向滚动和悬浮复制，短代码与标识符不被拆行。

### 当前验证

- Desktop 全量 `177 files / 1422 tests`；根级串行 Turbo `20/20 tasks`；typecheck `20/20`、lint `11/11`（0 error）、build `11/11`、token 检查、Prettier 和 `git diff --check` 通过。
- 可见态 Electron `1920 × 1057` 实测：主题卡为 `265 × 112px / 18px` 且四个配色点会真实改变 chrome 色阶；模型菜单正常展开并列出 `5` 个 Provider；`4` 张 Markdown 表格均为透明、零边框、`12px / 500` 表头和 `1px` 分隔线。
- 当前 Desktop PID `67708` 正常响应，最终构建已载入；验收结束后恢复用户原有“浓郁”图片配色，模型菜单收起。

## 当前状态：2026-08-25 · 偏好设置 NewMax 对齐完成

### 实现结果

- “设置 → 偏好”已按本机 NewMax `1.1.14` 重做为主题、快捷键、个性化三页；标签、外观按钮、图片操作、三列卡片和个性化字段的相对坐标与参考实窗一致。
- 六张图片主题、四档图片配色、上传/压缩/取色/取景、六套颜色主题、自定义纯度/对比度和对话字体均为真实可持久化行为。深色图片主题会先归一暗色表面，不再出现浅底浅字。
- 快捷键接入现有工作区与对话行为；语音输入使用 Electron Web Speech 服务。姓名、工作描述和全局提示词由 Runtime 持久化并加入每轮 Agent system context，不只停留在 Renderer。
- Shell 全局字体切换为 NewMax 同款 Inter Variable、Noto Sans SC Variable 与 Noto Serif SC Variable；209 个字体分片随构建复制，按页面实际字符按需加载。

### 当前验证

- 偏好页聚焦回归 `3 files / 14 tests` 通过；全仓串行测试 `20/20 tasks`、typecheck `20/20 tasks`、lint `11/11 tasks`（0 error）、build `11/11 tasks`、设计令牌与 `git diff --check` 通过。
- 实窗确认三套字体均加载，图片卡 `265.33 × 112px` 且首行相对弹窗 `y=254px`；深色表面为 `#1d1e1e / #222323 / #252626 / #1b1c1c`。`1424 × 861` 和 `900 × 650` 均无 document/body 溢出。
- 语音快捷键模拟按下/松开后得到 `started=1 / stopped=1`，当前对话输入框写入“语音测试”。最新 Desktop PID `15852`，daemon `51152 / 64612` 与 Runtime `15544` 保持独立运行。

## 当前状态：2026-08-25 · 关于页 NewMax 对齐完成

### 实现结果

- “设置 → 关于”已按本机 NewMax `1.1.14` 的信息层级、尺寸和相对坐标重做；旧的大型 updater 控制台与技术信息行已移除。
- 品牌区使用透明 SYNC-THINK 标志和字标，外层绿色底、边框和圆角均已取消。版本、自动检查、检查/下载/安装主动作、更新日志、日志目录和版权形成单列布局。
- 自动检查更新偏好由 Main 持久化，启动检查受“偏好开启 + 更新通道已配置 + updater 空闲”三重条件约束；更新日志 URL 固定在 Main，日志目录复用既有受控打开能力。

### 当前验证

- 聚焦测试 `3 files / 32 tests`、Desktop typecheck/build、设计令牌和空白差异检查均通过。
- NewMax 与 SYNC-THINK 实测的版本、自动检查、主按钮、辅助动作和版权相对坐标误差不超过 `1px`。`1424 × 861` 亮暗主题及 `900 × 650` 紧凑视口均无溢出，证据位于 `.data/about-newmax-qa/`。
- Desktop 重启后成功复用原 daemon/Runtime；当前最新源码窗口保持运行并停留在关于页。

## 当前状态：2026-08-24 · 设置数据与连接页 NewMax 对齐完成

### 实现结果

- “设置 → 数据”按 NewMax `1.1.14` 的五段信息架构和组件几何重做，并接通真实本机数据合同：存储统计、全量 JSON 导出/导入、SQLite 在线备份、存储优化、空附件目录清理和按范围清空对话。
- “设置 → 连接”按 NewMax 恢复 7 个页签、Provider 切换条、余额摘要和 27 个同序连接器；连接器图标来自本地资源，三列布局与参考实窗坐标一致。
- 任一连接器可进入远程 MCP 配置并保存发现；第三方 Provider 与 MCP 共用真实服务目录和启停、编辑、删除、刷新能力。插件与开放网关继续使用现有真实实现，未接入合同的页签保持明确空态。

### 当前验证

- Desktop `172 files / 1394 tests`、Runtime `151 files / 1138 tests` 全绿；根级 typecheck `20/20`、lint `11/11`（0 error）、设计令牌和 `git diff --check` 通过。
- 强制全量构建 `11/11`、`0 cached`。真实 Electron 中 Runtime bridge 的数据导出、导入、备份、优化、清理和远程 MCP 注册方法均存在；pipe healthcheck 报告 protocol v2、`data.management` 和 `inFlightRuns=0`。
- 实窗设置弹窗为 `1060 × 720px`，连接页为 7 个页签、27 个连接器，填写合法地址后保存按钮启用；数据页显示真实 `15.7 GB / 2.0 MB / 22 个对话 / 818 条消息`。窗口 `1426 × 863` 下 document 无溢出，页面错误和控制台错误为 0。

### 运行状态

- 最新源码实例正在运行：Electron PID `56192`、daemon PID `48260 / 43336`、Runtime PID `41784`，进程启动时间均晚于强制构建且状态为 Responding；实窗调试端口为 `127.0.0.1:9334`。
- Pipe smoke 返回 `PIPE_SMOKE_OK`；启动 stderr 只有本地 DevTools 监听行。日志、实窗截图和机器可读 QA 结果位于 `.data/local-restart-20260824-225305-newmax-settings/`。
- 当前改动尚未提交或推送；本地 `scripts/tmp-*.mjs` 调试脚本保持原样。

## 当前状态：2026-08-24 · NewMax 与 Runtime 增强已合并并冷重启

### 合并结果

- 当前工作分支为 `codex/integrate-local-newmax`，基于远程最新 `origin/feature/inline-process-ui@8073d3c`，已完整合入原本基于 `e8f762b` 的本地功能快照。
- 远程 NewMax 的主题、工作区标签、右侧/底部工作台、模型设置结构、活动中心和 daemon 自启均保留。
- 本地的失效模型恢复、外部内核 fallback、图片 Composer、视觉模型 Fallback、Windows OCR、平台 MCP Server、过程时间线、上下文状态与用量统计均保留。
- 7 个文本冲突已全部解决。视觉和几何采用远程实现，行为能力采用双方并集；Shell token 以 JSON 单一来源重新生成 CSS，不保留手工分叉。

### 当前验证

- Desktop `171 files / 1387 tests`、Runtime `150 files / 1133 tests` 全绿；typecheck `20/20`、lint `11/11`（0 error）、token 检查与空白差异检查通过。
- 强制全量构建 `11/11`，缓存命中为 0。构建产物 SHA-256：Renderer JS `A527B302...34DBE1`、Shell CSS `89DF43B0...92E8F`、Runtime `465DF2C8...63BE3F`。
- 旧进程已全部停止，新实例为 Electron PID `31004`、daemon PID `35656 / 18524`、Runtime PID `51012`；启动时间均晚于本次全量构建。
- Runtime pipe 健康检查为 `ok=true`、protocol v2、`inFlightRuns=0`，并返回 `PIPE_SMOKE_OK`；启动 stderr 为空。
- 实窗已打开模型设置验证：NewMax 布局与真实 Provider 数据正常，图片识别 Fallback、规划/执行模型、模型配置云同步均可见，主界面和弹窗无明显重叠或横向溢出。

### 运行与交付状态

- 当前最新构建正在运行；日志位于 `.data/local-restart-20260824-201649-integrated-final/`。
- 两份合并前 stash 仍保留用于回滚；本地 `scripts/tmp-*.mjs` 调试脚本保持未跟踪，不进入集成提交。
- 集成提交完成后仍只存在本地分支，尚未推送远程。

## 当前状态：2026-08-24 · Desktop 可用性与 Daemon 自启动修复完成

### NewMax 视觉对齐

- 深色主题已按本机 NewMax 1.1.14 的真实设计令牌统一：`#1e1f1f` 应用底色、`#252726` 侧栏/面板、`#2a2d2b` 选中面、`#36d385` 品牌绿；浅色主题也使用对应的暖灰表面层级。
- Shell 几何契约收敛为 220px 主侧栏、18px 工作画布圆角和 744px 对话/输入区。非对话页顶栏只保留当前功能上下文。
- 工作区标签现使用 NewMax 同参数 SVG 肩部曲面、3px 间距和 `58–172px` 自适应宽度；第二行所有资源类型统一为 40px 轨道中的 28px 标签。活动工作区直接衔接资源行和正文，不再存在 4px 内层卡片间隙或重复圆角。
- 右侧/底部工作台已按工作区独立持久化。右侧工作区文件默认 330px，文件预览与审阅为 713px（`424 + 1 + 288`），底部终端为 280px；关闭预览标签后自动回到紧凑文件栏。
- 对话、文件、终端、浏览器、审阅和工作区文件共享同一标签表达。主窗格通过标签拖到中心或四个边缘完成移动/分屏，右侧文件栏可直接把文件和本轮变更提升为独立文件/审阅标签。
- 定时任务页沿用原有的左侧筛选栏 + 右侧任务卡片流，配色接入统一的 NewMax 视觉令牌；设置窗口配色和布局同步收敛，并修复历史拖拽坐标导致的小视口越界。
- 模型设置页已完成 NewMax 1.1.14 级别的结构对齐：`1060 × 720px` 设置弹窗、192px 设置侧栏、240px 模型列表、596px 详情内容、六分类连续分段轨和 72px 底栏均按实窗尺寸实现。服务商目录已移除 NewMax Gateway，推荐页只显示自定义供应商与 CC Switch，国内服务目录按参考顺序补齐。
- 模型详情仍绑定真实 Provider/API Key/优先级数据；图片识别 Fallback、规划/执行模型、目标评估模型均保留，新增模型配置云同步偏好入口。分类与详情切换使用统一缓动，系统 reduced-motion 偏好会停用动画。
- 颜色、尺寸和主题值继续由 `docs/product/16-shell-design-tokens.json` 单一生成；视觉契约测试防止关键 NewMax 值回退。

### NewMax 对齐验证

- 聚焦测试 4 files / 50 tests；全仓串行测试 20/20 tasks、lint 11/11（0 error）、typecheck 20/20、build 11/11 全部通过。
- 1424x861 与 1024x700 的深浅主题均完成实窗检查，无 document 级横向或纵向溢出；设置弹窗在旧坐标和窄视口下保持完整可见。
- QA 截图位于 `.data/newmax-theme-20260824/`，当前 Desktop 已加载新主题并保持运行。
- 标签轨道新增 3 files / 26 tests；1424x861 亮暗主题与 1024x700 窄窗均无 document 溢出，最终截图为 `sync-tabs-final-light.png`、`sync-tabs-final-dark.png` 和 `sync-tabs-final-1024x700.png`。
- 工作台最终门禁：根级 test 20/20 tasks（Desktop 171 files / 1361 tests）、lint 11/11（0 error）、typecheck 20/20、build 11/11。1424x861 与 1024x700 实窗无 document 溢出，精确尺寸与交互截图位于 `.data/newmax-workbench-qa/`。
- 模型设置聚焦测试 3 files / 77 tests、Desktop 全量 171 files / 1363 tests 通过；根级串行 test 20/20 tasks（Runtime 141 files / 1059 tests）、lint 11/11（0 error）、typecheck 20/20、build 11/11、Prettier、设计令牌与空白差异检查全部通过。
- 实窗测得详情、目录和云同步面板均从弹窗相对坐标 `x=440 / y=118` 开始，内容宽 596px，云同步卡高 120px。900x650 下弹窗边缘完整可见且无 document 溢出，截图位于 `.data/newmax-models-qa/`。

### 已完成

- 智能体库现支持搜索、模型筛选、网格/列表切换；“开始对话”始终可见，失效模型显示“模型不可用”。
- 多对话标签增加固定管理入口，支持搜索、切换、单独关闭和关闭其他标签；设置页辅助文字与 Skill 安装按钮的可读性已修复。
- 后台活动将 Webhook、Git 推送、文件监听等来源显示为“系统触发”。失败 Run 只提供“重新编辑”，把原指令恢复到输入框；不会自动发送或切换模型。
- daemon 登录自启默认开启，显式关闭偏好持久保存。Windows 计划任务创建被系统策略拒绝时自动回退到当前用户 Run 登录启动项，状态查询和关闭操作同时覆盖两种注册。

### 当前验证

- Desktop 聚焦 4 files / 42 tests（含自启动 supervisor 8/8）、Desktop/Runtime typecheck、根级 build 11/11 均通过。
- 实机关闭 Desktop 后 daemon/Runtime 保持运行；新构建注册登录启动项成功，重启后台进程后状态为 `autostart: true`，手动关闭再开启的状态为 `false -> true`。
- 1424x861 实窗检查无横向溢出；智能体、设置、能力、活动中心和 12 标签管理器截图位于 `.data/local-restart-20260824-fixes/`。

### 下一步

- 为具体文件目录、Git 仓库和 bot 渠道补配置 UI；外部事件 durable contract 与 daemon 收件箱已具备。
- Runtime/系统重启期间的审批恢复仍需将 `pendingToolApprovals` 从纯内存状态迁到 durable 真相源。

## 当前状态：2026-08-21 · 后台活动中心完成

### 已完成

- 新增 `run_index` 读模型（`packages/storage`），由事件日志派生并回填历史：按 workspace / 状态 / 来源检索 Run，冗余 kernel、model、失败分类与错误摘要。状态在 upsert 中终态粘性，乱序或重放的事件不会把已完成的 Run 打回「进行中」。
- Protocol/Runtime 新增 activity 命令族：`activity.listRuns`（`(started_at, run_id)` 复合游标分页 + 各状态计数）、`activity.listExternalEvents`、`activity.retryAnchor`。外部事件视图直接读 daemon 与 Runtime 共用的同一 SQLite 文件，Runtime 侧只读。
- Desktop 新增「后台活动」页：状态/来源过滤、游标翻页、失败原因、打开对话与重新编辑，并列展示系统触发事件的投递状态与尝试次数。刷新只由真正推进生命周期的 Run 事件驱动，`plan.approved` / `run.queued` 不触发重查。
- 边界：外部事件逐字段投影，`leaseToken` 与 `instruction` / `metadata` 不出 Runtime；`states` / `sources` 在主进程按词汇表白名单过滤后才进 Runtime。
- “重新编辑”不新开 run-start 路径：`activity.retryAnchor` 只返回对话 id 与原始提示词，活动中心预填进 ChatView 输入框由用户确认发送，`expectedTaskVersion` 栅栏与模型/内核解析仍只有一份实现。

### 当前验证

- 定向：Runtime `activity-commands.test.ts` 12/12（含 leaseToken/instruction 不外泄的全序列化断言）、Desktop `ActivityCenterPage.test.tsx` 7/7。
- 全仓：typecheck 20/20、lint 11/11（0 error，保留既有 warning）；Desktop 167 files / 1324 tests 全绿。

### 下一步

- Runtime/系统重启期间的审批恢复：`runtime.ts` 的 `pendingToolApprovals` 目前仍是纯内存 Map。
- 浏览器 Workflow 确定性执行器：补 `ScheduledTaskTarget` 的 `workflow` kind 与自愈定位。

## 当前状态：2026-08-21 · Claude Agent SDK 迁移与 GitHub Webhook 入口完成

### 已完成

- Claude 内核已迁移到官方 `@anthropic-ai/claude-agent-sdk`：`claude-sdk-adapter.ts` + `claude-sdk-protocol.ts` 取代原 CLI spawn 与手写 stream-json 解析，旧 adapter/protocol/测试与两份 fixture 脚本已删除。工具审批走 `canUseTool`、MCP 以对象传入不落盘、取消走 `abortController`、压缩识别 `compact_boundary`。`KernelAdapter` 边界与 `KernelEvent` 词汇表未变。
- Registry 新增 SDK 类内核的 `bundledDetectionResult()`：不查 PATH、无 `executablePath`、无 `installCommand`；版本探测改为 resolve 主入口后读同目录版本，实测 `2.1.238`。
- daemon 已接入可选 GitHub Webhook HTTP 入口（TD-047），默认 `127.0.0.1:8765` 的 `/webhooks/github`。签名用 `X-Hub-Signature-256` 对原始字节 HMAC-SHA256 + `timingSafeEqual`，`X-GitHub-Delivery` 作 envelope 去重键，push payload 做有界投影后进入既有外部事件底座。
- 密钥只经 `--secret-stdin` 或自动生成进 SecureStore，配置只存 handle；argv 不接收密钥，日志不含签名或密钥，密钥读取失败返回 500 而非退化为无认证。`pnpm webhook:github` 提供 setup/status/disable。

### 当前验证

- Runtime 138 files / 1020 tests 全绿；webhook 四份定向测试 66/66；Claude SDK 真实抓包 replay 断言未改仍通过。typecheck、lint（0 error）、Prettier 均通过。
- 真实数据库实测 webhook：secret 不落库、`setup` 幂等、`disable` 保留配置与密钥 handle。
- 真实 Codex app-server 的**内容 turn** 验收仍受 Provider 503 阻塞，协议层 `initialize`/`thread/start` 已验证。

### 下一步

- 后台任务/事件中心 UI：统一 Run 列表、重试、取消与外部事件视图。（已于上方 TD-048 落地。）
- Runtime/系统重启期间的审批恢复：`runtime.ts` 的 `pendingToolApprovals` 目前仍是纯内存 Map。
- 浏览器 Workflow 确定性执行器：补 `ScheduledTaskTarget` 的 `workflow` kind 与自愈定位。

## 当前状态：2026-08-21 · 后台持续会话、外部事件与审批断连恢复完成

### 已完成

- Desktop 已退出执行所有权：普通关闭只断开 UI；daemon 监督长期 Runtime，Runtime 托管持久 Run、消息、工具授权和有界 Codex app-server Session。原生 threadId 与进程生命周期分离，进程回收或 Runtime 重启后可 `thread/resume`。
- Codex Registry 已切换官方 app-server adapter；旧 `codex exec`/JSONL 路径已删除。daemon dispatch 的 ack 只表示接收，任务所有权保持到 complete/abort/crash takeover。
- 执行过程面板 P1 已实现：稳定序号、工具类型图标、全部展开/收起、终态冻结耗时、JSON 键值详情、本轮计划；智能体任务区域只接受真实投影，不显示虚构数据。最终回答继续独立流式显示在面板外。
- `codex-default` 现在只作为宿主“使用 app-server 本地默认模型”的哨兵，不再被错误下发为 Provider 模型 ID；真实验收入口为 `pnpm selftest:codex-persistent`。
- push/webhook/文件/Git/异步任务现统一提交 `ExternalEventEnvelope` 到 daemon。`0048_daemon_external_event` 持久化去重、租约、心跳、Run 和终态；Runtime 持久化 event 到 conversation/run 的绑定，接管时不重复启动。
- 本地入口：`pnpm event:submit <json>` 提交，`pnpm event:status <eventId>` 查询；Git/Webhook/文件/bot/async 适配器只做脱敏和 envelope 映射，平台凭据仍留在 Provider/MCP 配置。
- Desktop 冷重启后的待审批恢复已闭环。Runtime 新增当前 pending approval 查询，ChatView 将其与 durable event replay 对账；即使持久游标已越过最初的 `tool.approval_requested`，重开后仍显示同一审批卡，且 approve/deny 后立即清除。

### 当前验证

- 定向：`InlineProcessFlow.test.tsx` 32/32、`process-activity.test.ts` 26/26、ChatView 过程/消息投影 25/25。
- 全仓：typecheck 20/20、lint 11/11（0 error，保留既有 warning）、build 11/11；`TURBO_CONCURRENCY=1 pnpm test` 20/20，Desktop 167 files / 1324 tests、Runtime 134 files / 939 tests。
- 实窗：先关闭 Desktop，daemon PID `22936/28580` 与长期 Runtime PID `52204` 保持；随后启动最新 Electron PID `20912`（CDP `127.0.0.1:9335`）。深浅主题下过程面板均位于视口内、无横向溢出，最终回答仍是面板后的独立 Markdown。截图在 `.data/local-restart-20260821-process-p1/`。
- 真实 Codex 0.145.0：同一 native thread `01a022dd-e165-7112-beaf-acb3a73b70d9` 完成三轮验收；前两轮复用一个 app-server，销毁后第二个 app-server 以 `thread/resume` 恢复并召回首轮随机令牌。MCP 写入/读取、reasoning、usage 与终态均通过。
- Desktop 断连：活动 Run `KNR9EH0P27WJKR1VW08T7E2179` 执行 45 秒命令时关闭 Electron，daemon `28580` 与 Runtime `52204` 原 PID 保持，healthcheck 报告 `inFlightRuns: 1`；桌面关闭期间落下 `run.completed`，重开后完整回放。证据截图在 `.data/runtime-survival-e2e-20260821/`。
- Runtime 崩溃恢复：强制终止受管 Runtime `52204` 后，daemon 原 PID 自动拉起 Runtime `52364`；原 Codex 会话以 `sessionMode=resume` 继续，native thread `01a02222-6ed7-7cd3-931d-f4c72c195086` 不变，并正确召回重启前上下文。
- 外部事件：Storage 40 files / 417 tests；根级 typecheck 20/20、lint 11/11（0 error）、build 11/11、串行 test 20/20，Runtime 134 files / 938 tests。真实事件 `evt-live-20260821-1510` 以 attemptCount=1 完成 Run `ADCFJH0NHXNN5B30C9T83YZXDB`，会话、终态和助手消息均已核对。
- 审批断连恢复：Runtime 9/9、Desktop 2 files / 13 tests、Protocol 9/9；`pnpm selftest:approval-reconnect` 的 approve/deny 两条真实 Electron 路径均通过，原 Runtime PID 保持、同一 approvalId 恢复、请求/决策各一次，写文件副作用只在 approve 路径发生一次。Storage 首轮全仓验证有一个既有迁移用例命中 5 秒负载超时；该用例定向复跑、Storage 40 files / 417 tests 和随后根级全量复跑均通过。

### 下一步

- 为具体 Git 托管平台、文件目录和 bot 渠道补配置 UI/HTTP endpoint；核心适配器与 durable contract 已就绪。
- Claude Code 迁移官方 Agent SDK，继续保持 `KernelAdapter` 边界。

## 当前状态：2026-08-16 · 新能力批量落地（plan/exec、问询卡片、任务清单、定时任务、目标模式、本地 Skill）

### 当前结论

- **plan/exec 双模型路由**：`plan-act` 设置（规划/执行模型 + 各自思考强度）由 runtime 在 run 创建前强制路由——规划模式用规划模型、执行已批准方案轮（`planExecuting` 标志）用执行模型；普通 execute 消息不路由，手动选择生效。
- **问询卡片（ask_user_question）**：平台工具全内核注入，挂起机制 + `conversation.ask.*` 命令族；composer 接管卡片（推荐徽章/分页/自定义/跳过）；plan-review 特例卡「方案待审」取代 plan_submit 流程（`plan_submit` 工具移除，conversation.plan.* 保留为兼容层）。
- **任务清单**：TodoPanel 常驻折叠面板（composer 上方）+ 持久化事件投影（run 终态保留、新 run 清空）。
- **定时任务**：scheduledTask（at/every≥5min/random 每日窗口随机 N 次/cron）、30s 心跳引擎、nextRunAt 持久化、任务专属会话（「任务 · {名}」+ 徽标）、`task_schedule` 工具（create/list/cancel，ask-mode 审批）、侧栏 TaskPanel（执行者两组下拉：智能体/直接模型）。
- **目标模式增强**：active/paused/blocked/achieved/cleared 状态机、`maxGoalRounds`（默认 5，耗尽自动 blocked）、结构化 `<goal_round>` 轮次提示、`goal_manage` 工具（complete/block/progress）、目标卡 UI（暂停/恢复/编辑/清除）。
- **本地 Skill 发现**：约定目录 `<home>/.sync-think/skills` 扫描 + watch 自动发现；`skill.local.scan/import`；能力中心「本地」tab（搜索/预览/导入/已导入徽标）。
- 文档：`15-frontend-design.md` §12.18-12.21 + `03-feature-changelog.md` 多条更新。

### 当前验证

- Runtime 全量 **113 files / 801 tests 通过**；Desktop 全量 **167 files / 1282 tests 通过**；typecheck（shared/storage/protocol/runtime/desktop）、tsc emit、build、lint（0 errors，15 条既有 warnings）全过。
- 真实模型 E2E（隔离 runtime 实例 `e2e-0001` + 用户 db 副本 + deepseek-v4-flash，脚本 `scripts/tmp-goal-e2e.mjs`）：
  - 通过：新命令全部响应；对话链路（run 启动、providerModelId=deepseek-v4-flash、助手回答）；native 内置工具（read_file）可调用；平台工具 schema 确认进入 provider 请求（`nativePlatformToolSchemas` 输出 ask_user_question/task_schedule/goal_manage）。
  - **发现并修复**：`openPersistentRuntime` 未接入 `SqliteScheduledTaskStore`（0044）；native 内核未注入平台工具（新增 `nativePlatformToolSchemas` 并入 native tools）。
  - **未解决**：native + deepseek-v4-flash 下模型不调用 ask_user_question / task_schedule（工具已确认传入请求，模型选择不调用；read_file 可调用证明工具链路正常）——待进一步优化工具描述/模型提示或验证其他模型。
- 用户窗口（Electron PID 142620）运行的是**旧代码 runtime**（dev-0001 管道，无新命令）——需重启应用加载新代码；用户已手动在另一实例上触发过新目标模式（goal_round 提示为新代码格式）。

### 工作树与后续动作

- 142 个未提交文件（本会话全部功能 + 分支既有改动），本次提交并推送 `origin/feature/inline-process-ui`。
- `scripts/tmp-*.mjs`（E2E/诊断脚本）按惯例不提交。
- 后续：① 排查 native + deepseek-v4-flash 平台工具调用问题（模型提示/工具描述优化，或换模型验证）；② 重启用户应用验证全部新功能 UI；③ 必要时跑通 plan-review/ask/定时任务完整真实链路。

## 当前状态：2026-08-11 · Markdown 表格数字断行修复

### 当前结论

- 已修复助手 Markdown 表格中序号 `10`、`11` 等被拆成上下两行的问题；表格单元格不再继承 `overflow-wrap: anywhere` 的最小宽度行为，宽内容仍由外层容器横向滚动承载。
- 已新增 Markdown 表格 CSS 回归检查，并完成可见 Electron 实窗复核。

### 当前验证

- Desktop 全量测试：151 个测试文件、1109 个测试全部通过。
- Desktop typecheck、lint（0 errors，保留 5 条既有 hooks warnings）、build 和 `git diff --check` 通过。
- 当前本地源码实例：Electron PID `34480`、managed Runtime PID `20188`、CDP `127.0.0.1:9352`；窗口可见、Responding，位置 `(40,40)`，尺寸 `1280×820`。
- 实窗证据：`.data/local-restart-20260811-markdown-table/markdown-table-fixed.png`。

### 工作树与后续动作

- 当前修改尚未提交或推送，也未生成安装包；保持本地源码实例运行供手测。
- 手测重点：在助手回复中查看含两位及多位序号的 Markdown 表格，确认数字保持单行，长正文仍正常换行。

## 当前状态：2026-08-09 · Skill / MCP 治理与分屏工作台阶段性提交快照

### 当前结论

- 能力治理已按三条独立路径收口：全局开关开启后能力可被发现；Workspace 未激活时，当前 Workspace 的 Compose `/` 菜单不展示该 Skill，也不能主动调用；Workspace 激活后，Compose 才能选择并执行。
- Agent 自身绑定的 Skill 走独立注入路径：Agent 执行任务时默认把其已配置的 Skill 注入上下文，不要求当前 Workspace 再激活同一 Skill。Workspace 治理约束 Compose/普通对话路径，Agent 绑定约束 Agent 执行路径。
- Runtime、Compose、MCP dispatch 和能力中心共用全局启用、Workspace 激活、Agent 绑定三层状态模型；全局停用只阻断实际调用，保留 Workspace 激活关系与 Agent 绑定。
- Electron 分屏工作台已支持对话行 `+` 菜单中的“新建对话 / 新建终端 / 网页浏览”。新建内容默认进入当前 Pane，不自动分屏；内容可通过拖拽移动到其他 Pane。
- “文件”和“工作区”已合并为“工作区文件”，并提供独立的分屏打开/隐藏按钮；分屏、拖拽目标、面板打开/关闭均有过渡动画，同时补齐浅色/深色主题 token、窄窗口适配和 reduced-motion 分支。

### 当前验证

- 已知本阶段定向回归 65 项通过，TypeScript 检查通过，Desktop build 通过；Electron `capturePage()` 视觉矩阵 10 个用例通过，覆盖浅色、深色和 760px 窄窗口。
- 提交前门禁已完成：Desktop 全量测试 `148 files / 1072 tests` 通过；`pnpm exec tsc --noEmit -p apps/desktop/tsconfig.json` 通过；`pnpm --filter @sync-think/desktop build` 通过；`git diff --check` 通过，仅保留既有 CRLF→LF 转换提示，无空白错误。
- 真实 Electron 启动尝试受 `ERR_FAILED (-2)`、Windows Chromium cache 权限和已有单实例锁影响；PID `120804` 的 `--remote-debugging-port=9222 .` 实例保持运行，未结束或清理。

### 工作树与后续动作

- 当前分支为 `feature/newmax-shell-rewrite`，跟踪 `origin/feature/newmax-shell-rewrite`；本阶段源代码、测试和文档已创建阶段性提交，尚待推送到远端。
- `.codex` 下的本地截图与根目录 `sync-think-arch.html` 已作为本地证据/临时产物排除在提交之外，仍保留在工作区。
- 下一步：推送阶段性提交到 `origin/feature/newmax-shell-rewrite`，随后核对远端提交、分支指针和工作树状态。

## 当前状态：2026-08-05 17:44 +08:00 · Browser Automation Studio P1.1 最终收口

### 当前结论

- P1.1 已完成：Runtime Profile 是唯一真源，Profile 会话只返回脱敏摘要，占用中的 Profile 拒绝刷新、清除和删除；右栏已收敛为临时 partition 的“预览”，不参与 AI 自动化或复用 Runtime Profile 登录态。
- 历史 Run 超过 5 分钟恢复 TTL 时，会把该 Run 的活动 Browser command 终结为 `failed/browser.command-recovery-expired`，再写入 `run.paused/recovery_expired`；不会重放 Provider 或继续占用 Profile。
- Handoff Continue 在 `reason=login` 时写入已验证登录摘要；清除成功但缓存重载失败时保留错误提示，不再被成功提示覆盖。
- BrowserHost 不再调用 `storageState()`；origin inventory 由 Runtime 已知 origin、当前 Page 和 Cookie domain 派生并限制为 512 条。registrable domain 使用 `tldts@6.1.86`，裸 IPv6 与 URL 方括号主机名可正确清除，CDP 建连失败时临时 Page 会被回收。

### 最终门禁

- Storage build 通过；Storage `36 files / 380 tests`、Workers `15 files / 117 passed / 3 skipped`、Runtime `70 files / 464 tests`、Desktop `131 files / 868 tests` 全部通过，均按包隔离并使用最多 2 个 test worker。
- `pnpm typecheck`：20/20；`pnpm lint`：11/11；`pnpm lint:tokens`：通过；`pnpm exec turbo run build --force`：11/11、0 cached。
- 本轮相关文件 Prettier 检查与 `git diff --check` 通过；源码中没有 `storageState()` 调用残留。

### 本地闭测实例

- 最新源码 Electron PID `43956`、managed Runtime PID `37228`，CDP `127.0.0.1:9333`；Pipe 握手、`runtime.healthcheck`、database 和 hello 均正常。
- 日志：`.data/local-restart-20260805-125346-browser-profile/desktop-final.stdout.log` 与 `desktop-final.stderr.log`；stderr 只有 DevTools 监听信息和一条 `libpng iCCP` 图片色彩配置警告，没有应用错误。
- 实窗切换到“最终闭测”Profile 后，实时刷新发现 `microsoft.com` 会话；清除返回 origin `https://copilot.microsoft.com` 并删除 1 个 Cookie。随后 UI 空态、SQLite `browser_site_session` 空表和活动 Browser command `0` 保持一致。
- 最终截图：`.data/local-restart-20260805-125346-browser-profile/profile-final-after-clear.png`；1424x861 下 `scrollWidth=clientWidth=1424`、`scrollHeight=clientHeight=861`，无页面级溢出。测试专用 Edge 窗口已关闭，Electron/Runtime 保持运行。
- 工作树继续保持 dirty；未提交、未推送，也未生成 installer、portable 或 release artifact。

### 下一步

1. P1.2：录制专用系统浏览器的语义动作、实时脱敏步骤流与停止后的资源清理。
2. P1.3：把确认后的录制步骤冻结为 WorkflowVersion，并实现确定性回放、失败定位与登录接管恢复。
3. 录制和回放都复用本轮 Profile/Page lease/维护门禁；Cookie、Token 和网站存储正文不得写入 Workflow。

## 当前状态：2026-08-05 14:09 +08:00 · Browser Automation Studio P1.1 收口

### 当前结论

- P1.1 已完成：Runtime Profile 是唯一真源，Browser 页面可创建、重命名、删除非默认 Profile，查看脱敏站点会话，显式刷新，按站点清除 Cookie/LocalStorage/IndexedDB 等数据。
- Profile 被 Run、handoff 或 BrowserHost lease 占用时，刷新、清除和删除均在 Runtime/Main 双侧禁用；默认 Profile 不可删除；危险清除使用单层确认。
- Runtime 刷新命令也有同一占用栅栏；直接 IPC 绕过 UI 时不会读取活动 Profile。
- Edge 143 的 `Storage.getUsageAndQuota` / `Storage.clearDataForOrigin` 固定走 Page target CDP Session；没有现有 Page 时创建临时 Page，避免 Browser target 的 `Internal error`。
- Profile 实时维护命令使用 30 秒预算，`runtime.healthcheck` 仍为 5 秒；冷启动刷新实测约 2.32 秒完成，UI 与 SQLite 摘要保持一致。
- P1.2 尚未开始：专用系统浏览器语义动作录制、实时步骤流、WorkflowVersion 与确定性回放仍是下一阶段工作。

### 本轮实窗证据

- 隔离目录：`.data/local-restart-20260805-125346-browser-profile`；Electron PID `46488`、Runtime PID `19704`、CDP `127.0.0.1:9333`。
- 已验证鼠标切换 Profile、创建/重命名/删除非默认 Profile、默认 Profile 保护、站点清除确认、Page 级 CDP 清除、清除后空态和 SQLite 同步删除。
- 1424x861、1024x720 的浅色/深色页面均无横向溢出或可见文本溢出；截图位于该隔离目录的 `initial.png`、`profile-light-session.png`、`profile-clear-dialog.png`、`profile-dark-1424x861.png`、`profile-dark-1024x720.png`、`profile-light-1024x720.png`，最终保留页为 `profile-light-final-1424x861.png`。

### 当前验证门禁

- `pnpm typecheck`：20/20；`pnpm lint`：11/11；`pnpm lint:tokens`：通过；`pnpm exec turbo run build --force`：11/11、0 cached。
- P1.1 定向/包级测试与 Browser Profile 实窗验收已通过：Workers 15 files / 111 passed / 3 skipped，Runtime 70 files / 460 passed，Desktop 131 files / 866 passed；`git diff --check` 通过。新增 Profile 文件已用 Prettier 格式化；历史文件的基线格式差异未做全仓重排。
- 根 `pnpm test` 在默认并发和 `turbo --concurrency=1` 下各有既有资源时序抖动（Workers/MCP、Runtime lease 时间断言、Desktop updater watchdog）；对应 Workers/Runtime/Desktop 包级受控复跑及失败文件单独复跑均通过。本轮未修改这些无关测试。
- 工作树仍保持 dirty，不提交、不推送、不生成 installer/release artifact。

### 下一步

1. P1.2：录制专用浏览器的语义动作（navigate/click/fill/select/wait 等），实时输出脱敏步骤流并支持停止后清理。
2. 在 P1.2 设计中复用本轮 Profile、Page lease 和维护门禁，不把登录态或 Cookie 正文写入 Workflow。
3. 录制能力通过自动化测试和本地源码重启实窗验收后，再进入 WorkflowVersion/回放实现。

## 当前状态：2026-08-05 10:30 +08:00 · Computer Use 与回复累计缓存用量已修复

### 当前结论

- Computer Use 新增 `desktop_launch_app`，只有 Windows Shell 启动后找到匹配进程映像的可见顶层窗口才返回成功；`run_command` 的退出码不再被当作 GUI 已打开的证据。
- 聊天消息用量现按真实 Provider `requestId` 去重并累计整次回复，不再只显示工具循环最后一次请求；使用统计的旧 Event 也不再按共享 `packetId` 合并。
- 缓存字段缺失与明确 `0` 已分开：缺失显示“未上报”，命中率分母只包含已上报缓存读取的请求；请求状态和费用标签改为“成功 / 失败 / 未结束”与“普通输入费”。
- 用户截图中的两条历史回复已由运行中的 Runtime 复核：4 个工具步骤的回复累计输入 `30,002`、缓存读取 `20,480`、输出 `546`；5 个工具步骤的下一条回复累计输入 `46,422`、缓存读取 `37,376`、输出 `1,045`。此前显示的 `5,632 -> 4,608` 只是两条回复各自最后一次 Provider 请求，单请求下降本身符合中转缓存的 exact-prefix 行为。
- usage sidecar 已升级为 `.data/SYNC-THINK/usage-summary-cache-v2.json`：483,420 bytes、schema V2、high-water rowid 36,041、1,791 条投影事实。近 7 天真实统计为 91 个请求、输入 777,698、缓存读取 496,640、缓存创建 0。
- 当前分支 `feature/newmax-shell-rewrite`、HEAD `9e5ee8d`；改动仍在未提交工作树，未生成 installer、portable 或 release artifact。

### 验证与运行实例

- Runtime：67 files / 454 tests passed；Desktop：130 files / 860 tests passed。双包同时并行时出现既有异步计时抖动，按包隔离复跑全部通过。
- Runtime / Desktop typecheck、lint、design token 检查、Prettier 和 `git diff --check` 通过。
- `pnpm exec turbo run build --force`：11/11 successful、0 cached。
- 当前 Electron PID `23508`、managed Runtime PID `23468`，窗口 Responding；日志 `.data/local-restart-20260805-102720/` 包含 `pipe ready`、`database ready`、`hello accepted`，stderr 只有 DevTools 监听信息。
- 使用统计实窗截图：`.data/local-restart-20260805-102720/usage-settings.png`；当前窗口停留在“设置 → 模型 → 使用统计”，便于继续手测。

### 用户手测

1. 开启 Computer Use，发送“打开本地记事本”。预期执行 `desktop_launch_app`，数秒内出现可见 Notepad 窗口；不应使用 `run_command` 证明成功，也不应等待 120 秒。
2. 在同一对话连续执行两次含工具调用的请求，悬浮每条助手消息底部 Token。标题应为“本次回复累计”，数值应为该回复内全部 Provider 请求之和。
3. 打开“设置 → 模型 → 使用统计”。缓存未上报时显示“未上报”，真实零显示 `0`；状态显示“成功 / 失败 / 未结束”，缓存命中率提示包含上报请求数。
4. 中转站单次缓存读取可以随动态工具结果和前缀变化而下降；应关注整次回复累计值和长期命中率，不要求每个后续请求都单调增加。

## 当前状态：2026-08-04 19:47 +08:00 · Prompt Cache 与使用统计 UI 本地收口

### 当前结论

- GPT-5.6+ 请求已统一发送稳定 `prompt_cache_key` 与 `prompt_cache_options: { mode: "implicit", ttl: "30m" }`；旧模型继续使用稳定 key，只对官方兼容型号发送 `prompt_cache_retention: "24h"`。
- 当前中转不接受内容级 `prompt_cache_breakpoint`，闭测采用兼容的 implicit 策略；Force-final 保留 system 与 tools，只设置 `tool_choice: "none"`，避免最后一轮破坏可复用前缀。
- 不把“缓存创建持续升高”作为优化目标。GPT-5.6+ 的缓存写入会单独计费；健康指标是稳定前缀后续产生高缓存读取。中转上报 `cache_write_tokens=0`，但后续读取命中证明缓存已经建立。
- 使用统计 UI 已改为模型与供应商合并列、普通输入/缓存读取/缓存创建/输出四类互斥 Token、常显缓存命中率和逐行费用展开；原有白色详情复选框已移除。
- 当前本地源码实例为 Electron PID `40980`、managed Runtime PID `23228`，CDP `127.0.0.1:9333`、pipe/database/hello 均正常；日志位于 `.data/local-restart-20260804-194224/`，没有应用错误。
- 本轮未生成 installer、portable 或 release artifact；提交与推送状态以 Git 记录为准。

### 缓存与实窗证据

- 同一 `gpt-5.6-luna` 会话在 tools 前缀稳定后，事件 sequence `35830` 为输入 `3102`、缓存读取 `2560`、缓存创建 `0`，命中率 `82.5%`；sequence `35836` 为输入 `3141`、缓存读取 `2560`、缓存创建 `0`，命中率 `81.5%`。
- sequence `35824` 的 tools 配置发生变化，因此该轮读取为 `0`；随后两轮在相同工具定义下恢复高命中，符合 exact-prefix 缓存规则。
- 最新构建在真实数据库上加载 22 条近 7 天请求；1024x720 下 body `scrollWidth=clientWidth=1024`，统计区无越界元素，表格使用内部纵向滚动，费用展开行 `scrollWidth=clientWidth=740`。
- 最终截图：`.data/cache-ui-live-1024x720.png`、`.data/cache-ui-live-expanded.png`；此前的浅色复核为 `.data/cache-ui-light.png`。

### 最终验证

- `pnpm test`：20/20 Turbo tasks；Desktop 128 files / 854 tests，Runtime 65 files / 442 tests。
- `pnpm typecheck`：20/20；`pnpm lint`：11/11；`pnpm build`：11/11。
- `pnpm lint:tokens`、Prettier 检查与 `git diff --check` 均通过。

## 当前状态：2026-08-04 18:20 +08:00 · Token 计价与两处用量 UI 已收口

### 当前结论

- `tokensIn` 统一定义为包含缓存读取和缓存创建的 Provider 总输入；普通输入、缓存读取、缓存创建、输出是四个互斥计价桶，总费用不会重复计算缓存 Token。
- 使用统计请求表和聊天“本轮回复”悬浮卡均已拆分展示上述 Token；请求详情同时展示四项费用。
- Anthropic Adapter 已修正总输入归一化，OpenAI 既有用量契约保持不变。
- 当前本地源码实例：Electron PID `45416`、managed Runtime PID `14032`，pipe/database/hello 正常，stderr 为空；日志位于 `.data/local-restart-20260804-180305/`。
- 本轮未生成 installer、portable 或 release artifact，工作树仍未提交、未推送。

### 实窗证据

- 近 7 天统计页成功加载真实历史请求；一条 `gpt-5.6-sol` 请求显示总计 `22.6k`、普通输入 `3.7k`、缓存读取 `16.9k`、缓存创建 `0`、输出 `2.0k`。
- 同一请求详情显示输入费 `$0.018660`、缓存读取费 `$0.506880`、缓存创建费 `$0.000000`、输出费 `$0.023424`，合计 `$0.548964`，列表显示 `$0.549`。
- `gpt-5.6-sol` 当前自定义 cache-read 单价为 `$30/M`，高于普通输入 `$5/M`，因此缓存命中高时费用由缓存读取费主导；这是现有定价配置值，不是重复计费。

### 验证

- 定向：Shared usage `2/2`、Runtime pricing/run process `8/8`、Anthropic `11/11`、ModelSettings `12/12`、ChatView usage hover `1/1`。
- 包级全量：Shared `23/23`、Protocol `55/55`、Adapters `79/79`；Runtime 全量 `440/441` 的唯一 MCP 子进程启动超时在串行复跑时 `10/10` 通过；Desktop 全量的两个 update watchdog/rollback 时序超时在串行复跑时 `9/9` 通过。
- Shared、Protocol、Adapters、Runtime、Desktop typecheck、lint、build 均通过；Desktop shell 在复选框样式修复后再次 build，`git diff --check` 通过。

## 收口复核：2026-08-04 15:05 +08:00 · 内部无签名闭测链全绿

### 当前结论

- 分支仍为 `feature/newmax-shell-rewrite`，HEAD `5cc35a1`；累计修改保留在未提交工作树，未合并、未提交、未推送、未发布。
- 内部 `unsigned-fixture` 已完成从构建、HTTPS Generic feed、差分下载、真实 `quitAndInstall()`、watchdog ready、目标自动拉起、健康登记到严格卸载清理的闭环。正式 release 仍对 Authenticode、RFC 3161、publisher DN 与独立 signer pin 保持 fail-closed。
- 当前没有本地工程阻塞；Phase 3 状态为 `passed-with-external-evidence-pending`。下一阶段可直接使用无签名包组织内部闭测，正式签名与真实外部服务证据独立补齐。

### 最终证据

- 标准命令 `pnpm test:update-install:win` 通过，证据目录 `.data/update-install-e2e-20260804T064953`：`0.0.1 -> 0.0.2`、install request 1 次、Runtime 重启、identity/safeStorage/metadata/ciphertext/SQLite 连续。
- 差分下载为 2 次 blockmap、7 次 Range、7 次 HTTP 206；完整 installer `130425065` bytes，仅传输 `556013` bytes，节省 `129869052` bytes，没有整包 HTTP 200 回退。
- recovery snapshot 含 watchdog-ready、relaunch、health 与 `healthy` outcome；目标正常启动，因此 `automaticRollbackAttempted=false`。结束后安装目录、卸载注册表、相关进程、handoff、native cache backup 全为 0。
- 默认内部 installer：`apps/desktop/release/installer/SYNC-THINK-Setup-0.0.1-x64.exe`，`130425094` bytes，SHA-256 `9154fca844eb8855453f549998cb23dd005ce769051a40b96f72d9a542bf83fe`；schema v3、`signing.mode=unsigned-fixture`、hash 与 manifest 一致。
- 全量门禁：根测试 20/20 tasks（Desktop 127 files / 852 tests）、typecheck 20/20、lint 11/11、build 11/11、portable 14/14、Phase 3 release/visual 41/41；`pnpm selftest:phase3` 全部 9 步通过。

### 后续外部工作

1. 获取正式 Authenticode 代码签名证书与 RFC 3161 timestamp provider。
2. 使用正式签名 installer 做故障目标版本的 automatic rollback E2E。
3. 验证真实 private feed/CDN、真实图片 Provider，并组织 5-20 位邀请用户反馈。

## 收口复核：2026-08-03 11:34 +08:00 · Phase 3 本地工程门禁恢复

### 当前结论

- 当前分支 `feature/newmax-shell-rewrite` 的 HEAD 为 `5cc35a1`，与 `origin/feature/newmax-shell-rewrite` 一致，相对 `origin/main` 领先 16 个提交。
- 09:41 审计发现的 packaged identity 竞态、根测试并发抖动、portable deploy `EPERM`、update-feed 隐式 fixture 和文档漂移均已在当前工作树处理。
- Phase 3 本地功能与工程门禁现已收口；聚合状态为 `passed-with-external-evidence-pending`。Phase 3 产品阶段仍等待正式发布证据和邀请用户闭测，因此不等同于公开发布就绪。

### 本轮修复

1. packaged identity 锁覆盖完整异步创建与 secret-store 落盘；100 ms 写入窗口下并发首次启动只产生一套 install ID / pipe secret，回归 8/8。
2. Desktop 测试框架预算统一为 15 秒；Desktop Host 正常/畸形 fixture 的 capability 预算为 10 秒，20 ms 超时负例保持不变；Runtime 260-frame bounded replay fixture 改为零节拍。
3. `@tailwindcss/cli` 与 `tailwindcss` 移到 Desktop devDependencies；portable production packages 从 294 降至 262，verifier 拒绝 Tailwind package 和 `.bin/tailwindcss*` 进入生产载荷。
4. update-feed 新增显式 fixture 准备步骤和 preflight 合同；`pnpm test:update-feed:win` 可从空 release 目录重建 portable + schema v3 unsigned NSIS installer，再执行 Generic feed 与 Electron HTTPS E2E。
5. Windows updater 临时目录清理增加有界重试；缺失、legacy、篡改或签名模式错误的 installer fixture 均返回稳定错误和准备命令。

### 最新验证

- Desktop 全量：127 files / 849 tests；Runtime transient 定向：8/8；根 `pnpm test`：20/20 Turbo tasks。
- portable staging 连续两次通过；unsigned installer 为 `130561014` bytes；发布合同 40/40。
- 从空 `apps/desktop/release` 执行 `pnpm test:update-feed:win` 通过 Generic feed 9/9 和 Electron HTTPS 8 场景，包括真实 installer 下载与 checksum mismatch。
- `pnpm selftest:phase3` 于 11:25 开始并在 335.6 秒后通过全部 9 步：Desktop contracts 12 files / 87 tests、release/visual contracts 33 tests、Desktop typecheck/build、fixture prepare、Generic feed E2E、image provider build、无凭证显式 skip 与 Electron 7-case 视觉矩阵。
- 最终门禁已于文档同步后复跑：`pnpm install --frozen-lockfile` 通过；`pnpm exec turbo run test --force` 为 20/20 tasks、0 cached；`pnpm typecheck` 20/20；`pnpm build` 11/11；`pnpm lint` 11/11；`git diff --check` 通过。强制测试计数为 Desktop 127 files / 849 tests、Runtime 63 files / 436 tests。

### 仅剩外部证据

1. 正式 Authenticode 发布证书与 RFC 3161 timestamp provider。
2. 正式签名 installer 的真实升级与故障注入自动 rollback E2E。
3. 真实 private origin/CDN 的授权、cohort、cache invalidation 与撤回演练。
4. 真实图片 Provider 凭证下的生成、预览、Reviewer、返工与重启恢复验收。
5. 5-20 位邀请用户 Windows 闭测与反馈记录。

### 外部证据启动预检（2026-08-03 11:53 +08:00）

- 首个执行目标按路线图确定为正式 Authenticode + RFC 3161 installer build/verify，然后才进入正式签名升级与故障注入 rollback E2E。
- 当前 Process/User/Machine 环境均未配置 Windows signing mode、publisher DN、独立 signer pin、证书来源或 RFC 3161 timestamp server；现有 release resolver 返回稳定阻断码 `installer.signing_certificate_missing`。
- `Cert:\CurrentUser\My` 与 `Cert:\LocalMachine\My` 中符合“未过期 + 带私钥 + Code Signing EKU”的证书数量为 0；仓库内没有 PFX/P12/CER/CRT，GitHub 仓库也没有 Actions workflow、secret、variable 或 environment 可作为受控 release runner 配置来源。
- private feed URL/channel/token 与 live image API key/reviewer model 同样尚未配置；本轮仅检查存在性，没有读取或落盘任何 secret 值。
- 下一执行门禁需要先在受控机器导入正式代码签名证书，或提供受控 PFX/远程签名来源，并配置完整 publisher DN、独立 expected signer SHA-1 与 RFC 3161 timestamp URL。配置就绪后直接运行 `pnpm release:installer:win` 与 `pnpm release:verify:installer:win`，再继续 signed update/rollback E2E。

以下 09:41 内容保留为修复前审计快照，便于追溯问题发现与处置路径。

## 同步复核：2026-08-03 09:41 +08:00 · 已拉取最新代码，Phase 3 仍有本地红项

### 同步事实

- 当前分支 `feature/newmax-shell-rewrite` 已从 `c57c81d` fast-forward 到远端最新 `5cc35a1`（`feat: complete phase 3 desktop and runtime foundations`）；拉取前工作树干净，未产生 merge commit。
- 本次远端增量为 1 个提交、265 个文件、`+57065/-7795`；当前分支相对 `origin/main` 领先 16 个提交，且是当前最新的远端分支。
- 增量主体覆盖 Desktop/Runtime/Workers/Storage：Browser handoff、Windows UIA/Computer Use、图片生成与视觉 Reviewer、Windows installer/updater/automatic rollback、诊断导出、数据库治理与 Phase 3 验收脚本。

### 阶段结论

- Phase 0、Phase 1、Phase 2 仍可视为已关闭。
- Phase 3 的主要本地功能主体已经落地，尤其是 Browser Worker、Desktop Worker、图片 durable 管线、差分 updater、automatic rollback 和 Database Governance fixture-only 能力。
- Phase 3 目前不能标记为“本地门禁全绿”或“可发布”：存在 1 个稳定功能回归、根测试并发抖动、portable staging 失败和文档漂移；正式证书、真实 private feed、真实图片凭证与邀请用户闭测也仍未完成。

### 本机复核结果

- 环境：`pnpm install --frozen-lockfile` 成功；pnpm 生命周期使用托管 Node `20.20.2` / pnpm `10.28.2`。
- 通过：`pnpm typecheck` 20/20、`pnpm build` 11/11、`pnpm lint` 11/11、`git diff --check`。
- 通过：Storage 36 files / 374 tests；Workers 单包 15 files / 100 tests，另有 3 个显式 browser smoke skipped。
- 通过：Desktop 排除已确认失败文件后 126 files / 841 tests；automatic rollback 定向 8 files / 40 tests。
- Runtime 全量为 62 files / 435 tests passed、1 test failed；失败的 transient replay 文件随后定向复跑 8/8 通过，归类为并发时序抖动。
- 未通过：`packaged-install-identity.test.ts` 定向复跑稳定为 7 passed / 1 failed。两个并发首次启动调用产生了不同 install ID / pipe secret。
- 未通过：根 `pnpm test` 两次均在 Workers 的 `DesktopHostClient` 成功握手用例失败；1 秒 capability timeout 在全仓并发负载下被击穿，但该文件定向 4/4、Workers 单包 100/100 通过。
- 未通过：`pnpm selftest:phase3` 完成 Desktop contracts 12 files / 87 tests、release/visual contracts 29 tests、Desktop typecheck/build 后，在 Generic feed 阶段中止。首次为 Windows 临时目录清理 `ENOTEMPTY`；定向 9/9 通过后，完整 E2E 又因缺少 installer fixture 中止。
- 未通过：尝试生成 `unsigned-fixture` portable 两次均在 pnpm shared-lockfile deploy 写入 `tailwindcss.ps1` 时返回 `EPERM`，因此没有生成 installer，也没有重跑真实 Generic feed Electron E2E、visual capture 和最终 Phase 3 汇总。

### 已确认阻塞与风险

1. **P0 - Packaged install identity 并发锁提前释放**：`resolveDesktopRuntimeIdentity()` 在 `try/finally` 中直接返回 `createPackagedIdentity()` Promise，`finally` 会在创建完成前删除 lock；第二个调用可进入并生成另一身份。此问题影响 pipe credential、升级与回滚连续性，必须先修复。
2. **P0 - 发布构建不可从当前干净检出稳定复现**：portable staging 的现代 pnpm deploy 连续两次 `EPERM`；Phase 3 Generic feed E2E 还隐式依赖预先存在的 `apps/desktop/release/installer/SYNC-THINK-Setup-0.0.1-x64.exe`。
3. **P1 - 测试门禁时序不稳定**：Workers 1 秒 host timeout 与 Runtime transient replay 5 秒等待在包级/定向测试通过，但全仓并发会失败。根测试当前不能作为稳定绿门禁。
4. **P1 - 文档漂移**：Roadmap、Handoff、Deployment 和 Changelog 仍把 automatic binary rollback 写成未实现；`TD-034` 正文已被实际提交为问号字符；部分历史“下一任务”也已被后续实现反超。
5. **外部证据**：正式 Authenticode/RFC 3161、正式签名升级与 rollback、真实 private origin/CDN、真实图片 Provider、5-20 位邀请用户闭测仍待完成。

### 建议继续顺序

1. 修复 packaged identity 锁生命周期并补充稳定并发回归，先恢复 Desktop 127 files / 849 tests 全绿。
2. 调整 process-host / transient replay 测试的调度预算或隔离策略，恢复根 `pnpm test` 可重复通过。
3. 定位 pnpm deploy `EPERM`，让 unsigned portable + installer 可从干净检出生成，并使 `selftest:phase3` 自包含前置产物或显式 preflight。
4. 修正文档漂移与 `TD-034` 编码损坏，再复跑 test/typecheck/build/lint/selftest:phase3。
5. 本地门禁全绿后，再进入证书、私有 feed、真实图片凭证和邀请用户闭测。

### 工作树与清理

- 本轮失败 staging 生成的 `apps/desktop/release` 已按受控路径删除；被生成命令改写的 `icon.png` / `icon.ico` 已恢复为 `5cc35a1` 版本。
- 未修改业务代码；本状态快照是本轮唯一计划保留的工作树改动。

## 当前状态：2026-08-03 · Phase 3 与自动 binary rollback 本地收口

### 已完成

- **自动 binary rollback**：Desktop 已完成 rollback recovery store、coordinator、watchdog、updater 与启动接线；recovery root 统一为 `%LOCALAPPDATA%\sync-think-updater\recovery`，NSIS 会把当前版本 installer 自归档到 `installers\<version>\installer.exe`。
- **Rollback 验证**：Desktop 127 files / 849 tests、Desktop typecheck/build、PowerShell 5.1 watchdog healthy/attempt-fence 真实 smoke，以及 `unsigned-fixture` NSIS installer 真实编译均通过。正式签名 installer 的真实 rollback E2E 仍等待外部发布证据。
- **Windows 发布与更新**：portable/installer 定向测试共 22 项通过；Generic feed 9 项单元测试及真实 Electron HTTPS 8 场景通过。正式 release 对 Authenticode signer、完整 publisher DN、独立 signer SHA-1 pin 与 RFC 3161 timestamp 保持 fail-closed；unsigned fixture 必须显式启用。
- **差分真实安装**：正式入口 `pnpm test:update-install:win` 已通过隔离 unsigned fixture 的 `0.0.1 → 0.0.2` `quitAndInstall`。证据位于 `.data/update-install-e2e-20260802T174113/smoke-result.json`：2 次 blockmap 请求、7 次 Range 请求、7 次 HTTP 206；完整 installer `135491101` bytes，实际传输 `504941` bytes，节省 `134986160` bytes，未出现完整 HTTP 200 回退；Runtime、install identity、secret handle、metadata、ciphertext 与 SQLite 连续性均通过。
- **Database Governance P0.4**：sidecar/backfill/recovery/rollback/GC、Event retention/archive、incremental vacuum 与 offline `VACUUM INTO` compaction 已完成；定向门禁 5 files / 51 tests。治理执行器未接 Runtime startup，所有写入验收仅使用临时 fixture。
- **Phase 3 聚合门禁**：`pnpm selftest:phase3` 通过 Desktop contracts 12 files / 87 tests、release/visual contracts 33 tests、Desktop typecheck/build、unsigned portable/installer fixture prepare、Generic feed Electron E2E、image provider build、无凭证时显式 skipped 的 live image acceptance，以及 Electron `capturePage()` 7-case 视觉矩阵。结构化结果为 `passed-with-external-evidence-pending`，视觉证据位于 `.data/phase3-visual/current`。
- **根仓最终门禁**：`pnpm test` 20/20 Turbo tasks、`pnpm typecheck` 20/20、`pnpm build` 11/11、`pnpm lint` 11/11 与 `git diff --check` 全部通过。Desktop 最新全量计数为 127 files / 849 tests；本轮全仓日志位于 `.data/prepush-gates-20260803-083215`。
- **测试接线修复**：Diagnostics export wiring 断言改为格式无关正则，避免 Prettier 换行导致假失败；Generic feed E2E 为所有场景生成并显式传入最小有效 gzip blockmap，与生产 fail-closed 语义一致。

### 当前人工测试实例

- **隔离目录**：`D:\projects\SYNC-THINK\.data\manual-phase3-20260802-015614`
- **进程**：launcher PID `102824`；Electron PID `9296`；managed Runtime PID `50712`（Node `20.20.2`）。
- **运行状态**：`SYNC-THINK` 窗口可见、`Responding=True`；日志已出现 `pipe ready`、`database ready`、`hello accepted`，stderr 为空。
- **隔离数据**：数据库 `D:\projects\SYNC-THINK\.data\manual-phase3-20260802-015614\sync-think.db`；配置的 secure key 路径为 `D:\projects\SYNC-THINK\.data\manual-phase3-20260802-015614\secure.key`。当前使用 Windows DPAPI，且该空白测试身份尚未写入 Provider secret，因此不会生成 legacy `secure.key` 文件。
- **日志**：`desktop.stdout.log` 与 `desktop.stderr.log` 均位于上述隔离目录。
- **真实数据边界**：默认数据库 `D:\projects\SYNC-THINK\.data\SYNC-THINK\sync-think.db` 在启动前后均为 `16873340928` bytes，UTC 修改时间保持 `2026-08-02T13:22:54.0208111Z`，未被触碰。

### 尚待外部条件或独立后续范围

1. 正式 Authenticode 发布证书与真实 RFC 3161 timestamp provider。
2. 使用正式签名 installer 完成一次真实 `0.0.1 → 0.0.2` 安装升级与自动 rollback E2E。
3. 在真实 private origin/CDN 完成授权、cohort/rollout、cache invalidation 与撤回演练。
4. 使用真实图片 Provider 凭证完成生成、预览、Reviewer、返工与重启恢复人工验收。
5. 组织 5–20 位邀请用户 Windows 闭测并收集反馈。
6. 自动 binary rollback 的本地实现、NSIS unsigned fixture 编译与 watchdog smoke 已完成；正式签名 installer 的真实 rollback E2E 仍属于外部证据。

### 工作树

- 分支：`feature/newmax-shell-rewrite`。
- 累计修改仍在同一工作树中，未执行 reset、clean、覆盖式 checkout 或全仓格式化。
- 累计改动纳入当前分支提交治理；具体提交与推送状态以 Git 记录为准。

## Image P0.3 checkpoint（2026-08-01）

- 第二切片已实现：同批图片候选归组、多版本摘要投影、并列画廊、durable 选择链路复用。
- 定向测试：Runtime production executor、Storage artifact/orchestration、UI ArtifactVersionsPanel、Desktop preview wiring 均通过。
- 下一步：完成全量门禁与独立数据库桌面手测；随后进入 Image P0.3 下一切片（候选生成入口与真实 Provider 端到端验收增强）。

## Agent Thread / Context Epoch / Provider Cache 与 Token Usage（2026-08-01）

- Scheduler 为每个任务中的执行 workstream 建立稳定 AgentContextThread；同一 Step retry 复用线程，Reviewer 按 target Step + reviewer AgentVersion 隔离，rework 复用目标执行线程，不把其他 Agent transcript 混入。
- Production Executor 根据 provider/model/context window 在 AgentContextThread 下获取或创建 ContextEpoch；模型边界变化形成可追踪 epoch，Provider prompt cache key 绑定 provider/model/thread/epoch。
- OpenAI/Anthropic Adapter 统一投影 tokensIn、tokensOut、cache hit、cache write、reasoning 与 total tokens；Runtime 以 request/thread/epoch/purpose 持久汇总，缓存正文仍只存在 Provider 侧。
- Review reject 只把结构化 ReviewDecision 传给 rework prompt，不依赖完整 Reviewer transcript；Artifact parent lineage 与 Agent Thread 分别表达产物血缘和执行上下文。
- 已补齐 storage migration/store、adapter usage/cache、scheduler thread 复用和 production executor usage lineage 测试。

---

## 本轮进度（2026-08-02 · 16.87GB 默认数据库启动 OOM 收尾）

- **当时分支状态**：`feature/newmax-shell-rewrite`，保留全部前序未提交改动；该记录对应 2026-08-02 的历史检查点。
- **根因链已闭环**：默认开发数据库 `.data/SYNC-THINK/sync-think.db` 为 16,873,283,584 bytes，约 1,986,934 条 Event。此前启动依次暴露三个大库阻塞点：
  1. 启动迁移在无实际 schema 变化时仍复制整库备份；
  2. Task version 修复路径全量扫描 Event；
  3. 未完成对话恢复与手动压缩通过 `resolveLatestCompactBoundary()` 调用 `listAllEvents(0)`，把全局 Event 与 `payload_json` 物化进 V8 堆并触发 OOM。
- **本轮实现**：
  - `SqliteEventCheckpointStore.listEventsByTask(taskId)` 显式通过 `event_task_idx` 按 `sequence, id` 读取单个 Task 的 durable Event。
  - `RuntimeStateStore` 暴露可选 Task-scoped 查询能力；生产 SQLite store 走索引路径，legacy/test store 保留全局回退。
  - 上下文状态恢复和 `conversation.compact` 均优先读取当前 Task，不再物化约 198 万条全局 Event。
  - Storage 测试覆盖跨 Task 隔离、全局 telemetry 排除、空结果及 `EXPLAIN QUERY PLAN` 使用 `event_task_idx`；Runtime 集成测试把 `listAllEvents` 替换为抛错并验证状态读取与压缩仍成功。
- **真实默认数据库启动验证**：
  - 日志目录：`.data/manual-task-indexed-context-20260802-160502`。
  - 2026-08-02 16:05:02 启动，日志于 16:05:07 前写出 `pipe ready`、`database ready`、`hello accepted`，启动链路在约 5 秒内完成。
  - SYNC-THINK 主窗口已加载任务列表、已有对话入口与聊天工作台；Electron 主进程 `Responding=True`。
  - Runtime PID 41120 在 35 秒稳定采样中工作集 131.5MB → 131.9MB、Private 143.2MB → 143.4MB，没有持续堆增长。
  - 日志未出现 `ETIMEDOUT`、pipe timeout、heap limit、OOM、exit code 134。
  - migration 备份数启动前后均为 76，未再次复制 16.87GB 数据库。
- **自动验证（本轮修复后的最近结果）**：Runtime 62 files / 423 tests；Storage 相关 4 files / 91 tests；Desktop Runtime 管理 2 files / 8 tests；Storage/Runtime/Desktop typecheck；`pnpm build` 11/11；`git diff --check` 均通过。
- **待用户人工测试**：打开已有任务和历史消息、恢复之前未完成的 Computer Use 对话、新建普通对话发送消息、在长对话触发上下文压缩，并持续观察 Runtime 没有卡死或内存陡增。
- **当时下一步建议**：人工路径通过后，继续当前路线图中 Desktop/Browser durable waiting、审批与恢复链路的剩余 UI/集成收口。

## 本轮进度：2026-08-02 · Runtime Event payload allowlist 外置写入完成

- **默认行为**：Runtime sidecar 默认关闭；未显式启用时 Event payload 继续内联，现有数据库行为不变。
- **白名单与阈值**：仅 `context.packet.built` 可外置，默认阈值为序列化后 UTF-8 64 KiB；查询投影固定复用 Storage builder `context-packet-query-v1@1`。
- **身份隔离**：默认 sidecar root 同时绑定解析后的 database path 与 install ID；可通过受控配置显式覆盖根目录。
- **恢复与故障语义**：重启后自动 hydrate；missing/corrupt blob 在 Runtime 打开阶段 fail-closed；历史内联记录和无关 orphan blob 不迁移、不删除。
- **启动边界**：Runtime startup 不运行 backfill、rollback、GC、quarantine、retention 或 VACUUM。
- **验证结果**：Persistence 2 files / 10 tests、Runtime 全量 63 files / 436 tests、Runtime typecheck/lint 通过；根级 typecheck/build 与隔离 Desktop 重启紧随本记录执行。
- **下一任务**：实现 fixture-only 的 exact retention/archive manifest、portable archive/recovery set、durable executor、cancel/resume 与 rollback。

## 当前状态：2026-08-04 · Run 恢复与 Prompt Cache 收口

- 历史对话 Run 的冷启动恢复已增加 5 分钟活动 TTL。超龄 Run 写入 `run.paused/recovery_expired` 并移出执行投影，审计历史保留，Provider 外呼保持为 0。
- Provider fallback 增加 Run 级连续失败计数：同一 Provider 第二次端点级失败后熔断剩余同源模型，避免按每个模型各等待 120 秒。
- 任务对话、工作流 Step、OpenAI Responses、OpenAI Chat 与 Anthropic Messages 的 Provider-managed Prompt Cache 已统一接线；缓存正文不进入 SQLite。
- GPT-5.6+ 使用稳定 key 与 `prompt_cache_options { mode: implicit, ttl: 30m }`，但不发送已确认会使当前中转站返回 502 的内容级 `prompt_cache_breakpoint`；旧 OpenAI 模型继续使用稳定 key，并只在兼容型号上发送 retention；Anthropic 使用原生 ephemeral cache control。
- 缓存读写 usage 均进入现有 `provider.usage` 投影；实际命中量仍由 Provider 返回，低于最小前缀或不支持缓存的中转实现会返回 0。
- 请求体对照确认：同一 `gpt-5.6-sol` 的 baseline、key-only、key+options、developer-no-breakpoint 均为 HTTP 200；只有加入 `prompt_cache_breakpoint` 时返回 HTTP 502。Force-final 现保留 system/tools，只发送 `tool_choice: none`。
- 本地源码实例验证通过：Electron PID 18264、Runtime PID 2744、Pipe 健康、窗口响应、stderr 为空。`gpt-5.6-sol` 第三轮命中 8704/8932 输入 tokens；`gpt-5.5` 两轮各命中 3584 tokens；`usage.summary` 近一天聚合显示总命中 15872 tokens，并正确显示两个模型与 `KMKAPI-CODEX`。
- 验证通过：Adapters 8 files / 79 tests、Core 17 files / 180 tests、Runtime 5 files / 49 tests、Desktop chat-stream 1 file / 6 tests；Adapters/Core/Runtime/Desktop 类型检查通过，Adapters/Core/Runtime/Desktop 构建通过，Prettier 与 `git diff --check` 通过。本轮未生成安装包。
- 最新闭环补测使用独立 `gpt-5.6-luna` 对话：联网 tools 形态前两轮均为 0；切换到固定无联网 tools 后首轮预热为 0，随后两轮分别读取 `2560/3102` 与 `2560/3141` 输入 Token，约 82% 命中。中转两轮都上报 `cache_write_tokens=0`，因此 UI 继续显示真实创建量 0，并以读取量/命中率作为主要健康指标。
- 使用统计 UI 已改为模型/供应商合并列、四类 Token 常显、命中率摘要与逐行费用展开；1424x861、1024x720 以及浅深主题均完成实窗检查。下一步只需完成最终全量门禁和本地源码重启，不生成安装包。

## 当前状态：2026-08-04 23:19 +08:00 · 使用统计卡死修复已重启待手测

### 当前结论

- 原错误 `Runtime request timed out: runtime.healthcheck` 已定位并修复。问题不是 Runtime 未启动，而是 16.87GB SQLite 上的同步使用统计 SQL 阻塞了 Runtime Pipe 事件循环。
- 统计扫描已从 Runtime 主线程移入只读 Worker，并增加持久增量 sidecar。首次缓存构建完成后，统计页不再重复扫描约 198 万条 Event。
- 当前本地源码实例已从最新强制构建产物重启；未生成 installer、portable 或 release artifact，未提交、未推送。

### 实现与性能

- 数据库：`.data/SYNC-THINK/sync-think.db`，16,873,340,928 bytes，约 1,986,942 条 Event。
- 缓存：`.data/SYNC-THINK/usage-summary-cache-v1.json`，615,785 bytes；high-water rowid 为 1,986,942。
- 首次真实只读扫描约 111,259 ms，主线程心跳持续 11 次；SQLite 文件大小和修改时间在扫描前后保持不变。
- sidecar 增量读取约 216 ms；重启后的真实全量 `usage.summary` 为 182 ms，同时发出的 `runtime.healthcheck` 为 1 ms。
- 全量统计返回 6 个模型、91 个请求、16 类工具和 37 条工具失败；近 7 天没有 `provider.usage` 记录，因此该范围返回 0 属于当前数据事实。

### 验证与运行实例

- Runtime：67 files / 447 tests passed。
- Desktop：129 files / 855 tests passed。
- Runtime / Desktop typecheck passed。
- `pnpm exec turbo run build --force`：11/11 successful，0 cached。
- 当前 Electron PID：11048；Runtime PID：97648；独立 Pipe probe 返回 `ok: true`。
- 日志目录：`.data/restart-usage-summary-fix-20260804-231913`；stdout 已包含 `pipe ready`、`database ready`、`hello accepted`，stderr 为空。

### 用户手测

1. 打开“设置 → 模型 → 使用统计”。
2. 依次切换“24 小时、7 天、30 天、全部”。
3. “全部”应快速显示已有历史统计；24 小时和 7 天可能为空，这是当前数据库时间范围内没有使用记录。
4. 重复关闭并打开统计页，页面应持续快速响应，主界面和其他对话操作不应被卡住。
5. 不应再出现 `runtime.healthcheck` timeout；如仍有异常，保留当前窗口并检查上述重启日志目录。

## 当前状态：2026-08-04 23:57 +08:00 · Browser / Computer Use 调用修复已重启待手测

### 当前结论

- “打开 4399”与 Computer Use 指令不执行的共同根因已经修复。故障发生在 Provider 请求前：多行、引号或多模态消息经过 JSON 序列化后，Context Snapshot 的来源校验无法再匹配原始文本，于是误报 `included source is absent from provider payload`。
- 消息来源现在按结构化内容匹配；上下文一致性错误固定归类为 `protocol`，不再触发模型 fallback 风暴。
- Computer Use 开启后，即使没有项目目录与 Agent tools，Context Status 也会正确包含 Desktop tool schemas。
- 此次修复保留了上一轮使用统计 Worker、增量 sidecar 与 `usage.summary` 300 秒专用预算，没有回退到 Runtime 主线程同步扫描。

### 自动验证

- Runtime 定向测试：6 files / 29 tests passed，覆盖 Context Snapshot、Browser Host、Computer Use、Context Status 与使用统计异步缓存。
- Desktop 定向测试：1 file / 1 test passed，确认仅 `usage.summary` 使用 300 秒预算，普通 `runtime.healthcheck` 仍为 5 秒。
- Runtime / Desktop typecheck passed。
- 目标文件 Prettier 与 `git diff --check` passed。
- `pnpm exec turbo run build --force`：11/11 successful，0 cached。
- 独立 `node scripts/pipe-client.mjs` 返回 `PIPE_SMOKE_OK`，实时 `runtime.healthcheck` 返回 `ok: true`。

### 当前运行实例

- Electron PID：`41004`；Runtime PID：`4444`；两者均处于 Responding 状态。
- 日志目录：`.data/restart-browser-computer-use-fix-20260804-235706`。
- stdout 已包含 `pipe ready`、`database ready`、`hello accepted`；stderr 为空。
- 当前工作树保留本轮与使用统计修复，未提交、未推送；未生成 installer、portable 或 release artifact。

### 用户手测

1. 在对话中开启“联网”，发送：
   ```text
   打开 https://www.4399.com/
   ```
   预期：出现 `browser_open` requested/completed，并打开可见 Browser 页面。
2. 在设置中开启 Computer Use，把当前对话权限设为“完全访问”，发送一个窗口枚举或读取任务。
   预期：执行 `desktop_list_windows`；普通已解析的显示/读取动作不额外审批，敏感或 human-only 动作仍按动作策略进入审批。
3. 再使用带换行、中文引号和英文双引号的 Computer Use 指令。
   预期：不再出现 `included source is absent from provider payload`，Desktop 工具链继续执行。
4. 打开“设置 → 模型 → 使用统计”并切换时间范围。
   预期：页面保持响应，不再出现 `runtime.healthcheck` timeout。

## 当前状态：2026-08-04 · Browser 完全访问与思考耗时已完成实机验证

### 当前结论

- Browser 在“完全访问”对话中不再停在审批等待态。策略需要审批时，Runtime 会自动创建仅当前 Run 有效的 origin grant，不发布审批弹窗事件；非完全访问模式仍按原策略处理。
- Browser 与 Computer Use 都已从 SYNC-THINK 对话界面真实调用成功，不只是单元测试或模拟 Host。
- “正在思考与执行”现在每秒显示已用时间，Run 完成后切换为“思考与执行过程”并冻结最终耗时。
- 最新强制构建产物已经启动，当前实例保持运行供人工测试；未提交、未推送，也未生成发布产物。

### 实机证据

- Browser Run：`9R7WZ6Z1ZGFSV21SDWWB7034MT`。
  - 指令：打开 `https://www.4399.com/`。
  - Microsoft Edge 成功显示 4399 首页。
  - Event 顺序为 `browser.command.started`、`tool.completed`、`run.completed`。
  - `approval_request` 为空，没有 `tool.approval_requested`。
  - SQLite 已持久化 `auto-full-access:9R7WZ6Z1ZGFSV21SDWWB7034MT:call_2SchiiUIwRcaKOHWY06vwYyB` 对应的 Run-scoped grant。
  - 完成态耗时冻结为 `00:10`。
- Computer Use Run：`0D1M07ZM5G32528DA1VS91FGMD`。
  - 指令：列出当前可见窗口并返回 SYNC-THINK 标题。
  - `desktop_list_windows` 真实执行并返回标题 `SYNC-THINK`。
  - Event 顺序为 `desktop.command.started`、`tool.completed`、`run.completed`，审批记录为空。
  - 完成态耗时冻结为 `00:09`。

### 自动验证与运行实例

- Runtime：4 files / 24 tests passed。
- Desktop：4 files / 21 tests passed。
- Runtime / Desktop typecheck passed。
- `pnpm exec turbo run build --force`：11/11 successful，0 cached。
- `pnpm selftest:browser-handoff`：continue、cancel-close-page、cancel-keep-open 全部通过。
- `pnpm selftest:desktop-handoff`：continue、cancel 全部通过。
- 当前开发 session：`83655`；Runtime PID：`61144`；Electron PID：`61212`；窗口标题：`SYNC-THINK`。
- Pipe：`\\.\pipe\sync-think-dev-0001`；数据库：`D:\projects\SYNC-THINK\.data\SYNC-THINK\sync-think.db`。

### 用户手测

1. 把当前对话权限设为“完全访问”，开启 Browser 后发送：
   ```text
   打开 https://www.4399.com/
   ```
   预期：直接打开网页，不出现 Browser 审批弹窗。
2. 开启 Computer Use 后发送：
   ```text
   列出当前可见窗口并告诉我 SYNC-THINK 窗口的标题
   ```
   预期：返回 `SYNC-THINK`，不额外等待审批。
3. 观察运行中的“正在思考与执行 · MM:SS”每秒增长；完成后应变为“思考与执行过程 · MM:SS”，且时间停止增长。

## 当前状态：2026-08-05 19:35 +08:00 · Browser Automation Studio P1.2 代码收口

### 当前结论

- P1.2 语义录制主链已完成：专用系统浏览器、Runtime Profile 独占、durable intent/步骤、实时脱敏步骤流、停止资源清理和冷启动中断恢复均已接线。
- Renderer 只展示“登录状态 / 录制”，未实现的自动化任务不出现；start pending 与未知对账结果保持全局 Profile 锁，异常终态显示具体原因并清理过期成功提示。
- 安全边界固定为单 Page 主 Frame、`navigate/click/fill/select/check/Enter`、200 步和 16 KiB 单步；URL 去除 userinfo/query/hash，敏感输入用秘密占位，binding 使用随机 capture token 和 trusted event。
- 质量审查已修复两个 Runtime 错误路径：lease 获取失败不关闭无关 Profile session；stop 失败不产生 unhandled rejection，并可重试。

### 当前验证

- Storage 定向 `3 files / 73 tests`；Workers BrowserHost `33/33`；Runtime Recording Service `7/7`；Desktop BrowserStage/payload/timeout/wiring `4 files / 38 tests`。
- Workers、Runtime、Desktop typecheck 与 lint 通过；Desktop design token 检查通过；相关文件 Prettier 和 `git diff --check` 通过。
- 包级全量、根级最终门禁、强制 build 和最新源码实窗录制尚待执行；未生成 installer、portable 或 release artifact，未提交、未推送。

### 下一步

1. 运行 Storage、Workers、Runtime、Desktop 包级全量，再运行根级 typecheck、lint、token lint 与强制 build。
2. 重启本地源码 Electron/Runtime，使用真实 Edge 录制 `navigate/click/fill/select/check/Enter`，确认 URL/敏感值脱敏、Page 关闭中断和停止后 Profile 立即可维护。
3. P1.3：把录制草稿冻结为 WorkflowVersion，实现变量/秘密引用、编辑、确定性回放、失败定位和登录 handoff。

## 当前状态：2026-08-05 21:00 +08:00 · Browser Automation Studio P1.2 最终实窗收口

### 当前结论

- P1.2 已完成自动门禁与真实 Edge 闭环。刷新登录状态后 Profile 不再被本次维护锁错误标记为“使用中”，刷新、站点清除、再次录制和删除会按真实占用状态立即恢复。
- 文本输入在 Enter 前仍会排空 debounce，但随后触发的 change 只处理尚未排空的输入，不再产生重复 fill；因此 Enter 后导航可稳定折叠进同一 press 步骤。
- trusted event 边界保持不变。真实 select 验收通过键盘事件完成；脚本直接派发的非 trusted change 继续被拒绝。

### 最终验证

- Storage 基线 `36 files / 384 tests`、Workers `15 files / 124 passed / 3 skipped`、Runtime `74 files / 477 tests`、Desktop `133 files / 897 tests` 全部通过；本轮新增定向为 Profile Service `8/8`、BrowserHost `35/35`。
- 根 `pnpm test --force --concurrency=1` 为 20/20 Turbo tasks、0 cached，最终源码在受控串行资源下全绿。
- 根 `pnpm typecheck --force` 为 20/20、`pnpm lint --force` 为 11/11、design tokens 通过、`pnpm exec turbo run build --force` 为 11/11 且 0 cached；目标文件 Prettier 与 `git diff --check` 通过。
- Pipe probe 返回 `PIPE_SMOKE_OK`，Runtime healthcheck 为 `ok: true`，没有 in-flight Run。

### 真实 Edge 证据

- 隔离目录：`.data/local-restart-20260805-204946-browser-recording-final`；Electron PID `3452`、Runtime PID `33812`、CDP `127.0.0.1:9336`，窗口保持运行供手测。
- 正常录制得到 10 个 durable 步骤，覆盖 `navigate/fill/select/check/click/press`；立即停止在 528 ms 内完成并保留最后一次 fill。Enter 输入仅一条，结果 URL 已折叠进 press。
- 刷新登录状态后站点清除按钮立即可用；清除完成后可再次录制。关闭系统 Edge Page 后终态为 `interrupted/page_closed`，随后 Profile 完整删除。
- SQLite 活动录制为 0、站点摘要为 0，测试密码、敏感富文本、URL userinfo/query/hash 均无明文命中；删除 Profile 的目录、CDP metadata 与 Edge 进程均已清理。
- 三张 1424x861 截图已目视复核，无重叠、截断或页面级溢出；DOM 指标为 `scrollWidth=clientWidth=1424`、`scrollHeight=clientHeight=861`。
- 未生成 installer、portable 或 release artifact，未提交、未推送。

### 下一步

1. P1.3：把确认后的录制草稿冻结为 WorkflowVersion，增加固定值/运行变量/秘密引用、编辑和确定性回放。
2. P1.4/P1.5 继续负责运行历史、失败定位、登录 handoff 与手动启停定时任务；P1.2 草稿本身仍不可调度执行。

## 当前状态：2026-08-05 22:46 +08:00 · Browser Automation Studio P1.3 第一切片最终构建与重启

### 当前结论

- Browser 页默认视图已切换为“自动化任务”，支持手动/AI 创建 Task Draft、进入录制工作区、提交审核、驳回重录和批准发布不可变 `WorkflowVersion`。
- 自动化生命周期真源为 SQLite 的 Task/Draft/Review/Version；批准后的版本不可更新或删除。当前版本冻结的是脱敏语义步骤，尚未接入确定性执行器。
- BrowserHost 已改为 Chrome 优先、Edge 回退；录制页面右下角提供“录制中”浮层、时长、步骤数和“结束录制”按钮。
- 对话模型可以查询真实自动化任务并创建 AI 来源 Draft。`ask` 模式的创建工具需要普通审批，`workspace/full-access` 可直接创建 Draft；发布仍必须由用户在任务页显式批准。

### 当前验证

- 定向验证：Runtime 3 files / 67 tests、Desktop 3 files / 43 tests，Runtime/Desktop typecheck 均通过。
- 包级全量：Storage 36 files / 387 tests；Workers 15 files / 124 passed / 3 skipped；Runtime 76 files / 490 tests；Desktop 135 files / 915 tests。
- 根级门禁：typecheck 20/20、lint 11/11、design tokens、强制 build 11/11（0 cached）和 `git diff --check` 均通过。
- 最新源码已使用隔离目录 `.data/local-restart-20260805-224600-browser-workflow-p13` 重启：Electron PID `8144`、managed Runtime PID `102992`（Node `20.20.2`），窗口可见且 Responding；pipe/database/hello 与独立 `runtime.healthcheck` 均正常，stderr 为空。
- 未生成 installer、portable 或 release artifact；未提交、未推送。

### 后续范围

1. P1.3 后续：步骤编辑、固定值/运行变量/秘密引用绑定，以及已发布 WorkflowVersion 的确定性回放。
2. P1.4：运行历史、逐步日志/截图、失败定位与登录 handoff。
3. P1.5：手动启停的定时任务；条件、循环与 AI 自修复继续留在 P2。

## 当前状态：2026-08-06 09:10 +08:00 · 已拉取远端 P1.3 第一切片并完成实现核查

### 同步事实

- 当前分支 `feature/newmax-shell-rewrite` 已从 `09b02ad` fast-forward 到远端最新 `5239407`（`feat: browser workflow feature and recording hardening`），与 `origin/feature/newmax-shell-rewrite` 的 ahead/behind 为 `0/0`；拉取后工作树干净。
- 本次远端增量涉及 43 个文件，约 `+5476/-139`。主体是 Browser Workflow Task/Draft/Review/Version、Desktop 任务页、聊天工具、录制加固和迁移 `0038_browser_automation_workflow`。

### 当前完成边界

- P1.1 Profile/脱敏登录状态管理和 P1.2 语义录制保持完成；P1.3 只完成第一切片，不是完整自动化闭环。
- 已实现 Task → Draft → Review → immutable WorkflowVersion 生命周期；录制必须已停止、至少一步且 Profile 匹配才能提交。批准会冻结脱敏步骤，SQLite trigger 禁止修改或删除已发布版本。
- Desktop Browser 默认进入“自动化任务”，支持创建任务、绑定录制、提交审核、驳回重录、批准发布和查看 V1；对话工具支持 list/get/create AI Draft，但不暴露审核或发布能力。
- BrowserHost 使用显式 executable → Chrome → Edge 的发现顺序，并在录制页显示计时、步骤数和停止浮层。

### 尚未完成

1. P1.3 后半段：步骤编辑、固定值、运行变量、秘密引用绑定，以及已发布 WorkflowVersion 的确定性执行/回放。当前“已发布”仅表示审核后冻结，不能运行。
2. 现有公开 API 只能创建新 Task + Draft，没有为既有 Task 创建下一版 Draft 的入口；版本号递增逻辑存在，但产品路径目前只能到 V1。
3. P1.4 的运行历史、逐步日志/截图、失败定位、登录 handoff，以及 P1.5 的手动启停定时任务均未开始；条件、循环和 AI 自修复仍在 P2。

### 核查发现的风险与偏差

1. **P0**：`packages/storage/src/production-execution-store.ts:624` 的 `isLocalContentRef()` artifact URI 白名单正则混入 `function mapProviderRow(...)` 文本，导致白名单被意外放宽。继续发布或扩展执行链前应先修复并补 malformed contentRef 回归测试。
2. **P1**：Profile 删除采用 soft delete，但已有 Workflow Task 仍引用该 Profile；任务会从按活动 Profile 过滤的 Desktop 入口消失，且当前没有阻止删除、重绑或归档恢复策略。
3. **P1**：任务页“让 AI 创建”按钮只是打开同一人工表单并写入 `source=ai`，不会调用模型；真正的 AI Draft 创建仅存在于聊天工具，UI 文案和行为需要统一。
4. **P1**：Review note 会写入 SQLite，但 get API 不返回审核历史，驳回备注之后无法查看；聊天工具把 query 描述成支持 URL 搜索，Storage 实际只搜索 name/instruction。
5. 当前证据覆盖单元/组件/接线测试、构建和源码健康启动，但没有记录一次真实 Chrome/Edge 的 Task → 录制 → 提交 → 驳回/批准 → SQLite 复核的 P1.3 端到端实窗验收。

### 验证与运行状态

- 提交 `5239407` 记录的验证为 8 个包共 2479 tests、根 build 11/11；状态文档另记录 Storage 387、Workers 124 passed/3 skipped、Runtime 490、Desktop 915，以及 typecheck 20/20、lint 11/11。本次没有重新运行包级/根级全量门禁。
- 本次定向复跑通过：Storage browser-store `15/15`、Workers BrowserHost `36/36`、Runtime 3 files / `61/61`、Desktop workflow payload/wiring/BrowserStage 3 files / `49/49`。首次直接运行 Runtime 定向测试时，拉取前遗留的旧 `storage/dist` 缺少新方法并导致 4 项失败；按 Turbo 依赖图先执行 `pnpm exec turbo run build --filter=@sync-think/storage`（shared/storage 2/2）后全部通过，说明后续测试应从声明的 task graph 入口运行。
- 上一轮隔离实例的 Electron PID `8144`、Runtime PID `102992` 当前均已退出；当前没有可用于继续手测的最新源码实例。
- 本次没有生成 installer、portable 或 release artifact，也没有修改业务代码。

### 建议继续顺序

1. 先修复 P0 contentRef 正则并补边界测试。
2. 收敛 P1.3 第一切片的产品生命周期：Profile 删除策略、既有任务新 Draft/V2 路径、审核历史、搜索合同和 AI 创建入口。
3. 完成步骤编辑、值绑定和确定性回放，并补真实 Chrome/Edge 端到端实窗验收；之后再进入 P1.4/P1.5。

## 当前状态：2026-08-06 10:04 +08:00 · Browser Automation Studio P1.3 生命周期收口进行中

### 已完成代码

- P0 contentRef 已统一为共享严格合同，Artifact/Production Execution 不再接受空格、花括号 artifact URI 或远程 `file://`。
- Profile 有任何自动化 Task 引用时，Runtime 与 Storage 双层阻止删除并返回稳定错误；Desktop 会关闭确认框并显示保留原因。
- 新增已发布 Task 的 V2 Draft API/IPC/UI：V1 在 V2 编辑和待审期间继续作为 `publishedVersionId`，V2 批准后才切换。
- Workflow get 返回最近 100 条审核历史与截断标记；搜索覆盖任务名称、目标和网址。Desktop 显示审核备注，V2 待审优先显示当前 Draft 步骤，任务标题保持进入详情。

### 当前验证

- 定向：Storage `3 files / 42 tests`、Runtime Workflow/Profile/validation `3 files / 15 tests`、Runtime chat tools `55/55`、Desktop `3 files / 54 tests`。
- 包级：Storage `36 files / 389 tests`、Runtime `76 files / 493 tests`、Desktop `135 files / 926 tests`，全部使用单包单 worker 通过。
- Storage、Runtime、Desktop typecheck 通过；共享 Protocol/Storage/Workers 依赖产物已按 Turbo task graph 强制重建。
- 根级 lint、design token、强制 build、Prettier/diff 最终复核和尚未启动的真实 Chrome/Edge 验收仍是当前任务，不生成 installer。

### 明确边界

1. 当前发布版本仍不能执行；步骤编辑、固定值/运行变量/秘密引用与确定性回放继续属于 P1.3 后续。
2. Task 重绑/归档未实现，因此有关联任务的 Profile 当前必须保留。
3. “让 AI 创建”入口按 Locked 设计保留；模型驱动创建当前由聊天工具完成，任务页入口仍只建立 AI 来源 Draft。

## 当前状态：2026-08-06 10:36 +08:00 · 远端同步与 P1.3 进度复核

### 同步结果

- 已执行 `git fetch --prune origin` 和 `git pull --ff-only origin feature/newmax-shell-rewrite`；远端与本地 HEAD 均为 `5239407ecf6630ebbcf3fb533098ea04ccc5f38f`，ahead/behind 为 `0/0`，拉取结果为 `Already up to date`。
- 当前工作树保留 P1.3 生命周期收口改动：30 个已修改文件、1 个未跟踪文件，tracked diff 约 `+1116/-195`。未跟踪的 `packages/storage/src/local-content-ref.ts` 是当前构建依赖，提交时必须一并纳入。

### 当前完成边界

- 远端 `5239407` 已交付 P1.3 第一切片：Task、Draft、Review、不可变 WorkflowVersion、V1 审核发布，以及 Desktop/Chat 查询和创建 Draft 的入口。
- 当前未提交改动进一步补齐严格 contentRef 合同、Profile 自动化任务引用保护、V1 到 V2 Draft 生命周期、最近 100 条审核历史、URL 搜索与 Desktop V2 审核展示。
- V2 编辑和待审期间继续保留旧 `publishedVersionId`；批准后才创建递增版本并切换指针。模型工具仍不具备审核或发布权限。

### 本次验证

- `pnpm exec turbo run test --force --concurrency=1`：20/20 Turbo tasks、0 cached，耗时 3 分 24 秒；Storage 389、Runtime 493、Desktop 926 等既有包级计数保持通过。
- `pnpm exec turbo run typecheck --force`：20/20、0 cached；`pnpm exec turbo run build --force`：11/11、0 cached；`pnpm exec turbo run lint --force --continue`：11/11、0 cached。
- `pnpm lint:tokens` 与 `git diff --check` 通过。Prettier 仅报告 `docs/product/06-roadmap.md` 的新增内容尚未格式化，本次状态分析未修改该文件。
- 本次未安装依赖、未启动或重启产品实例、未生成 installer/portable/release artifact，也未提交或推送工作树。

### 本地 Edge 实窗验收

- 隔离实例 `.data/local-restart-20260806-101617-browser-workflow-v2` 正在运行，默认 Profile 的 Edge 143 CDP `127.0.0.1:50781` 可通过 `/json/version` 读取，Protocol 为 1.3。
- `P13 V2 生命周期闭测` 已完成 V1 批准、V2 首次录制驳回、同一 V2 Draft 重录后批准。SQLite 保留 V1/V2 两条不可变 Version，最终 Task 为 `enabled`、`published_version_id` 指向 V2；3 次录制均为 `stopped/user`，各自 `step_count=stored_steps=3`。
- Review 顺序为 V1 批准、V2 驳回、V2 批准。截图 `acceptance/02-v2-rejected-detail.png` 显示驳回时旧 V1 仍发布，`acceptance/03-v2-approved-detail.png` 显示最终切换 V2；界面未发现明显遮挡或文本溢出。
- 非默认 Profile `关联保护闭测` 仍有 Task 引用且 `deleted_at IS NULL`。Desktop stderr 记录删除请求稳定返回 `browser.profile-has-workflows`，证明 Host 数据目录删除前的保护已触发；除此之外未见应用异常。

### 剩余工作与风险

1. 把已经通过的 V2 驳回、旧 V1 指针保持、重录再批准实窗路径固化成自动化回归；补超过 100 条 Review 的截断、排序和同时间 tie-break 测试，并处理 Roadmap 的 Prettier 差异。
2. 评估任务列表逐项调用 `getWorkflow` 带来的 N+1 IPC/SQL；明确误建 V2 Draft 的取消/丢弃、任务归档/删除和 Profile 重绑策略。当前公开 API 也没有历史版本列表、按版本查看或回滚入口。
3. P1.3 后半段仍包括步骤编辑、固定值/运行变量/秘密引用绑定与确定性回放。Task 在 V2 编辑期状态为 `draft`，后续执行资格必须明确按发布指针还是 Task 状态判断。
4. P1.4 的运行历史、逐步日志/截图、失败定位和登录 handoff，以及 P1.5 定时任务尚未开始；Chrome 路径尚未单独复测，本次实窗证据来自 Edge 143。

## 当前状态：2026-08-06 10:55 +08:00 · Browser Automation Studio P1.3 生命周期最终收口

### 最终结论

- P0 contentRef 严格合同、Profile 自动化任务引用保护、V1→V2 Draft 生命周期、最近 100 条审核历史、URL 搜索与 Desktop V2 UI 已完成自动门禁和真实 Edge 验收。
- 实窗额外发现并修复新建 Draft 后未录制直接返回时列表不刷新的问题。`BrowserStage` 退出录制工作区会递增 Workflow 刷新令牌并重新读取 Runtime/SQLite；最终源码中“直接返回刷新闭测”无需手点刷新即可出现。
- 当前仍只完成 P1.3 的治理与不可变版本切片。WorkflowVersion 不能执行；步骤编辑、固定值/运行变量/秘密引用绑定和确定性回放仍是后续切片。

### 自动化门禁

- 新增回归测试先在旧实现失败，再由最小刷新修复通过；`BrowserStage.test.tsx` 为 39/39。Desktop 包级为 135 files / 927 tests，typecheck、lint、design token 和 build 均通过。
- 根 `pnpm typecheck --force` 为 20/20、`pnpm lint --force` 为 11/11、`pnpm lint:tokens` 通过、`pnpm exec turbo run build --force` 为 11/11，均为 0 cached。
- 根测试第一次仅在 Workers Terminal 清理 Windows 临时目录时出现已知 `EBUSY`；目标文件复跑 8/8，第二次 `pnpm test --force --concurrency=1` 完整通过 20/20、0 cached。Prettier 和最终 diff check 通过。

### Edge 与 SQLite 证据

- 隔离目录为 `.data/local-restart-20260806-101617-browser-workflow-v2`。`P13 V2 生命周期闭测` 经过 V1 批准、V2 驳回、同一 V2 Draft 重录和批准；V2 批准事务结束时 Task 为 `enabled`，发布指针切到 V2。
- 随后的最终 UI 刷新验收又创建了一个空的下一版 Draft。当前 fixture 中该 Task 因此为 `draft`、revision 9，但 `published_version_id` 仍稳定指向 V2，V1/V2 Version 都未变化。这是“误建修订后缺少取消/丢弃入口”的现成证据，不应直接改 SQLite 恢复状态。
- V2 编辑、首次待审、驳回和第二次待审期间，发布指针始终指向 V1。V1/V2 步骤 SHA-256 分别为 `215cb41d4c906b7ffb46b6d686a95853812e9740b7202f934a1851d66f359ba2` 与 `1473061f46b049c823c6c09e986b2527eafbc3fc18dc3bd4d186f623bb10073b`；V1 未被修改。
- 审核顺序为 V1 批准、V2 驳回、V2 批准；驳回备注和最终批准备注均可在详情查看。有关联 Task 的非默认 Profile 删除后确认框关闭、Profile/Task 保留并显示可行动提示；URL 命中与未命中搜索均通过。
- 截图位于 `acceptance/01-browser-initial.png`、`02-v2-rejected-detail.png`、`03-v2-approved-detail.png`、`04-final-direct-return-refresh.png`。1424x861 的 DOM 指标始终为 `scrollWidth=clientWidth`、`scrollHeight=clientHeight`，未发现重叠、截断或页面级溢出。

### 当前运行实例

- 最终源码实例：Electron PID `23536`、managed Runtime PID `22000`、Electron CDP `127.0.0.1:9342`、Install ID `p13-v2-20260806-101617`。
- Pipe `runtime.healthcheck` 返回 `ok: true`、`inFlightRuns: 0`；`desktop-final.stderr.log` 只有 DevTools 监听信息。实例保持运行供手测。
- 本轮未生成 installer、portable 或 release artifact，未提交、未推送。

### 下一任务

1. P1.3 后续：步骤编辑、固定值/运行变量/秘密引用绑定和已发布 WorkflowVersion 的确定性回放。
2. 在后续设计中明确误建 V2 Draft 的取消/丢弃、任务归档或删除、Profile 重绑与历史版本查看；同时评估任务列表逐项 get 的 N+1 成本。
3. P1.4 再实现运行历史、逐步日志/截图、失败定位和登录 handoff；P1.5 实现手动启停定时任务。

## 当前状态：2026-08-09 · TD-040 Skill / MCP 能力治理收口

### 已完成

- 已落地 Skill/MCP 共用的能力治理模型与能力中心：全局启用、Workspace 激活、Agent/Team 绑定、来源/版本和当前有效性均可查询。
- Runtime 执行前按三层治理规则计算有效能力集合；Compose `/` 入口和 MCP 工具 dispatch 共用同一份有效能力判断。
- 能力中心支持市场/我的切换、搜索、来源与状态筛选、Workspace 激活/停用、全局开关、Agent 绑定展示、最近 45 天调用统计和失败计数。
- Skill 市场版本编辑会创建本地派生版本并保留来源关系；本地发布草稿支持保存、列表、详情、编辑回填和提交占位结果。
- “一键整理”只生成只读报告，覆盖未使用、未激活、有问题和上下文占用较高的能力，不直接修改数据或关系。

### 当前边界

1. 市场发布渠道尚未开放；提交草稿只返回稳定的 `channel-unavailable` 本地结果，不代表已审核或已发布。
2. 全局停用只阻断实际调用，Workspace 激活关系和 Agent 绑定仍保留，重新启用后可恢复有效性。
3. 整理报告不会自动删除、停用、取消 Workspace 激活或解除 Agent 绑定。
4. 能力用量以最近 45 天为治理视图窗口，失败和取消计入调用次数，失败另计问题次数；未进入有效执行集合的能力不会产生本轮调用记录。

### 本轮验证

- `pnpm test --force --concurrency=1`：20/20 Turbo tasks 通过；Runtime 80 files / 526 tests，Storage 37 files / 406 tests。
- `pnpm typecheck`：20/20 tasks；`pnpm lint`：11/11 tasks；`pnpm lint:tokens`；`pnpm build`：11/11 tasks；`git diff --check` 均通过。
- 能力中心手测路径：打开能力中心，切换 Skill/MCP 与市场/我的，搜索并查看来源/状态；切换全局开关；选择 Workspace 激活或停用能力；查看 Agent 绑定和最近 45 天 usage；打开只读整理报告；编辑并保存本地发布草稿；提交后确认显示 `channel-unavailable`。

### 工作树

- 当前分支为 `feature/newmax-shell-rewrite`，HEAD 为 `7db45ec`（`desktop: UI 修复与打磨`）。
- 本轮及此前改动均保持未提交、未推送；真实数据库 `D:\projects\SYNC-THINK\.data\SYNC-THINK\sync-think.db` 未被修改。

## 当前状态：2026-08-10 · 标签栏下拉选择视口定位修复

### 修复结论

- 顶栏工作区“+”、聊天标签栏“+”新建资源菜单和分屏候选选择器已统一做视口避让；聊天标签栏下拉层通过 `document.body` Portal 使用固定定位，靠近窗口底部时自动向上展开，靠近顶部或空间充足时向下展开。
- 菜单宽度会限制在视口内，候选过多时仅菜单内部滚动；不会再把内容推到窗口可视区外，也不需要用户上下滚动页面寻找选项。

### 验证

- `apps/desktop/src/renderer/shell/ConversationTabs.test.tsx`：12/12 通过；`TopBar.test.tsx`：1/1 通过，覆盖两个“+”菜单和分屏选择器的底部翻转。
- Desktop 全量测试：149 个测试文件、1075 个测试全部通过。
- `pnpm --filter @sync-think/desktop typecheck`：通过。
- `pnpm --filter @sync-think/desktop lint`：通过，0 errors；6 条 hooks warning 为现有代码提示。

### 当前工作树

- 当前分支 `feature/newmax-shell-rewrite`，基线 HEAD `45b34d6`；本轮只修改两个菜单组件、对应测试和两份开发状态文档。
- 未安装新依赖、未打包、未提交、未推送；真实数据库未修改。

### 本地源码实例（2026-08-10 09:45 +08:00）

- 已重新执行 `pnpm --filter @sync-think/desktop build` 并启动源码版 Electron；Electron PID `41708`，managed Runtime PID `47568`。
- 窗口标题为 `SYNC-THINK`，`Responding=True`；Runtime 日志包含 `pipe ready`、`database ready`、`hello accepted`。
- 本次启动日志：`.data/local-restart-20260810-menu-fix/desktop.stdout.log` 与 `desktop.stderr.log`。stderr 仅记录已有 guest view 的 Bing 导航中止事件，不影响桌面启动。

## 当前状态：2026-08-10 · 对话行工作区文件入口收敛

- 对话行右侧只显示“打开工作区文件” Pane 操作；工作区文件打开后以独立资源 Tab 出现在对应 Pane。
- `+` 菜单继续只提供“新建对话 / 新建终端 / 网页浏览”，不显示工作区文件；对话行末端的“打开右栏”按钮已移除。
- ChatView 内部由浏览器工具触发的临时右栏仍保留，避免影响网页预览流程。
- 最新源码实例已重启：Electron PID `47260`、managed Runtime PID `43680`，日志位于 `.data/local-restart-20260810-workspace-files-entry/`；窗口 `Responding=True`，pipe/database/hello 均正常。
- 本轮 Desktop 全量回归为 149 个测试文件、1076 个测试全部通过；定向标签行/Shell 回归为 46/46。

### 页面手测

1. 打开任意工作区的聊天窗格，把窗口缩到较矮高度，使标签栏靠近窗口底部。
2. 点击顶栏工作区“+”，预期工作区选择菜单完整出现在可视区内；若下方空间不足，菜单从按钮上方展开。
3. 点击聊天标签栏的“+”，预期新建资源菜单同样自动避让窗口边界。
4. 打开两个以上对话标签，点击水平或垂直分屏按钮，预期“选择分屏对话”同样自动避让窗口边界。
5. 增加足够多候选项，预期只有菜单内部出现滚动条，页面和标签栏不被整体推移。

## 当前状态：2026-08-10 · 能力中心视觉与远端能力最终收口

### 已完成

- 能力中心、Skill/MCP 详情抽屉、编辑弹窗和 Portal 遮罩统一使用 Shell 页面/表面/边框/文字/强调色变量，浅色和深色保持同一视觉层级。
- Skill 编辑器已补齐图标、输入框、源码导入和独立滚动布局；保存按钮常态显示，保存中锁定关闭动作，动画结束后清除 transform，中文文本保持清晰。
- 支持从 HTTP(S)/GitHub blob 导入远端 `SKILL.md`，具备超时、大小上限、规范化来源和可行动错误状态。
- 支持远端 MCP Streamable HTTP 注册、工具发现/刷新/调用；AI 只登记公开元数据，用户在能力中心单独输入 Key，Key 仅写入 SecureStore。

### 最终验证

- `pnpm exec turbo run test --force --concurrency=1`：20/20 Turbo tasks 通过；Desktop 149 files / 1087 tests，Runtime 82 files / 543 tests。
- `pnpm exec turbo run typecheck --force`：20/20；`pnpm exec turbo run lint --force --continue`：11/11，0 errors（5 条既有 hooks warnings）；`pnpm lint:tokens` 通过。
- `pnpm exec turbo run build --force`：11/11、0 cached；`git diff --check` 通过。
- 关键定向回归：`AbilitiesPage` 21/21；Runtime 远端能力 14/14；Runtime Chat 工具 57/57；Desktop 回滚协调器 6/6（使用项目标准 15 秒超时）。

### 当前本地实例

- 最新源码 Electron 主进程 PID `49912`，managed Runtime PID `42924`，CDP `127.0.0.1:9352`；两者 `Responding=True`。
- 隔离数据与日志：`.data/local-restart-20260810-123532-remote-capability-final/`；启动日志已出现 `pipe ready`、`database ready`、`hello accepted`。
- 窗口已恢复约 `1280×820`、浅色主题；能力中心、MCP 和 Skill 编辑实窗检查无横向溢出，保存按钮可见可点击。最新截图：`.data/local-restart-20260810-123532-remote-capability-final/screens/ability-final-mcp-light.png`。

### 当前边界

- 本轮不生成安装包、不提交、不推送；真实数据库未触碰，闭测数据只写入上述隔离目录。
- 远端 MCP 的 Key 不会出现在 SQLite、Renderer 状态、能力列表、事件、日志或诊断导出中；Key 轮换/删除仍需要后续独立入口。

## 当前状态：2026-08-11 · 能力中心与任务清单修复已收口

### 已完成

- 能力中心主背景、卡片层级和表单层级已改用 Shell `chat/surface/elevated` 主题语义；Skill/MCP 顶部切换器使用固定几何尺寸，切换时位置稳定。
- 桌面端标题栏固定高度且副标题不换行；实窗往返切换 Skill/MCP 时两个按钮均保持 `84×32`，位置固定在 `(675, 59.5)` 与 `(762, 59.5)`。
- Skill 详情抽屉已精简生效路径文案并移除横向位移动画；MCP 配置弹窗已分区重排、四边圆角、常驻 footer，已保存 Key 通过 uncontrolled ref 回填且默认遮罩显示。
- 最新产品要求覆盖此前“Key 只进 SecureStore”的边界：MCP Key 现在以 App Setting 明文保存并回填 Renderer；旧 SecureStore 句柄在首次列表读取时迁移。Key 仍不进入事件、日志和诊断导出。
- MCP 发现失败会保留旧工具目录并明确报告部分成功；远端命令超时覆盖完整握手预算；AI 元数据登记拒绝隐藏 Key 字段。
- MCP 页不再显示 Skill 专属的两条生效路径说明。
- Runtime 与 Desktop 任务投影已把四类任务计划工具从普通执行步骤中排除；没有计划时不显示输入框上方任务清单胶囊。

### 最终验证

- 能力页 30/30、远端 MCP 7/7、Runtime 任务投影 12/12、Desktop 任务胶囊 10/10、Runtime Chat 工具 58/58、Desktop 执行过程 11/11、Storage 任务清单 4/4。
- Desktop 全量 151 files / 1114 tests；本轮早前 Runtime、Storage 全量通过。Desktop、Runtime、Storage、Protocol typecheck 通过。
- Desktop/Runtime/Storage lint 通过；Desktop 0 errors、保留 5 条既有 hooks warnings。design token、Prettier、Desktop/Runtime build 和 `git diff --check` 通过。
- 实窗已验证浅色/深色背景、稳定切换矩形、Skill 抽屉和编辑器、MCP Key 回显及任务胶囊隔离。截图位于 `.data/local-restart-20260811-154206-capability-tasklist/`。

### 当前源码实例

- Electron PID `25712`、managed Runtime PID `33080`，CDP `127.0.0.1:9353`；两者 `Responding=True`。
- 启动日志 `.data/local-restart-20260811-154206-capability-tasklist/desktop-restart-final.stdout.log` 已包含 `pipe ready`、`database ready`、`hello accepted`；当前已恢复浅色主题。

### 当前边界

- 不生成安装包、不提交、不推送；现有工作树中的其他缓存、计价、存储和运行态改动继续保留。

## 当前状态：2026-08-11 · 多 Pane 与文件工作台修复已收口

### 已完成

- 工作区与 Pane 资源标签使用原生拖放协议，键盘排序保持可用；根节点和 Pane Tree 的横向溢出已收敛到明确的局部滚动区。
- 第三路及后续活动对话显示“此对话暂时休眠，点击加载”，不再出现只有标签栏、正文完全空白的 Pane。
- Composer 使用 Pane 容器断点。实窗把聊天 Pane 缩到约 218px 后，输入区 `scrollWidth === clientWidth === 200`，发送按钮和工具图标仍在 Pane 内。
- 文件标签改为完整文件工作台：编辑器内嵌工作区文件树，支持替换当前文件标签、独立新标签打开、脏稿保护，以及编辑时隐藏或展开文件树。
- 宽文件 Pane 使用图四式左右并列；不超过 520px 时改为上下嵌入，保证文件内容和文件树都能同时查看，折叠后编辑器占满全部宽高。

### 最终门禁

- Desktop 全量：`153 files / 1126 tests`；Runtime 全量：`84 files / 562 tests`；Storage 全量：`38 files / 410 tests`。
- 根级 lint：`11/11`，Desktop `0 errors / 5` 条既有 hooks warnings；design token 检查通过。
- 根级 typecheck：`20/20`；根级 build：`11/11`；最终 `git diff --check` 和全部变更代码/文档的 Prettier 检查均通过。
- 首次 Desktop 双 worker 全量在测试收集前因系统仅余约 1.3GB 物理内存而触发 `esbuild cannot allocate memory`；关闭源码实例、改为单 worker 后完整 `153/1126` 全绿，未把环境失败计入产品缺陷。

### 实窗验收

- 双屏窗口往返：`DISPLAY1 -> DISPLAY2 -> DISPLAY1`，移动前后保持 `1440×860`；最终重启窗口为 `1440×900`，视口 `1424×861`。
- 文件标签 `.dockerignore` 已从右 Pane 原生拖到中间 Pane 并恢复，两个阶段页面均为 `scrollWidth === clientWidth === 1424`。
- 工作区文件点击 `.devserver.log` 后出现文件标签；随后点击 `.dockerignore` 替换当前标签，点击 `.env.example` 的新标签图标后同时保留两个文件标签。隐藏时编辑器为 `278×733`，展开后窄布局为编辑器 `278×440`、文件树 `278×293`。
- 宽布局工作台为 `609×733`，编辑器 `389×733`、文件树 `220×733`。最终截图位于 `.data/local-restart-20260811-pane-file-workbench/final-restarted-source.png`。

### 当前源码实例

- Electron PID `56592`、managed Runtime PID `57440`、CDP `127.0.0.1:9353`，窗口 `Responding=True`。
- Install ID `pane-file-20260811`；数据库继续使用 `.data/SYNC-THINK/sync-think.db`；复用原 `.data/local-restart-20260811-154206-capability-tasklist/user-data`，保留工作区、主题和登录态。
- 启动日志：`.data/local-restart-20260811-pane-file-workbench/desktop-ready.stdout.log` 与 `desktop-ready.stderr.log`；已出现 `pipe ready`、`database ready`、`hello accepted`。

### 当前边界

- 不生成安装包、不提交、不推送；现有工作树中的能力、缓存、计价、任务清单和存储改动继续一并保留。

## 当前状态：2026-08-13 · 智能体对话头像一致性修复

### 已完成

- 已确认头像数据的存储、Runtime 返回和 `ShellApp` 刷新链路正常；缺陷位于新版 `ChatView` 没有把持久化消息与 `run.started` 中的智能体身份重新关联。
- 助手消息采用“消息身份 → Run 身份快照 → 当前 Agent 会话绑定”的回退顺序，并始终从最新智能体目录读取头像。修改头像后，已打开对话和历史回复会随目录刷新同步更新。
- 输入框身份按钮、身份选择菜单、助手回复及等待态使用同一头像组件；换绑后的旧 Run 保留原智能体身份，模型直聊保持默认助手图标。

### 验证结果

- 新增头像回归 4 条；与身份切换组合定向测试为 2 files / 12 tests。
- Desktop 全量为 155 files / 1141 tests，全部通过；Desktop lint 为 0 errors、5 条既有 hooks warnings，design token 与 typecheck 通过。
- Desktop 正式 build、Prettier 和 `git diff --check` 通过。

### 当前边界与下一步

- 本地源码实例已复用原数据库、user-data 和 Install ID 重启：Electron PID `11708`、Runtime PID `35824`、CDP `127.0.0.1:9353`；窗口标题 `SYNC-THINK`、`Responding=True`，healthcheck 为 `ok=true` 且无活动 Run。
- 实窗已打开既有“前端工程师”会话；输入框身份头像和助手回复头像都与智能体目录中的 3923 字符 WebP 完整相同，回复不再显示默认 Bot，页面 `scrollWidth === clientWidth === 1424`。
- 启动日志与截图位于 `.data/local-restart-20260813-agent-avatar/`，最终截图为 `frontend-agent-avatar-fixed.png`；实例保持运行供手测。
- 本轮不生成安装包、不提交、不推送。

## 当前状态：2026-08-13 · 文件工作台调宽与 Markdown 预览已收口

### 已完成

- 文件标签中的嵌入式工作区文件树新增左右拖拽调宽。默认 30%，同时保证文件树至少 220px、编辑区至少 280px；键盘方向键、Home/End、双击复位均可用。
- 拖拽采用 Pointer Capture，并覆盖释放、取消、捕获丢失、窗口失焦和布局 resize 清理；520px 及以下保持上下嵌入，不显示横向拖柄。
- `.md`、`.markdown` 默认显示真正的 Markdown 文档预览，源码模式继续可编辑。内容搜索会自动切换源码并定位命中行；独立工作区预览使用同一规则。
- Markdown 文件预览不会执行 fenced HTML；Mermaid、GFM 表格、列表与代码高亮保留。其他可读文本继续使用语法高亮或纯文本行号预览。

### 验证结果

- 定向回归 5 files / 41 tests；Desktop 单 worker 全量 155 files / 1148 tests，全部通过。
- 默认并发全量首次有 4 条异步按钮查询在 CPU 争用下超时；相关 2 files 串行复跑 18/18 通过，单 worker 全量进一步确认没有功能回归。
- Desktop typecheck、build、Prettier、design token 和 `git diff --check` 通过；lint 为 0 errors、5 条既有 hooks warnings。

### 实窗验收

- 当前源码实例复用原数据库、user-data 与 Install ID `pane-file-20260811`：Electron PID `36968`、managed Runtime PID `15676`、CDP `127.0.0.1:9353`；数据库为 `.data/SYNC-THINK/sync-think.db`，实例保持运行供手测。
- 340px 窄文件工作台已自动切为上下布局并隐藏拖柄；592px 宽布局中，文件树可由约 241px 连续拖到 307px，编辑区准确限制在至少 280px。Home 将文件树收至 220px，End 将其扩至约 307px；鼠标释放后继续移动不会误拖，光标和 `user-select` 均已清理。
- `README.md` 文档预览实测渲染出 1 个 H1、5 个 H2、列表和 2 个代码块；源码模式完整显示 3407 字符、67 行，未改动时保持“已同步”，切回文档预览后内容与 Pane 比例正常恢复。
- 全程页面 `scrollWidth === clientWidth === 1424`，没有页面级横向溢出。证据位于 `.data/local-restart-20260813-workspace-markdown/`，主要截图为 `workspace-markdown-wide-reset.png`、`workspace-markdown-source.png` 与 `workspace-markdown-restored.png`。

### 支持边界

- 工作台可读取不超过 512KiB 且不含 NUL 的 UTF-8 文本；`.md`、`.markdown` 有专用文档预览，已映射的代码与配置格式有语法高亮，其他文本按纯文本显示。
- 图片、PDF、Office、音视频等当前没有文件工作台专用预览；通常会因二进制内容被拒绝，不能以文本预览替代。
- 本轮不生成安装包、不提交、不推送；当前源码实例继续保持运行，下一步由用户直接进行页面手测。

## 当前状态：2026-08-14 · 执行过程活动阶段自动展开已收口

### 已完成

- 思考或工具运行期间，外层“执行过程”自动展开；最终回答开始或 Run 终结后自动折叠。历史完成消息继续默认折叠。
- 活动工具批次自动展开，批次内每个工具的 Path、Command、Output 等详情也默认展开；只要同批仍有工具运行，已经完成的同批工具仍保持展开，整批全部结束后统一折叠。
- 工具批次身份在流式追加期间保持稳定；外层、批次和单工具详情共用自动折叠控制，用户手动选择在当前 Run/批次内优先，新 Run/批次恢复自动规则。

### 验证结果

- 执行过程定向回归 `3 files / 35 tests`、相关 ChatView/流式回归 `12 files / 116 tests`、可视化组合回归 `3 files / 26 tests` 通过。
- Desktop 单 worker 全量 `155 files / 1166 tests` 通过；Desktop typecheck、正式 build、design token、Prettier 和 `git diff --check` 通过。Desktop lint 为 0 errors，保留 15 条既有 Hook warnings。
- 隔离 Electron 在 1424×861 下完成四阶段验证，四个阶段均无页面级横向溢出。证据位于 `.data/local-restart-20260814-execution-disclosure/`。

### 当前源码实例与边界

- 当前正常源码窗口已重新加载最新 Renderer：Electron PID `31916`、managed Runtime PID `41120`，窗口标题 `SYNC-THINK`、`Responding=True`；原数据库、工作区和登录态继续保留。
- 隔离 QA Electron/Runtime 已在截图后关闭，不残留测试进程。本轮不生成安装包、不提交、不推送。

## 当前状态：2026-08-14 · Composer 模型/思考与联网入口重构已收口

### 已完成

- 思考强度已并入模型菜单底部固定入口，模型按钮同步展示当前档位；供应商、模型和思考二级菜单使用同一 Radix 树并改为右向层级语义。
- 已有对话与新建对话的独立联网按钮已移除；输入 `@` 后可在“设置”区切换联网搜索，已有对话同时保留工作区文件列表。
- 思考强度与联网状态按 Conversation 持久化；新建对话第一条消息创建 Conversation 后同步保存，正式对话不会重置。
- `@` 弹层支持从输入框按 Tab 进入联网分段控件，Escape 或首段 Shift+Tab 会关闭弹层并把焦点还给当前 Pane 输入框；多 Pane 使用各自 ref，不会串改其他对话。
- 共享浮层定位会按上下空间自动翻转，并把宽度、高度和边缘夹在视口内；空态 Composer 已加入 Pane 容器查询，窄 Pane 工具栏可响应式换行。
- 新建对话首轮的 `auto` 思考档位与后续消息一致原样传入 Runtime，不再出现同一显示状态下首轮与后续语义不同。

### 验证结果

- 定向回归：`compose-toolbar.test.tsx`、`ChatView.usage.test.tsx`、`ShellApp.test.tsx` 共 `56` 条通过。
- Desktop 单 worker 全量 `155 files / 1172 tests` 通过；最后的焦点恢复补丁继续由上述 `56` 条定向回归覆盖。
- Desktop typecheck、正式 build、Prettier、design token 与 `git diff --check` 通过；lint 为 0 errors，保留当前分支既有的 15 条 Hook warnings。

### 实窗与边界

- 最终源码实例复用原数据库、AppData user-data、登录态和 Install ID `dev-0001`：Electron PID `3848`、managed Runtime PID `33956`，CDP `127.0.0.1:9355`；`pipe ready`、`database ready`、`hello accepted` 均正常。
- 浅色、深色、`1280×760` 窄 Pane 与 `1280×280` 矮视口均完成实窗检查。窄 Pane 无横向溢出，思考二级菜单自动换到左侧；矮视口中的 `@` 弹层顶部夹在 8px 且不越界。
- Tab、Escape、Shift+Tab 焦点闭环已实测，测试后主题恢复浅色、思考恢复超高、联网偏好恢复原值。日志和截图位于 `.data/local-restart-20260814-111719-composer-toolbar-final/`。
- 本轮不生成安装包、不提交、不推送；源码实例保持运行供用户手测。

## 当前状态：2026-08-14 · 多内核阶段性实现已推送，尚未完整收口

### 已完成

- `feature/multi-kernel` 已落地统一 `KernelAdapter` 契约、内核注册表与探测、Native 薄适配、Windows Job Object/进程树回收，以及 Claude Code 2.1.222、Codex 0.145.0 两个外部内核适配器。
- Runtime 已按 `kernelId` 分流原生/外部执行；外部内核 delta、工具、usage、terminal 接入现有事件/消息持久化。终态改为读取最新 Run，子进程 EOF 未发 terminal 时按失败处理，避免流式可见但最终消息为空。
- 每 Run loopback MCP broker、随机 token、临时 CC `--mcp-config`、Codex `mcp_servers.*` overrides 已实现；平台 MCP server 已纳入源码/dist/便携版路径解析和发布布局校验。broker socket 已按 Run 隔离。
- 平台文件工具 `platform_context/file_read/file_list/file_search/file_write` 与 task/agent 清单读取已实现；动态 catalog 已能按 Run 能力和执行模式生成 Task、Agent、Skill、Team、MCP 管理、Browser、Desktop schema，并区分 `outside-full-access` 审批元数据。
- Desktop 内核菜单可显示 Native / Claude Code / Codex / Pi 的检测版本与能力徽标；每 Conversation 持久化内核选择，排队插话保留入队时内核。Pi 未安装项提供固定 `npm i -g pi` 安装 IPC、状态展示和安装后重探。

### 已验证

- 真实 Codex 0.145.0 CLI：返回完成终态和 usage；真实 Claude Code 2.1.222：经 MCP broker 执行 `file_write` + `file_read` 并验证内容。
- 2026-08-14 最新复验：Runtime `96 files / 621 tests` 全部通过；根 `pnpm typecheck` 为 `20/20`，根 `pnpm lint` 为 `11/11`、0 errors（Desktop 保留 15 条 hooks warnings）。
- Desktop 并发全量共 `157 files / 1184 tests`，结果为 `155 files passed / 2 files failed`、`1182 tests passed / 2 tests failed`：Browser handoff 与 Desktop waiting 按钮在并发负载下未及时出现；对应 2 files 串行复跑 `18/18` 通过。因此本次不能把 Desktop 并发全量写成全绿。
- 真实 Electron 已完成内核菜单探测：Native 已安装、Claude Code v2.1.222、Codex v0.145.0、Pi 未安装/安装入口；证据目录 `.data/local-restart-20260814-multikernel-7b/`。

### 未完成 / 阻塞

1. 动态 MCP catalog 目前只解决“暴露哪些 schema”；`handlePlatformMcpToolCall` 仍只执行纯 `executePlatformTool`。Browser/Desktop/Agent/Skill/Team/Task/MCP 管理调用尚未复用 Runtime 现有业务执行器，不能声称这些平台工具已可由外部内核真实调用。
2. 平台 MCP 取消/超时尚未传播到 Runtime 审批等待；内核侧超时后可能留下孤儿审批。创建类工具还缺稳定幂等键/创建前查重。
3. CC `stream_event/content_block_delta/partial_json` 与 tool-result 时间线尚未完整映射；Codex reasoning/compacted、真实 MCP tool name/arguments 和 cached usage 口径尚未收口。
4. Pi 只完成安装引导与重探，没有内核适配器。
5. 真实 Electron 尚未完成原生/CC/Codex 三内核对话、审批 approve/deny、usage、重启后历史一致性的隔离数据闭环与截图矩阵。

### 分支与远端

- 当前分支：`feature/multi-kernel`；本状态记录对应提交 `3998d67` 之后的文档补充。
- 多内核实现提交链：`920af52`、`bfc8339`、`5a03c4f`、`1f77fb0`、`016b678`、`ce65d8f`、`3998d67`。
- 本地 `.zcode/` 为会话计划，不纳入版本控制。

## 当前状态：2026-08-14 · 多内核平台工具分派与协议收口

### 已完成

- 平台 MCP 目录按 Run 冻结，业务工具调用改为路由到原生既有执行器（Task / Agent / Skill / Team / MCP 目录与远端注册），不再只对静态文件工具生效。
- 审批统一走原生权威分类：库写操作在 `ask` 与 `workspace` 都需要审批卡，只有 `full-access` 免批；文件工具保留 ask 档位。
- 取消链路打通：MCP server 超时或 `notifications/cancelled` → broker `tool-cancel` → 宿主 abort 审批并拒绝执行；同 Run 工具调用串行。
- 同 Run 重放缓存避免内核重试重复创建；broker socket 按 Run 隔离。
- Claude Code 启用真实增量流（`--include-partial-messages`），并映射 `tool_result`；Codex 保留真实 MCP `server/tool/arguments` 并修正 cached 重复计数。
- Runtime 补齐 `reasoning` / `compacted` 投影、`partial` 与失败标记，用量 requestId 稳定化。

### 已验证

- Runtime `98 files / 635 tests`、Desktop `157 files / 1184 tests`、Storage `38 files / 410 tests` 全部通过。
- 根 `pnpm typecheck` 20/20、`pnpm lint` 11/11（0 errors、15 条既有 Desktop hooks warnings）、`pnpm build` 11/11。
- 真实 CLI 采样落成 fixture 并回放：claude 2.1.222 增量/工具结果、codex 0.145.0 MCP 身份与用量口径。
- 实窗（`.data/local-restart-20260814-multikernel-final/`）：Codex 端到端成功，assistantText 与稳定用量 requestId 均已在真实数据库确认。

### 未完成 / 阻塞

1. 实窗 native 与 Claude Code 会话被中转站拒绝（400 / `503 分组 claude 未开通模型 gpt-5.6-luna`），需要用户在能力中心为对应分组开通模型后复测。
2. 审批卡 approve/deny 与重启后历史一致性仍缺实窗点选证据。
3. Browser/Desktop 工具尚未向外部内核开放；Pi 无内核适配器。
4. 幂等只覆盖同 Run 重放，跨重启持久化 operation key 未实现。

### 边界

- 本轮实窗使用共享数据库与既有会话，仅新增消息，未删除或迁移数据；不生成安装包。

## 当前状态：2026-08-14 · 多内核收口快照与后续任务清单

### 分支与提交

- 分支 `feature/multi-kernel`，HEAD `777526f`，已推送且与 `origin/feature/multi-kernel` 一致。
- 多内核提交链：`920af52` → `bfc8339` → `5a03c4f` → `1f77fb0` → `016b678` → `ce65d8f` → `3998d67` → `8db6978` → `777526f`。
- 工作树仅剩未跟踪的本地 `.zcode/` 会话计划，不纳入版本控制。

### 当前可用能力（已验证）

- 内核选择：模型菜单显示 Native、Claude Code v2.1.222、Codex v0.145.0、Pi 未安装并带安装入口；选择按 Conversation 持久化，排队插话保留入队时内核。
- 外部内核运行：按 `kernelId` 分流，delta / 工具 / usage / terminal 接入既有事件与消息持久化；终态读取最新 Run，EOF 未发 terminal 按失败处理。
- 平台工具：每 Run 冻结目录；Task、Agent、Skill、Team、MCP 目录与远端注册复用原生执行器；审批走 `chatToolRequiresApproval`，库写操作仅 `full-access` 免批。
- 取消与幂等：`tool-cancel` 帧 + 每调用 AbortController，同 Run 串行；晚批准不执行副作用；同 Run 按 `callId + 工具 + 参数摘要` 重放。
- 协议保真：CC 增量文本、thinking 转诊断 reasoning、`tool_result` 闭环；Codex 真实 `server/tool/arguments` 与正确 cached 口径。

### 当前门禁结果

- Runtime `98 files / 635 tests`、Desktop `157 files / 1184 tests`、Storage `38 files / 410 tests` 全部通过。
- 根 `pnpm typecheck` 20/20、`pnpm lint` 11/11（0 errors，保留 15 条既有 Desktop hooks warnings）、`pnpm build` 11/11。
- 真实 CLI 抓取 fixture 已入库并脱敏：`apps/runtime/src/kernel/fixtures/claude-2.1.222-partial-capture.jsonl`、`codex-0.145.0-mcp-capture.jsonl`。

### 本地实例与证据

- 当前实例：Electron PID `49800`、managed Runtime PID `44004`，CDP `127.0.0.1:9366`，使用共享数据库 `.data/SYNC-THINK/sync-think.db`。
- 实窗证据目录 `.data/local-restart-20260814-multikernel-final/`：12 张截图、`facts.jsonl` 41 行、`desktop.stdout.log`、`desktop.stderr.log`、`multikernel-probe.cjs`。
- 数据库确认的 Codex 成功链：`run.started(kernelId=codex)` → `provider.usage(requestId=kernel-<runId>-1, tokensIn 18105, tokensOut 35)` → `run.completed(assistantText="codex-ok")`。

### 后续任务清单（按优先级）

1. **P0 实窗补齐 native 与 Claude Code 成功回复。** 当前被中转站拒绝：native 返回 400，CC 返回 `503 分组 claude 未开通模型 gpt-5.6-luna`。需要先在能力中心为对应分组开通可用模型，再用 `.data/local-restart-20260814-multikernel-final/multikernel-probe.cjs` 的 `kernel-chat` 步骤复测并留证。
2. **P0 审批卡实窗点选证据。** approve 与 deny 目前只有 Runtime 级测试；需要在实窗触发一次平台工具审批，分别点批准与拒绝，断言 Store 写入与拒绝零副作用，并保存截图。
3. **P0 重启后历史一致性实窗验证。** 冷重启 Desktop 与 managed Runtime，确认外部内核的最终文本、工具时间线、usage 与审批决定一致且不重放。
4. **P1 跨重启幂等。** 现有重放缓存只在同 Run 内存中。需要持久化 `platform_tool_operation`（operation_key 主键 + request_digest + attempt_token + 结果），并对 Skill `content_fingerprint`、MCP `(name, endpoint)` 补数据库 UNIQUE（先做重复数据迁移）。
5. **P1 Browser/Desktop 工具对外部内核开放。** 必须复用 `RuntimeBrowserController` 的 origin grant 与 `RuntimeDesktopController` 的风险分级（sensitive/human-only 全模式审批），并对 `browser_type` 输入与 `desktop_set_value` 明文做事件脱敏。
6. **P1 `Runtime.stop()` 关闭期清理。** 正常关闭时统一 abort 在途 Run 并 settle `pendingToolApprovals`，避免关闭窗口留下孤儿审批。
7. **P2 Pi 内核适配器。** 目前只有安装引导与安装后重探；需要 provider baseUrl 配置、宿主代理敏感工具与审批兜底。
8. **P2 Codex 压缩通知来源。** `exec --json 0.145.0` 不输出上下文压缩事件，`compacted` 分支已实现但无来源；若需覆盖需改接 app-server 通道。
9. **P2 CC `--permission-mode acceptEdits` 长期稳定性矩阵**与中转站 `/v1/messages` 兼容性矩阵。

### 边界

- 本轮实窗复用共享数据库与既有会话，只新增消息，未删除或迁移数据；未生成安装包。
- 采样脚本与原始抓取保留在 `.data/kernel-capture/`，仓库内 fixture 已脱敏（签名、本机路径、用户目录均已替换）。

## 当前状态：2026-08-15 · Claude Code 短进程与持久逻辑 Session 收口

### 已完成

- Claude Code 继续按每轮 Run 启动短生命周期进程，同一个 Conversation + Kernel 通过持久逻辑 Session 延续上下文。首轮使用 `--session-id`，后续轮使用 `--resume`。
- 首轮请求构建只生成 UUID，不提前写入 `app_setting`。Adapter 收到 `system/init + session_id` 后发出 `session-started`，Runtime 此时才持久化；CLI 返回不同 ID 时以 CLI 为准，成功但无事件的旧 CLI 才使用请求 ID 兜底。
- 首轮注入对话历史、Agent、Skill、Workspace 和项目上下文，恢复轮只发送当前用户消息。模型、Provider、协议、凭据、Workspace 或稳定 system context 变化会使指纹失配并创建新 Session。
- 普通工具/任务失败与取消保留已确认 Session；仅明确的 Session/Thread 不存在、无效、无法加载或恢复失败会清理映射。
- 同 Conversation + Kernel 串行构建和执行，保证下一轮看到上一轮刚确认的 Session；跨 Conversation 保持并行，活动与排队取消都能释放队列。
- Claude Code 进程固定携带 `--print`。显式凭据同时覆盖 `ANTHROPIC_API_KEY` 与 `ANTHROPIC_AUTH_TOKEN`，并隔离用户 settings；本机登录复用仍保留用户设置源。401/403 与 `authentication_failed` 会快速进入失败终态。
- Runtime 冷启动恢复会跳过已有 `run.completed`、`run.failed`、`run.cancelled` 或 `run.paused` 的 Run，避免终态任务被重复执行或追加错误暂停事件。

### 验证结果

- `claude-code-adapter.test.ts`：12/12 通过。
- `external-kernel-run.test.ts`：13/13 通过。
- 两组定向回归合计 25/25，覆盖创建确认、旧 CLI 兜底、CLI ID 覆盖、跨重启恢复、上下文指纹重建、普通失败保留、失效清理、同会话串行、跨会话并行以及活动/排队取消。
- Runtime 全量回归：102 个测试文件 / 699 项测试全部通过。
- 根级 `pnpm typecheck`：20/20 tasks；根级 `pnpm build`：11/11 tasks。

### 当前边界与下一步

- 本轮采用“短进程 + 持久逻辑 Session”，没有引入每个对话常驻的 Claude Code daemon。进程内临时状态每轮释放；上下文连续性由 CLI Session、Runtime 持久映射和稳定上下文指纹提供。
- Session 复用有利于保持 Provider Prompt Cache 的稳定前缀，但缓存是否命中仍以 Provider 返回的 cache read/write usage 为准，Runtime 不推测或伪造命中。
- 仍需在可用 Claude Provider/模型下完成真实 Electron 连续多轮回复、重启恢复和缓存 usage 的实窗证据；这不阻塞当前 Runtime 合同与自动化门禁。
- 本轮不生成安装包、不提交、不推送；工作树中的既有 Desktop、Gateway、Protocol 和其他未跟踪改动继续保留。

## 当前状态：2026-08-15 · Responses 工具续接与跨重启恢复收口

### 已完成

- 已定位 Claude Code 经 Gateway 调用 OpenAI Responses 时的续接错误：Responses 的 `function_call.call_id` 是工具调用关联标识，item `id` 是后续 HTTP 请求必须引用的条目标识，两者此前被当成同一个值处理。
- Gateway 现在同时保存 `call_id -> item id` 映射。Anthropic 侧 `tool_use.id` 使用 `call_id`；工具结果转回 Responses 时先发送对应的 `item_reference`，再发送 `function_call_output`。
- continuation 生命周期绑定 Claude Code 的持久逻辑 Session scope，不绑定短生命周期 Run ticket。映射保存于 `app_setting` 的 `gateway.response-continuation.<kernel_scope>`，Runtime 重启后可恢复并继续下一轮工具结果。
- Session 上下文指纹变化、Session 明确失效和对话删除都会清理对应 continuation。清理入口显式接收内核 ID，不再依赖 Session key 中是否包含 `claude-code` 或 `codex` 字样。

### 验证结果

- Gateway Responses 定向测试：2 files / 34 tests passed。
- 外部内核测试：1 file / 15 tests passed。
- Adapters 全量：12 files / 171 tests passed。
- Runtime 全量：102 files / 706 tests passed。
- Adapters build/typecheck、Runtime build/typecheck 与 `git diff --check` 均通过。

### 当前边界

- 本轮修复 Runtime、Gateway 与协议转换链路，不涉及 Renderer 页面变化，因此没有新增页面手测步骤。
- 真实 Provider 是否返回缓存 read/write usage 仍由 Provider 决定；本修复只保证工具调用标识与 continuation 在多轮和 Runtime 重启后保持正确。
- 本轮不生成安装包、不提交、不推送；工作树中其他既有改动和未跟踪文件继续保留。

## 当前状态：2026-08-20 · Daemon 托管 Runtime 与 Codex app-server

### 已完成

- Desktop 普通退出不再停止 Runtime；更新/显式服务停止按 daemon-first 所有权顺序收口。daemon 优先通过私有 IPC 停 Runtime；无私有句柄时使用 HMAC 认证 `runtime.shutdown`，仅在有界超时后使用 PID fallback。
- daemon 已成为长期控制面：启动后确保 Runtime 存在，Runtime 异常退出自动重启；daemon 停止时回收 Runtime。独立 outer supervisor 在 daemon child 非零退出后按 1s/2s/5s/10s/30s 退避拉起，正常 `daemon.stop` 退出 0 后停止。定时任务仍保留短期 Worker 降级路径。
- Codex Registry 已切换到 `CodexAppServerKernelAdapter`。Runtime 通过有界 Session Host 托管 resident app-server：默认最多 4 个、空闲 15 分钟回收；同会话连续 turn 在驻留期复用，不同会话在上限内并行。活跃 turn/审批等待持有租约、不被淘汰；容量满且全忙时等待。原生 `threadId` 继续按 `kernel.session.codex.<conversationId>` 持久化，LRU/超时回收后用 `thread/resume` 恢复；Runtime stop 统一停止全部 resident adapter。
- dispatch ack 只表示接收；并发槽位与 tracker 持续到 complete/abort/crash takeover。
- 删除旧 Codex exec adapter、JSONL protocol、rollout watcher、argv 与旧 fixture 测试。

### 已验证

- Runtime external-kernel 与生命周期定向：34/34；其中有界 Session Host 9/9、daemon→Runtime 优雅停机 3/3、Codex app-server 2/2。
- Runtime 全量：128 files / 914 tests；Runtime typecheck 通过。
- Desktop 生命周期/升级停止定向：5 files / 21 tests；Desktop typecheck 通过。显式后台停止与升级按“daemon 优雅回收 Runtime → Desktop 清理残留 PID”的所有权顺序执行；daemon 快速崩溃走独立 1–5 秒有界重启，不受冷启动 10 秒防重窗口阻塞。
- Runtime/daemon PID 文件统一放在实际数据库目录；Desktop、daemon 拉起的 Runtime、outer supervisor child 与 autostart 入口都携带非敏感 `role + installId` marker。仅凭 PID 文件或孤儿枚举强杀前会读取目标命令行并精确校验 marker，防止 PID 重用和命令行子串误杀；Windows 使用 CIM exact-token 筛选，非 Windows 使用 `ps` 枚举后复用同一 exact-token identity fence；pipe secret 不进入 argv。
- 最新增量门禁：Protocol marker/PID 6/6、Desktop 生命周期 3 files / 17 tests、Runtime daemon/Codex/Session Host 8 files / 60 tests；Protocol/Runtime/Desktop typecheck 通过，`git diff --check` 通过。
- 根 typecheck 20/20、lint 11/11（0 error）、build 11/11 通过。最终受控串行根测试 `TURBO_CONCURRENCY=1 pnpm test` 为 20/20 Turbo tasks：Desktop 166 files / 1305 tests、Runtime 130 files / 918 tests 全部通过。Windows watchdog ready 的 fail-closed 窗口按真实高负载冷启动调整为 30 秒，生产健康 deadline 仍为 3 分钟；对应定向测试 6/6 通过。

### 待完成

- 外部事件核心入口与 lease/heartbeat contract 已完成；后续按具体平台补配置 UI、HTTP webhook 暴露和 bot 渠道凭据。
- Desktop 审批断连/重连恢复与 approve/deny 真实验收已完成；复验命令为 `pnpm selftest:approval-reconnect`。
- Claude Code 迁移官方 Agent SDK 属于下一阶段，不与本次 Codex/daemon 生命周期收尾混做。

### 真实 app-server 结果

- 本机 Codex 0.145.0 已完成 `initialize`、`thread/start`、连续 `turn/start`、新进程 `thread/resume`、MCP 工具、reasoning、usage 与终态投影。
- 修正了官方 schema 对齐项：`turn/start.sandboxPolicy`、空 providerModelId 回退、`error.willRetry=true` 非终态；`codex-default` 宿主哨兵不再作为真实模型 ID 下发。
- `pnpm selftest:codex-persistent` 在 62 秒内以两个 app-server PID 完成三轮，三轮 native thread ID 一致，第二、三轮均召回首轮随机令牌。先前 503/404 结论已由本次成功实测取代。

## 当前状态：2026-08-25 · 图片上传、资源链接与 Compose 对齐完成

### 实现结果

- 偏好主题图片导入已切换为 CSP-safe `FileReader` 数据 URL；上传、压缩、取色和持久化链路完整，聊天图片附件继续复用同一数据 URL 预览路径。
- 助手 Markdown 中的工作区文件、图片、目录和网页链接现在是可交互资源：文件带 `FileCode2/FileImage/FolderOpen` 图标并进入文件/审阅标签，`path:line[:column]` 会传递到编辑器定位；网页带 `ExternalLink` 图标并走受控外部 URL IPC。
- 图片壁纸下的消息 minimap 保持透明轨道，不再叠加半透明胶囊、模糊或描边；普通、悬停和活动短横线独立提供对比度和聚焦反馈。
- Compose 已对齐 NewMax 的主几何：`744 × 112px` 外壳、20px 圆角、内容自适应模型按钮、全宽 `/` 面板、32px 横向命令行、120ms 入场动效；左下角 `+`/Skill 分别插入 `@`/`/`，语音按钮提供开始/停止/错误状态。

### 当前验证

- Desktop focused tests `5 files / 47 tests` 全绿；Desktop typecheck、正式 build、Prettier 和 `git diff --check` 通过。
- 真实 Electron `1424 × 861` 实测：主题图片上传无“图片内容无法读取”错误；亮色和深色图片壁纸的 minimap 均清晰；Compose 为 `744 × 112px`，`/` 面板约为 `744 × 165px`，模型按钮为 `148 × 30px`，模型菜单与 Provider 子菜单均在视口内。
- 当前窗口已恢复到亮色 `preset-lakewood` 主题；daemon 与 Runtime 未被本轮 Renderer/Main 验收操作停止。

## 当前状态：2026-09-02 · NewMax 浏览器与双设计稿工作区实现完成

### 本轮完成

- `A1` 已落地：Browser Pane 的单一内嵌 WebView 同时承载用户导航和 AI `browser_*` 动作；Renderer Worker 只执行 Runtime 已校验的命令，页面权限、幂等和 durable command 状态继续由 Runtime 管理。工具栏已覆盖地址/搜索、前进后退、刷新停止、页内查找、缩放、设备预览、截图、下载、外部打开和人工聚焦。
- `E1` 已落地：Runtime 提供与 NewMax 协议兼容的 loopback WebSocket 扩展 Host，持久管理配对 Token 和 pairing id，校验协议版本与认证，允许新连接替换陈旧 service worker，并暴露状态、重启、重置配对和打开扩展目录命令；Desktop 卡片呈现真实连接与错误状态。
- `B3` 已落地：`design-html` 与标准 `.excalidraw` scene JSON 均可解析、预览和保存；Excalidraw 编辑器及样式按需加载，支持编辑、冷恢复、PNG/SVG 导出，并可将选定 frame/children 通过真实 `design.generate` Provider 请求生成自包含 HTML。
- `C1/D1` 已落地：HTML 与画布使用项目内稳定路径、读取哈希和乐观冲突保护；受控 `newmax-local-web` 页面注册器支持 HTML 相对资源并拒绝越界/符号链接逃逸；新的真实 `browser_open` 完成事件会创建或聚焦浏览器标签并导航，历史回放不会重复打开。

### 当前验证

- 浏览器页面注册与工具栏、扩展 Host/Runtime/设置卡、Excalidraw 文档/懒加载/UI/导出、`design.generate`、HTML/画布浏览器打开和内联可视化均有定向回归；当前已知 Runtime `19` 项、Desktop `10` 项聚焦检查通过，Runtime/Desktop typecheck 通过。

### 待完成

- AI 浏览器五步网络交互的历史会话曾停在 Renderer 超时；`tool` 类活动事件订阅已修复并通过全量回归，本轮没有把未重新执行的模型网络交互记作成功。

## 当前状态：2026-09-02 · Runtime 冷启动可观测性与 readiness 收口

### 本轮完成

- Desktop 与 daemon 的 Runtime 冷启动等待统一为 120 秒，覆盖大数据库迁移、索引修复和浏览器宿主初始化。
- Runtime `session.runtime.start()` 完成后通过私有 IPC 发送 ready；daemon 状态快照提供 `runtimeReady`，旧 Runtime 继续支持活动管道回退。
- supervised Runtime 和 Desktop fallback Runtime 的 stdout/stderr、spawn/ready/error/exit 生命周期追加到数据库同级的 `runtime-<installId>.log`；daemon 自身日志仍在 `daemon.log`。
- 子进程 error/exit 会立即结束 readiness 等待，daemon 可按退避策略重新拉起，避免等待窗口阻塞重启。

### 本轮验证

- Runtime daemon child/entry/manage 定向测试通过；Desktop runtime-supervisor 定向测试通过。
- Runtime 与 Desktop typecheck 通过。
- 最终根级测试 `20/20` tasks（Desktop `221 files / 1770 tests`、Runtime `172 files / 1260 tests`）通过；typecheck `20/20`、lint `11/11`（0 error，保留既有 Hook warnings）、build `11/11` 和 `git diff --check` 通过。
- Electron 已按最新构建重启并保持运行；真实窗口可进入浏览器工作区并显示 Profile、录制、自动化任务、扩展和内置浏览器面板。大数据库冷启动约两分钟后 Runtime ready，日志确认 pipe/gateway/hello 正常。

### 待完成

- AI 浏览器五步链路的历史会话曾在渲染服务超时处停止；本轮不把未重新执行的网络模型交互记为成功，相关 `tool` 事件订阅修复已由 Runtime/Desktop 全量回归覆盖。

## 当前状态：2026-09-19 · Agent Library 后台子任务

### 本轮完成

- 对照 NewMax 的异步 Agent 生命周期，将 `agent_run` 从同步等待改成“立即返回 childRunId + 后台执行”。原先截图中的 90 秒 host 等待超时不再覆盖实际子任务执行时间。
- 后台子任务默认绝对上限 7200 秒，并在连续 1800 秒没有运行事件时终止；进度事件会重置无进展计时器，绝对计时器不移动。
- 父回答结束后，子任务的实时投影继续合并进原消息；终态持久化在父助手消息中，重新打开对话可恢复结果、工具调用、用量和耗时。
- 子任务卡片现有停止操作继续调用独立 child run 的 cancel，不影响父回答。
- 历史恢复已兼容完整 MCP 工具名与 `{ content: [...] }` 宿主结果包装；完成卡片会留在原执行过程位置并自动展开最终报告。
- 卡片显示 Agent 图形头像，不再显示名字缩写占位；标题下的内部 `agentId` 已移除。内联和兜底卡片共用同一组件。
- 命令及其它工具的新版“输入 → 原始工具 → 输出”界面代码未回退；此前看到旧 UI 是生产 Shell 体积门禁失败后窗口仍加载 9 月 14 日旧 Renderer 所致。当前改用最新 development Renderer。

### 本轮验证

- Runtime `agent_run` 异步返回与父信号解耦测试通过；`chat-tools` schema 回归通过。
- Desktop 委派卡片 21/21 通过；Runtime/Desktop typecheck 通过。
- Desktop 执行过程组合回归共 91/91 通过，`git diff --check` 通过，development Shell 构建成功。
- Playwright 真实 Electron 验收用户截图对应的历史消息：完成卡片 1 张且保持展开，1790 字最终报告可见，12 条工具记录保留，头像为 SVG 图像，内部 ID 为 0；命令工具使用新版输入/输出面板，控制台错误为 0。
- 生产 Shell 仍被 `3,071,044 / 3,060,000` 体积门禁拦截，未调整预算；这不影响当前 development Renderer 手测。
- `external-kernel-platform-tools.test.ts` 全文件中现有 `create_agent` 相关 6 条用例仍受工作树既有 Agent Store 改动影响；本轮新增的 `agent_run` 用例单独通过。

## 当前状态：Browser Automation Studio 执行闭环已完成（2026-09-22）

- WorkflowVersion 已接入确定性回放、运行变量、站点授权预检、持久 Run/逐步日志、每步全页截图、失败定位和成功/失败计数。
- 已发布且无需运行输入的任务可手动启停固定间隔调度；调度由实际持有 Browser Host 的受管 Runtime 执行，桌面窗口关闭不影响后台所有者。
- Storage、Protocol、Runtime、Desktop 类型检查和生产构建通过；Storage 89 项、Runtime Browser 68 项、Desktop 工作流与 BrowserStage 64 项、Protocol payload 2 项回归通过。
- 真实 Edge 三路径冷重启 E2E 全部通过，截图人工检查确认接管卡可见、完成后退场且布局正常。后续范围为步骤编辑、秘密值运行时注入和 Workflow 中途登录 handoff。
