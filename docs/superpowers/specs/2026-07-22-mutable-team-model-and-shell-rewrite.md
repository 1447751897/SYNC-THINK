# 2026-07-22 · 全新可变 Agent/小队模型 + 一等对话 + NewMax 壳重写（Locked）

状态：**Locked**（用户已拍板）

## 决策

1. **可变模型，砍版本链**：`agent` / `team` / `team_member` 为可变表，编辑即 UPDATE（改了就是改了）。不做 `team_template_version` 不可变链；旧 `agent_version` 链仅因历史 step 外键保留在盘上，新代码不再追加，`agent` 表由每个 agentId 的最新版本一次性种子。
2. **唯一保留的历史 = 运行快照**：小队开跑时把当时的成员/分工冻结进 `team_run.roster_snapshot_json`。进行中的 Run 永不重读可变小队；编辑只影响下一次运行。这是执行日志，不是版本历史。
3. **对话一等公民**：新建 `conversation` 表（track: model|agent|team + targetRef + pinnedAt + executionMode），置顶为 DB 真源；任务/Run 挂在对话之下。本机 UI 偏好置顶为过渡态，迁移后废弃。
4. **权限唯一旋钮**：`conversation.execution_mode` 是产品里唯一权限面。agent / team_member 表**没有**任何权限/审批列。
5. **升级不可静默**：`upgradeTrack` 仅允许 model→agent/team，且上游必须有用户确认。
6. **协作策略最小化**：小队 strategy 仅 `serial | parallel`；handoffRules / pipeline / maxConcurrency 等字段不建，待真实需求再加。
7. **项目级覆盖表（project_team_override）暂不建**；项目仅提供「新对话默认权限 + 默认对话对象」。
8. **UI 不换框架、重写渲染层**：保留 Electron + React + TS；新渲染层 `src/renderer/shell/`（Tailwind v4 + Radix + lucide + NewMax 风格 tokens），与旧 renderer 并行，`SYNC_THINK_SHELL=1` 切换加载，达到功能对齐后切默认并删旧。

## 落地（本轮已完成）

- storage：迁移 `0024_mutable_agent_team_conversation`（建 4+1 表、种子 agent、DROP 未发布的 team_template*）；`SqliteGlobalAgentStore` / `SqliteTeamStore` / `SqliteConversationStore` + 测试。
- shared：`types/team.ts`（GlobalAgent / Team / TeamRun / Conversation 等）+ `TeamId` / `ConversationId` brand。
- protocol：18 条命令（globalAgent.4 + team.6 + conversation.8）+ payload 类型 + Feature 清单。
- runtime：18 个 handler + 严格 payload 校验 + 事件发布 + 错误映射；stores 从同一 DB 连接构造。
- desktop：main IPC 18 条 + preload 桥 + global.d.ts；新 shell 骨架（Sidebar 最近对话三分组/置顶/各组 +、舞台切换、design tokens、深浅色跟随系统）；`build-shell.mjs` 进入构建链。
- 验证：storage 231/231、runtime 聚焦 11/11、desktop shell 5/5、protocol 16/16、全仓 build 11/11。

## 后续切片（未做）

- 聊天消息流接入新 shell（对话打开后的消息渲染 + Compose + 权限三档控件）
- 新建对话时的模型/智能体/小队选择弹窗（当前暂用首个可用对象）
- 智能体库 / 小队库配置页
- 旧 renderer 下线与本机置顶偏好迁移
