# 智能体「写入策略」保存失效 — 定位与修复报告

日期：2026-09-21
现象：在智能体编辑抽屉里把写入策略改为「继承当前会话」并点保存，界面无报错，但重新打开仍是「只读」。

---

## 1. 根因

写入策略 `writePolicy`（`'inherit' | 'read-only'`）在**从渲染进程到存储层的中途被静默剥离**，
命令照常返回成功，只有这一个字段没落库。

链路（修复前）：

```
渲染进程 AgentLibrary.handleSave
  payload = { …, writePolicy: 'inherit' }              ← 字段在这里存在 ✓
        │  IPC runtime:global-agent-update
        ▼
桌面主进程 team-payloads.parseUpdateGlobalAgentPayload
  return { agentId, name, …, availabilityScope }        ← ✗ 逐字段重建对象，未映射 writePolicy（无报错、直接丢弃）
        │  转发 globalAgent.update
        ▼
运行时 validation/agent.ts parseUpdateGlobalAgentPayload
  hasOnlyKeys(value, […GLOBAL_AGENT_KEYS, 'agentId', 'archived'])   ← GLOBAL_AGENT_KEYS 里也没有 writePolicy
        │
        ▼
global-agent-store.update({ writePolicy: undefined })
  SQL: input.writePolicy ?? current.writePolicy          ← undefined 时保留旧值
        │
        ▼
接口返回成功 + 界面刷新，但值没变
```

两个缺陷必须同时修：单独修桌面侧会让字段活着到达运行时，随即被严格键白名单判成
`protocol.frame_malformed`，问题会从「静默无效」变成「保存直接报错」。

### 现场证据

读取用户实际数据库 `agent` 表：

| 来源 | write_policy |
|---|---|
| 11 个用户自建智能体 | **全部 `read-only`** |
| 4 个内置智能体（代码探索员 / 审查员 / 测试设计师 / 技术研究员） | `inherit` |

内置智能体是随代码写入的固定值，用户自建的全部停在迁移脚本 `0057_agent_write_policy` 的
`DEFAULT 'read-only'` 上 —— 即所有「改成继承当前会话」的保存都没生效。

（附带影响：新建智能体时选「只读」同样会被剥离，落库成 `inherit`。）

---

## 2. 修复

| 文件 | 改动 |
|---|---|
| `apps/desktop/src/team-payloads.ts` | 新增 `optionalWritePolicy()`；`parseCreateGlobalAgentPayload` / `parseUpdateGlobalAgentPayload` 补上 `writePolicy` 映射，非法值直接抛错而不是静默丢弃 |
| `apps/runtime/src/validation/shared.ts` | `GLOBAL_AGENT_KEYS` 加入 `'writePolicy'`；`validGlobalAgentFields()` 校验取值只能 `inherit` / `read-only` |
| `apps/desktop/src/team-payloads.test.ts` | +7 用例：创建/更新保留策略、缺省时不传、4 种非法值被拒 |
| `apps/runtime/tests/team-conversation-commands.test.ts` | 端到端：真实 runtime 进程经 IPC 写 `writePolicy: 'read-only'` 并断言回读；另断言非法值返回 `protocol.frame_malformed` |

未改动但已核验正常的环节：
- 读回路径 `summaries.toGlobalAgentSummary` 一直包含 `writePolicy`；
- 存储层 `global-agent-store.update` 的 `input.writePolicy ?? current.writePolicy` 语义正确；
- 其它调用 `updateGlobalAgent` 的位置（批量生成头像、工作区激活）不传该字段 → 视为「不修改」，行为安全。

---

## 3. 验证

| 项 | 结果 |
|---|---|
| `pnpm typecheck` | **22/22 通过，exit 0** |
| desktop 解析器测试 | **68 passed**（含新增 7 项，已单独确认全部执行） |
| runtime 端到端命令测试 | **11 passed**（含 writePolicy 往返 + 非法值拒绝） |
| `pnpm build` | **13/13 成功** |
| 产物核验 | `dist/validation/shared.js:264/298-300`、`desktop/dist/team-payloads.js:91,122` 均含新逻辑，时间戳 16:31 |
| 应用重启 | 旧 electron + 常驻 managed daemon/runtime 已全部清理，新进程 16:31 启动，runtime 日志无新错误、迁移已是最新（无重复备份） |

---

## 4. 用户侧验收

1. 侧栏进入**智能体库** → 点开任一自建智能体（如「小说小组-策划师」）
2. 「设置」页签 → 写入权限选**「继承当前会话」** → 保存
3. 重新打开该智能体：应显示「继承当前会话」
4. 反向再试一次：改回**「只读」**并保存，重开应显示「只读」
5. 卡片上的策略标签、页头统计「x / y 继承会话」应同步变化

---

## 5. 遗留

- 工作区仍有约 805 项未提交改动（含本次 4 个文件），HEAD 仍停在 09-18 的 `e5a67d1`，建议尽快提交保护性快照。
- 整包测试中另有一批**预存在失败**（delegation / transient / OCR 域），与本修复无关，建议单独排查。
- 实时流 `RuntimeProtocolError`（transient stream 协议字段不符）仍存在，属同一批预存在缺陷。
