# DeepSeek Harness 自动化研究与 SYNC-THINK 执行链对照

研究日期：2026-10-02（Asia/Shanghai）。本轮为只读研究与提案，没有修改业务源码、创建/触发用户定时任务、操作登录 Profile 或发送邮件。

## 结论

**应借鉴 Harness 的职责边界和可靠执行机制，不把它的“定时提醒”直接移植成你的业务自动化产品。**

你的需求比它的 Schedule 更完整：Model / Agent / Team 均可执行，浏览器登录态可跨任务复用，任务可等待用户后继续，产物与外发均要真实完成，还希望把成功经验转成可复用流程。现有系统已经有这些能力的一部分；更合理的改造是统一业务轮次、恢复、验收与副作用状态，而不是增加另一套入口或推翻所有能力实现。

优先处理四件事：普通 Model/Agent 的跨重启轮次恢复、登录继续时配置一致性、等待状态语义、可机器核验的业务验收。邮件并发占位作为待复现的可靠性风险另列，未声称现场已重复发送。

## 一、研究依据与版本

- 官方仓库：`https://github.com/deepseek-ai/deepseek-harness`。
- 2026-10-02 12:28:58 Asia/Shanghai，经官方 GitHub API 核验 master HEAD：`639ed015397290b3745d163aafe02ffee4aa3f84`。
- 提交时间：2026-09-29 17:21:31 Asia/Shanghai（09:21:31 UTC）；该提交信息为合并 `dsh@0.2.0-rc.2` 发布变更。这里报告的是已核验的仓库 HEAD，不把它混称为 npm 最新稳定版。
- 官方 README 将项目标为 developer preview；Schedule 和 Agent Team 的相关包明确是可选实验功能。
- 保存 85 份原始官方文档/源码，重点交叉阅读 Schedule、Goal driver、Agent Loop、Team、Browser use、MCP、Skills，以及本地对应执行链。保存数量不表示逐行审阅了全部文件。
- 网页检索未返回可引用内容，实际读取来自官方 GitHub API 与固定提交的 raw 源码。没有依据第三方文章推断功能。

快照与文件索引：
- [版本核验记录](D:/projects/SYNC-THINK/.data/research/deepseek-harness-20261002/snapshot.json)
- [固定提交的官方树](D:/projects/SYNC-THINK/.data/research/deepseek-harness-20261002/tree.json)
- [保存文件、来源 URL 与 SHA-256](D:/projects/SYNC-THINK/.data/research/deepseek-harness-20261002/source-manifest.json)

## 二、Harness 实际如何执行

### 1. Schedule：负责“何时投递”，不是“业务是否完成”

支持相对延时、绝对时间、固定间隔、每日、每周、五字段 cron。规则和所属 Session 持久化；到点后恢复原会话，把指令加入 inbox，Session flush 成功后再保存投递回执。到期的重复任务只补最新一次遗漏，同一会话的重复提醒可合并，而不是积压每个错过时间点。

最重要的边界：回执证明指令已持久化到会话，不证明模型完成任务、数据正确、文件生成或邮件已发送。Host 关闭时不投递。Schedule 是可选实验 bundle，不是默认部署就有的无人值守服务；它依赖 Host Web Session controller 和会话持久化。

Schedule 文档还明确列出：没有每次新建 Session 的模式、没有执行状态管理、没有暂停功能；inbox 与任务记录是两次持久写，崩溃窗口可能重复投递，未承诺 exactly-once。

依据：[官方 Schedule README](D:/projects/SYNC-THINK/.data/research/deepseek-harness-20261002/upstream/packages/schedule/schedule/README.md#L26)、[投递实现](D:/projects/SYNC-THINK/.data/research/deepseek-harness-20261002/upstream/packages/schedule/schedule/src/runtime.ts#L90)。

### 2. Goal driver：负责“继续推进目标”

Goal 与 Schedule 分开。当前 Agent 整体空闲、目标 active、续跑已 armed 且轮次许可剩余时，driver 才投递下一轮目标指令。目标身份和 revision 用于排除过期续跑；暂停、完成、阻塞与轮次耗尽会停止推进。

这是持续推进，不是证明目标达成的评估器。官方列明没有独立业务 evaluator，轮次上限也不是完整 token/金额/时长预算。恢复或 fork 后的 active 目标默认 disarmed，需要明确的人类授权继续；异常结束也没有通用自动重试策略。

值得学的是：**目标状态、运行激活许可、模型单轮执行不是同一状态**。人工暂停尤其不应被任何后台触发偷偷撤销。

依据：[官方 Goal round driver](D:/projects/SYNC-THINK/.data/research/deepseek-harness-20261002/upstream/packages/goal/goal-round-driver/README.md#L47)、[revision/activation 实现](D:/projects/SYNC-THINK/.data/research/deepseek-harness-20261002/upstream/packages/goal/goal-round-driver/src/index.ts)。

### 3. Agent Loop：负责“模型与工具一步步执行”

循环向模型提交当前会话派生历史与真实可见工具，执行工具并记录结果，再决定下一步。会话日志是单一事实来源，LLM 历史只是其投影；不是把前端聊天文本当作唯一运行记录。

工具执行有并行池与独占屏障。中断后的“未开始”和“结果未知”分开记录；结果未知的副作用先核对外部状态，不盲目重放。工具目录、作用域、模型路由与真实提供者属于明确的装配边界。

依据：[官方 Agent loop](D:/projects/SYNC-THINK/.data/research/deepseek-harness-20261002/upstream/packages/core/agent-loop/README.md#L111)、[会话事件模型](D:/projects/SYNC-THINK/.data/research/deepseek-harness-20261002/upstream/docs/subsystems/session.md#L5)。

### 4. Team：负责“持久协作”，不是预设全员流水线

Lead 创建命名成员，成员各有会话；可 fresh 开始，或 fork 已完成的父会话历史。fork 是当时的快照，后续父会话不会自动同步给子成员。成员通过持久 mailbox 通信，通过共享任务板声明负责人、依赖与状态。

消息先写 Lead 日志，再投递目标；目标记录消息身份后才确认 delivered，恢复可查 queued-minus-delivered。任务更新用 expectedRevision 防覆盖。协调事件仅入日志，不自动灌入普通聊天，和实际对话分开呈现。

不要过度理解：其任务板支持依赖 DAG，不代表你的每次业务必须执行所有角色。Team 包仍是实验模块，局限于一个进程和一个共享 checkout；任务负责人不会因进程退出自动释放，邮箱也不是跨进程 exactly-once。

依据：[官方 Agent Team](D:/projects/SYNC-THINK/.data/research/deepseek-harness-20261002/upstream/packages/experimental/agent-team/README.md#L59)、[fork 上下文边界](D:/projects/SYNC-THINK/.data/research/deepseek-harness-20261002/upstream/packages/subagent/subagent-fork-in-process/README.md#L12)。

### 5. Browser / MCP / Skills：是受作用域约束的能力

浏览器提供者可选 Playwright MCP、Chrome DevTools MCP、Stagehand。Harness 保留任务决策循环，提供者执行网页动作。自启动浏览器由 exact live Session 所有，当前会话的多轮复用；Session runtime 释放后关闭，日志恢复不恢复其浏览器 Profile 或登录状态。连接外部浏览器则保留外部状态，但提供者实例内只允许一个 Session 占用。

MCP 按作用域提供真实工具、资源和 server instructions，走通常的权限/取消/记录路径。Skills 是可加载指令，不等于已授权、已连接、已验证可执行的工具。

因此，**你已有的持久 Profile、登录交接、浏览器租约有必要保留**。本次读到的 Schedule/Goal/Team/Browser/Skills 文档并没有给出“成功运行自动学习、验证、发布并回滚 SOP”的完整产品闭环；不将它宣传成现成能力。

依据：[官方 Browser use](D:/projects/SYNC-THINK/.data/research/deepseek-harness-20261002/upstream/docs/subsystems/browser-use.md#L19)、[MCP](D:/projects/SYNC-THINK/.data/research/deepseek-harness-20261002/upstream/docs/subsystems/mcp.md#L5)、[Skills](D:/projects/SYNC-THINK/.data/research/deepseek-harness-20261002/upstream/docs/subsystems/skills.md#L5)。

## 三、本地代码对照：确证问题与风险分开

### A. 普通 Model/Agent 的调度轮次恢复存在缺口【代码确证，未做现场故障注入】

创建定时 run 时登记 `scheduledAutomationThreads`、dispatch/run registry 元数据及 cleanup；这些 registry 是内存 Map/Set。普通 run 重启恢复路径直接调用 `executeKernelRun()`，没有重建上述调度关联；`scheduledAutomationForThread()` 的普通线程查找也只查内存，群聊才有独立持久绑定回读。

这表明底层 provider run 恢复和业务轮次恢复没有完整衔接，可能影响原轮次的配置、证据关联、并发计数与终态历史回填。不是说所有 Team 群聊都同样失效；群聊 Host 已有自己的恢复边界。

依据：[创建登记](D:/projects/SYNC-THINK/apps/runtime/src/runtime.ts#L19262)、[查找绑定](D:/projects/SYNC-THINK/apps/runtime/src/runtime.ts#L19749)、[恢复路径](D:/projects/SYNC-THINK/apps/runtime/src/runtime.ts#L33647)、[内存 registry](D:/projects/SYNC-THINK/apps/runtime/src/scheduled-task-run-registry.ts#L7)。

### B. 登录继续混用冻结配置与当前配置【代码确证，条件性路径】

登录预检使用持久化的 `binding.task`，最终执行入口却使用 `current`。配置指纹包含 target/workspaceId/instruction/automation，却遗漏 `skillVersionIds`。当只更新任务技能版本、其他被检查字段不变时，同一个 firedAt 存在旧配置预检、新配置建立 run 的路径。

应保证同一轮只使用一个完整冻结配置；修改只影响下一轮，或明确撤销并新建轮次，而不是静默混用。

依据：[指纹字段](D:/projects/SYNC-THINK/apps/runtime/src/runtime.ts#L29993)、[预检与执行入口](D:/projects/SYNC-THINK/apps/runtime/src/runtime.ts#L30147)。

### C. 等待登录被写成失败【代码确证，状态语义问题】

`ScheduledTaskRunStatus` 只有 success/failed/skipped/cancelled；定时完成路径在 waitingLogin 时写 failed，原因文本虽然解释了等待，但领域状态本身混淆了交接与故障。

应将 waiting_input、人工 paused、blocked、failed、reconciling 分开，保留原轮次身份并提供对应继续动作。不要让登录卡、顶部状态、历史与后台恢复各用一种说法。

依据：[结果类型](D:/projects/SYNC-THINK/packages/shared/src/types/scheduled-task.ts#L67)、[等待登录落 failed](D:/projects/SYNC-THINK/apps/runtime/src/runtime.ts#L19486)。

### D. 业务验收主要依赖模型解释【代码 + 4 项纯函数探针】

`automationAcceptanceFailure()` 硬检查绑定回放是否成功、要求格式是否有非空产物，以及真实邮件回执。自然语言 `acceptance` 编译进提示，但该函数没有日期、数量、来源、数据质量等结构化判断。它是已有技术证据门，不等于通用业务 evaluator。

本轮直接转译当前真实纯函数，在内存中运行四个隔离分支：
1. 无结构化要求且无证据，返回无错误（保留旧任务兼容语义）。
2. 只有“当日、至少10个来源链接”等自然语言 acceptance 且无证据，仍返回无错误。
3. 明确要求 spreadsheet、但缺文件，被阻止。
4. 邮件 unknown，被阻止并提示先核对结果。

**4/4 分支符合当前实现，不是4个业务任务成功，更不是线上E2E完成。** 这证明确定性业务验收仍需补充；不证明每个现有任务都假完成，也没有修改该函数的旧兼容行为。

依据：[验收函数](D:/projects/SYNC-THINK/apps/runtime/src/automation-run-evidence.ts#L107)、[提示编译](D:/projects/SYNC-THINK/apps/runtime/src/automation/prompt-compiler.ts)、[定时终态验收](D:/projects/SYNC-THINK/apps/runtime/src/runtime.ts#L19481)、[探针结果](D:/projects/SYNC-THINK/.data/research/deepseek-harness-20261002/local-evidence-probe.json)。

### E. 邮件防重复已有持久记录，但原子占位仍值得验证【已覆盖机制 + 静态风险】

现有实现先读同轮证据，sent 返回已有 receipt，sending/unknown 停止自动重发；发件前持久化 sending，再保存 sent/unknown。该机制值得保留，并非只靠模型口头说“别重发”。

静态风险是：首次读证据与写 sending 之间含异步附件读取，随后没有再次检查或原子抢占。若两个同轮发件调用并发进入，可能同时读到未发送。是否实际可达，还取决于工具调度与连接器去重；本轮没有复现两封邮件，暂不列为已确认运行 bug。

应加独立并发测试，必要时采用 `(occurrenceId, effectKind, destination)` 持久唯一占位/CAS。即使宿主原子占位完善，外部接口没有幂等/查询支持时，也不应承诺跨系统 exactly-once。

依据：[按轮次落盘证据](D:/projects/SYNC-THINK/apps/runtime/src/runtime.ts#L19848)、[读状态与附件阶段](D:/projects/SYNC-THINK/apps/runtime/src/runtime.ts#L27139)、[发件前后落盘](D:/projects/SYNC-THINK/apps/runtime/src/runtime.ts#L27217)。

### F. 新群聊并不是固定全员流程【已有正确机制 + 遗留分叉】

room 的 start-workflow 先创建协调任务，协调员决定当前真正需要的派工。本群提示已明确角色、策略和依赖只是参考，聊天不自动派文档工作。旧非 room 路径仍调用 `compileCollaborationWorkflow()` 生成全员阶段文档任务。

不应笼统说“现在所有群聊仍是死 DAG”。应收敛旧路径和 start-workflow 的产品命名，让同一个开工入口只代表启动目标推进；团队模板描述常见协作，具体任务才可声明当次依赖。

依据：[room 与旧分支](D:/projects/SYNC-THINK/apps/runtime/src/collaboration-chat-host.ts#L269)、[动态协作提示](D:/projects/SYNC-THINK/apps/runtime/src/task-room.ts#L85)、[旧编译器](D:/projects/SYNC-THINK/apps/runtime/src/collaboration-workflow.ts#L4)。

## 四、建议统一的模型【提案，尚未实施】

不再把“定时任务、群聊工作、浏览器回放、模型一次 run”当成互相独立的业务执行系统。保留各能力实现，统一由以下对象串联：

1. **AutomationDefinition**：任务目标、触发规则、Model/Agent/Team、权限范围、Profile/MCP/Skill绑定与验收合同；有版本。
2. **Occurrence / AutomationRun**：每次业务轮次，有唯一身份、计划时间、冻结版本、当前状态、恢复所有权与因果来源。已有 taskId+firedAt 可作为迁移基础。
3. **Goal / WorkItem / Attempt**：目标持续推进、必要分工与底层执行尝试分离；换底层 runId 不等于新业务轮次。
4. **Communication**：普通 @ 发言、咨询、派工与完成回执分开；聊天保持简洁，编排日志进入运行详情。
5. **ResourceLease**：Profile、共享页面、MCP连接等实际能力与占用；同一账号需要排队时可见，不通过暂停另一群的目标来切换。
6. **Evidence / Acceptance / Effect**：来源与业务数据、真实文件、技术检查、业务验收、邮件副作用各有事实记录；模型总结不是事实记录。

Model/Agent/Team 只改变执行者解析与可见能力，不改变任务状态机。手动、到点、外部事件只改变触发来源。浏览器回放是可选子能力，不是每项业务的强制流程。

重复定时任务保留稳定父群聊；每轮有独立上下文/执行范围和摘要，避免所有原始结果无限叠在一段上下文，也不丢跨日对比信息。长期小说任务则继续同一目标和检查点。同团队可在多个群复用，目标、文件与上下文按群/轮次隔离。

### 示例：每日抖音数据 → XLSX/PPTX → Gmail

- 09:00 Asia/Shanghai 触发本轮，冻结目标、参数、团队角色/技能版本、Profile、收件人和验收条件。
- 检查真实执行者可见能力；已有公开来源可直接读，不把所有网页都当作需要登录。确需登录时进入 waiting_input，给出登录入口并保留已有成果。
- 根据现状由模型/协调员选择必要工作；采集明确时间范围、URL、提取时刻与指标口径，不编造“当日爆款”。
- 实际生成要求格式。机器验收例如：本地日期匹配、最低记录数、每条有来源、重复率范围、文件可打开/非空、数据与附件对应；这些是业务配置，不硬编码抖音为通用框架规则。
- 质量不足继续补采集，资源缺失进入 blocked，需要人输入进入 waiting_input；不是步骤跑完就标成功。
- 邮件发送前验证业务与文件，冻结收件人，持久化发送意图。confirmed receipt 才标已发送；结果未知进入 reconciling，先查询或交给用户核对，不再盲发。
- 下一轮根据预设的忙时策略跳过/排队/合并，不覆盖上一轮；人工暂停保持暂停。

### 重复任务与“自进化”

搜索衬衫换裤子，应优先复用参数化 SOP，而非每轮重新学网页。稳定动作可走已验证浏览器流程；页面变化由模型读取现状、生成改进候选。候选版本需验证、发布/审批策略与回滚；一次偶然成功不直接升级为生产流程。登录密钥留在 Profile/凭据系统，不写进 Skill 或聊天摘要。

本次不建议为学 Harness 而把 Runtime 全换成 Cordis。先建立共同契约、事件与恢复服务，再逐步把大 runtime.ts 中的自动化管理、运行、验收和交付逻辑拆成受测试保护的模块。

## 五、实施顺序与测试边界【待实施】

**P0 — 正确性：** 补普通轮次持久身份/恢复登记，统一登录冻结配置，等待状态独立，加入结构化业务验收。

**P1 — 收敛：** 统一手动/定时/浏览器/团队的运行投影；查证并发副作用原子占位；清理旧固定流程分叉。保留既有定时任务页面与群聊，只调整运行状态和详情。

**P2 — 复用：** SOP参数化、验证和版本回滚；让失败反馈产生改进候选，而不是自由改写生产流程。

后续测试应覆盖：
- Model、Agent、Team × 有/无浏览器，均经同一业务状态机。
- 创建、更新、发布、重复触发及忙时处理；当前轮使用旧冻结版本、下一轮使用新版本。
- 登录等待期间更新 skillVersionIds，然后继续；不得混用配置。
- 普通 Model/Agent run 在生成文件前、文件后、发件前、发件结果未知时分别重启，确认原轮次关联、历史回填与副作用证据。
- 两个并发同轮发件调用，确认宿主占位和连接器调用次数。
- 浏览器回放通过但数据为空/过期/无来源，整体不应据此标记成功。
- 任务 A / B 同团队不同群、相同/不同 Profile，多任务隔离及资源排队。
- 人工暂停不自动复活；等待登录/权限/断连有具体下一步；恢复沿用业务轮次而非重新开始。

本轮实际验证仅包含：官方 API/raw 源码核验、本地只读代码追踪、4项纯函数分支探针和研究画布TypeScript检查。没有把历史280项回归计为本轮测试，没有测试真实抖音登录或 Gmail 外发，也没有验证桌面重启问题。

## 六、可视化说明

[交互式对照画布](C:/Users/zhuzhenyu/.cursor/projects/d-projects-SYNC-THINK/canvases/deepseek-harness-automation-review.canvas.tsx) 包含职责分层、本地确证问题、每日任务三种状态和改造验证清单。它是架构提案，不是已经接入生产的功能。

官方源文件的固定版本地址可由以下前缀与 manifest 的 file 字段拼接复核：
`https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/639ed015397290b3745d163aafe02ffee4aa3f84/`
