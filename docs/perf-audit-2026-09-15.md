# SYNC-THINK 性能审计报告

日期：2026-09-15
范围：加载速度、缓存、响应延迟、流畅度
状态：**仅定位与方案，未改动任何代码**

---

## 0. 结论摘要

"点击之后不能立即响应"不是单一原因，是三层叠加：

| 层 | 问题 | 实测证据 |
|---|---|---|
| 数据层 | 事件日志与 checkpoint 无上限、无清理，库膨胀到 268 MB，而业务数据只有 11 会话 / 205 消息 | 90% 的库是流式 token 碎片和历史 checkpoint |
| 启动层 | 全量事件回放 + 二次全表扫描 + 1.14 MB checkpoint 解析，全部同步阻塞在 `runtime.start()` 之前 | 回放本身 561 ms，checkpoint 读取 100 ms |
| 渲染层 | 零渲染隔离：全 shell 只有 13 个 `memo`，ShellApp 5902 行 266 个 hooks，8 个常驻面板跟随每次 setState 重渲染 | `Sidebar` 40 props / 20 个内联箭头，全部无 memo |

**关键判断：真正的瓶颈不在进程间通信。** 管道往返实测 0.22 ms，管道探测 0.23 ms —— 这一层没有问题，不要往这里投入。

---

## 1. 数据层：库膨胀（P0，根因）

### 1.1 实测规模

```
数据库文件            280,240,128 B (268 MB)
page_count            68,599 页
业务数据              conversation 11 / message 205 / task 23 / thread 23 / run_index 13
```

**业务数据只有几百行，库却有 268 MB。** 分解：

| 表 | 占用 | 说明 |
|---|---|---|
| `event` | 127.9 MB | 32,290 行 |
| `checkpoint` | 124.2 MB | 6,442 行，最大单行 1.14 MB |
| `skill_version` | 2.4 MB | |
| `message` | 0.7 MB | 真正的对话内容 |

`event` 表内部分布（按 type）：

| type | 行数 | 字节数 |
|---|---|---|
| `message.delta` | 26,164 | **79.0 MB** |
| `message.reasoning_delta` | 631 | **27.7 MB** |
| `tool.requested` | 1,026 | 0.9 MB |
| `application.tool_completed` | 626 | 1.8 MB |

即 **约 107 MB / 128 MB 的 event 表是流式 token 碎片**。

时间分布（按 `occurred_at` 月份）：

| 月份 | 行数 | 字节数 |
|---|---|---|
| 2026-07 | **31,331** | **113.8 MB** |
| 2026-08 | 91 | 0.1 MB |
| 2026-09 | 868 | 2.8 MB |

**97% 的事件是两个月前的**，从未清理，每次启动仍被全量回放。

### 1.2 checkpoint 表

```
行数            6,442
总大小          124.2 MB
最大单行        1.14 MB
```

按 run_id 分布：

| run_id | 行数 | 大小 |
|---|---|---|
| `runtime-dev-0001` | **6,414** | **111.6 MB** |
| `runtime-install-817ad894-…` | 17 | 4.3 MB |

按天分布：**5,483 行 / 104.8 MB 集中在 2026-07-23 一天**。

单行 `state_json` 结构（最大那条）：`{ schemaVersion, threadVersions[15], demoRuns[1] }` = 1.14 MB。

**没有任何机制删除旧 checkpoint。**

### 1.3 清理机制为何没生效

`event-retention-archive` / `database-compaction` / `event-payload-sidecar-gc` / `database-maintenance-executor` 全部是**离线 CLI**，只被 `packages/storage/src/scripts/database-governance.ts` 引用，**Runtime 与 Daemon 没有任何调用点**。

而且即使手动跑，归档条件也几乎不可满足（`packages/storage/src/event-retention-archive.ts:180-185`）：必须同时满足 category ∈ {telemetry, diagnostic, system, provider}、type 含 heartbeat/trace.sampled 之类、`taskId/runId/stepId/messageId` 全为 NULL、且早于人工指定 cutoff，还要 `maintenanceWindowConfirmed` + 确认令牌。

**承载对话的 `run.*` / `message.*` / `tool.*` 事件永远不满足条件，永远不清理。**

### 1.4 影响

- 启动回放量随使用时长线性增长，永不收敛。
- 所有基于 event 的查询（`getRunEventCursor`、`listRunProcessEvents`、legacy 回退）随数据量线性变慢。
- 268 MB 的库 + 15.6 MB 页缓存 → 见 §2.2。

### 1.5 建议方案

1. **给 `event` 表加运行时保留策略**：`message.delta` / `message.reasoning_delta` 在 `run.completed` 落库后即可删除（终态 payload 已含完整文本）。这是最大的单点收益，能砍掉约 107 MB 中的绝大部分。
2. **checkpoint 只保留每个 run 最新 N 条**（建议 2–3 条，用于崩溃恢复），其余按 run 终态清理。
3. **把清理接进 Runtime**，在空闲窗口（例如 `scheduler.recoverAll` 之后）分批执行，不要依赖离线 CLI。
4. 一次性回收：对现有库执行一次归档 + `incremental_vacuum`。

### 1.6 用户可感知的差异

- 冷启动从"转好几秒"降到接近瞬时。
- 长会话滚动、切换不再随时间退化。
- 磁盘占用从 268 MB 降到几十 MB 量级（另有 `backups/` 2.7 GB 可清）。

---

## 2. 启动路径：同步阻塞（P0）

### 2.1 实测

```
事件回放（SELECT + JSON.parse，32,290 条 / 117 MB payload）  = 561 ms
checkpoint 读取（单行 1.14 MB state_json，268 MB 库）        = 100 ms
                                                            （JSON.parse 本身仅 2.3 ms）
```

**561 ms 只是读 + 解析**，真实路径还要对每条事件执行 `applyEventToProjection`，然后 `backfillDurableMessages`（`apps/runtime/src/runtime.ts:3944`）**再全表扫一遍**。

### 2.2 页缓存覆盖率仅 5.8%

复刻 `packages/storage/src/connection.ts:21-38` 的 pragma 序列后实测：

```
journal_mode = wal
synchronous  = 1 (NORMAL)     ← 已是 NORMAL，不是 FULL（不用改）
cache_size   = 16000 KiB = 15.6 MB   ← 未显式设置，取 better-sqlite3 默认 -16000
mmap_size    = 0                     ← 未设置
busy_timeout = 5000
库大小       = 268 MB
页缓存覆盖率 = 5.8%
```

`packages/storage/src/connection.ts` 只设了 3 个 pragma（`journal_mode` / `busy_timeout` / `foreign_keys`）。**`cache_size` 与 `mmap_size` 都没设。**

另外**只读分支跳过了 `busy_timeout`**（`connection.ts:27-28`），而 history worker 与 usage worker 打开的都是只读连接 —— 这两条连接遇到写锁会**立即** `SQLITE_BUSY`，没有等待。

### 2.3 启动顺序

```
apps/runtime/src/persistence.ts:217  await runMigrations(databasePath)
                            :267  reconcileTaskVersionFloorsFromMessages()   ← 无 await / 无 void，纯同步
                            :268  reconcileTaskVersionFloorsFromTaskEvents() ← N+1：遍历全部 task 各查一次
                            :342  run_index 未完成清扫（SELECT * 无 LIMIT）
apps/runtime/src/runtime.ts:2917  restorePersistedState()  ← 构造函數内同步回放
                            :3944  backfillDurableMessages()  ← 再全扫一遍
                            :33697 this.server.listen(...)    ← 到这里才对外可用
```

`runtime.ts:33719` 还有一处：`onReady` 被挂在 `browserExtensionReady.finally(...)` 之后，即管道对外通告要等浏览器扩展宿主 bind 完成。实测日志里它确实失败了（`EADDRINUSE 127.0.0.1:17374`），会走 `finally` 继续，但仍是串行等待。

**这些全在 `runtime.start()` 返回前完成。桌面端在此期间拿不到任何响应。**

### 2.4 建议方案

1. **加 `cache_size`**（建议 `-262144` 即 256 MB，或至少 64 MB）与 `mmap_size`（建议 256 MB–1 GB）。
2. **给只读连接也设 `busy_timeout`**。
3. **回放分片让出事件循环**：每 N 页 `await setImmediate`，并允许管道先就绪、回放在后台补齐（项目已有 `trackBackgroundTask` 机制，只是没用在这里）。
4. **把对账 / 回填 / 清扫包装成后台任务**，与管道就绪解耦。
5. 配合 §1 的清理，回放量本身就会大幅下降。

### 2.5 用户可感知的差异

- 冷启动"加载中"时间大幅缩短，窗口出现后立刻可用而不是空列表转圈。
- 冷读不再走磁盘（页缓存命中率从 5.8% 提到大部分常驻）。

---

## 3. 并发写竞争（P0，当前正在发生）

### 3.1 实测现状

```
[UP]   \\.\pipe\sync-think-install-817ad894-bf10-4e57-b2a1-28980b72e969      2.48ms
[UP]   \\.\pipe\sync-think-dev-0001                                          0.29ms
[UP]   \\.\pipe\sync-think-install-817ad894-…-daemon                         0.17ms
[UP]   \\.\pipe\sync-think-dev-0001-daemon                                   0.22ms
[DOWN] sync-think-install-65d96901-… / sync-think-install-bae2efd7-…         （仅残留 pid 文件）
```

**两个 Runtime 进程同时活着，且都指向同一个 `sync-think.db`。** 日志可证：

```
2026-09-08 [daemon] started. installId=dev-0001       db=…\SYNC-THINK\sync-think.db
2026-09-15 [daemon] started. installId=install-817ad894  db=…\SYNC-THINK\sync-think.db
```

### 3.2 影响

写事务统一用 `BEGIN IMMEDIATE`（方向正确），但配合 `busy_timeout = 5000`，**被阻塞的写操作会在事件循环上同步自旋最多 5 秒**。better-sqlite3 是同步 API，这 5 秒内该 Runtime 的所有 IPC 一起停顿 —— 这正是"点击后完全没反应"的典型形态。

`packages/storage/src/connection.ts:31-33` 的注释承认了这个场景，但只对迁移加了文件锁，**常规写没有应用层互斥或退避**。

### 3.3 建议方案

1. 确保同一时刻只有一个 Runtime 持有某个数据库（当前多 install id 并存是缺陷，不是设计）。
2. 清理残留 pid 文件与进程。
3. 降低 `busy_timeout`（例如 1000 ms）并改为**异步退避重试**，避免同步自旋。
4. 长期：把写路径移出主事件循环（见 §4）。

### 3.4 用户可感知的差异

- 消除偶发的"整体卡死几秒"，这类卡顿最伤体验。

---

## 4. 写入放大：每事件一事务（P1）

### 4.1 实测

复刻生产配置（`synchronous = NORMAL`）写入 500 个事件：

```
逐事件一事务（当前实现）: 91 ms  = 0.182 ms/事件
批量单事务（优化后）    :  5 ms  = 0.010 ms/事件
加速                    : 18.6x
```

换算：

| 场景 | 当前 | 优化后 |
|---|---|---|
| 一个回合 500 个流式 delta | 91 ms 阻塞 | 5 ms |
| 库内累计 26,164 个 `message.delta` | 4.8 s | 0.3 s |

### 4.2 代码位置

`apps/runtime/src/runtime.ts:33119-33125` —— 每次只提交一个事件：

```ts
const committed = this.stateStore.commitTransition({ events: [draft] });
```

共 10 处同样的 `{ events: [draft] }` 调用（`:6486, :6603, :7221, :7455, :7773, :8068, :8168` …）。

`packages/storage/src/runtime-state-store.ts:250-304` 的事务体：每个事件 = 1 次 `BEGIN IMMEDIATE` + 1 次 `SELECT MAX(sequence)` + 1 次 INSERT + `taskPlanProjection.updateExisting`（内部还有 SELECT/DELETE/SAVE）+ 1 次 COMMIT。

`apps/runtime/src/runtime.ts:21087-21113`：每个 provider `text-delta` 都会调 `publishTransientDelta` → `publishTransientFrame` → `persistAssistantTimelineSegments()`（`:33564`）→ 同步 SQLite upsert。

### 4.3 建议方案

1. **合并同一批次的多个事件到单个事务**（`commitTransition({ events: [...] })` 已经支持数组，只是调用方只传一个）。
2. 流式 delta **照写，但改提交粒度**：在内存累积，按时间窗口（如 250 ms）或字符阈值批量刷盘。**不要改成「不落库」** —— delta 是在跑的 run 崩溃恢复的唯一依据，不落库会丢已输出未落终态的文本。批量刷盘保留全部 18.6× 收益，且恢复能力与现状一致。
3. `assistant_timeline_segment` 的 upsert 同样按帧合并（已有指纹去重，`runtime.ts:33651`，把事务粒度再放宽即可）。
4. 检查 `event-payload-sidecar.ts:196-216` —— 它在 **DB 事务内部**做 gzip + `writeFileSync` + `fsyncSync` + `renameSync` + `statSync` + 回读校验。事务内做 fsync 磁盘 I/O 应当移出。

### 4.4 用户可感知的差异

- 流式输出期间界面不再随输出速率抖动。
- 输出很快时点击仍然跟手（事件循环不再被写事务占满）。

---

## 5. 渲染层：零隔离（P1，最影响"跟手"）

### 5.1 实测数据

| 指标 | 数值 |
|---|---|
| `ShellApp.tsx` | 5,902 行，**266 个 hooks**（useState 75 / useRef 37 / useMemo 14 / useCallback 110 / useEffect 29） |
| `ChatView.tsx` | 9,322 行，**387 个 hooks** |
| 全 shell `memo` | **仅 13 个** |
| 全 renderer `useEffect` | **344 处** |
| `createContext` | 5 个，全是局部小工具（Dialog / Toast / Markdown），**没有承载 Shell 全局状态** |
| `useSyncExternalStore` | ShellApp 内 0 |
| `useTransition` / `startTransition` | **全仓 0 处** |
| `useDeferredValue` | 1 处（`CodeBlock.tsx:61`） |

### 5.2 无 memo 的大组件

| 组件 | props 数 | 其中内联箭头函数 |
|---|---|---|
| `Sidebar` | **40** | **20** |
| `ConversationTabs` | **36** | **19** |
| `ChatView` | 24 | 6 |
| `TopBar` | 20 | 5 |

`ShellApp.tsx:3786-3795` 典型例子 —— `handleOpenFileInSplit` 本身是 `useCallback`，但这里用内联箭头又包了一层，每次渲染都产生新引用。

### 5.3 常驻面板

`apps/desktop/src/renderer/shell/KeepAliveLayer.tsx`：

```tsx
const visited = useRef(props.active);
if (props.active) visited.current = true;
if (!visited.current) return null;
return <div hidden={...}>{props.children}</div>;
```

`ShellApp.tsx` 里有 **7 个** `KeepAliveLayer`（`stage-talk` / `agents` / `teams` / `browser` / `abilities` / `tasks` / `activity`）。一旦访问过就**永久挂载**，只切 `hidden`。

**注意：设置页不在此列。** `SettingsPage` 渲染在 `<Dialog.Root open={settingsOpen}>` 的 Portal 内（`ShellApp.tsx:4155-4168` → `5886`），关闭弹窗即卸载。因此 `SettingsPage.tsx:2571` 的 3 秒轮询、`DaemonCard.tsx:38` 的 3 秒轮询**离开后都会停止**，不构成常驻开销。

真正常驻的轮询只有两处（都在 KeepAliveLayer 的 stage 内）：

| 位置 | 间隔 | 内容 |
|---|---|---|
| `TaskPanel.tsx:162` | 30 s | `setNow(Date.now())`，仅用于相对时间显示 |
| `ability/AbilityCenterPage.tsx:400` | 30 s | `loadLocalSkills()` —— **真实 IPC + 本地文件扫描** |

`ChatView.tsx:5174` 的 200 ms 轮询**受 `compactProgress` 门控**（`if (!compactProgress) return;`），只在压缩进行中运行，不是常驻轮询。

### 5.4 状态提交期做同步 I/O

`ShellApp.tsx:704-716` —— 副作用写在 state updater 内部：

```tsx
setPaneLayouts((current) => {
  ...
  const next = { ...current, [workspaceId]: layout };
  persistPaneLayouts(next);      // ← 在 updater 里
  return next;
});
```

`persistPaneLayouts`（`ShellApp.tsx:424-435`）同步执行 **3 次** `JSON.stringify` + localStorage 写入（`writeWorkspacePaneLayouts` / `writeOpenConversationTabs` / `writeSelectedConversationByWorkspace` → `ui-preferences.ts:471-486`）。

`focusConversation`（`ShellApp.tsx:737-761`）会走到 `commitPaneLayout`，因此**每次点击侧边栏切换会话都触发这三次同步序列化**。这也是 React 纯度违规（StrictMode 下执行两次）。

### 5.5 消息列表没有真正虚拟化

`message-window.ts:185` 的 `calculateMessageWindow` / `buildMessageOffsets` / `MESSAGE_WINDOW_ESTIMATED_HEIGHT` **只被测试文件引用**：

```
renderer/shell/message-window.test.ts:19,40,210,217
renderer/shell/long-thread-performance.test.ts:5,6,20,28
```

`ChatView.tsx` 内引用数为 **0**。实际"窗口化"是纯 CSS（`shell.css:17833`）：

```css
.shell-message-window-item {
  content-visibility: auto;
  contain-intrinsic-size: auto 220px;
}
```

`content-visibility: auto` 只跳过离屏元素的**布局与绘制**，**不跳过** React 元素创建、DOM 挂载与 reconciliation。

### 5.6 输入路径

- `ChatView.tsx:1433` 的 `input` state 位于 9,322 行组件的顶层。
- `handleInputChange`（`:6035-6047`）→ `updatePickersFromCaret`（`:5991-6004`）单次击键最多 **4 个 setState**。
- `ChatView.tsx:5247-5249` 的 `useLayoutEffect` → `computeTextareaHeight`（`compose-mention.ts:168-177`）读 `scrollHeight` → **每敲一个字符一次强制 reflow**，且 `useLayoutEffect` 在绘制前同步执行。
- `ChatView.tsx` / `ShellApp.tsx` / `compose-toolbar.tsx` 内 **debounce/throttle 零匹配**。

好消息：输入路径**没有 IPC**，全是本地计算。

### 5.7 流式帧节奏

`chat-transient-stream.ts:118,151-159`：

```
默认刷新延迟 55 ms
积压 > 240 字符 → 35 ms
积压 > 1200 字符 → 22 ms
积压 > 3000 字符 → 14 ms（≈70 fps，比 60 Hz 一帧还快）
```

### 5.8 建议方案

1. **加 memo 边界**：给 `Sidebar` / `ConversationTabs` / `ChatView` / `TopBar` 包 `memo`，并把内联箭头函数全部换成 `useCallback`（或让子组件接收稳定引用 + 内部绑定 pane id）。
2. **引入 `useTransition`**：把事件批次驱动的状态更新（`ShellApp.tsx:1711`）标记为非紧急，让点击/输入优先。
3. **`KeepAliveLayer` 改为「不重渲染」而不是「卸载」**：给各 stage 面板加 `memo` 边界，并停止把 `eventHistory` 传进 `ActivityCenterPage`（`ShellApp.tsx:4137`）—— 让它自己订阅所需数据。卸载会丢滚动位置、可能中断 `BrowserStage` 的浏览器会话，且重进要重新加载 chunk。**加 memo 与切 prop 是视觉零变化的，优先走这条。**
   若确实要省内存，只对无状态的 `AgentLibrary` / `TeamLibrary` 做卸载，**绝不卸载 `stage-talk`（带 `preserveLayout`）与 `stage-browser`**。
4. **`persistPaneLayouts` 移出 updater**：改为 `useEffect` + 节流（如 300 ms）落盘。
5. **把 `calculateMessageWindow` 接进 `ChatView`**，真正做窗口化；或至少给 `MessageBubble` 加自定义比较器。
6. **输入框 state 下沉**到局部组件，或加 `useDeferredValue`，让每键不再重跑整个 ChatView。
7. `computeTextareaHeight` 改为读写分离（先读后写，避免 layout thrash），或直接改用 CSS `field-sizing: content`。

### 5.9 用户可感知的差异

- 点击侧边栏会话、切换面板立即有反馈。
- 长会话里打字不再有输入延迟。
- 流式输出时界面不卡，滚动顺滑。

---

## 6. 主进程：同步 I/O 阻塞所有 IPC（P1）

Electron 主进程是单一 JS 线程，同时负责窗口管理、全部 IPC handler、事件转发。任何同步工作会阻塞**全部** IPC。

### 6.1 每事件一次同步落盘

`apps/desktop/src/main/runtime-activity-cursor-store.ts:50-95`：

```ts
save(cursor) {
  persisted = parseCursor(JSON.parse(readFileSync(this.filePath, 'utf8')));  // 同步读
  if (persisted && compareCursors(next, persisted) <= 0) return;
  this.persist(next);
}
private persist(cursor) {
  writeFileSync(temporaryPath, serialized, 'utf8');   // 同步写
  renameSync(temporaryPath, this.filePath);           // 同步改名
}
```

调用链：`runtime-client.ts:1000`（`deliverEvent` 内，**每个 live 事件一次**）→ `runtime-session.ts:335 saveActivityCursor`。

事件密集期（一次 run 数百个事件）= 数百次阻塞式磁盘 I/O。Windows 上 `renameSync` 失败还有同步重试分支（`:78-93`）。

### 6.2 同步目录遍历

`apps/desktop/src/main/project-files.ts:84-135`（`readdirSync` + `lstatSync` 递归）与 `main/index.ts:4279-4298`（`readdirSync` + `lstatSync` 循环）。条目数有 500 上限，但**目录递归次数没有独立上限**（`collected.length >= maxEntries * 3` 才停）。

### 6.3 建议方案

1. 事件游标改为**内存态 + 节流落盘**（如 500 ms 一次），或仅在订阅切换/退出时落盘。
2. 目录遍历改 `fs/promises` 或移到 Worker。
3. 给递归加显式次数/深度上限。

### 6.4 用户可感知的差异

- 流式输出期间其他操作（切换会话、打开面板）不再被主进程阻塞。

---

## 7. 次要项（P2）

| # | 问题 | 证据 |
|---|---|---|
| 1 | `messages_fts` FTS5 表 + `AFTER INSERT` 触发器在维护，但**全仓没有任何 `MATCH` 查询** → 每条消息写入白付一次 FTS 成本（触发器内还做 `json_extract`），收益为零 | `packages/storage/src/fts.ts:5-22`；`MATCH` 在非测试源码中零命中 |
| 2 | `task` / `thread` 表除主键**零索引** | `migrate.ts:1514-1531`；55 个迁移中 `INDEX … ON task(` 零命中 |
| 3 | `conversation.list` 用 `ORDER BY (pinned_at IS NULL), pinned_at DESC, COALESCE(last_message_at, created_at) DESC`，表达式排序无索引可满足，且**无 LIMIT** | `conversation-store.ts:189-195`。当前 11 会话实测 0.09 ms，属"会随规模变坏"项，**不是当前瓶颈** |
| 4 | 105 个已注册但无调用方的 IPC handler；`onEvent` 监听主进程从不发送的 `runtime:event` | `main/index.ts` 258 个 `handle` vs preload 144 个唯一通道；`preload/index.ts:1521-1527` vs `main/index.ts:1164` 发的是 `runtime:events` |
| 5 | 首屏 JS 2.01 MB（预算 2.15 MB，余量 1.8%）；`shell.js` 单文件 1.51 MB 同步解析执行 | `build-manifest.json`；`shell-build-config.mjs:14` |
| 6 | 超时后不取消 runtime 侧执行，重试会重复执行 | `runtime-client.ts:539-542` |
| 7 | 管道无背压处理（无 `drain` / watermark），消费慢时数据无界 `socket.write` | `pipe/server.ts:91,151,175,222`；`runtime.ts:33605,33683`；`runtime-client.ts:544` |
| 8 | 磁盘冗余：`backups/` **2.7 GB**、`kernels/` 587 MB、`worktrees/` 284 MB | `du -sh` 实测 |
| 9 | 多个 install id 的残留 pid 文件（3 个 daemon、多个 runtime） | `%LOCALAPPDATA%\SYNC-THINK\*.pid` |
| 10 | `UsageSummaryQueryService` 每次查询 `new Worker`，结果完全不缓存（`refreshPromise` 只做并发去重，`finally` 立即清空），且 `facts` 数组无上限 | `usage-summary-cache.ts:925-951, 896-898, 456-479` |
| 11 | `ContentSnapshotCache` 的 revision 基于连接级 `total_changes()`，流式期间持续变化 → 缓存几乎全程失效，且每次读要跑 6 次语句取 revision | `conversation-store` 无关；`conversation-content-store.ts:331-338, 360-368` |
| 12 | `RunProcessSnapshotCache` 游标一变即全量重算，无增量；`maxEntries = 8` 偏小 | `run-process-snapshot-cache.ts:12-15`；`conversation-history-worker.ts:151-158` |

---

## 8. 已实测排除（不要在这里浪费时间）

这几项静态分析看起来像问题，实测证明**不是瓶颈**：

| 曾被怀疑 | 实测结果 | 结论 |
|---|---|---|
| 每次点击的 2 次管道探测 | 单次 connect 平均 **0.23 ms**（n=200，p90 0.61 ms） | 每次点击约 0.46 ms，可忽略 |
| `runtime.healthcheck` 往返 | **0.22 ms**（n=300，p99 0.49 ms） | 可忽略 |
| `ensureRuntimeConnection()` 未记忆化（219 个调用点） | 内部 `[...this.eventHistory]` 只是浅拷贝指针，且返回值被 216 个 handler 丢弃，**不过 IPC 边界** | 结构上是浪费，但不是延迟来源 |
| `mergeEventHistory` 全量重建 + 排序 | 5000 条时 **0.7 ms** | 可忽略 |
| `conversation.list` 全表扫描 | 11 会话 **0.09 ms** | 当前不是瓶颈（会随规模变坏） |
| 消息页 `json_each` 展开查询 | **0.02 ms** | 可忽略 |
| `synchronous` 停在 FULL | 实测已是 **NORMAL**（better-sqlite3 默认） | 无需修改 |
| 生产包带 sourcemap | `build-shell.mjs:31` 已 `sourcemap: !optimized`，产物无 `.map` | 已经是对的 |

**另外几处做得对、不要动**：`IncrementalMarkdownParser` 块冻结、`CodeBlock` 的 `useDeferredValue` + 行数截断、`MermaidChart` 300 ms 防抖 + 离屏跳过 + SVG LRU、会话历史读取的 Worker（懒启动 / 有界并发 / 30 s 空闲回收 / 只读连接 / 双层 cursor 缓存）、`lazyPanel` 的 7 个面板懒加载、`recentConversationPages` LRU + 骨架屏、transient stream 独立通道绕过 `eventHistory`。

---

## 8.5 前端视觉影响评估（哪些改动用户看得见）

用户明确关心的取舍问题：这些优化会不会改变页面外观或行为。

### 零视觉变化（纯内部改动，可放心做）

| 阶段 | 改动 | 为什么看不见 |
|---|---|---|
| 1 | `cache_size` / `mmap_size` / 只读连接 `busy_timeout` | SQLite 参数，不产出任何 UI 数据 |
| 1 | 删除**已终态 run** 的 `message.delta` / `reasoning_delta` | 见下方核实结论 |
| 2 | 消除多 Runtime 竞争同一 DB | 进程管理，不涉及渲染 |
| 3 | 合并事务 / 流式 delta 批量落库 | 流式显示走 transient 帧通道，**不读 DB** |
| 4 | `persistPaneLayouts` 移出 state updater + 节流 | 落盘时机变化，落盘内容不变 |
| 5 | 事件游标节流落盘 | 崩溃恢复点最多回退数百毫秒，UI 无感 |
| 6 | 加索引 / 删 FTS 表 / 删死 IPC handler | 无查询方、无调用方 |

**核实结论：删除已终态 run 的流式 delta，历史页面不会变。** 依据：

- 过程时间线的数据源 `listRunProcessEvents`（`packages/storage/src/runtime-state-store.ts:163-183`）的 WHERE 子句只包含
  `run.started/completed/failed/cancelled/paused`、`provider.usage`、`kernel.context_occupancy`、
  `tool.requested/completed/failed`、`execution.tool.*`、`tool.approval_requested/decided`、`mcp.*`
  —— **完全不读 `message.delta` / `reasoning_delta`**。
- 最终回答正文存在两处：`message.blocks_json`（205 行 / 0.7 MB，实测最大单行 224 KB）与
  `run.completed` 的 `assistantText`。
- 全仓唯一把这三个类型当字符串常量引用的地方是 `apps/desktop/src/event-history.ts:20-22`
  （渲染层的内存淘汰名单），不是读取方。
- 增量读回路径（`runtime.ts:21446-21448`）用的是内存态 `projection.nextRun`，不是库读。

**必须遵守的前置条件**：只删「已有终态事件（`run.completed` / `run.failed` / `run.cancelled`）的 run」的 delta。正在跑的 run 的 delta 是崩溃恢复的唯一依据，删了会丢已输出未落终态的内容。

### 有视觉/行为变化（需拍板）

| # | 改动 | 可见变化 | 建议 |
|---|---|---|---|
| 1 | `KeepAliveLayer` 卸载面板 | `stage-talk` 带 `preserveLayout`，卸载丢滚动位置；`stage-browser` 装着活的 `BrowserStage`，卸载可能中断浏览器会话/录制；重进要重新加载 chunk，可能闪 loading | **不做卸载**。改为「不重渲染」：给面板加 `memo` 边界，并停止把 `eventHistory` 传进 `ActivityCenterPage`（让它自己订阅）。视觉零变化，同样省掉重渲染 |
| 2 | `conversation.list` 加 `LIMIT` | 侧边栏只能看到最近 N 个会话，必须配「加载更多」UI | **现在不做**。11 个会话实测 0.09 ms，不是当前瓶颈 |
| 3 | `useTransition` 标记事件批次为非紧急 | 极少数情况下状态更新晚一帧 | 低风险，感知是变好。建议只包事件批次那一路（`ShellApp.tsx:1711`） |
| 4 | `memo` 边界 + `useCallback` | 本身不可见。**但比较器写错会导致 UI 不更新**（比崩溃更难查） | 分组件小步提交，每步跑现有测试 + 手动过一遍关键路径 |

### 结论

**阶段 1 / 2 / 5 / 6 视觉零变化。** 阶段 3 视觉零变化（前提是流式显示继续走 transient 通道）。阶段 4 里唯一有风险的是「面板卸载」，而它恰恰不是必需的 —— 换成「加 memo 边界 + 切断 `eventHistory` prop」能达到同样效果且完全不可见。

## 8.6 会话切换的秒开能力会不会被破坏

用户明确关心：改完之后，切换对话再切回来，是重新加载还是要等。

**结论：不会重新加载。切换回近期会话仍然秒开，本方案没有任何一条改动碰到这条路径。**

### 现有两层缓存（都跨组件卸载存活）

| 层 | 位置 | 容量 | 关键性质 |
|---|---|---|---|
| 消息页 | `recentConversationPages`，`ChatView.tsx:578` | **8 个会话 × 最近 100 条消息**（`:576-577`） | **模块级 Map**，注释明写「deliberately outlives unmounts so a keep-alive remount can reuse the last page」 |
| 滚动位置 | `conversationScrollPositions`，`ChatView.tsx:463` | 32 个会话（`:461-462`） | 模块级 Map **且写入 localStorage**（键 `sync-think.conversationScrollPositions`，`:465-495`），重启应用都能恢复 |

缓存命中时**直接跳过 IPC**（`ChatView.tsx:2627-2639`）：

```ts
// A keep-alive remount can reuse the recent-page cache; skip the IPC so
// switching back does not flash a skeleton or wait on SQLite.
if (readRecentConversationPage(historyScopeKey)) {
  loadedMessagesConversationIdRef.current = String(conversation.id);
  return;
}
void loadMessages();
```

缓存键 `JSON.stringify([conversation.id, conversation.taskId ?? null])`（`:1788`），稳定不漂移。

### 为什么本方案不影响它

| 改动 | 是否触及切换路径 |
|---|---|
| 清理 `event` / `checkpoint` | **否**。消息内容来自 `message` 表（`message-store.ts:509`：`FROM message WHERE thread_id = ? AND role IN ('user','assistant')`），与 `event` 表无关 |
| `cache_size` / `mmap_size` | **否**，纯连接参数 |
| 批量提交事务 / 流式 delta 批量落库 | **否**，改写入时机，不改读取来源 |
| 渲染层 `memo` 边界 | **否**，不涉及缓存逻辑 |
| `conversation.list` 加 `LIMIT` | **会** —— 侧边栏将少显示会话。**因此明确不做** |

### 反而会变快的地方

1. **缓存未命中路径**（第 9 个及以后的会话）：IPC → Runtime → history worker → SQLite 读 `message` 表。库从 268 MB 降到几十 MB、页缓存从 15.6 MB 提上去 → 这条路径明显更快。
2. `ContentSnapshotCache` 失效判据是连接级 `total_changes()`（`conversation-content-store.ts:331-338`）—— **写越少失效越少**，批量事务让它命中率上升。
3. `RunProcessSnapshotCache` 按事件游标失效 —— 游标推进变慢，命中率上升。

### 唯一需要留意的取舍

若采取「流式 delta 干脆不落库」的激进做法，**Runtime 中途崩溃/重启**时，正在输出但尚未落终态的文本会丢失。**同一进程内切换会话不受影响** —— 在跑的 run 状态在 Runtime 内存里（`demoRuns` + `transientReplay`），不读库。

因此采用保守方案：**delta 照写，只做批量提交**（18.6× 收益完全保留），加上**仅删除已有终态事件的 run 的 delta**。崩溃恢复能力与现状完全一致。

## 9. 建议实施顺序

按"投入产出比 × 用户可感知度"排序：

| 阶段 | 内容 | 预期用户感知 |
|---|---|---|
| **第 1 步** | 清理 event / checkpoint（§1），加 `cache_size` + `mmap_size`（§2.4） | 冷启动显著变快；库从 268 MB 降到几十 MB |
| **第 2 步** | 消除多 Runtime 竞争同一 DB（§3） | 消除"整体卡死几秒" |
| **第 3 步** | 批量提交事务（delta **照写**，只改提交粒度）+ 流式 delta 按时间/字符窗口刷盘（§4） | 流式期间界面不抖、点击跟手；崩溃恢复能力不变 |
| **第 4 步** | 渲染层 memo 边界 + `useTransition` + 切断 `ActivityCenterPage` 的 `eventHistory` prop（§5，**不做面板卸载**） | 点击立即响应、长会话打字不延迟；外观无变化 |
| **第 5 步** | 主进程同步 I/O 异步化（§6） | 流式期间其他操作不被阻塞 |
| **第 6 步** | P2 清理项（§7） | 边际改善 + 减少维护负担 |

---

## 附：本次审计的实测方法

所有数字来自本机真实环境，非估算：

- 数据库：`%LOCALAPPDATA%\SYNC-THINK\sync-think.db`（268 MB，正在使用中，只读探针）
- 写入成本：独立连接 + 复刻 `connection.ts` pragma 序列，写入探针数据后已清理
- 管道延迟：自建 pipe server 基准（n=200/300），以及对运行中实例的只读探测
- 构建产物：`apps/desktop/dist/renderer-shell/build-manifest.json`（2026-09-15 11:20 构建）
- 未修改任何源文件；探针脚本已全部删除
