# NewMax 会话切换实现证据

核对日期：2026-09-17

## 样本

- 安装程序：`D:\tools\newmax\NewMax.exe`
- 安装包：`D:\tools\newmax\resources\app.asar`
- `package.json` 版本：`1.1.17`
- `app.asar` SHA-256：`43B225D60D2CB15E7F1F025027905C75081F0E0CBE4CC974A77B41C88C6D6FEB`
- 主 renderer bundle：`out/renderer/assets/percentages-BXMCSKIN-DTs6C6cT.js`
- Chat store bundle：`out/renderer/assets/walletStore-B0wGmOa8.js`

下面的 offset 是上述 SHA-256 样本中 UTF-8 bundle 字符串的零基偏移，可用文末命令复现。

## 已确认机制

### 会话状态按 id 常驻内存

`walletStore-B0wGmOa8.js:2725105` 的 `setActiveConversation` 只更新 `activeConversationId`；`2725299` 的 `loadMessages` 把消息写入 `state.conversations[getConversationKey(conversationId)]`。切换已访问会话时，消息来自 Zustand store，而不是先清空当前消息再等待磁盘读取。

### 已激活 Tab 保持挂载

`percentages-BXMCSKIN-DTs6C6cT.js:7871131` 的 `hasBeenActiveRef` 在 Tab 首次激活后保持 `true`。非活动 conversation Tab 使用 `display: none`，组件、DOM、滚动位置和局部 React state 均继续存在。

### 消息使用尾部窗口，不使用估算 spacer

`percentages-BXMCSKIN-DTs6C6cT.js:1078826` 定义：

- `MESSAGE_INITIAL_RENDER_THRESHOLD = 12`
- `MESSAGE_INITIAL_RENDER_LIMIT = 12`
- `MESSAGE_LOAD_EARLIER_BATCH = 40`

`1082532` 的 `getInitialMessageRenderStart` 在消息超过 12 条时返回 `messageCount - 12`。`1106508` 以 `conversationId + length + firstId + lastId` 组成窗口 reset key，实际渲染为 `messages.slice(renderStartIndex)`。

`1118522` 的 `expandRenderWindowTo` 只允许 start index 向前移动。扩窗前记录真实 `scrollHeight`，React commit 后执行 `scrollTop += newScrollHeight - oldScrollHeight`，因此没有固定高度估算、顶部 spacer 或通用虚拟列表参与这条消息渲染路径。

顶部按钮先把内存中的隐藏消息按 40 条展开；`renderStartIndex` 已到 0 后，才调用 `onLoadEarlierHistory` 读取更早的持久化历史。

### 缓存首帧与磁盘补齐

`percentages-BXMCSKIN-DTs6C6cT.js:2550993` 的 `cachedReady` 在会话已有消息或正在流式输出时立即允许 ChatView 渲染。

活动会话随后调用 `conversations.getMeta` 比较磁盘消息数与内存消息数；仅在内存为空或磁盘更多且当前不在流式输出时读取完整会话。旧请求有局部 `cancelled` 标记，切换后返回的数据不会覆盖当前 Tab。

`2549977` 的 `createSerializedTaskQueue` 串行执行会话磁盘读取，并在任务之间 `setTimeout(0)` 让出事件循环。`2550556` 的 `nextPaint` 在重型消息列表写入 store 前执行一次 `requestAnimationFrame + setTimeout(0)`。

### 重型判定与骨架延迟

`percentages-BXMCSKIN-DTs6C6cT.js:245502` 的 `isHeavyMessageList` 满足任一条件即判为重型：

- 消息数至少 12；
- 文本、thinking 和工具调用估算累计超过 24,000 字符。

`246065` 定义骨架延迟 `120ms`。快速缓存命中或快速磁盘读取在延迟结束前完成时，骨架不会闪现；已知重型会话可立即显示骨架。

### 滚动状态

`walletStore-B0wGmOa8.js:2728316` 把 `scrollTop` 写入对应会话状态。更关键的切换恢复来自 Tab 保活：普通 A → B → A 不会重新创建 A 的消息容器，因此浏览位置直接由原 DOM 保留。

新建 ChatView 的默认行为是滚到尾部，并通过 30/80/120ms 三次校正吸收图片、Markdown 等异步布局变化。该初始化逻辑不会在保活 Tab 的普通切回时重新执行。

## SYNC-THINK 对齐点

- 每个已激活会话面保持挂载，切走仅隐藏。
- durable 消息按 `conversation.id + taskId` 缓存并做旧响应隔离。
- 首屏只挂尾部 12 条；顶部按钮每次向前扩 40 条。
- 扩窗使用真实 `scrollHeight` 差保持视觉锚点，不引入估算 spacer。
- 内存窗口全部展开后才读取下一页数据库历史。
- minimap 跳转和分页是 SYNC-THINK 的额外能力；它们会显式扩开目标页，避免尾部窗口隐藏导航目标。

## 复现命令

从仓库根目录运行：

```powershell
node -e "const a=require('./node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar/lib/asar.js'); console.log(a.extractFile('D:/tools/newmax/resources/app.asar','package.json').toString())"
```

```powershell
@'
const asar=require('./node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar/lib/asar.js');
const archive='D:/tools/newmax/resources/app.asar';
const file='out\\renderer\\assets\\percentages-BXMCSKIN-DTs6C6cT.js';
const source=asar.extractFile(archive,file).toString('utf8');
for (const term of ['MESSAGE_INITIAL_RENDER_THRESHOLD','function getInitialMessageRenderStart','const renderWindowResetKey','const expandRenderWindowTo','function createSerializedTaskQueue','function nextPaint','const cachedReady','const SKELETON_REVEAL_DELAY_MS','hasBeenActiveRef']) {
  console.log(term, source.indexOf(term));
}
'@ | node
```
