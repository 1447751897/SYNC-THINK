# 会话通知与待处理状态验收

## 本次行为

- 普通模型会话进入挂起问询时显示“等你回答”，工具／计划审批显示“等你审批”，桌面交接显示“等你处理”。
- 等待用户的请求优先于“运行中”动效和完成未读标记。
- 在另一个会话、项目或页面时，应用内显示带“去回答／去处理／查看”动作的提示；不自动切换会话。
- 窗口在后台、最小化或隐藏到托盘时，主进程发送系统通知；点击通知才显示窗口并打开对应会话。
- 顶部“待处理”聚合所有项目的等待请求和执行失败。打开会话、关闭提示都不等同于回答／批准。
- “任务完成时提醒”默认开启，“系统通知声音”默认关闭，偏好保存在本机。问询与执行失败保持提醒。
- 历史事件回放不弹旧通知；重连不重复提醒同一请求。主进程驱动后台通知，不依赖隐藏窗口的动画帧。

## 启动当前改动

在 `D:/projects/SYNC-THINK` 中运行：

```powershell
pnpm dev:desktop --renderer-development
```

先退出已有开发实例再启动新实例。关闭窗口若只是隐藏到托盘，请从托盘菜单退出。此改动包含主进程和预加载脚本，仅刷新旧窗口不会加载新的原生通知桥接。

当前开发版主进程、预加载和界面已构建。若在另一台机器或后续改动后重新验收，先运行：

```powershell
pnpm --filter @sync-think/desktop exec tsc -p tsconfig.json
node apps/desktop/scripts/build-preload.mjs
pnpm --filter @sync-think/desktop build:shell:dev
```

当前生产包体检查存在整体超限；对照禁用通知模块也超限。本次保留了原来的体积限制，未发布新安装包。

## 手动验收

### 1. 跨会话问询（最重要）

准备会话 A、B。A 选择支持 `ask_user_question` 的模型／内核，发送：

> 请先通过终端等待 8 秒，再调用 ask_user_question，问我选择方案 A 还是方案 B。在我回答之前保持等待，回答之后再回复“问询测试完成”。

立即切换到 B。

预期：

- 不自动跳回 A。
- A 的侧栏显示“等你回答”，不再显示运行中动效。
- 出现“等你回答”的应用内提示及“去回答”按钮。
- 顶部“待处理”数量增加。
- 关闭提示后，“待处理”和侧栏等待标记仍保留。
- 点击“去回答”或待处理条目返回 A，问询卡片仍等待作答。
- 实际回答后待处理条目消失；未结束的运行恢复运行状态。

注意：纯文本“你选哪一个？”不属于挂起问询。这个测试需要真实调用问询工具。

### 2. 跨项目回跳

在项目 A 的会话触发相同问询，然后切到项目 B。

预期：顶部待处理仍包含项目 A 的条目；点击后切回正确的项目与会话，而非只打开当前项目中的同名会话。

### 3. 后台系统通知

重复测试 1，但发送后将应用最小化或切到其他应用。

预期：收到“等你回答”的系统通知；窗口保持在后台；点击通知才显示窗口并返回 A。Windows 的通知开关和勿扰设置也会影响系统横幅展示。

此项需在本机系统通知环境中手动验证。自动化覆盖原生通知驱动、点击回跳回调与后台事件处理，不代表已操作过 Windows 系统横幅。

### 4. 完成提醒与偏好

在 A 发送：

> 请先通过终端等待 8 秒，再只回复“通知测试完成”。

- 留在 A：正常出现最终回答，不额外弹完成提示。
- 立即切到 B：出现“任务已完成”的应用内提示，点击“查看”回到 A。
- 将应用最小化：出现完成系统通知，点击查看结果。
- 在顶部“待处理”中关闭“任务完成时提醒”后重试：完成提示停止；再次测试问询时仍提示。
- 打开“系统通知声音”后重试后台通知：请求使用有声通知，实际声音遵循操作系统设置。
- 关闭偏好再刷新界面：偏好应保留。

### 5. 审批、重连与清理

- 在规划模式下提交计划：显示“等你审批”，即使规划这一轮已结束也仍保留；审批或取消后清除。
- 在需要确认的执行权限下触发工具审批：切到另一个会话后出现“去处理”，审批后标记清除。
- 请求等待时刷新界面或重连 Runtime：待处理状态从 Runtime 恢复，不重弹旧通知。保持 Runtime 和请求仍有效，不退出或取消正在运行的任务。
- 主动取消普通问询的运行：对应等待条目清除，不发送“任务已完成”通知。
- 执行失败：显示失败提醒和待处理项；查看后清除。重新运行时不把上一次失败显示成当前运行状态。

## 自动回归

```powershell
pnpm --filter @sync-think/desktop typecheck
pnpm --filter @sync-think/desktop exec vitest run src/conversation-attention.test.ts src/conversation-notification-contract.test.ts src/main/conversation-notifications.test.ts src/main/electron-conversation-notification-driver.test.ts src/main/conversation-ask-handlers.test.ts src/renderer/conversation-activity.test.ts src/renderer/shell/use-conversation-notices.test.tsx src/renderer/shell/use-conversation-attention-recovery.test.tsx src/renderer/shell/conversation-notification-preferences.test.ts src/renderer/shell/ConversationAttentionCenter.test.tsx src/renderer/shell/ConversationAttentionController.test.tsx src/renderer/shell/ConversationTabs.test.tsx src/renderer/shell/Sidebar.test.tsx src/renderer/shell/TopBar.test.tsx src/renderer/shell/AgentWorkspace.test.tsx src/renderer/shell/ShellApp.test.tsx --testTimeout=15000
```
