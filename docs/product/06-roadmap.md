## 2026-08-22 路线图检查点：首版 RC 基础能力收口

### 已具备的首版主链

- 项目/工作区、对话历史、模型供应商、内核与权限选择。
- Native、ClaudeCode、GPT/Codex 的统一 ordered timeline；正文、思考、工具、状态与最终结论边界明确，Token、缓存和耗时可追踪。
- 图片附件按“当前模型视觉直传 -> 指定视觉模型 -> Windows OCR”确定性降级；Skill、MCP、工具审批、诊断导出、后台 Runtime、会话恢复和应用更新控制面。
- 本机 DeThink `1.0.14.971` 对照确认其发布包只包含 Claude/Codex 两个 adapter；SYNC-THINK 不需要等所有远期内核和商业化入口完成后才进入首版闭测。

### P0：邀请用户前必须关闭

1. [ ] 从当前 dirty 工作树冻结一份干净、可复现的 RC commit/tag；临时诊断脚本和本地证据目录不进入发布物。
2. [ ] 用最终 packaged build 跑 Native、ClaudeCode、GPT/Codex 的真实 Provider 矩阵：普通回复、连续多轮、中文思考、OCR/图片、工具 running/completed/failed、ask/workspace/full-access、最终正文、缓存/Token、Desktop 重连和 Runtime 重启。Pi 在有真实 adapter 前必须保持不可选或明确隐藏，不能出现“检测已安装但执行失败”。
3. [ ] 定义并实现 Runtime/系统重启期间的待审批语义。当前 `pendingToolApprovals` 仍是内存 Promise；至少要持久恢复可继续的审批，或在接管时持久终结为明确失败，不能留下看似可批准但已无执行上下文的卡片。
4. [ ] 收敛首版产品表面：隐藏账号、钱包、组织、快捷键、语音、每日回顾、安全查杀等 `ready: false` 空入口；已展示的 Pi、外部事件配置等入口必须与真实可用范围一致。
5. [ ] 发布版本从开发占位 `0.0.1` 升为明确 RC/正式版本并锁定 channel。邀请闭测可使用现有 unsigned 内部链；公开发布前完成 Authenticode、RFC 3161、真实 private feed、签名更新与 rollback E2E。
6. [x] 统一多内核主模型故障转移：ClaudeCode/GPT 外部内核已接入宿主失败分类、可见重试、Provider 优先级与 Agent fallback 链；终态 503 直接续接备用模型，停用 Provider 会被跳过，失败卡可手动选模型重试。最终 packaged 真实 Provider 矩阵仍由第 2 项统一验收。

### P1：首版稳定后优先补齐

1. [ ] 内核维护控制面：ClaudeCode/GPT 显示当前版、可用最新版和兼容性，提供检查/升级/失败回滚；应用自身更新与内核更新保持两个明确入口。
2. [ ] GitHub 之外的 webhook、文件 watcher、Git/bot 渠道配置 UI；底层 durable envelope 已具备，产品配置仍不完整。
3. [ ] 增加应用内反馈/诊断提交入口，并把首次 Provider 配置收敛为更短的可验证流程。
4. [ ] 完成 Pi adapter；在此之前不把 Pi 计入可用内核数量或发布验收矩阵。

### P2：不阻塞本地单用户首版

- 账号、订阅、钱包、组织、通知中心、云同步、公开市场、语音、跨平台和团队协作商业化能力。

## 2026-08-21 路线图检查点：后台持续会话与执行过程 P1

### 已完成

- daemon 成为长期控制面，监督 Runtime；Desktop 普通退出只断开 UI。
- Codex 迁移官方 app-server，原生 threadId 持久化并由有界 Session Host 管理 resident 进程。
- 执行过程面板 P1：本轮计划、真实顺序、工具类型、逐行披露、终态耗时和结构化详情；2026-08-22 已进一步移除人工编号并建立正文/工具视觉层级。
- 收尾门禁全绿：根级串行测试、typecheck、lint、build；Electron 完成深浅主题、长参数布局与 Desktop 断开后 Runtime 存活检查。

### 后续阶段

1. [x] 真实 Codex 连续 turn、新 app-server `thread/resume`、关闭 Desktop 后 replay 与 Runtime 崩溃恢复证据。
2. [x] daemon 外部事件入口：`push_to_bot`、Webhook、文件监听、Git 推送与异步任务提交共用 durable envelope。
3. [x] durable 去重键、lease/heartbeat、终态、状态查询与 Runtime crash takeover 合同。
4. [x] Desktop 断连/冷重启后的 pending approval 对账，以及 approve/deny 真实 Electron 验收。
5. [x] GitHub HTTP webhook endpoint：daemon 托管监听器、HMAC 验签、delivery id 去重、CLI 配置（`pnpm webhook:github`）。默认绑 `127.0.0.1`，公网暴露由用户自备隧道/反代。
6. [x] Claude Code 迁移官方 Agent SDK，继续保持 `KernelAdapter` 边界，不让厂商 SDK 类型扩散。
7. [x] 后台任务/事件中心 UI：事件与 Run 列表、失败原因、打开对话与重发；取消继续按具体任务能力补充。
8. 其余平台的配置 UI 与 bot 凭据绑定（GitHub 以外的 webhook 来源、文件 watcher 配置入口）。

## 2026-08-02 路线图检查点：本地工程任务收口，外部验收待补

- [x] Settings Diagnostics UI、脱敏导出、崩溃/恢复证据与隐私边界。
- [x] First-launch onboarding、长线程性能预算、视觉与 accessibility 本地门禁。
- [x] Windows release signing/timestamp fail-closed、独立 signer/publisher pin、installer manifest v3、blockmap 配对与 Generic feed policy。
- [x] Generic feed 对 blockmap 执行 gzip、JSON 与最小 schema 的 fail-closed 校验；仅显式 `allowLegacyFullDownload` 允许旧完整下载 fixture。
- [x] 隔离 unsigned fixture 覆盖真实 NSIS `0.0.1 → 0.0.2` 安装、blockmap 请求、Range/206 差分传输字节、重启与 install identity 连续性。
- [x] 内部无签名闭测发布链收口：watchdog ready/relaunch/health、默认 unsigned installer、真实更新与严格零残留均有可追溯证据。
- [x] Updater bounded recovery evidence、当前版本保留与撤回/重试 runbook。
- [x] 自动 binary rollback 本地能力：版本化 installer 自归档、durable intent/health/outcome、独立 PowerShell watchdog、one-shot attempt fence 与 Runtime hello 健康标记。
- [x] Database Governance P0.4：Event payload sidecar/backfill/rollback/GC、retention/archive、incremental vacuum 与 offline `VACUUM INTO` compaction 均完成 fixture-only 门禁。
- [x] 确定性 Electron 7-case 视觉证据及 `selftest:phase3` 聚合门禁。
- [ ] 使用正式 Authenticode 证书与真实 RFC 3161 timestamp provider 完成签名安装升级验收。
- [ ] 在真实私有 HTTPS feed 完成授权、cohort/rollout enforcement、CDN cache invalidation 与撤回演练。
- [ ] 使用真实图片 Provider 凭证完成生成、预览、Reviewer、返工与重启恢复验收。
- [ ] 完成 5–20 位邀请用户 Windows 闭测。
- [ ] 使用正式签名 installer 完成真实升级和故障注入自动 rollback E2E。

# Roadmap

## 2026-08-02 增量：Database Governance P0

- [x] **P0.1 只读诊断与 dry-run**：新增 versioned database report、PRAGMA/表计数、Event/Checkpoint 比例、4096 条有界类型样本、备份预算、protected/candidate 维护计划和 readonly query_only CLI；真实 16.87GB 库约 6 秒完成 quick 诊断。
- [x] **Codex 数据治理对比**：完成官方行为与本机实现分层记录，采用正文/投影分离、archive 生命周期、关注点拆库、migration/backfill、逻辑清理与物理压缩分离等原则。
- [x] **P0.2 写入放大修复**：Checkpoint 改为每 128 个 durable Event 写入，四种终态强制落点；非终态 Run 投影支持稀疏 Checkpoint 后的 Event replay；fallback/context 同事务提交并以 `modelId + packetId` fence 阻止重复 continuation。Runtime 63 files / 431 tests 全量通过。
- [x] **P0.3 可回滚执行器**：已实现 exact hashed manifest、stale fingerprint fence、verified recovery backup、显式维护窗口与 token、分批事务、durable audit/Ctrl+C 取消恢复，以及历史备份 quarantine；默认 CLI 仍只读，真实 16.87 GB 主库未执行。
- [x] **P0.4 投影与长期 retention**：完成 Event payload/Context Packet 外置、projection backfill、归档预算、incremental vacuum 与离线物理压缩策略。
  - [x] 第一切片：V1 content-addressed gzip sidecar、SQLite envelope/projection、自动 hydrate、完整性校验与默认内联兼容；保持 opt-in，尚未接入 Runtime。
  - [x] 第二切片 A：sidecar-aware exact manifest、ordered reference hash、唯一 blob 清单、portable SQLite + sidecar recovery set、staging 发布、失败清理与 completed/resume 重验证。
  - [x] 第二切片 B：离线 Event payload backfill 执行与回滚门禁。
    - [x] B1 exact dry-run：固定 selector/projection builder、精确 Event/reference 清单、容量估算、plan hash 与 stale fence；只写计划 JSON，不修改 SQLite、sidecar、WAL 或备份。
    - [x] B2 durable batch cursor/cancel-resume：固定 plan/source fence、批次事务、批次边界取消与 crash-safe 幂等恢复。
    - [x] B3 rollback：基于 portable SQLite + sidecar recovery set 的精确离线恢复与验证。
    - [x] B4 orphan mark/sweep：先标记引用集合，再按 fence 清理无引用 blob。
  - [x] 第三切片 A：对白名单 `context.packet.built` 启用 Runtime 显式 opt-in 外置写入，默认 64 KiB，projection 固定 `context-packet-query-v1@1`。
  - [x] 第三切片 B：实现 fully-global low-value Event retention/archive、精确 portable recovery segment、durable execute/rollback、cancel/resume、崩溃窗口对账、incremental vacuum 与 offline `VACUUM INTO` 压缩验收。

本文档记录 SYNC-THINK 阶段路线图、里程碑和验收标准。  
产品边界与 Locked 决策以 `docs/superpowers/specs/2026-07-11-sync-think-product-design.md` 为准。

规划假设：单人开发、日均较高投入。预计到 Windows 闭测约 **20-28 周**（规划估计，非发布承诺）。

## 1. 阶段总览

| 阶段    | 目标                    | 范围                                                                                    | 预计   | 状态                                      | 验收标准                                                            |
| ------- | ----------------------- | --------------------------------------------------------------------------------------- | ------ | ----------------------------------------- | ------------------------------------------------------------------- |
| Phase 0 | 技术验证与文档/结构基线 | Electron/Runtime/管道/SQLite 骨架；凭证/Playwright/UIA spike；V3 结构验证               | 2-3 周 | 已完成（M0 关闭 2026-07-12）              | Spike 结论写入 tech decisions；骨架可演示假 Provider 流式与重启恢复 |
| Phase 1 | 多模型对话 Alpha        | 文件夹/任务/完整对话；Provider 与流式适配；Agent 绑定与 Context Packet；浅/深主题与轨迹 | 6-8 周 | 已完成（M1 关闭 2026-07-15；dogfood 1/1） | 同一任务跨至少 2 Provider / 3 模型无需重述上下文                    |
| Phase 2 | 多 Agent 编排 Alpha     | 参与模式、计划审批、DAG/并行、验收门禁、Skill/MCP、审批策略、产物版本                   | 6-8 周 | 已完成（M2 关闭 2026-07-15）              | 计划批准后可多 Agent 执行、审查返工有界、全程可追溯                 |
| Phase 3 | Windows 闭测            | Worker、生图管线、CC Switch 导入、安装更新诊断、视觉与无障碍、5-20 邀请用户             | 6-9 周 | 进行中（本地工程已收口，外部证据待补）    | 满足设计文档 §23.2 全部闭测验收项                                   |
| Later   | 平台扩展                | Gemini/Ollama、OAuth/CLI 桥、macOS/Linux、加密同步、团队、市场                          | 分期   | 未开始                                    | 各阶段单独定义                                                      |

## 2. 当前阶段

```text
当前阶段：M1、M2 已完成；Phase 3 本地工程已收口，外部发布与闭测证据进行中
阶段目标：完成正式签名、真实 private feed、真实图片 Provider 与 5-20 位邀请用户 Windows 闭测
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

补充（2026-07-16）：

1. File、Terminal、Git Worker 已有真实实现，包含 capability allowlist、审批、取消/超时、输出限幅及真实路径 symlink/junction 逃逸防护。
2. Provider 工具循环已支持文件读/列/写、受限命令及 Git status/diff，并在审批后用持久检查点恢复。
3. Browser Worker、Windows UIA Worker、图像生成完整管线、安装器、签名和自动更新仍未完成；不满足 Phase 3 退出标准。

补充（2026-07-28）：

1. NewMax P0 已交付递归 Pane、流式合批与受约束文件编辑；P1 已交付项目正文搜索与受控终端 Pane。
2. 项目正文搜索使用 `rg --json` + Node fallback，不建立持久索引；终端复用既有 Worker 并懒加载 xterm，不引入 PTY 或持久 shell。
3. P1 最终全仓 test/typecheck/lint/build 和浅深双尺寸 Electron QA 全部通过；Phase 3 仍不因该切片提前关闭。

补充（2026-07-29）：

1. NewMax P2 已交付 Agent Skill 默认继承与 Composer 会话级临时覆盖；Agent/Team 默认启用有效 owner 的装备列表，模型直聊为 `[]`，旧客户端仍保留继承 Agent allowlist 的兼容路径。
2. Skill 列表使用 metadata-only SQL 并在菜单打开时懒请求；正文只由 Runtime 在校验 allowlist、归档和审批后按精确 ID 加载。
3. Context、Provider、Manifest、fallback/rebind/retry/recovery 使用同一冻结 ID；durable Run 状态不复制 `SKILL.md` 正文。
4. Composer 成功和失败都保持当前会话选择；切换有效 Agent/Team owner 时恢复新默认，只切换模型 override 不清空。欢迎页首条覆盖会交给新建对话，目录等价刷新不覆盖用户调整。
5. 自动 DAG 的每个 Step 按自身冻结 AgentVersion 自动加载对应 Skill，成员间不串用，也不要求用户逐 Step 配置；P2 已通过最终门禁、独立复审与最新版浅深双尺寸实窗复验，仍不提前关闭 Phase 3。

补充（2026-07-31）：

1. Windows UIA Worker P0.1-P0.4 已完成短生命周期 Host、真实 UIA COM、窗口发现、bounded inspect、exact selector 和最小 read/focus/invoke/set-value 语义动作。
2. P0.5 已完成默认关闭的内置 Computer Use 插件、Runtime capability gate、七个聊天工具和设置页开关。插件决定是否有能力，`execution_mode` 决定启用后的审批；完全访问不自动启用插件。
3. P0.6 已完成 durable Desktop command/intent、重启后未知 in-flight 转 `waiting_user` 和用户输入中断 fence；命令结果可重放，未知副作用不自动重试。
4. P0.7 已完成持久 `waiting_user` 的 Storage/Runtime 安全查询、Desktop IPC 与 Renderer 只读等待卡片。
5. P0.8 已完成 Continue/Cancel 持久 resolution、`expectedUpdatedAt` 乐观并发栅栏、Desktop 双按钮交互和 lifecycle 重查；Continue 只确认人工处理，不重放原 UIA 动作。
6. P0.9 已完成 observe/display/sensitive/human-only/prohibited 风险分级、Runtime 二次审批强制、密码字段识别和审批/lifecycle 安全投影。full-access 只免除可信 display 审批，sensitive/human-only 仍需审批。
7. P0.10 已完成仓库内真实 WPF fixture、真实 UIA SetValue、GetLastInputInfo 用户输入中断、Desktop/Runtime 冷重启等待卡恢复、Continue/Cancel 和动作/Provider 不重放验收。Windows UI Automation Worker 与人工接管回退主项已完成。
8. Image P0.1-P0.3 已完成：OpenAI-compatible Images typed Adapter、Runtime 受控落盘、opaque 预览、严格 size/quality/count、多候选 durable 选择、冻结视觉 Reviewer assignment 与有界图片返工闭环均已接通。
9. Run fallback 跨层循环已通过 durable `attemptedModelIds` fence 收口；Provider priority 与 Agent fallback 统一跳过本 Run 已尝试模型，候选耗尽后有界暂停。既有异常数据库清理作为独立数据修复任务。
10. Image P0.3 自动化闭环已覆盖“候选 → 选择 → vision review → rework → 再选择 → 达限暂停”；下一步只保留真实凭证人工验收与失败体验优化，不再阻塞 Phase 3 的安装分发主线。Phase 3 继续保持进行中。
11. Windows Distribution P0.1-P0.2 已完成：自包含 portable、packaged identity、per-user NSIS installer，以及 clean / overlay / 真实版本升级 / uninstall / reinstall 自动 smoke 均已通过；卸载默认保留身份密文和数据库。
12. Windows Distribution P0.3 的 installer 压缩、品牌图标、production deploy、updater 手动控制面和 loopback Generic feed 版本/SHA-512 E2E 已完成：更新默认关闭、秘密留在 Main、安装前受控退出；真实私有 HTTPS feed + 真实 NSIS 重启安装、Authenticode、differential package、失败回滚与闭测清单仍未完成，Phase 3 继续保持进行中。

补充（2026-08-03）：

1. Windows Distribution 本地工程链已补齐 automatic binary rollback：NSIS 版本化 installer 自归档、Main rollback coordinator、durable intent/health/outcome、独立 PowerShell watchdog、one-shot attempt fence 与 Runtime hello 健康标记均已接线。
2. packaged identity 并发首次启动竞态已修复；全仓并发测试、portable production deploy、schema v3 unsigned installer 与自包含 Generic feed E2E 已恢复稳定绿门禁。
3. `pnpm selftest:phase3` 从零准备发布 fixture 并通过全部 9 个步骤，聚合结果为 `passed-with-external-evidence-pending`；Phase 3 继续等待正式签名 rollback E2E、真实 private feed/图片 Provider 和邀请用户闭测。

补充（2026-08-04）：

1. 内部无签名闭测链已全绿，标准 `pnpm test:update-install:win` 通过从源码构建、差分下载、真实升级、自动拉起、健康登记和严格卸载清理。
2. 默认内部包为 schema v3 `unsigned-fixture`，正式签名校验规则未放宽；该包可进入内部闭测，但不作为公开发布包。
3. Phase 3 后续仅保留正式签名/真实外部服务证据与 5-20 位邀请用户反馈。

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

当前交付切片（更新至 2026-08-01）：

- [x] File Worker：读、列目录、原子写；删除禁用；路径和真实路径边界。
- [x] Terminal Worker：命令 allowlist、无 Shell、受限 cwd、超时/取消、输出限幅。
- [x] Git Worker：固定 argv 的 status/diff/log/branch，literal pathspec 和路径边界。
- [x] 模型工具循环：Provider 工具协议、持久检查点、Scheduler 审批恢复、正文与轨迹 Artifact。
- [x] 递归 Pane 与文件编辑：横/纵嵌套、Workspace 快照、乐观并发保存、外部冲突和草稿边界。
- [x] 项目内容搜索：`rg --json` + Node fallback、取消/超时/限幅、行列定位与路径边界。
- [x] 终端 Pane：lazy xterm、受控命令、流式输出、停止/清空/历史/cwd；明确不是持久 PTY。
- [x] Agent Skill 默认继承：Agent Library 一次配置、Composer 会话级临时覆盖、metadata-only 懒加载；自动 Step 按成员 AgentVersion 隔离装载并冻结恢复。
- [x] Browser Worker 与网页授权执行。
  - [x] P0.1：系统浏览器 Host、持久 Profile、CDP、Tab lease 与基础动作。
  - [x] P0.2：聊天 `browser_*` 从 Renderer `<webview>` 迁到 Runtime Worker。
  - [x] P0.3：命令状态、站点授权、敏感动作审批与重启恢复。
  - [x] P0.4：Team Step 精确权限、Run/Step Tab lease 与成员隔离。
  - [x] P0.5：持久 `waiting_user`、继续/取消和人工接管生命周期。
    - 正式 Desktop/Runtime 冷重启 E2E 的 Continue、Cancel close-page、Cancel keep-open 三路径均通过；Provider 与 `browser_open` 不重放，解析后浏览器与 metadata 完整清理。
- [ ] Browser Automation Studio：录制、Workflow 与重复执行。
  - [x] P1.1：Runtime Profile 真源、脱敏站点会话清单、按站点清除与完整 Profile 删除。
  - [x] P1.2：专用系统浏览器语义动作录制、实时脱敏步骤流、异常终态恢复与停止后清理。
  - [ ] P1.3：WorkflowVersion、固定值/运行变量/秘密引用、编辑和确定性回放。
    - [x] 第一切片：自动化 Task、手动/AI Draft、录制提交、人类审核、驳回重录与不可变 WorkflowVersion；Browser 默认任务页、Chrome-first 和网页录制浮层同步完成。
    - [x] 第一切片收口：严格 contentRef 合同、Profile 引用保护、已发布 Task 的 V2 Draft、审核历史、URL 搜索与 V2 审核 UI。
    - [ ] 后续切片：步骤编辑、固定值/运行变量/秘密引用绑定，以及已发布 WorkflowVersion 的确定性回放。
  - [ ] P1.4：运行历史、逐步日志/截图、失败定位与登录 handoff。
  - [ ] P1.5：手动启停的定时任务；条件、循环与 AI 自修复留在 P2。
- [x] Windows UI Automation Worker 与人工接管回退。
  - [x] 技术 Spike 与 P0 边界：Koffi COM、.NET sidecar、Microsoft WinAppCLI 三方案完成真实 Windows fixture 验证。
  - [x] 用户确认短生命周期 Node Host + Koffi UIA COM，并更新 TD-007。
  - [x] P0.1-P0.4：DesktopWorker Host、bounded inspect、exact selector 与最小 read/focus/invoke/set-value 语义动作。
  - [x] P0.5：默认关闭的内置 Computer Use 插件、Runtime capability gate、七个聊天工具、设置页开关与普通审批语义。
  - [x] P0.6：durable Desktop command/intent、幂等结果重放、未知 in-flight 恢复和用户输入中断至 `waiting_user`。
  - [x] P0.7：持久 `waiting_user` 的 Storage/Runtime 安全投影、Desktop IPC 与 Renderer 只读等待卡片。
  - [x] P0.8：Continue/Cancel 持久 resolution、`expectedUpdatedAt` 乐观并发栅栏、Desktop 交互与 durable lifecycle 重查。
  - [x] P0.9：动作风险分级、full-access 边界、密码字段 human-only、Runtime 二次审批强制与安全事件投影。
  - [x] P0.10：真实 WPF fixture + 用户输入中断 + Runtime/Desktop 冷重启 + waiting card 恢复 + Continue/Cancel E2E；原 UIA 动作和 Provider 请求均不重放。
- [x] 图像生成完整管线与视觉审查闭环。
  - [x] Image P0.1：OpenAI-compatible Images Adapter、base64-only durable output、Runtime 受控落盘、`contentRef/contentHash`、candidate ArtifactVersion 与重启幂等 replay。
  - [x] Image P0.2：Renderer 图片 Artifact 卡片、安全协议预览与任务/Run 过程视图检查。
  - [x] Image P0.3：严格 size/quality/count、多候选 durable 选择、冻结 vision Reviewer、原 Artifact 图片返工与达限暂停。
- [ ] 安装器、代码签名、自动更新和闭测分发。
  - [x] Windows Distribution P0.1：unsigned portable staging、受控发布目录、Node 20/Runtime 自包含布局、敏感文件 preflight、SHA-256 manifest 与隔离冷启动 smoke。
  - [x] Windows Distribution P0.2：packaged install identity / pipe credential 持久化、Windows 安装器，以及干净安装/升级/卸载 smoke。
    - [x] packaged install identity、safeStorage secret、Runtime child env 同源投影与双冷启动复用验收。
    - [x] Windows 安装器封装，以及干净安装、覆盖升级、卸载和用户数据保留 smoke。
  - [ ] Windows Distribution P0.3：代码签名、自动更新、失败回滚和闭测分发清单。
    - [x] installer normal 压缩、确定性品牌图标、portable EXE icon group 与现代 production deploy。
    - [ ] Authenticode 与证书流程：本地 fail-closed 配置和 verifier 已完成，仍待正式证书与真实 RFC 3161 timestamp 验收。
    - [x] electron-updater 本地发布链：私有 feed 契约、下载校验、版本/channel 策略、blockmap differential package、受控退出与真实 `quitAndInstall` fixture。
      - [x] Main-only feed/token 配置、手动检查/下载/安装、Renderer 安全状态投影、安装前 Runtime 受控退出与 updater cache bootstrap。
      - [x] Generic feed fixture、Bearer header、metadata 解析、版本/channel 矩阵、installer SHA-512 与 blockmap gzip/JSON/schema fail-closed E2E。
      - [x] 隔离 unsigned NSIS `0.0.1 → 0.0.2` 真实重启安装：Range/HTTP 206 差分传输、identity/secret/SQLite 连续性与当前版本安装前保留均通过。
    - [ ] 在真实 private origin/CDN 完成授权、cohort/rollout、cache invalidation、撤回与正式签名升级演练。
    - [x] 自动 binary rollback 本地实现：installer 自归档、durable intent/health/outcome、独立 watchdog、attempt fence 与目标 Runtime health marker。
    - [ ] 使用正式签名 installer 完成失败目标版本的真实 automatic rollback E2E。
    - [ ] 闭测分发、诊断收集与发布清单。

不包含（Later）：

1. 消费级订阅登录与非官方鉴权提取
2. macOS / Linux 发布
3. 云执行、多用户团队空间、实时协作
4. 公开市场、视频/音频生成
5. 自动全局最优/最便宜模型搜索

验收标准：

见 `docs/product/01-requirements-clarification.md` §8 与设计文档 §23.2 全部 12 项。

## 7. Later 产品路线（摘要）

| 主题                 | 内容                                                              |
| -------------------- | ----------------------------------------------------------------- |
| 更多媒体与 Provider  | Gemini、Ollama/本地模型、Adapter SDK、视频/音频异步生成           |
| 订阅与已安装工具连接 | 官方 OAuth、Codex/Claude 官方 CLI/SDK 桥；禁止非文档化 token 提取 |
| 跨平台               | macOS Accessibility / Linux AT-SPI；平台凭证与更新实现            |
| 加密同步             | 可选；先定义与元数据；E2E；无自动密钥同步                         |
| 团队                 | A 共享资产库 → B 共享项目任务 → C 真人实时协作                    |
| 市场                 | 签名包、发布者身份、权限审查；先私有团队目录                      |

## 8. MVP / 闭测边界

```text
MVP 边界（闭测）：Windows 单机 local-first 多模型 Agent 工作台
必须：上下文连续性、用户控制模型绑定、可检查执行、权限门禁、恢复、基础本地工具与生图
不做：团队云、跨平台发布、订阅登录、自动选模、公开市场
```

## 9. 变更记录

| 日期       | 变更                                             | 原因                                                                                                                                                 |
| ---------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-11 | 按已批准产品设计初始化路线图                     | `/zno-init` 文档落盘                                                                                                                                 |
| 2026-07-11 | 文档确认；前端升格可获奖级原创标准               | 用户确认 V3 IA + 设计主导授权                                                                                                                        |
| 2026-07-13 | 允许 M1 dogfood 累计期间连续实施 M2              | 用户明确要求 M1/M2 连续完成，且不伪造日历证据                                                                                                        |
| 2026-07-15 | M2 完成；M1 保持 1/3 open                        | M2 exit demo/QA 通过；M1 仅剩真实 dogfood 日期门槛                                                                                                   |
| 2026-07-16 | Phase 3 进入部分实施                             | File/Terminal/Git 与模型工具循环已交付；Browser/UIA/安装分发仍待完成                                                                                 |
| 2026-07-28 | Phase 3 工作区 P0/P1 切片完成                    | 递归 Pane、文件编辑、内容搜索与受控终端 Pane 已通过全仓及实窗门禁                                                                                    |
| 2026-07-29 | Phase 3 工作区 P2 切片完成                       | 每轮 Skill 精确选择、懒上下文与冻结恢复已通过全仓及实窗门禁                                                                                          |
| 2026-07-31 | Phase 3 Browser Worker P0 完成                   | P0.1-P0.5 已通过系统浏览器 Host、持久权限、Team 隔离与三路径真实重启 handoff E2E                                                                     |
| 2026-07-31 | Windows UIA Worker 技术 Spike 完成               | 三方案真实 fixture 验证完成；推荐 Koffi 独立 Worker，等待用户确认后进入实现                                                                          |
| 2026-07-31 | DesktopWorker P0.1-P0.6 完成                     | 已接线 UIA/Computer Use、durable command 与输入中断；Continue/Cancel 闭环仍待完成                                                                    |
| 2026-08-01 | DesktopWorker P0.7 完成                          | 持久等待态安全查询与只读卡片已接线；Continue/Cancel 与真实恢复仍待完成                                                                               |
| 2026-08-01 | DesktopWorker P0.8 完成                          | Continue/Cancel 与并发栅栏已接线；下一步为动作风险分级和真实冷重启 E2E                                                                               |
| 2026-08-01 | DesktopWorker P0.9 完成                          | 五级动作风险与 Runtime 审批策略已收紧；下一步为真实 WPF 冷重启人工接管 E2E                                                                           |
| 2026-08-01 | DesktopWorker P0.10 / P0 收口                    | 真实 WPF 中断、冷重启恢复、Continue/Cancel 与不重放正式 E2E 2/2 通过                                                                                 |
| 2026-08-01 | Image P0.1 durable 管线完成                      | 专用 Images Adapter、受控落盘、引用 Artifact 与重启幂等完成；下一步 Renderer 展示                                                                    |
| 2026-08-01 | Image P0.3 视觉审查闭环完成                      | 冻结选择、Runtime-only vision、多候选图片返工与达限暂停已形成有界闭环                                                                                |
| 2026-08-01 | Windows Distribution P0.2 identity 完成          | packaged 身份、safeStorage pipe secret 与两轮冷启动复用通过；安装器 smoke 仍待完成                                                                   |
| 2026-08-02 | Windows Distribution P0.2 / P0.3 发布基线更新    | NSIS lifecycle smoke、normal 压缩、品牌图标与现代 production deploy 已通过；剩余签名、更新、回滚和闭测清单                                           |
| 2026-08-02 | Windows Distribution P0.3 updater 控制面完成     | Main-only 私有 feed、手动检查/下载/安装、安全投影与受控退出已接线；真实 feed、签名、差分与回滚仍待完成                                               |
| 2026-08-02 | Windows Distribution P0.3.2 loopback feed E2E    | 真实 Electron driver 已通过版本矩阵、Bearer 请求和完整 installer SHA-512 成功/失败验收；真实 HTTPS installer 安装仍待完成                            |
| 2026-08-02 | Windows Distribution P0.3.3 HTTPS/真实 NSIS 下载 | updater E2E 已切换受控 HTTPS，并通过 107,893,840 bytes 真实 installer 下载与缓存 SHA-512；下一步为真实 quitAndInstall 重启安装                       |
| 2026-08-02 | Windows Distribution P0.3.4 差分安装 E2E         | unsigned fixture 已通过真实 `quitAndInstall`、Range/206 差分传输与 Runtime/identity/SQLite 连续性；仅剩正式签名与真实 private feed 演练              |
| 2026-08-03 | Phase 3 本地工程门禁收口                         | 修复 identity 竞态与并发抖动，恢复 portable/update-feed 自包含发布链，automatic rollback 本地实现纳入现行路线图；仅剩外部证据                        |
| 2026-08-05 | Browser Automation Studio 进入 P1.1              | 用户确认专用系统 Edge/Chrome 录制/回放，并要求 Profile 站点会话可见、可按站点清除；先统一 Runtime Profile 真源                                       |
| 2026-08-05 | Browser Automation Studio P1.1 完成              | Runtime Profile 真源、脱敏站点会话清单、实时刷新、按站点清除与完整 Profile 删除已通过自动化门禁；下一步进入 P1.2 语义动作录制                        |
| 2026-08-05 | Browser Automation Studio P1.2 完成              | 单 Page 主 Frame 语义录制、SQLite durable 草稿、实时步骤、敏感值占位、Profile 独占与冷启动中断恢复完成；下一步进入 P1.3 WorkflowVersion 与确定性回放 |
| 2026-08-06 | Browser Automation Studio P1.3 第一切片收口      | 修复 contentRef 放宽，补齐 Profile 引用保护、V2 Draft、审核历史、URL 搜索与 Desktop V2 审核路径；确定性执行仍属后续切片                              |

### Image P0.3（2026-08-01 更新）

- [x] 图片生成结果安全落盘与 opaque 预览。
- [x] 严格 size/quality/count 配置从 Plan 冻结到 Provider，并支持单次 1-4 个候选。
- [x] 多候选归入单一 Artifact，并列展示且 durable 选择。
- [x] Reviewer assignment 使用独立不可变投影冻结当前轮所选版本；未选择时 Run 可恢复暂停且零 Provider reservation。
- [x] Runtime-only 读取所选图片并发送 vision 多模态请求；本地 contentRef/path 不进入 Provider 或 Renderer。
- [x] reject 后图片返工归回原 Artifact、保留 parent lineage、支持再次多候选选择，并在 maxIterations 达限后暂停。
- [ ] 使用真实图片 Provider 凭证完成最终人工交互验收，并继续优化错误提示与恢复体验。
