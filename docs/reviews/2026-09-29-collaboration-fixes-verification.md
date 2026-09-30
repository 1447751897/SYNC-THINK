# 智能体管理边界与协作修复：验证记录

日期：2026-09-29。代码/生产构建已完成；当前运行实例尚未重启，仍为 executionVersion=2。北京时间 19:49 的只读健康检查显示 inFlightRuns=0。

## 本轮实现

| 问题 | 修复动作 | 验收 |
|---|---|---|
| 空答案灰条 | 无答案时跳过 StreamingResponse 内容容器，错误/暂停提示继续展示 | 空 paused 消息没有空白内容面；现有消息/过程测试通过 |
| 看过仍蓝点 | 前台、有焦点、加载完成且看到末尾结果才确认 runId，按会话推进游标 | 未读清除；新结果和其他历史会话保留未读；后台视图不误清 |
| 群名两处不一致 | Conversation.title 统一主数据；事务同步快照、启动修补旧投影、标题同源 | 数据库重命名及重启修补、实际 Header 回归通过 |
| 用户要求创建/修改智能体 | 原始用户消息资格判定；匹配工具；所有权限模式 once 审批；Native/外部内核一致 | task/summary/被委派运行无管理工具；未展示工具的执行尝试也被拒绝；记忆授权不复用 |
| 自行创建后派活 | 管理轮次与执行隔离，保存不运行/不入队；管理轮次拒绝调用与工作流 | agent_run/agent_delegate 执行守卫测试通过 |
| 群聊包含小队 | 顶层小队参与者、命名空间内部成员、冻结 DAG、负责人交付节点 | 内部先执行、负责人验收、分层消息路由、两个小队长流程测试通过 |
| 新群/增员/调度冲突 | 新群可选择协调员；成员面板添加小队；拓扑版本校验；新增只作用后续轮次 | 运行中移交/移出被阻止；停止小队同时停止内部链；同一智能体多重身份独立 |
| 新旧后台混用 | executionVersion=3 握手；旧后台显示升级提示并阻止成员/工作流变更 | v2 后台静默忽略字段的回归已覆盖 |

## 验证命令与结果

日志目录：本仓库 .data/collaboration-fixes-20260929/。

- shared、protocol、storage、runtime、desktop 标准 build：通过，含 TypeScript 检查。
- Runtime 定向回归 11 文件 / 183 项：通过（runtime-tests.log）。覆盖 chat-tools、collaboration-policy、MCP registry、协作 RPC/service/runtime/workflow/roster、管理意图、小队参与者。
- Desktop 定向回归 8 文件 / 228 项：通过（desktop-tests.log）。覆盖 AgentWorkspace、CollaborationChatView、ShellApp、SettingsPage、审批卡、可见结果和版本握手。
- 协议回归 6 项、存储回归 14 项：通过（protocol-tests.log、storage-tests.log）。
- 合计 431 项相关自动化测试；使用测试提供者和临时数据库，不等同于真实模型在线端到端验收。
- 新增模块 ESLint：通过；git diff --check：通过。
- 生产壳预算：initial JS 2,239,831 bytes，total JS 3,457,159 bytes，构建器预算检查通过。首次产物目录替换曾报 Windows EPERM，重跑完成，未强制关闭应用。
- 全仓架构检查仍未通过，剩余 3 组既有循环依赖：AgentAvatarView ↔ AgentWorkspaceAvatar；ModelPickerPanel ↔ compose-toolbar；ToolApprovalCard ↔ tool-approval-presentation（architecture.log）。本轮已拆开共享小队/会话类型依赖。

## 生效及手工验收

1. 结束当前操作，重启后台服务并重新打开桌面窗口，确认协作引擎版本为 3。仅刷新页面不会替换后台代码。
2. 在智能体单聊输入“帮我创建一个负责代码审查的智能体”。核对审批卡，拒绝应不保存；批准仅保存定义，聊天列表不凭创建自动新增，也不自动运行。
3. 再另起一轮明确要求与已有智能体聊天/执行；确认使用已有 ID。普通“修复代码”任务不应出现自主创建助手。
4. 在前台查看产生新回复的智能体会话，蓝点消失；另一历史会话未读保持。窗口后台收到结果时仍保留蓝点。
5. 重命名群聊，侧栏和顶部同名；打开旧的审查调研会话验证启动补偿。
6. 建群选择协调员；在成员面板添加已有小队；开始任务后查看各内部阶段、负责人交付和群协调员汇总。执行中新增成员不改旧链，移出忙碌成员/移交协调权须先停止或完成。
7. 模型/代理连接异常仍会明确报错。空白条修复不代表历史 ECONNREFUSED 网络故障已经消除。

## 明确边界

- 暂不自动热重排运行中的工作流；需要调整时停止旧轮并发起新轮。
- 小队加入时冻结定义，采用新定义需退出后重新添加；已有任务/产物保留。
- 已读使用本机游标，并非跨设备已读回执服务。
- 直接自然语言意图识别采用保守规则；含糊的创建/修改表达需用户明确重述，最终每次变更仍需确认。
- 本轮未推送提交、未创建 PR、未强制重启当前工作实例。

详见 docs/adr/0003-user-owned-agent-definitions-and-nested-teams.md。
