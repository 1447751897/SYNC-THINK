# SYNC-THINK 优化前后对比与完成边界

核验日期：2026-09-06。对象：当前目标“完成方案优化”及本任务已落地改动。**整体目标仍未完成，开发保持停止；本轮仅核验和整理报告。**

## 证据口径

- 优化前包括用户最初任务/导航/内容展示问题，以及9月5日审查基线；优化后以当前源码、实际构建文件与9月6日17:54最后交付为准。早期审查各节中的“待做”是当时状态，后续已完成项不重复列为缺陷。
- 本轮读取并核对代码、JSON原始基准、测试日志和构建manifest，未重跑业务性能测试、未调用模型、未重启应用、未修改功能。阶段性基准不冒充最终整窗实测。
- 代码与回归证明功能；真实SQLite/Worker/pipe证明数据通路；合成接口组件页面证明局部交互；真实内核调用与实际Electron按钮另有明确记录。不同层级的证据不互相替代。
- 本报告将“已完成”限定在对应条目边界，不用测试通过数量计算整个目标完成百分比。没有计量的视觉/学习成本改善按可观察行为说明。

## 逐项对比

### 1. 原生任务与具体说明（已完成，功能与交互）

- **优化前：** 任务只有短标题；原生字段在适配、持久化或展示过程中丢失。此前还要求外部内核维护额外平台清单，发生过持久写入异常而聊天文字声称成功。
- **实施的改动：** Claude Code直接消费TaskCreate/TaskUpdate/TaskList/TaskGet并兼容TodoWrite；Codex消费update_plan/turn/plan/updated，并显式启用受管内核的原生update_plan。关联toolCallId和成功结果，保留任务编号、description、多行步骤及删除/清空语义；外部内核不再注入重复task-board。
- **优化后：** 每项显示标题、可选说明与真实状态；TaskList摘要保留已知详情，TaskGet可补充详情。失败请求不生成成功任务；会话间隔离；模型原生没有说明时仍只显示原标题。
- **效果与依据：** 原用户会话的5项任务及1/5进度已恢复。三内核各3轮真实计划、描述/状态变化、续聊记忆及Runtime对象重开已验证，使用现有deepseek-v4-flash；不是全部模型矩阵。该改动恢复信息，不保证模型必然生成详细描述。
- **核验入口：** [task-plan.ts:108](D:/projects/SYNC-THINK/packages/shared/src/task-plan.ts:108)；[codex-app-server-adapter.ts:304](D:/projects/SYNC-THINK/apps/runtime/src/kernel/codex-app-server-adapter.ts:304)；[03-feature-changelog.md:361](D:/projects/SYNC-THINK/docs/development/03-feature-changelog.md:361)；[2026-09-05-codebase-audit.md:842](D:/projects/SYNC-THINK/docs/reviews/2026-09-05-codebase-audit.md:842)。

### 2. 当前任务与历史任务分开（已完成，功能与交互）

- **优化前：** 重启后聊天正文还在，任务卡可能消失；Codex下一轮没有新计划时，用户容易把按轮次清空理解为历史丢失。
- **实施的改动：** 初始消息读取携带持久任务投影，再合并实时事件；新增只读“历史任务”，按轮次回看已确认快照，提供来源、记录时状态、时间、分页和版本校验。
- **优化后：** 当前清单遵守原生生命周期：Claude任务跨续聊保留，Codex新轮次可以清空当前计划；旧清单从历史入口回看，不把旧in_progress当成当前正在执行。展开历史默认读取最近记录，查看其它轮次再选择一次。
- **效果与依据：** 生产Electron隔离数据验证12轮、45项任务，轮次分页10→2、内容分页40→5→40及重启恢复。17:54业务新pipe仍返回原5项历史，与原持久事件一致。历史入口不重新执行任务。
- **核验入口：** [TaskPlanHistoryPanel.tsx:54](D:/projects/SYNC-THINK/apps/desktop/src/renderer/shell/TaskPlanHistoryPanel.tsx:54)；[native-task-plan-projection.ts:28](D:/projects/SYNC-THINK/packages/storage/src/native-task-plan-projection.ts:28)；[2026-09-05-codebase-audit.md:824](D:/projects/SYNC-THINK/docs/reviews/2026-09-05-codebase-audit.md:824)；[最终业务重启记录](C:/Users/ZHUZHE~1/AppData/Local/Temp/sync-think-optimization-qa-EvfgKK/process-outcome-rollout-result.json)。

### 3. 审批等待、重连和原请求恢复（已完成，功能与交互）

- **优化前：** 等待人工批准会被误报为长时间无输出；Runtime失效后的孤儿审批看似可批准，但原执行上下文已不在。部分旧user消息缺runId，原请求恢复入口找不到准确来源。
- **实施的改动：** 明确待批/拒绝/取消/失效状态；Desktop重开保留有效waiter，Runtime失效持久标记过期。新user消息原子关联runId，旧NULL记录只按唯一、同作用域的连续事件证明关联；增加“重新编辑原请求”，恢复文字、技能与有来源的附件。
- **优化后：** 等待期间显示静态待批反馈。失效后明确说明旧批准已失效；点击恢复仅进入草稿，人工核对后再发送，不复用旧授权。当前草稿保留，异步晚到和会话切换不会覆盖其它编辑。
- **效果与依据：** 此前三内核共12个实际Electron按钮场景通过：同审批重开批准、拒绝、待批停止、Runtime异常退出后的失效/恢复。Native额外等待65秒未误报stall。原失败旧库的精确原文恢复亦验证；图像推理全矩阵另列未验。
- **核验入口：** [ExpiredToolApprovalNotice.tsx:1](D:/projects/SYNC-THINK/apps/desktop/src/renderer/shell/ExpiredToolApprovalNotice.tsx:1)；[approval-request-recovery.ts:1](D:/projects/SYNC-THINK/apps/desktop/src/renderer/shell/approval-request-recovery.ts:1)；[2026-09-05-codebase-audit.md:894](D:/projects/SYNC-THINK/docs/reviews/2026-09-05-codebase-audit.md:894)；[真实窗口审批验收](C:/Users/ZHUZHE~1/AppData/Local/Temp/sync-think-optimization-qa-EvfgKK/kernel-window-acceptance-summary.json)。

### 4. 文件变更和工具终态真实性（已完成，功能与交互）

- **优化前：** tool.requested就被计作文件变更；任意path或dirty git状态可能被归入本轮修改。Claude拒绝可显示成功，Codex空exitCode可掩盖declined，失效步骤可能一直running。
- **实施的改动：** 只有已成功完成的写工具结果生成文件变更；统一失败元数据，区分原生工具ID与审批RPC ID，精确关联决定；实时、过滤历史、分页投影及恢复时间线应用同一终态。完成动作汇总排除未成功工具。
- **优化后：** 未批准、取消、失败、失效和读取操作不再冒充修改；已有真实成功保留；工具未报告结果时显示错误/未知结果而非成功。普通命令文本不被反推为逐文件变更。
- **效果与依据：** 同12个真实旧案例逐项前后回放：Native/Claude各3种未执行场景由1个假文件变为0；两者批准场景仍保留1个真文件。三内核失效过程快照running→error；Codex拒绝done→error。窗口副本回放12项通过。旧Native失效canonical本来缺工具行，未补造该行。
- **核验入口：** [tool-outcome.ts:1](D:/projects/SYNC-THINK/packages/shared/src/tool-outcome.ts:1)；[run-process-view.ts:149](D:/projects/SYNC-THINK/apps/runtime/src/run-process-view.ts:149)；[process-item-outcome.ts:1](D:/projects/SYNC-THINK/apps/desktop/src/renderer/shell/process-item-outcome.ts:1)；[修复前](C:/Users/ZHUZHE~1/AppData/Local/Temp/sync-think-optimization-qa-EvfgKK/process-outcome-before.json)；[修复后](C:/Users/ZHUZHE~1/AppData/Local/Temp/sync-think-optimization-qa-EvfgKK/process-outcome-after.json)。

### 5. 发送失败、草稿与运行替换（已完成，功能与交互）

- **优化前：** 字符数合法的输入可能超过存储字节限制；发送失败后草稿可能丢失，切换会话后返回也可能丢失。插队请求可能先取消旧运行、再遇到新请求准备或持久化失败。
- **实施的改动：** 发送准入前校验完整blocks JSON及技能快照，保留100,000 UTF-16单元和256KiB字节两道限制。新消息、旧partial正文/时间线、版本与审批/取消事件同事务提交，提交成功后才abort旧执行。增加按会话隔离的窗口级失败草稿缓存。
- **优化后：** 超限输入有明确错误；失败草稿可恢复或追加到新编辑内容；回到原会话仍可找回。新请求落盘失败不会先破坏旧运行或旧审批。恢复不自动发送。
- **效果与依据：** 事务回滚、普通timeline写失败后的相同内容重试、卸载前后失败、会话隔离及恢复均有回归。学习成本改善来自可见恢复路径，未做用户耗时统计。草稿只保留在当前应用窗口生命周期，不承诺重启持久化。
- **核验入口：** [append-message-boundary.test.ts:1](D:/projects/SYNC-THINK/apps/runtime/src/append-message-boundary.test.ts:1)；[failed-compose-drafts.ts:1](D:/projects/SYNC-THINK/apps/desktop/src/renderer/shell/failed-compose-drafts.ts:1)；[2026-09-05-codebase-audit.md:753](D:/projects/SYNC-THINK/docs/reviews/2026-09-05-codebase-audit.md:753)；[2026-09-05-codebase-audit.md:782](D:/projects/SYNC-THINK/docs/reviews/2026-09-05-codebase-audit.md:782)。

### 6. 左侧导航的预览与定位（已完成，视觉与阅读）

- **优化前：** 命中区域偏窄，预览信息重复；长回答还没读完可能提前高亮下一轮；点击后容易被流式追底拉回。
- **实施的改动：** 位置保持左侧，命中轨道扩至32px，刻度中性、当前项更长，移除光晕。悬停/键盘焦点仅预览：问题主标题、回答次级摘要各最多两行，时间弱化；优先定位本轮首条问题，Escape关闭预览。
- **优化后：** 先预览再决定跳转，点击1次即可定位目录中的轮次；手动滚动、触摸、按键或新的导航意图取消旧跳转；查看历史时暂停自动追底。没有新增另一条页面滚动条。
- **效果与依据：** 860/320px聊天列、6/120轮、明暗与壁纸夹具验证；问题锚点误差小于1px，键盘预览不滚动。属于命中、信息层级和容错改善，未测学习时长或满意度。
- **核验入口：** [ConversationMinimapRail.tsx:1](D:/projects/SYNC-THINK/apps/desktop/src/renderer/shell/ConversationMinimapRail.tsx:1)；[03-feature-changelog.md:346](D:/projects/SYNC-THINK/docs/development/03-feature-changelog.md:346)；[15-frontend-design.md:454](D:/projects/SYNC-THINK/docs/product/15-frontend-design.md:454)。

### 7. 代码阅读状态保持（已完成，视觉与阅读）

- **优化前：** 普通代码在streaming切到完成时换组件树：已展开的30行代码重新折叠，内部scrollTop从120归零。
- **实施的改动：** 稳定Markdown普通代码身份并保存expanded、following及横纵滚动位置；token追加和流式结束复用阅读状态。上滚、Home、PageUp暂停跟随，回到底部或点击末尾按钮再恢复。
- **优化后：** 生成结束不再要求重新展开和找行；跳去其它轮次、返回或调整窗口时保留已读代码状态。Mermaid、HTML、设计稿等原有专用分流继续保留。
- **效果与依据：** 组件回归覆盖流式完成边界；80轮问答/80行代码页面验证跨导航和缩放后expanded、scrollTop=140、scrollLeft=220保持。另一历史跳转样本保留scrollLeft=240。不是所有未挂载历史段的状态恢复证明。
- **核验入口：** [CodeBlock.tsx:20](D:/projects/SYNC-THINK/apps/desktop/src/renderer/shell/CodeBlock.tsx:20)；[MarkdownContent.tsx:1](D:/projects/SYNC-THINK/apps/desktop/src/renderer/shell/MarkdownContent.tsx:1)；[2026-09-05-codebase-audit.md:251](D:/projects/SYNC-THINK/docs/reviews/2026-09-05-codebase-audit.md:251)；[2026-09-05-codebase-audit.md:356](D:/projects/SYNC-THINK/docs/reviews/2026-09-05-codebase-audit.md:356)。

### 8. Code Block、Tool Result、File Diff适配（已完成，视觉与阅读）

- **优化前：** 代码、参数、结果和差异表面表达不一致；工具状态与代码输出完成易混淆；失败折叠、快照截断或缺失时不够清晰。
- **实施的改动：** 本地适配beUI三类内容层级，复用现有React、highlight.js、主题token及LCS。代码增加文件/语言栏、行号、高亮、复制反馈、长段展开；JSON保留字段视图与原文复制；差异增加双行号、增删统计、换行和修改后复制。
- **优化后：** 实时工具有结果时默认展开，成功收起、失败保持可见，用户手动选择优先；缺失/截断/过大快照明确降级，不显示伪完整diff。只在有真实路径时显示文件身份。
- **效果与依据：** 最初7个相关文件142项测试及840/340px内容列、明暗/壁纸页面验收通过；后续最终Desktop全量包含这些回归。没有安装Motion、Shiki或第二套AI SDK；Morphing Tabs与主标签栏保持原状。未做主观美观评分。
- **核验入口：** [CodeBlock.tsx:1](D:/projects/SYNC-THINK/apps/desktop/src/renderer/shell/CodeBlock.tsx:1)；[InlineProcessFlow.tsx:1](D:/projects/SYNC-THINK/apps/desktop/src/renderer/shell/InlineProcessFlow.tsx:1)；[ExecutionProcessBlock.tsx:1](D:/projects/SYNC-THINK/apps/desktop/src/renderer/shell/ExecutionProcessBlock.tsx:1)；[15-frontend-design.md:832](D:/projects/SYNC-THINK/docs/product/15-frontend-design.md:832)。

### 9. 布局、一致性、响应式与动效（部分完成，视觉与阅读）

- **优化前：** 任务只有单层标题；局部工具/差异控件层级不一；大段内容可能挤压窄聊天列；读取提示或自动跟随可能干扰当前阅读位置。
- **实施的改动：** 保留应用主结构与已有主题，重点校准任务主/次文字、紧凑内容栏、固定尺寸图标、状态与错误层级；长路径自然换行，大内容在内部滚动；读取提示移出正文流。新增动效遵守reduced-motion，导航去除光晕。
- **优化后：** 正文、任务说明、工具详情和状态更易区分；窄列不靠压缩字号解决长路径。等待审批采用静态状态，生成时才表现动态活动。没有重做全站主题、品牌字体或全部页面布局。
- **效果与依据：** 任务组件390×760/1000×800、内容列340/840px、导航列320/860px，以及部分820/1280px窗口均有记录。样本中无页面横向溢出、控件可操作；不等于整个Electron应用已完成手机端、所有页面或所有主题矩阵。
- **核验入口：** [ComposerTaskPanel.tsx:1](D:/projects/SYNC-THINK/apps/desktop/src/renderer/shell/ComposerTaskPanel.tsx:1)；[shell.css:1](D:/projects/SYNC-THINK/apps/desktop/src/renderer/shell/shell.css:1)；[15-frontend-design.md:832](D:/projects/SYNC-THINK/docs/product/15-frontend-design.md:832)；[2026-09-05-codebase-audit.md:902](D:/projects/SYNC-THINK/docs/reviews/2026-09-05-codebase-audit.md:902)。

### 10. 能力入口与可用状态（部分完成，功能与交互）

- **优化前：** 已安装Pi可能被当作可执行，即使adapter尚未接通；未就绪设置入口仍可见，搜索能带出隐藏项；内核checking被误当作installing。
- **实施的改动：** 区分已安装与可执行，给首轮、旧草稿、续轮和Runtime前置路径加执行门控；设置列表与搜索统一使用ready且visible的清单；检查更新与实际安装/验证分开。
- **优化后：** 减少进入空页面或执行到后端才失败的情况；已安装Claude/Codex在检查更新时保持可选，真正安装中仍有状态限制。
- **效果与依据：** 源码与入口回归已核验。Pi仍无执行adapter；账号、钱包、每日回顾、语音、安全查杀、云同步不因隐藏/禁用而变成已实现。完整能力/环境矩阵仍待验收。
- **核验入口：** [SettingsPage.tsx:182](D:/projects/SYNC-THINK/apps/desktop/src/renderer/shell/SettingsPage.tsx:182)；[registry.ts:205](D:/projects/SYNC-THINK/apps/runtime/src/kernel/registry.ts:205)；[kernel-execution.ts:1](D:/projects/SYNC-THINK/packages/shared/src/kernel-execution.ts:1)；[2026-09-05-codebase-audit.md:894](D:/projects/SYNC-THINK/docs/reviews/2026-09-05-codebase-audit.md:894)。

### 11. 审批查询不再在线扫描全库（已完成，读取与性能）

- **优化前：** 首次审批恢复从sequence=0分页扫描并解析全部事件，再在JS中过滤审批。业务库约17GB，游标接近199万；游标不是现存事件行数。
- **实施的改动：** 改为按thread/run/approvalId的专用过滤查询和索引，提取审批归约、持久提交与读模型；孤儿记录明确失效，失效落盘失败不确认成功。
- **优化后：** 普通打开/重连审批不再承担全局历史扫描；决定幂等，读取结果由服务端给出有效或过期语义。
- **效果与依据：** 索引及查询计划、持久化失败、重复决定和重连回归支持。未在原大库上主动执行旧全库扫描，所以没有该路径的可信“优化前X秒、优化后Y秒”整窗对比。
- **核验入口：** [tool-approval-events.test.ts:1](D:/projects/SYNC-THINK/packages/storage/src/tool-approval-events.test.ts:1)；[tool-approval-read-model.ts:1](D:/projects/SYNC-THINK/apps/runtime/src/tool-approval-read-model.ts:1)；[tool-approval-commit.ts:1](D:/projects/SYNC-THINK/apps/runtime/src/tool-approval-commit.ts:1)；[2026-09-05-codebase-audit.md:215](D:/projects/SYNC-THINK/docs/reviews/2026-09-05-codebase-audit.md:215)。

### 12. 任务/过程快照与只读Worker（已完成，读取与性能）

- **优化前：** 任务读取重复归约大payload；单个83事件Run读入并投影需318.335–373.351ms（隔离重放），最终显示数据只有约54KB。
- **实施的改动：** 原生事件仍是真源，增加随事件事务更新的派生任务快照；过滤展示无关run状态。冷读取移到延迟创建的只读Worker；按事件游标缓存过程，最多32个Run/16MiB估算，变化失效；Worker去重队列最多32，30秒超时/空闲释放。
- **优化后：** 已缓存任务/过程不重复解析历史大载荷；冷归约不占Runtime主线程。可选缓存安装失败时返回已读源快照，并低频诊断。
- **效果与依据：** 同209事件、完整83事件Run的隔离库：任务冷含Worker启动287.746ms；Worker已驻留的过程冷读102.273ms；任务暖0.041–0.204ms、过程暖0.048–0.242ms。视图严格相等，5ms定时器最大间隔7.019ms。不是整窗或17GB全库p95。
- **核验入口：** [conversation-history-read-service.ts:192](D:/projects/SYNC-THINK/apps/runtime/src/conversation-history-read-service.ts:192)；[conversation-history-worker.ts:1](D:/projects/SYNC-THINK/apps/runtime/src/conversation-history-worker.ts:1)；[原始读取基准](D:/projects/SYNC-THINK/.data/history-read-benchmark.json)。

### 13. 历史请求并发与失败重试（已完成，读取与性能）

- **优化前：** 已加载历史Run逐个发起请求，缺独立共享限流；失败无限退避，用户缺少明确的停止重试和单轮恢复入口。
- **实施的改动：** 同Renderer的历史过程、内容与差异读取共用3个真实在途槽位；视口附近/活动Run优先，主动内容读取高于后台预取，内容队列最多16。瞬态错误最多尝试3次，等待500/1000ms；永久错误停止自动重试。
- **优化后：** 切会话取消排队及旧响应，但已发出的请求直到真实结束才释放额度；错误时正文仍可读，点击“重新加载执行过程”只重读该轮，不重发消息或重跑工具。
- **效果与依据：** 60轮页面首次仅请求3轮；6轮连接故障各3次，共18次后停止，额外等待2.2秒未再发；手动恢复1轮后错误提示6→5。证明请求受控，不等于所有IPC接口或全应用多窗共享同一池。
- **核验入口：** [run-process-history-loader.ts:84](D:/projects/SYNC-THINK/apps/desktop/src/renderer/shell/run-process-history-loader.ts:84)；[conversation-read-request-pool.ts:1](D:/projects/SYNC-THINK/apps/desktop/src/renderer/shell/conversation-read-request-pool.ts:1)；[deferred-request-reader.ts:1](D:/projects/SYNC-THINK/apps/desktop/src/renderer/shell/deferred-request-reader.ts:1)；[2026-09-05-codebase-audit.md:315](D:/projects/SYNC-THINK/docs/reviews/2026-09-05-codebase-audit.md:315)。

### 14. 导航几何和滚动重复渲染（已完成，读取与性能）

- **优化前：** 每次滚动查询全部消息DOM、读矩形并线性找当前轮次；可见性状态触发ChatView重渲染，缺省数组引用使memo失效。
- **实施的改动：** 缓存锚点，用ResizeObserver维护行高增量、前缀和树及二分定位；非UI可见性状态移到ref/请求队列，稳定目录引用与刻度属性，只为目标消息预热布局并做有上限的定位修正。
- **优化后：** 滚动时不再全量测量消息矩形，不因队列可见性变化重渲染整列。保持已读消息挂载与代码内部状态，没有声称已做全量虚拟列表卸载。
- **效果与依据：** 同开发组件夹具2000消息：24次大幅跳转的最大帧间隔从约1004ms降到3次样本35.1/37.7/45.6ms；滚动全量矩形读取为0，72个跳转帧无超过50ms。首次挂载仍有成本，不能把跳转结果当作首屏收益。
- **核验入口：** [conversation-navigation-geometry.ts:17](D:/projects/SYNC-THINK/apps/desktop/src/renderer/shell/conversation-navigation-geometry.ts:17)；[conversation-navigation-layout.ts:1](D:/projects/SYNC-THINK/apps/desktop/src/renderer/shell/conversation-navigation-layout.ts:1)；[原始基线](C:/Users/ZHUZHE~1/AppData/Local/Temp/sync-think-optimization-qa-EvfgKK/history-long-chat-baseline.json)；[三次最终样本](C:/Users/ZHUZHE~1/AppData/Local/Temp/sync-think-optimization-qa-EvfgKK/navigation-verified-benchmark.json)。

### 15. 完整目录与按锚点读取正文（部分完成，读取与性能）

- **优化前：** 导航只有已加载正文对应的轮次，远处历史需逐页补齐；已有50条分页，但不是完整历史导航，也不是总DOM上限。
- **实施的改动：** 新增listNavigation元数据目录，默认200/最多500条、摘要240字符；listMessages支持aroundMessageId。初始仍50条正文，点击远处轮次才读目标页；合并已读区间，显式显示中间缺口，旧响应校验导航意图和作用域。
- **优化后：** 目录可覆盖未加载历史，首次进入不用读取所有正文。2000消息样本初次1个正文请求，跳旧轮次再1页，挂载50→100并保留真实缺口。
- **效果与依据：** 生产ChatView+合成8ms目录/20ms正文接口，3次2000消息样本：首批正文339–360ms，目录605–614ms，GC后堆约13.7MiB。1万条单次目录5046ms、5000刻度、约25.3MiB；说明万条密度治理未完成。目录SQL仍读取源blocks提取摘要，不是免读正文磁盘。
- **核验入口：** [use-conversation-navigation.ts:9](D:/projects/SYNC-THINK/apps/desktop/src/renderer/shell/use-conversation-navigation.ts:9)；[conversation-history-pages.ts:1](D:/projects/SYNC-THINK/apps/desktop/src/renderer/shell/conversation-history-pages.ts:1)；[message-navigation-rpc.test.ts:1](D:/projects/SYNC-THINK/apps/runtime/src/message-navigation-rpc.test.ts:1)；[目录基准](C:/Users/ZHUZHE~1/AppData/Local/Temp/sync-think-optimization-qa-EvfgKK/history-directory-benchmark.json)；[2026-09-05-codebase-audit.md:448](D:/projects/SYNC-THINK/docs/reviews/2026-09-05-codebase-audit.md:448)。

### 16. 大正文、工具输出和文件差异按需读取（已完成，读取与性能）

- **优化前：** 大消息/工具结果可能触及帧预算，被截短或跳过；预览缺对应完整读取入口；完整差异展开会放大DOM和响应。
- **实施的改动：** 从既有message/event/timeline来源生成预览与引用，不新增一套blob副本；readContent默认16384、最多32768 UTF-16单元，SHA-256版本校验续读。readFileDiff默认80/最多160行、每行512单元，步骤/文件列表40项分页。
- **优化后：** 首次显示与展开工具卡不自动拉取全部正文；点击后按段读取，每次保留一个片段和偏移，区分复制预览/本段。版本改变从头读，503可手动恢复；差异超精细预算时明确降级而非假装完整。
- **效果与依据：** 已有真实组件+IPC/Worker/SQLite回归。大文本样本的当前片段固定240px高度、单个code节点；在820px样本无横向溢出。完整复制仍可能遍历全部分段；没有来源的旧截短字节不推测恢复，所有泛化响应总预算仍非全部闭环。
- **核验入口：** [deferred-content.ts:27](D:/projects/SYNC-THINK/packages/shared/src/deferred-content.ts:27)；[DeferredToolContent.tsx:1](D:/projects/SYNC-THINK/apps/desktop/src/renderer/shell/DeferredToolContent.tsx:1)；[DeferredFileDiff.tsx:1](D:/projects/SYNC-THINK/apps/desktop/src/renderer/shell/DeferredFileDiff.tsx:1)；[run-process-page.ts:60](D:/projects/SYNC-THINK/apps/runtime/src/run-process-page.ts:60)；[2026-09-05-codebase-audit.md:522](D:/projects/SYNC-THINK/docs/reviews/2026-09-05-codebase-audit.md:522)。

### 17. 完整来源准备缓存（已完成，读取与性能）

- **优化前：** readContent每读取下一段都可能重新加载、解析、格式化并哈希整个来源；UI分页不等于底层已经增量读取。
- **实施的改动：** 缓存准备后的完整只读文本、格式、字节数与版本，最多8个来源/16MiB保守字符串估算；按作用域分键，用data_version/total_changes/schema_version失效，外层事务绕过，避免回滚内容污染。
- **优化后：** 同一来源的后续分段命中时不重复解析和哈希；数据库变动或超容量时仍重新准备，不永久缓存，也不跨会话复用权限。
- **效果与依据：** 代码与缓存命中/变更失效/事务回滚/Unicode回归支持。阶段报告另有同源缓存与绕过缓存对照，但本报告不将其当作旧发布版与当前整窗延迟对比。缓存容量是估算而非V8堆硬上限。
- **核验入口：** [content-snapshot-cache.ts:14](D:/projects/SYNC-THINK/packages/storage/src/content-snapshot-cache.ts:14)；[conversation-content-store.ts:1](D:/projects/SYNC-THINK/packages/storage/src/conversation-content-store.ts:1)；[2026-09-05-codebase-audit.md:726](D:/projects/SYNC-THINK/docs/reviews/2026-09-05-codebase-audit.md:726)。

### 18. Native运行状态增量持久化（已完成，读取与性能）

- **优化前：** 中间事件反复保存累计正文、timeline和工具结果，写入量随累计状态重复膨胀。
- **实施的改动：** 首条、重启后首条及检查点后的首条保持完整；中间状态≥4KiB且有收益时写版本化runStateDelta，完整检查点继续每128持久事件/终态保存。提交成功才推进基线，摘要和身份校验重放，外层事务回滚也回退journal。
- **优化后：** 减少新增运行的冗余写入，保留完整恢复内容；旧完整记录继续可读。不是删除历史，也不是全局内容寻址去重。
- **效果与依据：** 同机独立SQLite、132状态事件、每负载各3次：文本事件+检查点101,414,287→3,431,097B（-96.62%）；工具99,394,733→3,867,958B（-96.11%）。文本提交p95约23.62–26.04→7.43–8.32ms，工具25.78–26.35→11.15–12.72ms。代价：工具检查点恢复约25–28→48–54ms，全量无检查点重放约403–426→880–892ms，活动Run多一份基线。
- **核验入口：** [demo-run-persistence.ts:55](D:/projects/SYNC-THINK/apps/runtime/src/demo-run-persistence.ts:55)；[run-state-delta.ts:156](D:/projects/SYNC-THINK/apps/runtime/src/run-state-delta.ts:156)；[原始增量写入对照](D:/projects/SYNC-THINK/.data/native-run-state-benchmark.json)；[2026-09-05-codebase-audit.md:487](D:/projects/SYNC-THINK/docs/reviews/2026-09-05-codebase-audit.md:487)。

### 19. 生产构建、8个按需页面与高亮收敛（已完成，读取与性能）

- **优化前：** 默认development且不压缩，8,309,179B开发Shell单包；QA fixture静态进入常规入口；非首屏页面静态加载，存在全语言高亮和核心注册两入口。
- **实施的改动：** 默认production+压缩、本地ESM分包，development/qa独立目录和入口；设置、工作台、智能体、小队、浏览器、能力、任务、活动中心共8类按需加载。统一受限高亮，未知或超过100000字符纯文本；CodeBlock预览最多2000行，memo/deferred减少重复展示工作。
- **优化后：** 首屏不加载所有非首屏页面；有局部加载/失败状态和不整窗刷新重试。构建生成manifest，静态首屏闭包预算2.1MB、总Shell JS预算3MB，校验后替换构建目录；保留原有Mermaid/Excalidraw/xterm延迟vendor。
- **效果与依据：** 当前实际文件和manifest一致：首屏静态JS闭包1,921,629B，全部Shell JS2,740,047B。相对原开发单包分别少76.9%/67.0%，不含CSS、字体、独立vendor，不是启动时间缩短比例。同一阶段源码2000消息组件开发就绪2349–2387ms、生产2019–2079ms；仅构建模式对照，非整个Electron冷启动。
- **核验入口：** [shell-build-config.mjs:5](D:/projects/SYNC-THINK/apps/desktop/scripts/shell-build-config.mjs:5)；[ShellApp.tsx:283](D:/projects/SYNC-THINK/apps/desktop/src/renderer/shell/ShellApp.tsx:283)；[code-highlight.ts:166](D:/projects/SYNC-THINK/apps/desktop/src/renderer/shell/code-highlight.ts:166)；[当前构建清单](D:/projects/SYNC-THINK/apps/desktop/dist/renderer-shell/build-manifest.json)；[同源生产/开发组件对照](C:/Users/ZHUZHE~1/AppData/Local/Temp/sync-think-optimization-qa-EvfgKK/production-chat-benchmark.json)。

### 20. 图片恢复、代码边界、测试和本地部署（部分完成，交付与限制）

- **优化前：** 失效请求的图片/原文缺完整、可核验的恢复通路；多处大控制器承担读取/审批/渲染；存在源码字串断言和测试资源冲突。仅重启Desktop可能仍连着旧Runtime。
- **实施的改动：** 点击恢复才按准确message/run/image归属受限读取原图：原始525000B、dataURL700000字符、前端最多8图。抽取历史reader、调度池、导航几何、审批读模型和增量journal；补行为/事务/作用域回归。已做一致性备份、迁移与Desktop/Runtime成套本地切换。
- **优化后：** 可恢复来源明确的原请求；错误不靠重发工具掩盖。最后构建已加载进业务窗口，原消息/任务/会话保持；职责拆分是局部完成，不是大控制器重写或完整性能/发布认证。
- **效果与依据：** 最后一批Shared72/Storage502/Runtime1497/Desktop2119，共4190项全量通过；11项构建、lint、diff-check通过，Desktop保留18项既有Hook警告。17:54重启记录960消息/34任务/31会话、原5项历史保持。未新增图片压缩/WebP/AVIF/CDN或独立图片加载提速方案；真实图片推理、多窗资源、正式安装更新与完整回退尚未验完。
- **核验入口：** [approval-request-images.ts:41](D:/projects/SYNC-THINK/apps/desktop/src/main/approval-request-images.ts:41)；[approval-request-recovery.ts:1](D:/projects/SYNC-THINK/apps/desktop/src/renderer/shell/approval-request-recovery.ts:1)；[最后一批交付记录](C:/Users/ZHUZHE~1/AppData/Local/Temp/sync-think-optimization-qa-EvfgKK/process-outcome-rollout-result.json)；[2026-09-05-codebase-audit.md:915](D:/projects/SYNC-THINK/docs/reviews/2026-09-05-codebase-audit.md:915)。

## 用户操作体验

步骤数量仅描述当前界面明确操作，不对未测量的旧流程编造固定次数或下降比例。

### 1. 看当前任务

- **优化前：** 重启后可能需要寻找聊天文字或要求模型重建；原流程步骤没有系统计数。
- **实施改动与优化后：** 打开会话自动恢复当前有效投影；没有新增一遍建任务动作。Codex新轮次无计划时，历史入口默认展示最近成功清单，通常展开1次即可查看。
- **效果与依据：** 原5项业务历史与实际重启证据；不是每种内核一律常驻旧清单。

### 2. 找一轮旧问题

- **优化前：** 只能定位已加载历史，可能多次滚动和翻页；次数随距离变化。
- **实施改动与优化后：** 悬停/键盘焦点预览不改变滚动，点击目标轮次1次触发定位；未加载时后台再取目标正文页。
- **效果与依据：** 2000消息夹具首次1个正文请求，点击旧轮次再1页。无完整操作时长用户研究。

### 3. 继续阅读长代码

- **优化前：** 流式完成后重置折叠/滚动，需要重新展开并找行。
- **实施改动与优化后：** 已有展开和两轴位置自动保留；用户上滚后暂停跟随，点击回到末尾才恢复。
- **效果与依据：** 明确的组件红灯复现、状态保持回归和页面位置记录。

### 4. 恢复过期请求

- **优化前：** 看似批准但旧运行已失效；原文可能需手工寻找和重输入。
- **实施改动与优化后：** 点击重新编辑原请求 → 人工核对草稿 → 点击发送。两个主要按钮动作，中间核对不省略；不会自动执行。
- **效果与依据：** 实际窗口恢复未增加user/run记录；不承诺操作越少越好，确认步骤是必要容错。

### 5. 历史过程读取失败

- **优化前：** 后台无限退避，用户不清楚何时结束，也缺单轮恢复按钮。
- **实施改动与优化后：** 最多3次自动尝试，然后显示错误；点击重新加载1次，只读取对应轮次，正文不丢失。
- **效果与依据：** 6轮故障最多18请求后停，单轮手动恢复6→5条错误。

### 6. 首次打开设置/工作台

- **优化前：** 非首屏代码静态载入，但进入页面不一定有独立加载状态。
- **实施改动与优化后：** 打开相应页面才载入chunk，出现局部加载/失败反馈；失败可局部重试，保留聊天窗口。
- **效果与依据：** 实际Electron曾注入chunk缺失，恢复文件后局部重试成功，timeOrigin不变。首次打开仍有加载成本，无业务页面切换p95。

学习成本：原生任务和历史记录分开、按钮使用熟悉图标与标签、复制预览/本段语义分开，减少概念混淆；这是交互结构层面的判断，未开展用户学习时长实验。反馈及时性主要改善为明确的加载、等待、失败、失效状态，不表示模型首token更快。容错以保留草稿、状态来源、有限重试和不自动重执行为主。

## 视觉体验归纳

- 布局：保留左侧位置与主工作台结构，局部信息面板更紧凑；不是全站换肤。导航完整目录是新增数据能力，不只刻度样式。
- 层级：任务“标题+说明”、预览“问题+回答+弱时间”、内容“文件/语言+正文+状态”、差异“双行号+增删”各有明确主次。
- 一致性：三类内容复用现有主题token、高亮、图标和复制反馈；未引入第二套执行状态或新组件运行时。
- 可读性：长路径换行、代码内滚动、行号分离、失败信息保持可见；复制内容不混入行号。旧记录没说明时不生成装饰性详情。
- 响应式：390px任务视口、320/340px局部聊天列及820px桌面窄窗有具体夹具验收，不等于全应用手机端适配完成。
- 动效和状态：导航去光晕；生成/加载与等待审批有区分；reduced-motion有对应处理。Morphing Tabs未纳入本批替换，现有标签行为保持。

## 量化结果

| 指标 | 优化前 | 优化后/当前 | 效果与测量口径 |
| --- | --- | --- | --- |
| 首屏静态 Shell JS | 8,309,179 B（原开发单包） | 1,921,629 B（当前生产静态闭包） | 体积少76.9%；开发→生产及拆包综合差异，不是冷启动时间。 |
| 全部 Shell JS | 8,309,179 B（原开发单包） | 2,740,047 B（当前生产所有Shell chunk） | 少67.0%；都不把CSS、字体和独立vendor算入。 |
| 83事件Run读取并投影 | 318.335–373.351 ms，3次 | 冷102.273 ms；暖0.048–0.242 ms，5次 | 隔离同库重放；冷过程读取时Worker已启动，结果严格相同。 |
| 任务快照读取 | 旧真实任务约1.08–1.12 s | 隔离冷287.746 ms；暖0.041–0.204 ms | 前者原库，后者提取到隔离库，环境不同，不计算同比百分比。 |
| 2000消息大幅跳转最大帧间隔 | 约1003.9 ms | 35.1 / 37.7 / 45.6 ms | 同开发组件夹具，24跳/样本，后测3次；不是整窗p95或刷新率。 |
| 2000消息组件首次DOM就绪 | 2349–2387 ms（开发） | 2019–2079 ms（生产） | 同阶段源码/夹具，每种3次；不是当前全部功能的冷启动对比。 |
| Native累计文本持久字节 | 101,414,287 B | 3,431,097 B，减少96.62% | 132状态事件+完整检查点，独立SQLite、三次；现有17GB库未缩小。 |
| Native累计工具持久字节 | 99,394,733 B | 3,867,958 B，减少96.11% | 同口径；检查点恢复变慢约25–28→48–54ms，不能只报收益。 |
| 2000消息目录/首批正文 | 原先无完整未加载历史目录 | 目录605–614 ms；首批正文339–360 ms | 生产组件+模拟8/20ms接口、3次；新增能力的结果，不是前后同口径提速。 |
| 未执行Native/Claude文件请求 | 6个拒绝/取消/失效案例各误报1文件 | 6个案例均为0；2个批准案例仍各1 | 同一批真实历史只读回放；文件存在性与投影逐项核验。 |

首屏体积少76.9%不是启动快76.9%。目录样本首次50条正文与早期一次挂载2000条正文的夹具不同，不直接计算速度或内存同比。原文缓存、分包和分页都有冷命中/首次打开/全量复制的成本；增量写入也增加部分恢复CPU开销。

## 未完成事项与限制

- **已完成：可交付主链。** 原生任务与说明回显、历史任务、审批等待/失效/原文恢复、文件结果真实性、失败草稿与提交边界、左侧预览定位、代码阅读保持、三类内容适配、主要读取缓存/限流、Native增量持久化、生产分包及本地成套重启。完成指这些明确边界，不指整体目标完成。
- **部分完成：真实内核全生命周期。** 已测三内核计划与续轮，以及批准/拒绝/待批取消/失效恢复。图像推理、执行阶段取消、工具失败的更广组合、其它Provider/模型及发行二进制矩阵仍待验证；旧Native某条失效canonical缺工具行，未补造。
- **部分完成：大内容与容量治理。** 主要工具/正文/差异/过程集合已有预览引用、分页及缓存。其它泛化响应总预算、单项元数据上限、冷峰值、全局底层去重和流式导出未全部完成。丢失原始来源的旧截短字节没有恢复依据。
- **部分完成：长会话与多窗。** 2000消息及历史目录/锚点验证已完成；1万条目录仍约5.046秒/5000刻度。全量已读正文仍常驻，未完成分段卸载与状态恢复、完整键盘密度治理、整窗/多窗堆与调度公平性基准。
- **部分完成：能力、结构和测试资源。** 已加可用性门控、隐藏空入口、抽取局部服务并补行为测试。Pi adapter、账号/钱包/语音/云同步仍未实现；大Runtime/ChatView仍在，测试端口/资源隔离不完全，Desktop有18项既有Hook警告。
- **部分完成：部署和回退。** 已做SQLite一致性备份/校验、0052–0054相关迁移及Desktop/Runtime本地成套切换，并保留旧源兼容探针。正式签名安装包、自动更新/安装升级、旧Desktop完整业务恢复回退未全量验收。旧Runtime不识别新增量，降级需要兼容备份，不能直接打开新库。
- **未实施：不计入本次成果。** Morphing Tabs/主标签栏新改造、完整聊天虚拟列表、图片压缩或WebP/AVIF/CDN、换框架/换数据库、全库历史物理清理。保留现状不等于已列入下一轮必做。
- **待验证：缺少的产品指标。** 整窗FCP/LCP/TTI、真实17GB业务库冷启动前后p95、各页面切换p95、三内核生成速度前后、总体CPU/GPU/内存下降、图片传输收益、用户满意度/学习时长/操作成功率均缺可靠前后对照。测试数与包体不是这些指标的替代。

## 最后交付记录

- 2026-09-06 17:54（北京时间）：Desktop90660 / Runtime91248 / launcher95776成套重启验证，hello/health正常，inFlight=0。这是交付时观察，不是本轮重新探测进程。
- 原960消息、34任务、31会话、5个既有迁移对象及原5项任务历史保持；未清理旧聊天，约17GB旧数据库没有宣称被缩小。
- 最后一批四包全量：Shared72、Storage502、Runtime1497、Desktop2119，共4190项。11项构建、lint及diff-check通过，Desktop保留18项既有Hook警告。不是全工作区所有包、所有系统与真实内核的全组合认证。
- 12个真实旧案例的只读投影前后对照和生产Electron副本历史检查通过；这批检查没有再次调用模型。此前真实模型/按钮验收独立记录，不能把二者合并称为本批重新跑完所有真实场景。

最终记录：[交付JSON](C:/Users/ZHUZHE~1/AppData/Local/Temp/sync-think-optimization-qa-EvfgKK/process-outcome-rollout-result.json)、[窗口回放JSON](C:/Users/ZHUZHE~1/AppData/Local/Temp/sync-think-optimization-qa-EvfgKK/process-outcome-ui-result.json)、[当前状态](D:/projects/SYNC-THINK/docs/development/10-current-status.md:1)、[审查最后一批](D:/projects/SYNC-THINK/docs/reviews/2026-09-05-codebase-audit.md:915)。
