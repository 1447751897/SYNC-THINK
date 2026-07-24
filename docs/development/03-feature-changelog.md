## 2026-07-24 · 对话过程总折叠与代码放大

- Assistant 每轮新增高于“深度思考/工具步骤/文件变更”的总过程层：执行中自动展开，完成后自动折叠；摘要直接显示深度思考、工具步骤数与文件变更数，避免大量过程卡平铺占满消息流。
- 总过程展开后仍保留二级细节：深度思考、各工具步骤及 Changes 均可独立查看；工具步骤在总层中改为更紧凑的嵌套行。
- 代码块增加：长代码展开/收起、全屏放大查看、`80%–160%` 字号缩放、复制、ESC/遮罩关闭；短代码仍保持紧凑。
- 文件工具标题直接显示路径，例如 `读取文件 · src/config.ts`、`写入文件 · docs/roadmap.md`，无需先展开才能知道目标；读取结果仍可在步骤内直接看到，写入/编辑内容继续进入文件变更预览。
- 过程投影补齐 `edit_file` 映射、`new_string` 预览和严格 run 隔离，避免无 run 事件串到其他回答的过程组。
- 验证：Desktop typecheck；Markdown/过程投影聚焦测试 15/15；Desktop build；`git diff --check`。



- 继续以用户最新八张 NewMax 截图为唯一结构基准，完成使用统计全过程：
  - 时间范围改为 `24h / 近 7 天 / 近 30 天 / 全部` 分段选择器
  - 四项 KPI 改为四张独立卡片，卡间 `12px`；顶部、二级 Tab 与表格节奏按截图收紧
  - 供应商表补齐请求数、总 Token、总费用、请求成功率、工具成功率、平均延迟
  - 模型表补齐请求数、总 Token、总费用与单次均费
  - 工具页补齐总调用/成功/失败/成功率、模型级统计、工具明细与最近失败记录
- 定价配置按 NewMax 的八列表格实现：模型 ID、显示名、币种、输入/M、输出/M、缓存读/M、缓存建/M、操作；支持添加、编辑、删除并持久化到 `app_setting['model-pricing']`。
- 初次使用展示截图中的 Claude 定价基线；用户保存后完全以本机配置为准。费用按输入、输出、缓存读、缓存建分别估算，并按 USD/CNY 分币种展示，不伪造汇率。
- Runtime 从 durable tool requested/completed 事件重建成功/失败；新工具结果额外标记失败和错误摘要，但继续保持既有 `tool.completed` 事件契约，避免破坏历史投影。
- 验证：protocol/runtime/desktop typecheck；Runtime 246/246；Desktop 399/399；全仓 build 11/11；`git diff --check`。测试需将 TEMP 指向 D 盘（本机 C 盘临时目录仅余约 36MB）。

## 2026-07-24 · NewMax 模型设置与使用统计对齐

- 以用户提供的 NewMax 截图为唯一页面结构基准，不再自行发明模型管理后台布局：
  - 设置分类栏 + 启用模型栏 + Provider 详情栏
  - 文本/图像/视频/语音/使用统计媒体 Tabs
  - 启用模型首项标记“默认”，支持启停与真实顺序调整；停用项进入独立折叠区
  - Provider 详情保留名称、Base URL、API 格式、多密钥、模型优先级、模型发现/手填与 Vision Fallback / Plan & Act
- 使用统计改为 NewMax 结构：
  - 顶部 4 项：总请求、总费用、总 Token、缓存 Token
  - 二级 Tabs：请求日志、供应商统计、模型统计、工具统计、定价配置
  - 请求日志支持时间范围、模型筛选、状态筛选、详情开关；表字段为时间/供应商/模型/Token/费用/延迟/状态
  - `usage.summary` 从 durable `provider.usage`、run 终态与 `tool.requested` 重建真实请求日志、延迟、供应商/模型/工具聚合；没有真实价格或缓存用量时显示 `—`，不伪造数据
- 供应商密钥继续遵守 Renderer 安全边界：表单值先写系统剪贴板，由主进程读取后送 Runtime；Renderer/preload 元数据类型不携带 `apiKey`
- 验证：protocol/runtime/desktop typecheck；Provider 安全边界 15/15；Provider Runtime 命令 5/5；Desktop build


- **根因 A（消息发送后图片消失）**：图片只存在 renderer optimistic state；durable `message.appended` 只有文本，投影按文本清理 pending 后图片立即消失，重开对话也无法恢复
- **根因 B（当前模型看不到图片）**：实际协议为 `openai-responses`，Responses adapter 把多模态 `content[]` 压成纯文本，静默丢弃 image part
- **修复**：
  - Desktop staging 后把图片复制到应用管理的 `message-images` 目录，事件只保存轻量 `storageRef`，不保存任意路径或 base64
  - 新增 `message.images-attached` durable event；投影按真实 `messageId` 关联图片，不再按文本去重
  - 自定义安全协议 `sync-think-image://media/<ref>` 为消息气泡和 lightbox 提供重开后图片
  - OpenAI Responses 序列化 `input_text + input_image`；OpenAI Chat/Anthropic 原多模态路径保持
  - Demo run 改存 staging ref，provider 调用前才解析 data URL，避免图片 base64 在每个 delta/event/checkpoint 中重复膨胀
  - 图片总数限制为 8；读取失败给可见错误；发送失败恢复附件
- 验证：adapters 多模态 18/18；runtime staging 1/1；desktop event history / compose 29/29；protocol/adapters/runtime/desktop typecheck；`git diff --check`

- 设置视觉不再以“NewMax-style”自行设计，改为以用户提供的 NewMax 截图为结构基准：
  - 居中 `1064×720` 上限设置窗口、约 `188px` 左栏、克制遮罩/圆角/阴影
  - 左栏含“设置 / Ctrl ,”、搜索框与 NewMax 同层级分类入口；未接能力只保留入口并明确未接，不伪造功能
  - 右侧固定页标题、内容区与右下角“完成”；ESC、遮罩和右上角 × 均可关闭
  - 通用页改为“通用 / 个性化”分段、标题+说明+右侧开关的设置行、底部三档权限模式；移除自创的大卡片墙
  - 主题页压缩为 NewMax 式紧凑外观选项
  - 模型页增加文本/图像/视频/语音/使用统计 Tabs；文本页改为“启用模型列表 + Provider 详情”三栏关系，首个启用项显示默认；使用统计移入模型页 Tab
- 设置 Modal 打开时，主侧栏“设置”入口同步保持选中；Provider 修改后触发 Shell catalog 刷新，关闭设置后模型选择器不再停留旧目录
- 动画开关继续控制全局动画，同时完整尊重 `prefers-reduced-motion`
- 验证：Desktop typecheck；shell build；产品壳聚焦测试 27/27；`git diff --check`

- **`runtime.unavailable` 根因与修复**：
  - Desktop 过去直接使用 PATH 中的 `node.exe`；当前系统为 Node 24，而 Runtime 的 `better-sqlite3` 按 Node 20 构建，子进程会在打开 named pipe 前退出
  - supervisor 现在搜索并校验 Node 20（支持 `SYNC_THINK_NODE_BIN`、release `resources/node`、pnpm managed Node 与 PATH），找不到时返回明确失败，不再启动错误 ABI 的 Runtime
  - 健康 Runtime 默认复用；仅 `SYNC_THINK_RUNTIME_FORCE_RESTART=1` 时回收重启，避免重复 Runtime 抢占 pipe 导致 `EADDRINUSE`
  - release 入口预留 `resources/runtime/main.js` 与 `resources/node/node(.exe)`，打包时必须随应用分发
- **设置弹窗（NewMax 对齐）**：
  - 使用 Radix Dialog，原生支持 ESC、遮罩关闭、焦点管理和无障碍语义
  - 改为大尺寸居中 application sheet：独立标题栏、左侧分类导航、右侧内容区，聊天保持在模糊遮罩后
  - 尺寸约束 `min(1080×760, viewport-72px)`；窄窗口自动贴近全屏；模型双栏页保留独立滚动
  - 动画开关继续控制全局 transition/animation；关闭后 Modal 瞬开瞬关
- 验证：desktop typecheck/build；runtime-session/runtime-connection/shell-state 聚焦测试 16/16；冷启动确认 Desktop 自动选择 Node 20 且 Runtime pipe 可用

- **目标**：设置 → 模型 可完整导入与管理模型源；使用统计可查请求/token
- **数据层（0026）**：
  - `provider.enabled` / `provider.sort_order`
  - `model.priority` / `model.credential_ref_id`
  - `app_setting` KV（`vision-fallback` / `plan-act`）
  - store：`reorderProviders` / `addCredentialRef` / `removeCredentialRef` / `setModelPriorities` / `removeModel`
- **协议 + Runtime**：
  - `provider.reorder` / `addCredential` / `removeCredential` / `setModelPriorities` / `removeModel`
  - `settings.get` / `settings.set`
  - `usage.summary`（从 provider.usage 事件聚合，补 displayName）
  - create/update 的 `apiKey` 经主进程 clipboard 中转写入安全存储；Renderer/preload 元数据不携带密钥
- **Desktop bridge**：main/preload/global.d 全量透传上述命令
- **设置 UI（新壳）**：
  - 双栏模型源：左列表（启停 + 排序）/ 右详情（端点、API 格式、多密钥、模型优先级、发现/手填）
  - 全局 Vision Fallback + Plan & Act
  - 使用统计页：24h / 近 7 天 / 近 30 天 / 全部时间
  - 停用供应商从对话模型选择器隐藏
- 验证：storage 232/232；protocol/storage/runtime/desktop typecheck；shell+runtime rebuild；Desktop 热重启 hello accepted

## 2026-07-23 · 联网开关真正生效（web_search / web_fetch）

- **原状**：Compose 地球图标只改本地 `netEnabled` 状态，不进 Runtime
- **修复**：
  - `appendMessage.networkEnabled` → `DemoRunState` → 本轮暴露 `web_search` / `web_fetch`
  - 无项目文件夹也可仅用联网工具；system prompt 说明开关状态
  - `web_fetch` 禁私网/本地主机；`web_search` 用 DuckDuckGo Instant Answer（免 Key MVP）
- 验证：chat-tools 单测；protocol/runtime/desktop rebuild

## 2026-07-23 · Vision 静默丢图诊断

- **现象**：图片已落 staging，但模型仍称「看不到图」时难以判断是解析失败还是 provider 未吃到 image parts
- **修复**：
  - Desktop 落盘 staging 时 log `staged chat image`（path/bytes）
  - Runtime resolve 失败逐项 warn；全部失败明确「model will only see text」
  - 发往 provider 前核对 `run.images` vs 末条 user 的 image parts 数量
- 验证：staging 可读 + pipe ready；runtime/desktop rebuild

## 2026-07-23 · C 盘满导致 Runtime SQLITE_FULL + 数据目录迁 D

- **现象**：发图后 `database or disk is full` / append 失败；C: 仅剩约 14MB
- **处理**：清理 `SYNC-THINK/backups`（约 3GB）与部分 Temp；DB 复制到 `D:/projects/MYSELF/SYNC-THINK/.data/SYNC-THINK/`
- **代码**：managed Runtime 默认把 `SYNC_THINK_DB_PATH` / `SYNC_THINK_CHAT_IMAGE_STAGING` 指到 monorepo `.data`，避免再被 C: 塞满拖死

## 2026-07-23 · 图片 pipe 1MB 上限：磁盘 staging + 发送前压缩

- **根因**：named pipe 帧 `MAX_FRAME_BYTES = 1 MiB`；截图 data URL base64 常 2–3MB+，`task.appendMessage` 无法把图送到 Runtime，模型只看到文本
- **修复**：
  - Desktop 主进程把图片写入 `%LOCALAPPDATA%/SYNC-THINK/chat-image-staging/`，pipe 只传 `stagingPath`
  - Runtime 读 staging 文件再组多模态 content
  - 渲染层发送前 canvas 压缩（长边≤1600，JPEG）降低 provider 体积
- 验证：runtime chat-image-staging 单测；desktop/runtime rebuild + 热重启

## 2026-07-23 · 修复图片仍被模型当「路径」：Runtime 热重启 + 消息拼装

- **根因 A**：Desktop 重建后旧 Runtime 仍占 named pipe，supervisor 见 pipe 通就复用 → 新多模态代码未加载
- **根因 B**：用户正文里夹了「附件图片：- xxx.png」文本，模型按文件路径理解
- **修复**：
  - supervisor 每次 Desktop 会话首次连接强制回收 orphan Runtime（PID 文件 + taskkill），再拉起最新 `runtime/dist/main.js`
  - `buildMessageWithAttachments` 不再写「附件图片」文本 footer；图片只走 `images[]`
  - `buildChatMessagesFromEvents` 有图时强制把末条 user 升级为多模态 content
- 验证：rebuild runtime/desktop；冷启动后发图应不再出现「路径不存在」

## 2026-07-23 · 图片多模态真正下发 + 拖拽上传

- **下发**：`appendMessage.images[]`（data URL）→ `DemoRunState.images` → `buildChatMessagesFromEvents` 多模态 content → OpenAI `image_url` / Anthropic `image.source`
- **持久化策略**：图片不写进 durable event 大 blob（只当前 run 使用）；历史轮次仍以文本「附件图片」说明
- **Compose**：支持拖入图片到输入区（拖拽高亮）；原有选图/粘贴保留
- 验证：chat-tools + stream-chat 单测；protocol/runtime/desktop build

## 2026-07-23 · 启动卡住修复 + 推理菜单纯文字

- **根因**：Desktop 只连 named pipe，不会自动拉起 Runtime；重建/冷启动若未先跑 `pnpm dev:runtime`，侧栏长期「加载中…」，点击像没反应
- **修复**：
  - 主进程 `runtime-supervisor`：pipe 不通时自动 spawn `apps/runtime/dist/main.js` 并等待就绪
  - Shell 启动用 `startRuntimeConnection` 可重试（给 Runtime 起服时间）
  - 退出时 stop 托管 Runtime
- **推理菜单**：去掉图标与说明，仅文字档位（自动/关闭/低/中/高/超高/极限）
- **Release 说明**：正式版同样必须内置/随启 Runtime；仅打包 Electron 壳仍会连不上。supervisor 是正确方向
- 验证：desktop typecheck + shell build

## 2026-07-23 · Compose 图片上传 + 自适应高度 + 固定推理全档

- **推理强度**：固定全阶梯 自动/关闭/低/中/高/超高/极限（不再按模型筛选）；权限/推理菜单项加左侧图标，减少「空列表感」
- **输入框自适应**：textarea 随内容增高（约 56–220px），对齐 NewMax
- **图片上传**：底栏 ImagePlus；支持选择多图、剪贴板粘贴；chip 缩略图；消息气泡内可点开 lightbox 大图
- 说明：图片目前为本地预览 + 文本侧车说明，尚未走多模态 provider 上传
- 验证：compose-toolbar / compose-mention 单测；shell build

## 2026-07-23 · 推理强度按模型动态档位（已回退为固定全档）

- 曾短暂按 modelId 启发式裁剪档位；用户要求先固定全档 + 超高/极限，故取消筛选

## 2026-07-23 · 桌面默认启动新壳（renderer-shell）

- **根因**：`electron .` 未设 `SYNC_THINK_SHELL=1` 时加载旧任务板 `dist/renderer`，看起来像「一夜回到解放前」
- **修复**：主进程默认加载 `renderer-shell`；`SYNC_THINK_SHELL=0|false|legacy` 才回旧壳
- 验证：rebuild main + 重启

## 2026-07-23 · 推理强度真正下发 + 深度思考块

- **Compose 推理强度**：`appendMessage.reasoningEffort` 经 runtime `prepareRunBinding` → `DemoRunState` → `ProviderCallRequest` 下发到 OpenAI/Anthropic/Responses adapter
- **Adapter**：`reasoning_effort` / Anthropic `thinking.budget_tokens`；解析 `reasoning_content` / thinking_delta / responses reasoning 为 `reasoning-delta` 事件
- **投影**：`message.reasoning_delta` 与 `run.completed.reasoningText`；不与正文混写
- **UI**：助手消息上方可折叠「深度思考」块（有数据才显示；思考中默认展开）
- 验证：adapters reasoning + stream-chat；runtime demo-run.reasoning；desktop event-history；typecheck/build

## 2026-07-23 · 修复 Compose 菜单/@ 被 overflow 裁切

- **根因**：聊天列 / 页面 flex 容器 `overflow-hidden`，菜单与 @ 列表向上弹出时只露出一截，看起来像「只有一项」
- **修复**：权限/推理/模型菜单、@ 文件列表改为 `createPortal` + `position: fixed` 锚定触发器；点击外部关闭时忽略触发按钮自身
- 验证：desktop typecheck + shell build

## 2026-07-23 · Compose 菜单/模型选择对齐 NewMax

- **权限 / 推理**：点击弹出菜单（标题+说明+勾选），不再点击循环
- **模型**：厂商 → 模型 两级选择（搜索、返回、当前模型），去掉原生 select 平铺
- **@**：仅输入 `@` 触发引用，底栏不再放 @ 按钮
- **上下文环**：按当前模型估算窗口上限 + 已用 tokens（usage 事件或本地字符粗估）
- 验证：desktop typecheck + shell build

## 2026-07-23 · Compose 输入栏对齐 NewMax（附件 chip + 底栏工具）

- **@ 选中**：不再插入 `@path` 文本，改为上方附件 chip（文件名 + 移除）
- **发送**：正文 +「引用文件」列表一并交给模型
- **底栏工具**（对照 NewMax 图标语义）：
  - 盾牌 = 权限三档
  - 地球 = 联网开关
  - 大脑 = 推理强度（自动/低/中/高）
  - 拼图 = Skill 占位
  - @ = 打开文件引用
  - 右侧模型选择 + 上下文环占位 + 圆形发送
- 验证：compose-mention 测试；desktop typecheck + build

## 2026-07-23 · 执行步骤 UI 对齐 NewMax 工具卡

- **去掉外层「执行过程 · N 步」大框**，每步独立卡片
- 标题中文：`读取文件` / `执行命令` / `列出文件` + 状态勾选
- 展开体字段：`Path` / `Command` / `Output`（像 NewMax 详情）
- 运行中与最近两步默认展开，其余可点开
- 验证：desktop typecheck + shell build

## 2026-07-23 · P2 Compose @ 文件引用

- **主进程** `desktop:list-project-files`：在绑定项目根目录下遍历文件（跳过 node_modules/dist/.git 等），支持模糊过滤 + 数量/深度上限
- **Compose**：输入 `@` 弹出文件选择器；↑↓ 选择 / Enter·Tab 插入 / Esc 关闭；插入为 `@相对路径 `
- **未绑定项目**：弹出层提示需先绑定文件夹
- 验证：compose-mention + project-files 单测；desktop typecheck + build

## 2026-07-23 · P2 对话管理：侧栏搜索 + 归档区

- **搜索**：最近对话顶部搜索框，本地过滤标题 / 目标显示名 / targetRef
- **归档区**：`listConversations({ includeArchived: true })`；侧栏底部可折叠「归档」；菜单支持取消归档
- 验证：shell-state 测试；desktop typecheck + shell build

## 2026-07-23 · 「询问批准」改为确认卡（非直接禁写）

- **语义修正**：`ask` 不再隐藏/硬拒 `write_file`/`run_command`；模型仍可请求，runtime 挂起并 emit `tool.approval_requested`
- **用户确认**：消息流出现批准卡（路径/命令 + 批准/拒绝）；`conversation.decideToolApproval` 继续或拒绝工具循环
- **workspace / full-access**：仍自动执行项目内写/命令
- 验证：chat-tools 测试更新；protocol/runtime/desktop 构建

## 2026-07-23 · P1 收尾：权限三档生效 + 停止生成

- **权限持久化**：Compose 权限 pill 切换时调用 `setConversationExecutionMode` 落库，失败回滚本地态
- **权限生效**：runtime 按 `conversation.executionMode` 裁剪内置工具；`ask/read-only` 仅只读工具，`write_file/run_command` 本地拒绝并返回中文提示；system prompt 同步声明权限档
- **停止生成**：流式中 Compose 发送钮变停止，调用 `run.cancel`；demo run 持有 `AbortController`，取消时中止 provider 流与工具循环
- 验证：chat-tools 4/4；storage/runtime/desktop 构建通过

## 2026-07-23 · 文件变更 UI 精修（对齐 NewMax 编辑器感）

- **消息内卡片**：去掉嵌套边框，扁平行 + chevron 展开；单文件默认展开，多文件列表优先
- **代码预览**：highlight.js 按扩展名高亮；软 gutter（无竖线）；行高/字号贴近编辑器
- **右栏 Changes**：加宽 360px；文件列表 + 编辑器顶栏（文件名/路径/A|M|D）+ 全高预览
- 验证：desktop typecheck + shell build；execution-process 6/6

## 2026-07-23 · 文件变更内联内容预览（对齐 NewMax）

- **根因**：`write_file` 的 tool result 只有 `{created, bytes}`，投影层把 preview 写成「已写入」；真正正文在 `arguments.content`，且常只出现在 `tool.requested`
- **修复**：
  - `projectExecutionProcess` 从 write 参数提取正文，跨 requested→completed 缓存 content
  - `fileChanges.preview` / 步骤 preview 改为文件正文（带行数截断）
  - `FileChangesCard` 默认在路径下内联带行号的代码预览
  - 右栏 Changes 同步用 `CodePreview` 展示正文
- 验证：execution-process 6/6

## 2026-07-23 · 冷启动不再等全量事件回放

- **根因**：`RuntimeSession.connect()` 会 `await subscribeEvents(0)` 把历史事件全部 catch-up 完才返回；Shell 又在 `connect().then(refresh)` 之后才 `listConversations`，所以打开应用要等很久侧栏才有对话
- **修复**：
  - `connect()` 只等 pipe/hello + healthcheck，事件回放改后台追赶
  - 事件去重改为 `Set` O(1)，顺序追加避免每条事件全量 merge
  - Shell 显示「加载中…」状态，连接成功后立刻刷对话列表
- 验证：`runtime-session` 2/2、desktop typecheck + full desktop build

## 2026-07-23 · 执行过程默认直出路径 + 右栏去掉过程

- **过程步骤默认可见**：`Read/List/Edit/Bash` 后直接显示路径或命令，无需点开；附一行结果摘要
- **输出预览改为可选**：「查看输出」才展开全文，避免默认刷屏
- **文件变更卡片**默认列出全部改动文件
- **右栏去掉「过程」Tab**，避免与对话内执行过程重复；右栏只保留 Changes / 任务
- 验证：desktop typecheck、shell 构建、execution-process 5/5

## 2026-07-23 · 执行过程明细 / 消息底栏 / 文件变更 Changes（对齐 NewMax）

- **执行过程明细卡**：步骤标题中英混合（`Read · path` / `Bash · cmd`）；可点开看路径、命令、输出预览、exit code；相邻同操作合并 `×N`
- **消息底栏**：助手消息底部固定「复制 / 重新生成 / 分享」；分享先复制 Markdown；有 `provider.usage` 时显示 token
- **文件变更卡片**：聚合本轮 `write_file` 为「已更改 N 个文件」；支持展开全部 / 侧栏查看
- **右栏 Changes Tab**：文件列表 + 预览；从消息卡片或过程路径点入自动打开
- 验证：desktop typecheck；shell 构建；聚焦测试 **15/15**

## 2026-07-23 · 聊天多轮上下文 + 工作区文件工具

- **根因 A（看不到上下文）**：聊天 run 只发「当前这一句」`userText`，没有把同 thread 的历史 user/assistant 轮次喂给模型
- **根因 B（读不到目录）**：聊天路径既没注册 `list_files/read_file` 等内置工具，也没在模型请求 tool-call 后本地执行；且仅当对话所属 workspace 绑定了真实 `folderPath` 才可启用文件工具
- **修复**：
  - `buildChatMessagesFromEvents` 从 durable events 组装多轮上下文
  - 绑定项目文件夹时注入 `CHAT_BUILT_IN_TOOL_SCHEMAS`，并在 `tool-requests` 后本地执行工具再回灌模型
  - 未绑定文件夹时 system prompt 明确告知不可读本地目录；ChatView 顶部显示「未绑定项目文件夹」警告
- 验证：runtime/desktop typecheck；chat-tools + demo-run **8/8**；shell 重建

## 2026-07-23 · 新壳消息悬停操作条 + 对话内执行过程块

- **悬停操作条**：用户/助手消息悬停显示「复制」按钮（NewMax 式轻量浮层），复制成功显示「已复制」
- **对话内执行过程**：助手消息上方可折叠「执行过程 · N 步」；从 eventHistory 投影 tool requested/completed/failed；相邻同标签合并 `×N`；流式时默认展开
- 新增 `execution-process.ts` / `ExecutionProcessBlock.tsx`；单测 3/3；shell 构建通过

## 2026-07-23 · 新壳消息 Markdown + 代码高亮（对齐 NewMax）

- **助手消息**改为 GFM Markdown 渲染（标题/列表/引用/表格/任务列表/链接），不再纯文本 `pre-wrap`
- **代码块**：语言标签 + 一键复制 + highlight.js 语法着色；行内 code 单独样式
- **流式**：输出中显示光标；用户消息保持纯文本密气泡（更接近 NewMax）
- 新增 `shell/MarkdownContent.tsx` + 样式 token 化（深浅色）；单测 3/3 通过
- 依赖：desktop 增加 `react-markdown` / `remark-gfm` / `rehype-highlight` / `highlight.js`

## 2026-07-23 · 新壳重进对话恢复历史消息

- **根因**：ChatView 打开时清空本地消息，只监听实时 `message.delta` / `run.completed`，从不加载 connect snapshot / 事件历史；`Conversation` 摘要也未暴露 `taskId`，无法解析 thread。
- **修复**：
  - `Conversation` / `toConversationSummary` 带出 `taskId`
  - ShellApp 维护 shell 级 `eventHistory`（connect snapshot + live `onEvent`）
  - ChatView 用 `openTask` 解析 `threadId`，再以 `projectConversation(eventHistory, threadId)` 投影用户/助手消息
  - 发送仍走乐观本地气泡，等 durable history 落地后自动去重
- 验证：desktop typecheck + 新壳构建；实窗重开已有对话应看到历史消息。

## 2026-07-23 · P1.1 对话↔任务绑定（数据层）

- **迁移 0025 `conversation_task_binding`**：`conversation` 表新增可空 `task_id` 列 + `conversation_task_idx` 索引；对话首条消息惰性创建的 task 将绑定于此（一对话一 task）。
- **`SqliteConversationStore.bindTask()`**：幂等绑定——已绑同 task 直接返回，绑不同 task 抛错，守住「一对话一 task」不变量；`ConversationRecord`/`get`/`SELECT` 均带出 `taskId`。
- **测试**：team-model 新增 bindTask 幂等/拒绝用例；migrate / artifact-store / reviewer-rework 的迁移序断言同步到 0025。storage 全量 **232/232**、`tsc` + 构建通过（Node 20 运行 vitest）。
- **说明（下一片 P1.2 前需定）**：runtime 侧「首条消息惰性建 task」尚未接——现有 `createTask` 必须绑定 workspace 且硬编码 `participation_mode='conversation'`，而对话可为「未归类」（无 workspace）。需先定：未归类对话的 task 落在哪个 workspace（收件箱/默认），以及 track→participation_mode 映射（当前二者正交、无映射）。

## 2026-07-23 · 新壳侧栏微调：⋯ 悬停菜单 + 可收起面板

- **行操作改悬停 ⋯ 菜单**：会话行去掉右键 ContextMenu，改为悬停/置顶时浮现的 `⋯`（MoreHorizontal）按钮，点击打开 Radix DropdownMenu（重命名 / 置顶 / 归档 / 删除），对齐 NewMax 交互；菜单打开时按钮保持可见，点击不误触打开对话。置顶态单独常显图钉。
- **侧栏可收起**：`ShellNavState.sidebarCollapsed` + `toggleSidebar` reducer；展开态标题栏有收起按钮，收起后为 52px 图标轨（一级导航图标 + 展开按钮）。
- 验证：shell-state 测试 **7/7**、desktop `tsc --noEmit`、新壳构建通过；bundle 含 `conversation-menu-trigger` / `sidebar-toggle`。

## 2026-07-22 · 新壳 P0 完成：选择弹窗 / 标题 / 顶栏项目 Tab / 右键菜单

- **P0.1 标题**：侧栏与会话头不再显示裸 targetRef；模型对话经 Provider 目录解析显示名，未命中兜底「模型对话」。
- **P0.2 新建选择弹窗**：三个 ＋ 打开 Radix Dialog；模型按厂商两级分组 + 搜索；智能体/小队列表带空态「去库创建」跳转；选中即建并打开。
- **P0.3 顶栏项目 Tab**：「全部」+ 项目 Tab（悬停显示路径）+「＋打开文件夹」（pickFolder→createWorkspace）；对话按项目过滤，新对话归属当前项目；无项目时「未归类」正常可用。
- **P0.4 右键菜单**：会话行 Radix ContextMenu：重命名（prompt）/ 置顶 / 归档 / 删除（二次确认）；删除/归档当前会话时清除选中态。
- 验证：shell-state 测试 **6/6**、desktop `tsc --noEmit`、新壳构建通过；实窗验收通过（P0.1–P0.3 用户已确认，P0.4 本条随附）。
- 规格状态更新：`2026-07-22-full-roadmap-newmax-parity.md` P0 标记完成，下一阶段 P1（聊天核心）。

## 2026-07-22 · 可变 Agent/小队真表 + 一等对话 + NewMax 壳重写启动

- **数据模型（迁移 0024）**：新增可变 `agent` / `team` / `team_member` / `team_run` / `conversation` 五表；`agent` 由旧 `agent_version` 链每个 agentId 的最新版本一次性种子；未发布的 `team_template*` 三表 DROP。编辑即 UPDATE，无版本链；唯一历史是小队开跑时冻结进 `team_run.roster_snapshot_json` 的成员快照（进行中 Run 不受后续编辑影响）。
- **权限唯一旋钮**：`conversation.execution_mode` 是产品里唯一权限面；agent / team_member 表不含任何权限列。置顶（pinnedAt）为 DB 真源，替代本机 UI 偏好置顶。
- **协议与 Runtime**：新增 18 条命令（globalAgent 4 + team 6 + conversation 8），含 payload 严格校验、事件发布、错误映射；`upgradeTrack` 仅允许 model→agent/team。Desktop main IPC / preload 桥 / global.d.ts 全链接通。
- **新渲染层骨架**（`src/renderer/shell/`，Tailwind v4 + Radix + lucide）：NewMax 风格 design tokens（深浅色跟随系统）、最近对话三分组侧栏（各组独立 +、置顶、树状层级）、舞台切换；`SYNC_THINK_SHELL=1` 加载新壳，旧 renderer 并行保留至功能对齐。
- 规格：`docs/superpowers/specs/2026-07-22-mutable-team-model-and-shell-rewrite.md`（Locked）。
- 验证：storage **231/231**（含新模型 11 项与迁移断言更新）、runtime 聚焦 **11/11**、protocol **16/16**、desktop shell **5/5** + `tsc --noEmit`、全仓 `pnpm build` **11/11**。

## 2026-07-23 · 最近对话层级与置顶

- 左栏取消 `模型 / 智能体 / 小队` 平铺切换与 `今天 / 昨天 / 近 7 天 / 更早` 日期分组，改为 `最近对话 → 模型对话 / 智能体对话 / 小队对话 → 会话` 的可折叠层级。
- 每个对话类型标题右侧提供独立 `+`；新建后固定归入对应类型，Compose 不再承担对象类型切换。
- 会话行新增置顶/取消置顶，置顶项只在所属类型内提到前面，不跨类型重排；折叠状态、置顶和兼容期 track 元数据保存在本机 UI 偏好。
- 左栏视觉收敛为 NewMax 式安静密度：弱化品牌、分隔与大按钮，统一深浅色 token、hover/focus/选中态，并保留键盘可达与减少动画支持。
- 本轮不更换 Electron + React 技术栈：现有栈足以实现目标视觉，换栈不能替代信息架构、组件层级和 token 设计。
- 验证：Desktop 聚焦测试 **28/28**、typecheck、Desktop build 通过。


- 规格锁定：`docs/superpowers/specs/2026-07-22-newmax-shell-nav-agent-model.md`（权限只跟对话、Agent 默认 Skill 进项目可用、子任务默认嵌本对话、分屏 P0/P1、统筹代审等）。
- Desktop 主导航改为 NewMax 式一级：`对话 / 项目 / 智能体 / 小队 / 能力 / 设置`；对话下增加三轨 `模型对话 / 智能体对话 / 小队对话`。
- 新增 `product-shell-nav.ts` 投影主舞台、右栏产品 Tab、Compose talk target 与升级规则；遗留 left-instrument 仅作抽屉兼容映射。
- Compose 增加对象选择器骨架：`模型 | 智能体 | 小队`，与左侧 talk track 双向同步；权限仍为对话级三档，不给 Agent 再配权限。
- 分屏能力写入规格：P0 右栏弱分屏，P1 双对话分屏与项目「对话|文件」分屏。
- 验证：Desktop 导航相关 **26/26**；UI Kit Compose **33/33**；`@sync-think/ui-kit` build；`@sync-think/desktop` `tsc --noEmit` + build 通过。

## 2026-07-16 · 对话优先工作区与自动协作升级

- 左侧项目树不再常驻显示绑定目录或“未绑定文件夹”副标题；完整目录只在项目 hover / focus tooltip 中出现。
- Compose 新增项目入口和项目菜单，项目、Agent、模型统一在输入区切换；切换项目会恢复该项目最近任务，没有任务时明确引导新建。
- 新建任务直接生成内部占位标题，不再弹命名框；首条用户消息会在同一个 CAS 事务中自动推导标题与目标，避免消息成功但命名丢失。
- 任务头移除重复的当前队友、模型摘要和手动 `对话 / 协作 / 自动` 切换；底层 participation mode、不可变计划版本与审批闸仍保留。
- 对话会识别显式多 Agent / 小队 / 分工 / 并行意图以及多阶段复杂任务，在原对话页自动升级到 collaboration，并按已配置的精确 AgentVersion 生成可编辑计划；计划仍需用户批准后才执行，不静默替换模型。
- Desktop 旧的 Automatic CTA 源码契约已更新为对话升级契约；Runtime 临时目录清理在已复现路径加入 Windows 原生重试，Runtime 集成测试预算调整为 15 秒以覆盖全仓并行负载。
- 验证：根 `pnpm test` **20/20 tasks**，Desktop **356/356**，Runtime **225/225**；`pnpm typecheck` **20/20 tasks**；`pnpm build` **11/11 tasks**；`git diff --check` 通过。
- 视觉验收：静态 Renderer 在 **1440×900** 与 **1280×720** 均无横向溢出，任务头、Compose、项目菜单和左右轨无重叠；浏览器预览实测新建任务无命名弹窗。
- 已知门禁债务：根 `pnpm lint` 在读取源码前因缺少 ESLint 9 `eslint.config.*` 全包失败，本轮不将 lint 记为通过，也不在交互改版中扩大全仓 lint 配置范围。

## 2026-07-16 · 本地工具执行纵切与桌面折叠轨修复

- File Worker 已支持受限读文件、列目录和原子写文件；Terminal Worker 以命令 capability allowlist、固定 `cwd`、无 Shell、超时/取消和输出限幅执行；Git Worker 以固定 argv 提供 `status / diff / log / branch`。
- File、Terminal、Git 在执行前同时校验词法路径和真实路径，拒绝 `..`、绝对路径及 symlink/junction 逃逸；文件删除继续禁用，Windows `.cmd/.bat` 仅通过严格包装执行并拒绝变量展开、引号和连接元字符。
- Production Executor 已接入 `read_file / list_files / write_file / run_command / git_status / git_diff` 工具循环；仅对已绑定项目目录、声明 `tool-calling` 的模型和普通执行 Step 开放。
- 动态工具调用复用 Scheduler 审批策略：请求先持久化并进入 `awaitingApproval`，批准后以同一 Step 和幂等键恢复；`0023_provider_execution_checkpoint` 单独保存循环检查点。
- OpenAI Responses、OpenAI Chat Completions 和 Anthropic Messages 已支持工具 schema、流式工具调用与结果回传；任务最终产出正文 Artifact 和 JSON 工具轨迹 Artifact，密钥不进入 Renderer、提示词、日志或工具轨迹。
- 桌面主操作文案收敛为“准备协作计划”，移除右轨重复 CTA；折叠右轨固定为仅图标控制，不再把标题和说明压成竖排文字。
- 验证：根 `pnpm test` **20/20 tasks**、`pnpm typecheck` **20/20 tasks**、`pnpm build` **11/11 tasks**；静态桌面 1440×900 与最小宽度 1280×720 无横向溢出、控件重叠或按钮文字溢出。
- 已知门禁债务：默认 `pnpm lint` 未适配 ESLint 9 flat config；以 legacy 配置兼容运行后，4 个包通过、7 个包仍有存量空接口/规则插件/正则与旧测试 lint 错误，本轮不将 lint 记为通过。
- 当前边界：Browser Worker、Windows UIA Worker、图像生成完整管线、安装器/签名/自动更新仍未实现，Phase 3 仅为部分完成。

## 2026-07-16 · 对话中的 Agent 成为可见协作者

- 任务顶部结构位从误导性的 `决策 / 记忆 / 上下文` 改为 `工作区 / 任务 / 对话`。
- M1/M2 完成后，开发验收用的 `M1 验证` 工作台退出普通产品界面；历史投影与证据未删除。
- 助手消息恢复 Agent 身份，但不恢复厚重消息卡：左侧圆形头像、名称、流式状态与右侧无框 Markdown 正文组成一条轻量队友消息。
- 消息从 `run.started.agentVersionId` 解析精确不可变 AgentVersion；历史消息可区分不同 Agent，旧消息有当前绑定 Agent 回退。
- Agent 图标支持 `bot / workflow / planner / executor / image / reviewer` 等 Lucide 映射、Emoji 和名称首字回退，颜色仅作为辅助身份信号。
- 点击头像或名称可打开对应智能体中心；模型、凭证与 Run 元信息继续留在 Trace / Manifest。
- 验证：UI Kit **215/215**、Desktop **323/323**、全仓强制 test **20/20（0 cache）**、typecheck **20/20**、build **11/11**；Electron 重启与头像跳转实窗通过，stderr 0 bytes。

## 2026-07-15 · M1 dogfood 门槛改为一天并关闭 M1

- 用户明确将 M1 dogfood 门槛从 3 个真实日期改为 **1 个真实使用日**；自动化和脚手架仍不计数。
- 新增 `m1-dogfood-policy.ts` 作为 Desktop 单一真源，产品默认 `M1_DOGFOOD_REQUIRED_DAYS = 1`；退出证据、手测、退出路径、快照、证据包、状态栏等统一使用该策略。
- 既有 `docs/development/dogfood/2026-07-12.md` 是有效真实记录，当前从 1/3 更新为 **1/1**；外网手测保持 **18/18**，M1 正式完成。
- 当前里程碑文案统一为“外网 18/18 · dogfood 1/1 · M1 已完成”；辅助导出仍保持 `claimsM1Closed=false`，即辅助组件本身不能篡改里程碑。
- TDD RED：关键退出投影 5 项按预期失败；完成审计再捕获“仅 dogfood 达标误报 M1 完成”边界 1 项。最终 GREEN：Desktop **318/318**、UI Kit **213/213**、全仓强制 test **20/20（0 cache）**、typecheck **20/20**、build **11/11**、M1 full GREEN、M2 **5/5**。

## 2026-07-15 · 当前里程碑状态投影与过期文案清理

- Desktop 手测投影以 `14-external-gateway-handtest.md` 为外网完成真源：文档 `18/18` 时外网待证归零，状态进入 `awaiting-dogfood`，只显示 dogfood `1/3` 与剩余 2 个真实日期。
- 验证区“当前里程碑状态”改为动态投影，明确 M2 协作/自动模式、CC Switch 完整导入已经完成；移除“当前禁用”“勿启动 M2”等过期声明。
- 退出路径、dogfood 草稿、证据包、会话就绪条及 Provider / Agent / 审批 / Memory 面板统一为“外网 18/18，M1 仍等待真实 dogfood”。
- 证据包 footer 按真实手测计数输出；`18/18` 显示“已完成”，不再反向提示仍需完成同一门槛。
- 实窗追加审计发现并清理外网聚焦卡、证据包标题、回归提示、差异空态、soft 快照、手测粘贴稿与 dogfood 草稿中的二级旧副本；`18/18` 后不再提供重复外网验收 CTA。
- 验证：首轮 Desktop 定向 **48/48**、UI Kit 定向 **75/75**，追加 dogfood-only 投影定向 **53/53**；Desktop 全量 **316/316**、UI Kit 全量 **213/213**；typecheck **20/20**、build **11/11**、M1 quick GREEN、M2 selftest **5/5**。
- 实窗：最终 Electron 可访问文本只显示“外网手测 18/18 已完成 → dogfood 1/3”“M2 已完成”，未再出现“勿启动 / 当前禁用 / 外网手测仍缺”等过期状态。
- 边界：没有新增 dogfood 日期；M1 仍为 **1/3** 并保持 open，总目标继续 active。

## 2026-07-15 · M2 多智能体编排纵切完成

### 已交付

- 不可变 `AgentVersion` 与 `PlanRevision`，精确版本 pin，Task participation mode 持久化。
- 持久 DAG 调度、稳定 Step ID、并行隔离快照、暂停 / 恢复 / 取消和冷恢复。
- 服务端审批策略、最严格作用域解析、Skill/MCP 精确授权与 human-only 边界。
- Reviewer evidence、有界 rework、`review.limit-reached` 暂停和不可变 ArtifactVersion。
- Artifact 三方比较、显式 Merge Step、冲突暂停、left/right/manual 解决与已解决历史。
- Desktop 计划编辑、执行图、审批、产物和 Agent 工作区；Automatic 模式计划只读并可重启恢复。
- 确定性 `selftest:m2`，覆盖精确退出序列、版本数量、唯一终态、安全证据和 Runtime 重启恢复。

### P1 审查

- ApprovalCenter 保存一条规则时保留同策略的全部后续规则。
- 持久 Runtime 使用 Windows DPAPI；XOR 仅限显式测试配置或旧凭据迁移。
- Provider 创建、轮换和 CC Switch 导入补偿边界新增持久事件失败覆盖，数据库不会引用已删除的新密钥 handle。
- 本轮审查未发现 M2 阻断项。

### 验证与状态

- M2 selftest **5/5**；Provider compensation **6/6**；全仓强制 test **20/20 tasks，0 cache**；typecheck **20/20**；build **11/11**。
- M1 六项退出标准完成最终审计；M1 full 与四组聚焦复核全绿；路线图已同步为“M2 完成、M1 dogfood 1/3”。
- Electron 1426×893 浅色和 1266×761 深色通过，无溢出、错误覆盖层或 console warning/error。
- **M2 完成**。M1 外网 18/18，但 dogfood 仍 **1/3**；总目标继续保持 active。

## 2026-07-13 · M1 真实外网、Fallback、取消、恢复与安全验收

- 完成 `14-external-gateway-handtest.md` 18/18：CC Switch 导入的 Provider / 密钥分组 / 模型可直接运行且可编辑。
- 真实 `grok-4.5`、`gpt-5.6-sol` 调用成功；Unity2.Ai Claude 无额度返回 503，按外部可用性处理。
- 真实 Fallback 从 Claude Haiku 切至 `gpt-5.5`，链位、Manifest、Trace 与唯一终态均正确。
- 真实取消持久化为 `run.cancelled`，Composer 恢复，无重复完成；记录网关批量增量限制，不虚构部分输出。
- 冷重启恢复与 11-secret / 255-file 安全扫描通过；证据导出无明文凭据。
- 边界：外网门槛已通过；dogfood **1/3**，M1 仍 open，等待真实日期累计。

## 2026-07-12 · Codex 式消息流 + 紧凑 Composer

- 助手消息改为无边框 Markdown 阅读流，支持 GFM 列表、代码、表格、引用与链接；不执行原始 HTML。
- 对话正文不再重复显示 `SYNC-THINK`、模型 UUID、Run ID；运行观测仍保留在 Trace / Manifest。
- 用户消息保留右侧紧凑气泡；Composer 移除模式、工作区、模型数量与 readiness 面板。
- Composer 左下保留分组 → 供应商 → 模型入口，右下使用图标发送 / 停止；异常时只显示一条可行动阻塞提示。
- Runtime / 任务 / 模型 blocker 现在参与真实发送门禁；异步发送失败保留原输入草稿，成功后才清空。
- Agent 默认模型显示真实 `providerModelId`（例如 `grok-4.5`），未知 UUID 不再截断展示。
- 验证：UI Kit 192、Desktop 267、根测试 20/20 tasks、typecheck 20/20、build 11/11；Electron 1425×894 与约 1266×761 实窗通过。
- 边界：**M1 仍 open**；外网手测 0/18、dogfood 0/3；不启动 M2。

## 2026-07-16 — Multica 参考的新人桌面工作区

- 左栏由图标工具条升级为带文字的产品导航：任务、智能体、模型源、审批；记忆保留为次级入口。
- 任务区新增明确 `新建任务`，本地文件夹与嵌套任务行为不变。
- 任务头新增负责 Agent 和运行模型；Context 槽收敛为单一 `下一步`。
- 右栏默认显示用户可理解的任务进度、负责人和产物；原 Trace/Manifest/执行图/审批/版本工具进入 `执行详情`。
- 健康对话移除常驻 readiness 仪表，异常仅显示紧凑恢复条。
- 全新用户/空任务状态改为三步上手，不再暴露 Runtime 检查清单。
- `AppShell` 新增兼容的 `traceTitle` / `traceAriaLabel`，`WorkspaceNav` 新增兼容的 `hideBrand`；默认行为不变。
- 验证：Desktop 334、UI Kit 216、root test/typecheck/build 全绿；1427×894、1366×768、1280×720 Electron QA 通过。

## 2026-07-12 · soft #65 · Provider 可编辑 + CC Switch 导入

- `provider.update`：名称 / baseUrl / 协议 / 发现开关 / 标签；可选 apiKey 轮换。
- `provider.previewCcSwitchImport` + `provider.importCcSwitch`：本机 CC Switch SQLite 预览→确认；密钥入 secure store；TD-009 合规。
- UI：Providers 面板「编辑」「从 CC Switch 导入」。
- M1 仍 open（外网手测 0/18 + dogfood 0/3）。

## 2026-07-12 · soft #64 · Codex 式左栏工具抽屉 + Provider 错误中文化

- Desktop 左栏：常驻工作区/任务树，四工具改为 Lucide 图标工具条，底部固定紧凑 Runtime 状态。
- 工具详情：Provider / Agent / 记忆 / 审批共用覆盖式 dialog 抽屉；支持 toggle/replace/Esc/backdrop/close/jump-open。
- UI Kit：`WorkspaceNav` 新增兼容默认行为的 `hideFooter`；AppShell nav 改为内部滚动所有权与明确 stacking context。
- CSS：抽屉 `clamp(336px, 28vw, 420px)`，不改变 Locked 三栏 grid；移除永久仪器卡片与多重滚动。
- Provider UX：新增 `provider-error-copy.ts`，把 fetch/timeout/auth/rate-limit/non-JSON/404 转为可行动中文。
- 现场诊断：`www.kamenking.top` DNS 不可解析，发现请求未到达网关；需确认真实域名及 Base URL 是否包含 `/v1`。
- 测试：Desktop 261、UI Kit 177、根级 715 tests、typecheck、build、M1 quick soft 通过。
- 边界：**M1 仍 open**；外网手测 0/18、dogfood 0/3；不启动 M2。

## 2026-07-12 · soft #63 · Codex 式主工作台减负 + Runtime replay 修复

- `m1-obs-layout`：新增 product workspace disclosure 语义；中心验证工作台默认折叠、跳转自动展开、展开体限高滚动。
- Desktop：产品态启用 `hideReadiness`，去除 Workspace/AppShell/Mode/Continuum/Manifest/Trace 重复自检块；业务内容与 Locked 三栏 IA 保留。
- ui-kit：`WorkspaceNav` 新增已测试的 `hideReadiness`。
- Runtime：`appendEvent` 在持久模式走 `SqliteEventCheckpointStore.commitTransition`，统一全事件序列来源，修复 replay 重复/逆序导致的 `runtime.protocol-error`。
- Storage：`listTasks` 同时间排序 tie-break 从随机 ULID 改为插入 `rowid`。
- 测试：根级 707 tests、typecheck、build、M1 quick soft、Electron 真实截图全部通过。
- 边界：**M1 仍 open**；外网手测 0/18、dogfood 0/3；不启动 M2。

## 2026-07-12 · soft #61+#62 · 硬门槛条 + 左侧仪器切换 + Skill 导入 UX

- 新增 `apps/desktop/src/renderer/m1-hardgate-strip.ts` + `tests/m1-hardgate-strip.test.ts`
- 新增 `apps/desktop/src/renderer/left-instrument-switch.ts` + `tests/left-instrument-switch.test.ts`
- `index.tsx`：主路径顶部硬门槛条；左侧 tab 切换；Skill import preflight 中文错误
- `AgentBindingPanel`：填入示例 · 错误贴近导入区 · 失败保留草稿
- CSS：左侧单面板布局 · hardgate 条 · import error 高亮
- soft full GREEN · Electron PID 17820 · **M1 仍 open**

## 2026-07-12 · soft #60 · M1 观测布局减负（主路径轨）

- 新增 `apps/desktop/src/renderer/m1-obs-layout.ts` + `tests/m1-obs-layout.test.ts`
- `index.tsx`：主路径轨（下一步 / 外网聚焦 / 退出路径）置顶；次要 soft 观测默认折叠于 `m1-obs-secondary`
- flash 次要面板时自动展开；CSS `.st-demo-m1-rail` / `.st-demo-m1-more`
- softCraftRound **60** · soft full GREEN · Electron PID 61620
- 仍不关 M1、不开 M2

## 2026-07-12 · soft craft #59 · 外网聚焦贯通 next / exit / evidence（M1 仍 open）

- next-action：`buildExternalHandtestAction` · CTA `focus-external` / `jump-external-item` / `copy-external-runsheet` · 跳转含 compose
- exit-path：步骤 `external-focus-assist`（kind `external-focus`）在外网逐项前
- evidence-bundle：可选 `externalFocusMarkdown` · TOC「外网聚焦运行单」· 摘要「含外网聚焦」
- UI：主条/路径金色高亮 · softCraftRound **59** · Electron PID 14100
- 测试：next 17 · exit 15 · evidence 11 · soft full GREEN
- **不关 M1 · 不开 M2**

## 2026-07-12 · soft craft #58 · 手测「下一外网项」聚焦条

- 新增 `m1-external-focus.ts`：按清单顺序聚焦首个外网待证项 + 队列 + 外网运行单粘贴
- UI：`m1-external-focus` 聚焦条（跳面板 / 开文档 / 复制运行单 / 筛选外网）
- softCraftRound **58**；单测 9/9；soft full GREEN
- **不** 关 M1；**不** 启动 M2

## 2026-07-12 · soft #57 · 下一步合入 dogfood 补填板

- `m1-next-action.ts`：fill 输入；`buildWriteDogfoodAction`；CTA `open-dogfood-fill` / `copy-dogfood-fill`；`isM1NextDogfoodFillAction`
- `index.tsx`：接线 + handler 闪补填板；`data-cta-action` / `data-fill-level`；softCraftRound → **57**
- CSS：补填类下一步蓝色边
- 单测 14 项；**不关 M1**

## 2026-07-12 · soft #56 · 退出路径合入 dogfood 补填板

- `m1-exit-path.ts`：输入 fill 信号；硬步 `dogfood-fill-assist`（kind `dogfood-fill`）；CTA `open-dogfood-fill` / `copy-dogfood-fill`
- `index.tsx`：board + 两处 paste + 证据包路径 + 点击处理；softCraftRound → **56**
- CSS：补填步蓝色高亮
- 单测 11 项；**不关 M1**；草稿仍不计有效日

## 2026-07-12 · soft #55 · 证据包并入 dogfood 多日补填

- `formatM1EvidenceBundle` 可选 `dogfoodFillMarkdown`；TOC 新增 `dogfood-fill`
- 导出自动合入多日补填板；摘要「含补填/无补填」；preview 可附补填
- 单测扩展；softCraftRound → **55**
- **不关 M1**；草稿仍不计有效日

## 2026-07-12 · soft #54 · dogfood 多日补填板

- 新增 `apps/desktop/src/renderer/m1-dogfood-fill-board.ts`：多日窗口缺文件、scaffold/draft/real 分级、主 CTA、粘贴板、密钥 scrub
- UI：M1 退出区「dogfood 补填」卡（chips + 主按钮 + 可点行 + 复制多日补填）
- 单测 9 项；softCraftRound → **54**；soft pack 纳入 fill-board
- **不关 M1**；不把粘贴草稿算有效日

## 2026-07-12 · soft craft #53 · 本机领先差异可点跳 + 退出路径合入

- **范围**：M1 硬门槛辅助（不关 M1）
- **改动**：
  - `m1-handtest-doc-diff.ts`：行级 CTA（打开文档 / 跳转 / 双动作）、主行动 `primaryCta`、`planM1HandtestDocDiffCta`
  - `m1-exit-path.ts`：输入 `liveAheadCount`/`docAheadCount` → 步骤 `doc-live-ahead`
  - UI：差异主按钮 + 可点差异行 + 高亮手测清单项；CSS 简洁 CTA
  - softCraftRound **53**
- **测试**：doc-diff 6/6 · exit-path 7/7 · soft full GREEN · dual 4/4 · tsc/build 通过
- **边界**：不自动勾文档 · 不写 dogfood · claimsM1Closed=false · 勿启 M2

## 2026-07-12 · soft craft #52 · 证据包并入文档↔本机差异

- `m1-evidence-bundle.ts`：可选 `docDiffMarkdown` · TOC `doc-diff` · 导出含「## 文档↔本机差异」
- 一键导出自动合入 `formatM1HandtestDocDiffPaste`（#51）
- 单测 **9/9**（含无差异 / 无路径 / 无草稿边界）
- 不变量：`claimsM1Closed=false` · 无密钥 · 不自动勾手测 · 不写 dogfood · 不关 M1 · 不启 M2

## 2026-07-12 · soft craft #51 · 文档↔本机差异板

- 新增 `apps/desktop/src/renderer/m1-handtest-doc-diff.ts`：`projectM1HandtestDocDiff` / attention 列表 / 粘贴稿 / secret-free
- 单测 `tests/m1-handtest-doc-diff.test.ts` **3/3**
- UI：手测对照上方差异板（本机领先/文档领先/外网待证/对齐）+ **复制文档差异**
- soft catalog suite `handtest-doc-diff`；runner softCraftRound=51
- 不变量：只读 · 不自动勾 · 无密钥 · 不写 dogfood · 不关 M1 · 不启 M2

## 2026-07-12 · soft craft #50 · 手测文档逐项勾选徽章

- 新增 `apps/desktop/src/m1-handtest-doc-parse.ts`：`parseHandtestDocMarkdown` / `mapHandtestDocBoxesToItems` / secret-free 检查
- 单测 `tests/m1-handtest-doc-parse.test.ts` **5/5**
- Main IPC `desktop:m1-exit-evidence` 成功路径返回 `handtestBoxes`（修 TS6133 未使用变量）
- Preload + `global.d.ts` + 渲染层：徽章 **文档✓ / 文档□ / 文档—**（`data-doc-checked`）
- soft 回归 catalog suite `handtest-doc-parse`；runner softCraftRound=50
- 不变量：只读文档 · 不自动勾 · 无密钥 · 不写 dogfood · 不关 M1 · 不启 M2

## 2026-07-12 · soft craft #49 · 证据包并入退出路径

- `m1-evidence-bundle.ts`：可选 `exitPathMarkdown` · TOC `exit-path` · 导出含「## 退出路径」
- 一键导出自动合入 `formatM1ExitPathPaste`（#48）
- 单测 **8/8**（含无路径 / 无草稿边界）
- 不变量：`claimsM1Closed=false` · 无密钥 · 不自动勾手测 · 不写 dogfood · 不关 M1 · 不启 M2

## 2026-07-12 · soft craft #48 · M1 退出路径板

- 新增 `apps/desktop/src/renderer/m1-exit-path.ts`：`projectM1ExitPath` / `formatM1ExitPathPaste` / `isM1ExitPathStepActionable` / `exitPathLooksSecretFree`
- 单测 `tests/m1-exit-path.test.ts` **6/6**
- UI：退出路径卡（手测对照上方）· 顶栏「复制退出路径」· 步骤 CTA（开文档 / 复制草稿与证据包 / 跳转 Providers·Agent·Compose）
- soft 回归 catalog 增加 suite `exit-path`
- `navigateToInstrument` 支持 `compose`（聚焦输入 · 不自动发送）
- 不变量：`claimsM1Closed=false` · 进度 ≤99% · 无密钥 · 不自动勾手测 · 不写 dogfood · 不关 M1 · 不启 M2

## 2026-07-12 · soft craft #47 · M1 证据包一键导出

- 新增 `apps/desktop/src/renderer/m1-evidence-bundle.ts`：`formatM1EvidenceBundle` / `projectM1EvidenceBundlePreview` / `M1_EVIDENCE_BUNDLE_SECTIONS`
- 退出证据区证据包卡 + 「导出证据包」/「一键导出」；手测区快捷「证据包」
- 永远 `claimsM1Closed=false`；不含密钥；不自动勾手测/不写 dogfood/不关 M1
- 单测 `tests/m1-evidence-bundle.test.ts` 7/7；回归 catalog 登记 evidence-bundle

## 2026-07-12 · soft craft #46 · soft 回归筛选 + 行跳转

- `filterM1SoftRegressionRows` / `countM1SoftRegressionFilter`：全部/缺口/外网/auto红
- `resolveM1SoftRegressionRowAction`：打开手测/dogfood、跳转 Providers/Agent/轨迹、重连、复制矩阵
- UI：筛选芯片 + 可点行 CTA；`data-filter` / `data-action`
- 单测 8/8；**不**关 M1、**不**自动勾手测、**不**启动 M2

## 2026-07-12 · soft craft #45 · M1 soft 回归矩阵（自动 vs 手测）

- 新增 `apps/desktop/src/renderer/m1-soft-regression.ts`：纯函数矩阵 + markdown 导出 + 密钥 scrub
- UI：退出证据区紧凑回归板 + 复制按钮；手测区「回归矩阵」入口
- 脚本：`scripts/selftest-m1-soft-regression.mjs`；根脚本 `selftest:m1-soft` / `selftest:m1-soft:quick`
- 单测：`tests/m1-soft-regression.test.ts`（6）
- **不**关 M1、**不**自动勾手测、**不**启动 M2

## 2026-07-12 · soft #44 · 生成失败恢复 CTA

- `classifyStreamFailure` / `scrubFailureText`：失败类别中文 + 密钥打码
- 会话就绪条失败恢复按钮：Providers / Fallback / 轨迹 / 诊断 / 聚焦 Compose
- 可观测：`conversation-stream-failure` · `data-failure-kind` · `data-cta-action`
- 测试：stream readiness **18/18**；dual **4/4**
- **不**关闭 M1 · **不**启动 M2 · **不**自动重发

## 2026-07-12 · soft #43 · dogfood 计分加固

- 新增 `apps/desktop/src/m1-dogfood-score.ts`：粘贴草稿 / 待你确认 不计有效 dogfood 日
- 退出证据按日板：`草稿` 态 + 计分原因 + `data-draft-count`
- 主进程 `listDogfoodDayReports` 带回 `isPasteAssist` / `reasons` / `statusHint`
- 测试：`m1-dogfood-score.test.ts` 等 39 项相关通过；dual 4/4
- **不**关闭 M1 · **不**启动 M2

## 2026-07-12 · soft #42 · 复制 dogfood 日记草稿

- 渲染：`formatM1DogfoodDayDraft` + 退出证据/手测「复制 dogfood 草稿」
- 测试：dogfood-draft 4；dual 4/4
- **不自动写盘 · 不算有效日 · M1 仍 open · 未启动 M2**

## 2026-07-12 · soft #41 · 手测进度粘贴稿 + 外网/缺口筛选

- 渲染：`formatM1HandtestPaste` / 筛选全部·缺口·外网 / 复制手测进度按钮
- 测试：handtest-paste 4；dual 4/4
- **M1 仍 open** · **未启动 M2**

## 2026-07-12 · soft #40 · dogfood 按日打开 + 手测分区进度

- 主进程：`dogfood-day` 白名单 + `isValidDogfoodDayDate` + 路径约束
- 渲染：退出证据 dogfood 行可点打开；手测对照分区板（pre/A/B/C/D）
- 测试：open-doc 7 · section-board 3；dual 4/4
- **M1 仍 open** · **未启动 M2**

## 2026-07-12 · soft · dogfood 按日明细 + 聚焦刷新（#39）

- 主进程 listDogfoodDayReports；IPC 返回 dogfoodDays
- 退出证据 UI 按日 有效/脚手架
- 窗口 focus/visible 自动重读手测与 dogfood
- 测试：exit 11/11 · load 3/3 · dual 4/4
- **不**关闭 M1 / **不**启动 M2

## 2026-07-12 · soft · 复制 soft 快照（#38）

- `formatM1SoftSnapshot` 生成可贴 Markdown（无密钥、不关 M1）
- 退出证据 / 手测对照：复制 soft 快照按钮 + 反馈条
- 测试：snapshot 4/4 · dual 4/4
- **不**关闭 M1 / **不**启动 M2

## 2026-07-12 · soft · 退出证据芯片可行动 + 打开反馈（#37）

- 退出证据芯片：handtest/dogfood 打开文档；soft/dual 刷新
- 打开结果反馈条（ok/warn/error + basename）
- 手测对照头：打开手测文档 / 今日 dogfood
- 测试：chip-action 7/7 · M1 套件 37 · dual 4/4
- **不**关闭 M1 / **不**启动 M2

## 2026-07-12 · soft · 「下一步」主 CTA 可行动（#36）

- offline → 重新连接 Runtime
- 外网手测 → 系统打开 14-external-gateway-handtest.md
- dogfood → 打开/创建今日日记
- 主进程白名单 IPC，禁止任意路径
- 测试：next 10/10 · open-doc 4/4 · dual 4/4
- **不**关闭 M1 / **不**启动 M2

## 2026-07-12 · soft · Runtime 手动重连 CTA（#35）

- 对话流就绪条 / 空对话：离线时「重新连接 Runtime」
- 记录 `lastConnectFailure`（code + retryable）并投影中文提示
- 事件监听与 connect 生命周期拆分，避免重连丢订阅
- 测试：stream 9/9 · runtime 5/5 · dual 4/4
- **不**关闭 M1 / **不**启动 M2

## 2026-07-12 · soft · M1「下一步」主行动条

- 新增 `apps/desktop/src/renderer/m1-next-action.ts`：`projectM1NextAction` / `isM1NextActionJumpable`
- 任务头 CTA：`m1-next-action`（soft/hard 分闸 + 跳转或刷新）
- 测试 **9/9**；dual **4/4**；**不关 M1**

## 2026-07-12 · soft · 手测项点击跳转面板

- `resolveM1HandtestItemJump` / `isM1HandtestItemJumpable`；投影项带 jumpTarget
- 手测列表可点行 → `navigateToInstrument` 闪烁对应面板
- 测试 8/8；dual 4/4；**不关 M1**

## 2026-07-12 · soft · 手测对照清单 live 投影

- 新增 `apps/desktop/src/renderer/m1-handtest-checklist.ts`：`M1_HANDTEST_ITEMS`（18）+ `projectM1HandtestChecklist`
- 任务头 UI：`m1-handtest-checklist` 列表 + `m1-known-limits` 已知限制；本机/外网闸门分色
- 测试：`tests/m1-handtest-checklist.test.ts` **5/5**；dual **4/4**
- 边界：soft 可观测；**不关 M1 / 不开 M2**；文档勾选仍需人手

## 2026-07-12 · soft · M1 退出证据进度条

- 新增 `projectM1ExitEvidenceProgress` / IPC `desktop:m1-exit-evidence`（只读 docs handtest + dogfood）
- 任务头「退出证据」：soft / dual / 手测 x/y / dogfood n/3 + 刷新
- 单测 8/8；dual 4/4；**不关 M1**

## 2026-07-12 · soft · 会话芯片跨面板跳转

- `resolveM1SessionChipJump` / `isM1SessionChipJumpable`；芯片附 `jumpTarget`/`jumpHint`
- 可跳芯片按钮：`m1-session-chip-jump-*` → scroll + `data-nav-flash`；Manifest/轨迹会先展开轨迹栏
- 单测 7/7；dual 4/4；**不关 M1**

## 2026-07-12 · soft · 会话就绪 Memory 芯片

- `projectM1SessionReadiness` 增加 memory 字段与芯片；ready 要求 memoryOk
- desktop 会话条接线 memoryEntries/changes/diagnostics
- dual 网关复测 4/4；**不关 M1**

## 2026-07-12 · soft · Memory/Diagnostics 就绪纯投影

- 新增 `projectMemoryDiagnosticsReadiness` / `MemoryDiagnosticsReadiness*`
- Memory 就绪条统一投影；根节点 data-level；12/12 测；**不关 M1**

## 2026-07-12 · soft · 批准中心闸门就绪纯投影

- 新增导出：`projectApprovalGateReadiness` / `ApprovalGateReadiness*`（`ApprovalCenterPanel.tsx`）
- 批准闸门条统一投影；根节点 data-level；单测 13/13；**不关 M1**

## 2026-07-12 · soft · Agent 能力就绪纯投影

- 新增导出：`projectAgentCapabilityReadiness` / `AgentCapabilityReadiness*`（`packages/ui-kit/src/components/AgentBindingPanel.tsx`）
- Agent 能力就绪条改为统一投影；根节点 `data-testid="agent-binding-panel"` + `data-level`
- 单测 27/27；**不关 M1**

## 2026-07-12 · Compose 发送就绪纯投影（M1 soft）

- `packages/ui-kit/src/components/Compose.tsx`：`projectComposeSendReadiness` + form data-level
- 测试：`Compose.test.tsx` projector 套件
- 边界：soft craft，**不关 M1 / 不开 M2**

## 2026-07-12 · Providers 多模型就绪纯投影（M1 soft）

- `packages/ui-kit/src/components/ProvidersPanel.tsx`：`projectProvidersReadiness` + badge/note/data-level
- 测试：`ProvidersPanel.test.tsx` projector 套件；dual 网关 4/4 复测
- 边界：soft craft，**不关 M1 / 不开 M2**；外网手测与 dogfood 仍缺

## 2026-07-12 · WorkspaceNav 工作区导航就绪投影（M1 soft）

- `packages/ui-kit/src/components/WorkspaceNav.tsx`：`projectWorkspaceNavReadiness` + 6-check 就绪条 + filtering 档
- `packages/ui-kit/src/styles/components.css`：partial/filtering 色边
- 测试：`packages/ui-kit/tests/WorkspaceNav.test.tsx`
- 边界：soft craft，**不关 M1 / 不开 M2**

## 2026-07-12 · AppShell 工作区布局就绪条（M1 soft）

- `packages/ui-kit/src/components/AppShell.tsx`：`projectAppShellReadiness` + 就绪条 UI；`hideReadiness`；`data-level`
- `packages/ui-kit/src/styles/components.css`：`st-app-shell__readiness*` 含折叠 compact 竖排
- 测试：`packages/ui-kit/tests/AppShell.test.tsx` readiness 套件
- 边界：soft craft，**不关 M1 / 不开 M2**

## 2026-07-12 · 对话流 empty/stream 统一可观测（soft · M1 open）

## 2026-07-12 · 参与模式就绪条（soft · M1 仍 open）

- soft craft：`projectModeReadiness` + `mode-switch-readiness`；四档 m1/mixed/m2-open/locked
- 自测：ModeSwitch 10/10；dual 4/4；builds GREEN
- 下一优先：外网网关 UI 手测 / dogfood；**勿关 M1、勿开 M2**

## 2026-07-12 · Manifest 可检查就绪条（soft · M1 仍 open）

- soft craft：`projectManifestReadiness` + `manifest-readiness` 八项 checks；amended/inspectable 分档
- 自测：ManifestPanel 22/22；builds GREEN
- 下一优先：外网网关 UI 手测 / dogfood；**勿关 M1、勿开 M2**

- desktop：`conversation-stream-readiness.ts` 纯投影
- 对话列 stream 条 + 空对话卡片同源；六项 checks；Run 摘要中文状态
- 样式：`st-conversation-readiness*`

## 2026-07-12 · ContinuumRail 连续体就绪条（soft · M1 open）

- ui-kit：`ContinuumRail` 增加 `projectContinuumReadiness` 与就绪条（空/结构位/绑定/有证据/流式）
- desktop：无任务真 empty；有任务 scaffoldOnly 结构位；接 streaming
- 样式：`st-continuum__readiness*`

## 2026-07-12 · AppShell 运行轨迹中文 + 工作区结构条（soft · M1 open）

## 2026-07-12 · TraceList 运行轨迹就绪条（soft · M1 open）

- ui-kit：`TraceList` 增加 `projectTraceReadiness` 与就绪条（空/部分/有轨迹/流式）
- desktop：去掉伪 waiting 轨迹条目，接 `hasActiveTask` / `streaming` / 真 empty
- 样式：`st-trace__readiness*` 对齐其它 M1 就绪条

## 2026-07-12 · 第 16 次 soft craft · Compose 发送就绪条 + dual 网关复测

### Compose 发送就绪条

- 发送区 soft 可观测：模型/绑定来源/Runtime/任务/跨 Provider/输入
- desktop 接线 connectionState / hasActiveTask / agentDefaultSet
- dual 网关自动化复测通过（仍非外网 UI 证据）

## 2026-07-12 · 第 15 次 soft craft · 会话就绪条接入 Agent/审批

### 会话就绪条 · Agent / 审批

- `projectM1SessionReadiness` 增加 agent / approval chips 与 soft ready 条件
- desktop 任务头接线：`agentBinding` + `approvalPendingCount`

## 2026-07-12 · 第 14 次 soft craft · Agent 能力就绪条

### Agent 能力就绪条（UI 可观测）

- `AgentBindingPanel`：顶部 readiness strip（模型 / fallback / 凭证 / Skill / MCP / dirty）
- 样式：与 Approval/Memory readiness 统一，Agent 六项三列
- 测试：empty / partial / ready + dirty 翻转

### 非目标本轮

- 未关 M1；未开 M2；未做外网网关证据

- AppShell：运行轨迹中文 + 折叠不暂停提示
- WorkspaceNav：§15.2 工作区结构就绪条 + Runtime 中文连接态
- **M1 仍 open**

## 2026-07-12 · 批准中心 + Memory 闸门就绪条（soft · M1 open）

- UI：ApprovalCenterPanel / MemoryDiagnosticsPanel 增加与 Providers 同风格的中文就绪条与空态卡片
- 可观测：仅限真人闸、待审 attention、MemoryChange 链路说明、§23.2 已知限制计数
- 测试：Approval 6/6、Memory 6/6；desktop rebuild + Electron 重启
- **M1 仍 open**（外网手测 + dogfood 未完成）

## 2026-07-12 · 任务头 M1 会话就绪条（M1 soft）

- Continuum 下全局「会话就绪」芯片条（对齐 Providers soft 门槛）
- `m1-session-readiness.ts` 纯投影 + 单元测试
- 连接状态「已连接 · 持久事件流」
- **不关 M1**；**不进 M2**

## 2026-07-12 · Providers 多模型就绪条（M1 soft）

- Providers 顶部「多模型就绪」：≥2 Provider / ≥3 模型 / 密钥遮罩 / 协议种类
- 中文计数与 discovery meta；soft 门槛文案与「不关 M1」说明
- 测试：ProvidersPanel 6/6
- **不关 M1**；**不进 M2**

## 2026-07-12 · Compose/消息气泡中文可观测（M1 soft）

- Compose 默认占位与 a11y 中文化；取消流式 aria 中文化
- MessageBubble 流式/角色中文 aria；desktop meta「流式中」
- 测试：Compose 18 / MessageBubble 4
- **不关 M1**；**不进 M2**

## 2026-07-12 · Manifest 解析阶梯（M1 soft）

- **UI** Manifest 详情：解析阶梯与 §5.3 绑定优先级对齐；Fallback 链位可观测
- **文案** 凭证解析中文化；`agentFallback` → Fallback
- **修复** 补 `credentialResolutionLabel`（此前引用未定义会编译失败）
- **测试** ManifestPanel 15/15
- **范围** soft craft；不关闭 M1；不启动 M2

## 2026-07-12 · Agent 绑定优先级可观测（§5.3）

- Agent 面板顶部 precedence ladder：本轮覆盖 / 工作流(M2) / Agent 默认 / Fallback
- 与 Compose 本轮覆盖语义对齐，便于 M1 退出标准 #2 界面举证
- **M1 仍 open**

## 2026-07-12 · Continuum/Mode 中文可观测 + dogfood 脚手架

- ContinuumRail 中文 kind + empty；ModeSwitch 中文标签 + M1 禁用协作/自动
- desktop 任务头挂 ModeSwitch；线程标签中文化
- dogfood/2026-07-12.md 脚手架
- **M1 仍 open**

## 2026-07-12 · Compose 多模型 chips + Trace 中文标签

- Compose：compose-model-chips 快速切换本轮模型；摘要「本轮覆盖 / Agent 默认」；agentFallbackCount / multiProvider 可观测
- TraceList：类别中文（模型调用 / 恢复 / …），data-category 仍为英文
- desktop：绑定 fallback 数量与跨 Provider 提示；会话条中文化
- 测试：Compose 17 · TraceList 2 · builds GREEN
- **M1 仍 open**（无外网 UI 手测 / dogfood 证据不关闭）

## 2026-07-12 · Diagnostics 可行动恢复 + 已知限制（§23.2 #9/#12）

- 新增 `packages/ui-kit/src/diagnostics/recovery.ts`：failureClass → 中文标签 / 是否可重试 / 恢复步骤 / 建议跳转
- MemoryDiagnosticsPanel：诊断可展开恢复指南；固定「已知限制」区（协议、能力启发式、MCP 发现≠执行、密钥、M1 退出）
- ProvidersPanel：顶部协议与 Provider 限制说明
- desktop：诊断「前往」滚动到对应左栏并短暂高亮
- 门禁脚本：`scripts/selftest-dual-gateway.mjs`
- **M1 仍 open**（无外网 UI 手测 / dogfood 证据不关闭）

## 2026-07-12 · Provider 协议持久化 + 发现失败 Diagnostics（M1 soft）

- DB：`provider.protocol` + migration `0007_provider_protocol`
- 发现：按持久化协议路由；响应带 protocol / addedIds / previousModelCount
- 失败：scrubbed diagnostics + UI 刷新可观测
- UI：协议徽章；发现状态条增强
- 测试：storage 69 · provider-commands 5 · ProvidersPanel 4 · desktop build GREEN
- M1 仍 open（外网手测 / dogfood）

## 本轮进度：2026-07-12 · MCP 刷新目录可观测 + 自测闭环

- UI：MCP 工具名 chips + 空目录提示
- 测试：refresh 后 peek tool-schema；AgentBinding 14 条
- 文档：新增固定大白话自测 `13-plain-selftest-log.md`
- M1 仍 open

## 本轮进度：2026-07-12 · MCP tools/list 刷新目录（§9.3 discovery · soft）

### 变更

- **新增** `mcp.tools.refresh`：local-stdio 真 JSON-RPC `tools/list` 发现工具 Schema 并写入 MCP 注册表
- **新增** workers `list-tools` action + `extractToolsList`（限幅 / untrusted / 审计 · 不执行工具）
- **事件** `mcp.tools_refreshed`（catalog delta：added/removed）
- **UI** AgentBindingPanel「刷新工具目录」+ Desktop 状态条可观测
- **desktop** IPC/preload/renderer 贯通；修复 renderer 类型导入使 build GREEN
- **测试** runtime mcp-commands 增至 7 条；ui-kit AgentBinding 13 条

### 不在本切片

- 外网网关手测、dogfood ≥3 天、M2 工作流图
- 刷新后自动改 Agent 白名单（**禁止**静默 allowlist）

## 本轮进度：2026-07-12 · MCP JSON-RPC 真工具调用（§9.3/§13/§14）

### 变更

- **新增** `mcp.tool.call`：白名单 + 敏感闸 + 审批后真 JSON-RPC tools/call（非模拟）
- **新增** workers `jsonrpc-stdio` 帧编解码 + mini-mcp fixture（echo/ping/write_file）
- **扩展** `approval.decide` 响应可选 `mcpToolCall`（execute-on-approve）
- **UI** AgentBindingPanel「真工具调用」；renderer 状态条与审批结果可观测
- **测试** runtime 2 条 e2e（allowlist 拒绝 / 入队批准执行 / trusted auto ping / fake 拒绝）

### 不在本切片

- 外网网关手测、dogfood、多 Agent 工作流图（M2）

### 2026-07-12 · MCP 真 spawn 探测骨架（soft，M1 仍 open）

- 新增 `LocalStdioMcpWorker`：local-stdio 真进程探测（超时/限幅/untrusted/审计）
- 新增命令 `mcp.spawn.probe` / 事件 `mcp.spawn_probed`
- Desktop UI：Agent「真 spawn 探测」+ 可观测状态条
- 路径边界：`mcp.policy.probe` 仍模拟；`mcp.tool.request` 仍只入审批队

## 2026-07-12 · Skill 批准后自动白名单绑定（§9.1 / §9.3 → §13）

- soft：`approval.decide` 对 skill-permission 批准 → 默认 Agent skillVersionIds 自动绑定
- 导入仍不白名单；拒绝不绑定；可替换 previousSkillVersionId
- 响应 `skillAllowlist`；UI 状态条「已写入 Skill 白名单」+ 刷新 Agent
- 测试：runtime skill-commands 2 · approval 5 · desktop rebuild
- **不关闭 M1**

## 2026-07-12 · MCP 敏感工具调用 → 审批中心入队（§9.3 → §13）

- soft：`mcp.tool.request` 敏感度闸门 + enqueue kind=`mcp-permission`（永不 spawn）
- core：`evaluateMcpToolSensitivity`；trusted 低风险可 auto-approve 不入队
- UI：Agent 模拟工具名 +「请求工具审批」；审批中心「MCP 权限」；状态条中文
- 测试：core 5 / runtime mcp-commands 3 · approval 5 / ui-kit 10 / desktop rebuild
- **不关闭 M1**

## 2026-07-12 · Memory → 审批中心双向桥接（§10.4 → §13）

- soft：pending `memory.propose` enqueue Approval Center（kind=`memory`）
- 双向镜像：`approval.decide` ↔ `memory.decide`（metadata.memoryChangeId）
- 响应 `approvalRequest`；autoApprove 不入队
- UI：Memory/审批状态条中文 + 事件双向刷新
- 测试：runtime memory-commands 4 · approval-commands 5 · desktop rebuild
- **不关闭 M1**

## 2026-07-12 · Skill 升级自动入队审批中心（§9.3 → §13）

- soft：`skill.import` 在 permissionDiff.requiresReapproval 时 enqueue `skill-permission`
- 响应 `reapprovalRequest`；事件 `approval.requested`；UI 状态条 + 审批中心刷新
- 导入仍不自动白名单；人批队列可观测
- 测试：runtime skill-commands 2 · approval-commands 5 · desktop rebuild
- **不关闭 M1**

## 2026-07-12 · 审批中心骨架（§13 / §15.1-8）

- soft：approval-policy + approval_request 持久化 + runtime 四命令 + ApprovalCenterPanel
- 模式 request|delegate|full|custom；human-only 不可被 delegate/full 绕过
- UI 左栏可观测：策略试算、演示入队、待审批准/拒绝、状态条大白话
- 测试：core 12 / storage approval 4 + migrate 11 / runtime approval-commands 5 / ui-kit 4
- **不关闭 M1**

## 2026-07-12 · Skill 升级权限 diff / 需重新批准（§9.3）

- soft：`diffSkillPermissions` + `skill.import.permissionDiff`
- 同名升级新增 tools/scripts → requiresReapproval；首次导入不强制
- UI 状态条可观测「需重新批准」；导入仍不自动白名单
- 测试：core 69 / storage skill 4 / runtime skill-commands 2 / ui-kit AgentBinding 9
- **不关闭 M1**

## 2026-07-12 · MCP 进程策略探测骨架（§9.3）

- soft：`mcp.policy.probe` + FakeMcpWorker；输出限幅 / 超时 / untrusted / 审计 note
- storage 钳位与 workers policy 对齐（256B～1MB，100ms～120s）
- UI：超时/输出上限字段 +「探测策略」可观测状态条（不 spawn）
- 测试：storage 62 / workers 18 / runtime mcp-commands 2 / ui-kit AgentBinding 9；相关 build/typecheck GREEN
- **不关闭 M1**

## 2026-07-12 · MCP 授权骨架（§9.3）

- soft：`mcp.register` / `mcp.list` + Agent `mcpServerIds` allowlist；登记不 spawn
- Context Packet 注入 `tool-schema`；Manifest 可观测「mcp N · 入包 M」
- 测试：storage 61 / core 64 / ui-kit 62 / desktop 69；mcp-commands PASS
- **不关闭 M1**

## 2026-07-12 · Skill 正文注入 Context Packet

- soft：allowlist Skill 以 `skill-definition` 进入 Context Packet / peek
- Manifest 可观测「入包 N」；清空白名单后不再注入
- 测试：core 59 / runtime 57 / ui-kit 58
- **不关闭 M1**

## 2026-07-12 · Skill 导入 + Agent 白名单

- soft：`skill.import` / `skill.list` + Agent `skillVersionIds` allowlist；导入不执行脚本；Manifest peek 可观测

## 2026-07-12 · UI 偏好记忆（§15.2）

- desktop：theme / 轨迹折叠 / 对话布局 localStorage 持久化
- AppShell 受控折叠写回偏好；折叠不暂停 Run
- 测试：ui-kit 55 / desktop 69；build GREEN
- **不关闭 M1**

## 2026-07-12 · 单列对话布局（Locked IA §28）

- ui-kit：`MessageBubble.layout` + 单列阅读样式（全宽、角色左侧描边）
- desktop：任务头「分栏 / 单列」开关；localStorage 记忆偏好
- 测试：ui-kit 54 / desktop 64；build GREEN
- **不关闭 M1**

## 2026-07-12 · Manifest 版本可观测（§10.3）

- protocol：peek 响应增加 agentVersion / skillVersionIds / policyId
- runtime：`resolveAgentManifestMeta`；prepare/peek/packet.built/fallback 贯通；修复 amend tsc
- ui-kit / desktop：Manifest proof 展示版本；投影与 re-peek 映射
- 测试：runtime 56 / ui-kit 51 / desktop 64 / core 47；相关 build GREEN
- **不关闭 M1**

## 2026-07-12 · context.packet.amend

- Manifest 可修订：强制排除非受保护上下文来源（§10.3）
- 受保护来源（§20.9）拒绝排除并回报 refusedProtectedIds
- peek / 下次 Run / fallback 的 selection 均应用 thread 修订
- UI：排除按钮、受保护 chip、修订状态条、恢复自动

相关：`docs/development/12-test-log.md` 同日条目；M1 仍 open。

## 2026-07-12 · context.packet.peek

- 只读预览下一次 Context Packet / Manifest（无需发消息、不写 durable 事件）
- Manifest 面板「预览上下文」按钮；desktop IPC 全链路
- 与 §10.4 回滚联动：approve → peek 含项目记忆；rollback → peek 清除

## 2026-07-12 — Memory 回滚可逆（§10.4）

类型：功能 / TDD / UI / Runtime / Storage

- storage：批准版本保留；`rollbackChange` 恢复未回滚前驱；状态 `rolled_back`
- protocol：`memory.rollback` + Rollback* 类型；DEFAULT_FEATURES
- runtime：命令处理 + 事件 `memory.change.rolled_back`
- ui-kit：Memory **变更历史** + **回滚** 按钮（仅已通过）
- desktop：IPC / preload / renderer 接线与可观测状态条

相关：`docs/development/12-test-log.md` 同日条目；M1 仍 open。

## 2026-07-12 — M1: Real OpenAI-compatible model discovery

## 2026-07-12 — Agent 持久化绑定

- storage: `SqliteAgentStore` 不可变 `agent_version` 行
- runtime: 从 agent store 解析绑定；`agent.get` / `agent.updateBinding`
- ui: 左侧 `AgentBindingPanel`（default / ordered fallback / pauseOnFailure）
- 协议 features: `agent.get`, `agent.updateBinding`

### Added

- `packages/adapters/src/openai/discover-models.ts`: live `GET {baseUrl}/models` with Bearer auth, secret scrubbing, failure classification.
- `OpenAIChatAdapter` with real `discoverModels`; `OpenAIResponsesAdapter.discoverModels` no longer returns `[]`.
- Runtime `discoveryByProtocol` registry; production `main.ts` injects openai-chat/responses/images adapters.
- Provider command tests for real (mocked HTTP) model ids and auth-failure scrubbing.
- Renderer observability: discovery-in-progress status and sample real model ids.

### Notes

- Demo chat stream still uses FakeProvider until Agents/run binding.
- CC Switch full import remains M1 non-goal.
- Secrets still never enter DB/list/export/logs.

# Feature Changelog

## 2026-07-12 - M1 Providers / Credentials 可观测面板

类型：功能 / TDD / UI / Runtime / Security

相关文件：

```text
packages/storage/src/provider-store.ts
packages/protocol/src/commands.ts
apps/runtime/src/{runtime.ts,persistence.ts,command-validation.ts}
apps/runtime/tests/provider-commands.test.ts
apps/desktop/src/{provider-payloads.ts,main/index.ts,preload/index.ts}
apps/desktop/src/renderer/{index.tsx,m0-projection.ts,global.d.ts,renderer.css}
packages/ui-kit/src/components/ProvidersPanel.tsx
packages/ui-kit/src/styles/components.css
packages/ui-kit/tests/ProvidersPanel.test.tsx
docs/development/{10-current-status,03-feature-changelog}.md
docs/handoff/05-handoff-guide.md
```

变更说明：

1. Provider 注册：手动 name + baseURL + protocol + apiKey；密钥仅经 create hop 写入 SecureStore。
2. 列表/UI 永不回显明文 key；表单提交后立即清空密码字段；列表掩码显示密钥存在性。
3. 支持 FakeProvider 模型发现（create 时 supportsDiscovery）与手动 addModels。
4. Desktop 左栏 Workspace 下方挂载 ProvidersPanel；连接 Runtime 后自动 list。
5. Trace 可观测：`provider.created` / `provider.models_discovered` 人类摘要。
6. 补齐 preload/global.d.ts/IPC 与 `selectTraceEvents`（含 workspace-global provider 审计事件）。

TDD 证据：

```text
@sync-think/ui-kit：7 files / 21 tests
@sync-think/desktop：10 files / 54 tests
@sync-think/runtime：8 files / 32 tests（含 provider-commands）
build/typecheck：ui-kit + desktop + runtime pass
```

后续注意：

1. 真实 OpenAI/Anthropic adapter 与 Agent 绑定尚未完成。
2. 不初始化 Git。

---

## 2026-07-12 - M1 Conversation full history + observability UX

类型：功能 / TDD / UI / Runtime

相关文件：

```text
apps/desktop/src/renderer/{m0-projection.ts,index.tsx,renderer.css,runtime-view-state.ts,global.d.ts}
apps/desktop/tests/event-history.test.ts
apps/desktop/src/{main/index.ts,preload/index.ts}
packages/ui-kit/src/components/{Compose.tsx,MessageBubble.tsx}
packages/ui-kit/src/styles/components.css
packages/ui-kit/tests/Compose.test.tsx
packages/protocol/src/commands.ts
apps/runtime/src/{runtime.ts,command-validation.ts,demo-run.ts}
apps/runtime/tests/demo-run.test.ts
docs/development/{10-current-status,03-feature-changelog}.md
docs/handoff/05-handoff-guide.md
```

变更说明：

1. Conversation 投影重写为完整交错历史（多轮 user/assistant 保留；流式 assistant bubble；stream state idle/streaming/completed/failed/cancelled）。
2. Trace 改为 thread 作用域人类可读摘要（最多 24 条），不再仅 raw event type。
3. 中央可观测状态条：连接态、任务/thread/version、模型、生成中/失败/取消。
4. Compose 支持 streaming Cancel；Runtime 落地 `run.cancel` + `run.cancelled` 事件；Desktop bridge 透传。
5. MessageBubble 支持 streaming 光标；右栏 Run pulse 随 stream state 变化。

TDD 证据：

```text
@sync-think/desktop test：9 files / 51 tests passed
@sync-think/ui-kit test：6 files / 19 tests passed
@sync-think/runtime demo-run：6/6（含 cancel）
desktop/runtime typecheck：pass
```

后续注意：

1. Providers / Credentials / Agents / Context Packet 尚未开始。
2. 创建工作区仍为绝对路径 prompt。
3. 不初始化 Git。

---## 2026-07-12 - M1 Workspace IA Desktop UI + bridge

类型：功能 / TDD / UI

相关文件：

```text
packages/ui-kit/src/components/{WorkspaceNav.tsx,workspace-nav-model.ts}
packages/ui-kit/src/styles/components.css
packages/ui-kit/tests/{WorkspaceNav,workspace-nav-model}.test.*
apps/desktop/src/workspace-payloads.ts
apps/desktop/src/main/index.ts
apps/desktop/src/preload/index.ts
apps/desktop/src/renderer/{index.tsx,global.d.ts,workspace-catalog.ts,renderer.css}
apps/desktop/tests/{workspace-payloads,workspace-catalog}.test.ts
docs/development/{10-current-status,03-feature-changelog}.md
docs/handoff/05-handoff-guide.md
```

变更说明：

1. Desktop bridge 扩展 workspace/task 命令：create/list/open/search，Main 校验 payload 后转发 Runtime。
2. ui-kit 新增 signature 左栏 `WorkspaceNav`：文件夹→嵌套任务、inline 筛选、last-open resume pulse、空态单一 CTA、continuum spine、token-only 样式。
3. Renderer 替换硬编码 demo 树：连接后加载真实 workspace/task；打开任务切换 thread 并写 last-open；创建工作区/任务 prompt 流；聊天绑定 active thread。
4. 纯逻辑 TDD：nav model、payload validation、catalog 选择。

TDD 证据：

```text
@sync-think/ui-kit test：6 files / 17 tests passed
@sync-think/desktop test：9 files / 46 tests passed
@sync-think/ui-kit build + desktop typecheck：pass
```

后续注意：

1. Conversation 完整历史 UX / cancel stream 仍未做。
2. Providers / Credentials / Agents 尚未开始。
3. 创建工作区目前用 prompt 输入绝对路径（尚未系统文件夹选择器）。
4. 不初始化 Git。

---## 2026-07-12 - M1 启动：Workspace IA 存储与 Runtime 命令

类型：功能 / TDD / 协议

相关文件：

```text
packages/storage/src/{path-allowlist,workspace-store}.ts
packages/storage/src/{path-allowlist,workspace-store}.test.ts
packages/protocol/src/commands.ts
packages/shared/src/types/errors.ts
apps/runtime/src/{runtime,command-validation,persistence}.ts
apps/runtime/tests/workspace-commands.test.ts
docs/development/{10-current-status,03-feature-changelog,11-implementation-plan}.md
docs/product/06-roadmap.md
docs/handoff/05-handoff-guide.md
```

变更说明：

1. 进入 M1（多模型对话 Alpha）；复述退出标准与非目标。
2. 实现 workspace 路径 allowlist：绝对路径规范化、root 嵌套校验、空列表首次 onboarding。
3. 实现 `SqliteWorkspaceStore`：workspace create/list；task create/list/open/search；嵌套 parent task；默认 thread；last-open memory。
4. 协议与 Runtime 新增 `workspace.create/list`、`task.create/list/open/search`；persistent Runtime 注入 workspaceStore。
5. 新增错误码 `workspace.not_found`。

TDD 证据：

```text
storage：path-allowlist 8 + workspace-store 6 + 既有 = 32/32
runtime：workspace-commands 1 + 既有 = 29/29
runtime typecheck：pass
shared/protocol/storage build：pass
```

后续注意：

1. Desktop 左栏与 bridge 尚未接线；下一步优先 Workspace IA UI。
2. Providers/Agents/Context 尚未开始。
3. 不初始化 Git。

---

本文档记录开发过程中新增、变更、删除的功能与重要项目变更。

## 功能变更记录

### 2026-07-12 - M0 Renderer reload 修复与生命周期收口

类型：修复 / 安全 / 验收 / 收口

相关文件：

```text
apps/desktop/src/main/renderer-security.ts
apps/desktop/src/main/index.ts
apps/desktop/tests/renderer-security.test.ts
docs/development/{03-feature-changelog,10-current-status,11-implementation-plan}.md
docs/handoff/05-handoff-guide.md
docs/product/06-roadmap.md
```

变更说明：

1. 定位真实 Electron `page.reload()` / `location.reload()` 超时根因：导航守卫无条件拦截 `will-navigate`。
2. 改为仅允许受信 Renderer 位置（packaged exact file 或 dev loopback origin）导航/重定向；外链与新窗口继续拒绝。
3. 归一 `pathToFileURL` 与 Chromium file URL 编码（`%7E` vs `~`），避免合法 file URL 被判为不信任。
4. TDD：security RED 3 失败 -> GREEN；desktop full 41/41。
5. 最新构建真实验收：reload、UI restart、Runtime restart、SQLite sequence 证据全部通过。
6. 根强制门禁 `test/typecheck/build --force` 通过；M0 关闭，M1 仍未授权。

验证方式：

```text
pnpm --filter @sync-think/desktop test -> 41 passed
pnpm test --force / typecheck --force / build --force -> pass
real process acceptance (CDP location.reload + UI/Runtime restart) -> ALL_PASS
SQLite: run.started=1 provider.usage=1 run.completed=1 sequence 1..9
```

后续注意：

1. 未获用户明确授权前不得进入 M1。
2. 不初始化 Git。

### 2026-07-11 - Phase 0 技术推荐与实施计划（文档）

类型：新增（文档/计划）

相关文件：

- `docs/engineering/04-tech-decisions.md`
- `docs/development/11-implementation-plan.md`
- `docs/development/10-current-status.md`
- `docs/development/14-decision-log.md`

变更说明：

1. 完成产品设计 §24 共 11 项技术 spike（TD-004–014）的方案对比与推荐。
2. 完成 M0–M3 里程碑实施计划与确认后前 10 项工程任务。
3. 仍无业务代码实现。

影响范围：

1. 确认后将按推荐绑定存储/凭证/协议/UI 原语等实现选型。
2. 工程启动顺序以 implementation plan §9 为准。

验证方式：

```text
文档审阅；等待用户确认清单
```

后续注意：

1. 未确认前不得把 Recommended 当作已锁定依赖写入 package.json（可讨论不可安装绑定）。

类型：新增（文档/流程）

相关文件：

- `AI_DEVELOPMENT_RULES.md`
- `docs/00_START_HERE.md`
- `docs/README.md`
- `docs/product/01-requirements-clarification.md`
- `docs/product/06-roadmap.md`
- `docs/product/15-frontend-design.md`
- `docs/product/15-frontend-design-tokens.json`
- `docs/engineering/02-development-principles.md`
- `docs/engineering/04-tech-decisions.md`
- `docs/development/10-current-status.md`
- `docs/development/14-decision-log.md`
- `docs/superpowers/specs/2026-07-11-sync-think-product-design.md`（已有权威设计）

变更说明：

1. 完成 `/zno-init`，将已批准产品设计落盘为可执行项目文档。
2. 用户确认文档；确认 V3 仅锁定信息架构。
3. 前端质量标准升级为可获奖级，Claude 主导页面原创设计（Continuum Bench）。
4. 尚未开始业务代码实现。

影响范围：

1. 后续所有 UI 实现必须遵循升级后的前端设计标准。
2. 工程下一步进入 Phase 0 spike 与实施计划，而不是直接堆功能。

验证方式：

```text
文档审阅；无运行时验证（无应用代码）
```

后续注意：

1. §24 spike 未完成前不要绑定具体驱动/凭证库/UIA 库。
2. UI 实现禁止直接复用 V3 原型视觉。

### 2026-07-11 - M0 工程骨架 9 个包落地（代码 + 60 单测）

类型：新增（代码/工程）

相关文件：

```text
package.json / pnpm-workspace.yaml / turbo.json / tsconfig.base.json
.prettierrc.json / .eslintrc.cjs / .nvmrc
apps/desktop/{package.json,tsconfig.json}
apps/desktop/src/main/index.ts, preload/index.ts, renderer/{index.html,renderer.css,index.tsx}
apps/runtime/{package.json,tsconfig.json,src/{index.ts,runtime.ts,main.ts,healthcheck.ts,pipe/server.ts},tests/*}
packages/shared/src/{index.ts,types/*}
packages/protocol/src/{index.ts,version.ts,framing.ts,handshake.ts,commands.ts,events.ts,pipe.ts},*.test.ts
packages/secure-store/src/{index.ts,types.ts,store.ts,scrub.ts,backends/*},store.test.ts
packages/storage/src/{index.ts,connection.ts,backup.ts,fts.ts,schema/*,scripts/migrate.ts},{migrate,backup,schema-cols}.test.ts
packages/adapters/src/{index.ts,types.ts,events.ts,fake/fake-provider.ts,openai-responses-adapter.ts,openai/README.md},fake-provider.test.ts
packages/workers/src/{index.ts,types.ts,support.ts,desktop/browser/file/terminal/git/*-worker.ts},types.test.ts
packages/ui-kit/{package.json,vitest.config.ts,tsconfig.json,tests/setup.ts,scripts/generate-css.mjs,src/{index.ts,theme.ts,styles/{index.css,components.css},components/*}},tests/*.tsx
packages/test-fixtures/src/{index.ts,provider/{battery,sse-recordings}.ts,skill/skills.ts,ccswitch/imports.ts}
scripts/{dev-desktop.mjs,pipe-client.mjs}
```

变更说明：

1. 完成 M0.1–M0.5 全部 9 个不需要 native 绑定的包骨架 + 60 个单测（含安全：secure-store 明文不落盘、CredentialRef 无明文列、adapter 不泄漏 API Key、workers 路径穿越防护 + 站点白名单）。
2. 实装协议双端：命名管道服务器 + Hello 握手 + HMAC + version + 能力协商；FakeProvider 流式 + AdapterEvent 统一；Runtime 进程能起并 handshake 回包。
3. Continuum UI Kit 完整浅深双主题 token 化（从 `15-frontend-design-tokens.json` 生成 CSS 变量）+ 签名组件 AppShell/ContinuumRail/MessageBubble/TraceList/Compose/ModeSwitch + reduced-motion 兜底，jsdom 测试覆盖。
4. Electron main 预留 safeStorage broker（contextBridge + contextIsolation + nodeIntegration: false）；/preload + /renderer 已成型但二进制未编译无法启动。

仍受阻断：better-sqlite3 / electron / esbuild 三个原生模块因本机未装 VS Build Tools 无法编译，故 storage 实跑、dev:desktop 启动、runtime 事件流端到端暂不能跑（决策 DEC-20260711-004）。

影响范围：

1. M0 实跑链路待用户装好工具链即可一键贯通，无返工。

验证方式：

```text
node node_modules/typescript/bin/tsc -b packages apps  -> 全绿
node node_modules/vitest/vitest.mjs run --root <pkg>   -> 60 个单测通过（shared 4 / protocol 13 / secure-store 7 / storage 12 *
adapters 5 / workers 7 / ui-kit 9 / runtime 3；storage 直连 better-sqlite3 的用例暂跳过等 native）
SYNC_THINK_DEV_NO_TOKEN=1 pnpm dev:runtime            -> Runtime 进程启动并可握手
pnpm dev:runtime:pipe-test                           -> 应看到 Hello ok 与 healthcheck 回包
```

- storage 的 12 个是纯逻辑 (migration planner / backup / schema columns)，better-sqlite3 live 调用尚未联跑。

后续注意：

1. 装 VS Build Tools 后必须 `pnpm rebuild better-sqlite3 electron esbuild`，AI 再补 storage live / runtime subscribeEvents / checkpoint-restore / dev:desktop 启动验证。
2. 不要把 storage 改 libsql；用户已否决，TD-004 维持。

### 2026-07-11 - M0 runtime pipe commands, desktop launch chain, and native blocker isolation

Type: change / implementation / verification

Related files:

```text
package.json
pnpm-lock.yaml
scripts/dev-desktop.mjs
scripts/pipe-client.mjs
apps/runtime/src/runtime.ts
apps/runtime/tests/commands.test.ts
apps/desktop/package.json
apps/desktop/scripts/build-renderer.mjs
apps/desktop/src/main/index.ts
apps/desktop/src/renderer/index.tsx
apps/desktop/src/renderer/renderer.css
apps/desktop/tests/build-assets.test.ts
packages/test-fixtures/package.json
packages/test-fixtures/src/provider/battery.ts
packages/test-fixtures/tsconfig.json
packages/storage/src/migrate.test.ts
packages/ui-kit/src/styles/components.css
packages/core/src/index.ts
```

Change summary:

1. Fixed the Turbo test graph by removing the `test-fixtures -> adapters -> test-fixtures` cycle.
2. Implemented M0 Runtime pipe command handling for `runtime.subscribeEvents`, `runtime.unsubscribeEvents`, and `task.appendMessage`.
3. Added task-version mismatch protection and event streaming to subscribed clients.
4. Added checkpoint snapshot export/import to prove restart-state reconstruction at the Runtime logic layer.
5. Added storage live migration/FTS test coverage, guarded so it runs when `better-sqlite3` native binding exists and is skipped when the local toolchain is missing.
6. Repaired desktop build assets with esbuild and fixed root `dev:desktop` launch cwd/dependency resolution.
7. Repaired root `dev:runtime:pipe-test` by adding needed root dev tooling/dependency links and enhancing the pipe smoke client to append a message and receive a runtime event.
8. Repaired Electron postinstall/download locally; desktop smoke now starts and stays alive until intentionally killed by the smoke script.

Verification:

```text
pnpm test      -> pass; 64 tests passed; 1 storage live test skipped due missing better-sqlite3 native binding
pnpm typecheck -> pass; 20 turbo tasks successful
pnpm build     -> pass; 11 turbo tasks successful
runtime pipe smoke -> PASS; PIPE_SMOKE_OK
desktop smoke -> PASS; process still running after 8 seconds with no Electron load error
```

Remaining limitation:

```text
Visual Studio C++ Build Tools are still missing, so better-sqlite3 cannot compile for Node v24.14.1.
The storage live test is present but skipped until the native binding can be installed.
```

### 2026-07-11 - M0 native、持久化恢复与真实 Electron 链路贯通

类型：修复 / 实现 / 安全 / 验证

相关文件：

```text
package.json
pnpm-workspace.yaml
packages/protocol/src/events.ts
packages/protocol/src/handshake.ts
packages/storage/src/scripts/migrate.ts
packages/storage/src/runtime-state-store.ts
packages/storage/src/{migrate,runtime-state-store}.test.ts
apps/runtime/src/{main,persistence,runtime,demo-run,command-validation}.ts
apps/runtime/tests/{commands,demo-run,persistence,pipe,secret-persistence}.test.ts
apps/desktop/src/main/{index,runtime-client}.ts
apps/desktop/src/preload/index.ts
apps/desktop/src/renderer/{index.html,index.tsx,renderer.css}
apps/desktop/scripts/{build-preload,build-renderer}.mjs
apps/desktop/tests/{runtime-client,build-assets}.test.ts
packages/ui-kit/src/components/AppShell.tsx
packages/ui-kit/src/styles/components.css
packages/ui-kit/tests/AppShell.test.tsx
scripts/ensure-managed-pnpm.mjs
docs/operations/07-local-development.md
```

变更说明：

1. 固定 Node 20.20.2 / pnpm 10.28.2，恢复 `better-sqlite3`、Electron 与 esbuild 原生依赖；SQLite migration、FTS、WAL 与 backup 真跑。
2. 修复 migration 的 `taskId`/`task_id` 错误，并用 immediate transaction 保证失败迁移不留下部分 DDL 或迁移记录。
3. 增加 SQLite-backed Event/Checkpoint store；事件与 checkpoint 原子提交，持久化失败返回脱敏 `storage.write_failed`。
4. Runtime 默认使用 `%LOCALAPPDATA%\SYNC-THINK\sync-think.db`，重启后恢复 thread version、event sequence 和未完成 FakeProvider Run。
5. FakeProvider durable stream 覆盖 `run.started`、usage、delta 与 completed；UI 断开不终止 Run，Runtime 重启按 adapter event index 续跑且不重复 durable output。
6. 修复 Electron sandbox preload，固定输出 `dist/preload/index.cjs`；main 通过认证 named pipe 接入 Runtime。
7. 修复 StrictMode 并发连接时 `runtime.subscribeEvents` 越过 `__hello` 的竞态，阻止未认证首帧导致的 `EPIPE`。
8. RuntimePipeClient 现在隔离 stale socket、自动重连、恢复逻辑订阅，并通过 cursor 接收 missed durable events。
9. 修复订阅响应与首个 live event 同包时的丢事件窗口；客户端先投递 replay，再投递待绑定 live events，并按 sequence 去重。
10. 修复 Runtime secret 未配置时任意非空 token 可被接受的问题；token 必需模式现在同时要求服务端 secret 和正确 HMAC。
11. Renderer 加入 strict CSP，禁止 `unsafe-eval`、object、base 和 form action；真实 Electron 控制台无 warning/error。
12. 根级门禁在 managed Node 20 目录串行启用 pnpm Corepack shim，避免 Turbo 首次并发下载 Node 产生 `EEXIST/ENOENT`。
13. Continuum shell 完成浅/深主题、轨迹折叠/恢复、Lucide 图标和响应式视觉校准。

TDD 证据：

```text
RED: concurrent connect -> Runtime connection closed / EPIPE
GREEN: concurrent requests wait for authenticated hello

RED: transient disconnect -> subscription lost
GREEN: stale socket isolation + logical subscription restore

RED: active subscription does not reconnect without a command
GREEN: background reconnect with capped exponential backoff

RED: cursor subscription omits durable history
GREEN: atomic replayedEvents response + listener delivery

RED: response + first live event in one pipe chunk drops the event
GREEN: pending stream buffer preserves the handoff

RED: built renderer has no CSP
GREEN: strict local-only CSP, no Electron security warning

RED: arbitrary token accepted when Runtime secret is absent
GREEN: token-required mode rejects unconfigured Runtime authentication
```

真实进程验证：

```text
Electron footer -> 已连接 / durable stream
UI_RESTART_JOB -> Electron 结束后 Runtime PID 保持；新 Electron 重放完整 user/delta/completed 历史
RUNTIME_RESTART_JOB -> Runtime PID 66552 强制结束；PID 63244 从同一 SQLite 恢复
自动重连 -> 新 Runtime 记录 hello accepted；UI 收到剩余 delta 与 run.completed
SQLite -> run.started=1, provider.usage=1, run.completed=1, sequence 严格递增, activeDemoRuns=0
POST_RECOVERY_APPEND -> 恢复后可继续追加并完成第三条消息
Renderer -> strict CSP 生效；无 console warning/error；无横向溢出
Fresh gates -> test 20/20 tasks + 86 tests; typecheck 20/20; build 11/11; all cache bypass
Cleanup -> SYNC-THINK Runtime/Electron processes=0; named pipes=0
```

后续注意：

1. 预审查门禁通过后，独立安全/恢复审查重新打开 M0；完成状态暂不成立。
2. 未获得下一里程碑授权前，不进入 M1 真实 Provider/Agent/Context 功能。

### 2026-07-11 - M0 独立审查修复、Renderer 快照层与交接

类型：修复 / 安全 / 恢复 / TDD / 交接

相关文件：

```text
packages/protocol/src/{handshake,events}.ts
packages/storage/src/runtime-state-store.ts
apps/runtime/src/{runtime,demo-run}.ts
apps/desktop/src/event-history.ts
apps/desktop/src/runtime-bridge-contract.ts
apps/desktop/src/main/{renderer-security,runtime-client,runtime-session,index}.ts
apps/desktop/src/preload/index.ts
apps/desktop/src/renderer/{global.d,m0-projection,runtime-connection,runtime-view-state,index}.tsx/ts
apps/desktop/tests/{renderer-security,event-history,runtime-session,runtime-connect-error,runtime-connection,build-assets}.test.ts
docs/development/{03-feature-changelog,10-current-status,11-implementation-plan}.md
docs/handoff/05-handoff-guide.md
```

变更说明：

1. Pipe 升级为双向 challenge/proof 认证，并加入 fresh nonce replay 防护、统一认证失败和非重试分类。
2. replay 升为固定 high-watermark 的有界拉式分页，保留 categories 与 reconnect committed cursor。
3. `message.appended + run.started` 与 final checkpoint 在单个 immediate transaction 中原子提交。
4. Electron 仅信任明确 loopback 开发 origin 或 packaged 精确 file URL；IPC 同时验证 sender 身份和 URL；导航、重定向及新窗口全部阻止。
5. 从 main/preload/Renderer 移除 secure-store bridge；Renderer 不再接触 secret。
6. main 唯一 Runtime subscription 建立 sequence snapshot；Renderer 将 snapshot/live 排序去重并确定性重建 M0 消息、版本、assistant 和 trace。
7. hydration 前 Compose 禁用；transient 初始连接使用可取消有限退避，认证/协议/权限失败不重试。
8. forward/send 异常不再终止 durable subscription；Runtime health/error bridge 只暴露脱敏结构化字段。

TDD 与审查证据：

```text
Electron security target：5/5 passed
Renderer recovery focused：19/19 passed
Desktop full：7 files / 39 tests passed
Desktop typecheck/build：passed
每个主要任务均完成规格审查 -> 代码质量审查；最终两阶段均通过
```

真实进程状态：

1. 重建 `@sync-think/runtime` 后，raw 两阶段认证 challenge/runtime proof/client proof 全部通过。
2. 真实 Electron 在线，Compose 消息持久化并收到完整 FakeProvider assistant，console warning/error 为 0。
3. 随后的真实 Renderer `page.reload()` 在 30 秒内未完成；根因尚未定位。
4. 因此本轮未重新完成最新构建下的 UI restart、Runtime restart 与 root `--force` 三项门禁，M0 仍保持打开。

后续注意：

1. 下一对话必须先按 `docs/handoff/05-handoff-guide.md` 系统定位 reload timeout，并以 RED -> GREEN 修复。
2. 真实 Provider 跨进程计费/副作用幂等不是 M0 保证，应在最终限制中明确保留。
3. M0 关闭前不得进入 M1。

## 2026-07-12 — M1 模型绑定 / live stream / Manifest

- core: `resolveModelBinding` 优先级 + pause-on-no-fallback；`buildContextPacket`
- adapters: OpenAI Chat Completions SSE streaming + 错误分类 scrub
- runtime: 绑定注册 model、SecureStore 取钥 live call、`context.packet.built`
- desktop: trace 展示 Manifest / resolutionSource
- docs: `12-test-log.md` 固定大白话测试日志

## 2026-07-12 — Compose 模型选择器（Run override）

- ui-kit Compose：本轮模型下拉、`onSend(text, { modelId? })`、run override / agent default 可观测标签
- desktop：`buildComposeModelOptions` 扁平化注册模型；发送时带 `modelId`
- 不改 Runtime 绑定真源；沿用 resolveModelBinding + Manifest 事件

## 2026-07-12 · Memory/Diagnostics 面板 + 系统文件夹选择器

- UI：左侧 `MemoryDiagnosticsPanel`（持久记忆 / 待审变更 / 诊断）
- Desktop IPC：`memory.list` / `memory.decide` / `diagnostics.list` / `desktop:pick-folder`
- 创建工作区改用系统文件夹对话框
- secrets 仍不进入诊断与 Renderer
- `m1-obs-layout`：新增 product workspace disclosure 语义；中心验证工作台默认折叠、跳转自动展开、展开体限高滚动。
- Desktop：产品态启用 `hideReadiness`，去除 Workspace/AppShell/Mode/Continuum/Manifest/Trace 重复自检块；业务内容与 Locked 三栏 IA 保留。
- ui-kit：`WorkspaceNav` 新增已测试的 `hideReadiness`。
- Runtime：`appendEvent` 在持久模式走 `SqliteEventCheckpointStore.commitTransition`，统一全事件序列来源，修复 replay 重复/逆序导致的 `runtime.protocol-error`。
- Storage：`listTasks` 同时间排序 tie-break 从随机 ULID 改为插入 `rowid`。
- 测试：根级 707 tests、typecheck、build、M1 quick soft、Electron 真实截图全部通过。
- 边界：**M1 仍 open**；外网手测 0/18、dogfood 0/3；不启动 M2。
