# Agent Limits 上下文卡片与浏览器接管恢复验收 · 2026-10-02

## 上下文卡片

按用户截图和 BoardUI Agent Limits Card 的公开预览独立实现，使用项目自己的 React 组件、语义色彩 Token 和 Runtime 数据模型；未安装或复制 Pro 私有源码。

- 顶部：当前占用 / 窗口容量（百分比）与展开箭头。
- 彩色占用条：颜色对应实际分类；每行百分比以窗口容量为分母，而非当前占用。
- 默认直接显示分类、剩余容量；窗口来源、模型配置和压缩参数收进独立折叠详情。
- Runtime 目前的审计接口提供系统、智能体/小队、项目、摘要、消息和工具六类。仅当内核实际上报 MCP 等独立分类时显示这些分类；未上报服务器/Skill/延迟工具明细时不生成示例条目。
- 去掉旧实现默认展示的虚构五小时/每周额度及重置时间。未接入供应商账户额度时显示“尚未接入”；累计消耗仍使用真实会话计数，缺失显示“尚未上报”。
- 内核自管压缩时保留内核语义，不误用宿主 70% 自动压缩规则。明细与最新总量暂不同步时显示提示，进度条按总量绘制，不双计数。
- 超容量仍显示真实比例并提示，进度条约束在 100%；未知容量不伪装成已知零容量。
- 弹层支持鼠标、点击、键盘进入、Esc 关闭/焦点返回、外部点击关闭；小窗口时约束位置与滚动高度。

## 卡片验收证据

目录：`D:/projects/SYNC-THINK/.data/verify/agent-limits-handoff-20261002/`

- `regression-ui.json`：230 项测试通过 / 7 文件，涵盖卡片、上下文控件、主会话、智能体私聊、群聊及输入区回归。
- 卡片和上下文控件单独运行：39 项通过（包含 11 项新增卡片/键盘用例）。
- `visual-results.json`：82/82 浏览器断言通过；明暗主题、展开/折叠/压缩详情、真实会话组件、320/390/600/1440 宽度与 400 高度小窗口。无页面异常和相关 console 错误。
- `light-expanded.png`、`dark-expanded.png`、`*-actual-conversation-page.png`：实际渲染组件截图。使用独立内存 QA 数据，不代表用户账户额度或实际会话计数。
- Browser plugin/对应 browser skill 未列出；采用项目已有 Playwright + 新建无用户 Profile 的 headless Chrome。全部测试浏览器、HTTP 服务器在 finally 中关闭。
- 全仓设计 Token 检查仍报告 67 项现有问题（`design-token-existing.log`）。报告中的位置不在本次新增卡片规则/卡片组件内；本次规则全部使用已定义的语义 Token，不顺带改动无关界面。

## 浏览器接管

真实 Runtime 只读诊断和恢复回归的结果见后续补充。此次测试不触发用户群聊的模型执行、发布、邮件发送或账号登录，不直接修改生产数据库。

## 浏览器接管根因与修复结果

### 已证实的原因

旧桌面日志 `D:/projects/SYNC-THINK/.data/desktop-restart/composer-backplate-20261002-105008/desktop.stderr.log` 第 26、31、36、41、46 行，五次出现 `runtime:browser-handoff-list-waiting` / `Invalid list-waiting-browser-handoffs payload`。群聊提交 conversationId/workspaceId，桌面 parser 仅允许 workspaceId/runId；请求在进入 Runtime 前被拒绝。Runtime 本身已有 conversationId 支持。不是缺失 handler，也不是已证实的网络故障。

### 修复

- 桌面 IPC 严格校验并保留 conversationId，未知字段和非法 ID 仍拒绝。
- 群聊、私聊共享 useBrowserHandoffs。成功返回空列表也清除旧查询错误。
- 仅连接类读取故障指数退避重试，上限 30 秒；参数/语义错误显示具体详情，避免盲目重试。
- 同作用域单飞读取，事件突发合并尾随查询；切会话/切 run 立即隔离旧卡和迟到结果。
- 继续/取消同步加锁，结果不确定时读取持久状态核对，不自动重发写操作。

### 最终联合验证

- regression-final.json：桌面 309/309 通过，14 文件。
- 委派的 Runtime 校验及独立 fixture 集成 24/24 通过（未改 Runtime 实现）。
- handoff-visual-results.json：11/11 浏览器场景断言；连接恢复（含成功空列表）、真实错误详情、群聊/工作区隔离、一次继续、语义错误不自动重试、修正后的手动重试。
- 与卡片 82 项合计 93/93 浏览器断言。浏览器场景全部使用独立内存 QA 作用域，不登录用户账号、不触发用户模型工作。
- build-production-final.log：TypeScript、preload 与生产 Renderer 构建成功。
- compiled-ipc-live-probe.json：新生产构建的纯桌面 IPC handler + fixture IPC host + 真实 Runtime 只读联通通过，合法 conversationId/workspaceId 查询接受、未知字段拒绝。此验证不等于真实 Electron 窗口 sender 验证，也不等于实际群聊的 UI 验收。

## 桌面重新加载：仍有独立启动阻塞

重载前确认 foreground Runtime inFlightRuns=0，daemon running=false/queued=0 且心跳新鲜，仅停止已核验身份的桌面主进程。没有停止 daemon、删除用户数据/Profile、取消任务或改变定时设置。

桌面重新启动时 Electron 33.4.11 在原生初始化阶段发生 EXCEPTION_BREAKPOINT，退出状态 0x80000003；单独 electron --version 也失败，Node 模式的版本查询成功。原安装与官方同版本 release 的 73 个文件 SHA256 全部相同，隔离官方副本也复现，未据此认定依赖文件损坏。生产源码和 node_modules 均未因排查此问题被替换。桌面窗口目前尚未重新打开，主进程内的新代码尚未完成现场 UI 加载验收。

日志/证据：

- D:/projects/SYNC-THINK/.data/desktop-restart/agent-limits-20261002-112511/logged.stderr.log
- 本验收目录 electron-distribution-compare.json（73 文件无差异）、electron-SHASUMS256.txt
- latest-live-runtime.json：后续 Runtime PID 65904、health ok；daemon 原 supervisor/worker 仍在，心跳与定时状态正常。旧 foreground 后来退出，daemon 自动拉起 foreground Runtime；不将其表述为 foreground 全程未重启。

交付边界：群聊 IPC 与卡片源码、生产构建、自动回归均完成；桌面原生启动问题仍待继续定位。截图来自隔离 QA，不冒充用户真实窗口截图或会话用量。官方同版本诊断副本仅保留在 .data/verify 目录，未替换项目依赖。
