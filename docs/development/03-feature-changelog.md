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
