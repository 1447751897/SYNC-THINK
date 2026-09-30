# 多智能体聊天故障定位与分层调度设计

日期：2026-09-29。范围：当前工作区源码、用户三张截图、运行中的 dev-0001 的只读会话接口。

**本轮是诊断与设计交付，不是生产修复发布。** 未修改业务源码、会话数据、代理配置或运行中的调度器；未向真实模型发送测试任务。现有未提交改动保留。下文“已确认”来自代码、可复现测试或真实持久化数据；“建议新增”不是现成功能。

## 0. 结论与证据

| 问题 | 结论 | 证据等级 |
|---|---|---|
| 图一灰色空白 | 空回答容器仍被绘制；真实回复无正文，因连接本地 7897 端口被拒绝而暂停 | 真实消息 + ChatView 复现 + CSS |
| 图二蓝点 | 是未读执行结果；智能体工作台没有接入已读推进，且联系人会聚合多个历史会话 | ShellApp/AgentWorkspace 代码 + 实际组件集成复现 |
| 图三名字 | 同一会话在目录与协作快照中存了不同 title；重命名只更新前者 | 真实接口 + 持久化/渲染代码 + 组件复现 |
| 创建/修改智能体 | 工具与 API 已实现；Agent/Team track 的工具目录和运行时策略阻止管理调用；协作回复还有只读过滤 | 工具目录、策略、执行器、审批路径及现有测试 |
| 小队进入群聊 | 当前是“小队生成扁平群聊”，不是“群聊含可独立调度的小队参与者” | 成员类型、create/members 命令及工作流编译器 |

诊断记录：
- [运行时只读证据](D:/projects/MYSELF/SYNC-THINK/.data/collaboration-audit-20260929/live-evidence.json)
- [只读采集脚本](D:/projects/MYSELF/SYNC-THINK/.data/collaboration-audit-20260929/read-live-evidence.mjs)
- [空气泡/名称探针日志](D:/projects/MYSELF/SYNC-THINK/apps/desktop/.data/collaboration-audit-20260929/acceptance-probes.log)
- [已读集成探针日志](D:/projects/MYSELF/SYNC-THINK/.data/collaboration-audit-20260929/unread-probe.log)
- [运行时回归日志](D:/projects/MYSELF/SYNC-THINK/.data/collaboration-audit-20260929/runtime-tests.log)：9 文件、166 项通过。
- [桌面端回归日志](D:/projects/MYSELF/SYNC-THINK/.data/collaboration-audit-20260929/desktop-tests.log)：4 文件、79 项通过。

新增三个验收探针均在预期断言处失败；这是缺陷复现，不是已修复的证明。探针没有留在正式测试扫描路径中。

## 1. 图一空白：失败前未生成答案，但答案容器仍存在

### 现象解释与真实数据

该区域不是缺失的任务卡、权限遮挡，也不是一个有业务意义的进度条，而是 `.shell-response__content` 的空回答气泡。

只读查询找到技术调研员会话 `J1AG0PZ681ABARKNZAWQXX5BZS`，运行 `DGSS0PZ167VKBFKY07JSG4KVB2`：
- assistant 文本块总长度为 0；
- 错误块终态是 `paused`；
- 保存的错误包含 `Anthropic messages network error: connect ECONNREFUSED 127.0.0.1:7897`；
- 当时显示模型 `Atria-Dawn-Preview`，终态提示没有配置备用模型。

诊断时本地 `127.0.0.1:7897` 已有监听。因此“当时连接被拒绝”已确认，“现在依然连不上”并未确认。端口监听也不等于上游模型请求一定成功。

### 触发链路

1. 后端在没有生成最终文本时保存暂停错误块。
2. `shouldDisplayChatMessage` 为保留错误信息，允许有 terminalState 的空文本消息出现——这一步是合理的。
3. `ChatView` 始终挂载 `StreamingResponse`，但无正文时传入空 children。
4. `StreamingResponse` 始终输出 content div。
5. 智能体工作台 CSS 给它 `background`、20px 圆角、12px padding。空内容仍有上下共24px内边距，于是出现横向灰条。

真实 ChatView 探针输出：`{"exists":true,"html":"","state":"paused"}`。

### 各方向排查结论

| 方向 | 判断 | 确认方法 |
|---|---|---|
| 前端 | 已确认：空容器仍有样式 | 比较 children、DOM 与 computed padding/background |
| 后端返回 | 已确认：返回暂停错误，无答案文本 | `conversation.listMessages` 按 conversationId 读取 |
| 数据缺失 | 没有证据表明已生成的答案被丢失；持久化的是无输出失败 | 比较消息 blocks 与 runId，不以预览文本推断正文 |
| 权限 | 该条记录的直接错误是连接拒绝，不是权限拒绝 | 错误分类 transient 与连接错误 |
| 异步加载 | 已进入持久化 paused 终态，不是仍在等待正文 | 重新加载同一消息仍可复现空容器 |
| 缓存 | UI缓存不是灰条根因；代理地址存在进程级缓存需单独处理 | `resolveOutboundProxy` 的 cachedProxy 与实际运行时生命周期 |

### 修复方案

**前端必须修，网络恢复也不会修复旧消息的灰条。**
- 在 ChatView 形成明确的正文内容状态；无可展示正文时不挂载 content surface，仍保留执行详情、暂停原因、重试/继续按钮。
- StreamingResponse 增加显式 `hasContent`/`renderContent` 契约，或在调用层分离“正文”与“终态通知”。不要隐藏整个消息，更不要用失败状态一刀切隐藏部分答案。
- 应区分空答案、附件、延迟加载中的长答案、加载失败。已生成部分文本后失败必须保留文本；延迟正文应给真实加载状态，而不是被当作永久空白。
- CSS `:empty` 可作补充，但不作为主修复：带空子元素/占位节点时仍会失效。

**运行恢复步骤：**
1. 检查 Runtime 使用的代理来源：`SYNC_THINK_HTTP_PROXY`，随后 HTTPS/HTTP/ALL_PROXY 环境变量，再 Windows 用户系统代理。
2. 确认代理服务和端口与配置一致，使用现有 Provider 连通性检查核实上游；不要只判断端口。
3. 如果更改代理配置，重启实际 Runtime/守护进程，或实现显式代理配置失效刷新；仅刷新 Renderer 不清除进程级代理缓存。
4. 检查该运行的模型来源及 fallback 链，尤其手选模型绕开链的情况；备用模型如果共享同一故障代理也不会解决问题。
5. 用户确认后只重试原失败轮，保留失败记录，不反复重复发消息。

### 修改位置与影响范围

- [ChatView.tsx:1073、8604、8711](D:/projects/MYSELF/SYNC-THINK/apps/desktop/src/renderer/shell/ChatView.tsx#L8604)：保留错误消息但按实际答案决定是否显示正文。
- [StreamingResponse.tsx:150](D:/projects/MYSELF/SYNC-THINK/apps/desktop/src/renderer/shell/StreamingResponse.tsx#L150)：空 content 容器。
- [agent-workspace.css:289](D:/projects/MYSELF/SYNC-THINK/apps/desktop/src/renderer/shell/agent-workspace.css#L289)：气泡背景与 padding。
- [proxy-fetch.ts:110–145](D:/projects/MYSELF/SYNC-THINK/packages/adapters/src/proxy-fetch.ts#L110)：代理缓存。
- [events.ts:87](D:/projects/MYSELF/SYNC-THINK/packages/protocol/src/events.ts#L87)：暂停/备用链提示，不应退回笼统错误。

影响智能体历史消息与共用 StreamingResponse 的普通模型聊天；需同时回归，避免把其他视图的答案或恢复按钮隐藏。

### 验证

覆盖空输出 paused/failed/cancelled、部分答案后失败、审批等待、延迟答案加载、流式首字到达、刷新后恢复。空失败应只显示执行状态和原因，不出现空气泡；部分答案保持原文且可复制。

## 2. 图二蓝点：是未读，但当前读游标没有由智能体工作台推进

### 现状与根因

蓝点明确由 `activity.unread` 驱动，DOM 标记 `aria-label="未读"`。

当前“未读”实际是**未查看的运行结束结果**，不是服务端消息 read receipt：
- 从 run.completed/failed/cancelled/paused 的最大事件 sequence 得到 lastFinishedSequence；
- 与 localStorage `sync-think.conversationLastSeen[conversationId]` 比较；
- running 状态不显示未读；失败/暂停也可以触发蓝点。

`ShellApp` 已读 effect 的第一行：`if (agentWorkspaceOpen || nav.stage !== 'talk' || settingsOpen) return;`。
打开智能体工作台正好满足这个退出条件。AgentWorkspace.open 只切换选中会话并保存选择，没有已读回调；所以进入查看后，父状态和持久化 cursor 都没变。

实际 ShellApp + AgentWorkspace + CollaborationChatView 诊断中，回复已挂载，完成事件已投影，结果为：
`{"state":{"running":false,"unread":true},"lastSeen":null}`。

**第二个独立因素**：联系人条目用 `some(history.unread)` 聚合同一智能体的全部单聊历史。即使修好当前会话，另一段历史未读仍可使联系人蓝点存在。应展示历史未读位置，而不是把所有历史自动清空。

### 确认方法

1. 记录选中 conversationId 和该联系人包含的历史 conversationId 列表。
2. 对每个会话输出 lastFinishedSequence、lastSeen、running、是否实际可见，禁止只输出联系人名称。
3. 收到一个新的 run.finished 类事件后，检查是否正确映射到 taskId/threadId。
4. 查看当前消息后验证 cursor 单调递增及 React 状态同步；重新打开、刷新后再次验证。
5. 验证两个历史会话分别未读，打开其中一个只推进其中一个。

### 修复方案

**近期兼容修复：**增加 `onConversationViewed({conversationId, observedThroughSequence})`。由真正活跃、已加载、可见的会话视图发出，ShellApp 复用 markConversationSeen/writeConversationLastSeen，推进到已观察的结束事件。
- 不仅在点击时清除；打开会话期间有新结果也要更新。
- 区分 keep-alive 隐藏页、设置遮挡、后台窗口与实际阅读。
- 长历史上滚时不要直接吞掉底部尚未看到的新结果；以可见消息/已展示结果关联的游标为准。
- stale snapshot 或乱序事件不得回退 cursor；重复事件幂等处理。
- 本地缓存写入失败应有诊断信息，状态仍在当前会话内正确更新。

**随后统一语义（建议新增）：**按实际 assistant/task-result 消息 sequence 建会话读游标，持久化到本地 Runtime 的 per-viewer/per-workspace/per-conversation store。新增 `conversation.markRead`/read-state 查询及状态推送，UI只是投影。旧普通聊天和协作聊天可能拥有不同序列域，迁移时显式记录 stream kind/epoch，禁止比较不同域的裸数字。

当前 `CollaborationDelivery.status=processed` 表示执行者处理完成，不是用户已读回执；不要复用它。

### 文件、影响与验收

- [conversation-activity.ts:156、221、238](D:/projects/MYSELF/SYNC-THINK/apps/desktop/src/renderer/conversation-activity.ts#L238)：游标与未读判断。
- [ShellApp.tsx:3366](D:/projects/MYSELF/SYNC-THINK/apps/desktop/src/renderer/shell/ShellApp.tsx#L3366)：工作台被排除的入口；AgentWorkspace props 也需接线。
- [AgentWorkspace.tsx:280、353–374](D:/projects/MYSELF/SYNC-THINK/apps/desktop/src/renderer/shell/AgentWorkspace.tsx#L353)：打开行为及历史聚合。
- [CollaborationChatView.tsx](D:/projects/MYSELF/SYNC-THINK/apps/desktop/src/renderer/shell/CollaborationChatView.tsx)、[ChatView.tsx](D:/projects/MYSELF/SYNC-THINK/apps/desktop/src/renderer/shell/ChatView.tsx)：真实展示完成信号。

影响联系人、历史会话菜单、工作区未读汇总。验收必须包含进入、停留收到新消息、切出后收到消息、上滚、刷新、跨窗口与多历史会话；每个蓝点都应有可定位的未读会话/消息。

## 3. 图三名称：同一会话的双存储分叉，不是 i18n 或 ID 误匹配

### 真实查询结果

同一 ID `6ES02PZR539N7NAFSAFMP749KJ`：

| 查询/来源 | title |
|---|---|
| conversation.list | 审查调研 |
| collaboration.command → action:get | 代码审查员 + 技术调研员 + 测试设计员 |

其 track=agent、collaborationKind=group，coordinatorMemberId 为 `agent:builtin-code-reviewer`。

### 代码链路

- 侧栏对普通 group 使用 Conversation.title。
- ChatView header 优先使用 `snapshot.conversation.title`，传入的最新 `conversation.title` 仅作 fallback。
- `handleRenameConversation` 只调用 conversationStore.rename。
- collaboration store 在 `collaboration_conversation.title` 及 payload_json 内另存 title；此次 rename 没更新它。
- 协作视图周期性刷新/收到 collaboration.updated 时仍会读到旧持久化值。因此清缓存或多等待几秒只会再次拿到旧名。

两接口数据直接就是不同字符串，没有证据指向多语言转换。组件探针用相同 ID/不同两份 title，稳定重现旧标题。

### 修复方案

1. 定义唯一权威：会话名字由 Conversation metadata 管理。群聊名与小队资产名是不同字段，避免相互覆盖。
2. 后端重命名通过一个事务入口修改权威 metadata；兼容期间同步更新协作快照 title/payload_json 并递增 revision，发出更新事件。所有重命名路径都经过该入口。
3. 前端统一 selector，侧栏、聊天 header、搜索、任务活动标题使用相同的最新会话名称。先改 header 优先级只能临时缓解，仍需修复持久化分叉。
4. 建议新增 `titleMode: auto | custom`、metadataRevision。显式用户命名为 custom 后，增删成员/成员改名不覆盖该群名。仅 auto 名允许依据成员重算。
5. 旧数据一次性对账：同 ID 的两份 title 不一致时采用 Conversation.title，记录迁移；尊重现有 snapshot revision 规则。不要为了对齐删除/重建群聊。
6. 当前 Team 侧栏还会直接读取实时 Team.name。采用统一会话 displayTitle 后，Team.name 作为“所属小队”副标题或明确的 auto-name 来源，避免下一轮重命名继续分叉。

### 文件、影响与验证

- [AgentWorkspace.tsx:79、277](D:/projects/MYSELF/SYNC-THINK/apps/desktop/src/renderer/shell/AgentWorkspace.tsx#L277)
- [CollaborationChatView.tsx:236、251](D:/projects/MYSELF/SYNC-THINK/apps/desktop/src/renderer/shell/CollaborationChatView.tsx#L236)
- [runtime.ts:10046](D:/projects/MYSELF/SYNC-THINK/apps/runtime/src/runtime.ts#L10046)
- [conversation-store.ts:374](D:/projects/MYSELF/SYNC-THINK/packages/storage/src/conversation-store.ts#L374)
- [collaboration-store.ts:90–112](D:/projects/MYSELF/SYNC-THINK/packages/storage/src/collaboration-store.ts#L90)
- [use-collaboration-chat.ts](D:/projects/MYSELF/SYNC-THINK/apps/desktop/src/renderer/shell/use-collaboration-chat.ts)：事件刷新和10秒兜底读取。

验证：群聊重命名后两接口同名；侧栏/header/搜索/活动同名；刷新重启保持；改成员名不覆盖 custom title；新增成员只更新 auto title；并发重命名有显式 revision 冲突或明确的新值优先规则。

## 4. 智能体创建/修改能力：已有工具，但能力策略没有开放到该上下文

### 当前实现核验

| 层级 | 现状 |
|---|---|
| 工具 schema | 有 list_agent_resources、create_agent、update_agent、archive_agent |
| 桌面管理接口 | 有 globalAgent.create / globalAgent.update；不是缺 CRUD |
| native 工具目录 | toolsForExecutionMode 中 canManageAgentLibrary 只接受 model track 或旧式未指定 track |
| 执行时策略 | resolveCollaborationToolDenial 明确拒绝非 model track 的 Agent Library 工具 |
| 外部内核 | platform-tools/MCP registry 有相同过滤；Runtime dispatch 再检查一次 |
| 协作回复 | reply/summary 默认只读，delegatedReadOnly 还会关闭 agentToolsEnabled 并限制白名单 |
| 审批 | 已获工具资格的情况下，create/update 等在非 full-access 模式需要审批；full-access 当前直接执行 |
| 规划模式 | planning fence 再限制副作用，单纯修改提示词不会解除 |

已有测试直接断言 model/create_agent=true、agent/create_agent=false。开启“允许智能体派发任务”只影响 TaskCreate/TaskUpdate，不等于赋予智能体库管理能力。

还发现一个配置漂移点：部分 native 路径 `agentToolsEnabled` 仅根据 toolsEnabled、store、delegatedReadOnly 判断；创建提示词据此声称管理工具已启用，但随后目录仍会按 track 过滤。非只读 agent 路径可能出现“提示词称有工具、实际目录没有”的不一致；协作只读回复则通常更早关闭该提示。建议一并修复，而不是让模型猜自己能做什么。

### 可执行方案

**现有即时路径：**到模型聊天使用已有管理工具，或使用智能体管理 UI。仍遵循当前审批/资源 ID 校验，不需要新增 CRUD。

**产品补齐（建议新增独立能力，不直接放开所有工具）：**
1. 拆分“管理智能体定义”“启动工作流”“动态委派”“工作区文件写入”四种能力。
2. 引入按 actor、workspace、targetAgentIds 限定的 `agentDefinitions.create/update` grant；由用户明确开启，不由模型自行修改授权。
3. 用同一 resolved capability 集合生成 native/外部内核工具目录、系统能力摘要、运行时二次校验、UI可用性和拒绝原因。
4. 复用 list_agent_resources + create/update handlers；先展示变更草稿/差异，再由宿主审批和持久化。对子任务/无UI执行路径，管理变更走宿主待审批请求，不把整个文件写权限或任意全局配置写权限交给子执行器。
5. 限定工作区激活范围；创建或编辑全局共享 Agent 时，在审批中明确影响其他会话的范围。模型/skill/MCP 绑定使用真实存在且许可的 ID。
6. update 增加 expectedVersion 并发检查。当前运行绑定的 persona/权限/模型保持快照，变更下轮生效；修改自身也走相同审批，不即时提权。
7. 保留规划模式限制、取消/拒绝后的确定状态、幂等请求 ID、审计与回滚。

此方案是对现有 track 级管理限制的产品扩展，需补新的能力策略测试和决策记录；仍遵循 ADR0001 的最严格工作区写入规则以及 ADR0002 的聊天/执行分离。

### 修改位置与验证

- [collaboration-policy.ts:89、128](D:/projects/MYSELF/SYNC-THINK/apps/runtime/src/collaboration-policy.ts#L128)：拆分 Agent Library 权限集合。
- [chat-tools.ts:223、265、1838、1963](D:/projects/MYSELF/SYNC-THINK/apps/runtime/src/chat-tools.ts#L1838)：目录与审批。
- [runtime.ts:20987、22714、27254、27625、27713、30947、31046](D:/projects/MYSELF/SYNC-THINK/apps/runtime/src/runtime.ts#L30947)：执行检查、宿主能力、实际 handler 与提示词一致化。
- [platform-tools.ts:625](D:/projects/MYSELF/SYNC-THINK/apps/runtime/src/kernel/platform-tools.ts#L625)、[registry.ts](D:/projects/MYSELF/SYNC-THINK/apps/runtime/src/kernel/mcp-servers/registry.ts)：外部内核 parity。
- [team.ts](D:/projects/MYSELF/SYNC-THINK/packages/shared/src/types/team.ts)、协议/存储/智能体编辑 UI：能力授权和版本化字段（建议新增）。

验证矩阵：model/agent/team × native/外部内核 × ask/workspace/full-access × plan/execute × 有/无管理 grant；审批同意/拒绝/取消；重试不重复创建；跨工作区目标拒绝；当前任务身份和权限不因自更新而改变。

## 5. 小队与群聊：现状、缺口及推荐架构

### 5.1 先明确现有产品真实语义

- GlobalAgent：可复用智能体配置。
- Team：可复用小队定义，含 coordinatorAgentId、strategy(serial/parallel)、members.memberOrder/dependsOn/role/title。
- CollaborationConversation：持久群聊或单聊，含 coordinatorMemberId、消息、任务、attempt、policy。
- CollaborationMember 目前只有 user/assistant/agent，没有 team 类型。
- 从小队发起聊天：create(kind=group, teamId, agentIds=[]) 把成员展开为群成员，保留 track=team/targetRef=teamId。
- 从普通成员创建群聊：UI 把第一个选中的 agent 设为 coordinator，界面已有说明；成员面板已有“设为协调员”。不是不存在协调员，而是默认来源偏隐式。
- 没有指定接收者的消息路由到 coordinator；结构化 recipientMemberIds 指定谁回复。文本提及本身不是任务 DAG；编辑器生成的 mentions/recipients 只是路由信息。
- send 生成 reply；明确执行后才由 `collaboration_start_workflow` 或 `collaboration_dispatch_tasks` 建执行节点。
- 小队工作流按小队 memberOrder/dependsOn/strategy 编译；**普通群聊默认工作流目前按活动成员顺序串行**，并不是智能体们自行协商顺序。自定义图依赖协调员调用 dispatch_tasks。
- 非协调员被直接点名并请求执行时，start-workflow 限为本人节点；不会自动获得调度全群的权限。
- 阶段要提交 document/file 产物；仅一句“完成了”不算交付。完成/失败等终态齐备后由协调员汇总。

现有命令 `members` 只接受 addAgentIds、removeMemberIds、coordinatorMemberId、roles；没有 addTeamIds。将小队成员逐一加入普通群不会携带原小队内部 DAG/leader 边界。

### 5.2 当前动态变更的具体缺口

1. 普通群加新成员后，下次默认工作流会取新的活动成员序列；已有任务图不会自动改写。
2. team 绑定群的编译器只枚举 Team.members；仅向群里加 Agent 不等于把它加入 Team 配置和工作链，故它可参与聊天却不自动进入小队流程。
3. 移除成员使尚未启动的节点等待 member_removed；updateMembers 没有主动取消该成员已运行的节点。
4. 移除 coordinator 需要同次指定有效替代者，否则命令失败。已有 UI 可改协调员，但没有完整的执行中交接语义。
5. 当前 summary 使用当下 conversation.coordinatorMemberId，若中途换协调员，汇总归属可能切换；工作流需要冻结协调权。
6. storage 有 revision 防冲突，但 members 命令缺少客户端 expectedRevision，不能把内部存储校验等同于用户可感知的并发编辑协议。
7. Team 在工作流启动时从实时 store 读取，图编译后节点已固化，但没有完整持久化的 teamVersion/拓扑版本边界；后续重新规划需要补齐。

### 5.3 推荐：群聊包含小队参与者，小队保留内部 leader

**不是群聊与小队并列抢调度权，也不是把成员平铺后丢掉小队链。**

```text
用户
  └─ 群聊协调员（外层：任务拆分、跨参与者依赖、最终汇总）
       ├─ 单个智能体任务
       └─ 小队任务（外层看作一个节点）
            └─ 小队 leader（内层：应用既定工作链）
                 ├─ 内部节点 A → 产物 v1
                 └─ 内部节点 B（依赖 A）→ 小队交付
```

宿主调度器负责真正的入队、锁、依赖、权限、超时、重试与验收；LLM leader 提出/选择结构化方案，不自行作为不受约束的调度循环。

| 角色 | 调度权 | 无权自动做的事 |
|---|---|---|
| 用户/群管理者 | 指定协调员、批准计划、管理成员、取消/重试 | — |
| 群聊协调员 | 外层图、跨小队交接、收集产物、对用户汇总 | 越过小队边界直接改写其运行中内部图 |
| 小队 leader | 本小队内部图、内部交付验收、向外返回结果 | 调度其他小队/全群或扩展全群权限 |
| 小队/独立执行成员 | 执行分配节点并提交产物；接受点名聊天 | 通过聊天 @ 自动广播执行、越级派活 |
| 宿主调度器 | 执行可验证计划并落实所有权限与资源约束 | 把模型自然语言承诺当作成功 |

同一智能体可同时担任群协调员和一个小队 leader，但每次调用必须有明确 scope/taskId；外层节点和内层节点的调度权不混用。

### 5.4 建议新增数据模型（草案，非现成字段）

```ts
GroupParticipant = {
  participantId, conversationId,
  kind: 'agent' | 'team', refId,
  active, joinedAt, membershipVersion
}
TeamBindingSnapshot = {
  participantId, teamId, teamVersion,
  leaderAgentId, members, strategy, internalDag, permissionsSnapshot
}
WorkflowInstance = {
  id, conversationId, topologyRevision, planRevision,
  coordinatorParticipantId, coordinatorActorId,
  sourceMessageId, teamBindings, nodes, permissionsSnapshot
}
WorkflowNode = {
  id, workflowId, parentNodeId?,
  kind: 'agent-task' | 'team-task' | 'summary',
  assigneeParticipantId, dependsOn, deliverable,
  resourceClaims, currentAttemptId
}
```

复用现有 attempt/artifact/correlation/causation/receipts，增加 task 归属与队内子图，不再平行造一套消息表或无审计后台循环。任务绑定 actor ID 与 definition version；同名不会改身份。

### 5.5 建议新增接口（继续沿用 collaboration.command）

| 建议 action | 关键入参/约束 |
|---|---|
| participants.update | addAgents/addTeams/removeParticipants、expectedTopologyRevision、clientRequestId；验证工作区可用性 |
| coordinator.set | coordinatorParticipantId/actorId、expectedRevision、handoverPolicy |
| workflow.preview | goal、topologyRevision；返回外/内层 DAG、权限差异、资源冲突、交付合同 |
| workflow.commit | previewId/planRevision、clientRequestId；原子冻结后入队 |
| workflow.replan | basePlanRevision、仅剩余节点的变更、失效产物说明、审批凭证 |
| workflow.cancel/retry | nodeId、范围及幂等 ID；区分外层任务和内部 attempt |

这些是建议命名，不代表当前 API 已存在。当前 create/members/start-workflow/dispatch/cancel/retry 保留兼容适配。返回明确 capability/version 标识，旧界面不能把 team participant 当普通 agent；按 ADR0002 对执行版本不匹配给出升级提示。

### 5.6 三类场景的操作与消息流

**A. 把小队拉进已有群聊**
1. 用户选择“添加小队”，预览 leader、成员、工作链、权限要求。
2. 建 team participant 与加入时版本；群内保留一个小队卡，可展开成员，不把全队变成独立接收者。
3. 已有群 coordinator 不变；加入小队不抢协调权。
4. 群 coordinator 给小队一个输入/交付合同；内部 leader 按自己的 DAG 派发；内部进展汇聚到小队任务卡。
5. 内部产物结构验收后，team node 完成；向群返回一次可追踪的交付，外层后继才能开始。
6. 群里 @小队 默认点名 leader；@某内部成员默认是聊天回复；对其派发跨边界执行必须进入显式任务流程，不绕开小队计划。

**B. 新建群聊**
1. 创建页新增明确“群聊协调员”选择器，默认可建议第一个成员，但创建前展示并允许改选。
2. 只有一个小队时可建议其 leader；有多个小队时由用户确认一个外层协调员，不以所有 leader 竞争发言决定。
3. coordinator 必须属于有效参与范围且可用；校验失败留在创建页。
4. 普通消息只回复；用户要求执行时展示计划，确定外层串并行/交付依赖，再提交工作流。成员显示排序不作为隐式业务依赖。

**C. 已有群新增智能体/小队**
1. 以 expectedTopologyRevision 原子提交变更，返回新版本与系统消息。
2. 默认只影响下一轮计划，不让新加入者接管正在跑或已完成的节点。
3. 用户选择“纳入本轮”时先 preview/replan：仅对未启动节点新增/改依赖；已完成产物是否失效必须明确。
4. 移除有运行任务的成员时给出“待当前任务结束再移出”或“取消其任务并重新分配”；队内其他节点按依赖状态处理。
5. 扩展 Team 工作链与仅加入群聊分别操作：前者生成新 Team 版本，后者只改群拓扑。

### 5.7 调度规则与边界

- **权限**：实际权限取会话授权、调用者 scope、Agent writePolicy、Team约束、workspace授权的交集。加群、设角色或设协调员都不授予额外文件/工具权；管理智能体定义另走第4节能力。
- **资源**：沿用现有 workspace 级并发/写冲突保护；当前上限最多3，外部工具写也有保守互斥。层级任务共用全局预算，不能每个小队独立开3个而突破外层限制。等待子节点时父 team node 不占工作执行槽/持有写锁，避免父子互等死锁。
- **DAG**：提交前验证成员可用性、依赖存在、无环、交付合同与权限可满足。依赖靠产物版本，而不是看聊天发言顺序。
- **重复身份**：同一 Agent 同时作为单独成员和队员，用 participant/task scope 区分职责；底层资源锁按真实 actor/资源合并，避免重复派发和双重写入。
- **幂等/循环**：复用 clientRequestId、correlationId、causationId；团队回传摘要有固定结果收据，不能再当新用户任务触发下一轮。保留现有跳数6、自动消息12上限，层级执行还要限制总节点/深度/成本。
- **失败**：内部关键依赖失败则 team node 失败或等待人工处理，外层后继阻断。部分产物可展示但不能伪装全部成功。重试新 attempt，旧产物保留且不能冒充新交付。
- **取消**：外层取消显式传播到其子图；取消某一内部阶段只影响该小队的相关依赖，除非它导致外层交付不满足。
- **协调员变更**：空闲时立即变更；执行中默认下一 workflow 生效。交接当前 workflow 需显式事务更新/确认；汇总和回传仍按冻结 owner，不被当前 UI coordinator 隐式替换。
- **成员不可用**：工作区未激活、归档、移除、缺少模型配置时在 admission 检查；不悄悄换成同名 Agent。
- **上下文**：保持现有消息边界和前驱产物引用；新成员只拿与其节点相关且授权的上下文。产物超预算明确要求拆分，不能静默截断交付。聊天历史当前有32000字符截断提示，这与完整产物交接是两种不同策略。
- **重启**：持久化 workflow/topology/definition版本、attempt owner/heartbeat；恢复时对遗留任务核对原run，避免第二次执行有副作用的步骤。

### 5.8 交互与实现模块

交互：头部显示“群聊协调员：X”；小队卡显示“内部负责人：Y / 进行中阶段 / 已交付产物”；任务视图展示外层节点并可展开队内 DAG；添加成员弹窗说明“下轮生效/纳入本轮需重新确认计划”。

具体模块：
- [team.ts](D:/projects/MYSELF/SYNC-THINK/packages/shared/src/types/team.ts) 与 [collaboration-chat.ts](D:/projects/MYSELF/SYNC-THINK/packages/shared/src/types/collaboration-chat.ts)：参与者、Team版本、workflow归属。
- [protocol/collaboration-chat.ts](D:/projects/MYSELF/SYNC-THINK/packages/protocol/src/collaboration-chat.ts)：新 action 校验与兼容能力。
- [collaboration-store.ts](D:/projects/MYSELF/SYNC-THINK/packages/storage/src/collaboration-store.ts)：版本化状态、事务与迁移。
- [collaboration-chat-host.ts:193、383、424](D:/projects/MYSELF/SYNC-THINK/apps/runtime/src/collaboration-chat-host.ts#L193)：成员/Team绑定、协调权、命令边界。
- [collaboration-workflow.ts:4](D:/projects/MYSELF/SYNC-THINK/apps/runtime/src/collaboration-workflow.ts#L4)：从单层编译扩展为 team node + 内部子图。
- [collaboration-chat-service.ts:205、513、715、844](D:/projects/MYSELF/SYNC-THINK/apps/runtime/src/collaboration-chat-service.ts#L513)：调度、锁、依赖、失败传播、汇总与路由。
- [runtime.ts:21289、27254](D:/projects/MYSELF/SYNC-THINK/apps/runtime/src/runtime.ts#L21289)：按 scope 执行及工具授权。
- [AgentWorkspace.tsx:494](D:/projects/MYSELF/SYNC-THINK/apps/desktop/src/renderer/shell/AgentWorkspace.tsx#L494)、[CollaborationChatView.tsx:380](D:/projects/MYSELF/SYNC-THINK/apps/desktop/src/renderer/shell/CollaborationChatView.tsx#L380)：创建 coordinator 选择器、添加小队、变更预览。

## 6. 实施顺序与验收清单

| 顺序/问题 | 原因 | 修复动作 | 验收标准 |
|---|---|---|---|
| P1 空白 | 无文本的 paused 消息仍绘制 padded surface；历史代理连接失败 | 分离答案容器与状态；核查代理/备用链 | 空失败无灰条，原因/恢复保留，部分答案不丢 |
| P1 蓝点 | 智能体工作台绕过已读 effect；历史聚合 | 可见结果推进 cursor；历史未读可定位 | 看到结果即更新；隐藏页不吞未读；重启稳定 |
| P1 名称 | 两存储的 title 分叉 | 权威标题、事务同步、事件、旧数据对账 | 两接口及所有入口同名，自定义名不被成员变化覆盖 |
| P2 管理能力 | track、catalog、readonly、planning 多层门禁 | 独立管理grant、宿主审批、目录/提示/dispatch统一 | 获批可创建/修改；未获批与跨范围仍受控；无重复创建 |
| P2 群协调 | 首选成员默认且没有完整交接协议 | 明确选择器、冻结owner、交接策略 | 新建可指定；运行中换人不悄悄换任务owner |
| P3 小队入群 | 只有扁平Agent成员 | team participant、版本快照、内外层DAG | 群只协调外层；小队保留leader/内部链；回传一次 |
| P3 动态扩员 | 缺少拓扑版本/本轮重排契约 | revision、preview/replan、移除/取消策略 | 加人默认下轮；纳入本轮可审查；无环/无越权/无重复执行 |

### 可直接执行的下一步

1. 把三个红探针转为正式回归测试，再做三项 P1 修复；这一阶段不动调度模型和管理权限。
2. 为重命名做同 ID 数据对账迁移，并增加 rename RPC→两个读接口的回归。
3. 修复 Agent capability prompt 与真实目录不一致；补管理能力矩阵，确认产品授权范围后实施宿主管理请求。
4. 单独引入 Team participant 原型，先验收“一群+一队+一个独立Agent”，再验收双小队、运行中加人和移除leader。
5. 合并前跑当前245项基线及新增回归；针对真实 UI 再测窗口可见性/消息滚动/重连。使用现有项目构建脚本，部署时同时验证 Renderer/Runtime executionVersion。

### 仍需确认的事项

- 第一个故障轮的直接错误已找到，但代理当时为何不接受连接（服务晚启动、退出、端口切换等）需那个时间段的代理进程日志；目前端口已经监听。
- 用户窗口里具体 lastSeen 数值尚未读取；持久蓝点的代码缺陷和可见回复复现均已确认，不依赖这个值才成立。历史聚合是否同时触发需该窗口的联系人历史/游标。
- 新能力授权范围、运行中成员移除的默认策略、协作计划何时要求用户再次确认属于产品决策；本报告给出默认建议，没有把它们伪装成现有行为。
- 截图中的旧模型自然语言回答不是调度契约。当前源码已有9月29日的工作流/产物机制；不能据旧回复反推当前实现仍没有顺序或派发能力。
