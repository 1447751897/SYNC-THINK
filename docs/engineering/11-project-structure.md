# Project Structure

更新时间：2026-09-20

第一百零五批在页面数据加载边界补齐并发与错误所有权。`ActivityCenterPage` 用本地请求代次隔离过滤、
事件刷新和分页响应；`AbilityCenterPage` 单独拥有本地 Skill 扫描错误与重试，不复用目录/编辑错误状态。
Runtime 协议和存储不变。

第一百零四批删除 Desktop Renderer 根目录余下九个零生产引用旧投影及封闭测试。冷启动快照行为现在
由在用的 `event-history` 与 `m0-projection` 测试直接覆盖，Runtime 重试继续归 `runtime-connection`；
生产 TypeScript 输入不再携带旧 Beginner/Instrument/Continuum/Recent/Runtime View 状态模型。

第一百零三批删除 Desktop Renderer 根目录中 19 个仅供历史 M1/M2 验收使用的生产输入模块，并退役
对应专属测试与 `selftest:m1-soft`。Main 下仍在 IPC 链路中的 M1 文档打开、handtest 解析和 dogfood
证据/评分模块保留；`selftest:m2` 继续覆盖实际 orchestration payload 与当前六个生产层级。

第一百零二批从 `SettingsPage` 删除未挂载的旧机器人对话实现及其 Telegram 专属状态/资源。
`SettingsPage` 只组合独立 `BotConversationPane`，机器人通道配置不再在父页维护平行状态机。

第一百零一批从 `RightDock` 删除零引用 `WorkspacePanel` 及其提交树辅助闭环。该模块现在只保留当前
`WorkspaceFilesPanel`、`ReviewPanel` 和共用展示小件；WorkspaceWorkbench 继续负责组合，Git IPC 与
Task Status 仍按各自现有边界工作。

第一百批删除旧 `RightRail` 和仅自引用的 `TaskPlanHistoryPanel`。右侧工作台只由 `RightDock` 与
`WorkspaceWorkbench` 组成；任务 UI 只由 `ComposerTaskPanel`、`TaskPanel`、`TaskStatusPanel` 组成。
进程 wiring 测试改为只检查当前 ChatView/消息内组件，生产源码减少两个文件。

第九十九批清理 Main 与 Runtime 未连接的辅助 API。Main 不再导出连接/Frame 探针，消息图片 URL 统一走
`sync-think-image://`；Capability Broker 只保留执行路径消费的窄工具判断，Chat Tools 只保留实际准入
使用的变更集合与当前失败提示，避免平行但无消费者的策略表形成错误职责边界。

第九十八批移除四组零引用遗留：Runtime daemon 不再执行自启注册/移除，职责统一留在 Desktop
supervisor；Terminal Session Store 删除无消费者的全局单例入口，继续通过显式工厂实例化；Composer
删除旧思考/上下文设置菜单及专属子组件，只保留当前控件树；Workers 临时超时脚本已删除。

第九十七批删除 Core `rework-policy` 兼容重导出与重复测试。审核/返工规则只由 Shared
`review-policy` 对外提供；M2 自检直接覆盖 Shared 测试，架构规则禁止旧 Core 路径恢复，避免同一
领域规则形成两个公开归属。Core 构建目录中的陈旧生成物同步清除。

第九十六批新增 Runtime 纯叶子 `desktop-waiting-projection`，只负责等待状态结果解析和公开窗口目标
裁剪。`runtime.ts` 继续拥有 Desktop 命令执行/持久化、任务归属、事件发布及 list/continue/cancel，
新模块不依赖 Runtime、DemoRun 或 Storage；Browser 子域保持独立。

第九十五批新增 Desktop Shell `conversation-scroll-position`，集中拥有会话滚动位置缓存、localStorage
快照容错和 DOM 锚点捕获/恢复。ChatView 仅保留生命周期调用点，导航控制、历史页合并、消息窗口与
流式跟随继续由各自边界负责；架构门禁防止该模块重新依赖 UI 编排或宿主实现。

第九十四批新增 Shared 纯模块 `orchestration-plan-graph`，返回计划步骤图中的确定性结构化问题。
Storage 将问题适配为原有输入/持久数据异常，继续拥有步骤解码和事务；重复 ID、Merge 依赖约束、
自依赖、重复/缺失依赖及环检测不再由 SQLite 仓储私有实现。

第九十三批新增 Shared 纯模块 `orchestration-plan-diff`，拥有计划步骤快照和版本差异计算。Storage 的
`orchestration-store` 只在计划修订事务与持久 diff 校验中组合该规则，继续拥有输入/持久格式校验、
SQLite 查询和原子提交；差异语义不再由具体仓储私有实现。

第九十二批新增 Desktop Shell 纯叶子 `run-identity-projection`，一次遍历 `run.started` 事件生成运行到
Agent 身份及 Kernel 的映射。ChatView 只用单个 memo 缓存组合投影并兼容重导出旧入口，字段解析不再属于
渲染组件职责。

第九十一批新增 Runtime 纯叶子 `kernel-session-transcript`，统一 Provider 内容文本化、恢复与跨 Kernel gap
格式、持久消息可移植投影及字节边界。模块使用本地最小消息结构，不依赖 Adapter、Runtime 或持久化；
`runtime.ts` 保留原生会话状态机并兼容重导出既有函数。

第九十批新增 Runtime 纯叶子 `goal-turn` 与 `task-plan-context`。前者拥有 Goal 状态控制文本、轮次提示
和默认上限，后者拥有任务清单事件归一化与模型上下文格式；`runtime.ts` 仅组合并兼容重导出，目标状态机、
持久化和自动续跑仍留在 Runtime 主体。

第八十九批把委派消息职责拆成三个 Runtime 叶子：`delegation-message-projection` 负责纯消息块解析，
`delegation-legacy-message-history` 负责旧消息兼容查询，`delegation-message-history` 只负责实时卡片读写。
`delegation-service` 在组合层连接两类历史来源，架构门禁禁止叶子反向依赖门面、执行用例或基础设施。

第八十八批把生产执行结果、fence、reservation 与 MCP intent DTO 迁入 Shared，Storage 保留兼容重导出
和 SQLite 事务实现。Runtime `production-step-executor-ports` 新增五方法预留生命周期端口，生产步骤
执行器不再导入任何 Storage 模块，架构门禁阻止该依赖回流。

第八十七批扩展 Runtime `production-step-executor-ports`，以单方法生命周期端口承载 Agent Context epoch
获取/创建。端口复用 Shared 输入/输出契约，生产执行器不再引用 `SqliteAgentContextStore`，其余线程
查询和关闭能力不进入执行边界。

第八十六批扩展 Runtime `production-step-executor-ports`，把 Skill 准入元数据、提示词正文和权限批准
查询定义为执行期能力。生产执行器不再引用 `SqliteSkillStore`，Skill 安装、更新和删除职责继续留在
Storage/Runtime 管理用例中。

第八十五批扩展 Runtime `production-step-executor-ports`，以模型目录、Provider 连接与凭据路由最小投影
替代 `SqliteProviderStore`。`describe-image` 同步改用中立 `CatalogModelSource`，视觉能力转换不再依赖
Storage 的 `ModelRecord`，并由架构门禁保持基础设施隔离。

第八十四批扩展 Runtime `production-step-executor-ports`，用 AgentVersion 最小投影承载模型绑定、浏览器
权限、Skill 白名单和系统提示词数据。生产执行器及辅助函数不再依赖 `SqliteAgentStore` 的具体类型或
返回类型推导，组合根继续注入现有实现。

第八十三批扩展 Runtime `production-step-executor-ports`，以 Task `workspaceId` 和 Workspace `folderPath`
最小投影承载工具及浏览器执行所需的工作区绑定。生产执行器不再引用 `SqliteWorkspaceStore` 或完整
存储记录；`persistence` 组合根继续注入原实现。

第八十二批新增 Runtime `production-step-executor-ports`，用 `ProductionStepExecutionRuns` 描述生产步骤
执行所需的 Run/Graph 只读能力。执行器不再引用具体编排存储类，`persistence` 组合根继续把 SQLite
实现注入该端口；架构门禁防止端口或执行器重新形成具体存储耦合。

第八十一批新增 Desktop Shell 纯模块 `conversation-message-merge`，统一持久消息、乐观用户气泡和流式
助手消息的展示顺序与 durable ID 收敛。ChatView 仅选择作用域状态；历史页范围及分页合并仍由
`conversation-history-pages` 独立负责，架构门禁禁止合并模块反向依赖 UI 或宿主实现。

第八十批新增 `scripts/architecture-dependency-graph.mjs`，为 apps/packages 的生产源码建立跨文件与工作区包
依赖图，并在 prebuild 阶段拒绝强连通环。Protocol 的 Run Process 请求类型归入 `run-process-page` 解析
所有者，解除 `commands` 与分页模块之间的唯一旧环；`commands` 只保留公共类型兼容重导出。

第七十九批移除 Desktop Shell 下 `ComposerModeBanner`、`ComposerTaskPanel` 与 `NewMaxComposerFrame`
三个 UI Kit 兼容重导出。Desktop ChatView、ShellApp、Composer 菜单与测试直接依赖 `@sync-think/ui-kit`，
架构规则阻止旧本地入口回流；Website 与 Desktop 共享同一公开组件边界。

第七十八批把 `message.attachImages` 纳入 Protocol `conversation-command-contract`，由 Conversation Write
handler 在 Desktop 宿主完成图片落盘后通过 `requestConversation` 发布持久引用。Main 组合根不再为图片
附件维护独立通用 transport 端口；Runtime 继续拥有消息块合并和附件事件持久化。Main 业务命令旁路清零，
直接通用请求仅保留 `runtime.healthcheck` 基础设施探测。

第七十七批把 `kernel.recycle` 纳入既有 Protocol `kernel-command-contract`，并通过 RuntimeClient
`requestKernel` 承载私有内核安装/更新后的回收调用。该调用是 Main 内部生命周期协作，不新增 Renderer
IPC；Runtime 的活跃租约延迟回收策略保持不变。Main 通用传输仅余消息图片附件。

第七十六批新增 Protocol `data-management-command-contract`、Desktop `data-management-payloads` 和 Main
`data-management-handlers`，统一承载数据统计、迁移、备份、压缩与清理。Main 通过窄端口保留保存/打开
对话框、系统路径打开和日期文件名生成；Runtime 继续拥有 SQLite/文件内容、在线备份、冲突处理及清理
事务。托盘打开数据目录复用类型化入口，Main 通用传输仅余 Kernel Recycle 与消息图片附件。

第七十五批新增 Protocol `web-search-provider-command-contract` 和 Main
`web-search-provider-handlers`，独立承载 Web Search Provider 列表、保存、排序与连接测试。Main 复用
Protocol 纯解析器并只负责可信来源、连接、解析和类型化传输；Runtime 继续拥有配置/密钥持久化、
Provider 路由、网络执行和错误脱敏。数据管理保持独立边界。

第七十四批新增 Protocol `provider-cc-switch-command-contract`、Desktop
`provider-cc-switch-payloads` 和 Main `provider-cc-switch-handlers`，独立承载 CC Switch 数据库预览与选定
Provider 导入。Main 只负责可信来源、连接、解析和类型化传输；Runtime 继续拥有 SQLite 读取、映射、
安全存储、失败补偿和事件持久化。Provider 主域迁移完成，后续转向 Web Search 与数据管理边界。

第七十三批新增 Protocol `provider-balance-command-contract`、Desktop `provider-balance-payloads` 和 Main
`provider-balance-handlers`，独立承载只读账户余额查询。Main 只负责可信来源、连接、解析和类型化传输；
Runtime 继续拥有端点判断、凭据读取、网络访问、诊断与响应归一化。CC Switch 保持独立边界。

第七十二批新增 Protocol `provider-discovery-command-contract`、Desktop
`provider-discovery-payloads` 和 Main `provider-discovery-handlers`，独立承载目录发现、创建前临时模型探测、
能力探测与能力确认。Main 通过剪贴板窄端口交接一次性密钥；Runtime 继续拥有探测执行与确认状态。
模型管理、余额与 CC Switch 保持独立边界。

第七十一批新增 Protocol `provider-model-command-contract`、Desktop `provider-model-payloads` 和 Main
`provider-model-handlers`，独立承载模型新增、优先级排序、元数据更新与删除。Main 只负责可信来源、连接、
解析和类型化传输；Runtime 继续拥有模型持久化、归属校验和上下文缓存失效。发现、能力探测、余额与
CC Switch 保持独立边界。

第七十批新增 Protocol `provider-credential-command-contract`、Desktop
`provider-credential-payloads` 和 Main `provider-credential-handlers`，独立承载凭据新增、移除、清空、
查看和更新。Main 通过剪贴板窄端口交接新增/轮换密钥，显式查看保持短生命周期；Runtime 继续拥有
安全存储与补偿。Provider Catalog、模型和发现/探测保持独立边界。

第六十九批新增 Protocol `provider-catalog-command-contract`、Desktop
`provider-catalog-payloads`、`provider-payload-validation` 和 Main `provider-catalog-handlers`，独立承载
Provider 创建、更新、列表、排序与删除。Main 通过剪贴板窄端口交接密钥；Runtime 继续拥有目录持久化、
安全存储与补偿。Credentials、模型和发现/探测后续保持独立边界。

第六十八批新增 Protocol `participation-mode-command-contract`、Desktop
`participation-mode-payloads` 和 Main `participation-mode-handlers`，独立承载
`task.setParticipationMode`。Task 目录仍只管理创建、查询和归档；Runtime 继续拥有自动模式门禁、
OCC、事务与事件。Provider 生命周期后续按有限子域拆分。

第六十七批新增 Protocol `artifact-command-contract`、Desktop `artifact-payloads` 和 Main
`artifact-handlers`，统一承载 Artifact 列表、版本预览、比较、选择、合并及冲突处理 7 项 IPC。
Main 只注入宿主端口；图片版本先走类型化 Runtime 查询，再由宿主预览注册端口生成签名 URL。
Artifact 持久化、版本血缘、合并与冲突状态继续归 Runtime。执行参与模式保持独立。

第六十六批新增 Protocol `run-control-command-contract`、Desktop `run-control-payloads` 和 Main
`run-control-handlers`，统一承载 Run Graph、pause/resume 及普通会话/编排 cancel 共 5 个 IPC。
`run.cancel` 的载荷形状分流被显式建模；Runtime 继续拥有执行器、状态机、scope/OCC、原子事件与幂等回放。

第六十五批新增 Protocol `plan-command-contract`、Desktop `plan-payloads`、
`orchestration-payload-validation` 和 Main `plan-handlers`，统一承载 Plan 草稿、修订、revision 列表和
批准 4 项 IPC。Main 只注入宿主端口；Runtime 继续拥有不可变 revision、批准前置条件、Run/Graph
创建和原子持久化。Run 控制与执行参与模式保持独立。

第六十四批新增 Protocol `task-command-contract`、Desktop `task-payloads` 和 Main `task-handlers`，
统一承载 Task 创建、列表、打开、搜索、归档和取消归档 6 项 IPC。Main 只注入宿主端口；Runtime
继续拥有任务目录持久化、搜索、树级归档和版本围栏。执行参与模式保持独立。

第六十三批新增 Protocol `workspace-command-contract`、Desktop `workspace-lifecycle-payloads` 和 Main
`workspace-handlers`，统一承载 Workspace 创建、文件夹绑定、列表、更新和删除 5 项 IPC。Main 只注入
宿主端口，更新安装探针复用同一类型化入口；Runtime 继续拥有目录持久化和路径安全。Task 保持独立。

第六十二批新增 Protocol `prompt-design-command-contract`、Desktop `prompt-design-payloads` 和 Main
`prompt-design-handlers`，统一承载提示词优化、取消和设计生成 3 项 IPC。Main 只注入宿主端口并复用
共享通道表；Runtime 继续拥有模型选择、流输出筛选和生成执行。Workspace 生命周期保持独立。

第六十一批新增 Protocol `capability-governance-command-contract` 和 Desktop Main
`capability-governance-handlers`，统一承载工作区能力激活、治理列表、发布草稿和整理报告 9 项 IPC。
Main 复用既有纯 `capability-payloads` 与共享通道表；Runtime 继续拥有激活状态、治理规则、草稿持久化
和报告生成。Prompt Enhancement / Design Generation 保持独立。

第六十批新增 Protocol `bot-channel-command-contract`、Desktop `bot-channel-payloads` 和 Main
`bot-channel-handlers`，统一承载 Bot 配置、连接测试和微信登录 5 项 IPC。Main 只注入宿主端口；
Runtime 继续拥有配置存储、凭据保护、网关连接和消息处理。Capability Governance 保持独立。

第五十九批新增 Protocol `mcp-tool-command-contract`、Desktop `mcp-tool-payloads` 和 Main
`mcp-tool-handlers`，统一承载 MCP 策略预检、软请求、进程探测、实际调用和目录刷新 5 项 IPC。
Main 只注入宿主端口；Runtime 继续拥有授权、审批、进程/HTTP 执行和目录持久化。Bot Channel 保持独立。

第五十八批新增 Protocol `mcp-registry-command-contract`、Desktop `mcp-registry-payloads` 和 Main
`mcp-registry-handlers`，统一承载 MCP 本地/远程注册、列表、启停和删除 5 项 IPC。Main 只注入
宿主端口，解析器从 Agent/MCP 混合载荷模块移出；Runtime 继续拥有注册表持久化、凭据存储和工具发现。
策略探测、工具请求/调用和刷新保持独立。

第五十七批新增 Protocol `skill-command-contract`、Desktop `skill-payloads` 和 Main
`skill-handlers`，统一承载已安装 Skill 的导入、远程导入、列表、详情、删除和启用状态 6 项 IPC。
Main 只注入宿主端口，解析器从 Agent/MCP 混合载荷模块移出；Runtime 继续拥有不可变版本、
内容寻址、权限重审批、引用约束和工作区激活。MCP 保持独立。

第五十六批新增 Protocol `skill-market-command-contract`、Desktop `skill-market-payloads` 和 Main
`skill-market-handlers`，统一承载市场列表和安装 2 项 IPC。Main 只注入宿主端口，安装解析器从 Team
混合载荷模块移出；Runtime 继续拥有市场目录、完整包物化、冲突处理、导入和事件发布。
已安装 Skill 生命周期保持独立。

第五十五批新增 Protocol `skill-local-command-contract`、Desktop `skill-local-payloads` 和 Main
`skill-local-handlers`，统一承载本地 Skill 扫描、检查和导入 3 项 IPC。Main 只注入宿主端口，
纯解析器从 Team 混合载荷模块移出；Runtime 继续拥有目录发现、ZIP 解包、安装、缓存/watch 和事件。
Skill Market 与已安装 Skill 管理保持独立。

第五十四批新增 Protocol `goal-command-contract`、Desktop `goal-payloads` 和 Main `goal-handlers`，
统一承载目标设置、读取、清除、暂停和恢复 5 项 IPC。Main 只注入宿主端口，纯解析器隔离宿主依赖，
Runtime 继续拥有轮次、预算、连续阻塞判定和自动续跑；Skill Local 保持独立。

第五十三批新增 Protocol `activity-command-contract` 和 Desktop Main `activity-handlers`，统一承载
运行列表、外部事件列表和重试锚点解析 3 项 IPC。Main 只注入宿主端口，Runtime 继续拥有活动
投影、分页、敏感 lease 隔离和重试资格判定；Goal 生命周期保持独立。

第五十二批新增 Protocol `scheduled-task-command-contract` 和 Desktop Main
`scheduled-task-handlers`，统一承载任务创建、列表、更新、删除、立即触发和历史查询 6 项 IPC。
Main 只注入宿主端口，Runtime 继续拥有规则计算、持久化、执行与历史记录；Activity Center 保持独立。

第五十一批新增 Desktop Main `conversation-ask-handlers`，并扩展 Protocol Conversation 合同，统一
承载问询回答、取消和待处理查询 3 项 IPC。Main 只注入宿主端口，Runtime 继续拥有待处理问询
注册表、回答结算和持久事件；Scheduled Task 保持独立。

第五十批新增 Desktop Main `conversation-plan-handlers`，并扩展 Protocol Conversation 合同，统一
承载计划提交、读取、批准、修订和取消 5 项 IPC。Main 只注入宿主端口，Runtime 继续拥有不可变
revision、批准前置条件、Run/Graph 创建和原子持久化；Ask 保持独立。

第四十九批新增 Desktop Main `conversation-routing-handlers`，并扩展 Protocol Conversation 合同，
统一承载执行/交互模式、上下文窗口覆盖、轨道升级和目标重绑 5 项 IPC。Main 只注入宿主端口，
Runtime 继续拥有目标兼容性、轨道切换和状态持久化；Plan 与 Ask 保持独立。

第四十八批新增 Desktop Main `conversation-management-handlers`，并扩展 Protocol Conversation 合同，
统一承载对话列表、创建、重命名、置顶、归档和删除 6 项目录生命周期 IPC。托盘最近会话查询也
改用同一类型化入口；运行模式、目标绑定、计划和问答保持独立，Runtime 继续拥有持久化与事件语义。

第四十七批新增 Protocol `team-command-contract` 和 Desktop Main `team-handlers`，统一承载团队目录
增删改查与 Team Run 启动/状态写入 6 项 IPC。Main 只注入宿主端口，Runtime 继续拥有成员依赖、
协调者约束、运行创建和状态机；Conversation 管理保持独立，留待后续批次。

第四十六批新增 Protocol `global-agent-command-contract` 和 Desktop Main `global-agent-handlers`，
统一承载全局智能体的列表、创建、更新、删除与工作区激活 6 项 IPC。Main 只注入宿主端口，
Runtime 继续拥有引用约束、软删除决策、激活持久化和事件发布；删除响应现通过 Protocol 一直
复用到 Renderer。Team 保持独立，留待后续批次。

第四十五批扩展 Protocol `agent-command-contract` 和 Desktop Main `agent-handlers`，补齐 Agent 创建、
版本列表与新版本创建。该边界现统一覆盖 6 项 Agent IPC，并继续通过注入端口隔离 Electron 和
RuntimeClient；定义验证、不可变版本存储、乐观并发与事件语义仍归 Runtime。Global Agent 与 Team
保持独立，留待后续批次。

第四十四批新增 Protocol `agent-command-contract` 和 Desktop Main `agent-handlers`。前者关联 Agent 获取、
绑定更新与目录列表的请求/响应，后者通过注入端口注册 IPC、校验来源、连接、严格解析并调用
`RuntimePipeClient.requestAgent`。默认 Agent、绑定验证和版本存储仍归 Runtime；创建/版本命令暂未迁入。

第四十三批新增 Protocol `usage-command-contract` 和 Desktop Main `usage-handlers`。前者关联使用统计过滤请求/
聚合响应，后者通过注入端口注册 IPC、校验来源、连接、严格解析并调用
`RuntimePipeClient.requestUsage`。RuntimeClient 保留长超时策略，统计缓存和聚合仍归 Runtime。

第四十二批新增 Protocol `policy-command-contract` 和 Desktop Main `policy-handlers`。前者关联作用域策略保存/
列表的请求与响应，后者通过注入端口注册 IPC、校验来源、连接、严格解析并调用
`RuntimePipeClient.requestPolicy`。作用域验证、版本持久化、事件事务和策略解析仍归 Runtime。

第四十一批新增 Protocol `settings-command-contract` 和 Desktop Main `settings-handlers`。前者关联应用配置读取/
写入的请求与响应，后者通过注入端口注册 IPC、校验来源、连接、严格解析并调用
`RuntimePipeClient.requestSettings`。配置存储、更新时间和设置触发的后台重绑定仍归 Runtime。

第四十批新增 Protocol `kernel-command-contract` 和 Desktop Main `kernel-handlers`。前者关联只读
`kernel.detect` 请求/响应，后者通过注入端口注册 IPC、校验来源、连接并调用
`RuntimePipeClient.requestKernel`。Runtime 保留探测语义，桌面安装/更新和运行生命周期回收保持独立。

第三十九批新增 Protocol `gateway-command-contract` 和 Desktop Main `gateway-handlers`。前者关联 Gateway
状态、日志查询和清空日志 3 项请求/响应，后者通过注入端口注册 IPC、校验来源、连接并调用
`RuntimePipeClient.requestGateway`。日志查询兼容归一化、OpenGatewayManager、状态聚合和日志缓冲仍归 Runtime。

第三十八批新增 Protocol `diagnostics-command-contract` 和 Desktop Main
`diagnostics-handlers`。前者关联诊断列表请求/响应，后者通过注入端口注册页面 IPC、校验来源、连接并解析参数；
`RuntimePipeClient.requestDiagnostics` 同时供页面查询和桌面诊断导出使用。导出文件组装与桌面基础设施仍归
Main，Runtime 继续拥有诊断生成。

第三十七批新增 Protocol `context-packet-command-contract` 和 Desktop Main
`context-packet-handlers`。前者关联 2 项 Context Packet 请求/响应，后者通过注入端口注册 IPC、校验来源、
连接并解析参数；`RuntimePipeClient.requestContextPacket` 提供类型化传输。上下文包生成、线程覆盖和
受保护来源策略仍归 Runtime。

第三十六批新增 Protocol `memory-command-contract` 和 Desktop Main
`memory-handlers`。前者关联 3 项 Memory 请求/响应，后者通过注入端口注册 IPC、校验来源、连接并解析参数；
`RuntimePipeClient.requestMemory` 提供类型化传输。Memory 策略、持久化和回滚语义仍归 Runtime，Context
Packet 保持独立边界。

第三十五批新增 Protocol `approval-command-contract` 和 Desktop Main
`approval-handlers`。前者关联 4 项 Approval Center 请求/响应，后者通过注入端口注册 IPC、校验来源、
连接并解析参数；`RuntimePipeClient.requestApproval` 提供类型化传输。审批策略、持久化事务和状态机仍归
Runtime，避免把业务规则带入 Main。

第三十四批新增 Protocol `browser-extension-command-contract` 和 Desktop Main
`browser-extension-handlers`。前者关联 4 项无参数扩展命令及响应，并拥有跨进程扩展状态类型；后者通过
注入端口注册 IPC、校验来源、连接并请求 Runtime。Desktop `browser-extension-contract` 继续拥有默认值
与旧宿主归一化，但复用 Protocol 线类型；扩展宿主、配对文件和 WebSocket 生命周期仍归 Runtime。

第三十三批新增 Protocol `desktop-command-contract` 和 Desktop Main
`desktop-command-handlers`。前者关联 3 项等待命令请求/响应，后者通过注入端口注册 IPC、校验来源、
连接并严格解析参数；`RuntimePipeClient.requestDesktopCommand` 提供类型化传输。`expectedUpdatedAt`
继续保护 continue/cancel 的并发更新，Browser Extension 等剩余命令后续按独立业务域迁移。

第三十二批新增 Protocol browser-handoff-command-contract 和 Desktop Main
browser-handoff-handlers。前者关联 3 项 Handoff 请求/响应，后者通过注入端口注册 IPC、校验来源、
连接并解析参数；RuntimePipeClient.requestBrowserHandoff 提供类型化传输。Handoff 的 revision、
lease disposition 和 Runtime 状态机保持在原业务边界内，Desktop Waiting Commands 继续后续迁移。

第三十一批新增 Protocol `browser-workflow-command-contract` 和 Desktop Main
`browser-workflow-handlers`。前者关联 8 项 Workflow 请求/响应，后者通过注入端口注册 IPC、校验来源、
连接并解析参数；`RuntimePipeClient.requestBrowserWorkflow` 提供类型化传输。Profile、Recording 和
Workflow 各自拥有合同与注册边界，Browser Handoff 等剩余命令继续按业务域迁移。

第三十批新增 Protocol `browser-recording-command-contract` 和 Desktop Main
`browser-recording-handlers`。前者关联 4 项 Recording 请求/响应，后者通过注入端口注册 IPC、校验来源、
连接并解析参数；`RuntimePipeClient.requestBrowserRecording` 提供类型化传输。Workflow 仍在 Main 入口，
下一批作为独立业务域迁移。

第二十九批新增 Protocol `browser-profile-command-contract` 和 Desktop Main
`browser-profile-handlers`。前者关联 6 项 Profile 请求/响应，后者通过注入端口注册 IPC、校验来源、
连接并解析参数；`RuntimePipeClient.requestBrowserProfile` 提供类型化传输。Recording/Workflow 仍在 Main
入口，后续按各自业务域迁移。

第二十八批将 `ComposerModeBanner` 和 `ComposerTaskPanel` 迁入 `packages/ui-kit`，
使用只包含实际展示字段的 Goal/Task view model。Desktop 同名模块只做兼容重导出；Website 直接消费
共享实现，`website-demo-surface` 不再转发这两个组件。共享包不依赖 Desktop 投影或宿主 API。

第二十七批将 `NewMaxComposerFrame`、Popover 挂载保留和模式 Banner 动效状态迁入
`packages/ui-kit/src/components/NewMaxComposerFrame.tsx`。Desktop 同名文件是仅指向 `@sync-think/ui-kit`
的兼容入口；Website 两个演示页面直接依赖共享包，`website-demo-surface` 不再转发该组件。
样式和应用编排仍分别归 Shell 与 Website，后续共享组件按相同边界逐簇迁移。

第二十六批新增 Runtime `renderer-browser-command-bridge`，拥有内置浏览器请求等待、回执结算和停机取消；
Runtime 继续负责瞬时事件与 Socket 响应。Desktop Main 新增 `conversation-browser-handlers`，仅注册浏览器回执 IPC，
并通过第 15 项类型化会话命令转发；浏览器 Worker、Controller 和其他 Browser RPC 保持原边界。

第二十五批新增 `initial-run-model-binding`，拥有首发 Run 的模型/Provider/凭据引用与上下文窗口元数据解析。
模块只依赖 Core/Shared 契约及窄目录端口；Runtime 的 `prepareRunBinding` 继续负责 Agent/Team、Skill、上下文包和 Run 创建，
Provider secret 继续到实际调用时才从 SecureStore 读取。凭据选择 helper 同时用于 fallback 重绑定，回退决策仍归原模块。

第二十四批新增 `conversation-approval-handlers`，集中注册工具审批决定和 pending 查询两项 IPC。
模块拥有参数解析和调用顺序，通过来源校验、连接与类型化传输端口装配；Main 入口不再直接处理这两项审批请求。
Protocol 的会话命令关联增至 14 项，审批状态、授权策略和持久化继续由 Runtime 拥有。

第二十三批新增 `use-conversation-transient-subscription`，拥有 Renderer transient 订阅资源、
scope generation、ready 失败和清理。ChatView 注入游标及事件回调，继续负责帧队列、展示投影、
durable fallback、process cache 和终态刷新；模型/内核变化不会重建物理订阅。

第二十二批新增 `active-tool-approval`，统一拥有 Runtime 活跃审批的精简等待记录、按 Run 查询、
pending 摘要投影和一次性结算。Runtime 通过 commit/record/publish 端口装配授权策略、事件事务与广播；
`inactive-tool-approval` 和 `tool-approval-read-model` 继续分别处理孤立恢复与持久历史解析。

第二十一批新增 `use-conversation-navigation-controller`，拥有 minimap 目标加载、导航意图、loading
隔离和可重新瞄准的滑动动画。`conversation-navigation-loader` / `use-conversation-navigation` 继续负责
轻量目录数据，ChatView 继续负责消息分页合并、缓存、render window 与置底策略，三者通过窄回调连接。

第二十批新增 `conversation-transient-handlers`，拥有 transient 订阅/取消注册、frame/reset 路由和
sender 销毁清理登记。Main 入口注入 sender 身份、可信 Renderer 发送与 RuntimeSession 端口；
RuntimeSession 继续拥有实际订阅表、替换、重连和取消实现。

第十九批新增 `conversation-write-handlers`，集中注册 append、sendMessage 和 compact 三项会话写操作。
模块拥有参数解析和调用顺序，通过宿主端口使用图片暂存/存储、附件补写和类型化传输；
Main 入口只提供 Electron 来源校验、连接与具体基础设施装配。读写注册模块都受同一架构规则约束。

第十八批为委派历史增加精确报告读取链：delegation-history-query 通过 `getStored/getLegacy`
端口读取单条记录；delegation-service 装配持久仓库与消息历史；delegation-message-history 解析旧卡片；
message-store 的 `findDelegatedMessage` 只定位目标线程中包含目标 childRunId 的最新消息。
任务列表仍走完整兼容合并，单报告不再先加载整个会话记录。

第十七批收紧 Storage 事务边界：runtime-state-store 通过 `DelegatedRunEventProjection`
协调委派读模型更新，调用 `projectEventsInTransaction` 参与事件/checkpoint 的同一外层事务；
delegated-run-store 的 `projectEvents` 仅用于独立历史修复并自行提供批量原子性。生产持久化装配复用
同一个 `SqliteDelegatedRunStore`，不再在每次事件提交时临时构造投影 Store。

第十六批将 WebsiteChatDemo、WebsiteCapabilityDemo、演示状态、官网包装组件、样式和构建脚本
迁入 apps/website。Desktop 的 website-demo-surface 是未迁移组件的唯一官网适配入口；Website 构建期通过别名
解析该接口，不相对导入 Shell 内部。Composer Frame、Mode Banner 和 Task Panel 已直接由 `ui-kit` 共享，
其余真实组件仍从 Desktop 源码打包，后续继续按组件簇迁移。

第十四、十五批新增 Runtime 的 model-fallback-selection（供应商/Agent 候选回退选择）、
conversation-model-routing（上下文/压缩默认模型解析）和 inactive-tool-approval（重复/过期审批恢复）。
前三者通过窄端口读取目录或审批事实；tool-approval-read-model 同时拥有历史审批摘要解析。
Runtime 保留能力适配、回退事件事务、活跃审批和协议回执；首发模型/凭据元数据装配现由 initial-run-model-binding 负责。

第十二、十三批新增 Renderer 的 use-compose-draft-recovery（失败草稿恢复、附件合并与发送后清理）
和 submit-conversation-message（prepare → append、持久图片回执和提示描述）。ChatView 保留乐观消息、
标题/焦点和错误展示。Main 的 conversation-query-handlers、conversation-write-handlers、
conversation-approval-handlers、conversation-browser-handlers 与 conversation-transient-handlers 分别拥有
9 项只读查询、3 项写操作、2 项工具审批、1 项浏览器回执和 transient 订阅生命周期，
不直接依赖 Electron、RuntimePipeClient 或入口模块；来源校验、连接、图片文件能力与传输实现仍在 Main 装配。
Protocol 的 conversation-command-contract 现有 15 项命令/参数/返回值关联，Main 查询、写操作、审批与浏览器回执使用同一类型入口；Browser Profile、Recording、Workflow 与 Handoff 分别拥有 6 项、4 项、8 项和 3 项域合同及独立类型入口。

第十一批新增 Renderer 的 use-conversation-compaction：自动/手动压缩请求、宿主进度投影、
会话锁和提示计时器统一归属。通过窄回调接入协议请求与 UI 通知，不导入 ChatView、Main 或 Runtime 客户端。
ChatView 保留宿主事件筛选、消息提交与草稿恢复；实际摘要和持久化仍归 Runtime。

第十批收紧现有正文边界：MessageTextContent 拥有按来源身份标记的读取状态，
message-text-source 继续负责完整分段拼接；ChatView 在派生历史窗口前筛选所属会话/任务的消息页。
展示读取与复制/重新生成保持独立取消，不新增全局正文缓存或跨组件状态所有者。

第九批新增 Renderer 的 use-compose-request-queue（队列状态、会话级发送锁、自动续发和重试）
与 compose-send-request（发送选项契约及纯请求组装）。Hook 通过 sendUserText 回调接入 ChatView；
已有 compose-request-queue 保留草稿结构与存储格式，ChatView 保留压缩、附件落盘和乐观 UI 编排。

第八批新增 Runtime 的 delegation-projection：父委派工具行匹配、卡片字段、子任务用量、
重连快照的纯计算。输入只包含所需事实及 Protocol/Shared 契约，不导入 DemoRunState；
Runtime 保留读取/状态更新/写入/广播编排。协作策略统一维护委派工具名集合。

第七批新增 Runtime 的 delegation-message-history（父消息卡片兼容存储、缓存、旧记录解析）
和 delegation-history-query（记录合并、状态校正入口、列表/报告分页）。
delegation-service 保留状态写入和兼容门面；context-message-history 直接引用旧消息解析模块，
不再为解析历史依赖整个服务。查询只通过记录端口读取事实。

第六批新增 Runtime 的 delegation-admission（参数解析、预算准入、有效 Agent 选择）。
通过两个只读端口获取协作设置和工作区目录，复用 collaboration-policy / delegation-timeout-policy；
Runtime 仅在此用例边界装配目录适配器，保留写权限、启动事务、终态持久化和执行编排。

第五批新增 Runtime 的 delegation-execution（后台/同步执行、取消、超时、关闭清理）
和 delegation-timeout-policy（默认时限与上下限）。控制器通过窄端口接入 Runtime，
不导入 Runtime、DemoRunState 或存储实现；启动准入和终态持久化仍在宿主中。

第四批新增 Runtime 的 delegation-event（事件事实捕获与旧终态恢复）和 Shared 的
delegation-state（中立快照契约与校验）。Storage 的 runtime-state-store 在原事务内
调用 delegated-run-store.projectEvents；DelegationService 消费已提交状态并持久化旧记录修复。

第三批新增 Shared 纯策略：review-outcome（结论与证据）、rework-artifacts（返工产物血缘）、
review-transition（上限处理与审查通过后的状态决策）。
Storage 的 orchestration-store 加载事实并在原事务中执行决策，纯策略不访问数据库。

第二批新增 Shared 契约：types/orchestration-contracts、types/approval-contracts、
types/agent-context-contracts，以及 orchestration-errors、diagnostic-text。
调度器、调度端口与 StepExecutor 从 Shared 获取中立契约；Storage 保留兼容导出。
scripts/architecture-rules.mjs 承载可测试的依赖规则，check-architecture.mjs 负责源文件枚举。

新增边界：Runtime 的 delegation-service / delegation-context / delegation-tool-events、
orchestration/scheduler-ports；Shared 的 delegated-run / orchestration-completion；
Protocol 的 conversation-command-contract；Storage 的 delegated-run-store；
Renderer 的 conversation-types / conversation-page-cache / composer-editor-types / message-text-types；
Workers 的 windows-uia-contract。职责及后续迁移范围见
[重构落地记录](cohesion-refactor-2026-09-19.md)。

本文档提供当前仓库的模块地图与文件放置规则。产品边界以已批准设计文档为准，技术取舍以 `04-tech-decisions.md` 为准。

## 1. 仓库地图

```text
SYNC-THINK/
|- apps/
|  |- desktop/          Electron Main / Preload / React Renderer
|  `- runtime/          独立 Node.js Agent Runtime 与命名管道服务
|- packages/
|  |- adapters/         Provider 协议适配器
|  |- core/             上下文、模型解析与领域规则
|  |- protocol/         Desktop/CLI 与 Runtime 的共享命令和事件合同
|  |- secure-store/     OS-backed 凭证存储
|  |- shared/           跨包类型与纯工具
|  |- storage/          SQLite schema、迁移和各领域 store
|  |- test-fixtures/    合同与集成测试夹具
|  |- ui-kit/           遗留 React 组件（仅剩 type-only 引用，样式已删）
|  `- workers/          File/Terminal/Git/Browser/Desktop/MCP 隔离执行边界
|- scripts/             本地启动、自检、构建辅助和诊断脚本
`- docs/                产品、工程、开发、运维与交接真源
```

`apps/cli` 与 `apps/mcp-server` 当前只有历史构建输出/本地依赖，不在根 pnpm workspace 的 11 个活动包中；新源码不要放入这些目录，除非先恢复其正式 package 边界。

## 2. Desktop 边界

| 层                | 关键入口                                                                                                                                                       | 职责                                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Main              | `apps/desktop/src/main/index.ts`                                                                                                                               | BrowserWindow、Runtime supervisor、IPC 校验、sender 生命周期和本机文件/进程能力编排                                                 |
| Main services     | `conversation-*-handlers.ts`、`project-content-search.ts`、`project-file-editor.ts`、`project-terminal.ts`、`project-terminal-registry.ts`、`image-staging.ts` | 会话读写/订阅注册与解析、搜索、文件读写/监听、命令解析/cwd 校验、终端会话唯一性；具体 Electron、传输和图片文件能力由 Main 入口注入  |
| Updater/recovery  | `desktop-updater.ts`、`desktop-update-preferences.ts`、`electron-updater-driver.ts`、`desktop-update-recovery-store.ts`、`desktop-update-rollback-*.ts`        | Main-only feed 控制、自动检查偏好、bounded failure evidence、healthy installer 登记、rollback intent/health/outcome 与独立 watchdog |
| Preload           | `apps/desktop/src/preload/index.ts`                                                                                                                            | 在 sandbox/contextIsolation 下暴露最小 typed bridge，转发 terminal 事件并返回 disposer                                              |
| IPC contract      | `apps/desktop/src/workspace-tools-contract.ts`、`browser-workflow-payloads.ts`、`external-link-contract.ts`、`renderer/global.d.ts`                            | Renderer 可见 payload/result/event 类型；外链只接受受控 `http/https`；Browser Workflow 变更需额外严格校验，不得暴露 Node 或 secret  |
| Renderer shell    | `apps/desktop/src/renderer/shell/ShellApp.tsx`                                                                                                                 | 顶层目录、Workspace/会话状态、Pane/Workbench 快照提交和各页面装配                                                                   |
| Pane model        | `pane-layout.ts`、`WorkspacePaneHost.tsx`、`ConversationTabs.tsx`                                                                                              | 递归布局、焦点、Tab 资源、恢复/迁移和最多两路 ChatView 挂载                                                                         |
| Workbench model   | `workspace-workbench.ts`、`WorkspaceWorkbench.tsx`                                                                                                             | 每 Workspace 的右侧/底部标签、开关、尺寸与文件树宽度；只保存 UI 布局，不保存文件正文或终端输出                                      |
| Resource views    | `ChatView.tsx`、`MarkdownContent.tsx`、`FilePane.tsx`、`TerminalPane.tsx`                                                                                      | 对话、可点击文件/图片/网页资源、文件编辑、终端四类内容；临时状态留在 Renderer，文件定位沿现有 Workbench 回调传递                    |
| Compose Skill     | `TurnSkillControl.tsx`、`compose-skill-selection.ts`、`compose-toolbar.tsx`、`compose-slash.ts`                                                                | 解析 Agent/Team 有效 owner、懒取 metadata、维护当前会话临时选择、NewMax 紧凑命令面板和语音输入状态                                  |
| Settings/models   | `SettingsPage.tsx`、`ModelSettings.tsx`、`PreferencesSettings.tsx`、`preferences-store.ts`、`shell.css`                                                        | 设置分类、Provider/凭据/模型优先级、主题/快捷键/个性化、服务商目录、使用统计及 NewMax 设置窗口视觉契约                              |
| Terminal renderer | `terminal-session-store.ts`、`xterm-vendor-loader.ts`、`xterm-vendor.ts`                                                                                       | 会话事件归并、命令竞态处理和 xterm 按需加载/主题同步                                                                                |
| File/review views | `WorkspaceFileView.tsx`、`RightDock.tsx`                                                                                                                       | 文件树、文件预览/编辑、搜索、对话变更树与行级审阅；可作为 Workbench 独立资源                                                        |

Main 或 Preload 发生变化后必须完整重启 Electron；只刷新 Renderer 不会注册新的 IPC handler，也不会替换旧 preload。

## 3. Runtime 与共享包

- `apps/runtime` 是独立生命周期的真 Agent Runtime：命名管道、持久事件/检查点、Provider 调用、计划/DAG、审批、恢复和工具循环都在这里。
- `apps/runtime/src/chat-image-staging.ts` 只接受全局暂存目录或当前 `<workspace>/.sync-think/conversations/<conversationId>/images/` 内的普通文件，并在解析后再次校验 realpath，避免跨会话路径或符号链接逃逸。
- 外部 Codex 通过 app-server `localImage` 接收可信绝对路径；Claude SDK 使用原生 image block。`describe_image`/OCR 只作为不支持视觉模型的 fallback，不参与正常多模态路径。
- `packages/storage` 是 SQLite 真源访问层；durable 消息、事件、Agent/Skill/Policy/Artifact 等进入对应 store，不从 Renderer localStorage 反推。
- `packages/protocol` 只放跨进程稳定合同与校验；仅 Renderer 使用的 Electron IPC 类型放在 Desktop contract，避免把 Electron 能力扩散到 Runtime 协议。
- `packages/protocol/src/skill-selection.ts` 规范化每轮 SkillVersion ID；`packages/core/src/run-skill-selection.ts` 负责 allowlist 子集、归档和审批规则，保持无 I/O、可单测。
- `packages/storage` 的 Skill list 查询只投影 metadata；完整正文只由 Runtime 通过精确 SkillVersion ID 读取，不进入 Renderer 目录响应。
- `packages/workers` 负责最小权限执行。`terminal/terminal-worker.ts` 定义命令能力与输出上限，`process-runner.ts` 负责 spawn、流式读取、超时/取消和进程树清理。
- `packages/workers/src/browser/browser-host.ts` 负责系统浏览器发现/启动、CDP、Profile Session、Page lease、同 Page 队列、Profile 站点数据查询/清除与具体 Playwright 动作；浏览器候选顺序为显式 executable、Chrome、Edge；registrable domain 由 `tldts` Public Suffix List 解析，Storage 操作固定走 Page target CDP，不读取 `storageState()`；`browser-worker.ts` 只把 capability token、路径与事件合同接到共享 Host。
- `apps/runtime/src/browser/runtime-browser-controller.ts` 把聊天 `browser_*` 参数映射为 Worker action，使用 `SqliteBrowserStore` 持久化 origin grant、command 与人工 handoff，并保证 Runtime 的脱敏意图先于 Worker 副作用；Page lease 与浏览器进程仍由 `BrowserHost` 管理。
- `packages/core` 保持无 I/O 的领域规则；`packages/adapters` 隔离 Provider 差异；`packages/ui-kit` 自 2026-08-18 起只剩旧渲染层遗留组件，Desktop 侧仅有 type-only 引用，不再提供样式或主题控制器。
- 颜色/字体/圆角 token 的唯一真源是 `docs/product/16-shell-design-tokens.json`；`pnpm tokens:css`（`scripts/generate-shell-tokens.mjs`）生成 `apps/desktop/src/renderer/shell/tokens.css`，由 `shell.css` `@import`。生成物禁止手改；`scripts/check-design-tokens.mjs` 拦裸 hex。NewMax 同款可变字体位于 `apps/desktop/src/renderer/shell/assets/fonts`，`build-shell.mjs` 只把运行时 woff2 分片复制到 Renderer 产物。
- 模型设置的数据行为集中在 `ModelSettings.tsx`，`SettingsPage.tsx` 只负责设置分类和完成/脏状态协调。NewMax 对齐的尺寸、颜色与动效只落在 `shell.css` 和设计 token 中；不要把服务商密钥、模型优先级或使用记录复制成 Renderer 假数据。

## 4. Workspace 工具调用链

### 内容搜索

```text
RightDock
  -> preload searchProjectContent
  -> Main IPC payload/sender 校验
  -> project-content-search (`rg --json` 或 Node fallback)
  -> 相对路径 + 行/列 + preview
  -> ShellApp 在右侧 Workbench 打开文件标签，并传 transient location
```

### 文件编辑

```text
FilePane
  -> preload read/write/watchProjectFile
  -> Main project-file-editor
  -> realpath 边界 + mtime/size 乐观并发 + 同目录临时文件 rename
  -> watch 事件返回 Renderer
  -> 干净文件刷新；脏文件显示显式冲突选择
```

### 终端 Pane

```text
TerminalPane / terminal-session-store
  -> preload start/cancelProjectTerminal
  -> Main ProjectTerminalRegistry 预留 senderId + terminalId
  -> parse command / 校验项目内 cwd
  -> TerminalProcessWorker -> process-runner -> child process
  -> stdout/stderr/completed/cancelled/failed IPC event
  -> session store 按 command identity 更新 xterm 与状态
```

### 每轮 Skill 选择

```text
TurnSkillControl 打开菜单
  -> 根据 Agent 或 Team coordinator 解析有效装备 ID
  -> preload/runtime skill.list({ skillVersionIds }) 精确查询，只返回 metadata
  -> task.appendMessage(skillVersionIds: 精确 ID[])
  -> Runtime 规范化并校验 allowlist/存在/归档/审批
  -> 按精确 ID 加载正文并进入 Context selection
  -> 同一 included 集合生成 Provider prompt、Manifest 与 frozen Run snapshot
  -> fallback/rebind/retry/restart 按冻结 ID 恢复

自动 Team Run
  -> 每个 Step 已冻结自身 agentVersionId
  -> Runtime 读取该 AgentVersion.skillVersionIds
  -> Provider 调用前校验存在/归档/审批并解析正文
  -> 只注入该成员自己的 Skill，Artifact metadata 记录实际 ID
```

### 浏览器 Worker（P0）

```text
Provider browser_* tool call
  -> RuntimeBrowserController 参数校验 + durable owner/origin grant
  -> Runtime 先持久化脱敏 browser.command.started
  -> PersistentBrowserWorker capability/fence/path 校验
  -> shared BrowserHost
  -> one Profile process / one owner Page lease / per-Page serial queue
  -> playwright-core connectOverCDP
  -> visible system Edge/Chrome
  -> 完整结果回当前 Provider；脱敏摘要进入 durable tool.completed
  -> browser_open 的脱敏 URL 供 Renderer 结果与审计展示
```

Renderer 的 `browser.command_requested -> submitBrowserResult` 仅为旧 Runtime 迁移兼容；新 Runtime 不发布该请求。Profile 的 Cookie 与站点存储正文位于 Runtime 数据目录 `browser-profiles/<profileId>`，不进入 Renderer、SQLite 或默认系统浏览器 Profile；SQLite 只保存 Profile 元数据和脱敏站点会话摘要。

Browser Automation Studio 的 Profile 管理链路：

```text
BrowserStage
  -> preload/Main 严格 IPC payload
  -> Runtime browser.profile.*
  -> RuntimeBrowserProfileService
  -> SqliteBrowserStore（Profile 元数据 + 脱敏站点摘要 + 已知 origin + 非终态 command/handoff fence）
  -> BrowserHost / Playwright BrowserContext / loopback CDP
  -> runtimeDataRoot/browser-profiles/<profileId>（Cookie 与站点存储真源）
```

`apps/runtime/src/browser/runtime-browser-profile-service.ts` 只管理 Profile 元数据、会话投影和删除栅栏；页面自动化命令继续由 `runtime-browser-controller.ts` 管理。`packages/workers/src/browser/browser-host.ts` 提供不返回秘密值的站点数据查询/清理原语，并把 Profile 查询、恢复、清除、删除与 Lease admission 串行化。Renderer 不读取 Profile 目录、不直接调用 Electron session Cookie API，也不再把 BrowserStage `<webview>` partition 当作 Profile 真源。

Browser Automation Studio 的录制链路：

```text
BrowserStage 录制视图
  -> preload/Main browser.recording.{list,get,start,stop}
  -> RuntimeBrowserRecordingService
  -> SqliteBrowserStore（recording intent、状态机、最多 200 条脱敏步骤）
  -> BrowserHost recording Profile claim + exact Page lease
  -> Playwright 主 Frame DOM 语义事件
  -> append/replace-last 串行写入与 Renderer 800 ms 快照轮询
  -> stop/page-close/runtime-restart 终态 -> 关闭 exact Page -> 释放 lease
```

`packages/shared/src/types/browser-recording.ts` 是状态、步骤和上限合同；迁移 `0037_browser_recording` 是 durable 真源。`apps/runtime/src/browser/runtime-browser-recording-service.ts` 负责 intent-before-side-effect、停止幂等、mutation 排空和冷启动 `interrupted` 恢复；`packages/workers/src/browser/browser-host.ts` 负责单 Page 主 Frame 捕获、稳定定位器候选、URL/敏感值脱敏、随机 capture token 与 Profile 独占。P1.2 不创建 WorkflowVersion，也不执行录制步骤。

Browser Automation Studio 的任务与审核链路：

```text
BrowserWorkflowPanel / BrowserStage Draft recording context
  -> Desktop browser-workflow-payloads strict validation
  -> Runtime browser.workflow.{list,get,createDraft,submit,review}
  -> RuntimeBrowserWorkflowService
  -> SqliteBrowserStore
       browser_automation_task
       browser_workflow_draft
       browser_workflow_review
       immutable browser_workflow_version
```

对话工具 `browser_workflow_list/get/create_draft` 复用同一 Runtime service；模型只能查询或创建 `source=ai` 的 Draft。Renderer 的“批准并发布”是唯一发布入口，execution mode 不替代 Review。迁移 `0038_browser_automation_workflow` 和 SQLite update/delete trigger 是 WorkflowVersion 的不可变真源；确定性执行器尚未接入。

### Windows 更新与自动 rollback

```text
Settings/About updater action
  -> trusted Renderer IPC
  -> desktop-update-preferences startup/manual check gate
  -> DesktopUpdateController action/phase fence
  -> electron-updater Main-only HTTPS/Bearer driver
  -> beforeInstall: DesktopUpdateRollbackCoordinator.prepareInstall
  -> verify previous healthy installer + write durable intent
  -> detached PowerShell watchdog
  -> shutdownDesktopServices -> quitAndInstall
  -> target managed Runtime hello -> matching health marker
  -> healthy outcome，或 deadline 后 one-shot previous installer rollback
```

NSIS `apps/desktop/build/installer.nsh` 负责把每个已安装版本的 installer 原子归档到 `%LOCALAPPDATA%\sync-think-updater\recovery\installers\<version>`。`scripts/windows-portable-release.mjs`、`windows-installer-release.mjs`、`windows-generic-update-feed.mjs` 及对应 selftest 负责构建与离线验证；发布脚本不得接触 Renderer secret 或真实 userData。

## 5. 数据与恢复边界

| 数据                                                      | 真源/生命周期                                                                                                                     |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 任务、消息、Run、Step、Agent/Skill/Policy、Artifact、审计 | Runtime + SQLite durable store                                                                                                    |
| 已启动 Run 的 Skill 选择                                  | durable event/checkpoint 保存精确 ID + fingerprint；正文继续以不可变 SkillVersion 为真源                                          |
| Workspace Pane 树、比例、焦点、资源 Tab、terminal cwd     | 版本化 Renderer UI preference                                                                                                     |
| Workspace 右侧/底部 Workbench、尺寸、资源 Tab、文件树宽度 | 版本化 Renderer UI preference；按 workspaceId 隔离，不包含文件正文、diff 正文或 terminal 输出                                     |
| 当前会话的 Skill 临时选择                                 | 当前 `ChatView`/欢迎页 Renderer state；成功或失败后保持，切换有效 Agent/Team owner 时恢复新默认，模型直聊为 `[]`；不写入布局偏好  |
| 文件磁盘正文                                              | 项目目录；保存时以 mtime/size 做并发校验                                                                                          |
| 未保存文件草稿                                            | 当前 Renderer Session，按 workspaceId + path 隔离                                                                                 |
| terminal 输出、历史、运行态、命令输入                     | 当前 Renderer Session                                                                                                             |
| terminal 子进程                                           | Main/Worker 当前生命周期；Renderer 销毁和应用退出时 abort                                                                         |
| 浏览器 Profile/Cookie                                     | Runtime 数据目录中的专用系统浏览器 Profile；SQLite 只保存 Profile 元数据与脱敏站点摘要，不保存 Cookie/Token/存储正文              |
| Browser origin grant、command 与人工 handoff              | SQLite durable store；重启后按 revision/ownership fence 恢复，不重放未知副作用                                                    |
| Browser Session/Page lease                                | 当前 Runtime/BrowserHost 生命周期；durable handoff 只保存恢复所需的有界 lease checkpoint，继续前重新验证 ownership                |
| Browser recording                                         | SQLite durable intent、终态与脱敏语义步骤；活动捕获、Page 与 lease 只在 Runtime/BrowserHost 生命周期中存在                        |
| Browser Automation Task/Draft/Review/WorkflowVersion      | SQLite durable store；Draft 可返工，Review 追加记录，已发布 WorkflowVersion 由 trigger 保证不可更新/删除                          |
| 生成图片正文                                              | Runtime 受控 GeneratedImageStore；SQLite/Renderer 只保存 contentRef/hash 和 opaque preview 投影                                   |
| Updater failure evidence                                  | `<userData>/diagnostics/desktop-updater-recovery.json`，最多 20 条脱敏记录                                                        |
| 自动检查更新偏好                                          | `<userData>/desktop-update-preferences.json`；仅 Main 读写，Renderer 经严格 IPC 传递 boolean                                      |
| Automatic rollback                                        | `%LOCALAPPDATA%\sync-think-updater\recovery` 下的 installer、healthy release、intent、health、attempt 与 outcome；不进入 Renderer |

布局偏好不得存储文件正文、terminal 输出、流式帧、错误态、会话级临时 Skill 选择或旧进程“仍在运行”的声明。Run event/checkpoint 也不得复制完整 `SKILL.md` 正文。

## 6. 文件放置规则

1. 新 Electron OS 能力：Main service + Main IPC 校验 + Preload bridge + Renderer type，不能只在 Renderer 实现。
2. 新 Runtime 命令/事件：先放 `packages/protocol` 合同与校验，再接 Runtime handler 和 Desktop client。
3. 新可恢复业务状态：进入 `packages/storage` 和 Runtime 投影；localStorage 只用于版本化 UI preference。
4. 新 Pane/Workbench 资源：先扩展对应 `pane-layout.ts` 或 `workspace-workbench.ts` 的资源联合类型、解析和上限，再实现 view/Tab 表达，并写迁移与恢复测试。
5. 新本地执行能力：进入 `packages/workers`，显式声明 capability、路径/参数边界、超时、取消和输出上限。
6. 重型 Renderer 依赖：独立 bundle 并按需加载；进入首屏前必须记录性能与回滚决策。
7. 行为变化同步更新 changelog/current status；架构或依赖变化同步更新 tech decisions 与本页。
8. 新的每轮上下文附件必须先定义 `undefined`/空/非空语义、Runtime 权威校验、冻结与恢复边界；Renderer 目录默认只取 metadata。
9. Windows 发布能力进入 `scripts/windows-*.mjs` 与 `apps/desktop/build`，必须区分正式 fail-closed 模式和显式 unsigned fixture，并让聚合 selftest 自包含准备步骤。

## Runtime 与 daemon 生命周期（2026-08-20）

- `apps/runtime/src/daemon/main.ts` 是常驻控制面：负责调度、队列、Runtime 探测/拉起/崩溃恢复，以及 push/webhook/文件/Git/async 统一事件入口。
- `apps/runtime/src/daemon/external-event-{protocol,client,coordinator,adapters}.ts` 分别负责白名单协议、认证管道、租约状态机和来源映射；`external-event-submit.ts` / `external-event-status.ts` 是本地 CLI。
- `apps/runtime/src/daemon/github-webhook{,-server,-sync,-config}.ts` 是 TD-047 的 HTTP 入口分层：`github-webhook.ts` 是纯函数层（配置解析、HMAC 校验、响应码判定、push payload 有界投影），`-server.ts` 是 `node:http` 监听器，`-sync.ts` 是 rescan 驱动的启停/就地路由刷新循环（single-flight 且**所有**路径都必须走同一个 `finally` 释放，否则 guard 会永久 wedge），`-config.ts` 是 `pnpm webhook:github` CLI。密钥只经 stdin 或自动生成进 SecureStore，配置只存 handle。
- `packages/storage/src/external-event-store.ts` 是 `0048_daemon_external_event` 的持久状态机；`packages/shared/src/types/external-event.ts` 是跨层 envelope SSOT。
- `apps/runtime/src/runtime.ts` 是执行面和 SQLite durable 真相源：对话、Run、工具授权、事件投影、Kernel adapter/session 都归 Runtime 所有。
- `apps/runtime/src/personalization-context.ts` 规范化 `preferences.personalization` 并生成每轮 Agent system context；姓名、工作描述和全局提示词由 Runtime setting store 持久化，Renderer localStorage 只承担断线时的 UI 缓存。
- `conversation.listPendingToolApprovals` 是 Desktop 重连时的当前状态对账接口：Runtime 只返回请求时保存的脱敏 `approvalSummary`；Desktop 将其与 durable event replay 合并，不把原始工具参数扩散到 Renderer。
- `apps/runtime/src/kernel/codex-app-server-adapter.ts` 只消费官方 Codex app-server JSON-RPC；`registry.ts` 是唯一注册入口。
- `apps/runtime/src/kernel/codex-e2e-verify.ts` 是使用本机登录态的非密封真实验收入口；`pnpm selftest:codex-persistent` 验证同进程连续 turn 与新进程 `thread/resume`，不进入普通离线测试套件。
- `apps/desktop/src/main/runtime-supervisor.ts` 只负责 Desktop client 的冷启动/连接和升级时有界停止，不拥有普通窗口退出的 Runtime 生命周期。

数据流：`Desktop/外部事件 -> daemon durable inbox/lease -> Runtime pipe -> Conversation/Run/Event/Message/Kernel session -> SQLite`。Desktop 断开后，Runtime 与 daemon 继续运行；重连先使用 durable cursor/replay 还原历史，再向 Runtime 查询仍 pending 的审批做当前状态对账。

# 协作策略边界（2026-09-12）

运行时协作权限由 `apps/runtime/src/collaboration-policy.ts` 负责，设置类型和默认值由 `packages/protocol/src/collaboration.ts` 负责。工具目录和执行入口都必须使用会话的 `ConversationTrack` 做过滤与硬校验，提示词只负责解释行为，不承担权限。
