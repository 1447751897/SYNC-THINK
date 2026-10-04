# 自动化 Runtime 修复与真实回归（2026-10-02）

## 本次结果

本次修复执行链，不再重做定时任务页面。保留此前恢复的日历页面。

- Runtime 构建通过（Node 20.20.2）。新版已在独立测试实例加载。
- 最终定向回归：13 个测试文件，280/280 通过，0 失败、0 跳过。
- 使用已配置的 DeepSeek 模型进行了真实推理；浏览器执行真实页面交互，Office 文件真实写入，MCP 通过本地 HTTP 传输收到真实附件。
- 实际平台登录、抖音数据和真实 Gmail 发送不在本次通过范围；本次使用 localhost 合成数据、无密码模拟登录和仅接收 qa@example.test 的测试收件箱。
- 正式实例 dev-0001 仍有两个运行中的任务，保持原进程，没有取消、暂停、唤醒或重启用户任务。正式实例仍需在这些运行结束后重启加载新版。

## 修复内容

### 1. 小队定时任务的写入权限和文件合同

现象：自动任务配置为 workspace，成员 writePolicy=inherit，却收到 collaboration.file_delivery_readonly。

原因：小队 Host 的资源声明读取持久化群聊的 ask 模式，而执行器使用本轮冻结的自动任务模式，两者不一致。另一个问题是文件生成工具始终写入自动任务目录，未遵循子任务约定的相对文件路径。

修复：

- 将已校验的本轮模式提供给 Host，不修改持久化群聊的权限。
- 校验群聊、工作区、派工来源和目标版本；历史任务或其他群聊不继承这次能力。
- Agent 显式 read-only、ask、等待登录和计划模式的限制仍保留。
- 文件型交付遵守约定路径，并检查文件名、路径边界、真实字节和哈希。

真实重试：协调员实际派给数据整理员，成员生成 sales-team.xlsx，三项数值 12/8/5，合计 25；提交回执与独立读回均通过。完成派工不自动等同于群聊业务目标已由用户验收。

### 2. 模型重复读取附件的工具浪费

现象：已生成 XLSX/PPTX 后，模型连续读取文件小片段，尝试自己拼接 base64，导致任务长时间卡在发邮件之前。

修复：邮件交付合同明确说明由宿主读取本轮已验证文件并绑定真实附件；模型使用发送工具而不是自行读取、编码或拼接二进制。宿主原有的文件和发送 receipt 验证保持不变。

真实重试：模型、单个 Agent、小队三个执行者均完成浏览器 → XLSX/PPTX → MCP 本地邮件。三个实际发送回执、六份附件的大小和 SHA-256 与生成文件一致。

### 3. 等待登录时隐藏的 Provider 上下文错误

现象：等待登录正确封禁工具，但 context source 仍把邮件工具标为 included。严格校验报 included source is absent from provider payload，最终状态又被等待登录原因覆盖。

修复：构造上下文时对 provider tools 和 sources 应用同一实际工具门控；没有削弱 included source 的严格校验。登录回归加入“主动等待及恢复期间没有隐藏 Provider 错误”的断言。

真实复核：

- 原等待记录跨 Runtime 重载后可继续；复用原 Profile、原 firedAt。
- 新建无登录态 Profile，在修复后代码上重新触发等待，再通过本地模拟登录继续。
- 新一轮最终回复 LOGIN-RESUMED：12+8=20，等待卡移除；重复继续返回持久化 replay，不再执行一遍。
- 等待与恢复可以拥有不同底层 runId；属于同一调度 firedAt，不是新增任务轮次。历史保留等待和成功两个阶段记录。

### 4. 后续轮次的历史摘要串到旧回复

现象：第二轮实际输出 30+5=35，历史仍展示第一轮 12+8+5=25；登录恢复后也可能展示旧的等待摘要。

原因：MessageStore 首先选最新 50 条，但页内返回顺序为旧 → 新；旧选择器从前向后取第一个回复。

修复：从页尾选择最新文本，Runtime 还按本轮 runId 绑定摘要。没有本轮回复时不回收旧成功文本。用真实内存 SQLite 的 25/105 条消息验证分页，保留空文本、非文本和失败无回复的回归。

真实复核：更新原任务后由 daemon 到点触发（没有调用手动 trigger），2026-10-02 09:14:28.299 Asia/Shanghai 执行，最新历史为 THIRD-ROUND：40+6=46。旧错误历史留作诊断证据，没有批量回填用户数据。

## 验证范围与证据

- 创建、更新、发布、禁用草稿测试、忙时跳过、并发槽释放、重复执行、参数更新、Profile 冻结、MCP 缺失和发送证据：包含在 280 项 Runtime/daemon 回归中。该部分使用 FakeProvider 和局部 fixture，与下述真实模型验证分别统计。
- 模型无浏览器：真实 UI 创建、手动执行、到点执行及更新后的第三轮。
- Agent/Team 无浏览器：真实 XLSX 生成，Team 有成员派工和交付证据。
- 模型/Agent/Team 有浏览器：三个完整真实模型链路，分别处理 shirts 或 pants，并发送本地 MCP 邮件。
- 浏览器参数化复用：已发布同一 Browserflow 分别处理 shirts/pants；模拟登录复用同一 Profile。
- Office 独立验证使用 openpyxl、python-pptx 和 ZIP CRC；8 个成功轮次交付文件及旧取消轮次中已生成的 2 个文件均可读。后两项文件不计入成功任务数。
- 本次未新增界面修改；此前 UI 创建测试使用隔离 Electron 实例。本轮浏览器链路通过产品公开 RPC 和真实 Browserflow 执行器验证，没有继续外部 Chrome 窗口操作，也没有操作用户外部账号。

主要证据目录：D:/projects/SYNC-THINK/.data/verify/automation-live-20261002

- regression/login-source-absent/fixed-final-v2/results.json：最终 280 项回归。
- regression/timer-history-summary/：错误摘要的真实消息、只读调查、红灯和分页测试。
- final-live-results.json：修复后真实到点执行、新 Profile 等待/恢复和重复继续。
- team-retry-snapshot.json、team-browser-progress.json：成员实际执行证据。
- office-readback-results.json：文件数据、可读性和附件哈希核对。
- local-mail-receipts.json：三个实际本地 MCP 发送回执，非 Gmail 外部发送。
- runtime-build-final.log、runtime-reload.json：构建与隔离实例重载证据。

所有测试任务现已禁用，隔离实例无运行中的任务。没有复制用户聊天、定时任务、登录 Cookies 或 OAuth 数据到测试库；只有用于真实模型调用的既有提供商配置与凭据引用。用户正式任务与数据保持原样。

## 涉及源码

- D:/projects/SYNC-THINK/apps/runtime/src/runtime.ts
- D:/projects/SYNC-THINK/apps/runtime/src/collaboration-chat-host.ts
- D:/projects/SYNC-THINK/apps/runtime/src/automation/prompt-compiler.ts
- D:/projects/SYNC-THINK/apps/runtime/src/scheduled-task-history-summary.ts
- 对应的 executor、login、context、prompt 和 summary 回归测试。

