/** Linguistic hints, not authority. Direct-chat proposals are host-owned; mutations require fresh approval. */
export type AgentManagementIntent = 'inspect' | 'create' | 'update' | 'create-team' | 'create-team-existing' | 'update-team' | 'delete-team' | 'none';
export const AGENT_DEFINITION_TOOLS = new Set([
  'list_agent_resources',
  'list_teams',
  'create_agent',
  'update_agent',
  'create_team',
  'update_team',
  'delete_team',
]);
export const AGENT_DEFINITION_MUTATIONS = new Set(['create_agent', 'update_agent', 'create_team', 'update_team', 'delete_team']);
/** Skills are library definitions too; file drafts are not registered versions. */
export const SKILL_DEFINITION_TOOLS = new Set(['list_skills', 'read_skill', 'create_skill', 'update_skill', 'delete_skill', 'import_remote_skill']);
export const SKILL_DEFINITION_MUTATIONS = new Set(['create_skill', 'update_skill', 'delete_skill', 'import_remote_skill']);
export const LIBRARY_DEFINITION_TOOLS = new Set([...AGENT_DEFINITION_TOOLS, ...SKILL_DEFINITION_TOOLS]);
export const LIBRARY_DEFINITION_MUTATIONS = new Set([...AGENT_DEFINITION_MUTATIONS, ...SKILL_DEFINITION_MUTATIONS]);
const TEAM_TARGET = '(?:小队|团队|\\b(?:teams?|squads?)\\b)';
const AGENT_TARGET = '(?:智能体|\\bagents?\\b)';
const CREATE_ACTION = '(?:创建|新建|新增|建立|设计|组建|组个|组一个|建个|建一个|做一个|做个|\\b(?:create|build|make|design)\\b)';
const UPDATE_ACTION = '(?:修改|更新|编辑|调整|重命名|配置|\\b(?:update|edit|rename|configure)\\b)';
const DELETE_ACTION = '(?:删除|移除|解散|\\b(?:delete|remove|disband)\\b)';
const teamTarget = new RegExp(TEAM_TARGET, 'i');
const agentTarget = new RegExp(AGENT_TARGET, 'i');
const creation = (target: string) => new RegExp(`${CREATE_ACTION}.{0,40}${target}`, 'i');
const teamCreation = creation(TEAM_TARGET);
const agentCreation = creation(AGENT_TARGET);
const teamUpdate = new RegExp(`${UPDATE_ACTION}.{0,40}${TEAM_TARGET}`, 'i');
const agentUpdate = new RegExp(`${UPDATE_ACTION}.{0,40}${AGENT_TARGET}`, 'i');
const teamDelete = new RegExp(`${DELETE_ACTION}.{0,40}${TEAM_TARGET}`, 'i');

function isManagementInquiry(clause: string): boolean {
  if (!teamTarget.test(clause) && !agentTarget.test(clause) && !/\b(?:create|update|delete)_(?:agent|team)\b/i.test(clause)) return false;
  if (/(?:列出|查看|看看|有哪些|有什么).{0,40}(?:小队|团队|智能体|\b(?:teams?|squads?|agents?)\b)/i.test(clause)) return true;
  const question = /[?？]|[吗嘛么]\s*$|能不能|可不可以|能否|可否|是否|有没有|是不是|为什么|为何/i.test(clause);
  const input = clause.trim().replace(/^(?:请问|想问一下|我想知道)\s*/, '');
  const capabilityPrefix = /^(?:(?:你|您|他们|她|它|这个助手|这个智能体|这个小队|这个团队|现在|目前|这边|我们|我)\s*)*(?:不?能|可不可以|可以|是否|能否|可否|会|支持|有没有|是不是|为什么|为何)/.test(input);
  const englishQuestion = /^(?:(?:can|can't|cannot|could|couldn't|do|does|is|are)\s+(?:you|we|i|it|this|there)\b|(?:why|what)\b)/i.test(input);
  return (question && capabilityPrefix) || englishQuestion;
}

export function agentManagementIntent(text: string, delegated = false): AgentManagementIntent {
  if (delegated || typeof text !== 'string') return 'none';
  const input = text.replace(/```[\s\S]*?```/g, '').trim();
  // Keep question marks on their clause: a capability question is not a prohibition
  // and must not authorize a write. A later explicit request can still authorize one.
  const clauses = input.replace(/([!?！？])/g, '$1\n').split(/[\n，。；;,.]|\b(?:but|and)\b|但是|不过/i).filter(clause => clause.trim());
  const commands = clauses.filter(clause => !isManagementInquiry(clause));
  const negativeAction = /(?:不要|不能|禁止|不许|不允许|别|无需|不需要|不用).{0,16}(?:创建|新建|新增|修改|更新|编辑|组建|删除)|(?:do not|don't|never).{0,24}(?:create|update|edit|build|make|design|delete|remove|disband)/i;
  const denies = (target: RegExp) => commands.some(clause => negativeAction.test(clause) && target.test(clause));
  const denyTeam = denies(teamTarget) || commands.some(clause => /(?:不要|不能|禁止|别|无需|不需要|不用).{0,16}(?:组队|建队)/.test(clause));
  const denyAgent = denies(agentTarget);
  if (!denyTeam) {
    if (commands.some(clause => teamDelete.test(clause))) return 'delete-team';
    // Creation comes before update: “编辑” can be the new editor's role, not an edit verb.
    if (commands.some(clause => /(?:组队|建队)/.test(clause) || teamCreation.test(clause))) {
      return denyAgent || /(?:只用|仅用|只复用|仅复用).{0,12}(?:现有|已有)|existing agents only/i.test(input) ? 'create-team-existing' : 'create-team';
    }
    if (commands.some(clause => teamUpdate.test(clause))) return 'update-team';
  }
  if (!denyAgent) {
    if (commands.some(clause => agentCreation.test(clause))) return 'create';
    if (commands.some(clause => agentUpdate.test(clause))) return 'update';
  }
  return !denyTeam && !denyAgent && clauses.some(isManagementInquiry) ? 'inspect' : 'none';
}
/** Intent narrows legacy callers; direct human chats may PROPOSE any definition change for confirmation. */
export function managementToolAllowed(intent: AgentManagementIntent, tool: string, allowProposals = false): boolean {
  if (allowProposals) return LIBRARY_DEFINITION_TOOLS.has(tool);
  if (intent === 'none') return false;
  if (tool === 'list_agent_resources' || tool === 'list_teams') return true;
  if (intent === 'inspect') return false;
  if (intent === 'create-team-existing') return tool === 'create_team';
  if (intent === 'create-team') return tool === 'create_team' || tool === 'create_agent';
  if (intent === 'update-team') return tool === 'update_team';
  if (intent === 'delete-team') return tool === 'delete_team';
  return tool === (intent === 'create' ? 'create_agent' : 'update_agent');
}
