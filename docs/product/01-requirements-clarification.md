# Requirements Clarification

> Source of truth for product intent: `docs/superpowers/specs/2026-07-11-sync-think-product-design.md`  
> Status: product/system design approved; implementation not started  
> Date: 2026-07-11  
> Spec language note: the approved design is English for cross-tool handoff; this file summarizes in Chinese for daily project use. Locked decisions must not be reopened without a new requirement.

## 1. 项目一句话描述

```text
本项目是：一个 local-first、用户可控的多模型 Agent 桌面工作台（SYNC-THINK）。
用户可在同一任务中组合不同供应商、中转网关、API Key、模型、Agent、Skill、MCP、本地文件、浏览器控制与桌面自动化；
系统负责可靠执行、上下文连续、权限、可追溯、恢复与可复用编排，而不是替用户“自动挑模型”。
```

## 2. 目标用户

| 用户类型 | 使用场景 | 核心诉求 |
| --- | --- | --- |
| 多模型重度用户 | 同时持有多个 API Key / 中转站 / 模型，跨客户端切换 | 一个任务里连续切换模型与 Agent，无需反复粘贴上下文 |
| 个人开发者 / 创作者 | 规划、编码、生图、审查混在同一任务 | Agent 绑定模型可长期保持；过程可检查、可干预 |
| 闭测邀请用户（5-20 名 Windows 用户） | 愿意自己配置 Provider，接受 Alpha/Beta 限制 | 主路径稳定、不丢任务、不泄密、可恢复 |

## 3. 核心问题

本项目要解决的问题：

1. 多 Provider / 多 Key / 多模型之间切换时，上下文、决定、文件与产物无法连续。
2. 用户无法稳定地把“某个 Agent 固定到某个模型 + 凭证组”，并在任务中保持该绑定。
3. 现有配置切换器、网关、工作流工具、多模型聊天客户端都只解决局部问题，缺少 local-first 的 Agent Runtime + 桌面工作台。
4. 多 Agent 协作时缺乏可检查的计划审批、权限门禁、产物版本与恢复能力。

不解决的问题（闭测非目标，见设计文档 §25）：

1. 消费级订阅登录 / 非官方 Cookie 或 token 提取。
2. 自动全局搜索“最好/最便宜”的模型并静默替换。
3. macOS / Linux 分发、云端执行、多用户实时协作、公开市场。
4. 首版视频 / 音频生成、任意未审查 Skill 脚本静默执行。
5. 跨项目静默共享记忆。

## 4. 核心功能

| 功能 | 用户价值 | 优先级 | 是否首版必须 |
| --- | --- | --- | --- |
| 本地文件夹 Workspace + 任务树 | 任务挂在真实工作目录下，可定位 | P0 | 是（Phase 1） |
| 单 Agent 多轮对话（默认） | Codex 式主体验，低门槛 | P0 | 是（Phase 1） |
| Provider / 凭证组 / 模型管理与探测 | 统一接入多供应商与中转站 | P0 | 是（Phase 1） |
| OpenAI-compatible + Anthropic-compatible 流式调用 | 覆盖主流通用协议 | P0 | 是（Phase 1） |
| Agent 持久模型绑定 + Run 覆盖 + 回退链 | 用户控制调度，系统不静默换模型 | P0 | 是（Phase 1） |
| Context Packet + Manifest | 上下文可检查、可修订，连续性可证明 | P0 | 是（Phase 1） |
| 完整浅色 / 深色主题 + 可折叠 Run 轨迹 | 冷静主工作台，过程可检视 | P0 | 是（Phase 1） |
| 对话 / 协作 / 自动三种参与模式 | 从聊天渐进到多 Agent | P0 | 是（Phase 2） |
| 计划审批 + 持久 Run 状态机 | 执行可暂停、可恢复、可审计 | P0 | 是（Phase 2） |
| 验收门禁 / Reviewer / 有界返工 | 多 Agent 结果可收敛 | P0 | 是（Phase 2） |
| Skill 导入（SKILL.md）+ MCP 授权 | 可复用能力与工具 | P0 | 是（Phase 2） |
| 审批策略 + 人类专属动作列表 | 安全默认 | P0 | 是（Phase 2） |
| Artifact 版本 / 对比 / 合并 / 回滚 | 并行产物不互相覆盖 | P0 | 是（Phase 2） |
| 文件 / 终端 / Git / Playwright / Windows UI Automation Worker | 真正可执行本地工作 | P0 | 是（Phase 3） |
| 图像生成与视觉审查管线 | 生图进入同一任务上下文 | P0 | 是（Phase 3） |
| CC Switch 配置导入 | 降低已有用户迁移成本 | P0 | 是（Phase 3） |
| 安装包、签名、更新、诊断、崩溃恢复 | 闭测可交付 | P0 | 是（Phase 3） |
| 官方 OAuth / CLI 桥 / 云同步 / 团队 / 市场 | 长期能力 | P2 | 否（Later） |

## 5. 关键业务流程

### 5.1 闭测必须打通的端到端旅程

```text
用户添加 2 个中转站 Provider（手动或导入 CC Switch）
  -> 预览并确认导入的 Provider / 凭证组 / 模型 / 密钥
  -> 创建 4 个 Agent：规划、执行/设计、生图、审查
  -> 每个 Agent 绑定模型、凭证组、可选回退链、记忆范围、Skill/工具权限
  -> 打开本地文件夹并创建任务
  -> 与规划 Agent 进行多轮对话
  -> 规划 Agent 提出执行计划；用户编辑或批准
  -> Runtime 创建 Run，生成 Context Packet，启动批准的 Agent
  -> Agent 顺序或并行工作，产物使用隔离快照
  -> 生图 Agent 调用用户绑定的图像模型
  -> Reviewer 按验收标准审查并要求返工（有上限）
  -> 用户可查看消息、上下文转移、模型调用、凭证组选择、工具动作、审批、产物、审查证据
  -> 用户可暂停、干预、折叠轨迹、回到对话模式、稍后恢复
  -> 全程无需重述原始目标、约束、决定与文件引用
```

### 5.2 参与模式切换（同一任务内）

```text
对话模式（默认，单 Agent 多轮）
  <-> 协作模式（提出计划与 Agent/模型绑定，用户确认后执行）
  <-> 自动模式（在已批准策略、重试上限、回退链、验收门禁内继续）
```

### 5.3 模型解析优先级（Locked）

```text
1. 当前 Run 显式选择的模型
2. 工作流节点覆盖
3. Agent 持久默认
4. Agent 用户配置的回退链
```

规则：Run 覆盖只影响该 Run，除非用户明确保存为新默认；系统永不选择未配置的替代模型。

## 6. 权限与角色

闭测阶段以**单机单用户**为主，不引入团队 RBAC。权限重点是工具与动作门禁。

| 角色 / 主体 | 可执行操作 | 不可执行操作 |
| --- | --- | --- |
| 用户（真人） | 配置 Provider/Agent/Skill/策略；批准计划与受保护动作；暂停/取消 Run；导出诊断（脱敏） | 绕过人类专属动作列表 |
| 审批 Agent（可选） | 在策略范围内评估受保护动作 | 批准人类专属动作 |
| 执行 Agent | 使用其 allowlist 内的 Skill/MCP/工具；在授权目录内操作 | 读取无关凭证；越权路径；静默换模型 |
| Runtime | 编排、上下文编译、策略执行、审计、恢复 | 把密钥写入 Renderer / 日志 / 导出 |
| Worker | 在最小能力令牌与作用域目录内执行单次任务 | 持有无关密钥；绕过策略 |

### 人类专属动作（不可被 Agent 或 Full Approval 绕过）

- 访问或创建新密钥
- 支付 / 购买
- 公开发布
- 以用户身份发送外部消息
- 修改身份或权限策略
- 不可逆删除
- 向批准边界外导出敏感数据

### 用户可选审批模式

- Request approval
- Delegate approval
- Full approval（仅策略内）
- Custom（按工具 / 目录 / 命令 / 站点 / 动作）

最严格适用规则优先，除非用户创建更窄且可审计的覆盖。

## 7. 数据对象

| 数据对象 | 关键字段 / 内容 | 说明 |
| --- | --- | --- |
| Workspace | 本地文件夹边界、项目设置、策略 | 左导航起点 |
| Task | 目标、状态、验收标准、引用、任务级上下文 | 挂在文件夹下 |
| Thread | 有序多轮消息 | 任务内对话 |
| Run | 已批准执行计划与生命周期 | 持久状态机 |
| Step | 可执行单元、依赖边、Agent 版本、状态、重试 | 跨恢复 ID 稳定 |
| Artifact / ArtifactVersion | 逻辑产物与不可变快照、来源 Step、合并祖先 | 禁止 last-write-wins |
| Event | 追加式执行事实与审计 | 恢复与追溯来源 |
| MemoryChange | 增/改/弃用、证据、范围、置信度 | 可回滚；非自动把原始对话当事实 |
| Provider / CredentialGroup / CredentialRef / Model | 协议、Base URL、凭证引用、能力标签 | 密钥只存安全引用 |
| AgentVersion / SkillVersion / McpServer / Policy / WorkflowVersion / AcceptanceGate | 版本化定义 | 历史 Run 引用确切版本 |

上下文三层：

1. 当前任务完整上下文
2. 结构化项目记忆与项目产物
3. 少量用户级偏好

跨任务内容仅在显式引用或授权时进入 Context Packet。

## 8. 验收标准

闭测完成必须满足（摘自设计文档 §23.2）：

1. 同一任务可使用至少 2 个 Provider、3 个模型，用户无需重述上下文。
2. Agent 默认、Run 覆盖、凭证组、精确钉死、回退链遵守已批准优先级。
3. 每次模型调用都有可检查的 Context Manifest。
4. 每个工具、审批、产物、审查决策可追溯。
5. 重启应用可恢复进行中工作，且不重复已完成副作用。
6. 数据库、日志、诊断、提示词、导出中不出现明文 API Key。
7. 未授权工具与人类专属动作无绕过路径。
8. 主工作台支持：本地文件夹任务分组、完整聊天历史、用户右/Agent 左、单栏阅读选项、完整浅/深主题、可折叠轨迹。
9. Provider / 协议限制可见且可行动。
10. 自动化测试、构建、类型检查、视觉回归、安装包与升级验证通过。
11. 5-20 名邀请用户完成核心旅程，无数据丢失或高危权限缺陷。
12. 已知限制与恢复说明可在诊断中获得。

## 9. 待确认问题

| 问题 | 影响范围 | 当前状态 | 结论 |
| --- | --- | --- | --- |
| 产品名 SYNC-THINK 是否作为对外正式名保留 | 产品 / 品牌 | 暂定工作名 | 闭测可继续使用；正式品牌后续再定 |
| 第 24 节技术 spike 的具体库选型 | 技术 | 待 Phase 0 验证 | 不改变产品边界；见 tech decisions |
| 最终视觉品牌（V3 仅为结构基线） | 前端设计 | 暂定结构基线 | Phase 0/3 单独视觉 refinement |
| 闭测分发渠道（直接安装包 / 内部分享） | 部署 | 待确认 | Phase 3 前确认 |
| 用户界面语言默认值 | 产品 | 建议中文优先，可后续 i18n | 闭测默认简体中文 |

## 10. 已锁定原则（禁止重开）

1. **上下文连续性优先**：应用拥有任务状态真源；模型会话不是真源。
2. **用户控制路由**：用户给 Agent 绑模型；系统不静默替换。
3. **渐进编排**：先单 Agent 对话，再按需协作/自动。
4. **Local-first**：首版模型调用、密钥、任务状态、工具均本地。
5. **可检查行为**：上下文包、模型选择、凭证组、工具、审批、产物、记忆变更均可追溯。
6. **默认安全**：工具访问有范围；人类专属动作不可绕过。
7. **定义可移植**：Agent/Skill/工作流/策略版本化，后续可共享且不共享凭证。
8. **无成本驱动模型替换**。
9. **一个冷静主体验**：聊天为主；图、轨迹、审批、上下文按需展开。
10. **有辨识度但功能性的设计**：动效解释状态与交接，不装饰。

## 11. 架构摘要（已选）

- Desktop UI + 独立本地 Agent Runtime 双长生命周期进程
- 高风险工具使用短生命周期 Worker
- Electron + React/TypeScript UI
- 独立 Node.js/TypeScript Runtime
- SQLite 真源 + 事件/检查点
- OS 安全凭证存储
- Playwright Worker + Windows UI Automation Worker
- 明确的 OpenAI-compatible / Anthropic-compatible 适配器

完整实体、状态机、安全模型、路线图与 spike 清单以产品设计文档为准。
