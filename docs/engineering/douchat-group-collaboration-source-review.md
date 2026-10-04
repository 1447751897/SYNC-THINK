# DouChat 群聊协作：源码复核与场景映射

## 结论与范围

本次重新核对 thinkany-ai/douchat 的默认分支 `dev`：提交 `8dfe9715ff12cc8f03d028610c8e0cf1cb018ae4`，版本 0.1.23，提交时间 2026-10-04 09:38:04 UTC。

**DouChat 普通群聊是一套通用的“模型决策 + 校验后的调度执行 + 消息交接”机制；谁是卧底和简化狼人杀另有专用规则引擎。** 普通群聊不是每个场景固定编排台词；严格游戏也不是仅靠主持人提示词。

此次只做源码复核、测试和研究文档，不修改 SYNC-THINK 产品页面、运行时或现有 Demo。

### 证据可靠性

- 通过 GitHub API 获取默认分支 HEAD，并从该提交的 raw 源码下载关键文件。
- 对比 17 个文件，统一 UTF-8 BOM / 换行后，16 个与本地保留副本一致。唯一差异 `src/main/index.ts` 是先前的本地账号/启动适配；对入口接线的判断另检查了下载的未改版 index.ts。
- `runtime.ts`、群调度、任务图、私信、游戏、记忆和档案模块均与上游内容一致。
- 上游树清单与 renderer/preload/index 调用搜索共同检查游戏入口，避免把“有测试引擎”误认为“桌面已完整接线”。
- 本轮 Node 24.19.0 + Vitest 运行 11 个定向测试文件，**261 项通过，0 失败，0 跳过**。使用脚本执行器/模拟传输，无本轮真实模型调用；测试通过不代表模型调度准确率或真实游戏体验已测量。
- 证据目录：`C:/Users/zhuzhenyu/AppData/Local/Temp/sync-think-douchat-source-review/8dfe971`（命令返回的短用户名路径与此指向同一目录）。
- 测试 JSON：`C:/Users/zhuzhenyu/AppData/Local/Temp/sync-think-douchat-source-review-tests.json`。

## 1. 协调员不等于后台控制器

源码分三个角色：

1. **群成员 / 群负责人**：`BotGroup.leadMemberId` 对应真实成员；可以公开主持、分工、答复、收尾，拥有自己的发言上下文。
2. **调度控制器**：读取群描述、成员能力、当前请求、公共消息、已完成动作、健康信息、私人投递信封，返回 `GroupDecision`。可用单独配置的决策模型，也可让群成员在独立、无工具的控制器调用中规划。
3. **运行时执行器**：验证成员、触发消息、模式、任务依赖和权限，执行计划、保存状态、发送私信、处理失败与取消。

负责人并非每条消息的中转站。成员之间直接交接；控制器在需要协调的阶段读取更新后的共同记录。私人消息正文不进入控制器输入，仅信封包含发送人、接收人、消息 ID 等。

负责人可以由决策按任务适配、健康和延迟重新选举。这和用户“指定主协调员尽量持续负责”的需求不是完全相同：借鉴时应明确指定负责人优先、何时才允许换人。

证据：[group.ts](D:/projects/SYNC-THINK/vendor/douchat-local/src/shared/bot/group.ts) 20–28、77–107、348–395、487–498、735–792、877–897；[runtime.ts](D:/projects/SYNC-THINK/vendor/douchat-local/src/main/runtime.ts) 3509–3511、3584–3640。

## 2. 你要求的几个场景如何落在源码上

### A. 具体问题 / 项目协作

- 控制器从群描述和当前请求生成成员分工；不是把固定三阶段写成唯一工作方式。
- 简单协作可用 `single / parallel / sequential` 和 `assignments`。
- 有依赖的工作可生成 `tasks`：节点有 `id / memberId / instruction / dependsOn / expectedOutput / publicDeliverable / requiredCapabilities`。
- 执行器检验有向无环图、成员是否存在/可用、所需能力是否被禁止；只有成功结果解锁后续节点，同一成员的多个节点互斥，最多同时执行四个节点。
- 成员收到本群描述、权威成员表、`originalRequest`、当前分工、相关公共消息、自己的私信；任务节点也收到依赖结果和输入产物。
- 普通项目产出要求优先公开，后续成员能读到并继续工作；需要时最后由负责人汇总。

“只发产物到群里”并不意味着群不知道进展：运行时另保存 `completedTurns`、节点 ID、消息/产物引用和失败状态，不把成员全部内部执行过程刷成群消息。

证据：[groupTasks.ts](D:/projects/SYNC-THINK/vendor/douchat-local/src/shared/bot/groupTasks.ts) 4–51、55–72、87–128；[group.ts](D:/projects/SYNC-THINK/vendor/douchat-local/src/shared/bot/group.ts) 431–458、470–504、590–624、907–955。

### B. 固定顺序 / 依赖链

- “A 后 B 后 C”的个人发言可输出 `sequential + memberIds=[A,B,C]`，执行器按声明顺序运行，后者能看到前者的真实成功发言。
- “A 产物给 B，B 产物给 C”的生产任务，更适合 `dependsOn` 图。
- “A、B 分头做，C 汇总”是两个独立节点后一个 fan-in 节点，不需让 A/B 假装串行。
- 群描述进入模型决策上下文，但它不是自动编译规则的 DSL。程序硬性执行的是验证后的计划；文字描述理解是否正确仍要观察真实模型结果。
- 个人轮流发言模式 `participationOnly` 不插主持开场/收尾；失败成员被报告并跳过，不由其他成员冒充。

证据：[group.ts](D:/projects/SYNC-THINK/vendor/douchat-local/src/shared/bot/group.ts) 77–98、431–458、674–719；[groupTasks.ts](D:/projects/SYNC-THINK/vendor/douchat-local/src/shared/bot/groupTasks.ts) 44–51、87–128；[groupParticipation.ts](D:/projects/SYNC-THINK/vendor/douchat-local/src/shared/bot/groupParticipation.ts)。

### C. 群内讨论、追问、成员互相交流

- 用户消息开头明确只 `@` 一个成员，直接唤醒该成员，不先插主持人或规划调用。
- 没有 @ 的后续问话，模型可识别这是对上一位唯一发言者的继续追问，而不是每次都交给负责人；新话题重新路由。
- 成员公开回复中的实际 @ 可形成交接；已在计划中的后续成员保留该消息作为触发输入，新增对象在受监管流程中再由控制器决策。
- 私人请求也可以形成交接；信息型私信不唤醒。
- `waitForHuman` 表示已经提出必要澄清/确认、只回复一次然后停止当前自动调度。它不要求用户点击“下一步”，也不是把所有普通请求改成等待。
- 单次调度默认最多 16 个成员动作；不是整场活动最多 16 轮，更不是无限自动聊天。

证据：[group.ts](D:/projects/SYNC-THINK/vendor/douchat-local/src/shared/bot/group.ts) 74、111–130、286–310、381–395、735–792、929–934；[group-collaboration.md](D:/projects/SYNC-THINK/vendor/douchat-local/docs/group-collaboration.md)。

### D. 谁是卧底

源码有 `GroupGames` 执行服务和 `groupGame.ts` 的确定性规则：

1. 按局生成牌 / 私人事件；4–8 个玩家，至多一个真人。
2. `pending` 队列按顺序安排存活玩家描述；每个动作有 `slotId` 和 `actorId`。
3. 模型只获得 `gamePlayerView`：自己的词、公开玩家状态、自己有权看到的事件、当前合法动作。别人的词和阵营不在这个视图里。
4. 真人轮次等待真人提交；真人动作接口只接受 `actorId=human`，并校验当前槽位，拒绝过期或重复动作。
5. 选票是结构化 `targetId`，按规则验证有效存活对象，禁止自投。公开“怀疑某人”不自动算票。
6. 全员描述结束进入投票，所有票收齐公开结果。平票候选人依次辩护后重投一次，再平票按开局说明的种子抽签处理。
7. 淘汰、下一轮、获胜和结束时揭牌由规则代码判断。

这条路径中，程序是裁判。模型是玩家，负责真实发言和选择目标；公共 @ 不额外插入游戏回合。它与普通群聊中“主持人先用私信发秘密、再点名”的自由主持路径有区别。

重要接线状态：在当前提交没有找到 renderer/preload/main IPC 的游戏开始、真人行动、继续入口，也没有找到启动时调用 `games.recover()`。只有引擎、测试、runtime 实例化/模型回调/快照以及停止关联。因此结论是“规则与执行引擎已有实现”，不是“当前桌面群聊 UI 已完整可玩”。

证据：[groupGame.ts](D:/projects/SYNC-THINK/vendor/douchat-local/src/shared/groupGame.ts) 95–129、132–164、166–198、215–232；[groupGames.ts](D:/projects/SYNC-THINK/vendor/douchat-local/src/main/groupGames.ts) 22–72、97–159；[runtime.ts](D:/projects/SYNC-THINK/vendor/douchat-local/src/main/runtime.ts) 500–524、539。

### E. 狼人杀

它实现的是**六人简化版：2 狼、1 预言家、3 平民**，不是包含女巫、猎人等的完整规则合集。

- 阶段包括狼人私下讨论、狼人投票、预言家查验、白天公开发言和投票。
- 狼人讨论事件的 audience 仅有狼人 ID；查验结果 audience 仅有预言家 ID。
- 玩家输入继续使用 `gamePlayerView`；真人 UI 投影使用 `gameView`，不包含其他玩家角色/秘密选票。
- 没有所有狼人杀变体的配置化编译器；新增身份和规则仍需要扩展规则模块。

证据：[groupGame.ts](D:/projects/SYNC-THINK/vendor/douchat-local/src/shared/groupGame.ts) 60–69、119–126、140、166–176、191–194、215–232。

## 3. 私人信息与记忆：两种机制要分开

### 普通群的私人投递

- `[[private:成员ID]]正文[[/private]]` 是请求 / 行动型投递，可以唤醒接收人。
- `[[private-info:成员ID]]正文[[/private]]` 仅给信息，不唤醒；适合先发材料、再统一安排活动。
- `[[private:human]]正文[[/private]]` 给用户，进入发送者与用户的单聊并产生未读通知。
- 流式 parser 会扣住未完整解析的 private 标记，正文从公共输出中剥离；控制器只收信封。
- `privateContext` 只挑发送者/接收者相关正文。群 UI 回执无正文展开。

**这里要区分“模型输入隔离”和“用户端数据隔离”：普通群聊的 `runtime.snapshot()` 仍返回本账号会话的完整 `privateMessages`；`store.privateMessages` 读取时未剥离正文。群消息回执一般只显示投递状态，并不意味着正文没有发到桌面前端。** 因此普通群私信不能直接作为“真人玩家也不收到其他人的秘密”的实现。专用游戏的 `gameView / gamePlayerView` 才是按参与者投影的那条路径。

这种隔离也不是对本机数据库拥有者的保密，更不是保证模型永远不会主动在公开话中泄露它自己知道的秘密。

### 记忆

- 档案里的灵魂、身份、引导等参与身份 / 行为提示；不是把 `USER.md` 和 `MEMORY.md` 不分场景全部拼入模型。
- 群记忆按账号 + 群保存，并区分内部/外部 audience；个人用户记忆另有作用域。
- 但是**经过验证的“主人 + 自己全部智能体”的内部会话，有跨智能体记忆与内部会话检索/注入机制**。这对工作协作有用，却与游戏里“成员互相不知道私人牌”目标存在冲突。
- 专用游戏模型回调使用无工具、独立临时会话 / 自定义 provider 直连，不注入普通会话记忆；因此应照这个路径保存局内秘密，不把词卡写进全局用户记忆或可跨群检索的普通私聊记录。
- 当前专用游戏引擎明确拒绝 `localAgentId` 原生 CLI 成员，避免工具和可复用会话破坏隔离。要接我们自己的本地推理接口，可做提供隔离输入的模型端口；不能把允许读磁盘的既有 CLI 会话直接当作同等隔离。

证据：[privateMessages.ts](D:/projects/SYNC-THINK/vendor/douchat-local/src/shared/bot/privateMessages.ts) 18–59、61–115；[runtime.ts](D:/projects/SYNC-THINK/vendor/douchat-local/src/main/runtime.ts) 528–544；[store.ts](D:/projects/SYNC-THINK/vendor/douchat-local/src/main/store.ts) 1170–1172、403–416；[ChatPane.tsx](D:/projects/SYNC-THINK/vendor/douchat-local/src/renderer/src/components/ChatPane.tsx) 493–511；[internalMemory.ts](D:/projects/SYNC-THINK/vendor/douchat-local/src/main/internalMemory.ts) 6–40；[groupMemoryStore.ts](D:/projects/SYNC-THINK/vendor/douchat-local/src/main/groupMemoryStore.ts) 6–39；[agentCustomization.ts](D:/projects/SYNC-THINK/vendor/douchat-local/src/shared/agentCustomization.ts) 66–98；[runtime.ts](D:/projects/SYNC-THINK/vendor/douchat-local/src/main/runtime.ts) 500–524、2393–2413；[groupGames.ts](D:/projects/SYNC-THINK/vendor/douchat-local/src/main/groupGames.ts) 31。

## 4. 中断与恢复不是无条件“催成员再做一次”

- 当前运行中明确观察到的成员失败，可以交给决策选择 `skip / replace / pause`。
- 个人参与失败，倾向跳过且不冒充；必要任务产物失败，选合适替补或暂停；保留剩余计划和完成记录。
- workflow journal 的调用按稳定键保存：完成过的调用复用结果，不再执行。
- 重启时若发现工具型 reply 还处于 running，即“不确定它有没有执行外部操作”，暂停并要求人工核对，不自动重复。
- 附件缺失、成员或负责人变化也会触发暂停。
- 15 秒 heartbeat 表示桌面执行器活着，不等于远端模型确实在推进。
- 游戏模型动作可以有限纠错/重试，因为该路径无工具且每步通过槽位 + revision 原子提交；真人等待不等于故障。

证据：[groupWorkflow.ts](D:/projects/SYNC-THINK/vendor/douchat-local/src/main/groupWorkflow.ts)；[runtime.ts](D:/projects/SYNC-THINK/vendor/douchat-local/src/main/runtime.ts) 4147–4175；[groupDecision.ts](D:/projects/SYNC-THINK/vendor/douchat-local/src/main/groupDecision.ts) 125–139；[groupGames.ts](D:/projects/SYNC-THINK/vendor/douchat-local/src/main/groupGames.ts) 109–159。

## 5. 对 SYNC-THINK 的借鉴建议（未实施）

1. 保留现有页面和成员/模型体系，借鉴 `GroupDecision + runGroupConversation` 的通用调度契约，而不是继续写固定台词 Demo。
2. 将本群描述、当前目标、结构化计划、完成证据和消息记录分开；支持单成员、并行、顺序、依赖图四种执行方式。
3. 采用公开交接和 request/inform 私人投递，但先把受众过滤做到宿主、模型上下文、历史、摘要、工具和恢复全链路。
4. 指定协调员优先维持，运行时按事件提供进度；不要把全部交流变成主持人转述，也不要让协调员一直空转。
5. 工作群可以配置受控共享记忆；游戏实例使用独立秘密/事件和无工具玩家模型输入，禁止泛化记忆检索跨进游戏。
6. 游戏用独立规则插件连接同一群聊视图，不复刻 DouChat 整个应用，也不宣称它当前已接好游戏 UI。
7. 下一轮原型若要验证通用协作，先接可替换的真实模型决策/发言端口，用两个不同的用户目标和顺序证明无需修改代码即可换流程；无真实模型时清楚标注模拟。

本报告不构成实施承诺；此次没有移植生产逻辑，没有更换任何 SYNC-THINK 页面。
