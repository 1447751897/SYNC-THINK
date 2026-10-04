# DeepSeek Harness 的上下文缓存与压缩：做法拆解，以及对 SYNC-THINK 的复用方案

- 研究日期：2026-10-02（Asia/Shanghai）。
- 上游版本：`@deepseek-ai/dsh-root` **0.2.0-rc.2**。
- 上游证据根：`C:/Users/zhuzhenyu/.codex/visualizations/2026/09/29/01a0eba8-16ae-7d11-9995-6e7f3aeaceb1/deepseek-research/deepseek-harness/`（下称 `<DSH>`）。
- 本轮范围：静态阅读 DSH 文档与决策记录 + 静态追踪 SYNC-THINK 现有实现；**未执行任何构建、测试、模型调用，未修改任何应用代码或运行数据**。
- 证据边界（重要，先读第 2 节）：本机 shell 完全不可用（每次进程启动 `exit 0xC0000142`），外网 `web_fetch` 被拒绝（DNS 解析到非公网地址），安装版 `app.asar` 无法被文件工具读取。因此本文的 DSH 侧证据来自本机一份**文档完整、源码不完整**的快照。

---

## 1. 核心判断（TL;DR）

**DSH 把"缓存"和"压缩"当作同一个不变量的两面：模型可见历史不是被改写的数组，而是一份 append-only 事件日志的派生投影（surface）。** 于是一切缓存优化都必须表现为"保持前缀稳定"，一切压缩都必须表现为"一次可回放的 surface replacement"。

DSH 的做法可以压成三条支柱：

1. **日志 + 表面 + 派生**：`Session` 是 append-only log，`deriveMessages()` 把日志投影成模型消息；`surfaceOp: { op:'replace', startSeq, endSeq }` 是唯一的历史改写原语，被替换的节点靠 `sourceEventSeqs` 引用而不是靠删除。
2. **显式的"缓存前缀断裂"信号**：`request/header` 快照 + `startsRequestSeries` + `request/context.systemPromptUpdate`，让"这轮请求还能不能复用上游 KV 前缀"成为一个**日志里可重建的事实**，而不是实现细节。
3. **可复现的度量**：`ctx.tokenMeter` 提供带 `logRevision` 的不可变度量，压缩的阈值判定、保留选择、剪枝定价全部读同一份测量，而不是各算各的。

压缩策略本身是一套具体算法：**先剪枝 → 再摘要 → 只保留按 token 比例的尾部 → 工具调用/结果配对必须平衡 → 自动压缩只保留头部的单一 checkpoint → 整个过程用日志事件当锁（崩溃可检测）**。默认参数是 `thresholdRatio 0.8`、`headroomTokens 65536`、`retainRatio 0.16`、`compactionRetries 1`、`maxOverflowRetries 1`、剪枝 `8192/4096/1024` code points。

**SYNC-THINK 的现状比"只有类型"要好得多，但关键事实散落且不可回放**：

- **压缩是端到端实现的**，含真实模型摘要调用（`runtime.ts:11091-11153`，`systemPromptOverride` + `toolsEnabled:false` + 90s 中止）和本地降级，生命周期事件齐全（`context.compaction_started / .compacted / .compaction_skipped / .compaction_failed`）。**不是"只有类型"。**
- **但触发只在渲染端**（`use-conversation-compaction.ts:209-218`，native 内核 + 0.7），Runtime 从不自触发；headless/CLI 会话只剩一道**完全静默**的裁剪：`selectRecentMessagesWithinBudget(messages, floor(window × 0.82))`（`runtime.ts:26992-26994`）与 `1.25 × window` 的分页停止，**既无事件也无 truncation 记录**。
- 压缩边界是 `compactedAt` **时间戳**过滤（`context-message-history.ts:164-171`），保留策略是**固定 8 条消息**（`chat-tools.ts:2475`），收缩校验是"≤0.9× 才算有效"（`chat-tools.ts:2697-2705`）。
- 工具输出折叠是每轮请求时临时做的 `2000` 字符 head/tail（`chat-tools.ts:2902`、`runtime.ts:21775`），**不落盘、不参与压力判定**。
- prompt cache **有两套互不兼容的 key**（chat 路径无 epoch，orchestration 路径带 epoch），**都不含前缀指纹，且压缩后都不变**（`demo-run.ts:766`、`production-step-executor.ts:326`、`runtime.ts:11013-11020`）。
- 摘要调用的 **`usage` 被丢弃**，`ProviderUsagePurpose` 里的 `'compaction' | 'summary'` 不可达（`runtime.ts:11134-11143`、`production-step-executor.ts:2379-2383`）。

**结论：值得复用的是"机制"，不是"框架"。** 建议按三层推进：

- **P0（低风险，可独立交付）**：补计量与静默裁剪的可观测性（这是一切判断的前提）、压缩时轮换缓存身份、保留策略从"条数"改"token 比例 + 配对平衡"、剪枝阈值可配置化并参与消压、有界重试 + "重试必须带来进展"。
- **P1（需要结构改造）**：把压缩从"时间戳过滤"升级为"可回放的替换记录"、把临时剪枝升级为"持久化单节点替换 + 定价"、把锁从 UI/内存搬进持久事实、补"摘要期间表面未变"的一致性复核。
- **P2（不建议照搬）**：cordis capability seam 插件体系、完整的 surface 引擎、模型可调用的 compact 工具（DSH 明确**没有**面向模型的压缩工具）。

---

## 2. 证据边界与不能断言的事

| 项 | 状态 | 影响 |
| --- | --- | --- |
| DSH `docs/**`（含子系统页、架构、事件、持久化、配置目录、Cordis 目录） | ✅ 完整可读（487 个 md，中英双语） | 设计意图、契约、默认参数可逐条引用 |
| DSH `.agents/notes/implemented/feature/*` | ✅ 可读 | 决策与取舍可引用 |
| DSH `.agents/notes/implemented/architecture/*` | ❌ 快照缺失（仅文档里被引用） | 部分架构决策只能从 `docs/architecture.md` 间接得到 |
| DSH `packages/compaction/**`、`packages/llm/**`、`packages/core/**` 源码 | ❌ 快照只包含 `packages/subagent/**` 与 `packages/experimental/**` | 快照层给不出实现细节；但**安装版 asar 已补上关键常量与错误语义**（§5.10），仍缺函数体全文 |
| 安装版 DSH 的 `app.asar` | ⚠️ **部分可读**：`read` / `glob` 在 asar 路径上失败（`Cannot mix BigInt and other types`），但 **`grep` 能把 asar 当原始文本按行搜索**，且返回真实行号 | 关键常量、README 段落、错误信息**可以逐行核实**；但拿不到任意行区间，全文仍需人工解包 |
| 安装版 DSH 版本号 | ⚠️ 未直接读到 | 无法确认与 0.2.0-rc.2 快照严格一致；已用 asar 实测值交叉验证（见 §5.10） |
| 上游 GitHub / 文档站 | ❌ `web_fetch` 全部被拒（DNS 解析到非公网地址） | 无法取回更新版本的源码；只能确认仓库确实公开存在（`deepseek-ai/deepseek-harness`） |
| 任何构建 / 测试 / 运行验证 | ❌ shell 不可用（`pwsh` 每次 `exit 0xC0000142`，`cmd` 同样无法绕过） | **本文所有 SYNC-THINK 结论均为静态阅读结论，未经执行验证** |

因此：本文中凡是"默认值、契约、流程"都可追溯到具体 `文件:行`；凡是实现细节（例如摘要提示词怎么写、`surface.replaceGeneration` 如何自增）都**没有**断言，只在需要时标注为"快照未给出"。

**版本漂移已解决**：`.agents/notes/.../2026-06-18-compaction-capability-seam.md:70` 写 `maxTokens: 8192`，而 `docs/config-catalog.md:705` 写"默认为解析出的 `headroomTokens`"。直接在**安装版 asar** 里核实：README 表格写 `maxTokens` 默认 `headroomTokens`（`65536`），实现代码同样是 `const headroomTokens = config.headroomTokens ?? 65536; const maxTokens = config.maxTokens ?? headroomTokens;`（asar 行 `727532`、`728045-728046`）。→ **以 65536 为准**，那条 `8192` 是快照内的陈旧记录。

> 关于 asar 的两条读法：`read` 失败是 DSH fs 层在 asar 路径上的缺陷（不是二进制检测——小二进制文件会干净地报 "binary file"）；`grep` 可用。另注意 `grep` 只能返回**匹配行**，无法取任意区间，所以想读整段源码仍需在正常 PowerShell 里手工解包（本机 shell 不可用，需人在 DSH 之外执行）。

---

## 3. DSH 的地基：日志、表面、派生历史

这一节是理解第 4、5 节的前提。

**日志即真源。** `Session` 是 typed `SessionEvent` 的 append-only log，每条带单调 `seq`、`time`、`type` 判别联合的 `data`。LLM 消息历史**不单独存储**，由 `deriveMessages()` 从日志派生（`<DSH>/docs/subsystems/core.md:348`）。

**表面（surface）是可替换的投影。** 只有"产生消息"的事件（`user/message`、`assistant/message`、`tool/result`、`system/message`）属于 `SurfaceEventType`，只有它们可以携带 `surfaceOp`；`compaction/*` 这类 bookkeeping 事件**不能**上表面（`.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md:13`）。

```ts
// <DSH>/docs/subsystems/session.md:348（节选）
surfaceOp: SurfaceOp      // { op: 'replace', startSeq, endSeq }
```

**替换是"位置区间"，不是"序列号区间"。** 这一点被反复强调：`shadowedRange` 的 `start` 可能**大于** `end`，因为一次更晚的替换会在更早的位置放一个 seq 更高的新节点；权威的阴影集合是 `shadowedSeqs`（按表面顺序）（`<DSH>/docs/subsystems/compaction.md:59-69`）。

**派生是缓存且冻结的。** 每个表面节点只投影一次；一次表面改写才重建；每次调用返回新数组但共享深层冻结的消息对象，所以"通过投影改历史"在类型上不可表达（`<DSH>/docs/subsystems/session.md:668`）。

---

## 4. DSH 怎么做上下文缓存

DSH 的"上下文缓存"不是一个模块，而是**四条互相配合的纪律**。

### 4.1 稳定前缀纪律：系统提示词是表面节点，不是请求字段

- 系统提示词**不作为请求的 `system` 字段发送**，而是作为派生历史里的 `system/message` 节点存在；循环构建出的请求"就是派生历史本身"（`<DSH>/docs/subsystems/llm-streaming.md:743`）。
- 首次进入时提示词占 surface node 0；渲染文本变化时有两种策略（`<DSH>/docs/subsystems/system-prompt.md:44`）：
  - 路由声明 `systemPromptUpdate: 'in-history'` → **把非空的新提示词追加在缓存历史之后**，模型读"任意位置最新的 system 消息"作为完整有效提示词；
  - 路由不支持 → 原地替换 node 0，并对后续非空 system 节点写"空替换"日志，保证旧提示词不会残留可见。
- 空渲染会清掉所有活跃 system 节点（不给模型留旧提示词）。

**复用要点**：这是"多花一点 token，换前缀不失效"的经典取舍。DSH 明确选择"追加而非改写"。

### 4.2 `request/header` + `request series`：把"前缀是否断裂"写进日志

`request/header` 记录请求信封（调用配置 + 适配器默认值标记 + 组装后的工具 schema），它是**日志状态**，因此每个会话请求都是日志的纯函数（`<DSH>/docs/subsystems/session.md:181-183`）。

| reason | 含义 |
| --- | --- |
| `initial` / `resume` | 循环实例边界，记录完整快照 |
| `change` | 信封变化，追加快照 |
| `series` | 信封未变但**显式开始一个新的消息序列**，追加快照 |

`initial`/`resume`/`change` 快照在同时开始新序列时带 `startsSeries: true`。**普通的 append-only 后续 turn、step、retry 都继承最新快照**（`session.md:183`）。

谁负责声明新序列？`agent/pre-step` 的进入决策可以带 `startsRequestSeries?: true`（`<DSH>/docs/subsystems/core.md:320-328`）。而 `request/context` 与 `request/header` 分开记录，用于保存"路由的 `systemPromptUpdate` 能力"，避免把适配器元数据混进信封相等性比较（`session.md:210`）。

**`startsSeries` 到底在什么条件下为真**，在快照里只有一条决策记录写清楚了（`.agents/notes/implemented/feature/2026-09-02-in-history-system-prompt-replacement.md:36`）：

1. `agent/pre-step` 显式声明；**或**
2. 表面的 `replaceGeneration` 前进了（即发生了替换：压缩、剪枝、图片卸载）；**或**
3. 某条路由没有 `toolUpdate` 能力、而可见的工具 schema 变了。

**provider/model 切换本身不算新序列**；resume 是"继续同一序列"，retry/turn/step 一律继承最新快照。这个标志是 log-only 的，**从不发给 provider**——它的作用只是决定"提示词变化时该追加还是该原地替换"。

> 这三条条件对 SYNC-THINK 的 P0-1 有直接价值：它给出了"什么时候必须换缓存身份"的**完整判据**，而不只是"压缩后要换"。

**什么会打断序列**（`<DSH>/docs/architecture.md:113`）：表面替换（surface replacement）、附加后的图片卸载决策、路由变化 → 都开始新序列；"未变化的 resume"继续同一个序列。

**复用要点**：SYNC-THINK 目前没有这个概念。它的等价物是 `ContextEpoch` 轮换，但**只在 provider/model/reasoningEffort/contextWindow 变化时才轮换**（`packages/storage/src/agent-context-store.ts:90-103`），压缩**不会**轮换（`closeEpoch` 在 runtime 里没有任何调用点）。见第 6、8 节。

### 4.3 Provider 侧的缓存参数与断点

DSH 把 provider 缓存参数的**能力位**放在 LLM 包配置层，把断点发射交给适配器（vendored `@earendil-works/pi-ai`）：

| 配置 | 作用 | 证据 |
| --- | --- | --- |
| `cacheRetention?: CacheRetention` | 提示词缓存保留偏好 | `<DSH>/docs/config-catalog.md:1684-1685` |
| `cacheControlFormat?`（`OpenAICompletionsCompat`） | `openai-completions` 的缓存标记约定 | `config-catalog.md:1832` |
| `supportsLongCacheRetention?: boolean` | 端点是否接受长缓存保留 | `config-catalog.md:1837` |
| `supportsCacheControlOnTools?: boolean`（`anthropic-messages`） | 工具定义能否带 `cache_control` 断点 | `config-catalog.md:1840-1841` |

用量侧有 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` 字段口径（`packages/adapters/src/gateway/wire-types.ts:139-140` 是 SYNC-THINK 的同名字段；DSH 侧见其 wire 扩展文档 `docs/deepseek-llm-api-wire-extensions.md`）。

**安装版实现核查（asar 行号）**——断点确实由 vendored SDK 发射，DSH 内核只提供开关与稳定前缀纪律：

| 事实 | 证据（asar 行） |
| --- | --- |
| `cacheControlFormat?: 'anthropic'` 的语义原文："Anthropic-style cache_control on system prompt, last tool, and last user/assistant text content" | `1089430` |
| 开关门控：`if (compat.cacheControlFormat !== "anthropic" \|\| cacheRetention === "none") { ...不打断点... }` | `1097037` |
| OpenRouter 上 `anthropic/*` 模型自动探测为 anthropic 格式 | `1097502,1097537,1097579` |
| `dsh-llm-pi-ai` 暴露 `cacheControlFormat`（schema 为 `z.union(CACHE_CONTROL_FORMATS)`，默认 `"offer"`） | `860385`、`859800` |
| 模型目录带 `cost.cacheRead` / `cost.cacheWrite`，用于算缓存收益 | `1105041`（示例条目） |

**前缀稳定性纪律也被写成了契约**（`dsh-agent-loop` README）：前缀必须**逐字节相同**才能复用；原地替换 system 节点会使"从该节点第一个 token 起"全部失效（node 0 就是全失效）；`systemPromptUpdate:'in-history'` 把新提示词追加在缓存历史之后，前缀因此存活；**改动一个被保留的工具定义也会使前缀从第一个变化 token 起失效**。子代理/fork 只复用"同 provider、同 model、同 prompt、同 schema 下逐字节相同的前缀"（asar `985577`、`1076768`）。

> 顺带一个值得学的工程实践：DSH 的**每个包 README 都自带一节 "KV-cache effect"**（在 asar 里该短语有 400+ 处匹配），也就是"这个包/这次改动对上游 KV 前缀有什么影响"是随包发布的显式文档。SYNC-THINK 的对应物目前是散落在 changelog 与 ADR 里的叙述。

### 4.4 压缩请求本身怎么复用 warm KV（最值得学的一招）

> "It replays the routed request's prefix and appends the compaction directive as a trailing user message so the provider's warm KV cache is reused."
> —— `<DSH>/.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md:36`

即：**摘要调用不是另起一个干净请求，而是重放当前已路由请求的前缀，只在尾部追加一条"请压缩"的 user 消息**，从而命中上游已经热起来的 KV 前缀。该调用的 `purpose` 设为 `compaction`；DeepSeek 适配器据此发 `x-deepseek-harness-compact: 1`（隐藏的传输元数据，不污染模型输入；`docs/deepseek-llm-api-wire-extensions.md:29`）。

安装版 README 把重放规则写得很具体（asar `727579`）：

- 重放 **surface 节点 0 的 `system/message` 作为 `messages` 的首项**，后接被遮蔽区间的消息（包括被遮蔽的 in-history `system/message`，保持其表面位置）；
- 提供 header 里的**有效工具定义**用于路由特定投影；
- **压缩指令作为最后一条 user 消息追加**；这条指令是冻结的 `RequestUserInput`，没有持久身份或来源，因此不污染持久消息；
- 空内容的 system 头节点不产生消息，但仍在压缩范围之外；
- 只把返回的**文本**写进 checkpoint（推理与工具调用被排除）；图片输出直接 `UNSUPPORTED_CONTENT` 失败，而不是静默消失。

**这三个细节合起来才是"warm prefix 复用"的完整条件**：system 头 + 工具集 + 被遮蔽区间必须逐字节重放，指令只能加在尾部。

对照 SYNC-THINK：现有设计是反过来的——**给 compact 保留独立的 `systemPromptOverride`，刻意不让摘要专用请求污染普通会话上下文缓存**（`docs/development/03-feature-changelog.md:3861`）。这是一个**显式取舍**，不是遗漏；第 8 节给出建议的折中方案。

### 4.5 不要混淆：`session-projection-cache` 不是提示词缓存

`ctx.sessionProjectionCache` 是**持久化的投影检查点**（节流检查点 + 轮次/结束/分离时的强制检查点），用于加速 prepared Session 的投影水合（`<DSH>/docs/capability-seams.md:638`）。它优化的是**宿主重放成本**，与 provider 的 prompt cache 无关。SYNC-THINK 里与它对应的是 `ConversationCompactBoundaryCache` / context snapshot 缓存一类的东西。

---

## 5. DSH 怎么做上下文压缩

压缩是一个 capability seam：Service Definition（`dsh-compaction`，`ctx.compaction`）+ Service Provider（`dsh-compaction-basic`）+ 可选剪枝服务（`dsh-compaction-tool-result-pruner`）+ 人类消费者（`/compact`）（`<DSH>/docs/subsystems/compaction.md:5`）。

### 5.1 触发点与默认参数

| 触发 | 挂载点 | 语义 |
| --- | --- | --- |
| `pressure`（压力） | `agent/pre-step` waterfall | 上一个成功 step 落盘之后、下一个请求派生之前 |
| `context-overflow`（溢出） | `agent/request-error` waterfall | 失败的 step 关闭之后，按"强制一次最大化的平衡头部缩减"处理 |

来源：`<DSH>/docs/agent-lifecycle.md:85`、`<DSH>/docs/subsystems/compaction.md:101`。

**默认参数**（`<DSH>/docs/config-catalog.md:692-711`，源码生成）：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `thresholdRatio` | `0.8` | 压力阈值 = 窗口比例，且被"窗口 − 预留输出 − headroom"封顶 |
| `headroomTokens` | `65536` | 在路由输出预留之外再留的余量 |
| `retainRatio` | `0.16` | 保留的近期上下文 = (窗口 − 预留输出) 的比例 |
| `retainTokens` | — | 绝对近期预算，与 `retainRatio` 互斥 |
| `summarizationProvider` / `summarizationModel` | 继承会话目标 | 必须成对设置 |
| `maxTokens` | 解析出的 `headroomTokens` | 摘要生成上限 |
| `compactionRetries` | `1` | 首轮压缩后压力仍超阈值时的额外尝试 |
| `maxOverflowRetries` | `1` | 溢出后的重试上限，`0` 关闭恢复 |
| `auto` | `true` | 是否装载自动监听器 |

剪枝服务（`<DSH>/docs/config-catalog.md:733-740`）：`thresholdChars 8192`、`headChars 4096`、`tailChars 1024`（**Unicode code point** 计数）。

### 5.2 选择算法：整单元尾部保留 + 工具配对平衡

- 单位（unit）= **一个完整关闭的 step**，或**一条无 step 的消息**。
- `compactIfNeeded` 保留"最小的、能达到保留 token 预算的整单元尾部"，压缩更早的节点。
- 如果 token 切点落在 step 内部，**保留区向后扩张直到工具调用/结果配对平衡**。
- 平衡判定按**表面顺序**而非日志 seq（因为替换摘要会在旧位置放新 seq）。
- 自动压缩**每次成功 step 之后**都检查，而不是每轮一次——这是"失控长轮次"能存活的关键：一个工具密集的 ReAct 轮次里，早期已关闭的 step 可以被提前压缩。
- **头部锚定**：自动压缩永远从表面头部开始，把上一个 checkpoint 与新压缩的历史合并，因此**永远只有一个自动 checkpoint**。手动中段压缩可能留下多个 checkpoint（`.agents/notes/.../2026-06-18-compaction-capability-seam.md:56-66`）。
- 无法拆分的单一超限单元（例如一条巨大的 `user/message`、或剪枝后仍然超限的工具单元）**明确超出压缩范围**，压缩返回 `null`（同上 `:62`）。

### 5.3 先剪枝、再摘要，且允许"只用剪枝"

一旦压力或规范溢出成立，`compaction-basic` 先调用可选的 `ctx.toolResultPruner`，然后**重新用 `ctx.tokenMeter` 度量**；如果剪枝已经恢复安全压力，就跳过摘要（`<DSH>/docs/subsystems/compaction.md:101`）。

剪枝本身是确定性的 head/middle/tail，按 code point 切片（不切断代理对，但可能切断字素簇）；每个替换**保留除 `content` 之外的全部事件数据**、引用被遮蔽节点、并在其前紧邻写一条 `compaction/prune` 定价事件，使纯消费者无需逐节点状态即可做减法（`<DSH>/docs/subsystems/compaction.md:216-247`）。

### 5.4 摘要调用

- 目标解析顺序：显式配置 → 最新已记录的路由目标 → agent 选项；`llm/stream` 路由后记录 provider/model 对。
- 复用当前请求前缀 + 尾部追加压缩指令（见 4.4）。
- `compaction/summary` 记录：摘要、可选完整 provider 输出、`llmStreamCall: true` 标记（证明恰好消耗一次本上下文的 `ctx.llm.stream()`）、被遮蔽的位置区间与 seq 集合、token 估算、provider/model/maxTokens/usage。目的是"这一发请求可以从日志 + 代码重建"（`<DSH>/docs/subsystems/compaction.md:16`）。
- 摘要失败有专门的恢复 waterfall `compaction/summary-error`：监听器**同步地**对选定输入做一次持久改动并返回 `true`，provider 重新派生并重新定价后重试；无法恢复就 `next()`（`compaction.md:262-278`）。

### 5.5 落盘形态：一个 `user/message` 承载摘要

```
compaction/start    → log-only，取得锁
[summarize older range]
compaction/summary  → log-only，记录摘要/区间/阴影 seq/token/模型调用
user/message        → source = COMPACT_CHECKPOINT_SOURCE
                      surfaceOp { op:'replace', startSeq, endSeq }
                      = 唯一的表面变更（带框架的摘要）
compaction/end      → log-only，释放锁（可带 error）
```

来源：`.agents/notes/.../2026-06-18-compaction-capability-seam.md:74-86`。

摘要**刻意复用 `user/message`**：`SurfaceEventType` 是封闭的，`compaction/*` 无法上表面；而"摘要本来就是 user 角色的上下文"，所以复用是诚实的而非 workaround。替换必须引用被遮蔽的全部源事件（`sourceEventSeqs`），以便重放校验。

### 5.6 锁是日志事件，不是进程内互斥

- `compaction/start` … `compaction/end` 是**唯一的锁**；自动、手动、显式区间三个入口都拒绝"存在活的未配对 start"。
- 摘要（慢模型调用）在 `start` **之后**才落盘，因此崩溃会留下"有 start 无 end"的**可检测孤儿**，而不是静默损坏。
- 生命周期边界：最新 `session/end-seed` 之后的悬空 `start` = 活锁（报 busy）；更新的 `session/end-seed` 证明旧的未配对 start 已过期 → resume/fork/adoption 不会被死写者卡住。
- 可恢复失败：start 落盘后只做**恰好一次** `compaction/end { error }` 尝试；关闭写入失败则保留未配对 start，**故意继续阻塞**。
- 手动失败的分类：`busy | cancelled | changed | summary | commit | persistence`（`<DSH>/docs/subsystems/compaction.md:88-99`）。

**核心 session 修复保持与 compaction 无关**：`interruptedTurnClosers` 从不被告知 `compaction/*`，通用 `session/end-seed` 边界已经提供了所需证据（同 `:109`）。

### 5.7 收敛与重试

- 每个已提交的摘要**必须比它遮蔽的内容更小**。
- 压力未消则最多按 `compactionRetries` 重复压缩**头部 checkpoint**。
- 溢出路径不需要容量元数据，绕过阈值与保留策略，做**一次最大化的平衡头部缩减**，只留下最新的不可分单元；只有在 `session.surface.replaceGeneration` **增加**时才返回 `{ kind:'retry' }`（包括"只有剪枝进展"的情况）。没有替换、恢复失败、取消、上限耗尽或无关错误，都保留原始 provider 失败（`agent-lifecycle.md:85`、`compaction-capability-seam.md:40-42`）。

### 5.8 Token meter：可复现度量

`ctx.tokenMeter` 暴露一个 detached replay snapshot（`<DSH>/docs/subsystems/token-meter.md:5-29`）：

- `logRevision`：该测量消费的持久事件数（= 下一个未读 seq）。
- `baseline`：`usage`（最新成功调用且规范请求信封一致、总量不低）或 `estimated`。
- `surfaceDeltaTokens`：相对匹配锚点的**有符号**重定价（增长与收缩都保留）。
- `totalTokens`（请求+响应压力）与 `surfaceTokens`（按路由定价的表面总量，等于各节点价格之和）。
- `TokenSurfaceNode`：`seq`、`tokens`（按测量路由定价，图片按路由声明的视觉价）、`heuristicTokens`（路由无关的固定启发式，供 shadow-price 协议使用）。
- 表面顺序是权威的；替换节点的 seq 可以高于位置更后的节点；快照不可变，不随 fold 前进而增长。

**触发、保留、区间选择全部读同一个节点的价格**——这是 DSH 压缩能"先剪枝后重测"的基础设施。

### 5.9 图片卸载

`compaction-image-offload` 拥有 `image/offload` 声明与纯消息投影：目标按"当前输入节点 + 该消息内深度优先的图片序号"定位，事件保留节点与消息身份，**不携带 `surfaceOp`**（`<DSH>/docs/subsystems/compaction.md:25-38`）。

### 5.10 安装版实现核查（直接读 `app.asar`）

以下是在**安装版**（`D:/tools/deepseek-harness/resources/app.asar`）里用 `grep` 直接核到的实现事实，用来把上面文档层的描述钉死（行号为 asar 内的行号）：

| 事实 | 行号 |
| --- | --- |
| 阈值公式原文：`floor(min(W × thresholdRatio, W − O − headroomTokens))` | `727526` |
| `maxTokens` 默认跟随 `headroomTokens`（README 表格 + 实现代码） | `727532`、`728045-728046` |
| 自动路径完整描述：串行 `agent/pre-step` 监听器 → 定价最新持久已路由信封 → 超阈值则先剪枝、再摘要"最老的平衡区间"、保留按价格计的近期尾部 | `727573` |
| **"每个被选区间都从第一个非 `system/message` 的表面节点开始，所以 surface 节点 0 的系统提示词永不被遮蔽"**；由 in-history 提示词更新追加的后续 `system/message` 则属于普通历史，可被遮蔽 | `727573`、`728385` |
| 溢出路径：无视阈值与保留策略，只做一次最大化的平衡头部缩减，**仅当表面替换代数前进后**才允许重试 | `727573` |
| 摘要调用重放规则（surface 节点 0 + 被遮蔽区间 + 有效工具 + 尾部指令；空 system 头不产生消息但不在压缩范围内） | `727579` |
| checkpoint 形态：前导 + 空行 + `<compacted-summary>` + 摘要 + `</compacted-summary>`；遇已有 checkpoint 时要求"合并而非照抄" | `727627`、`727685`、`728216-728217` |
| **摘要期间的一致性复核**：用 `isDeepStrictEqual` 比对测量节点、阴影 seq 集合、选中区间三处，任一变化抛 `SurfaceChangedError` | `728592`、`728606-728607` |
| `shadowedSeqs` 必须精确命名当前表面的一个连续区间，否则拒绝 | `930649`、`949929` |

其中**最值得直接搬的两条**：

1. **`SurfaceChangedError` 式复核**——摘要是一次慢模型调用，期间历史仍可能增长。DSH 在落盘前重算并逐项比对"测量结果 / 阴影集合 / 选中区间"，任一不同就放弃本次压缩。SYNC-THINK 目前没有等价保护，而它的"边界 = 时间戳"模型在并发下更容易写错。
2. **"区间永不含 surface 节点 0 的系统提示词"**——压缩只动历史，不动提示词前缀。这与 SYNC-THINK 把系统提示词放在请求字段、把历史单独过滤的现状可以一一对应：**压缩实现里必须显式排除系统提示词段**。

---

## 6. SYNC-THINK 现状（静态阅读）

### 6.1 模型可见历史怎么产生

`buildProviderMessagesFromDurableMessages()`（`apps/runtime/src/context-message-history.ts:161-225`）：

- 按 `sequence` 排序，然后**按 `compactedAt` 时间戳过滤**：早于边界的消息直接不进请求（`:164-171`）。
- 被取消的 assistant 消息会展开成"已被中止"的 system 提示 + 工具轨迹（`:178-191`）。
- 压缩后的请求带 `compactSummary` / `compactedAt` 返回（`:219-224`）。
- 压缩通知类 system 消息被显式排除，不回灌模型（`:175`）。

**还有第二道、且完全静默的裁剪**：`buildChatProviderMessages`（`apps/runtime/src/runtime.ts:26936-26996`）在压缩过滤之后，还要过一层 `selectRecentMessagesWithinBudget(built.messages, floor(window * 0.82))`（`:26992-26994`），并且历史读取本身在 `1.25 × window` 处停止分页（`:26929` 附近）。这两处**不产生任何事件、也不写 truncation 记录**——不同于 `context-packet` 路径里的 `PeekContextTruncationItem`。也就是说："模型看不到某些历史"这件事可能发生在压缩之外，而当前没有任何可观测证据。

**关键差异**：原始消息保存在权威存储里（与 DSH 一致，"压缩不删原文"），但"哪些内容被遮蔽"这件事**只由时间戳推断**，没有可回放的替换记录，也没有 `sourceEventSeqs` 式的引用完整性校验。压缩边界一旦有同毫秒/时钟回拨/迁移问题，没有第二条证据可以交叉验证。

### 6.2 触发、选择、摘要、落盘

| 环节 | 现状 | 证据 |
| --- | --- | --- |
| 命令入口 | `conversation.compact`（manual / auto 两种模式） | `packages/protocol/src/commands.ts:4243-4279` |
| 编排 | `handleConversationCompact`：门禁 → 切分 → 本地降级 → 模型摘要 → 收缩校验 → 单事务落盘 | `apps/runtime/src/runtime.ts:10688-11069` |
| 阈值 | `usageRatio >= 0.7` | `apps/runtime/src/context-snapshot.ts:4,250-253` |
| **谁触发自动压缩** | **只有渲染端**：`useConversationCompaction` 在 native 内核下按 0.7 发请求；**Runtime 从不自触发** | `apps/desktop/src/renderer/shell/use-conversation-compaction.ts:209-218`、`context-snapshot.ts:4` |
| 保留 | **固定最近 8 条消息**（`keepRecent` 可覆盖） | `apps/runtime/src/chat-tools.ts:2475`、`runtime.ts:10799` |
| 切分 | `splitHistoryForCompact(messages, keepRecent)` | `chat-tools.ts:2711-2737` |
| 摘要提示词 | Claude-Code 风格 9 段模板 | `chat-tools.ts:2498-2529` |
| **模型摘要调用** | `generateModelCompactSummary` → `openProviderStream`，`toolsEnabled:false`、`networkEnabled:false`、`reasoningEffort:'off'`、90s 中止、`systemPromptOverride: COMPACT_SUMMARY_SYSTEM_PROMPT` | `runtime.ts:11091-11153`（调用点 `:10877-10882`） |
| 本地降级 | head/tail 折叠成摘要文本，模型不可用时使用 | `chat-tools.ts:2798-2854` |
| 收缩校验 | `isMeaningfulCompactReduction`（**≤ 0.9×** 才算有效），否则返回空摘要、不写边界 | `chat-tools.ts:2697-2705`、`:2837-2845` |
| 落盘 | `context.compacted` 事件 + 可见的 `compact:true` system marker；写 `compactBoundaryCache`（可从事件 rehydrate）；失效 snapshot 缓存 | `runtime.ts:11013-11020`、`apps/runtime/src/conversation-compact-boundary-cache.ts` |
| 可观测 | `context.compaction_started` / `.compacted` / `.compaction_skipped`（reason：below-threshold / insufficient-history / no-reduction）/ `.compaction_failed` | `runtime.ts:10758,10802,10850,10907,10958,10984,11045` |
| 外部内核 | 只发 `kernel.context_compaction_started/compacted`，**故意不冒用** `context.compacted` | `packages/shared/src/types/kernel.ts:285-295`、`docs/development/03-feature-changelog.md:6289` |
| 前端 | `useConversationCompaction` 管理自动/手动请求、宿主进度、会话锁与计时器 | `docs/engineering/cohesion-refactor-2026-09-19.md:1106-1113` |

注意：这里的"收缩校验"（≤0.9×）与 DSH 的"每个摘要必须比它遮蔽的内容更小"是**同一个不变量**，SYNC-THINK 已经具备——而且这是 SYNC-THINK 少有的、比 DSH 默认参数更激进的一处。

### 6.3 工具输出折叠（已有的"剪枝"，但是临时的）

- 每轮构建 chat messages 时执行 `foldLongToolOutputsInMessages(..., { preserveBoundedSourcePages: true })`（`runtime.ts:21775`）。
- 折叠是 head/tail，阈值 `COMPACT_TOOL_OUTPUT_FOLD_CHARS = 2000`，保留最近 `COMPACT_TOOL_OUTPUT_KEEP_RECENT = 2` 条工具结果不动；受 `preserveBoundedSourcePages` 保护的"有界不可变来源页"（带 `sourceSha256` / offset 且单页 ≤ 50k）额外豁免，总预算 100k（`chat-tools.ts:2868-2890`、`2902-2936`）。
- 结论：**机制上已经和 DSH 的 pruner 同类**（head/tail、保留最近、保护可回读来源）。差异是：阈值硬编码、按"条数"而非"token 预算"保留、结果**不落盘**（每次都重算）、**不参与压力判定**（只影响发送内容，不改变 `estimatedUsedTokens` 的度量口径）。

### 6.4 缓存身份与用量（**存在两套互不兼容的 key**）

- **chat 路径**：`` `sync-think:${providerId}:${modelId}:${threadId}` ``（`apps/runtime/src/demo-run.ts:764-770`）——**没有 epoch**，跨轮稳定，压缩后也不变。
- **orchestration 路径**：`` `${providerId}:${modelId}:${agentContextThreadId}:${contextEpoch.id}` ``（`apps/runtime/src/orchestration/production-step-executor.ts:324-327`），带 `retention:'24h'`、`strategy:'automatic'`（`:525-533`）。
- `ContextEpoch` 只在 provider/model/reasoningEffort/contextWindow 变化时轮换，旧 epoch 关闭（`packages/storage/src/agent-context-store.ts:90-103`）。
- **两套 key 都不包含前缀内容**（system prompt、工具 schema、前缀字节都没有指纹）；`strategy` 字段实际只被当成"有没有 key"来读（`packages/adapters/src/openai/prompt-cache.ts:8,26`、`anthropic/stream-messages.ts:184`）。
- **压缩完成后既没轮换 epoch、也没改缓存 key**：`runtime.ts:11013-11020` 只写边界与缓存，`closeEpoch` 在 `apps/runtime/src` 中没有任何调用点。→ **前缀被替换了，但缓存身份没变**。这是与 DSH"surface replacement 必开新 request series"最直接的一处缺口。
- 适配器断点：Anthropic 侧 system 块 + 最后一个工具 + "最近两条非最终消息"，并**刻意排除变化的最后一条 user**，共 4 个断点预算（`packages/adapters/src/anthropic/stream-messages.ts:184-202`、`:319-329`、`:338-341`）；OpenAI 侧按 gpt 版本选择 `prompt_cache_key + prompt_cache_options{mode:implicit,ttl:30m}` 或 `prompt_cache_key + prompt_cache_retention`，并对第三方中转跳过（`packages/adapters/src/openai/prompt-cache.ts:25-43`），遇到 400 会降级重试一次（`openai/gateway-degrade.ts:17-34`）。
- **gateway 路径会丢掉所有断点**（`gateway/openai-to-anthropic.ts:49-58`，由 `anthropic-to-openai.test.ts:29-41` 的 `flattenAnthropicSystem` 证明）；`gateway/wire-types.ts:139-140` 声明的 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` **从未被读取**。
- 已有按 request/thread/epoch/purpose 汇总的用量口径（`docs/development/03-feature-changelog.md:5727-5728`）。

### 6.5 多内核边界（复用时必须尊重）

- 厂商原生 session 负责模型上下文/压缩/缓存前缀，SQLite timeline 负责 UI 恢复、审计与受限跨内核移交（`docs/development/03-feature-changelog.md:2281`）。
- Native 由宿主做 70% 自动压缩；ClaudeCode / Codex 等自管压缩的外部内核**只展示内核通知，宿主不再执行第二次压缩**（`docs/development/03-feature-changelog.md:2709`、`:2235`）。
- → 任何压缩/缓存改造都**只能作用于 native 内核路径**，并且不能与外部内核的 `kernel.context_compacted` 混用（`:6289`）。

### 6.6 其他已有资产

- `selectContextSources()`（`packages/core/src/context-packet.ts:535-590`）：protected 永不静默丢弃 + 可压缩项出局 + 允许软截断 + `truncations` 记录 + `overflow` 标记。这是一套**预算分配器**，和 DSH 的 token meter 是不同层的东西（前者管"哪类上下文进不进"，后者管"表面节点多少钱"）。
- `conversation-context-status` 六段分解（system/agent/project/summary/messages/tools）与 `usageRatio` 自洽校验（`packages/protocol/src/conversation-context-status.ts:43-131`）。

### 6.7 与本次复用直接相关的既有缺口

以下每一条都已在本仓库源码中定位；它们不是"DSH 有而我们没有"的抽象差距，而是**改造时必须先处理的具体问题**：

1. **压缩调用的 token 用量被丢弃**：`generateModelCompactSummary` 的流循环只处理 `text-delta` / `error` / `finished`，**从不读 `usage` 事件**（`runtime.ts:11134-11143`）→ 摘要花费完全未计量。DSH 侧把 `usage` 记进 `compaction/summary`。
2. **`ProviderUsagePurpose` 的 `'compaction' | 'summary' | 'delegation'` 不可达**：唯一的生产者只返回 `normal | review | revision`（`apps/runtime/src/orchestration/production-step-executor.ts:2379-2383`）。→ 就算想按 purpose 统计摘要成本，现在也没有落点（`packages/shared/src/types/usage.ts:4` 已声明枚举）。
3. **静默历史丢弃**：`window × 0.82` 预算裁剪与 `1.25 × window` 分页停止都不上报（见 §6.1）。
4. **缓存身份不因压缩而失效**，且两套 key 互不兼容、都不含前缀指纹（见 §6.4）。
5. **gateway 路由丢失全部缓存断点**，且从不设置 key（见 §6.4）。
6. **自动压缩依赖渲染端**：headless / CLI / MCP 会话没有 0.7 自动压缩，只剩第 3 条的静默丢弃（§6.2）。
7. **没有线程级压缩锁**：`handleConversationCompact` 只依赖前端 flag，并发的 compact 帧理论上可以重复写边界（对照 DSH 的日志锁）。
8. **边界靠墙钟比较**：`Date.parse(createdAt) > Date.parse(compactedAt)`，没有内容证明哈希（`context-message-history.ts:164-171`）。
9. **两套 token 估算互相不一致**：ContextRing 用 `byteLength/4`（`context-snapshot.ts:81-84`），压缩用 `String.length/4`（`chat-tools.ts:2577-2584`），**对中文会明显分叉**。→ 这会让"阈值判定"和"压缩收益判定"用不同尺子。

---

## 7. 逐维度对比

| 维度 | DSH | SYNC-THINK | 差距性质 |
| --- | --- | --- | --- |
| 历史真源 | append-only log，模型历史是派生投影 | 消息表 + `sequence` 排序 + 时间戳过滤 | **模型不同**（可回放 vs 可推断） |
| 改写原语 | `surfaceOp { replace, startSeq, endSeq }` + `sourceEventSeqs` | 无显式原语；`compactedAt` 边界 + marker 消息 | 缺引用完整性与可回放性 |
| 被替换内容 | 阴影 seq 集合 + token 计数，权威且可校验 | 由时间戳推断 | 缺"被遮蔽集合"这一事实 |
| 缓存前缀纪律 | 系统提示词作为表面节点；支持时**追加在缓存历史之后** | 系统提示词作为请求字段（`systemPrompt`） | SYNC-THINK 改提示词即改前缀 |
| 前缀断裂信号 | `request/header` + `startsRequestSeries` + `request/context` | 无；压缩后缓存身份不变 | **最直接可补的缺口** |
| 缓存身份 | 由请求信封相等性 + 序列边界定义 | `provider:model:thread:epoch` + 24h | 结构不同；SYNC-THINK 需在压缩时轮换 |
| 压力量化 | `logRevision` + 节点级定价 + usage/estimated 锚点 + 有符号 delta | `estimatedUsedTokens`（单一估算） | 缺"可复现 + 定位到节点" |
| 触发 | pre-step 压力（每次成功 step 后）+ request-error 溢出 | 发送前 `usageRatio >= 0.7` | 缺"轮次内早期关闭 step 也能压" |
| 保留策略 | token 比例（0.16）/绝对 token + 整单元 + 工具配对平衡 | **固定 8 条消息** | 语义粗；长工具轮次会失衡 |
| 剪枝 | 确定性 head/middle/tail，阈值 8192/4096/1024，**持久化单节点替换 + 定价**，可单独消压 | head/tail 2000，保留最近 2 条，**每轮临时**，不参与消压 | 机制同源，缺持久化/定价/消压短路 |
| 摘要调用 | 重放当前路由前缀 + 尾部追加指令 → 复用 warm KV；`purpose=compaction` | 独立 `systemPromptOverride`（刻意隔离） | **取向相反**，需产品决策 |
| 落盘形态 | 一条 `user/message` checkpoint + 3 个 log-only 事件 | `context.compacted` 事件 + marker 消息 + `compactSummary` | 形态相近，语义弱 |
| 锁 | 日志事件当锁；崩溃留下可检测孤儿；`session/end-seed` 生命周期边界判定陈旧 | UI 侧 `useConversationCompaction` 会话锁 + 120s 等待 | **锁在内存/UI，不在持久事实** |
| 崩溃恢复 | 未配对 start = 活锁；陈旧 start 可判别 | 无显式语义（依赖 marker 事件存在性） | 缺崩溃语义 |
| 重试/收敛 | 摘要必须更小；`compactionRetries 1`；`maxOverflowRetries 1`；只在 `replaceGeneration` 前进时 retry | `isMeaningfulCompactReduction` 已有；无有界重试与 generation 概念 | 半个不变量已有 |
| 工具配对 | 边界必须 balanced，导出 before/after 校验函数 | 无（按条数切分可能切断 call/result） | 真实风险点 |
| 静默裁剪 | 每次替换都有事件与阴影定价，模型看不到什么都能查 | `window×0.82` 预算裁剪与 `1.25×window` 分页停止**无事件、无记录** | 可观测性缺口 |
| 摘要调用的计量 | `usage` 与 `rawOutput` 记进 `compaction/summary` | 摘要流**丢弃 `usage`**；`ProviderUsagePurpose` 的 compaction/summary 不可达 | 成本不可见 |
| 自动压缩的触发位置 | 内核自身在 `agent/pre-step` / `agent/request-error` 触发 | **只在渲染端触发**；Runtime 不自触发 | headless/CLI 无自动压缩 |
| 摘要期间的一致性 | 摘要前后 `isDeepStrictEqual` 复核 surface 与选中区间，变化则抛 `SurfaceChangedError` | 无等价复核 | 并发/竞态下可能写错边界 |
| 图片 | 独立 `image/offload` 事件 + 纯投影 | 图片按 `storageRef` 按需重送（`docs/specs/2026-07-27-...:317`） | 形态不同，暂不构成缺口 |
| 模型可见的压缩工具 | **没有**（`/compact` 是人类命令） | **没有**（`/compact` 是人类命令） | 一致 ✅ |
| 多内核 | 不适用（DSH 自己就是内核宿主） | 外部内核自管；改造需隔离 | 复用必须限定 native |

---

## 8. 可复用清单（按风险分层）

### P0 — 低风险，可独立交付，建议先做

#### P0-1 压缩后轮换缓存身份（补上"前缀断裂"信号）

- **DSH 依据**：表面替换/图片卸载/路由变化都开始新的 request series（`<DSH>/docs/architecture.md:113`）；`request/header` 的 `series` reason 把这件事变成日志事实（`session.md:183`）。
- **SYNC-THINK 落点**：`apps/runtime/src/runtime.ts:11013-11020`（压缩成功分支）、`packages/storage/src/agent-context-store.ts:90-103`（epoch 轮换）、`apps/runtime/src/orchestration/production-step-executor.ts:324-327`（key 构造）。
- **改动要点**：压缩成功写入边界后，关闭当前 epoch 并开启新 epoch（或等价地让缓存 key 携带一个 `compactionGeneration`）；把"新序列开始"记进上下文事件，便于 UI/诊断解释"为什么这次是 cache miss"。
- **验收**：连续两轮对话的第二轮只发生一次压缩；压缩后第一条请求的用量事件里 `cacheWrite > 0` 且 `cacheRead` 明显下降；压缩前后 key 不同，未压缩时 key 稳定不变。
- **风险**：低。需要确认没有别的逻辑依赖"epoch 在压缩后保持不变"（`docs/engineering/cohesion-refactor-2026-09-19.md:587` 提到过"epoch 复用/轮换与 prompt cache key 不变"，需先核对这条约束的确切含义）。

#### P0-2 保留策略：从"8 条"改为"token 比例 + 工具配对平衡"

- **DSH 依据**：`retainRatio 0.16`（`config-catalog.md:697-700`）；保留"整单元的最小尾部"，切点落在 step 内就扩张到配对平衡（`compaction-capability-seam.md:56-58`）。
- **SYNC-THINK 落点**：`apps/runtime/src/chat-tools.ts:2475,2802`；调用点 `runtime.ts:10799`。
- **改动要点**：保留量按 `(contextWindow − 预留输出) × retainRatio` 计算（默认 0.16），并保证切点不切断 `tool_call` 与其 `tool_result`；`keepRecent` 保留为显式覆盖。
- **验收**：构造"一条超长工具输出 + 少量消息"的会话，压缩后保留区不以孤儿 `tool` 消息开头；保留条数随窗口大小缩放（128k 与 400k 窗口下保留量不同）。
- **风险**：低-中。需要 token 估算与消息单元（step）概念在 runtime 侧可得。

#### P0-3 剪枝阈值可配置 + 参与压力判定

- **DSH 依据**：`thresholdChars 8192 / head 4096 / tail 1024`（`config-catalog.md:733-740`）；剪枝后**重新度量**，恢复安全压力就跳过摘要（`docs/subsystems/compaction.md:101`）。
- **SYNC-THINK 落点**：`apps/runtime/src/chat-tools.ts:2488-2490,2868-2890,2902-2936`；调用点 `runtime.ts:21775`。
- **改动要点**：把 2000/2 提升为配置（建议默认贴近 DSH 的 8192/4096/1024，但先量测现状再定）；把剪枝结果纳入 `estimatedUsedTokens` 的度量，使"只用剪枝就够"的场景不再触发摘要。
- **验收**：单条 200KB 工具输出场景下，压缩事件流出现 `compaction_skipped(reason: pruned-enough)` 且未调用摘要模型。
- **风险**：中。改度量口径会影响 ContextRing 的百分比显示，需要一起验证。

#### P0-4 有界重试与"重试必须带来进展"

- **DSH 依据**：`compactionRetries 1`、`maxOverflowRetries 1`（`config-catalog.md:707-710`）；只有 `surface.replaceGeneration` 前进才 retry（`agent-lifecycle.md:85`）。
- **SYNC-THINK 落点**：`runtime.ts` compact 处理链、`chat-tools.ts:2837-2845`。
- **改动要点**：为"压缩后仍超阈值"引入有界重试；为每次成功的表面改写维护一个单调 `surfaceGeneration`；重试/溢出恢复只在 generation 前进时发生。
- **验收**：一次压缩未把占用压到阈值下时，最多重试 1 次；重试失败不会吞掉原始错误，也不会无限循环。
- **风险**：低。

#### P0-5 度量与事件补全

- **DSH 依据**：`TokenMeasurement{logRevision, baseline, surfaceDeltaTokens, totalTokens, surfaceTokens, nodes[]}`（`token-meter.md:13-26`）。
- **SYNC-THINK 落点**：`apps/runtime/src/context-snapshot.ts`、`packages/protocol/src/conversation-context-status.ts`。
- **改动要点**：给估算加"消费到哪个序号（logRevision 的等价物）"和"baseline 是 usage 还是 estimated"；把被遮蔽内容的 token 数写进压缩事件（DSH 有 `shadowedTokenCount`）。
- **验收**：同一日志前缀两次度量结果完全一致；压缩事件能回答"释放了多少 token、遮蔽了哪些消息"。
- **风险**：低。

#### P0-6 补上"摘要花费"与"静默裁剪"的可观测性（零行为变更）

- **DSH 依据**：`compaction/summary` 记录 `usage` 与 `rawOutput`，使"这一发请求可以从日志 + 代码重建"（`<DSH>/docs/subsystems/compaction.md:16`）；剪枝的阴影定价让"省了多少"可被 O(1) 复现（`compaction.md:216-247`）。
- **SYNC-THINK 落点**：`apps/runtime/src/runtime.ts:11134-11143`（丢弃 usage 的流循环）、`:26992-26994`（0.82 静默裁剪）、`packages/shared/src/types/usage.ts:4`（已声明的 purpose 枚举）、`production-step-executor.ts:2379-2383`（唯一 purpose 生产者）。
- **改动要点**：① 摘要调用读取并记录 `usage`（含 cacheRead/cacheWrite）；② 让 `ProviderUsagePurpose` 的 `'compaction'` 真正可达；③ 给 `window×0.82` 裁剪与 `1.25×window` 分页停止补一个事件或 truncation 记录。
- **验收**：跑一次手动压缩后，`usage.summary` 里出现 `purpose='compaction'` 的条目且 token 数非零；构造超预算会话时能看到"被丢弃了多少条/多少 token"。
- **风险**：低（不改行为，只加记录）。这是**先决条件**：没有它，后面任何"压缩是否划算"的判断都只能靠猜。
- **额外收益**：顺带修掉第 9 条的双估算尺问题（统一为一个 `estimateTokens` 入口），否则"释放了多少"本身就有两个答案。

### P1 — 需要结构性改造

#### P1-1 把"压缩边界"升级为"可回放的替换记录"

- **DSH 依据**：`surfaceOp { op:'replace', startSeq, endSeq }` + `shadowedSeqs` + `sourceEventSeqs`（`session.md:348`、`compaction.md:59-69`、`compaction-capability-seam.md:74-86`）。
- **SYNC-THINK 落点**：`apps/runtime/src/context-message-history.ts:164-171`（时间戳过滤）、`runtime.ts:11013-11020`（写边界）、`apps/runtime/src/context-snapshot.ts`。
- **改动要点**：压缩时持久化一条替换记录（被遮蔽的 message id/seq 集合 + 新 summary 消息 id），派生历史优先按该记录过滤，时间戳仅作回退。**不需要**引入完整 surface 引擎；只需要"显式的被遮蔽集合"。
- **验收**：跨越时区/时钟回拨/迁移后派生历史不变；替换记录引用的消息若缺失，能报出可诊断错误而不是静默丢上下文。
- **风险**：中-高。涉及存储与迁移；需要 `apps/runtime` 与 `packages/storage` 协同。

#### P1-2 把临时剪枝升级为"持久化单节点替换 + 定价"

- **DSH 依据**：`PrunedEntry{originalSeq, replacementSeq, callId, charsBefore, charsAfter}`、`compaction/prune` 定价事件（`compaction.md:109-133,216-247`）。
- **SYNC-THINK 落点**：`runtime.ts:21775`、`chat-tools.ts:2902`。
- **改动要点**：折叠结果写入一条可回放记录并附"这次替换省了多少"的定价，使消费者 O(1) 修正总账，而不是重算。
- **验收**：任一时刻的上下文占用可由"原始总量 − 全部 prune 定价 + 增量"复现，且与实测一致。
- **风险**：中。当前每轮重算的做法在正确性上没问题，改持久化主要是为了度量与审计。

#### P1-3 把锁从 UI/内存搬进持久事实

- **DSH 依据**：`compaction/start … compaction/end` 是唯一锁；崩溃留下可检测孤儿；陈旧 start 由 `session/end-seed` 生命周期边界判别（`compaction-capability-seam.md:92-109`）。
- **SYNC-THINK 落点**：`context.compaction_started` / `context.compacted` 事件（`runtime.ts:10850+,11013-11020`）；UI 侧 `useConversationCompaction` 的会话锁与 120s 等待（`docs/engineering/cohesion-refactor-2026-09-19.md:1106-1113`）。
- **改动要点**：定义"未配对的 `compaction_started` = 活锁"，以及"会话生命周期边界之后的陈旧 start 应被忽略"；失败时恰好写一条带 error 的结束事件。
- **验收**：压缩中途杀进程并重启，该会话不会被永久卡在 busy；日志里能区分"活锁"与"陈旧锁"。
- **风险**：中。

#### P1-4 摘要期间的一致性复核（`SurfaceChangedError` 等价物）

- **DSH 依据**：摘要是一次慢模型调用；DSH 在落盘前用 `isDeepStrictEqual` 重新比对"测量节点 / 阴影 seq 集合 / 选中区间"三处，任一不同就抛 `SurfaceChangedError` 放弃本次压缩（asar `728592,728606-728607`）；此外表面校验要求 `shadowedSeqs` 精确命名一个连续区间（asar `930649`）。
- **SYNC-THINK 落点**：`apps/runtime/src/runtime.ts:10877-11020`（摘要 → 收缩校验 → 单事务落盘之间没有复核）；边界由时间戳决定（`context-message-history.ts:164-171`）。
- **改动要点**：在 `generateModelCompactSummary` 返回之后、写边界之前，重新取一次"将要被遮蔽的消息 id 集合 + 边界"，与摘要开始时的快照比对；不一致则放弃本次压缩并写 `compaction_skipped(reason: surface-changed)`。
- **验收**：在摘要进行中并发追加消息，压缩不会把新消息错误地划入被遮蔽区间；事件流出现 `surface-changed` 的跳过原因。
- **风险**：低-中（纯防御性，但需要定义"什么算同一个快照"）。
- **依赖**：P0-6 之后才有观测手段验证它真的被触发过。

### P2 — 不建议照搬

1. **整套 cordis capability seam / 插件分层**。SYNC-THINK 没有 cordis 运行时，移植契约层只会带来抽象成本。**应借语义，不借包结构。**
2. **完整 surface 引擎（位置 span、非单调 seq、replaceGeneration 语义）**。收益是"任意区间压缩 + 引用完整性"，代价是重写派生历史与全部读取方。建议先用 P1-1 的"显式被遮蔽集合"拿到 80% 收益。
3. **模型可调用的压缩工具**。DSH 明确没有（`compaction.md:84`）；SYNC-THINK 同样没有，保持一致。
4. **把头锚定"只留一个自动 checkpoint"直接套到产品 UI 上**。SYNC-THINK 会把压缩过程展示成可见消息与状态行（`docs/development/03-feature-changelog.md:2704`），单一 checkpoint 语义需要与"用户可见的压缩历史"重新对齐，属于产品决策而非技术移植。
5. **摘要请求复用 warm prefix（4.4）无条件照搬**。SYNC-THINK 现在是刻意隔离（`03-feature-changelog.md:3861`）。建议**折中**：默认保持隔离；对"压缩时上下文已经很长、重放一次前缀成本可接受"的场景，提供一个可开关的"replay-prefix 摘要"实现（复用同一请求前缀 + 尾部追加指令 + `purpose: 'compaction'`），并用用量事件对比 cache hit 与总体成本后再决定默认值。`packages/shared/src/types/usage.ts` 里已有 `'compaction'` purpose 分类，接入成本低。

---

## 9. 建议的落地路线

**阶段 0（先度量，不改行为）**
- 补 P0-6 的计量与事件（摘要 `usage`、静默裁剪上报）与 P0-5 的度量字段；统一两套 token 估算口径。
- 采集真实会话中"压缩前后的 cache read/write、被遮蔽 token 数、剪枝节省量、0.82 裁剪丢弃量"。
- 退出条件：能用数据回答"当前 8 条保留 + 2000 字符折叠到底省了多少、有没有造成孤儿 tool 消息"，且能解释每次压缩花了多少钱。

**阶段 1（缓存身份与保留策略，P0-1 / P0-2 / P0-4 / P1-4）**
- 压缩后按 §4.2 的三条判据轮换缓存身份；保留量改 token 比例 + 配对平衡；有界重试 + generation；摘要前后一致性复核。
- 退出条件：压缩后一轮的 cache miss 可解释；长工具会话无孤儿 tool 消息；重试有上界；并发追加不会写错边界。

**阶段 2（剪枝升级与持久锁，P0-3 / P1-2 / P1-3）**
- 剪枝阈值可配置并参与消压判定；剪枝落盘定价；锁语义持久化。
- 退出条件：单条超大工具输出场景不再触发摘要调用；崩溃重启不卡 busy。

**阶段 3（可选，P1-1 / 自动压缩下沉 / 4.4 的 replay-prefix 摘要）**
- 显式"被遮蔽集合"替换时间戳过滤；评估把自动压缩从渲染端下沉到 Runtime（headless 会话当前没有自动压缩）；评估 replay-prefix 摘要的净收益后决定默认。

**贯穿约束**
- 所有改造只作用于 **native 内核**；外部内核（Codex / ClaudeCode）保持"厂商自管"不变（`03-feature-changelog.md:2281,2709`）。
- 每一步都要有可观测事件，否则无法验证"压缩真的发生了"（这是仓库已有的原则，见 `docs/design/grokbot-overhaul/02-context-memory-gap.md:518`）。
- 不新增对 DSH 的运行时依赖；本文所有机制都在 SYNC-THINK 内部实现。

---

## 10. 待验证问题（阻塞"直接动手"的点）

1. **安装版 DSH 与快照是否同版本**：未确认（asar 版本号没读到）。已用 asar 实测值交叉验证了本文用到的每个常量，因此**不影响结论**，但若要以"本机运行行为"做对照实验，仍需恢复 shell。
2. **DSH 摘要提示词的完整文本**：asar 里能读到 checkpoint 前导、`<compacted-summary>` 标签和"遇到旧 checkpoint 要合并不照抄"的规则（§5.10），但系统提示词全文与 `compaction/summary-error` 的重试上界**没有**核到。移植前不必照抄。**原 `maxTokens` 冲突已解决（65536）**，见第 2 节。
3. **`selectRecentMessagesWithinBudget` 的确切语义**：定义不在已读范围内，只知道它被 `runtime.ts:26992` 以 `window×0.82` 调用。P0-6 要给它补可观测性，需要先读实现确认它是"按条数"还是"按 token"裁剪。
4. **SYNC-THINK 的 `compat` 约束**：`docs/engineering/cohesion-refactor-2026-09-19.md:587` 写有"epoch 复用/轮换与 prompt cache key 不变"，与 P0-1 直接相关，需先确认该约束的准确边界。
5. **contextWindow / 预留输出的可得性**：P0-2 需要"窗口 − 预留输出"这一中间量，需确认 runtime 侧 `context-snapshot` 是否已有可复用的分解。
6. **产品语义**：压缩的单一 checkpoint 与现有可见压缩消息（`03-feature-changelog.md:2704`）如何共存；以及"自动压缩是否应该从渲染端下沉到 Runtime"（P0-6 之后才有数据支撑这个决定）。
7. **两套 token 估算的统一口径**：`byteLength/4` 与 `String.length/4` 哪个是"真"？（§6.7 第 9 条）在补计量之前必须先定这一个。

---

## 11. 主要证据索引

**DSH（相对 `<DSH>`）**

- `docs/subsystems/compaction.md:5,11-23,25-38,40-103,105-133,143-284`
- `docs/subsystems/core.md:320-328,348`
- `docs/subsystems/session.md:181-183,210,259-294,348,666-668`
- `docs/subsystems/system-prompt.md:44`
- `docs/subsystems/llm-streaming.md:522,743`
- `docs/subsystems/token-meter.md:5-54`
- `docs/config-catalog.md:684-719,733-740,1684-1685,1832-1840`
- `docs/architecture.md:113`
- `docs/agent-lifecycle.md:83,85`
- `docs/capability-seams.md:591-596,638,656`
- `docs/deepseek-llm-api-wire-extensions.md:29,160`
- `.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md:11-24,26-30,32-36,38-42,54-62,64-70,72-90,92-109,111-134`
- `.agents/notes/implemented/feature/2026-09-02-in-history-system-prompt-replacement.md:36,38`（`startsSeries` 的三条判据）

**DSH 安装版 asar（`D:/tools/deepseek-harness/resources/app.asar`，用 `grep` 读取，行号为 asar 内行号）**

- `727526-727533`：compaction-basic 策略表（阈值公式、headroom、maxTokens 默认）
- `727573`：自动路径 + "区间从第一个非 `system/message` 节点开始"
- `727579`：摘要重放规则（node 0 + 被遮蔽区间 + 工具 + 尾部指令）
- `727627,727685,728216-728217`：checkpoint 前导、`<compacted-summary>`、旧 checkpoint 合并规则
- `728045-728046,728112-728113`：实现层的 headroom/maxTokens/压力预算
- `728385`：区间边界与工具配对注释
- `728592,728606-728607`：`SurfaceChangedError` 三处一致性复核
- `930649,949929`：`shadowedSeqs` 必须精确命名当前表面连续区间
- `1089430,1097037,1097502-1097579`：pi-ai 的 `cacheControlFormat` 语义、门控与自动探测
- `985577,1076768`：fork/子代理的逐字节前缀复用规则

**SYNC-THINK（相对仓库根）**

- `apps/runtime/src/context-message-history.ts:161-225`
- `apps/runtime/src/context-snapshot.ts:4,14-31,81-84,250-254`
- `apps/runtime/src/chat-tools.ts:2472-2490,2498-2529,2577-2584,2697-2737,2794-2854,2868-2890,2902-2952`
- `apps/runtime/src/runtime.ts:10688-11069,11091-11153,21775,26936-26996`
- `apps/runtime/src/demo-run.ts:764-770`
- `apps/runtime/src/orchestration/production-step-executor.ts:315-327,518-533,2379-2383`
- `apps/runtime/src/conversation-compact-boundary-cache.ts`（边界缓存与事件 rehydrate）
- `apps/desktop/src/renderer/shell/use-conversation-compaction.ts:209-218`
- `packages/storage/src/agent-context-store.ts:90-103`
- `packages/adapters/src/openai/prompt-cache.ts:1-44`、`openai/gateway-degrade.ts:17-34`
- `packages/adapters/src/anthropic/stream-messages.ts:184-203,319-341`
- `packages/adapters/src/gateway/openai-to-anthropic.ts:49-58`、`gateway/wire-types.ts:139-140`
- `packages/core/src/context-packet.ts:535-590`
- `packages/protocol/src/commands.ts:4243-4279`、`packages/protocol/src/conversation-context-status.ts:43-131`
- `packages/shared/src/types/kernel.ts:285-295`、`packages/shared/src/types/usage.ts:4`
- `docs/development/03-feature-changelog.md:2235,2281,2704,2709,3861,5727-5728,6289`
- `docs/engineering/cohesion-refactor-2026-09-19.md:587,1106-1113`
- `docs/specs/2026-07-27-newmax-conversation-context-performance-rearchitecture.md:273-296,317`

**本轮的分报告（更细的引用与逐条证据）**

- `.dsh-research/dsh-context-cache.md`：DSH 缓存机制逐条引用（含 13 项未知）
- `.dsh-research/dsh-compaction.md`：DSH 压缩机制 + 伪算法 + 21 项未知
- `.dsh-research/sync-think-current.md`：SYNC-THINK 现状 + 15 项缺口 + 18 个测试文件清单
- `.tmp-dsh-extract/REPORT.md`：asar 结构与 grep 配方、可手工执行的无依赖解包脚本
