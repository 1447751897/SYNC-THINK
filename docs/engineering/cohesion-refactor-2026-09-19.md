# 高内聚、低耦合重构落地记录

日期：2026-09-19。范围：用户批准架构审查方案后的行为修复、调度契约迁移、审查/返工决策抽离、委派事件原子投影、执行生命周期、准入、消息历史、卡片投影、聊天队列、会话 IPC 与共享 UI 边界拆分。

## 阶段收口审计（2026-09-20）

- 最初审查中的 P0/P1 问题、R-1～R-6 重复边界、D-1～D-19 已确认死代码/兼容入口和 B-1～B-4 竞态均已修复、收敛或明确保留；Main 传输注册、生产依赖无环和专属边界由 210 项架构测试持续约束。
- 182 批累计迁移 340 个 Runtime/Desktop 调用点，移除 49 个转换/适配方法和 43 个原始状态容器（含 1 个纯写入死状态），并合并 1 份重复协调模块。`runtime.ts` 仍有 32,439 行，但核心状态所有权、纯投影、持久 Repository、业务窄端口与传输注册已形成独立可测边界。
- 本阶段完成标准是高风险行为、重复真源、隐式状态所有权、传输耦合、循环依赖和关键测试缺口关闭，不是把大型门面机械拆到任意行数。Runtime、ChatView、ModelSettings、ShellApp 和 AbilityCenterPage 的继续瘦身只在真实变更热点、缺陷或性能证据出现时进行。
- 最终证据：第 182 批 54 项定向回归、全仓 typecheck 22/22 task、架构测试 210/210、956 文件扫描、构建 13/13 和 diff check 通过。全仓 lint 的 7 个未修改基线错误及 Storage rollback 测试临时库删除 `EBUSY` 单独登记为质量债务，不与本阶段架构迁移混改。

## 第一百八十二批：Kernel Conversation Session Repository 与 Runtime 解耦

- 新增 `KernelConversationSessionRepository`，拥有外部 Kernel 会话持久记录的解析、可选字段归一化、设置仓读穿缓存、替换保存和带期望 session ID 的条件删除；模块只依赖 Shared 值守卫和最小设置仓接口。
- Runtime 保留 Gateway continuation 生命周期和跨边界协调；加载、保存与清除 3 个调用点迁到 Repository，删除原始 Map 与门面解析函数，文件由 32,512 行降至 32,439 行。架构门禁禁止旧 Map/解析函数回流，并要求持久化职责留在 Repository。
- Repository 9 项、Kernel session gap 12 项、external kernel run 33 项，共 54 项定向回归通过；Runtime 类型检查、lint/format、210 项架构测试、956 文件扫描与 13 包整仓构建通过。Desktop initial/total JS 保持 2,108,851 / 2,978,620 字节。
- 本批后不再新增横向拆分批次；阶段完成度审计已确认最初审查强制项关闭。仍然庞大的 Runtime/Renderer 文件按后续真实变更热点渐进拆分，不以清零行数为完成标准。

## 第一百八十一批：Goal Execution State Registry 与 Runtime 解耦

- 新增 `GoalExecutionStateRegistry`，拥有 Goal 内存缓存、Run→目标修订绑定和待续轮标记；Run 修订通过一次性 `take` 领取，避免终态路径分步 get/delete。
- Runtime 保留设置仓持久化、Goal 修订计算、Token/轮次限制和模型执行；加载/保存、usage 归属、暂停/清除、续轮与终态判断等 17 个调用点迁到注册表，删除三份裸容器，文件由 32,510 行增至 32,512 行。
- Registry 与内核准入共 9 项、Runtime 类型检查、lint/format、209 项架构测试、955 文件扫描与 13 包整仓构建通过；架构门禁禁止旧 Goal 状态字段回流。

## 第一百八十批：Thread Version Projection 与 Runtime 解耦

- 新增 `ThreadVersionProjection`，拥有持久 thread/task 版本的读取、精确记录、事件重放单调推进、checkpoint 替换、只读视图和隔离事务副本；checkpoint 恢复先完成原格式校验，再一次性替换投影。
- Runtime 保留事件事务和 checkpoint 格式编排；创建/恢复、OCC、任务版本推进与持久事件提交等 36 个调用点迁到投影边界，删除裸 Map。持久字段和错误合同不变，文件由 32,486 行增至 32,510 行，新增行来自显式语义调用和模块接线。
- Projection 与追加消息并发边界共 27 项、Runtime 类型检查、lint/format、208 项架构测试、954 文件扫描与 13 包整仓构建通过；架构门禁禁止旧 `threadVersions` Runtime 字段回流。

## 第一百七十九批：Conversation Transient State Registry 与 Runtime 解耦

- 新增 `ConversationTransientStateRegistry`，把每个 thread 的单调 stream sequence 和可选活动快照收敛为一个生命周期条目；删除快照保留 cursor 水位，设置快照和推进序列互不覆盖。
- Runtime 保留 replay 缓冲、投影构造和帧广播；订阅恢复、文本/工具/委派投影与终态清理等 19 个调用点迁到注册表，删除两份并行 Map，并修正集成测试残留的旧订阅字段接线。显式注册表字段使文件由 32,485 行微增至 32,486 行，但瞬态状态不再存在双容器一致性风险。
- Registry 与瞬态投影共 9 项、Runtime 类型检查、lint/format、207 项架构测试、953 文件扫描与 13 包整仓构建通过；架构门禁禁止旧 snapshot/sequence 字段回流。

## 第一百七十八批：Owned Subscription Registry 与 Runtime 解耦

- 新增泛型 `OwnedSubscriptionRegistry`，拥有 stream ID 登记、查找、删除、按连接所有者批量释放、可变遍历和清空生命周期；注册表不依赖 Socket 或事件协议，并保留订阅对象引用以兼容 cursor/phase 原位更新。
- Runtime 继续负责事件 replay、过滤、帧发送和瞬态阶段规则；持久事件订阅与会话瞬态订阅的 13 个调用点迁到两个注册表实例，客户端断线的重复扫描合并，删除两份裸 Map。显式泛型字段使文件由 32,482 行微增至 32,485 行，但连接所有权和清理职责已形成可独立测试边界。
- Registry 4 项、Runtime 类型检查、lint/format、206 项架构测试、952 文件扫描、`git diff --check` 与 13 包整仓构建通过；架构门禁禁止旧订阅 Map 字段回流。

## 第一百七十七批：Refresh Coordinator 提升到 Shared

- 将 Desktop 既有 `RefreshCoordinator` 提升为 Shared 纯并发协调器，集中 generation、等待者、运行状态和尾随刷新；策略选项明确区分 Desktop 延迟合并与 Runtime eager/失败全体返回语义。
- ShellApp 删除重复实现并直连 Shared；Runtime 本地 Skill 刷新删除 requested/applied generation 与 in-flight Promise 三份状态，仅保留一次 `request` 调用，文件由 32,496 行降至 32,482 行。
- 协调器 5 项、Shared/Runtime/Desktop 类型检查、lint/format、205 项架构测试、951 文件扫描与 13 包整仓构建通过；架构门禁禁止 Desktop 副本和 Runtime 原状态回流。

## 第一百七十六批：MCP Auth Config Repository 与 Runtime 解耦

- 新增 `McpAuthConfigRepository`，拥有 MCP 授权配置的归一化、设置仓读穿缓存、明文保存、旧 SecureStore handle 解析/迁移及空记录删除语义；模块只依赖窄设置仓接口。
- Runtime 保留 SecureStore 密钥读取、MCP 注册与回滚编排；注册、列表、能力治理、工具刷新、聊天登记和删除等 16 个调用点改用 Repository，删除裸 Map 与 3 个辅助方法，文件由 32,565 行降至 32,496 行。
- Repository/摘要共 11 项、Runtime 类型检查、lint/format、204 项架构测试、951 文件扫描与 13 包整仓构建通过，架构门禁禁止旧字段和方法回流。

## 第一百七十五批：Local Skill Watch Registry 与 Runtime 解耦

- 新增 `LocalSkillWatchRegistry`，拥有本地 Skill watcher 的目录归一化、去重登记、活动查询和 cleanup；批量停止先释放注册表所有权，并在单个 cleanup 失败时继续清理其余 watcher。
- Runtime 保留来源选择与文件变化后的刷新/事件编排，扫描摘要、启动、重启和关闭等 7 个调用点改用注册表；删除两份裸状态，文件由 32,580 行降至 32,565 行，架构门禁禁止旧字段名回流。
- Registry 5 项、Runtime 类型检查、lint/format、203 项架构测试、950 文件扫描与 13 包整仓构建通过。

## 第一百七十四批：Completed Delegated Run Registry 与 Runtime 解耦

- 新增泛型 `CompletedDelegatedRunRegistry`，把委派子 Run 的终态快照和终态枚举合并为一个记录，支持状态先到、完整记录覆盖、原子领取和删除。
- Runtime 的完成、取消、超时、后台释放、前台领取与瞬态投影等 9 个调用点改用注册表；删除两个并行 Map，文件由 32,586 行降至 32,580 行，架构门禁禁止旧终态 Map 回流。
- Registry/委派成功失败取消/执行控制器/终态事件投影共 48 项、Runtime 类型检查、lint/format、202 项架构测试、949 文件扫描与 13 包整仓构建通过。

## 第一百七十三批：Active Run Registry 与 Runtime 解耦

- 新增 `ActiveRunRegistry`，拥有活动 Run ID 的去重登记、完成、包含查询和健康快照；模块不依赖 Runtime、Provider、Kernel 或 Store。
- 健康检查、忙碌判断和清理监听等 12 个调用点改用注册表，删除裸 Set 与两个中转方法；文件由 32,594 行降至 32,586 行，架构门禁禁止旧字段和方法名回流。
- Registry/健康检查/原生 Run/追加消息/外部 Kernel/关闭/守护进程完成共 73 项、Runtime 类型检查、lint/format、201 项架构测试、948 文件扫描与 13 包整仓构建通过。

## 第一百七十二批：Keyed Turn Queue 与 Runtime 解耦

- 新增 `KeyedTurnQueue`，拥有按 key 的 Promise Tail、同 key 串行、不同 key 并行、幂等释放和关闭等待；模块不依赖 Runtime、Kernel 或 Store。
- Runtime 只选择外部 Kernel 会话 key 并消费 lease，删除原始 Tail Map 与排队私有方法；文件由 32,627 行降至 32,594 行，架构门禁禁止旧字段和方法名回流。
- 队列/外部 Kernel/关闭回归共 41 项、Runtime 类型检查、lint/format、200 项架构测试、947 文件扫描与 13 包整仓构建通过。

## 第一百七十一批：Kernel Tool Progress Registry 与 Runtime 解耦

- 新增 `KernelToolProgressRegistry`，拥有按 Run/Tool 的瞬态输出状态、最新非空行选择、UTF-8 字节累计、完成清理与 Timeline 装饰；模块只依赖 Protocol 的 Assistant Timeline 类型。
- Runtime 保留 Kernel 事件与瞬态帧协调，删除嵌套 Map 和纯转发私有方法，9 个调用点改用窄 API；文件由 32,653 行降至 32,627 行，架构门禁禁止旧字段名回流。
- Registry/Kernel 适配器/外部 Kernel 主链共 71 项、Runtime 类型检查、lint/format、199 项架构测试、946 文件扫描与 13 包整仓构建通过。

## 第一百七十批：AbortController Registry 与 Runtime 解耦

- 新增 `AbortControllerRegistry`，让 keyed `AbortController` 的创建、可选替换中止、条件删除和批量关闭由专属模块拥有。
- 普通 Run 与提示词优化保留两个独立实例；后者用 `deleteIf(key, controller)` 处理并发替换，旧请求收尾不会清理新请求。
- Runtime 删除两个原始 Map，15 个调用点改用注册表，文件由 32,661 行降至 32,653 行；架构门禁禁止旧字段名回流。
- 36 项相关回归、Runtime 类型检查、改动文件 lint/format、198 项架构测试、945 文件扫描与 13 包整仓构建通过。

## 第一百六十九批：External Event Execution Registry 与 Runtime 解耦

- 新增 `ExternalEventExecutionRegistry`，拥有事件租约、event→execution、run→event 和清理监听去重状态；模块不依赖 Runtime、Daemon Client、Store 或计时器。
- Runtime 的并发准入、心跳快照、租约读取和终态清理改用注册表，网络发送与结果判定仍由用例层组合；删除三个相互依赖的容器，从 32,662 行降至 32,661 行。
- Registry 单元 4 项、真实投递去重集成 1 项、Runtime 类型检查、lint/format、197 项架构测试、944 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 为 2,108,693 / 2,978,462 字节。

## 第一百六十八批：In-flight Promise Registry 与 Runtime 解耦

- 新增 `InFlightPromiseRegistry`，拥有待完成 Promise 集合、双终态释放、数量观测和当前快照等待；模块不依赖 Runtime、Kernel、Daemon 或后台任务实现。
- 后台任务、Kernel 执行和守护进程完成回执分别使用独立实例，避免业务生命周期互相污染；Runtime 删除三个 Set 和重复清理逻辑，从 32,676 行降至 32,662 行。
- Registry/Kernel 关闭回归 8 项、Runtime 类型检查、lint/format、196 项架构测试、943 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 为 2,108,693 / 2,978,462 字节。

## 第一百六十七批：Scheduled Task Run Registry 与 Runtime 解耦

- 新增泛型 `ScheduledTaskRunRegistry`，拥有定时任务 Run 的活动集合与终态元数据；模块不依赖 Runtime、Scheduler、Daemon Client 或具体 Store。
- `register` 同步建立两类状态，`finishExecution` 只退出并发计数，`takeMetadata` 只消费历史回填数据，保留原先不同的清理时机。Runtime 删除原始 Set/Map，从 32,679 行降至 32,676 行。
- Registry/分发/历史摘要单元 12 项、Runtime 类型检查、lint/format、195 项架构测试、942 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 为 2,108,693 / 2,978,462 字节。

## 第一百六十六批：Platform MCP Run Registry 与 Runtime 解耦

- 新增泛型 `PlatformMcpRunRegistry`，拥有每个外部内核 Run 的冻结目录、调用重放缓存和 Capability Broker；模块不依赖 Runtime、Kernel Broker 或具体工具定义。
- 重放 API 保留原语义：相同 key 共享首个 Promise，仅成功结果继续缓存，业务失败删除后可重试；Run 终态通过一个入口释放三类状态。Runtime 删除三个 Map，从 32,702 行降至 32,679 行。
- Ask/外部内核测试从直接写目录 Map 迁到 Registry API。Registry 单元 4 项、工具链回归 14 项、Runtime 类型检查、lint/format、194 项架构测试、941 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 为 2,108,693 / 2,978,462 字节。

## 第一百六十五批：Assistant Timeline Change Tracker 与 Runtime 解耦

- 新增 `AssistantTimelineChangeTracker`，独占按 Run/Segment 的已提交指纹 Map，并通过选择、提交和终态释放三步表达增量生命周期；模块不依赖 Runtime、Protocol Segment 或 SQLite。
- Runtime 继续清洗 Segment 并执行 Store upsert，成功后才提交指纹；严格写入仍强制落盘且不修改普通增量缓存。原嵌套 Map 删除并受架构门禁保护，文件保持 32,702 行。
- 前序 Run/Kernel Registry 增加只读 `count()`，追加消息失败事务测试改用公开注册表 API，消除 8 项白盒测试漂移。Tracker 单元 4 项、时间线/消息边界/注册表回归 34 项、Runtime 类型检查、lint/format、193 项架构测试、940 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 为 2,108,693 / 2,978,462 字节。

## 第一百六十四批：Capability Usage Recorder 与 Runtime 解耦

- 新增 `CapabilityUsageRecorder`，用最小事件端口封装 Skill/MCP usage key 的进程内幂等记录；Store 写入成功后才登记 key，异常不会吞掉重试机会，模块不依赖 Runtime 或 Storage 具体实现。
- Runtime 只负责把 Demo Run 映射成 workspace、agent、run 与 token 字段；原始 Set 和旧 once 方法删除并受架构门禁保护。文件保持 32,702 行，本批收口的是状态所有权与基础设施依赖。
- Recorder 单元 3 项、Capability Governance 集成 1 项、Runtime 类型检查、lint/format、192 项架构测试、939 文件扫描和 13 包整仓构建通过；Capability Store 7/8 通过，唯一失败是既有迁移清单期望滞后于 `0056`–`0058`。Desktop initial/total JS 为 2,108,693 / 2,978,462 字节。

## 第一百六十三批：Durable Tool Approval Ledger 与 Runtime 解耦

- 新增 `DurableToolApprovalLedger`，通过事件端口选择 Store 权威投影或内存回退，并拥有 approval/thread/run 范围筛选；模块复用纯 Tool Approval 读模型，不依赖 Runtime。
- Runtime 的审批事件记录、失活审批读取和待审批列表只调用 ledger；删除回退 Map 与两个中转方法，从 32,723 行降至 32,702 行。
- Ledger 单元 3 项、审批恢复/事件分页集成 13 项、Runtime 类型检查、lint/format、191 项架构测试、938 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 为 2,108,693 / 2,978,462 字节。

## 第一百六十二批：会话上下文纯写入状态清理

- 审计确认 `contextRunByThread` 在快照缓存接管读取后仅剩三类维护写入，没有状态消费者，属于重复且会误导生命周期所有权的死状态。
- 删除 Map 及模型窗口更新、消息失效、Provider 请求中的 `clear/delete/set`，并加入禁止回流规则；Runtime 从 32,742 行降至 32,723 行。
- Context Status/Compact 与外部 Kernel 回归 47 项、Runtime 类型检查、lint/format、190 项架构测试、937 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 为 2,108,693 / 2,978,462 字节。

## 第一百六十一批：Compact 边界缓存与 Runtime 解耦

- 新增 `ConversationCompactBoundaryCache`，通过事件最小端口拥有缓存、最新序列恢复、线程/摘要过滤和引用隔离；模块不依赖 Runtime 或 Storage 具体类型。
- Compact 写入与 Provider 消息构建只调用缓存；Runtime 保留事件来源组合并删除裸 Map 与恢复方法，从 32,760 行降至 32,742 行。
- 缓存单元 4 项、Context Status/Compact 与外部 Kernel 回归 47 项、Runtime 类型检查、lint/format、189 项架构测试、937 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 为 2,108,693 / 2,978,462 字节。

## 第一百六十批：会话上下文修订注册表与 Runtime 解耦

- 新增 `ConversationContextAmendmentRegistry`，拥有线程级来源排除的替换、读取、清理及引用隔离；模块不依赖 Runtime、Provider 或上下文选择器。
- Context Amend、Context Status/Peek 与真实 Provider 请求只调用注册表；Runtime 删除裸 Map，从 32,761 行降至 32,760 行。
- 注册表单元 3 项、Context Amend 1 项、Context Status 14 项、Runtime 类型检查、lint/format、188 项架构测试、936 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 为 2,108,693 / 2,978,462 字节。

## 第一百五十九批：定时任务投递注册表与 Runtime 解耦

- 新增 `ScheduledTaskDispatchRegistry`，拥有投递开始、启动失败回滚、Run 绑定、终态领取及关闭快照；模块不依赖 Runtime、Daemon Client 或 Store。
- Runtime 的投递入口、Scheduled Run 创建/清理和关闭中止只调用注册表；删除任务 Set 与 Run→Task Map，从 32,769 行降至 32,761 行。
- 注册表单元 4 项、守护进程完成/中止/协议回归 23 项、Runtime 类型检查、lint/format、187 项架构测试、935 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 为 2,108,693 / 2,978,462 字节。

## 第一百五十八批：正式方案修订注册表与 Runtime 解耦

- 新增 `FormalPlanRevisionRegistry`，通过 Event 最小只读端口封装修订号缓存、倒序日志恢复、值过滤、记录和 Run 清理；模块不依赖 Runtime 或 Storage 具体类型。
- 平台/Claude 方案提交、规划终态校验和 Run 结束清理只调用注册表；Runtime 删除原始 Map 和事件扫描私有方法，从 32,779 行降至 32,769 行。
- 注册表单元 4 项、计划提交/恢复 33 项、未提交终态 1 项、Runtime 类型检查、lint/format、186 项架构测试、934 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 为 2,108,693 / 2,978,462 字节。完整瞬态流组合测试另有 3 个非本批委派用例失败，已保留记录。

## 第一百五十七批：挂起问询注册表与 Runtime 解耦

- 新增 `PendingAskRegistry`，封装 askId 注册、一次性领取、按会话查询最新项、显式删除和按 Run 批量取消；模块不依赖 Runtime、SQLite 或事件总线。
- Conversation Ask 回答/取消、平台工具问询、Claude 原生 Ask 与 Run 终态只通过注册表协作；测试同步从内部 Map 结构迁移到生命周期 API。Runtime 从 32,796 行降至 32,779 行。
- 注册表单元 4 项、问询与 Claude SDK 集成 54 项、Runtime 类型检查、lint/format、185 项架构测试、933 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 为 2,108,693 / 2,978,462 字节。

## 第一百五十六批：Policy Scope 验证与 Runtime 解耦

- 新增 `PolicyScopeService`，通过窄查询端口拥有 Workspace/Task/Agent 边界、delegate approval AgentVersion、Policy Save/List 作用域及 Task 适用性规则，不导入 SQLite Store。
- Policy、Participation Mode 与 Approval 用例只调用服务；命令帧、事务、事件和审批执行仍在 Runtime。六个私有方法删除，文件从 32,892 行降至 32,796 行。
- 服务单元 5 项、Policy/Approval 集成 21 项、Runtime 类型检查、lint/format、184 项架构测试、932 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 为 2,108,693 / 2,978,462 字节。

## 第一百五十五批：Run/Kernel 持久注册表与 Runtime 解耦

- 新增 `RunKernelRegistry`，以 Settings 最小端口封装 runId→kernelId 的懒加载、值过滤、幂等写入、最佳努力持久化和无写入事件回填；模块不依赖 Runtime 或 SQLite 实现。
- Runtime 删除内存 Map、loaded 标志及两个私有生命周期方法；消息列表只组合 Message Store 回填，Run 创建入口只记录映射。文件从 32,927 行降至 32,892 行。
- 注册表 3 项、消息分页/最终消息 2 项、重启持久化 10 项、Runtime 类型检查、lint/format、183 项架构测试、931 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 保持 2,108,693 / 2,978,462 字节。

## 第一百五十四批：会话上下文快照缓存与 Runtime 解耦

- 新增 `ConversationContextSnapshotCache`，集中 thread→model/kernel 嵌套存储及 `modelId + NUL + normalized kernelId` 键策略；缓存实现只依赖 `ContextSnapshot` 合同。
- Runtime 只表达命中、保存、线程失效或全量失效时机，删除私有 setter/key 和 Map 字段；持久消息的 Run 上下文失效仍保留在用例边界。文件从 32,946 行降至 32,927 行。
- 缓存 2 项、Context Status 集成 14 项、Runtime 类型检查、lint/format、182 项架构测试、930 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 保持 2,108,693 / 2,978,462 字节。

## 第一百五十三批：CC Switch 导入路径与 Runtime 解耦

- 新增纯 `cc-switch-import-path`，只负责显式路径/默认路径的选择、裁剪和缺失配置错误；Storage 的 HOME/USERPROFILE 与平台路径计算不进入领域策略。
- Preview/Import 两个用例直接组合 Storage 默认路径和纯策略，Runtime 删除私有路径方法并受 AST 门禁保护，文件降至 32,946 行。
- 路径策略 3 项、Provider 密钥补偿集成 6 项、Runtime 类型检查、lint/format、181 项架构测试、929 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 保持 2,108,693 / 2,978,462 字节。

## 第一百五十二批：Artifact 内容分类与 Runtime 解耦

- 新增纯 `artifact-content-policy`，集中 `text/*` 和 JSON/XML/JavaScript 的可比较/可合并判定；模块不接触 Store、协议帧或事务。
- Runtime 比较与显式合并用例改为直接调用该策略，删除私有 MIME 判断；AST 门禁防止该职责回流。`runtime.ts` 从 32,961 行降至 32,953 行。
- 策略 11 项、Artifact 命令集成 10 项、Runtime 类型检查、改动文件 lint/format、180 项架构测试、928 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 保持 2,108,693 / 2,978,462 字节。

## 第一百五十一批：提示词优化协议校验与模型选择解耦

- Protocol 新增 enhance/cancel 纯解析器，成为 160 字 request ID、100,000 字正文、可选模型 ID 裁剪与校验的唯一真源；Desktop 保留抛错适配，Runtime 使用可选结果处理 malformed frame。
- 新增 `prompt-enhancement-model-selection`，通过窄 Provider 候选合同选择启用模型并保留 catalog/upstream ID 与 demo fallback 语义；Runtime 删除私有 payload 解析和模型选择方法，文件降至 32,961 行。
- 三层定向 13 项、Protocol/Runtime/Desktop 类型检查、改动文件 lint/format、179 项架构测试、927 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 保持 2,108,693 / 2,978,462 字节。上一批门禁重复注册已修正，第一百五十批真实数量为 178 项。

## 第一百五十批：Provider Discovery 路由与 Runtime 解耦

- 新增纯 `provider-discovery-routing`，只接收协议、按协议适配器目录和 fallback，负责 Provider Discovery 适配器选择，不读取 Store、不执行网络请求。
- Runtime 各 Discovery/Run/视觉入口显式传入路由端口，删除私有 `resolveDiscoveryAdapter`；AST 门禁和 8 项定向测试锁定协议优先与默认回退语义。
- Runtime 类型检查、改动文件 lint、178 项架构测试、925 文件扫描和 13 包整仓构建通过；Desktop initial/total JS 为 2,108,693 / 2,978,462 字节，应用保持当前运行。

## 第一百四十九批：Provider 按 ID 查询与摘要投影解耦

- `provider-catalog-projection` 新增按 ID 查询的纯函数，统一目录查找和 `ProviderSummary` 公开字段投影；调用方只获得摘要 DTO，不接触目录条目内部结构。
- Runtime 的 Provider 新增、删除、清理和凭据更新入口直接组合 `providerStore.listProviders()` 与该投影，删除私有 `providerSummaryById`；AST 门禁阻止查询逻辑回流到 Runtime 门面。
- Provider 投影定向 6 项、Runtime 类型检查、改动文件 lint、177 项架构测试、924 文件扫描和 13 包构建通过；Desktop initial/total JS 保持 2,108,693 / 2,978,462 字节。

## 第一百四十八批：定时任务摘要选择与持久化限制解耦

- 新增纯 `scheduled-task-history-summary`，拥有“最新优先消息中首条非空助手文本”的选择及文本块组合规则；模块不接触 Runtime、Message Store 或 Scheduled Task Store。
- Runtime 只组合最近消息读取和摘要回填，Storage 继续独占 200 字截断。原私有 `fillTaskHistorySummary` 删除并由 AST 门禁防止回流；`runtime.ts` 从 32,965 行降至 32,952 行。
- Runtime/Storage 定向 8 项、Runtime 类型检查、改动文件 lint、176 项架构测试、924 文件扫描和 13 包构建通过。Desktop initial/total JS 保持 2,108,693 / 2,978,462 字节；无依赖变更、迁移、业务数据操作或应用重启。

## 第一百四十七批：平台 Agent Store 与 Runtime 门面解耦

- 新增 `kernel/platform-agent-store`，以 `listEffective` 窄来源端口把持久记录投影成平台工具所需合同；字段裁剪和可变数组复制集中在适配器，Kernel 工具不感知 SQLite Store。
- Runtime 只在组合点注入 `SqliteGlobalAgentStore`，原私有 `toPlatformAgentStore` 删除并由 AST 门禁防止回流；`runtime.ts` 从 32,983 行降至 32,965 行。激活、归档、持久化及 `agent_list` 展示仍归各自边界。
- 新适配器与平台工具定向 17 项、Runtime 类型检查、改动文件 lint、175 项架构测试、923 文件扫描和 13 包构建通过。Desktop initial/total JS 保持 2,108,693 / 2,978,462 字节；无依赖变更、迁移、业务数据操作或应用重启。

## 第一百四十六批：桌面等待命令查询与 DTO 投影解耦

- `desktop-waiting-projection` 在既有结果解析和窗口目标裁剪基础上，统一拥有任务归属优先级、工作区隔离、错误原因和完整公开 DTO；三个查询回调构成最小读端口，模块不依赖 Runtime 或 Storage 实现。
- Runtime 保留 Controller、Store、Mutation、持久事件和发布职责，列表及生命周期事件直接复用投影。原私有转换方法删除并由 AST 门禁防止回流；`runtime.ts` 从 33,013 行降至 32,983 行。
- Runtime 定向 23 项、Runtime 类型检查、改动文件 lint、174 项架构测试、922 文件扫描和 13 包构建通过。Desktop initial/total JS 保持 2,108,693 / 2,978,462 字节；无依赖变更、迁移、业务数据操作或应用重启。

## 第一百四十五批：长消息列表窗口职责从 ChatView 抽离

- 新增 `use-message-virtual-window`，独占视口采样、动态行高、ResizeObserver 生命周期和范围计算；它只依赖纯 `message-window` 算法，不依赖消息业务、Runtime bridge 或宿主实现。架构门禁禁止反向依赖恢复。
- `ChatView` 保留历史分页、缺口与消息组合，只消费 `startIndex/endIndex/spacer/rowRef` 结果。超过 80 条后 DOM 数量由历史总量改为视口相关有界值；导航与历史锚点通过显式 `forcedTargetId` 协作，而非扩大窗口化 Hook 的业务职责。
- Markdown 代码阅读状态从组件挂载生命周期解耦为 240 项 LRU，使窗口化卸载不改变展开/滚动行为。定向 82 项、Desktop 类型检查、改动文件 lint、173 项架构测试、922 文件扫描和 13 包构建通过；Desktop initial/total JS 为 2,108,693 / 2,978,462 字节。

## 第一百四十四批：MCP 目录投影与认证设置生命周期解耦

- 新增 `mcp-server-summary`，拥有 MCP Server 字段裁剪、工具数组复制、认证状态和远端密钥回显规则；Runtime 在调用前读取一次认证快照，投影模块不接触设置仓或 SecureStore。
- MCP 注册、启停、工具刷新、治理、聊天工具及查询入口直接组合纯函数；`SkillQueryContext` 只保留认证事实读取端口。旧私有方法删除并受门禁保护，`runtime.ts` 从 33,046 行降至 33,013 行。
- 新投影、MCP 命令、远端能力和治理定向 21 项、Runtime 类型检查/lint、172 项架构测试、921 文件架构扫描和 13 包构建通过。Desktop initial/total JS 保持 2,104,581 / 2,974,350 字节。无依赖变更、迁移、业务数据操作或应用重启。

## 第一百四十三批：Skill 版本兼容投影与 Runtime 解耦

- 新增 `skill-version-summary`，拥有 Skill 版本公开字段选择、数组复制及旧版 YAML 块标记描述的惰性修复；Metadata 缺少正文时只通过 `SkillSourceMdResolver` 窄端口读取源码。
- Skill 导入、启停、能力治理和查询入口直接组合投影，`SkillQueryContext` 不再注入 Runtime 方法。旧私有方法及专属类型导入删除并受门禁保护；`runtime.ts` 从 33,080 行降至 33,046 行。
- 新投影、Skill 命令和能力治理定向 7 项、Runtime 类型检查/lint、172 项架构测试、920 文件架构扫描和 13 包构建通过。Desktop initial/total JS 保持 2,104,581 / 2,974,350 字节。无依赖变更、迁移、业务数据操作或应用重启。

## 第一百四十二批：Workspace 存储记录与传输摘要解耦

- `summaries.ts` 新增 Workspace 纯投影，复用 Storage 已公开的偏好解析规则，集中 icon、sortOrder、hidden 与基础字段映射；损坏 JSON 继续回退为空偏好。
- Workspace 列表与更新两个入口改用纯函数，查询处理器不再从 `QueryContext` 注入映射回调。旧 Runtime 私有方法及三个偏好解析值导入删除并受门禁保护；`runtime.ts` 从 33,103 行降至 33,080 行。
- 纯摘要、工作区命令与上下文定向 17 项、Runtime 类型检查/lint、172 项架构测试、919 文件架构扫描和 13 包构建通过。Desktop initial/total JS 保持 2,104,581 / 2,974,350 字节。无依赖变更、迁移、业务数据操作或应用重启。

## 第一百四十一批：Approval 存储记录与传输摘要解耦

- `summaries.ts` 新增 Approval 请求纯投影，集中公开字段选择及委派 Agent 版本 ID 的 metadata 过滤；Runtime 的审批列表、决策、Memory 镜像、重审批和编排 gate 继续拥有各自状态与副作用。
- 8 个调用点迁移，旧私有方法删除并受门禁保护；非空字符串继续转换为 `AgentVersionId`，空白或非字符串值继续投影为 `undefined`，内部 metadata 不外泄。`runtime.ts` 从 33,131 行降至 33,103 行。
- 纯摘要、审批命令与恢复定向 26 项、Runtime 类型检查/lint、172 项架构测试、919 文件架构扫描和 13 包构建通过。Desktop initial/total JS 保持 2,104,581 / 2,974,350 字节。无依赖变更、迁移、业务数据操作或应用重启。

## 第一百四十批：Memory/Diagnostics 存储记录与传输摘要解耦

- `summaries.ts` 新增 Memory 变更、持久 Memory 条目与诊断记录三类纯投影；Runtime 的命令、审批镜像与诊断查询继续拥有 Store 操作和事件协议，只组合公开 DTO。
- Memory 内部条目对象、字符串数组及诊断 detail 改为复制投影，移除 Store/响应之间的可变引用耦合。7 个调用点迁移，三个旧私有方法及专属类型导入删除并受门禁保护；`runtime.ts` 从 33,182 行降至 33,131 行。
- 纯摘要、Memory 命令与项目上下文定向 16 项、Runtime 类型检查/lint、172 项架构测试、919 文件架构扫描和 13 包构建通过。Desktop initial/total JS 保持 2,104,581 / 2,974,350 字节。无依赖变更、迁移、业务数据操作或应用重启。

## 第一百三十九批：能力治理存储记录与传输摘要解耦

- `summaries.ts` 新增工作区激活、能力用量、Skill 发布草稿和能力整理报告四类纯投影；能力治理 handler 继续拥有查询、聚合、排序、Mutation 和错误协议，只组合公开 DTO。
- 草稿附件显式裁剪宿主扩展字段，报告分类数组与计数对象逐层复制。10 个调用点改用纯函数，四个旧私有方法删除并受门禁保护；`runtime.ts` 从 33,252 行降至 33,182 行。
- 纯摘要与能力治理定向 10 项、Runtime 类型检查/lint、172 项架构测试、919 文件架构扫描和 13 包构建通过。Desktop initial/total JS 保持 2,104,581 / 2,974,350 字节。无依赖变更、迁移、业务数据操作或应用重启。

## 第一百三十八批：Agent 版本存储记录与传输摘要解耦

- 复用 `summaries.ts` 承载 `AgentVersionRecord -> AgentBindingSummary / AgentDefinitionSummary`，绑定摘要与完整定义共用一条基础投影，不再由 Runtime 实例复制字段。
- 投影对 fallback、Skill/MCP、工具白名单、权限、视觉身份、审查行为和产物规则做逐层复制；7 个调用点只组合纯函数，Store Mutation、事件与传输仍属于用例层。两个旧私有方法删除并受门禁保护。
- 纯摘要 5 项、Agent/Workspace 集成 6 项、Runtime 类型检查/lint、172 项架构测试、919 文件架构扫描和 13 包构建通过。Desktop initial/total JS 保持 2,104,581 / 2,974,350 字节。无依赖变更、迁移、业务数据操作或应用重启。

## 第一百三十七批：目录记录读取与共享摘要投影解耦

- 复用现有 `summaries.ts` 而非新增同职责模块，加入 Global Agent、Team、Team Run 与 Conversation 四类纯转换。Team 与冻结 roster 共用成员投影，所有可变数组均复制，避免响应对象与 Store 记录共享引用。
- Runtime 的目录命令和聊天管理工具只负责读取/修改与传输，28 个调用点直接组合摘要函数；四个私有方法删除并受门禁保护，`runtime.ts` 从 32,222 行降至 32,142 行。
- 纯摘要 3 项、相关集成 15 项、Runtime 类型检查/lint、172 项架构测试、919 文件架构扫描和 13 包构建通过。Desktop initial/total JS 保持 2,104,581 / 2,973,350 字节。无依赖变更、迁移、业务数据操作或应用重启。

## 第一百三十六批：Provider Catalog 存储记录与传输 DTO 解耦

- `provider-catalog-projection` 作为纯适配边界接收 Storage 记录并返回 Protocol DTO，独占凭据组扁平化、Provider surface 推断、limits JSON 容错和可选视觉字段投影；没有 Runtime 实例、Socket 或 Store 方法依赖。
- Runtime 的 Provider 用例只负责读取/修改事实、调用投影并写响应，12 个入口共享同一规则。两个旧私有方法删除并受门禁保护，`runtime.ts` 从 32,283 行降至 32,222 行；Workspace 投影没有混入本模块。
- 纯投影 5 项、Provider 集成 13 项、Runtime 类型检查/lint、171 项架构测试、919 文件架构扫描和 13 包构建通过。Desktop initial/total JS 保持 2,104,581 / 2,973,350 字节。无依赖变更、迁移、业务数据操作或应用重启。

## 第一百三十五批：能力 Mutation 与标准开关表现解耦

- Skill/MCP 的全局启停只向 `ToggleControl` 提供当前值、busy、动态可访问名称和目标值回调；能力页继续负责 Mutation、缓存代次、目录重读和错误处理，共享组件不依赖能力类型。
- 工作区激活是整行菜单命令而非独立轨道按钮，继续拥有名称、busy 与内嵌视觉开关。架构规则用文件加静态类名精确描述这一变化点，不将整个 Ability Center 排除。
- 定向 45 项、Desktop 类型检查/lint、170 项架构测试、918 文件架构扫描和 13 包构建通过。Website 约 1,493 KiB；Desktop initial/total JS 为 2,104,581 / 2,973,350 字节。无依赖变更、迁移、业务数据操作或应用重启。

## 第一百三十四批：Preferences 业务包装与开关交互解耦

- `PreferenceToggle` 继续拥有可选文字与禁用外观包装，但把标准 switch DOM 和目标值计算交给 `ToggleControl`；字体、托盘和快捷键写入逻辑没有进入共享组件。
- `<i>` 只是历史 CSS hook，不承载业务语义，因此改为共享 thumb 的 `<span>` 并更新精确选择器。没有增加 render prop、元素类型或宿主特例，避免抽象反向耦合。
- 定向 10 项、Desktop 类型检查/lint、170 项架构测试、918 文件架构扫描和 13 包构建通过。Website 约 1,493 KiB；Desktop initial/total JS 为 2,104,581 / 2,974,401 字节。无依赖变更、迁移、业务数据操作或应用重启。

## 第一百三十三批：标准设置开关与异步宿主流程解耦

- Web Search、Desktop Update 与 Bot 只把受控值和目标值回调交给 `ToggleControl`；异步保存、乐观回滚、凭据校验、busy 状态和错误聚焦继续属于各宿主。共享组件没有获得 Runtime、Provider 或更新领域知识。
- Web Search 不再在保存函数内对旧快照取反，而是消费交互层给出的目标值。Preferences 的不同 thumb 标签和 Think 开关的冒泡控制仍是明确变化点，本批不以额外 props 抹平差异。
- 定向 75 项、Desktop 类型检查/lint、170 项架构测试、918 文件架构扫描和 13 包构建通过。Website 约 1,493 KiB；Desktop initial/total JS 为 2,104,581 / 2,974,467 字节。无依赖变更、迁移、业务数据操作或应用重启。

## 第一百三十二批：开关交互语义与宿主视觉策略解耦

- `ToggleControl` 成为 Renderer 设置表面的 switch 语义所有者，只接收受控值、禁用状态、可访问名称与变更回调；不读取设置、不保存草稿，也不规定宿主颜色、尺寸或布局。
- Model、Settings 和 Connector 三类开关继续传入各自 CSS 类。共享根节点同时提供两套既有状态属性，避免为了去重交互语义而耦合或改写视觉选择器；门禁聚焦已迁移的两个设置宿主。
- 定向 112 项、Desktop 类型检查/lint、170 项架构测试、918 文件架构扫描和 13 包构建通过。Website 约 1,493 KiB；Desktop initial/total JS 为 2,104,581 / 2,974,886 字节。无依赖变更、迁移、业务数据操作或应用重启。

## 第一百三十一批：生产 Composer API 与封闭测试兼容面解耦

- 当前文件引用选择以 attachment chip 为唯一交互，固定 reasoning ladder 也不需要模型级 coercion；因此删除只为旧单元测试保留、没有生产调用者的三个导出，而不是让测试成为兼容 API 的唯一所有者。
- 保留的测试覆盖当前 token 移除、附件去重/输出/显示解析和固定 reasoning ladder。防回流门禁按文件与符号精确约束，不把所有兼容或解析 helper 一概禁止。
- Composer 定向 36 项、Desktop 类型检查/lint、169 项架构测试、917 文件架构扫描和 13 包构建通过。Website 约 1,493 KiB；Desktop initial/total JS 保持 2,104,581 / 2,974,874 字节。无依赖变更、迁移、业务数据操作或应用重启；审计 D-19 已关闭。

## 第一百三十批：Telegram 传输生命周期与 Runtime 会话编排解耦

- `TelegramGateway` 成为 Telegram 网络协议、长轮询 runner、代理资源、typing 与分块回复的唯一所有者；`BotChannelGatewayManager` 继续串行化平台启停/测试，Runtime 只提供统一的 `NormalizedBotMessage -> executeBotConversationTurn` 业务回调。
- 删除 Runtime 内第二套 Telegram-only 配置 DTO、handler、Abort/Promise 生命周期、HTTP client 与专属会话执行。旧数据兼容留在真正的配置所有者 `BotChannelConfigStore`，避免为了迁移历史记录而继续运行第二套通道。
- Bot 通道定向 24 项、Runtime 类型检查/lint、168 项架构测试、917 文件架构扫描和 13 包构建通过。生产实现减少 601 行，封闭旧测试减少 85 行；无依赖变更、迁移、业务数据操作或应用重启，审计 R-3 已关闭。

## 第一百二十九批：MCP 目录读取生命周期与页面状态解耦

- `mcp-catalog-loader` 只拥有目录请求规范、Runtime bridge 身份隔离、in-flight 合并、成功快照和失效代次；不拥有 React loading/error、筛选、选择或乐观更新。四个 UI 消费者共享数据生命周期，但仍独立决定呈现与交互。
- 所有 MCP Mutation 在成功后显式失效，Ability Center 的用户刷新使用强制读取；失效前在途响应按新代次重读，失败条目可直接重试。Agent Library 继续用 `Promise.allSettled` 隔离 Skill/MCP 失败，目录共享没有把两个能力源耦成同成同败。
- 定向 251 项、Desktop 类型检查/lint、167 项架构测试、918 文件架构扫描和 13 包构建通过。Website 约 1,493 KiB；Desktop initial/total JS 为 2,104,581 / 2,974,874 字节。无依赖变更、迁移、业务数据操作或应用重启；审计 P0-2 已完整关闭。

## 第一百二十八批：密钥输入表现与凭据生命周期解耦

- `SecretInputControl` 是纯受控表现组件，只负责 input 类型、Eye 图标、可访问命令和禁用状态，不读取 Runtime、不缓存凭据，也不决定何时显示明文。三个设置表面共享稳定 DOM 合同和现有宿主 CSS。
- Model、Image、Bot 分别保留简单显隐、已存密钥异步 reveal、通道草稿显隐集合三种策略；Provider 包装器用具名组件表达差异。该拆分复用真正相同的行为，同时避免一个多模式密钥组件反向耦合三套状态机。
- 定向 123 项、Desktop 类型检查/lint、166 项架构测试、917 文件架构扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,104,098 / 2,974,283 字节。无依赖变更、迁移、业务数据操作或应用重启。

## 第一百二十七批：当前 Skill Hub 与 legacy 表面解耦

- `AbilitiesPage` 只保留实际挂载的 NewMax Skill/MCP Hub 与当前抽屉、弹窗；零调用的 `SkillSurface` 以及仅为它服务的分类、统计、筛选、说明和开关组件退役。通用空状态、加载状态与工作区激活控件因仍被当前页面消费而保留。
- 同步移除旧表面独占的 CSS 和一条只验证旧类名不存在的断言。窄 lazy entry 仍保护运行时导出规模，新增门禁则保护源码所有权；二者分别解决 bundle 边界与死代码回流，不再让 tree-shaking 掩盖第二套 UI。
- 能力页 43 项、Desktop 类型检查/lint、165 项架构测试、916 文件架构扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 保持 2,104,098 / 2,974,434 字节。无依赖变更、迁移、业务数据操作或应用重启。

## 第一百二十六批：二进制缩放事实与宿主展示策略解耦

- Shared 只拥有 1024 进位、单位索引和最大单位截断；BrowserStage、Artifact UI 与数据库 CLI 继续拥有各自的单位标签、精度和文本组合。这样消除算法副本，同时不把三个本就不同的产品展示强制统一。
- 三个消费者使用具名宿主格式函数，不再以通用 `formatBytes` 暗示相同语义。架构门禁覆盖已迁移文件，禁止局部缩放循环回流；共享测试覆盖 B/KiB/MiB/GiB、最大单位和 TiB 封顶。
- 定向 64 项、四包类型检查/lint、164 项架构测试、916 文件架构扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,104,098 / 2,974,434 字节。无依赖变更、迁移、业务数据操作或应用重启。

## 第一百二十五批：领域实现与异步分包入口解耦

- Shell 根目录不再提供 `AbilitiesPage` 兼容别名；类型消费者和测试直达能力域实现。异步加载入口位于能力域自身，并只投影 `AbilitiesPage` 这一运行时导出，使分包边界的存在理由从偶然转发变为显式 tree-shaking 合同。
- 直接动态导入完整实现的中间构建把零引用 `SkillSurface` 带入 chunk，使 total JS 从 2,973,954 增至 2,986,669；切换窄入口后回落至 2,973,984。门禁同时保护旧路径退役和窄入口，legacy 表面的源码删除按横向推进原则另列后续。
- 定向 123 项、Desktop 类型检查/lint、163 项架构测试、915 文件架构扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,103,809 / 2,973,984 字节。无依赖变更、迁移、业务数据操作或应用重启。

## 第一百二十四批：数值缩放机制与业务展示策略解耦

- `compact-number` 集中纯缩放、定点舍入和后缀拼接；对外暴露能力指标与 Provider token 两个语义入口。前者保持千位后大数取整且始终使用 k，后者保持 k/M 各一位，避免以一个“统一规则”改变现有界面。
- 能力辅助模块不再夹带跨指标格式化，Provider 汇总也不再私有复制算法；能力页的字节上限改用准确的指标策略命名。架构门禁禁止 Renderer Shell 再声明 `formatTokens`，促使新增调用选择真实语义。
- 定向 49 项、Desktop 类型检查/lint、162 项架构测试、915 文件架构扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,103,779 / 2,973,954 字节。无依赖变更、迁移、业务数据操作或应用重启。

## 第一百二十三批：技能市场传输摘要与安装包内容解耦

- Protocol 的浏览器安全子路径拥有六个作者技能包的稳定传输摘要；Runtime 通过 id 组合摘要与完整文件，继续负责安装包查询、复制和物化。目录事实不再同时存在于 Runtime 与 Renderer。
- Renderer 仅为旧桥保留从 Protocol 映射出的兼容数组，不拥有安装文件或简化 `SKILL.md`；当前 Runtime RPC 仍是运行时权威来源。门禁分别约束 Runtime 外层摘要字段和 Renderer 静态目录生成器，防止副本回流。
- 定向 46 项、三包类型检查/lint、161 项架构测试、914 文件架构扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,103,646 / 2,973,901 字节。无依赖变更、迁移、业务数据操作或应用重启。

## 第一百二十二批：vendor 资源配置与脚本生命周期解耦

- 通用 Renderer loader 只拥有脚本节点、监听器、并发缓存和失败重试状态；Mermaid、Xterm、Excalidraw 适配器只声明导出类型、资源路径、DOM 标记与错误文案。三个 vendor 的生命周期分支不再靠复制保持一致。
- stylesheet 注入也复用一个幂等辅助，但调用时机仍归适配器：Xterm 在入口即确保 CSS，Excalidraw 在首次脚本启动前准备 CSS。架构门禁只覆盖这三个已迁移适配器，未禁止其它确有独立语义的动态资源用例。
- 定向 14 项、Desktop 类型检查/lint、160 项架构测试、913 文件架构扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,103,646 / 2,975,138 字节。无依赖变更、迁移、业务数据操作或应用重启。

## 第一百二十一批：图像格式事实与宿主文件校验解耦

- `@sync-think/shared/node-image-validation` 成为受支持生成图像 MIME、扩展名和魔数的唯一规则边界；Runtime、Desktop Main 与 Adapters 共用同一 PNG/JPEG/WebP 事实，不再各自解析字节。
- 共享模块不拥有读取、真实路径、大小、哈希、替换检测或错误码。两个文件所有者继续在各自安全边界组合共享布尔判断，Provider Adapter 只消费格式检测结果；因此去重没有把宿主 I/O 或失败协议推入 Shared。
- 定向 43 项、四包类型检查/lint、159 项架构测试、912 文件架构扫描和 13 包构建通过。Website 约 1,493 KiB；Desktop initial/total JS 为 2,104,273 / 2,975,765 字节。无依赖变更、迁移、业务数据操作或应用重启。

## 第一百二十批：通用对象结构判定与 JSON 值守卫解耦

- `@sync-think/shared/value-validation` 成为通用 `Record<string, unknown>` 判定的唯一边界；五层 28 个消费者直接复用，宿主仍拥有字段白名单、解析结果、错误文本和持久化语义。
- 生产步骤执行器原本同名但返回 `Record<string, JsonValue>` 的递归 JSON 守卫改为 `isJsonRecord`。不强行复用通用守卫，避免类型签名暗示未经验证的属性都是 JSON 值；AST 门禁只约束通用 `isRecord` 的所有权。
- 定向 209 项、相关包类型检查/lint、158 项架构测试、911 文件架构扫描和 13 包构建通过。Website 约 1,493 KiB；Desktop initial/total JS 为 2,104,273 / 2,975,765 字节。无依赖变更、迁移、业务数据操作或应用重启。

## 第一百一十九批：字符分类规则与宿主校验协议解耦

- Shared 只拥有“字符串是否含 ASCII C0/DEL”这一纯分类；Protocol 继续组合长度、URL 和字段规则，Storage 继续拥有规范化与持久化错误。两处宿主不再靠复制三行算法保持一致。
- Shared 根入口可同时被浏览器安全的 Protocol 与 Node Storage 消费；AST 门禁禁止其它源码恢复同名实现。R-6 的控制字符子项已关闭，未把 `isRecord` 等不同规模的重复项混入本批。
- 定向 20 项、三包类型检查/lint、157 项架构测试、910 文件架构扫描和 13 包构建通过。Website 约 1,493 KiB；Desktop initial/total JS 为 2,104,315 / 2,975,807 字节。无依赖变更、迁移、业务数据操作或应用重启。

## 第一百一十八批：路径包含算法与文件系统信任校验解耦

- `@sync-think/shared/node-paths` 成为绝对路径纯词法包含的唯一实现，参数顺序统一为 root/candidate，并显式区分完整 Windows 路径与 POSIX 路径。Shared 根入口不导出该模块，避免浏览器消费者获得 Node 依赖。
- Desktop Main、Runtime、Storage 与 Workers 只复用词法规则；`realpath`、缺失父目录回溯、符号链接和 junction 判断继续由对应文件系统用例拥有，未把 I/O 或错误协议推入共享层。架构门禁阻止 Node 生产目录恢复本地 `isPathInside` / `isWithin`。
- 定向 136 项、五包类型检查、改动文件 lint、156 项架构测试、909 文件架构扫描和 13 包构建通过。Website 约 1,493 KiB；Desktop initial/total JS 为 2,104,315 / 2,975,807 字节。Desktop 全包 lint 的 6 条独立既有 error 已记录但未混入本批；无迁移、业务数据操作或应用重启，审计 R-5 已关闭。

## 第一百一十七批：Browser payload 规则与宿主失败协议解耦

- `@sync-think/protocol/browser-payloads` 拥有 18 个 Browser payload 的纯规范化规则；Runtime 通过别名保留 `T | undefined`，Desktop 通过通用 `requirePayload` 保留命令特定抛错。规则归协议，失败呈现归宿主，Electron/Main/Runtime 实现均不进入共享模块。
- 选择独立 package 子路径而非 Protocol 根导出，避免浏览器构建解析 `handshake` / `pipe` 的 Node 内置模块。原六份规则实现净减少 322 行，变量长度漂移被统一；AST 门禁禁止适配器重新声明八类校验函数。
- Protocol/Desktop/Runtime 定向 115 项、三层类型检查、定向 lint、155 项架构测试、908 文件架构扫描和 13 包构建通过。Website 约 1,493 KiB；Desktop initial/total JS 为 2,104,315 / 2,975,807 字节。无迁移或业务数据操作，当前应用未重启；审计 R-2 已关闭。

## 第一百一十六批：执行事实投影与 Renderer 格式化解耦

- Runtime `run-process-view` 成为事件到 `RunProcessView` 的唯一投影边界；删除 Renderer 中 1,096 行重复实现及 836 行只证明副本自身的测试。既有 Runtime 投影、结果、文件内容和分页 57 项回归继续覆盖实际生产规则。
- Renderer 只保留无业务事件依赖的计数、耗时、时间与模型标签格式化，并直接消费 Protocol `RunProcessView`。接线测试确认旧模块不存在且生产组件不出现 `projectExecutionProcess`，防止相同事件规则再次散回表现层。
- Desktop/Runtime 定向 116 项、Desktop 类型检查、定向 lint、154 项架构测试、907 文件架构扫描和 13 包构建通过。Website 约 1,493 KiB；Desktop initial/total JS 为 2,104,315 / 2,975,807 字节。无新增依赖、迁移或业务数据操作，当前应用未重启；审计 R-1 已关闭。

## 第一百一十五批：用量聚合与明细传输解耦

- Protocol 将“是否需要请求明细”和“最多返回多少明细”声明为查询意图；Runtime 始终基于完整范围生成聚合，只在响应末端裁剪明细。任务累计和 Provider 浮窗只消费聚合行，设置页作为唯一明细消费者显式请求 500 条并展示完整总数，避免所有调用者为一个表格共同承担无界载荷。
- Runtime 以单次循环构造装饰后明细、总计和 provider/model 费用索引，随后 O(1) 投影各汇总行；昂贵事件读取继续由现有 Worker/sidecar 所有。Renderer 的展示限制保持本地策略常量，服务端边界使用 Protocol 常量，避免浏览器 bundle 为共享运行时值反向拉入 Protocol 的 Node-only `crypto/path/os` 实现。
- 定向 89 项、三层类型检查、定向 lint、154 项架构测试、907 文件架构扫描和 13 包构建通过。Website 约 1,493 KiB；Desktop initial/total JS 为 2,104,340 / 2,975,832 字节。无新增依赖、迁移或业务数据操作，当前应用未重启；审计 P1-4 已关闭。

## 第一百一十四批：Renderer 轮询调度与业务读取解耦

- 新增 `useVisiblePolling`，集中拥有 document/KeepAlive 可见性、请求串行、失败退避与恢复刷新；文档可见性使用共享外部订阅，业务组件不再各自注册全局监听或固定 interval。
- ChatView 只提供 Goal 读取和业务周期，资源 ID 通过 `refreshKey` 明确触发即时刷新；DaemonCard 与 BotConversationPane 继续拥有各自数据解释和错误展示。机器人通道选择不再改变轮询生命周期或覆盖表单草稿，二维码登录的显式短时流程不并入后台调度。
- 定向 107 项、Desktop 类型检查、定向 lint、154 项架构测试、907 文件架构扫描和 13 包构建通过。Website 约 1,493 KiB；Desktop initial/total JS 为 2,104,316 / 2,975,682 字节。无新增依赖、迁移或业务数据操作，当前应用未重启；审计 P1-3 已关闭。

## 第一百一十三批：会话目录查询与 Shell 聚合解耦

- `SqliteConversationStore.listPage` 拥有稳定排序、keyset 游标和页大小约束；Protocol/Main/Runtime 只验证与传递不透明游标。旧 `list` 继续服务需要同步完整数组的内部用例，分页合同不反向渗入存储调用者。
- Renderer 的 `conversation-catalog-loader` 独立拥有“完整目录由有界页组成”的加载策略、跨页去重和游标保护。`ShellApp` 仍只协调六类目录的并行读取与原子提交，不感知页循环；每个 IPC 响应最多 100 条，而 UI 行为保持完整目录。
- 定向 192 项、四层类型检查、定向 lint、154 项架构测试、906 文件架构扫描和 13 包构建通过。Website 约 1,493 KiB；Desktop initial/total JS 为 2,103,381 / 2,974,374 字节。无新增依赖、迁移或业务数据操作，当前应用未重启；P1-1 的分页/合并/写盘三项已落地。

## 第一百一十二批：Shell 刷新调度与快照持久化解耦

- 新增纯异步 `RefreshCoordinator` 管理请求代次：同一任务的调用合并为一轮，活动读取期间的新调用合并为一轮尾随读取；Shell 继续只拥有六类目录读取、投影与原子提交，不再内联并发调度状态。
- `shell-boot-snapshot` 拥有自己的延迟写入器，250ms 内只保留最新成功快照，卸载时冲刷；React 组件不再决定 localStorage 写入频率。读取格式、冷启动恢复和失败不覆盖成功数据的行为保持。
- 86 项定向回归、Desktop 类型检查、定向 lint、154 项架构测试、905 文件架构扫描和 13 包构建通过。Website 约 1,493 KiB；Desktop initial/total JS 为 2,103,028 / 2,974,021 字节。无新增依赖、迁移或业务数据操作，当前应用未重启。P1-1 仅余会话目录分页。

## 第一百一十一批：本地 Skill 发现与 Runtime 帧分发解耦

- 本地 Skill 的来源发现与候选扫描改为异步文件边界，Runtime 帧路由只登记后台任务；解析、指纹和 Store 注册仍由 Runtime 用例层协调，安装复制与落库事务保持原边界。
- 扫描刷新以代次和单一 in-flight Promise 串联：并发读取共享当前工作，期间到达的新变更会追加一代，避免异步化后出现旧结果回写或扫描风暴。来源快照由扫描、响应摘要和 watcher 共用，删除 Runtime 中平行的同步来源实现。
- 定向 14 项、Runtime 类型检查/定向 lint、154 项架构测试、904 文件无环扫描和 13 包构建通过；事件循环行为测试覆盖 40 文件扫描。Runtime 全量 1810/1815，5 条独立基线失败已单线程复核。Website 约 1,493 KiB；Desktop initial/total JS 为 2,101,896 / 2,972,889 字节。无新增依赖、迁移或业务数据操作，当前应用未重启。

## 第一百一十批：用量统计查询生命周期与设置 UI 解耦

- `provider-usage-summary` 从单一 30 天缓存扩展为按查询范围分区的通用 TTL / in-flight 边界，并暴露只读同步快照；缓存只拥有请求复用和时效，不接管设置页的 loading、error、时间范围和价格编辑状态。
- `UsageSettings` 以新鲜快照初始化，重挂载不再把数据生命周期绑定到 Radix Dialog 子树生命周期；手动刷新和价格 Mutation 强制刷新。没有用 `forceMount` 保活整棵设置树，避免为一项数据复用引入隐藏模态行为和无关页面状态耦合。
- 75 项定向回归、Desktop 类型检查、定向 lint、154 项架构测试、904 文件无环扫描和 13 包构建通过。Website 约 1,493 KiB；Desktop initial/total JS 为 2,101,896 / 2,972,889 字节。无新增依赖、迁移或业务数据操作，当前应用未重启。

## 第一百零九批：Renderer Skill 目录共享读取边界

- `skill-catalog-loader` 成为 Renderer Skill 元数据读取的单一所有者：规范化 500 条请求，按 Runtime 实例与 workspace scope 分区，并集中负责成功缓存、in-flight 去重、失败重试和代次失效后的旧响应重取。
- 六个 UI 消费者只决定加载时机与展示状态；Shell/能力显式刷新和能力 Mutation 决定何时强制读取或失效。AST 门禁阻止组件重新直接调用 `listSkills`，避免缓存策略散回页面。本批只完成 Skill 子项，MCP 目录已在第一百二十九批按自身 Mutation 语义独立收口。
- 共享加载器/相关 UI 195 项、Desktop 类型检查、定向 lint、154 项架构测试、904 文件无环扫描和 13 包构建通过。Website 约 1,493 KiB；Desktop initial/total JS 为 2,101,496 / 2,972,339 字节。无新增依赖、迁移或业务数据操作，当前应用未重启。

## 第一百零八批：能力页后台刷新按可见性驱动

- `KeepAliveLayer` 在保持子树挂载和冻结 children 的同时，通过窄上下文发布当前激活状态；保活容器拥有页面生命周期信号，能力页只消费信号决定何时加载，不反向依赖 Shell 导航状态。
- `AbilityCenterPage` 删除 30 秒固定时钟，改为首次进入与重新进入刷新；隐藏页不再强制磁盘扫描或重复目录 IPC，DOM、滚动位置、手动重试和 Mutation 后刷新语义不变。单次同步磁盘扫描仍归 Runtime 后续性能批次。
- KeepAlive/Abilities 47 项、Shell 定向集成 1 项、Desktop 类型检查、定向 lint、153 项架构测试、903 文件无环扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,856 / 2,971,573 字节。无新增依赖、迁移或业务数据操作，当前应用未重启。

## 第一百零七批：Task Status Git 读取按需化

- QA 中的 Task Status 不再用固定时钟驱动昂贵的 Main Git 查询；Renderer 仅在挂载、恢复关注或 Git 操作改变状态后发起读取。
- Main 仍拥有 Git 命令和文件统计，组件仍拥有展示时机；去除的只是无状态变化也反复跨越 IPC 的周期耦合。
- Task Status 14 项、Desktop 类型检查、定向 lint、153 项架构测试、903 文件无环扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,643 / 2,971,344 字节。无新增依赖、迁移或业务数据操作，当前应用未重启。

## 第一百零六批：Shell 目录刷新错误隔离

- Shell 六个目录读取作为单一快照边界：数据全部就绪后再提交，失败不更改当前 UI 目录，避免会话与其他资源处于不同版本。
- `refresh` 将宿主失败转换为结构化结果和用户可见错误，启动组合层只消费结果；触发页不再各自复制 try/catch。并兼容旧 Provider 夹具缺失能力数组的输入。
- `ShellApp` 79 项、Desktop 类型检查、定向 lint、153 项架构测试、903 文件无环扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,643 / 2,971,344 字节。无新增依赖、迁移或业务数据操作，当前应用未重启。

## 第一百零五批：Activity 刷新竞态与本地 Skill 扫描错误

- Activity 读取在页面内以请求代次实现最后请求获胜；过滤/事件刷新会使旧全量和分页响应失效，卸载后不再写状态。Runtime 列表合同无需承担 UI 取消语义。
- 本地 Skill 扫描使用独立错误状态，失败保留候选并提供原用例重试；目录加载、Mutation 和编辑弹窗错误继续各自工作，关闭 B-1/B-2。
- Activity 11 项、Abilities 43 项、Desktop 类型检查、定向 lint、153 项架构测试、903 文件无环扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,382 / 2,971,083 字节。无新增依赖、迁移或业务数据操作，当前应用未重启。

## 第一百零四批：Renderer 根目录旧投影清理

- 删除九个只被测试引用的旧 Renderer 投影和八个同名测试，关闭 D-17；生产编译面减少 1,026 行，连同死 reducer 测试共移除 1,856 行。
- 冷启动多轮恢复不依赖旧 `runtime-view-state`，改由 `mergeEventHistory` 与 `projectM0EventHistory` 直接验证；连接重试和 Shell 构建资产继续覆盖当前生产所有者。
- Runtime 连接/事件历史 29 项、构建资产 1 项、Desktop 类型检查、153 项架构测试、903 文件无环扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,382 / 2,970,315 字节。无新增依赖、迁移或业务数据操作，当前应用未重启。

## 第一百零三批：M1/M2 Renderer 验收脚手架退役

- 删除 19 个生产零引用的 M1/M2 Renderer 模块、18 个专属测试和旧 M1 soft 自检脚本，避免约一万行历史里程碑投影继续进入生产编译与维护面。
- 按真实调用图保留 Main/IPC 的 M1 文档打开、解析、证据加载和评分；M2 自检只移除零消费者 workspace 投影，当前六阶段生产边界继续验证。
- 保留链路 38 项、Desktop 类型检查、M2 六阶段 274 项、153 项架构测试、912 文件无环扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,382 / 2,970,315 字节。无新增依赖、迁移或业务数据操作，当前应用未重启。

## 第一百零二批：Settings 旧机器人对话实现清理

- 删除 `SettingsPage` 未挂载的旧机器人对话、通道目录、空 Telegram 配置及专属导入，共减少 224 行；独立 `BotConversationPane` 保持唯一设置实现。
- Settings 页签组合、Bot 凭据/连接和通道 wiring 行为不变；Desktop initial/total JS 分别减少 7 / 4,845 字节。
- Desktop 类型检查、Settings/Bot 61 项、定向 lint、153 项架构测试、931 文件无环扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,382 / 2,970,315 字节。无新增依赖、迁移或业务数据操作，当前应用未重启。

## 第一百零一批：RightDock 旧 WorkspacePanel 清理

- 删除零引用 `WorkspacePanel` 以及其私有分支/变更/最近提交状态和递归提交文件树闭环，`RightDock` 缩减 538 行。
- 当前文件/Review 工作台保持在 `WorkspaceFilesPanel`、`ReviewPanel`、`WorkspaceWorkbench`；仍有消费者的 Git IPC 与 Task Status 不动。
- Desktop 类型检查、工作台相关 39 项、定向 lint、153 项架构测试、931 文件无环扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,389 / 2,975,160 字节。无新增依赖、迁移或业务数据操作，当前应用未重启。

## 第一百批：旧 RightRail 与任务历史面板清理

- 删除未挂载的旧 `RightRail`，右侧工作台只保留 `RightDock`/`WorkspaceWorkbench`；进程 wiring 测试不再把死文件作为隔离证据，继续校验 ChatView 与消息内进程组件。
- 删除仅由自身测试引用的 `TaskPlanHistoryPanel` 及测试，任务展示继续由当前 Composer/Task/Status 面板及其回归覆盖。共移除 716 行旧实现/测试连接代码。
- Desktop 类型检查、Desktop 32 项、UI Kit 6 项、定向 lint、153 项架构测试、931 文件无环扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,389 / 2,975,160 字节。无新增依赖、迁移或业务数据操作，当前应用未重启。

## 第九十九批：Main 与 Runtime 零引用辅助面清理

- Main 删除未调用的 Runtime 连接/Frame 探针；正式连接生命周期和类型化客户端不变。消息图片删除旧 `file://` URL 辅助，只保留受控自定义协议。
- Runtime 删除 Capability Broker 宽泛名称判断、Chat Tools 未消费的只读白名单与旧 ENOENT 提示生成器；执行路径继续使用更窄判断、变更工具集合和当前真实失败提示。
- Desktop/Runtime 类型检查、消息图片/Main 12 项、Capability/Chat Tools 75 项、定向 lint、153 项架构测试、933 文件无环扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,389 / 2,975,160 字节。无新增依赖、迁移或业务数据操作，当前应用未重启。

## 第九十八批：零引用执行入口与 Renderer 状态清理

- Runtime daemon 删除未调用的自启注册/移除副作用，自启生命周期继续由 Desktop supervisor 独占；状态查询与命令构造器保留。
- Desktop Terminal Session 删除无消费者的全局 Store/getter/reset，保留显式工厂和宿主 kill；Composer 删除旧思考/上下文设置菜单及专属网络设置子组件，现有控件路径不变。Workers 临时超时脚本同步移除。
- Runtime/Desktop/Workers 类型检查、Daemon 3 项、Terminal/Composer 43 项、定向 lint、153 项架构测试、933 文件无环扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,389 / 2,975,160 字节。无新增依赖、迁移或业务数据操作，当前应用未重启。

## 第九十七批：Core 审核策略兼容层清理

- 删除 Core `rework-policy` 纯转发模块、重复测试和公开入口导出，Shared `review-policy` 成为审核上限与返工状态转换的唯一实现/测试归属；陈旧 Core 构建产物一并清除。
- M2 自检新增 Shared review 独立阶段并更新六阶段顺序自测；架构规则禁止旧 Core 路径恢复。Artifact legacy conflict 测试补齐已有 `0056`—`0058` 迁移名称，不改变迁移或持久化行为。
- Shared/Core 类型检查、Shared 13 项、Core 205 项、Artifact 17 项、M2 六阶段 284 项、定向 lint、153 项架构测试、933 文件无环扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,445 / 2,975,216 字节。无新增依赖、迁移或业务数据操作，当前应用未重启。

## 第九十六批：Desktop Waiting 安全投影边界

- 新增纯 `desktop-waiting-projection`，从工具结果解析允许的等待错误码，并从已脱敏参数中只投影 `processId/title/appId`，保留字符串修剪和长度上限。
- `runtime.ts` 净减少 44 行，继续拥有 Desktop 命令执行、持久化、Task/Workspace 归属、等待事件和 list/continue/cancel；Browser 错误映射不并入。架构门禁禁止投影反向依赖 Runtime 或基础设施。
- Runtime 类型检查、纯投影 16 项、真实 Computer Use 集成 13 项、定向 lint、152 项架构测试、934 文件无环扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,445 / 2,975,216 字节。无依赖、迁移或业务数据操作，当前应用未重启。

## 第九十五批：ChatView 会话滚动位置边界

- 新增 `conversation-scroll-position`，集中拥有无上限会话位置 Map、localStorage 读取/写入容错、首个可见消息锚点捕获，以及锚点/绝对位置/尾部三种恢复路径。
- ChatView 只保留生命周期调用点，净减少 116 行；会话重挂载、流式跟随、历史缺口和跳转行为保持。新模块纳入 Shell 控制器门禁，禁止反向依赖 ChatView、Main/Preload 或基础设施。
- Desktop 类型检查、滚动模块 4 项及滚动/历史/跳转集成 19 项、定向 lint（0 error，保留既有 16 条 Hook warning）、151 项架构测试、933 文件无环扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,445 / 2,975,216 字节。无依赖、迁移或业务数据操作，当前应用未重启。

## 第九十四批：计划步骤图验证边界

- 新增 Shared 纯 `orchestration-plan-graph`，以结构化问题承载重复步骤、Merge 依赖不足、自依赖、重复/缺失依赖和环检测；扫描与 DFS 顺序保持原确定性优先级。
- Storage 只适配原有调用错误和持久数据错误，步骤字段解码、错误路径/文本、SQL 及事务不变；既有通用架构规则通过专用夹具锁定 Shared 不反向依赖应用或基础设施。
- Shared/Storage 类型检查、纯图验证 7 项、编排存储 27 项、定向 lint、150 项架构测试、932 文件无环扫描和 13 包实际重建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,447 / 2,975,218 字节。无依赖、迁移或业务数据操作，当前应用未重启。

## 第九十三批：计划修订差异算法边界

- 新增 Shared 纯 `orchestration-plan-diff`，集中拥有步骤克隆、依赖集合比较、稳定字段变化顺序和计划版本差异计算；新增/移除快照与输入对象隔离。
- `orchestration-store` 删除四组本地算法，并在修订写入和持久 diff 校验两条路径复用共享规则；输入验证、持久 JSON 解码、SQL、OCC 与事务仍归 Storage。
- Shared/Storage 类型检查、纯差异 3 项、编排存储 27 项、定向 lint、149 项架构测试、931 文件无环扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,447 / 2,975,218 字节。无依赖、迁移或业务数据操作，当前应用未重启。

## 第九十二批：ChatView 运行身份与 Kernel 投影边界

- 新增纯 `run-identity-projection`，一次遍历 `run.started` 事件生成全局 Agent 身份和 Kernel 两组不可变映射，兼容顶层字段及嵌套 durable run 快照。
- ChatView 用单个 memo 消费组合投影并兼容重导出旧函数，净减少 42 行；架构门禁禁止新叶子反向依赖 ChatView、宿主通信或基础设施。
- Desktop 类型检查、身份/Kernel/委派 UI 相关 54 项、定向 lint（0 error，保留既有 Hook warning）、149 项架构测试、930 文件无环扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,447 / 2,975,218 字节。无依赖、迁移或业务数据操作，当前应用未重启。

## 第九十一批：跨 Kernel 会话 Transcript 投影边界

- 新增纯 `kernel-session-transcript`，集中处理内容文本化、恢复/gap transcript、持久消息可移植投影、字节上限及当前用户消息识别；使用本地最小消息结构，移除该投影对完整 Adapter 合同的依赖。
- `runtime.ts` 调用并兼容重导出既有公开函数，净减少 160 行；原生 Kernel 会话、路由、凭据和失效恢复仍归 Runtime 状态机。架构门禁禁止新叶子反向依赖 Runtime、DemoRun 或基础设施。
- Runtime 类型检查、transcript/恢复/准入相关 22 项、定向 lint、148 项架构测试、929 文件无环扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,591 / 2,975,362 字节。无依赖、迁移或业务数据操作，当前应用未重启。

## 第九十批：Goal 轮次协议与任务清单投影边界

- 新增纯 `goal-turn`，承载 Goal 状态标记解析/清理、模型轮次提示、用户可见轮次文本与默认上限；新增纯 `task-plan-context`，承载任务清单事件读取、归一化和模型格式化。
- `runtime.ts` 通过导入和兼容重导出保持原调用入口，净减少 116 行；目标生命周期、持久化、自动续跑和 Token 结算仍由 Runtime 状态机负责。架构门禁禁止两个叶子反向依赖 Runtime、DemoRun 或基础设施。
- Runtime 类型检查、目标/清单/执行准入相关 23 项、定向 lint、147 项架构测试、928 文件无环扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,591 / 2,975,362 字节。无依赖、迁移或业务数据操作，当前应用未重启。

## 第八十九批：委派旧消息兼容读取与实时卡片持久化分离

- 新增纯 `delegation-message-projection` 与只读 `DelegationLegacyMessageHistory`；实时 `DelegationMessageHistory` 只保留卡片读取和持久化，服务门面分别组合两类能力。
- 消息兼容格式、精确 child run 查询、实时卡片合并和终态行为不变；架构门禁禁止三个叶子反向依赖门面、执行用例或基础设施。
- Runtime 类型检查、委派历史相关 32 项、定向 lint、145 项架构测试、926 文件无环扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,591 / 2,975,362 字节。无依赖、迁移或业务数据操作，当前应用未重启。

## 第八十八批：生产执行预留共享契约与生命周期端口

- 生产执行结果、fence、Provider reservation 与 MCP intent DTO 迁入 Shared；Storage 导入并兼容重导出，预留表、校验和事务实现不变。
- Runtime 新增查询完成态、预留、释放、checkpoint 与完成五方法端口；生产步骤执行器移除最后一个具体 Storage 类型及全部 Storage 包导入，架构规则禁止任何 Storage 回流。
- Shared/Storage/Runtime 编译、执行预留事务 9 项、生产执行器 33 项、定向 lint、143 项架构测试、924 文件无环扫描和 13 包实际重建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,591 / 2,975,362 字节。无依赖、迁移或业务数据操作，当前应用未重启。

## 第八十七批：生产步骤执行器 Agent Context 生命周期端口

- 生产步骤执行端口新增单方法 `getOrCreateEpoch` 能力并复用 Shared 契约，执行器移除 `SqliteAgentContextStore` 具体类型。
- 现有 Context Store 通过结构化类型直接适配，epoch 复用/轮换与 prompt cache key 不变；架构规则阻止具体 Agent Context Store 回流。
- Runtime 类型检查、生产执行器 33 项、定向 lint、142 项架构测试、923 文件无环扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,591 / 2,975,362 字节。无依赖、迁移或业务数据操作，当前应用未重启。

## 第八十六批：生产步骤执行器 Skill 授权与正文端口

- 生产步骤执行端口新增 Skill 准入元数据、提示词正文与权限批准查询，执行器移除 `SqliteSkillStore` 具体类型。
- 现有 Skill 存储通过结构化类型直接适配，allowlist、状态、批准和正文映射不变；架构规则阻止具体 Skill 存储类型回流。
- Runtime 类型检查、生产执行器 33 项、定向 lint、141 项架构测试、923 文件无环扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,591 / 2,975,362 字节。无依赖、迁移或业务数据操作，当前应用未重启。

## 第八十五批：生产步骤执行器 Provider 最小投影端口

- 生产步骤执行端口新增模型、Provider 与凭据路由最小投影，执行器移除 `SqliteProviderStore` 具体类型；组合根和 Provider 查询实现不变。
- `describe-image` 的模型输入改为中立 `CatalogModelSource`，移除 Storage `ModelRecord` 依赖并纳入基础设施隔离门禁；视觉能力映射和手动覆盖优先级不变。
- Runtime 类型检查、相关 84 项、定向 lint、140 项架构测试、923 文件无环扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,591 / 2,975,362 字节。无依赖、迁移或业务数据操作，当前应用未重启。

## 第八十四批：生产步骤执行器 Agent 最小投影端口

- 生产步骤执行端口新增 AgentVersion 最小投影，覆盖模型绑定、浏览器权限、Skill 白名单与提示词字段；执行器和三个辅助函数移除 `SqliteAgentStore` 类型依赖。
- 现有 Agent 存储通过结构化类型直接适配，组合根和精确版本读取不变；架构规则阻止具体 Agent 存储类型回流。
- Runtime 类型检查、生产执行器 33 项、定向 lint、138 项架构测试、923 文件无环扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,591 / 2,975,362 字节。无依赖、迁移或业务数据操作，当前应用未重启。

## 第八十三批：生产步骤执行器 Workspace 最小投影端口

- 生产步骤执行端口新增 Task/Workspace 查询能力，但仅暴露执行器消费的 `workspaceId` 与 `folderPath`；执行器移除 `SqliteWorkspaceStore` 具体类型。
- 现有 Workspace 存储通过结构化类型直接适配，组合根与查询实现不变；架构规则阻止具体 Workspace 存储类型回流。
- Runtime 类型检查、生产执行器 33 项、定向 lint、137 项架构测试、923 文件无环扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,591 / 2,975,362 字节。无依赖、迁移或业务数据操作，当前应用未重启。

## 第八十二批：生产步骤执行器 Run 状态端口

- 新增 `ProductionStepExecutionRuns` 中立端口，仅暴露 `getRun` 与 `getGraph`；生产执行器不再以 `SqliteOrchestrationStore` 作为参数类型，SQLite 实现仍由 `persistence` 组合根注入。
- 端口纳入调度核心基础设施隔离规则，执行器增加具体编排存储类型防回流门禁；数据库读取、执行 fence、预留和完成逻辑未改变。
- Runtime 类型检查、生产执行器 33 项、定向 lint、136 项架构测试、923 文件无环扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,591 / 2,975,362 字节。无依赖、迁移或业务数据操作，当前应用未重启。

## 第八十一批：ChatView 消息合并状态边界

- 新增纯 `conversation-message-merge`，拥有持久顺序、旧终态回填顺序、乐观气泡 durable ID 去重及持久/乐观/流式虚拟序号合并；ChatView 删除内联算法。
- 新模块只依赖会话展示类型，架构规则禁止其反向依赖 ChatView 或宿主实现；历史分页范围/页面合并继续归 `conversation-history-pages`。
- Desktop 相关 15 项、定向 lint（0 error）、135 项架构测试和 922 文件无环扫描通过。无依赖、迁移或业务数据操作，当前应用未重启。

## 第八十批：生产源码依赖环门禁

- 新增无第三方依赖的 TypeScript AST 依赖图与 Tarjan 强连通分量检测，覆盖 921 个 apps/packages 生产源文件的静态、类型和字面量动态导入，以及相对路径和工作区包入口；门禁进入 `lint:architecture` 与根构建 prebuild。
- 首次扫描只发现 `commands.ts ↔ run-process-page.ts` 一个环；Run Process 请求契约下沉到解析所有者，`commands` 仅兼容重导出，未建立环白名单。
- 新增 4 项图算法/解析测试；Protocol 相关 4 项、定向 lint、134 项架构测试和 921 文件无环扫描通过。无依赖、迁移或业务数据操作，当前应用未重启。

## 第七十九批：Desktop/UI Kit 兼容层清理

- Desktop ChatView、ShellApp、Composer 菜单和测试直接从 `@sync-think/ui-kit` 使用三项共享 Composer 组件及其 hook/常量；三个只做重导出的 Desktop 兼容文件已删除。
- 架构规则禁止旧本地模块重新成为依赖入口，Website 与 Desktop 使用同一公开包边界；实现、交互、动效与样式契约不变。
- Desktop 相关 40 项、UI Kit 12 项、定向 lint（0 error）、130 项架构测试、921 文件扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移或业务数据操作，当前应用未重启。

## 第七十八批：消息图片附件边界

- `conversation-command-contract` 扩展 `message.attachImages` 请求/响应关联；已迁移的类型化命令总数增至 212 项。
- Conversation Write handler 复用 `requestConversation` 完成“消息写入 → 宿主文件落盘 → 附件引用事件”流程，Main 组合根删除最后一个业务命令通用 transport 适配。Runtime 继续拥有消息块合并和事件持久化。
- Desktop 相关 11 项、Runtime 集成 1 项、定向 lint、130 项架构测试和 924 文件扫描通过。无依赖、迁移或业务数据操作，当前应用未重启。Main 业务命令通用 transport 旁路已清零；剩余直接调用仅为 `runtime.healthcheck` 基础设施探测。

## 第七十七批：Kernel Recycle 生命周期入口

- `kernel-command-contract` 扩展 `kernel.recycle` 请求/响应关联，新增受限内核 ID 载荷；已迁移的类型化命令总数增至 211 项。
- Main 私有内核安装/更新后的内部调用改走 `requestKernel`，不新增 Renderer IPC；安装、探测、重启和 Runtime 的活跃租约延迟回收行为保持不变。
- Desktop 相关 6 项、Runtime 状态机 10 项、定向 lint、130 项架构测试、924 文件扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移或业务数据操作，当前应用未重启。Main 通用 Runtime 传输仅余 `message.attachImages`。

## 第七十六批：数据管理用例边界

- 新增 `data-management-command-contract`，逐项绑定 storageStats/export/import/backup/compactStorage/cleanConversations/cleanEmptyAttachmentDirectories 的请求与响应；已迁移的类型化命令总数增至 210 项。
- Desktop 新增纯 `data-management-payloads` 和 Main `data-management-handlers`，拥有 8 个 IPC channel；Main 通过保存/打开对话框、系统路径打开和默认文件名窄端口装配宿主副作用，组合根删除直接注册。托盘旁路也改用类型化请求。
- Runtime 继续拥有 SQLite/文件内容、在线备份、导入冲突和清理事务。Desktop 相关 23 项、Protocol 解析 2 项、Runtime 数据服务 5 项、定向 lint、130 项架构测试、924 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移或业务数据操作，当前应用未重启。Main 通用 Runtime 传输仅余 `kernel.recycle` 与 `message.attachImages`，下一批先迁移 Kernel Recycle。

## 第七十五批：Web Search Provider 管理边界

- 新增 `web-search-provider-command-contract`，逐项绑定 list/save/reorder/test 的请求与响应；已迁移的类型化命令总数增至 203 项。
- Desktop 新增 Main `web-search-provider-handlers`，拥有 4 个 IPC channel、既有 Protocol 解析语义和来源校验 → 连接 → 解析 → 请求顺序；Main 组合根删除直接注册。
- 配置/密钥持久化、Provider 路由、网络执行和错误脱敏仍归 Runtime。Desktop 相关 11 项、Runtime Web Search 回归 21 项、定向 lint、128 项架构测试、921 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移或业务数据操作，当前应用未重启。下一批独立迁移数据管理命令，Main 文件选择与落盘继续作为宿主适配。

## 第七十四批：Provider CC Switch 预览与导入边界

- 新增 `provider-cc-switch-command-contract`，逐项绑定 previewCcSwitchImport/importCcSwitch 的请求与响应；已迁移的类型化命令总数增至 199 项。
- Desktop 新增纯 `provider-cc-switch-payloads` 和 Main `provider-cc-switch-handlers`，拥有 2 个 IPC channel、既有解析语义和来源校验 → 连接 → 解析 → 请求顺序；Main 组合根删除直接注册。
- SQLite 读取、Provider 映射、安全存储、导入补偿和事件持久化仍归 Runtime；CC Switch 与日常 Provider 生命周期保持分离。Desktop 相关 11 项、Runtime 补偿回归 2 项、定向 lint、126 项架构测试、919 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移或业务数据操作，当前应用未重启。下一批迁移 Web Search Provider 管理 4 项命令，数据管理随后独立处理。

## 第七十三批：Provider Balance 边界

- 新增 `provider-balance-command-contract`，绑定 `provider.balance` 请求与响应；已迁移的类型化命令总数增至 197 项。
- Desktop 新增纯 `provider-balance-payloads` 和 Main `provider-balance-handlers`，拥有 1 个 IPC channel、既有解析语义和来源校验 → 连接 → 解析 → 请求顺序；Main 组合根删除直接注册。
- 端点支持判断、凭据解密、网络访问、诊断和响应归一化仍归 Runtime；CC Switch 保持分离。Desktop 相关 17 项、Runtime 回归 7 项、定向 lint、124 项架构测试、916 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移或业务数据操作，当前应用未重启。下一批独立迁移 CC Switch 预览与导入边界。

## 第七十二批：Provider Discovery 与 Capability Probing 边界

- 新增 `provider-discovery-command-contract`，逐项绑定 discoverModels/probeModels/probeCapabilities/confirmCapabilities 的请求与响应；已迁移的类型化命令总数增至 196 项。
- Desktop 新增纯 `provider-discovery-payloads` 和 Main `provider-discovery-handlers`，拥有 4 个 IPC channel、既有解析语义和来源校验 → 连接 → 解析/剪贴板交接 → 请求顺序；Main 组合根删除直接注册。
- 创建前探测密钥只通过 Main 注入端口进入内部请求；发现与能力探测的集中超时、Runtime 执行及确认状态保持不变。Desktop 相关 34 项、Runtime 回归 7 项、定向 lint、122 项架构测试、913 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移或业务数据操作，当前应用未重启。下一批独立迁移 Provider Balance，CC Switch 留后。

## 第七十一批：Provider Model Management 边界

- 新增 `provider-model-command-contract`，逐项绑定 addModels/setModelPriorities/updateModel/removeModel 的请求与响应；已迁移的类型化命令总数增至 192 项。
- Desktop 新增纯 `provider-model-payloads` 和 Main `provider-model-handlers`，拥有 4 个 IPC channel、既有解析语义和来源校验 → 连接 → 解析 → 请求顺序；Main 组合根删除直接注册。
- 模型持久化、归属校验和上下文缓存失效仍归 Runtime；发现、能力探测、余额与 CC Switch 保持分离。Desktop 相关 22 项、Runtime 回归 7 项、定向 lint、120 项架构测试、910 文件扫描和 13 包构建通过；全 Desktop lint 仍受既有 Renderer 6 个错误阻塞。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移或业务数据操作，当前应用未重启。下一批独立迁移 Provider Discovery & Capability Probing。

## 第七十批：Provider Credentials 生命周期边界

- 新增 `provider-credential-command-contract`，逐项绑定 add/remove/clear/reveal/update Credential 的请求与响应；已迁移的类型化命令总数增至 188 项。
- Desktop 新增纯 `provider-credential-payloads` 和 Main `provider-credential-handlers`，拥有 5 个 IPC channel、既有解析语义和来源校验 → 连接 → 解析/剪贴板交接 → 请求顺序；Main 组合根删除直接注册。
- Renderer 不携带新增或轮换密钥；Main 复用统一 8 KiB 剪贴板校验，显式 reveal 保持唯一明文响应。安全存储、补偿和最后凭据约束仍归 Runtime。Desktop 相关 29 项、Runtime 回归 13 项、lint、118 项架构测试、907 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移、Runtime 行为或业务数据操作，当前应用未重启。下一批独立迁移 Provider Model Management。

## 第六十九批：Provider Catalog 生命周期边界

- 新增 `provider-catalog-command-contract`，逐项绑定 create/update/list/reorder/delete 的请求与响应；已迁移的类型化命令总数增至 183 项。
- Desktop 新增纯 `provider-catalog-payloads`、`provider-payload-validation` 和 Main `provider-catalog-handlers`，拥有 5 个 IPC channel、既有解析语义和来源校验 → 连接 → 解析/剪贴板交接 → 请求顺序；Main 组合根删除直接注册。
- Provider 目录生命周期与 Credentials、模型管理、发现/探测保持分离；目录持久化、安全存储和失败补偿仍归 Runtime。Desktop 相关 27 项、Runtime 回归 12 项、lint、116 项架构测试、904 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移、Runtime 行为或业务数据操作，当前应用未重启。下一批独立迁移 Provider Credentials 生命周期。

## 第六十八批：执行参与模式边界

- 新增 `participation-mode-command-contract`，绑定 `task.setParticipationMode` 请求与响应；已迁移的类型化命令总数增至 178 项。
- Desktop 新增纯 `participation-mode-payloads` 和 Main `participation-mode-handlers`，拥有 1 个 IPC channel、既有解析语义和来源校验 → 连接 → 解析 → 请求顺序；模式解析从聚合文件移出，Main 组合根删除直接注册。
- Task 目录保持创建/查询/归档职责，执行策略不并入；自动模式的批准计划和作用域策略门禁、OCC、事务、事件与恢复仍归 Runtime。Desktop 相关 28 项、Runtime 回归 17 项、lint、114 项架构测试、900 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移或业务数据操作，当前应用未重启。下一批从 Provider 生命周期中选择一个有限子域继续迁移。

## 第六十七批：Artifact 生命周期边界

- 新增 `artifact-command-contract`，逐项绑定 list/getVersion/compare/selectVersion/merge/listConflicts/resolveConflict 的请求与响应；已迁移的类型化命令总数增至 177 项。
- Desktop 新增纯 `artifact-payloads` 和 Main `artifact-handlers`，拥有 7 个 IPC channel、既有解析语义和来源校验 → 连接 → 解析 → 请求顺序；Artifact 解析从聚合文件移出，Main 组合根删除直接注册。
- 图片预览保留宿主后处理：类型化读取 ArtifactVersion 后，通过注入端口登记本地签名 URL；版本内容、血缘、选择、合并、冲突状态与原子事件仍归 Runtime。Desktop 相关 38 项、Runtime Artifact 回归 10 项、lint、112 项架构测试、897 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移、Runtime 行为或业务数据操作，当前应用未重启。下一批迁移 `task.setParticipationMode` 执行参与策略，再转向 Provider 生命周期。

## 第六十六批：Run Graph 与执行控制边界

- 新增 `run-control-command-contract`，逐项绑定 getGraph/pause/resume/cancel 的请求与响应；已迁移的类型化命令总数增至 170 项。
- Desktop 新增纯 `run-control-payloads` 和 Main `run-control-handlers`，拥有普通会话 cancel、Graph 与编排 pause/resume/cancel 共 5 个 IPC channel；Run 解析从聚合文件移出，普通 cancel 解析从 Main 移出。
- `run.cancel` 继续由 Runtime 按载荷形状分流：仅 runId 取消会话流，完整 scope/version 取消编排运行；执行器、状态机、原子事件和幂等回放保持 Runtime 所有权。Desktop 相关 33 项、Runtime Run 回归 3 项、lint、110 项架构测试、894 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移、Runtime 行为或业务数据操作，当前应用未重启。下一批迁移 Artifact 查询、选择、合并与冲突解决 7 项命令。

## 第六十五批：Plan 生命周期边界

- 新增 `plan-command-contract`，逐项绑定 draft/revise/listRevisions/approve 的请求与响应；已迁移的类型化命令总数增至 166 项。
- Desktop 新增纯 `plan-payloads` 和 Main `plan-handlers`，拥有 4 个 IPC channel、既有解析语义和来源校验 → 连接 → 解析 → 请求顺序；Plan 解析从聚合文件移出，复杂度与敏感字段检查抽为宿主无关 `orchestration-payload-validation`。
- 不可变 revision、批准前置条件、Run/Graph 创建和原子持久化保持 Runtime 所有权；Run 控制及参与模式未并入。Desktop 相关 31 项、Runtime Plan 回归 14 项、lint、108 项架构测试、891 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移、Runtime 行为或业务数据操作，当前应用未重启。下一批迁移 Run Graph 与 pause/resume/cancel 4 项命令。

## 第六十四批：Task 目录生命周期边界

- 新增 `task-command-contract`，逐项绑定 create/list/open/search/archive/unarchive 的请求与响应；已迁移的类型化命令总数增至 162 项。
- Desktop 新增纯 `task-payloads` 和 Main `task-handlers`，拥有 6 个 IPC channel、既有解析语义和来源校验 → 连接 → 解析 → 请求顺序；原 Workspace/Task 混合载荷文件完成拆分，共享通道表供 Preload/Main 使用。
- Task 持久化、搜索、树级归档和乐观版本围栏保持 Runtime 所有权；执行参与模式未并入。Desktop 相关 22 项、Runtime 目录回归 3 项、lint、106 项架构测试、887 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移、Runtime 行为或业务数据操作，当前应用未重启。下一批迁移 Plan 生命周期 4 项命令，参与模式保持独立。

## 第六十三批：Workspace 生命周期边界

- 新增 `workspace-command-contract`，逐项绑定 create/bindFolder/list/update/delete 的请求与响应；已迁移的类型化命令总数增至 156 项。
- Desktop 新增纯 `workspace-lifecycle-payloads` 和 Main `workspace-handlers`，拥有 5 个 IPC channel、既有解析语义和来源校验 → 连接 → 解析 → 请求顺序；Workspace 解析从 Workspace/Task 混合文件移出，共享通道表供 Preload/Main 使用，更新安装探针复用类型化入口。
- 目录持久化、路径安全、文件夹单次绑定和 UI 偏好保持 Runtime 所有权；Task 命令未并入。Desktop 相关 23 项、Runtime Workspace 回归 3 项、lint、104 项架构测试、885 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移、Runtime 行为或业务数据操作，当前应用未重启。下一批迁移 Task 目录生命周期 6 项命令，参与模式保持独立。

## 第六十二批：Prompt Enhancement / Design Generation 边界

- 新增 `prompt-design-command-contract`，逐项绑定 prompt enhance/cancel 和 design generate 的请求与响应；已迁移的类型化命令总数增至 151 项。
- Desktop 新增纯 `prompt-design-payloads` 和 Main `prompt-design-handlers`，拥有 3 个 IPC channel、既有解析语义和来源校验 → 连接 → 解析 → 请求顺序；共享通道表同时供 Preload 和 Main 使用，组合根删除内联解析器和直接注册。
- 模型选择、流输出筛选、取消执行和“不写会话历史”保持 Runtime 所有权；原有按命令超时策略不变。Desktop 相关 17 项、Protocol 回归 5 项、Runtime 管道回归 3 项、lint、102 项架构测试、882 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移、Runtime 行为或业务数据操作，当前应用未重启。下一批迁移 Workspace 生命周期 5 项命令。

## 第六十一批：Capability Governance 生命周期边界

- 新增 `capability-governance-command-contract`，逐项绑定 workspace list/setActive、governance list、publishDraft save/list/get/submit 和 organize preview/getLatest 的请求与响应；已迁移的类型化命令总数增至 148 项。
- Desktop Main 新增 `capability-governance-handlers`，拥有 9 个 IPC channel、既有纯解析器和来源校验 → 连接 → 解析 → 请求顺序；共享通道表同时供 Preload 和 Main 使用，组合根删除对应直接注册。
- 激活状态、治理规则、发布草稿持久化和整理报告生成保持 Runtime 所有权。Desktop 相关 28 项、Runtime 治理集成 1 项、lint、100 项架构测试、879 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移、Runtime 行为或业务数据操作，当前应用未重启。下一批迁移 Prompt Enhancement / Design Generation 注册边界。

## 第六十批：Bot Channel 生命周期边界

- 新增 `bot-channel-command-contract`，逐项绑定 channel.get/save/test 和微信二维码 request/check 的请求与响应；已迁移的类型化命令总数增至 139 项。
- Desktop 新增纯 `bot-channel-payloads` 和 Main `bot-channel-handlers`，拥有 5 个 IPC channel、既有平台分支解析和来源校验 → 连接 → 解析 → 请求顺序；对应解析器从 `agent-payloads` 删除，既有载荷测试导入同步修正。
- 配置存储、凭据保护、网关连接和消息处理保持 Runtime 所有权；能力治理未并入。Desktop 相关 22 项、Runtime Bot 回归 21 项、lint、98 项架构测试、877 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移、Runtime 行为或业务数据操作，当前应用未重启。下一批迁移 Capability Governance 生命周期边界。

## 第五十九批：MCP 工具策略与执行边界

- 新增 `mcp-tool-command-contract`，逐项绑定 policy.probe/tool.request/spawn.probe/tool.call/tools.refresh 的请求和响应；已迁移的类型化命令总数增至 134 项。
- Desktop 新增纯 `mcp-tool-payloads` 和 Main `mcp-tool-handlers`，拥有 5 个 IPC channel、既有严格解析和来源校验 → 连接 → 解析 → 请求顺序；对应解析器从 `agent-payloads` 删除，Main 组合根删除直接注册。
- 授权、审批、进程/HTTP 执行和目录持久化保持 Runtime 所有权；实际调用与刷新继续使用集中式 130 秒超时。Desktop 相关 17 项、Runtime MCP 回归 11 项、lint、96 项架构测试、874 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移、Runtime 行为或业务数据操作，当前应用未重启。下一批迁移 Bot Channel 生命周期边界。

## 第五十八批：MCP 注册表生命周期边界

- 新增 `mcp-registry-command-contract`，逐项绑定 register/registerRemote/list/setEnabled/delete 的请求和响应；已迁移的类型化命令总数增至 129 项。
- Desktop 新增纯 `mcp-registry-payloads` 和 Main `mcp-registry-handlers`，拥有 5 个 IPC channel、既有严格解析和来源校验 → 连接 → 解析 → 请求顺序；对应解析器从 `agent-payloads` 删除，Main 组合根删除直接注册。
- 注册表持久化、凭据存储和工具发现保持 Runtime 所有权；策略探测、工具请求/调用和刷新未并入。Desktop 相关 16 项、Runtime MCP 回归 15 项、lint、94 项架构测试、871 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移、Runtime 行为或业务数据操作，当前应用未重启。下一批迁移 MCP 工具执行与策略边界。

## 第五十七批：已安装 Skill 生命周期注册边界

- 新增 `skill-command-contract`，逐项绑定 import/importRemote/list/get/delete/setEnabled 的请求和响应；已迁移的类型化命令总数增至 124 项。
- Desktop 新增纯 `skill-payloads` 和 Main `skill-handlers`，拥有 6 个 IPC channel、既有严格解析和来源校验 → 连接 → 解析 → 请求顺序；远程导入继续使用 30 秒超时，对应解析器从 `agent-payloads` 删除，Main 组合根删除直接注册。
- 不可变版本、内容寻址、权限重审批、引用阻止删除和工作区激活保持 Runtime 所有权；MCP 未并入。Desktop 相关 18 项、Runtime Skill 回归 5 项、lint、92 项架构测试、868 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移、Runtime 行为或业务数据操作，当前应用未重启。下一批迁移 MCP 注册表生命周期边界。

## 第五十六批：Skill Market 注册边界

- 新增 `skill-market-command-contract`，逐项绑定 list/install 的请求和响应；已迁移的类型化命令总数增至 118 项。
- Desktop 新增纯 `skill-market-payloads` 和 Main `skill-market-handlers`，拥有 2 个 IPC channel、既有 ID 修剪和来源校验 → 连接 → 解析 → 请求顺序；安装解析器从 `team-payloads` 删除，Main 组合根删除直接注册。
- 市场目录、完整包物化、冲突处理、导入和事件发布保持 Runtime 所有权；已安装 Skill 生命周期未并入。Desktop 相关 9 项、Runtime 市场回归 2 项、lint、90 项架构测试、865 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移、Runtime 行为或业务数据操作，当前应用未重启。下一批迁移已安装 Skill 生命周期注册边界。

## 第五十五批：Skill Local 注册边界

- 新增 `skill-local-command-contract`，逐项绑定 scan/inspect/import 的请求和响应；已迁移的类型化命令总数增至 116 项。
- Desktop 新增纯 `skill-local-payloads` 和 Main `skill-local-handlers`，拥有 3 个 IPC channel、既有解析语义和来源校验 → 连接 → 解析 → 请求顺序；对应解析器从 `team-payloads` 删除，Main 组合根删除直接注册。
- 目录发现、ZIP 解包、安装、缓存/watch 和事件发布保持 Runtime 所有权；Skill Market 与已安装 Skill 管理未并入。Desktop 相关 12 项、Runtime 本地 Skill 回归 11 项、lint、88 项架构测试、862 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移、Runtime 行为或业务数据操作，当前应用未重启。下一批迁移 Skill Market 注册边界。

## 第五十四批：Goal 生命周期注册边界

- 新增 `goal-command-contract`，逐项绑定 set/get/clear/pause/resume 的请求和响应；补齐 `GoalPauseResponse`，已迁移的类型化命令总数增至 113 项。
- Desktop 新增纯 `goal-payloads` 和 Main `goal-handlers`，拥有 5 个 IPC channel、有效载荷归一化和来源校验 → 连接 → 解析 → 请求顺序。Main 组合根删除对应直接注册。
- 目标轮次、Token 预算、连续阻塞判定和自动续跑保持 Runtime 所有权；Skill Local 未并入。Desktop 相关 13 项、Runtime Goal 回归 9 项、lint、86 项架构测试、859 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移、Runtime 行为或业务数据操作，当前应用未重启。下一批迁移 Skill Local 注册边界。

## 第五十三批：Activity Center 注册边界

- 新增 `activity-command-contract`，逐项绑定 listRuns/listExternalEvents/retryAnchor 的请求和响应；已迁移的类型化命令总数增至 108 项。
- Desktop Main 新增 `activity-handlers`，拥有 3 个 IPC channel、既有过滤 parser 和来源校验 → 连接 → 解析 → 请求顺序。Main 组合根删除对应直接注册。
- 活动投影、分页、标题装饰、敏感 lease 隔离和重试资格判定保持 Runtime 所有权；Goal 未并入。Desktop 相关 10 项、Runtime Activity 集成 15 项、lint、84 项架构测试、856 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移、Runtime 行为或业务数据操作，当前应用未重启。下一批迁移 Goal 注册边界。

## 第五十二批：Scheduled Task 注册边界

- 新增 `scheduled-task-command-contract`，逐项绑定 create/list/update/delete/trigger/history 的请求和响应；创建、更新和删除响应获得协议命名类型，已迁移的类型化命令总数增至 105 项。
- Desktop Main 新增 `scheduled-task-handlers`，拥有 6 个 IPC channel、既有严格 parser 和来源校验 → 连接 → 解析 → 请求顺序。Main 组合根删除对应直接注册。
- 规则计算、持久化、触发执行和历史记录保持 Runtime 所有权；Activity Center 未并入。Desktop 相关 14 项、Runtime 调度回归 52 项、lint、82 项架构测试、854 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移、Runtime 行为或业务数据操作，当前应用未重启。下一批迁移 Activity Center 注册边界。

## 第五十一批：Conversation Ask 注册边界

- 扩展 `conversation-command-contract`，补齐 ask.answer/cancel/pending 的请求和响应；已迁移的类型化命令总数增至 99 项。
- Desktop Main 新增 `conversation-ask-handlers`，拥有 3 个 Ask 生命周期 IPC channel、既有严格 parser 和来源校验 → 连接 → 解析 → 请求顺序。Main 组合根删除对应直接注册。
- 待处理问询注册表、回答结算和持久事件保持 Runtime 所有权；Scheduled Task 未并入。Desktop 相关 54 项、lint、80 项架构测试、852 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移、Runtime 行为或业务数据操作，当前应用未重启。下一批迁移 Scheduled Task 注册边界。

## 第五十批：Conversation Plan 注册边界

- 扩展 `conversation-command-contract`，补齐 plan.submit/get/approve/revise/cancel 的请求和响应；已迁移的类型化命令总数增至 96 项。
- Desktop Main 新增 `conversation-plan-handlers`，拥有 5 个 Plan 生命周期 IPC channel、既有严格 parser 和来源校验 → 连接 → 解析 → 请求顺序。Main 组合根删除对应直接注册。
- 不可变 revision、批准前置条件、Run/Graph 创建与原子持久化保持 Runtime 所有权；Ask 未并入。Desktop 相关 65 项、Runtime Plan 集成 14 项、lint、80 项架构测试、851 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移、Runtime 行为或业务数据操作，当前应用未重启。下一批迁移 Conversation Ask 注册边界。

## 第四十九批：Conversation 路由注册边界

- 扩展 `conversation-command-contract`，补齐 setExecutionMode/setInteractionMode/setContextWindowOverride/upgradeTrack/rebindTarget 的请求和响应；已迁移的类型化命令总数增至 91 项。
- Desktop Main 新增 `conversation-routing-handlers`，拥有 5 个路由 IPC channel、既有严格 parser 和来源校验 → 连接 → 解析 → 请求顺序。Main 组合根删除对应直接注册。
- 路由兼容性、轨道切换、模型/Agent/Team 目标验证和状态持久化保持 Runtime 所有权；Plan 与 Ask 未并入。Desktop 相关 56 项、Runtime 回归 29 项、lint、80 项架构测试、850 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移、Runtime 行为或业务数据操作，当前应用未重启。下一批迁移 Conversation Plan 注册边界。

## 第四十八批：Conversation 目录注册边界

- 扩展 `conversation-command-contract`，补齐 list/create/rename/setPinned/setArchived/delete 的请求和响应；已迁移的类型化命令总数增至 86 项。
- Desktop Main 新增 `conversation-management-handlers`，拥有 6 个目录生命周期 IPC channel、既有严格 parser 和来源校验 → 连接 → 解析 → 请求顺序。Main 组合根删除对应直接注册，托盘最近会话查询也改用 `requestConversation`。
- 对话目录持久化、引用约束与事件语义保持 Runtime 所有权；执行模式、目标绑定、计划和问答未并入。Desktop 相关 57 项、Runtime 集成 10 项、lint、80 项架构测试、849 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移、Runtime 行为或业务数据操作，当前应用未重启。下一批迁移 Conversation 路由与模式设置。

## 第四十七批：Team 注册与传输合同

- Protocol 新增 `team-command-contract`，逐项绑定 list/create/update/delete/startRun/setRunStatus 的请求和响应；RuntimeClient 新增 `requestTeam`。已迁移的类型化命令总数增至 80 项。
- Desktop Main 新增 `team-handlers`，拥有 6 个 IPC channel、既有严格 parser 和来源校验 → 连接 → 解析 → 请求顺序。Main 组合根删除对应直接注册，只注入 ipcMain、可信来源、连接和类型化传输。
- 成员依赖、协调者约束、Team Run 创建与状态机保持 Runtime 所有权；Conversation 未并入该模块。Desktop 相关 57 项、Runtime 集成 10 项、lint、80 项架构测试、848 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移、Runtime 行为或业务数据操作，当前应用未重启。下一批继续拆分剩余 Conversation 管理注册。

## 第四十六批：Global Agent 注册与传输合同

- Protocol 新增 `global-agent-command-contract`，逐项绑定 list/create/update/delete/listWorkspaceActivations/setWorkspaceActivation 的请求和响应；RuntimeClient 新增 `requestGlobalAgent`。已迁移的类型化命令总数增至 74 项。
- Desktop Main 新增 `global-agent-handlers`，拥有 6 个 IPC channel、既有严格 parser 和来源校验 → 连接 → 解析 → 请求顺序。Main 组合根删除对应直接注册，只注入 ipcMain、可信来源、连接和类型化传输。
- 新增 `DeleteGlobalAgentResponse`，准确描述硬删除空结果和有对话引用时的软归档详情；Preload、Renderer 声明和 AgentLibrary 复用同一类型。实体引用约束、归档决策、工作区激活持久化和事件发布保持 Runtime 所有权；Team 未并入。
- Desktop 相关 73 项、Runtime 集成 11 项、lint、78 项架构测试、846 文件扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移、Runtime 行为或业务数据操作，当前应用未重启。下一批迁移 Team 独立注册边界。

## 第四十五批：Agent 创建与版本注册合同

- 扩展 `agent-command-contract`，补齐 create/listVersions/createVersion 的请求和响应；`requestAgent` 现覆盖 Agent 读取、绑定、创建和版本管理 6 项命令。已迁移的类型化命令总数增至 68 项。
- Desktop Main `agent-handlers` 新接管 3 个 IPC channel，继续拥有 payload parser 选择和来源校验 → 连接 → 解析 → 请求顺序。Main 组合根删除对应直接注册，只注入 ipcMain、可信来源、连接和类型化传输。
- Agent 定义验证、不可变版本持久化、乐观并发与事件语义保持 Runtime 所有权；Global Agent 与 Team 不并入该模块。Desktop 相关 33 项、Runtime Agent 2 项、lint、76 项架构测试、844 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移、Runtime 行为或业务数据操作，当前应用未重启。下一批可迁移 Global Agent 或 Team 的独立注册边界。

## 第四十四批：Agent Catalog 注册与传输合同

- Protocol 新增 `agent-command-contract`，逐项绑定 get/updateBinding/list 的请求和响应；RuntimeClient 新增 `requestAgent`，Agent 目录调用不再使用返回类型可任意指定的通用请求入口。已迁移的类型化命令总数增至 65 项。
- Desktop Main 新增 `agent-handlers`，拥有 3 个 IPC channel、既有 Agent/Orchestration payload parser 和来源校验 → 连接 → 解析 → 请求顺序。Main 组合根只注入 ipcMain、可信来源、连接和类型化传输；模块不依赖 Electron、RuntimeClient 或 Storage。
- 保留默认 Agent、模型/fallback/凭据/Skill/MCP 绑定字段归一化与 Runtime 验证。Agent 创建和版本命令暂未并入，Global Agent 与 Team 继续作为独立领域。
- 新增 7 项注册、2 项 wiring 测试与编译期正反例；Desktop 相关 29 项、Runtime Agent 2 项、lint、76 项架构测试、844 文件扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移、Runtime 行为或业务数据操作，当前应用未重启。下一批继续迁移 Agent 创建/版本管理或其他剩余 Main 传输边界。

## 第四十三批：Usage 注册与传输合同

- Protocol 新增 `usage-command-contract`，绑定 `usage.summary` 的过滤请求和聚合响应；RuntimeClient 新增 `requestUsage`，使用统计调用不再使用返回类型可任意指定的通用请求入口。已迁移的类型化命令总数增至 62 项。
- Desktop Main 新增 `usage-handlers`，拥有统计查询 IPC、既有 payload parser 和来源校验 → 连接 → 解析 → 请求顺序。Main 组合根只注入 ipcMain、可信来源、连接和类型化传输；模块不依赖 Electron、RuntimeClient 或 Storage。
- 保留 sinceDays/taskId 过滤、任务 ID 修剪及 300 秒首次缓存构建超时。durable event 聚合与缓存继续由 Runtime 拥有，Renderer 展示缓存未迁移。
- 新增 4 项注册、2 项 wiring 测试与编译期正反例；Desktop 相关 21 项、Runtime Usage 3 项、lint、74 项架构测试、842 文件扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移、Runtime 行为或业务数据操作，当前应用未重启。下一批继续迁移剩余 Main 传输边界。

## 第四十二批：Policy 注册与传输合同

- Protocol 新增 `policy-command-contract`，逐项绑定 save/list 的请求和响应；RuntimeClient 新增 `requestPolicy`，作用域策略调用不再使用返回类型可任意指定的通用请求入口。已迁移的类型化命令总数增至 61 项。
- Desktop Main 新增 `policy-handlers`，拥有 2 个 IPC channel、既有 payload parser 和来源校验 → 连接 → 解析 → 请求顺序。Main 组合根只注入 ipcMain、可信来源、连接和类型化传输；模块不依赖 Electron、RuntimeClient 或 Storage。
- 保留策略 scope、approval mode、规则数量和委派 Agent 版本字段限制。作用域授权、不可变版本、事件事务与最终策略解析继续由 Runtime 拥有；Approval Center 和工具审批生命周期保持独立。
- 新增 6 项注册、2 项 wiring 测试与编译期正反例；Desktop 相关 22 项、Runtime Policy 13 项、lint、72 项架构测试、840 文件扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移、Runtime 行为或业务数据操作，当前应用未重启。下一批继续迁移剩余 Main 传输边界。

## 第四十一批：Settings 注册与传输合同

- Protocol 新增 `settings-command-contract`，逐项绑定 get/set 的请求和响应；RuntimeClient 新增 `requestSettings`，应用配置调用不再使用返回类型可任意指定的通用请求入口。已迁移的类型化命令总数增至 59 项。
- Desktop Main 新增 `settings-handlers`，拥有 2 个 IPC channel、既有 payload parser 和来源校验 → 连接 → 解析 → 请求顺序。Main 组合根只注入 ipcMain、可信来源、连接和类型化传输；模块不依赖 Electron、RuntimeClient 或 Storage。
- 保留配置键数量/长度、写入值 JSON 大小和可序列化检查。配置存储、更新时间及开放网关设置后的后台重绑定继续由 Runtime 拥有；Policy 不并入 Settings 合同。
- 新增 6 项注册、2 项 wiring 测试与编译期正反例；Desktop 定向 9 项、lint、70 项架构测试、838 文件扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移、Runtime 行为或业务数据操作，当前应用未重启。下一批继续迁移 Policy 等剩余 Main 传输边界。

## 第四十批：Kernel Discovery 注册与传输合同

- Protocol 新增 `kernel-command-contract`，绑定 `kernel.detect` 的空请求和检测响应；RuntimeClient 新增 `requestKernel`，内核发现不再使用返回类型可任意指定的通用请求入口。已迁移的类型化命令总数增至 57 项。
- Desktop Main 新增 `kernel-handlers`，拥有只读 IPC 和来源校验 → 连接 → 请求顺序。Main 组合根只注入 ipcMain、可信来源、连接和类型化传输；模块不依赖 Electron、RuntimeClient 或 Storage。
- Runtime 继续拥有内核注册表扫描、可执行文件探测和能力响应；桌面安装/更新仍属于宿主基础设施，运行生命周期中的 `kernel.recycle` 未并入发现合同。
- 新增 3 项注册、2 项 wiring 测试与编译期正反例；Desktop 定向 6 项、lint、68 项架构测试、836 文件扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移、Runtime 行为或业务数据操作，当前应用未重启。下一批继续迁移剩余 Main 传输边界。

## 第三十九批：Open Gateway 注册与传输合同

- Protocol 新增 `gateway-command-contract`，逐项绑定 status/logs/logs.clear 的请求和响应；RuntimeClient 新增 `requestGateway`，开放网关调用不再使用返回类型可任意指定的通用请求入口。已迁移的类型化命令总数增至 56 项。
- Desktop Main 新增 `gateway-handlers`，拥有 3 个 IPC channel 和来源校验 → 连接 → 请求顺序。Main 组合根只注入 ipcMain、可信来源、连接和类型化传输；模块不依赖 Electron、RuntimeClient 或 Storage。
- 保留旧调用可传入宽松日志查询值的行为，由 Runtime 过滤有效 offset/limit；OpenGatewayManager、状态聚合、日志环形缓冲和清理语义继续由 Runtime 拥有。
- 新增 7 项注册、6 项 wiring 测试与编译期正反例；Desktop 定向 14 项、Runtime Gateway 32 项、lint、66 项架构测试、834 文件扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移或业务数据操作，当前应用未重启。下一批继续迁移剩余 Main 传输边界。

## 第三十八批：Diagnostics 注册与传输合同

- Protocol 新增 `diagnostics-command-contract`，绑定 `diagnostics.list` 的请求和响应；RuntimeClient 新增 `requestDiagnostics`，诊断查询不再使用返回类型可任意指定的通用请求入口。已迁移的类型化命令总数增至 53 项。
- Desktop Main 新增 `diagnostics-handlers`，拥有列表 IPC、既有 payload parser 和来源校验 → 连接 → 解析 → 请求顺序。页面注册通过窄宿主端口装配；桌面诊断导出复用 `requestDiagnostics`，继续在 Main 组合 Runtime 状态、更新器、崩溃报告和脱敏文件。
- 注册模块不依赖 Electron、RuntimeClient 或 Storage；Runtime 继续拥有诊断生成与协议响应。导出的 healthcheck、文件保存和错误降级不属于本批迁移范围。
- 新增 4 项注册、2 项 wiring 测试与编译期正反例；Desktop 页面/导出相关 18 项、Runtime 回归 10 项、lint、64 项架构测试、832 文件扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移或业务数据操作，当前应用未重启。下一批继续迁移剩余 Main 传输边界。

## 第三十七批：Context Packet 注册与传输合同

- Protocol 新增 `context-packet-command-contract`，逐项绑定 peek/amend 的请求和响应；RuntimeClient 新增 `requestContextPacket`，上下文包调用不再使用返回类型可任意指定的通用请求入口。已迁移的类型化命令总数增至 52 项。
- Desktop Main 新增 `context-packet-handlers`，拥有 2 个 IPC channel、既有 payload parser 选择和来源校验 → 连接 → 解析 → 请求顺序。Main 组合根只注入 ipcMain、可信来源、连接和类型化传输；模块不依赖 Electron、RuntimeClient 或 Storage。
- 保留 peek 的线程 ID与可选模型/凭据/Agent 解析、amend 的清理/排除列表限制和受保护来源回执。上下文包生成、线程覆盖与 Runtime 状态语义继续由 Runtime 拥有。
- 新增 6 项注册、3 项 wiring/合同测试与编译期正反例；Desktop 相关 10 项、lint、62 项架构测试、830 文件扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移或业务数据操作，当前应用未重启。下一批迁移 Diagnostics 或其他剩余 Main 传输边界。

## 第三十六批：Memory 注册与传输合同

- Protocol 新增 `memory-command-contract`，逐项绑定 list/decide/rollback 的请求和响应；RuntimeClient 新增 `requestMemory`，Memory 调用不再使用返回类型可任意指定的通用请求入口。已迁移的类型化命令总数增至 50 项。
- Desktop Main 新增 `memory-handlers`，拥有 3 个 IPC channel、既有 payload parser 选择和来源校验 → 连接 → 解析 → 请求顺序。Main 组合根只注入 ipcMain、可信来源、连接和类型化传输；模块不依赖 Electron、RuntimeClient 或 Storage。
- 保留列表默认空载荷、决定的 changeId/枚举校验和回滚的 changeId 校验。Memory 策略、持久化、回滚和事件语义继续由 Runtime 拥有。
- 新增 7 项注册、4 项 wiring/合同测试与编译期正反例；Desktop 相关 13 项、lint、60 项架构测试、828 文件扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移或业务数据操作，当前应用未重启。下一批迁移 Context Packet 等剩余 Main 传输边界。

## 第三十五批：Approval Center 注册与传输合同

- Protocol 新增 `approval-command-contract`，逐项绑定 list/evaluate/enqueue/decide 的请求和响应；RuntimeClient 新增 `requestApproval`，审批中心调用不再使用返回类型可任意指定的通用请求入口。已迁移的类型化命令总数增至 47 项。
- Desktop Main 新增 `approval-handlers`，拥有 4 个 IPC channel、既有 payload parser 选择和来源校验 → 连接 → 解析 → 请求顺序。Main 组合根只注入 ipcMain、可信来源、连接和类型化传输；模块不依赖 Electron、RuntimeClient 或 Storage。
- 保留审批 payload 的空列表默认值、动作必填、决定 ID/枚举校验及 delegateAgentVersionId 条件校验。审批策略、持久化事务、授权和状态机继续由 Runtime 拥有。
- 新增 8 项注册、5 项 wiring/合同测试与编译期正反例；Desktop 相关 27 项、Runtime Approval Center/恢复回归 19 项、lint、58 项架构测试、826 文件扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移或业务数据操作，当前应用未重启。下一批迁移 Memory 或 Context Packet 等剩余 Main 传输边界。

## 第三十四批：Browser Extension 注册与传输合同

- Protocol 新增 `browser-extension-command-contract`，逐项绑定 status/restart/resetPairing/openFolder 的空请求和响应；RuntimeClient 新增 `requestBrowserExtension`，扩展命令不再使用返回类型可任意指定的通用请求入口。已迁移的类型化命令总数增至 43 项。
- 扩展状态与打开目录结果成为 Protocol 线类型；Desktop `browser-extension-contract` 改为复用类型并继续拥有状态常量、默认值和旧宿主归一化。Runtime 的 WebSocket Host、配对令牌文件和命令实现保持原所有权。
- Desktop Main 新增 `browser-extension-handlers`，拥有 4 个 IPC channel 和来源校验 → 连接 → 请求顺序。Main 组合根只注入 ipcMain、可信来源、连接和类型化传输；模块不依赖 Electron、RuntimeClient 或 Storage。
- 新增 7 项注册、5 项 wiring/合同测试与编译期正反例；Desktop 相关 58 项、Runtime 集成 5 项、lint、56 项架构测试、824 文件扫描和 13 包构建通过。Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移或业务数据操作，当前应用未重启。下一批迁移 Approval Queue 等剩余 Main 传输边界。

## 第三十三批：Desktop Waiting Commands 注册与传输合同

- Protocol 新增 `desktop-command-contract`，逐项绑定 listWaiting/continue/cancel 的请求和响应；RuntimeClient 新增 `requestDesktopCommand`，等待命令不再使用返回类型可任意指定的通用请求入口。已迁移的类型化命令总数增至 39 项。
- Desktop Main 新增 `desktop-command-handlers`，拥有 3 个 IPC channel、payload parser 选择和来源校验 → 连接 → 解析 → 请求顺序。Main 组合根只注入 ipcMain、可信来源、连接和类型化传输；模块不依赖 Electron、RuntimeClient 或 Storage。
- 保留 `expectedUpdatedAt` 严格 ISO 时间戳校验、continue/cancel 的乐观并发围栏及既有 Runtime 状态语义。新增 7 项注册测试与编译期正反例；Desktop 相关 26 项、Runtime 集成 13 项、lint、54 项架构测试、822 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移或业务数据操作，当前应用未重启。下一批迁移 Browser Extension 等剩余 Main 传输边界。

## 第三十二批：Browser Handoff 注册与传输合同

- Protocol 新增 browser-handoff-command-contract，逐项绑定 listWaiting/continue/cancel 的请求和响应；RuntimeClient 新增 requestBrowserHandoff，Handoff 调用不再使用返回类型可任意指定的通用请求入口。
- Desktop Main 新增 browser-handoff-handlers，拥有 3 个 IPC channel、payload parser 选择和来源校验 → 连接 → 解析 → 请求顺序。Main 组合根只注入 ipcMain、可信来源、连接和类型化传输；模块不依赖 Electron、RuntimeClient 或 Storage。
- 保留 handoffId、固定 revision=1、continue/cancel 的 lease disposition 和 Runtime 人工接管状态机。新增 7 项注册、3 项 payload 测试与编译期正反例；Desktop Handoff/BrowserStage 80 项、Runtime Handoff 4 项、lint、52 项架构测试、820 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移或业务数据操作，当前应用未重启。下一批迁移 Desktop Waiting Commands 等剩余 Main 传输边界。

## 第三十一批：Browser Workflow 注册与传输合同

- Protocol 新增 `browser-workflow-command-contract`，逐项绑定 list/get/createDraft/createRevisionDraft/submit/review/execute/approveAndExecute 的请求和响应；RuntimeClient 新增 `requestBrowserWorkflow`，Workflow 调用不再使用返回类型可任意指定的通用请求入口。
- Desktop Main 新增 `browser-workflow-handlers`，拥有 8 个 IPC channel、payload parser 选择和来源校验 → 连接 → 解析 → 请求顺序。Main 组合根只注入 ipcMain、可信来源、连接和类型化传输；模块不依赖 Electron、RuntimeClient 或 Storage。
- execute/approveAndExecute 继续由既有超时解析器使用回放长预算，其余命令保持默认值。新增 12 项注册测试与编译期正反例，wiring 测试补齐两个执行命令；84 项相关回归、两包类型检查、lint、50 项架构测试、818 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移或业务数据操作，当前应用未重启。下一批横向迁移 Browser Handoff 等剩余 Main 传输边界。

## 第三十批：Browser Recording 注册与传输合同

- Protocol 新增 `browser-recording-command-contract`，逐项绑定 list/get/start/stop 的请求和响应；RuntimeClient 新增 `requestBrowserRecording`，录制调用不再使用返回类型可任意指定的通用请求入口。
- Desktop Main 新增 `browser-recording-handlers`，拥有 4 个 IPC channel、payload parser 选择和来源校验 → 连接 → 解析 → 请求顺序。Main 组合根只注入 ipcMain、可信来源、连接和类型化传输；模块不依赖 Electron、RuntimeClient 或 Storage。
- start/stop 继续由既有超时解析器使用 30 秒预算，list/get 保持默认值。新增 8 项注册测试与编译期正反例；73 项相关回归、两包类型检查、lint、48 项架构测试、816 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移或业务数据操作，当前应用未重启。下一批迁移 Browser Workflow，继续维持各浏览器子域的独立合同与注册边界。

## 第二十九批：Browser Profile 注册与传输合同

- Protocol 新增 `browser-profile-command-contract`，逐项绑定 list/create/rename/delete/listSiteSessions/clearSiteSession 的请求和响应；RuntimeClient 新增 `requestBrowserProfile`，Profile 调用不再使用返回类型可任意指定的通用请求入口。
- Desktop Main 新增 `browser-profile-handlers`，拥有 6 个 IPC channel、payload parser 选择和来源校验 → 连接 → 解析 → 请求顺序。Main 组合根只注入 ipcMain、可信来源、连接和类型化传输；模块不依赖 Electron、RuntimeClient 或 Storage。
- listSiteSessions、clearSiteSession、delete 继续由既有超时解析器使用 30 秒预算，其他命令保持默认值。新增 10 项注册测试与编译期正反例；63 项相关回归、两包类型检查、lint、46 项架构测试、814 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无依赖、迁移或业务数据操作，当前应用未重启。下一批迁移 Browser Recording，Workflow 单独留后。

## 第二十八批：Composer 共享展示组件

- `ComposerModeBanner` 与 `ComposerTaskPanel` 迁入 `ui-kit`，和 `NewMaxComposerFrame` 组成第一组完整 Composer 展示原语。Plan/Goal 文案与动作、token/轮次投影、任务签名、首次自动展开、手动折叠、scope 切换和 dismiss 语义保持。
- 组件输入收窄为 `ComposerGoalStatus` 与 `ComposerTaskProjection`，不依赖 Protocol 或 Desktop 投影实现；现有类型通过结构兼容接入。Desktop 同名文件仅重导出，Website 改为直接导入共享包，过渡展示接口删除两项。
- 架构迁移清单扩展到三个组件，阻止展示接口重新转发或 Desktop 兼容文件恢复本地实现。新增 8 项包级测试；`ui-kit` 245 项、Desktop 40 项、Website 19 项、三包类型检查、lint、44 项架构测试、812 文件扫描和 13 包构建通过。
- Website 约 1,492 KiB；Desktop initial/total JS 为 2,100,451 / 2,975,222 字节。无新依赖、迁移或业务数据操作；当前运行实例未重启，仍使用第 27 批启动产物。

## 第二十七批：首个 Website/Desktop 共享 UI 组件簇

- `NewMaxComposerFrame`、Popover presence 与 Banner transition 状态迁入 `ui-kit`。共享实现只拥有布局、插槽和动效生命周期，不引用 Desktop、Website、Runtime 或业务状态；原 CSS 类名与 DOM 契约保持。
- Desktop 同名模块缩为兼容重导出，现有消费者不需要联动迁移；Website 两个入口改为直接导入共享包，过渡 `website-demo-surface` 删除该项。架构规则阻止共享组件回流到展示 barrel，并约束兼容模块只能指向 `ui-kit`。
- 新增 4 项包级动效测试和 1 项架构测试。`ui-kit` 237 项、Desktop 定向 29 项、Website 19 项回归、三包类型检查、lint、42 项架构测试、810 文件扫描和 13 包构建通过；Website 约 1,492 KiB，Desktop initial/total JS 为 2,100,455 / 2,975,226 字节。
- 只新增 workspace 依赖，无第三方版本、数据库迁移或业务数据变更；未重启应用。样式仍由 Shell CSS 提供，其他展示组件与 Desktop 源码构建输入留待后续有限批次。

## 第二十六批：内置浏览器回执传输边界

- Runtime 新增 `renderer-browser-command-bridge`，集中管理内置 WebView 命令等待者、一次结算和停机取消。瞬时请求事件、workspace/sequence、Socket 帧与 Browser Worker 仍由原组合层拥有；等待记录不再保存未读取的 Run/Thread/Tool 字段。
- Desktop Main 新增 `conversation-browser-handlers`，注册 `conversation.submitBrowserResult` 并保持来源校验、连接后解析、结果/错误长度上限和错误身份。协议类型关联由 14 项增至 15 项，AST 门禁覆盖两侧新边界。
- 保留先登记后发布、Worker 超时、回执字段透传、首次消费、未知/重复回执拒绝及停机取消。新增 8 项测试；Runtime 21、Desktop 59，共 80 项回归通过；类型检查、lint、41 项架构测试、809 文件扫描和 13 包构建通过。
- 未新增依赖/迁移、未操作业务库或重启应用。下一批横向推进 Website 共享 UI；Profile/Recording/Workflow 等 Browser RPC 后续单独处理。

## 第二十五批：Runtime 首发模型与凭据装配

- 新增 `initial-run-model-binding`，集中解析显式/Agent 默认模型、Provider 模型别名、Plan/Act 覆盖、Provider 元数据、凭据引用和模型上下文窗口。Runtime 通过窄目录端口装配，继续拥有 Agent/Team/Skill、上下文包、事件和 Run 生命周期。
- 凭据 helper 复用 Core 的 run override → Agent pin → Agent group → Provider primary 规则和 Provider 亲和性，不读取 secret；Provider 调用前的 SecureStore 读取及错误语义保持。fallback 重绑定复用同一 helper，但候选选择与事件事务未迁移。
- 新增 8 项纯用例测试；真实凭据调用、Plan/Act、消息启动和回退链共 61 项回归通过。Runtime 类型检查、lint、40 项架构测试、807 文件扫描和 13 包构建通过。
- 未新增依赖/迁移、未操作业务库或重启应用。下一批横向推进浏览器/传输注册边界。

## 第二十四批：Desktop Main 工具审批注册边界

- 新增 `conversation-approval-handlers`，统一注册审批决定与 pending 查询。运行时解析、来源/连接/请求顺序和错误传播由模块拥有，Electron、RuntimePipeClient 和存储实现只在 Main 组合根注入。
- `ConversationCommandContract` 增加 `conversation.decideToolApproval` 与 `conversation.listPendingToolApprovals` 的请求/返回映射，类型化命令由 12 项增至 14 项；AST 门禁覆盖新模块及两项命令，阻止基础设施反向依赖和无类型传输回退。
- 保留默认 `once`、deny scope 限制、thread/run 查询范围及 Runtime 审批语义。新增 7 项测试；4 个 Main 注册文件 55 项回归、Desktop 类型检查、lint、39 项架构测试、806 文件扫描和 13 包构建通过。
- 未新增依赖/迁移、未操作业务库或重启应用。下一批横向转向 Runtime 首发模型/凭据装配。

## 第二十三批：Renderer 运行订阅生命周期

- 新增 `use-conversation-transient-subscription`，集中管理 transient 订阅建立、scope generation、旧 listener 隔离、ready 失败和退订清理。ChatView 通过窄回调提供游标、健康/回退状态与事件处理，不再直接拥有订阅 effect。
- 订阅身份只由 primitive `enabled/scopeKey/threadId` 和稳定 transport port 决定；高频 sequence 与最新回调保存在 ref。帧展示、模型/内核或 process loader 回调更新不触发物理重订阅，保留此前避免 5 秒 IPC 竞态的约束。
- ChatView 继续拥有 transient/durable 展示队列、批量 flush、snapshot 合并、委派投影并入 durable parent、process cache 和终态 durable refresh。会话 reset 与订阅 dispose 共用队列清理回调；旧 scope 的事件和迟到失败不会污染新会话。
- 新增 5 项 Hook 测试；流式、内核、委派、终态、进程历史和用量共 142 项回归通过。Desktop 类型检查、定向 ESLint（0 error，16 条 ChatView 既有 warning）、39 项架构测试、805 文件扫描和 13 包构建通过；Desktop initial/total JS 为 2,098,962 / 2,973,733 字节。
- 本批未新增依赖/迁移、未操作业务库、未重启应用。下一批横向推进 Main 审批查询/决策注册边界，乐观 UI 与历史页合并继续保留为后续独立边界。

## 第二十二批：Runtime 活跃工具审批生命周期

- 新增 `ActiveToolApprovalLifecycle`，拥有活跃等待记录、会话/Run 查询、pending 摘要投影和一次性 settle。记录收窄为当前工具、展示摘要、审批参数/风险/范围、时间和唤醒回调，删除此前从未读取的完整聊天轮次与工作区执行上下文。
- 聊天工具、外部平台工具和内核权限桥统一调用 `register`；Run 取消、Abort 和新消息替换旧 Run 统一通过 `settle`，删除等待项后才执行取消持久化/广播并唤醒，重复结算不再散落操作 Map。
- 活跃决策用例通过 commit/record/publish 三个端口工作。持久化或授权提交失败时等待项保留；成功时继续按 commit、记录事件、唤醒工具调用、广播的原顺序执行。权限范围计算、session/always-app 授权事务、非活动审批恢复和协议错误映射仍由原有独立模块/Runtime 装配负责。
- 新增 6 项控制器测试；审批/追加边界、工具/内核和真实 RPC 共 167 项回归通过。Runtime 类型检查、定向 ESLint、38 项架构测试、804 文件扫描和 13 包构建通过；Desktop initial/total JS 保持 2,098,355 / 2,973,126 字节。
- 本批未新增依赖/迁移、未操作业务库、未重启应用。下一批横向推进 Renderer 运行订阅生命周期，避免继续深入同一 Runtime 领域。

## 第二十一批：Renderer 会话导航交互控制器

- 新增 `use-conversation-navigation-controller`，拥有目标页加载状态、最新请求令牌、导航意图版本和滑动动画生命周期。ChatView 注入 `isMessageLoaded/loadAround/onRenderTarget/onNavigationStart/writeProgrammaticScroll`，不向 Hook 暴露消息 Store、缓存或宿主 API。
- 目标已加载时只扩展 render window，不重复请求；缺失目标继续使用 around-message 页。并发目标只有最新令牌清理 loading；scope key 变化时旧 loading 在渲染期即不可见，旧导航意图失效。滑动保留原始起点/时钟并只更新终点，reduced-motion 和短距离保持即时写入。
- ChatView 继续拥有历史页合并、LRU 缓存、缺口锚点恢复、置底/未读状态和 minimap 几何。Hook 通过 programmatic-scroll 回调写帧，用户滚轮、触摸、键盘和 pointer 仍能停止动画；没有新增全局状态或 effect 发起用户导航。
- 新增 5 项控制器测试；目录 Loader、minimap、完整历史、导航加载和进程历史共 7 文件 52 项通过。Desktop 类型检查、定向 ESLint（0 error，16 条 ChatView 既有 warning）、37 项架构测试、803 文件扫描、git diff 检查和 13 包构建通过。Desktop initial/total JS 为 2,098,355 / 2,973,126 字节。
- 本批未新增依赖/迁移、未操作业务库、未重启应用。下一批横向推进 Runtime 活跃审批生命周期，运行订阅留作后续独立边界。

## 第二十批：会话 transient 订阅生命周期边界

- 新增 `conversation-transient-handlers`，集中注册订阅与取消 IPC，拥有参数解析、frame/reset 回送和 sender 销毁清理登记。Main 通过窄端口提供 sender ID、可信发送、销毁监听、Runtime 连接和 RuntimeSession 操作。
- 同一 sender 多个订阅只绑定一次 `destroyed` 监听；销毁时释放登记并异步清理该 sender 的全部 transient 订阅，因此 sender ID 后续复用会重新绑定。订阅失败不登记生命周期监听；取消订阅沿用原行为，不额外建立 Runtime 连接。
- RuntimeSession 继续拥有 `(senderId, subscriptionId)` 订阅表、同 ID 替换、底层重连和取消错误吸收；新模块不导入 RuntimeSession、RuntimePipeClient 或 Electron。可信 Renderer URL 校验仍由 Main 的发送适配器执行。
- 新增 9 项测试，覆盖调用顺序、一次性清理、ID 复用、frame/reset、缺失 snapshot、非法/不可信请求及连接/订阅失败。三类会话注册模块合计 48 项通过；Desktop 类型检查、定向 ESLint、34 项架构测试、802 文件扫描、git diff 检查和 13 包构建通过。
- 本批未新增依赖/迁移、未操作业务库、未重启应用。下一批横向推进 Renderer 会话导航控制器，避免继续深入同一 Main IPC 领域。

## 第十九批：会话写操作 Main 注册边界

- 新增 `conversation-write-handlers`，统一注册 `task.appendMessage`、`conversation.sendMessage` 和 `conversation.compact`。模块拥有运行时参数解析、调用顺序和附件补写用例；Main 入口只注入 sender 校验、Runtime 连接、图片暂存/持久化和传输实现。
- append 保留原始阶段顺序：来源校验、连接、大图暂存、类型化消息提交、持久图片复制、`message.attachImages` 补写和带本地 URL 的回执。持久化没有产出时不写空附件事件；任一步失败保持原错误传播。sendMessage 保留空正文和空白，compact 保留 120 秒等待。
- 没有把 Electron、RuntimePipeClient 或 Storage 引入注册模块，也没有建立通用 IPC 抽象。架构规则现在同时约束 query/write 两个模块，避免回退到入口直连或基础设施反向依赖。
- 新增 10 项写注册测试；与查询和传输契约合计 40 项 Main 定向测试通过。Desktop 类型检查、定向 ESLint、34 项架构测试、801 文件扫描、git diff 检查和 13 包构建通过；Desktop initial/total JS 保持 2,097,748 / 2,972,519 字节。
- 本批未新增依赖/迁移、未操作业务库、未重启应用。下一批可迁移 transient 订阅注册及 sender 生命周期适配，审批、浏览器和其他业务域 RPC 保持独立边界。

## 第十八批：旧委派报告精确查询

- `DelegationHistoryQuery.query` 不再为带 `childRunId` 的单报告请求调用 `listByThread`。新 `getByThread` 先读取持久主键记录，校验线程后只对该 running 记录执行校正；持久记录存在于其他线程时直接返回未找到，不回退旧消息，避免身份冲突和数据泄露。
- 持久记录缺失时，`DelegationMessageHistory.getLegacy` 使用消息端口的精确入口。`SqliteMessageStore.findDelegatedMessage` 通过线程约束和 JSON1 嵌套条件查找包含目标 childRunId 的最新消息，`LIMIT 1` 后才映射完整 Message；旧宿主没有该可选入口时仍回退原全量兼容解析。
- 保留 canonical-over-legacy 合并、运行态事件修复、8,000 字符报告分页、50 项列表分页、稳定排序和旧消息工具数解析。列表仍加载完整兼容集合，本批不同时引入摘要 DTO、SQL 列表分页、表达式索引或数据回填。
- 新增单报告不触发列表端口、持久命中不访问旧消息、旧消息精确回退、最新消息选择、空 ID 和线程隔离测试。Runtime 26 项、Storage 25 项通过；Storage/Runtime 类型检查、定向 ESLint、34 项架构测试、800 文件扫描、git diff 检查和整仓 13 包构建通过。
- 没有新增依赖/迁移、没有操作业务库或重启应用。下一批横向转向 R7 的会话写操作 Main 注册边界。

## 第十七批：Storage 委派投影事务协调

- `SqliteEventCheckpointStore` 继续拥有事件、派生投影和 checkpoint 的外层 SQLite 事务，但通过 `DelegatedRunEventProjection` 窄接口调用委派投影。提交路径不再临时构造 Store，也不再调用会自行开启事务的公共修复入口。
- `SqliteDelegatedRunStore.projectEventsInTransaction` 只校验范围和执行投影 SQL，供外层事务协调；`projectEvents` 包装独立 immediate 事务，保留从持久事件重建缺失读模型时的原子批量语义。两种用例的事务所有者明确分离。
- 生产持久化装配创建一个委派 Store，同时注入事件 Store 和 Runtime 仓库；测试/旧调用的默认构造继续可用。没有引入通用事件总线、Unit of Work 抽象、依赖或数据库迁移，也没有修改记录格式和终态规则。
- 新增外层投影失败回滚与独立批量投影中途失败回滚测试。Storage 相关 10 项、Runtime 持久化/历史集成 13 项通过；Storage/Runtime 类型检查、定向 ESLint、34 项架构测试、800 文件架构扫描和整仓 13 包构建通过。Desktop initial/total JS 保持 2,097,748 / 2,972,519 字节。
- Storage 全量 522 项中 495 项通过。27 项失败来自本批前的工作树基线：26 项冻结迁移列表未包含已有 `0056–0058`，1 项 Windows 备份清理 `EBUSY`。本批按横向推进要求记录而不扩展清理；事务相关测试均通过。
- 下一批转向旧委派历史查询范围，目标是避免报告查询先物化整个会话的持久报告，同时保留旧消息兼容合并和既有分页/修复契约。

## 第十六批：Website 演示所有权与展示接口

- WebsiteChatDemo、WebsiteCapabilityDemo、两个演示状态模块、工具栏/工作台包装、CSS、测试和构建脚本从 Desktop 迁入 Website。演示状态测试也归属 Website 的测试命令，应用与测试所有权一致。
- Desktop 新增 `website-demo-surface.ts`，只导出官网需要的真实 Shell 组件及契约。Website 通过 `@sync-think/desktop-demo-surface` 使用该接口；esbuild 和 TypeScript 分别在构建配置/paths 中解析。源码不再包含跨应用相对导入，架构规则阻止绕过接口和反向依赖。
- 原构建脚本借用 Desktop 的 React、esbuild、Tailwind 和工作区包依赖。Website package 现显式声明这些运行/开发依赖，新增自身 TypeScript 检查；pnpm 锁文件同步但没有改变第三方版本。Turbo 删除已迁走的 Desktop 脚本输入，仍保留 Desktop 源码输入以正确失效真实组件的源码构建缓存。
- React 组件逻辑除导入边界外保持；能力页继续 lazy import，esbuild splitting 与 3 MiB 预算保持。Website 8 项 Node 测试和 11 项状态测试通过，类型检查、脚本 lint、33 项架构测试、架构扫描和单包构建通过；最终整仓 13 包构建全部通过。Website JavaScript 约 1,490 KiB，Desktop initial/total JS 为 2,097,748 / 2,972,519 字节，预算均未调整。
- 浏览器插件不可用，使用仓库已有 Playwright/Edge 验证 `http://127.0.0.1:4177`：页面标题/首屏/iframe/场景切换通过，无框架错误覆盖。账号后端未启动导致 `/api/auth/get-session` 404，另有既有 sandbox 警告。完整旧交互套件首次显式运行时有 5 个断言偏差；对比迁移前源码确认对应逻辑未改，本批按横向推进要求记录而不扩展修复。
- 本批建立的是过渡展示接口，不宣称已完成共享 UI 包。下一批转向 Storage；后续再按稳定组件簇迁移，最终删除 Desktop 源码输入和适配层。

## 第十四、十五批：模型选择与审批恢复

- model-fallback-selection 只依赖 Core 策略、Shared 类型与窄候选目录；按同供应商前向优先链 → Agent 回退快照/旧绑定选择候选。失败计数复制后返回，输入不变；保留熔断、已尝试排除、无配置/已耗尽原因，以及 catalog-free 测试路径。Runtime 保留 watchdog 特例、诊断清理、能力判定（含图像用户覆盖）、重绑定和原有 fallback/context 原子事件提交。
- conversation-model-routing 通过 Agent/Team 只读端口解析上下文预览和压缩默认模型，保留协调者优先/首成员回退、空目标/未知轨道和当前目录实时读取。不涉及首次运行模型/凭据装配、模型探测与提供方 I/O。
- inactive-tool-approval 通过 read/expire 两端口处理已无活动等待者的请求。已决定状态原样回放，历史未知决定保守归一为 deny；孤立请求持久化 stale-approval 拒绝后返回 expired，写入失败保留错误而不报告成功。pendingToolApprovalSummaryFromEvent 和 scope 归一移到现有读模型。活跃审批的范围校验、原子授权提交、回调唤醒与广播顺序保持。
- 新增回退选择 10、默认模型解析 4、审批恢复/摘要 9 项测试。8 文件 57 项回归通过，另有 14 项真实上下文查询集成通过；覆盖真实 Runtime 的带图回退/熔断/耗尽暂停、审批重启和数据库写入失败。测试报告为 .data/phase14-runtime-tests.json、.data/phase14-context-tests.json。
- Runtime 类型检查、独立模块/测试定向 ESLint、32 项架构测试、git diff --check 和 13 包构建通过（Runtime 重建、12 包缓存命中）。架构门禁检查 799 个源文件，阻止上述模块导入 Runtime、DemoRunState、persistence 或基础设施实现。
- Desktop initial JS 2,097,748、total JS 2,972,519 字节保持；未新增依赖/迁移、未操作用户业务库、未重启应用。实际模型服务与重启后的人工验收仍在自动化验证范围之外。下一批转向 Website 共享 UI，保留后续 Runtime 活跃审批/首发模型边界待办。

## 第十二、十三批：草稿恢复、提交用例与会话 IPC 边界

- useComposeDraftRecovery 统一失败恢复、较新输入保护、附件按路径合并和发送后清理。成功只清理本次提交的附件；当前同路径附件在失败合并时优先。迟到失败继续存回原工作区/会话，沿用现有 keyed remount 恢复机制及草稿存储格式。
- submitConversationMessage 使用 prepare/append 两个注入端口，按准备结果的 thread/version 提交，返回持久图片和提示描述。ChatView 保留乐观消息回滚、标题、焦点与 UI 通知；没有引入新发送队列或改变模型/Skill/内核选择。ChatView 从 9,540 行减少到 9,413 行。
- conversation-query-handlers 从 Main 入口抽出消息、导航、上下文、执行过程、计划历史、文件列表、正文、diff、时间线共 9 个只读注册。保留每个入口的来源校验、解析、连接顺序，注入宿主端口用于独立测试；禁止反向导入 Electron、Main 入口和 RuntimePipeClient。
- ConversationCommandContract 从 3 项扩展至 12 项，覆盖上述 9 项查询、准备发送、append 和压缩；全部绑定参数与返回类型，编译期负例覆盖缺少正文、错误压缩模式、缺少内容引用及错误时间线范围。sendMessage 新增 IPC 形状解析，保留空正文/原始空白及模型覆盖；错误 modelId 类型提前拒绝。compact 仍使用原 120 秒等待设置。
- Renderer 回归 5 个文件 93 项通过，Main/解析器回归 3 个文件 73 项通过；合计新增 47 项运行测试（草稿 3、提交 8、查询注册 29、发送解析 7）。报告为 .data/phase12-tests.json 与 .data/phase13-tests.json。初次验证中的两个新测试夹具按现有协议修正：附件 ID 使用完整 path、时间线使用 runId；未为迁就夹具调整业务实现。
- 架构门禁扩展到新 Hook、提交用例、查询注册与 Main 下所有已迁移 RPC 调用，新增 4 项规则测试，共 28 项通过，检查 796 个源文件。Desktop 类型检查和新增边界/解析器的定向 ESLint 通过。13 包构建全部重建成功，Desktop initial JS 2,097,748、total JS 2,972,519 字节，预算保持；本轮未新增迁移、未重启应用或操作业务库。
- 按用户要求以多个有限边界推进：本轮交付上述三个拆分后转向验证，不继续扩大草稿机制。后续仍有 Runtime 模型路由/审批/浏览器、Storage 事务协调、Website 共享 UI、全仓依赖环；ChatView 的运行订阅和导航留待后续批次。

## 第十一批：上下文压缩生命周期

- 从 ChatView 迁出自动压缩、手动压缩与宿主事件处理，统一为 useConversationCompaction。Hook 只使用协议类型、已有时间格式函数及三个窄回调，不接收 ChatView/Runtime 对象；ChatView 保留事件筛选、消息准备、append、附件回显和草稿恢复。没有把所有发送状态搬进另一个大组件。
- 每个会话分别保存本地请求标识、宿主 operationId 和进度。导航后旧请求仍完成其原会话操作，旧结果和清理不改变新会话锁/提示；切回原会话时仍能识别其在途请求。状态属于 Hook 实例，不增加跨实例锁或跨进程恢复保证。
- 宿主事件具有优先级：收到较新宿主进度后，旧 RPC 回显不再覆盖它；不匹配当前 operationId 的终态不解除宿主锁。本地请求独立释放自身锁，状态刷新异常也进入释放路径，保持自动压缩失败不阻断发送。
- 原历史过滤按 startedAt 忽略超过 15 秒的终态，会误伤已观察到的长耗时任务。现在匹配活动 operationId 的终态照常完成；未观察到的旧终态继续按原窗口过滤。不新增压缩超时，也不修改 Runtime 摘要或持久化规则。
- 自动压缩继续只用于原生内核且占用达到原阈值，使用本次发送冻结的内核（包括队列传入的覆盖值）；NaN/缺失状态不触发。保留 auto/manual 的 onlyIfNeeded、文案和成功/无操作消失时长。旧计时器不清除新进度，StrictMode 重放按原截止时间重设计时器，卸载后不再创建 UI 定时器。
- 按 React 最佳实践保留动作触发的请求入口和函数式通知更新；宿主事件 effect 只消费事实。新增 18 项 Hook 回归、3 项真实 ChatView 集成及 1 项架构测试，覆盖阈值/内核、缺失接口、压缩/刷新失败、导航并发、长任务终态、迟到 RPC、计时清理和发送后的草稿恢复。
- 16 个文件 186 项定向回归全部通过；24 项架构测试、Desktop 类型检查、定向 ESLint 和 git diff --check 通过。联合回归初次出现一项历史导航测试时序失败：只等待调用数便断言 finally 后的状态；改为等待按钮恢复可用，保持原断言后复测全绿。报告 .data/phase11-final-tests.json。
- 架构门禁检查 793 个源文件；13 包构建成功（Desktop/Website 重建、11 包缓存命中）。Desktop initial JS 2,097,227、total JS 2,971,998 字节，预算不变。未新增依赖/迁移、未操作用户业务库、未重启应用；验证范围为自动化和构建。
- 下一批独立迁移发送后的草稿恢复与附件合并/清理，保留更新输入、跨会话及 keyed remount 行为；运行订阅、导航和其他发送生命周期继续分批处理。

## 第十批：正文读取与会话归属

- 上批 5 项基线失败包含过时的测试假设：MessageTextContent 已自动读取完整正文，ChatView.kernel 仍假设点击前无请求，并按全局调用顺序给提示与回答分配片段。夹具改为按消息引用和 offset 响应；明确区分展示阶段和操作阶段，不削弱完整文本、版本变化失败、取消或重复点击去重断言。
- 新回归复现实际展示错误：读取状态只有 assembled 字符串，没有归属；会话、正文引用或预览变化后仍显示旧全文，替换读取失败时旧全文持续保留。现在读取状态统一为 identity/status/text，渲染时只消费当前身份的结果，旧信号被取消后也不得写回。
- 更新夹具后，切换会话的取消测试继续暴露错配读取：ChatView 的布局副作用重置之前，旧消息可能带着新 conversationId 挂载并触发正文读取。现在 storedLoadedMessages 与 loadedMessagesScopeKey 保存事实，loadedMessages 先匹配当前历史范围再参与窗口/导航推导；合并消息入口也检查范围。沿用既有缓存、分页和布局重置语义。
- 保留流式预览、结束后自动组装全文及失败后重试。展示与复制/重新生成仍独立读取、独立取消，不引入全局全文缓存；重复复制只去重同一操作，不把两个消费者的生命周期合并。
- 新增 6 项组件回归和 1 项 ChatView 并发读取回归：会话/引用/预览/流式状态变化、旧响应迟到、替换读取失败，以及自动展示尚未完成时复制正确来源。组件修复前新测试中 4 项失败，修复后全部通过；复制测试增加第二分段失败的断言，确认部分正文不写入剪贴板。
- 14 个文件 144 项定向回归全部通过，含原 5 项基线失败；覆盖历史分页、缓存即时恢复、滚动锚点、过程历史、队列、Skill、终态与正文操作。报告在 .data/phase10-tests.json。23 项架构测试、Desktop 类型检查、定向 ESLint 和 git diff --check 通过，架构门禁检查 792 个源文件。
- 13 包构建成功（Desktop/Website 重建、11 包缓存命中）；Desktop initial JS 2,096,139、total JS 2,970,910 字节，未放宽预算。未新增依赖/迁移、未操作用户业务库、未重启应用；验证范围为自动化与构建。
- 下一批继续拆分 R3 的发送生命周期，先隔离上下文压缩与发送恢复；正文来源和会话范围校验作为迁移时必须保留的边界。

## 第九批：聊天队列与发送请求组装

- useComposeRequestQueue 接管排队草稿、会话级发送尝试、失败状态、自动续发及编辑/删除/手动重试。通过 SendComposeText 回调调用发送，不导入 ChatView、宿主通信或存储基础设施；已有 compose-request-queue 保留 localStorage 草稿格式。
- 每次发送使用独立尝试标识，同一会话在请求结束前保持锁定；切换会话后，成功结果只删除原会话的持久草稿，失败状态也只属于原会话。锁属于当前 Hook 实例，不扩展为跨实例或跨进程保证。
- 自动发送继续等待当前运行结束和线程就绪，按 FIFO 消费草稿；失败后保留请求并阻止自动重试，用户可手动重试或删除。模型沿用发送时选择，附件、Skill、推理、网络和内核沿用排队快照。
- compose-send-request 纯函数组装 append 协议载荷，保留任务版本、Agent/Team 模型解析、图片默认字段、纯图片文本和附件上下文。ChatView 继续处理压缩、附件落盘、乐观消息、错误恢复与宿主调用；本批未整体迁出发送生命周期。
- 按 React 最佳实践保留函数式状态更新，副作用依赖收窄到会话、线程就绪和运行状态；编辑和手动发送由事件触发。新增 6 项 Hook 测试与 5 项请求测试，覆盖 FIFO、附件与选项、导航期间锁/结果隔离、失败重试及 StrictMode 重放。
- 定向回归 113 项：108 通过、5 失败。原有队列 11 项与 Skill 43 项全部通过；5 项失败均属于 ChatView.kernel 完整正文复制/重新生成流程。使用本批修改前的 ChatView 临时副本复测 24 项，19 通过、相同 5 项失败，确认是本批前已存在的基线问题；临时源码已删除。报告：.data/phase9-current-tests.json、.data/phase9-baseline-tests.json。
- 架构测试 23 项通过（新增 2 项），门禁检查 792 个源文件；Desktop 类型检查、新实现/测试 ESLint、git diff --check 通过。13 包构建成功（Desktop/Website 重建、11 包缓存命中）；Desktop initial JS 2,096,009、total JS 2,970,780 字节，预算未放宽。
- 未新增迁移、未操作用户业务库、未重启应用；验证范围为自动化与构建。下一批先排查 5 项完整正文基线失败，再推进 R3 剩余发送生命周期、订阅和导航边界。

## 第八批：卡片投影与广播职责分离

- 新增 delegation-projection，将父工具行匹配、卡片字段计算、用量字段转换和重连快照合并从 Runtime 抽为纯函数。DelegationCardSource 只声明投影需要的字段，不通过 Pick<DemoRunState> 反向依赖执行宿主；模块只消费中立契约、协作策略和既有工具日志预算函数。
- 父工具行匹配保留显式 ID 优先、任务文本匹配、运行行优先和兄弟已占用行排除；参数被压缩时只接受唯一候选，多个歧义候选不猜测。协作策略提供同一组工具名，供执行派发和投影共同使用。
- 头像继续优先读取当前 Agent 配置，其次名字前两个字符，最后默认图标；运行中的草稿文本不作为最终报告。终态/超时映射、parallelGroup、当前工具、日志截断和结果字段保持原样。
- 用量纯函数消费已有 projectRunProcess 的去重结果，保留零值、未知字段省略和时长；Runtime 仍只读取子任务事件，用量读取异常沿用原降级行为，不新增累计规则。
- Runtime 仍按原顺序采用权威状态、合并卡片、刷新或清理计时器、保存终态卡片、广播和更新快照。快照函数保留父消息正文与过程信息；较晚完成的子任务仍发布卡片帧，但遇到另一轮活动快照时不覆盖它。
- 新增 20 项纯投影测试、2 项 Runtime 帧广播测试及 1 项架构测试。覆盖重复/歧义工具行、缺失父时间线、头像回退、六种终态组合、运行日志、零用量、输入不变、晚到广播、新轮快照保护和迟到进度不复活已完成任务。
- 本批 150 项验证通过：Runtime 129、架构规则 21。13 包构建通过（Runtime 重建、12 包缓存命中），门禁检查 790 个源文件；Desktop initial JS 2,095,055、total JS 2,969,826 字节保持不变。独立投影模块和新增测试 ESLint、git diff --check 通过。
- 本批未新增迁移、未操作用户业务库、未重启应用，验证范围为自动化回归与构建。下一批建议推进 R3 的消息发送与队列边界，保留草稿、附件、排队消息续发和会话切换行为；委派广播传输和旧历史索引优化仍可后续渐进处理。

## 第七批：委派消息历史与查询职责

- 原 DelegationService 同时承担领域状态、卡片缓存、消息元数据、旧数据解析和分页。本批保留其状态写入/修复与公开入口，将消息表示和缓存迁入 DelegationMessageHistory，将记录合并、排序和分页迁入 DelegationHistoryQuery。Runtime 调用点及持久化/广播顺序保持原样。
- 卡片模块仅访问 getMessage/updateBlocks/listDelegatedMessages 消息端口和按子任务 ID 查询状态的回调；实时刷新继续按父消息与子任务 ID 读取，不扫描整段会话。查询模块通过 listLegacy/listStored/reconcile 记录端口工作，不依赖卡片、Runtime、DemoRunState 或存储实现。
- context-message-history 直接引用旧消息解析入口，服务保留兼容重导出。元数据仍写在原消息块中，正文、其他 payload、工具数组、头像和使用量字段保持原格式；同父任务按 childRunId 合并，较晚的 running 卡片不覆盖已有终态。
- 修复 releaseParent 的丢失窗口：配置了消息存储但父消息尚未创建时，暂存卡片保留到后续写入；写入异常也保留缓存。成功写入后才释放，纯内存宿主沿用原释放行为。重试由现有调用路径触发，本批不引入后台队列，也不声称未落库的缓存可以跨进程恢复。
- 查询继续以持久状态覆盖旧消息事实，只有 running 记录触发恢复校正；有更新事件序号的修复交给状态所有者持久化。列表每页 50 项、报告每段 8,000 字符和会话隔离保持不变。旧历史的读取范围和 SQL 没有调整，索引/批量回填留作后续性能工作。
- 新增 19 项 Runtime 测试：卡片 8、查询 9、状态修复 1、真实 SQLite 故障恢复 1。覆盖延迟父消息、失败后兄弟合并、重复重试、关闭重开、正文和元数据保留、数组隔离、按 ID 读取、旧省略工具计数、分页/排序及查询修复失败重试。
- 本批 128 项验证通过：Runtime 108、架构规则 20（新增 4 项）。13 包构建通过，Runtime 重建、12 包缓存命中；门禁检查 789 个源文件。Desktop initial JS 2,095,055、total JS 2,969,826 字节保持不变。独立委派模块/测试 ESLint、git diff --check 通过。
- 未新增迁移、未操作用户业务库、未重启应用。下一边界：分离 Runtime 委派卡片投影构造与广播编排，保持父工具行匹配、头像、子任务用量、状态口径和新会话快照隔离。

## 第六批：委派准入与 Agent 选择

- 新增 delegation-admission，将 executeDynamicAgentDelegation 中参数解析、协作限额和 Agent 选择迁为独立服务。输入只包含线程标识、工具参数及父任务额度事实，输出区分准入结果和原有拒绝响应；服务本身不创建任务或修改计数。
- 两个只读宿主端口分别读取协作设置和线程所属工作区的有效目录。Runtime 适配 listEffective 并传递头像、能力、来源及写策略，服务复用现有协作/分配/时限规则；每次调用重新读取设置和激活状态。
- 保留顺序：解析 JSON → 校验任务 → 读取设置并校验额度 → 校验 Agent ID → 读取有效目录 → 匹配能力。保留错误文本/字段、parallelGroup 截断、数值规范化和预算边界。agent_run 仍只豁免动态委派开关，其余限制继续生效。
- 写权限检查仍在绑定子任务后执行；父子身份、启动事件/读模型/checkpoint 事务以及执行控制器调用顺序保持原样。没有引入新的依赖、缓存或数据库迁移。
- 新增 25 项准入测试，覆盖坏参数、拒绝优先级、后台额度、缺失/未激活/不匹配 Agent、能力转换、同步/后台策略、激活变化和读取异常。现有真实 SQLite 集成增加任务缺失、ID 缺失、未激活和能力不匹配断言：无子记录、无启动事件、无执行器、父计数不变；仍验证写入故障回滚后重试只启动一次。
- 架构门禁扩展至准入服务，阻止反向依赖 Runtime、DemoRunState 和基础设施。155 项验证通过：Runtime 139、架构规则 16。13 包构建通过（Runtime 重建、12 包缓存命中），检查 787 个源文件；Desktop initial JS 2,095,055、total JS 2,969,826 字节保持不变。新增源码和测试 ESLint、git diff --check 通过。
- 本批未重启应用、未操作用户业务库。验证范围为自动化测试与构建，真实模型调用和重启后的人工验收另行执行。
- 下一边界：把父消息卡片的兼容写入和历史查询从 Runtime 编排中分离，复用现有委派状态服务。重点保持兄弟任务合并、晚到终态、旧消息兼容、分页与事务失败后的重试行为。

## 第五批：委派执行生命周期控制器

- 新增 delegation-execution：通过 execute、abort、markTimedOut、failBackground、releaseBackground、reportError 六个窄端口管理后台与同步委派的执行、计时、取消和清理，不依赖 Runtime、DemoRunState 或 SQLite。
- Runtime 仍负责 Agent 选择、权限、父子身份、启动事务、终态持久化与工具返回。上批的“先落盘再执行”边界保留，当前控制器只接管已获准任务的执行生命周期。
- delegation-timeout-policy 保留原时限：agent_run 默认/最大 7,200 秒、最小 60 秒、1,800 秒无进展；agent_delegate 默认 300 秒、最大 3,600 秒、最小 1 秒。非数值和非有限值回退默认，有限值向下取整后夹取范围。
- 进度仅续期后台空闲计时器，绝对期限固定；取消、终态或执行结束立即清理计时器。单个任务取消不影响兄弟任务；父调用取消仅关联同步委派。
- 修复已取消的父信号早于子执行器 AbortController 注册时的漏取消窗口。Runtime 关闭会禁止新委派、撤销现有委派并等待执行器清理；后台失败上报异常仍释放计时器与终态快照。
- 23 项新增控制器/策略测试使用虚拟时钟，覆盖空闲与绝对期限、重复启动、取消隔离、终态后进度、同步异常、预先取消、监听移除和关闭等待。新增 4 项架构规则测试，防止控制器重新依赖 Runtime 或基础设施。
- 本批 151 项验证通过：Runtime 136、架构规则 15。13 个包构建通过；Desktop initial JS 2,095,055、total JS 2,969,826 字节保持不变。新增模块和测试 ESLint、git diff --check 通过。
- 生产执行测试仍有浏览器扩展端口 17374 已占用提示，执行/关闭断言通过；本批不包含浏览器扩展验收。未新增迁移、未操作用户业务库、未重启当前应用。
- 下一边界：将 executeDynamicAgentDelegation 的参数解析、准入和 Agent 选择抽成独立用例服务，保留相同权限检查和持久化调用顺序；消息卡片兼容写入与历史查询另行迁移。

## 第四批：委派事件与状态原子提交

- Runtime 在事件压缩前，通过 delegation-event 捕获委派领域事实。Shared 的 delegation-state 校验子任务/会话身份、状态及工具数；事件序号和更新时间只取事件信封，不信任快照中的同名字段。
- SqliteEventCheckpointStore 在事件与 checkpoint 的原事务中调用 SqliteDelegatedRunStore.projectEvents。事件、状态投影或 checkpoint 任一写入失败，整个事务回滚；外层 UnitOfWork 的原子性继续保留。
- 临时文本/进度广播不再写持久状态。正常 SQLite 路径在广播前已有读模型；无持久库或自定义测试宿主保留服务兼容行为，不把跨后端写入宣称为 SQLite 原子提交。
- 额外修复启动窗口：agent_run / agent_delegate 先持久化子任务 run.started 和父子关系，再注册并执行子任务。失败时不启动执行器、不增加父任务委派计数，重试只启动一次。
- 新事件记录可用于重建丢失的读模型，完整报告和工具数不受卡片截断影响。旧版已有 running 记录或消息卡片，读取时用终态事件修复并持久化结果；纯粹“当前没有执行器”的观察仍只影响查询结果。
- 不批量改写旧事件或用户数据库；旧任务如果既无委派记录/卡片、又无带委派事实的事件，本批不推测其身份。父消息卡片兼容写入仍独立于事件事务，卡片格式和工具日志尚未迁入读模型。
- 定向回归 138 项通过：Runtime 99、Storage 19、Shared 9、架构规则 11。含事件/投影/checkpoint 故障注入、启动失败、关闭重开、旧终态修复、丢失投影重放、晚到进度、会话隔离与大报告保留。
- 13 个包全量构建通过；Desktop initial JS 2,095,055、total JS 2,969,826 字节不变。新增/修改的独立委派模块与新增测试 ESLint 通过；git diff --check 通过。
- 本批未新增数据库迁移、未重启应用。下一批建议抽离 Runtime 中的委派启动、停止和超时编排；历史卡片查询优化继续保持单独迁移边界。

## 第三批：审查与返工决策脱离 SQL

- Shared 的 review-outcome 负责结论规范化、判据一致性、产物分配范围与幂等内容比较。先校验输入，再读取分配快照并绑定，保留错误优先级、判据顺序和产物顺序。
- rework-artifacts 负责已审查产物的父版本校验、合法输出状态、图片多候选例外，以及下一轮审查的版本集合。存储层只加载证据与版本，继续检测缺失和损坏的持久数据。
- review-transition 负责达到上限后的暂停/中止/转交决策，以及审查通过后的运行状态选择。备用审查员只使用一次；缺失或耗尽时保持原有暂停行为与事件类型。
- orchestration-store 保留租约 fencing、幂等重放入口、SQL 条件更新、依赖就绪查询、派生步骤持久化与事件顺序。证据、步骤、验收门、事件和 checkpoint 继续在同一 SQLite 事务内提交。
- 新增 32 项纯策略测试、4 项真实 SQLite 事务测试：覆盖中止、缺失备用审查员、备用审查员通过/拒绝，以及转交事件写入失败的整体回滚。沿用既有租约过期、重放冲突、产物冻结与损坏数据测试。
- 本批 286 项验证通过：Shared 125、Storage 76、Runtime 调度/生产执行 65、Core 9、架构规则 11。13 个包全量构建通过，Desktop initial JS 2,095,055、total JS 2,969,826 字节保持不变；新增策略与测试的 ESLint 通过。
- Runtime 集成测试日志出现浏览器扩展端口 17374 已被占用的提示，该可选服务未启动；调度/执行断言全部通过，未停止当前应用来释放端口。本批不包含浏览器扩展功能验收。
- 迁移清单测试原先只期待截至 0055 的完整列表，本批补齐已有 0056–0058；没有新增或改写迁移。
- 本批未重启应用、未操作用户业务库；当前运行进程仍需重启后加载代码。后续优先将委派读模型推进并入事件事务，补事件提交与投影失败之间的恢复测试。

## 第二批：调度契约脱离存储实现

- 将计划/运行图/步骤输入输出、审批记录、Agent 上下文记录迁到 Shared 的三个独立契约模块；类型签名、字段和可选性保持原样。
- 领域错误及判断函数迁到 orchestration-errors，诊断文本清理迁到 diagnostic-text。Storage 保留原导出入口，并引用同一份错误类，保持 instanceof 判断兼容。
- Scheduler、scheduler-ports 和 StepExecutor 的源码已消除对 Storage 的静态与内联类型依赖。实际数据库事务与 SQL 仍由原适配器执行，生产执行器的具体存储装配留在基础设施边界。
- 架构检查规则与 CLI 分离，增加静态 import/export、内联 import 类型、动态 import、require、相对路径的检查；字符串形式的文档示例不误报。新增 `pnpm test:architecture`。
- 本批 238 项验证通过：Shared 93、Runtime 调度/生产执行 65、Storage 69、架构规则 11。13 个包完整构建通过；Desktop 包体仍为 initial JS 2,095,055、total JS 2,969,826 字节。
- 本批未新增数据库迁移，未重启当前应用。下一项 R6 工作是把 review/rework 决策从 SQL 事务实现中抽离；需要继续保留租约、幂等与原子提交语义。

## 已落地的边界

| 边界             | 实现与职责                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 委派任务生命周期 | Runtime 产生事实，DelegationService 合并卡片、查询状态、兼容旧消息；通过 DelegatedRunRepository / DelegationMessagePort 使用存储                                                                                                                                                                                                                                                                                                                                                                              |
| 委派执行控制     | DelegationExecutionController 管理计时器、取消监听和执行清理；Runtime 用窄端口承接状态与持久化                                                                                                                                                                                                                                                                                                                                                                                                                |
| 独立状态读模型   | SqliteDelegatedRunStore 保存任务、会话归属、状态、真实工具数、完整最终报告和事件序号；不依赖消息列表当前页                                                                                                                                                                                                                                                                                                                                                                                                    |
| 上下文           | delegation-context 格式化所有运行中任务及最近 8 个终态任务，包含准确 childRunId；agent_run_status 按当前会话查询，列表每页 50 条、报告每段 8,000 字符                                                                                                                                                                                                                                                                                                                                                         |
| 终态投影         | Protocol 的 unresolvedToolTerminalError 为 Runtime 与 Renderer 提供相同规则；未报告结果的工具不再因父运行结束被标成成功                                                                                                                                                                                                                                                                                                                                                                                       |
| 聊天表现         | conversation-types、message-text-types、composer-editor-types 为独立类型叶；ConversationPageCache 管理原有 8 个会话 / 每会话 100 条消息缓存，可为独立宿主创建实例                                                                                                                                                                                                                                                                                                                                             |
| 聊天发送         | useComposeRequestQueue 管理队列；useComposeDraftRecovery 管理恢复/附件；submitConversationMessage 管理准备与提交；compose-send-request 纯函数组装协议载荷；ChatView 保留乐观 UI                                                                                                                                                                                                                                                                                                                               |
| 上下文压缩       | useConversationCompaction 管理自动/手动请求、宿主进度、会话锁和计时器；实际摘要及落盘归 Runtime                                                                                                                                                                                                                                                                                                                                                                                                               |
| 模型选择         | model-fallback-selection 只选择回退候选；conversation-model-routing 解析预览/压缩默认模型；Runtime 保留能力投影、凭据、首发装配及事件事务                                                                                                                                                                                                                                                                                                                                                                     |
| 工具审批         | active-tool-approval 管理活跃等待、查询、投影和结算；inactive-tool-approval 处理重复/孤立请求；tool-approval-read-model 解析历史摘要；Runtime 装配权限策略与持久化事务                                                                                                                                                                                                                                                                                                                                        |
| Website 演示     | 入口/状态/包装/样式/构建归 Website；desktop demo surface 是唯一真实组件适配入口，作为后续共享 UI 迁移接缝                                                                                                                                                                                                                                                                                                                                                                                                     |
| 调度器           | SchedulingRepository、SchedulingApprovals、SchedulingTransaction、SchedulingAgentContexts 替代具体 SQLite 类参数；事务边界不变                                                                                                                                                                                                                                                                                                                                                                                |
| 完成决策         | resolveOrchestrationCompletion 为纯领域函数；与既有 review-policy 同放 shared，避免为小范围迁移引入新包依赖                                                                                                                                                                                                                                                                                                                                                                                                   |
| 审查/返工决策    | review-outcome、rework-artifacts、review-transition 只依赖领域数据；Storage 加载事实并原子执行决策                                                                                                                                                                                                                                                                                                                                                                                                            |
| RPC / Main       | 188 项命令已按 Conversation、Scheduled Task、Activity、Browser 子域、Desktop Waiting、Extension、Approval、Memory、Context Packet、Diagnostics、Gateway、Kernel、Settings、Policy、Usage、Agent、Global Agent、Team、Goal、Skill Local、Skill Market、已安装 Skill、MCP 注册表、MCP 工具操作、Bot Channel、Capability Governance、Prompt/Design、Workspace、Task 目录、Participation Mode、Plan、Run Control、Artifact、Provider Catalog 和 Provider Credentials 分别绑定参数与结果；各域通过独立注册模块装配 |
| 原生驱动         | windows-uia-contract 独立于驱动和后端，移除两者的类型反向依赖                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 构建             | Website Turbo 输入显式包含 Desktop 源码、演示构建脚本、共享包源码/清单与设计 token；Desktop UTF-8 产物消除中文转义开销                                                                                                                                                                                                                                                                                                                                                                                        |

## 修复的行为

1. 父运行已结束后，较晚完成的子任务与历史兄弟卡片按 childRunId 合并。失败、取消和无正文父消息也保存委派元数据。
2. 终态不被较晚的 running 进度覆盖。持久记录按事件序号推进；终态种类保持稳定。
3. 新会话轮次从独立读模型获取状态，旧回答中的 running 文本不再作为事实来源。旧消息中的委派元数据继续可读，并按省略行标记恢复工具数。
4. 卡片刷新使用按 ID 读取，避免新增对整段会话的扫描；有持久仓库时不再重复维护全量内存状态，终态卡片写入成功后释放临时缓存。
5. 普通可恢复暂停不会被当成工具失败；已结束运行的未返回工具保持明确的“未报告结果”错误。

## 数据迁移与恢复

- 新增 SQLite migration 0058_delegated_run_read_model。读模型按 thread 外键级联清理；任务归属不随重复写入改变。
- 原消息块保留原格式，不批量改写历史。旧任务在读取时兼容；新任务写入独立表。
- 第四批已将新委派事件、读模型和 checkpoint 合并到一个事务；旧 running 记录根据终态事件校正并持久化。恢复后没有活动执行器的记录仍报告失败；历史卡片兼容写入和查询索引优化保留为后续边界。
- 本批验证仅在临时数据库执行迁移，包含关闭连接后重新打开、120 条历史消息和删除会话。当前用户应用进程未重启；运行中的旧进程尚未加载这批修复。
- 回滚应用代码时可保留新增表；避免人工删除业务数据库或改写迁移版本。

## 架构门禁

`pnpm lint:architecture` 使用 TypeScript AST 检查 921 个应用/包源文件：

- packages 不反向导入 apps；
- core/shared 不导入 storage/workers/adapters/secure-store；
- Scheduler、scheduler-ports、StepExecutor 不导入存储/工作器/适配器/凭据库，内联类型和动态导入同样检查；
- 委派准入、执行、时限、状态门面、消息历史、查询和卡片投影模块不导入 Runtime、DemoRunState 或基础设施实现；历史/投影模块不反向依赖门面/执行用例，查询不依赖卡片实现；
- 已抽出的契约叶不反向导入对应 UI/驱动实现；
- 回退选择、会话默认模型、首发模型/凭据绑定、Renderer 浏览器命令桥、活跃/非活动审批和审批读模型不导入 Runtime、DemoRunState、persistence 或基础设施；
- Website 演示不直连 Desktop 内部，Desktop 展示接口不反向依赖 Website；
- Shell 辅助模块不再从 ChatView 导入类型；
- 聊天队列、请求组装、压缩、草稿恢复、提交、导航与 transient 订阅模块不导入 ChatView、宿主通信、Main/Preload 或基础设施实现；
- Main 会话目录、路由、Plan、Ask、查询、写入、审批、浏览器回执、transient 订阅、Scheduled Task、Activity、Browser 各子域、Desktop Waiting Commands、Browser Extension、Approval、Memory、Context Packet、Diagnostics、Open Gateway、Kernel Discovery、Settings、Policy、Usage、Agent、Global Agent、Team、Goal、Skill 各子域、MCP 注册表、MCP 工具操作、Bot Channel、Capability Governance、Prompt/Design、Workspace、Task 目录、Participation Mode、Plan、Run Control、Artifact、Provider Catalog 和 Provider Credentials 注册不直接导入 Electron、RuntimePipeClient、入口或基础设施；
- 已迁移的 212 项 RPC 在 Main 下不再退回未关联参数/结果的 request；Desktop 共享 Composer UI 不得退回本地兼容入口。
- 生产源码的相对依赖、工作区包入口以及静态/类型/字面量动态导入不得形成强连通环。

根 `pnpm build` 的 prebuild 已接入门禁。直接运行单包构建的流水线应另外执行该命令。
此检查覆盖当前生产源码图和已迁移边界；计算生成的模块名、运行时插件路径及测试夹具不进入静态依赖图。

## 验证

- 定向回归 571 项通过：Runtime 271、Desktop 199、Storage 81、Shared 9、Workers 11。
- 涵盖后台启动/停止/续接、晚到兄弟任务、查询会话隔离、报告分段、历史分页与导航、卡片/工具展示、审批与调度事务、review/rework、Windows UIA 契约。
- 类型检查通过；三类 RPC 含编译期负例，错误参数和未知命令应产生 TypeScript 错误。
- 根 pnpm build 的 13 个包全部通过；本批新增实现文件通过定向 ESLint，git diff --check 通过。
- 生产 Desktop 构建：initial JS 2,095,055 字节，total JS 2,969,826 字节；预算未放宽。
- Website 演示构建通过，Turbo dry-run 已确认执行卡片、聊天类型、Shell CSS、演示构建脚本及 token 文件进入哈希。
- 旧外部内核测试期待 create_agent 写能力，与此前已存在的只读目录策略不一致；替换为三种权限模式均拒绝目录外写入、重复调用不落数据的断言。未扩大工具权限。

## 后续迁移边界

本批解决高风险状态错误并建立可替换的接缝，不等于把两个巨型模块全部重写。

第八十九批进一步把消息卡片兼容路径拆成纯投影解析、旧消息读取与实时卡片持久化三个边界。
旧数据仍按原消息格式读取，新卡片仍走原持久化与合并流程；旧历史查询已有精确 child run 查询，后续仅在
真实性能指标证明需要时再优化，不为预期负载提前改表或增加索引。

| 审查项       | 本批结果                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 后续目标、风险与验证                                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| R1 / R4 / R5 | 状态丢失、终态口径、消息页依赖和新事件原子投影已修复；纯消息投影、旧消息兼容读取与实时卡片持久化已分离，延迟落库与重试已覆盖                                                                                                                                                                                                                                                                                                                                                                                                   | 后续按可测用例继续拆分展示读模型；旧历史查询仅在有性能指标时优化，保持事件序号和终态不回退规则                         |
| R2 Runtime   | 委派各边界、模型路由/绑定、审批生命周期、Goal/任务清单、跨 Kernel transcript、Renderer 浏览器回执桥和 Desktop Waiting 安全投影已抽出；Main 业务注册已按有限子域分组，业务命令旁路已清零；daemon 自启副作用已统一到 Desktop supervisor；Main/Runtime 未连接辅助面已清理                                                                                                                                | 继续按独立纯用例缩减 Runtime；保持事件顺序、权限范围、目标续跑、原生会话路由与恢复测试                                 |
| R3 ChatView  | 抽出类型、缓存、队列、请求组装、压缩、草稿/附件恢复、提交、导航控制器、transient 订阅、消息合并、运行身份/Kernel 投影及会话滚动位置；历史分页、正文来源和会话隔离已有独立边界；Terminal 死全局状态、旧 Composer 菜单、RightRail、自引用任务历史面板与 RightDock 旧 Git 面板已清理                                                                                                                             | 大型渲染编排仍留在组件中，后续只按可独立验证的用例迁移；保留 keyed remount、滚动锚点和内容归属行为                     |
| R6 Storage   | 调度器窄接口、中立 DTO/错误契约、纯完成、review/rework、计划差异与步骤图规则已落地；委派事件投影已有明确外层事务所有者和独立修复入口；生产执行器全部存储参数已改用 Runtime 窄端口和最小投影，执行预留 DTO 已进入 Shared                                                                                                                                                                                                                                                                                                                  | 后续继续按独立用例拆分大型存储类，避免一次性重写。保持 SQLite 原子提交、预留幂等和租约 fencing                         |
| R7 RPC       | 212 项命令已按有限业务域完成请求/响应类型关联，对应 Main 注册已分组；Kernel Recycle 与消息图片附件的最后两条业务旁路已收口                                                                                                                                                                                                                                                                                                                                                                                                | 继续用编译期负例和 AST 门禁防止回退；保留来源检查、运行时解析、sender 生命周期和等待策略                             |
| R8 Website   | 演示入口/状态/构建已归 Website；Composer Frame、Mode Banner 和 Task Panel 已迁入 `ui-kit`，Website 与 Desktop 均直接消费，三个 Desktop 兼容重导出已删除                                                                                                                                                                                                                                                                                                                                                                         | 后续按价值迁移其他无宿主副作用组件；逐批验证样式所有权、浏览器交互和包体预算                                       |
| R9 类型环    | 四组对应契约已抽离；AST 门禁覆盖内联类型和动态导入，生产源码依赖图已接入 prebuild，唯一旧环已解除，Composer 与 Core 审核策略兼容重导出已删除                                                                                                                                                                                                                                                                                                                                                                                     | 持续保持图无环并禁止旧兼容路径恢复；计算生成模块名、插件加载和测试夹具仍由各自集成测试验证                             |

未执行真实付费模型请求、Windows 原生桌面自动化或应用重启后的人工验收；相关结果以自动化测试和构建为边界。
