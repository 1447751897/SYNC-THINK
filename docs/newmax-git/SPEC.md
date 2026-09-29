# NewMax Git 工具 — 逆向规格

> 来源：`D:/tools/newmax/resources/app.asar`（NewMax 独立应用，非 SYNC-THINK）
> 提取方式：解析 asar 头部文件表 → 按字节偏移读取目标文件 → 提取 i18n 对象
> 完整文案：`docs/newmax-git/i18n.json`（134 分组 / 217 条）
> 原始提取物：`.nm-out/`（重建期参考，收尾清理）

## 0. 关键约束（先读）

- **NewMax 无自己的 source map**：其 `out/` 下 47 个 `.map` 全属 node_modules 第三方包。应用代码经压缩混淆，**无法还原源码**，只能按契约与行为重写。
- **NewMax 的样式几乎全是 Tailwind 工具类**（类名前缀 TOP：`w/h/bg/border/gap/rounded/flex`），语义化 Git 类名只有 `.diff-insert` / `.diff-delete` / `.diff-equal`。所谓「UI 视觉照搬」= 照搬其**布局结构与文案**，并用 Tailwind 重表达；无法复制其精确像素样式。
- 因此本文档的可靠性分级：**IPC 契约与文案 = 高**（直接提取）；**UI 结构与交互 = 中**（从文案与分组反推）；**精确样式 = 低**（不可得）。

## 1. IPC 通道契约（31 个，直接提取自 preload）

```
git:status            git:changed         git:watch           git:unwatch
git:branches          git:checkout        git:createBranch
git:stage             git:unstage         git:discard
git:commit            git:commitDetail    git:commitFileDiff  git:undoCommit
git:log               git:fileDiff        git:fileLines
git:merge             git:mergePreview    git:abortMerge
git:pull              git:push            git:fetch
git:worktrees         git:addWorktree     git:removeWorktree
git:avatar            git:readIdentity    git:writeIdentity
git:githubLoginStart  git:githubLoginCancel  git:githubLoginState
git:githubLoginOpenPage  git:githubLoginChanged
gitBash:detect        gitBash:install     gitBash:installProgress
gitBash:autoInstalled gitBash:autoInstallFailed
```

对比 SYNC-THINK 现有 6 个（`desktop:git-info/review/checkout/create-branch/commit/push`）
—— 缺 **25 个**能力。

## 2. UI 结构（从 i18n 分组反推）

```
Git 面板
├── 顶部横幅 banner
│   ├── 当前分支 {{branch}} / 游离 HEAD / 基于 {{branch}} 的游离 HEAD · {{sha}}
│   ├── 领先远程 {{ahead}} 个提交，落后 {{behind}} 个提交
│   ├── {{count}} 个未提交 → 查看未提交改动
│   └── operation：合并中 / 变基中 / 拣选中 / 回退中 / 二分查找中
├── 分支菜单 branchMenu（38 条）
│   ├── 搜索 {{repo}} 的分支
│   ├── 分组：默认分支 / 最近分支 / 其他分支
│   ├── 新建分支…（createFromQuery / createPlaceholder）
│   ├── 脏切换确认：有改动会被目标分支覆盖 → 暂存改动并切换
│   └── mergeInto：选择分支合并到 {{branch}}…
├── worktree 选择器 worktree（23 条）
│   ├── 工作在：{{target}} / Local / 本地 worktree
│   ├── 新建本地 worktree（首条消息发出时复制一份并行工作）
│   └── 移除：{{count}} 个未提交改动会丢失 / 同时删除分支
├── Git 身份 identity*（11 条）：本地 / 全局 / 姓名 / 邮箱 / 保存 / 需重启
├── GitHub 授权 github*（14 条）：连接 / 设备码流程 / CLI 缺失 / 头像提示
└── 两个 Tab
    ├── tabChanges「改动」：{{count}} 个文件
    │   ├── 筛选：本对话 (filterConversation) / 全部 (filterAll)
    │   ├── 区块：已暂存 (sectionStaged) / 变动 (sectionChanges) / 冲突 (sectionConflicted)
    │   ├── 分组：冲突 / 已暂存 / 改动 / 未跟踪
    │   ├── 类型：已修改 / 新增 / 已删除 / 重命名 / 未跟踪 / 冲突
    │   ├── 操作：暂存 / 取消暂存 / 全部暂存 / 全部取消暂存
    │   └── 丢弃：discard / discardAll（含确认）
    └── tabHistory「历史」
        ├── lastCommit / undoCommit / unpushed
        ├── commitDetail / commitFileDiff
        └── noHistory / time
└── 提交区
    ├── summaryPlaceholder / descriptionPlaceholder
    ├── commitTo：提交到 {{branch}}
    ├── commit / commitWithCount「提交 {{count}} 个文件」/ stageAllAndCommit
    └── commitConflicts / commitDuringOperation / commitNothingStaged
└── 同步区
    ├── push / pull / fetch / forcePush
    ├── lastFetched / lastFetchedTime / neverFetched / syncUpToDate
    ├── publishBranch / publishNeedsBranch / noRemote
    ├── pullDirtyTitle + pullDirtyDescription → stashAndPull
    └── pushRejectedTitle + pushRejectedDescription → pullThenPush
└── 合并冲突
    ├── mergeConflictsTitle / mergeConflictsDescription / conflictCount
    ├── conflictResolved / conflictManual / viewConflicts
    ├── commitMerge / abortMerge / abortMergeSuccess / mergeCommitSuccess
    └── pullMergeConflictStashKept / pullStashPopConflict
└── 其它：openTerminal / refresh / emptyTitle / emptyHint / loadingDiff / failed
```

## 3. 关键交互流程（含原文文案）

### 3.1 脏工作区切换分支
> `dirtyTitle`: 有改动会被目标分支覆盖
> `dirtyDescription`: 切换到 {{branch}} 会覆盖以下 {{count}} 个文件的未提交改动。可以先暂存（git stash）再切换，切换完成后自动恢复到新分支上。
> `dirtyMoreFiles`: …等 {{count}} 个文件
> `stashAndSwitch`: 暂存改动并切换
> **stash 恢复冲突**：`stashPopConflict`: 已切换到 {{branch}}，但恢复暂存的改动时发生冲突，改动仍保留在 git stash 里，请在终端执行 git stash pop 处理。

### 3.2 拉取时工作区脏
`pullDirtyTitle` / `pullDirtyDescription` → `stashAndPull`

### 3.3 推送被拒
`pushRejectedTitle` / `pushRejectedDescription` → `pullThenPush`

### 3.4 强制推送（3 步确认）
`forcePush` → `forcePushWarning` → `forcePushConfirmTitle` / `forcePushConfirmDescription` / `forcePushConfirm`

### 3.5 GitHub 授权（设备码流程）
`githubConnect` → `githubAuthorizing` → `githubDeviceInstruction`（在打开的 GitHub 页面输入以下验证码）
→ `githubCopyCode` / `githubOpenPage` → `githubConnected`
失败态：`githubAuthFailed` / `githubAuthTimeout` / `githubCliMissing` / `githubInstallCli` / `githubBrowserFailed` / `githubCopyFailed`
**注意**：`githubAvatarHint`: 头像未显示？可连接 GitHub —— 该授权**兼作头像来源**。

### 3.6 worktree 移除
`removeDirty`: 这棵树里还有 {{count}} 个未提交改动，移除后会丢失。
`removeDeleteBranch`: 同时删除分支 {{branch}}（未合并的提交会丢失）
`removeConfirm` / `removing` / `removed` / `removeFailed`

### 3.7 Git 身份
`identityHint` / `identityLocal` / `identityGlobal` / `identityLocalHint` / `identityGlobalHint`
`identityName` / `identityEmailLabel` / `identitySaving` / `identitySave` / `identityCancel`
`identityRestartRequired` / `identityReadFailed` / `identityWriteFailed`

## 4. 重建注意事项

1. **删除范围**：本次为「删干净再重建」，需先移除 SYNC-THINK 原有 6 通道后端、`GitToolsSection`/`CommitDialog`/`DirtyCheckoutDialog`、以及先前接入的工作台 Git 页签。
2. **`docs/newmax-git/i18n.json` 应作为文案唯一来源**，重建时建议直接生成 i18n 常量文件，避免手抄错漏。
3. **样式用 Tailwind 重表达**，不要试图复制 NewMax 的压缩 CSS。
4. **`git:watch` 是性能关键**：NewMax 用文件监听代替轮询；旧实现用 window focus 刷新。
5. **`git:changed` 与 `git:status` 分离**：前者疑为轻量变更摘要（用于横幅），后者为完整状态。
6. **`gitBash:*` 独立通道**：Windows 上 NewMax 会检测/自动安装 Git Bash——重建时需决策是否保留该能力。
