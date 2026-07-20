# Tech Decisions

本文档记录开发过程中涉及的技术选型、原因、取舍和后续影响。任何重要依赖、框架、服务、架构方案变化都必须记录。

产品架构边界以 `docs/superpowers/specs/2026-07-11-sync-think-product-design.md` 为准。  
标记为 **Locked for planning** 的栈方向已在产品设计中确认；TD-004–014 已于 2026-07-11 由用户确认采用（“全部接受推荐，计划确认”）。

## 1. 技术栈总览

| 分类 | 选型 | 用途 | 选择原因 | 状态 |
| --- | --- | --- | --- | --- |
| 桌面壳 | Electron | Windows 闭测桌面 UI | 跨平台迁移路径、生态成熟；产品设计已否决 Tauri/WinUI 首发 | Locked for planning |
| UI | React + TypeScript | 主工作台与各中心页 | 与 Electron 生态匹配；利于复杂状态 UI | Locked for planning |
| Runtime | 独立 Node.js + TypeScript 进程 | 编排、上下文、Provider、策略 | UI 重启不杀 Run；可被未来 CLI 复用 | Locked for planning |
| 真源存储 | SQLite + FTS5 | 任务/事件/定义/搜索 | local-first、单文件、可备份迁移 | Locked for planning |
| SQLite 访问 | `better-sqlite3` + Drizzle ORM + drizzle-kit | 同步驱动、类型化 schema、迁移 | 见 TD-004 | 已采用 |
| 状态表达 | XState v5 + 自研 event/checkpoint store | Run/Step 生命周期 | 见 TD-011 | 已采用 |
| UI↔Runtime | Electron main bridge + 认证 named pipe + JSONL 帧 | 本地协议 | 见 TD-006 | 已采用 |
| 浏览器自动化 | Playwright Worker | 授权网页操作 | 成熟、可隔离 | Locked for planning |
| Windows 桌面控制 | 自研 Worker + `koffi` 调 UIA COM；失败回退人工 | 桌面自动化 | 见 TD-007 | 已采用 |
| MCP | 官方 TypeScript SDK | 工具协议 | 标准；授权在 Runtime | Locked for planning |
| Provider | OpenAI-compatible + Anthropic-compatible 适配器 | 模型/图像调用 | API-first 闭测覆盖面 | Locked for planning |
| 凭证 | Electron `safeStorage`（DPAPI）封装 + CredentialRef | API Key 等 | 见 TD-005 | 已采用 |
| 视觉系统 | 自定义 token + 原创组件；Radix 仅作无样式行为原语；Lucide 图标 | 可获奖级工作台 | 见 TD-003 / TD-012 | 已采用 |
| 测试 | Vitest + Playwright(test 仅 E2E 后期) | 单测/合同/集成 | 见 TD-014 | 已采用 |
| 分发 | electron-builder NSIS + 代码签名 + electron-updater 私有 feed | 闭测 | 见 TD-013 | 已采用 |
| 包管理 / monorepo | pnpm workspace + Turborepo | 多包构建 | 见实施计划 | 已采用 |

## 2. 已确认决策

### TD-001: 应用架构 = Desktop UI + 独立 Local Agent Runtime

日期：2026-07-11  
状态：已采用  
用户确认：产品设计阶段批准

选择：双长生命周期进程（Electron UI + 独立 Node Runtime）；高风险工具用短生命周期 Worker。

否决：单进程桌面应用；Tauri 首发；WinUI 3 首发。

### TD-002: 规划级技术栈锁定

日期：2026-07-11  
状态：已采用（规划级）  
用户确认：产品设计 + `/zno-init` 文档确认

选择：Electron / React+TS / Node Runtime / SQLite / XState 表达 + 事件检查点 / Playwright / MCP TS SDK / OpenAI+Anthropic 适配器。

### TD-003: 前端视觉标准 = V3 锁 IA，视觉可获奖级原创

日期：2026-07-11  
状态：已采用  
用户确认：文档确认时明确授权

选择：IA 锁 V3；视觉/组件/动效/记忆点由 Claude 主导；Continuum Bench；禁止换皮与组件库默认皮肤。

---

## 3. Phase 0 Spikes — 方案对比与结论（已确认采用）

> 用户于 2026-07-11 回复「全部接受推荐，计划确认」。下列选型均为 **已采用**。

### TD-004: SQLite 驱动与迁移框架

日期：2026-07-11  
状态：已采用
用户确认：2026-07-11「全部接受推荐，计划确认」

技术需求：

```text
Electron 打包兼容；Runtime 进程高频读写；事件追加与检查点；FTS；迁移可回滚备份；TypeScript 友好。
```

约束：

```text
Windows 闭测；单人维护；模块化单体；密钥不进 DB 明文；迁移失败要只读诊断模式。
```

| 方案 | 优点 | 缺点 | 性能 | 维护 |
| --- | --- | --- | --- | --- |
| A. better-sqlite3 + Drizzle + drizzle-kit | 同步 API 简单可靠；Electron 广泛使用；Drizzle 轻、SQL 贴近、迁移清晰 | native 模块需 electron rebuild；异步场景要自己包装 worker | 本地嵌入式最优之一 | 中低 |
| B. libsql / @libsql/client（本地文件） | 与 turso 生态接近；有潜力 | 本地桌面收益有限；多一层抽象 | 好，但非刚需 | 中 |
| C. node:sqlite（官方实验）/ sql.js | 无/少 native 痛点 | 成熟度/API/FTS/打包与性能边界不适合作为真源首选 | sql.js 偏弱 | 风险高 |

推荐方案：

```text
A. better-sqlite3 + Drizzle ORM + drizzle-kit
FTS5 用手写 SQL migration 管理；所有访问经 storage 包，禁止业务直接 new Database。
```

推荐理由：

1. 同步驱动适合 Runtime 事务与检查点语义。  
2. Drizzle 比重型 ORM 更可控，迁移可审。  
3. 行业对 Electron + better-sqlite3 路径最熟，踩坑资料多。

性能影响：主线程/ Runtime 内同步 SQL 需控制事务粒度；大导出走流式/分页。  
维护成本：需配置 electron-builder / @electron/rebuild。  
风险与回退：native 编译失败时短期可评估 libsql 本地文件；schema 层用 Drizzle 隔离可换驱动。

需要用户确认：是否接受 better-sqlite3 + Drizzle 作为存储栈？

---

### TD-005: Windows 安全凭证存储

日期：2026-07-11  
状态：已采用
用户确认：2026-07-11「全部接受推荐，计划确认」

技术需求：

```text
API Key 等密钥 OS 级保护；DB 只存 CredentialRef；可备份/迁移策略明确；Renderer 永不持有明文。
```

约束：

```text
Windows 优先；后续 macOS Keychain / Linux libsecret 可换实现；禁止自建可逆“应用密码”糊弄。
```

| 方案 | 优点 | 缺点 | 风险 |
| --- | --- | --- | --- |
| A. Electron safeStorage（DPAPI） | 官方、少依赖、跟用户登录会话绑定 | 与机器/用户配置相关；重装/换机需导出策略 | 中低 |
| B. keytar（系统凭据管理器） | 经典；跨平台抽象 | 原生依赖维护波动；打包更烦 | 中 |
| C. 仅 SQLCipher/应用层加密文件 | 全自控 | 主密钥存放问题转移到另一层；易做错 | 高 |

推荐方案：

```text
A. 在 Runtime（或受控 main 辅助模块）封装 secure-store：
  - 使用 Electron safeStorage 加密 secret payload
  - SQLite 只存 CredentialRef { id, provider, label, ciphertext meta, createdAt... }
  - 明文仅在调用 Provider 前短时内存存在，用后清零意图
  - 导出备份：默认不含密钥；可选“加密导出”需用户口令（Phase 3）
  - 迁移：版本化 envelope；失败则拒绝启动写入并进诊断
```

推荐理由：官方路径、依赖最少、符合 local-first 与“密钥不进 DB 明文”。  
风险与回退：若 Runtime 完全独立进程难以直接用 Electron safeStorage，则通过 **仅 main 可访问的 secret broker IPC/pipe 方法** 取用，或 Phase 0 验证后改 keytar。  
需要用户确认：是否接受 safeStorage + CredentialRef 模型？

---

### TD-006: 命名管道协议、事件流、认证、版本协商

日期：2026-07-11  
状态：已采用
用户确认：2026-07-11「全部接受推荐，计划确认」

技术需求：

```text
UI 与 Runtime 可靠通信；流式事件；本机用户边界；安装身份校验；协议可演进。
```

| 方案 | 优点 | 缺点 |
| --- | --- | --- |
| A. Windows named pipe + 长度前缀 JSON / JSONL 事件 | 符合设计文档；本机 ACL 可控 | 需自研帧与重连 |
| B. localhost WebSocket/HTTP | 调试容易 | 端口占用、误暴露、防火墙干扰 |
| C. 仅 Electron IPC（无独立 Runtime 管道） | 简单 | 破坏“Runtime 可独立/UI 可死”边界 |

推荐方案：

```text
A. 分层：
  1) Electron main ↔ Renderer：contextBridge + 严格 IPC（无 Node integration）
  2) main（或 thin connector）↔ Runtime：\\.\pipe\sync-think-<installId> 
  3) 帧：请求/响应用 length-prefixed JSON；服务端推送用 JSONL event stream 或多路复用 id
  4) 握手：protocolVersion, appVersion, installId, process nonce, HMAC/token 文件仅用户可读
  5) 能力协商：features[]；不兼容则 UI 只读提示升级/重启 Runtime
  6) 背压：事件订阅按 cursor；大 payload 走 artifact 引用而非管道塞文件
```

推荐理由：对齐产品架构；避免 localhost 误暴露；版本协商可测。  
风险：自研协议成本；Phase 0 必须做崩溃重连与半包测试。  
需要用户确认：是否接受 named pipe + 双层桥（IPC + pipe）？

---

### TD-007: Windows UI Automation 库与回退

日期：2026-07-11  
状态：已采用
用户确认：2026-07-11「全部接受推荐，计划确认」

技术需求：

```text
授权桌面自动化；可观察、可取消、可失败隔离；不应阻塞主 Runtime。
```

| 方案 | 优点 | 缺点 |
| --- | --- | --- |
| A. 自研 Worker + koffi/edge 调 UIAutomation COM | 能力完整、可控 | 实现成本高 |
| B. nut.js / robotjs 类库 | 上手快 | 偏坐标/键鼠，UIA 语义弱，脆 |
| C. 首版仅 Playwright + 人工桌面步骤 | 风险低 | 桌面控制弱，影响闭测完整故事 |

推荐方案：

```text
分阶段：
  Phase 0/2：定义 DesktopWorker 接口 + 假实现 + 人工回退 UX
  Phase 3：Worker 进程内用 koffi 调用 UI Automation；
           优先 name/automationId 定位；失败则截图+可观察错误+请求用户接管
  不把 robotjs 作为主路径
```

推荐理由：产品要的是可审计桌面控制，不是游戏级点选；接口先稳定可防返工。  
需要用户确认：是否接受“接口先落地，UIA 实装放 Phase 3，主路径 koffi+UIA”？

---

### TD-008: SKILL.md 兼容子集

日期：2026-07-11  
状态：已采用
用户确认：2026-07-11「全部接受推荐，计划确认」

技术需求：

```text
兼容现有 SKILL.md 目录结构；导入规范化 Manifest；脚本不静默执行。
```

推荐兼容子集（v1）：

```text
必须：
  - 目录内 SKILL.md（YAML frontmatter + Markdown body）
  - frontmatter: name, description, version?(semver/string)
  - 可选：license, metadata, compatibility, allowed-tools 类字段（能识别则映射，不能则报告）
  - 资源文件：references/, scripts/, assets/ 原样收录但默认不可执行

导入行为：
  1. 计算内容 hash / 完整性
  2. 生成 SkillVersion Manifest（内部模型）
  3. 声明的 tools/MCP/permissions 进入待批准 diff
  4. scripts 仅当声明 execution + 用户批准 + 依赖检查后才可被 Worker 调用
  5. 无法识别字段：warnings[]，不猜测执行

conformance fixtures：
  - minimal-skill
  - skill-with-scripts-denied-by-default
  - skill-permission-diff-on-upgrade
  - broken-frontmatter
  - path-traversal-attempt
```

备选：只支持内部 JSON Manifest — 否决，失去生态兼容。  
需要用户确认：是否接受上述 SKILL.md v1 子集与“脚本默认不执行”？

---

### TD-009: CC Switch 配置导入

日期：2026-07-11  
状态：已采用
用户确认：2026-07-11「全部接受推荐，计划确认」

技术需求：

```text
用户明确批准的导入；预览后保存；不依赖 CC Switch 常驻；不猜模糊字段；密钥进入 secure store。
```

推荐策略：

```text
1. 只读取“稳定/文档化/可观察”的本地配置面（版本化 adapter）：
   - 常见路径与导出文件格式在 Phase 0 用夹具锁定
   - 每个 CC Switch 版本一个 importer adapter；未知版本 → 安全失败 + 手动 Provider 引导
2. 映射到内部模型：Provider / CredentialGroup / Model / protocol hints
3. UI 三步：选择来源 → 预览 diff（可取消单项）→ 确认写入
4. 密钥：预览可显示掩码；确认后写入 safeStorage；日志无密钥
5. 不支持字段进 report，不默认填充危险值
6. 导入后不要求 CC Switch 继续运行
```

备选：运行时反向依赖 CC Switch — 否决。  
需要用户确认：是否接受“版本化 importer + 预览确认 + 安全失败”？

---

### TD-010: Provider 兼容夹具矩阵

日期：2026-07-11  
状态：已采用
用户确认：2026-07-11「全部接受推荐，计划确认」

推荐矩阵（合同测试，不用真实密钥也可跑 mock）：

| 协议面 | 必测场景 |
| --- | --- |
| OpenAI Responses | 流式文本、工具调用、错误码、超时 |
| OpenAI Chat Completions | 流式 SSE、多轮 messages、stop、rate limit |
| OpenAI Images | 创建、参数回显、失败 |
| Anthropic Messages | 流式、tools、system、max_tokens 边界 |
| Gateway quirks | 非标准 base path、额外 header、模型列表缺失、伪 OpenAI 字段 |

架构：

```text
packages/adapters/*
  - 统一内部事件：text-delta, tool-call, tool-result, usage, error, image-ready
  - Fixture replay + 可选 live probe（用户显式开启）
  - 能力探测结果仅建议，用户确认后入库
```

需要用户确认：是否接受“先夹具合同测试，再 live probe”的适配策略？

---

### TD-011: XState 持久边界与 DAG 调度恢复

日期：2026-07-11  
状态：已采用
用户确认：2026-07-11「全部接受推荐，计划确认」

| 方案 | 优点 | 缺点 |
| --- | --- | --- |
| A. XState v5 表状态 + SQLite 事件/检查点为真源 | 可视化状态清晰；恢复可测 | 需自研 persist 层 |
| B. 纯手写状态机 | 无依赖 | 复杂 DAG/重试易腐 |
| C. 外部工作流引擎 | 能力强 | 过重、偏离 local 模块化单体 |

推荐方案：

```text
A.
  - Run/Step 生命周期用 XState 描述（内存执行）
  - 真源是 append-only Event + Checkpoint 表
  - 重启：replay 到最近 checkpoint + 续放事件；外部副作用靠 idempotency key
  - DAG：Step 依赖边存 DB；调度器选 ready steps；并行用隔离 artifact snapshot
  - XState 快照可缓存，但不是唯一真源
```

需要用户确认：是否接受“XState 表达 + 事件真源”而不是把 XState 快照当唯一 DB？

---

### TD-012: React 原语、图标、token 架构

日期：2026-07-11  
状态：已采用
用户确认：2026-07-11「全部接受推荐，计划确认」  
服从：TD-003 可获奖级原创

| 方案 | 优点 | 缺点 |
| --- | --- | --- |
| A. 自研设计系统 + Radix 无样式原语 + Lucide + CSS variables from tokens.json | 完全品牌可控 | 组件工作量大 |
| B. MUI / Ant Design 全套 | 快 | 同质化，难达可获奖级 |
| C. shadcn 直接默认风格 | 较快 | 仍像模板，需大量重写 |

推荐方案：

```text
A. Continuum UI Kit
  - tokens: docs/product/15-frontend-design-tokens.json → 生成 CSS variables
  - 行为原语：Radix（Dialog/Popover/Tabs/Focus）可选引入
  - 外观：100% 自研（Button/Message/Trace/ContinuumRail/...）
  - 图标：Lucide（可替换子集）
  - 禁止：Ant/MUI 默认主题；大圆角营销卡
  - 状态：TanStack Query 仅当需要服务端/Runtime 查询缓存；聊天流用自研 store
  - 路由：主工作台状态以任务为中心；设置类可用轻量路由
```

需要用户确认：是否接受“Radix 行为 + 自研皮肤 + Lucide”，拒绝厚主题组件库？

---

### TD-013: 签名、更新器、崩溃报告、内测分发

日期：2026-07-11  
状态：已采用
用户确认：2026-07-11「全部接受推荐，计划确认」

| 方案 | 优点 | 缺点 |
| --- | --- | --- |
| A. electron-builder NSIS + 代码签名 + electron-updater 私有静态 feed | 成熟、闭测够用 | 签名证书成本/流程 |
| B. Squirrel.Windows | 旧路径 | 生态转向 builder |
| C. 仅手动 zip | 零基建 | 升级体验差、难签名 |

推荐方案：

```text
A. Phase 3：
  - electron-builder 打 NSIS
  - Authenticode 签名（证书由你准备）
  - electron-updater + 私有 HTTPS feed / GitHub private releases
  - 崩溃报告：本地优先 + 可选上传；默认剥离路径/密钥/消息正文
  - 诊断包：用户显式导出，强制 secret scrub
  - 内测：邀请链接/安装包直发，5-20 人
```

需要用户确认：是否接受 electron-builder + 私有更新源？证书与账号后续再配置。

---

### TD-014: 测试框架（附带 spike，支撑 TDD）

日期：2026-07-11  
状态：已采用
用户确认：2026-07-11「全部接受推荐，计划确认」

推荐：

```text
Vitest：unit/contract/integration
测试目录与 packages 共置
Phase 3 再引入端到端（Playwright 测 UI 或 Spectron 替代方案评估）
关键强制：状态机、权限、上下文编译、适配器夹具、路径/注入安全
```

---

### TD-015: Runtime Command Gateway 为核心，CLI 与 MCP 为适配器

日期：2026-07-18

状态：已采用
用户确认：2026-07-18「按推荐来；同时开放给 SYNC-THINK、Codex 和 Claude Code」

背景：Agent 需要感知并操作 SYNC-THINK，外部 Codex / Claude Code 也需要调用同一组应用能力。

对比：

```text
A. CLI 作为核心
   优点：命令行调试直接。
   缺点：UI、Agent 与 CLI 容易形成重复权限、状态和事务逻辑。

B. Runtime Command Gateway 作为核心，Desktop / CLI / MCP 为薄适配器（采用）
   优点：复用现有命名管道、校验、授权、事件真源和 SQLite 事务；结果一致且可审计。
   缺点：需要维护适配器的 schema 映射和外部会话认证。

C. 新增 localhost HTTP/gRPC 核心
   优点：通用调试工具多。
   缺点：扩大网络攻击面，并与已锁定的认证命名管道边界重复。
```

决定：

- Runtime 协议命令是唯一应用写入入口。
- Desktop 继续经 Electron main bridge 调用 Runtime。
- `sync-think` CLI 只负责参数/输出适配和认证会话发现。
- 内置 MCP Server 将 Runtime 命令暴露为结构化工具，供内部 Agent 与外部 Codex / Claude Code 使用。
- 配置类命令采用 preview -> confirm；普通已授权任务操作可直接执行。
- 所有入口共享 Runtime 侧授权、作用域校验、幂等、事件记录与敏感信息清理。
- 不建立第二套 localhost 服务或 CLI 专属数据库访问路径。

确认令牌实现约束：

- 外部 `agent` / `mcp` / `cli` 配置调用首次只返回预览；Desktop 明确按钮交互直接执行。
- 令牌默认有效 5 分钟、只能使用一次，并同时绑定命令、caller surface 和规范化 payload SHA-256 digest。
- 预览只列出 payload 字段名，不返回字段值；Runtime 只持有令牌 hash 作为审计证据。
- Runtime 记录 `application.command_confirmation_requested`、`confirmed`、`rejected` 事件。
- CLI、MCP 与内置对话 Agent 的 application-tool 多轮循环均已接通；工具结果回到下一 Provider turn，配置操作在 Desktop 显示确认卡。

---

### TD-016: Automation 使用 Runtime 内调度 + loopback HMAC Webhook

日期：2026-07-18

状态：已采用
用户确认：2026-07-18 批准自动化按推荐方案实施

背景：周期任务和外部触发必须复用现有项目、Agent/群聊、权限、任务上下文与事件真源，且每次触发都应成为独立任务。

决定：

- AutomationDefinition 与 Execution 持久化到 SQLite migration `0026_automation`。
- Runtime 内服务负责五字段 Cron、IANA 时区、并发策略、0-2 次重试和恢复扫描；不在 Renderer 运行计时器。
- 每次 schedule、webhook 或 manual trigger 都先创建新任务，再通过既有 Agent/群聊执行路径启动；不复用其他任务消息。
- Webhook 默认只监听 `127.0.0.1:47821`，路径不可预测，请求体用 Secure Store 中的密钥做 HMAC-SHA256 验签，并用常量时间比较。
- Webhook 密钥只在创建或轮换时返回一次；数据库只保存 secret handle，Renderer 事件和日志不携带密钥。
- 端口占用不使整个 Runtime 崩溃；健康状态区分 scheduler 可用与 Webhook 可用，Desktop 如实禁用相关操作。
- Runtime 关闭会停止 HTTP server、调度轮询并等待执行清理，避免重启时端口和子进程泄漏。

---

## 4. 确认清单（已全部勾选）

- [x] TD-004 better-sqlite3 + Drizzle
- [x] TD-005 safeStorage + CredentialRef
- [x] TD-006 named pipe + IPC 双层桥
- [x] TD-007 DesktopWorker 接口先；koffi+UIA 后
- [x] TD-008 SKILL.md v1 子集，脚本默认不执行
- [x] TD-009 CC Switch 版本化 importer + 预览
- [x] TD-010 Provider 夹具矩阵
- [x] TD-011 XState 表达 + 事件真源
- [x] TD-012 Radix 行为 + 自研皮肤 + Lucide
- [x] TD-013 electron-builder + 私有更新
- [x] TD-014 Vitest
- [x] TD-015 Runtime Command Gateway + CLI/MCP 适配器
- [x] TD-016 Runtime Automation + loopback HMAC Webhook

确认语：全部接受推荐，计划确认（2026-07-11）

---

## 5. 决策记录模板

### TD-XXX: 决策标题

日期：  
状态：提议中/推荐中/已采用/已废弃  
用户确认：  

背景 / 选择 / 备选 / 影响 / 性能 / 风险与回退
