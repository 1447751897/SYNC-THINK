# 07 · 守护进程架构设计（Daemon Architecture）

> 状态：**已实现**（2026-08-19 设计定稿；2026-08-19 经 12 张票全部落地，见 §16 实现记录）
> 本文档是守护进程实现的设计基线。实现时逐项对照，未实现/偏离的决策必须在此登记原因。

## 1. 背景与动机

改造前 SYNC-THINK 没有完整的守护进程托管：Runtime 由 Electron 主进程 spawn（`detached: false`），与桌面应用同生共死；运行时崩溃无自动拉起。

后果（代码实证）：

| 现状                      | 证据                                                                          |
| ------------------------- | ----------------------------------------------------------------------------- |
| 关窗口 = 彻底退出         | `apps/desktop/src/main/index.ts`：`window-all-closed` → `app.quit()`，无 Tray |
| runtime 随应用被杀        | `runtime-supervisor.ts`：`detached: false` + `on('exit')` 只记日志            |
| 定时任务心跳在 runtime 内 | `runtime.ts` L15441：`taskSchedulerTimer = setInterval(taskSchedulerTick)`    |
| 崩溃无恢复                | 无任何 restart 逻辑（仅启动时 `killOrphanRuntimeProcesses` 收尾）             |

这组历史问题推动了当前方案：守护进程是把产品从“对话工具”升级为“自动化平台”的基础设施。现行实现已让 Desktop 退出与 Runtime/Run 生命周期分离。

## 2. 设计原则

1. **轻量控制面 + 分级 Runtime**：daemon 常驻并负责调度、队列和 Runtime 监督；交互会话使用长期 Runtime，无交互的定时任务可按需拉起 Worker、跑完即退。
2. **唯一调度者**：daemon 是唯一调度者；被监督的长期 Runtime 不运行自己的调度 tick（防双触发——SQLite 无 leader 锁，双 tick 必双触发）。
3. **分类处理中断**：区分"用户主动"与"系统故障"，只有系统故障才自动重试（Multica 语义）。
4. **限量补跑**：错过 ≤24h 内补跑，但每种任务最多补跑 1 次（防积压爆炸）。
5. **复用而非重写**：worker 复用完整 runtime 入口 + 环境变量开关；投递协议复用管道 HMAC 握手范式；并发上限复用现有 `task-scheduler.maxConcurrent` 配置。

## 3. 架构总览

```
┌─ daemon（常驻控制面）────────────────────────────────────┐
│ 调度器 / durable queue / 并发槽位 / 补跑                  │
│ Runtime 探测 / 拉起 / 崩溃恢复 / 外部事件入口             │
└───────────────┬───────────────────────┬─────────────────┘
                │ 监督 + HMAC pipe       │ 无会话任务降级
        ┌───────▼────────┐       ┌──────▼─────────┐
        │ 长期 Runtime    │       │ Worker Runtime │
        │ Run / Message  │       │ 跑完即退       │
        │ Tool / Kernel  │       └──────┬─────────┘
        │ Codex app-server│              │
        └───────┬────────┘              │
                └──────────┬────────────┘
                     ┌─────▼─────┐
                     │  SQLite   │
                     └─────▲─────┘
                           │ cursor / replay
                     ┌─────┴─────┐
                     │ Desktop UI │（可断开 client）
                     └───────────┘
```

### 执行路径

| 场景                        | 判定                         | 路径                                                                                 |
| --------------------------- | ---------------------------- | ------------------------------------------------------------------------------------ |
| 交互对话/需会话的后台任务   | 长期 Runtime pipe 可用       | daemon/客户端投递 Runtime；Desktop 是否打开不影响执行，重开后按 cursor replay        |
| 长期 Runtime 不在           | daemon 仍存活                | daemon 先拉起并等待 Runtime ready，再投递                                             |
| 无会话定时任务的降级执行    | Runtime 投递失败或策略指定   | daemon 拉起 Worker Runtime，完成后退出                                                 |
| 投递已 ack                  | 等待终态                     | 槽位保持到 `task.dispatch.complete`、abort 或崩溃接管；ack 不等于完成                  |

Desktop 只是 Runtime 的一个 client：关闭窗口后长期 Runtime 和活动 Kernel turn 继续执行，重开后按事件 cursor 重连。只有显式取消 Run、停止后台服务或升级停机才终止长期执行面。

### 进程所有权与停机栅栏

- 冷启动采用 daemon-first：Desktop 先确保 daemon 可用，再等待 daemon 拉起长期 Runtime；只有 daemon 不可用时，Desktop 才启动 fallback Runtime。
- daemon 由独立 outer supervisor 托管。child 非零退出按 `1s / 2s / 5s / 10s / 30s` 退避重启；收到 `daemon.stop` 后正常退出 0，outer supervisor 随即结束。
- 显式后台停止/升级按 `Desktop → daemon → Runtime → Codex app-server` 串行收口。daemon 优先通过私有 IPC 请求 Runtime 关闭；无私有句柄时通过 HMAC pipe 发送 `runtime.shutdown`；超时后才进入 PID fallback。
- Runtime/daemon PID 文件与实际数据库目录同源。所有托管进程 argv 携带非敏感的 `sync-think-managed-<role>=<installId>` marker；仅凭 PID 文件强杀前必须验证 exact marker，避免 PID 重用误杀无关进程。`SYNC_THINK_PIPE_SECRET` 不进入 argv。

## 4. 决策记录（16 项，拷问定稿）

### 4.1 形态（Q1–Q3）

| #   | 决策         | 定案                                                 | 理由                                                                          |
| --- | ------------ | ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| Q1  | 守护进程形态 | **轻量控制面 + 长期交互 Runtime + 按需 Worker**      | 定时任务保留低驻留成本；交互对话、外部事件和异步任务不再绑定 Desktop 生命周期 |
| Q2  | 第一版范围   | **只做定时任务闭环**（心跳→唤醒→执行→历史落库→补跑） | 链路本身已复杂；推送/无人值守自动化在其上扩展，边界清晰                       |
| Q3  | 平台范围     | **Windows only**                                     | 开发/部署目标均为 Windows；进程抽象接口上预留跨平台                           |

### 4.2 执行（Q4 / Q5a / Q5b / Q11）

| #   | 决策                   | 定案                                                                                                                       |
| --- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Q4  | 任务由谁执行           | **优先投递 daemon 监督的长期 Runtime；无会话定时任务允许 Worker 降级**。Desktop 只负责订阅展示，不参与执行所有权             |
| Q5a | 多任务同时到期         | **并发上限 + 排队**（Multica 实证：信号量上限内并行，超限 DB 排队，自动接上；复用 `task-scheduler.maxConcurrent`，默认 2） |
| Q5b | 同任务上次没跑完又到点 | **跳过本次 + 记** `skipped` **历史**（reason: 上次执行中）                                                                 |
| Q11 | worker 形态            | **复用完整 runtime**：`SYNC_THINK_DAEMON_WORKER=1` 环境变量 → 禁用自身调度 tick，其余全保留（零第二入口维护税）            |

### 4.3 中断（Q10 / Q15）

| #   | 场景                        | 处理                                                                                                         | 历史 reason       |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------- |
| Q10 | 用户关闭 Desktop（执行中）  | 仅断开 UI；Runtime/Run 继续。显式“停止后台服务”才执行有界停机                                                | `ui-disconnected` |
| Q10 | Runtime 崩溃/被强杀          | daemon 拉起新 Runtime；可恢复 Run 按 checkpoint/thread 恢复，其他任务按既有幂等策略重试                    | `runtime-crash`   |
| Q15 | 投递 30s 无 ack（Runtime 假死） | **接管**：无会话任务可由 Worker 执行；交互 Run 保留 durable 状态并等待 Runtime 恢复                         | `desktop-hung`    |

> 副作用策略：一律**不回滚、不续跑**。Multica 也是"保留成果"而非回滚；SYNC-THINK 第一版无 worktree/续会话机制。

### 4.4 调度（Q12 / Q13 / Q14）

| #   | 决策         | 定案                                                                                                                                            |
| --- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Q12 | 双 tick 让位 | **daemon 唯一调度**：daemon 监督的长期 Runtime 与 Worker 均不启动独立调度 tick；Desktop 不承载调度。双 tick 同库必双触发是硬约束                         |
| Q13 | 开机补跑     | **限量补跑**：≤24h 窗口 + 每种任务最多补跑 1 次（latest_only），按并发上限排队                                                                  |
| Q14 | 调度精度     | **croner 精确调度**（每条任务独立定时器；增删改 → 定时器注册表同步；启动时全量重注册 = 崩溃恢复机制）                                           |

### 4.5 生命周期（Q6 / Q8 / Q9）

| #   | 决策         | 定案                                                                                                     |
| --- | ------------ | -------------------------------------------------------------------------------------------------------- |
| Q6  | 崩溃恢复     | **计划任务自启（登录时）+ 桌面应用兜底**（应用启动时检测守护进程不在 → 拉起）。零提权，无需 Windows 服务 |
| Q8  | 开机自启默认 | **默认注册，设置里可关**                                                                                 |
| Q9  | 应用升级交接 | **先停 → 更新文件 → 再启**（Windows 文件占用约束；升级流程加一步）                                       |

### 4.6 管理（Q7）

- **桌面应用内管理**：设置页「守护进程」卡片（运行状态、上次心跳、今日触发数、排队数、自启开关、并发上限、重启/日志/停止按钮）
- **CLI 辅助**：`daemon status / start / stop / logs` 排障用

## 5. 任务状态机

```
pending   → due            croner 到点
due       → running        并发上限内有空位
due       → queued         并发已满，进入数据库队列
queued    → running        有空位，按序出队
running   → success        执行完成（终态回填摘要）
running   → running        Runtime ack（仅接收，不释放并发槽位）
running   → recovering     Runtime 崩溃 → daemon 拉起后按持久状态恢复
running   → hung           投递 30s 无 ack → 仅 Worker-eligible 任务允许接管
running   → skipped        同任务重入（reason: 上次执行中）
pending   → catchup        守护进程错过 ≤24h（关机/崩溃期间）
catchup   → queued         限量补跑（latest_only，每任务最多 1 次）
```

## 6. 四种规则 → croner 映射

| 规则                        | 定时器策略                                                    | 说明                                                                                                                            |
| --------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `at`（单次）                | 一次性定时器到指定时刻                                        | 触发后注销定时器 + 任务标记已执行                                                                                               |
| `every`（周期 + 时段窗口）  | 每任务 croner 表达式，窗口边界用 cron 字段表达                | `windowStart/windowEnd` 用 `minute`/`hour` 字段范围表达；窗口外触发的用代码判断顺延到窗口内（复用现有 `computeNextRunAt` 逻辑） |
| `random`（窗口内随机 N 次） | **每天窗口开始时掷骰子**：安排当天 N 个随机时刻的一次性定时器 | 复用现有 `nextRandomOccurrence`（种子随机）；次日窗口开始时重掷                                                                 |
| `cron`（croner 语法）       | croner 原生表达式直接注册                                     | 秒级精度（croner 支持秒字段）                                                                                                   |

统一规则：

- **增/删/改任务** → 定时器注册表同步（新增注册 / 删除注销 / 改规则重注册）
- **守护进程启动** → 扫描全部启用任务全量重注册（天然崩溃恢复）
- 错过判定：定时器触发时检查 `nextRunAt` 与当前时间差，>24h 不补直接顺延；≤24h 走补跑

## 7. 投递协议（daemon ↔ Runtime）

- **传输**：命名管道，复用 `SYNC_THINK_PIPE_SECRET` + installId 的 HMAC 握手范式（已存在）
- **帧格式**（JSON）：

```jsonc
// daemon → Runtime
{ "type": "task.dispatch", "taskId": "t_xxx", "instruction": "…", "target": { "kind": "agent", "agentId": "…" }, "skillVersionIds": [] }

// Runtime → daemon（立即回复，不等执行）
{ "type": "task.dispatch.ack", "taskId": "t_xxx", "accepted": true }

// Runtime → daemon（Run 终态）
{ "type": "task.dispatch.complete", "taskId": "t_xxx", "status": "completed", "runId": "run_xxx" }
```

- **时序约束**：Runtime 收到指令立即 ack；ack 仅表示接收，并发槽位和 crash tracker 保持到 `task.dispatch.complete`。无会话任务 30s 无 ack 才允许 Worker 接管。
- **探测**：daemon 持续探测 Runtime 管道；连接失败时先走长期 Runtime 恢复流程，而不是以 Desktop 窗口状态判断。

## 8. worker 启动（守护进程 → runtime）

```
spawn(同 runtime 入口, {
  env: {
    SYNC_THINK_DAEMON_WORKER: '1',   // 禁用自身调度 tick（唯一调度者）
    // 其余配置（vault 路径、DB 路径）与长期 Runtime 相同
  }
})
```

- 凭据零障碍：API key 走 DPAPI 加密 vault，同 Windows 用户任何进程可解密，无需额外传凭据
- worker 跑完即退；失败/崩溃由守护进程按状态机记录

## 9. 并发与 DB

- **并发上限**：复用 `task-scheduler.maxConcurrent`（默认 2，设置可调 1–8）
- **排队**：数据库表（`daemon_task_queue`），非内存队列——进程重启队列不丢；出队带优先级排序（创建顺序）
- **防重复**：唯一调度者（Q12）为主防线；DB 行锁（`FOR UPDATE SKIP LOCKED` 语义，SQLite 用事务 + busy_timeout 实现）兜底
- **写库**：SQLite WAL + busy_timeout（现状已是），多进程共存无锁问题

## 10. 中断与补跑细节

| 场景                                  | 处理                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 用户主动退出 Desktop                  | 只断开 UI；长期 Runtime、活动 Run 和 Kernel session 继续，任务不产生 `app-closed` abort                            |
| Runtime 崩溃                          | daemon 拉起新 Runtime；持久 Run/checkpoint 和 Kernel thread 按恢复合同处理，未确认副作用不得盲目重复                |
| Runtime 连接存在但 30s 无 ack         | 记录 legacy reason `desktop-hung`；无会话任务可由 Worker 接管，交互 Run 等待 Runtime 恢复                          |
| daemon 自己错过（关机/daemon 崩溃）   | 启动后扫描：≤24h 的错过多跑任务进入补跑（每任务最多 1 次）；>24h 直接顺延下个周期                                  |
| 补跑触发时机                          | daemon 启动完成并确认 Runtime/队列状态后立即执行（不等下一个 tick）                                                |

## 11. 管理界面（设置页「守护进程」卡片）

- 状态徽标：运行中（绿）/ 已停止（黄）/ 异常（红，上次退出码 ≠ 0）
- 上次心跳时间（心跳每秒 1 次 → 超过 5s 无心跳即异常）
- 今日触发数（成功/排队/失败拆分）+ 排队中数量 + 定时器注册数
- 开机自启开关（默认开）
- 并发上限滑块（1–8，默认 2）
- 按钮：重启守护进程 / 查看日志 / 停止（停止后按钮变启动）
- 颜色全部复用全局语义 token（`--color-accent/success/warning/error` + soft 派生），不新增平行色板

## 12. 实施阶段（建议）

### 阶段 D1：守护进程骨架

- daemon 入口（`apps/runtime/src/daemon/main.ts`）：DB 连接 + 任务扫描 + 定时器注册表 + 状态机
- 计划任务注册（登录自启）+ 桌面应用兜底拉起 + 崩溃退出码记录
- `daemon status/start/stop/logs` CLI
- 验收：守护进程独立运行，应用开不开都能在设置页看到它

### 阶段 D2：执行链路

- 长期 Runtime 监督（探测、拉起、异常重启）+ 管道 HMAC 投递（ack + complete）
- worker 启动（`SYNC_THINK_DAEMON_WORKER=1`）+ 并发信号量 + 排队表
- 中断分类（UI disconnect / runtime-crash 恢复 / legacy desktop-hung 接管）
- 验收：Desktop 开关不改变 Run；Runtime 崩溃由 daemon 拉起；ack 后槽位保持到 complete

### 阶段 D3：补跑与收尾

- 限量补跑（≤24h + latest_only）+ 开机立即补跑
- 设置页守护进程卡片 UI + 升级流程"先停再更再启"
- 全链路测试（fixture Runtime/Worker）+ 文档
- 验收：关机 2 小时开机 → 每种错过任务恰好补跑 1 次；升级不丢任务

## 13. 风险清单

| 风险                       | 缓解                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| 双触发（双调度者）         | 唯一调度者（Q12）为主防线 + DB 行锁兜底 + 测试覆盖                                         |
| 假死误判（Runtime 慢而非卡死） | 30s ack 阈值只触发有界恢复；交互 Run 不交给 Worker 重复执行                                |
| 重试重复副作用             | 第一版不续跑不回滚；文档明示；后续版引入 worktree/会话恢复再升级                           |
| 补跑积压                   | latest_only 每任务最多 1 次 + 并发上限排队                                                 |
| 升级文件占用               | 升级流程先停再更再启                                                                       |
| 凭据安全                   | 无新增暴露面：环境变量 + DPAPI vault，禁命令行传参                                         |
| 守护进程本身崩溃           | 计划任务失败重启 + 桌面应用兜底拉起 + 启动自检                                             |
| 与未来多内核的衔接         | worker 复用 runtime 入口即天然宿主；多内核接入时守护进程是"内核工作台"的母体（见 06 文档） |

## 14. 验证清单（实现时必须逐项实测，未验证不得声称完成）

- [ ] daemon 与长期 Runtime 独立于 Desktop 常驻；Desktop 完全退出后活动对话和定时任务照常执行
- [ ] Desktop 重开后按 cursor replay 在后台产生的过程和终态，不重复启动 Run
- [ ] 强杀 Runtime → daemon 自动拉起，并按持久 checkpoint/thread 恢复
- [ ] Runtime 30s 无 ack → 无会话任务可有界接管，交互 Run 不重复执行
- [ ] 并发上限生效：3 个任务同时到期（上限 2）→ 2 执行 1 排队，完成一个后自动接上
- [ ] 同任务重入 → 跳过 + `skipped` 历史（reason: 上次执行中）
- [ ] 关机/守护进程崩溃 2 小时 → 开机后每种错过任务恰好补跑 1 次，无积压
- [ ] 四种规则（at/every/random/cron）定时器注册/注销/改规则重注册正确
- [ ] 随机任务每天窗口开始时重掷次数
- [ ] 升级流程先停再更再启，任务与历史不丢
- [ ] 设置页卡片状态、开关、并发滑块与守护进程真实状态一致
- [ ] daemon 为唯一调度者；长期 Runtime 与 Worker 均无重复 tick

## 15. 场景矩阵与扩展路径（定位澄清）

> 本节的目的是防止实现时把守护进程做窄成"定时任务专用"。补充说明见 2026-08-19 拷问后确认。

### 15.1 定位：无人值守执行中枢，定时任务只是第一个触发源

daemon 是所有后台工作共同的控制面，但不是 Agent/Kernel 业务逻辑的承载者。交互对话、插话、审批、暂停恢复和需要连续 Session 的任务由长期 Runtime 执行；Desktop 仅连接该 Runtime 并展示状态。

定时任务、手动后台任务和未来外部事件先进入 daemon 的 durable queue。daemon 优先投递长期 Runtime；只有无会话、可从头执行的任务才允许使用短期 Worker 降级，避免同一交互 Run 被两个执行体重复运行。

### 15.2 场景矩阵

关键洞察：**durable queue、并发槽位、终态跟踪和 Runtime 监督是所有无人值守场景的公共底座**。长期 Runtime 提供会话连续性，Worker 提供无会话任务的低成本降级。

| 场景                                          | 当前路径                                  | 后续工作                                              |
| --------------------------------------------- | ----------------------------------------- | ----------------------------------------------------- |
| 交互对话                                      | Desktop → 长期 Runtime                    | 补真实关闭/重连与崩溃恢复实机证据                     |
| 定时任务                                      | daemon queue → 长期 Runtime / Worker      | 保持完整终态与幂等审计                                |
| 浏览器/桌面自动化无人值守                     | Runtime 已有能力，daemon 可投递            | 定义无人审批策略与机器锁定行为                        |
| 智能体/小队异步任务（提交目标→关应用→后台跑） | `ExternalEventEnvelope` → daemon → Runtime | 后续增加 Desktop 表单入口                              |
| 外部事件触发（webhook / 文件监听 / Git 推送） | GitHub webhook 已有 HTTP endpoint；文件监听仍走 pipe | 补 Desktop 配置 UI；文件 watcher 入口 |
| 多内核                                        | Runtime 已托管 Native/Claude/Codex        | 均已迁移官方 SDK（Claude Agent SDK / Codex app-server） |
| 结果推送（push_to_bot）                       | bot push envelope → 带 bot 工具的 Runtime  | 后续增加渠道凭据绑定与模板 UI                         |

### 15.3 统一视图

```
触发源                         daemon 控制面                     执行体                    结果
├─ Desktop 对话             ─► durable queue / dispatch       ─► 长期 Runtime          ─► Run/Event/Message
├─ croner 定时器                并发槽位 / lease / 补跑            Worker（无会话降级）      历史/摘要
├─ 手动后台任务                 Runtime 监督 / crash takeover                              push / status
└─ webhook / 文件 / Git / bot
```

新增触发源复用该控制面与执行面，但必须各自定义去重键、租约、终态和重放语义，不能只接一个回调就宣称可靠。

### 15.4 第一版明确不做的边界

| 不做                                 | 原因                         | 后续成本                      |
| ------------------------------------ | ---------------------------- | ----------------------------- |
| Desktop 配置表单                     | 核心已有 CLI/API，尚无 UI      | 只增加配置入口                |
| ~~公网 HTTP webhook 暴露~~           | 已在 §17 落地（GitHub）        | —                             |
| 隧道/反向代理内置                    | 属于部署问题，不是应用问题     | 用户自备 cloudflared/ngrok/Nginx |
| bot 渠道凭据与消息模板 UI            | 依赖具体平台                   | 凭据留在 MCP/Provider         |

## 16. 实现记录（2026-08-19，12 张票全部完成）

按 to-tickets 拆为 12 张 tracer-bullet 票（GitHub issues #2–#13，parent #1），全部完成并关闭。

### 16.1 票据与提交对照

| 票                 | Issue  | 提交      | 交付                                                                                                            |
| ------------------ | ------ | --------- | --------------------------------------------------------------------------------------------------------------- |
| T1 调度核心纯函数  | #2 ✅  | `cea9e66` | `scheduler-core.ts`：decideDue / decideCatchup / ruleScheduleShape / desiredRegistrations / historyFromDecision |
| T2 守护进程骨架    | #4 ✅  | `d6c3033` | `daemon/`：TimerRegistry、状态文件、轻量 DB（不启动完整 Runtime）、心跳、管道服务端                             |
| T4 投递协议帧      | #3 ✅  | `e1de9e0` | `daemon/protocol.ts`：dispatch/ack/abort 三帧 + 白名单校验                                                      |
| T6 worker 执行器   | #7 ✅  | `9879f66` | `SYNC_THINK_DAEMON_WORKER` 开关 + runDaemonTask + 自拉 spawn + fixture 假 worker                                |
| T5 双 tick 让位    | #6 ✅  | `092c9a7` | `daemonPipePath`（独立管道名，修 EADDRINUSE）+ 探测让位                                                         |
| T7 桌面在线投递    | #8 ✅  | `6ee858c` | `dispatch-client.ts`：握手 + dispatch + 等 ack（30s）                                                           |
| T8 中断分类与接管  | #12 ✅ | `5dd3d12` | `interrupt.ts`：app-closed / runtime-crash（重试一次）/ desktop-hung + 崩溃检测                                 |
| T10 限量补跑       | #10 ✅ | `8886d74` | `catchup.ts`：planCatchupSweep + 启动补跑 + latest_only                                                         |
| T9 并发队列        | #9 ✅  | `d1d54b5` | 迁移 0047 `daemon_task_queue` + `queue.ts` 信号量 + 自动接续                                                    |
| T3 自启 + 兜底     | #5 ✅  | `c391e55` | `autostart.ts`（schtasks）+ daemon CLI 入口 + 桌面 ensureDaemonProcess                                          |
| T11 设置页管理卡片 | #13 ✅ | `20e386e` | `manage.ts` + daemon 管理帧 + `DaemonCard.tsx`（设置页）                                                        |

### 16.2 验证结果

- runtime 全量测试：**915/915 通过**（含全部 daemon 新测试：scheduler-core 21 / daemon-core 15 / protocol 15 / worker 8 / yield 9 / dispatch-client 4 / interrupt 11 / catchup 7 / queue 6 / autostart 3 / manage 6）
- storage 全量：**48/48 通过**（迁移 0047 快照已同步）
- desktop 全量：**1296 通过**（含顺带修复的 runtime-session 过期断言）
- 全仓 typecheck 0 错误，构建 11/11 成功

### 16.3 实现说明与偏离登记

| 决策                        | 实现方式                                                                            | 偏离说明                                  |
| --------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------- |
| Q11 worker 复用完整 runtime | `main.ts` 读 `SYNC_THINK_DAEMON_WORKER` + `SYNC_THINK_DAEMON_TASK_ID`               | 无偏离                                    |
| Q12 唯一调度者              | daemon 持有定时器；长期 Runtime 与 Worker 均不启独立 tick                           | 无偏离                                    |
| Q15 超时接管                | dispatch 30s 无 ack → `desktop-hung` 自拉                                           | 无偏离                                    |
| 并发槽位                    | 投递 ack 只表示 Runtime 接收；收到 `task.dispatch.complete`、abort 或崩溃接管后释放 | 避免长期 Runtime 任务绕过 daemon 并发上限 |
| 补跑计数                    | 内存 Map（latest_only），重启后按 nextRunAt 与窗口重新判定                          | 幂等设计，无需持久化计数                  |

### 16.4 遗留（后续票）

- 设置页自启开关 UI 已实现（T11）；**默认注册**策略待产品确认后由安装流程调用 `registerAutostart`（当前由桌面兜底 ensureDaemonProcess 保证常驻）
- daemon 日志写入 `daemon.log`（设置页查看）；未做日志轮转
- 外部事件核心入口已在 2026-08-21 完成；具体平台配置 UI、HTTP 暴露与 bot 渠道模板仍是后续票。

## 17. 外部事件 durable contract（2026-08-21）

统一 envelope 字段为 `id`、`dedupeKey`、`source`、`instruction`、`target`、`skillVersionIds`，可选 `workspaceId`、`conversationKey`、`title` 和脱敏 `metadata`。`conversationKey` 相同且目标/工作区相同的事件复用一个 Conversation；未提供时按 eventId 创建独立会话。

状态流：

```text
submit -> pending -> leased -> completed | failed | cancelled
                      |
                      +-- 30s 无 heartbeat -> 新 token 接管
```

- `dedupeKey` 唯一；生产者重试返回原记录，不覆盖首次 payload。
- daemon 原子 claim 并生成 fencing token；Runtime 每 10 秒 heartbeat。旧 token 的迟到 heartbeat/complete 返回 false。
- Runtime 在 ack 前持久准备 Conversation/Run 和 `eventId -> conversationId/runId` 映射；ack 后异步执行。重复 dispatch 返回原 runId。
- envelope metadata 最大 64 KiB；敏感 key 在 adapter 删除，daemon 协议边界再次拒绝。
- 本地提交：`pnpm event:submit docs/examples/external-event-git-push.json`；状态查询：`pnpm event:status evt-example-git-20260821-001`。

## 18. GitHub webhook endpoint（2026-08-21）

§15.4 原先把「公网 HTTP webhook 暴露」列为不做，理由是监听地址、认证与代理策略未定。这三点现在定了，所以该条目关闭。它是 §17 durable contract 之上的一层**薄生产者**：HTTP 接收 + 验签 + 投影，去重、租约、fencing、Runtime 拉起全部复用既有 inbox，没有新的可靠性机制。

**为什么住在 daemon 而不是 Runtime。** daemon 是登录即起的长寿进程；Runtime 由它按需拉起。监听器放 Runtime 会在每次 Runtime 重启时丢投递，而且 Desktop 关闭时端口根本不存在——那正好是这个功能要覆盖的场景。放在 daemon，push 到达时由 coordinator 的 `ensureRuntime()` 负责拉起执行体。

**认证。** `X-Hub-Signature-256`，HMAC-SHA256，**对原始字节**计算：先 `JSON.parse` 再 `JSON.stringify` 会改变 key 顺序和空白，签名必然对不上。比较用 `timingSafeEqual`，长度不等直接返回 false（让 `timingSafeEqual` 抛异常本身就是可观测的侧信道）。没有密钥就不开监听：`shouldServeGitHubWebhook` 要求 `enabled && secretHandle && routes.length > 0`——一个无认证的监听器等于让任何能触达端口的人在用户工作区里起 kernel run。密钥存 SecureStore（Windows DPAPI），配置里只有 handle。

**监听地址。** 默认 `127.0.0.1:8765`，路径 `/webhooks/github`。**应用不内置隧道或反向代理**：暴露到公网属于部署问题，用户自备 cloudflared / ngrok / Nginx。这是刻意的——内置隧道意味着替用户做信任决策。

**状态码语义**（按 GitHub 的重投规则设计，选错不是外观问题）：

| 情况 | 状态码 | 理由 |
| --- | --- | --- |
| 验签通过且已入 inbox | 200 accepted | inbox 行已存在，我们接管了 |
| `ping` | 200 ignored | 设置握手，回 200 hook 才变绿 |
| 仓库/分支未配置路由 | **200 ignored** | 「订阅了但不处理」是合法配置；回 4xx 会让 GitHub 永久重投并把 hook 标红 |
| 签名错误/缺失 | 401 | |
| body 超 25 MB | 413 | 在**流式过程中**判定并 destroy，先缓冲再检查正是它要防的 DoS |
| content-type 非 json | 400 | form-urlencoded 会把 JSON 包在 `payload=` 里，明确报错好过静默错解析 |
| 密钥取不到 | 500 | 绝不退化成无认证处理：取不到密钥说明配置坏了，不说明请求可信 |
| inbox 写入失败 | 500 | 让 GitHub 重投；dedupe key 使之安全 |

**去重。** `X-GitHub-Delivery` 直接作为 dedupe key 的一部分（`git:github:<delivery>`）。GitHub 重投用同一个 delivery id，因此重投会落到同一 inbox 行（`INSERT OR IGNORE`），不会跑第二次。

**payload 投影。** push payload 不原样转发，投影为有界摘要，原因是两条会导致**静默丢事件**的边界：其一，`parseMetadata` 拒绝任何匹配 `SENSITIVE_METADATA_KEY` 的 key，而 `signature` 匹配——GitHub 的 `head_commit.verification.signature` 会让整个 envelope 被拒；其二，metadata 上限 64 KiB，几百 commit 的 push 轻松突破。投影规则：commit 详情最多 20 条，message 只取首行截 200 字符，文件列表压成计数（rename-heavy commit 会列出上千路径），author 只留 name 不留 email（PII）。**所有**拷贝出来的字符串都有上限，包括 repo 名、ref、pusher 这些"不可能很长"的字段——它们同样是用户可控输入。

**配置与生效。** `pnpm webhook:github setup --repo owner/name --model <id> [--ref main] [--events push,pull_request]`；另有 `status` / `disable`。密钥从 stdin 读（`--secret-stdin`）或自动生成，**绝不接受 argv flag**：argv 通过进程表对机器上每个进程可见，还会进 shell history。配置写 `app_setting`，daemon 在下次 rescan（≤15s）生效；仅路由变更就地刷新不重启监听器，host/port/密钥变更才重建。`disable` 保留 routes 和密钥 handle——停用是可逆的，丢掉密钥会逼用户回 GitHub 那边重配。

**日志。** 每条投递记 delivery id（不透明 GUID，是与 GitHub「Recent Deliveries」列表对账的唯一线索），拒绝的也记；签名和密钥不进任何日志行。

## 附：本设计引用的决策来源

- 四轮设计拷问（2026-08-18/19）：Q1–Q15 全部由产品负责人拍板
- Multica 源码调研（`multica-ai/multica`）：并发上限+排队（Q5a）、中断分类（Q10）、限量补跑（Q13）三处直接采纳其验证模式
- 现有代码取证：`runtime-supervisor.ts`（spawn 范式）、`SYNC_THINK_PIPE_SECRET`（HMAC 握手）、`task-scheduler.maxConcurrent`（并发配置）、`fireScheduledTask`（补跑/重入逻辑）、DPAPI vault（凭据）

&nbsp;
