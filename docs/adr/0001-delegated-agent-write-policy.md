# ADR 0001：委派子智能体的写权限

- 状态：已接受
- 日期：2026-09-17
- 影响范围：`agent` 表、委派执行（`executeDynamicAgentDelegation`）、Agent 库设置界面

## 背景

`packages/storage/src/schema/agent.ts` 原先明确写着一条决定：

> NO permission/approval columns here: permission is the conversation-level
> three-mode knob only. Agents carry capability, not gates.

也就是说：智能体不带任何权限/审批字段，权限只由对话的三档模式（ask / workspace / full-access）决定。

这条决定在「模型对话委派给已有智能体」这条路径上不够用了。委派出去的子智能体是**无人值守**的：它没有审批卡片可以答复。于是运行时给了所有子智能体一个硬编码的只读白名单（`DELEGATED_READONLY_TOOLS`：`read_file` / `list_files` / `search_files` / `git_status` / `git_diff` / `web_search` / `web_fetch`），并在 native 工具循环的每次派发上复核。

这个硬编码策略有两个问题：

1. **表达不了「这个智能体本来就该只读」**。代码审查员应当永远只读；而一个实现类智能体在 `full-access` 对话里被委派时，用户期望它能改代码。对话级三档模式无法区分这两者——同一个 `full-access` 对话里，两种智能体的期望相反。
2. **反过来也表达不了**「它只是在 ask 会话里才被限制」。

## 决定

给 `agent` 表增加一列 `write_policy`，取值两态，默认 `read-only`：

| 取值 | 委派出去时的写能力 |
|---|---|
| `read-only`（默认） | 永远只读，与对话模式无关 |
| `inherit` | 跟随对话权限模式：`workspace` / `full-access` 可写；`ask` 下仍只读 |

`ask` 下不放开，是因为子智能体没有审批入口——放开等于让写操作无人批准地执行。

**有效能力 = `智能体声明 inherit` 且 `对话模式不是 ask`**，取最严格者。只读子 run 继续使用现有的 `DELEGATED_READONLY_TOOLS` 白名单与每次派发复核，执行层不改。

## 这条决定与旧决定的边界

旧决定的核心是「**审批门**不放在智能体上」——这一点没有改变：审批仍然只由对话模式决定，智能体不携带 `approval_mode`、审批范围或任何通行证。

新增的是**能力声明**，不是门：它只回答「这个智能体被委派时允许写吗」，而且默认值（`read-only`）保持了现有的安全默认。`inherit` 只是把对话已有的权限借给子 run，不会放大对话本身的权限。

## 备选方案

- **不加字段，只看对话模式**：改动最小，但无法把某个智能体永久锁成只读，正是本次要解决的问题。
- **另建 `agent_capability` 关联表**：仍然是否认「智能体不带权限字段」，却多了一张表和一次 join，收益不明显。
- **三态（只读 / 继承 / 可写）**：`可写` 还要再定义它与对话模式的关系（能否越过 `ask`），语义反而变模糊。两态即可覆盖需求。

## 影响

- 委派卡片：只读子 run 维持现状；`inherit` 子 run 在可写对话里可以真正修改工作区。
- 委派的**嵌套**：可写子 run 不再被 `delegatedReadOnly` 关闭智能体工具，因此理论上可继续委派，受既有的 `maxNestingDepth` / `maxChildCountPerParent` / `maxAutoDelegationsPerTurn` 限额约束。
