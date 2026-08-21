/**
 * 工具名归一化（单一事实来源）。
 *
 * 同一个平台工具在事件流里会以两种形态出现：
 *  - 宿主内建执行器：裸名 `TaskCreate`
 *  - 经 MCP 暴露给内核（Claude / Codex app-server）：`mcp__sync-think-platform__TaskCreate`
 *
 * 任何「按工具名做语义判定」的投影（任务清单、执行过程分类）都必须先归一化，
 * 否则内核侧调用的同一工具会漏判 —— 例如任务面板不刷新。
 *
 * 注意：归一化只用于**匹配**，不改写展示身份，也不用于权限围栏
 * （围栏作用在宿主执行器侧，参数已是裸名）。
 */

const MCP_PREFIX = 'mcp__';

/**
 * 把 `mcp__<server>__<tool>` 剥离为裸 `<tool>`；其它形态原样返回。
 *
 * 服务器名本身可能含 `__`（MCP 名称做过 `[^a-zA-Z0-9_-] -> _` 替换），
 * 因此取**最后一段** `__` 之后的内容作为工具名。
 */
export function normalizeToolName(name: string): string {
  if (!name.startsWith(MCP_PREFIX)) return name;
  const rest = name.slice(MCP_PREFIX.length);
  const separator = rest.lastIndexOf('__');
  if (separator < 0) return rest || name;
  const tool = rest.slice(separator + 2);
  return tool || name;
}

/** 工具名匹配集合：先归一化再判定，裸名与 MCP 前缀名都能命中。 */
export function matchesToolName(name: string, names: ReadonlySet<string>): boolean {
  return names.has(name) || names.has(normalizeToolName(name));
}
