# Sync-Think Native 上下文压缩：DeepSeek Harness 源码对照与实施方案

源码核对日期：2026-10-02。状态：**两批实现已落地并构建：覆盖边界、共享请求计量与预算、85%软触发、模型输出上限、usage校准、跨轮规范 checkpoint 复用及会话压缩中断恢复**。第一批记录见 D:/projects/SYNC-THINK/docs/testing/context-compaction-20261002.md；最新验收见 D:/projects/SYNC-THINK/docs/testing/context-compaction-batch2.md。用户数据库和运行中服务保持原状；构建成功不等于现有进程已经加载新版本。

以下保留原始源码对照与分阶段设计。P0/P1/P2/P3 的本批范围及 P4 的持久生命周期已实施；未引入完整 DSH surfaceOp 引擎、独立后台服务或精确 tokenizer。以实施记录及最终测试日志为准。

## 1. 核对范围与证据

上游：`deepseek-ai/deepseek-harness`。通过 `git ls-remote --symref … HEAD` 核对，2026-10-02 的远端 HEAD 为 `639ed015397290b3745d163aafe02ffee4aa3f84`；提交时间为 2026-09-29T17:21:31+08:00，发布标记涉及 `0.2.0-rc.2`。

本轮直接读取该提交的 Git blob，而不是根据 Claude Code 未公开的实现推断，也不是只读产品文档或发行包。

本地已有研究检出是稀疏的：部分 `packages/compaction/**` 文件没有出现在工作目录，并不代表上游未公开这些源码。本轮用 `git ls-tree` 与 `git show HEAD:<path>` 核对到实际 TypeScript 实现；旧研究中“快照缺源码”的备注应理解为检出范围限制。

核对的主要源文件（路径相对上游仓库）：

- `packages/compaction/compaction-basic/src/config.ts`：默认参数及容量预算。
- `packages/compaction/compaction-basic/src/index.ts`：pre-step 压力检查、剪枝后重测、受限溢出恢复。
- `packages/compaction/compaction-basic/src/region.ts`：按价格保留尾部、工具配对平衡、摘要期间一致性校验、区间替换事务。
- `packages/compaction/compaction-basic/src/summarizer.ts`：结构化 checkpoint、旧摘要合并、重放稳定请求前缀。
- `packages/compaction/compaction/src/tool-pairing.ts`、`invariant.ts`：结构完整性和日志协议约束。
- `packages/llm/token-meter/src/index.ts`：同一路由/请求信封的 usage 锚点与表面差量计量。
- `packages/compaction/compaction-tool-result-pruner/src/config.ts`：剪枝参数按 Unicode code point 计数。

可复核上游地址：

`https://github.com/deepseek-ai/deepseek-harness/tree/639ed015397290b3745d163aafe02ffee4aa3f84/packages/compaction`

只读提取副本：

`C:/Users/ZHUZHE~1/AppData/Local/Temp/sync-think-dsh-source-0cc209e7c1e54f7394563eaa66d5f8a0/`

## 2. 实际源码里的机制

### 2.1 日志保留，模型可见表面做区间替换

`region.ts:477–521`：追加 `compaction/summary` 记录后，追加带 `surfaceOp: { op: 'replace', startSeq, endSeq }` 的 checkpoint 消息；记录 `shadowedSeqs` 和源事件引用。不是删除原始日志，也不是用“压缩发生时间”推断应该删掉哪些消息。

系统头节点被排除在选择区间之外。摘要替换所覆盖的区间；原文尾部仍在表面中。

### 2.2 按 Token 保留近期原文，切口保护工具配对

`region.ts:117–158`：从最新节点倒序累计 `measurement.nodes[].tokens`，达到保留预算后检查切口；若有工具调用/返回跨过切口，向前调整，直到配对平衡。

这一实现是 turn-agnostic：工具配对平衡是其切分约束，不应描述成“上游严格保留完整用户轮次”。Sync-Think 可以在此基础上增加完整轮次保护。

### 2.3 先可选剪枝，再重测，再决定是否摘要

`index.ts:269–356`：压力达到预算后调用可选 `toolResultPruner`，重新从同一个 meter 测量；压力已恢复则结束，不进行付费摘要。

`compaction-tool-result-pruner/src/config.ts` 默认：超过 8192 个 Unicode code point 的工具文本保留头部 4096、尾部 1024，并插入裁剪提示。不是 8192 tokens；Sync-Think 的落地方案还应给裁剪结果提供原文回读引用。

### 2.4 摘要合并既有 checkpoint

`summarizer.ts` 的模板包含八部分：用户目标、关键技术、文件代码、错误修复、未完成工作、当前工作、下一步、关键上下文。明确要求把旧 `<compacted-summary>` 中仍然有效的信息与新信息合并，去掉过时信息，而不是照抄旧摘要。

摘要调用重放被摘要区间的稳定系统/工具/消息前缀，再追加摘要指令；这是前缀缓存友好设计，不保证所有供应商都命中缓存。

### 2.5 稳定性与受限恢复

`region.ts:430–472`：摘要提交前比较表面或所选区间的节点/引用/价格；变化时抛出 `SurfaceChangedError`。显式区间稳定校验允许区间外新增节点继续存在。

`index.ts:190–231`：provider 明确报告 context overflow 时，默认最多恢复重试一次；只有持久替换代数已经前进才允许重试，避免对同一个未变请求死循环重发。

### 2.6 计量不是凭一个旧 usage 数字外推

`token-meter/src/index.ts:146–190`：只有请求头/路由一致时才考虑使用上次成功请求的 usage 锚点，否则重估完整信封与表面。允许表面差量为负，以反映剪枝/替换后的缩小。

其 `totalTokens` 是压力估算，包含成功响应等锚点因素；不应直接把它标成 Sync-Think“下一次请求的精确输入 tokens”。UI 需要区分本次请求占用、下一步压力估算、计费消耗。

## 3. 上游默认值与 Sync-Think 建议值分开

`config.ts:19–22,75–106,153–216` 确认：

- `thresholdRatio = 0.8`。
- `headroomTokens = 65_536`。
- `retainRatio = 0.16`，或显式 `retainTokens`。
- `maxTokens` 未设置时跟随 headroom；这是摘要调用上限，不是建议给所有 Sync-Think 摘要照搬 65k。
- `compactionRetries = 1`；即初始摘要后至多一次额外尝试。
- `maxOverflowRetries = 1`。

上游公式：

```text
trigger = floor(min(W × thresholdRatio, W − reservedCompletionTokens − headroomTokens))
retain = floor((W − reservedCompletionTokens) × retainRatio)
```

**复制策略，不机械复制默认容量。** 假设 W=272000、输出预留=16000，套用上游默认 65536 余量时，trigger=min(217600,190464)=190464，约为窗口的 70.02%。因此“换上游默认值就一定比现在更晚压缩”并不成立。

Sync-Think 建议先修边界与计量，再采用 85% 软触发；余量按模型窗口、输出上限和工具回填风险配置。90%只作可选策略，不作全局默认。以上是本项目设计建议，不是 DeepSeek Harness 默认。

## 4. 统一预算模型

```text
W = 本轮实际模型/配置生效的上下文容量
O = 本轮有效输出预留
S = 安全余量（避免计量误差与预估增长；明确其包含范围）
F = 本轮固定输入成本
Binput = W − O − S
Bhistory = Binput − F
Tsoft = min(0.85 × W, Binput)
```

F 包含系统、智能体、项目/记忆、旧摘要、已加载工具定义、协议开销；本轮只扣一次。若摘要作为历史节点计量，则从 F 移出，而不是两边同时加算。待发送用户消息/图片若已在候选请求内，禁止重复加算。

计量以实际序列化候选请求为准；分类值用于解释构成。provider usage、可用 tokenizer、估算具有不同精度，明确标注来源；绑定 conversation/nativeSession/kernel/provider/model/request revision。模型、工具、系统提示变化时使旧 usage 锚点失效。缓存输入仍占窗口；计费缓存桶按各 adapter 的规范先归一化。

Runtime 每次 Native provider 请求前检查，覆盖私聊、群聊、小队成员、定时任务、浏览器任务以及工具循环，不只在前端发送下一条消息时检查。

假设 W=272k、O=16k、S=8k、F=32k：可用输入248k，扣固定成本后历史216k，85%软触发231.2k。这些是预算示例，不是已读取的实时配置。

固定成本超出可用输入时，给出工具集合/输出上限/模型容量等可操作调整；避免继续悄悄丢历史。

## 5. 实施顺序

### P0 — 压缩边界正确性，优先实施

现状：`context-message-history.ts` 根据 `compactedAt` 时间戳过滤；`splitHistoryForCompact` 保留末尾8条，但摘要没有覆盖这8条。隔离组合复现显示下一次请求仍将这些压缩前的近期原文滤掉。

- 持久化摘要覆盖的规范 message IDs/sequence、输入版本、旧摘要版本；严禁混用 Event.sequence 和 Message.sequence。
- 模型可见上下文 = 摘要 + 保留下来的原文尾部 + 压缩后新增消息。
- 上一版摘要参与新摘要，既有长期约束不因多次压缩漏掉。
- 提交前校验所选区间；区间外新增内容保留，已选内容变化则重建。
- 原始消息继续保存在权威存储；摘要提交原子化、可重放、幂等。失败/取消不推进活动边界。
- 首批修复暂保留已有8条策略以缩小风险，下一阶段再改成Token预算选择。
- 旧记录兼容投影；基于完整持久历史恢复可验证的近期内容，避免盲目注入所有旧历史。

重点文件：`apps/runtime/src/conversation-compact-boundary-cache.ts`、`context-message-history.ts`、`chat-tools.ts`、`runtime.ts` 及对应测试。

### P1 — 一个 meter、一份预算

抽取统一候选请求测量与预算接口；解决 chars/4 与 UTF-8 bytes/4 并存、历史按82%先选再叠固定成本的问题。UI 和 preflight 消费同一版本的测量；区分本次输入、未来压力、计费。

### P2 — 两阶段压缩与可续接 checkpoint

采用“裁剪旧工具输出 → 重测 → 摘要旧区间”。原文可回读，当前待返回工具链不拆分。近期原文先采用 DSH 16% 的可配置起点，受真实剩余预算约束；小说/审阅等保留需求通过回归校准，不仅按消息条数。

摘要采用上游八部分结构，按中文/小说/浏览器等领域调整措辞，但保留目标、硬约束、确认事实、未完状态、证据路径、阻塞与下一步。通常以2–8k摘要预算为起点，小窗口优先服从实际预算；关键状态校验失败不提交。

摘要作为来源标记的背景数据注入，不把网页/旧工具输出中的指令升级到系统权限；审批状态、任务目标、产物索引由独立结构化状态提供。登录 cookie/token 不写入摘要。

### P3 — 调晚软阈值，保留硬预算与有限恢复

Native 推荐85%软触发，非“达到85%必定调用摘要模型”；剪枝已解压则跳过。输出预留/固定成本/工具回填较高时允许在85%之前做必要处理，并显示原因。

压缩目标是确实降低请求占用；压后希望留出明显余量（例如≤65%），而不是把数字硬截成目标值。只有真实替换/缩小才允许 context-overflow 的一次恢复重试。provider网络/鉴权错误不被误当成上下文问题。

### P4 — 持久压缩生命周期与重启恢复（第二批已实施）

会话压缩 RPC 内的异步模型调用现在持有操作 ID、来源指纹、模型绑定和有期限的持久所有权记录；单 Runtime 的在途请求去重，提交前检查来源与所有权。关闭 Runtime 时取消在途摘要；重启后把旧所有者的未完成操作标为中断，不自动重发收费摘要。只有已校验区间推进覆盖边界，新消息仍在尾部。它不是独立队列或多个 Runtime 同时提交摘要的服务。

所有阶段只改 Native。Claude Code / Codex 外部内核继续使用自己的会话压缩，防止双重摘要。

## 6. 验收场景

- 12条消息中摘要前4条，后8条原文及新消息进入下一次请求。
- 两次以上压缩、退出重启、事件重放、同时间戳、时钟回拨均保持同样投影。
- 长用户消息、中文/emoji、图片、MCP大返回、并行工具链；切口没有孤立工具返回。
- 摘要失败、用户取消、区间被改写、摘要期间新消息到达；没有丢消息或假成功。
- 更换模型、工具集合、会话/nativeSession；旧 usage 锚点失效、分类与总量统一。
- 窗口缩小、固定成本超预算、输出预留较大、连续工具回填；各次请求满足硬预算。
- 私聊、独立群聊、两个并行群聊及定时任务/浏览器任务均由同一Native请求前检查覆盖。
- 外部 Claude Code / Codex 内核没有新增第二层 Native 自动压缩。

## 7. 本轮交付边界

已实施并验证：Native 85%软水位与硬预算、明确覆盖边界、统一计量、模型输出上限、保守 usage 校准、结构化摘要和跨轮 checkpoint 复用、摘要中断/重启恢复、桌面卡片来源说明和懒加载。全量 Runtime、协议全量、桌面相关回归与三个包构建结果见第二批验收记录。

本轮未执行：对用户真实会话强制压缩、修改用户数据库或重启其运行中进程；未用付费真实模型验证摘要语义质量。源码参考是所核对提交，不把它宣称为后续日期的最新版本。
