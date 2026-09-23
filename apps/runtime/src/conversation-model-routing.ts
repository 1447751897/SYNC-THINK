export interface ConversationModelRoutingPorts {
  getAgent(id: string): { defaultModelId?: string | null } | undefined;
  getTeam(id: string):
    | {
        coordinatorAgentId?: string | null;
        members?: readonly { agentId: string }[];
      }
    | undefined;
}

/** Default model for context previews and compaction; reads the current directory each time. */
export function resolveConversationModelId(
  conversation: {
    track?: string;
    targetRef?: string | null;
  },
  ports: ConversationModelRoutingPorts,
): string | undefined {
  const target = typeof conversation.targetRef === 'string' ? conversation.targetRef.trim() : '';
  if (!target) return undefined;
  if (conversation.track === 'model' || !conversation.track) return target;
  const agentModel = (id: string) => {
    const model = ports.getAgent(id)?.defaultModelId;
    return typeof model === 'string' ? model.trim() || undefined : undefined;
  };
  if (conversation.track === 'agent') return agentModel(target);
  if (conversation.track === 'team') {
    const team = ports.getTeam(target);
    if (typeof team?.coordinatorAgentId === 'string' && team.coordinatorAgentId) {
      const model = agentModel(team.coordinatorAgentId);
      if (model) return model;
    }
    const firstMemberId = team?.members?.[0]?.agentId;
    if (typeof firstMemberId === 'string' && firstMemberId) return agentModel(firstMemberId);
  }
  return undefined;
}
