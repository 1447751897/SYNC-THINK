# Grok Bot 协作机制调研

调研日期：2026-09-10
对象：xAI 的 **Grok Bot**（前身为 Cursor 团队的 agent 产品线，早期 Beta）

---

## 一句话结论

Grok Bot 的协作不是"多智能体框架"，而是**把人类团队的组织形状直接搬给 AI**：一个账号一台共享电脑，若干有名字、有职责、有记忆的常驻 Bot 在同一台机器上并行工作，通过**共享文件系统 + 直接互发消息 + 共享线程/频道 + 任务所有权转移**来协作。核心设计目标是官方原话："**you are not the router between tools**"（你不该是工具之间的路由器）。

---

## 1. 产品定位

- 一个 Bot = 一个**有名字的常驻 AI 队友**，跑在自己的云 VM 上，带浏览器、文件系统、终端。
- 优先用 connector/MCP；没有 API 的网站和应用就走 **computer use**，像人一样操作。
- 产出直接落进真实工具里，而不是聊天草稿。
- 使用方式就是"像给同事派活一样"发消息：任务 + 上下文 + 访问权限。
- 记忆、文件、浏览器会话、偏好跨轮次持久化，上下文累积而非每次重置。

---

## 2. 协作的四个层次

### 2.1 共享计算机 —— 协作的物理底座（最关键的一层）

一个账号 = **一台持久云电脑**，所有 Bot 共用。

- 文件、浏览器会话、应用登录态、`/workspace` 全部共享 → 交接（handoff）不需要重新配置环境。
- 每个 Bot 有自己的**独立屏幕**，所以可以并行操作浏览器/桌面。
- 你可以实时观看任意 Bot 的屏幕并**接管控制**——这正是处理 2FA、验证码、登录、支付确认的官方流程：Bot 请求 → 你操作 → 交还控制权 → 会话被保存复用。

**代价（明确的权衡）**：隔离边界在**账号级，不在 Bot 级**。
官方原话：*"A login made by one bot is available to the others."*
→ 放进去的任何东西都要假定所有 Bot 都能访问，Bot 之间**没有独立的安全边界**。

**这是一次用"隔离"换"协作零摩擦"的设计取舍**——协作顺畅的根源正是这里，安全风险的根源也在这里。

### 2.2 Bot 之间的直接通信

官方文档描述的能力：

- Bot 能**互相直接发消息**（message each other directly）。
- 能**转移任务所有权**（hand off ownership）。
- 能参与**多 Bot 群聊**。
- "Bots coordinate independently with other Bots"——自己协调，不需要人当中间人。
- 官方**没有**使用 "subagent" 这个词。最接近的机制就是"共享上下文的并行 Bot"。

### 2.3 频道 + 看板 —— 把人类团队的形状套上去

来自 xAI 官方 Guide《How I run multiple teams of Grok Bots》（作者 Eric Zakariasson，2026-08-27，标注为实验性模式）：

- **核心模式："One project, one channel, one roster."**
  每个项目 = 一个 Grok Bot 频道 + Notion 数据库里的一行。
- 建两个 Notion 库：**Projects** 和 **Tasks**。
- 更高层的 **projects Manager（复数）** 负责跨项目协调，靠一个 "Project Ops skill" 来建项目、开频道、配人。
- **编制规则**：
  - 优先复用已定义的 Bot（Coder / Researcher / Writer…），而不是新建。
  - 每项目最多 5 个 Bot + 1 个 PM，频道上限 6 人（作者自称是随意定的数）。
  - 只有板凳上没人能胜任时才新建，且**必须人类批准**。新 Bot 可以是可复用专家，也可以是一次性项目专属。
- **协调方式**：
  - 人类在频道里用 roster 划分任务。
  - PM "主要看进度、维护数据库"，不干实际活。
  - **某 Bot 卡住或需要输入时，会把任务标为 `Blocked`，然后在频道里 ping 我（人类）。**
  - 任务卡在看板上可见地移动。

### 2.4 分工拓扑 —— Chief of Staff + 窄专精

- 可选 **Chief of Staff** 协调者角色，负责把活分配给专家。
- 强烈建议：**"Prefer creating narrowly specialized bots rather than one 'universal' assistant"**——窄专精优于万能助手。
- 示例角色：Sales Outbound、Expense Manager、Talent Scout、Bug Reproduction。
- Bot 的定义 = 名字 + 一块职责 + 描述（风格 / 约束 / 偏好）+ 记忆 + 上下文。
- 目的是避免出现一个过载的 mega-agent。

---

## 3. Skills / Routines —— 能力的沉淀与自动化

**Skill** = 一套可复用的"如何做某件事"的指令，规定：
何时使用、需要什么输入和访问权限、步骤序列、结果如何校验、返回什么、哪些环节需要人类批准。

- 三种来源：① 让 Bot 保存一个已完成的任务；② 直接写描述；③ **Teach a task**（录屏教学，≤10 分钟，无音频）。
- 作用域：**对账号下所有 Bot 可用**（前提是该 Bot 有相应访问权限），可按 Bot 单独开关。

**Routine** = 一个 workflow 绑定到**一个 Bot** + 调度或事件触发，在后台运行。

- 限制：每个 Bot 最多 **50 个 routine**，只保留最近 **20 条**运行记录。
- 官方推荐演进路径：**先手工跑顺 → 存成 skill → 再转成 routine**。

> 注意：*Teach a task*（看一遍演示就能学会并持久化）和 *Skill 账号级共享* 是这套协作里"知识传递"的主要载体——**协作不只靠消息，还靠共享的能力库**。

---

## 4. 审批、身份与安全边界

**审批（Approvals）**
- 默认在以下动作前暂停：发送对外消息、金融操作、删除数据、改动生产系统。
- 审批卡显示拟执行的操作和输入，选项：`Allow once` / `Always allow` / `Deny`（移动端为 Approve once / Deny）。
- 审批管的是**拟执行的动作**，不管已完成的工作。
- 边界可以写在 Bot 描述、skill 或 routine 里。

**Auto Review**
- 一个**独立的审查模型**在执行前评估高风险动作：shell 命令、插件调用、computer use、自动化写入、**委派启动（delegation launches）**，可以放行 / 要求审批 / 拒绝。
- 默认对所有用户启用，每个成员的开关就是关掉它的方式，**没有组织级锁定**。
- 团队级 block/allow 指令在团队设置 → Security and Automation；个人规则在 Settings → General → Auto-review，冲突时"要求审批"的规则优先。
- 覆盖不全（内存写入、多数设置变更不管），所以它是审批 + 网络策略 + 用户隔离的**补充**，不是替代。

**身份（Identity）**
- 成员用 Cursor 账号登录，沿用现有 Cursor SSO（SAML 2.0：Okta / Entra / Google Workspace / OneLogin），可强制 SSO 禁用密码登录。SCIM 2.0 仅 Enterprise。
- **Bot 没有自己的身份或凭据**——它以已登录成员的身份行动，**"永远不会拥有超过其所属人的访问权限"**，每个动作都可归因到具体成员。
- 唯一例外：团队管理的 connector 可能使用团队或服务账号凭据。
- Connector token 存在后端，不放在电脑上；登录 / 2FA / 支付步骤交给成员，敏感输入被掩码。

**网络策略（Enterprise only）**
- 自服务的 Teams **看不到这个面板**，无法设置 allowlist；没有策略时**默认 allow-all**。
- 条目可以是域名或 IP 段 + 端口，数量不限。
- 该策略在电脑**创建或重建时**生效 → 改完要重启或重建。
- 限制的是"数据能去哪"，**没有专门的 DLP 钩子**。
- 阻断插件不会挡住该服务网站——connector 策略和网络策略是**两层**。
- 静态出口：托管电脑用所有客户共享的静态出口 IP 段，**不提供按客户的独立 IP**。

**清理与撤销**
- Admin 可从 dashboard 终止成员的电脑；磁盘持久数据保留，下次会话全新开始，建议同时在 IdP 撤销会话。
- 成员侧清理：暂停/删除 routine、登出网站、卸载插件并撤销授权、清掉 `/workspace` 里的敏感文件。
- **删除 Bot 不会删除电脑文件和浏览器会话。**

---

## 5. ⚠️ 官方面板 vs 社区实证的落差（最有价值的一条）

| | 官方文档宣称 | 官方 Guide 里的实际做法 |
|---|---|---|
| Bot 间通信 | 直接互发消息、转移所有权 | 卡住 → 标 `Blocked` → **ping 人类** |
| 协调流经 | Bot ↔ Bot | **人类 + PM 维护的数据库 + 共享频道** |
| 人类角色 | 不必当路由器 | 实际仍是关键节点 |

**解读**：官方能力层面支持点对点 Bot 委派，但在**真实可用的模式**里，协调反而流经**共享状态（看板/数据库）+ 共享频道 + 人类**，而不是纯 bot-to-bot 消息协议。

→ 这暗示：**共享可见状态 + 人类在环，比"让 agent 互相发消息"更可靠。** 消息协议看起来酷，但看板/频道这种"人类团队本来就有的形状"更容易调试、更容易监督、也更容易信任。

官方自己给的 Guide，也是**把人类协作的形状套给 AI**（board、manager、specialists 认领任务、Blocked 列、channel），作者自己也说这套结构"越来越像最初为人类搭的系统"。

---

## 6. 生态信号

- **分享机制**：每个 Bot 可生成 `x.ai/bot/...` 公开分享链接，别人点 "Add to Grok Bot" 即可用。
  - 社区收录了 **700+ 个 live share**，分 8 类：Personal admin 196、Research & briefings 122、**Teams & handoffs 101**、Content & publishing 99、Coding & shipping 66、Finance & ops 47、Customer & sales 37、Inbox & calendar 33。
  - 注意：分享**不复制**作者的电脑、文件、登录态、API key，需要重新连 connector，建议先跑只读任务。
  - ⚠️ 同一账号下的多个 Bot **共用一台电脑**。
- **第三方 distro 案例**：`grok-ship`（已标注被 x.ai 官方 Firstmate 模板取代）——把 Bot 变成"软件工厂"：
  - Firstmate（唯一对话入口）+ 每项目一个 crewmate + scout/ship 分工 + sqlite backlog（"chat is not the source of truth"）+ **PR 前的对抗式 review**（"No pull request until that pass is clean"）+ **人类保留 merge 权**。
  - 关键设计：**Bot 从不在你的本地机器上执行**——Bot 在共享云电脑上，实际构建跑在临时的 Cursor cloud agent 上。
- **开源替代**：Rakazo、OpenMausBot、gawkbot 等。
- **计费**：Pro $20/月、SuperGrok $30/月、Teams $40/席位/月（集中计费 + 团队市场 + 分析 + SSO）。

---

## 7. 对做 Agent 协作产品的启示

1. **共享环境 > 消息协议**。Grok Bot 协作顺滑的根本原因是"同一台电脑"：共享文件、共享登录态、共享屏幕。消息只是表层，共享状态才是底座。
2. **隔离与协作是零和的**。它把隔离从 Bot 级上提到账号级，换来零摩擦交接，代价是没有任何 Bot 间安全边界。做产品必须显式选择，并把这个取舍讲给用户。
3. **人类应该是团队成员，不是路由器**（官方目标），但**实证表明人类仍是关键节点**——尤其在 Bot 卡住时。好的设计应该让"标 Blocked + 升级到人"成为一等公民。
4. **窄专精 > 万能 agent**。多而专的 roster + 一个协调者，胜过一个大 agent。
5. **能力需要沉淀机制**。Skill（可复用指令，账号级共享）+ Routine（绑定单个 Bot 的调度）是它把"一次性任务"变成"组织能力"的路径。推荐的演进顺序：手工跑顺 → skill → routine。
6. **审批要分层**。动作级审批（Allow once / Always allow / Deny）+ 独立的 Auto Review 模型 + 网络策略，是三层互补，任何一层都不够。
7. **身份继承，而非独立授权**。Bot 不持有自己的凭据，永远不超过所属人的权限，所有动作可归因——这是安全叙事上很干净的一条。

---

## 来源

- 官方文档：`docs.x.ai/grok-bot/overview`、`/grok-bot/security`
- 官方产品页：`x.ai/bot`
- 官方 Guide：《How I run multiple teams of Grok Bots》`x.ai/bot/guides/how-i-run-multiple-teams-of-grok-bots`（+ Guides 索引）
- 官方 repo：`github.com/xai-org/grok-prompts`
- 社区：`github.com/grok-bot-app/grok-bot`（多方 Bot + 团队协作说明）、`github.com/kunchenguid/grok-ship`、`github.com/kydlikebtc/awesome-grokbot`、`RongleCat/awesome-grok-bot`
- 第三方拆解：mindstudio.ai、techpresso、openclawdatabase、linas.substack 等

> 注：Grok Bot 处于 Early Beta，功能与计划可能变动；部分细节来自非官方社区指南。
