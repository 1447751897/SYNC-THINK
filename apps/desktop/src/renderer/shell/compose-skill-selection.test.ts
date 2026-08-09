import { describe, expect, it } from 'vitest';
import type { Conversation, GlobalAgent, Team } from '@sync-think/shared';
import {
  filterEquippedSkillOptions,
  resolveAppendSkillVersionIds,
  resolveConversationSkillOwner,
  resolveDefaultComposeSkillVersionIds,
} from './compose-skill-selection.js';

const agents = [
  { id: 'agent-a', name: 'A', skillIds: ['skill-2', 'skill-1'] },
  { id: 'agent-b', name: 'B', skillIds: ['skill-3'] },
] as unknown as GlobalAgent[];
const teams = [
  {
    id: 'team-1',
    coordinatorAgentId: 'agent-b',
    members: [{ agentId: 'agent-a' }],
  },
  {
    id: 'team-2',
    members: [{ agentId: 'agent-a' }],
  },
] as unknown as Team[];

function conversation(track: Conversation['track'], targetRef: string): Conversation {
  return { id: 'conv-1', track, targetRef } as Conversation;
}

describe('Composer Skill owner and catalog filtering', () => {
  it('uses the bound Agent, then the Team coordinator or first member', () => {
    expect(resolveConversationSkillOwner(conversation('agent', 'agent-a'), agents, teams)?.id).toBe(
      'agent-a',
    );
    expect(resolveConversationSkillOwner(conversation('team', 'team-1'), agents, teams)?.id).toBe(
      'agent-b',
    );
    expect(resolveConversationSkillOwner(conversation('team', 'team-2'), agents, teams)?.id).toBe(
      'agent-a',
    );
    expect(resolveConversationSkillOwner(conversation('model', 'model-1'), agents, teams)).toBe(
      undefined,
    );
  });

  it('shows only equipped exact versions in allowlist order', () => {
    expect(
      filterEquippedSkillOptions(['skill-2', 'skill-1'], [
        { skillVersionId: 'skill-1', name: 'One', version: '1.0.0', description: '' },
        { skillVersionId: 'skill-other', name: 'Other', version: '1.0.0', description: '' },
        { skillVersionId: 'skill-2', name: 'Two', version: '2.0.0', description: '' },
      ]).map((skill) => skill.skillVersionId),
    ).toEqual(['skill-2', 'skill-1']);
  });

  it('always sends a deduplicated explicit array for every conversation track', () => {
    expect(resolveAppendSkillVersionIds('model', ['skill-1'])).toEqual(['skill-1']);
    expect(resolveAppendSkillVersionIds('agent', ['skill-1', 'skill-1', '', 'skill-2'])).toEqual([
      'skill-1',
      'skill-2',
    ]);
  });

  it('keeps Compose defaults empty so Agent Skills stay on the runtime injection path', () => {
    expect(
      resolveDefaultComposeSkillVersionIds(conversation('agent', 'agent-a'), agents, teams),
    ).toEqual([]);
    expect(
      resolveDefaultComposeSkillVersionIds(conversation('team', 'team-1'), agents, teams),
    ).toEqual([]);
    expect(
      resolveDefaultComposeSkillVersionIds(conversation('team', 'team-2'), agents, teams),
    ).toEqual([]);
    expect(
      resolveDefaultComposeSkillVersionIds(conversation('model', 'model-a'), agents, teams),
    ).toEqual([]);
  });
});
