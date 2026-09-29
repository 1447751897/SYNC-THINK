# NewMax Git 面板 与 文件变更体系 —— 逆向实现与复刻规格

> 调研对象：`D:\projects\SYNC-THINK`（NewMax 桌面版源码）
> 调研方式：只读通读全部相关文件（含测试与 CSS），未修改任何代码
> 状态：**深挖已完成，可支撑完全复刻**

---

## 0. 三个决定性结论（先读这段）

### 结论 1：功能已 100% 实现，但 Git 面板**没有挂载到生产界面**

`TaskStatusPanel`（含完整 Git 能力）当前唯一挂载点是**视觉夹具**：

```
apps/desktop/src/renderer/shell/Phase3VisualFixture.tsx
  :41    case 注册
  :1338-1365  TaskStatusFixture（唯一挂载点）
  :1624  分派
  通过 ?phase3-visual=task-status-panel 打开
```

生产路径 `ChatView.tsx:6581` 用的是 **`ComposerTaskPanel`**（来自 `@sync-think/ui-kit`），**只有任务清单，没有 Git 功能**。

**这解释了截图与源码的差异**：你截图里看到的运行版 NewMax 有 Git 面板，而这份源码里该面板处于「后端完整、UI 完整、未接线」状态。

### 结论 2：有一道**测试守卫**在主动阻止重新挂载

```
apps/desktop/tests/task-status-contract.test.ts:16
断言 ChatView.tsx 不含 <TaskStatusPanel
```

历史沿革：commit `e82f75b` 曾在 `ChatView.tsx:1913` 渲染它 → commit `2a904b5` 移除，并**加了契约测试锁死**。

⚠️ 复刻前必须决策：是**违背这道守卫**把面板挂回去，还是**保持守卫**、另找入口（如工作台）。

### 结论 3：文件浏览器与 diff 体系是**两套独立系统**，且都已上生产

| 系统 | 实现 | 生产状态 |
|---|---|---|
| Git 面板（分支/提交/推送） | `TaskStatusPanel.tsx` | ❌ 仅夹具 |
| 工作区文件浏览器（所有文件/变动文件） | `RightDock.tsx` → `WorkspaceFilesPanel` | ✅ `ShellApp.tsx` 已挂载 |
| 行级/词级 diff | `FileDiffSurface` / `DeferredFileDiff` / `word-diff` | ✅ 已挂载 |

`RightDock.tsx:4` 顶部注释写的「Git 面板：当前分支 / 未提交变更 / 最近提交」是**过时注释** —— 该文件里并没有 Git 面板，只有文件浏览器 + Review 面板。复刻时不要被它误导。

---

## 1. 目标架构：5 层链路

```
┌─ UI 层 ────────────────────────────────────────────────┐
│ TaskStatusPanel.tsx (947行)                            │
│   └─ GitToolsSection → CommitDialog / DirtyCheckoutDialog │
└────────────────┬───────────────────────────────────────┘
                 │ window.syncThink.runtime.getGitInfo(...)
┌─ 桥接层 ────────┴───────────────────────────────────────┐
│ preload/index.ts:1643-1664                             │
│   ipcRenderer.invoke('desktop:git-*', payload)          │
│ global.d.ts:944-958  ← 类型声明                        │
└────────────────┬───────────────────────────────────────┘
┌─ IPC 层 ────────┴───────────────────────────────────────┐
│ main/index.ts:2863-2954  (位于 setupRuntimeBridge 内)   │
│   6 × ipcMain.handle + assertRuntimeIpcSource + 逐字段校验 │
└────────────────┬───────────────────────────────────────┘
┌─ 后端层 ────────┴───────────────────────────────────────┐
│ main/project-git.ts (383行)                            │
│   runGit() → execFile('git', ...)                      │
│ project-git-contract.ts (58行) ← 类型契约              │
└────────────────────────────────────────────────────────┘
```

**设计原则**（`main/index.ts:2863` 原注释）：
> Renderer sends typed intent and never constructs shell commands.

即：渲染进程永不拼 shell 命令，所有 git 命令字面量固定在主进程。

---

## 2. 复刻清单（按依赖顺序）

### 2.1 后端：零第三方依赖，仅 Node 内置模块

| # | 文件 | 行数 | 内容 |
|---|---|---|---|
| 1 | `apps/desktop/src/project-git-contract.ts` | 58 | 8 个 interface，纯类型无运行时 |
| 2 | `apps/desktop/src/main/project-git.ts` | 383 | 6 个导出函数 + 7 个辅助函数 |
| 3 | `apps/desktop/src/main/index.ts:114-121, 2863-2954` | — | import + 6 个 IPC handler |
| 4 | `apps/desktop/src/preload/index.ts:24-31, 1643-1664` | — | 类型 import + 6 个桥方法 |
| 5 | `apps/desktop/src/renderer/global.d.ts:22-28, 944-958` | — | runtime 接口声明 |
| 6 | `apps/desktop/src/main/project-git.test.ts` | 137 | 4 个测试用例 |

依赖：`node:child_process`(execFile) / `node:fs` / `node:path`。**无任何 npm 包**。

### 2.2 UI：Git 面板

| # | 文件 | 行数 | 内容 |
|---|---|---|---|
| 7 | `apps/desktop/src/renderer/shell/TaskStatusPanel.tsx` | 947 | 主组件 + 8 个内部组件 |
| 8 | `apps/desktop/src/renderer/shell/TaskStatusPanel.test.tsx` | 306 | 11 个行为契约 |
| 9 | `apps/desktop/tests/task-status-contract.test.ts` | 51 | 源码文本契约（**挂载守卫**） |
| 10 | `apps/desktop/src/renderer/shell/viewport-frame.ts` | 39 | `listenForFrameCoalescedViewportChange` |
| 11 | `apps/desktop/src/renderer/shell/shell.css:846-1693` | ~850 | 全部 `shell-task-status*` 样式 |
| 12 | `packages/protocol/src/commands.ts:3940, 4924` | — | `RunProcessView` / `GoalStatus` |
| 13 | `apps/desktop/src/renderer/shell/todo-projection.ts` | 32 | `TodoProjection` |

外部依赖：`react` / `react-dom`(createPortal) / `clsx` / `lucide-react@^0.468.0`(20 个图标)

### 2.3 文件浏览器（已在生产）

| # | 文件 | 行数 |
|---|---|---|
| 14 | `apps/desktop/src/renderer/shell/RightDock.tsx` | 1541 |
| 15 | `apps/desktop/src/renderer/shell/workspace-file-tree.ts` | 118 |
| 16 | `apps/desktop/src/renderer/shell/FileContentPreview.tsx` | 74 |
| 17 | `apps/desktop/src/renderer/shell/FileTypeIcon.tsx` | 186 |
| 18 | `apps/desktop/src/renderer/shell/review-view.ts` | 23 |
| 19 | `apps/desktop/src/renderer/shell/use-conversation-file-changes.tsx` | 163 |
| 20 | `apps/desktop/src/main/project-files.ts` | 135 |
| 21 | `apps/desktop/src/workspace-tools-contract.ts` | 80 |

挂载点：`ShellApp.tsx:3631-3675`（全窗格）+ `:4472-4495`（并排侧栏）
布局决策：`workspace-workbench.ts:329, 405`（`toggleWorkspaceFilesWorkbench`）

### 2.4 diff 体系（已在生产）

| # | 文件 | 关键导出 |
|---|---|---|
| 22 | `apps/desktop/src/renderer/shell/FileDiffSurface.tsx` | `FileDiffToolbar` / `FileDiffViewport` / `formatFilePatch` |
| 23 | `apps/desktop/src/renderer/shell/DeferredFileDiff.tsx` | `DeferredFileDiff` / `needsDeferredFileDiff` |
| 24 | `apps/desktop/src/renderer/shell/word-diff.tsx` | `diffWordSegments` / `wordHighlightMap` / `WordSegments` |
| 25 | `apps/desktop/src/renderer/shell/file-diff-reader.ts` | `fileDiffReader` / `validateFileDiffResponse` |
| 26 | `apps/desktop/src/renderer/shell/file-diff.css` | 皮肤（MIT，24 行 license 头） |
| 27 | `apps/desktop/src/renderer/shell/ExecutionProcessBlock.tsx` | `computeLineDiff` / `LineDiffView` / `countLineChanges` / `parseUnifiedDiff` |
| 28 | `apps/desktop/src/renderer/shell/code-highlight.ts` | `highlightCodeLines` / `languageFromPath` |
| 29 | `packages/shared/src/file-diff.ts` | **`projectFileDiffPage`**（服务端核心算法） |
| 30 | `packages/protocol/src/conversation-file-diff.ts` | IPC 类型 + 解析 |

外部依赖：`highlight.js@^11.11.1`（core + 36 语言手动注册）。**无 diff 算法库**。

### 2.5 请求池与分页（diff / 会话文件共用）

| # | 文件 | 关键常量 |
|---|---|---|
| 31 | `apps/desktop/src/renderer/shell/deferred-request-reader.ts` | `maxPending = 16` |
| 32 | `apps/desktop/src/renderer/shell/run-process-history-loader.ts` | 全局并发 **3** |
| 33 | `apps/desktop/src/renderer/shell/conversation-read-request-pool.ts` | 单例池 |

### 2.6 服务端「对话文件」目录

| # | 文件 | 关键内容 |
|---|---|---|
| 34 | `apps/runtime/src/conversation-file-changes.ts` | **version 哈希 + 去重 + 224KB 切片** |
| 35 | `packages/protocol/src/conversation-file-changes.ts` | payload/page 类型 + 校验 |
| 36 | `packages/storage/src/conversation-content-store.ts:371-431` | `captureRunDirectory` SQL |
| 37 | `apps/runtime/src/runtime.ts:9821-9891` | scope 解析 + 二次校验 |

---

## 3. IPC 通道契约（6 个）

| 通道 | payload | 返回 |
|---|---|---|
| `desktop:git-info` | `{root}` | `ProjectGitInfo` |
| `desktop:git-review` | `{root}` | `ProjectGitReview` |
| `desktop:git-checkout` | `{root, branch, strategy?}` | `ProjectGitCheckoutResult` |
| `desktop:git-create-branch` | `{root, branch}` | `ProjectGitActionResult` |
| `desktop:git-commit` | `{root, message, includeUnstaged, push}` | `ProjectGitCommitResult` |
| `desktop:git-push` | `{root}` | `ProjectGitPushResult` |

**默认值规约（易错）**：
- `strategy`：只认 `'stash'`/`'force'`，其余一律归一为 `'check'`
- `includeUnstaged`：`!== false`（缺省即 `true`）
- `push`：`=== true`（缺省即 `false`）

**错误策略**：payload 非法 → `throw`；Git 操作失败 → 返回 `{error}` 对象，**不抛异常**。唯一例外：`checkoutProjectBranch` 分支名非法时抛 `'git-checkout: invalid branch name'`。

---

## 4. 关键算法与常量

### 4.1 Git 后端

| 常量 | 值 | 位置 |
|---|---|---|
| `MAX_STATUS_FILES` | 100 | `project-git.ts:22` |
| `MAX_FILES_PER_COMMIT` | 100 | `:23` |
| `MAX_REVIEW_TEXT_BYTES` | 2 MiB | `:24` |
| `runGit` 默认 timeout | 20s（8s 查询 / 12s show / 60s commit+push） | `:29` |
| `maxBuffer` | 2 MiB | `:35` |

**`getProjectGitInfo` 并行 7 条命令**（`:175-184`）：
```
branch --show-current
branch --format=%(refname:short)
status --short --untracked-files=all
log -8 --name-status --format=%h%x00%s
diff --numstat HEAD --
remote
rev-list --left-right --count HEAD...@{upstream}
```
⚠️ `--left-right` 输出是 `<behind> <ahead>`，代码解构为 `[behindRaw, aheadRaw]` —— **别写反**。

未跟踪文件（`??`）额外用 `countUntrackedAdditions` 逐文件数行补进 `additions`。

### 4.2 三套 LCS（全部自研，无第三方库）

| 位置 | 规模上限 | 数据结构 | 平局策略 |
|---|---|---|---|
| 客户端行级 `computeLineDiff` | 400 行 | `Int32Array` | 取 `del` |
| 服务端分页 `projectFileDiffPage` | `oldCount*newCount ≤ 160000` | `Uint32Array` | 取 `del` |
| 词级 `diffWordSegments` | 400 token | `Int32Array` | 取 `del` |

三者都是**自底向上填矩阵 + 自顶向下回溯**。

**`projectFileDiffPage` 额外三步**（`packages/shared/src/file-diff.ts:80-203`）：
1. `split()` 同时产出 `values`(去 CR 行) 与 `starts`(UTF-16 偏移)
2. **双向前后缀剥离** → LCS 规模从全文件降到变更块
3. 预算超限 → `mode: 'replacement'`（整段替换，不做 LCS）
4. `offset` 默认 `max(0, prefix - 3)`（自动定位到变更点前 3 行）
5. `emit()` 必须为**每一行**调用（即使不落入当前页），否则 `totalRows/added/removed` 统计错误

### 4.3 diff 阈值常量总表

| 常量 | 值 | 位置 |
|---|---|---|
| 内联文本上限 | 8192 字符 | `file-diff.ts:38` |
| 客户端行数上限 | 400 | `ExecutionProcessBlock.tsx:824` |
| 词级 token 上限 | 400 | `word-diff.tsx:31` |
| LCS 预算 | 160000 | `file-diff.ts:121` |
| 单行截断 | 512 UTF-16（代理对安全） | `file-diff.ts:133` |
| 默认页 / 最大页 | 80 / 160 | `file-diff.ts:123, 188` |
| 续读阈值 | 距底 160px | `DeferredFileDiff.tsx:88` |
| 跟随阈值 | 距底 24px | `FileDiffSurface.tsx:1096` |
| 高亮文本上限 | 100k 字符 | `code-highlight.ts:166` |
| 队列上限 / 全局并发 | 16 / 3 | `deferred-request-reader.ts:19` / `run-process-history-loader.ts:60` |

### 4.4 会话文件目录（「对话文件」）

- **version 公式**：`sha256(JSON.stringify(['conversation-files-v2', scope, runs]))`
  - `runs` = 每个 run 的最新事件游标（`ORDER BY sequence DESC, id DESC LIMIT 1`）
  - 任一 run 新增事件 → version 必变 → 缓存失效
- **去重规则**：同 path 保留 `sequence` 最大者
- **排序**：path 字典序
- **切片**：`limit`(默认 40，上限 40) 与 **224KB** 双约束
- **`nextOffset` 双向约束**：未读完必等于 `offset + items.length`；读完必为 `undefined`
- **快照缓存**：`WeakMap<store, Map>`，key=`JSON.stringify(scope)`，LRU 8 项 / 16MB

---

## 5. 安全与防御（逐处照抄）

| 防御 | 位置 | 做法 |
|---|---|---|
| 目录穿越 | `project-git.ts:126-127, 151-152` | `path.resolve` 后校验 `startsWith(root + sep)` |
| 分支名注入 | `:162-167` | 拒绝空 / 拒绝 `-` 开头 / `git check-ref-format --branch` |
| 二进制检测 | `:114, 130, 222` | `buffer.includes(0)` 判定后跳过 |
| 截断 | `:66, 87-90, 194, 133, 225` | 行数/文本多重上限 |
| IPC 源校验 | `main/index.ts:2865` 等 | 每个 handler 首行 `assertRuntimeIpcSource(event)` |
| IPC payload 校验 | `main/index.ts:2866-2876` 等 | 逐字段类型检查，非法 throw |
| 路径穿越（文件树） | `workspace-file-tree.ts:83` | 过滤含 `..` 的节点 |

---

## 6. 复刻验收：测试契约

### 6.1 Git 后端（`project-git.test.ts`，4 例）
1. 返回 branch / worktree files / 真实行统计（未跟踪文件计入 additions）
2. created/edited/deleted 三类的前后内容快照
3. 创建+切换分支 + dirty 工作区闸门（check 拒绝 / stash 放行）
4. 提交未暂存更改并经 upstream 推送（含 bare remote 搭建）

临时仓库搭法：`mkdtempSync(os.tmpdir())` → `git init` → `config user.*` → 首次提交；`afterEach` 递归删除（Windows 上需 try/catch 容错）。

### 6.2 Git 面板 UI（`TaskStatusPanel.test.tsx`，11 例）
关键断言：
- 段顺序硬编码 `git → goal → progress`
- 挂载后 `getGitInfo` 恰好 1 次；`focus` 后 2 次；**断言 `setInterval` 从未以 5000ms 调用（禁止轮询）**
- 「更改」→ `getGitReview` + `onOpenReview`，**不弹本地对话框**
- 分支菜单 → `role=menu[name='Git 分支']`；点 `menuitem[name='main']` → `gitCheckout`
- 提交对话框 → `role=dialog[name='提交更改']`；`getByLabelText('提交信息')` 输入 → `gitCommit` 精确参数 `{includeUnstaged:true, push:false}`
- `isRepo:false` 且无 goal/todo → `container.firstChild === null`

### 6.3 源码文本契约（`task-status-contract.test.ts`）—— **挂载守卫**
- `ChatView.tsx` 中 `<ComposerTaskPanel` 恰好 1 处；**不得**含 `<TaskStatusPanel`
- `shell.css` 不得含 `.shell-todo-panel` / `.shell-task-status__changes-list`
- 段顺序：`title="Git 工具"` < `title="目标"` < `title="任务清单"`
- CSS 几何硬断言：`width: 320px`、`max-height: min(64dvh, 32rem)`、`top:16px right:16px`、`@container shell-chat (max-width: 1279px)`
- 该区间内**不得出现任何 `#rrggbb`**（必须全走 CSS 变量）

### 6.4 diff（4 个测试文件，23 例）
- `formatFilePatch` 期望精确字符串（路径用 `JSON.stringify` 加引号）
- ctx 行两侧换行状态不一致 → 拆成 `-`/`+` 对
- `DeferredFileDiff` scope 变化 → abort 在途请求且不绘制迟到页
- 词级：`foo(bar)` vs `foo(baz)` → 只标 `bar`/`baz`
- 服务端：10000 行改 1 行 → `{mode:'exact', offset:4997, added:1, removed:1}`
- reader 校验拒绝：`text.length=513`、`newLine=0`、`newOffset=-1`、`mode:'invented'`、`added:-1`

---

## 7. 复刻易错点清单（19 条）

1. `ahead`/`behind` 解构顺序（`--left-right` 是 behind 在前）
2. `parseStatus` 的 `.slice(0,100)` 在 `.map()` **之前**
3. `commit` 必须先 `add --all` 再 `diff --cached --name-only` 判空
4. `push` 无 remote 时用**本地合成** `stderr: '未配置 Git remote'`
5. `checkout` 分支名非法**抛异常**；`createBranch` 返回中文错误对象 —— 策略不同
6. `runGit` **永不 reject**，失败降级为 `ok:false`
7. `windowsHide:true` / `maxBuffer` / `cwd=root` 三者不可省
8. 相对导入统一 `../project-git-contract.js`（带 `.js` 后缀）
9. 自动补页**不得带 version**，否则长跑中列表永久截断在首页
10. `accumulateConversationFilePage` 在 `offset===0` 时整体替换
11. `emit()` 必须为每一行调用（含不在页内的）
12. `split()` 的 CR 处理与尾换行 pop
13. `formatFilePatch` 的 ctx 拆行 + 路径引号
14. `highlightCodeLines` 的 **span 栈平衡**（行尾补 `</span>`×栈深，行首重开）
15. `visitedPaths` + `expandedPaths` **双集合**，用 `hidden` 属性而非条件渲染（保滚动位置）
16. `DeferredFileDiff` 的 `key` 9 项 identity 重挂载
17. 单行懒读用 `beforeVersion`/`afterVersion`（**快照版本**）而非 `version`（**diff 页版本**）
18. CSS 引入顺序：`file-diff.css` 在 `shell.css` 主体**之前**（特异度决定 38px 列宽生效、`8ch` 不生效）
19. 列宽单位是 **`px`**（`38px 38px 20px 1fr`），前缀字符是 **U+2212 `−`** 而非 ASCII `-`

---

## 8. 建议的实施阶段（供决策）

| 阶段 | 内容 | 前置 |
|---|---|---|
| P0 | 决策：挂载守卫如何处理（见结论 2） | 需你拍板 |
| P1 | 后端 6 通道 + 契约 + 测试（已在仓库，仅需确认可用） | — |
| P2 | 把 `TaskStatusPanel` 挂到生产入口 | P0 |
| P3 | 处理 `task-status-contract.test.ts` 的守卫断言 | P0 |
| P4 | CSS 随挂载点补全（`@container shell-chat` 需宿主带 `container-type: inline-size`） | P2 |
| P5 | 运行 `TaskStatusPanel.test.tsx` + 契约测试验收 | P2 |

---

## 附：可安全忽略项（避免白做）

- `evaluatorConfigured` prop —— 已死参数，声明但从未读取
- `.shell-task-status__empty` / `__goal-note` —— 有样式无 JSX
- `ProjectGitReviewFile.previousTruncated`、`ProjectGitCheckoutResult.stashed`、`strategy:'force'` —— UI 从不使用
- `ReviewPanel` 列表项**没有** `data-path`（`RightDock.test.tsx:263,266` 的对应断言当前应为红）
- `RightDock.tsx` 顶部「Git 面板」注释 —— 过时，该文件无 Git 面板

---

# 9. 挂载方案：把 Git 面板接到工作台（已确认路径）

**决策**：照抄现状 + 挂到工作台。即不碰 `ChatView.tsx`、不改 `task-status-contract.test.ts` 守卫，改为在工作台新增一种 `git` tab 类型。

## 9.0 为什么这条路不违反设计

`task-status-contract.test.ts` 守卫的是「`ChatView.tsx` 不得含 `<TaskStatusPanel`」，它**不管工作台**。而工作台本身就是 NewMax 的右侧资源容器（已承载文件浏览器/浏览器/终端/对话/审阅 5 种 tab），把 Git 面板作为第 6 种资源接入，与既有架构完全一致。

`TaskStatusPanel` 自带 `refreshGit()` 并通过 `window.syncThink?.runtime.getGitInfo` 自取数据（`:769-779`），**不需要 tab 层注入任何 Git 数据**，只需传 `projectFolder`。这是它能优雅接入的前提。

## 9.1 工作台数据模型（复刻基线）

```ts
// workspace-workbench.ts:10-35
export type WorkbenchPlacement = 'right' | 'bottom';
export type WorkbenchTab =
  | ConversationPaneTab | FilePaneTab | TerminalPaneTab
  | BrowserPaneTab | ReviewPaneTab | WorkspaceFilesPaneTab;

export interface WorkbenchScope {
  open: boolean; size: number; tabs: WorkbenchTab[];
  activeTabId?: string; fileBrowserOpen: boolean; fileBrowserWidth: number;
}
export interface WorkspaceWorkbenchLayout {
  version: 1; right: WorkbenchScope; bottom: WorkbenchScope;
}
```

| 常量 | 值 |
|---|---|
| `WORKBENCH_RIGHT_COMPACT_WIDTH` | 330 |
| `WORKBENCH_RIGHT_PREVIEW_WIDTH` | 713 |
| `WORKBENCH_FILE_BROWSER_WIDTH` | 288（min 221 / max 600） |
| `MAX_WORKBENCH_TABS` | 50 |
| 持久化 key | `sync-think.workspaceWorkbenchLayouts`（`ui-preferences.ts:97-98`） |

## 9.2 新增 `git` tab 的精确改动清单

### A. `apps/desktop/src/renderer/shell/pane-layout.ts`
| # | 位置 | 必改 | 内容 |
|---|---|---|---|
| A1 | `:40` 后（紧邻 `ReviewPaneTab`） | ✅ | 新增 `export interface GitPaneTab { id: 'git'; type: 'git'; }` |

> `WorkspacePaneTab`(`:42-43`)、`tabResourceKey`(`:153-160`)、`parseWorkspacePaneLayout`(`:1420-1461`) **均不用改** —— 那是主窗格 pane 系统，`workspace-files` 同样不在其中。

### B. `apps/desktop/src/renderer/shell/workspace-workbench.ts`
| # | 位置 | 必改 | 内容 |
|---|---|---|---|
| B1 | `:1-8` | ✅ | import `GitPaneTab` |
| B2 | `:12-18` | ✅ | `WorkbenchTab` 联合追加 `\| GitPaneTab` |
| B3 | `:105-151` `normalizeWorkbenchTab` | ✅ **最关键** | 加 `if (record.type === 'git') return { id: 'git', type: 'git' };` |
| B4 | `:405-407` 旁 | ✅ | `export function gitWorkbenchTab(): GitPaneTab { return { id: 'git', type: 'git' }; }` |
| B5 | `:234-236` | ⚠️ 决策 | 若仅允许右侧，仿 `workspace-files` 重定向 |
| B6 | `:162` | ⚠️ 决策 | 同 B5，bottom 恢复时过滤 |
| B7 | `:244-251` | ⚠️ 决策 | 打开 git tab 时是否自动补 `workspace-files`（参照 browser 的排除写法） |
| B8 | `:252-257` | ⚠️ 决策 | 尺寸按 compact(330) 还是 preview(713) 打开 |
| B9 | `:294-297` | ⚠️ 决策 | 「仅剩 git tab」时是否回 compact |
| B10 | `:335` | ⚠️ 决策 | `toggleWorkspaceFilesWorkbench` 的 `resources` 会把 git 计为资源，影响 Files 按钮行为 |

### C. `apps/desktop/src/renderer/shell/WorkspaceWorkbench.tsx`
| # | 位置 | 必改 | 内容 |
|---|---|---|---|
| C1 | `:100` 兜底前 | ✅ | `if (tab.type === 'git') return 'Git';`（否则标签显示「工作区文件」） |
| C2 | `:146` 兜底前 | ✅ | `if (tab.type === 'git') return <GitBranch size={14} />;` |
| C3 | `:43-49` | ⚠️ 若加菜单入口 | `WorkbenchNewResource` 追加 `\| 'git'` |
| C4 | `:556-594` | ⚠️ 若加菜单入口 | 加 `<button role="menuitem">` |
| C7 | `:507-519` | ⚠️ 决策 | 是否显示关闭按钮 |

> C8（`:673-697` 主区渲染）**不用改** —— git tab 走 `:693` 的通用分支 `activeTab && activeTab.type !== 'browser'`。

### D. `apps/desktop/src/renderer/shell/ShellApp.tsx`
| # | 位置 | 必改 | 内容 |
|---|---|---|---|
| D1 | `:3694` browser 兜底 return **之前** | ✅ **编译期强制** | `if (tab.type === 'git') return <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"><TaskStatusPanel projectFolder={activeProjectFolder} /></div>;` |
| D2 | `:275-302` | ✅ | import `gitWorkbenchTab` |
| D3 | import 区 | ✅ | `import { TaskStatusPanel } from './TaskStatusPanel.js';` |
| D4 | `:1433` 附近 | ✅ | 新增 `handleOpenGitInWorkbench(placement)` |
| D5 | `:1405-1431` | ⚠️ 若加菜单入口 | 加 `resource === 'git'` 分支（**必须前置返回**，否则被 `:1426` 的 browser 兜底吞掉） |

**最小必改集**（功能跑通、不加菜单入口，共 10 处）：
```
A1 → B1 → B2 → B3 → B4 → C1 → C2 → D1 → D2 → D3
```

## 9.3 两个致命陷阱（务必单独验证）

| 陷阱 | 后果 | 位置 |
|---|---|---|
| **B3 漏改** `normalizeWorkbenchTab` | tab **完全打不开**（`openWorkbenchTab` 因 `normalized === null` 直接返回原 layout，`:232-233`） | `workspace-workbench.ts:105-151` |
| **D1 漏改** browser 兜底 | **直接编译失败**（`tab` 在兜底处被窄化为 `never`，访问 `tab.browserId` 报错）；即使绕过编译也会渲染出坏掉的 BrowserPanel | `ShellApp.tsx:3694` |

还要注意：`tabLabel`(`:99-100`) / `WorkbenchTabIcon`(`:146`) 的兜底会把未识别类型显示为**「工作区文件」+ 文件图标** —— 静默错误，不会报错，只能靠肉眼或测试发现。

## 9.4 挂载所需的样式约定

工作台内容容器统一使用：
```
className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
```
（见 `ShellApp.tsx:3574, 3584, 3690` 与 `WorkspaceWorkbench.tsx:694`）

Git 面板外层必须套这个容器，否则高度/滚动异常。

另外 `shell.css` 的 `@container shell-chat (max-width: 1279px)` 断点要求宿主带 `container-type: inline-size; container-name: shell-chat`。工作台侧若不带这个 container，面板不会进入窄屏降级（mini 胶囊）形态 —— 需要确认或补上。

## 9.5 验收：新增 tab 类型后必须跑的测试

| 文件 | 需补的用例 |
|---|---|
| `workspace-workbench.test.ts` | `gitWorkbenchTab` 打开 / 去重 / 持久化往返 / placement |
| `WorkspaceWorkbench.test.tsx` | 标签名「Git」+ GitBranch 图标 + 关闭按钮 |
| `ShellApp.test.tsx` | localStorage 中 `right.tabs` 含 `{id:'git',type:'git'}` |
| `TaskStatusPanel.test.tsx` | 保持全绿（不应受影响，因未动 `TaskStatusPanel.tsx`） |
| `task-status-contract.test.ts` | **保持全绿**（这是选择本方案的核心收益） |
