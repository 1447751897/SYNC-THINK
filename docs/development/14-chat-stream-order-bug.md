# 聊天消息流排序 Bug：AI 思考卡错位到用户消息上方

## 现象与用户反馈

用户在发送一轮对话后，反馈了三个表面上各自独立、实则同源的视觉异常：

1. **任务弹框步骤与上方没对齐** —— 弹窗里的步骤序号与对话流视觉锚点错位，看起来"漂浮"在错误的位置。
2. **思考卡跑到用户消息上方** —— AI"深度思考"状态卡（reasoning/streaming 卡片）渲染到用户刚发送消息的气泡之上，而非之下。
3. **"正在思考与执行…/准备中/深度思考中…"卡片位置异常** —— 流式状态卡的插入位置时序性错乱，短暂出现在错误锚点。

三者同源：渲染层把**持久化历史消息**与**流式临时状态消息**当成两组独立数据源，靠"写死的 push 顺序"合并，而非用 `sequence` / 时间戳做全局稳定排序。任何一次时序竞态都会让临时卡片的视觉锚点脱离它本应依附的用户消息。

## 根因

`apps/desktop/src/renderer/shell/ChatView.tsx` 第 **1051–1060** 行的最终渲染 `useMemo` 把三组独立数据源按写死顺序拼接：

```ts
const messages = useMemo(() => {
  const base = [...loadedMessages];
  // A just-sent user bubble must precede the transient assistant turn. The
  // old order appended streamingMessage first, which made the thought panel
  // render above the user's prompt until the durable message caught up.
  base.push(...pendingUserMessages);
  if (streamingMessage) base.push(streamingMessage);
  base.push(...localErrors);
  return base;
}, [localErrors, loadedMessages, pendingUserMessages, streamingMessage]);
```

注释自己写明曾修过一次（"old order appended streamingMessage first"），但这次修复只是把 `streamingMessage` 的 push 顺序往后挪了一位，**没有引入全局 `sequence` 归并稳定排序**。于是只要 `pendingUserMessages` 与 `streamingMessage` 的到达/清理时序出现竞态，拼接结果就会偏离真实的对话顺序。

核心问题是：`loadedMessages`（持久化、有 `sequence`）、`pendingUserMessages`（乐观用户气泡、只有 `Date.now()` 时间戳、无 `sequence`）、`streamingMessage`（流式 AI 卡、只有 `runId` + `timestamp`、无 `sequence`）、`localErrors`（本地错误气泡）四个源各有各的排序键，合并时却只用了"装载顺序"而非"全局序"。持久化消息内部是按 `sequence` 正确排序的（见下文 653–657），但一旦跨源合并，这个稳定序就丢了。

## 复现条件

### 路径 1：复用既有 thread 的 run（"必然错位"）

最小复现：

1. 打开一个已存在、且上一次 run 的 `streamingMessage` 仍在内存中（例如刚发完一条还在流式响应、或一次未干净终止的 run 残留了 streaming 状态）的会话。
2. 在 `streamingMessage` 仍存在时，用户再次发送一条新消息 —— `setPendingUserMessages` 追加一条 `temp-${Date.now()}` 气泡（1380–1390）。
3. 进入 1051–1060 的合并：`base = [...loadedMessages]` 后 `push(...pendingUserMessages)` 再 `push(streamingMessage)`。
4. 但此时 `streamingMessage` 是"上一轮残留"的卡片（`runId` 对应旧 run），它的语义位置本应在**旧用户消息之后**，而 `pendingUserMessages` 是**新用户消息**。拼接顺序把新用户气泡塞到了旧 streaming 卡之前，视觉上表现为"思考卡跑到了刚发消息上方"。

判断：**必然错位**。只要"复用既有 thread 的 run"路径被触发，错位就一定发生。

### 路径 2：落盘空窗（"通常正常，瞬时错位"）

最小复现：

1. 用户发送一条新消息，`pendingUserMessages` 立即出现一条乐观气泡。
2. Runtime 落盘该用户消息后回到前端，触发 1029–1035 的 `useEffect`：用 `loadedMessages` 中已含的用户消息 id 去过滤掉 `pendingUserMessages` 里同 id 的乐观气泡。
3. 问题在于 1029–1035 的清理**只看 `loadedMessages` 是否含该用户消息**，不看 `streamingMessage` 是否仍在流式。于是存在一个空窗帧：`pendingUserMessages` 被清空、`streamingMessage` 仍在顶端、同帧 `messageWindow`（1066 起）只对 `loadedMessages`（即 `durableMessageIds`）做虚拟窗口切片，`streamingMessage` 另挂在末尾。
4. 在这个空窗帧里，滚动锚点落在 `loadedMessages` 末尾的旧消息上，而 `streamingMessage` 被独立 push 到最末，视觉上思考卡短暂出现在"它本应紧跟的那条用户消息"之上（因为那条用户消息刚从 `pendingUserMessages` 转正进 `loadedMessages`，但 `streamingMessage` 的相对锚点没被重排）。

判断：**通常正常，瞬时错位**。只在落盘与清理的那一帧出现，但足以让用户感知到"卡片跳一下"。

### 对比验证

- **必然正常**的场景：首次打开一个新会话、发第一条消息 —— 此时 `streamingMessage` 不复用旧 run，`pendingUserMessages` 与 `streamingMessage` 几乎同帧新增，push 顺序恰好匹配语义顺序。
- 用这两条路径做对照，开发可在 30 秒内确认修复是否生效：复用既有 thread 的 run 仍错位 ⇒ 未修干净；落盘空窗帧不再跳动 ⇒ 修干净。

## 关键代码证据

逐条 `file:line` + 一句话说明（行号以本次复核实际读到的为准）：

- **`apps/desktop/src/renderer/shell/ChatView.tsx:1051-1060`** —— 最终渲染 `messages` 的 `useMemo`，按 `loadedMessages → pendingUserMessages → streamingMessage → localErrors` 写死顺序 push 合并，未做全局 `sequence` 归并。
- **`apps/desktop/src/renderer/shell/ChatView.tsx:1053-1055`** —— 注释自述"old order appended streamingMessage first"，证明此前修过一次但只调整了 push 顺序，未引入全局排序。
- **`apps/desktop/src/renderer/shell/ChatView.tsx:1380-1390`** —— 发送时 `setPendingUserMessages` 追加乐观用户气泡，`tempId = \`temp-${Date.now()}\``，只有 `timestamp`、无 `sequence`。
- **`apps/desktop/src/renderer/shell/ChatView.tsx:897-919`** —— 流式 `setStreamingMessage`，构造 `id = \`streaming-${runId ?? maxSeenSequence}\``，只有 `runId` + `timestamp`、无 `sequence`。
- **`apps/desktop/src/renderer/shell/ChatView.tsx:650-662`** —— 持久化消息（`loadMessages` 游标分支）落盘后回填，按 `sequence` 升序排序后 setLoadedMessages。
- **`apps/desktop/src/renderer/shell/ChatView.tsx:653-657`** —— 持久化消息**内部**排序逻辑：`(left.sequence ?? MAX) - (right.sequence ?? MAX)`，证明持久化层已有稳定序，只是没被渲染层沿用。
- **`apps/desktop/src/renderer/shell/ChatView.tsx:1027-1035`** —— `pendingUserMessages` 落盘清理 `useEffect`：以 `loadedMessages` 中 user 消息 id 是否出现为唯一判据，不看 `streamingMessage` 是否仍在，导致落盘空窗过早清空。
- **`apps/desktop/src/renderer/shell/ChatView.tsx:943`** —— `pendingApprovals` 内 `eventHistory` 显式 `sort((a,b) => a.sequence - b.sequence)`，证明项目内部已有"按 sequence 排序临时事件"的范式，渲染层合并却没沿用。
- **`apps/desktop/src/renderer/shell/ChatView.tsx:714-751`** —— `projected.streaming` / `activeRunId` 投影：扫描 `eventHistory` 推算"是否有活跃 run"，但这个投影只用来驱动 `sending` 状态清零（1037–1049），并未参与 `messages` 合并的顺序决策。

## 漏网路径详解

### 路径 1 时序竞态：复用既有 thread 的 run

1. 会话已存在；上一轮 run 未干净结束或仍在流式 —— `streamingMessage` 状态非空（`runId = R1`）。
2. 用户发送新消息 → 1380–1390 追加 `pendingUserMessages` 一条 `temp-…` 气泡（对应**本次新**用户消息）。
3. 进入 1051–1060 合并：`loadedMessages`（旧）+ `pendingUserMessages`（新用户气泡）+ `streamingMessage`（**旧 run R1** 的卡片）。
4. 真实语义顺序应是：`loadedMessages`（旧）→ streaming(R1)（紧跟旧用户消息）→ new user bubble（新）。但 push 顺序产出的是 `loadedMessages → new user bubble → streaming(R1)`，把"新用户气泡"塞到了"旧 run 卡片"之前。
5. 用户看到的是：刚发的新消息气泡上方悬浮着一张思考卡 —— 这张卡其实是上一轮 run 的残留，被错位推到了新消息之上。

### 路径 2 时序竞态：落盘空窗

1. 用户发送新消息 → `pendingUserMessages` 出现 `temp-…` 气泡；随后 runtime 开始流式响应，`streamingMessage` 被置（897–919）。
2. Runtime 把用户消息落盘 → `loadMessages` 刷新 `loadedMessages`，该用户消息以 `sequence` 进入 `loadedMessages` 末尾。
3. 同一拍（或紧邻一拍）`useEffect` 1029–1035 触发：发现 `loadedMessages` 已含该用户消息 id → 把 `pendingUserMessages` 里同 id 的乐观气泡过滤掉。
4. 空窗帧状态：`pendingUserMessages = []`（被清空），`streamingMessage` 仍在，`loadedMessages` 末尾是刚转正的用户消息。
5. `messageWindow`（1066–1078）只基于 `durableMessageIds`（= `loadedMessages`）做虚拟窗口切片，`streamingMessage` 在 `messages` 中被 push 到末尾，但其相对锚点未被 `sequence` 重排 —— 滚动锚点仍停在 `loadedMessages` 末尾的旧位置，`streamingMessage` 被视觉性地"甩"到比它本应紧跟的用户消息更高的位置。
6. 下一帧当 `streamingMessage` 也被 `loadMessages` 的终态刷新覆盖（921–924 `run.completed` 后 `void loadMessages()`）时，位置自愈 —— 所以用户感知是"卡片跳了一下"。

## 影响面

下列交互会触发本 bug（按出现概率排序）：

- **复用既有 thread 的 run**：用户在上一轮 run 尚未完全终止时再次发送消息（连续提问、中途补问、补救式重发）—— 必然错位。
- **刚落盘瞬间**：用户消息被 runtime 持久化后的那一帧，乐观气泡被清空、streaming 卡仍在 —— 瞬时错位，肉眼可见"卡片跳一下"。
- **连续发送**：用户快速连发两条，第一条还在流式时第二条进入 `pendingUserMessages`，与残留 `streamingMessage` 的相对顺序由 push 决定而非 `sequence` 决定 —— 间歇错位。
- **本地错误回灌**：`localErrors` 在 `streamingMessage` 之后 push，若一次 run 既产生 streaming 又产生 local error，两者相对顺序同样不稳定。
- **虚拟窗口边缘**：当 `loadedMessages` 很长、`messageWindow` 只切出中部一段时，`streamingMessage` 被另挂末尾，可能完全脱离可见窗口，视觉上像"思考卡消失/错位"。

## 修复方向（不强制，仅供参考给开发）

- **全局 sequence 归并**：给流式临时消息也带 `sequence`（或单调时间戳作为 sequence 代理），渲染前对 `loadedMessages + pendingUserMessages + streamingMessage + localErrors` 做一次全局 `sequence` 归并稳定排序，而非依赖 push 顺序。
- **复用既有 thread 的 run 占位**：为"复用既有 thread 的 run"在渲染层补一个伪用户气泡占位，或让 `streamingMessage` 的 `sequence` 锚到本次 run 对应 user message 的 `sequence + ε` 之后，确保思考卡始终紧跟其触发消息。
- **修正过早清理**：`pendingUserMessages` 在其对应 `streamingMessage` 还在时不应被 1027–1035 的 `useEffect` 清空 —— 清理条件应额外要求"该 user message 之后的 assistant 流式也已终止"，否则保留乐观气泡直到 streaming 结束。
- **复用 943 的范式**：`pendingApprovals` 已经用 `[...eventHistory].sort((a,b) => a.sequence - b.sequence)` 做了稳定排序，渲染层 `messages` 合并可复用同一范式，统一临时事件的排序策略。
- **增加单元测试**：覆盖三种顺序竞态（复用既有 thread、落盘空窗、连续发送），参考 `apps/desktop/src/renderer/shell/chat-message.test.ts` 的风格，对合并后的 `messages` 数组做顺序断言。

## 验证清单

人工操作可验证的通过标准：

1. **复用既有 thread**：在一条仍在流式响应的会话里立即发送第二条消息，第二条用户气泡应稳定出现在 AI 思考卡之上，思考卡不再悬浮到新消息上方。
2. **落盘空窗**：发送一条消息后盯住落盘那一帧（用户气泡从乐观灰转正），思考卡不应有"向上跳一下"的视觉位移，应始终紧贴用户气泡之下。
3. **连续发送**：快速连发两条消息，两条用户气泡应按发送顺序自上而下排列，思考卡/回复卡按各自 run 顺序穿插其间，无交错。
4. **滚动锚点**：在长历史中滚到中部发送消息，思考卡应出现在可见区域用户气泡之下，而非脱离窗口或跳到顶部。
5. **本地错误穿插**：触发一次会同时产生 streaming 与 local error 的失败 run，错误气泡与思考卡的相对顺序应与其 `sequence` / 时间戳一致，不随帧抖动。
6. **空会话首条**：新建空会话发第一条消息，行为与修复前一致（不应回归），确认修复未破坏原本正常的路径。
