# MCP 全局归属设计（TD-041）

状态：已实施（2026-08-10）

## 背景与现有问题

旧设计把 MCP 与 Skill 共用同一套"三层治理"：全局启用 → Workspace 激活 → Agent/Team 绑定。
这对 Skill（内容型能力）合理，但对 MCP（连接型工具服务）存在三个问题：

1. **概念错位**：MCP 是全局基础设施（一个 stdio 命令或远程 Endpoint），注册一次应当处处可用；
   要求每个工作区单独"激活"是重复配置，且激活关系散落在 `capability_workspace_activation` 表中，
   与 `mcp_server` 全局表语义冲突。
2. **可用性陷阱**：MCP 注册成功后，若当前 Workspace 未激活该 MCP，Compose/Agent 上下文里
   工具静默缺失——用户难以察觉是"没激活"而不是"没注册"。
3. **UI 噪音**：MCP 治理列表的"工作区激活"列与 Skill 共用列布局，但对 MCP 无实际价值。

## 新设计

### 数据模型（不变）

- `mcp_server` 表保持全局（无 workspace_id 列）——注册天然全局。
- `capability_workspace_activation` 表保留能力类型字段，但 MCP 不再写入新的激活记录；
  历史遗留的 `type='mcp'` 激活记录被忽略（不参与有效集合计算）。

### 有效集合计算（runtime 语义变更）

```
旧：resolveEffectiveMcpServerIds(workspaceId, boundIds)
    = enabled=1 AND workspace 激活 AND id ∈ boundIds
新：resolveEffectiveMcpServerIds(_workspaceId, boundIds)
    = enabled=1 AND id ∈ boundIds          ← 全局，仅启用开关
```

实现位置：`packages/storage/src/capability-store.ts` → `resolveEffectiveMcpServerIds`，
改走 `resolveGloballyEffectiveIds`（与 Skill 的 Agent 注入路径同源）。

### 配置界面

- MCP 治理列表移除"工作区激活"列与 `WorkspaceActivationControl`（grid 7 列 → 6 列，
  新类 `.capability-governance-list--mcp`），列改为：服务 / 连接 / 45 天调用 / 最后调用 / 操作 / 启用。
- 头图说明文案改为"管理全局外部工具服务；注册后对所有工作区可用，启用即生效"。
- MCP 详情抽屉的"工作区激活"指标替换为"归属：全局"。

### 迁移策略

- **数据**：无需迁移脚本。`mcp_server` 本就无 workspace 列；历史 `capability_workspace_activation`
  中 `type='mcp'` 的行保留（不删除，便于审计），但不再影响任何计算。
- **存量配置影响**：任何已注册且 `enabled=1` 的 MCP 在新语义下立即对所有工作区生效——
  这是期望行为（修复"注册了但不可用"的陷阱）。若用户想关闭，用"启用"开关即可全局停用。
- **协议**：`GovernedMcpServerSummary.workspaceActive` 字段保留（协议兼容，UI 不再消费）。

### 对现有工作区的影响

| 场景 | 影响 |
|---|---|
| 已激活 MCP 的工作区 | 行为不变（原来可用，现在仍可用） |
| 未激活 MCP 的工作区 | **行为变化**：MCP 工具现在可用（符合"全局"预期） |
| Agent 绑定（mcpServerIds） | 不变：仍按 Agent 白名单过滤，全局化只影响"是否启用"层 |
| 全局停用 | 不变：`enabled=false` 阻断所有工作区 |

## 完成标准

- [x] `resolveEffectiveMcpServerIds` 仅按 enabled 过滤（存储层测试含跨 workspace 断言）
- [x] MCP 治理列表无工作区激活列/控件，6 列布局
- [x] 详情抽屉显示"归属：全局"
- [x] 头图文案更新
- [x] 全量测试通过（storage 8/8、AbilitiesPage 22/22）
