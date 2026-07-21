// UI 鈫?Runtime protocol version. Bump on breaking changes to framing,
// handshake, commands, or events. Negotiated at handshake; if incompatible,
// UI opens read-only diagnostics and prompts upgrade / runtime restart.

export const PROTOCOL_VERSION = 2;

// Optional capability flags advertised by Runtime and respected by UI.
// New features should extend this list (delta from prior version).
export type Feature =
  | 'workspace.bindFolder'
  | 'workspace.bindGitRepository'
  | 'workspace.setDefaultExecutionMode'
  | 'task.appendMessage'
  | 'task.create'
  | 'task.delegateSubtask'
  | 'task.recordHandoff'
  | 'task.resolveWorktreeIntegration'
  | 'task.setBrowserIdentity'
  | 'task.describeExecutionAccess'
  | 'browserIdentity.list'
  | 'browserIdentity.create'
  | 'browserIdentity.update'
  | 'browserIdentity.delete'
  | 'task.archive'
  | 'task.unarchive'
  | 'task.setParticipationMode'
  | 'task.setExecutionMode'
  | 'task.setEmptyWorkspace'
  | 'runtime.subscribeEvents'
  | 'runtime.continueEventReplay'
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
  | 'group.create'
  | 'group.get'
  | 'group.list'
  | 'group.update'
  | 'group.member.add'
  | 'group.member.remove'
  | 'group.member.updateResponsibility'
  | 'group.setLead'
  | 'group.task.create'
  | 'skill.import'
  | 'skill.list'
  | 'mcp.register'
  | 'mcp.list'
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
  | 'memory.rollback';

export const DEFAULT_FEATURES: Feature[] = [
  'workspace.bindFolder',
  'workspace.bindGitRepository',
  'workspace.setDefaultExecutionMode',
  'task.appendMessage',
  'task.create',
  'task.delegateSubtask',
  'task.recordHandoff',
  'task.resolveWorktreeIntegration',
  'task.setBrowserIdentity',
  'task.describeExecutionAccess',
  'browserIdentity.list',
  'browserIdentity.create',
  'browserIdentity.update',
  'browserIdentity.delete',
  'task.archive',
  'task.unarchive',
  'task.setParticipationMode',
  'task.setExecutionMode',
  'task.setEmptyWorkspace',
  'runtime.subscribeEvents',
  'runtime.continueEventReplay',
  'runtime.healthcheck',
  'context.packet.peek',
  'context.packet.amend',
  'plan.draft',
  'plan.revise',
  'plan.listRevisions',
  'plan.approve',
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
  'agent.get',
  'agent.updateBinding',
  'agent.list',
  'agent.create',
  'agent.listVersions',
  'agent.createVersion',
  'group.create',
  'group.get',
  'group.list',
  'group.update',
  'group.member.add',
  'group.member.remove',
  'group.member.updateResponsibility',
  'group.setLead',
  'group.task.create',
  'skill.import',
  'skill.list',
  'mcp.register',
  'mcp.list',
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
