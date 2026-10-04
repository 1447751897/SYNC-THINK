# 群聊浏览器 Profile、流程复用与监控：修复及验证记录

## 当前状态

**本轮核心链路已修改、完成构建，并通过隔离验证；尚未替换正在运行的旧 Runtime。**

旧 Runtime（只读核对时 PID 62364）有一个会话停在 `ask_user_question`，等待用户回答，runId 为 `5ADC1WZ8NHSWRR4DRVB8KGSEZY`。为了保留问询卡及原执行现场，本轮没有执行运行时关闭、强杀或全应用重启。应先回答或取消该问询，再切换新构建。生产数据库的 0065 迁移也留待正常启动应用。

测试均使用隔离 SQLite 数据库、测试 Profile 和本地登录平台；没有修改用户既有定时任务、创建生产测试监控、清理用户 Cookie，或唤醒已暂停的小说群。

## 已打通的链路

- **群聊 → Browser Profile**：群聊独立选择账号。普通聊天、Native 执行、外部内核网页权限检查和实际浏览器执行使用一致的宿主选定 Profile；模型不自选或拼接账号标识。
- **群聊 → 已发布操作流程 → 参数**：同一账号的成熟流程可绑定到群聊。关键词以参数传入，衬衫切换为裤子时复用同一发布版本，不重新生成另一条流程。操作步骤成功不代表群目标验收完成。
- **群聊 → 登录接力 → 原任务续做**：工作成员遇到登录、验证码或设备确认时可请求人工接力。持久化当前群、任务、尝试、目标版本和账号，展示登录卡，结束当前受阻尝试但保留页面。继续操作重试同一原任务；按钮本身不证明登录完成，仍须重新读取真实页面。
- **群聊 → 定时监控 → 同群工作队列**：表单创建的监控绑定当前群；模型定时工具在可用的群聊执行上下文中也绑定宿主确认的群和工作区。没有新建旧式 Team Run 或第二个任务聊天。私聊旧定时任务路径保持兼容。
- **权限区分**：网页操作遵循群聊执行模式和联网开关；完全访问可自动批准普通网页操作。平台登录、验证码、设备确认仍由用户在该 Profile 浏览器中完成。定时流程含秘密输入步骤时保持人工执行限制；普通持久参数拒绝 password、cookie、token、secret 等字段名。

## 发现并修复的实际问题

1. **Chrome 登录态重启后丢失**：真实 Chrome 测试首次复现。关闭代码发出 Browser.close 后立刻终止进程，抢在 Profile 落盘之前结束 Chrome。现在先等进程正常退出，超时才执行兜底终止；没有另存 Cookie 明文。修复后重建 BrowserHost 仍保持登录。
2. **外部内核网页审批使用默认账号**：实际执行选择群 Profile，但权限检查未携带同一 Profile。补齐该字段并加入针对外部执行入口的回归。
3. **模型创建监控丢失群和工作区**：旧工具总是创建独立任务会话。现在从可信执行上下文绑定当前群，限制群内列表和取消范围，防止取消其他群的监控。
4. **点击“继续”被误当作已经登录**：继续后重新读取页面；仍是登录墙时再次请求接力，不提交成功状态。
5. **切群残留旧监控目标**：已用失败用例复现，切群时重置目标、间隔、监控列表和错误状态，并重新读取绑定流程。
6. **登录状态读取失败静默消失**：已用失败用例复现，现在显示连接错误及重试入口。
7. **100 条历史后的重复成功记录**：已通过插入 110 条后续跳过历史复现。改为数据库精确查询当前轮终态，不以 UI 的最近历史分页窗口做防重。
8. **入队、跳过、执行和验收混淆**：监控入队不记成功；忙、暂停或等登录时合并跳过，并推进下次触发时间；已入队的一轮仍可在监控开关关闭后记录结果。群聊验收与运行结果保持区分。

## 自动化回归结果

相关目标测试共 **443 个通过、0 个失败**：

- Runtime：256（17 个测试文件，含群聊集成、Browser、调度、恢复、外部内核工具目录）。
- Desktop 目标回归：58（5 个文件，含新群设置、已有聊天、登录卡和浏览器面板）。
- Protocol：15。
- Storage：75（含旧数据库迁移、浏览器数据、定时历史）。
- Workers：39（含 Chrome 正常退出和超时兜底）。

重点场景包括：账号 A/B 隔离、丢失 Profile、同发布版本的不同关键词、缺参数与敏感参数、网站授权缺失、过期流程版本、登录接力冷恢复、重复继续幂等、未登录就继续、变更目标或账号导致旧接力失效、明确暂停、取消接力、忙时合并、跨工作区拒绝、跨群取消拒绝、长期历史防重，以及只讨论时不执行绑定流程。

## 真实浏览器验证

使用已安装的 Google Chrome 和生产 BrowserHost/BrowserWorkflowRunner/Storage 实现，**8 个场景通过**：

- 首次进入需要登录。
- 在账号 A Profile 登录。
- 同一发布流程搜索衬衫。
- 同一发布版本搜索裤子。
- 同一 Profile 的两个群 owner 并发使用独立标签页，搜索上下文没有串页。
- 关闭浏览器、重建 BrowserHost 后继续使用登录态。
- Profile B 未继承账号 A 登录。
- 登录失效后从实际页面重新识别登录墙。

测试平台仅触发一次登录；关键词切换和重建 Host 没有重复登录。平台是本地受控样本，不是抖音，测试中没有真实账号、真实热榜或真实验证码。

## 实际渲染组件验证

Browser plugin not available；使用工作区已有 Playwright-core 和安装的 Chrome，没有安装新的浏览器依赖。

实际产品 GroupBrowserSettings/GroupBrowserHandoffs 组件在隔离 UI 入口中完成 **11 个交互检查**：页面身份与非空渲染、当前群登录卡隔离、参数变更、无效监控间隔、监控同群归属、暂停监控、切群目标隔离、接力 ID 对应、换账号清除旧流程、窄屏无横向溢出、控制台无相关错误。

这部分 RPC 为测试边界替身，属于组件浏览器验证，不宣称已经在正在运行的生产 Electron 窗口中验收新版本，也不宣称抖音真实账号端到端任务已完成。

## 构建与证据

Shared、Protocol、Storage、Workers、Runtime 构建通过；Desktop 类型检查及完整构建通过。构建期间一次设计目录文件写入出现瞬时系统错误，重试后成功。未提交、拉取、重置或覆盖已有 Git 工作。

测试日志和本轮增量补丁目录：`C:/Users/zhuzhenyu/.codex/visualizations/2026/09/29/01a0eba8-16ae-7d11-9995-6e7f3aeaceb1/group-browser-automation-20261001`。

- Runtime：`C:/Users/zhuzhenyu/.codex/visualizations/2026/09/29/01a0eba8-16ae-7d11-9995-6e7f3aeaceb1/group-browser-automation-20261001/runtime-regression.json`。
- Desktop：`C:/Users/zhuzhenyu/.codex/visualizations/2026/09/29/01a0eba8-16ae-7d11-9995-6e7f3aeaceb1/group-browser-automation-20261001/desktop-targeted-regression.json`。
- Protocol / Storage / Workers：同目录对应 `*-regression.json`。
- Chrome：`C:/Users/zhuzhenyu/.codex/visualizations/2026/09/29/01a0eba8-16ae-7d11-9995-6e7f3aeaceb1/group-browser-automation-20261001/real-browser-profile-results.json`。
- UI：`C:/Users/zhuzhenyu/.codex/visualizations/2026/09/29/01a0eba8-16ae-7d11-9995-6e7f3aeaceb1/group-browser-automation-20261001/ui-browser-results.json`。
- 本轮补丁及工作树基线：`C:/Users/zhuzhenyu/.codex/visualizations/2026/09/29/01a0eba8-16ae-7d11-9995-6e7f3aeaceb1/group-browser-automation-20261001/本轮变更.patch`、`C:/Users/zhuzhenyu/.codex/visualizations/2026/09/29/01a0eba8-16ae-7d11-9995-6e7f3aeaceb1/group-browser-automation-20261001/working-tree-baseline.json`。

## 扩大检查发现的既有目录缺口

额外执行组件文档目录测试，发现 **1 个失败检查**：22 个已有组件尚未登记 live preview，导致“全部当前组件均有预览”的断言失败。新增 GroupBrowserAutomation 已补齐分类和预览登记；其余既有缺口未在本轮浏览器协作改造中处理。完整扩大检查结果保留在 `C:/Users/zhuzhenyu/.codex/visualizations/2026/09/29/01a0eba8-16ae-7d11-9995-6e7f3aeaceb1/group-browser-automation-20261001/desktop-regression.json`，没有把该失败计入上面的 443 个通过用例。

此项是组件展示/文档覆盖缺口，不是网页运行或群任务调度失败；本轮不声称整个仓库所有测试通过。

## 本轮边界与下一步

本轮实现的是 **已发布流程的受控复用**，不是自动从每轮轨迹提炼、回归并发布新版流程的连续“自进化”。现有录制、草稿和发布审核继续保留；自动学习草稿及版本升级需要后续独立接通，且应先回归再发布，避免把临时错误动作固化到长期监控。

## 新版本启用后的人工验收

1. 群聊 → 会话成员：选择执行权限、开启联网、绑定要使用的 Browser Profile。
2. 有成熟流程时绑定同账号已发布流程，并填写 keyword 等参数；没有成熟流程时先正常执行/录制验证，再发布复用版本。
3. 用同一群先查衬衫再查裤子，检查真实结果、独立交付物和同一流程版本；不要只看“步骤已完成”。
4. 用单独测试账号/Profile 验证登录提醒：先点继续但不登录，应再次受阻；登录后再继续，应重试原任务。不要清理日常生产账号登录态来测试。
5. 在本群设置 5 分钟以上监控间隔，检查结果仍归本群；任务忙或等登录时不重复堆任务；暂停监控不会新建另一个聊天。
6. 切到另一个群，确认账号、目标、监控列表和登录卡都不串。原目标或 Profile 变更后，不应继续旧登录接力。
