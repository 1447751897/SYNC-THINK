import type { Conversation, GlobalAgent, Team } from '@sync-think/shared';
import type { SkillVersionSummary, WorkspaceSummary } from '@sync-think/protocol';
import type { ModelOption } from './NewConversationDialog.js';

export const SHELL_BOOT_SNAPSHOT_KEY = 'sync-think.shell-boot-snapshot.v1';

export interface ShellBootSnapshot {
  conversations: Conversation[];
  agents: GlobalAgent[];
  teams: Team[];
  modelNames: Array<[string, string]>;
  models: ModelOption[];
  workspaces: WorkspaceSummary[];
  skills: SkillVersionSummary[];
}

export interface ShellBootData {
  conversations: Conversation[];
  agents: GlobalAgent[];
  teams: Team[];
  modelNames: Map<string, string>;
  models: ModelOption[];
  workspaces: WorkspaceSummary[];
  skills: SkillVersionSummary[];
}

const EMPTY: ShellBootData = {
  conversations: [],
  agents: [],
  teams: [],
  modelNames: new Map(),
  models: [],
  workspaces: [],
  skills: [],
};

function storage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function readShellBootSnapshot(): ShellBootData | null {
  try {
    const raw = storage()?.getItem(SHELL_BOOT_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ShellBootSnapshot>;
    if (!Array.isArray(parsed.conversations) || !Array.isArray(parsed.workspaces)) return null;
    return {
      conversations: parsed.conversations,
      agents: Array.isArray(parsed.agents) ? parsed.agents : [],
      teams: Array.isArray(parsed.teams) ? parsed.teams : [],
      modelNames: new Map(Array.isArray(parsed.modelNames) ? parsed.modelNames : []),
      models: Array.isArray(parsed.models) ? parsed.models : [],
      workspaces: parsed.workspaces,
      skills: Array.isArray(parsed.skills) ? parsed.skills : [],
    };
  } catch {
    return null;
  }
}

export function writeShellBootSnapshot(data: ShellBootData): void {
  const payload: ShellBootSnapshot = {
    conversations: data.conversations,
    agents: data.agents,
    teams: data.teams,
    modelNames: [...data.modelNames.entries()],
    models: data.models,
    workspaces: data.workspaces,
    skills: data.skills,
  };
  try {
    storage()?.setItem(SHELL_BOOT_SNAPSHOT_KEY, JSON.stringify(payload));
  } catch {
    // Quota or private-mode — next cold start just waits for runtime.
  }
}

export function emptyShellBootData(): ShellBootData {
  return EMPTY;
}

export function hasShellBootSnapshot(data: ShellBootData | null): boolean {
  return Boolean(data && (data.conversations.length > 0 || data.workspaces.length > 0));
}
