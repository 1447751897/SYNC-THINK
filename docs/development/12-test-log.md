## 2026-07-16 · 对话 Agent 身份与顶部减负 TDD

- 用户反馈：顶部 `决策 / 记忆 / 上下文` 无法理解；M1 验证在里程碑关闭后不再需要；助手回复需要参考 Multica 暴露 Agent 头像与身份。
- 规格：新增 `docs/superpowers/specs/2026-07-15-conversation-agent-identity-design.md`，明确新需求覆盖 7 月 12 日“隐藏 Agent 名称”的旧决定，但不恢复模型 UUID / Run ID 等执行噪声。
- RED：消息身份、Context plain label、M1 产品表面隐藏、精确 AgentVersion 投影和 Desktop 组合共 **5 项失败**。
- GREEN 聚焦：UI Kit `MessageBubble + ContinuumRail` **17/17**；Desktop `event-history + conversation-agent-identity` **23/23**。
- 全量：UI Kit **19 files / 215 tests PASS**；Desktop **46 files / 323 tests PASS**。
- 全仓：`turbo run test --force` **20/20 tasks，0 cache**；typecheck **20/20**；build **11/11**。
- 实窗：1440×900 深色 Electron 中，顶部显示 `工作区 Live Smoke WS / 任务 Skill body packet smoke / 对话 v40`；`M1 验证` 不可见；回复左侧显示圆形 `Conversation` 头像和名称，无文本重叠。
- 交互：点击消息头像后打开 `Conversation v12` 智能体中心，运行时、Skills、Fallback 与版本页签保持可用；stderr **0 bytes**。

## 2026-07-15 · dogfood 一天规则 TDD 与关闭审计

- 用户规则：M1 dogfood 从 3 个真实日期改为 **1 个真实使用日**；现有 2026-07-12 有效记录满足 **1/1**。
- RED：`m1-exit-evidence` 与 `m1-handtest-checklist` 共 **5 项失败**，证明旧默认仍为 3、状态仍停在 awaiting-dogfood / 等待人工关闭。
- GREEN：新增单一门槛真源并更新当前投影；Desktop **45 files / 318 tests PASS**，UI Kit **19 files / 213 tests PASS**。
- 完成审计 RED/GREEN：dogfood 1/1、外网 17/18 时旧投影会误报 `M1 已完成`；新增回归后改为“仍缺外网手测”，聚焦测试 **12/12 PASS**。
- 安全边界：证据辅助模块继续输出 `claimsM1Closed=false`，表示它们不能自行篡改里程碑；M1 的关闭来自用户明确决策 + 18/18 + 1/1 真实证据。
- 全仓：强制 test **20/20 tasks，0 cache**；typecheck **20/20**；build **11/11**。
- 自检：M1 full（dual HTTP + dual protocol + Desktop pack）**GREEN**，明确显示外网 18/18、dogfood 1/1、M1 已完成；M2 **5/5 PASS**，退出摘要仍为 ArtifactVersion 2、ReviewEvidence 2、limit event 1、duplicate terminal 0、secret-like evidence false、restart stable true。
- 实窗：Electron 最终构建在 1425×894 深色窗口显示“外网 18/18 · dogfood 1/1 · M1 已完成”；无截断/重叠，stderr 0 bytes，Runtime/Electron 进程存活。
- 结论：M1 / M2 与总方案均已完成，无剩余门槛。

## 2026-07-15 · Goal 连续第三次阻塞审计（历史 · 已由一天规则解除）

- 当前时间：`2026-07-15 22:56 +08:00`。
- dogfood 目录仍只有 `2026-07-12.md`（有效 1/3）与 `2026-07-13.md`（进行中、不计数）；三个文件最后修改时间均停留在 2026-07-13。
- 外网手测仍为 **18/18**；M2 Task 1-9、两份 `docs/superpowers/plans`、全仓强制测试、M1 full 与 M2 selftest 均已完成。
- 没有剩余代码、自动化或同日复测可以合法替代另外两个不同真实日期。
- 结论：相同外部日历阻塞已连续出现三次；M1 保持 open，Goal 标记为 blocked，等待真实使用日期发生后再恢复。

## 2026-07-15 · Goal 续跑最终强证据

- 环境：Node `v20.20.2`，pnpm `10.28.2`。
- `pnpm exec turbo run test --force --output-logs=errors-only`：**20/20 tasks PASS**，**0 cache**，20.773s。
- `pnpm selftest:m1-soft`（full，含 dual）：dual HTTP **GREEN**、dual protocol **GREEN**、Desktop M1 pack **GREEN**；`claimsM1Closed=false`，M1 仍 open。
- `pnpm selftest:m2`：**5/5 PASS**。
  - core：8 files / **69 tests**。
  - storage：4 files / **82 tests**。
  - Runtime exit demo：1 file / **17 tests**。
  - UI Kit：7 files / **71 tests**。
  - Desktop：2 files / **16 tests**。
- Exit summary：`design → image → reviewer-0 → rework-1 → reviewer-1`；ArtifactVersion **2**；ReviewEvidence **2**；limit event **1**；duplicate terminal **0**；secret-like evidence `false`；restart stable `true`。
- 进程复核：真实 Runtime 与 Electron 主进程、渲染进程在复验后仍存活。
- 计划复核：`docs/superpowers/plans` 中无未勾选步骤；M2 Task 1-9 已完成。
- 边界：本轮没有新增 dogfood 日期。外网 **18/18**，dogfood **1/3**；只剩另外两个不同真实日期，因此不关闭 M1 或总 Goal。

## 2026-07-15 · 里程碑状态投影回归

- RED：Desktop 当前状态仍输出“当前禁用 / 勿启动 M2 / CC Switch 不在范围”，且手测文档 `18/18` 后仍报告外网待证；UI Kit 四个就绪面板仍声称外网未完成。
- GREEN：`projectM1HandtestChecklist` 在 `18/18` 时进入 `awaiting-dogfood`、`externalPending=0`，并显示 dogfood `1/3`、还差 2 个真实日期；`projectM1CurrentMilestoneCopy` 明确 M2 与 CC Switch 已完成。
- Desktop 定向：5 files / **48 tests PASS**。
- UI Kit 定向：4 files / **75 tests PASS**。
- 追加实窗 RED：外网聚焦、证据包 preview、差异 paste、soft 快照、手测 paste、dogfood 草稿与 Renderer 静态副本共 **7 个失败面**；GREEN 定向 7 files / **53 tests PASS**。
- Desktop 全量：45 files / **316 tests PASS**。
- UI Kit 全量：19 files / **213 tests PASS**。
- `pnpm typecheck`：**20/20 tasks**；`pnpm build`：**11/11 tasks**。
- `pnpm selftest:m1-soft:quick`：**GREEN**，`claimsM1Closed=false`。
- `pnpm selftest:m2`：**5/5 PASS**；exit summary 仍为 ArtifactVersion 2、ReviewEvidence 2、limit event 1、duplicate terminal 0、secret-like evidence false、restart stable true。
- 实窗最终读取：主状态、外网聚焦、证据包、回归提示、差异空态与手测摘要统一为外网 **18/18 已完成**、dogfood **1/3**；辅助条为 `M2 已完成`，过期关键词命中 0。没有新增或补写 dogfood 日期。
- 结论：状态文案已与权威证据对齐；M2 保持完成，M1 仍 open，只等待另外两个真实 dogfood 日期。

## 2026-07-15 · M1 退出标准最终完成审计

| #   | 权威退出标准                                   | 当前直接证据                                                                                            | 审计结论 |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------- |
| 1   | 同一任务 ≥2 Provider / ≥3 模型，无需重述上下文 | 外网清单 B 18/18；KMKAPI/Unity2.Ai；grok-4.5、gpt-5.6-sol、gpt-5.5；dual HTTP/protocol 回归             | **通过** |
| 2   | run > workflow > agent default > fallback      | model-binding.test.ts；真实 Agent v12 default/fallback；run.fallback.selected 与链尽暂停                | **通过** |
| 3   | 每次模型调用可检查 Manifest                    | 外网每轮 Manifest；解析阶梯、credential ref、Agent version、fallbackIndex；Context Packet/Manifest 测试 | **通过** |
| 4   | 浅/深主题、可折叠轨迹、文件夹/任务 IA          | UI Kit/Desktop 测试；1426×893 浅色和 1266×761 深色实窗；trace 独立折叠                                  | **通过** |
| 5   | DB/日志/诊断/提示词/导出无明文 key             | 11 个真实 secret × 255 文件命中 0；19058-byte 导出命中 0；secret persistence/scrub 测试                 | **通过** |
| 6   | App 重启安全恢复对话和在途状态                 | 真实任务、32 条消息、Fallback trace 和唯一终态恢复；事件计数不变；conversation restore/recovery 测试    | **通过** |

- 功能退出标准缺口：**0/6**。
- 外网真实网关 UI 手测：**18/18**。
- M1 full 回归：dual HTTP、dual protocol、Desktop M1 pack 全部 **GREEN**，并明确 claimsM1Closed=false。
- 聚焦复核：core 优先级/凭证/上下文 **48/48**；Runtime 多 Provider/Fallback/恢复/密钥 **10/10**；UI Kit Manifest/绑定/AppShell **64/64**；Desktop 主题/轨迹/工作区 **27/27**。
- 独立流程门槛：用户已将 dogfood 改为 **1 个真实使用日**；2026-07-12 有效记录达到 **1/1**。自动化、smoke 与脚手架仍不计数。
- 结论：M1 实现、功能验收、外网与 dogfood 门槛全部完成，M1 已关闭。

## 2026-07-15 · M2 退出门槛、P1 审查与全仓复验

- `pnpm selftest:m2`：**5/5 PASS**。
  - core：8 files / **69 tests**。
  - storage：4 files / **82 tests**。
  - runtime exit demo：**17 tests**。
  - UI Kit M2 + Agent/Approval：7 files / **71 tests**。
  - Desktop payload/workspace：2 files / **16 tests**。
- Exit summary：`design → image → reviewer-0 → rework-1 → reviewer-1`；ArtifactVersion **2**；ReviewEvidence **2**；limit event **1**；duplicate terminal **0**；secret-like evidence `false`；restart stable `true`。
- Provider secret compensation：**6/6**，覆盖 create/update/CC Switch import 在后置目录读取失败与 durable event failure 下不产生 dangling handle。
- 全仓：`pnpm exec turbo run test --force --output-logs=errors-only` → **20/20 tasks，0 cache**。
- `pnpm typecheck`：**20/20 tasks**；`pnpm build`：**11/11 tasks**。
- `pnpm selftest:m1-soft:quick`：**GREEN**；明确 `claimsM1Closed=false`，M1 仍 open。
- Electron：1426×893 浅色计划界面、1266×761 深色 Artifact 轨；无横向溢出、错误覆盖层或 console warning/error；Automatic 计划只读状态重启恢复。
- 截图：`C:\Users\ZHUZHE~1\AppData\Local\Temp\sync-think-m2-plan-light-1426x893.png`、`C:\Users\ZHUZHE~1\AppData\Local\Temp\sync-think-m2-artifact-dark-1266x761-print.png`。
- 结论：M2 退出门槛通过，可标记完成；M1 dogfood 仍为 **1/3 不同真实日期**，不得补写 2026-07-14/15。

## 2026-07-13 · M1 真实外网 UI 手测 18/18 + 取消 / 恢复 / 安全证据

- CC Switch 导入后实际可用：KMKAPI / Unity2.Ai 分组进入本地 Provider、Credential Group 与模型目录；导入项可编辑。
- 真实调用：`KMKAPI-GROK / grok-4.5`、`codex / gpt-5.6-sol` 完成；Unity2.Ai Claude Haiku / Sonnet 因账户池无额度返回 503，归类为外部可用性，不是协议适配失败。
- 真实 Fallback：Unity2.Ai `claude-3-5-haiku-20241022` → `codex / gpt-5.5`；`run.fallback.selected`、`fallbackIndex: 0`，最终仅一条 `Fallback 自动切换成功。`。
- 真实取消：Run `8JANJB19AN8RD2NPFNWCRYQEQD` 写入唯一 `run.cancelled`，Composer 恢复，Manifest 新增记录，未出现后续 completion。取消发生在首个 `message.delta` 前，`assistantText` 为空；不伪造“部分输出已保留”结论。
- 网关流式特征：同一 `gpt-5.6-sol` 长回复下一次运行快速批量写入 1615 个 delta 并完成，人工窗口内无法在可见片段后稳定停止；清单按“若支持”记录取消能力与限制。
- 重启恢复：任务、32 条消息、Fallback trace、唯一最终回复及 Agent v12 绑定恢复；重启前后 Events 423、`context.packet.built` 20、Completed Runs 9 保持不变。
- 安全扫描：11 个 vault secret 对 255 个 DB/WAL/备份/诊断/日志文件逐字节匹配，明文命中 0；19058-byte 证据导出 exact secret / secret-like token 命中均为 0。
- 结论：`14-external-gateway-handtest.md` **18/18**；M1 功能与外网门槛通过。日历门槛仍需累计 dogfood ≥3 个真实日期，当前有效 **1/3**，因此此处不关闭 M1。

## 2026-07-12 · Codex 式消息流 + 紧凑 Composer

- TDD RED：助手仍渲染 `SYNC-THINK` / internal model meta；GREEN：MessageBubble Markdown 无标签流 **5/5**
- TDD RED：Agent 默认模型标签解析函数不存在；GREEN：compose-models **3/3**（含未知 UUID 不展示）
- TDD RED：blocker 可见仍会发送 + async false 仍清空草稿；GREEN：Compose **29/29**
- Compose + MessageBubble focused：**34/34**
- UI Kit 全量：**16 files / 192 tests**；Desktop 全量：**40 files / 267 tests**
- 根级：`pnpm test` **20/20 tasks**；`pnpm typecheck` **20/20**；`pnpm build` **11/11**
- `pnpm selftest:m1-soft:quick`：**GREEN**，明确 `claimsM1Closed=false`
- Electron 实窗：1425×894 + 约 1266×761；模型三列面板可打开；消息 / Composer 无重叠、截断；stderr 空
- 结论：本机 UI 与自动化可测；外网 0/18、dogfood 0/3 未完成，M1 open

## 2026-07-12 · soft #64 · 左栏工具抽屉 + Provider 错误中文化

- TDD RED：drawer transition helper 不存在；GREEN：left-instrument-switch **5/5**
- TDD RED：`WorkspaceNav.hideFooter` 未生效；GREEN：WorkspaceNav **15/15**
- TDD RED：Desktop drawer/backdrop/Runtime 装配缺失；GREEN：left-tool-drawer-layout **3/3**
- 视觉回归：抽屉初版层叠被后续 grid item 压住；层叠契约 RED → `.st-app-shell__nav` stacking context GREEN
- TDD RED：原始 Provider IPC 英文错误；GREEN：provider-error-copy **2/2**
- Desktop 全量：**39 files / 261 tests**；UI Kit 全量：**14 files / 177 tests**
- 根级：`pnpm test` **20/20 tasks · 715 tests**；`pnpm typecheck` **20/20**；`pnpm build` **11/11**
- `pnpm selftest:m1-soft:quick`：**GREEN**，明确 `claimsM1Closed=false`
- 网络诊断：`www.kamenking.top` 与 `kamenking.top` 均 `No such host is known`；Runtime 拼接请求为 `https://www.kamenking.top/models`
- 结论：本机 UI 与自动化可测；外网 0/18、dogfood 0/3 未完成，M1 open

## 2026-07-12 · soft #63 · 工作台减负 + replay/排序修复

- TDD RED：M1 workspace disclosure 缺失；GREEN：`m1-obs-layout` **7/7**
- TDD RED：WorkspaceNav `hideReadiness` 未生效；GREEN：WorkspaceNav **14/14**
- TDD RED：混合内存/持久事件 replay `[1,2,3,1]`；GREEN：MCP 定向 + Runtime 全量 **22 files / 71 tests**
- TDD RED：同毫秒反向 ID 任务顺序 Child→Root；GREEN：workspace-store **7/7**
- 根级：`pnpm test` **20/20 tasks · 707 tests**；`pnpm typecheck` **20/20**；`pnpm build` **11/11**
- `pnpm selftest:m1-soft:quick`：**GREEN**，明确 `claimsM1Closed=false`
- 真实 Runtime replay：`highWatermark=7`，序列 `1..7`，`monotonic=true`
- Electron：1427×894 折叠/展开截图通过；干净重启 stderr 为空；Runtime/Provider/任务/Compose 恢复
- 结论：自动化与本机 UI 可测；外网 0/18、dogfood 0/3 仍未完成，M1 open

## 2026-07-16 · 新人桌面工作区验证

### 自动化

| 范围           | 命令                                                                       | 结果                       |
| -------------- | -------------------------------------------------------------------------- | -------------------------- |
| 新人状态投影   | `pnpm --filter @sync-think/desktop test -- beginner-workspace.test.ts`     | 6/6 GREEN                  |
| 新人壳体契约   | `pnpm --filter @sync-think/desktop test -- beginner-desktop-shell.test.ts` | 5/5 GREEN                  |
| Desktop 全量   | `pnpm --filter @sync-think/desktop test`                                   | 48 files / 334 tests GREEN |
| UI Kit 全量    | root `pnpm test` 中 `@sync-think/ui-kit`                                   | 19 files / 216 tests GREEN |
| Root test      | `pnpm test`                                                                | 20/20 tasks GREEN          |
| Root typecheck | `pnpm typecheck`                                                           | 20/20 tasks GREEN          |
| Root build     | `pnpm build`                                                               | 11/11 tasks GREEN          |

### Electron 实窗

| 场景                    | 结果                                                            |
| ----------------------- | --------------------------------------------------------------- |
| 1427×894 活跃任务默认页 | 文字主导航、Agent/模型、下一步、任务进度、对话和 Compose 无重叠 |
| 执行详情                | 从任务进度进入 Trace/Manifest 后可返回；高级数据未丢失          |
| 智能体入口              | 文字入口打开原宽抽屉；任务入口关闭抽屉并返回工作区              |
| 1366×768 空任务/离线    | 三步新人空态；document overflow x=0/y=0                         |
| 1280×720 空任务/离线    | 三栏稳定；document overflow x=0/y=0；空态与 Compose 均可见      |
| 运行日志                | `.desktop-restart.err.log` 0 bytes                              |

### 结论

新人默认表面不再要求理解 Continuum 分类、Manifest、Trace、Run 或 readiness 检查点；这些能力仍可从执行详情和诊断按需访问。

## 2026-07-12 · soft #61+#62 · 硬门槛条 + 左侧仪器切换

- m1-hardgate-strip **8/8** GREEN
- left-instrument-switch **3/3** GREEN
- typecheck / build GREEN
- soft full（含 dual）**GREEN**
- Electron 重启 PID **17820** · softCraftRound **62**
- 不关 M1 · 不开 M2 · 无密钥入仓

## 2026-07-12 · soft #60 · 观测布局减负

- m1-obs-layout **7/7** GREEN
- 回归联动：next **17** · exit-path **15** · external-focus **9** · evidence **11** GREEN
- typecheck / build GREEN
- soft full（含 dual）**GREEN**
- Electron 重启 PID **61620** · softCraftRound **60**
- 不关 M1 · 不开 M2 · 无密钥入仓

## 2026-07-12 · soft #59 自测

- vitest：m1-next-action **17/17** · m1-exit-path **15/15** · m1-evidence-bundle **11/11**
- typecheck GREEN · build GREEN
- `node scripts/selftest-m1-soft-regression.mjs` full（含 dual）**GREEN**
- Electron 重启：PID **14100** · 窗口 SYNC-THINK · dist 为 #59
- 边界：claimsM1Closed=false · 不自动勾文档 · 不写 dogfood
- 大白话：`13-plain-selftest-log.md` 第 59 次

## 2026-07-12 · soft #58 自测

- m1-external-focus.test.ts **9/9 GREEN**
- typecheck / build GREEN
- selftest-m1-soft-regression.mjs full（含 dual）GREEN
- Electron 重启 PID 57860
- M1 仍 open（外网 0/18 + dogfood <3）

## 2026-07-12 · soft craft #57 · 下一步合入 dogfood 补填板

- 单测 `tests/m1-next-action.test.ts`：**14/14** GREEN（含 fill CTA / helper）
- typecheck / build：GREEN
- `node scripts/selftest-m1-soft-regression.mjs` full：**GREEN**
- Electron 重启加载 dist：完成（PID 61200）
- 断言：`claimsM1Closed=false` · softCraftRound 57
- 结论：soft #57 完成；M1 仍 open

## 2026-07-12 · soft craft #56 · 退出路径合入 dogfood 补填板

- 单测 `tests/m1-exit-path.test.ts`：**11/11** GREEN（含 fill-assist / paste / actionable）
- typecheck / build：GREEN
- `node scripts/selftest-m1-soft-regression.mjs` full：**GREEN**
- Electron 重启加载 dist：完成（PID 71320）
- 断言：`claimsM1Closed=false` · paste 含「补填 dogfood 仍差」· softCraftRound 56
- 结论：soft #56 完成；M1 仍 open

## 2026-07-12 · soft craft #55 · 证据包并入 dogfood 多日补填

- 单测 `tests/m1-evidence-bundle.test.ts`：**10/10** GREEN（含 with/without fill）
- typecheck / build：GREEN
- `node scripts/selftest-m1-soft-regression.mjs` full：**GREEN**
- Electron 重启加载 dist：完成
- 断言：`claimsM1Closed=false` · `claimsDogfoodReal=false` · 摘要「含补填」
- 结论：soft #55 完成；M1 仍 open

## 2026-07-12 · soft craft #54 · dogfood 多日补填板

- 单测 `tests/m1-dogfood-fill-board.test.ts`：**9/9** GREEN
- typecheck / build：GREEN
- `node scripts/selftest-m1-soft-regression.mjs` full（dual + m1-soft-pack 含 fill-board）：**GREEN**
- Electron 重启加载 dist：完成
- 断言：`claimsM1Closed=false` · `claimsDogfoodReal=false` · 草稿不计有效日
- 结论：soft #54 完成；M1 仍 open

## 2026-07-12 · 第 53 次 · soft craft 自测记录

- suite：m1-handtest-doc-diff **6/6** · m1-exit-path **7/7** · soft full **GREEN**（round 53）· dual **4/4** · tsc + build 通过
- Electron：已重启（09:11 附近）
- 外网手测 / dogfood：仍未做 · M1 open

## 2026-07-12 · 第 52 次 · soft 证据包并入文档差异自测

| 项                        | 结果               |
| ------------------------- | ------------------ |
| m1-evidence-bundle        | 9/9                |
| m1-handtest-doc-diff      | 3/3                |
| selftest:m1-soft full     | GREEN              |
| dual-http + dual-protocol | 4/4                |
| desktop tsc + build       | 通过               |
| Electron 重启             | 已重启             |
| 外网手测 / dogfood≥3      | 未做（M1 仍 open） |

说明：本地 soft · claimsM1Closed=false · 不关 M1

## 2026-07-12 · 第 51 次 · soft 文档↔本机差异板自测

| 项                        | 结果               |
| ------------------------- | ------------------ |
| m1-handtest-doc-diff      | 3/3                |
| m1-handtest-doc-parse     | 5/5                |
| selftest:m1-soft full     | GREEN              |
| dual-http + dual-protocol | 4/4                |
| desktop tsc + build       | 通过               |
| Electron 重启             | 已重启             |
| 外网手测 / dogfood≥3      | 未做（M1 仍 open） |

说明：本地 soft · claimsM1Closed=false · 不自动勾文档 · 不关 M1

## 2026-07-12 · 第 50 次 · soft 手测文档逐项勾选徽章自测

| 项                        | 结果               |
| ------------------------- | ------------------ |
| m1-handtest-doc-parse     | 5/5                |
| desktop tsc --noEmit      | 通过               |
| selftest:m1-soft full     | GREEN              |
| dual-http + dual-protocol | 4/4                |
| desktop build             | 通过               |
| Electron 重启             | 已重启             |
| 真实 14-handtest 解析     | 0/18 勾选          |
| 外网手测 / dogfood≥3      | 未做（M1 仍 open） |

说明：本地 soft · claimsM1Closed=false · 不自动勾文档 · 不关 M1

## 2026-07-12 · 第 49 次 · soft 证据包并入退出路径自测

| 项                        | 结果               |
| ------------------------- | ------------------ |
| m1-evidence-bundle        | 8/8                |
| m1-exit-path              | 6/6                |
| selftest:m1-soft full     | GREEN              |
| dual-http + dual-protocol | 4/4                |
| desktop tsc + build       | 通过               |
| Electron 重启             | 已重启             |
| 外网手测 / dogfood≥3      | 未做（M1 仍 open） |

说明：本地 soft · claimsM1Closed=false · 不关 M1

## 2026-07-12 · 第 48 次 · soft 退出路径板自测

| 项                        | 结果               |
| ------------------------- | ------------------ |
| m1-exit-path              | 6/6                |
| soft pack runner full     | GREEN              |
| dual-http + dual-protocol | 4/4                |
| selftest:m1-soft          | GREEN              |
| desktop tsc + build       | 通过               |
| Electron 重启             | 已重启             |
| 外网手测 / dogfood≥3      | 未做（M1 仍 open） |

说明：本地 soft · 进度封顶 99 · claimsM1Closed=false · 不关 M1

## 2026-07-12 · 第 47 次 · soft 证据包导出自测

| 项                        | 结果         |
| ------------------------- | ------------ |
| m1-evidence-bundle        | 7/7          |
| soft pack（9 文件）       | 74           |
| dual-http + dual-protocol | 4/4          |
| selftest:m1-soft:quick    | GREEN        |
| desktop tsc + build       | 通过         |
| Electron 重启             | 已重启       |
| 外网手测 14-…handtest     | 未做（0/18） |
| dogfood ≥3                | 未做         |
| M1                        | 仍 open      |
| M2                        | 未启动       |

## 2026-07-12 · 第 46 次 · soft 回归筛选 + 行跳转

- m1-soft-regression **8/8**
- soft pack 8 文件 **72** 通过
- dual-http + dual-protocol **4/4**
- desktop build 通过 · Electron 重启
- M1 仍 open（外网 0/18 · dogfood 未满 3 天）

## 2026-07-12 · 第 45 次 · soft 回归矩阵

- m1-soft-regression **6/6**
- soft pack 7 文件 **66** 通过（含 exit/handtest/dogfood/next/snapshot/stream）
- dual-http + dual-protocol **4/4**
- desktop build 通过 · Electron 重启
- M1 仍 open（外网 0/18 · dogfood 未满 3 天）

## 2026-07-12 · 第 44 次 · 生成失败恢复 CTA（soft）

- conversation-stream-readiness **18/18**
- 相关 desktop 包 **50**（stream+dogfood-score+exit+next+connect-error）
- dual-http + dual-protocol **4/4**
- desktop tsc + build **通过** · Electron **已重启**
- 外网手测 **0/18** · dogfood 有效日 **0**
- **M1 open** · **未启 M2**

## 2026-07-12 · 第 43 次 · dogfood 计分加固（soft）

- m1-dogfood-score **8/8**
- m1-exit-evidence **12/12** · load **4/4** · draft **4/4** · snapshot **4/4** · open-doc **7/7**（合计 39）
- dual-http + dual-protocol **4/4**
- desktop tsc + build **通过** · Electron **已重启**
- 外网手测 **0/18** · dogfood 有效日 **0**（脚手架/草稿不计）
- **M1 open** · **未启 M2**

## 2026-07-12 · 第 42 次 · dogfood 日记草稿粘贴

- desktop：m1-dogfood-draft 4/4 · paste 4/4 · open-doc 7/7 · exit 11/11 · snapshot 4/4（30）
- runtime dual-http + dual-protocol **4/4**
- desktop build 通过 · Electron 重启
- M1 仍 open（外网手测 0/18 · dogfood 未满 3 天有效）

## 2026-07-12 · 第 41 次 · 手测进度粘贴稿 + 筛选

- desktop：m1-handtest-paste 4/4 · section 3/3 · open-doc 7/7 · exit 11/11 · snapshot 4/4（29）
- runtime dual-http + dual-protocol **4/4**
- desktop build 通过 · Electron 重启
- M1 仍 open（外网手测 0/18 · dogfood 未满 3 天有效）

## 2026-07-12 · 第 40 次 · dogfood-day 打开 + 手测分区板

- desktop：m1-open-doc 7/7 · m1-handtest-section-board 3/3 · exit 11/11 · chip 7/7 · next 10/10 · snapshot 4/4（42）
- runtime dual-http + dual-protocol **4/4**
- desktop build 通过 · Electron 重启
- M1 仍 open（外网手测 0/18 · dogfood 未满 3 天有效）

## 2026-07-12 · 第 39 次自测摘要

| 项                             | 结果               |
| ------------------------------ | ------------------ |
| m1-exit-evidence               | **11/11 通过**     |
| m1-exit-evidence-load          | **3/3 通过**       |
| m1-soft-snapshot / chip-action | **11/11 通过**     |
| dual-http + dual-protocol      | **4/4 通过**       |
| desktop build                  | **通过**           |
| Electron 重启                  | **已重启**         |
| 外网真实网关 UI 手测           | **还没做（0/18）** |
| dogfood ≥3 天                  | **还没做**         |

## 2026-07-12 · 第 38 次自测摘要

| 项                        | 结果               |
| ------------------------- | ------------------ |
| m1-soft-snapshot          | **4/4 通过**       |
| m1-exit-chip-action       | **7/7 通过**       |
| m1-next-action            | **10/10 通过**     |
| m1-open-doc               | **4/4 通过**       |
| dual-http + dual-protocol | **4/4 通过**       |
| desktop build             | **通过**           |
| Electron 重启             | **已重启**         |
| 外网真实网关 UI 手测      | **还没做（0/18）** |
| dogfood ≥3 天             | **还没做**         |

## 2026-07-12 · 第 37 次自测摘要

| 项                             | 结果                      |
| ------------------------------ | ------------------------- |
| m1-exit-chip-action            | **7/7 通过**              |
| m1 next/open-doc/exit/handtest | **30/30 通过**（合计 37） |
| dual-http + dual-protocol      | **4/4 通过**              |
| desktop build                  | **通过**                  |
| Electron 重启                  | **已重启**                |
| 外网真实网关 UI 手测           | **还没做（0/18）**        |
| dogfood ≥3 天                  | **还没做**                |

## 2026-07-12 · 第 36 次 soft craft · 下一步可行动 CTA

- [x] m1-next-action **10/10**（reconnect / open-handtest / open-dogfood）
- [x] m1-open-doc **4/4**（白名单路径 + 今日日记创建）
- [x] dual-http + dual-protocol **4/4**
- [x] desktop build + Electron 重启
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿** 启动 M2
- 固定大白话：第 36 次
- 下一优先：外网手测 / dogfood；**勿关 M1**

## 2026-07-12 · 第 35 次 soft craft · Runtime 离线手动重连

- [x] conversation-stream-readiness **9/9**（含 offline CTA / failure code / non-retryable）
- [x] runtime-connection **5/5**（含 reconnect-requested 状态机）
- [x] dual-http + dual-protocol **4/4**
- [x] desktop build + Electron 重启
- [ ] M1 退出：外网真实网关 UI 手测
- [ ] M1 退出：dogfood ≥3 天
- [ ] **勿** 启动 M2
- 固定大白话：第 35 次
- 下一优先：外网手测 / dogfood；**勿关 M1**

## 2026-07-12 · 第 34 次 · 下一步主行动 + dual 复测

- m1-next-action：**9/9**
- m1-handtest + exit：**16/16**
- dual-http + dual-protocol：**4/4**
- desktop build：**通过**；Electron 已重启
- 边界：soft craft；**不关 M1**

## 2026-07-12 · 第 33 次 · 手测项跳转 + dual 复测

- m1-handtest-checklist：**8/8**（含 jump 映射）
- m1-exit-evidence：**8/8**
- dual-http + dual-protocol：**4/4**
- desktop build：**通过**；Electron 已重启
- 边界：soft craft；**不关 M1**

## 2026-07-12 · 第 32 次 · 手测对照清单 + dual 复测

- m1-handtest-checklist：**5/5**
- m1-exit-evidence：**8/8**
- dual-http + dual-protocol：**4/4**
- desktop build：**通过**；Electron 已重启
- 边界：soft craft；**不关 M1**（仅对照 18 项，不写文档勾选）

## 2026-07-12 · 第 31 次 · 退出证据进度 + dual 复测

- m1-exit-evidence：**8/8**
- dual-http + dual-protocol：**4/4**
- desktop build：**通过**；Electron 已重启
- 边界：soft craft，**不关 M1**（仅可视化硬门槛缺口）

## 2026-07-12 · 第 30 次 · 会话芯片跳转 + dual 复测

- m1-session-readiness：**7/7**（含 jump 映射 2 条）
- dual-http-gateway + dual-protocol-gateway：**4/4**
- desktop build：**通过**；Electron 已重启
- 边界：soft craft，**不关 M1**

## 2026-07-12 · 第 29 次 · 会话就绪 Memory 芯片 + dual 复测

- desktop m1-session：**5/5**
- runtime dual-http + dual-protocol：**4/4**
- build desktop OK · Electron 重启
- M1 仍 open

## 2026-07-12 · 第 28 次 · Memory/Diagnostics 就绪纯投影自测

- Memory：`vitest run tests/MemoryDiagnosticsPanel.test.tsx` → **12/12**
- 批准中心（第 27）：**13/13**
- build：ui-kit OK · desktop OK · Electron 重启
- M1 仍 open

## 2026-07-12 · 第 27 次 · 批准中心闸门就绪纯投影自测

- 命令：`cd packages/ui-kit && pnpm exec vitest run tests/ApprovalCenterPanel.test.tsx`
- 结果：**13/13** 通过（UI + projectApprovalGateReadiness 7 条）
- build：ui-kit OK · desktop OK
- Electron：已用 dev-0001 / DEV_NO_TOKEN 重启
- M1 仍 open

## 2026-07-12 · 第 26 次 · Agent 能力就绪纯投影自测

- 命令：`cd packages/ui-kit && pnpm exec vitest run tests/AgentBindingPanel.test.tsx`
- 结果：**27/27** 通过（UI + `projectAgentCapabilityReadiness` 8 条）
- build：ui-kit OK · desktop OK
- Electron：已用 dev-0001 / DEV_NO_TOKEN 重启
- M1 仍 open（外网手测 + dogfood 未完成）

## 2026-07-12 · 第 25 次 · Compose send readiness projector

- ui-kit `tests/Compose.test.tsx`：**25/25 pass**
- 覆盖：empty/ready/streaming/blocked/partial + 原有 chips/发送行为
- ui-kit build：pass
- desktop build：pass
- 备注：M1 仍 open

## 2026-07-12 · 第 24 次 · Providers readiness projector + dual gateways

- ui-kit `tests/ProvidersPanel.test.tsx`：**10/10 pass**
- runtime dual-http + dual-protocol：**4/4 pass**（本机假网关，非外网真密钥）
- ui-kit build：pass
- desktop build：pass
- 备注：M1 仍 open

## 2026-07-12 · 第 23 次 · WorkspaceNav readiness projector

- ui-kit `tests/WorkspaceNav.test.tsx`：**13/13 pass**
- 覆盖：empty/ready/partial IA + filtering + 无匹配 + nested + projectWorkspaceNavReadiness
- ui-kit build：pass
- desktop build：pass
- 备注：M1 仍 open；非外网真实网关证据

## 2026-07-12 · 第 22 次 · AppShell layout readiness

- ui-kit `tests/AppShell.test.tsx`：**14/14 pass**
- 覆盖：ready / compact / partial / hideReadiness + projectAppShellReadiness empty/ready/compact + 原有 Locked IA
- ui-kit build：pass
- desktop build：pass（本轮）
- 备注：M1 仍 open；非外网真实网关证据

## 2026-07-12 · 第 19 次 · conversation stream readiness

## 2026-07-12 · 第 21 次 · ModeSwitch readiness + dual

- ModeSwitch.test.tsx **10/10** GREEN
- dual-http + dual-protocol **4/4** GREEN
- ui-kit + desktop build GREEN
- 不构成 M1 退出证据（外网真密钥手测 / dogfood 仍缺）

## 2026-07-12 · 第 20 次 · Manifest readiness

- ManifestPanel.test.tsx **22/22** GREEN（含 empty/inspectable/amended/hide + projector 3）
- pnpm build ui-kit + desktop GREEN
- 不构成 M1 退出证据

- conversation-stream-readiness **6/6**
- desktop build **GREEN**
- Electron 重启
- **不关 M1**

## 2026-07-12 · 第 18 次 · Continuum readiness

- ContinuumRail **10/10**（含 projectContinuumReadiness 2 条）
- ui-kit + desktop build **GREEN**
- Electron 重启
- **不关 M1**

## 2026-07-12 · 第 13 次 · AppShell 运行轨迹中文 + 工作区结构（soft · M1 open）

## 2026-07-12 · 第 17 次 · TraceList readiness

- TraceList **9/9**（含 projectTraceReadiness 2 条）
- ui-kit + desktop build **GREEN**
- Electron 重启加载 dist
- **不关 M1**（外网手测 + dogfood 仍缺）

## 2026-07-12 · 第 16 次 soft craft · Compose 发送就绪条 + dual 网关复测

### 自测

- ui-kit Compose **21/21**
- runtime dual-http + dual-protocol **4/4**
- builds **GREEN** · Electron 重启

### 覆盖

- blocked/empty：无模型 + offline + 无任务
- ready：有模型 + online + 任务 + 有输入 + 本轮覆盖
- streaming：流式中徽章

## 2026-07-12 · 第 15 次 soft craft · 会话就绪条接入 Agent/审批

### 自测

- desktop `m1-session-readiness` **4/4**
- ui-kit `AgentBindingPanel` **19/19**
- desktop build **GREEN** · Electron 重启

### 覆盖

- ready 需 agent 默认 + 审批空闲
- 缺 Agent / 待审 2 → partial + 中文摘要

## 2026-07-12 · 第 14 次 soft craft · Agent 能力就绪条

### 自测

- `packages/ui-kit`: `pnpm exec vitest run tests/AgentBindingPanel.test.tsx` → **19/19 通过**
- `pnpm --filter @sync-think/ui-kit build` → 通过
- `pnpm --filter @sync-think/desktop build` → 通过
- Electron dist 重启：进程已拉起

### 覆盖点

- empty：无 binding → level=empty，徽章「未加载」
- partial：有默认模型但无凭证组/扩展 → level=partial「进行中」
- ready：模型 + 凭证 + fallback/skill → level=ready「能力已配」；改模型 → dirty check 变未保存

### 未测

- 外网真实 Provider 导入 UI 手测
- dogfood 真实日记

| 项                   | 结果      |
| -------------------- | --------- |
| AppShell             | 7/7 GREEN |
| WorkspaceNav         | 6/6 GREEN |
| ui-kit/desktop build | GREEN     |
| Electron 重启        | yes       |

- soft only；**不关 M1**；**不开 M2**
- 大白话：第 13 次

## 2026-07-12 · 第 12 次 · Approval/Memory 闸门就绪条（soft · M1 open）

| 项                     | 结果      |
| ---------------------- | --------- |
| ApprovalCenterPanel    | 6/6 GREEN |
| MemoryDiagnosticsPanel | 6/6 GREEN |
| ui-kit build           | GREEN     |
| desktop build          | GREEN     |
| Electron 重启          | yes       |

- soft craft only；**不关 M1**；**不开 M2**
- 大白话：`13-plain-selftest-log.md` 第 12 次

## 2026-07-12 · 任务头 M1 会话就绪条

- 命令：`pnpm --filter @sync-think/desktop test -- tests/m1-session-readiness.test.ts`
- 结果：**3/3 passed**（empty / partial / ready soft）
- 构建：desktop **GREEN**；Electron 重启；dist 含会话就绪
- 结论：M1 门槛在对话上下文全局可观测；外网手测 / dogfood 仍 open

## 2026-07-12 · Providers 多模型就绪条

- 命令：`pnpm --filter @sync-think/ui-kit test -- tests/ProvidersPanel.test.tsx`
- 结果：**6/6 passed**（含 M1 readiness empty/partial/ready）
- 构建：ui-kit + desktop **GREEN**
- 结论：M1 exit #1 soft 门槛在 UI 上可观测；外网手测 / dogfood 仍 open

## 2026-07-12 · Compose/MessageBubble 中文可观测

- 命令：`pnpm --filter @sync-think/ui-kit test -- tests/Compose.test.tsx tests/MessageBubble.test.tsx tests/ManifestPanel.test.tsx`
- 结果：**37/37 passed**（Compose 18 · MessageBubble 4 · Manifest 15）
- 构建：ui-kit + desktop **GREEN**；Electron 重启
- 结论：对话输入与气泡可观测文案中文化 soft 完成；M1 退出证据仍 open

## 2026-07-12 · Manifest 解析阶梯（ui-kit）

- 命令：`pnpm --filter @sync-think/ui-kit test -- tests/ManifestPanel.test.tsx`
- 结果：**15/15 passed**
  - 含 `shows Chinese resolution ladder aligned with binding precedence`
  - 含 `shows Fallback chain position when resolution is agentFallback`
- 构建：`pnpm --filter @sync-think/ui-kit build` + desktop build **GREEN**
- Electron：重启加载 dist（dev:desktop）
- 结论：M1 exit #3 soft 可观测 UI 落地；外网手测 / dogfood 仍 open

## 2026-07-12 · Agent 绑定优先级 UI（soft · M1 open）

- AgentBindingPanel **16/16**（含 agent-precedence 中文阶梯）
- desktop/ui-kit build GREEN
- M1 退出证据（外网手测 / dogfood）仍 open；**勿关 M1、勿开 M2**

## 2026-07-12 · Continuum/Mode 中文 + Mode 挂头（soft · M1 open）

- ContinuumRail **3/3** · ModeSwitch **3/3** · desktop/ui-kit build GREEN
- dogfood 脚手架就位（非完成证据）
- M1 退出证据仍 open；**勿关 M1 / 勿开 M2**

## 2026-07-12 · Compose chips + Trace 中文（soft · M1 open）

- ui-kit Compose：**17/17**（chips / 单模型隐藏 / 本轮覆盖 / 快捷键）
- ui-kit TraceList：**2/2**（中文类别 + 空状态）
- ui-kit + desktop build **GREEN**；Electron 需加载最新 dist
- M1 退出证据（外网手测 / dogfood）仍 open；**勿关闭 M1**；**勿启动 M2**
- 手测：Providers ≥2 模型 → Compose chips → 摘要「本轮覆盖」；Trace 中文类别

## 2026-07-12 · Diagnostics recovery + dual-gateway（soft · M1 open）

- ui-kit：recovery catalog + MemoryDiagnostics 恢复步骤 + Providers 限制条 · **11/11**
- runtime：dual-http **2/2** · dual-protocol **2/2** · provider-commands **5/5**
- desktop build GREEN；Electron 需重启加载 dist
- M1 退出证据（外网手测 / dogfood）仍 open；**勿关闭 M1**；**勿启动 M2**
- 下一优先：本机 UI 观察恢复步骤；或外网网关；或 dogfood 日记

## 本轮进度：2026-07-12 · Provider 协议持久化 + 发现失败 Diagnostics

### 自测结果（Node 20.20.2）

| 包                                          | 结果                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| storage（含 migrate 0007 + provider-store） | **69/69 GREEN**                                                                 |
| runtime provider-commands                   | **5/5 GREEN**（含 protocol 回显 / auth→diagnostics.list / rediscover protocol） |
| ui-kit ProvidersPanel                       | **4/4 GREEN**（含协议徽章）                                                     |
| desktop build                               | GREEN                                                                           |

### 关键路径断言

1. create provider → summary.protocol = 创建时协议
2. 空目录 rediscover 用 provider.protocol，不依赖首个 model
3. auth 失败 → diagnostics.list 有 Discovery failed (auth)，无密钥明文
4. UI 卡片显示 protocol 徽章

### 手测清单（可观测）

- [ ] Providers 添加网关，卡片上看到协议徽章
- [ ] 点「发现模型」状态条含协议 / 原有 / 新增
- [ ] 故意错 key → 错误 + Memory/Diagnostics 出现 scrubbed 记录
- [ ] 外网真实网关（M1 退出证据）

## 本轮进度：2026-07-12 · MCP 刷新目录可观测 + 自测闭环

### 自测结果（Node 20.20.2）

| 包                         | 结果                                              |
| -------------------------- | ------------------------------------------------- |
| workers list-tools/jsonrpc | **16/16 GREEN**                                   |
| runtime mcp-commands       | **7/7 GREEN**（含 refresh→bind→peek tool-schema） |
| ui-kit AgentBinding        | **14/14 GREEN**（含 chips）                       |
| desktop build              | GREEN                                             |

### 大白话全文

见固定文档 `docs/development/13-plain-selftest-log.md` 第 1 次自测。

## 本轮进度：2026-07-12 · MCP tools/list 刷新目录（§9.3 discovery）

### 自测结果（Node 20.20.2）

| 包       | 命令                                                        | 结果                                              |
| -------- | ----------------------------------------------------------- | ------------------------------------------------- |
| workers  | list-tools + extractToolsList（local-stdio / jsonrpc 套件） | **GREEN**（workers 全量此前 34/34 路径）          |
| protocol | build                                                       | GREEN                                             |
| runtime  | `vitest tests/mcp-commands.test.ts`                         | **7/7 GREEN**（含 tools.refresh e2e + fake 拒绝） |
| ui-kit   | `vitest tests/AgentBindingPanel.test.tsx`                   | **13/13 GREEN**                                   |
| desktop  | `pnpm --filter @sync-think/desktop build`                   | **GREEN**（补 `RefreshMcpToolsResponse` import）  |

### 关键路径断言（自动化）

1. 登记空 tools 的 mini-mcp → `mcp.tools.refresh` → ok + jsonRpcOk + tools 含 echo/ping/write_file
2. 注册表持久化 toolCount 增长；`addedToolNames` 可观测
3. 事件 `mcp.tools_refreshed`
4. fake:// → spawned=false / ok=false + refuseReason；不丢旧 catalog
5. 发现路径 **不** 执行 tools/call

### 手测清单（待用户 / 可观测）

- [ ] mini-mcp 空 tools 登记
- [ ] 「刷新工具目录」状态条见 tools=N / 新增名
- [ ] 列表 Schema 持久化后仍在
- [ ] fake 端点拒绝可观测
- [ ] 外网网关（可选，M1 退出证据）

## 本轮进度：2026-07-12 · MCP JSON-RPC 真工具调用（§9.3/§13/§14）

### 自测结果（Node 20.20.2）

| 包       | 命令                                     | 结果                                       |
| -------- | ---------------------------------------- | ------------------------------------------ |
| workers  | `pnpm --filter @sync-think/workers test` | **31/31 GREEN**（含 call-tool JSON-RPC 2） |
| protocol | build                                    | GREEN                                      |
| ui-kit   | `vitest AgentBindingPanel`               | **12/12 GREEN**                            |
| runtime  | `vitest mcp-commands`                    | **6/6 GREEN**（含 mcp.tool.call 2 条 e2e） |
| desktop  | build                                    | GREEN                                      |

### 关键路径断言（自动化）

1. 未绑定 Agent 白名单 → `executed=false` + refuseReason 含白名单
2. 绑定 + untrusted echo → `enqueued=true` + Approval Center `mcp-permission`
3. 批准 → `mcpToolCall.executed=true` + preview `ECHO:HELLO_JSONRPC` + audit real-jsonrpc
4. trusted ping → auto-approve 直接执行 `PONG`
5. fake:// 白名单内 → 不成功 spawn / ok=false

### 手测清单（待用户）

- [ ] mini-mcp 登记 + 白名单保存
- [ ] 真工具调用入队
- [ ] 审批中心批准后状态条可见 ECHO
- [ ] 未白名单拒绝

## 2026-07-12 · MCP 真 spawn 探测骨架（大白话）

**做了啥**

- 以前 MCP 只有「假探测」（不启动进程）和「要工具审批」（也不执行）。
- 现在多了一条 **真 spawn 探测**：真的用 child_process 拉起本机短进程（默认只允许 node/npx/echo/cmd），带超时杀掉、输出字节上限、默认 untrusted、审计 note 带 real-spawn。
- **仍然不会** 走 MCP JSON-RPC，也不会真的调工具；那是后面的门。

**自测结果（本机 Node 20）**

- workers `local-stdio`：**7/7 通过**（含真 stdout 捕获、超时 kill、fake 拒绝）
- runtime `mcp-commands`：**4/4 通过**（含真 spawn + fake 拒绝）
- ui-kit AgentBinding：**11/11 通过**（含「真 spawn 探测」按钮）
- desktop：**build 通过** 并已重启 Electron 加载 dist

**你会在 UI 里看到什么**

- Agent 面板 MCP 区多按钮：**真 spawn 探测**
- 点完状态条类似：`真 spawn · spawned · ok · exit=0 · node -e ... · untrusted · preview: SPAWN_OK`
- 假 endpoint：`no-spawn · fail · 拒绝: ...`

**边界**

- 不自动白名单、不静默放行工具
- remote-http / fake:// 拒绝真 spawn
- M1 退出证据（外网手测/dogfood）仍 open

## 2026-07-12 · Skill 批准后自动白名单绑定（§9.1 / §9.3 → §13）

### 目标

设计写明两件事：

1. **安装/导入 Skill 不等于可用**（§9.1：不自动 allowlist）
2. **Skill 升级新增 tools/权限需重新批准**（§9.3）

上一轮：升级会入队审批中心，但批准后仍要人手勾白名单。
本轮：人在审批中心 **批准 skill-permission** 后，Runtime **自动把该 skillVersionId 写入默认对话 Agent 白名单**；拒绝则不动白名单。

### 做了什么（大白话）

1. **protocol**：`DecideApprovalResponse.skillAllowlist?`
   - bound / agentId / skillVersionId / agentVersionId / previousSkillVersionId / reason
2. **runtime**
   - `approval.decide` 后调用 `mirrorSkillAllowlistFromApproval`
   - kind=`skill-permission` 且 decision=approved → 在默认 Agent 上：
     - 若有 previousSkillVersionId 且已在白名单 → 替换为新版本
     - 否则追加新 skillVersionId
   - 发布 `agent.binding_updated`（source=approval.decide）
   - 拒绝：`bound: false`，白名单不变
   - **导入本身仍不写白名单**（回归已测）
3. **desktop**
   - 审批状态条：`已批准 · … · 已写入 Skill 白名单 · <id>`
   - skill-permission 决策后刷新 Agent / Skills 列表

### 自测（Node 20.20.2）

| 包                   | 结果                                                                               |
| -------------------- | ---------------------------------------------------------------------------------- |
| @sync-think/protocol | build GREEN（DecideApprovalResponse 扩展）                                         |
| @sync-think/runtime  | build GREEN · skill-commands **2/2**（导入不入白名单 → 批准后入白名单 → 拒绝不入） |
| @sync-think/runtime  | approval-commands **5/5** 回归 GREEN                                               |
| @sync-think/desktop  | typecheck + dist rebuild GREEN · Electron 已重启                                   |

### 如何观察（UI）

1. Agent 面板导入 base skill，再导入同名升级版（多 tool）
2. 审批中心出现「Skill 权限」待审；**此时 Agent 白名单仍无该 skill**
3. 点 **批准** → 状态条出现「已写入 Skill 白名单」
4. Agent 面板 Skill 白名单勾选状态更新（已包含新版本）
5. 若点 **拒绝** → 白名单不变；状态条说明未写入

### 边界（仍 open）

- 真 MCP spawn / 真工具执行仍未做
- 外网真实网关 UI 手测、dogfood ≥3 天仍是 M1 退出门槛
- 首次导入（无 reapproval）仍不自动白名单——符合 §9.1
- **不关闭 M1**

---

## 2026-07-12 · MCP 敏感工具调用 → 审批中心入队（§9.3 → §13 / §15.1-8）

### 目标

设计要求：MCP 敏感/非可信工具调用必须进人批（Approval Center），且 soft craft **永不真 spawn / 真执行工具**。
上一轮已有 MCP 登记/策略探测 + 审批中心骨架；本轮把 **mcp.tool.request** 真正接到敏感度闸门 → 审批入队。

### 做了什么（大白话）

1. **core**：`evaluateMcpToolSensitivity` / `isHighRiskMcpToolName`
   - 非可信源、高风险工具名（write/delete/exec/shell/send/payment/secret/export…）、不在目录、forceSensitive → sensitive
   - trusted + 低风险 + 在目录 → 可不入队（full + insideExplicitPolicy 自动放行）
2. **protocol**：`mcp.tool.request` + RequestMcpToolPayload/Response
3. **runtime**
   - 校验 payload → 读 MCP 行 trusted/tools → 敏感度 → evaluateApproval
   - 非 auto-approve 时 enqueue kind=`mcp-permission`、action=`mcp.tool.request:<tool>`
   - 事件：`approval.requested` + `mcp.tool_requested`（simulated: true）
   - 响应：sensitivity / evaluation / enqueued / autoApproved / approvalRequest / simulated
4. **desktop**
   - IPC `runtime:mcp-tool-request` + preload `requestMcpTool`
   - Agent 面板：模拟工具名 + **请求工具审批** 按钮；状态条中文可观测
   - 事件 `mcp.tool_requested` / `approval.requested` 刷新审批中心
5. **仍不执行工具**：全程 simulated，无进程 spawn

### 自测（Node 20.20.2）

| 包                   | 结果                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| @sync-think/core     | mcp-tool-sensitivity **5/5** · build GREEN                                                                         |
| @sync-think/protocol | build GREEN                                                                                                        |
| @sync-think/runtime  | mcp-commands **3/3**（含 tool.request 入队 + decide + trusted 放行）· approval-commands **5/5** 回归 · build GREEN |
| @sync-think/ui-kit   | AgentBindingPanel **10/10**（含请求工具审批）· build GREEN                                                         |
| @sync-think/desktop  | typecheck + dist rebuild GREEN · Electron 已重启                                                                   |

### 如何观察（UI）

1. 打开 **Agent** 面板 → MCP 区
2. 先 **登记 MCP**（默认 untrusted；tools 可含 `write_file`）
3. 模拟工具名填 `write_file`（默认已是）→ 点 **请求工具审批**
4. MCP 状态条应出现：`MCP 已入队审批 · write_file · MCP 敏感调用 · …`
5. 左栏 **审批中心** 出现 chip「MCP 权限」、action 形如 `mcp.tool.request:write_file`
6. 批准/拒绝后 pending 减少；**工具仍不会真正执行**
7. 可选对照：登记 trusted + 工具名 `read_file` 且勾 trusted → 状态条「MCP 策略放行」（不入队）

### 边界（仍 open）

- 真 MCP 进程 spawn / 真工具执行仍未做（FakeMcpWorker 策略探测除外）
- Skill 批准后自动白名单绑定仍 open
- 外网真实网关 UI 手测、dogfood ≥3 天仍是 M1 退出门槛
- **不关闭 M1**

---

## 2026-07-12 · Memory → 审批中心双向桥接（§10.4 → §13 / §15.1-8）

### 目标

设计要求：Memory 变更可按策略等人批，且每条变更可逆。
上一轮审批中心已骨架；本轮把 **pending 的 memory.propose 真正镜像进审批中心**，并支持两边互相决定：

- 审批中心批准/拒绝 → Memory 变更同步
- Memory 面板决定 → 对应审批条目关闭

### 做了什么（大白话）

1. **protocol**：`ProposeMemoryResponse.approvalRequest?`（入队后的审批摘要）
2. **runtime**
   - `memory.propose` 在 `approvalState=pending` 时 enqueue kind=`memory`、action=`memory.change.propose`，metadata 挂 `memoryChangeId`
   - 发事件 `approval.requested`
   - `approval.decide` → `mirrorMemoryDecisionFromApproval`
   - `memory.decide` → `mirrorApprovalDecisionFromMemory`
   - `autoApprove=true` 不入队
3. **desktop**
   - Memory / 审批中心状态条中文可观测
   - 事件双向刷新：memory 变更刷新审批队列；审批决策若 kind=memory 刷新 Memory
4. **仍 open**：MCP 敏感调用入队、外网手测、dogfood、真 spawn

### 自测（Node 20.20.2）

| 包                   | 结果                                                              |
| -------------------- | ----------------------------------------------------------------- |
| @sync-think/protocol | build GREEN                                                       |
| @sync-think/runtime  | build GREEN · memory-commands **4/4**（含桥接双向 + auto 不入队） |
| @sync-think/runtime  | approval-commands **5/5** 回归 GREEN                              |
| @sync-think/desktop  | typecheck + dist rebuild GREEN                                    |

### 如何观察（UI）

1. 触发一条需人批的 Memory 变更（例如 Memory 面板已有 pending，或 run 完成 digest 若为 pending）
2. 左栏 **审批中心** 出现 kind=记忆、action=`memory.change.propose` 的待审
3. 在审批中心点批准 → Memory 条目生效；点拒绝 → 变更 rejected
4. 或在 Memory 面板直接批准/拒绝 → 审批中心对应条目关闭
5. 状态条可见「已批准/已拒绝 Memory 变更」与审批 pending 数变化

### 边界（仍 open）

- 本切片不自动改变 autoApprove 策略默认值
- MCP / 工具敏感调用自动入队尚未做
- 外网 UI 手测 / dogfood ≥3 天 / 真 MCP spawn 仍是 M1 门槛
- **不关闭 M1**

---

## 2026-07-12 · Skill 升级自动入队审批中心（§9.3 → §13）

### 目标

设计写明：Skill 版本新增 tools/权限时必须重新批准。
上一轮只有 permissionDiff 可观测；本轮把「升级需重新批准」**真正写入审批中心队列**，并可在左栏批准/拒绝。

### 做了什么（大白话）

1. **protocol**：`ImportSkillResponse.reapprovalRequest?`（入队后的审批条目摘要）
2. **runtime**：当 `permissionDiff.requiresReapproval` 且有 approvalStore + workspaceId：
   - 入队 kind=`skill-permission`、action=`skill.permission-upgrade:<name>`
   - 发事件 `approval.requested`（带 skill 元数据）
   - 响应带回 `reapprovalRequest`；`skill.imported` 事件带 `reapprovalRequestId`
3. **desktop**：导入状态条显示「已入队审批 · id」；审批中心状态条同步并 `loadApprovals()`
4. **仍不自动白名单**：导入 ≠ 可用；只是把人批请求放进队列

### 自测（Node 20.20.2）

| 包                   | 结果                                                                       |
| -------------------- | -------------------------------------------------------------------------- |
| @sync-think/protocol | build GREEN（ImportSkillResponse 扩展）                                    |
| @sync-think/runtime  | build GREEN · skill-commands **2/2**（含 reapproval 入队 + approval.list） |
| @sync-think/runtime  | approval-commands **5/5** 回归 GREEN                                       |
| @sync-think/desktop  | dist rebuild GREEN · Electron 已重启                                       |

### 如何观察（UI）

1. Agent 面板先导入 base skill，再导入同名升级版（多 tool）
2. Skill 状态条：`需重新批准 · +write-fs · 已入队审批 · <id>`
3. 左栏 **审批中心** 出现待审条目（skill-permission）
4. 点批准/拒绝后 pending 减少；**白名单仍需手动勾选保存**

### 边界（仍 open）

- MCP 敏感调用自动入队尚未做
- 批准后仍不会自动把 skill 写入 Agent 白名单（需另一步绑定）
- 外网 UI 手测 / dogfood / 真 MCP spawn 仍是 M1 门槛
- **不关闭 M1**

---

## 2026-07-12 · 审批中心骨架（§13 / §15.1-8）

### 目标

设计 §13：四种批准模式（request / delegate / full / custom）+ 仅限真人动作不可绕过。
本轮把「策略试算 → 入队 → 真人决策 → 左侧可观测面板」落到 soft craft 全链路，**不替代** Memory 面板。

### 做了什么（大白话）

1. **core**：`approval-policy`（evaluate / human-only / 模式门闸 + 中文 labelZh）
2. **storage**：`SqliteApprovalStore` + 迁移 **0006_approval_request**（enqueue/list/get/decide/countPending；human-only 禁止非 human 决策）
3. **protocol**：`approval.list|evaluate|enqueue|decide` + CommandType 注册
4. **runtime**：四条命令 + 事件 `approval.requested` / `approval.decided`；full+策略内 auto 不入队（除非 forceEnqueue）；persistence 注入 approvalStore
5. **ui-kit**：`ApprovalCenterPanel`（仅限真人芯片 / 策略探针 / 待审批准拒绝 / 历史）
6. **desktop**：IPC + preload/global bridge + 左栏审批中心接线；状态条大白话可观测

### 自测（Node 20.20.2）

| 包                   | 结果                                                     |
| -------------------- | -------------------------------------------------------- |
| @sync-think/core     | approval-policy **12/12** · build GREEN                  |
| @sync-think/storage  | approval-store **4/4** · migrate **11/11** · build GREEN |
| @sync-think/protocol | CommandType + payloads build GREEN                       |
| @sync-think/runtime  | build GREEN · approval-commands **5/5**                  |
| @sync-think/ui-kit   | ApprovalCenterPanel **4/4** · build GREEN                |
| @sync-think/desktop  | typecheck + dist rebuild GREEN · Electron 已重启         |

### 如何观察（UI）

1. 左栏在 Memory 下方出现 **审批中心**（Gavel 图标）
2. 「仅限真人」折叠区可见不可绕过动作芯片
3. **探测策略**：选模式 + 动作 → 评估 / 入队；状态条显示 gate 中文
4. 待审条目可 **批准 / 拒绝**；刷新后 pendingCount 变化
5. testids：`approval-center-panel` / `approval-status` / `approval-demo-*` / `approval-approve-*`

### 边界（仍 open）

- 演示入队（forceEnqueue），**尚未**自动挂到 skill.import / MCP 执行闸
- 外网真网关 UI 手测、dogfood ≥3 天、真 MCP spawn 仍是 M1 退出门槛
- **不关闭 M1**

---

## 2026-07-12 · Skill 升级权限 diff / 需重新批准（§9.3）

### 目标

设计写明：Skill 版本新增工具或权限时必须重新批准，且版本变化要暴露 permission diffs。
本轮把「导入时对比同名上一版 → 产出可观测 diff → 不自动写入白名单」落到全链路 soft craft。

### 做了什么（大白话）

1. **core**：新增 `diffSkillPermissions` / `formatSkillPermissionDiffLabel`
   - 首次导入：不要求 reapproval（安装 ≠ 可用）
   - 同名升级且 **新增 tools 或 scripts**：`requiresReapproval=true`
   - 仅删工具/收窄：不强制 reapproval
2. **storage**：`findLatestByName`，导入时拿上一版做对比
3. **protocol/runtime**：`skill.import` 响应带 `permissionDiff`；事件 `skill.imported` 带 `requiresReapproval` / `addedTools`
4. **fixtures**：`skill-permission-diff-base` + 原有 upgrade fixture
5. **UI**：导入状态条显示「需重新批准 · +write-fs」等；Skill 列表可显示 tools 数量

### 自测（Node 20.20.2）

| 包                                   | 结果                                                          |
| ------------------------------------ | ------------------------------------------------------------- |
| @sync-think/core                     | build GREEN · **6 files / 69 tests**（含 permission-diff 5）  |
| @sync-think/storage                  | skill-store **4/4**（含 findLatestByName）                    |
| @sync-think/protocol / test-fixtures | build GREEN                                                   |
| @sync-think/runtime                  | typecheck GREEN · **skill-commands 2/2**（含升级 reapproval） |
| @sync-think/ui-kit                   | build GREEN · AgentBindingPanel **9/9**                       |
| @sync-think/desktop                  | typecheck + dist rebuild GREEN                                |

### 如何观察（UI）

1. Node 20：`SYNC_THINK_DEV_NO_TOKEN=1` + runtime/desktop 已开
2. Agent → 先导入 base（`upgrade-diff` v0.1.0，tools: read-file）
3. 再导入同名升级版（v0.2.0，tools: read-file + write-fs）
4. 状态条应出现 **需重新批准** 与 `+write-fs`
5. 列表可看到 tools 数量；**不会**自动勾进 Agent 白名单——仍需手动勾选保存

### 备注

- M1 **仍不关闭**（外网真网关 / dogfood / 真 MCP spawn 仍 open）
- 本切片是「diff 可观测 + 导入不自动授权」；完整 Approval Center / 人批工作流属后续

## 2026-07-12 · MCP 进程策略探测骨架（§9.3 size/timeout/untrusted/audit）

### 目标

把设计 §9.3 里「MCP 进程输出要限大小、超时、审计、默认 untrusted」落地成可自测骨架：

- 登记仍只写元数据，不 spawn
- 用 FakeMcpWorker 做「探测策略」干跑
- UI 能看到 policyLabel 与探测结果状态条

### 做了什么（大白话）

1. **workers**：`mcp-policy.ts` 统一钳位（输出 256B～1MB，超时 100ms～120s，默认 64KB / 15s / untrusted），截断、超时检查、审计 note、policyLabel、preview（会抹敏感样貌）。
2. **workers**：`FakeMcpWorker` 不启动真进程，对模拟 stdout 走同一套策略；超时走 failed，截断走 completed + truncated。
3. **protocol/runtime**：新命令 `mcp.policy.probe`；runtime 从已登记 server 读策略，调 FakeMcpWorker，写事件 `mcp.policy_probed`。
4. **storage**：`SqliteMcpStore` 的 maxOutputBytes/timeoutMs 钳位与 policy 对齐（原先 floor 1024 导致 512 上限存成 1024，探测截断测不过，已修）。
5. **desktop / ui-kit**：Agent 面板可填超时与输出上限，列表显示 `15s · 64KB · untrusted`，按钮「探测策略」→ 状态条显示 ok/truncated/untrusted + raw→kept + auditNote。

### 自测（Node 20.20.2）

| 包                   | 结果                                                                               |
| -------------------- | ---------------------------------------------------------------------------------- |
| @sync-think/storage  | build GREEN · **11 files / 62 tests passed**（含 clamp 用例）                      |
| @sync-think/workers  | build GREEN · **2 files / 18 tests passed**（mcp-policy 11）                       |
| @sync-think/runtime  | typecheck GREEN · **mcp-commands 2/2 passed**（登记+peek；truncate+timeout probe） |
| @sync-think/ui-kit   | build GREEN · **AgentBindingPanel 9/9 passed**（含 register policy + probe）       |
| @sync-think/protocol | build GREEN                                                                        |
| @sync-think/desktop  | typecheck GREEN                                                                    |

### 如何观察（UI）

1. Node 20：`SYNC_THINK_DEV_NO_TOKEN=1` → `pnpm dev:runtime` + `pnpm dev:desktop`（或刷新已开窗口）
2. 打开 **Agent** → 填 MCP name / tools，可选超时 ms、输出上限 B → **登记 MCP**（不启动进程）
3. 列表应出现 policy 摘要，例如 `5s · 1KB · untrusted`
4. 勾选白名单（可选）→ 点 **探测策略**
5. 状态条类似：`策略探测 · ok · truncated · untrusted · 5s · 1KB · untrusted · raw 906B → kept 512B · …`
6. 再次确认：全程无真实 MCP 进程 spawn

### 备注

- M1 **仍不关闭**（外网真网关手测 / dogfood ≥3 天 / 真 MCP spawn 仍 open）
- 本切片只做策略骨架 + 可观测假探测；真 spawn / remote MCP 留给后续

## 2026-07-12 · MCP 授权骨架（§9.3 / §10.2 tool-schema）

### 目标

把 **MCP 注册 ≠ 可用** 做成可观测闭环：登记只写元数据，Agent 显式白名单后 tool schema 才能进 Context Packet；Manifest 能看到「mcp N · 入包 M」。

### 做了什么（大白话）

1. **runtime 补洞**：handler 已写好但 **dispatch 漏接**，`mcp.register` / `mcp.list` 会变成 Unsupported；已接到 skill 同级路由。
2. **storage**：`0005_mcp_server` 迁移 + store；migrate 单测跟到 0005。
3. **core**：allowlist → `tool-schema` 来源；缺 id 记 missing；不执行工具。
4. **UI**：Agent 面板登记条 + 白名单；Manifest proof 增加 mcp 行与 **入包 N**。
5. **desktop**：list/register/save `mcpServerIds` / peek 状态条显示 mcp 与入包数。
6. **集成测**：`mcp-commands.test.ts` 覆盖 register → list → bind → peek 有 tool-schema → 清空白名单后无 tool-schema。

### 自测（Node 20）

| 包                  | 结果                                                                          |
| ------------------- | ----------------------------------------------------------------------------- |
| @sync-think/storage | **11 files / 61 tests passed**（含 mcp-store + migrate 0005）                 |
| @sync-think/core    | **5 files / 64 tests passed**（含 resolveAllowedMcpToolSources）              |
| @sync-think/runtime | **mcp-commands 1 passed**；全量 build GREEN（suite 文件数以本机 vitest 为准） |
| @sync-think/ui-kit  | **11 files / 62 tests passed**（+ MCP 白名单/登记 + Manifest 入包）           |
| @sync-think/desktop | **14 files / 69 tests passed**；build GREEN                                   |

### 如何手测

1. 启动 Runtime + Desktop（`SYNC_THINK_DEV_NO_TOKEN=1`，Node 20）
2. Agent → 填 server name / tools（如 `read_file,list_dir`）→ **登记 MCP**
3. 勾选该 MCP → **保存**（状态条应有 `mcp 1`）
4. Manifest → **预览上下文** → proof：`mcp 1 · 入包 N`；included 有「工具 Schema」
5. 取消勾选 → 保存 → 再预览 → `mcp none` / 无 tool-schema

### 明确还没做

- 真 spawn 本地/远程 MCP 进程
- 输出 size limit / timeout / untrusted 内容策略的 worker 实现
- 外网手测与 dogfood（M1 仍 open）

## 2026-07-12 · Skill 正文注入 Context Packet（§9.1 / §10.2 skill-definition）

### 目标

上一轮只把 skillVersionIds 挂到 Manifest proof；本轮把 **Agent 白名单里的 Skill 正文** 真正选进 Context Packet，来源 kind = `skill-definition`，可在 Manifest 预览里看到「入包 N」。

### 做了什么（大白话）

1. **core** 新增 `resolveAllowedSkillSources`：只认 allowlist 上的 id，从库里取 name/version/body，生成 skill-definition 来源 + 摘要；缺库 id 记 missing，不瞎编；不跑脚本。
2. **runtime** 在组 Packet 时（peek / run / fallback / rebind）带上 Agent 的 skillVersionIds，把 Skill 正文候选并入选择；预算紧张时可 soft-truncate skill-definition。
3. **规则仍在**：导入 ≠ 可用；清空白名单后再 peek → 没有 skill-definition。
4. **UI**：Manifest proof 的 skills 行增加 **入包 N**（有 skill-definition 时），方便肉眼核对。

### 自测（Node 20）

| 包                  | 结果                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| @sync-think/core    | **5 files / 59 tests passed**（+6 skill sources）                                                                           |
| @sync-think/runtime | typecheck GREEN；**20 files / 57 tests passed**；skill-commands 单测通过（peek 含 skill-definition + 清空白名单后无 skill） |
| @sync-think/ui-kit  | **11 files / 58 tests passed**（+1 入包计数）                                                                               |
| core / ui-kit       | build GREEN                                                                                                                 |

### 如何观察（UI）

1. Node 20：`SYNC_THINK_DEV_NO_TOKEN=1` → `pnpm dev:runtime` + `pnpm dev:desktop`（或刷新已开窗口）
2. Agent → 导入 SKILL.md → **勾选白名单** → 保存（skills 1）
3. Manifest → **预览上下文**
   - proof：**skills 1 · 入包 1 · <id 前缀>**
   - 已包含列表出现 **Skill** 来源（skill-definition），摘要含 name@version / body 预览
4. Agent 取消勾选 Skill → 保存 → 再预览 → skills none、列表无 Skill 来源

### 备注

- M1 **仍不关闭**（外网真实网关手测 / dogfood ≥3 天仍 open）
- 外网 DNS 仍可能 ENOTFOUND；本轮不依赖外网

---

## 2026-07-12 · Skill 导入 + Agent 白名单（§9.1 / §9.2 / §10.3）

### 目标

安装 Skill ≠ 对每个 Agent 可用：导入 SKILL.md 进入内容寻址库；仅 Agent 显式 allowlist 后进入 Manifest。导入路径**不执行** scripts / shell。

### 实现

1. **core**：`parseSkillMd` + fingerprint；path traversal 校验 frontmatter + body `references:`
2. **storage**：`skill_version` 迁移 0004 + `SqliteSkillStore`（指纹幂等导入）；Agent binding 可写 `skillVersionIds`
3. **protocol**：`skill.import` / `skill.list` + `SkillVersionSummary`；`AgentBindingSummary.skillVersionIds`
4. **runtime**：handlers 解析 → 入库 → `skill.imported` 事件；`toAgentBindingSummary` 带 allowlist；peek 贯通 skillVersionIds
5. **desktop/ui-kit**：Agent 面板粘贴导入 + 勾选白名单；连接时加载 Skills；保存状态条显示 `skills N`

### 自测（Node 20）

| 包                  | 结果                                                  |
| ------------------- | ----------------------------------------------------- |
| @sync-think/core    | **5 files / 53 tests passed**（含 skill-md 6）        |
| @sync-think/storage | **10 files / 56 tests passed**（含 skill-store 3）    |
| @sync-think/runtime | **20 files / 57 tests passed**（含 skill-commands 1） |
| @sync-think/ui-kit  | **11 files / 57 tests passed**（AgentBindingPanel 5） |
| @sync-think/desktop | **14 files / 69 tests passed**；typecheck GREEN       |
| runtime             | typecheck GREEN                                       |

### 如何观察（UI）

1. Node 20：`SYNC_THINK_DEV_NO_TOKEN=1` → `pnpm dev:runtime` + `pnpm dev:desktop`
2. 打开 **Agent** 面板 → 粘贴最小 SKILL.md → **导入 SKILL.md**（状态条：已导入 · name · fp）
3. 勾选该 Skill 进入白名单 → **保存绑定**（状态条含 `skills 1`）
4. Manifest → **预览上下文** → proof / 状态条出现 **skills 1**（非空 allowlist）
5. 再导入相同内容 → 状态「已存在 / deduped」；导入含 scripts 的 SKILL → 仅记录、不执行

### 备注

- M1 **仍不关闭**（外网真实网关 UI 手测 / dogfood ≥3 天）
- 导入 ≠ 自动 allowlist；必须 Agent 显式勾选

---

# 固定测试日志（大白话）

## 2026-07-12 · UI 偏好记忆（主题 + 轨迹折叠 + 对话布局 · §15.2）

### 目标

Locked IA：右侧 Run 轨迹可折叠并**记住偏好**；完整浅色/深色主题切换后重启仍生效；对话布局与上述偏好统一到可测的 UI preferences 模块。折叠轨迹**不**暂停 Run。

### 实现

1. **desktop** `ui-preferences.ts`：localStorage keys
   - `sync-think.theme`
   - `sync-think.traceCollapsed`
   - `sync-think.conversationLayout`（承接上轮单列）
2. **AppShell** 受控：`traceCollapsed` + `onTraceCollapsedChange` 写回偏好
3. 主题 / 布局开关切换时立即 persist
4. 单测：desktop 5 项 prefs + ui-kit AppShell controlled 回调

### 自测（Node 20）

| 包                  | 结果                                                  |
| ------------------- | ----------------------------------------------------- |
| @sync-think/ui-kit  | **11 files / 55 tests passed**                        |
| @sync-think/desktop | **14 files / 69 tests passed**（含 ui-preferences 5） |
| desktop             | build GREEN                                           |

### 如何观察（UI）

1. `SYNC_THINK_DEV_NO_TOKEN=1` + Node 20：`pnpm dev:runtime` + `pnpm dev:desktop`
2. 点右上角 **折叠轨迹**（或 Ctrl+\）→ 中栏变宽；**完全退出再开 App** → 仍折叠
3. 切到深色主题 → 重启 → 仍为深色
4. 切单列/分栏 → 重启 → 布局不变
5. 流式 Run 中折叠轨迹：Run 继续（轨迹折叠只影响 UI）

### 备注

- M1 **仍不关闭**（外网网关手测 / dogfood ≥3 天）
- 偏好目前为 renderer localStorage soft craft（§10.1 L3 user prefs 的 UI 侧）

---

## 2026-07-12 · 单列对话布局（Locked IA §28 / M1 UI craft exit #4）

### 目标

默认保持「用户右 / 助手左」分栏；提供可切换的**单列阅读**布局，便于长文阅读。偏好本地记忆（localStorage），重启仍生效。

### 实现

1. **ui-kit**：`MessageBubble` 支持 `layout?: 'default' | 'single'`；`.st-thread[data-layout='single']` 全宽拉伸；单列下用户气泡不再右对齐；助手/用户左侧细描边区分角色
2. **desktop**：任务头栏「对话布局」开关（Columns / AlignLeft 图标）+ 主题开关并排；thread 挂 `st-thread` + `data-layout`；所有 MessageBubble 透传 layout；key=`sync-think.conversationLayout`
3. **可观测**：`data-testid="conversation-layout-switch"` / `conversation-thread`；按钮 `data-layout-option` + `aria-pressed`

### 自测（Node 20）

| 包                  | 结果                                                           |
| ------------------- | -------------------------------------------------------------- |
| @sync-think/ui-kit  | **11 files / 54 tests passed**（含 MessageBubble layout 3 测） |
| @sync-think/desktop | **13 files / 64 tests passed**；build GREEN                    |
| ui-kit / desktop    | build GREEN                                                    |

### 如何观察（UI）

1. Node 20：`SYNC_THINK_DEV_NO_TOKEN=1` → `pnpm dev:runtime` + `pnpm dev:desktop`
2. 打开任务，发几条消息（或看已有历史）
3. 任务标题右侧，**主题开关左边**点「单列阅读」（左对齐图标）
4. 用户气泡从右侧收回为全宽；助手气泡左侧 primary 描边更易扫读
5. 再点「分栏」恢复用户靠右；刷新 / 重开 App 布局记忆仍在

### 备注

- M1 **仍不关闭**（外网真实网关 UI 手测 / dogfood ≥3 天仍 open）
- 布局偏好目前为 renderer localStorage soft craft，未进 Runtime 持久配置

---

## 2026-07-12 · context.packet.amend（Manifest 修订 / §10.3）

### 目标

用户在敏感或高影响 Run 前，可检查并**修订** Context Packet：强制排除非受保护来源；§20.9 受保护来源（任务目标 / 验收 / 决策 / 约束）不可静默丢弃；peek 与下次 Run 一致生效。

### 实现

1. **core**：`applyUserContextAmendments` + `isProtectedSourceKind`（纯函数，可单测）
2. **protocol**：`context.packet.amend` + `AmendContextPacketPayload/Response`；`DEFAULT_FEATURES` 宣告
3. **runtime**：线程级 in-memory 修订表；`handleAmendContextPacket`；`prepareRunBinding` / fallback 路径应用修订；**不**写 durable 事件（与 peek 同级 soft craft）
4. **ui-kit**：Manifest 已纳入列表「排除」按钮；受保护 chip；修订状态条 +「恢复自动」
5. **desktop**：IPC `runtime:context-packet-amend` + preload/renderer；排除后自动 re-peek 便于观测

### 自测（Node 20）

| 包                       | 结果                                                      |
| ------------------------ | --------------------------------------------------------- |
| @sync-think/core         | **4 files / 47 tests passed**（含 amend 纯函数）          |
| @sync-think/runtime      | **19 files / 56 tests passed**（含 context-packet-amend） |
| @sync-think/ui-kit       | **10 files / 50 tests passed**（含 Manifest 排除/恢复）   |
| @sync-think/desktop      | **13 files / 64 tests passed**（build GREEN）             |
| protocol / core / ui-kit | build GREEN                                               |

### 关键断言（runtime）

- 批准 memory 后 peek 含 project-memory
- amend 同时请求排除 task-goal + memory → 拒绝 goal、应用 memory
- 再 peek：memory 进入 excluded，goal 仍在，token 下降，evidence 清除
- clearAll 后 peek 恢复 memory

### 如何观察（UI）

1. Node 20：`SYNC_THINK_DEV_NO_TOKEN=1` → `pnpm dev:runtime` + `pnpm dev:desktop`
2. 打开任务 → 右侧 **Manifest** → **预览上下文**
3. 在「已纳入」中对非受保护来源点 **排除**（受保护显示「受保护」chip）
4. 顶部出现 **修订 N** 状态条；自动 re-peek 后可见来源移入「已排除」
5. 点 **恢复自动** → 修订清空 → 再 peek 恢复自动选择

### 备注

- M1 **仍不关闭**（外网 UI 手测 / dogfood 仍 open）
- 修订为 Runtime 进程内 thread 作用域；重启 Runtime 后清空（M1 soft）

---

## 2026-07-12 · context.packet.peek（只读预览 Packet/Manifest）

### 目标

在不启动模型 Run、不写入 durable `context.packet.built` 的前提下，用户可随时检查「下一次调用将带上的」Context Packet / Manifest（含项目记忆证据），并验证 §10.4 回滚后 peek 结果随之变化。

### 实现

1. **protocol**：`PeekContextPacketPayload/Response`；`DEFAULT_FEATURES` 加入 `context.packet.peek`
2. **runtime**：`handlePeekContextPacket` 复用 `prepareRunBinding` 选择路径，**不** append 事件、不启动 run
3. **ui-kit**：Manifest 头栏 **预览上下文** 按钮（`data-testid="manifest-peek"`），Continuum 简洁大气 pill
4. **desktop**：IPC `runtime:context-packet-peek` + preload/renderer；预览结果注入 `peek:live` Manifest 并自动选中

### 自测（Node 20）

| 包                                    | 结果                                                     |
| ------------------------------------- | -------------------------------------------------------- |
| @sync-think/runtime                   | **18 files / 55 tests passed**（含 context-packet-peek） |
| @sync-think/ui-kit                    | **10 files / 47 tests passed**（含 Manifest peek 按钮）  |
| @sync-think/desktop                   | **13 files / 64 tests passed**；build GREEN              |
| protocol / runtime / ui-kit / desktop | build GREEN                                              |

### 关键断言（runtime）

- peek 返回 packetId/proofHash/includedSources/tokenEstimate
- 无 memory 时无 project-memory
- approve memory 后 peek 含 project-memory + evidenceRefs
- rollback 后 peek 不再含该记忆
- 全程无 durable `context.packet.built`

### 如何观察（UI）

1. Node 20：`SYNC_THINK_DEV_NO_TOKEN=1` → `pnpm dev:runtime` + `pnpm dev:desktop`
2. 打开任务 → 右侧 **Manifest** → 点 **预览上下文**
3. 无需发消息即可看到 included / 记忆证据 / tok 估算
4. Memory 批准 → 再 peek → 见「项目记忆」；回滚 → 再 peek → 记忆消失

### 备注

- M1 **仍不关闭**（外网 UI 手测 / dogfood 仍 open）
- 外网 DNS 仍可能不可用；本项为 soft craft 可观测性闭环

---

> 每次自测后**追加**一条，不要改写历史。  
> 真源：`docs/superpowers/specs/2026-07-11-sync-think-product-design.md` 与 `docs/development/10-current-status.md`。

## 格式

```text
### YYYY-MM-DD HH:mm · 一句话标题
- 怎么测
- 结果：通过 / 失败
- 说明
- 下一步
```

---

### 2026-07-12 ? ??????????????

- ?????? product design ?5.3 / M1 ???? + ????? `10-current-status.md`
- ????????M0 ???M1 ???
- ???
  - ???Workspace IA?Conversation ?????Providers ??????? OpenAI ?? `GET /models` ????/??????? trace
  - ???`resolveModelBinding` ????chat/run ??? provider/model?? Fake ???OpenAI `call()` ???Context Packet/Manifest ?????????????????
  - secrets???/?????? SecureStore???/?????? key
- ????TDD ?????? ? OpenAI Chat ?? ? Runtime ?? ? ?????????

---

### 2026-07-12 · 模型绑定 + OpenAI 流式 + Manifest 事件

- 怎么测：
  1. `pnpm --filter @sync-think/core test`（绑定优先级 + Context Packet）
  2. `pnpm --filter @sync-think/adapters test`（SSE 流式 / 鉴权失败 scrub）
  3. `pnpm --filter @sync-think/runtime test`（含 binding-live：注册 model → SecureStore 取钥 → 适配器 call → Manifest 事件）
  4. `pnpm --filter @sync-think/desktop test` + typecheck
- 结果：通过
- 说明：
  - 绑定优先级 run > workflow > agent default > fallback（core 纯函数，无静默换模）
  - 每次 user 消息触发模型调用前写入 `context.packet.built`（含 proofHash / resolutionSource / providerModelId）
  - 有已注册 model + 密钥时走 live adapter；否则仍 Fake 演示流
  - 失败诊断消息 scrub，事件日志不落明文 key
  - UI trace 展示 Manifest / Run 启动来源
- 下一步：UI 可选模型下拉（发送时带 modelId）；Memory/Diagnostics；系统文件夹选择器；端到端用真实网关手测

---

### 2026-07-12 · Compose 模型选择器 + 发送 modelId

- 怎么测：
  1. `pnpm --filter @sync-think/ui-kit test`（Compose 12 项：下拉、agent default、run override 发送）
  2. `pnpm --filter @sync-think/desktop test`（compose-models 扁平 ≥2 providers / ≥3 models + build-assets）
  3. `pnpm --filter @sync-think/ui-kit build` + desktop typecheck/build
- 结果：通过
- 说明：
  - Compose 增加「本轮模型」选择器：Agent 默认（自动）或显式 modelId 作为 Run override
  - Desktop 从 Providers 目录生成选项；`task.appendMessage` 带 modelId
  - 可观测：summary 标签 run override | agent default；compose meta 显示 models 数 / override|auto
  - Runtime 侧既有绑定与 Manifest 事件已可消费该 modelId（resolutionSource=run-override）
- 下一步：真实网关同任务切换 ≥3 模型手测；Agent 持久化 default/fallback；Memory/Diagnostics

---

### 2026-07-12 · Agent 持久化绑定（default / fallback）+ 配置面板

- 怎么测：
  1. `pnpm --filter @sync-think/storage test`（agent-store 5 项：种子、不可变版本、拒绝空 default、toModelBinding）
  2. `pnpm --filter @sync-think/runtime test`（36 项，含 agent-commands：get/update 新版本、Run 走 store default）
  3. `pnpm --filter @sync-think/ui-kit test`（30 项，含 AgentBindingPanel 2 项）
  4. `pnpm --filter @sync-think/desktop test`（56 项）+ storage/protocol/runtime/ui-kit/desktop build
- 结果：全部通过
- 说明（大白话）：
  - Agent 的默认模型 / fallback 链写进 SQLite 的 `agent_version` 表；改一次就新增一版，旧版不覆盖（历史 Run 可回看）
  - Runtime 发消息时不再“随便拿目录前几个模型当 Agent 默认”，而是读 Agent 库；没有库时才退回演示逻辑
  - 协议新增 `agent.get` / `agent.updateBinding`；桌面左侧 Providers 下方有简洁 Agent 面板：默认模型、有序 fallback、无 fallback 时暂停
  - 可观测：保存后显示 `vN · default · fallback 数`；发消息不选本轮模型时 resolutionSource=agentDefault；选了本轮模型仍是 run override
  - 密钥仍然只在 SecureStore，Agent 绑定只存 modelId 引用
- 下一步：Memory/Diagnostics 流；系统文件夹选择器；真实网关同任务跨 ≥2 providers / ≥3 models 手测确认；可选 fallback 失败自动走下一档的运行时演示

### 2026-07-12 · Memory/Diagnostics 面板 + 系统文件夹选择器

- 怎么测：
  1. `pnpm --filter @sync-think/ui-kit test`（32 项，含 MemoryDiagnosticsPanel 2 项）
  2. `pnpm --filter @sync-think/desktop test`（58 项，含 memory-payloads + build-assets）
  3. `pnpm --filter @sync-think/runtime test`（38 项，含 memory-commands 2）
  4. `pnpm --filter @sync-think/storage test`（48 项，含 memory-store 5）
  5. ui-kit / desktop build 通过
- 结果：全部通过
- 说明（大白话）：
  - 左侧 Agent 下方新增 Memory 面板：显示已批准记忆条目、待审 MemoryChange（可点通过/拒绝）、最近诊断（已 scrub，无明文 key）
  - 桌面桥接：`memory.list` / `memory.decide` / `diagnostics.list` IPC + preload；Run 完成/失败/记忆事件会自动刷新
  - 创建工作区：系统文件夹对话框（`desktop:pick-folder`），不再只靠手敲绝对路径
  - 可观测：连接 Runtime 后可见记忆条数/待审数/诊断数；审批后状态条更新；诊断摘要含 `[REDACTED]` 不露密钥
- 下一步：真实网关同任务跨 ≥2 providers / ≥3 models 手测；可选 Anthropic Messages 专用 list/stream；不标 M1 完成直到退出标准有证据

### 2026-07-12 · Runtime 失败自动走 fallback 链（§5.3）+ 同任务多模型证据

- 怎么测：
  1. `pnpm --filter @sync-think/core test`（12 项，含 resolveModelBinding / shouldAttemptFallback）
  2. `pnpm --filter @sync-think/runtime test`（12 files / 42 tests，含 fallback-walk 4 项、demo-run 6 项）
- 结果：全部通过（Node 20.20.2）
- 说明（大白话）：
  - 以前：模型调用失败后 Runtime 直接 `run.failed`，不会自动试 Agent 配置的 fallback
  - 现在：失败分类属于可切换范围（timeout / rate-limit / auth / unknown / transient）时，按 Agent 有序 fallback 链解析下一个模型；发出可观测事件 `run.fallback.selected` + 新的 `context.packet.built`（resolutionSource=`agentFallback`），然后用**同一条用户消息上下文**继续 stream，用户不必重述任务
  - 没有 fallback 或链走完：发 `run.paused`（reason=`no_fallback_configured` / `fallback_exhausted`），**绝不静默换一个未配置的模型**
  - acceptance / permission 失败：不走 fallback，仍按原路径失败
  - 密钥：失败诊断与事件消息继续 scrub，测试确认无明文 key
  - 同任务 ≥2 providers / ≥3 models：自动化用例在同一 thread 上连续 3 次 run override（两个网关、三个模型），均完成且 adapter 调用顺序为 m1→m2→m3
- 可观测：
  - 事件：`run.fallback.selected`（from/to model、failureClass、fallbackIndex）
  - 事件：`run.paused`（链耗尽或未配置）
  - Manifest：`context.packet.built` 在 fallback 后刷新 modelId / resolutionSource
  - Diagnostics：终态 pause/fail 仍写 scrub 诊断
- 下一步：真实网关手测跨 ≥2 providers / ≥3 models 记入本日志；可选 Anthropic Messages adapter；**在退出标准有完整证据前不标 M1 完成**

---

### 2026-07-12 · Fallback/Pause 可观测 UI（Trace + Stream 状态）

- 怎么测：
  1. `pnpm --filter @sync-think/desktop test`（13 files / 60 tests，含 event-history 新增 2 项：fallback selection / run.paused）
  2. `pnpm --filter @sync-think/core test`（2 files / 12 tests）
  3. `pnpm --filter @sync-think/runtime test`（12 files / 42 tests，含 fallback-walk 4）
  4. 重建：`pnpm --filter @sync-think/ui-kit build` + `pnpm --filter @sync-think/desktop build`
  5. 启动：`pnpm dev:runtime` + `pnpm dev:desktop`（Node 20.20.2；Runtime pipe `sync-think-dev-0001` 已 hello accepted）
- 结果：全部通过；桌面已重启加载新 UI
- 说明（大白话）：
  - Runtime 早就有 `run.fallback.selected` / `run.paused` 事件；以前右侧 Trace 和顶部状态条几乎看不懂（只显示原始 type 或当成 recovery 糊过去）
  - 现在投影层会：
    - 在 fallback 后更新 assistant 的 modelId，并给出可读 notice：`Fallback · 旧模 → 新模 · failureClass`
    - 链耗尽/未配置时 stream 状态变为 **paused**（不是 completed，也不会假装成功）
    - Trace 文案：`Fallback 切换 · …`（category=model-call）与 `Run 暂停 · 无 fallback 配置|Fallback 链耗尽`（category=recovery）
    - Manifest 在 fallback 后仍会刷 `context.packet.built`（resolutionSource=`agentFallback`）
  - UI：状态条支持「已暂停」+ 警告色点；右侧 Run 摘要优先展示 fallback notice；Trace 分类轻微强调 recovery/model-call
- 可观测（用户怎么看）：
  1. 左侧 Agent 配 default + 有序 fallback
  2. 发消息后若主模型 timeout/限流/鉴权失败：右侧 Trace 出现 **Fallback 切换**，状态条 notice 显示 from→to，对话继续同一任务
  3. 若无 fallback 或链走完：状态条 **已暂停** + 原因，**不会静默换未配置模型**
- 下一步：真实网关手测同任务跨 ≥2 providers / ≥3 models 记入本日志；可选 Anthropic Messages adapter；**在退出标准有完整证据前不标 M1 完成**

---

### 2026-07-12 · 本地双 HTTP 真实网关集成证据（≥2 providers / ≥3 models + 跨网关 fallback）

- 怎么测：
  1. 新增 apps/runtime/tests/dual-http-gateway.test.ts：用 node:http createServer 起两个 OpenAI 兼容本地网关（真实 TCP/HTTP/SSE，非 FakeProvider）
  2. Runtime 不挂 demoProvider，只注入 OpenAIChatAdapter；密钥走 SecureStore
  3. pnpm --filter @sync-think/runtime test（Node 20.20.2）→ 13 files / 44 tests passed（含 dual-http 2 项）
- 结果：全部通过
- 说明（大白话）：
  - 同任务多模型 live 路径：同一 thread 上连续 3 次 run override，分别打到 GW-A 的 gw-a-mini / gw-a-large 与 GW-B 的 gw-b-pro；助手回复来自真实 SSE（ok-from:GW-*:…）；两个网关都收到正确 Bearer 与 model
  - 跨 provider 自动 fallback：主模型在网关 A 返回 429 rate-limit → 发 run.fallback.selected（failureClass=rate-limit, resolutionSource=agentFallback）→ 用同一条用户消息在网关 B 的 fallback 模型完成；spare 模型未调用
  - Manifest：context.packet.built 含 32 位 proofHash，runOverride / agentFallback 可区分
  - 密钥：事件 JSON 中无明文 sk；A/B 密钥互不串网关 body
- 可观测：
  - 网关侧：POST /v1/chat/completions 调用记录（model + Authorization）
  - 事件：run.fallback.selected / run.completed / context.packet.built
  - 断言 assistantText 含真实网关回包前缀
- 与外部公网关系：用户环境 www.kamenking.top 仍 DNS 失败，本轮证据是本地真实 HTTP 网关，强于 FakeProvider；外网手测仍建议在 DNS/密钥可用后再补
- 下一步：外网可用时手测 UI 路径并记本日志；可选 Anthropic Messages adapter；在退出标准有完整证据前不标 M1 完成

---

### 2026-07-12 · Anthropic Messages adapter + OpenAI/Anthropic 双协议本地 live 证据

- 怎么测：
  1. 修复 `packages/adapters/src/index.ts` 损坏导出（字面量反斜杠 n）
  2. Anthropic 适配器源码：`packages/adapters/src/anthropic/*`（stream-messages / discover-models / adapter + unit tests）
  3. `pnpm --filter @sync-think/adapters test` → 4 files / 29 tests
  4. `pnpm --filter @sync-think/adapters build` → tsc 通过
  5. Runtime 注册：`AnthropicMessagesAdapter` 在 `apps/runtime/src/main.ts` 的 `discoveryByProtocol`
  6. 新增 `apps/runtime/tests/dual-protocol-gateway.test.ts`（真 HTTP 网关：OpenAI SSE + Anthropic SSE）
  7. `pnpm --filter @sync-think/runtime test` → 14 files / 46 tests（含 dual-protocol 2 项 + dual-http 2 项）
- 结果：全部通过
- 说明（大白话）：
  - **Anthropic 真协议路径已通**：不是假 demo，而是适配器发 `x-api-key` + `anthropic-version: 2023-06-01`，吃 Anthropic 风格 SSE（content_block_delta / message_stop）
  - **同任务跨协议**：同一 thread 先打 OpenAI 兼容网关两个模型，再打 Anthropic 网关一个模型；assistant 回复来自真实 SSE 前缀 `ok-from:...`
  - **跨协议 fallback**：主模型 OpenAI 返回 429 → `run.fallback.selected`（failureClass=rate-limit, resolutionSource=agentFallback）→ Anthropic fallback 模型完成；用户原文无需重述
  - **密钥**：事件 JSON 无明文 sk；OpenAI 用 Bearer，Anthropic 用 x-api-key，互不串密钥到对方 body
  - **Manifest**：`context.packet.built` 含 32 位 proofHash；runOverride / agentFallback 可区分
- 可观测性：
  - 网关侧：POST /v1/chat/completions 与 POST /v1/messages 调用记录（model + 鉴权头）
  - 事件：run.fallback.selected / run.completed / context.packet.built
  - 断言 assistantText 含真实网关回包前缀
- 与外网关系：本机 DNS 仍无法解析公共 API；本轮证据是本地真实 TCP/HTTP/SSE 双协议，强于 FakeProvider
- 下一步：外网可用时 UI 手测 ≥2 providers / ≥3 models 记入本日志；**退出标准有完整证据前不标 M1 完成**

## 2026-07-12 · Manifest 可检查 UI（M1 退出标准 #3）

### 目标

每次模型调用可检查 Manifest（产品设计 §10.3）：不仅有 `context.packet.built` 事件，右侧轨还可打开纳入/排除来源、proofHash、token、绑定来源详情。

### 改动摘要

1. **投影** `apps/desktop/src/renderer/m0-projection.ts`
   - 新增 `ManifestView` / `manifests` / `latestManifest`
   - 从 `context.packet.built` 投影 packetId、proofHash、included/excluded、summaries、truncations、resolutionSource 等
   - 薄载荷（仅 id 列表）也可检查
2. **UI** `packages/ui-kit/src/components/ManifestPanel.tsx`
   - Continuum 风格检查面板：调用记录、proof、已纳入/已排除、摘要/截断
   - Trace 点击 Manifest 行联动选中（`TraceList.selectedId` + `onSelectItem`）
3. **Runtime** `apps/runtime/src/runtime.ts`
   - `context.packet.built` 补充 includedSources/excludedSources/summaries/truncations/crossTaskRefs
   - 不再把完整 `run` 对象塞进事件载荷（避免多余内部状态外泄）
4. **桌面接线** 右侧轨 Manifest 面板 + Trace 联动

### 自测结果（本机）

| 包                       | 结果                                                               |
| ------------------------ | ------------------------------------------------------------------ |
| @sync-think/desktop test | 13 files / **61** tests GREEN（含 inspectable Manifest 投影 1 项） |
| @sync-think/ui-kit test  | 10 files / **34** tests GREEN（含 ManifestPanel 2 项）             |
| @sync-think/runtime test | 14 files / **46** tests GREEN（dual-http + dual-protocol 仍绿）    |
| ui-kit build             | GREEN                                                              |
| desktop build            | GREEN                                                              |

### 如何在 UI 中观察

1. 启动 Runtime + Desktop（Node 20）
2. 打开任务并发送一条消息（可用已配置 Provider，或本地 fake）
3. 右侧轨上方出现 **Manifest** 面板：默认显示最近一次调用
4. 点击 Trace 中 `Manifest · …` 行可切换检查该次 packet
5. 可见 proof 短哈希、packetId、model、resolutionSource、纳入来源列表与 token 估算

### 仍未完成（不标 M1 完成）

- 外网真实网关 UI 手测（kamenking / api.openai.com / api.anthropic.com DNS 仍可能不可用）
- 退出标准 #1 的外网手测路径证据

### 结论

**M1 退出标准 #3（每次模型调用可检查 Manifest）自动化 + UI 接线已绿。** 不将整个 M1 标为完成。

---

## 2026-07-12 · Capability Probe 建议 + 用户确认（§7.2）端到端

### 目标

产品设计 §7.2：能力探测结果仅为**建议**，不可自动写死为事实；用户确认/编辑后才 `capabilitiesConfirmed=true`。
本轮把上一会话留下的 core/storage/runtime 能力探测接到 **UI + Desktop IPC 全链路**，并修掉测试语法问题。

### 白话说明

- 在 Providers 面板，每个模型旁可以看到能力标签芯片（文本 / 视觉 / 工具 / 生图 / 向量）。
- 标签默认是 **suggested**（建议），不是已确认事实。
- 点「探测能力」：Runtime 用本地启发式（模型 id + 协议）生成建议，写回库时 **永远不自动 confirmed**。
- 用户可点标签开关编辑，再点「确认」→ 调 `provider.confirmCapabilities`，变为 **confirmed**。
- 状态条会显示：探测了几个模型、建议标签样例、或确认后的标签列表。
- 事件 `provider.capabilities_probed` / `provider.capabilities_confirmed` **不带密钥**。

### 改动摘要

1. **UI** `packages/ui-kit`
   - `ProvidersPanel`：能力芯片、suggested/confirmed 徽标、探测按钮、确认/编辑
   - 修复芯片首次点击竞态（原子 draft toggle）
   - 修复测试文件误写在 `describe` 外导致的语法错误
2. **Desktop 接线**
   - `provider-payloads`：`parseProbeCapabilitiesPayload` / `parseConfirmCapabilitiesPayload`
   - main IPC：`runtime:provider-probe-capabilities` / `runtime:provider-confirm-capabilities`
   - preload + `global.d.ts` 桥
   - renderer：映射 `model.capabilities`；`probeProviderCapabilities` / `confirmProviderCapabilities`；事件刷新
3. **既有（本轮未改逻辑，仅接线）**
   - core `suggestCapabilities` / storage `updateModelCapabilities`
   - runtime handlers + `provider-commands` probe 测试

### 自测结果（本机 Node 20.20.2）

| 包                             | 结果                                                                   |
| ------------------------------ | ---------------------------------------------------------------------- |
| @sync-think/core test          | 3 files / **22** tests GREEN（含 capability-probe 10）                 |
| @sync-think/storage test       | 9 files / **49** tests GREEN                                           |
| @sync-think/runtime test       | 14 files / **47** tests GREEN（含 probe+confirm 1）                    |
| @sync-think/ui-kit test        | 10 files / **35** tests GREEN（ProvidersPanel 3，含 probe/confirm UI） |
| @sync-think/desktop test       | 13 files / **62** tests GREEN（payloads + build-assets）               |
| protocol / core / ui-kit build | GREEN（desktop tsc 依赖 ui-kit dist 后通过）                           |

### 如何在 UI 中观察

1. Node 20 PATH 优先后：`pnpm --filter @sync-think/desktop build` → `pnpm dev:runtime` → `pnpm dev:desktop`
2. 打开左侧 Providers，展开已有 Provider（需至少有模型；可先发现/手动添加）
3. 点 **探测能力** → 状态条出现「能力建议 · N 模型 · 启发式 · 待确认 · modelId[tags…]」
4. 模型行徽标为 **suggested**；芯片可点编辑后点 **确认** → 徽标变 **confirmed**，状态条「能力已确认 · …」
5. 密钥仍只出现在创建表单，列表始终遮罩

### 仍未完成（不标 M1 完成）

- 外网真实网关 UI 手测（DNS）
- M1 退出标准完整证据包

### 结论

**§7.2 Capability Probe「建议 → 用户确认」端到端（core → runtime → desktop UI）已绿。** 不将整个 M1 标为完成。

## 2026-07-12 · §5.4 凭据组 + 固定密钥（Credential group + pin）

### 目标

产品设计 §5.4：Agent 绑定 **凭据组**（不必钉死一把 key）；可 **pin** 精确凭据；Runtime 只能从所选组内取可用密钥；跨 provider 模型 fallback 时必须换到目标 provider 的密钥（不允许把 A 网关的 key 打到 B）。

### 白话说明

- 你在 Agent 面板里可以选「凭证组」，也可以再 pin 某一把密钥（UI 只显示 label/组名，**从不显示明文 key**）。
- 发消息时 Runtime 按优先级取钥：Run 覆盖 → pin → 组内第一把 → 目标 provider 主密钥。
- 若主模型挂了走 fallback 到另一个 Provider，**会自动换那一侧的密钥**；事件/Manifest 里只有 credentialRefId 与解析来源（如 providerPrimary），没有 sk- 明文。
- 本轮还修了上一会话 patch 误伤的 Desktop renderer：补回 createProvider / 发现模型 / 添加模型 / Memory 加载与审批，桌面才能真正导入与观测。

### 改动摘要

1. **core** `packages/core/src/credential-binding.ts`
   - 解析优先级 + **provider 亲和**：run/pin/group 若不属于目标 provider，则丢弃并落到该 provider 的 primary。
2. **storage** `getProviderIdForCredentialGroup` / group list / first / addCredentialRef。
3. **runtime** `resolveRunCredentialRef` 接入 group→provider 映射；`rebindRunToModel` 不再保留错误 provider 的旧 credentialRefId。
4. **可观测** `context.packet.built` 增加 `credentialRefId` + `credentialResolutionSource`；ManifestPanel 显示 credential 来源（仅 scrubbed id）。
5. **UI** AgentBindingPanel 组选择 + 可选 pin（既有）+ Desktop 接线修复。

### 自测结果（本机 Node 20.20.2）

| 包                                 | 结果                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| @sync-think/core test              | 4 files / **28** tests GREEN（含 credential-binding 6，含跨 provider 亲和 2）    |
| @sync-think/storage provider-store | **7** tests GREEN（含 getProviderIdForCredentialGroup）                          |
| @sync-think/runtime test           | 14 files / **48** tests GREEN（dual-http + dual-protocol fallback 密钥断言已绿） |
| @sync-think/ui-kit test            | 10 files / **36** tests GREEN                                                    |
| @sync-think/desktop test           | 13 files / **63** tests GREEN                                                    |
| ui-kit + desktop build             | GREEN                                                                            |

### 如何在 UI 中观察

1. Node 20 PATH 优先：`pnpm --filter @sync-think/desktop build` → `pnpm dev:runtime` → `pnpm dev:desktop`
2. 左侧 Providers：创建 Provider（密钥仅在创建表单出现）→ 发现/手动添加模型
3. Agent 绑定：选默认模型 + fallback；选凭证组；可选 pin 一把密钥 → 保存状态条显示「凭证组已绑 / 已固定密钥」
4. 发消息后右侧 Manifest：除 model resolutionSource 外，可见 **credential · providerPrimary|agentPin|… · ref xxxxxxxx**
5. 跨网关 fallback：Trace 出现 Fallback 行；Manifest 的 credential ref 应切换到 fallback provider（无明文 key）

### 仍未完成（不标 M1 完成）

- 外网真实网关 UI 手测（DNS：kamenking / 公网 API 可能仍不可用）
- M1 退出标准完整证据包汇总

### 结论

**§5.4 凭据组 + pin + 跨 provider 正确取钥已落地并通过自动化证据。** 整个 M1 仍不关闭。

## 2026-07-12 · M1 退出标准证据矩阵（软验收包 · 不关 M1）

### 目标

把 M1 退出标准 1–6 映射到已有自动化 / 本地 live 网关 / UI 路径，形成可复核证据包；**不**因本矩阵自动关闭 M1（外网真实网关 UI 手测与 dogfood 门仍开）。

### 白话说明

- 产品与计划要求：同一任务多模型、绑定优先级、每次调用可查 Manifest、主题+轨迹+文件夹任务、密钥不进明文、重启可恢复。
- 本机环境：公网 HTTPS 不稳定（OpenAI 可达但无密钥会 401；Anthropic DNS 仍可能 ENOTFOUND），因此以 **本地双 HTTP / 双协议 live + 单元/集成测试** 作为软证据；外网 UI 手测仍单独挂起。
- 本轮只做**证据汇总 + 文档勾选对齐 + 复跑验证**，不改业务代码。

### 退出标准证据矩阵

| #   | 退出标准                                             | 证据状态   | 自动化 / 本地 live 证据                                                                                                                                                                                                 | UI 可观测路径                                                                                                        | 缺口                                                                                |
| --- | ---------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | 同一任务 ≥2 providers / ≥3 models，无需重述上下文    | **软通过** | `dual-http-gateway.test.ts`（2 HTTP OpenAI 兼容网关 × 3 模型顺序 override）；`dual-protocol-gateway.test.ts`（OpenAI chat×2 + Anthropic messages×1）；`fallback-walk.test.ts`「≥3 models via sequential run overrides」 | Providers 配 ≥2 源 → Agent 绑 default+fallback → 同任务 Compose 选模连发；Trace 看多模型 run；**外网 UI 手测未完成** | 外网真实 baseURL 手测写入本日志                                                     |
| 2   | 绑定优先级 run > workflow > agent default > fallback | **通过**   | core `model-binding.test.ts`（precedence + pause/no silent swap）；runtime `fallback-walk.test.ts`（walk / exhausted pause / acceptance 不 fallback）；`agent-commands` 持久化绑定                                      | AgentBindingPanel 保存 default/fallback；Compose 本轮 override；Trace 出现 Fallback / Pause                          | workflow 节点覆盖在 M1 以 core 纯函数+事件为主（完整 workflow 图属 M2）             |
| 3   | 每次模型调用可检查 Manifest                          | **通过**   | core `context-packet.test.ts`；runtime live 断言 `context.packet.built` + proofHash；ui-kit `ManifestPanel.test.tsx`；desktop 投影 `ConversationProjection.manifests`                                                   | 发消息后右侧轨 Manifest：纳入/排除/proof/tokens/resolution/**credential 来源**；Trace 点选联动                       | 外网手测时再截图/记一次                                                             |
| 4   | 完整浅/深主题 + 可折叠轨迹 + 文件夹/任务 IA          | **通过**   | ui-kit `AppShell.test.tsx`（三栏 IA + collapse trace + theme attr）；`WorkspaceNav` / workspace-nav-model；desktop workspace payloads；theme tokens light/dark CSS                                                      | 顶栏浅/深/系统；右侧轨折叠；左侧 Workspace/Task 树创建打开搜索                                                       | 可选 a11y/空态 polish                                                               |
| 5   | 无明文 key 进 DB/日志/诊断/提示词/导出               | **通过**   | `secret-persistence.test.ts`（SQLite/WAL/backup 无明文）；secure-store 单测；discovery/stream 失败 scrub；dual-http/dual-protocol 事件无 sk-；credential 仅 ref + resolutionSource                                      | Providers 列表遮罩；创建表单一次性输入；Manifest 仅 credentialRef 前缀                                               | 外网手测时人工确认诊断面板                                                          |
| 6   | App 重启安全恢复对话与在途 stream                    | **软通过** | runtime `demo-run.test.ts` resume 无重复输出；`commands.test.ts` checkpoint restore task/event sequence；storage `runtime-state-store` reopen；desktop `event-history` 投影与 reconnect 订阅                            | 杀 UI 不杀 Runtime；Runtime 重启后历史+checkpoint 恢复；client 自动重订事件流                                        | **桌面整 App 冷启动** UI 手测（对话历史已投影；在途 live stream 依赖 Runtime 续跑） |

### 关联能力（非退出条目但 M1 workstream 已落地）

| 能力                                 | 证据                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| §5.4 凭据组 + pin + 跨 provider 取钥 | core credential-binding 6；provider-store；runtime rebind；Manifest credential 行 |
| §7.2 Capability Probe 建议→确认      | core suggest；runtime probe/confirm；ProvidersPanel 芯片                          |
| Memory / Diagnostics                 | memory-commands；MemoryDiagnosticsPanel；失败 scrub 诊断                          |
| OpenAI + Anthropic 适配              | adapters 单测；dual-protocol live                                                 |

### 本轮复跑（Node 20.20.2）

| 包                  | 结果                          |
| ------------------- | ----------------------------- |
| @sync-think/core    | 4 files / **28** tests GREEN  |
| @sync-think/runtime | 14 files / **48** tests GREEN |
| @sync-think/ui-kit  | 10 files / **36** tests GREEN |
| @sync-think/desktop | 13 files / **63** tests GREEN |

### 外网探测（本轮，非手测闭环）

- `api.openai.com` HTTPS GET /v1/models → **401**（可达、无密钥/未授权，符合预期）
- `api.anthropic.com` → **ENOTFOUND**（DNS 仍不稳）
- **结论**：不阻塞软证据包；外网 UI 手测仍 open

### 如何观察（本地）

1. Node 20 优先 PATH
2. `pnpm --filter @sync-think/desktop build` → `pnpm dev:runtime` → `pnpm dev:desktop`
3. 浅/深主题切换；创建工作区任务；Providers 本地兼容网关；Agent 绑定；发消息看 Manifest + Trace Fallback
4. 可选：杀 Electron 窗口 → Runtime 仍在 → 重开桌面看历史

### 仍未完成（**不标 M1 完成**）

1. 外网真实网关 **UI 手测** 写入本日志（≥2 baseURL / fallback / Trace+Manifest）
2. 可选：桌面冷启动 UI 确认在途 stream 观感
3. Internal dogfood ≥3 天（计划门，非代码门）
4. 用户或外网证据齐备前 **不关闭 M1**

### 结论

**M1 退出标准 1–6 的软证据矩阵已落档并通过关键包复跑。** 标准 1/6 标「软通过」（本地 live + 自动化充分，缺外网/整 App UI 手测）。整个 M1 **保持 open**。

## 2026-07-12 · 退出标准 6 加强：多轮对话冷恢复 + 空态可观测

### 目标

在外网 DNS 仍不可用时，继续推进 M1：把退出标准 6（App 重启恢复对话与在途 stream）从「软证据」再加厚一层自动化，并提升对话空态的恢复可观测性。**仍不关闭 M1。**

### 白话说明

- 以前：有单次 demo run 的 checkpoint 续跑、taskVersion 恢复；Desktop 也有事件合并与 reconnect。
- 现在补上：**多轮用户问答**在 Runtime 进程彻底重启后，仍从同一 SQLite 恢复两条用户消息 + 两次完成 run + Manifest，并能用 taskVersion=2 **继续第三轮**，无需重述上下文。
- Desktop 侧新增：冷启动「空 state + connect snapshot」投影出完整四气泡对话与 2 条 Manifest（含 credential 解析来源，无明文 key）。
- 对话空态 UI：连接中/离线/就绪 文案不同，并显示三项检查点（Runtime 连接、任务打开、事件历史条数）。

### 改动摘要

1. **新增** `apps/runtime/tests/conversation-restore.test.ts`
   - 两进程：先 2 轮 FakeProvider 完成 → stop → 同 DB 再起 → 断言历史完整 → 第 3 轮 append 成功
2. **新增** desktop `event-history` 冷启动投影用例（connect-succeeded snapshot）
3. **UI** 空态 `conversation-empty`：connecting/offline/ready 文案 + steps 检查点 + 轻量视觉（reduced-motion 安全）

### 自测结果（本机 Node 20.20.2）

| 包                        | 结果                          |
| ------------------------- | ----------------------------- |
| conversation-restore 单测 | **1** GREEN                   |
| event-history             | **14** GREEN（含冷启动 1）    |
| @sync-think/runtime 全量  | 15 files / **49** tests GREEN |
| @sync-think/desktop 全量  | 13 files / **64** tests GREEN |
| desktop build             | 见本轮 build 日志             |

### 如何在 UI 中观察

1. `pnpm --filter @sync-think/desktop build` → `pnpm dev:runtime` → `pnpm dev:desktop`
2. 未选任务 / 连接中：中间空态标题变为「正在从 Runtime 恢复事件流…」或「左侧添加…」，下方三行检查点
3. 打开任务后发两轮消息 → 可关桌面（Runtime 仍在）或冷启 Runtime 后重开桌面，历史应回放
4. 右侧 Manifest 仍可见 credential 来源（无 sk- 明文）

### 仍未完成（不标 M1 完成）

- 外网真实网关 UI 手测（DNS：openai/anthropic/kamenking 本轮仍 ENOTFOUND）
- dogfood ≥3 天
- 用户明确决策或外网证据齐备前 **不关闭 M1**

### 结论

**退出标准 6 的多轮对话冷恢复自动化证据已补齐；空态恢复可观测 polish 已落地。** 整个 M1 保持 open。

## 2026-07-12 · Soft M1：受保护上下文预算 + 键盘可观测

### 目标

外网 DNS 仍不可用（openai / anthropic / httpbin 本轮探测 ENOTFOUND）。继续推进 M1 soft craft：落实设计 §20.9「目标 / 决策 / 验收标准不得静默删除」，并补齐 §15.4 键盘导航与可观测快捷键。**仍不关闭 M1。**

### 白话说明

1. **Context 预算选择器**：新增 `selectContextSources`。token 溢出时先挤掉可压缩摘录（消息/文件），**永远不静默丢掉** task-goal / acceptance-criteria / decision / constraint；必要时对 message-excerpt 做软截断并写入 Manifest truncations。
2. **Runtime 装配**：每次模型调用会按 thread 找回任务，把 goal / status / acceptance 作为候选源进入 Packet；Manifest 可看到这些纳入项。
3. **键盘**：Compose `Ctrl/Cmd+Enter` 发送、流式时 `Esc` 取消；AppShell `Ctrl/Cmd+\\` 折叠轨迹。Compose 与 Trace 头、对话空态均有 kbd 提示条（简洁大气、reduced-motion 安全）。

### 改动摘要

| 层      | 路径                                                                                     |
| ------- | ---------------------------------------------------------------------------------------- |
| core    | `packages/core/src/context-packet.ts`：`PROTECTED_SOURCE_KINDS` + `selectContextSources` |
| storage | `getTaskByThreadId`                                                                      |
| runtime | `buildProtectedContextSelection` 接入 prepare / rebind / fallback Manifest               |
| ui-kit  | Compose 快捷键 + hint；AppShell 轨迹快捷键 + hint                                        |
| desktop | 空态快捷键条 `desktop-shortcut-strip`                                                    |

### 自测结果（Node 20.20.2）

| 包                                                | 结果                                                     |
| ------------------------------------------------- | -------------------------------------------------------- |
| @sync-think/core                                  | 4 files / **34** tests GREEN（+6 受保护上下文）          |
| @sync-think/storage                               | 9 files / **51** tests GREEN（+1 thread 映射）           |
| @sync-think/runtime                               | 15 files / **49** tests GREEN                            |
| @sync-think/ui-kit                                | 10 files / **40** tests GREEN（+Compose 3 + AppShell 1） |
| @sync-think/desktop                               | 13 files / **64** tests GREEN                            |
| desktop / runtime / ui-kit / core / storage build | GREEN                                                    |

### 如何在 UI 中观察

1. Node 20 优先 PATH：`pnpm --filter @sync-think/desktop build` → `pnpm dev:runtime` → `pnpm dev:desktop`
2. 对话空态底部胶囊：`Ctrl+Enter` / `Esc` / `Ctrl+\\`
3. Compose 左下角 kbd 提示；Trace 标题旁 `Ctrl\\` 提示
4. 打开带 goal 的任务发消息 → 右侧 Manifest 纳入列表应含「任务目标」等（无 sk- 明文）

### 仍未完成（不标 M1 完成）

- 外网真实网关 **UI 手测**（DNS）
- dogfood ≥3 天
- 用户明确决策或外网证据齐备前 **不关闭 M1**

### 结论

**受保护上下文 + 键盘可观测 soft craft 已落地并通过复跑。** 整个 M1 保持 open。

## 2026-07-12 · Soft M1：显式跨任务引用（§10.1）+ 子任务创建/可观测

### 目标

在外网 DNS 仍不可用时，继续推进 M1 soft craft：落实设计 §10.1「跨任务内容仅经显式引用或权限进入上下文」，并补齐左侧任务树「创建子任务」与右侧 Manifest「跨任务引用」可观测 UI。**仍不关闭 M1。**

### 白话说明

1. **显式父边**：只有子任务带 `parentTaskId` 且能解析到父任务时，才把父任务目标/验收摘要写入 Context Packet 的 `crossTaskRefs` 与 `includedSources`（kind=`cross-task-ref`）。
2. **永不发明引用**：根任务、无父边、父任务缺失 → 空 `crossTaskRefs`，不从兄弟任务抓取。
3. **Runtime 装配**：`buildProtectedContextSelection` 读父任务 → `resolveCrossTaskRefs` → prepare/rebind/fallback 路径的 Packet 均携带。
4. **UI**：WorkspaceNav 任务行 `+` 创建子任务；Manifest 独立区块「跨任务引用」+ proof chip；skip-link 跳到主对话（`#st-main-conversation`）。

### 改动摘要

| 层           | 路径                                                                               |
| ------------ | ---------------------------------------------------------------------------------- |
| core         | `packages/core/src/context-packet.ts`：`resolveCrossTaskRefs` + 类型               |
| runtime      | `apps/runtime/src/runtime.ts`：父任务注入 protected selection / Packet             |
| runtime test | `apps/runtime/tests/cross-task-context.test.ts`（binding-live 风格，15s）          |
| ui-kit       | ManifestPanel 跨任务区；WorkspaceNav 子任务 + skip-link；AppShell 主区 id/tabIndex |
| desktop      | `createTask({ parentTaskId })` + `onCreateChildTask` 接线                          |

### 自测结果（本机 Node 20.20.2，PATH 优先 20.x 避免 better-sqlite3 ABI 137 冲突）

| 包                  | 结果                                                    |
| ------------------- | ------------------------------------------------------- |
| @sync-think/core    | 4 files / **38** tests GREEN（含 resolveCrossTaskRefs） |
| @sync-think/runtime | 16 files / **51** tests GREEN（+cross-task 2）          |
| @sync-think/ui-kit  | 10 files / **43** tests GREEN                           |
| @sync-think/desktop | 13 files / **64** tests GREEN                           |
| desktop build       | 本轮重建                                                |

### 如何在 UI 中观察

1. Node 20 优先：`pnpm --filter @sync-think/desktop build` → `pnpm dev:runtime` → `pnpm dev:desktop`
2. 左侧任务行悬停/聚焦后点 **+** → 创建子任务（挂在父任务下）
3. 在子任务发消息 → 右侧 Manifest 出现 **跨任务引用** 区块与 proof chip（无 sk- 明文）
4. 键盘：`Tab` 可见 skip-link「跳到对话」→ 主对话区 `#st-main-conversation`

### 仍未完成（不标 M1 完成）

- 外网真实网关 **UI 手测**（DNS/代理仍不稳）
- dogfood ≥3 天
- 用户明确决策或外网证据齐备前 **不关闭 M1**

### 结论

**§10.1 显式跨任务引用端到端（core + runtime 事件 + UI 可观测）已落地并通过复跑。** 整个 M1 保持 open。

## 2026-07-12 · Soft M1：项目记忆注入 Context Packet / Manifest（§10.1 层2 · §10.3）

### 目标

在外网 DNS 仍不可用时，继续 M1 soft craft：把 **已批准/活跃的 durable project memory** 装配进受保护上下文选择与 Context Packet，并在右侧 Manifest 展示 **项目记忆** 来源与 **记忆证据** 区块。**仍不关闭 M1。**

### 白话说明

1. **装配规则**：Runtime 从 memory store 列出 active 条目 → core `resolveProjectMemorySources`（scope 优先级 task > project > global，默认最多 8 条，密钥片段 `sk-…` 脱敏为 `[redacted]`）。
2. **Packet / Manifest**：纳入源 kind=`project-memory`；Manifest 携带 `evidenceRefsForMemory`；事件 `context.packet.built` 同步透传（无明文密钥）。
3. **UI 可观测**：Manifest proof 区显示「记忆证据 N 条」；独立折叠区列出证据 id + 摘要；纳入列表 kind 显示为「项目记忆」。
4. **类型收口**：`prepareRunBinding` 返回类型补齐 `evidenceRefsForMemory`；`ManifestInspectView` 同步字段，修复记忆区误嵌在跨任务条件内的 JSX。

### 改动摘要

| 层           | 路径                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| core         | `packages/core/src/context-packet.ts`：`resolveProjectMemorySources` + `buildContextPacket.evidenceRefsForMemory` |
| runtime      | `apps/runtime/src/runtime.ts`：protected selection + prepare/rebind/fallback 注入                                 |
| runtime test | `apps/runtime/tests/project-memory-context.test.ts`                                                               |
| ui-kit       | `ManifestPanel` 记忆证据区 + proof chip；组件样式微抛光                                                           |
| desktop      | projection / renderer 透传 `evidenceRefsForMemory`                                                                |

### 自测结果（本机 Node 20.20.2，PATH 优先 20.x）

| 包                               | 结果                                                       |
| -------------------------------- | ---------------------------------------------------------- |
| @sync-think/core                 | 4 files / **43** tests GREEN                               |
| @sync-think/runtime              | 17 files / **53** tests GREEN（含 project-memory-context） |
| @sync-think/ui-kit               | 10 files / **44** tests GREEN（+memory evidence）          |
| @sync-think/desktop              | 13 files / **64** tests GREEN                              |
| runtime / ui-kit / desktop build | GREEN                                                      |

### 如何在 UI 中观察

1. Node 20 优先：`pnpm --filter @sync-think/desktop build` → `SYNC_THINK_DEV_NO_TOKEN=1 pnpm dev:runtime` → `pnpm dev:desktop`
2. Memory 面板批准一条项目记忆（或沿用自动 digest 批准）
3. 在同一任务发消息 → 右侧 Manifest：
   - 已纳入列表出现 **项目记忆**
   - proof 区 **记忆证据 N 条**
   - 折叠区 **记忆证据** 列出 ref + 摘要（无 sk- 明文）

### 仍未完成（不标 M1 完成）

- 外网真实网关 **UI 手测**（DNS/代理仍不稳）
- dogfood ≥3 天
- 用户明确决策或外网证据齐备前 **不关闭 M1**

### 结论

**项目记忆 → Context Packet / Manifest 证据链 soft craft 已落地并通过复跑。** 整个 M1 保持 open。

## 2026-07-12 · Soft M1：Memory 回滚可逆（§10.4）

### 目标

设计真源 §10.4「Every version remains reversible」：已批准 MemoryChange 可一键回滚，并恢复上一版本条目；UI 可观测。

### 白话说明

1. **存储**：批准时改为版本保留（停用旧 active + 插入新行）；`rollbackChange` 仅接受 `approved`，停用本变更写入的条目，恢复最近未回滚前驱版本，并将变更标为 `rolled_back`。
2. **协议/Runtime**：`memory.rollback` + 事件 `memory.change.rolled_back`；DEFAULT_FEATURES 含 rollback。
3. **桌面桥**：IPC `runtime:memory-rollback` → preload `rollbackMemory` → renderer 状态条 + 刷新。
4. **UI**：Memory 面板新增 **变更历史**（已通过/已拒绝/已回滚）；仅「已通过」显示 **回滚** 按钮（`memory-rollback-{id}`）。

### 改动摘要

| 层       | 路径                                                                                       |
| -------- | ------------------------------------------------------------------------------------------ |
| storage  | `memory-store.ts`：`rolled_back`、版本保留 apply、`rollbackChange`（前驱排除已回滚变更）   |
| protocol | `memory.rollback` CommandType、Rollback* 类型、ListMemory 含 rolled_back、DEFAULT_FEATURES |
| runtime  | `handleRollbackMemory` + memory-commands 集成测试                                          |
| ui-kit   | `MemoryDiagnosticsPanel` 变更历史 + 回滚按钮与样式                                         |
| desktop  | main/preload/renderer 接线；payload 解析测试                                               |

### 自测结果（本机 Node 20.20.2）

| 包                                                    | 结果                                               |
| ----------------------------------------------------- | -------------------------------------------------- |
| @sync-think/storage                                   | 9 files / **52** tests GREEN（含 §10.4 回滚恢复）  |
| @sync-think/runtime                                   | 17 files / **54** tests GREEN（+rollback 命令）    |
| @sync-think/ui-kit                                    | 10 files / **45** tests GREEN（+history/rollback） |
| @sync-think/desktop                                   | 13 files / **64** tests GREEN                      |
| protocol / storage / runtime / ui-kit / desktop build | GREEN                                              |

### 如何在 UI 中观察

1. Node 20 优先：`pnpm --filter @sync-think/desktop build` → `SYNC_THINK_DEV_NO_TOKEN=1 pnpm dev:runtime` → `pnpm dev:desktop`
2. 左侧 Memory：**待审变更** → 通过；**变更历史** 出现「已通过」与 **回滚**
3. 点 **回滚** → 状态条「已回滚 Memory 变更 · … · 恢复上一版本」；持久记忆恢复前值；历史项变为「已回滚」
4. 再发消息：Manifest「项目记忆 / 记忆证据」应反映回滚后的 active 集（不含已回滚事实）

### 仍未完成（不标 M1 完成）

- 外网真实网关 **UI 手测**（DNS 仍不稳）
- dogfood ≥3 天
- 用户明确决策或外网证据齐备前 **不关闭 M1**

### 结论

**Memory §10.4 可逆回滚 soft craft 已落地并通过复跑。** 整个 M1 保持 open。

## 2026-07-12 · Soft M1：Manifest 版本可观测（§10.3 Agent / Skill / Policy）

### 目标

设计真源 §10.3 Manifest 记录「Agent、Skill、policy versions」。在 peek 与 `context.packet.built` 路径贯通版本元数据，UI proof 区可检查；Skill 中心导入仍属后续（M1 soft 先可观测空 allowlist）。

### 白话说明

1. Runtime 从 AgentVersion 记录读取 `version` / `skillVersionIds` / `policyId`，写入 prepare 结果。
2. `context.packet.peek` 响应与 `context.packet.built` 事件载荷携带上述字段。
3. Desktop 投影与 re-peek 映射到 Manifest；proof 区显示 agent vN、skills 数、policy。
4. 同时修复上一会话遗留：`@sync-think/runtime` tsc 构建错误（AmendContextPacketPayload 导入 + amend handler 类型）。

### 改动摘要

| 层          | 路径                                                                      |
| ----------- | ------------------------------------------------------------------------- |
| protocol    | `PeekContextPacketResponse` + agentVersion / skillVersionIds / policyId   |
| runtime     | `resolveAgentManifestMeta`；prepare / peek / packet.built / fallback 贯通 |
| ui-kit      | Manifest proof：agent / skills / policy testids                           |
| desktop     | m0-projection + renderer peek 映射；状态条含 skills 数                    |
| runtime fix | command-validation 导入；amend requested: string[]                        |

### 自测结果（本机 Node 20.20.2）

| 包                                                 | 结果                                                        |
| -------------------------------------------------- | ----------------------------------------------------------- |
| @sync-think/core                                   | 4 files / **47** tests GREEN                                |
| @sync-think/runtime                                | 19 files / **56** tests GREEN（含 peek skillVersionIds=[]） |
| @sync-think/ui-kit                                 | 10 files / **51** tests GREEN（+versions 元数据）           |
| @sync-think/desktop                                | 13 files / **64** tests GREEN                               |
| protocol / core / runtime / ui-kit / desktop build | GREEN                                                       |

### 如何在 UI 中观察

1. Node 20 优先：`SYNC_THINK_DEV_NO_TOKEN=1 pnpm dev:runtime` → `pnpm dev:desktop`
2. 打开任务 → 右侧 **Manifest** → **预览上下文**
3. proof 区可见：
   - **agent** · `vN · <id前缀>`（有 Agent 存储时）
   - **skills** · `none` 或 `N · id…`（M1 默认真空 allowlist）
   - **policy** · `default` 或 policyId 前缀
4. 状态条示例：`预览完成 · agent v1 · skills 0 · ~tok …`
5. 发送消息后，调用记录里的 Manifest 同样带版本字段（packet.built）

### 仍未完成（不标 M1 完成）

- 外网真实网关 **UI 手测**（DNS 仍不稳）
- dogfood ≥3 天
- Skill 导入 / 非空 allowlist 绑定 UI（属后续切片，非本轮关闭条件）
- 用户明确决策或外网证据齐备前 **不关闭 M1**

### 结论

**Manifest §10.3 版本元数据 soft craft 已落地并通过复跑；runtime tsc 阻塞已解除。** 整个 M1 保持 open。

- TDD RED：M1 workspace disclosure 缺失；GREEN：`m1-obs-layout` **7/7**
- TDD RED：WorkspaceNav `hideReadiness` 未生效；GREEN：WorkspaceNav **14/14**
- TDD RED：混合内存/持久事件 replay `[1,2,3,1]`；GREEN：MCP 定向 + Runtime 全量 **22 files / 71 tests**
- TDD RED：同毫秒反向 ID 任务顺序 Child→Root；GREEN：workspace-store **7/7**
- 根级：`pnpm test` **20/20 tasks · 707 tests**；`pnpm typecheck` **20/20**；`pnpm build` **11/11**
- `pnpm selftest:m1-soft:quick`：**GREEN**，明确 `claimsM1Closed=false`
- 真实 Runtime replay：`highWatermark=7`，序列 `1..7`，`monotonic=true`
- Electron：1427×894 折叠/展开截图通过；干净重启 stderr 为空；Runtime/Provider/任务/Compose 恢复
- 结论：自动化与本机 UI 可测；外网 0/18、dogfood 0/3 仍未完成，M1 open
