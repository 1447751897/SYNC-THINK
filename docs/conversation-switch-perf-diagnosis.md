# 对话切换卡顿诊断报告

**日期**：2026-09-16
**问题**：SYNC-THINK 切换对话时消息列表显示明显偏慢；同机 NewMax 切换几乎无感。
**方法**：直读 SQLite 实测耗时 + 渲染层源码审查 + NewMax 渲染 bundle 逆向对照（只读，未改动任何安装文件）。

---

## 一、结论先行

**不是数据库的问题，是渲染的问题。**

消息页的 SQL 查询实测 **0.3–0.7 ms**，50 条消息的 JSON 解析 **0.25–0.9 ms**。数据库里真正的大头（`event.payload_json` 209 MB、`checkpoint.state_json` 223 MB）**都不在对话读取路径上**。

慢在两处，都在渲染/进程边界：

| 排名 | 瓶颈 | 实测量级 | 每次切换都发生？ |
|---|---|---|---|
| **1** | 消息列表全量挂载 50 个 MessageBubble + markdown 子树（已有虚拟化代码但不能直接用） | 未直接测（见 §六 A/B） | ✅ 是 |
| **2** | `getRunProcess` 对大 run 全量读事件且被缓存策略拒绝 | **47–248 ms** | 局部（1 个对话 168 MB） |
| **3** | 切换发起 ~10 个 RPC，经 6 跳链路往返 | 延迟叠加 | ✅ 是 |

---

## 二、数据库实测：自证清白

DB 文件 555.7 MiB（142,252 页），WAL 模式，freelist = 0（无碎片）。

| 表 | 行数 | 含 JSON 列 | 总字节 |
|---|---|---|---|
| `event` | 128,321 | payload_json | 209.4 MB |
| `checkpoint` | 11,091 | state_json | 223.5 MB（**不在读取路径**） |
| `message` | 1,121 | blocks_json | 7.7 MB |
| `conversation` | 28 | — | — |

`message` 表只有 1,121 行 / 7.7 MB。最大单页（50 条）= 0.31 MB。

| 操作 | 耗时 |
|---|---|
| `listMessages` 查询（LIMIT 50） | 0.32–0.68 ms |
| 50 条 blocks_json 解析 | 0.25–0.88 ms |
| `listNavigation`（LIMIT 200，含 json_each） | 8.6–11.6 ms |
| DB 冷打开（readonly） | 7.5 ms 冷 / 0.3 ms 热 |

**结论**：数据层有分页（`DEFAULT_MESSAGE_PAGE_LIMIT = 50`）、有 worker_thread 隔离、有 readonly 连接，该做的都做了。查询时间只占感知延迟的极小比例。

### 一个异常对话

`conv-RAPMD6YB…`「能发消息吗」：125 条消息，但单线程 **9,016 个事件 / 168.5 MB payload**，可见页 50 条覆盖 24 个 run / 22.14 MB / 2,077 条 `message.delta`。这是唯一触发瓶颈 2 的对话；其余 26 个对话事件量 < 2.5 MB，影响甚微。

---

## 三、瓶颈 1：消息列表全量挂载，虚拟化代码虽有但不能直接用（最重要）

**这是本次诊断最有价值的发现。**

`message-window.ts:146-221` 已经实现了完整的消息窗口计算：`calculateMessageWindow` + `buildMessageOffsets`（二分查找 + spacer 占位虚拟化）。

**但它只被测试引用**（`message-window.test.ts`、`long-thread-performance.test.ts`），且**不能直接接到生产渲染**——缺逐条测量高度来源、会破坏 4 套滚动恢复机制、220px 估算对异构消息偏差大（详见 §五 P0 的方案修正）。最终改用 NewMax 机制 ② 的**尾部窗口**达到同等效果。

生产渲染路径 `ChatView.tsx:6930` 是：

```tsx
{visibleDurableMessages.map((msg) => (
  <MessageBubble ... key={msg.id} />
))}
```

`visibleDurableMessages`（3871-3911）返回**完整** `loadedMessages`（最多 50 条 + 恢复的暂停终态）。**没有任何窗口裁剪**，切换时 50 个 MessageBubble 及其 markdown / 代码块 / mermaid 子树被一次性挂载。

现有缓解：CSS `content-visibility: auto` + `contain-intrinsic-size: auto 220px`（`shell.css:17836-17838`）跳过离屏元素的 layout/paint。**但 React 仍要挂载并渲染全部 50 个组件的 JS 子树**——这笔成本落在切换的关键路径上，CSS 优化管不到。

> 对比：NewMax 渲染层**没有用任何虚拟化库**（全库 grep 无 react-window / react-virtual / @tanstack/react-virtual），但它用一个 12 行的尾部窗口达到了同样效果（见 §四机制 3）。

### 其余渲染实践：良好，非问题

- key 稳定（`key={msg.id}`），未用数组 index ✅
- 重型组件已 memo：`MessageBubble`、`MarkdownRenderer`、`ReasoningContent`、`CollapsibleUserText`、`DelegatedAgentToolList` ✅
- `eventHistory` 封顶 5000，12+ 个 useMemo 遍历它，实测合计 **~5–8 ms/渲染** → 非瓶颈（但见 §五风险 2）
- 切换时 `readRecentConversationPage` 缓存命中可跳过加载 ✅（冷路径才调 `loadMessages`）

---

## 四、NewMax 流畅的机制对照（逆向自渲染 bundle）

NewMax 的流畅**不来自虚拟化或预取**（两者都没用），而是一套"保守渲染 + 感知操纵"组合。按可借鉴性排序：

| 机制 | 关键数字 | 解决什么 |
|---|---|---|
| **① 切换只走内存缓存** | `useChatStore.conversations` 对象 map，`setActiveConversation` **零 IPC**，`cachedReady` 首帧渲染 | **根本机制**：已访问对话常驻内存，切换 = 一次 setState |
| **② 消息尾部渲染窗口** | `INITIAL_RENDER_LIMIT = 12`，超 12 条只渲染最后 12 条；"加载更早"批量 40；窗口位置按缓存键恢复 | 长对话切换的渲染卡顿 |
| **③ 重量级判定 + nextPaint** | `getMeta` 只取计数；≥12 条 **或** >24000 字判为重型，重型时 `await nextPaint()` 让骨架先画 | 缓存未命中时的盲等、大列表阻塞首帧 |
| **④ 120ms 骨架延迟** | 快路径（缓存命中/小列表）< 120ms 则骨架**完全不显示** | 骨架闪烁的视觉噪音 |
| **⑤ "+1" 探针免 count** | pageSize=5 实际取 6，用第 6 条判断 hasMore | 省掉一次 count 往返 |
| **⑥ 串行化磁盘读队列** | `createSerializedTaskQueue` + `yieldToEventLoop` | 多标签并发加载的主线程抖动 |
| **⑦ 快照分层持久化** | 布局/活跃会话立即从 localStorage 恢复，列表数据异步补 | 冷启动体感 |
| **⑧ 切换动画掩盖** | opacity/translateY spring + 30/80/120ms 三次 snap 滚动 | 揭示瞬间的跳动与"砸入"感 |
| **⑨ 浅等判停** | `conversationListsShallowEqual`，相等就不 setState；seq 序列号防竞态 | 重复渲染、旧异步覆盖新状态造成的二次闪烁 |
| ⑩ 预取 | **明确未做**（`prefetch` 仅出现在 HTML rel 枚举值中） | — |

**最反直觉的一点**：NewMax 切换快的核心是**机制 ①**——消息缓存在 store 里是对象 map，切换时**不清空、不 IPC**，`cachedReady` 判断有缓存就直接首帧渲染。SYNC-THINK 已有等价的 `readRecentConversationPage` 缓存（ChatView.tsx:2631），但**机制 ② 的尾部窗口缺失**，导致即使缓存命中，仍要一次性渲染全部 50 条。

---

## 五、优化方案（按性价比排序）

### P0 —— 尾部渲染窗口（✅ 已实施）

> **方案修正（重要）**：初版报告把这一项描述为"零新代码、纯粹接线"，深入后证明**是错的**，已改用 NewMax 机制 ② 的尾部窗口方案。

**为什么不能直接接 `calculateMessageWindow`**（三个实测发现的阻塞点）：

1. `buildMessageOffsets` 需要逐条**已测量高度**的 `measuredHeights` Map，而生产中该 Map **没有任何来源**——ChatView 全文件无 ResizeObserver，高度采集机制必须新建。
2. **4 套现有滚动恢复机制依赖消息是真实 DOM 节点**：`capturePrependAnchor` / `restorePrependAnchor`（ChatView.tsx:3919-3958）遍历 `[data-message-id]` 取锚点，`conversationScrollPositions`（455-574）按 scrollTop + anchorOffset 恢复。任意位置虚拟化裁掉视口外节点后，这些恢复会失效。
3. `MESSAGE_WINDOW_ESTIMATED_HEIGHT = 220` 对异构消息（纯文本 vs mermaid / 代码块 / 图片墙）偏差极大，任意位置窗口会造成明显滚动条跳动。

**最终方案：尾部窗口（与 NewMax 机制 ② 完全一致）**——只裁剪头部、尾部连续渲染，天然规避上述三点：

| 改动 | 位置 | 作用 |
|---|---|---|
| `renderLimit` state（初始 12 = NewMax `INITIAL_RENDER_LIMIT`） | ChatView state 区 | 切换时只挂载尾部 12 条，砍掉 76% 首屏挂载量 |
| `renderedDurableMessages` = 尾部 slice | 渲染前派生 | 数据层 `visibleDurableMessages` 保持不变，只裁渲染 |
| 顶部 spacer（裁掉条数 × 220px） | 渲染路径 | 撑起被裁头部，滚动条总量不塌陷 |
| 滚到顶 `scrollTop<50` 优先扩大窗口（+40 = NewMax 批量） | onScroll | 已加载未渲染的消息先入场，全部入场后才走原 DB 分页 |
| 增长补偿（`preservePrependScrollTop` 语义） | useLayoutEffect | 窗口扩大时 `scrollTop += Δheight`，视口保持不动 |
| 切换时按历史阅读位置定窗口 | 切换重置 effect | saved scrollTop 大时自动扩大到覆盖，避免恢复到 spacer 空白区 |

**为什么风险低（与现有基础设施三重吻合）**：数据页 50 条 + cursor 翻页 + `historyRanges` 区间合并已有；滚到顶自动加载更早 + prepend 锚点恢复已有（原 6858）；只缺"初始只渲染尾部 N 条"这一步。锚点恢复安全——窗口只向头部扩展，原锚点始终留在窗口内；gap 按钮在数据层计算，被裁到头部时滚到顶扩大窗口后自然重现。

**收益量化（真实 DB 统计，非耗时测量）**：

| 指标 | 数值 |
|---|---|
| 有消息的对话 | 47 个 / 1121 条消息 |
| 消息 > 12 条（受益） | 19 个（40%）；其余 ≤12 条无变化 |
| **全库首屏挂载总量** | **765 → 355 条，降幅 54%** |
| 受益对话平均挂载 | 33.6 → 12.0 条 |
| 每对话消息数 | min 1 / median 9 / **max 195** |

> 中位数 9 说明多数对话本就短小、不受影响；卡顿体感集中在 19 个长对话（最长 195 条，改动后 50 → 12 条，是收益最大的场景）。这是**挂载工作量**层面的降幅；切换的**绝对耗时** A/B 见 §六。

### P1 —— `getRunProcess` 分页 + 缓存放宽（解决唯一的 248 ms 级瓶颈）

`conversation-history-worker.ts:154` 的 `captureRunProcessSnapshot` 读取该 run 的**全部**事件并逐条 JSON.parse；而 `ConversationHistoryReadService.cache()`（253-268）以 `maxCacheBytes = 16 MB` 拒绝超大 run → **每次切回 conv-RAPMD6YB 都重读 64.9 MB**。

两步：
1. 对 run 事件做分页/按需读取（只取渲染当前可见消息所需的部分）
2. 放宽缓存上限或改用"首屏摘要 + 懒加载明细"，避免 16 MB 硬拒绝导致零缓存

### P2 —— 切换时的 RPC 合并与骨架策略

切换并发起 ~10 个 RPC（listMessages、listNavigation、contextStatus、subscribeTransient、usage、plan、getRunProcess×N），经 renderer → preload IPC → 主进程 → 命名管道 → runtime → worker_thread → SQLite 六跳。管道复用不串行，但每跳的 JSON 编解码 + structured clone 对每个响应都要付一次成本。

- `listNavigation` 的 8.6–11.6 ms（含 json_each 子查询）值得单列优化或延迟到首屏后
- 引入 NewMax 机制 ③④：先用廉价的 count/meta 探针决定要不要显示骨架，骨架 120ms 延迟显示——快路径用户完全看不到骨架

### P3 —— 感知层打磨（低成本、体感收益大）

- **切换动画掩盖**（NewMax 机制 ⑧）：opacity 0→1 + translateY(6px)→0 的 spring，在 rAF 里先滚到底再 reveal
- **浅等判停**（机制 ⑨）：刷新结果与当前列表浅相等就不 setState，消除二次闪烁

### 潜在风险（当前未触发，需留意）

1. **1 MiB 帧上限重试循环**（`runtime.ts:9653`）：消息变大时触发整页重读。当前最大页 0.31 MB 未触发。
2. **`eventHistory` 软上限**：5000 上限对非 delta 锚点事件是软上限（DB 中有 97,681 条非 delta 事件），超长会话后 12 个 memo 可能逐步变慢。

---

## 六、验证记录与待补项

**已完成**：

1. **typecheck**：`apps/desktop` 的 `tsc -p tsconfig.json --noEmit` 通过（exit 0）。
2. **全量测试**：`vitest run --no-file-parallelism`（本机 Tinypool 线程池冲突，必须加此标志，否则 `minThreads/maxThreads must not conflict` 一个用例都跑不了）。
3. **挂载量降幅**：见 §五 P0 收益量化表——真实 DB 统计，全库首屏挂载量 -54%。

**待补（本环境无 GUI / 无 playwright，无法自动化执行）**：

1. **切换绝对耗时 A/B**：在 `renderedDurableMessages.map` 前后加 `performance.mark('msg-mount-start' / 'msg-mount-end')`，切换对话时读 `performance.measure` 差值，对比改动前后。这是把「-54% 挂载量」换算成「省了多少 ms」的唯一方法。
2. **确认缓存拒绝率**：在 `conversation-history-read-service.ts:257` 的 `Buffer.byteLength(JSON.stringify(...))` 处加日志，看大 run 的实际序列化字节数与缓存命中率（对应 P1）。
3. **区分 JS / layout / paint 占比**：用 DevTools Performance 抓一次切换的 flame chart，验证 `content-visibility` 的实际省略效果——若 layout/paint 本就很小，说明 CSS 缓解已足够、瓶颈纯在 JS 挂载，尾部窗口的收益更确定。

---

## 附：IPC 通道清单（主进程均为薄异步代理）

真实读取在 runtime 的 worker_thread 上，主进程不做 DB 读取或 JSON 解析：

`runtime:conversation-list`(2663) / `-list-messages`(2668) / `-list-navigation`(2676) / `-get-context-status`(2684) / `-get-run-process`(2692) / `-task-plan-history`(2698) / `-list-file-changes`(2705) / `-read-content`(2712) / `-read-file-diff`(2719) / `-list-run-timeline`(2726) / `-subscribe-transient`(2734) / `-unsubscribe-transient`(2764)。

传输层：单一命名管道，`pendingRequests` Map 复用（不串行），默认超时 5,000 ms，帧上限 1 MiB（`packages/protocol/src/framing.ts:7`）。
