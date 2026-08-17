// UI 鈫?Runtime protocol version. Bump on breaking changes to framing,
// handshake, commands, or events. Negotiated at handshake; if incompatible,
// UI opens read-only diagnostics and prompts upgrade / runtime restart.

export const PROTOCOL_VERSION = 2;

// Optional capability flags advertised by Runtime and respected by UI.
// New features should extend this list (delta from prior version).
export type Feature =
  | 'workspace.bindFolder'
  | 'workspace.update'
  | 'workspace.delete'
  | 'provider.updateModel'
  | 'task.appendMessage'
  | 'task.create'
  | 'task.archive'
  | 'task.unarchive'
  | 'task.setParticipationMode'
  | 'runtime.subscribeEvents'
  | 'runtime.continueEventReplay'
  | 'conversation.transientStream'
  | 'runtime.healthcheck'
  | 'context.packet.peek'
  | 'context.packet.amend'
  | 'approval.request'
  | 'plan.draft'
  | 'plan.revise'
  | 'plan.listRevisions'
  | 'plan.approve'
  | 'run.getGraph'
  | 'run.pause'
  | 'run.resume'
  | 'run.cancel'
  | 'artifact.list'
  | 'artifact.getVersion'
  | 'artifact.compare'
  | 'artifact.selectVersion'
  | 'artifact.merge'
  | 'artifact.listConflicts'
  | 'artifact.resolveConflict'
  | 'provider.create'
  | 'provider.update'
  | 'provider.list'
  | 'provider.revealCredential'
  | 'provider.updateCredential'
  | 'provider.discoverModels'
  | 'provider.addModels'
  | 'provider.probeCapabilities'
  | 'provider.confirmCapabilities'
  | 'provider.previewCcSwitchImport'
  | 'provider.importCcSwitch'
  | 'agent.get'
  | 'agent.updateBinding'
  | 'agent.list'
  | 'agent.create'
  | 'agent.listVersions'
  | 'agent.createVersion'
  | 'globalAgent.list'
  | 'globalAgent.create'
  | 'globalAgent.update'
  | 'globalAgent.delete'
  | 'team.list'
  | 'team.create'
  | 'team.update'
  | 'team.delete'
  | 'team.startRun'
  | 'team.setRunStatus'
  | 'conversation.list'
  | 'conversation.listMessages'
  | 'conversation.getContextStatus'
  | 'conversation.getRunProcess'
  | 'conversation.create'
  | 'conversation.rename'
  | 'conversation.setPinned'
  | 'conversation.setArchived'
  | 'conversation.setExecutionMode'
  | 'conversation.setInteractionMode'
  | 'conversation.plan'
  | 'conversation.ask'
  | 'conversation.upgradeTrack'
  | 'conversation.delete'
  | 'conversation.decideToolApproval'
  | 'browser.handoff'
  | 'browser.recording'
  | 'desktop.command.listWaiting'
  | 'desktop.command.continue'
  | 'desktop.command.cancel'
  | 'skill.import'
  | 'skill.list'
  | 'skill.get'
  | 'skill.delete'
  | 'skill.setEnabled'
  | 'skill.local'
  | 'mcp.register'
  | 'mcp.list'
  | 'mcp.setEnabled'
  | 'mcp.delete'
  | 'capability.workspace.list'
  | 'capability.workspace.setActive'
  | 'capability.governance.list'
  | 'capability.publishDraft.save'
  | 'capability.publishDraft.list'
  | 'capability.publishDraft.get'
  | 'capability.publishDraft.submit'
  | 'capability.organize.preview'
  | 'capability.organize.getLatest'
  | 'mcp.policy.probe'
  | 'mcp.spawn.probe'
  | 'mcp.tool.request'
  | 'mcp.tool.call'
  | 'mcp.tools.refresh'
  | 'diagnostics.list'
  | 'policy.save'
  | 'policy.list'
  | 'memory.decide'
  | 'memory.propose'
  | 'memory.list'
  | 'memory.rollback'
  | 'goal.set'
  | 'goal.get'
  | 'goal.clear'
  | 'goal.pause'
  | 'goal.resume'
  | 'scheduledTask';

export const DEFAULT_FEATURES: Feature[] = [
  'workspace.bindFolder',
  'workspace.update',
  'workspace.delete',
  'provider.updateModel',
  'task.appendMessage',
  'task.create',
  'task.archive',
  'task.unarchive',
  'task.setParticipationMode',
  'runtime.subscribeEvents',
  'runtime.continueEventReplay',
  'conversation.transientStream',
  'runtime.healthcheck',
  'context.packet.peek',
  'context.packet.amend',
  'plan.draft',
  'plan.revise',
  'plan.listRevisions',
  'plan.approve',
  'goal.set',
  'goal.get',
  'goal.clear',
  'goal.pause',
  'goal.resume',
  'scheduledTask',
  'run.getGraph',
  'run.pause',
  'run.resume',
  'run.cancel',
  'artifact.list',
  'artifact.getVersion',
  'artifact.compare',
  'artifact.selectVersion',
  'artifact.merge',
  'artifact.listConflicts',
  'artifact.resolveConflict',
  'provider.create',
  'provider.update',
  'provider.list',
  'provider.discoverModels',
  'provider.addModels',
  'provider.probeCapabilities',
  'provider.confirmCapabilities',
  'provider.previewCcSwitchImport',
  'provider.importCcSwitch',
  'provider.revealCredential',
  'provider.updateCredential',
  'agent.get',
  'agent.updateBinding',
  'agent.list',
  'agent.create',
  'agent.listVersions',
  'agent.createVersion',
  'globalAgent.list',
  'globalAgent.create',
  'globalAgent.update',
  'globalAgent.delete',
  'team.list',
  'team.create',
  'team.update',
  'team.delete',
  'team.startRun',
  'team.setRunStatus',
  'conversation.list',
  'conversation.listMessages',
  'conversation.getContextStatus',
  'conversation.getRunProcess',
  'conversation.create',
  'conversation.rename',
  'conversation.setPinned',
  'conversation.setArchived',
  'conversation.setExecutionMode',
  'conversation.setInteractionMode',
  'conversation.plan',
  'conversation.ask',
  'conversation.upgradeTrack',
  'conversation.delete',
  'browser.handoff',
  'browser.recording',
  'desktop.command.listWaiting',
  'desktop.command.continue',
  'desktop.command.cancel',
  'skill.import',
  'skill.list',
  'skill.get',
  'skill.delete',
  'skill.setEnabled',
  'skill.local',
  'mcp.register',
  'mcp.list',
  'mcp.setEnabled',
  'mcp.delete',
  'capability.workspace.list',
  'capability.workspace.setActive',
  'capability.governance.list',
  'capability.publishDraft.save',
  'capability.publishDraft.list',
  'capability.publishDraft.get',
  'capability.publishDraft.submit',
  'capability.organize.preview',
  'capability.organize.getLatest',
  'mcp.policy.probe',
  'mcp.spawn.probe',
  'mcp.tool.request',
  'mcp.tool.call',
  'memory.list',
  'memory.propose',
  'memory.decide',
  'memory.rollback',
  'diagnostics.list',
  'policy.save',
  'policy.list',
];

export interface ProtocolVersionMismatch {
  uiProtocolVersion: number;
  runtimeProtocolVersion: number;
}

export function isVersionCompatible(ui: number, runtime: number): boolean {
  // Major-version equality. Compatible forward-only within same major.
  return ui === runtime;
}
