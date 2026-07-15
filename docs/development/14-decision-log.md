# Decision Log

本文档记录重要产品/技术/设计决策。高自治模式下跳过的确认也必须记录。

## 1. 记录原则

1. 只记录会影响功能、架构、性能、安全、成本、部署、维护或设计标准的重要决策。
2. 低风险实现细节可不记录。
3. `/zno-goal --super` 下跳过用户确认的选型必须记录。
4. 决策记录不能替代测试和验证。
5. Locked 产品决策变更必须显式标注，并有用户新需求。

## 2. 决策记录

### DEC-20260715-006: M1 dogfood 退出门槛由三天改为一天

日期：2026-07-15

模式：用户明确变更

背景：

```text
M1 六项功能标准、外网 18/18、恢复、安全与自动化均已通过；唯一未关闭项是原定三个不同日期的 dogfood。用户明确表示“不需要3天，一天即可”。
```

最终选择：

```text
M1 dogfood 只要求至少 1 个真实使用日；自动化、脚手架仍不计数。
现有 2026-07-12 有效记录满足 1/1，因此关闭 M1。
```

影响：

1. Desktop dogfood 默认门槛统一为 1，并显示 `18/18 · 1/1 · M1 已完成`。
2. M1 与 M2 均完成；路线图进入 Phase 3 未开始状态。
3. 历史日志中的 3 天规则保留为当时记录，由本决策覆盖。

### DEC-20260711-001: 批准产品/系统设计并启动文档化，暂不实现

日期：2026-07-11

模式：默认确认模式

背景：

```text
产品设计已完成价值评估与系统设计；需要进入工程文档化与 Phase 0，而不是重开需求。
```

候选方案：

| 方案 | 优点 | 缺点 | 风险 |
| --- | --- | --- | --- |
| 直接写代码 | 快 | 无项目文档与 spike 结论 | 范围失控、返工 |
| /zno-init 文档后确认再 spike | 边界清晰 | 起步稍慢 | 低 |
| 重开产品讨论 | 无 | 浪费已确认工作 | 高 |

最终选择：

```text
执行 /zno-init，落盘需求/路线图/设计/原则；确认前不实现。
```

选择原因：

1. 与权威设计文档 handoff 指令一致。
2. Locked 决策可被后续会话稳定继承。

### DEC-20260711-002: 用户确认项目文档；V3 仅作 IA；视觉冲可获奖级并由 Claude 主导

日期：2026-07-11

模式：默认确认模式

背景：

```text
用户确认初始化文档可用；同时明确前端不能停在 V3 原型观感，需要丰富创意与交互想象力，达到可获奖级别。
```

候选方案：

| 方案 | 优点 | 缺点 | 风险 |
| --- | --- | --- | --- |
| 视觉复刻 V3 | 快 | 平庸、无记忆点 | 产品同质化 |
| IA 锁 V3 + 原创可获奖视觉 | 保留可用性，抬升品牌与体验 | 设计与实现成本更高 | 工期；需防装饰过度 |
| 完全重做 IA | 设计自由 | 推翻已批布局决策 | 高，违背 Locked |

最终选择：

```text
保留 V3 Locked IA 与完整浅/深主题；
页面视觉、组件质感、交互动效、记忆点由 Claude 主导原创；
质量目标设为 award-level professional tool（Continuum Bench）。
```

选择原因：

1. 用户明确授权设计主导并提高标准。
2. 不破坏已批准信息架构与产品原则。
3. 动效与材质服务于状态理解，符合“可检查/冷静主体验”。

影响：

1. 更新 `docs/product/15-frontend-design.md` 与 `TD-003`。
2. 后续 UI 实现必须通过设计评审门槛。
3. 组件库默认皮肤不可直接作为产品外观。

后续动作：

1. 继续 Phase 0：§24 技术 spike 与里程碑实施计划。
2. 视觉 refinement 与工程骨架可并行规划，但业务实现仍按里程碑。

### DEC-20260711-003: 产出 §24 spike 推荐与 M0–M3 实施计划（待确认）

日期：2026-07-11

模式：默认确认模式

背景：

```text
用户选择 option C：同时推进技术 spike 对比与里程碑实施计划。
```

最终选择：

```text
1. 在 04-tech-decisions.md 写入 TD-004–014 对比与推荐（状态=推荐中）。
2. 在 11-implementation-plan.md 写入 monorepo 形状、M0–M3 退出标准、周计划、确认后前 10 项任务。
3. 不开始业务编码，等待用户确认推荐与计划。
```

推荐摘要：

```text
better-sqlite3+Drizzle；safeStorage+CredentialRef；named pipe+IPC；
DesktopWorker 接口先/koffi+UIA 后；SKILL.md v1 子集；CC Switch 版本化导入；
Provider 夹具矩阵；XState 表达+事件真源；Radix 行为+自研皮肤+Lucide；
electron-builder 私有更新；Vitest。
```

后续动作：

1. 用户确认或修改 TD 项。
2. 确认实施计划。
3. 再初始化工程骨架。


### DEC-20260711-004: M0 工程启动 — native 构建阻断的确认与处理

日期：2026-07-11

模式：super 高自治模式（spike 里系统侧验证）+ 用户确认

背景：

```text
M0 初始化 monorepo 后执行 pnpm install，发现本机未安装 Visual Studio C++ Build Tools：
  - better-sqlite3 native 模块无法编译（gyp: "Could not find any Visual Studio installation to use"）
  - electron 二进制下载/构建失败（缺 dist/）
  - esbuild（vite/vitest 内置）二进制未构建
TD-004 已锁 better-sqlite3 + Drizzle 作为 storage 真源；TD-004 同条已写明回退条款：
  "风险与回退：native 编译失败时短期可评估 libsql 本地文件"
AI_DEVELOPMENT_RULES §8.0 要求数据库驱动选型变更须用户确认。
```

候选方案：

| 方案 | 优点 | 缺点 | 风险 |
| --- | --- | --- | --- |
| 安装 VS Build Tools 后坚持 better-sqlite3（TD-004 原意） | 与已批 TD-004 一致；性能最佳；不引入驱动回退 | 一次性装大型工具链（含 Windows SDK） | 低 |
| 改用 libsql 本地文件 + Drizzle | 纯 JS/WASM，无需 VS | 偏离已锁 TD-004；性能略低 | 中（schema 层可迁回） |
| 推迟 desktop，仅做 Runtime | M0 可部分推进 | 不满足 M0 出口（Continuum shell 亮起） | 中 |

最终选择：

```text
用户确认：安装 Visual Studio Build Tools（含 "Desktop development with C++" 工作负载，
含 Windows 10/11 SDK），坚持 better-sqlite3 + Drizzle + electron + esbuild 原选型。
不改 TD-004 / TD-013；不动 storage 驱动决策。
等待 Build Tools 就绪后由 AI 继续 native rebuild 与 desktop 启动。
等待期间 AI 并行推进不依赖 native 的骨架：protocol / shared / test-fixtures /
workers 接口 / ui-kit tokens 字体与 CSS / storage schema 定义层 / secure-store 接口与测试。
```

选择原因：

1. 与已批 TD-004 一致，未触发产品/真源边界变化。
2. 一次性工具链部署，避免长期回退负债。

影响：

1. 暂无源代码依赖 native 绑定部分（storage 实跑、desktop 启动、vitest/vite）的命令，
   等 Build Tools 就绪后再跑 `pnpm rebuild better-sqlite3 electron esbuild` 与 dev:desktop。
2. 安装指令由 AI 给出，用户以管理员身份执行（AI 无管理员权限）。

确认人：用户（super 模式确认 + 用户在询问中明确选择"安装 VS Build Tools 一并解决"）

### DEC-20260713-005: M1 日历门槛累计期间连续实施 M2

日期：2026-07-13

模式：用户明确授权的连续执行

背景：

```text
M1 外网 UI、Fallback、取消、恢复和安全证据已齐；dogfood 受自然日期约束，当前只能达到 1/3。
原计划要求 M1 完全关闭后才启动 M2；用户最新要求后续不再询问，并把 M1、M2 都做完。
```

最终选择：

```text
不伪造 dogfood 日期，也不提前宣称 M1 关闭；在真实日期继续累计的同时，
按 §5 规格和 TDD 连续实现 M2。M2 仍须通过完整 exit demo，不能复用 soft 证据冒充完成。
```

选择原因：

1. 最新用户指令明确授权 M2 连续执行。
2. 日历等待不应阻塞不依赖该证据的工程实现。
3. 保留 M1 的真实退出门槛，避免把脚手架、自动化或同日多次运行计成多天。

影响：

1. `M1=open` 与 `M2=implementation in progress` 可以短期并存。
2. 最终关闭 M1 仍要求 dogfood 3/3；最终关闭 M2 仍要求 §5 exit demo 全证据。

结果回填（2026-07-15）：

1. M2 Task 1-9、exit demo、P1 审查与双尺寸 Electron QA 已通过，M2 已完成。
2. M1 六项功能退出标准与外网 18/18 已通过；dogfood 仍为 1/3，因此 M1 和总目标保持 open。
3. 未补写 2026-07-14/15，也未把自动化、smoke 或被中断的桌面操作计为真实 dogfood。

确认人：用户（“开始，后面不需要询问，把这个方案的 m1 和 m2 做完”）

### DEC-YYYYMMDD-XXX: 决策标题

日期：

模式：默认确认模式 / super 高自治模式

背景：

```text
```

候选方案：

| 方案 | 优点 | 缺点 | 风险 |
| --- | --- | --- | --- |
|  |  |  |  |

最终选择：

```text
```

选择原因：

1.
