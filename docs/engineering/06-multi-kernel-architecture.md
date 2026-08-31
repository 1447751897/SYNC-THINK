# 06 — 多内核架构设计（KernelAdapter 适配规范）

> **文档定位**：本文件是「SYNC-THINK 多内核改造」的完整设计基线，交付给负责实现适配的开发者/模型使用。文档自包含——所有关键事实（代码实证、NewMax 本机日志实证、官方文档调研）均写入正文，不需要额外的对话上下文即可开工。
>
> **状态**：阶段性实现已推入 `feature/multi-kernel`；Native / Claude Code / Codex 主链、内核选择 UI、MCP broker 与平台文件工具已落地，但平台业务工具分派、审批取消/幂等、事件映射和真实 Electron 验收矩阵尚未收口，当前不能声明完整交付。
> **相关文档**：`02-development-principles.md`（开发原则）、`04-tech-decisions.md`（技术决策总集）、`05-tech-decisions-mcp-global.md`（MCP 全局化）。

---

## 1. 背景与目标

### 1.1 现状

SYNC-THINK 是自研 runtime 直连模型 API 的对话产品。runtime 拥有原生双协议 adapter（`openai-chat` 直连 Chat Completions、`anthropic-messages` 直连 Messages），并实现了完整的平台能力：

| 现有资产（改造中复用）               | 位置/机制                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| 模型层重试 + 备用模型链 + 供应商熔断 | `shouldRetrySameModel` / `tryContinueWithFallback` / `providerFailureCounts`（runtime.ts） |
| 失败分类体系（八类）                 | `FailureClass`（transient/auth/protocol/permission/acceptance/rate-limit/timeout/unknown） |
| 审批卡机制                           | `tool.approval_requested` 事件 + `approval.decide` 命令                                    |
| 对话权限三档位                       | full-access / ask / workspace                                                              |
| 凭据组                               | `CredentialGroupRecord` + per-model `credentialRefId`                                      |
| 用量计费                             | `provider.usage` 事件 → `pricing.ts` 四档计费                                              |
| 任务清单三表                         | `task_plan` / `task_plan_dependency` / `task_plan_execution`                               |
| 事件流持久化                         | 流式即写库，重启可恢复                                                                     |
| 平台工具组                           | create_agent / browser_* / desktop_* / Skill / MCP / 小队管理                              |
| 输入框任务胶囊                       | RunTaskCapsule（从工具结果提取 plan 快照）                                                 |
| 插话队列                             | ComposeRequestQueue（排队、可编辑/删除/插话/重试、持久化）                                 |

### 1.2 目标

把 SYNC-THINK 改造成**宿主 harness + 多内核插件架构**：

1. 用户可以在模型选择器中**选择内核**（带内核图标）：原生内核 / Claude Code 内核 / Codex 内核 / Pi 内核
2. 新增内核可通过适配器注册表接入
3. 内核**自治**：压缩、模型重试、工具循环、会话管理由内核自己负责，宿主零干预
4. 宿主保留三件横向职责：**窗口容量配置、备用模型链、用量统计**

### 1.3 核心概念澄清

| 概念               | 定义                                                                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **模型**           | 发动机——只提供有限上下文窗口的 API，不做窗口管理                                                                                                                  |
| **Agent**          | 驾驶行为——"模型 + 系统提示 + 工具循环"的行为主体                                                                                                                  |
| **内核（kernel）** | 整辆车——承载 agent 循环的可执行 harness：协议适配、工具执行、上下文管理、权限、I/O 的完整外壳。`claude.exe` / `codex` / `pi` / SYNC-THINK 自己的 runtime 都是内核 |
| **宿主（host）**   | SYNC-THINK 应用本身：UI、事件持久化、平台工具、审批卡、小队管理                                                                                                   |

**"多内核"的正确定义**：让 SYNC-THINK 成为宿主 harness，spawn 并驱动多个外部 harness 子进程，把它们的输出归一化成统一事件流。

---

## 2. 核心原则：内核自治，宿主只做四件事

### 2.1 宿主不管的事（内核自治域）

| 领域                                     | 归属 | 宿主行为                                                                                |
| ---------------------------------------- | ---- | --------------------------------------------------------------------------------------- |
| **上下文压缩**（何时触发/怎么摘要/阈值） | 内核 | **完全不管**。内核自己的压缩逻辑跑，宿主不干预、**不二次压缩**（双重压缩=信息损失翻倍） |
| 模型调用重试                             | 内核 | 内核内部失败让内核自己处理                                                              |
| 工具执行循环                             | 内核 | 内核自己的工具循环                                                                      |
| 内核会话管理                             | 内核 | 内核自己的 session/resume 机制                                                          |

### 2.2 宿主必须做的事

1. **拉进程**：spawn 内核子进程、注入配置、Job Object 生命周期绑定
2. **翻译事件**：内核输出事件 → 统一 KernelEvent 流
3. **存历史**：事件流持久化（宿主的库是唯一真相源）
4. **注入平台工具**：把 SYNC-THINK 的平台工具按各内核机制注册进去

### 2.3 宿主的三件横向职责（与"不管压缩"零冲突）

| 职责                 | 说明                                                                                                                      | 实证依据                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **① 上下文容量配置** | 模型记录存 `contextWindow` → spawn 内核时注入 → 统计时除以它算百分比。压缩**时机**由内核决定，容量**值**由宿主配置        | NewMax 日志 `window=1000000 pct=20%`                                      |
| **② 备用模型链**     | 内核失败 → 宿主查链 → 切换"内核+模型"二元组继续。**内核之间互不知道对方存在**，这层天然属于宿主                           | NewMax 日志 `fallback: { providerId, model: 'grok-4.5' }`（宿主层切换）   |
| **③ 用量统计**       | 读内核报告的 usage 事件 → 持久化 → UI 展示。**"不干预压缩" ≠ "不读用量报告"**：报告是内核对外输出，读它是适配协议的一部分 | NewMax 日志 `[ClaudeProxy][RealUsage] real=209623 window=1000000 pct=21%` |

### 2.4 双真源边界：原生会话负责推理上下文，宿主持久化负责展示与审计

1. Codex rollout/thread 与 Claude session 是各自模型上下文、压缩结果和缓存前缀的事实源。正常续轮必须优先调用原生 `resume`，宿主消息数量、UI block 数量、Renderer 截断或模型/Provider 切换不得触发原生会话重建。
2. SQLite message/event/timeline 是跨设备恢复 UI、审计、检索和跨内核移交的事实源，但不是外部内核原生上下文的替代品。reasoning、commentary、工具调用/结果和 durable 截断状态只属于展示/审计投影，不得作为历史 transcript 回灌外部内核。
3. 外部内核首次进入一个已有对话，或从另一个内核接回后续轮次时，只追加有界便携上下文：最近 20 条用户/最终助手消息，单条最多 8 KiB、总计最多 64 KiB。被省略内容必须显式标记，但不因此销毁原生 session。
4. 模型、Provider、凭据、权限、规划模式、Agent 或 Skill 变化属于当前 turn 的路由/宿主上下文更新：继续恢复同一原生 session，并追加新规则。Provider response-id continuation 另按路由隔离，不能借此清理 native thread。
5. 只有原生 CLI 明确报告 session/thread 不存在、不可恢复，或同一对话绑定到不同 Workspace 根目录时，Runtime 才清理映射并创建新会话。CLI 自己的 compaction/rollover 通知只做投影，不由宿主用消息历史模拟。

---

## 3. 架构总览

```mermaid
flowchart TB
    subgraph HOST["宿主层（SYNC-THINK，唯一真相源）"]
        UI["UI：对话渲染 / 内核选择器 / 审批卡 / 任务胶囊 / 插话队列"]
        PERS["事件流持久化（流式即写库）"]
        PLAT["平台工具：智能体 / Skill / MCP / 小队 / browser_* / desktop_*"]
        FACTS["共享事实层：工作区级 + 小队级"]
        APPROVAL["审批卡（三档位：完全控制 / 为我批准 / 询问批准）"]
        FALLBACK["备用模型链（内核+模型二元组）+ 熔断"]
        USAGE["用量统计 / 窗口容量配置"]
        KAI{"KernelAdapter 统一接口"}
    end

    subgraph KERNELS["内核层（自治，宿主零干预）"]
        NATIVE["原生内核（现有 runtime）<br/>双协议 adapter / failureClass / 70% 压缩"]
        CC["Claude Code 内核<br/>claude.exe 子进程 / Messages 协议"]
        CODEX["Codex 内核<br/>codex 进程 / OpenAI 协议"]
        PI["Pi 内核<br/>pi 进程 / 多供应商 / 无权限体系"]
        FUTURE["未来新内核（插件注册表）"]
    end

    UI --> KAI
    KAI --> NATIVE
    KAI --> CC
    KAI --> CODEX
    KAI --> PI
    KAI --> FUTURE
    PLAT -.平台工具注入.-> CC
    PLAT -.平台工具注入.-> CODEX
    PLAT -.平台工具注入.-> PI
    APPROVAL -.权限请求桥接.-> CC
    APPROVAL -.权限请求桥接.-> CODEX
    PERS -.唯一真相源.-> FACTS
```

### 3.1 数据流（一次内核请求的生命周期）

```
用户发消息（内核选择 = claude-code，模型 = claude-sonnet-4-5）
  → 宿主组装 KernelRequest { model, contextWindow, 凭据, 共享事实, 小队上下文 }
  → spawn claude.exe（stream-json 双向流 + permission-prompt-tool stdio）
  → 内核自治执行（压缩/重试/工具循环都是内核内部的事）
  → 内核事件流 → 适配器归一化 → 宿主渲染 + 流式写库
  → 内核权限请求 → 桥接 → 宿主审批卡 → 批准/拒绝回给内核
  → 内核报告 usage → 宿主持久化 + 用量统计
  → 内核崩溃/失败 → 宿主查备用链 → 切内核+模型继续 或 暂停等用户
  → 宿主退出 → Job Object 带走内核进程
```

---

## 4. KernelAdapter 接口规范（契约）

> **接口定义时就把以下槽位写进去**——它们不是后补项，而是契约的一部分。

```ts
// ─── 内核适配器统一接口 ───────────────────────────────────────
interface KernelAdapter {
  // 身份
  id: 'native' | 'claude-code' | 'codex' | 'pi' | string;
  name: string; // 显示名
  icon: string; // 内核图标（选择器 UI 用）

  // 能力声明（驱动 UI 降级与权限策略）
  capabilities: {
    protocols: Array<'anthropic-messages' | 'openai-chat' | 'openai-responses'>;
    permission: 'own' | 'none'; // 内核有无自身权限体系
    permissionBridge: boolean; // 是否支持权限请求桥接到宿主（permission-prompt-tool 类机制）
    pause: 'executor' | 'turn' | 'session' | 'kill';
    // executor = 执行器级暂停/恢复（native）
    // turn     = 只能停当前 turn（Claude Code，Esc 语义）
    // session  = 暂停即关会话（Codex，Ctrl+C 语义）
    // kill     = 杀进程树，无恢复（Pi）
    compress: 'own' | 'none'; // 内核是否自带压缩（全部外部内核为 'own'）
    usageReport: boolean; // 内核是否报告 usage 事件
  };

  // 版本（跟随更新策略，见 §9）
  knownGoodVersions: string[]; // 测试通过的版本号
  detectVersion(): Promise<string | null>; // 本地探测：PATH / 注册表 / --version

  // 生命周期
  start(req: KernelRequest): AsyncIterable<KernelEvent>; // spawn + 注入配置，返回事件流
  stop(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  cancel(): Promise<void>;
  onExit(cb: (code: number | null, stderrTail: string) => void): void;

  // 权限桥接（仅 permissionBridge = true 的内核实现）
  onPermissionRequest(cb: (req: KernelPermissionRequest) => void): void;
  respondPermission(
    reqId: string,
    decision: { allow: boolean; updatedInput?: unknown; message?: string },
  ): void;

  // 用量报告（仅 usageReport = true 的内核实现）
  onUsage(cb: (u: KernelUsage) => void): void;
}

interface KernelRequest {
  model: string; // 内核模型标识（透传）
  contextWindow: number; // 当前 Provider 模型配置的窗口容量
  credential: KernelCredential; // 凭据（见 §8）
  systemContext: string; // 共享事实 + 小队上下文（见 §10）
  platformTools: PlatformToolDefinition[]; // 平台工具注入（见 §7.3）
  permissionMode: 'full-access' | 'ask' | 'workspace'; // 三档位映射（见 §7.1）
  workspaceDir: string;
}

interface KernelUsage {
  real: number; // 内核报告的真实 token
  window: number; // 回显的窗口容量
  // 可选：input/output/cached 分项（各内核粒度不同，见 §12.2 对齐规则）
}

interface KernelPermissionRequest {
  requestId: string;
  toolName: string;
  toolInput: unknown;
  reason?: string;
}
```

### 4.1 统一事件流（KernelEvent 归一化目标）

各内核事件全部映射为以下统一类型（渲染层/持久化层只认这个）：

```ts
type KernelEvent =
  | { type: 'delta'; text: string } // 回复增量
  | { type: 'reasoning'; text: string } // 思考过程增量
  | { type: 'tool-call'; toolId: string; name: string; argsJson: string; partial: boolean }
  | { type: 'tool-result'; toolId: string; output: string; isError: boolean }
  | { type: 'permission-request'; requestId: string; toolName: string; toolInput: unknown }
  | { type: 'usage'; usage: KernelUsage }
  | { type: 'compaction-started' }
  | { type: 'compacted' }
  | { type: 'compaction-failed'; error?: string }
  | { type: 'plan-submitted'; text: string }
  | { type: 'terminal'; status: 'completed' | 'failed'; error?: string };
```

**映射原则**：

- 内核输出**未知事件类型 → 忽略 + 记录日志**（NewMax 日志 `unhandled event type` 先例），不崩溃、不中断流
- 内核**没有的事件类型 → 宿主降级**（如 Pi 无 reasoning 事件，UI 不显示思考区）
- reasoning 语义各家不同（CC 无显式 reasoning 事件、Codex 有 `reasoning_text.delta`）——映射时尽力而为，映射不了就丢弃并记录
- `plan-submitted` 是正式方案审批的唯一统一事件语义；canonical plan item 与平台 `plan_submit` 都可产生该事件，但同一 Run 只能落一次正式提交
- `update_task_plan`、`TaskCreate/TaskUpdate/TaskList` 及厂商任务计划通知仍按工具/任务快照投影，不得映射成 `plan-submitted`，也不得从普通文本补造正式方案

---

## 5. 各内核适配规格

### 5.1 原生内核（native，第一阶段唯一目标）

- **本质**：把现有 runtime 重构为 KernelAdapter 接口的第一个实现，**不改现有行为**
- 压缩（70% + `isMeaningfulCompactReduction`）、重试、备用模型链、审批 fence 全部保留在 native 内核内
- 直接调用现有 runtime 函数，不走进程边界
- `capabilities`：protocols = 双协议；permission = 'own'；pause = 'executor'；compress = 'own'（自己就是压缩实现）
- **注意**：后续章节里"外部内核"的规则（进程管理、协议桥接）对 native 不适用

### 5.2 Claude Code 内核

**协议**：Claude Code 对上游只讲 Anthropic Messages（+ Bedrock/Vertex）；宿主不得把 OpenAI Responses 参数直接塞给 Claude。

**当前调用链**：Runtime 使用 `@anthropic-ai/claude-agent-sdk` 的 `query()` 驱动 CLI。SDK 负责 `stream-json` stdin/stdout、partial event、permission callback、interrupt 和 session 参数；Adapter 只把 SDK 事件归一为 `KernelEvent`。应用私有版本存在时通过 `pathToClaudeCodeExecutable` 指向 `<data>/kernels/versions/claude-code/<version>/.../claude.exe`，否则使用 SDK bundled CLI。

- 首轮传 `sessionId`，后续按持久化 `session_id` 传 `resume`；模型、Provider、权限、规划和 Skill 变化继续恢复同一原生 session，宿主差异以有界 context update 追加，详见 TD-050。
- `includePartialMessages=true`，`stream_event` 的 text/thinking/tool input delta 按真实到达顺序投影；Renderer 不等待完整回答后再伪流式播放。
- 权限使用 SDK `canUseTool`。`ask -> default`、`workspace -> dontAsk`、`full-access -> bypassPermissions`；规划模式使用 Claude 原生 `plan`。SYNC-THINK 不设置 `allowedTools`、`disallowedTools`、`strictMcpConfig` 或空 `settingSources`，因此 Claude 原生工具、用户/项目设置与用户 MCP 继续可见。平台 MCP 只是合并注入并适配到统一执行/审批事件。
- `AskUserQuestion`、`EnterPlanMode`、`ExitPlanMode` 等原生工具不按名称拦截；出现交互时统一经过 SDK 回调和宿主 UI。宿主仍只对自己提供的 MCP 工具执行能力、联网、审批和工作区边界，这属于工具实现合同，不裁剪厂商工具面。
- 凭据只经环境变量注入。复用本地登录时不注入 key；指定凭据时同时设置 `ANTHROPIC_API_KEY` 与 `ANTHROPIC_AUTH_TOKEN`，但保留 Claude 默认 user/project/local settings 加载。
- pause 语义为 `turn`：取消当前 Query，下一轮继续恢复同一 session。

**Anthropic compatible base URL**：配置保存 Provider 的协议根，不要求用户填写最终 `/messages`。标准/自定义根自动补 `/v1/messages`；已经是 `/v1` 或 `/v1/messages` 时不重复。DeepSeek 的 `https://api.deepseek.com/v1` 与 `/anthropic` 都规范化为 `/anthropic/v1/messages`。若自建网关区分协议前缀，可配置 `<origin>/anthropic`，系统只在其后补 `/v1/messages`。

### 5.3 Codex 内核

- **协议**：OpenAI 协议族原生（Chat Completions / Responses）。`OPENAI_BASE_URL` 指向中转站即可，**零翻译层**
- **启动**：`codex app-server` stdio JSON-RPC；Runtime 发送 `initialize`、`thread/start|resume`、`turn/start`，接收 `item/*` 与 `turn/*` 通知。
- **规划模式顺序**：Desktop 处理 `/plan <需求>` 时先持久化 Conversation 的 `interactionMode=plan`，再发送剥离命令前缀的需求；Runtime 随后才创建 Run，并在 `turn/start.collaborationMode` 发送 `plan`。裸 `/plan`、`/execute` 只持久化模式，执行轮显式发送 `default`。
- **正式方案双通道**：完成的 `ThreadItem.type=plan` 是 canonical 方案文本，平台 `plan_submit` 是兼容提交入口；两者统一映射为 `plan-submitted`，并在宿主侧按 Run 幂等，只创建一次正式方案审批记录。任一通道已提交后，另一通道的重复到达不得创建第二张卡或新版本。
- **规划完成门禁**：规划 Run 的内核 terminal 即使报告 `completed`，产品层也只有在该 Run 已观察到 `plan-submitted` 时才视为规划成功；否则发布明确的“方案未提交”错误、保持 Conversation 为 plan 模式，且不得从 delta、最终回答或任务清单推断成功。
- **任务清单投影**：`turn/plan/updated` 归一为持久任务计划快照，Codex `inProgress` 映射为宿主 `in_progress`。`update_task_plan` 请求与完成按 `toolCallId` 关联，参数兼容顶层 `arguments/args` 与 `toolCall.argumentsJson/arguments/args`；快照按当前 thread/task 隔离，只进入任务进度投影，不进入正式方案审批。
- **压缩**：`item/started|completed` 的 `contextCompaction` 映射开始/成功，压缩期间的非重试 error 映射失败；旧 `thread/compacted` 作为成功兼容通知去重。
- **权限**：三层沙箱（read-only / workspace-write / danger-full-access）+ `--approval-policy`（untrusted / on-failure / on-request / never）。三档位映射：
  - 完全控制 → `--approval-policy never`（或 danger-full-access）
  - 询问批准 → `--approval-policy on-request`
  - 为我批准 → `--approval-policy on-failure`（写失败时才请求）
  - Codex 无 `permission-prompt-tool` 类桥接机制时，权限请求走宿主审批卡需要**实现时验证**（若有 `request_permissions` 工具事件可桥接则桥接，否则降级为 approval-policy 静态映射 + 平台工具宿主审批）
- **pause 语义**：'session'——Ctrl+C 是关会话。「暂停」按钮实际是取消 + 下次续跑（codex resume 机制可续会话）
- **凭据**：`OPENAI_API_KEY` 环境变量注入。**红利**：用户本地 ChatGPT 登录态可复用

### 5.4 Pi 内核

- **协议**：多供应商原生（内置 Anthropic/OpenAI/OpenRouter/Ollama 等 provider 配置，填 baseUrl 即可）
- **权限**：**无权限体系**（全信任）。`capabilities.permission = 'none'` → **宿主接管敏感操作**：
  - 不把 `run_command` 类敏感工具交给 Pi 直接执行
  - 宿主注册一个**代理工具**：Pi 调用 → 宿主弹审批卡 → 批准后宿主代执行
- **pause 语义**：'kill'——暂停 = 杀进程树，无恢复。UI 不显示「继续」
- **事件**：JSONL 会话格式，无 reasoning 事件 → UI 不渲染思考区

### 5.5 翻译层实证（NewMax 模式，仅路径 B 需要时参考）

本机 NewMax 日志实证（`~/.newmax/logs/`）：

```
[ClaudeProxy][REQBODY #511] model=deepseek-v4-flash-openai   ← 内核 Messages 请求
forwardCodex → https://中转站/v1/responses                    ← 翻译成 Responses 协议
Stripped output_config (effort=max)                          ← 参数剥离重映射
Codex stream unhandled event type: response.reasoning_text.delta  ← 事件翻译不全的兜底
[ClaudeProxy][RealUsage] real=202345 window=1000000 pct=20%  ← 宿主统计
```

结论：翻译层的每处 `Stripped` / `unhandled` 都是能力损耗点（thinking 参数被剥掉重做、reasoning 事件不被处理）。**优先走路径 A，翻译层是最后手段**。

### 5.6 新内核接入（插件化）

新增内核 = 实现一个 `KernelAdapter` + 图标 + 能力声明 + 注册进适配器注册表。验收标准：

- 事件流归一化完整（§4.1 全类型覆盖或声明降级）
- 权限策略明确（own + 桥接 / own 无桥接 / none → 宿主接管）
- pause 档位声明真实（实测验证）
- usage 报告格式声明

---

## 6. 权限体系统一（已定稿）

### 6.1 三档位 → 内核映射

| 宿主档位     | Claude Code                      | Codex                                    | Pi                 | 平台工具（所有内核一致） |
| ------------ | -------------------------------- | ---------------------------------------- | ------------------ | ------------------------ |
| **完全控制** | `--dangerously-skip-permissions` | `--approval-policy never`                | 宿主代理工具免批   | 免批                     |
| **询问批准** | 权限请求桥接 → 宿主审批卡        | `--approval-policy on-request`（或桥接） | 宿主代理工具全批   | 全批                     |
| **为我批准** | 只读放行，写/命令桥接弹卡        | `--approval-policy on-failure`           | 宿主代理工具中间态 | 中间态                   |

### 6.2 统一入口：所有权限请求汇到宿主审批卡

- 内核有桥接机制（CC 的 `permission-prompt-tool stdio`）→ 权限请求事件 → 宿主审批卡（复用现有 `tool.approval_requested` 审批卡 UI）→ `control_response` 回给内核
- 内核无桥接 → 静态映射（approval-policy）+ 平台工具宿主审批
- 内核无权限体系（Pi）→ 敏感工具宿主代理 + 审批卡

### 6.3 平台工具审批（一律宿主审批卡）

`create_agent` / `browser_*` / `desktop_*` / Skill / MCP / 小队管理——这些是"涉及宿主工作台"的操作，无论哪个内核执行，**一律走宿主审批卡**（受三档位控制）。cwd 越界校验撤掉作为独立机制，建议保留为审批卡显示项（弹卡时标注"此命令将写入工作区外"）。

### 6.4 平台工具副作用幂等

内核崩溃 → 宿主重试 → `create_agent` 被调用两次的风险。**写库的平台工具必须幂等**（如 create 前按名称查重）或带执行去重。

### 6.5 当前可注入外部内核的平台能力

Runtime MCP registry 是唯一目录源，按 Store、联网与视觉开关选择：

- `platform`：`platform_context`、`ask_user_question`、`plan_submit`、`task_schedule`、`goal_manage`。
- `windows-ocr`：`ocr_image`。
- `agent-library`：智能体查询、创建、更新、归档。
- `team-library`：团队查询、创建、更新、删除。
- `skill-center`：Skill 查询、读取、创建、远程导入、更新、删除。
- `mcp-directory`：MCP 工具查询与远程 MCP 注册。
- `task-board`：`update_task_plan`、`TaskCreate`、`TaskUpdate`、`TaskList`。
- 条件能力：视觉回退 `describe_image`；联网开启时 `web_search/web_fetch` 与 `browser_open/click/type/read/screenshot`。

私有 Vendor CLI 安装目录不预写这些 MCP。Claude 每轮通过 Agent SDK in-process MCP 注入，Codex 通过每 Run loopback stdio broker 注入；用户自己的厂商 MCP 和原生工具保持原样。Desktop 自动化含本机交互授权，只留在宿主通道。规划模式只过滤平台侧写入/命令/交互工具，厂商原生 plan 权限仍由厂商内核负责。

---

## 7. 凭据管理（已定稿）

| 项             | 决策                                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **注入方式**   | **环境变量**（`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`）。**禁止命令行参数**——Windows 上 `wmic` 可读任何进程命令行（NewMax 取证时即用此法） |
| **来源**       | SYNC-THINK 现有 `CredentialGroupRecord` 凭据组 → 内核凭据映射（per-model `credentialRefId`）                                              |
| **登录态红利** | 本地已安装内核时，**优先复用用户本地登录态**（CC 的 OAuth / Codex 的 ChatGPT 登录），检测到则不注入 key——宿主不处理内核自己的认证流程     |
| **脱敏**       | 错误消息注入前脱敏（复用现有 `scrubDiagnosticMessage`），防 key 泄漏进事件/UI                                                             |

---

## 8. 进程生命周期（已定稿）

| 层                      | 机制                                                                                                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **宿主死 → 内核死**     | Windows **Job Object**：spawn 时挂入 Job，`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`，宿主退出由 OS 内核级保证带走全部内核子进程                                                        |
| **宿主崩溃后回收**      | spawn 时给内核环境变量注入宿主标记（token/PID）→ 宿主重启时扫描带标记的孤儿进程 → 回收                                                                                            |
| **内核崩溃 → 事件不丢** | 宿主**流式即写库**（现有持久化模式）→ 监听内核 exit → 归类（正常/崩溃/被杀）→ 发 `run.failed`（exit code + stderr 尾部）→ 已持久化的部分事件全部保留，用户看到"内核崩溃于第 N 步" |
| **文件写一半**          | **不做自动回滚**。UI 提示"内核异常终止，最近文件改动请检查" + 提供 git diff 入口（`git_status` / `git_diff` 工具现成）                                                            |

---

## 9. 内核获取与版本策略（已定稿）

### 9.1 应用私有版本 + 本地回退

1. **探测顺序**：先读取 `<data>/kernels/active.json` 中经过包名、版本、根目录 containment 和文件存在校验的私有版本；Codex 再回退 Codex App 完整 runtime/PATH，Claude 再回退 Agent SDK bundled CLI，Pi 使用现有 PATH/安装引导。
2. **检查更新**：关于页分别查询 npm registry 的 `@openai/codex` 与 `@anthropic-ai/claude-code` 最新版本，显示当前实际版本、私有激活版本和可用版本。检查不会修改执行版本。
3. **安装与激活**：使用 packaged Node 同目录的 `npm-cli.js` 安装到随机 staging；核对 package name/version/expected executable 后 rename 到版本目录，最后原子替换 `active.json`。下载、postinstall 或验证失败时旧 active manifest 不变。
4. **首次安装与后续升级**：首次使用向导可选安装缺失的私有内核；跳过不影响进入应用。后续统一在关于页检查和升级。
5. **全会话生效**：激活不创建新会话。Codex 空闲 resident app-server 立即回收，活跃实例本轮结束后回收；Claude 下一轮重新创建 SDK adapter。两者下一轮都从原 thread/session 恢复。
6. **不影响系统安装**：不写系统 npm prefix、不覆盖 Codex App 或用户 `claude`/`codex`，只修改 SYNC-THINK 数据目录。Runtime 每次启动 Kernel 时解析 active manifest，因此激活后不需要改全局 PATH。
7. **便携发布约束**：`resources/node` 必须包含 Node 20 与 `node_modules/npm/bin/npm-cli.js`，否则 release layout 校验失败。该 Node 用于 Runtime 与私有包安装；厂商原生 CLI 的实际运行要求由其二进制自身承担。
8. **兜底**：native 内核始终可用；私有安装缺失或损坏时回退本地/bundled 版本，且不会把无效路径标成已激活。

### 9.2 版本策略：显式检查、用户触发升级（不锁死版本）

内核更新频繁（CC 已到 v2.1.x 级别），锁版本会天天失配：

| 策略                 | 做法                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **容错解析**         | 事件解析器对未知事件类型**忽略 + 记录日志**（NewMax `unhandled event type` 先例）——内核加新事件不会弄挂适配器                |
| **已知良好版本提示** | `knownGoodVersions` 声明测试过的版本 → spawn 前探测，发现未验证的新版本 → 黄条提示"该内核版本未经测试，可能异常"，**继续用** |
| **更新后回归**       | 内核更新后跑适配器回归测试（§13）                                                                                            |
| **切换时机**         | 只有用户在关于页点击安装/升级并通过验证后才原子激活；检查更新本身不切换版本                                                  |

---

## 10. 小队与共享事实层（已定稿）

### 10.1 共享事实层（宿主存储，所有内核共享）

```
共享事实层：
  ├─ 工作区级共享事实：对标 CLAUDE.md / MEMORY.md 的文件（workspace 归属已有）
  ├─ 小队级共享事实：小队目标 / 成员分工 / 约束 / 已决事项
  │    （create_team 已存在，扩展其上下文存储）
  └─ 注入方式：无论哪个内核启动，宿主把该层拼进 system prompt
       —— 内核们不共享进程，但共享事实层
```

### 10.2 小队 × 多内核

- 小队成员可**各自绑定不同内核**（成员 A 用 claude code 内核、成员 B 用 codex 内核）——并行执行时通过共享事实层对齐认知，形成"异构智能体团队"
- **中途切换内核**：宿主事件流负责 UI、审计和有界跨内核移交；每个厂商原生 session 继续负责自己的推理上下文、压缩和缓存前缀。切回旧内核优先 resume，首次进入新内核只注入有界便携上下文，详见 §2.4。

### 10.3 同文件冲突提示

宿主从各内核**写事件流**维护"活跃文件写集合"→ 检测到交叉 → UI 警告"智能体 B 正在修改你刚写入的文件 xxx"。**不做文件锁**（内核自治原则下宿主管不了内核内部的文件访问）。

---

## 11. UI 规格

### 11.1 内核选择器

- 模型选择器增加内核分组：每个模型显示**内核徽标**（`[原生]` / `[Claude Code]` / `[Codex]` / `[Pi]`）
- 未安装内核：图标置灰 + 「未安装 · 点击安装」+ 一键安装引导
- 内核图标：每个适配器自带图标资产

### 11.2 暂停/继续按钮降级

按 `capabilities.pause` 档位：

| pause 档位         | 「暂停」行为    | 「继续」按钮               |
| ------------------ | --------------- | -------------------------- |
| executor（native） | 执行器级挂起    | 显示                       |
| turn（CC）         | 停当前 turn     | 不显示（显示「发新指令」） |
| session（Codex）   | 取消 + 下次续跑 | 不显示（提示可续会话）     |
| kill（Pi）         | 杀进程          | 不显示                     |

### 11.3 审批卡复用

内核权限请求桥接 → 复用现有审批卡 UI（`tool.approval_requested` 渲染路径），用户无感知差异。

### 11.4 上下文与 Composer

- 容量数字只读显示当前模型配置，不提供会话级编辑按钮。
- Native 显示宿主自动压缩、距离压缩、阈值和最近压缩；外部内核隐藏这些宿主控制，只显示有效容量、内核自管理说明与真实压缩事件。
- Composer 内核图标使用固定 26px 命中区、18px 品牌图标并垂直居中，不随文字或工具栏高度漂移。

---

## 12. 计费与用量统计

1. **窗口容量**：模型记录的 `contextWindow` 注入内核 + 统计时分母
2. **usage 报告**：各内核报告格式不同 → 统一 `KernelUsage { real, window }` 最小协议，分项（input/output/cached）按**最粗粒度对齐**（内核不报告的项置空，不估算）
3. **计费映射**：usage 事件接入现有 `provider.usage` 通道 → `pricing.ts` 四档计费 + 能力中心 45 天统计
   - 外部内核事件同时保存内部 `modelId` 与 Provider `providerModelId`；历史缺失内部身份时以 Provider 模型名回退。
4. **UI 展示**：内核模式跑时，上下文占用/压缩状态**以内核报告的为准**——拿不到就不展示，宿主不自己瞎算

---

## 13. 测试策略

| 项               | 做法                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| **适配器单测**   | 每个内核适配器配 **fixture 进程**（mock 内核输出固定事件流），验证事件归一化全覆盖                          |
| **权限桥接测试** | fixture 发 `control_request` → 验证宿主审批卡弹出 → `control_response` 回填 → fixture 确认收到              |
| **生命周期测试** | 模拟内核崩溃（fixture 中途 exit 非零）→ 验证 run.failed + 部分事件保留；宿主退出 → 验证 Job Object 带走内核 |
| **版本回归**     | 内核更新后跑一次全量适配器回归（手动命令或 CI）                                                             |
| **回归矩阵**     | 内核数 × 平台工具数 × 权限档位数                                                                            |

---

## 14. 实施阶段

```
阶段 1：抽象层落地（不动现有功能）
  · 定义 KernelAdapter 接口（含本文件 §4 全部槽位）
  · 把现有 runtime 重构为 'native' 适配器
  · UI 加内核选择器（此时只有原生，图标先立起来）
  · 共享事实层（工作区级 + 小队级）存储与注入
  验收：现有功能零回归，内核选择器可见

阶段 2：接第一个外部内核（Claude Code）
  · 本地探测 + 引导安装 + Job Object 生命周期
  · stream-json 双向流 + permission-prompt-tool stdio 桥接
  · 中转站 Messages 端点直连（路径 A，零翻译层）
  · 审批卡桥接 + 三档位映射
  验收：用户能真正"选内核"跑通完整对话（含权限审批）

阶段 3：Codex / Pi 内核
  · 复用阶段 2 的适配器骨架
  · Codex：exec JSONL + approval-policy 映射
  · Pi：多供应商 + 宿主代理敏感工具 + 审批卡兜底
  验收：三内核可选，权限体验统一

阶段 4：插件化注册表（第三方内核接入）
  · 注册表 + 能力声明验收标准（§5.6）
```

---

## 15. 风险与已知坑清单

| #   | 风险/坑                                                             | 应对                                           |
| --- | ------------------------------------------------------------------- | ---------------------------------------------- |
| 1   | CC stream-json 权限协议**官方无文档**，依赖社区逆向                 | 以实测为准，适配器加容错日志                   |
| 2   | CC `ExitPlanMode` 批准被静默忽略 → 挂起（#39666）                   | 启动加 `--permission-mode acceptEdits`         |
| 3   | CC `.claude/skills/` 等写入静默拒绝且不发 control_request（#54850） | 平台工具避开这些路径，实测兜底                 |
| 4   | 翻译层摩擦（路径 B 时）                                             | 优先中转站 Messages 端点（路径 A）             |
| 5   | 权限体系被内核穿透（宿主管不了内核内部文件访问）                    | 三档位映射 + 平台工具一律宿主审批 + cwd 显示项 |
| 6   | 平台工具副作用重复（内核崩溃重试）                                  | 写库工具幂等                                   |
| 7   | 内核压缩后 UI 历史与内核实际上下文不一致                            | 展示以内核报告为准，宿主不二次压缩             |
| 8   | 内核更新破坏事件格式                                                | 容错解析 + knownGoodVersions 黄条 + 回归       |
| 9   | 双内核并行改同一文件                                                | 写事件流集合 + UI 风险提示                     |
| 10  | 暂停语义差异（四内核四种）                                          | capabilities.pause 档位 + UI 降级              |

---

## 16. 实现验证事项（检查清单）

已验证项按当前分支事实勾选；未勾选项仍是收口门禁：

- [x] CC 2.1.222：`--permission-prompt-tool stdio` 可产生权限请求并接受匹配 `request_id` 的 `control_response`
- [x] CC：`--include-partial-messages` 下的 `stream_event/content_block_delta` 增量与顶层 `user.tool_result` 已按真实抓取映射（fixture `claude-2.1.222-partial-capture.jsonl`）
- [ ] CC：`--permission-mode acceptEdits` 对 ExitPlanMode 的长期稳定性矩阵
- [x] CC：用户本地登录态可由 spawn 子进程复用；凭据注入仅走环境变量
- [x] Codex 0.145.0：无动态权限桥时采用 approval-policy 静态映射，平台 MCP 工具仍走宿主审批
- [x] Codex：`mcp_tool_call` 的 `server/tool/arguments` 已按真实抓取保真（fixture `codex-0.145.0-mcp-capture.jsonl`）；`reasoning` 已投影
- [x] Codex app-server 0.147.0：`contextCompaction` item 已覆盖开始/成功/失败，旧 `thread/compacted` 成功通知去重
- [ ] Pi：内核适配器与多供应商 baseUrl 配置；当前仅完成安装 UI/重探
- [ ] 中转站 `/v1/messages` 端点兼容性矩阵（CC 内核路径 A 的前提）
- [x] Job Object：Windows 嵌套 Job + taskkill/父进程兜底实现与 fixture 回归
- [x] `claude --version` / `codex --version` 探测；Pi 仍待真实安装版本样本
- [x] Codex usage 口径：真实 `turn.completed` 证明 `total = input + output`，cached 为 input 子集，已停止二次相加
- [x] 真实 CLI 冷启动样本：Codex 0.145.0、Claude Code 2.1.222 已跑通；Electron 侧 Codex 已端到端成功

### 16.1 当前未完成门禁（2026-08-14 更新）

1. Desktop 自动化仍为 host-only；Browser 工具已在联网开启时注入外部内核，并继续经过 origin grant 与风险分级。Task/Agent/Skill/Team/MCP 目录与远端注册复用宿主执行器和审批合同。
2. 幂等只覆盖同 Run 的 `(callId + 工具 + 参数摘要)` 重放。跨进程重启的持久化 operation key、以及 Skill/MCP 自然键的数据库 UNIQUE 仍未实现。
3. 实窗仍缺三项证据：原生与 Claude Code 的成功回复（当前被中转站 400 / `503 分组 claude 未开通模型` 阻断）、审批卡 approve/deny 点选、重启后历史一致性。
4. Pi 只有安装引导与安装后重探，没有内核适配器。
5. `Runtime.stop()` 尚未在正常关闭时统一 settle 待审批项；目前依赖 Run 取消与内核取消两条路径。

---

_文档基线版本：2026-08-14（第二次更新）；设计基线不变，验证清单与门禁按 `feature/multi-kernel` 当前实现事实同步。_
