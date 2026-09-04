# Data Grid + `grid_*` 工具落地方案

> 试点文档 · 状态：**草案，待评审**
> 日期：2026-09-01
> 目标：给 sync-think 增加「对话 + 实时数据网格 + AI 读写外部数据表」能力（即 Beautiful UI supplier records 那套），命名采用 **A 方案（`grid_*` 前缀）**。

---

## 1. 背景与定位

### 1.1 我们要的是什么（不是 HTML 渲染）

前面几轮讨论已澄清：**④ 数据网格** ≠ 一种 HTML 类型。它是 **「AI 能直接读写一张结构化数据表，用户用自然语言驱动，表格实时变化」** 的能力。它和 ③（统一 HTML 管道）不是一回事：

- ③ 管「HTML 这个产物怎么呈现/保存」——纯呈现层。
- ④ 管「AI 操作数据」——数据层 + 工具层 + 审批链，③ 装不下。

本方案只做 ④，不重复 ③ 的 HTML 管道工作。③ 的 `html:grid` 类型若将来要，可再挂到本方案的网格组件上，但那是另一件事。

### 1.2 sync-think 现状（地基已齐，缺一块砖）

| 已有（是地基） | 文件 |
|---|---|
| 声明式工具注册表（snake_case、动词开头） | `apps/runtime/src/chat-tools.ts` |
| 结构化数据存取 | `packages/protocol/src/data.ts`、`data-management-service.ts` |
| 工具审批注入（改数据前先确认） | `tool-approval.ts` + `chatToolRequiresApproval` |
| 只读/变更工具分类 Set | `CHAT_READ_ONLY_TOOL_NAMES` / `CHAT_MUTATING_TOOL_NAMES` |
| 流式 + 工具调用展示 | `MessageBubble` / `TraceList` |
| 可交互数据展示 | **无**（ui-kit 只有 `MarkdownTable` 静态表格） |

**缺的只有两件**：
1. 一个**可交互数据网格组件**（ui-kit 里没有）。
2. 一组 **AI 操作网格的 `grid_*` 工具**（尚未注册）。

---

## 2. 命名：`grid_*` 前缀（A 方案）

### 2.1 命名依据

sync-think 已有「一簇相关工具共享前缀」的先例：`browser_*`（browser_open / browser_click / browser_read …）。数据网格照此办理，用 `grid_*`。命名规则：

- **snake_case**（与 `read_file`、`list_files` 一致）
- **动词开头**（与 `web_search`、`git_status` 一致）
- **通用域**：不只服务「供应商」，业务语义放在参数里（`grid_filter_rows(table: suppliers, condition: strength>70)`）

### 2.2 完整工具清单

| 工具名 | 作用 | 分类 |
|---|---|---|
| `grid_list_columns` | 查看网格有哪些列（字段名/类型） | 只读 |
| `grid_filter_rows` | 按条件过滤行 | 只读 |
| `grid_sort_rows` | 按某列排序 | 只读 |
| `grid_aggregate` | 统计某列（平均/求和/计数，对应底部 `55% average`） | 只读 |
| `grid_export` | 导出当前视图（CSV / HTML） | 只读 |
| `grid_add_column` | 加一列（如「国家」） | 变更 |
| `grid_enrich_rows` | 给行补信息（查外部数据回填） | 变更 |
| `grid_update_cell` | 改某个单元格 | 变更 |

---

## 3. 工具 Schema 定义

每个工具按 `ProviderToolSchema` 结构（见 `chat-tools.ts` 中 `read_file` 等的写法）。下面给出 3 个代表性的完整 schema（其余同构）。

### 3.1 `grid_list_columns`（只读）

```ts
{
  name: 'grid_list_columns',
  description: 'List the columns (field names + types) of a data grid. Use before any transform to learn the available fields.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['table'],
    properties: {
      table: { type: 'string', description: 'Name of the grid / table to inspect.' },
    },
  },
}
```

### 3.2 `grid_filter_rows`（只读）

```ts
{
  name: 'grid_filter_rows',
  description: 'Filter rows of a data grid by a boolean condition (e.g. "strength > 70", "category == 包装"). Returns the filtered row set and keeps the original table unchanged.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['table', 'condition'],
    properties: {
      table: { type: 'string', description: 'Grid / table name.' },
      condition: {
        type: 'string',
        description: 'Boolean expression over column names, e.g. "strength > 70".',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 1000,
        description: 'Max rows to return (default: 100).',
      },
    },
  },
}
```

### 3.3 `grid_add_column`（变更）

```ts
{
  name: 'grid_add_column',
  description: 'Add a new column to a data grid. Mutates the underlying table — requires approval outside full-access.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['table', 'name'],
    properties: {
      table: { type: 'string', description: 'Grid / table name.' },
      name: { type: 'string', description: 'New column name.' },
      value: {
        type: 'string',
        description: 'Optional per-row expression or constant. Omit to leave blank; the model may then enrich.',
      },
    },
  },
}
```

> 其余 `grid_sort_rows`、`grid_aggregate`、`grid_export`、`grid_enrich_rows`、`grid_update_cell` 与上同构，仅参数不同，不再逐一展开。

---

## 4. 注册进 `chat-tools.ts`（三层接入）

### 4.1 定义 schema（加进 `CHAT_BUILT_IN_TOOL_SCHEMAS`）

在 `CHAT_BUILT_IN_TOOL_SCHEMAS` 数组末尾追加上述 8 个 schema（推荐归纳为 `CHAT_GRID_TOOL_SCHEMAS` 常量再展开）。

### 4.2 建分类 Set（对齐现成的只读/变更机制）

```ts
export const CHAT_GRID_TOOL_NAMES = new Set(CHAT_GRID_TOOL_SCHEMAS.map((t) => t.name));

/** 只读：最常用，在「询问批准」下也能直接用 */
export const CHAT_GRID_READ_ONLY_TOOL_NAMES = new Set([
  'grid_list_columns',
  'grid_filter_rows',
  'grid_sort_rows',
  'grid_aggregate',
  'grid_export',
]);

/** 变更：走审批链 */
export const CHAT_GRID_MUTATING_TOOL_NAMES = new Set([
  'grid_add_column',
  'grid_enrich_rows',
  'grid_update_cell',
]);
```

### 4.3 挂进三级审批判定

**① `isChatToolAllowed`**（决定「这个工具能不能被调用」）——在 CHAT_BUILT_IN_TOOL_SCHEMAS 分支后加：

```ts
if (CHAT_GRID_TOOL_NAMES.has(toolName)) return true;
```

> 与 `read_file`/`write_file` 同路径：built-in 工具一旦批准（ask）或在 workspace/full-access，即可调用。

**② `chatToolRequiresApproval`**（决定「何时需要审批卡」）——新增分支：

```ts
if (CHAT_GRID_MUTATING_TOOL_NAMES.has(toolName)) {
  // 改数据表：full-access 免审，其余要审批
  return normalized !== 'full-access';
}
```

只读 `grid_filter_rows` 等不在此分支，故在 ask 模式也不触发审批卡（与 `read_file` 一致）。

**③ `chatToolDeniedMessage`**（审批被拒/被 block 时的用户提示）——新增分支：

```ts
if (CHAT_GRID_MUTATING_TOOL_NAMES.has(toolName)) {
  const action =
    toolName === 'grid_add_column'
      ? '添加数据列'
      : toolName === 'grid_enrich_rows'
        ? '补充数据'
        : '修改单元格';
  return reason === 'denied'
    ? `用户拒绝了${action}。不要重试同一动作；说明原计划并等待用户指示。`
    : `当前权限为「询问批准」，${action}需要用户确认后才能执行。`;
}
```

---

## 5. 数据源接入（决定工程量）

「外部数据表」从哪来决定要不要新建存储/解析器。三档：

| 数据来源 | 接入方式 | 工程量 |
|---|---|---|
| MCP 暴露的表（GSheets/Notion/DB） | 走 `mcp-server` app | 中 |
| 导入的本地文件（CSV/Excel） | 新增解析 + 存储 | 中 |
| 从现有工具/仓库导出 | — | 小（先做这个验证链路） |

> **建议先做第三档**：让 `grid_*` 工具操作「当前项目里已存在的数据」，先把「对话 → 工具 → 网格实时变」这条链路跑通，不急着建全新存储。数据源具体定哪种，留到下一步确认。

---

## 6. 渲染层：可交互数据网格组件

ui-kit 现无此组件，需新建。参考 `HtmlSandbox` 的安全模型（webview opaque + no-node）与 `--ds-*` tokens，组件用 React 自有实现，不走 webview（网格是交互 UI，不是外部 HTML）。

### 6.1 新建文件

```
packages/ui-kit/src/components/DataGrid.tsx    // 带行号/列/聚合条/可加列的网格视图
packages/ui-kit/src/components/DataGrid.test.tsx
```

### 6.2 组件职责

- 接收 `{ rows: Record<string, unknown>[], columns: GridColumn[], aggregates?: GridAggregate[] }`
- 行号、列头、单元格；底部聚合条（`55% average`、`48 links`）；`Add calculation`
- 高亮最近一次工具变更的行/列（配合流式 trace），让用户看到「这里变了」
- 只读 vs 可编辑：只读网格点单元格不触发编辑；变更层改动显示为**待审批态**（等审批通过才真正写数据源）

### 6.3 挂进 Markdown 渲染（接缝在 `MarkdownContent.tsx`）

现有分发逻辑（第 406-417 行）：

```tsx
if (language === 'design-html') { ... return <DesignDraftPreview .../>; }
if (language === 'html' || language === 'htm') { ... return <HtmlSandbox code={raw} />; }
```

新增 `grid` 分支：

```tsx
if (language === 'grid') {
  if (streaming || !interactiveEmbeds) return <CodeBlock language={language}>{children}</CodeBlock>;
  return <DataGrid ... />;
}
```

**关键**：`grid` 语言块里放的不是 HTML，而是网格数据的序列化（JSON 行/列，或 `grid_*` 工具输出的视图快照）。渲染器从 markdown ` ```grid ` 块里解析数据 → 交给 `DataGrid`。这与 `design-html`（放 HTML 文档）、`html`（放 HTML 片段）形成三种不同契约，互不冲突。

---

## 7. 最终页面效果（用户可见）

### 7.1 布局

沿用 `AgentWorkspace` 的「左侧数据面板 + 对话流」。AI 产出 ` ```grid ` 块后：

```
┌─────────────────────────────────────────────────────────────┐
│  [对话流]                                        [数据面板] │
│  ┌──────────────────────────────┐   ┌────────────────────┐  │
│  │ 你说：把连接强度>70的过滤出来   │   │  ▓ Data Grid       │  │
│  │  🤖 调用 grid_filter_rows      │   │  #│ 供应商 │行业│强度│ │  │
│  │  🤖 过滤 strength>70          │   │  1│ Acme │包装│55% │ │  │
│  │  🤖 已更新：显示 3 条          │   │  2│ Beacon│物流│91% │ │  │
│  │                             │   │  ...                │  │
│  │                             │   │  ─聚合条─ 55% avg   │  │
│  └──────────────────────────────┘   └────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 交互流（用户视角）

1. 用户在对话里说「把连接强度 Very strong 的供应商过滤出来」。
2. AI 调 `grid_filter_rows`（只读层，ask 模式也放行）。
3. 右侧网格实时刷新，只显示符合条件的行；对话流里流式展示 `tool-call chip` 和处理过程。
4. 用户说「给每个供应商加一列国家」→ AI 调 `grid_add_column`（变更层）。
5. 弹出**审批卡** → 用户确认 → 网格真的加了一列 → 对话里显示「已保存」。

### 7.3 用户体验要点

- **实时性**：网格不重载，JS 增量更新，只看得到差异。
- **透明性**：AI 每次操作都在聊天流里留下 trace，来源可追溯。
- **安全性**：变更数据必须过审批；只读操作免审。
- **一致性**：网格用 `--ds-*` tokens，视觉跟现有 ui-kit 完全统一。

---

## 8. 边界与不做的事

- 本方案**不**做 ③ 的 HTML 管道抽象（另议）。
- 本方案**不**做 Beautiful UI 的组件引第三方库（用 ui-kit 自有实现 + `--ds-*`）。
- 本方案聚焦「AI 读/写数据表和对话联动」这一能力点。

---

## 9. 下一步待确认

1. **数据源走哪档**？建议先做第三档（项目内已有数据），再考虑 MCP / 导入文件。
2. **网格契约格式**：` ```grid ` 块里的数据用 JSON 序列化是否可接受？还是倾向别的格式？
3. 先出一个**可交互原型**（不污染正式代码）供你实测，还是直接落正式组件？

## 附录：与「Beautiful UI supplier records」的对应

| Beautiful UI | 本方案对应 |
|---|---|
| 左侧数据网格（行号/列/聚合条/可加列） | `DataGrid` 组件 |
| 右侧 Chat 面板实时更新 | `AgentWorkspace` 对话流 + trace |
| "filter, enrich, or add a column — I'll update the table live" | `grid_filter_rows` / `grid_enrich_rows` / `grid_add_column` |
| 底部 `55% average`、`48 links` 聚合 | `grid_aggregate` |
