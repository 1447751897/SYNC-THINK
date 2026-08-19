# 2026-07-22 · SYNC-THINK = NewMax 全功能 + 三轨对话工作台 — 完整实施方案

状态：**Locked（总纲）** · 供执行 AI 按阶段实施
读者：执行代码修改的 AI。本文档自包含：读完即可开工，不需要回看历史对话。

---

## 0. 产品定义（一句话）

> 做一个功能上完全对标 NewMax 的个人 AI 工作助手，差异化是：
> 用户可以直接跟 **模型** 聊，也可以跟配置好的 **智能体**（全局资产）聊，
> 还可以让多个智能体组成 **小队** 分工干活 —— 三轨对话是唯一的产品增量，
> 其余体验、功能、生态全部向 NewMax 看齐。

---

## 1. 已锁定的产品决策（执行时不得违反）

| # | 决策 | 说明 |
|---|---|---|
| D1 | 权限唯一旋钮 = 对话上的三档 | `conversation.execution_mode`：询问批准(read-only) / 为我批准(workspace, 默认) / 完全访问(full-access)。Agent、小队成员**永远不配权限** |
| D2 | Agent / 小队 = 全局可变资产 | 编辑即 UPDATE，无版本链。唯一历史是 `team_run.roster_snapshot_json`（开跑冻结，编辑只影响下次运行） |
| D3 | 对话一等公民 | `conversation` 表（track/targetRef/pinnedAt/executionMode）；任务、Run 挂在对话之下 |
| D4 | 升级不可静默 | 模型直聊 → 智能体/小队：用户点击 或 AI 建议卡+用户确认；`upgradeTrack` 仅允许从 model 出发 |
| D5 | Agent 装备随身 | Agent 绑的 Skill/MCP 进任何项目自动可用；权限门禁与装备分离 |
| D6 | 子任务嵌在本对话 | 不为子任务新开会话；进度进消息流 + 右栏「任务」 |
| D7 | 模型获取 = CC Switch + 多 Provider | 不做 Gateway/钱包；用户自有中转站后续作为 Provider 预设 |
| D8 | Skill 生态 = 目录兼容优先 + 自建市场渐进 | 先兼容 `~/.claude/skills`、本地 ZIP/文件夹，市场后做 |
| D9 | 技术栈不换 | Electron + React + TS；渲染层在 `apps/desktop/src/renderer/shell/` 全新重写（Tailwind v4 + Radix + lucide），旧 renderer 并行至功能对齐后删除 |
| D10 | 过程展示三层 | 用户步骤（默认）→ 业务细节（点开）→ 技术字段（仅开发者模式）。执行过程折叠块 + 相邻合并×N + 探索/修改/验证分组 + 严格事件序 |
| D11 | 洞察 + 飞书/企微/Webhook | 预留导航位与接口，暂不实装 |
| D12 | 桌宠 | 要做（后期，随主题/托盘一批） |

---

## 2. 代码库基线（2026-07-22 已完成部分）

仓库：`D:/projects/MYSELF/SYNC-THINK`（pnpm monorepo + turbo）

```text
packages/
  shared/     类型（含 types/team.ts: GlobalAgent/Team/TeamRun/Conversation）
  protocol/   命令定义（含 18 条新命令：globalAgent.4 + team.6 + conversation.8）
  storage/    SQLite (better-sqlite3 + drizzle schema + 手写迁移 scripts/migrate.ts)
              迁移 0024：agent/team/team_member/team_run/conversation 五表
              stores: global-agent-store / team-store / conversation-store
  ui-kit/     旧组件库（旧 renderer 用；新壳不依赖它）
apps/
  runtime/    Node 常驻进程，named pipe 服务；18 条新命令 handler 已接
  desktop/    Electron；main IPC + preload 桥已通
    src/renderer/          共享逻辑模块（旧壳 UI 已于 2026-08-18 删除）
    src/renderer/shell/    唯一渲染层（主进程直接加载 dist/renderer-shell）
      tokens.css           生成物：由 docs/product/16-shell-design-tokens.json + pnpm tokens:css 产出
      shell.css            Tailwind v4，@import './tokens.css'（深浅色，.dark 类切换）
      shell-state.ts       导航状态纯函数（stage/track/分组）
      Sidebar.tsx          最近对话三分组 + 置顶 + 各组新建 +
      ShellApp.tsx         壳根组件（refresh/新建/置顶已接真实桥）
      shell-entry.tsx      入口（跟随 OS 主题）
    scripts/build-shell.mjs  esbuild + Tailwind CLI → dist/renderer-shell
```

**验证基线**：storage 231/231、runtime 聚焦 11/11、protocol 16/16、shell 5/5、全仓 build 11/11。

**关键约定（执行 AI 必读）**：
- 表名蛇形单数；主键 text PK；时间戳 ISO8601 text；布尔 integer mode boolean；JSON 列后缀 `_json`
- ID 生成：`ulid()` from `@sync-think/shared`；brand 类型（`AgentId`/`TeamId`/`ConversationId`…）
- 迁移只追加，不改历史；`migrate.test.ts` 有顺序断言，追加迁移必须同步更新测试
- 新壳样式**只用 shell.css 里的 token**（`--color-*`），禁止硬编码 hex
- Runtime 命令三段式：protocol 类型 → runtime handler（parse→store→响应帧）→ desktop IPC → preload 桥 → global.d.ts
- 测试跑法：各包 `pnpm exec vitest run`；typecheck `pnpm exec tsc --noEmit`；全仓 `pnpm build`
- 中文产品文案；错误信息走现有错误信封风格

---

## 3. NewMax 全功能地图 → 实施映射

来源：NewMax 帮助文档 9 模块全量（chat / projects / workspace / skills-mcp / models / settings / shortcuts / browser / feedback）。

| NewMax 能力簇 | 具体功能 | 本产品状态 | 归属阶段 |
|---|---|---|---|
| **对话基础** | 多对话/自动标题/收藏/归档/重命名/删除/搜索 | 表已支持，UI 未做 | P1/P2 |
| | Markdown/代码高亮/LaTeX/Mermaid/图片画廊 | 无 | P1(MD+代码) P6(其余) |
| | 附件/拖拽/粘贴长文变文件/@文件 | 无 | P2 |
| | 消息队列(5)/停止/编辑重发/消息目录刻度 | 无 | P2 |
| | 执行过程折叠/深度思考块 | 投影层已有（旧壳），需接新壳 | P1 |
| | 权限三档/联网开关/推理强度档位 | 权限数据层已有 | P1 |
| | /plan /goal /compact 斜杠命令 | 无 | P5 |
| | 导出对话为图片 | 无 | P8 |
| **三轨对话（差异化）** | 模型直聊/智能体聊/小队聊 + 各组新建 | 侧栏骨架已有 | P0/P1 |
| | 新建选择器（选模型/智能体/小队） | 无（暂用首个） | P0 |
| | 直聊升级为智能体/小队（确认卡） | 存储/命令已有，UI 无 | P3 |
| **智能体库** | CRUD/头像/人设/绑模型/装备 Skill+MCP | 存储/命令已有，UI 无 | P2 |
| | 聊天里 AI 建智能体（草稿卡→确认） | 无 | P3 |
| **小队** | 模板 CRUD/成员/角色/依赖/统筹 | 存储/命令已有，UI 无 | P2 |
| | 分工卡（确认/改后确认/统筹代审）/问询卡 | 无 | P3 |
| | 小队运行/成员前缀过程块/子任务进度 | 快照已有，执行编排未接 | P3 |
| **右栏** | 文件预览(多类型)/Changes diff/任务/过程 | 旧壳有部分，新壳无 | P4 |
| **项目/工作区** | 顶栏项目 Tab/打开文件夹/改名图标 | workspace 表已有 | P0(Tab) P5 |
| | 长期放养：看板/排期/依赖/自动执行/项目Skill | 任务依赖有底层 | P5 |
| | 内置终端(9)/定时任务+通知 | 无 | P5 |
| **Skill/MCP** | 目录兼容/ZIP安装/覆盖更新/按消息点选// 菜单 | 导入+allowlist 有 | P6 |
| | 市场（浏览/安装/发布） | 无 | P6(骨架) |
| **模型** | CC Switch 一等导入/多 Provider/多 Key 切换 | 已有，UI 需进新壳 | P7 |
| | 模型二级选择器/对话级记忆/上下文圆环/用量 | 无 | P1(选择器) P7 |
| | 思考档位随模型/规划执行模型分离 | 无 | P1(档位) P7 |
| | 生图配置/识图 fallback | 无 | 缓（P9 后评估） |
| **设置** | 主题（跟随系统/预设/自定义主色+对比度）/字号/减少动画 | 新壳仅跟随系统 | P8 |
| | 个性化提示词/默认权限/命令白名单 | 部分 | P8 |
| | 数据导出导入/自动备份/存储清理 | backup.ts 有底层 | P8 |
| | 代理/搜索服务多供应商 | 无 | P8 |
| **快捷操作** | 全局唤起小窗/托盘/开机自启/Esc停止/Ctrl+F | 无 | P8 |
| | 语音输入 | 无 | 缓 |
| | 桌宠（宠物包/尺寸/气泡） | 无 | P8 末 |
| **浏览器** | 对话操控网页/Profile 多账号/卡点接管 | 工具+身份部分有 | P9 |
| | 教学录制→Workflow/变量/回放 | 无 | P9 |
| **反馈** | 浮层反馈按钮/截图 | 无 | 缓 |
| **洞察** | 每日回顾/深度洞察/IM 推送 | 无 | 预留（D11） |

---

## 4. 实施阶段总览

```text
P0  壳补完：新建选择弹窗 + 标题修复 + 顶栏项目 Tab          ✅ 已完成 2026-07-22
P1  聊天核心：消息流 + Compose + 流式 + 执行过程块           （最大优先级）
P2  智能体库 / 小队库配置页 + 对话管理（重命名/归档/搜索）
P3  小队执行：分工卡/问询卡/统筹代审/成员过程前缀/升级确认卡
P4  右栏四 Tab：文件预览 / 变更 / 任务 / 过程
P5  项目舞台：看板/排期/自动执行/终端/定时任务 + /plan /goal
P6  Skill 生态：目录兼容 + 消息级点选 + / 菜单 + 市场骨架
P7  模型页：CC Switch 一等 + Provider 管理 + 用量/圆环
P8  桌面存在感：主题系统/全局小窗/托盘/数据备份/设置全量/桌宠
P9  浏览器：Profile/接管/录制 Workflow
P10 切换与清理：新壳设为默认，删除旧 renderer 与 ui-kit 死代码
```

每阶段独立可验收；P0→P1→P2→P3 严格顺序，P4 起可按依赖并行。

---

## 5. 各阶段详细规格

### P0 · 壳补完（新建选择弹窗 + 标题 + 顶栏）— ✅ 已完成（2026-07-22 验收通过）

> 实施记录：P0.1 标题修复（targetName 接 provider 目录 + 「模型对话」兜底）；
> P0.2 `NewConversationDialog.tsx`（厂商→模型两级 + 搜索 + 空态引导跳库）；
> P0.3 `TopBar.tsx`（「全部」+ 项目 Tab + 打开文件夹，`filterByWorkspace` 过滤，
> 新对话归属当前项目）；P0.4 会话行右键菜单（Radix ContextMenu：重命名 prompt /
> 置顶 / 归档 / 删除二次确认）。备注：项目 Tab 的「关闭×」未做（关闭语义 =
> 移出最近使用，待 P5 项目管理一起定义）；重命名用原生 prompt，inline 编辑后补。
> 测试：shell-state 6/6；desktop tsc 通过；新壳构建通过。

**目标**：截图里的三个缺口——原始 targetRef 当标题、新建无选择、无顶栏项目 Tab。

1. **新建对话选择弹窗**（Radix Dialog）
   - 点「模型对话 +」→ 弹窗列出可用模型（`listProviders` + 各 provider 的 models；两级：厂商→模型）。选中 → `createConversation({track:'model', targetRef:<modelId>})`
   - 点「智能体对话 +」→ 列出 `listGlobalAgents()`（头像+名+默认模型）。空态给「去智能体库创建」跳转
   - 点「小队对话 +」→ 列出 `listTeams()`（头像+名+成员数）。空态同理
   - 文件：`shell/NewConversationDialog.tsx`（新）；`ShellApp.tsx` 的 `handleNewConversation` 改为开弹窗
2. **会话标题**
   - 侧栏行显示优先级：`conversation.title` → 目标显示名（模型 displayName / Agent 名 / 小队名）→ 轨道兜底
   - 模型 track 的 targetRef 需通过 provider/model 列表解析成 displayName（当前直接显示 id，这就是截图问题）
   - P1 接消息后：首条用户消息发送成功 → 用消息前 20 字生成标题（`renameConversation`），模型自动摘要标题 P2 再做
3. **顶栏项目 Tab**
   - 新组件 `shell/TopBar.tsx`：`listWorkspaces()` 渲染 Tab（名+关闭×）+「+ 打开文件夹」（`pickFolder` → `createWorkspace`/`bindWorkspaceFolder`）
   - 选中项目存 shell 状态 `activeWorkspaceId`；`listConversations` 带 `workspaceId` 过滤，另有「显示全部」开关
   - 无项目时可用（对话 workspaceId 为空 = 未归类）
4. **右键菜单**（Radix DropdownMenu）：会话行右键 → 重命名 / 置顶 / 归档 / 删除（全部命令已存在）

**测试**：shell-state 增加 workspaceId 过滤纯函数测试；弹窗组件渲染测试（列表/空态/选择回调）。
**验收**：新建三类对话都经弹窗选择；侧栏不再出现裸 id；顶栏可建/切项目并过滤对话。

---

### P1 · 聊天核心（最优先，最大一块）

**目标**：新壳里能真正聊天，体验对齐 NewMax 对话页。

1. **消息流组件** `shell/chat/MessageList.tsx`
   - IM 式：用户右侧/助手左侧 + 头像（用户默认头像；模型=厂商图标；Agent=头像；小队成员=各自头像）
   - Markdown 渲染 + 代码高亮（引入 `marked`/`react-markdown` + `shiki` 或轻量 highlighter；执行 AI 自选，要求 bundle 可控、支持暗色）
   - 数据源：现有 thread/message 通道。**接线要点**：conversation 需关联 task/thread —— 新增 runtime 逻辑：对话首条消息时惰性创建 task（`participation_mode` 按 track 映射），并把 `taskId` 写入 conversation（storage 加 `conversation.task_id` 列，迁移 0025；`SqliteConversationStore` 加 `bindTask`/读取）。消息收发复用现有 `task.appendMessage` / `runtime.subscribeEvents` 流式事件
2. **Compose** `shell/chat/Compose.tsx`
   - 多行输入（Enter 发送 / Shift+Enter 换行 / 中文输入法组合态不误发）
   - 工具条（NewMax 布局）：权限三档下拉（改 `setConversationExecutionMode`，发消息时随 payload 生效）· 联网开关 · 推理强度档位（自动/关/低/中/高，按当前模型能力裁剪；对话级记忆）· 模型覆盖下拉（仅本对话，不写回 Agent）· Skill 按钮（P6 前置占位）· @文件（P2）
   - 发送中变「停止」；Esc 二次确认停止
3. **执行过程块** `shell/chat/ProcessBlock.tsx`
   - 移植旧壳 `conversation-log-projection.ts` 的投影（该模块为纯函数，直接复用 import，不复制代码）；渲染折叠块：完成默认折叠、运行中展开、相邻合并×N、探索/修改/验证分组、步骤卡（路径/预览/复制/文件夹）
   - 深度思考块：结构预留，无 reasoning 流不渲染（同 D10）
   - 技术字段仅开发者模式（设置项 P8 前先用 localStorage 开关）
4. **流式与状态**：订阅事件增量渲染；断线显示重连横幅；发送失败该条消息标红可重试
5. **自动标题**：首条消息成功后 `renameConversation`（前 20 字），已有标题不覆盖

**测试**：Compose 输入法/快捷键行为；conversation↔task 绑定的 runtime 集成测试（发消息→事件流→消息落库→lastMessageAt 更新）；投影复用的渲染测试。
**验收**：新壳中新建模型对话 → 发消息 → 流式回复 + 执行过程块 + 自动标题 + 权限档实际生效（询问批准时出现确认卡）。确认卡复用现有对话内确认机制接入新壳。

---

### P2 · 智能体库 / 小队库 + 对话管理

1. **智能体库** `shell/agents/AgentLibrary.tsx`（侧栏「智能体库」→ 主舞台）
   - 卡片网格：头像/名/默认模型/描述；搜索框
   - 新建/编辑抽屉（Radix Dialog）：名称·头像(emoji或上传后置)·人设(persona 多行)·默认模型(二级选择)·备选模型·推理强度默认·装备 Skill 多选（`listSkills`）·MCP 多选（`listMcpServers`）·归档开关
   - 卡片操作：开始对话（建 agent-track 对话并跳转）· 编辑 · 归档 · 删除（被小队引用时后端会拒，前端展示该错误文案）
2. **小队库** `shell/teams/TeamLibrary.tsx`
   - 卡片：头像/名/成员头像堆叠/策略(串行|并行)
   - 编辑抽屉：名称·使命(mission)·策略·成员管理（从智能体库多选 + 每人 role/title/拖拽排序 + dependsOn 选择）·统筹智能体（必须是成员，后端已校验）
   - 操作：开始小队对话 · 编辑 · 删除（有历史运行后端拒删 → 前端提示「有历史运行，建议归档改名」）
3. **对话管理补全**：跨对话搜索框（先本地过滤标题，FTS 接入 P5）；归档区（侧栏底部「归档」折叠组）；`conversation.delete` 二次确认
4. **@文件与附件**：Compose 支持 @ 引用当前项目文件（列目录+模糊过滤）；拖拽文件作为附件（走现有消息附件通道，若无则新增 message blocks 附件类型——执行 AI 先查 `blocksJson` 现有结构再决定）

**验收**：不写代码也能全程 UI 建 Agent → 组小队 → 从库发起对话；三轨闭环。

---

### P3 · 小队执行与协作卡片

1. **分工卡** `shell/chat/PlanCard.tsx`
   - 触发：小队对话首次任务 或 模型判断需拆分。Runtime 侧：team 对话发消息时把 roster snapshot + mission 注入系统提示，要求模型输出结构化分工 JSON（新增 application tool `sync_think.team.propose_plan`，handler 落一条 pending 分工卡消息 block）
   - UI：目标 + 成员条目（头像/角色/任务，成员可换下拉）+ 串/并行切换 + 按钮「采用并开始 / 改后再确认 / 先不拆」
   - 确认 → `team.startRun`（冻结快照）→ 条目变逻辑子任务（嵌本对话，D6）
   - **统筹代审**：team.coordinatorAgentId 存在时，Runtime 允许该 Agent 直接确认分工卡，消息流显示「已由 <统筹名> 审核采用」+ 审计事件；统筹**不能**代替权限档确认危险工具（D1）
2. **问询卡** `shell/chat/AskCard.tsx`：选项（推荐项高亮默认选中）+ 补充说明输入 + 确认/跳过；对应 application tool `sync_think.ask_user`（若已有类似机制则复用）；等待时系统通知（P8 完善）
3. **成员执行**：过程块步骤标题带成员前缀（`前端小张 · 读取文件 · a.tsx`，单成员省略——投影层已支持多 Agent 前缀，接上 speaker 信息即可）；子任务进度条消息（N/M 完成）；全部完成 → `team.setRunStatus('completed')` + 汇总消息
4. **升级确认卡**：模型直聊中用户表达组队意图 → AI 输出建议卡「是否升级为小队对话？」→ 确认 → `conversation.upgradeTrack`（保历史）。Compose 菜单也提供手动「转为智能体对话 / 组成小队」
5. **AI 建智能体/小队**：聊天里说「帮我建一个只写测试的智能体」→ application tool `sync_think.agent.draft` 产出草稿卡 → 用户确认 → `globalAgent.create` / `team.create`。**禁止静默写入**

**验收**：小队对话完整闭环：分工卡→确认（人或统筹）→成员执行（前缀过程块）→汇总；升级流程带确认；AI 建的 Agent 出现在全局库。

---

### P4 · 右栏四 Tab

`shell/rail/RightRail.tsx`，可关闭，Tab：**文件 / 变更 / 任务 / 过程**（+ 开发者模式下「诊断」）。

1. **文件**：点消息/过程块里的路径自动打开；文本/代码只读预览（mono、行号、复制、在文件夹中显示——复用已有 `reveal-task-path` root 校验 IPC，路径仅限任务执行目录内）；图片/MD 渲染；其余类型显示元信息+打开方式
2. **变更**：write/edit 成功后自动切入；改动文件列表 + diff 视图（复用 git_diff 数据或产物版本 diff）
3. **任务**：分工/子任务进度（P3 数据）；可跳转项目看板（P5 后）
4. **过程**：整轮执行时间线（与对话内同一投影源）；开发者模式显示 Run/Step/原始事件
5. 自动弹出规则：点路径→文件；写文件→变更；分工确认→任务；从不自动弹诊断

**验收**：四 Tab 数据真实；文件打开有 root 边界（越界拒绝并提示）；深浅色正常。

---

### P5 · 项目舞台（长期放养对齐）

1. 侧栏「项目」→ 主舞台 Tab：**对话 | 看板 | 排期 | 设置**
2. **看板**：待办/进行中/已完成/审核 四列拖拽（任务数据用现有 task 表 + 状态映射；缺列则迁移加 `board_status`）
3. **排期**：任务列表 + 优先级 + 计划时间 + 依赖（`step_dependency`/任务依赖已有底层）+ 计划文档（MD 编辑器，存产物或项目文件）
4. **自动执行引擎**：Runtime 定时轮询（60s）到点任务；依赖满足才跑；串行；单任务超时上限；失败重试 1 次；完成系统通知。任务用项目默认权限档；命中「询问批准」时挂起并通知（不静默放行）
5. **项目设置**：默认权限档、默认对话对象、项目级追加 Skill、通知渠道占位（飞书/企微/Webhook 表单先落库不发送，D11）
6. **终端**：输入区旁开终端面板（xterm.js + node-pty，最多 9 会话，后台续跑）
7. **定时任务**（独立于项目）：设置里建单次/每天/每周任务，指定项目/模型/Skill，执行记录，错过补跑
8. **斜杠命令**：`/plan`（先出可审批大纲再执行）、`/compact`（手动压缩上下文）、`/goal`（自主循环+停止条件）——`/plan` 优先，后两个可移 P8
9. **搜索升级**：FTS 接入跨项目对话全文搜索（`fts.ts` 已有 messages FTS）

**验收**：拖对话进项目；看板拖拽改状态；到点任务自动跑并通知；/plan 出大纲需确认。

---

### P6 · Skill 生态

1. **目录兼容**：启动扫描 `~/.claude/skills` + 项目 `.claude/skills`；ZIP/文件夹导入（解析 SKILL.md frontmatter，复用 skill-store 的 parse-only 边界：**导入永不执行脚本**）；同名覆盖更新
2. **能力页** `shell/abilities/`：我的 Skill（搜索/启停/卸载/范围全局|项目）+ MCP 管理（复用现有命令）+ 市场 Tab 骨架（先「官方精选」静态清单，安装走同一导入管线）
3. **消息级点选**：Compose Skill 按钮多选（本条消息生效）+ 输入 `/` 弹 Skill 菜单；Agent 装备的 Skill 自动生效不用点（D5），UI 上以浅色标签显示「来自智能体装备」
4. Skill 注入：选中 Skill 的 body 进当前消息上下文（复用现有 allowlist/注入机制）

**验收**：外部 skills 目录能被发现并一键启用；/ 菜单可点选；Agent 装备自动生效。

---

### P7 · 模型页（CC Switch 一等，🟡 进行中）

> 2026-07-24 已完成两轮 NewMax 截图对齐切片：设置分类栏 + 启用模型栏 + Provider 详情栏；模型媒体 Tabs；启停、排序、多密钥、优先级；使用统计 `24h / 7天 / 30天 / 全部`、四张独立 KPI 卡、请求/供应商/模型/工具/定价五视图；工具成功失败与最近失败明细；模型定价添加/编辑/删除、本机持久化及分币种费用估算。缓存费用字段已接好，但只有供应商真实返回缓存用量时才展示；CC Switch 完整预览确认流程仍待补完。

1. 设置→模型 或 能力页：**「从 CC Switch 导入」大按钮**（预览 diff → 确认导入，命令已有 `provider.previewCcSwitchImport`/`importCcSwitch`）
2. Provider 管理：列表/新增（OpenAI/Anthropic 兼容 + Base URL 自定义）/多 Key 组（credential_group）/不可用自动切换状态展示
3. 模型二级选择器组件抽公共（P0 弹窗与 P1 Compose 覆盖共用）
4. 上下文占用圆环（Compose 右下角：tokens 用量/上限，数据来自 provider.usage 事件）
5. 用量统计页：按天/模型聚合 tokens 与估算费用
6. 规划模型/执行模型分离设置（/plan 用规划模型）

**验收**：CC Switch 30 秒接通全部现有模型；圆环实时；用量页有真数据。

---

### P8 · 桌面存在感 + 设置全量（🟡 进行中）

> 2026-07-24 已完成两组切片：
> 1. Runtime 冷启动 Node 20 / pipe 复用修复；
> 2. 设置界面按用户提供的 NewMax 参考图严格重构（`1064×720` 上限、设置搜索+完整分类入口、通用/个性化分段、紧凑设置行、右下“完成”、模型媒体 Tabs、启用模型列表+详情三栏）。未接能力仅保留入口并明确未接，不再自行发明设置布局。P8 其余桌面能力仍待实现。

1. **主题系统**：设置→外观：浅色/深色/跟随系统；预设主题（墨绿=现 accent、霁青、极简、霓虹、奢华——每套 = 一组 token 覆盖，实现为 `.theme-<name>` class 重定义 `@theme` 变量）；自定义主色（HSL 选择器 + 自动生成 hover/active/soft 派生色 + 对比度校验 WCAG≥4.5）；聊天字号 13-18；减少动画（`prefers-reduced-motion` + 手动开关）
2. **全局快捷键小窗**：`globalShortcut` 注册（默认 Alt+Space 可改）；无边框小窗：输入框+模型选择+权限档，回车发送到「未归类」新对话并弹主窗
3. **托盘**：单击弹小窗；右键菜单主窗口/退出；开机自启到托盘（`app.setLoginItemSettings`）
4. **通知**：AI 等待确认/问询/任务完成 → 系统通知；点击聚焦对应对话
5. **数据**：导出 JSON（全部/当前项目）；导入；自动备份（手动/每天/每周，复用 backup.ts）；存储统计+清理；「清空本机数据并退出」二次确认
6. **设置全量收口**：个性化（称呼/工作描述/全局提示词）· 通用（快捷键/托盘/自启/通知/更新/阻止休眠）· 权限默认档+命令白名单 · 网络代理（HTTP/SOCKS5+绕过列表）· 搜索服务（Tavily/Exa/Brave/秘塔… 多选配置）· 开发者日志开关（P1 的 localStorage 迁到设置真源）· 通知渠道（飞书/企微/Webhook 表单，D11 预留）· 关于
7. **桌宠**（本阶段末）：开关+宠物包目录（`pet.json` + `spritesheet.webp`，兼容 `~/.codex/pets`）+ 尺寸 70-120% + 置顶透明窗拖动 + 气泡显示问询/完成通知（点开跳对话）+ 显隐快捷键
8. **导出对话为图片**：整轮渲染离屏 → PNG（可选脱敏）

**验收**：换预设主题全 UI 即时生效无硬编码色残留；小窗/托盘/通知全链可用；备份文件可导回；桌宠常驻可互动。

---

### P9 · 浏览器自动化

1. **Profile 多账号**：独立用户数据目录的 Chrome/Chromium 实例；Cookie 隔离；关联域名；导入/导出登录态；双击开窗
2. **卡点接管**：执行中检测验证码/登录/支付页 → 暂停 + 问询卡「我已处理完，继续」→ 人工操作后续跑
3. **教学录制 → Workflow**：录制点击/输入序列 → 标记变量 → 保存为 Workflow（新表 `browser_workflow`：名称/步骤 JSON/变量/成功率统计）→ 回放（新开对话问变量，低 token 重放）；能力页浏览器 Tab 列 Workflow 库
4. 对话内自然语言操控（复用现有 browser_* 工具，接入过程块展示：`打开网页 · host`）

**验收**：录一个「登录后台并导出报表」流程，改变量回放成功；卡点接管完整闭环。

---

### P10 · 切换与清理

1. ~~`SYNC_THINK_SHELL` 默认值翻转为新壳；旧壳改为 `SYNC_THINK_LEGACY=1` 逃生口~~ **已完成（2026-08-18）**：开关连同逃生口一起删除，主进程无条件加载 `dist/renderer-shell/index.html`
2. ~~两个版本共存一个迭代收集问题后：删除 `src/renderer/`（旧）全部文件与 `build-renderer.mjs`~~ **已完成（2026-08-18），但原文说法需订正**：`src/renderer/` **不是**纯旧壳目录，新壳从其中 import 共享逻辑（`conversation-activity.ts` / `runtime-connection.ts` / `run-activity-authority.ts` / `ui-preferences.ts` 等），只删了旧壳 UI 层（`index.tsx` / `index.html` / `renderer.css` / `build-renderer.mjs`）与 `packages/ui-kit/src/styles/`。`m0-*`/`m1-*`/`m2-*` 等只服务旧壳的逻辑模块及 `packages/ui-kit` 遗留组件仍在，留作单独清理任务
3. 旧本机 UI 偏好置顶 → 已由 DB 置顶替代，删除偏好读写代码
4. 全仓 test/typecheck/build + 手工冒烟清单（三轨对话/小队执行/右栏/项目/主题/托盘）
5. changelog + 本规格标记完成状态

**切换时发现的三处功能缺口**（均为既存问题：旧壳是唯一消费方，删旧壳把它们变成不可达，不是本次改坏的）：Artifact 图片预览（`getArtifactImagePreview`）、Artifact 合并冲突列举/解决（`listArtifactMergeConflicts` / `resolveArtifactMergeConflict`）、`bindWorkspaceFolder`（新壳只在创建时通过 `pickFolder` 绑定）。三者的 Main/preload/protocol 侧仍完整，缺的只是新壳 UI 入口。

---

## 6. 横切要求（每阶段都适用）

1. **每阶段交付物**：代码 + 聚焦测试 + `docs/development/03-feature-changelog.md` 条目 + 全仓 build 通过
2. **深浅色**：任何新 UI 必须两种主题下检查；只用 token
3. **安全边界不放宽**：文件打开/reveal 仅任务根内；导入的 Skill 永不自动执行脚本；完全访问≠绕过 root 校验
4. **权限语义**（D1）：任何新工具执行路径只读 `conversation.execution_mode`，禁止新增第二权限面
5. **迁移纪律**：新列/表 = 新迁移 + `migrate.test.ts` 顺序断言更新 + 种子/回填幂等
6. **性能**：消息流虚拟滚动（>200 条）；列表预览 DOM 上限（如 list 100 行）；预览限高滚动
7. **禁止**：全局重排事件顺序；静默升级对话轨道；给 Agent/成员加权限字段；硬编码颜色

---

## 7. 建议执行顺序与并行性

```text
串行主线：P0 → P1 → P2 → P3
P4（右栏）依赖 P1 过程块，可与 P3 并行
P6（Skill）/ P7（模型）与 P4/P5 可并行（不同目录，冲突面小）
P8 依赖面广（设置真源），放 P5-P7 之后
P9 独立性强，可随时插入但建议 P8 后
P10 收尾
```

单阶段内：先数据/命令 → 再 UI → 再测试收口。每阶段完成后重启验证（`pnpm dev:runtime` + `pnpm dev:desktop`；`SYNC_THINK_SHELL` 已删，不再需要设）。
