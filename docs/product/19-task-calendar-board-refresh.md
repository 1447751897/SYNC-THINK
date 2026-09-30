# 定时任务日历与开发者组件库入口调整

日期：2026-09-30

## 范围与依据

- 用户截图显示：产品侧栏出现开发者组件库；定时任务默认周视图，固定筛选侧栏占用空间，标题重复，空状态缺少下一步。
- 已实际查看 BoardUI Calendar 的公开文档与演示：月视图、柔和底板、圆角日期卡片、彩色任务标签和密集日期展开。保留 Sync-Think 的真实定时任务领域与接口，不替换成会议/邀请模型，也不声称使用了 Pro 源码。
- 旧代码 `TaskCalendar.tsx` 默认 week；视图改变时定位固定 07:00，未按当前时间或首个日程调整。`TaskPanel.tsx` 与主舞台各显示一遍定时任务标题。

## 实现

1. 产品导航与 `ShellApp` 移除组件库入口、舞台、lazy import；`ShellStage` 与 `TopBar` 同步清理。独立开发者组件库和原有主题编辑、组件预览保留。根目录 `pnpm design:dev` 启动开发站（本机 4318），`pnpm design:build` 构建静态开发站。
2. 默认月视图：统一月份标题、日期翻页、今天、刷新、新建任务；保留日、周、月、列表。归属选择置于工具栏，类型和状态筛选按需展开，保留小日历和重置。
3. 月日期卡片使用 `--color-surface`，不是 `--color-panel`：当前工作台主题的 panel 与 sidebar 都是 #f7f7f7，直接沿用 panel 会让卡片与底板融为一体。卡片使用既有语义 Token；任务标签增加从公开参考页实测的双主题日历色板，支持明暗主题。
4. 同一日期最多展示三个任务标签，日期行的 +N 进入该日的完整时间轴；点击标签先打开锚定详情卡片，标签以主色描边选中；“完整详情”与“运行记录”再进入现有 TaskSheet，编辑、立即执行、启停、删除、执行历史沿用原接口。随机时间窗仍用斜纹，真实完成记录显示 ✓，不将未来计划伪装成已执行。
5. 分别呈现：尚无任务、筛选后没有结果、本时段没有日程、加载中、服务错误、历史记录/规则展开错误。可从空态创建、清除筛选或进入列表；服务出错时不显示错误的“尚无任务”。
6. 日/周视图首次进入当前时段定位到当前时间前一小时；其他时段定位首个日程前一小时，空日默认 08:00。使用时段键保护用户手动滚动，刷新和时钟更新不重置位置。
7. 窄容器工具栏换行、筛选改浮层；月/周日历内部横向滚动，不撑宽整个页面。按日期新建初始化精确 09:00，小时格新建清除继承的秒和毫秒。

## 文件与边界

- `apps/desktop/src/renderer/shell/TaskCalendar.tsx`：日历展示、空态、筛选、日期跳转和历史加载。
- `apps/desktop/src/renderer/shell/task-calendar-board.css`：限定日历的新样式；旧 `task-calendar.css` 中冲突的移动端隐藏规则移除。
- `apps/desktop/src/renderer/shell/TaskPanel.tsx`：原任务 CRUD、详情和历史继续接入，新增筛选重置和空态动作。
- `apps/desktop/src/renderer/shell/scheduled-calendar.ts`：增加纯时间定位函数；保留时区、重复规则、随机窗和重叠布局算法。
- `Sidebar.tsx`、`ShellApp.tsx`、`shell-state.ts`、`TopBar.tsx`：组件库移出正式产品导航。
- `WorkbenchVisualFixture.tsx` 与 `design-system/fixtures/calendar.ts`：只有 QA 参数 calendar=sample 时启用内存示例；不连接用户任务存储，不真正触发模型任务，生产入口不加载此服务。
- 无新增 npm 依赖，无后端接口或任务存储迁移，不清空工作区/会话/任务数据，不提高 bundle 预算。

## 验证与局限

- 专项测试覆盖月视图、空态、筛选、日期、密集日程、时间定位、异步历史取消、详情/编辑衔接、创建/启停/立即触发/删除、独立组件库与导航。
- 完整 desktop build、生产/QA renderer build、独立 design:build 和 desktop typecheck 均已执行。
- 本地 QA 的完整工作台用于视觉和交互检查；日历示例是内存数据，不代表真实运行产物。真实任务接口保持原实现，未在 QA 中执行用户的模型任务。
- 全仓库 Token 扫描仍报告其他既有样式/文件的 67 处裸色或外部变量问题。本次日历样式使用既有语义 Token，未扩大扫描器豁免。
- 当前桌面进程加载旧产物时，需要重新启动桌面端以加载新构建；浏览器 QA 页面需要刷新。

### 本次结果

- 最终专项结果：8 个测试文件，95 项通过、0 失败；报告在 `.data/calendar-refresh-preview/tests.json`。
- 浏览器检查 9 项全部通过，无页面 console error；浅色/深色、筛选归零与恢复、失败状态、密集日期完整展开和首个时间定位、详情到编辑、侧栏收起后的布局均已检查。实际可用视口 869×932，日历容器约 548/815px；未将未生效的 1440 覆盖宣称为已验证。
- 生产 initial JS：2,238,074 bytes（上限 2,240,000）；total JS：3,394,363 bytes。manifest 确认生产图无 WorkbenchVisualFixture、qa-entry 或 fixtures/calendar。
- 重启前健康检查发现新的 in-flight 对话：保护检查阻止了重启，原 Electron 与运行时进程保留。当前桌面仍加载旧构建；执行结束后重开桌面加载新版。
- 最终本地预览保留为浅色月视图，截图与 UI 检查记录在 `.data/calendar-refresh-preview/`。

## 2026-09-30 二次对齐：标签配色、点击详情与日期弹层

### 已确认的差异与修复

- 对照公开 `components/calendar` / `templates/calendar` 的实际 UI 和 computed styles，不读取收费源码。原实现把 accent/success/warning 与白色混合，文字却用普通正文色。现将青柠、粉、紫、蓝、薄荷绿各自的背景/标题/时间共 15 对 light/dark 值写进 `16-shell-design-tokens.json`，生成 CSS。任务按 ID 稳定分配颜色，名称、排序、筛选、视图改变不变色；颜色区分任务，不表示类型或执行结果。失败/待处理仍有红色覆盖，停用仍有灰色，随机窗仍有斜纹。
- 原月份仅是非交互标题，翻页栏只有“今天”。现翻页栏中间是日期按钮，点击打开 320px 白色圆角日期浮层，周一开始、空白补齐，支持月份/年份跨越、方向键/Home/End/PageUp/PageDown、Enter 选择、Escape 和外部点击/聚焦关闭，选择后同步主日历与 mini calendar，保留当前日/周/月视图。
- 原点击任务立即设置 selectedTaskId 打开右侧 TaskSheet。现先打开任务旁的非模态详情浮层，同时描边原标签；展示被点击的那次日程时间和真实计划/时区/执行者/归属/指令。编辑、立即执行、运行记录和完整详情仍由 TaskPanel 路由现有接口，不新增会议字段或执行模拟。删除/筛掉任务、切视图/日期会清理浮层，刷新/重命名时按 ID 读取最新实体。
- `TaskCalendarPopover.tsx` 使用现有 Radix Dialog 的非模态焦点/外部点击/Escape 机制，无新增依赖。测量内容后定位，右边缘自动翻左，下边缘翻上，窄视口宽度和高度受限；滚动与 resize 重定位，锚点滚出日历则关闭。首帧 Portal 挂载后再测量与聚焦，避免误关或键盘焦点仍留在触发器。

### 跟进文件

- `TaskCalendar.tsx`：稳定色板、可点击日期栏、唯一浮层状态、当前 occurrence 详情、动作接线。
- `TaskCalendarDatePicker.tsx`：周一起始的日期网格和键盘导航。
- `TaskCalendarPopover.tsx`：定位、边界碰撞、焦点与关闭逻辑；纯定位函数有独立测试。
- `TaskPanel.tsx`：已有真实任务编辑、触发、历史和完整详情路由。
- `task-calendar-board.css` / 生成的 `tokens.css`：参考双主题配色、选中描边、日期与详情卡片样式。

### 验证状态

- 专项覆盖原日历/面板/投影/导航/开发组件库，以及新增日期选择、键盘、焦点、详情动作、更新和碰撞布局，报告 `.data/calendar-parity-preview/tests.json`。
- 新组件与变更日历/面板及测试的定向 ESLint、变更样式和新组件的 Prettier 均通过。全仓库 Token 扫描仍是其他已有文件的 67 处问题；本次未扩大豁免或修改那些文件。
- 完整构建两次复现 Windows EPERM 输出目录替换占用；在 shell-build-config.mjs 增加经过安全路径复查的 promoteGeneratedDirectory，仅对 Windows 的 EPERM/EACCES/EBUSY 进行最多 8 次短等待重试，其他错误立即透传。不改预算、不删除用户数据、不终止桌面或运行时。修复后完整 build 与重复 build:shell 连续通过。生产 bundle 预算维持原值，初始 JS 2,238,074 bytes，QA 示例仍与生产入口隔离。
- 本地浏览器预览使用 QA 内存任务：不执行真实模型。健康检查仍有 1 条 in-flight 对话，桌面旧进程保持运行，不自动中断重启。需要该任务结束后重新打开桌面加载最新产物。

- 最终结果：10 个测试文件 122 项通过，0 失败；12 项浏览器检查均通过、console error/warn 为空；最终生产 initial 2,238,074 / total 3,402,512 bytes。
- 构建跟进：build-shell.mjs 调用受检路径内的有限重试，shell-build-config.test.ts 增加瞬时占用、永久占用、错误透传和越界保护验证。
- 浅色与深色各 15 个公开参考色值逐项一致，记录与截图在 .data/calendar-parity-preview/。实际视口 869×932，日期/详情浮层均在视口内；360px 的边界处理由纯定位单测覆盖，不宣称已做 360px 浏览器实测。


## 2026-09-30：任务编辑器选中态、执行者头像与时间窗口

### 现场结论

- 已在真实 ShellApp QA 页复现选中项前的透明占位。旧 SelectOption 只有 data-active 和 CSS 伪元素圆点；更具体的 shell.css 规则重新生成了 6px 圆点，而 Portal 外缺少 task-panel 的 --task-accent，实测伪元素背景为 rgba(0, 0, 0, 0)。不是任务数据缺失。
- 执行者触发器和选项只传递 name，没有使用已有的 AgentAvatarView；列表卡片本来已使用该头像组件。任务关联 ID 不变，不写回智能体头像数据。
- 固定间隔与随机规则的四个窗口字段都是普通 text 输入，没有挂载 TaskTemporalPicker；单次和每周已有旧版快捷选择。
- 实际查看 BoardUI Calendar 组件页与 live template：New event 示例没有打开编辑弹层。通过页面公开组件查询找到 Date Picker 的 meeting-scheduler，并实际打开含 12h/24h、可滚动时间槽的面板。它是会议预约组件，不是独立 HH:mm 时间输入。本产品参考其弹层、滚动列表和选中反馈，使用现有 Radix 组件实现全日时分选择，不引入会议预约业务或额外依赖。

### 本次实现

- TaskPanel.tsx：六个 SelectBox 使用 RadioGroup/RadioItem，选中由真实 ID/规则值驱动，ItemIndicator 渲染明确的勾；类型入口有智能体/模型/小队图标。执行者入口和选项复用 AgentAvatarView，支持已有图片、生成头像、emoji/文字，小队同样读取自己的头像。密集列表保持静态，不增加翻转动效。
- task-surfaces.css：菜单直接使用全局 color token；移除透明伪元素依赖；选中和键盘聚焦有独立反馈；标签保留截断空间，勾选位在右侧。关闭状态直接退出显示，避免 Presence 等待背景动画时旧菜单叠在新菜单后。
- TaskTemporalPicker.tsx：可滚动的 24 小时与 60 分钟两列，明确勾选当前值，选小时保留分钟且不收起，选分钟写回 HH:mm 并收起，Escape 恢复触发按钮焦点。TaskTimeField 保留手输输入并增加时钟入口；固定间隔和随机窗口各自接入开始/结束两个字段，全天模式禁用两端。输入范围校验为 00:00–23:59，非法手输在提交前阻止。
- 首次定位处理：在 Radix 内容获得焦点时同步定位已选小时；滚动列在弹层可用高度尚未测量时仍有 224px 高度上限，避免选中项初次出现在滚动区下方。
- WorkbenchVisualFixture.tsx：仅 opt-in task-editor=avatars QA 参数使用实际 bot:v1 头像种子，并同步引导快照和两个读取接口。没有改正式数据，生产构建不包含该入口。

### 验证与范围

- 先运行六项新增编辑器回归，原实现六项均红；修复后任务面板 27 项与时间选择器 16 项均绿。
- 本轮定向回归共 94 项、8 个测试文件通过，覆盖日历投影/弹层、任务编辑与保存、图片头像、时间精度/禁用/校验/焦点及 Windows 构建目录替换。
- TypeScript、定向 ESLint、生产与 QA 构建通过；未放宽预算、未添加依赖，未变更调度 RPC 和运行时工作流。
- 自动化报告与交互截图：.data/task-editor-picker-preview/。QA 数据为内存样例，不执行真实任务。
- 生产版需现有桌面窗口重新加载/重启后应用；本次不主动关闭用户正在编辑的桌面窗口。


## 2026-09-30：非滚轮时分选择与每小时计划缺失修复

### 真实排查证据（只读）

本地桌面当前任务数据库位于 ".data/SYNC-THINK/sync-think.db"，不是系统 LOCALAPPDATA 下的空数据库。任务“测试”创建于 2026-09-30 11:42:31（UTC+8），规则为每 60 分钟、12:00–18:00，时区 Etc/GMT-8。

- 12:00:00.070：daemon 把正常定时器的约 70ms 延迟判为 catchup，计数变为 1。
- 12:00:00.101：实际投递成功；运行直到 14:08:22 才结束。
- 13:00:00.207 / 14:00:00.192 / 15:00:00.186：均因补跑计数已用尽而 defer；不是用户少设了两个整点，也不是卡片被颜色遮住。
- SQLite 的当日运行历史只有 12:00 一条；defer 没有写入历史。原日历仅投影未来计划和真实历史，过去没有记录的点因此消失。

原日志把“额度耗尽”也笼统写成 missed beyond catch-up window，本次一起明确了日志措辞。只读证据保存于 ".data/task-hourly-diagnosis/evidence.json"；未复制凭据或任务执行内容。

### 修改范围

- 时间控件：小时 00–23、分钟 00–59 均以点选网格显示，无滚轮列；保留手输精确时间、选中高亮、分钟选择后收起、Escape 返回输入按钮。复用现有头像逻辑。
- TimerRegistrar / TimerRegistry：传递 trigger 和 scheduledAt。未来注册的正常到点事件（包括毫秒抖动）走 timer；注册时已过期、睡眠跨过整个周期或超过 24h 的事件走 recovery。
- daemon catchup：仅恢复事件消费限量补跑额度；强制重试与队列出队不消费额度。保留原 latest_only / 24h 补跑限制。
- 同任务尚在执行时：保持不重入；推进 nextRunAt，并持久化 status=skipped、reason=上次执行中 的真实历史。仅真实 fire 增加今日触发计数。
- 日历：为启用的确定性规则补齐创建时间之后的过去计划点，显示“无执行记录”及虚线；与同一时间段真实执行历史去重。该状态只是当前规则/当前已加载历史的投影，不写数据库、不伪造 success/skipped，不用于随机任务。详情说明重命名、规则修改及历史分页下应以真实运行记录为准。
- QA：calendar=hourly-missing 提供纯内存示例；不调真实模型、不修改实际任务。

### 验证与部署边界

红灯回归先捕获四个真实延迟对应的误补跑，以及 13:00 / 14:00 消失和无网格的问题。修复后 runtime 82 项、desktop 84 项相关回归通过（12 个测试文件）。类型检查、目标文件 ESLint、差异空白检查通过；运行时、生产 renderer 及 QA renderer 均完成构建。生产初始 JS 2,238,270 bytes，预算未改变。

实际浏览器核验：84 个时分选项全部可见、选择 13:37 不改变结束时间、结束时间独立修改、取消编辑不保存、Escape 仅关闭内层、深浅色均可用、13:00 / 14:00 卡片与投影详情可见、浏览器未捕获 warn/error。

此次未强制重启桌面或后台调度进程。新构建需要在对应进程重新启动后加载；未自动补跑 13:00 / 14:00 / 15:00，未补写它们的历史记录。
