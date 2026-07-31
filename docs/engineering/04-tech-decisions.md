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

### TD-015: NewMax P0 工作区、文件编辑与流式持久边界

日期：2026-07-28
状态：已采用
用户确认：2026-07-28「可以，开始吧」

背景：现有双聊天分屏、ChatView 内只读文件预览和逐 frame Renderer 更新无法组成可恢复工作台；同时不能牺牲 Sync-Think 已有的路径约束、transient replay 和 SQLite Message Store 边界。

采用方案：

```text
Workspace UI：
  - 版本化递归二叉 Pane 树（horizontal / vertical），Pane 内统一 conversation/file tabs
  - localStorage 按 Workspace 保存布局快照，并从旧 openTabs/selected 偏好迁移
  - ratio clamp 20%–80%；每 Pane 最多 100 Tabs；任意深度最多挂载 2 个 ChatView

Streaming：
  - transient text/reasoning frame 在 Renderer 以 requestAnimationFrame 合批
  - delta 不写 durable event；成功只写最终 assistant message
  - failed/cancelled 在终态前写入已生成的部分 assistant 正文

File editing：
  - Main 进程重新验证 root 内路径与 realpath；拒绝绝对路径、穿越和链接越界
  - read 返回 mtimeMs + size；write 使用 expected metadata、显式 force 与同目录原子替换
  - 父目录 fs.watch + 100ms 合并 + 5 秒轮询兜底；订阅随 Renderer 生命周期释放
  - P0 使用 textarea；草稿只保留 Renderer 内存 Session，布局快照仅保存相对路径
```

理由与影响：

- 递归 Pane 满足工作区扩展性，但 `ChatView` 挂载上限保留当前 transient subscription 的性能约束；文件 Pane 不占聊天订阅配额。
- localStorage 是当前最小变更，因为 Workspace 协议与存储层尚未暴露完整 UI preferences；快照版本化和旧键双写保留回滚路径。
- mtime 与 size 是轻量乐观并发，不依赖新增编辑器或文件数据库；冲突必须由用户显式选择，避免静默覆盖。
- 未保存正文不进入 durable SQLite 或布局偏好，避免恢复出一份脱离磁盘真值的隐藏副本；代价是应用进程退出后草稿不恢复，此边界需要持续在 UI 与文档中保持明确。
- 后续若引入 Monaco/CodeMirror、持久草稿或递归 Workspace watcher，必须重新走依赖、性能与数据真源技术门禁。

---

### TD-016: Workspace 内容搜索与受控终端 Pane

日期：2026-07-28
状态：已采用
用户确认：2026-07-28「按照你说的来」

技术需求：项目磁盘正文搜索；Pane 内 ANSI 终端输出、停止和恢复；复用既有路径边界与 `TerminalProcessWorker`；重型前端能力不进入首屏主包。

内容搜索方案：

| 方案 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- |
| `rg --json` + 有界 Node fallback | 大仓库快；结果结构化；未安装 `rg` 仍可用 | 需要维护双引擎一致性 | 采用 |
| 纯 Node 递归扫描 | 零外部命令 | 大仓库 CPU/IO 更高 | 仅作 fallback |
| 把工作区正文镜像到 SQLite FTS | 查询快、可排序 | 复制磁盘真值；watch/index/migration 成本高 | 本切片不采用 |

终端方案：

| 方案 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- |
| `@xterm/xterm` + 既有受控 Worker | ANSI/滚动/键盘体验成熟；复用 `shell:false`、超时、取消和输出上限 | 不是持久 PTY；需独立 vendor bundle | 采用 |
| React `<pre>` 日志面板 | 依赖最小 | ANSI、选择、终端滚动和可访问性体验弱 | 不采用 |
| `node-pty` + `@xterm/xterm` | 完整 PowerShell/cmd 交互 | 新增原生模块、打包/签名/进程恢复与权限面显著扩大 | 后续独立 spike |

采用边界：

```text
Search:
  - rg literal smart-case 主路径；5 秒、200 条、2 MiB/文件上限
  - shell:false；查询使用独立 argv；symlink/vendor/binary 跳过
  - fallback 不持久化索引或正文

Terminal:
  - xterm vendor 单独构建，用户打开终端时才加载 JS
  - Main 负责 session/command 唯一性、Renderer 销毁清理和 IPC 事件
  - TerminalProcessWorker 流式产生 stdout/stderr，命令仍为 executable + argv
  - 布局只持久化 terminalId/cwd；输出和运行状态只在 Renderer Session
```

性能：搜索结果和终端输出均限幅；终端 JS 不进入首屏 shell bundle。
安全：不通过 shell 拼接查询或命令；cwd 与真实路径必须位于 Workspace root；每次人工命令只给 Worker 精确 executable allowlist。
维护与回滚：移除 terminal tab 类型、vendor 构建与新 IPC 即可回退；文件/对话 Pane 快照保持兼容。
后续门禁：引入 `node-pty`、持久 shell、终端恢复或工作区 FTS 索引时重新走技术选择。

---

### TD-017: Agent Skill 默认继承、临时覆盖与懒上下文装载

日期：2026-07-29
状态：已采用
用户确认：2026-07-29「继续后续任务开发」；后续确认「小队里面智能体自动化工作不应再逐个配置」

技术需求：Agent Library 是 Skill 的一次性配置真源。Agent/Team 对话默认启用有效所有者已装备的 Skill，Composer 只承担临时取消/调整；自动化 Run 中每个 Step 自动读取自身精确 AgentVersion 的 Skill。正文仍按需加载，fallback、rebind 和恢复不得因后续编辑而漂移。

方案对比：

| 方案 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- |
| Agent 配置默认生成精确选择；Composer 临时覆盖；Runtime 校验并冻结；目录 metadata 懒加载 | 配置一次即可复用；仍可见、可取消；恢复可复现；不新增依赖 | 需要区分“持久配置默认值”和“当前会话临时覆盖” | 采用 |
| 每轮默认空选，由用户重新勾选 | 单轮上下文最小 | 重复配置，Team 自动执行语义断裂，容易出现界面选了但自动 Step 没带 Skill | 废弃 |
| 自动推荐 + 项目/任务临时附件 | 能覆盖更多场景 | 推荐可信度、作用域、权限和持久化边界显著扩大 | 后续独立设计 |

采用合同：

```text
AppendMessagePayload.skillVersionIds:
  undefined -> 旧客户端继承有效 Agent allowlist
  []        -> 本轮明确不加载 Skill
  [ids]     -> trim、按首次出现去重、最多 8 个精确不可变版本

Runtime:
  effective Agent owner -> allowlist 子集/存在/未归档/审批校验
  -> 按精确 ID 加载正文 -> Context selection
  -> Provider prompt + Manifest + frozen Run snapshot
  -> fallback/rebind/retry/recovery 继续使用冻结 ID

Durable state:
  event/checkpoint 保存 ID + fingerprint，不复制 SKILL.md 正文
  restart 从不可变 Skill store 重新加载并校验 fingerprint

Desktop default:
  Agent -> 自身已配置 SkillVersion IDs
  Team  -> coordinator；缺失时首成员的 SkillVersion IDs
  model -> []
  send success/failure -> 保持当前选择
  switch Agent/Team -> 新 owner 默认值

Automated Step:
  frozen step.agentVersionId -> 该 AgentVersion.skillVersionIds
  -> Provider 调用前校验与有界正文解析
  -> 只注入该成员自己的 system prompt
  -> Artifact metadata 记录实际 skillVersionIds
```

性能：`skill.list` 使用 metadata-only SQL；Composer 只有打开菜单才请求目录；Renderer 从不为选择菜单调用 `skill.get`。完整正文只为本轮最终选择加载，未选中或被 Context 排除的 Skill 不进入 Provider。

安全与一致性：Renderer 只能缩小 allowlist，Runtime 是最终权限边界；选择不执行脚本、不增加工具或 MCP 权限。Context Packet 的 `skill-definition`、Provider prompt、Manifest ID 与 Run 快照必须来自同一次选择结果，不允许第二条旁路注入。

交互与回滚：Agent/Team 初始选择来自有效 owner 配置，成功与失败都保持；切换 Agent/Team 时使用新 owner 默认值，模型直聊显式发送 `[]`。仅切换模型 override 不改变 Agent Skill。欢迎页首条消息把临时覆盖交给新建对话。回滚可恢复默认空选，但旧 `undefined` 兼容路径继续可用。

自动化边界：Team Composer 的 coordinator 规则只决定用户当前与谁对话时的默认显示；DAG Step 始终以自身已冻结的 `agentVersionId` 为权威。Skill 正文不会执行脚本，也不会增加 Worker、Tool 或 MCP 授权；任一配置版本缺失、归档或审批失效时在 Provider 调用前失败。

---

### TD-018: 外部系统浏览器 + 持久 Profile + Playwright CDP Browser Worker

日期：2026-07-30
状态：已采用
用户确认：2026-07-30「可以」；此前已明确选择方案 B

技术需求：把现有 Renderer `<webview>` 从自动化执行链路中移除，改由长驻 Runtime 管理可见的系统 Edge/Chrome。浏览器登录态需要按 Profile 持久保存；不同对话/Step 使用独立 Tab；同一 Tab 的动作不能互相穿插；遇到登录、验证码、支付或其他人工卡点时，Run 必须能够持久暂停并由用户继续。

方案对比：

| 方案 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- |
| Renderer `<webview>` 执行 JavaScript | 已有原型，接线短 | 依赖 UI 存活和一个全局活动页；登录态、Tab 所有权、恢复与最小权限边界薄弱 | 从真实执行路径移除，只保留预览壳 |
| 系统 Edge/Chrome + 独立 Profile + `playwright-core` 通过 CDP 接管 | 浏览器真实可见；复用用户熟悉的系统浏览器；不下载浏览器内核；Profile、Tab、人工接管边界清楚 | 需管理外部进程、CDP 端口和浏览器版本兼容 | 采用 |
| Playwright 自带 Chromium + `launchPersistentContext` | Playwright 版本匹配最稳定 | 安装体积明显增加；与“使用系统浏览器”目标不符 | 不采用 |

采用合同：

```text
Agent / Team Step
  -> Runtime（先持久化意图、校验站点与动作权限）
  -> shared BrowserHost
  -> BrowserWorker restricted API
  -> playwright-core / CDP
  -> visible Edge or Chrome + dedicated Profile directory

Process:
  one active browser process per profileId
  profile root defaults to dirname(sync-think.db)/browser-profiles
  executable discovery prefers explicit override, then Edge, then Chrome
  CDP binds to 127.0.0.1 on a dynamically reserved port

Tabs:
  lease owner = conversation/run/step identity
  one owner lease maps to one Page
  commands on one lease are serialized
  different leases may execute concurrently
  release/close and browser shutdown are explicit lifecycle operations

Actions:
  navigate / click / fill / read / wait / screenshot
  selectors and returned text are bounded
  screenshots live under <project>/.sync-think/screenshots
  Renderer <webview> may mirror the final URL but never executes the command
```

分片边界：P0.1 只交付 Browser Host、系统浏览器发现/启动、CDP、Profile、Tab lease 和受限动作；P0.2 把聊天 `browser_*` 真正接到 Worker；P0.3 增加命令/授权持久化与重启恢复；P0.4 接 Team Step；P0.5 增加持久 `waiting_user` 与继续/取消交互。只有 P0.1-P0.5 全部完成后，路线图中的“Browser Worker 与网页授权执行”才可勾选完成。

性能：一个 Profile 复用一个浏览器进程；同 Tab 串行避免状态竞争，不同 Tab 保留并行度；使用 `playwright-core`，不下载或打包 Playwright 浏览器二进制。读取正文和截图结果必须限幅。

安全与恢复：CDP 仅监听 loopback；Profile ID 和截图路径不能越过受控根目录；站点允许列表以 URL origin 为边界并在 Runtime 再校验；新域、敏感动作与人类专属动作不能由网页内容自行授权。Runtime/Worker 重启后的幂等、授权恢复与人工卡点由 P0.3/P0.5 完成前，不声称闭环已交付。

维护与回滚：移除 Browser Host 和 `playwright-core` 即可回到现有 `<webview>` 原型；Profile 目录是独立数据，不与默认浏览器 Profile 混用。旧 `conversation.submitBrowserResult` 协议在 P0.2 迁移期间保留兼容，确认没有调用方后再单独删除。

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
- [x] TD-015 递归 Pane + transient 合批 + 受约束文件编辑
- [x] TD-016 `rg` + fallback 内容搜索、lazy xterm + 受控 Worker 终端
- [x] TD-017 Agent 默认继承 + 每轮精确覆盖 + 自动 Step 成员隔离 + metadata 懒加载
- [x] TD-018 系统 Edge/Chrome + 持久 Profile + Playwright CDP Browser Worker

确认语：全部接受推荐，计划确认（2026-07-11）

---

## 5. 决策记录模板

### TD-XXX: 决策标题

日期：  
状态：提议中/推荐中/已采用/已废弃  
用户确认：  

背景 / 选择 / 备选 / 影响 / 性能 / 风险与回退
