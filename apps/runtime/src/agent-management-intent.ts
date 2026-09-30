/** Host-side eligibility, never a model-supplied authority flag. Mutations still require a one-shot user approval. */
export type AgentManagementIntent = 'create' | 'update' | 'none';
export const AGENT_DEFINITION_TOOLS = new Set([
  'list_agent_resources',
  'create_agent',
  'update_agent',
]);
export const AGENT_DEFINITION_MUTATIONS = new Set(['create_agent', 'update_agent']);
export function agentManagementIntent(text: string, delegated = false): AgentManagementIntent {
  if (delegated || typeof text !== 'string') return 'none';
  const input = text.replace(/```[\s\S]*?```/g, '').trim();
  // Conservative: ambiguous/quoted requests require the user to explicitly ask again.
  if (
    /(?:不要|不能|禁止|不许|不允许|别|无需|不需要).{0,16}(?:创建|新建|新增|修改|更新|编辑)|(?:do not|don't|never).{0,24}(?:create|update|edit)/i.test(
      input,
    )
  )
    return 'none';
  if (
    /(?:修改|更新|编辑|调整|重命名|配置).{0,40}(?:智能体|agent)|(?:update|edit|rename|configure).{0,40}\bagent\b/i.test(
      input,
    )
  )
    return 'update';
  if (
    /(?:创建|新建|新增|建立|设计|做一个|做个).{0,40}(?:智能体|agent)|(?:create|build|make|design).{0,40}\bagents?\b/i.test(
      input,
    )
  )
    return 'create';
  return 'none';
}
export function managementToolAllowed(intent: AgentManagementIntent, tool: string): boolean {
  return (
    intent !== 'none' &&
    (tool === 'list_agent_resources' ||
      tool === (intent === 'create' ? 'create_agent' : 'update_agent'))
  );
}
