## 2026-07-16 · 对话 Agent 身份与产品界面减负（已完成）

- [x] 写入用户确认规格，覆盖旧的“消息隐藏 Agent 名称”决定
- [x] Context 结构位改为工作区 / 任务 / 对话，不再伪装成持久决策或记忆
- [x] M1 验证工作台退出普通产品组合，历史证据与测试保留
- [x] `run.started.agentVersionId` 投影到助手消息并解析精确 AgentVersion
- [x] Multica 式圆形头像 + Agent 名称 + 流式状态；正文继续使用 Codex 式无框 Markdown
- [x] 点击消息身份打开对应 Agent 抽屉
- [x] 聚焦 RED/GREEN、包全量、全仓强制 test、typecheck、build、Electron 重启与实窗交互验证通过

## 2026-07-15 · 用户将 dogfood 改为 1 天；M1 / M2 全部完成

> 本节是当前真源。下方旧条目中的 `≥3 天`、`1/3` 与 “M1 open” 是当时的历史记录，已被用户本次明确决策覆盖。

- [x] AgentVersion 不可变历史与精确 pin；Task participation mode 持久化
- [x] PlanRevision 草稿 / 修订 / 批准与 taskVersion 原子更新
- [x] ArtifactVersion 不可变版本、比较、选择、显式 Merge Step 与冲突解决
- [x] 持久 DAG 并行调度、暂停 / 恢复 / 取消、Runtime 重启恢复
- [x] 服务端审批策略、Skill/MCP 多作用域授权、human-only 边界
- [x] Reviewer evidence、一次有界 rework、limit-reached 暂停
- [x] Desktop 计划 / 执行图 / 审批 / 产物 / Agent 工作区和 Automatic 只读门禁
- [x] M2 退出演示、自测脚本、全仓验证、双尺寸 Electron QA、P1 审查
- [x] M2 可独立标记完成；不以此替代 M1 的真实日历证据
- [x] 用户明确将 M1 dogfood 门槛改为 **1 个真实使用日**
- [x] `2026-07-12.md` 已是有效真实记录，当前 **1/1**；M1 退出门槛满足
- [x] 更新状态、测试日志、路线图、dogfood 索引和 changelog；M1 / M2 均关闭

## 2026-07-13 · M1 外网 18/18；用户授权连续实现 M2（M1 日历门槛仍 open）

- [x] 外网真实网关 UI 手测 **18/18**：真实 Provider、3+ 模型、Manifest、Fallback、pause、取消、恢复与安全证据已落档
- [x] 真实取消：`run.cancelled` 唯一终态，Composer 恢复；网关首个 delta 前取消，不伪造部分输出证据
- [x] dogfood 2026-07-12 真实使用记录完成，当前有效 **1/3**
- [ ] dogfood 仍需累计至 **3/3 真实日期**；未达成前不关闭 M1
- [x] 用户 2026-07-13 明确要求“后面不需要询问，把这个方案的 M1 和 M2 做完”；授权在 M1 日历门槛累计期间并行实施 M2
- [x] M2 已按本文件 §5 workstreams 与 exit demo 直接验收，未以 M1 soft 投影或未接线 UI 代替

## 2026-07-12 · 完成 · Codex 式消息流 + 紧凑 Composer

- [x] Assistant string 内容通过 `react-markdown` + GFM 渲染，原始 HTML 不启用
- [x] 对话正文移除 Agent / model / Run 重复元信息，保留 Trace / Manifest 观测面
- [x] 用户消息改为右侧紧凑气泡；Markdown 标题 / 列表 / code / pre / table / blockquote 样式收口
- [x] Composer 移除模式、工作区、模型数量与 readiness 常驻信息
- [x] 模型选择器固定左下，发送 / 停止为 32px 图标按钮，异常状态为单行 blocker
- [x] blocker 参与真实发送门禁；异步发送返回失败时保留草稿，成功才清空
- [x] Agent 默认使用真实 provider model name，不展示内部 UUID 截断
- [x] UI Kit 192 + Desktop 267；root test/typecheck/build；Electron 双尺寸实窗验证
- [ ] M1 硬门槛：`14-external-gateway-handtest.md` 外网 UI 手测 0/18
- [ ] M1 硬门槛：dogfood ≥3 真实天（当前 0/3）
- [ ] **勿**启动 M2 / **勿**仅靠 soft 关 M1

## 14. 2026-07-16 新人桌面工作区切片（完成）

规格：`docs/superpowers/specs/2026-07-16-beginner-desktop-workspace-design.md`

- [x] TDD：空任务、断线、未配置、可开始、处理中、待审批和已有产物的纯状态投影
- [x] 左侧文字产品导航 + 任务树 + 明确新建任务
- [x] 任务头显示负责 Agent 与运行模型
- [x] 普通 Context 槽收敛为一个状态驱动的 `下一步`
- [x] 右栏默认任务进度；高级 Trace/Manifest/图/审批/产物按需打开
- [x] 健康对话隐藏 readiness 仪表；错误态紧凑可恢复
- [x] 全新用户三步空态
- [x] 1366×768、1280×720 Electron 布局验证
- [x] Root test/typecheck/build 全绿并重启 Desktop

保留边界：Composer、Provider/Agent 抽屉、任务树、对话身份、模型路由、审批、执行图、Artifact 与 Trace/Manifest 行为不变。

## 2026-07-12 · soft #64 完成 · Codex 式左栏工具抽屉 + Provider 错误中文化

- [x] 视觉方案 C 经用户确认并固化到 `docs/superpowers/specs/2026-07-12-left-nav-tool-drawer-design.md`
- [x] 左栏默认只显示任务树、四工具图标条与紧凑 Runtime 状态
- [x] Provider / Agent / 记忆 / 审批共用单层覆盖式抽屉
- [x] 同工具 toggle、跨工具 replace、Esc/遮罩/关闭按钮 dismiss、跳转自动 open
- [x] `WorkspaceNav.hideFooter` 保留默认 footer 契约，产品组合自绘 Runtime 行
- [x] 模型发现 fetch/timeout/auth/rate-limit/404 错误转为可行动中文
- [x] root test 20/20 · 715 tests；typecheck 20/20；build 11/11；quick soft GREEN
- [ ] M1 硬门槛：`14-external-gateway-handtest.md` 外网 UI 手测 0/18
- [ ] M1 硬门槛：dogfood ≥3 真实天（当前 0/3）
- [ ] **勿**启动 M2 / **勿**仅靠 soft 关 M1

## 2026-07-12 · soft #63 完成 · Codex 式工作台减负 + replay 游标修复

- [x] 中心 M1 验证区默认折叠为单行摘要；原硬门槛/下一步/外网/退出路径按需展开
- [x] 隐藏产品首屏重复 readiness，保留投影逻辑与测试
- [x] 持久 Runtime 所有 `appendEvent` 经 SQLite 分配统一序列
- [x] replay 真实探针严格单调；Desktop 手动重连恢复完整状态
- [x] 同毫秒任务以 SQLite `rowid` 稳定插入顺序
- [x] root test 20/20 · 707 tests；typecheck 20/20；build 11/11；quick soft GREEN
- [ ] M1 硬门槛：`14-external-gateway-handtest.md` 外网 UI 手测 0/18
- [ ] M1 硬门槛：dogfood ≥3 真实天（当前 0/3）
- [ ] **勿**启动 M2 / **勿**仅靠 soft 关 M1

## 2026-07-12 · soft #61+#62 完成 · 硬门槛条 + 左侧仪器切换

- [x] pure `m1-hardgate-strip.ts`（手测/dogfood 表 · CTA · claimsM1Closed=false）
- [x] UI 主路径轨顶部硬门槛条 + CTA 接线（focus-external → filter-external）
- [x] pure `left-instrument-switch.ts` + 左侧 tab 一次一仪器
- [x] Skill 导入 preflight 中文错误 + 填入示例 + 错误贴近导入区
- [x] 单测 8+3 · soft full GREEN · Electron PID 17820
- [ ] M1 硬门槛：外网 0/18 + dogfood ≥3（用户）
- [ ] **勿** 启动 M2 / **勿** 关 M1

## 2026-07-12 · soft #60 完成 · 观测布局减负

- [x] pure 模块 `m1-obs-layout.ts`（primary vs secondary、默认展开表）
- [x] UI：主路径轨 next → external-focus → exit-path；次要 details 折叠
- [x] flash 次要 board 自动展开 accordion
- [x] CSS 简洁大气主路径轨 + 可滚动次要体
- [x] 单测 7/7 · soft full GREEN · Electron PID 61620
- [ ] M1 硬门槛：外网 0/18 + dogfood ≥3（用户）
- [ ] **勿** 启动 M2 / **勿** 关 M1

## 本轮计划更新：2026-07-12 · soft #59 完成

- [x] #59 外网聚焦合入 next-action / exit-path / evidence-bundle（CTA · paste · 导出 · CSS · soft 59 · build + Electron）
- [ ] 硬门槛：`14-external-gateway-handtest.md` 外网 UI 手测 0/18
- [ ] 硬门槛：dogfood ≥3 真实天（脚手架/草稿不计）
- [ ] **勿** 启动 M2；**勿** 仅靠 soft 关 M1
- 下一 soft 可选：观测区布局收口（主路径三板，其余折叠），减轻拥挤

## 本轮计划更新：2026-07-12 · soft #58 完成

- [x] #58 手测「下一外网项」聚焦条（模块 + UI + 运行单 + 单测 + soft 58 + build + Electron）
- [ ] 硬门槛：`14-external-gateway-handtest.md` 外网 UI 手测 0/18
- [ ] 硬门槛：dogfood ≥3 真实天（脚手架/草稿不计）
- [ ] **勿** 启动 M2；**勿** 仅靠 soft 关 M1

## 本轮计划更新：2026-07-12 · soft #57 完成

- [x] #57 下一步合入 dogfood 补填板（fill 信号 · CTA · CSS · soft 57 · build + Electron）
- [ ] 硬门槛：`14-external-gateway-handtest.md` 外网 UI 手测 0/18
- [ ] 硬门槛：dogfood ≥3 真实天（脚手架/草稿不计）
- [ ] **勿** 启动 M2；**勿** 仅靠 soft 关 M1

## 本轮计划更新：2026-07-12 · soft #56 完成

- [x] #56 退出路径合入 dogfood 补填板（fill 字段进 paste · CTA · CSS · soft 56 · build + Electron）
- [ ] 硬门槛：`14-external-gateway-handtest.md` 外网 UI 手测 0/18
- [ ] 硬门槛：dogfood ≥3 真实天（脚手架/草稿不计）
- [ ] **勿** 启动 M2；**勿** 仅靠 soft 关 M1

## 本轮计划更新：2026-07-12 · soft #55 完成

- [x] #55 证据包并入 dogfood 多日补填（TOC + 导出 + 单测 + soft 55 + build + Electron）
- [ ] 硬门槛：`14-external-gateway-handtest.md` 外网 UI 手测 0/18
- [ ] 硬门槛：dogfood ≥3 真实天（脚手架/草稿不计）
- [ ] **勿** 启动 M2；**勿** 仅靠 soft 关 M1

## 本轮计划更新：2026-07-12 · soft #54 完成

- [x] #54 dogfood 多日补填板（模块 + 单测 + UI + soft 54 + build + Electron）
- [ ] 硬门槛：`14-external-gateway-handtest.md` 外网 UI 手测 0/18
- [ ] 硬门槛：dogfood ≥3 真实天（脚手架/草稿不计）
- [ ] **勿** 启动 M2；**勿** 仅靠 soft 关 M1

## 2026-07-12 · 第 53 次 soft craft · 本机领先差异可点跳 + 退出路径合入（soft · M1 仍 open）

- [x] 第 53 次：doc-diff 可点 CTA + exit-path live-ahead + 单测 + dual 复测 + rebuild + Electron 重启
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天真实日记
- [ ] **勿**启动 M2
- 固定大白话：第 53 次
- 下一优先：外网手测 / dogfood；soft 仅硬门槛辅助/失败边角；**勿关 M1、勿开 M2**

## 2026-07-12 · soft craft #52 完成（M1 仍 open）

- 已完成：证据包并入文档↔本机差异（一键导出含 hard-gate 对照）
- 未完成硬门槛：外网手测 0/18 · dogfood ≥3 天
- 不启动 M2；不关 M1
- 下一优先：用户外网手测 + 真实 dogfood；soft 仅失败边角 / 硬门槛辅助（勿再堆泛化 readiness 投影）

## 2026-07-12 · soft craft #51 完成（M1 仍 open）

- 已完成：文档↔本机差异板（硬门槛观测：live 领先待勾 / 文档领先复核）
- 未完成硬门槛：外网手测 0/18 · dogfood ≥3 天
- 不启动 M2；不关 M1
- 下一优先：用户外网手测 + 真实 dogfood；soft 仅失败边角 / 硬门槛辅助（勿再堆泛化 readiness 投影）

## 2026-07-12 · soft craft #50 完成（M1 仍 open）

- 已完成：手测文档逐项勾选解析 + UI 徽章（硬门槛观测辅助）
- 未完成硬门槛：外网手测 0/18 · dogfood ≥3 天
- 不启动 M2；不关 M1
- 下一优先：用户外网手测 + 真实 dogfood；soft 仅失败边角 / 硬门槛辅助（勿再堆泛化 readiness 投影）

## 2026-07-12 · soft craft #49 完成（M1 仍 open）

- 已完成：证据包并入退出路径（一键导出含有序硬门槛步骤）
- 未完成硬门槛：外网手测 0/18 · dogfood ≥3 天
- 不启动 M2；不关 M1
- 下一优先：用户外网手测 + 真实 dogfood；soft 仅失败边角 / 硬门槛辅助

## 2026-07-12 · soft craft #48 完成（M1 仍 open）

- 已完成：M1 退出路径板（有序硬门槛步骤 + 进度封顶 99% + 复制路径 + CTA）
- 未完成硬门槛：外网手测 0/18 · dogfood ≥3 天
- 不启动 M2；不关 M1
- 下一优先：用户外网手测 + 真实 dogfood；soft 仅失败边角 / 硬门槛辅助（勿再堆泛化 readiness 投影）

## 2026-07-12 · soft craft #47 完成（M1 仍 open）

- 已完成：证据包一键导出（合成快照+手测粘贴+回归+下一步+草稿）
- 未完成硬门槛：外网手测 0/18 · dogfood ≥3 天
- 不启动 M2；不关 M1

## 2026-07-12 · 第 46 次 soft craft · 回归筛选 + 行跳转（soft · M1 仍 open）

- [x] 第 46 次：filter/count/resolve + UI + 单测 + dual + rebuild + Electron 重启
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿** 启动 M2
- 下一优先：用户硬门槛手测/dogfood；soft 仅失败边角/回归；**勿关 M1**

## 2026-07-12 · 第 45 次 soft craft · soft 回归矩阵（soft · M1 仍 open）

- [x] 第 45 次：auto-vs-handtest 矩阵 + 复制 UI + runner 脚本 + 单测 + dual + rebuild + Electron 重启
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿** 启动 M2
- 下一优先：用户硬门槛手测/dogfood；soft 仅失败边角/回归；**勿关 M1**

## 2026-07-12 · 第 44 次 soft craft · 生成失败恢复 CTA（soft · M1 仍 open）

- [x] 第 44 次：classifyStreamFailure + scrub + failure CTA + 单测 + dual + rebuild + Electron 重启
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿** 启动 M2
- 下一优先：用户硬门槛手测/dogfood；soft 仅失败边角/回归；**勿关 M1**

## 2026-07-12 · 第 43 次 soft craft · dogfood 计分加固（soft · M1 仍 open）

- [x] 第 43 次：粘贴草稿不计有效日 + 按日原因板 + 单测 + dual 复测 + rebuild + Electron 重启
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿** 启动 M2
- 下一优先：用户硬门槛手测/dogfood；soft 仅失败边角/回归；**勿关 M1**

## 2026-07-12 · 第 42 次 soft craft · 复制 dogfood 日记草稿（soft · M1 仍 open）

- [x] 第 42 次：dogfood 草稿粘贴 + 单测 + rebuild
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿**启动 M2
- 固定大白话：第 42 次
- 下一优先：外网网关 UI 手测 / dogfood 日记；**勿关 M1、勿开 M2**

## 2026-07-12 · 第 41 次 soft craft · 手测进度粘贴稿 + 筛选（soft · M1 仍 open）

- [x] 第 41 次：手测进度粘贴稿 + 全部/缺口/外网筛选 + 单测 + rebuild
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿**启动 M2
- 固定大白话：第 41 次
- 下一优先：外网网关 UI 手测 / dogfood 日记；**勿关 M1、勿开 M2**

## 2026-07-12 · 第 40 次 soft craft · dogfood 按日可打开 + 手测分区进度板（soft · M1 仍 open）

- [x] 第 40 次：`dogfood-day` 打开 + 手测分区进度板 + 单测 + rebuild
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿**启动 M2
- 固定大白话：第 40 次
- 下一优先：外网网关 UI 手测 / dogfood 日记；**勿关 M1、勿开 M2**

## 2026-07-12 · 第 39 次 soft craft · dogfood 按日明细 + 聚焦刷新（soft · M1 仍 open）

- [x] 第 39 次：dogfood day board + focus refresh + 单测 + rebuild + Electron 重启
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿** 启动 M2
- 下一优先：用户硬门槛手测/dogfood；soft 仅失败边角/回归；**勿关 M1**

## 2026-07-12 · 第 38 次 soft craft · 复制 soft 快照（soft · M1 仍 open）

- [x] 第 38 次：soft snapshot + UI + 单测 + rebuild + Electron 重启
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿** 启动 M2
- 下一优先：用户硬门槛手测/dogfood；soft 仅失败边角/回归；**勿关 M1**

## 2026-07-12 · 第 37 次 soft craft · 退出证据芯片可点 + 打开反馈（soft · M1 仍 open）

- [x] 第 37 次：exit chip action + open feedback + handtest quick open + 单测 + rebuild + Electron 重启
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿** 启动 M2
- 下一优先：用户硬门槛手测/dogfood；soft 仅失败边角/回归；**勿关 M1**

## 2026-07-12 · 第 36 次 soft craft · 「下一步」重连 + 打开证据文档（soft · M1 仍 open）

- [x] 第 36 次：ctaAction/openDoc + IPC + 单测 + rebuild + Electron 重启
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿** 启动 M2
- 下一优先：用户硬门槛手测/dogfood；soft 仅失败边角/回归；**勿关 M1**

## 2026-07-12 · 第 35 次 soft craft · Runtime 离线手动重连 CTA（soft · M1 仍 open）

- [x] 第 35 次：reconnect CTA + lastConnectFailure + 单测 + rebuild
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿** 启动 M2
- 下一优先：外网手测 / dogfood；soft 仅失败边角/回归；**勿关 M1**

## 2026-07-12 · 第 34 次 soft craft · M1「下一步」主行动条（soft · M1 仍 open）

- [x] 第 34 次：next-action 投影 + UI + 单测 + dual 复测 + rebuild + Electron 重启
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天真实日记
- [ ] **勿**启动 M2
- 固定大白话：第 34 次
- 下一优先：外网手测 / dogfood；soft 避免同质 projector 堆叠

## 2026-07-12 · 第 33 次 soft craft · 手测项点击跳转面板（soft · M1 仍 open）

- [x] 第 33 次：手测项 jump + UI + 单测 + dual 复测 + rebuild + Electron 重启
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天真实日记
- [ ] **勿**启动 M2
- 固定大白话：第 33 次
- 下一优先：外网网关 UI 手测 / dogfood；**勿关 M1、勿开 M2**

## 2026-07-12 · 第 32 次 soft craft · 手测对照清单 live 投影（soft · M1 仍 open）

- [x] 第 32 次：`projectM1HandtestChecklist` + UI + 单测 + dual 复测 + rebuild + Electron 重启
- [ ] M1 退出：外网真实网关 UI 手测（`14-external-gateway-handtest.md` 实填）
- [ ] M1 退出：dogfood ≥3 天真实日记
- [ ] **勿**启动 M2
- 固定大白话：第 32 次
- 下一优先：外网网关 UI 手测 / dogfood 日记；**勿关 M1、勿开 M2**

## 2026-07-12 · 第 31 次 soft craft · M1 退出证据进度条（soft · M1 仍 open）

- [x] 第 31 次：退出证据 progress 投影 + IPC + UI + 单测 + dual 复测 + rebuild
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿**启动 M2
- 固定大白话：第 31 次
- 下一优先：外网网关 UI 手测 / dogfood 日记；**勿关 M1、勿开 M2**

## 2026-07-12 · 第 30 次 soft craft · 会话芯片跳转面板（soft · M1 仍 open）

- [x] 第 30 次：会话就绪芯片 jumpTarget + 点击闪跳左侧/轨迹 + 单测 + dual 复测 + rebuild
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿**启动 M2
- 固定大白话：第 30 次
- 下一优先：外网网关 UI 手测 / dogfood 日记；**勿关 M1、勿开 M2**

## 2026-07-12 · 第 29 次 soft craft · 会话就绪 Memory 芯片 + dual 复测（soft · M1 仍 open）

- [x] 第 27：projectApprovalGateReadiness
- [x] 第 28：projectMemoryDiagnosticsReadiness
- [x] 第 29：M1 会话条 Memory 芯片 + dual 4/4
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿**启动 M2
- 下一优先：**硬门槛**外网手测 / dogfood；软 craft 侧主要面板就绪投影已齐

## 2026-07-12 · 第 28 次 soft craft · Memory/Diagnostics 就绪纯投影（soft · M1 仍 open）

- [x] 第 27 次：projectApprovalGateReadiness
- [x] 第 28 次：projectMemoryDiagnosticsReadiness + 单测 + rebuild
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿**启动 M2
- 下一优先：外网手测 / dogfood；或 dual 复测 / 会话级 readiness 汇总；**勿关 M1**

## 2026-07-12 · 第 27 次 soft craft · 批准中心闸门就绪纯投影（soft · M1 仍 open）

- [x] 第 27 次：projectApprovalGateReadiness + UI 接线 + 单测 + rebuild + Electron 重启
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿**启动 M2
- 固定大白话：第 27 次
- 下一优先：外网网关 UI 手测 / dogfood；或 MemoryDiagnostics 纯投影；**勿关 M1、勿开 M2**

## 2026-07-12 · 第 26 次 soft craft · Agent 能力就绪纯投影（soft · M1 仍 open）

- [x] 第 26 次：projectAgentCapabilityReadiness + UI 接线 + 单测 + rebuild + Electron 重启
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿**启动 M2
- 固定大白话：第 26 次
- 下一优先：外网网关 UI 手测 / dogfood 日记；**勿关 M1、勿开 M2**

## 2026-07-12 · 第 25 次 soft craft · Compose 发送就绪纯投影（soft · M1 仍 open）

- [x] 第 25 次：projectComposeSendReadiness + UI 接线 + 单测 + rebuild
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿**启动 M2
- 固定大白话：第 25 次
- 下一优先：外网网关 UI 手测 / dogfood 日记；**勿关 M1、勿开 M2**

## 2026-07-12 · 第 24 次 soft craft · Providers 多模型就绪纯投影 + dual 复测（soft · M1 仍 open）

- [x] 第 24 次：projectProvidersReadiness + UI 接线 + 单测 + dual 4/4 + rebuild
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿**启动 M2
- 固定大白话：第 24 次
- 下一优先：外网网关 UI 手测 / dogfood 日记；**勿关 M1、勿开 M2**

## 2026-07-12 · 第 23 次 soft craft · WorkspaceNav 工作区导航就绪投影（soft · M1 仍 open）

- [x] 第 23 次：WorkspaceNav §15.2 projector + 筛选/嵌套可观测 + 单测 + rebuild
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿**启动 M2
- 固定大白话：第 23 次
- 下一优先：外网网关 UI 手测 / dogfood 日记；**勿关 M1、勿开 M2**

## 2026-07-12 · 第 22 次 soft craft · AppShell 工作区布局就绪条（soft · M1 仍 open）

- [x] 第 22 次：AppShell §15.2/§15.3 布局就绪条 + projector + 单测 + rebuild
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿**启动 M2
- 固定大白话：第 22 次
- 下一优先：外网网关 UI 手测 / dogfood 日记；**勿关 M1、勿开 M2**

## 2026-07-12 · 第 19 次 soft craft · 对话流 empty/stream 统一可观测（soft · M1 仍 open）

## 2026-07-12 · 第 21 次 soft craft · 参与模式就绪条 + dual 复测（soft · M1 仍 open）

- soft craft：ModeSwitch §5.2 M1/M2 门控可观测 + dual 4/4
- 固定大白话：第 21 次
- 下一优先：外网网关 UI 手测 / dogfood 日记；**勿关 M1、勿开 M2**

## 2026-07-12 · 第 20 次 soft craft · Manifest 可检查就绪条（soft · M1 仍 open）

- soft craft：ManifestPanel readiness 与 Trace/Continuum 视觉对齐；projector + 22 测
- 固定大白话：第 20 次
- 下一优先：外网网关 UI 手测 / dogfood 日记；**勿关 M1、勿开 M2**

- soft craft：对话列 stream/empty 统一可观测
- 固定大白话：第 19 次
- 下一优先：外网网关 UI 手测 / dogfood；**勿关 M1、勿开 M2**

## 2026-07-12 · 第 18 次 soft craft · ContinuumRail 连续体就绪条（soft · M1 仍 open）

- soft craft：§15.3 / §0.1 连续体可观测条 + 真空态 + scaffold 标明
- 固定大白话：第 18 次
- 下一优先：外网网关 UI 手测 / dogfood；**勿关 M1、勿开 M2**

## 2026-07-12 · 第 17 次 soft craft · TraceList 运行轨迹就绪条（soft · M1 仍 open）

- soft craft：§6.2 / §15.2 运行轨迹可观测条 + 真空态
- 固定大白话：第 17 次
- 下一优先：外网网关 UI 手测 / dogfood 日记；或 Continuum 就绪条；**勿关 M1、勿开 M2**

## 2026-07-12 · 任务头 M1 会话就绪条（soft · M1 仍 open）

## 2026-07-12 · 第 16 次 soft craft · Compose 发送就绪条 + dual 网关复测

- [x] 第 16 次：Compose 发送就绪条 + dual 网关复测
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿**启动 M2

## 2026-07-12 · 第 15 次 soft craft · 会话就绪条接入 Agent/审批

- [x] 第 14 次：Agent 能力就绪条
- [x] 第 15 次：任务头会话就绪接入 Agent/审批
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿**启动 M2

## 2026-07-12 · 第 14 次 soft craft · Agent 能力就绪条

- [x] 第 14 次 soft craft：Agent 能力就绪条（UI + CSS + 单测 + rebuild）
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天真实日记
- [ ] **不**启动 M2，直至 M1 退出证据或用户明确决策

- soft craft：全局会话就绪条（Runtime/任务/≥2 Provider/≥3 模型/Manifest/轨迹主题）
- 下一优先：外网网关 UI 手测 / dogfood 日记；**勿关 M1、勿开 M2**

## 2026-07-12 · Providers 多模型就绪条（soft · M1 仍 open）

- soft craft：ProvidersPanel M1 readiness 可观测（≥2/≥3 + 密钥遮罩）
- 下一优先：外网网关 UI 手测 / dogfood 日记；**勿关 M1、勿开 M2**

## 2026-07-12 · Compose/消息中文可观测（soft · M1 仍 open）

- soft craft：Compose 占位/aria + MessageBubble 流式中文 + desktop meta
- 下一优先：外网网关 UI 手测 / dogfood 日记；**勿关 M1、勿开 M2**

## 2026-07-12 · Manifest 解析阶梯（soft · M1 仍 open）

- soft craft：ManifestPanel 解析阶梯对齐 §5.3；凭证中文；Fallback 链位可观测
- 自测：ManifestPanel 15/15；desktop rebuild + Electron 重启
- 下一优先：外网网关 UI 手测 / dogfood 日记；可选 soft：Providers/凭证遮罩与空状态；**勿关 M1、勿开 M2**

## 2026-07-12 · Agent 绑定优先级 UI（soft · M1 仍 open）

- soft craft：AgentBindingPanel §5.3 优先级阶梯可观测
- 下一优先：外网网关 UI 手测 / dogfood 日记；**勿关 M1、勿开 M2**

## 2026-07-12 · Continuum/Mode 中文 + Compose chips 收尾（soft · M1 仍 open）

- soft craft：Compose chips / Trace 中文 / Continuum+Mode 中文 / dogfood 脚手架
- 下一优先：外网网关 UI 手测 / 填 dogfood 日记；**勿关 M1、勿开 M2**

## 2026-07-12 · Provider 协议持久化 + 发现 Diagnostics（soft · M1 仍 open）

- soft craft 已落地：provider.protocol 持久化、发现可观测、失败进 Diagnostics（scrub）
- 下一优先：外网网关 UI 手测 / dogfood；**勿关 M1、勿开 M2**

- [x] MCP 进程策略探测骨架（mcp.policy.probe + FakeMcpWorker + UI，2026-07-12 soft；**不自动关 M1**）

# Implementation Plan — SYNC-THINK

## 2026-07-12 · AppShell 运行轨迹中文 + 工作区结构条（soft · M1 仍 open）

- soft craft：§15.2 壳层中文可观测 + 文件夹/任务 IA 条
- 固定大白话：第 13 次
- 下一优先：外网网关 UI 手测 / dogfood；**勿关 M1、勿开 M2**

## 2026-07-12 · 批准中心 + Memory 闸门就绪条（soft · M1 仍 open）

- soft craft：§13 / §10.4 可观测就绪条 + 空态卡片已落地
- 固定大白话：`13-plain-selftest-log.md` 第 12 次
- 下一优先：外网网关 UI 手测 / dogfood 日记；**勿关 M1、勿开 M2**

## 2026-07-12 · MCP 刷新目录可观测 + 自测闭环（soft · M1 仍 open）

- 固定大白话自测文档：`docs/development/13-plain-selftest-log.md`
- refresh → allowlist → peek tool-schema 已自动化覆盖
- 下一优先：用户本机 UI 手测 / dogfood / 外网网关；**勿关 M1、勿开 M2**

## 2026-07-12 · MCP tools/list 刷新目录切片（soft craft 已落地 · M1 仍 open）

- 代码与自动化自测已 GREEN：`mcp.tools.refresh` + UI「刷新工具目录」
- M1 退出证据（外网手测 / dogfood）仍 open；**勿关闭 M1**；**勿启动 M2**
- 下一优先：本机 UI 手测 mini-mcp 空目录→刷新；或外网网关；或 dogfood 模板

## 2026-07-12 · MCP JSON-RPC 真工具调用切片（进行中→代码 GREEN）

- 代码与自动化自测已 GREEN；M1 退出证据（外网手测 / dogfood）仍 open
- 下一优先：用户本机 UI 手测 mini-mcp；或外网网关；勿关闭 M1

### 进度备注 · 2026-07-12 · Skill 批后自动白名单（soft，M1 仍 open）

- §9.1 导入不白名单 + §9.3 升级人批后写入默认 Agent allowlist soft craft 已落地
- 真 spawn / 外网手测 / dogfood 仍 open

### 进度备注 · 2026-07-12 · MCP 工具请求入队审批（soft，M1 仍 open）

- §9.3 敏感 MCP 调用 → §13 Approval Center 自动 enqueue soft craft 已落地（mcp.tool.request）
- 真 spawn / Skill 批后自动白名单 / 外网手测 / dogfood 仍 open

### 进度备注 · 2026-07-12 · Memory→审批桥接（soft，M1 仍 open）

- §10.4 pending Memory 变更 → §13 Approval Center 自动 enqueue；双向 decide soft craft 已落地
- MCP 入队 / 外网手测 / dogfood / 真 spawn 仍 open

### 进度备注 · 2026-07-12 · Skill 升级入队审批（soft，M1 仍 open）

- §9.3 requiresReapproval → §13 Approval Center 自动 enqueue soft craft 已落地
- 批准后自动白名单 / MCP 入队 / 外网手测仍 open

### 进度备注 · 2026-07-12 · 审批中心骨架（soft，M1 仍 open）

- §13 / §15.1-8：policy + store + runtime 命令 + Approval Approval Center soft craft 已落地
- 演示入队可观测；尚未自动挂 skill/MCP 闸；外网手测 / dogfood 仍 open

### 进度备注 · 2026-07-12 · Skill 升级权限 diff（soft，M1 仍 open）

- §9.3 同名 Skill 升级新增 tools/scripts → permissionDiff.requiresReapproval；UI 可观测
- 导入仍不自动白名单；完整 Approval Center 后续

### 进度备注 · 2026-07-12 · MCP 策略探测（soft，M1 仍 open）

- §9.3 进程策略骨架已 soft 落地：`mcp.policy.probe` + FakeMcpWorker + UI 可观测
- 真 spawn / 外网手测 / dogfood 仍为 M1 退出门槛

> **2026-07-12**：soft craft MCP 授权骨架（§9.3）已落地（register/list + allowlist + tool-schema peek + Manifest 入包）。M1 仍 open。
> **2026-07-12**：soft craft Skill 导入 + Agent 白名单（§9）已落地（import/list + allowlist + Manifest peek）。M1 仍 open。
> **2026-07-12**：soft craft `context.packet.peek` 已落地（只读预览 + Manifest 按钮 + 回滚证据联动）。M1 仍 open。

> Date: 2026-07-11  
> Status: **Confirmed 2026-07-11** — implementation authorized for M0  
> Depends on: approved product design + confirmed docs + recommended tech spikes (TD-004–014)  
> Spike recommendations and this plan confirmed. M0 implementation authorized.
> M0 exit review reopened 2026-07-11 after independent security/recovery review. M1 has not been started.

### 进度备注 · 2026-07-12 · MCP 真 spawn 探测骨架（soft，M1 仍 open）

- §9.3/§14 进程宿主骨架已 soft 落地：`mcp.spawn.probe` + LocalStdioMcpWorker + UI 可观测
- 完整 JSON-RPC 工具执行 / 外网手测 / dogfood 仍为 M1 退出门禁

## 0. Planning principles

1. **Vertical slices over horizontal layers.** Each milestone ends with a demonstrable user-visible or recovery-visible outcome.
2. **Runtime truth first.** Conversation, permissions, checkpoints, and adapters are test-first.
3. **UI is Continuum Bench, not V3 reskin.** IA locked; craft award-level visuals as soon as the shell exists.
4. **One developer velocity.** Prefer modular monolith packages; no microservices.
5. **Closed-beta acceptance (§23.2) is the north star.** Later features stay later.
6. Estimate assumes substantial daily availability; calendar bands match product design (~20–28 weeks to closed beta).

## 1. Repository shape (initialize in Phase 0)

```text
D:\projects\SYNC-THINK\
  apps/
    desktop/                 Electron main + preload + React renderer
    runtime/                 Independent Node Agent Runtime process
  packages/
    protocol/                Shared IPC/pipe types, error codes, versioning
    shared/                  Shared domain types (Task, Run, Step, ...)
    storage/                 SQLite + Drizzle schema + migrations + FTS
    secure-store/            CredentialRef + safeStorage envelope
    core/                    Orchestration, context engine, policies, XState machines
    adapters/                OpenAI-compatible + Anthropic-compatible
    workers/                 Worker interfaces + process hosts
    ui-kit/                  Continuum components + tokens
    test-fixtures/           Provider/skill/ccswitch fixtures
  docs/                      Already exists
  pnpm-workspace.yaml
  turbo.json / package.json
  AI_DEVELOPMENT_RULES.md
```

Tooling (recommended with spikes):

- pnpm workspaces + Turborepo
- TypeScript strict
- Vitest
- electron-builder (Phase 3 packaging focus)
- ESLint + Prettier (light config)

## 2. Milestone map

| Milestone | Name                            | Calendar  | Exit criteria (demo)                                                              |
| --------- | ------------------------------- | --------- | --------------------------------------------------------------------------------- |
| M0        | Foundations & spikes            | 2–3 weeks | Fake provider stream + checkpoint restart; pipe auth; tokenized shell             |
| M1        | Multi-model conversation Alpha  | 6–8 weeks | 2 providers / 3 models one task; Manifest inspectable; themes + collapsible trace |
| M2        | Multi-agent orchestration Alpha | 6–8 weeks | Plan approve → parallel steps → reviewer rework bound → artifacts versioned       |
| M3        | Windows closed beta             | 6–9 weeks | Workers + image + CC import + installer/update + 5–20 users journey               |

---

## 3. M0 — Foundations & technical validation (Phase 0)

**Goal:** Prove process boundaries, persistence, recovery, and design system skeleton.

### M0.1 Engineering skeleton (days 1–4)

- Init git (when you ask), pnpm workspace, TS project references
- `apps/desktop` boots empty Continuum shell (light/dark tokens live)
- `apps/runtime` boots as separate process
- Healthcheck over named pipe
- CI-less local scripts: `dev:desktop`, `dev:runtime`, `test`, `typecheck`

### M0.2 Storage & security spine (days 3–7)

- Drizzle schema v1: Workspace, Task, Thread, Message, Event, Checkpoint, Provider stubs, CredentialRef
- Migration + backup-before-migrate hook
- secure-store write/read/delete roundtrip (no plaintext in DB dump test)
- FTS smoke on messages

### M0.3 Protocol & recovery (days 5–10)

- Handshake: version, installId, auth token
- Command: `task.appendMessage` / `runtime.subscribeEvents`
- Fake provider adapter streams tokens
- Kill UI → Runtime continues
- Kill Runtime → restart reconstructs from checkpoint without duplicating completed side effects (idempotency demo)

### M0.4 Design system spike (parallel, days 4–12)

- Generate CSS variables from `15-frontend-design-tokens.json`
- Build signature components: AppShell, ContinuumRail, MessageBubble, TraceList, Compose, ModeSwitch
- Motion prototypes: trace collapse breath, agent handoff ribbon (reduced-motion static fallback)
- Pass design review checklist on shell mock data

### M0.5 Worker & UIA interface only

- `DesktopWorker` / `BrowserWorker` interfaces + null/fake implementations
- Playwright install smoke in worker host (optional if time)

### M0 exit checklist

- [x] UI restart does not kill Runtime job
- [x] Runtime restart restores demo Run
- [x] DB has no plaintext API key in tests
- [x] Pipe rejects foreign client without token
- [x] Continuum shell looks intentional in light and dark (not V3 HTML paste)
- [x] TD-004–014 either confirmed or explicitly deferred with date

Pre-review verification (2026-07-11): `pnpm test --force`, `pnpm typecheck --force`, and `pnpm build --force` passed with cache bypass. Closure verification (2026-07-12): reload fix landed; real lifecycle acceptance and root force gates passed; M0 closed.

### M0 independent-review closure status (2026-07-11)

- [x] Two-way authenticated pipe with fresh nonce replay protection.
- [x] Bounded paged replay with fixed high-watermark, categories, and live handoff.
- [x] Atomic `message.appended + run.started` intent and final checkpoint commit.
- [x] Electron navigation, redirect, window-open, IPC sender, packaged-file, and secret boundaries.
- [x] Renderer snapshot/live sequence merge, deterministic M0 projection, hydration gate, and classified initial retry.
- [x] Desktop focused tests, desktop full tests (39), typecheck, build, and independent spec/quality reviews.
- [x] Latest Runtime build emits the two-stage authentication server; raw real-process challenge/proofs accepted.
- [x] Diagnose and fix the real Electron Renderer `page.reload()` timeout under the latest build.
- [x] Re-run latest-build UI restart and Runtime restart lifecycle acceptance.
- [x] Run final independent whole-change review of the reload navigation fix.
- [x] Re-run root `pnpm test --force`, `pnpm typecheck --force`, and `pnpm build --force`.
- [x] Close M0 documentation after all preceding items passed (2026-07-12).

M0 closed 2026-07-12. M1 started 2026-07-12 (user requested continuation of incomplete plan).

### M1 progress (2026-07-12)

- [x] Skill 升级 → 审批中心自动入队（skill.import reapprovalRequest，2026-07-12 soft；**不自动关 M1**）
- [x] 审批中心骨架（approval.list/evaluate/enqueue/decide + UI，2026-07-12 soft；**不自动关 M1**）
- [x] Skill 升级权限 diff（diffSkillPermissions + skill.import.permissionDiff，2026-07-12 soft；**不自动关 M1**）
- [x] Skill → Context Packet body injection（skill-definition，2026-07-12 soft；**不自动关 M1**）

- [x] Workspace path allowlist + SqliteWorkspaceStore (create/list workspace; create/list/open/search tasks; last-open; nested tasks)
- [x] Protocol + Runtime commands for workspace/task IA
- [x] Desktop folder/task tree UI + bridge
- [x] Conversation full history / streaming UX
- [x] Providers / Credentials（注册 + SecureStore + Desktop 面板 + §5.4 组/pin + 跨 provider 取钥；外网 UI 手测 18/18）
- [x] Agents / Context / Memory / Diagnostics（绑定+fallback+Manifest UI+Memory/Diagnostics 面板；workflow 图/多 Agent 属 M2）
- [x] M1 退出标准证据矩阵（2026-07-12 soft 基线；2026-07-15 由外网 18/18 与恢复/安全证据升级为直接通过；**不自动关 M1**）
- [x] 受保护上下文预算 + 键盘可观测 soft craft（2026-07-12 → `12-test-log.md`；**不自动关 M1**）
- [x] 退出标准 6 加强：多轮 conversation-restore + Desktop 冷启动投影 + 空态可观测（2026-07-12）

**Deliverable demo script:** create folder workspace → create task → stream fake answer → open Manifest stub → collapse trace → restart app → see history + incomplete run restored.

---

## 4. M1 — Multi-model conversation Alpha (Phase 1)

**Goal:** Daily-driver single-agent multi-model chat with real providers and real context continuity.

### M1 workstreams

| Stream       | Features                                                                                                                            | Tests first                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Workspace IA | Add folder, nested tasks, search, last-open memory                                                                                  | path allowlist, workspace CRUD                     |
| Conversation | Full history, user-right/agent-left, single-column option, streaming UX                                                             | message ordering, cancel stream                    |
| Providers    | Manual baseURL+key+protocol, model list/discovery, capability probe suggestions                                                     | adapter contracts TD-010                           |
| Credentials  | Groups, pin exact key, mask UI, secure store                                                                                        | no secret in logs/export                           |
| Agents       | Create agent, persistent model binding, run override, fallback chain, pause-on-failure                                              | precedence unit tests                              |
| Context      | Context Packet builder, Manifest UI, **protected goals/decisions (selectContextSources §20.9)**, cross-task explicit refs (partial) | compilation unit tests — protected selection GREEN |
| Memory       | MemoryChange proposals at milestones (approve/reject)                                                                               | versioning/rollback                                |
| UI craft     | Award-level main workspace polish, empty states, **keyboard shortcuts (Ctrl+Enter/Esc/Ctrl+\\)**, a11y focus pass (partial)         | visual checklist + unit tests GREEN                |
| Diagnostics  | Structured provider errors, scrubbed raw evidence                                                                                   | scrubber tests                                     |

### M1 non-goals

Multi-agent auto execution, desktop UIA, CC Switch full import, installer, image pipeline productionization. CC Switch full import was later pulled forward by explicit user request; the other items remained outside M1.

### M1 exit criteria (maps to partial §23.2)

1. One task uses ≥2 providers and ≥3 models without restating context.
2. Binding precedence holds (run > workflow > agent default > fallback).
3. Every model call has inspectable Manifest.
4. Complete light/dark + collapsible trace + folder-task IA.
5. No plaintext keys in DB/logs/diagnostics/prompts.
6. App restart restores conversation and in-flight stream state safely.

**Evidence matrix soft package (2026-07-12, historical baseline):** criteria 2–5 were green via tests; 1 was soft-green via local dual-HTTP/dual-protocol; 6 was strengthened with multi-turn recovery. Its then-open external hand-test was completed at 18/18 and superseded by the 2026-07-15 completion audit below.

**Internal dogfood gate:** one real planning-chat day is required for M1 closure. The user explicitly changed this from three days to one on 2026-07-15; automation and scaffolds still do not count.

**2026-07-15 completion audit:** M1 exit criteria 1-6 have direct implementation, automated, external UI, recovery, visual, and security evidence. The existing 2026-07-12 real-use diary satisfies the revised one-day gate at **1/1**. M1 is complete; M2 is also complete.

---

## 5. M2 — Multi-agent orchestration Alpha (Phase 2)

**Goal:** Progressive collaboration inside the same task.

### M2 workstreams

| Stream       | Features                                                            | Tests first          |
| ------------ | ------------------------------------------------------------------- | -------------------- |
| Modes        | Conversation / Collaboration / Automatic switches                   | mode policy          |
| Plans        | Plan draft in chat, edit, approve, immutable plan revisions         | state machine        |
| Graph        | DAG steps, deps, parallel snapshots, pause/resume/cancel            | scheduler + recovery |
| Gates        | Reviewer agent, acceptance criteria, bounded rework                 | rework limit         |
| Skills       | SKILL.md import subset, scopes, allowlists                          | fixtures TD-008      |
| MCP          | Server connect, tool authz matrix, schema injection only if allowed | authz tests          |
| Approvals    | Request/Delegate/Full/Custom; human-only list absolute              | bypass attempts fail |
| Artifacts    | versions, compare, merge step, no LWW                               | merge conflict pause |
| Agent editor | full AgentVersion fields, history immutability                      | version pin on Run   |
| UI           | Execution graph view, approval center v1, artifact view v1          | design checklist     |

### M2 exit demo

Planner proposes plan → you edit/approve → design + image-stub + reviewer steps run → rejection causes one rework → limit pause → artifacts versioned → full trace audit.

---

## 6. M3 — Windows closed beta (Phase 3)

**Goal:** Invited users can complete the §6 end-to-end journey safely.

### M3 workstreams

| Stream    | Features                                                               |
| --------- | ---------------------------------------------------------------------- |
| Workers   | File, terminal, git, Playwright browser, Windows UIA worker            |
| Media     | Image generation pipeline + vision review + artifact versions          |
| Import    | CC Switch versioned importers + manual gateways polish                 |
| Hardening | Chaos tests: kill UI/runtime/worker/network; path traversal; injection |
| Packaging | Signed installer, updater feed, crash privacy, diagnostics export      |
| Polish    | Motion/a11y/high-DPI, performance on long threads, onboarding          |
| Ops       | Known limitations doc, invite runbook, feedback channel                |

### M3 exit criteria

All 12 items in product design §23.2 / requirements §8.

---

## 7. Parallel tracks (entire project)

```text
Track R — Runtime correctness (always highest priority)
Track U — Continuum UI craft (starts M0, continuous)
Track A — Adapters & fixtures (starts M0, expands M1)
Track S — Security & permissions (every milestone)
Track P — Packaging & diagnostics (light in M0/M1, heavy M3)
```

Never let Track U wait until “feature complete.” Shell craft begins in M0.

## 8. Week-by-week sketch (indicative)

### Phase 0 (weeks 1–3)

| Week | Focus                                                                               |
| ---- | ----------------------------------------------------------------------------------- |
| 1    | Monorepo, pipe hello, SQLite schema, secure-store spike, tokenized AppShell         |
| 2    | Fake provider stream, events/checkpoints, UI kill test, Continuum components        |
| 3    | Recovery polish, adapter fixture harness, design review, M0 demo + freeze decisions |

### Phase 1 (weeks 4–11 approx.)

| Band  | Focus                                                           |
| ----- | --------------------------------------------------------------- |
| 4–5   | Workspaces/tasks/chat history persistence + streaming UX        |
| 6–7   | Providers/credentials/probes + OpenAI & Anthropic live adapters |
| 8–9   | Agents binding/fallback + Context Packet/Manifest               |
| 10–11 | Memory proposals, themes/trace polish, dogfood, Alpha cut       |

### Phase 2 (weeks 12–19 approx.)

| Band  | Focus                                           |
| ----- | ----------------------------------------------- |
| 12–13 | Modes + plan approval state machine             |
| 14–15 | DAG scheduler parallel snapshots + pause/resume |
| 16–17 | Skills/MCP/approvals human-only                 |
| 18–19 | Artifacts/reviewer/rework + graph UI Alpha cut  |

### Phase 3 (weeks 20–28 approx.)

| Band  | Focus                                               |
| ----- | --------------------------------------------------- |
| 20–22 | Workers (file/terminal/git/browser)                 |
| 23–24 | UIA worker + image pipeline                         |
| 25–26 | CC import, diagnostics, installer/signature/updater |
| 27–28 | a11y/perf/bug bash, invite beta, fix high severity  |

## 9. First 10 implementation tasks after confirmation

1. Init monorepo tooling and package boundaries.
2. Implement protocol handshake + event subscription.
3. Implement storage schema v1 + migrations.
4. Implement secure-store envelope tests.
5. Fake provider + streaming message path.
6. Checkpoint/restore demo.
7. Continuum AppShell with real tokens (light/dark).
8. Message list + compose wired to Runtime.
9. Collapsible trace wired to events.
10. Provider adapter interface + first contract fixtures.

## 10. Risk register (execution)

| Risk                       | Mitigation in plan                                         |
| -------------------------- | ---------------------------------------------------------- |
| Scope explosion            | Hard non-goals per milestone; Later list untouched         |
| UI becomes generic chat    | TD-003 + design checklist every milestone exit             |
| Gateway chaos              | TD-010 fixtures before supporting each quirk               |
| Recovery bugs              | Chaos tests from M0 onward                                 |
| Native module pain         | Isolate in storage/secure-store; document rebuild          |
| Single-dev bottleneck      | Vertical slices; fake workers until Phase 3                |
| Design time vs engine time | Parallel Track U from week 1; shell before feature density |

## 11. Confirmation gate

Please confirm:

1. **Spike recommendations TD-004–014** (all or exceptions).
2. **This implementation plan** (milestone exits + repo shape).
3. Whether to **initialize git + monorepo skeleton next** after confirmation.

Until then: no business feature coding; docs-only adjustments allowed.

## 12. Confirmation

```text
确认人：用户
确认时间：2026-07-11
确认语：全部接受推荐，计划确认
```

## 13. Change log

| Date       | Change                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-11 | Initial plan drafted with spike recommendations (option C)                                                                |
| 2026-07-11 | User confirmed all spike recommendations and this plan                                                                    |
| 2026-07-12 | M1 soft craft: §10.1 explicit cross-task refs + Manifest/Nav observability (M1 still open; external UI hand-test pending) |
| 2026-07-12 | M1 soft craft: project-memory into Context Packet/Manifest evidence (§10.1 L2 / §10.3; M1 still open)                     |
| 2026-07-12 | M1 soft craft: Memory §10.4 rollback (version-preserving + UI history; M1 still open)                                     |
| 2026-07-12 | M1 soft craft: single-column conversation option (Locked IA §28; M1 still open)                                           |
| 2026-07-12 | M1 soft craft: UI preferences theme/trace/layout (§15.2; M1 still open)                                                   |

### M1 soft craft note (2026-07-12) — context.packet.amend

- [x] Manifest amend §10.3: force-exclude non-protected sources (thread-scoped)
- [x] Protected kinds refuse (task-goal / acceptance / decision / constraint)
- [x] peek + prepareRunBinding + fallback apply amendments
- [x] UI exclude / clear + desktop IPC
- M1 remains open (external gateway UI hand-test + dogfood)

### M1 soft craft note (2026-07-12) — Manifest versions §10.3

- [x] Agent version number + Skill allowlist ids + policyId on peek / packet.built
- [x] Manifest UI proof rows (agent / skills / policy)
- [x] Runtime tsc unblock (amend payload types)
- M1 remains open (external gateway UI hand-test + dogfood)

### M1 soft craft note (2026-07-12) — single-column conversation (§28)

- [x] MessageBubble layout prop + ui-kit single-column CSS
- [x] Desktop header toggle + localStorage persistence
- [x] ui-kit 54 / desktop 64 tests GREEN
- M1 remains open (external gateway UI hand-test + dogfood)

### M1 soft craft note (2026-07-12) — UI preferences (§15.2)

- [x] Persist theme + trace collapse + conversation layout (localStorage)
- [x] AppShell controlled collapse remembers workspace preference
- [x] ui-kit 55 / desktop 69 tests GREEN
- M1 remains open (external gateway UI hand-test + dogfood)

- [x] 中心 M1 验证区默认折叠为单行摘要；原硬门槛/下一步/外网/退出路径按需展开
- [x] 隐藏产品首屏重复 readiness，保留投影逻辑与测试
- [x] 持久 Runtime 所有 `appendEvent` 经 SQLite 分配统一序列
- [x] replay 真实探针严格单调；Desktop 手动重连恢复完整状态
- [x] 同毫秒任务以 SQLite `rowid` 稳定插入顺序
- [x] root test 20/20 · 707 tests；typecheck 20/20；build 11/11；quick soft GREEN
- [ ] M1 硬门槛：`14-external-gateway-handtest.md` 外网 UI 手测 0/18
- [ ] M1 硬门槛：dogfood ≥3 真实天（当前 0/3）
- [ ] **勿**启动 M2 / **勿**仅靠 soft 关 M1
