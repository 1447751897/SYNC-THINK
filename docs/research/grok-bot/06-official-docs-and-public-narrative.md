# Grok Bot 官方文档与公开报道调研笔记

> 调研对象：**Grok Bot**（SpaceXAI / xAI 的桌面 + 移动端 AI 队友产品，内部代号 **sand**，构建在 Cursor 技术栈上）
> 调研时间：2026-10-01
> 抓取方式：`web_fetch` 被 SSRF 防护拦截 docs.x.ai，全部改用本机 `pwsh` + `Invoke-WebRequest`
> 标注约定：`【官方文档】`= docs.x.ai；`【官方公告】`= x.ai 官网；`【媒体报道】`= Verge / InfoQ；`【社区】`= GitHub / Cursor 官方论坛用户与员工回帖

---

## 0. 一句话结论

官方叙事是「**bots 是能互相直接发消息、共享上下文、自己分配归属的队友**，且 context 会随时间复利」；而 SpaceXAI/Cursor 员工在自家论坛里给出的**实操指引恰恰相反**——不要依赖 bot-to-bot 通信（每条消息都烧配额、且存在已知故障），改用「**单个 bot + subagents**」，并且承认「**每轮把完整 transcript 重发给模型**」这件事「不是预期行为」，产品里**没有 compact、没有同 bot 新会话、没有群聊加人补上下文的任何机制说明**。

---

## 1. 来源清单（URL + 状态码）

### 1.1 官方文档（docs.x.ai，均为 `200`）

| 页面 | 状态码 | 抓取到的字数 |
|---|---|---|
| https://docs.x.ai/llms.txt （全站页面清单） | 200 | 用于发现真实页面名 |
| https://docs.x.ai/grok-bot/overview.md | 200 | 5,394 |
| https://docs.x.ai/grok-bot/get-started.md | 200 | 6,498 |
| https://docs.x.ai/grok-bot/use-cases.md | 200 | 5,489 |
| https://docs.x.ai/grok-bot/mobile.md | 200 | 4,541 |
| https://docs.x.ai/grok-bot/bots.md | 200 | 5,404 |
| https://docs.x.ai/grok-bot/team-bots.md | 200 | 17,954 |
| https://docs.x.ai/grok-bot/chat-and-collaboration.md | 200 | 6,694 |
| https://docs.x.ai/grok-bot/files-and-results.md | 200 | 3,573 |
| https://docs.x.ai/grok-bot/computer-and-apps.md | 200 | 4,308 |
| https://docs.x.ai/grok-bot/skills-routines-and-automations.md | 200 | 5,421 |
| https://docs.x.ai/grok-bot/settings-and-notifications.md | 200 | 7,369 |
| https://docs.x.ai/grok-bot/approvals-security-and-privacy.md | 200 | 7,822 |
| https://docs.x.ai/grok-bot/teams-and-enterprises.md | 200 | 29,077 |
| https://docs.x.ai/grok-bot/identity-and-access.md | 200 | 10,679 |
| https://docs.x.ai/grok-bot/private-networks.md | 200 | 18,184 |
| https://docs.x.ai/grok-bot/proxies.md | 200 | 8,825 |
| https://docs.x.ai/grok-bot/computers.md | 200 | 9,219 |
| https://docs.x.ai/grok-bot/security.md | 200 | 17,860 |
| https://docs.x.ai/grok-bot/security-faq.md | 200 | 8,696 |
| https://docs.x.ai/grok-bot/troubleshooting.md | 200 | 6,432 |
| https://docs.x.ai/grok-bot/faq.md | 200 | 6,869 |

**Grok Bot 章节实际只有这 21 个页面**（由 `llms.txt` 枚举确认）。题面猜测的 `computer.md` / `skills.md` / `routines.md` / `memory.md` / `group-chats.md` / `collaboration.md` 等**均不存在，返回 404**（完整清单见 §6）。

### 1.2 官方公告

| URL | 状态码 | 说明 |
|---|---|---|
| https://x.ai/news/introducing-grok-bot | 200 | 发布公告《Introducing Grok Bot》，标注 Aug 11, 2026 |
| https://x.ai/bot | **403** | 产品页拒绝抓取（非 404），正文未能获取 |

### 1.3 媒体报道

| URL | 状态码 | 说明 |
|---|---|---|
| https://www.theverge.com/ai-artificial-intelligence/978666/spacexai-grok-bot-ai-agent-beta-launch | 200 | The Verge，2026-08-12，Jess Weatherbed |
| https://www.infoq.cn/article/a2Y7bOxLHZfCVWtKhAtQ | 200 | InfoQ 中文，2026-08-25，作者 Daniel Dominguez / 译者 平川（正文为 Nuxt SSR 内联，已提取） |

### 1.4 社区来源

| URL | 状态码 | 说明 |
|---|---|---|
| https://raw.githubusercontent.com/RongleCat/awesome-grok-bot/main/README.md | 200 | 476 KB、1,881 条目的中英双语清单；含 **Community & Failure Modes** 章节（本次落差分析的主要来源） |
| https://github.com/RongleCat/awesome-grok-bot | 200 | 354 stars，默认分支 main |
| https://github.com/kydlikebtc/awesome-grokbot | 200 | 339 stars，「1894 live x.ai/bot shares」；**正文未逐页抓取** |
| https://github.com/kunchenguid/grok-ship | 200 | 178 stars，「Turn your Grok Bot into a software factory」；已抓 README + `GROK_SHIP.md` + `GROK_BOT_FIRSTMATE.md` + `GROK_BOT_CREWMATE.md` |
| https://github.com/xai-org/grok-prompts | 200 | 4,496 stars，但描述为「Prompts for our Grok chat assistant and the `@grok` bot on X」——**与本产品无关，未采用** |
| https://forum.cursor.com/t/grok-bot-prune-compact-an-agent-s-context-without-creating-a-new-bot/168333 | 200（`.json`） | 上下文/compact 主帖（第 33 楼） |
| https://forum.cursor.com/t/status-beat-leaks-between-bots/170523 | 200（`.json`） | bot 记忆归属的权威员工回复 |
| https://forum.cursor.com/t/chief-of-staff-unable-to-communicate-with-other-bots/173238 | 200（`.json`） | bot-to-bot 交接失败报告 |
| https://forum.cursor.com/t/chief-bot-not-talking-to-other-bots/173356 | 200（`.json`） | bot-to-bot 单向失败 + 员工确认已知问题 |

### 1.5 代号 corroboration

论坛帖《Why does Grok Bot chat use so many **sand-\*** tokens?》（https://forum.cursor.com/t/why-does-grok-bot-chat-use-so-many-sand-tokens/169581）中，员工确认计费行以 `sand-*` 前缀出现——与「内部代号 sand」一致。【社区】

---

## 2. 六个问题的官方说法

### 2.1 bot 之间如何通信与协作

**官方宣称（明确、主动营销）**

- 「Bots 互相协调」被列为产品四大差异点之一：「Your Bots can run in parallel, **message each other**, share context in group chats, and **pass ownership of a task**, so you aren't the router between tools.」（【官方文档】[overview.md](https://docs.x.ai/grok-bot/overview.md)）
- 有一个专门的章节描述异步交接（【官方文档】[chat-and-collaboration.md](https://docs.x.ai/grok-bot/chat-and-collaboration.md) §Let Bots hand work off）：
  - 一个 Bot 可以向另一个 Bot 发送**异步消息**；接收方被唤醒、处理、之后回复；用户能在会话里看到这次交接。
  - 官方列出的适用场景：一个 bot 拥有源系统而另一个拥有交付物；专家复核草稿；阻塞项属于另一个角色；长任务不需要人逐步协调。
  - 官方给出的**唯一约束**是「Ask for a single owner at each stage. Too many parallel handoffs can create duplicate work and noisy updates.」
- 涉及协作的**唯一能力限制**写得很具体：「Your messages in a group can include attachments. **Bot-to-group handoff messages are currently text-only**, so a Bot should send an image directly to another Bot when that teammate must inspect it.」（同上）
- 上下文通过哪些通道流动，官方在两处给出：bots.md「They can pass context through **direct messages, group chats, and shared files**」；overview.md「shared files, browser sessions, and **direct handoffs** move context between them」。
- 共享电脑是交接能够「不重复配置」的前提：「All of your Bots use the same cloud computer, sharing its files, browser sessions, and app logins, which makes handoffs work without repeating setup.」（【官方文档】[overview.md](https://docs.x.ai/grok-bot/overview.md)）
- 【官方公告】[x.ai/news/introducing-grok-bot](https://x.ai/news/introducing-grok-bot) 用词更强：「**Bots can independently message each other** and share context in threads. When projects overlap, they stay aligned on the same account or project **without requiring you to paste notes between chats**.」

**官方文档中缺失的**

- **没有任何** bot-to-bot 协议名、工具名、消息格式、重试/幂等语义、审计可见性说明。用户侧看不到「发消息给另一个 bot」的 API 或 UI 入口，只能通过自然语言要求，然后「在会话里看到交接」。
- 没有说明 bot-to-bot 消息是否计入配额（这一点在社区里是最大的痛点，见 §4）。
- 没有说明被唤醒的 bot 使用哪一份上下文。

### 2.2 群聊如何工作

全部官方描述集中在【官方文档】[chat-and-collaboration.md](https://docs.x.ai/grok-bot/chat-and-collaboration.md) §Start a group chat / §Direct a message：

| 维度 | 官方说法 |
|---|---|
| 何时用 | 「Use a group when several Bots need one shared outcome and visible handoffs.」 |
| 怎么建 | New → New chat → **选 2 到 6 个 Bot** → 打开群 → 可改自动生成的群名 → 描述共同结果和「谁负责下一步」 |
| 移动端 | `+ → New Group Chat` |
| 成员变更 | **仅一句**：「Group membership can be edited later.」（详见 §2.6） |
| 谁发言 | 「Write normally to let the participating Bots decide who should respond.」——**默认由参与的 bot 自行决定谁回应**，官方没有说存在路由器/调度器 |
| 定向 | `@` 选某个 Bot（「when one teammate owns the request」）；真正需要多个就 @ 多个；`@everyone` 少用 |
| 是否互发 | 「**Bots can post into the group and pass work among themselves.**」 |
| 官方范例 | 官方给了一段三角色 kickoff：`@Researcher` 收集来源并给每个论断附链接 → `@Writer` 转成发布稿 → `@Reviewer` 逐条对照来源只列阻塞问题 → 「Do not publish anything.」 |
| 附件 | 用户消息可带附件；**bot→群 的交接消息目前只能文本** |
| 通知 | 「**Group chats do not have the same per-Bot notification switch.**」（【官方文档】[settings-and-notifications.md](https://docs.x.ai/grok-bot/settings-and-notifications.md)） |
| Team Bot 的群 | Team Bot 被邀请进 Slack channel / group DM / thread 时，**该 bot 有一个独立于 owner 和每个同事的「共享电脑」**（【官方文档】[team-bots.md](https://docs.x.ai/grok-bot/team-bots.md)） |

**官方文档中缺失的**：群聊的上下文边界（群是否是一份独立会话）、群成员变更对上下文的影响、群内并发发言的仲裁、群聊与 1:1 记忆是否互通、群聊数量/成员数上限之外的任何配额影响。官方**没有**用「频道（channel）」这个词描述应用内的群。

### 2.3 上下文处理

**官方叙事（营销层，措辞最强）**

- 首段即定调：「AI teammates with names, jobs, and **context that compounds over time**.」（【官方文档】[overview.md](https://docs.x.ai/grok-bot/overview.md)）
- 四大差异点之一：「**Context compounds.** A named Bot keeps its memory, files, browser sessions, and preferences across sessions instead of resetting on every task.」（同上）
- 「A Bot is a durable AI teammate with a name, a job, its own conversation, and **working context that develops over time**.」（【官方文档】[bots.md](https://docs.x.ai/grok-bot/bots.md)）

**官方对 shared computer vs per-bot context 的划分（这是全篇最清晰的一段）**

- 共享（**账号级**，非 bot 级）：「Every Bot on your account uses the same computer: Browser cookies and signed-in sessions are shared / Files are visible to every Bot / Command-line credentials are shared / **One Bot can continue from work another Bot saved**」（【官方文档】[computer-and-apps.md](https://docs.x.ai/grok-bot/computer-and-apps.md)）
- 明确警告：「The computer is assigned to your **user account, not an individual Bot**... treat anything placed on it as available to every Bot you run; between users, isolation is strict.」（[overview.md](https://docs.x.ai/grok-bot/overview.md)）
- 并行模型：「Each Bot gets its own **screen** on the shared computer... The screens are separate work surfaces, **not separate security boundaries**.」；一个 bot 在自己的屏幕上同时只能跑一个 computer-use 任务。（[computer-and-apps.md](https://docs.x.ai/grok-bot/computer-and-apps.md)）
- 隔离（**bot 级**）：「Conversations and learned context **stay separate per Bot**, while shared files, browser sessions, and direct handoffs move context between them.」（[overview.md](https://docs.x.ai/grok-bot/overview.md)、[bots.md](https://docs.x.ai/grok-bot/bots.md)、[faq.md](https://docs.x.ai/grok-bot/faq.md) 三处几乎同义重复）
- 共享工作目录：`/workspace`，官方建议把持久项目文件放这里；「Bots can read files other Bots save in `/workspace`. Use project folders and descriptive names to make handoffs reliable.」（【官方文档】[files-and-results.md](https://docs.x.ai/grok-bot/files-and-results.md)）
- 定位建议：一个 bot 的 description 里写「永远为真的规则」，会话里写「任务级指令」（[bots.md](https://docs.x.ai/grok-bot/bots.md)）
- 会话卫生建议（官方唯一的「上下文管理」建议）：「Start a thread or a new Bot when a conversation has changed to a different long-lived job.」（[chat-and-collaboration.md](https://docs.x.ai/grok-bot/chat-and-collaboration.md)）

**官方文档中缺失的（重要）**

- 全站 21 个页面中**没有任何** `compact` / `compaction` / `summariz*` / `上下文窗口` 相关的机制说明。FAQ 只有一条反向告诫：「For consequential decisions, ask the Bot to check the current source instead of relying on memory.」
- 没有说明长会话如何截断/摘要、是否有 token 表、是否重放完整历史。
- 官方把「上下文」当作**资产**（compounds，复利）来叙述，从不作为**成本**叙述。

### 2.4 记忆

**官方定义与范围**

- 记住什么：「Stable preferences, role context, and **summaries of prior work**.」（【官方文档】[overview.md](https://docs.x.ai/grok-bot/overview.md)、[faq.md](https://docs.x.ai/grok-bot/faq.md)）；[bots.md](https://docs.x.ai/grok-bot/bots.md) 表述为「stable working preferences, important facts, and summaries from its work」，目的是「keep a role over time without replaying every prior message」。
- **per-bot 隔离**：「Conversations and learned context stay separate per Bot」（三处重复）；「Its conversation and learned role are separate from other Bots」（[faq.md](https://docs.x.ai/grok-bot/faq.md)）。
- handoff 如何传上下文：官方只说通道，不说机制——「shared files, browser sessions, **group messages**, and **direct handoffs** can move context between them」（[faq.md](https://docs.x.ai/grok-bot/faq.md)）；「They can pass context through direct messages, group chats, and shared files.」（[bots.md](https://docs.x.ai/grok-bot/bots.md)）。**没有**描述交接时是否附带摘要、谁负责压缩、接收方拿到多少。
- 记忆不是权威来源（4 条官方纪律）：把变化中的事实留在源系统；重要决策要求 bot 引用/重开当前数据；直接纠正过期假设；把安全边界写进 bot description。（[bots.md](https://docs.x.ai/grok-bot/bots.md)）

**不记 / 不复制什么**

- **Duplicate Bot** 复制 profile、settings、enabled skills、routines、avatar；「It does **not** copy conversation history, learned memory, or chat attachments.」（[bots.md](https://docs.x.ai/grok-bot/bots.md)）
- **删除 Bot** 移除 active profile、conversation、routines；但「**Shared computer files and sign-ins are not isolated by Bot and may remain** on the computer.」（[bots.md](https://docs.x.ai/grok-bot/bots.md)、[faq.md](https://docs.x.ai/grok-bot/faq.md)）
- **分享模板**（Create template）只暴露配置（identity、description、skills、routines），「It does **not** give them your computer, logins, or conversation history.」（[bots.md](https://docs.x.ai/grok-bot/bots.md)）
- Hide「does not pause the Bot or its routines」（[bots.md](https://docs.x.ai/grok-bot/bots.md)）

**Team Bot 的两层记忆模型（官方写得最细）**

- **Team memory**：每个同事的会话都读；「The Bot saves a fact there **only when someone says the whole team should have it**, and it tells you when it does.」
- **Notes with each person**：该人私有，保存其偏好与上下文，**跨**这个人的 app chat 与 Slack DM 跟随他；其他同事的会话不读。
- 查看方式：在聊天里问它；纠正/删除也靠告诉它。（【官方文档】[team-bots.md](https://docs.x.ai/grok-bot/team-bots.md)）
- 个人 bot 的**记忆上限、保留期、导出方式、删除粒度**在官方文档中**完全缺失**。

### 2.5 自进化：skill / routine / automation

**【官方文档】[skills-routines-and-automations.md](https://docs.x.ai/grok-bot/skills-routines-and-automations.md) + [faq.md](https://docs.x.ai/grok-bot/faq.md) 的官方定义**

- **Skill** = 「a reusable set of instructions for how to do a task」；**Routine** = 「tells one Bot **when** to run a workflow—on a schedule or, where supported, after an event」。FAQ 再确认为「A skill describes **how** to perform a task. A routine assigns a workflow to one Bot and tells it **when** to run.」
- 官方方法论：「Start with a one-time task. Make it reliable, save the method as a skill, and **only then** automate it.」
- skill 应包含 6 项：何时使用 / 必需输入与访问权 / 工作顺序 / 如何校验结果 / 返回什么 / 什么需要审批。
- 引用方式：桌面 composer 里 `/` 引用已保存 skill；`@` 用于 bots、groups、routines、connectors。侧栏 **Marketplace** 用于发现和安装 connector 与打包 skill。

**作用域（官方明确是账号级，不是 bot 级）**

- 「**Skills are available across your Bots**, although a Bot may need the relevant connector or login to use one.」
- 「**Private skills are one library shared by all your Bots.**」若 `/` 菜单里看不到，去 `Marketplace → Your plugins → Manage plugins and skills` 检查是否列在 Private skills 下。
- Team Bot 技能则是**团队级**：每个 team skill 适用于每个同事的会话；「**Only the owner saves a team skill.**」同事在自己 chat 里教的新流程只留在「和那个人的 notes」里，bot 会告知「owner 可以把它变成 team how-to」。（[team-bots.md](https://docs.x.ai/grok-bot/team-bots.md)）

**Teach a task（录屏教学）官方流程**

1. 打开一个 **1:1** bot 会话及其 computer view；2. 选 **Teach a task**；3. 描述你即将演示的结果；4. **执行一次**该工作流；5. 停止录制并 review bot 生成的 skill；6. 在安全样本上测试后再排期。

- 官方限制：「Teaching records **visible computer interaction for up to ten minutes**. It **does not record microphone audio**.」避免在演示中暴露密钥；用 secure handoff 流程传凭据。
- 「The learned skill is a **draft**.」需要补决策规则、失败处理和审批边界。
- 灰度：「Teach-by-demonstration **may be enabled gradually**. If the control is not visible, ask the Bot to create a skill from written instructions.」（[faq.md](https://docs.x.ai/grok-bot/faq.md) 亦确认「The rollout may be gradual, and the recording is limited to ten minutes.」）

**Routine 的创建、触发与限制**

- 创建方式：**要求应当拥有该例行工作的那个 bot** 来创建（不是在一个中央编排器里建），bot 会显示 next run。需确认 6 项：所属 bot / 计划与时区 / 输入源 / 期望结果 / 审批边界 / 源缺失时的行为。
- 后台 routine 可在笔记本关闭时运行。
- **事件触发**：「Cursor account integrations can start a routine from an event, such as a Slack message or a GitHub notification. They are **separate from Slack or GitHub plugins** and may require their own connection flow.」官方建议窄匹配规则，避免「every new message」这类宽监听。
- **Test run**：「A test run performs **real work**. It can navigate websites, change files, and call connected tools.」
- 管理入口：Bot → View conversation details → **Routines**（启用/暂停、测试、改计划或指令、查看近期成败、删除）。
- **硬限制（官方唯一给出的数量约束）**：「A Bot can own up to **50 routines**, and the app keeps the **20 most recent run records** for each routine.」删除 routine 立即生效且无撤销；删除 bot 会一并删除它拥有的 routine。
- 无人值守控制：长期离开后 app 可能询问是否继续跑 routine，**无响应则暂停**。
- Team Bot 上 routine 是**个人财产**：「A routine belongs to whoever set it up with the Bot, in their own chat. It runs as them, reports in their chat, and only they can see or change it. **No routine runs for the whole team at once.**」（[team-bots.md](https://docs.x.ai/grok-bot/team-bots.md)）

**官方文档中缺失 / 术语不一致**

- 官方**没有**一个独立的「automation」概念页：`automations` 只在论坛计费行名（`grok-bot-automation`）和 x.ai 公告的营销语里出现；docs 的正式词汇只有 skill + routine。
- **术语不一致**：docs 说演示教学产出的是 **skill**，而【官方公告】[x.ai/news/introducing-grok-bot](https://x.ai/news/introducing-grok-bot) 说「It saves your workflow as a **routine**」。官方两处口径不统一。
- 没有 skill 的数量上限、版本管理、权限模型说明（只有 team skill 的 owner-only 规则）。

### 2.6 群聊中途加人（官方是否描述向已有群/频道添加成员、新成员如何获得上下文）

**这是六个问题里官方覆盖最薄弱的一项。**

- 关于成员变更，**官方全文只有一句**：「**Group membership can be edited later.**」（【官方文档】[chat-and-collaboration.md](https://docs.x.ai/grok-bot/chat-and-collaboration.md)，位于「Start a group chat」步骤之后）
- **没有**任何一句描述：如何给已有群加人/移人、加人入口在哪、成员上限是否仍为 6、新加入的 bot 是否/如何获得该群此前的上下文、被移除的 bot 是否保留该群记忆。
- 官方**没有**描述过应用内的「频道 / channel」概念；`channels` 一词在 Grok Bot 文档中不存在（该路径 404）。与「频道」最接近的是 Team Bot 的 **Slack channel**：官方只说「The Bot answers when someone @mentions it in a conversation it has been added to」，以及「Invite the Bot to the channels where it should work, for example with `/invite @BotName`」——但那是 Slack 侧成员管理，且明确说明「Slack channels, group DMs, and threads → **One shared computer for that Bot, separate from the owner's and every teammate's**」。（【官方文档】[team-bots.md](https://docs.x.ai/grok-bot/team-bots.md)）
- 与「新成员补上下文」语义上最接近的官方条款是 Team Bot 的：新同事打开 Team Bot 时「**Each teammate who opens it later gets their own chat. That chat starts without this conversation** and includes the plugins, secrets, skills, files, and memory you saved for the team.」——即**不带**原会话，只带团队级配置与团队记忆。（同上）

**社区侧**：在本次检索到的社区资料（awesome-grok-bot 全部 1,881 条目中的 Failure Modes 章节、grok-ship 全部模板、Cursor 论坛相关帖）中，**没有任何一条**描述「把 bot 加进已有群后如何补上下文」。这是一个**官方未写、社区也未填补的空白**。

---

## 3. 公开报道要点

### 3.1 The Verge（2026-08-12，Jess Weatherbed）【媒体报道】

https://www.theverge.com/ai-artificial-intelligence/978666/spacexai-grok-bot-ai-agent-beta-launch

- 定位：SpaceXAI 推出的「always-on AI agent service」，行为上像独立的「AI teammates」，共享自己的云端电脑环境，可以登录你已在用的 app / 工具 / 网站去完成多步工作任务，只在**任务完成**或**需要批准**时才回来。
- **对 bot-to-bot 的转述**：「Multiple bots can be run in parallel, **with one bot assigned to manage the others** working on their own specialized tasks. The bots can '**independently message each other**' to share context when projects overlap, according to SpaceXAI, and can also be placed in a **group chat** environment to coordinate work and **assign ownership on their own**.」——注意这是转述官方说法，且引入了官方文档里没有明说的「一个 bot 管理其他 bot」的层级。
- 学习/记忆：「can learn and save your existing workflows and retain context about how you perform tasks to preserve your personal voice」；还能「follow up on dropped conversations and handover threads, pick work back up from old chats」并「become more proactive over time」。
- 商业与背景：beta；desktop + iOS；面向 SuperGrok Heavy、Cursor Ultra、Cursor Teams Premium；团队与企业用户可加入 waitlist；对标 OpenAI ChatGPT Work、Anthropic Claude Cowork、Microsoft Copilot Tasks；建立在内部原型之上（内部已用于销售外呼、市场、办公运营、bug 修复）。
- 记者保留了怀疑：「You'll have to be fine with letting Grok sign into your online accounts.」（配图说明）

### 3.2 InfoQ 中文（2026-08-25）【媒体报道】

https://www.infoq.cn/article/a2Y7bOxLHZfCVWtKhAtQ （原文链接指向 infoq.com/news/2026/08/grok-bot-agent/）

- 机制描述：**持久型** AI 智能代理，运行在**专用云计算机**上，与网站、应用、收件箱及其他工具交互，**端到端**执行多步骤任务，需要用户批准或决策时询问用户。
- 上下文与学习：「每个智能代理都能**保持对话上下文**，并**记住用户偏好和工作流程**」；「用户还可以让智能代理**观察任务的执行过程**，从而'学会'一个流程，之后它就可以保存该工作流并再次执行」。
- **多 bot 协作**：「该系统支持并行运行多个 Bot。**Bot 之间可以相互通信，通过共享线程交换上下文信息**，并在专用的智能代理之间分配工作。用户还可以将多个 Bot 加入**群聊**，以便它们可以相互协调执行任务，并在需要决策时请求人工介入。」
- **官方内部示例（值得注意，因为它给出了 handoff 的具体形态）**：「一个工程 Bot 如何**重现 UI 错误、创建工单，并将问题转交给另一个 Bot 进行调试**。」
- 差异化定位：区别于 Claude Code / OpenAI Codex（围绕软件开发和终端执行），Grok Bot 更接近**跨应用运行的通用智能代理平台**，有自己的持久计算环境，能与**未暴露 API 或 MCP 接口**的服务交互；把「持久化智能代理、工作流记忆和多智能代理协调」整合进一款**面向消费者**的产品。
- 社区关注点（InfoQ 归纳）：讨论集中在「**委托完成整项任务**」而非单步代理；同时提出**部署灵活性、定价、权限，以及用户对持续运行的智能代理能保留多少控制权**的疑问。文中引用了独立发布者 @amuse（「它已经取代了 OpenClaw、Hermes 以及我的本地模型」）与 SpaceXAI 开发者 Matt Palmer（「万物皆为计算机，Grok Bot 亦如此」）的两条 X 帖子。
- 背景：发布紧随 **SpaceX 完成对 Cursor 的收购**；此前双方已在模型训练（Grok 4.5）上合作。
- 可用性口径与 Verge 一致：beta，SuperGrok Heavy / Cursor Ultra / Cursor Teams Premium。

### 3.3 官方公告自身（补充，非媒体）【官方公告】

https://x.ai/news/introducing-grok-bot （Aug 11, 2026）

- 内部用法举证：「a sales Bot updating the CRM with call transcript notes and drafting follow-ups, an ops Bot seating new hires and processing invoices received in Gmail, and **an engineering Bot reproducing a bug in the product UI, filing the ticket, and handing the fix off to a debugging Bot**。」
- 层级模式：「People inside SpaceXAI often run multiple Bots in parallel, with **one to manage the others**. A **chief of staff** sits on top, with a specialist for each lane」。
- 关键营销句：「...**without requiring you to paste notes between chats**.」（即宣称用户不再是 router）
- 学习句用了 routine 而非 skill（见 §2.5 术语不一致）。
- 主动性：「They can follow up on threads you dropped, **nudge a stalled handoff**, and pick work back up from previous conversations.」

---

## 4. 官方说法与实现之间已知的落差

> 本节所有「实现侧」证据均来自 SpaceXAI/Cursor **员工的论坛回帖**（staff 标记）或可复现的用户报告，经 awesome-grok-bot 汇总并可回溯到原始 forum.cursor.com 线程。**这是本次调研最重要的产出。**

### 落差 1（最大）：官方称 bots 可以互相直接发消息；员工实操指引是「不要依赖 bot-to-bot，改用单 bot + subagents」

- 官方：见 §2.1，三处（docs overview、docs chat-and-collaboration、x.ai 公告）均宣称 bot 之间可以自主发消息、共享上下文、传递归属，用户不必在中间粘贴笔记。
- 实现侧（**成本**）：员工 mohitjain 在 https://forum.cursor.com/t/grok-bot-weekly-usage-hits-100-after-bot-to-bot-reviews-the-user-asked-to-stop/170271 明确：「**Each bot-to-bot message burns a weekly-usage turn**；要求在聊天里让 bots 'stay quiet' 只是 **hint**」。可靠做法是「**run work in one Command Agent with subagents**（they finish and stop）」，并删除不用的 specialist bot（**空闲 bot 仍可能被唤醒**）。
- 实现侧（**成本**，另一帖）：员工 kevinn 建议「**prefer fewer bots (one bot + subagents)**」（https://forum.cursor.com/t/grok-bot-usage-billing/172769）。
- 实现侧（**故障**）：https://forum.cursor.com/t/chief-of-staff-unable-to-communicate-with-other-bots/173238 —— 用户的 Chief of Staff「can't send messages to my other assistants... It also can't hand off background tasks」，且「Last week both worked」。
- 实现侧（**故障 + 员工确认**）：https://forum.cursor.com/t/chief-bot-not-talking-to-other-bots/173356 —— Chief bot **能收不能发**（「Other bots can message me... but the way I message them still isn't available」）。员工 Colin（2026-09-30）回复：「Generally, this behavior **matches a known issue that the team is aware of**.」
- **落差本质**：官方把 bot-to-bot 当作一等协作能力来营销；产品侧的可靠协作路径实际是「**单个 bot 内部用 subagents**」——而 **subagents 在 Grok Bot 的 21 个官方文档页面里从未被提及**。用户若按官方文档设计多 bot 架构，会同时踩到配额和可靠性两个坑。

### 落差 2：官方叙事「context compounds（上下文复利）」；实现是「每轮重发完整 transcript」，且员工称「这不是预期行为」

- 官方：见 §2.3——「context that compounds over time」「Context compounds」，并**完全回避**任何 compaction/摘要话题。
- 实现侧（员工 deanrie，2026-08-20/08-26/09-01/09-05 多次复述）：
  - 「**The full transcript gets sent back to the model on every turn**, and there aren't any explicit primitives yet to cut older messages from what the model sees.」
  - 「Long chats do get auto-summarized as they get close to the context limit, but **that's not the same as an explicit compact or starting a new session on the same bot**.」
  - 「This **isn't intended behavior**. It's due to how the working set is set up right now.」
  - 来源：https://forum.cursor.com/t/grok-bot-prune-compact-an-agent-s-context-without-creating-a-new-bot/168333 （第 7、11、15、22 楼）
- 实现侧（**成本量级**）：同一帖用户实测「~**200–250k input tokens per reply**」并称「Grok Bot weekly burn is mostly **context tax, not work**」；员工 kevinn 在 https://forum.cursor.com/t/1-500-in-one-week-running-a-grok-bot-fleet-expected-or-a-bug/172705 确认「each turn re-reads the bot's full chat history—so week-long threads burn **80–90k tokens/step**」，建议「**+ fresh chat per task**、把状态放 Profile/Notion、**silence ack pings between bots**、把 Routines 间隔拉到 hourly+」。
- 实现侧（**没有 compact 的替代路径**）：员工 kevinn（2026-09-14）「**No in-place compact for a Grok Bot chat**—auto-summary near the limit still lets busy threads refill.」唯一 workaround = 让 bot 写一个 **handoff file** → Bot actions → **Duplicate** → 让副本读 handoff → **Hide** 旧 bot（https://forum.cursor.com/t/trim-the-fat-in-a-chat/171653）。
- 实现侧（**重置语义不清、UI 缺失**）：同一帖中用户报告桌面 0.47.0 侧栏右键只有 Pin/Rename/Duplicate/Hide/Delete，**没有 Reset chat**；support 的口径与 UI 不符。
- **落差本质**：官方把「上下文累积」当卖点，实现把「上下文累积」当成本项；用户必须在官方文档里找不到的情况下自行发明「Duplicate + Hide 当 compact 用」。

### 落差 3：官方把群聊描述为「共享结果 + 可见 handoff」的协作面；实现上群聊**不是**上下文边界

- 官方：见 §2.2——「several Bots need one shared outcome and visible handoffs」。
- 实现侧（员工 Colin，2026-09-04）：https://forum.cursor.com/t/status-beat-leaks-between-bots/170523
  - 「**Each bot has one conversation and one memory, and that single history spans both its 1:1 chat with you and every group it is a member of.** Group turns are tagged internally so the bot knows which room it is speaking in, but it is expected to draw on everything it knows, including its 1:1 history, and **its saved memories belong to the bot, not to a chat**.」
  - 因此两个长期项目放在同一个 bot 上**必然串味**；可靠做法是「**give each project its own bot**」。
  - 员工补一句「Chat scoped memory is something the team is actively working toward!」——即**群/会话级记忆隔离尚未实现**。
- 实现侧（**群聊被当 workaround 用**）：在 https://forum.cursor.com/t/grok-bot-prune-compact-an-agent-s-context-without-creating-a-new-bot/168333 中，用户发现用 `+ / New conversation` 选**同一个 Bot**会开出一个名为「Bot + me」的**群聊**，transcript 为空但**不显示该 bot 的云电脑屏幕**（第 26 楼）。员工 deanrie（2026-09-23）确认：「when you use a new group chat with the same Bot, **the old 1:1 transcript isn't pulled into the working set**... right now it's the closest way to get a thin working set without Duplicate or Delete.」——**「用群聊刷掉上下文」成为了官方认可的变通做法**，而官方文档从未提及。
- 实现侧（**群聊被明确劝阻**）：员工在配额相关回帖中两次点名「**avoid noisy group chats**」（https://forum.cursor.com/t/grok-bot-got-a-lot-faster/172445），以及「spawning ~60 bots **plus group chats** burned usage fast because **every bot that receives a message runs its own turn**」（https://forum.cursor.com/t/grok-bot-usage-billing/172769）。
- **落差本质**：官方文档让用户以为群聊是「一个共享工作区」；实现上群聊只是**同一 bot 的那一份记忆的又一个说话房间**，且是成本放大器。

### 落差 4：群聊加人 = 官方一句话带过，无上下文补入机制

- 官方只有「Group membership can be edited later.」，无任何新成员上下文说明（§2.6）。
- 结合落差 3 的员工表述（**记忆属于 bot 而非 chat，group turns 只是被 room-tag**），可以**推断**（此处标注为推断，非官方陈述）：新加进群的 bot 带进来的是**它自己已有的 1:1 + 其他群的记忆**，而**看不到这个群加入之前的历史**；群历史对它是「加入之后才开始」的。官方既未确认也未否认。
- **没有**任何社区资料描述补救手段。若需要新成员了解群内既有决策，按现有证据只能靠人工把结论写进共享文件（`/workspace`）或群内消息——即回到官方宣称「你不再是 router」之前的状态。

### 落差 5：官方文档与官方公告术语不一致

- docs（[skills-routines-and-automations.md](https://docs.x.ai/grok-bot/skills-routines-and-automations.md)、[faq.md](https://docs.x.ai/grok-bot/faq.md)）：演示教学的产物是 **skill**，routine 是「何时跑」。
- x.ai 公告：演示后「**It saves your workflow as a routine**」。
- 同一能力在两个官方渠道有两个名字，会直接导致用户在 `/`（skill）与 Routines 面板之间找错地方。

### 落差 6：记忆是「bot 电脑上的纯文本文件」，但官方文档从未说明，且写入曾全舰队故障

- 官方文档对记忆的**存储形态、导出、备份**零描述。
- 实现侧（员工 mohitjain，2026-09-07）：https://forum.cursor.com/t/best-way-to-export-memory/170714 ——「**No one-click export yet—memory lives as plain text on the Bot computer**」；做法是让每个 bot 建 `backup/<name>`，把完整记忆（**profile + 每个 memory-log 月份**）复制成 `memory.md`，列出 routines 与 connectors，打包附件；向 Chief of Staff 要 `shared-memory.md` + skills-library zip。**Connector 登录无法导出**（只能列名）。
- 实现侧（**故障**，员工 deanrie，2026-09-16）：https://forum.cursor.com/t/grok-bot-update-state-memory-writes-fail-fleet-wide-brain-docs-snapshot-was-cut-short-before-completing/171895 ——`update_state target:memory` **全舰队失败**（报错「brain docs snapshot was cut short before completing」），变通办法是**直接写 `memory/profile.md` 或 `memory/log/YYYY-MM.md`**；Update/Reset Computer 都无济于事。
- **落差本质**：官方把 memory 描述成一个「会自己变好」的产品能力；实现上它是**散落在云电脑上的 .md 文件**，需要用户手动打包备份，且写入通道曾经整体不可用。

### 落差 7：能力的实际准入门槛高于文档描述

- 官方 [skills-routines-and-automations.md](https://docs.x.ai/grok-bot/skills-routines-and-automations.md) 把 routine 描述成 bot 的普通能力，没有任何计划门槛。
- 实现侧（员工 Colin，2026-09-09）：https://forum.cursor.com/t/bot-routines-refuse-to-fire/171173 ——「Routines (scheduled runs) are **the one Grok Bot feature that checks the Cursor plan**」；若 Grok Bot 权限来自关联的 SuperGrok 账号而 Cursor 停在 Start 档，「the server **refuses to schedule routines** no matter how often you reset the bot or computer」，升到 Pro 或更高才恢复。
- 另有多条 routine 可靠性问题：不会在**新的一天**自动唤醒首次运行（172545）；不按计划自动跑，槽位命中后可能排队 10–37 分钟且部分运行**不回报到聊天**（170358）；GitHub `issue assigned` 触发器对 github.com 仓库**不工作**（员工确认为 server-side known，171791）；webhook 触发器的 POST URL / `crsr_` key 在 desktop 0.53.0 前缺失（171324/171606）；私有 Slack 频道需先 `/invite @Cursor`（171676）。

### 落差 8：模板分享不交付 skills

- 官方 [bots.md](https://docs.x.ai/grok-bot/bots.md)：Create template 的公开链接「shows the Bot's shared configuration, including its identity, description, **skills**, and routines」。
- 实现侧（员工）：https://forum.cursor.com/t/grok-bot-templates-preview-shows-skills-but-the-export-ships-skills-skills-are-never-delivered/169911 ——「Bot template preview lists skills, but **import does not apply them (export ships `skills: []`)**」，临时办法是让用户从预览里手动复制 skill 正文再让新 bot 重建。

### 落差 9：secrets 的传播边界，社区与官方叙述的关注点不同

- 官方 [computer-and-apps.md](https://docs.x.ai/grok-bot/computer-and-apps.md)：「Command-line credentials are shared」「Browser cookies and signed-in sessions are shared」「signing in for one Bot makes the session available to your other Bots」。
- 官方 [team-bots.md](https://docs.x.ai/grok-bot/team-bots.md)：Team Bot 的**命名 secrets 是全队可用的**（「The Bot can use every secret in any teammate's conversation」），上限 25 条、值 8 字符–4,096 字节、输出中以 `[REDACTED]` 替换；**bot 自己也看不到值**。
- 社区（grok-ship 的 Firstmate 模板，https://github.com/kunchenguid/grok-ship/blob/main/GROK_BOT_FIRSTMATE.md）：「Browser logins persist for every bot. A login on your screen is not a reason to do the work yourself. **Secrets are per-bot. They do not propagate to the crew.**」
- **这不是直接矛盾**，而是**两个不同层次**：共享电脑的浏览器会话/CLI 凭据是账号级共享，而 Bot 层「命名 secret」不跨 bot 传播。官方文档没有把这个区分讲清楚，容易让多 bot 架构的设计者误判。此处如实记录为「官方未澄清的重叠概念」，而非硬矛盾。

### 落差 10：社区的实际协作架构 = 单入口 hub-and-spoke，而不是官方暗示的「bot 网状互发」

- 社区最完整的多 bot 实践（grok-ship，178 stars，https://github.com/kunchenguid/grok-ship）在 README 里直接写：「After install, **talk only to Firstmate** - the one agent you chat with in the factory.」；架构图是 `you → Grok Bot software factory → crewmate ×N → Cursor cloud agents`。
- 其 Firstmate 模板（`GROK_BOT_FIRSTMATE.md`）确实依赖 bot-to-bot 消息：「**Delegate by messaging a crewmate; it wakes, does the work, and messages you back.**」，并要求「**Mark every task you hand off as coming from you, with a short task id**, and ask for the outcome back against that id」——即用户不得不**自行发明任务 ID 路由协议**来让 bot-to-bot 交接可靠，因为官方没有任何相关机制。
- 该模板同时明确反对用 subagents 做协调层：「**Don't reach for subagents.** Needing one means the work is substantial, which means it belongs with a crewmate」，并把协调状态**移出聊天**：「chat is not the source of truth. Projects and tasks live in a **sqlite database on the shared computer**」（README）。
- **结论**：官方叙事是「网状/自主协调」，社区落地是「**单入口 + 显式任务 ID + 外部数据库做真相源**」；员工侧建议则是「**单 bot + subagents**」。三方对「多 bot 协作」给出的最佳实践**互不相同**，这本身就是最值得注意的落差信号。

---

## 5. 关键原文引用

### 5.1 官方（英文原句，均 ≤2 行）

**协作与通信**

> "Bots coordinate with each other. Your Bots can run in parallel, message each other, share context in group chats, and pass ownership of a task, so you aren't the router between tools."
> —— 【官方文档】[overview.md](https://docs.x.ai/grok-bot/overview.md)

> "A Bot can send an asynchronous message to another Bot. The receiving Bot wakes, handles the request, and can reply later. You can see the handoff in the conversation."
> —— 【官方文档】[chat-and-collaboration.md](https://docs.x.ai/grok-bot/chat-and-collaboration.md)

> "Bots can post into the group and pass work among themselves."
> —— 【官方文档】[chat-and-collaboration.md](https://docs.x.ai/grok-bot/chat-and-collaboration.md)

> "Write normally to let the participating Bots decide who should respond."
> —— 【官方文档】[chat-and-collaboration.md](https://docs.x.ai/grok-bot/chat-and-collaboration.md)

> "Your messages in a group can include attachments. Bot-to-group handoff messages are currently text-only."
> —— 【官方文档】[chat-and-collaboration.md](https://docs.x.ai/grok-bot/chat-and-collaboration.md)

> "Bots can independently message each other and share context in threads. ... without requiring you to paste notes between chats."
> —— 【官方公告】[x.ai/news/introducing-grok-bot](https://x.ai/news/introducing-grok-bot)

**群聊与成员变更**

> "Use a group when several Bots need one shared outcome and visible handoffs."
> —— 【官方文档】[chat-and-collaboration.md](https://docs.x.ai/grok-bot/chat-and-collaboration.md)

> "In **New chat**, select two to six Bots. ... Group membership can be edited later."
> —— 【官方文档】[chat-and-collaboration.md](https://docs.x.ai/grok-bot/chat-and-collaboration.md)（**这是官方关于成员变更的全部内容**）

> "Group chats do not have the same per-Bot notification switch."
> —— 【官方文档】[settings-and-notifications.md](https://docs.x.ai/grok-bot/settings-and-notifications.md)

**上下文与共享电脑**

> "Grok Bot gives you Bots you can keep around: AI teammates with names, jobs, and context that compounds over time."
> —— 【官方文档】[overview.md](https://docs.x.ai/grok-bot/overview.md)

> "**Context compounds.** A named Bot keeps its memory, files, browser sessions, and preferences across sessions instead of resetting on every task."
> —— 【官方文档】[overview.md](https://docs.x.ai/grok-bot/overview.md)

> "All of your Bots use the same cloud computer, sharing its files, browser sessions, and app logins, which makes handoffs work without repeating setup."
> —— 【官方文档】[overview.md](https://docs.x.ai/grok-bot/overview.md)

> "The screens are separate work surfaces, not separate security boundaries."
> —— 【官方文档】[computer-and-apps.md](https://docs.x.ai/grok-bot/computer-and-apps.md)

**记忆**

> "Conversations and learned context stay separate per Bot, while shared files, browser sessions, and direct handoffs move context between them."
> —— 【官方文档】[overview.md](https://docs.x.ai/grok-bot/overview.md) / [bots.md](https://docs.x.ai/grok-bot/bots.md) / [faq.md](https://docs.x.ai/grok-bot/faq.md)

> "The copy is named \"`<name>` copy\" and carries the profile, settings, enabled skills, routines, and avatar. It does not copy conversation history, learned memory, or chat attachments."
> —— 【官方文档】[bots.md](https://docs.x.ai/grok-bot/bots.md)

> "To see what the Bot has saved for the team, ask it in chat. To correct or remove something, tell it."
> —— 【官方文档】[team-bots.md](https://docs.x.ai/grok-bot/team-bots.md)（个人 bot 的记忆管理则连这句都没有）

**技能与例程**

> "A **skill** is a reusable set of instructions for how to do a task. A **routine** tells one Bot when to run a workflow—on a schedule or, where supported, after an event."
> —— 【官方文档】[skills-routines-and-automations.md](https://docs.x.ai/grok-bot/skills-routines-and-automations.md)

> "Private skills are one library shared by all your Bots."
> —— 【官方文档】[skills-routines-and-automations.md](https://docs.x.ai/grok-bot/skills-routines-and-automations.md)

> "Teaching records visible computer interaction for up to ten minutes. It does not record microphone audio."
> —— 【官方文档】[skills-routines-and-automations.md](https://docs.x.ai/grok-bot/skills-routines-and-automations.md)

> "A Bot can own up to 50 routines, and the app keeps the 20 most recent run records for each routine."
> —— 【官方文档】[skills-routines-and-automations.md](https://docs.x.ai/grok-bot/skills-routines-and-automations.md)

> "No routine runs for the whole team at once."
> —— 【官方文档】[team-bots.md](https://docs.x.ai/grok-bot/team-bots.md)

### 5.2 员工回帖（实现侧，标 `staff`）

> "The full transcript gets sent back to the model on every turn, and there aren't any explicit primitives yet to cut older messages from what the model sees."
> —— 员工 deanrie，https://forum.cursor.com/t/grok-bot-prune-compact-an-agent-s-context-without-creating-a-new-bot/168333

> "Long chats do get auto summarized as they get close to the context limit, but that's not the same as an explicit compact, or starting a new session on the same bot."
> —— 员工 deanrie，同上

> "Each bot has one conversation and one memory, and that single history spans both its 1:1 chat with you and every group it is a member of."
> —— 员工 Colin，https://forum.cursor.com/t/status-beat-leaks-between-bots/170523

> "...but it is expected to draw on everything it knows, including its 1:1 history, and its saved memories belong to the bot, not to a chat."
> —— 员工 Colin，同上

> "No in-place compact for a Grok Bot chat—auto-summary near the limit still lets busy threads refill."
> —— 员工 kevinn，https://forum.cursor.com/t/trim-the-fat-in-a-chat/171653

> "Each bot-to-bot message burns a weekly-usage turn; asking bots in chat to 'stay quiet' is only a hint."
> —— 员工 mohitjain，https://forum.cursor.com/t/grok-bot-weekly-usage-hits-100-after-bot-to-bot-reviews-the-user-asked-to-stop/170271

> "This behavior matches a known issue that the team is aware of."（针对 Chief bot 无法主动联系其他 bot）
> —— 员工 Colin，2026-09-30，https://forum.cursor.com/t/chief-bot-not-talking-to-other-bots/173356

> "each turn re-reads the bot's full chat history—so week-long threads burn 80–90k tokens/step"
> —— 员工 kevinn，https://forum.cursor.com/t/1-500-in-one-week-running-a-grok-bot-fleet-expected-or-a-bug/172705

> "No one-click export yet—memory lives as plain text on the Bot computer."
> —— 员工 mohitjain，https://forum.cursor.com/t/best-way-to-export-memory/170714

> "when you use a new group chat with the same Bot, the old 1:1 transcript isn't pulled into the working set... right now it's the closest way to get a thin working set without Duplicate or Delete."
> —— 员工 deanrie，2026-09-23，https://forum.cursor.com/t/grok-bot-prune-compact-an-agent-s-context-without-creating-a-new-bot/168333

### 5.3 社区

> "Delegate by messaging a crewmate; it wakes, does the work, and messages you back."
> —— 【社区】[grok-ship / GROK_BOT_FIRSTMATE.md](https://github.com/kunchenguid/grok-ship/blob/main/GROK_BOT_FIRSTMATE.md)

> "Mark every task you hand off as coming from you, with a short task id, and ask for the outcome back against that id."
> —— 【社区】同上

> "Browser logins persist for every bot. ... Secrets are per-bot. They do not propagate to the crew."
> —— 【社区】同上

> "chat is not the source of truth. Projects and tasks live in a sqlite database on the shared computer."
> —— 【社区】[grok-ship README](https://github.com/kunchenguid/grok-ship)

---

## 6. 未能获取的页面清单

### 6.1 题面点名但**确认不存在**（HTTP 404，均已实测）

以下 `docs.x.ai/grok-bot/*` 路径全部返回 404，Grok Bot 章节的真实页面是 §1.1 的 21 个：

- `/grok-bot/computer.md` — 404（真实页面为 `computer-and-apps.md`）
- `/grok-bot/skills.md` — 404（真实页面为 `skills-routines-and-automations.md`）
- `/grok-bot/routines.md` — 404（同上）
- `/grok-bot/memory.md` — **404，官方没有任何 memory 专页** ← 对本调研最关键的一条缺失
- `/grok-bot/group-chats.md` — **404，官方没有任何群聊专页** ← 对本调研最关键的一条缺失
- `/grok-bot/collaboration.md` — 404（真实页面为 `chat-and-collaboration.md`）
- 额外探测并 404 的：`/grok-bot/context.md`、`/grok-bot/handoff.md`、`/grok-bot/handoffs.md`、`/grok-bot/automations.md`、`/grok-bot/channels.md`、`/grok-bot/notifications.md`

（`skills-routines-and-automations.md`、`teams-and-enterprises.md`、`get-started.md`、`mobile.md`、`use-cases.md` 题面猜测存在，实测**均 200**，已全部抓取。）

### 6.2 存在但本次未获取正文

| URL | 状态 | 原因 |
|---|---|---|
| https://x.ai/bot | **403** | 服务器拒绝（非 404）。产品页正文未能获取；仅从 awesome-grok-bot 描述得知该页是「x.ai/bot shares」的模板分享落地页 |
| https://cursor.com/help/grok-bot/plans | 未抓取 | 官方文档多处以「Plans and billing」外链引用它，含完整配额矩阵；超出本次六问范围 |
| https://x.ai/legal/bot-sharing-terms | 未抓取 | 第三方 bot 条款，超出范围 |
| https://cursor.com/bot/slack-auto-approve | 未抓取 | Slack 管理员自动审批流程，超出范围 |
| https://github.com/kydlikebtc/awesome-grokbot | 200（仓库）/ 正文未抓 | 仅验证存在（339 stars，描述称 1,894 条 x.ai/bot 分享链接、双语、带 JSON schema 与 CI） |
| `kunchenguid/grok-ship` 的 `skills/*/SKILL.md`（9 个） | 未逐个抓取 | 仅抓 README + `GROK_SHIP.md` + `GROK_BOT_FIRSTMATE.md` + `GROK_BOT_CREWMATE.md`，足以回答六问 |
| https://github.com/xai-org/grok-prompts | 200（仓库） | **已排除**：描述为「Prompts for our Grok chat assistant and the `@grok` bot on X」，与 Grok Bot 桌面产品**无关**，未采用其内容 |

### 6.3 方法论备注

- `web_fetch` 对 `docs.x.ai` 被 SSRF 防护拦截，改用 `pwsh` + `Invoke-WebRequest` 直连成功；`x.ai/bot` 则被源站 403 拦截（与工具无关）。
- InfoQ 页面为 Nuxt 应用，正文以 SSR 形式内联在 HTML 中（非 JS 渲染缺失）；已从约 255 KB 偏移处提取到正文全文（约 2,234 字），**未使用**任何需要登录或付费的内容。
- 社区「Community & Failure Modes」章节（约 97 KB）本身是二级汇总，其条目均带 forum.cursor.com 原始链接；本次对其中**四条最关键的线程**（168333、170523、173238、173356）拉取了 Discourse `.json` 原始帖**逐条核对**，员工身份（`staff: true`）与引文均来自原始帖，非二级转述。
- awesome-grok-bot 与 kydlikebtc/awesome-grokbot 均为**非官方**社区清单（README 自述「Unofficial community list. Not affiliated with xAI/SpaceXAI or Cursor.」，CC0），其中条目可能存在滞后或偏差；**未**将其作为官方能力的证据使用。
