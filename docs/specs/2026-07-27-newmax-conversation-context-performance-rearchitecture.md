# Sync-Think：NewMax 式会话、上下文与性能重构方案

> 日期：2026-07-27
> 状态：Locked（作为后续开发实施基线）
> 目标：不是只复刻 NewMax 外观，而是让会话加载、流式输出、上下文管理、工具过程和长期运行性能达到同类产品体验。

> S1 状态（2026-07-27）：✅ Durable Message Store、`conversation.listMessages` 分页查询、用户/助手 final message 写入、旧事件幂等回填、ChatView 最近 50 条分页与终态自动刷新均已完成；全仓 typecheck/test/build 通过。
>
> S2 状态（2026-07-27）：✅ Transient Streaming 已完成：thread-scoped subscribe/unsubscribe、独立 `streamSequence`、有界 replay、`resetRequired`、active-run snapshot、Desktop/Main/Preload/ChatView 全链路与 durable terminal 收敛均已接通；`message.delta` / `message.reasoning_delta` 不再写入 durable event store。1000 个 output chunk 验证为 0 条 durable delta，并只保留单条 `run.completed`/final assistant 边界。

## 1. 目标体验

### 1.1 启动与打开会话

- 应用窗口出现后，最近对话列表应立即可操作，不等待全库事件回放。
- 打开会话只加载最近一页消息，目标首屏 50 条。
- 向上滚动时分页加载更早消息，并保持原滚动位置。
- 无论数据库包含 1 万还是 100 万条历史事件，打开当前会话不应扫描全库。
- 切换会话时不重建其他会话的消息、工具过程、Markdown 和代码高亮。

### 1.2 流式回答

- 流式 delta 只更新当前助手草稿，不触发全历史排序和投影。
- 正文和深度思考使用两个独立 transient stream。
- 每轮完成后只保存一条最终助手消息，不按 token chunk 保存成百上千条 durable message 事件。
- 工具调用过程仍实时可见，但 UI 按当前 run 增量更新。
- Runtime 或 Desktop 重连后，可恢复当前 run 的有限快照，不重复显示或丢失最终消息。

### 1.3 上下文

模型实际收到的上下文应由明确的 `ContextSnapshot` 构造，而不是临时扫描全库事件：

```text
System instructions
Agent / Team instructions
Project context（路径、目标、约束、memory）
Compact summary（若存在）
Recent conversation messages
Current user message + images
Available tools / skills
```

上下文圆环反映“下一次请求预计会送给模型的 token”，而不是 Renderer 当前持有的事件数量。

### 1.4 深度思考、执行过程和文件变更

每轮助手回复只有一个高层过程入口：

```text
思考与执行过程
├─ 深度思考
├─ 工具调用
└─ 文件变更
```

- 默认折叠，运行中自动展开，完成后收起。
- 工具行直接显示 `读取文件 · src/a.ts`、`写入文件 · docs/x.md`、`执行命令 · pnpm test`。
- 详细结果按 run 查询或使用已缓存的过程投影，不由每个消息气泡重复扫描全局事件。
- 文件变更继续进入消息内摘要和右侧 Changes，不保留重复的右侧“过程”页。

## 2. 当前根因

当前聊天 UI 以全局事件日志作为直接数据源：

```text
SQLite 全库 event
→ Runtime 启动全量读取
→ Desktop 从 cursor=0 全量 replay
→ Main eventHistory
→ Renderer eventHistory
→ 每个 delta 全量 merge + sort
→ ChatView 多处全量扫描
→ 每个助手气泡重复投影执行过程
→ messages.map 全量 DOM 渲染
```

主要问题：

1. Runtime 冷启动读取整个 `event` 表。
2. Desktop 每次启动从 sequence 0 回放所有事件。
3. `RuntimeSession.recordEvent()` 每次复制整个数组，完整 replay 接近 O(N²)。
4. Shell 每个事件重新 Map、排序全局历史。
5. ChatView 对模型、用量、审批、浏览器、过程等分别扫描和排序全局历史。
6. 每个助手气泡多次调用 `projectExecutionProcess()`。
7. 消息列表无分页、无虚拟化。
8. 每个 provider delta 被持久化，并携带不断增长的完整 run 快照，事件体积接近 O(D²)。
9. 几乎每个 delta 都生成 append-only checkpoint。
10. Compact 只减少模型 prompt，不减少 UI 扫描、数据库和回放成本。

## 3. 目标架构

将聊天数据拆成四层：

```text
A. Conversation Summary
   最近对话、标题、置顶、未读、当前运行状态

B. Durable Message Store
   最终用户/助手/系统消息、图片 blocks、compact marker
   按 thread 分页读取

C. Transient Run Stream
   text delta、reasoning delta、工具实时状态
   只发给已打开该 thread 的窗口，不逐 token 持久化

D. Context Snapshot
   本轮真正送模的系统指令、summary、最近消息、图片、tools
   按 thread 构造并记录 token 使用
```

事件日志继续承担审计和执行状态，但不再作为聊天页面的查询数据库。

## 4. 数据模型

### 4.1 启用现有 `message` 表

现有 `thread/message` schema 和 FTS 基础设施继续使用，补齐实际 Store。

建议字段语义：

```text
message
- id                 text PK
- thread_id          text not null
- sequence           integer not null（thread 内单调递增）
- role               user | assistant | system
- blocks_json        text not null
- run_id             text nullable
- status             final | error | cancelled
- model_id           text nullable
- tokens_in          integer nullable
- tokens_out         integer nullable
- reasoning_tokens   integer nullable
- created_at          ISO timestamp
- updated_at          ISO timestamp
```

索引：

```text
UNIQUE(thread_id, sequence)
INDEX(thread_id, sequence DESC)
INDEX(run_id)
```

`blocks_json`：

```json
[
  { "type": "text", "text": "正文" },
  {
    "type": "image",
    "payload": {
      "id": "img_xxx",
      "name": "screen.png",
      "mimeType": "image/png",
      "storageRef": "conversation-images/..."
    }
  }
]
```

严禁把 Base64 放入 message、event 或 checkpoint。

### 4.2 Run 过程读模型

为避免每个气泡扫描全局 event，新增按 run 聚合的数据访问方式。第一阶段可继续从必要工具事件生成，但必须在 Runtime/Store 层按 `run_id` 查询并投影一次。

建议后续表：

```text
run_process
- run_id             text PK
- thread_id          text
- reasoning_text     text nullable
- steps_json         text not null
- changes_json       text not null
- status             running | completed | failed | cancelled
- started_at
- completed_at
```

若暂不建表，至少提供 `conversation.getRunProcess(runId)`，由 Runtime 查询 `run_id` 索引后返回已聚合结构。

### 4.3 Compact 状态

```text
conversation_context
- thread_id          text PK
- summary            text
- boundary_sequence  integer
- kept_recent_count  integer
- estimated_tokens   integer
- updated_at
```

旧的 `context.compacted` 事件可保留审计，但模型构造与 UI 读取以该读模型为准。

## 5. 协议与 API

### 5.1 消息分页

```ts
conversation.listMessages({
  conversationId: string,
  beforeSequence?: number,
  limit?: number // default 50, max 100
})

// response
{
  messages: MessageSummary[]; // ascending for rendering
  nextCursor?: number;
  hasMore: boolean;
  activeRun?: ActiveRunSnapshot;
}
```

Runtime 内部解析 conversation → task → thread，Renderer 不再额外 `task.open` 来找 threadId。

### 5.2 当前会话实时流

```ts
conversation.subscribeStream({
  conversationId,
  afterStreamSequence?
})
```

Transient frame：

```ts
{
  conversationId,
  threadId,
  runId,
  streamSequence,
  type:
    | 'text.delta'
    | 'reasoning.delta'
    | 'tool.requested'
    | 'tool.completed'
    | 'tool.failed'
    | 'run.completed'
    | 'run.failed'
    | 'run.cancelled',
  payload
}
```

要求：

- transient delta 不写入 durable `event` 表；
- `streamSequence` 用于去重和重连；
- 查询消息页与订阅流之间使用 watermark，避免竞态丢消息；
- 分屏时最多订阅两个打开的 conversation；
- 未打开会话只接收轻量 activity 更新，不接收正文 delta。

### 5.3 上下文预览

```ts
conversation.getContextStatus({ conversationId });
```

返回：

```ts
{
  modelId,
  contextWindow,
  estimatedUsedTokens,
  usageRatio,
  compactThreshold: 0.7,
  compactedAt?,
  sections: [
    { type: 'system', tokens },
    { type: 'agent', tokens },
    { type: 'project', tokens },
    { type: 'summary', tokens },
    { type: 'messages', tokens },
    { type: 'tools', tokens }
  ]
}
```

圆环直接使用该接口，不再从 Renderer 全局事件中猜测。

## 6. 上下文规则

### 6.1 默认策略

- 最近消息不再固定“最多 40 条”作为唯一规则，而是按 token budget 选择。
- 预留模型窗口：
  - 10% 给 system/tools；
  - 20% 给本轮输出；
  - 70% 为自动 compact 阈值。
- Compact 后：summary + 最近 8 轮原文作为默认基线，可按 token budget 调整。
- token 优先使用 provider usage/tokenizer；无 tokenizer 才回退字符估算。

### 6.2 必须真正送模的内容

当前 `Context Packet` 里声明纳入、但未实际进入 provider prompt 的内容必须闭环：

- task goal/status；
- acceptance criteria；
- project memory；
- parent/cross-task refs；
- Agent/Team instructions；
- Skill 内容；
- tools schema。

原则：UI/审计中标记为 `included` 的内容必须进入实际 provider request；否则标记为 `audit-only`。

### 6.3 图片历史

- 当前轮图片必须进入多模态请求。
- 最近未 compact 的图片消息可通过 `storageRef` 按需重新送模。
- Compact 边界之前的图片默认只进入 summary 描述，不重复传原始图片，避免 token/带宽膨胀。
- 重新生成必须携带原用户消息的 image blocks。

### 6.4 工具历史

- 同一 run 的工具调用与结果保持在 provider live loop。
- 跨轮不默认重放完整工具输出。
- 下一轮需要的关键结果进入 compact summary、project memory 或 artifact reference。
- 长工具输出 durable 层保存摘要 + artifactRef，禁止无界全文进入 event。

## 7. 分片实施顺序

每一片单独构建、测试、重启和验收，不一次改完。

### S0：性能基线与保护测试（已完成，2026-07-27）

目标：先量化，再改架构。

- [x] 增加可重复的长流 fixture：1000 个 text/reasoning delta，以结构和序列化字节上界断言替代易抖动的墙钟阈值。
- [x] durable delta payload 禁止携带完整 `run` 快照，1000 delta payload 总量保持线性且小于 250 KB。
- [x] durable delta payload 不得含 `data:image/`；图片数据仅保留在本轮内存态/provider 边界，不随事件重复。
- [x] RuntimeSession 的大量顺序事件原地追加，避免每条事件复制完整历史数组造成 O(N²)。
- [x] 现有 Runtime pipe、SQLite durable store、Desktop session 测试继续覆盖启动/replay、DB 行数/checkpoint 与重连行为。

验收：已建立可重复的 S0 保护基线，未实施 S1 message store 重构。机器相关的首屏/切换毫秒预算保留为后续专用 benchmark 记录项，不作为普通 CI 的紧墙钟门槛。

### S1：Durable Message Store + 分页读取 ✅ 完成 2026-07-27

目标：ChatView 首屏不再依赖全库 eventHistory。

- [x] 新增 `0028_message_pagination` migration 和 `SqliteMessageStore`：稳定 ID/sequence 写入、幂等冲突检测、thread 校验、按 thread exclusive cursor 分页。
- [x] `message` 增加 `(thread_id, sequence)` 唯一索引和 `run_id` 索引；分页默认 50/max 100，SQL 倒序取最新后升序返回。
- [x] 图片 `storageRef` blocks 可往返，持久化 blocks 受数量/UTF-8 字节/JSON 深度约束并拒绝 `data:image/`。
- [x] 新增 `conversation.listMessages` 协议、Runtime 持久库查询、Desktop IPC/preload/renderer bridge。
- [x] 用户消息 append 与助手 `run.completed` final message 接入 Runtime；`message.attachImages` 可更新 image blocks。
- [x] 对旧事件做幂等 backfill，记录 migration progress，失败可重跑（`message-store-backfill.ts`，Runtime 恢复时自动执行）。
- [x] ChatView 初始加载最近 50 条，向上滚动加载更早消息；流式通过局部 `streamingMessage` 状态更新，不触发全历史重算。

验收：

- 旧对话文字与图片可恢复（backfill 从 `message.appended` / `run.completed` / `message.images-attached` 重建）；
- 首屏只加载 50 条（`listConversationMessages` 分页）；
- 向上加载不跳动、不重复（exclusive cursor + scroll position preserve）；
- 不再用全局 events 生成消息正文（`projectConversation` 已移除）；
- Desktop 全量测试 534/534 通过。

### S2：Transient Streaming ✅ 完成 2026-07-27

目标：流式不再写成百上千条 durable delta。

- [x] 新增 thread-scoped shadow stream；订阅命令为 `conversation.subscribeTransientStream` / `conversation.unsubscribeTransientStream`。
- [x] 使用不占用 durable event sequence 的 thread-local `streamSequence`，支持 text/reasoning/terminal frame。
- [x] Runtime 提供全局 256 帧、单次 replay 512 KiB 的双重内存上限；过旧/超前 cursor 返回 `resetRequired`。
- [x] 多 thread 订阅隔离，socket 断开自动清理；unsubscribe 校验 stream 所属 socket。
- [x] 集成测试验证 live delivery、cursor replay、unsubscribe、淘汰 reset、thread 隔离及 non-durable delta。
- [x] Desktop RuntimeClient/Session、Main/Preload IPC 已接入 transient frame；ChatView 按当前 thread/run 局部维护草稿。
- [x] 关闭 `message.delta` / `message.reasoning_delta` durable 写入；终态前先写 final assistant message，再发布 durable terminal。
- [x] 失败、取消、断线和重连按 `streamSequence` 去重；replay 不完整时使用 active-run snapshot 恢复草稿，并以 durable final 收敛。
- [x] delta 只更新 Runtime 内存 active run；下一条 durable 边界原子提交 checkpoint，不做逐 chunk checkpoint 写入。

当前验收：Protocol 4 文件/18 项、Runtime 44 文件/306 项、Desktop 73 文件/543 项测试全部通过；全仓 build 11/11 通过。1000 个 text/reasoning chunk 产生 0 条 durable delta，durable 事件总量不随 chunk 数增长。

验收：

- 1000 delta 最终只写一条助手消息；
- UI 流式平滑；
- 停止、失败、重连正确；
- DB 不随 chunk 数二次增长。

### S3：停止全库 Replay 与 Runtime 全表恢复 ✅ 完成 2026-07-27

目标：冷启动成本与历史总量解耦。

- [x] Shell 只订阅轻量 conversation activity。
- [x] 当前打开会话才订阅 stream。
- [x] Desktop 持久化轻量 activity cursor，不再每次从 0 replay。
- [x] Runtime 从最新 checkpoint + checkpoint 后事件恢复，不把全库 events 常驻内存。
- [x] replay 查询直接走 SQLite cursor page。
- [x] event 增加全局 sequence 索引；旧重复 sequence 用 `(sequence, rowid/id)` 稳定兼容。

当前实现：Desktop/Runtime 各自保留 2048 条 recent event 窗口；SQLite replay 使用严格有界的 `(sequence, id)` 复合 cursor，遗留重复 sequence 可安全跨页，单页严格不超过 limit，且无遗漏、无重复；activity cursor 跨进程重启持久化。

当前验收：全仓 test 20/20 tasks（Desktop 74 文件/549 项、Runtime 45 文件/310 项、Storage 22 文件/245 项）、typecheck 20/20 tasks、build 11/11 tasks 全部通过。

验收：

- 10 万/100 万事件下启动时间不再线性增长；
- Main/Renderer 内存不与全库事件量同比增长；
- 对话列表立即可用。

### S4：执行过程按 Run 聚合 ✅ 完成 2026-07-27

目标：保留 NewMax 式过程展示，移除重复全局投影。

- [x] Storage 提供 `listEventsByRun(runId)`，Runtime 统一投影 `RunProcessView`，并通过 `conversation.getRunProcess` 按 runId 查询历史过程。
- [x] Desktop Main/Preload/Renderer bridge 严格校验仅含非空、最长 128 字符的 `runId`；ChatView 用 `Map<runId, RunProcessView>` 隔离缓存与 in-flight 查询。
- [x] 历史过程查询瞬时失败时从 500ms 开始指数退避、最大 8 秒自动重试；成功、切换对话或组件卸载时清理 timer/attempt，旧请求继续受 conversation generation 隔离。
- [x] transient stream 增加 `process` frame/snapshot；工具事件局部更新当前 run，终态携带最终过程，重连后的文本/reasoning snapshot 保留已有 process。
- [x] 一个助手气泡只接收一个已经投影好的过程对象；`MessageBubble` 使用 `memo()` 和稳定 callback，历史气泡不随当前 run 更新重复渲染。
- [x] `ChatView`、`MessageBubble`、`ExecutionProcessBlock`、`FileChangesCard`、`RightRail` 生产链路不再调用 `projectExecutionProcess()` 或扫描原始事件。
- [x] 读/写文件路径在步骤标题直接显示；command、generic 与 list_files 的单行长输出也同时受行数和字符数上限约束，避免大文本进入 Renderer。
- [x] MCP `tool_requested` / `tool_called` / `tool_refused` 在生产事件缺少 toolCallId 时按共同 `actionDigest` 聚合，called/refused 分别收敛为 done/error。
- [x] `run.completed` / `run.failed` / `run.cancelled` 会收敛未完成工具步骤，不在 terminal 后遗留 running。

当前验收：30 步投影与 run Map 隔离测试确认只替换目标 run，历史 run 对象引用保持稳定；Protocol 5 文件/20 项、Storage 22 文件/246 项、Runtime 48 文件/319 项、Desktop 77 文件/567 项测试通过。全仓 test/typecheck 20/20 tasks、build 11/11 tasks 通过。

验收：一轮包含 30 个工具步骤时，流式更新只影响当前过程卡和当前助手草稿。

### S5：上下文快照与圆环真值 ✅ 完成 2026-07-28

目标：上下文展示与实际 provider request 一致。

- [x] 建立 `ContextSnapshotBuilder`。
- [x] Context Packet 的 included/audit-only 语义闭环。
- [x] 圆环读取 Runtime context status。
- [x] 70% 自动 compact 使用同一 token 估算结果。
- [x] 历史图片、project memory、task goal、acceptance 按规则实际送模。
- [x] 增加“查看本次上下文构成”入口；只显示来源和 token，不暴露隐藏 reasoning。
- [x] cache-miss status 与真实 Provider 调用共用 system/agent/project/messages/tools 构造器，并按 thread 解析 workspace、权限和工具能力。

当前验收：Provider request 与 Runtime status 的六类 token breakdown 一致；cache-miss 与 cache-hit 均有集成测试覆盖，隐藏 reasoning 不进入请求或状态；Runtime 52 文件/335 项测试通过。

验收：测试 provider request 快照与 UI context breakdown 一致。

### S6：消息虚拟化与 UI 收尾 🚧 首切片完成 2026-07-28

目标：超长会话 DOM 仍保持流畅。

- [x] 实现仓库内受控动态高度 windowing，不引入新的第三方运行时依赖。
- [x] durable 历史消息按视口、上下 overscan 和 spacer 有界挂载；1000 条消息的计算窗口保持常数级。
- [x] 当前 streaming message、optimistic 用户消息、本地错误和工具审批卡保持稳定挂载，不随历史窗口卸载。
- [x] 使用 `ResizeObserver` 校准动态高度，并补偿视口上方测量差，降低高度估算收敛时的滚动跳动。
- [x] scroll viewport 更新经 `requestAnimationFrame` 合并，避免每个原生滚动事件触发 React 更新。
- [x] 向上分页按 `previousScrollTop + scrollHeight delta` 保留精确视口锚点；动态高度校准只补偿完全位于视口上方的消息。
- [ ] 实窗验收自动滚底、代码块全屏和图片 lightbox。
- [ ] 增加 1000 条复杂 Markdown/过程/图片消息的 Renderer 性能 fixture 与验收记录。
- [x] 历史 run process 查询跟随可见/overscan 窗口，离屏重试 timer 会取消，不再为整页 loaded messages 预取。

验收：1000 条复杂消息下滚动和输入保持可用。

### S7：清理与压缩策略

- tool 全文迁 artifact，event 保存摘要/ref。
- checkpoint 改为低频或按 run upsert，并设置保留策略。
- 增加数据库维护：WAL checkpoint、VACUUM 提示、备份保留上限。
- 现有约 7.2GB backups 必须增加可配置保留数量/周期，避免磁盘再次拖慢系统。
- 旧 eventHistory 聊天投影路径在迁移稳定后删除。

## 8. 关键修改位置

主要文件范围：

```text
packages/storage/src/schema/thread.ts
packages/storage/src/runtime-state-store.ts
packages/storage/src/message-store.ts                # 新增
packages/protocol/src/commands.ts
apps/runtime/src/runtime.ts
apps/runtime/src/demo-run.ts
apps/runtime/src/chat-tools.ts
apps/desktop/src/main/runtime-session.ts
apps/desktop/src/main/runtime-client.ts
apps/desktop/src/main/index.ts
apps/desktop/src/preload/index.ts
apps/desktop/src/renderer/shell/ShellApp.tsx
apps/desktop/src/renderer/shell/ChatView.tsx
apps/desktop/src/renderer/shell/ExecutionProcessBlock.tsx
apps/desktop/src/renderer/shell/execution-process.ts
apps/desktop/src/renderer/m0-projection.ts             # 迁移期兼容，最终退出聊天主链
```

## 9. 不应采用的捷径

- 只加虚拟列表：无法解决 Runtime 冷启动、IPC replay、SQLite 膨胀。
- 只限制 Renderer eventHistory 长度：会丢历史与过程状态，并且 Runtime/DB 仍慢。
- 只提高 pipe frame 上限：会放大内存和传输问题。
- 只增加 Compact：只能减少模型 prompt，不能减少 UI 和 DB 成本。
- 继续把 Base64、完整 run、完整 tool stdout 放进每个事件。
- 为了兼容旧代码同时长期维护“message 表”和“event 投影消息”两个真源。迁移期可双写，但最终必须以 message store 为聊天真源。

## 10. 性能验收预算

建议在目标开发机上固定以下预算：

| 场景                                 |                      目标 |
| ------------------------------------ | ------------------------: |
| Desktop 窗口出现后列表可操作         |  ≤ 1 秒（Runtime 已运行） |
| 冷启动到 Runtime pipe ready          |                    ≤ 3 秒 |
| 打开普通会话首屏                     |                   ≤ 300ms |
| 打开 1000+ 消息会话首屏              |                   ≤ 500ms |
| 切换两个已加载会话                   |                   ≤ 150ms |
| 单个流式 delta UI 处理               |                     ≤ 4ms |
| 50 条首屏 DOM 消息                   |           仅一页/虚拟窗口 |
| 1000 delta durable assistant message |        1 条 final message |
| Renderer 内存                        | 不随全库 event 数线性增长 |

## 11. 推荐下一步

S0–S5 已完成，下一轮进入 **S6：消息虚拟化与 UI 收尾**：

1. 固定虚拟列表/windowing 实现与版本，先覆盖历史 durable messages，当前 streaming message 保持稳定挂载；
2. 保留向上分页锚点、自动滚底、代码块全屏和图片 lightbox；
3. 离屏消息不挂载 Markdown 高亮、深度思考与工具详情；
4. 增加 1000 条复杂消息的结构/渲染回归，并单独重启进行实窗滚动验收。
