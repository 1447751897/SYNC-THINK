# 自动化中心：实现、验收与测试指南

## 结论与部署状态

本轮实现已经保存并完成 Runtime / Desktop 及其依赖的构建。验证结果采用 UTC 时间记录；本地验证目录名为 automation-studio-20261002。

生产 Runtime PID 62364 仍有未结束的执行（5ADC1WZ8NHSWRR4DRVB8KGSEZY，包含待处理人工问题）。本轮没有终止该执行，没有替换正在运行的 Runtime，没有唤醒已暂停的小说群，也没有提交、重置或覆盖此前工作。**生产执行进程尚未加载本轮新构建**，待现有执行收尾后再安全更新 Runtime / daemon / Desktop，避免同时启动第二个执行宿主。

## 一、统一模型

- 自动化任务 = 触发时间 + 执行者（直接模型 / 智能体 / 小队）+ 能力绑定 + 工作目标和验收要求。
- 小队协作流程描述用于说明职责与常见协作方式，不强制逐环运行。真正任务通过独立群聊的 Host 队列和成员派工执行；各任务上下文、轮次与产物隔离。
- 浏览器流程是可发布、可参数化重放的操作技能，由上述执行者调用；它的执行成功只是任务的一项证据，并不等于全部目标完成。
- Browser Profile 用于保存同平台登录态。任务可以更新关键词等参数而复用同一发布版本与 Profile；不同 Profile 保持隔离。
- 新“自动化”页面统一筛选有 / 无浏览器的任务，保留原日历视图。详情展示执行者、任务权限、触发时间、Profile / 流程、MCP、产物、交付和执行历史。
- 新任务默认草稿 / 未发布。保存配置不会执行；“立即测试”是真实执行，可能生成文件或发送配置的邮件；“发布”才开启周期触发。

## 二、修复与约束

1. Team 定时任务进入真实独立群队列，不再退化为仅协调员独自答复。关闭 Desktop 后也优先使用单一长期 Runtime；启动或投递失败会保留原因、释放执行名额，不创建第二个无 Host 执行者。
2. 浏览器 Profile、流程发布版本、参数、MCP 与交付配置按轮冻结。修改任务只影响下一轮；更换执行者 / 工作区时不复用旧群上下文，历史与旧文件保留。
3. MCP 预检实际执行 tools/list，使用已登记工具与在线工具的交集。发件连接器与工具必须明确选择，不靠名称猜测已连接 Gmail。
4. 表格与 PPT 由宿主生成真实 .xlsx / .pptx 文件，保存在工作区 .sync-think/automations/任务ID/轮次/ 下，记录大小和 SHA-256。宿主把实际文件附到支持的 MCP 附件字段，不让模型自行虚构附件。
5. 邮件配置校验精确收件人，不额外添加抄送 / 密送；只有结构化发送回执才算交付成功。HTTP 成功或模型口头说“已发”不是发送证据。发送结果未知时保留文件、停止自动重发，避免重复邮件。
6. 登录 / 验证码使用人工交接。后续定时 tick 合并跳过，交接仍可继续；继续复用原轮次与 Profile，恢复后仍需读取页面核对。连续点击只消费一次交接；其他任务占满并发槽或预检失败时不提前消耗它。
7. 已发布任务在等待期间被禁用、换执行者 / Profile / 目标 / 工作区时，旧交接会阻止继续。尚未发布的草稿“立即测试”允许完成登录再继续，保持未发布，避免被迫先启用周期任务。
8. 浏览器大截图与长结果不再挤掉模型所需的结构化执行信息；模型收到有界有效 JSON，完整记录继续保存在执行 trace。
9. 自动化样式已接入生产 shell.css；UI 验证使用生产 CSS 的字节一致副本，排除了 Fixture.css 额外夹带产品样式造成的假通过。

## 三、自动化验收范围

本轮定向自动测试 **1395/1395 通过，失败 0、跳过 0**：

- protocol-final.json：223/223。
- storage-final.json：578/578。
- desktop-final.json：115/115。
- runtime-automation-final.json：346/346。
- runtime-regression-final.json：108/108。
- workflow-regression-final.json：25/25。

六格 actor × Browser 场景均验证创建草稿、更新、发布、重复执行，并通过真实 SQLite listDue 与真实 Runtime taskSchedulerTick 检查到期执行、未来 / 未启用任务不执行、nextRunAt 推进与连续 tick 不重复。

- 模型：无浏览器 / 有浏览器。
- 智能体：无浏览器 / 有浏览器。
- 小队：无浏览器 / 有浏览器；确认真实 Host 队列与成员派工，而非仅协调员输出。

额外覆盖：任务忙合并、并发名额释放、ACK / 完成竞态、参数 / 发布版本冻结、MCP 离线与工具缺失、跨任务与旧上下文权限隔离、登录 / 验证码、重复继续、取消、冷启动恢复、发送回执缺失及失败、重复发送防护、附件 schema 与文件哈希校验。

浏览器 UI：桌面 1536×1024 与窄屏 390×844，各 24 项，共 48 项检查通过。检查列表 / 日历 / 创建 / 编辑 / 发布 / 停用 / 两轮历史、scheduled 与 group 的继续和取消、键盘焦点、reduced-motion、暗色对比度、横向溢出；console 与 page error 为 0。另有 2 个新组件目录实际展示检查通过。

真实链路：使用真正 Chrome 持久 Profile、实际网页 HTTP 服务、实际 Office 文件和实际 HTTP JSON-RPC MCP 边界。两轮采集 shirts → pants，共 7 项真实浏览器检查通过；4 份 Office 文件由独立 openpyxl / python-pptx 读回、ZIP CRC 与哈希校验通过。

**测试边界：**执行模型使用确定性 FakeProvider；网页与邮件接收端是隔离样本。这里验证系统执行机制，不把样本当作真实抖音榜单，不宣称真实模型的研究质量，也没有向实际 Gmail 发信。真实账号的登录、连接器 OAuth 与真实站点变化仍需最终账号验收。

既有组件目录仍有 22 个此前缺失的展示样例，本轮未把它们计入“通过”，未降低既有门禁。详情见本地 catalog-registration.json；不是整库所有测试全绿的宣称。

## 四、每日抖音趋势 → Excel / PPT → Gmail 设置

1. 先准备工作区和执行者。需要协作时选择实际小队，任务会获得独立执行上下文。
2. 在浏览器能力中准备专用 Profile，完成一次本人登录。建立 / 验证采集流程，把搜索词等变化项设成参数；审查并发布流程版本。
3. 在 MCP 中配置、授权自己的 Gmail 发件连接器，登记真实发件工具。当前适配支持直接 to / recipient 类收件人字段及 attachmentPaths 或受支持 attachments 结构；不支持的 schema 会明确失败，不静默丢附件。工具名称可显式选择，例如连接器实际提供的 gmail_send_message，而不是写死某个工具名字。
4. 自动化 → 新建任务：每天 09:00，Asia/Shanghai；选模型 / 智能体 / 小队、工作区、任务权限；绑定 Profile、发布流程和参数；选择所需 MCP、表格 / PPT、Gmail 发件工具及自己的收件地址。
5. 工作目标可写：检索截至采集时刻可见的抖音趋势，记录标题 / 原始链接 / 来源 / 采集时间 / 真实可见指标，去重，生成明细表与摘要 PPT，再通过所选连接器交付。目标数量和统计时间窗口须明确；只记录可核实数据，登录或数据不足应说明阻塞，不凭空补指标。
6. 先保存草稿，点击“立即测试”。它会实际执行，首次验证请使用自己的测试邮箱。遇到登录卡先在对应系统浏览器完成登录，再点击继续；此时仍保持草稿。
7. 检查文件内容、执行详情与邮件回执，确认业务质量后再发布。下一轮复用 Profile / 流程，产生独立轮次文件和交付证据。
8. 把 shirts 换成 pants 或更换主题测试第二轮，确认沿用登录态且不是重复发送上一轮邮件；停用后确认下一到期时间不再自动执行。

只有 Browser Profile 绑定、流程执行成功或工作流跑完，不满足“已经完成”的完整判定。宿主负责真实执行 / 文件 / 发送证据校验；内容相关性、事实来源与数量目标仍需执行者按业务验收要求核对，最终账号验收时再审查这些质量项。

## 五、证据与复跑

本地完整结果：D:/projects/SYNC-THINK/.data/verify/automation-studio-20261002

- protocol-final.json、storage-final.json、desktop-final.json。
- runtime-automation-final.json、runtime-regression-final.json、workflow-regression-final.json。
- real-capability-chain-results.json、office-readback-results.json。
- ui/results.json、ui/validation-summary.json、ui/screenshots/desktop-09-final-center.png。
- build-final.log、runtime-build-final.log、ui/desktop-build-final.log。

Node 20 路径：C:/Users/zhuzhenyu/AppData/Local/pnpm/nodejs/20.20.2/node.exe。Office 独立解析器路径：C:/Users/zhuzhenyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe。

主要实现入口：
- D:/projects/SYNC-THINK/apps/desktop/src/renderer/shell/TaskPanel.tsx
- D:/projects/SYNC-THINK/apps/desktop/src/renderer/shell/AutomationCenter.tsx
- D:/projects/SYNC-THINK/apps/desktop/src/renderer/shell/AutomationBindings.tsx
- D:/projects/SYNC-THINK/apps/runtime/src/runtime.ts
- D:/projects/SYNC-THINK/apps/runtime/src/automation/
- D:/projects/SYNC-THINK/apps/runtime/src/automation-run-evidence.ts
- D:/projects/SYNC-THINK/apps/runtime/src/daemon/dispatch.ts
- D:/projects/SYNC-THINK/packages/shared/src/types/scheduled-task.ts
- D:/projects/SYNC-THINK/packages/storage/src/scheduled-task-store.ts

未执行 git pull、commit、reset 或强制生产重启；此前 staged / unstaged 改动保留。本报告记录已完成的实现与隔离验证，生产加载和真实账号最终验收单独列示。
