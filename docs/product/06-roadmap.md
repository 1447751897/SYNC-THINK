# Roadmap

本文档记录 SYNC-THINK 阶段路线图、里程碑和验收标准。  
产品边界与 Locked 决策以 `docs/superpowers/specs/2026-07-11-sync-think-product-design.md` 为准。

规划假设：单人开发、日均较高投入。预计到 Windows 闭测约 **20-28 周**（规划估计，非发布承诺）。

## 1. 阶段总览

| 阶段 | 目标 | 范围 | 预计 | 状态 | 验收标准 |
| --- | --- | --- | --- | --- | --- |
| Phase 0 | 技术验证与文档/结构基线 | Electron/Runtime/管道/SQLite 骨架；凭证/Playwright/UIA spike；V3 结构验证 | 2-3 周 | 已完成（M0 关闭 2026-07-12） | Spike 结论写入 tech decisions；骨架可演示假 Provider 流式与重启恢复 |
| Phase 1 | 多模型对话 Alpha | 文件夹/任务/完整对话；Provider 与流式适配；Agent 绑定与 Context Packet；浅/深主题与轨迹 | 6-8 周 | 已完成（M1 关闭 2026-07-15；dogfood 1/1） | 同一任务跨至少 2 Provider / 3 模型无需重述上下文 |
| Phase 2 | 多 Agent 编排 Alpha | 参与模式、计划审批、DAG/并行、验收门禁、Skill/MCP、审批策略、产物版本 | 6-8 周 | 已完成（M2 关闭 2026-07-15） | 计划批准后可多 Agent 执行、审查返工有界、全程可追溯 |
| Phase 3 | Windows 闭测 | Worker、生图管线、CC Switch 导入、安装更新诊断、视觉与无障碍、5-20 邀请用户 | 6-9 周 | 未开始 | 满足设计文档 §23.2 全部闭测验收项 |
| Later | 平台扩展 | Gemini/Ollama、OAuth/CLI 桥、macOS/Linux、加密同步、团队、市场 | 分期 | 未开始 | 各阶段单独定义 |

## 2. 当前阶段

```text
当前阶段：M1、M2 已完成；Phase 3 未开始
阶段目标：保持 M1/M2 退出证据稳定，按路线图评估 Phase 3
开始日期：2026-07-12
M2 完成日期：2026-07-15
M1 完成日期：2026-07-15（用户将 dogfood 门槛改为 1 天；有效 1/1）
```

补充（2026-07-12）：

1. M0 独立审查修复与 Renderer reload 根因修复完成。
2. 真实 Electron reload / UI restart / Runtime restart + SQLite 证据通过。
3. 根强制门禁 test/typecheck/build --force 通过。
4. M1 已启动（2026-07-12）：Workspace IA 后端完成；Desktop UI / Providers 待续。
5. 不初始化 Git，除非用户明确要求。

补充（2026-07-15）：

1. M1 六项功能退出标准和外网真实网关 UI 手测 18/18 已有直接证据。
2. 用户于 2026-07-15 将内部 dogfood 门槛从 3 天改为 1 天；2026-07-12 的真实记录使当前达到 1/1。脚手架和自动化仍不计数。
3. 用户明确授权在 M1 日历门槛累计期间连续实施 M2；决策见 docs/development/14-decision-log.md 的 DEC-20260713-005。
4. M2 Task 1-9、确定性 exit demo、全仓验证和 Electron 双尺寸 QA 已完成；M1 / M2 均已关闭。


## 3. Phase 0 - 技术验证

目标：

1. 证明 UI 与 Runtime 双进程、命名管道、SQLite、检查点与恢复可行。
2. 锁定实现库选型（驱动、凭证存储、组件原语等），不改变产品边界。
3. 验证 V3 主工作台结构交互，并明确最终视觉 refinement 范围。

交付物：

1. 已确认的需求/路线图/设计/原则文档
2. `docs/engineering/04-tech-decisions.md` 中的 spike 结论
3. Electron + Runtime + SQLite 骨架
4. 假 Provider 流式消息、检查点、重启恢复演示
5. Windows 凭证加密、Playwright、UI Automation spike 记录
6. 按里程碑拆分的实施计划

范围（对应设计文档 §24 spikes）：

1. SQLite 驱动与迁移框架（Electron 打包兼容）
2. Windows 安全凭证存储与密钥迁移/备份行为
3. 命名管道协议、事件流、认证、Runtime 版本协商
4. Windows UI Automation 库与回退策略
5. 支持的 `SKILL.md` 兼容子集与一致性夹具
6. CC Switch 稳定配置面逆向范围、版本检测与安全失败
7. Provider 兼容矩阵（Responses / Chat Completions / Messages / Images / 网关 quirks）
8. XState 持久边界与崩溃恢复下的 DAG 调度
9. React 组件原语、图标系统、token 架构（不牺牲自定义设计方向）
10. 签名、更新器、崩溃报告隐私、Windows 内测分发

验收标准：

1. UI 崩溃不终止进行中 Run（Runtime 仍存活）。
2. Runtime 重启后可从事件/检查点重建 Run 状态。
3. 密钥不以明文进入 DB / 日志 / 诊断。
4. 每个 spike 有明确选择、备选与风险记录。
5. 不开始 Phase 1 业务实现前，用户已确认文档与关键技术决策。

## 4. Phase 1 - 多模型对话 Alpha

目标：

1. 交付可用的单 Agent 多轮对话工作台。
2. 打通多 Provider / 凭证组 / 模型绑定与上下文连续性。

功能范围：

1. 本地文件夹、任务、完整可滚动对话历史
2. Provider、网关、凭证组、模型、能力探测
3. OpenAI-compatible 与 Anthropic-compatible 流式
4. Agent 绑定、覆盖优先级、回退链、记忆范围
5. Context Packet、Manifest、跨任务显式引用、记忆提案
6. 完整浅/深主题、可折叠右侧 Run 轨迹

不包含：

1. 多 Agent 自动编排与验收门禁
2. 桌面/浏览器 Worker 实装
3. CC Switch 导入完整闭环（原始边界；后因用户需求提前完成）
4. 安装包与自动更新

验收标准：

1. 用户可在一任务内切换至少 2 个 Provider 与 3 个模型且无需重述目标/约束。
2. 每次模型调用可打开 Context Manifest。
3. Agent 默认绑定在用户更改前保持稳定。
4. 主工作台布局符合 Locked IA：左文件夹树、中完整聊天、右可折叠轨迹。
5. 无明文密钥泄漏路径。

## 5. Phase 2 - 多 Agent 编排 Alpha

目标：

1. 在同一任务内从对话渐进到协作/自动。
2. 提供可暂停、可恢复、可审计的 Run 生命周期。

功能范围：

1. 对话 / 协作 / 自动参与模式与计划审批
2. 持久图、依赖、并行快照、暂停/恢复
3. 验收门禁、Reviewer Agent、有界返工
4. Agent 编辑器、Skill 导入与作用域、MCP 授权
5. 审批策略与人类专属门禁
6. Artifact 版本、对比、合并、回滚

不包含：

1. 生产级 Windows 桌面自动化完善
2. 图像生成完整管线（可预留接口）
3. 团队协作与云同步

验收标准：

1. 计划批准后 Run 进入持久状态机，重启可恢复。
2. 并行产物使用隔离快照；冲突暂停，无 last-write-wins。
3. Reviewer 拒绝后返工有上限，达限后暂停等人。
4. Skill/MCP 新权限变更需要重新审批。
5. 工具、审批、产物、审查决策全链路可追溯。

## 6. Phase 3 - Windows 闭测

目标：

1. 形成可分发给 5-20 名邀请用户的 Windows 闭测包。
2. 打通本地执行能力、生图、导入、诊断与安装更新。

功能范围：

1. 文件、终端、Git、浏览器、Windows 桌面 Worker
2. 图像生成与视觉审查管线
3. 手动网关与 CC Switch 导入
4. 诊断、崩溃恢复、安装包、签名、更新
5. 视觉 polish、动效、无障碍、性能、闭测运营

不包含（Later）：

1. 消费级订阅登录与非官方鉴权提取
2. macOS / Linux 发布
3. 云执行、多用户团队空间、实时协作
4. 公开市场、视频/音频生成
5. 自动全局最优/最便宜模型搜索

验收标准：

见 `docs/product/01-requirements-clarification.md` §8 与设计文档 §23.2 全部 12 项。

## 7. Later 产品路线（摘要）

| 主题 | 内容 |
| --- | --- |
| 更多媒体与 Provider | Gemini、Ollama/本地模型、Adapter SDK、视频/音频异步生成 |
| 订阅与已安装工具连接 | 官方 OAuth、Codex/Claude 官方 CLI/SDK 桥；禁止非文档化 token 提取 |
| 跨平台 | macOS Accessibility / Linux AT-SPI；平台凭证与更新实现 |
| 加密同步 | 可选；先定义与元数据；E2E；无自动密钥同步 |
| 团队 | A 共享资产库 → B 共享项目任务 → C 真人实时协作 |
| 市场 | 签名包、发布者身份、权限审查；先私有团队目录 |

## 8. MVP / 闭测边界

```text
MVP 边界（闭测）：Windows 单机 local-first 多模型 Agent 工作台
必须：上下文连续性、用户控制模型绑定、可检查执行、权限门禁、恢复、基础本地工具与生图
不做：团队云、跨平台发布、订阅登录、自动选模、公开市场
```

## 9. 变更记录

| 日期 | 变更 | 原因 |
| --- | --- | --- |
| 2026-07-11 | 按已批准产品设计初始化路线图 | `/zno-init` 文档落盘 |
| 2026-07-11 | 文档确认；前端升格可获奖级原创标准 | 用户确认 V3 IA + 设计主导授权 |
| 2026-07-13 | 允许 M1 dogfood 累计期间连续实施 M2 | 用户明确要求 M1/M2 连续完成，且不伪造日历证据 |
| 2026-07-15 | M2 完成；M1 保持 1/3 open | M2 exit demo/QA 通过；M1 仅剩真实 dogfood 日期门槛 |



