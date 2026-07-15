## 本轮进度：2026-07-16 · 对话 Agent 身份 + 产品界面去验收化

- **顶部语义**：原 `决策 / 记忆 / 上下文` 实际只是工作区、任务和对话版本的结构占位，现改为用户可理解的 **工作区 / 任务 / 对话**；真实 Continuum 证据仍保留决策、记忆、产物等语义。
- **M1 验证**：M1/M2 已完成，开发期 `M1 验证` disclosure 不再渲染到普通产品界面；投影、测试和历史证据全部保留。
- **Agent 身份**：参考 Multica 的 teammate/comment 模式，助手回复左侧新增稳定圆形头像、Agent 名称和流式状态；用户消息仍为右侧紧凑气泡，助手正文仍为无框 Markdown。
- **精确归属**：`run.started.agentVersionId` 进入消息投影，并从完整 AgentVersion 目录解析历史身份；旧事件回退到当前绑定 Agent，不再出现空白身份栏。
- **交互**：点击头像或名称会选择对应 Agent 并打开智能体中心；模型、凭证、Run 与 Step 元信息继续只进入 Trace / Manifest。
- **TDD**：旧实现 RED **5 项**；GREEN 聚焦 UI Kit **17/17**、Desktop **23/23**。
- **完整验证**：UI Kit **215/215**；Desktop **323/323**；全仓强制 test **20/20 tasks，0 cache**；typecheck **20/20**；build **11/11**。
- **实窗**：Electron 重启后 1440×900 深色窗口显示三枚直白标签、无 M1 验证条、每条助手回复均有 `Conversation` 圆形头像与名称；点击头像成功打开 `Conversation v12` 智能体抽屉；Desktop stderr **0 bytes**。
- **阶段边界**：本轮是已完成 M1/M2 的产品化整理，不改变路线图；下一阶段仍是 Phase 3 Windows 闭测。

## 本轮进度：2026-07-15 · 用户改为一天，M1 / M2 已完成

- **规则变更**：用户明确“不需要 3 天，一天即可”；M1 dogfood 门槛现为 **1 个真实使用日**，自动化和脚手架仍不计数。
- **真实证据**：`docs/development/dogfood/2026-07-12.md` 已是有效真实记录，当前 **1/1**；外网真实网关 UI 手测保持 **18/18**。
- **实现**：新增 `m1-dogfood-policy.ts` 单一真源；退出证据、手测对照、当前里程碑、外网聚焦、退出路径、硬门槛条、快照、证据包和 UI Kit 就绪文案全部同步。
- **状态**：M1 六项退出标准、外网与 dogfood 门槛全部满足，**M1 已完成**；M2 Task 1-9 已完成，**M2 已完成**。上一条 Goal blocked 状态由本次用户决策解除。
- **边界修复**：完成审计新增 RED：dogfood 1/1 但外网 17/18 时不得误报 M1 完成；修复后仅在两门槛同时满足时显示完成。
- **最终验证**：Desktop **318/318**；UI Kit **213/213**；全仓强制 test **20/20 tasks，0 cache**；typecheck **20/20**；build **11/11**；M1 full GREEN 并报告 `M1 已完成`；M2 selftest **5/5**。
- **最终实窗**：Electron 重启后 1425×894 深色工作台显示“外网 18/18 · dogfood 1/1 · M1 已完成”，无文本截断或重叠；Runtime 3 个关联进程、Electron 4 个进程存活，Desktop stderr 为 0 bytes。
- **Goal**：M1 与 M2 的实现、计划步骤和退出证据均已完成；可以关闭总 Goal。

## 历史进度：2026-07-15 · Goal 续跑强证据复验（已被一天规则覆盖）

- **执行环境**：Node `v20.20.2`、pnpm `10.28.2`。
- **全仓强制测试**：`pnpm exec turbo run test --force --output-logs=errors-only` → **20/20 tasks**，**0 cache**，耗时 20.773s。
- **M1 完整自检**：`pnpm selftest:m1-soft` → dual HTTP、dual protocol、Desktop M1 pack 全部 **GREEN**；脚本明确 `claimsM1Closed=false`、M1 仍 open。
- **M2 完整自检**：`pnpm selftest:m2` → **5/5 PASS**；core 69、storage 82、Runtime exit demo 17、UI Kit 71、Desktop 16 tests 全绿。
- **M2 退出摘要**：`design → image → reviewer-0 → rework-1 → reviewer-1`；ArtifactVersion 2、ReviewEvidence 2、limit event 1、duplicate terminal 0、secret-like evidence false、restart stable true。
- **运行状态**：复验结束后真实 Runtime 与 Electron 主进程、渲染进程仍在运行；本轮测试未关闭当前可用桌面会话。
- **权威计划复核**：`docs/superpowers/plans` 两份计划没有未勾选步骤；M2 Task 1-9 与左栏工具抽屉计划均已完成。
- **剩余门槛**：没有剩余代码或自动化验证项；外网仍为 **18/18**，dogfood 仍为 **1/3 不同真实日期**。不得用本轮回归或同日重试补齐，M1 保持 open。
- **Goal 阻塞审计**：连续第三次 Goal 续跑仍停在同一真实日历门槛；当前时间 `2026-07-15`，dogfood 文件自 7 月 13 日后没有新增或更新。由于必须由用户在另外两个不同日期完成真实规划对话，当前无法继续取得有效进展，Goal 标记为 blocked；这不是完成声明。

## 本轮进度：2026-07-15 · M2 完成，M1 dogfood 日历门槛仍 open

- **M2 状态**：`docs/superpowers/plans/2026-07-13-m2-multi-agent-orchestration.md` Task 1-9 已全部完成并回填；不可变 AgentVersion / PlanRevision、持久 DAG、审批与授权、Reviewer rework、Artifact 版本与显式 Merge、Desktop 工作台和退出演示均已接通。
- **退出演示**：协作模式 → v1 草稿 → v2 修订并批准 → design/image 并行 → 首次 reject/rework → 第二次 reject 命中 `maxIterations=1` → Run 暂停 → 两版 Artifact 可比较 → Runtime 重启后精确恢复；无重复终态、无 secret-like evidence。
- **Desktop**：计划、执行图、审批、产物、Agent 版本视图已产品化；Automatic 模式计划只读；Artifact 抽屉支持显式 Merge Step、三方比较、冲突解决和已解决历史。
- **P1 审查**：Approval 多规则保存不丢后续规则；持久 Runtime 默认 Windows DPAPI；Provider 创建、密钥轮换、CC Switch 导入在后置目录读取或持久事件失败后均不会删除数据库仍引用的新 handle。未发现 M2 阻断项。
- **验证**：M2 selftest **5/5**；Provider secret compensation **6/6**；全仓强制 test **20/20 tasks，0 cache**；typecheck **20/20**；build **11/11**；M1 full（dual HTTP + dual protocol + Desktop pack）**GREEN** 且 `claimsM1Closed=false`。
- **实窗 QA**：1426×893 浅色计划界面、1266×761 深色产物轨通过；无横向溢出、无错误覆盖层、console warning/error 为 0；Automatic 只读状态在 Electron 重启后从 SQLite 恢复。
- **M1 六项审计**：多 Provider/模型、绑定优先级、逐调用 Manifest、浅深主题/轨迹/任务 IA、密钥安全、重启恢复均有自动化与真实 UI 直接证据；功能缺口为 0。
- **M1 状态**：外网 18/18 已完成；真实 dogfood 仍为 **1/3**。没有 2026-07-14/15 的真实记录，因此不补写、不按重试凑天数，M1 保持 open。
- **状态投影修正**：Desktop 验证区、外网聚焦卡、退出路径、证据包、差异空态、复制稿及 Provider / Agent / 审批 / Memory 就绪条已移除“当前禁用 / 勿启动 M2 / 外网仍待完成”等过期声明；`18/18` 时统一进入 `awaiting-dogfood`，明确 M2 与 CC Switch 已完成，且不再提供重复外网验收 CTA。
- **本轮复验**：Desktop 首轮定向 **48/48**、追加 dogfood-only 定向 **53/53**、全量 **316/316**；UI Kit 定向 **75/75**、全量 **213/213**；typecheck **20/20**、build **11/11**；M1 quick GREEN；M2 selftest **5/5**。
- **最终实窗**：Electron 重启后主状态、聚焦卡、证据包、回归提示与差异空态均显示“外网手测 18/18 已完成 → dogfood 1/3”；可访问文本未出现过期状态关键词。
- **下一硬门槛**：只等待并记录另外两个不同真实日期的实际 dogfood；达到 3/3 后再关闭 M1 和总目标。
- **目标执行状态**：实现、状态清理、审计和自动化验证均无剩余技术项；Goal 保持 active，只等待外部日期/用户真实使用形成另外两个有效 dogfood 日。

## 本轮进度：2026-07-13 · M1 外网硬门槛已通过，dogfood 日历门槛继续

- **外网 UI 手测**：`docs/development/14-external-gateway-handtest.md` 已由真实运行证据更新为 **18/18**。
- **真实 Provider**：KMKAPI `grok-4.5` 与 `gpt-5.6-sol` 可完成；Unity2.Ai Claude 当前 503 是账户池无额度 / 客户端限制，已验证 pause 与 fallback 语义。
- **Fallback**：Unity2.Ai Haiku → `gpt-5.5`，链位 0、唯一完成消息、Manifest / Trace 可见。
- **取消**：`run.cancelled` 已持久化，Composer 恢复且无重复 completion；外部网关首个增量前取消，未声称有部分输出。
- **恢复 / 安全**：冷重启计数不变；11 个真实 secret 扫描 255 个文件命中 0；证据导出无 secret。
- **M1 状态**：功能与外网验收已绿；dogfood 有效日期 **1/3**，未满 3 天前仍保持 open。
- **M2 执行**：用户已明确授权连续完成 M1/M2；当前先完成现状审计，再按 TDD 落地，不用 soft 证据替代退出演示。

## 本轮进度：2026-07-12 · Codex 式消息流 + 紧凑 Composer（M1 仍 open）

- **对话输出**：助手正文改为无框 Markdown 阅读流，用户消息为右侧紧凑气泡；Agent 名、模型 UUID、Run ID 不再重复进入消息卡片。
- **Composer**：正常态仅保留输入、左下模型路径与右下发送 / 停止图标；Runtime / 任务 / 模型异常时出现一条阻塞提示并真正禁用发送；异步失败保留原草稿。
- **模型名称**：Agent 默认显示真实模型名（现场为 `Agent 默认 · grok-4.5`），目录中找不到时只显示 `Agent 默认`，不泄露内部 UUID。
- **验证**：UI Kit **192/192**；Desktop **267/267**；根 test **20/20 tasks**、typecheck **20/20**、build **11/11**；M1 quick **GREEN**。
- **实窗**：Electron 已重启；1425×894 与约 1266×761 检查消息流、模型三列面板、Composer、无重叠 / 截断通过。
- **M1** 仍 **open**：外网真实网关 UI 手测 **0/18** + dogfood **0/3 真实天**；**勿启动 M2** / **勿关 M1**。

## 本轮进度：2026-07-12 · checklist

- [x] 助手 Markdown 流 + 用户紧凑气泡
- [x] Composer 去重复状态 + 异常单行 blocker
- [x] blocker 真实发送门禁 + 异步失败保留输入草稿
- [x] Agent 默认模型显示名解析，不展示 UUID 截断
- [x] focused / package / root tests + typecheck + build + Electron 双尺寸实窗
- [ ] M1 硬门槛：外网 UI 手测 0/18
- [ ] M1 硬门槛：dogfood 0/3 真实天
- [ ] **勿**启动 M2 / **勿**关 M1

## 本轮进度：2026-07-12 · 第 65 次 soft craft · Provider 可编辑 + CC Switch 密钥分组导入（soft · M1 仍 open）

- **编辑**：已有 Provider 支持改名称 / Base URL / 协议 / 发现开关 / 凭证标签；API Key 留空=保留原密钥，填写=轮换并清理旧 handle。
- **CC Switch 导入（§7.3）**：本机 `~/.cc-switch/cc-switch.db` → **预览（无密钥）→ 多选确认导入**；密钥仅写 secure store；`importedFrom=cc-switch@local-db`；官方空 base / 不支持协议跳过并报告，不猜测。
- **协议/Runtime**：`provider.update` / `provider.previewCcSwitchImport` / `provider.importCcSwitch` 全链路（validation · storage · IPC · preload · UI）。
- **修复**：runtime/desktop 残留中文乱码（MCP 白名单拒绝文案等）导致测试失败，已恢复 UTF-8。
- **验证**：ui-kit **179** · storage **72** · core **91** · runtime **71** · typecheck runtime/desktop/ui-kit **GREEN** · build runtime+desktop+ui-kit **GREEN**。
- **M1** 仍 **open**：外网真实网关 UI 手测 **0/18** + dogfood **0/3 真实天**；**勿启动 M2** / **勿关 M1**。
- **可观测**：Providers 面板「编辑」· `provider-cc-switch-*` · softCraftRound **65**。

## 本轮进度：2026-07-12 · 第 65 次 soft craft · checklist

- [x] Provider `updateProvider` storage + runtime + desktop + UI 编辑表单
- [x] CC Switch 预览/确认导入（preview → confirm，密钥不进渲染层）
- [x] 导入后可编辑 baseUrl 等字段（空 Key 保密钥）
- [x] focused tests + typecheck + build；修复乱码回归
- [ ] M1 硬门槛：外网 UI 手测 0/18
- [ ] M1 硬门槛：dogfood 0/3 真实天
- [ ] **勿**启动 M2 / **勿**关 M1

## 本轮进度：2026-07-12 · 第 64 次 soft craft · Codex 式左栏工具抽屉 + Provider 错误中文化（soft · M1 仍 open）

- **左栏**：任务树成为唯一常驻主体；四类工具收为固定 Lucide 图标条，Runtime 状态固定在底部。
- **抽屉**：Provider / Agent / 记忆 / 审批共用一个覆盖式抽屉；同按钮切换、跨工具替换、Esc/遮罩/关闭按钮收起，跳转自动展开。
- **滚动**：移除左栏外层 + 任务树 + 详情三重滚动；仅任务树与临时抽屉正文各自滚动。
- **错误 UX**：模型发现的 Electron IPC 英文错误改为可行动中文；当前 `www.kamenking.top` 诊断为 DNS 无法解析，请求尚未到达网关或 API Key 校验。
- **验证**：Desktop **39 files / 261 tests**；UI Kit **14 files / 177 tests**；根 `pnpm test` **20/20 tasks · 715 tests**；typecheck **20/20**；build **11/11**；M1 quick soft **GREEN**。
- **M1** 仍 **open**：外网真实网关 UI 手测 **0/18** + dogfood **0/3 真实天**；**勿启动 M2**。

## 本轮进度：2026-07-12 · 第 64 次 soft craft · checklist

- [x] 用户视觉确认方案 C：任务树常驻 + 临时工具抽屉
- [x] 抽屉状态 TDD、WorkspaceNav footer 组合、Desktop 装配与层叠修复
- [x] Provider 发现错误中文分类 + DNS 根因诊断
- [x] focused/full test + typecheck + build + quick soft + Electron 默认态截图
- [ ] M1 硬门槛：外网 UI 手测 0/18
- [ ] M1 硬门槛：dogfood 0/3 真实天
- [ ] **勿**启动 M2 / **勿**关 M1

## 本轮进度：2026-07-12 · 第 63 次 soft craft · Codex 式工作台减负 + replay 游标修复（soft · M1 仍 open）

- **页面**：中心 M1 验证工作台收为 40px 单行状态栏，默认折叠、跳转自动展开；展开体独立限高滚动。左/中/右 Locked IA 不变。
- **减负**：产品工作台隐藏 Workspace/AppShell/Mode/Continuum/Manifest/Trace 的重复开发期 readiness 投影；纯投影与测试保留。
- **Runtime 根因修复**：持久 Runtime 的 `appendEvent` 改由 SQLite 统一分配游标；真实 replay 从重复 `1..11,6,7...` 恢复为单调 `1..7`，Desktop 重连恢复 Provider/任务/Compose。
- **稳定性**：同毫秒创建任务改用 `created_at + rowid` 稳定保持插入顺序，消除 workspace-store 随机失败。
- **验证**：根 `pnpm test` **20/20 tasks · 707 tests GREEN**；typecheck **20/20**；build **11/11**；M1 quick soft **GREEN**；Electron 干净重启无 stderr。
- **M1** 仍 **open**：外网真实网关 UI 手测 **0/18** + dogfood **0/3 真实天**；**勿启动 M2**。
- **可观测**：`m1-obs-layout[data-workspace-open]` · `m1-obs-workspace-summary/body` · softCraftRound **63**。

## 本轮进度：2026-07-12 · 第 63 次 soft craft · checklist

- [x] M1 验证工作台默认折叠，所有原面板仍可达
- [x] 开发期 readiness 从产品首屏隐藏，Locked IA 不变
- [x] Runtime replay 重复/逆序游标根因修复 + 回归
- [x] Workspace 同毫秒任务排序稳定化
- [x] root test/typecheck/build + quick soft + Electron 真实截图
- [ ] M1 硬门槛：外网 UI 手测 0/18
- [ ] M1 硬门槛：dogfood 0/3 真实天
- [ ] **勿**启动 M2 / **勿**关 M1

## 本轮进度：2026-07-12 · 第 62 次 soft craft · 左侧仪器切换 + Skill 导入 UX（soft · M1 仍 open）

- **本轮**：左侧 Providers/Agent/记忆/审批改为 **tab 一次只开一个**；Skill 导入 preflight 中文错误 +「填入示例」；主路径轨顶部 **硬门槛条**（#61）已接线。单测 hardgate 8 + left 3 · soft full **GREEN** · build + Electron 重启 PID **17820**。
- **M1** 仍 **open**：外网 UI 手测 0/18 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`m1-hardgate-strip` · `left-instrument-switch` · softCraftRound **62**。
- **固定大白话**：`13-plain-selftest-log.md` 第 61/62 次。

## 本轮进度：2026-07-12 · 第 62 次 soft craft · 左侧减负 + 硬门槛条（checklist）

- [x] 第 61 次：硬门槛进度条 pure + UI 接线 + CTA
- [x] 第 62 次：左侧仪器切换 + Skill 导入错误可见 + 填入示例
- [x] 单测 + dual + rebuild + Electron 重启
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿** 启动 M2
- 下一优先：用户硬门槛手测/dogfood；**勿关 M1**

## 本轮进度：2026-07-12 · 第 60 次 soft craft · 观测布局减负（主路径轨 + 折叠次要板）（soft · M1 仍 open）

- **本轮**：M1 右侧观测区重排——**主路径轨**（下一步 / 下一外网项 / 退出路径）置顶常显；次要 soft 板收入 **「更多 soft 观测」** 默认折叠；flash 次要面板时自动展开。单测 7 + 既有 52 · soft full **GREEN** · build + Electron 重启 PID **61620**。
- **M1** 仍 **open**：外网 UI 手测 0/18 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`m1-obs-layout` / `m1-obs-primary` / `m1-obs-secondary` · softCraftRound **60**。
- **固定大白话**：`13-plain-selftest-log.md` 第 60 次。

## 本轮进度：2026-07-12 · 第 60 次 soft craft · 观测布局减负（checklist）

- [x] 第 60 次：主路径轨 + 次要折叠 + 单测 + dual + rebuild + Electron 重启
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿** 启动 M2
- 下一优先：用户硬门槛手测/dogfood；soft 布局已减负；**勿关 M1**

## 本轮进度：2026-07-12 · 第 59 次 soft craft · 下一步/退出路径/证据包合入外网聚焦（soft · M1 仍 open）

- **本轮**：next-action + exit-path + evidence 合入 #58 外网聚焦；单测 17+15+11；soft full **GREEN**；build + Electron 重启 PID **14100**。
- **M1** 仍 **open**：外网 UI 手测 0/18 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`m1-exit-path-step-external-focus-assist` / next `data-cta-action=jump-external-item|focus-external` / 证据包「含外网聚焦」/ softCraftRound **59**。
- **固定大白话**：`13-plain-selftest-log.md` 第 59 次。

## 本轮进度：2026-07-12 · 第 59 次 soft craft · 下一步/退出路径/证据包合入外网聚焦（checklist）

- [x] 第 59 次：外网聚焦贯通 next/exit/evidence + 单测 + dual + rebuild + Electron 重启
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿** 启动 M2
- 下一优先：用户硬门槛手测/dogfood；soft 可做布局减负；**勿关 M1**

## 本轮进度：2026-07-12 · 第 58 次 soft craft · 手测「下一外网项」聚焦条（soft · M1 仍 open）

- **本轮**：`projectM1ExternalFocus` + UI 聚焦条/队列/运行单复制 + 单测 **9/9**；soft full **GREEN**；build + Electron 重启。
- **M1** 仍 **open**：外网 UI 手测 0/18 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`m1-external-focus` / `data-focus-id` / softCraftRound **58**。
- **固定大白话**：`13-plain-selftest-log.md` 第 58 次。

## 本轮进度：2026-07-12 · 第 58 次 soft craft · 手测「下一外网项」聚焦条（checklist）

- [x] 第 58 次：下一外网项聚焦 + 单测 + dual + rebuild + Electron 重启
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿** 启动 M2
- 下一优先：用户硬门槛手测/dogfood；soft 仅失败边角/硬门槛辅助；**勿关 M1**

## 本轮进度：2026-07-12 · 第 57 次 soft craft · 下一步合入 dogfood 补填板（soft · M1 仍 open）

- **本轮**：`projectM1NextAction` 合入 fill 信号；CTA `open-dogfood-fill` / `copy-dogfood-fill`；主条可观测属性 + CSS 高亮；单测 **14/14**；soft full **GREEN**；build + Electron 重启。
- **M1** 仍 **open**：外网 UI 手测 0/18 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`m1-next-action[data-cta-action]` / softCraftRound **57**。
- **固定大白话**：`13-plain-selftest-log.md` 第 57 次。

## 本轮进度：2026-07-12 · 第 57 次 soft craft · 下一步合入 dogfood 补填板（checklist）

- [x] 第 57 次：next-action × dogfood 补填 + 单测 + dual + rebuild + Electron 重启
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿** 启动 M2
- 下一优先：用户硬门槛手测/dogfood；soft 仅失败边角/硬门槛辅助；**勿关 M1**

## 本轮进度：2026-07-12 · 第 56 次 soft craft · 退出路径合入 dogfood 补填板（soft · M1 仍 open）

- **本轮**：exit-path 合入补填板信号（`dogfood-fill-assist` + open/copy CTA）；粘贴/证据包路径带 fill 字段；CSS 高亮补填步；单测 **11/11**；soft full **GREEN**；build + Electron 重启。
- **M1** 仍 **open**：外网 UI 手测 0/18 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`m1-exit-path-step-dogfood-fill-assist` / `data-kind=dogfood-fill` / softCraftRound **56**。
- **固定大白话**：`13-plain-selftest-log.md` 第 56 次。

## 本轮进度：2026-07-12 · 第 56 次 soft craft · 退出路径合入 dogfood 补填板（checklist）

- [x] 第 56 次：exit-path × dogfood 补填 + 单测 + dual + rebuild + Electron 重启
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿** 启动 M2
- 下一优先：用户硬门槛手测/dogfood；soft 仅失败边角/硬门槛辅助；**勿关 M1**

## 本轮进度：2026-07-12 · 第 55 次 soft craft · 证据包并入 dogfood 多日补填（soft · M1 仍 open）

- **本轮**：证据包可选 `dogfoodFillMarkdown` + TOC「dogfood 多日补填」+ 导出自动合入补填板；bundle **10/10**；soft full **GREEN**；dual **4/4**；build + Electron 重启。
- **M1** 仍 **open**：外网 UI 手测 0/18 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`m1-evidence-bundle-sec-dogfood-fill` / 包内 `## dogfood 多日补填` / 摘要「含补填」。
- **固定大白话**：`13-plain-selftest-log.md` 第 55 次。

## 本轮进度：2026-07-12 · 第 55 次 soft craft · 证据包并入 dogfood 多日补填（checklist）

- [x] 第 55 次：证据包合入多日补填 + 单测 + dual + rebuild + Electron 重启
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿** 启动 M2
- 下一优先：用户硬门槛手测/dogfood；soft 仅失败边角/硬门槛辅助；**勿关 M1**

## 本轮进度：2026-07-12 · 第 54 次 soft craft · dogfood 多日补填板（soft · M1 仍 open）

- **本轮**：`projectM1DogfoodFillBoard` + UI 补填卡/主 CTA/行打开/复制多日补填 + 单测 **9/9**；soft full **GREEN**；dual **4/4**；build + Electron 重启。
- **M1** 仍 **open**：外网 UI 手测 0/18 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`m1-dogfood-fill` / chips / primary / row CTA / `data-claims-closed=0` / `data-claims-dogfood-real=0`。
- **固定大白话**：`13-plain-selftest-log.md` 第 54 次。

## 本轮进度：2026-07-12 · 第 54 次 soft craft · dogfood 多日补填板（checklist）

- [x] 第 54 次：多日补填板 + 单测 + dual + rebuild + Electron 重启
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿** 启动 M2
- 下一优先：用户硬门槛手测/dogfood；soft 仅失败边角/硬门槛辅助；**勿关 M1**

## 本轮进度：2026-07-12 · 第 53 次 soft craft · 本机领先差异可点跳 + 退出路径合入（soft · M1 仍 open）

- **本轮**：doc-diff 行级 CTA / 主按钮 + exit-path `doc-live-ahead` 步；单测 **6/6 + 7/7**；soft full **GREEN**；dual **4/4**；build + Electron 重启。
- **M1** 仍 **open**：外网 UI 手测 0/18 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`m1-handtest-doc-diff-primary` / `m1-handtest-doc-diff-cta-*` / `m1-exit-path-step-doc-live-ahead` / `data-claims-closed=0`。
- **固定大白话**：`13-plain-selftest-log.md` 第 53 次。

## 本轮进度：2026-07-12 · 第 53 次 soft craft · 本机领先差异可点跳（checklist）

- [x] 第 53 次：差异行 CTA + 退出路径本机领先步 + 单测 + dual + rebuild + Electron 重启
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿** 启动 M2
- 下一优先：用户硬门槛手测/dogfood；soft 仅失败边角/硬门槛辅助；**勿关 M1**

## 本轮进度：2026-07-12 · 第 52 次 soft craft · 证据包并入文档↔本机差异（soft · M1 仍 open）

- **本轮**：证据包可选 `docDiffMarkdown` + TOC「文档↔本机差异」+ 导出自动合入差异；bundle **9/9**；soft full **GREEN**；dual **4/4**；build + Electron 重启。
- **M1** 仍 **open**：外网 UI 手测 0/18 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`m1-evidence-bundle-sec-doc-diff` / 包内 `## 文档↔本机差异` / 摘要「含差异」。
- **固定大白话**：`13-plain-selftest-log.md` 第 52 次。

## 本轮进度：2026-07-12 · 第 52 次 soft craft · 证据包并入文档↔本机差异（checklist）

- [x] 第 52 次：证据包合入文档差异 + 单测 + dual + rebuild + Electron 重启
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿** 启动 M2
- 下一优先：用户硬门槛手测/dogfood；soft 仅失败边角/硬门槛辅助；**勿关 M1**

## 本轮进度：2026-07-12 · 第 51 次 soft craft · 文档↔本机差异板（soft · M1 仍 open）

- **本轮**：`projectM1HandtestDocDiff` + UI 差异板/复制差异 + 单测 **3/3**；soft full **GREEN**；dual **4/4**；build + Electron 重启。
- **M1** 仍 **open**：外网 UI 手测 0/18 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`m1-handtest-doc-diff` / chips / attention 列表 / 复制文档差异。
- **固定大白话**：`13-plain-selftest-log.md` 第 51 次。

## 本轮进度：2026-07-12 · 第 51 次 soft craft · 文档↔本机差异板（checklist）

- [x] 第 51 次：文档↔本机差异板 + 单测 + dual + rebuild + Electron 重启
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿** 启动 M2
- 下一优先：用户硬门槛手测/dogfood；soft 仅失败边角/硬门槛辅助；**勿关 M1**

## 本轮进度：2026-07-12 · 第 50 次 soft craft · 手测文档逐项勾选徽章（soft · M1 仍 open）

- **本轮**：解析 `14-…handtest.md` 逐项 box → IPC `handtestBoxes` → UI **文档✓/□/—**；parse **5/5**；tsc/build 通过；soft full **GREEN**；dual **4/4**；Electron 重启。
- **M1** 仍 **open**：外网 UI 手测 0/18 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`m1-handtest-doc-*` / `data-doc-checked` / IPC boxes / 真实文档 0/18。
- **固定大白话**：`13-plain-selftest-log.md` 第 50 次。

## 本轮进度：2026-07-12 · 第 50 次 soft craft · 手测文档逐项勾选徽章（checklist）

- [x] 第 50 次：handtestBoxes 回传 + 类型 + UI 徽章 + 单测 + dual + rebuild + Electron 重启
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿** 启动 M2
- 下一优先：用户硬门槛手测/dogfood；soft 仅失败边角/硬门槛辅助；**勿关 M1**

## 本轮进度：2026-07-12 · 第 49 次 soft craft · 证据包并入退出路径（soft · M1 仍 open）

- **本轮**：证据包可选 `exitPathMarkdown` + TOC「退出路径」+ 导出自动合入路径；bundle **8/8**；soft full **GREEN**；dual **4/4**；build + Electron 重启。
- **M1** 仍 **open**：外网 UI 手测 0/18 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`m1-evidence-bundle-sec-exit-path` / 包内 `## 退出路径` / 摘要「含路径」。
- **固定大白话**：`13-plain-selftest-log.md` 第 49 次。

## 本轮进度：2026-07-12 · 第 49 次 soft craft · 证据包并入退出路径（checklist）

- [x] 第 49 次：证据包合入退出路径 + 单测 + dual + rebuild + Electron 重启
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿** 启动 M2
- 下一优先：用户硬门槛手测/dogfood；soft 仅失败边角/硬门槛辅助；**勿关 M1**

## 本轮进度：2026-07-12 · 第 48 次 soft craft · M1 退出路径板（soft · M1 仍 open）

- **本轮**：`projectM1ExitPath` + UI 退出路径卡/复制路径/逐步 CTA + 单测 **6/6**；soft full **GREEN**；dual **4/4**；build + Electron 重启；compose 跳转修复。
- **M1** 仍 **open**：外网 UI 手测 0/18 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`m1-exit-path` / `data-progress` / `data-claims-closed=0` / `m1-exit-path-step-*` / 进度封顶 99%。
- **固定大白话**：`13-plain-selftest-log.md` 第 48 次。

## 本轮进度：2026-07-12 · 第 48 次 soft craft · M1 退出路径板（checklist）

- [x] 第 48 次：退出路径板 + 单测 + dual + rebuild + Electron 重启
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿** 启动 M2
- 下一优先：用户硬门槛手测/dogfood；soft 仅失败边角/硬门槛辅助；**勿关 M1**

## 本轮进度：2026-07-12 · 第 47 次 soft craft · 一键导出 soft 证据包（soft · M1 仍 open）

- **本轮**：`formatM1EvidenceBundle` + UI 证据包卡/一键导出 + 单测 **7/7**；soft pack **74**；dual **4/4**；build + Electron 重启。
- **M1** 仍 **open**：外网 UI 手测 0/18 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`m1-evidence-bundle` / `data-action=copy-evidence-bundle` / `data-claims-closed=0` / TOC sec chips。
- **固定大白话**：`13-plain-selftest-log.md` 第 47 次。

## 本轮进度：2026-07-12 · 第 47 次 soft craft · 一键导出 soft 证据包（checklist）

- [x] 第 47 次：证据包导出 + 单测 + dual + rebuild + Electron 重启
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿** 启动 M2
- 下一优先：用户硬门槛手测/dogfood；soft 仅失败边角/硬门槛辅助；**勿关 M1**

## 本轮进度：2026-07-12 · 第 46 次 soft craft · 回归筛选 + 行跳转（soft · M1 仍 open）

- **本轮**：`filterM1SoftRegressionRows` + 行行动 resolve + UI 筛选/跳转；regression **8/8**；soft pack **72**；dual **4/4**；build + Electron 重启。
- **M1** 仍 **open**：外网 UI 手测 0/18 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`m1-soft-regression-filters` / `data-filter` / `data-action` / 行按钮。
- **固定大白话**：`13-plain-selftest-log.md` 第 46 次。

## 本轮进度：2026-07-12 · 第 46 次 soft craft · 回归筛选 + 行跳转（checklist）

- [x] 第 46 次：回归筛选 + 行跳转 + 单测 + dual + rebuild + Electron 重启
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿** 启动 M2
- 下一优先：用户硬门槛手测/dogfood；soft 仅失败边角/回归；**勿关 M1**

## 本轮进度：2026-07-12 · 第 45 次 soft craft · soft 回归矩阵（soft · M1 仍 open）

- **本轮**：`formatM1SoftRegressionMatrix` + UI 矩阵板 + 复制按钮 + `selftest-m1-soft-regression.mjs`；regression **6/6**；soft pack **66**；dual **4/4**；build + Electron 重启。
- **M1** 仍 **open**：外网 UI 手测 0/18 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`m1-soft-regression` / `data-auto-pass` / `data-hand-gaps` / `data-external-gaps` / `data-action=copy-soft-regression`。
- **固定大白话**：`13-plain-selftest-log.md` 第 45 次。

## 本轮进度：2026-07-12 · 第 45 次 soft craft · soft 回归矩阵（checklist）

- [x] 第 45 次：soft 回归矩阵 + runner + 单测 + dual + rebuild + Electron 重启
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿** 启动 M2
- 下一优先：用户硬门槛手测/dogfood；soft 仅失败边角/回归；**勿关 M1**

## 本轮进度：2026-07-12 · 第 44 次 soft craft · 生成失败恢复 CTA（soft · M1 仍 open）

- **本轮**：`classifyStreamFailure` + 失败恢复 CTA + 密钥打码；stream **18/18**；相关 **50**；dual **4/4**；build + Electron 重启。
- **M1** 仍 **open**：外网 UI 手测 0/18 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`conversation-stream-failure` / `data-failure-kind` / `data-cta-action` / `data-failure-code`。
- **固定大白话**：`13-plain-selftest-log.md` 第 44 次。

## 本轮进度：2026-07-12 · 第 44 次 soft craft · 生成失败恢复 CTA（checklist）

- [x] 第 44 次：stream failure classify + CTA UI + 单测 + dual + rebuild + Electron 重启
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿** 启动 M2
- 下一优先：用户硬门槛手测/dogfood；soft 仅失败边角/回归；**勿关 M1**

## 本轮进度：2026-07-12 · 第 43 次 soft craft · dogfood 计分加固（粘贴草稿不计有效日 · M1 仍 open）

- **本轮**：`m1-dogfood-score` 识别粘贴草稿/待你确认；退出证据按日板显示「草稿」+ 原因；score **8/8**；exit **12/12**；load **4/4**；dual **4/4**；build + Electron 重启。
- **M1** 仍 **open**：外网 UI 手测 0/18 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`data-kind=draft` / `data-paste-assist` / `m1-dogfood-day-reasons-*` / dogfood chip「草稿N」。
- **固定大白话**：`13-plain-selftest-log.md` 第 43 次。

## 本轮进度：2026-07-12 · 第 43 次 soft craft · dogfood 计分加固（checklist）

- [x] 第 43 次：dogfood score hardening + UI reasons + 单测 + dual + rebuild + Electron 重启
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿** 启动 M2
- 下一优先：用户硬门槛手测/dogfood；soft 仅失败边角/回归；**勿关 M1**

## 本轮进度：2026-07-12 · 第 42 次 soft craft · 复制 dogfood 日记草稿（soft · M1 仍 open）

- **本轮**：`formatM1DogfoodDayDraft` + 退出证据/手测区复制按钮；draft **4/4**；dual **4/4**；build + Electron 重启。
- **M1** 仍 **open**：外网 UI 手测 0/18 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`m1-dogfood-draft-copy` / `m1-handtest-copy-dogfood-draft` / `data-action=copy-dogfood-draft`。
- **固定大白话**：`13-plain-selftest-log.md` 第 42 次。

## 本轮进度：2026-07-12 · 第 41 次 soft craft · 手测进度粘贴稿 + 外网/缺口筛选（soft · M1 仍 open）

- **本轮**：`formatM1HandtestPaste` + 筛选全部/缺口/外网 + 复制手测进度；paste **4/4**；dual **4/4**；build + Electron 重启。
- **M1** 仍 **open**：外网 UI 手测 0/18 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`m1-handtest-copy-paste` / `m1-handtest-filters` / `m1-handtest-filter-*` / `data-action=copy-handtest-paste`。
- **固定大白话**：`13-plain-selftest-log.md` 第 41 次。

## 本轮进度：2026-07-12 · 第 40 次 soft craft · dogfood 按日可打开 + 手测分区进度板（soft · M1 仍 open）

- **本轮**：`dogfood-day` 白名单打开 + 按日行按钮；手测分区板 pre/A/B/C/D；open-doc **7/7**；section **3/3**；dual **4/4**；build + Electron 重启。
- **M1** 仍 **open**：外网 UI 手测 0/18 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`m1-dogfood-day-btn-*` / `data-action=open-dogfood-day` / `m1-handtest-sections` / `m1-handtest-section-*`。
- **固定大白话**：`13-plain-selftest-log.md` 第 40 次。

## 本轮进度：2026-07-12 · 第 39 次 soft craft · dogfood 按日明细 + 聚焦自动刷新（soft · M1 仍 open）

- **本轮**：`listDogfoodDayReports` + `dogfoodDays` IPC/UI + focus 自动刷新；exit **11/11**；load **3/3**；dual **4/4**；build + Electron 重启。
- **M1** 仍 **open**：外网 UI 手测 0/18 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`m1-dogfood-days` / `m1-dogfood-day-*` / `data-kind`。
- **固定大白话**：`13-plain-selftest-log.md` 第 39 次。

## 本轮进度：2026-07-12 · 第 38 次 soft craft · 复制 soft 快照辅助手测/dogfood（soft · M1 仍 open）

- **本轮**：`formatM1SoftSnapshot` + 退出证据/手测区复制按钮 + 反馈条；snapshot **4/4**；dual **4/4**；build + Electron 重启。
- **M1** 仍 **open**：外网 UI 手测 0/18 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`m1-soft-snapshot-copy` / `m1-handtest-copy-snapshot` / `data-action=copy-soft-snapshot`。
- **固定大白话**：`13-plain-selftest-log.md` 第 38 次。

## 本轮进度：2026-07-12 · 第 37 次 soft craft · 退出证据芯片可点 + 打开反馈 + 手测快捷入口（soft · M1 仍 open）

- **本轮**：`resolveM1ExitChipAction` / `formatM1OpenDocFeedback` + 芯片按钮 + 反馈条 + 手测打开快捷；chip-action **7/7**；M1 套件 **37**；dual **4/4**；build + Electron 重启。
- **M1** 仍 **open**：外网 UI 手测 0/18 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`m1-exit-chip-btn-*` / `m1-open-doc-feedback` / `m1-handtest-opens` / `data-open-doc`。
- **固定大白话**：`13-plain-selftest-log.md` 第 37 次。

## 本轮进度：2026-07-12 · 第 36 次 soft craft · 「下一步」重连 + 打开手测/dogfood 文档（soft · M1 仍 open）

- **本轮**：`ctaAction`/`openDoc` + IPC `desktop:m1-open-doc` + 主 CTA 真开文档/重连；next **10/10**；open-doc **4/4**；dual **4/4**；build + Electron 重启。
- **M1** 仍 **open**：外网 UI 手测 0/18 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`data-cta-action` / `data-open-doc` / 白名单 openPath。
- **固定大白话**：`13-plain-selftest-log.md` 第 36 次。

## 本轮进度：2026-07-12 · 第 35 次 soft craft · Runtime 离线手动重连 CTA（soft · M1 仍 open）

- **本轮**：`projectConversationStreamReadiness` 重连 CTA + `lastConnectFailure` + 桌面手动重连；stream **9/9**；runtime-connection **5/5**；dual **4/4**；build + Electron 重启。
- **M1** 仍 **open**：外网 UI 手测 0/18 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`conversation-runtime-reconnect` / `data-failure-code` / 失败码中文 hint。
- **固定大白话**：`13-plain-selftest-log.md` 第 35 次。

## 本轮进度：2026-07-12 · 第 34 次 soft craft · M1「下一步」主行动条（soft · M1 仍 open）

- **本轮**：`projectM1NextAction` + 任务头「下一步」CTA；**9/9**；handtest/exit 回归绿；dual **4/4**；build + Electron 重启。
- **M1** 仍 **open**：外网 UI 手测 0/18 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`m1-next-action` / `m1-next-cta` / `data-kind` / `data-gate`。
- **固定大白话**：`13-plain-selftest-log.md` 第 34 次

## 本轮进度：2026-07-12 · 第 33 次 soft craft · 手测项点击跳转面板（soft · M1 仍 open）

- **本轮**：`resolveM1HandtestItemJump` + 手测行点击跳转/闪烁；**8/8**；exit **8/8**；dual **4/4**；build + Electron 重启。
- **M1** 仍 **open**：外网 UI 手测 0/18 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`m1-handtest-jump-*` / `data-jump` / `data-jumpable`。
- **固定大白话**：`13-plain-selftest-log.md` 第 33 次

## 本轮进度：2026-07-12 · 第 32 次 soft craft · 手测对照清单 live 投影（soft · M1 仍 open）

- **本轮**：`projectM1HandtestChecklist`（18 项 live/external）+ 任务头「手测对照」UI + 已知限制折叠；单测 **5/5**；exit **8/8**；dual **4/4**；desktop build + Electron 重启。
- **M1** 仍 **open**：外网 UI 手测文档 0/18 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`m1-handtest-checklist` / `m1-handtest-item-*` / `m1-known-limits`。
- **固定大白话**：`13-plain-selftest-log.md` 第 32 次

## 本轮进度：2026-07-12 · 第 31 次 soft craft · M1 退出证据进度条（soft · M1 仍 open）

- **本轮**：`projectM1ExitEvidenceProgress` + IPC 读手测/dogfood + 任务头「退出证据」条；**8/8**；dual **4/4**；build + Electron 重启。
- **M1** 仍 **open**：外网 UI 手测 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`m1-exit-evidence` / `m1-exit-chip-*` / 刷新。
- **固定大白话**：`13-plain-selftest-log.md` 第 31 次

## 本轮进度：2026-07-12 · 第 30 次 soft craft · 会话芯片跳转面板（soft · M1 仍 open）

- **本轮**：会话就绪芯片 → 左侧/轨迹面板 **点击跳转 + 闪烁**；`resolveM1SessionChipJump` 纯映射；**7/7**；dual **4/4**；desktop build + Electron 重启。
- **M1** 仍 **open**：外网 UI 手测 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`m1-session-chip-jump-*` / `data-jump` / `data-nav-flash`。
- **固定大白话**：`13-plain-selftest-log.md` 第 30 次

## 本轮进度：2026-07-12 · 第 29 次 soft craft · 会话就绪 Memory 芯片 + dual 复测（soft · M1 仍 open）

- **本轮**：`projectM1SessionReadiness` 增加 Memory 芯片与 memoryOk；desktop 接线；**5/5**；dual 网关 **4/4**；desktop build + Electron 重启。
- 同波：第 27 批准中心投影、第 28 Memory 投影。
- **M1** 仍 **open**：外网 UI 手测 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **固定大白话**：`13-plain-selftest-log.md` 第 29 次

## 本轮进度：2026-07-12 · 第 28 次 soft craft · Memory/Diagnostics 就绪纯投影（soft · M1 仍 open）

- **本轮**：`projectMemoryDiagnosticsReadiness` + Memory 面板统一投影；**12/12** 测；ui-kit+desktop build；Electron 重启。同轮第 27 次批准中心 **13/13**。
- **M1** 仍 **open**：外网 UI 手测 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`memory-diagnostics-panel` / `memory-m1-*`。
- **固定大白话**：`13-plain-selftest-log.md` 第 28 次

## 本轮进度：2026-07-12 · 第 27 次 soft craft · 批准中心闸门就绪纯投影（soft · M1 仍 open）

- **本轮**：`projectApprovalGateReadiness` + ApprovalCenter 闸门统一投影；**13/13** 测（含 7 条纯投影）；ui-kit+desktop build；Electron 重启。
- **M1** 仍 **open**：外网 UI 手测 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测测点**：`approval-center-panel` / `approval-gate-*` / data-level。
- **固定大白话**：`13-plain-selftest-log.md` 第 27 次

## 本轮进度：2026-07-12 · 第 26 次 soft craft · Agent 能力就绪纯投影（soft · M1 仍 open）

- **本轮**：`projectAgentCapabilityReadiness` + AgentBindingPanel 能力就绪统一投影；UI 接线 + 根节点 data-level；**27/27** 测（含 8 条纯投影）；ui-kit+desktop build；Electron 重启。
- **M1** 仍 **open**：外网 UI 手测 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测测点**：`agent-binding-panel` / `agent-capability-*` / cap-checks / data-level。
- **固定大白话**：`13-plain-selftest-log.md` 第 26 次

## 本轮进度：2026-07-12 · 第 25 次 soft craft · Compose「发送就绪」纯投影（soft · M1 仍 open）

- **本轮**：`projectComposeSendReadiness` + Compose 发送就绪统一投影（正文/Runtime/任务/模型/覆盖/流式）；五档；**25/25** 测；ui-kit+desktop build；Electron 重启。
- **M1** 仍 **open**：外网 UI 手测 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测点**：`compose-send-readiness` / badge / checks / `st-compose` data-level。
- **固定大白话**：`13-plain-selftest-log.md` 第 25 次

## 本轮进度：2026-07-12 · 第 24 次 soft craft · Providers 多模型就绪纯投影 + dual 复测（soft · M1 仍 open）

- **本轮**：`projectProvidersReadiness` + Providers「多模型就绪」统一投影（≥2 Provider / ≥3 模型 / 密钥 / 跨协议）；**10/10** 测；dual 网关 **4/4**；ui-kit+desktop build；Electron 重启。
- **M1** 仍 **open**：外网 UI 手测 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测点**：`provider-m1-readiness` / badge / checks / `providers-panel` data-level。
- **固定大白话**：`13-plain-selftest-log.md` 第 24 次

## 本轮进度：2026-07-12 · 第 23 次 soft craft · WorkspaceNav 工作区导航就绪投影（soft · M1 仍 open）

- **本轮**：`projectWorkspaceNavReadiness` + 左侧「工作区导航」就绪条（文件夹/任务/嵌套/当前/Runtime/筛选）；四档 empty/partial/ready/filtering；**13/13** 测；ui-kit+desktop build；Electron 重启。
- **M1** 仍 **open**：外网 UI 手测 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测点**：`workspace-nav-ia-strip` / badge / 6 checks / `workspace-nav` data-level。
- **固定大白话**：`13-plain-selftest-log.md` 第 23 次

## 本轮进度：2026-07-12 · 第 22 次 soft craft · AppShell 工作区布局就绪条（soft · M1 仍 open）

- **本轮**：`projectAppShellReadiness` + 右侧轨迹栏「工作区布局」就绪条（nav/对话/Compose/连续体/轨迹折叠/主题）；四档 empty/partial/ready/compact；折叠不暂停 Run；图标 LayoutPanelLeft；**14/14** 测；ui-kit+desktop build；Electron 重启。
- **M1** 仍 **open**：外网 UI 手测 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测点**：`app-shell-readiness` / badge / 6 checks / `app-shell` data-level。
- **固定大白话**：`13-plain-selftest-log.md` 第 22 次

## 本轮进度：2026-07-12 · 第 19 次 soft craft · 对话流 empty/stream 统一可观测（soft · M1 仍 open）

## 本轮进度：2026-07-12 · 第 21 次 soft craft · 参与模式就绪条 + dual 复测（soft · M1 仍 open）

- **本轮**：`projectModeReadiness` + ModeSwitch 就绪条（对话/协作/自动/门控）；M1 锁定态可观测；**10/10** 测；dual 网关 **4/4**；builds 绿；Electron 重启。
- **M1** 仍 **open**：外网 UI 手测 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测点**：`mode-switch-readiness` / badge / checks / `mode-switch-wrap` data-level。
- **固定大白话**：`13-plain-selftest-log.md` 第 21 次

## 本轮进度：2026-07-12 · 第 20 次 soft craft · Manifest「可检查」就绪条（soft · M1 仍 open）

- **本轮**：`projectManifestReadiness` + Manifest 就绪条（调用/选中/绑定阶梯/proof/入包·排除/Skill·工具/跨任务·证据/预览·修订）；四档 empty/partial/inspectable/amended；CSS 对齐；**22/22** 测；ui-kit+desktop build 绿；Electron 重启。
- **M1** 仍 **open**：外网 UI 手测 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测点**：`manifest-readiness` / badge / checks / `manifest-panel` data-level。
- **固定大白话**：`13-plain-selftest-log.md` 第 20 次

- **本轮**：`projectConversationStreamReadiness` + 对话列就绪条（六 checks）+ 空对话同源；Run 状态中文化；6/6 测；desktop build 绿；Electron 重启。
- **M1** 仍 **open**；外网 UI 手测 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`conversation-stream-readiness` / badge / checks / `conversation-empty-*`。
- **固定大白话**：`13-plain-selftest-log.md` 第 19 次

- **本轮**：Continuum「上下文连续体」就绪条（条目/决策/记忆/上下文/产物评审/绑定·流式）；真空态；scaffoldOnly 标明结构位；`projectContinuumReadiness` + 10 测；builds 绿；Electron 重启。
- **M1** 仍 **open**；外网 UI 手测 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`continuum-readiness` / badge / 六项 checks / `continuum-wrap`。
- **固定大白话**：`13-plain-selftest-log.md` 第 18 次

- **本轮**：TraceList「运行轨迹」就绪条（事件/模型/恢复/工具审批/最近/任务·流式）；去掉假 waiting 条目；真 empty 中文空态；`projectTraceReadiness` + 9 测；builds 绿；Electron 重启。
- **M1** 仍 **open**；外网 UI 手测 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`trace-readiness` / badge / 六项 checks / `trace-list-wrap`。
- **固定大白话**：`13-plain-selftest-log.md` 第 17 次

## 2026-07-12 · 第 16 次 soft craft · Compose 发送就绪条 + dual 网关复测

- **本轮**：Compose「发送就绪」条（模型/绑定/Runtime/任务/跨 Provider/输入）；dual 网关 4/4 复测；21/21 绿；Electron 重启。
- **M1** 仍 **open**；外网 UI 手测 + dogfood ≥3 天未完成。
- **M2** 未启动。
- **可观测**：`compose-send-readiness` / badge / 六项 checks。

## 2026-07-12 · 第 15 次 soft craft · 会话就绪条接入 Agent/审批

- **本轮**：任务头会话就绪条接入 Agent 默认/白名单 + 审批待审；soft ready 含 agentOk/approvalOk；4/4 + 19/19 绿；Electron 重启。
- **M1** 仍 **open**；退出证据（外网手测 + dogfood）未完成。
- **M2** 未启动。
- **可观测**：`m1-session-chip-agent` / `m1-session-chip-approval`（随 chips 渲染）+ Agent 面板 capability strip。

## 2026-07-12 · 第 14 次 soft craft · Agent 能力就绪条

- **本轮**：Agent 面板「能力就绪」条（§5 绑定 + §9 Skill/MCP）UI + CSS + 3 条单测；19/19 绿；desktop rebuild + Electron 重启。
- **M1 状态**：仍 **open**（soft craft 继续；退出证据：外网网关手测 + dogfood ≥3 天 **未完成**）。
- **M2**：未启动。
- **可观测点**：`agent-capability-readiness` / badge / 六项 checks / dirty 同步提示。

- **已完成（soft）**
  - AppShell：「运行轨迹」中文标题/aria；折叠提示「已折叠 · Run 不暂停」
  - WorkspaceNav：「工作区结构」IA 条 + 连接文案中文化（持久事件流 / 本地 Runtime）
- **自测** AppShell **7/7** · WorkspaceNav **6/6** · builds **GREEN** · Electron 重启
- **未完成** 外网真实网关 UI 手测、dogfood ≥3 天
- **M1 仍 open**；**勿启动 M2**
- **固定大白话**：`13-plain-selftest-log.md` 第 13 次

## 本轮进度：2026-07-12 · 批准中心 + Memory 闸门就绪条（soft · M1 仍 open）

- **已完成（soft）**
  - ApprovalCenterPanel：「批准闸门」可观测条（仅限真人 / 待审 / 已决 / 桥接种类；attention 态）
  - MemoryDiagnosticsPanel：「记忆与诊断」可观测条（持久记忆 / 待审 / 诊断 / 已知限制）
  - 空态卡片中文说明；CSS 与 Providers 就绪条视觉对齐
- **自测** Approval **6/6** · Memory **6/6** · builds **GREEN** · Electron 重启
- **未完成** 外网真实网关 UI 手测、dogfood ≥3 天
- **M1 仍 open**；**勿启动 M2**
- **固定大白话**：`13-plain-selftest-log.md` 第 12 次

## 本轮进度：2026-07-12 · 任务头 M1 会话就绪条（soft · M1 仍 open）

- **已完成（soft）**
  - desktop：Continuum 下「会话就绪」条（Runtime / 任务 / Provider≥2 / 模型≥3 / Manifest / 轨迹·主题）
  - 纯函数 `projectM1SessionReadiness` + 单测；连接文案中文化「持久事件流」
  - 明确：soft 就绪 ≠ 关 M1
- **自测** m1-session-readiness **3/3** · desktop build **GREEN** · Electron 重启
- **未完成** 外网真实网关 UI 手测、dogfood ≥3 天
- **M1 仍 open**；**勿启动 M2**
- **固定大白话**：`13-plain-selftest-log.md` 第 11 次

## 本轮进度：2026-07-12 · Providers 多模型就绪条（soft · M1 仍 open）

- **已完成（soft）**
  - ProvidersPanel：「多模型就绪」可观测条（Provider ≥2 / 模型 ≥3 / 密钥遮罩 / 协议种类）
  - empty → partial → ready 三态；中文计数与 meta
  - 明确文案：soft 门槛满 ≠ 可关 M1（仍要外网手测 + dogfood）
- **自测** ProvidersPanel **6/6** · builds **GREEN** · Electron 重启
- **未完成** 外网真实网关 UI 手测、dogfood ≥3 天
- **M1 仍 open**；**勿启动 M2**
- **固定大白话**：`13-plain-selftest-log.md` 第 10 次

## 本轮进度：2026-07-12 · Compose/消息气泡中文可观测（soft · M1 仍 open）

- **已完成（soft）**
  - Compose：中文默认占位 + 输入/取消 aria
  - MessageBubble：流式/角色中文 a11y
  - desktop：气泡 meta「流式中」
- **自测** Compose **18/18** · MessageBubble **4/4** · Manifest 回归 **15/15** · builds **GREEN** · Electron 已重启
- **未完成** 外网真实网关 UI 手测、dogfood ≥3 天
- **M1 仍 open**；**勿启动 M2**
- **固定大白话**：`13-plain-selftest-log.md` 第 9 次

## 本轮进度：2026-07-12 · Manifest 解析阶梯可观测（§10.3 · soft · M1 仍 open）

- **已完成（soft）**
  - ManifestPanel：解析阶梯 UI（本轮覆盖 → 工作流 → Agent 默认 → Fallback）+ 当前层高亮
  - Fallback 链位：徽章 / Fallback #N / 绑定来源「链位 #N」
  - 凭证解析中文标签；`agentFallback` 统一显示 **Fallback**
  - 修复中断缺口：`credentialResolutionLabel` 可编译可测
- **自测** ManifestPanel **15/15** · ui-kit+desktop build **GREEN** · Electron 已重启
- **未完成** 外网真实网关 UI 手测、dogfood ≥3 天
- **M1 仍 open**；**勿启动 M2**
- **固定大白话**：`13-plain-selftest-log.md` 第 8 次

## 本轮进度：2026-07-12 · Agent 绑定优先级可观测（§5.3 · soft · M1 仍 open）

- **已完成（soft）**
  - AgentBindingPanel：「绑定优先级」阶梯 UI（本轮覆盖 → 工作流 M2 → Agent 默认 → Fallback）
  - 草稿联动：默认模型 / fallback 链实时反映在阶梯上；pause-on-failure 写入说明
  - dogfood 手测清单补 precedence 检查项
- **自测** AgentBindingPanel **16/16** · builds **GREEN**
- **未完成** 外网真实网关 UI 手测、dogfood ≥3 天
- **M1 仍 open**；**勿启动 M2**
- **固定大白话**：`13-plain-selftest-log.md` 第 7 次

## 本轮进度：2026-07-12 · Continuum/Mode 中文可观测 + dogfood 脚手架（soft · M1 仍 open）

- **已完成（soft）**
  - ContinuumRail：kind 中文 + 空状态；CSS 取消强 uppercase
  - ModeSwitch：中文「对话/协作/自动」；M1 禁用协作/自动；挂入 desktop 任务头
  - dogfood：`docs/development/dogfood/2026-07-12.md` 手测清单 + README
  - 承接第 5 次：Compose chips + Trace 中文已在 dist
- **自测** Continuum **3/3** · Mode **3/3** · builds **GREEN**
- **未完成** 外网真实网关 UI 手测、dogfood ≥3 天有效日记
- **M1 仍 open**；**勿启动 M2**
- **固定大白话**：`13-plain-selftest-log.md` 第 6 次

## 本轮进度：2026-07-12 · Compose 多模型 chips + Trace 中文标签（soft · M1 仍 open）

- **已完成（soft）**
  - ui-kit Compose：多模型快速切换 chips（默认 + ≤8）；摘要中文「本轮覆盖 / Agent 默认」；fallback 数量与跨 Provider 提示；发送/取消中文
  - ui-kit TraceList：类别中文标签（保留 data-category 英文）；空状态中文
  - desktop：agentFallbackCount / multiProvider；Compose 会话条中文化；rebuild GREEN
- **自测**
  - Compose **17/17** · TraceList **2/2** · ui-kit+desktop build **GREEN**
- **未完成 / 仍 open**
  - 外网真实网关 UI 手测、dogfood ≥3 天
  - **M1 仍 open**；**勿启动 M2**
- **固定大白话**：`docs/development/13-plain-selftest-log.md` 第 5 次

## 本轮进度：2026-07-12 · Diagnostics 恢复指南 + 已知限制（§23.2 #9/#12 · soft · M1 仍 open）

- **已完成（soft）**
  - ui-kit：`diagnostics/recovery.ts` 失败类 → 可行动恢复步骤 + 已知限制目录
  - Memory/Diagnostics：诊断可展开恢复步骤（可重试/勿盲目重试）；「已知限制」折叠区
  - Providers：顶部「Provider / 协议限制」可观测说明
  - desktop：恢复「前往 …」滚动定位 + 短暂高亮；rebuild GREEN
  - 脚本：`scripts/selftest-dual-gateway.mjs`（dual 网关 + recovery UI 门禁）
- **自测**
  - dual-http **2/2** · dual-protocol **2/2** · provider-commands **5/5**
  - ui-kit recovery/Memory/Providers **11/11** · desktop build **GREEN**
- **未完成 / 仍 open**
  - 外网真实网关 UI 手测、dogfood ≥3 天
  - **M1 仍 open**；**勿启动 M2**
- **固定大白话**：`docs/development/13-plain-selftest-log.md` 第 4 次

## 本轮进度：2026-07-12 · Provider 协议持久化 + 发现失败 Diagnostics（soft · M1 仍 open）

- **已完成（soft）**
  - storage：`provider.protocol` 列 + migration `0007_provider_protocol`；create/list/get 读写默认协议
  - protocol：`ProviderSummary.protocol`；`DiscoverModelsResponse` 增加 protocol / addedIds / previousModelCount
  - runtime：发现按 **持久化协议** 路由（不再只靠首个模型）；发现失败写入 **scrubbed Diagnostics** + `diagnostics.appended`；create 时发现失败也记诊断
  - UI：Providers 卡片协议徽章 + meta 行；发现状态条更可观测（协议/原有/新增）
  - desktop：手动添加模型优先用 provider.protocol；发现后刷新 Memory/Diagnostics
- **自测**
  - storage **69/69** · runtime provider-commands **5/5** · ui-kit ProvidersPanel **4/4** · desktop build **GREEN**
- **未完成 / 仍 open**
  - 外网真实网关 UI 手测、dogfood ≥3 天
  - **M1 仍 open**；**勿启动 M2**
- **固定大白话**：`docs/development/13-plain-selftest-log.md` 第 3 次

## 本轮进度：2026-07-12 · MCP 工具 chips 可点填（UI craft · soft）

- 发现工具名 chips 可点击填入工具名输入框（不执行）
- 修正 button 嵌套 DOM；列表行 + 下方标签
- 自测：AgentBinding **15/15** · desktop build GREEN
- 固定大白话：`13-plain-selftest-log.md` 第 2 次
- **M1 仍 open**

## 本轮进度：2026-07-12 · MCP 刷新目录可观测 + 自测闭环（§9.3→§10.2）

- **已完成（soft）**
  - 自测闭环：workers / runtime / ui-kit / desktop build 全绿（见 `13-plain-selftest-log.md`）
  - runtime 扩展：`mcp.tools.refresh` 后 **绑定白名单 → context.packet.peek 含 tool-schema**（发现→入包链路可证）
  - UI：MCP 列表展示发现工具名 chips；空目录提示可刷新
  - desktop：`toMcpOption` 映射 `toolNames`
- **未完成 / 仍 open**
  - 外网网关 UI 手测、dogfood ≥3 天
  - **M1 仍 open**；**勿启动 M2**
- **固定大白话文档**：`docs/development/13-plain-selftest-log.md`

## 本轮进度：2026-07-12 · MCP tools/list 刷新目录（§9.3 discovery · soft）

- **已完成（soft）**
  - workers：`LocalStdioMcpWorker` `list-tools` 真 JSON-RPC（initialize → notifications/initialized → tools/list → kill）；`extractToolsList`；mini-mcp fixture
  - protocol/runtime：`mcp.tools.refresh`；发现成功后 **写入注册表工具 Schema**；**不执行工具**；**不改 Agent 白名单**；事件 `mcp.tools_refreshed`
  - 拒绝路径（fake / 策略拒绝）：保留旧目录；响应可观测 refuseReason
  - UI：Agent「刷新工具目录」按钮 + 状态条（spawned/ok/jsonrpc/tools=N/新增·移除/目录名）
  - desktop：IPC `runtime:mcp-tools-refresh` + preload + renderer 类型修复后 **build GREEN**
  - 自测：workers list-tools + extract · runtime mcp-commands **7/7** · ui-kit AgentBinding **13/13** · desktop build GREEN
- **未完成 / 仍 open**
  - 外网真实网关 UI 手测
  - dogfood ≥ 3 天
  - **M1 仍 open**（勿自动关闭；无退出证据不标完成）
  - **勿启动 M2** 多 Agent / 工作流图
- **如何观测（本机 mini-mcp）**
  1. Agent → MCP：endpoint 填 `node "D:\\projects\\SYNC-THINK\\packages\\workers\\src\\mcp\\fixtures\\mini-mcp-server.mjs"`，tools **先留空或只写占位**，登记
  2. 勾选该 MCP → **保存绑定**（白名单与刷新目录无关，但后续真调用需要）
  3. 点 **「刷新工具目录」**
  4. 期望状态条：`工具目录 · spawned · ok · jsonrpc · tools=3 · 新增 echo,ping,write_file · 目录: echo,ping,write_file`
  5. 登记列表中该 server 的 tools 应从空变为 echo/ping/write_file（Schema 已持久化）
  6. 对照：endpoint 改为 `fake://x` 再刷新 → `no-spawn` / fail + 拒绝原因；**旧目录不丢**
  7. 刷新 **不会** 触发 tools/call，也不会静默写入 Agent 白名单

## 本轮进度：2026-07-12 · MCP JSON-RPC 真工具调用（§9.3/§13/§14）

- **已完成（soft）**
  - workers：`LocalStdioMcpWorker` `call-tool` 真 JSON-RPC（initialize → notifications/initialized → tools/call）+ mini-mcp fixture
  - protocol/runtime：`mcp.tool.call`；闸门：Agent 白名单 → 敏感度 → 审批入队 / priorApprovalId / auto-approve → 真执行
  - 批准后 `executeOnApprove`：`approval.decide` 响应带 `mcpToolCall`；事件 `mcp.tool_called` / `mcp.tool_refused`
  - UI：Agent「真工具调用」按钮 + 状态条（拒绝/入队/已执行/jsonrpc/preview）；审批中心批准后可观测执行结果
  - 自测：workers 31/31 · runtime mcp-commands 6/6 · ui-kit AgentBinding 12/12 · desktop rebuild GREEN
- **未完成 / 仍 open**
  - 外网真实网关 UI 手测
  - dogfood ≥ 3 天
  - **M1 仍 open**（勿自动关闭；无退出证据不标完成）
- **如何观测（本机 mini-mcp）**
  1. Agent → MCP：endpoint 填 `node "D:\\projects\\SYNC-THINK\\packages\\workers\\src\\mcp\\fixtures\\mini-mcp-server.mjs"`，tools 填 `echo,ping,write_file`，登记
  2. 勾选该 MCP → **保存绑定**
  3. 工具名 `echo` → 点 **真工具调用**
  4. 期望：状态条 `真工具 · 已入队审批 · … · 批准后自动执行`；审批中心出现 MCP 权限
  5. 批准后：审批/MCP 状态出现 `真工具 · 批准后执行 · echo · ok · jsonrpc · preview: ECHO:UI_CALL_OK`
  6. 未白名单：`真工具 · 拒绝 · … · 未在 Agent 白名单`
  7. 对照：`fake://x` 即使可信/白名单也不会真正 spawn 成功

## 本轮进度：2026-07-12 · MCP 真 spawn 探测骨架（§9.3/§14）

- **已完成（soft）**
  - workers：`LocalStdioMcpWorker` 真 local-stdio 短进程 spawn（超时/限幅/untrusted/审计；无 JSON-RPC 工具）
  - 命令白名单：node/npx/echo/cmd；拒绝 fake/http/URL 与引号外 shell 元字符
  - protocol/runtime：`mcp.spawn.probe` + 事件 `mcp.spawn_probed`
  - UI：Agent 面板「真 spawn 探测」按钮 + 状态条（spawned/exit/timeout/拒绝原因可观测）
  - 自测：workers local-stdio 7/7 · runtime mcp-commands 4/4 · ui-kit AgentBinding 11/11 · desktop rebuild
- **未完成 / 仍 open**
  - 完整 MCP JSON-RPC 真工具执行
  - 外网网关手测 / dogfood ≥3 天
  - **M1 仍 open**（勿自动关闭）
- **如何观测**
  1. Agent → MCP：endpoint 填 `node -e "process.stdout.write('SPAWN_OK')"` 并登记
  2. 勾选该 MCP 后点「真 spawn 探测」
  3. 状态条应出现 `真 spawn · spawned · ok · exit=0 · real-spawn`
  4. endpoint 填 `fake://x` 再探测 → `no-spawn` + 拒绝原因

## 本轮进度：2026-07-12 · Skill 批准后自动白名单绑定（§9.1/§9.3→§13）

- **已完成（soft）**
  - 导入仍不 auto-allowlist（§9.1）
  - skill-permission **批准** → 默认 Agent 写入/替换 skillVersionId
  - **拒绝** → 白名单不动
  - 响应 `skillAllowlist` + 事件 agent.binding_updated；UI 状态条可观测
  - 自测：runtime skill-commands 2/2 · approval 5/5 · desktop rebuild
- **未完成 / 仍 open**
  - 真 MCP spawn / 真工具执行
  - 外网手测 / dogfood ≥3 天
  - **M1 仍 open**
- **如何观察**
  1. 升级 skill 入队审批
  2. 批准后 Agent 白名单出现新版本
  3. 拒绝则不出现

## 本轮进度：2026-07-12 · MCP 敏感工具调用 → 审批中心入队（§9.3→§13）

- **已完成（soft）**
  - core：`evaluateMcpToolSensitivity`（untrusted / 高风险名 / 不在目录 / force）
  - protocol/runtime：`mcp.tool.request` → 敏感闸 → Approval Center（kind=mcp-permission）
  - 事件 approval.requested + mcp.tool_requested；响应可观测 enqueued/autoApproved/simulated
  - UI：Agent「请求工具审批」+ 状态条 + 审批中心「MCP 权限」chip；desktop IPC 已通
  - 自测：core 5 · runtime mcp 3 + approval 5 · ui-kit 10 · desktop rebuild
- **未完成 / 仍 open**
  - 真 MCP spawn / 真工具执行
  - Skill 批准后自动白名单绑定
  - 外网手测 / dogfood ≥3 天
  - **M1 仍 open**
- **如何观察**
  1. Agent 登记 untrusted MCP（含 write_file）
  2. 点「请求工具审批」
  3. 审批中心出现 MCP 权限待审；批准/拒绝可操作（仍不执行工具）

## 本轮进度：2026-07-12 · Memory → 审批中心双向桥接（§10.4→§13）

- **已完成（soft）**
  - memory.propose pending → Approval Center enqueue（kind=memory）
  - 双向 decide：approval.decide ↔ memory.decide
  - 响应 `approvalRequest` + 事件 approval.requested / memory.change.decided
  - UI：Memory/审批状态条 + 双向列表刷新
  - 自测：runtime memory-commands 4/4 · approval-commands 5/5 · desktop rebuild
- **未完成 / 仍 open**
  - MCP 敏感调用自动入队
  - Skill 批准后自动白名单绑定
  - 外网手测 / dogfood / 真 spawn
  - **M1 仍 open**
- **如何观察**
  1. 产生 pending Memory 变更
  2. 审批中心出现「记忆」待审
  3. 任一侧决定，另一侧同步

## 本轮进度：2026-07-12 · Skill 升级 → 审批中心入队（§9.3→§13）

- **已完成（soft）**
  - skill.import 在 requiresReapproval 时自动 enqueue Approval Center
  - 响应 `reapprovalRequest` + 事件 approval.requested
  - UI：导入状态「已入队审批」+ 审批面板刷新
  - 自测：runtime skill-commands 2/2 · approval-commands 5/5 · desktop rebuild
- **未完成 / 仍 open**
  - MCP 调用自动入队
  - 批准后自动白名单绑定（当前仍手动）
  - 外网手测 / dogfood / 真 spawn
  - **M1 仍 open**
- **如何观察**
  1. 导入 base → 升级版 skill
  2. 审批中心出现 skill-permission 待审
  3. 批准/拒绝可操作；白名单仍手勾

## 本轮进度：2026-07-12 · 审批中心骨架（§13）

- **已完成（soft）**
  - core：`evaluateApproval` / human-only 绝对门闸 / 四模式
  - storage：`approval_request` 表 + SqliteApprovalStore
  - protocol/runtime：`approval.list|evaluate|enqueue|decide` + 事件
  - UI：ApprovalCenterPanel + 左栏可观测；preload bridge 已通
  - 自测：core 12 · storage 4+11 · runtime 5 · ui-kit 4 · desktop rebuild GREEN
- **未完成 / 仍 open**
  - 审批与 skill/MCP/工具执行自动挂钩
  - 外网真网关手测、dogfood、真进程 spawn
  - **M1 仍 open**（勿自动关闭）
- **下一步建议**
  - 把 skill 升级 reapproval / MCP 敏感调用接入 Approval 入队
  - 或补齐 M1 退出证据（外网 UI / dogfood）

## 本轮进度：2026-07-12 · Skill 升级权限 diff（§9.3）

- **已完成（soft）**
  - core：`diffSkillPermissions`（新增 tools/scripts → 需重新批准）
  - storage：`findLatestByName` 取同名上一版
  - runtime：`skill.import` 返回 `permissionDiff`；事件带 reapproval 字段
  - UI：导入状态条显示需重新批准 / +tools；列表显示 tools 数
  - 自测：core 69 / storage skill 4 / runtime skill-commands 2/2 / ui-kit 9；desktop rebuild GREEN
- **未完成 / 阻塞**
  - 外网真实网关 UI 手测（DNS）
  - dogfood ≥ 3 天
  - 完整 Approval Center / 人批工作流（本切片仅 diff 可观测）
  - 真实 MCP spawn
  - **在退出标准有完整证据前不标 M1 完成**
- **如何观察**
  1. Agent 先导入 base skill → 再导入同名升级版（多一个 tool）
  2. 状态条出现「需重新批准 · +tool」
  3. 白名单仍为空，需手动勾选保存

## 本轮进度：2026-07-12 · MCP 进程策略探测骨架（§9.3）

- **已完成（soft）**
  - workers：`mcp-policy` 钳位/截断/超时/untrusted/审计 + `FakeMcpWorker`（不 spawn）
  - protocol/runtime：`mcp.policy.probe` → 模拟探测 + 事件 `mcp.policy_probed`
  - storage：MCP 策略字段钳位与 policy 对齐（修 512 被抬到 1024 的问题）
  - UI：Agent 登记可填超时/输出上限；列表 policyLabel；**探测策略** 状态条可观测
  - 自测：storage 62 / workers 18 / runtime mcp-commands PASS / ui-kit AgentBinding 9；protocol build + runtime/desktop typecheck GREEN
- **未完成 / 阻塞**
  - 外网真实网关 UI 手测（DNS）
  - dogfood ≥ 3 天
  - 真实 MCP 进程 spawn / 远程 transport（本切片仍为假探测）
  - **在退出标准有完整证据前不标 M1 完成**
- **如何观察**
  1. `SYNC_THINK_DEV_NO_TOKEN=1` + Node 20：`pnpm dev:runtime` + `pnpm dev:desktop`
  2. Agent → 登记 MCP（可填超时/输出上限）→ 列表看 policyLabel
  3. 点 **探测策略** → 状态条：ok/truncated/untrusted + raw→kept + auditNote
  4. 确认不启动真实进程

## 本轮进度：2026-07-12 · MCP 授权骨架（§9.3）

- **已完成（soft）**
  - storage：`mcp_server` 表 + `SqliteMcpStore.register/list` + migration `0005_mcp_server`
  - core：`resolveAllowedMcpToolSources` → kind `tool-schema`（仅 Agent 白名单）
  - protocol/runtime：`mcp.register` / `mcp.list` 入 dispatch；peek/run 注入 tool-schema
  - UI：Agent 登记 MCP + 白名单勾选；Manifest proof `mcp N · 入包 M`
  - desktop：IPC + renderer 全链路可观测状态
  - 自测：storage 61 / core 64 / runtime mcp-commands PASS / ui-kit 62 / desktop 69；build GREEN
- **未完成 / 阻塞**
  - 外网真实网关 UI 手测（DNS）
  - dogfood ≥3 天
  - MCP 进程实际 spawn / 超时 / 输出限幅 / untrusted 审计（后续 worker）
  - **在退出标准有完整证据前不标 M1 完成**
- **如何观察**
  1. `SYNC_THINK_DEV_NO_TOKEN=1` + Node 20：`pnpm dev:runtime` + `pnpm dev:desktop`
  2. Agent → 登记 MCP（name + tools，不启动进程）→ 勾选白名单 → 保存
  3. Manifest → **预览上下文** → proof「mcp 1 · 入包 N」+ 列表 tool-schema 行
  4. 取消白名单 → 再预览 → mcp none / 无 tool-schema

## 本轮进度：2026-07-12 · Skill 正文注入 Context Packet（§10.2）

- **已完成（soft）**
  - core：`resolveAllowedSkillSources` → kind `skill-definition`
  - runtime：peek/run/fallback/rebind 将 Agent allowlist Skill 正文入包
  - UI：Manifest skills 行显示 **入包 N**
  - 自测：core 59 / runtime 57 / ui-kit 58；typecheck/build GREEN
- **未完成 / 阻塞**
  - 外网真实网关 UI 手测（DNS）
  - dogfood ≥3 天
  - **在退出标准有完整证据前不标 M1 完成**
- **如何观察**
  1. Agent 勾选 Skill → Manifest 预览 → proof「入包 1」+ 列表 Skill 行
  2. 清空白名单 → 再预览 → 无 skill-definition

# Current Status

本文档用于跨对话、跨开发者、跨 AI 助手接续项目。

## 本轮进度：2026-07-12 · Skill 导入 + Agent 白名单（§9）

- **已完成（soft）**
  - core/storage/protocol/runtime：SKILL.md 解析、内容寻址库、`skill.import`/`skill.list`、Agent allowlist、peek 贯通
  - UI：Agent 面板导入条 + 白名单勾选 + 可观测状态；desktop IPC 全链路
  - 自测：core 53 / storage 56 / runtime 57 / ui-kit 57 / desktop 69 全绿；typecheck GREEN
- **未完成 / 阻塞**
  - 外网真实网关 UI 手测（DNS）
  - dogfood ≥3 天
  - **在退出标准有完整证据前不标 M1 完成**
- **如何观察**
  1. `SYNC_THINK_DEV_NO_TOKEN=1` + Node 20：`pnpm dev:runtime` + `pnpm dev:desktop`
  2. Agent → 导入 SKILL.md → 勾选白名单 → 保存 → Manifest 预览看 skills N

## 本轮进度：2026-07-12 · UI 偏好记忆（§15.2 主题 / 轨迹 / 布局）

- **已完成（soft）**
  - desktop：`ui-preferences.ts` 统一 theme / traceCollapsed / conversationLayout
  - AppShell 受控折叠 + 写回 localStorage；主题与布局切换即时持久化
  - 自测：ui-kit 55 / desktop 69 全绿；build GREEN
- **未完成 / 阻塞**
  - 外网真实网关 UI 手测（DNS）
  - dogfood ≥3 天
  - **在退出标准有完整证据前不标 M1 完成**
- **如何观察**
  1. 折叠轨迹或 Ctrl+\ → 重启 App 仍保持
  2. 切换深色 / 单列 → 重启仍保持

## 本轮进度：2026-07-12 · 单列对话布局（Locked IA §28）

- **已完成（soft）**
  - ui-kit：MessageBubble `layout` + thread single-column CSS（全宽阅读 + 角色左侧描边）
  - desktop：任务头栏「分栏 / 单列」可观测开关；localStorage `sync-think.conversationLayout`
  - 自测：ui-kit 54 / desktop 64 全绿；build GREEN
- **未完成 / 阻塞**
  - 外网真实网关 UI 手测（DNS）
  - dogfood ≥3 天
  - **在退出标准有完整证据前不标 M1 完成**
- **如何观察**
  1. `SYNC_THINK_DEV_NO_TOKEN=1` + Node 20：`pnpm dev:runtime` + `pnpm dev:desktop`
  2. 任务标题右侧布局图标：单列 = 全宽阅读；分栏 = 用户右 / 助手左

## 本轮进度：2026-07-12 · Manifest 版本可观测（§10.3 Agent/Skill/Policy）

- **已完成（soft）**
  - protocol/runtime：peek + packet.built 贯通 `agentVersion` / `skillVersionIds` / `policyId`
  - UI：Manifest proof 区 agent / skills / policy；peek 状态条可观测
  - 修复 runtime tsc（amend 导入与类型）→ build GREEN
  - 自测：core 47 / runtime 56 / ui-kit 51 / desktop 64 全绿
- **未完成 / 阻塞**
  - 外网真实网关 UI 手测（DNS）
  - dogfood ≥3 天
  - Skill 导入与非空 allowlist（后续）
  - **在退出标准有完整证据前不标 M1 完成**
- **如何观察**
  1. `SYNC_THINK_DEV_NO_TOKEN=1` + Node 20：`pnpm dev:runtime` + `pnpm dev:desktop`
  2. Manifest → **预览上下文** → proof 看 agent vN / skills / policy

## 本轮进度：2026-07-12 · context.packet.amend（Manifest 修订 §10.3）

- **已完成（soft）**
  - core：`applyUserContextAmendments`；受保护 kind 拒绝强制排除
  - protocol/runtime：`context.packet.amend`；thread 级 force-exclude；peek/run/fallback 一致应用
  - UI：Manifest **排除** / **恢复自动** + 修订状态条；desktop 全链路
  - 自测：core 47 / runtime 56 / ui-kit 50 / desktop 64 全绿
- **未完成 / 阻塞**
  - 外网真实网关 UI 手测（DNS）
  - dogfood ≥3 天
  - **在退出标准有完整证据前不标 M1 完成**
- **如何观察**
  1. `SYNC_THINK_DEV_NO_TOKEN=1` + Node 20：`pnpm dev:runtime` + `pnpm dev:desktop`
  2. Manifest → 预览上下文 → 排除非受保护来源 → 看修订条与 re-peek → 恢复自动

## 本轮进度（2026-07-12 · context.packet.peek 只读预览）

- **已完成（soft）**
  - protocol：`PeekContextPacket*` + `DEFAULT_FEATURES` 含 `context.packet.peek`
  - runtime：只读 peek（无 run / 无 durable packet.built）；approve→peek 含记忆，rollback→peek 清除
  - UI：Manifest **预览上下文**；desktop IPC/preload/renderer 接线
  - 自测：runtime 55 / ui-kit 47 / desktop build GREEN
- **未完成 / 阻塞**
  - 外网真实网关 UI 手测（DNS）
  - dogfood ≥3 天
  - **在退出标准有完整证据前不标 M1 完成**
- **如何观察**
  1. `SYNC_THINK_DEV_NO_TOKEN=1` + Node 20：`pnpm dev:runtime` + `pnpm dev:desktop`
  2. Manifest → **预览上下文**（无需发消息）→ 批准/回滚 Memory 后再 peek 对比记忆证据

## 本轮进度（2026-07-12 · Memory 回滚 §10.4）

- **已完成（soft）**
  - storage：版本保留 apply + `rollbackChange`（排除已回滚前驱）
  - protocol/runtime：`memory.rollback` + `memory.change.rolled_back`
  - UI：变更历史 + 回滚按钮；desktop IPC/renderer 接线
  - 自测：storage 52 / runtime 54 / ui-kit 45 / desktop 64 全绿
- **未完成 / 阻塞**
  - 外网真实网关 UI 手测（DNS）
  - dogfood ≥3 天
  - **在退出标准有完整证据前不标 M1 完成**
- **如何观察**
  1. `SYNC_THINK_DEV_NO_TOKEN=1` + Node 20：`pnpm dev:runtime` + `pnpm dev:desktop`
  2. Memory 面板批准 → 变更历史点 **回滚** → 持久记忆恢复；Manifest 证据链随之变化

## 本轮进度（2026-07-12 · 项目记忆 → Packet/Manifest）

- **已完成（soft）**
  - core：`resolveProjectMemorySources` + Packet/Manifest `evidenceRefsForMemory`
  - runtime：protected selection 注入 project-memory；prepare/rebind/fallback 透传
  - UI：Manifest **记忆证据** 区块 + proof chip；kind「项目记忆」
  - 自测：core 43 / runtime 53 / ui-kit 44 / desktop 64 全绿；相关 build 全绿
- **未完成 / 阻塞**
  - 外网真实网关 UI 手测（DNS）
  - dogfood ≥3 天
  - **在退出标准有完整证据前不标 M1 完成**
- **如何观察**
  1. `SYNC_THINK_DEV_NO_TOKEN=1` + Node 20：`pnpm dev:runtime` + `pnpm dev:desktop`
  2. 批准项目记忆后发消息 → Manifest 看「项目记忆」与「记忆证据」

## 1. 快照

```text
更新时间：2026-07-12（Manifest 版本 soft craft 已绿；外网 UI 手测仍 open）
当前阶段：Phase 1 / M1 进行中（cross-task §10.1 + protected context + keyboard 已绿；外网 UI 手测仍 open）
当前分支：无 git 仓库（按用户要求不初始化）
项目根：D:\\projects\\SYNC-THINK
环境：Windows 11 x64 / Node 20.x / pnpm 10.28.2
当前状态：M0 已关闭；M1 进行中——peek 只读预览 soft 已落档 + §10.4 回滚 + 既有 soft 证据包；外网 UI 手测仍 open；**不自动关闭 M1**
固定测试日志：docs/development/12-test-log.md
```

## 2. 强制约束

1. 产品真源：docs/superpowers/specs/2026-07-11-sync-think-product-design.md。
2. M0 已关闭；M1 已启动（2026-07-12）。不得把 M1 non-goals（多 Agent 自动执行、UIA、CC Switch 全量导入、安装器、生图生产化）带进当前里程碑。
3. 不初始化 Git。
4. SQLite 是唯一真源；保持 better-sqlite3 + Drizzle。
5. Runtime 生命周期独立于 Electron。
6. 行为修改必须 TDD：RED -> GREEN。
7. secrets 不得进入 DB、日志、提示词、Renderer 或导出。
8. 保持 contextIsolation true、nodeIntegration false、sandbox true 和 strict CSP。

## 3. M1 退出标准与非目标（已复述）

### 退出标准

1. 同一任务可跨 ≥2 providers / ≥3 models，无需重述上下文。
2. 绑定优先级成立：run > workflow > agent default > fallback。
3. 每次模型调用可检查 Manifest。
4. 完整流 + 浅/深主题 + 可折叠轨迹 + 文件夹/任务 IA。
5. 无明文 key 进入 DB/日志/诊断/提示词。
6. App 重启可安全恢复对话与在途 stream 状态。

### 非目标

Multi-agent 自动执行、desktop UIA、CC Switch 全量导入、installer、image pipeline 生产化。

## 4. 本轮完成项

### 4.1 既有（勿重做）

Workspace IA、Conversation 可观测性、Providers SecureStore、真实 OpenAI 兼容发现、浅/深主题、可折叠 trace、Compose 本轮模型选择器、core resolveModelBinding、live OpenAI stream、Manifest 事件、Agent 持久化绑定面板、Memory/Diagnostics 面板、系统文件夹选择器、Runtime 失败自动 fallback 链、Fallback/Pause UI 可观测。

### 4.2 本地双 HTTP 真实网关 live 证据（本轮）

1. apps/runtime/tests/dual-http-gateway.test.ts：
   - 两个 http.createServer OpenAI 兼容网关（GET /models + POST /chat/completions SSE）
   - 无 demoProvider：强制走 OpenAIChatAdapter + SecureStore 取钥
   - 用例 A：同一任务 3 模型（2 provider）顺序 override，断言网关调用与 assistantText
   - 用例 B：主模型 429 → run.fallback.selected → 另一网关 fallback 完成，密钥不进事件
2. Runtime 全量 44 tests 全绿

## 5. 验证基线

```text
@sync-think/core test：4 files / 38 tests passed（含 selectContextSources + resolveCrossTaskRefs）
@sync-think/storage test：9 files / 52 tests passed（含 memory rollback §10.4）
@sync-think/runtime test：18 files / 55 tests passed（含 context.packet.peek + memory.rollback）
@sync-think/ui-kit test：10 files / 47 tests passed（含 Manifest peek + Memory 回滚）
@sync-think/desktop test：13 files / 64 tests passed；desktop build GREEN
```

## 6. 当前未完成 / 下一步

- [x] Agents 绑定优先级（core + Runtime store + UI 配置）
- [x] chat/run 绑定已注册 provider/model + live OpenAI chat stream
- [x] Context Packet / Manifest 可检查（事件 + **右侧轨 ManifestPanel 可检查 UI** + Trace 联动）
- [x] context.packet.peek 只读预览（无需发消息；回滚后 peek 证据变化）
- [x] UI 模型选择器 + Agent 持久化 default/fallback
- [x] Memory/Diagnostics 面板 + 文件夹选择器
- [x] Runtime 失败自动 walk fallback 链（§5.3）
- [x] 同任务 ≥2 providers / ≥3 models 自动化证据（fake/adapters）
- [x] Fallback/Pause 在 Trace + Stream 状态条可观测
- [x] 本地双 HTTP 真实网关 live 集成证据（OpenAIChatAdapter + SecureStore + SSE；含跨网关 fallback）
- [x] Capability Probe 建议 + 用户确认（§7.2）：core 启发式 + store + runtime 命令/事件 + ProvidersPanel 芯片 + Desktop IPC/renderer 可观测
- [x] M1 退出标准证据矩阵（软验收包）→ `12-test-log.md`
- [ ] 外网真实网关手测（kamenking/公网 DNS 不稳）：UI 路径写入 12-test-log
- [x] 可选：Anthropic Messages 专用 list/stream（discovery + SSE + dual-protocol live 已绿）
- [ ] **在退出标准有完整证据前不标 M1 完成**

## 7. 如何继续（给下一任）

1. 不要重做已完成的 Agent/Memory/Providers UI 壳、fallback walk 内核、dual-http live 集成。
2. 本地双 HTTP live 证据已绿；若外网 DNS/密钥可用，再补 UI 手测（Providers 配两个真实 baseUrl → Agent default+fallback → 同任务切换/失败切换，观察 Trace Fallback 与 Manifest）。
3. 重启桌面前重建：pnpm --filter @sync-think/desktop build → pnpm dev:runtime → pnpm dev:desktop（Node 20）。
4. 中文文档写入用 Node/Python UTF-8，勿仅用 PowerShell 拼多行中文。

---

## 本轮进度（2026-07-12 · Anthropic + 双协议 live）

- **已完成**
  - 修复 `packages/adapters/src/index.ts` 末尾字面量 `\\n` 损坏（导致 Anthropic 导出无效）
  - `AnthropicMessagesAdapter`：GET /models（x-api-key + anthropic-version）+ POST /messages SSE 流式
  - Runtime `discoveryByProtocol['anthropic-messages']` 已注册（`apps/runtime/src/main.ts`）
  - 单元测试：`packages/adapters` 4 files / **29** tests（含 anthropic stream 8 项）
  - 集成证据：`apps/runtime/tests/dual-protocol-gateway.test.ts`
    - 同任务 OpenAI chat ×2 + Anthropic messages ×1（≥2 providers / ≥3 models）
    - OpenAI 429 → Anthropic fallback（`run.fallback.selected` → completed，同一用户消息上下文）
    - Manifest proofHash + 事件无明文密钥
  - Runtime 全量：14 files / **46** tests GREEN
- **未完成 / 阻塞**
  - 外网真实网关 UI 手测（DNS：kamenking / api.openai.com / api.anthropic.com 当前环境不可解析）
  - **在退出标准有完整证据前不标 M1 完成**

---

## 本轮进度（2026-07-12 · Manifest 可检查 UI）

- **已完成**
  - 投影：`ConversationProjection.manifests` / `latestManifest`（`context.packet.built` → 可检查记录）
  - UI：`ManifestPanel`（纳入/排除/proof/tokens/resolution）+ Trace 选中联动
  - Runtime 事件载荷补齐 included/excluded sources 与 summaries（去掉嵌套完整 run 对象）
  - 测试：desktop 61、ui-kit 34、runtime 46 全绿；desktop/ui-kit build 通过
- **未完成 / 阻塞**
  - 外网真实网关 UI 手测（DNS）
  - **在退出标准有完整证据前不标 M1 完成**
- **如何观察**
  1. `pnpm --filter @sync-think/desktop build`
  2. 启动 runtime + desktop
  3. 发消息后看右侧轨 Manifest 面板与 Trace 中 Manifest 行

---

## 本轮进度（2026-07-12 · Capability Probe 端到端）

- **已完成**
  - 修复 `ProvidersPanel.test.tsx`（探测用例误挂在 describe 外）
  - 能力芯片首次点击原子 toggle（避免 draft 竞态）
  - Desktop：payload 校验 / main IPC / preload / global.d.ts / renderer 探测+确认与事件刷新
  - 修复 runtime `command-validation` 缺少 Probe/Confirm 类型导入（build 通过）
  - 自测：core 22 / storage 49 / runtime 47 / ui-kit 35 / desktop 62 全绿；desktop + runtime build 通过
- **可观测**
  - Providers 状态条：探测建议摘要、确认标签
  - 模型行 suggested / confirmed 徽标 + 能力芯片
- **下一步（M1 仍不关闭）**
  1. 外网 DNS/密钥可用时补真实网关 UI 手测证据
  2. 汇总退出标准证据包后再关 M1
- **重启观察路径**
  1. `pnpm --filter @sync-think/desktop build`
  2. `pnpm dev:runtime` → `pnpm dev:desktop`（Node 20 优先）

---

## 本轮进度（2026-07-12 · §5.4 凭据组 + pin）

- **已完成**
  - core `resolveCredentialRef`：run → pin → group → providerPrimary；**跨 provider 拒绝旧密钥**
  - storage：`listCredentialsByGroup` / `getFirstCredentialInGroup` / `addCredentialRef` / `getProviderIdForCredentialGroup`
  - runtime：`resolveRunCredentialRef` + rebind 正确换钥；dual-http / dual-protocol fallback 密钥断言 GREEN
  - UI：AgentBindingPanel 组+pin；Manifest 显示 credential 解析来源与 ref 前缀（无明文）
  - 修复 Desktop renderer 被 patch 误删的 createProvider / discover / addModel / loadMemory / decideMemory
  - 自测：core 28 / runtime 48 / ui-kit 36 / desktop 63 / provider-store 7；desktop build GREEN
- **未完成 / 阻塞**
  - 外网真实网关 UI 手测（DNS）
  - **在退出标准有完整证据前不标 M1 完成**
- **如何观察**
  1. `pnpm --filter @sync-think/desktop build`
  2. `pnpm dev:runtime` → `pnpm dev:desktop`（Node 20 优先）
  3. Agent 面板绑凭证组/pin → 发消息 → 右侧 Manifest 看 credential 行
- **下一步**
  1. 外网可用时补 UI 手测证据写入 12-test-log
  2. 汇总 M1 退出标准证据矩阵（仍不自动关 M1）

---

## 本轮进度（2026-07-12 · M1 退出标准证据矩阵）

- **已完成**
  - 对照 product design / `11-implementation-plan.md` M1 exit criteria 1–6，汇总自动化 + 本地 dual-http/dual-protocol live + UI 路径
  - 固定日志追加完整证据矩阵（标准 1/6 软通过；2–5 通过；关联 §5.4 / §7.2 / Memory）
  - 计划文档 M1 progress 勾选：Agents/Context/Memory/Diagnostics 与实现对齐
  - 复跑：core 28 / runtime 48 / ui-kit 36 / desktop 63 全绿
  - 外网探测：OpenAI 401（可达无钥）；Anthropic ENOTFOUND
- **未完成 / 阻塞**
  - 外网真实网关 **UI 手测**（DNS/密钥）
  - dogfood ≥3 天（计划门）
  - **在完整证据（含外网或用户明确决策）前不标 M1 完成**
- **如何观察**
  1. 阅读 `docs/development/12-test-log.md` 最新「M1 退出标准证据矩阵」
  2. `pnpm --filter @sync-think/desktop build` → `pnpm dev:runtime` → `pnpm dev:desktop`
  3. 主题 / Workspace / Providers / Agent / 发消息 Manifest+Trace
- **下一步**
  1. 网络可用时做外网 UI 手测并追加 12-test-log
  2. 可选 UI 空态/a11y polish
  3. 仍不自动关 M1

---

## 本轮进度（2026-07-12 · 退出标准 6 冷恢复加强）

- **已完成**
  - Runtime `conversation-restore.test.ts`：多轮对话 SQLite 冷启恢复 + 第三轮续聊
  - Desktop 冷启动 snapshot → 四气泡 + 2 Manifest + credential 来源
  - 对话空态 UI：connecting/offline/ready + 三项可观测检查点
  - 自测：runtime 49 / desktop 64 全绿
- **未完成**
  - 外网真实网关 UI 手测（DNS 仍失败）
  - **不标 M1 完成**
- **如何观察**
  1. 重建 desktop 后启动 runtime + desktop
  2. 看中间空态检查点与连接态文案
  3. 多轮消息后重启 Runtime，历史应恢复

---

## 本轮进度（2026-07-12 · 受保护上下文 + 键盘）

- **已完成**
  - core `selectContextSources` + `PROTECTED_SOURCE_KINDS`（TDD 6 项）
  - storage `getTaskByThreadId`；Runtime 按 thread 注入 task-goal / acceptance / status
  - Compose Ctrl+Enter / Esc；AppShell Ctrl+\\；空态 + Compose + Trace 可观测 kbd
  - 自测：core 34 / storage 51 / runtime 49 / ui-kit 40 / desktop 64；各包 build GREEN
- **未完成 / 阻塞**
  - 外网真实网关 UI 手测（DNS ENOTFOUND）
  - **在退出标准有完整证据前不标 M1 完成**
- **如何观察**
  1. `pnpm --filter @sync-think/desktop build`
  2. `pnpm dev:runtime` → `pnpm dev:desktop`（Node 20）
  3. 空态 / Compose / Trace 看快捷键；发消息后 Manifest 看任务目标纳入

---

## 本轮进度（2026-07-12 · 显式跨任务引用）

- **已完成**
  - core `resolveCrossTaskRefs`：仅显式 parentTaskId → crossTaskRefs / cross-task-ref 源
  - runtime `buildProtectedContextSelection` 注入父任务；Packet 事件可断言
  - UI：子任务 `+`、Manifest「跨任务引用」、skip-link 主对话
  - 复跑：core 38 / runtime 51 / ui-kit 43 / desktop 64 全绿（Node 20）
- **未完成**
  - 外网真实网关 UI 手测
  - dogfood ≥3 天
  - **不关闭 M1**

---

## 本轮进度（2026-07-12 · 项目记忆注入，续）

- Soft craft 完成：project-memory 进入 Context Packet + Manifest 记忆证据可观测。
- 验证：core 43 / runtime 53 / ui-kit 44 / desktop 64；builds GREEN。
- **M1 仍 open**（外网 UI 手测 + dogfood 待办）。

---

## 本轮进度（2026-07-16 · Multica 参考的新人桌面工作区）

- **已完成**
  - 新增批准规格 `docs/superpowers/specs/2026-07-16-beginner-desktop-workspace-design.md`，明确只重排信息表达，不改 Provider/Agent/模型/任务/执行数据合同。
  - 左侧改为常驻文字导航：任务、智能体、模型源、审批；任务区保留本地文件夹与嵌套任务，并新增明确的 `新建任务`。
  - 任务头直接显示工作区/任务、状态、负责智能体和运行模型；原脚手架 Continuum 芯片替换为一个状态驱动的 `下一步`。
  - 右栏默认进入 `任务进度`：状态、三步进度、下一步、负责人、审批和产物；Trace/Manifest/执行图/产物版本保留在 `执行详情`。
  - 健康对话移除常驻 readiness 仪表；断线/失败只保留紧凑恢复条。
  - 空任务页改为三步新人主路径，不再展示 Runtime/Run/消息/模型/跨 Provider 检查清单。
  - Composer 行为不变；placeholder 明确消息将发送给哪个 Agent。
- **验证**
  - 新增 Desktop 状态/壳体测试 11 项，UI Kit AppShell 自定义右栏标题测试 1 项。
  - Root test `20/20` tasks；Desktop `334/334`；UI Kit `216/216`。
  - Root typecheck `20/20`；root build `11/11`。
  - Electron 实窗：1427×894 活跃任务；执行详情往返、智能体抽屉、任务返回均通过；stderr 0。
  - 隐藏 Electron QA：1366×768 与 1280×720 均 `documentOverflow x=0 / y=0`，三栏、任务头、空态和 Compose 无重叠。
- **当前运行状态**
  - Runtime 保持运行，最新 Desktop 已重启并打开，默认停在 `任务进度`。
- **后续边界**
  - 本轮没有删除任何高级执行能力，也没有改变模型路由或凭据解析。
  - 视觉概念图服务两次返回上游 502；最终以 Multica 实屏、项目 tokens 和两档 Electron 实窗为设计/验证真源。
