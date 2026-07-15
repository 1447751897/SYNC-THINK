## 本轮进度：2026-07-12 · 第 64 次 soft craft · 左栏工具抽屉 + 发现模型错误中文化（soft · M1 仍 open）

### 大白话
- 左侧以前把任务树、四张工具 tab、Runtime 标题和 Provider 卡片全塞在一条窄栏里。现在左栏默认只剩任务树，底部四个图标按需打开临时抽屉。
- 抽屉盖在中间区域上方，不推挤聊天；同一时间只会有一个。再点当前图标、点遮罩、点关闭或按 Esc 都能收起。
- “发现模型”的英文红框表示 Runtime 连网失败。当前地址 `www.kamenking.top` 连 DNS 都解析不到，所以请求还没有到 API Key 校验。
- 以后同类错误直接显示中文排查项：Base URL、DNS、代理/TLS、网关在线、`/models` 与可能的 `/v1`。

### 你现在能测
1. 默认左栏只显示文件夹/任务树、四个工具图标和 Runtime 一行。
2. 依次点击模型源、Agent、记忆、审批，确认同一抽屉原位替换。
3. 用同按钮、Esc、右上关闭和页面遮罩分别关闭。
4. 在抽屉内滚动 Provider/Agent 长内容，确认任务树和页面网格不跟着抖动。
5. 点击“发现模型”，确认网络失败显示中文，而不是 `Error invoking remote method...`。

### 自测
| 项 | 结果 |
|---|---|
| Desktop | 39 files · 261 tests GREEN |
| UI Kit | 14 files · 177 tests GREEN |
| root test | 20/20 tasks · 715 tests GREEN |
| root typecheck / build | 20/20 · 11/11 GREEN |
| M1 quick soft | GREEN · claimsM1Closed=false |
| M1 硬门槛 | 外网 0/18 · dogfood 0/3 · 仍 open |

---

## 本轮进度：2026-07-12 · 第 63 次 soft craft · 页面减负 + Runtime 恢复（soft · M1 仍 open）

### 大白话
- 页面最挤的原因不是三栏，而是聊天上方常驻了四大块 M1 验证面板。现在它们收进一条 **M1 验证** 状态栏，默认只占一行；点开才显示完整验证工作台。
- 右侧不再展示“布局就绪/可检查/可观察”这类开发自检卡，直接显示 Run、Manifest 和事件；左侧直接显示文件夹树和当前仪器。
- 同时修掉了会让页面显示“Runtime 协议错误”的真实问题：事件序列曾出现重复 6/7，现在恢复为严格递增。
- 仍然没有完成外网手测和三天 dogfood，所以 **M1 不能关，M2 不能开**。

### 你现在能测
1. 点顶部 **M1 验证**：完整硬门槛/下一步/外网/退出路径展开；再点一次收起。
2. 左侧切换 **模型源 / Agent / 记忆 / 审批**：一次只显示一个仪器。
3. 选择 `Skill body packet smoke`，确认中间对话、模型 chips、Compose 与右侧事件都可见。
4. 点右上轨迹折叠按钮：中心扩展，Run 不暂停；再次点开恢复。
5. 重启 Desktop 后确认 Runtime 在线、Provider 2 个/模型 3 个、任务仍恢复。

### 还不能算完成的测试
- 真实外网网关 UI 清单仍是 **0/18**，必须按 `14-external-gateway-handtest.md` 使用真实 Provider 手工勾选。
- dogfood 仍是 **0/3 真实天**，草稿、脚手架和自动化不计数。

### 自测
| 项 | 结果 |
|---|---|
| root test | 20/20 tasks · 707 tests GREEN |
| root typecheck | 20/20 GREEN |
| root build | 11/11 GREEN |
| M1 quick soft | GREEN · M1 open |
| Electron 1427×894 | 折叠/展开/重连通过 |

---

## 本轮进度：2026-07-12 · 第 62 次 soft craft · 左侧仪器切换（一页一仪器）+ Skill 导入可感知（soft · M1 仍 open）

### 大白话
- 做了什么：左侧以前把 **Providers / Agent / 记忆 / 审批** 全堆在一起，特别挤，导入错误也容易被盖住。现在改成：
  1. 上面仍是 **文件夹树**
  2. 中间一条 **仪器切换 tab**（模型源 / 绑定 / 记忆 / 审批）
  3. **一次只开一个仪器面板**（其它隐藏）
- Skill 导入：必须完整 SKILL.md（`---` + `name:` + `---` + 正文）。加了 **「填入示例」**；格式错会用**红色中文**在导入区旁提示；失败时草稿保留。
- 测了啥：left-instrument-switch **3/3** · hardgate **8/8** · typecheck/build GREEN · soft full（含 dual）**GREEN** · Electron 重启 PID **17820**
- 不会怎样：不自动勾手测、不写 dogfood、不关 M1、不开 M2；**不是** CC Switch 批量导入 providers。
- 还差啥：外网手测 **0/18** + 真实 dogfood **≥3 天**（硬门槛，得你做）。

### 怎么验证（你现在就能点）
1. 看左侧：只有「树 + 4 个 tab + 当前一块面板」，不再四块叠在一起。
2. 点 **Agent** tab → 滚到 Skills → **填入示例** → **导入 SKILL.md** → 列表应出现 `minimal-demo`。
3. 故意贴一段纯中文（无 `---`）→ 应出现红色错误，草稿还在。
4. Provider 仍是手动填 name/baseURL/key；不是「一键导入一堆 provider」。

### 可观测
- softCraftRound **62**
- `data-testid="left-instrument-switch"` / `left-inst-providers|agent|memory|approvals`
- `data-testid="skill-error"` / `agent-skill-sample` / `agent-skill-import-btn`
- 模块：`left-instrument-switch.ts`

### 自测
| 项 | 结果 |
|---|---|
| left-instrument-switch.test.ts | 3/3 GREEN |
| m1-hardgate-strip.test.ts | 8/8 GREEN |
| typecheck / build | GREEN |
| soft full (+ dual) | GREEN |
| Electron 重启 | PID 17820 |

---

## 本轮进度：2026-07-12 · 第 61 次 soft craft · M1 硬门槛进度条（主路径轨顶部）（soft · M1 仍 open）

### 大白话
- 做了什么：右侧主路径最上方加了 **硬门槛** 进度条：外网手测 **0/18** + dogfood **0/3** 两根表；有主 CTA（聚焦下一外网项 / 打开手测 / dogfood 等）。**永远不自动关 M1**。
- 你会看到：主路径轨顺序变成 **硬门槛 → 下一步 → 下一外网项 → 退出路径**；硬门槛上有百分比条和按钮。
- 测了啥：hardgate 单测 **8/8**；与 #62 一起 typecheck/build/soft full **GREEN**；Electron PID **17820**。
- 不会怎样：不自动勾 14- 文档、不写 dogfood 盘、不关 M1。
- 还差啥：硬门槛数字要靠你真实做外网手测和 dogfood 才会涨。

### 可观测
- softCraftRound **61**（模块默认）/ UI 链路 **62**
- `data-testid="m1-hardgate-strip"` / `m1-hardgate-meters` / `m1-hardgate-meter-handtest|dogfood`
- 模块：`m1-hardgate-strip.ts`

---

## 本轮进度：2026-07-12 · 第 60 次 soft craft · 观测布局减负（主路径轨 + 更多 soft 观测折叠）（soft · M1 仍 open）

### 大白话
- 做了什么：界面右侧 M1 观测区以前「全部挤在一摞」，现在拆成两层：
  1. **主路径轨**（始终展开）：**下一步 → 下一外网项 → 退出路径**
  2. **「更多 soft 观测」**（默认折叠）：会话就绪、退出证据、证据包、dogfood 补填/天数、soft 回归、手测对照、文档差异、分区板等
- 你会看到：金色/蓝色主路径卡片在最上面；下面一条可点的「更多 soft 观测 · …」摘要；点开才展开一长串次要面板。点主路径 CTA 闪主路径；点需要次要面板的跳转时会**自动展开**折叠区再闪目标。
- 测了啥：obs-layout 单测 **7/7** · next 17 · exit-path 15 · external-focus 9 · evidence 11 · typecheck/build GREEN · soft full（含 dual）**GREEN** · Electron 重启 PID **61620**
- 不会怎样：不自动勾 14- 手测文档、不写 dogfood 盘、不关 M1、不开 M2、密钥不进仓库。
- 还差啥：外网手测 **0/18** + 真实 dogfood **≥3 天**（硬门槛，得你做）。布局已减负，主路径可观测性更好。

### 可观测
- softCraftRound **60**
- `data-testid="m1-obs-layout"` / `m1-obs-primary` / `m1-obs-secondary`
- 主路径顺序：next → external-focus → exit-path
- 次要：`m1-obs-secondary` details，`data-secondary-open`
- flash 次要 testid 时自动 `setM1ObsSecondaryOpen(true)`
- 模块：`m1-obs-layout.ts` · 测试：`tests/m1-obs-layout.test.ts`

### 自测
| 项 | 结果 |
|---|---|
| m1-obs-layout.test.ts | 7/7 GREEN |
| m1-next / exit-path / external-focus / evidence | 17+15+9+11 GREEN |
| typecheck / build | GREEN |
| soft full (+ dual) | GREEN |
| Electron 重启 | PID 61620 |

---


## 第 59 次 · 2026-07-12 · soft craft · 下一步/退出路径/证据包合入外网聚焦（soft · M1 仍 open）

### 大白话
- 做了啥：把第 58 次的「下一外网项」聚焦条，接到顶部「下一步」主按钮、退出路径第一步、证据包一键导出里。softCraftRound 变成 **59**。
- 你会看到：
  1. **下一步条**标题像「下一外网项 · B · …」，主按钮是「跳到相关面板」或「打开外网聚焦」（金色边）。
  2. **退出路径**多一步 `external-focus-assist`（金色左边条），在逐项外网步前面。
  3. **导出证据包**摘要带「含外网聚焦」，正文有「## 外网聚焦运行单」。
- 测了啥：next-action **17/17** · exit-path **15/15** · evidence **11/11**；typecheck/build GREEN；soft full（含 dual）**GREEN**；Electron 重启 PID **14100**。
- 不会怎样：不自动勾 14- 手测文档、不写 dogfood 盘、不关 M1、不开 M2、密钥不进仓库。
- 还差啥：外网手测 **0/18** + 真实 dogfood **≥3 天**（硬门槛，得你做）。页面仍偏挤，下一步可做布局收口。

### 可观测
- softCraftRound **59**
- next CTA：`focus-external` / `jump-external-item` / `copy-external-runsheet`
- 退出路径：`data-testid="m1-exit-path-step-external-focus-assist"` / `data-kind="external-focus"`
- 证据包：`含外网聚焦` · 包内 `## 外网聚焦运行单`
- 聚焦条仍在：`data-testid="m1-external-focus"`

---

## 本轮进度：2026-07-12 · 第 58 次 soft craft · 手测「下一外网项」聚焦条（soft · M1 仍 open）

### 大白话
- 做了什么：在手测对照区上方加了一块 **「下一外网项」** 聚焦条。它按 18 项清单顺序，自动挑出**第一个还没过的外网项**（通常是「同任务切换 ≥3 模型」），告诉你分区、怎么做、还能跳相关面板 / 打开手测文档 / 复制离线运行单 / 只看外网筛选。
- 你会看到：琥珀金边的卡片 `m1-external-focus`；标题像「下一外网项 · B · 同任务切换 ≥3 模型…」；芯片显示外网待证数、文档勾选、本机缺口；后面排队的外网项小芯片；主按钮「跳到相关面板」+「打开手测文档 / 复制外网运行单 / 只看外网项」。
- 测了啥：external-focus 单测 **9/9**；typecheck/build GREEN；soft full（含 dual）**GREEN**；Electron 重启 PID **57860**。
- 不会怎样：不自动勾手测文档、不写 dogfood、不关 M1、不开 M2、不含密钥。
- 还差啥：外网手测 0/18 + 真实 dogfood ≥3 天（硬门槛，得你做）。你现在可以点「打开手测文档」或「复制外网运行单」对着做。

### 可观测
- `data-testid="m1-external-focus"` · `data-level` · `data-focus-id` · `data-primary-cta` · `data-claims-closed=0`
- 焦点卡：`m1-external-focus-card` · 队列：`m1-external-focus-queue` · 主 CTA：`m1-external-focus-primary`
- softCraftRound **58** · `claimsM1Closed=false` · `claimsDocChecked=false`

### 自测
| 项 | 结果 |
|---|---|
| m1-external-focus.test.ts | 9/9 GREEN |
| typecheck / build | GREEN |
| soft full (+ dual) | GREEN |
| Electron 重启 | PID 57860 |

---

## 本轮进度：2026-07-12 · 第 57 次 soft craft · 下一步合入 dogfood 补填板（soft · M1 仍 open）

### 大白话
- 做了什么：主界面顶部的 **「下一步」** 条，在 dogfood 仍差天数时，会读多日补填板状态，按钮从「打开今日」升级为 **写今日 / 打开补填板 / 复制多日补填**，并写清仍差几天、脚手架/草稿不计有效日。
- 你会看到：`m1-next-action` 的 `data-cta-action` 可能是 `open-dogfood-fill` / `copy-dogfood-fill`；点主按钮会打开补填板或复制多日补填，并闪一下补填卡。
- 测了啥：next-action 单测 **14/14**；typecheck/build GREEN；soft full（含 dual）**GREEN**；Electron 重启 PID **61200**。
- 不会怎样：不写 dogfood 盘、不算草稿有效日、不关 M1、不开 M2。
- 还差啥：外网手测 0/18 + 真实 dogfood ≥3 天（硬门槛，得你做）。

### 可观测
- `data-testid="m1-next-action"` · `data-cta-action` · `data-fill-level` · `data-testid="m1-next-cta" data-action=...`
- softCraftRound **57** · `claimsM1Closed=false`

### 自测
| 项 | 结果 |
|---|---|
| m1-next-action.test.ts | 14/14 GREEN |
| typecheck / build | GREEN |
| soft full (+ dual) | GREEN |
| Electron 重启 | PID 61200 |

---

## 本轮进度：2026-07-12 · 第 56 次 soft craft · 退出路径合入 dogfood 补填板（soft · M1 仍 open）

### 大白话
- 做了什么：把第 54 次的「多日补填板」信号 **合进退出路径**。dogfood 仍差天数时，退出路径多一步 **补填 dogfood 仍差 N 天**，按钮可「打开补填板 / 写今日 dogfood / 复制多日补填」；复制退出路径 / 一键证据包里的路径粘贴也会带上补填信息。
- 你会看到：退出路径列表里有一步 `m1-exit-path-step-dogfood-fill-assist`（蓝色高亮）；点 CTA 会闪补填板；复制路径/证据包不再漏掉补填步。
- 测了啥：exit-path 单测 **11/11**；typecheck/build GREEN；soft full（含 dual）**GREEN**；Electron 重启（PID 新实例）。
- 不会怎样：不写 dogfood 盘、不算草稿为有效日、不关 M1、不开 M2、不伪造日记。
- 还差啥：外网手测 0/18 + 真实 dogfood ≥3 天（硬门槛，得你做）。

### 可观测
- 步骤：`data-testid="m1-exit-path-step-dogfood-fill-assist"` / `data-kind="dogfood-fill"`
- CTA：`open-dogfood-fill` · `copy-dogfood-fill`
- 复制粘贴含「补填 dogfood 仍差」；softCraftRound **56**
- `claimsM1Closed=false`

### 自测
| 项 | 结果 |
|---|---|
| m1-exit-path.test.ts | 11/11 GREEN |
| typecheck / build | GREEN |
| soft full (+ dual) | GREEN |
| Electron 重启 | PID 71320 新实例 |

---

## 本轮进度：2026-07-12 · 第 55 次 soft craft · 证据包并入 dogfood 多日补填（soft · M1 仍 open）

### 大白话
- 做了什么：把第 54 次的「多日补填板」**合进一键证据包**。点「一键导出 / 证据包」时，粘贴内容里会多一节 **dogfood 多日补填**（仍差几天、缺文件、草稿不计有效日）。
- 你会看到：证据包 TOC 多一项「dogfood 多日补填」；导出摘要带「含补填」；`m1-evidence-bundle-sec-dogfood-fill`。
- 测了啥：证据包单测 **10/10**；typecheck/build GREEN；soft full（含 dual）**GREEN**；Electron 重启。
- 不会怎样：不写 dogfood 盘、不算草稿为有效日、不关 M1、不开 M2。
- 还差啥：外网手测 0/18 + 真实 dogfood ≥3 天（硬门槛，得你做）。

### 可观测
- 证据包 TOC：`data-testid="m1-evidence-bundle-sec-dogfood-fill"`
- 包内标题：`## dogfood 多日补填`
- 摘要：`含补填` / softCraftRound **55**
- `claimsM1Closed=false` · `claimsDogfoodReal=false`

### 自测
| 项 | 结果 |
|---|---|
| m1-evidence-bundle.test.ts | 10/10 GREEN |
| typecheck / build | GREEN |
| soft full (+ dual) | GREEN |
| Electron 重启 | PID 新实例 |

---

## 本轮进度：2026-07-12 · 第 54 次 soft craft · dogfood 多日补填板（soft · M1 仍 open）

### 大白话
- 做了什么：把 **dogfood 多日补填看板** 做完了（纯模块 + 单测 + 界面 + 复制多日补填）。
- 你会看到：M1 退出证据区里，原有「按日列表」上面多了一块 **dogfood 补填** 卡：有效天数芯片、仍差几天、主按钮（写今日/补脚手架）、每行可点打开日记、可复制多日补填板。
- 测了啥：单测 **9/9** 通过；desktop typecheck/build 通过；soft full（含 dual）**GREEN**；Electron 已重启加载新 dist。
- 不会怎样：**不会**把草稿/脚手架算成有效日；**不会**自动关 M1；**不会**伪造 dogfood 文件；**不会**启动 M2。
- 还差啥：外网手测 0/18 + 真实 dogfood ≥3 天 —— 仍是硬门槛，得你手写。

### 可观测
- `data-testid="m1-dogfood-fill"` / `m1-dogfood-fill-primary` / `m1-dogfood-fill-cta-YYYY-MM-DD`
- `data-claims-closed="0"` · `data-claims-dogfood-real="0"`
- softCraftRound **54**

### 自测记录
| 项 | 结果 |
|---|---|
| m1-dogfood-fill-board.test.ts | 9/9 GREEN |
| typecheck | GREEN |
| build | GREEN |
| soft full (+ dual) | GREEN |
| Electron 重启 | 已启 PID 新实例 |

---

## 2026-07-12 · 第 53 次自测 · 本机领先差异可点跳 + 退出路径合入（soft · M1 仍 open）

### 这轮到底做了啥（大白话）
硬门槛还是：外网手测勾 14-…handtest + dogfood 真实日记 ≥3 天。我不能替你勾、不能写假日记、不能关 M1。

第 51/52 次已经有「文档↔本机差异板」和证据包合入。这轮做**硬门槛辅助可观测**：

1. 差异板每一行「本机领先 / 文档领先 / 外网待证」都能点：打开手测文档，并尽量跳到对应面板 + 高亮清单行
2. 顶部主按钮「勾本机领先 · 打开手测文档」一键打开真源文档
3. 退出路径板多一步「勾本机领先 N 项」（仅当 liveAhead>0），进度仍封顶 99%，永远不关 M1

### 我怎么测的
1. desktop：m1-handtest-doc-diff **6/6** + m1-exit-path **7/7**
2. desktop `tsc --noEmit` 通过
3. dual 网关 **4/4**；`pnpm selftest:m1-soft` full **GREEN**（softCraftRound=53）
4. desktop build + Electron 重启

### 结果（数字）
| 项 | 结果 |
|---|---|
| m1-handtest-doc-diff | **6/6 通过** |
| m1-exit-path | **7/7 通过** |
| desktop tsc --noEmit | **通过** |
| selftest:m1-soft full | **GREEN** |
| dual-http + dual-protocol | **4/4** |
| desktop build | **通过** |
| Electron 重启 | **已重启** |
| 外网真实网关 UI 手测 | **还没做（0/18）** |
| dogfood ≥3 天 | **还没做** |

### 你会在界面上看到啥
1. 「文档 ↔ 本机」差异板：主按钮 + 可点差异行（右侧 CTA 文案）
2. 点「本机领先」行 → 打开 14-…handtest.md，并跳转/闪一下对应手测清单项
3. 退出路径若本机领先 >0：多一步 **勾本机领先 N 项**（`m1-exit-path-step-doc-live-ahead`）
4. `data-claims-closed="0"` · 永远不假装关 M1

### 还没做完的（M1 仍 open）
1. 你本人外网真实网关：按 18 项勾 `14-external-gateway-handtest.md`
2. dogfood 真实日记 ≥3 天
3. **不要** 启动 M2；**不要** 仅凭 soft 关 M1

## 2026-07-12 · 第 52 次自测 · 证据包并入文档↔本机差异（soft · M1 仍 open）

### 这轮到底做了啥（大白话）
硬门槛还是：外网手测勾 14-…handtest + dogfood 真实日记 ≥3 天。我不能替你勾、不能写假日记、不能关 M1。

第 51 次做出了「文档↔本机差异板」。这轮只做一件硬门槛辅助：**一键证据包里也自动带上这份差异**，你粘贴给自己/记 dogfood 时不用先复制差异再复制证据包。

1. `formatM1EvidenceBundle` 增加可选 `docDiffMarkdown`（TOC 多一枚「文档↔本机差异」）
2. 一键导出时自动 `formatM1HandtestDocDiffPaste` 合入包内
3. 无差异/无路径/无草稿边界仍可用；**永远** `claimsM1Closed=false` · 不含密钥 · 不自动勾手测 · 不写 dogfood · 不关 M1 · 不启 M2

### 我怎么测的
1. desktop：m1-evidence-bundle **9/9** + m1-handtest-doc-diff **3/3**
2. dual 网关 **4/4**；`pnpm selftest:m1-soft` **GREEN**（softCraftRound=52）
3. desktop tsc + build + Electron 重启

### 结果（数字）
| 项 | 结果 |
|---|---|
| m1-evidence-bundle | **9/9 通过** |
| m1-handtest-doc-diff | **3/3 通过** |
| selftest:m1-soft full | **GREEN** |
| dual-http + dual-protocol | **4/4** |
| desktop tsc + build | **通过** |
| Electron 重启 | **已重启** |
| 外网真实网关 UI 手测 | **还没做（0/18）** |
| dogfood ≥3 天 | **还没做** |

### 你会在界面上看到啥
1. 证据包 TOC 多一枚 **文档↔本机差异**（`m1-evidence-bundle-sec-doc-diff` · 可选）
2. 一键导出摘要会出现 **含差异**
3. 包内有 `## 文档↔本机差异` 分区（本机领先待勾 / 文档领先复核等）
4. 单独 **复制文档差异** 按钮仍可用

### 还没做完的（M1 仍 open）
1. 你本人外网真实网关：按 18 项勾 `14-external-gateway-handtest.md`
2. dogfood 真实日记 ≥3 天
3. **不要** 启动 M2；**不要** 仅凭 soft 关 M1

---

## 2026-07-12 · 第 51 次自测 · 文档↔本机差异板（soft · M1 仍 open）

### 这轮到底做了啥（大白话）
硬门槛还是：外网手测勾 14-…handtest + dogfood 真实日记 ≥3 天。我不能替你勾、不能写假日记、不能关 M1。

第 50 次能看到每一行文档勾选徽章了。这轮再加一层**可观测对照**：把「本机 live 状态」和「文档勾选」逐项比一遍，标出：

- **本机领先**：本机已绿，文档还没勾 → 提醒你去勾 markdown
- **文档领先**：文档勾了，本机还没绿 → 提醒复核是否勾早了
- **外网待证**：必须走真实网关/故意失败的项
- **对齐已勾**：两边一致

仍然只读、不自动勾、不关 M1。

### 我怎么测的
1. desktop：`m1-handtest-doc-diff` **3/3** + doc-parse **5/5**
2. `tsc --noEmit` 通过
3. dual 网关 **4/4**；`pnpm selftest:m1-soft` full **GREEN**（softCraftRound=51）
4. desktop build + Electron 重启

### 结果（数字）
| 项 | 结果 |
|---|---|
| m1-handtest-doc-diff | **3/3 通过** |
| m1-handtest-doc-parse | **5/5 通过** |
| desktop tsc --noEmit | **通过** |
| selftest:m1-soft full | **GREEN** |
| dual-http + dual-protocol | **4/4** |
| desktop build | **通过** |
| Electron 重启 | **已重启** |
| 外网真实网关 UI 手测 | **还没做（0/18）** |
| dogfood ≥3 天 | **还没做** |

### 你会在界面上看到啥
1. 手测对照上方：**文档 ↔ 本机** 差异板（芯片：本机领先 / 文档领先 / 外网待证 / 对齐已勾）
2. 待关注列表最多 8 条，带中文动作提示
3. 按钮 **复制文档差异**（粘贴进 dogfood/证据备注用）
4. `data-claims-closed="0"` · 永远不假装关 M1

### 还没做完的（M1 仍 open）
1. 你本人外网真实网关：按 18 项勾 `14-external-gateway-handtest.md`
2. dogfood 真实日记 ≥3 天
3. **不要** 启动 M2；**不要** 仅凭 soft 关 M1

---

## 2026-07-12 · 第 50 次自测 · 手测文档逐项勾选徽章（soft · M1 仍 open）

### 这轮到底做了啥（大白话）
硬门槛还是：你在 `14-external-gateway-handtest.md` 里人手勾 18 项 + dogfood 真实日记 ≥3 天。我**不能**替你勾、不能写假日记、不能关 M1。

第 49 次把退出路径塞进证据包了。这轮做的是硬门槛**观测辅助**：从手测文档解析每一项 `- [ ] / - [x]`，在 UI 手测对照清单旁显示 **文档✓ / 文档□ / 文档—**。

1. 纯解析：`m1-handtest-doc-parse.ts`（分节 pre/A–D、顺序映射到 18 项 id）
2. Main IPC `desktop:m1-exit-evidence` **真正返回** `handtestBoxes`（之前变量算了却没回传，导致 tsc 报未使用）
3. Preload + `global.d.ts` + 渲染层状态都认 `handtestBoxes`
4. 徽章只读文档、**永不自动勾文档**、**永不关 M1**

### 我怎么测的
1. desktop：`m1-handtest-doc-parse` **5/5**
2. `tsc --noEmit` 通过（修了 handtestBoxes 未返回 / 类型缺失）
3. dual 网关 **4/4**；`pnpm selftest:m1-soft` full **GREEN**
4. desktop build + Electron 重启
5. 真实 `14-…handtest.md` 解析：**0/18 勾选**（与文档一致）

### 结果（数字）
| 项 | 结果 |
|---|---|
| m1-handtest-doc-parse | **5/5 通过** |
| desktop tsc --noEmit | **通过** |
| selftest:m1-soft full | **GREEN** |
| dual-http + dual-protocol | **4/4** |
| desktop build | **通过** |
| Electron 重启 | **已重启** |
| 真实手测文档勾选 | **0/18** |
| 外网真实网关 UI 手测 | **还没做** |
| dogfood ≥3 天 | **还没做** |

### 你会在界面上看到啥
1. 手测对照每一行多一枚小徽章：`文档□`（未勾）/ `文档✓`（已勾）/ `文档—`（读不到映射）
2. 徽章绿色=文档已勾，琥珀色=文档未勾；左侧细条同步颜色
3. 改 markdown 勾选后，窗口重新聚焦会重新读文档（不自动改文档）
4. 退出证据进度仍显示 0/18；**进度不会因为 soft 变 100、不会关 M1**

### 还没做完的（M1 仍 open）
1. 你本人外网真实网关：按 18 项勾 `14-external-gateway-handtest.md`
2. dogfood 真实日记 ≥3 天（不是脚手架）
3. **不要** 启动 M2；**不要** 仅凭 soft 关 M1

---

## 2026-07-12 · 第 49 次自测 · 证据包并入退出路径（soft · M1 仍 open）

### 这轮到底做了啥（大白话）
硬门槛还是：外网手测勾 14-…handtest + dogfood 真实日记 ≥3 天。我不能替你勾、不能写假日记。

第 48 次做出了「退出路径板」。这轮只做一件硬门槛辅助：**一键证据包里也带上退出路径**，你外网手测备注时不用先复制路径再复制证据包。

1. `formatM1EvidenceBundle` 增加可选 `exitPathMarkdown` 分区（TOC 多一枚「退出路径」）
2. 一键导出时自动 `formatM1ExitPathPaste` 合入包内
3. 无路径 / 无草稿边界仍可用；**永远** `claimsM1Closed=false` · 不含密钥 · 不自动勾手测 · 不写 dogfood · 不关 M1 · 不启 M2

### 我怎么测的
1. desktop：m1-evidence-bundle **8/8** + m1-exit-path **6/6**
2. dual 网关 **4/4**；`pnpm selftest:m1-soft` **GREEN**
3. desktop tsc + build + Electron 重启

### 结果（数字）
| 项 | 结果 |
|---|---|
| m1-evidence-bundle | **8/8 通过** |
| m1-exit-path | **6/6 通过** |
| selftest:m1-soft full | **GREEN** |
| dual-http + dual-protocol | **4/4** |
| desktop tsc + build | **通过** |
| Electron 重启 | **已重启** |
| 外网真实网关 UI 手测 | **还没做（0/18）** |
| dogfood ≥3 天 | **还没做** |

### 你会在界面上看到啥
1. 证据包卡 TOC 多一枚 **退出路径**（`m1-evidence-bundle-sec-exit-path`）
2. **一键导出 / 导出证据包** 剪贴板 markdown 含「## 退出路径…」有序步骤
3. 反馈摘要会带「含路径」
4. 退出路径板本身（#48）仍独立可用

### 边界
- **M1 仍 open**；**未启动 M2**
- 路径+证据包都是粘贴辅助，**不能**替代你勾手测文档和写真实 dogfood


## 2026-07-12 · 第 48 次自测 · M1 退出路径板（soft · M1 仍 open）

### 这轮到底做了啥（大白话）
硬门槛还是没变：外网真实网关 UI 手测（14-…handtest 勾完）+ dogfood 真实日记 ≥3 天。我不能替你勾、不能写假日记、不能关 M1。

第 47 次把「证据包一键导出」做完了。这轮做 **退出路径板**：把「还差哪些硬门槛、按什么顺序做」摊开成有序步骤，并带进度条（**封顶 99%**）和逐步 CTA。

1. `projectM1ExitPath` / `formatM1ExitPathPaste`：按 soft 就绪 + 手测/文档缺口 + dogfood 天，投影有序步骤
2. UI：手测对照上方新 **退出路径** 卡（进度条 · 步骤列表 · 复制路径 · 逐步 CTA）
3. 顶栏 **复制退出路径**；步骤可跳 Providers/Agent/Compose、开手测/dogfood 文档、复制草稿/证据包
4. 修复：`navigateToInstrument('compose')` 聚焦输入框（不自动发送）
5. **永远** `claimsM1Closed=false` · 进度 ≤99% · 不含密钥 · 不自动勾手测 · 不写 dogfood 盘 · 不关 M1 · 不启 M2

### 我怎么测的
1. desktop：m1-exit-path **6/6**；soft 相关包（含 exit-path / evidence / regression / stream…）**通过**
2. dual 网关 **4/4**
3. `pnpm selftest:m1-soft`（full）**GREEN**
4. desktop tsc + build + Electron 重启

### 结果（数字）
| 项 | 结果 |
|---|---|
| m1-exit-path | **6/6 通过** |
| soft pack（含 exit-path 等 catalog） | **GREEN（runner full）** |
| dual-http + dual-protocol | **4/4 通过** |
| selftest:m1-soft | **GREEN** |
| desktop tsc | **通过** |
| desktop build | **通过** |
| Electron 重启 | **已重启** |
| 外网真实网关 UI 手测 | **还没做（0/18）** |
| dogfood ≥3 天 | **还没做（仅脚手架日）** |

### 你会在界面上看到啥
1. 手测对照上方 **退出路径** 卡：摘要 + 进度百分比（封顶 99）+ 进度条
2. 有序步骤：外网手测项 / 文档勾选 / dogfood 天 / soft 就绪 / 讨论关 M1
3. 按钮 **复制路径** / 顶栏 **复制退出路径** → 剪贴板 markdown
4. 步骤 CTA：打开手测、打开 dogfood、复制草稿/证据包、跳转配置区
5. 可观测：`data-testid=m1-exit-path` · `data-progress` · `data-claims-closed=0` · `m1-exit-path-step-*` · `m1-exit-path-cta-*`

### 边界
- **M1 仍 open**；**未启动 M2**
- 路径板是导航辅助，**不能**替代你勾 14-…handtest 和写真实 dogfood
- 硬门槛齐了也只到 ready-discuss / 99%，仍须人工关 M1


## 2026-07-12 · 第 47 次自测 · 一键导出 soft 证据包（soft · M1 仍 open）

### 这轮到底做了啥（大白话）
硬门槛还是：外网手测勾 14-…handtest + dogfood 真实日记 ≥3 天。我这边不能替你勾、也不能假装日记。

第 40–46 次已经堆了：快照 / 手测粘贴 / 回归矩阵 / 筛选跳转 / dogfood 草稿。你要对外汇报或粘到备注时，得点好几个复制按钮——这轮只做 **一键证据包**：

1. `formatM1EvidenceBundle`：把 soft 快照 + 手测进度 + 回归矩阵 + 下一步 +（可选）dogfood 草稿合成一份 markdown
2. UI：退出证据区新「证据包」卡（目录 TOC + 一键导出）· 顶栏「导出证据包」· 手测区「证据包」
3. 可观测：`m1-evidence-bundle` / `data-level` / `data-claims-closed=0` / `data-action=copy-evidence-bundle` / TOC `m1-evidence-bundle-sec-*`
4. **永远** `claimsM1Closed=false` · `claimsDocChecked=false` · `claimsDogfoodReal=false` · 不含密钥 · 不自动勾手测 · 不写 dogfood 盘 · 不关 M1 · 不启 M2

### 我怎么测的
1. desktop：m1-evidence-bundle **7/7** + soft pack 相关合计 **74**（含 regression/snapshot/dogfood/handtest/exit/next/session/stream）
2. dual 网关 **4/4**
3. `pnpm selftest:m1-soft:quick` GREEN
4. desktop tsc + build + Electron 重启

### 结果（数字）
| 项 | 结果 |
|---|---|
| m1-evidence-bundle | **7/7 通过** |
| soft pack（9 文件） | **74 通过** |
| dual-http + dual-protocol | **4/4 通过** |
| selftest:m1-soft:quick | **GREEN** |
| desktop build | **通过** |
| Electron 重启 | **已重启** |
| 外网真实网关 UI 手测 | **还没做（0/18）** |
| dogfood ≥3 天 | **还没做（仅脚手架日）** |

### 你会在界面上看到啥
1. **退出证据**下方有 **证据包** 卡：标题/缺口摘要 + 分区胶囊（封面/下一步/快照/手测/回归/草稿/边界）
2. 按钮 **一键导出** / 顶栏 **导出证据包** / 手测区 **证据包** → 剪贴板是一份完整 markdown
3. 反馈条会显示「已复制 M1 证据包 … 字 · … 仍不关 M1」
4. 可观测：`data-testid=m1-evidence-bundle` · `data-action=copy-evidence-bundle` · `data-claims-closed=0`

### 边界
- **M1 仍 open**；**未启动 M2**
- 证据包是粘贴辅助，**不能**替代你勾 14-…handtest 和写真实 dogfood
- 密钥不进包；硬门槛数字齐了也只提示「仍须人工关 M1」

### 下一刀（仍不关 M1）
1. 你外网手测勾 `docs/development/14-external-gateway-handtest.md`
2. 复制 dogfood 草稿或证据包 → 改「待你确认」→ 有效日 ≥3
3. soft：仅失败边角 / 硬门槛辅助；**勿关 M1**

### 不启动
- **勿** 关 M1 · **勿** 启动 M2

---

## 2026-07-12 · 第 46 次自测 · soft 回归筛选 + 行跳转（soft · M1 仍 open）

### 这轮到底做了啥（大白话）
第 45 次做了「自动 vs 手测」回归矩阵。我测下来：行一多、缺口混在一起时，不好一眼只看外网硬门槛。这轮只做 **筛选 + 可点行动**（仍不关 M1）：

1. 筛选：全部 / 缺口 / 外网 / auto红（纯函数 `filterM1SoftRegressionRows`）
2. 行可点：手测文档 / dogfood / Providers / Agent / 轨迹 / 重连 / 复制矩阵
3. 可观测：`data-filter` / `data-action` / `m1-soft-regression-filter-*` / 行按钮 testid
4. **不**自动勾手测、**不**自动写 dogfood、**不**关 M1

### 我怎么测的
1. m1-soft-regression **8/8** + soft pack **72**
2. dual 网关 **4/4**
3. desktop tsc + build + Electron 重启

### 结果（数字）
| 项 | 结果 |
|---|---|
| m1-soft-regression | **8/8 通过** |
| soft pack（8 文件） | **72 通过** |
| dual-http + dual-protocol | **4/4 通过** |
| desktop build | **通过** |
| Electron 重启 | **已重启** |
| 外网真实网关 UI 手测 | **还没做（0/18）** |
| dogfood ≥3 天 | **还没做（仅脚手架日）** |

### 你会在界面上看到啥
1. soft 回归板上方有筛选芯片：**全部 / 缺口 / 外网 / auto红**（带计数）
2. 点「外网」只看硬门槛相关行
3. 点一行：如「手测文档」打开 14-…handtest；「dogfood」打开今日日记；Providers/Agent/轨迹会跳转面板
4. 可观测：`data-filter` · `data-action` · `data-testid=m1-soft-regression-row-btn-*`

### 边界
- **M1 仍 open**；**未启动 M2**
- 筛选/跳转是辅助，不能替代你勾文档和写日记
- 密钥仍不进矩阵

### 下一刀（仍不关 M1）
1. 你外网手测勾 14-…handtest.md
2. 复制 dogfood 草稿 → 改「待你确认」→ 有效日 ≥3
3. soft：失败边角 / 回归即可

### 不启动
- **勿** 关 M1 · **勿** 启动 M2

---

## 2026-07-12 · 第 45 次自测 · soft 回归矩阵（自动 vs 手测）+ 本地 runner（soft · M1 仍 open）

### 这轮到底做了啥（大白话）
硬门槛还是外网手测 + dogfood。soft 这边已经堆了不少「就绪条 / 复制快照 / 草稿」——下一刀按计划做 **回归包**：一眼看清哪些是本机自动化绿、哪些必须你外网手测。

本轮（soft · 不关 M1）：

1. `formatM1SoftRegressionMatrix` / `projectM1SoftRegressionMatrix`：自动列 vs 手测列矩阵（markdown 可复制）
2. UI：退出证据区紧凑矩阵板 +「复制回归矩阵」按钮；手测区也有入口
3. 脚本 `node scripts/selftest-m1-soft-regression.mjs`（`pnpm selftest:m1-soft` / `--quick`）
4. 可观测：`m1-soft-regression` / `data-auto-pass` / `data-hand-gaps` / `data-external-gaps` / `data-action=copy-soft-regression`
5. **永远** `claimsM1Closed=false` · 不自动勾手测 · 不含密钥

### 我怎么测的
1. desktop：m1-soft-regression **6/6** + soft pack（exit/handtest/dogfood/next/snapshot/stream）合计 **66**
2. dual 网关 **4/4**
3. desktop tsc + build + Electron 重启

### 结果（数字）
| 项 | 结果 |
|---|---|
| m1-soft-regression | **6/6 通过** |
| soft pack（7 文件） | **66 通过** |
| dual-http + dual-protocol | **4/4 通过** |
| desktop build | **通过** |
| Electron 重启 | **已重启** |
| 外网真实网关 UI 手测 | **还没做（0/18）** |
| dogfood ≥3 天 | **还没做（仅脚手架日）** |

### 你会在界面上看到啥
1. 退出证据下方有 **soft 回归** 板：每行显示 auto / hand 状态（pass / soft / external / pending / na）
2. 按钮「复制回归矩阵」→ 剪贴板是 markdown 表，可贴 dogfood / 手测备注
3. 手测区快捷钮「回归矩阵」
4. 可观测：`data-testid=m1-soft-regression` · `data-auto-pass` · `data-external-gaps` · `data-claims-closed=0`

### 固定脚本
```
pnpm selftest:m1-soft
pnpm selftest:m1-soft:quick
node scripts/selftest-m1-soft-regression.mjs --json
```

### 边界
- **M1 仍 open**；**未启动 M2**
- auto 绿 ≠ 外网手测已勾；矩阵不能关 M1
- 密钥不进矩阵正文（有 scrub 守卫）

### 下一刀（仍不关 M1）
1. 你外网手测勾 14-…handtest.md
2. 复制 dogfood 草稿 → 改「待你确认」→ 有效日 ≥3
3. soft：失败边角 / 回归即可

### 不启动
- **勿** 关 M1 · **勿** 启动 M2

---

## 2026-07-12 · 第 44 次自测 · 生成失败恢复 CTA + 错误分类（soft · M1 仍 open）

### 这轮到底做了啥（大白话）
硬门槛还是外网手测 + dogfood。这轮按「失败边角」补 **生成失败时的可行动恢复**：以前失败条只显示错误字，不知道下一步该点哪；密钥长串也可能露在摘要里。

本轮（soft · 不关 M1）：

1. `classifyStreamFailure`：把错误文案分成限流 / 鉴权 / 超时 / 模型不存在 / 网络 / 权限 / 上游 / 取消 / 未知
2. `scrubFailureText`：字幕与提示里的 sk-/Bearer/api_key 打码
3. 失败时会话就绪条出 **恢复 CTA**（打开 Providers / Fallback / 轨迹 / 诊断 / 聚焦 Compose）
4. 可观测：`data-failure-code` / `data-failure-kind` / `data-cta-action` / `conversation-stream-failure`
5. **不**自动重发消息（避免副作用）；取消态只聚焦输入框

### 我怎么测的
1. conversation-stream-readiness **18/18** + dogfood-score **8/8** + exit **12/12** + next **10/10** + connect-error **2/2**（50）
2. dual 网关 **4/4**
3. desktop tsc + build + Electron 重启

### 结果（数字）
| 项 | 结果 |
|---|---|
| conversation-stream-readiness | **18/18 通过** |
| m1-dogfood-score | **8/8 通过** |
| m1-exit-evidence | **12/12 通过** |
| m1-next-action | **10/10 通过** |
| runtime-connect-error | **2/2 通过** |
| dual-http + dual-protocol | **4/4 通过** |
| desktop build | **通过** |
| Electron 重启 | **已重启** |
| 外网真实网关 UI 手测 | **还没做（0/18）** |
| dogfood ≥3 天 | **还没做（仅脚手架日）** |

### 你会在界面上看到啥
1. 生成失败时会话就绪条变失败色，badge 显示中文类别（如「限流 / 配额」「鉴权失败」）
2. 红色细条恢复按钮：如「查看 Fallback 链」「打开 Providers」「查看轨迹」
3. 可观测：`conversation-stream-failure` / `data-failure-kind` / `data-cta-action` / root `data-failure-code`
4. 错误摘要里的假密钥会被 `sk-***` 打码

### 边界
- **M1 仍 open**；**未启动 M2**
- 分类是启发式，外网真实错误仍要你手测勾文档
- 不自动重试发送；不关里程碑

### 下一刀（仍不关 M1）
1. 你外网手测勾 14-…handtest.md
2. 复制 dogfood 草稿 → 改「待你确认」→ 有效日 ≥3
3. soft：继续失败边角 / 回归即可

### 不启动
- **勿** 关 M1 · **勿** 启动 M2

## 2026-07-12 · 第 43 次自测 · dogfood 计分加固：粘贴草稿不计有效日（soft · M1 仍 open）

### 这轮到底做了啥（大白话）
上一轮做了「一键复制 dogfood 草稿」。我测发现：草稿里用的是「**待你确认**」而不是「待填」，soft 又全绿时，**旧计分会把粘贴草稿误判成有效日**——这会污染 M1 退出证据。

这轮只做 **硬门槛防伪 + 可观测**（仍不关 M1、不自动写 dogfood）：

1. 抽出纯函数 `scoreDogfoodDiary` 到 `m1-dogfood-score.ts`（main/renderer 共用）
2. 识别粘贴草稿特征（「复制 dogfood 草稿」「粘贴辅助」「待你确认」密度、M1 仍 open 等）
3. 待确认标记统一计数：`待填` + `待你确认` + 单独 `待确认`
4. **粘贴草稿永远 isScaffold=true**，不计 `dogfoodRealDays`
5. 退出证据按日板：`草稿` 标签 + 原因条 + `data-kind=draft` + chip 显示「草稿N」
6. 永远不自动关 M1、不自动勾手测

### 我怎么测的
1. desktop：dogfood-score **8/8** + exit-evidence **12/12** + load **4/4** + draft **4/4** + snapshot **4/4** + open-doc **7/7**（39）
2. dual 网关 **4/4**
3. desktop tsc + build + Electron 重启

### 结果（数字）
| 项 | 结果 |
|---|---|
| m1-dogfood-score | **8/8 通过** |
| m1-exit-evidence | **12/12 通过** |
| m1-exit-evidence-load | **4/4 通过** |
| m1-dogfood-draft | **4/4 通过** |
| m1-soft-snapshot | **4/4 通过** |
| m1-open-doc | **7/7 通过** |
| dual-http + dual-protocol | **4/4 通过** |
| desktop build | **通过** |
| Electron 重启 | **已重启** |
| 外网真实网关 UI 手测 | **还没做（0/18）** |
| dogfood ≥3 天 | **还没做（仅脚手架日）** |

### 你会在界面上看到啥
1. 退出证据 dogfood 按日行：粘贴草稿显示紫色 **草稿**（不是绿色「有效」）
2. 行下有简短 **计分原因**（如「粘贴草稿特征 · 不计有效日」）
3. dogfood 芯片 detail 可能带「草稿N」
4. 可观测：`data-kind=draft` / `data-paste-assist=1` / `m1-dogfood-day-reasons-*` / `data-draft-count`

### 边界
- **M1 仍 open**；**未启动 M2**
- 计分是启发式：人写满真实日记才会变「有效」；草稿粘贴本身不够
- 不替代外网手测勾选

### 下一刀（仍不关 M1）
1. 你外网手测勾 14-…handtest.md
2. 复制草稿 → **改掉待你确认** → 保存 ≥3 天有效日记
3. soft：失败边角 / 回归即可

### 不启动
- **勿** 关 M1 · **勿** 启动 M2

## 2026-07-12 · 第 42 次自测 · 复制 dogfood 日记草稿（soft · M1 仍 open）

### 这轮到底做了啥（大白话）
硬门槛 dogfood 要 ≥3 天**有效**日记，但空白模板从零写很慢；脚手架日又大量「待填」不算有效。
这轮加 **一键复制今日 dogfood 草稿**（粘贴辅助，**不自动写盘、不算有效日、不关 M1**）：

1. 纯函数 `formatM1DogfoodDayDraft`：按本机 soft 状态生成带日期的 Markdown 日记草稿
2. soft 已知项可预勾（Runtime/任务/Providers 等）；外网与重启仍标「待你确认」
3. 退出证据头 + 手测对照都有 **复制 dogfood 草稿** 按钮 → 剪贴板 + 反馈条
4. 永远 `claimsM1Closed: false` / `claimsDogfoodReal: false`；不含密钥

### 我怎么测的
1. desktop：dogfood-draft **4/4** + paste **4/4** + open-doc **7/7** + exit **11/11** + snapshot **4/4**（30）
2. dual 网关 **4/4**
3. desktop tsc + build + Electron 重启

### 结果（数字）
| 项 | 结果 |
|---|---|
| m1-dogfood-draft | **4/4 通过** |
| m1-handtest-paste | **4/4 通过** |
| m1-open-doc | **7/7 通过** |
| m1-exit-evidence | **11/11 通过** |
| m1-soft-snapshot | **4/4 通过** |
| dual-http + dual-protocol | **4/4 通过** |
| desktop build | **通过** |
| Electron 重启 | **已重启** |
| 外网真实网关 UI 手测 | **还没做（0/18）** |
| dogfood ≥3 天 | **还没做（仅脚手架日）** |

### 你会在界面上看到啥
1. 退出证据标题旁：**复制 dogfood 草稿**
2. 手测对照快捷：**dogfood 草稿**
3. 可观测：`m1-dogfood-draft-copy` / `m1-handtest-copy-dogfood-draft` / `data-action=copy-dogfood-draft` / 反馈 `openDocId=dogfood-draft`

### 边界
- **M1 仍 open**；**未启动 M2**
- 草稿**不**自动写入 dogfood/；粘贴后你仍需改「待你确认」并保存，才可能被计为有效日
- 本草稿故意保留待确认字段，避免被 score 误判为 real

### 下一刀（仍不关 M1）
1. 你外网手测勾 14-…handtest.md
2. 复制草稿 → 改真实结果 → 保存 ≥3 天有效日记
3. soft：失败边角/回归即可

### 不启动
- **勿** 关 M1 · **勿** 启动 M2

## 2026-07-12 · 第 41 次自测 · 手测进度粘贴稿 + 外网/缺口筛选（soft · M1 仍 open）

### 这轮到底做了啥（大白话）
硬门槛还是卡在你外网手测勾选和 dogfood，但 18 项手测一行行翻很累，写 dogfood 时也不知道该粘哪段。
这轮补 **手测进度粘贴稿 + 列表筛选**（仍是 soft 辅助，不自动勾文档、不关 M1）：

1. 纯函数 `formatM1HandtestPaste`：按前置/A/B/C/D 导出 Markdown 进度（`[x]` 只表示本机 soft 见通过）
2. 筛选：全部 / 缺口 / 外网，带计数胶囊
3. 手测对照按钮 **复制手测进度** → 剪贴板 + 反馈条
4. 密钥启发式校验；永远 `claimsM1Closed: false` / `claimsDocChecked: false`

### 我怎么测的
1. desktop：handtest-paste **4/4** + section **3/3** + open-doc **7/7** + exit **11/11** + snapshot **4/4**（29）
2. dual 网关 **4/4**
3. desktop tsc + build + Electron 重启

### 结果（数字）
| 项 | 结果 |
|---|---|
| m1-handtest-paste | **4/4 通过** |
| m1-handtest-section-board | **3/3 通过** |
| m1-open-doc | **7/7 通过** |
| m1-exit-evidence | **11/11 通过** |
| m1-soft-snapshot | **4/4 通过** |
| dual-http + dual-protocol | **4/4 通过** |
| desktop build | **通过** |
| Electron 重启 | **已重启** |
| 外网真实网关 UI 手测 | **还没做（0/18）** |
| dogfood ≥3 天 | **还没做（仅脚手架日）** |

### 你会在界面上看到啥
1. 手测对照头：**复制手测进度**（另有 soft 快照）
2. 列表上筛选胶囊：全部 / 缺口 / 外网 + 数字
3. 可观测：`m1-handtest-copy-paste` / `data-action=copy-handtest-paste` / `m1-handtest-filters` / `m1-handtest-filter-*` / 列表 `data-filter`

### 边界
- **M1 仍 open**；**未启动 M2**
- 粘贴稿 **不能** 替代 14-…handtest.md 勾选
- 筛选只改展示，不改文档

### 下一刀（仍不关 M1）
1. 你外网手测勾文档（可先筛「外网」看待证项）
2. 复制手测进度贴进 dogfood，改成有效日 ≥3
3. soft：失败边角/回归即可

### 不启动
- **勿** 关 M1 · **勿** 启动 M2

## 2026-07-12 · 第 40 次自测 · dogfood 按日可打开 + 手测分区进度板（soft · M1 仍 open）

### 这轮到底做了啥（大白话）
退出证据里 dogfood 按日行以前只能看，**点不开那天的日记**；手测对照 18 项一长串，**分区进度一眼看不清**。
这轮补上 **硬门槛辅助**（仍然 soft，不自动勾、不关 M1）：

1. 主进程白名单 `dogfood-day` + 严格 `YYYY-MM-DD` 校验 + 路径不得逃出 dogfood 目录
2. 退出证据按日行变按钮：点哪天打开哪天 `.md`（系统编辑器）；反馈条写结果
3. 手测对照上方 **分区进度板**（前置 / A / B / C / D）：pass/total + 外网缺口；可点跳到对应面板
4. **绝不**自动勾选手测、不伪造 real 天、不关 M1

### 我怎么测的
1. desktop：open-doc **7/7** + section-board **3/3** + exit **11/11** + chip **7/7** + next **10/10** + snapshot **4/4**（42）
2. dual 网关 **4/4**
3. desktop tsc + build + Electron 重启

### 结果（数字）
| 项 | 结果 |
|---|---|
| m1-open-doc | **7/7 通过** |
| m1-handtest-section-board | **3/3 通过** |
| m1-exit-evidence | **11/11 通过** |
| m1-exit-chip-action | **7/7 通过** |
| m1-next-action | **10/10 通过** |
| m1-soft-snapshot | **4/4 通过** |
| dual-http + dual-protocol | **4/4 通过** |
| desktop build | **通过** |
| Electron 重启 | **已重启** |
| 外网真实网关 UI 手测 | **还没做（0/18）** |
| dogfood ≥3 天 | **还没做（仅脚手架日）** |

### 你会在界面上看到啥
1. 退出证据 dogfood 行：日期 · 有效/脚手架 · 状态 · **打开**；点击打开当日日记
2. 手测对照顶部：五个分区胶囊（前置/A/B/C/D）+ 分区摘要
3. 可观测：`m1-dogfood-day-btn-YYYY-MM-DD` / `data-action=open-dogfood-day` / `m1-handtest-sections` / `m1-handtest-section-*`

### 边界
- **M1 仍 open**；**未启动 M2**
- dogfood-day 只打开已存在文件，不创建；非法日期直接拒绝
- 分区板只做 soft 投影，不写文档勾选

### 下一刀（仍不关 M1）
1. 你外网手测勾 14-…handtest.md
2. 真实 dogfood ≥3 天（点按日行改日记 → 回前台看「有效」）
3. soft：失败边角/回归即可

### 不启动
- **勿** 关 M1 · **勿** 启动 M2

## 2026-07-12 · 第 39 次自测 · dogfood 按日明细 + 聚焦自动刷新退出证据（soft · M1 仍 open）

### 这轮到底做了啥（大白话）
退出证据以前只显示「dogfood 0/3 天」，**看不出哪天是脚手架、哪天算有效**；你改完日记还得手动点刷新。
这轮补上 **按日明细板 + 窗口回到前台自动重读文档**：

1. 主进程 `listDogfoodDayReports`：逐日判定 scaffold / real（与 score 逻辑一致）
2. IPC `desktop:m1-exit-evidence` 返回 `dogfoodDays[]`
3. 任务头退出证据下展示按日行：日期 · 有效/脚手架 · 状态文案
4. 窗口 focus / 页签 visible 时自动 `exitEvidenceTick++` 重读手测与 dogfood
5. **绝不**自动勾选手测、不伪造 real 天、不关 M1

### 我怎么测的
1. desktop：exit-evidence **11/11** + load **3/3** + snapshot **4/4** + chip-action **7/7**（25）
2. dual 网关 **4/4**
3. desktop tsc + build + Electron 重启

### 结果（数字）
| 项 | 结果 |
|---|---|
| m1-exit-evidence | **11/11 通过** |
| m1-exit-evidence-load | **3/3 通过** |
| m1-soft-snapshot | **4/4 通过** |
| m1-exit-chip-action | **7/7 通过** |
| dual-http + dual-protocol | **4/4 通过** |
| desktop build | **通过** |
| Electron 重启 | **已重启** |
| 外网真实网关 UI 手测 | **还没做（0/18）** |
| dogfood ≥3 天 | **还没做（仅脚手架日）** |

### 你会在界面上看到啥
1. 退出证据芯片下方：`2026-07-12 · 脚手架 · 待填 N`
2. 真填一天后切回应用：应自动刷新，行变成 **有效**
3. 可观测：`m1-dogfood-days` / `m1-dogfood-day-YYYY-MM-DD` / `data-kind`

### 边界
- **M1 仍 open**；**未启动 M2**
- 自动刷新只读文档，不写勾选
- scaffold 启发式与原先一致（多「待填」/脚手架横幅）

### 下一刀（仍不关 M1）
1. 你外网手测勾 14-…handtest.md
2. 真实 dogfood ≥3 天（填完切回桌面看「有效」计数）
3. soft：失败边角/回归即可

### 不启动
- **勿** 关 M1 · **勿** 启动 M2

## 2026-07-12 · 第 38 次自测 · 复制 soft 快照辅助手测/dogfood（soft · M1 仍 open）

### 这轮到底做了啥（大白话）
硬门槛还是卡在你外网手测和 dogfood，但填文档时经常要对照「本机现在到底到哪了」。
这轮加 **一键复制 soft 快照**（粘贴辅助，**不是**退出证据）：

1. 纯函数 `formatM1SoftSnapshot`：把 Runtime/任务/Providers/Agent/手测对照/文档勾选/dogfood/dual/下一步 打成 Markdown
2. **不含密钥**；永远 `claimsM1Closed: false`
3. 退出证据头 + 手测对照头都有 **「复制 soft 快照」** 按钮
4. 复制成功/失败写进已有反馈条 `m1-open-doc-feedback`（`data-open-doc=soft-snapshot`）

### 我怎么测的
1. desktop：`m1-soft-snapshot` **4/4** + chip-action **7/7** + next **10/10** + open-doc **4/4**
2. dual 网关 **4/4**
3. desktop tsc + build + Electron 重启

### 结果（数字）
| 项 | 结果 |
|---|---|
| m1-soft-snapshot | **4/4 通过** |
| m1-exit-chip-action | **7/7 通过** |
| m1-next-action | **10/10 通过** |
| m1-open-doc | **4/4 通过** |
| dual-http + dual-protocol | **4/4 通过** |
| desktop build | **通过** |
| Electron 重启 | **已重启** |
| 外网真实网关 UI 手测 | **还没做（0/18）** |
| dogfood ≥3 天 | **还没做** |

### 你会在界面上看到啥
1. 退出证据标题旁：**复制 soft 快照**
2. 手测对照顶部胶囊：第三个 **复制 soft 快照**
3. 点后反馈条：「已复制 soft 快照 N 字 · 手测文档 x/y · dogfood a/b」
4. 可观测：`m1-soft-snapshot-copy` / `m1-handtest-copy-snapshot` / `data-action=copy-soft-snapshot`

### 边界
- **M1 仍 open**；**未启动 M2**
- 复制快照 ≠ 手测完成 / ≠ dogfood 完成
- 剪贴板不可用时会显示错误反馈

### 下一刀（仍不关 M1）
1. 你复制快照 → 打开手测清单真测真勾
2. dogfood ≥3 天真实日记
3. soft：失败边角/回归即可

### 不启动
- **勿** 关 M1 · **勿** 启动 M2

## 2026-07-12 · 第 37 次自测 · 退出证据芯片可点开文档 + 打开结果可观测 + 手测快捷入口（soft · M1 仍 open）

### 这轮到底做了啥（大白话）
第 36 次已经能从「下一步」打开手测/dogfood，但**退出证据四个芯片还是只能看、不能点**；打开文档后界面也**没有反馈**说成没成功。
这轮补上 **硬门槛辅助 + 可观测**（不是又一个就绪 projector）：

1. 新模块 `m1-exit-chip-action.ts`：芯片 id → 打开文档 / 刷新 / 无行动；`formatM1OpenDocFeedback` 把 IPC 结果变成中文条
2. 退出证据芯片可点：手测→打开清单；dogfood→今日日记；soft/dual→刷新计数
3. 打开后显示反馈条：已打开 / 已创建脚手架 / 失败原因（`m1-open-doc-feedback`）
4. 手测对照头增加 **打开手测文档** / **今日 dogfood** 快捷按钮
5. 「下一步」打开文档也复用同一反馈路径

### 我怎么测的
1. desktop：`m1-exit-chip-action` **7/7** + next **10/10** + open-doc **4/4** + exit **8/8** + handtest **8/8**（共 37）
2. dual 网关 **4/4**
3. desktop tsc + preload/renderer build + Electron 重启

### 结果（数字）
| 项 | 结果 |
|---|---|
| m1-exit-chip-action | **7/7 通过** |
| m1-next-action | **10/10 通过** |
| m1-open-doc | **4/4 通过** |
| m1-exit-evidence | **8/8 通过** |
| m1-handtest-checklist | **8/8 通过** |
| dual-http + dual-protocol | **4/4 通过** |
| desktop build | **通过** |
| Electron 重启 | **已重启** |
| 外网真实网关 UI 手测 | **还没做（0/18）** |
| dogfood ≥3 天 | **还没做** |

### 你会在界面上看到啥
1. 退出证据芯片：**手测 / dogfood 可点**打开系统编辑器；soft、dual 点击=刷新
2. 打开后出现状态条：如「已打开 14-external-gateway-handtest.md」或「已创建并打开 …（脚手架）」
3. 手测对照顶部两个胶囊按钮：**打开手测文档**、**今日 dogfood**
4. 可观测：`m1-exit-chip-btn-*` / `data-open-doc` / `m1-open-doc-feedback` / `m1-handtest-opens`

### 边界
- **M1 仍 open**；**未启动 M2**
- 打开文档 ≠ 完成手测/dogfood；仍要你真测真写
- 密钥仍勿入库

### 下一刀（仍不关 M1）
1. 你点退出证据「手测」芯片或「打开手测文档」→ 用真实外网密钥手测并勾选
2. 每天 dogfood 日记，凑满 ≥3 天
3. soft：只做失败边角/回归；勿再堆同质 projector

### 不启动
- **勿** 关 M1 · **勿** 启动 M2

## 2026-07-12 · 第 36 次自测 · 「下一步」真正可行动：重连 + 打开手测/dogfood 文档（soft · M1 仍 open）

### 这轮到底做了啥（大白话）
第 34 次的「下一步」会告诉你该干啥，但点按钮经常只是跳左侧面板或刷新计数——**打不开手测清单，也没法一键重连**。
这轮让主 CTA **真的做事**：

1. `projectM1NextAction` 增加 `ctaAction` / `openDoc`：reconnect · open-handtest · open-dogfood · jump · refresh
2. 离线时主按钮 = **重新连接 Runtime**（复用 #35 reconnect）
3. 硬门槛手测：主按钮 **打开 `14-external-gateway-handtest.md`**（系统默认编辑器）
4. dogfood：主按钮打开今日日记（没有则从模板创建）
5. 主进程白名单 IPC `desktop:m1-open-doc`（禁止任意路径）

### 我怎么测的
1. desktop：`m1-next-action` **10/10** + `m1-open-doc` **4/4**
2. dual 网关 **4/4**
3. desktop build + Electron 重启

### 结果（数字）
| 项 | 结果 |
|---|---|
| m1-next-action | **10/10 通过** |
| m1-open-doc | **4/4 通过** |
| dual-http + dual-protocol | **4/4 通过** |
| desktop build | **通过** |
| Electron 重启 | **已重启** |
| 外网真实网关 UI 手测 | **还没做（0/18）** |
| dogfood ≥3 天 | **还没做** |

### 你会在界面上看到啥
1. Runtime 离线：「下一步」主按钮变成 **重新连接 Runtime**
2. soft 已满、文档 0/18：主按钮 **打开手测清单**（会弹系统编辑器打开 md）
3. 手测齐、dogfood 不足：主按钮 **打开今日 dogfood**
4. 可观测：`data-cta-action` / `data-open-doc` / `m1-next-cta`

### 边界
- **M1 仍 open**；**未启动 M2**
- 打开文档 ≠ 完成手测/dogfood；仍要你真测真写
- IPC 只允许 handtest / dogfood / dogfood-today / dogfood-template 四个 id

### 下一刀（仍不关 M1）
1. 你点「打开手测清单」→ 用真实外网密钥手测并勾选（密钥勿入库）
2. 每天 dogfood 日记，凑满 ≥3 天
3. soft：失败边角/回归即可，勿再堆同质 projector

### 不启动
- **勿** 关 M1 · **勿** 启动 M2

## 2026-07-12 · 第 35 次自测 · Runtime 离线手动重连 CTA（soft · M1 仍 open）

### 这轮到底做了啥（大白话）
之前 Runtime 断了只会显示「暂不可用」，**没法点一下再连**；失败原因码也看不到。
这轮补上 **离线/失败可观测 + 手动重连**：

1. `projectConversationStreamReadiness`：离线时显示失败码中文提示、`showReconnectCta`、按钮文案/hint
2. `runtimeViewReducer`：`lastConnectFailure` + `reconnect-requested`（进入 connecting，保留上次失败码直到成功）
3. 桌面：事件监听与连接生命周期拆分；点「重新连接 Runtime」取消在途重试并重新 `startRuntimeConnection`
4. 对话流就绪条 + 空对话区都有 CTA；发送失败也会带上 bridge 错误码

### 我怎么测的
1. desktop：`conversation-stream-readiness` **9/9** + `runtime-connection` **5/5**（含 reconnect 1 条）
2. dual 网关 **4/4**
3. desktop `tsc` + preload/renderer build + Electron 重启

### 结果（数字）
| 项 | 结果 |
|---|---|
| conversation-stream-readiness | **9/9 通过** |
| runtime-connection（含 reconnect） | **5/5 通过** |
| dual-http + dual-protocol | **4/4 通过** |
| desktop build | **通过** |
| Electron 重启 | **已重启** |
| 外网真实网关 UI 手测 | **还没做（0/18）** |
| dogfood ≥3 天 | **还没做** |

### 你会在界面上看到啥
1. Runtime 离线时：对话流顶条徽章「离线」，标题带失败原因（如「进程不可用」）
2. 主按钮 **「重新连接 Runtime」**（不可自动重试时文案为「仍要重试连接」）
3. 旁注显示上次失败码；连接中按钮 disabled
4. 空对话区同样有重连按钮
5. 可观测：`conversation-runtime-reconnect` / `data-failure-code`

### 边界
- **M1 仍 open**；**未启动 M2**
- 这是失败恢复 UX，**不是**外网手测/dogfood 退出证据
- 重连成功后会重新拉 workspace/providers/agent 等目录

### 下一刀（仍不关 M1）
1. **硬门槛**：你在 `14-external-gateway-handtest.md` 用真实外网密钥手测（密钥勿入库）
2. dogfood 真实日记 ≥3 天
3. soft：只做失败边角/回归，勿再堆同质 projector

### 不启动
- **勿** 关 M1 · **勿** 启动 M2

## 2026-07-12 · 第 34 次自测 · M1「下一步」主行动条（soft · M1 仍 open）

### 这轮到底做了啥（大白话）
退出证据 + 手测对照都齐了，但还缺一句：**现在最该干什么**。
这轮加一条简洁的 **「下一步」主行动**（唯一 CTA），按优先级自动挑一条：

1. 纯函数 `projectM1NextAction`（连 Runtime → 任务 → Providers → Agent → 外网手测 → dogfood → 可讨论关 M1）
2. 任务头：退出证据与手测对照之间插入 `m1-next-action`
3. CTA：能跳面板就闪跳；否则刷新退出证据计数
4. 分 `soft` / `hard` 闸门；**绝不**自动关 M1、不写文档勾选

### 我怎么测的
1. desktop：`m1-next-action` **9/9** + handtest **8/8** + exit **8/8**（共 25）
2. dual 网关 **4/4**
3. desktop build + Electron 重启

### 结果（数字）
| 项 | 结果 |
|---|---|
| m1-next-action | **9/9 通过** |
| m1-handtest-checklist | **8/8 通过** |
| m1-exit-evidence | **8/8 通过** |
| dual-http + dual-protocol | **4/4 通过** |
| desktop build | **通过** |
| Electron 重启 | **已重启** |
| 外网真实网关 UI 手测 | **还没做（0/18）** |
| dogfood ≥3 天 | **还没做** |

### 你会在界面上看到啥
1. 任务头：**会话就绪 → 退出证据 →「下一步」→ 手测对照**
2. 标题 + 说明 + 主按钮 + soft/硬门槛徽章 + P 优先级
3. 典型冷启动：未连 Runtime / 无任务 / 缺 Provider → 对应 CTA 跳左侧
4. soft 已满且文档 0/18 时：主行动变成 **「下一步：外网网关 UI 手测」**（硬门槛）

### 边界
- **M1 仍 open**；**未启动 M2**
- 这是导航/决策辅助，不是退出证据本身
- 关 M1 仍需：外网手测全勾 + dogfood ≥3 天真实日记 + 人工决策

### 下一刀（仍不关 M1）
1. 你在 `14-external-gateway-handtest.md` 用真实外网密钥手测（密钥勿入库）
2. 写 dogfood 真实日记 ≥3 天
3. soft 侧优先失败/离线边角或回归包，避免再堆同质 projector

### 不启动
- **勿** 关 M1 · **勿** 启动 M2

## 2026-07-12 · 第 33 次自测 · 手测项点击跳转面板（soft · M1 仍 open）

### 这轮到底做了啥（大白话）
第 32 次把手测 18 条搬到界面后，你仍要自己在左侧找 Providers / Agent / 轨迹。
这轮补上 **点击即跳**：可跳转的手测行 → 闪烁对应左侧/轨迹面板（和会话芯片同一套 navigate）。

1. 纯函数 `resolveM1HandtestItemJump` / `isM1HandtestItemJumpable`
2. 投影每项带 `jumpTarget` / `jumpHint`
3. UI：`m1-handtest-jump-*` 按钮行；`data-jump` / `data-jumpable`
4. Compose-only / 重启 / 已知限制 等仍 `none`（不可点，tooltip 说明）

### 我怎么测的
1. desktop：`m1-handtest-checklist` **8/8**（含 jump 3 条）+ exit **8/8**
2. dual 网关 **4/4**
3. desktop build + Electron 重启

### 结果（数字）
| 项 | 结果 |
|---|---|
| m1-handtest-checklist | **8/8 通过** |
| m1-exit-evidence | **8/8 通过** |
| dual-http + dual-protocol | **4/4 通过** |
| desktop build | **通过** |
| Electron 重启 | **已重启** |
| 外网真实网关 UI 手测 | **还没做（文档 0/18）** |
| dogfood ≥3 天 | **还没做** |

### 你会在界面上看到啥
1. 手测对照列表：带边框/可点的行 = 可跳转
2. 点「≥2 Provider」「Agent 默认」「Trace」「Manifest」等 → 左侧或轨迹栏闪一下
3. 「发送就绪 / 重启 / 已知限制」不可点（hint 告诉你看哪）
4. 跳转 ≠ 完成手测；外网项仍要你真做并勾文档

### 边界
- **M1 仍 open**；**未启动 M2**
- soft 导航可观测，**不**写文档勾选、**不**关 M1

### 下一刀（仍不关 M1）
1. **硬门槛**：`14-external-gateway-handtest.md` 外网真密钥手测（密钥勿入库）
2. dogfood 第 1 天真实日记
3. soft 若无密钥：失败/离线 UX 或回归包，勿堆无意义 projector

### 不启动
- **勿** 关 M1 · **勿** 启动 M2

## 2026-07-12 · 第 32 次自测 · 手测对照清单 live 投影（soft · M1 仍 open）

### 这轮到底做了啥（大白话）
退出证据条告诉你「手测 0/18」，但**18 条具体差什么**还得翻 `14-external-gateway-handtest.md`。

这轮把手测清单 **搬到界面**，紧贴退出证据条：

1. 纯模块 `m1-handtest-checklist.ts`：18 项与文档对齐（pre / A / B / C / D）
2. 每项分闸门：`live`（本机 soft 状态可推断） vs `external`（必须外网真网关 / 故意失败 / 多日）
3. 投影 `projectM1HandtestChecklist`：汇总本机 pass 数、文档勾选数、摘要与备注
4. UI：`m1-handtest-checklist` 列表 + **已知限制**折叠（对应手测 D，不自动勾文档）
5. **绝不**把 live 通过写成「外网手测完成」，也**不**自动关 M1

### 我怎么测的
1. desktop：`m1-handtest-checklist.test.ts` **5/5** + `m1-exit-evidence` **8/8**（共 13）
2. runtime dual-http + dual-protocol：**4/4**
3. desktop build **通过** + Electron `dev-0001` / `DEV_NO_TOKEN` 重启

### 结果（数字）
| 项 | 结果 |
|---|---|
| m1-handtest-checklist | **5/5 通过** |
| m1-exit-evidence | **8/8 通过** |
| dual-http + dual-protocol | **4/4 通过** |
| desktop build | **通过** |
| Electron 重启 | **已重启** |
| 外网真实网关 UI 手测文档 | **仍 0/18（未实填）** |
| dogfood ≥3 天 | **还没做** |

### 你会在界面上看到啥
1. 任务头「退出证据」下方：**手测对照** 条（`m1-handtest-checklist`）
2. 摘要类似：本机 x/y · 文档 0/18
3. 每项：标签 + 本机/外网 闸门 + 当前 detail
4. 展开 **已知限制**：dual 不能替代外网、协作/自动属 M2、密钥不入库等
5. 本机 Runtime/任务/Provider 就绪时 live 项会变 ✓；`external` 项仍 pending，直到你真做外网手测并勾文档

### 边界
- **M1 仍 open**；**未启动 M2**
- live 投影 = 可观测 / 对照，**不是** `14-external-gateway-handtest.md` 的人工证据
- 关 M1 仍需：文档手测勾选 + dogfood ≥3 天真实日记 + 人工决策

### 下一刀（仍不关 M1）
1. **硬门槛**：你在 `14-external-gateway-handtest.md` 用真实外网密钥手测并勾选（密钥勿入库）
2. 或 dogfood 第 1 天真实日记（脚手架不计有效天）
3. soft 若仍无密钥：空态/失败/离线 UX 加固或回归包，**不**为凑数再堆面板 projector

### 不启动
- **勿** 关 M1 · **勿** 启动 M2

## 2026-07-12 · 第 29 次 soft craft · 会话就绪 Memory 芯片 + dual 复测（soft · M1 仍 open）

## 2026-07-12 · 第 31 次自测 · M1 退出证据进度条（soft · M1 仍 open）

### 这轮到底做了啥（大白话）
面板就绪条都齐了，但「离关 M1 还差什么」仍埋在文档里——手测 0/18、dogfood 脚手架，界面上看不到。

这轮把 **硬门槛进度** 拉到任务头，紧贴「会话就绪」：

1. 纯函数 `projectM1ExitEvidenceProgress` + 勾选计数 / dogfood 脚手架启发式
2. 受限 IPC `desktop:m1-exit-evidence`：只读仓库 `docs/development` 下手测清单与 dogfood 日记（**不读密钥**）
3. UI「退出证据」条：本机 soft · 本地 dual · 外网手测 x/y · dogfood n/3
4. **刷新**按钮可重读文档；**绝不**自动关 M1

### 我怎么测的
1. desktop：`m1-exit-evidence.test.ts` **8/8**
2. dual 网关 **4/4**
3. desktop build + Electron 重启

### 结果（数字）
| 项 | 结果 |
|---|---|
| m1-exit-evidence | **8/8 通过** |
| dual-http + dual-protocol | **4/4 通过** |
| desktop build | **通过** |
| Electron 重启 | **已重启** |
| 外网真实网关 UI 手测 | **还没做（界面应显示 0/N）** |
| dogfood ≥3 天有效 | **还没做（脚手架不计有效天）** |

### 你会在界面上看到啥
1. 会话就绪下方：**退出证据** 条（`m1-exit-evidence`）
2. 芯片：本机 soft / 本地 dual / 外网手测 / dogfood
3. 当前预期：soft 可能 partial/ready，手测 **0/x**，dogfood **0/3**，摘要类似「soft 已满 · 硬门槛仍缺」或「退出证据推进中」
4. 点 **刷新**：你勾选手测或写 dogfood 后可立刻更新计数

### 边界
- **M1 仍 open**；**未启动 M2**
- 本条是 **可观测**，不是退出证据本身
- 关 M1 仍需：外网手测全勾 + dogfood ≥3 天真实日记 + 人工决策

### 下一刀
- 你在 `14-external-gateway-handtest.md` 实填并勾选
- 或写 dogfood 第 1 天真实使用
- 勿关 M1、勿开 M2

## 2026-07-12 · 第 30 次自测 · 会话芯片跳转面板（soft · M1 仍 open）

### 这轮到底做了啥（大白话）
各面板的就绪条已经齐了，但任务头「会话就绪」那一排芯片只能看、不能点——缺项时还要自己在左侧找 Providers / Agent / 审批 / Memory。

这轮做了**跨面板导航集成**（不是再抽一个纯投影）：

1. 给每个会话芯片挂上 **jumpTarget + jumpHint**（纯函数 `resolveM1SessionChipJump` / `isM1SessionChipJumpable`）
2. 可跳转的芯片变成按钮：点一下 → 左侧对应面板 **滚动 + 高亮闪一下**
3. Manifest / 轨迹芯片：若轨迹栏收起会先 **展开**，再闪 Manifest 或轨迹列表
4. Runtime 芯片不可跳（只说明状态）；其余 8 个可跳

### 我怎么测的
1. desktop：`m1-session-readiness.test.ts`（含 jump 套件）
2. dual 网关复测（防回归）
3. desktop build + Electron 重启

### 结果（数字）
| 项 | 结果 |
|---|---|
| m1-session-readiness | **7/7 通过**（原 5 + jump 2） |
| dual-http + dual-protocol | **4/4 通过** |
| desktop build | **通过** |
| Electron 重启 | **已重启** |
| 外网真实网关 UI 手测 | **还没做** |
| dogfood ≥3 天 | **还没做** |

### 你会在界面上看到啥
1. 会话就绪芯片可点（可跳的右边有小 ↗）
2. 点 **Provider / 模型** → 左侧 Providers 闪一下
3. 点 **Agent / 审批 / Memory / 任务** → 对应左侧区块
4. 点 **Manifest / 轨迹·主题** → 展开右侧轨迹并闪目标
5. 悬停有中文提示（跳到哪里、补什么）

### 边界
- **M1 仍 open**；**未启动 M2**
- soft 可观测导航 **不能** 代替外网手测 + dogfood

### 下一刀
- 外网网关 UI 手测清单实填（`14-external-gateway-handtest.md`）
- 或 dogfood 日记第 1 天真实使用
- 勿关 M1、勿开 M2

### 我做了什么
- 扩展 `projectM1SessionReadiness`：新增 Memory 芯片与 `memoryEntryCount / memoryPendingCount / memoryDiagCount / memoryOk`。
- ready 条件在原 soft 门槛上增加 **Memory 无待审**；有 MemoryChange 待审时 summary/note 指向 Memory 面板。
- Desktop `index.tsx` 接线：从 `memoryEntries / memoryChanges / diagnostics` 投影到会话条。
- 同轮：第 27 批准中心、第 28 Memory 面板纯投影已落地。

### 自己怎么测的
1. desktop：`vitest run tests/m1-session-readiness.test.ts` → **5/5**
2. runtime dual：`dual-http-gateway` + `dual-protocol-gateway` → **4/4**
3. desktop build 通过；Electron `dev-0001` 重启

### 大白话结论
- 任务头「会话就绪」现在多一枚 **Memory** 芯片：尚无证据 / N 条·诊M / 待审 K。
- 有 Memory 待审时会话 soft 不再显示「就绪」，避免你漏批记忆变更。
- dual 本地网关仍绿，但 **不能** 替代外网真实网关 UI 手测。
- **仍不关 M1**：外网手测清单 + dogfood ≥3 天未完成。

### 可观测点
- 会话条 chips：`runtime / task / providers / models / manifest / trace-theme / agent / approval / memory`
- 右侧：`approval-gate-*` · `memory-m1-*` · `agent-capability-*`

### 下一次优先（仍不关 M1）
1. 你本机按 `14-external-gateway-handtest.md` 填真实密钥做外网手测（密钥勿入库）
2. 或把 `dogfood/2026-07-12.md` 从脚手架改成真实日记，并连写 ≥3 天
3. 软边角已基本齐：Agent / 批准 / Memory / 会话条

### 不启动
- **勿** 关 M1 · **勿** 启动 M2

## 2026-07-12 · 第 28 次 soft craft · Memory/Diagnostics 就绪纯投影（soft · M1 仍 open）

### 我做了什么
- 从 `MemoryDiagnosticsPanel` 抽出 `projectMemoryDiagnosticsReadiness`（§10.4 / §19 / §23.2）。
- 输入：持久记忆条数、待审/已决 MemoryChange、诊断数、已知限制数。
- 输出：`empty | partial | ready | attention` + badge/note + checks flags。
- UI 接线 + 根节点 `memory-diagnostics-panel` `data-level`；去 BOM。
- 同轮已完成第 27 次批准中心投影（见上条）。

### 自己怎么测的
1. `pnpm exec vitest run tests/MemoryDiagnosticsPanel.test.tsx` → **12/12**（UI 6 + 纯投影 6）
2. 第 27 次批准中心：`ApprovalCenterPanel.test.tsx` **13/13**
3. ui-kit + desktop build 通过；Electron `dev-0001` 重启

### 大白话结论
- Memory 面板「记忆与诊断」就绪条可单测：无数据「未连接」；仅已知限制「仅限制说明」；有记忆/决策/诊断「证据在线」；有待审「N 待审」。
- 批准中心 + Agent + Memory 三大右侧仪器就绪投影已齐。
- **仍不关 M1**：缺外网真实网关 UI 手测 + dogfood ≥3 天。

### 可观测点
- `memory-diagnostics-panel` / `memory-m1-readiness` / badge / note / checks
- 批准中心：`approval-gate-*`（第 27 次）
- Agent：`agent-capability-*`（第 26 次）

### 下一次优先（仍不关 M1）
- **优先推进硬门槛**：外网网关 UI 手测清单 / dogfood 第 1 天日记骨架填写
- 或 dual 网关再复测 + 会话级 readiness 汇总条

### 不启动
- **勿** 关 M1 · **勿** 启动 M2

## 2026-07-12 · 第 27 次 soft craft · 批准中心闸门就绪纯投影（soft · M1 仍 open）

### 我做了什么
- 从 `ApprovalCenterPanel` 抽出纯函数 `projectApprovalGateReadiness`（§13 批准闸门）。
- 输入：队列 items、pendingCount、仅限真人策略列表 / fallback。
- 输出：`empty | partial | ready | attention` + badge/countLabel/note + 桥接种类 flags。
- UI 接线：readiness 条与 note 统一走 projector；根节点 `data-level`。
- 解析规则：主机非空列表 > 非空 fallback > 显式空数组（可测 empty/partial）> 内置 7 类。

### 自己怎么测的
1. `packages/ui-kit`：`pnpm exec vitest run tests/ApprovalCenterPanel.test.tsx` → **13/13**  
   - 原有 UI 用例仍过  
   - 新增 `projectApprovalGateReadiness` **7** 条  
2. ui-kit + desktop build 通过  
3. Electron 以 `dev-0001` / `DEV_NO_TOKEN` 重启  

### 大白话结论
- 批准中心顶部「批准闸门」现在**可单测、可复用**：  
  - 无待审 + 有仅限真人策略 → **闸门空闲**  
  - 有待审 → **N 待审**（attention）  
  - 无策略无队列 → **尚未观测**  
  - 有历史但无策略 → **进行中**  
- Memory / Skill / MCP / 工具 桥接种类仍在 checks 上可观测。  
- **不等于关 M1**：外网真实网关 UI 手测 + dogfood ≥3 天仍缺。

### 可观测点
- `approval-center-panel` `data-level`
- `approval-gate-readiness` / badge / note
- checks：`approval-gate-check-human|pending|history|bridge`

### 下一次优先（仍不关 M1）
- 外网网关 UI 手测，或 dogfood 第 1 天，或  
- 下一组件：`MemoryDiagnosticsPanel` 纯投影

### 不启动
- **勿** 关 M1 · **勿** 启动 M2

## 2026-07-12 · 第 26 次 soft craft · Agent 能力就绪纯投影（soft · M1 仍 open）

### 我做了什么
- 从 `AgentBindingPanel` 抽出纯函数 `projectAgentCapabilityReadiness`（与 Compose / Providers 同一模式）。
- 输入：是否加载 binding、默认模型、fallback 链、凭证组/固定密钥、Skill/MCP 白名单与库规模。
- 输出：`empty | partial | ready` + 中文 badge/note + 各 check 布尔/计数。
- UI 的 readiness 条改为调用该 projector；根节点加 `data-testid="agent-binding-panel"` 与 `data-level`。
- 说明文案统一走 `capability.note`（empty / 缺模型 / partial / ready 四档）。

### 自己怎么测的
1. `packages/ui-kit`：`pnpm exec vitest run tests/AgentBindingPanel.test.tsx` → **27/27** 通过  
   - 原有 UI 用例（empty / partial / ready / dirty）仍过  
   - 新增 `describe('projectAgentCapabilityReadiness')` **8** 条纯投影用例  
2. `pnpm run build` ui-kit → 通过  
3. `pnpm run build` desktop → 通过  
4. 停掉旧 Electron 后以 `SYNC_THINK_INSTALL_ID=dev-0001` `SYNC_THINK_DEV_NO_TOKEN=1` 重启 apps/desktop  

### 大白话结论
- Agent「能力就绪」现在**可单测、可复用、可观测**：没绑 Agent 显示「未加载」；有 Agent 没默认模型显示「缺默认模型」；只有默认模型是「进行中」；模型 + 凭证组 +（fallback 或 Skill 或 MCP 白名单）才是「能力已配」。
- **仍然不等于关 M1**：外网真实网关 UI 手测 + dogfood ≥3 天还没做。
- 导入 Skill / 登记 MCP **不会**自动进白名单——这条逻辑没变，只是投影抽干净了。

### 可观测点
- `agent-binding-panel` `data-level`
- `agent-capability-readiness` / `agent-capability-badge` / `agent-capability-note`
- checks：`agent-cap-check-model|fallback|cred|skill|mcp|dirty`

### 下一次优先（仍不关 M1）
- 外网网关 UI 手测（`14-external-gateway-handtest.md`），或  
- dogfood 日记第 1 天，或  
- 下一组件纯投影：`ApprovalCenterPanel` / `MemoryDiagnosticsPanel`

### 不启动
- **勿** 关 M1  
- **勿** 启动 M2

# 大白话自测记录（固定文档）

## 第 25 次 · 2026-07-12 · Compose「发送就绪」纯投影（soft · M1 仍 open）

### 我做了啥
- 把 Compose 底部 **「发送就绪」** 条从组件内联计算，抽成纯函数 `projectComposeSendReadiness`。
- 输入：正文 / Runtime 连接 / 任务是否打开 / 模型目录 / 本轮覆盖 vs Agent 默认 / 多 Provider / 流式 / disabled。
- 五档：`ready` 可发送 · `partial` 准备中 · `blocked` 暂不可发送 · `streaming` 流式中 · `empty` 等待配置。
- 表单根节点带 `data-level`，与就绪条同步，方便一眼看发送状态。
- 备注仍是行动向：先开任务 / Runtime 未连 / 输入后 Ctrl+Enter / Esc 取消流式等。

### 你怎么看变化
1. 对话底部 Compose 上方：**发送就绪** 条（`compose-send-readiness`）。
2. 输入文字 + 在线 + 有任务 + 有模型 → 徽章 **「可发送」**。
3. 流式中 → **「流式中」**；未开任务且 disabled → **「暂不可发送」**。
4. soft 可观测 **不等于** 关 M1。

### 自测结果（大白话）
| 项 | 结果 |
|---|---|
| Compose 单测 | **25/25 通过**（含 projector 4） |
| ui-kit build | **通过** |
| desktop build | **通过** |
| Electron | **重建后重启** |
| 外网真实网关 UI 手测 | **还没做** |
| dogfood ≥3 天 | **还没做** |
| M1 关闭 | **否** |
| M2 启动 | **否** |

### 还没完成（M1 退出门槛）
- 外网真实网关 UI 手测（`14-external-gateway-handtest.md`）——真密钥只放本机
- dogfood 真实日记 ≥3 天

### 下一刀（仍不关 M1）
- 你本机外网手测；或 dogfood 日记；或继续 Agent / Approval / Memory 纯投影

## 第 24 次 · 2026-07-12 · Providers 多模型就绪纯投影 + dual 网关复测（soft · M1 仍 open）

### 我做了啥
- 把 Providers 面板顶部的 **「多模型就绪」** 从组件内联计算，抽成纯函数 `projectProvidersReadiness`（可单测、可复用）。
- 门槛仍是 M1 soft：**≥2 Provider / ≥3 模型**；另外可观测：密钥遮罩写入、协议种类、是否跨协议。
- 三档：`empty` 尚未配置 · `partial` 进行中 · `ready` 已达 soft 门槛。
- 备注按缺口细分（缺 Provider / 缺模型 / 已满且跨协议等），并再次写明：**关 M1 仍要外网手测 + dogfood ≥3 天**。
- 根节点 `providers-panel` 带 `data-level`；徽章与 note 统一走投影。
- 复测本机 dual-http + dual-protocol 网关自动化（假网关，**不是**外网真密钥）。

### 你怎么看变化
1. 打开 Providers → 顶部 **多模型就绪** 条（`provider-m1-readiness`）。
2. 0 配置 →「尚未配置」；1 个 Provider →「进行中」；≥2 Provider 且 ≥3 模型 →「已达 soft 门槛」。
3. 跨 OpenAI/Anthropic 时协议 check 显示「已跨协议」。
4. **soft 门槛已满 ≠ 关 M1**。

### 自测结果（大白话）
| 项 | 结果 |
|---|---|
| ProvidersPanel 单测 | **10/10 通过**（含 projector 4） |
| dual-http + dual-protocol | **4/4 通过** |
| ui-kit build | **通过** |
| desktop build | **通过** |
| Electron | **重建后重启** |
| 外网真实网关 UI 手测 | **还没做** |
| dogfood ≥3 天 | **还没做** |
| M1 关闭 | **否** |
| M2 启动 | **否** |

### 还没完成（M1 退出门槛）
- 外网真实网关 UI 手测（`14-external-gateway-handtest.md`）——真密钥只放本机，**不要写进仓库**
- dogfood 真实日记 ≥3 天

### 下一刀（仍不关 M1）
- 你本机按手测清单走外网网关；或
- 写 dogfood 日记第 1 天；或
- 继续把 Compose / Agent / Approval / Memory 也抽成纯投影（若还要 soft 边角）

## 第 23 次 · 2026-07-12 · WorkspaceNav 工作区导航就绪投影（soft · M1 仍 open）

### 我做了啥
- 把左侧 **工作区导航** 从「半成品 IA 条」升级成和 AppShell / Mode / Manifest 同款的 **纯函数就绪投影**。
- 新函数 `projectWorkspaceNavReadiness`：看文件夹数、任务数、嵌套子任务、当前任务、Runtime 连接、筛选状态。
- 四档：
  - `empty` 等待文件夹
  - `partial` 仅有文件夹 / 待选任务
  - `ready` 任务已打开
  - `filtering` 筛选中 / 无匹配
- 左侧底部条改称 **「工作区导航」**：6 项 checks（文件夹 / 任务 / 嵌套子任务 / 当前任务 / Runtime / 筛选）+ 徽章 + 备注。
- 根节点 `data-level` 与条同步；图标 `LayoutList`；筛选无匹配时徽章「无匹配」，Esc 清空搜索的说明写在 note 里。

### 你怎么看变化
1. 打开桌面端 → 看**左侧底部**就绪条标题变为 **工作区导航**（仍是 `workspace-nav-ia-strip`）。
2. 有文件夹+任务+当前任务 → 徽章 **「任务已打开」**；嵌套子任务有绿点。
3. 在搜索框打关键字 → 徽章 **「筛选中」**；无结果 → **「无匹配」**。
4. 这是 **M1 soft 可观测**，**不等于**关 M1。

### 自测结果（大白话）
| 项 | 结果 |
|---|---|
| WorkspaceNav 单测 | **13/13 通过**（IA + filtering + nested + projector） |
| ui-kit build | **通过** |
| desktop build | **通过** |
| Electron | **重建后重启** |
| 外网真实网关 UI 手测 | **还没做** |
| dogfood ≥3 天 | **还没做** |
| M1 关闭 | **否** |
| M2 启动 | **否** |

### 还没完成（M1 退出门槛）
- 外网真实网关 UI 手测（`14-external-gateway-handtest.md`）——真密钥只放本机，**不要写进仓库**
- dogfood 真实日记 ≥3 天

### 下一刀（仍不关 M1）
- 你本机按手测清单走外网网关；或
- 写 dogfood 日记第 1 天；或
- dual 网关再复测 / 其它 soft 边角

## 第 22 次 · 2026-07-12 · AppShell 工作区布局就绪条（soft · M1 仍 open）

### 我做了啥
- 把主工作区骨架 **AppShell** 做成和 Providers / Compose / Trace / Continuum / Manifest / Mode 同款的**可观测就绪条**。
- 纯函数 `projectAppShellReadiness`：看左侧导航、对话列、Compose、连续体、运行轨迹（是否折叠）、主题。
- 四档：
  - `empty` 空壳
  - `partial` 布局不全（核心栏位 < 4）
  - `ready` 布局就绪（四核心齐全且轨迹展开）
  - `compact` 轨迹已折（四核心齐全但右侧折叠；**折叠不暂停 Run**）
- 右侧轨迹栏顶部有 **「工作区布局」** 条：6 项 checks + 徽章 + 备注；折叠时压缩成竖排徽章，图标仍可见。
- 快捷键仍是 **Ctrl+\\** 折叠/展开轨迹；图标换成更贴「工作区」语义的 `LayoutPanelLeft`。
- CSS：ready/partial/compact 色边；折叠态只留图标+竖排徽章，简洁大气。

### 你怎么看变化
1. 打开桌面端 → 看**右侧「运行轨迹」栏顶部**，应有 **工作区布局** 就绪条（`app-shell-readiness`）。
2. 正常全布局 + 主题 → 徽章 **「布局就绪」**；六格 checks 多为绿点。
3. 点折叠轨迹 / Ctrl+\\ → 徽章变 **「轨迹已折」**（compact），列表与备注收起，竖排徽章保留。
4. 这是 **M1 soft 可观测**，**不等于**关 M1。

### 自测结果（大白话）
| 项 | 结果 |
|---|---|
| AppShell 单测 | **14/14 通过**（含 readiness 4 + projector 3 + 原有 IA） |
| ui-kit build | **通过** |
| desktop build | **通过** |
| Electron | **重建后重启** |
| 外网真实网关 UI 手测 | **还没做** |
| dogfood ≥3 天 | **还没做** |
| M1 关闭 | **否** |
| M2 启动 | **否** |

### 还没完成（M1 退出门槛）
- 外网真实网关 UI 手测（`14-external-gateway-handtest.md`）——需要你本机真密钥，**不要写进仓库**
- dogfood 真实日记 ≥3 天

### 下一刀（仍不关 M1）
- 你本机按手测清单走外网网关；或
- 写 dogfood 日记第 1 天；或
- 继续 soft：WorkspaceNav IA 可观测边角 / dual 网关再复测

## 第 21 次 · 2026-07-12 · 参与模式（ModeSwitch）就绪条 + dual 网关复测（soft · M1 仍 open）

### 我做了啥
- 给顶部 **参与模式** 切换器加了就绪条，让你一眼知道：现在是不是 M1「对话」可用，协作/自动是不是还被 M2 锁着。
- 纯函数 `projectModeReadiness`：看当前模式 + 协作/自动是否禁用。
- 四档：`m1`（M1 对话）· `mixed`（部分开放）· `m2-open`（M2 已开）· `locked`（模式受限）。
- 四项 checks：对话 / 协作 / 自动 / 门控。
- 桌面端本来就把协作+自动 disabled，所以你会看到 **「M1 对话」** 绿徽章 +「协作锁定 · M2」「自动锁定 · M2」。
- 复测 dual-http + dual-protocol 网关：**4/4** 绿（本机假网关，不是外网真密钥）。

### 你怎么看变化
1. 任务头附近 / 模式切换器上方：应有 **「参与模式」** 就绪条。
2. 徽章：**M1 对话**。
3. 协作、自动按钮仍灰，就绪条也写明锁定。
4. 这 **不是** 开 M2，只是把门控说清楚。

### 自测结果（大白话）
| 项 | 结果 |
|---|---|
| ModeSwitch 单测 | **10/10 通过** |
| dual-http + dual-protocol | **4/4 通过** |
| ui-kit + desktop build | **通过** |
| Electron | 重启加载新 dist |
| M1 关闭 | **否**（外网手测 + dogfood 仍缺） |
| M2 启动 | **否** |

### 还没完成
- 外网真实网关 UI 手测（`14-external-gateway-handtest.md`）——需要你本机真密钥，不要写进仓库
- dogfood 真实日记 ≥3 天

---


## 第 20 次 · 2026-07-12 · Manifest「可检查」就绪条（soft · M1 仍 open）

### 我做了啥
- 给 Manifest 面板加了和 Providers / Compose / Trace / Continuum 同款的**就绪条**。
- 纯函数 `projectManifestReadiness`：看调用次数、选中、绑定阶梯、proof、入包/排除、Skill/工具、跨任务·证据、预览/修订。
- 四档：`empty`（静默/可预览）· `partial` · `inspectable`（可检查）· `amended`（已修订）。
- 样式：`st-manifest__readiness*`，和别的就绪条视觉对齐；面板本身也带 `data-level`。
- 测试：empty / inspectable / amended / hide + projector 3 条；整文件 **22/22** 绿。
- 构建：ui-kit + desktop **GREEN**；准备重启 Electron 让你肉眼看。

### 你怎么看变化
1. 打开桌面端 → 右侧/Manifest 区域顶部应有 **「Manifest 可检查」** 条。
2. 没发过消息时：徽章多半是「可预览」或「静默」，调用=尚无。
3. 有调用记录时：应显示「可检查」，入包/Proof/绑定阶梯点亮。
4. 排除某个源后：应变「已修订」。

### 自测结果（大白话）
- ManifestPanel 单测 **22 通过**（原先约 15 + 本次 7）。
- TypeScript 构建过关。
- **没有**关掉 M1，也**没有**开 M2。
- 外网真密钥手测、dogfood ≥3 天仍没做——那是正式退出 M1 的硬门槛。

### 还没完成
- 外网真实网关 UI 手测（`14-external-gateway-handtest.md`）
- dogfood 真实日记 ≥3 天

---


> 路径：`docs/development/13-plain-selftest-log.md`  
> 用途：每次我（AI）按设计方案自测后，用大白话写在这里，方便你完成后查阅。  
> 规则：只追加、不删历史；**M1 未达退出证据前不写“M1 完成”**；不启动 M2。

---

## 2026-07-12 · 第 1 次自测 · MCP 刷新工具目录（mcp.tools.refresh）

### 这轮到底做了啥（大白话）
以前你登记 MCP 时，工具列表要么手填，要么空着。  
现在多了一个按钮 **「刷新工具目录」**：程序会真的拉起本机 MCP 进程，用 JSON-RPC 问它“你有哪些工具”（`tools/list`），把名字和 Schema 存进注册表。  
**不会**去真正调用工具；**不会**偷偷写进 Agent 白名单。

另外我补了 UI 可观测：每个 MCP 下面会显示工具名小标签（chips）；目录空时提示「目录空 · 可刷新工具目录」。

### 我怎么测的
1. workers：list-tools + jsonrpc 解析测试  
2. runtime：`mcp-commands` 全套（含：空目录登记 → 刷新发现 echo/ping/write_file → 持久化 → 绑定白名单 → Context Packet peek 出现 tool-schema → fake 端点拒绝且不抹旧目录）  
3. ui-kit：Agent 面板刷新按钮 + 工具名 chips  
4. desktop：TypeScript build（含 preload / renderer）

### 结果（数字）
| 项 | 结果 |
|---|---|
| workers list-tools / jsonrpc | **16/16 通过** |
| runtime mcp-commands | **7/7 通过** |
| ui-kit AgentBindingPanel | **14/14 通过** |
| desktop build | **通过** |
| 外网真实网关 UI 手测 | **还没做**（M1 退出证据仍缺） |
| dogfood ≥3 天 | **还没做** |

### 你会在界面上看到啥
1. Agent → MCP 登记 mini-mcp：  
   `node "D:\\projects\\SYNC-THINK\\packages\\workers\\src\\mcp\\fixtures\\mini-mcp-server.mjs"`  
   tools 可先空  
2. 点 **刷新工具目录**  
3. 状态条类似：`工具目录 · spawned · ok · jsonrpc · tools=3 · 新增 echo,ping,write_file …`  
4. 列表项下出现 **echo / ping / write_file** 小标签  
5. 勾选 MCP 并保存绑定后，Manifest 预览里应能看到 **工具 Schema** 来源  
6. fake:// 刷新应失败，且旧目录不丢

### 边界（按设计 §9.3）
- 输出限幅 / 超时 / untrusted / 有审计  
- 注册 ≠ 可用；只有 Agent 白名单才进 Context Packet  
- 真执行仍走审批 + `mcp.tool.call`  
- **M1 仍 open**

### 下一刀（仍不关 M1）
- 你本机点一遍上面 1–5（最有说服力）  
- 或补 dogfood 模板 / 外网网关手测清单  
- 禁止开始 M2 工作流图

---


## 2026-07-11 22:26:23 · 脚本自测 · mcp-refresh 门禁

### 大白话
我跑了固定脚本 `scripts/selftest-mcp-refresh.mjs`，把 workers / runtime / UI / desktop build 再验一遍。  
这不是外网手测，也不是 dogfood 满 3 天，所以 **不能据此关闭 M1**。

### 结果
- 通过 · workers list-tools/jsonrpc · 16 tests path GREEN
- 通过 · runtime mcp-commands (含 refresh→bind→peek) · 7/7 GREEN
- 通过 · ui-kit AgentBindingPanel · 14/14 GREEN
- 通过 · desktop build · tsc + preload + renderer GREEN

### 总评
自动化门禁全绿。 M1 仍 open。

---


## 2026-07-12 · 第 2 次自测 · 工具 chips 可点填 + DOM 结构修正

### 大白话
刷新目录之后，每个 MCP 下面会列出发现到的工具名（小标签）。  
点标签会把名字填进「模拟工具名」输入框，方便接着点「真工具调用」——**只是填名字，不会执行**。  
中间修过一次：工具标签不能嵌在「勾选 MCP」的大按钮里面（浏览器会警告 button 套 button），已经拆成列表行 + 下方标签区。

### 自测结果
- ui-kit AgentBindingPanel：**15/15 通过**（含 chips 展示 / 空目录提示 / 点击填名）
- desktop build：**通过**
- 脚本门禁（上轮）：workers + runtime mcp-commands 7/7 + desktop 全绿

### 你会怎么玩
1. 刷新工具目录 → 看到 echo / ping / write_file  
2. 点 **echo** 标签 → 工具名输入框变成 echo  
3. 勾选 MCP → 保存绑定 → 真工具调用 / 审批（和以前一样）

### 固定脚本
`node scripts/selftest-mcp-refresh.mjs --append`  
会把门禁结果再追加进本文件。

### dogfood
模板：`docs/development/dogfood-template.md`  
日记目录：`docs/development/dogfood/`  
**满 3 天有效日记前不关 M1。**

### M1
仍 open。外网网关手测 + dogfood 仍缺。不进 M2。

---


## 2026-07-12 · 第 3 次自测 · Provider 协议持久化 + 发现失败 Diagnostics

### 大白话
以前 Provider 创建时选的协议（OpenAI Chat / Anthropic…）**没有真正存进数据库**，后面「发现模型」只能猜：有模型就用第一个模型的协议，没有就默认 openai-chat。  
这次改完后：

1. **协议会存下来**——列表/卡片上直接显示（小徽章 + meta 行）。
2. **发现模型按存好的协议去打网关**——空目录也能对。
3. 发现失败（比如 key 错了、超时）会写进 **Diagnostics**，并且密钥会被打码；界面发现失败后也会刷新 Memory/Diagnostics 面板。
4. 状态条更细：`发现 N 个模型 · 来源 adapter · openai-chat · 原有 X · 新增 a,b`。

这还 **不能** 证明外网网关手测通过，也 **不能** 关闭 M1。

### 自测结果
- storage：**69/69 通过**（含 migration 0007）
- runtime provider-commands：**5/5 通过**
- ui-kit ProvidersPanel：**4/4 通过**
- desktop build：**通过** · Electron 已重启加载 dist

### 你会在界面上看到啥
1. 打开 Providers，已有条目卡片右侧有协议徽章（如 `openai-chat`）
2. 点 **发现模型** → 顶部状态条出现协议/新增信息
3. 故意用坏 key 再发现 → 报错，同时 Memory/Diagnostics 里多一条 Discovery failed（无密钥明文）

### 边界
- 探测能力仍是启发式建议，不是事实
- 密钥仍只进 SecureStore
- **M1 仍 open**；dogfood ≥3 天 / 外网 UI 手测仍缺
- **不进 M2**

### dogfood
模板：`docs/development/dogfood-template.md`  
日记：`docs/development/dogfood/`

---


---

## 2026-07-11 22:38:45 · 第 4 次自测 · Diagnostics 恢复指南 + 已知限制 + dual-gateway 门禁

### 大白话
这一刀主要做两件事：

1. **Diagnostics 不只是报错了**：点开一条失败诊断，会看到失败类中文名、能不能重试、按步骤怎么修（比如鉴权失败去更新 API Key）。下面还有「已知限制」折叠区，写明协议持久化、能力标签只是建议、MCP 发现不等于可执行、密钥不进库、M1 还不能关等。
2. **Providers 页顶上有限制说明**：协议选错会进诊断；发现失败会脱敏记日志。

另外用脚本跑了本地 **双 HTTP 网关 + 双协议网关** 自动化（不是外网真网关 UI 手测）。

### 自测结果
- 通过 · runtime dual-http-gateway (≥2 providers / ≥3 models path) · GREEN · local dual OpenAI-compatible gateways
- 通过 · runtime dual-protocol-gateway (openai-chat + anthropic-messages) · GREEN · dual protocol live path
- 通过 · ui-kit recovery + diagnostics + providers limitations · GREEN · §23.2 #9/#12 catalog + UI
- 通过 · runtime provider-commands (protocol + discover diagnostics) · GREEN
- 通过 · desktop build · tsc + preload + renderer GREEN

### 你会在界面上看到啥
1. 左侧 Memory / Diagnostics → 诊断条目可点开「查看恢复步骤」
2. 鉴权失败显示「勿盲目重试」；超时显示「可重试」
3. 展开「已知限制」可读 §23.2 #12 说明
4. Providers 列表上方有「Provider / 协议限制」灰底提示条
5. 点恢复里的「前往 Providers」会平滑滚到 Providers 卡片（短暂高亮）

### 边界
- 本地 dual-gateway **不能**单独关闭 M1
- 外网真实网关 UI 手测 + dogfood ≥3 天仍缺
- **不进 M2**

### 固定脚本
`node scripts/selftest-dual-gateway.mjs --append`

### M1
仍 open。

---


---

## 2026-07-11 22:39:10 · 第 4 次自测 · Diagnostics 恢复指南 + 已知限制 + dual-gateway

### 大白话
这一刀主要做两件事：

1. **Diagnostics 不只是报错了**：点开一条失败诊断，会看到失败类中文名、能不能重试、按步骤怎么修（比如鉴权失败去更新 API Key）。下面还有「已知限制」折叠区，写明协议持久化、能力标签只是建议、MCP 发现不等于可执行、密钥不进库、M1 还不能关等。
2. **Providers 页顶上有限制说明**：协议选错会进诊断；发现失败会脱敏记日志。

另外本地 dual-http-gateway / dual-protocol-gateway / provider-commands / ui-kit recovery 面板 / desktop build 已全绿（不是外网真网关 UI 手测）。

### 自测结果
| 项 | 结果 |
|---|---|
| runtime dual-http-gateway | **2/2 通过** |
| runtime dual-protocol-gateway | **2/2 通过** |
| runtime provider-commands | **5/5 通过** |
| ui-kit recovery + MemoryDiagnostics + ProvidersPanel | **11/11 通过** |
| desktop build | **通过** |
| 外网真实网关 UI 手测 | **还没做** |
| dogfood ≥3 天 | **还没做** |

### 你会在界面上看到啥
1. 左侧 Memory / Diagnostics → 诊断条目可点开「查看恢复步骤」
2. 鉴权失败显示「勿盲目重试」；超时显示「可重试」
3. 展开「已知限制」可读 §23.2 #12 说明
4. Providers 列表上方有「Provider / 协议限制」灰底提示条
5. 点恢复里的「前往 Providers」会平滑滚到 Providers 卡片（短暂高亮）

### 边界
- 本地 dual-gateway **不能**单独关闭 M1
- 外网真实网关 UI 手测 + dogfood ≥3 天仍缺
- **不进 M2**

### 固定脚本
`node scripts/selftest-dual-gateway.mjs --append`

### M1
仍 open。

---


---

## 2026-07-12 · 第 5 次自测 · Compose 多模型 chips + Trace 中文标签

### 这轮到底做了啥（大白话）
对话底部的「本轮模型」以前主要靠下拉框切换。  
现在当注册了 **2 个及以上模型** 时，会多一排 **快速切换 chips**（默认 + 最多 8 个模型）。一点就换本轮覆盖模型，发送时带上 modelId；选「默认」则仍走 Agent 默认解析。

摘要条也更可观测：
- 选了具体模型 → 显示 **「本轮覆盖」** + Provider·模型名
- 用 Agent 默认 → 显示 **「Agent 默认」**，若有 fallback 数量会写出来；若跨多个 Provider 还会提示 **「跨 Provider 无需重述」**

右侧 Trace 事件类别从英文改成中文可读标签（模型调用 / 凭证选择 / 工具动作 / 审批 / 产物 / 评审 / 上下文传递 / 恢复），底层仍保留英文 data-category 方便测试与调试。空列表提示也改成中文。

桌面 Compose 会话条也中文化：对话模式 / N 个模型 / 本轮覆盖|Agent 默认 / 流式中。

**没有**做外网真网关导入；**没有**关 M1；**没有**碰 M2 工作流图。

### 我怎么测的
1. ui-kit Compose.test：**17/17**（含 chips 多模型、单模型隐藏 chips、本轮覆盖文案、快捷键）
2. ui-kit TraceList.test：**2/2**（中文类别 + 空状态）
3. 重建：pnpm --filter @sync-think/ui-kit build + pnpm --filter @sync-think/desktop build → **GREEN**
4. 重启 Electron 加载 dist，便于界面手测

### 结果（数字）
| 项 | 结果 |
|---|---|
| ui-kit Compose | **17/17 通过** |
| ui-kit TraceList | **2/2 通过** |
| ui-kit build | **通过** |
| desktop build | **通过** |
| 外网真实网关 UI 手测 | **还没做**（M1 退出证据仍缺） |
| dogfood ≥3 天 | **还没做** |

### 你会在界面上看到啥
1. 左侧 Providers 至少登记 **2 个模型**（可同 Provider 两个模型，或跨 Provider）
2. 底部 Compose：**默认** chip + 模型 chips；点某个模型 → 摘要变「本轮覆盖」
3. 点「默认」→ 摘要「Agent 默认」；若 Agent 绑了 fallback，会显示 fallback 数量
4. 右侧 Trace：发送后若有事件，类别显示中文（如「模型调用」「恢复」）
5. 只有 1 个模型时 **不显示** chips 行（避免噪音）
6. Compose 顶条：对话模式 · N 个模型 · 本轮覆盖/Agent 默认

### 边界 / 已知
- chips 只是 **Run 覆盖选择**，不改 Agent 默认绑定
- 最多展示 8 个 chip，超出显示 +N
- 本地自动化 **不能**关闭 M1
- **不进 M2**

### M1
仍 open。

---


---

## 2026-07-12 · 第 6 次自测 · Continuum/Mode 中文 + Mode 可观测 + dogfood 脚手架

### 这轮到底做了啥（大白话）
1. **上下文连续体（Continuum）**：kind 从英文变成中文标签（决策 / 记忆 / 产物 / 评审 / 上下文），空列表有中文提示；桌面「线程 · vN」中文化。
2. **参与模式（ModeSwitch）**：显示「对话 / 协作 / 自动」；协作与自动在 M1 禁用（hover 提示 M2）；挂到任务头工具栏，可一眼看到当前只能对话。
3. **dogfood 脚手架**：`docs/development/dogfood/2026-07-12.md` 手测清单 + README 索引。**不等于 dogfood 完成**。
4. 第 5 次的 Compose chips / Trace 中文已并入可观测界面。

### 我怎么测的
| 项 | 结果 |
|---|---|
| ContinuumRail | **3/3 通过** |
| ModeSwitch | **3/3 通过** |
| Compose（回归） | **17/17**（第 5 次） |
| TraceList（回归） | **2/2**（第 5 次） |
| ui-kit + desktop build | **通过** |
| 外网真实网关 UI 手测 | **还没做** |
| dogfood ≥3 天 | **还没做**（仅脚手架） |

### 你会在界面上看到啥
1. 任务头右侧：**对话 | 协作(灰) | 自动(灰)** + 布局 + 主题
2. Continuum 条：决策 / 记忆 / 上下文 中文 kind
3. 底部 Compose：≥2 模型时 chips；摘要「本轮覆盖 / Agent 默认」
4. 右侧 Trace：中文类别
5. dogfood 日记文件在 docs 里，等你真实用一天再填

### 边界
- **不关 M1**；**不进 M2**（协作/自动按钮禁用即声明）
- dogfood 脚手架 ≠ 3 天证据

### M1
仍 open。

---


---

## 2026-07-12 · 第 7 次自测 · Agent 绑定优先级可观测（§5.3 ladder）

### 这轮到底做了啥（大白话）
M1 退出标准第 2 条要求：**Run 覆盖 > 工作流 > Agent 默认 > Fallback** 优先级成立且可理解。  
运行时绑定测试本来就有，但界面上以前不够一眼能看懂。

现在在左侧 **Agent** 面板顶部加了一块 **「绑定优先级」** 卡片：
1. **本轮覆盖** — Compose 里点的模型（最高）
2. **工作流步骤** — M2 才有，先占位灰显说明
3. **Agent 默认** — 你保存的默认模型（当前生效层，高亮）
4. **Fallback 链** — 失败时按顺序走，直接显示当前链上的模型名

下面还有一句白话说明：发送时怎么解析；若开了 pause-on-failure 会写「链尽暂停」。

### 我怎么测的
| 项 | 结果 |
|---|---|
| ui-kit AgentBindingPanel | **16/16 通过**（含新 precedence 用例） |
| ui-kit + desktop build | **通过**（本轮重建） |
| 外网真实网关 UI 手测 | **还没做** |
| dogfood ≥3 天 | **还没做** |

### 你会在界面上看到啥
1. 左侧 Agent → 表单最上：绑定优先级阶梯
2. 改默认模型 / fallback 后，第 3、4 行文案会跟着变（保存前草稿也会变）
3. dogfood 日记清单多了一条：检查绑定优先级

### 边界
- 这是 **可观测 UI 证据**，不是外网真双 Provider 手测
- **不关 M1**；**不进 M2**

### M1
仍 open。

---


---

## 2026-07-12 · 第 8 次自测 · Manifest 解析阶梯可观测（§10.3 · 对齐 §5.3）

### 这轮到底做了啥（大白话）
M1 退出标准第 3 条要 **可检查的 Manifest**：一次模型调用到底用的是哪一层绑定（本轮覆盖 / 工作流 / Agent 默认 / Fallback），要一眼能看懂。

上一轮 Agent 面板已经有「绑定优先级」阶梯；本轮把 **同一套优先级语言** 接到选中的 Manifest 详情上：

1. 修好中断的代码缺口：补上 `credentialResolutionLabel`（凭证解析中文：固定密钥 / 凭证组 / Provider 主密钥 / 未指定）
2. `agentFallback` 显示从「Agent Fallback」统一成 **Fallback**（和测试、Agent 阶梯一致）
3. Manifest 详情顶部 **解析阶梯**：四档步骤高亮当前生效层；若走 Fallback，显示 **Fallback #N / 链位 #N**
4. 绑定来源行保留：本轮覆盖 / Fallback · 链位 #N
5. 样式：简洁四格阶梯 + 高亮当前层（对齐 Agent 优先级卡片气质，不花哨）

### 我怎么测的
| 项 | 结果 |
|---|---|
| ui-kit ManifestPanel | **15/15 通过**（含解析阶梯 + Fallback 链位） |
| ui-kit + desktop build | **通过** |
| Electron 重启加载 dist | **已重启**（新 UI 在 dist） |
| 外网真实网关 UI 手测 | **还没做** |
| dogfood ≥3 天 | **还没做** |

### 你会在界面上看到啥
1. 右侧 Manifest（或 Trace 点开同 id）→ 选中某次调用
2. proof 下方：**解析** + 当前徽章（本轮覆盖 / Agent 默认 / Fallback…）
3. 四格阶梯：本轮覆盖 → 工作流 → Agent 默认 → Fallback（当前层高亮）
4. Fallback 时：徽章 **Fallback**，芯片 **Fallback #2**，绑定来源 **链位 #2**
5. 有凭证信息时：中文「固定密钥 / 凭证组 / …」而不是生硬英文枚举

### 边界
- 这是 **Manifest 可观测 UI** 的 soft 完成，**不是** 外网真双 Provider 手测
- **不关 M1**；**不进 M2**
- 没有真实外网密钥时，阶梯仍可在本地/假数据或已有会话 Manifest 上观察

### M1
仍 open。



---

## 2026-07-12 · 第 9 次自测 · Compose/消息气泡中文可观测（soft · M1 仍 open）

### 这轮到底做了啥（大白话）
在第 8 次 Manifest 解析阶梯落地后，把对话输入与消息气泡上残留的英文「可观测文案」收成中文，避免你盯界面时一半中文一半英文。

1. **Compose 输入框**：默认占位改为「输入指令、粘贴上下文，或继续当前任务…」；aria 改为「消息输入 / 取消流式输出」
2. **MessageBubble**：流式 aria「助手消息 · 流式输出中」；用户/系统/工具角色中文标签
3. **桌面气泡 meta**：流式状态从 `streaming` 改成 **流式中**
4. 测试同步更新并全部通过

### 我怎么测的
| 项 | 结果 |
|---|---|
| Compose | **18/18 通过** |
| MessageBubble | **4/4 通过** |
| ManifestPanel（回归） | **15/15 通过** |
| ui-kit + desktop build | **通过** |
| Electron 重启 | **已重启** |
| 外网真实网关 UI 手测 | **还没做** |
| dogfood ≥3 天 | **还没做** |

### 你会在界面上看到啥
1. 底部输入框灰色提示是中文
2. 流式回复时气泡 meta 显示「流式中」（不是 streaming）
3. Manifest 解析阶梯仍在（第 8 次）
4. 发送/取消/快捷键说明继续中文

### 边界
- 纯 UI 文案/可观测 soft；**不关 M1**；**不进 M2**
- 仍缺：外网双 Provider 真手测 + dogfood 三日日记

### M1
仍 open。



---

## 2026-07-12 · 第 10 次自测 · Providers 多模型就绪条（M1 soft 门槛可观测）

### 这轮到底做了啥（大白话）
M1 退出标准第 1 条要求：**同一任务里能用 ≥2 个 Provider / ≥3 个模型**。  
以前 Providers 面板有列表和协议徽章，但你一眼看不出「离 soft 门槛还差几步」。

本轮在 **Providers** 顶部加了 **「多模型就绪」** 卡片：

1. **Provider x/2** — 是否已有两个网关/渠道  
2. **模型 x/3** — 是否已有三个模型（发现或手动添加）  
3. **密钥** — 是否已写入安全存储（只显示遮罩 ••••，从不回显明文）  
4. **协议种类** — 是否跨协议（OpenAI / Anthropic 等）  
5. 状态徽章：**尚未配置 / 进行中 / 已达 soft 门槛**  
6. 底部白话提醒：即使 soft 门槛满了，**关 M1 仍需外网手测 + dogfood ≥3 天**

同时把计数中文化：`N 个 Provider · M 个模型`；卡片「N 个模型」；meta「协议 / 发现 开|关」。

### 我怎么测的
| 项 | 结果 |
|---|---|
| ProvidersPanel | **6/6 通过**（含 empty→partial→ready 阶梯） |
| ui-kit + desktop build | **进行中/通过** |
| Electron 重启 | **本轮重启** |
| 外网真实网关 UI 手测 | **还没做** |
| dogfood ≥3 天 | **还没做** |

### 你会在界面上看到啥
1. 左侧 **Providers** 面板顶部：多模型就绪条  
2. 没配任何东西：徽章「尚未配置」，0/2 · 0/3  
3. 只配 1 个 Provider：徽章「进行中」  
4. ≥2 Provider 且 ≥3 模型：徽章「已达 soft 门槛」+ 绿点，但说明仍写着外网/dogfood 未关 M1  
5. 密钥行仍是 `••••••••••••`，没有 sk- 明文

### 边界
- 这是 **M1 门槛可观测 UI**，不是外网真双 Provider 手测证据  
- **不关 M1**；**不进 M2**

### M1
仍 open。



---

## 2026-07-12 · 第 11 次自测 · 任务头 M1 会话就绪条（全局可观测）

### 这轮到底做了啥（大白话）
第 10 次在 Providers 里加了「多模型就绪」，但你盯对话时未必展开 Providers。  
本轮把 **同一套 M1 soft 门槛** 抬到任务区 Continuum 下方，做一条全局 **「会话就绪」** 条：

1. **Runtime** — 已连接 / 连接中 / 未连接  
2. **任务** — 是否已打开  
3. **Provider x/2** · **模型 x/3** — 与 Providers 面板门槛一致  
4. **Manifest** — 是否已有可检查调用（N 次可查）  
5. **轨迹/主题** — 收起|展开 + 浅色|暗色（exit #4 可观测）  
6. 汇总徽章：等待开始 / 会话准备中 / **会话 soft 就绪**  
7. 脚注写死：soft 就绪 **≠** 可关 M1（仍要外网手测 + dogfood ≥3 天）

实现拆成纯函数 `projectM1SessionReadiness`（可单测），桌面 header 只做展示。  
顺手把连接文案「durable stream」改成 **「持久事件流」**。

### 我怎么测的
| 项 | 结果 |
|---|---|
| desktop m1-session-readiness | **3/3 通过** |
| desktop build | **通过** |
| Electron 重启 | **已重启** |
| 外网真实网关 UI 手测 | **还没做** |
| dogfood ≥3 天 | **还没做** |

### 你会在界面上看到啥
1. 任务标题 + Continuum 下面：一排胶囊芯片（Runtime / 任务 / Provider / 模型 / Manifest / 轨迹主题）  
2. 配好双 Provider 三模型且 Runtime 在线、任务打开：标题变「会话 soft 就绪」  
3. 芯片绿/强调色表示满足；灰/半表示不足  
4. 脚注始终提醒关 M1 还差外网 + dogfood

### 边界
- **全局 soft 可观测**，不是外网退出证据  
- **不关 M1**；**不进 M2**

### M1
仍 open。

## 2026-07-12 · 第 12 次自测 · 批准中心 + Memory 闸门就绪条（soft · M1 仍 open）

### 这轮到底做了啥（大白话）
之前 Providers 和任务头已经有「就绪条」，一眼能看出离门槛还差几步。  
**批准中心**和 **Memory** 还只是列表 + 空提示，你打开右侧面板时，不容易判断：

1. 仅限真人闸门有没有加载  
2. 现在有没有待审、有没有已决历史  
3. Memory 是否已有持久条目 / 待审变更 / 诊断证据  
4. 空队列到底是「坏了」还是「正常空闲」

本轮做了两块 **soft 可观测**（**不是关 M1**）：

**A. 批准中心 ·「批准闸门」就绪条（§13）**
- 顶部卡片：仅限真人 N 类 / 待审 / 已决 / 桥接种类（记忆·Skill·MCP·工具）
- 三态 + 注意态：`empty` / `partial` / `ready` / **`attention`（有待审高亮）**
- 空待审改成卡片文案：说明可用「入队演示」或 Memory/Skill/MCP 敏感动作观测入队
- 文案写明：委托/完全批准**不能绕过**仅限真人

**B. Memory ·「记忆与诊断」就绪条（§10.4 / §19）**
- 顶部卡片：持久记忆 / 待审变更 / 诊断 / 已知限制（§23.2 #12）
- 有待审时徽章显示「N 待审」并进入 attention
- 分区空态：尚无持久记忆 / 暂无待审变更 的卡片说明（人批链路 + 与批准中心同步）

### 我怎么测的
1. ui-kit：`ApprovalCenterPanel` **6/6**（含闸门就绪 + attention）  
2. ui-kit：`MemoryDiagnosticsPanel` **6/6**（含就绪条 + 空卡片）  
3. `@sync-think/ui-kit` + `@sync-think/desktop` build **GREEN**  
4. 重建 dist 后 **重启 Electron**（窗口标题 SYNC-THINK 可见）

### 结果（数字）
| 项 | 结果 |
|---|---|
| ApprovalCenterPanel | **6/6 通过** |
| MemoryDiagnosticsPanel | **6/6 通过** |
| ui-kit + desktop build | **通过** |
| Electron 重启 | **已启动** |

### 你怎么在界面上看到
1. 打开 **批准中心** 面板 → 标题下应有 **「批准闸门」** 卡片  
2. 打开 **Memory** 面板 → 标题下应有 **「记忆与诊断」** 卡片  
3. 点「入队演示」→ 待审变多，闸门条应变 **attention / N 待审**

### 明确没做 / 仍 open
- **没有**外网真实网关 UI 手测证据  
- **没有** dogfood ≥3 天真实日记  
- **M1 仍 open**；**不要启动 M2**  
- soft 就绪条 **≠** 可以关 M1

### 下一优先
- 你本机：在 Electron 里点开批准中心 / Memory 看就绪条  
- 若有密钥：外网网关 UI 手测写进 test-log + dogfood  
- 继续 soft 时：别的空态 / a11y 可观测；**勿关 M1、勿开 M2**

---

## 2026-07-12 · 第 13 次自测 · AppShell 运行轨迹中文 + 工作区结构条（soft · M1 仍 open）

### 这轮到底做了啥（大白话）
设计 §15.2 要求：左侧文件夹/任务树、右侧可折叠 Run 轨迹、折叠不暂停 Run。  
上一轮侧栏面板已有就绪条，但 **壳层** 还有英文：

- 右侧标题还是 **Run trace**
- 折叠按钮 aria 是 Restore/Collapse
- 左侧页脚「Local Runtime / durable stream」混英文
- 文件夹/任务有没有打开，要自己数树

本轮 soft craft：

**A. AppShell（§15.2 / §15.4）**
- 标题改 **「运行轨迹」**；aria/title 中文折叠/展开
- 折叠后显示提示：**「已折叠 · Run 不暂停 · Ctrl+\ 展开」**（明确折叠 ≠ 停 Run）

**B. WorkspaceNav（§15.2 IA）**
- 连接文案：已连接 · **持久事件流**；默认 footer **本地 Runtime**
- 底部上方新增 **「工作区结构」** 就绪条：文件夹 / 任务 / 当前任务 / Runtime
- empty → partial → ready（任务已打开）；说明折叠轨迹与主题偏好

### 我怎么测的
1. AppShell **7/7**
2. WorkspaceNav **6/6**
3. ui-kit + desktop build **GREEN**
4. Electron 重启（窗口 SYNC-THINK）

### 结果
| 项 | 结果 |
|---|---|
| AppShell | **7/7 通过** |
| WorkspaceNav | **6/6 通过** |
| builds | **通过** |
| Electron | **已重启** |

### 你怎么在界面上看到
1. 右侧栏标题应是 **运行轨迹**（不是 Run trace）
2. 点折叠 → 出现 **已折叠 · Run 不暂停** 提示
3. 左侧导航靠下 → **工作区结构** 卡片（文件夹/任务计数）

### 明确没做 / 仍 open
- 外网真实网关 UI 手测
- dogfood ≥3 天真实日记（脚手架已补两项检查）
- **M1 仍 open**；**勿开 M2**

### 下一优先
- 本机看壳层中文 + 工作区结构条
- 有密钥：外网网关手测写证据
- 否则继续 soft 可观测；**勿关 M1**

---


---

## 2026-07-12 · 第 14 次自测 · Agent 能力就绪条（capability readiness）

### 这轮到底做了啥（大白话）
Agent 绑定面板顶部，现在多了一条**「能力就绪」**仪表条，一眼能看出：
- 默认模型有没有设
- Fallback 链有几条
- 凭证组有没有绑（有没有固定密钥）
- Skill / MCP 白名单绑了几个（相对库里有几个）
- 当前有没有**未保存改动**

徽章会显示：**未加载 / 缺默认模型 / 进行中 / 能力已配**。  
和 Providers / 审批 / 记忆那几条就绪条同一套视觉语言——冷静、可观测、不吵。

**注意**：这是 M1 soft craft 可观测性，**不是** M1 退出证据；外网真实网关手测 + dogfood ≥3 天仍缺。

### 我怎么测的
1. 核对 `AgentBindingPanel.tsx`：capability useMemo + strip 结构完整
2. CSS：把 `.st-agent__readiness*` 并入审批/记忆就绪样式，并给 6 项检查做 3 列布局
3. 单测：empty / partial / ready + dirty 翻转
4. ui-kit + desktop build，重启 Electron（dist）

### 结果（数字）
| 项 | 结果 |
|---|---|
| ui-kit AgentBindingPanel | **19/19 通过**（原 16 + 新 3） |
| ui-kit build | **通过** |
| desktop build | **通过** |
| Electron 重启 | **已重启**（新 dist） |
| 外网真实网关 UI 手测 | **还没做** |
| dogfood ≥3 天 | **还没做** |

### 你会在界面上看到啥
1. 打开桌面端 → 右侧/配置区 **Agent** 面板
2. 顶部有 **能力就绪** 条（雷达图标）
3. 六格：默认模型 · Fallback · 凭证组 · Skill 白名单 · MCP 白名单 · 同步状态
4. 改一下默认模型 →「有未保存改动」变红点；保存后应回到同步（需 Runtime 回写 binding）

### 还没做 / 别误会
- **没有**开始 M2
- **没有**关闭 M1
- 外网真实导入 Provider 拿模型的手测证据仍缺
- 本轮没有扩展 `m1-session-readiness` 的 Agent chip（时间盒内 Agent 条本身足够）

---

## 2026-07-12 · 第 15 次自测 · 任务头会话就绪条接入 Agent / 审批

### 这轮到底做了啥（大白话）
任务头那条 **「会话就绪」** 现在不只看 Provider/模型，还会看：
- **Agent**：默认模型有没有设；Fallback / Skill / MCP 绑了多少（`F?/S?/M?`）
- **审批**：批准中心有没有待审；有待审时摘要直接写「待审 N」

soft 就绪门槛略收紧：要 **Runtime + 任务 + ≥2 Provider + ≥3 模型 + Agent 默认模型 + 审批空闲** 才显示「会话 soft 就绪」。  
**仍然不等于关 M1**——外网网关手测 + dogfood ≥3 天还差。

上一轮（第 14 次）Agent 面板自己的「能力就绪」条也一起保留；这轮是**全局任务头**接上同一套信号。

### 我怎么测的
1. 扩展 `projectM1SessionReadiness` + desktop 接线（agentBinding / approvalPendingCount）
2. 单测：empty / partial / ready / 缺 Agent / 有待审 → **4/4**
3. AgentBindingPanel 回归 **19/19**
4. desktop build + Electron 重启

### 结果（数字）
| 项 | 结果 |
|---|---|
| m1-session-readiness | **4/4 通过** |
| AgentBindingPanel | **19/19 通过** |
| desktop build | **通过** |
| Electron 重启 | **已重启** |
| 外网真实网关 UI 手测 | **还没做** |
| dogfood ≥3 天 | **还没做** |

### 你会在界面上看到啥
1. 打开任务后，任务头「会话就绪」多两枚芯片：**Agent**、**审批**
2. Agent 未设默认模型 → 摘要「缺 Agent 默认模型」
3. 有待审 → 摘要「待审 N」，note 提示去批准中心
4. Agent 面板顶部仍有第 14 次的「能力就绪」六格条

### 还没做 / 别误会
- **没有**开始 M2；**没有**关闭 M1
- 外网真实导入 Provider 仍需你本机密钥与网关

---

## 2026-07-12 · 第 16 次自测 · Compose「发送就绪」条 + dual 网关自动化复测

### 这轮到底做了啥（大白话）
发送框上方现在多了一条冷静的 **「发送就绪」** 仪表条，告诉你现在能不能发、卡在哪：
- 模型有没有注册
- 本轮是「本轮覆盖」还是「Agent 默认」（含 fallback 数）
- Runtime 是否已连接
- 任务有没有打开
- 是否跨 Provider
- 输入框有没有字

徽章：**可发送 / 准备中 / 暂不可发送 / 流式中 / 等待配置**。  
**不改变**真正的发送闸门（还是外壳的 disabled）；只是把原因摊开，方便你一眼看懂。

另外我把 **dual-http + dual-protocol** 本机多模型自动化又跑了一遍（≥2 Provider / ≥3 模型 / Manifest / 密钥擦洗 / 跨协议 fallback）——这是 **soft 证据**，**仍不能**替代外网真实网关 UI 手测。

### 我怎么测的
1. Compose 新增 readiness strip + CSS
2. desktop 接线：connectionState / hasActiveTask / agentDefaultSet
3. ui-kit Compose 单测 **21/21**
4. ui-kit + desktop build
5. runtime dual-http + dual-protocol **4/4**
6. Electron 重启

### 结果（数字）
| 项 | 结果 |
|---|---|
| Compose 单测 | **21/21 通过** |
| dual-http + dual-protocol | **4/4 通过** |
| ui-kit / desktop build | **通过** |
| Electron 重启 | **已重启** |
| 外网真实网关 UI 手测 | **还没做**（缺真实 key） |
| dogfood ≥3 天 | **还没做** |

### 你会在界面上看到啥
1. 底部 Compose 上方 → **发送就绪** 六格
2. 未选任务 / Runtime 离线 / 无模型时 →「暂不可发送」+ 中文原因
3. 输入文字且条件齐 →「可发送」
4. 流式中 →「流式中 · Esc 可取消」

### 还没做 / 别误会
- **没有**关闭 M1；**没有**启动 M2
- dual 自动化 = 本机假 HTTP/协议网关，**不是**你的外网 Provider 账号手测
- dogfood 日记仍需你真实使用填写


## 2026-07-12 · 第 17 次自测 · TraceList 运行轨迹就绪条

### 这轮到底做了啥（大白话）
右侧「运行轨迹」以前只有事件列表；空的时候还塞了一条假的「等待任务 / 等待模型步骤」，看起来像真事件，其实不是。

这轮做了两件事：
1. **真正的空态**：没有轨迹就显示空提示，不再造假条目。
2. **「运行轨迹」就绪条**：和 Providers / Compose / Agent 同风格的可观测条，一眼能看：
   - 事件总数 / 种类数
   - 有没有模型调用、恢复、工具/审批
   - 最近一条摘要
   - 任务是否打开 / 是否在流式写入
   - 状态徽章：静默 / 等待任务 / 部分事件 / 有轨迹 / 流式中

### 我怎么测的
1. ui-kit：`TraceList.test.tsx`（含 `projectTraceReadiness` 纯函数）
2. ui-kit build + desktop build
3. Electron 重启加载 dist

### 结果（数字）
| 项 | 结果 |
|---|---|
| ui-kit TraceList | **9/9 通过** |
| ui-kit build | **通过** |
| desktop build | **通过** |
| Electron 重启 | **已重启** |
| 外网真实网关 UI 手测 | **还没做**（M1 退出证据仍缺） |
| dogfood ≥3 天 | **还没做** |

### 你会在界面上看到啥
1. 右侧运行轨迹顶部：**运行轨迹** 就绪条（`trace-readiness`）
2. 徽章示例：未开任务 →「等待任务」；有模型调用 →「有轨迹」；流式 →「流式中」
3. 六格检查：事件 / 模型调用 / 恢复 / 工具审批 / 最近 / 任务或流式
4. 列表空时中文空态（不再出现假 recovery「等待…」）
5. 折叠轨迹仍不暂停 Run（原有行为）

### 边界
- 这是 **M1 soft 可观测**，**不等于**关闭 M1
- 外网网关手测 + dogfood ≥3 天仍是退出门槛
- **未启动 M2**

### 下一刀（仍不关 M1）
- ContinuumRail 连续体就绪条；或
- 你本机外网网关按 `14-external-gateway-handtest.md` 手测；或
- 写 dogfood 日记第 1 天

## 2026-07-12 · 第 18 次自测 · ContinuumRail 连续体就绪条

### 这轮到底做了啥（大白话）
顶部「上下文连续体」是产品签名条。以前没任务时会塞两条假芯片（「等待本地文件夹」「任务尚未打开」），看起来像真证据。

这轮：
1. **真·空态**：没任务时列表为空，显示中文空提示。
2. **「上下文连续体」就绪条**：和轨迹/Compose 同风格，一眼看：
   - 条目数 / 种类
   - 决策 / 记忆 / 上下文传递
   - 产物/评审（持久证据）
   - 任务绑定 / 流式
   - 徽章：静默 / 等待任务 / 结构位 / 已绑定 / 有证据 / 流式中
3. Desktop 标明当前条目是 **任务结构位**（`scaffoldOnly`），不是 dogfood 持久证据，避免误读为「已经有完整连续体证据」。

### 我怎么测的
1. ui-kit：`ContinuumRail.test.tsx`（含 `projectContinuumReadiness`）
2. ui-kit build + desktop build
3. Electron 重启

### 结果（数字）
| 项 | 结果 |
|---|---|
| ContinuumRail | **10/10 通过** |
| ui-kit build | **通过** |
| desktop build | **通过** |
| Electron 重启 | **已重启** |
| 外网真实网关 UI 手测 | **还没做** |
| dogfood ≥3 天 | **还没做** |

### 你会在界面上看到啥
1. 对话区顶部：**上下文连续体** 就绪条（`continuum-readiness`）
2. 未开任务 → 徽章「等待任务」+ 空列表
3. 打开任务 → 徽章「结构位」+ 文件夹/任务/线程芯片
4. 流式中 →「流式中」
5. 说明文字会写清：结构位 ≠ 持久证据（关 M1 仍要外网手测 + dogfood）

### 边界
- M1 soft 可观测，**不关 M1**
- **未启动 M2**

### 下一刀
- 外网网关 UI 手测（`14-external-gateway-handtest.md`）
- 或 dogfood 日记第 1 天
- 或会话/对话区 stream 状态条再统一一轮

## 2026-07-12 · 第 19 次自测 · 对话流 empty/stream 统一可观测

### 这轮到底做了啥（大白话）
中间对话列本来有「stream 状态条」和「空对话卡片」，但文案逻辑分散，检查点也不统一。

这轮：
1. 抽出纯函数 `projectConversationStreamReadiness`（可单测）
2. **对话流就绪条** 统一标题 / 副标题 / 徽章 / 六项检查 / 备注
3. **空对话卡片** 复用同一投影（不再两套话术）
4. 右侧 Run 摘要的 stream 状态中文化（空闲/流式中/失败…）

六项检查：Runtime · 任务 · Run · 消息 · 模型 · 跨 Provider  
徽章：等待 / 准备中 / 可开始 / 对话中 / 生成中 / 失败 / 已暂停 / 已取消

### 我怎么测的
1. desktop：`conversation-stream-readiness.test.ts`
2. desktop build
3. Electron 重启

### 结果（数字）
| 项 | 结果 |
|---|---|
| conversation-stream-readiness | **6/6 通过** |
| desktop build | **通过** |
| Electron 重启 | **已重启** |
| 外网真实网关 UI 手测 | **还没做** |
| dogfood ≥3 天 | **还没做** |

### 你会在界面上看到啥
1. 对话列顶部：`conversation-stream-readiness` 条 + 徽章 + 六格 checks
2. 无消息时空卡片：title/hint/steps 与上面同源
3. 流式中徽章「生成中」；失败「失败」并带 error 摘要
4. soft 可观测 ≠ 关 M1

### 边界
- **M1 仍 open**；**未启动 M2**
- 退出证据仍要：外网网关 UI 手测 + dogfood ≥3 天

### 下一刀
- 外网网关手测清单实填；或 dogfood 日记第 1 天；或 Manifest 再补可观测边角
## 2026-07-12 · 对话输出减负自测

1. 助手回复现在像 Codex 一样直接排版正文，不再套一张带 Agent、模型和 Run 编号的卡片。
2. 用户消息仍在右侧；输入区只保留输入、模型选择和发送 / 停止，正常时不显示检查面板。
3. 左下角现场显示 `Agent 默认 · grok-4.5`，打开后仍按分组 → 供应商 → 模型选择。
4. 看见 Runtime / 任务 / 模型阻塞提示时不能误发送；真正发送失败会保留输入，成功后才清空。
5. 自动化、类型检查、构建和两个窗口尺寸均通过；这不替代外网手测与 3 天 dogfood，M1 仍未关闭。
