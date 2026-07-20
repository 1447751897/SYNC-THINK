## 2026-07-20 · Codex 三档执行模式权限收敛（Phase 1+2）

- 新增设计：`docs/superpowers/specs/2026-07-20-codex-three-mode-permission-design.md`。
- 产品权威收敛为 Codex 三档：`read-only`（只读）/ `workspace`（工作区）/ `full-access`（完全访问）。
- shared 增加 `ExecutionMode` 与 legacy `ApprovalMode` 映射；core 增加 `resolveEffectiveExecution`。
- Runtime 对话工具绑定与 Production Step 工具注册改为按三档模式决定工具面，不再按 `AgentPermissions` 细分类矩阵过滤。
- storage migration `0029_task_execution_mode` 为 Task 持久化 `execution_mode`；protocol 增加 `task.setExecutionMode`。
- Desktop Composer / 详情栏绑定 `Task.executionMode`；审批中心继续使用独立 approval policy，不驱动三档控件。
- 移除 Agent 权限矩阵 UI；子任务创建与 reuse 响应均投影 `executionMode`。
- 兼容：旧 `request/delegate/custom` → 工作区；旧 `full` → 完全访问；`delegate` 仅影响审批路由。
- 定向验证：runtime typecheck/build、`mode-policy-commands` 14、storage 关键回归 89。
- 后续 Phase 3：Project/Install 默认 mode、Run snapshot 审计固化、旧 policy 主路径降级、全仓与实窗验收。

## 2026-07-20 · 对话输入、目标切换、空任务与完全访问闭环

- Composer 文本输入随内容从 56px 自动增高到 200px，达到上限后内部滚动；Talk 输入区总高度限制为 `min(360px, 45vh)`，手动拖拽仍可用。
- 单聊隐藏隐式 `@智能体`；显式 `@其他智能体` 只路由当前一轮。切换主智能体或小队会创建标题/目标均为“新任务”的独立对话，不继承旧任务信息。
- 空任务不再依赖版本 0 或默认标题判断；Runtime 根据消息、子任务、计划、Run、产物和审批请求做最终保护。未发送草稿/附件会保留旧任务，真实任务的 managed worktree 不会被误清理。
- 四种模式名称固定为请求批准、替我审批、完全访问、自定义。完全访问对所有当前可执行操作直接放行，包括敏感操作与配置确认；请求批准下只读检查自动执行，受保护工具在同一调用上暂停并于批准/拒绝后恢复。
- 普通权限界面不再显示 `read_file`、`list_files`、`git_status`、`git_diff` 等内部名称，统一映射为读取项目文件、查看 Git 变更等产品能力分类。
- Talk 任务头新增“操作审批”入口，可查看待审、已决、敏感操作分类和作用域策略；没有历史策略时，新策略草稿继承当前任务有效模式，避免右栏“完全访问”却在弹窗显示“请求批准”。
- 定向验证：Core 21、Storage 19、Runtime 审批/工具 14、Runtime 工具/工作区 14 均通过。最终 Runtime `50 files / 297 tests`、Storage `23 files / 233 tests`、Workers `9 files / 53 tests`、UI Kit `21 files / 253 passed / 2 skipped`、Desktop `65 files / 456 tests`；全仓 typecheck `21/21`、build `12/12` 无缓存通过，最终受影响包重新构建通过。
- 实窗验证：Composer `56px -> 121px -> 200px`，超过上限后 `overflow-y: auto`，清空恢复 `56px`；单聊输入无隐式 `@`；浏览器身份页显示工作/个人账号 Cookie 隔离示例；任务权限与审批策略均为 `full`。Runtime PID `14960`、Electron PID `19128`，窗口响应正常、hello 成功、最新 stderr 为空。

## 2026-07-19 · 项目执行位置、worktree 集成与独立浏览器身份

- 项目资料页现在直接显示 Git 仓库地址与默认分支，并提供“编辑 Git 仓库”；弹窗预填当前值。旧版本产生的本地/远程双资源会在启动时把远程绑定合并到主资源，后续保存只更新主记录。
- 远程 Git 准备改为非阻塞克隆/更新；仅真正异步的 pending 任务发布 `task.execution-ready` / `task.execution-blocked`，同步就绪的本地任务不污染全局事件流。
- 子任务使用独立 managed worktree，完成后把改动压缩为结果提交并自动 cherry-pick 回父任务；真实冲突保留 Git 状态，右栏支持“采用子任务”与“保留父任务”。
- 浏览器身份支持创建、重命名、设为默认、引用保护删除和任务级选择；任务固定独立 profile，子任务默认继承。任务右侧栏直接编辑访问模式和浏览器身份，并展示执行位置、基线、实际能力分类和 Agent 能力上限。
- 对话 Run 与 Production Step 统一使用同一套文件、命令、Git、Playwright 与 Windows UI Automation 工具；显式 Agent 能力上限会过滤不可用分类，旧 Agent 维持兼容默认。
- 全仓强制 test **21/21**、typecheck **21/21**、build **12/12** 通过；Runtime **50 files / 284 tests**、Workers **9 files / 53 tests**、Protocol **19 tests**，`git diff --check` 无错误。
- QA Runtime 已重启为 PID `75840`，主项目资源已吸收原 GitHub 绑定；Electron 已重启为 PID `19952` 并完成 hello，生产 Runtime PID `43748` 未重启。

## 2026-07-19 · 群聊改为普通对话与 @成员路由

- 群聊不再为每条用户消息自动启动“主智能体决策、自动委派、最终总结”的强制编排，改为与好友单聊一致的普通流式对话；无 `@` 时由群聊主智能体回复，`@成员` 时按精确 `AgentVersionId` 直接路由给该成员。
- Composer 的群聊 `@` 候选仅展示当前群聊成员，选择成员不会切换全局智能体；群聊定义与成员职责继续进入 Context Packet，显式子任务委派、交接和自动化能力保持可用。
- 对话投影不再把“已开始协作、决定直接完成、已委派、已交接、已完成协作”等过程事件显示成聊天卡片；历史任务中已经存在的过程卡片也会同步隐藏，执行事件仍保留在持久化审计数据中。
- 验证：UI Kit **243/243（2 skipped）**、Desktop **433/433**、Runtime **267/267**，三包 typecheck 与全仓 build **12/12** 通过；QA Runtime 已重启为 PID `75800`，Electron 已重启为 PID `54064`，生产 Runtime `43748` 未重启。

## 2026-07-19 · 跨任务消息版本隔离修复

- 修复从高版本旧任务切换到低版本新任务后，Desktop 仍携带旧任务版本发送消息的问题；任务选择现在会把 optimistic task version 精确重置为当前任务版本，不再跨任务取最大值。
- 真实日志复现为 Runtime 期望版本 `1`、Desktop 错误发送版本 `23`；新增 `23 -> 1` Reducer 回归测试与桌面接线契约。
- 验证：聚焦 **33/33**、Desktop **433/433**、Desktop typecheck 与全仓 build **12/12** 通过；Electron 已重启为 PID `14572`，QA Runtime `74052` 与生产 Runtime `43748` 未重启。

## 2026-07-19 · Composer 小队选择、稳定拖拽与全局细滚动条

- Composer 参与者菜单按“智能体 / 小队”分区展示已有配置；小队显示主智能体与成员数，不提供快捷创建入口。
- 选择小队会创建真实协作任务并复用小队主智能体、成员职责和 Runtime 调度；当前对话为空时以小队任务替换并删除空任务，已有消息或草稿时保留原任务并新建小队任务。
- 输入区顶部拖拽改为窗口级 Pointer 监听，透明命中区扩大且继续支持方向键调整；移除可见横线，并统一桌面全局 6px 紧凑滚动条。
- 验证：UI Kit **242/242（2 skipped）**、Desktop **431/431**，两包 typecheck 与全仓 build **12/12** 通过；Electron 已重启为 PID `55480`，QA Runtime `74052` 与生产 Runtime `43748` 未重启。

## 2026-07-19 · Composer 项目创建入口与空项目切换

- 对话 Composer 的项目菜单新增“新建空白项目”和“使用现有文件夹”，分别复用现有项目创建弹窗与系统文件夹选择器；下方继续展示全部已有项目、绑定路径和当前选中状态。
- 修复选择无任务项目时只显示错误、无法切换的问题；现在会在目标项目自动创建一个空对话任务并立即打开，有任务的项目仍恢复最近打开的任务。
- 项目菜单在创建操作期间禁用重复触发，流式输出期间继续保持不可切换，避免对话归属竞争。
- 验证：Compose **34/34**、UI Kit **241/241（2 skipped）**、Desktop **430/430**；UI Kit 与 Desktop typecheck 通过。
- 全仓 build **12/12** 通过；Electron 已重启为 PID `50224` 且正常响应，QA Runtime `74052` 与生产 Runtime `43748` 未重启。

## 2026-07-19 · 应用工具兼容修复与对话/好友页精简

- 定位内置 Agent 无法创建智能体或群聊的真实原因：OpenAI function 名只允许字母、数字、下划线和连字符，而 SYNC-THINK 内部工具名使用 `sync_think.*` 点号格式，供应商因此在附带工具时返回 `502 Upstream request failed`。
- OpenAI Responses 与 Chat Completions Adapter 新增请求级可逆工具名映射；请求 schema 和历史 tool call 使用合法 wire name，Provider 返回后恢复内部稳定名称，Runtime、审计事件和 CLI/MCP 合同不变。
- 兼容协议的内置应用工具不再被错误的 `capabilitiesConfirmed + text-only` 缓存关闭；真实工具能力由协议 Adapter 和实际调用验证。
- 对话 Composer 支持从顶部拖拽调整高度，并提供键盘上下方向键调整，限制在可用窗口范围；发送、Agent、模型、项目和权限控件保持原功能。
- 任务头移除“介入 / 暂停 / 终止”三个重复按钮；操作审批、对话布局和任务详情折叠继续保留。
- 项目选择与展开状态解耦；项目下任务可反复展开/收缩，收缩不清空右侧项目详情和内部任务节点状态。
- 好友“能力与指令”改为身份、工作能力、工作指令、执行设置四区；移除输入/输出契约、记忆范围和 Agent 详情 MCP 调试台。保存时历史契约保持不变，上下文固定当前任务，跨任务信息只能由 Agent 显式调用项目/任务/上下文工具读取。
- 验证：Adapters **47/47**、Runtime **267/267**、UI Kit **240/240（2 skipped）**、Desktop **430/430**；相关四包 typecheck 与全仓 build **12/12** 通过。使用 QA 库现有 DPAPI 凭证对真实 `gpt-5.6-sol` 发起带工具请求，成功返回并恢复为内部名称 `sync_think.agent.list`，结束原因为 `tool-requests`，未再出现 502。
- 最新 QA Runtime PID `74052` 健康检查 `ok: true`，Electron 主进程 PID `3312` 正常响应；生产 Runtime PID `43748` 保持运行且未重启。

## 2026-07-19 · Provider 瞬时 502 重试与 fallback 可解释性

- 真实事件确认 `gpt-5.6-sol` 与 fallback `gpt-5.5` 在故障窗口均由同一供应商返回 `502 Upstream request failed`；同密钥、同代理、同 `/responses` 协议的最小请求和 4,885-token 完整对话请求随后均可成功，排除模型、密钥、协议和上下文本身不可用。
- 普通对话 Run 对空输出的 `502/503/504`、网络断开和 timeout 增加两次有界短退避；每次写入 `run.retry.scheduled`，重试耗尽后才进入用户配置的 fallback，认证/协议/权限/验收错误不按网络错误重试。
- fallback 切换会重置当前模型的重试计数；工具调用进入新 Provider turn 时也会重置，避免前一轮故障污染下一轮。
- 对话消息保留供应商模型链，失败时显示 `gpt-5.6-sol -> gpt-5.5` 和 HTTP 状态；移除误导性的“可配置 fallback 后重试”通用文案，执行详情同步显示重试次数。
- 验证：Runtime fallback **4/4**、Desktop event history **24/24**；Runtime 全量 **267/267**、Desktop 全量 **430/430**；Runtime/Desktop typecheck 与全仓 build **12/12** 通过。QA Runtime 与 Electron 已重启，生产 Runtime 未触碰。

## 2026-07-18 · Figma Talk 产品页 fidelity 与可用性修复

- 修复点击对话任务会因 `updated_at` 变化而置顶的问题；`openTask` 现在只更新 `last_opened_at`，任务排序保持稳定。
- 任务页扩大为 Figma 阅读宽度，助手消息可使用 1040px 内容宽度，用户消息继续紧凑右对齐；空状态主按钮在浅色模式下保持可读。
- 项目页组合真实项目目录、项目任务目录、完整对话和任务详情，切换项目或任务不会离开项目分区，也不复制 Runtime 状态。
- 好友页新增内联智能体创建、资料操作和分组能力/固定指令编辑；移除 Agent 级审批界面，保存时继续使用领域要求的 `full` 默认值。
- 群聊、自动化、模型源、Skill & MCP 改为统一的全高目录/详情页面；Provider 的 CC Switch 导入、密钥、分组、供应商与模型行为全部保留。
- 清理任务/项目 Conversation 内不可达的旧资源页重复分支，并修复 Agent 创建表单的严格布尔类型，Desktop 构建恢复为 0 错误。
- 独立审查后补齐三个集成边界：项目设置可在第二列打开；切换空项目会清除旧任务且新建对话使用当前项目；没有既有 Agent 时可从已导入模型/凭证生成首个运行时绑定，创建错误直接显示在表单内。
- 验证：审查修复聚焦 Desktop **3 files / 48 tests**、AgentWorkspace **14 tests**、Storage **18 tests**；Desktop 全量 **62 files / 419 tests**、UI Kit 全量 **21 files / 239 tests**；全仓强制串行 test **21/21**、typecheck **21/21**、build **12/12** 全部通过。
- 最新 Electron 根进程 `70140`，窗口标题 `SYNC-THINK`、`Responding=True`、stderr `0 bytes`；生产 Runtime `43748` 与 QA Runtime `51248` 保持存活且未重启。最终视觉 1:1 验收由用户在最新桌面中完成。

## 2026-07-18 · 对话任务右栏改为进度、产物与分 Agent 执行日志

- 任务详情右栏收敛为 `任务进度 / 文件与产物 / 执行详情` 三个 Figma 对齐视图，移除右栏内嵌 Trace、Graph、Approval 二级导航和审批卡。
- `任务进度` 从真实 Run、Step、AgentVersion 与模型事件投影 Run 摘要、步骤进度和参与智能体；无 Run 时稳定显示“尚未开始”，不伪造执行状态。
- `文件与产物` 改为紧凑目录，点击后在弹窗中复用现有版本历史、比较、选择、合并和冲突处理能力；最新版本与当前选择版本分别展示。
- `执行详情` 按“一条用户消息一轮”组织日志，打开一轮后按 Agent 阶段折叠展示模型、职责、耗时、工具调用、产物、错误与 Runtime 恢复事件；无归属事件进入 `SYNC-THINK Runtime`，不会错配给 Agent。
- 子任务、归档/恢复、父任务返回、暂停/终止仍在任务树或任务头可达；操作审批移到任务头独立工具弹窗，不再占用任务右栏。
- 最新验证：聚焦 **6 files / 48 tests**、Desktop **62 files / 400 tests**、UI Kit **21 files / 233 tests**、全仓 test **21/21**、typecheck **21/21**、build **12/12** 全部通过；Desktop main/preload/renderer 已重新生成。
- 本轮未启动 Electron，也不声明新的 1:1 实窗验收；最新页面由用户直接检查。

## 2026-07-18 · Figma Talk 对话任务专用工作区

- 新增 `TalkConversationTaskWorkspace`，任务页从旧 `AppShell` 展示结构切换为 Figma Talk 的对话目录、完整对话与任务详情三列工作区。
- 锁定 200/240/fluid/260 横向结构、52px 对话头和 114px Composer；任务目录改为跨项目扁平列表，提供全部/单聊/群聊、归档筛选与新建对话。
- 继续复用真实任务、消息、Composer 与右栏槽位，保留发送/流式、Agent/模型/项目切换、暂停/终止、审批、子任务、产物、Trace、Manifest、执行图、归档和主题行为。
- 消息身份补充真实 Agent 头像、模型、时间和有记录时的 token 信息；任务头同步显示当前 Agent、模型与项目。
- 自动化验证：Desktop **59/386**、UI Kit **21/233**、全仓强制串行 test **21/21（0 cache）**、typecheck **21/21（0 cache）**、build **12/12（0 cache）**、diff check 全部通过。
- 按用户要求未做新的 Electron/截图检查；本地重构后的视觉确认由用户直接完成。

## 2026-07-18 · Talk V8 应用工具、真实群聊协作、自动化与头像闭环

- 内置对话 Agent 接入 `sync_think.*` application-tool 多轮调用：Runtime 执行统一命令、回传工具结果并继续 Provider turn；配置命令在 UI 中生成确认卡，确认/拒绝都可审计。
- 群聊任务接入真实协作：主智能体先以结构化结果决定 `single` 或 `delegate`；只有被精确点名的成员会收到独立 subtask 包和工具白名单，显式委派、交接与全部交流事件可见，最终回答由主智能体统一总结。
- Scheduler/自动化/群聊的每次真实模型调用都注入 SYNC-THINK 平台信封和当前任务历史，并写入幂等 `context.packet.built`；成员上下文只含自己的目标、证据、验收条件、允许工具和相关上游交接。
- 应用网关新增 `sync_think.subtask.delegate` 与 `sync_think.handoff.record`，现共 21 个稳定工具；内置 Agent、CLI 和 stdio MCP 继续复用同一 Runtime 命令、校验、授权与事件边界。
- 新增 migration `0026_automation`、Automation Store 与 Runtime 服务：支持五字段 Cron、IANA 时区、本地 Webhook、HMAC-SHA256、skip/queue/parallel 并发、最多两次重试、每次触发创建独立任务和运行历史。
- Desktop 自动化页从空态升级为完整列表、创建/编辑、启停、删除、立即运行、Webhook 地址/一次性密钥和执行历史；Desktop IPC 对全部字段、枚举和边界做严格校验。
- Agent 头像支持 PNG/JPEG/WebP 上传，限制 5 MiB、4096×4096，以 SHA-256 文件名保存到受管目录；Agent 状态、最大并发和消息头像完成持久投影。
- Windows MCP stdio 子进程停止改为终止完整进程树，Runtime 关闭会等待后台清理，避免重启后遗留子进程或测试挂起。
- 好友资料补齐最近任务、同一 Agent 历史版本、群聊归属/职责和主智能体身份；任务可从资料页直接打开。
- 修复 Talk 任务/项目第二栏被压缩和浅色设置页文字对比度；新增仅开发态生效且有生产禁用边界的 1280×720、隔离 userData、软件渲染 QA 参数。
- 最终桌面补测：群聊创建/编辑的权限、协作与并发 payload，Skill 导入、MCP 注册、设置页真实状态/计数/主题切换和好友状态筛选均有交互测试；Desktop **59 文件 / 385 项**、UI Kit **21 文件 / 233 项**通过，两包 typecheck、build 通过。
- 修复设置页标题未显式绑定主题 token 的回归；原 Desktop 全量用例稳定复现失败，补入 `var(--st-color-text-secondary)` 后 **13/13** 聚焦及 **385/385** 全量通过。
- 真实 Electron 首次切换好友页时主区持续空白，定位到非任务 AppShell 的 `0 + 1fr` Grid 将主内容放入 0px 列；布局契约 RED 后改为单列，好友、群聊、自动化、模型源、Skill & MCP、设置和项目全部恢复。
- 最新构建完成 1440×900 与 1280×720 客户区浅/深主题实窗，覆盖全局导航折叠、任务三栏、项目、好友、群聊表单、自动化、模型源、Skill & MCP 和设置；Renderer Console `No Issues`。打开 DevTools 前 stderr 为空，打开后只记录 DevTools 自身的 language-mismatch 与 Autofill 协议诊断。
- 更正验收记录：此前 **189 文件 / 1399 项**属于最终 Talk 页面改动前的历史全仓基线。最新构建仍需 Node 20 全仓回归和生产在线重启；当前被 `codex-auto-review` 路由 404 阻塞。

## 2026-07-18 · Talk V8 第一纵切、Agent 平台上下文与统一应用网关

- Desktop 接入独立全局导航与 Talk V8 分区：对话任务、项目、好友、群聊、自动化、模型源、Skill & MCP、设置；现有 Composer、任务对话、Provider、审批、产物和执行详情继续使用真实 Runtime 数据。
- 好友直接映射 AgentVersion，新增在线/忙碌中/离线状态、资料视图、固定 Prompt 与最大并发编辑；`maxConcurrency` 默认 3、范围 1-16，并已持久化到 SQLite migration `0025`。
- 新增持久 GroupDefinition 与 Desktop 群聊资料页：严格一个主智能体、成员职责、并行/串行、权限、并发数、版本 CAS，以及创建群聊任务；群聊执行编排仍是后续范围。
- Provider 请求新增 SYNC-THINK 应用环境信封，并真实发送当前 thread 的有序对话历史；上下文预算排除项可审计，兄弟任务与无关群聊不被隐式读取。
- 新增首批 19 个 `sync_think.*` 应用工具合同、`sync-think` CLI 和 stdio MCP Server；后续补入 subtask/handoff 后当前共 21 个。所有入口复用 Runtime 命名管道、命令校验、事件与 SQLite 事务。
- 外部配置命令新增 preview -> confirm：令牌 5 分钟过期、单次使用，绑定 command/caller/payload digest；预览不输出参数值，并记录请求、确认和拒绝事件。Desktop 明确交互不增加重复确认。
- 验证：UI Kit 230、Desktop 359、Core 148、Protocol 18、CLI 3、Shared 21、Adapters 46、Secure Store 11、Runtime 定向 14 项通过；12 个 workspace package build/typecheck 通过；diff check 通过。
- 未完成：内置 Agent 应用工具循环、群聊 subtask/handoff 与成员执行、群聊历史、自动化持久化/调度/Webhook、头像上传 IPC、双主题双尺寸实窗视觉 QA。

## 2026-07-16 · 对话优先工作区与自动协作升级

- 左侧项目树不再常驻显示绑定目录或“未绑定文件夹”副标题；完整目录只在项目 hover / focus tooltip 中出现。
- Compose 新增项目入口和项目菜单，项目、Agent、模型统一在输入区切换；切换项目会恢复该项目最近任务，没有任务时明确引导新建。
- 新建任务直接生成内部占位标题，不再弹命名框；首条用户消息会在同一个 CAS 事务中自动推导标题与目标，避免消息成功但命名丢失。
- 任务头移除重复的当前队友、模型摘要和手动 `对话 / 协作 / 自动` 切换；底层 participation mode、不可变计划版本与审批闸仍保留。
- 对话会识别显式多 Agent / 小队 / 分工 / 并行意图以及多阶段复杂任务，在原对话页自动升级到 collaboration，并按已配置的精确 AgentVersion 生成可编辑计划；计划仍需用户批准后才执行，不静默替换模型。
- Desktop 旧的 Automatic CTA 源码契约已更新为对话升级契约；Runtime 临时目录清理在已复现路径加入 Windows 原生重试，Runtime 集成测试预算调整为 15 秒以覆盖全仓并行负载。
- 验证：根 `pnpm test` **20/20 tasks**，Desktop **356/356**，Runtime **225/225**；`pnpm typecheck` **20/20 tasks**；`pnpm build` **11/11 tasks**；`git diff --check` 通过。
- 视觉验收：静态 Renderer 在 **1440×900** 与 **1280×720** 均无横向溢出，任务头、Compose、项目菜单和左右轨无重叠；浏览器预览实测新建任务无命名弹窗。
- 已知门禁债务：根 `pnpm lint` 在读取源码前因缺少 ESLint 9 `eslint.config.*` 全包失败，本轮不将 lint 记为通过，也不在交互改版中扩大全仓 lint 配置范围。

## 2026-07-16 · 本地工具执行纵切与桌面折叠轨修复

- File Worker 已支持受限读文件、列目录和原子写文件；Terminal Worker 以命令 capability allowlist、固定 `cwd`、无 Shell、超时/取消和输出限幅执行；Git Worker 以固定 argv 提供 `status / diff / log / branch`。
- File、Terminal、Git 在执行前同时校验词法路径和真实路径，拒绝 `..`、绝对路径及 symlink/junction 逃逸；文件删除继续禁用，Windows `.cmd/.bat` 仅通过严格包装执行并拒绝变量展开、引号和连接元字符。
- Production Executor 已接入 `read_file / list_files / write_file / run_command / git_status / git_diff` 工具循环；仅对已绑定项目目录、声明 `tool-calling` 的模型和普通执行 Step 开放。
- 动态工具调用复用 Scheduler 审批策略：请求先持久化并进入 `awaitingApproval`，批准后以同一 Step 和幂等键恢复；`0023_provider_execution_checkpoint` 单独保存循环检查点。
- OpenAI Responses、OpenAI Chat Completions 和 Anthropic Messages 已支持工具 schema、流式工具调用与结果回传；任务最终产出正文 Artifact 和 JSON 工具轨迹 Artifact，密钥不进入 Renderer、提示词、日志或工具轨迹。
- 桌面主操作文案收敛为“准备协作计划”，移除右轨重复 CTA；折叠右轨固定为仅图标控制，不再把标题和说明压成竖排文字。
- 验证：根 `pnpm test` **20/20 tasks**、`pnpm typecheck` **20/20 tasks**、`pnpm build` **11/11 tasks**；静态桌面 1440×900 与最小宽度 1280×720 无横向溢出、控件重叠或按钮文字溢出。
- 已知门禁债务：默认 `pnpm lint` 未适配 ESLint 9 flat config；以 legacy 配置兼容运行后，4 个包通过、7 个包仍有存量空接口/规则插件/正则与旧测试 lint 错误，本轮不将 lint 记为通过。
- 当前边界：Browser Worker、Windows UIA Worker、图像生成完整管线、安装器/签名/自动更新仍未实现，Phase 3 仅为部分完成。

## 2026-07-16 · 对话中的 Agent 成为可见协作者

- 任务顶部结构位从误导性的 `决策 / 记忆 / 上下文` 改为 `工作区 / 任务 / 对话`。
- M1/M2 完成后，开发验收用的 `M1 验证` 工作台退出普通产品界面；历史投影与证据未删除。
- 助手消息恢复 Agent 身份，但不恢复厚重消息卡：左侧圆形头像、名称、流式状态与右侧无框 Markdown 正文组成一条轻量队友消息。
- 消息从 `run.started.agentVersionId` 解析精确不可变 AgentVersion；历史消息可区分不同 Agent，旧消息有当前绑定 Agent 回退。
- Agent 图标支持 `bot / workflow / planner / executor / image / reviewer` 等 Lucide 映射、Emoji 和名称首字回退，颜色仅作为辅助身份信号。
- 点击头像或名称可打开对应智能体中心；模型、凭证与 Run 元信息继续留在 Trace / Manifest。
- 验证：UI Kit **215/215**、Desktop **323/323**、全仓强制 test **20/20（0 cache）**、typecheck **20/20**、build **11/11**；Electron 重启与头像跳转实窗通过，stderr 0 bytes。

## 2026-07-15 · M1 dogfood 门槛改为一天并关闭 M1

- 用户明确将 M1 dogfood 门槛从 3 个真实日期改为 **1 个真实使用日**；自动化和脚手架仍不计数。
- 新增 `m1-dogfood-policy.ts` 作为 Desktop 单一真源，产品默认 `M1_DOGFOOD_REQUIRED_DAYS = 1`；退出证据、手测、退出路径、快照、证据包、状态栏等统一使用该策略。
- 既有 `docs/development/dogfood/2026-07-12.md` 是有效真实记录，当前从 1/3 更新为 **1/1**；外网手测保持 **18/18**，M1 正式完成。
- 当前里程碑文案统一为“外网 18/18 · dogfood 1/1 · M1 已完成”；辅助导出仍保持 `claimsM1Closed=false`，即辅助组件本身不能篡改里程碑。
- TDD RED：关键退出投影 5 项按预期失败；完成审计再捕获“仅 dogfood 达标误报 M1 完成”边界 1 项。最终 GREEN：Desktop **318/318**、UI Kit **213/213**、全仓强制 test **20/20（0 cache）**、typecheck **20/20**、build **11/11**、M1 full GREEN、M2 **5/5**。

## 2026-07-15 · 当前里程碑状态投影与过期文案清理

- Desktop 手测投影以 `14-external-gateway-handtest.md` 为外网完成真源：文档 `18/18` 时外网待证归零，状态进入 `awaiting-dogfood`，只显示 dogfood `1/3` 与剩余 2 个真实日期。
- 验证区“当前里程碑状态”改为动态投影，明确 M2 协作/自动模式、CC Switch 完整导入已经完成；移除“当前禁用”“勿启动 M2”等过期声明。
- 退出路径、dogfood 草稿、证据包、会话就绪条及 Provider / Agent / 审批 / Memory 面板统一为“外网 18/18，M1 仍等待真实 dogfood”。
- 证据包 footer 按真实手测计数输出；`18/18` 显示“已完成”，不再反向提示仍需完成同一门槛。
- 实窗追加审计发现并清理外网聚焦卡、证据包标题、回归提示、差异空态、soft 快照、手测粘贴稿与 dogfood 草稿中的二级旧副本；`18/18` 后不再提供重复外网验收 CTA。
- 验证：首轮 Desktop 定向 **48/48**、UI Kit 定向 **75/75**，追加 dogfood-only 投影定向 **53/53**；Desktop 全量 **316/316**、UI Kit 全量 **213/213**；typecheck **20/20**、build **11/11**、M1 quick GREEN、M2 selftest **5/5**。
- 实窗：最终 Electron 可访问文本只显示“外网手测 18/18 已完成 → dogfood 1/3”“M2 已完成”，未再出现“勿启动 / 当前禁用 / 外网手测仍缺”等过期状态。
- 边界：没有新增 dogfood 日期；M1 仍为 **1/3** 并保持 open，总目标继续 active。

## 2026-07-15 · M2 多智能体编排纵切完成

### 已交付

- 不可变 `AgentVersion` 与 `PlanRevision`，精确版本 pin，Task participation mode 持久化。
- 持久 DAG 调度、稳定 Step ID、并行隔离快照、暂停 / 恢复 / 取消和冷恢复。
- 服务端审批策略、最严格作用域解析、Skill/MCP 精确授权与 human-only 边界。
- Reviewer evidence、有界 rework、`review.limit-reached` 暂停和不可变 ArtifactVersion。
- Artifact 三方比较、显式 Merge Step、冲突暂停、left/right/manual 解决与已解决历史。
- Desktop 计划编辑、执行图、审批、产物和 Agent 工作区；Automatic 模式计划只读并可重启恢复。
- 确定性 `selftest:m2`，覆盖精确退出序列、版本数量、唯一终态、安全证据和 Runtime 重启恢复。

### P1 审查

- ApprovalCenter 保存一条规则时保留同策略的全部后续规则。
- 持久 Runtime 使用 Windows DPAPI；XOR 仅限显式测试配置或旧凭据迁移。
- Provider 创建、轮换和 CC Switch 导入补偿边界新增持久事件失败覆盖，数据库不会引用已删除的新密钥 handle。
- 本轮审查未发现 M2 阻断项。

### 验证与状态

- M2 selftest **5/5**；Provider compensation **6/6**；全仓强制 test **20/20 tasks，0 cache**；typecheck **20/20**；build **11/11**。
- M1 六项退出标准完成最终审计；M1 full 与四组聚焦复核全绿；路线图已同步为“M2 完成、M1 dogfood 1/3”。
- Electron 1426×893 浅色和 1266×761 深色通过，无溢出、错误覆盖层或 console warning/error。
- **M2 完成**。M1 外网 18/18，但 dogfood 仍 **1/3**；总目标继续保持 active。

## 2026-07-13 · M1 真实外网、Fallback、取消、恢复与安全验收

- 完成 `14-external-gateway-handtest.md` 18/18：CC Switch 导入的 Provider / 密钥分组 / 模型可直接运行且可编辑。
- 真实 `grok-4.5`、`gpt-5.6-sol` 调用成功；Unity2.Ai Claude 无额度返回 503，按外部可用性处理。
- 真实 Fallback 从 Claude Haiku 切至 `gpt-5.5`，链位、Manifest、Trace 与唯一终态均正确。
- 真实取消持久化为 `run.cancelled`，Composer 恢复，无重复完成；记录网关批量增量限制，不虚构部分输出。
- 冷重启恢复与 11-secret / 255-file 安全扫描通过；证据导出无明文凭据。
- 边界：外网门槛已通过；dogfood **1/3**，M1 仍 open，等待真实日期累计。

## 2026-07-12 · Codex 式消息流 + 紧凑 Composer

- 助手消息改为无边框 Markdown 阅读流，支持 GFM 列表、代码、表格、引用与链接；不执行原始 HTML。
- 对话正文不再重复显示 `SYNC-THINK`、模型 UUID、Run ID；运行观测仍保留在 Trace / Manifest。
- 用户消息保留右侧紧凑气泡；Composer 移除模式、工作区、模型数量与 readiness 面板。
- Composer 左下保留分组 → 供应商 → 模型入口，右下使用图标发送 / 停止；异常时只显示一条可行动阻塞提示。
- Runtime / 任务 / 模型 blocker 现在参与真实发送门禁；异步发送失败保留原输入草稿，成功后才清空。
- Agent 默认模型显示真实 `providerModelId`（例如 `grok-4.5`），未知 UUID 不再截断展示。
- 验证：UI Kit 192、Desktop 267、根测试 20/20 tasks、typecheck 20/20、build 11/11；Electron 1425×894 与约 1266×761 实窗通过。
- 边界：**M1 仍 open**；外网手测 0/18、dogfood 0/3；不启动 M2。

## 2026-07-18 - 对话流式呈现、Agent 身份一致性与应用字号

- 空的 assistant 流式消息显示“<Agent> 正在思考...”；首个及后续 `message.delta` 直接进入同一消息正文并保留流式光标。
- 用户与 Agent 消息改为浅色边框正文框，Agent 身份、实际模型、时间和 token 元信息位于正文框外；用户时间移到正文框下方。
- 新增按任务投影主 `AgentVersion` 的纯函数，任务列表、任务头和无精确历史版本的消息使用同一头像、颜色与名称；reviewer 不覆盖主 Agent。
- 对话任务目录补齐 Agent 头像、两行摘要、参与者、项目、更新时间和状态，群聊仍保持群组身份。
- 设置 -> 外观新增 13-18px 文字大小滑块，默认 14px；偏好持久化到 localStorage，并通过排版 token 作用于对话、任务目录、设置和 Composer，不改变固定布局轨道、按钮和图标尺寸。
- 新增思考旋转的 `prefers-reduced-motion` 处理。
- 最终审查补齐群聊身份：群聊任务的目录、任务头和回退消息使用真实群组名称、图标、颜色与受管头像；有精确 AgentVersion 的成员消息仍保持不可变身份。任务摘要读取每个任务最后一条真实对话消息，不再回退为任务目标。
- 修复 Talk 身份图标缺少 `brain/image`、群组头像路径未加载，以及 Agent/群组头像并发加载互相覆盖；Composer 字号和最终动画规则也统一使用用户偏好与 reduced-motion。
- 验证：Desktop `62 files / 410 tests`、UI Kit `21 files / 236 tests`；全仓强制 test `21/21`、typecheck `21/21`、build `12/12`，Prettier 与 `git diff --check` 通过。

## 2026-07-16 — Multica 参考的新人桌面工作区

- 左栏由图标工具条升级为带文字的产品导航：任务、智能体、模型源、审批；记忆保留为次级入口。
- 任务区新增明确 `新建任务`，本地文件夹与嵌套任务行为不变。
- 任务头新增负责 Agent 和运行模型；Context 槽收敛为单一 `下一步`。
- 右栏默认显示用户可理解的任务进度、负责人和产物；原 Trace/Manifest/执行图/审批/版本工具进入 `执行详情`。
- 健康对话移除常驻 readiness 仪表，异常仅显示紧凑恢复条。
- 全新用户/空任务状态改为三步上手，不再暴露 Runtime 检查清单。
- `AppShell` 新增兼容的 `traceTitle` / `traceAriaLabel`，`WorkspaceNav` 新增兼容的 `hideBrand`；默认行为不变。
- 验证：Desktop 334、UI Kit 216、root test/typecheck/build 全绿；1427×894、1366×768、1280×720 Electron QA 通过。

## 2026-07-12 · soft #65 · Provider 可编辑 + CC Switch 导入

- `provider.update`：名称 / baseUrl / 协议 / 发现开关 / 标签；可选 apiKey 轮换。
- `provider.previewCcSwitchImport` + `provider.importCcSwitch`：本机 CC Switch SQLite 预览→确认；密钥入 secure store；TD-009 合规。
- UI：Providers 面板「编辑」「从 CC Switch 导入」。
- M1 仍 open（外网手测 0/18 + dogfood 0/3）。

## 2026-07-12 · soft #64 · Codex 式左栏工具抽屉 + Provider 错误中文化

- Desktop 左栏：常驻工作区/任务树，四工具改为 Lucide 图标工具条，底部固定紧凑 Runtime 状态。
- 工具详情：Provider / Agent / 记忆 / 审批共用覆盖式 dialog 抽屉；支持 toggle/replace/Esc/backdrop/close/jump-open。
- UI Kit：`WorkspaceNav` 新增兼容默认行为的 `hideFooter`；AppShell nav 改为内部滚动所有权与明确 stacking context。
- CSS：抽屉 `clamp(336px, 28vw, 420px)`，不改变 Locked 三栏 grid；移除永久仪器卡片与多重滚动。
- Provider UX：新增 `provider-error-copy.ts`，把 fetch/timeout/auth/rate-limit/non-JSON/404 转为可行动中文。
- 现场诊断：`www.kamenking.top` DNS 不可解析，发现请求未到达网关；需确认真实域名及 Base URL 是否包含 `/v1`。
- 测试：Desktop 261、UI Kit 177、根级 715 tests、typecheck、build、M1 quick soft 通过。
- 边界：**M1 仍 open**；外网手测 0/18、dogfood 0/3；不启动 M2。

## 2026-07-12 · soft #63 · Codex 式主工作台减负 + Runtime replay 修复

- `m1-obs-layout`：新增 product workspace disclosure 语义；中心验证工作台默认折叠、跳转自动展开、展开体限高滚动。
- Desktop：产品态启用 `hideReadiness`，去除 Workspace/AppShell/Mode/Continuum/Manifest/Trace 重复自检块；业务内容与 Locked 三栏 IA 保留。
- ui-kit：`WorkspaceNav` 新增已测试的 `hideReadiness`。
- Runtime：`appendEvent` 在持久模式走 `SqliteEventCheckpointStore.commitTransition`，统一全事件序列来源，修复 replay 重复/逆序导致的 `runtime.protocol-error`。
- Storage：`listTasks` 同时间排序 tie-break 从随机 ULID 改为插入 `rowid`。
- 测试：根级 707 tests、typecheck、build、M1 quick soft、Electron 真实截图全部通过。
- 边界：**M1 仍 open**；外网手测 0/18、dogfood 0/3；不启动 M2。

## 2026-07-12 · soft #61+#62 · 硬门槛条 + 左侧仪器切换 + Skill 导入 UX

- 新增 `apps/desktop/src/renderer/m1-hardgate-strip.ts` + `tests/m1-hardgate-strip.test.ts`
- 新增 `apps/desktop/src/renderer/left-instrument-switch.ts` + `tests/left-instrument-switch.test.ts`
- `index.tsx`：主路径顶部硬门槛条；左侧 tab 切换；Skill import preflight 中文错误
- `AgentBindingPanel`：填入示例 · 错误贴近导入区 · 失败保留草稿
- CSS：左侧单面板布局 · hardgate 条 · import error 高亮
- soft full GREEN · Electron PID 17820 · **M1 仍 open**

## 2026-07-12 · soft #60 · M1 观测布局减负（主路径轨）

- 新增 `apps/desktop/src/renderer/m1-obs-layout.ts` + `tests/m1-obs-layout.test.ts`
- `index.tsx`：主路径轨（下一步 / 外网聚焦 / 退出路径）置顶；次要 soft 观测默认折叠于 `m1-obs-secondary`
- flash 次要面板时自动展开；CSS `.st-demo-m1-rail` / `.st-demo-m1-more`
- softCraftRound **60** · soft full GREEN · Electron PID 61620
- 仍不关 M1、不开 M2

## 2026-07-12 · soft craft #59 · 外网聚焦贯通 next / exit / evidence（M1 仍 open）

- next-action：`buildExternalHandtestAction` · CTA `focus-external` / `jump-external-item` / `copy-external-runsheet` · 跳转含 compose
- exit-path：步骤 `external-focus-assist`（kind `external-focus`）在外网逐项前
- evidence-bundle：可选 `externalFocusMarkdown` · TOC「外网聚焦运行单」· 摘要「含外网聚焦」
- UI：主条/路径金色高亮 · softCraftRound **59** · Electron PID 14100
- 测试：next 17 · exit 15 · evidence 11 · soft full GREEN
- **不关 M1 · 不开 M2**

## 2026-07-12 · soft craft #58 · 手测「下一外网项」聚焦条

- 新增 `m1-external-focus.ts`：按清单顺序聚焦首个外网待证项 + 队列 + 外网运行单粘贴
- UI：`m1-external-focus` 聚焦条（跳面板 / 开文档 / 复制运行单 / 筛选外网）
- softCraftRound **58**；单测 9/9；soft full GREEN
- **不** 关 M1；**不** 启动 M2

## 2026-07-12 · soft #57 · 下一步合入 dogfood 补填板

- `m1-next-action.ts`：fill 输入；`buildWriteDogfoodAction`；CTA `open-dogfood-fill` / `copy-dogfood-fill`；`isM1NextDogfoodFillAction`
- `index.tsx`：接线 + handler 闪补填板；`data-cta-action` / `data-fill-level`；softCraftRound → **57**
- CSS：补填类下一步蓝色边
- 单测 14 项；**不关 M1**

## 2026-07-12 · soft #56 · 退出路径合入 dogfood 补填板

- `m1-exit-path.ts`：输入 fill 信号；硬步 `dogfood-fill-assist`（kind `dogfood-fill`）；CTA `open-dogfood-fill` / `copy-dogfood-fill`
- `index.tsx`：board + 两处 paste + 证据包路径 + 点击处理；softCraftRound → **56**
- CSS：补填步蓝色高亮
- 单测 11 项；**不关 M1**；草稿仍不计有效日

## 2026-07-12 · soft #55 · 证据包并入 dogfood 多日补填

- `formatM1EvidenceBundle` 可选 `dogfoodFillMarkdown`；TOC 新增 `dogfood-fill`
- 导出自动合入多日补填板；摘要「含补填/无补填」；preview 可附补填
- 单测扩展；softCraftRound → **55**
- **不关 M1**；草稿仍不计有效日

## 2026-07-12 · soft #54 · dogfood 多日补填板

- 新增 `apps/desktop/src/renderer/m1-dogfood-fill-board.ts`：多日窗口缺文件、scaffold/draft/real 分级、主 CTA、粘贴板、密钥 scrub
- UI：M1 退出区「dogfood 补填」卡（chips + 主按钮 + 可点行 + 复制多日补填）
- 单测 9 项；softCraftRound → **54**；soft pack 纳入 fill-board
- **不关 M1**；不把粘贴草稿算有效日

## 2026-07-12 · soft craft #53 · 本机领先差异可点跳 + 退出路径合入

- **范围**：M1 硬门槛辅助（不关 M1）
- **改动**：
  - `m1-handtest-doc-diff.ts`：行级 CTA（打开文档 / 跳转 / 双动作）、主行动 `primaryCta`、`planM1HandtestDocDiffCta`
  - `m1-exit-path.ts`：输入 `liveAheadCount`/`docAheadCount` → 步骤 `doc-live-ahead`
  - UI：差异主按钮 + 可点差异行 + 高亮手测清单项；CSS 简洁 CTA
  - softCraftRound **53**
- **测试**：doc-diff 6/6 · exit-path 7/7 · soft full GREEN · dual 4/4 · tsc/build 通过
- **边界**：不自动勾文档 · 不写 dogfood · claimsM1Closed=false · 勿启 M2

## 2026-07-12 · soft craft #52 · 证据包并入文档↔本机差异

- `m1-evidence-bundle.ts`：可选 `docDiffMarkdown` · TOC `doc-diff` · 导出含「## 文档↔本机差异」
- 一键导出自动合入 `formatM1HandtestDocDiffPaste`（#51）
- 单测 **9/9**（含无差异 / 无路径 / 无草稿边界）
- 不变量：`claimsM1Closed=false` · 无密钥 · 不自动勾手测 · 不写 dogfood · 不关 M1 · 不启 M2

## 2026-07-12 · soft craft #51 · 文档↔本机差异板

- 新增 `apps/desktop/src/renderer/m1-handtest-doc-diff.ts`：`projectM1HandtestDocDiff` / attention 列表 / 粘贴稿 / secret-free
- 单测 `tests/m1-handtest-doc-diff.test.ts` **3/3**
- UI：手测对照上方差异板（本机领先/文档领先/外网待证/对齐）+ **复制文档差异**
- soft catalog suite `handtest-doc-diff`；runner softCraftRound=51
- 不变量：只读 · 不自动勾 · 无密钥 · 不写 dogfood · 不关 M1 · 不启 M2

## 2026-07-12 · soft craft #50 · 手测文档逐项勾选徽章

- 新增 `apps/desktop/src/m1-handtest-doc-parse.ts`：`parseHandtestDocMarkdown` / `mapHandtestDocBoxesToItems` / secret-free 检查
- 单测 `tests/m1-handtest-doc-parse.test.ts` **5/5**
- Main IPC `desktop:m1-exit-evidence` 成功路径返回 `handtestBoxes`（修 TS6133 未使用变量）
- Preload + `global.d.ts` + 渲染层：徽章 **文档✓ / 文档□ / 文档—**（`data-doc-checked`）
- soft 回归 catalog suite `handtest-doc-parse`；runner softCraftRound=50
- 不变量：只读文档 · 不自动勾 · 无密钥 · 不写 dogfood · 不关 M1 · 不启 M2

## 2026-07-12 · soft craft #49 · 证据包并入退出路径

- `m1-evidence-bundle.ts`：可选 `exitPathMarkdown` · TOC `exit-path` · 导出含「## 退出路径」
- 一键导出自动合入 `formatM1ExitPathPaste`（#48）
- 单测 **8/8**（含无路径 / 无草稿边界）
- 不变量：`claimsM1Closed=false` · 无密钥 · 不自动勾手测 · 不写 dogfood · 不关 M1 · 不启 M2

## 2026-07-12 · soft craft #48 · M1 退出路径板

- 新增 `apps/desktop/src/renderer/m1-exit-path.ts`：`projectM1ExitPath` / `formatM1ExitPathPaste` / `isM1ExitPathStepActionable` / `exitPathLooksSecretFree`
- 单测 `tests/m1-exit-path.test.ts` **6/6**
- UI：退出路径卡（手测对照上方）· 顶栏「复制退出路径」· 步骤 CTA（开文档 / 复制草稿与证据包 / 跳转 Providers·Agent·Compose）
- soft 回归 catalog 增加 suite `exit-path`
- `navigateToInstrument` 支持 `compose`（聚焦输入 · 不自动发送）
- 不变量：`claimsM1Closed=false` · 进度 ≤99% · 无密钥 · 不自动勾手测 · 不写 dogfood · 不关 M1 · 不启 M2

## 2026-07-12 · soft craft #47 · M1 证据包一键导出

- 新增 `apps/desktop/src/renderer/m1-evidence-bundle.ts`：`formatM1EvidenceBundle` / `projectM1EvidenceBundlePreview` / `M1_EVIDENCE_BUNDLE_SECTIONS`
- 退出证据区证据包卡 + 「导出证据包」/「一键导出」；手测区快捷「证据包」
- 永远 `claimsM1Closed=false`；不含密钥；不自动勾手测/不写 dogfood/不关 M1
- 单测 `tests/m1-evidence-bundle.test.ts` 7/7；回归 catalog 登记 evidence-bundle

## 2026-07-12 · soft craft #46 · soft 回归筛选 + 行跳转

- `filterM1SoftRegressionRows` / `countM1SoftRegressionFilter`：全部/缺口/外网/auto红
- `resolveM1SoftRegressionRowAction`：打开手测/dogfood、跳转 Providers/Agent/轨迹、重连、复制矩阵
- UI：筛选芯片 + 可点行 CTA；`data-filter` / `data-action`
- 单测 8/8；**不**关 M1、**不**自动勾手测、**不**启动 M2

## 2026-07-12 · soft craft #45 · M1 soft 回归矩阵（自动 vs 手测）

- 新增 `apps/desktop/src/renderer/m1-soft-regression.ts`：纯函数矩阵 + markdown 导出 + 密钥 scrub
- UI：退出证据区紧凑回归板 + 复制按钮；手测区「回归矩阵」入口
- 脚本：`scripts/selftest-m1-soft-regression.mjs`；根脚本 `selftest:m1-soft` / `selftest:m1-soft:quick`
- 单测：`tests/m1-soft-regression.test.ts`（6）
- **不**关 M1、**不**自动勾手测、**不**启动 M2

## 2026-07-12 · soft #44 · 生成失败恢复 CTA

- `classifyStreamFailure` / `scrubFailureText`：失败类别中文 + 密钥打码
- 会话就绪条失败恢复按钮：Providers / Fallback / 轨迹 / 诊断 / 聚焦 Compose
- 可观测：`conversation-stream-failure` · `data-failure-kind` · `data-cta-action`
- 测试：stream readiness **18/18**；dual **4/4**
- **不**关闭 M1 · **不**启动 M2 · **不**自动重发

## 2026-07-12 · soft #43 · dogfood 计分加固

- 新增 `apps/desktop/src/m1-dogfood-score.ts`：粘贴草稿 / 待你确认 不计有效 dogfood 日
- 退出证据按日板：`草稿` 态 + 计分原因 + `data-draft-count`
- 主进程 `listDogfoodDayReports` 带回 `isPasteAssist` / `reasons` / `statusHint`
- 测试：`m1-dogfood-score.test.ts` 等 39 项相关通过；dual 4/4
- **不**关闭 M1 · **不**启动 M2

## 2026-07-12 · soft #42 · 复制 dogfood 日记草稿

- 渲染：`formatM1DogfoodDayDraft` + 退出证据/手测「复制 dogfood 草稿」
- 测试：dogfood-draft 4；dual 4/4
- **不自动写盘 · 不算有效日 · M1 仍 open · 未启动 M2**

## 2026-07-12 · soft #41 · 手测进度粘贴稿 + 外网/缺口筛选

- 渲染：`formatM1HandtestPaste` / 筛选全部·缺口·外网 / 复制手测进度按钮
- 测试：handtest-paste 4；dual 4/4
- **M1 仍 open** · **未启动 M2**

## 2026-07-12 · soft #40 · dogfood 按日打开 + 手测分区进度

- 主进程：`dogfood-day` 白名单 + `isValidDogfoodDayDate` + 路径约束
- 渲染：退出证据 dogfood 行可点打开；手测对照分区板（pre/A/B/C/D）
- 测试：open-doc 7 · section-board 3；dual 4/4
- **M1 仍 open** · **未启动 M2**

## 2026-07-12 · soft · dogfood 按日明细 + 聚焦刷新（#39）

- 主进程 listDogfoodDayReports；IPC 返回 dogfoodDays
- 退出证据 UI 按日 有效/脚手架
- 窗口 focus/visible 自动重读手测与 dogfood
- 测试：exit 11/11 · load 3/3 · dual 4/4
- **不**关闭 M1 / **不**启动 M2

## 2026-07-12 · soft · 复制 soft 快照（#38）

- `formatM1SoftSnapshot` 生成可贴 Markdown（无密钥、不关 M1）
- 退出证据 / 手测对照：复制 soft 快照按钮 + 反馈条
- 测试：snapshot 4/4 · dual 4/4
- **不**关闭 M1 / **不**启动 M2

## 2026-07-12 · soft · 退出证据芯片可行动 + 打开反馈（#37）

- 退出证据芯片：handtest/dogfood 打开文档；soft/dual 刷新
- 打开结果反馈条（ok/warn/error + basename）
- 手测对照头：打开手测文档 / 今日 dogfood
- 测试：chip-action 7/7 · M1 套件 37 · dual 4/4
- **不**关闭 M1 / **不**启动 M2

## 2026-07-12 · soft · 「下一步」主 CTA 可行动（#36）

- offline → 重新连接 Runtime
- 外网手测 → 系统打开 14-external-gateway-handtest.md
- dogfood → 打开/创建今日日记
- 主进程白名单 IPC，禁止任意路径
- 测试：next 10/10 · open-doc 4/4 · dual 4/4
- **不**关闭 M1 / **不**启动 M2

## 2026-07-12 · soft · Runtime 手动重连 CTA（#35）

- 对话流就绪条 / 空对话：离线时「重新连接 Runtime」
- 记录 `lastConnectFailure`（code + retryable）并投影中文提示
- 事件监听与 connect 生命周期拆分，避免重连丢订阅
- 测试：stream 9/9 · runtime 5/5 · dual 4/4
- **不**关闭 M1 / **不**启动 M2

## 2026-07-12 · soft · M1「下一步」主行动条

- 新增 `apps/desktop/src/renderer/m1-next-action.ts`：`projectM1NextAction` / `isM1NextActionJumpable`
- 任务头 CTA：`m1-next-action`（soft/hard 分闸 + 跳转或刷新）
- 测试 **9/9**；dual **4/4**；**不关 M1**

## 2026-07-12 · soft · 手测项点击跳转面板

- `resolveM1HandtestItemJump` / `isM1HandtestItemJumpable`；投影项带 jumpTarget
- 手测列表可点行 → `navigateToInstrument` 闪烁对应面板
- 测试 8/8；dual 4/4；**不关 M1**

## 2026-07-12 · soft · 手测对照清单 live 投影

- 新增 `apps/desktop/src/renderer/m1-handtest-checklist.ts`：`M1_HANDTEST_ITEMS`（18）+ `projectM1HandtestChecklist`
- 任务头 UI：`m1-handtest-checklist` 列表 + `m1-known-limits` 已知限制；本机/外网闸门分色
- 测试：`tests/m1-handtest-checklist.test.ts` **5/5**；dual **4/4**
- 边界：soft 可观测；**不关 M1 / 不开 M2**；文档勾选仍需人手

## 2026-07-12 · soft · M1 退出证据进度条

- 新增 `projectM1ExitEvidenceProgress` / IPC `desktop:m1-exit-evidence`（只读 docs handtest + dogfood）
- 任务头「退出证据」：soft / dual / 手测 x/y / dogfood n/3 + 刷新
- 单测 8/8；dual 4/4；**不关 M1**

## 2026-07-12 · soft · 会话芯片跨面板跳转

- `resolveM1SessionChipJump` / `isM1SessionChipJumpable`；芯片附 `jumpTarget`/`jumpHint`
- 可跳芯片按钮：`m1-session-chip-jump-*` → scroll + `data-nav-flash`；Manifest/轨迹会先展开轨迹栏
- 单测 7/7；dual 4/4；**不关 M1**

## 2026-07-12 · soft · 会话就绪 Memory 芯片

- `projectM1SessionReadiness` 增加 memory 字段与芯片；ready 要求 memoryOk
- desktop 会话条接线 memoryEntries/changes/diagnostics
- dual 网关复测 4/4；**不关 M1**

## 2026-07-12 · soft · Memory/Diagnostics 就绪纯投影

- 新增 `projectMemoryDiagnosticsReadiness` / `MemoryDiagnosticsReadiness*`
- Memory 就绪条统一投影；根节点 data-level；12/12 测；**不关 M1**

## 2026-07-12 · soft · 批准中心闸门就绪纯投影

- 新增导出：`projectApprovalGateReadiness` / `ApprovalGateReadiness*`（`ApprovalCenterPanel.tsx`）
- 批准闸门条统一投影；根节点 data-level；单测 13/13；**不关 M1**

## 2026-07-12 · soft · Agent 能力就绪纯投影

- 新增导出：`projectAgentCapabilityReadiness` / `AgentCapabilityReadiness*`（`packages/ui-kit/src/components/AgentBindingPanel.tsx`）
- Agent 能力就绪条改为统一投影；根节点 `data-testid="agent-binding-panel"` + `data-level`
- 单测 27/27；**不关 M1**

## 2026-07-12 · Compose 发送就绪纯投影（M1 soft）

- `packages/ui-kit/src/components/Compose.tsx`：`projectComposeSendReadiness` + form data-level
- 测试：`Compose.test.tsx` projector 套件
- 边界：soft craft，**不关 M1 / 不开 M2**

## 2026-07-12 · Providers 多模型就绪纯投影（M1 soft）

- `packages/ui-kit/src/components/ProvidersPanel.tsx`：`projectProvidersReadiness` + badge/note/data-level
- 测试：`ProvidersPanel.test.tsx` projector 套件；dual 网关 4/4 复测
- 边界：soft craft，**不关 M1 / 不开 M2**；外网手测与 dogfood 仍缺

## 2026-07-12 · WorkspaceNav 工作区导航就绪投影（M1 soft）

- `packages/ui-kit/src/components/WorkspaceNav.tsx`：`projectWorkspaceNavReadiness` + 6-check 就绪条 + filtering 档
- `packages/ui-kit/src/styles/components.css`：partial/filtering 色边
- 测试：`packages/ui-kit/tests/WorkspaceNav.test.tsx`
- 边界：soft craft，**不关 M1 / 不开 M2**

## 2026-07-12 · AppShell 工作区布局就绪条（M1 soft）

- `packages/ui-kit/src/components/AppShell.tsx`：`projectAppShellReadiness` + 就绪条 UI；`hideReadiness`；`data-level`
- `packages/ui-kit/src/styles/components.css`：`st-app-shell__readiness*` 含折叠 compact 竖排
- 测试：`packages/ui-kit/tests/AppShell.test.tsx` readiness 套件
- 边界：soft craft，**不关 M1 / 不开 M2**

## 2026-07-12 · 对话流 empty/stream 统一可观测（soft · M1 open）

## 2026-07-12 · 参与模式就绪条（soft · M1 仍 open）

- soft craft：`projectModeReadiness` + `mode-switch-readiness`；四档 m1/mixed/m2-open/locked
- 自测：ModeSwitch 10/10；dual 4/4；builds GREEN
- 下一优先：外网网关 UI 手测 / dogfood；**勿关 M1、勿开 M2**

## 2026-07-12 · Manifest 可检查就绪条（soft · M1 仍 open）

- soft craft：`projectManifestReadiness` + `manifest-readiness` 八项 checks；amended/inspectable 分档
- 自测：ManifestPanel 22/22；builds GREEN
- 下一优先：外网网关 UI 手测 / dogfood；**勿关 M1、勿开 M2**

- desktop：`conversation-stream-readiness.ts` 纯投影
- 对话列 stream 条 + 空对话卡片同源；六项 checks；Run 摘要中文状态
- 样式：`st-conversation-readiness*`

## 2026-07-12 · ContinuumRail 连续体就绪条（soft · M1 open）

- ui-kit：`ContinuumRail` 增加 `projectContinuumReadiness` 与就绪条（空/结构位/绑定/有证据/流式）
- desktop：无任务真 empty；有任务 scaffoldOnly 结构位；接 streaming
- 样式：`st-continuum__readiness*`

## 2026-07-12 · AppShell 运行轨迹中文 + 工作区结构条（soft · M1 open）

## 2026-07-12 · TraceList 运行轨迹就绪条（soft · M1 open）

- ui-kit：`TraceList` 增加 `projectTraceReadiness` 与就绪条（空/部分/有轨迹/流式）
- desktop：去掉伪 waiting 轨迹条目，接 `hasActiveTask` / `streaming` / 真 empty
- 样式：`st-trace__readiness*` 对齐其它 M1 就绪条

## 2026-07-12 · 第 16 次 soft craft · Compose 发送就绪条 + dual 网关复测

### Compose 发送就绪条

- 发送区 soft 可观测：模型/绑定来源/Runtime/任务/跨 Provider/输入
- desktop 接线 connectionState / hasActiveTask / agentDefaultSet
- dual 网关自动化复测通过（仍非外网 UI 证据）

## 2026-07-12 · 第 15 次 soft craft · 会话就绪条接入 Agent/审批

### 会话就绪条 · Agent / 审批

- `projectM1SessionReadiness` 增加 agent / approval chips 与 soft ready 条件
- desktop 任务头接线：`agentBinding` + `approvalPendingCount`

## 2026-07-12 · 第 14 次 soft craft · Agent 能力就绪条

### Agent 能力就绪条（UI 可观测）

- `AgentBindingPanel`：顶部 readiness strip（模型 / fallback / 凭证 / Skill / MCP / dirty）
- 样式：与 Approval/Memory readiness 统一，Agent 六项三列
- 测试：empty / partial / ready + dirty 翻转

### 非目标本轮

- 未关 M1；未开 M2；未做外网网关证据

- AppShell：运行轨迹中文 + 折叠不暂停提示
- WorkspaceNav：§15.2 工作区结构就绪条 + Runtime 中文连接态
- **M1 仍 open**

## 2026-07-12 · 批准中心 + Memory 闸门就绪条（soft · M1 open）

- UI：ApprovalCenterPanel / MemoryDiagnosticsPanel 增加与 Providers 同风格的中文就绪条与空态卡片
- 可观测：仅限真人闸、待审 attention、MemoryChange 链路说明、§23.2 已知限制计数
- 测试：Approval 6/6、Memory 6/6；desktop rebuild + Electron 重启
- **M1 仍 open**（外网手测 + dogfood 未完成）

## 2026-07-12 · 任务头 M1 会话就绪条（M1 soft）

- Continuum 下全局「会话就绪」芯片条（对齐 Providers soft 门槛）
- `m1-session-readiness.ts` 纯投影 + 单元测试
- 连接状态「已连接 · 持久事件流」
- **不关 M1**；**不进 M2**

## 2026-07-12 · Providers 多模型就绪条（M1 soft）

- Providers 顶部「多模型就绪」：≥2 Provider / ≥3 模型 / 密钥遮罩 / 协议种类
- 中文计数与 discovery meta；soft 门槛文案与「不关 M1」说明
- 测试：ProvidersPanel 6/6
- **不关 M1**；**不进 M2**

## 2026-07-12 · Compose/消息气泡中文可观测（M1 soft）

- Compose 默认占位与 a11y 中文化；取消流式 aria 中文化
- MessageBubble 流式/角色中文 aria；desktop meta「流式中」
- 测试：Compose 18 / MessageBubble 4
- **不关 M1**；**不进 M2**

## 2026-07-12 · Manifest 解析阶梯（M1 soft）

- **UI** Manifest 详情：解析阶梯与 §5.3 绑定优先级对齐；Fallback 链位可观测
- **文案** 凭证解析中文化；`agentFallback` → Fallback
- **修复** 补 `credentialResolutionLabel`（此前引用未定义会编译失败）
- **测试** ManifestPanel 15/15
- **范围** soft craft；不关闭 M1；不启动 M2

## 2026-07-12 · Agent 绑定优先级可观测（§5.3）

- Agent 面板顶部 precedence ladder：本轮覆盖 / 工作流(M2) / Agent 默认 / Fallback
- 与 Compose 本轮覆盖语义对齐，便于 M1 退出标准 #2 界面举证
- **M1 仍 open**

## 2026-07-12 · Continuum/Mode 中文可观测 + dogfood 脚手架

- ContinuumRail 中文 kind + empty；ModeSwitch 中文标签 + M1 禁用协作/自动
- desktop 任务头挂 ModeSwitch；线程标签中文化
- dogfood/2026-07-12.md 脚手架
- **M1 仍 open**

## 2026-07-12 · Compose 多模型 chips + Trace 中文标签

- Compose：compose-model-chips 快速切换本轮模型；摘要「本轮覆盖 / Agent 默认」；agentFallbackCount / multiProvider 可观测
- TraceList：类别中文（模型调用 / 恢复 / …），data-category 仍为英文
- desktop：绑定 fallback 数量与跨 Provider 提示；会话条中文化
- 测试：Compose 17 · TraceList 2 · builds GREEN
- **M1 仍 open**（无外网 UI 手测 / dogfood 证据不关闭）

## 2026-07-12 · Diagnostics 可行动恢复 + 已知限制（§23.2 #9/#12）

- 新增 `packages/ui-kit/src/diagnostics/recovery.ts`：failureClass → 中文标签 / 是否可重试 / 恢复步骤 / 建议跳转
- MemoryDiagnosticsPanel：诊断可展开恢复指南；固定「已知限制」区（协议、能力启发式、MCP 发现≠执行、密钥、M1 退出）
- ProvidersPanel：顶部协议与 Provider 限制说明
- desktop：诊断「前往」滚动到对应左栏并短暂高亮
- 门禁脚本：`scripts/selftest-dual-gateway.mjs`
- **M1 仍 open**（无外网 UI 手测 / dogfood 证据不关闭）

## 2026-07-12 · Provider 协议持久化 + 发现失败 Diagnostics（M1 soft）

- DB：`provider.protocol` + migration `0007_provider_protocol`
- 发现：按持久化协议路由；响应带 protocol / addedIds / previousModelCount
- 失败：scrubbed diagnostics + UI 刷新可观测
- UI：协议徽章；发现状态条增强
- 测试：storage 69 · provider-commands 5 · ProvidersPanel 4 · desktop build GREEN
- M1 仍 open（外网手测 / dogfood）

## 本轮进度：2026-07-12 · MCP 刷新目录可观测 + 自测闭环

- UI：MCP 工具名 chips + 空目录提示
- 测试：refresh 后 peek tool-schema；AgentBinding 14 条
- 文档：新增固定大白话自测 `13-plain-selftest-log.md`
- M1 仍 open

## 本轮进度：2026-07-12 · MCP tools/list 刷新目录（§9.3 discovery · soft）

### 变更

- **新增** `mcp.tools.refresh`：local-stdio 真 JSON-RPC `tools/list` 发现工具 Schema 并写入 MCP 注册表
- **新增** workers `list-tools` action + `extractToolsList`（限幅 / untrusted / 审计 · 不执行工具）
- **事件** `mcp.tools_refreshed`（catalog delta：added/removed）
- **UI** AgentBindingPanel「刷新工具目录」+ Desktop 状态条可观测
- **desktop** IPC/preload/renderer 贯通；修复 renderer 类型导入使 build GREEN
- **测试** runtime mcp-commands 增至 7 条；ui-kit AgentBinding 13 条

### 不在本切片

- 外网网关手测、dogfood ≥3 天、M2 工作流图
- 刷新后自动改 Agent 白名单（**禁止**静默 allowlist）

## 本轮进度：2026-07-12 · MCP JSON-RPC 真工具调用（§9.3/§13/§14）

### 变更

- **新增** `mcp.tool.call`：白名单 + 敏感闸 + 审批后真 JSON-RPC tools/call（非模拟）
- **新增** workers `jsonrpc-stdio` 帧编解码 + mini-mcp fixture（echo/ping/write_file）
- **扩展** `approval.decide` 响应可选 `mcpToolCall`（execute-on-approve）
- **UI** AgentBindingPanel「真工具调用」；renderer 状态条与审批结果可观测
- **测试** runtime 2 条 e2e（allowlist 拒绝 / 入队批准执行 / trusted auto ping / fake 拒绝）

### 不在本切片

- 外网网关手测、dogfood、多 Agent 工作流图（M2）

### 2026-07-12 · MCP 真 spawn 探测骨架（soft，M1 仍 open）

- 新增 `LocalStdioMcpWorker`：local-stdio 真进程探测（超时/限幅/untrusted/审计）
- 新增命令 `mcp.spawn.probe` / 事件 `mcp.spawn_probed`
- Desktop UI：Agent「真 spawn 探测」+ 可观测状态条
- 路径边界：`mcp.policy.probe` 仍模拟；`mcp.tool.request` 仍只入审批队

## 2026-07-12 · Skill 批准后自动白名单绑定（§9.1 / §9.3 → §13）

- soft：`approval.decide` 对 skill-permission 批准 → 默认 Agent skillVersionIds 自动绑定
- 导入仍不白名单；拒绝不绑定；可替换 previousSkillVersionId
- 响应 `skillAllowlist`；UI 状态条「已写入 Skill 白名单」+ 刷新 Agent
- 测试：runtime skill-commands 2 · approval 5 · desktop rebuild
- **不关闭 M1**

## 2026-07-12 · MCP 敏感工具调用 → 审批中心入队（§9.3 → §13）

- soft：`mcp.tool.request` 敏感度闸门 + enqueue kind=`mcp-permission`（永不 spawn）
- core：`evaluateMcpToolSensitivity`；trusted 低风险可 auto-approve 不入队
- UI：Agent 模拟工具名 +「请求工具审批」；审批中心「MCP 权限」；状态条中文
- 测试：core 5 / runtime mcp-commands 3 · approval 5 / ui-kit 10 / desktop rebuild
- **不关闭 M1**

## 2026-07-12 · Memory → 审批中心双向桥接（§10.4 → §13）

- soft：pending `memory.propose` enqueue Approval Center（kind=`memory`）
- 双向镜像：`approval.decide` ↔ `memory.decide`（metadata.memoryChangeId）
- 响应 `approvalRequest`；autoApprove 不入队
- UI：Memory/审批状态条中文 + 事件双向刷新
- 测试：runtime memory-commands 4 · approval-commands 5 · desktop rebuild
- **不关闭 M1**

## 2026-07-12 · Skill 升级自动入队审批中心（§9.3 → §13）

- soft：`skill.import` 在 permissionDiff.requiresReapproval 时 enqueue `skill-permission`
- 响应 `reapprovalRequest`；事件 `approval.requested`；UI 状态条 + 审批中心刷新
- 导入仍不自动白名单；人批队列可观测
- 测试：runtime skill-commands 2 · approval-commands 5 · desktop rebuild
- **不关闭 M1**

## 2026-07-12 · 审批中心骨架（§13 / §15.1-8）

- soft：approval-policy + approval_request 持久化 + runtime 四命令 + ApprovalCenterPanel
- 模式 request|delegate|full|custom；human-only 不可被 delegate/full 绕过
- UI 左栏可观测：策略试算、演示入队、待审批准/拒绝、状态条大白话
- 测试：core 12 / storage approval 4 + migrate 11 / runtime approval-commands 5 / ui-kit 4
- **不关闭 M1**

## 2026-07-12 · Skill 升级权限 diff / 需重新批准（§9.3）

- soft：`diffSkillPermissions` + `skill.import.permissionDiff`
- 同名升级新增 tools/scripts → requiresReapproval；首次导入不强制
- UI 状态条可观测「需重新批准」；导入仍不自动白名单
- 测试：core 69 / storage skill 4 / runtime skill-commands 2 / ui-kit AgentBinding 9
- **不关闭 M1**

## 2026-07-12 · MCP 进程策略探测骨架（§9.3）

- soft：`mcp.policy.probe` + FakeMcpWorker；输出限幅 / 超时 / untrusted / 审计 note
- storage 钳位与 workers policy 对齐（256B～1MB，100ms～120s）
- UI：超时/输出上限字段 +「探测策略」可观测状态条（不 spawn）
- 测试：storage 62 / workers 18 / runtime mcp-commands 2 / ui-kit AgentBinding 9；相关 build/typecheck GREEN
- **不关闭 M1**

## 2026-07-12 · MCP 授权骨架（§9.3）

- soft：`mcp.register` / `mcp.list` + Agent `mcpServerIds` allowlist；登记不 spawn
- Context Packet 注入 `tool-schema`；Manifest 可观测「mcp N · 入包 M」
- 测试：storage 61 / core 64 / ui-kit 62 / desktop 69；mcp-commands PASS
- **不关闭 M1**

## 2026-07-12 · Skill 正文注入 Context Packet

- soft：allowlist Skill 以 `skill-definition` 进入 Context Packet / peek
- Manifest 可观测「入包 N」；清空白名单后不再注入
- 测试：core 59 / runtime 57 / ui-kit 58
- **不关闭 M1**

## 2026-07-12 · Skill 导入 + Agent 白名单

- soft：`skill.import` / `skill.list` + Agent `skillVersionIds` allowlist；导入不执行脚本；Manifest peek 可观测

## 2026-07-12 · UI 偏好记忆（§15.2）

- desktop：theme / 轨迹折叠 / 对话布局 localStorage 持久化
- AppShell 受控折叠写回偏好；折叠不暂停 Run
- 测试：ui-kit 55 / desktop 69；build GREEN
- **不关闭 M1**

## 2026-07-12 · 单列对话布局（Locked IA §28）

- ui-kit：`MessageBubble.layout` + 单列阅读样式（全宽、角色左侧描边）
- desktop：任务头「分栏 / 单列」开关；localStorage 记忆偏好
- 测试：ui-kit 54 / desktop 64；build GREEN
- **不关闭 M1**

## 2026-07-12 · Manifest 版本可观测（§10.3）

- protocol：peek 响应增加 agentVersion / skillVersionIds / policyId
- runtime：`resolveAgentManifestMeta`；prepare/peek/packet.built/fallback 贯通；修复 amend tsc
- ui-kit / desktop：Manifest proof 展示版本；投影与 re-peek 映射
- 测试：runtime 56 / ui-kit 51 / desktop 64 / core 47；相关 build GREEN
- **不关闭 M1**

## 2026-07-12 · context.packet.amend

- Manifest 可修订：强制排除非受保护上下文来源（§10.3）
- 受保护来源（§20.9）拒绝排除并回报 refusedProtectedIds
- peek / 下次 Run / fallback 的 selection 均应用 thread 修订
- UI：排除按钮、受保护 chip、修订状态条、恢复自动

相关：`docs/development/12-test-log.md` 同日条目；M1 仍 open。

## 2026-07-12 · context.packet.peek

- 只读预览下一次 Context Packet / Manifest（无需发消息、不写 durable 事件）
- Manifest 面板「预览上下文」按钮；desktop IPC 全链路
- 与 §10.4 回滚联动：approve → peek 含项目记忆；rollback → peek 清除

## 2026-07-12 — Memory 回滚可逆（§10.4）

类型：功能 / TDD / UI / Runtime / Storage

- storage：批准版本保留；`rollbackChange` 恢复未回滚前驱；状态 `rolled_back`
- protocol：`memory.rollback` + Rollback* 类型；DEFAULT_FEATURES
- runtime：命令处理 + 事件 `memory.change.rolled_back`
- ui-kit：Memory **变更历史** + **回滚** 按钮（仅已通过）
- desktop：IPC / preload / renderer 接线与可观测状态条

相关：`docs/development/12-test-log.md` 同日条目；M1 仍 open。

## 2026-07-12 — M1: Real OpenAI-compatible model discovery

## 2026-07-12 — Agent 持久化绑定

- storage: `SqliteAgentStore` 不可变 `agent_version` 行
- runtime: 从 agent store 解析绑定；`agent.get` / `agent.updateBinding`
- ui: 左侧 `AgentBindingPanel`（default / ordered fallback / pauseOnFailure）
- 协议 features: `agent.get`, `agent.updateBinding`

### Added

- `packages/adapters/src/openai/discover-models.ts`: live `GET {baseUrl}/models` with Bearer auth, secret scrubbing, failure classification.
- `OpenAIChatAdapter` with real `discoverModels`; `OpenAIResponsesAdapter.discoverModels` no longer returns `[]`.
- Runtime `discoveryByProtocol` registry; production `main.ts` injects openai-chat/responses/images adapters.
- Provider command tests for real (mocked HTTP) model ids and auth-failure scrubbing.
- Renderer observability: discovery-in-progress status and sample real model ids.

### Notes

- Demo chat stream still uses FakeProvider until Agents/run binding.
- CC Switch full import remains M1 non-goal.
- Secrets still never enter DB/list/export/logs.

# Feature Changelog

## 2026-07-12 - M1 Providers / Credentials 可观测面板

类型：功能 / TDD / UI / Runtime / Security

相关文件：

```text
packages/storage/src/provider-store.ts
packages/protocol/src/commands.ts
apps/runtime/src/{runtime.ts,persistence.ts,command-validation.ts}
apps/runtime/tests/provider-commands.test.ts
apps/desktop/src/{provider-payloads.ts,main/index.ts,preload/index.ts}
apps/desktop/src/renderer/{index.tsx,m0-projection.ts,global.d.ts,renderer.css}
packages/ui-kit/src/components/ProvidersPanel.tsx
packages/ui-kit/src/styles/components.css
packages/ui-kit/tests/ProvidersPanel.test.tsx
docs/development/{10-current-status,03-feature-changelog}.md
docs/handoff/05-handoff-guide.md
```

变更说明：

1. Provider 注册：手动 name + baseURL + protocol + apiKey；密钥仅经 create hop 写入 SecureStore。
2. 列表/UI 永不回显明文 key；表单提交后立即清空密码字段；列表掩码显示密钥存在性。
3. 支持 FakeProvider 模型发现（create 时 supportsDiscovery）与手动 addModels。
4. Desktop 左栏 Workspace 下方挂载 ProvidersPanel；连接 Runtime 后自动 list。
5. Trace 可观测：`provider.created` / `provider.models_discovered` 人类摘要。
6. 补齐 preload/global.d.ts/IPC 与 `selectTraceEvents`（含 workspace-global provider 审计事件）。

TDD 证据：

```text
@sync-think/ui-kit：7 files / 21 tests
@sync-think/desktop：10 files / 54 tests
@sync-think/runtime：8 files / 32 tests（含 provider-commands）
build/typecheck：ui-kit + desktop + runtime pass
```

后续注意：

1. 真实 OpenAI/Anthropic adapter 与 Agent 绑定尚未完成。
2. 不初始化 Git。

---

## 2026-07-12 - M1 Conversation full history + observability UX

类型：功能 / TDD / UI / Runtime

相关文件：

```text
apps/desktop/src/renderer/{m0-projection.ts,index.tsx,renderer.css,runtime-view-state.ts,global.d.ts}
apps/desktop/tests/event-history.test.ts
apps/desktop/src/{main/index.ts,preload/index.ts}
packages/ui-kit/src/components/{Compose.tsx,MessageBubble.tsx}
packages/ui-kit/src/styles/components.css
packages/ui-kit/tests/Compose.test.tsx
packages/protocol/src/commands.ts
apps/runtime/src/{runtime.ts,command-validation.ts,demo-run.ts}
apps/runtime/tests/demo-run.test.ts
docs/development/{10-current-status,03-feature-changelog}.md
docs/handoff/05-handoff-guide.md
```

变更说明：

1. Conversation 投影重写为完整交错历史（多轮 user/assistant 保留；流式 assistant bubble；stream state idle/streaming/completed/failed/cancelled）。
2. Trace 改为 thread 作用域人类可读摘要（最多 24 条），不再仅 raw event type。
3. 中央可观测状态条：连接态、任务/thread/version、模型、生成中/失败/取消。
4. Compose 支持 streaming Cancel；Runtime 落地 `run.cancel` + `run.cancelled` 事件；Desktop bridge 透传。
5. MessageBubble 支持 streaming 光标；右栏 Run pulse 随 stream state 变化。

TDD 证据：

```text
@sync-think/desktop test：9 files / 51 tests passed
@sync-think/ui-kit test：6 files / 19 tests passed
@sync-think/runtime demo-run：6/6（含 cancel）
desktop/runtime typecheck：pass
```

后续注意：

1. Providers / Credentials / Agents / Context Packet 尚未开始。
2. 创建工作区仍为绝对路径 prompt。
3. 不初始化 Git。

---## 2026-07-12 - M1 Workspace IA Desktop UI + bridge

类型：功能 / TDD / UI

相关文件：

```text
packages/ui-kit/src/components/{WorkspaceNav.tsx,workspace-nav-model.ts}
packages/ui-kit/src/styles/components.css
packages/ui-kit/tests/{WorkspaceNav,workspace-nav-model}.test.*
apps/desktop/src/workspace-payloads.ts
apps/desktop/src/main/index.ts
apps/desktop/src/preload/index.ts
apps/desktop/src/renderer/{index.tsx,global.d.ts,workspace-catalog.ts,renderer.css}
apps/desktop/tests/{workspace-payloads,workspace-catalog}.test.ts
docs/development/{10-current-status,03-feature-changelog}.md
docs/handoff/05-handoff-guide.md
```

变更说明：

1. Desktop bridge 扩展 workspace/task 命令：create/list/open/search，Main 校验 payload 后转发 Runtime。
2. ui-kit 新增 signature 左栏 `WorkspaceNav`：文件夹→嵌套任务、inline 筛选、last-open resume pulse、空态单一 CTA、continuum spine、token-only 样式。
3. Renderer 替换硬编码 demo 树：连接后加载真实 workspace/task；打开任务切换 thread 并写 last-open；创建工作区/任务 prompt 流；聊天绑定 active thread。
4. 纯逻辑 TDD：nav model、payload validation、catalog 选择。

TDD 证据：

```text
@sync-think/ui-kit test：6 files / 17 tests passed
@sync-think/desktop test：9 files / 46 tests passed
@sync-think/ui-kit build + desktop typecheck：pass
```

后续注意：

1. Conversation 完整历史 UX / cancel stream 仍未做。
2. Providers / Credentials / Agents 尚未开始。
3. 创建工作区目前用 prompt 输入绝对路径（尚未系统文件夹选择器）。
4. 不初始化 Git。

---## 2026-07-12 - M1 启动：Workspace IA 存储与 Runtime 命令

类型：功能 / TDD / 协议

相关文件：

```text
packages/storage/src/{path-allowlist,workspace-store}.ts
packages/storage/src/{path-allowlist,workspace-store}.test.ts
packages/protocol/src/commands.ts
packages/shared/src/types/errors.ts
apps/runtime/src/{runtime,command-validation,persistence}.ts
apps/runtime/tests/workspace-commands.test.ts
docs/development/{10-current-status,03-feature-changelog,11-implementation-plan}.md
docs/product/06-roadmap.md
docs/handoff/05-handoff-guide.md
```

变更说明：

1. 进入 M1（多模型对话 Alpha）；复述退出标准与非目标。
2. 实现 workspace 路径 allowlist：绝对路径规范化、root 嵌套校验、空列表首次 onboarding。
3. 实现 `SqliteWorkspaceStore`：workspace create/list；task create/list/open/search；嵌套 parent task；默认 thread；last-open memory。
4. 协议与 Runtime 新增 `workspace.create/list`、`task.create/list/open/search`；persistent Runtime 注入 workspaceStore。
5. 新增错误码 `workspace.not_found`。

TDD 证据：

```text
storage：path-allowlist 8 + workspace-store 6 + 既有 = 32/32
runtime：workspace-commands 1 + 既有 = 29/29
runtime typecheck：pass
shared/protocol/storage build：pass
```

后续注意：

1. Desktop 左栏与 bridge 尚未接线；下一步优先 Workspace IA UI。
2. Providers/Agents/Context 尚未开始。
3. 不初始化 Git。

---

本文档记录开发过程中新增、变更、删除的功能与重要项目变更。

## 功能变更记录

### 2026-07-12 - M0 Renderer reload 修复与生命周期收口

类型：修复 / 安全 / 验收 / 收口

相关文件：

```text
apps/desktop/src/main/renderer-security.ts
apps/desktop/src/main/index.ts
apps/desktop/tests/renderer-security.test.ts
docs/development/{03-feature-changelog,10-current-status,11-implementation-plan}.md
docs/handoff/05-handoff-guide.md
docs/product/06-roadmap.md
```

变更说明：

1. 定位真实 Electron `page.reload()` / `location.reload()` 超时根因：导航守卫无条件拦截 `will-navigate`。
2. 改为仅允许受信 Renderer 位置（packaged exact file 或 dev loopback origin）导航/重定向；外链与新窗口继续拒绝。
3. 归一 `pathToFileURL` 与 Chromium file URL 编码（`%7E` vs `~`），避免合法 file URL 被判为不信任。
4. TDD：security RED 3 失败 -> GREEN；desktop full 41/41。
5. 最新构建真实验收：reload、UI restart、Runtime restart、SQLite sequence 证据全部通过。
6. 根强制门禁 `test/typecheck/build --force` 通过；M0 关闭，M1 仍未授权。

验证方式：

```text
pnpm --filter @sync-think/desktop test -> 41 passed
pnpm test --force / typecheck --force / build --force -> pass
real process acceptance (CDP location.reload + UI/Runtime restart) -> ALL_PASS
SQLite: run.started=1 provider.usage=1 run.completed=1 sequence 1..9
```

后续注意：

1. 未获用户明确授权前不得进入 M1。
2. 不初始化 Git。

### 2026-07-11 - Phase 0 技术推荐与实施计划（文档）

类型：新增（文档/计划）

相关文件：

- `docs/engineering/04-tech-decisions.md`
- `docs/development/11-implementation-plan.md`
- `docs/development/10-current-status.md`
- `docs/development/14-decision-log.md`

变更说明：

1. 完成产品设计 §24 共 11 项技术 spike（TD-004–014）的方案对比与推荐。
2. 完成 M0–M3 里程碑实施计划与确认后前 10 项工程任务。
3. 仍无业务代码实现。

影响范围：

1. 确认后将按推荐绑定存储/凭证/协议/UI 原语等实现选型。
2. 工程启动顺序以 implementation plan §9 为准。

验证方式：

```text
文档审阅；等待用户确认清单
```

后续注意：

1. 未确认前不得把 Recommended 当作已锁定依赖写入 package.json（可讨论不可安装绑定）。

类型：新增（文档/流程）

相关文件：

- `AI_DEVELOPMENT_RULES.md`
- `docs/00_START_HERE.md`
- `docs/README.md`
- `docs/product/01-requirements-clarification.md`
- `docs/product/06-roadmap.md`
- `docs/product/15-frontend-design.md`
- `docs/product/15-frontend-design-tokens.json`
- `docs/engineering/02-development-principles.md`
- `docs/engineering/04-tech-decisions.md`
- `docs/development/10-current-status.md`
- `docs/development/14-decision-log.md`
- `docs/superpowers/specs/2026-07-11-sync-think-product-design.md`（已有权威设计）

变更说明：

1. 完成 `/zno-init`，将已批准产品设计落盘为可执行项目文档。
2. 用户确认文档；确认 V3 仅锁定信息架构。
3. 前端质量标准升级为可获奖级，Claude 主导页面原创设计（Continuum Bench）。
4. 尚未开始业务代码实现。

影响范围：

1. 后续所有 UI 实现必须遵循升级后的前端设计标准。
2. 工程下一步进入 Phase 0 spike 与实施计划，而不是直接堆功能。

验证方式：

```text
文档审阅；无运行时验证（无应用代码）
```

后续注意：

1. §24 spike 未完成前不要绑定具体驱动/凭证库/UIA 库。
2. UI 实现禁止直接复用 V3 原型视觉。

### 2026-07-11 - M0 工程骨架 9 个包落地（代码 + 60 单测）

类型：新增（代码/工程）

相关文件：

```text
package.json / pnpm-workspace.yaml / turbo.json / tsconfig.base.json
.prettierrc.json / .eslintrc.cjs / .nvmrc
apps/desktop/{package.json,tsconfig.json}
apps/desktop/src/main/index.ts, preload/index.ts, renderer/{index.html,renderer.css,index.tsx}
apps/runtime/{package.json,tsconfig.json,src/{index.ts,runtime.ts,main.ts,healthcheck.ts,pipe/server.ts},tests/*}
packages/shared/src/{index.ts,types/*}
packages/protocol/src/{index.ts,version.ts,framing.ts,handshake.ts,commands.ts,events.ts,pipe.ts},*.test.ts
packages/secure-store/src/{index.ts,types.ts,store.ts,scrub.ts,backends/*},store.test.ts
packages/storage/src/{index.ts,connection.ts,backup.ts,fts.ts,schema/*,scripts/migrate.ts},{migrate,backup,schema-cols}.test.ts
packages/adapters/src/{index.ts,types.ts,events.ts,fake/fake-provider.ts,openai-responses-adapter.ts,openai/README.md},fake-provider.test.ts
packages/workers/src/{index.ts,types.ts,support.ts,desktop/browser/file/terminal/git/*-worker.ts},types.test.ts
packages/ui-kit/{package.json,vitest.config.ts,tsconfig.json,tests/setup.ts,scripts/generate-css.mjs,src/{index.ts,theme.ts,styles/{index.css,components.css},components/*}},tests/*.tsx
packages/test-fixtures/src/{index.ts,provider/{battery,sse-recordings}.ts,skill/skills.ts,ccswitch/imports.ts}
scripts/{dev-desktop.mjs,pipe-client.mjs}
```

变更说明：

1. 完成 M0.1–M0.5 全部 9 个不需要 native 绑定的包骨架 + 60 个单测（含安全：secure-store 明文不落盘、CredentialRef 无明文列、adapter 不泄漏 API Key、workers 路径穿越防护 + 站点白名单）。
2. 实装协议双端：命名管道服务器 + Hello 握手 + HMAC + version + 能力协商；FakeProvider 流式 + AdapterEvent 统一；Runtime 进程能起并 handshake 回包。
3. Continuum UI Kit 完整浅深双主题 token 化（从 `15-frontend-design-tokens.json` 生成 CSS 变量）+ 签名组件 AppShell/ContinuumRail/MessageBubble/TraceList/Compose/ModeSwitch + reduced-motion 兜底，jsdom 测试覆盖。
4. Electron main 预留 safeStorage broker（contextBridge + contextIsolation + nodeIntegration: false）；/preload + /renderer 已成型但二进制未编译无法启动。

仍受阻断：better-sqlite3 / electron / esbuild 三个原生模块因本机未装 VS Build Tools 无法编译，故 storage 实跑、dev:desktop 启动、runtime 事件流端到端暂不能跑（决策 DEC-20260711-004）。

影响范围：

1. M0 实跑链路待用户装好工具链即可一键贯通，无返工。

验证方式：

```text
node node_modules/typescript/bin/tsc -b packages apps  -> 全绿
node node_modules/vitest/vitest.mjs run --root <pkg>   -> 60 个单测通过（shared 4 / protocol 13 / secure-store 7 / storage 12 *
adapters 5 / workers 7 / ui-kit 9 / runtime 3；storage 直连 better-sqlite3 的用例暂跳过等 native）
SYNC_THINK_DEV_NO_TOKEN=1 pnpm dev:runtime            -> Runtime 进程启动并可握手
pnpm dev:runtime:pipe-test                           -> 应看到 Hello ok 与 healthcheck 回包
```

- storage 的 12 个是纯逻辑 (migration planner / backup / schema columns)，better-sqlite3 live 调用尚未联跑。

后续注意：

1. 装 VS Build Tools 后必须 `pnpm rebuild better-sqlite3 electron esbuild`，AI 再补 storage live / runtime subscribeEvents / checkpoint-restore / dev:desktop 启动验证。
2. 不要把 storage 改 libsql；用户已否决，TD-004 维持。

### 2026-07-11 - M0 runtime pipe commands, desktop launch chain, and native blocker isolation

Type: change / implementation / verification

Related files:

```text
package.json
pnpm-lock.yaml
scripts/dev-desktop.mjs
scripts/pipe-client.mjs
apps/runtime/src/runtime.ts
apps/runtime/tests/commands.test.ts
apps/desktop/package.json
apps/desktop/scripts/build-renderer.mjs
apps/desktop/src/main/index.ts
apps/desktop/src/renderer/index.tsx
apps/desktop/src/renderer/renderer.css
apps/desktop/tests/build-assets.test.ts
packages/test-fixtures/package.json
packages/test-fixtures/src/provider/battery.ts
packages/test-fixtures/tsconfig.json
packages/storage/src/migrate.test.ts
packages/ui-kit/src/styles/components.css
packages/core/src/index.ts
```

Change summary:

1. Fixed the Turbo test graph by removing the `test-fixtures -> adapters -> test-fixtures` cycle.
2. Implemented M0 Runtime pipe command handling for `runtime.subscribeEvents`, `runtime.unsubscribeEvents`, and `task.appendMessage`.
3. Added task-version mismatch protection and event streaming to subscribed clients.
4. Added checkpoint snapshot export/import to prove restart-state reconstruction at the Runtime logic layer.
5. Added storage live migration/FTS test coverage, guarded so it runs when `better-sqlite3` native binding exists and is skipped when the local toolchain is missing.
6. Repaired desktop build assets with esbuild and fixed root `dev:desktop` launch cwd/dependency resolution.
7. Repaired root `dev:runtime:pipe-test` by adding needed root dev tooling/dependency links and enhancing the pipe smoke client to append a message and receive a runtime event.
8. Repaired Electron postinstall/download locally; desktop smoke now starts and stays alive until intentionally killed by the smoke script.

Verification:

```text
pnpm test      -> pass; 64 tests passed; 1 storage live test skipped due missing better-sqlite3 native binding
pnpm typecheck -> pass; 20 turbo tasks successful
pnpm build     -> pass; 11 turbo tasks successful
runtime pipe smoke -> PASS; PIPE_SMOKE_OK
desktop smoke -> PASS; process still running after 8 seconds with no Electron load error
```

Remaining limitation:

```text
Visual Studio C++ Build Tools are still missing, so better-sqlite3 cannot compile for Node v24.14.1.
The storage live test is present but skipped until the native binding can be installed.
```

### 2026-07-11 - M0 native、持久化恢复与真实 Electron 链路贯通

类型：修复 / 实现 / 安全 / 验证

相关文件：

```text
package.json
pnpm-workspace.yaml
packages/protocol/src/events.ts
packages/protocol/src/handshake.ts
packages/storage/src/scripts/migrate.ts
packages/storage/src/runtime-state-store.ts
packages/storage/src/{migrate,runtime-state-store}.test.ts
apps/runtime/src/{main,persistence,runtime,demo-run,command-validation}.ts
apps/runtime/tests/{commands,demo-run,persistence,pipe,secret-persistence}.test.ts
apps/desktop/src/main/{index,runtime-client}.ts
apps/desktop/src/preload/index.ts
apps/desktop/src/renderer/{index.html,index.tsx,renderer.css}
apps/desktop/scripts/{build-preload,build-renderer}.mjs
apps/desktop/tests/{runtime-client,build-assets}.test.ts
packages/ui-kit/src/components/AppShell.tsx
packages/ui-kit/src/styles/components.css
packages/ui-kit/tests/AppShell.test.tsx
scripts/ensure-managed-pnpm.mjs
docs/operations/07-local-development.md
```

变更说明：

1. 固定 Node 20.20.2 / pnpm 10.28.2，恢复 `better-sqlite3`、Electron 与 esbuild 原生依赖；SQLite migration、FTS、WAL 与 backup 真跑。
2. 修复 migration 的 `taskId`/`task_id` 错误，并用 immediate transaction 保证失败迁移不留下部分 DDL 或迁移记录。
3. 增加 SQLite-backed Event/Checkpoint store；事件与 checkpoint 原子提交，持久化失败返回脱敏 `storage.write_failed`。
4. Runtime 默认使用 `%LOCALAPPDATA%\SYNC-THINK\sync-think.db`，重启后恢复 thread version、event sequence 和未完成 FakeProvider Run。
5. FakeProvider durable stream 覆盖 `run.started`、usage、delta 与 completed；UI 断开不终止 Run，Runtime 重启按 adapter event index 续跑且不重复 durable output。
6. 修复 Electron sandbox preload，固定输出 `dist/preload/index.cjs`；main 通过认证 named pipe 接入 Runtime。
7. 修复 StrictMode 并发连接时 `runtime.subscribeEvents` 越过 `__hello` 的竞态，阻止未认证首帧导致的 `EPIPE`。
8. RuntimePipeClient 现在隔离 stale socket、自动重连、恢复逻辑订阅，并通过 cursor 接收 missed durable events。
9. 修复订阅响应与首个 live event 同包时的丢事件窗口；客户端先投递 replay，再投递待绑定 live events，并按 sequence 去重。
10. 修复 Runtime secret 未配置时任意非空 token 可被接受的问题；token 必需模式现在同时要求服务端 secret 和正确 HMAC。
11. Renderer 加入 strict CSP，禁止 `unsafe-eval`、object、base 和 form action；真实 Electron 控制台无 warning/error。
12. 根级门禁在 managed Node 20 目录串行启用 pnpm Corepack shim，避免 Turbo 首次并发下载 Node 产生 `EEXIST/ENOENT`。
13. Continuum shell 完成浅/深主题、轨迹折叠/恢复、Lucide 图标和响应式视觉校准。

TDD 证据：

```text
RED: concurrent connect -> Runtime connection closed / EPIPE
GREEN: concurrent requests wait for authenticated hello

RED: transient disconnect -> subscription lost
GREEN: stale socket isolation + logical subscription restore

RED: active subscription does not reconnect without a command
GREEN: background reconnect with capped exponential backoff

RED: cursor subscription omits durable history
GREEN: atomic replayedEvents response + listener delivery

RED: response + first live event in one pipe chunk drops the event
GREEN: pending stream buffer preserves the handoff

RED: built renderer has no CSP
GREEN: strict local-only CSP, no Electron security warning

RED: arbitrary token accepted when Runtime secret is absent
GREEN: token-required mode rejects unconfigured Runtime authentication
```

真实进程验证：

```text
Electron footer -> 已连接 / durable stream
UI_RESTART_JOB -> Electron 结束后 Runtime PID 保持；新 Electron 重放完整 user/delta/completed 历史
RUNTIME_RESTART_JOB -> Runtime PID 66552 强制结束；PID 63244 从同一 SQLite 恢复
自动重连 -> 新 Runtime 记录 hello accepted；UI 收到剩余 delta 与 run.completed
SQLite -> run.started=1, provider.usage=1, run.completed=1, sequence 严格递增, activeDemoRuns=0
POST_RECOVERY_APPEND -> 恢复后可继续追加并完成第三条消息
Renderer -> strict CSP 生效；无 console warning/error；无横向溢出
Fresh gates -> test 20/20 tasks + 86 tests; typecheck 20/20; build 11/11; all cache bypass
Cleanup -> SYNC-THINK Runtime/Electron processes=0; named pipes=0
```

后续注意：

1. 预审查门禁通过后，独立安全/恢复审查重新打开 M0；完成状态暂不成立。
2. 未获得下一里程碑授权前，不进入 M1 真实 Provider/Agent/Context 功能。

### 2026-07-11 - M0 独立审查修复、Renderer 快照层与交接

类型：修复 / 安全 / 恢复 / TDD / 交接

相关文件：

```text
packages/protocol/src/{handshake,events}.ts
packages/storage/src/runtime-state-store.ts
apps/runtime/src/{runtime,demo-run}.ts
apps/desktop/src/event-history.ts
apps/desktop/src/runtime-bridge-contract.ts
apps/desktop/src/main/{renderer-security,runtime-client,runtime-session,index}.ts
apps/desktop/src/preload/index.ts
apps/desktop/src/renderer/{global.d,m0-projection,runtime-connection,runtime-view-state,index}.tsx/ts
apps/desktop/tests/{renderer-security,event-history,runtime-session,runtime-connect-error,runtime-connection,build-assets}.test.ts
docs/development/{03-feature-changelog,10-current-status,11-implementation-plan}.md
docs/handoff/05-handoff-guide.md
```

变更说明：

1. Pipe 升级为双向 challenge/proof 认证，并加入 fresh nonce replay 防护、统一认证失败和非重试分类。
2. replay 升为固定 high-watermark 的有界拉式分页，保留 categories 与 reconnect committed cursor。
3. `message.appended + run.started` 与 final checkpoint 在单个 immediate transaction 中原子提交。
4. Electron 仅信任明确 loopback 开发 origin 或 packaged 精确 file URL；IPC 同时验证 sender 身份和 URL；导航、重定向及新窗口全部阻止。
5. 从 main/preload/Renderer 移除 secure-store bridge；Renderer 不再接触 secret。
6. main 唯一 Runtime subscription 建立 sequence snapshot；Renderer 将 snapshot/live 排序去重并确定性重建 M0 消息、版本、assistant 和 trace。
7. hydration 前 Compose 禁用；transient 初始连接使用可取消有限退避，认证/协议/权限失败不重试。
8. forward/send 异常不再终止 durable subscription；Runtime health/error bridge 只暴露脱敏结构化字段。

TDD 与审查证据：

```text
Electron security target：5/5 passed
Renderer recovery focused：19/19 passed
Desktop full：7 files / 39 tests passed
Desktop typecheck/build：passed
每个主要任务均完成规格审查 -> 代码质量审查；最终两阶段均通过
```

真实进程状态：

1. 重建 `@sync-think/runtime` 后，raw 两阶段认证 challenge/runtime proof/client proof 全部通过。
2. 真实 Electron 在线，Compose 消息持久化并收到完整 FakeProvider assistant，console warning/error 为 0。
3. 随后的真实 Renderer `page.reload()` 在 30 秒内未完成；根因尚未定位。
4. 因此本轮未重新完成最新构建下的 UI restart、Runtime restart 与 root `--force` 三项门禁，M0 仍保持打开。

后续注意：

1. 下一对话必须先按 `docs/handoff/05-handoff-guide.md` 系统定位 reload timeout，并以 RED -> GREEN 修复。
2. 真实 Provider 跨进程计费/副作用幂等不是 M0 保证，应在最终限制中明确保留。
3. M0 关闭前不得进入 M1。

## 2026-07-12 — M1 模型绑定 / live stream / Manifest

- core: `resolveModelBinding` 优先级 + pause-on-no-fallback；`buildContextPacket`
- adapters: OpenAI Chat Completions SSE streaming + 错误分类 scrub
- runtime: 绑定注册 model、SecureStore 取钥 live call、`context.packet.built`
- desktop: trace 展示 Manifest / resolutionSource
- docs: `12-test-log.md` 固定大白话测试日志

## 2026-07-12 — Compose 模型选择器（Run override）

- ui-kit Compose：本轮模型下拉、`onSend(text, { modelId? })`、run override / agent default 可观测标签
- desktop：`buildComposeModelOptions` 扁平化注册模型；发送时带 `modelId`
- 不改 Runtime 绑定真源；沿用 resolveModelBinding + Manifest 事件

## 2026-07-19 — 对话附件与真实执行日志

- Composer 新增回形针、拖放和 `Ctrl+V`，支持图片、文档、代码、ZIP 与文件夹；单次最多 10 个。
- 文件由 Electron 复制为哈希不可变快照；Runtime IPC/事件只保存元数据和引用，不保存二进制/base64。
- 图片在 Provider 调用前按 OpenAI Chat、Responses、Anthropic 原生多模态格式加载；非视觉模型在发送前提示切换。
- 文件夹默认仅本轮只读，也可明确绑定当前项目；文本/代码与目录上下文受 64 KB 上限约束。
- 执行详情配对真实工具请求/结果，显示命令、cwd、耗时、退出码、stdout/stderr、文件路径与结果。
- 编排 Step 的真实 `tool-trace` 会投影为持久工具事件；长输出折叠滚动，密钥自动脱敏，不生成隐藏思维链。
- 修复拖放事件对 `DOMStringList.includes` 的兼容问题；Renderer 先把粘贴/拖入文件序列化为字节记录，再通过 Electron 保存不可变快照。
- Composer 拖入时显示明确落点；图片以大缩略图固定在正文上方，并自动把输入区撑高到至少 220px，手动拖拽调高继续有效。
- “文件与产物”只显示最终结果、明确命名文件和已选择/合并/冲突交付物；跳过成员、工具轨迹和普通 Step 输出保留在执行日志但不再污染目录。
- 单版本产物弹窗直接显示真实正文，不再展示 Hash、来源 Step ID、父版本和无效的左右对比控件。
- 最终验证：Desktop **65 files / 442 tests**、UI Kit **247 passed / 2 skipped**、Runtime **269 tests**；全仓强制 test **21/21**、typecheck **21/21**、build **12/12** 全部 0 cache 通过。QA Runtime `39376` 与 Electron `21848` 已重启，生产 Runtime `43748` 未触碰。

## 2026-07-19 — 历史图片上下文续传修复

- 修复同一任务第二轮对话丢失上一轮图片的问题：历史 `message.appended.attachments` 会在原用户消息位置保留图片引用，Provider 调用前重新加载受管快照并按 OpenAI/Anthropic 原生格式发送。
- 最近 6 张图片所属消息优先保留，即使历史文字预算不足；无界历史图片不会全部重传。
- 历史快照现在校验 SHA-256，文件被替换或损坏时明确失败，不会静默发送错误图片。
- Runtime 定向/全量回归：**47 files / 272 tests**通过；Desktop 附件回归 **4/4**，Runtime typecheck 与 Desktop build 通过。

## 2026-07-12 · Memory/Diagnostics 面板 + 系统文件夹选择器

- UI：左侧 `MemoryDiagnosticsPanel`（持久记忆 / 待审变更 / 诊断）
- Desktop IPC：`memory.list` / `memory.decide` / `diagnostics.list` / `desktop:pick-folder`
- 创建工作区改用系统文件夹对话框
- secrets 仍不进入诊断与 Renderer
- `m1-obs-layout`：新增 product workspace disclosure 语义；中心验证工作台默认折叠、跳转自动展开、展开体限高滚动。
- Desktop：产品态启用 `hideReadiness`，去除 Workspace/AppShell/Mode/Continuum/Manifest/Trace 重复自检块；业务内容与 Locked 三栏 IA 保留。
- ui-kit：`WorkspaceNav` 新增已测试的 `hideReadiness`。
- Runtime：`appendEvent` 在持久模式走 `SqliteEventCheckpointStore.commitTransition`，统一全事件序列来源，修复 replay 重复/逆序导致的 `runtime.protocol-error`。
- Storage：`listTasks` 同时间排序 tie-break 从随机 ULID 改为插入 `rowid`。
- 测试：根级 707 tests、typecheck、build、M1 quick soft、Electron 真实截图全部通过。
- 边界：**M1 仍 open**；外网手测 0/18、dogfood 0/3；不启动 M2。
## 2026-07-19 - Task drafts, image preview, and child-task navigation

- Composer drafts are scoped by workspace and task, so switching projects does not discard unsent text, images, or files.
- Persisted image attachments reload from the Desktop-managed snapshot directory through a path-validated bridge, then render as thumbnails with a black overlay viewer and zoom controls.
- Parent task progress now lists child tasks and supports direct navigation; child tasks retain their parent breadcrumb for the reverse jump.

## 2026-07-19 - Automatic child-task execution and parent handoff

- `sync_think.subtask.delegate` now creates a first-level child task, pins the exact AgentVersion, inherits task policy/project binding, and starts execution automatically.
- Dependency-free children run concurrently within Agent `maxConcurrency`; `dependsOnTaskIds` enforces durable serial execution. Failed prerequisites terminate dependents instead of leaving the batch waiting forever.
- Child failures allow five retries after the initial attempt. Terminal results are returned as Agent-attributed parent messages, and the parent lead is resumed exactly once after the whole delegation batch finishes.
- `@Agent` remains an immediate one-turn route in the current conversation and does not create a child task.
- Parent/child identity projection now resolves runs through stable thread ownership. Child handoff avatars no longer replace the parent task avatar.
- Runtime and storage both enforce one child level; grandchildren are rejected.
- Final verification: forced uncached serial test 21/21 tasks, typecheck 21/21, build 12/12. QA Runtime restarted as PID `46448`; Electron restarted as PID `39688`; production Runtime PID `43748` was not restarted.

## 2026-07-19 - 项目执行位置、独立工作树与浏览器身份

- 新增 Project Resource、Execution Profile、Browser Identity 和 Task Execution Context 持久化模型及 `0028_project_execution_environments` 迁移。
- Git 项目的新任务默认获得独立 managed worktree；同一任务复用原位置，并行可写子任务各自隔离。子任务会继承父任务当前未提交的 tracked/untracked 快照。
- 非 Git 本地目录使用单写租约，第二个可写任务保持阻塞且不消耗失败重试。
- 对话与子任务现可调用真实 `read_file`、`list_files`、`write_file`、`run_command`、`git_status`、`git_diff` 和浏览器工具，执行事实写入持久日志。
- 新增 Git 仓库绑定命令与桌面端仓库 URL/默认分支入口；项目和任务界面显示代码来源、执行位置、base ref 与浏览器身份。
- Playwright 浏览器身份使用独立持久化 Edge profile，并按身份串行占用；Runtime 关闭时浏览器上下文最多等待 4 秒，避免退出被失联浏览器进程无限阻塞。
- managed worktree 完成后保留 7 天；有未提交改动或仍被租用时跳过清理并记录原因。
- 产品文案统一使用“访问范围 / 执行位置”，不要求用户理解内部路径隔离术语。
- 最终重建并重启 QA：Runtime PID `24904`、Electron PID `29064`；生产 Runtime PID `43748` 未重启。

## 2026-07-19 - 任务访问设置与智能体能力上限

- 当前任务的操作权限、浏览器身份、执行位置、基准分支和有效能力从 Composer 弹层迁入右侧“任务进度”的“访问与环境”区域。
- 操作权限和浏览器身份可在任务右侧栏直接修改；浏览器身份管理入口会直达“设置 → 浏览器身份”。
- “好友 → 能力与指令”新增文件、命令、浏览器、桌面和网络五类能力上限，保存时创建新的智能体版本。
- 任务权限只能收紧当前任务，不能突破智能体能力上限；Runtime 仍按最终有效能力过滤实际工具。
- 历史智能体的全空权限数组继续解释为旧版默认全开；用户主动关闭的能力使用显式禁用标记，避免全关后被旧兼容规则重新打开。
- 浏览器身份说明明确为隔离 Cookie、登录状态和网站数据；新任务继承默认身份，单个任务可在右侧栏切换。
- 最终验证：全仓强制测试 `21/21`、全仓 typecheck `21/21`、全仓 build `12/12` 通过；QA Runtime PID `75840`、Electron PID `19952` 已重启，生产 Runtime PID `43748` 未重启。
## 2026-07-19 · @协作、本轮任务、执行日志与空任务清理

- 群聊自动委派、成员交接和结果回传现在都以真实 Agent 消息显示精确 `@目标`；用户消息也记录本轮有效目标，继续子任务时保持原负责人，不再回退到默认 Conversation Agent。
- 右栏“本轮任务”只显示本轮计划、委派子任务、审查和交付工作；`agent/list`、命令、文件、Git、浏览器及其他工具调用统一进入执行日志，不再伪装成任务步骤。
- 执行日志改为 Multica 式工作记录：每条用户消息一轮，提供元数据、Agent 阶段、类型筛选、时间线和可展开证据；隐藏原始 Run ID、重复统计与未脱敏长载荷。
- 右栏收敛为属性、本轮摘要、本轮任务、参与智能体和可折叠子任务；父任务可原位展开/收起子任务，子任务提供“返回父任务”，选择任务不改变目录顺序。
- 离开没有消息/子任务/计划/Run/产物/审批请求/草稿/附件的占位任务时，Desktop 调用受 Runtime 最终条件保护的 `task.discardEmpty` 删除空任务；标题和版本不再作为是否有内容的判断，有未发送草稿或附件时继续保留。
- 群组自动跟随成员 Agent 的最新版本，产品界面不再显示 `v9` 等内部群组版本；普通对话的完全访问策略可执行真实工作区工具，已保存任务策略优先于 Agent 默认值。
- Runtime Provider 流与后台任务支持可中止关闭；Windows Desktop Worker 修复 0/1 项时的数组投影；单个 Runtime 命令异常现在返回请求级 `storage.write_failed` 并保持 pipe 连接，不再误断开整个桌面会话。
- 验证：Desktop **65 files / 453 tests**、Storage **23 files / 233 tests**、UI Kit **250 passed / 2 existing skipped**、Runtime **287/287**、Workers **9 files / 53 tests**；Runtime/Workers typecheck 通过，12 个 workspace 包串行 build 全部通过。
